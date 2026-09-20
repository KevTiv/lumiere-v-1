//! Durable, checked lifecycle state for governed AI runs.
//!
//! Lifecycle mutations are serialized by a continuation tuple
//! `(run_id, checkpoint_hash, cursor, concurrency_version)`.  The mutable
//! state is small; every accepted command is also appended to the immutable
//! event table so retries can be distinguished from conflicting replays.

use sha2::{Digest, Sha256};
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};
use std::fmt::Debug;

use crate::ai::evidence_common::is_sha256_hex;
use crate::ai::skills::{ai_agent_run, AiAgentRun};
use crate::helpers::check_permission;

const MAX_KEY_LEN: usize = 200;
const MAX_TEXT_LEN: usize = 32_000;
const MAX_JSON_LEN: usize = 256_000;

#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_run_lifecycle_state,
    index(accessor = ai_run_lifecycle_state_by_org, btree(columns = [organization_id])),
    index(accessor = ai_run_lifecycle_state_by_parent, btree(columns = [parent_run_id]))
)]
pub struct AiRunLifecycleState {
    #[primary_key]
    pub run_id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub state: String,
    pub checkpoint_hash: String,
    pub cursor: u32,
    pub concurrency_version: u64,
    pub parent_run_id: Option<u64>,
    pub parent_checkpoint_hash: Option<String>,
    pub fork_key: Option<String>,
    pub interrupted_reason: Option<String>,
    pub steering_revision: u64,
    pub requires_revalidation: bool,
    pub authority_snapshot_hash: Option<String>,
    pub create_date: Timestamp,
    pub write_date: Timestamp,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_run_lifecycle_event,
    index(accessor = ai_run_lifecycle_event_by_org, btree(columns = [organization_id])),
    index(accessor = ai_run_lifecycle_event_by_run, btree(columns = [run_id])),
    index(accessor = ai_run_lifecycle_event_by_key, btree(columns = [event_key]))
)]
pub struct AiRunLifecycleEvent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub run_id: u64,
    pub event_key: String,
    pub event_kind: String,
    pub request_hash: String,
    pub from_version: u64,
    pub to_version: u64,
    pub checkpoint_hash: String,
    pub cursor: u32,
    pub payload_json: Option<String>,
    pub create_uid: Identity,
    pub created_at: Timestamp,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_run_question,
    index(accessor = ai_run_question_by_org, btree(columns = [organization_id])),
    index(accessor = ai_run_question_by_run, btree(columns = [run_id])),
    index(accessor = ai_run_question_by_key, btree(columns = [question_key])),
    index(accessor = ai_run_question_by_status, btree(columns = [status]))
)]
pub struct AiRunQuestion {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub run_id: u64,
    pub question_key: String,
    pub revision: u64,
    pub prompt: String,
    pub response_schema_json: Option<String>,
    pub required: bool,
    pub respondent_identity_hex: String,
    pub respondent_role: String,
    pub status: String,
    pub answer_json: Option<String>,
    pub asked_at_version: u64,
    pub answered_at_version: Option<u64>,
    pub asked_by: Identity,
    pub answered_by: Option<Identity>,
    pub create_date: Timestamp,
    pub write_date: Timestamp,
}

/// Consequential effects are recorded before dispatch and reconciled by
/// revision. `uncertain` is explicit: a retry must reconcile provider state,
/// never blindly repeat the effect.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_run_effect,
    index(accessor = ai_run_effect_by_org, btree(columns = [organization_id])),
    index(accessor = ai_run_effect_by_run, btree(columns = [run_id])),
    index(accessor = ai_run_effect_by_key, btree(columns = [effect_key])),
    index(accessor = ai_run_effect_by_status, btree(columns = [status]))
)]
pub struct AiRunEffect {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub run_id: u64,
    pub effect_key: String,
    pub effect_kind: String,
    pub request_hash: String,
    pub status: String,
    pub revision: u64,
    pub provider_reference: Option<String>,
    pub detail: Option<String>,
    pub create_date: Timestamp,
    pub write_date: Timestamp,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RunContinuationParams {
    pub checkpoint_hash: String,
    pub cursor: u32,
    pub concurrency_version: u64,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct InitializeAiRunLifecycleParams {
    pub checkpoint_hash: String,
    pub cursor: u32,
    pub idempotency_key: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct AdvanceAiRunCheckpointParams {
    pub continuation: RunContinuationParams,
    pub next_checkpoint_hash: String,
    pub next_cursor: u32,
    pub idempotency_key: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct AskAiRunQuestionParams {
    pub continuation: RunContinuationParams,
    pub question_key: String,
    pub prompt: String,
    pub response_schema_json: Option<String>,
    pub required: bool,
    pub respondent_identity_hex: String,
    pub respondent_role: String,
    pub idempotency_key: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ReplyAiRunQuestionParams {
    pub continuation: RunContinuationParams,
    pub question_id: u64,
    pub expected_question_revision: u64,
    pub answer_json: String,
    pub respondent_identity_hex: String,
    pub respondent_role: String,
    pub idempotency_key: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct SteerAiRunParams {
    pub continuation: RunContinuationParams,
    pub instruction: String,
    pub idempotency_key: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct InterruptAiRunParams {
    pub continuation: RunContinuationParams,
    pub reason: String,
    pub idempotency_key: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ResumeAiRunParams {
    pub continuation: RunContinuationParams,
    pub idempotency_key: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ForkAiRunParams {
    pub continuation: RunContinuationParams,
    pub fork_key: String,
    pub child_run_key: String,
    pub idempotency_key: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct AuthorizeAiRunForkParams {
    pub continuation: RunContinuationParams,
    pub authority_snapshot_hash: String,
    pub idempotency_key: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CompareAiRunsParams {
    pub left: RunContinuationParams,
    pub right_run_id: u64,
    pub right: RunContinuationParams,
    pub idempotency_key: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordAiRunEffectParams {
    pub continuation: RunContinuationParams,
    pub effect_key: String,
    pub effect_kind: String,
    pub request_hash: String,
    pub idempotency_key: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ReconcileAiRunEffectParams {
    pub continuation: RunContinuationParams,
    pub effect_id: u64,
    pub expected_effect_revision: u64,
    pub status: String,
    pub provider_reference: Option<String>,
    pub detail: Option<String>,
    pub idempotency_key: String,
}

#[reducer]
pub fn initialize_ai_run_lifecycle(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: InitializeAiRunLifecycleParams,
) -> Result<(), String> {
    authorize(ctx, organization_id)?;
    let run = load_run(ctx, organization_id, company_id, run_id)?;
    validate_hash(&params.checkpoint_hash)?;
    validate_key("idempotency_key", &params.idempotency_key)?;
    let event_key = event_key(organization_id, run_id, &params.idempotency_key);
    let request_hash = command_hash("initialized", &params);
    if replayed(ctx, &event_key, "initialized", &request_hash)? {
        return Ok(());
    }
    if let Some(existing) = ctx.db.ai_run_lifecycle_state().run_id().find(&run_id) {
        if existing.checkpoint_hash == params.checkpoint_hash && existing.cursor == params.cursor {
            return Err("lifecycle already initialized with a different idempotency key".into());
        }
        return Err("lifecycle already initialized with different checkpoint state".into());
    }
    let state = AiRunLifecycleState {
        run_id,
        organization_id,
        company_id,
        state: lifecycle_state_for_run_status(&run.status).to_string(),
        checkpoint_hash: params.checkpoint_hash.clone(),
        cursor: params.cursor,
        concurrency_version: 1,
        parent_run_id: None,
        parent_checkpoint_hash: None,
        fork_key: None,
        interrupted_reason: None,
        steering_revision: 0,
        requires_revalidation: false,
        authority_snapshot_hash: Some(params.checkpoint_hash.clone()),
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
    };
    ctx.db.ai_run_lifecycle_state().insert(state.clone());
    append_event(ctx, &state, event_key, "initialized", request_hash, 0, None);
    Ok(())
}

#[reducer]
pub fn advance_ai_run_checkpoint(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: AdvanceAiRunCheckpointParams,
) -> Result<(), String> {
    authorize(ctx, organization_id)?;
    validate_hash(&params.next_checkpoint_hash)?;
    let request_hash = command_hash("checkpoint", &params);
    let key = event_key(organization_id, run_id, &params.idempotency_key);
    if replayed(ctx, &key, "checkpoint", &request_hash)? {
        return Ok(());
    }
    let mut state = checked_state(
        ctx,
        organization_id,
        company_id,
        run_id,
        &params.continuation,
    )?;
    if params.next_cursor < state.cursor {
        return Err("checkpoint cursor cannot move backwards".into());
    }
    mutate_state(
        ctx,
        &mut state,
        &params.idempotency_key,
        "checkpoint",
        request_hash,
        None,
        |next| {
            next.checkpoint_hash = params.next_checkpoint_hash;
            next.cursor = params.next_cursor;
            next.requires_revalidation = false;
            Ok(())
        },
    )
}

#[reducer]
pub fn ask_ai_run_question(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: AskAiRunQuestionParams,
) -> Result<(), String> {
    authorize(ctx, organization_id)?;
    validate_key("question_key", &params.question_key)?;
    validate_text("prompt", &params.prompt, MAX_TEXT_LEN)?;
    validate_optional_json(&params.response_schema_json)?;
    validate_identity_hex(&params.respondent_identity_hex)?;
    validate_key("respondent_role", &params.respondent_role)?;
    let request_hash = command_hash("question_asked", &params);
    let event_key = event_key(organization_id, run_id, &params.idempotency_key);
    if replayed(ctx, &event_key, "question_asked", &request_hash)? {
        return Ok(());
    }
    let state = checked_state(
        ctx,
        organization_id,
        company_id,
        run_id,
        &params.continuation,
    )?;
    if state.state != "running" {
        return Err("only a running lifecycle can ask a question".into());
    }
    let key = params.question_key.trim().to_string();
    if let Some(existing) = ctx
        .db
        .ai_run_question()
        .ai_run_question_by_run()
        .filter(&run_id)
        .find(|q| q.question_key == key)
    {
        if existing.prompt == params.prompt
            && existing.response_schema_json == params.response_schema_json
            && existing.required == params.required
            && existing.respondent_identity_hex
                == params.respondent_identity_hex.to_ascii_lowercase()
            && existing.respondent_role == params.respondent_role
        {
            return Ok(());
        }
        return Err("question_key replay conflicts with the persisted question".into());
    }
    ensure_new_event(ctx, &event_key)?;
    ctx.db.ai_run_question().insert(AiRunQuestion {
        id: 0,
        organization_id,
        company_id,
        run_id,
        question_key: key,
        revision: 1,
        prompt: params.prompt,
        response_schema_json: params.response_schema_json,
        required: params.required,
        respondent_identity_hex: params.respondent_identity_hex.to_ascii_lowercase(),
        respondent_role: params.respondent_role,
        status: "open".into(),
        answer_json: None,
        asked_at_version: state.concurrency_version,
        answered_at_version: None,
        asked_by: ctx.sender(),
        answered_by: None,
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
    });
    transition_state_and_run(
        ctx,
        state,
        event_key,
        "question_asked",
        request_hash,
        "waiting_input",
        "waiting_input",
        None,
    )
}

#[reducer]
pub fn reply_ai_run_question(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: ReplyAiRunQuestionParams,
) -> Result<(), String> {
    authorize(ctx, organization_id)?;
    validate_text("answer_json", &params.answer_json, MAX_JSON_LEN)?;
    serde_json::from_str::<serde_json::Value>(&params.answer_json)
        .map_err(|_| "answer_json must be valid JSON")?;
    validate_identity_hex(&params.respondent_identity_hex)?;
    validate_key("respondent_role", &params.respondent_role)?;
    let request_hash = command_hash("question_replied", &params);
    let event_key = event_key(organization_id, run_id, &params.idempotency_key);
    if replayed(ctx, &event_key, "question_replied", &request_hash)? {
        return Ok(());
    }
    let state = checked_state(
        ctx,
        organization_id,
        company_id,
        run_id,
        &params.continuation,
    )?;
    let mut question = ctx
        .db
        .ai_run_question()
        .id()
        .find(&params.question_id)
        .ok_or("question not found")?;
    if question.organization_id != organization_id
        || question.company_id != company_id
        || question.run_id != run_id
    {
        return Err("question does not belong to this run".into());
    }
    if question.status != "open" || question.revision != params.expected_question_revision {
        return Err("question revision conflict".into());
    }
    if question.respondent_identity_hex != params.respondent_identity_hex.to_ascii_lowercase()
        || question.respondent_role != params.respondent_role
    {
        return Err("reply actor is not the authorized question respondent".into());
    }
    question.status = "answered".into();
    question.answer_json = Some(params.answer_json);
    question.revision = question
        .revision
        .checked_add(1)
        .ok_or("question revision overflow")?;
    question.answered_at_version = Some(state.concurrency_version + 1);
    question.answered_by = Some(ctx.sender());
    question.write_date = ctx.timestamp;
    ctx.db.ai_run_question().id().update(question);
    transition_state_and_run(
        ctx,
        state,
        event_key,
        "question_replied",
        request_hash,
        "ready",
        "waiting_input",
        None,
    )
}

#[reducer]
pub fn steer_ai_run(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: SteerAiRunParams,
) -> Result<(), String> {
    authorize(ctx, organization_id)?;
    validate_text("instruction", &params.instruction, MAX_TEXT_LEN)?;
    let request_hash = command_hash("steered", &params);
    let key = event_key(organization_id, run_id, &params.idempotency_key);
    if replayed(ctx, &key, "steered", &request_hash)? {
        return Ok(());
    }
    let mut state = checked_state(
        ctx,
        organization_id,
        company_id,
        run_id,
        &params.continuation,
    )?;
    if !matches!(
        state.state.as_str(),
        "waiting_input" | "ready" | "interrupted"
    ) {
        return Err("run must be waiting or interrupted before steering".into());
    }
    let payload = Some(serde_json::json!({"instruction": params.instruction}).to_string());
    mutate_state(
        ctx,
        &mut state,
        &params.idempotency_key,
        "steered",
        request_hash,
        payload,
        |next| {
            next.steering_revision = next
                .steering_revision
                .checked_add(1)
                .ok_or("steering revision overflow")?;
            next.requires_revalidation = true;
            Ok(())
        },
    )
}

#[reducer]
pub fn interrupt_ai_run(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: InterruptAiRunParams,
) -> Result<(), String> {
    authorize(ctx, organization_id)?;
    validate_text("reason", &params.reason, MAX_TEXT_LEN)?;
    let request_hash = command_hash("interrupted", &params);
    let event_key = event_key(organization_id, run_id, &params.idempotency_key);
    if replayed(ctx, &event_key, "interrupted", &request_hash)? {
        return Ok(());
    }
    let state = checked_state(
        ctx,
        organization_id,
        company_id,
        run_id,
        &params.continuation,
    )?;
    transition_state_and_run(
        ctx,
        state,
        event_key,
        "interrupted",
        request_hash,
        "interrupted",
        "interrupted",
        Some(params.reason),
    )
}

#[reducer]
pub fn resume_ai_run_checked(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: ResumeAiRunParams,
) -> Result<(), String> {
    authorize(ctx, organization_id)?;
    let request_hash = command_hash("resumed", &params);
    let event_key = event_key(organization_id, run_id, &params.idempotency_key);
    if replayed(ctx, &event_key, "resumed", &request_hash)? {
        return Ok(());
    }
    let state = checked_state(
        ctx,
        organization_id,
        company_id,
        run_id,
        &params.continuation,
    )?;
    if !matches!(
        state.state.as_str(),
        "ready" | "interrupted" | "waiting_approval" | "agent_settled"
    ) {
        return Err("lifecycle state is not resumable".into());
    }
    if state.requires_revalidation {
        return Err("steered run requires a new checked checkpoint before resume".into());
    }
    if state.parent_run_id.is_some() && state.authority_snapshot_hash.is_none() {
        return Err("fork scope, budget, and approval authority must be reacquired".into());
    }
    if ctx
        .db
        .ai_run_question()
        .ai_run_question_by_run()
        .filter(&run_id)
        .any(|q| q.status == "open" && q.required)
    {
        return Err("run has an unanswered required durable question".into());
    }
    if ctx
        .db
        .ai_run_effect()
        .ai_run_effect_by_run()
        .filter(&run_id)
        .any(|effect| effect.status == "uncertain")
    {
        return Err("run has an uncertain consequential effect requiring reconciliation".into());
    }
    for mut question in ctx
        .db
        .ai_run_question()
        .ai_run_question_by_run()
        .filter(&run_id)
        .filter(|question| question.status == "open" && !question.required)
    {
        question.status = "skipped".into();
        question.revision = question
            .revision
            .checked_add(1)
            .ok_or("question revision overflow")?;
        question.write_date = ctx.timestamp;
        ctx.db.ai_run_question().id().update(question);
    }
    transition_state_and_run(
        ctx,
        state,
        event_key,
        "resumed",
        request_hash,
        "running",
        "running",
        None,
    )
}

#[reducer]
pub fn fork_ai_run_checked(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: ForkAiRunParams,
) -> Result<(), String> {
    authorize(ctx, organization_id)?;
    validate_key("fork_key", &params.fork_key)?;
    validate_key("child_run_key", &params.child_run_key)?;
    let request_hash = command_hash("forked", &params);
    let event_key = event_key(organization_id, run_id, &params.idempotency_key);
    if replayed(ctx, &event_key, "forked", &request_hash)? {
        return Ok(());
    }
    let parent_state = checked_state(
        ctx,
        organization_id,
        company_id,
        run_id,
        &params.continuation,
    )?;
    if ctx
        .db
        .ai_agent_run()
        .ai_agent_run_by_run_key()
        .filter(&params.child_run_key)
        .next()
        .is_some()
    {
        return Err("child_run_key already exists".into());
    }
    let parent = load_run(ctx, organization_id, company_id, run_id)?;
    let child = ctx.db.ai_agent_run().insert(AiAgentRun {
        id: 0,
        organization_id,
        company_id,
        skill_id: parent.skill_id,
        skill_config_id: parent.skill_config_id,
        agent_id: parent.agent_id,
        team_member_id: parent.team_member_id,
        run_key: params.child_run_key,
        status: "waiting_input".into(),
        inputs_json: parent.inputs_json,
        summary: None,
        artifacts_json: None,
        citations_json: None,
        action_draft_ids: vec![],
        step_count: 0,
        tokens_used: 0,
        error_message: None,
        triggered_by_hex: parent.triggered_by_hex,
        started_at: ctx.timestamp,
        completed_at: None,
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
        metadata: Some(
            serde_json::json!({"parent_run_id": run_id, "fork_key": params.fork_key}).to_string(),
        ),
    });
    ctx.db.ai_run_lifecycle_state().insert(AiRunLifecycleState {
        run_id: child.id,
        organization_id,
        company_id,
        state: "fork_pending_authority".into(),
        checkpoint_hash: parent_state.checkpoint_hash.clone(),
        cursor: parent_state.cursor,
        concurrency_version: 1,
        parent_run_id: Some(run_id),
        parent_checkpoint_hash: Some(parent_state.checkpoint_hash.clone()),
        fork_key: Some(params.fork_key.clone()),
        interrupted_reason: None,
        steering_revision: parent_state.steering_revision,
        requires_revalidation: false,
        authority_snapshot_hash: None,
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
    });
    append_event(
        ctx,
        &parent_state,
        event_key,
        "forked",
        request_hash,
        parent_state.concurrency_version,
        Some(
            serde_json::json!({"child_run_id": child.id, "fork_key": params.fork_key}).to_string(),
        ),
    );
    Ok(())
}

/// Admit a fork only after the trusted gateway has reacquired scope, budget,
/// and approval and recorded their aggregate snapshot hash.
#[reducer]
pub fn authorize_ai_run_fork(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: AuthorizeAiRunForkParams,
) -> Result<(), String> {
    authorize(ctx, organization_id)?;
    validate_hash(&params.authority_snapshot_hash)?;
    let request_hash = command_hash("fork_authorized", &params);
    let key = event_key(organization_id, run_id, &params.idempotency_key);
    if replayed(ctx, &key, "fork_authorized", &request_hash)? {
        return Ok(());
    }
    let mut state = checked_state(
        ctx,
        organization_id,
        company_id,
        run_id,
        &params.continuation,
    )?;
    if state.parent_run_id.is_none() || state.state != "fork_pending_authority" {
        return Err("only a pending fork can receive a new authority snapshot".into());
    }
    mutate_state(
        ctx,
        &mut state,
        &params.idempotency_key,
        "fork_authorized",
        request_hash,
        None,
        |next| {
            next.authority_snapshot_hash = Some(params.authority_snapshot_hash);
            next.state = "ready".into();
            Ok(())
        },
    )
}

#[reducer]
pub fn compare_ai_runs_checked(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    left_run_id: u64,
    params: CompareAiRunsParams,
) -> Result<(), String> {
    authorize(ctx, organization_id)?;
    let request_hash = command_hash("compared", &params);
    let key = event_key(organization_id, left_run_id, &params.idempotency_key);
    if replayed(ctx, &key, "compared", &request_hash)? {
        return Ok(());
    }
    let left = checked_state(ctx, organization_id, company_id, left_run_id, &params.left)?;
    let right = checked_state(
        ctx,
        organization_id,
        company_id,
        params.right_run_id,
        &params.right,
    )?;
    if left.run_id == right.run_id
        && left.checkpoint_hash == right.checkpoint_hash
        && left.cursor == right.cursor
    {
        return Err("compare requires distinct continuations".into());
    }
    append_event(ctx, &left, key, "compared", request_hash, left.concurrency_version,
        Some(serde_json::json!({"right_run_id": right.run_id, "right_checkpoint_hash": right.checkpoint_hash, "right_cursor": right.cursor, "right_version": right.concurrency_version}).to_string()));
    Ok(())
}

#[reducer]
pub fn record_ai_run_effect(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: RecordAiRunEffectParams,
) -> Result<(), String> {
    authorize(ctx, organization_id)?;
    validate_key("effect_key", &params.effect_key)?;
    validate_key("effect_kind", &params.effect_kind)?;
    validate_hash(&params.request_hash)?;
    let command_request_hash = command_hash("effect_recorded", &params);
    let key = event_key(organization_id, run_id, &params.idempotency_key);
    if replayed(ctx, &key, "effect_recorded", &command_request_hash)? {
        return Ok(());
    }
    let state = checked_state(
        ctx,
        organization_id,
        company_id,
        run_id,
        &params.continuation,
    )?;
    let scoped_key = format!("{organization_id}:{run_id}:{}", params.effect_key.trim());
    if let Some(existing) = ctx
        .db
        .ai_run_effect()
        .ai_run_effect_by_key()
        .filter(&scoped_key)
        .next()
    {
        if existing.effect_kind == params.effect_kind
            && existing.request_hash == params.request_hash
        {
            return Ok(());
        }
        return Err("effect_key replay conflicts with the persisted effect".into());
    }
    ensure_new_event(ctx, &key)?;
    ctx.db.ai_run_effect().insert(AiRunEffect {
        id: 0,
        organization_id,
        company_id,
        run_id,
        effect_key: scoped_key,
        effect_kind: params.effect_kind,
        request_hash: params.request_hash,
        status: "planned".into(),
        revision: 1,
        provider_reference: None,
        detail: None,
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
    });
    append_event(
        ctx,
        &state,
        key,
        "effect_recorded",
        command_request_hash,
        state.concurrency_version,
        None,
    );
    Ok(())
}

#[reducer]
pub fn reconcile_ai_run_effect(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: ReconcileAiRunEffectParams,
) -> Result<(), String> {
    authorize(ctx, organization_id)?;
    let request_hash = command_hash("effect_reconciled", &params);
    let key = event_key(organization_id, run_id, &params.idempotency_key);
    if replayed(ctx, &key, "effect_reconciled", &request_hash)? {
        return Ok(());
    }
    let state = checked_state(
        ctx,
        organization_id,
        company_id,
        run_id,
        &params.continuation,
    )?;
    if !matches!(
        params.status.as_str(),
        "dispatched" | "confirmed" | "failed" | "uncertain"
    ) {
        return Err("effect status must be dispatched, confirmed, failed, or uncertain".into());
    }
    let mut effect = ctx
        .db
        .ai_run_effect()
        .id()
        .find(&params.effect_id)
        .ok_or("effect not found")?;
    if effect.organization_id != organization_id
        || effect.company_id != company_id
        || effect.run_id != run_id
    {
        return Err("effect does not belong to this run".into());
    }
    if effect.revision != params.expected_effect_revision {
        return Err("effect revision conflict".into());
    }
    validate_effect_transition(&effect.status, &params.status)?;
    effect.status = params.status.clone();
    effect.revision = effect
        .revision
        .checked_add(1)
        .ok_or("effect revision overflow")?;
    effect.provider_reference = params.provider_reference;
    effect.detail = params.detail;
    effect.write_date = ctx.timestamp;
    ctx.db.ai_run_effect().id().update(effect);
    append_event(
        ctx,
        &state,
        key,
        "effect_reconciled",
        request_hash,
        state.concurrency_version,
        Some(
            serde_json::json!({"effect_id": params.effect_id, "status": params.status}).to_string(),
        ),
    );
    Ok(())
}

fn authorize(ctx: &ReducerContext, organization_id: u64) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_agent_run", "write")
}

fn load_run(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
) -> Result<AiAgentRun, String> {
    let run = ctx
        .db
        .ai_agent_run()
        .id()
        .find(&run_id)
        .ok_or("run not found")?;
    if run.organization_id != organization_id || run.company_id != company_id {
        return Err("run does not belong to this organization and company".into());
    }
    Ok(run)
}

fn checked_state(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    continuation: &RunContinuationParams,
) -> Result<AiRunLifecycleState, String> {
    validate_hash(&continuation.checkpoint_hash)?;
    let state = ctx
        .db
        .ai_run_lifecycle_state()
        .run_id()
        .find(&run_id)
        .ok_or("run lifecycle is not initialized")?;
    if state.organization_id != organization_id || state.company_id != company_id {
        return Err("run lifecycle does not belong to this organization and company".into());
    }
    if state.checkpoint_hash != continuation.checkpoint_hash
        || state.cursor != continuation.cursor
        || state.concurrency_version != continuation.concurrency_version
    {
        return Err("stale or forged continuation".into());
    }
    Ok(state)
}

fn transition_state_and_run(
    ctx: &ReducerContext,
    mut state: AiRunLifecycleState,
    event_key: String,
    kind: &str,
    request_hash: String,
    lifecycle_state: &str,
    run_status: &str,
    reason: Option<String>,
) -> Result<(), String> {
    if replayed(ctx, &event_key, kind, &request_hash)? {
        return Ok(());
    }
    let from = state.concurrency_version;
    state.concurrency_version = from.checked_add(1).ok_or("lifecycle version overflow")?;
    state.state = lifecycle_state.into();
    state.interrupted_reason = reason.clone();
    state.write_date = ctx.timestamp;
    ctx.db
        .ai_run_lifecycle_state()
        .run_id()
        .update(state.clone());
    let run = load_run(ctx, state.organization_id, state.company_id, state.run_id)?;
    ctx.db.ai_agent_run().id().update(AiAgentRun {
        status: run_status.into(),
        error_message: reason,
        write_date: ctx.timestamp,
        ..run
    });
    append_event(ctx, &state, event_key, kind, request_hash, from, None);
    Ok(())
}

fn mutate_state<F>(
    ctx: &ReducerContext,
    state: &mut AiRunLifecycleState,
    idempotency_key: &str,
    kind: &str,
    request_hash: String,
    payload: Option<String>,
    mutate: F,
) -> Result<(), String>
where
    F: FnOnce(&mut AiRunLifecycleState) -> Result<(), String>,
{
    validate_key("idempotency_key", idempotency_key)?;
    let key = event_key(state.organization_id, state.run_id, idempotency_key);
    if replayed(ctx, &key, kind, &request_hash)? {
        return Ok(());
    }
    let from = state.concurrency_version;
    mutate(state)?;
    state.concurrency_version = from.checked_add(1).ok_or("lifecycle version overflow")?;
    state.write_date = ctx.timestamp;
    ctx.db
        .ai_run_lifecycle_state()
        .run_id()
        .update(state.clone());
    append_event(ctx, state, key, kind, request_hash, from, payload);
    Ok(())
}

fn append_event(
    ctx: &ReducerContext,
    state: &AiRunLifecycleState,
    event_key: String,
    kind: &str,
    request_hash: String,
    from_version: u64,
    payload_json: Option<String>,
) {
    ctx.db.ai_run_lifecycle_event().insert(AiRunLifecycleEvent {
        id: 0,
        organization_id: state.organization_id,
        company_id: state.company_id,
        run_id: state.run_id,
        event_key,
        event_kind: kind.into(),
        request_hash,
        from_version,
        to_version: state.concurrency_version,
        checkpoint_hash: state.checkpoint_hash.clone(),
        cursor: state.cursor,
        payload_json,
        create_uid: ctx.sender(),
        created_at: ctx.timestamp,
    });
}

fn ensure_new_event(ctx: &ReducerContext, key: &str) -> Result<(), String> {
    validate_key(
        "idempotency_key",
        key.rsplit(':').next().unwrap_or_default(),
    )?;
    if ctx
        .db
        .ai_run_lifecycle_event()
        .ai_run_lifecycle_event_by_key()
        .filter(&key.to_string())
        .next()
        .is_some()
    {
        return Err("idempotency key was already used for another lifecycle command".into());
    }
    Ok(())
}

fn replayed(
    ctx: &ReducerContext,
    key: &str,
    expected_kind: &str,
    expected_request_hash: &str,
) -> Result<bool, String> {
    if let Some(event) = ctx
        .db
        .ai_run_lifecycle_event()
        .ai_run_lifecycle_event_by_key()
        .filter(&key.to_string())
        .next()
    {
        if event.event_kind == expected_kind && event.request_hash == expected_request_hash {
            return Ok(true);
        }
        return Err("idempotency key replay conflicts with the persisted lifecycle command".into());
    }
    Ok(false)
}

fn command_hash(kind: &str, params: &impl Debug) -> String {
    let canonical = format!("{kind}|{params:?}");
    format!("{:x}", Sha256::digest(canonical.as_bytes()))
}

fn event_key(organization_id: u64, run_id: u64, idempotency_key: &str) -> String {
    format!("{organization_id}:{run_id}:{}", idempotency_key.trim())
}

fn validate_key(name: &str, value: &str) -> Result<(), String> {
    let len = value.trim().len();
    if len == 0 || len > MAX_KEY_LEN {
        return Err(format!(
            "{name} must be between 1 and {MAX_KEY_LEN} characters"
        ));
    }
    Ok(())
}

fn validate_text(name: &str, value: &str, max: usize) -> Result<(), String> {
    let len = value.trim().len();
    if len == 0 || len > max {
        return Err(format!("{name} must be between 1 and {max} characters"));
    }
    Ok(())
}

fn validate_optional_json(value: &Option<String>) -> Result<(), String> {
    if let Some(value) = value {
        validate_text("response_schema_json", value, MAX_JSON_LEN)?;
        serde_json::from_str::<serde_json::Value>(value)
            .map_err(|_| "response_schema_json must be valid JSON")?;
    }
    Ok(())
}

fn validate_hash(value: &str) -> Result<(), String> {
    if !is_sha256_hex(value) {
        return Err("checkpoint or request hash must be a lowercase SHA-256 hex digest".into());
    }
    Ok(())
}

fn validate_identity_hex(value: &str) -> Result<(), String> {
    let trimmed = value.trim();
    let hex = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .unwrap_or(trimmed);
    if hex.len() != 64 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("respondent identity must be a 64-character hex identity".into());
    }
    Ok(())
}

fn lifecycle_state_for_run_status(status: &str) -> &str {
    match status {
        "awaiting_approval" => "waiting_approval",
        "agent_settled" => "agent_settled",
        "waiting_input" => "waiting_input",
        "interrupted" => "interrupted",
        other => other,
    }
}

fn validate_effect_transition(from: &str, to: &str) -> Result<(), String> {
    let valid = matches!(
        (from, to),
        ("planned", "dispatched")
            | ("planned", "failed")
            | ("planned", "uncertain")
            | ("dispatched", "confirmed")
            | ("dispatched", "failed")
            | ("dispatched", "uncertain")
            | ("uncertain", "confirmed")
            | ("uncertain", "failed")
            | ("uncertain", "dispatched")
    );
    if valid {
        Ok(())
    } else {
        Err(format!("invalid effect transition from {from} to {to}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn consequential_effect_transitions_require_reconciliation() {
        assert!(validate_effect_transition("planned", "dispatched").is_ok());
        assert!(validate_effect_transition("dispatched", "uncertain").is_ok());
        assert!(validate_effect_transition("uncertain", "confirmed").is_ok());
        assert!(validate_effect_transition("confirmed", "dispatched").is_err());
        assert!(validate_effect_transition("planned", "confirmed").is_err());
    }

    #[test]
    fn lifecycle_maps_waiting_statuses_without_losing_terminal_state() {
        assert_eq!(
            lifecycle_state_for_run_status("awaiting_approval"),
            "waiting_approval"
        );
        assert_eq!(
            lifecycle_state_for_run_status("waiting_input"),
            "waiting_input"
        );
        assert_eq!(lifecycle_state_for_run_status("completed"), "completed");
    }

    #[test]
    fn continuation_hash_is_strict_lowercase_sha256() {
        assert!(validate_hash(&"a".repeat(64)).is_ok());
        assert!(validate_hash(&"A".repeat(64)).is_err());
        assert!(validate_hash("abc").is_err());
    }

    #[test]
    fn question_respondent_identity_is_checked() {
        assert!(validate_identity_hex(&"a".repeat(64)).is_ok());
        assert!(validate_identity_hex(&format!("0x{}", "B".repeat(64))).is_ok());
        assert!(validate_identity_hex("browser-user-id").is_err());
    }

    #[test]
    fn idempotency_hash_binds_the_entire_command_payload() {
        let first = ResumeAiRunParams {
            continuation: RunContinuationParams {
                checkpoint_hash: "a".repeat(64),
                cursor: 4,
                concurrency_version: 2,
            },
            idempotency_key: "resume-1".into(),
        };
        let changed = ResumeAiRunParams {
            continuation: RunContinuationParams {
                cursor: 5,
                ..first.continuation.clone()
            },
            idempotency_key: first.idempotency_key.clone(),
        };
        assert_eq!(
            command_hash("resumed", &first),
            command_hash("resumed", &first)
        );
        assert_ne!(
            command_hash("resumed", &first),
            command_hash("resumed", &changed)
        );
        assert_ne!(
            command_hash("resumed", &first),
            command_hash("interrupted", &first)
        );
    }
}
