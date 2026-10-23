//! Native recovery through the published gate, with ordinary operator grants.

use spacetimedb::rand::Rng;
use spacetimedb::{Identity, ReducerContext, Table};

use crate::accounting::bank_settlement_lifecycle::{
    bank_statement_settlement_attempt, BankStatementSettlementAttempt,
};
use crate::accounting::journal_entries::{account_move, account_move_line};
use crate::accounting::payments::{account_payment, AccountPayment};
use crate::core::audit::audit_log;
use crate::core::organization::company;
use crate::core::permissions::{
    org_permission, OrgPermission, PermissionAction, PermissionEffect, PermissionSubject,
};
use crate::core::persistence::{
    organization_commit, organization_row_change, OrganizationRowChange,
};
use crate::core::reference::document_sequence;
use crate::core::users::{
    find_user_profile_for_organization, user_organization, user_profile, UserOrganization,
    UserProfile,
};
use crate::crm::contacts::contact;
use crate::inventory::product::product;
use crate::inventory::stock::{stock_move, stock_picking};
use crate::purchasing::purchase_orders::{
    add_purchase_order_line, purchase_order, purchase_order_line, AddPurchaseOrderLineParams,
    PurchaseOrder,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{PartnerType, PaymentState, PaymentType, PoState};
use crate::workflow::action_registry::{
    guarded_action_receipt, snapshot_guarded_action, GuardedActionInput, GuardedActionKey,
    GUARDED_ACTION_SCHEMA_VERSION,
};
use crate::workflow::approval_gate::{
    request_guarded_action, GuardedActionGateOutcome, RequestGuardedActionParams,
};
use crate::workflow::approvals::{
    add_workflow_human_task_comment_for_actor, claim_workflow_human_task_for_actor,
    decide_workflow_human_task_for_actor, invalidate_workflow_human_task, workflow_human_task,
    workflow_human_task_candidate, workflow_human_task_event, workflow_human_task_receipt,
    AddWorkflowHumanTaskCommentParams, ClaimWorkflowHumanTaskParams, DecideWorkflowHumanTaskParams,
    InvalidateWorkflowHumanTaskParams, WorkflowHumanTask, WorkflowHumanTaskCommandKind,
    WorkflowHumanTaskDecision, WorkflowHumanTaskStatus,
};
use crate::workflow::definitions::{
    clone_workflow_version_to_draft, create_workflow, publish_workflow_version,
    retire_workflow_version, upsert_workflow_edge, upsert_workflow_node, workflow, workflow_edge,
    workflow_node, workflow_version, CreateWorkflowParams, WorkflowActionReference,
    WorkflowHumanTaskKind, WorkflowNodeKind, WorkflowTaskAssignment, WorkflowTaskPolicy,
    WorkflowTrigger, WorkflowVersionStatus,
};
use crate::workflow::migration::{
    create_workflow_migration_plan, migrate_workflow_instance, workflow_migration_plan,
    CreateWorkflowMigrationPlanParams, MigrateWorkflowInstanceParams, WorkflowEdgeMigrationMapping,
    WorkflowNodeMigrationMapping,
};
use crate::workflow::recovery::{
    resubmit_workflow_human_task, workflow_human_task_resubmission,
    ResubmitWorkflowHumanTaskParams, WorkflowHumanTaskResubmission,
};
use crate::workflow::runtime::{cancel_workflow, workflow_instance, CancelWorkflowParams};

use super::human_tasks_test::{
    candidate_decisions, definition_edge, definition_node, insert_draft_purchase_order,
    seed_member, seed_role, task_evidence_counts,
};

const PO_OPERATOR_GRANTS: [&str; 5] = [
    "workflow_instance:create",
    "workflow_instance:write",
    "workflow_task:write",
    "purchase_order:read",
    "purchase_order:write",
];

pub(super) fn test_workflow_recovery(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    resubmission_preserves_history_and_uses_current_electorate(ctx)?;
    confirmation_recovery_checks_current_authority_and_source(ctx)?;
    ordinary_payment_recovery_excludes_bank_attempts(ctx)?;
    finance_claim_comment_invalidation_are_durable(ctx)?;
    Ok(())
}

fn resubmission_preserves_history_and_uses_current_electorate(
    ctx: &ReducerContext,
) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let candidate_role = seed_role(
        ctx,
        fixture.organization_id,
        vec!["workflow_task:approve", "purchase_order:read"],
    );
    let first = seed_member(ctx, &fixture, candidate_role, None);
    let removed = seed_member(ctx, &fixture, candidate_role, None);
    seed_published_gate(
        ctx,
        &fixture,
        candidate_role,
        GuardedActionKey::SendPurchaseOrder,
        WorkflowTaskAssignment::AllCandidates,
    )?;
    let order = insert_draft_purchase_order(ctx, &fixture, ctx.rng().gen())?;
    let request = request(&fixture, GuardedActionKey::SendPurchaseOrder, order.id);
    let task = requested_task(ctx, &fixture, request.clone())?;
    // A persisted request by a different person must retain that attribution
    // when a recovery operator restarts it, including the self-approval guard.
    let requester_role = seed_role(ctx, fixture.organization_id, Vec::new());
    let original_requester = seed_member(ctx, &fixture, requester_role, None);
    ctx.db.workflow_human_task().id().update(WorkflowHumanTask {
        requested_by: original_requester,
        ..task.clone()
    });
    decide_workflow_human_task_for_actor(
        ctx,
        fixture.organization_id,
        first,
        decision(ctx, &task, "partial-vote")?,
    )?;
    // A real version migration leaves this task's original Create/vote events
    // and consumed tokens pinned to v1 while the active projection moves to v2.
    migrate_recovery_fixture(ctx, &fixture, &task)?;
    let removed_membership = membership(ctx, &fixture, removed)?;
    ctx.db.user_organization().id().update(UserOrganization {
        is_active: false,
        ..removed_membership
    });
    let replacement = seed_member(ctx, &fixture, candidate_role, None);
    cancel(ctx, &fixture, task.id, "initial-cancel")?;
    let cancelled = task_by_id(ctx, task.id)?;
    let old_votes = candidate_decisions(ctx, task.id);
    let old_counts = task_evidence_counts(ctx, task.id);
    let params = recovery_params(ctx, &cancelled, "first-recovery")?;

    with_operator_grants(ctx, &fixture, &PO_OPERATOR_GRANTS, || {
        resubmit_workflow_human_task(ctx, fixture.organization_id, params.clone())?;
        let link = recovery_link(ctx, task.id)?;
        let successor = task_by_id(ctx, link.successor_task_id)?;
        let old = task_by_id(ctx, task.id)?;
        let successor_creation = ctx
            .db
            .workflow_human_task_event()
            .human_task_event_by_task()
            .filter(&successor.id)
            .find(|event| event.command_kind == WorkflowHumanTaskCommandKind::Create)
            .ok_or_else(|| "successor creation event missing".to_string())?;
        let new_candidates: Vec<_> = ctx
            .db
            .workflow_human_task_candidate()
            .human_task_candidate_by_task()
            .filter(&successor.id)
            .collect();
        if successor.id == task.id
            || successor.requested_by != original_requester
            || successor_creation.actor != ctx.sender()
            || successor.status != WorkflowHumanTaskStatus::Open
            || successor.revision != 1
            || new_candidates.len() != 2
            || !new_candidates
                .iter()
                .any(|row| row.candidate_identity == first)
            || !new_candidates
                .iter()
                .any(|row| row.candidate_identity == replacement)
            || new_candidates
                .iter()
                .any(|row| row.decision.is_some() || row.candidate_identity == removed)
            || old.status != WorkflowHumanTaskStatus::Cancelled
            || old.revision != cancelled.revision + 1
            || candidate_decisions(ctx, task.id) != old_votes
            || task_evidence_counts(ctx, task.id) != (old_counts.0 + 1, old_counts.1 + 1)
        {
            return Err(
                "resubmission changed old votes/history or reused a stale electorate/requester"
                    .to_string(),
            );
        }
        assert_exact_evidence(ctx, &fixture, &params, &link)?;
        assert_durable_recovery(ctx, &fixture, &params, &link)?;
        let counts = workflow_counts(ctx, &fixture);
        resubmit_workflow_human_task(ctx, fixture.organization_id, params.clone())?;
        if workflow_counts(ctx, &fixture) != counts {
            return Err("resubmission replay created another attempt".to_string());
        }
        expect_error(
            resubmit_workflow_human_task(
                ctx,
                fixture.organization_id,
                ResubmitWorkflowHumanTaskParams {
                    idempotency_key: "competing-recovery".to_string(),
                    ..params.clone()
                },
            ),
            "already has",
        )?;
        expect_error(
            resubmit_workflow_human_task(
                ctx,
                fixture.organization_id,
                ResubmitWorkflowHumanTaskParams {
                    reason: "changed semantic input".to_string(),
                    ..params.clone()
                },
            ),
            "different input",
        )?;
        assert_requested_task(ctx, &fixture, request.clone(), successor.id)?;

        // A second explicit cancellation/resubmission converges fixed source
        // commands through the immutable chain without reopening old tasks.
        cancel(ctx, &fixture, successor.id, "second-cancel")?;
        let next_params = recovery_params(ctx, &task_by_id(ctx, successor.id)?, "second-recovery")?;
        resubmit_workflow_human_task(ctx, fixture.organization_id, next_params)?;
        let latest = task_by_id(ctx, recovery_link(ctx, successor.id)?.successor_task_id)?;
        assert_requested_task(ctx, &fixture, request.clone(), latest.id)?;
        let partial_params = decision(ctx, &latest, "new-first-vote")?;
        decide_workflow_human_task_for_actor(
            ctx,
            fixture.organization_id,
            first,
            partial_params.clone(),
        )?;
        let voted = task_by_id(ctx, latest.id)?;
        durable_lifecycle_changes(ctx, &fixture, &voted, "erp.decide_workflow_human_task")?;
        let partial_counts = lifecycle_evidence_counts(ctx, &fixture, voted.id);
        decide_workflow_human_task_for_actor(ctx, fixture.organization_id, first, partial_params)?;
        if lifecycle_evidence_counts(ctx, &fixture, voted.id) != partial_counts {
            return Err("partial vote replay wrote durable or audit evidence".to_string());
        }
        let final_params = decision(ctx, &voted, "new-final-vote")?;
        decide_workflow_human_task_for_actor(
            ctx,
            fixture.organization_id,
            replacement,
            final_params.clone(),
        )?;
        if ctx
            .db
            .purchase_order()
            .id()
            .find(&order.id)
            .is_none_or(|row| row.state != PoState::Sent)
        {
            return Err(
                "fresh recovered electorate did not execute the original guarded action"
                    .to_string(),
            );
        }
        let approved = task_by_id(ctx, latest.id)?;
        let changes =
            durable_lifecycle_changes(ctx, &fixture, &approved, "erp.decide_workflow_human_task")?;
        if !changes
            .iter()
            .any(|row| row.table_name == "guarded_action_receipt")
        {
            return Err("completed recovered PO lost its exact guarded action receipt".to_string());
        }
        let final_counts = lifecycle_evidence_counts(ctx, &fixture, approved.id);
        decide_workflow_human_task_for_actor(
            ctx,
            fixture.organization_id,
            replacement,
            final_params,
        )?;
        if lifecycle_evidence_counts(ctx, &fixture, approved.id) != final_counts {
            return Err("final vote replay wrote durable or audit evidence".to_string());
        }
        // Source state changed on legitimate completion; authorized replay is
        // still proof of the original recovery, not another business mutation.
        resubmit_workflow_human_task(ctx, fixture.organization_id, params.clone())?;
        assert_exact_evidence(ctx, &fixture, &params, &link)?;
        let before_denied = workflow_counts(ctx, &fixture);
        let deny = ctx.db.org_permission().insert(OrgPermission {
            id: 0,
            organization_id: fixture.organization_id,
            subject: PermissionSubject::User(ctx.sender()),
            role_id: None,
            resource: "purchase-orders".to_string(),
            action: PermissionAction::Read,
            effect: PermissionEffect::Deny,
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
        });
        let denied = resubmit_workflow_human_task(ctx, fixture.organization_id, params.clone());
        ctx.db.org_permission().id().delete(&deny.id);
        expect_error(denied, "source read permission denied")?;
        let member = membership(ctx, &fixture, ctx.sender())?;
        ctx.db.user_organization().id().update(UserOrganization {
            is_active: false,
            ..member.clone()
        });
        let denied = resubmit_workflow_human_task(ctx, fixture.organization_id, params.clone());
        ctx.db.user_organization().id().update(member);
        if denied.is_ok() || workflow_counts(ctx, &fixture) != before_denied {
            return Err(
                "revoked membership replayed recovery or denial changed evidence".to_string(),
            );
        }
        // Represent a previously committed result owned by a different actor;
        // the connected ordinary operator cannot borrow its command key.
        ctx.db
            .workflow_human_task_resubmission()
            .previous_task_id()
            .update(WorkflowHumanTaskResubmission {
                created_by: first,
                ..link.clone()
            });
        let denied = resubmit_workflow_human_task(ctx, fixture.organization_id, params.clone());
        ctx.db
            .workflow_human_task_resubmission()
            .previous_task_id()
            .update(link);
        expect_error(denied, "belongs to another actor")?;
        Ok(())
    })
}

fn confirmation_recovery_checks_current_authority_and_source(
    ctx: &ReducerContext,
) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let role = seed_role(
        ctx,
        fixture.organization_id,
        vec!["workflow_task:approve", "purchase_order:read"],
    );
    let reviewer = seed_member(ctx, &fixture, role, None);
    seed_published_gate(
        ctx,
        &fixture,
        role,
        GuardedActionKey::ConfirmPurchaseOrder,
        WorkflowTaskAssignment::AnyCandidate,
    )?;
    let order = insert_draft_purchase_order(ctx, &fixture, ctx.rng().gen())?;
    let uom_id = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("fixture product missing")?
        .uom_id;
    add_purchase_order_line(
        ctx,
        fixture.organization_id,
        order.id,
        AddPurchaseOrderLineParams {
            product_id: fixture.product_id,
            quantity: 1.0,
            uom_id,
            price_unit: 25.0,
            discount: 0.0,
            tax_ids: Vec::new(),
            name: Some("Recovered stock receipt".to_string()),
            sequence: None,
            display_type: None,
            product_variant_id: None,
            account_analytic_id: None,
            date_planned: None,
            propagate_cancel: None,
            lot_id: None,
            metadata: None,
        },
    )?;
    let request = request(&fixture, GuardedActionKey::ConfirmPurchaseOrder, order.id);
    let task = requested_task(ctx, &fixture, request.clone())?;
    let open_params = recovery_params(ctx, &task, "not-cancelled")?;
    expect_error(
        resubmit_workflow_human_task(ctx, fixture.organization_id, open_params),
        "only a cancelled",
    )?;
    cancel(ctx, &fixture, task.id, "confirm-cancel")?;
    let cancelled = task_by_id(ctx, task.id)?;
    let params = recovery_params(ctx, &cancelled, "confirm-recovery")?;
    let before = workflow_counts(ctx, &fixture);
    let old_version = ctx
        .db
        .workflow_version()
        .id()
        .find(&cancelled.workflow_version_id)
        .ok_or("old recovery version missing")?;
    retire_workflow_version(
        ctx,
        fixture.organization_id,
        old_version.id,
        old_version.draft_revision,
    )?;
    expect_error(
        resubmit_workflow_human_task(ctx, fixture.organization_id, params.clone()),
        "currently published",
    )?;
    // Resubmission chooses current published policy; the original task remains
    // pinned to its retired version, and the fixed source command follows it.
    seed_published_gate(
        ctx,
        &fixture,
        role,
        GuardedActionKey::ConfirmPurchaseOrder,
        WorkflowTaskAssignment::AnyCandidate,
    )?;
    for missing in [
        "workflow_instance:create",
        "workflow_task:write",
        "purchase_order:read",
        "purchase_order:write",
    ] {
        let grants: Vec<_> = PO_OPERATOR_GRANTS
            .iter()
            .copied()
            .filter(|grant| *grant != missing)
            .collect();
        with_operator_grants(ctx, &fixture, &grants, || {
            if resubmit_workflow_human_task(ctx, fixture.organization_id, params.clone()).is_ok() {
                return Err(format!("recovery ignored missing grant {missing}"));
            }
            Ok(())
        })?;
    }
    with_operator_grants(ctx, &fixture, &PO_OPERATOR_GRANTS, || {
        for invalid in [
            ResubmitWorkflowHumanTaskParams {
                expected_task_revision: params.expected_task_revision + 1,
                ..params.clone()
            },
            ResubmitWorkflowHumanTaskParams {
                expected_instance_revision: params.expected_instance_revision + 1,
                ..params.clone()
            },
            ResubmitWorkflowHumanTaskParams {
                expected_subject_revision_hash: "sha256:stale".to_string(),
                ..params.clone()
            },
            ResubmitWorkflowHumanTaskParams {
                reason: "   ".to_string(),
                ..params.clone()
            },
            ResubmitWorkflowHumanTaskParams {
                idempotency_key: "unreadable\ncommand".to_string(),
                ..params.clone()
            },
            ResubmitWorkflowHumanTaskParams {
                correlation_id: "unreadable\u{007f}correlation".to_string(),
                ..params.clone()
            },
            ResubmitWorkflowHumanTaskParams {
                company_id: fixture.company_id + 100_000,
                ..params.clone()
            },
        ] {
            if resubmit_workflow_human_task(ctx, fixture.organization_id, invalid).is_ok() {
                return Err("recovery accepted stale, empty or out-of-scope input".to_string());
            }
        }
        let before_edit = ctx
            .db
            .purchase_order()
            .id()
            .find(&order.id)
            .ok_or("recovery source missing before fixture edit")?;
        let original_partner_ref = before_edit.partner_ref.clone();
        ctx.db.purchase_order().id().update(PurchaseOrder {
            partner_ref: Some("real changed vendor quote".to_string()),
            ..before_edit
        });
        let changed = resubmit_workflow_human_task(ctx, fixture.organization_id, params.clone());
        let after_edit = ctx
            .db
            .purchase_order()
            .id()
            .find(&order.id)
            .ok_or("recovery source missing after fixture edit")?;
        ctx.db.purchase_order().id().update(PurchaseOrder {
            partner_ref: original_partner_ref,
            ..after_edit
        });
        expect_error(changed, "source revision changed")?;
        if workflow_counts(ctx, &fixture) != before {
            return Err("denied recovery created tasks or evidence".to_string());
        }
        resubmit_workflow_human_task(ctx, fixture.organization_id, params.clone())?;
        let successor = task_by_id(ctx, recovery_link(ctx, task.id)?.successor_task_id)?;
        if successor.workflow_version_id == cancelled.workflow_version_id {
            return Err("resubmission reused a retired workflow version".to_string());
        }
        assert_requested_task(ctx, &fixture, request, successor.id)?;
        Ok(())
    })?;
    // The real domain adapter creates an incoming picking and stock move; its
    // approval commit must retain those effects with the completed task.
    let successor = task_by_id(ctx, recovery_link(ctx, task.id)?.successor_task_id)?;
    decide_workflow_human_task_for_actor(
        ctx,
        fixture.organization_id,
        reviewer,
        decision(ctx, &successor, "confirm-approved")?,
    )?;
    let approved = task_by_id(ctx, successor.id)?;
    let changes =
        durable_lifecycle_changes(ctx, &fixture, &approved, "erp.decide_workflow_human_task")?;
    for table in [
        "contact",
        "purchase_order_line",
        "stock_picking",
        "stock_move",
        "guarded_action_receipt",
    ] {
        if !changes.iter().any(|row| row.table_name == table) {
            return Err(format!("confirmed PO durable effect missing {table}"));
        }
    }
    if ctx
        .db
        .purchase_order()
        .id()
        .find(&order.id)
        .is_none_or(|row| row.state != PoState::Purchase)
    {
        return Err("recovered confirmation did not confirm its PO".to_string());
    }
    Ok(())
}

fn ordinary_payment_recovery_excludes_bank_attempts(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let role = seed_role(
        ctx,
        fixture.organization_id,
        vec!["workflow_task:approve", "payment:read"],
    );
    let reviewer = seed_member(ctx, &fixture, role, None);
    seed_published_gate(
        ctx,
        &fixture,
        role,
        GuardedActionKey::PostPayment,
        WorkflowTaskAssignment::AnyCandidate,
    )?;
    let (journal_id, _) = crate::accounting_tests::helpers::seed_bank_journal(ctx, &fixture)?;
    let currency_id = ctx
        .db
        .company()
        .id()
        .find(&fixture.company_id)
        .ok_or("payment company missing")?
        .currency_id;
    let payment = ctx.db.account_payment().insert(AccountPayment {
        id: 0,
        organization_id: fixture.organization_id,
        company_id: fixture.company_id,
        name: None,
        move_id: None,
        reversal_move_id: None,
        payment_type: PaymentType::OutBound,
        partner_type: PartnerType::Supplier,
        partner_id: fixture.partner_id,
        amount: 25.0,
        currency_id,
        date: ctx.timestamp,
        journal_id,
        ref_: None,
        memo: None,
        reconciled_invoice_ids: Vec::new(),
        reconciled_bill_ids: Vec::new(),
        state: PaymentState::NotPaid,
        created_at: ctx.timestamp,
        create_uid: ctx.sender(),
    });
    let request = request(&fixture, GuardedActionKey::PostPayment, payment.id);
    let task = requested_task(ctx, &fixture, request.clone())?;
    cancel(ctx, &fixture, task.id, "payment-cancel")?;
    let params = recovery_params(ctx, &task_by_id(ctx, task.id)?, "payment-recovery")?;
    let attempt =
        ctx.db
            .bank_statement_settlement_attempt()
            .insert(BankStatementSettlementAttempt {
                id: 0,
                organization_id: fixture.organization_id,
                company_id: fixture.company_id,
                statement_id: 1,
                line_id: 1,
                generation: 1,
                payment_id: payment.id,
                receipt_key: format!("recovery-bank-attempt-{}", payment.id),
                status: "approval_closed".to_string(),
                amount: payment.amount,
                currency_id,
                journal_id,
                date: ctx.timestamp,
                partner_id: fixture.partner_id,
                line_snapshots: Vec::new(),
                invoice_snapshots: Vec::new(),
                sale_order_deltas: Vec::new(),
                previous_payment_id: None,
                recovery_key: None,
                recovery_reason: None,
                reversal_request_id: None,
                created_at: ctx.timestamp,
                created_by: ctx.sender(),
                closed_at: None,
            });
    let grants = [
        "workflow_instance:create",
        "workflow_task:write",
        "payment:read",
        "payment:post",
    ];
    with_operator_grants(ctx, &fixture, &grants, || {
        let before = workflow_counts(ctx, &fixture);
        expect_error(
            resubmit_workflow_human_task(ctx, fixture.organization_id, params.clone()),
            "dedicated settlement",
        )?;
        if workflow_counts(ctx, &fixture) != before {
            return Err("bank exclusion changed workflow evidence".to_string());
        }
        ctx.db
            .bank_statement_settlement_attempt()
            .id()
            .delete(&attempt.id);
        resubmit_workflow_human_task(ctx, fixture.organization_id, params)?;
        assert_requested_task(
            ctx,
            &fixture,
            request,
            recovery_link(ctx, task.id)?.successor_task_id,
        )
    })?;
    let successor = task_by_id(ctx, recovery_link(ctx, task.id)?.successor_task_id)?;
    let params = decision(ctx, &successor, "ordinary-payment-approved")?;
    decide_workflow_human_task_for_actor(ctx, fixture.organization_id, reviewer, params.clone())?;
    let approved = task_by_id(ctx, successor.id)?;
    let changes =
        durable_lifecycle_changes(ctx, &fixture, &approved, "erp.decide_workflow_human_task")?;
    for table in [
        "account_move",
        "account_move_line",
        "account_payment",
        "document_sequence",
        "guarded_action_receipt",
    ] {
        if !changes.iter().any(|row| row.table_name == table) {
            return Err(format!(
                "posted ordinary payment durable effect missing {table}"
            ));
        }
    }
    let posted = ctx
        .db
        .account_payment()
        .id()
        .find(&payment.id)
        .ok_or("posted payment missing")?;
    if posted.state != PaymentState::Paid
        || posted.move_id.is_none()
        || changes
            .iter()
            .filter(|row| row.table_name == "account_move_line")
            .count()
            != 2
    {
        return Err("recovered ordinary payment did not retain its posted ledger pair".to_string());
    }
    let counts = lifecycle_evidence_counts(ctx, &fixture, approved.id);
    decide_workflow_human_task_for_actor(ctx, fixture.organization_id, reviewer, params)?;
    if lifecycle_evidence_counts(ctx, &fixture, approved.id) != counts {
        return Err(
            "payment decision replay duplicated audit, ledger or commit evidence".to_string(),
        );
    }
    Ok(())
}

fn finance_claim_comment_invalidation_are_durable(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let role = seed_role(
        ctx,
        fixture.organization_id,
        vec![
            "workflow_task:write",
            "workflow_task:approve",
            "purchase_order:read",
        ],
    );
    let reviewer = seed_member(ctx, &fixture, role, None);
    seed_published_gate(
        ctx,
        &fixture,
        role,
        GuardedActionKey::SendPurchaseOrder,
        WorkflowTaskAssignment::AnyCandidate,
    )?;
    let order = insert_draft_purchase_order(ctx, &fixture, ctx.rng().gen())?;
    let task = requested_task(
        ctx,
        &fixture,
        request(&fixture, GuardedActionKey::SendPurchaseOrder, order.id),
    )?;
    let claim = ClaimWorkflowHumanTaskParams {
        company_id: fixture.company_id,
        task_id: task.id,
        expected_revision: task.revision,
        acting_for: None,
        idempotency_key: format!("finance-claim:{}", task.id),
        correlation_id: format!("finance-claim:{}", task.id),
    };
    let claimed =
        claim_workflow_human_task_for_actor(ctx, fixture.organization_id, reviewer, claim.clone())?;
    durable_lifecycle_changes(ctx, &fixture, &claimed, "erp.claim_workflow_human_task")?;
    let counts = lifecycle_evidence_counts(ctx, &fixture, task.id);
    claim_workflow_human_task_for_actor(ctx, fixture.organization_id, reviewer, claim)?;
    if lifecycle_evidence_counts(ctx, &fixture, task.id) != counts {
        return Err("Finance claim replay wrote audit or commit evidence".to_string());
    }
    let comment = AddWorkflowHumanTaskCommentParams {
        company_id: fixture.company_id,
        task_id: task.id,
        expected_revision: claimed.revision,
        comment: "The supplier has issued a replacement quote".to_string(),
        idempotency_key: format!("finance-comment:{}", task.id),
        correlation_id: format!("finance-comment:{}", task.id),
    };
    let commented = add_workflow_human_task_comment_for_actor(
        ctx,
        fixture.organization_id,
        reviewer,
        comment.clone(),
    )?;
    durable_lifecycle_changes(
        ctx,
        &fixture,
        &commented,
        "erp.add_workflow_human_task_comment",
    )?;
    let counts = lifecycle_evidence_counts(ctx, &fixture, task.id);
    add_workflow_human_task_comment_for_actor(ctx, fixture.organization_id, reviewer, comment)?;
    if lifecycle_evidence_counts(ctx, &fixture, task.id) != counts {
        return Err("Finance comment replay wrote audit or commit evidence".to_string());
    }
    let current = ctx
        .db
        .purchase_order()
        .id()
        .find(&order.id)
        .ok_or("Finance source missing")?;
    ctx.db.purchase_order().id().update(PurchaseOrder {
        partner_ref: Some("replacement quote".to_string()),
        ..current
    });
    let changed = snapshot_guarded_action(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        GuardedActionKey::SendPurchaseOrder,
        GUARDED_ACTION_SCHEMA_VERSION,
        GuardedActionInput::SendPurchaseOrder { order_id: order.id },
    )?;
    let invalidate = InvalidateWorkflowHumanTaskParams {
        company_id: fixture.company_id,
        task_id: task.id,
        expected_revision: commented.revision,
        observed_subject_revision_hash: changed.subject_revision_hash,
        reason: "The original supplier quote is superseded".to_string(),
        idempotency_key: format!("finance-invalidate:{}", task.id),
        correlation_id: format!("finance-invalidate:{}", task.id),
    };
    invalidate_workflow_human_task(ctx, fixture.organization_id, invalidate.clone())?;
    let invalidated = task_by_id(ctx, task.id)?;
    let changes = durable_lifecycle_changes(
        ctx,
        &fixture,
        &invalidated,
        "erp.invalidate_workflow_human_task",
    )?;
    if invalidated.status != WorkflowHumanTaskStatus::Invalidated
        || changes
            .iter()
            .any(|row| row.table_name == "guarded_action_receipt")
    {
        return Err("Finance invalidation persisted an unexpected guarded effect".to_string());
    }
    let counts = lifecycle_evidence_counts(ctx, &fixture, task.id);
    invalidate_workflow_human_task(ctx, fixture.organization_id, invalidate)?;
    if lifecycle_evidence_counts(ctx, &fixture, task.id) != counts {
        return Err("Finance invalidation replay wrote audit or commit evidence".to_string());
    }
    Ok(())
}

fn seed_published_gate(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    role_id: u64,
    action: GuardedActionKey,
    assignment: WorkflowTaskAssignment,
) -> Result<(), String> {
    let workflow_key = format!("recovery-{}-{}", action.as_str(), ctx.rng().gen::<u64>());
    let model = if action == GuardedActionKey::PostPayment {
        "account_payment"
    } else {
        "purchase_order"
    };
    create_workflow(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        CreateWorkflowParams {
            workflow_key: workflow_key.clone(),
            model: model.to_string(),
            name: "Approval recovery test".to_string(),
            description: None,
            trigger: WorkflowTrigger::Manual,
            schema_version: 1,
            snapshot_fields: Vec::new(),
            metadata: Some(r#"{"singleton_trigger":true}"#.to_string()),
        },
    )?;
    let definition = ctx
        .db
        .workflow()
        .workflow_by_key()
        .filter(&workflow_key)
        .find(|row| row.organization_id == fixture.organization_id)
        .ok_or("recovery workflow missing")?;
    let version = ctx
        .db
        .workflow_version()
        .workflow_version_by_workflow()
        .filter(&definition.id)
        .find(|row| row.version == 1)
        .ok_or("recovery version missing")?;
    let nodes = [
        definition_node("start", WorkflowNodeKind::Start, 1, None, None),
        definition_node(
            "approve",
            WorkflowNodeKind::HumanTask,
            2,
            Some(WorkflowTaskPolicy {
                kind: WorkflowHumanTaskKind::ApproveReject,
                assignment,
                candidate_role_ids: vec![role_id],
                candidate_group_ids: Vec::new(),
                candidate_unit_ids: Vec::new(),
                require_comment_on_reject: true,
            }),
            None,
        ),
        definition_node(
            "effect",
            WorkflowNodeKind::Action,
            3,
            None,
            Some(WorkflowActionReference {
                action_key: action.as_str().to_string(),
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
        definition_edge("approve-effect", "approve", "effect", 2, Some("approved")),
        definition_edge(
            "approve-rejected",
            "approve",
            "rejected",
            3,
            Some("rejected"),
        ),
        definition_edge("effect-done", "effect", "done", 4, None),
    ] {
        upsert_workflow_edge(ctx, fixture.organization_id, version.id, revision, edge)?;
        revision += 1;
    }
    publish_workflow_version(ctx, fixture.organization_id, version.id, revision)
}

fn migrate_recovery_fixture(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    task: &WorkflowHumanTask,
) -> Result<(), String> {
    let source = ctx
        .db
        .workflow_version()
        .id()
        .find(&task.workflow_version_id)
        .ok_or("recovery migration source missing")?;
    clone_workflow_version_to_draft(
        ctx,
        fixture.organization_id,
        source.id,
        source.draft_revision,
    )?;
    let draft = ctx
        .db
        .workflow_version()
        .workflow_version_by_workflow()
        .filter(&task.workflow_id)
        .find(|version| version.status == WorkflowVersionStatus::Draft)
        .ok_or("recovery migration draft missing")?;
    publish_workflow_version(ctx, fixture.organization_id, draft.id, draft.draft_revision)?;
    create_workflow_migration_plan(
        ctx,
        fixture.organization_id,
        CreateWorkflowMigrationPlanParams {
            company_id: fixture.company_id,
            workflow_id: task.workflow_id,
            source_workflow_version_id: source.id,
            target_workflow_version_id: draft.id,
            node_mappings: ["start", "approve", "effect", "done", "rejected"]
                .into_iter()
                .map(|key| WorkflowNodeMigrationMapping {
                    from_node_key: key.to_string(),
                    to_node_key: key.to_string(),
                })
                .collect(),
            fork_mappings: Vec::new(),
            edge_mappings: [
                "start-approve",
                "approve-effect",
                "approve-rejected",
                "effect-done",
            ]
            .into_iter()
            .map(|key| WorkflowEdgeMigrationMapping {
                from_edge_key: key.to_string(),
                to_edge_key: key.to_string(),
            })
            .collect(),
            active: true,
        },
    )?;
    let plan = ctx
        .db
        .workflow_migration_plan()
        .migration_plan_by_workflow()
        .filter(&task.workflow_id)
        .find(|plan| plan.target_workflow_version_id == draft.id)
        .ok_or("recovery migration plan missing")?;
    let instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&task.workflow_instance_id)
        .ok_or("recovery migration instance missing")?;
    migrate_workflow_instance(
        ctx,
        fixture.organization_id,
        MigrateWorkflowInstanceParams {
            company_id: fixture.company_id,
            plan_id: plan.id,
            instance_id: instance.id,
            expected_instance_revision: instance.revision,
            reason: "Retain earlier reviewed history across the published policy update"
                .to_string(),
            idempotency_key: format!("recovery-migration:{}", instance.id),
            correlation_id: format!("recovery-migration:{}", instance.id),
            causation_id: None,
        },
    )?;
    retire_workflow_version(
        ctx,
        fixture.organization_id,
        source.id,
        source.draft_revision,
    )
}

fn request(
    fixture: &OrgFixture,
    action: GuardedActionKey,
    subject_id: u64,
) -> RequestGuardedActionParams {
    RequestGuardedActionParams {
        company_id: fixture.company_id,
        input: GuardedActionInput::for_subject(&action, subject_id),
        idempotency_key: format!("fixed-{}:{subject_id}", action.as_str()),
        action,
        action_version: GUARDED_ACTION_SCHEMA_VERSION,
        correlation_id: format!("source:{subject_id}"),
        causation_id: None,
    }
}

fn requested_task(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    params: RequestGuardedActionParams,
) -> Result<WorkflowHumanTask, String> {
    match request_guarded_action(ctx, fixture.organization_id, params)? {
        GuardedActionGateOutcome::HumanTaskCreated { task_id, .. } => task_by_id(ctx, task_id),
        GuardedActionGateOutcome::DirectExecutionAllowed { .. } => {
            Err("recovery fixture did not enter approval".to_string())
        }
    }
}

fn assert_requested_task(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    params: RequestGuardedActionParams,
    expected: u64,
) -> Result<(), String> {
    if requested_task(ctx, fixture, params)?.id != expected {
        return Err("fixed source request did not follow the recovery successor".to_string());
    }
    Ok(())
}

fn task_by_id(ctx: &ReducerContext, id: u64) -> Result<WorkflowHumanTask, String> {
    ctx.db
        .workflow_human_task()
        .id()
        .find(&id)
        .ok_or_else(|| "recovery task missing".to_string())
}

fn recovery_link(ctx: &ReducerContext, id: u64) -> Result<WorkflowHumanTaskResubmission, String> {
    ctx.db
        .workflow_human_task_resubmission()
        .previous_task_id()
        .find(&id)
        .ok_or_else(|| "recovery link missing".to_string())
}

fn recovery_params(
    ctx: &ReducerContext,
    task: &WorkflowHumanTask,
    key: &str,
) -> Result<ResubmitWorkflowHumanTaskParams, String> {
    let instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&task.workflow_instance_id)
        .ok_or("recovery instance missing")?;
    Ok(ResubmitWorkflowHumanTaskParams {
        company_id: task.company_id,
        task_id: task.id,
        expected_task_revision: task.revision,
        expected_instance_revision: instance.revision,
        expected_subject_revision_hash: task.subject_revision_hash.clone(),
        reason: "Replace a cancelled attempt after reviewer access changed".to_string(),
        idempotency_key: format!("{key}:{}", task.id),
        correlation_id: format!("recovery:{}", task.id),
    })
}

fn cancel(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    task_id: u64,
    key: &str,
) -> Result<(), String> {
    let task = task_by_id(ctx, task_id)?;
    let instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&task.workflow_instance_id)
        .ok_or("cancel instance missing")?;
    cancel_workflow(
        ctx,
        fixture.organization_id,
        CancelWorkflowParams {
            company_id: fixture.company_id,
            instance_id: instance.id,
            expected_revision: instance.revision,
            reason: "Reviewer is no longer eligible".to_string(),
            idempotency_key: format!("{key}:{task_id}"),
            correlation_id: format!("cancel:{task_id}"),
            causation_id: None,
        },
    )
}

fn decision(
    ctx: &ReducerContext,
    task: &WorkflowHumanTask,
    key: &str,
) -> Result<DecideWorkflowHumanTaskParams, String> {
    let instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&task.workflow_instance_id)
        .ok_or("decision instance missing")?;
    Ok(DecideWorkflowHumanTaskParams {
        company_id: task.company_id,
        task_id: task.id,
        expected_task_revision: task.revision,
        expected_instance_revision: instance.revision,
        decision: WorkflowHumanTaskDecision::Approve,
        acting_for: None,
        comment: None,
        idempotency_key: format!("{key}:{}", task.id),
        correlation_id: format!("decision:{key}:{}", task.id),
        causation_id: None,
    })
}

fn membership(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    actor: Identity,
) -> Result<UserOrganization, String> {
    ctx.db
        .user_organization()
        .user_org_by_user()
        .filter(&actor)
        .find(|row| row.organization_id == fixture.organization_id)
        .ok_or_else(|| "operator membership missing".to_string())
}

fn with_operator_grants(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    permissions: &[&str],
    run: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let original = membership(ctx, fixture, ctx.sender())?;
    let profile = find_user_profile_for_organization(ctx, ctx.sender(), fixture.organization_id)
        .ok_or("operator profile missing")?;
    let profile_id = profile.id;
    let was_superuser = profile.is_superuser;
    let role_id = seed_role(ctx, fixture.organization_id, permissions.to_vec());
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: false,
        ..profile
    });
    ctx.db.user_organization().id().update(UserOrganization {
        role_id,
        ..original.clone()
    });
    let result = run();
    ctx.db.user_organization().id().update(original);
    let profile = ctx
        .db
        .user_profile()
        .id()
        .find(&profile_id)
        .ok_or("operator profile disappeared")?;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: was_superuser,
        ..profile
    });
    result
}

fn workflow_counts(ctx: &ReducerContext, fixture: &OrgFixture) -> (usize, usize, usize, usize) {
    (
        ctx.db
            .workflow_human_task()
            .human_task_by_org()
            .filter(&fixture.organization_id)
            .count(),
        ctx.db
            .workflow_instance()
            .instance_by_org()
            .filter(&fixture.organization_id)
            .count(),
        ctx.db
            .workflow_human_task_resubmission()
            .task_resubmission_by_company()
            .filter(&fixture.company_id)
            .count(),
        ctx.db
            .organization_commit()
            .organization_commit_by_organization()
            .filter(&fixture.organization_id)
            .count(),
    )
}

fn lifecycle_evidence_counts(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    task_id: u64,
) -> (usize, usize, usize, usize) {
    let (events, receipts) = task_evidence_counts(ctx, task_id);
    (
        ctx.db
            .organization_commit()
            .organization_commit_by_organization()
            .filter(&fixture.organization_id)
            .count(),
        events,
        receipts,
        ctx.db
            .audit_log()
            .audit_by_org()
            .filter(&fixture.organization_id)
            .count(),
    )
}

/// Compare the durable outcome against actual post-mutation rows, including
/// economic effects that a terminal task alone cannot reconstruct.
fn durable_lifecycle_changes(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    task: &WorkflowHumanTask,
    operation: &str,
) -> Result<Vec<OrganizationRowChange>, String> {
    let commits: Vec<_> = ctx
        .db
        .organization_commit()
        .organization_commit_by_organization()
        .filter(&fixture.organization_id)
        .filter(|row| row.operation_id == operation && row.correlation_id == task.correlation_id)
        .collect();
    let [commit] = commits.as_slice() else {
        return Err(format!(
            "Finance lifecycle did not record one exact {operation} outcome"
        ));
    };
    let mut changes: Vec<_> = ctx
        .db
        .organization_row_change()
        .organization_row_change_by_commit()
        .filter(&fixture.organization_id)
        .filter(|row| row.commit_sequence == commit.sequence)
        .collect();
    changes.sort_by_key(|row| row.ordinal);
    if changes.len() != commit.row_change_count as usize || commit.actor_identity != ctx.sender() {
        return Err("Finance lifecycle commit lost its actor or complete row set".to_string());
    }
    assert_committed_row(
        &changes,
        "workflow_human_task",
        serde_json::json!({"id": task.id}),
        task,
    )?;
    let instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&task.workflow_instance_id)
        .ok_or("Finance instance missing")?;
    assert_committed_row(
        &changes,
        "workflow_instance",
        serde_json::json!({"id": instance.id}),
        &instance,
    )?;
    for candidate in ctx
        .db
        .workflow_human_task_candidate()
        .human_task_candidate_by_task()
        .filter(&task.id)
    {
        assert_committed_row(
            &changes,
            "workflow_human_task_candidate",
            serde_json::json!({"id": candidate.id}),
            &candidate,
        )?;
    }
    for event in ctx
        .db
        .workflow_human_task_event()
        .human_task_event_by_task()
        .filter(&task.id)
    {
        assert_committed_row(
            &changes,
            "workflow_human_task_event",
            serde_json::json!({"id": event.id}),
            &event,
        )?;
    }
    for receipt in ctx
        .db
        .workflow_human_task_receipt()
        .human_task_receipt_by_task()
        .filter(&task.id)
    {
        assert_committed_row(
            &changes,
            "workflow_human_task_receipt",
            serde_json::json!({"scope_key": receipt.scope_key}),
            &receipt,
        )?;
        if receipt.command_kind == WorkflowHumanTaskCommandKind::Decision {
            if let Some(id) = receipt.domain_receipt {
                let effect = ctx
                    .db
                    .guarded_action_receipt()
                    .id()
                    .find(&id)
                    .ok_or("Finance decision receipt missing")?;
                assert_committed_row(
                    &changes,
                    "guarded_action_receipt",
                    serde_json::json!({"id": id}),
                    &effect,
                )?;
            }
        }
    }
    match task.subject_model.as_str() {
        "purchase_order" => {
            let order = ctx
                .db
                .purchase_order()
                .id()
                .find(&task.subject_id)
                .ok_or("Finance PO missing")?;
            assert_committed_row(
                &changes,
                "purchase_order",
                serde_json::json!({"id": order.id}),
                &order,
            )?;
            let vendor = ctx
                .db
                .contact()
                .id()
                .find(&order.partner_id)
                .ok_or("Finance vendor missing")?;
            assert_committed_row(
                &changes,
                "contact",
                serde_json::json!({"id": vendor.id}),
                &vendor,
            )?;
            for line in ctx
                .db
                .purchase_order_line()
                .purchase_order_line_by_order()
                .filter(&order.id)
            {
                assert_committed_row(
                    &changes,
                    "purchase_order_line",
                    serde_json::json!({"id": line.id}),
                    &line,
                )?;
            }
            for picking in ctx
                .db
                .stock_picking()
                .picking_by_org()
                .filter(&fixture.organization_id)
                .filter(|row| row.purchase_id == Some(order.id) && !row.is_return)
            {
                assert_committed_row(
                    &changes,
                    "stock_picking",
                    serde_json::json!({"id": picking.id}),
                    &picking,
                )?;
                for movement in ctx.db.stock_move().move_by_picking().filter(&picking.id) {
                    assert_committed_row(
                        &changes,
                        "stock_move",
                        serde_json::json!({"id": movement.id}),
                        &movement,
                    )?;
                }
            }
        }
        "account_payment" => {
            let payment = ctx
                .db
                .account_payment()
                .id()
                .find(&task.subject_id)
                .ok_or("Finance payment missing")?;
            assert_committed_row(
                &changes,
                "account_payment",
                serde_json::json!({"id": payment.id}),
                &payment,
            )?;
            if let Some(id) = payment.move_id {
                let entry = ctx
                    .db
                    .account_move()
                    .id()
                    .find(&id)
                    .ok_or("Finance journal entry missing")?;
                assert_committed_row(
                    &changes,
                    "account_move",
                    serde_json::json!({"id": id}),
                    &entry,
                )?;
                for line in ctx.db.account_move_line().move_line_by_move().filter(&id) {
                    assert_committed_row(
                        &changes,
                        "account_move_line",
                        serde_json::json!({"id": line.id}),
                        &line,
                    )?;
                }
                let sequence = ctx
                    .db
                    .document_sequence()
                    .sequence_key()
                    .find(&format!("{}:PAY", fixture.organization_id))
                    .ok_or("Finance PAY sequence missing")?;
                assert_committed_row(
                    &changes,
                    "document_sequence",
                    serde_json::json!({"sequence_key": sequence.sequence_key}),
                    &sequence,
                )?;
            }
        }
        _ => return Err("unexpected Finance lifecycle fixture source".to_string()),
    }
    for audit in ctx
        .db
        .audit_log()
        .audit_by_org()
        .filter(&fixture.organization_id)
        .filter(|row| {
            row.company_id == Some(fixture.company_id)
                && ((row.table_name == "workflow_human_task" && row.record_id == task.id)
                    || (row.table_name == task.subject_model && row.record_id == task.subject_id))
        })
    {
        assert_committed_row(
            &changes,
            "audit_log",
            serde_json::json!({"id": audit.id}),
            &audit,
        )?;
    }
    Ok(changes)
}

fn assert_durable_recovery(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    params: &ResubmitWorkflowHumanTaskParams,
    link: &WorkflowHumanTaskResubmission,
) -> Result<(), String> {
    let commits: Vec<_> = ctx
        .db
        .organization_commit()
        .organization_commit_by_organization()
        .filter(&fixture.organization_id)
        .filter(|row| {
            row.operation_id == "erp.resubmit_workflow_human_task"
                && row.correlation_id == params.correlation_id
        })
        .collect();
    let [commit] = commits.as_slice() else {
        return Err("resubmission did not record one exact durable outcome".to_string());
    };
    let mut changes: Vec<_> = ctx
        .db
        .organization_row_change()
        .organization_row_change_by_commit()
        .filter(&fixture.organization_id)
        .filter(|row| row.commit_sequence == commit.sequence)
        .collect();
    changes.sort_by_key(|row| row.ordinal);
    if commit.actor_identity != ctx.sender()
        || changes.len() != commit.row_change_count as usize
        || changes.iter().enumerate().any(|(ordinal, row)| {
            row.ordinal != ordinal as u32
                || row.organization_id != fixture.organization_id
                || row.change_kind != "upsert"
        })
    {
        return Err("recovery durable commit lost its actor, tenant or ordered rows".to_string());
    }
    for table in [
        "workflow",
        "workflow_version",
        "workflow_node",
        "workflow_edge",
        "workflow_token",
        "workflow_decision_event",
        "workflow_command_receipt",
        "audit_log",
    ] {
        if !changes.iter().any(|row| row.table_name == table) {
            return Err(format!("recovery durable history is missing {table}"));
        }
    }
    for task_id in [params.task_id, link.successor_task_id] {
        let task = task_by_id(ctx, task_id)?;
        assert_committed_row(
            &changes,
            "workflow_human_task",
            serde_json::json!({"id": task_id}),
            &task,
        )?;
        let instance = ctx
            .db
            .workflow_instance()
            .id()
            .find(&task.workflow_instance_id)
            .ok_or("durable recovery instance missing")?;
        assert_committed_row(
            &changes,
            "workflow_instance",
            serde_json::json!({"id": instance.id}),
            &instance,
        )?;
        for candidate in ctx
            .db
            .workflow_human_task_candidate()
            .human_task_candidate_by_task()
            .filter(&task_id)
        {
            assert_committed_row(
                &changes,
                "workflow_human_task_candidate",
                serde_json::json!({"id": candidate.id}),
                &candidate,
            )?;
        }
        for event in ctx
            .db
            .workflow_human_task_event()
            .human_task_event_by_task()
            .filter(&task_id)
        {
            assert_committed_row(
                &changes,
                "workflow_human_task_event",
                serde_json::json!({"id": event.id}),
                &event,
            )?;
            let version = ctx
                .db
                .workflow_version()
                .id()
                .find(&event.workflow_version_id)
                .ok_or("historical recovery event version missing")?;
            assert_committed_row(
                &changes,
                "workflow_version",
                serde_json::json!({"id": version.id}),
                &version,
            )?;
            for node in ctx
                .db
                .workflow_node()
                .workflow_node_by_version()
                .filter(&version.id)
            {
                assert_committed_row(
                    &changes,
                    "workflow_node",
                    serde_json::json!({"id": node.id}),
                    &node,
                )?;
            }
            for edge in ctx
                .db
                .workflow_edge()
                .workflow_edge_by_version()
                .filter(&version.id)
            {
                assert_committed_row(
                    &changes,
                    "workflow_edge",
                    serde_json::json!({"id": edge.id}),
                    &edge,
                )?;
            }
        }
        for receipt in ctx
            .db
            .workflow_human_task_receipt()
            .human_task_receipt_by_task()
            .filter(&task_id)
        {
            assert_committed_row(
                &changes,
                "workflow_human_task_receipt",
                serde_json::json!({"scope_key": receipt.scope_key}),
                &receipt,
            )?;
        }
    }
    assert_committed_row(
        &changes,
        "workflow_human_task_resubmission",
        serde_json::json!({"previous_task_id": params.task_id}),
        link,
    )?;
    if changes.last().map(|row| row.table_name.as_str()) != Some("workflow_human_task_resubmission")
    {
        return Err("recovery link was recorded before its task/history parents".to_string());
    }
    Ok(())
}

fn assert_committed_row<T: spacetimedb_sats::Serialize>(
    changes: &[OrganizationRowChange],
    table: &str,
    identity: serde_json::Value,
    expected: &T,
) -> Result<(), String> {
    let expected = serde_json::to_value(spacetimedb_sats::serde::SerdeWrapper::from_ref(expected))
        .map_err(|error| error.to_string())?;
    let rows: Vec<_> = changes
        .iter()
        .filter(|row| row.table_name == table && row.row_identity_json == identity.to_string())
        .collect();
    let [row] = rows.as_slice() else {
        return Err(format!(
            "recovery durable row is missing or duplicated: {table}/{identity}"
        ));
    };
    let stored: serde_json::Value = serde_json::from_str(
        row.row_json
            .as_deref()
            .ok_or("durable recovery row is empty")?,
    )
    .map_err(|error| error.to_string())?;
    if stored != expected {
        return Err(format!(
            "recovery durable row has stale or partial values: {table}/{identity}"
        ));
    }
    Ok(())
}

fn assert_exact_evidence(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    params: &ResubmitWorkflowHumanTaskParams,
    link: &WorkflowHumanTaskResubmission,
) -> Result<(), String> {
    let event = ctx
        .db
        .workflow_human_task_event()
        .id()
        .find(&link.event_id)
        .ok_or("recovery event missing")?;
    let receipt = ctx
        .db
        .workflow_human_task_receipt()
        .human_task_receipt_by_task()
        .filter(&params.task_id)
        .find(|row| {
            row.command_kind == WorkflowHumanTaskCommandKind::Resubmit
                && row.idempotency_key == params.idempotency_key
        })
        .ok_or("recovery receipt missing")?;
    if event.organization_id != fixture.organization_id
        || event.company_id != fixture.company_id
        || event.task_id != params.task_id
        || event.actor != ctx.sender()
        || event.acting_for.is_some()
        || event.prior_revision != params.expected_task_revision
        || event.next_revision != link.result_task_revision
        || event.next_status != WorkflowHumanTaskStatus::Cancelled
        || event.decision.is_some()
        || event.input_hash != link.input_hash
        || receipt.input_hash != link.input_hash
        || receipt.result_revision != link.result_task_revision
        || receipt.created_by != ctx.sender()
        || receipt.domain_receipt != event.domain_receipt
    {
        return Err(
            "recovery did not bind exact actor-owned event and receipt evidence".to_string(),
        );
    }
    Ok(())
}

fn expect_error(result: Result<(), String>, needle: &str) -> Result<(), String> {
    match result {
        Err(error) if error.contains(needle) => Ok(()),
        other => Err(format!(
            "expected recovery rejection containing {needle:?}, got {other:?}"
        )),
    }
}
