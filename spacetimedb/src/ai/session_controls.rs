//! AIH-24 — Session interruption, resume and alternative comparison (M3).
//!
//! Typed server-owned inspect/interrupt/resume/fork/compare intents with a
//! durable intent ledger, per-run concurrency control state, and durable
//! per-client event cursors (§8.4).
//!
//! ## Outcome contract (reducers never return data)
//!
//! Reducers are transactional: returning `Err` rolls back every write in the
//! call, so a durable `rejected`/`duplicate` intent row can only persist when
//! the reducer returns `Ok`. Therefore every well-formed request returns
//! `Ok(())` and records exactly one intent row in `ai_session_control` whose
//! `status` is `applied`, `duplicate` or `rejected`; clients and the
//! ai-gateway observe the outcome (including the rejection `reason` and
//! `result_json`) through SQL on that table. Only malformed input (zero ids,
//! over-length keys) returns `Err` before any row is written, and an internal
//! failure while applying effects returns `Err` so the whole transaction rolls
//! back rather than leaving partial state.
//!
//! ## Concurrency and idempotency
//!
//! - Idempotency scope is `(organization_id, kind, idempotency_key)`: a retried
//!   request whose key matches a prior **applied** intent of the same kind is
//!   recorded as `duplicate` and returns `Ok` without re-applying any effect.
//!   Rejected intents do not consume the key (the client may retry).
//! - `ai_run_control_state.control_version` advances by 1 on each **applied
//!   steering intent** (`interrupt`, `resume`, `fork`). Observation intents
//!   (`inspect`, `compare`) are recorded as applied but never mutate an
//!   existing control-state row, so reads never invalidate a concurrent
//!   resume's `expected_control_version`. `resume` compares the client's
//!   `expected_control_version` against the current version and rejects on
//!   mismatch (stale client).
//!
//! ## Resume gate
//!
//! Before a run is re-queued as `pending`, resume rechecks, in order: run
//! interrupted state, control version, provider attempts (any
//! `outcome_unknown` attempt must be reconciled first via
//! `reconcile_ai_provider_attempt`), and — when a checkpoint manifest is
//! supplied — that its pending questions are still `open`/`answered` and its
//! snapshot sources are still `available` (recalled/denied/missing sources
//! reject without exposing content).
//!
//! ## Forks and comparison
//!
//! A fork supersedes the parent checkpoint manifest, creates a fresh run
//! (parked as `pending`, no action drafts, no approvals — scope, budget and
//! execution approval must be reacquired) and links lineage through run
//! metadata and the intent `result_json`. `compare` records a structured diff
//! between two manifests of the same run; selecting a candidate never reverses
//! posted ERP state (`erp_state_rolled_back` is always `false`).
//!
//! ## Audit policy
//!
//! `write_audit_log_v2` fires on every intent row insert, on control-state
//! create/update, and on run-status changes made here (interrupt is audited
//! inside `set_ai_agent_run_wait_state`; resume re-queue and the fork run's
//! `pending` park audit directly). Event-cursor **advances** after creation
//! are deliberately not audited: they are high-frequency client bookkeeping
//! with no authority change (creation is still audited).

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::ai::continuation::{
    ai_continuation_manifest, fork_ai_continuation_manifest, AiContinuationManifest,
};
use crate::ai::provenance::{ai_source_version, AiSourceVersion};
use crate::ai::questions::ai_question;
use crate::ai::skills::{
    ai_agent_run, ai_agent_run_step, create_ai_agent_run, set_ai_agent_run_wait_state, AiAgentRun,
    CreateAiAgentRunParams, SetAiAgentRunWaitStateParams,
};
use crate::ai::spend::ai_provider_attempt;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

const MAX_IDEMPOTENCY_KEY_LEN: usize = 128;
const MAX_CLIENT_KEY_LEN: usize = 128;
const MAX_REASON_LEN: usize = 2000;
const MAX_PAYLOAD_JSON_LEN: usize = 8000;
const MAX_RESULT_JSON_LEN: usize = 32_000;
/// Upper bound for derived fork run keys (`<parent>-fork-<idempotency key>`).
const MAX_FORK_RUN_KEY_LEN: usize = 256;
const AUTO_INC_SENTINEL: u64 = 0;

// Availability semantics — mirrors inspector.rs (AiSourceVersion has no
// availability column; availability is derived from origin/scope/ownership).
const AVAILABILITY_AVAILABLE: &str = "available";
const AVAILABILITY_DENIED: &str = "denied";
const AVAILABILITY_UNAVAILABLE: &str = "unavailable";
const AVAILABILITY_RECALLED: &str = "recalled";

const ATTEMPT_OUTCOME_UNKNOWN: &str = "outcome_unknown";

const KIND_INSPECT: &str = "inspect";
const KIND_INTERRUPT: &str = "interrupt";
const KIND_RESUME: &str = "resume";
const KIND_FORK: &str = "fork";
const KIND_COMPARE: &str = "compare";

const INTENT_APPLIED: &str = "applied";
const INTENT_DUPLICATE: &str = "duplicate";
const INTENT_REJECTED: &str = "rejected";

// ── Tables ─────────────────────────────────────────────────────────────────

/// Per-run concurrency/control state, lazily created on the first intent for
/// a run. One row per run (uniqueness enforced manually — the table has no
/// unique index on `run_id`).
///
/// `phase`:
/// - `active`              — run has recorded intents but no steering applied
/// - `interrupt_requested` — reserved for the gateway's stop-scheduling signal
///   (observed via SQL; not set by the reducers in this module)
/// - `interrupted`         — an applied interrupt parked the run
/// - `resumed`             — an applied resume re-queued the run
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_run_control_state,
    public,
    index(accessor = ai_run_control_state_by_org, btree(columns = [organization_id])),
    index(accessor = ai_run_control_state_by_run, btree(columns = [run_id]))
)]
pub struct AiRunControlState {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub run_id: u64,
    /// Advances by 1 on each applied steering intent (interrupt/resume/fork).
    pub control_version: u32,
    /// `active` | `interrupt_requested` | `interrupted` | `resumed`
    pub phase: String,
    pub last_intent_id: Option<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

/// Durable intent ledger — one row per well-formed session-control request.
/// This is the outcome surface clients and the ai-gateway observe via SQL; it
/// contains no secrets (payload/result carry ids, statuses and bounded text
/// only).
///
/// `kind`: `inspect` | `interrupt` | `resume` | `fork` | `compare`
/// `status`: `applied` | `duplicate` | `rejected`
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_session_control,
    public,
    index(accessor = ai_session_control_by_org, btree(columns = [organization_id])),
    index(accessor = ai_session_control_by_run, btree(columns = [run_id])),
    index(
        accessor = ai_session_control_by_org_key,
        btree(columns = [organization_id, idempotency_key])
    )
)]
pub struct AiSessionControl {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub run_id: u64,
    /// `inspect` | `interrupt` | `resume` | `fork` | `compare`
    pub kind: String,
    /// Client-chosen idempotency key, unique per (org, kind) among applied intents.
    pub idempotency_key: String,
    pub requested_by: Identity,
    /// `applied` | `duplicate` | `rejected`
    pub status: String,
    /// Rejection reason, or the caller-supplied reason for an applied interrupt.
    pub reason: Option<String>,
    /// Serialized request params for audit (bounded).
    pub payload_json: String,
    /// Serialized outcome payload for the client (bounded).
    pub result_json: Option<String>,
    pub created_at: Timestamp,
    pub applied_at: Option<Timestamp>,
}

/// Durable per-client event cursor for a run — reconnecting clients resume
/// from `last_step_id` instead of resending a consequential step. Unique per
/// `(organization_id, run_id, client_key)` (enforced manually).
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_run_event_cursor,
    public,
    index(accessor = ai_run_event_cursor_by_org, btree(columns = [organization_id])),
    index(accessor = ai_run_event_cursor_by_run, btree(columns = [run_id]))
)]
pub struct AiRunEventCursor {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub run_id: u64,
    pub client_key: String,
    pub last_step_id: u64,
    pub updated_by: Identity,
    pub updated_at: Timestamp,
}

// ── Params ─────────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct RequestAiRunInterruptParams {
    pub run_id: u64,
    pub idempotency_key: String,
    pub reason: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RequestAiRunResumeParams {
    pub run_id: u64,
    pub idempotency_key: String,
    /// Must equal the current `control_version` — stale clients are rejected.
    pub expected_control_version: u32,
    /// Optional checkpoint manifest whose dependencies are rechecked.
    pub manifest_id: Option<u64>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RequestAiRunForkParams {
    pub run_id: u64,
    pub parent_manifest_id: u64,
    pub idempotency_key: String,
    pub new_remaining_budget_tokens: u32,
    pub new_budget_reserved_until: Timestamp,
    pub new_progress_state_json: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RequestAiRunCompareParams {
    pub run_id: u64,
    pub baseline_manifest_id: u64,
    pub candidate_manifest_id: u64,
    pub idempotency_key: String,
}

// ── Validation helpers ──────────────────────────────────────────────────────

fn validate_nonempty(field: &str, value: &str, max: usize) -> Result<String, String> {
    let v = value.trim().to_string();
    if v.is_empty() {
        return Err(format!("{field} is required"));
    }
    if v.len() > max {
        return Err(format!("{field} exceeds {max} characters"));
    }
    Ok(v)
}

fn validate_optional(
    field: &str,
    value: &Option<String>,
    max: usize,
) -> Result<Option<String>, String> {
    match value {
        None => Ok(None),
        Some(raw) if raw.trim().is_empty() => Ok(None),
        Some(raw) if raw.trim().len() > max => Err(format!("{field} exceeds {max} characters")),
        Some(raw) => Ok(Some(raw.trim().to_string())),
    }
}

fn validate_payload_len(payload: &str) -> Result<(), String> {
    if payload.len() > MAX_PAYLOAD_JSON_LEN {
        return Err(format!(
            "serialized request payload exceeds {MAX_PAYLOAD_JSON_LEN} characters"
        ));
    }
    Ok(())
}

fn validate_result_len(result: &str) -> Result<(), String> {
    if result.len() > MAX_RESULT_JSON_LEN {
        return Err(format!(
            "intent result exceeds {MAX_RESULT_JSON_LEN} characters"
        ));
    }
    Ok(())
}

/// Parse a JSON array of u64 IDs, tolerating empty arrays.
fn parse_id_array(json: &str) -> Result<Vec<u64>, String> {
    let trimmed = json.trim();
    if trimmed.is_empty() || trimmed == "[]" {
        return Ok(vec![]);
    }
    serde_json::from_str::<Vec<u64>>(trimmed).map_err(|e| format!("invalid ID array JSON: {e}"))
}

/// Parse `candidate_versions_json` entries `[{component_id, version, hash}]`
/// into `(component_id, version)` pairs (hash is not needed for diffing).
fn parse_candidate_versions(json: &str) -> Result<Vec<(u64, u32)>, String> {
    let trimmed = json.trim();
    if trimmed.is_empty() || trimmed == "[]" {
        return Ok(vec![]);
    }
    let entries: Vec<serde_json::Value> = serde_json::from_str(trimmed)
        .map_err(|e| format!("invalid candidate versions JSON: {e}"))?;
    let mut out = Vec::with_capacity(entries.len());
    for entry in entries {
        let component_id = entry
            .get("component_id")
            .and_then(|v| v.as_u64())
            .ok_or("candidate versions entry is missing component_id")?;
        let version = entry
            .get("version")
            .and_then(|v| v.as_u64())
            .map(u32::try_from)
            .transpose()
            .map_err(|_| "candidate version exceeds u32 range".to_string())?
            .unwrap_or(0);
        out.push((component_id, version));
    }
    Ok(out)
}

/// Count entries in a `completed_effects_json` array.
fn count_completed_effects(json: &str) -> Result<u64, String> {
    let trimmed = json.trim();
    if trimmed.is_empty() || trimmed == "[]" {
        return Ok(0);
    }
    let entries: Vec<serde_json::Value> = serde_json::from_str(trimmed)
        .map_err(|e| format!("invalid completed effects JSON: {e}"))?;
    Ok(entries.len() as u64)
}

fn run_is_terminal(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "cancelled")
}

/// Availability of a snapshot source for the current caller, reusing the
/// inspector's semantics: a recalled origin is `recalled`; a private source
/// owned by another identity is `denied`; otherwise `available`. Missing rows
/// map to `unavailable` at the call site.
fn source_availability(ctx: &ReducerContext, source: &AiSourceVersion) -> &'static str {
    if source.origin == AVAILABILITY_RECALLED {
        AVAILABILITY_RECALLED
    } else if source.scope == "private" && source.owner_identity != Some(ctx.sender()) {
        AVAILABILITY_DENIED
    } else {
        AVAILABILITY_AVAILABLE
    }
}

/// Truncate a derived string at a UTF-8 character boundary.
fn truncate_at_char_boundary(value: String, max: usize) -> String {
    if value.len() <= max {
        return value;
    }
    let mut end = max;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}

// ── Shared row helpers ──────────────────────────────────────────────────────

fn load_org_run(
    ctx: &ReducerContext,
    organization_id: u64,
    run_id: u64,
) -> Result<AiAgentRun, String> {
    let run = ctx
        .db
        .ai_agent_run()
        .id()
        .find(&run_id)
        .ok_or("run not found")?;
    if run.organization_id != organization_id {
        return Err("run does not belong to this organization".to_string());
    }
    Ok(run)
}

fn find_control_state(
    ctx: &ReducerContext,
    organization_id: u64,
    run_id: u64,
) -> Option<AiRunControlState> {
    ctx.db
        .ai_run_control_state()
        .ai_run_control_state_by_run()
        .filter(&run_id)
        .find(|cs| cs.organization_id == organization_id)
}

/// Lazily create the control state for a run on its first intent. The caller
/// must have already loaded and org-checked the run.
fn ensure_control_state(
    ctx: &ReducerContext,
    organization_id: u64,
    run_id: u64,
    company_id: u64,
) -> AiRunControlState {
    if let Some(existing) = find_control_state(ctx, organization_id, run_id) {
        return existing;
    }
    let row = ctx.db.ai_run_control_state().insert(AiRunControlState {
        id: AUTO_INC_SENTINEL,
        organization_id,
        company_id,
        run_id,
        control_version: 0,
        phase: "active".to_string(),
        last_intent_id: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_run_control_state",
            record_id: row.id,
            action: "create",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "run_id": run_id,
                    "phase": "active",
                    "control_version": 0,
                })
                .to_string(),
            ),
            changed_fields: vec!["run_id".to_string(), "phase".to_string()],
            metadata: None,
        },
    );
    row
}

/// Prior applied intent with the same (org, kind, idempotency key), if any.
fn find_applied_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    kind: &str,
    idempotency_key: &str,
) -> Option<AiSessionControl> {
    ctx.db
        .ai_session_control()
        .ai_session_control_by_org_key()
        .filter((&organization_id, &idempotency_key.to_string()))
        .find(|intent| intent.kind == kind && intent.status == INTENT_APPLIED)
}

/// Insert one intent row (the durable outcome record) and audit it.
#[allow(clippy::too_many_arguments)]
fn record_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    run_id: u64,
    kind: &str,
    idempotency_key: &str,
    status: &str,
    reason: Option<String>,
    payload_json: String,
    result_json: Option<String>,
) -> AiSessionControl {
    let row = ctx.db.ai_session_control().insert(AiSessionControl {
        id: AUTO_INC_SENTINEL,
        organization_id,
        company_id,
        run_id,
        kind: kind.to_string(),
        idempotency_key: idempotency_key.to_string(),
        requested_by: ctx.sender(),
        status: status.to_string(),
        reason,
        payload_json,
        result_json,
        created_at: ctx.timestamp,
        applied_at: (status == INTENT_APPLIED).then_some(ctx.timestamp),
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name: "ai_session_control",
            record_id: row.id,
            action: "create",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "kind": kind,
                    "status": status,
                    "run_id": run_id,
                    "idempotency_key": idempotency_key,
                })
                .to_string(),
            ),
            changed_fields: vec!["kind".to_string(), "status".to_string()],
            metadata: None,
        },
    );
    row
}

/// Record a duplicate of `prior` and return Ok without re-applying effects.
fn record_duplicate(
    ctx: &ReducerContext,
    organization_id: u64,
    prior: &AiSessionControl,
    run_id: u64,
    kind: &str,
    idempotency_key: &str,
    payload_json: String,
) {
    record_intent(
        ctx,
        organization_id,
        prior.company_id,
        run_id,
        kind,
        idempotency_key,
        INTENT_DUPLICATE,
        None,
        payload_json,
        Some(serde_json::json!({ "duplicate_of_intent_id": prior.id }).to_string()),
    );
}

/// Record a rejected intent; the reducer then returns Ok so the rejection
/// persists (see the module outcome contract).
fn record_rejected(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    run_id: u64,
    kind: &str,
    idempotency_key: &str,
    payload_json: String,
    reason: String,
) {
    record_intent(
        ctx,
        organization_id,
        company_id,
        run_id,
        kind,
        idempotency_key,
        INTENT_REJECTED,
        Some(reason),
        payload_json,
        None,
    );
}

/// Advance a control state after an applied steering intent (phase, version,
/// last intent) and audit the update.
fn apply_control_advance(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    control: AiRunControlState,
    phase: Option<&str>,
    new_version: u32,
    intent_id: u64,
) {
    let previous_version = control.control_version;
    ctx.db
        .ai_run_control_state()
        .id()
        .update(AiRunControlState {
            control_version: new_version,
            phase: phase
                .map(|p| p.to_string())
                .unwrap_or(control.phase.clone()),
            last_intent_id: Some(intent_id),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..control
        });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_run_control_state",
            record_id: intent_id,
            action: "update",
            old_values: Some(
                serde_json::json!({ "control_version": previous_version }).to_string(),
            ),
            new_values: Some(
                serde_json::json!({
                    "control_version": new_version,
                    "last_intent_id": intent_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["control_version".to_string()],
            metadata: None,
        },
    );
}

/// Common entry validation shared by every session-control reducer. Returns
/// the trimmed idempotency key.
fn validate_request(
    ctx: &ReducerContext,
    organization_id: u64,
    run_id: u64,
    idempotency_key: &str,
) -> Result<String, String> {
    check_permission(ctx, organization_id, "ai_session_control", "write")?;
    if organization_id == AUTO_INC_SENTINEL {
        return Err("organization_id is required".to_string());
    }
    if run_id == AUTO_INC_SENTINEL {
        return Err("run_id must be nonzero".to_string());
    }
    validate_nonempty("idempotency_key", idempotency_key, MAX_IDEMPOTENCY_KEY_LEN)
}

// ── Reducers ───────────────────────────────────────────────────────────────

/// Inspect a run's control state for reconnecting clients: run status,
/// control phase/version, open questions, step count and last step id.
/// Read-only with respect to the run; lazily creates the control state.
#[reducer]
pub fn request_ai_run_inspect(
    ctx: &ReducerContext,
    organization_id: u64,
    run_id: u64,
    idempotency_key: String,
) -> Result<(), String> {
    let idempotency_key = validate_request(ctx, organization_id, run_id, &idempotency_key)?;
    let payload_json = serde_json::json!({
        "run_id": run_id,
        "idempotency_key": idempotency_key,
    })
    .to_string();
    validate_payload_len(&payload_json)?;

    // Idempotency first: a retried inspect never re-applies.
    if let Some(prior) = find_applied_intent(ctx, organization_id, KIND_INSPECT, &idempotency_key) {
        record_duplicate(
            ctx,
            organization_id,
            &prior,
            run_id,
            KIND_INSPECT,
            &idempotency_key,
            payload_json,
        );
        return Ok(());
    }

    let run = match load_org_run(ctx, organization_id, run_id) {
        Ok(run) => run,
        Err(reason) => {
            record_rejected(
                ctx,
                organization_id,
                None,
                run_id,
                KIND_INSPECT,
                &idempotency_key,
                payload_json,
                reason,
            );
            return Ok(());
        }
    };

    // Lazily create the control state on the first intent for the run. An
    // inspect never mutates an existing control-state row.
    let control = ensure_control_state(ctx, organization_id, run.id, run.company_id);

    let mut open_questions: Vec<serde_json::Value> = ctx
        .db
        .ai_question()
        .ai_question_by_run()
        .filter(&run_id)
        .filter(|q| q.organization_id == organization_id && q.status == "open")
        .map(|q| {
            serde_json::json!({
                "id": q.id,
                "question_key": q.question_key,
                "kind": q.kind,
            })
        })
        .collect();
    open_questions.sort_by_key(|q| q.get("id").and_then(|v| v.as_u64()).unwrap_or(0));

    let last_step_id = ctx
        .db
        .ai_agent_run_step()
        .ai_agent_run_step_by_run()
        .filter(&run_id)
        .filter(|step| step.organization_id == organization_id)
        .map(|step| step.id)
        .max()
        .unwrap_or(0);

    let result_json = serde_json::json!({
        "run_id": run.id,
        "run_status": run.status,
        "control_phase": control.phase,
        "control_version": control.control_version,
        "open_questions": open_questions,
        "step_count": run.step_count,
        "last_step_id": last_step_id,
    })
    .to_string();
    if let Err(reason) = validate_result_len(&result_json) {
        record_rejected(
            ctx,
            organization_id,
            Some(run.company_id),
            run_id,
            KIND_INSPECT,
            &idempotency_key,
            payload_json,
            reason,
        );
        return Ok(());
    }

    record_intent(
        ctx,
        organization_id,
        Some(run.company_id),
        run_id,
        KIND_INSPECT,
        &idempotency_key,
        INTENT_APPLIED,
        None,
        payload_json,
        Some(result_json),
    );
    Ok(())
}

/// Interrupt a run: parks it in the non-terminal `interrupted` wait state (no
/// new steps, drafts or spend reservations are accepted while parked) and sets
/// the control phase to `interrupted`. Terminal runs reject.
#[reducer]
pub fn request_ai_run_interrupt(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RequestAiRunInterruptParams,
) -> Result<(), String> {
    let idempotency_key =
        validate_request(ctx, organization_id, params.run_id, &params.idempotency_key)?;
    let reason = validate_optional("reason", &params.reason, MAX_REASON_LEN)?;
    let payload_json = serde_json::json!({
        "run_id": params.run_id,
        "idempotency_key": idempotency_key,
        "reason": reason,
    })
    .to_string();
    validate_payload_len(&payload_json)?;

    // Idempotency first: a retried interrupt must not re-apply (or re-bump).
    if let Some(prior) = find_applied_intent(ctx, organization_id, KIND_INTERRUPT, &idempotency_key)
    {
        record_duplicate(
            ctx,
            organization_id,
            &prior,
            params.run_id,
            KIND_INTERRUPT,
            &idempotency_key,
            payload_json,
        );
        return Ok(());
    }

    let run = match load_org_run(ctx, organization_id, params.run_id) {
        Ok(run) => run,
        Err(err) => {
            record_rejected(
                ctx,
                organization_id,
                None,
                params.run_id,
                KIND_INTERRUPT,
                &idempotency_key,
                payload_json,
                err,
            );
            return Ok(());
        }
    };

    if run_is_terminal(&run.status) {
        record_rejected(
            ctx,
            organization_id,
            Some(run.company_id),
            run.id,
            KIND_INTERRUPT,
            &idempotency_key,
            payload_json,
            format!(
                "run is terminal (status={}); interrupt rejected",
                run.status
            ),
        );
        return Ok(());
    }

    let control = ensure_control_state(ctx, organization_id, run.id, run.company_id);
    let new_version = control
        .control_version
        .checked_add(1)
        .ok_or("control version overflow")?;

    // Park the run. set_ai_agent_run_wait_state accepts `interrupted` from any
    // non-terminal state (pending/running/awaiting_approval/agent_settled) and
    // is a no-op when the run is already interrupted; it audits the run change.
    let previous_status = run.status.clone();
    if let Err(err) = set_ai_agent_run_wait_state(
        ctx,
        organization_id,
        run.company_id,
        run.id,
        SetAiAgentRunWaitStateParams {
            status: "interrupted".to_string(),
        },
    ) {
        // Defensive: unreachable after the terminal check. Roll the whole
        // transaction back rather than recording a partial park.
        return Err(err);
    }

    let result_json = serde_json::json!({
        "previous_status": previous_status,
        "new_status": "interrupted",
        "control_version": new_version,
    })
    .to_string();
    validate_result_len(&result_json)?;

    let intent = record_intent(
        ctx,
        organization_id,
        Some(run.company_id),
        run.id,
        KIND_INTERRUPT,
        &idempotency_key,
        INTENT_APPLIED,
        reason,
        payload_json,
        Some(result_json),
    );
    apply_control_advance(
        ctx,
        organization_id,
        run.company_id,
        control,
        Some("interrupted"),
        new_version,
        intent.id,
    );
    Ok(())
}

/// Resume an interrupted run — the core gate. Checks, in order:
/// (a) idempotency, (b) run is interrupted, (c) expected control version,
/// (d) no `outcome_unknown` provider attempts, (e) checkpoint manifest
/// dependencies (questions still open/answered, sources still available).
/// On success re-queues the run as `pending`.
#[reducer]
pub fn request_ai_run_resume(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RequestAiRunResumeParams,
) -> Result<(), String> {
    let idempotency_key =
        validate_request(ctx, organization_id, params.run_id, &params.idempotency_key)?;
    if let Some(manifest_id) = params.manifest_id {
        if manifest_id == AUTO_INC_SENTINEL {
            return Err("manifest_id must be nonzero when supplied".to_string());
        }
    }
    let payload_json = serde_json::json!({
        "run_id": params.run_id,
        "idempotency_key": idempotency_key,
        "expected_control_version": params.expected_control_version,
        "manifest_id": params.manifest_id,
    })
    .to_string();
    validate_payload_len(&payload_json)?;

    // (a) Idempotency: a prior applied resume with this key is a duplicate.
    if let Some(prior) = find_applied_intent(ctx, organization_id, KIND_RESUME, &idempotency_key) {
        record_duplicate(
            ctx,
            organization_id,
            &prior,
            params.run_id,
            KIND_RESUME,
            &idempotency_key,
            payload_json,
        );
        return Ok(());
    }

    // (b) Run exists in org and is interrupted.
    let run = match load_org_run(ctx, organization_id, params.run_id) {
        Ok(run) => run,
        Err(reason) => {
            record_rejected(
                ctx,
                organization_id,
                None,
                params.run_id,
                KIND_RESUME,
                &idempotency_key,
                payload_json,
                reason,
            );
            return Ok(());
        }
    };
    if run.status != "interrupted" {
        record_rejected(
            ctx,
            organization_id,
            Some(run.company_id),
            run.id,
            KIND_RESUME,
            &idempotency_key,
            payload_json,
            format!("run is not interrupted (status={})", run.status),
        );
        return Ok(());
    }

    let control = ensure_control_state(ctx, organization_id, run.id, run.company_id);

    // (c) Concurrency: stale clients are rejected without bumping the version.
    if params.expected_control_version != control.control_version {
        record_rejected(
            ctx,
            organization_id,
            Some(run.company_id),
            run.id,
            KIND_RESUME,
            &idempotency_key,
            payload_json,
            format!(
                "control version mismatch: expected {}, current {}",
                params.expected_control_version, control.control_version
            ),
        );
        return Ok(());
    }

    // (d) Reconciliation: an in-flight consequential call with an uncertain
    // outcome must be resolved via reconcile_ai_provider_attempt first.
    let unknown_attempts: Vec<u64> = ctx
        .db
        .ai_provider_attempt()
        .ai_provider_attempt_by_run()
        .filter(&run.id)
        .filter(|attempt| {
            attempt.organization_id == organization_id && attempt.status == ATTEMPT_OUTCOME_UNKNOWN
        })
        .map(|attempt| attempt.id)
        .collect();
    if !unknown_attempts.is_empty() {
        let ids = unknown_attempts
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join(", ");
        record_rejected(
            ctx,
            organization_id,
            Some(run.company_id),
            run.id,
            KIND_RESUME,
            &idempotency_key,
            payload_json,
            format!("pending reconciliation for attempts [{ids}]"),
        );
        return Ok(());
    }

    // (e) Dependency recheck against the checkpoint manifest, when supplied.
    let mut reconciled_checks = vec!["provider_attempts"];
    if let Some(manifest_id) = params.manifest_id {
        let manifest = match ctx.db.ai_continuation_manifest().id().find(&manifest_id) {
            Some(manifest) => manifest,
            None => {
                record_rejected(
                    ctx,
                    organization_id,
                    Some(run.company_id),
                    run.id,
                    KIND_RESUME,
                    &idempotency_key,
                    payload_json,
                    "manifest not found".to_string(),
                );
                return Ok(());
            }
        };
        if manifest.organization_id != organization_id {
            record_rejected(
                ctx,
                organization_id,
                Some(run.company_id),
                run.id,
                KIND_RESUME,
                &idempotency_key,
                payload_json,
                "manifest does not belong to this organization".to_string(),
            );
            return Ok(());
        }
        if manifest.status != "active" {
            record_rejected(
                ctx,
                organization_id,
                Some(run.company_id),
                run.id,
                KIND_RESUME,
                &idempotency_key,
                payload_json,
                format!(
                    "manifest is not active (status={}); superseded or unrecoverable checkpoints cannot be resumed",
                    manifest.status
                ),
            );
            return Ok(());
        }
        if manifest.run_id != run.id {
            record_rejected(
                ctx,
                organization_id,
                Some(run.company_id),
                run.id,
                KIND_RESUME,
                &idempotency_key,
                payload_json,
                "manifest belongs to a different run".to_string(),
            );
            return Ok(());
        }

        // Pending questions must still be open or answered (answered = the
        // requirement was resolved); stale/timed_out/superseded questions mean
        // the requirements changed since the checkpoint.
        let question_ids = match parse_id_array(&manifest.pending_question_ids_json) {
            Ok(ids) => ids,
            Err(reason) => {
                record_rejected(
                    ctx,
                    organization_id,
                    Some(run.company_id),
                    run.id,
                    KIND_RESUME,
                    &idempotency_key,
                    payload_json,
                    reason,
                );
                return Ok(());
            }
        };
        for question_id in &question_ids {
            let rejected = match ctx.db.ai_question().id().find(question_id) {
                None => Some(format!(
                    "requirements changed since checkpoint: question {question_id} no longer exists"
                )),
                Some(q) if q.organization_id != organization_id => Some(format!(
                    "requirements changed since checkpoint: question {question_id} is not available in this organization"
                )),
                Some(q) if q.status != "open" && q.status != "answered" => Some(format!(
                    "requirements changed since checkpoint: question {question_id} is {}",
                    q.status
                )),
                _ => None,
            };
            if let Some(reason) = rejected {
                record_rejected(
                    ctx,
                    organization_id,
                    Some(run.company_id),
                    run.id,
                    KIND_RESUME,
                    &idempotency_key,
                    payload_json,
                    reason,
                );
                return Ok(());
            }
        }

        // Snapshot sources must still be available. The rejection names only
        // the source id — never titles, excerpts or snapshot identity.
        let source_ids = match parse_id_array(&manifest.snapshot_sources_json) {
            Ok(ids) => ids,
            Err(reason) => {
                record_rejected(
                    ctx,
                    organization_id,
                    Some(run.company_id),
                    run.id,
                    KIND_RESUME,
                    &idempotency_key,
                    payload_json,
                    reason,
                );
                return Ok(());
            }
        };
        for source_id in &source_ids {
            // Names only the source id — never titles, excerpts or snapshot
            // identity — so an unavailable source leaks no content.
            let availability = match ctx.db.ai_source_version().id().find(source_id) {
                None => AVAILABILITY_UNAVAILABLE,
                Some(source) if source.organization_id != organization_id => {
                    AVAILABILITY_UNAVAILABLE
                }
                Some(source) => source_availability(ctx, &source),
            };
            if availability != AVAILABILITY_AVAILABLE {
                record_rejected(
                    ctx,
                    organization_id,
                    Some(run.company_id),
                    run.id,
                    KIND_RESUME,
                    &idempotency_key,
                    payload_json,
                    format!("snapshot source {source_id} is no longer available"),
                );
                return Ok(());
            }
        }
        reconciled_checks.push("questions");
        reconciled_checks.push("sources");
    }

    // (f) Apply: re-queue the run as pending and advance the control state.
    let new_version = control
        .control_version
        .checked_add(1)
        .ok_or("control version overflow")?;
    let result_json = serde_json::json!({
        "control_version": new_version,
        "reconciled_checks": reconciled_checks,
        "manifest_id": params.manifest_id,
    })
    .to_string();
    validate_result_len(&result_json)?;

    let intent = record_intent(
        ctx,
        organization_id,
        Some(run.company_id),
        run.id,
        KIND_RESUME,
        &idempotency_key,
        INTENT_APPLIED,
        None,
        payload_json,
        Some(result_json),
    );
    apply_control_advance(
        ctx,
        organization_id,
        run.company_id,
        control,
        Some("resumed"),
        new_version,
        intent.id,
    );

    // Re-queue the run. No existing reducer moves a run back to `pending`, so
    // update directly, mirroring set_ai_agent_run_wait_state's audit pattern.
    let previous_status = run.status.clone();
    let company_id = run.company_id;
    let run_id = run.id;
    ctx.db.ai_agent_run().id().update(AiAgentRun {
        status: "pending".to_string(),
        write_date: ctx.timestamp,
        ..run
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_agent_run",
            record_id: run_id,
            action: "update",
            old_values: Some(serde_json::json!({ "status": previous_status }).to_string()),
            new_values: Some(serde_json::json!({ "status": "pending" }).to_string()),
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Fork a run from an active checkpoint manifest: supersedes the parent
/// manifest, creates a fork manifest with the supplied budget, and creates a
/// NEW run (parked as `pending`) that inherits objective/skill/agent lineage
/// but no action drafts and no approvals. The fork intent is recorded under
/// the PARENT run. ERP state is never rolled back.
#[reducer]
pub fn request_ai_run_fork(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RequestAiRunForkParams,
) -> Result<(), String> {
    let idempotency_key =
        validate_request(ctx, organization_id, params.run_id, &params.idempotency_key)?;
    if params.parent_manifest_id == AUTO_INC_SENTINEL {
        return Err("parent_manifest_id must be nonzero".to_string());
    }
    // The progress blob itself lands in the fork manifest; the intent payload
    // records only its byte length to stay within the bounded payload size.
    let payload_json = serde_json::json!({
        "run_id": params.run_id,
        "parent_manifest_id": params.parent_manifest_id,
        "idempotency_key": idempotency_key,
        "new_remaining_budget_tokens": params.new_remaining_budget_tokens,
        "new_budget_reserved_until": params.new_budget_reserved_until.to_micros_since_unix_epoch(),
        "progress_state_bytes": params.new_progress_state_json.len(),
    })
    .to_string();
    validate_payload_len(&payload_json)?;

    // Idempotency first: a retried fork must not supersede twice.
    if let Some(prior) = find_applied_intent(ctx, organization_id, KIND_FORK, &idempotency_key) {
        record_duplicate(
            ctx,
            organization_id,
            &prior,
            params.run_id,
            KIND_FORK,
            &idempotency_key,
            payload_json,
        );
        return Ok(());
    }

    let run = match load_org_run(ctx, organization_id, params.run_id) {
        Ok(run) => run,
        Err(reason) => {
            record_rejected(
                ctx,
                organization_id,
                None,
                params.run_id,
                KIND_FORK,
                &idempotency_key,
                payload_json,
                reason,
            );
            return Ok(());
        }
    };

    let parent_manifest = match ctx
        .db
        .ai_continuation_manifest()
        .id()
        .find(&params.parent_manifest_id)
    {
        Some(manifest) => manifest,
        None => {
            record_rejected(
                ctx,
                organization_id,
                Some(run.company_id),
                run.id,
                KIND_FORK,
                &idempotency_key,
                payload_json,
                "parent manifest not found".to_string(),
            );
            return Ok(());
        }
    };
    if parent_manifest.organization_id != organization_id {
        record_rejected(
            ctx,
            organization_id,
            Some(run.company_id),
            run.id,
            KIND_FORK,
            &idempotency_key,
            payload_json,
            "parent manifest does not belong to this organization".to_string(),
        );
        return Ok(());
    }
    if parent_manifest.status != "active" {
        record_rejected(
            ctx,
            organization_id,
            Some(run.company_id),
            run.id,
            KIND_FORK,
            &idempotency_key,
            payload_json,
            format!(
                "parent manifest is not active (status={}); fork from the active checkpoint",
                parent_manifest.status
            ),
        );
        return Ok(());
    }
    if parent_manifest.run_id != run.id {
        record_rejected(
            ctx,
            organization_id,
            Some(run.company_id),
            run.id,
            KIND_FORK,
            &idempotency_key,
            payload_json,
            "parent manifest belongs to a different run".to_string(),
        );
        return Ok(());
    }

    // From here on, any failure rolls the whole transaction back (there is no
    // durable way to record a "half-fork"); pre-fork rejections above are the
    // recorded outcomes.
    fork_ai_continuation_manifest(
        ctx,
        organization_id,
        params.parent_manifest_id,
        params.new_remaining_budget_tokens,
        params.new_budget_reserved_until,
        params.new_progress_state_json.clone(),
    )?;

    // fork_ai_continuation_manifest returns nothing; locate the fork manifest
    // by its parent link (unique: a parent can only be forked while active).
    let fork_manifest = ctx
        .db
        .ai_continuation_manifest()
        .ai_continuation_manifest_by_run()
        .filter(&run.id)
        .find(|m| m.parent_manifest_id == Some(params.parent_manifest_id) && m.status == "active")
        .ok_or("fork manifest not found after fork")?;

    // New run for the fork: same org/company/skill/agent lineage, fresh state.
    // Forks must NOT copy any approval or draft state — create_ai_agent_run
    // starts with no action drafts and no approvals.
    let fork_run_key = truncate_at_char_boundary(
        format!("{}-fork-{}", run.run_key, idempotency_key),
        MAX_FORK_RUN_KEY_LEN,
    );
    let sender_hex = ctx.sender().to_hex().to_string();
    create_ai_agent_run(
        ctx,
        organization_id,
        CreateAiAgentRunParams {
            company_id: run.company_id,
            skill_id: run.skill_id,
            skill_config_id: run.skill_config_id,
            agent_id: run.agent_id,
            team_member_id: run.team_member_id,
            run_key: fork_run_key.clone(),
            inputs_json: run.inputs_json.clone(),
            triggered_by_hex: sender_hex.clone(),
            metadata: Some(
                serde_json::json!({
                    "parent_run_id": run.id,
                    "parent_manifest_id": params.parent_manifest_id,
                    "fork_manifest_id": fork_manifest.id,
                    "forked_by": sender_hex,
                })
                .to_string(),
            ),
        },
    )?;

    let fork_run = ctx
        .db
        .ai_agent_run()
        .ai_agent_run_by_run_key()
        .filter(&fork_run_key)
        .next()
        .ok_or("fork run not found after creation")?;

    // create_ai_agent_run starts a run as "running"; a fork is parked as
    // "pending" until the client explicitly drives it. No reducer re-queues a
    // run, so update directly with the same audit pattern as resume.
    let fork_run_status = fork_run.status.clone();
    let fork_run_id = fork_run.id;
    let fork_run_company_id = fork_run.company_id;
    if fork_run_status != "pending" {
        ctx.db.ai_agent_run().id().update(AiAgentRun {
            status: "pending".to_string(),
            write_date: ctx.timestamp,
            ..fork_run
        });
        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(fork_run_company_id),
                table_name: "ai_agent_run",
                record_id: fork_run_id,
                action: "update",
                old_values: Some(serde_json::json!({ "status": fork_run_status }).to_string()),
                new_values: Some(serde_json::json!({ "status": "pending" }).to_string()),
                changed_fields: vec!["status".to_string()],
                metadata: None,
            },
        );
    }

    // Fresh control state for the new run (version 0, phase active).
    ensure_control_state(ctx, organization_id, fork_run_id, fork_run_company_id);

    // Record the fork intent under the PARENT run and bump its control version.
    let control = ensure_control_state(ctx, organization_id, run.id, run.company_id);
    let new_version = control
        .control_version
        .checked_add(1)
        .ok_or("control version overflow")?;
    let result_json = serde_json::json!({
        "parent_run_id": run.id,
        "parent_manifest_id": params.parent_manifest_id,
        "fork_run_id": fork_run_id,
        "fork_manifest_id": fork_manifest.id,
        "revision": fork_manifest.revision,
        "erp_state_rolled_back": false,
    })
    .to_string();
    validate_result_len(&result_json)?;

    let intent = record_intent(
        ctx,
        organization_id,
        Some(run.company_id),
        run.id,
        KIND_FORK,
        &idempotency_key,
        INTENT_APPLIED,
        None,
        payload_json,
        Some(result_json),
    );
    // The parent run keeps its own lifecycle; only the version advances.
    apply_control_advance(
        ctx,
        organization_id,
        run.company_id,
        control,
        None,
        new_version,
        intent.id,
    );
    Ok(())
}

/// Compare two continuation manifests of the same run and record a structured
/// diff as the intent result. Baseline may be superseded (parent-vs-fork).
/// Records differences only — no run or manifest state changes, and selecting
/// a candidate never reverses posted ERP state.
#[reducer]
pub fn request_ai_run_compare(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RequestAiRunCompareParams,
) -> Result<(), String> {
    let idempotency_key =
        validate_request(ctx, organization_id, params.run_id, &params.idempotency_key)?;
    if params.baseline_manifest_id == AUTO_INC_SENTINEL
        || params.candidate_manifest_id == AUTO_INC_SENTINEL
    {
        return Err("baseline_manifest_id and candidate_manifest_id must be nonzero".to_string());
    }
    let payload_json = serde_json::json!({
        "run_id": params.run_id,
        "baseline_manifest_id": params.baseline_manifest_id,
        "candidate_manifest_id": params.candidate_manifest_id,
        "idempotency_key": idempotency_key,
    })
    .to_string();
    validate_payload_len(&payload_json)?;

    if let Some(prior) = find_applied_intent(ctx, organization_id, KIND_COMPARE, &idempotency_key) {
        record_duplicate(
            ctx,
            organization_id,
            &prior,
            params.run_id,
            KIND_COMPARE,
            &idempotency_key,
            payload_json,
        );
        return Ok(());
    }

    let run = match load_org_run(ctx, organization_id, params.run_id) {
        Ok(run) => run,
        Err(reason) => {
            record_rejected(
                ctx,
                organization_id,
                None,
                params.run_id,
                KIND_COMPARE,
                &idempotency_key,
                payload_json,
                reason,
            );
            return Ok(());
        }
    };

    let mut manifests = Vec::with_capacity(2);
    for manifest_id in [params.baseline_manifest_id, params.candidate_manifest_id] {
        match ctx.db.ai_continuation_manifest().id().find(&manifest_id) {
            None => {
                record_rejected(
                    ctx,
                    organization_id,
                    Some(run.company_id),
                    run.id,
                    KIND_COMPARE,
                    &idempotency_key,
                    payload_json,
                    format!("manifest {manifest_id} not found"),
                );
                return Ok(());
            }
            Some(manifest) => {
                if manifest.organization_id != organization_id {
                    record_rejected(
                        ctx,
                        organization_id,
                        Some(run.company_id),
                        run.id,
                        KIND_COMPARE,
                        &idempotency_key,
                        payload_json,
                        format!("manifest {manifest_id} does not belong to this organization"),
                    );
                    return Ok(());
                }
                if manifest.run_id != run.id {
                    record_rejected(
                        ctx,
                        organization_id,
                        Some(run.company_id),
                        run.id,
                        KIND_COMPARE,
                        &idempotency_key,
                        payload_json,
                        format!("manifest {manifest_id} belongs to a different run"),
                    );
                    return Ok(());
                }
                manifests.push(manifest);
            }
        }
    }
    let baseline = manifests[0].clone();
    let candidate = manifests[1].clone();

    // Build the diff. Any stored-manifest parse failure is recorded as a
    // rejected intent (data integrity issue, surfaced to the client).
    let diff = build_manifest_diff(&baseline, &candidate);
    let result_json = match diff {
        Ok(diff) => serde_json::json!({
            "objective_same": diff.objective_same,
            "constraints_same": diff.constraints_same,
            "decisions_added": diff.decisions_added,
            "decisions_removed": diff.decisions_removed,
            "questions_opened": diff.questions_opened,
            "questions_resolved": diff.questions_resolved,
            "sources_added": diff.sources_added,
            "sources_removed": diff.sources_removed,
            "candidates_changed": diff.candidates_changed,
            "baseline_completed_effects": diff.baseline_completed_effects,
            "candidate_completed_effects": diff.candidate_completed_effects,
            "erp_state_rolled_back": false,
            "note": "comparison records differences only; selecting a candidate never reverses posted ERP state",
        })
        .to_string(),
        Err(reason) => {
            record_rejected(
                ctx,
                organization_id,
                Some(run.company_id),
                run.id,
                KIND_COMPARE,
                &idempotency_key,
                payload_json,
                reason,
            );
            return Ok(());
        }
    };
    if let Err(reason) = validate_result_len(&result_json) {
        record_rejected(
            ctx,
            organization_id,
            Some(run.company_id),
            run.id,
            KIND_COMPARE,
            &idempotency_key,
            payload_json,
            reason,
        );
        return Ok(());
    }

    // Observation intent: recorded as applied, but never mutates an existing
    // control-state row (no phase/version change).
    ensure_control_state(ctx, organization_id, run.id, run.company_id);
    record_intent(
        ctx,
        organization_id,
        Some(run.company_id),
        run.id,
        KIND_COMPARE,
        &idempotency_key,
        INTENT_APPLIED,
        None,
        payload_json,
        Some(result_json),
    );
    Ok(())
}

/// Upsert the durable event cursor for (org, run, client_key). Rejects a
/// decreasing `last_step_id`. Audits on creation only: advances are
/// high-frequency client bookkeeping with no authority change.
#[reducer]
pub fn record_ai_run_event_cursor(
    ctx: &ReducerContext,
    organization_id: u64,
    run_id: u64,
    client_key: String,
    last_step_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_session_control", "write")?;
    if organization_id == AUTO_INC_SENTINEL {
        return Err("organization_id is required".to_string());
    }
    if run_id == AUTO_INC_SENTINEL {
        return Err("run_id must be nonzero".to_string());
    }
    let client_key = validate_nonempty("client_key", &client_key, MAX_CLIENT_KEY_LEN)?;

    let run = load_org_run(ctx, organization_id, run_id)?;

    let existing = ctx
        .db
        .ai_run_event_cursor()
        .ai_run_event_cursor_by_run()
        .filter(&run_id)
        .find(|cursor| {
            cursor.organization_id == organization_id && cursor.client_key == client_key
        });

    match existing {
        None => {
            let row = ctx.db.ai_run_event_cursor().insert(AiRunEventCursor {
                id: AUTO_INC_SENTINEL,
                organization_id,
                run_id,
                client_key: client_key.clone(),
                last_step_id,
                updated_by: ctx.sender(),
                updated_at: ctx.timestamp,
            });
            write_audit_log_v2(
                ctx,
                organization_id,
                AuditLogParams {
                    company_id: Some(run.company_id),
                    table_name: "ai_run_event_cursor",
                    record_id: row.id,
                    action: "create",
                    old_values: None,
                    new_values: Some(
                        serde_json::json!({
                            "run_id": run_id,
                            "client_key": client_key,
                            "last_step_id": last_step_id,
                        })
                        .to_string(),
                    ),
                    changed_fields: vec!["client_key".to_string(), "last_step_id".to_string()],
                    metadata: None,
                },
            );
            Ok(())
        }
        Some(cursor) => {
            if last_step_id < cursor.last_step_id {
                return Err("cursor must not go backwards".to_string());
            }
            ctx.db.ai_run_event_cursor().id().update(AiRunEventCursor {
                last_step_id,
                updated_by: ctx.sender(),
                updated_at: ctx.timestamp,
                ..cursor
            });
            // No audit on advances — see module audit policy.
            Ok(())
        }
    }
}

// ── Compare diff ───────────────────────────────────────────────────────────

struct ManifestDiff {
    objective_same: bool,
    constraints_same: bool,
    decisions_added: Vec<u64>,
    decisions_removed: Vec<u64>,
    questions_opened: Vec<u64>,
    questions_resolved: Vec<u64>,
    sources_added: Vec<u64>,
    sources_removed: Vec<u64>,
    candidates_changed: Vec<serde_json::Value>,
    baseline_completed_effects: u64,
    candidate_completed_effects: u64,
}

fn ids_added(baseline: &[u64], candidate: &[u64]) -> Vec<u64> {
    candidate
        .iter()
        .copied()
        .filter(|id| !baseline.contains(id))
        .collect()
}

fn ids_removed(baseline: &[u64], candidate: &[u64]) -> Vec<u64> {
    ids_added(candidate, baseline)
}

fn build_manifest_diff(
    baseline: &AiContinuationManifest,
    candidate: &AiContinuationManifest,
) -> Result<ManifestDiff, String> {
    let baseline_decisions = parse_id_array(&baseline.accepted_decision_ids_json)?;
    let candidate_decisions = parse_id_array(&candidate.accepted_decision_ids_json)?;
    let baseline_questions = parse_id_array(&baseline.pending_question_ids_json)?;
    let candidate_questions = parse_id_array(&candidate.pending_question_ids_json)?;
    let baseline_sources = parse_id_array(&baseline.snapshot_sources_json)?;
    let candidate_sources = parse_id_array(&candidate.snapshot_sources_json)?;
    let baseline_candidates = parse_candidate_versions(&baseline.candidate_versions_json)?;
    let candidate_candidates = parse_candidate_versions(&candidate.candidate_versions_json)?;

    // Union of component ids, deterministic order; a side missing a component
    // reports version 0 (AUTO_INC_SENTINEL semantics).
    let mut component_ids: std::collections::BTreeSet<u64> =
        baseline_candidates.iter().map(|(cid, _)| *cid).collect();
    component_ids.extend(candidate_candidates.iter().map(|(cid, _)| *cid));
    let mut candidates_changed = Vec::new();
    for component_id in component_ids {
        let baseline_version = baseline_candidates
            .iter()
            .find(|(cid, _)| *cid == component_id)
            .map(|(_, version)| *version)
            .unwrap_or(0);
        let candidate_version = candidate_candidates
            .iter()
            .find(|(cid, _)| *cid == component_id)
            .map(|(_, version)| *version)
            .unwrap_or(0);
        if baseline_version != candidate_version {
            candidates_changed.push(serde_json::json!({
                "component_id": component_id,
                "baseline_version": baseline_version,
                "candidate_version": candidate_version,
            }));
        }
    }

    Ok(ManifestDiff {
        objective_same: baseline.objective_hash == candidate.objective_hash,
        constraints_same: baseline.constraints_hash == candidate.constraints_hash,
        decisions_added: ids_added(&baseline_decisions, &candidate_decisions),
        decisions_removed: ids_removed(&baseline_decisions, &candidate_decisions),
        questions_opened: ids_added(&baseline_questions, &candidate_questions),
        questions_resolved: ids_removed(&baseline_questions, &candidate_questions),
        sources_added: ids_added(&baseline_sources, &candidate_sources),
        sources_removed: ids_removed(&baseline_sources, &candidate_sources),
        candidates_changed,
        baseline_completed_effects: count_completed_effects(&baseline.completed_effects_json)?,
        candidate_completed_effects: count_completed_effects(&candidate.completed_effects_json)?,
    })
}
