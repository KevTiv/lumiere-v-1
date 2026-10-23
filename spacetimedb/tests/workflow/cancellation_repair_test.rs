//! Legacy cancellation repair, current authority and immutable-history regressions.

use spacetimedb::{ReducerContext, Table};

use crate::core::audit::audit_log;
use crate::core::permissions::{
    org_permission, OrgPermission, PermissionAction, PermissionEffect, PermissionSubject,
};
use crate::core::persistence::{organization_commit, organization_row_change};
use crate::core::users::{
    find_user_profile_for_organization, user_organization, user_profile, UserOrganization,
    UserProfile,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::workflow::approvals::{
    claim_workflow_human_task_for_actor, decide_workflow_human_task_for_actor, workflow_human_task,
    ClaimWorkflowHumanTaskParams, DecideWorkflowHumanTaskParams, WorkflowHumanTask,
    WorkflowHumanTaskDecision, WorkflowHumanTaskStatus,
};
use crate::workflow::cancellation_repair::{
    repair_cancelled_workflow_tasks, workflow_cancellation_repair_receipt,
    RepairCancelledWorkflowTasksParams, WorkflowCancellationRepairReceipt,
};
use crate::workflow::definitions::WorkflowTaskAssignment;
use crate::workflow::runtime::{
    cancel_workflow, workflow_instance, CancelWorkflowParams, WorkflowInstance,
    WorkflowInstanceState,
};

use super::human_tasks_test::{
    cancellation_evidence_counts, candidate_decisions, insert_draft_purchase_order, new_identity,
    seed_member, seed_role, seed_task_after_approved_history, task_evidence_counts,
};

pub fn test_cancelled_workflow_task_repair(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    for all_candidates in [false, true] {
        repair_preserves_history_and_reauthorizes_replay(ctx, all_candidates)?;
    }
    Ok(())
}

fn repair_preserves_history_and_reauthorizes_replay(
    ctx: &ReducerContext,
    all_candidates: bool,
) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let role_id = seed_role(
        ctx,
        fixture.organization_id,
        vec![
            "workflow_task:write",
            "workflow_task:approve",
            "purchase_order:read",
        ],
    );
    let actor = seed_member(ctx, &fixture, role_id, None);
    seed_member(ctx, &fixture, role_id, None);
    let (seeded, history) = seed_task_after_approved_history(
        ctx,
        &fixture,
        role_id,
        actor,
        if all_candidates {
            WorkflowTaskAssignment::AllCandidates
        } else {
            WorkflowTaskAssignment::AnyCandidate
        },
    )?;
    // Reuse the shared history fixture, then bind its remaining runtime to a
    // real Finance source before the cancellation/repair commands under test.
    let order = insert_draft_purchase_order(ctx, &fixture, seeded.nonce)?;
    let source_instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&history.workflow_instance_id)
        .ok_or("repair fixture instance missing")?;
    ctx.db.workflow_instance().id().update(WorkflowInstance {
        subject_model: "purchase_order".to_string(),
        subject_id: order.id,
        ..source_instance
    });
    let source_tasks: Vec<_> = ctx
        .db
        .workflow_human_task()
        .human_task_by_instance()
        .filter(&history.workflow_instance_id)
        .collect();
    for source_task in source_tasks {
        ctx.db.workflow_human_task().id().update(WorkflowHumanTask {
            subject_model: "purchase_order".to_string(),
            subject_id: order.id,
            ..source_task
        });
    }
    let active_task = if all_candidates {
        decide_workflow_human_task_for_actor(
            ctx,
            fixture.organization_id,
            actor,
            DecideWorkflowHumanTaskParams {
                company_id: fixture.company_id,
                task_id: seeded.task_id,
                expected_task_revision: 1,
                expected_instance_revision: 2,
                decision: WorkflowHumanTaskDecision::Approve,
                acting_for: None,
                comment: Some("vote retained across legacy repair".to_string()),
                idempotency_key: seeded.key("repair-partial-vote"),
                correlation_id: seeded.key("repair-partial-vote-correlation"),
                causation_id: None,
            },
        )?
    } else {
        claim_workflow_human_task_for_actor(
            ctx,
            fixture.organization_id,
            actor,
            ClaimWorkflowHumanTaskParams {
                company_id: fixture.company_id,
                task_id: seeded.task_id,
                expected_revision: 1,
                acting_for: None,
                idempotency_key: seeded.key("repair-claim"),
                correlation_id: seeded.key("repair-claim-correlation"),
            },
        )?
    };
    cancel_workflow(
        ctx,
        fixture.organization_id,
        CancelWorkflowParams {
            company_id: fixture.company_id,
            instance_id: active_task.workflow_instance_id,
            expected_revision: 2,
            reason: "cancel before explicit legacy repair fixture".to_string(),
            idempotency_key: seeded.key("original-cancel"),
            correlation_id: seeded.key("original-cancel-correlation"),
            causation_id: None,
        },
    )?;
    // Model the historical bug in an isolated native fixture: cancellation
    // committed, but its previous active task projection remained unchanged.
    ctx.db
        .workflow_human_task()
        .id()
        .update(active_task.clone());
    let instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&active_task.workflow_instance_id)
        .ok_or("cancelled repair fixture instance missing")?;
    let runtime_evidence = cancellation_evidence_counts(ctx, instance.id);
    let task_evidence = task_evidence_counts(ctx, active_task.id);
    let history_evidence = task_evidence_counts(ctx, history.id);
    let votes = candidate_decisions(ctx, active_task.id);
    let params = RepairCancelledWorkflowTasksParams {
        company_id: fixture.company_id,
        instance_id: instance.id,
        expected_revision: instance.revision,
        reason: "repair inventoried legacy task projection".to_string(),
        idempotency_key: seeded.key("explicit-repair"),
        correlation_id: seeded.key("explicit-repair-correlation"),
    };
    let commit_count = || {
        ctx.db
            .organization_commit()
            .organization_commit_by_org()
            .filter(&fixture.organization_id)
            .count()
    };
    let previous_commit_count = commit_count();

    let stale = repair_cancelled_workflow_tasks(
        ctx,
        fixture.organization_id,
        RepairCancelledWorkflowTasksParams {
            expected_revision: instance.revision - 1,
            ..params.clone()
        },
    )
    .err()
    .ok_or("stale instance revision repaired task projections")?;
    if !stale.contains("stale") {
        return Err(stale);
    }
    let foreign = OrgFixture::seed_minimal(ctx)?;
    repair_cancelled_workflow_tasks(
        ctx,
        fixture.organization_id,
        RepairCancelledWorkflowTasksParams {
            company_id: foreign.company_id,
            ..params.clone()
        },
    )
    .err()
    .ok_or("cross-organization company repaired task projections")?;
    ctx.db.workflow_instance().id().update(WorkflowInstance {
        state: WorkflowInstanceState::Active,
        ..instance.clone()
    });
    let active = repair_cancelled_workflow_tasks(ctx, fixture.organization_id, params.clone())
        .err()
        .ok_or("an active workflow was repaired as cancelled")?;
    ctx.db.workflow_instance().id().update(instance.clone());
    if !active.contains("cancelled instance") {
        return Err(active);
    }
    if ctx
        .db
        .workflow_human_task()
        .id()
        .find(&active_task.id)
        .is_none_or(|task| task.revision != active_task.revision)
    {
        return Err("denied repair changed a task revision".to_string());
    }

    repair_cancelled_workflow_tasks(ctx, fixture.organization_id, params.clone())?;
    let repaired = ctx
        .db
        .workflow_human_task()
        .id()
        .find(&active_task.id)
        .ok_or("repaired task missing")?;
    let preserved = ctx
        .db
        .workflow_human_task()
        .id()
        .find(&history.id)
        .ok_or("successful history missing")?;
    let unchanged_instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&instance.id)
        .ok_or("repaired instance missing")?;
    if repaired.status != WorkflowHumanTaskStatus::Cancelled
        || repaired.revision != active_task.revision + 1
        || repaired.claimed_by != active_task.claimed_by
        || candidate_decisions(ctx, active_task.id) != votes
        || task_evidence_counts(ctx, active_task.id) != task_evidence
        || task_evidence_counts(ctx, history.id) != history_evidence
        || cancellation_evidence_counts(ctx, instance.id) != runtime_evidence
        || unchanged_instance.state != WorkflowInstanceState::Cancelled
        || unchanged_instance.revision != instance.revision
        || unchanged_instance.cancelled_by != instance.cancelled_by
        || preserved.status != history.status
        || preserved.revision != history.revision
        || preserved.decided_by != history.decided_by
    {
        return Err(
            "repair changed terminal runtime, claim history, successful tasks, votes or receipts"
                .to_string(),
        );
    }
    let receipts: Vec<_> = ctx
        .db
        .workflow_cancellation_repair_receipt()
        .cancellation_repair_by_instance()
        .filter(&instance.id)
        .collect();
    if receipts.len() != 1 {
        return Err("repair did not create exactly one private receipt".to_string());
    }
    let receipt = receipts
        .into_iter()
        .next()
        .ok_or("repair receipt missing")?;
    if receipt.created_by != ctx.sender()
        || receipt.original_cancellation_key != seeded.key("original-cancel")
        || receipt.repaired_tasks.len() != 1
        || receipt.repaired_tasks[0].task_id != active_task.id
        || receipt.repaired_tasks[0].prior_revision != active_task.revision
        || receipt.repaired_tasks[0].result_revision != repaired.revision
    {
        return Err("repair receipt omitted exact actor/task/cancellation evidence".to_string());
    }
    if commit_count() != previous_commit_count + 1 {
        return Err("repair did not produce exactly one durable commit".to_string());
    }
    assert_durable_repair_evidence(ctx, &receipt, &repaired, &preserved)?;
    let repair_audit_count = || {
        ctx.db
            .audit_log()
            .audit_by_org()
            .filter(&fixture.organization_id)
            .filter(|row| {
                row.table_name == "workflow_instance"
                    && row.record_id == instance.id
                    && row.action == "REPAIR_CANCELLED_TASKS"
            })
            .count()
    };
    if repair_audit_count() != 1 {
        return Err("repair audit is missing".to_string());
    }
    repair_cancelled_workflow_tasks(ctx, fixture.organization_id, params.clone())?;
    let different = repair_cancelled_workflow_tasks(
        ctx,
        fixture.organization_id,
        RepairCancelledWorkflowTasksParams {
            reason: "changed reason".to_string(),
            ..params.clone()
        },
    )
    .err()
    .ok_or("repair replay accepted changed input")?;
    if !different.contains("different input") {
        return Err(different);
    }
    let clean = repair_cancelled_workflow_tasks(
        ctx,
        fixture.organization_id,
        RepairCancelledWorkflowTasksParams {
            idempotency_key: seeded.key("unnecessary-repair"),
            ..params.clone()
        },
    )
    .err()
    .ok_or("new command repaired an already-clean instance")?;
    if !clean.contains("no active task projections") {
        return Err(clean);
    }

    // Model the same key having been committed by another operator. Restore the
    // immutable fixture receipt immediately after checking the ownership guard.
    ctx.db
        .workflow_cancellation_repair_receipt()
        .scope_key()
        .update(WorkflowCancellationRepairReceipt {
            created_by: new_identity(ctx),
            ..receipt.clone()
        });
    let foreign_actor =
        repair_cancelled_workflow_tasks(ctx, fixture.organization_id, params.clone())
            .err()
            .ok_or("another actor's repair receipt was replayed")?;
    ctx.db
        .workflow_cancellation_repair_receipt()
        .scope_key()
        .update(receipt);
    if !foreign_actor.contains("another actor") {
        return Err(foreign_actor);
    }

    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|row| row.organization_id == fixture.organization_id)
        .ok_or("repair operator membership missing")?;
    ctx.db.user_organization().id().update(UserOrganization {
        is_active: false,
        ..membership.clone()
    });
    let membership_denied =
        repair_cancelled_workflow_tasks(ctx, fixture.organization_id, params.clone()).is_err();
    ctx.db.user_organization().id().update(membership);
    if !membership_denied {
        return Err("removed organization membership replayed a repair".to_string());
    }
    let mut profile =
        find_user_profile_for_organization(ctx, ctx.sender(), fixture.organization_id)
            .ok_or("repair operator profile missing")?;
    let was_superuser = profile.is_superuser;
    profile.is_superuser = false;
    ctx.db.user_profile().id().update(profile);
    for (resource, action) in [
        ("workflow_instance", PermissionAction::Write),
        ("purchase-orders", PermissionAction::Read),
    ] {
        let deny = ctx.db.org_permission().insert(OrgPermission {
            id: 0,
            organization_id: fixture.organization_id,
            subject: PermissionSubject::User(ctx.sender()),
            role_id: None,
            resource: resource.to_string(),
            action,
            effect: PermissionEffect::Deny,
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
        });
        let denied =
            repair_cancelled_workflow_tasks(ctx, fixture.organization_id, params.clone()).is_err();
        ctx.db.org_permission().id().delete(&deny.id);
        if !denied {
            return Err(format!("revoked {resource} permission replayed a repair"));
        }
    }
    let profile = find_user_profile_for_organization(ctx, ctx.sender(), fixture.organization_id)
        .ok_or("repair operator profile missing after authority checks")?;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: was_superuser,
        ..profile
    });
    if repair_audit_count() != 1
        || commit_count() != previous_commit_count + 1
        || ctx
            .db
            .workflow_cancellation_repair_receipt()
            .cancellation_repair_by_instance()
            .filter(&instance.id)
            .count()
            != 1
        || ctx
            .db
            .workflow_human_task()
            .id()
            .find(&active_task.id)
            .is_none_or(|task| task.revision != repaired.revision)
        || candidate_decisions(ctx, active_task.id) != votes
        || cancellation_evidence_counts(ctx, instance.id) != runtime_evidence
    {
        return Err("replay or denial changed repair effects/history".to_string());
    }
    Ok(())
}

fn assert_durable_repair_evidence(
    ctx: &ReducerContext,
    receipt: &WorkflowCancellationRepairReceipt,
    repaired: &WorkflowHumanTask,
    preserved: &WorkflowHumanTask,
) -> Result<(), String> {
    let commits: Vec<_> = ctx
        .db
        .organization_commit()
        .organization_commit_by_org()
        .filter(&receipt.organization_id)
        .filter(|commit| commit.operation_id == "erp.repair_cancelled_workflow_tasks")
        .collect();
    if commits.len() != 1 {
        return Err("repair durable envelope is missing or duplicated".to_string());
    }
    let commit = &commits[0];
    if commit.actor_identity != ctx.sender() || commit.correlation_id != receipt.correlation_id {
        return Err("repair durable envelope lost actor or correlation".to_string());
    }
    let changes: Vec<_> = ctx
        .db
        .organization_row_change()
        .organization_row_change_by_commit()
        .filter(&receipt.organization_id)
        .filter(|change| change.commit_sequence == commit.sequence)
        .collect();
    if changes.len() != commit.row_change_count as usize
        || changes.iter().any(|change| change.change_kind != "upsert")
    {
        return Err("repair durable commit has incomplete or destructive row changes".to_string());
    }
    for table in [
        "workflow",
        "workflow_version",
        "workflow_node",
        "workflow_edge",
        "workflow_instance",
        "workflow_token",
        "workflow_command_receipt",
        "workflow_decision_event",
        "workflow_human_task",
        "workflow_human_task_candidate",
        "workflow_human_task_event",
        "workflow_human_task_receipt",
        "workflow_cancellation_repair_receipt",
        "audit_log",
    ] {
        if !changes.iter().any(|change| change.table_name == table) {
            return Err(format!("repair durable commit omitted {table} evidence"));
        }
    }
    let durable_rows: Vec<_> = changes
        .iter()
        .map(|change| {
            Ok((
                change.table_name.as_str(),
                serde_json::from_str::<serde_json::Value>(
                    change
                        .row_json
                        .as_deref()
                        .ok_or("repair durable row is missing")?,
                )
                .map_err(|error| error.to_string())?,
            ))
        })
        .collect::<Result<_, String>>()?;
    for (table, expected) in [
        (
            "workflow_cancellation_repair_receipt",
            serde_json::to_value(spacetimedb_sats::serde::SerdeWrapper::from_ref(receipt)),
        ),
        (
            "workflow_human_task",
            serde_json::to_value(spacetimedb_sats::serde::SerdeWrapper::from_ref(repaired)),
        ),
        (
            "workflow_human_task",
            serde_json::to_value(spacetimedb_sats::serde::SerdeWrapper::from_ref(preserved)),
        ),
    ] {
        let expected = expected.map_err(|error| error.to_string())?;
        if durable_rows
            .iter()
            .filter(|(name, row)| *name == table && *row == expected)
            .count()
            != 1
        {
            return Err(format!(
                "repair durable commit omitted an exact {table} row"
            ));
        }
    }
    if !durable_rows.iter().any(|(table, row)| {
        *table == "audit_log"
            && row["action"] == "REPAIR_CANCELLED_TASKS"
            && row["record_id"] == receipt.instance_id
    }) {
        return Err("repair durable commit omitted its causal audit".to_string());
    }
    Ok(())
}
