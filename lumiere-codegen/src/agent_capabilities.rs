//! Deny-by-default, framework-neutral capability metadata for the AI harness.
//!
//! This module consumes the canonical contract IR and a separately reviewed
//! allowlist. An entry exists only because a named reviewer accepted exposing
//! that operation or resource to agents, and the artifact carries that review
//! record. It contains structural metadata only; authorization and confirmation
//! enforcement remain runtime responsibilities.
//!
//! Each entry also carries the model-facing tool descriptor: the tool name,
//! a description built from the reviewed target, and the input JSON Schema.
//! Deriving the schema here keeps per-tool schemas out of the gateway, which
//! H3 forbids. Tenant scope is never an input: the organization is always
//! server-derived, and a company is accepted only for company-scoped resources,
//! where the server still enforces it.
//!
//! Result-policy caps are absolute ceilings, not the effective limit. Roles are
//! per-organization tenant rows, so a global contract cannot name them; the
//! effective row and byte limits for an actor are resolved at runtime and can
//! only narrow these values.

use crate::paths::Paths;
use crate::support::{read_to_string, write_file};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const MANIFEST_VERSION: u32 = 1;
/// Bumped to 2 when entries gained their review record and tool descriptor.
const ARTIFACT_VERSION: u32 = 2;
pub const ARTIFACT_FILENAME: &str = "agent-capability-registry-v1.json";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReviewedManifest {
    version: u32,
    entries: Vec<ReviewedEntry>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReviewedEntry {
    #[serde(default)]
    operation_id: Option<String>,
    #[serde(default)]
    resource: Option<String>,
    capability_key: String,
    risk: OperationRisk,
    requires_confirmation: bool,
    result_policy: ResultPolicy,
    review: EntryReview,
}

/// Who accepted exposing this target to agents, when, and on what basis.
/// Required: an entry without an accountable reviewer is not reviewed.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct EntryReview {
    reviewed_by: String,
    /// RFC 3339 UTC instant, for example `2026-09-13T00:00:00Z`.
    reviewed_at: String,
    /// Why this target is safe to expose, in the reviewer's words.
    evidence: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum OperationRisk {
    ReadOnly,
    Presentation,
    Draft,
    BusinessMutation,
    FinancialMutation,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum ResultPolicy {
    Direct {
        max_bytes: u64,
    },
    Dataset {
        max_rows: u64,
        max_bytes: u64,
    },
    AggregateFirst {
        allowed_shapes: Vec<String>,
        max_output_rows: u64,
    },
}

#[derive(Debug, Deserialize)]
struct CanonicalIr {
    ir_version: u32,
    source_commit: String,
    source_dirty: bool,
    schema_hash: String,
    operations: Vec<IrOperation>,
    resources: Vec<IrResource>,
}

#[derive(Debug, Deserialize)]
struct IrOperation {
    name: String,
    contract_operation_id: String,
    application: Value,
    authorization: Value,
    client_facing: bool,
    classification_evidence: String,
    codec: Value,
    contract_operation_id_status: String,
    idempotency: Value,
    input: Value,
    kind: Value,
    output: Value,
    schema: Value,
    source_kind: String,
    target: Value,
}

#[derive(Debug, Deserialize)]
struct IrResource {
    name: String,
    contract: Value,
    query: Value,
    row: Value,
    scope: Value,
    subscription: Value,
    source: Value,
}

#[derive(Debug, Serialize)]
struct CapabilityArtifact {
    artifact_version: u32,
    source_ir: SourceIr,
    entries: Vec<GeneratedEntry>,
}

#[derive(Debug, Serialize)]
struct SourceIr {
    ir_version: u32,
    source_commit: String,
    source_dirty: bool,
    schema_hash: String,
}

#[derive(Debug, Serialize)]
struct GeneratedEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    operation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    resource: Option<String>,
    capability_key: String,
    risk: OperationRisk,
    requires_confirmation: bool,
    result_policy: ResultPolicy,
    review: EntryReview,
    /// Absent for operation targets, whose input schema needs IR type expansion.
    /// The runtime cannot advertise an entry without one.
    #[serde(skip_serializing_if = "Option::is_none")]
    tool: Option<ToolDescriptor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    operation: Option<OperationDescriptor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    resource_descriptor: Option<ResourceDescriptor>,
}

/// The model-facing surface of one capability.
#[derive(Debug, Serialize)]
struct ToolDescriptor {
    name: String,
    description: String,
    input_schema: Value,
}

#[derive(Debug, Serialize)]
struct OperationDescriptor {
    operation_name: String,
    operation_id: String,
    operation_id_status: String,
    source_kind: String,
    target: Value,
    application_exposure: String,
    application: Value,
    client_facing: bool,
    authorization: Value,
    input: Value,
    output: Value,
    schema: Value,
    idempotency: Value,
    codec: Value,
    kind: Value,
    evidence: String,
}

#[derive(Debug, Serialize)]
struct ResourceDescriptor {
    resource_name: String,
    contract: Value,
    query: Value,
    row: Value,
    scope: Value,
    subscription: Value,
    source: Value,
}

pub fn run(paths: &Paths) -> Result<()> {
    let ir_text = read_to_string(&paths.contract_ir_out)?;
    let manifest_text = read_to_string(&paths.agent_capability_metadata_json)?;
    let artifact = compile(&ir_text, &manifest_text)?;
    let (json, checksum) = render_artifact(&artifact)?;
    write_file(&paths.agent_capability_registry_out, &json)?;
    write_file(&paths.agent_capability_registry_checksum_out, &checksum)?;
    println!(
        "Wrote {} ({} reviewed entries)",
        paths.agent_capability_registry_out.display(),
        artifact.entries.len()
    );
    Ok(())
}

fn compile(ir_text: &str, manifest_text: &str) -> Result<CapabilityArtifact> {
    let ir: CanonicalIr = serde_json::from_str(ir_text).context("parse canonical contract IR")?;
    validate_source_ir(&ir)?;

    let manifest: ReviewedManifest =
        serde_json::from_str(manifest_text).context("parse reviewed agent capability metadata")?;
    if manifest.version != MANIFEST_VERSION {
        bail!(
            "unsupported agent capability metadata version {}",
            manifest.version
        );
    }

    let mut operations = BTreeMap::new();
    for operation in &ir.operations {
        validate_operation_shape(operation)?;
        if operations
            .insert(operation.contract_operation_id.as_str(), operation)
            .is_some()
        {
            bail!(
                "canonical operation identity is duplicated: {}",
                operation.contract_operation_id
            );
        }
    }

    let mut resources = BTreeMap::new();
    for resource in &ir.resources {
        let eligible = validate_resource_shape(resource)?;
        if eligible && resources.insert(resource.name.as_str(), resource).is_some() {
            bail!(
                "canonical resource identity is duplicated: {}",
                resource.name
            );
        }
    }

    let mut previous_key: Option<String> = None;
    let mut capability_keys = BTreeSet::new();
    let mut targets = BTreeSet::new();
    let mut tool_names = BTreeSet::new();
    let mut entries = Vec::with_capacity(manifest.entries.len());
    for entry in manifest.entries {
        let target = validate_entry(
            &entry,
            previous_key,
            &operations,
            &resources,
            &mut capability_keys,
            &mut targets,
        )?;
        previous_key = Some(entry.capability_key.clone());
        let tool = tool_descriptor(&entry, &target)?;
        if let Some(tool) = &tool {
            if !tool_names.insert(tool.name.clone()) {
                bail!("capability tool name {} is not unique", tool.name);
            }
        }
        let (operation, resource_descriptor) = match target {
            Target::Operation(operation) => (Some(operation_descriptor(operation)?), None),
            Target::Resource(resource) => (None, Some(resource_descriptor(resource))),
        };
        entries.push(GeneratedEntry {
            operation_id: entry.operation_id,
            resource: entry.resource,
            capability_key: entry.capability_key,
            risk: entry.risk,
            requires_confirmation: entry.requires_confirmation,
            result_policy: entry.result_policy,
            review: entry.review,
            tool,
            operation,
            resource_descriptor,
        });
    }

    Ok(CapabilityArtifact {
        artifact_version: ARTIFACT_VERSION,
        source_ir: SourceIr {
            ir_version: ir.ir_version,
            source_commit: ir.source_commit,
            source_dirty: ir.source_dirty,
            schema_hash: ir.schema_hash,
        },
        entries,
    })
}

fn validate_source_ir(ir: &CanonicalIr) -> Result<()> {
    if ir.ir_version != 2 {
        bail!(
            "agent capability source IR must be v2, got {}",
            ir.ir_version
        );
    }
    if !valid_git_object_id(&ir.source_commit) {
        bail!("agent capability source_commit is not a git object ID");
    }
    if !valid_sha256(&ir.schema_hash) {
        bail!("agent capability schema_hash is not a sha256 digest");
    }
    Ok(())
}

fn validate_operation_shape(operation: &IrOperation) -> Result<()> {
    if operation.name.is_empty() || operation.contract_operation_id.is_empty() {
        bail!("canonical operation identity is incomplete");
    }
    if !operation.contract_operation_id.starts_with("erp.") {
        bail!(
            "canonical operation {} has an invalid contract operation ID",
            operation.name
        );
    }
    if operation.contract_operation_id_status != "locked" {
        bail!(
            "canonical operation {} lacks a locked contract operation ID",
            operation.name
        );
    }
    if !matches!(
        operation.source_kind.as_str(),
        "reducer" | "view" | "procedure"
    ) {
        bail!(
            "canonical operation {} has an invalid source kind {}",
            operation.name,
            operation.source_kind
        );
    }
    let application = operation.application.as_object();
    let application_exposure = application
        .and_then(|value| value.get("exposure"))
        .and_then(Value::as_str);
    if let Some(exposure) = application_exposure {
        if !matches!(exposure, "session" | "denied") {
            bail!(
                "canonical operation {} has an invalid application exposure {}",
                operation.name,
                exposure
            );
        }
        if operation.client_facing != (exposure == "session") {
            bail!(
                "canonical operation {} client-facing status disagrees with application exposure",
                operation.name
            );
        }
        if operation.source_kind == "reducer"
            && application
                .and_then(|value| value.get("name"))
                .and_then(Value::as_str)
                != Some(operation.name.as_str())
        {
            bail!(
                "canonical reducer operation {} application name disagrees",
                operation.name
            );
        }
    } else if !operation.application.is_null() {
        bail!(
            "canonical operation {} has incomplete application exposure",
            operation.name
        );
    }
    require_object_field(&operation.authorization, "status", "authorization")?;
    if operation
        .authorization
        .get("status")
        .and_then(Value::as_str)
        != Some("classified")
    {
        bail!(
            "canonical operation {} lacks classified authorization metadata",
            operation.name
        );
    }
    validate_status_value(
        &operation.kind,
        "kind",
        &operation.name,
        &["command", "operator", "test", "internal"],
    )?;
    validate_status_value(
        &operation.idempotency,
        "idempotency",
        &operation.name,
        &[
            "idempotent",
            "request_guarded",
            "state_guarded",
            "non_idempotent",
            "not_applicable",
        ],
    )?;
    if operation.codec
        != serde_json::json!({
            "id": "spacetimedb-sats-json",
            "status": "assigned",
            "version": 1
        })
    {
        bail!(
            "canonical operation {} has invalid codec metadata",
            operation.name
        );
    }
    if operation.classification_evidence.trim().is_empty() {
        bail!(
            "canonical operation {} lacks classification evidence",
            operation.name
        );
    }
    require_input_descriptor(&operation.input, &operation.name)?;
    require_output_descriptor(&operation.output, &operation.name)?;
    if !operation.schema.is_object() || !operation.target.is_object() {
        bail!(
            "canonical operation {} lacks schema or target metadata",
            operation.name
        );
    }
    if operation.schema.get("name").and_then(Value::as_str) != Some(operation.name.as_str()) {
        bail!(
            "canonical operation {} schema name disagrees",
            operation.name
        );
    }
    let expected_target_kind = match operation.source_kind.as_str() {
        "reducer" => "spacetimedb_reducer",
        "view" => "spacetimedb_view",
        "procedure" => "spacetimedb_procedure",
        other => bail!(
            "canonical operation {} has invalid source kind {other}",
            operation.name
        ),
    };
    if operation.target.get("kind").and_then(Value::as_str) != Some(expected_target_kind)
        || operation.target.get("name").and_then(Value::as_str) != Some(operation.name.as_str())
    {
        bail!(
            "canonical operation {} target disagrees with source kind/name",
            operation.name
        );
    }
    let output = operation
        .output
        .as_object()
        .context("operation output metadata is not an object")?;
    let expected_output_kind = if operation.source_kind == "reducer" {
        "unit"
    } else {
        "unresolved"
    };
    if output.get("kind").and_then(Value::as_str) != Some(expected_output_kind)
        || !output.get("type_reference").is_some_and(Value::is_null)
    {
        bail!(
            "canonical operation {} output disagrees with source kind",
            operation.name
        );
    }
    Ok(())
}

fn validate_resource_shape(resource: &IrResource) -> Result<bool> {
    if resource.name.is_empty() {
        bail!("canonical resource identity is empty");
    }
    let query = resource
        .query
        .as_object()
        .with_context(|| format!("resource {} query metadata is not an object", resource.name))?;
    if query.get("status").and_then(Value::as_str) != Some("classified") {
        return Ok(false);
    }
    if query.get("authorization").and_then(Value::as_str) != Some("server-enforced") {
        return Ok(false);
    }
    let result_type = query
        .get("result_type_reference")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .with_context(|| format!("resource {} has no query result type", resource.name))?;
    let row_type = resource
        .row
        .get("type_reference")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .with_context(|| format!("resource {} has no row type", resource.name))?;
    if result_type != row_type {
        bail!(
            "resource {} query result type disagrees with row type",
            resource.name
        );
    }
    if !resource.contract.is_object()
        || !resource.scope.is_object()
        || !resource.subscription.is_object()
        || !resource.source.is_object()
    {
        bail!(
            "resource {} lacks canonical contract, scope, subscription, or source metadata",
            resource.name
        );
    }
    Ok(true)
}

fn validate_status_value(
    value: &Value,
    field: &str,
    operation_name: &str,
    allowed: &[&str],
) -> Result<()> {
    let object = value
        .as_object()
        .with_context(|| format!("operation {operation_name} {field} metadata is not an object"))?;
    if object.get("status").and_then(Value::as_str) != Some("classified") {
        bail!("operation {operation_name} {field} metadata is not classified");
    }
    let value = object
        .get("value")
        .and_then(Value::as_str)
        .with_context(|| format!("operation {operation_name} {field} has no value"))?;
    if !allowed.contains(&value) {
        bail!("operation {operation_name} has invalid {field} value {value}");
    }
    Ok(())
}

fn require_object_field<'a>(value: &'a Value, field: &str, parent: &str) -> Result<&'a Value> {
    value
        .as_object()
        .and_then(|object| object.get(field))
        .with_context(|| format!("{parent} metadata lacks {field}"))
}

fn require_input_descriptor(value: &Value, operation_name: &str) -> Result<()> {
    let object = value
        .as_object()
        .with_context(|| format!("operation {operation_name} input metadata is not an object"))?;
    if !matches!(
        object.get("kind").and_then(Value::as_str),
        Some("operation_parameters" | "unresolved")
    ) || object
        .get("parameter_positions")
        .and_then(Value::as_array)
        .is_none()
    {
        bail!("operation {operation_name} input metadata is incomplete");
    }
    Ok(())
}

fn require_output_descriptor(value: &Value, operation_name: &str) -> Result<()> {
    let object = value
        .as_object()
        .with_context(|| format!("operation {operation_name} output metadata is not an object"))?;
    if !matches!(
        object.get("kind").and_then(Value::as_str),
        Some("unit" | "unresolved")
    ) || !object.contains_key("type_reference")
    {
        bail!("operation {operation_name} output metadata is incomplete");
    }
    Ok(())
}

enum Target<'a> {
    Operation(&'a IrOperation),
    Resource(&'a IrResource),
}

fn validate_entry<'a>(
    entry: &ReviewedEntry,
    previous_key: Option<String>,
    operations: &BTreeMap<&'a str, &'a IrOperation>,
    resources: &BTreeMap<&'a str, &'a IrResource>,
    capability_keys: &mut BTreeSet<String>,
    targets: &mut BTreeSet<String>,
) -> Result<Target<'a>> {
    if !valid_capability_key(&entry.capability_key) {
        bail!("invalid stable capability key {}", entry.capability_key);
    }
    if previous_key.is_some_and(|previous| previous.as_str() >= entry.capability_key.as_str()) {
        bail!("agent capability entries must be sorted by capability_key");
    }
    if !capability_keys.insert(entry.capability_key.clone()) {
        bail!("duplicate capability key {}", entry.capability_key);
    }
    validate_result_policy(&entry.capability_key, &entry.result_policy)?;
    if matches!(
        entry.risk,
        OperationRisk::Draft | OperationRisk::BusinessMutation | OperationRisk::FinancialMutation
    ) && !entry.requires_confirmation
    {
        bail!(
            "capability {} requires confirmation for {:?} risk",
            entry.capability_key,
            entry.risk
        );
    }

    match (&entry.operation_id, &entry.resource) {
        (Some(operation_id), None) => {
            let operation = operations.get(operation_id.as_str()).with_context(|| {
                format!(
                    "capability {} references unknown or ineligible operation {}",
                    entry.capability_key, operation_id
                )
            })?;
            if !eligible_operation(operation) {
                bail!(
                    "capability {} references an internal, denied, or non-application operation {}",
                    entry.capability_key,
                    operation_id
                );
            }
            if !targets.insert(format!("operation:{operation_id}")) {
                bail!("capability {} repeats a target", entry.capability_key);
            }
            Ok(Target::Operation(operation))
        }
        (None, Some(resource_name)) => {
            let resource = resources.get(resource_name.as_str()).with_context(|| {
                format!(
                    "capability {} references unknown or unauthorized resource {}",
                    entry.capability_key, resource_name
                )
            })?;
            if !targets.insert(format!("resource:{resource_name}")) {
                bail!("capability {} repeats a target", entry.capability_key);
            }
            Ok(Target::Resource(resource))
        }
        (Some(_), Some(_)) => bail!("capability {} has multiple targets", entry.capability_key),
        (None, None) => bail!("capability {} has no target", entry.capability_key),
    }
}

/// Build the model-facing tool from the reviewed entry and its canonical target.
///
/// The name is the capability key with separators folded to `_`, because
/// providers only accept identifier-shaped function names. The description and
/// schema are derived, never hand-written per tool.
///
/// Operation targets yield no descriptor yet: a reducer's input schema needs
/// the IR type registry expanded for its parameter types. Such an entry stays
/// in the artifact as reviewed metadata, and the runtime refuses to advertise
/// it rather than guessing a schema.
fn tool_descriptor(entry: &ReviewedEntry, target: &Target<'_>) -> Result<Option<ToolDescriptor>> {
    validate_review(&entry.capability_key, &entry.review)?;
    let name = entry.capability_key.replace(['.', '-'], "_");
    if !valid_tool_name(&name) {
        bail!(
            "capability {} does not yield a valid tool name",
            entry.capability_key
        );
    }
    let (description, input_schema) = match target {
        Target::Operation(_) => return Ok(None),
        Target::Resource(resource) => {
            // The backing table is context for the model, not a requirement:
            // view-backed resources legitimately have none.
            let table = resource
                .contract
                .get("table")
                .and_then(Value::as_str)
                .or_else(|| {
                    resource
                        .source
                        .get("table_reference")
                        .and_then(Value::as_str)
                })
                .map(|table| format!(" in table {table}"))
                .unwrap_or_default();
            let row_type = resource
                .row
                .get("type_reference")
                .and_then(Value::as_str)
                .with_context(|| format!("resource {} has no row type", resource.name))?;
            let company_scoped = resource
                .scope
                .get("kind")
                .and_then(Value::as_str)
                .is_some_and(|kind| kind == "organization_company");
            let description = format!(
                "Read authorized {} rows ({}{}). Scope is server-derived and field access \
                 is enforced per actor. Reviewed by {}: {}",
                resource.name, row_type, table, entry.review.reviewed_by, entry.review.evidence
            );
            (
                description,
                read_input_schema(&entry.result_policy, company_scoped),
            )
        }
    };
    Ok(Some(ToolDescriptor {
        name,
        description,
        input_schema,
    }))
}

/// Inputs a model may choose for an authorized read. The organization is always
/// server-derived and absent here; `company_id` appears only for
/// company-scoped resources and the server still enforces it. `max_rows` is
/// bounded by the reviewed ceiling, and a runtime role policy may only narrow
/// the effective limit further.
fn read_input_schema(policy: &ResultPolicy, company_scoped: bool) -> Value {
    let max_rows = match policy {
        ResultPolicy::Dataset { max_rows, .. } => *max_rows,
        ResultPolicy::AggregateFirst {
            max_output_rows, ..
        } => *max_output_rows,
        ResultPolicy::Direct { .. } => 1,
    };
    let mut properties = serde_json::Map::new();
    properties.insert(
        "max_rows".to_string(),
        serde_json::json!({
            "type": "integer",
            "minimum": 1,
            "maximum": max_rows,
            "description": "Rows to request, capped by the reviewed ceiling and the actor's role policy.",
        }),
    );
    if company_scoped {
        properties.insert(
            "company_id".to_string(),
            serde_json::json!({
                "type": "integer",
                "minimum": 1,
                "description": "Company to read within the authorized organization; verified server-side.",
            }),
        );
    }
    serde_json::json!({
        "type": "object",
        "properties": Value::Object(properties),
        "required": [],
        "additionalProperties": false,
    })
}

fn validate_review(capability_key: &str, review: &EntryReview) -> Result<()> {
    if review.reviewed_by.trim().is_empty() {
        bail!("capability {capability_key} has no reviewer");
    }
    if review.evidence.trim().is_empty() {
        bail!("capability {capability_key} has no review evidence");
    }
    if !valid_utc_instant(&review.reviewed_at) {
        bail!("capability {capability_key} reviewed_at must be an RFC 3339 UTC instant");
    }
    Ok(())
}

/// Provider function names: lowercase identifier characters only.
fn valid_tool_name(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes[0].is_ascii_lowercase()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'_')
        && !value.ends_with('_')
        && !value.contains("__")
}

fn valid_utc_instant(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 20
        && bytes[19] == b'Z'
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[10] == b'T'
        && bytes[13] == b':'
        && bytes[16] == b':'
        && [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18]
            .iter()
            .all(|index| bytes[*index].is_ascii_digit())
}

fn eligible_operation(operation: &IrOperation) -> bool {
    operation.source_kind == "reducer"
        && operation.client_facing
        && operation
            .application
            .get("exposure")
            .and_then(Value::as_str)
            == Some("session")
        && operation.kind.get("value").and_then(Value::as_str) != Some("internal")
}

fn operation_descriptor(operation: &IrOperation) -> Result<OperationDescriptor> {
    let application_exposure = operation
        .application
        .get("exposure")
        .and_then(Value::as_str)
        .context("eligible operation has no application exposure")?;
    Ok(OperationDescriptor {
        operation_name: operation.name.clone(),
        operation_id: operation.contract_operation_id.clone(),
        operation_id_status: operation.contract_operation_id_status.clone(),
        source_kind: operation.source_kind.clone(),
        target: operation.target.clone(),
        application_exposure: application_exposure.to_owned(),
        application: operation.application.clone(),
        client_facing: operation.client_facing,
        authorization: operation.authorization.clone(),
        input: operation.input.clone(),
        output: operation.output.clone(),
        schema: operation.schema.clone(),
        idempotency: operation.idempotency.clone(),
        codec: operation.codec.clone(),
        kind: operation.kind.clone(),
        evidence: operation.classification_evidence.clone(),
    })
}

fn resource_descriptor(resource: &IrResource) -> ResourceDescriptor {
    ResourceDescriptor {
        resource_name: resource.name.clone(),
        contract: resource.contract.clone(),
        query: resource.query.clone(),
        row: resource.row.clone(),
        scope: resource.scope.clone(),
        subscription: resource.subscription.clone(),
        source: resource.source.clone(),
    }
}

fn validate_result_policy(capability_key: &str, policy: &ResultPolicy) -> Result<()> {
    match policy {
        ResultPolicy::Direct { max_bytes } if *max_bytes == 0 => {
            bail!("capability {capability_key} direct result policy must allow bytes")
        }
        ResultPolicy::Dataset {
            max_rows,
            max_bytes,
        } if *max_rows == 0 || *max_bytes == 0 => {
            bail!("capability {capability_key} dataset result policy must allow rows and bytes")
        }
        ResultPolicy::AggregateFirst {
            allowed_shapes,
            max_output_rows,
        } if allowed_shapes.is_empty() || *max_output_rows == 0 => {
            bail!("capability {capability_key} aggregate-first policy is empty")
        }
        ResultPolicy::AggregateFirst { allowed_shapes, .. } => {
            let mut previous: Option<&str> = None;
            for shape in allowed_shapes {
                if shape.trim().is_empty() {
                    bail!("capability {capability_key} aggregate-first policy has an empty shape");
                }
                if previous.is_some_and(|value| value >= shape.as_str()) {
                    bail!(
                        "capability {capability_key} aggregate-first shapes must be sorted and unique"
                    );
                }
                previous = Some(shape);
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn render_artifact(artifact: &CapabilityArtifact) -> Result<(String, String)> {
    let json = serde_json::to_string_pretty(artifact)? + "\n";
    let hash = hex::encode(Sha256::digest(json.as_bytes()));
    Ok((json, format!("{hash}  {ARTIFACT_FILENAME}\n")))
}

fn valid_capability_key(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes[0].is_ascii_lowercase()
        && bytes.iter().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
        })
        && !value.ends_with(['.', '_', '-'])
        && !value.contains("..")
        && !value.contains("__")
        && !value.contains("--")
}

fn valid_git_object_id(value: &str) -> bool {
    matches!(value.len(), 40 | 64)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn valid_sha256(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|digest| {
        digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const IR: &str = r#"{
        "ir_version": 2,
        "source_commit": "0123456789012345678901234567890123456789",
        "source_dirty": false,
        "schema_hash": "sha256:0123456789012345678901234567890123456789012345678901234567890123",
        "operations": [{
            "name":"list_orders","contract_operation_id":"erp.list_orders","application":{"exposure":"session","name":"list_orders"},
            "authorization":{"status":"classified"},"client_facing":true,"classification_evidence":"orders.rs: reviewed",
            "codec":{"id":"spacetimedb-sats-json","status":"assigned","version":1},"contract_operation_id_status":"locked","idempotency":{"status":"classified","value":"idempotent"},
            "input":{"kind":"operation_parameters","parameter_positions":[1],"type_reference":"OrderFilter"},
            "kind":{"status":"classified","value":"command"},"output":{"kind":"unit","type_reference":null},
            "schema":{"name":"list_orders"},"source_kind":"reducer","target":{"kind":"spacetimedb_reducer","name":"list_orders"}
        }],
        "resources": [{
            "name":"sale-orders","contract":{},"query":{"authorization":"server-enforced","status":"classified","result_type_reference":"SaleOrder"},
            "row":{"type_reference":"SaleOrder"},"scope":{"kind":"organization"},"subscription":{"status":"not-client-facing"},"source":{"kind":"table","table_reference":"sale_order"}
        }]
    }"#;

    fn manifest(entry: &str) -> String {
        format!(r#"{{"version":1,"entries":[{entry}]}}"#)
    }

    #[test]
    fn empty_reviewed_manifest_is_deny_by_default() {
        let artifact = compile(IR, r#"{"version":1,"entries":[]}"#).expect("empty manifest");
        assert!(artifact.entries.is_empty());
        assert_eq!(artifact.source_ir.ir_version, 2);
    }

    #[test]
    fn accepted_entry_contains_canonical_operation_and_resource_shapes() {
        let manifest = r#"{
            "version": 1,
            "entries": [
                {"operation_id":"erp.list_orders","capability_key":"erp.read.orders","risk":"read_only","requires_confirmation":false,"result_policy":{"kind":"direct","max_bytes":4096},"review":{"reviewed_by":"reviewer","reviewed_at":"2026-09-13T00:00:00Z","evidence":"fixture review"}},
                {"resource":"sale-orders","capability_key":"erp.read.sale-orders","risk":"read_only","requires_confirmation":false,"result_policy":{"kind":"dataset","max_rows":100,"max_bytes":65536},"review":{"reviewed_by":"reviewer","reviewed_at":"2026-09-13T00:00:00Z","evidence":"fixture review"}}
            ]
        }"#;
        let artifact = compile(IR, manifest).expect("reviewed entries");
        let value = serde_json::to_value(artifact).expect("artifact JSON");
        let operation = &value["entries"][0]["operation"];
        assert_eq!(operation["operation_name"], "list_orders");
        assert_eq!(operation["operation_id"], "erp.list_orders");
        assert_eq!(operation["input"]["type_reference"], "OrderFilter");
        assert_eq!(operation["output"]["kind"], "unit");
        assert_eq!(operation["idempotency"]["value"], "idempotent");
        assert_eq!(operation["application_exposure"], "session");
        assert!(operation["evidence"].as_str().is_some());
        assert_eq!(
            value["entries"][1]["resource_descriptor"]["row"]["type_reference"],
            "SaleOrder"
        );

        // The review record travels with every entry.
        assert_eq!(value["entries"][0]["review"]["reviewed_by"], "reviewer");
        assert_eq!(
            value["entries"][0]["review"]["reviewed_at"],
            "2026-09-13T00:00:00Z"
        );

        // A resource read is advertisable; an operation is not yet.
        assert!(value["entries"][0]["tool"].is_null());
        let tool = &value["entries"][1]["tool"];
        assert_eq!(tool["name"], "erp_read_sale_orders");
        assert!(tool["description"]
            .as_str()
            .is_some_and(|text| text.contains("sale-orders") && text.contains("reviewer")));
        let schema = &tool["input_schema"];
        assert_eq!(schema["additionalProperties"], false);
        assert_eq!(schema["properties"]["max_rows"]["maximum"], 100);
        assert!(
            schema["properties"]["company_id"].is_null(),
            "an organization-scoped resource takes no company input"
        );
        assert!(
            schema["properties"]["organization_id"].is_null(),
            "tenant scope is never a model input"
        );
    }

    #[test]
    fn company_scoped_reads_accept_a_verified_company_input() {
        let ir = IR.replace(
            r#""scope":{"kind":"organization"}"#,
            r#""scope":{"kind":"organization_company"}"#,
        );
        let artifact = compile(
            &ir,
            &manifest(
                r#"{"resource":"sale-orders","capability_key":"erp.read.sale-orders","risk":"read_only","requires_confirmation":false,"result_policy":{"kind":"dataset","max_rows":25,"max_bytes":4096},"review":{"reviewed_by":"reviewer","reviewed_at":"2026-09-13T00:00:00Z","evidence":"fixture review"}}"#,
            ),
        )
        .expect("company-scoped entry");
        let value = serde_json::to_value(artifact).expect("artifact JSON");
        let schema = &value["entries"][0]["tool"]["input_schema"];
        assert_eq!(schema["properties"]["company_id"]["type"], "integer");
        assert_eq!(schema["properties"]["max_rows"]["maximum"], 25);
    }

    #[test]
    fn entries_require_an_accountable_review_record() {
        let cases = [
            r#""review":{"reviewed_by":"  ","reviewed_at":"2026-09-13T00:00:00Z","evidence":"e"}"#,
            r#""review":{"reviewed_by":"reviewer","reviewed_at":"2026-09-13T00:00:00Z","evidence":" "}"#,
            r#""review":{"reviewed_by":"reviewer","reviewed_at":"2026-09-13","evidence":"e"}"#,
            r#""review":{"reviewed_by":"reviewer","reviewed_at":"2026-09-13T00:00:00+02:00","evidence":"e"}"#,
        ];
        for review in cases {
            let entry = format!(
                r#"{{"resource":"sale-orders","capability_key":"erp.read.sale-orders","risk":"read_only","requires_confirmation":false,"result_policy":{{"kind":"dataset","max_rows":1,"max_bytes":1}},{review}}}"#
            );
            assert!(
                compile(IR, &manifest(&entry)).is_err(),
                "accepted an unreviewed entry: {review}"
            );
        }
        // A missing review record is rejected outright by the manifest schema.
        assert!(compile(
            IR,
            &manifest(
                r#"{"resource":"sale-orders","capability_key":"erp.read.sale-orders","risk":"read_only","requires_confirmation":false,"result_policy":{"kind":"dataset","max_rows":1,"max_bytes":1}}"#
            )
        )
        .is_err());
    }

    #[test]
    fn rejects_internal_denied_and_unauthorized_targets() {
        let denied = IR.replace(
            r#"{"exposure":"session","name":"list_orders"}"#,
            r#"{"exposure":"denied","name":"list_orders"}"#,
        );
        assert!(compile(
            &denied,
            &manifest(r#"{"operation_id":"erp.list_orders","capability_key":"erp.read.denied","risk":"read_only","requires_confirmation":false,"result_policy":{"kind":"direct","max_bytes":1},"review":{"reviewed_by":"reviewer","reviewed_at":"2026-09-13T00:00:00Z","evidence":"fixture review"}}"#),
        )
        .is_err());

        let internal = IR.replace(
            r#"{"status":"classified","value":"command"}"#,
            r#"{"status":"classified","value":"internal"}"#,
        );
        assert!(compile(
            &internal,
            &manifest(r#"{"operation_id":"erp.list_orders","capability_key":"erp.read.internal","risk":"read_only","requires_confirmation":false,"result_policy":{"kind":"direct","max_bytes":1},"review":{"reviewed_by":"reviewer","reviewed_at":"2026-09-13T00:00:00Z","evidence":"fixture review"}}"#),
        )
        .is_err());

        let unauthorized = IR.replace(
            r#""authorization":"server-enforced","status":"classified""#,
            r#""authorization":"caller","status":"classified""#,
        );
        assert!(compile(
            &unauthorized,
            &manifest(r#"{"resource":"sale-orders","capability_key":"erp.read.unauthorized","risk":"read_only","requires_confirmation":false,"result_policy":{"kind":"direct","max_bytes":1},"review":{"reviewed_by":"reviewer","reviewed_at":"2026-09-13T00:00:00Z","evidence":"fixture review"}}"#),
        )
        .is_err());
    }

    #[test]
    fn rejects_provenance_and_canonical_metadata_drift() {
        assert!(compile(
            &IR.replace("0123456789012345678901234567890123456789", "BAD"),
            r#"{"version":1,"entries":[]}"#,
        )
        .is_err());
        assert!(compile(
            &IR.replace(
                "sha256:0123456789012345678901234567890123456789012345678901234567890123",
                "sha256:BAD"
            ),
            r#"{"version":1,"entries":[]}"#,
        )
        .is_err());
        assert!(compile(
            &IR.replace(
                r#""classification_evidence":"orders.rs: reviewed""#,
                r#""classification_evidence":""#,
            ),
            r#"{"version":1,"entries":[]}"#,
        )
        .is_err());
    }

    #[test]
    fn rejects_unknown_duplicate_unsorted_and_unsafe_entries() {
        assert!(compile(IR, r#"{"version":1,"entries":[],"unexpected":true}"#).is_err());
        let duplicate = r#"{"operation_id":"erp.list_orders","capability_key":"erp.read.orders","risk":"read_only","requires_confirmation":false,"result_policy":{"kind":"direct","max_bytes":1},"review":{"reviewed_by":"reviewer","reviewed_at":"2026-09-13T00:00:00Z","evidence":"fixture review"}}"#;
        assert!(compile(
            IR,
            &format!(r#"{{"version":1,"entries":[{duplicate},{duplicate}]}}"#),
        )
        .is_err());
        let unsorted_shapes = manifest(
            r#"{"operation_id":"erp.list_orders","capability_key":"erp.read.orders","risk":"read_only","requires_confirmation":false,"result_policy":{"kind":"aggregate_first","allowed_shapes":["z","a"],"max_output_rows":1},"review":{"reviewed_by":"reviewer","reviewed_at":"2026-09-13T00:00:00Z","evidence":"fixture review"}}"#,
        );
        assert!(compile(IR, &unsorted_shapes).is_err());
        let business_without_confirmation = manifest(
            r#"{"operation_id":"erp.list_orders","capability_key":"erp.mutate.orders","risk":"business_mutation","requires_confirmation":false,"result_policy":{"kind":"direct","max_bytes":1},"review":{"reviewed_by":"reviewer","reviewed_at":"2026-09-13T00:00:00Z","evidence":"fixture review"}}"#,
        );
        assert!(compile(IR, &business_without_confirmation).is_err());
        let financial_without_confirmation = manifest(
            r#"{"operation_id":"erp.list_orders","capability_key":"erp.finance.orders","risk":"financial_mutation","requires_confirmation":false,"result_policy":{"kind":"direct","max_bytes":1},"review":{"reviewed_by":"reviewer","reviewed_at":"2026-09-13T00:00:00Z","evidence":"fixture review"}}"#,
        );
        assert!(compile(IR, &financial_without_confirmation).is_err());
        let draft_without_confirmation = manifest(
            r#"{"operation_id":"erp.list_orders","capability_key":"erp.draft.orders","risk":"draft","requires_confirmation":false,"result_policy":{"kind":"direct","max_bytes":1},"review":{"reviewed_by":"reviewer","reviewed_at":"2026-09-13T00:00:00Z","evidence":"fixture review"}}"#,
        );
        assert!(compile(IR, &draft_without_confirmation).is_err());
    }

    #[test]
    fn renders_checksum_sidecar_for_artifact() {
        let artifact = compile(IR, r#"{"version":1,"entries":[]}"#).expect("empty manifest");
        let (json, checksum) = render_artifact(&artifact).expect("render artifact");
        let expected = hex::encode(Sha256::digest(json.as_bytes()));
        assert_eq!(checksum, format!("{expected}  {ARTIFACT_FILENAME}\n"));
        assert!(json.contains("\"artifact_version\": 2"));
    }
}
