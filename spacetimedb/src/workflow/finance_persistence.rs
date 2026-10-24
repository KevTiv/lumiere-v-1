//! Durable outcomes for the Finance work-board lifecycle.
//!
//! Fresh task receipts and runtime cancellation are the mutation boundaries.
//! Replays return before these hooks. Bank settlement tasks retain their existing
//! domain collector; this module covers purchase orders and ordinary payments.

use std::collections::BTreeSet;

use spacetimedb::ReducerContext;

use crate::core::persistence::{record_organization_commit, OrganizationCommitInput, RowChange};

use super::action_registry::{guarded_action_receipt, GuardedActionKey};
use super::approvals::{
    workflow_human_task, workflow_human_task_receipt, WorkflowHumanTask,
    WorkflowHumanTaskCommandKind,
};
use super::runtime::{workflow_instance, WorkflowInstance};

const MAX_SNAPSHOT_ROWS: usize = 16_384;

/// Called only after a new immutable task receipt has been inserted.
pub(super) fn record_task_receipt(
    ctx: &ReducerContext,
    task: &WorkflowHumanTask,
    command_kind: &WorkflowHumanTaskCommandKind,
) -> Result<(), String> {
    // Resubmission records both attempts and its new immutable link after this
    // receipt. Create has no lifecycle receipt and no additional effect here.
    if matches!(
        command_kind,
        WorkflowHumanTaskCommandKind::Create | WorkflowHumanTaskCommandKind::Resubmit
    ) {
        return Ok(());
    }
    if !supported_task(task) {
        return Ok(());
    }
    let instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&task.workflow_instance_id)
        .ok_or("finance workflow persistence instance missing")?;
    require_task_scope(task, &instance)?;
    let Some(snapshot) =
        FinanceWorkflowCommitSnapshot::for_instance(ctx, &instance, &task.correlation_id)?
    else {
        return Ok(());
    };
    match command_kind {
        WorkflowHumanTaskCommandKind::Claim => record_claim(ctx, &snapshot),
        WorkflowHumanTaskCommandKind::Decision => record_decision(ctx, &snapshot),
        WorkflowHumanTaskCommandKind::Invalidate => record_invalidation(ctx, &snapshot),
        WorkflowHumanTaskCommandKind::Comment => record_comment(ctx, &snapshot),
        WorkflowHumanTaskCommandKind::Create | WorkflowHumanTaskCommandKind::Resubmit => Ok(()),
    }
}

/// Called after the fresh Cancel receipt and all active task projections close.
pub(super) fn record_cancelled_workflow(
    ctx: &ReducerContext,
    instance: &WorkflowInstance,
    correlation_id: &str,
) -> Result<(), String> {
    let Some(snapshot) =
        FinanceWorkflowCommitSnapshot::for_instance(ctx, instance, correlation_id)?
    else {
        return Ok(());
    };
    snapshot.record(ctx, "erp.cancel_workflow")
}

struct FinanceWorkflowCommitSnapshot {
    organization_id: u64,
    company_id: u64,
    instance_id: u64,
    subject_model: String,
    subject_id: u64,
    correlation_id: String,
}

impl FinanceWorkflowCommitSnapshot {
    fn for_instance(
        ctx: &ReducerContext,
        instance: &WorkflowInstance,
        correlation_id: &str,
    ) -> Result<Option<Self>, String> {
        if !matches!(
            instance.subject_model.as_str(),
            "purchase_order" | "account_payment"
        ) {
            return Ok(None);
        }
        if instance.subject_model == "account_payment"
            && crate::accounting::bank_reconciliation::require_payment_not_bank_linked(
                ctx,
                instance.organization_id,
                instance.subject_id,
            )
            .is_err()
        {
            return Ok(None);
        }
        for task in ctx
            .db
            .workflow_human_task()
            .human_task_by_instance()
            .filter(&instance.id)
        {
            require_task_scope(&task, instance)?;
            if !supported_task(&task) {
                return Ok(None);
            }
        }
        Ok(Some(Self {
            organization_id: instance.organization_id,
            company_id: instance.company_id,
            instance_id: instance.id,
            subject_model: instance.subject_model.clone(),
            subject_id: instance.subject_id,
            correlation_id: correlation_id.to_string(),
        }))
    }

    fn record(&self, ctx: &ReducerContext, operation: &str) -> Result<(), String> {
        let mut changes = Vec::new();
        super::finance_effects::append_source_effects(
            ctx,
            self.organization_id,
            self.company_id,
            &self.subject_model,
            self.subject_id,
            &mut changes,
        )?;
        append_guarded_receipts(ctx, self, &mut changes)?;
        changes.extend(super::recovery_persistence::snapshot_instances(
            ctx,
            self.organization_id,
            self.company_id,
            &[self.instance_id],
        )?);
        if changes.len() > MAX_SNAPSHOT_ROWS {
            return Err("finance workflow history exceeds the durable snapshot limit".to_string());
        }
        record_organization_commit(
            ctx,
            OrganizationCommitInput {
                organization_id: self.organization_id,
                operation_id: operation.to_string(),
                correlation_id: self.correlation_id.clone(),
                changes,
            },
        )?;
        Ok(())
    }
}

fn supported_task(task: &WorkflowHumanTask) -> bool {
    match (task.subject_model.as_str(), task.guarded_action.as_ref()) {
        ("purchase_order" | "account_payment", None) => true,
        ("purchase_order", Some(action)) => matches!(
            action.key,
            GuardedActionKey::SendPurchaseOrder | GuardedActionKey::ConfirmPurchaseOrder
        ),
        ("account_payment", Some(action)) => action.key == GuardedActionKey::PostPayment,
        _ => false,
    }
}

fn require_task_scope(task: &WorkflowHumanTask, instance: &WorkflowInstance) -> Result<(), String> {
    if task.organization_id != instance.organization_id
        || task.company_id != instance.company_id
        || task.workflow_instance_id != instance.id
        || task.subject_model != instance.subject_model
        || task.subject_id != instance.subject_id
    {
        return Err("finance workflow task is outside its source instance scope".to_string());
    }
    Ok(())
}

/// Follow exact successful decision references; unrelated effects on the same
/// numeric subject ID must never enter this workflow's durable outcome.
fn append_guarded_receipts(
    ctx: &ReducerContext,
    snapshot: &FinanceWorkflowCommitSnapshot,
    changes: &mut Vec<RowChange>,
) -> Result<(), String> {
    let mut included = BTreeSet::new();
    for task in ctx
        .db
        .workflow_human_task()
        .human_task_by_instance()
        .filter(&snapshot.instance_id)
    {
        for receipt in ctx
            .db
            .workflow_human_task_receipt()
            .human_task_receipt_by_task()
            .filter(&task.id)
            .filter(|row| row.command_kind == WorkflowHumanTaskCommandKind::Decision)
        {
            let Some(id) = receipt.domain_receipt.as_ref() else {
                continue;
            };
            let action = task
                .guarded_action
                .as_ref()
                .ok_or("finance decision receipt has no guarded action")?;
            let effect = ctx
                .db
                .guarded_action_receipt()
                .id()
                .find(id)
                .ok_or("finance decision guarded receipt missing")?;
            if receipt.organization_id != snapshot.organization_id
                || receipt.company_id != snapshot.company_id
                || effect.organization_id != snapshot.organization_id
                || effect.company_id != snapshot.company_id
                || effect.subject_kind.as_str() != snapshot.subject_model
                || effect.subject_id != snapshot.subject_id
                || effect.action != action.key
                || effect.action_version != action.schema_version
                || effect.expected_subject_revision_hash != task.subject_revision_hash
                || effect.idempotency_key
                    != format!("human-task:{}:{}", task.id, receipt.idempotency_key)
            {
                return Err(
                    "finance decision guarded receipt is outside its exact task scope".to_string(),
                );
            }
            if included.insert(effect.id.clone()) {
                if changes.len() >= MAX_SNAPSHOT_ROWS {
                    return Err(
                        "finance workflow history exceeds the durable snapshot limit".to_string(),
                    );
                }
                changes.push(RowChange::upsert_stdb_row(
                    "guarded_action_receipt",
                    serde_json::json!({"id": effect.id}),
                    &effect,
                )?);
            }
        }
    }
    Ok(())
}

// Fixed wrappers keep the shared collector's operation IDs closed and checked
// by the existing C2 commit-coverage metadata.
fn record_claim(
    ctx: &ReducerContext,
    snapshot: &FinanceWorkflowCommitSnapshot,
) -> Result<(), String> {
    snapshot.record(ctx, "erp.claim_workflow_human_task")
}

fn record_decision(
    ctx: &ReducerContext,
    snapshot: &FinanceWorkflowCommitSnapshot,
) -> Result<(), String> {
    snapshot.record(ctx, "erp.decide_workflow_human_task")
}

fn record_invalidation(
    ctx: &ReducerContext,
    snapshot: &FinanceWorkflowCommitSnapshot,
) -> Result<(), String> {
    snapshot.record(ctx, "erp.invalidate_workflow_human_task")
}

fn record_comment(
    ctx: &ReducerContext,
    snapshot: &FinanceWorkflowCommitSnapshot,
) -> Result<(), String> {
    snapshot.record(ctx, "erp.add_workflow_human_task_comment")
}
