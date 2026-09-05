//! Projection cursor and watermark source queries.

use anyhow::{anyhow, bail, Context, Result};
use deadpool_postgres::Pool;
use serde_json::Value;
use stdb_client::StdbClient;

use super::decode::require_u64;

pub(super) async fn query_cursors(
    stdb: &StdbClient,
    scan_after: u64,
    batch_size: u32,
) -> Result<Vec<Value>> {
    let rows = stdb
        .query_sql(&format!(
            "SELECT * FROM organization_commit_cursor \
             WHERE organization_id > {scan_after}"
        ))
        .await
        .context("query organization projection cursors")?;
    select_cursors(rows, scan_after, batch_size)
}

pub(super) fn select_cursors(
    rows: Vec<Value>,
    scan_after: u64,
    batch_size: u32,
) -> Result<Vec<Value>> {
    let mut indexed = Vec::with_capacity(rows.len());
    for row in rows {
        let organization_id = require_u64(&row, "organizationId")?;
        require_u64(&row, "nextSequence")?;
        indexed.push((organization_id, row));
    }

    indexed.sort_by_key(|(organization_id, _)| *organization_id);
    for pair in indexed.windows(2) {
        if pair[0].0 == pair[1].0 {
            bail!(
                "organization projection cursor query returned duplicate organization {}",
                pair[0].0
            );
        }
    }

    Ok(indexed
        .into_iter()
        .filter(|(organization_id, _)| *organization_id > scan_after)
        .take(batch_size as usize)
        .map(|(_, row)| row)
        .collect())
}

pub(super) fn select_commit_row(
    rows: Vec<Value>,
    organization_id: u64,
    sequence: u64,
) -> Result<Option<Value>> {
    match rows.len() {
        0 => Ok(None),
        1 => {
            let row = rows
                .into_iter()
                .next()
                .ok_or_else(|| anyhow!("commit row disappeared during cardinality check"))?;
            let row_organization_id = require_u64(&row, "organizationId")?;
            let row_sequence = require_u64(&row, "sequence")?;
            if row_organization_id != organization_id || row_sequence != sequence {
                bail!(
                    "organization commit query returned row outside requested organization {organization_id} sequence {sequence}"
                );
            }
            Ok(Some(row))
        }
        count => Err(anyhow!(
            "organization commit query returned {count} rows; expected exactly one"
        )),
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn cursor(organization_id: u64, next_sequence: u64) -> Value {
        json!({
            "organizationId": organization_id,
            "nextSequence": next_sequence,
        })
    }

    fn commit(organization_id: u64, sequence: u64) -> Value {
        json!({
            "organizationId": organization_id,
            "sequence": sequence,
        })
    }

    #[test]
    fn cursor_selection_filters_sorts_and_bounds_in_rust() {
        let rows = vec![cursor(9, 2), cursor(3, 4), cursor(7, 8), cursor(1, 1)];
        let selected = select_cursors(rows, 2, 2).unwrap();
        assert_eq!(
            selected
                .iter()
                .map(|row| row["organizationId"].as_u64().unwrap())
                .collect::<Vec<_>>(),
            vec![3, 7]
        );
    }

    #[test]
    fn cursor_selection_rejects_duplicates_and_malformed_rows() {
        let duplicate = select_cursors(vec![cursor(3, 1), cursor(3, 2)], 0, 10);
        assert!(duplicate
            .unwrap_err()
            .to_string()
            .contains("duplicate organization"));

        let malformed = select_cursors(vec![json!({"organizationId": 3})], 0, 10);
        assert!(malformed.unwrap_err().to_string().contains("nextSequence"));
    }

    #[test]
    fn commit_selection_requires_exactly_one_matching_row() {
        assert!(select_commit_row(Vec::new(), 3, 4).unwrap().is_none());
        assert!(select_commit_row(vec![commit(3, 4), commit(3, 4)], 3, 4)
            .unwrap_err()
            .to_string()
            .contains("exactly one"));
        assert!(select_commit_row(vec![commit(3, 5)], 3, 4)
            .unwrap_err()
            .to_string()
            .contains("outside requested"));
    }
}
