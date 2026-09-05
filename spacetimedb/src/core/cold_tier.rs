//! Shared, fail-closed checks for STDB cold-tier finalization.
//!
//! A cold-tier worker is allowed to remove a row from STDB only after the
//! durable projection has the exact row version and every domain owner has
//! confirmed that the row is safe to cool.  The worker and the STDB module
//! are separate processes, so the STDB side must validate the proof again at
//! the point of deletion.  This module deliberately contains no accounting,
//! inventory, or workflow rules: those rules live in the owning domain and
//! are represented here as facts computed immediately before finalization.
//!
//! Append-only audit retains its checksum protocol; mutable aggregate
//! finalizers use [`validate_cooling_eligibility`] and
//! [`delete_aggregate`] without duplicating the safety checks.

use std::collections::BTreeSet;

use spacetimedb::ReducerContext;

use crate::core::persistence::{
    organization_commit, organization_row_change, CHANGE_SCHEMA_VERSION, CONTRACT_VERSION,
};

/// Version of the STDB-side finalization proof vocabulary.
pub const FINALIZATION_PROOF_VERSION: u32 = 1;

/// Durable version evidence supplied by a trusted projection worker.
///
/// `row_commit_sequence` identifies the exact STDB commit containing the row
/// image.  `durable_watermark` is the contiguous PG projection watermark.  A
/// finalizer must require `row_commit_sequence <= durable_watermark`; checking
/// only that a worker supplied a non-zero watermark is not sufficient.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DurableVersionProof {
    pub row_commit_sequence: u64,
    pub durable_watermark: u64,
    pub archive_version: u64,
    pub expected_archive_version: u64,
    pub durable_change_schema_version: u32,
    pub expected_change_schema_version: u32,
    pub durable_contract_version: String,
    pub expected_contract_version: String,
}

impl DurableVersionProof {
    /// Validate the durable projection and exact version identity.
    pub fn validate(&self) -> Result<(), String> {
        if self.row_commit_sequence == 0 {
            return Err("cold-tier proof requires a non-zero row commit sequence".to_string());
        }
        if self.durable_watermark < self.row_commit_sequence {
            return Err(format!(
                "durable watermark {} does not cover row commit {}",
                self.durable_watermark, self.row_commit_sequence
            ));
        }
        if self.archive_version == 0 || self.expected_archive_version == 0 {
            return Err("cold-tier proof requires non-zero archive versions".to_string());
        }
        if self.archive_version != self.expected_archive_version {
            return Err(format!(
                "archive version mismatch (durable {}, expected {})",
                self.archive_version, self.expected_archive_version
            ));
        }
        if self.durable_change_schema_version != self.expected_change_schema_version {
            return Err(format!(
                "durable change schema version mismatch (durable {}, expected {})",
                self.durable_change_schema_version, self.expected_change_schema_version
            ));
        }
        if self.expected_change_schema_version == 0 {
            return Err("cold-tier proof requires a non-zero change schema version".to_string());
        }
        if self.durable_contract_version != self.expected_contract_version {
            return Err(format!(
                "durable contract version mismatch (durable {}, expected {})",
                self.durable_contract_version, self.expected_contract_version
            ));
        }
        if self.expected_contract_version.trim().is_empty() {
            return Err("cold-tier proof requires a non-empty contract version".to_string());
        }
        Ok(())
    }
}

/// Domain facts required in addition to durable projection evidence.
///
/// These booleans are intentionally not inferred from strings supplied by a
/// client.  The owning STDB domain must query its authoritative rows and
/// compute them immediately before calling the generic validator.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CoolingEligibilityFacts {
    pub resource_policy_allows_cooling: bool,
    pub cold_eligible_at_micros: Option<i64>,
    pub now_micros: i64,
    pub minimum_age_micros: u64,
    pub terminal_state: bool,
    pub open_obligation: bool,
    pub active_workflow: bool,
    pub hot_dependency: bool,
    pub projection_rebuildable: bool,
}

/// Validate every storage-policy gate before a row may leave STDB.
pub fn validate_cooling_eligibility(
    facts: &CoolingEligibilityFacts,
    durable: &DurableVersionProof,
) -> Result<(), String> {
    // Validate the durable side first.  A row must never be removed merely
    // because its business state looks terminal.
    durable.validate()?;

    if !facts.resource_policy_allows_cooling {
        return Err("resource storage policy does not allow cooling".to_string());
    }
    let eligible_at = facts
        .cold_eligible_at_micros
        .ok_or("row has no cold-eligibility timestamp")?;
    if facts.now_micros < eligible_at {
        return Err("cold-eligibility timestamp is in the future".to_string());
    }
    let age = u64::try_from(facts.now_micros - eligible_at)
        .map_err(|_| "cold-eligibility age is not representable".to_string())?;
    if age < facts.minimum_age_micros {
        return Err(format!(
            "row age {age} is below the required cooling age {}",
            facts.minimum_age_micros
        ));
    }
    if !facts.terminal_state {
        return Err("row is not in a terminal state".to_string());
    }
    if facts.open_obligation {
        return Err("row has an open obligation".to_string());
    }
    if facts.active_workflow {
        return Err("row has an active workflow reference".to_string());
    }
    if facts.hot_dependency {
        return Err("a hot dependency requires the row to remain resident".to_string());
    }
    if !facts.projection_rebuildable {
        return Err("durable projection/rebuild contract is not valid".to_string());
    }
    Ok(())
}

/// Prove that the latest STDB change for a row is covered by the supplied
/// durable watermark and carries the expected schema/contract versions.
///
/// This closes an important gap in callers that only compare an
/// `archive_version`: an old archive payload must not delete a row with a
/// newer, not-yet-projected commit.  `row_identity_json` must be the canonical
/// JSON identity recorded by [`crate::core::persistence::RowChange`].
pub fn prove_durable_row(
    ctx: &ReducerContext,
    organization_id: u64,
    table_name: &str,
    row_identity_json: &str,
    durable_watermark: u64,
) -> Result<DurableCommitProof, String> {
    if organization_id == 0 {
        return Err("durable row proof requires a non-zero organization_id".to_string());
    }
    validate_table_name(table_name)
        .map_err(|_| "durable row proof requires a valid table name".to_string())?;
    if row_identity_json.trim().is_empty() {
        return Err("durable row proof requires a row identity".to_string());
    }
    let row_identity: serde_json::Value = serde_json::from_str(row_identity_json)
        .map_err(|_| "durable row proof requires valid JSON row identity".to_string())?;
    if !row_identity.is_object()
        || row_identity
            .as_object()
            .is_some_and(|object| object.is_empty())
    {
        return Err("durable row proof requires a non-empty object row identity".to_string());
    }
    if durable_watermark == 0 {
        return Err("durable row proof requires a non-zero watermark".to_string());
    }

    let mut matching_changes: Vec<_> = ctx
        .db
        .organization_row_change()
        .organization_row_change_by_commit()
        .filter((organization_id, 0..=u64::MAX))
        .filter(|change| {
            change.organization_id == organization_id
                && change.table_name == table_name
                && change.row_identity_json == row_identity_json
        })
        .collect();
    matching_changes.sort_by_key(|change| change.commit_sequence);
    let latest = matching_changes
        .last()
        .ok_or("no STDB commit contains the requested row identity")?;
    if latest.change_kind != "upsert" {
        return Err("latest row change is not a durable row image".to_string());
    }
    if latest.commit_sequence > durable_watermark {
        return Err(format!(
            "durable watermark {} does not cover latest row commit {}",
            durable_watermark, latest.commit_sequence
        ));
    }

    let commit = ctx
        .db
        .organization_commit()
        .id()
        .find(&format!("{organization_id}:{}", latest.commit_sequence))
        .ok_or("row change is missing its organization commit envelope")?;
    if commit.organization_id != organization_id
        || commit.sequence != latest.commit_sequence
        || commit.change_schema_version != CHANGE_SCHEMA_VERSION
        || commit.contract_version != CONTRACT_VERSION
    {
        return Err("row commit envelope has an incompatible durable version".to_string());
    }

    Ok(DurableCommitProof {
        row_commit_sequence: latest.commit_sequence,
        durable_watermark,
        change_schema_version: commit.change_schema_version,
        contract_version: commit.contract_version,
    })
}

/// Evidence returned by [`prove_durable_row`] before the row's archive version
/// is paired with it by the domain finalizer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DurableCommitProof {
    pub row_commit_sequence: u64,
    pub durable_watermark: u64,
    pub change_schema_version: u32,
    pub contract_version: String,
}

impl DurableCommitProof {
    /// Pair commit evidence with the exact archive version read by a worker.
    /// The resulting proof can be passed directly to
    /// [`validate_cooling_eligibility`].
    pub fn with_archive_version(
        self,
        archive_version: u64,
        expected_archive_version: u64,
    ) -> DurableVersionProof {
        DurableVersionProof {
            row_commit_sequence: self.row_commit_sequence,
            durable_watermark: self.durable_watermark,
            archive_version,
            expected_archive_version,
            durable_change_schema_version: self.change_schema_version,
            expected_change_schema_version: CHANGE_SCHEMA_VERSION,
            durable_contract_version: self.contract_version,
            expected_contract_version: CONTRACT_VERSION.to_string(),
        }
    }
}

/// Aggregate root reference supplied by a domain-specific finalizer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AggregateRootRef {
    pub table_name: String,
    pub row_id: u64,
    pub organization_id: u64,
}

/// Aggregate child reference supplied after querying authoritative child rows.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AggregateChildRef {
    pub table_name: String,
    pub row_id: u64,
    pub parent_id: u64,
    pub organization_id: u64,
}

/// Complete deletion plan.  Domain code must populate every authoritative
/// child; this helper then validates scope/parent identity and enforces
/// child-before-root deletion order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AggregateFinalizationPlan {
    pub root: AggregateRootRef,
    pub children: Vec<AggregateChildRef>,
}

/// A single deletion operation in dependency-safe order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AggregateDeletionTarget {
    pub table_name: String,
    pub row_id: u64,
}

/// Validate an aggregate plan without mutating any table.
pub fn validate_aggregate_plan(plan: &AggregateFinalizationPlan) -> Result<(), String> {
    validate_table_name(&plan.root.table_name)?;
    if plan.root.row_id == 0 || plan.root.organization_id == 0 {
        return Err("aggregate root requires non-zero id and organization_id".to_string());
    }

    let mut seen = BTreeSet::new();
    for child in &plan.children {
        validate_table_name(&child.table_name)?;
        if child.row_id == 0 || child.parent_id == 0 || child.organization_id == 0 {
            return Err("aggregate child requires non-zero ids and organization_id".to_string());
        }
        if child.organization_id != plan.root.organization_id {
            return Err("aggregate child belongs to a different organization".to_string());
        }
        if child.parent_id != plan.root.row_id {
            return Err("aggregate child points to a different root".to_string());
        }
        if child.table_name == plan.root.table_name && child.row_id == plan.root.row_id {
            return Err("aggregate child must not alias the root".to_string());
        }
        if !seen.insert((child.table_name.clone(), child.row_id)) {
            return Err("aggregate finalization contains a duplicate child".to_string());
        }
    }
    Ok(())
}

/// Delete all children followed by their root after validating the complete
/// plan.  SpacetimeDB reducer transactions roll the whole operation back if a
/// domain callback fails, so a child cannot be left deleted while its root is
/// retained.  The callback is intentionally domain-owned because only the
/// owning module knows each generated table accessor and child predicate.
pub fn delete_aggregate<F>(plan: &AggregateFinalizationPlan, mut delete: F) -> Result<(), String>
where
    F: FnMut(&AggregateDeletionTarget) -> Result<(), String>,
{
    validate_aggregate_plan(plan)?;

    let mut children: Vec<_> = plan
        .children
        .iter()
        .map(|child| AggregateDeletionTarget {
            table_name: child.table_name.clone(),
            row_id: child.row_id,
        })
        .collect();
    // Stable deterministic ordering makes retries and tests observable while
    // preserving the only ordering constraint that matters: children first.
    children.sort_by(|left, right| {
        left.table_name
            .cmp(&right.table_name)
            .then_with(|| left.row_id.cmp(&right.row_id))
    });
    for child in &children {
        delete(child)?;
    }
    delete(&AggregateDeletionTarget {
        table_name: plan.root.table_name.clone(),
        row_id: plan.root.row_id,
    })
}

/// Run the complete fail-closed finalization gate and then delete an aggregate
/// in dependency-safe order.  This is the intended entry point for a new
/// domain finalizer: the domain computes its authoritative facts and child
/// list, while this function makes it impossible to accidentally delete
/// before durability/retention validation has succeeded.
pub fn finalize_cooling<F>(
    facts: &CoolingEligibilityFacts,
    durable: &DurableVersionProof,
    plan: &AggregateFinalizationPlan,
    delete: F,
) -> Result<(), String>
where
    F: FnMut(&AggregateDeletionTarget) -> Result<(), String>,
{
    validate_cooling_eligibility(facts, durable)?;
    delete_aggregate(plan, delete)
}

fn validate_table_name(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err("aggregate table names must be lowercase snake_case".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn durable() -> DurableVersionProof {
        DurableVersionProof {
            row_commit_sequence: 12,
            durable_watermark: 12,
            archive_version: 3,
            expected_archive_version: 3,
            durable_change_schema_version: CHANGE_SCHEMA_VERSION,
            expected_change_schema_version: CHANGE_SCHEMA_VERSION,
            durable_contract_version: CONTRACT_VERSION.to_string(),
            expected_contract_version: CONTRACT_VERSION.to_string(),
        }
    }

    fn facts() -> CoolingEligibilityFacts {
        CoolingEligibilityFacts {
            resource_policy_allows_cooling: true,
            cold_eligible_at_micros: Some(100),
            now_micros: 200,
            minimum_age_micros: 100,
            terminal_state: true,
            open_obligation: false,
            active_workflow: false,
            hot_dependency: false,
            projection_rebuildable: true,
        }
    }

    #[test]
    fn eligibility_requires_every_durable_and_domain_gate() {
        assert!(validate_cooling_eligibility(&facts(), &durable()).is_ok());
        for mutate in [
            |f: &mut CoolingEligibilityFacts| f.resource_policy_allows_cooling = false,
            |f: &mut CoolingEligibilityFacts| f.cold_eligible_at_micros = None,
            |f: &mut CoolingEligibilityFacts| f.now_micros = 199,
            |f: &mut CoolingEligibilityFacts| f.terminal_state = false,
            |f: &mut CoolingEligibilityFacts| f.open_obligation = true,
            |f: &mut CoolingEligibilityFacts| f.active_workflow = true,
            |f: &mut CoolingEligibilityFacts| f.hot_dependency = true,
            |f: &mut CoolingEligibilityFacts| f.projection_rebuildable = false,
        ] {
            let mut changed = facts();
            mutate(&mut changed);
            assert!(validate_cooling_eligibility(&changed, &durable()).is_err());
        }
        let mut stale = durable();
        stale.durable_watermark = 11;
        assert!(validate_cooling_eligibility(&facts(), &stale).is_err());
        stale = durable();
        stale.archive_version = 2;
        assert!(validate_cooling_eligibility(&facts(), &stale).is_err());
        stale = durable();
        stale.durable_change_schema_version += 1;
        assert!(validate_cooling_eligibility(&facts(), &stale).is_err());
        stale = durable();
        stale.durable_contract_version = "ir-v1".to_string();
        assert!(validate_cooling_eligibility(&facts(), &stale).is_err());
    }

    #[test]
    fn aggregate_deletion_is_validated_and_child_first() {
        let plan = AggregateFinalizationPlan {
            root: AggregateRootRef {
                table_name: "sale_order".to_string(),
                row_id: 7,
                organization_id: 2,
            },
            children: vec![
                AggregateChildRef {
                    table_name: "sale_order_line".to_string(),
                    row_id: 9,
                    parent_id: 7,
                    organization_id: 2,
                },
                AggregateChildRef {
                    table_name: "sale_order_line".to_string(),
                    row_id: 8,
                    parent_id: 7,
                    organization_id: 2,
                },
            ],
        };
        let mut deleted = Vec::new();
        delete_aggregate(&plan, |target| {
            deleted.push((target.table_name.clone(), target.row_id));
            Ok(())
        })
        .unwrap();
        assert_eq!(
            deleted,
            vec![
                ("sale_order_line".to_string(), 8),
                ("sale_order_line".to_string(), 9),
                ("sale_order".to_string(), 7),
            ]
        );
    }

    #[test]
    fn aggregate_plan_rejects_cross_scope_and_duplicate_children() {
        let root = AggregateRootRef {
            table_name: "sale_order".to_string(),
            row_id: 7,
            organization_id: 2,
        };
        let child = AggregateChildRef {
            table_name: "sale_order_line".to_string(),
            row_id: 9,
            parent_id: 7,
            organization_id: 2,
        };
        assert!(validate_aggregate_plan(&AggregateFinalizationPlan {
            root: root.clone(),
            children: vec![child.clone(), child.clone()],
        })
        .is_err());
        assert!(validate_aggregate_plan(&AggregateFinalizationPlan {
            root,
            children: vec![AggregateChildRef {
                organization_id: 3,
                ..child
            }],
        })
        .is_err());
    }

    #[test]
    fn finalization_gate_never_calls_deleter_on_ineligible_rows() {
        let plan = AggregateFinalizationPlan {
            root: AggregateRootRef {
                table_name: "sale_order".to_string(),
                row_id: 7,
                organization_id: 2,
            },
            children: vec![],
        };
        let mut calls = 0;
        let mut ineligible = facts();
        ineligible.open_obligation = true;
        assert!(finalize_cooling(&ineligible, &durable(), &plan, |_| {
            calls += 1;
            Ok(())
        })
        .is_err());
        assert_eq!(calls, 0);
    }
}
