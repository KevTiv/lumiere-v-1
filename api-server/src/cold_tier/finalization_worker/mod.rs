//! Manifest-driven C5 archive finalization coordinator.
//!
//! The archive manifest is a pinned contract artifact, not request data. This
//! coordinator validates the complete candidate list against a deliberately
//! closed table/reducer/mode mapping and then invokes each domain handler in a
//! deterministic order. A new archive candidate therefore cannot silently
//! become a no-op: it must first add an explicit, reviewed handler mapping.

use std::collections::BTreeMap;

use anyhow::{bail, Context, Result};
use deadpool_postgres::Pool;
use serde::Deserialize;
use stdb_client::StdbClient;

mod pos_order;

#[cfg(test)]
mod drill;

/// The generated archive manifest from the pinned contracts release.
pub const ARCHIVE_MANIFEST_JSON: &str = lumiere_contracts::manifests::ARCHIVE_MANIFEST;

/// Per-handler work counters returned by a domain finalization drainer.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct CandidateDrainStats {
    pub read: usize,
    pub archived: usize,
    pub finalized: usize,
    pub reconciled: usize,
    pub failed: usize,
}

/// Aggregate counters for one manifest-driven finalization batch.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct FinalizationDrainStats {
    pub candidates: usize,
    pub read: usize,
    pub archived: usize,
    pub finalized: usize,
    pub reconciled: usize,
    pub failed: usize,
    pub by_candidate: BTreeMap<String, CandidateDrainStats>,
}

impl FinalizationDrainStats {
    fn record(&mut self, table: &str, stats: CandidateDrainStats) {
        self.candidates += 1;
        self.read += stats.read;
        self.archived += stats.archived;
        self.finalized += stats.finalized;
        self.reconciled += stats.reconciled;
        self.failed += stats.failed;
        self.by_candidate.insert(table.to_owned(), stats);
    }
}

/// The subset of generated candidate metadata needed by this coordinator.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct ArchiveCandidate {
    pub table: String,
    pub cold_table: String,
    pub finalize_reducer: String,
    pub mode: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ArchiveManifest {
    version: u32,
    candidates: Vec<ArchiveCandidate>,
}

/// A handler selected only after the candidate has passed the closed mapping.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CandidateHandler {
    PosOrder,
}

/// A validated dispatch target.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DispatchTarget {
    pub table: String,
    pub handler: CandidateHandler,
}

/// Parse and validate a generated archive manifest.
///
/// Validation is closed-world: every candidate must match one exact supported
/// table/reducer/mode/cold-table tuple. Unknown or malformed candidates fail
/// before any handler runs.
pub fn parse_archive_manifest(manifest_json: &str) -> Result<Vec<ArchiveCandidate>> {
    let manifest: ArchiveManifest =
        serde_json::from_str(manifest_json).context("parse pinned archive manifest")?;
    if manifest.version != 1 {
        bail!(
            "unsupported archive manifest version {}; expected 1",
            manifest.version
        );
    }
    let mut candidates = manifest.candidates;
    if candidates.is_empty() {
        bail!("archive manifest must contain at least one candidate");
    }
    for candidate in &candidates {
        validate_candidate(candidate)?;
    }
    candidates.sort_by(|left, right| left.table.cmp(&right.table));
    for pair in candidates.windows(2) {
        if pair[0].table == pair[1].table {
            bail!(
                "archive manifest contains duplicate candidate table '{}'",
                pair[0].table
            );
        }
    }
    Ok(candidates)
}

fn validate_candidate(candidate: &ArchiveCandidate) -> Result<CandidateHandler> {
    if candidate.table.trim().is_empty()
        || candidate.cold_table.trim().is_empty()
        || candidate.finalize_reducer.trim().is_empty()
        || candidate.mode.trim().is_empty()
    {
        bail!("archive candidate has an empty table, cold table, reducer, or mode");
    }

    match (
        candidate.table.as_str(),
        candidate.cold_table.as_str(),
        candidate.finalize_reducer.as_str(),
        candidate.mode.as_str(),
    ) {
        ("pos_order", "cold_pos_order", "finalize_pos_order_archive", "versioned") => {
            Ok(CandidateHandler::PosOrder)
        }
        (table, _, reducer, mode) => bail!(
            "unsupported archive candidate mapping: table '{}', reducer '{}', mode '{}'",
            table,
            reducer,
            mode
        ),
    }
}

/// Return the deterministic handler order for validated candidates.
pub fn dispatch_order(candidates: &[ArchiveCandidate]) -> Result<Vec<DispatchTarget>> {
    let mut ordered = candidates.iter().collect::<Vec<_>>();
    ordered.sort_by(|left, right| left.table.cmp(&right.table));

    let mut targets = Vec::with_capacity(ordered.len());
    for candidate in ordered {
        targets.push(DispatchTarget {
            table: candidate.table.clone(),
            handler: validate_candidate(candidate)?,
        });
    }
    for pair in targets.windows(2) {
        if pair[0].table == pair[1].table {
            bail!(
                "cannot dispatch duplicate candidate table '{}'",
                pair[0].table
            );
        }
    }
    Ok(targets)
}

/// Drain one bounded finalization batch for every generated archive candidate.
///
/// Candidate validation completes before the first handler is called. A
/// handler-level error is returned with candidate context; it is never treated
/// as an unsupported candidate or silently skipped.
pub async fn drain_batch(
    source_stdb: &StdbClient,
    finalizer_stdb: &StdbClient,
    pool: &Pool,
    batch_size: u32,
) -> Result<FinalizationDrainStats> {
    let candidates = parse_archive_manifest(ARCHIVE_MANIFEST_JSON)?;
    let targets = dispatch_order(&candidates)?;
    let mut stats = FinalizationDrainStats::default();

    for target in targets {
        let candidate_stats = match target.handler {
            CandidateHandler::PosOrder => {
                pos_order::drain_batch(source_stdb, finalizer_stdb, pool, batch_size)
                    .await
                    .with_context(|| format!("drain archive candidate '{}'", target.table))?
            }
        };
        stats.record(&target.table, candidate_stats);
    }

    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn candidate(table: &str, cold_table: &str, reducer: &str, mode: &str) -> serde_json::Value {
        json!({
            "table": table,
            "cold_table": cold_table,
            "finalize_reducer": reducer,
            "mode": mode,
        })
    }

    fn manifest(candidates: Vec<serde_json::Value>) -> String {
        serde_json::to_string(&json!({"version": 1, "candidates": candidates})).unwrap()
    }

    #[test]
    fn parses_and_sorts_pinned_candidates() {
        let parsed = parse_archive_manifest(ARCHIVE_MANIFEST_JSON).unwrap();
        assert_eq!(
            parsed
                .iter()
                .map(|candidate| candidate.table.as_str())
                .collect::<Vec<_>>(),
            vec!["pos_order"]
        );
    }

    #[test]
    fn rejects_unknown_table_reducer_and_mode() {
        let cases = [
            candidate("new_table", "cold_new_table", "finalize_new", "append_only"),
            candidate(
                "audit_log",
                "cold_audit_log",
                "finalize_wrong_archive",
                "append_only",
            ),
            candidate(
                "audit_log",
                "cold_audit_log",
                "finalize_audit_log_archive",
                "versioned",
            ),
        ];
        for value in cases {
            let error = parse_archive_manifest(&manifest(vec![value])).unwrap_err();
            assert!(error
                .to_string()
                .contains("unsupported archive candidate mapping"));
        }
    }

    #[test]
    fn dispatch_order_is_stable_and_closed() {
        let values = vec![candidate(
            "pos_order",
            "cold_pos_order",
            "finalize_pos_order_archive",
            "versioned",
        )];
        let candidates = parse_archive_manifest(&manifest(values)).unwrap();
        let targets = dispatch_order(&candidates).unwrap();
        assert_eq!(targets[0].table, "pos_order");
        assert_eq!(targets[0].handler, CandidateHandler::PosOrder);
    }

    #[test]
    fn rejects_duplicate_candidate_tables() {
        let value = candidate(
            "pos_order",
            "cold_pos_order",
            "finalize_pos_order_archive",
            "versioned",
        );
        let error = parse_archive_manifest(&manifest(vec![value.clone(), value])).unwrap_err();
        assert!(error.to_string().contains("duplicate candidate table"));
    }

    #[test]
    fn aggregates_candidate_stats() {
        let mut aggregate = FinalizationDrainStats::default();
        aggregate.record(
            "pos_order",
            CandidateDrainStats {
                read: 4,
                archived: 3,
                finalized: 2,
                reconciled: 1,
                failed: 1,
            },
        );
        aggregate.record(
            "another_candidate",
            CandidateDrainStats {
                read: 6,
                archived: 5,
                finalized: 4,
                reconciled: 2,
                failed: 0,
            },
        );
        assert_eq!(aggregate.candidates, 2);
        assert_eq!(
            (
                aggregate.read,
                aggregate.archived,
                aggregate.finalized,
                aggregate.reconciled,
                aggregate.failed
            ),
            (10, 8, 6, 3, 1)
        );
        assert_eq!(aggregate.by_candidate["pos_order"].failed, 1);
    }
}
