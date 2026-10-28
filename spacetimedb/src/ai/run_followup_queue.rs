//! Durable server-side follow-up queue beside steering (AIH-20, T3 V2 plan 7.1).
//!
//! A queued follow-up is authored input, not authority and not a steer:
//!
//! * enqueue / edit / reorder / withdraw only touch `ai_run_queued_input` and
//!   append an idempotency event. They never change the lifecycle state, the
//!   run status or the continuation tuple, so a queued item can never
//!   interrupt a running turn. `steer_ai_run` remains the only way to revise
//!   a running objective.
//! * the author is always `ctx.sender()`; no argument names an author.
//! * promotion is allowed only for the head of the queue, only when the run is
//!   fully settled (`completed`, not merely `agent_settled`), and only while
//!   the AUTHOR (not the promoter) still holds the `ai.run.lifecycle` grant.
//!   It starts a new checked continuation as a child run in the existing
//!   `fork_pending_authority` state, so scope, budget and approval are
//!   reacquired and nothing is inherited from the previous turn.
//! * idempotency is payload-bound exactly like the other lifecycle commands:
//!   the replay key is stored in the lifecycle event table together with a
//!   hash of the full command and the author.
//!
//! No new run status or lifecycle state is introduced here.

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use super::run_lifecycle::{
    ai_run_effect, ai_run_lifecycle_state, ai_run_question, append_event, authorize, checked_state,
    command_hash, ensure_new_event, event_key, load_run, replayed, validate_key, validate_text,
    AiRunLifecycleState, RunContinuationParams,
};
use crate::ai::capability_grants::ai_capability_role_grant;
use crate::ai::skills::{ai_agent_run, AiAgentRun};
use crate::core::permissions::effective_roles;
use crate::core::users::find_user_profile_for_organization;
use crate::helpers::{write_audit_log_v2, AuditLogParams};

const MAX_FOLLOW_UP_LEN: usize = 32_000;
/// Upper bound of simultaneously queued follow-ups per run.
const MAX_QUEUED_FOLLOW_UPS_PER_RUN: usize = 20;
/// Capability the author must still hold when a queued item is promoted.
const FOLLOW_UP_CAPABILITY: &str = "ai.run.lifecycle";

const QUEUED: &str = "queued";
const PROMOTED: &str = "promoted";
const WITHDRAWN: &str = "withdrawn";
/// Reserved terminal status; no reducer in this slice produces it yet.
#[allow(dead_code)]
const SUPERSEDED: &str = "superseded";

// ── Tables ───────────────────────────────────────────────────────────────────

/// Private by design: the payload never leaves the module except through the
/// trusted gateway, which redacts it on read.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_run_queued_input,
    index(accessor = ai_run_queued_input_by_org, btree(columns = [organization_id])),
    index(accessor = ai_run_queued_input_by_run, btree(columns = [run_id])),
    index(accessor = ai_run_queued_input_by_status, btree(columns = [status]))
)]
pub struct AiRunQueuedInput {
    #[primary_key]
    #[auto_inc]
    pub queued_input_id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub run_id: u64,
    pub idempotency_key: String,
    pub request_hash: String,
    /// Sort key among queued items of the run (gaps allowed).
    pub position: u32,
    pub revision: u64,
    pub author: Identity,
    pub payload: String,
    /// queued | promoted | withdrawn | superseded
    pub status: String,
    pub promoted_run_id: Option<u64>,
    pub create_date: Timestamp,
    pub write_date: Timestamp,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct EnqueueAiRunFollowUpParams {
    pub payload: String,
    pub idempotency_key: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct EditAiRunFollowUpParams {
    pub queued_input_id: u64,
    pub expected_revision: u64,
    pub payload: String,
    pub idempotency_key: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ReorderAiRunFollowUpParams {
    pub queued_input_id: u64,
    pub expected_revision: u64,
    /// 1-based slot among the currently queued items.
    pub target_position: u32,
    pub idempotency_key: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct WithdrawAiRunFollowUpParams {
    pub queued_input_id: u64,
    pub expected_revision: u64,
    pub idempotency_key: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct PromoteAiRunFollowUpParams {
    /// The settled run's current checked continuation.
    pub continuation: RunContinuationParams,
    pub queued_input_id: u64,
    pub expected_revision: u64,
    pub child_run_key: String,
    pub idempotency_key: String,
}

// ── Reducers: queue maintenance (never touches run or lifecycle state) ───────

#[reducer]
pub fn enqueue_ai_run_follow_up(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: EnqueueAiRunFollowUpParams,
) -> Result<(), String> {
    authorize(ctx, organization_id)?;
    validate_text("payload", &params.payload, MAX_FOLLOW_UP_LEN)?;
    validate_key("idempotency_key", &params.idempotency_key)?;
    let author = ctx.sender();
    let request_hash = command_hash("followup_enqueued", &(&params, author));
    let key = event_key(organization_id, run_id, &params.idempotency_key);
    if replayed(ctx, &key, "followup_enqueued", &request_hash)? {
        return Ok(());
    }
    require_author_grant(ctx, organization_id, author)?;
    let run = load_run(ctx, organization_id, company_id, run_id)?;
    if !queue_accepts_run_status(&run.status) {
        return Err("a failed or cancelled run cannot accept queued follow-ups".into());
    }
    let state = lifecycle_state(ctx, organization_id, company_id, run_id)?;
    ensure_new_event(ctx, &key)?;
    let queued = queued_entries(ctx, run_id);
    if queued.len() >= MAX_QUEUED_FOLLOW_UPS_PER_RUN {
        return Err("follow-up queue is full".into());
    }
    let position = next_position(&queued)?;
    let row = ctx.db.ai_run_queued_input().insert(AiRunQueuedInput {
        queued_input_id: 0,
        organization_id,
        company_id,
        run_id,
        idempotency_key: params.idempotency_key.trim().to_string(),
        request_hash: request_hash.clone(),
        position,
        revision: 1,
        author,
        payload: params.payload,
        status: QUEUED.into(),
        promoted_run_id: None,
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
    });
    append_queue_event(
        ctx,
        &state,
        key,
        "followup_enqueued",
        request_hash,
        row.queued_input_id,
        row.revision,
    );
    audit(ctx, &row, "CREATE", None);
    Ok(())
}

#[reducer]
pub fn edit_ai_run_follow_up(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: EditAiRunFollowUpParams,
) -> Result<(), String> {
    authorize(ctx, organization_id)?;
    validate_text("payload", &params.payload, MAX_FOLLOW_UP_LEN)?;
    validate_key("idempotency_key", &params.idempotency_key)?;
    let author = ctx.sender();
    let request_hash = command_hash("followup_edited", &(&params, author));
    let key = event_key(organization_id, run_id, &params.idempotency_key);
    if replayed(ctx, &key, "followup_edited", &request_hash)? {
        return Ok(());
    }
    require_author_grant(ctx, organization_id, author)?;
    let state = lifecycle_state(ctx, organization_id, company_id, run_id)?;
    let item = load_item(
        ctx,
        organization_id,
        company_id,
        run_id,
        params.queued_input_id,
    )?;
    ensure_mutable_by(&item, author, params.expected_revision)?;
    ensure_new_event(ctx, &key)?;
    let row = ctx
        .db
        .ai_run_queued_input()
        .queued_input_id()
        .update(AiRunQueuedInput {
            payload: params.payload,
            revision: next_revision(item.revision)?,
            write_date: ctx.timestamp,
            ..item
        });
    append_queue_event(
        ctx,
        &state,
        key,
        "followup_edited",
        request_hash,
        row.queued_input_id,
        row.revision,
    );
    audit(ctx, &row, "UPDATE", Some(vec!["payload", "revision"]));
    Ok(())
}

#[reducer]
pub fn reorder_ai_run_follow_up(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: ReorderAiRunFollowUpParams,
) -> Result<(), String> {
    authorize(ctx, organization_id)?;
    validate_key("idempotency_key", &params.idempotency_key)?;
    let author = ctx.sender();
    let request_hash = command_hash("followup_reordered", &(&params, author));
    let key = event_key(organization_id, run_id, &params.idempotency_key);
    if replayed(ctx, &key, "followup_reordered", &request_hash)? {
        return Ok(());
    }
    require_author_grant(ctx, organization_id, author)?;
    let state = lifecycle_state(ctx, organization_id, company_id, run_id)?;
    let item = load_item(
        ctx,
        organization_id,
        company_id,
        run_id,
        params.queued_input_id,
    )?;
    ensure_mutable_by(&item, author, params.expected_revision)?;
    ensure_new_event(ctx, &key)?;
    let before = queued_entries(ctx, run_id);
    let order = reorder(&before, item.queued_input_id, params.target_position)?;
    let mut moved = None;
    for (index, id) in order.iter().enumerate() {
        let position = u32::try_from(index + 1).map_err(|_| "follow-up position overflow")?;
        let row = ctx
            .db
            .ai_run_queued_input()
            .queued_input_id()
            .find(id)
            .ok_or("queued follow-up disappeared during reorder")?;
        if row.position == position {
            continue;
        }
        let updated = ctx
            .db
            .ai_run_queued_input()
            .queued_input_id()
            .update(AiRunQueuedInput {
                position,
                revision: next_revision(row.revision)?,
                write_date: ctx.timestamp,
                ..row
            });
        if updated.queued_input_id == item.queued_input_id {
            moved = Some(updated);
        }
    }
    let row = moved.ok_or("follow-up is already at that position")?;
    append_queue_event(
        ctx,
        &state,
        key,
        "followup_reordered",
        request_hash,
        row.queued_input_id,
        row.revision,
    );
    audit(ctx, &row, "UPDATE", Some(vec!["position", "revision"]));
    Ok(())
}

#[reducer]
pub fn withdraw_ai_run_follow_up(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: WithdrawAiRunFollowUpParams,
) -> Result<(), String> {
    authorize(ctx, organization_id)?;
    validate_key("idempotency_key", &params.idempotency_key)?;
    let author = ctx.sender();
    let request_hash = command_hash("followup_withdrawn", &(&params, author));
    let key = event_key(organization_id, run_id, &params.idempotency_key);
    if replayed(ctx, &key, "followup_withdrawn", &request_hash)? {
        return Ok(());
    }
    // Withdrawing your own item is deliberately not grant-gated: lapsed
    // authority must never trap a queued item that can no longer be promoted.
    let state = lifecycle_state(ctx, organization_id, company_id, run_id)?;
    let item = load_item(
        ctx,
        organization_id,
        company_id,
        run_id,
        params.queued_input_id,
    )?;
    ensure_mutable_by(&item, author, params.expected_revision)?;
    ensure_new_event(ctx, &key)?;
    let row = ctx
        .db
        .ai_run_queued_input()
        .queued_input_id()
        .update(AiRunQueuedInput {
            status: WITHDRAWN.into(),
            revision: next_revision(item.revision)?,
            write_date: ctx.timestamp,
            ..item
        });
    append_queue_event(
        ctx,
        &state,
        key,
        "followup_withdrawn",
        request_hash,
        row.queued_input_id,
        row.revision,
    );
    audit(ctx, &row, "UPDATE", Some(vec!["status", "revision"]));
    Ok(())
}

// ── Reducer: promotion (the only queue command that starts work) ─────────────

/// Promote the head of the queue into a new checked continuation.
///
/// The settled run is left untouched (still `completed`); a child run is
/// created in `fork_pending_authority` exactly like `fork_ai_run_checked`, so
/// the gateway must reacquire scope, budget and approval through
/// `authorize_ai_run_fork` before the child can resume. The child also
/// requires a fresh checked checkpoint because it carries new authored input.
#[reducer]
pub fn promote_ai_run_follow_up(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: PromoteAiRunFollowUpParams,
) -> Result<(), String> {
    authorize(ctx, organization_id)?;
    validate_key("child_run_key", &params.child_run_key)?;
    validate_key("idempotency_key", &params.idempotency_key)?;
    let request_hash = command_hash("followup_promoted", &(&params, ctx.sender()));
    let key = event_key(organization_id, run_id, &params.idempotency_key);
    if replayed(ctx, &key, "followup_promoted", &request_hash)? {
        return Ok(());
    }
    let parent_state = checked_state(
        ctx,
        organization_id,
        company_id,
        run_id,
        &params.continuation,
    )?;
    let parent = load_run(ctx, organization_id, company_id, run_id)?;
    let item = load_item(
        ctx,
        organization_id,
        company_id,
        run_id,
        params.queued_input_id,
    )?;
    if item.revision != params.expected_revision {
        return Err("queued follow-up revision conflict".into());
    }
    let facts = SettlementFacts {
        run_status: parent.status.clone(),
        open_required_question: ctx
            .db
            .ai_run_question()
            .ai_run_question_by_run()
            .filter(&run_id)
            .any(|q| q.status == "open" && q.required),
        unsettled_effect: ctx
            .db
            .ai_run_effect()
            .ai_run_effect_by_run()
            .filter(&run_id)
            .any(|effect| !effect_is_settled(&effect.status)),
    };
    let queued = queued_entries(ctx, run_id);
    // The author's CURRENT grants, not the promoter's and not those held at
    // enqueue time.
    let author_authorized = author_holds_capability(ctx, organization_id, item.author);
    plan_promotion(
        &item.status,
        item.queued_input_id,
        &queued,
        &facts,
        author_authorized,
    )?;
    ensure_new_event(ctx, &key)?;
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
    let fork_key = format!("followup:{}", item.queued_input_id);
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
            serde_json::json!({
                "parent_run_id": run_id,
                "fork_key": fork_key,
                "queued_input_id": item.queued_input_id,
            })
            .to_string(),
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
        fork_key: Some(fork_key),
        interrupted_reason: None,
        steering_revision: parent_state.steering_revision,
        requires_revalidation: true,
        authority_snapshot_hash: None,
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
    });
    let row = ctx
        .db
        .ai_run_queued_input()
        .queued_input_id()
        .update(AiRunQueuedInput {
            status: PROMOTED.into(),
            promoted_run_id: Some(child.id),
            revision: next_revision(item.revision)?,
            write_date: ctx.timestamp,
            ..item
        });
    append_event(
        ctx,
        &parent_state,
        key,
        "followup_promoted",
        request_hash,
        parent_state.concurrency_version,
        Some(
            serde_json::json!({
                "queued_input_id": row.queued_input_id,
                "child_run_id": child.id,
            })
            .to_string(),
        ),
    );
    audit(
        ctx,
        &row,
        "UPDATE",
        Some(vec!["status", "promoted_run_id", "revision"]),
    );
    Ok(())
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn lifecycle_state(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
) -> Result<AiRunLifecycleState, String> {
    let state = ctx
        .db
        .ai_run_lifecycle_state()
        .run_id()
        .find(&run_id)
        .ok_or("run lifecycle is not initialized")?;
    if state.organization_id != organization_id || state.company_id != company_id {
        return Err("run lifecycle does not belong to this organization and company".into());
    }
    Ok(state)
}

fn load_item(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    queued_input_id: u64,
) -> Result<AiRunQueuedInput, String> {
    let item = ctx
        .db
        .ai_run_queued_input()
        .queued_input_id()
        .find(&queued_input_id)
        .ok_or("queued follow-up not found")?;
    if item.organization_id != organization_id
        || item.company_id != company_id
        || item.run_id != run_id
    {
        return Err("queued follow-up does not belong to this run".into());
    }
    Ok(item)
}

fn queued_entries(ctx: &ReducerContext, run_id: u64) -> Vec<QueueEntry> {
    ctx.db
        .ai_run_queued_input()
        .ai_run_queued_input_by_run()
        .filter(&run_id)
        .filter(|row| row.status == QUEUED)
        .map(|row| QueueEntry {
            id: row.queued_input_id,
            position: row.position,
        })
        .collect()
}

fn append_queue_event(
    ctx: &ReducerContext,
    state: &AiRunLifecycleState,
    key: String,
    kind: &str,
    request_hash: String,
    queued_input_id: u64,
    revision: u64,
) {
    // The state is not modified: from and to version are the same. The event
    // carries identifiers only, never the follow-up text.
    append_event(
        ctx,
        state,
        key,
        kind,
        request_hash,
        state.concurrency_version,
        Some(
            serde_json::json!({"queued_input_id": queued_input_id, "revision": revision})
                .to_string(),
        ),
    );
}

fn audit(
    ctx: &ReducerContext,
    row: &AiRunQueuedInput,
    action: &'static str,
    changed: Option<Vec<&str>>,
) {
    // Identifiers and status only; the follow-up payload is never audited.
    let snapshot = serde_json::json!({
        "run_id": row.run_id,
        "status": row.status,
        "position": row.position,
        "revision": row.revision,
        "promoted_run_id": row.promoted_run_id,
    })
    .to_string();
    write_audit_log_v2(
        ctx,
        row.organization_id,
        AuditLogParams {
            company_id: Some(row.company_id),
            table_name: "ai_run_queued_input",
            record_id: row.queued_input_id,
            action,
            old_values: None,
            new_values: Some(snapshot),
            changed_fields: changed
                .unwrap_or_default()
                .into_iter()
                .map(str::to_string)
                .collect(),
            metadata: None,
        },
    );
}

/// The author's current effective roles must carry an active, non-empty
/// `ai.run.lifecycle` grant. Mirrors the api-server grant resolution:
/// roles come from the single active membership plus unexpired assignments.
fn author_holds_capability(ctx: &ReducerContext, organization_id: u64, author: Identity) -> bool {
    identity_holds_capability(ctx, organization_id, author, FOLLOW_UP_CAPABILITY)
}

/// Whether `identity` currently holds an active, non-empty grant for exactly
/// `capability` through its effective roles. Absence is denial.
pub(crate) fn identity_holds_capability(
    ctx: &ReducerContext,
    organization_id: u64,
    author: Identity,
    capability: &str,
) -> bool {
    let active = find_user_profile_for_organization(ctx, author, organization_id)
        .is_some_and(|profile| profile.is_active);
    if !active {
        return false;
    }
    let Ok(roles) = effective_roles(ctx, organization_id, author) else {
        return false;
    };
    let role_ids: Vec<u64> = roles.iter().map(|role| role.id).collect();
    let grants: Vec<GrantView> = ctx
        .db
        .ai_capability_role_grant()
        .ai_capability_grant_by_org()
        .filter(&organization_id)
        .map(|grant| GrantView {
            role_id: grant.role_id,
            capability_key: grant.capability_key,
            is_active: grant.is_active,
            max_rows: grant.max_rows,
            max_bytes: grant.max_bytes,
        })
        .collect();
    grants_cover_capability(&role_ids, &grants, capability)
}

fn require_author_grant(
    ctx: &ReducerContext,
    organization_id: u64,
    author: Identity,
) -> Result<(), String> {
    if author_holds_capability(ctx, organization_id, author) {
        Ok(())
    } else {
        Err("author does not hold the ai.run.lifecycle grant".into())
    }
}

// ── Pure decision logic (unit tested) ────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Eq)]
struct QueueEntry {
    id: u64,
    position: u32,
}

#[derive(Clone, Debug)]
struct GrantView {
    pub role_id: u64,
    pub capability_key: String,
    pub is_active: bool,
    pub max_rows: u32,
    pub max_bytes: u64,
}

#[derive(Clone, Debug)]
struct SettlementFacts {
    pub run_status: String,
    pub open_required_question: bool,
    pub unsettled_effect: bool,
}

/// Only a run that can still produce a settled outcome accepts follow-ups.
fn queue_accepts_run_status(status: &str) -> bool {
    !matches!(status, "failed" | "cancelled")
}

fn effect_is_settled(status: &str) -> bool {
    matches!(status, "confirmed" | "failed")
}

fn next_revision(revision: u64) -> Result<u64, String> {
    revision
        .checked_add(1)
        .ok_or_else(|| "queued follow-up revision overflow".to_string())
}

fn next_position(queued: &[QueueEntry]) -> Result<u32, String> {
    queued
        .iter()
        .map(|entry| entry.position)
        .max()
        .unwrap_or(0)
        .checked_add(1)
        .ok_or_else(|| "follow-up position overflow".to_string())
}

/// Roles are additive; the author needs one active, non-empty grant.
fn grants_cover_capability(role_ids: &[u64], grants: &[GrantView], capability: &str) -> bool {
    grants.iter().any(|grant| {
        grant.is_active
            && grant.capability_key == capability
            && grant.max_rows > 0
            && grant.max_bytes > 0
            && role_ids.contains(&grant.role_id)
    })
}

/// Edit, reorder and withdraw: queued, authored by the caller, current revision.
fn ensure_mutable_by(
    item: &AiRunQueuedInput,
    caller: Identity,
    expected_revision: u64,
) -> Result<(), String> {
    check_mutable(
        &item.status,
        item.author == caller,
        item.revision,
        expected_revision,
    )
}

fn check_mutable(
    status: &str,
    caller_is_author: bool,
    revision: u64,
    expected_revision: u64,
) -> Result<(), String> {
    if !caller_is_author {
        return Err("only the author can change a queued follow-up".into());
    }
    if status != QUEUED {
        return Err(format!("queued follow-up is already {status}"));
    }
    if revision != expected_revision {
        return Err("queued follow-up revision conflict".into());
    }
    Ok(())
}

/// Queued ids in promotion order: position, then id.
fn queue_order(queued: &[QueueEntry]) -> Vec<u64> {
    let mut sorted = queued.to_vec();
    sorted.sort_by_key(|entry| (entry.position, entry.id));
    sorted.into_iter().map(|entry| entry.id).collect()
}

/// New order after moving `moving` to the 1-based `target_position`.
fn reorder(queued: &[QueueEntry], moving: u64, target_position: u32) -> Result<Vec<u64>, String> {
    let mut order = queue_order(queued);
    let current = order
        .iter()
        .position(|id| *id == moving)
        .ok_or("queued follow-up is not in the queue")?;
    let target = usize::try_from(target_position).unwrap_or(usize::MAX);
    if target == 0 || target > order.len() {
        return Err("target position is outside the queue".into());
    }
    order.remove(current);
    order.insert(target - 1, moving);
    Ok(order)
}

/// A fully settled run is `completed`: not `agent_settled` (candidate answer
/// still awaiting the answer gate), not waiting, interrupted or running, with
/// no required open question and no effect still awaiting reconciliation.
fn ensure_fully_settled(facts: &SettlementFacts) -> Result<(), String> {
    match facts.run_status.as_str() {
        "completed" => {}
        "agent_settled" => {
            return Err(
                "run is only agent_settled; follow-ups promote after it is fully settled".into(),
            )
        }
        other => {
            return Err(format!(
                "run is {other}; follow-ups promote only after it is fully settled"
            ))
        }
    }
    if facts.open_required_question {
        return Err("run has an unanswered required durable question".into());
    }
    if facts.unsettled_effect {
        return Err("run has an effect requiring reconciliation before follow-up".into());
    }
    Ok(())
}

/// All promotion gates in one place. Replays are answered before this runs.
fn plan_promotion(
    item_status: &str,
    item_id: u64,
    queued: &[QueueEntry],
    facts: &SettlementFacts,
    author_authorized: bool,
) -> Result<(), String> {
    if item_status != QUEUED {
        return Err(format!("queued follow-up is already {item_status}"));
    }
    if queue_order(queued).first() != Some(&item_id) {
        return Err("only the head of the follow-up queue can be promoted".into());
    }
    ensure_fully_settled(facts)?;
    if !author_authorized {
        return Err("author authority lapsed; the follow-up cannot be promoted".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: u64, position: u32) -> QueueEntry {
        QueueEntry { id, position }
    }

    fn settled() -> SettlementFacts {
        SettlementFacts {
            run_status: "completed".into(),
            open_required_question: false,
            unsettled_effect: false,
        }
    }

    fn enqueue(payload: &str, key: &str) -> EnqueueAiRunFollowUpParams {
        EnqueueAiRunFollowUpParams {
            payload: payload.into(),
            idempotency_key: key.into(),
        }
    }

    #[test]
    fn enqueue_idempotency_is_payload_and_author_bound() {
        let author = Identity::from_byte_array([1; 32]);
        let other = Identity::from_byte_array([2; 32]);
        let first = enqueue("check supplier", "fu-1");
        let same = enqueue("check supplier", "fu-1");
        let changed = enqueue("check another supplier", "fu-1");
        let hash = |params: &EnqueueAiRunFollowUpParams, who: Identity| {
            command_hash("followup_enqueued", &(params, who))
        };
        assert_eq!(hash(&first, author), hash(&same, author));
        assert_ne!(hash(&first, author), hash(&changed, author));
        // Same key and text from a different author conflicts, never replays.
        assert_ne!(hash(&first, author), hash(&first, other));
        assert_ne!(
            hash(&first, author),
            command_hash("followup_edited", &(&first, author))
        );
    }

    #[test]
    fn promotion_is_exactly_once() {
        let queue = [entry(7, 1), entry(8, 2)];
        assert!(plan_promotion(QUEUED, 7, &queue, &settled(), true).is_ok());
        // After the first promotion the row is no longer queued, so a second
        // command with a new idempotency key is rejected.
        let after = [entry(8, 2)];
        assert!(plan_promotion(PROMOTED, 7, &after, &settled(), true).is_err());
        assert!(plan_promotion(WITHDRAWN, 7, &after, &settled(), true).is_err());
        assert!(plan_promotion(SUPERSEDED, 7, &after, &settled(), true).is_err());
    }

    #[test]
    fn only_the_queue_head_is_promoted() {
        let queue = [entry(7, 2), entry(8, 1), entry(9, 3)];
        assert!(plan_promotion(QUEUED, 8, &queue, &settled(), true).is_ok());
        assert!(plan_promotion(QUEUED, 7, &queue, &settled(), true).is_err());
        assert!(plan_promotion(QUEUED, 9, &queue, &settled(), true).is_err());
    }

    #[test]
    fn promotion_denied_unless_fully_settled() {
        let queue = [entry(7, 1)];
        for status in [
            "agent_settled",
            "running",
            "pending",
            "waiting_input",
            "awaiting_approval",
            "interrupted",
            "failed",
            "cancelled",
        ] {
            let facts = SettlementFacts {
                run_status: status.into(),
                ..settled()
            };
            assert!(
                plan_promotion(QUEUED, 7, &queue, &facts, true).is_err(),
                "{status} must not promote"
            );
        }
        let agent_settled = SettlementFacts {
            run_status: "agent_settled".into(),
            ..settled()
        };
        let message = plan_promotion(QUEUED, 7, &queue, &agent_settled, true).unwrap_err();
        assert!(message.contains("agent_settled"));
        let open_question = SettlementFacts {
            open_required_question: true,
            ..settled()
        };
        assert!(plan_promotion(QUEUED, 7, &queue, &open_question, true).is_err());
        let unreconciled = SettlementFacts {
            unsettled_effect: true,
            ..settled()
        };
        assert!(plan_promotion(QUEUED, 7, &queue, &unreconciled, true).is_err());
    }

    #[test]
    fn effects_settle_only_when_confirmed_or_failed() {
        for status in ["planned", "dispatched", "uncertain"] {
            assert!(!effect_is_settled(status), "{status}");
        }
        assert!(effect_is_settled("confirmed"));
        assert!(effect_is_settled("failed"));
    }

    #[test]
    fn promotion_denied_when_author_grants_lapsed() {
        let queue = [entry(7, 1)];
        let message = plan_promotion(QUEUED, 7, &queue, &settled(), false).unwrap_err();
        assert!(message.contains("lapsed"));

        let grants = vec![GrantView {
            role_id: 3,
            capability_key: FOLLOW_UP_CAPABILITY.into(),
            is_active: true,
            max_rows: 100,
            max_bytes: 1024,
        }];
        assert!(grants_cover_capability(&[3], &grants, FOLLOW_UP_CAPABILITY));
        // Role removed, grant deactivated, emptied, or another capability.
        assert!(!grants_cover_capability(
            &[4],
            &grants,
            FOLLOW_UP_CAPABILITY
        ));
        assert!(!grants_cover_capability(&[], &grants, FOLLOW_UP_CAPABILITY));
        let mut inactive = grants.clone();
        inactive[0].is_active = false;
        assert!(!grants_cover_capability(
            &[3],
            &inactive,
            FOLLOW_UP_CAPABILITY
        ));
        let mut empty_rows = grants.clone();
        empty_rows[0].max_rows = 0;
        assert!(!grants_cover_capability(
            &[3],
            &empty_rows,
            FOLLOW_UP_CAPABILITY
        ));
        let mut empty_bytes = grants.clone();
        empty_bytes[0].max_bytes = 0;
        assert!(!grants_cover_capability(
            &[3],
            &empty_bytes,
            FOLLOW_UP_CAPABILITY
        ));
        assert!(!grants_cover_capability(
            &[3],
            &grants,
            "ai.evidence.inspect"
        ));
    }

    #[test]
    fn edit_and_withdraw_require_the_author_and_current_revision() {
        assert!(check_mutable(QUEUED, true, 2, 2).is_ok());
        assert!(check_mutable(QUEUED, false, 2, 2).is_err());
        assert!(check_mutable(QUEUED, true, 3, 2).is_err());
        assert!(check_mutable(PROMOTED, true, 2, 2).is_err());
        assert!(check_mutable(WITHDRAWN, true, 2, 2).is_err());
    }

    #[test]
    fn reorder_moves_within_the_queued_items() {
        let queue = [entry(1, 1), entry(2, 2), entry(3, 3)];
        assert_eq!(reorder(&queue, 3, 1).unwrap(), vec![3, 1, 2]);
        assert_eq!(reorder(&queue, 1, 3).unwrap(), vec![2, 3, 1]);
        assert_eq!(reorder(&queue, 2, 2).unwrap(), vec![1, 2, 3]);
        assert!(reorder(&queue, 2, 0).is_err());
        assert!(reorder(&queue, 2, 4).is_err());
        assert!(reorder(&queue, 99, 1).is_err());
    }

    #[test]
    fn order_survives_gaps_left_by_withdrawn_items() {
        // Withdrawing item 2 leaves positions 1 and 3; order is still stable.
        let queue = [entry(3, 3), entry(1, 1)];
        assert_eq!(queue_order(&queue), vec![1, 3]);
        assert_eq!(next_position(&queue).unwrap(), 4);
        assert_eq!(next_position(&[]).unwrap(), 1);
        // Equal positions never occur, but ties would break by id.
        assert_eq!(queue_order(&[entry(9, 1), entry(4, 1)]), vec![4, 9]);
        // Reorder renumbers densely from the gapped order.
        assert_eq!(reorder(&queue, 3, 1).unwrap(), vec![3, 1]);
    }

    #[test]
    fn terminal_failed_runs_do_not_accept_follow_ups() {
        for status in ["pending", "running", "waiting_input", "awaiting_approval"] {
            assert!(queue_accepts_run_status(status), "{status}");
        }
        assert!(queue_accepts_run_status("agent_settled"));
        assert!(queue_accepts_run_status("completed"));
        assert!(!queue_accepts_run_status("failed"));
        assert!(!queue_accepts_run_status("cancelled"));
    }

    /// Structural guard for "a queued item never interrupts a running turn":
    /// the maintenance reducers must not write the run row or the lifecycle
    /// state (continuation tuple). Only promotion may, and it writes a new
    /// child run and never the settled parent.
    #[test]
    fn queue_maintenance_never_writes_run_or_lifecycle_state() {
        let source = include_str!("run_followup_queue.rs");
        let start = source
            .find("// ── Reducers: queue maintenance")
            .expect("maintenance section");
        let end = source
            .find("// ── Reducer: promotion")
            .expect("promotion section");
        let maintenance = &source[start..end];
        for forbidden in [
            "ai_agent_run()",
            "ai_run_lifecycle_state()",
            "transition_state_and_run",
            "mutate_state",
            "concurrency_version +",
            "steering_revision",
            "requires_revalidation",
        ] {
            assert!(
                !maintenance.contains(forbidden),
                "queue maintenance must not touch {forbidden}"
            );
        }
        let promotion = &source[end..];
        let promote_body = &promotion[..promotion.find("// ── Helpers").expect("helpers section")];
        // The settled parent run row is never rewritten by promotion.
        assert!(!promote_body.contains("ai_agent_run().id().update"));
        assert!(!promote_body.contains("ai_run_lifecycle_state().run_id().update"));
    }

    #[test]
    fn promotion_never_inherits_authority() {
        // A promoted continuation is created in the existing fork state with no
        // authority snapshot, so scope, budget and approval are reacquired.
        let source = include_str!("run_followup_queue.rs");
        assert!(source.contains("state: \"fork_pending_authority\".into()"));
        assert!(source.contains("authority_snapshot_hash: None"));
        assert!(source.contains("requires_revalidation: true"));
    }

    #[test]
    fn owner_baseline_covers_descriptor_but_not_budget_resolve() {
        use crate::ai::capability_grants::{
            AI_HARNESS_DESCRIPTOR_READ_CAPABILITY, AI_RUN_BUDGET_RESOLVE_CAPABILITY,
            OWNER_AI_CAPABILITY_GRANTS,
        };
        let grants: Vec<GrantView> = OWNER_AI_CAPABILITY_GRANTS
            .iter()
            .map(|grant| GrantView {
                role_id: 1,
                capability_key: grant.capability_key.into(),
                is_active: true,
                max_rows: grant.max_rows,
                max_bytes: grant.max_bytes,
            })
            .collect();
        assert!(grants_cover_capability(
            &[1],
            &grants,
            AI_HARNESS_DESCRIPTOR_READ_CAPABILITY
        ));
        assert!(!grants_cover_capability(
            &[1],
            &grants,
            AI_RUN_BUDGET_RESOLVE_CAPABILITY
        ));
    }
}
