//! Durable status and failure bookkeeping for the organization projector.
//!
//! The projector is intentionally able to restart at any point.  This module
//! stores the state needed to explain where it is, and keeps a durable record
//! of failures that need operator or application-level intervention.  The
//! functions here do not advance the projection watermark.

use anyhow::{Context, Result};
use deadpool_postgres::Pool;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Maximum number of UTF-8 bytes retained for a projection error message.
pub const MAX_ERROR_MESSAGE_BYTES: usize = 4 * 1024;
/// Maximum number of UTF-8 bytes retained for a failure category.
pub const MAX_FAILURE_KIND_BYTES: usize = 128;

/// A status row for one organization's projection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionStatus {
    pub organization_id: u64,
    pub stdb_head_sequence: u64,
    pub durable_sequence: u64,
    pub backlog_commits: u64,
    /// Occurred-at timestamp (microseconds since the Unix epoch) of the
    /// oldest commit that has not yet been projected, when known.
    pub oldest_unprojected_at: Option<i64>,
    /// Wall-clock age of the oldest unprojected commit at read time.
    pub oldest_unprojected_age_seconds: Option<u64>,
    pub last_error: Option<String>,
    pub quarantined_sequence: Option<u64>,
}

/// Bound a value by UTF-8 bytes without splitting a code point.
fn bounded(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_owned();
    }
    let mut end = 0;
    for (index, character) in value.char_indices() {
        let next = index + character.len_utf8();
        if next > max_bytes {
            break;
        }
        end = next;
    }
    value[..end].to_owned()
}

fn bounded_error(value: &str) -> String {
    bounded(value, MAX_ERROR_MESSAGE_BYTES)
}

fn bounded_failure_kind(value: &str) -> String {
    bounded(value, MAX_FAILURE_KIND_BYTES)
}

fn parse_u64(value: &str, field: &str) -> Result<u64> {
    value
        .parse::<u64>()
        .with_context(|| format!("decode projection status {field}"))
}

fn parse_optional_u64(value: Option<String>, field: &str) -> Result<Option<u64>> {
    value.map(|value| parse_u64(&value, field)).transpose()
}

fn decode_status(row: &tokio_postgres::Row) -> Result<ProjectionStatus> {
    let stdb_head_sequence = parse_u64(&row.get::<_, String>(1), "stdb_head_sequence")?;
    let durable_sequence = parse_u64(&row.get::<_, String>(2), "durable_sequence")?;
    let oldest_unprojected_at = row.get(4);
    Ok(ProjectionStatus {
        organization_id: parse_u64(&row.get::<_, String>(0), "organization_id")?,
        stdb_head_sequence,
        durable_sequence,
        // Backlog is derived from the two source cursors.  Do not trust a
        // stale denormalized value if a row was written by an older binary.
        backlog_commits: stdb_head_sequence.saturating_sub(durable_sequence),
        oldest_unprojected_at,
        oldest_unprojected_age_seconds: oldest_unprojected_at.map(oldest_unprojected_age_seconds),
        last_error: row.get(5),
        quarantined_sequence: parse_optional_u64(row.get(6), "quarantined_sequence")?,
    })
}

fn oldest_unprojected_age_seconds(timestamp_micros: i64) -> u64 {
    let now_micros = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_micros()).ok())
        .unwrap_or(i64::MAX);
    u64::try_from(now_micros.saturating_sub(timestamp_micros)).unwrap_or(0) / 1_000_000
}

const STATUS_COLUMNS: &str = "organization_id::TEXT, stdb_head_sequence::TEXT, \
    durable_sequence::TEXT, backlog_commits::TEXT, oldest_unprojected_at, \
    last_error, quarantined_sequence::TEXT";

/// Read one organization's durable projection status.
pub async fn read_projection_status(
    pool: &Pool,
    organization_id: u64,
) -> Result<Option<ProjectionStatus>> {
    let client = pool
        .get()
        .await
        .context("get PG client for projection status")?;
    let organization_id = organization_id.to_string();
    client
        .query_opt(
            &format!("SELECT {STATUS_COLUMNS} FROM organization_projection_status WHERE organization_id = $1::TEXT::NUMERIC"),
            &[&organization_id],
        )
        .await
        .context("read organization projection status")?
        .map(|row| decode_status(&row))
        .transpose()
}

/// Read all durable projection statuses in organization order.
pub async fn read_projection_statuses(pool: &Pool) -> Result<Vec<ProjectionStatus>> {
    let client = pool
        .get()
        .await
        .context("get PG client for projection statuses")?;
    let rows = client
        .query(
            &format!("SELECT {STATUS_COLUMNS} FROM organization_projection_status ORDER BY organization_id ASC"),
            &[],
        )
        .await
        .context("read organization projection statuses")?;
    rows.iter().map(decode_status).collect()
}

/// Read one status as a JSON object, suitable for an operational endpoint.
pub async fn read_projection_status_json(
    pool: &Pool,
    organization_id: u64,
) -> Result<Option<Value>> {
    read_projection_status(pool, organization_id)
        .await?
        .map(|status| serde_json::to_value(status).context("serialize projection status"))
        .transpose()
}

/// Read all statuses as JSON objects, suitable for an operational endpoint.
pub async fn read_projection_statuses_json(pool: &Pool) -> Result<Vec<Value>> {
    read_projection_statuses(pool)
        .await?
        .into_iter()
        .map(|status| serde_json::to_value(status).context("serialize projection status"))
        .collect()
}

async fn upsert_status(
    transaction: &tokio_postgres::Transaction<'_>,
    organization_id: u64,
    stdb_head_sequence: u64,
    durable_sequence: u64,
    oldest_unprojected_at: Option<i64>,
    last_error: Option<&str>,
    quarantined_sequence: Option<u64>,
) -> Result<()> {
    let organization_id = organization_id.to_string();
    let stdb_head_sequence = stdb_head_sequence.to_string();
    let durable_sequence = durable_sequence.to_string();
    let quarantined_sequence = quarantined_sequence.map(|sequence| sequence.to_string());
    transaction
        .execute(
            "INSERT INTO organization_projection_status \
                (organization_id, stdb_head_sequence, durable_sequence, backlog_commits, \
                 oldest_unprojected_at, last_error, quarantined_sequence, updated_at) \
             VALUES ($1::TEXT::NUMERIC, $2::TEXT::NUMERIC, $3::TEXT::NUMERIC, \
                     GREATEST($2::TEXT::NUMERIC - $3::TEXT::NUMERIC, 0), $4, $5, $6::TEXT::NUMERIC, now()) \
             ON CONFLICT (organization_id) DO UPDATE SET \
                stdb_head_sequence = EXCLUDED.stdb_head_sequence, \
                durable_sequence = EXCLUDED.durable_sequence, \
                backlog_commits = EXCLUDED.backlog_commits, \
                oldest_unprojected_at = EXCLUDED.oldest_unprojected_at, \
                last_error = EXCLUDED.last_error, \
                quarantined_sequence = COALESCE(\
                    EXCLUDED.quarantined_sequence, organization_projection_status.quarantined_sequence), \
                updated_at = now()",
            &[
                &organization_id,
                &stdb_head_sequence,
                &durable_sequence,
                &oldest_unprojected_at,
                &last_error,
                &quarantined_sequence,
            ],
        )
        .await
        .context("upsert organization projection status")?;
    Ok(())
}

async fn upsert_quarantine(
    transaction: &tokio_postgres::Transaction<'_>,
    organization_id: u64,
    sequence: u64,
    failure_kind: &str,
    error_message: &str,
) -> Result<u64> {
    let organization_id = organization_id.to_string();
    let sequence = sequence.to_string();
    let failure_kind = bounded_failure_kind(failure_kind);
    let error_message = bounded_error(error_message);
    let row = transaction
        .query_one(
            "INSERT INTO organization_projection_quarantine \
                (organization_id, sequence, failure_kind, error_message, attempts, \
                 first_observed_at, last_observed_at) \
             VALUES ($1::TEXT::NUMERIC, $2::TEXT::NUMERIC, $3, $4, 1, now(), now()) \
             ON CONFLICT (organization_id, sequence) DO UPDATE SET \
                failure_kind = EXCLUDED.failure_kind, \
                error_message = EXCLUDED.error_message, \
                attempts = organization_projection_quarantine.attempts + 1, \
                last_observed_at = now() \
             RETURNING attempts",
            &[&organization_id, &sequence, &failure_kind, &error_message],
        )
        .await
        .context("upsert organization projection quarantine")?;
    u64::try_from(row.get::<_, i64>(0)).context("decode projection quarantine attempts")
}

/// Record a successful poll/application attempt.  This does not clear an
/// existing quarantine; callers must explicitly call [`clear_quarantine`]
/// after the failed sequence has been resolved.
pub async fn record_projection_success(
    pool: &Pool,
    organization_id: u64,
    stdb_head_sequence: u64,
    durable_sequence: u64,
    oldest_unprojected_at: Option<i64>,
) -> Result<()> {
    let mut client = pool
        .get()
        .await
        .context("get PG client for projection success")?;
    let transaction = client
        .transaction()
        .await
        .context("begin projection success transaction")?;
    upsert_status(
        &transaction,
        organization_id,
        stdb_head_sequence,
        durable_sequence,
        oldest_unprojected_at,
        None,
        None,
    )
    .await?;
    transaction
        .commit()
        .await
        .context("commit projection success status")
}

/// Record a failed attempt and, when `quarantined_sequence` is provided,
/// durably quarantine that exact sequence without changing the watermark.
pub async fn record_projection_failure(
    pool: &Pool,
    organization_id: u64,
    stdb_head_sequence: u64,
    durable_sequence: u64,
    oldest_unprojected_at: Option<i64>,
    failure_kind: &str,
    error_message: &str,
    quarantined_sequence: Option<u64>,
) -> Result<()> {
    let mut client = pool
        .get()
        .await
        .context("get PG client for projection failure")?;
    let transaction = client
        .transaction()
        .await
        .context("begin projection failure transaction")?;
    let error_message = bounded_error(error_message);
    upsert_status(
        &transaction,
        organization_id,
        stdb_head_sequence,
        durable_sequence,
        oldest_unprojected_at,
        Some(&error_message),
        quarantined_sequence,
    )
    .await?;
    if let Some(sequence) = quarantined_sequence {
        upsert_quarantine(
            &transaction,
            organization_id,
            sequence,
            failure_kind,
            &error_message,
        )
        .await?;
    }
    transaction
        .commit()
        .await
        .context("commit projection failure status")
}

/// Record or retry a quarantined sequence.  If a status row exists, its
/// `quarantined_sequence` is updated as well; this function never advances a
/// projection watermark.
pub async fn record_quarantine(
    pool: &Pool,
    organization_id: u64,
    sequence: u64,
    failure_kind: &str,
    error_message: &str,
) -> Result<u64> {
    let mut client = pool
        .get()
        .await
        .context("get PG client for projection quarantine")?;
    let transaction = client
        .transaction()
        .await
        .context("begin projection quarantine transaction")?;
    let attempts = upsert_quarantine(
        &transaction,
        organization_id,
        sequence,
        failure_kind,
        error_message,
    )
    .await?;
    let organization_id = organization_id.to_string();
    let sequence = sequence.to_string();
    transaction
        .execute(
            "UPDATE organization_projection_status SET quarantined_sequence = $2::TEXT::NUMERIC, updated_at = now() \
             WHERE organization_id = $1::TEXT::NUMERIC",
            &[&organization_id, &sequence],
        )
        .await
        .context("update projection status quarantine")?;
    transaction
        .commit()
        .await
        .context("commit projection quarantine")?;
    Ok(attempts)
}

/// Clear a resolved quarantine.  Returns whether a quarantine row was
/// removed.  The status pointer is cleared only when it points at `sequence`.
pub async fn clear_quarantine(pool: &Pool, organization_id: u64, sequence: u64) -> Result<bool> {
    let mut client = pool
        .get()
        .await
        .context("get PG client for clear projection quarantine")?;
    let transaction = client
        .transaction()
        .await
        .context("begin clear projection quarantine transaction")?;
    let organization_id = organization_id.to_string();
    let sequence = sequence.to_string();
    let removed = transaction
        .execute(
            "DELETE FROM organization_projection_quarantine WHERE organization_id = $1::TEXT::NUMERIC AND sequence = $2::TEXT::NUMERIC",
            &[&organization_id, &sequence],
        )
        .await
        .context("delete organization projection quarantine")?
        > 0;
    transaction
        .execute(
            "UPDATE organization_projection_status SET quarantined_sequence = NULL, updated_at = now() \
             WHERE organization_id = $1::TEXT::NUMERIC AND quarantined_sequence = $2::TEXT::NUMERIC",
            &[&organization_id, &sequence],
        )
        .await
        .context("clear projection status quarantine")?;
    transaction
        .commit()
        .await
        .context("commit clear projection quarantine")?;
    Ok(removed)
}

/// Explicitly named alias for callers that want to emphasize lifecycle.
pub async fn clear_resolved_quarantine(
    pool: &Pool,
    organization_id: u64,
    sequence: u64,
) -> Result<bool> {
    clear_quarantine(pool, organization_id, sequence).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_error_on_utf8_boundary() {
        let value = "€".repeat(MAX_ERROR_MESSAGE_BYTES);
        let bounded = bounded_error(&value);
        assert!(bounded.len() <= MAX_ERROR_MESSAGE_BYTES);
        assert!(bounded.chars().all(|character| character == '€'));
    }

    #[test]
    fn leaves_short_messages_unchanged() {
        assert_eq!(bounded_error("projection failed"), "projection failed");
        assert_eq!(bounded_failure_kind("gap"), "gap");
    }

    #[test]
    fn status_serializes_operational_fields() {
        let status = ProjectionStatus {
            organization_id: 7,
            stdb_head_sequence: 12,
            durable_sequence: 9,
            backlog_commits: 3,
            oldest_unprojected_at: Some(123),
            oldest_unprojected_age_seconds: Some(1),
            last_error: Some("gap".into()),
            quarantined_sequence: Some(10),
        };
        let json = serde_json::to_value(status).expect("status is serializable");
        assert_eq!(json["backlogCommits"], 3);
        assert_eq!(json["quarantinedSequence"], 10);
        assert_eq!(json["oldestUnprojectedAt"], 123);
        assert_eq!(json["oldestUnprojectedAgeSeconds"], 1);
    }
}
