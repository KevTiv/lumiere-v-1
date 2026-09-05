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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn canonical_bytes_preserve_unicode_escaping_and_array_order() {
        let value = json!({"z": false, "n": -7, "a": [3, 1, {"z": "é\n\"", "a": null}]});
        assert_eq!(
            serde_json::to_vec(&canonicalize(&value)).expect("JSON value"),
            r#"{"a":[3,1,{"a":null,"z":"é\n\""}],"n":-7,"z":false}"#.as_bytes()
        );
    }

    #[test]
    fn row_ids_preserve_alias_priority_and_unsigned_bounds() {
        for value in [json!(0), json!(u64::MAX), json!("18446744073709551615")] {
            assert!(row_u64(&json!({"company_id": value}), "companyId", "company_id").is_some());
        }
        for value in [
            json!(-1),
            json!(1.5),
            json!("18446744073709551616"),
            json!({}),
            Value::Null,
        ] {
            assert_eq!(
                row_u64(
                    &json!({"companyId": value, "company_id": 42}),
                    "companyId",
                    "company_id"
                ),
                None
            );
        }
        assert_eq!(
            row_u64(
                &json!({"companyId": 0, "company_id": 42}),
                "companyId",
                "company_id"
            ),
            Some(0)
        );
        assert_eq!(row_u64(&json!({}), "companyId", "company_id"), None);
    }
}
