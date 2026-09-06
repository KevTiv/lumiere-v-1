//! Bounded per-organization projection drain.

use super::super::commit_projection;
use super::decode::{parse_change, parse_commit, require_u64};
use super::require_server_identity;
use super::source::{next_projection_sequence, query_cursors, select_commit_row};
use super::status::{
    classify_apply_error, oldest_unprojected_at, projection_heads, record_failure, record_success,
    ProjectionFailureKind,
};
use super::{ProjectionDrainBudget, ProjectionDrainStats};
use super::{CURSOR_SCAN_AFTER, MAX_CHANGES_PER_COMMIT, PROJECTION_CODEC_MANIFEST_JSON};
use anyhow::{anyhow, bail, Context, Result};
use deadpool_postgres::Pool;
use futures_util::{stream, StreamExt};
use serde_json::Value;
use std::collections::BTreeSet;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use stdb_client::StdbClient;

pub async fn drain_batch(
    stdb: &StdbClient,
    pool: &Pool,
    batch_size: u32,
) -> Result<ProjectionDrainStats> {
    drain_batch_with_budget(stdb, pool, batch_size, ProjectionDrainBudget::default()).await
}

pub async fn drain_batch_with_budget(
    stdb: &StdbClient,
    pool: &Pool,
    batch_size: u32,
    budget: ProjectionDrainBudget,
) -> Result<ProjectionDrainStats> {
    require_server_identity(stdb)?;
    if budget.max_commits_per_organization == 0
        || budget.max_bytes_per_organization == 0
        || budget.max_elapsed_per_organization.is_zero()
        || budget.max_concurrent_organizations == 0
    {
        bail!("projection drain budgets must be positive");
    }
    // Cursor rows are private protocol tables. The worker's StdbClient must
    // use the configured server/admin identity; see `serve`, which rejects
    // startup when STDB_SERVER_TOKEN is absent.
    let scan_after = CURSOR_SCAN_AFTER.load(Ordering::Relaxed);
    let mut cursors = match query_cursors(stdb, scan_after, batch_size).await {
        Ok(cursors) => cursors,
        Err(error) => return Err(error),
    };
    if cursors.is_empty() && scan_after != 0 {
        // Wrap once per cycle so a newly active low-ID organization is not
        // delayed indefinitely after the scan reaches the upper bound.
        CURSOR_SCAN_AFTER.store(0, Ordering::Relaxed);
        cursors = match query_cursors(stdb, 0, batch_size).await {
            Ok(cursors) => cursors,
            Err(error) => return Err(error),
        };
    }
    if let Some(cursor) = cursors.last() {
        if let Some(organization_id) = cursor.get("organizationId").and_then(Value::as_u64) {
            CURSOR_SCAN_AFTER.store(organization_id, Ordering::Relaxed);
        }
    }
    let max_concurrency = budget
        .max_concurrent_organizations
        .min(cursors.len().max(1));
    let results = stream::iter(cursors.into_iter().map(|cursor| {
        let stdb = stdb.clone();
        let pool = pool.clone();
        async move { drain_organization(&stdb, &pool, cursor, budget).await }
    }))
    .buffer_unordered(max_concurrency)
    .collect::<Vec<_>>()
    .await;

    Ok(results
        .into_iter()
        .fold(ProjectionDrainStats::default(), |mut total, stats| {
            total.organizations += stats.organizations;
            total.commits += stats.commits;
            total.already_applied += stats.already_applied;
            total.failed += stats.failed;
            total.bytes += stats.bytes;
            total.backlog_remaining |= stats.backlog_remaining;
            total
        }))
}

/// Catch one organization up without monopolizing a worker pass.
async fn drain_organization(
    stdb: &StdbClient,
    pool: &Pool,
    cursor: Value,
    budget: ProjectionDrainBudget,
) -> ProjectionDrainStats {
    let started = Instant::now();
    let mut stats = ProjectionDrainStats {
        organizations: 1,
        ..Default::default()
    };
    loop {
        if budget_exhausted(&stats, started.elapsed(), budget) {
            stats.backlog_remaining = true;
            break;
        }
        let before_progress = stats.commits + stats.already_applied;
        let before_failed = stats.failed;
        drain_one_commit(stdb, pool, cursor.clone(), &mut stats).await;
        if stats.failed != before_failed || stats.commits + stats.already_applied == before_progress
        {
            break;
        }
    }
    stats
}

fn budget_exhausted(
    stats: &ProjectionDrainStats,
    elapsed: Duration,
    budget: ProjectionDrainBudget,
) -> bool {
    stats.commits + stats.already_applied >= budget.max_commits_per_organization
        || stats.bytes >= budget.max_bytes_per_organization
        || elapsed >= budget.max_elapsed_per_organization
}

/// Apply one exact next commit while preserving its atomic ordered boundary.
async fn drain_one_commit(
    stdb: &StdbClient,
    pool: &Pool,
    cursor: Value,
    stats: &mut ProjectionDrainStats,
) {
    let organization_id = match require_u64(&cursor, "organizationId") {
        Ok(value) => value,
        Err(error) => {
            stats.failed += 1;
            tracing::error!(%error, "projection cursor is malformed");
            return;
        }
    };
    let available_next_sequence = match require_u64(&cursor, "nextSequence") {
        Ok(value) => value,
        Err(error) => {
            stats.failed += 1;
            if let Err(status_error) = record_failure(
                pool,
                organization_id,
                0,
                0,
                None,
                "malformed_cursor",
                &error,
                None,
            )
            .await
            {
                stats.failed += 1;
                tracing::error!(%status_error, organization_id, "record malformed cursor status failed");
            }
            tracing::error!(%error, organization_id, "projection cursor is malformed");
            return;
        }
    };
    let next_sequence = match next_projection_sequence(pool, organization_id).await {
        Ok(value) => value,
        Err(error) => {
            stats.failed += 1;
            if let Err(status_error) = record_failure(
                pool,
                organization_id,
                available_next_sequence.saturating_sub(1),
                0,
                None,
                "pg_transport",
                &error,
                None,
            )
            .await
            {
                stats.failed += 1;
                tracing::error!(%status_error, organization_id, "record watermark failure status failed");
            }
            tracing::error!(%error, organization_id, "read projection watermark failed");
            return;
        }
    };
    let (stdb_head, pg_durable_head) = projection_heads(available_next_sequence, next_sequence);
    if next_sequence >= available_next_sequence {
        if let Err(error) =
            record_success(pool, organization_id, stdb_head, pg_durable_head, None).await
        {
            stats.failed += 1;
            tracing::error!(%error, organization_id, "record projection success status failed");
        }
        return;
    }
    let commit_rows = match stdb
        .query_sql(&format!(
            "SELECT * FROM organization_commit \
             WHERE organization_id = {organization_id} AND sequence = {next_sequence}"
        ))
        .await
        .with_context(|| format!("query organization {organization_id} commit {next_sequence}"))
    {
        Ok(rows) => rows,
        Err(error) => {
            stats.failed += 1;
            if let Err(status_error) = record_failure(
                pool,
                organization_id,
                stdb_head,
                pg_durable_head,
                None,
                "stdb_transport",
                &error,
                None,
            )
            .await
            {
                stats.failed += 1;
                tracing::error!(%status_error, organization_id, "record projection failure status failed");
            }
            tracing::error!(%error, organization_id, sequence = next_sequence, "query projection commit failed");
            return;
        }
    };
    let commit_row = match select_commit_row(commit_rows, organization_id, next_sequence) {
        Ok(Some(row)) => row,
        Ok(None) => {
            let error = anyhow!(
                "organization {organization_id} projection commit {next_sequence} is missing"
            );
            stats.failed += 1;
            if let Err(status_error) = record_failure(
                pool,
                organization_id,
                stdb_head,
                pg_durable_head,
                None,
                "gap",
                &error,
                None,
            )
            .await
            {
                stats.failed += 1;
                tracing::error!(%status_error, organization_id, "record projection gap status failed");
            }
            tracing::warn!(%error, "projection commit gap; watermark remains unchanged");
            return;
        }
        Err(error) => {
            stats.failed += 1;
            if let Err(status_error) = record_failure(
                pool,
                organization_id,
                stdb_head,
                pg_durable_head,
                None,
                "malformed_commit",
                &error,
                Some(next_sequence),
            )
            .await
            {
                stats.failed += 1;
                tracing::error!(%status_error, organization_id, "record malformed projection status failed");
            }
            tracing::error!(%error, organization_id, sequence = next_sequence, "projection commit cardinality check failed");
            return;
        }
    };
    let mut projected_bytes = serde_json::to_vec(&commit_row).map_or(0, |bytes| bytes.len());
    let commit = match parse_commit(&commit_row) {
        Ok(commit) => commit,
        Err(error) => {
            stats.failed += 1;
            if let Err(status_error) = record_failure(
                pool,
                organization_id,
                stdb_head,
                pg_durable_head,
                None,
                "malformed_commit",
                &error,
                Some(next_sequence),
            )
            .await
            {
                stats.failed += 1;
                tracing::error!(%status_error, organization_id, "record malformed projection status failed");
            }
            tracing::error!(%error, organization_id, sequence = next_sequence, "malformed projection commit quarantined");
            return;
        }
    };
    if commit.organization_id != organization_id || commit.sequence != next_sequence {
        let error = anyhow!("organization commit query returned a mismatched cursor scope");
        stats.failed += 1;
        if let Err(status_error) = record_failure(
            pool,
            organization_id,
            stdb_head,
            pg_durable_head,
            None,
            "commit_scope_mismatch",
            &error,
            Some(next_sequence),
        )
        .await
        {
            stats.failed += 1;
            tracing::error!(%status_error, organization_id, "record projection scope status failed");
        }
        tracing::error!(%error, organization_id, sequence = next_sequence, "projection commit scope mismatch quarantined");
        return;
    }
    let changes = match stdb
        .query_sql(&format!(
            "SELECT * FROM organization_row_change \
             WHERE organization_id = {organization_id} \
               AND commit_sequence = {next_sequence}"
        ))
        .await
        .with_context(|| {
            format!("query organization {organization_id} commit {next_sequence} changes")
        }) {
        Ok(changes) => changes,
        Err(error) => {
            stats.failed += 1;
            if let Err(status_error) = record_failure(
                pool,
                organization_id,
                stdb_head,
                pg_durable_head,
                Some(commit.occurred_at_micros),
                "stdb_transport",
                &error,
                None,
            )
            .await
            {
                stats.failed += 1;
                tracing::error!(%status_error, organization_id, "record projection transport status failed");
            }
            tracing::error!(%error, organization_id, sequence = next_sequence, "query projection changes failed");
            return;
        }
    };
    projected_bytes = projected_bytes.saturating_add(
        changes
            .iter()
            .map(|row| serde_json::to_vec(row).map_or(0, |bytes| bytes.len()))
            .sum::<usize>(),
    );
    let changes = match normalize_changes(
        changes,
        organization_id,
        next_sequence,
        commit.row_change_count,
    ) {
        Ok(changes) => changes,
        Err(error) => {
            let failure_kind = if error.to_string().contains("bounded change limit") {
                "change_limit"
            } else {
                "malformed_change"
            };
            stats.failed += 1;
            if let Err(status_error) = record_failure(
                pool,
                organization_id,
                stdb_head,
                pg_durable_head,
                Some(commit.occurred_at_micros),
                failure_kind,
                &error,
                Some(next_sequence),
            )
            .await
            {
                stats.failed += 1;
                tracing::error!(%status_error, organization_id, "record projection change status failed");
            }
            tracing::error!(%error, organization_id, sequence = next_sequence, "projection changes quarantined");
            return;
        }
    };
    let result =
        commit_projection::apply_commit(pool, PROJECTION_CODEC_MANIFEST_JSON, &commit, &changes)
            .await
            .with_context(|| {
                format!("apply organization {organization_id} commit {next_sequence}")
            });
    match result {
        Err(error) => {
            let (failure_kind, quarantine) = match classify_apply_error(&error) {
                ProjectionFailureKind::Quarantine => ("incompatible_commit", Some(next_sequence)),
                ProjectionFailureKind::Retryable => ("pg_application", None),
            };
            stats.failed += 1;
            if let Err(status_error) = record_failure(
                pool,
                organization_id,
                stdb_head,
                pg_durable_head,
                Some(commit.occurred_at_micros),
                failure_kind,
                &error,
                quarantine,
            )
            .await
            {
                stats.failed += 1;
                tracing::error!(%status_error, organization_id, "record projection incompatible status failed");
            }
            tracing::error!(%error, failure_kind, organization_id, sequence = next_sequence, "projection commit failed");
        }
        Ok(commit_projection::ProjectionResult::Applied) => {
            stats.commits += 1;
            stats.bytes = stats.bytes.saturating_add(projected_bytes);
            let oldest = if stdb_head > next_sequence {
                oldest_unprojected_at(stdb, organization_id, next_sequence.saturating_add(1)).await
            } else {
                None
            };
            if let Err(error) =
                record_success(pool, organization_id, stdb_head, next_sequence, oldest).await
            {
                stats.failed += 1;
                tracing::error!(%error, organization_id, "record projection success status failed");
            }
        }
        Ok(commit_projection::ProjectionResult::AlreadyApplied) => {
            stats.already_applied += 1;
            stats.bytes = stats.bytes.saturating_add(projected_bytes);
            let oldest = if stdb_head > next_sequence {
                oldest_unprojected_at(stdb, organization_id, next_sequence.saturating_add(1)).await
            } else {
                None
            };
            if let Err(error) =
                record_success(pool, organization_id, stdb_head, next_sequence, oldest).await
            {
                stats.failed += 1;
                tracing::error!(%error, organization_id, "record projection success status failed");
            }
        }
    }
}

fn normalize_changes(
    rows: Vec<Value>,
    organization_id: u64,
    commit_sequence: u64,
    expected_count: u32,
) -> Result<Vec<commit_projection::OrganizationRowChangeInput>> {
    if rows.len() > MAX_CHANGES_PER_COMMIT {
        bail!(
            "organization {organization_id} commit {commit_sequence} exceeds the bounded change limit"
        );
    }

    let mut indexed = Vec::with_capacity(rows.len());
    let mut seen_ordinals = BTreeSet::new();
    let mut seen_ids = BTreeSet::new();
    for row in rows {
        let row_organization_id = require_u64(&row, "organizationId")?;
        let row_commit_sequence = require_u64(&row, "commitSequence")?;
        if row_organization_id != organization_id || row_commit_sequence != commit_sequence {
            bail!(
                "organization row-change query returned row outside requested organization {organization_id} sequence {commit_sequence}"
            );
        }
        let change = parse_change(&row)?;
        if !seen_ordinals.insert(change.ordinal) {
            bail!(
                "organization {organization_id} commit {commit_sequence} returned duplicate change ordinal {}",
                change.ordinal
            );
        }
        if !seen_ids.insert(change.id.clone()) {
            bail!(
                "organization {organization_id} commit {commit_sequence} returned duplicate change id {}",
                change.id
            );
        }
        indexed.push((change.ordinal, change.id.clone(), change));
    }

    if indexed.len() != expected_count as usize {
        bail!(
            "organization {organization_id} commit {commit_sequence} returned {} changes; expected {}",
            indexed.len(),
            expected_count
        );
    }

    indexed.sort_by_key(|(ordinal, _, _)| *ordinal);

    Ok(indexed.into_iter().map(|(_, _, change)| change).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn change(id: &str, organization_id: u64, commit_sequence: u64, ordinal: u64) -> Value {
        json!({
            "id": id,
            "organizationId": organization_id,
            "commitSequence": commit_sequence,
            "ordinal": ordinal,
            "tableName": "company",
            "rowIdentityJson": format!("{{\"id\":{ordinal}}}"),
            "changeKind": "upsert",
            "rowJson": "{}",
            "checksum": format!("{:0>64}", ordinal),
        })
    }

    #[test]
    fn normalizes_changes_by_ordinal_and_requires_commit_cardinality() {
        let normalized = normalize_changes(
            vec![
                change("change-2", 7, 4, 2),
                change("change-0", 7, 4, 0),
                change("change-1", 7, 4, 1),
            ],
            7,
            4,
            3,
        )
        .unwrap();
        assert_eq!(
            normalized
                .iter()
                .map(|change| change.ordinal)
                .collect::<Vec<_>>(),
            vec![0, 1, 2]
        );

        let mismatch = normalize_changes(vec![change("change-0", 7, 4, 0)], 7, 4, 2);
        assert!(mismatch.unwrap_err().to_string().contains("expected 2"));
    }

    #[test]
    fn normalization_rejects_duplicate_or_out_of_scope_changes() {
        let duplicate_ordinal = normalize_changes(
            vec![change("change-0", 7, 4, 0), change("change-1", 7, 4, 0)],
            7,
            4,
            2,
        );
        assert!(duplicate_ordinal
            .unwrap_err()
            .to_string()
            .contains("duplicate change ordinal"));

        let duplicate_id = normalize_changes(
            vec![change("same", 7, 4, 0), change("same", 7, 4, 1)],
            7,
            4,
            2,
        );
        assert!(duplicate_id
            .unwrap_err()
            .to_string()
            .contains("duplicate change id"));

        let out_of_scope = normalize_changes(vec![change("change-0", 8, 4, 0)], 7, 4, 1);
        assert!(out_of_scope
            .unwrap_err()
            .to_string()
            .contains("outside requested"));
    }

    #[test]
    fn catch_up_budget_bounds_commits_bytes_and_elapsed_time() {
        let budget = ProjectionDrainBudget {
            max_commits_per_organization: 2,
            max_bytes_per_organization: 100,
            max_elapsed_per_organization: Duration::from_millis(10),
            max_concurrent_organizations: 3,
        };
        let mut stats = ProjectionDrainStats::default();
        assert!(!budget_exhausted(&stats, Duration::ZERO, budget));
        stats.commits = 2;
        assert!(budget_exhausted(&stats, Duration::ZERO, budget));
        stats.commits = 0;
        stats.bytes = 100;
        assert!(budget_exhausted(&stats, Duration::ZERO, budget));
        stats.bytes = 0;
        assert!(budget_exhausted(&stats, Duration::from_millis(10), budget));
    }
}
