//! Projection wire-row decoding.

use super::super::commit_projection;
use anyhow::{anyhow, bail, Context, Result};
use serde_json::Value;

pub(super) fn require_u64(row: &Value, field: &str) -> Result<u64> {
    row.get(field)
        .and_then(Value::as_u64)
        .ok_or_else(|| anyhow!("projection {field}: expected u64"))
}

fn require_string(row: &Value, field: &str) -> Result<String> {
    row.get(field)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| anyhow!("projection {field}: expected string"))
}

pub(super) fn parse_timestamp(row: &Value) -> Result<i64> {
    row.get("microsSinceUnixEpoch")
        .and_then(Value::as_i64)
        .ok_or_else(|| anyhow!("projection occurredAt: expected microsSinceUnixEpoch"))
}

fn parse_identity(value: &Value) -> Result<String> {
    let raw = value
        .as_str()
        .or_else(|| value.get("__identity__").and_then(Value::as_str))
        .ok_or_else(|| anyhow!("projection actorIdentity: expected identity string"))?;
    let raw = raw.strip_prefix("0x").unwrap_or(raw);
    if raw.len() != 64 || !raw.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        bail!("projection actorIdentity: expected 32-byte hexadecimal identity");
    }
    Ok(raw.to_ascii_lowercase())
}

pub(super) fn parse_commit(row: &Value) -> Result<commit_projection::OrganizationCommitEnvelope> {
    let row_change_count = u32::try_from(require_u64(row, "rowChangeCount")?)
        .context("decode projection rowChangeCount")?;
    Ok(commit_projection::OrganizationCommitEnvelope {
        id: require_string(row, "id")?,
        organization_id: require_u64(row, "organizationId")?,
        sequence: require_u64(row, "sequence")?,
        operation_id: require_string(row, "operationId")?,
        correlation_id: require_string(row, "correlationId")?,
        change_schema_version: u32::try_from(require_u64(row, "changeSchemaVersion")?)
            .context("decode projection changeSchemaVersion")?,
        contract_version: require_string(row, "contractVersion")?,
        occurred_at_micros: parse_timestamp(
            row.get("occurredAt")
                .ok_or_else(|| anyhow!("projection occurredAt is missing"))?,
        )?,
        actor_identity_hex: parse_identity(
            row.get("actorIdentity")
                .ok_or_else(|| anyhow!("projection actorIdentity is missing"))?,
        )?,
        row_change_count,
        checksum: require_string(row, "checksum")?,
    })
}

pub(super) fn parse_change(row: &Value) -> Result<commit_projection::OrganizationRowChangeInput> {
    Ok(commit_projection::OrganizationRowChangeInput {
        id: require_string(row, "id")?,
        organization_id: require_u64(row, "organizationId")?,
        commit_sequence: require_u64(row, "commitSequence")?,
        ordinal: u32::try_from(require_u64(row, "ordinal")?)
            .context("decode projection ordinal")?,
        table_name: require_string(row, "tableName")?,
        row_identity_json: require_string(row, "rowIdentityJson")?,
        change_kind: require_string(row, "changeKind")?,
        row_json: row
            .get("rowJson")
            .and_then(Value::as_str)
            .map(str::to_owned),
        checksum: require_string(row, "checksum")?,
    })
}
