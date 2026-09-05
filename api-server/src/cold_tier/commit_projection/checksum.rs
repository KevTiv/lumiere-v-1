//! Canonical checksum helpers; algorithms are unchanged.

use std::{collections::BTreeSet, sync::OnceLock};

use anyhow::{anyhow, bail, Context, Result};
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::{OrganizationCommitEnvelope, PreparedChange};

const LOCKED_OPERATION_MANIFEST_JSON: &str =
    include_str!("../../../../lumiere-codegen/contract-operation-ids.json");
static LOCKED_OPERATION_IDS: OnceLock<Result<BTreeSet<String>, String>> = OnceLock::new();

#[cfg(test)]
pub(super) fn projection_plan(change_kinds: &[&str]) -> Vec<String> {
    let mut plan = vec!["lock_watermark", "insert_commit"]
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>();
    plan.extend((0..change_kinds.len()).map(|ordinal| format!("insert_change:{ordinal}")));
    plan.extend((0..change_kinds.len()).map(|ordinal| format!("apply_change:{ordinal}")));
    plan.push("advance_watermark".to_string());
    plan.push("commit".to_string());
    plan
}

pub(super) fn parse_canonical_json(text: &str, label: &str) -> Result<Value> {
    let value: Value = serde_json::from_str(text).with_context(|| format!("parse {label} JSON"))?;
    let canonical = canonical_json(&value)?;
    if canonical != text {
        bail!("{label} JSON is not canonical");
    }
    Ok(value)
}

pub(super) fn canonical_json(value: &Value) -> Result<String> {
    serde_json::to_string(&super::super::conventions::canonicalize_json(value))
        .context("serialize canonical JSON")
}

pub(super) fn change_checksum(table: &str, identity: &str, kind: &str, row: &str) -> String {
    sha256_hex(format!("{table}\n{identity}\n{kind}\n{row}").as_bytes())
}

pub(super) fn commit_checksum(
    commit: &OrganizationCommitEnvelope,
    changes: &[PreparedChange],
) -> String {
    let fields = [
        commit.organization_id.to_string(),
        commit.sequence.to_string(),
        commit.change_schema_version.to_string(),
        commit.operation_id.clone(),
        commit.correlation_id.clone(),
        commit.contract_version.clone(),
        commit.occurred_at_micros.to_string(),
        commit.actor_identity_hex.clone(),
        changes.len().to_string(),
    ];
    let mut digest = Sha256::new();
    for field in fields {
        digest.update(field.len().to_string().as_bytes());
        digest.update(b":");
        digest.update(field.as_bytes());
    }
    for change in changes {
        digest.update(change.input.checksum.as_bytes());
    }
    hex::encode(digest.finalize())
}

pub(super) fn decode_identity(identity: &str) -> Result<Vec<u8>> {
    if identity.len() != 64
        || !identity
            .chars()
            .all(|character| character.is_ascii_digit() || character.is_ascii_lowercase())
    {
        bail!("actor identity must be 64 lowercase hexadecimal characters");
    }
    Ok(hex::decode(identity)?)
}

pub(super) fn validate_token(name: &str, value: &str) -> Result<()> {
    if value.is_empty() || value.trim() != value || value.len() > 256 {
        bail!("{name} must be non-empty, trimmed, and at most 256 bytes");
    }
    Ok(())
}

pub(super) fn validate_operation_id(value: &str) -> Result<()> {
    validate_token("operation_id", value)?;
    let Some(suffix) = value.strip_prefix("erp.") else {
        bail!("operation_id must use a canonical erp.* contract ID");
    };
    if suffix.is_empty()
        || !suffix
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        bail!("operation_id must use a canonical erp.<snake_case> contract ID");
    }
    if !locked_operation_ids()?.contains(value) {
        bail!("operation_id is not present in the locked contract manifest");
    }
    Ok(())
}

pub(super) fn locked_operation_ids() -> Result<&'static BTreeSet<String>> {
    let result = LOCKED_OPERATION_IDS.get_or_init(|| {
        let manifest: Value = serde_json::from_str(LOCKED_OPERATION_MANIFEST_JSON)
            .map_err(|error| format!("parse locked contract-operation-ids.json: {error}"))?;
        if manifest.get("schema_version").and_then(Value::as_u64) != Some(1) {
            return Err("locked operation manifest has unsupported schema_version".into());
        }
        let operations = manifest
            .get("operations")
            .and_then(Value::as_object)
            .ok_or_else(|| "locked operation manifest lacks operations object".to_string())?;
        let ids: BTreeSet<String> = operations
            .values()
            .map(|value| {
                value
                    .as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| "locked operation manifest contains a non-string ID".to_string())
            })
            .collect::<std::result::Result<_, _>>()?;
        if ids.len() != operations.len() {
            return Err("locked operation manifest contains duplicate IDs".into());
        }
        Ok(ids)
    });
    result.as_ref().map_err(|error| anyhow!("{error}"))
}

pub(super) fn commit_id(organization_id: u64, sequence: u64) -> String {
    format!("{organization_id}:{sequence}")
}

pub(super) fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
