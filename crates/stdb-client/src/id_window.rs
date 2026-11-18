//! Ordered, bounded reads over SpacetimeDB's unordered HTTP SQL interface.

use anyhow::{ensure, Context, Result};
use serde_json::Value;

use crate::{chat_row_id, StdbClient};

const MAX_ROWS: usize = 501;
const MAX_SEEK_QUERIES: usize = 256;
const PAYLOAD_BATCH_ROWS: usize = 8;

/// Read complete ID intervals before ordering them. A full unordered sample
/// is only a probe, never a page. IDs may be sparse across the entire u64 range.
pub(crate) async fn select_ids(
    client: &StdbClient,
    table: &str,
    predicate: &str,
    low: u64,
    high: u64,
    limit: usize,
    newest_first: bool,
) -> Result<Vec<u64>> {
    ensure!((1..=MAX_ROWS).contains(&limit), "invalid ID page limit");
    if low > high {
        return Ok(Vec::new());
    }
    let client = client.with_query_limits(limit + 1, 64 * 1024)?;
    let mut pending = vec![(low, high)];
    let mut result = Vec::with_capacity(limit);
    let mut probes = 0;
    while let Some((low, high)) = pending.pop() {
        probes += 1;
        ensure!(probes <= MAX_SEEK_QUERIES, "ID page scan exhausted");
        let available = limit - result.len();
        let probe_limit = available + 1;
        let sql = format!(
            "SELECT id FROM {table} WHERE {predicate} AND id >= {low} AND id <= {high} LIMIT {probe_limit}"
        );
        let rows = client.query_sql(&sql).await?;
        let mut ids = rows.iter().map(chat_row_id).collect::<Result<Vec<_>>>()?;
        ids.sort_unstable();
        ensure!(
            ids.iter().all(|id| (low..=high).contains(id))
                && ids.windows(2).all(|pair| pair[0] < pair[1]),
            "ID page escaped its window"
        );
        if ids.len() <= available {
            if newest_first {
                ids.reverse();
            }
            result.extend(ids);
            if result.len() == limit {
                break;
            }
            continue;
        }
        let first = ids.first().copied().context("empty full ID sample")?;
        let last = ids.last().copied().context("empty full ID sample")?;
        let (low, high) = if newest_first {
            (first, high)
        } else {
            (low, last)
        };
        ensure!(low < high, "invalid ID interval");
        let midpoint = low + (high - low) / 2;
        if newest_first {
            pending.push((low, midpoint));
            pending.push((midpoint + 1, high));
        } else {
            pending.push((midpoint + 1, high));
            pending.push((low, midpoint));
        }
    }
    Ok(result)
}

impl StdbClient {
    /// Newest rows matching a server-owned SQL predicate, without ORDER BY.
    /// Callers must validate/interpolate selectors as they do for `query_sql`;
    /// this helper does not grant access or accept browser-authored SQL.
    pub async fn query_newest_rows(
        &self,
        table: &'static str,
        predicate: &str,
        limit: usize,
    ) -> Result<Vec<Value>> {
        ensure!(
            !table.is_empty()
                && table
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_'),
            "invalid table name"
        );
        let ids = select_ids(self, table, predicate, 1, u64::MAX, limit, true).await?;
        let bounded = self.with_query_limits(PAYLOAD_BATCH_ROWS, 1024 * 1024)?;
        let mut result = Vec::with_capacity(ids.len());
        for batch in ids.chunks(PAYLOAD_BATCH_ROWS) {
            let terms = batch
                .iter()
                .map(|id| format!("id = {id}"))
                .collect::<Vec<_>>();
            let sql = format!(
                "SELECT * FROM {table} WHERE {predicate} AND ({}) LIMIT {}",
                terms.join(" OR "),
                batch.len()
            );
            let rows = bounded.query_sql(&sql).await?;
            let mut by_id = std::collections::BTreeMap::new();
            for row in rows {
                let id = chat_row_id(&row)?;
                ensure!(
                    batch.contains(&id) && by_id.insert(id, row).is_none(),
                    "row escaped its selected IDs"
                );
            }
            // A concurrent deletion can shorten the result; never fill the
            // missing slot from an arbitrary unordered sample.
            for id in batch {
                if let Some(row) = by_id.remove(id) {
                    result.push(row);
                }
            }
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::post, Json, Router};
    use serde_json::json;

    #[tokio::test]
    async fn newest_rows_preserve_scope_and_order_over_unordered_sparse_samples() {
        let ids = [1, 8, 37, 800, 8_000, 800_000, u64::MAX - 1];
        let app = Router::new().route(
            "/v1/database/test/sql",
            post(move |sql: String| async move {
                assert!(!sql.contains("ORDER BY"));
                assert!(sql.contains(
                    "organization_id = 7 AND company_id = 3 AND status = 'needs_review'"
                ));
                let number = |marker: &str| -> u64 {
                    sql.split_once(marker)
                        .unwrap()
                        .1
                        .split(|c: char| !c.is_ascii_digit())
                        .next()
                        .unwrap()
                        .parse()
                        .unwrap()
                };
                let limit = number("LIMIT ") as usize;
                let selected = if sql.starts_with("SELECT id ") {
                    let low = number("id >= ");
                    let high = number("id <= ");
                    ids.iter()
                        .copied()
                        .filter(|id| (low..=high).contains(id))
                        .take(limit)
                        .collect::<Vec<_>>()
                } else {
                    ids.iter()
                        .copied()
                        .filter(|id| {
                            sql.contains(&format!("id = {id} OR"))
                                || sql.contains(&format!("id = {id})"))
                        })
                        .take(limit)
                        .collect()
                };
                Json(json!([{
                    "schema": {"elements": [{"name": {"some":"id"}, "algebraic_type":{"U64":[]}}]},
                    "rows": selected.into_iter().map(|id| vec![id]).collect::<Vec<_>>()
                }]))
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = StdbClient::new(format!("http://{address}"), "test".into(), "owner".into());
        let predicate = "organization_id = 7 AND company_id = 3 AND status = 'needs_review'";
        let rows = client
            .query_newest_rows("ai_evidence_claim", predicate, 3)
            .await
            .unwrap();
        assert_eq!(
            rows.iter()
                .map(chat_row_id)
                .collect::<Result<Vec<_>>>()
                .unwrap(),
            vec![ids[6], ids[5], ids[4]]
        );
        assert!(client
            .query_newest_rows("ai_evidence_claim", predicate, 0)
            .await
            .is_err());
        server.abort();
    }
}
