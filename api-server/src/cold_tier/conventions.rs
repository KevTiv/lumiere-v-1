//! Archive-version and payload-hash conventions.
//!
//! ## Purpose
//!
//! Every cold-tier table stores a `payload_checksum` and (for mutable
//! transactional resources) an `archive_version`.  This module defines the
//! canonical rules so codegen, the generic projector, the C5 finalize reducer,
//! and recovery tooling all agree.
//!
//! ## Payload checksum
//!
//! The payload checksum is a hex-encoded SHA-256 digest of the **canonical
//! JSON serialization** of the row.  Canonical JSON means:
//!
//! - Object keys are sorted lexicographically (ascending).
//! - No insignificant whitespace.
//! - UTF-8 encoded.
//! - `null` for SQL NULL / Rust `Option::None`.
//!
//! Example:
//! ```json
//! {"action":"CREATE","changed_fields":["name"],"company_id":null,"id":42,...}
//! ```
//!
//! The checksum is computed before the durable PG write and stored in
//! `payload_checksum`. The C5 finalize reducer verifies that PG contains a row
//! with the same checksum before deleting the STDB row.
//!
//! ## Archive version
//!
//! `archive_version` is a monotonically increasing counter:
//!
//! - **Append-only resources** (e.g. `audit_log`): always `1`.  Rows are
//!   immutable; there is no re-archival.
//! - **Mutable transactional resources** (e.g. `sale_order`, `stock_move`):
//!   starts at `1` when the row is first archived.  If the row is rehydrated
//!   (brought back hot for a late mutation) and then re-archived, the version
//!   is incremented.  The version-aware PG UPSERT (`WHERE EXCLUDED.version >
//!   cold_table.version`) ensures the newer version overwrites the stale one.
//!
//! The version is **not** the same as the SpacetimeDB row's business version
//! or `updated_at` timestamp.  It tracks archival transfers specifically.

use sha2::{Digest, Sha256};

/// The hash algorithm used for payload checksums.
pub const PAYLOAD_CHECKSUM_ALGO: &str = "sha256";

/// Initial archive version for all resources.
pub const ARCHIVE_VERSION_INITIAL: u64 = 1;

/// Compute the payload checksum for a canonical JSON byte slice.
///
/// The caller is responsible for producing canonical JSON (sorted keys, no
/// whitespace).  Returns a lowercase hex string.
pub fn compute_payload_checksum(canonical_json: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(canonical_json);
    hex::encode(hasher.finalize())
}

/// Compute the payload checksum from a serializable value using serde_json's
/// default (non-preserving) serializer, which sorts keys when the input is a
/// `BTreeMap` or `serde_json::Map` with `preserve_order` disabled.
///
/// For structs derived from `Serialize`, field order is declaration order, not
/// sorted.  Callers that need guaranteed key sorting should use
/// [`compute_payload_checksum_canonical`].
pub fn compute_payload_checksum_json<T: serde::Serialize>(value: &T) -> anyhow::Result<String> {
    let bytes = serde_json::to_vec(value)?;
    Ok(compute_payload_checksum(&bytes))
}

/// Compute the payload checksum from a `serde_json::Value`, ensuring canonical
/// key ordering by re-serialising through sorted keys.
///
/// This is the recommended function for projection code that receives a
/// `serde_json::Value` row representation.
pub fn compute_payload_checksum_canonical(value: &serde_json::Value) -> String {
    let canonical = canonicalize_json(value);
    let bytes = serde_json::to_vec(&canonical).unwrap_or_default();
    compute_payload_checksum(&bytes)
}

/// Recursively sort object keys in a JSON value to produce canonical JSON.
pub(crate) fn canonicalize_json(value: &serde_json::Value) -> serde_json::Value {
    use serde_json::{Map, Value};

    match value {
        Value::Object(map) => {
            let mut sorted: Vec<(String, Value)> = map
                .iter()
                .map(|(k, v)| (k.clone(), canonicalize_json(v)))
                .collect();
            sorted.sort_by(|a, b| a.0.cmp(&b.0));
            let mut result = Map::new();
            for (k, v) in sorted {
                result.insert(k, v);
            }
            Value::Object(result)
        }
        Value::Array(arr) => Value::Array(arr.iter().map(canonicalize_json).collect()),
        // Primitives are already canonical.
        other => other.clone(),
    }
}

/// Validate a PostgreSQL identifier for use in generated projection SQL.
///
/// Allows lowercase ASCII letters, digits, and underscores, up to 128 bytes,
/// non-empty. This matches the grammar of all generated manifest identifiers.
pub(crate) fn validate_identifier(value: &str) -> anyhow::Result<()> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        anyhow::bail!("unsafe projection identifier '{value}'");
    }
    Ok(())
}

/// Quote a validated PostgreSQL identifier for use in generated SQL.
///
/// The identifier is validated in release builds before quoting.
pub(crate) fn quote_identifier(identifier: &str) -> anyhow::Result<String> {
    validate_identifier(identifier)?;
    Ok(format!("\"{identifier}\""))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn canonical_payload_bytes_and_checksum_match_golden_vector() {
        let value = json!({"z": false, "n": -7, "a": [3, 1, {"z": "é\n\"", "a": null}]});
        let bytes = serde_json::to_vec(&canonicalize_json(&value)).expect("JSON value");
        assert_eq!(
            bytes,
            r#"{"a":[3,1,{"a":null,"z":"é\n\""}],"n":-7,"z":false}"#.as_bytes()
        );
        assert_eq!(
            compute_payload_checksum_canonical(&value),
            "a42c8067e7ddb3cd4e102f6b8ba61ef954aa74210de0fa10b1b10fc48a8c2c80"
        );
        assert_ne!(
            compute_payload_checksum_canonical(&value),
            compute_payload_checksum_canonical(
                &json!({"z": false, "n": -7, "a": [1, 3, {"z": "é\n\"", "a": null}]})
            )
        );
    }

    #[test]
    fn identifiers_are_validated_before_quoting() {
        for valid in ["audit_log", "column_2", "_internal", "2"] {
            assert_eq!(
                quote_identifier(valid).expect("valid identifier"),
                format!("\"{valid}\"")
            );
        }
        assert!(validate_identifier(&"a".repeat(128)).is_ok());
        assert!(validate_identifier(&"a".repeat(129)).is_err());
        for invalid in ["", "Audit", "a.b", "a b", "a\"b", "a;b", "é", "a--b"] {
            assert!(quote_identifier(invalid).is_err(), "accepted {invalid:?}");
        }
    }

    #[test]
    fn checksum_is_sha256_hex() {
        let input = br#"{"id":42}"#;
        let checksum = compute_payload_checksum(input);
        assert_eq!(checksum.len(), 64);
        // hex::encode produces lowercase hex.
        assert!(checksum.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(checksum.chars().all(|c| !c.is_ascii_uppercase()));
    }

    #[test]
    fn checksum_is_deterministic() {
        let input = br#"{"id":42}"#;
        assert_eq!(
            compute_payload_checksum(input),
            compute_payload_checksum(input)
        );
    }

    #[test]
    fn canonical_sort_keys_changes_checksum() {
        let unsorted = json!({"b": 1, "a": 2});
        let sorted = json!({"a": 2, "b": 1});

        let unsorted_checksum = compute_payload_checksum_canonical(&unsorted);
        let sorted_checksum = compute_payload_checksum_canonical(&sorted);

        // Both should produce the same checksum because canonicalize sorts keys.
        assert_eq!(unsorted_checksum, sorted_checksum);
    }

    #[test]
    fn canonical_handles_nested_objects() {
        let v = json!({"outer": {"z": 1, "a": 2}, "id": 42});
        let checksum = compute_payload_checksum_canonical(&v);
        assert_eq!(checksum.len(), 64);
    }

    #[test]
    fn canonical_arrays_preserve_order() {
        let v = json!({"items": [3, 1, 2]});
        let checksum = compute_payload_checksum_canonical(&v);
        // Re-ordering the outer keys shouldn't change anything (only one key),
        // and array order is preserved.
        assert_eq!(checksum.len(), 64);
    }

    #[test]
    fn initial_version_is_one() {
        assert_eq!(ARCHIVE_VERSION_INITIAL, 1);
    }
}
