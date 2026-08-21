//! `pos_order` read merge: `cold_pos_order` (PG) ∪ `pos_order` (STDB tail).
//!
//! The first resource to actually exercise `ResourceReadPlan`/
//! `compile_stdb_sql`/`compile_pg_sql` end-to-end — `audit_log`'s Phase 1
//! read merge (`audit_read.rs`) was deliberately hand-rolled since it never
//! needed real pagination (bounded top-500, no cursor). `pos_order` has no
//! pre-existing read contract to preserve, so this is a from-scratch
//! keyset-paginated design.
//!
//! Standard `limit + 1` probe for `has_more`: both the hot and cold queries
//! ask for one more row than the caller requested, and the presence of that
//! extra row after merging (not its absence from either individual query)
//! is what determines whether a `nextCursor` is returned — the row that
//! completes the requested page could come from either store.

use std::collections::HashSet;

use serde_json::Value;
use stdb_client::StdbClient;

use crate::error::ApiError;

use super::{
    cursor, pg_codec, pg_pool, scalar_binds_to_pg, OrderDirection, PageSpec, ReadOrder,
    ResourceReadPlan, ScalarValue,
};

const TABLE: &str = "pos_order";
const CODEC_MANIFEST_JSON: &str = lumiere_contracts::manifests::CODEC_MANIFEST;

pub const DEFAULT_LIMIT: u32 = 100;
pub const MAX_LIMIT: u32 = 500;

pub struct Page {
    pub rows: Vec<Value>,
    pub next_cursor: Option<String>,
}

/// Resolve one merged, bounded page of `pos_order` rows.
///
/// If the cold (PG) read fails, this does not fail the request — it falls
/// back to the hot tail alone and logs loudly, so the failure is observable
/// without silently claiming the page is complete (same rule `audit_read.rs`
/// follows for the same reason).
pub async fn merged_page(
    stdb: &StdbClient,
    organization_id: u64,
    company_id: Option<u64>,
    cursor_str: Option<String>,
    limit: Option<u32>,
) -> Result<Page, ApiError> {
    let columns = pg_codec::load_columns(CODEC_MANIFEST_JSON, TABLE)
        .map_err(|e| ApiError::Internal(format!("load pos_order codec columns: {e}")))?;
    let projection = pg_codec::projection_with_pg_casts(&columns);

    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let fetch_limit = limit.saturating_add(1);

    let order = vec![ReadOrder {
        column: "id".to_string(),
        direction: OrderDirection::Desc,
    }];
    let plan = ResourceReadPlan {
        resource: "pos-orders".to_string(),
        table: TABLE.to_string(),
        projection,
        organization_id,
        company_id,
        predicates: vec![],
        order,
        page: PageSpec {
            limit: fetch_limit,
            cursor: cursor_str,
        },
    };

    let (hot_result, cold_result) =
        tokio::join!(query_hot(stdb, &plan), query_cold(&columns, &plan));
    let hot_rows = hot_result?;
    let cold_rows = match cold_result {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(
                %error,
                organization_id,
                "pos-orders cold read failed; falling back to hot tail only"
            );
            Vec::new()
        }
    };

    let hot_ids: HashSet<u64> = hot_rows.iter().filter_map(row_id).collect();
    let mut merged = hot_rows;
    merged.extend(
        cold_rows
            .into_iter()
            .filter(|row| !hot_ids.contains(&row_id(row).unwrap_or(u64::MAX))),
    );
    merged.sort_by(|a, b| row_id(b).cmp(&row_id(a)));

    let has_more = merged.len() as u32 > limit;
    merged.truncate(limit as usize);

    let next_cursor = if has_more {
        merged
            .last()
            .and_then(row_id)
            .and_then(|id| cursor::encode_cursor(&plan.order, &[ScalarValue::U64(id)]))
    } else {
        None
    };

    Ok(Page {
        rows: merged,
        next_cursor,
    })
}

fn row_id(row: &Value) -> Option<u64> {
    row.get("id").and_then(|v| v.as_u64())
}

async fn query_hot(stdb: &StdbClient, plan: &ResourceReadPlan) -> Result<Vec<Value>, ApiError> {
    let (sql, binds) =
        super::compile_stdb_sql(plan).map_err(|e| ApiError::Internal(e.to_string()))?;
    let sql = super::inline_stdb_literals(&sql, &binds);
    stdb.query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))
}

async fn query_cold(
    columns: &[pg_codec::ColumnCodec],
    plan: &ResourceReadPlan,
) -> anyhow::Result<Vec<Value>> {
    let Some(pool) = pg_pool::shared_pool() else {
        return Ok(Vec::new());
    };

    let (sql, binds) = super::compile_pg_sql(plan)?;
    let owned_binds = scalar_binds_to_pg(&binds);
    let params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> =
        owned_binds.iter().map(|b| b.as_sql()).collect();

    let client = pool.get().await?;
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
    fn row_id_reads_the_id_field() {
        assert_eq!(row_id(&json!({"id": 42})), Some(42));
        assert_eq!(row_id(&json!({})), None);
    }

    #[test]
    fn hot_ids_win_on_dedupe_like_audit_read() {
        let hot = vec![json!({"id": 5}), json!({"id": 3})];
        let hot_ids: HashSet<u64> = hot.iter().filter_map(row_id).collect();
        let mut cold = vec![json!({"id": 5}), json!({"id": 1})];
        cold.retain(|row| !hot_ids.contains(&row_id(row).unwrap_or(u64::MAX)));
        assert_eq!(cold, vec![json!({"id": 1})]);
    }
}
