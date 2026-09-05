//! Bounded C5 finalization worker for the append-only `audit_log` aggregate.
//!
//! The coordinator owns scheduling, readiness, and metrics. This module only
//! performs one bounded transfer pass:
//!
//! 1. read a bounded STDB batch;
//! 2. upsert each complete row into `cold_audit_log` and verify the returned
//!    payload checksum;
//! 3. record the transfer in the durable ledger;
//! 4. invoke the denied, trusted-identity finalizer reducer; and
//! 5. mark the ledger row finalized.
//!
//! `audit_log` is immutable, so its archive version is always `1` and its
//! canonical payload checksum is the exact-row proof used by the reducer.
//! Malformed rows and ledger failures fail closed for that row: a row is never
//! deleted from STDB unless the archive write and ledger record succeeded.

use anyhow::{anyhow, Context, Result};
use deadpool_postgres::Pool;
use serde_json::{json, Value};
use stdb_client::StdbClient;

use crate::cold_tier::{commit_projection, conventions, ledger};

const MAX_BATCH_SIZE: u32 = 200;
const DURABILITY_PROOF_SQL: &str =
    "SELECT change.commit_sequence::TEXT, watermark.applied_sequence::TEXT, \
            envelope.change_schema_version, envelope.contract_version \
     FROM organization_row_change change \
     JOIN organization_projection_watermark watermark \
       ON watermark.organization_id = change.organization_id \
      AND watermark.applied_sequence >= change.commit_sequence \
     JOIN organization_commit envelope \
       ON envelope.organization_id = change.organization_id \
      AND envelope.sequence = change.commit_sequence \
     WHERE change.organization_id = $1::TEXT::NUMERIC \
       AND change.table_name = 'audit_log' \
       AND change.row_identity_json = $2::JSONB \
       AND change.change_kind = 'upsert' \
     ORDER BY change.commit_sequence DESC \
     LIMIT 1";
const UPSERT_COLD_AUDIT_LOG_SQL: &str = "INSERT INTO cold_audit_log \
        (id, organization_id, company_id, table_name, record_id, action, \
         old_values, new_values, changed_fields, user_identity, session_id, \
         ip_address, user_agent, timestamp, metadata, payload_checksum) \
     VALUES \
        ($1::TEXT::NUMERIC, $2::TEXT::NUMERIC, $3::TEXT::NUMERIC, $4, $5::TEXT::NUMERIC, $6, \
         $7, $8, $9::JSONB, $10, $11::TEXT::NUMERIC, \
         $12, $13, $14, $15, $16) \
     ON CONFLICT (id) DO UPDATE SET \
        organization_id = EXCLUDED.organization_id, \
        company_id = EXCLUDED.company_id, \
        table_name = EXCLUDED.table_name, \
        record_id = EXCLUDED.record_id, \
        action = EXCLUDED.action, \
        old_values = EXCLUDED.old_values, \
        new_values = EXCLUDED.new_values, \
        changed_fields = EXCLUDED.changed_fields, \
        user_identity = EXCLUDED.user_identity, \
        session_id = EXCLUDED.session_id, \
        ip_address = EXCLUDED.ip_address, \
        user_agent = EXCLUDED.user_agent, \
        timestamp = EXCLUDED.timestamp, \
        metadata = EXCLUDED.metadata, \
        payload_checksum = EXCLUDED.payload_checksum \
     RETURNING payload_checksum";
const COLD_TRANSFER_PROOF_SQL: &str = "SELECT 1 FROM cold_audit_log \
     WHERE id = $1::TEXT::NUMERIC AND organization_id = $2::TEXT::NUMERIC \
       AND payload_checksum = $3";

#[derive(Debug)]
struct AuditRow {
    id_u64: u64,
    id: String,
    organization_id: String,
    company_id: Option<String>,
    table_name: String,
    record_id: String,
    action: String,
    old_values: Option<String>,
    new_values: Option<String>,
    changed_fields_json: String,
    identity_bytes: Vec<u8>,
    session_id: Option<String>,
    ip_address: Option<String>,
    user_agent: Option<String>,
    timestamp_micros: i64,
    metadata: Option<String>,
    checksum: String,
}

/// Drain at most [`MAX_BATCH_SIZE`] rows and return per-stage counts.
///
/// Individual malformed rows or failed finalizations are counted and do not
/// prevent later rows in the bounded batch from being attempted. A failed
/// query is returned because retrying the same batch is the coordinator's
/// recovery boundary.
pub async fn drain_batch(
    source_stdb: &StdbClient,
    finalizer_stdb: &StdbClient,
    pool: &Pool,
    batch_size: u32,
) -> Result<super::CandidateDrainStats> {
    let batch_size = bounded_batch_size(batch_size)?;

    let mut stats = super::CandidateDrainStats::default();
    reconcile_pending(pool, source_stdb, batch_size, &mut stats).await?;

    let sql = format!(
        "SELECT id, organization_id, company_id, table_name, record_id, action, \
                old_values, new_values, changed_fields, user_identity, session_id, \
                ip_address, user_agent, timestamp, metadata \
         FROM audit_log ORDER BY id ASC LIMIT {batch_size}"
    );
    let raw_rows = source_stdb
        .query_sql(&sql)
        .await
        .context("query audit_log finalization batch")?;

    stats.read = raw_rows.len();
    for raw in &raw_rows {
        match drain_one(pool, finalizer_stdb, raw).await {
            Ok(()) => {
                stats.archived += 1;
                stats.finalized += 1;
            }
            Err(error) => {
                stats.failed += 1;
                tracing::error!(%error, row = %raw, "audit finalization row failed");
            }
        }
    }
    Ok(stats)
}

/// Repair the transfer ledger after an ambiguous/crashed reducer call.
///
/// The worker marks a transfer finalized only when the hot row is absent and
/// the organization-scoped cold row still has the exact ledger checksum.
/// A present row is left pending for the normal finalization path.
async fn reconcile_pending(
    pool: &Pool,
    stdb: &StdbClient,
    batch_size: u32,
    stats: &mut super::CandidateDrainStats,
) -> Result<()> {
    for transfer in ledger::pending_transfers(pool, "audit_log", batch_size).await? {
        let result = async {
            let id: u64 = transfer
                .row_id
                .parse()
                .context("parse pending audit_log id")?;
            let organization_id: u64 = transfer
                .organization_id
                .parse()
                .context("parse pending audit_log organization")?;
            if transfer.resource != "audit_log" || transfer.archive_version != 1 {
                anyhow::bail!("pending audit_log transfer has an invalid resource or version");
            }
            let hot = stdb
                .query_sql(&format!(
                    "SELECT id, organization_id FROM audit_log WHERE id = {id} LIMIT 1"
                ))
                .await
                .context("check pending audit_log hot row")?;
            if let Some(row) = hot.first() {
                if row.get("organizationId").and_then(Value::as_u64) != Some(organization_id) {
                    anyhow::bail!("pending audit_log transfer organization disagrees with hot row");
                }
                return Ok(false);
            }

            let client = pool
                .get()
                .await
                .context("get PG client for audit_log reconciliation")?;
            let cold = client
                .query_opt(
                    COLD_TRANSFER_PROOF_SQL,
                    &[
                        &transfer.row_id,
                        &transfer.organization_id,
                        &transfer.payload_checksum,
                    ],
                )
                .await
                .context("verify pending cold_audit_log transfer")?;
            if cold.is_none() {
                anyhow::bail!("pending audit_log transfer has no exact cold-row proof");
            }
            ledger::mark_finalized(pool, "audit_log", &transfer.row_id).await?;
            Ok(true)
        }
        .await;

        match result {
            Ok(true) => stats.reconciled += 1,
            Ok(false) => {}
            Err(error) => {
                stats.failed += 1;
                tracing::error!(%error, row_id = %transfer.row_id, "audit finalization reconciliation failed");
            }
        }
    }
    Ok(())
}

async fn drain_one(pool: &Pool, finalizer_stdb: &StdbClient, raw: &Value) -> Result<()> {
    let row = parse_audit_row(raw)?;
    verify_durable_projection(pool, row.organization_id.parse()?, row.id_u64).await?;
    upsert_cold_audit_log(pool, &row).await?;

    // The ledger is part of the deletion proof. Do not delete from STDB when
    // this durable bookkeeping write is unavailable.
    ledger::record_transfer(
        pool,
        "audit_log",
        &row.id,
        &row.organization_id,
        1,
        &row.checksum,
    )
    .await
    .context("record audit_log archive transfer")?;

    finalizer_stdb
        .call_reducer(stdb_client::reducer_call!(
            "finalize_audit_log_archive",
            json!([row.id_u64, row.checksum]),
        ))
        .await
        .context("call finalize_audit_log_archive")?;

    ledger::mark_finalized(pool, "audit_log", &row.id)
        .await
        .context("mark audit_log archive transfer finalized")?;
    Ok(())
}

/// Prove the source row's latest append is covered by the contiguous PG
/// projection watermark before creating the archive copy. The STDB reducer
/// still authenticates the exact row through its canonical checksum and
/// trusted service identity immediately before deletion.
async fn verify_durable_projection(pool: &Pool, organization_id: u64, id: u64) -> Result<()> {
    let client = pool
        .get()
        .await
        .context("get PG client for audit_log durability proof")?;
    let organization_id_text = organization_id.to_string();
    let identity = json!({"id": id}).to_string();
    let row = client
        .query_opt(DURABILITY_PROOF_SQL, &[&organization_id_text, &identity])
        .await
        .context("query audit_log durable projection proof")?
        .ok_or_else(|| {
            anyhow!("audit_log {id}: exact durable projection and watermark are not yet available")
        })?;
    let row_commit_sequence: String = row.get(0);
    let durable_watermark: String = row.get(1);
    let change_schema_version: i32 = row.get(2);
    let contract_version: String = row.get(3);
    let row_commit_sequence: u64 = row_commit_sequence
        .parse()
        .context("parse audit_log row commit sequence")?;
    let durable_watermark: u64 = durable_watermark
        .parse()
        .context("parse audit_log durable projection watermark")?;
    if row_commit_sequence == 0 || durable_watermark < row_commit_sequence {
        return Err(anyhow!(
            "audit_log {id}: durable watermark {durable_watermark} does not cover row commit {row_commit_sequence}"
        ));
    }
    if change_schema_version != commit_projection::CHANGE_SCHEMA_VERSION as i32
        || contract_version != commit_projection::CONTRACT_VERSION
    {
        return Err(anyhow!(
            "audit_log {id}: durable projection has an incompatible schema/contract version"
        ));
    }
    Ok(())
}

async fn upsert_cold_audit_log(pool: &Pool, row: &AuditRow) -> Result<()> {
    let client = pool
        .get()
        .await
        .context("get PG client for cold_audit_log upsert")?;
    let archived = client
        .query_one(
            UPSERT_COLD_AUDIT_LOG_SQL,
            &[
                &row.id,
                &row.organization_id,
                &row.company_id,
                &row.table_name,
                &row.record_id,
                &row.action,
                &row.old_values,
                &row.new_values,
                &row.changed_fields_json,
                &row.identity_bytes,
                &row.session_id,
                &row.ip_address,
                &row.user_agent,
                &row.timestamp_micros,
                &row.metadata,
                &row.checksum,
            ],
        )
        .await
        .context("upsert cold_audit_log")?;
    let archived_checksum: String = archived.get(0);
    if archived_checksum != row.checksum {
        return Err(anyhow!(
            "cold_audit_log {}: returned checksum does not match the exact source payload",
            row.id
        ));
    }
    Ok(())
}

fn parse_audit_row(raw: &Value) -> Result<AuditRow> {
    let id_u64 = require_u64(raw, "id")?;
    let organization_id_u64 = require_u64(raw, "organizationId")?;
    let company_id = optional_u64_string(raw, "companyId")?;
    let table_name = require_string(raw, "tableName")?;
    let record_id_u64 = require_u64(raw, "recordId")?;
    let action = require_string(raw, "action")?;
    let old_values = optional_string(raw, "oldValues")?;
    let new_values = optional_string(raw, "newValues")?;
    let changed_fields = changed_fields_array(raw, "changedFields")?;
    let (identity_hex, identity_bytes) = identity_hex_and_bytes(raw, "userIdentity")?;
    let session_id = optional_u64_string(raw, "sessionId")?;
    let ip_address = optional_string(raw, "ipAddress")?;
    let user_agent = optional_string(raw, "userAgent")?;
    let timestamp_micros = timestamp_micros_i64(raw, "timestamp")?;
    let metadata = optional_string(raw, "metadata")?;
    let id = id_u64.to_string();
    let organization_id = organization_id_u64.to_string();
    let record_id = record_id_u64.to_string();
    let changed_fields_json =
        serde_json::to_string(&changed_fields).context("serialize audit_log.changed_fields")?;
    let checksum = conventions::compute_payload_checksum_canonical(&canonical_row_json(
        &id,
        &organization_id,
        company_id.as_deref(),
        &table_name,
        &record_id,
        &action,
        old_values.as_deref(),
        new_values.as_deref(),
        &changed_fields,
        &identity_hex,
        session_id.as_deref(),
        ip_address.as_deref(),
        user_agent.as_deref(),
        timestamp_micros,
        metadata.as_deref(),
    ));

    Ok(AuditRow {
        id_u64,
        id,
        organization_id,
        company_id,
        table_name,
        record_id,
        action,
        old_values,
        new_values,
        changed_fields_json,
        identity_bytes,
        session_id,
        ip_address,
        user_agent,
        timestamp_micros,
        metadata,
        checksum,
    })
}

fn bounded_batch_size(value: u32) -> Result<u32> {
    if value == 0 {
        anyhow::bail!("audit finalization batch size must be positive");
    }
    Ok(value.min(MAX_BATCH_SIZE))
}

#[allow(clippy::too_many_arguments)]
fn canonical_row_json(
    id: &str,
    organization_id: &str,
    company_id: Option<&str>,
    table_name: &str,
    record_id: &str,
    action: &str,
    old_values: Option<&str>,
    new_values: Option<&str>,
    changed_fields: &[String],
    user_identity_hex: &str,
    session_id: Option<&str>,
    ip_address: Option<&str>,
    user_agent: Option<&str>,
    timestamp_micros: i64,
    metadata: Option<&str>,
) -> Value {
    json!({
        "action": action,
        "changed_fields": changed_fields,
        "company_id": company_id,
        "id": id,
        "ip_address": ip_address,
        "metadata": metadata,
        "new_values": new_values,
        "old_values": old_values,
        "organization_id": organization_id,
        "record_id": record_id,
        "session_id": session_id,
        "table_name": table_name,
        "timestamp": timestamp_micros.to_string(),
        "user_agent": user_agent,
        "user_identity": user_identity_hex,
    })
}

fn require_u64(row: &Value, field: &str) -> Result<u64> {
    row.get(field)
        .and_then(Value::as_u64)
        .ok_or_else(|| anyhow!("audit_log.{field}: expected u64, got {:?}", row.get(field)))
}

fn optional_u64_string(row: &Value, field: &str) -> Result<Option<String>> {
    match row.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_u64()
            .map(|number| Some(number.to_string()))
            .ok_or_else(|| anyhow!("audit_log.{field}: expected u64 or null, got {value}")),
    }
}

fn require_string(row: &Value, field: &str) -> Result<String> {
    row.get(field)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| {
            anyhow!(
                "audit_log.{field}: expected string, got {:?}",
                row.get(field)
            )
        })
}

fn optional_string(row: &Value, field: &str) -> Result<Option<String>> {
    match row.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(value) => Err(anyhow!(
            "audit_log.{field}: expected string or null, got {value}"
        )),
    }
}

fn changed_fields_array(row: &Value, field: &str) -> Result<Vec<String>> {
    row.get(field)
        .and_then(Value::as_array)
        .ok_or_else(|| {
            anyhow!(
                "audit_log.{field}: expected array, got {:?}",
                row.get(field)
            )
        })?
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| anyhow!("audit_log.{field}: non-string element {value}"))
        })
        .collect()
}

fn timestamp_micros_i64(row: &Value, field: &str) -> Result<i64> {
    row.get(field)
        .and_then(|value| value.get("microsSinceUnixEpoch"))
        .and_then(Value::as_i64)
        .ok_or_else(|| {
            anyhow!(
                "audit_log.{field}: expected {{microsSinceUnixEpoch}}, got {:?}",
                row.get(field)
            )
        })
}

fn identity_hex_and_bytes(row: &Value, field: &str) -> Result<(String, Vec<u8>)> {
    let value = row
        .get(field)
        .ok_or_else(|| anyhow!("audit_log.{field}: missing"))?;
    match value {
        Value::String(value) => {
            let stripped = value
                .strip_prefix("0x")
                .or_else(|| value.strip_prefix("0X"))
                .unwrap_or(value);
            if stripped.len() != 64
                || !stripped
                    .chars()
                    .all(|character| character.is_ascii_hexdigit())
            {
                anyhow::bail!("audit_log.{field}: expected 64 hex chars, got '{value}'");
            }
            let lower = stripped.to_ascii_lowercase();
            let bytes =
                hex::decode(&lower).with_context(|| format!("audit_log.{field}: hex decode"))?;
            Ok((lower, bytes))
        }
        Value::Array(values) => {
            if values.len() != 32 {
                anyhow::bail!(
                    "audit_log.{field}: expected 32-byte array, got len {}",
                    values.len()
                );
            }
            let bytes = values
                .iter()
                .map(|value| {
                    value
                        .as_u64()
                        .filter(|number| *number <= 255)
                        .map(|number| number as u8)
                        .ok_or_else(|| anyhow!("audit_log.{field}: non-byte element {value}"))
                })
                .collect::<Result<Vec<_>>>()?;
            Ok((hex::encode(&bytes), bytes))
        }
        other => anyhow::bail!("audit_log.{field}: expected hex string or byte array, got {other}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_row() -> Value {
        json!({
            "id": 42,
            "organizationId": 7,
            "companyId": 3,
            "tableName": "sale_order",
            "recordId": 100,
            "action": "CREATE",
            "oldValues": null,
            "newValues": "{\"state\":\"draft\"}",
            "changedFields": ["state"],
            "userIdentity": "AB".repeat(32),
            "sessionId": null,
            "ipAddress": "127.0.0.1",
            "userAgent": "test-agent",
            "timestamp": {"microsSinceUnixEpoch": 1_781_987_714_525_004_i64},
            "metadata": null,
        })
    }

    #[test]
    fn parses_complete_row_and_computes_checksum() {
        let row = parse_audit_row(&sample_row()).expect("parse");
        assert_eq!(row.id, "42");
        assert_eq!(row.organization_id, "7");
        assert_eq!(row.identity_bytes.len(), 32);
        assert_eq!(row.checksum.len(), 64);
    }

    #[test]
    fn rejects_missing_or_malformed_identity_without_defaults() {
        let mut missing_id = sample_row();
        missing_id.as_object_mut().expect("object").remove("id");
        assert!(parse_audit_row(&missing_id)
            .expect_err("missing id must fail")
            .to_string()
            .contains("audit_log.id"));

        let mut malformed_identity = sample_row();
        malformed_identity["userIdentity"] = json!("not-hex");
        assert!(parse_audit_row(&malformed_identity)
            .expect_err("malformed identity must fail")
            .to_string()
            .contains("userIdentity"));
    }

    #[test]
    fn checksum_changes_when_payload_changes() {
        let base = parse_audit_row(&sample_row()).expect("parse");
        let mut changed = sample_row();
        changed["action"] = json!("UPDATE");
        let changed = parse_audit_row(&changed).expect("parse");
        assert_ne!(base.checksum, changed.checksum);
    }

    #[test]
    fn byte_array_identity_matches_hex_identity() {
        let mut bytes = sample_row();
        bytes["userIdentity"] = json!(vec![0xabu64; 32]);
        let hex = sample_row();
        let bytes = parse_audit_row(&bytes).expect("parse");
        let hex = parse_audit_row(&hex).expect("parse");
        assert_eq!(bytes.identity_bytes, hex.identity_bytes);
        assert_eq!(bytes.checksum, hex.checksum);
    }

    #[test]
    fn batch_size_is_positive_and_bounded() {
        assert!(bounded_batch_size(0).is_err());
        assert_eq!(bounded_batch_size(1).expect("one row"), 1);
        assert_eq!(
            bounded_batch_size(u32::MAX).expect("clamped"),
            MAX_BATCH_SIZE
        );
    }

    #[test]
    fn upsert_is_idempotent_and_checksum_checked() {
        assert!(UPSERT_COLD_AUDIT_LOG_SQL.contains("ON CONFLICT (id) DO UPDATE SET"));
        assert!(UPSERT_COLD_AUDIT_LOG_SQL.contains("RETURNING payload_checksum"));
        assert!(UPSERT_COLD_AUDIT_LOG_SQL.contains("payload_checksum = EXCLUDED.payload_checksum"));
    }

    #[test]
    fn durability_proof_requires_contiguous_projection_watermark() {
        assert!(DURABILITY_PROOF_SQL.contains("organization_projection_watermark"));
        assert!(
            DURABILITY_PROOF_SQL.contains("watermark.applied_sequence >= change.commit_sequence")
        );
        assert!(DURABILITY_PROOF_SQL.contains("envelope.contract_version"));
    }
}
