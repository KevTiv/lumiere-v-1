/// Payment registration and invoice reconciliation domain tests.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::bank_reconciliation::{
    account_bank_statement, account_bank_statement_line, create_account_bank_statement,
    create_account_bank_statement_line, reconcile_account_bank_statement_line,
    CreateAccountBankStatementLineParams, CreateAccountBankStatementParams,
    ReconcileAccountBankStatementLineParams,
};
use crate::accounting::journal_entries::{
    account_move, account_move_line, reconcile_payment_with_invoice,
};
use crate::accounting::payments::{
    account_payment, cancel_payment, create_payment, post_payment, register_payment_on_invoice,
    CreatePaymentParams,
};
use crate::core::audit::audit_log;
use crate::core::organization::company;
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{PartnerType, PaymentState, PaymentType};

use super::helpers::{
    create_balanced_customer_invoice, create_balanced_customer_invoice_on_account,
    seed_bank_journal, seed_distinctive_ar_account,
};
use crate::test_harness::chart_keys;

fn company_currency_id(ctx: &ReducerContext, company_id: u64) -> Result<u64, String> {
    ctx.db
        .company()
        .id()
        .find(&company_id)
        .map(|company| company.currency_id)
        .ok_or_else(|| format!("Company {company_id} not found"))
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
            move_id: Some(invoice_move_id),
            is_reconciled: false,
            transaction_type: Some("customer_payment".to_string()),
            move_ids: vec![],
            payment_ids: vec![payment_id],
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
