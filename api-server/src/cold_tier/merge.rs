//! Deterministic hot-wins merge and global page bounds.
use super::{cursor, OrderDirection};

/// Deterministically merge one bounded page from hot STDB and durable PG.
///
/// The primary key is validated on every row, hot rows are visited first so
/// they win the archive-finalization overlap, and duplicates from either
/// source are removed before the global order/limit is applied.
pub fn merge_hot_cold_u64(
    hot_rows: Vec<serde_json::Value>,
    cold_rows: Vec<serde_json::Value>,
    key: &str,
    direction: OrderDirection,
    limit: u32,
) -> Result<(Vec<serde_json::Value>, bool), cursor::CursorError> {
    let mut seen = std::collections::HashSet::new();
    let mut merged = Vec::with_capacity(hot_rows.len() + cold_rows.len());
    for row in hot_rows.into_iter().chain(cold_rows) {
        let id = row
            .get(key)
            .and_then(serde_json::Value::as_u64)
            .ok_or_else(|| {
                cursor::CursorError::InvalidPlan(format!(
                    "merged archive row has no valid u64 key '{key}'"
                ))
            })?;
        if seen.insert(id) {
            merged.push(row);
        }
    }
    merged.sort_by(|left, right| {
        let left = left.get(key).and_then(serde_json::Value::as_u64);
        let right = right.get(key).and_then(serde_json::Value::as_u64);
        match direction {
            OrderDirection::Asc => left.cmp(&right),
            OrderDirection::Desc => right.cmp(&left),
        }
    });
    let has_more = merged.len() > limit as usize;
    merged.truncate(limit as usize);
    Ok((merged, has_more))
}
