//! Exact retirement effects for a folder's registered document evidence.
//!
//! The caller captures before any retirement and records the returned changes
//! in the same transaction as the folder mutation. Unchanged company references
//! are excluded. Audit and queue history are append-only in this call chain, so
//! only rows above their pre-mutation watermarks need serialization.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::json;
use spacetimedb::ReducerContext;

use crate::ai::evidence_dependency::{ai_evidence_dependency, ai_evidence_source_change};
use crate::ai::evidence_lineage::{ai_artifact_component, ai_evidence_claim, ai_evidence_decision};
use crate::ai::evidence_source::{ai_evidence_passage, ai_evidence_source_version, find_source};
use crate::ai::intelligence::search_embedding;
use crate::ai::knowledge_entry::ai_knowledge_entry_version;
use crate::ai::knowledge_promotion::ai_knowledge_skill_promotion;
use crate::ai::skill_registry::ai_skill_release;
use crate::core::audit::audit_log;
use crate::core::persistence::{RowChange, RowChangeKind};
use crate::core::queue::queue_job;

use super::documents::Document;

const MAX_SNAPSHOT_ROWS: usize = 50_000;
const MAX_SNAPSHOT_BYTES: usize = 32 * 1024 * 1024;
const SNAPSHOT_LIMIT_ERROR: &str =
    "folder evidence snapshot exceeds its 50,000-row or 32 MiB limit";

// Parent rows precede their references; tombstones use the reverse order.
type RowKey = (u8, &'static str, u64);
type SnapshotRows = BTreeMap<RowKey, RowChange>;

#[derive(Default)]
struct BoundedSnapshot {
    rows: SnapshotRows,
    serialized_bytes: usize,
}

fn next_snapshot_size(rows: usize, bytes: usize, incoming: usize) -> Result<usize, String> {
    if rows >= MAX_SNAPSHOT_ROWS {
        return Err(SNAPSHOT_LIMIT_ERROR.to_string());
    }
    bytes
        .checked_add(incoming)
        .filter(|total| *total <= MAX_SNAPSHOT_BYTES)
        .ok_or_else(|| SNAPSHOT_LIMIT_ERROR.to_string())
}

impl BoundedSnapshot {
    fn add<T: spacetimedb_sats::Serialize + ?Sized>(
        &mut self,
        rank: u8,
        table: &'static str,
        id: u64,
        row: &T,
    ) -> Result<(), String> {
        if id == 0 || self.rows.contains_key(&(rank, table, id)) {
            return Err("folder evidence snapshot has an invalid or duplicate row identity".into());
        }
        // Refuse the next row before spending time serializing it at the row cap.
        next_snapshot_size(self.rows.len(), self.serialized_bytes, 0)?;
        let change = RowChange::upsert_stdb_row(table, json!({ "id": id }), row)?;
        let RowChangeKind::Upsert(value) = &change.kind else {
            return Err("folder evidence snapshot requires a complete row".into());
        };
        let size = serde_json::to_vec(&(table, &change.row_identity, value))
            .map_err(|error| format!("measure folder evidence snapshot: {error}"))?
            .len();
        self.serialized_bytes = next_snapshot_size(self.rows.len(), self.serialized_bytes, size)?;
        self.rows.insert((rank, table, id), change);
        Ok(())
    }
}

fn changed_rows(before: SnapshotRows, after: SnapshotRows) -> Vec<RowChange> {
    let mut changes = Vec::new();
    for (key, old) in before.iter().rev() {
        if !after.contains_key(key) {
            changes.push(RowChange::delete(&old.table_name, old.row_identity.clone()));
        }
    }
    for (key, new) in after {
        let unchanged = before.get(&key).is_some_and(|old| {
            matches!((&old.kind, &new.kind),
                (RowChangeKind::Upsert(old), RowChangeKind::Upsert(new)) if old == new)
        });
        if !unchanged {
            changes.push(new);
        }
    }
    changes
}

pub(super) struct DocumentEvidenceSnapshot {
    organization_id: u64,
    company_ids: BTreeSet<u64>,
    before: SnapshotRows,
    audit_watermark: u64,
    queue_watermark: u64,
}

impl DocumentEvidenceSnapshot {
    pub(super) fn capture(
        ctx: &ReducerContext,
        organization_id: u64,
        documents: &[Document],
    ) -> Result<Self, String> {
        if organization_id == 0 {
            return Err("folder evidence snapshot requires an organization".into());
        }
        let mut company_ids = BTreeSet::new();
        for document in documents {
            if document.organization_id != organization_id {
                return Err("folder evidence snapshot document organization mismatch".into());
            }
            let Some(company_id) = document.company_id.filter(|_| !document.is_deleted) else {
                continue;
            };
            let source_key = format!("document:{}", document.id);
            if find_source(ctx, organization_id, company_id, "document", &source_key).is_some() {
                company_ids.insert(company_id);
            }
        }
        let mut snapshot = Self {
            organization_id,
            company_ids,
            before: BTreeMap::new(),
            audit_watermark: 0,
            queue_watermark: 0,
        };
        if snapshot.company_ids.is_empty() {
            return Ok(snapshot);
        }
        snapshot.audit_watermark = ctx
            .db
            .audit_log()
            .audit_by_org()
            .filter(&organization_id)
            .filter(|row| snapshot.includes_company(row.company_id))
            .map(|row| row.id)
            .max()
            .unwrap_or(0);
        snapshot.queue_watermark = ctx
            .db
            .queue_job()
            .queue_job_by_org()
            .filter(&organization_id)
            .filter(|row| snapshot.includes_company(row.company_id))
            .map(|row| row.id)
            .max()
            .unwrap_or(0);
        snapshot.before = snapshot.read_rows(ctx, false)?;
        Ok(snapshot)
    }

    pub(super) fn changes(self, ctx: &ReducerContext) -> Result<Vec<RowChange>, String> {
        if self.company_ids.is_empty() {
            return Ok(Vec::new());
        }
        // An excessive expansion also fails closed: reducer errors roll back
        // the complete mutation, including retirement and queued work.
        let after = self.read_rows(ctx, true)?;
        Ok(changed_rows(self.before, after))
    }

    fn includes_company(&self, company_id: Option<u64>) -> bool {
        company_id.is_some_and(|id| self.company_ids.contains(&id))
    }

    fn read_rows(
        &self,
        ctx: &ReducerContext,
        include_appended: bool,
    ) -> Result<SnapshotRows, String> {
        let mut snapshot = BoundedSnapshot::default();
        let organization_id = self.organization_id;
        let required_company = |id| self.company_ids.contains(&id);
        let optional_company = |id| self.includes_company(id);
        macro_rules! capture_company_rows {
            ($rank:literal, $table:ident, $index:ident, $in_scope:ident) => {
                for row in ctx.db.$table().$index().filter(&organization_id) {
                    if row.organization_id == organization_id && $in_scope(row.company_id) {
                        snapshot.add($rank, stringify!($table), row.id, &row)?;
                    }
                }
            };
        }
        capture_company_rows!(
            0,
            ai_evidence_source_version,
            ai_evidence_source_version_by_org,
            required_company
        );
        capture_company_rows!(
            1,
            ai_evidence_passage,
            ai_evidence_passage_by_org,
            required_company
        );
        capture_company_rows!(
            2,
            ai_evidence_source_change,
            ai_evidence_source_change_by_org,
            required_company
        );
        capture_company_rows!(
            3,
            ai_evidence_claim,
            ai_evidence_claim_by_org,
            required_company
        );
        capture_company_rows!(
            4,
            ai_evidence_decision,
            ai_evidence_decision_by_org,
            required_company
        );
        capture_company_rows!(
            5,
            ai_artifact_component,
            ai_artifact_component_by_org,
            required_company
        );
        capture_company_rows!(
            6,
            ai_knowledge_entry_version,
            ai_knowledge_entry_version_by_org,
            required_company
        );
        capture_company_rows!(
            7,
            ai_knowledge_skill_promotion,
            ai_knowledge_skill_promotion_by_org,
            required_company
        );
        // Skill releases have no company column. Promotion invalidation can
        // deactivate a release through its linked skill version.
        for row in ctx
            .db
            .ai_skill_release()
            .ai_skill_release_registry_by_org()
            .filter(&organization_id)
        {
            snapshot.add(8, "ai_skill_release", row.id, &row)?;
        }
        capture_company_rows!(
            9,
            ai_evidence_dependency,
            ai_evidence_dependency_by_org,
            required_company
        );
        capture_company_rows!(10, search_embedding, embedding_by_org, optional_company);
        if include_appended {
            for row in ctx
                .db
                .queue_job()
                .queue_job_by_org()
                .filter(&organization_id)
            {
                if row.id > self.queue_watermark && self.includes_company(row.company_id) {
                    snapshot.add(11, "queue_job", row.id, &row)?;
                }
            }
            for row in ctx.db.audit_log().audit_by_org().filter(&organization_id) {
                if row.id > self.audit_watermark && self.includes_company(row.company_id) {
                    snapshot.add(12, "audit_log", row.id, &row)?;
                }
            }
        }
        Ok(snapshot.rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(rank: u8, table: &'static str, id: u64, state: &str) -> (RowKey, RowChange) {
        (
            (rank, table, id),
            RowChange {
                table_name: table.into(),
                row_identity: json!({ "id": id }),
                kind: RowChangeKind::Upsert(json!({ "id": id, "state": state })),
            },
        )
    }

    #[test]
    fn retirement_changes_keep_full_rows_in_reference_order_and_exclude_unchanged_rows() {
        let before = BTreeMap::from([
            row(0, "ai_evidence_source_version", 1, "current"),
            row(1, "ai_evidence_passage", 2, "present"),
            row(8, "ai_skill_release", 3, "active"),
            row(10, "search_embedding", 4, "synced"),
            row(10, "search_embedding", 5, "unchanged"),
        ]);
        let after = BTreeMap::from([
            row(0, "ai_evidence_source_version", 1, "access_revoked"),
            row(1, "ai_evidence_passage", 2, "restricted"),
            row(8, "ai_skill_release", 3, "inactive"),
            row(10, "search_embedding", 4, "deleted"),
            row(10, "search_embedding", 5, "unchanged"),
            row(11, "queue_job", 6, "pending"),
            row(12, "audit_log", 7, "created"),
        ]);
        let changes = changed_rows(before, after);
        assert_eq!(
            changes
                .iter()
                .map(|row| row.table_name.as_str())
                .collect::<Vec<_>>(),
            [
                "ai_evidence_source_version",
                "ai_evidence_passage",
                "ai_skill_release",
                "search_embedding",
                "queue_job",
                "audit_log"
            ]
        );
        assert!(matches!(&changes[0].kind, RowChangeKind::Upsert(value)
            if *value == json!({ "id": 1, "state": "access_revoked" })));
        assert!(changes
            .iter()
            .all(|row| matches!(row.kind, RowChangeKind::Upsert(_))));
    }

    #[test]
    fn idempotent_snapshots_are_empty_and_tombstones_reverse_reference_order() {
        let make_rows = || {
            BTreeMap::from([
                row(0, "ai_evidence_source_version", 1, "access_revoked"),
                row(1, "ai_evidence_passage", 2, "restricted"),
            ])
        };
        assert!(changed_rows(make_rows(), make_rows()).is_empty());
        let deleted = changed_rows(make_rows(), BTreeMap::new());
        assert_eq!(deleted[0].table_name, "ai_evidence_passage");
        assert_eq!(deleted[1].table_name, "ai_evidence_source_version");
        assert!(deleted
            .iter()
            .all(|row| matches!(row.kind, RowChangeKind::Delete)));
    }

    #[test]
    fn snapshot_limits_reject_row_overflow_byte_overflow_and_arithmetic_overflow() {
        assert_eq!(
            next_snapshot_size(MAX_SNAPSHOT_ROWS - 1, 0, MAX_SNAPSHOT_BYTES),
            Ok(MAX_SNAPSHOT_BYTES)
        );
        assert!(next_snapshot_size(MAX_SNAPSHOT_ROWS, 0, 0).is_err());
        assert!(next_snapshot_size(0, MAX_SNAPSHOT_BYTES, 1).is_err());
        assert!(next_snapshot_size(0, 1, usize::MAX).is_err());
    }
}
