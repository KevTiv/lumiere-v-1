//! Durable workflow timers and external-effect outbox coordination.
//!
//! These records are projections around the authoritative runtime and queue. A
//! timer or successful external result advances the runtime only through
//! [`apply_runtime_event`], while delivery receipts make retries semantic replays.

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::queue::{
    cancel_queue_job_internal, enqueue_job_internal, queue_attempt, queue_effect_receipt,
    queue_job, queue_payload_hash, CancelQueueJobParams, EnqueueJobParams, QueueJob,
};
use crate::helpers::check_permission;
use crate::types::{QueueAttemptOutcome, QueueJobStatus};
use crate::workflow::definitions::workflow_edge;
use crate::workflow::runtime::{
    apply_runtime_event, workflow_instance, workflow_token, RuntimeEventContext, RuntimeMutation,
    RuntimeTransition, WorkflowAuthorizationOutcome, WorkflowCommandKind, WorkflowInstance,
    WorkflowInstanceState, WorkflowTokenState,
};

const MAX_KEY_LEN: usize = 256;

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowTimerStatus {
    Pending,
    Fired,
    Cancelled,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowDeliveryGuarantee {
    /// The remote endpoint accepts the stable semantic key and safely deduplicates retries.
    ExternallyIdempotent,
    /// The remote endpoint cannot prove deduplication; uncertain outcomes require an operator.
    NonIdempotent,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowOutboxStatus {
    AwaitingDelivery,
    Completed,
    DeadLettered,
    ReconciliationRequired,
    Cancelled,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowOutboxResultKind {
    Succeeded,
    RetryableFailure,
    Ambiguous,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowDeliveryObjectKind {
    Timer,
    Outbox,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowDeliveryAttemptKind {
    TimerFired,
    TimerCancelled,
    OutboxCompleted,
    OutboxRetryScheduled,
    OutboxDeadLettered,
    OutboxReconciliationRequired,
    OutboxCancelled,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowDeliveryReceiptKind {
    TimerCreated,
    TimerFired,
    TimerCancelled,
    OutboxCreated,
    OutboxResult,
    OutboxCancelled,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = workflow_timer,
    index(accessor = workflow_timer_by_org, btree(columns = [organization_id])),
    index(accessor = workflow_timer_by_company, btree(columns = [company_id])),
    index(accessor = workflow_timer_by_instance, btree(columns = [instance_id])),
    index(accessor = workflow_timer_by_status, btree(columns = [status])),
    index(accessor = workflow_timer_by_due_at, btree(columns = [due_at]))
)]
pub struct WorkflowTimer {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub instance_id: u64,
    pub token_id: u64,
    pub expected_token_revision: u64,
    pub edge_id: u64,
    pub due_at: Timestamp,
    pub semantic_key: String,
    pub input_hash: String,
    pub status: WorkflowTimerStatus,
    pub revision: u64,
    pub fired_by: Option<Identity>,
    pub fired_at: Option<Timestamp>,
    pub cancelled_by: Option<Identity>,
    pub cancelled_at: Option<Timestamp>,
    pub cancellation_reason: Option<String>,
    pub correlation_id: String,
    pub causation_id: Option<String>,
    pub created_by: Identity,
    pub created_at: Timestamp,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = workflow_outbox,
    index(accessor = workflow_outbox_by_org, btree(columns = [organization_id])),
    index(accessor = workflow_outbox_by_company, btree(columns = [company_id])),
    index(accessor = workflow_outbox_by_instance, btree(columns = [instance_id])),
    index(accessor = workflow_outbox_by_queue_job, btree(columns = [queue_job_id])),
    index(accessor = workflow_outbox_by_status, btree(columns = [status]))
)]
pub struct WorkflowOutbox {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub instance_id: u64,
    pub token_id: u64,
    pub expected_token_revision: u64,
    pub edge_id: u64,
    pub action_key: String,
    /// Canonical queue envelope, including the registered action and delivery policy.
    pub payload: String,
    pub semantic_key: String,
    pub input_hash: String,
    pub delivery_guarantee: WorkflowDeliveryGuarantee,
    pub queue_job_id: u64,
    pub status: WorkflowOutboxStatus,
    pub revision: u64,
    pub response_fingerprint: Option<String>,
    pub error_summary: Option<String>,
    pub completed_at: Option<Timestamp>,
    pub correlation_id: String,
    pub causation_id: Option<String>,
    pub created_by: Identity,
    pub created_at: Timestamp,
}

/// Append-only evidence for successful delivery state changes.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = workflow_delivery_attempt,
    index(accessor = workflow_delivery_attempt_by_org, btree(columns = [organization_id])),
    index(accessor = workflow_delivery_attempt_by_object, btree(columns = [object_id]))
)]
pub struct WorkflowDeliveryAttempt {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub object_kind: WorkflowDeliveryObjectKind,
    pub object_id: u64,
    pub attempt_kind: WorkflowDeliveryAttemptKind,
    pub object_revision: u64,
    pub queue_job_id: Option<u64>,
    pub worker_id: Option<u64>,
    pub lease_token: Option<String>,
    pub input_hash: String,
    pub response_fingerprint: Option<String>,
    pub error_summary: Option<String>,
    pub runtime_revision: Option<u64>,
    pub recorded_by: Identity,
    pub recorded_at: Timestamp,
}

/// Immutable semantic result returned on command replay.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = workflow_delivery_receipt,
    index(accessor = workflow_delivery_receipt_by_org, btree(columns = [organization_id])),
    index(accessor = workflow_delivery_receipt_by_object, btree(columns = [object_id]))
)]
pub struct WorkflowDeliveryReceipt {
    #[primary_key]
    pub scope_key: String,
    pub organization_id: u64,
    pub company_id: u64,
    pub kind: WorkflowDeliveryReceiptKind,
    pub object_kind: WorkflowDeliveryObjectKind,
    pub object_id: u64,
    pub idempotency_key: String,
    pub input_hash: String,
    pub object_revision: u64,
    pub runtime_revision: Option<u64>,
    pub queue_job_id: Option<u64>,
    pub queue_effect_receipt_key: Option<String>,
    pub created_by: Identity,
    pub created_at: Timestamp,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateWorkflowTimerParams {
    pub company_id: u64,
    pub instance_id: u64,
    pub token_id: u64,
    pub expected_token_revision: u64,
    pub edge_id: u64,
    pub due_at: Timestamp,
    pub semantic_key: String,
    pub correlation_id: String,
    pub causation_id: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct FireWorkflowTimerParams {
    pub company_id: u64,
    pub timer_id: u64,
    pub expected_timer_revision: u64,
    pub expected_instance_revision: u64,
    pub idempotency_key: String,
    pub correlation_id: String,
    pub causation_id: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CancelWorkflowTimerParams {
    pub company_id: u64,
    pub timer_id: u64,
    pub expected_timer_revision: u64,
    pub idempotency_key: String,
    pub reason: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateWorkflowOutboxParams {
    pub company_id: u64,
    pub instance_id: u64,
    pub token_id: u64,
    pub expected_token_revision: u64,
    pub edge_id: u64,
    pub action_key: String,
    /// JSON value consumed by the registered external action adapter.
    pub payload: String,
    pub semantic_key: String,
    pub delivery_guarantee: WorkflowDeliveryGuarantee,
    pub queue_name: String,
    pub job_type: String,
    pub priority: i32,
    pub max_attempts: u32,
    pub available_at_micros: Option<u64>,
    pub correlation_id: String,
    pub causation_id: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordWorkflowOutboxResultParams {
    pub company_id: u64,
    pub outbox_id: u64,
    pub expected_outbox_revision: u64,
    pub expected_instance_revision: u64,
    pub queue_job_id: u64,
    pub worker_id: u64,
    pub lease_token: String,
    pub result: WorkflowOutboxResultKind,
    pub response_fingerprint: Option<String>,
    pub error_summary: Option<String>,
    pub idempotency_key: String,
    pub correlation_id: String,
    pub causation_id: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CancelWorkflowOutboxParams {
    pub company_id: u64,
    pub outbox_id: u64,
    pub expected_outbox_revision: u64,
    pub expected_queue_revision: u64,
    pub idempotency_key: String,
    pub reason: String,
}

/// Insert or replay a timer inside the runtime transaction that created its wait state.
pub(crate) fn create_workflow_timer_internal(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateWorkflowTimerParams,
) -> Result<WorkflowTimer, String> {
    validate_key(&params.semantic_key, "timer semantic key")?;
    validate_key(&params.correlation_id, "timer correlation id")?;
    if params.due_at <= ctx.timestamp {
        return Err("workflow timer due_at must be in the future".to_string());
    }
    let instance = require_instance(ctx, organization_id, params.company_id, params.instance_id)?;
    require_active_token(
        ctx,
        &instance,
        params.token_id,
        params.expected_token_revision,
    )?;
    require_transition_edge(ctx, &instance, params.token_id, params.edge_id)?;
    let input_hash = timer_input_hash(organization_id, &params)?;
    if let Some(existing) = ctx.db.workflow_timer().iter().find(|timer| {
        timer.organization_id == organization_id
            && timer.company_id == params.company_id
            && timer.semantic_key == params.semantic_key
    }) {
        if existing.input_hash == input_hash {
            return Ok(existing);
        }
        return Err("timer semantic key was already used with different input".to_string());
    }

    let timer = ctx.db.workflow_timer().insert(WorkflowTimer {
        id: 0,
        organization_id,
        company_id: params.company_id,
        instance_id: params.instance_id,
        token_id: params.token_id,
        expected_token_revision: params.expected_token_revision,
        edge_id: params.edge_id,
        due_at: params.due_at,
        semantic_key: params.semantic_key.clone(),
        input_hash: input_hash.clone(),
        status: WorkflowTimerStatus::Pending,
        revision: 0,
        fired_by: None,
        fired_at: None,
        cancelled_by: None,
        cancelled_at: None,
        cancellation_reason: None,
        correlation_id: params.correlation_id,
        causation_id: params.causation_id,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
    });
    insert_receipt(
        ctx,
        receipt_scope(organization_id, "timer-create", timer.id),
        WorkflowDeliveryReceiptKind::TimerCreated,
        WorkflowDeliveryObjectKind::Timer,
        timer.id,
        &params.semantic_key,
        input_hash,
        0,
        None,
        None,
        None,
    );
    Ok(timer)
}

#[reducer]
pub fn fire_workflow_timer(
    ctx: &ReducerContext,
    organization_id: u64,
    params: FireWorkflowTimerParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow_timer", "write")?;
    fire_workflow_timer_internal(ctx, organization_id, params)?;
    Ok(())
}

pub(crate) fn fire_workflow_timer_internal(
    ctx: &ReducerContext,
    organization_id: u64,
    params: FireWorkflowTimerParams,
) -> Result<WorkflowDeliveryReceipt, String> {
    validate_key(&params.idempotency_key, "timer fire idempotency key")?;
    validate_key(&params.correlation_id, "timer fire correlation id")?;
    let input_hash = fire_timer_input_hash(organization_id, &params)?;
    let scope_key = receipt_scope(organization_id, "timer-fire", params.timer_id);
    if let Some(receipt) = replay_receipt(ctx, &scope_key, &input_hash)? {
        return Ok(receipt);
    }

    let timer = require_timer(ctx, organization_id, params.company_id, params.timer_id)?;
    if timer.status != WorkflowTimerStatus::Pending {
        return Err("workflow timer is not pending".to_string());
    }
    require_revision(
        timer.revision,
        params.expected_timer_revision,
        "workflow timer",
    )?;
    if timer.due_at > ctx.timestamp {
        return Err("workflow timer is not due".to_string());
    }
    let instance = require_instance(ctx, organization_id, params.company_id, timer.instance_id)?;
    let updated_instance = apply_runtime_event(
        ctx,
        &instance,
        RuntimeEventContext {
            command_kind: WorkflowCommandKind::Timer,
            expected_instance_revision: params.expected_instance_revision,
            idempotency_key: params.idempotency_key.clone(),
            input_hash: input_hash.clone(),
            action_key: None,
            condition_result: None,
            authorization_outcome: WorkflowAuthorizationOutcome::NotApplicable,
            acting_for: None,
            matched_role_id: None,
            delegation_id: None,
            domain_receipt: None,
            reason: Some("workflow timer fired".to_string()),
            correlation_id: params.correlation_id,
            causation_id: params.causation_id,
            condition_snapshot: None,
        },
        RuntimeMutation::Transitions(vec![RuntimeTransition {
            token_id: timer.token_id,
            expected_token_revision: timer.expected_token_revision,
            edge_id: timer.edge_id,
        }]),
    )?;
    let next_revision = timer
        .revision
        .checked_add(1)
        .ok_or("workflow timer revision overflow")?;
    ctx.db.workflow_timer().id().update(WorkflowTimer {
        status: WorkflowTimerStatus::Fired,
        revision: next_revision,
        fired_by: Some(ctx.sender()),
        fired_at: Some(ctx.timestamp),
        ..timer.clone()
    });
    record_attempt(
        ctx,
        WorkflowDeliveryObjectKind::Timer,
        timer.id,
        WorkflowDeliveryAttemptKind::TimerFired,
        next_revision,
        None,
        None,
        None,
        input_hash.clone(),
        None,
        None,
        Some(updated_instance.revision),
        timer.company_id,
        timer.organization_id,
    );
    Ok(insert_receipt(
        ctx,
        scope_key,
        WorkflowDeliveryReceiptKind::TimerFired,
        WorkflowDeliveryObjectKind::Timer,
        timer.id,
        &params.idempotency_key,
        input_hash,
        next_revision,
        Some(updated_instance.revision),
        None,
        None,
    ))
}

#[reducer]
pub fn cancel_workflow_timer(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CancelWorkflowTimerParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow_timer", "write")?;
    cancel_workflow_timer_internal(ctx, organization_id, params)?;
    Ok(())
}

pub(crate) fn cancel_workflow_timer_internal(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CancelWorkflowTimerParams,
) -> Result<WorkflowDeliveryReceipt, String> {
    validate_key(&params.idempotency_key, "timer cancel idempotency key")?;
    if params.reason.trim().is_empty() {
        return Err("timer cancellation reason must not be empty".to_string());
    }
    let input_hash = cancel_timer_input_hash(organization_id, &params)?;
    let scope_key = receipt_scope(organization_id, "timer-cancel", params.timer_id);
    if let Some(receipt) = replay_receipt(ctx, &scope_key, &input_hash)? {
        return Ok(receipt);
    }
    let timer = require_timer(ctx, organization_id, params.company_id, params.timer_id)?;
    if timer.status != WorkflowTimerStatus::Pending {
        return Err("workflow timer is not pending".to_string());
    }
    require_revision(
        timer.revision,
        params.expected_timer_revision,
        "workflow timer",
    )?;
    let next_revision = timer
        .revision
        .checked_add(1)
        .ok_or("workflow timer revision overflow")?;
    ctx.db.workflow_timer().id().update(WorkflowTimer {
        status: WorkflowTimerStatus::Cancelled,
        revision: next_revision,
        cancelled_by: Some(ctx.sender()),
        cancelled_at: Some(ctx.timestamp),
        cancellation_reason: Some(params.reason.clone()),
        ..timer.clone()
    });
    record_attempt(
        ctx,
        WorkflowDeliveryObjectKind::Timer,
        timer.id,
        WorkflowDeliveryAttemptKind::TimerCancelled,
        next_revision,
        None,
        None,
        None,
        input_hash.clone(),
        None,
        Some(params.reason),
        None,
        timer.company_id,
        timer.organization_id,
    );
    Ok(insert_receipt(
        ctx,
        scope_key,
        WorkflowDeliveryReceiptKind::TimerCancelled,
        WorkflowDeliveryObjectKind::Timer,
        timer.id,
        &params.idempotency_key,
        input_hash,
        next_revision,
        None,
        None,
        None,
    ))
}

/// Create the outbox intent and queue job in the caller's runtime transaction.
pub(crate) fn create_workflow_outbox_internal(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateWorkflowOutboxParams,
) -> Result<WorkflowOutbox, String> {
    validate_key(&params.semantic_key, "outbox semantic key")?;
    validate_key(&params.correlation_id, "outbox correlation id")?;
    validate_key(&params.action_key, "registered action key")?;
    if params.max_attempts == 0 {
        return Err("outbox max_attempts must be greater than zero".to_string());
    }
    let instance = require_instance(ctx, organization_id, params.company_id, params.instance_id)?;
    require_active_token(
        ctx,
        &instance,
        params.token_id,
        params.expected_token_revision,
    )?;
    require_transition_edge(ctx, &instance, params.token_id, params.edge_id)?;
    let effective_max_attempts = match &params.delivery_guarantee {
        WorkflowDeliveryGuarantee::ExternallyIdempotent => params.max_attempts,
        WorkflowDeliveryGuarantee::NonIdempotent => 1,
    };
    let envelope = canonical_outbox_envelope(&params, effective_max_attempts)?;
    let input_hash = queue_payload_hash(&envelope)?;
    if let Some(existing) = ctx.db.workflow_outbox().iter().find(|outbox| {
        outbox.organization_id == organization_id
            && outbox.company_id == params.company_id
            && outbox.semantic_key == params.semantic_key
    }) {
        if existing.input_hash != input_hash {
            return Err("outbox semantic key was already used with different input".to_string());
        }
        let job = ctx
            .db
            .queue_job()
            .id()
            .find(&existing.queue_job_id)
            .ok_or("outbox replay is missing its queue job")?;
        verify_queue_link(&existing, &job)?;
        return Ok(existing);
    }

    let job = enqueue_job_internal(
        ctx,
        organization_id,
        EnqueueJobParams {
            company_id: Some(params.company_id),
            queue_name: params.queue_name,
            job_type: params.job_type,
            payload: envelope.clone(),
            semantic_key: params.semantic_key.clone(),
            priority: params.priority,
            max_attempts: effective_max_attempts,
            available_at_micros: params.available_at_micros,
            correlation_id: params.correlation_id.clone(),
            causation_id: params.causation_id.clone(),
            metadata: Some(
                serde_json::json!({
                    "workflow_instance_id": params.instance_id,
                    "workflow_action_key": params.action_key,
                })
                .to_string(),
            ),
        },
    )?;
    if job.input_hash != input_hash || job.semantic_key != params.semantic_key {
        return Err("queue did not preserve the outbox semantic contract".to_string());
    }
    let outbox = ctx.db.workflow_outbox().insert(WorkflowOutbox {
        id: 0,
        organization_id,
        company_id: params.company_id,
        instance_id: params.instance_id,
        token_id: params.token_id,
        expected_token_revision: params.expected_token_revision,
        edge_id: params.edge_id,
        action_key: params.action_key,
        payload: job.payload,
        semantic_key: params.semantic_key.clone(),
        input_hash: job.input_hash,
        delivery_guarantee: params.delivery_guarantee,
        queue_job_id: job.id,
        status: WorkflowOutboxStatus::AwaitingDelivery,
        revision: 0,
        response_fingerprint: None,
        error_summary: None,
        completed_at: None,
        correlation_id: params.correlation_id,
        causation_id: params.causation_id,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
    });
    insert_receipt(
        ctx,
        receipt_scope(organization_id, "outbox-create", outbox.id),
        WorkflowDeliveryReceiptKind::OutboxCreated,
        WorkflowDeliveryObjectKind::Outbox,
        outbox.id,
        &params.semantic_key,
        input_hash,
        0,
        None,
        Some(job.id),
        None,
    );
    Ok(outbox)
}

#[reducer]
pub fn cancel_workflow_outbox(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CancelWorkflowOutboxParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow_outbox", "write")?;
    cancel_workflow_outbox_internal(ctx, organization_id, params)?;
    Ok(())
}

/// Cancel the queue job and outbox projection in the caller's transaction.
pub(crate) fn cancel_workflow_outbox_internal(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CancelWorkflowOutboxParams,
) -> Result<WorkflowDeliveryReceipt, String> {
    validate_key(&params.idempotency_key, "outbox cancel idempotency key")?;
    let reason = required_reason(&params.reason, "outbox cancellation reason")?;
    let input_hash = cancel_outbox_input_hash(organization_id, &params)?;
    let scope_key = receipt_scope(organization_id, "outbox-cancel", params.outbox_id);
    if let Some(receipt) = replay_receipt(ctx, &scope_key, &input_hash)? {
        return Ok(receipt);
    }
    let outbox = require_outbox(ctx, organization_id, params.company_id, params.outbox_id)?;
    require_revision(
        outbox.revision,
        params.expected_outbox_revision,
        "workflow outbox",
    )?;
    if outbox.status != WorkflowOutboxStatus::AwaitingDelivery {
        return Err("workflow outbox is not awaiting delivery".to_string());
    }
    let job = ctx
        .db
        .queue_job()
        .id()
        .find(&outbox.queue_job_id)
        .ok_or("outbox queue job not found")?;
    verify_queue_link(&outbox, &job)?;
    cancel_queue_job_internal(
        ctx,
        organization_id,
        job.id,
        CancelQueueJobParams {
            expected_revision: params.expected_queue_revision,
            reason: reason.clone(),
        },
    )?;
    let next_revision = outbox
        .revision
        .checked_add(1)
        .ok_or("workflow outbox revision overflow")?;
    ctx.db.workflow_outbox().id().update(WorkflowOutbox {
        status: WorkflowOutboxStatus::Cancelled,
        revision: next_revision,
        error_summary: Some(reason.clone()),
        completed_at: Some(ctx.timestamp),
        ..outbox.clone()
    });
    record_attempt(
        ctx,
        WorkflowDeliveryObjectKind::Outbox,
        outbox.id,
        WorkflowDeliveryAttemptKind::OutboxCancelled,
        next_revision,
        Some(job.id),
        None,
        None,
        input_hash.clone(),
        None,
        Some(reason),
        None,
        outbox.company_id,
        outbox.organization_id,
    );
    Ok(insert_receipt(
        ctx,
        scope_key,
        WorkflowDeliveryReceiptKind::OutboxCancelled,
        WorkflowDeliveryObjectKind::Outbox,
        outbox.id,
        &params.idempotency_key,
        input_hash,
        next_revision,
        None,
        Some(job.id),
        None,
    ))
}

#[reducer]
pub fn record_workflow_outbox_result(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RecordWorkflowOutboxResultParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow_outbox", "write")?;
    record_workflow_outbox_result_internal(ctx, organization_id, params)?;
    Ok(())
}

pub(crate) fn record_workflow_outbox_result_internal(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RecordWorkflowOutboxResultParams,
) -> Result<WorkflowDeliveryReceipt, String> {
    validate_key(&params.idempotency_key, "outbox result idempotency key")?;
    validate_key(&params.correlation_id, "outbox result correlation id")?;
    validate_key(&params.lease_token, "outbox result lease token")?;
    let input_hash = outbox_result_input_hash(organization_id, &params)?;
    let scope_key = format!(
        "{}:{}",
        receipt_scope(organization_id, "outbox-result", params.outbox_id),
        params.lease_token
    );
    if let Some(receipt) = replay_receipt(ctx, &scope_key, &input_hash)? {
        return Ok(receipt);
    }
    let outbox = require_outbox(ctx, organization_id, params.company_id, params.outbox_id)?;
    require_revision(
        outbox.revision,
        params.expected_outbox_revision,
        "workflow outbox",
    )?;
    if outbox.status != WorkflowOutboxStatus::AwaitingDelivery {
        return Err("workflow outbox is not awaiting delivery".to_string());
    }
    if outbox.queue_job_id != params.queue_job_id {
        return Err("queue job does not match workflow outbox".to_string());
    }
    let job = ctx
        .db
        .queue_job()
        .id()
        .find(&params.queue_job_id)
        .ok_or("outbox queue job not found")?;
    verify_queue_link(&outbox, &job)?;

    match params.result.clone() {
        WorkflowOutboxResultKind::Succeeded => record_successful_outbox_result(
            ctx,
            organization_id,
            outbox,
            job,
            params,
            scope_key,
            input_hash,
        ),
        WorkflowOutboxResultKind::RetryableFailure => {
            record_retryable_outbox_failure(ctx, outbox, job, params, scope_key, input_hash)
        }
        WorkflowOutboxResultKind::Ambiguous => {
            record_ambiguous_outbox_result(ctx, outbox, job, params, scope_key, input_hash)
        }
    }
}

fn record_successful_outbox_result(
    ctx: &ReducerContext,
    organization_id: u64,
    outbox: WorkflowOutbox,
    job: QueueJob,
    params: RecordWorkflowOutboxResultParams,
    scope_key: String,
    input_hash: String,
) -> Result<WorkflowDeliveryReceipt, String> {
    let response_fingerprint = params
        .response_fingerprint
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or("successful outbox result requires a response fingerprint")?;
    if params.error_summary.is_some() {
        return Err("successful outbox result cannot include an error summary".to_string());
    }
    if job.status != QueueJobStatus::Completed {
        return Err("successful outbox result requires a completed queue job".to_string());
    }
    let queue_receipt = ctx
        .db
        .queue_effect_receipt()
        .queue_effect_receipt_by_job()
        .filter(&job.id)
        .find(|receipt| {
            receipt.semantic_key == outbox.semantic_key
                && receipt.input_hash == outbox.input_hash
                && receipt.worker_id == params.worker_id
                && receipt.lease_token == params.lease_token
                && receipt.response_fingerprint == response_fingerprint
        })
        .ok_or("queue effect receipt does not prove this outbox result")?;
    let instance = require_instance(ctx, organization_id, outbox.company_id, outbox.instance_id)?;
    let updated_instance = apply_runtime_event(
        ctx,
        &instance,
        RuntimeEventContext {
            command_kind: WorkflowCommandKind::ActionResult,
            expected_instance_revision: params.expected_instance_revision,
            idempotency_key: params.idempotency_key.clone(),
            input_hash: input_hash.clone(),
            action_key: Some(outbox.action_key.clone()),
            condition_result: None,
            authorization_outcome: WorkflowAuthorizationOutcome::NotApplicable,
            acting_for: None,
            matched_role_id: None,
            delegation_id: None,
            domain_receipt: Some(queue_receipt.scope_key.clone()),
            reason: None,
            correlation_id: params.correlation_id,
            causation_id: params.causation_id,
            condition_snapshot: None,
        },
        RuntimeMutation::Transitions(vec![RuntimeTransition {
            token_id: outbox.token_id,
            expected_token_revision: outbox.expected_token_revision,
            edge_id: outbox.edge_id,
        }]),
    )?;
    let next_revision = outbox
        .revision
        .checked_add(1)
        .ok_or("workflow outbox revision overflow")?;
    ctx.db.workflow_outbox().id().update(WorkflowOutbox {
        status: WorkflowOutboxStatus::Completed,
        revision: next_revision,
        response_fingerprint: Some(response_fingerprint.to_string()),
        completed_at: Some(ctx.timestamp),
        ..outbox.clone()
    });
    record_attempt(
        ctx,
        WorkflowDeliveryObjectKind::Outbox,
        outbox.id,
        WorkflowDeliveryAttemptKind::OutboxCompleted,
        next_revision,
        Some(job.id),
        Some(params.worker_id),
        Some(params.lease_token),
        input_hash.clone(),
        Some(response_fingerprint.to_string()),
        None,
        Some(updated_instance.revision),
        outbox.company_id,
        outbox.organization_id,
    );
    Ok(insert_receipt(
        ctx,
        scope_key,
        WorkflowDeliveryReceiptKind::OutboxResult,
        WorkflowDeliveryObjectKind::Outbox,
        outbox.id,
        &params.idempotency_key,
        input_hash,
        next_revision,
        Some(updated_instance.revision),
        Some(job.id),
        Some(queue_receipt.scope_key),
    ))
}

fn record_retryable_outbox_failure(
    ctx: &ReducerContext,
    outbox: WorkflowOutbox,
    job: QueueJob,
    params: RecordWorkflowOutboxResultParams,
    scope_key: String,
    input_hash: String,
) -> Result<WorkflowDeliveryReceipt, String> {
    if outbox.delivery_guarantee != WorkflowDeliveryGuarantee::ExternallyIdempotent {
        return Err("non-idempotent outbox failures cannot be scheduled for retry".to_string());
    }
    if params.response_fingerprint.is_some() {
        return Err("failed outbox result cannot include a response fingerprint".to_string());
    }
    let error_summary = required_error(&params.error_summary)?;
    let is_dead_lettered = job.status == QueueJobStatus::DeadLettered;
    let (status, attempt_kind) = match &job.status {
        QueueJobStatus::Pending => (
            WorkflowOutboxStatus::AwaitingDelivery,
            WorkflowDeliveryAttemptKind::OutboxRetryScheduled,
        ),
        QueueJobStatus::DeadLettered => (
            WorkflowOutboxStatus::DeadLettered,
            WorkflowDeliveryAttemptKind::OutboxDeadLettered,
        ),
        _ => {
            return Err(
                "retryable outbox result requires a pending or dead-lettered queue job".to_string(),
            )
        }
    };
    require_queue_attempt(
        ctx,
        &job,
        params.worker_id,
        &params.lease_token,
        &[
            QueueAttemptOutcome::RetryScheduled,
            QueueAttemptOutcome::DeadLettered,
        ],
    )?;
    let next_revision = outbox
        .revision
        .checked_add(1)
        .ok_or("workflow outbox revision overflow")?;
    ctx.db.workflow_outbox().id().update(WorkflowOutbox {
        status,
        revision: next_revision,
        error_summary: Some(error_summary.clone()),
        completed_at: is_dead_lettered.then_some(ctx.timestamp),
        ..outbox.clone()
    });
    record_attempt(
        ctx,
        WorkflowDeliveryObjectKind::Outbox,
        outbox.id,
        attempt_kind,
        next_revision,
        Some(job.id),
        Some(params.worker_id),
        Some(params.lease_token),
        input_hash.clone(),
        None,
        Some(error_summary),
        None,
        outbox.company_id,
        outbox.organization_id,
    );
    Ok(insert_receipt(
        ctx,
        scope_key,
        WorkflowDeliveryReceiptKind::OutboxResult,
        WorkflowDeliveryObjectKind::Outbox,
        outbox.id,
        &params.idempotency_key,
        input_hash,
        next_revision,
        None,
        Some(job.id),
        None,
    ))
}

fn record_ambiguous_outbox_result(
    ctx: &ReducerContext,
    outbox: WorkflowOutbox,
    job: QueueJob,
    params: RecordWorkflowOutboxResultParams,
    scope_key: String,
    input_hash: String,
) -> Result<WorkflowDeliveryReceipt, String> {
    if outbox.delivery_guarantee != WorkflowDeliveryGuarantee::NonIdempotent {
        return Err("idempotent outbox ambiguity must use the retry path".to_string());
    }
    if params.response_fingerprint.is_some() {
        return Err("ambiguous outbox result cannot include a response fingerprint".to_string());
    }
    let error_summary = required_error(&params.error_summary)?;
    if job.status != QueueJobStatus::DeadLettered || job.max_attempts != 1 {
        return Err(
            "ambiguous non-idempotent result requires a one-attempt dead-lettered queue job"
                .to_string(),
        );
    }
    require_queue_attempt(
        ctx,
        &job,
        params.worker_id,
        &params.lease_token,
        &[QueueAttemptOutcome::DeadLettered],
    )?;
    let next_revision = outbox
        .revision
        .checked_add(1)
        .ok_or("workflow outbox revision overflow")?;
    ctx.db.workflow_outbox().id().update(WorkflowOutbox {
        status: WorkflowOutboxStatus::ReconciliationRequired,
        revision: next_revision,
        error_summary: Some(error_summary.clone()),
        completed_at: Some(ctx.timestamp),
        ..outbox.clone()
    });
    record_attempt(
        ctx,
        WorkflowDeliveryObjectKind::Outbox,
        outbox.id,
        WorkflowDeliveryAttemptKind::OutboxReconciliationRequired,
        next_revision,
        Some(job.id),
        Some(params.worker_id),
        Some(params.lease_token),
        input_hash.clone(),
        None,
        Some(error_summary),
        None,
        outbox.company_id,
        outbox.organization_id,
    );
    Ok(insert_receipt(
        ctx,
        scope_key,
        WorkflowDeliveryReceiptKind::OutboxResult,
        WorkflowDeliveryObjectKind::Outbox,
        outbox.id,
        &params.idempotency_key,
        input_hash,
        next_revision,
        None,
        Some(job.id),
        None,
    ))
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
        return Err("workflow instance is outside the delivery scope".to_string());
    }
    if instance.state != WorkflowInstanceState::Active {
        return Err("workflow instance is terminal".to_string());
    }
    Ok(instance)
}

fn require_active_token(
    ctx: &ReducerContext,
    instance: &WorkflowInstance,
    token_id: u64,
    expected_revision: u64,
) -> Result<(), String> {
    let token = ctx
        .db
        .workflow_token()
        .id()
        .find(&token_id)
        .ok_or("workflow token not found")?;
    if token.organization_id != instance.organization_id
        || token.company_id != instance.company_id
        || token.instance_id != instance.id
        || token.workflow_version_id != instance.workflow_version_id
    {
        return Err("workflow token is outside the delivery scope".to_string());
    }
    if token.state != WorkflowTokenState::Active {
        return Err("workflow token is not active".to_string());
    }
    require_revision(token.revision, expected_revision, "workflow token")
}

fn require_transition_edge(
    ctx: &ReducerContext,
    instance: &WorkflowInstance,
    token_id: u64,
    edge_id: u64,
) -> Result<(), String> {
    let token = ctx
        .db
        .workflow_token()
        .id()
        .find(&token_id)
        .ok_or("workflow token not found")?;
    let edge = ctx
        .db
        .workflow_edge()
        .id()
        .find(&edge_id)
        .ok_or("workflow delivery edge not found")?;
    if edge.organization_id != instance.organization_id
        || edge.workflow_version_id != instance.workflow_version_id
        || edge.from_node_key != token.node_key
    {
        return Err("workflow delivery edge is outside the token scope".to_string());
    }
    Ok(())
}

fn require_timer(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    timer_id: u64,
) -> Result<WorkflowTimer, String> {
    let timer = ctx
        .db
        .workflow_timer()
        .id()
        .find(&timer_id)
        .ok_or("workflow timer not found")?;
    if timer.organization_id != organization_id || timer.company_id != company_id {
        return Err("workflow timer is outside the requested scope".to_string());
    }
    Ok(timer)
}

fn require_outbox(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    outbox_id: u64,
) -> Result<WorkflowOutbox, String> {
    let outbox = ctx
        .db
        .workflow_outbox()
        .id()
        .find(&outbox_id)
        .ok_or("workflow outbox not found")?;
    if outbox.organization_id != organization_id || outbox.company_id != company_id {
        return Err("workflow outbox is outside the requested scope".to_string());
    }
    Ok(outbox)
}

fn verify_queue_link(outbox: &WorkflowOutbox, job: &QueueJob) -> Result<(), String> {
    if job.organization_id != outbox.organization_id
        || job.company_id != Some(outbox.company_id)
        || job.semantic_key != outbox.semantic_key
        || job.input_hash != outbox.input_hash
    {
        return Err("queue job semantic contract does not match workflow outbox".to_string());
    }
    Ok(())
}

fn require_queue_attempt(
    ctx: &ReducerContext,
    job: &QueueJob,
    worker_id: u64,
    lease_token: &str,
    allowed: &[QueueAttemptOutcome],
) -> Result<(), String> {
    if ctx
        .db
        .queue_attempt()
        .queue_attempt_by_job()
        .filter(&job.id)
        .any(|attempt| {
            attempt.worker_id == worker_id
                && attempt.lease_token == lease_token
                && allowed.contains(&attempt.outcome)
        })
    {
        Ok(())
    } else {
        Err("queue attempt does not prove this outbox result".to_string())
    }
}

fn replay_receipt(
    ctx: &ReducerContext,
    scope_key: &str,
    input_hash: &str,
) -> Result<Option<WorkflowDeliveryReceipt>, String> {
    let Some(receipt) = ctx
        .db
        .workflow_delivery_receipt()
        .scope_key()
        .find(scope_key.to_string())
    else {
        return Ok(None);
    };
    if receipt.input_hash != input_hash {
        return Err("delivery semantic key was already used with different input".to_string());
    }
    Ok(Some(receipt))
}

#[allow(clippy::too_many_arguments)]
fn insert_receipt(
    ctx: &ReducerContext,
    scope_key: String,
    kind: WorkflowDeliveryReceiptKind,
    object_kind: WorkflowDeliveryObjectKind,
    object_id: u64,
    idempotency_key: &str,
    input_hash: String,
    object_revision: u64,
    runtime_revision: Option<u64>,
    queue_job_id: Option<u64>,
    queue_effect_receipt_key: Option<String>,
) -> WorkflowDeliveryReceipt {
    ctx.db
        .workflow_delivery_receipt()
        .insert(WorkflowDeliveryReceipt {
            scope_key,
            organization_id: match &object_kind {
                WorkflowDeliveryObjectKind::Timer => ctx
                    .db
                    .workflow_timer()
                    .id()
                    .find(&object_id)
                    .map(|row| row.organization_id)
                    .unwrap_or(0),
                WorkflowDeliveryObjectKind::Outbox => ctx
                    .db
                    .workflow_outbox()
                    .id()
                    .find(&object_id)
                    .map(|row| row.organization_id)
                    .unwrap_or(0),
            },
            company_id: match &object_kind {
                WorkflowDeliveryObjectKind::Timer => ctx
                    .db
                    .workflow_timer()
                    .id()
                    .find(&object_id)
                    .map(|row| row.company_id)
                    .unwrap_or(0),
                WorkflowDeliveryObjectKind::Outbox => ctx
                    .db
                    .workflow_outbox()
                    .id()
                    .find(&object_id)
                    .map(|row| row.company_id)
                    .unwrap_or(0),
            },
            kind,
            object_kind,
            object_id,
            idempotency_key: idempotency_key.to_string(),
            input_hash,
            object_revision,
            runtime_revision,
            queue_job_id,
            queue_effect_receipt_key,
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
        })
}

#[allow(clippy::too_many_arguments)]
fn record_attempt(
    ctx: &ReducerContext,
    object_kind: WorkflowDeliveryObjectKind,
    object_id: u64,
    attempt_kind: WorkflowDeliveryAttemptKind,
    object_revision: u64,
    queue_job_id: Option<u64>,
    worker_id: Option<u64>,
    lease_token: Option<String>,
    input_hash: String,
    response_fingerprint: Option<String>,
    error_summary: Option<String>,
    runtime_revision: Option<u64>,
    company_id: u64,
    organization_id: u64,
) {
    ctx.db
        .workflow_delivery_attempt()
        .insert(WorkflowDeliveryAttempt {
            id: 0,
            organization_id,
            company_id,
            object_kind,
            object_id,
            attempt_kind,
            object_revision,
            queue_job_id,
            worker_id,
            lease_token,
            input_hash,
            response_fingerprint,
            error_summary,
            runtime_revision,
            recorded_by: ctx.sender(),
            recorded_at: ctx.timestamp,
        });
}

fn canonical_outbox_envelope(
    params: &CreateWorkflowOutboxParams,
    effective_max_attempts: u32,
) -> Result<String, String> {
    let payload: serde_json::Value = serde_json::from_str(&params.payload)
        .map_err(|error| format!("outbox payload must be valid JSON: {error}"))?;
    serde_json::to_string(&serde_json::json!({
        "action_key": params.action_key,
        "company_id": params.company_id,
        "delivery_guarantee": delivery_guarantee_label(&params.delivery_guarantee),
        "edge_id": params.edge_id,
        "effective_max_attempts": effective_max_attempts,
        "expected_token_revision": params.expected_token_revision,
        "instance_id": params.instance_id,
        "job_type": params.job_type,
        "payload": payload,
        "queue_name": params.queue_name,
        "token_id": params.token_id,
    }))
    .map_err(|error| format!("failed to canonicalize outbox envelope: {error}"))
}

fn timer_input_hash(
    organization_id: u64,
    params: &CreateWorkflowTimerParams,
) -> Result<String, String> {
    queue_payload_hash(
        &serde_json::json!({
            "organization_id": organization_id,
            "company_id": params.company_id,
            "instance_id": params.instance_id,
            "token_id": params.token_id,
            "expected_token_revision": params.expected_token_revision,
            "edge_id": params.edge_id,
            "due_at_micros": params.due_at.to_micros_since_unix_epoch(),
        })
        .to_string(),
    )
}

fn fire_timer_input_hash(
    organization_id: u64,
    params: &FireWorkflowTimerParams,
) -> Result<String, String> {
    queue_payload_hash(
        &serde_json::json!({
            "organization_id": organization_id,
            "company_id": params.company_id,
            "timer_id": params.timer_id,
            "expected_timer_revision": params.expected_timer_revision,
            "expected_instance_revision": params.expected_instance_revision,
        })
        .to_string(),
    )
}

fn cancel_timer_input_hash(
    organization_id: u64,
    params: &CancelWorkflowTimerParams,
) -> Result<String, String> {
    queue_payload_hash(
        &serde_json::json!({
            "organization_id": organization_id,
            "company_id": params.company_id,
            "timer_id": params.timer_id,
            "expected_timer_revision": params.expected_timer_revision,
            "reason": params.reason,
        })
        .to_string(),
    )
}

fn outbox_result_input_hash(
    organization_id: u64,
    params: &RecordWorkflowOutboxResultParams,
) -> Result<String, String> {
    queue_payload_hash(
        &serde_json::json!({
            "organization_id": organization_id,
            "company_id": params.company_id,
            "outbox_id": params.outbox_id,
            "expected_outbox_revision": params.expected_outbox_revision,
            "expected_instance_revision": params.expected_instance_revision,
            "queue_job_id": params.queue_job_id,
            "worker_id": params.worker_id,
            "lease_token": params.lease_token,
            "result": outbox_result_label(&params.result),
            "response_fingerprint": params.response_fingerprint,
            "error_summary": params.error_summary,
        })
        .to_string(),
    )
}

fn cancel_outbox_input_hash(
    organization_id: u64,
    params: &CancelWorkflowOutboxParams,
) -> Result<String, String> {
    queue_payload_hash(
        &serde_json::json!({
            "organization_id": organization_id,
            "company_id": params.company_id,
            "outbox_id": params.outbox_id,
            "expected_outbox_revision": params.expected_outbox_revision,
            "expected_queue_revision": params.expected_queue_revision,
            "reason": params.reason,
        })
        .to_string(),
    )
}

fn delivery_guarantee_label(guarantee: &WorkflowDeliveryGuarantee) -> &'static str {
    match guarantee {
        WorkflowDeliveryGuarantee::ExternallyIdempotent => "externally_idempotent",
        WorkflowDeliveryGuarantee::NonIdempotent => "non_idempotent",
    }
}

fn outbox_result_label(result: &WorkflowOutboxResultKind) -> &'static str {
    match result {
        WorkflowOutboxResultKind::Succeeded => "succeeded",
        WorkflowOutboxResultKind::RetryableFailure => "retryable_failure",
        WorkflowOutboxResultKind::Ambiguous => "ambiguous",
    }
}

fn receipt_scope(organization_id: u64, operation: &str, object_id: u64) -> String {
    format!("{organization_id}:{operation}:{object_id}")
}

fn require_revision(current: u64, expected: u64, object: &str) -> Result<(), String> {
    if current == expected {
        Ok(())
    } else {
        Err(format!(
            "stale {object} revision: expected {expected}, current {current}"
        ))
    }
}

fn validate_key(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{field} must not be empty"));
    }
    if value.len() > MAX_KEY_LEN {
        return Err(format!("{field} exceeds {MAX_KEY_LEN} bytes"));
    }
    Ok(())
}

fn required_error(error_summary: &Option<String>) -> Result<String, String> {
    error_summary
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or("failed or ambiguous outbox result requires an error summary".to_string())
}

fn required_reason(value: &str, field: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(format!("{field} must not be empty"))
    } else {
        Ok(trimmed.to_string())
    }
}
