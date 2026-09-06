//! `pos_order` read merge: `cold_pos_order` (PG) ∪ `pos_order` (STDB tail).
//!
//! This resource exercises `ResourceReadPlan`/`compile_stdb_sql`/
//! `compile_pg_sql` end-to-end with keyset pagination.
//!
//! Standard `limit + 1` probe for `has_more`: both the hot and cold queries
//! ask for one more row than the caller requested, and the presence of that
//! extra row after merging (not its absence from either individual query)
//! is what determines whether a `nextCursor` is returned — the row that
//! completes the requested page could come from either store.

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
/// Cold-store failure rejects the request: returning the hot tail could omit
/// orders and incorrectly terminate pagination.
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
    merge_page_results(hot_result, cold_result, &plan, limit)
}

/// Complete a page only when both storage tiers answered successfully.
///
/// A hot-only response is not a valid page: rows can be moving between stores
/// during finalization, so a PostgreSQL failure could otherwise make the API
/// silently omit cold rows and incorrectly terminate pagination.
fn merge_page_results(
    hot_result: Result<Vec<Value>, ApiError>,
    cold_result: anyhow::Result<Vec<Value>>,
    plan: &ResourceReadPlan,
    limit: u32,
) -> Result<Page, ApiError> {
    let hot_rows = hot_result?;
    let cold_rows = cold_result
        .map_err(|error| ApiError::unavailable(error.context("load complete POS order page")))?;
    let (merged, has_more) =
        super::merge_hot_cold_u64(hot_rows, cold_rows, "id", OrderDirection::Desc, limit)
            .map_err(ApiError::internal)?;

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

/// Merge the bounded results from the hot and cold stores in the resource's
/// declared `id DESC` order.
///
/// The source queries both use `limit + 1`, so taking the first `limit + 1`
/// rows after this union is sufficient to determine whether another page
/// exists.  Hot rows win when the finalize race leaves the same primary key in
/// both stores; this keeps the authoritative current representation visible
/// until the hot delete completes.
#[cfg(test)]
fn merge_hot_cold_rows(
    hot_rows: Vec<Value>,
    cold_rows: Vec<Value>,
    limit: u32,
) -> (Vec<Value>, bool) {
    super::merge_hot_cold_u64(hot_rows, cold_rows, "id", OrderDirection::Desc, limit)
        .expect("test rows must carry valid u64 IDs")
}

fn row_id(row: &Value) -> Option<u64> {
    row.get("id").and_then(|v| v.as_u64())
}

async fn query_hot(stdb: &StdbClient, plan: &ResourceReadPlan) -> Result<Vec<Value>, ApiError> {
    let (sql, binds) = super::compile_stdb_sql(plan).map_err(ApiError::internal)?;
    let sql = super::inline_stdb_literals(&sql, &binds);
    stdb.query_sql(&sql).await.map_err(ApiError::internal)
}

async fn query_cold(
    columns: &[pg_codec::ColumnCodec],
    plan: &ResourceReadPlan,
) -> anyhow::Result<Vec<Value>> {
    let pool = pg_pool::required_pool()?;

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

    const READ_DESCRIPTOR_POLICY_JSON: &str =
        include_str!("../../../lumiere-codegen/read-descriptor-policies.json");

    fn pos_order_plan(cursor_str: Option<String>) -> ResourceReadPlan {
        let columns = pg_codec::load_columns(CODEC_MANIFEST_JSON, TABLE)
            .expect("generated pos_order codec must be available");
        ResourceReadPlan {
            resource: "pos-orders".into(),
            table: TABLE.into(),
            projection: pg_codec::projection_with_pg_casts(&columns),
            organization_id: 42,
            company_id: Some(7),
            predicates: vec![],
            order: vec![ReadOrder {
                column: "id".into(),
                direction: OrderDirection::Desc,
            }],
            page: PageSpec {
                limit: 3,
                cursor: cursor_str,
            },
        }
    }

    #[test]
    fn row_id_reads_the_id_field() {
        assert_eq!(row_id(&json!({"id": 42})), Some(42));
        assert_eq!(row_id(&json!({})), None);
    }

    #[test]
    fn runtime_plan_matches_reviewed_generated_descriptor_input() {
        let policy: Value = serde_json::from_str(READ_DESCRIPTOR_POLICY_JSON).unwrap();
        let descriptor = &policy["descriptors"][0];
        assert_eq!(descriptor["resource"], "pos-orders");
        assert_eq!(descriptor["table"], TABLE);
        assert_eq!(descriptor["max_limit"], MAX_LIMIT);
        assert_eq!(descriptor["order_by"][0]["column"], "id");
        assert_eq!(descriptor["order_by"][0]["direction"], "desc");
    }

    #[test]
    fn current_tail_is_returned_without_a_cursor_or_next_page() {
        let plan = pos_order_plan(None);
        let page = merge_page_results(
            Ok(vec![json!({"id": 12}), json!({"id": 11})]),
            Ok(vec![]),
            &plan,
            2,
        )
        .expect("a healthy empty cold tail is a valid page");

        assert_eq!(page.rows, vec![json!({"id": 12}), json!({"id": 11})]);
        assert_eq!(page.next_cursor, None);
    }

    #[test]
    fn hot_ids_win_on_dedupe() {
        let hot = vec![json!({"id": 5}), json!({"id": 3})];
        let (merged, _) = merge_hot_cold_rows(hot, vec![json!({"id": 5}), json!({"id": 1})], 10);
        assert_eq!(
            merged,
            vec![json!({"id": 5}), json!({"id": 3}), json!({"id": 1})]
        );
    }

    #[test]
    fn merge_is_deterministic_across_hot_cold_boundary() {
        let hot = vec![json!({"id": 10}), json!({"id": 8})];
        let cold = vec![
            json!({"id": 9}),
            json!({"id": 8, "source": "stale-cold"}),
            json!({"id": 7}),
            json!({"id": 6}),
        ];

        let (page, has_more) = merge_hot_cold_rows(hot, cold, 3);

        assert_eq!(
            page,
            vec![json!({"id": 10}), json!({"id": 9}), json!({"id": 8})]
        );
        assert!(has_more, "the fourth unique row must produce a next cursor");
    }

    #[test]
    fn merge_does_not_skip_fully_cold_rows_after_hot_page() {
        let (first, has_more) = merge_hot_cold_rows(
            vec![json!({"id": 5}), json!({"id": 4})],
            vec![json!({"id": 3}), json!({"id": 2}), json!({"id": 1})],
            2,
        );
        assert_eq!(first, vec![json!({"id": 5}), json!({"id": 4})]);
        assert!(has_more);

        // A subsequent query uses `id < 4` in both stores.  The old cold tail
        // must remain visible even though the preceding page was hot-only.
        let (second, second_has_more) = merge_hot_cold_rows(
            vec![json!({"id": 3})],
            vec![json!({"id": 2}), json!({"id": 1})],
            2,
        );
        assert_eq!(second, vec![json!({"id": 3}), json!({"id": 2})]);
        assert!(second_has_more);
    }

    #[test]
    fn merge_reports_no_more_rows_at_exact_boundary() {
        let (page, has_more) = merge_hot_cold_rows(
            vec![json!({"id": 4})],
            vec![json!({"id": 3}), json!({"id": 2})],
            3,
        );
        assert_eq!(
            page,
            vec![json!({"id": 4}), json!({"id": 3}), json!({"id": 2})]
        );
        assert!(!has_more);
    }

    #[test]
    fn fully_cold_page_is_visible_when_hot_tail_is_empty() {
        let (page, has_more) = merge_hot_cold_rows(
            vec![],
            vec![json!({"id": 9}), json!({"id": 8}), json!({"id": 7})],
            2,
        );

        assert_eq!(page, vec![json!({"id": 9}), json!({"id": 8})]);
        assert!(has_more);
    }

    #[test]
    fn keyset_pages_cover_each_hot_and_cold_row_once() {
        let hot = [11_u64, 9, 7];
        let cold = [10_u64, 9, 8, 6];
        let mut after = u64::MAX;
        let mut seen = Vec::new();

        loop {
            let hot_page: Vec<Value> = hot
                .iter()
                .filter(|id| **id < after)
                .map(|id| json!({"id": id}))
                .collect();
            let cold_page: Vec<Value> = cold
                .iter()
                .filter(|id| **id < after)
                .map(|id| json!({"id": id}))
                .collect();
            let (page, has_more) = merge_hot_cold_rows(hot_page, cold_page, 2);
            if page.is_empty() {
                break;
            }
            after = page.last().and_then(row_id).expect("test rows have ids");
            seen.extend(page.iter().filter_map(row_id));
            if !has_more {
                break;
            }
        }

        assert_eq!(seen, vec![11, 10, 9, 8, 7, 6]);
    }

    #[test]
    fn keyset_cursor_is_compiled_from_the_same_plan_for_both_stores() {
        let cursor = cursor::encode_cursor(
            &[ReadOrder {
                column: "id".into(),
                direction: OrderDirection::Desc,
            }],
            &[ScalarValue::U64(8)],
        )
        .expect("single id cursor");
        let plan = pos_order_plan(Some(cursor));

        let (stdb_sql, stdb_binds) = super::super::compile_stdb_sql(&plan).unwrap();
        let (pg_sql, pg_binds) = super::super::compile_pg_sql(&plan).unwrap();
        assert!(stdb_sql.contains("`id` < ?"), "SQL: {stdb_sql}");
        assert!(pg_sql.contains("\"id\" < $3::NUMERIC"), "SQL: {pg_sql}");
        assert!(matches!(stdb_binds.last(), Some(ScalarValue::U64(8))));
        assert!(matches!(pg_binds.last(), Some(ScalarValue::U64(8))));
    }

    #[test]
    fn postgres_degradation_does_not_return_a_hot_only_partial_page() {
        let plan = pos_order_plan(None);
        let result = merge_page_results(
            Ok(vec![json!({"id": 12})]),
            Err(anyhow::anyhow!("connection refused")),
            &plan,
            2,
        );

        assert!(matches!(result, Err(ApiError::UnavailableSource(_))));
    }
}
