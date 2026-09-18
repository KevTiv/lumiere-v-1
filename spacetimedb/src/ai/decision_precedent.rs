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

    if let Some(existing) = find_case_by_hash(ctx, organization_id, &params.request_hash) {
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
    for case_id in &params.supporting_case_ids {
        let case = ctx
            .db
            .ai_decision_case()
            .id()
            .find(case_id)
            .ok_or("supporting_case_ids must reference existing decision cases")?;
        if case.organization_id != organization_id {
            return Err("supporting_case_ids must belong to this organization".to_string());
        }
        if case.decision_type_name != params.decision_type_name
            || case.decision_type_version != params.decision_type_version
        {
            return Err("supporting_case_ids must match the pattern's decision type".to_string());
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

/// Advance a pattern's status. Valid transitions: candidate -> reviewed,
/// reviewed -> promoted, and {candidate, reviewed, promoted} -> superseded.
/// Any other transition (including skipping review) is rejected.
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
        ("reviewed", "promoted") => true,
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

// ── Helpers ──────────────────────────────────────────────────────────────────

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
