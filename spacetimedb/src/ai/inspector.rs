//! AIH-16 — Source and decision inspector (M3).
//!
//! Shared read-only inspector for claims, decisions, artifact components and
//! agent-run answers. Every inspection reauthorizes through `check_permission`
//! and redacts source excerpts when the caller cannot access them.
//!
//! Reuses the durable source/passage/contribution tables from AIH-13, the
//! claim/decision/component tables from AIH-14, and the validation/gate tables
//! from AIH-15. No new write paths are introduced.

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::ai::answer_gate::{
    ai_answer_gate_result, ai_claim_validation, AiAnswerGateResult, AiClaimValidation,
};
use crate::ai::lineage::{
    ai_artifact_component, ai_claim, ai_decision, AiArtifactComponent, AiClaim, AiDecision,
};
use crate::ai::provenance::{
    ai_contribution, ai_source_passage, ai_source_version, AiContribution, AiSourcePassage,
    AiSourceVersion,
};
use crate::ai::skills::{ai_agent_run, AiAgentRun};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

const AUTO_INC_SENTINEL: u64 = 0;
const SUMMARY_LEN: usize = 200;
const MAX_JSON_LEN: usize = 32_768;

// ── Availability semantics ───────────────────────────────────────────────────

const AVAILABILITY_AVAILABLE: &str = "available";
const AVAILABILITY_DENIED: &str = "denied";
const AVAILABILITY_UNAVAILABLE: &str = "unavailable";
const AVAILABILITY_RECALLED: &str = "recalled";

// ── Read-only view types ─────────────────────────────────────────────────────

/// A source version as seen by the current inspector caller.
///
/// When `availability` is not `available`, bibliographic metadata and the
/// content hash are redacted so a denied or unavailable source leaks no
/// excerpt or snapshot identity.
#[derive(SpacetimeType, Clone, Debug)]
pub struct AiSourceVersionView {
    pub id: u64,
    pub availability: String,
    pub kind: Option<String>,
    pub title: Option<String>,
    pub authors_json: Option<String>,
    pub publisher: Option<String>,
    pub publication_date: Option<String>,
    pub edition: Option<String>,
    pub version_label: Option<String>,
    pub uri: Option<String>,
    pub doi: Option<String>,
    pub file_reference: Option<String>,
    pub content_hash: Option<String>,
    pub snapshot_ref: Option<String>,
    pub retrieval_time: Option<Timestamp>,
    pub origin: Option<String>,
    pub owner_identity: Option<Identity>,
    pub scope: Option<String>,
    pub retention_policy: Option<String>,
    pub inspection_state: Option<String>,
}

/// A source passage as seen by the current inspector caller.
///
/// The `content` field is `None` whenever the parent source is denied,
/// recalled, or missing. The `content_hash` is also redacted in those cases.
#[derive(SpacetimeType, Clone, Debug)]
pub struct AiSourcePassageView {
    pub id: u64,
    pub source_version_id: u64,
    pub availability: String,
    pub passage_kind: Option<String>,
    pub content: Option<String>,
    pub content_hash: Option<String>,
    pub coordinates_json: Option<String>,
    pub is_original: Option<bool>,
    pub processor_ref: Option<String>,
    pub correction_ref: Option<String>,
}

/// A contribution that introduced a source or passage into discussion.
#[derive(SpacetimeType, Clone, Debug)]
pub struct AiContributionView {
    pub id: u64,
    pub contributor_identity: Identity,
    pub contributor_kind: String,
    pub session_ref: Option<String>,
    pub turn_ref: Option<String>,
    pub event_ref: Option<String>,
    pub inspection_state: String,
    pub introduced_at: Timestamp,
}

/// Minimal claim reference used inside decision views to avoid deep recursion.
#[derive(SpacetimeType, Clone, Debug)]
pub struct AiClaimRef {
    pub id: u64,
    pub kind: String,
    pub statement_summary: String,
    pub status: String,
}

/// Minimal decision reference used inside claim views to avoid deep recursion.
#[derive(SpacetimeType, Clone, Debug)]
pub struct AiDecisionRef {
    pub id: u64,
    pub status: String,
    pub rationale_summary: String,
}

/// A claim with its source foundation, contributions, and adopting decisions.
#[derive(SpacetimeType, Clone, Debug)]
pub struct AiClaimView {
    pub id: u64,
    pub kind: String,
    pub statement: String,
    pub assumptions_json: Option<String>,
    pub verification_outcome: Option<String>,
    pub status: String,
    pub source_version: Option<AiSourceVersionView>,
    pub source_passage: Option<AiSourcePassageView>,
    pub contributions: Vec<AiContributionView>,
    pub decisions: Vec<AiDecisionRef>,
}

/// A decision with its claim foundation, supporting claims and sources.
#[derive(SpacetimeType, Clone, Debug)]
pub struct AiDecisionView {
    pub id: u64,
    pub status: String,
    pub applicability: Option<String>,
    pub alternatives_json: Option<String>,
    pub adaptations_json: Option<String>,
    pub rationale: String,
    pub contributor_identity: Identity,
    pub reviewer_identity: Option<Identity>,
    pub claim: Option<AiClaimRef>,
    pub supporting_claims: Vec<AiClaimRef>,
    pub supporting_sources: Vec<AiSourceVersionView>,
}

/// An artifact component bound to its decision/claim lineage.
#[derive(SpacetimeType, Clone, Debug)]
pub struct AiArtifactComponentView {
    pub id: u64,
    pub component_key: String,
    pub component_kind: String,
    pub version: u32,
    pub content_hash: String,
    pub status: String,
    pub decision: Option<AiDecisionView>,
    pub claim: Option<AiClaimView>,
}

/// One answer-gate validation record surfaced in the inspector.
#[derive(SpacetimeType, Clone, Debug)]
pub struct AiClaimValidationView {
    pub id: u64,
    pub run_id: u64,
    pub claim_id: Option<u64>,
    pub source_version_id: Option<u64>,
    pub source_passage_id: Option<u64>,
    pub check_kind: String,
    pub outcome: String,
    pub detail: Option<String>,
}

/// Aggregate gate result for a run, surfaced in the inspector.
#[derive(SpacetimeType, Clone, Debug)]
pub struct AiAnswerGateResultView {
    pub id: u64,
    pub run_id: u64,
    pub gate_outcome: String,
    pub failed_checks_json: Option<String>,
    pub domain_review_required: bool,
}

/// Full inspection of an agent-run answer.
#[derive(SpacetimeType, Clone, Debug)]
pub struct AiAnswerInspection {
    pub run_id: u64,
    pub run_status: String,
    pub gate_result: Option<AiAnswerGateResultView>,
    pub validations: Vec<AiClaimValidationView>,
    pub claims: Vec<AiClaimView>,
}

// ── JSON serialization for inspector payloads ────────────────────────────────
//
// `spacetimedb::Timestamp` and `Identity` do not implement `serde::Serialize`
// in this project's dependency tree, so the view types expose `to_json`
// conversions that turn them into plain JSON scalars.

fn json_identity(id: Identity) -> serde_json::Value {
    serde_json::Value::String(id.to_hex().to_string())
}

fn json_option_identity(id: Option<Identity>) -> serde_json::Value {
    match id {
        None => serde_json::Value::Null,
        Some(i) => json_identity(i),
    }
}

fn json_timestamp(ts: Timestamp) -> serde_json::Value {
    serde_json::Value::Number(ts.to_micros_since_unix_epoch().into())
}

fn json_option_timestamp(ts: Option<Timestamp>) -> serde_json::Value {
    match ts {
        None => serde_json::Value::Null,
        Some(t) => json_timestamp(t),
    }
}

fn json_option_string(s: &Option<String>) -> serde_json::Value {
    match s {
        None => serde_json::Value::Null,
        Some(v) => serde_json::Value::String(v.clone()),
    }
}

fn json_option_bool(b: Option<bool>) -> serde_json::Value {
    match b {
        None => serde_json::Value::Null,
        Some(v) => serde_json::Value::Bool(v),
    }
}

impl AiSourceVersionView {
    fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "availability": self.availability,
            "kind": json_option_string(&self.kind),
            "title": json_option_string(&self.title),
            "authors_json": json_option_string(&self.authors_json),
            "publisher": json_option_string(&self.publisher),
            "publication_date": json_option_string(&self.publication_date),
            "edition": json_option_string(&self.edition),
            "version_label": json_option_string(&self.version_label),
            "uri": json_option_string(&self.uri),
            "doi": json_option_string(&self.doi),
            "file_reference": json_option_string(&self.file_reference),
            "content_hash": json_option_string(&self.content_hash),
            "snapshot_ref": json_option_string(&self.snapshot_ref),
            "retrieval_time": json_option_timestamp(self.retrieval_time),
            "origin": json_option_string(&self.origin),
            "owner_identity": json_option_identity(self.owner_identity),
            "scope": json_option_string(&self.scope),
            "retention_policy": json_option_string(&self.retention_policy),
            "inspection_state": json_option_string(&self.inspection_state),
        })
    }
}

impl AiSourcePassageView {
    fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "source_version_id": self.source_version_id,
            "availability": self.availability,
            "passage_kind": json_option_string(&self.passage_kind),
            "content": json_option_string(&self.content),
            "content_hash": json_option_string(&self.content_hash),
            "coordinates_json": json_option_string(&self.coordinates_json),
            "is_original": json_option_bool(self.is_original),
            "processor_ref": json_option_string(&self.processor_ref),
            "correction_ref": json_option_string(&self.correction_ref),
        })
    }
}

impl AiContributionView {
    fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "contributor_identity": json_identity(self.contributor_identity),
            "contributor_kind": self.contributor_kind,
            "session_ref": json_option_string(&self.session_ref),
            "turn_ref": json_option_string(&self.turn_ref),
            "event_ref": json_option_string(&self.event_ref),
            "inspection_state": self.inspection_state,
            "introduced_at": json_timestamp(self.introduced_at),
        })
    }
}

impl AiClaimRef {
    fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "kind": self.kind,
            "statement_summary": self.statement_summary,
            "status": self.status,
        })
    }
}

impl AiDecisionRef {
    fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "status": self.status,
            "rationale_summary": self.rationale_summary,
        })
    }
}

impl AiClaimView {
    fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "kind": self.kind,
            "statement": self.statement,
            "assumptions_json": json_option_string(&self.assumptions_json),
            "verification_outcome": json_option_string(&self.verification_outcome),
            "status": self.status,
            "source_version": self.source_version.as_ref().map(|v| v.to_json()).unwrap_or(serde_json::Value::Null),
            "source_passage": self.source_passage.as_ref().map(|p| p.to_json()).unwrap_or(serde_json::Value::Null),
            "contributions": self.contributions.iter().map(|c| c.to_json()).collect::<Vec<_>>(),
            "decisions": self.decisions.iter().map(|d| d.to_json()).collect::<Vec<_>>(),
        })
    }
}

impl AiDecisionView {
    fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "status": self.status,
            "applicability": json_option_string(&self.applicability),
            "alternatives_json": json_option_string(&self.alternatives_json),
            "adaptations_json": json_option_string(&self.adaptations_json),
            "rationale": self.rationale,
            "contributor_identity": json_identity(self.contributor_identity),
            "reviewer_identity": json_option_identity(self.reviewer_identity),
            "claim": self.claim.as_ref().map(|c| c.to_json()).unwrap_or(serde_json::Value::Null),
            "supporting_claims": self.supporting_claims.iter().map(|c| c.to_json()).collect::<Vec<_>>(),
            "supporting_sources": self.supporting_sources.iter().map(|s| s.to_json()).collect::<Vec<_>>(),
        })
    }
}

impl AiArtifactComponentView {
    fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "component_key": self.component_key,
            "component_kind": self.component_kind,
            "version": self.version,
            "content_hash": self.content_hash,
            "status": self.status,
            "decision": self.decision.as_ref().map(|d| d.to_json()).unwrap_or(serde_json::Value::Null),
            "claim": self.claim.as_ref().map(|c| c.to_json()).unwrap_or(serde_json::Value::Null),
        })
    }
}

impl AiClaimValidationView {
    fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "run_id": self.run_id,
            "claim_id": self.claim_id,
            "source_version_id": self.source_version_id,
            "source_passage_id": self.source_passage_id,
            "check_kind": self.check_kind,
            "outcome": self.outcome,
            "detail": json_option_string(&self.detail),
        })
    }
}

impl AiAnswerGateResultView {
    fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "run_id": self.run_id,
            "gate_outcome": self.gate_outcome,
            "failed_checks_json": json_option_string(&self.failed_checks_json),
            "domain_review_required": self.domain_review_required,
        })
    }
}

impl AiAnswerInspection {
    fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "run_id": self.run_id,
            "run_status": self.run_status,
            "gate_result": self.gate_result.as_ref().map(|g| g.to_json()).unwrap_or(serde_json::Value::Null),
            "validations": self.validations.iter().map(|v| v.to_json()).collect::<Vec<_>>(),
            "claims": self.claims.iter().map(|c| c.to_json()).collect::<Vec<_>>(),
        })
    }
}

/// Durable inspector result written by the request reducers.
///
/// The typed view is serialized to `payload_json`. The table is kept private so
/// exact source excerpts are only available to authorized callers; the
/// API/BFF layer reads the row for a correlation it generated after invoking
/// the corresponding `request_inspect_*` reducer.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_inspector_result,
    index(accessor = ai_inspector_result_by_org, btree(columns = [organization_id])),
    index(accessor = ai_inspector_result_by_caller, btree(columns = [caller_identity])),
    index(accessor = ai_inspector_result_by_correlation, btree(columns = [correlation]))
)]
pub struct AiInspectorResult {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub caller_identity: Identity,
    pub correlation: String,
    /// `claim` | `decision` | `component` | `answer`
    pub view_kind: String,
    pub payload_json: String,
    pub create_date: Timestamp,
}

// ── Authorization helpers ────────────────────────────────────────────────────

/// Returns true when the caller may read the source's content.
///
/// Organization membership is already enforced by `check_permission`. This
/// helper applies the source's own scope: `private` sources are visible only to
/// their recorded owner.
fn source_visible_to_caller(ctx: &ReducerContext, source: &AiSourceVersion) -> bool {
    match source.scope.as_str() {
        "private" => source.owner_identity == Some(ctx.sender()),
        _ => true,
    }
}

fn summarize(text: &str) -> String {
    text.chars().take(SUMMARY_LEN).collect()
}

fn parse_id_array(json: &str) -> Result<Vec<u64>, String> {
    let trimmed = json.trim();
    if trimmed.is_empty() || trimmed == "[]" {
        return Ok(vec![]);
    }
    serde_json::from_str::<Vec<u64>>(trimmed).map_err(|e| format!("invalid id array json: {e}"))
}

// ── View builders ────────────────────────────────────────────────────────────

fn source_version_view(
    ctx: &ReducerContext,
    source: &AiSourceVersion,
    visible: bool,
) -> AiSourceVersionView {
    if !visible {
        return AiSourceVersionView {
            id: source.id,
            availability: AVAILABILITY_DENIED.to_string(),
            kind: None,
            title: None,
            authors_json: None,
            publisher: None,
            publication_date: None,
            edition: None,
            version_label: None,
            uri: None,
            doi: None,
            file_reference: None,
            content_hash: None,
            snapshot_ref: None,
            retrieval_time: None,
            origin: None,
            owner_identity: None,
            scope: None,
            retention_policy: None,
            inspection_state: None,
        };
    }
    AiSourceVersionView {
        id: source.id,
        availability: AVAILABILITY_AVAILABLE.to_string(),
        kind: Some(source.kind.clone()),
        title: Some(source.title.clone()),
        authors_json: source.authors_json.clone(),
        publisher: source.publisher.clone(),
        publication_date: source.publication_date.clone(),
        edition: source.edition.clone(),
        version_label: source.version_label.clone(),
        uri: source.uri.clone(),
        doi: source.doi.clone(),
        file_reference: source.file_reference.clone(),
        content_hash: Some(source.content_hash.clone()),
        snapshot_ref: source.snapshot_ref.clone(),
        retrieval_time: source.retrieval_time,
        origin: Some(source.origin.clone()),
        owner_identity: source.owner_identity,
        scope: Some(source.scope.clone()),
        retention_policy: Some(source.retention_policy.clone()),
        inspection_state: Some(source.inspection_state.clone()),
    }
}

fn unavailable_source_version_view(id: u64, availability: &str) -> AiSourceVersionView {
    AiSourceVersionView {
        id,
        availability: availability.to_string(),
        kind: None,
        title: None,
        authors_json: None,
        publisher: None,
        publication_date: None,
        edition: None,
        version_label: None,
        uri: None,
        doi: None,
        file_reference: None,
        content_hash: None,
        snapshot_ref: None,
        retrieval_time: None,
        origin: None,
        owner_identity: None,
        scope: None,
        retention_policy: None,
        inspection_state: None,
    }
}

fn source_passage_view(passage: &AiSourcePassage, source_visible: bool) -> AiSourcePassageView {
    if !source_visible {
        return AiSourcePassageView {
            id: passage.id,
            source_version_id: passage.source_version_id,
            availability: AVAILABILITY_DENIED.to_string(),
            passage_kind: None,
            content: None,
            content_hash: None,
            coordinates_json: None,
            is_original: None,
            processor_ref: None,
            correction_ref: None,
        };
    }
    AiSourcePassageView {
        id: passage.id,
        source_version_id: passage.source_version_id,
        availability: AVAILABILITY_AVAILABLE.to_string(),
        passage_kind: Some(passage.passage_kind.clone()),
        content: Some(passage.content.clone()),
        content_hash: Some(passage.content_hash.clone()),
        coordinates_json: passage.coordinates_json.clone(),
        is_original: Some(passage.is_original),
        processor_ref: passage.processor_ref.clone(),
        correction_ref: passage.correction_ref.clone(),
    }
}

fn unavailable_source_passage_view(id: u64, source_version_id: u64) -> AiSourcePassageView {
    AiSourcePassageView {
        id,
        source_version_id,
        availability: AVAILABILITY_UNAVAILABLE.to_string(),
        passage_kind: None,
        content: None,
        content_hash: None,
        coordinates_json: None,
        is_original: None,
        processor_ref: None,
        correction_ref: None,
    }
}

fn contribution_view(contribution: &AiContribution) -> AiContributionView {
    AiContributionView {
        id: contribution.id,
        contributor_identity: contribution.contributor_identity,
        contributor_kind: contribution.contributor_kind.clone(),
        session_ref: contribution.session_ref.clone(),
        turn_ref: contribution.turn_ref.clone(),
        event_ref: contribution.event_ref.clone(),
        inspection_state: contribution.inspection_state.clone(),
        introduced_at: contribution.introduced_at,
    }
}

fn claim_ref(claim: &AiClaim) -> AiClaimRef {
    AiClaimRef {
        id: claim.id,
        kind: claim.kind.clone(),
        statement_summary: summarize(&claim.statement),
        status: claim.status.clone(),
    }
}

fn contributions_for_source(
    ctx: &ReducerContext,
    organization_id: u64,
    source_version_id: Option<u64>,
    passage_id: Option<u64>,
) -> Vec<AiContributionView> {
    ctx.db
        .ai_contribution()
        .iter()
        .filter(|c| {
            c.organization_id == organization_id
                && (c.source_version_id == source_version_id || c.passage_id == passage_id)
        })
        .map(|c| contribution_view(&c))
        .collect()
}

fn build_claim_view(ctx: &ReducerContext, claim: &AiClaim) -> AiClaimView {
    let (source_version, source_passage) = match claim.source_version_id {
        None => (None, None),
        Some(version_id) => {
            let version = ctx.db.ai_source_version().id().find(&version_id);
            match version {
                None => (
                    Some(unavailable_source_version_view(
                        version_id,
                        AVAILABILITY_UNAVAILABLE,
                    )),
                    None,
                ),
                Some(v) => {
                    let visible = source_visible_to_caller(ctx, &v);
                    let availability = if visible {
                        AVAILABILITY_AVAILABLE
                    } else {
                        AVAILABILITY_DENIED
                    };
                    let sv = source_version_view(ctx, &v, visible);
                    let sp = match claim.source_passage_id {
                        None => None,
                        Some(passage_id) => match ctx.db.ai_source_passage().id().find(&passage_id)
                        {
                            None => Some(unavailable_source_passage_view(passage_id, version_id)),
                            Some(p) => Some(source_passage_view(&p, visible)),
                        },
                    };
                    // Mark recalled sources as unavailable even if visible at org level.
                    let (sv, sp) = if v.origin == "recalled" {
                        (
                            unavailable_source_version_view(v.id, AVAILABILITY_RECALLED),
                            sp.map(|p| AiSourcePassageView {
                                availability: AVAILABILITY_RECALLED.to_string(),
                                content: None,
                                content_hash: None,
                                ..p
                            }),
                        )
                    } else {
                        (sv, sp)
                    };
                    let _ = availability; // kept for clarity
                    (Some(sv), sp)
                }
            }
        }
    };

    let contributions = contributions_for_source(
        ctx,
        claim.organization_id,
        claim.source_version_id,
        claim.source_passage_id,
    );

    let decisions: Vec<AiDecisionRef> = ctx
        .db
        .ai_decision()
        .iter()
        .filter(|d| d.organization_id == claim.organization_id && d.claim_id == Some(claim.id))
        .map(|d| AiDecisionRef {
            id: d.id,
            status: d.status.clone(),
            rationale_summary: summarize(&d.rationale),
        })
        .collect();

    AiClaimView {
        id: claim.id,
        kind: claim.kind.clone(),
        statement: claim.statement.clone(),
        assumptions_json: claim.assumptions_json.clone(),
        verification_outcome: claim.verification_outcome.clone(),
        status: claim.status.clone(),
        source_version,
        source_passage,
        contributions,
        decisions,
    }
}

fn build_decision_view(ctx: &ReducerContext, decision: &AiDecision) -> AiDecisionView {
    let claim = decision
        .claim_id
        .and_then(|cid| ctx.db.ai_claim().id().find(&cid))
        .map(|c| claim_ref(&c));

    let supporting_claims = decision
        .supporting_claims_json
        .as_deref()
        .map(parse_id_array)
        .transpose()
        .unwrap_or_default()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|cid| ctx.db.ai_claim().id().find(&cid).map(|c| claim_ref(&c)))
        .collect();

    let supporting_sources = decision
        .supporting_sources_json
        .as_deref()
        .map(parse_id_array)
        .transpose()
        .unwrap_or_default()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|sid| {
            let v = ctx.db.ai_source_version().id().find(&sid)?;
            let visible = source_visible_to_caller(ctx, &v);
            Some(source_version_view(ctx, &v, visible))
        })
        .collect();

    AiDecisionView {
        id: decision.id,
        status: decision.status.clone(),
        applicability: decision.applicability.clone(),
        alternatives_json: decision.alternatives_json.clone(),
        adaptations_json: decision.adaptations_json.clone(),
        rationale: decision.rationale.clone(),
        contributor_identity: decision.contributor_identity,
        reviewer_identity: decision.reviewer_identity,
        claim,
        supporting_claims,
        supporting_sources,
    }
}

fn build_component_view(
    ctx: &ReducerContext,
    component: &AiArtifactComponent,
) -> AiArtifactComponentView {
    let decision = component
        .decision_id
        .and_then(|did| ctx.db.ai_decision().id().find(&did))
        .map(|d| build_decision_view(ctx, &d));
    let claim = component
        .claim_id
        .and_then(|cid| ctx.db.ai_claim().id().find(&cid))
        .map(|c| build_claim_view(ctx, &c));

    AiArtifactComponentView {
        id: component.id,
        component_key: component.component_key.clone(),
        component_kind: component.component_kind.clone(),
        version: component.version,
        content_hash: component.content_hash.clone(),
        status: component.status.clone(),
        decision,
        claim,
    }
}

fn validation_view(v: &AiClaimValidation) -> AiClaimValidationView {
    AiClaimValidationView {
        id: v.id,
        run_id: v.run_id,
        claim_id: v.claim_id,
        source_version_id: v.source_version_id,
        source_passage_id: v.source_passage_id,
        check_kind: v.check_kind.clone(),
        outcome: v.outcome.clone(),
        detail: v.detail.clone(),
    }
}

fn gate_result_view(r: &AiAnswerGateResult) -> AiAnswerGateResultView {
    AiAnswerGateResultView {
        id: r.id,
        run_id: r.run_id,
        gate_outcome: r.gate_outcome.clone(),
        failed_checks_json: r.failed_checks_json.clone(),
        domain_review_required: r.domain_review_required,
    }
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Inspect a single claim and its foundation.
///
/// Returns the claim statement, assumptions, verification outcome, linked
/// source/passage (redacted if unavailable or denied), contributions, and the
/// decisions that adopt it.
pub fn inspect_ai_claim(
    ctx: &ReducerContext,
    organization_id: u64,
    claim_id: u64,
) -> Result<AiClaimView, String> {
    check_permission(ctx, organization_id, "ai_source", "read")?;
    if claim_id == AUTO_INC_SENTINEL {
        return Err("claim_id is required".to_string());
    }

    let claim = ctx
        .db
        .ai_claim()
        .id()
        .find(&claim_id)
        .ok_or("claim not found")?;
    if claim.organization_id != organization_id {
        return Err("claim does not belong to this organization".to_string());
    }

    let view = build_claim_view(ctx, &claim);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: claim.company_id,
            table_name: "ai_inspector",
            record_id: claim_id,
            action: "read",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    Ok(view)
}

/// Inspect a single decision and its claim/source foundation.
pub fn inspect_ai_decision(
    ctx: &ReducerContext,
    organization_id: u64,
    decision_id: u64,
) -> Result<AiDecisionView, String> {
    check_permission(ctx, organization_id, "ai_source", "read")?;
    if decision_id == AUTO_INC_SENTINEL {
        return Err("decision_id is required".to_string());
    }

    let decision = ctx
        .db
        .ai_decision()
        .id()
        .find(&decision_id)
        .ok_or("decision not found")?;
    if decision.organization_id != organization_id {
        return Err("decision does not belong to this organization".to_string());
    }

    let view = build_decision_view(ctx, &decision);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: decision.company_id,
            table_name: "ai_inspector",
            record_id: decision_id,
            action: "read",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    Ok(view)
}

/// Inspect an artifact component and the decision/claim lineage it is bound to.
pub fn inspect_ai_artifact_component(
    ctx: &ReducerContext,
    organization_id: u64,
    component_id: u64,
) -> Result<AiArtifactComponentView, String> {
    check_permission(ctx, organization_id, "ai_source", "read")?;
    if component_id == AUTO_INC_SENTINEL {
        return Err("component_id is required".to_string());
    }

    let component = ctx
        .db
        .ai_artifact_component()
        .id()
        .find(&component_id)
        .ok_or("component not found")?;
    if component.organization_id != organization_id {
        return Err("component does not belong to this organization".to_string());
    }

    let view = build_component_view(ctx, &component);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: component.company_id,
            table_name: "ai_inspector",
            record_id: component_id,
            action: "read",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    Ok(view)
}

/// Inspect an agent-run answer.
///
/// Returns the run status, the latest answer-gate result, every validation
/// check recorded for the run, and a claim view for each cited claim. Source
/// excerpts are redacted according to the caller's access.
pub fn inspect_ai_answer(
    ctx: &ReducerContext,
    organization_id: u64,
    run_id: u64,
) -> Result<AiAnswerInspection, String> {
    check_permission(ctx, organization_id, "ai_source", "read")?;
    if run_id == AUTO_INC_SENTINEL {
        return Err("run_id is required".to_string());
    }

    let run = ctx
        .db
        .ai_agent_run()
        .id()
        .find(&run_id)
        .ok_or("run not found")?;
    if run.organization_id != organization_id {
        return Err("run does not belong to this organization".to_string());
    }

    let validations: Vec<AiClaimValidationView> = ctx
        .db
        .ai_claim_validation()
        .iter()
        .filter(|v| v.organization_id == organization_id && v.run_id == run_id)
        .map(|v| validation_view(&v))
        .collect();

    let gate_result = ctx
        .db
        .ai_answer_gate_result()
        .iter()
        .filter(|r| r.organization_id == organization_id && r.run_id == run_id)
        .max_by_key(|r| r.id)
        .map(|r| gate_result_view(&r));

    let mut claim_ids: Vec<u64> = validations.iter().filter_map(|v| v.claim_id).collect();
    claim_ids.sort_unstable();
    claim_ids.dedup();

    let claims: Vec<AiClaimView> = claim_ids
        .into_iter()
        .filter_map(|cid| ctx.db.ai_claim().id().find(&cid))
        .map(|c| build_claim_view(ctx, &c))
        .collect();

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(run.company_id),
            table_name: "ai_inspector",
            record_id: run_id,
            action: "read",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    Ok(AiAnswerInspection {
        run_id,
        run_status: run.status.clone(),
        gate_result,
        validations,
        claims,
    })
}

// ── Request reducers ─────────────────────────────────────────────────────────

const VIEW_KIND_CLAIM: &str = "claim";
const VIEW_KIND_DECISION: &str = "decision";
const VIEW_KIND_COMPONENT: &str = "component";
const VIEW_KIND_ANSWER: &str = "answer";
const MAX_CORRELATION_LEN: usize = 256;
const MAX_PAYLOAD_LEN: usize = 256_000;

fn validate_correlation(correlation: &str) -> Result<String, String> {
    let trimmed = correlation.trim();
    if trimmed.is_empty() {
        return Err("correlation is required".to_string());
    }
    if trimmed.len() > MAX_CORRELATION_LEN {
        return Err("correlation exceeds 256 characters".to_string());
    }
    Ok(trimmed.to_string())
}

fn write_inspector_result(
    ctx: &ReducerContext,
    organization_id: u64,
    correlation: &str,
    view_kind: &str,
    payload_json: &str,
) -> Result<(), String> {
    if payload_json.len() > MAX_PAYLOAD_LEN {
        return Err("inspector payload exceeds size limit".to_string());
    }

    // Replace any prior result for this caller/correlation so the table stays
    // bounded and the read after the request sees exactly one row.
    let prior_ids: Vec<u64> = ctx
        .db
        .ai_inspector_result()
        .iter()
        .filter(|r| r.caller_identity == ctx.sender() && r.correlation == correlation)
        .map(|r| r.id)
        .collect();
    for id in prior_ids {
        ctx.db.ai_inspector_result().id().delete(&id);
    }

    ctx.db.ai_inspector_result().insert(AiInspectorResult {
        id: AUTO_INC_SENTINEL,
        organization_id,
        caller_identity: ctx.sender(),
        correlation: correlation.to_string(),
        view_kind: view_kind.to_string(),
        payload_json: payload_json.to_string(),
        create_date: ctx.timestamp,
    });
    Ok(())
}

fn serialize_inspection_view(view: &serde_json::Value) -> Result<String, String> {
    serde_json::to_string(view).map_err(|e| format!("failed to serialize inspection view: {e}"))
}

/// Request an inspected claim view.
///
/// The result is written to `AiInspectorResult` under the supplied correlation
/// for the caller to read through the normal API boundary.
#[reducer]
pub fn request_inspect_ai_claim(
    ctx: &ReducerContext,
    organization_id: u64,
    correlation: String,
    claim_id: u64,
) -> Result<(), String> {
    let correlation = validate_correlation(&correlation)?;
    let view = inspect_ai_claim(ctx, organization_id, claim_id)?;
    let payload = serialize_inspection_view(&view.to_json())?;
    write_inspector_result(
        ctx,
        organization_id,
        &correlation,
        VIEW_KIND_CLAIM,
        &payload,
    )
}

/// Request an inspected decision view.
#[reducer]
pub fn request_inspect_ai_decision(
    ctx: &ReducerContext,
    organization_id: u64,
    correlation: String,
    decision_id: u64,
) -> Result<(), String> {
    let correlation = validate_correlation(&correlation)?;
    let view = inspect_ai_decision(ctx, organization_id, decision_id)?;
    let payload = serialize_inspection_view(&view.to_json())?;
    write_inspector_result(
        ctx,
        organization_id,
        &correlation,
        VIEW_KIND_DECISION,
        &payload,
    )
}

/// Request an inspected artifact-component view.
#[reducer]
pub fn request_inspect_ai_artifact_component(
    ctx: &ReducerContext,
    organization_id: u64,
    correlation: String,
    component_id: u64,
) -> Result<(), String> {
    let correlation = validate_correlation(&correlation)?;
    let view = inspect_ai_artifact_component(ctx, organization_id, component_id)?;
    let payload = serialize_inspection_view(&view.to_json())?;
    write_inspector_result(
        ctx,
        organization_id,
        &correlation,
        VIEW_KIND_COMPONENT,
        &payload,
    )
}

/// Request an inspected agent-run answer view.
#[reducer]
pub fn request_inspect_ai_answer(
    ctx: &ReducerContext,
    organization_id: u64,
    correlation: String,
    run_id: u64,
) -> Result<(), String> {
    let correlation = validate_correlation(&correlation)?;
    let view = inspect_ai_answer(ctx, organization_id, run_id)?;
    let payload = serialize_inspection_view(&view.to_json())?;
    write_inspector_result(
        ctx,
        organization_id,
        &correlation,
        VIEW_KIND_ANSWER,
        &payload,
    )
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summarize_truncates_long_text() {
        let text = "a".repeat(500);
        let s = summarize(&text);
        assert_eq!(s.len(), SUMMARY_LEN);
        assert!(text.starts_with(&s));
    }

    #[test]
    fn parse_id_array_tolerates_empty() {
        assert_eq!(parse_id_array("").unwrap(), Vec::<u64>::new());
        assert_eq!(parse_id_array("[]").unwrap(), Vec::<u64>::new());
        assert_eq!(parse_id_array("[1, 2, 3]").unwrap(), vec![1, 2, 3]);
    }
}
