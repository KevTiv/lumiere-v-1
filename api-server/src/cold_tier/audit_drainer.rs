//! Audit-log cold drainer: STDB `audit_log` → PG `cold_audit_log`.
//!
//! Implements the Phase 1 worker flow from
//! `docs/plans/audit-log-cold-by-default.md` §5:
//!
//! 1. Read a bounded batch of `audit_log` rows ordered by `id`.
//! 2. Compute each row's canonical checksum (must match
//!    `spacetimedb/src/core/audit.rs::audit_log_canonical_checksum` exactly
//!    — see the note on that function for why the two can't share code).
//! 3. UPSERT into `cold_audit_log`.
//! 4. Record the transfer in the `archive_transfer` ledger.
//! 5. Call `finalize_audit_log_archive` to delete the STDB row.
//! 6. Mark the ledger row finalized.
//!
//! Because `audit_log` rows are immutable and append-only, there is no
//! version-aware UPSERT here (`ON CONFLICT (id) DO NOTHING` is correct — the
//! row can never change after insert, so a retry writes the identical row).
//! A crash at any point before step 5 is safe to retry: the STDB row is
//! still there, the UPSERT is idempotent, and `record_transfer` overwrites
//! its own prior attempt. A crash between step 5 and 6 is also safe: the
//! next batch will simply not see that row again (it's gone from STDB), and
//! [`crate::cold_tier::ledger::mark_finalized`] can be re-run for stragglers
//! by a recovery/audit job if needed.

use std::{
    net::SocketAddr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use anyhow::{anyhow, Context, Result};
use axum::{http::StatusCode, routing::get, Router};
use deadpool_postgres::Pool;
use serde_json::{json, Value};
use stdb_client::StdbClient;

use super::{conventions, ledger, migrate, pg_pool};
use crate::config::Config;
use crate::state::AppState;

#[derive(Debug, Default, Clone, Copy)]
pub struct DrainStats {
    pub read: usize,
    pub upserted: usize,
    pub finalized: usize,
    pub failed: usize,
}

/// One `audit_log` row, decoded from the STDB SQL HTTP response into the
/// exact values needed for the PG UPSERT, the ledger, and the reducer call.
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

/// Read a bounded batch, drain each row, and return counts. Errors on
/// individual rows are logged and counted, not propagated — one malformed
/// row must not stall the whole batch.
pub async fn drain_batch(stdb: &StdbClient, pool: &Pool, batch_size: u32) -> Result<DrainStats> {
    let sql = format!(
        "SELECT id, organization_id, company_id, table_name, record_id, action, \
                old_values, new_values, changed_fields, user_identity, session_id, \
                ip_address, user_agent, timestamp, metadata \
         FROM audit_log ORDER BY id ASC LIMIT {batch_size}"
    );
    let raw_rows = stdb.query_sql(&sql).await.context("query audit_log batch")?;

    let mut stats = DrainStats {
        read: raw_rows.len(),
        ..Default::default()
    };

    for raw in &raw_rows {
        match drain_one(pool, stdb, raw).await {
            Ok(finalized) => {
                stats.upserted += 1;
                if finalized {
                    stats.finalized += 1;
                }
            }
            Err(error) => {
                stats.failed += 1;
                tracing::error!(%error, row = %raw, "audit cold drain: row failed");
            }
        }
    }

    Ok(stats)
}

/// Drain one row through UPSERT → ledger → finalize → mark. Returns whether
/// the STDB row was finalized (deleted) this call.
async fn drain_one(pool: &Pool, stdb: &StdbClient, raw: &Value) -> Result<bool> {
    let row = parse_audit_row(raw)?;

    upsert_cold_audit_log(pool, &row).await?;
    ledger::record_transfer(pool, "audit_log", &row.id, &row.organization_id, 1, &row.checksum)
        .await?;

    stdb.call_reducer(
        "finalize_audit_log_archive",
        json!([row.id_u64, row.checksum]),
    )
    .await
    .context("call finalize_audit_log_archive")?;

    ledger::mark_finalized(pool, "audit_log", &row.id).await?;

    Ok(true)
}

async fn upsert_cold_audit_log(pool: &Pool, row: &AuditRow) -> Result<()> {
    let client = pool
        .get()
        .await
        .context("get PG client for cold_audit_log upsert")?;
    client
        .execute(
            "INSERT INTO cold_audit_log \
                (id, organization_id, company_id, table_name, record_id, action, \
                 old_values, new_values, changed_fields, user_identity, session_id, \
                 ip_address, user_agent, timestamp, metadata, payload_checksum) \
             VALUES \
                ($1::NUMERIC, $2::NUMERIC, $3::NUMERIC, $4, $5::NUMERIC, $6, \
                 $7, $8, $9::JSONB, $10, $11::NUMERIC, \
                 $12, $13, $14, $15, $16) \
             ON CONFLICT (id) DO NOTHING",
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
    Ok(())
}

/// Decode one raw `audit_log` SQL row (camelCase SATS-JSON from
/// `StdbClient::query_sql`) and compute its canonical checksum.
///
/// Field extraction never coerces a missing/malformed value to a default —
/// a batch item with a bad id/checksum is a loud error, not a silent `0`
/// (`docs/plans/audit-log-cold-by-default.md` §4).
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
        serde_json::to_string(&changed_fields).context("serialize changed_fields")?;

    let canonical = canonical_row_json(
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
    );
    let checksum = conventions::compute_payload_checksum_canonical(&canonical);

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

/// The canonical checksum shape. MUST stay byte-for-byte identical to
/// `audit_log_canonical_checksum` in `spacetimedb/src/core/audit.rs` — see
/// the note there.
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
        .and_then(|v| v.as_u64())
        .ok_or_else(|| anyhow!("audit_log.{field}: expected u64, got {:?}", row.get(field)))
}

fn optional_u64_string(row: &Value, field: &str) -> Result<Option<String>> {
    match row.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v
            .as_u64()
            .map(|n| Some(n.to_string()))
            .ok_or_else(|| anyhow!("audit_log.{field}: expected u64 or null, got {v}")),
    }
}

fn require_string(row: &Value, field: &str) -> Result<String> {
    row.get(field)
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| anyhow!("audit_log.{field}: expected string, got {:?}", row.get(field)))
}

fn optional_string(row: &Value, field: &str) -> Result<Option<String>> {
    match row.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(other) => Err(anyhow!("audit_log.{field}: expected string or null, got {other}")),
    }
}

fn changed_fields_array(row: &Value, field: &str) -> Result<Vec<String>> {
    row.get(field)
        .and_then(|v| v.as_array())
        .ok_or_else(|| anyhow!("audit_log.{field}: expected array, got {:?}", row.get(field)))?
        .iter()
        .map(|el| {
            el.as_str()
                .map(str::to_string)
                .ok_or_else(|| anyhow!("audit_log.{field}: non-string element {el}"))
        })
        .collect()
}

fn timestamp_micros_i64(row: &Value, field: &str) -> Result<i64> {
    row.get(field)
        .and_then(|v| v.get("microsSinceUnixEpoch"))
        .and_then(|v| v.as_i64())
        .ok_or_else(|| {
            anyhow!(
                "audit_log.{field}: expected {{microsSinceUnixEpoch}}, got {:?}",
                row.get(field)
            )
        })
}

/// Extract (lowercase 64-hex, raw 32 bytes) from a raw `Identity` SQL cell.
///
/// The exact JSON shape SpacetimeDB's SQL HTTP endpoint uses for `Identity`
/// columns hasn't been exercised against a live module yet (Phase 0 noted
/// `make check-codegen` can't validate against the live module either).
/// This accepts the two representations plausible for a SATS byte value —
/// a hex string (optionally `0x`-prefixed) or a JSON array of 32 byte
/// numbers — and fails loudly on anything else rather than guessing.
fn identity_hex_and_bytes(row: &Value, field: &str) -> Result<(String, Vec<u8>)> {
    let v = row
        .get(field)
        .ok_or_else(|| anyhow!("audit_log.{field}: missing"))?;
    match v {
        Value::String(s) => {
            let stripped = s
                .strip_prefix("0x")
                .or_else(|| s.strip_prefix("0X"))
                .unwrap_or(s);
            if stripped.len() != 64 || !stripped.chars().all(|c| c.is_ascii_hexdigit()) {
                anyhow::bail!("audit_log.{field}: expected 64 hex chars, got '{s}'");
            }
            let lower = stripped.to_ascii_lowercase();
            let bytes = hex::decode(&lower).with_context(|| format!("audit_log.{field}: hex decode"))?;
            Ok((lower, bytes))
        }
        Value::Array(arr) => {
            if arr.len() != 32 {
                anyhow::bail!("audit_log.{field}: expected 32-byte array, got len {}", arr.len());
            }
            let mut bytes = Vec::with_capacity(32);
            for el in arr {
                let n = el
                    .as_u64()
                    .filter(|n| *n <= 255)
                    .ok_or_else(|| anyhow!("audit_log.{field}: non-byte element {el}"))?;
                bytes.push(n as u8);
            }
            Ok((hex::encode(&bytes), bytes))
        }
        other => anyhow::bail!("audit_log.{field}: expected hex string or byte array, got {other}"),
    }
}

/// Start the standalone audit-cold-drainer service: PG schema check, then a
/// bounded polling loop calling [`drain_batch`], plus a health endpoint.
///
/// Configure with:
/// - `LUMIERE_AUDIT_DRAINER_POLL_SECS` — poll interval (default 5, per
///   `docs/plans/audit-log-cold-by-default.md` §5)
/// - `LUMIERE_AUDIT_DRAINER_BATCH` — max rows drained per tick (default 200)
/// - `LUMIERE_AUDIT_DRAINER_PORT` — health port (default 8094)
pub async fn serve() -> Result<()> {
    let config = Config::from_env()?;
    let poll_secs = std::env::var("LUMIERE_AUDIT_DRAINER_POLL_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|v| *v > 0)
        .unwrap_or(5u64);
    let batch = std::env::var("LUMIERE_AUDIT_DRAINER_BATCH")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|v| *v > 0)
        .unwrap_or(200u32);
    let port = std::env::var("LUMIERE_AUDIT_DRAINER_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8094u16);

    let state = Arc::new(AppState::new(config));
    let pg_config = pg_pool::PgConfig::from_env().context("PG config for audit cold drainer")?;
    let pool = pg_pool::build_pool(&pg_config).context("build PG pool for audit cold drainer")?;
    migrate::ensure_schema(&pool)
        .await
        .context("apply cold-tier PG schema")?;

    let ready = Arc::new(AtomicBool::new(false));
    let worker_ready = ready.clone();
    let worker_state = state.clone();
    let worker_pool = pool.clone();
    tokio::spawn(async move {
        loop {
            match drain_batch(&worker_state.stdb, &worker_pool, batch).await {
                Ok(stats) => {
                    worker_ready.store(true, Ordering::Relaxed);
                    if stats.read > 0 {
                        tracing::info!(
                            read = stats.read,
                            upserted = stats.upserted,
                            finalized = stats.finalized,
                            failed = stats.failed,
                            "audit cold drainer: batch complete"
                        );
                    }
                }
                Err(error) => {
                    worker_ready.store(false, Ordering::Relaxed);
                    tracing::error!(%error, "audit cold drainer: batch query failed");
                }
            }
            tokio::time::sleep(Duration::from_secs(poll_secs)).await;
        }
    });

    let app = Router::new()
        .route("/health", get(|| async { StatusCode::OK }))
        .route(
            "/health/ready",
            get(move || {
                let ready = ready.clone();
                async move {
                    if ready.load(Ordering::Relaxed) {
                        StatusCode::OK
                    } else {
                        StatusCode::SERVICE_UNAVAILABLE
                    }
                }
            }),
        );
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port))).await?;
    tracing::info!(port, "audit cold drainer listening");
    axum::serve(listener, app).await?;
    Ok(())
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
            "timestamp": { "microsSinceUnixEpoch": 1_781_987_714_525_004_i64 },
            "metadata": null,
        })
    }

    #[test]
    fn parses_a_well_formed_row() {
        let row = parse_audit_row(&sample_row()).expect("parse");
        assert_eq!(row.id, "42");
        assert_eq!(row.organization_id, "7");
        assert_eq!(row.company_id.as_deref(), Some("3"));
        assert_eq!(row.table_name, "sale_order");
        assert_eq!(row.record_id, "100");
        assert_eq!(row.session_id, None);
        assert_eq!(row.identity_bytes.len(), 32);
        assert_eq!(row.timestamp_micros, 1_781_987_714_525_004);
        assert_eq!(row.checksum.len(), 64);
    }

    #[test]
    fn checksum_is_deterministic_across_reparse() {
        let a = parse_audit_row(&sample_row()).unwrap();
        let b = parse_audit_row(&sample_row()).unwrap();
        assert_eq!(a.checksum, b.checksum);
    }

    #[test]
    fn checksum_changes_when_a_field_changes() {
        let base = parse_audit_row(&sample_row()).unwrap();
        let mut altered = sample_row();
        altered["action"] = json!("UPDATE");
        let changed = parse_audit_row(&altered).unwrap();
        assert_ne!(base.checksum, changed.checksum);
    }

    #[test]
    fn missing_id_is_a_hard_error_not_a_default() {
        let mut row = sample_row();
        row.as_object_mut().unwrap().remove("id");
        let err = parse_audit_row(&row).unwrap_err();
        assert!(err.to_string().contains("audit_log.id"));
    }

    #[test]
    fn malformed_identity_is_rejected() {
        let mut row = sample_row();
        row["userIdentity"] = json!("not-hex");
        let err = parse_audit_row(&row).unwrap_err();
        assert!(err.to_string().contains("userIdentity"));
    }

    #[test]
    fn identity_hex_string_and_byte_array_agree() {
        let hex_str = "ab".repeat(32);
        let mut as_array = sample_row();
        as_array["userIdentity"] = json!(vec![0xabu64; 32]);
        let mut as_hex = sample_row();
        as_hex["userIdentity"] = json!(hex_str);

        let a = parse_audit_row(&as_array).unwrap();
        let b = parse_audit_row(&as_hex).unwrap();
        assert_eq!(a.identity_bytes, b.identity_bytes);
        assert_eq!(a.checksum, b.checksum);
    }
}
