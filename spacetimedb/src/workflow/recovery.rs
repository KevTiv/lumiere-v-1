//! Explicit, audited resubmission of cancelled Finance approvals.
//!
//! Recovery creates a new task through the ordinary guarded-action gate. The
//! predecessor stays cancelled, with its original votes and claimant intact.
//! One immutable link per predecessor serializes competing recovery commands.

use std::collections::{BTreeMap, BTreeSet};

use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::persistence::{record_organization_commit, OrganizationCommitInput, RowChange};

use crate::accounting::bank_reconciliation::require_payment_not_bank_linked;
use crate::accounting::payments::account_payment;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::purchasing::purchase_orders::purchase_order;
use crate::types::{PaymentState, PoState};

use super::action_registry::{
    snapshot_guarded_action, GuardedActionInput, GuardedActionKey, GuardedActionSnapshot,
};
use super::approval_gate::{
    resubmit_guarded_action, GuardedActionGateOutcome, RequestGuardedActionParams,
};
use super::approvals::{
    append_event, hash_fields, insert_receipt, workflow_human_task, WorkflowHumanTask,
    WorkflowHumanTaskCommandKind, WorkflowHumanTaskStatus,
};
use super::authorization::{require_workflow_company_access, require_workflow_subject_read};
use super::runtime::{workflow_instance, WorkflowInstanceState};

const MAX_RECOVERY_CHAIN: usize = 64;
const MAX_REASON_BYTES: usize = 8_192;

/// The reviewed predecessor and source revision are immutable command input.
#[derive(SpacetimeType, Clone, Debug)]
pub struct ResubmitWorkflowHumanTaskParams {
    pub company_id: u64,
    pub task_id: u64,
    pub expected_task_revision: u64,
    pub expected_instance_revision: u64,
    pub expected_subject_revision_hash: String,
    pub reason: String,
    pub idempotency_key: String,
    pub correlation_id: String,
}

/// Private immutable link and result of a successful recovery command.
/// The ordinary task event/receipt remains the exact command proof; this link
/// supplies the successor and prevents a second recovery with a different key.
#[derive(Clone, Debug)]
#[spacetimedb::table(
    accessor = workflow_human_task_resubmission,
    index(accessor = task_resubmission_by_org, btree(columns = [organization_id])),
    index(accessor = task_resubmission_by_company, btree(columns = [company_id])),
    index(accessor = task_resubmission_by_subject, btree(columns = [subject_scope_key]))
)]
pub struct WorkflowHumanTaskResubmission {
    #[primary_key]
    pub previous_task_id: u64,
    #[unique]
    pub scope_key: String,
    pub organization_id: u64,
    pub company_id: u64,
    pub subject_scope_key: String,
    pub expected_task_revision: u64,
    pub expected_instance_revision: u64,
    pub expected_subject_revision_hash: String,
    pub result_task_revision: u64,
    pub event_id: u64,
    pub successor_task_id: u64,
    pub successor_instance_id: u64,
    pub successor_task_revision: u64,
    pub successor_instance_revision: u64,
    pub idempotency_key: String,
    pub input_hash: String,
    pub reason: String,
    pub correlation_id: String,
    pub created_by: Identity,
    pub created_at: Timestamp,
}

/// Resubmit a cancelled PO send/confirmation or ordinary payment approval.
///
/// The operator needs current management and domain authority. This command
/// grants no approval authority, transfers no claim and executes no business
/// effect. Active claims must first be cancelled through `cancel_workflow`.
#[spacetimedb::reducer]
pub fn resubmit_workflow_human_task(
    ctx: &ReducerContext,
    organization_id: u64,
    params: ResubmitWorkflowHumanTaskParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow_instance", "create")?;
    check_permission(ctx, organization_id, "workflow_task", "write")?;
    let company_membership_bypass =
        require_workflow_company_access(ctx, organization_id, params.company_id, ctx.sender())?;
    validate_key(&params.idempotency_key, "idempotency key")?;
    validate_key(&params.correlation_id, "correlation id")?;
    let reason = params.reason.trim();
    if reason.is_empty() || reason.len() > MAX_REASON_BYTES {
        return Err("resubmission reason must contain 1 to 8192 bytes".to_string());
    }
    let task = ctx
        .db
        .workflow_human_task()
        .id()
        .find(&params.task_id)
        .ok_or("workflow task not found")?;
    if task.organization_id != organization_id || task.company_id != params.company_id {
        return Err("workflow task is outside the requested recovery scope".to_string());
    }
    require_workflow_subject_read(ctx, organization_id, ctx.sender(), &task.subject_model)?;
    let action = task
        .guarded_action
        .as_ref()
        .ok_or("only guarded Finance approval tasks support resubmission")?;
    require_recovery_permission(ctx, organization_id, &action.key)?;

    let input_hash = hash_fields(&[
        organization_id.to_string(),
        params.company_id.to_string(),
        params.task_id.to_string(),
        params.expected_task_revision.to_string(),
        params.expected_instance_revision.to_string(),
        params.expected_subject_revision_hash.clone(),
        reason.to_string(),
    ]);
    let scope_key = format!(
        "{organization_id}:{}:{}:{}",
        params.company_id,
        params.idempotency_key.len(),
        params.idempotency_key
    );
    // A replay is authorized now, but does not require the source to remain in
    // draft after a later reviewer has legitimately completed the new task.
    if let Some(receipt) = ctx
        .db
        .workflow_human_task_resubmission()
        .scope_key()
        .find(&scope_key)
    {
        if receipt.created_by != ctx.sender() {
            return Err(
                "Permission denied: resubmission receipt belongs to another actor".to_string(),
            );
        }
        if receipt.organization_id != organization_id
            || receipt.company_id != params.company_id
            || receipt.previous_task_id != params.task_id
            || receipt.input_hash != input_hash
        {
            return Err("resubmission key was already used with different input".to_string());
        }
        return Ok(());
    }
    if ctx
        .db
        .workflow_human_task_resubmission()
        .previous_task_id()
        .find(&task.id)
        .is_some()
    {
        return Err("workflow task already has a resubmitted successor".to_string());
    }
    if task.status != WorkflowHumanTaskStatus::Cancelled {
        return Err("only a cancelled workflow task can be resubmitted".to_string());
    }
    if task.revision != params.expected_task_revision {
        return Err("stale workflow task revision for resubmission".to_string());
    }
    let instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&task.workflow_instance_id)
        .ok_or("workflow instance not found")?;
    if instance.organization_id != organization_id
        || instance.company_id != params.company_id
        || instance.workflow_version_id != task.workflow_version_id
        || instance.subject_model != task.subject_model
        || instance.subject_id != task.subject_id
        || instance.state != WorkflowInstanceState::Cancelled
    {
        return Err("resubmission requires the task's cancelled workflow instance".to_string());
    }
    if instance.revision != params.expected_instance_revision {
        return Err("stale workflow instance revision for resubmission".to_string());
    }
    require_recoverable_source(ctx, &task, &action.key)?;
    let snapshot = snapshot_guarded_action(
        ctx,
        organization_id,
        params.company_id,
        action.key.clone(),
        action.schema_version,
        GuardedActionInput::for_subject(&action.key, task.subject_id),
    )?;
    if snapshot.subject_revision_hash != task.subject_revision_hash
        || snapshot.subject_revision_hash != params.expected_subject_revision_hash
    {
        return Err("workflow resubmission source revision changed".to_string());
    }
    // A cancelled predecessor cannot be used to fork a different active chain.
    if let Some(latest) = resubmitted_guarded_task(ctx, &snapshot)? {
        if latest.id != task.id {
            return Err("another approval recovery already owns this source revision".to_string());
        }
        if ctx
            .db
            .workflow_human_task_resubmission()
            .task_resubmission_by_subject()
            .filter(&subject_scope_key(&snapshot))
            .take(MAX_RECOVERY_CHAIN)
            .count()
            == MAX_RECOVERY_CHAIN
        {
            return Err("approval recovery chain reached its safety bound".to_string());
        }
    }
    if ctx
        .db
        .workflow_human_task()
        .human_task_by_company()
        .filter(&params.company_id)
        .any(|other| {
            other.organization_id == organization_id
                && other.subject_model == task.subject_model
                && other.subject_id == task.subject_id
                && other.subject_revision_hash == task.subject_revision_hash
                && other.guarded_action == task.guarded_action
                && matches!(
                    other.status,
                    WorkflowHumanTaskStatus::Open | WorkflowHumanTaskStatus::Claimed
                )
        })
    {
        return Err("an active approval already owns this source revision".to_string());
    }
    let result_task_revision = task
        .revision
        .checked_add(1)
        .ok_or("workflow task revision overflow")?;
    let outcome = resubmit_guarded_action(
        ctx,
        organization_id,
        RequestGuardedActionParams {
            company_id: params.company_id,
            action: action.key.clone(),
            action_version: action.schema_version,
            input: GuardedActionInput::for_subject(&action.key, task.subject_id),
            idempotency_key: format!("resubmit-task:{}:{}", task.id, params.idempotency_key),
            correlation_id: params.correlation_id.clone(),
            causation_id: Some(format!("workflow-human-task:{}:resubmit", task.id)),
        },
        &task,
    )?;
    let GuardedActionGateOutcome::HumanTaskCreated {
        workflow_instance_id: successor_instance_id,
        task_id: successor_task_id,
        ..
    } = outcome
    else {
        return Err("resubmission did not create a human approval task".to_string());
    };
    let successor = ctx
        .db
        .workflow_human_task()
        .id()
        .find(&successor_task_id)
        .ok_or("resubmitted task not found")?;
    let successor_instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&successor_instance_id)
        .ok_or("resubmitted workflow instance not found")?;
    let updated = ctx.db.workflow_human_task().id().update(WorkflowHumanTask {
        revision: result_task_revision,
        updated_at: ctx.timestamp,
        ..task.clone()
    });
    let link_reference = format!("workflow_human_task_resubmission:{}", task.id);
    let event_id = append_event(
        ctx,
        &updated,
        WorkflowHumanTaskCommandKind::Resubmit,
        Some(WorkflowHumanTaskStatus::Cancelled),
        WorkflowHumanTaskStatus::Cancelled,
        None,
        ctx.sender(),
        None,
        None,
        None,
        task.revision,
        result_task_revision,
        &params.idempotency_key,
        &input_hash,
        Some(reason.to_string()),
        Some(link_reference.clone()),
        &params.correlation_id,
    );
    insert_receipt(
        ctx,
        &updated,
        WorkflowHumanTaskCommandKind::Resubmit,
        params.idempotency_key.clone(),
        input_hash.clone(),
        Some(link_reference),
        ctx.sender(),
    )?;
    let resubmission =
        ctx.db
            .workflow_human_task_resubmission()
            .insert(WorkflowHumanTaskResubmission {
                previous_task_id: task.id,
                scope_key,
                organization_id,
                company_id: params.company_id,
                subject_scope_key: subject_scope_key(&snapshot),
                expected_task_revision: params.expected_task_revision,
                expected_instance_revision: params.expected_instance_revision,
                expected_subject_revision_hash: params.expected_subject_revision_hash,
                result_task_revision,
                event_id,
                successor_task_id,
                successor_instance_id,
                successor_task_revision: successor.revision,
                successor_instance_revision: successor_instance.revision,
                idempotency_key: params.idempotency_key,
                input_hash,
                reason: reason.to_string(),
                correlation_id: params.correlation_id.clone(),
                created_by: ctx.sender(),
                created_at: ctx.timestamp,
            });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(params.company_id),
            table_name: "workflow_human_task",
            record_id: task.id,
            action: "RESUBMIT",
            old_values: Some(serde_json::json!({"revision": task.revision}).to_string()),
            new_values: Some(
                serde_json::json!({
                    "revision": result_task_revision,
                    "successor_task_id": successor_task_id,
                    "successor_instance_id": successor_instance_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["revision".to_string()],
            metadata: Some(
                serde_json::json!({
                    "reason": reason,
                    "event_id": event_id,
                    "correlation_id": params.correlation_id,
                    "company_membership_bypass": company_membership_bypass,
                })
                .to_string(),
            ),
        },
    );
    let mut changes = super::recovery_persistence::snapshot_instances(
        ctx,
        organization_id,
        params.company_id,
        &[instance.id, successor_instance_id],
    )?;
    changes.push(RowChange::upsert_stdb_row(
        "workflow_human_task_resubmission",
        serde_json::json!({"previous_task_id": task.id}),
        &resubmission,
    )?);
    // The start/gate writes and this complete final snapshot share the reducer
    // transaction. A failure here rolls back every business and commit row.
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.resubmit_workflow_human_task".to_string(),
            correlation_id: params.correlation_id,
            changes,
        },
    )?;
    Ok(())
}

fn require_recovery_permission(
    ctx: &ReducerContext,
    organization_id: u64,
    action: &GuardedActionKey,
) -> Result<(), String> {
    match action {
        GuardedActionKey::ConfirmPurchaseOrder | GuardedActionKey::SendPurchaseOrder => {
            check_permission(ctx, organization_id, "purchase_order", "write")
        }
        GuardedActionKey::PostPayment => check_permission(ctx, organization_id, "payment", "post"),
        _ => Err("this guarded action has no generic approval resubmission contract".to_string()),
    }
}

fn require_recoverable_source(
    ctx: &ReducerContext,
    task: &WorkflowHumanTask,
    action: &GuardedActionKey,
) -> Result<(), String> {
    match action {
        GuardedActionKey::SendPurchaseOrder | GuardedActionKey::ConfirmPurchaseOrder => {
            let order = ctx
                .db
                .purchase_order()
                .id()
                .find(&task.subject_id)
                .ok_or("purchase order not found")?;
            let allowed = match action {
                GuardedActionKey::SendPurchaseOrder => order.state == PoState::Draft,
                _ => matches!(
                    order.state,
                    PoState::Draft | PoState::Sent | PoState::ToApprove
                ),
            };
            if !allowed {
                return Err("purchase order state no longer permits this approval".to_string());
            }
        }
        GuardedActionKey::PostPayment => {
            require_payment_not_bank_linked(ctx, task.organization_id, task.subject_id).map_err(
                |_| "bank-linked payments require dedicated settlement resubmission".to_string(),
            )?;
            let payment = ctx
                .db
                .account_payment()
                .id()
                .find(&task.subject_id)
                .ok_or("payment not found")?;
            if payment.state != PaymentState::NotPaid {
                return Err("only an unposted payment approval can be resubmitted".to_string());
            }
        }
        _ => return Err("unsupported approval recovery source".to_string()),
    }
    Ok(())
}

fn validate_key(key: &str, label: &str) -> Result<(), String> {
    if key.is_empty() || key.trim() != key || key.len() > 256 || key.chars().any(char::is_control) {
        return Err(format!(
            "{label} must be trimmed, contain 1 to 256 bytes and have no control characters"
        ));
    }
    Ok(())
}

fn subject_scope_key(snapshot: &GuardedActionSnapshot) -> String {
    format!(
        "{}:{}:{}:{}:{}",
        snapshot.organization_id,
        snapshot.company_id,
        snapshot.action.as_str(),
        snapshot.subject_id,
        snapshot.subject_revision_hash
    )
}

/// Follow only validated immutable links for this exact material source. The
/// fixed source command then converges on the same successor even if recovery
/// selected a newer published workflow definition. No ordinary request creates
/// a new recovery attempt merely because an old task was cancelled.
pub(super) fn resubmitted_guarded_task(
    ctx: &ReducerContext,
    snapshot: &GuardedActionSnapshot,
) -> Result<Option<WorkflowHumanTask>, String> {
    let links: Vec<_> = ctx
        .db
        .workflow_human_task_resubmission()
        .task_resubmission_by_subject()
        .filter(&subject_scope_key(snapshot))
        .take(MAX_RECOVERY_CHAIN + 1)
        .collect();
    if links.is_empty() {
        return Ok(None);
    }
    if links.len() > MAX_RECOVERY_CHAIN {
        return Err("approval recovery chain exceeds its safety bound".to_string());
    }
    let successors: BTreeSet<_> = links.iter().map(|link| link.successor_task_id).collect();
    let roots: Vec<_> = links
        .iter()
        .filter(|link| !successors.contains(&link.previous_task_id))
        .map(|link| link.previous_task_id)
        .collect();
    if roots.len() != 1 {
        return Err("approval recovery chain has ambiguous or cyclic roots".to_string());
    }
    let by_previous: BTreeMap<_, _> = links
        .iter()
        .map(|link| (link.previous_task_id, link))
        .collect();
    let mut current = roots[0];
    let mut visited = BTreeSet::new();
    while let Some(link) = by_previous.get(&current) {
        if !visited.insert(current)
            || link.organization_id != snapshot.organization_id
            || link.company_id != snapshot.company_id
            || link.expected_subject_revision_hash != snapshot.subject_revision_hash
            || link.successor_task_id <= current
        {
            return Err("approval recovery link scope is inconsistent".to_string());
        }
        let predecessor = ctx
            .db
            .workflow_human_task()
            .id()
            .find(&current)
            .ok_or("approval recovery predecessor missing")?;
        validate_linked_task(&predecessor, snapshot)?;
        if predecessor.status != WorkflowHumanTaskStatus::Cancelled
            || predecessor.revision < link.result_task_revision
        {
            return Err("approval recovery predecessor evidence changed".to_string());
        }
        let successor = ctx
            .db
            .workflow_human_task()
            .id()
            .find(&link.successor_task_id)
            .ok_or("approval recovery successor missing")?;
        validate_linked_task(&successor, snapshot)?;
        if successor.workflow_instance_id != link.successor_instance_id
            || successor.requested_by != predecessor.requested_by
        {
            return Err("approval recovery successor attribution changed".to_string());
        }
        current = successor.id;
    }
    if visited.len() != links.len() {
        return Err("approval recovery chain contains disconnected links".to_string());
    }
    ctx.db
        .workflow_human_task()
        .id()
        .find(&current)
        .map(Some)
        .ok_or_else(|| "approval recovery successor missing".to_string())
}

fn validate_linked_task(
    task: &WorkflowHumanTask,
    snapshot: &GuardedActionSnapshot,
) -> Result<(), String> {
    if task.organization_id != snapshot.organization_id
        || task.company_id != snapshot.company_id
        || task.subject_model != snapshot.subject_kind.as_str()
        || task.subject_id != snapshot.subject_id
        || task.subject_revision_hash != snapshot.subject_revision_hash
        || task.guarded_action.as_ref().is_none_or(|action| {
            action.key != snapshot.action || action.schema_version != snapshot.action_version
        })
    {
        return Err("approval recovery task scope is inconsistent".to_string());
    }
    Ok(())
}
