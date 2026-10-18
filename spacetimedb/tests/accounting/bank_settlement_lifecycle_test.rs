//! Runtime recovery proofs for approval-gated bank settlement generations.

use spacetimedb::{rand::Rng, Identity, ReducerContext, Table};

use crate::accounting::bank_reconciliation::{
    account_bank_statement, account_bank_statement_line, create_account_bank_statement,
    create_account_bank_statement_line, reconcile_account_bank_statement_line,
    CreateAccountBankStatementLineParams, CreateAccountBankStatementParams,
    ReconcileAccountBankStatementLineParams,
};
use crate::accounting::bank_settlement_lifecycle::{
    abandon_bank_statement_settlement, bank_statement_settlement_attempt,
    bank_statement_settlement_reversal, resubmit_bank_statement_settlement,
    AbandonBankStatementSettlementParams, BankStatementSettlementAttempt,
    ResubmitBankStatementSettlementParams,
};
use crate::accounting::idempotency::accounting_operation_receipt;
use crate::accounting::journal_entries::{account_move, account_move_line};
use crate::accounting::payments::{account_payment, post_payment};
use crate::core::audit::audit_log;
use crate::core::permissions::{role, Role};
use crate::core::persistence::{
    organization_commit, organization_commit_cursor, organization_row_change,
};
use crate::core::reference::document_sequence;
use crate::core::users::{
    find_user_profile_for_organization, user_organization, user_profile, UserOrganization,
    UserProfile,
};
use crate::sales::sales_core::sale_order;
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::PaymentState;
use crate::workflow::action_registry::guarded_action_receipt;
use crate::workflow::approvals::{
    decide_workflow_human_task_for_actor, invalidate_workflow_human_task, workflow_human_task,
    workflow_human_task_candidate, workflow_human_task_event, workflow_human_task_receipt,
    DecideWorkflowHumanTaskParams, InvalidateWorkflowHumanTaskParams, WorkflowHumanTask,
    WorkflowHumanTaskDecision, WorkflowHumanTaskStatus,
};
use crate::workflow::definitions::*;
use crate::workflow::runtime::{
    cancel_workflow, workflow_command_receipt, workflow_decision_event, workflow_instance,
    workflow_token, CancelWorkflowParams,
};

use super::helpers::{
    create_balanced_customer_invoice_on_account, seed_bank_journal, seed_sibling_company,
};

/// Includes full financial rows, approval evidence, command receipts and durable
/// commits so a denied/replayed call cannot hide extra workflow or audit writes.
pub(super) fn snapshot(ctx: &ReducerContext, org: u64) -> Result<String, String> {
    let mut tables = serde_json::Map::new();
    macro_rules! capture {
        ($accessor:ident) => {{
            let mut rows = ctx
                .db
                .$accessor()
                .iter()
                .filter(|row| row.organization_id == org)
                .map(|row| {
                    serde_json::to_value(spacetimedb_sats::serde::SerdeWrapper::from_ref(&row))
                        .map_err(|error| {
                            format!("cannot snapshot {}: {error}", stringify!($accessor))
                        })
                })
                .collect::<Result<Vec<_>, String>>()?;
            rows.sort_by_key(serde_json::Value::to_string);
            tables.insert(stringify!($accessor).into(), serde_json::Value::Array(rows));
        }};
    }
    capture!(document_sequence);
    capture!(guarded_action_receipt);
    capture!(sale_order);
    capture!(account_move);
    capture!(account_move_line);
    capture!(account_payment);
    capture!(account_bank_statement);
    capture!(account_bank_statement_line);
    capture!(bank_statement_settlement_attempt);
    capture!(bank_statement_settlement_reversal);
    capture!(accounting_operation_receipt);
    capture!(workflow_human_task);
    capture!(workflow_human_task_candidate);
    capture!(workflow_human_task_event);
    capture!(workflow_human_task_receipt);
    capture!(workflow_instance);
    capture!(workflow_token);
    capture!(workflow_decision_event);
    capture!(workflow_command_receipt);
    capture!(audit_log);
    capture!(organization_commit_cursor);
    capture!(organization_commit);
    capture!(organization_row_change);
    Ok(serde_json::Value::Object(tables).to_string())
}

fn unchanged(ctx: &ReducerContext, org: u64, before: &str, label: &str) -> Result<(), String> {
    if snapshot(ctx, org)? != before {
        return Err(format!(
            "{label} changed financial rows, workflow evidence or receipts"
        ));
    }
    Ok(())
}

fn denied<T>(result: Result<T, String>, label: &str) -> Result<(), String> {
    if result.is_ok() {
        return Err(format!("{label} was unexpectedly admitted"));
    }
    Ok(())
}

fn attempt(
    ctx: &ReducerContext,
    payment_id: u64,
) -> Result<BankStatementSettlementAttempt, String> {
    ctx.db
        .bank_statement_settlement_attempt()
        .payment_id()
        .find(payment_id)
        .ok_or_else(|| "bank recovery attempt missing".into())
}

fn active_payment(ctx: &ReducerContext, line_id: u64) -> Result<u64, String> {
    let line = ctx
        .db
        .account_bank_statement_line()
        .id()
        .find(line_id)
        .ok_or("recovery bank line missing")?;
    if line.is_reconciled || line.payment_ids.len() != 1 || line.amount_residual != 50.0 {
        return Err("pending recovery did not retain exactly one unposted bank payment".into());
    }
    let payment_id = line.payment_ids[0];
    let payment = ctx
        .db
        .account_payment()
        .id()
        .find(payment_id)
        .ok_or("recovery payment missing")?;
    if payment.state != PaymentState::NotPaid || payment.move_id.is_some() {
        return Err("approval recovery posted financial effects before a fresh decision".into());
    }
    Ok(payment_id)
}

fn task(ctx: &ReducerContext, org: u64, payment_id: u64) -> Result<WorkflowHumanTask, String> {
    let mut tasks = ctx
        .db
        .workflow_human_task()
        .human_task_by_org()
        .filter(org)
        .filter(|row| row.subject_model == "account_payment" && row.subject_id == payment_id);
    let task = tasks.next().ok_or("bank recovery approval task missing")?;
    if tasks.next().is_some() {
        return Err("bank recovery duplicated the approval task".into());
    }
    Ok(task)
}

fn decision(
    ctx: &ReducerContext,
    task: &WorkflowHumanTask,
    choice: WorkflowHumanTaskDecision,
    key: &str,
) -> Result<DecideWorkflowHumanTaskParams, String> {
    let instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(task.workflow_instance_id)
        .ok_or("bank approval instance missing")?;
    Ok(DecideWorkflowHumanTaskParams {
        company_id: task.company_id,
        task_id: task.id,
        expected_task_revision: task.revision,
        expected_instance_revision: instance.revision,
        decision: choice,
        acting_for: None,
        comment: Some("review bank recovery generation".into()),
        idempotency_key: key.into(),
        correlation_id: format!("bank-recovery-{}", task.subject_id),
        causation_id: None,
    })
}

fn seed_actor(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    membership: &UserOrganization,
    role_id: u64,
    company_id: u64,
    label: &str,
) -> Result<Identity, String> {
    let actor = Identity::from_byte_array(ctx.rng().gen::<[u8; 32]>());
    let profile = find_user_profile_for_organization(ctx, ctx.sender(), fixture.organization_id)
        .ok_or("bank recovery profile missing")?;
    ctx.db.user_profile().insert(UserProfile {
        id: 0,
        identity: actor,
        platform_user_id: format!("bank-recovery-{label}-{}", fixture.company_id),
        is_superuser: false,
        ..profile
    });
    ctx.db.user_organization().insert(UserOrganization {
        id: 0,
        user_identity: actor,
        company_id: Some(company_id),
        role_id,
        ..membership.clone()
    });
    Ok(actor)
}

fn publish_approval(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    candidate_role_id: u64,
) -> Result<(), String> {
    let key = format!("bank-recovery-approval-{}", fixture.company_id);
    create_workflow(
        ctx,
        fixture.organization_id,
        Some(fixture.company_id),
        CreateWorkflowParams {
            workflow_key: key.clone(),
            model: "account_payment".into(),
            name: "Bank recovery approval".into(),
            description: None,
            trigger: WorkflowTrigger::Manual,
            schema_version: 1,
            snapshot_fields: vec![],
            metadata: None,
        },
    )?;
    let definition = ctx
        .db
        .workflow()
        .workflow_by_key()
        .filter(key)
        .find(|row| row.organization_id == fixture.organization_id)
        .ok_or("recovery workflow missing")?;
    let version = ctx
        .db
        .workflow_version()
        .workflow_version_by_workflow()
        .filter(definition.id)
        .next()
        .ok_or("recovery workflow version missing")?;
    let mut revision = version.draft_revision;
    for (index, (key, kind)) in [
        ("start", WorkflowNodeKind::Start),
        ("approve", WorkflowNodeKind::HumanTask),
        ("post", WorkflowNodeKind::Action),
        ("done", WorkflowNodeKind::End),
        ("rejected", WorkflowNodeKind::End),
    ]
    .into_iter()
    .enumerate()
    {
        upsert_workflow_node(
            ctx,
            fixture.organization_id,
            version.id,
            revision,
            UpsertWorkflowNodeParams {
                node_key: key.into(),
                name: key.into(),
                kind,
                sequence: index as u32 + 1,
                split_kind: WorkflowBranchKind::None,
                join_kind: WorkflowBranchKind::None,
                action: (key == "post").then(|| WorkflowActionReference {
                    action_key: "post_payment".into(),
                    input_schema_version: 1,
                    input: vec![],
                }),
                task_policy: (key == "approve").then(|| WorkflowTaskPolicy {
                    kind: WorkflowHumanTaskKind::ApproveReject,
                    assignment: WorkflowTaskAssignment::AnyCandidate,
                    candidate_role_ids: vec![candidate_role_id],
                    candidate_group_ids: vec![],
                    candidate_unit_ids: vec![],
                    require_comment_on_reject: true,
                }),
                timer_policy: None,
                retry_policy: None,
                subflow: None,
                metadata: None,
            },
        )?;
        revision += 1;
    }
    for (index, (from, to, signal)) in [
        ("start", "approve", None),
        ("approve", "post", Some("approved")),
        ("approve", "rejected", Some("rejected")),
        ("post", "done", None),
    ]
    .into_iter()
    .enumerate()
    {
        upsert_workflow_edge(
            ctx,
            fixture.organization_id,
            version.id,
            revision,
            UpsertWorkflowEdgeParams {
                edge_key: format!("{from}-{to}"),
                from_node_key: from.into(),
                to_node_key: to.into(),
                sequence: index as u32 + 1,
                signal_key: signal.map(str::to_string),
                condition: None,
                metadata: None,
            },
        )?;
        revision += 1;
    }
    publish_workflow_version(ctx, fixture.organization_id, version.id, revision)
}

fn assert_generation(
    ctx: &ReducerContext,
    org: u64,
    line_id: u64,
    payment_id: u64,
    generation: u64,
    selected_line: u64,
    previous_payment: Option<u64>,
) -> Result<WorkflowHumanTask, String> {
    let current = attempt(ctx, payment_id)?;
    if current.generation != generation
        || current.previous_payment_id != previous_payment
        || current.status != "awaiting_approval"
        || current.line_snapshots.len() != 1
        || current.line_snapshots[0].line_id != selected_line
        || current.closed_at.is_some()
        || active_payment(ctx, line_id)? != payment_id
    {
        return Err(
            "fresh recovery generation did not pin its new payment and current selection".into(),
        );
    }
    let task = task(ctx, org, payment_id)?;
    if task.status != WorkflowHumanTaskStatus::Open
        || task.decided_by.is_some()
        || task.decision.is_some()
    {
        return Err("fresh bank recovery approval inherited an old decision".into());
    }
    Ok(task)
}

fn assert_retired(ctx: &ReducerContext, payment_id: u64) -> Result<(), String> {
    let old = attempt(ctx, payment_id)?;
    let payment = ctx
        .db
        .account_payment()
        .id()
        .find(payment_id)
        .ok_or("retired bank payment missing")?;
    if old.status != "abandoned"
        || old.closed_at.is_none()
        || payment.state != PaymentState::Reversed
        || payment.move_id.is_some()
    {
        return Err(
            "old unposted bank attempt did not become terminal without ledger effects".into(),
        );
    }
    Ok(())
}

/// Invoked by the existing accounting payment runner; no new test reducer ABI.
pub fn test_bank_settlement_recovery_replay_and_denials(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let company = fixture.company_id;
    let sibling = seed_sibling_company(ctx, &fixture)?;
    let ar = *fixture
        .chart_account_ids
        .get(chart_keys::AR)
        .ok_or("bank recovery AR missing")?;
    let first_invoice = create_balanced_customer_invoice_on_account(
        ctx,
        &fixture,
        50.0,
        ar,
        "bank-recovery-original",
        true,
    )?;
    let second_invoice = create_balanced_customer_invoice_on_account(
        ctx,
        &fixture,
        50.0,
        ar,
        "bank-recovery-reselected",
        true,
    )?;
    let target = |invoice_id| {
        ctx.db
            .account_move_line()
            .move_line_by_move()
            .filter(invoice_id)
            .find(|row| {
                row.account_internal_type
                    .as_deref()
                    .is_some_and(|kind| kind.eq_ignore_ascii_case("receivable"))
            })
            .map(|row| row.id)
            .ok_or_else(|| "bank recovery receivable missing".to_string())
    };
    let first = target(first_invoice)?;
    let second = target(second_invoice)?;
    let (journal_id, _) = seed_bank_journal(ctx, &fixture)?;
    create_account_bank_statement(
        ctx,
        org,
        company,
        journal_id,
        CreateAccountBankStatementParams {
            name: Some("Bank recovery generations".into()),
            reference: None,
            date: Some(ctx.timestamp),
            balance_start: 0.0,
            currency_id: fixture.currency_id,
            metadata: None,
        },
    )?;
    let statement = ctx
        .db
        .account_bank_statement()
        .bank_statement_by_org()
        .filter(org)
        .find(|row| row.journal_id == journal_id)
        .ok_or("bank recovery statement missing")?;
    create_account_bank_statement_line(
        ctx,
        org,
        company,
        statement.id,
        CreateAccountBankStatementLineParams {
            date: ctx.timestamp,
            amount: 50.0,
            amount_currency: 50.0,
            currency_id: Some(fixture.currency_id),
            foreign_currency_id: None,
            partner_id: Some(fixture.partner_id),
            bank_account_id: None,
            account_number: None,
            move_id: None,
            is_reconciled: false,
            transaction_type: None,
            move_ids: vec![],
            payment_ids: vec![],
            amount_residual: 50.0,
            auto_reconcile_ids: vec![],
            metadata: None,
        },
    )?;
    let line_id = ctx
        .db
        .account_bank_statement_line()
        .statement_line_by_statement()
        .filter(statement.id)
        .next()
        .ok_or("bank recovery line missing")?
        .id;
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(ctx.sender())
        .find(|row| row.organization_id == org)
        .ok_or("bank recovery membership missing")?;
    let owner = ctx
        .db
        .role()
        .id()
        .find(membership.role_id)
        .ok_or("bank recovery owner role missing")?;
    let approver_role = ctx.db.role().insert(Role {
        id: 0,
        name: format!("Bank recovery approver {company}"),
        permissions: vec![
            "workflow_task:approve".into(),
            "workflow_task:reject".into(),
            "payment:post".into(),
        ],
        is_system: false,
        ..owner.clone()
    });
    let actor = seed_actor(
        ctx,
        &fixture,
        &membership,
        approver_role.id,
        company,
        "candidate",
    )?;
    let foreign_company_actor = seed_actor(
        ctx,
        &fixture,
        &membership,
        approver_role.id,
        sibling,
        "foreign-company",
    )?;
    let outsider = seed_actor(
        ctx,
        &fixture,
        &membership,
        owner.id,
        company,
        "noncandidate",
    )?;
    publish_approval(ctx, &fixture, approver_role.id)?;
    let select = |id| ReconcileAccountBankStatementLineParams {
        move_ids: vec![id],
        amount_residual: 0.0,
    };
    let resubmit = |payment_id, id, key: &str| ResubmitBankStatementSettlementParams {
        payment_id,
        move_ids: vec![id],
        idempotency_key: key.into(),
        reason: "review fresh outstanding item".into(),
    };
    let abandon = |payment_id, key: &str| AbandonBankStatementSettlementParams {
        payment_id,
        idempotency_key: key.into(),
        reason: "stop rejected unposted settlement".into(),
    };
    reconcile_account_bank_statement_line(ctx, org, company, line_id, select(first))?;
    let first_payment = active_payment(ctx, line_id)?;
    let first_task = assert_generation(ctx, org, line_id, first_payment, 1, first, None)?;
    let before = snapshot(ctx, org)?;
    denied(
        abandon_bank_statement_settlement(
            ctx,
            org,
            company,
            line_id,
            abandon(first_payment, "open-abandon"),
        ),
        "open approval abandon",
    )?;
    denied(
        resubmit_bank_statement_settlement(
            ctx,
            org,
            company,
            line_id,
            resubmit(first_payment, second, "open-resubmit"),
        ),
        "open approval resubmit",
    )?;
    let approve = decision(
        ctx,
        &first_task,
        WorkflowHumanTaskDecision::Approve,
        "wrong-actor-approve",
    )?;
    denied(
        decide_workflow_human_task_for_actor(ctx, org, outsider, approve.clone()),
        "noncandidate approval",
    )?;
    denied(
        decide_workflow_human_task_for_actor(ctx, org, foreign_company_actor, approve.clone()),
        "foreign-company actor approval",
    )?;
    let mut wrong_company = approve.clone();
    wrong_company.company_id = sibling;
    denied(
        decide_workflow_human_task_for_actor(ctx, org, actor, wrong_company),
        "wrong-company task decision",
    )?;
    let mut stale_task = approve.clone();
    stale_task.expected_task_revision += 1;
    denied(
        decide_workflow_human_task_for_actor(ctx, org, actor, stale_task),
        "stale current task revision",
    )?;
    let mut stale_instance = approve.clone();
    stale_instance.expected_instance_revision += 1;
    denied(
        decide_workflow_human_task_for_actor(ctx, org, actor, stale_instance),
        "stale current workflow revision",
    )?;
    ctx.db.role().id().update(Role {
        permissions: vec![],
        ..approver_role.clone()
    });
    let no_capability = decide_workflow_human_task_for_actor(ctx, org, actor, approve);
    ctx.db.role().id().update(approver_role);
    denied(no_capability, "revoked approval capability")?;
    unchanged(ctx, org, &before, "open recovery or unauthorized decision")?;
    let rejected = decision(
        ctx,
        &first_task,
        WorkflowHumanTaskDecision::Reject,
        "reject-generation-one",
    )?;
    decide_workflow_human_task_for_actor(ctx, org, actor, rejected.clone())?;
    if attempt(ctx, first_payment)?.status != "approval_rejected" {
        return Err("rejection did not project a recoverable bank state".into());
    }
    let before = snapshot(ctx, org)?;
    decide_workflow_human_task_for_actor(ctx, org, actor, rejected.clone())?;
    unchanged(ctx, org, &before, "replayed rejection")?;
    denied(
        resubmit_bank_statement_settlement(
            ctx,
            org,
            sibling,
            line_id,
            resubmit(first_payment, second, "wrong-company-recover"),
        ),
        "foreign-company recovery",
    )?;
    let profile = find_user_profile_for_organization(ctx, ctx.sender(), org)
        .ok_or("recovery operator missing")?;
    ctx.db.role().id().update(Role {
        permissions: vec![],
        ..owner.clone()
    });
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: false,
        ..profile.clone()
    });
    let denied_abandon = abandon_bank_statement_settlement(
        ctx,
        org,
        company,
        line_id,
        abandon(first_payment, "denied-abandon"),
    );
    let denied_resubmit = resubmit_bank_statement_settlement(
        ctx,
        org,
        company,
        line_id,
        resubmit(first_payment, second, "denied-resubmit"),
    );
    ctx.db.role().id().update(owner);
    ctx.db.user_profile().id().update(profile);
    denied(denied_abandon, "operator without cancel/write authority")?;
    denied(
        denied_resubmit,
        "operator without create/post/reconcile authority",
    )?;
    unchanged(ctx, org, &before, "denied recovery")?;
    let fresh = resubmit(first_payment, second, "recover-rejected-generation");
    resubmit_bank_statement_settlement(ctx, org, company, line_id, fresh.clone())?;
    let second_payment = active_payment(ctx, line_id)?;
    let second_task = assert_generation(
        ctx,
        org,
        line_id,
        second_payment,
        2,
        second,
        Some(first_payment),
    )?;
    assert_retired(ctx, first_payment)?;
    if second_task.id == first_task.id
        || second_task.workflow_instance_id == first_task.workflow_instance_id
    {
        return Err("resubmission reused a closed approval".into());
    }
    let before = snapshot(ctx, org)?;
    resubmit_bank_statement_settlement(ctx, org, company, line_id, fresh.clone())?;
    let mut collision = fresh;
    collision.move_ids = vec![first];
    denied(
        resubmit_bank_statement_settlement(ctx, org, company, line_id, collision),
        "changed resubmit key payload",
    )?;
    denied(
        post_payment(ctx, org, first_payment),
        "posting abandoned payment",
    )?;
    denied(
        decide_workflow_human_task_for_actor(
            ctx,
            org,
            actor,
            decision(
                ctx,
                &task(ctx, org, first_payment)?,
                WorkflowHumanTaskDecision::Approve,
                "late-old-approval",
            )?,
        ),
        "late rejected task approval",
    )?;
    unchanged(
        ctx,
        org,
        &before,
        "recovery replay, key collision or old approval/payment",
    )?;
    invalidate_workflow_human_task(
        ctx,
        org,
        InvalidateWorkflowHumanTaskParams {
            company_id: company,
            task_id: second_task.id,
            expected_revision: second_task.revision,
            observed_subject_revision_hash: format!(
                "superseded-{}",
                second_task.subject_revision_hash
            ),
            reason: "review invalidated before posting".into(),
            idempotency_key: "invalidate-generation-two".into(),
            correlation_id: "bank-recovery-invalidation".into(),
        },
    )?;
    if attempt(ctx, second_payment)?.status != "approval_invalidated" {
        return Err("invalidation did not project a recoverable bank state".into());
    }
    resubmit_bank_statement_settlement(
        ctx,
        org,
        company,
        line_id,
        resubmit(second_payment, first, "recover-invalidated-generation"),
    )?;
    let third_payment = active_payment(ctx, line_id)?;
    let third_task = assert_generation(
        ctx,
        org,
        line_id,
        third_payment,
        3,
        first,
        Some(second_payment),
    )?;
    assert_retired(ctx, second_payment)?;
    let instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(third_task.workflow_instance_id)
        .ok_or("cancelled recovery instance missing")?;
    cancel_workflow(
        ctx,
        org,
        CancelWorkflowParams {
            company_id: company,
            instance_id: instance.id,
            expected_revision: instance.revision,
            reason: "operator cancelled the unposted approval".into(),
            idempotency_key: "cancel-generation-three".into(),
            correlation_id: "bank-recovery-cancellation".into(),
            causation_id: None,
        },
    )?;
    if attempt(ctx, third_payment)?.status != "approval_cancelled" {
        return Err("workflow cancellation did not project a recoverable bank state".into());
    }
    resubmit_bank_statement_settlement(
        ctx,
        org,
        company,
        line_id,
        resubmit(third_payment, second, "recover-cancelled-generation"),
    )?;
    let fourth_payment = active_payment(ctx, line_id)?;
    let fourth_task = assert_generation(
        ctx,
        org,
        line_id,
        fourth_payment,
        4,
        second,
        Some(third_payment),
    )?;
    assert_retired(ctx, third_payment)?;
    let before = snapshot(ctx, org)?;
    for (payment_id, old_task) in [
        (second_payment, task(ctx, org, second_payment)?),
        (third_payment, task(ctx, org, third_payment)?),
    ] {
        denied(
            post_payment(ctx, org, payment_id),
            "posting invalidated/cancelled old payment",
        )?;
        denied(
            decide_workflow_human_task_for_actor(
                ctx,
                org,
                actor,
                decision(
                    ctx,
                    &old_task,
                    WorkflowHumanTaskDecision::Approve,
                    &format!("late-approval-{payment_id}"),
                )?,
            ),
            "late invalidated/cancelled approval",
        )?;
    }
    unchanged(
        ctx,
        org,
        &before,
        "terminal invalidated/cancelled generation",
    )?;
    decide_workflow_human_task_for_actor(
        ctx,
        org,
        actor,
        decision(
            ctx,
            &fourth_task,
            WorkflowHumanTaskDecision::Reject,
            "reject-generation-four",
        )?,
    )?;
    let stop = abandon(fourth_payment, "abandon-generation-four");
    abandon_bank_statement_settlement(ctx, org, company, line_id, stop.clone())?;
    assert_retired(ctx, fourth_payment)?;
    let line = ctx
        .db
        .account_bank_statement_line()
        .id()
        .find(line_id)
        .ok_or("abandoned bank line missing")?;
    if !line.payment_ids.is_empty()
        || !line.move_ids.is_empty()
        || line.move_id.is_some()
        || line.is_reconciled
        || line.amount_residual != 50.0
    {
        return Err(
            "explicit abandon did not reopen the bank line without accounting allocation".into(),
        );
    }
    let before = snapshot(ctx, org)?;
    abandon_bank_statement_settlement(ctx, org, company, line_id, stop.clone())?;
    let mut collision = stop;
    collision.reason = "different stop reason".into();
    denied(
        abandon_bank_statement_settlement(ctx, org, company, line_id, collision),
        "changed abandon key payload",
    )?;
    denied(
        post_payment(ctx, org, fourth_payment),
        "posting explicitly abandoned generation",
    )?;
    unchanged(ctx, org, &before, "abandon replay or conflicting key")?;
    reconcile_account_bank_statement_line(ctx, org, company, line_id, select(first))?;
    let fifth_payment = active_payment(ctx, line_id)?;
    let fifth_task = assert_generation(ctx, org, line_id, fifth_payment, 5, first, None)?;
    decide_workflow_human_task_for_actor(
        ctx,
        org,
        actor,
        decision(
            ctx,
            &fifth_task,
            WorkflowHumanTaskDecision::Approve,
            "approve-fresh-generation-five",
        )?,
    )?;
    reconcile_account_bank_statement_line(ctx, org, company, line_id, select(first))?;
    let first_invoice = ctx
        .db
        .account_move()
        .id()
        .find(first_invoice)
        .ok_or("freshly settled invoice missing")?;
    let second_invoice = ctx
        .db
        .account_move()
        .id()
        .find(second_invoice)
        .ok_or("unselected invoice missing")?;
    let bank = ctx
        .db
        .account_bank_statement_line()
        .id()
        .find(line_id)
        .ok_or("settled recovery line missing")?;
    if first_invoice.amount_residual != 0.0
        || first_invoice.payment_state != PaymentState::Paid
        || second_invoice.amount_residual != 50.0
        || !bank.is_reconciled
        || bank.amount_residual != 0.0
        || attempt(ctx, fifth_payment)?.status != "settled"
    {
        return Err("fresh approval did not settle only the newly reviewed invoice".into());
    }
    Ok(())
}
