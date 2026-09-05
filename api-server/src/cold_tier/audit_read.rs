//! Audit-log read merge: `cold_audit_log` (PG) ∪ `audit_log` (STDB tail).
//!
//! Implements `docs/plans/audit-log-cold-by-default.md` §6/§6.1: the existing
//! `audit-log` resource contract is already bounded (`id DESC`, no cursor,
//! top 500 — see the consumer inventory in that doc), so the merge here
//! reuses that exact contract rather than introducing pagination.
//!
//! Row shape parity matters: `StdbClient::query_sql` returns hot rows with
//! camelCase keys, raw JSON numbers for u64 columns, and
//! `{"microsSinceUnixEpoch": <i64>}` for `timestamp` (see
//! `crates/stdb-client`'s SATS-JSON unwrapping). `cold_audit_log`'s columns
//! are NUMERIC/BIGINT and would naturally decode as decimal strings — this
//! module reconstructs cold rows into the exact hot shape instead, per the
//! plan's invariant that "existing callers remain unchanged" (frontend
//! compatibility is non-negotiable, not just a nice-to-have).

use serde_json::Value;
use stdb_client::StdbClient;

use crate::error::ApiError;
use crate::metrics;

use super::{
    pg_codec, pg_pool, scalar_binds_to_pg, OrderDirection, PageSpec, ReadOrder, ResourceReadPlan,
};

const CODEC_MANIFEST_JSON: &str = lumiere_contracts::manifests::CODEC_MANIFEST;
const READ_COLUMNS: &[&str] = &[
    "id",
    "organization_id",
    "company_id",
    "table_name",
    "record_id",
    "action",
    "old_values",
    "new_values",
    "session_id",
    "ip_address",
    "user_agent",
    "timestamp",
];

/// Read hot audit-log rows for `organization_id`, in the same shape and bound
/// (`id DESC`, top 500) the endpoint has always returned.
///
/// `audit_log` is an always-hot table. Keep this path independent from the
/// legacy cold archive reader so a stale archive manifest or unavailable PG
/// cannot turn an authoritative hot read into a failed request.
pub async fn hot_rows(stdb: &StdbClient, organization_id: u64) -> Result<Vec<Value>, ApiError> {
    let columns = audit_columns()?;
    let plan = audit_plan(organization_id, &columns);
    let (sql, binds) = super::compile_stdb_sql(&plan).map_err(ApiError::internal)?;
    stdb.query_sql(&super::inline_stdb_literals(&sql, &binds))
        .await
        .map_err(ApiError::internal)
}

/// Merge cold + hot audit-log rows for migration/compatibility callers.
/// New `audit-log` HTTP reads must use [`hot_rows`].
///
/// Cold-store failure rejects the request. A hot-only result would conceal
/// missing history behind the normal successful response contract.
pub async fn merged_rows(stdb: &StdbClient, organization_id: u64) -> Result<Vec<Value>, ApiError> {
    let columns = audit_columns()?;
    let plan = audit_plan(organization_id, &columns);
    let (hot_sql, hot_binds) = super::compile_stdb_sql(&plan).map_err(ApiError::internal)?;
    let hot_rows = stdb
        .query_sql(&super::inline_stdb_literals(&hot_sql, &hot_binds))
        .await
        .map_err(ApiError::internal)?;

    let cold_rows = match query_cold_rows(&columns, &plan).await {
        Ok(rows) => rows,
        Err(error) => {
            metrics::inc_audit_cold_read_failure();
            return Err(ApiError::unavailable(
                error.context("load complete audit history"),
            ));
        }
    };
    // Until C5 cooling/finalization is enabled, STDB remains authoritative for
    // rows that have not yet been finalized; prefer it when both stores match.
    let (merged, _) = super::merge_hot_cold_u64(
        hot_rows,
        cold_rows,
        "id",
        OrderDirection::Desc,
        PageSpec::AUDIT_LOG_DEFAULT_LIMIT,
    )
    .map_err(ApiError::internal)?;
    Ok(merged)
}

fn audit_columns() -> Result<Vec<pg_codec::ColumnCodec>, ApiError> {
    let all_columns = pg_codec::load_columns(CODEC_MANIFEST_JSON, "audit_log")
        .map_err(|e| ApiError::Internal(format!("load audit_log codec columns: {e}")))?;
    Ok(all_columns
        .into_iter()
        .filter(|column| READ_COLUMNS.contains(&column.name.as_str()))
        .collect())
}

fn audit_plan(organization_id: u64, columns: &[pg_codec::ColumnCodec]) -> ResourceReadPlan {
    ResourceReadPlan {
        resource: "audit-log".into(),
        table: "audit_log".into(),
        projection: pg_codec::projection_with_pg_casts(columns),
        organization_id,
        company_id: None,
        predicates: vec![],
        order: vec![ReadOrder {
            column: "id".into(),
            direction: OrderDirection::Desc,
        }],
        page: PageSpec {
            limit: PageSpec::AUDIT_LOG_DEFAULT_LIMIT,
            cursor: None,
        },
    }
}

async fn query_cold_rows(
    columns: &[pg_codec::ColumnCodec],
    plan: &ResourceReadPlan,
) -> anyhow::Result<Vec<Value>> {
    let pool = pg_pool::required_pool()?;
    let client = pool.get().await?;
    let (sql, binds) = super::compile_pg_sql(plan)?;
    let owned_binds = scalar_binds_to_pg(&binds);
    let params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> =
        owned_binds.iter().map(|bind| bind.as_sql()).collect();
    let rows = client.query(&sql, &params).await?;
    rows.iter()
        .map(|row| pg_codec::row_to_hot_json(columns, row))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn hot_ids_are_preferred_over_cold_duplicates() {
        let hot = vec![json!({"id": 5}), json!({"id": 3})];
        let (merged, _) = crate::cold_tier::merge_hot_cold_u64(
            hot,
            vec![json!({"id": 5}), json!({"id": 1})],
            "id",
            OrderDirection::Desc,
            10,
        )
        .unwrap();
        assert_eq!(
            merged,
            vec![json!({"id": 5}), json!({"id": 3}), json!({"id": 1})]
        );
    }
}
