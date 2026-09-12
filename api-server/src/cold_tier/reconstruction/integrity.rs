//! Reconstruction identity, ordering, checksum and digest validation.

use super::super::{conventions, pg_codec};
use super::catalog::RestoreTable;
use super::protocol::{DurableWatermark, RestoreRow, TableDigest};
use anyhow::{anyhow, bail, Context, Result};
use serde_json::Value;
use sha2::{Digest, Sha256};
use stdb_client::StdbClient;

pub(super) fn validate_rows(
    rows: &[RestoreRow],
    table: &RestoreTable,
    organization_id: u64,
    after: Option<&Value>,
) -> Result<()> {
    let mut previous = after
        .map(|value| identity_key(value, &table.primary_key))
        .transpose()?;
    for row in rows {
        let identity = row
            .identity
            .as_object()
            .ok_or_else(|| anyhow!("restore row identity must be an object"))?;
        if identity.len() != 1 || !identity.contains_key(&table.primary_key) {
            bail!("restore row identity does not match generated primary key");
        }
        let object = row
            .row
            .as_object()
            .ok_or_else(|| anyhow!("restore row payload must be an object"))?;
        let primary_json_key = pg_codec::snake_to_camel(&table.primary_key);
        if object.get(&primary_json_key) != identity.get(&table.primary_key) {
            bail!("restore row identity does not match its payload");
        }
        let organization_json_key = pg_codec::snake_to_camel(&table.organization_column);
        if object.get(&organization_json_key).and_then(json_u64) != Some(organization_id) {
            bail!("restore row belongs to a different organization");
        }
        if row.checksum != canonical_checksum(&row.row)? {
            bail!("restore row checksum does not match its payload");
        }
        let current = identity_key(&row.identity, &table.primary_key)?;
        if previous.as_ref().is_some_and(|value| value >= &current) {
            bail!(
                "restore rows for '{}' are not in strict primary-key order: previous={:?}, current={:?}",
                table.table,
                previous,
                current
            );
        }
        previous = Some(current);
    }
    Ok(())
}

pub(super) fn identity_key(value: &Value, primary_key: &str) -> Result<(u8, String)> {
    let value = value
        .get(primary_key)
        .ok_or_else(|| anyhow!("restore row identity lacks generated primary key"))?;
    if let Some(number) = value.as_u64() {
        return Ok((0, format!("{number:020}")));
    }
    if let Some(text) = value.as_str() {
        if let Ok(number) = text.parse::<u64>() {
            return Ok((0, format!("{number:020}")));
        }
        return Ok((1, text.to_owned()));
    }
    bail!("restore row primary key must be a string or unsigned integer")
}

pub(crate) fn identity_text(value: &Value, primary_key: &str) -> Result<String> {
    let value = value
        .get(primary_key)
        .ok_or_else(|| anyhow!("restore row identity lacks generated primary key"))?;
    if let Some(number) = value.as_u64() {
        return Ok(number.to_string());
    }
    value
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| anyhow!("restore row primary key must be a string or unsigned integer"))
}

#[cfg(test)]
pub(super) fn digest_rows(rows: &[Value]) -> Result<TableDigest> {
    let mut canonical = rows
        .iter()
        .map(canonical_json)
        .collect::<Result<Vec<_>>>()?;
    canonical.sort();
    let mut digest = Sha256::new();
    for row in canonical {
        digest.update(row.as_bytes());
        digest.update(b"\n");
    }
    Ok(TableDigest {
        format_version: 1,
        row_count: rows.len() as u64,
        checksum: hex::encode(digest.finalize()),
    })
}

/// Version 2 hashes canonical rows in strict generated primary-key order, so
/// callers can verify arbitrarily large relations one bounded page at a time.
pub(crate) struct OrderedDigest {
    primary_key: String,
    previous: Option<(u8, String)>,
    row_count: u64,
    digest: Sha256,
}

impl OrderedDigest {
    #[must_use]
    pub(crate) fn new(primary_key: &str) -> Self {
        Self {
            primary_key: primary_key.to_owned(),
            previous: None,
            row_count: 0,
            digest: Sha256::new(),
        }
    }

    pub(crate) fn push(&mut self, identity: &Value, row: &Value) -> Result<()> {
        let key = identity_key(identity, &self.primary_key)?;
        if self
            .previous
            .as_ref()
            .is_some_and(|previous| previous >= &key)
        {
            bail!("incremental reconstruction digest rows are not in strict primary-key order");
        }
        let canonical = canonical_json(row)?;
        self.digest.update(canonical.as_bytes());
        self.digest.update(b"\n");
        self.previous = Some(key);
        self.row_count = self
            .row_count
            .checked_add(1)
            .context("reconstruction digest row count overflow")?;
        Ok(())
    }

    #[must_use]
    pub(crate) fn finish(self) -> TableDigest {
        TableDigest {
            format_version: 2,
            row_count: self.row_count,
            checksum: hex::encode(self.digest.finalize()),
        }
    }
}

pub(super) fn canonical_checksum(value: &Value) -> Result<String> {
    Ok(hex::encode(Sha256::digest(
        canonical_json(value)?.as_bytes(),
    )))
}

pub(super) fn canonical_json(value: &Value) -> Result<String> {
    serde_json::to_string(&conventions::canonicalize_json(value))
        .context("serialize canonical reconstruction row")
}

pub(super) fn validate_run_id(run_id: &str) -> Result<()> {
    if run_id.is_empty()
        || run_id.len() > 128
        || !run_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':'))
    {
        bail!("reconstruction run_id has an invalid shape");
    }
    Ok(())
}

pub(super) fn quote_identifier(identifier: &str) -> String {
    debug_assert!(conventions::validate_identifier(identifier).is_ok());
    format!("\"{identifier}\"")
}

pub(super) fn require_server_identity(stdb: &StdbClient) -> Result<()> {
    if stdb.token().trim().is_empty() || stdb.token() == "local-dev-token" {
        bail!("reconstruction requires a configured STDB server/admin identity");
    }
    Ok(())
}

pub(super) fn validate_watermark(value: &DurableWatermark) -> Result<()> {
    if value.sequence == 0 || !is_sha256_hex(&value.commit_checksum) {
        bail!("reconstruction watermark is malformed");
    }
    Ok(())
}

pub(super) fn validate_digest(value: &TableDigest) -> Result<()> {
    if !matches!(value.format_version, 1 | 2) {
        bail!("reconstruction table digest format is unsupported");
    }
    if !is_sha256_hex(&value.checksum) {
        bail!("reconstruction table digest is malformed");
    }
    Ok(())
}

pub(super) fn json_u64(value: &Value) -> Option<u64> {
    value.as_u64().or_else(|| value.as_str()?.parse().ok())
}

pub(super) fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod ordered_digest_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn version_two_digest_crosses_the_retired_row_limit_incrementally() {
        let mut digest = OrderedDigest::new("id");
        for id in 0..100_001u64 {
            let row = json!({"id": id, "organizationId": 7});
            digest.push(&json!({"id": id}), &row).unwrap();
        }
        let digest = digest.finish();
        assert_eq!(digest.format_version, 2);
        assert_eq!(digest.row_count, 100_001);
        assert!(is_sha256_hex(&digest.checksum));
    }

    #[test]
    fn version_two_digest_rejects_duplicate_or_reordered_pages() {
        let mut digest = OrderedDigest::new("id");
        digest.push(&json!({"id": 2}), &json!({"id": 2})).unwrap();
        assert!(digest.push(&json!({"id": 2}), &json!({"id": 2})).is_err());
        assert!(digest.push(&json!({"id": 1}), &json!({"id": 1})).is_err());
    }

    #[test]
    fn unsupported_digest_format_is_rejected() {
        let digest = TableDigest {
            format_version: 3,
            row_count: 0,
            checksum: "0".repeat(64),
        };
        assert!(validate_digest(&digest).is_err());
    }

    #[test]
    #[ignore = "explicit C7 scaling measurement"]
    fn benchmark_version_two_digest_at_larger_cardinality() {
        let started = std::time::Instant::now();
        let mut digest = OrderedDigest::new("id");
        for id in 0..250_000u64 {
            let row = json!({"id": id, "organizationId": 7, "amount": id % 10_000});
            digest.push(&json!({"id": id}), &row).unwrap();
        }
        let digest = digest.finish();
        assert_eq!(digest.row_count, 250_000);
        eprintln!(
            "c7_incremental_digest rows={} elapsed_us={}",
            digest.row_count,
            started.elapsed().as_micros()
        );
    }
}
