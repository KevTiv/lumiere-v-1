//! Adapter for the pinned, generated agent-capability catalog.
//!
//! This module is intentionally only a validation/conversion boundary.  The
//! generated catalog does not grant authorization and SATS descriptors are
//! never guessed into provider JSON Schema.

use std::collections::HashSet;
use std::fmt;
use std::sync::OnceLock;

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::providers::llm::ToolSpec;

const ARTIFACT_VERSION: u64 = 1;
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
    /// Convert the generated catalog to model tool specs. The pinned v0.3.42
    /// artifact has no entries, so this succeeds with an empty vector;
    /// nonempty entries remain fail-closed until a reviewed provider adapter
    /// exists.
    pub(super) fn specs(&self) -> Result<Vec<ToolSpec>, GeneratedCatalogError> {
        if self.entries.is_empty() {
            return Ok(Vec::new());
        }
        Err(GeneratedCatalogError::Unsupported(
            "provider name, description, and JSON Schema are not present in v0.3.42".into(),
        ))
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
    Ok(CapabilityEntry {
        capability_key,
        risk,
        requires_confirmation,
        result_policy,
        target,
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

    #[test]
    fn pinned_checksum_and_cached_empty_catalog_are_valid() {
        let first = embedded_catalog().expect("valid release");
        assert!(std::ptr::eq(
            first,
            embedded_catalog().expect("cached release")
        ));
        assert!(first.specs().expect("empty specs").is_empty());
        let json = artifact(json!([])).to_string();
        assert!(parse_embedded(&json, "00").is_err());
    }

    #[test]
    fn provenance_and_versions_fail_closed() {
        let root = artifact(json!([]));
        assert!(parse_catalog(&root.to_string()).is_ok());
        for (pointer, value) in [
            ("/artifact_version", json!(2)),
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
    fn nonempty_resource_remains_unsupported() {
        let catalog =
            parse_catalog(&artifact(json!([resource()])).to_string()).expect("valid descriptor");
        assert!(matches!(
            catalog.specs(),
            Err(GeneratedCatalogError::Unsupported(_))
        ));
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
        assert!(matches!(
            catalog.specs(),
            Err(GeneratedCatalogError::Unsupported(_))
        ));
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
