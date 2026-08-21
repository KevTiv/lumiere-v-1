//! Pos-order cold drainer: STDB `pos_order` → PG `cold_pos_order`.
//!
//! Implements the general (mutable-resource) worker flow from
//! `docs/plans/sliding-window-cold-tier.md` §6.1, generically via
//! [`super::pg_codec`] — see that module's doc for why: `pos_order` has
//! ~50 columns, hand-writing per-field extraction the way `audit_drainer.rs`
//! does for `audit_log`'s 14 was not tractable at this size.
//!
//! 1. Read a bounded batch of eligible (`cold_eligible_at IS NOT NULL`)
//!    `pos_order` rows ordered by `id`.
//! 2. Decode + checksum each row generically via `pg_codec`.
//! 3. Version-aware UPSERT into `cold_pos_order`.
//! 4. Record the transfer in the `archive_transfer` ledger.
//! 5. Call `finalize_pos_order_archive` with the exact
//!    `(archive_version, cold_eligible_at)` the worker read in step 1 — the
//!    general version-checked protocol, NOT a checksum the way audit_log's
//!    finalize works (audit_log has no archive_version/cold_eligible_at
//!    concept; pos_order is the first resource on the "real" protocol).
//! 6. Mark the ledger row finalized.
//!
//! `PosOrder` has no reducer that mutates a row after creation today, so a
//! UPSERT retry (worker crash, duplicate drainer) is always a no-op once PG
//! already has the row — `pg_codec::upsert_row`'s version-aware `WHERE
//! EXCLUDED.archive_version > cold_table.archive_version` degenerates
//! correctly in that case rather than needing special-casing.

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

use super::{ledger, migrate, pg_codec, pg_pool};
use crate::config::Config;
use crate::state::AppState;

const CODEC_MANIFEST_JSON: &str = lumiere_contracts::manifests::CODEC_MANIFEST;
const TABLE: &str = "pos_order";
const COLD_TABLE: &str = "cold_pos_order";

#[derive(Debug, Default, Clone, Copy)]
pub struct DrainStats {
    pub read: usize,
    pub upserted: usize,
    pub finalized: usize,
    pub failed: usize,
}

/// Read a bounded batch, drain each row, and return counts. Errors on
/// individual rows are logged and counted, not propagated — one malformed
/// row must not stall the whole batch.
pub async fn drain_batch(stdb: &StdbClient, pool: &Pool, batch_size: u32) -> Result<DrainStats> {
    let columns =
        pg_codec::load_columns(CODEC_MANIFEST_JSON, TABLE).context("load pos_order columns")?;
    let column_list: String = columns
        .iter()
        .map(|c| c.name.as_str())
        .collect::<Vec<_>>()
        .join(", ");

    let sql = format!(
        "SELECT {column_list} FROM {TABLE} \
         WHERE cold_eligible_at IS NOT NULL \
         ORDER BY id ASC LIMIT {batch_size}"
    );
    let raw_rows = stdb
        .query_sql(&sql)
        .await
        .context("query pos_order batch")?;

    let mut stats = DrainStats {
        read: raw_rows.len(),
        ..Default::default()
    };

    for raw in &raw_rows {
        match drain_one(pool, stdb, &columns, raw).await {
            Ok(()) => {
                stats.upserted += 1;
                stats.finalized += 1;
            }
            Err(error) => {
                stats.failed += 1;
                tracing::error!(%error, row = %raw, "pos_order cold drain: row failed");
            }
        }
    }

    Ok(stats)
}

async fn drain_one(
    pool: &Pool,
    stdb: &StdbClient,
    columns: &[pg_codec::ColumnCodec],
    raw: &Value,
) -> Result<()> {
    let id = require_u64(raw, "id")?;
    let organization_id = require_u64(raw, "organizationId")?;
    let archive_version = require_u64(raw, "archiveVersion")?;
    let cold_eligible_at_micros = raw
        .get("coldEligibleAt")
        .and_then(|v| v.get("microsSinceUnixEpoch"))
        .and_then(|v| v.as_i64())
        .ok_or_else(|| {
            anyhow!("pos_order {id}: missing cold_eligible_at (should be excluded by the batch query's WHERE clause)")
        })?;

    let values = pg_codec::decode_row(columns, raw)?;
    let checksum = pg_codec::checksum_for(columns, &values);

    {
        let client = pool
            .get()
            .await
            .context("get PG client for cold_pos_order upsert")?;
        pg_codec::upsert_row(&client, COLD_TABLE, columns, &values, &checksum)
            .await
            .context("upsert cold_pos_order")?;
    }

    ledger::record_transfer(
        pool,
        TABLE,
        &id.to_string(),
        &organization_id.to_string(),
        archive_version as i64,
        &checksum,
    )
    .await
    .context("record archive_transfer")?;

    stdb.call_reducer(stdb_client::reducer_call!(
        "finalize_pos_order_archive",
        json!([id, archive_version, cold_eligible_at_micros]),
    ))
    .await
    .context("call finalize_pos_order_archive")?;

    ledger::mark_finalized(pool, TABLE, &id.to_string())
        .await
        .context("mark archive_transfer finalized")?;

    Ok(())
}

fn require_u64(row: &Value, field: &str) -> Result<u64> {
    row.get(field)
        .and_then(|v| v.as_u64())
        .ok_or_else(|| anyhow!("pos_order.{field}: expected u64, got {:?}", row.get(field)))
}

/// Start the standalone pos-order-cold-drainer service: PG schema check,
/// then a bounded polling loop calling [`drain_batch`], plus a health
/// endpoint.
///
/// Before this can finalize anything anywhere, a superuser must register
/// this drainer's `STDB_SERVER_TOKEN` identity once, directly against
/// SpacetimeDB (not through api-server's gateway):
/// `register_cold_tier_service_identity(service_name: "pos_order_cold_drainer", identity: <this identity>)`
/// — same one-time setup `audit_drainer.rs` documents for its own service
/// name.
///
/// Configure with:
/// - `LUMIERE_POS_ORDER_DRAINER_POLL_SECS` — poll interval (default 5)
/// - `LUMIERE_POS_ORDER_DRAINER_BATCH` — max rows drained per tick (default 200)
/// - `LUMIERE_POS_ORDER_DRAINER_PORT` — health port (default 8095)
pub async fn serve() -> Result<()> {
    let config = Config::from_env()?;
    let poll_secs = std::env::var("LUMIERE_POS_ORDER_DRAINER_POLL_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|v| *v > 0)
        .unwrap_or(5u64);
    let batch = std::env::var("LUMIERE_POS_ORDER_DRAINER_BATCH")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|v| *v > 0)
        .unwrap_or(200u32);
    let port = std::env::var("LUMIERE_POS_ORDER_DRAINER_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8095u16);

    let state = Arc::new(AppState::new(config));
    let pg_config =
        pg_pool::PgConfig::from_env().context("PG config for pos-order cold drainer")?;
    let pool =
        pg_pool::build_pool(&pg_config).context("build PG pool for pos-order cold drainer")?;
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
                            "pos-order cold drainer: batch complete"
                        );
                    }
                }
                Err(error) => {
                    worker_ready.store(false, Ordering::Relaxed);
                    tracing::error!(%error, "pos-order cold drainer: batch query failed");
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
    tracing::info!(port, "pos-order cold drainer listening");
    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codec_manifest_has_pos_order_columns() {
        let columns = pg_codec::load_columns(CODEC_MANIFEST_JSON, TABLE).unwrap();
        let names: Vec<&str> = columns.iter().map(|c| c.name.as_str()).collect();
        assert!(names.contains(&"organization_id"));
        assert!(names.contains(&"cold_eligible_at"));
        assert!(names.contains(&"archive_version"));
    }

    #[test]
    fn require_u64_rejects_missing_field_instead_of_defaulting() {
        let err = require_u64(&json!({}), "id").unwrap_err();
        assert!(err.to_string().contains("pos_order.id"));
    }
}
