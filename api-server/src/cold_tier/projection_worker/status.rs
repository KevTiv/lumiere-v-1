//! Projection status classification and persistence adapters.

use super::super::projection_observability;
use super::decode::{parse_timestamp, require_u64};
use anyhow::{bail, Result};
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
            "SELECT * FROM organization_commit \
             WHERE organization_id = {organization_id} AND sequence >= {sequence}"
        ))
        .await
        .ok()?;
    select_oldest_commit_timestamp(rows, organization_id, sequence)
        .ok()
        .flatten()
}

pub(super) fn select_oldest_commit_timestamp(
    rows: Vec<serde_json::Value>,
    organization_id: u64,
    sequence: u64,
) -> Result<Option<i64>> {
    let mut candidates = Vec::with_capacity(rows.len());
    for row in rows {
        let row_organization_id = require_u64(&row, "organizationId")?;
        let row_sequence = require_u64(&row, "sequence")?;
        if row_organization_id != organization_id {
            bail!(
                "organization commit query returned row outside requested organization {organization_id}"
            );
        }
        if row_sequence >= sequence {
            let occurred_at = parse_timestamp(
                row.get("occurredAt")
                    .ok_or_else(|| anyhow::anyhow!("projection occurredAt is missing"))?,
            )?;
            candidates.push((row_sequence, occurred_at));
        }
    }

    candidates.sort_by_key(|(row_sequence, _)| *row_sequence);
    for pair in candidates.windows(2) {
        if pair[0].0 == pair[1].0 {
            bail!(
                "organization commit query returned duplicate sequence {}",
                pair[0].0
            );
        }
    }
    Ok(candidates.first().map(|(_, occurred_at)| *occurred_at))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn commit(organization_id: u64, sequence: u64, occurred_at: i64) -> serde_json::Value {
        json!({
            "organizationId": organization_id,
            "sequence": sequence,
            "occurredAt": {"microsSinceUnixEpoch": occurred_at},
        })
    }

    #[test]
    fn oldest_commit_selection_sorts_and_filters_in_rust() {
        let occurred_at = select_oldest_commit_timestamp(
            vec![commit(7, 9, 90), commit(7, 5, 50), commit(7, 8, 80)],
            7,
            8,
        )
        .unwrap();
        assert_eq!(occurred_at, Some(80));
    }

    #[test]
    fn oldest_commit_selection_rejects_duplicate_sequences() {
        let error = select_oldest_commit_timestamp(vec![commit(7, 8, 80), commit(7, 8, 81)], 7, 8)
            .unwrap_err();
        assert!(error.to_string().contains("duplicate sequence"));
    }
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
