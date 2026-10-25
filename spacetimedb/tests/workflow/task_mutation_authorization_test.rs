//! Current authority and actor-owned replay for task management and comments.

use spacetimedb::{Identity, ReducerContext, Table};

use crate::core::audit::audit_log;
use crate::core::organization::{company, Company};
use crate::core::permissions::{
    org_permission, OrgPermission, PermissionAction, PermissionEffect, PermissionSubject,
};
use crate::core::persistence::organization_commit;
use crate::core::users::{user_organization, UserOrganization};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::workflow::approvals::{
    add_workflow_human_task_comment_for_actor, invalidate_workflow_human_task_internal,
    workflow_human_task, AddWorkflowHumanTaskCommentParams, InvalidateWorkflowHumanTaskParams,
    WorkflowHumanTask, WorkflowHumanTaskStatus,
};
use crate::workflow::definitions::WorkflowTaskAssignment;
use crate::workflow::runtime::{workflow_instance, WorkflowInstance};

use super::human_tasks_test::{
    insert_draft_purchase_order, new_identity, seed_member, seed_role, seed_task_runtime,
    task_evidence_counts, SeededTask,
};

const CHANGED_REVISION: &str =
    "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

pub fn test_task_mutation_authorization(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    invalidation_requires_current_management_authority(ctx)?;
    comment_replay_requires_current_candidate_authority(ctx)
}

fn invalidation_requires_current_management_authority(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let candidate_role = seed_role(ctx, fixture.organization_id, vec!["workflow_task:approve"]);
    let manager_role = seed_role(
        ctx,
        fixture.organization_id,
        vec!["workflow_task:write", "purchase_order:read"],
    );
    let manager = seed_member(ctx, &fixture, manager_role, None);
    let other_manager = seed_member(ctx, &fixture, manager_role, None);
    let foreign_company = seed_other_company(ctx, &fixture)?;
    let first = seed_finance_task(ctx, &fixture, candidate_role)?;
    let next = seed_finance_task(ctx, &fixture, candidate_role)?;
    let ids = [first.task_id, next.task_id];
    let first_params = invalidation(&fixture, &first);
    let next_params = invalidation(&fixture, &next);
    let before = evidence(ctx, &fixture, &ids)?;

    // Same-organization write authority cannot manage another company's task.
    let membership = membership(ctx, fixture.organization_id, manager)?;
    ctx.db.user_organization().id().update(UserOrganization {
        company_id: Some(foreign_company),
        ..membership.clone()
    });
    let denied = invalidate_workflow_human_task_internal(
        ctx,
        fixture.organization_id,
        manager,
        first_params.clone(),
    );
    ctx.db.user_organization().id().update(membership);
    require_denied(denied, "no active access to this company")?;
    require_unchanged(ctx, &fixture, &ids, &before)?;

    // A manager need not be in the reviewer electorate to invalidate work.
    let invalidated = invalidate_workflow_human_task_internal(
        ctx,
        fixture.organization_id,
        manager,
        first_params.clone(),
    )?;
    if invalidated.status != WorkflowHumanTaskStatus::Invalidated
        || invalidated.revision != 2
        || invalidated.invalidated_by != Some(manager)
        || invalidated.candidate_role_ids.contains(&manager_role)
    {
        return Err("invalidation did not retain its independent management authority".to_string());
    }
    let committed = evidence(ctx, &fixture, &ids)?;
    if committed.events != before.events + 1
        || committed.receipts != before.receipts + 1
        || committed.audits != before.audits + 1
        || committed.commits != before.commits + 1
    {
        return Err("fresh invalidation did not record exactly one complete outcome".to_string());
    }
    invalidate_workflow_human_task_internal(
        ctx,
        fixture.organization_id,
        manager,
        first_params.clone(),
    )?;
    require_denied(
        invalidate_workflow_human_task_internal(
            ctx,
            fixture.organization_id,
            other_manager,
            first_params.clone(),
        ),
        "receipt belongs to another actor",
    )?;
    require_unchanged(ctx, &fixture, &ids, &committed)?;

    exercise_revocations(ctx, &fixture, manager, foreign_company, None, &ids, || {
        for params in [first_params.clone(), next_params.clone()] {
            require_denied(
                invalidate_workflow_human_task_internal(
                    ctx,
                    fixture.organization_id,
                    manager,
                    params,
                ),
                "Permission denied",
            )?;
        }
        Ok(())
    })?;
    invalidate_workflow_human_task_internal(ctx, fixture.organization_id, manager, first_params)?;
    require_unchanged(ctx, &fixture, &ids, &committed)?;
    let next_invalidated = invalidate_workflow_human_task_internal(
        ctx,
        fixture.organization_id,
        manager,
        next_params,
    )?;
    if next_invalidated.status != WorkflowHumanTaskStatus::Invalidated
        || next_invalidated.revision != 2
    {
        return Err("restored management authority could not invalidate fresh work".to_string());
    }
    Ok(())
}

fn comment_replay_requires_current_candidate_authority(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let permissions = vec!["workflow_task:write", "purchase_order:read"];
    let candidate_role = seed_role(ctx, fixture.organization_id, permissions.clone());
    let unrelated_role = seed_role(ctx, fixture.organization_id, permissions);
    let actor = seed_member(ctx, &fixture, candidate_role, None);
    let other_actor = seed_member(ctx, &fixture, candidate_role, None);
    let foreign_company = seed_other_company(ctx, &fixture)?;
    let seeded = seed_finance_task(ctx, &fixture, candidate_role)?;
    let ids = [seeded.task_id];
    let comment = AddWorkflowHumanTaskCommentParams {
        company_id: fixture.company_id,
        task_id: seeded.task_id,
        expected_revision: 1,
        comment: "Supplier quote reviewed".to_string(),
        idempotency_key: seeded.key("authority-comment"),
        correlation_id: seeded.key("authority-comment-correlation"),
    };
    let before = evidence(ctx, &fixture, &ids)?;
    let commented = add_workflow_human_task_comment_for_actor(
        ctx,
        fixture.organization_id,
        actor,
        comment.clone(),
    )?;
    let committed = evidence(ctx, &fixture, &ids)?;
    if commented.revision != 2
        || committed.events != before.events + 1
        || committed.receipts != before.receipts + 1
        || committed.commits != before.commits + 1
    {
        return Err("fresh comment did not record exactly one complete outcome".to_string());
    }
    add_workflow_human_task_comment_for_actor(
        ctx,
        fixture.organization_id,
        actor,
        comment.clone(),
    )?;
    require_denied(
        add_workflow_human_task_comment_for_actor(
            ctx,
            fixture.organization_id,
            other_actor,
            comment.clone(),
        ),
        "receipt belongs to another actor",
    )?;
    require_unchanged(ctx, &fixture, &ids, &committed)?;
    let fresh = AddWorkflowHumanTaskCommentParams {
        expected_revision: commented.revision,
        comment: "Replacement quote requested".to_string(),
        idempotency_key: seeded.key("authority-next-comment"),
        correlation_id: seeded.key("authority-next-comment-correlation"),
        ..comment.clone()
    };
    exercise_revocations(
        ctx,
        &fixture,
        actor,
        foreign_company,
        Some(unrelated_role),
        &ids,
        || {
            for params in [comment.clone(), fresh.clone()] {
                require_denied(
                    add_workflow_human_task_comment_for_actor(
                        ctx,
                        fixture.organization_id,
                        actor,
                        params,
                    ),
                    "Permission denied",
                )?;
            }
            Ok(())
        },
    )?;
    add_workflow_human_task_comment_for_actor(ctx, fixture.organization_id, actor, comment)?;
    require_unchanged(ctx, &fixture, &ids, &committed)?;
    let updated =
        add_workflow_human_task_comment_for_actor(ctx, fixture.organization_id, actor, fresh)?;
    if updated.revision != 3 {
        return Err("restored candidate authority could not add a fresh comment".to_string());
    }
    Ok(())
}

/// Each probe must reject both an old receipt and a currently valid fresh command.
#[allow(clippy::too_many_arguments)]
fn exercise_revocations(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    actor: Identity,
    foreign_company: u64,
    unrelated_role: Option<u64>,
    task_ids: &[u64],
    mut probe: impl FnMut() -> Result<(), String>,
) -> Result<(), String> {
    let original = membership(ctx, fixture.organization_id, actor)?;
    let before = evidence(ctx, fixture, task_ids)?;
    let mut revoked = vec![
        UserOrganization {
            is_active: false,
            ..original.clone()
        },
        UserOrganization {
            company_id: Some(foreign_company),
            ..original.clone()
        },
    ];
    if let Some(role_id) = unrelated_role {
        revoked.push(UserOrganization {
            role_id,
            ..original.clone()
        });
    }
    for membership in revoked {
        ctx.db.user_organization().id().update(membership);
        let result = probe();
        ctx.db.user_organization().id().update(original.clone());
        result?;
        require_unchanged(ctx, fixture, task_ids, &before)?;
    }
    for (resource, action) in [
        ("workflow_task", PermissionAction::Write),
        ("purchase-orders", PermissionAction::Read),
    ] {
        let deny = ctx.db.org_permission().insert(OrgPermission {
            id: 0,
            organization_id: fixture.organization_id,
            subject: PermissionSubject::User(actor),
            role_id: None,
            resource: resource.to_string(),
            action,
            effect: PermissionEffect::Deny,
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
        });
        let result = probe();
        ctx.db.org_permission().id().delete(&deny.id);
        result?;
        require_unchanged(ctx, fixture, task_ids, &before)?;
    }
    Ok(())
}

fn seed_finance_task(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    candidate_role: u64,
) -> Result<SeededTask, String> {
    let seeded = seed_task_runtime(
        ctx,
        fixture,
        candidate_role,
        new_identity(ctx),
        WorkflowTaskAssignment::AnyCandidate,
        false,
        None,
    )?;
    let order = insert_draft_purchase_order(ctx, fixture, seeded.nonce)?;
    let task = ctx
        .db
        .workflow_human_task()
        .id()
        .find(&seeded.task_id)
        .ok_or("authority fixture task missing")?;
    let instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&task.workflow_instance_id)
        .ok_or("authority fixture instance missing")?;
    ctx.db.workflow_instance().id().update(WorkflowInstance {
        subject_model: "purchase_order".to_string(),
        subject_id: order.id,
        ..instance
    });
    ctx.db.workflow_human_task().id().update(WorkflowHumanTask {
        subject_model: "purchase_order".to_string(),
        subject_id: order.id,
        ..task
    });
    Ok(seeded)
}

fn seed_other_company(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    let original = ctx
        .db
        .company()
        .id()
        .find(&fixture.company_id)
        .ok_or("authority fixture company missing")?;
    let suffix = new_identity(ctx).to_hex().to_string();
    Ok(ctx
        .db
        .company()
        .insert(Company {
            id: 0,
            external_id: suffix.clone(),
            name: format!("Other authority company {suffix}"),
            code: format!("AUTH-{suffix}"),
            ..original
        })
        .id)
}

fn invalidation(fixture: &OrgFixture, seeded: &SeededTask) -> InvalidateWorkflowHumanTaskParams {
    InvalidateWorkflowHumanTaskParams {
        company_id: fixture.company_id,
        task_id: seeded.task_id,
        expected_revision: 1,
        observed_subject_revision_hash: CHANGED_REVISION.to_string(),
        reason: "Supplier quote has changed".to_string(),
        idempotency_key: seeded.key("authority-invalidate"),
        correlation_id: seeded.key("authority-invalidate-correlation"),
    }
}

fn membership(
    ctx: &ReducerContext,
    organization_id: u64,
    actor: Identity,
) -> Result<UserOrganization, String> {
    ctx.db
        .user_organization()
        .user_org_by_user()
        .filter(&actor)
        .find(|row| row.organization_id == organization_id)
        .ok_or("authority fixture membership missing".to_string())
}

#[derive(Debug, PartialEq)]
struct Evidence {
    tasks: Vec<serde_json::Value>,
    events: usize,
    receipts: usize,
    audits: usize,
    commits: usize,
}

fn evidence(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    task_ids: &[u64],
) -> Result<Evidence, String> {
    let mut tasks = Vec::new();
    let mut events = 0;
    let mut receipts = 0;
    for id in task_ids {
        let task = ctx
            .db
            .workflow_human_task()
            .id()
            .find(id)
            .ok_or("authority fixture task missing")?;
        tasks.push(
            serde_json::to_value(spacetimedb_sats::serde::SerdeWrapper::from_ref(&task))
                .map_err(|error| error.to_string())?,
        );
        let counts = task_evidence_counts(ctx, *id);
        events += counts.0;
        receipts += counts.1;
    }
    Ok(Evidence {
        tasks,
        events,
        receipts,
        audits: ctx
            .db
            .audit_log()
            .audit_by_org()
            .filter(&fixture.organization_id)
            .count(),
        commits: ctx
            .db
            .organization_commit()
            .organization_commit_by_organization()
            .filter(&fixture.organization_id)
            .count(),
    })
}

fn require_unchanged(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    task_ids: &[u64],
    expected: &Evidence,
) -> Result<(), String> {
    if &evidence(ctx, fixture, task_ids)? != expected {
        return Err(
            "task replay or authorization denial changed task/audit/durable evidence".to_string(),
        );
    }
    Ok(())
}

fn require_denied<T>(result: Result<T, String>, expected: &str) -> Result<(), String> {
    let error = result.err().ok_or("unauthorized task mutation succeeded")?;
    if !error.contains(expected) {
        return Err(format!(
            "expected authorization error '{expected}', got '{error}'"
        ));
    }
    Ok(())
}
