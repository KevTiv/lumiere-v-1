//! AIH-18: reverse dependencies, source changes and retention.
//!
//! Every reference the evidence records make (passage -> claim -> decision ->
//! component / knowledge entry) is also written here as a directed edge, so
//! that when a source changes we can walk *forward* from it and find
//! everything that rests on it.
//!
//! # Versioned dependency policy (`EVIDENCE_POLICY_VERSION`)
//!
//! A source change maps to a severity, and an edge's requirement decides how
//! much of that severity it takes:
//!
//! | change                                   | required edge | discretionary edge |
//! |------------------------------------------|---------------|--------------------|
//! | `corrected`, `superseded`                | `needs_review`| `needs_review`     |
//! | `retracted`, `access_revoked`, `deleted` | `invalid`     | `needs_review`     |
//!
//! Severity only rises. A dependent reached through an edge propagates that
//! edge's resulting state onward, so a decision built on a retracted claim is
//! itself invalid, while a discretionary inspiration is only ever flagged.
//!
//! Reuse and execution follow from edge state: a required edge that is not
//! `valid` denies new reuse; a discretionary edge that is not `valid` asks
//! for an acknowledged review first. Nothing is silently repaired.
//!
//! # Retention
//!
//! Historical versions and their passages are kept. A source change never
//! replaces the original evidence with a later document. Deleting a source
//! tombstones passage text (the content hash remains) and drops the snapshot
//! reference; revoking access keeps content for authorized history but marks
//! it `restricted` so it is never served. A retained hash is not full replay
//! — see `snapshot_state` on the source version.
//!
//! The `ai_evidence_source_change` id is a watermark: a derived cache or
//! index records the highest change id it has seen for a scope and treats
//! anything older as stale.

use std::collections::BTreeMap;

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::ai::evidence_common::{
    dependency_rank, require_len, require_one_of, EVIDENCE_POLICY_VERSION,
};
use crate::ai::evidence_lineage::{
    ai_artifact_component, ai_evidence_claim, ai_evidence_decision, AiArtifactComponent,
    AiEvidenceClaim, AiEvidenceDecision, CLAIM_CURRENT, CLAIM_NEEDS_REVIEW, COMPONENT_CURRENT,
    DECISION_ACCEPTED, DECISION_NEEDS_REVIEW, DECISION_PROPOSED, LINK_CHANGED, LINK_UNRESOLVED,
};
use crate::ai::evidence_source::{
    ai_evidence_passage, ai_evidence_source_version, load_source, load_source_version,
    version_status_rank, AiEvidencePassage, AiEvidenceSourceVersion, TEXT_PRESENT, TEXT_RESTRICTED,
    TEXT_TOMBSTONED, VERSION_STATUSES,
};
use crate::ai::knowledge_entry::mark_version_needs_review;
use crate::core::organization::require_company_in_organization;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

/// Upper bound on edges touched by one source change. Exceeding it aborts the
/// change rather than leaving dependents half-flagged.
const MAX_ESCALATION_EDGES: u32 = 20_000;
const MAX_REASON_LEN: usize = 2_000;

pub const CHANGE_KINDS: [&str; 5] = [
    "corrected",
    "superseded",
    "retracted",
    "access_revoked",
    "deleted",
];

// ── Kinds ────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UpstreamKind {
    Passage,
    Claim,
    Decision,
}

impl UpstreamKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Passage => "passage",
            Self::Claim => "claim",
            Self::Decision => "decision",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DependentKind {
    Claim,
    Decision,
    Component,
    KnowledgeVersion,
}

impl DependentKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Claim => "claim",
            Self::Decision => "decision",
            Self::Component => "component",
            Self::KnowledgeVersion => "knowledge_version",
        }
    }

    /// The kind this dependent is itself an upstream as, if any. Components
    /// and knowledge versions are leaves in the dependency graph.
    fn as_upstream(self) -> Option<UpstreamKind> {
        match self {
            Self::Claim => Some(UpstreamKind::Claim),
            Self::Decision => Some(UpstreamKind::Decision),
            Self::Component | Self::KnowledgeVersion => None,
        }
    }

    fn from_label(label: &str) -> Option<Self> {
        match label {
            "claim" => Some(Self::Claim),
            "decision" => Some(Self::Decision),
            "component" => Some(Self::Component),
            "knowledge_version" => Some(Self::KnowledgeVersion),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Requirement {
    Required,
    Discretionary,
}

impl Requirement {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Required => "required",
            Self::Discretionary => "discretionary",
        }
    }

    fn from_label(label: &str) -> Self {
        // Unknown reads as required: an unrecognised edge must not weaken a gate.
        if label == "discretionary" {
            Self::Discretionary
        } else {
            Self::Required
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Severity {
    NeedsReview,
    Invalid,
}

impl Severity {
    pub fn as_state(self) -> &'static str {
        match self {
            Self::NeedsReview => "needs_review",
            Self::Invalid => "invalid",
        }
    }

    fn from_state(state: &str) -> Self {
        if state == "invalid" {
            Self::Invalid
        } else {
            Self::NeedsReview
        }
    }
}

// ── Tables ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_evidence_dependency,
    index(accessor = ai_evidence_dependency_by_org, btree(columns = [organization_id])),
    index(
        accessor = ai_evidence_dependency_by_upstream,
        btree(columns = [organization_id, upstream_kind, upstream_id])
    ),
    index(
        accessor = ai_evidence_dependency_by_dependent,
        btree(columns = [organization_id, dependent_kind, dependent_id])
    )
)]
pub struct AiEvidenceDependency {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    /// passage | claim | decision
    pub upstream_kind: String,
    pub upstream_id: u64,
    /// claim | decision | component | knowledge_version
    pub dependent_kind: String,
    pub dependent_id: u64,
    /// required | discretionary
    pub requirement: String,
    /// valid | needs_review | invalid
    pub state: String,
    pub policy_version: u32,
    /// Set when a reviewer acknowledged a discretionary edge that is not valid.
    pub acknowledged_by: Option<Identity>,
    pub acknowledged_at: Option<Timestamp>,
    /// The source change that last moved this edge.
    pub last_change_id: Option<u64>,
    pub create_date: Timestamp,
    pub write_date: Timestamp,
}

/// Append-only record of a correction, supersession, retraction, access
/// revocation or deletion of a source version.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_evidence_source_change,
    index(accessor = ai_evidence_source_change_by_org, btree(columns = [organization_id])),
    index(accessor = ai_evidence_source_change_by_version, btree(columns = [source_version_id]))
)]
pub struct AiEvidenceSourceChange {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub source_version_id: u64,
    /// corrected | superseded | retracted | access_revoked | deleted
    pub change_kind: String,
    pub replacement_version_id: Option<u64>,
    pub reason: String,
    pub policy_version: u32,
    pub affected_passage_count: u32,
    pub affected_dependency_count: u32,
    pub create_uid: Identity,
    pub create_date: Timestamp,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordAiEvidenceSourceChangeParams {
    pub change_kind: String,
    pub replacement_version_id: Option<u64>,
    pub reason: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ResolveAiEvidenceDependencyParams {
    /// acknowledged | reaffirmed
    pub resolution: String,
    pub note: String,
}

// ── Pure policy ──────────────────────────────────────────────────────────────

/// The version status a change moves a source version to.
pub fn target_version_status(change_kind: &str) -> Option<&'static str> {
    match change_kind {
        "corrected" | "superseded" => Some("superseded"),
        "retracted" => Some("retracted"),
        "access_revoked" => Some("access_revoked"),
        "deleted" => Some("deleted"),
        _ => None,
    }
}

/// How severe a change is for a dependent that *requires* the source.
pub fn severity_for_change(change_kind: &str) -> Option<Severity> {
    match change_kind {
        "corrected" | "superseded" => Some(Severity::NeedsReview),
        "retracted" | "access_revoked" | "deleted" => Some(Severity::Invalid),
        _ => None,
    }
}

/// The state an edge takes when `severity` reaches it. Discretionary edges
/// never exceed `needs_review`, and an edge never improves.
pub fn edge_state_after(requirement: Requirement, severity: Severity, current: &str) -> String {
    let target = match requirement {
        Requirement::Required => severity,
        Requirement::Discretionary => Severity::NeedsReview,
    };
    let target_state = target.as_state();
    if dependency_rank(current) >= dependency_rank(target_state) {
        current.to_string()
    } else {
        target_state.to_string()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EdgeView {
    pub requirement: Requirement,
    pub state: String,
    pub acknowledged: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReuseDecision {
    Allow,
    RequiresAcknowledgement,
    Deny,
}

/// Whether new reuse or execution may proceed given a dependent's edges.
pub fn dependency_reuse_decision(edges: &[EdgeView]) -> ReuseDecision {
    if edges
        .iter()
        .any(|edge| edge.requirement == Requirement::Required && edge.state != "valid")
    {
        return ReuseDecision::Deny;
    }
    if edges.iter().any(|edge| {
        edge.requirement == Requirement::Discretionary
            && edge.state != "valid"
            && !edge.acknowledged
    }) {
        return ReuseDecision::RequiresAcknowledgement;
    }
    ReuseDecision::Allow
}

/// Passage-level effect of a version change: `(status, text_state)` the
/// passage should now have, never regressing what it already is.
pub fn passage_effect(
    change_kind: &str,
    current_status: &str,
    current_text_state: &str,
) -> (String, String) {
    let status = match change_kind {
        "corrected" | "superseded" => {
            if current_status == "current" {
                "superseded"
            } else {
                current_status
            }
        }
        _ => "withdrawn",
    };
    let text_rank = |state: &str| match state {
        TEXT_PRESENT => 0,
        TEXT_RESTRICTED => 1,
        _ => 2,
    };
    let wanted_text = match change_kind {
        "access_revoked" => TEXT_RESTRICTED,
        "deleted" => TEXT_TOMBSTONED,
        _ => current_text_state,
    };
    let text_state = if text_rank(wanted_text) >= text_rank(current_text_state) {
        wanted_text
    } else {
        current_text_state
    };
    (status.to_string(), text_state.to_string())
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Record a change to a source version and flag everything that depends on
/// it. The version and its passages keep their history: status moves
/// forward, passage text is restricted or tombstoned only where the change
/// requires it, and no later document is substituted for the original.
#[reducer]
pub fn record_ai_evidence_source_change(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    source_version_id: u64,
    params: RecordAiEvidenceSourceChangeParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_evidence_source", "update")?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    record_ai_evidence_source_change_inner(
        ctx,
        organization_id,
        company_id,
        source_version_id,
        params,
    )
}

pub(crate) fn record_ai_evidence_source_change_inner(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    source_version_id: u64,
    params: RecordAiEvidenceSourceChangeParams,
) -> Result<(), String> {
    require_one_of("change_kind", &params.change_kind, &CHANGE_KINDS)?;
    require_len("reason", &params.reason, MAX_REASON_LEN)?;

    let version = load_source_version(ctx, organization_id, company_id, source_version_id)?;
    let source = load_source(ctx, organization_id, company_id, version.source_id)?;
    let target_status =
        target_version_status(&params.change_kind).ok_or("unrecognised change_kind")?;
    let severity = severity_for_change(&params.change_kind).ok_or("unrecognised change_kind")?;

    if version_status_rank(target_status) <= version_status_rank(&version.status) {
        return Err(format!(
            "a {} version cannot move to {target_status}; source status only moves forward",
            version.status
        ));
    }
    if params.change_kind == "corrected" && params.replacement_version_id.is_none() {
        return Err("a correction must name the corrected version".to_string());
    }
    if let Some(replacement_id) = params.replacement_version_id {
        let replacement = load_source_version(ctx, organization_id, company_id, replacement_id)?;
        if replacement.source_id != version.source_id || replacement.id == version.id {
            return Err("replacement must be a different version of the same source".to_string());
        }
        if replacement.status != VERSION_STATUSES[0] {
            return Err("replacement version must be current".to_string());
        }
    }

    // Passages of exactly this version, matched the way citations match them.
    let passages: Vec<AiEvidencePassage> = ctx
        .db
        .ai_evidence_passage()
        .ai_evidence_passage_by_source()
        .filter((
            &organization_id,
            &company_id,
            &source.source_kind,
            &source.source_key,
        ))
        .filter(|row| row.source_version == version.version)
        .collect();

    let mut passage_ids = Vec::with_capacity(passages.len());
    for passage in passages {
        passage_ids.push(passage.id);
        let (status, text_state) =
            passage_effect(&params.change_kind, &passage.status, &passage.text_state);
        let passage_text = if text_state == TEXT_TOMBSTONED {
            String::new()
        } else {
            passage.passage_text.clone()
        };
        ctx.db.ai_evidence_passage().id().update(AiEvidencePassage {
            status,
            text_state,
            passage_text,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..passage
        });
    }

    let (snapshot_ref, snapshot_state) = if target_status == "deleted" {
        (
            None,
            crate::ai::evidence_source::derive_snapshot_state(&version.content_hash, &None),
        )
    } else {
        (version.snapshot_ref.clone(), version.snapshot_state.clone())
    };
    ctx.db
        .ai_evidence_source_version()
        .id()
        .update(AiEvidenceSourceVersion {
            status: target_status.to_string(),
            snapshot_ref,
            snapshot_state,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..version.clone()
        });

    let change = ctx
        .db
        .ai_evidence_source_change()
        .insert(AiEvidenceSourceChange {
            id: 0,
            organization_id,
            company_id,
            source_version_id,
            change_kind: params.change_kind.clone(),
            replacement_version_id: params.replacement_version_id,
            reason: params.reason,
            policy_version: EVIDENCE_POLICY_VERSION,
            affected_passage_count: passage_ids.len() as u32,
            affected_dependency_count: 0,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
        });

    let touched = escalate_dependents(
        ctx,
        organization_id,
        company_id,
        UpstreamKind::Passage,
        &passage_ids,
        severity,
        Some(change.id),
    )?;
    let change_id = change.id;
    ctx.db
        .ai_evidence_source_change()
        .id()
        .update(AiEvidenceSourceChange {
            affected_dependency_count: touched,
            ..change
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_evidence_source_change",
            record_id: change_id,
            action: "CREATE",
            old_values: Some(serde_json::json!({ "status": version.status }).to_string()),
            new_values: Some(
                serde_json::json!({
                    "status": target_status,
                    "change_kind": params.change_kind,
                    "affected_passages": passage_ids.len(),
                    "affected_dependencies": touched,
                    "policy_version": EVIDENCE_POLICY_VERSION,
                })
                .to_string(),
            ),
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Resolve a flagged dependency edge.
///
/// - `acknowledged`: a reviewer accepts that a *discretionary* dependency is
///   no longer valid and proceeds anyway. The edge stays not-valid; it only
///   stops asking.
/// - `reaffirmed`: a reviewer asserts that a `needs_review` edge still holds,
///   which is only possible while the upstream itself is still usable (a
///   superseded passage, a current claim, an accepted decision). An `invalid`
///   edge — retracted, revoked or deleted evidence — can never be reaffirmed;
///   the dependent must be re-linked to other evidence in a new revision.
#[reducer]
pub fn resolve_ai_evidence_dependency(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    dependency_id: u64,
    params: ResolveAiEvidenceDependencyParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_evidence_dependency", "update")?;
    require_one_of(
        "resolution",
        &params.resolution,
        &["acknowledged", "reaffirmed"],
    )?;
    require_len("note", &params.note, MAX_REASON_LEN)?;
    let edge = ctx
        .db
        .ai_evidence_dependency()
        .id()
        .find(&dependency_id)
        .ok_or("Dependency not found")?;
    if edge.organization_id != organization_id || edge.company_id != company_id {
        return Err("Dependency does not belong to this organization/company".to_string());
    }
    if edge.state == "valid" {
        return Err("dependency is already valid".to_string());
    }

    let old_state = edge.state.clone();
    let updated = match params.resolution.as_str() {
        "acknowledged" => {
            if Requirement::from_label(&edge.requirement) != Requirement::Discretionary {
                return Err(
                    "only a discretionary dependency can be acknowledged; a required one must be reaffirmed or re-linked"
                        .to_string(),
                );
            }
            AiEvidenceDependency {
                acknowledged_by: Some(ctx.sender()),
                acknowledged_at: Some(ctx.timestamp),
                write_date: ctx.timestamp,
                ..edge
            }
        }
        _ => {
            if edge.state == "invalid" {
                return Err(
                    "an invalid dependency cannot be reaffirmed; link the dependent to other evidence"
                        .to_string(),
                );
            }
            require_upstream_reaffirmable(ctx, &edge)?;
            AiEvidenceDependency {
                state: "valid".to_string(),
                acknowledged_by: None,
                acknowledged_at: None,
                write_date: ctx.timestamp,
                ..edge
            }
        }
    };
    let new_state = updated.state.clone();
    ctx.db.ai_evidence_dependency().id().update(updated);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_evidence_dependency",
            record_id: dependency_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": old_state }).to_string()),
            new_values: Some(serde_json::json!({ "state": new_state }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: Some(
                serde_json::json!({
                    "resolution": params.resolution,
                    "note": params.note,
                })
                .to_string(),
            ),
        },
    );
    Ok(())
}

// ── Crate-internal API used by the record modules ────────────────────────────

/// Record `dependent` as resting on `upstream`. Idempotent.
#[allow(clippy::too_many_arguments)]
pub(crate) fn link_dependency(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    upstream_kind: UpstreamKind,
    upstream_id: u64,
    dependent_kind: DependentKind,
    dependent_id: u64,
    requirement: Requirement,
) {
    let exists = ctx
        .db
        .ai_evidence_dependency()
        .ai_evidence_dependency_by_dependent()
        .filter((
            &organization_id,
            &dependent_kind.as_str().to_string(),
            &dependent_id,
        ))
        .any(|edge| {
            edge.upstream_kind == upstream_kind.as_str() && edge.upstream_id == upstream_id
        });
    if exists {
        return;
    }
    ctx.db
        .ai_evidence_dependency()
        .insert(AiEvidenceDependency {
            id: 0,
            organization_id,
            company_id,
            upstream_kind: upstream_kind.as_str().to_string(),
            upstream_id,
            dependent_kind: dependent_kind.as_str().to_string(),
            dependent_id,
            requirement: requirement.as_str().to_string(),
            state: DEPENDENCY_VALID.to_string(),
            policy_version: EVIDENCE_POLICY_VERSION,
            acknowledged_by: None,
            acknowledged_at: None,
            last_change_id: None,
            create_date: ctx.timestamp,
            write_date: ctx.timestamp,
        });
}

const DEPENDENCY_VALID: &str = "valid";

/// Deny new reuse/execution of `dependent` while a required dependency is not
/// valid, or a discretionary one has not been acknowledged.
pub(crate) fn require_dependencies_usable(
    ctx: &ReducerContext,
    organization_id: u64,
    dependent_kind: DependentKind,
    dependent_id: u64,
) -> Result<(), String> {
    let edges: Vec<EdgeView> = ctx
        .db
        .ai_evidence_dependency()
        .ai_evidence_dependency_by_dependent()
        .filter((
            &organization_id,
            &dependent_kind.as_str().to_string(),
            &dependent_id,
        ))
        .map(|edge| EdgeView {
            requirement: Requirement::from_label(&edge.requirement),
            state: edge.state,
            acknowledged: edge.acknowledged_by.is_some(),
        })
        .collect();
    match dependency_reuse_decision(&edges) {
        ReuseDecision::Allow => Ok(()),
        ReuseDecision::RequiresAcknowledgement => Err(format!(
            "{} {dependent_id} has a discretionary dependency that needs an acknowledged review",
            dependent_kind.as_str()
        )),
        ReuseDecision::Deny => Err(format!(
            "{} {dependent_id} has a required dependency that is not valid",
            dependent_kind.as_str()
        )),
    }
}

/// Walk forward from `upstream_ids`, escalating every reachable edge per the
/// policy above and flagging each dependent record. Returns the number of
/// edges that changed. Aborts (rolling the reducer back) past the edge cap.
pub(crate) fn escalate_dependents(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    upstream_kind: UpstreamKind,
    upstream_ids: &[u64],
    severity: Severity,
    change_id: Option<u64>,
) -> Result<u32, String> {
    let mut queue: Vec<(UpstreamKind, u64, Severity)> = upstream_ids
        .iter()
        .map(|id| (upstream_kind, *id, severity))
        .collect();
    // Highest severity already propagated from each node, so a node is only
    // revisited when it now carries something worse.
    let mut propagated: BTreeMap<(&'static str, u64), Severity> = BTreeMap::new();
    let mut touched: u32 = 0;

    while let Some((kind, id, incoming)) = queue.pop() {
        if propagated
            .get(&(kind.as_str(), id))
            .is_some_and(|seen| *seen >= incoming)
        {
            continue;
        }
        propagated.insert((kind.as_str(), id), incoming);

        let edges: Vec<AiEvidenceDependency> = ctx
            .db
            .ai_evidence_dependency()
            .ai_evidence_dependency_by_upstream()
            .filter((&organization_id, &kind.as_str().to_string(), &id))
            .collect();
        for edge in edges {
            if edge.company_id != company_id {
                continue;
            }
            let requirement = Requirement::from_label(&edge.requirement);
            let next_state = edge_state_after(requirement, incoming, &edge.state);
            if next_state == edge.state {
                continue;
            }
            touched += 1;
            if touched > MAX_ESCALATION_EDGES {
                return Err(format!(
                    "source change reaches more than {MAX_ESCALATION_EDGES} dependencies; split the change"
                ));
            }
            let dependent_id = edge.dependent_id;
            let dependent_kind = DependentKind::from_label(&edge.dependent_kind);
            let next_severity = Severity::from_state(&next_state);
            ctx.db
                .ai_evidence_dependency()
                .id()
                .update(AiEvidenceDependency {
                    state: next_state,
                    // A worse state voids any earlier acknowledgement.
                    acknowledged_by: None,
                    acknowledged_at: None,
                    last_change_id: change_id,
                    write_date: ctx.timestamp,
                    ..edge
                });

            let Some(dependent_kind) = dependent_kind else {
                continue;
            };
            flag_dependent(ctx, dependent_kind, dependent_id, next_severity);
            if let Some(next_upstream) = dependent_kind.as_upstream() {
                queue.push((next_upstream, dependent_id, next_severity));
            }
        }
    }
    Ok(touched)
}

/// Mark one dependent record for review. Only live records are touched; a
/// superseded revision keeps the status it had when it was replaced.
fn flag_dependent(ctx: &ReducerContext, kind: DependentKind, id: u64, severity: Severity) {
    match kind {
        DependentKind::Claim => {
            if let Some(claim) = ctx.db.ai_evidence_claim().id().find(&id) {
                if claim.status == CLAIM_CURRENT {
                    ctx.db.ai_evidence_claim().id().update(AiEvidenceClaim {
                        status: CLAIM_NEEDS_REVIEW.to_string(),
                        write_uid: ctx.sender(),
                        write_date: ctx.timestamp,
                        ..claim
                    });
                }
            }
        }
        DependentKind::Decision => {
            if let Some(decision) = ctx.db.ai_evidence_decision().id().find(&id) {
                if decision.status == DECISION_ACCEPTED || decision.status == DECISION_PROPOSED {
                    ctx.db
                        .ai_evidence_decision()
                        .id()
                        .update(AiEvidenceDecision {
                            status: DECISION_NEEDS_REVIEW.to_string(),
                            write_uid: ctx.sender(),
                            write_date: ctx.timestamp,
                            ..decision
                        });
                }
            }
        }
        DependentKind::Component => {
            if let Some(component) = ctx.db.ai_artifact_component().id().find(&id) {
                if component.status == COMPONENT_CURRENT {
                    let link_state = if severity == Severity::Invalid
                        || component.link_state == LINK_UNRESOLVED
                    {
                        LINK_UNRESOLVED
                    } else {
                        LINK_CHANGED
                    };
                    if link_state != component.link_state {
                        ctx.db
                            .ai_artifact_component()
                            .id()
                            .update(AiArtifactComponent {
                                link_state: link_state.to_string(),
                                write_uid: ctx.sender(),
                                write_date: ctx.timestamp,
                                ..component
                            });
                    }
                }
            }
        }
        DependentKind::KnowledgeVersion => mark_version_needs_review(ctx, id),
    }
}

/// Reaffirming an edge is only meaningful while what it points at is itself
/// still usable.
fn require_upstream_reaffirmable(
    ctx: &ReducerContext,
    edge: &AiEvidenceDependency,
) -> Result<(), String> {
    let usable = match edge.upstream_kind.as_str() {
        "passage" => ctx
            .db
            .ai_evidence_passage()
            .id()
            .find(&edge.upstream_id)
            .is_some_and(|passage| {
                passage.status != "withdrawn" && passage.text_state == TEXT_PRESENT
            }),
        "claim" => ctx
            .db
            .ai_evidence_claim()
            .id()
            .find(&edge.upstream_id)
            .is_some_and(|claim| claim.status == CLAIM_CURRENT),
        "decision" => ctx
            .db
            .ai_evidence_decision()
            .id()
            .find(&edge.upstream_id)
            .is_some_and(|decision| decision.status == DECISION_ACCEPTED),
        _ => false,
    };
    if usable {
        Ok(())
    } else {
        Err(format!(
            "the {} this dependency rests on is not currently usable; re-review it first",
            edge.upstream_kind
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edge(requirement: Requirement, state: &str, acknowledged: bool) -> EdgeView {
        EdgeView {
            requirement,
            state: state.into(),
            acknowledged,
        }
    }

    #[test]
    fn change_kinds_map_to_forward_only_statuses() {
        for kind in CHANGE_KINDS {
            let status = target_version_status(kind).expect(kind);
            assert!(
                version_status_rank(status) > version_status_rank("current"),
                "{kind}"
            );
            assert!(severity_for_change(kind).is_some(), "{kind}");
        }
        assert_eq!(target_version_status("bogus"), None);
        assert_eq!(severity_for_change("bogus"), None);
    }

    #[test]
    fn corrections_flag_for_review_but_retractions_invalidate() {
        assert_eq!(
            severity_for_change("corrected"),
            Some(Severity::NeedsReview)
        );
        assert_eq!(
            severity_for_change("superseded"),
            Some(Severity::NeedsReview)
        );
        for kind in ["retracted", "access_revoked", "deleted"] {
            assert_eq!(severity_for_change(kind), Some(Severity::Invalid), "{kind}");
        }
    }

    #[test]
    fn discretionary_edges_never_exceed_needs_review() {
        assert_eq!(
            edge_state_after(Requirement::Required, Severity::Invalid, "valid"),
            "invalid"
        );
        assert_eq!(
            edge_state_after(Requirement::Discretionary, Severity::Invalid, "valid"),
            "needs_review"
        );
        assert_eq!(
            edge_state_after(Requirement::Required, Severity::NeedsReview, "valid"),
            "needs_review"
        );
    }

    #[test]
    fn edge_state_never_improves() {
        assert_eq!(
            edge_state_after(Requirement::Required, Severity::NeedsReview, "invalid"),
            "invalid"
        );
        assert_eq!(
            edge_state_after(Requirement::Discretionary, Severity::NeedsReview, "invalid"),
            "invalid"
        );
    }

    #[test]
    fn required_invalid_dependency_denies_reuse() {
        assert_eq!(dependency_reuse_decision(&[]), ReuseDecision::Allow);
        assert_eq!(
            dependency_reuse_decision(&[edge(Requirement::Required, "valid", false)]),
            ReuseDecision::Allow
        );
        assert_eq!(
            dependency_reuse_decision(&[edge(Requirement::Required, "needs_review", false)]),
            ReuseDecision::Deny
        );
        assert_eq!(
            dependency_reuse_decision(&[
                edge(Requirement::Discretionary, "needs_review", false),
                edge(Requirement::Required, "invalid", false),
            ]),
            ReuseDecision::Deny
        );
    }

    #[test]
    fn discretionary_dependency_needs_acknowledgement_not_denial() {
        assert_eq!(
            dependency_reuse_decision(&[edge(Requirement::Discretionary, "needs_review", false)]),
            ReuseDecision::RequiresAcknowledgement
        );
        assert_eq!(
            dependency_reuse_decision(&[edge(Requirement::Discretionary, "needs_review", true)]),
            ReuseDecision::Allow
        );
        // Acknowledgement never rescues a required edge.
        assert_eq!(
            dependency_reuse_decision(&[edge(Requirement::Required, "needs_review", true)]),
            ReuseDecision::Deny
        );
    }

    #[test]
    fn passage_effect_never_regresses_and_tombstones_on_deletion() {
        assert_eq!(
            passage_effect("superseded", "current", "present"),
            ("superseded".to_string(), "present".to_string())
        );
        assert_eq!(
            passage_effect("retracted", "current", "present"),
            ("withdrawn".to_string(), "present".to_string())
        );
        assert_eq!(
            passage_effect("access_revoked", "current", "present"),
            ("withdrawn".to_string(), "restricted".to_string())
        );
        assert_eq!(
            passage_effect("deleted", "withdrawn", "restricted"),
            ("withdrawn".to_string(), "tombstoned".to_string())
        );
        // A later, milder change cannot restore text.
        assert_eq!(
            passage_effect("retracted", "withdrawn", "tombstoned"),
            ("withdrawn".to_string(), "tombstoned".to_string())
        );
        assert_eq!(
            passage_effect("superseded", "withdrawn", "restricted"),
            ("withdrawn".to_string(), "restricted".to_string())
        );
    }

    #[test]
    fn unknown_requirement_reads_as_required() {
        assert_eq!(Requirement::from_label("weird"), Requirement::Required);
        assert_eq!(
            Requirement::from_label("discretionary"),
            Requirement::Discretionary
        );
    }
}
