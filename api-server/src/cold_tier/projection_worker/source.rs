//! Projection cursor and watermark source queries.

use anyhow::{anyhow, Context, Result};
use deadpool_postgres::Pool;
use serde_json::Value;
use stdb_client::StdbClient;

pub(super) async fn query_cursors(
    stdb: &StdbClient,
    scan_after: u64,
    batch_size: u32,
) -> Result<Vec<Value>> {
    stdb.query_sql(&format!(
        "SELECT organization_id, next_sequence \
         FROM organization_commit_cursor \
         WHERE organization_id > {scan_after} \
         ORDER BY organization_id ASC LIMIT {batch_size}"
    ))
    .await
    .context("query organization projection cursors")
}

pub(super) async fn next_projection_sequence(pool: &Pool, organization_id: u64) -> Result<u64> {
    let client = pool
        .get()
        .await
        .context("get PG client for projection watermark")?;
    let organization_id = organization_id.to_string();
    let row = client
        .query_opt(
            "SELECT applied_sequence::TEXT \
             FROM organization_projection_watermark \
             WHERE organization_id = $1::TEXT::NUMERIC",
            &[&organization_id],
        )
        .await
        .context("read organization projection watermark")?;
    row.map(|row| row.get::<_, String>(0).parse::<u64>())
        .transpose()
        .context("decode organization projection watermark")?
        .map_or(Ok(1), |sequence| {
            sequence
                .checked_add(1)
                .ok_or_else(|| anyhow!("organization projection sequence exhausted"))
        })
}
