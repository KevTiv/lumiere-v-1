//! AIH-14: discussion decisions and component lineage.
//!
//! ```text
//! SourcePassage -> Claim/Concept -> Decision -> ArtifactComponent
//! ```
//!
//! This module persists the middle and right of that chain. It records
//! *observable* design justification only — a bounded rationale, the
//! alternatives considered, the adaptations made and the assumptions relied
//! on. It never stores model reasoning traces.
//!
//! Rules that hold for every reducer here:
//!
//! - Records are revised by writing a new row that names what it supersedes;
//!   nothing is edited in place except review/status fields, so accepted,
//!   corrected and superseded revisions are all preserved.
//! - A reference to another row must be in the same organization and, for a
//!   company-scoped source, the same company. A new dependency on withdrawn,
//!   superseded or restricted evidence is denied.
//! - A claim's verification method may be `none`, `deterministic` or
//!   `model_assisted` when recorded. `human_reviewed` is only produced by
//!   `review_ai_evidence_claim`, by an authorized reviewer. A model verdict
//!   never stands in for that review or for domain approval on a decision.
//! - A component is bound to at least one *accepted decision*. A bibliography
//!   — claims and sources with no decision linking them to the component —
//!   does not satisfy a binding.
//! - Editing or forking a component creates a new version with parent
//!   lineage and marks its links `changed`; a historical link is never
//!   claimed to still support changed code until a reviewer confirms it.
//!
//! Every reference is also written as a reverse-dependency edge (see
//! `evidence_dependency`) so a later source change can find and flag what
//! rests on it.

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::ai::evidence_common::{
    is_sha256_hex, require_len, require_one_of, require_opt_len, validate_id_list, validate_tags,
    validate_text_list,
};
use crate::ai::evidence_dependency::{
    escalate_dependents, link_dependency, require_dependencies_usable, DependentKind, Requirement,
    Severity, UpstreamKind,
};
use crate::ai::evidence_source::{ai_evidence_contribution, require_passage_referencable};
use crate::core::organization::require_company_in_organization;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

const MAX_STATEMENT_LEN: usize = 4_000;
const MAX_RATIONALE_LEN: usize = 2_000;
const MAX_TITLE_LEN: usize = 256;
const MAX_REF_LEN: usize = 256;
const MAX_NOTE_LEN: usize = 2_000;

pub const CLAIM_KINDS: [&str; 7] = [
    "quotation",
    "paraphrase",
    "sourced_fact",
    "calculation",
    "inference",
    "recommendation",
    "concept",
];
/// Kinds whose whole point is that a passage says it.
const CLAIMS_NEEDING_PASSAGE: [&str; 3] = ["quotation", "paraphrase", "sourced_fact"];
/// Methods a caller may record. `human_reviewed` is deliberately absent.
pub const RECORDABLE_VERIFICATION_METHODS: [&str; 3] = ["none", "deterministic", "model_assisted"];
pub const VERIFICATION_OUTCOMES: [&str; 4] =
    ["unverified", "supported", "unsupported", "qualified"];
pub const DECISION_REVIEW_OUTCOMES: [&str; 2] = ["accepted", "rejected"];
pub const COMPONENT_KINDS: [&str; 4] =
    ["workflow_step", "formula", "code_range", "document_section"];

pub const CLAIM_CURRENT: &str = "current";
pub const CLAIM_SUPERSEDED: &str = "superseded";
pub const CLAIM_NEEDS_REVIEW: &str = "needs_review";

pub const DECISION_PROPOSED: &str = "proposed";
pub const DECISION_ACCEPTED: &str = "accepted";
pub const DECISION_REJECTED: &str = "rejected";
pub const DECISION_SUPERSEDED: &str = "superseded";
pub const DECISION_NEEDS_REVIEW: &str = "needs_review";

pub const LINK_LINKED: &str = "linked";
pub const LINK_CHANGED: &str = "changed";
pub const LINK_UNRESOLVED: &str = "unresolved";

pub const COMPONENT_CURRENT: &str = "current";
pub const COMPONENT_SUPERSEDED: &str = "superseded";

// ── Tables ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_evidence_claim,
    index(accessor = ai_evidence_claim_by_org, btree(columns = [organization_id]))
)]
pub struct AiEvidenceClaim {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    /// quotation | paraphrase | sourced_fact | calculation | inference |
    /// recommendation | concept
    pub kind: String,
    pub statement: String,
    pub supporting_passage_ids: Vec<u64>,
    pub contradicting_passage_ids: Vec<u64>,
    /// Reference to a deterministic calculation (required for `calculation`).
    pub calculation_ref: Option<String>,
    /// Assumptions stated apart from the statement itself.
    pub assumptions: Vec<String>,
    pub contribution_id: Option<u64>,
    /// none | deterministic | model_assisted | human_reviewed
    pub verification_method: String,
    /// unverified | supported | unsupported | qualified
    pub verification_outcome: String,
    pub verification_note: Option<String>,
    pub supersedes_claim_id: Option<u64>,
    /// current | superseded | needs_review
    pub status: String,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_evidence_decision,
    index(accessor = ai_evidence_decision_by_org, btree(columns = [organization_id]))
)]
pub struct AiEvidenceDecision {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub title: String,
    /// The concepts/claims this decision adopts. Never empty.
    pub adopted_claim_ids: Vec<u64>,
    pub supporting_claim_ids: Vec<u64>,
    pub applicability: Vec<String>,
    pub alternatives: Vec<String>,
    pub adaptations: Vec<String>,
    pub assumptions: Vec<String>,
    /// Bounded, observable justification — not a reasoning trace.
    pub rationale: String,
    pub contribution_id: Option<u64>,
    pub supersedes_decision_id: Option<u64>,
    /// proposed | accepted | rejected | superseded | needs_review
    pub status: String,
    pub reviewer_uid: Option<Identity>,
    pub reviewed_at: Option<Timestamp>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_artifact_component,
    index(accessor = ai_artifact_component_by_org, btree(columns = [organization_id])),
    index(
        accessor = ai_artifact_component_by_artifact,
        btree(columns = [organization_id, artifact_ref])
    )
)]
pub struct AiArtifactComponent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    /// Opaque reference to the parent artifact (workflow, script, document).
    /// The artifact's bytes live in the authorized artifact/file store.
    pub artifact_ref: String,
    /// Stable id of the component within its artifact.
    pub component_key: String,
    /// workflow_step | formula | code_range | document_section
    pub component_kind: String,
    pub version: u32,
    pub content_hash: String,
    pub parent_component_id: Option<u64>,
    pub forked_from_artifact_ref: Option<String>,
    pub decision_ids: Vec<u64>,
    pub claim_ids: Vec<u64>,
    /// linked | changed | unresolved
    pub link_state: String,
    /// current | superseded
    pub status: String,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordAiEvidenceClaimParams {
    pub kind: String,
    pub statement: String,
    pub supporting_passage_ids: Vec<u64>,
    pub contradicting_passage_ids: Vec<u64>,
    pub calculation_ref: Option<String>,
    pub assumptions: Vec<String>,
    pub contribution_id: Option<u64>,
    pub verification_method: String,
    pub verification_outcome: String,
    pub verification_note: Option<String>,
    pub supersedes_claim_id: Option<u64>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ReviewAiEvidenceClaimParams {
    /// supported | unsupported | qualified
    pub verification_outcome: String,
    pub verification_note: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordAiEvidenceDecisionParams {
    pub title: String,
    pub adopted_claim_ids: Vec<u64>,
    pub supporting_claim_ids: Vec<u64>,
    pub applicability: Vec<String>,
    pub alternatives: Vec<String>,
    pub adaptations: Vec<String>,
    pub assumptions: Vec<String>,
    pub rationale: String,
    pub contribution_id: Option<u64>,
    pub supersedes_decision_id: Option<u64>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ReviewAiEvidenceDecisionParams {
    /// accepted | rejected
    pub outcome: String,
    pub note: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct BindAiArtifactComponentParams {
    pub artifact_ref: String,
    pub component_key: String,
    pub component_kind: String,
    pub content_hash: String,
    pub decision_ids: Vec<u64>,
    pub claim_ids: Vec<u64>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ReviseAiArtifactComponentParams {
    pub content_hash: String,
    /// Set to fork the component into another artifact (or key); `None` is an
    /// in-place edit that supersedes the parent version.
    pub fork_artifact_ref: Option<String>,
    pub fork_component_key: Option<String>,
    /// `None` keeps the parent's links (still marked for review if the
    /// content changed); `Some` replaces them.
    pub decision_ids: Option<Vec<u64>>,
    pub claim_ids: Option<Vec<u64>>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ReviewAiArtifactComponentLinksParams {
    /// confirmed | unresolved
    pub outcome: String,
    pub note: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Record a claim or concept with the passages that support or contradict it.
#[reducer]
pub fn record_ai_evidence_claim(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: RecordAiEvidenceClaimParams,
) -> Result<(), String> {
    if organization_id == 0 {
        return Err("organization_id must be nonzero".to_string());
    }
    check_permission(ctx, organization_id, "ai_evidence_claim", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    validate_claim_params(&params)?;

    for passage_id in &params.supporting_passage_ids {
        require_passage_referencable(ctx, organization_id, company_id, *passage_id, true)?;
    }
    for passage_id in &params.contradicting_passage_ids {
        require_passage_referencable(ctx, organization_id, company_id, *passage_id, false)?;
    }
    if let Some(contribution_id) = params.contribution_id {
        require_contribution(ctx, organization_id, company_id, contribution_id)?;
    }
    let superseded = match params.supersedes_claim_id {
        Some(old_id) => Some(load_claim(ctx, organization_id, company_id, old_id)?),
        None => None,
    };

    let row = ctx.db.ai_evidence_claim().insert(AiEvidenceClaim {
        id: 0,
        organization_id,
        company_id,
        kind: params.kind,
        statement: params.statement,
        supporting_passage_ids: params.supporting_passage_ids,
        contradicting_passage_ids: params.contradicting_passage_ids,
        calculation_ref: params.calculation_ref,
        assumptions: params.assumptions,
        contribution_id: params.contribution_id,
        verification_method: params.verification_method,
        verification_outcome: params.verification_outcome,
        verification_note: params.verification_note,
        supersedes_claim_id: params.supersedes_claim_id,
        status: CLAIM_CURRENT.to_string(),
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    for passage_id in &row.supporting_passage_ids {
        link_dependency(
            ctx,
            organization_id,
            company_id,
            UpstreamKind::Passage,
            *passage_id,
            DependentKind::Claim,
            row.id,
            Requirement::Required,
        );
    }

    if let Some(old) = superseded {
        let old_id = old.id;
        ctx.db.ai_evidence_claim().id().update(AiEvidenceClaim {
            status: CLAIM_SUPERSEDED.to_string(),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..old
        });
        // Work that adopted the old wording no longer rests on a current claim.
        escalate_dependents(
            ctx,
            organization_id,
            company_id,
            UpstreamKind::Claim,
            &[old_id],
            Severity::NeedsReview,
            None,
        )?;
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_evidence_claim",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "kind": row.kind,
                    "verification_method": row.verification_method,
                    "verification_outcome": row.verification_outcome,
                    "supersedes_claim_id": row.supersedes_claim_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["kind".to_string(), "statement".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// A human reviewer's verdict on a claim. This is the only path that records
/// `human_reviewed`; it needs its own permission and replaces any earlier
/// automated verdict without erasing it from the audit trail.
#[reducer]
pub fn review_ai_evidence_claim(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    claim_id: u64,
    params: ReviewAiEvidenceClaimParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_evidence_claim", "update")?;
    let claim = load_claim(ctx, organization_id, company_id, claim_id)?;
    require_one_of(
        "verification_outcome",
        &params.verification_outcome,
        &["supported", "unsupported", "qualified"],
    )?;
    require_opt_len("verification_note", &params.verification_note, MAX_NOTE_LEN)?;
    if claim.status == CLAIM_SUPERSEDED {
        return Err("a superseded claim cannot be reviewed; review its revision".to_string());
    }
    if params.verification_outcome == "supported" {
        require_claim_grounding(&claim)?;
        // A claim resting on withdrawn evidence cannot be re-blessed here.
        require_dependencies_usable(ctx, organization_id, DependentKind::Claim, claim_id)?;
    }

    let old = serde_json::json!({
        "verification_method": claim.verification_method,
        "verification_outcome": claim.verification_outcome,
        "status": claim.status,
    });
    let status = if params.verification_outcome == "unsupported" {
        CLAIM_NEEDS_REVIEW.to_string()
    } else {
        CLAIM_CURRENT.to_string()
    };
    ctx.db.ai_evidence_claim().id().update(AiEvidenceClaim {
        verification_method: "human_reviewed".to_string(),
        verification_outcome: params.verification_outcome.clone(),
        verification_note: params.verification_note,
        status: status.clone(),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..claim
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_evidence_claim",
            record_id: claim_id,
            action: "UPDATE",
            old_values: Some(old.to_string()),
            new_values: Some(
                serde_json::json!({
                    "verification_method": "human_reviewed",
                    "verification_outcome": params.verification_outcome,
                    "status": status,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "verification_method".to_string(),
                "verification_outcome".to_string(),
                "status".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

/// Record a decision that adopts one or more claims. It starts `proposed`;
/// `review_ai_evidence_decision` accepts or rejects it.
#[reducer]
pub fn record_ai_evidence_decision(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: RecordAiEvidenceDecisionParams,
) -> Result<(), String> {
    if organization_id == 0 {
        return Err("organization_id must be nonzero".to_string());
    }
    check_permission(ctx, organization_id, "ai_evidence_decision", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    validate_decision_params(&params)?;

    for claim_id in params
        .adopted_claim_ids
        .iter()
        .chain(&params.supporting_claim_ids)
    {
        let claim = load_claim(ctx, organization_id, company_id, *claim_id)?;
        if claim.status != CLAIM_CURRENT {
            return Err(format!(
                "Claim {claim_id} is {} and cannot be adopted",
                claim.status
            ));
        }
    }
    if let Some(contribution_id) = params.contribution_id {
        let contribution = require_contribution(ctx, organization_id, company_id, contribution_id)?;
        if contribution.contributor_kind == "user" && contribution.contributor_uid != ctx.sender() {
            return Err(
                "a user decision must use the authenticated caller's contribution".to_string(),
            );
        }
        if let Some(existing) = ctx
            .db
            .ai_evidence_decision()
            .ai_evidence_decision_by_org()
            .filter(&organization_id)
            .find(|row| {
                row.company_id == company_id && row.contribution_id == Some(contribution_id)
            })
        {
            if decision_matches_params(&existing, &params) {
                return Ok(());
            }
            return Err("the contribution already records a different decision".to_string());
        }
    }
    let superseded = match params.supersedes_decision_id {
        Some(old_id) => Some(load_decision(ctx, organization_id, company_id, old_id)?),
        None => None,
    };

    let row = ctx.db.ai_evidence_decision().insert(AiEvidenceDecision {
        id: 0,
        organization_id,
        company_id,
        title: params.title,
        adopted_claim_ids: params.adopted_claim_ids,
        supporting_claim_ids: params.supporting_claim_ids,
        applicability: params.applicability,
        alternatives: params.alternatives,
        adaptations: params.adaptations,
        assumptions: params.assumptions,
        rationale: params.rationale,
        contribution_id: params.contribution_id,
        supersedes_decision_id: params.supersedes_decision_id,
        status: DECISION_PROPOSED.to_string(),
        reviewer_uid: None,
        reviewed_at: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    for claim_id in &row.adopted_claim_ids {
        link_dependency(
            ctx,
            organization_id,
            company_id,
            UpstreamKind::Claim,
            *claim_id,
            DependentKind::Decision,
            row.id,
            Requirement::Required,
        );
    }
    for claim_id in &row.supporting_claim_ids {
        link_dependency(
            ctx,
            organization_id,
            company_id,
            UpstreamKind::Claim,
            *claim_id,
            DependentKind::Decision,
            row.id,
            Requirement::Discretionary,
        );
    }

    if let Some(old) = superseded {
        let old_id = old.id;
        ctx.db
            .ai_evidence_decision()
            .id()
            .update(AiEvidenceDecision {
                status: DECISION_SUPERSEDED.to_string(),
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..old
            });
        // Components bound to the old decision must be re-reviewed against
        // its replacement rather than silently keeping the old justification.
        escalate_dependents(
            ctx,
            organization_id,
            company_id,
            UpstreamKind::Decision,
            &[old_id],
            Severity::NeedsReview,
            None,
        )?;
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_evidence_decision",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "title": row.title,
                    "adopted_claim_ids": row.adopted_claim_ids,
                    "supersedes_decision_id": row.supersedes_decision_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["title".to_string(), "adopted_claim_ids".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Accept or reject a proposed (or needs-review) decision. Acceptance is a
/// named reviewer's act; it requires every adopted claim to be current and
/// not judged unsupported, and every required dependency to be valid.
#[reducer]
pub fn review_ai_evidence_decision(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    decision_id: u64,
    params: ReviewAiEvidenceDecisionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_evidence_decision", "update")?;
    let decision = load_decision(ctx, organization_id, company_id, decision_id)?;
    require_one_of("outcome", &params.outcome, &DECISION_REVIEW_OUTCOMES)?;
    require_opt_len("note", &params.note, MAX_NOTE_LEN)?;
    if decision.status != DECISION_PROPOSED && decision.status != DECISION_NEEDS_REVIEW {
        return Err(format!("a {} decision cannot be reviewed", decision.status));
    }

    if params.outcome == "accepted" {
        for claim_id in &decision.adopted_claim_ids {
            let claim = load_claim(ctx, organization_id, company_id, *claim_id)?;
            if claim.status != CLAIM_CURRENT {
                return Err(format!("Claim {claim_id} is {}", claim.status));
            }
            if claim.verification_outcome == "unsupported" {
                return Err(format!("Claim {claim_id} was judged unsupported"));
            }
        }
        require_dependencies_usable(ctx, organization_id, DependentKind::Decision, decision_id)?;
    }

    let old_status = decision.status.clone();
    let status = if params.outcome == "accepted" {
        DECISION_ACCEPTED
    } else {
        DECISION_REJECTED
    };
    ctx.db
        .ai_evidence_decision()
        .id()
        .update(AiEvidenceDecision {
            status: status.to_string(),
            reviewer_uid: Some(ctx.sender()),
            reviewed_at: Some(ctx.timestamp),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..decision
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_evidence_decision",
            record_id: decision_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "status": old_status }).to_string()),
            new_values: Some(serde_json::json!({ "status": status }).to_string()),
            changed_fields: vec!["status".to_string(), "reviewer_uid".to_string()],
            metadata: params
                .note
                .map(|note| serde_json::json!({ "note": note }).to_string()),
        },
    );
    Ok(())
}

/// Bind a component of a generated artifact to the accepted decisions that
/// justify it. Claims may be linked directly as well, but a component cannot
/// be bound by claims alone.
#[reducer]
pub fn bind_ai_artifact_component(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: BindAiArtifactComponentParams,
) -> Result<(), String> {
    bind_ai_artifact_component_inner(ctx, organization_id, company_id, params)
}

pub(crate) fn bind_ai_artifact_component_inner(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: BindAiArtifactComponentParams,
) -> Result<(), String> {
    if organization_id == 0 {
        return Err("organization_id must be nonzero".to_string());
    }
    check_permission(ctx, organization_id, "ai_artifact_component", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    validate_component_links(&params.decision_ids, &params.claim_ids)?;
    validate_component_identity(
        &params.artifact_ref,
        &params.component_key,
        &params.content_hash,
    )?;
    require_one_of("component_kind", &params.component_kind, &COMPONENT_KINDS)?;

    if find_current_component(
        ctx,
        organization_id,
        &params.artifact_ref,
        &params.component_key,
    )
    .is_some()
    {
        return Err("component is already bound; revise it instead".to_string());
    }
    require_bindable_links(
        ctx,
        organization_id,
        company_id,
        &params.decision_ids,
        &params.claim_ids,
    )?;

    let row = ctx.db.ai_artifact_component().insert(AiArtifactComponent {
        id: 0,
        organization_id,
        company_id,
        artifact_ref: params.artifact_ref,
        component_key: params.component_key,
        component_kind: params.component_kind,
        version: 1,
        content_hash: params.content_hash,
        parent_component_id: None,
        forked_from_artifact_ref: None,
        decision_ids: params.decision_ids,
        claim_ids: params.claim_ids,
        link_state: LINK_LINKED.to_string(),
        status: COMPONENT_CURRENT.to_string(),
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });
    register_component_links(ctx, &row);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_artifact_component",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(component_audit_json(&row)),
            changed_fields: vec!["artifact_ref".to_string(), "component_key".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Edit or fork a bound component. The result is a new version carrying
/// parent lineage; its links are marked `changed` when the content or links
/// moved, and stay `unresolved` if the parent's already were.
#[reducer]
pub fn revise_ai_artifact_component(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    component_id: u64,
    params: ReviseAiArtifactComponentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_artifact_component", "create")?;
    let parent = load_component(ctx, organization_id, company_id, component_id)?;
    if !is_sha256_hex(&params.content_hash) {
        return Err("content_hash must be a lowercase hex SHA-256".to_string());
    }
    if parent.status != COMPONENT_CURRENT {
        return Err("only the current version of a component can be revised".to_string());
    }
    if params.fork_component_key.is_some() && params.fork_artifact_ref.is_none() {
        return Err("a fork must name the artifact it forks into".to_string());
    }

    let is_fork = params.fork_artifact_ref.is_some();
    let artifact_ref = params
        .fork_artifact_ref
        .clone()
        .unwrap_or_else(|| parent.artifact_ref.clone());
    let component_key = params
        .fork_component_key
        .clone()
        .unwrap_or_else(|| parent.component_key.clone());
    validate_component_identity(&artifact_ref, &component_key, &params.content_hash)?;
    if is_fork
        && find_current_component(ctx, organization_id, &artifact_ref, &component_key).is_some()
    {
        return Err("the fork target already has a current component with that key".to_string());
    }

    let decision_ids = params
        .decision_ids
        .clone()
        .unwrap_or_else(|| parent.decision_ids.clone());
    let claim_ids = params
        .claim_ids
        .clone()
        .unwrap_or_else(|| parent.claim_ids.clone());
    validate_component_links(&decision_ids, &claim_ids)?;
    let links_changed = decision_ids != parent.decision_ids || claim_ids != parent.claim_ids;
    let content_changed = params.content_hash != parent.content_hash;
    if !is_fork && !links_changed && !content_changed {
        return Err("nothing to revise: content and links are unchanged".to_string());
    }
    // Only links the caller newly supplies must be accepted now; inherited
    // links are re-examined at review, so a stale one cannot block recording
    // the edit that makes it stale.
    if links_changed {
        require_bindable_links(ctx, organization_id, company_id, &decision_ids, &claim_ids)?;
    }

    let link_state = next_link_state(&parent.link_state, content_changed, links_changed);
    let version = if is_fork { 1 } else { parent.version + 1 };
    let row = ctx.db.ai_artifact_component().insert(AiArtifactComponent {
        id: 0,
        organization_id,
        company_id,
        artifact_ref,
        component_key,
        component_kind: parent.component_kind.clone(),
        version,
        content_hash: params.content_hash,
        parent_component_id: Some(parent.id),
        forked_from_artifact_ref: if is_fork {
            Some(parent.artifact_ref.clone())
        } else {
            None
        },
        decision_ids,
        claim_ids,
        link_state,
        status: COMPONENT_CURRENT.to_string(),
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });
    register_component_links(ctx, &row);

    if !is_fork {
        ctx.db
            .ai_artifact_component()
            .id()
            .update(AiArtifactComponent {
                status: COMPONENT_SUPERSEDED.to_string(),
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..parent
            });
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_artifact_component",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(component_audit_json(&row)),
            changed_fields: vec!["version".to_string(), "link_state".to_string()],
            metadata: Some(
                serde_json::json!({ "parent_component_id": component_id, "fork": is_fork })
                    .to_string(),
            ),
        },
    );
    Ok(())
}

/// A reviewer confirms (or refuses to confirm) that a component's links still
/// support its current content. Confirmation re-checks the whole chain:
/// every decision accepted, every claim current, every dependency valid.
#[reducer]
pub fn review_ai_artifact_component_links(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    component_id: u64,
    params: ReviewAiArtifactComponentLinksParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_artifact_component", "update")?;
    let component = load_component(ctx, organization_id, company_id, component_id)?;
    require_one_of("outcome", &params.outcome, &["confirmed", "unresolved"])?;
    require_opt_len("note", &params.note, MAX_NOTE_LEN)?;
    if component.status != COMPONENT_CURRENT {
        return Err("only the current version of a component can be reviewed".to_string());
    }

    let link_state = if params.outcome == "confirmed" {
        require_bindable_links(
            ctx,
            organization_id,
            company_id,
            &component.decision_ids,
            &component.claim_ids,
        )?;
        require_dependencies_usable(ctx, organization_id, DependentKind::Component, component_id)?;
        LINK_LINKED
    } else {
        LINK_UNRESOLVED
    };

    let old_state = component.link_state.clone();
    ctx.db
        .ai_artifact_component()
        .id()
        .update(AiArtifactComponent {
            link_state: link_state.to_string(),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..component
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_artifact_component",
            record_id: component_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "link_state": old_state }).to_string()),
            new_values: Some(serde_json::json!({ "link_state": link_state }).to_string()),
            changed_fields: vec!["link_state".to_string()],
            metadata: params
                .note
                .map(|note| serde_json::json!({ "note": note }).to_string()),
        },
    );
    Ok(())
}

// ── Helpers ──────────────────────────────────────────────────────────────────

pub(crate) fn load_claim(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    claim_id: u64,
) -> Result<AiEvidenceClaim, String> {
    let claim = ctx
        .db
        .ai_evidence_claim()
        .id()
        .find(&claim_id)
        .ok_or_else(|| format!("Claim {claim_id} not found"))?;
    if claim.organization_id != organization_id || claim.company_id != company_id {
        return Err(format!(
            "Claim {claim_id} does not belong to this organization/company"
        ));
    }
    Ok(claim)
}

pub(crate) fn load_decision(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    decision_id: u64,
) -> Result<AiEvidenceDecision, String> {
    let decision = ctx
        .db
        .ai_evidence_decision()
        .id()
        .find(&decision_id)
        .ok_or_else(|| format!("Decision {decision_id} not found"))?;
    if decision.organization_id != organization_id || decision.company_id != company_id {
        return Err(format!(
            "Decision {decision_id} does not belong to this organization/company"
        ));
    }
    Ok(decision)
}

pub(crate) fn load_component(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    component_id: u64,
) -> Result<AiArtifactComponent, String> {
    let component = ctx
        .db
        .ai_artifact_component()
        .id()
        .find(&component_id)
        .ok_or("Component not found")?;
    if component.organization_id != organization_id || component.company_id != company_id {
        return Err("Component does not belong to this organization/company".to_string());
    }
    Ok(component)
}

fn find_current_component(
    ctx: &ReducerContext,
    organization_id: u64,
    artifact_ref: &str,
    component_key: &str,
) -> Option<AiArtifactComponent> {
    ctx.db
        .ai_artifact_component()
        .ai_artifact_component_by_artifact()
        .filter((&organization_id, &artifact_ref.to_string()))
        .find(|row| row.component_key == component_key && row.status == COMPONENT_CURRENT)
}

fn require_contribution(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    contribution_id: u64,
) -> Result<crate::ai::evidence_source::AiEvidenceContribution, String> {
    let contribution = ctx
        .db
        .ai_evidence_contribution()
        .id()
        .find(&contribution_id)
        .ok_or("Contribution not found")?;
    if contribution.organization_id != organization_id || contribution.company_id != company_id {
        return Err("Contribution does not belong to this organization/company".to_string());
    }
    Ok(contribution)
}

fn decision_matches_params(
    row: &AiEvidenceDecision,
    params: &RecordAiEvidenceDecisionParams,
) -> bool {
    row.title == params.title
        && row.adopted_claim_ids == params.adopted_claim_ids
        && row.supporting_claim_ids == params.supporting_claim_ids
        && row.applicability == params.applicability
        && row.alternatives == params.alternatives
        && row.adaptations == params.adaptations
        && row.assumptions == params.assumptions
        && row.rationale == params.rationale
        && row.contribution_id == params.contribution_id
        && row.supersedes_decision_id == params.supersedes_decision_id
}

/// Links a component may be newly bound to: accepted decisions and current
/// claims. Anything else is a bibliography or stale work, not a justification.
fn require_bindable_links(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    decision_ids: &[u64],
    claim_ids: &[u64],
) -> Result<(), String> {
    for decision_id in decision_ids {
        let decision = load_decision(ctx, organization_id, company_id, *decision_id)?;
        if decision.status != DECISION_ACCEPTED {
            return Err(format!(
                "Decision {decision_id} is {} and cannot justify a component",
                decision.status
            ));
        }
    }
    for claim_id in claim_ids {
        let claim = load_claim(ctx, organization_id, company_id, *claim_id)?;
        if claim.status != CLAIM_CURRENT {
            return Err(format!("Claim {claim_id} is {}", claim.status));
        }
    }
    Ok(())
}

fn register_component_links(ctx: &ReducerContext, component: &AiArtifactComponent) {
    for decision_id in &component.decision_ids {
        link_dependency(
            ctx,
            component.organization_id,
            component.company_id,
            UpstreamKind::Decision,
            *decision_id,
            DependentKind::Component,
            component.id,
            Requirement::Required,
        );
    }
    for claim_id in &component.claim_ids {
        link_dependency(
            ctx,
            component.organization_id,
            component.company_id,
            UpstreamKind::Claim,
            *claim_id,
            DependentKind::Component,
            component.id,
            Requirement::Required,
        );
    }
}

fn component_audit_json(component: &AiArtifactComponent) -> String {
    serde_json::json!({
        "artifact_ref": component.artifact_ref,
        "component_key": component.component_key,
        "version": component.version,
        "content_hash": component.content_hash,
        "link_state": component.link_state,
        "decision_ids": component.decision_ids,
    })
    .to_string()
}

/// A revision's link state. Severity only rises: `unresolved` is never
/// laundered into `changed`, and unchanged content keeps the parent's state.
pub(crate) fn next_link_state(
    parent_state: &str,
    content_changed: bool,
    links_changed: bool,
) -> String {
    if parent_state == LINK_UNRESOLVED {
        LINK_UNRESOLVED
    } else if content_changed || links_changed {
        LINK_CHANGED
    } else {
        parent_state_or_changed(parent_state)
    }
    .to_string()
}

fn parent_state_or_changed(parent_state: &str) -> &'static str {
    match parent_state {
        LINK_LINKED => LINK_LINKED,
        _ => LINK_CHANGED,
    }
}

/// A claim may be recorded `supported` only when something grounds it: a
/// passage or a deterministic calculation reference.
fn require_claim_grounding(claim: &AiEvidenceClaim) -> Result<(), String> {
    if claim.supporting_passage_ids.is_empty() && claim.calculation_ref.is_none() {
        return Err(
            "a claim with no supporting passage or calculation cannot be marked supported"
                .to_string(),
        );
    }
    Ok(())
}

fn validate_claim_params(params: &RecordAiEvidenceClaimParams) -> Result<(), String> {
    require_one_of("kind", &params.kind, &CLAIM_KINDS)?;
    require_len("statement", &params.statement, MAX_STATEMENT_LEN)?;
    require_one_of(
        "verification_method",
        &params.verification_method,
        &RECORDABLE_VERIFICATION_METHODS,
    )?;
    require_one_of(
        "verification_outcome",
        &params.verification_outcome,
        &VERIFICATION_OUTCOMES,
    )?;
    require_opt_len("calculation_ref", &params.calculation_ref, MAX_REF_LEN)?;
    require_opt_len("verification_note", &params.verification_note, MAX_NOTE_LEN)?;
    validate_id_list("supporting_passage_ids", &params.supporting_passage_ids)?;
    validate_id_list(
        "contradicting_passage_ids",
        &params.contradicting_passage_ids,
    )?;
    validate_text_list("assumptions", &params.assumptions)?;
    if params
        .supporting_passage_ids
        .iter()
        .any(|id| params.contradicting_passage_ids.contains(id))
    {
        return Err("a passage cannot both support and contradict a claim".to_string());
    }
    if CLAIMS_NEEDING_PASSAGE.contains(&params.kind.as_str())
        && params.supporting_passage_ids.is_empty()
    {
        return Err(format!(
            "a {} needs at least one supporting passage",
            params.kind
        ));
    }
    if params.kind == "calculation" && params.calculation_ref.is_none() {
        return Err("a calculation claim needs a calculation reference".to_string());
    }
    if params.kind != "calculation" && params.calculation_ref.is_some() {
        return Err("only a calculation claim carries a calculation reference".to_string());
    }
    let grounded = !params.supporting_passage_ids.is_empty() || params.calculation_ref.is_some();
    if params.verification_outcome == "supported" && !grounded {
        return Err(
            "an ungrounded claim cannot be recorded supported; leave it unverified or qualified"
                .to_string(),
        );
    }
    if params.verification_method == "none" && params.verification_outcome != "unverified" {
        return Err("a claim with no verification method must be unverified".to_string());
    }
    Ok(())
}

fn validate_decision_params(params: &RecordAiEvidenceDecisionParams) -> Result<(), String> {
    require_len("title", &params.title, MAX_TITLE_LEN)?;
    require_len("rationale", &params.rationale, MAX_RATIONALE_LEN)?;
    if params.adopted_claim_ids.is_empty() {
        return Err("a decision must adopt at least one claim or concept".to_string());
    }
    validate_id_list("adopted_claim_ids", &params.adopted_claim_ids)?;
    validate_id_list("supporting_claim_ids", &params.supporting_claim_ids)?;
    if params
        .supporting_claim_ids
        .iter()
        .any(|id| params.adopted_claim_ids.contains(id))
    {
        return Err("a claim cannot be both adopted and merely supporting".to_string());
    }
    validate_tags("applicability", &params.applicability)?;
    validate_text_list("alternatives", &params.alternatives)?;
    validate_text_list("adaptations", &params.adaptations)?;
    validate_text_list("assumptions", &params.assumptions)?;
    Ok(())
}

fn validate_component_identity(
    artifact_ref: &str,
    component_key: &str,
    content_hash: &str,
) -> Result<(), String> {
    require_len("artifact_ref", artifact_ref, MAX_REF_LEN)?;
    require_len("component_key", component_key, MAX_REF_LEN)?;
    if !is_sha256_hex(content_hash) {
        return Err("content_hash must be a lowercase hex SHA-256".to_string());
    }
    Ok(())
}

/// A component needs at least one decision; claims alone are a bibliography.
fn validate_component_links(decision_ids: &[u64], claim_ids: &[u64]) -> Result<(), String> {
    if decision_ids.is_empty() {
        return Err(
            "a component must link to at least one decision; sources and claims alone are only a bibliography"
                .to_string(),
        );
    }
    validate_id_list("decision_ids", decision_ids)?;
    validate_id_list("claim_ids", claim_ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claim(kind: &str) -> RecordAiEvidenceClaimParams {
        RecordAiEvidenceClaimParams {
            kind: kind.into(),
            statement: "Depreciation is straight line over 5 years.".into(),
            supporting_passage_ids: vec![1],
            contradicting_passage_ids: vec![],
            calculation_ref: None,
            assumptions: vec![],
            contribution_id: None,
            verification_method: "deterministic".into(),
            verification_outcome: "supported".into(),
            verification_note: None,
            supersedes_claim_id: None,
        }
    }

    fn decision() -> RecordAiEvidenceDecisionParams {
        RecordAiEvidenceDecisionParams {
            title: "Adopt straight-line".into(),
            adopted_claim_ids: vec![1],
            supporting_claim_ids: vec![2],
            applicability: vec!["jurisdiction:US".into()],
            alternatives: vec!["declining balance".into()],
            adaptations: vec!["5y instead of 7y".into()],
            assumptions: vec![],
            rationale: "Matches company policy.".into(),
            contribution_id: None,
            supersedes_decision_id: None,
        }
    }

    #[test]
    fn recordable_methods_exclude_human_review() {
        assert!(!RECORDABLE_VERIFICATION_METHODS.contains(&"human_reviewed"));
        let mut params = claim("sourced_fact");
        params.verification_method = "human_reviewed".into();
        assert!(validate_claim_params(&params).is_err());
    }

    #[test]
    fn sourced_claims_need_a_passage() {
        for kind in CLAIMS_NEEDING_PASSAGE {
            let mut params = claim(kind);
            assert!(validate_claim_params(&params).is_ok(), "{kind}");
            params.supporting_passage_ids.clear();
            params.verification_outcome = "unverified".into();
            params.verification_method = "none".into();
            assert!(validate_claim_params(&params).is_err(), "{kind}");
        }
    }

    #[test]
    fn ungrounded_claims_cannot_be_supported() {
        let mut inference = claim("inference");
        inference.supporting_passage_ids.clear();
        assert!(validate_claim_params(&inference).is_err());
        inference.verification_outcome = "qualified".into();
        assert!(validate_claim_params(&inference).is_ok());
        inference.verification_outcome = "unverified".into();
        inference.verification_method = "none".into();
        assert!(validate_claim_params(&inference).is_ok());
    }

    #[test]
    fn calculations_carry_a_reference_and_only_calculations_do() {
        let mut calc = claim("calculation");
        calc.supporting_passage_ids.clear();
        assert!(validate_claim_params(&calc).is_err());
        calc.calculation_ref = Some("calc:depreciation@1".into());
        assert!(validate_claim_params(&calc).is_ok());

        let mut fact = claim("sourced_fact");
        fact.calculation_ref = Some("calc:x".into());
        assert!(validate_claim_params(&fact).is_err());
    }

    #[test]
    fn a_passage_cannot_both_support_and_contradict() {
        let mut params = claim("sourced_fact");
        params.contradicting_passage_ids = vec![1];
        assert!(validate_claim_params(&params).is_err());
    }

    #[test]
    fn decisions_must_adopt_something_and_stay_bounded() {
        assert!(validate_decision_params(&decision()).is_ok());

        let mut empty = decision();
        empty.adopted_claim_ids.clear();
        assert!(validate_decision_params(&empty).is_err());

        let mut overlap = decision();
        overlap.supporting_claim_ids = vec![1];
        assert!(validate_decision_params(&overlap).is_err());

        let mut long = decision();
        long.rationale = "x".repeat(MAX_RATIONALE_LEN + 1);
        assert!(validate_decision_params(&long).is_err());
    }

    #[test]
    fn a_bibliography_does_not_bind_a_component() {
        assert!(validate_component_links(&[], &[1, 2]).is_err());
        assert!(validate_component_links(&[3], &[]).is_ok());
        assert!(validate_component_links(&[3], &[1, 2]).is_ok());
    }

    #[test]
    fn link_state_only_rises() {
        // Content or links moved: never claimed to still support the code.
        assert_eq!(next_link_state("linked", true, false), "changed");
        assert_eq!(next_link_state("linked", false, true), "changed");
        // A fork with identical content and links keeps the parent's state.
        assert_eq!(next_link_state("linked", false, false), "linked");
        assert_eq!(next_link_state("changed", false, false), "changed");
        // Unresolved is never laundered into a milder state.
        assert_eq!(next_link_state("unresolved", true, true), "unresolved");
        assert_eq!(next_link_state("unresolved", false, false), "unresolved");
    }

    #[test]
    fn component_identity_needs_a_real_hash() {
        assert!(validate_component_identity("wf:1", "step-a", &"b".repeat(64)).is_ok());
        assert!(validate_component_identity("wf:1", "step-a", "nothex").is_err());
        assert!(validate_component_identity("", "step-a", &"b".repeat(64)).is_err());
    }
}
