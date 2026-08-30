//! Strict descriptor-driven codec for compact operation/resource contracts.
//!
//! Contract values use lossless JSON (`u64` and timestamp values are decimal
//! strings) and are translated to the SATS JSON shape only at the transport
//! boundary.  The descriptor is intentionally JSON-shaped so the generated
//! contracts crate can provide the same table to TypeScript and Rust.

use serde_json::{Map, Value};
use std::fmt;

const MAX_U64: u128 = 18_446_744_073_709_551_615;
const MIN_I64: i128 = -9_223_372_036_854_775_808;
const MAX_I64: i128 = 9_223_372_036_854_775_807;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompactCodecError(String);

impl CompactCodecError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self(format!("compact-codec:{code}: {}", message.into()))
    }

    /// Stable machine-readable class (`u64`, `identity`, `field`, ...).
    pub fn code(&self) -> &str {
        self.0
            .strip_prefix("compact-codec:")
            .and_then(|value| value.split_once(':'))
            .map(|(code, _)| code)
            .unwrap_or("unknown")
    }
}

impl fmt::Display for CompactCodecError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl std::error::Error for CompactCodecError {}

type Result<T> = std::result::Result<T, CompactCodecError>;

fn object<'a>(value: &'a Value, code: &str) -> Result<&'a Map<String, Value>> {
    value
        .as_object()
        .ok_or_else(|| CompactCodecError::new(code, "expected an object"))
}

fn type_kind<'a>(ty: &'a Value) -> Result<&'a str> {
    object(ty, "descriptor")?
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(|| CompactCodecError::new("descriptor", "type kind is required"))
}

fn decimal(value: &Value, code: &str, min: i128, max: i128) -> Result<String> {
    let raw = match value {
        Value::String(value) => value.clone(),
        Value::Number(value) => value.to_string(),
        _ => {
            return Err(CompactCodecError::new(
                code,
                "expected a decimal string or integer",
            ))
        }
    };
    let digits = raw.strip_prefix('-').unwrap_or(&raw);
    if raw.is_empty()
        || digits.is_empty()
        || (raw.starts_with('-') && digits == "0")
        || (digits.len() > 1 && digits.starts_with('0'))
        || !digits.chars().all(|c| c.is_ascii_digit())
    {
        return Err(CompactCodecError::new(code, "invalid decimal"));
    }
    let parsed = raw
        .parse::<i128>()
        .map_err(|_| CompactCodecError::new(code, "invalid decimal"))?;
    if parsed < min || parsed > max {
        return Err(CompactCodecError::new(code, "integer is out of range"));
    }
    Ok(parsed.to_string())
}

fn identity(value: &Value) -> Result<String> {
    let raw = if let Some(object) = value.as_object() {
        if object.len() != 1 || !object.contains_key("__identity__") {
            return Err(CompactCodecError::new(
                "identity",
                "malformed identity object",
            ));
        }
        object
            .get("__identity__")
            .and_then(Value::as_str)
            .ok_or_else(|| CompactCodecError::new("identity", "expected a hex string"))?
    } else {
        value
            .as_str()
            .ok_or_else(|| CompactCodecError::new("identity", "expected a hex string"))?
    };
    let hex = raw
        .strip_prefix("0x")
        .or_else(|| raw.strip_prefix("0X"))
        .unwrap_or(raw);
    if hex.len() != 64 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(CompactCodecError::new(
            "identity",
            "expected a 64-character hex string",
        ));
    }
    Ok(format!("0x{}", hex.to_ascii_lowercase()))
}

fn variant_key(tag: &str) -> String {
    let mut chars = tag.chars();
    chars
        .next()
        .map(|first| first.to_ascii_lowercase().to_string() + chars.as_str())
        .unwrap_or_default()
}

fn variants<'a>(ty: &'a Value) -> Result<&'a Map<String, Value>> {
    object(ty, "descriptor")?
        .get("variants")
        .and_then(Value::as_object)
        .ok_or_else(|| CompactCodecError::new("descriptor", "enum variants must be an object"))
}

fn fields<'a>(ty: &'a Value) -> Result<&'a Vec<Value>> {
    object(ty, "descriptor")?
        .get("fields")
        .and_then(Value::as_array)
        .ok_or_else(|| CompactCodecError::new("descriptor", "struct fields must be an array"))
}

fn field<'a>(value: &'a Value, key: &str) -> Result<&'a Map<String, Value>> {
    let field = object(value, "descriptor")?;
    if field.get("name").and_then(Value::as_str).is_none()
        || field.get("wire").and_then(Value::as_str).is_none()
        || field.get("type").is_none()
    {
        return Err(CompactCodecError::new(
            "descriptor",
            format!("struct field {key} requires name, wire, and type"),
        ));
    }
    Ok(field)
}

fn aliases(field: &Map<String, Value>) -> Result<Vec<&str>> {
    let Some(value) = field.get("aliases") else {
        return Ok(Vec::new());
    };
    value
        .as_array()
        .ok_or_else(|| CompactCodecError::new("descriptor", "field aliases must be an array"))?
        .iter()
        .map(|value| {
            value.as_str().ok_or_else(|| {
                CompactCodecError::new("descriptor", "field aliases must be strings")
            })
        })
        .collect()
}

fn nested_type<'a>(map: &'a Map<String, Value>, key: &str) -> Result<&'a Value> {
    map.get(key)
        .ok_or_else(|| CompactCodecError::new("descriptor", format!("missing {key} type")))
}

/// Encode a canonical contract value as strict SATS JSON.
pub fn encode_compact(ty: &Value, value: &Value) -> Result<Value> {
    match type_kind(ty)? {
        "alias" => encode_compact(nested_type(object(ty, "descriptor")?, "target")?, value),
        "u64" => Ok(Value::String(decimal(value, "u64", 0, MAX_U64 as i128)?)),
        "timestamp" => {
            let input = object(value, "timestamp")?;
            if input.len() != 1 || !input.contains_key("microsSinceUnixEpoch") {
                return Err(CompactCodecError::new(
                    "timestamp",
                    "malformed timestamp object",
                ));
            }
            Ok(serde_json::json!({
                "__timestamp_micros_since_unix_epoch__": decimal(
                    &input["microsSinceUnixEpoch"],
                    "timestamp",
                    MIN_I64,
                    MAX_I64,
                )?
            }))
        }
        "identity" => Ok(serde_json::json!({ "__identity__": identity(value)? })),
        "string" => value
            .as_str()
            .map(|value| Value::String(value.to_owned()))
            .ok_or_else(|| CompactCodecError::new("string", "expected a string")),
        "bool" => value
            .as_bool()
            .map(Value::Bool)
            .ok_or_else(|| CompactCodecError::new("bool", "expected a boolean")),
        "option" => {
            let inner = nested_type(object(ty, "descriptor")?, "inner")?;
            if value.is_null() {
                Ok(serde_json::json!({ "none": [] }))
            } else {
                Ok(serde_json::json!({ "some": encode_compact(inner, value)? }))
            }
        }
        "array" => value
            .as_array()
            .ok_or_else(|| CompactCodecError::new("array", "expected an array"))?
            .iter()
            .map(|item| encode_compact(nested_type(object(ty, "descriptor")?, "items")?, item))
            .collect::<Result<Vec<_>>>()
            .map(Value::Array),
        "enum" => {
            let input = object(value, "enum")?;
            let tag = input
                .get("tag")
                .and_then(Value::as_str)
                .ok_or_else(|| CompactCodecError::new("enum", "tag is required"))?;
            let definition = variants(ty)?
                .get(tag)
                .ok_or_else(|| CompactCodecError::new("enum", format!("unknown tag {tag}")))?;
            let mut result = Map::new();
            if definition.is_null() {
                if input.len() != 1 {
                    return Err(CompactCodecError::new(
                        "enum",
                        "unit variant cannot carry a value",
                    ));
                }
                result.insert(variant_key(tag), Value::Array(Vec::new()));
            } else {
                let payload = input.get("value").ok_or_else(|| {
                    CompactCodecError::new("enum", "payload variant requires value")
                })?;
                if input.len() != 2 {
                    return Err(CompactCodecError::new("enum", "unknown enum field"));
                }
                result.insert(variant_key(tag), encode_compact(definition, payload)?);
            }
            Ok(Value::Object(result))
        }
        "struct" => {
            let input = object(value, "struct")?;
            let mut result = Map::new();
            let mut accepted = Vec::new();
            for raw_field in fields(ty)? {
                let field = field(raw_field, "")?;
                let name = field["name"].as_str().expect("validated field name");
                let wire = field["wire"].as_str().expect("validated field wire");
                accepted.push(name);
                let field_aliases = aliases(field)?;
                accepted.extend(field_aliases.iter().copied());
                let present: Vec<&str> = std::iter::once(name)
                    .chain(field_aliases.iter().copied())
                    .filter(|key| input.contains_key(*key))
                    .collect();
                if present.len() > 1 {
                    return Err(CompactCodecError::new(
                        "alias",
                        format!("multiple aliases supplied for {name}"),
                    ));
                }
                if let Some(input_key) = present.first() {
                    result.insert(
                        wire.to_owned(),
                        encode_compact(nested_type(field, "type")?, &input[*input_key])?,
                    );
                }
            }
            if input.keys().any(|key| !accepted.contains(&key.as_str())) {
                return Err(CompactCodecError::new("field", "unknown field"));
            }
            Ok(Value::Object(result))
        }
        other => Err(CompactCodecError::new(
            "descriptor",
            format!("unsupported type {other}"),
        )),
    }
}

/// Decode strict SATS JSON as a canonical, lossless contract value.
pub fn decode_compact(ty: &Value, value: &Value) -> Result<Value> {
    match type_kind(ty)? {
        "alias" => decode_compact(nested_type(object(ty, "descriptor")?, "target")?, value),
        "u64" => Ok(Value::String(decimal(value, "u64", 0, MAX_U64 as i128)?)),
        "timestamp" => {
            let input = object(value, "timestamp")?;
            if input.len() != 1 || !input.contains_key("__timestamp_micros_since_unix_epoch__") {
                return Err(CompactCodecError::new(
                    "timestamp",
                    "malformed wire timestamp",
                ));
            }
            Ok(
                serde_json::json!({ "microsSinceUnixEpoch": decimal(&input["__timestamp_micros_since_unix_epoch__"], "timestamp", MIN_I64, MAX_I64)? }),
            )
        }
        "identity" => {
            let input = object(value, "identity")?;
            if input.len() != 1 || !input.contains_key("__identity__") {
                return Err(CompactCodecError::new(
                    "identity",
                    "malformed wire identity",
                ));
            }
            Ok(Value::String(identity(value)?))
        }
        "string" => value
            .as_str()
            .map(|value| Value::String(value.to_owned()))
            .ok_or_else(|| CompactCodecError::new("string", "expected a string")),
        "bool" => value
            .as_bool()
            .map(Value::Bool)
            .ok_or_else(|| CompactCodecError::new("bool", "expected a boolean")),
        "option" => {
            let input = object(value, "option")?;
            if input.len() != 1 {
                return Err(CompactCodecError::new(
                    "option",
                    "option must have one variant",
                ));
            }
            if let Some(none) = input.get("none") {
                if none.as_array().map_or(true, |items| !items.is_empty()) {
                    return Err(CompactCodecError::new("option", "malformed none payload"));
                }
                return Ok(Value::Null);
            }
            let some = input
                .get("some")
                .ok_or_else(|| CompactCodecError::new("option", "unknown option variant"))?;
            decode_compact(nested_type(object(ty, "descriptor")?, "inner")?, some)
        }
        "array" => value
            .as_array()
            .ok_or_else(|| CompactCodecError::new("array", "expected an array"))?
            .iter()
            .map(|item| decode_compact(nested_type(object(ty, "descriptor")?, "items")?, item))
            .collect::<Result<Vec<_>>>()
            .map(Value::Array),
        "enum" => {
            let input = object(value, "enum")?;
            if input.len() != 1 {
                return Err(CompactCodecError::new("enum", "enum must have one variant"));
            }
            let wire = input.keys().next().expect("one enum key");
            let (tag, definition) = variants(ty)?
                .iter()
                .find(|(tag, _)| variant_key(tag) == *wire)
                .ok_or_else(|| {
                    CompactCodecError::new("enum", format!("unknown wire tag {wire}"))
                })?;
            if definition.is_null() {
                if !input[wire].as_array().is_some_and(Vec::is_empty) {
                    return Err(CompactCodecError::new("enum", "malformed unit payload"));
                }
                return Ok(serde_json::json!({ "tag": tag }));
            }
            Ok(
                serde_json::json!({ "tag": tag, "value": decode_compact(definition, &input[wire])? }),
            )
        }
        "struct" => {
            let input = object(value, "struct")?;
            let mut result = Map::new();
            let mut wires = Vec::new();
            for raw_field in fields(ty)? {
                let field = field(raw_field, "")?;
                let name = field["name"].as_str().expect("validated field name");
                let wire = field["wire"].as_str().expect("validated field wire");
                wires.push(wire);
                if let Some(value) = input.get(wire) {
                    result.insert(
                        name.to_owned(),
                        decode_compact(nested_type(field, "type")?, value)?,
                    );
                }
            }
            if input.keys().any(|key| !wires.contains(&key.as_str())) {
                return Err(CompactCodecError::new("field", "unknown wire field"));
            }
            Ok(Value::Object(result))
        }
        other => Err(CompactCodecError::new(
            "descriptor",
            format!("unsupported type {other}"),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::{decode_compact, encode_compact};
    use serde_json::Value;

    fn fixtures() -> Value {
        serde_json::from_str(include_str!(
            "../../../frontend/packages/stdb/src/wire-codec-fixtures.json"
        ))
        .expect("wire codec fixture JSON")
    }

    #[test]
    fn shared_fixture_corpus_encodes_and_decodes() {
        for fixture in fixtures()["cases"].as_array().expect("cases") {
            if fixture.get("error").is_some() {
                if fixture.get("wire").is_none() {
                    assert!(
                        encode_compact(&fixture["type"], &fixture["input"]).is_err(),
                        "{}",
                        fixture["name"]
                    );
                }
                if fixture.get("wire").is_some() {
                    assert!(
                        decode_compact(&fixture["type"], &fixture["wire"]).is_err(),
                        "{} wire",
                        fixture["name"]
                    );
                }
            } else {
                let wire = encode_compact(&fixture["type"], &fixture["input"]).expect("encode");
                assert_eq!(wire, fixture["wire"], "{}", fixture["name"]);
                let expected = fixture
                    .get("canonical")
                    .unwrap_or(&fixture["input"])
                    .clone();
                assert_eq!(
                    decode_compact(&fixture["type"], &wire).expect("decode"),
                    expected,
                    "{}",
                    fixture["name"]
                );
            }
        }
    }
}
