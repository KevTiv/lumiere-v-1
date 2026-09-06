//! Canonical, versioned IR exported for target-specific contract emitters.
//!
//! This is the repository boundary: Rust/STDB source is interpreted here.
//! Consumers receive a complete immutable JSON document and must not inspect
//! or clone mutable `lumiere-v-1` source while generating packages.

use crate::erp_org_sql::{parse_and_validate, SubscriptionQueryPolicy};
use crate::paths::Paths;
use crate::support::{read_to_string, write_file};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::process::Command;

const IR_VERSION: u32 = 2;
const IR_FILENAME: &str = "lumiere-contract-ir-v2.json";

struct BaseContract {
    operations: Vec<Value>,
    resources: Vec<NamedContract>,
    tables: Vec<Value>,
    types: Vec<IndexedType>,
}

#[derive(Debug, Serialize)]
struct ContractIr {
    ir_version: u32,
    source_commit: String,
    source_dirty: bool,
    schema_hash: String,
    operations: Vec<Value>,
    resources: Vec<Value>,
    tables: Vec<Value>,
    types: Vec<IndexedType>,
    persistence: Value,
}

#[derive(Debug, Serialize)]
struct SemanticContract<'a> {
    operations: &'a [Value],
    resources: &'a [Value],
    tables: &'a [Value],
    types: &'a [IndexedType],
    persistence: &'a Value,
}

#[derive(Debug, Serialize)]
struct NamedContract {
    name: String,
    contract: Value,
}

#[derive(Debug, Serialize)]
struct IndexedType {
    index: usize,
    names: Vec<String>,
    definition: Value,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct OperationIdentityManifest {
    schema_version: u32,
    operations: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct OperationClassificationManifest {
    version: u32,
    operations: BTreeMap<String, OperationClassification>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct OperationClassification {
    semantic_kind: String,
    client_facing: bool,
    idempotency: String,
    codec: OperationCodec,
    evidence: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct OperationCodec {
    id: String,
    version: u32,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ResourceScopeManifest {
    schema_version: u32,
    resources: BTreeMap<String, ResourceScopeMetadata>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ResourceScopeMetadata {
    kind: String,
    organization_field: String,
    company_field: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubscriptionCensus {
    schema_version: u32,
    entries: Vec<SubscriptionCensusEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubscriptionCensusEntry {
    resource: String,
    scope: String,
    delivery_mode: String,
    predicate_class: String,
    expected_cardinality: String,
    latency_class: String,
    update_fanout: String,
    source_class: String,
    reconnect_class: String,
    access_path: Value,
}

pub fn run(
    paths: &Paths,
    registry_text: &str,
    (source_commit, source_dirty): (String, bool),
) -> Result<()> {
    let module_schema: Value = serde_json::from_str(&read_to_string(&paths.module_schema_json)?)
        .with_context(|| format!("parse {}", paths.module_schema_json.display()))?;
    let reducer_manifest: Value =
        serde_json::from_str(&read_to_string(&paths.reducer_manifest_out)?)
            .with_context(|| format!("parse {}", paths.reducer_manifest_out.display()))?;

    let resources = parse_resources(registry_text)?;
    let resource_names = resources
        .iter()
        .map(|resource| resource.name.as_str())
        .collect();
    let invalidations = parse_invalidations(paths, &resource_names)?;
    let operations = merge_operations(&module_schema, &reducer_manifest, invalidations)?;
    let tables = sorted_values(&module_schema, "tables", table_sort_key)?;
    let types = indexed_types(&module_schema)?;
    let base = BaseContract {
        operations,
        resources,
        tables,
        types,
    };

    let row_types: BTreeMap<String, String> =
        serde_json::from_str(&read_to_string(&paths.query_resource_row_type_asset)?)
            .with_context(|| format!("parse {}", paths.query_resource_row_type_asset.display()))?;
    let identity_manifest: OperationIdentityManifest =
        serde_json::from_str(&read_to_string(&paths.contract_operation_ids_json)?)
            .with_context(|| format!("parse {}", paths.contract_operation_ids_json.display()))?;
    let operation_ids = locked_operation_ids(&base.operations, identity_manifest)?;
    let classifications =
        operation_classifications(&paths.operation_contracts_dir, &base.operations)?;
    let operations = v2_operations(&base.operations, &operation_ids, &classifications)?;
    let resource_scope_manifest: ResourceScopeManifest =
        serde_json::from_str(&read_to_string(&paths.resource_scope_metadata_json)?)
            .with_context(|| format!("parse {}", paths.resource_scope_metadata_json.display()))?;
    let subscription_census: SubscriptionCensus =
        serde_json::from_str(&read_to_string(&paths.subscription_census_json)?)
            .with_context(|| format!("parse {}", paths.subscription_census_json.display()))?;
    let subscription_query_policies = parse_and_validate(
        &read_to_string(&paths.subscription_query_policy_json)?,
        registry_text,
    )?;
    let resources = v2_resources(
        &base.resources,
        &row_types,
        &base.tables,
        &base.types,
        &operations,
        resource_scope_manifest,
        &subscription_census,
        &subscription_query_policies.resources,
    )?;
    let persistence = persistence_contract(paths)?;
    let semantic = SemanticContract {
        operations: &operations,
        resources: &resources,
        tables: &base.tables,
        types: &base.types,
        persistence: &persistence,
    };
    let ir = ContractIr {
        ir_version: IR_VERSION,
        source_commit,
        source_dirty,
        schema_hash: prefixed_sha256(&serde_json::to_vec(&semantic)?),
        operations,
        resources,
        tables: base.tables,
        types: base.types,
        persistence,
    };
    write_ir_artifact(
        &paths.contract_ir_out,
        &paths.contract_ir_checksum_out,
        IR_FILENAME,
        &ir,
    )?;
    println!("Wrote {}", paths.contract_ir_out.display());
    println!("Wrote {}", paths.contract_ir_checksum_out.display());
    Ok(())
}

fn persistence_contract(paths: &Paths) -> Result<Value> {
    let storage: Value = serde_json::from_str(&read_to_string(&paths.storage_policy_manifest_out)?)
        .context("parse generated storage-policy-manifest.json")?;
    let archive: Value = serde_json::from_str(&read_to_string(&paths.archive_manifest_out)?)
        .context("parse generated archive-manifest.json")?;
    let codec: Value = serde_json::from_str(&read_to_string(&paths.codec_manifest_out)?)
        .context("parse generated codec-manifest.json")?;
    let projection: Value =
        serde_json::from_str(&read_to_string(&paths.projection_codec_manifest_out)?)
            .context("parse generated projection-codec-manifest.json")?;
    let reads: Value = serde_json::from_str(&read_to_string(&paths.read_descriptor_manifest_out)?)
        .context("parse generated read-plan-descriptors.json")?;
    Ok(serde_json::json!({
        "schema_version": 1,
        "authority": {
            "business_logic": "spacetimedb_reducers",
            "business_system_of_record": "spacetimedb",
            "postgresql_role": "derived_projection",
            "direct_postgresql_business_writes": "forbidden",
            "projection_finalization": "spacetimedb_reducer"
        },
        "commit_stream": {
            "envelope_table": "organization_commit",
            "row_change_table": "organization_row_change",
            "sequence_scope": "organization_id",
            "sequence_order": "strictly_monotonic",
            "transaction_boundary": "spacetimedb_reducer",
            "contract_version": "ir-v2",
            "row_order": "reducer_declared_dependency_safe",
            "upsert_payload": "canonical_full_row_json",
            "delete_payload": "durable_identity_tombstone",
            "checksum": {
                "algorithm": "sha256",
                "row_preimage": "table_newline_identity_newline_kind_newline_row",
                "commit_preimage": "length_prefixed_envelope_fields_then_row_checksums"
            },
            "audit_relation": "separate_schema_not_reconstruction_source"
        },
        "storage": storage,
        "reads": reads,
        "postgresql": {
            "archive": archive,
            "codec": codec,
            "projection": projection
        }
    }))
}

fn write_ir_artifact<T: Serialize>(
    output: &std::path::Path,
    checksum_output: &std::path::Path,
    filename: &str,
    value: &T,
) -> Result<()> {
    let json = serde_json::to_string_pretty(value)? + "\n";
    let artifact_hash = hex::encode(Sha256::digest(json.as_bytes()));
    write_file(output, &json)?;
    write_file(checksum_output, &format!("{artifact_hash}  {filename}\n"))?;
    Ok(())
}

fn locked_operation_ids(
    operations: &[Value],
    manifest: OperationIdentityManifest,
) -> Result<BTreeMap<String, String>> {
    if manifest.schema_version != 1 {
        bail!(
            "contract operation identity manifest has unsupported schema_version {}",
            manifest.schema_version
        );
    }
    let operation_names = operations
        .iter()
        .map(|operation| value_name(operation, "operation").map(str::to_owned))
        .collect::<Result<std::collections::BTreeSet<_>>>()?;
    let manifest_names = manifest
        .operations
        .keys()
        .cloned()
        .collect::<std::collections::BTreeSet<_>>();
    if operation_names != manifest_names {
        let missing = operation_names
            .difference(&manifest_names)
            .cloned()
            .collect::<Vec<_>>();
        let stale = manifest_names
            .difference(&operation_names)
            .cloned()
            .collect::<Vec<_>>();
        bail!(
            "contract operation identity manifest does not match operations; missing={missing:?}, stale={stale:?}"
        );
    }
    let mut ids = std::collections::BTreeSet::new();
    for (name, operation_id) in &manifest.operations {
        let Some(key) = operation_id.strip_prefix("erp.") else {
            bail!("operation {name} has invalid contract operation id {operation_id}");
        };
        if key.is_empty()
            || !key
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
        {
            bail!("operation {name} has invalid contract operation id {operation_id}");
        }
        if !ids.insert(operation_id.as_str()) {
            bail!("duplicate contract operation id {operation_id}");
        }
    }
    Ok(manifest.operations)
}

fn v2_operations(
    operations: &[Value],
    operation_ids: &BTreeMap<String, String>,
    classifications: &BTreeMap<String, OperationClassification>,
) -> Result<Vec<Value>> {
    operations
        .iter()
        .map(|operation| {
            let name = value_name(operation, "operation")?;
            let source_kind = operation
                .get("kind")
                .and_then(Value::as_str)
                .context("operation kind must be a string")?;
            let (target_kind, output_kind) = match source_kind {
                "reducer" => ("spacetimedb_reducer", "unit"),
                "view" => ("spacetimedb_view", "unresolved"),
                "procedure" => ("spacetimedb_procedure", "unresolved"),
                other => bail!("operation {name} has unsupported source kind {other}"),
            };
            let application = operation.get("application").cloned().unwrap_or(Value::Null);
            let schema = operation
                .get("schema")
                .cloned()
                .context("operation schema is required")?;
            let invalidates = operation
                .get("invalidates")
                .cloned()
                .unwrap_or_else(|| serde_json::json!([]));
            let input = v2_operation_input(name, &application)?;
            let operation_id = operation_ids
                .get(name)
                .with_context(|| format!("operation {name} has no locked contract operation id"))?;
            let classification = classifications
                .get(name)
                .with_context(|| format!("operation {name} has no authored contract classification"))?;
            let application_exposure = application
                .get("exposure")
                .and_then(Value::as_str)
                .unwrap_or("denied");
            let expected_client_facing = application_exposure == "session";
            if classification.client_facing != expected_client_facing {
                bail!(
                    "operation {name} client_facing={} conflicts with authored exposure {application_exposure}",
                    classification.client_facing
                );
            }
            let authorization_scope = application.get("scope").cloned().unwrap_or(Value::Null);
            Ok(serde_json::json!({
                "application": application,
                "authorization": {
                    "scope": authorization_scope,
                    "status": "classified",
                },
                "client_facing": classification.client_facing,
                "classification_evidence": classification.evidence,
                "codec": {
                    "id": classification.codec.id,
                    "status": "assigned",
                    "version": classification.codec.version,
                },
                "contract_operation_id": operation_id,
                "contract_operation_id_status": "locked",
                "idempotency": {
                    "status": "classified",
                    "value": classification.idempotency,
                },
                "input": input,
                "invalidates": invalidates,
                "kind": {
                    "status": "classified",
                    "value": classification.semantic_kind,
                },
                "name": name,
                "output": {
                    "kind": output_kind,
                    "type_reference": Value::Null,
                },
                "schema": schema,
                "source_kind": source_kind,
                "target": {
                    "kind": target_kind,
                    "name": name,
                },
            }))
        })
        .collect()
}

fn operation_classifications(
    directory: &std::path::Path,
    operations: &[Value],
) -> Result<BTreeMap<String, OperationClassification>> {
    let mut paths = fs::read_dir(directory)
        .with_context(|| format!("read operation classifications {}", directory.display()))?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<std::io::Result<Vec<_>>>()?;
    paths.retain(|path| path.extension().and_then(|value| value.to_str()) == Some("json"));
    paths.sort();
    if paths.is_empty() {
        bail!(
            "operation classification directory is empty: {}",
            directory.display()
        );
    }

    let operation_names = operations
        .iter()
        .map(|operation| value_name(operation, "operation").map(str::to_owned))
        .collect::<Result<BTreeSet<_>>>()?;
    let mut classifications = BTreeMap::new();
    for path in paths {
        let manifest: OperationClassificationManifest =
            serde_json::from_str(&read_to_string(&path)?)
                .with_context(|| format!("parse {}", path.display()))?;
        if manifest.version != 1 {
            bail!(
                "{} has unsupported version {}",
                path.display(),
                manifest.version
            );
        }
        for (name, classification) in manifest.operations {
            validate_operation_classification(&name, &classification)?;
            if classifications
                .insert(name.clone(), classification)
                .is_some()
            {
                bail!("operation {name} is classified by more than one shard");
            }
        }
    }

    let classified_names = classifications.keys().cloned().collect::<BTreeSet<_>>();
    if operation_names != classified_names {
        let missing = operation_names
            .difference(&classified_names)
            .take(20)
            .cloned()
            .collect::<Vec<_>>();
        let stale = classified_names
            .difference(&operation_names)
            .take(20)
            .cloned()
            .collect::<Vec<_>>();
        bail!(
            "operation classifications do not match operations; missing(first 20)={missing:?}, stale(first 20)={stale:?}"
        );
    }
    Ok(classifications)
}

fn validate_operation_classification(
    name: &str,
    classification: &OperationClassification,
) -> Result<()> {
    if !matches!(
        classification.semantic_kind.as_str(),
        "command" | "operator" | "test" | "internal"
    ) {
        bail!(
            "operation {name} has invalid semantic kind {}",
            classification.semantic_kind
        );
    }
    if !matches!(
        classification.idempotency.as_str(),
        "idempotent" | "request_guarded" | "state_guarded" | "non_idempotent" | "not_applicable"
    ) {
        bail!(
            "operation {name} has invalid idempotency {}",
            classification.idempotency
        );
    }
    if classification.codec.id != "spacetimedb-sats-json" || classification.codec.version != 1 {
        bail!("operation {name} must use spacetimedb-sats-json codec version 1");
    }
    if classification.evidence.trim().is_empty() {
        bail!("operation {name} classification evidence is empty");
    }
    Ok(())
}

fn v2_operation_input(operation_name: &str, application: &Value) -> Result<Value> {
    let Some(application) = application.as_object() else {
        return Ok(serde_json::json!({
            "kind": "unresolved",
            "parameter_positions": [],
            "type_reference": Value::Null,
        }));
    };
    let params = application
        .get("params")
        .and_then(Value::as_array)
        .with_context(|| {
            format!("operation {operation_name} application params must be an array")
        })?;
    let fields = application
        .get("client_input")
        .and_then(|value| value.get("fields"))
        .and_then(Value::as_array)
        .with_context(|| {
            format!("operation {operation_name} client_input.fields must be an array")
        })?;
    let mut positions = Vec::with_capacity(fields.len());
    for field in fields {
        let position = field
            .get("parameter_position")
            .and_then(Value::as_u64)
            .with_context(|| {
                format!("operation {operation_name} client field has no parameter_position")
            })? as usize;
        if position >= params.len() {
            bail!("operation {operation_name} client field position {position} is out of range");
        }
        if positions.contains(&position) {
            bail!("operation {operation_name} repeats client field position {position}");
        }
        positions.push(position);
    }
    let type_reference = if positions.len() == 1 {
        params[positions[0]]
            .get("ref_target")
            .and_then(Value::as_str)
            .map(Value::from)
            .unwrap_or(Value::Null)
    } else {
        Value::Null
    };
    Ok(serde_json::json!({
        "kind": "operation_parameters",
        "parameter_positions": positions,
        "type_reference": type_reference,
    }))
}

fn v2_resources(
    resources: &[NamedContract],
    row_types: &BTreeMap<String, String>,
    tables: &[Value],
    types: &[IndexedType],
    operations: &[Value],
    scope_manifest: ResourceScopeManifest,
    subscription_census: &SubscriptionCensus,
    subscription_query_policies: &BTreeMap<String, SubscriptionQueryPolicy>,
) -> Result<Vec<Value>> {
    if scope_manifest.schema_version != 1 {
        bail!(
            "resource scope manifest has unsupported schema_version {}",
            scope_manifest.schema_version
        );
    }
    let resource_names = resources
        .iter()
        .map(|resource| resource.name.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    for (name, scope) in &scope_manifest.resources {
        if !resource_names.contains(name.as_str()) {
            bail!("resource scope manifest references unknown resource {name}");
        }
        if scope.kind != "organization_optional_company" {
            bail!("resource {name} has unsupported scope kind {}", scope.kind);
        }
        if scope.organization_field.is_empty() || scope.company_field.is_empty() {
            bail!("resource {name} scope fields must not be empty");
        }
    }
    if subscription_census.schema_version != 1 {
        bail!(
            "subscription census has unsupported schema version {}",
            subscription_census.schema_version
        );
    }
    let mut subscriptions = BTreeMap::new();
    let virtual_subscription_resources = [
        "auth",
        "auth-role-table",
        "org-permissions",
        "policy-snapshots",
    ]
    .into_iter()
    .collect::<BTreeSet<_>>();
    for entry in &subscription_census.entries {
        if !resource_names.contains(entry.resource.as_str())
            && !virtual_subscription_resources.contains(entry.resource.as_str())
        {
            bail!(
                "subscription census references unknown resource {}",
                entry.resource
            );
        }
        if subscriptions
            .insert(entry.resource.as_str(), entry)
            .is_some()
        {
            bail!("subscription census repeats resource {}", entry.resource);
        }
    }
    for resource in subscription_query_policies.keys() {
        if !resource_names.contains(resource.as_str()) {
            bail!("subscription query policy references unknown resource {resource}");
        }
    }
    let row_type_names = types
        .iter()
        .flat_map(|item| item.names.iter().map(String::as_str))
        .collect::<std::collections::BTreeSet<_>>();
    let type_names_by_index = types
        .iter()
        .map(|item| (item.index, item.names.as_slice()))
        .collect::<BTreeMap<_, _>>();
    let mut table_row_types = BTreeMap::new();
    for table in tables {
        let table_name = table
            .get("name")
            .and_then(Value::as_str)
            .context("table has no name")?;
        let type_index = table
            .get("product_type_ref")
            .and_then(Value::as_u64)
            .with_context(|| format!("table {table_name} has no product_type_ref"))?
            as usize;
        let names = type_names_by_index
            .get(&type_index)
            .with_context(|| format!("table {table_name} references unknown type {type_index}"))?;
        if names.len() != 1 {
            bail!("table {table_name} must resolve to exactly one named row type");
        }
        table_row_types.insert(table_name, names[0].as_str());
    }
    let mut invalidated_by: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for operation in operations {
        let operation_name = value_name(operation, "operation")?;
        let operation_id = operation
            .get("contract_operation_id")
            .and_then(Value::as_str)
            .with_context(|| format!("operation {operation_name} has no contract_operation_id"))?;
        for resource in operation
            .get("invalidates")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let resource = resource.as_str().with_context(|| {
                format!("operation {operation_name} invalidation must be a string")
            })?;
            invalidated_by
                .entry(resource)
                .or_default()
                .push(operation_id);
        }
    }

    resources
        .iter()
        .map(|resource| {
            let table = resource
                .contract
                .get("table")
                .and_then(Value::as_str)
                .with_context(|| format!("resource {} has no source table", resource.name))?;
            let derived_row_type = table_row_types.get(table).copied();
            let row_type = row_types
                .get(&resource.name)
                .map(String::as_str)
                .or(derived_row_type)
                .with_context(|| format!("resource {} has no row type", resource.name))?;
            if !row_type_names.contains(row_type) {
                bail!(
                    "resource {} references unknown row type {row_type}",
                    resource.name
                );
            }
            if let Some(derived_row_type) = derived_row_type {
                if derived_row_type != row_type {
                    bail!(
                        "resource {} row type {row_type} does not match table row type {derived_row_type}",
                        resource.name
                    );
                }
            }
            let mut writers = invalidated_by.remove(resource.name.as_str()).unwrap_or_default();
            writers.sort_unstable();
            let subscription = subscriptions.get(resource.name.as_str()).copied();
            let query_plan = subscription_query_policies
                .get(&resource.name)
                .map(serde_json::to_value)
                .transpose()
                .context("serialize subscription query plan")?;
            let ownership_fields = resource
                .contract
                .get("mandatory")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .chain(
                    resource
                        .contract
                        .get("default_restricted")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten(),
                )
                .filter_map(Value::as_str)
                .collect::<BTreeSet<_>>();
            let has_organization = ownership_fields.contains("organization_id");
            let company_field = ownership_fields.iter().find(|field| {
                matches!(
                    **field,
                    "company_id"
                        | "company_ids"
                        | "source_company_id"
                        | "destination_company_id"
                        | "origin_company_id"
                )
            });
            let has_company = company_field.is_some();
            let scope = if let Some(scope) = scope_manifest.resources.get(&resource.name) {
                serde_json::json!({
                    "company_field": scope.company_field,
                    "kind": scope.kind,
                    "organization_field": scope.organization_field,
                })
            } else if let Some(subscription) = subscription {
                serde_json::json!({
                    "company_field": company_field.map_or(Value::Null, |field| Value::String((*field).to_owned())),
                    "identity_field": if subscription.scope.contains("identity") { Value::String("trusted_identity".to_owned()) } else { Value::Null },
                    "kind": subscription.scope.replace('+', "_"),
                    "organization_field": if has_organization { Value::String("organization_id".to_owned()) } else { Value::Null },
                    "resolution": if subscription.scope == "global" { "global" } else if subscription.scope == "identity" { "trusted_context" } else if has_organization && (!subscription.scope.contains("company") || has_company) { "direct" } else { "server_parent_or_context" },
                    "source": "subscription_census",
                })
            } else {
                serde_json::json!({
                    "company_field": company_field.map_or(Value::Null, |field| Value::String((*field).to_owned())),
                    "identity_field": Value::Null,
                    "kind": match (has_organization, has_company) {
                        (true, true) => "organization_company",
                        (true, false) => "organization",
                        (false, true) => "organization_via_company",
                        (false, false) => "organization_via_parent",
                    },
                    "organization_field": if has_organization { Value::String("organization_id".to_owned()) } else { Value::Null },
                    "resolution": if has_organization { "direct" } else { "server_parent_or_context" },
                    "source": "resource_registry",
                })
            };
            let subscription_contract = subscription.map_or_else(
                || serde_json::json!({
                    "delivery_mode": "bff-only",
                    "query_plan": query_plan,
                    "realtime": false,
                    "status": "not-client-facing",
                }),
                |entry| serde_json::json!({
                    "access_path": entry.access_path,
                    "delivery_mode": entry.delivery_mode,
                    "expected_cardinality": entry.expected_cardinality,
                    "latency_class": entry.latency_class,
                    "predicate_class": entry.predicate_class,
                    "query_plan": query_plan,
                    "realtime": entry.delivery_mode != "bff-only",
                    "reconnect_class": entry.reconnect_class,
                    "source_class": entry.source_class,
                    "status": "classified",
                    "update_fanout": entry.update_fanout,
                }),
            );
            Ok(serde_json::json!({
                "contract": resource.contract,
                "invalidated_by": writers,
                "name": resource.name,
                "query": {
                    "authorization": "server-enforced",
                    "cursor_type_reference": Value::Null,
                    "filter_type_reference": Value::Null,
                    "input_type_reference": Value::Null,
                    "result_type_reference": row_type,
                    "status": "classified",
                },
                "row": {
                    "type_reference": row_type,
                },
                "scope": scope,
                "subscription": subscription_contract,
                "source": {
                    "kind": if derived_row_type.is_some() { "table" } else { "unresolved" },
                    "table_reference": table,
                },
            }))
        })
        .collect()
}

fn merge_operations(
    module_schema: &Value,
    reducer_manifest: &Value,
    mut invalidations: BTreeMap<String, Vec<String>>,
) -> Result<Vec<Value>> {
    let raw_reducers = module_schema
        .get("reducers")
        .and_then(Value::as_array)
        .context("module schema reducers must be an array")?;
    let contracts = reducer_manifest
        .get("reducers")
        .and_then(Value::as_array)
        .context("reducer manifest reducers must be an array")?;
    let mut raw_by_name = BTreeMap::new();
    for reducer in raw_reducers {
        let name = value_name(reducer, "reducer")?;
        if raw_by_name
            .insert(name.to_owned(), reducer.clone())
            .is_some()
        {
            bail!("duplicate module reducer {name}");
        }
    }

    let mut operations = Vec::with_capacity(contracts.len());
    for contract in contracts {
        let name = value_name(contract, "reducer contract")?;
        let schema = raw_by_name
            .remove(name)
            .with_context(|| format!("reducer contract {name} has no module schema entry"))?;
        let invalidates = invalidations.remove(name).unwrap_or_default();
        operations.push(serde_json::json!({
            "name": name,
            "kind": "reducer",
            "application": contract,
            "invalidates": invalidates,
            "schema": schema,
        }));
    }
    if !raw_by_name.is_empty() {
        bail!(
            "module reducers missing contracts: {}",
            raw_by_name.keys().cloned().collect::<Vec<_>>().join(", ")
        );
    }
    append_misc_operations(module_schema, &mut operations, &mut invalidations)?;
    if !invalidations.is_empty() {
        bail!(
            "invalidation metadata names missing operations: {}",
            invalidations.keys().cloned().collect::<Vec<_>>().join(", ")
        );
    }
    operations.sort_by(|left, right| operation_name(left).cmp(operation_name(right)));
    Ok(operations)
}

fn append_misc_operations(
    module_schema: &Value,
    operations: &mut Vec<Value>,
    invalidations: &mut BTreeMap<String, Vec<String>>,
) -> Result<()> {
    let mut names = operations
        .iter()
        .map(|operation| operation_name(operation).to_owned())
        .collect::<std::collections::BTreeSet<_>>();
    for export in module_schema
        .get("misc_exports")
        .and_then(Value::as_array)
        .context("module schema misc_exports must be an array")?
    {
        let Some((variant, schema)) = export
            .as_object()
            .and_then(|object| (object.len() == 1).then(|| object.iter().next()).flatten())
        else {
            bail!("module schema misc export must have exactly one variant");
        };
        let kind = match variant.as_str() {
            "Procedure" => "procedure",
            "View" => "view",
            _ => continue,
        };
        let name = value_name(schema, kind)?;
        if !names.insert(name.to_owned()) {
            bail!("duplicate module operation {name}");
        }
        operations.push(serde_json::json!({
            "name": name,
            "kind": kind,
            "application": null,
            "invalidates": invalidations.remove(name).unwrap_or_default(),
            "schema": schema,
        }));
    }
    Ok(())
}

fn parse_invalidations(
    paths: &Paths,
    resource_names: &std::collections::BTreeSet<&str>,
) -> Result<BTreeMap<String, Vec<String>>> {
    let mut invalidations: BTreeMap<String, Vec<String>> =
        serde_json::from_str(&read_to_string(&paths.reducer_stdb_invalidation_json)?)
            .with_context(|| format!("parse {}", paths.reducer_stdb_invalidation_json.display()))?;
    for (operation, resources) in &mut invalidations {
        resources.sort();
        if resources.windows(2).any(|pair| pair[0] == pair[1]) {
            bail!("operation {operation} contains a duplicate invalidated resource");
        }
        for resource in resources {
            if !resource_names.contains(resource.as_str()) {
                bail!("operation {operation} invalidates unknown resource {resource}");
            }
        }
    }
    Ok(invalidations)
}

fn parse_resources(registry_text: &str) -> Result<Vec<NamedContract>> {
    let registry: BTreeMap<String, Value> =
        serde_json::from_str(registry_text).context("parse resource registry")?;
    Ok(registry
        .into_iter()
        .map(|(name, contract)| NamedContract { name, contract })
        .collect())
}

fn indexed_types(module_schema: &Value) -> Result<Vec<IndexedType>> {
    let definitions = module_schema
        .pointer("/typespace/types")
        .and_then(Value::as_array)
        .context("module schema typespace.types must be an array")?;
    let mut names_by_index: BTreeMap<usize, Vec<String>> = BTreeMap::new();
    for named_type in module_schema
        .get("types")
        .and_then(Value::as_array)
        .context("module schema types must be an array")?
    {
        let index = named_type
            .get("ty")
            .and_then(Value::as_u64)
            .context("named module type has no numeric ty")? as usize;
        if index >= definitions.len() {
            bail!("named module type references missing typespace index {index}");
        }
        let name = named_type
            .pointer("/name/name")
            .and_then(Value::as_str)
            .context("named module type has no name.name")?;
        names_by_index
            .entry(index)
            .or_default()
            .push(name.to_owned());
    }

    Ok(definitions
        .iter()
        .enumerate()
        .map(|(index, definition)| {
            let mut names = names_by_index.remove(&index).unwrap_or_default();
            names.sort();
            IndexedType {
                index,
                names,
                definition: definition.clone(),
            }
        })
        .collect())
}

fn sorted_values(root: &Value, field: &str, key: fn(&Value) -> &str) -> Result<Vec<Value>> {
    let mut values = root
        .get(field)
        .and_then(Value::as_array)
        .with_context(|| format!("module schema {field} must be an array"))?
        .clone();
    values.sort_by(|left, right| key(left).cmp(key(right)));
    Ok(values)
}

fn table_sort_key(value: &Value) -> &str {
    value.get("name").and_then(Value::as_str).unwrap_or("")
}

fn operation_name(value: &Value) -> &str {
    value.get("name").and_then(Value::as_str).unwrap_or("")
}

fn value_name<'a>(value: &'a Value, label: &str) -> Result<&'a str> {
    value
        .get("name")
        .and_then(Value::as_str)
        .with_context(|| format!("{label} has no name"))
}

fn prefixed_sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

pub(crate) fn source_provenance() -> Result<(String, bool)> {
    if let Ok(commit) = std::env::var("LUMIERE_SOURCE_COMMIT") {
        let commit = commit.trim();
        if !is_git_object_id(commit) {
            bail!("LUMIERE_SOURCE_COMMIT must be a 40- or 64-character lowercase hex object ID");
        }
        let dirty = std::env::var("LUMIERE_SOURCE_DIRTY").is_ok_and(|value| value == "1");
        return Ok((commit.to_owned(), dirty));
    }

    let commit = git_output(&["rev-parse", "HEAD"])?;
    if !is_git_object_id(&commit) {
        bail!("git rev-parse returned an invalid object ID: {commit}");
    }
    let status = git_output(&[
        "status",
        "--porcelain",
        "--untracked-files=normal",
        "--",
        "spacetimedb",
        "lumiere-codegen",
        "crates/stdb-auth/assets/resource_registry.json",
    ])?;
    Ok((commit, !status.is_empty()))
}

fn is_git_object_id(value: &str) -> bool {
    matches!(value.len(), 40 | 64)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn git_output(args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .args(args)
        .output()
        .with_context(|| format!("run git {}", args.join(" ")))?;
    if !output.status.success() {
        bail!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8(output.stdout)
        .context("git output was not UTF-8")?
        .trim()
        .to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semantic_hash_ignores_provenance() {
        let resources = vec![serde_json::json!({
            "name": "orders",
            "contract": {"table": "sale_order"}
        })];
        let persistence = serde_json::json!({});
        let semantic = SemanticContract {
            operations: &[],
            resources: &resources,
            tables: &[],
            types: &[],
            persistence: &persistence,
        };
        let first = prefixed_sha256(&serde_json::to_vec(&semantic).unwrap());
        let second = prefixed_sha256(&serde_json::to_vec(&semantic).unwrap());
        assert_eq!(first, second);
    }

    #[test]
    fn rejects_operation_sets_that_do_not_match() {
        let schema = serde_json::json!({"reducers": [{"name": "create_order"}]});
        let manifest = serde_json::json!({"reducers": [{"name": "cancel_order"}]});
        assert!(merge_operations(&schema, &manifest, BTreeMap::new()).is_err());
    }

    #[test]
    fn retains_unnamed_typespace_entries() {
        let schema = serde_json::json!({
            "types": [{"name": {"name": "Order"}, "ty": 1}],
            "typespace": {"types": [{"U64": []}, {"Product": {"elements": []}}]}
        });
        let types = indexed_types(&schema).unwrap();
        assert_eq!(types.len(), 2);
        assert!(types[0].names.is_empty());
        assert_eq!(types[1].names, ["Order"]);
    }

    #[test]
    fn includes_v9_procedures_as_unannotated_operations() {
        let schema = serde_json::json!({
            "reducers": [],
            "misc_exports": [{
                "Procedure": {"name": "fetch_exchange_rate", "params": {"elements": []}}
            }]
        });
        let manifest = serde_json::json!({"reducers": []});
        let operations = merge_operations(&schema, &manifest, BTreeMap::new()).unwrap();
        assert_eq!(operations[0]["kind"], "procedure");
        assert!(operations[0]["application"].is_null());
    }

    #[test]
    fn v2_operation_adds_stable_target_and_explicit_policy_states() {
        let operation = serde_json::json!({
            "name": "create_order",
            "kind": "reducer",
            "application": {
                "name": "create_order",
                "exposure": "session",
                "scope": {"organization": {"parameter": "organization_id", "position": 0}},
                "params": [
                    {"name": "organization_id", "kind": "u64"},
                    {"name": "params", "kind": "ref", "ref_target": "CreateOrderParams"}
                ],
                "client_input": {"fields": [{"parameter_position": 1}]}
            },
            "invalidates": ["orders"],
            "schema": {"name": "create_order"}
        });
        let operation_ids =
            BTreeMap::from([("create_order".to_owned(), "erp.create_order".to_owned())]);
        let classifications = BTreeMap::from([(
            "create_order".to_owned(),
            OperationClassification {
                semantic_kind: "command".to_owned(),
                client_facing: true,
                idempotency: "non_idempotent".to_owned(),
                codec: OperationCodec {
                    id: "spacetimedb-sats-json".to_owned(),
                    version: 1,
                },
                evidence: "fixture classification".to_owned(),
            },
        )]);
        let operations = v2_operations(&[operation], &operation_ids, &classifications).unwrap();
        let operation = &operations[0];
        assert_eq!(operation["contract_operation_id"], "erp.create_order");
        assert_eq!(operation["contract_operation_id_status"], "locked");
        assert_eq!(operation["kind"]["status"], "classified");
        assert_eq!(operation["kind"]["value"], "command");
        assert_eq!(operation["source_kind"], "reducer");
        assert_eq!(operation["target"]["kind"], "spacetimedb_reducer");
        assert_eq!(operation["input"]["type_reference"], "CreateOrderParams");
        assert_eq!(operation["output"]["kind"], "unit");
        assert_eq!(operation["codec"]["status"], "assigned");
        assert_eq!(operation["codec"]["id"], "spacetimedb-sats-json");
        assert_eq!(operation["idempotency"]["status"], "classified");
        assert_eq!(operation["authorization"]["status"], "classified");
    }

    #[test]
    fn v2_operation_rejects_duplicate_client_positions() {
        let operation = serde_json::json!({
            "name": "create_order",
            "kind": "reducer",
            "application": {
                "name": "create_order",
                "params": [{"name": "params", "kind": "u64"}],
                "client_input": {
                    "fields": [
                        {"parameter_position": 0},
                        {"parameter_position": 0}
                    ]
                }
            },
            "schema": {"name": "create_order"}
        });
        let operation_ids =
            BTreeMap::from([("create_order".to_owned(), "erp.create_order".to_owned())]);
        let error = v2_operations(&[operation], &operation_ids, &BTreeMap::new())
            .expect_err("duplicate positions must fail");
        assert!(error
            .to_string()
            .contains("repeats client field position 0"));
    }

    #[test]
    fn operation_identity_manifest_must_exactly_cover_operations() {
        let operations = vec![serde_json::json!({"name": "create_order"})];
        let manifest = OperationIdentityManifest {
            schema_version: 1,
            operations: BTreeMap::from([("stale_order".to_owned(), "erp.stale_order".to_owned())]),
        };
        let error = locked_operation_ids(&operations, manifest)
            .expect_err("missing and stale identity entries must fail");
        assert!(error.to_string().contains("missing=[\"create_order\"]"));
        assert!(error.to_string().contains("stale=[\"stale_order\"]"));
    }

    #[test]
    fn operation_classification_requires_exact_census() {
        let root = std::env::temp_dir().join(format!(
            "lumiere-operation-classifications-{}",
            std::process::id()
        ));
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("core.json"),
            r#"{
              "version": 1,
              "operations": {
                "create_order": {
                  "semantic_kind": "command",
                  "client_facing": true,
                  "idempotency": "non_idempotent",
                  "codec": {"id": "spacetimedb-sats-json", "version": 1},
                  "evidence": "reviewed reducer body"
                }
              }
            }"#,
        )
        .unwrap();
        let operations = vec![serde_json::json!({"name": "create_order"})];
        let classifications = operation_classifications(&root, &operations).unwrap();
        assert_eq!(classifications.len(), 1);

        let missing = vec![
            serde_json::json!({"name": "create_order"}),
            serde_json::json!({"name": "cancel_order"}),
        ];
        let error = operation_classifications(&root, &missing).unwrap_err();
        assert!(error.to_string().contains("cancel_order"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn operation_classification_rejects_invalid_policy() {
        let classification = OperationClassification {
            semantic_kind: "mutation-ish".to_owned(),
            client_facing: true,
            idempotency: "probably".to_owned(),
            codec: OperationCodec {
                id: "ad-hoc-json".to_owned(),
                version: 1,
            },
            evidence: String::new(),
        };
        let error = validate_operation_classification("create_order", &classification)
            .expect_err("unknown policy must fail closed");
        assert!(error.to_string().contains("semantic kind"));
    }

    #[test]
    fn operation_identity_manifest_accepts_locked_ids_and_explicit_renames() {
        let operations = vec![serde_json::json!({"name": "renamed_order"})];
        let manifest = OperationIdentityManifest {
            schema_version: 1,
            operations: BTreeMap::from([(
                "renamed_order".to_owned(),
                "erp.create_order".to_owned(),
            )]),
        };
        let ids = locked_operation_ids(&operations, manifest).unwrap();
        assert_eq!(ids["renamed_order"], "erp.create_order");
    }

    #[test]
    fn operation_identity_manifest_rejects_schema_and_id_format_drift() {
        let operations = vec![serde_json::json!({"name": "create_order"})];
        let unsupported = OperationIdentityManifest {
            schema_version: 2,
            operations: BTreeMap::from([(
                "create_order".to_owned(),
                "erp.create_order".to_owned(),
            )]),
        };
        assert!(locked_operation_ids(&operations, unsupported)
            .expect_err("unsupported manifest schema must fail")
            .to_string()
            .contains("unsupported schema_version 2"));

        let malformed = OperationIdentityManifest {
            schema_version: 1,
            operations: BTreeMap::from([(
                "create_order".to_owned(),
                "erp.Create-Order".to_owned(),
            )]),
        };
        assert!(locked_operation_ids(&operations, malformed)
            .expect_err("malformed IDs must fail")
            .to_string()
            .contains("invalid contract operation id erp.Create-Order"));
    }

    #[test]
    fn operation_identity_manifest_rejects_unknown_fields() {
        let error = serde_json::from_value::<OperationIdentityManifest>(serde_json::json!({
            "schema_version": 1,
            "operations": {},
            "unexpected": true
        }))
        .expect_err("unknown manifest fields must fail");
        assert!(error.to_string().contains("unknown field `unexpected`"));
    }

    #[test]
    fn operation_identity_manifest_rejects_duplicate_ids() {
        let operations = vec![
            serde_json::json!({"name": "create_order"}),
            serde_json::json!({"name": "update_order"}),
        ];
        let manifest = OperationIdentityManifest {
            schema_version: 1,
            operations: BTreeMap::from([
                ("create_order".to_owned(), "erp.order".to_owned()),
                ("update_order".to_owned(), "erp.order".to_owned()),
            ]),
        };
        let error = locked_operation_ids(&operations, manifest)
            .expect_err("duplicate contract operation ids must fail");
        assert!(error
            .to_string()
            .contains("duplicate contract operation id erp.order"));
    }

    #[test]
    fn v2_resource_validates_row_and_table_references() {
        let resources = vec![NamedContract {
            name: "orders".to_owned(),
            contract: serde_json::json!({"table": "sale_order"}),
        }];
        let row_types = BTreeMap::from([("orders".to_owned(), "SaleOrder".to_owned())]);
        let tables = vec![serde_json::json!({"name": "sale_order", "product_type_ref": 0})];
        let types = vec![IndexedType {
            index: 0,
            names: vec!["SaleOrder".to_owned()],
            definition: serde_json::json!({"Product": {"elements": []}}),
        }];
        let operations = vec![serde_json::json!({
            "name": "create_order",
            "contract_operation_id": "erp.create_order",
            "invalidates": ["orders"]
        })];
        let output = v2_resources(
            &resources,
            &row_types,
            &tables,
            &types,
            &operations,
            ResourceScopeManifest {
                schema_version: 1,
                resources: BTreeMap::new(),
            },
            &SubscriptionCensus {
                schema_version: 1,
                entries: Vec::new(),
            },
            &BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(output[0]["row"]["type_reference"], "SaleOrder");
        assert_eq!(output[0]["source"]["table_reference"], "sale_order");
        assert_eq!(
            output[0]["invalidated_by"],
            serde_json::json!(["erp.create_order"])
        );
        assert_eq!(output[0]["scope"]["kind"], "organization_via_parent");
        assert_eq!(output[0]["query"]["status"], "classified");
    }

    #[test]
    fn v2_resource_rejects_unknown_row_types() {
        let resources = vec![NamedContract {
            name: "orders".to_owned(),
            contract: serde_json::json!({"table": "sale_order"}),
        }];
        let row_types = BTreeMap::from([("orders".to_owned(), "MissingRow".to_owned())]);
        let tables = vec![serde_json::json!({"name": "sale_order", "product_type_ref": 0})];
        let types = vec![IndexedType {
            index: 0,
            names: vec!["SaleOrder".to_owned()],
            definition: serde_json::json!({"Product": {"elements": []}}),
        }];
        let error = v2_resources(
            &resources,
            &row_types,
            &tables,
            &types,
            &[],
            ResourceScopeManifest {
                schema_version: 1,
                resources: BTreeMap::new(),
            },
            &SubscriptionCensus {
                schema_version: 1,
                entries: Vec::new(),
            },
            &BTreeMap::new(),
        )
        .expect_err("unknown row type must fail");
        assert!(error.to_string().contains("unknown row type MissingRow"));
    }

    #[test]
    fn v2_resource_emits_reviewed_optional_company_scope() {
        let resources = vec![NamedContract {
            name: "account-account-types".to_owned(),
            contract: serde_json::json!({"table": "account_account_type"}),
        }];
        let row_types = BTreeMap::from([(
            "account-account-types".to_owned(),
            "AccountAccountType".to_owned(),
        )]);
        let tables = vec![serde_json::json!({
            "name": "account_account_type",
            "product_type_ref": 0
        })];
        let types = vec![IndexedType {
            index: 0,
            names: vec!["AccountAccountType".to_owned()],
            definition: serde_json::json!({"Product": {"elements": []}}),
        }];
        let scope = ResourceScopeMetadata {
            kind: "organization_optional_company".to_owned(),
            organization_field: "organization_id".to_owned(),
            company_field: "company_id".to_owned(),
        };
        let output = v2_resources(
            &resources,
            &row_types,
            &tables,
            &types,
            &[],
            ResourceScopeManifest {
                schema_version: 1,
                resources: BTreeMap::from([("account-account-types".to_owned(), scope)]),
            },
            &SubscriptionCensus {
                schema_version: 1,
                entries: Vec::new(),
            },
            &BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(
            output[0]["scope"],
            serde_json::json!({
                "company_field": "company_id",
                "kind": "organization_optional_company",
                "organization_field": "organization_id",
            })
        );
    }

    #[test]
    fn v2_resource_emits_subscription_classification_from_census() {
        let resources = vec![NamedContract {
            name: "orders".to_owned(),
            contract: serde_json::json!({
                "table": "sale_order",
                "mandatory": ["id", "organization_id", "company_id"]
            }),
        }];
        let row_types = BTreeMap::from([("orders".to_owned(), "SaleOrder".to_owned())]);
        let tables = vec![serde_json::json!({"name": "sale_order", "product_type_ref": 0})];
        let types = vec![IndexedType {
            index: 0,
            names: vec!["SaleOrder".to_owned()],
            definition: serde_json::json!({"Product": {"elements": []}}),
        }];
        let census = SubscriptionCensus {
            schema_version: 1,
            entries: vec![SubscriptionCensusEntry {
                resource: "orders".to_owned(),
                scope: "organization+company".to_owned(),
                delivery_mode: "invalidation-only".to_owned(),
                predicate_class: "none".to_owned(),
                expected_cardinality: "bounded-page".to_owned(),
                latency_class: "interactive".to_owned(),
                update_fanout: "medium".to_owned(),
                source_class: "canonical-table".to_owned(),
                reconnect_class: "on-demand".to_owned(),
                access_path: serde_json::json!({
                    "status": "approved",
                    "key": "organization_company_id"
                }),
            }],
        };
        let output = v2_resources(
            &resources,
            &row_types,
            &tables,
            &types,
            &[],
            ResourceScopeManifest {
                schema_version: 1,
                resources: BTreeMap::new(),
            },
            &census,
            &BTreeMap::from([(
                "orders".to_owned(),
                SubscriptionQueryPolicy {
                    table: "sale_order".to_owned(),
                    predicates: Vec::new(),
                    order_by: Vec::new(),
                },
            )]),
        )
        .unwrap();

        assert_eq!(output[0]["scope"]["kind"], "organization_company");
        assert_eq!(output[0]["scope"]["resolution"], "direct");
        assert_eq!(output[0]["subscription"]["status"], "classified");
        assert_eq!(output[0]["subscription"]["realtime"], true);
        assert_eq!(
            output[0]["subscription"]["query_plan"]["table"],
            "sale_order"
        );
    }

    #[test]
    fn v2_resource_rejects_unknown_scope_resource() {
        let error = v2_resources(
            &[],
            &BTreeMap::new(),
            &[],
            &[],
            &[],
            ResourceScopeManifest {
                schema_version: 1,
                resources: BTreeMap::from([(
                    "missing".to_owned(),
                    ResourceScopeMetadata {
                        kind: "organization_optional_company".to_owned(),
                        organization_field: "organization_id".to_owned(),
                        company_field: "company_id".to_owned(),
                    },
                )]),
            },
            &SubscriptionCensus {
                schema_version: 1,
                entries: Vec::new(),
            },
            &BTreeMap::new(),
        )
        .expect_err("unknown scoped resource must fail");
        assert!(error
            .to_string()
            .contains("resource scope manifest references unknown resource missing"));
    }
}
