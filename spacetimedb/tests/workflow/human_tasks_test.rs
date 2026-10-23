//! Human-task authorization, concurrency, idempotency and rollback tests.

use std::time::Duration;

use spacetimedb::rand::Rng;
use spacetimedb::{Identity, ReducerContext, Table};

use crate::core::audit::audit_log;
use crate::core::organization::company;
use crate::core::permissions::{
    org_permission, role, sod_conflict_rule, user_role_assignment, OrgPermission, PermissionAction,
    PermissionEffect, PermissionSubject, Role, SodConflictRule, UserRoleAssignment,
};
use crate::core::persistence::{
    organization_commit, organization_row_change, OrganizationRowChange,
};
use crate::core::users::{
    find_user_profile_for_organization, user_organization, user_profile, UserOrganization,
    UserProfile,
};
use crate::purchasing::purchase_orders::{purchase_order, PurchaseOrder};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{PoInvoiceStatus, PoState};
use crate::workflow::action_registry::{
    GuardedActionInput, GuardedActionKey, GUARDED_ACTION_SCHEMA_VERSION,
};
use crate::workflow::approval_gate::{
    request_guarded_action, GuardedActionGateOutcome, RequestGuardedActionParams,
};
use crate::workflow::approvals::{
    add_workflow_human_task_comment_for_actor, claim_workflow_human_task_for_actor,
    create_workflow_human_task_internal, decide_workflow_human_task_for_actor,
    invalidate_workflow_human_task_internal, workflow_candidate_group_member, workflow_human_task,
    workflow_human_task_candidate, workflow_human_task_event, workflow_human_task_receipt,
    AddWorkflowHumanTaskCommentParams, ClaimWorkflowHumanTaskParams, CreateWorkflowHumanTaskParams,
    DecideWorkflowHumanTaskParams, InvalidateWorkflowHumanTaskParams, WorkflowCandidateGroupMember,
    WorkflowHumanTask, WorkflowHumanTaskDecision, WorkflowHumanTaskStatus,
    WorkflowTaskGuardedAction,
};
use crate::workflow::authorization::{
    insert_workflow_delegation, workflow_delegation, CreateWorkflowDelegationParams,
    WorkflowDelegation,
};
use crate::workflow::definitions::{
    create_workflow, publish_workflow_version, upsert_workflow_edge, upsert_workflow_node,
    workflow, workflow_edge, workflow_node, workflow_version, CreateWorkflowParams,
    UpsertWorkflowEdgeParams, UpsertWorkflowNodeParams, Workflow, WorkflowActionReference,
    WorkflowBranchKind, WorkflowEdge, WorkflowHumanTaskKind, WorkflowNode, WorkflowNodeKind,
    WorkflowTaskAssignment, WorkflowTaskPolicy, WorkflowTrigger, WorkflowVersion,
    WorkflowVersionStatus,
};
use crate::workflow::runtime::{
    cancel_workflow, workflow_command_receipt, workflow_decision_event, workflow_instance,
    workflow_token, CancelWorkflowParams, WorkflowInstance, WorkflowInstanceState, WorkflowToken,
    WorkflowTokenState,
};

const REVISION_A: &str = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REVISION_B: &str = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

pub fn test_workflow_human_tasks(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    gate_creates_and_converges_real_guarded_action(ctx)?;
    all_candidates_projects_base_and_supplemental_roles(ctx)?;
    all_candidates_rechecks_live_scopes_without_changing_quorum(ctx)?;
    claim_comment_decision_and_replay(ctx)?;
    claim_replay_rechecks_actor_and_current_authority(ctx)?;
    delegated_claim_and_decision_recheck_revocation_and_expiry(ctx)?;
    cancellation_closes_outstanding_tasks_without_rewriting_history(ctx)?;
    reject_requires_comment_and_invalidation_wins(ctx)?;
    authorization_is_rechecked_at_decision_time(ctx)?;
    guarded_action_failure_does_not_consume_task(ctx)?;
    Ok(())
}

fn all_candidates_projects_base_and_supplemental_roles(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let candidate_role = seed_role(ctx, fixture.organization_id, vec!["workflow_task:approve"]);
    let member_role = seed_role(ctx, fixture.organization_id, Vec::new());
    let base_candidate = seed_member(ctx, &fixture, candidate_role, None);
    let supplemental_candidate = seed_member(ctx, &fixture, member_role, None);
    let expired_candidate = seed_member(ctx, &fixture, member_role, None);
    ctx.db.user_role_assignment().insert(UserRoleAssignment {
        id: 0,
        user_identity: supplemental_candidate,
        role_id: candidate_role,
        organization_id: fixture.organization_id,
        assigned_by: ctx.sender(),
        assigned_at: ctx.timestamp,
        expires_at: None,
        is_active: true,
        metadata: Some(r#"{"test":"human-task"}"#.to_string()),
    });
    ctx.db.user_role_assignment().insert(UserRoleAssignment {
        id: 0,
        user_identity: expired_candidate,
        role_id: candidate_role,
        organization_id: fixture.organization_id,
        assigned_by: ctx.sender(),
        assigned_at: ctx.timestamp,
        expires_at: Some(ctx.timestamp),
        is_active: true,
        metadata: Some(r#"{"test":"expired-human-task"}"#.to_string()),
    });

    let seeded = seed_task_runtime(
        ctx,
        &fixture,
        candidate_role,
        new_identity(ctx),
        WorkflowTaskAssignment::AllCandidates,
        false,
        None,
    )?;
    let projected: Vec<_> = ctx
        .db
        .workflow_human_task_candidate()
        .human_task_candidate_by_task()
        .filter(&seeded.task_id)
        .map(|candidate| candidate.candidate_identity)
        .collect();
    if projected.len() != 2
        || !projected.contains(&base_candidate)
        || !projected.contains(&supplemental_candidate)
    {
        return Err("AllCandidates did not project base and supplemental roles".to_string());
    }
    Ok(())
}

fn all_candidates_rechecks_live_scopes_without_changing_quorum(
    ctx: &ReducerContext,
) -> Result<(), String> {
    for scope in ["role", "group", "department"] {
        let fixture = OrgFixture::seed_minimal(ctx)?;
        let role_id = seed_role(ctx, fixture.organization_id, vec!["workflow_task:approve"]);
        let other_role = seed_role(ctx, fixture.organization_id, vec!["workflow_task:approve"]);
        let scope_id = ctx.rng().gen::<u64>();
        let department = (scope == "department").then_some(scope_id);
        let removed = seed_member(ctx, &fixture, role_id, department);
        let retained = seed_member(ctx, &fixture, role_id, department);
        let group_member = if scope == "group" {
            seed_candidate_group_member(ctx, &fixture, scope_id, retained);
            Some(seed_candidate_group_member(
                ctx, &fixture, scope_id, removed,
            ))
        } else {
            None
        };
        let seeded = seed_task_runtime_with_policy(
            ctx,
            &fixture,
            new_identity(ctx),
            WorkflowTaskPolicy {
                kind: WorkflowHumanTaskKind::ApproveReject,
                assignment: WorkflowTaskAssignment::AllCandidates,
                candidate_role_ids: if scope == "role" {
                    vec![role_id]
                } else {
                    Vec::new()
                },
                candidate_group_ids: if scope == "group" {
                    vec![scope_id]
                } else {
                    Vec::new()
                },
                candidate_unit_ids: if scope == "department" {
                    vec![scope_id]
                } else {
                    Vec::new()
                },
                require_comment_on_reject: false,
            },
            None,
        )?;
        let membership = ctx
            .db
            .user_organization()
            .user_org_by_user()
            .filter(&removed)
            .find(|row| row.organization_id == fixture.organization_id)
            .ok_or("candidate membership missing")?;
        match scope {
            "role" => {
                ctx.db.user_organization().id().update(UserOrganization {
                    role_id: other_role,
                    ..membership
                });
            }
            "group" => {
                let group_member = group_member.ok_or("candidate group membership missing")?;
                ctx.db.workflow_candidate_group_member().id().update(
                    WorkflowCandidateGroupMember {
                        is_active: false,
                        ..group_member
                    },
                );
            }
            "department" => {
                ctx.db.user_organization().id().update(UserOrganization {
                    department_id: None,
                    ..membership
                });
            }
            _ => return Err("unknown candidate scope fixture".to_string()),
        }

        let before = task_evidence_counts(ctx, seeded.task_id);
        let denied = decide_workflow_human_task_for_actor(
            ctx,
            fixture.organization_id,
            removed,
            decision(&fixture, &seeded, WorkflowHumanTaskDecision::Approve, None),
        )
        .err()
        .ok_or_else(|| format!("removed {scope} candidate retained decision authority"))?;
        assert_contains(&denied, "candidate scopes")?;
        if task_evidence_counts(ctx, seeded.task_id) != before {
            return Err(format!("removed {scope} candidate changed task evidence"));
        }

        let partial = decide_workflow_human_task_for_actor(
            ctx,
            fixture.organization_id,
            retained,
            decision(&fixture, &seeded, WorkflowHumanTaskDecision::Approve, None),
        )?;
        let projection: Vec<_> = ctx
            .db
            .workflow_human_task_candidate()
            .human_task_candidate_by_task()
            .filter(&seeded.task_id)
            .collect();
        let instance = ctx
            .db
            .workflow_instance()
            .id()
            .find(&partial.workflow_instance_id)
            .ok_or("AllCandidates instance missing")?;
        if projection.len() != 2
            || !projection.iter().any(|candidate| {
                candidate.candidate_identity == removed && candidate.decision.is_none()
            })
            || partial.status != WorkflowHumanTaskStatus::Open
            || partial.revision != 2
            || instance.revision != 1
            || instance.state != WorkflowInstanceState::Active
        {
            return Err(format!(
                "removing {scope} silently changed the frozen quorum"
            ));
        }

        let late_candidate = seed_member(ctx, &fixture, role_id, department);
        if scope == "group" {
            seed_candidate_group_member(ctx, &fixture, scope_id, late_candidate);
        }
        let late = decide_workflow_human_task_for_actor(
            ctx,
            fixture.organization_id,
            late_candidate,
            DecideWorkflowHumanTaskParams {
                expected_task_revision: partial.revision,
                idempotency_key: seeded.key("late-candidate"),
                ..decision(&fixture, &seeded, WorkflowHumanTaskDecision::Approve, None)
            },
        )
        .err()
        .ok_or("a new candidate outside the frozen roster cast a vote")?;
        assert_contains(&late, "AllCandidates projection")?;
    }
    Ok(())
}

fn gate_creates_and_converges_real_guarded_action(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let role_id = seed_role(
        ctx,
        fixture.organization_id,
        vec![
            "workflow_task:approve",
            "workflow_task:reject",
            "purchase_order:read",
        ],
    );
    let actor = seed_member(ctx, &fixture, role_id, None);
    let nonce = ctx.rng().gen::<u64>();
    let workflow_key = format!("po-send-approval-{nonce}");
    create_workflow(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        CreateWorkflowParams {
            workflow_key: workflow_key.clone(),
            model: "purchase_order".to_string(),
            name: "PO send approval".to_string(),
            description: None,
            trigger: WorkflowTrigger::Manual,
            schema_version: 1,
            snapshot_fields: Vec::new(),
            metadata: None,
        },
    )?;
    let definition = ctx
        .db
        .workflow()
        .workflow_by_key()
        .filter(&workflow_key)
        .find(|workflow| workflow.organization_id == fixture.organization_id)
        .ok_or("gate test workflow missing")?;
    let version = ctx
        .db
        .workflow_version()
        .workflow_version_by_workflow()
        .filter(&definition.id)
        .find(|version| version.version == 1)
        .ok_or("gate test workflow version missing")?;
    let nodes = [
        definition_node("start", WorkflowNodeKind::Start, 1, None, None),
        definition_node(
            "approve",
            WorkflowNodeKind::HumanTask,
            2,
            Some(WorkflowTaskPolicy {
                kind: WorkflowHumanTaskKind::ApproveReject,
                assignment: WorkflowTaskAssignment::AllCandidates,
                candidate_role_ids: vec![role_id],
                candidate_group_ids: Vec::new(),
                candidate_unit_ids: Vec::new(),
                require_comment_on_reject: true,
            }),
            None,
        ),
        definition_node(
            "send",
            WorkflowNodeKind::Action,
            3,
            None,
            Some(WorkflowActionReference {
                action_key: GuardedActionKey::SendPurchaseOrder.as_str().to_string(),
                input_schema_version: GUARDED_ACTION_SCHEMA_VERSION,
                input: Vec::new(),
            }),
        ),
        definition_node("done", WorkflowNodeKind::End, 4, None, None),
        definition_node("rejected", WorkflowNodeKind::End, 5, None, None),
    ];
    let mut revision = version.draft_revision;
    for node in nodes {
        upsert_workflow_node(ctx, fixture.organization_id, version.id, revision, node)?;
        revision += 1;
    }
    for edge in [
        definition_edge("start-approve", "start", "approve", 1, None),
        definition_edge("approve-send", "approve", "send", 2, Some("approved")),
        definition_edge(
            "approve-rejected",
            "approve",
            "rejected",
            3,
            Some("rejected"),
        ),
        definition_edge("send-done", "send", "done", 4, None),
    ] {
        upsert_workflow_edge(ctx, fixture.organization_id, version.id, revision, edge)?;
        revision += 1;
    }
    publish_workflow_version(ctx, fixture.organization_id, version.id, revision)?;

    let order = insert_draft_purchase_order(ctx, &fixture, nonce)?;
    let request = RequestGuardedActionParams {
        company_id: fixture.company_id,
        action: GuardedActionKey::SendPurchaseOrder,
        action_version: GUARDED_ACTION_SCHEMA_VERSION,
        input: GuardedActionInput::SendPurchaseOrder { order_id: order.id },
        idempotency_key: format!("gate-{nonce}"),
        correlation_id: format!("gate-correlation-{nonce}"),
        causation_id: None,
    };
    let outcome = request_guarded_action(ctx, fixture.organization_id, request.clone())?;
    let (mut instance_id, mut task_id) = match outcome {
        GuardedActionGateOutcome::HumanTaskCreated {
            workflow_instance_id,
            task_id,
            ..
        } => (workflow_instance_id, task_id),
        GuardedActionGateOutcome::DirectExecutionAllowed { .. } => {
            return Err("matching published workflow did not create a task".to_string())
        }
    };
    let replay = request_guarded_action(ctx, fixture.organization_id, request.clone())?;
    if !matches!(
        replay,
        GuardedActionGateOutcome::HumanTaskCreated {
            workflow_instance_id,
            task_id: replay_task_id,
            ..
        } if workflow_instance_id == instance_id && replay_task_id == task_id
    ) {
        return Err("guarded request replay did not return the original task".to_string());
    }
    let source_deny = ctx.db.org_permission().insert(OrgPermission {
        id: 0,
        organization_id: fixture.organization_id,
        subject: PermissionSubject::User(actor),
        role_id: None,
        resource: "purchase-orders".to_string(),
        action: PermissionAction::Read,
        effect: PermissionEffect::Deny,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
    });
    let evidence_before_denial = task_evidence_counts(ctx, task_id);
    let source_denied = decide_workflow_human_task_for_actor(
        ctx,
        fixture.organization_id,
        actor,
        DecideWorkflowHumanTaskParams {
            company_id: fixture.company_id,
            task_id,
            expected_task_revision: 1,
            expected_instance_revision: 2,
            decision: WorkflowHumanTaskDecision::Approve,
            acting_for: None,
            comment: None,
            idempotency_key: format!("source-denied-{nonce}"),
            correlation_id: format!("source-denied-correlation-{nonce}"),
            causation_id: None,
        },
    )
    .err()
    .ok_or("workflow approval bypassed revoked Finance source read")?;
    assert_contains(&source_denied, "source read permission denied")?;
    let unvoted = ctx
        .db
        .workflow_human_task_candidate()
        .human_task_candidate_by_task()
        .filter(&task_id)
        .all(|candidate| candidate.decision.is_none());
    let unchanged_task = ctx
        .db
        .workflow_human_task()
        .id()
        .find(&task_id)
        .ok_or("source-denied task missing")?;
    let unchanged_order = ctx
        .db
        .purchase_order()
        .id()
        .find(&order.id)
        .ok_or("source-denied purchase order missing")?;
    if !unvoted
        || unchanged_task.revision != 1
        || unchanged_task.status != WorkflowHumanTaskStatus::Open
        || unchanged_order.state != PoState::Draft
        || task_evidence_counts(ctx, task_id) != evidence_before_denial
    {
        return Err("source read denial changed the vote, task, source or evidence".to_string());
    }
    ctx.db.org_permission().id().delete(&source_deny.id);
    let current = ctx
        .db
        .purchase_order()
        .id()
        .find(&order.id)
        .ok_or("order missing")?;
    ctx.db.purchase_order().id().update(PurchaseOrder {
        partner_ref: Some("new vendor quote requiring fresh approval".to_string()),
        ..current
    });
    let events_before_rejection = ctx
        .db
        .workflow_human_task_event()
        .human_task_event_by_task()
        .filter(&task_id)
        .count();
    let receipts_before_rejection = ctx
        .db
        .workflow_human_task_receipt()
        .human_task_receipt_by_task()
        .filter(&task_id)
        .count();
    let stale_rejection = decide_workflow_human_task_for_actor(
        ctx,
        fixture.organization_id,
        actor,
        DecideWorkflowHumanTaskParams {
            company_id: fixture.company_id,
            task_id,
            expected_task_revision: 1,
            expected_instance_revision: 2,
            decision: WorkflowHumanTaskDecision::Reject,
            acting_for: None,
            comment: Some("reject stale quote".to_string()),
            idempotency_key: format!("stale-gate-rejection-{nonce}"),
            correlation_id: format!("stale-gate-rejection-correlation-{nonce}"),
            causation_id: None,
        },
    )
    .err()
    .ok_or("changed vendor quote was rejected through the stale task")?;
    assert_contains(&stale_rejection, "subject changed")?;
    let stale_candidate = ctx
        .db
        .workflow_human_task_candidate()
        .human_task_candidate_by_task()
        .filter(&task_id)
        .find(|candidate| candidate.candidate_identity == actor)
        .ok_or("guarded AllCandidates actor projection missing")?;
    let stale_task = ctx
        .db
        .workflow_human_task()
        .id()
        .find(&task_id)
        .ok_or("stale guarded task missing")?;
    if stale_task.status != WorkflowHumanTaskStatus::Open
        || stale_task.revision != 1
        || stale_candidate.decision.is_some()
        || ctx
            .db
            .workflow_human_task_event()
            .human_task_event_by_task()
            .filter(&task_id)
            .count()
            != events_before_rejection
        || ctx
            .db
            .workflow_human_task_receipt()
            .human_task_receipt_by_task()
            .filter(&task_id)
            .count()
            != receipts_before_rejection
    {
        return Err("stale guarded rejection recorded evidence or closed its task".to_string());
    }
    let old_error = decide_workflow_human_task_for_actor(
        ctx,
        fixture.organization_id,
        actor,
        DecideWorkflowHumanTaskParams {
            company_id: fixture.company_id,
            task_id,
            expected_task_revision: 1,
            expected_instance_revision: 2,
            decision: WorkflowHumanTaskDecision::Approve,
            acting_for: None,
            comment: Some("stale quote".to_string()),
            idempotency_key: format!("stale-gate-decision-{nonce}"),
            correlation_id: format!("stale-gate-correlation-{nonce}"),
            causation_id: None,
        },
    )
    .err()
    .ok_or("changed vendor quote consumed the old task")?;
    assert_contains(&old_error, "subject changed")?;
    let old_task = ctx
        .db
        .workflow_human_task()
        .id()
        .find(&task_id)
        .ok_or("old task missing")?;
    if old_task.status != WorkflowHumanTaskStatus::Open || old_task.revision != 1 {
        return Err("stale approval consumed its task".to_string());
    }
    match request_guarded_action(ctx, fixture.organization_id, request)? {
        GuardedActionGateOutcome::HumanTaskCreated {
            workflow_instance_id,
            task_id: fresh_task,
            ..
        } if workflow_instance_id != instance_id && fresh_task != task_id => {
            instance_id = workflow_instance_id;
            task_id = fresh_task;
        }
        _ => return Err("revised subject did not receive a fresh approval task".to_string()),
    }
    decide_workflow_human_task_for_actor(
        ctx,
        fixture.organization_id,
        actor,
        DecideWorkflowHumanTaskParams {
            company_id: fixture.company_id,
            task_id,
            expected_task_revision: 1,
            expected_instance_revision: 2,
            decision: WorkflowHumanTaskDecision::Approve,
            acting_for: None,
            comment: Some("approved for test".to_string()),
            idempotency_key: format!("gate-decision-{nonce}"),
            correlation_id: format!("gate-decision-correlation-{nonce}"),
            causation_id: None,
        },
    )?;
    let sent = ctx
        .db
        .purchase_order()
        .id()
        .find(&order.id)
        .ok_or("approved purchase order missing")?;
    let instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&instance_id)
        .ok_or("approved workflow instance missing")?;
    if sent.state != PoState::Sent
        || instance.state != WorkflowInstanceState::Completed
        || instance.revision != 4
    {
        return Err("guarded approval did not converge action and runtime atomically".to_string());
    }
    Ok(())
}

fn claim_comment_decision_and_replay(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let role_id = seed_role(
        ctx,
        fixture.organization_id,
        vec![
            "workflow_task:write",
            "workflow_task:approve",
            "workflow_task:reject",
            "workflow_task:complete",
        ],
    );
    let actor = seed_member(ctx, &fixture, role_id, None);
    let requester = new_identity(ctx);
    let seeded = seed_task_runtime(
        ctx,
        &fixture,
        role_id,
        requester,
        WorkflowTaskAssignment::SingleCandidate,
        false,
        None,
    )?;

    let claim = ClaimWorkflowHumanTaskParams {
        company_id: fixture.company_id,
        task_id: seeded.task_id,
        expected_revision: 1,
        acting_for: None,
        idempotency_key: seeded.key("claim"),
        correlation_id: seeded.key("claim-correlation"),
    };
    let claimed =
        claim_workflow_human_task_for_actor(ctx, fixture.organization_id, actor, claim.clone())?;
    if claimed.status != WorkflowHumanTaskStatus::Claimed || claimed.revision != 2 {
        return Err("claim did not advance the task exactly once".to_string());
    }
    let replayed =
        claim_workflow_human_task_for_actor(ctx, fixture.organization_id, actor, claim.clone())?;
    if replayed.revision != 2 {
        return Err("identical claim replay changed task state".to_string());
    }
    let race = claim_workflow_human_task_for_actor(
        ctx,
        fixture.organization_id,
        actor,
        ClaimWorkflowHumanTaskParams {
            idempotency_key: seeded.key("second-claim"),
            ..claim.clone()
        },
    )
    .err()
    .ok_or("a second claimant won with the stale revision")?;
    assert_contains(&race, "stale")?;
    let changed_replay = claim_workflow_human_task_for_actor(
        ctx,
        fixture.organization_id,
        actor,
        ClaimWorkflowHumanTaskParams {
            expected_revision: 2,
            ..claim
        },
    )
    .err()
    .ok_or("claim idempotency key accepted changed input")?;
    assert_contains(&changed_replay, "different input")?;

    let comment = AddWorkflowHumanTaskCommentParams {
        company_id: fixture.company_id,
        task_id: seeded.task_id,
        expected_revision: 2,
        comment: "Evidence checked".to_string(),
        idempotency_key: seeded.key("comment"),
        correlation_id: seeded.key("comment-correlation"),
    };
    add_workflow_human_task_comment_for_actor(
        ctx,
        fixture.organization_id,
        actor,
        comment.clone(),
    )?;
    add_workflow_human_task_comment_for_actor(ctx, fixture.organization_id, actor, comment)?;

    let decided = decide_workflow_human_task_for_actor(
        ctx,
        fixture.organization_id,
        actor,
        DecideWorkflowHumanTaskParams {
            company_id: fixture.company_id,
            task_id: seeded.task_id,
            expected_task_revision: 3,
            expected_instance_revision: 1,
            decision: WorkflowHumanTaskDecision::Approve,
            acting_for: None,
            comment: Some("Approved".to_string()),
            idempotency_key: seeded.key("approve"),
            correlation_id: seeded.key("approve-correlation"),
            causation_id: None,
        },
    )?;
    if decided.status != WorkflowHumanTaskStatus::Approved || decided.revision != 4 {
        return Err("approval did not consume the task exactly once".to_string());
    }
    Ok(())
}

fn claim_replay_rechecks_actor_and_current_authority(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let role_id = seed_role(
        ctx,
        fixture.organization_id,
        vec!["workflow_task:write", "workflow_task:approve"],
    );
    let actor = seed_member(ctx, &fixture, role_id, None);
    let other_actor = seed_member(ctx, &fixture, role_id, None);
    let seeded = seed_task_runtime(
        ctx,
        &fixture,
        role_id,
        new_identity(ctx),
        WorkflowTaskAssignment::AnyCandidate,
        false,
        None,
    )?;
    let claim = ClaimWorkflowHumanTaskParams {
        company_id: fixture.company_id,
        task_id: seeded.task_id,
        expected_revision: 1,
        acting_for: None,
        idempotency_key: seeded.key("claim"),
        correlation_id: seeded.key("claim-correlation"),
    };
    claim_workflow_human_task_for_actor(ctx, fixture.organization_id, actor, claim.clone())?;
    let evidence = task_evidence_counts(ctx, seeded.task_id);
    let wrong_actor = claim_workflow_human_task_for_actor(
        ctx,
        fixture.organization_id,
        other_actor,
        claim.clone(),
    )
    .err()
    .ok_or("another eligible actor replayed the original claim receipt")?;
    assert_contains(&wrong_actor, "receipt belongs to another actor")?;

    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&actor)
        .find(|row| row.organization_id == fixture.organization_id)
        .ok_or("claimant membership missing")?;
    ctx.db.user_organization().id().update(UserOrganization {
        is_active: false,
        ..membership.clone()
    });
    let revoked =
        claim_workflow_human_task_for_actor(ctx, fixture.organization_id, actor, claim.clone())
            .err()
            .ok_or("inactive claimant replayed a successful claim")?;
    assert_contains(&revoked, "Permission denied")?;
    ctx.db.user_organization().id().update(membership);

    let current_role = ctx
        .db
        .role()
        .id()
        .find(&role_id)
        .ok_or("claimant role missing")?;
    ctx.db.role().id().update(Role {
        permissions: vec!["workflow_task:approve".to_string()],
        ..current_role.clone()
    });
    let lost_permission =
        claim_workflow_human_task_for_actor(ctx, fixture.organization_id, actor, claim.clone())
            .err()
            .ok_or("claim replay bypassed revoked write permission")?;
    assert_contains(&lost_permission, "workflow_task:write")?;
    ctx.db.role().id().update(current_role);
    let replayed =
        claim_workflow_human_task_for_actor(ctx, fixture.organization_id, actor, claim.clone())?;
    if replayed.revision != 2
        || replayed.claimed_by != Some(actor)
        || task_evidence_counts(ctx, seeded.task_id) != evidence
    {
        return Err(
            "claim replay authorization changed the canonical claim or evidence".to_string(),
        );
    }

    let terminal = decide_workflow_human_task_for_actor(
        ctx,
        fixture.organization_id,
        actor,
        DecideWorkflowHumanTaskParams {
            expected_task_revision: 2,
            ..decision(&fixture, &seeded, WorkflowHumanTaskDecision::Approve, None)
        },
    )?;
    let terminal_evidence = task_evidence_counts(ctx, seeded.task_id);
    let replayed = claim_workflow_human_task_for_actor(ctx, fixture.organization_id, actor, claim)?;
    if replayed.status != WorkflowHumanTaskStatus::Approved
        || replayed.revision != terminal.revision
        || task_evidence_counts(ctx, seeded.task_id) != terminal_evidence
    {
        return Err("authorized claim replay failed after the task advanced".to_string());
    }
    Ok(())
}

fn delegated_claim_and_decision_recheck_revocation_and_expiry(
    ctx: &ReducerContext,
) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let approver_role = seed_role(
        ctx,
        fixture.organization_id,
        vec!["workflow_task:write", "workflow_task:approve"],
    );
    let member_role = seed_role(ctx, fixture.organization_id, Vec::new());
    let principal = seed_member(ctx, &fixture, approver_role, None);
    let actor = seed_member(ctx, &fixture, member_role, None);
    let delegation = insert_workflow_delegation(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateWorkflowDelegationParams {
            delegator_identity: principal,
            delegatee_identity: actor,
            role_id: Some(approver_role),
            valid_from: ctx.timestamp - Duration::from_secs(1),
            valid_until: ctx.timestamp + Duration::from_secs(300),
            reason: Some("human-task revocation regression".to_string()),
        },
        ctx.sender(),
    )?;
    let seeded = seed_task_runtime(
        ctx,
        &fixture,
        approver_role,
        new_identity(ctx),
        WorkflowTaskAssignment::SingleCandidate,
        false,
        None,
    )?;
    let claim = ClaimWorkflowHumanTaskParams {
        company_id: fixture.company_id,
        task_id: seeded.task_id,
        expected_revision: 1,
        acting_for: Some(principal),
        idempotency_key: seeded.key("delegated-claim"),
        correlation_id: seeded.key("delegated-claim-correlation"),
    };
    claim_workflow_human_task_for_actor(ctx, fixture.organization_id, actor, claim.clone())?;
    let params = DecideWorkflowHumanTaskParams {
        expected_task_revision: 2,
        acting_for: Some(principal),
        ..decision(&fixture, &seeded, WorkflowHumanTaskDecision::Approve, None)
    };
    let before = task_evidence_counts(ctx, seeded.task_id);
    for expired in [false, true] {
        ctx.db
            .workflow_delegation()
            .id()
            .update(WorkflowDelegation {
                is_active: expired,
                valid_until: if expired {
                    ctx.timestamp
                } else {
                    delegation.valid_until
                },
                ..delegation.clone()
            });
        let claim_error =
            claim_workflow_human_task_for_actor(ctx, fixture.organization_id, actor, claim.clone())
                .err()
                .ok_or("revoked or expired delegate replayed a claim")?;
        assert_contains(&claim_error, "no effective workflow delegation")?;
        let decision_error = decide_workflow_human_task_for_actor(
            ctx,
            fixture.organization_id,
            actor,
            params.clone(),
        )
        .err()
        .ok_or("revoked or expired delegate decided a claimed task")?;
        assert_contains(&decision_error, "no effective workflow delegation")?;
        let task = ctx
            .db
            .workflow_human_task()
            .id()
            .find(&seeded.task_id)
            .ok_or("delegated task missing")?;
        if task.status != WorkflowHumanTaskStatus::Claimed
            || task.revision != 2
            || task_evidence_counts(ctx, seeded.task_id) != before
        {
            return Err("denied delegated request changed task state or evidence".to_string());
        }
    }
    ctx.db.workflow_delegation().id().update(delegation.clone());
    claim_workflow_human_task_for_actor(ctx, fixture.organization_id, actor, claim)?;
    let decided =
        decide_workflow_human_task_for_actor(ctx, fixture.organization_id, actor, params.clone())?;
    if decided.decided_by != Some(actor) || decided.acting_for != Some(principal) {
        return Err("delegated decision lost actual actor or principal".to_string());
    }
    let after = task_evidence_counts(ctx, seeded.task_id);
    ctx.db
        .workflow_delegation()
        .id()
        .update(WorkflowDelegation {
            is_active: false,
            ..delegation
        });
    let replay_error =
        decide_workflow_human_task_for_actor(ctx, fixture.organization_id, actor, params)
            .err()
            .ok_or("revoked delegation replayed a terminal decision")?;
    assert_contains(&replay_error, "no effective workflow delegation")?;
    if task_evidence_counts(ctx, seeded.task_id) != after {
        return Err("revoked decision replay changed canonical evidence".to_string());
    }
    Ok(())
}

fn cancellation_closes_outstanding_tasks_without_rewriting_history(
    ctx: &ReducerContext,
) -> Result<(), String> {
    for all_candidates in [false, true] {
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
        let other_candidate = seed_member(ctx, &fixture, role_id, None);
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
        let order = insert_draft_purchase_order(ctx, &fixture, seeded.nonce)?;
        let source_instance = ctx
            .db
            .workflow_instance()
            .id()
            .find(&history.workflow_instance_id)
            .ok_or("cancellation source instance missing")?;
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
        for task in source_tasks {
            ctx.db.workflow_human_task().id().update(WorkflowHumanTask {
                subject_model: "purchase_order".to_string(),
                subject_id: order.id,
                ..task
            });
        }
        let current = if all_candidates {
            decide_workflow_human_task_for_actor(
                ctx,
                fixture.organization_id,
                actor,
                DecideWorkflowHumanTaskParams {
                    expected_instance_revision: 2,
                    ..decision(&fixture, &seeded, WorkflowHumanTaskDecision::Approve, None)
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
                    idempotency_key: seeded.key("claim"),
                    correlation_id: seeded.key("claim-correlation"),
                },
            )?
        };
        let votes = candidate_decisions(ctx, current.id);
        let task_evidence = task_evidence_counts(ctx, current.id);
        let history_evidence = task_evidence_counts(ctx, history.id);
        let cancel = CancelWorkflowParams {
            company_id: fixture.company_id,
            instance_id: current.workflow_instance_id,
            expected_revision: 2,
            reason: "recover work after reviewer authority changed".to_string(),
            idempotency_key: seeded.key("cancel"),
            correlation_id: seeded.key("cancel-correlation"),
            causation_id: None,
        };
        let commit_count = || {
            ctx.db
                .organization_commit()
                .organization_commit_by_org()
                .filter(&fixture.organization_id)
                .count()
        };
        let previous_commit_count = commit_count();
        cancel_workflow(ctx, fixture.organization_id, cancel.clone())?;
        let cancelled = ctx
            .db
            .workflow_human_task()
            .id()
            .find(&current.id)
            .ok_or("cancelled task missing")?;
        let preserved = ctx
            .db
            .workflow_human_task()
            .id()
            .find(&history.id)
            .ok_or("successful task history missing")?;
        if cancelled.status != WorkflowHumanTaskStatus::Cancelled
            || cancelled.revision != current.revision + 1
            || cancelled.claimed_by != current.claimed_by
            || candidate_decisions(ctx, current.id) != votes
            || task_evidence_counts(ctx, current.id) != task_evidence
            || preserved.status != WorkflowHumanTaskStatus::Approved
            || preserved.revision != history.revision
            || preserved.decided_by != history.decided_by
            || task_evidence_counts(ctx, history.id) != history_evidence
        {
            return Err(
                "cancellation left active work or rewrote successful history/votes/receipts"
                    .to_string(),
            );
        }
        if commit_count() != previous_commit_count + 1 {
            return Err("ordinary cancellation must record one durable commit".to_string());
        }
        assert_cancellation_commit(ctx, &cancelled, &preserved, &order, &cancel.correlation_id)?;
        let audit_count = || {
            ctx.db
                .audit_log()
                .audit_by_org()
                .filter(&fixture.organization_id)
                .filter(|row| {
                    row.table_name == "workflow_human_task"
                        && row.record_id == current.id
                        && row.action == "CANCEL"
                })
                .count()
        };
        if audit_count() != 1 {
            return Err("task cancellation did not create one linked audit entry".to_string());
        }
        let runtime_counts = cancellation_evidence_counts(ctx, current.workflow_instance_id);
        cancel_workflow(ctx, fixture.organization_id, cancel.clone())?;
        if audit_count() != 1
            || commit_count() != previous_commit_count + 1
            || cancellation_evidence_counts(ctx, current.workflow_instance_id) != runtime_counts
            || ctx
                .db
                .workflow_human_task()
                .id()
                .find(&current.id)
                .is_none_or(|task| task.revision != cancelled.revision)
        {
            return Err("cancel receipt replay duplicated task or runtime effects".to_string());
        }

        let owner_membership = ctx
            .db
            .user_organization()
            .user_org_by_user()
            .filter(&ctx.sender())
            .find(|row| row.organization_id == fixture.organization_id)
            .ok_or("cancellation operator membership missing")?;
        ctx.db.user_organization().id().update(UserOrganization {
            is_active: false,
            ..owner_membership.clone()
        });
        cancel_workflow(ctx, fixture.organization_id, cancel.clone())
            .err()
            .ok_or("inactive operator replayed a cancellation")?;
        ctx.db.user_organization().id().update(owner_membership);

        let profile =
            find_user_profile_for_organization(ctx, ctx.sender(), fixture.organization_id)
                .ok_or("cancellation operator profile missing")?;
        let profile_id = profile.id;
        let was_superuser = profile.is_superuser;
        ctx.db.user_profile().id().update(UserProfile {
            is_superuser: false,
            ..profile
        });
        let deny = ctx.db.org_permission().insert(OrgPermission {
            id: 0,
            organization_id: fixture.organization_id,
            subject: PermissionSubject::User(ctx.sender()),
            role_id: None,
            resource: "workflow_instance".to_string(),
            action: PermissionAction::Write,
            effect: PermissionEffect::Deny,
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
        });
        let denied = cancel_workflow(ctx, fixture.organization_id, cancel)
            .err()
            .ok_or("revoked workflow writer replayed a cancellation")?;
        assert_contains(&denied, "Permission denied")?;
        ctx.db.org_permission().id().delete(&deny.id);
        let profile = ctx
            .db
            .user_profile()
            .id()
            .find(&profile_id)
            .ok_or("cancellation operator profile disappeared")?;
        ctx.db.user_profile().id().update(UserProfile {
            is_superuser: was_superuser,
            ..profile
        });

        let denied = decide_workflow_human_task_for_actor(
            ctx,
            fixture.organization_id,
            if all_candidates {
                other_candidate
            } else {
                actor
            },
            DecideWorkflowHumanTaskParams {
                expected_task_revision: cancelled.revision,
                expected_instance_revision: 3,
                idempotency_key: seeded.key("after-cancel"),
                ..decision(&fixture, &seeded, WorkflowHumanTaskDecision::Approve, None)
            },
        )
        .err()
        .ok_or("old reviewer decided a cancelled human task")?;
        assert_contains(&denied, "not open")?;
        if audit_count() != 1
            || commit_count() != previous_commit_count + 1
            || cancellation_evidence_counts(ctx, current.workflow_instance_id) != runtime_counts
            || candidate_decisions(ctx, current.id) != votes
            || task_evidence_counts(ctx, current.id) != task_evidence
        {
            return Err("denied cancellation replay or late decision changed evidence".to_string());
        }
    }
    Ok(())
}

fn assert_cancellation_commit(
    ctx: &ReducerContext,
    cancelled: &WorkflowHumanTask,
    preserved: &WorkflowHumanTask,
    source: &PurchaseOrder,
    correlation_id: &str,
) -> Result<(), String> {
    let commits: Vec<_> = ctx
        .db
        .organization_commit()
        .organization_commit_by_org()
        .filter(&cancelled.organization_id)
        .filter(|row| {
            row.operation_id == "erp.cancel_workflow" && row.correlation_id == correlation_id
        })
        .collect();
    if commits.len() != 1 || commits[0].actor_identity != ctx.sender() {
        return Err(
            "cancellation durable envelope is missing, duplicated or misattributed".to_string(),
        );
    }
    let commit = &commits[0];
    let changes: Vec<_> = ctx
        .db
        .organization_row_change()
        .organization_row_change_by_commit()
        .filter(&cancelled.organization_id)
        .filter(|change| change.commit_sequence == commit.sequence)
        .collect();
    if changes.len() != commit.row_change_count as usize
        || changes.iter().any(|change| change.change_kind != "upsert")
    {
        return Err("cancellation durable commit is incomplete or destructive".to_string());
    }
    assert_committed_row(&changes, "workflow_human_task", cancelled)?;
    assert_committed_row(&changes, "workflow_human_task", preserved)?;
    assert_committed_row(&changes, "purchase_order", source)?;
    let instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&cancelled.workflow_instance_id)
        .ok_or("cancelled instance missing")?;
    assert_committed_row(&changes, "workflow_instance", &instance)?;
    for token in ctx
        .db
        .workflow_token()
        .workflow_token_by_instance()
        .filter(&instance.id)
    {
        if token.state == WorkflowTokenState::Active {
            return Err("cancellation retained an active runtime token".to_string());
        }
        assert_committed_row(&changes, "workflow_token", &token)?;
    }
    for event in ctx
        .db
        .workflow_decision_event()
        .workflow_event_by_instance()
        .filter(&instance.id)
    {
        assert_committed_row(&changes, "workflow_decision_event", &event)?;
    }
    for receipt in ctx
        .db
        .workflow_command_receipt()
        .workflow_receipt_by_instance()
        .filter(&instance.id)
    {
        assert_committed_row(&changes, "workflow_command_receipt", &receipt)?;
    }
    for task_id in [cancelled.id, preserved.id] {
        for candidate in ctx
            .db
            .workflow_human_task_candidate()
            .human_task_candidate_by_task()
            .filter(&task_id)
        {
            assert_committed_row(&changes, "workflow_human_task_candidate", &candidate)?;
        }
        for event in ctx
            .db
            .workflow_human_task_event()
            .human_task_event_by_task()
            .filter(&task_id)
        {
            assert_committed_row(&changes, "workflow_human_task_event", &event)?;
        }
        for receipt in ctx
            .db
            .workflow_human_task_receipt()
            .human_task_receipt_by_task()
            .filter(&task_id)
        {
            assert_committed_row(&changes, "workflow_human_task_receipt", &receipt)?;
        }
    }
    let audit = ctx
        .db
        .audit_log()
        .audit_by_org()
        .filter(&cancelled.organization_id)
        .find(|row| {
            row.table_name == "workflow_human_task"
                && row.record_id == cancelled.id
                && row.action == "CANCEL"
        })
        .ok_or("cancellation audit missing")?;
    assert_committed_row(&changes, "audit_log", &audit)?;
    Ok(())
}

fn assert_committed_row<T: spacetimedb_sats::Serialize>(
    changes: &[OrganizationRowChange],
    table: &str,
    expected: &T,
) -> Result<(), String> {
    let expected = serde_json::to_value(spacetimedb_sats::serde::SerdeWrapper::from_ref(expected))
        .map_err(|error| error.to_string())?;
    let mut matches = 0;
    for change in changes.iter().filter(|row| row.table_name == table) {
        let row = serde_json::from_str::<serde_json::Value>(
            change
                .row_json
                .as_deref()
                .ok_or("durable upsert row is missing")?,
        )
        .map_err(|error| error.to_string())?;
        matches += usize::from(row == expected);
    }
    if matches != 1 {
        return Err(format!(
            "durable cancellation omitted or duplicated an exact {table} row"
        ));
    }
    Ok(())
}

fn reject_requires_comment_and_invalidation_wins(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let role_id = seed_role(
        ctx,
        fixture.organization_id,
        vec![
            "workflow_task:reject",
            "workflow_task:approve",
            "workflow_task:write",
        ],
    );
    let actor = seed_member(ctx, &fixture, role_id, None);
    let seeded = seed_task_runtime(
        ctx,
        &fixture,
        role_id,
        new_identity(ctx),
        WorkflowTaskAssignment::AnyCandidate,
        true,
        None,
    )?;
    let missing_comment = decide_workflow_human_task_for_actor(
        ctx,
        fixture.organization_id,
        actor,
        decision(&fixture, &seeded, WorkflowHumanTaskDecision::Reject, None),
    )
    .err()
    .ok_or("required rejection comment was omitted")?;
    assert_contains(&missing_comment, "comment")?;

    invalidate_workflow_human_task_internal(
        ctx,
        fixture.organization_id,
        actor,
        InvalidateWorkflowHumanTaskParams {
            company_id: fixture.company_id,
            task_id: seeded.task_id,
            expected_revision: 1,
            observed_subject_revision_hash: REVISION_B.to_string(),
            reason: "material record changed".to_string(),
            idempotency_key: seeded.key("invalidate"),
            correlation_id: seeded.key("invalidate-correlation"),
        },
    )?;
    let late_decision = decide_workflow_human_task_for_actor(
        ctx,
        fixture.organization_id,
        actor,
        decision(
            &fixture,
            &seeded,
            WorkflowHumanTaskDecision::Approve,
            Some("too late"),
        ),
    )
    .err()
    .ok_or("an invalidated task accepted a decision")?;
    if !late_decision.contains("stale") && !late_decision.contains("not open") {
        return Err(format!(
            "unexpected invalidation race error: {late_decision}"
        ));
    }
    Ok(())
}

fn authorization_is_rechecked_at_decision_time(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let role_id = seed_role(ctx, fixture.organization_id, vec!["workflow_task:approve"]);
    let requester = seed_member(ctx, &fixture, role_id, None);
    let seeded = seed_task_runtime(
        ctx,
        &fixture,
        role_id,
        requester,
        WorkflowTaskAssignment::AnyCandidate,
        false,
        None,
    )?;
    let self_error = decide_workflow_human_task_for_actor(
        ctx,
        fixture.organization_id,
        requester,
        decision(&fixture, &seeded, WorkflowHumanTaskDecision::Approve, None),
    )
    .err()
    .ok_or("requester approved their own task")?;
    assert_contains(&self_error, "self-approval")?;

    let sod_actor = seed_member(ctx, &fixture, role_id, None);
    ctx.db.sod_conflict_rule().insert(SodConflictRule {
        id: 0,
        organization_id: fixture.organization_id,
        permission_a: "workflow_task:approve".to_string(),
        permission_b: "workflow_task:write".to_string(),
        description: Some("test decision-time SOD".to_string()),
        is_active: true,
        created_at: ctx.timestamp,
        metadata: None,
    });
    let mut role = ctx.db.role().id().find(&role_id).ok_or("role missing")?;
    role.permissions.push("workflow_task:write".to_string());
    ctx.db.role().id().update(role);
    let sod_error = decide_workflow_human_task_for_actor(
        ctx,
        fixture.organization_id,
        sod_actor,
        decision(&fixture, &seeded, WorkflowHumanTaskDecision::Approve, None),
    )
    .err()
    .ok_or("SOD-conflicting task decision succeeded")?;
    assert_contains(&sod_error, "segregation of duties")?;

    // Authorization is evaluated before closed-task validation so an outsider
    // cannot use stale decision attempts to probe task state.
    let closed_fixture = OrgFixture::seed_minimal(ctx)?;
    let approver_role_id = seed_role(
        ctx,
        closed_fixture.organization_id,
        vec!["workflow_task:approve"],
    );
    let approver = seed_member(ctx, &closed_fixture, approver_role_id, None);
    let reader_role_id = seed_role(
        ctx,
        closed_fixture.organization_id,
        vec!["workflow_task:read"],
    );
    let reader = seed_member(ctx, &closed_fixture, reader_role_id, None);
    let closed = seed_task_runtime(
        ctx,
        &closed_fixture,
        approver_role_id,
        new_identity(ctx),
        WorkflowTaskAssignment::AnyCandidate,
        false,
        None,
    )?;
    decide_workflow_human_task_for_actor(
        ctx,
        closed_fixture.organization_id,
        approver,
        decision(
            &closed_fixture,
            &closed,
            WorkflowHumanTaskDecision::Approve,
            None,
        ),
    )?;
    let denied = decide_workflow_human_task_for_actor(
        ctx,
        closed_fixture.organization_id,
        reader,
        decision(
            &closed_fixture,
            &closed,
            WorkflowHumanTaskDecision::Approve,
            None,
        ),
    )
    .err()
    .ok_or("reader learned closed task state instead of being denied")?;
    assert_contains(&denied, "Permission denied")?;
    if denied.contains("not open") || denied.contains("stale") {
        return Err(format!(
            "authorization ran after task-state validation: {denied}"
        ));
    }
    Ok(())
}

fn guarded_action_failure_does_not_consume_task(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let role_id = seed_role(ctx, fixture.organization_id, vec!["workflow_task:approve"]);
    let actor = seed_member(ctx, &fixture, role_id, None);
    let seeded = seed_task_runtime(
        ctx,
        &fixture,
        role_id,
        new_identity(ctx),
        WorkflowTaskAssignment::AnyCandidate,
        false,
        Some(WorkflowTaskGuardedAction {
            key: GuardedActionKey::PostPayment,
            schema_version: 1,
        }),
    )?;
    let before_events = ctx
        .db
        .workflow_human_task_event()
        .human_task_event_by_task()
        .filter(&seeded.task_id)
        .count();
    let error = decide_workflow_human_task_for_actor(
        ctx,
        fixture.organization_id,
        actor,
        decision(&fixture, &seeded, WorkflowHumanTaskDecision::Approve, None),
    )
    .err()
    .ok_or("missing guarded subject unexpectedly executed")?;
    assert_contains(&error, "not found")?;
    let task = ctx
        .db
        .workflow_human_task()
        .id()
        .find(&seeded.task_id)
        .ok_or("task disappeared after failed guarded action")?;
    if task.status != WorkflowHumanTaskStatus::Open
        || task.revision != 1
        || ctx
            .db
            .workflow_human_task_event()
            .human_task_event_by_task()
            .filter(&seeded.task_id)
            .count()
            != before_events
    {
        return Err("guarded action failure consumed task state or evidence".to_string());
    }
    Ok(())
}

pub(super) fn definition_node(
    key: &str,
    kind: WorkflowNodeKind,
    sequence: u32,
    task_policy: Option<WorkflowTaskPolicy>,
    action: Option<WorkflowActionReference>,
) -> UpsertWorkflowNodeParams {
    UpsertWorkflowNodeParams {
        node_key: key.to_string(),
        name: key.to_string(),
        kind,
        sequence,
        split_kind: WorkflowBranchKind::None,
        join_kind: WorkflowBranchKind::None,
        action,
        task_policy,
        timer_policy: None,
        retry_policy: None,
        subflow: None,
        metadata: Some(r#"{"test":"guarded-task-gate"}"#.to_string()),
    }
}

pub(super) fn definition_edge(
    key: &str,
    from: &str,
    to: &str,
    sequence: u32,
    signal: Option<&str>,
) -> UpsertWorkflowEdgeParams {
    UpsertWorkflowEdgeParams {
        edge_key: key.to_string(),
        from_node_key: from.to_string(),
        to_node_key: to.to_string(),
        sequence,
        signal_key: signal.map(str::to_string),
        condition: None,
        metadata: Some(r#"{"test":"guarded-task-gate"}"#.to_string()),
    }
}

pub(super) fn insert_draft_purchase_order(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    nonce: u64,
) -> Result<PurchaseOrder, String> {
    let currency_id = ctx
        .db
        .company()
        .id()
        .find(&fixture.company_id)
        .map(|company| company.currency_id)
        .ok_or("Harness company not found")?;
    Ok(ctx.db.purchase_order().insert(PurchaseOrder {
        id: 0,
        organization_id: fixture.organization_id,
        name: Some(format!("WF-GATE-{nonce}")),
        origin: None,
        partner_ref: None,
        state: PoState::Draft,
        date_order: ctx.timestamp,
        date_approve: None,
        partner_id: fixture.partner_id,
        dest_address_id: None,
        currency_id,
        payment_term_id: None,
        fiscal_position_id: None,
        date_planned: None,
        date_calendar_start: None,
        date_calendar_done: None,
        company_id: fixture.company_id,
        user_id: ctx.sender(),
        invoice_count: 0,
        invoice_ids: Vec::new(),
        invoice_status: PoInvoiceStatus::No,
        picking_count: 0,
        picking_ids: Vec::new(),
        effective_date: None,
        amount_untaxed: 25.0,
        amount_tax: 0.0,
        amount_total: 25.0,
        currency_rate: 1.0,
        match_qty_tolerance: None,
        match_price_tolerance: None,
        receipt_status: "pending".to_string(),
        notes: None,
        message_main_attachment_id: None,
        message_follower_ids: Vec::new(),
        message_ids: Vec::new(),
        has_message: false,
        activity_ids: Vec::new(),
        activity_state: None,
        activity_date_deadline: None,
        activity_type_id: None,
        activity_user_id: None,
        activity_summary: None,
        access_url: None,
        access_token: None,
        access_warning: None,
        is_locked: false,
        is_quantity_copy: "none".to_string(),
        incoterm_id: None,
        incoterm_location: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: Some(r#"{"test":"guarded-task-gate"}"#.to_string()),
    }))
}

pub(super) struct SeededTask {
    pub(super) task_id: u64,
    pub(super) nonce: u64,
}

impl SeededTask {
    pub(super) fn key(&self, suffix: &str) -> String {
        format!("human-task-{}-{suffix}", self.nonce)
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn seed_task_runtime(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    role_id: u64,
    requester: Identity,
    assignment: WorkflowTaskAssignment,
    require_comment_on_reject: bool,
    guarded_action: Option<WorkflowTaskGuardedAction>,
) -> Result<SeededTask, String> {
    seed_task_runtime_with_policy(
        ctx,
        fixture,
        requester,
        WorkflowTaskPolicy {
            kind: WorkflowHumanTaskKind::ApproveReject,
            assignment,
            candidate_role_ids: vec![role_id],
            candidate_group_ids: Vec::new(),
            candidate_unit_ids: Vec::new(),
            require_comment_on_reject,
        },
        guarded_action,
    )
}

pub(super) fn seed_task_after_approved_history(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    role_id: u64,
    actor: Identity,
    assignment: WorkflowTaskAssignment,
) -> Result<(SeededTask, WorkflowHumanTask), String> {
    let requester = new_identity(ctx);
    let initial = seed_task_runtime(
        ctx,
        fixture,
        role_id,
        requester,
        WorkflowTaskAssignment::AnyCandidate,
        false,
        None,
    )?;
    let task = ctx
        .db
        .workflow_human_task()
        .id()
        .find(&initial.task_id)
        .ok_or("first task missing")?;
    let first_edge = ctx
        .db
        .workflow_edge()
        .workflow_edge_by_from()
        .filter(&task.node_key)
        .find(|row| {
            row.workflow_version_id == task.workflow_version_id
                && row.signal_key.as_deref() == Some("approved")
        })
        .ok_or("first task approval edge missing")?;
    let second_node = ctx.db.workflow_node().insert(node(
        ctx,
        fixture,
        task.workflow_id,
        task.workflow_version_id,
        &format!("second-task-{}", initial.nonce),
        WorkflowNodeKind::HumanTask,
        Some(WorkflowTaskPolicy {
            kind: WorkflowHumanTaskKind::ApproveReject,
            assignment,
            candidate_role_ids: vec![role_id],
            candidate_group_ids: Vec::new(),
            candidate_unit_ids: Vec::new(),
            require_comment_on_reject: false,
        }),
    ));
    ctx.db.workflow_edge().insert(edge(
        ctx,
        fixture,
        task.workflow_id,
        task.workflow_version_id,
        &second_node.node_key,
        &first_edge.to_node_key,
        "approved",
    ));
    ctx.db.workflow_edge().insert(edge(
        ctx,
        fixture,
        task.workflow_id,
        task.workflow_version_id,
        &second_node.node_key,
        &format!("rejected-{}", initial.nonce),
        "rejected",
    ));
    ctx.db.workflow_edge().id().update(WorkflowEdge {
        to_node_key: second_node.node_key.clone(),
        ..first_edge
    });
    let history = decide_workflow_human_task_for_actor(
        ctx,
        fixture.organization_id,
        actor,
        decision(fixture, &initial, WorkflowHumanTaskDecision::Approve, None),
    )?;
    let token = ctx
        .db
        .workflow_token()
        .workflow_token_by_instance()
        .filter(&task.workflow_instance_id)
        .find(|row| row.state == WorkflowTokenState::Active && row.node_id == second_node.id)
        .ok_or("second human task token missing")?;
    let pending = create_workflow_human_task_internal(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateWorkflowHumanTaskParams {
            instance_id: task.workflow_instance_id,
            token_id: token.id,
            guarded_action: None,
            requested_by: requester,
            correlation_id: initial.key("second-task"),
            subject_revision_hash: Some(REVISION_A.to_string()),
        },
    )?;
    Ok((
        SeededTask {
            task_id: pending.id,
            nonce: initial.nonce,
        },
        history,
    ))
}

fn seed_task_runtime_with_policy(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    requester: Identity,
    policy: WorkflowTaskPolicy,
    guarded_action: Option<WorkflowTaskGuardedAction>,
) -> Result<SeededTask, String> {
    let nonce = ctx.rng().gen::<u64>();
    // These tests enter a runtime at its human task. Retain real pinned parent
    // rows so its complete durable history is reconstructable as well.
    let workflow_id = ctx
        .db
        .workflow()
        .insert(Workflow {
            id: 0,
            organization_id: fixture.organization_id,
            company_id: Some(fixture.company_id),
            workflow_key: format!("human-task-{nonce}"),
            model: "test_subject".to_string(),
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
        })
        .id;
    let version_id = ctx
        .db
        .workflow_version()
        .insert(WorkflowVersion {
            id: 0,
            organization_id: fixture.organization_id,
            company_id: Some(fixture.company_id),
            workflow_id,
            version: 1,
            status: WorkflowVersionStatus::Published,
            schema_version: 1,
            draft_revision: 1,
            name: format!("Human task fixture {nonce}"),
            description: None,
            trigger: WorkflowTrigger::Manual,
            snapshot_fields: Vec::new(),
            content_hash: Some(REVISION_A.to_string()),
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            published_uid: Some(ctx.sender()),
            published_date: Some(ctx.timestamp),
            retired_uid: None,
            retired_date: None,
            metadata: Some(r#"{"test":"human-task"}"#.to_string()),
        })
        .id;
    let task_key = format!("task-{nonce}");
    let approved_key = format!("approved-{nonce}");
    let rejected_key = format!("rejected-{nonce}");
    let task_node = ctx.db.workflow_node().insert(node(
        ctx,
        fixture,
        workflow_id,
        version_id,
        &task_key,
        WorkflowNodeKind::HumanTask,
        Some(policy),
    ));
    let approved = ctx.db.workflow_node().insert(node(
        ctx,
        fixture,
        workflow_id,
        version_id,
        &approved_key,
        WorkflowNodeKind::End,
        None,
    ));
    let rejected = ctx.db.workflow_node().insert(node(
        ctx,
        fixture,
        workflow_id,
        version_id,
        &rejected_key,
        WorkflowNodeKind::End,
        None,
    ));
    let approved_target = if let Some(guarded) = guarded_action.as_ref() {
        let action_key = format!("action-{nonce}");
        let mut action_node = node(
            ctx,
            fixture,
            workflow_id,
            version_id,
            &action_key,
            WorkflowNodeKind::Action,
            None,
        );
        action_node.action = Some(WorkflowActionReference {
            action_key: guarded.key.as_str().to_string(),
            input_schema_version: guarded.schema_version,
            input: Vec::new(),
        });
        let action_node = ctx.db.workflow_node().insert(action_node);
        ctx.db.workflow_edge().insert(edge_with_signal(
            ctx,
            fixture,
            workflow_id,
            version_id,
            &action_node.node_key,
            &approved.node_key,
            None,
        ));
        action_node.node_key
    } else {
        approved.node_key.clone()
    };
    ctx.db.workflow_edge().insert(edge(
        ctx,
        fixture,
        workflow_id,
        version_id,
        &task_key,
        &approved_target,
        "approved",
    ));
    ctx.db.workflow_edge().insert(edge(
        ctx,
        fixture,
        workflow_id,
        version_id,
        &task_key,
        &rejected.node_key,
        "rejected",
    ));
    let instance = ctx.db.workflow_instance().insert(WorkflowInstance {
        id: 0,
        organization_id: fixture.organization_id,
        company_id: fixture.company_id,
        workflow_id,
        workflow_version_id: version_id,
        definition_hash: REVISION_A.to_string(),
        subject_model: "test_subject".to_string(),
        subject_id: nonce,
        subject_revision_hash: REVISION_A.to_string(),
        state: WorkflowInstanceState::Active,
        revision: 1,
        active_token_count: 1,
        singleton_scope_key: None,
        started_by: requester,
        started_at: ctx.timestamp,
        completed_at: None,
        cancelled_by: None,
        cancelled_at: None,
        correlation_id: format!("seed-{nonce}"),
        causation_id: None,
    });
    let token = ctx.db.workflow_token().insert(WorkflowToken {
        id: 0,
        organization_id: fixture.organization_id,
        company_id: fixture.company_id,
        instance_id: instance.id,
        workflow_version_id: version_id,
        node_id: task_node.id,
        node_key: task_node.node_key,
        state: WorkflowTokenState::Active,
        revision: 1,
        parent_token_id: None,
        fork_id: None,
        branch_key: None,
        lineage: Vec::new(),
        created_at: ctx.timestamp,
        consumed_at: None,
    });
    let task = create_workflow_human_task_internal(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateWorkflowHumanTaskParams {
            instance_id: instance.id,
            token_id: token.id,
            guarded_action,
            requested_by: requester,
            correlation_id: format!("task-{nonce}"),
            subject_revision_hash: Some(REVISION_A.to_string()),
        },
    )?;
    Ok(SeededTask {
        task_id: task.id,
        nonce,
    })
}

fn node(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    workflow_id: u64,
    version_id: u64,
    key: &str,
    kind: WorkflowNodeKind,
    task_policy: Option<WorkflowTaskPolicy>,
) -> WorkflowNode {
    WorkflowNode {
        id: 0,
        organization_id: fixture.organization_id,
        company_id: Some(fixture.company_id),
        workflow_id,
        workflow_version_id: version_id,
        node_key: key.to_string(),
        name: key.to_string(),
        kind,
        sequence: 1,
        split_kind: WorkflowBranchKind::None,
        join_kind: WorkflowBranchKind::None,
        action: None,
        task_policy,
        timer_policy: None,
        retry_policy: None,
        subflow: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: Some(r#"{"test":"human-task"}"#.to_string()),
    }
}

fn edge(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    workflow_id: u64,
    version_id: u64,
    from: &str,
    to: &str,
    signal: &str,
) -> WorkflowEdge {
    edge_with_signal(
        ctx,
        fixture,
        workflow_id,
        version_id,
        from,
        to,
        Some(signal),
    )
}

fn edge_with_signal(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    workflow_id: u64,
    version_id: u64,
    from: &str,
    to: &str,
    signal: Option<&str>,
) -> WorkflowEdge {
    WorkflowEdge {
        id: 0,
        organization_id: fixture.organization_id,
        company_id: Some(fixture.company_id),
        workflow_id,
        workflow_version_id: version_id,
        edge_key: format!("{from}-{}", signal.unwrap_or("result")),
        from_node_key: from.to_string(),
        to_node_key: to.to_string(),
        sequence: 1,
        signal_key: signal.map(str::to_string),
        condition: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: Some(r#"{"test":"human-task"}"#.to_string()),
    }
}

fn decision(
    fixture: &OrgFixture,
    seeded: &SeededTask,
    decision: WorkflowHumanTaskDecision,
    comment: Option<&str>,
) -> DecideWorkflowHumanTaskParams {
    DecideWorkflowHumanTaskParams {
        company_id: fixture.company_id,
        task_id: seeded.task_id,
        expected_task_revision: 1,
        expected_instance_revision: 1,
        idempotency_key: seeded.key(match decision {
            WorkflowHumanTaskDecision::Approve => "approve",
            WorkflowHumanTaskDecision::Reject => "reject",
            WorkflowHumanTaskDecision::Complete => "complete",
        }),
        correlation_id: seeded.key("decision-correlation"),
        causation_id: None,
        decision,
        acting_for: None,
        comment: comment.map(str::to_string),
    }
}

pub(super) fn seed_role(ctx: &ReducerContext, organization_id: u64, permissions: Vec<&str>) -> u64 {
    ctx.db
        .role()
        .insert(Role {
            id: 0,
            organization_id,
            name: format!("human-task-role-{}", ctx.rng().gen::<u64>()),
            description: None,
            parent_id: None,
            permissions: permissions.into_iter().map(str::to_string).collect(),
            is_system: false,
            is_active: true,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            metadata: Some(r#"{"test":"human-task"}"#.to_string()),
        })
        .id
}

pub(super) fn seed_member(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    role_id: u64,
    department_id: Option<u64>,
) -> Identity {
    let identity = new_identity(ctx);
    ctx.db.user_profile().insert(UserProfile {
        id: 0,
        identity,
        platform_user_id: format!("test-{}", identity.to_hex()),
        organization_id: fixture.organization_id,
        email: format!("{}@human-task.test", identity.to_hex()),
        email_verified: true,
        name: "Human task actor".to_string(),
        first_name: None,
        last_name: None,
        avatar_url: None,
        phone: None,
        mobile: None,
        timezone: "UTC".to_string(),
        language: "en".to_string(),
        signature: None,
        notification_preferences: None,
        ui_preferences: None,
        is_active: true,
        is_superuser: false,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        last_login: None,
        metadata: Some(r#"{"test":"human-task"}"#.to_string()),
    });
    ctx.db.user_organization().insert(UserOrganization {
        id: 0,
        user_identity: identity,
        organization_id: fixture.organization_id,
        company_id: Some(fixture.company_id),
        role_id,
        department_id,
        job_title: None,
        employee_id: None,
        date_joined: ctx.timestamp,
        is_active: true,
        is_default: false,
        metadata: Some(r#"{"test":"human-task"}"#.to_string()),
    });
    identity
}

pub(super) fn new_identity(ctx: &ReducerContext) -> Identity {
    Identity::from_byte_array(ctx.rng().gen::<[u8; 32]>())
}

fn seed_candidate_group_member(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    group_id: u64,
    member_identity: Identity,
) -> WorkflowCandidateGroupMember {
    ctx.db
        .workflow_candidate_group_member()
        .insert(WorkflowCandidateGroupMember {
            id: 0,
            organization_id: fixture.organization_id,
            company_id: fixture.company_id,
            group_id,
            member_identity,
            is_active: true,
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
            revoked_by: None,
            revoked_at: None,
        })
}

pub(super) fn task_evidence_counts(ctx: &ReducerContext, task_id: u64) -> (usize, usize) {
    (
        ctx.db
            .workflow_human_task_event()
            .human_task_event_by_task()
            .filter(&task_id)
            .count(),
        ctx.db
            .workflow_human_task_receipt()
            .human_task_receipt_by_task()
            .filter(&task_id)
            .count(),
    )
}

#[derive(PartialEq, Eq)]
pub(super) struct CandidateDecisionSnapshot {
    identity: Identity,
    decision: Option<WorkflowHumanTaskDecision>,
    actor: Option<Identity>,
    decided_at: Option<spacetimedb::Timestamp>,
}

pub(super) fn candidate_decisions(
    ctx: &ReducerContext,
    task_id: u64,
) -> Vec<CandidateDecisionSnapshot> {
    let mut decisions: Vec<_> = ctx
        .db
        .workflow_human_task_candidate()
        .human_task_candidate_by_task()
        .filter(&task_id)
        .map(|candidate| CandidateDecisionSnapshot {
            identity: candidate.candidate_identity,
            decision: candidate.decision,
            actor: candidate.decided_by,
            decided_at: candidate.decided_at,
        })
        .collect();
    decisions.sort_by_key(|candidate| candidate.identity);
    decisions
}

pub(super) fn cancellation_evidence_counts(
    ctx: &ReducerContext,
    instance_id: u64,
) -> (usize, usize) {
    (
        ctx.db
            .workflow_decision_event()
            .workflow_event_by_instance()
            .filter(&instance_id)
            .count(),
        ctx.db
            .workflow_command_receipt()
            .workflow_receipt_by_instance()
            .filter(&instance_id)
            .count(),
    )
}

fn assert_contains(error: &str, needle: &str) -> Result<(), String> {
    if error.contains(needle) {
        Ok(())
    } else {
        Err(format!(
            "expected error containing '{needle}', got '{error}'"
        ))
    }
}
