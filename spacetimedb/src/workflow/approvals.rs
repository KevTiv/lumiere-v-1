//! Version-pinned human tasks and append-only decision evidence.
//!
//! This module deliberately replaces the disposable approval-rule/request model.
//! Task policy comes from an immutable workflow version, while authorization and
//! subject freshness are re-evaluated when a decision is committed.

use sha2::{Digest, Sha256};
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::users::user_organization;
use crate::helpers::check_permission;

use super::action_registry::{
    execute_guarded_action, snapshot_guarded_action, ExecuteGuardedActionParams,
    GuardedActionInput, GuardedActionKey,
};
use super::authorization::{
    authorize_workflow_decision, authorize_workflow_decision_for_actor,
    WorkflowAuthorizationDecision, WorkflowAuthorizationRequest,
};
use super::definitions::{
    workflow_edge, workflow_node, WorkflowHumanTaskKind, WorkflowNodeKind, WorkflowTaskAssignment,
    WorkflowTaskPolicy,
};
use super::runtime::{
    apply_runtime_event, workflow_instance, workflow_token, RuntimeEventContext, RuntimeMutation,
    RuntimeTransition, WorkflowAuthorizationOutcome, WorkflowCommandKind, WorkflowInstance,
    WorkflowTokenState,
};

const MAX_COMMAND_KEY_LEN: usize = 256;
const MAX_COMMENT_LEN: usize = 8_192;

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowHumanTaskStatus {
    Open,
    Claimed,
    Approved,
    Rejected,
    Completed,
    Invalidated,
    Cancelled,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowHumanTaskDecision {
    Approve,
    Reject,
    Complete,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowHumanTaskCommandKind {
    Create,
    Claim,
    Decision,
    Invalidate,
    Comment,
}

/// Optional guarded effect executed by an approval decision.
#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub struct WorkflowTaskGuardedAction {
    pub key: GuardedActionKey,
    pub schema_version: u32,
}

/// Authoritative task projection. It is private; Wave 4 supplies scoped inbox reads.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = workflow_human_task,
    index(accessor = human_task_by_org, btree(columns = [organization_id])),
    index(accessor = human_task_by_company, btree(columns = [company_id])),
    index(accessor = human_task_by_instance, btree(columns = [workflow_instance_id])),
    index(accessor = human_task_by_token, btree(columns = [token_id])),
    index(accessor = human_task_by_status, btree(columns = [status]))
)]
pub struct WorkflowHumanTask {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub workflow_id: u64,
    pub workflow_version_id: u64,
    pub workflow_instance_id: u64,
    pub token_id: u64,
    pub node_id: u64,
    pub node_key: String,
    pub kind: WorkflowHumanTaskKind,
    pub assignment: WorkflowTaskAssignment,
    pub candidate_role_ids: Vec<u64>,
    pub candidate_group_ids: Vec<u64>,
    pub candidate_unit_ids: Vec<u64>,
    pub require_comment_on_reject: bool,
    pub subject_model: String,
    pub subject_id: u64,
    /// Canonical evaluator snapshot hash pinned on the workflow instance.
    pub condition_revision_hash: String,
    /// Full material domain snapshot hash, including guarded child rows.
    pub subject_revision_hash: String,
    pub guarded_action: Option<WorkflowTaskGuardedAction>,
    pub status: WorkflowHumanTaskStatus,
    pub revision: u64,
    pub requested_by: Identity,
    pub requested_at: Timestamp,
    pub claimed_by: Option<Identity>,
    pub claimed_at: Option<Timestamp>,
    pub decided_by: Option<Identity>,
    pub acting_for: Option<Identity>,
    pub decided_at: Option<Timestamp>,
    pub decision: Option<WorkflowHumanTaskDecision>,
    pub decision_comment: Option<String>,
    pub invalidated_by: Option<Identity>,
    pub invalidated_at: Option<Timestamp>,
    pub invalidation_reason: Option<String>,
    pub correlation_id: String,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// Explicit workflow-group membership. Unit membership uses the existing active
/// organization membership's `department_id`; roles use current role assignments.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = workflow_candidate_group_member,
    index(accessor = candidate_group_member_by_org, btree(columns = [organization_id])),
    index(accessor = candidate_group_member_by_identity, btree(columns = [member_identity])),
    index(accessor = candidate_group_member_by_group, btree(columns = [group_id]))
)]
pub struct WorkflowCandidateGroupMember {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub group_id: u64,
    pub member_identity: Identity,
    pub is_active: bool,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub revoked_by: Option<Identity>,
    pub revoked_at: Option<Timestamp>,
}

/// Append-only human-task evidence, including comments and invalidations.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = workflow_human_task_event,
    index(accessor = human_task_event_by_org, btree(columns = [organization_id])),
    index(accessor = human_task_event_by_company, btree(columns = [company_id])),
    index(accessor = human_task_event_by_task, btree(columns = [task_id])),
    index(accessor = human_task_event_by_instance, btree(columns = [workflow_instance_id]))
)]
pub struct WorkflowHumanTaskEvent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub workflow_version_id: u64,
    pub workflow_instance_id: u64,
    pub task_id: u64,
    pub command_kind: WorkflowHumanTaskCommandKind,
    pub prior_status: Option<WorkflowHumanTaskStatus>,
    pub next_status: WorkflowHumanTaskStatus,
    pub decision: Option<WorkflowHumanTaskDecision>,
    pub actor: Identity,
    pub acting_for: Option<Identity>,
    pub matched_role_id: Option<u64>,
    pub delegation_id: Option<u64>,
    pub prior_revision: u64,
    pub next_revision: u64,
    pub idempotency_key: String,
    pub input_hash: String,
    pub subject_revision_hash: String,
    pub comment: Option<String>,
    pub domain_receipt: Option<String>,
    pub correlation_id: String,
    pub recorded_at: Timestamp,
}

/// Stable semantic command result. Identical replay is a no-op; changed input fails.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = workflow_human_task_receipt,
    index(accessor = human_task_receipt_by_task, btree(columns = [task_id]))
)]
pub struct WorkflowHumanTaskReceipt {
    #[primary_key]
    pub scope_key: String,
    pub organization_id: u64,
    pub company_id: u64,
    pub task_id: u64,
    pub command_kind: WorkflowHumanTaskCommandKind,
    pub idempotency_key: String,
    pub input_hash: String,
    pub result_status: WorkflowHumanTaskStatus,
    pub result_revision: u64,
    pub domain_receipt: Option<String>,
    pub created_by: Identity,
    pub created_at: Timestamp,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ClaimWorkflowHumanTaskParams {
    pub company_id: u64,
    pub task_id: u64,
    pub expected_revision: u64,
    pub acting_for: Option<Identity>,
    pub idempotency_key: String,
    pub correlation_id: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct DecideWorkflowHumanTaskParams {
    pub company_id: u64,
    pub task_id: u64,
    pub expected_task_revision: u64,
    pub expected_instance_revision: u64,
    pub decision: WorkflowHumanTaskDecision,
    pub acting_for: Option<Identity>,
    pub comment: Option<String>,
    pub idempotency_key: String,
    pub correlation_id: String,
    pub causation_id: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct InvalidateWorkflowHumanTaskParams {
    pub company_id: u64,
    pub task_id: u64,
    pub expected_revision: u64,
    pub observed_subject_revision_hash: String,
    pub reason: String,
    pub idempotency_key: String,
    pub correlation_id: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct AddWorkflowHumanTaskCommentParams {
    pub company_id: u64,
    pub task_id: u64,
    pub expected_revision: u64,
    pub comment: String,
    pub idempotency_key: String,
    pub correlation_id: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct SetWorkflowCandidateGroupMemberParams {
    pub group_id: u64,
    pub member_identity: Identity,
    pub is_active: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct CreateWorkflowHumanTaskParams {
    pub instance_id: u64,
    pub token_id: u64,
    pub guarded_action: Option<WorkflowTaskGuardedAction>,
    pub requested_by: Identity,
    pub correlation_id: String,
    /// Required for guarded tasks; otherwise the instance revision is used.
    pub subject_revision_hash: Option<String>,
}

pub(crate) fn create_workflow_human_task_internal(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateWorkflowHumanTaskParams,
) -> Result<WorkflowHumanTask, String> {
    let instance = require_instance(ctx, organization_id, company_id, params.instance_id)?;
    let token = ctx
        .db
        .workflow_token()
        .id()
        .find(&params.token_id)
        .ok_or("workflow token not found")?;
    if token.organization_id != organization_id
        || token.company_id != company_id
        || token.instance_id != instance.id
        || token.workflow_version_id != instance.workflow_version_id
    {
        return Err("workflow token scope does not match the task instance".to_string());
    }
    if token.state != WorkflowTokenState::Active {
        return Err("workflow task requires an active token".to_string());
    }
    if let Some(existing) = ctx
        .db
        .workflow_human_task()
        .human_task_by_token()
        .filter(&token.id)
        .find(|task| task.workflow_instance_id == instance.id)
    {
        if existing.guarded_action == params.guarded_action {
            return Ok(existing);
        }
        return Err("workflow token already has a task with different action input".to_string());
    }
    let node = ctx
        .db
        .workflow_node()
        .id()
        .find(&token.node_id)
        .ok_or("workflow task node not found")?;
    if node.organization_id != organization_id
        || node.workflow_version_id != instance.workflow_version_id
        || node.node_key != token.node_key
        || node.kind != WorkflowNodeKind::HumanTask
    {
        return Err("active token is not on a version-matched human task node".to_string());
    }
    let policy = node
        .task_policy
        .ok_or("human task node has no task policy")?;
    validate_policy(&policy)?;
    match (&params.guarded_action, &params.subject_revision_hash) {
        (Some(_), None) => {
            return Err("guarded human task requires a material subject revision".to_string())
        }
        (None, Some(revision)) if revision != &instance.subject_revision_hash => {
            return Err("non-guarded task revision must match the workflow instance".to_string())
        }
        _ => {}
    }

    let task = ctx.db.workflow_human_task().insert(WorkflowHumanTask {
        id: 0,
        organization_id,
        company_id,
        workflow_id: instance.workflow_id,
        workflow_version_id: instance.workflow_version_id,
        workflow_instance_id: instance.id,
        token_id: token.id,
        node_id: node.id,
        node_key: node.node_key,
        kind: policy.kind,
        assignment: policy.assignment,
        candidate_role_ids: sorted_ids(policy.candidate_role_ids),
        candidate_group_ids: sorted_ids(policy.candidate_group_ids),
        candidate_unit_ids: sorted_ids(policy.candidate_unit_ids),
        require_comment_on_reject: policy.require_comment_on_reject,
        subject_model: instance.subject_model,
        subject_id: instance.subject_id,
        condition_revision_hash: instance.subject_revision_hash.clone(),
        subject_revision_hash: params
            .subject_revision_hash
            .unwrap_or(instance.subject_revision_hash),
        guarded_action: params.guarded_action,
        status: WorkflowHumanTaskStatus::Open,
        revision: 1,
        requested_by: params.requested_by,
        requested_at: ctx.timestamp,
        claimed_by: None,
        claimed_at: None,
        decided_by: None,
        acting_for: None,
        decided_at: None,
        decision: None,
        decision_comment: None,
        invalidated_by: None,
        invalidated_at: None,
        invalidation_reason: None,
        correlation_id: params.correlation_id.clone(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });
    append_event(
        ctx,
        &task,
        WorkflowHumanTaskCommandKind::Create,
        None,
        WorkflowHumanTaskStatus::Open,
        None,
        params.requested_by,
        None,
        None,
        None,
        0,
        1,
        "task-created",
        &hash_fields(&[task.id.to_string(), task.subject_revision_hash.clone()]),
        None,
        None,
        &params.correlation_id,
    );
    Ok(task)
}

#[reducer]
pub fn claim_workflow_human_task(
    ctx: &ReducerContext,
    organization_id: u64,
    params: ClaimWorkflowHumanTaskParams,
) -> Result<(), String> {
    claim_workflow_human_task_for_actor(ctx, organization_id, ctx.sender(), params)?;
    Ok(())
}

pub(crate) fn claim_workflow_human_task_for_actor(
    ctx: &ReducerContext,
    organization_id: u64,
    actor: Identity,
    params: ClaimWorkflowHumanTaskParams,
) -> Result<WorkflowHumanTask, String> {
    validate_key(&params.idempotency_key, "idempotency key")?;
    validate_key(&params.correlation_id, "correlation id")?;
    let input_hash = hash_fields(&[
        organization_id.to_string(),
        params.company_id.to_string(),
        params.task_id.to_string(),
        params.expected_revision.to_string(),
        identity_text(params.acting_for),
    ]);
    if let Some(receipt) = replay_receipt(
        ctx,
        organization_id,
        params.task_id,
        &WorkflowHumanTaskCommandKind::Claim,
        &params.idempotency_key,
        &input_hash,
    )? {
        return require_task(ctx, organization_id, params.company_id, receipt.task_id);
    }
    let task = require_task(ctx, organization_id, params.company_id, params.task_id)?;
    require_revision(&task, params.expected_revision)?;
    if task.status != WorkflowHumanTaskStatus::Open {
        return Err("only an open workflow task can be claimed".to_string());
    }
    let authorization =
        authorize_task_actor(ctx, actor, &task, params.acting_for, "workflow_task:write")?;
    let next_revision = next_revision(task.revision)?;
    let updated = ctx.db.workflow_human_task().id().update(WorkflowHumanTask {
        status: WorkflowHumanTaskStatus::Claimed,
        revision: next_revision,
        claimed_by: Some(actor),
        claimed_at: Some(ctx.timestamp),
        correlation_id: params.correlation_id.clone(),
        updated_at: ctx.timestamp,
        ..task.clone()
    });
    append_authorized_event(
        ctx,
        &task,
        &updated,
        WorkflowHumanTaskCommandKind::Claim,
        None,
        &authorization,
        &params.idempotency_key,
        &input_hash,
        None,
        None,
        &params.correlation_id,
    );
    insert_receipt(
        ctx,
        &updated,
        WorkflowHumanTaskCommandKind::Claim,
        params.idempotency_key,
        input_hash,
        None,
        actor,
    );
    Ok(updated)
}

#[reducer]
pub fn decide_workflow_human_task(
    ctx: &ReducerContext,
    organization_id: u64,
    params: DecideWorkflowHumanTaskParams,
) -> Result<(), String> {
    decide_workflow_human_task_for_actor(ctx, organization_id, ctx.sender(), params)?;
    Ok(())
}

pub(crate) fn decide_workflow_human_task_for_actor(
    ctx: &ReducerContext,
    organization_id: u64,
    actor: Identity,
    params: DecideWorkflowHumanTaskParams,
) -> Result<WorkflowHumanTask, String> {
    validate_key(&params.idempotency_key, "idempotency key")?;
    validate_key(&params.correlation_id, "correlation id")?;
    let comment = normalize_comment(params.comment.clone())?;
    let input_hash = decision_input_hash(organization_id, &params, comment.as_deref());
    if let Some(receipt) = replay_receipt(
        ctx,
        organization_id,
        params.task_id,
        &WorkflowHumanTaskCommandKind::Decision,
        &params.idempotency_key,
        &input_hash,
    )? {
        return require_task(ctx, organization_id, params.company_id, receipt.task_id);
    }

    let task = require_task(ctx, organization_id, params.company_id, params.task_id)?;
    require_revision(&task, params.expected_task_revision)?;
    if !matches!(
        task.status,
        WorkflowHumanTaskStatus::Open | WorkflowHumanTaskStatus::Claimed
    ) {
        return Err("workflow task is not open for a decision".to_string());
    }
    if task.claimed_by.is_some_and(|claimer| claimer != actor) {
        return Err("workflow task is claimed by another actor".to_string());
    }
    validate_decision(&task, &params.decision, comment.as_deref())?;
    let permission = match params.decision {
        WorkflowHumanTaskDecision::Approve => "workflow_task:approve",
        WorkflowHumanTaskDecision::Reject => "workflow_task:reject",
        WorkflowHumanTaskDecision::Complete => "workflow_task:complete",
    };
    let authorization = authorize_task_actor(ctx, actor, &task, params.acting_for, permission)?;
    let instance = require_instance(
        ctx,
        organization_id,
        params.company_id,
        task.workflow_instance_id,
    )?;
    if instance.revision != params.expected_instance_revision {
        return Err(format!(
            "stale workflow instance revision: expected {}, current {}",
            params.expected_instance_revision, instance.revision
        ));
    }
    if instance.subject_revision_hash != task.condition_revision_hash {
        return Err("workflow task subject revision no longer matches its instance".to_string());
    }

    let edge = decision_edge(ctx, &task, &params.decision)?;
    if params.decision == WorkflowHumanTaskDecision::Approve && task.guarded_action.is_some() {
        validate_guarded_action_target(ctx, &task, &edge)?;
    }
    let domain_receipt = if params.decision == WorkflowHumanTaskDecision::Approve {
        execute_task_action(ctx, &task, &params.idempotency_key)?
    } else {
        None
    };
    let token = ctx
        .db
        .workflow_token()
        .id()
        .find(&task.token_id)
        .ok_or("workflow task token not found")?;
    if token.state != WorkflowTokenState::Active {
        return Err("workflow task token is no longer active".to_string());
    }
    let mut updated_instance = apply_runtime_event(
        ctx,
        &instance,
        RuntimeEventContext {
            command_kind: WorkflowCommandKind::HumanDecision,
            expected_instance_revision: params.expected_instance_revision,
            idempotency_key: params.idempotency_key.clone(),
            input_hash: input_hash.clone(),
            action_key: task
                .guarded_action
                .as_ref()
                .map(|action| action.key.as_str().to_string()),
            condition_result: None,
            authorization_outcome: WorkflowAuthorizationOutcome::Allowed,
            acting_for: authorization.acting_for_identity,
            matched_role_id: authorization.matched_role_id,
            delegation_id: authorization.delegation_id,
            domain_receipt: None,
            reason: comment.clone(),
            correlation_id: params.correlation_id.clone(),
            causation_id: params.causation_id.clone(),
        },
        RuntimeMutation::Transitions(vec![RuntimeTransition {
            token_id: token.id,
            expected_token_revision: token.revision,
            edge_id: edge.id,
        }]),
    )?;
    if let (Some(action), Some(receipt)) = (task.guarded_action.as_ref(), domain_receipt.as_ref()) {
        updated_instance = complete_guarded_action_node(
            ctx,
            &updated_instance,
            action,
            &authorization,
            &params,
            &input_hash,
            receipt,
        )?;
    }
    let status = decision_status(&params.decision);
    let next_revision = next_revision(task.revision)?;
    let updated = ctx.db.workflow_human_task().id().update(WorkflowHumanTask {
        status: status.clone(),
        revision: next_revision,
        decided_by: Some(actor),
        acting_for: params.acting_for,
        decided_at: Some(ctx.timestamp),
        decision: Some(params.decision.clone()),
        decision_comment: comment.clone(),
        correlation_id: params.correlation_id.clone(),
        updated_at: ctx.timestamp,
        ..task.clone()
    });
    append_authorized_event(
        ctx,
        &task,
        &updated,
        WorkflowHumanTaskCommandKind::Decision,
        Some(params.decision),
        &authorization,
        &params.idempotency_key,
        &input_hash,
        comment,
        domain_receipt.clone(),
        &params.correlation_id,
    );
    insert_receipt(
        ctx,
        &updated,
        WorkflowHumanTaskCommandKind::Decision,
        params.idempotency_key,
        input_hash,
        domain_receipt.clone(),
        actor,
    );
    let expected_runtime_revision = params
        .expected_instance_revision
        .checked_add(if domain_receipt.is_some() { 2 } else { 1 })
        .ok_or("workflow instance revision overflow")?;
    if updated_instance.revision != expected_runtime_revision {
        return Err("workflow decision advanced an unexpected number of revisions".to_string());
    }
    Ok(updated)
}

#[reducer]
pub fn invalidate_workflow_human_task(
    ctx: &ReducerContext,
    organization_id: u64,
    params: InvalidateWorkflowHumanTaskParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow_task", "write")?;
    invalidate_workflow_human_task_internal(ctx, organization_id, ctx.sender(), params)?;
    Ok(())
}

pub(crate) fn invalidate_workflow_human_task_internal(
    ctx: &ReducerContext,
    organization_id: u64,
    actor: Identity,
    params: InvalidateWorkflowHumanTaskParams,
) -> Result<WorkflowHumanTask, String> {
    validate_key(&params.idempotency_key, "idempotency key")?;
    validate_key(&params.correlation_id, "correlation id")?;
    validate_required(&params.reason, "invalidation reason")?;
    let input_hash = hash_fields(&[
        organization_id.to_string(),
        params.company_id.to_string(),
        params.task_id.to_string(),
        params.expected_revision.to_string(),
        params.observed_subject_revision_hash.clone(),
        params.reason.trim().to_string(),
    ]);
    if let Some(receipt) = replay_receipt(
        ctx,
        organization_id,
        params.task_id,
        &WorkflowHumanTaskCommandKind::Invalidate,
        &params.idempotency_key,
        &input_hash,
    )? {
        return require_task(ctx, organization_id, params.company_id, receipt.task_id);
    }
    let task = require_task(ctx, organization_id, params.company_id, params.task_id)?;
    require_revision(&task, params.expected_revision)?;
    if !matches!(
        task.status,
        WorkflowHumanTaskStatus::Open | WorkflowHumanTaskStatus::Claimed
    ) {
        return Err("only an open workflow task can be invalidated".to_string());
    }
    if params.observed_subject_revision_hash == task.subject_revision_hash {
        return Err("task cannot be invalidated with an unchanged subject revision".to_string());
    }
    let next_revision = next_revision(task.revision)?;
    let updated = ctx.db.workflow_human_task().id().update(WorkflowHumanTask {
        status: WorkflowHumanTaskStatus::Invalidated,
        revision: next_revision,
        invalidated_by: Some(actor),
        invalidated_at: Some(ctx.timestamp),
        invalidation_reason: Some(params.reason.trim().to_string()),
        correlation_id: params.correlation_id.clone(),
        updated_at: ctx.timestamp,
        ..task.clone()
    });
    append_event(
        ctx,
        &updated,
        WorkflowHumanTaskCommandKind::Invalidate,
        Some(task.status),
        WorkflowHumanTaskStatus::Invalidated,
        None,
        actor,
        None,
        None,
        None,
        task.revision,
        next_revision,
        &params.idempotency_key,
        &input_hash,
        Some(params.reason.trim().to_string()),
        None,
        &params.correlation_id,
    );
    insert_receipt(
        ctx,
        &updated,
        WorkflowHumanTaskCommandKind::Invalidate,
        params.idempotency_key,
        input_hash,
        None,
        actor,
    );
    Ok(updated)
}

#[reducer]
pub fn add_workflow_human_task_comment(
    ctx: &ReducerContext,
    organization_id: u64,
    params: AddWorkflowHumanTaskCommentParams,
) -> Result<(), String> {
    add_workflow_human_task_comment_for_actor(ctx, organization_id, ctx.sender(), params)?;
    Ok(())
}

pub(crate) fn add_workflow_human_task_comment_for_actor(
    ctx: &ReducerContext,
    organization_id: u64,
    actor: Identity,
    params: AddWorkflowHumanTaskCommentParams,
) -> Result<WorkflowHumanTask, String> {
    validate_key(&params.idempotency_key, "idempotency key")?;
    validate_key(&params.correlation_id, "correlation id")?;
    let comment = normalize_comment(Some(params.comment))?.ok_or("comment is required")?;
    let input_hash = hash_fields(&[
        organization_id.to_string(),
        params.company_id.to_string(),
        params.task_id.to_string(),
        params.expected_revision.to_string(),
        comment.clone(),
    ]);
    if let Some(receipt) = replay_receipt(
        ctx,
        organization_id,
        params.task_id,
        &WorkflowHumanTaskCommandKind::Comment,
        &params.idempotency_key,
        &input_hash,
    )? {
        return require_task(ctx, organization_id, params.company_id, receipt.task_id);
    }
    let task = require_task(ctx, organization_id, params.company_id, params.task_id)?;
    require_revision(&task, params.expected_revision)?;
    let authorization = authorize_task_actor(ctx, actor, &task, None, "workflow_task:write")?;
    let next_revision = next_revision(task.revision)?;
    let updated = ctx.db.workflow_human_task().id().update(WorkflowHumanTask {
        revision: next_revision,
        correlation_id: params.correlation_id.clone(),
        updated_at: ctx.timestamp,
        ..task.clone()
    });
    append_authorized_event(
        ctx,
        &task,
        &updated,
        WorkflowHumanTaskCommandKind::Comment,
        None,
        &authorization,
        &params.idempotency_key,
        &input_hash,
        Some(comment),
        None,
        &params.correlation_id,
    );
    insert_receipt(
        ctx,
        &updated,
        WorkflowHumanTaskCommandKind::Comment,
        params.idempotency_key,
        input_hash,
        None,
        actor,
    );
    Ok(updated)
}

#[reducer]
pub fn set_workflow_candidate_group_member(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: SetWorkflowCandidateGroupMemberParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow_candidate_group", "write")?;
    let existing = ctx
        .db
        .workflow_candidate_group_member()
        .candidate_group_member_by_identity()
        .filter(&params.member_identity)
        .find(|row| {
            row.organization_id == organization_id
                && row.company_id == company_id
                && row.group_id == params.group_id
        });
    if let Some(row) = existing {
        ctx.db
            .workflow_candidate_group_member()
            .id()
            .update(WorkflowCandidateGroupMember {
                is_active: params.is_active,
                revoked_by: (!params.is_active).then_some(ctx.sender()),
                revoked_at: (!params.is_active).then_some(ctx.timestamp),
                ..row
            });
    } else if params.is_active {
        ctx.db
            .workflow_candidate_group_member()
            .insert(WorkflowCandidateGroupMember {
                id: 0,
                organization_id,
                company_id,
                group_id: params.group_id,
                member_identity: params.member_identity,
                is_active: true,
                created_by: ctx.sender(),
                created_at: ctx.timestamp,
                revoked_by: None,
                revoked_at: None,
            });
    }
    Ok(())
}

fn execute_task_action(
    ctx: &ReducerContext,
    task: &WorkflowHumanTask,
    decision_idempotency_key: &str,
) -> Result<Option<String>, String> {
    let Some(action) = task.guarded_action.clone() else {
        return Ok(None);
    };
    let input = GuardedActionInput::for_subject(&action.key, task.subject_id);
    let snapshot = snapshot_guarded_action(
        ctx,
        task.organization_id,
        task.company_id,
        action.key.clone(),
        action.schema_version,
        input.clone(),
    )?;
    if snapshot.subject_revision_hash != task.subject_revision_hash {
        return Err("workflow task subject changed after the task was created".to_string());
    }
    let result = execute_guarded_action(
        ctx,
        ExecuteGuardedActionParams {
            organization_id: task.organization_id,
            company_id: task.company_id,
            action: action.key,
            action_version: action.schema_version,
            input,
            expected_subject_revision_hash: task.subject_revision_hash.clone(),
            idempotency_key: format!("human-task:{}:{decision_idempotency_key}", task.id),
        },
    )?;
    Ok(Some(result.receipt_id))
}

fn authorize_task_actor(
    ctx: &ReducerContext,
    actor: Identity,
    task: &WorkflowHumanTask,
    acting_for: Option<Identity>,
    permission: &str,
) -> Result<WorkflowAuthorizationDecision, String> {
    let principal = acting_for.unwrap_or(actor);
    let role_match = principal_has_candidate_role(ctx, task, principal);
    let group_match = principal_has_candidate_group(ctx, task, principal);
    let unit_match = principal_has_candidate_unit(ctx, task, principal);
    if !role_match && !group_match && !unit_match {
        return Err("workflow actor is outside the task candidate scopes".to_string());
    }
    let candidate_role_ids = if role_match {
        task.candidate_role_ids.clone()
    } else {
        Vec::new()
    };
    let request = WorkflowAuthorizationRequest {
        organization_id: task.organization_id,
        company_id: task.company_id,
        requester_identity: task.requested_by,
        acting_for_identity: acting_for,
        candidate_role_ids,
        required_permission: permission.to_string(),
    };
    if actor == ctx.sender() {
        authorize_workflow_decision(ctx, &request)
    } else {
        authorize_workflow_decision_for_actor(ctx, actor, &request)
    }
}

fn principal_has_candidate_role(
    ctx: &ReducerContext,
    task: &WorkflowHumanTask,
    principal: Identity,
) -> bool {
    if task.candidate_role_ids.is_empty() {
        return false;
    }
    super::authorization::current_workflow_roles(
        ctx,
        task.organization_id,
        principal,
        ctx.timestamp,
    )
    .is_ok_and(|roles| {
        roles
            .iter()
            .any(|role| task.candidate_role_ids.contains(&role.role_id))
    })
}

fn principal_has_candidate_group(
    ctx: &ReducerContext,
    task: &WorkflowHumanTask,
    principal: Identity,
) -> bool {
    !task.candidate_group_ids.is_empty()
        && ctx
            .db
            .workflow_candidate_group_member()
            .candidate_group_member_by_identity()
            .filter(&principal)
            .any(|row| {
                row.organization_id == task.organization_id
                    && row.company_id == task.company_id
                    && row.is_active
                    && task.candidate_group_ids.contains(&row.group_id)
            })
}

fn principal_has_candidate_unit(
    ctx: &ReducerContext,
    task: &WorkflowHumanTask,
    principal: Identity,
) -> bool {
    !task.candidate_unit_ids.is_empty()
        && ctx
            .db
            .user_organization()
            .user_org_by_user()
            .filter(&principal)
            .any(|row| {
                row.organization_id == task.organization_id
                    && row.is_active
                    && row
                        .company_id
                        .is_none_or(|company_id| company_id == task.company_id)
                    && row
                        .department_id
                        .is_some_and(|unit_id| task.candidate_unit_ids.contains(&unit_id))
            })
}

fn decision_edge(
    ctx: &ReducerContext,
    task: &WorkflowHumanTask,
    decision: &WorkflowHumanTaskDecision,
) -> Result<super::definitions::WorkflowEdge, String> {
    let signal = match decision {
        WorkflowHumanTaskDecision::Approve => "approved",
        WorkflowHumanTaskDecision::Reject => "rejected",
        WorkflowHumanTaskDecision::Complete => "completed",
    };
    let mut edges: Vec<_> = ctx
        .db
        .workflow_edge()
        .workflow_edge_by_from()
        .filter(&task.node_key)
        .filter(|edge| {
            edge.organization_id == task.organization_id
                && edge.workflow_version_id == task.workflow_version_id
                && edge.signal_key.as_deref() == Some(signal)
        })
        .collect();
    edges.sort_by_key(|edge| edge.id);
    if edges.len() != 1 {
        return Err(format!(
            "human task decision requires exactly one '{signal}' edge"
        ));
    }
    Ok(edges.remove(0))
}

fn validate_guarded_action_target(
    ctx: &ReducerContext,
    task: &WorkflowHumanTask,
    edge: &super::definitions::WorkflowEdge,
) -> Result<super::definitions::WorkflowNode, String> {
    let guarded = task
        .guarded_action
        .as_ref()
        .ok_or("guarded action is missing")?;
    let target = ctx
        .db
        .workflow_node()
        .workflow_node_by_version()
        .filter(&task.workflow_version_id)
        .find(|node| node.node_key == edge.to_node_key)
        .ok_or("guarded action node not found")?;
    let definition_action = target
        .action
        .as_ref()
        .filter(|_| target.kind == WorkflowNodeKind::Action)
        .ok_or("approved guarded task must transition to an action node")?;
    if definition_action.action_key != guarded.key.as_str()
        || definition_action.input_schema_version != guarded.schema_version
    {
        return Err(
            "guarded task action does not match its version-pinned action node".to_string(),
        );
    }
    Ok(target)
}

#[allow(clippy::too_many_arguments)]
fn complete_guarded_action_node(
    ctx: &ReducerContext,
    instance: &WorkflowInstance,
    action: &WorkflowTaskGuardedAction,
    authorization: &WorkflowAuthorizationDecision,
    params: &DecideWorkflowHumanTaskParams,
    decision_input_hash: &str,
    domain_receipt: &str,
) -> Result<WorkflowInstance, String> {
    let mut tokens: Vec<_> = ctx
        .db
        .workflow_token()
        .workflow_token_by_instance()
        .filter(&instance.id)
        .filter(|token| token.state == WorkflowTokenState::Active)
        .collect();
    tokens.sort_by_key(|token| token.id);
    if tokens.len() != 1 {
        return Err("guarded action completion requires exactly one active token".to_string());
    }
    let token = tokens.remove(0);
    let node = ctx
        .db
        .workflow_node()
        .id()
        .find(&token.node_id)
        .ok_or("guarded action node not found")?;
    let definition_action = node
        .action
        .as_ref()
        .filter(|_| node.kind == WorkflowNodeKind::Action)
        .ok_or("workflow token did not arrive at a guarded action node")?;
    if definition_action.action_key != action.key.as_str()
        || definition_action.input_schema_version != action.schema_version
    {
        return Err("runtime action node does not match the approved guarded action".to_string());
    }
    let mut edges: Vec<_> = ctx
        .db
        .workflow_edge()
        .workflow_edge_by_from()
        .filter(&node.node_key)
        .filter(|edge| {
            edge.organization_id == instance.organization_id
                && edge.workflow_version_id == instance.workflow_version_id
                && edge.signal_key.is_none()
                && edge.condition.is_none()
        })
        .collect();
    edges.sort_by_key(|edge| edge.id);
    if edges.len() != 1 {
        return Err(
            "guarded action node requires exactly one unconditional result edge".to_string(),
        );
    }
    apply_runtime_event(
        ctx,
        instance,
        RuntimeEventContext {
            command_kind: WorkflowCommandKind::ActionResult,
            expected_instance_revision: instance.revision,
            idempotency_key: format!("{}:action-result", params.idempotency_key),
            input_hash: hash_fields(&[decision_input_hash.to_string(), domain_receipt.to_string()]),
            action_key: Some(action.key.as_str().to_string()),
            condition_result: None,
            authorization_outcome: WorkflowAuthorizationOutcome::Allowed,
            acting_for: authorization.acting_for_identity,
            matched_role_id: authorization.matched_role_id,
            delegation_id: authorization.delegation_id,
            domain_receipt: Some(domain_receipt.to_string()),
            reason: None,
            correlation_id: params.correlation_id.clone(),
            causation_id: params.causation_id.clone(),
        },
        RuntimeMutation::Transitions(vec![RuntimeTransition {
            token_id: token.id,
            expected_token_revision: token.revision,
            edge_id: edges[0].id,
        }]),
    )
}

fn validate_decision(
    task: &WorkflowHumanTask,
    decision: &WorkflowHumanTaskDecision,
    comment: Option<&str>,
) -> Result<(), String> {
    if task.assignment == WorkflowTaskAssignment::SingleCandidate && task.claimed_by.is_none() {
        return Err("single-candidate workflow task must be claimed before decision".to_string());
    }
    match (&task.kind, decision) {
        (WorkflowHumanTaskKind::ApproveReject, WorkflowHumanTaskDecision::Approve)
        | (WorkflowHumanTaskKind::ApproveReject, WorkflowHumanTaskDecision::Reject)
        | (WorkflowHumanTaskKind::Complete, WorkflowHumanTaskDecision::Complete)
        | (WorkflowHumanTaskKind::EvidenceReview, WorkflowHumanTaskDecision::Complete) => {}
        _ => return Err("decision is not valid for this human task kind".to_string()),
    }
    if *decision == WorkflowHumanTaskDecision::Reject
        && task.require_comment_on_reject
        && comment.is_none()
    {
        return Err("a rejection comment is required by task policy".to_string());
    }
    Ok(())
}

fn validate_policy(policy: &WorkflowTaskPolicy) -> Result<(), String> {
    if policy.candidate_role_ids.is_empty()
        && policy.candidate_group_ids.is_empty()
        && policy.candidate_unit_ids.is_empty()
    {
        return Err("human task has no candidate scope".to_string());
    }
    if policy.assignment == WorkflowTaskAssignment::AllCandidates {
        return Err(
            "all-candidates assignment requires the Wave 4 bounded candidate projection"
                .to_string(),
        );
    }
    Ok(())
}

fn require_task(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    task_id: u64,
) -> Result<WorkflowHumanTask, String> {
    let task = ctx
        .db
        .workflow_human_task()
        .id()
        .find(&task_id)
        .ok_or("workflow human task not found")?;
    if task.organization_id != organization_id || task.company_id != company_id {
        return Err("workflow human task is outside the requested scope".to_string());
    }
    Ok(task)
}

fn require_instance(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    instance_id: u64,
) -> Result<WorkflowInstance, String> {
    let instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&instance_id)
        .ok_or("workflow instance not found")?;
    if instance.organization_id != organization_id || instance.company_id != company_id {
        return Err("workflow instance is outside the requested scope".to_string());
    }
    Ok(instance)
}

fn require_revision(task: &WorkflowHumanTask, expected: u64) -> Result<(), String> {
    if task.revision != expected {
        return Err(format!(
            "stale workflow task revision: expected {expected}, current {}",
            task.revision
        ));
    }
    Ok(())
}

fn append_authorized_event(
    ctx: &ReducerContext,
    prior: &WorkflowHumanTask,
    next: &WorkflowHumanTask,
    command_kind: WorkflowHumanTaskCommandKind,
    decision: Option<WorkflowHumanTaskDecision>,
    authorization: &WorkflowAuthorizationDecision,
    idempotency_key: &str,
    input_hash: &str,
    comment: Option<String>,
    domain_receipt: Option<String>,
    correlation_id: &str,
) {
    append_event(
        ctx,
        next,
        command_kind,
        Some(prior.status.clone()),
        next.status.clone(),
        decision,
        authorization.actor_identity,
        authorization.acting_for_identity,
        authorization.matched_role_id,
        authorization.delegation_id,
        prior.revision,
        next.revision,
        idempotency_key,
        input_hash,
        comment,
        domain_receipt,
        correlation_id,
    );
}

#[allow(clippy::too_many_arguments)]
fn append_event(
    ctx: &ReducerContext,
    task: &WorkflowHumanTask,
    command_kind: WorkflowHumanTaskCommandKind,
    prior_status: Option<WorkflowHumanTaskStatus>,
    next_status: WorkflowHumanTaskStatus,
    decision: Option<WorkflowHumanTaskDecision>,
    actor: Identity,
    acting_for: Option<Identity>,
    matched_role_id: Option<u64>,
    delegation_id: Option<u64>,
    prior_revision: u64,
    next_revision: u64,
    idempotency_key: &str,
    input_hash: &str,
    comment: Option<String>,
    domain_receipt: Option<String>,
    correlation_id: &str,
) {
    ctx.db
        .workflow_human_task_event()
        .insert(WorkflowHumanTaskEvent {
            id: 0,
            organization_id: task.organization_id,
            company_id: task.company_id,
            workflow_version_id: task.workflow_version_id,
            workflow_instance_id: task.workflow_instance_id,
            task_id: task.id,
            command_kind,
            prior_status,
            next_status,
            decision,
            actor,
            acting_for,
            matched_role_id,
            delegation_id,
            prior_revision,
            next_revision,
            idempotency_key: idempotency_key.to_string(),
            input_hash: input_hash.to_string(),
            subject_revision_hash: task.subject_revision_hash.clone(),
            comment,
            domain_receipt,
            correlation_id: correlation_id.to_string(),
            recorded_at: ctx.timestamp,
        });
}

fn insert_receipt(
    ctx: &ReducerContext,
    task: &WorkflowHumanTask,
    command_kind: WorkflowHumanTaskCommandKind,
    idempotency_key: String,
    input_hash: String,
    domain_receipt: Option<String>,
    actor: Identity,
) {
    ctx.db
        .workflow_human_task_receipt()
        .insert(WorkflowHumanTaskReceipt {
            scope_key: receipt_scope_key(
                task.organization_id,
                task.id,
                &command_kind,
                &idempotency_key,
            ),
            organization_id: task.organization_id,
            company_id: task.company_id,
            task_id: task.id,
            command_kind,
            idempotency_key,
            input_hash,
            result_status: task.status.clone(),
            result_revision: task.revision,
            domain_receipt,
            created_by: actor,
            created_at: ctx.timestamp,
        });
}

fn replay_receipt(
    ctx: &ReducerContext,
    organization_id: u64,
    task_id: u64,
    kind: &WorkflowHumanTaskCommandKind,
    idempotency_key: &str,
    input_hash: &str,
) -> Result<Option<WorkflowHumanTaskReceipt>, String> {
    let key = receipt_scope_key(organization_id, task_id, kind, idempotency_key);
    let Some(receipt) = ctx.db.workflow_human_task_receipt().scope_key().find(&key) else {
        return Ok(None);
    };
    if receipt.input_hash != input_hash {
        return Err("workflow task idempotency key was reused with different input".to_string());
    }
    Ok(Some(receipt))
}

fn receipt_scope_key(
    organization_id: u64,
    task_id: u64,
    kind: &WorkflowHumanTaskCommandKind,
    key: &str,
) -> String {
    format!("{organization_id}:{task_id}:{}:{key}", command_tag(kind))
}

fn decision_input_hash(
    organization_id: u64,
    params: &DecideWorkflowHumanTaskParams,
    comment: Option<&str>,
) -> String {
    hash_fields(&[
        organization_id.to_string(),
        params.company_id.to_string(),
        params.task_id.to_string(),
        params.expected_task_revision.to_string(),
        params.expected_instance_revision.to_string(),
        decision_tag(&params.decision).to_string(),
        identity_text(params.acting_for),
        comment.unwrap_or_default().to_string(),
    ])
}

fn hash_fields(fields: &[String]) -> String {
    let mut hasher = Sha256::new();
    for field in fields {
        hasher.update((field.len() as u64).to_be_bytes());
        hasher.update(field.as_bytes());
    }
    format!("sha256:{:x}", hasher.finalize())
}

fn command_tag(kind: &WorkflowHumanTaskCommandKind) -> &'static str {
    match kind {
        WorkflowHumanTaskCommandKind::Create => "create",
        WorkflowHumanTaskCommandKind::Claim => "claim",
        WorkflowHumanTaskCommandKind::Decision => "decision",
        WorkflowHumanTaskCommandKind::Invalidate => "invalidate",
        WorkflowHumanTaskCommandKind::Comment => "comment",
    }
}

fn decision_tag(decision: &WorkflowHumanTaskDecision) -> &'static str {
    match decision {
        WorkflowHumanTaskDecision::Approve => "approve",
        WorkflowHumanTaskDecision::Reject => "reject",
        WorkflowHumanTaskDecision::Complete => "complete",
    }
}

fn decision_status(decision: &WorkflowHumanTaskDecision) -> WorkflowHumanTaskStatus {
    match decision {
        WorkflowHumanTaskDecision::Approve => WorkflowHumanTaskStatus::Approved,
        WorkflowHumanTaskDecision::Reject => WorkflowHumanTaskStatus::Rejected,
        WorkflowHumanTaskDecision::Complete => WorkflowHumanTaskStatus::Completed,
    }
}

fn identity_text(identity: Option<Identity>) -> String {
    identity.map_or_else(String::new, |identity| identity.to_hex().to_string())
}

fn normalize_comment(comment: Option<String>) -> Result<Option<String>, String> {
    let Some(comment) = comment else {
        return Ok(None);
    };
    let comment = comment.trim();
    if comment.is_empty() {
        return Ok(None);
    }
    if comment.len() > MAX_COMMENT_LEN {
        return Err(format!("comment exceeds {MAX_COMMENT_LEN} bytes"));
    }
    Ok(Some(comment.to_string()))
}

fn validate_key(value: &str, label: &str) -> Result<(), String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{label} is required"));
    }
    if value.len() > MAX_COMMAND_KEY_LEN {
        return Err(format!("{label} exceeds {MAX_COMMAND_KEY_LEN} bytes"));
    }
    Ok(())
}

fn validate_required(value: &str, label: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{label} is required"))
    } else {
        Ok(())
    }
}

fn next_revision(revision: u64) -> Result<u64, String> {
    revision
        .checked_add(1)
        .ok_or("workflow task revision overflow".to_string())
}

fn sorted_ids(mut ids: Vec<u64>) -> Vec<u64> {
    ids.sort_unstable();
    ids.dedup();
    ids
}
