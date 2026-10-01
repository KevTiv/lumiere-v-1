//! Transport-independent, bounded replay of complete canonical commits.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const MAX_ROWS: usize = 1000;
pub const MAX_COMMITS: u64 = 20;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scope {
    pub environment_id: String,
    pub actor_id: String,
    pub organization_id: String,
    pub company_id: Option<String>,
    pub authorization_version: String,
}

#[derive(Debug, thiserror::Error)]
pub enum FeedError {
    #[error("projection changed; rediscover scope and resnapshot")]
    Reset,
    #[error("projection source is temporarily unavailable")]
    Unavailable,
    #[error("invalid projection cursor")]
    InvalidCursor,
    #[error("invalid canonical projection source: {0}")]
    InvalidSource(String),
}

/// Source implementations validate whole commit envelopes/checksums before projection.
pub trait CategorySource: Sync {
    fn watermark(&self) -> impl std::future::Future<Output = Result<u64, FeedError>> + Send;
    fn snapshot_rows(
        &self,
    ) -> impl std::future::Future<Output = Result<Vec<Value>, FeedError>> + Send;
    fn commit_changes(
        &self,
        sequence: u64,
    ) -> impl std::future::Future<Output = Result<Vec<Value>, FeedError>> + Send;
}

pub fn parse_cursor(raw: &str) -> Result<u64, FeedError> {
    if raw.is_empty()
        || (raw.len() > 1 && raw.starts_with('0'))
        || !raw.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(FeedError::InvalidCursor);
    }
    raw.parse().map_err(|_| FeedError::InvalidCursor)
}

/// Two equal commit watermarks bracket a read during which no recorded category mutation committed.
pub async fn snapshot<S: CategorySource>(
    source: &S,
    scope: &Scope,
    schema_hash: &str,
) -> Result<Value, FeedError> {
    for _ in 0..3 {
        let before = source.watermark().await?;
        let rows = source.snapshot_rows().await?;
        if rows.len() > MAX_ROWS {
            return Err(FeedError::Reset);
        }
        let after = source.watermark().await?;
        if before == after {
            return Ok(
                json!({"kind": "snapshot", "scope": scope, "schemaHash": schema_hash, "cursor": after.to_string(), "rows": rows}),
            );
        }
    }
    Err(FeedError::Unavailable)
}

/// Pagination never splits a commit. Changes inside one commit share its sequence,
/// retain canonical ordinal order, and are applied atomically by the client.
pub async fn pull<S: CategorySource>(
    source: &S,
    scope: &Scope,
    schema_hash: &str,
    cursor: u64,
) -> Result<Value, FeedError> {
    let head = source.watermark().await?;
    if cursor > head {
        return Err(FeedError::Reset);
    }
    let end = cursor.saturating_add(MAX_COMMITS).min(head);
    let mut next = cursor;
    let mut changes = Vec::new();
    while next < end {
        let sequence = next.checked_add(1).ok_or(FeedError::InvalidCursor)?;
        let commit = source.commit_changes(sequence).await?;
        if commit.len() > MAX_ROWS {
            return Err(FeedError::Reset);
        }
        if changes.len() + commit.len() > MAX_ROWS {
            break;
        }
        for change in commit {
            let mut change = change
                .as_object()
                .cloned()
                .ok_or_else(|| FeedError::InvalidSource("change must be an object".into()))?;
            change.insert("sequence".into(), Value::String(sequence.to_string()));
            changes.push(Value::Object(change));
        }
        next = sequence;
    }
    Ok(
        json!({"kind": "pull", "scope": scope, "schemaHash": schema_hash, "fromCursor": cursor.to_string(), "nextCursor": next.to_string(), "changes": changes, "hasMore": next < head}),
    )
}

#[cfg(test)]
#[path = "core/tests.rs"]
mod tests;
