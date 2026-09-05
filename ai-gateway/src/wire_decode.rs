//! Shared wire-decode primitives for JSON row values and field-name conversion.
//!
//! These helpers cover the common pattern of extracting u64 values from
//! SpacetimeDB SQL rows (which may encode numbers as JSON numbers or strings)
//! and converting between snake_case and camelCase for field-name matching.
//!
//! Variant decoders that differ in error handling, null semantics, or
//! signed-unsigned coercion remain local to their callers.

use serde_json::{Map, Value};

/// Extract a u64 from a JSON row by trying camelCase then snake_case key.
///
/// Accepts JSON numbers (`as_u64`) and numeric strings (`parse`). Returns
/// `None` for missing keys, null, negatives, or malformed values.
pub(crate) fn row_u64(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
}

/// Convert a snake_case string to camelCase.
pub(crate) fn snake_to_camel(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut upper = false;
    for c in s.chars() {
        if c == '_' {
            upper = true;
        } else if upper {
            out.push(c.to_ascii_uppercase());
            upper = false;
        } else {
            out.push(c);
        }
    }
    out
}

/// Recursively sort object keys in a JSON value to produce canonical JSON.
///
/// Used by both the UUID-v5 audit hash and the SHA-256 certification hash.
/// The hash algorithm is chosen by the caller; this function only handles
/// the canonical serialization that feeds into it.
pub(crate) fn canonicalize(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut entries: Vec<_> = object.iter().collect();
            entries.sort_by(|(left, _), (right, _)| left.cmp(right));
            let mut canonical = Map::new();
            for (key, value) in entries {
                canonical.insert(key.clone(), canonicalize(value));
            }
            Value::Object(canonical)
        }
        Value::Array(items) => Value::Array(items.iter().map(canonicalize).collect()),
        other => other.clone(),
    }
}
