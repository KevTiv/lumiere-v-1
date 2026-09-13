//! Adapter for the pinned, generated agent-capability catalog.
//!
//! This module is intentionally only a validation/conversion boundary.  The
//! generated catalog does not grant authorization and SATS descriptors are
//! never guessed into provider JSON Schema: a tool is advertisable only when
//! the reviewed artifact ships its name, description and input schema, which
//! the generator derives from the canonical contract. An entry without that
//! descriptor (today, every operation target) stays unadvertisable.
//!
//! Result-policy caps are the reviewed ceilings. Narrowing them for an actor's
//! role is a runtime decision and never happens here.

use std::collections::HashSet;
use std::fmt;
use std::sync::OnceLock;

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::providers::llm::ToolSpec;

const ARTIFACT_VERSION: u64 = 2;
const IR_VERSION: u64 = 2;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum GeneratedCatalogError {
    Invalid(String),
    Unsupported(String),
}

impl fmt::Display for GeneratedCatalogError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(message) => write!(f, "invalid generated capability catalog: {message}"),
            Self::Unsupported(message) => {
                write!(f, "unsupported generated capability catalog: {message}")
            }
        }
    }
}

impl std::error::Error for GeneratedCatalogError {}

#[derive(Clone, Debug, PartialEq)]
pub(super) struct GeneratedCatalog {
    artifact_version: u64,
    source_ir: SourceIr,
    entries: Vec<CapabilityEntry>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct SourceIr {
    ir_version: u64,
    source_commit: String,
    schema_hash: String,
}

#[derive(Clone, Debug, PartialEq)]
struct CapabilityEntry {
    capability_key: String,
    risk: Risk,
    requires_confirmation: bool,
    result_policy: ResultPolicy,
    target: Target,
    /// Present only when the reviewed artifact ships an advertisable tool.
    tool: Option<ToolDescriptor>,
}

#[derive(Clone, Debug, PartialEq)]
struct ToolDescriptor {
    name: String,
    description: String,
    input_schema: Value,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Risk {
    ReadOnly,
    Presentation,
    Draft,
    BusinessMutation,
    FinancialMutation,
}

#[derive(Clone, Debug, PartialEq)]
enum Target {
    Operation { id: String, descriptor: Value },
    Resource { name: String, descriptor: Value },
}

#[derive(Clone, Debug, PartialEq)]
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

/// Parse and validate the embedded generated catalog once.
pub(super) fn embedded_catalog() -> Result<&'static GeneratedCatalog, GeneratedCatalogError> {
    static CATALOG: OnceLock<Result<GeneratedCatalog, GeneratedCatalogError>> = OnceLock::new();
    CATALOG
        .get_or_init(|| {
            parse_embedded(
                lumiere_contracts::generated::agent_capabilities::AGENT_CAPABILITY_REGISTRY_JSON,
                lumiere_contracts::generated::agent_capabilities::AGENT_CAPABILITY_REGISTRY_SHA256,
            )
        })
        .as_ref()
        .map_err(Clone::clone)
}

impl GeneratedCatalog {
    /// Convert the reviewed catalog to model tool specs.
    ///
    /// Only entries whose reviewed descriptor ships a name, description and
    /// input schema are advertisable. An entry without one is fail-closed:
    /// it is omitted here, so a model can never be offered a capability whose
    /// input contract nobody derived.
    pub(super) fn specs(&self) -> Result<Vec<ToolSpec>, GeneratedCatalogError> {
        Ok(self
            .entries
            .iter()
            .filter_map(|entry| entry.tool.as_ref())
            .map(|tool| ToolSpec {
                name: tool.name.clone(),
                description: tool.description.clone(),
                parameters: tool.input_schema.clone(),
            })
            .collect())
    }
}

fn parse_embedded(
    json: &str,
    expected_sha256: &str,
) -> Result<GeneratedCatalog, GeneratedCatalogError> {
    let actual = format!("{:x}", Sha256::digest(json.as_bytes()));
    if expected_sha256 != actual {
        return Err(GeneratedCatalogError::Invalid(
            "registry checksum mismatch".into(),
        ));
    }
    parse_catalog(json)
}

fn parse_catalog(json: &str) -> Result<GeneratedCatalog, GeneratedCatalogError> {
    let root: Value = serde_json::from_str(json)
        .map_err(|error| GeneratedCatalogError::Invalid(format!("malformed JSON: {error}")))?;
    let object = root
        .as_object()
        .ok_or_else(|| invalid("root must be an object"))?;
    if number(object, "artifact_version")? != ARTIFACT_VERSION {
        return Err(invalid("unsupported artifact version"));
    }
    let source = object_value(object, "source_ir")?;
    if number(source, "ir_version")? != IR_VERSION {
        return Err(invalid("unsupported source IR version"));
    }
    let source_commit = string(source, "source_commit")?;
    if !matches!(source_commit.len(), 40 | 64)
        || !source_commit
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(invalid("malformed source commit"));
    }
    if source.get("source_dirty") != Some(&Value::Bool(false)) {
        return Err(invalid("source provenance is dirty or malformed"));
    }
    let schema_hash = string(source, "schema_hash")?;
    if schema_hash.len() != 71
        || !schema_hash.starts_with("sha256:")
        || !schema_hash[7..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(invalid("malformed schema hash"));
    }
    let entries = object
        .get("entries")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("entries must be an array"))?;
    let mut keys = HashSet::with_capacity(entries.len());
    let mut previous = None;
    let mut parsed = Vec::with_capacity(entries.len());
    for raw in entries {
        let entry = parse_entry(raw)?;
        if previous
            .as_deref()
            .is_some_and(|key| key >= entry.capability_key.as_str())
        {
            return Err(invalid("capability keys must be sorted and unique"));
        }
        if !keys.insert(entry.capability_key.clone()) {
            return Err(invalid("capability keys must be unique"));
        }
        previous = Some(entry.capability_key.clone());
        parsed.push(entry);
    }
    Ok(GeneratedCatalog {
        artifact_version: ARTIFACT_VERSION,
        source_ir: SourceIr {
            ir_version: IR_VERSION,
            source_commit,
            schema_hash,
        },
        entries: parsed,
    })
}

fn parse_entry(raw: &Value) -> Result<CapabilityEntry, GeneratedCatalogError> {
    let object = raw
        .as_object()
        .ok_or_else(|| invalid("entry must be an object"))?;
    let capability_key = string(object, "capability_key")?;
    if !capability_key.starts_with(|c: char| c.is_ascii_lowercase())
        || !capability_key.bytes().all(|b| {
            b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'_' | b'-')
        })
        || capability_key.ends_with(['.', '_', '-'])
        || ["..", "__", "--"]
            .iter()
            .any(|s| capability_key.contains(s))
    {
        return Err(invalid("invalid stable capability key"));
    }
    let risk = match string(object, "risk")?.as_str() {
        "read_only" => Risk::ReadOnly,
        "presentation" => Risk::Presentation,
        "draft" => Risk::Draft,
        "business_mutation" => Risk::BusinessMutation,
        "financial_mutation" => Risk::FinancialMutation,
        _ => return Err(invalid("invalid risk")),
    };
    let requires_confirmation = object
        .get("requires_confirmation")
        .and_then(Value::as_bool)
        .ok_or_else(|| invalid("requires_confirmation must be boolean"))?;
    let result_policy = parse_result_policy(object_value(object, "result_policy")?)?;
    let operation = object.get("operation_id");
    let resource = object.get("resource");
    if operation.is_some() == resource.is_some() {
        return Err(invalid("entry must identify exactly one target"));
    }
    let target = if let Some(value) = operation {
        if object.contains_key("resource") || object.contains_key("resource_descriptor") {
            return Err(invalid(
                "operation entry cannot contain resource target metadata",
            ));
        }
        let id = value
            .as_str()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| invalid("operation_id must be a nonempty string"))?;
        let descriptor = object_value(object, "operation")?;
        if descriptor.get("operation_id").and_then(Value::as_str) != Some(id) {
            return Err(invalid("operation descriptor identity mismatch"));
        }
        for field in ["operation_id_status", "source_kind", "application_exposure"] {
            let expected = match field {
                "operation_id_status" => "locked",
                "source_kind" => "reducer",
                _ => "session",
            };
            if descriptor.get(field).and_then(Value::as_str) != Some(expected) {
                return Err(invalid("operation is not locked/session-exposed reducer"));
            }
        }
        if descriptor.get("client_facing") != Some(&Value::Bool(true)) {
            return Err(invalid("operation is not client-facing"));
        }
        Target::Operation {
            id: id.into(),
            descriptor: Value::Object(descriptor.clone()),
        }
    } else {
        if object.contains_key("operation") {
            return Err(invalid(
                "resource entry cannot contain operation target metadata",
            ));
        }
        let name = resource
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| invalid("resource must be a nonempty string"))?;
        let descriptor = object_value(object, "resource_descriptor")?;
        if descriptor.get("resource_name").and_then(Value::as_str) != Some(name) {
            return Err(invalid("resource descriptor identity mismatch"));
        }
        if descriptor
            .get("query")
            .and_then(Value::as_object)
            .and_then(|query| query.get("status"))
            .and_then(Value::as_str)
            != Some("classified")
            || descriptor
                .get("query")
                .and_then(Value::as_object)
                .and_then(|query| query.get("authorization"))
                .and_then(Value::as_str)
                != Some("server-enforced")
        {
            return Err(invalid("resource is not server-enforced"));
        }
        Target::Resource {
            name: name.into(),
            descriptor: Value::Object(descriptor.clone()),
        }
    };
    if matches!(
        risk,
        Risk::Draft | Risk::BusinessMutation | Risk::FinancialMutation
    ) && !requires_confirmation
    {
        return Err(invalid("mutating capability requires confirmation"));
    }
    let tool = match object.get("tool") {
        None => None,
        Some(raw) => Some(parse_tool(raw, &capability_key, &target, &result_policy)?),
    };
    Ok(CapabilityEntry {
        capability_key,
        risk,
        requires_confirmation,
        result_policy,
        target,
        tool,
    })
}

/// Accept a descriptor only if it matches its entry: the name must be the
/// capability key in identifier form, the schema must be closed, it must not
/// accept tenant scope, and its row bound must equal the reviewed ceiling.
fn parse_tool(
    raw: &Value,
    capability_key: &str,
    target: &Target,
    result_policy: &ResultPolicy,
) -> Result<ToolDescriptor, GeneratedCatalogError> {
    if matches!(target, Target::Operation { .. }) {
        return Err(invalid("operation entries cannot advertise a tool"));
    }
    let object = raw
        .as_object()
        .ok_or_else(|| invalid("tool must be an object"))?;
    let name = string(object, "name")?;
    if name != capability_key.replace(['.', '-'], "_") {
        return Err(invalid("tool name is not derived from the capability key"));
    }
    if !name.starts_with(|c: char| c.is_ascii_lowercase())
        || !name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        || name.ends_with('_')
        || name.contains("__")
    {
        return Err(invalid("tool name is not identifier-shaped"));
    }
    let description = string(object, "description")?;
    if description.trim().is_empty() {
        return Err(invalid("tool description is empty"));
    }
    let schema = object_value(object, "input_schema")?;
    if schema.get("type").and_then(Value::as_str) != Some("object")
        || schema.get("additionalProperties") != Some(&Value::Bool(false))
    {
        return Err(invalid("tool input schema must be a closed object"));
    }
    let properties = schema
        .get("properties")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("tool input schema has no properties"))?;
    if properties.contains_key("organization_id") {
        return Err(invalid("tool input schema must not accept an organization"));
    }
    if properties
        .keys()
        .any(|key| !matches!(key.as_str(), "max_rows" | "company_id"))
    {
        return Err(invalid("tool input schema has unsupported inputs"));
    }
    let ceiling = match result_policy {
        ResultPolicy::Dataset { max_rows, .. } => *max_rows,
        ResultPolicy::AggregateFirst {
            max_output_rows, ..
        } => *max_output_rows,
        ResultPolicy::Direct { .. } => 1,
    };
    if properties
        .get("max_rows")
        .and_then(|rows| rows.get("maximum"))
        .and_then(Value::as_u64)
        != Some(ceiling)
    {
        return Err(invalid(
            "tool input schema row bound disagrees with the reviewed ceiling",
        ));
    }
    Ok(ToolDescriptor {
        name,
        description,
        input_schema: Value::Object(schema.clone()),
    })
}

fn parse_result_policy(object: &Map<String, Value>) -> Result<ResultPolicy, GeneratedCatalogError> {
    match string(object, "kind")?.as_str() {
        "direct" => Ok(ResultPolicy::Direct {
            max_bytes: positive(object, "max_bytes")?,
        }),
        "dataset" => Ok(ResultPolicy::Dataset {
            max_rows: positive(object, "max_rows")?,
            max_bytes: positive(object, "max_bytes")?,
        }),
        "aggregate_first" => {
            let shapes = object
                .get("allowed_shapes")
                .and_then(Value::as_array)
                .ok_or_else(|| invalid("allowed_shapes must be an array"))?;
            let allowed_shapes = shapes
                .iter()
                .map(|shape| {
                    shape
                        .as_str()
                        .map(str::to_owned)
                        .filter(|shape| !shape.trim().is_empty())
                        .ok_or_else(|| invalid("allowed_shapes must contain nonempty strings"))
                })
                .collect::<Result<Vec<_>, _>>()?;
            if allowed_shapes.is_empty() || allowed_shapes.windows(2).any(|pair| pair[0] >= pair[1])
            {
                return Err(invalid(
                    "allowed_shapes must be nonempty, sorted and unique",
                ));
            }
            Ok(ResultPolicy::AggregateFirst {
                allowed_shapes,
                max_output_rows: positive(object, "max_output_rows")?,
            })
        }
        _ => Err(invalid("invalid result policy")),
    }
}

fn object_value<'a>(
    object: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a Map<String, Value>, GeneratedCatalogError> {
    object
        .get(key)
        .and_then(Value::as_object)
        .ok_or_else(|| invalid(format!("{key} must be an object")))
}
fn string(object: &Map<String, Value>, key: &str) -> Result<String, GeneratedCatalogError> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| invalid(format!("{key} must be a string")))
}
fn number(object: &Map<String, Value>, key: &str) -> Result<u64, GeneratedCatalogError> {
    object
        .get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| invalid(format!("{key} must be an unsigned integer")))
}
fn positive(object: &Map<String, Value>, key: &str) -> Result<u64, GeneratedCatalogError> {
    let value = number(object, key)?;
    (value > 0)
        .then_some(value)
        .ok_or_else(|| invalid(format!("{key} must be positive")))
}
fn invalid(message: impl Into<String>) -> GeneratedCatalogError {
    GeneratedCatalogError::Invalid(message.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn artifact(entries: Value) -> Value {
        let mut root: Value = serde_json::from_str(
            lumiere_contracts::generated::agent_capabilities::AGENT_CAPABILITY_REGISTRY_JSON,
        )
        .expect("pinned JSON");
        root["entries"] = entries;
        root
    }

    fn resource() -> Value {
        json!({"capability_key":"erp.read.a","risk":"read_only","requires_confirmation":false,
            "result_policy":{"kind":"direct","max_bytes":1024},"resource":"a",
            "resource_descriptor":{"resource_name":"a","query":{"status":"classified","authorization":"server-enforced"}}})
    }

    /// A reviewed read whose descriptor the release derived.
    fn advertisable() -> Value {
        let mut entry = resource();
        entry["result_policy"] = json!({"kind": "dataset", "max_rows": 25, "max_bytes": 4096});
        entry["tool"] = json!({
            "name": "erp_read_a",
            "description": "Read authorized a rows.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "max_rows": {"type": "integer", "minimum": 1, "maximum": 25},
                    "company_id": {"type": "integer", "minimum": 1},
                },
                "required": [],
                "additionalProperties": false,
            },
        });
        entry
    }

    #[test]
    fn pinned_release_is_cached_and_advertises_its_reviewed_reads() {
        let first = embedded_catalog().expect("valid release");
        assert!(std::ptr::eq(
            first,
            embedded_catalog().expect("cached release")
        ));
        let specs = first.specs().expect("pinned specs");
        assert_eq!(
            specs.len(),
            3,
            "the pinned release ships three reviewed reads"
        );
        for spec in &specs {
            assert!(spec.name.starts_with("inventory_"), "{}", spec.name);
            assert!(!spec.description.trim().is_empty());
            assert_eq!(spec.parameters["additionalProperties"], json!(false));
            assert!(
                spec.parameters["properties"]["organization_id"].is_null(),
                "tenant scope is never advertised as an input"
            );
        }
        let json = artifact(json!([])).to_string();
        assert!(parse_embedded(&json, "00").is_err());
    }

    #[test]
    fn only_entries_with_a_reviewed_descriptor_are_advertisable() {
        let without = parse_catalog(&artifact(json!([resource()])).to_string())
            .expect("valid entry without a tool");
        assert!(
            without.specs().expect("specs").is_empty(),
            "an entry nobody derived a schema for is never offered to a model"
        );

        let with = parse_catalog(&artifact(json!([advertisable()])).to_string())
            .expect("valid advertisable entry");
        let specs = with.specs().expect("specs");
        assert_eq!(specs.len(), 1);
        assert_eq!(specs[0].name, "erp_read_a");
        assert_eq!(
            specs[0].parameters["properties"]["max_rows"]["maximum"],
            json!(25)
        );
    }

    #[test]
    fn invalid_tool_descriptors_fail_closed() {
        for (pointer, value) in [
            ("/tool/name", json!("something_else")),
            ("/tool/name", json!("Erp_Read_A")),
            ("/tool/description", json!("   ")),
            ("/tool/input_schema/additionalProperties", json!(true)),
            ("/tool/input_schema/type", json!("string")),
            (
                "/tool/input_schema/properties/max_rows/maximum",
                json!(1_000),
            ),
        ] {
            let mut entry = advertisable();
            *entry.pointer_mut(pointer).expect("fixture field") = value;
            assert!(
                parse_catalog(&artifact(json!([entry])).to_string()).is_err(),
                "{pointer}"
            );
        }

        let mut scoped = advertisable();
        scoped["tool"]["input_schema"]["properties"]["organization_id"] =
            json!({"type": "integer", "minimum": 1});
        assert!(
            parse_catalog(&artifact(json!([scoped])).to_string()).is_err(),
            "an organization input must be rejected"
        );
    }

    #[test]
    fn provenance_and_versions_fail_closed() {
        let root = artifact(json!([]));
        assert!(parse_catalog(&root.to_string()).is_ok());
        for (pointer, value) in [
            ("/artifact_version", json!(1)),
            ("/artifact_version", json!(3)),
            ("/source_ir/ir_version", json!(3)),
            ("/source_ir/source_dirty", json!(true)),
            ("/source_ir/source_commit", json!("bad")),
            ("/source_ir/schema_hash", json!("bad")),
        ] {
            let mut changed = root.clone();
            *changed.pointer_mut(pointer).expect("fixture field") = value;
            assert!(parse_catalog(&changed.to_string()).is_err(), "{pointer}");
        }
    }

    #[test]
    fn invalid_entry_fields_fail_closed() {
        let original = resource();
        for (pointer, value) in [
            ("/capability_key", json!("bad..key")),
            ("/risk", json!("unknown")),
            ("/risk", json!("financial_mutation")),
            ("/result_policy/max_bytes", json!(0)),
            ("/result_policy/kind", json!("unknown")),
            ("/resource_descriptor/resource_name", json!("other")),
            (
                "/resource_descriptor/query/authorization",
                json!("server_enforced"),
            ),
        ] {
            let mut entry = original.clone();
            *entry.pointer_mut(pointer).expect("fixture field") = value;
            assert!(
                parse_catalog(&artifact(json!([entry])).to_string()).is_err(),
                "{pointer}"
            );
        }
        let mut multiple = original.clone();
        multiple["operation_id"] = json!("op");
        assert!(parse_catalog(&artifact(json!([multiple])).to_string()).is_err());
        let mut absent = original.clone();
        absent.as_object_mut().expect("entry").remove("resource");
        assert!(parse_catalog(&artifact(json!([absent])).to_string()).is_err());
        assert!(
            parse_catalog(&artifact(json!([original.clone(), original.clone()])).to_string())
                .is_err()
        );
        let mut last = original.clone();
        last["capability_key"] = json!("erp.read.z");
        assert!(parse_catalog(&artifact(json!([last, original])).to_string()).is_err());
    }

    #[test]
    fn sats_operation_is_validated_but_never_converted_or_executed() {
        let entry = json!({"capability_key":"erp.read.a","risk":"read_only","requires_confirmation":false,
            "result_policy":{"kind":"direct","max_bytes":1},"operation_id":"op",
            "operation":{"operation_id":"op","operation_id_status":"locked","source_kind":"reducer",
                "application_exposure":"session","client_facing":true,"schema":{"Ref":0}}});
        let catalog =
            parse_catalog(&artifact(json!([entry.clone()])).to_string()).expect("valid operation");
        assert!(
            catalog.specs().expect("specs").is_empty(),
            "a reviewed operation is never advertised: nobody derived its input schema"
        );
        let mut with_tool = entry.clone();
        with_tool["tool"] = advertisable()["tool"].clone();
        assert!(
            parse_catalog(&artifact(json!([with_tool])).to_string()).is_err(),
            "an operation cannot carry a tool descriptor"
        );
        for (key, value) in [
            ("operation_id", json!("other")),
            ("operation_id_status", json!("unlocked")),
            ("source_kind", json!("table")),
            ("application_exposure", json!("internal")),
            ("client_facing", json!(false)),
        ] {
            let mut changed = entry.clone();
            changed["operation"][key] = value;
            assert!(
                parse_catalog(&artifact(json!([changed])).to_string()).is_err(),
                "{key}"
            );
        }
    }
}
