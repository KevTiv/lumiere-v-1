//! GP-05 (governed intelligence program): durable decision/reasoning events.
//!
//! `governed-intelligence-program-migration.md` GP-05 requires persisting
//! typed decision/reasoning requests, outputs, verification, escalation,
//! acceptance/rejection, and provider-attempt links — durable evidence a
//! `DecisionProvider`/`ReasoningProvider` call actually happened, what it
//! returned, and what the governed program later did with it. All eight
//! reducers here are called by production code:
//! `governed_program::GovernedProgramExecutor` (via its
//! `IntelligenceEventRecorder` seam, `StdbIntelligenceEventRecorder` in
//! production) calls `record_ai_decision_event`/`record_ai_reasoning_event`
//! for every `DecisionProvider::decide`/`ReasoningProvider::reason` call,
//! and — for decisions — `set_ai_intelligence_event_verification`/
//! `_escalation`/`_acceptance` once `admit_decision` (GP-07) and the
//! graph's own control flow settle what happened next. Reasoning events
//! are recorded but do not yet get the same verification/escalation/
//! acceptance follow-up (escalation for `"clarification_request"`/
//! `"unable_to_progress"` is still only the automatic one this module
//! derives at insert time below).
//!
//! One event kind, one table (`AiIntelligenceEvent`), distinguished by
//! `event_kind`:
//!
//! - `"decision"` — one `DecisionProvider::decide` call (GP-01
//!   `DecisionRequest`/`DecisionResponse`).
//! - `"reasoning"` — one `ReasoningProvider::reason` call (GP-01
//!   `ReasoningRequest`/`ReasoningOutcome`).
//! - `"decision_shadow"` — one zero-authority shadow evaluation of a
//!   production decision request against a candidate `ModelProfile`
//!   (GP-15). A shadow event is correlated to its production `"decision"`
//!   event by `(organization_id, run_id, request_hash)` — the same request
//!   was sent to both — never by acting on its output. `shadow_profile_ref`
//!   identifies which shadow profile produced it; `shadow_error` is set
//!   instead of `outcome_kind`/`output_json` when the shadow attempt
//!   itself failed. Shadow failures never affect the production decision.
//!
//! Request/output payloads are stored as opaque, size-bounded JSON
//! snapshots (`request_json`/`output_json`) rather than typed columns: the
//! shape is owned by the GP-01 Rust contracts in `ai-gateway`, and this
//! table's job is durable evidence, not a second schema to keep in sync.
//! `request_hash` is the same deterministic SHA-256 GP-01 already computes
//! (`decision_request_hash`/`reasoning_request_hash`), used here purely for
//! replay idempotency — recording the same request twice for the same run
//! and step is a no-op, not a duplicate row.
//!
//! Verification, escalation and acceptance are separate, independently
//! settable fields because they are decided at different times by
//! different authorities: verification is `VerificationService`'s shape
//! check (or later AIH-15's full evidence gate), escalation is whether the
//! outcome required clarification/review/a hard stop, and acceptance is
//! whether the governed program ultimately acted on the judgment. None of
//! the three implies the others.

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::ai::skills::ai_agent_run;
use crate::ai::spend::ai_provider_attempt;
use crate::helpers::check_permission;

const MAX_JSON_FIELD_LEN: usize = 256_000;
const DECISION_KINDS: [&str; 3] = ["choice", "score", "probability"];
const SHADOW_OUTCOME_KINDS: [&str; 4] = ["choice", "score", "probability", "failed"];
const REASONING_KINDS: [&str; 6] = [
    "capability_proposal",
    "decision_proposal",
    "program_patch_proposal",
    "clarification_request",
    "final_draft",
    "unable_to_progress",
];
const VERIFICATION_STATUSES: [&str; 3] = ["verified", "requires_review", "failed"];
const ESCALATION_STATUSES: [&str; 4] = ["none", "clarification", "review_required", "blocked"];
const ACCEPTANCE_STATUSES: [&str; 3] = ["pending", "accepted", "rejected"];

// ── Table ────────────────────────────────────────────────────────────────────

/// One durable `decide()`/`reason()` call and, once known, what happened to
/// its output afterward.
#[derive(Clone, Debug)]
#[spacetimedb::table(
    accessor = ai_intelligence_event,
    public,
    index(
        accessor = ai_intelligence_event_by_run,
        btree(columns = [run_id])
    ),
    index(
        accessor = ai_intelligence_event_by_org,
        btree(columns = [organization_id])
    ),
    index(
        accessor = ai_intelligence_event_by_request_hash,
        btree(columns = [organization_id, request_hash])
    )
)]
pub struct AiIntelligenceEvent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub run_id: u64,
    pub step_no: u32,
    /// "decision" | "reasoning"
    pub event_kind: String,
    /// Set only for `event_kind == "decision"`.
    pub decision_type_name: Option<String>,
    pub decision_type_version: Option<u32>,
    /// GP-01's deterministic SHA-256 request hash; used for replay
    /// idempotency within (organization_id, run_id, step_no).
    pub request_hash: String,
    pub request_json: String,
    /// Decision: "choice" | "score" | "probability".
    /// Reasoning: one of `ReasoningOutcome`'s kind labels.
    pub outcome_kind: String,
    pub output_json: String,
    /// Provider-reported confidence, advisory only (never assumed
    /// calibrated — see `governed-intelligence-program-architecture.md`
    /// invariant #8).
    pub confidence: Option<f64>,
    pub provider: String,
    pub model: String,
    /// Links to `AiProviderAttempt` for spend/durability cross-reference.
    pub provider_attempt_id: Option<u64>,
    pub input_tokens: u32,
    pub output_tokens: u32,
    /// None until `set_ai_intelligence_event_verification` runs.
    pub verification_status: Option<String>,
    pub verification_reason: Option<String>,
    /// "none" | "clarification" | "review_required" | "blocked"
    pub escalation_status: String,
    pub escalation_reason: Option<String>,
    /// "pending" | "accepted" | "rejected"
    pub acceptance_status: String,
    pub acceptance_reason: Option<String>,
    /// Set only for `event_kind == "decision_shadow"`; identifies which
    /// shadow model profile produced this event.
    pub shadow_profile_ref: Option<String>,
    /// Set only for `event_kind == "decision_shadow"` when the shadow
    /// attempt itself failed (`outcome_kind`/`output_json` are absent in
    /// that case). Never set for `"decision"`/`"reasoning"` events.
    pub shadow_error: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

// ── Input params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordAiDecisionEventParams {
    pub step_no: u32,
    pub decision_type_name: String,
    pub decision_type_version: u32,
    pub request_hash: String,
    pub request_json: String,
    pub outcome_kind: String,
    pub output_json: String,
    pub confidence: Option<f64>,
    pub provider: String,
    pub model: String,
    pub provider_attempt_id: Option<u64>,
    pub input_tokens: u32,
    pub output_tokens: u32,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordAiReasoningEventParams {
    pub step_no: u32,
    pub request_hash: String,
    pub request_json: String,
    pub outcome_kind: String,
    pub output_json: String,
    pub provider: String,
    pub model: String,
    pub provider_attempt_id: Option<u64>,
    pub input_tokens: u32,
    pub output_tokens: u32,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordAiProgramCheckpointParams {
    pub program_ref: String,
    pub graph_hash: String,
    pub checkpoint_hash: String,
    pub checkpoint_json: String,
    pub status: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordAiDecisionShadowEventParams {
    pub shadow_profile_ref: String,
    pub decision_type_name: String,
    pub decision_type_version: u32,
    pub request_hash: String,
    pub request_json: String,
    /// Present together with `output_json` on a successful shadow attempt;
    /// absent (with `shadow_error` set instead) on a failed one.
    pub outcome_kind: Option<String>,
    pub output_json: Option<String>,
    pub confidence: Option<f64>,
    pub provider: String,
    pub model: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub shadow_error: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordAiDeterministicShadowEventParams {
    pub pattern_ref: String,
    pub implementation_ref: String,
    pub decision_type_name: String,
    pub decision_type_version: u32,
    pub request_hash: String,
    pub request_json: String,
    pub evidence_json: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordAiGraduationAuthorityRollbackParams {
    pub decision_type_name: String,
    pub decision_type_version: u32,
    pub pattern_ref: String,
    pub implementation_ref: String,
    pub from_mode: String,
    pub to_mode: String,
    pub reasons_json: String,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Persist one `DecisionProvider::decide` call. Idempotent by
/// (run_id, step_no, event_kind): replaying the same payload for a step
/// already recorded is a no-op; a different payload for that step is
/// rejected rather than silently overwritten.
#[reducer]
pub fn record_ai_decision_event(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: RecordAiDecisionEventParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_intelligence_event", "create")?;
    load_active_run(ctx, organization_id, company_id, run_id)?;

    if params.decision_type_name.trim().is_empty() {
        return Err("decision_type_name is required".to_string());
    }
    if params.decision_type_version == 0 {
        return Err("decision_type_version must be positive".to_string());
    }
    if !DECISION_KINDS.contains(&params.outcome_kind.as_str()) {
        return Err(format!(
            "outcome_kind must be one of {DECISION_KINDS:?} for a decision event"
        ));
    }
    if let Some(confidence) = params.confidence {
        if !(0.0..=1.0).contains(&confidence) {
            return Err("confidence must be within [0, 1]".to_string());
        }
    }

    validate_common(
        ctx,
        organization_id,
        &params.request_hash,
        &params.request_json,
        &params.output_json,
        &params.provider,
        &params.model,
        params.provider_attempt_id,
    )?;

    if let Some(existing) = find_event(ctx, run_id, params.step_no, "decision") {
        if existing.organization_id != organization_id {
            return Err("event does not belong to this run organization".to_string());
        }
        if decision_payload_matches(&existing, &params) {
            return Ok(());
        }
        return Err("decision event replay conflicts with the existing event".to_string());
    }

    ctx.db.ai_intelligence_event().insert(AiIntelligenceEvent {
        id: 0,
        organization_id,
        company_id,
        run_id,
        step_no: params.step_no,
        event_kind: "decision".to_string(),
        decision_type_name: Some(params.decision_type_name),
        decision_type_version: Some(params.decision_type_version),
        request_hash: params.request_hash,
        request_json: params.request_json,
        outcome_kind: params.outcome_kind,
        output_json: params.output_json,
        confidence: params.confidence,
        provider: params.provider,
        model: params.model,
        provider_attempt_id: params.provider_attempt_id,
        input_tokens: params.input_tokens,
        output_tokens: params.output_tokens,
        verification_status: None,
        verification_reason: None,
        escalation_status: "none".to_string(),
        escalation_reason: None,
        acceptance_status: "pending".to_string(),
        acceptance_reason: None,
        shadow_profile_ref: None,
        shadow_error: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    Ok(())
}

/// Persist one `ReasoningProvider::reason` call. Same idempotency contract
/// as `record_ai_decision_event`.
#[reducer]
pub fn record_ai_reasoning_event(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: RecordAiReasoningEventParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_intelligence_event", "create")?;
    load_active_run(ctx, organization_id, company_id, run_id)?;

    if !REASONING_KINDS.contains(&params.outcome_kind.as_str()) {
        return Err(format!(
            "outcome_kind must be one of {REASONING_KINDS:?} for a reasoning event"
        ));
    }

    validate_common(
        ctx,
        organization_id,
        &params.request_hash,
        &params.request_json,
        &params.output_json,
        &params.provider,
        &params.model,
        params.provider_attempt_id,
    )?;

    if let Some(existing) = find_event(ctx, run_id, params.step_no, "reasoning") {
        if existing.organization_id != organization_id {
            return Err("event does not belong to this run organization".to_string());
        }
        if reasoning_payload_matches(&existing, &params) {
            return Ok(());
        }
        return Err("reasoning event replay conflicts with the existing event".to_string());
    }

    // Clarification and unable-to-progress are themselves escalation
    // signals; record that up front rather than requiring a second call.
    let escalation_status = match params.outcome_kind.as_str() {
        "clarification_request" => "clarification",
        "unable_to_progress" => "blocked",
        _ => "none",
    }
    .to_string();

    ctx.db.ai_intelligence_event().insert(AiIntelligenceEvent {
        id: 0,
        organization_id,
        company_id,
        run_id,
        step_no: params.step_no,
        event_kind: "reasoning".to_string(),
        decision_type_name: None,
        decision_type_version: None,
        request_hash: params.request_hash,
        request_json: params.request_json,
        outcome_kind: params.outcome_kind,
        output_json: params.output_json,
        confidence: None,
        provider: params.provider,
        model: params.model,
        provider_attempt_id: params.provider_attempt_id,
        input_tokens: params.input_tokens,
        output_tokens: params.output_tokens,
        verification_status: None,
        verification_reason: None,
        escalation_status,
        escalation_reason: None,
        acceptance_status: "pending".to_string(),
        acceptance_reason: None,
        shadow_profile_ref: None,
        shadow_error: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    Ok(())
}

/// Persist one zero-authority shadow evaluation of a production decision
/// request (GP-15). Idempotent by
/// (organization_id, run_id, request_hash, shadow_profile_ref): replaying
/// the same payload is a no-op; a different payload for that key is
/// rejected rather than silently overwritten. Never mutates or is
/// referenced by the production `"decision"` event it shadows — the two
/// are correlated only by having been sent the same request (same
/// `request_hash`).
#[reducer]
pub fn record_ai_decision_shadow_event(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: RecordAiDecisionShadowEventParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_intelligence_event", "create")?;
    load_active_run(ctx, organization_id, company_id, run_id)?;

    if params.shadow_profile_ref.trim().is_empty() {
        return Err("shadow_profile_ref is required".to_string());
    }
    if params.decision_type_name.trim().is_empty() {
        return Err("decision_type_name is required".to_string());
    }
    if params.decision_type_version == 0 {
        return Err("decision_type_version must be positive".to_string());
    }

    let (outcome_kind, output_json) = match (
        &params.outcome_kind,
        &params.output_json,
        &params.shadow_error,
    ) {
        (Some(kind), Some(output), None) => {
            if !DECISION_KINDS.contains(&kind.as_str()) {
                return Err(format!(
                    "outcome_kind must be one of {DECISION_KINDS:?} for a successful shadow event"
                ));
            }
            if output.len() > MAX_JSON_FIELD_LEN {
                return Err("output_json is too long".to_string());
            }
            (kind.clone(), output.clone())
        }
        (None, None, Some(error)) => {
            if error.trim().is_empty() {
                return Err("shadow_error must be nonempty when set".to_string());
            }
            ("failed".to_string(), "null".to_string())
        }
        _ => {
            return Err(
                "shadow event must set exactly one of (outcome_kind + output_json) or shadow_error"
                    .to_string(),
            );
        }
    };
    if !SHADOW_OUTCOME_KINDS.contains(&outcome_kind.as_str()) {
        return Err(format!("outcome_kind must be one of {SHADOW_OUTCOME_KINDS:?}"));
    }
    if let Some(confidence) = params.confidence {
        if !(0.0..=1.0).contains(&confidence) {
            return Err("confidence must be within [0, 1]".to_string());
        }
    }

    validate_common(
        ctx,
        organization_id,
        &params.request_hash,
        &params.request_json,
        &output_json,
        &params.provider,
        &params.model,
        None,
    )?;

    if let Some(existing) = find_shadow_event(
        ctx,
        run_id,
        &params.request_hash,
        &params.shadow_profile_ref,
    ) {
        if shadow_payload_matches(&existing, &params, &outcome_kind, &output_json) {
            return Ok(());
        }
        return Err("shadow decision event replay conflicts with the existing event".to_string());
    }

    ctx.db.ai_intelligence_event().insert(AiIntelligenceEvent {
        id: 0,
        organization_id,
        company_id,
        run_id,
        step_no: 0,
        event_kind: "decision_shadow".to_string(),
        decision_type_name: Some(params.decision_type_name),
        decision_type_version: Some(params.decision_type_version),
        request_hash: params.request_hash,
        request_json: params.request_json,
        outcome_kind,
        output_json,
        confidence: params.confidence,
        provider: params.provider,
        model: params.model,
        provider_attempt_id: None,
        input_tokens: params.input_tokens,
        output_tokens: params.output_tokens,
        verification_status: None,
        verification_reason: None,
        escalation_status: "none".to_string(),
        escalation_reason: None,
        acceptance_status: "rejected".to_string(),
        acceptance_reason: Some("shadow evaluation carries zero live authority".to_string()),
        shadow_profile_ref: Some(params.shadow_profile_ref),
        shadow_error: params.shadow_error,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    Ok(())
}

/// Persist one append-only governed-program checkpoint. A checkpoint is
/// resumable state, not provider output or authority. Idempotent by
/// checkpoint_hash within a run.
#[reducer]
pub fn record_ai_program_checkpoint(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: RecordAiProgramCheckpointParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_intelligence_event", "create")?;
    load_checkpointable_run(ctx, organization_id, company_id, run_id)?;

    if params.program_ref.trim().is_empty()
        || params.graph_hash.trim().is_empty()
        || params.checkpoint_hash.trim().is_empty()
    {
        return Err("program_ref, graph_hash and checkpoint_hash are required".to_string());
    }
    if !matches!(
        params.status.as_str(),
        "running" | "awaiting_approval" | "agent_settled" | "completed"
    ) {
        return Err("checkpoint status is invalid".to_string());
    }
    if params.checkpoint_json.len() > MAX_JSON_FIELD_LEN {
        return Err("checkpoint_json exceeds size limit".to_string());
    }
    let checkpoint: serde_json::Value = serde_json::from_str(&params.checkpoint_json)
        .map_err(|_| "checkpoint_json must be valid JSON".to_string())?;
    if checkpoint
        .get("schema_version")
        .and_then(serde_json::Value::as_u64)
        != Some(1)
    {
        return Err("program checkpoint schema_version must be 1".to_string());
    }
    if checkpoint
        .get("program_ref")
        .and_then(serde_json::Value::as_str)
        != Some(params.program_ref.as_str())
        || checkpoint
            .get("graph_hash")
            .and_then(serde_json::Value::as_str)
            != Some(params.graph_hash.as_str())
    {
        return Err("program checkpoint identity does not match params".to_string());
    }

    if let Some(existing) = ctx
        .db
        .ai_intelligence_event()
        .ai_intelligence_event_by_request_hash()
        .filter(&(organization_id, params.checkpoint_hash.clone()))
        .find(|event| event.run_id == run_id && event.event_kind == "program_checkpoint")
    {
        if existing.output_json == params.checkpoint_json
            && existing.shadow_profile_ref.as_deref() == Some(params.program_ref.as_str())
        {
            return Ok(());
        }
        return Err("checkpoint replay conflicts with existing checkpoint".to_string());
    }

    ctx.db.ai_intelligence_event().insert(AiIntelligenceEvent {
        id: 0,
        organization_id,
        company_id,
        run_id,
        step_no: 0,
        event_kind: "program_checkpoint".to_string(),
        decision_type_name: None,
        decision_type_version: None,
        request_hash: params.checkpoint_hash,
        request_json: serde_json::json!({
            "program_ref": params.program_ref,
            "graph_hash": params.graph_hash,
        })
        .to_string(),
        outcome_kind: params.status,
        output_json: params.checkpoint_json,
        confidence: None,
        provider: "governed-runtime".to_string(),
        model: params.graph_hash,
        provider_attempt_id: None,
        input_tokens: 0,
        output_tokens: 0,
        verification_status: Some("verified".to_string()),
        verification_reason: None,
        escalation_status: "none".to_string(),
        escalation_reason: None,
        acceptance_status: "accepted".to_string(),
        acceptance_reason: Some("durable governed-program checkpoint".to_string()),
        shadow_profile_ref: Some(params.program_ref),
        shadow_error: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });
    Ok(())
}

/// Persist one zero-authority deterministic candidate evaluation (DG-05).
#[reducer]
pub fn record_ai_deterministic_shadow_event(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: RecordAiDeterministicShadowEventParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_intelligence_event", "create")?;
    load_active_run(ctx, organization_id, company_id, run_id)?;

    if params.pattern_ref.trim().is_empty() || params.implementation_ref.trim().is_empty() {
        return Err("pattern_ref and implementation_ref are required".to_string());
    }
    if params.decision_type_name.trim().is_empty() || params.decision_type_version == 0 {
        return Err("decision_type_name and positive decision_type_version are required".to_string());
    }
    if params.request_hash.trim().is_empty() {
        return Err("request_hash is required".to_string());
    }
    if params.request_json.len() > MAX_JSON_FIELD_LEN
        || params.evidence_json.len() > MAX_JSON_FIELD_LEN
    {
        return Err("deterministic shadow JSON field exceeds size limit".to_string());
    }

    let evidence: serde_json::Value = serde_json::from_str(&params.evidence_json)
        .map_err(|_| "evidence_json must be valid JSON".to_string())?;
    if evidence.get("schema_version").and_then(serde_json::Value::as_u64) != Some(2) {
        return Err("deterministic shadow evidence schema_version must be 2".to_string());
    }
    if evidence.get("pattern_ref").and_then(serde_json::Value::as_str)
        != Some(params.pattern_ref.as_str())
        || evidence.get("implementation_ref").and_then(serde_json::Value::as_str)
            != Some(params.implementation_ref.as_str())
        || evidence.get("request_hash").and_then(serde_json::Value::as_str)
            != Some(params.request_hash.as_str())
    {
        return Err("deterministic shadow evidence identity does not match params".to_string());
    }

    let shadow_ref = format!("deterministic:{}", params.implementation_ref);
    if let Some(existing) =
        find_deterministic_shadow_event(ctx, run_id, &params.request_hash, &shadow_ref)
    {
        if existing.organization_id == organization_id
            && existing.decision_type_name.as_deref() == Some(params.decision_type_name.as_str())
            && existing.decision_type_version == Some(params.decision_type_version)
            && existing.request_json == params.request_json
            && existing.output_json == params.evidence_json
            && existing.model == params.implementation_ref
        {
            return Ok(());
        }
        return Err("deterministic shadow replay conflicts with the existing event".to_string());
    }

    ctx.db.ai_intelligence_event().insert(AiIntelligenceEvent {
        id: 0,
        organization_id,
        company_id,
        run_id,
        step_no: 0,
        event_kind: "deterministic_shadow".to_string(),
        decision_type_name: Some(params.decision_type_name),
        decision_type_version: Some(params.decision_type_version),
        request_hash: params.request_hash,
        request_json: params.request_json,
        outcome_kind: "deterministic".to_string(),
        output_json: params.evidence_json,
        confidence: None,
        provider: "deterministic".to_string(),
        model: params.implementation_ref,
        provider_attempt_id: None,
        input_tokens: 0,
        output_tokens: 0,
        verification_status: None,
        verification_reason: None,
        escalation_status: "none".to_string(),
        escalation_reason: None,
        acceptance_status: "rejected".to_string(),
        acceptance_reason: Some(
            "deterministic shadow evaluation carries zero live authority".to_string(),
        ),
        shadow_profile_ref: Some(shadow_ref),
        shadow_error: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });
    Ok(())
}

/// Persist an append-only DG-09 reduction of deterministic authority.
/// Rollback can only reduce authority; it can never reactivate or promote.
#[reducer]
pub fn record_ai_graduation_authority_rollback(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: RecordAiGraduationAuthorityRollbackParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_intelligence_event", "create")?;
    load_active_run(ctx, organization_id, company_id, run_id)?;

    if params.decision_type_name.trim().is_empty() || params.decision_type_version == 0 {
        return Err("decision type is required for authority rollback".to_string());
    }
    if params.pattern_ref.trim().is_empty() || params.implementation_ref.trim().is_empty() {
        return Err("pattern_ref and implementation_ref are required".to_string());
    }
    if !valid_authority_downgrade(&params.from_mode, &params.to_mode) {
        return Err("authority rollback must strictly reduce deterministic authority".to_string());
    }
    if params.reasons_json.len() > MAX_JSON_FIELD_LEN {
        return Err("rollback reasons_json is too long".to_string());
    }
    let reasons: serde_json::Value = serde_json::from_str(&params.reasons_json)
        .map_err(|_| "rollback reasons_json must be valid JSON".to_string())?;
    if !reasons.as_array().is_some_and(|items| !items.is_empty()) {
        return Err("authority rollback requires at least one reason".to_string());
    }

    let rollback_key = format!(
        "graduation-rollback:{}:{}:{}:{}",
        params.pattern_ref, params.implementation_ref, params.from_mode, params.to_mode
    );
    if let Some(existing) = ctx
        .db
        .ai_intelligence_event()
        .ai_intelligence_event_by_run()
        .filter(&run_id)
        .find(|event| {
            event.event_kind == "graduation_rollback"
                && event.request_hash == rollback_key
        })
    {
        if existing.organization_id == organization_id {
            return Ok(());
        }
        return Err("rollback event belongs to another organization".to_string());
    }

    let evidence_json = serde_json::json!({
        "schema_version": 1,
        "decision_type_name": params.decision_type_name,
        "decision_type_version": params.decision_type_version,
        "pattern_ref": params.pattern_ref,
        "implementation_ref": params.implementation_ref,
        "from_mode": params.from_mode,
        "to_mode": params.to_mode,
        "reasons": reasons,
    })
    .to_string();

    ctx.db.ai_intelligence_event().insert(AiIntelligenceEvent {
        id: 0,
        organization_id,
        company_id,
        run_id,
        step_no: 0,
        event_kind: "graduation_rollback".to_string(),
        decision_type_name: Some(params.decision_type_name),
        decision_type_version: Some(params.decision_type_version),
        request_hash: rollback_key,
        request_json: "{}".to_string(),
        outcome_kind: "authority_downgrade".to_string(),
        output_json: evidence_json,
        confidence: None,
        provider: "deterministic-governance".to_string(),
        model: params.implementation_ref,
        provider_attempt_id: None,
        input_tokens: 0,
        output_tokens: 0,
        verification_status: None,
        verification_reason: None,
        escalation_status: "none".to_string(),
        escalation_reason: None,
        acceptance_status: "accepted".to_string(),
        acceptance_reason: Some("automatic authority reduction; never promotion".to_string()),
        shadow_profile_ref: Some(params.pattern_ref),
        shadow_error: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });
    Ok(())
}

fn valid_authority_downgrade(from: &str, to: &str) -> bool {
    matches!(
        (from, to),
        ("deterministic_only", "deterministic_primary_model_shadow")
            | ("deterministic_only", "model_primary")
            | ("deterministic_primary_model_shadow", "model_primary")
    )
}

/// Record `VerificationService`'s (or, later, AIH-15's) outcome for one
/// event.
#[reducer]
pub fn set_ai_intelligence_event_verification(
    ctx: &ReducerContext,
    organization_id: u64,
    event_id: u64,
    status: String,
    reason: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_intelligence_event", "write")?;
    if !VERIFICATION_STATUSES.contains(&status.as_str()) {
        return Err(format!("status must be one of {VERIFICATION_STATUSES:?}"));
    }
    let event = load_event(ctx, organization_id, event_id)?;
    ctx.db
        .ai_intelligence_event()
        .id()
        .update(AiIntelligenceEvent {
            verification_status: Some(status),
            verification_reason: reason,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..event
        });
    Ok(())
}

/// Record whether this event's outcome required clarification, review, or
/// a hard stop — separate from verification and acceptance (see module docs).
#[reducer]
pub fn set_ai_intelligence_event_escalation(
    ctx: &ReducerContext,
    organization_id: u64,
    event_id: u64,
    status: String,
    reason: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_intelligence_event", "write")?;
    if !ESCALATION_STATUSES.contains(&status.as_str()) {
        return Err(format!("status must be one of {ESCALATION_STATUSES:?}"));
    }
    let event = load_event(ctx, organization_id, event_id)?;
    ctx.db
        .ai_intelligence_event()
        .id()
        .update(AiIntelligenceEvent {
            escalation_status: status,
            escalation_reason: reason,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..event
        });
    Ok(())
}

/// Record whether the governed program ultimately acted on this event's
/// judgment. Acceptance never implies verification passed or that nothing
/// was escalated — the three fields are independent, by design (module docs).
#[reducer]
pub fn set_ai_intelligence_event_acceptance(
    ctx: &ReducerContext,
    organization_id: u64,
    event_id: u64,
    status: String,
    reason: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_intelligence_event", "write")?;
    if !ACCEPTANCE_STATUSES.contains(&status.as_str()) {
        return Err(format!("status must be one of {ACCEPTANCE_STATUSES:?}"));
    }
    let event = load_event(ctx, organization_id, event_id)?;
    ctx.db
        .ai_intelligence_event()
        .id()
        .update(AiIntelligenceEvent {
            acceptance_status: status,
            acceptance_reason: reason,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..event
        });
    Ok(())
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn load_checkpointable_run(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
) -> Result<crate::ai::skills::AiAgentRun, String> {
    let run = ctx
        .db
        .ai_agent_run()
        .id()
        .find(&run_id)
        .ok_or("Run not found")?;
    if run.organization_id != organization_id || run.company_id != company_id {
        return Err("Run does not belong to this organization/company".to_string());
    }
    if !matches!(
        run.status.as_str(),
        "running" | "pending" | "awaiting_approval" | "agent_settled"
    ) {
        return Err("Run is not checkpointable".to_string());
    }
    Ok(run)
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

fn load_event(
    ctx: &ReducerContext,
    organization_id: u64,
    event_id: u64,
) -> Result<AiIntelligenceEvent, String> {
    let event = ctx
        .db
        .ai_intelligence_event()
        .id()
        .find(&event_id)
        .ok_or("Intelligence event not found")?;
    if event.organization_id != organization_id {
        return Err("Intelligence event does not belong to this organization".to_string());
    }
    Ok(event)
}

fn find_event(
    ctx: &ReducerContext,
    run_id: u64,
    step_no: u32,
    event_kind: &str,
) -> Option<AiIntelligenceEvent> {
    ctx.db
        .ai_intelligence_event()
        .ai_intelligence_event_by_run()
        .filter(&run_id)
        .find(|event| event.step_no == step_no && event.event_kind == event_kind)
}

fn find_shadow_event(
    ctx: &ReducerContext,
    run_id: u64,
    request_hash: &str,
    shadow_profile_ref: &str,
) -> Option<AiIntelligenceEvent> {
    ctx.db
        .ai_intelligence_event()
        .ai_intelligence_event_by_run()
        .filter(&run_id)
        .find(|event| {
            event.event_kind == "decision_shadow"
                && event.request_hash == request_hash
                && event.shadow_profile_ref.as_deref() == Some(shadow_profile_ref)
        })
}

fn find_deterministic_shadow_event(
    ctx: &ReducerContext,
    run_id: u64,
    request_hash: &str,
    shadow_profile_ref: &str,
) -> Option<AiIntelligenceEvent> {
    ctx.db
        .ai_intelligence_event()
        .ai_intelligence_event_by_run()
        .filter(&run_id)
        .find(|event| {
            event.event_kind == "deterministic_shadow"
                && event.request_hash == request_hash
                && event.shadow_profile_ref.as_deref() == Some(shadow_profile_ref)
        })
}

#[allow(clippy::too_many_arguments)]
fn validate_common(
    ctx: &ReducerContext,
    organization_id: u64,
    request_hash: &str,
    request_json: &str,
    output_json: &str,
    provider: &str,
    model: &str,
    provider_attempt_id: Option<u64>,
) -> Result<(), String> {
    if request_hash.trim().is_empty() {
        return Err("request_hash is required".to_string());
    }
    if request_json.len() > MAX_JSON_FIELD_LEN {
        return Err("request_json is too long".to_string());
    }
    if output_json.len() > MAX_JSON_FIELD_LEN {
        return Err("output_json is too long".to_string());
    }
    if provider.trim().is_empty() {
        return Err("provider is required".to_string());
    }
    if model.trim().is_empty() {
        return Err("model is required".to_string());
    }
    if let Some(attempt_id) = provider_attempt_id {
        let attempt = ctx
            .db
            .ai_provider_attempt()
            .id()
            .find(&attempt_id)
            .ok_or("provider_attempt_id does not reference an existing attempt")?;
        if attempt.organization_id != organization_id {
            return Err("provider attempt does not belong to this organization".to_string());
        }
    }
    Ok(())
}

fn decision_payload_matches(
    existing: &AiIntelligenceEvent,
    params: &RecordAiDecisionEventParams,
) -> bool {
    existing.decision_type_name.as_deref() == Some(params.decision_type_name.as_str())
        && existing.decision_type_version == Some(params.decision_type_version)
        && existing.request_hash == params.request_hash
        && existing.request_json == params.request_json
        && existing.outcome_kind == params.outcome_kind
        && existing.output_json == params.output_json
        && existing.confidence == params.confidence
        && existing.provider == params.provider
        && existing.model == params.model
        && existing.provider_attempt_id == params.provider_attempt_id
        && existing.input_tokens == params.input_tokens
        && existing.output_tokens == params.output_tokens
}

fn reasoning_payload_matches(
    existing: &AiIntelligenceEvent,
    params: &RecordAiReasoningEventParams,
) -> bool {
    existing.request_hash == params.request_hash
        && existing.request_json == params.request_json
        && existing.outcome_kind == params.outcome_kind
        && existing.output_json == params.output_json
        && existing.provider == params.provider
        && existing.model == params.model
        && existing.provider_attempt_id == params.provider_attempt_id
        && existing.input_tokens == params.input_tokens
        && existing.output_tokens == params.output_tokens
}

fn shadow_payload_matches(
    existing: &AiIntelligenceEvent,
    params: &RecordAiDecisionShadowEventParams,
    outcome_kind: &str,
    output_json: &str,
) -> bool {
    existing.decision_type_name.as_deref() == Some(params.decision_type_name.as_str())
        && existing.decision_type_version == Some(params.decision_type_version)
        && existing.request_hash == params.request_hash
        && existing.request_json == params.request_json
        && existing.outcome_kind == outcome_kind
        && existing.output_json == output_json
        && existing.confidence == params.confidence
        && existing.provider == params.provider
        && existing.model == params.model
        && existing.input_tokens == params.input_tokens
        && existing.output_tokens == params.output_tokens
        && existing.shadow_error == params.shadow_error
}


#[cfg(test)]
mod graduation_rollback_tests {
    use super::*;

    #[test]
    fn rollback_edges_only_reduce_authority() {
        assert!(valid_authority_downgrade(
            "deterministic_only",
            "deterministic_primary_model_shadow"
        ));
        assert!(valid_authority_downgrade(
            "deterministic_primary_model_shadow",
            "model_primary"
        ));
        assert!(!valid_authority_downgrade(
            "model_primary",
            "deterministic_primary_model_shadow"
        ));
        assert!(!valid_authority_downgrade(
            "deterministic_primary_model_shadow",
            "deterministic_only"
        ));
    }
}
