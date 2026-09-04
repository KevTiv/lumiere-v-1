//! Human-task authorization, concurrency, idempotency and rollback tests.

use spacetimedb::rand::Rng;
use spacetimedb::{Identity, ReducerContext, Table};

use crate::core::permissions::{role, sod_conflict_rule, Role, SodConflictRule};
use crate::core::users::{user_organization, user_profile, UserOrganization, UserProfile};
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
    invalidate_workflow_human_task_internal, workflow_human_task, workflow_human_task_event,
    AddWorkflowHumanTaskCommentParams, ClaimWorkflowHumanTaskParams, CreateWorkflowHumanTaskParams,
    DecideWorkflowHumanTaskParams, InvalidateWorkflowHumanTaskParams, WorkflowHumanTaskDecision,
    WorkflowHumanTaskStatus, WorkflowTaskGuardedAction,
};
use crate::workflow::definitions::{
    create_workflow, publish_workflow_version, upsert_workflow_edge, upsert_workflow_node,
    workflow, workflow_edge, workflow_node, workflow_version, CreateWorkflowParams,
    UpsertWorkflowEdgeParams, UpsertWorkflowNodeParams, WorkflowActionReference,
    WorkflowBranchKind, WorkflowEdge, WorkflowHumanTaskKind, WorkflowNode, WorkflowNodeKind,
    WorkflowTaskAssignment, WorkflowTaskPolicy, WorkflowTrigger,
};
use crate::workflow::runtime::{
    workflow_instance, workflow_token, WorkflowInstance, WorkflowInstanceState, WorkflowToken,
    WorkflowTokenState,
};

const REVISION_A: &str = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REVISION_B: &str = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

pub fn test_workflow_human_tasks(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    gate_creates_and_converges_real_guarded_action(ctx)?;
    claim_comment_decision_and_replay(ctx)?;
    reject_requires_comment_and_invalidation_wins(ctx)?;
    authorization_is_rechecked_at_decision_time(ctx)?;
    guarded_action_failure_does_not_consume_task(ctx)?;
    Ok(())
}

fn gate_creates_and_converges_real_guarded_action(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let role_id = seed_role(ctx, fixture.organization_id, vec!["workflow_task:approve"]);
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
                assignment: WorkflowTaskAssignment::AnyCandidate,
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

    let order = insert_draft_purchase_order(ctx, &fixture, nonce);
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
    let (instance_id, task_id) = match outcome {
        GuardedActionGateOutcome::HumanTaskCreated {
            workflow_instance_id,
            task_id,
            ..
        } => (workflow_instance_id, task_id),
        GuardedActionGateOutcome::DirectExecutionAllowed { .. } => {
            return Err("matching published workflow did not create a task".to_string())
        }
    };
    let replay = request_guarded_action(ctx, fixture.organization_id, request)?;
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
            acting_for: Some(requester),
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

fn reject_requires_comment_and_invalidation_wins(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let role_id = seed_role(
        ctx,
        fixture.organization_id,
        vec!["workflow_task:reject", "workflow_task:approve"],
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

fn definition_node(
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

fn definition_edge(
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

fn insert_draft_purchase_order(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    nonce: u64,
) -> PurchaseOrder {
    ctx.db.purchase_order().insert(PurchaseOrder {
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
        currency_id: 1,
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
    })
}

struct SeededTask {
    task_id: u64,
    nonce: u64,
}

impl SeededTask {
    fn key(&self, suffix: &str) -> String {
        format!("human-task-{}-{suffix}", self.nonce)
    }
}

#[allow(clippy::too_many_arguments)]
fn seed_task_runtime(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    role_id: u64,
    requester: Identity,
    assignment: WorkflowTaskAssignment,
    require_comment_on_reject: bool,
    guarded_action: Option<WorkflowTaskGuardedAction>,
) -> Result<SeededTask, String> {
    let nonce = ctx.rng().gen::<u64>();
    let workflow_id = nonce;
    let version_id = nonce.wrapping_add(1);
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
        Some(WorkflowTaskPolicy {
            kind: WorkflowHumanTaskKind::ApproveReject,
            assignment,
            candidate_role_ids: vec![role_id],
            candidate_group_ids: Vec::new(),
            candidate_unit_ids: Vec::new(),
            require_comment_on_reject,
        }),
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

fn seed_role(ctx: &ReducerContext, organization_id: u64, permissions: Vec<&str>) -> u64 {
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

fn seed_member(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    role_id: u64,
    department_id: Option<u64>,
) -> Identity {
    let identity = new_identity(ctx);
    ctx.db.user_profile().insert(UserProfile {
        identity,
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

fn new_identity(ctx: &ReducerContext) -> Identity {
    Identity::from_byte_array(ctx.rng().gen::<[u8; 32]>())
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
