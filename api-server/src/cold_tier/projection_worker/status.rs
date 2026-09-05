//! Projection status classification and persistence adapters.

use super::super::projection_observability;
use super::decode::parse_timestamp;
use anyhow::Result;
use deadpool_postgres::Pool;
use stdb_client::StdbClient;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ProjectionFailureKind {
    Retryable,
    Quarantine,
}

/// `apply_commit` validates the complete envelope before obtaining a PG
/// connection. Validation failures are deterministic and quarantine-worthy;
/// connection, transaction, and SQL failures are retryable.
pub(super) fn classify_apply_error(error: &anyhow::Error) -> ProjectionFailureKind {
    const VALIDATION_MARKERS: &[&str] = &[
        "unsupported",
        "checksum",
        "does not match",
        "does not accept",
        "did not affect",
        "must contain",
        "must not contain",
        "missing",
        "invalid",
        "unsafe",
        "expected",
        "contiguous",
        "identity",
        "canonical",
        "json",
        "primary key",
        "row change",
        "change kind",
    ];
    if error.chain().any(|cause| {
        let message = cause.to_string().to_ascii_lowercase();
        VALIDATION_MARKERS
            .iter()
            .any(|marker| message.contains(marker))
    }) {
        ProjectionFailureKind::Quarantine
    } else {
        ProjectionFailureKind::Retryable
    }
}

pub(super) fn projection_heads(available_next_sequence: u64, next_sequence: u64) -> (u64, u64) {
    (
        available_next_sequence.saturating_sub(1),
        next_sequence.saturating_sub(1),
    )
}

pub(super) async fn oldest_unprojected_at(
    stdb: &StdbClient,
    organization_id: u64,
    sequence: u64,
) -> Option<i64> {
    let rows = stdb
        .query_sql(&format!(
            "SELECT occurred_at FROM organization_commit \
             WHERE organization_id = {organization_id} AND sequence >= {sequence} \
             ORDER BY sequence ASC LIMIT 1"
        ))
        .await
        .ok()?;
    rows.first()
        .and_then(|row| row.get("occurredAt"))
        .and_then(|value| parse_timestamp(value).ok())
}

pub(super) async fn record_success(
    pool: &Pool,
    organization_id: u64,
    stdb_head: u64,
    durable_sequence: u64,
    oldest_unprojected_at: Option<i64>,
) -> Result<()> {
    projection_observability::record_projection_success(
        pool,
        organization_id,
        stdb_head,
        durable_sequence,
        oldest_unprojected_at,
    )
    .await?;
    projection_observability::clear_resolved_quarantine(pool, organization_id, durable_sequence)
        .await
        .map(|_| ())
}

pub(super) async fn record_failure(
    pool: &Pool,
    organization_id: u64,
    stdb_head: u64,
    durable_sequence: u64,
    oldest_unprojected_at: Option<i64>,
    failure_kind: &str,
    error: &anyhow::Error,
    quarantined_sequence: Option<u64>,
) -> Result<()> {
    let error_message = format!("{error:#}");
    projection_observability::record_projection_failure(
        pool,
        organization_id,
        stdb_head,
        durable_sequence,
        oldest_unprojected_at,
        failure_kind,
        &error_message,
        quarantined_sequence,
    )
    .await
}
