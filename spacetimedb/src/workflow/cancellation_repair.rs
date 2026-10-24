//! Explicit, audited repair of active task projections left by an older cancellation.
//!
//! Runtime cancellation history and receipts remain immutable. This operation only
//! closes stale Open/Claimed task projections and records a separate repair receipt.

use sha2::{Digest, Sha256};
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::persistence::{record_organization_commit, OrganizationCommitInput, RowChange};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

use super::approvals::{
    cancel_active_workflow_human_tasks, workflow_human_task, WorkflowHumanTaskStatus,
};
use super::authorization::{require_workflow_company_access, require_workflow_subject_read};
use super::runtime::{
    workflow_command_receipt, workflow_decision_event, workflow_instance, workflow_token,
    WorkflowCommandKind, WorkflowInstanceState, WorkflowTokenState,
};

const MAX_COMMAND_KEY_LEN: usize = 256;
const MAX_REASON_LEN: usize = 8_192;
const MAX_REPAIR_TASKS: usize = 256;

/// Repair one explicitly reviewed cancelled workflow instance.
#[derive(SpacetimeType, Clone, Debug)]
pub struct RepairCancelledWorkflowTasksParams {
    pub company_id: u64,
    pub instance_id: u64,
    pub expected_revision: u64,
    pub reason: String,
    pub idempotency_key: String,
    pub correlation_id: String,
}

/// Exact before/after task revisions retained by a successful repair command.
#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub struct WorkflowCancellationRepairTask {
    pub task_id: u64,
    pub prior_revision: u64,
    pub result_revision: u64,
}

/// Private, immutable repair evidence, separate from the original cancellation.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = workflow_cancellation_repair_receipt,
    index(accessor = cancellation_repair_by_org, btree(columns = [organization_id])),
    index(accessor = cancellation_repair_by_instance, btree(columns = [instance_id]))
)]
pub struct WorkflowCancellationRepairReceipt {
    #[primary_key]
    pub scope_key: String,
    pub organization_id: u64,
    pub company_id: u64,
    pub instance_id: u64,
    pub instance_revision: u64,
    pub original_cancellation_event_id: u64,
    pub original_cancellation_key: String,
    pub idempotency_key: String,
    pub input_hash: String,
    pub reason: String,
    pub repaired_tasks: Vec<WorkflowCancellationRepairTask>,
    pub correlation_id: String,
    pub created_by: Identity,
    pub created_at: Timestamp,
}

/// Close legacy active task projections after an already-committed cancellation.
///
/// Current permissions and scope are checked even for receipt replay. A successful
/// replay makes no writes. A fresh command for an already-clean instance is rejected.
#[reducer]
pub fn repair_cancelled_workflow_tasks(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RepairCancelledWorkflowTasksParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow_instance", "write")?;
    let company_membership_bypass =
        require_workflow_company_access(ctx, organization_id, params.company_id, ctx.sender())?;
    for (value, name, maximum) in [
        (
            &params.idempotency_key,
            "idempotency key",
            MAX_COMMAND_KEY_LEN,
        ),
        (
            &params.correlation_id,
            "correlation id",
            MAX_COMMAND_KEY_LEN,
        ),
        (&params.reason, "repair reason", MAX_REASON_LEN),
    ] {
        if value.trim().is_empty() || value.len() > maximum {
            return Err(format!(
                "{name} is required and must not exceed {maximum} bytes"
            ));
        }
    }
    let instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&params.instance_id)
        .ok_or("workflow instance not found")?;
    if instance.organization_id != organization_id || instance.company_id != params.company_id {
        return Err("workflow instance is outside the requested scope".to_string());
    }
    require_workflow_subject_read(ctx, organization_id, ctx.sender(), &instance.subject_model)?;
    if instance.state != WorkflowInstanceState::Cancelled {
        return Err("workflow repair requires a cancelled instance".to_string());
    }
    let tasks: Vec<_> = ctx
        .db
        .workflow_human_task()
        .human_task_by_instance()
        .filter(&instance.id)
        .filter(|task| {
            matches!(
                task.status,
                WorkflowHumanTaskStatus::Open | WorkflowHumanTaskStatus::Claimed
            )
        })
        .take(MAX_REPAIR_TASKS + 1)
        .collect();
    if tasks.len() > MAX_REPAIR_TASKS {
        return Err("workflow repair exceeds the task limit".to_string());
    }
    for task in &tasks {
        if task.organization_id != organization_id
            || task.company_id != params.company_id
            || task.workflow_version_id != instance.workflow_version_id
            || task.subject_model != instance.subject_model
            || task.subject_id != instance.subject_id
        {
            return Err("workflow repair task scope is inconsistent".to_string());
        }
        // Scope equality above binds every affected task to the source whose
        // current read policy was checked on the instance.
    }

    let scope_key = format!(
        "{organization_id}:repair_cancelled_workflow_tasks:{}",
        params.idempotency_key
    );
    let input_hash = repair_input_hash(organization_id, &params);
    if let Some(receipt) = ctx
        .db
        .workflow_cancellation_repair_receipt()
        .scope_key()
        .find(scope_key.clone())
    {
        if receipt.created_by != ctx.sender() {
            return Err("workflow repair receipt belongs to another actor".to_string());
        }
        if receipt.input_hash != input_hash {
            return Err("idempotency key was already used with different input".to_string());
        }
        return Ok(());
    }
    if instance.revision != params.expected_revision {
        return Err("stale workflow instance revision".to_string());
    }
    if instance.active_token_count != 0
        || ctx
            .db
            .workflow_token()
            .workflow_token_by_instance()
            .filter(&instance.id)
            .any(|token| token.state == WorkflowTokenState::Active)
    {
        return Err("cancelled workflow still has active runtime tokens".to_string());
    }
    let cancellation = ctx
        .db
        .workflow_decision_event()
        .workflow_event_by_instance()
        .filter(&instance.id)
        .find(|event| {
            event.organization_id == organization_id
                && event.company_id == params.company_id
                && event.command_kind == WorkflowCommandKind::Cancel
                && event.next_instance_state == WorkflowInstanceState::Cancelled
                && event.next_revision == instance.revision
                && event.subject_model == instance.subject_model
                && event.subject_id == instance.subject_id
        })
        .ok_or("original workflow cancellation evidence is missing")?;
    let cancellation_receipt_key =
        format!("{organization_id}:cancel:{}", cancellation.idempotency_key);
    let cancellation_receipt = ctx
        .db
        .workflow_command_receipt()
        .scope_key()
        .find(cancellation_receipt_key)
        .ok_or("original workflow cancellation receipt is missing")?;
    if cancellation_receipt.organization_id != organization_id
        || cancellation_receipt.company_id != params.company_id
        || cancellation_receipt.command_kind != WorkflowCommandKind::Cancel
        || cancellation_receipt.result_instance_id != instance.id
        || cancellation_receipt.result_instance_revision != instance.revision
        || cancellation_receipt.result_instance_state != WorkflowInstanceState::Cancelled
        || cancellation_receipt.input_hash != cancellation.input_hash
    {
        return Err("original workflow cancellation receipt is inconsistent".to_string());
    }

    let mut repaired_tasks: Vec<_> = tasks
        .iter()
        .filter(|task| {
            matches!(
                task.status,
                WorkflowHumanTaskStatus::Open | WorkflowHumanTaskStatus::Claimed
            )
        })
        .map(|task| {
            Ok(WorkflowCancellationRepairTask {
                task_id: task.id,
                prior_revision: task.revision,
                result_revision: task
                    .revision
                    .checked_add(1)
                    .ok_or("workflow task revision overflow")?,
            })
        })
        .collect::<Result<_, String>>()?;
    if repaired_tasks.is_empty() {
        return Err("no active task projections require repair".to_string());
    }
    repaired_tasks.sort_by_key(|task| task.task_id);

    cancel_active_workflow_human_tasks(
        ctx,
        &instance,
        &cancellation.idempotency_key,
        &params.correlation_id,
        company_membership_bypass,
    )?;
    write_audit_log_v2(ctx, organization_id, AuditLogParams {
        company_id: Some(params.company_id),
        table_name: "workflow_instance",
        record_id: instance.id,
        action: "REPAIR_CANCELLED_TASKS",
        old_values: None,
        new_values: None,
        changed_fields: Vec::new(),
        metadata: Some(serde_json::json!({
            "reason": params.reason,
            "idempotency_key": params.idempotency_key,
            "correlation_id": params.correlation_id,
            "instance_revision": instance.revision,
            "original_cancellation_event_id": cancellation.id,
            "original_cancellation_key": cancellation.idempotency_key,
            "repaired_task_count": repaired_tasks.len(),
            "repaired_task_ids": repaired_tasks.iter().map(|task| task.task_id).collect::<Vec<_>>(),
            "company_membership_bypass": company_membership_bypass,
        }).to_string()),
    });
    let receipt =
        ctx.db
            .workflow_cancellation_repair_receipt()
            .insert(WorkflowCancellationRepairReceipt {
                scope_key,
                organization_id,
                company_id: params.company_id,
                instance_id: instance.id,
                instance_revision: instance.revision,
                original_cancellation_event_id: cancellation.id,
                original_cancellation_key: cancellation.idempotency_key,
                idempotency_key: params.idempotency_key,
                input_hash,
                reason: params.reason,
                repaired_tasks,
                correlation_id: params.correlation_id.clone(),
                created_by: ctx.sender(),
                created_at: ctx.timestamp,
            });
    let mut changes = super::recovery_persistence::snapshot_instances(
        ctx,
        organization_id,
        params.company_id,
        &[instance.id],
    )?;
    changes.push(RowChange::upsert_stdb_row(
        "workflow_cancellation_repair_receipt",
        serde_json::json!({"scope_key": receipt.scope_key}),
        &receipt,
    )?);
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.repair_cancelled_workflow_tasks".to_string(),
            correlation_id: params.correlation_id,
            changes,
        },
    )?;
    Ok(())
}

fn repair_input_hash(organization_id: u64, params: &RepairCancelledWorkflowTasksParams) -> String {
    let mut hash = Sha256::new();
    for field in [
        "repair_cancelled_workflow_tasks".to_string(),
        organization_id.to_string(),
        params.company_id.to_string(),
        params.instance_id.to_string(),
        params.expected_revision.to_string(),
        params.reason.clone(),
        params.idempotency_key.clone(),
        params.correlation_id.clone(),
    ] {
        hash.update((field.len() as u64).to_le_bytes());
        hash.update(field.as_bytes());
    }
    format!("sha256:{:x}", hash.finalize())
}
