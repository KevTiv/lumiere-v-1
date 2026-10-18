/// Payment registration and invoice reconciliation domain tests.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::bank_reconciliation::{
    account_bank_statement, account_bank_statement_line, create_account_bank_statement,
    create_account_bank_statement_line, delete_account_bank_statement_line,
    reconcile_account_bank_statement_line, unreconciled_account_bank_statement_line,
    update_account_bank_statement_line, CreateAccountBankStatementLineParams,
    CreateAccountBankStatementParams, ReconcileAccountBankStatementLineParams,
    UnreconcileAccountBankStatementLineParams, UpdateAccountBankStatementLineParams,
};
use crate::accounting::journal_entries::{
    account_move, account_move_line, reconcile_payment_with_invoice,
};
use crate::accounting::payment_management::payment_transaction;
use crate::accounting::payments::{
    account_payment, cancel_payment, create_payment, post_payment, register_payment_on_invoice,
    unregister_payment_allocations, CreatePaymentParams,
};
use crate::core::audit::audit_log;
use crate::core::organization::company;
use crate::core::permissions::{role, Role};
use crate::core::users::{
    find_user_profile_for_organization, user_organization, user_profile, UserProfile,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{PartnerType, PaymentState, PaymentType};

use super::helpers::{
    create_balanced_customer_invoice, create_balanced_customer_invoice_on_account,
    seed_bank_journal, seed_distinctive_ar_account, seed_sibling_company,
};
use crate::test_harness::chart_keys;

fn settlement_financial_snapshot(ctx: &ReducerContext, organization_id: u64) -> String {
    let moves: Vec<_> = ctx
        .db
        .account_move()
        .iter()
        .filter(|row| row.organization_id == organization_id)
        .map(|row| {
            (
                row.id,
                row.amount_residual,
                format!("{:?}", row.payment_state),
                format!("{:?}", row.write_date),
            )
        })
        .collect();
    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .iter()
        .filter(|row| row.organization_id == organization_id)
        .map(|row| {
            (
                row.id,
                row.amount_residual,
                row.amount_residual_currency,
                row.debit,
                row.credit,
                row.matching_number,
                format!("{:?}", row.write_date),
            )
        })
        .collect();
    let payments: Vec<_> = ctx
        .db
        .account_payment()
        .iter()
        .filter(|row| row.organization_id == organization_id)
        .map(|row| {
            (
                row.id,
                row.amount,
                row.move_id,
                format!("{:?}", row.state),
                row.reconciled_invoice_ids,
                row.reconciled_bill_ids,
            )
        })
        .collect();
    let bank: Vec<_> = ctx
        .db
        .account_bank_statement_line()
        .iter()
        .filter(|row| row.organization_id == organization_id)
        .map(|row| {
            (
                row.id,
                row.is_reconciled,
                row.amount_residual,
                row.move_ids,
                row.payment_ids,
                format!("{:?}", row.write_date),
            )
        })
        .collect();
    let audit = ctx
        .db
        .audit_log()
        .iter()
        .filter(|row| row.organization_id == organization_id)
        .count();
    serde_json::json!([moves, lines, payments, bank, audit]).to_string()
}

/// Exact bank settlement creates one posted payment, actually clears invoice and
/// clearing residuals, and rejects stale/replayed/denied commands without effects.
pub fn test_bank_statement_settlement_exact_effect(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let company_id = fixture.company_id;
    let ar_account_id = *fixture
        .chart_account_ids
        .get(chart_keys::AR)
        .ok_or("settlement AR account missing")?;
    let invoice_ids = [
        create_balanced_customer_invoice_on_account(
            ctx,
            &fixture,
            0.1,
            ar_account_id,
            "bank-settlement-decimal-first",
            true,
        )?,
        create_balanced_customer_invoice_on_account(
            ctx,
            &fixture,
            0.2,
            ar_account_id,
            "bank-settlement-decimal-second",
            true,
        )?,
    ];
    let (journal_id, liquidity_id) = seed_bank_journal(ctx, &fixture)?;
    create_account_bank_statement(
        ctx,
        org,
        company_id,
        journal_id,
        CreateAccountBankStatementParams {
            name: Some("Exact bank settlement".to_string()),
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
        .filter(&org)
        .find(|row| row.journal_id == journal_id)
        .ok_or("settlement statement missing")?;
    create_account_bank_statement_line(
        ctx,
        org,
        company_id,
        statement.id,
        CreateAccountBankStatementLineParams {
            date: ctx.timestamp,
            amount: 0.3,
            amount_currency: 0.3,
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
            amount_residual: 0.3,
            auto_reconcile_ids: vec![],
            metadata: None,
        },
    )?;
    let bank = ctx
        .db
        .account_bank_statement_line()
        .statement_line_by_statement()
        .filter(&statement.id)
        .next()
        .ok_or("settlement bank line missing")?;
    let target_ids: Vec<_> = invoice_ids
        .iter()
        .map(|invoice_id| {
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
                .ok_or("invoice receivable missing")
        })
        .collect::<Result<_, _>>()?;
    let params = ReconcileAccountBankStatementLineParams {
        move_ids: target_ids.clone(),
        amount_residual: 0.0,
    };
    let forged = create_account_bank_statement_line(
        ctx,
        org,
        company_id,
        statement.id,
        CreateAccountBankStatementLineParams {
            date: ctx.timestamp,
            amount: 0.3,
            amount_currency: 0.3,
            currency_id: Some(fixture.currency_id),
            foreign_currency_id: None,
            partner_id: Some(fixture.partner_id),
            bank_account_id: None,
            account_number: None,
            move_id: Some(invoice_ids[0]),
            is_reconciled: true,
            transaction_type: None,
            move_ids: target_ids.clone(),
            payment_ids: vec![99999],
            amount_residual: 0.0,
            auto_reconcile_ids: vec![],
            metadata: None,
        },
    );
    if forged.is_ok()
        || ctx
            .db
            .account_bank_statement_line()
            .statement_line_by_statement()
            .filter(&statement.id)
            .count()
            != 1
    {
        return Err("generic bank create accepted forged settlement provenance".to_string());
    }
    let before = settlement_financial_snapshot(ctx, org);
    for invalid in [
        ReconcileAccountBankStatementLineParams {
            move_ids: vec![target_ids[0]],
            amount_residual: 0.0,
        },
        ReconcileAccountBankStatementLineParams {
            move_ids: vec![target_ids[0], target_ids[0]],
            amount_residual: 0.0,
        },
        ReconcileAccountBankStatementLineParams {
            move_ids: target_ids.clone(),
            amount_residual: 1.0,
        },
    ] {
        if reconcile_account_bank_statement_line(ctx, org, company_id, bank.id, invalid).is_ok()
            || settlement_financial_snapshot(ctx, org) != before
        {
            return Err("invalid exact bank selection changed financial state".to_string());
        }
    }
    if reconcile_account_bank_statement_line(ctx, org, company_id + 9999, bank.id, params.clone())
        .is_ok()
        || settlement_financial_snapshot(ctx, org) != before
    {
        return Err("cross-company bank settlement changed financial state".to_string());
    }
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|row| row.organization_id == org)
        .ok_or("settlement membership missing")?;
    let owner_role = ctx
        .db
        .role()
        .id()
        .find(&membership.role_id)
        .ok_or("settlement owner role missing")?;
    let profile = find_user_profile_for_organization(ctx, ctx.sender(), org)
        .ok_or("settlement caller missing")?;
    let profile_id = profile.id;
    let was_superuser = profile.is_superuser;
    ctx.db.role().id().update(Role {
        permissions: vec![],
        ..owner_role.clone()
    });
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: false,
        ..profile
    });
    let denied =
        reconcile_account_bank_statement_line(ctx, org, company_id, bank.id, params.clone());
    ctx.db.role().id().update(owner_role);
    let profile = ctx
        .db
        .user_profile()
        .id()
        .find(&profile_id)
        .ok_or("settlement caller disappeared")?;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: was_superuser,
        ..profile
    });
    if denied.is_ok() || settlement_financial_snapshot(ctx, org) != before {
        return Err("denied bank settlement changed financial state".to_string());
    }
    // Simulate a concurrent allocation after the operator's review.
    let target = ctx
        .db
        .account_move_line()
        .id()
        .find(&target_ids[0])
        .ok_or("stale target missing")?;
    ctx.db
        .account_move_line()
        .id()
        .update(crate::accounting::journal_entries::AccountMoveLine {
            amount_residual: 0.0,
            ..target.clone()
        });
    let stale_before = settlement_financial_snapshot(ctx, org);
    let stale =
        reconcile_account_bank_statement_line(ctx, org, company_id, bank.id, params.clone());
    if stale.is_ok() || settlement_financial_snapshot(ctx, org) != stale_before {
        return Err("stale bank settlement changed financial state".to_string());
    }
    ctx.db.account_move_line().id().update(target);
    reconcile_account_bank_statement_line(ctx, org, company_id, bank.id, params.clone())?;
    let settled = ctx
        .db
        .account_bank_statement_line()
        .id()
        .find(&bank.id)
        .ok_or("settled bank line missing")?;
    if !settled.is_reconciled || settled.amount_residual != 0.0 || settled.payment_ids.len() != 1 {
        return Err("bank line was not settled with one payment".to_string());
    }
    let payment_id = settled.payment_ids[0];
    let payment = ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("bank payment missing")?;
    if payment.state != PaymentState::Paid
        || payment.amount != 0.3
        || payment.reconciled_invoice_ids.len() != 2
    {
        return Err("bank settlement did not post and allocate one exact payment".to_string());
    }
    let move_id = payment.move_id.ok_or("bank payment move missing")?;
    let posted_lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .collect();
    if !posted_lines
        .iter()
        .any(|row| row.account_id == liquidity_id && row.debit == 0.3 && row.credit == 0.0)
        || posted_lines.iter().any(|row| {
            row.account_internal_type
                .as_deref()
                .is_some_and(|kind| kind.eq_ignore_ascii_case("receivable"))
                && row.amount_residual != 0.0
        })
        || invoice_ids.iter().any(|id| {
            ctx.db.account_move().id().find(id).is_none_or(|row| {
                row.amount_residual != 0.0 || row.payment_state != PaymentState::Paid
            })
        })
    {
        return Err(
            "bank settlement did not clear canonical invoice and payment residuals".to_string(),
        );
    }
    let after = settlement_financial_snapshot(ctx, org);
    let replay = reconcile_account_bank_statement_line(ctx, org, company_id, bank.id, params);
    let unlink = unreconciled_account_bank_statement_line(
        ctx,
        org,
        company_id,
        bank.id,
        UnreconcileAccountBankStatementLineParams {
            move_ids: vec![],
            amount_residual: 0.3,
        },
    );
    let cancel = cancel_payment(ctx, org, payment_id);
    let unregister = unregister_payment_allocations(ctx, org, payment_id);
    let delete = delete_account_bank_statement_line(ctx, org, company_id, bank.id);
    // Even the operational reversal path must reject bank-owned ledger payments
    // before creating a correcting payment, mutation or approval request.
    let operational = ctx.db.payment_transaction().insert(
        crate::accounting::payment_management::PaymentTransaction {
            id: 0,
            organization_id: org,
            company_id,
            payment_account_id: 0,
            direction: crate::types::PaymentDirection::Inbound,
            partner_type: PartnerType::Customer,
            partner_id: fixture.partner_id,
            external_reference: None,
            reference_fingerprint: String::new(),
            gross_external_amount: 0.3,
            settlement_amount: 0.3,
            net_account_amount: 0.3,
            currency_id: fixture.currency_id,
            occurred_at: ctx.timestamp,
            status: crate::types::PaymentTransactionStatus::Posted,
            account_payment_id: Some(payment_id),
            source_entity: None,
            source_entity_id: None,
            evidence_document_ids: vec![],
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            created_by: ctx.sender(),
            updated_by: ctx.sender(),
            voided_at: None,
            metadata: None,
        },
    );
    let reverse = crate::accounting::payment_management::reverse_payment_transaction(
        ctx,
        org,
        operational.id,
        crate::accounting::payment_management::ReversePaymentTransactionParams {
            company_id,
            reason: None,
            metadata: None,
        },
    );
    if !matches!(&reverse, Err(error) if error.contains("bank-linked payments require a dedicated bank settlement reversal"))
    {
        return Err(
            "operational reversal did not reach the bank-ownership guard before mutation"
                .to_string(),
        );
    }
    ctx.db.payment_transaction().id().delete(&operational.id);
    let edit = update_account_bank_statement_line(
        ctx,
        org,
        company_id,
        bank.id,
        UpdateAccountBankStatementLineParams {
            date: None,
            amount: Some(200.0),
            amount_currency: None,
            currency_id: None,
            foreign_currency_id: None,
            partner_id: None,
            bank_account_id: None,
            account_number: None,
            move_id: None,
            is_reconciled: None,
            transaction_type: None,
            move_ids: None,
            payment_ids: Some(vec![]),
            amount_residual: None,
            auto_reconcile_ids: None,
            metadata: None,
        },
    );
    if [replay, unlink, cancel, unregister, delete, edit, reverse]
        .iter()
        .any(Result::is_ok)
        || settlement_financial_snapshot(ctx, org) != after
    {
        return Err(
            "replay, unlink, edit, cancellation or unwind changed settled bank effects".to_string(),
        );
    }
    Ok(())
}

/// A real published approval workflow must hold the payment in draft. Human
/// approval posts it, and only an explicit continuation settles the bank line.
pub fn test_bank_settlement_approval_and_last_cent(ctx: &ReducerContext) -> Result<(), String> {
    use crate::core::users::UserOrganization;
    use crate::workflow::approvals::{
        decide_workflow_human_task_for_actor, workflow_human_task, DecideWorkflowHumanTaskParams,
        WorkflowHumanTaskDecision,
    };
    use crate::workflow::definitions::*;
    use crate::workflow::runtime::workflow_instance;
    use spacetimedb::rand::Rng;
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let company_id = fixture.company_id;
    let invoice_id = create_balanced_customer_invoice(ctx, &fixture, 100.0, true)?;
    let (journal_id, _) = seed_bank_journal(ctx, &fixture)?;
    create_payment(
        ctx,
        org,
        CreatePaymentParams {
            idempotency_key: "bank-last-cent-prior-payment".to_string(),
            company_id,
            payment_type: PaymentType::InBound,
            partner_type: PartnerType::Customer,
            partner_id: fixture.partner_id,
            amount: 99.99,
            currency_id: fixture.currency_id,
            date: Some(ctx.timestamp),
            journal_id,
            ref_: Some("bank-last-cent-prior".to_string()),
            memo: None,
        },
    )?;
    let prior = ctx
        .db
        .account_payment()
        .payment_by_org()
        .filter(&org)
        .find(|row| row.ref_.as_deref() == Some("bank-last-cent-prior"))
        .ok_or("prior payment missing")?;
    post_payment(ctx, org, prior.id)?;
    register_payment_on_invoice(ctx, org, prior.id, vec![invoice_id], false)?;
    // An ordinary posted, unallocated payment exercises the second-argument
    // registration bypass without depending on an already exhausted payment.
    create_payment(
        ctx,
        org,
        CreatePaymentParams {
            idempotency_key: "bank-counterpart-adversarial-payment".to_string(),
            company_id,
            payment_type: PaymentType::InBound,
            partner_type: PartnerType::Customer,
            partner_id: fixture.partner_id,
            amount: 0.01,
            currency_id: fixture.currency_id,
            date: Some(ctx.timestamp),
            journal_id,
            ref_: Some("bank-counterpart-adversarial".to_string()),
            memo: None,
        },
    )?;
    let ordinary_payment = ctx
        .db
        .account_payment()
        .payment_by_org()
        .filter(&org)
        .find(|row| row.ref_.as_deref() == Some("bank-counterpart-adversarial"))
        .ok_or("adversarial ordinary payment missing")?;
    post_payment(ctx, org, ordinary_payment.id)?;
    let target = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&invoice_id)
        .find(|row| {
            row.account_internal_type
                .as_deref()
                .is_some_and(|kind| kind.eq_ignore_ascii_case("receivable"))
        })
        .ok_or("last-cent target missing")?;
    let target_id = target.id;
    // Reproduce a residual persisted by the previous f64 allocation implementation.
    ctx.db
        .account_move_line()
        .id()
        .update(crate::accounting::journal_entries::AccountMoveLine {
            amount_residual: 100.0 - 99.99,
            amount_residual_currency: 100.0 - 99.99,
            ..target
        });
    create_account_bank_statement(
        ctx,
        org,
        company_id,
        journal_id,
        CreateAccountBankStatementParams {
            name: Some("Last cent approval".to_string()),
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
        .filter(&org)
        .next()
        .ok_or("approval statement missing")?;
    create_account_bank_statement_line(
        ctx,
        org,
        company_id,
        statement.id,
        CreateAccountBankStatementLineParams {
            date: ctx.timestamp,
            amount: 0.01,
            amount_currency: 0.01,
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
            amount_residual: 0.01,
            auto_reconcile_ids: vec![],
            metadata: None,
        },
    )?;
    let bank_id = ctx
        .db
        .account_bank_statement_line()
        .statement_line_by_statement()
        .filter(&statement.id)
        .next()
        .ok_or("approval bank line missing")?
        .id;
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|row| row.organization_id == org)
        .ok_or("approval role missing")?;
    let owner_role = ctx
        .db
        .role()
        .id()
        .find(&membership.role_id)
        .ok_or("approval owner role missing")?;
    let approver_role = ctx.db.role().insert(Role {
        id: 0,
        name: format!("Bank approver {company_id}"),
        permissions: vec![
            "workflow_task:approve".to_string(),
            "workflow_task:reject".to_string(),
            "payment:post".to_string(),
        ],
        is_system: false,
        ..owner_role
    });
    let role_id = approver_role.id;
    let actor = spacetimedb::Identity::from_byte_array(ctx.rng().gen::<[u8; 32]>());
    let profile = find_user_profile_for_organization(ctx, ctx.sender(), org)
        .ok_or("approval profile missing")?;
    ctx.db.user_profile().insert(UserProfile {
        id: 0,
        identity: actor,
        platform_user_id: format!("bank-approver-{company_id}"),
        is_superuser: false,
        ..profile
    });
    ctx.db.user_organization().insert(UserOrganization {
        id: 0,
        user_identity: actor,
        role_id,
        ..membership
    });
    let workflow_key = format!("bank-payment-approval-{company_id}");
    create_workflow(
        ctx,
        org,
        Some(company_id),
        CreateWorkflowParams {
            workflow_key: workflow_key.clone(),
            model: "account_payment".to_string(),
            name: "Bank payment approval".to_string(),
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
        .filter(&workflow_key)
        .find(|row| row.organization_id == org)
        .ok_or("bank approval workflow missing")?;
    let version = ctx
        .db
        .workflow_version()
        .workflow_version_by_workflow()
        .filter(&definition.id)
        .next()
        .ok_or("bank approval version missing")?;
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
            org,
            version.id,
            revision,
            UpsertWorkflowNodeParams {
                node_key: key.to_string(),
                name: key.to_string(),
                kind,
                sequence: index as u32 + 1,
                split_kind: WorkflowBranchKind::None,
                join_kind: WorkflowBranchKind::None,
                action: (key == "post").then(|| WorkflowActionReference {
                    action_key: "post_payment".to_string(),
                    input_schema_version: 1,
                    input: vec![],
                }),
                task_policy: (key == "approve").then(|| WorkflowTaskPolicy {
                    kind: WorkflowHumanTaskKind::ApproveReject,
                    assignment: WorkflowTaskAssignment::AllCandidates,
                    candidate_role_ids: vec![role_id],
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
            org,
            version.id,
            revision,
            UpsertWorkflowEdgeParams {
                edge_key: format!("{from}-{to}"),
                from_node_key: from.to_string(),
                to_node_key: to.to_string(),
                sequence: index as u32 + 1,
                signal_key: signal.map(str::to_string),
                condition: None,
                metadata: None,
            },
        )?;
        revision += 1;
    }
    publish_workflow_version(ctx, org, version.id, revision)?;
    let params = ReconcileAccountBankStatementLineParams {
        move_ids: vec![target_id],
        amount_residual: 0.0,
    };
    reconcile_account_bank_statement_line(ctx, org, company_id, bank_id, params.clone())?;
    let waiting = ctx
        .db
        .account_bank_statement_line()
        .id()
        .find(&bank_id)
        .ok_or("waiting bank line missing")?;
    let payment_id = *waiting
        .payment_ids
        .first()
        .ok_or("waiting bank payment missing")?;
    let draft = ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("waiting draft payment missing")?;
    if waiting.is_reconciled
        || !waiting.move_ids.is_empty()
        || waiting.amount_residual != 0.01
        || draft.state != PaymentState::NotPaid
        || draft.move_id.is_some()
    {
        return Err("bank settlement bypassed the payment approval gate".to_string());
    }
    let task = ctx
        .db
        .workflow_human_task()
        .iter()
        .find(|task| task.organization_id == org && task.subject_id == payment_id)
        .ok_or("payment approval task missing")?;
    let before_replay = settlement_financial_snapshot(ctx, org);
    reconcile_account_bank_statement_line(ctx, org, company_id, bank_id, params.clone())?;
    if settlement_financial_snapshot(ctx, org) != before_replay
        || ctx
            .db
            .workflow_human_task()
            .iter()
            .filter(|task| task.organization_id == org && task.subject_id == payment_id)
            .count()
            != 1
    {
        return Err(
            "waiting settlement replay duplicated payment, financial effect or approval"
                .to_string(),
        );
    }
    let instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&task.workflow_instance_id)
        .ok_or("payment approval instance missing")?;
    decide_workflow_human_task_for_actor(
        ctx,
        org,
        actor,
        DecideWorkflowHumanTaskParams {
            company_id,
            task_id: task.id,
            expected_task_revision: task.revision,
            expected_instance_revision: instance.revision,
            decision: WorkflowHumanTaskDecision::Approve,
            acting_for: None,
            comment: Some("approve exact bank amount".to_string()),
            idempotency_key: format!("approve-bank-payment-{payment_id}"),
            correlation_id: "bank-settlement-test".to_string(),
            causation_id: None,
        },
    )?;
    if ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("approved payment missing")?
        .state
        != PaymentState::Paid
        || ctx
            .db
            .account_bank_statement_line()
            .id()
            .find(&bank_id)
            .ok_or("approved bank line missing")?
            .is_reconciled
    {
        return Err(
            "approval did not post independently of bank settlement completion".to_string(),
        );
    }
    let approved_snapshot = settlement_financial_snapshot(ctx, org);
    let direct_register =
        register_payment_on_invoice(ctx, org, payment_id, vec![invoice_id], false);
    let payment_move_id = ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("approved bank payment missing")?
        .move_id
        .ok_or("approved bank payment entry missing")?;
    let direct_reconcile = reconcile_payment_with_invoice(ctx, org, payment_move_id, invoice_id);
    let reversed_reconcile = reconcile_payment_with_invoice(ctx, org, invoice_id, payment_move_id);
    let counterpart_register =
        register_payment_on_invoice(ctx, org, ordinary_payment.id, vec![payment_move_id], false);
    let bank_write_off = crate::accounting::credit_control::create_bad_debt_write_off(
        ctx,
        org,
        company_id,
        crate::accounting::credit_control::CreateBadDebtWriteOffParams {
            partner_id: fixture.partner_id,
            move_id: payment_move_id,
            amount: 0.01,
            journal_id,
            receivable_account_id: fixture.chart_account_ids[chart_keys::AR],
            write_off_account_id: fixture.chart_account_ids[chart_keys::REVENUE],
            date: ctx.timestamp,
            reference: None,
            metadata: None,
        },
    );
    for result in [&reversed_reconcile, &counterpart_register, &bank_write_off] {
        if !matches!(result, Err(error) if error.contains("bank-linked payments require")) {
            return Err(
                "bank-owned payment was accepted as the invoice-side counterpart".to_string(),
            );
        }
    }
    if direct_register.is_ok()
        || direct_reconcile.is_ok()
        || reversed_reconcile.is_ok()
        || counterpart_register.is_ok()
        || bank_write_off.is_ok()
        || settlement_financial_snapshot(ctx, org) != approved_snapshot
    {
        return Err("generic invoice registration diverted a bank-owned payment".to_string());
    }
    reconcile_account_bank_statement_line(ctx, org, company_id, bank_id, params)?;
    let invoice = ctx
        .db
        .account_move()
        .id()
        .find(&invoice_id)
        .ok_or("last-cent invoice missing")?;
    if invoice.amount_residual != 0.0
        || invoice.payment_state != PaymentState::Paid
        || ctx
            .db
            .account_move_line()
            .id()
            .find(&target_id)
            .ok_or("last-cent target missing")?
            .amount_residual
            != 0.0
        || !ctx
            .db
            .account_bank_statement_line()
            .id()
            .find(&bank_id)
            .ok_or("last-cent bank line missing")?
            .is_reconciled
    {
        return Err(
            "approved last-cent bank settlement left a dust residual or unmatched line".to_string(),
        );
    }
    Ok(())
}

fn company_currency_id(ctx: &ReducerContext, company_id: u64) -> Result<u64, String> {
    ctx.db
        .company()
        .id()
        .find(&company_id)
        .map(|company| company.currency_id)
        .ok_or_else(|| format!("Company {company_id} not found"))
}

pub fn test_reconciled_payment_unwind_and_cancel_exact_effect(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let other = OrgFixture::seed_minimal(ctx)?;
    let amount = 80.0;
    let invoice_id = create_balanced_customer_invoice(ctx, &fixture, amount, true)?;
    let (bank_journal_id, _) = seed_bank_journal(ctx, &fixture)?;
    create_payment(
        ctx,
        fixture.organization_id,
        CreatePaymentParams {
            idempotency_key: "payment-unwind-cancel".to_string(),
            company_id: fixture.company_id,
            payment_type: PaymentType::InBound,
            partner_type: PartnerType::Customer,
            partner_id: fixture.partner_id,
            amount,
            currency_id: company_currency_id(ctx, fixture.company_id)?,
            date: Some(ctx.timestamp),
            journal_id: bank_journal_id,
            ref_: Some("COV-08 payment unwind".to_string()),
            memo: None,
        },
    )?;
    let payment_id = ctx
        .db
        .account_payment()
        .iter()
        .find(|payment| {
            payment.organization_id == fixture.organization_id
                && payment.ref_.as_deref() == Some("COV-08 payment unwind")
        })
        .ok_or("unwind payment missing")?
        .id;
    post_payment(ctx, fixture.organization_id, payment_id)?;
    register_payment_on_invoice(
        ctx,
        fixture.organization_id,
        payment_id,
        vec![invoice_id],
        false,
    )?;

    let paid_invoice = ctx
        .db
        .account_move()
        .id()
        .find(&invoice_id)
        .ok_or("paid invoice missing")?;
    if paid_invoice.amount_residual.abs() > 0.01 || paid_invoice.payment_state != PaymentState::Paid
    {
        return Err("invoice did not settle before unwind".to_string());
    }
    let payment = ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("posted payment missing")?;
    let payment_move_id = payment.move_id.ok_or("posted payment move missing")?;

    let allocated_line = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&invoice_id)
        .find(|line| {
            crate::accounting::journal_entries::is_receivable_or_payable_line_type(
                line.account_internal_type.as_deref(),
            ) && line.matching_number.is_some()
        })
        .ok_or("allocated invoice line missing")?;
    ctx.db
        .account_move_line()
        .id()
        .update(crate::accounting::journal_entries::AccountMoveLine {
            matching_number: Some("MATCH-FOREIGN-OWNER".to_string()),
            ..allocated_line.clone()
        });
    let stale_cancel = cancel_payment(ctx, fixture.organization_id, payment_id);
    ctx.db.account_move_line().id().update(allocated_line);
    match stale_cancel {
        Err(error) if error.contains("another payment") => {}
        Err(error) => {
            return Err(format!(
                "unexpected stale-owner cancellation error: {error}"
            ))
        }
        Ok(()) => return Err("cancellation overwrote a foreign allocation owner".to_string()),
    }
    let after_stale_cancel = ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("payment missing after stale-owner denial")?;
    if after_stale_cancel.state != PaymentState::Paid
        || after_stale_cancel.reconciled_invoice_ids != vec![invoice_id]
    {
        return Err("stale-owner denial changed canonical payment state".to_string());
    }

    if unregister_payment_allocations(ctx, other.organization_id, payment_id).is_ok() {
        return Err("cross-organization allocation unwind succeeded".to_string());
    }
    let still_paid = ctx
        .db
        .account_move()
        .id()
        .find(&invoice_id)
        .ok_or("invoice missing after cross-org denial")?;
    if still_paid.amount_residual.abs() > 0.01 {
        return Err("cross-organization denial changed invoice residual".to_string());
    }

    let sibling_company_id = seed_sibling_company(ctx, &fixture)?;
    let canonical_invoice = ctx
        .db
        .account_move()
        .id()
        .find(&invoice_id)
        .ok_or("invoice missing before cross-company test")?;
    ctx.db
        .account_move()
        .id()
        .update(crate::accounting::journal_entries::AccountMove {
            company_id: sibling_company_id,
            ..canonical_invoice.clone()
        });
    let cross_company = unregister_payment_allocations(ctx, fixture.organization_id, payment_id);
    ctx.db.account_move().id().update(canonical_invoice);
    match cross_company {
        Err(error) if error.contains("scope") => {}
        Err(error) => return Err(format!("unexpected cross-company unwind error: {error}")),
        Ok(()) => return Err("cross-company allocation unwind succeeded".to_string()),
    }
    let after_company_denial = ctx
        .db
        .account_move()
        .id()
        .find(&invoice_id)
        .ok_or("invoice missing after cross-company denial")?;
    if after_company_denial.company_id != fixture.company_id
        || after_company_denial.amount_residual.abs() > 0.01
    {
        return Err("cross-company denial changed canonical invoice state".to_string());
    }

    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|row| row.organization_id == fixture.organization_id)
        .ok_or("unwind authorization membership missing")?;
    let owner_role = ctx
        .db
        .role()
        .id()
        .find(&membership.role_id)
        .ok_or("unwind authorization role missing")?;
    let caller_profile =
        find_user_profile_for_organization(ctx, ctx.sender(), fixture.organization_id)
            .ok_or("unwind authorization profile missing")?;
    ctx.db.role().id().update(Role {
        permissions: vec![],
        ..owner_role.clone()
    });
    let caller_profile_id = caller_profile.id;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: false,
        ..caller_profile
    });
    let denied = unregister_payment_allocations(ctx, fixture.organization_id, payment_id);
    ctx.db.role().id().update(owner_role);
    let denied_profile = ctx
        .db
        .user_profile()
        .id()
        .find(&caller_profile_id)
        .ok_or("unwind authorization profile disappeared")?;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: true,
        ..denied_profile
    });
    match denied {
        Err(error) if error.contains("Permission denied") => {}
        Err(error) => return Err(format!("unexpected unwind authorization error: {error}")),
        Ok(()) => return Err("allocation unwind succeeded without permission".to_string()),
    }
    let after_denial = ctx
        .db
        .account_move()
        .id()
        .find(&invoice_id)
        .ok_or("invoice missing after authorization denial")?;
    if after_denial.amount_residual.abs() > 0.01 {
        return Err("authorization denial changed invoice residual".to_string());
    }

    unregister_payment_allocations(ctx, fixture.organization_id, payment_id)?;
    let unwound_payment = ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("payment missing after unwind")?;
    let unwound_invoice = ctx
        .db
        .account_move()
        .id()
        .find(&invoice_id)
        .ok_or("invoice missing after unwind")?;
    let unwound_payment_move = ctx
        .db
        .account_move()
        .id()
        .find(&payment_move_id)
        .ok_or("payment move missing after unwind")?;
    if !unwound_payment.reconciled_invoice_ids.is_empty()
        || !unwound_payment.reconciled_bill_ids.is_empty()
        || (unwound_invoice.amount_residual - amount).abs() > 0.01
        || unwound_invoice.payment_state != PaymentState::NotPaid
        || (unwound_payment_move.amount_residual - amount).abs() > 0.01
    {
        return Err("allocation unwind did not restore canonical residuals".to_string());
    }
    let restored_lines: Vec<_> = ctx
        .db
        .account_move_line()
        .iter()
        .filter(|line| line.move_id == invoice_id || line.move_id == payment_move_id)
        .filter(|line| {
            crate::accounting::journal_entries::is_receivable_or_payable_line_type(
                line.account_internal_type.as_deref(),
            )
        })
        .collect();
    if restored_lines.is_empty()
        || restored_lines.iter().any(|line| {
            let expected_residual = if line.move_id == payment_move_id {
                line.balance.abs()
            } else {
                line.balance
            };
            line.matching_number.is_some()
                || line.is_matching
                || (line.amount_residual - expected_residual).abs() > 0.01
        })
    {
        return Err("allocation unwind did not restore exact line effects".to_string());
    }
    let unwind_snapshot: Vec<_> = restored_lines
        .iter()
        .map(|line| {
            (
                line.id,
                line.amount_residual,
                line.matching_number.clone(),
                line.write_date,
            )
        })
        .collect();
    if unregister_payment_allocations(ctx, fixture.organization_id, payment_id).is_ok() {
        return Err("allocation unwind replay unexpectedly succeeded".to_string());
    }
    let after_replay: Vec<_> = ctx
        .db
        .account_move_line()
        .iter()
        .filter(|line| unwind_snapshot.iter().any(|snapshot| snapshot.0 == line.id))
        .map(|line| {
            (
                line.id,
                line.amount_residual,
                line.matching_number.clone(),
                line.write_date,
            )
        })
        .collect();
    if after_replay != unwind_snapshot {
        return Err("allocation unwind replay changed canonical lines".to_string());
    }

    register_payment_on_invoice(
        ctx,
        fixture.organization_id,
        payment_id,
        vec![invoice_id],
        false,
    )?;
    cancel_payment(ctx, fixture.organization_id, payment_id)?;
    let cancelled = ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("cancelled payment missing")?;
    let restored_invoice = ctx
        .db
        .account_move()
        .id()
        .find(&invoice_id)
        .ok_or("restored invoice missing after cancel")?;
    if cancelled.state != PaymentState::Reversed
        || !cancelled.reconciled_invoice_ids.is_empty()
        || (restored_invoice.amount_residual - amount).abs() > 0.01
        || restored_invoice.payment_state != PaymentState::NotPaid
    {
        return Err("reconciled cancellation did not unwind before reversal".to_string());
    }
    let reversal_moves: Vec<_> = ctx
        .db
        .account_move()
        .iter()
        .filter(|move_row| {
            move_row.metadata.as_deref().is_some_and(|metadata| {
                serde_json::from_str::<serde_json::Value>(metadata)
                    .ok()
                    .and_then(|value| value["reverses_payment_move_id"].as_u64())
                    == Some(payment_move_id)
            })
        })
        .collect();
    if reversal_moves.len() != 1 {
        return Err(format!(
            "reconciled cancellation created {} reversal moves",
            reversal_moves.len()
        ));
    }
    if cancelled.reversal_move_id != Some(reversal_moves[0].id) {
        return Err("reconciled cancellation did not expose its exact reversal".to_string());
    }
    Ok(())
}

pub fn test_payment_reconciles_invoice(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let amount = 100.0;

    let invoice_move_id = create_balanced_customer_invoice(ctx, &fixture, amount, true)?;
    let (bank_journal_id, _) = seed_bank_journal(ctx, &fixture)?;

    let create_params = CreatePaymentParams {
        idempotency_key: "payment-reconciles-invoice".to_string(),
        company_id,
        payment_type: PaymentType::InBound,
        partner_type: crate::types::PartnerType::Customer,
        partner_id: fixture.partner_id,
        amount,
        currency_id: company_currency_id(ctx, company_id)?,
        date: Some(ctx.timestamp),
        journal_id: bank_journal_id,
        ref_: Some("Harness payment".to_string()),
        memo: Some("Invoice settlement".to_string()),
    };
    create_payment(ctx, org_id, create_params.clone())?;
    create_payment(ctx, org_id, create_params.clone())?;
    if ctx
        .db
        .account_payment()
        .iter()
        .filter(|payment| {
            payment.organization_id == org_id && payment.ref_.as_deref() == Some("Harness payment")
        })
        .count()
        != 1
    {
        return Err("payment creation retry duplicated the payment".to_string());
    }
    let mut conflicting_params = create_params;
    conflicting_params.amount = 101.0;
    match create_payment(ctx, org_id, conflicting_params) {
        Err(error) if error.contains("idempotency key") => {}
        Err(error) => return Err(format!("unexpected payment retry conflict: {error}")),
        Ok(()) => return Err("changed payment retry reused its idempotency key".to_string()),
    }

    let payment_id = ctx
        .db
        .account_payment()
        .iter()
        .find(|p| p.organization_id == org_id && p.ref_ == Some("Harness payment".to_string()))
        .map(|p| p.id)
        .ok_or("Payment record not found after create")?;

    post_payment(ctx, org_id, payment_id)?;

    let payment = ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("Payment not found after post")?;
    let payment_move_id = payment
        .move_id
        .ok_or("post_payment did not link a journal move")?;

    let line_count = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&payment_move_id)
        .count();
    if line_count < 2 {
        return Err(format!(
            "post_payment must insert balanced lines, got {line_count}"
        ));
    }

    let debit: f64 = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&payment_move_id)
        .map(|l| l.debit)
        .sum();
    let credit: f64 = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&payment_move_id)
        .map(|l| l.credit)
        .sum();
    if (debit - credit).abs() > 0.01 {
        return Err(format!(
            "Payment move unbalanced: debit={debit} credit={credit}"
        ));
    }

    // register_payment_on_invoice settles residual in the same txn.
    // Relies on case-insensitive reconcile (A1) — invoice AR lines keep Debug
    // "Receivable" from insert; do not call patch_receivable_line_type.
    register_payment_on_invoice(ctx, org_id, payment_id, vec![invoice_move_id], false)?;

    let payment = ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("Payment not found after register")?;

    if !payment.reconciled_invoice_ids.contains(&invoice_move_id) {
        return Err(
            "Invoice id not linked on payment after register_payment_on_invoice".to_string(),
        );
    }

    let invoice = ctx
        .db
        .account_move()
        .id()
        .find(&invoice_move_id)
        .ok_or("Invoice not found after reconcile")?;

    if invoice.amount_residual.abs() > 0.01 {
        return Err(format!(
            "Invoice residual should be near zero after register, got {}",
            invoice.amount_residual
        ));
    }

    let before_invoice = (
        invoice.amount_residual,
        invoice.payment_state.clone(),
        invoice.write_date,
    );
    let payment_move = ctx
        .db
        .account_move()
        .id()
        .find(&payment_move_id)
        .ok_or("Payment move not found after reconcile")?;
    let before_payment = (
        payment_move.amount_residual,
        payment_move.payment_state.clone(),
        payment_move.write_date,
    );
    let before_lines: Vec<_> = ctx
        .db
        .account_move_line()
        .iter()
        .filter(|line| line.move_id == invoice_move_id || line.move_id == payment_move_id)
        .map(|line| {
            (
                line.id,
                line.amount_residual,
                line.amount_residual_currency,
                line.matching_number.clone(),
                line.is_matching,
                line.write_date,
            )
        })
        .collect();

    match reconcile_payment_with_invoice(ctx, org_id, payment_move_id, invoice_move_id) {
        Err(error) if error.contains("already reconciled") => {}
        Err(error) => return Err(format!("unexpected reconciliation replay error: {error}")),
        Ok(()) => return Err("stale reconciliation replay unexpectedly succeeded".to_string()),
    }

    let after_invoice = ctx
        .db
        .account_move()
        .id()
        .find(&invoice_move_id)
        .ok_or("Invoice not found after stale replay")?;
    let after_payment = ctx
        .db
        .account_move()
        .id()
        .find(&payment_move_id)
        .ok_or("Payment move not found after stale replay")?;
    if before_invoice
        != (
            after_invoice.amount_residual,
            after_invoice.payment_state,
            after_invoice.write_date,
        )
        || before_payment
            != (
                after_payment.amount_residual,
                after_payment.payment_state,
                after_payment.write_date,
            )
    {
        return Err("stale reconciliation replay changed a canonical move".to_string());
    }
    let after_lines: Vec<_> = ctx
        .db
        .account_move_line()
        .iter()
        .filter(|line| line.move_id == invoice_move_id || line.move_id == payment_move_id)
        .map(|line| {
            (
                line.id,
                line.amount_residual,
                line.amount_residual_currency,
                line.matching_number.clone(),
                line.is_matching,
                line.write_date,
            )
        })
        .collect();
    if before_lines != after_lines {
        return Err("stale reconciliation replay changed canonical move lines".to_string());
    }

    create_account_bank_statement(
        ctx,
        org_id,
        company_id,
        bank_journal_id,
        CreateAccountBankStatementParams {
            name: Some("COV-08B exact statement".to_string()),
            reference: Some("COV-08B".to_string()),
            date: Some(ctx.timestamp),
            balance_start: 0.0,
            currency_id: fixture.currency_id,
            metadata: None,
        },
    )?;
    let statement = ctx
        .db
        .account_bank_statement()
        .iter()
        .find(|row| {
            row.organization_id == org_id && row.name.as_deref() == Some("COV-08B exact statement")
        })
        .ok_or("COV-08B bank statement not found")?;
    create_account_bank_statement_line(
        ctx,
        org_id,
        company_id,
        statement.id,
        CreateAccountBankStatementLineParams {
            date: ctx.timestamp,
            amount,
            amount_currency: amount,
            currency_id: Some(fixture.currency_id),
            foreign_currency_id: None,
            partner_id: Some(fixture.partner_id),
            bank_account_id: None,
            account_number: None,
            move_id: None,
            is_reconciled: false,
            transaction_type: Some("customer_payment".to_string()),
            move_ids: vec![],
            payment_ids: vec![],
            amount_residual: amount,
            auto_reconcile_ids: vec![],
            metadata: None,
        },
    )?;
    let statement_line = ctx
        .db
        .account_bank_statement_line()
        .iter()
        .find(|row| row.statement_id == statement.id)
        .ok_or("COV-08B bank statement line not found")?;
    // Simulate a pre-existing, trusted historical payment link. Generic data
    // entry cannot manufacture settlement provenance in the new workflow.
    ctx.db.account_bank_statement_line().id().update(
        crate::accounting::bank_reconciliation::AccountBankStatementLine {
            payment_ids: vec![payment_id],
            ..ctx
                .db
                .account_bank_statement_line()
                .id()
                .find(&statement_line.id)
                .ok_or("legacy bank line missing")?
        },
    );
    let invoice_receivable_id = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&invoice_move_id)
        .find(|line| {
            line.account_internal_type
                .as_deref()
                .is_some_and(|kind| kind.eq_ignore_ascii_case("receivable"))
        })
        .map(|line| line.id)
        .ok_or("invoice receivable line not found for COV-08B")?;
    let reconcile_params = ReconcileAccountBankStatementLineParams {
        move_ids: vec![invoice_receivable_id],
        amount_residual: 0.0,
    };
    reconcile_account_bank_statement_line(
        ctx,
        org_id,
        company_id,
        statement_line.id,
        reconcile_params.clone(),
    )?;
    let reconciled = ctx
        .db
        .account_bank_statement_line()
        .id()
        .find(&statement_line.id)
        .ok_or("bank line missing after reconcile")?;
    if !reconciled.is_reconciled
        || reconciled.move_ids != vec![invoice_receivable_id]
        || reconciled.amount_residual.abs() > 0.01
    {
        return Err("bank statement line did not reconcile to the exact move line".to_string());
    }
    match reconcile_account_bank_statement_line(
        ctx,
        org_id,
        company_id,
        statement_line.id,
        reconcile_params,
    ) {
        Err(error) if error.contains("already reconciled") => {}
        Err(error) => {
            return Err(format!(
                "unexpected bank reconciliation replay error: {error}"
            ))
        }
        Ok(()) => return Err("bank reconciliation replay unexpectedly succeeded".to_string()),
    }
    let after_replay = ctx
        .db
        .account_bank_statement_line()
        .id()
        .find(&statement_line.id)
        .ok_or("bank line missing after stale replay")?;
    if after_replay.move_ids != reconciled.move_ids
        || after_replay.amount_residual != reconciled.amount_residual
        || after_replay.write_date != reconciled.write_date
    {
        return Err("stale bank reconciliation replay changed the exact effect".to_string());
    }

    Ok(())
}

pub fn test_payment_create_rejects_invalid_relations(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let (bank_journal_id, _) = seed_bank_journal(ctx, &fixture)?;
    let (foreign_journal_id, _) = seed_bank_journal(ctx, &foreign)?;
    let before = ctx
        .db
        .account_payment()
        .payment_by_org()
        .filter(&fixture.organization_id)
        .count();

    let invalid_attempts = [
        CreatePaymentParams {
            idempotency_key: "invalid-payment-foreign-journal".to_string(),
            company_id: fixture.company_id,
            payment_type: PaymentType::InBound,
            partner_type: PartnerType::Customer,
            partner_id: fixture.partner_id,
            amount: 731.29,
            currency_id: company_currency_id(ctx, fixture.company_id)?,
            date: Some(ctx.timestamp),
            journal_id: foreign_journal_id,
            ref_: Some("ACC-RI-006-foreign-journal".to_string()),
            memo: None,
        },
        CreatePaymentParams {
            idempotency_key: "invalid-payment-foreign-partner".to_string(),
            company_id: fixture.company_id,
            payment_type: PaymentType::InBound,
            partner_type: PartnerType::Customer,
            partner_id: foreign.partner_id,
            amount: 731.29,
            currency_id: company_currency_id(ctx, fixture.company_id)?,
            date: Some(ctx.timestamp),
            journal_id: bank_journal_id,
            ref_: Some("ACC-RI-006-foreign-partner".to_string()),
            memo: None,
        },
        CreatePaymentParams {
            idempotency_key: "invalid-payment-missing-currency".to_string(),
            company_id: fixture.company_id,
            payment_type: PaymentType::InBound,
            partner_type: PartnerType::Customer,
            partner_id: fixture.partner_id,
            amount: 731.29,
            currency_id: 999,
            date: Some(ctx.timestamp),
            journal_id: bank_journal_id,
            ref_: Some("ACC-RI-006-missing-currency".to_string()),
            memo: None,
        },
        CreatePaymentParams {
            idempotency_key: "invalid-payment-wrong-partner-role".to_string(),
            company_id: fixture.company_id,
            payment_type: PaymentType::OutBound,
            partner_type: PartnerType::Supplier,
            partner_id: fixture.partner_id,
            amount: 731.29,
            currency_id: company_currency_id(ctx, fixture.company_id)?,
            date: Some(ctx.timestamp),
            journal_id: bank_journal_id,
            ref_: Some("ACC-RI-006-wrong-partner-role".to_string()),
            memo: None,
        },
        CreatePaymentParams {
            idempotency_key: "invalid-payment-missing-date".to_string(),
            company_id: fixture.company_id,
            payment_type: PaymentType::InBound,
            partner_type: PartnerType::Customer,
            partner_id: fixture.partner_id,
            amount: 731.29,
            currency_id: company_currency_id(ctx, fixture.company_id)?,
            date: None,
            journal_id: bank_journal_id,
            ref_: Some("ACC-RI-008-missing-date".to_string()),
            memo: None,
        },
    ];

    for params in invalid_attempts {
        if create_payment(ctx, fixture.organization_id, params).is_ok() {
            return Err("create_payment accepted an invalid relation".to_string());
        }
    }

    let after = ctx
        .db
        .account_payment()
        .payment_by_org()
        .filter(&fixture.organization_id)
        .count();
    if after != before {
        return Err("Rejected payment relation persisted a payment".to_string());
    }
    Ok(())
}

pub fn test_cancel_payment_audited(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let amount = 50.0;

    let (bank_journal_id, _) = seed_bank_journal(ctx, &fixture)?;

    create_payment(
        ctx,
        org_id,
        CreatePaymentParams {
            idempotency_key: "cancel-payment-audit".to_string(),
            company_id,
            payment_type: PaymentType::InBound,
            partner_type: crate::types::PartnerType::Customer,
            partner_id: fixture.partner_id,
            amount,
            currency_id: company_currency_id(ctx, company_id)?,
            date: Some(ctx.timestamp),
            journal_id: bank_journal_id,
            ref_: Some("Harness cancel payment".to_string()),
            memo: Some("To be cancelled".to_string()),
        },
    )?;

    let payment_id = ctx
        .db
        .account_payment()
        .iter()
        .find(|p| {
            p.organization_id == org_id && p.ref_ == Some("Harness cancel payment".to_string())
        })
        .map(|p| p.id)
        .ok_or("Payment record not found after create")?;

    post_payment(ctx, org_id, payment_id)?;

    let posted = ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("Payment not found after post")?;

    if posted.state != PaymentState::Paid {
        return Err(format!(
            "Expected Paid state before cancel, got {:?}",
            posted.state
        ));
    }
    let original_move_id = posted.move_id.ok_or("Posted payment is missing its move")?;
    let original_lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&original_move_id)
        .collect();
    if original_lines.len() < 2 {
        return Err("Posted payment move has fewer than two lines".to_string());
    }

    cancel_payment(ctx, org_id, payment_id)?;

    let cancelled = ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("Payment not found after cancel")?;

    if cancelled.state != PaymentState::Reversed {
        return Err(format!(
            "Expected Reversed state after cancel, got {:?}",
            cancelled.state
        ));
    }

    let reversal_moves: Vec<_> = ctx
        .db
        .account_move()
        .iter()
        .filter(|move_row| {
            if move_row.organization_id != org_id || move_row.company_id != company_id {
                return false;
            }
            move_row.metadata.as_deref().is_some_and(|metadata| {
                serde_json::from_str::<serde_json::Value>(metadata)
                    .ok()
                    .and_then(|value| value["reverses_payment_move_id"].as_u64())
                    == Some(original_move_id)
            })
        })
        .collect();
    if reversal_moves.len() != 1
        || reversal_moves[0].state != crate::types::AccountMoveState::Posted
    {
        return Err(format!(
            "Expected one posted reversal move, got {}",
            reversal_moves.len()
        ));
    }
    if cancelled.reversal_move_id != Some(reversal_moves[0].id) {
        return Err("Cancelled payment does not identify its exact reversal move".to_string());
    }
    let reversal_lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&reversal_moves[0].id)
        .collect();
    if reversal_lines.len() != original_lines.len() {
        return Err("Payment reversal line count does not match original".to_string());
    }
    for original in &original_lines {
        let matches = reversal_lines.iter().filter(|reversal| {
            reversal.account_id == original.account_id
                && (reversal.debit - original.credit).abs() < 1e-9
                && (reversal.credit - original.debit).abs() < 1e-9
                && reversal.payment_id == Some(payment_id)
        });
        if matches.count() != 1 {
            return Err(format!(
                "Payment reversal did not exactly invert original line {}",
                original.id
            ));
        }
    }
    if cancel_payment(ctx, org_id, payment_id).is_ok() {
        return Err("Payment cancellation replay unexpectedly succeeded".to_string());
    }
    let reversal_count_after_replay = ctx
        .db
        .account_move()
        .iter()
        .filter(|move_row| {
            move_row.metadata.as_deref().is_some_and(|metadata| {
                serde_json::from_str::<serde_json::Value>(metadata)
                    .ok()
                    .and_then(|value| value["reverses_payment_move_id"].as_u64())
                    == Some(original_move_id)
            })
        })
        .count();
    if reversal_count_after_replay != 1 {
        return Err("Cancellation replay duplicated the reversal move".to_string());
    }
    let after_replay = ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("Payment missing after cancellation replay")?;
    if after_replay.reversal_move_id != cancelled.reversal_move_id {
        return Err("Cancellation replay changed the canonical reversal identity".to_string());
    }

    let has_cancel_audit = ctx
        .db
        .audit_log()
        .audit_by_org()
        .filter(&org_id)
        .any(|entry| {
            entry.table_name == "account_payment"
                && entry.record_id == payment_id
                && entry.action == "CANCEL"
        });

    if !has_cancel_audit {
        return Err("Expected CANCEL audit row for payment".to_string());
    }

    Ok(())
}

/// A3 + A4 distinctive-value proof:
/// - Pay 100 vs invoices 60+60 → after first register, payment residual stays partial;
///   second invoice residual untouched.
/// - Clearing JE `account_id` matches the invoice AR line (not fixture first-of-type).
pub fn test_payment_multi_invoice_residual_and_clearing_account(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let decoy_ar_id = *fixture
        .chart_account_ids
        .get(chart_keys::AR)
        .ok_or("Harness missing AR account")?;
    let distinctive_ar_id = seed_distinctive_ar_account(ctx, &fixture)?;

    let inv1 = create_balanced_customer_invoice_on_account(
        ctx,
        &fixture,
        60.0,
        distinctive_ar_id,
        "A3 inv 60a",
        true,
    )?;
    let inv2 = create_balanced_customer_invoice_on_account(
        ctx,
        &fixture,
        60.0,
        distinctive_ar_id,
        "A3 inv 60b",
        true,
    )?;

    let invoice_ar_line_account = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&inv1)
        .find(|l| l.account_id == distinctive_ar_id)
        .map(|l| l.account_id)
        .ok_or("Invoice 1 missing distinctive AR line")?;
    if invoice_ar_line_account != distinctive_ar_id {
        return Err("Invoice AR line account mismatch before payment".to_string());
    }

    let (bank_journal_id, _) = seed_bank_journal(ctx, &fixture)?;
    create_payment(
        ctx,
        org_id,
        CreatePaymentParams {
            idempotency_key: "multi-invoice-residual-payment".to_string(),
            company_id,
            payment_type: PaymentType::InBound,
            partner_type: crate::types::PartnerType::Customer,
            partner_id: fixture.partner_id,
            amount: 100.0,
            currency_id: company_currency_id(ctx, company_id)?,
            date: Some(ctx.timestamp),
            journal_id: bank_journal_id,
            ref_: Some("A3 multi-invoice payment".to_string()),
            memo: Some("100 vs 60+60".to_string()),
        },
    )?;

    let payment_id = ctx
        .db
        .account_payment()
        .iter()
        .find(|p| {
            p.organization_id == org_id && p.ref_ == Some("A3 multi-invoice payment".to_string())
        })
        .map(|p| p.id)
        .ok_or("Payment not found after create")?;

    post_payment(ctx, org_id, payment_id)?;

    let payment = ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("Payment not found after post")?;
    let payment_move_id = payment
        .move_id
        .ok_or("post_payment did not link a journal move")?;

    // A4: clearing receivable line must use invoice AR, not first-of-type decoy.
    let clearing_line = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&payment_move_id)
        .find(|l| {
            l.account_internal_type
                .as_deref()
                .is_some_and(|t| t.eq_ignore_ascii_case("receivable"))
        })
        .ok_or("Payment missing receivable clearing line")?;

    if clearing_line.account_id == decoy_ar_id {
        return Err(format!(
            "A4 fail: clearing used first-of-type decoy AR {decoy_ar_id}"
        ));
    }
    if clearing_line.account_id != distinctive_ar_id {
        return Err(format!(
            "A4 fail: clearing account_id {} != invoice AR {}",
            clearing_line.account_id, distinctive_ar_id
        ));
    }
    if (clearing_line.amount_residual.abs() - 100.0).abs() > 0.01 {
        return Err(format!(
            "Expected payment clearing residual 100 before reconcile, got {}",
            clearing_line.amount_residual
        ));
    }

    // A3: register against first invoice only — payment residual must stay partial.
    register_payment_on_invoice(ctx, org_id, payment_id, vec![inv1], false)?;

    let payment_after = ctx
        .db
        .account_move()
        .id()
        .find(&payment_move_id)
        .ok_or("Payment move missing after first reconcile")?;
    if (payment_after.amount_residual - 40.0).abs() > 0.01 {
        return Err(format!(
            "A3 fail: after first reconcile expected payment residual 40, got {}",
            payment_after.amount_residual
        ));
    }
    if payment_after.payment_state != PaymentState::Partial {
        return Err(format!(
            "A3 fail: expected Partial payment_state, got {:?}",
            payment_after.payment_state
        ));
    }

    let inv1_after = ctx
        .db
        .account_move()
        .id()
        .find(&inv1)
        .ok_or("Invoice 1 missing after first reconcile")?;
    if inv1_after.amount_residual.abs() > 0.01 {
        return Err(format!(
            "A3 fail: invoice 1 residual should be 0, got {}",
            inv1_after.amount_residual
        ));
    }

    let inv2_after = ctx
        .db
        .account_move()
        .id()
        .find(&inv2)
        .ok_or("Invoice 2 missing after first reconcile")?;
    if (inv2_after.amount_residual - 60.0).abs() > 0.01 {
        return Err(format!(
            "A3 fail: invoice 2 residual should remain 60, got {}",
            inv2_after.amount_residual
        ));
    }

    let inv2_ar_line_residual = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&inv2)
        .find(|l| l.account_id == distinctive_ar_id)
        .map(|l| l.amount_residual.abs())
        .ok_or("Invoice 2 AR line missing after first reconcile")?;
    if (inv2_ar_line_residual - 60.0).abs() > 0.01 {
        return Err(format!(
            "A3 fail: invoice 2 AR line residual should remain 60, got {inv2_ar_line_residual}"
        ));
    }

    let payment_line_residual: f64 = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&payment_move_id)
        .filter(|l| {
            l.account_internal_type
                .as_deref()
                .is_some_and(|t| t.eq_ignore_ascii_case("receivable"))
        })
        .map(|l| l.amount_residual.abs())
        .sum();
    if (payment_line_residual - 40.0).abs() > 0.01 {
        return Err(format!(
            "A3 fail: payment AR line residual expected 40, got {payment_line_residual}"
        ));
    }

    // Second register consumes remaining 40 against inv2 (partial settle).
    register_payment_on_invoice(ctx, org_id, payment_id, vec![inv2], false)?;

    let payment_final = ctx
        .db
        .account_move()
        .id()
        .find(&payment_move_id)
        .ok_or("Payment move missing after second reconcile")?;
    if payment_final.amount_residual.abs() > 0.01 {
        return Err(format!(
            "After second reconcile expected payment residual 0, got {}",
            payment_final.amount_residual
        ));
    }

    let inv2_final = ctx
        .db
        .account_move()
        .id()
        .find(&inv2)
        .ok_or("Invoice 2 missing after second reconcile")?;
    if (inv2_final.amount_residual - 20.0).abs() > 0.01 {
        return Err(format!(
            "After second reconcile expected invoice 2 residual 20, got {}",
            inv2_final.amount_residual
        ));
    }

    Ok(())
}
