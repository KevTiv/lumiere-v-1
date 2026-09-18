//! GP-06 (governed intelligence program): decision precedent foundation —
//! `docs/plans/decision-precedent-memory-layer.md`.
//!
//! Two durable tables:
//!
//! - `AiDecisionCase` — one immutable governed decision. Corrections are
//!   append-only: `correct_ai_decision_case` inserts a *new* row linked by
//!   `correction_of` and marks the original `superseded`; nothing ever
//!   overwrites `selected_json`/`material_constraints_json` on an existing
//!   row. Verification, outcome and status *are* independently settable
//!   after the fact (mirrors `ai/decision_events.rs`'s GP-05 pattern),
//!   because those are genuinely learned later — the decision facts
//!   themselves are not.
//! - `AiDecisionPattern` — a reviewed cluster of stable, repeated cases,
//!   the precedent-memory-layer's path toward deterministic graduation
//!   (plan §6). Candidate → reviewed → promoted → superseded, enforced as
//!   an explicit state machine, not free-form status writes.
//!
//! This module is additive only, same as every prior GP step: no reducer
//! here is called by production code yet. `ai-gateway`'s
//! `orchestrator::precedent` (GP-06's retrieval/ranking half) is
//! provider-neutral over an in-memory reference store today; binding it to
//! these tables is deferred until client bindings are regenerated.
//!
//! A rejected or superseded case is never silently treated as positive
//! precedent by the ai-gateway ranking layer (invariant #3); this module's
//! job is only to make that state durable and honest, not to rank it.

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::ai::decision_events::ai_intelligence_event;
use crate::ai::decision_type_registry::ai_decision_type_definition;
use crate::ai::run_review::ai_run_review;
use crate::ai::skills::ai_agent_run;
use crate::ai::spend::ai_provider_attempt;
use crate::helpers::check_permission;

const MAX_JSON_FIELD_LEN: usize = 256_000;
/// Statuses `set_ai_decision_case_status` may set directly. "superseded"
/// is reachable only through `correct_ai_decision_case`, so a supersession
/// always leaves a correction row behind.
const DIRECT_CASE_STATUSES: [&str; 5] =
    ["observed", "verified", "reviewed", "approved", "rejected"];
const VERIFICATION_STATUSES: [&str; 3] = ["verified", "requires_review", "failed"];
const OUTCOME_STATUSES: [&str; 4] = ["unknown", "success", "failure", "mixed"];
const PATTERN_STATUSES: [&str; 4] = ["candidate", "reviewed", "promoted", "superseded"];

// ── Tables ───────────────────────────────────────────────────────────────────

/// One immutable governed decision case.
#[derive(Clone, Debug)]
#[spacetimedb::table(
    accessor = ai_decision_case,
    public,
    index(
        accessor = ai_decision_case_by_org,
        btree(columns = [organization_id])
    ),
    index(
        accessor = ai_decision_case_by_run,
        btree(columns = [run_id])
    ),
    index(
        accessor = ai_decision_case_by_request_hash,
        btree(columns = [organization_id, request_hash])
    ),
    index(
        accessor = ai_decision_case_by_type,
        btree(columns = [organization_id, decision_type_name])
    )
)]
pub struct AiDecisionCase {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    /// The run this decision was made during. Required: every decision
    /// case traces back to a governed run, never a bare API write.
    pub run_id: u64,
    pub step_no: u32,
    pub decision_type_name: String,
    pub decision_type_version: u32,
    /// e.g. "skill:low_stock_reorder@3" — the program/skill + version this
    /// case ran under.
    pub program_ref: String,
    pub step_id: String,
    /// Deterministic request hash (GP-01) used for replay idempotency,
    /// same contract as `ai_intelligence_event.request_hash`.
    pub request_hash: String,
    pub context_fingerprint: String,
    pub material_constraints_json: String,
    pub selected_json: String,
    pub confidence: Option<f64>,
    pub provider_attempt_id: Option<u64>,
    /// JSON array of prior `AiDecisionCase` ids that materially informed
    /// this one (the accepted proposal's precedent refs).
    pub precedent_refs: Vec<u64>,
    pub verification_status: Option<String>,
    pub verification_reason: Option<String>,
    /// "unknown" | "success" | "failure" | "mixed"
    pub outcome_status: String,
    pub outcome_json: Option<String>,
    /// "observed" | "verified" | "reviewed" | "approved" | "rejected" | "superseded"
    pub status: String,
    /// Set only when this row is itself a correction of a prior case.
    pub correction_of: Option<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

/// A reviewed cluster of stable, repeated decisions — the precedent-memory
/// layer's path toward deterministic graduation (plan §6).
#[derive(Clone, Debug)]
#[spacetimedb::table(
    accessor = ai_decision_pattern,
    public,
    index(
        accessor = ai_decision_pattern_by_org,
        btree(columns = [organization_id])
    ),
    index(
        accessor = ai_decision_pattern_by_key,
        btree(columns = [organization_id, pattern_key])
    )
)]
pub struct AiDecisionPattern {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub pattern_key: String,
    pub decision_type_name: String,
    pub decision_type_version: u32,
    pub applicability_json: String,
    pub supporting_case_ids: Vec<u64>,
    pub outcome_metrics_json: String,
    pub correction_rate: f64,
    /// "candidate" | "reviewed" | "promoted" | "superseded"
    pub status: String,
    pub reviewed_by: Option<Identity>,
    pub reviewed_note: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct PatternApplicabilityEvidence {
    schema_version: u32,
    applicability_fingerprint: String,
    company_id: u64,
    program_ref: String,
    step_id: String,
    context_fingerprint: String,
    candidate_set_hash: String,
    evidence_shape: String,
    graduation_policy_ref: String,
    #[serde(default)]
    material_policy_refs: Vec<String>,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct PatternMetricsSnapshot {
    schema_version: u32,
    observed_cases: u64,
    verified_cases: u64,
    reviewed_cases: u64,
    correction_rate: f64,
    verified_outcome_rate: f64,
    provider_disagreement_rate: Option<f64>,
    shadow_cases: u64,
    decision_entropy: f64,
    precedent_consistency: f64,
    policy_stability_rate: Option<f64>,
    evidence_shape_stability: f64,
    candidate_set_stability: Option<f64>,
    average_cost_microunits: Option<u64>,
    average_latency_ms: Option<u64>,
    proposed_expression_kind: String,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct GraduationPromotionPolicy {
    #[serde(default)]
    enabled: bool,
    minimum_cases: u64,
    minimum_verified_cases: u64,
    maximum_correction_rate: f64,
    maximum_provider_disagreement_rate: Option<f64>,
    maximum_entropy: f64,
    minimum_precedent_consistency: f64,
    minimum_policy_stability: Option<f64>,
    minimum_evidence_shape_stability: f64,
    minimum_candidate_set_stability: Option<f64>,
    minimum_shadow_cases: u64,
    #[serde(default = "default_minimum_shadow_conformance_rate")]
    minimum_shadow_conformance_rate: f64,
}

fn default_minimum_shadow_conformance_rate() -> f64 {
    0.98
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct DeterministicShadowPromotionEvidence {
    schema_version: u32,
    pattern_ref: String,
    implementation_ref: String,
    request_hash: String,
    conformant: Option<bool>,
    evaluation_error: Option<String>,
}

// ── Input params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordAiDecisionCaseParams {
    pub run_id: u64,
    pub step_no: u32,
    pub decision_type_name: String,
    pub decision_type_version: u32,
    pub program_ref: String,
    pub step_id: String,
    pub request_hash: String,
    pub context_fingerprint: String,
    pub material_constraints_json: String,
    pub selected_json: String,
    pub confidence: Option<f64>,
    pub provider_attempt_id: Option<u64>,
    pub precedent_refs: Vec<u64>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CorrectAiDecisionCaseParams {
    pub original_case_id: u64,
    pub run_id: u64,
    pub step_no: u32,
    pub selected_json: String,
    pub confidence: Option<f64>,
    pub request_hash: String,
    pub reason: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ProposeAiDecisionPatternParams {
    pub pattern_key: String,
    pub decision_type_name: String,
    pub decision_type_version: u32,
    pub applicability_json: String,
    pub supporting_case_ids: Vec<u64>,
    pub outcome_metrics_json: String,
    pub correction_rate: f64,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct PromoteAiDecisionPatternParams {
    pub pattern_id: u64,
    pub implementation_ref: String,
    pub note: Option<String>,
}

// ── Reducers: decision cases ────────────────────────────────────────────────

/// Persist one immutable decision case. Idempotent by
/// (organization_id, request_hash): an identical replay is a no-op, a
/// differing one is rejected.
#[reducer]
pub fn record_ai_decision_case(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: RecordAiDecisionCaseParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_decision_case", "create")?;
    load_active_run(ctx, organization_id, company_id, params.run_id)?;

    validate_case_fields(
        &params.decision_type_name,
        params.decision_type_version,
        &params.request_hash,
        &params.material_constraints_json,
        &params.selected_json,
        params.confidence,
    )?;
    if let Some(attempt_id) = params.provider_attempt_id {
        validate_provider_attempt(ctx, organization_id, attempt_id)?;
    }
    for precedent_id in &params.precedent_refs {
        let precedent = ctx
            .db
            .ai_decision_case()
            .id()
            .find(precedent_id)
            .ok_or("precedent_refs must reference existing decision cases")?;
        if precedent.organization_id != organization_id {
            return Err("precedent_refs must belong to this organization".to_string());
        }
    }

    if let Some(existing) = find_case_by_hash(ctx, organization_id, params.run_id, &params.request_hash) {
        if case_payload_matches(&existing, &params) {
            return Ok(());
        }
        return Err("decision case replay conflicts with the existing case".to_string());
    }

    ctx.db.ai_decision_case().insert(AiDecisionCase {
        id: 0,
        organization_id,
        company_id,
        run_id: params.run_id,
        step_no: params.step_no,
        decision_type_name: params.decision_type_name,
        decision_type_version: params.decision_type_version,
        program_ref: params.program_ref,
        step_id: params.step_id,
        request_hash: params.request_hash,
        context_fingerprint: params.context_fingerprint,
        material_constraints_json: params.material_constraints_json,
        selected_json: params.selected_json,
        confidence: params.confidence,
        provider_attempt_id: params.provider_attempt_id,
        precedent_refs: params.precedent_refs,
        verification_status: None,
        verification_reason: None,
        outcome_status: "unknown".to_string(),
        outcome_json: None,
        status: "observed".to_string(),
        correction_of: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });
    Ok(())
}

/// Insert a correction of `original_case_id` as a *new* row and mark the
/// original `superseded`. The original's substantive fields are never
/// rewritten — this is the only path that may set `status = "superseded"`.
#[reducer]
pub fn correct_ai_decision_case(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CorrectAiDecisionCaseParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_decision_case", "write")?;
    load_active_run(ctx, organization_id, company_id, params.run_id)?;

    let original = load_case(ctx, organization_id, params.original_case_id)?;
    if original.status == "superseded" {
        return Err("case has already been superseded".to_string());
    }
    if params.reason.trim().is_empty() {
        return Err("reason is required for a correction".to_string());
    }
    if params.selected_json.len() > MAX_JSON_FIELD_LEN {
        return Err("selected_json is too long".to_string());
    }
    if params.request_hash.trim().is_empty() {
        return Err("request_hash is required".to_string());
    }
    if let Some(confidence) = params.confidence {
        if !(0.0..=1.0).contains(&confidence) {
            return Err("confidence must be within [0, 1]".to_string());
        }
    }

    if let Some(existing) = find_case_by_hash(ctx, organization_id, params.run_id, &params.request_hash) {
        if existing.correction_of == Some(params.original_case_id)
            && existing.selected_json == params.selected_json
        {
            return Ok(());
        }
        return Err("correction replay conflicts with an existing case".to_string());
    }

    ctx.db.ai_decision_case().insert(AiDecisionCase {
        id: 0,
        organization_id,
        company_id,
        run_id: params.run_id,
        step_no: params.step_no,
        decision_type_name: original.decision_type_name.clone(),
        decision_type_version: original.decision_type_version,
        program_ref: original.program_ref.clone(),
        step_id: original.step_id.clone(),
        request_hash: params.request_hash,
        context_fingerprint: original.context_fingerprint.clone(),
        material_constraints_json: original.material_constraints_json.clone(),
        selected_json: params.selected_json,
        confidence: params.confidence,
        provider_attempt_id: None,
        precedent_refs: vec![original.id],
        verification_status: None,
        verification_reason: Some(params.reason),
        outcome_status: "unknown".to_string(),
        outcome_json: None,
        status: "observed".to_string(),
        correction_of: Some(original.id),
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    ctx.db.ai_decision_case().id().update(AiDecisionCase {
        status: "superseded".to_string(),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..original
    });
    Ok(())
}

#[reducer]
pub fn set_ai_decision_case_verification(
    ctx: &ReducerContext,
    organization_id: u64,
    case_id: u64,
    status: String,
    reason: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_decision_case", "write")?;
    if !VERIFICATION_STATUSES.contains(&status.as_str()) {
        return Err(format!("status must be one of {VERIFICATION_STATUSES:?}"));
    }
    let case = load_case(ctx, organization_id, case_id)?;
    ctx.db.ai_decision_case().id().update(AiDecisionCase {
        verification_status: Some(status),
        verification_reason: reason,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..case
    });
    Ok(())
}

#[reducer]
pub fn set_ai_decision_case_outcome(
    ctx: &ReducerContext,
    organization_id: u64,
    case_id: u64,
    status: String,
    outcome_json: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_decision_case", "write")?;
    if !OUTCOME_STATUSES.contains(&status.as_str()) {
        return Err(format!("status must be one of {OUTCOME_STATUSES:?}"));
    }
    if let Some(json) = &outcome_json {
        if json.len() > MAX_JSON_FIELD_LEN {
            return Err("outcome_json is too long".to_string());
        }
    }
    let case = load_case(ctx, organization_id, case_id)?;
    ctx.db.ai_decision_case().id().update(AiDecisionCase {
        outcome_status: status,
        outcome_json,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..case
    });
    Ok(())
}

/// Advance case status along the direct state machine. "superseded" is
/// deliberately excluded — see `correct_ai_decision_case`.
#[reducer]
pub fn set_ai_decision_case_status(
    ctx: &ReducerContext,
    organization_id: u64,
    case_id: u64,
    status: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_decision_case", "write")?;
    if !DIRECT_CASE_STATUSES.contains(&status.as_str()) {
        return Err(format!(
            "status must be one of {DIRECT_CASE_STATUSES:?}; use correct_ai_decision_case to supersede"
        ));
    }
    let case = load_case(ctx, organization_id, case_id)?;
    if case.status == "superseded" {
        return Err("a superseded case cannot change status".to_string());
    }
    ctx.db.ai_decision_case().id().update(AiDecisionCase {
        status,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..case
    });
    Ok(())
}

// ── Reducers: decision patterns ─────────────────────────────────────────────

/// Propose a candidate `DecisionPattern` from a cluster of supporting
/// cases. Always inserted as "candidate" — promotion is a separate,
/// explicit reviewer action.
#[reducer]
pub fn propose_ai_decision_pattern(
    ctx: &ReducerContext,
    organization_id: u64,
    params: ProposeAiDecisionPatternParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_decision_pattern", "create")?;

    if params.pattern_key.trim().is_empty() {
        return Err("pattern_key is required".to_string());
    }
    if params.decision_type_name.trim().is_empty() {
        return Err("decision_type_name is required".to_string());
    }
    if params.decision_type_version == 0 {
        return Err("decision_type_version must be positive".to_string());
    }
    if params.supporting_case_ids.len() < 2 {
        return Err("a pattern requires at least two supporting cases".to_string());
    }
    if !(0.0..=1.0).contains(&params.correction_rate) {
        return Err("correction_rate must be within [0, 1]".to_string());
    }
    if params.applicability_json.len() > MAX_JSON_FIELD_LEN
        || params.outcome_metrics_json.len() > MAX_JSON_FIELD_LEN
    {
        return Err("applicability_json/outcome_metrics_json is too long".to_string());
    }

    let applicability: PatternApplicabilityEvidence =
        serde_json::from_str(&params.applicability_json).map_err(|_| {
            "applicability_json must match the deterministic graduation evidence schema"
                .to_string()
        })?;
    validate_pattern_applicability(&applicability)?;

    let metrics: PatternMetricsSnapshot =
        serde_json::from_str(&params.outcome_metrics_json).map_err(|_| {
            "outcome_metrics_json must match the deterministic graduation metrics schema"
                .to_string()
        })?;
    validate_pattern_metrics(&metrics, params.correction_rate)?;

    if metrics.observed_cases != params.supporting_case_ids.len() as u64 {
        return Err("metrics observed_cases must equal supporting_case_ids length".to_string());
    }

    let mut seen_case_ids = std::collections::BTreeSet::new();
    for case_id in &params.supporting_case_ids {
        if !seen_case_ids.insert(*case_id) {
            return Err("supporting_case_ids must be unique".to_string());
        }
        let case = ctx
            .db
            .ai_decision_case()
            .id()
            .find(case_id)
            .ok_or("supporting_case_ids must reference existing decision cases")?;
        if case.organization_id != organization_id {
            return Err("supporting_case_ids must belong to this organization".to_string());
        }
        if case.company_id != applicability.company_id {
            return Err("supporting_case_ids must match applicability company_id".to_string());
        }
        if case.decision_type_name != params.decision_type_name
            || case.decision_type_version != params.decision_type_version
        {
            return Err("supporting_case_ids must match the pattern's decision type".to_string());
        }
        if matches!(case.status.as_str(), "rejected" | "superseded") {
            return Err(
                "rejected or superseded cases cannot be positive pattern support".to_string(),
            );
        }
        if case.program_ref != applicability.program_ref
            || case.step_id != applicability.step_id
            || case.context_fingerprint != applicability.context_fingerprint
        {
            return Err(
                "supporting_case_ids must share the declared applicability partition".to_string(),
            );
        }
    }
    if pattern_key_exists(ctx, organization_id, &params.pattern_key) {
        return Err(format!(
            "pattern_key '{}' already exists",
            params.pattern_key
        ));
    }

    ctx.db.ai_decision_pattern().insert(AiDecisionPattern {
        id: 0,
        organization_id,
        pattern_key: params.pattern_key,
        decision_type_name: params.decision_type_name,
        decision_type_version: params.decision_type_version,
        applicability_json: params.applicability_json,
        supporting_case_ids: params.supporting_case_ids,
        outcome_metrics_json: params.outcome_metrics_json,
        correction_rate: params.correction_rate,
        status: "candidate".to_string(),
        reviewed_by: None,
        reviewed_note: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });
    Ok(())
}

/// Advance a pattern's non-promotion status. Valid transitions: candidate -> reviewed
/// and {candidate, reviewed, promoted} -> superseded. Promotion is available only
/// through `promote_ai_decision_pattern`, which enforces DG-07 evidence gates.
#[reducer]
pub fn set_ai_decision_pattern_status(
    ctx: &ReducerContext,
    organization_id: u64,
    pattern_id: u64,
    status: String,
    note: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_decision_pattern", "write")?;
    if !PATTERN_STATUSES.contains(&status.as_str()) {
        return Err(format!("status must be one of {PATTERN_STATUSES:?}"));
    }
    let pattern = ctx
        .db
        .ai_decision_pattern()
        .id()
        .find(&pattern_id)
        .ok_or("Decision pattern not found")?;
    if pattern.organization_id != organization_id {
        return Err("Decision pattern does not belong to this organization".to_string());
    }

    let allowed = match (pattern.status.as_str(), status.as_str()) {
        ("candidate", "reviewed") => true,
        ("candidate" | "reviewed" | "promoted", "superseded") => true,
        _ => false,
    };
    if !allowed {
        return Err(format!(
            "cannot transition pattern from '{}' to '{status}'",
            pattern.status
        ));
    }

    ctx.db.ai_decision_pattern().id().update(AiDecisionPattern {
        status,
        reviewed_by: Some(ctx.sender()),
        reviewed_note: note,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..pattern
    });
    Ok(())
}

/// Promote a reviewed deterministic decision pattern only after re-validating
/// its immutable eligibility evidence and durable deterministic-shadow conformance.
/// This is the only reducer allowed to perform reviewed -> promoted.
#[reducer]
pub fn promote_ai_decision_pattern(
    ctx: &ReducerContext,
    organization_id: u64,
    params: PromoteAiDecisionPatternParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_decision_pattern", "write")?;

    if params.implementation_ref.trim().is_empty()
        || !params.implementation_ref.contains('@')
    {
        return Err("implementation_ref must be a nonempty immutable versioned ref".to_string());
    }

    let pattern = ctx
        .db
        .ai_decision_pattern()
        .id()
        .find(&params.pattern_id)
        .ok_or("Decision pattern not found")?;
    if pattern.organization_id != organization_id {
        return Err("Decision pattern does not belong to this organization".to_string());
    }
    if pattern.status != "reviewed" {
        return Err("only a reviewed pattern can be promoted".to_string());
    }

    let applicability: PatternApplicabilityEvidence =
        serde_json::from_str(&pattern.applicability_json)
            .map_err(|_| "stored pattern applicability evidence is invalid".to_string())?;
    validate_pattern_applicability(&applicability)?;

    let metrics: PatternMetricsSnapshot =
        serde_json::from_str(&pattern.outcome_metrics_json)
            .map_err(|_| "stored pattern metrics evidence is invalid".to_string())?;
    validate_pattern_metrics(&metrics, pattern.correction_rate)?;

    revalidate_supporting_cases(ctx, organization_id, &pattern, &applicability)?;

    let policy = load_graduation_promotion_policy(
        ctx,
        organization_id,
        &pattern.decision_type_name,
        pattern.decision_type_version,
    )?;
    validate_promotion_policy(&policy)?;
    validate_metrics_against_promotion_policy(&metrics, &policy)?;

    let (shadow_count, conformant_count) = deterministic_shadow_conformance(
        ctx,
        organization_id,
        applicability.company_id,
        &pattern,
        &params.implementation_ref,
    )?;
    if shadow_count < policy.minimum_shadow_cases {
        return Err(format!(
            "deterministic shadow sample count {shadow_count} is below required {}",
            policy.minimum_shadow_cases
        ));
    }
    let conformance_rate = conformant_count as f64 / shadow_count as f64;
    if conformance_rate < policy.minimum_shadow_conformance_rate {
        return Err(format!(
            "deterministic shadow conformance rate {conformance_rate:.6} is below required {:.6}",
            policy.minimum_shadow_conformance_rate
        ));
    }

    reject_review_defects_for_shadow_runs(
        ctx,
        organization_id,
        applicability.company_id,
        &pattern,
        &params.implementation_ref,
    )?;

    let promotion_evidence = serde_json::json!({
        "schema_version": 1,
        "implementation_ref": params.implementation_ref,
        "graduation_policy_ref": applicability.graduation_policy_ref,
        "shadow_cases": shadow_count,
        "conformant_cases": conformant_count,
        "conformance_rate": conformance_rate,
        "reviewer_note": params.note,
    })
    .to_string();

    ctx.db.ai_decision_pattern().id().update(AiDecisionPattern {
        status: "promoted".to_string(),
        reviewed_by: Some(ctx.sender()),
        reviewed_note: Some(promotion_evidence),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..pattern
    });
    Ok(())
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn validate_pattern_applicability(
    applicability: &PatternApplicabilityEvidence,
) -> Result<(), String> {
    if applicability.schema_version != 1 {
        return Err("pattern applicability schema_version must be 1".to_string());
    }
    if applicability.applicability_fingerprint.trim().is_empty()
        || applicability.program_ref.trim().is_empty()
        || applicability.step_id.trim().is_empty()
        || applicability.context_fingerprint.trim().is_empty()
        || applicability.candidate_set_hash.trim().is_empty()
        || applicability.evidence_shape.trim().is_empty()
        || applicability.graduation_policy_ref.trim().is_empty()
    {
        return Err("pattern applicability evidence contains an empty required field".to_string());
    }
    if applicability.company_id == 0 {
        return Err("pattern applicability company_id must be nonzero".to_string());
    }
    if !applicability
        .graduation_policy_ref
        .starts_with("decision-type:")
        || !applicability.graduation_policy_ref.ends_with("/graduation")
    {
        return Err(
            "graduation_policy_ref must reference the immutable DecisionType graduation policy"
                .to_string(),
        );
    }
    if applicability
        .material_policy_refs
        .iter()
        .any(|value| value.trim().is_empty())
    {
        return Err("material_policy_refs must not contain empty refs".to_string());
    }
    Ok(())
}

fn validate_pattern_metrics(
    metrics: &PatternMetricsSnapshot,
    correction_rate: f64,
) -> Result<(), String> {
    if metrics.schema_version != 1 {
        return Err("pattern metrics schema_version must be 1".to_string());
    }
    if metrics.observed_cases < 2
        || metrics.verified_cases > metrics.observed_cases
        || metrics.reviewed_cases > metrics.observed_cases
    {
        return Err("pattern metrics case counts are incoherent".to_string());
    }
    if (metrics.correction_rate - correction_rate).abs() > f64::EPSILON {
        return Err("pattern correction_rate must match metrics snapshot".to_string());
    }
    for (name, value) in [
        ("correction_rate", Some(metrics.correction_rate)),
        ("verified_outcome_rate", Some(metrics.verified_outcome_rate)),
        (
            "provider_disagreement_rate",
            metrics.provider_disagreement_rate,
        ),
        ("decision_entropy", Some(metrics.decision_entropy)),
        (
            "precedent_consistency",
            Some(metrics.precedent_consistency),
        ),
        ("policy_stability_rate", metrics.policy_stability_rate),
        (
            "evidence_shape_stability",
            Some(metrics.evidence_shape_stability),
        ),
        (
            "candidate_set_stability",
            metrics.candidate_set_stability,
        ),
    ] {
        if let Some(value) = value {
            if !(0.0..=1.0).contains(&value) {
                return Err(format!("{name} must be within [0, 1]"));
            }
        }
    }
    if metrics.proposed_expression_kind.trim().is_empty() {
        return Err("proposed_expression_kind is required".to_string());
    }
    Ok(())
}

fn load_active_run(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
) -> Result<(), String> {
    let run = ctx
        .db
        .ai_agent_run()
        .id()
        .find(&run_id)
        .ok_or("Run not found")?;
    if run.organization_id != organization_id {
        return Err("Run does not belong to this organization".to_string());
    }
    if run.company_id != company_id {
        return Err("Run does not belong to this company".to_string());
    }
    if !matches!(run.status.as_str(), "running" | "pending") {
        return Err("run is not active".to_string());
    }
    Ok(())
}

fn load_case(
    ctx: &ReducerContext,
    organization_id: u64,
    case_id: u64,
) -> Result<AiDecisionCase, String> {
    let case = ctx
        .db
        .ai_decision_case()
        .id()
        .find(&case_id)
        .ok_or("Decision case not found")?;
    if case.organization_id != organization_id {
        return Err("Decision case does not belong to this organization".to_string());
    }
    Ok(case)
}

fn find_case_by_hash(
    ctx: &ReducerContext,
    organization_id: u64,
    run_id: u64,
    request_hash: &str,
) -> Option<AiDecisionCase> {
    ctx.db
        .ai_decision_case()
        .ai_decision_case_by_org()
        .filter(&organization_id)
        .find(|case| case.run_id == run_id && case.request_hash == request_hash)
}

fn pattern_key_exists(ctx: &ReducerContext, organization_id: u64, pattern_key: &str) -> bool {
    ctx.db
        .ai_decision_pattern()
        .ai_decision_pattern_by_org()
        .filter(&organization_id)
        .any(|p| p.pattern_key == pattern_key)
}

fn validate_provider_attempt(
    ctx: &ReducerContext,
    organization_id: u64,
    attempt_id: u64,
) -> Result<(), String> {
    let attempt = ctx
        .db
        .ai_provider_attempt()
        .id()
        .find(&attempt_id)
        .ok_or("provider_attempt_id does not reference an existing attempt")?;
    if attempt.organization_id != organization_id {
        return Err("provider attempt does not belong to this organization".to_string());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_case_fields(
    decision_type_name: &str,
    decision_type_version: u32,
    request_hash: &str,
    material_constraints_json: &str,
    selected_json: &str,
    confidence: Option<f64>,
) -> Result<(), String> {
    if decision_type_name.trim().is_empty() {
        return Err("decision_type_name is required".to_string());
    }
    if decision_type_version == 0 {
        return Err("decision_type_version must be positive".to_string());
    }
    if request_hash.trim().is_empty() {
        return Err("request_hash is required".to_string());
    }
    if material_constraints_json.len() > MAX_JSON_FIELD_LEN
        || selected_json.len() > MAX_JSON_FIELD_LEN
    {
        return Err("material_constraints_json/selected_json is too long".to_string());
    }
    if let Some(confidence) = confidence {
        if !(0.0..=1.0).contains(&confidence) {
            return Err("confidence must be within [0, 1]".to_string());
        }
    }
    Ok(())
}

fn case_payload_matches(existing: &AiDecisionCase, params: &RecordAiDecisionCaseParams) -> bool {
    existing.run_id == params.run_id
        && existing.step_no == params.step_no
        && existing.decision_type_name == params.decision_type_name
        && existing.decision_type_version == params.decision_type_version
        && existing.program_ref == params.program_ref
        && existing.step_id == params.step_id
        && existing.context_fingerprint == params.context_fingerprint
        && existing.material_constraints_json == params.material_constraints_json
        && existing.selected_json == params.selected_json
        && existing.confidence == params.confidence
        && existing.provider_attempt_id == params.provider_attempt_id
        && existing.precedent_refs == params.precedent_refs
}


#[cfg(test)]
mod graduation_pattern_tests {
    use super::*;

    fn applicability() -> PatternApplicabilityEvidence {
        PatternApplicabilityEvidence {
            schema_version: 1,
            applicability_fingerprint: "sha256:test".to_string(),
            company_id: 7,
            program_ref: "skill:test@1".to_string(),
            step_id: "decision".to_string(),
            context_fingerprint: "context-v1".to_string(),
            candidate_set_hash: "candidate-set-v1".to_string(),
            evidence_shape: "amount:number|currency:string".to_string(),
            graduation_policy_ref: "decision-type:Test@1/graduation".to_string(),
            material_policy_refs: vec![],
        }
    }

    fn metrics() -> PatternMetricsSnapshot {
        PatternMetricsSnapshot {
            schema_version: 1,
            observed_cases: 2,
            verified_cases: 2,
            reviewed_cases: 1,
            correction_rate: 0.0,
            verified_outcome_rate: 1.0,
            provider_disagreement_rate: Some(0.0),
            shadow_cases: 2,
            decision_entropy: 0.0,
            precedent_consistency: 1.0,
            policy_stability_rate: None,
            evidence_shape_stability: 1.0,
            candidate_set_stability: Some(1.0),
            average_cost_microunits: Some(10),
            average_latency_ms: Some(20),
            proposed_expression_kind: "lookup_policy".to_string(),
        }
    }

    #[test]
    fn hardened_applicability_requires_versioned_decision_type_policy_ref() {
        assert!(validate_pattern_applicability(&applicability()).is_ok());

        let mut invalid = applicability();
        invalid.graduation_policy_ref = "model-profile:cheap@1".to_string();
        assert!(validate_pattern_applicability(&invalid).is_err());
    }

    #[test]
    fn hardened_metrics_reject_incoherent_case_counts() {
        assert!(validate_pattern_metrics(&metrics(), 0.0).is_ok());

        let mut invalid = metrics();
        invalid.verified_cases = 3;
        assert!(validate_pattern_metrics(&invalid, 0.0).is_err());
    }

    #[test]
    fn hardened_metrics_reject_top_level_correction_rate_drift() {
        assert!(validate_pattern_metrics(&metrics(), 0.1).is_err());
    }
}
