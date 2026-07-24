/// Payment registration and invoice reconciliation domain tests.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::journal_entries::account_move;
use crate::accounting::journal_entries::account_move_line;
use crate::accounting::payments::{
    account_payment, cancel_payment, create_payment, post_payment, register_payment_on_invoice,
    CreatePaymentParams,
};
use crate::core::audit::audit_log;
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{PaymentState, PaymentType};

use super::helpers::{create_balanced_customer_invoice, seed_bank_journal};

pub fn test_payment_reconciles_invoice(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let amount = 100.0;

    let invoice_move_id = create_balanced_customer_invoice(ctx, &fixture, amount, true)?;
    let (bank_journal_id, _) = seed_bank_journal(ctx, &fixture)?;

    create_payment(
        ctx,
        org_id,
        CreatePaymentParams {
            company_id,
            payment_type: PaymentType::InBound,
            partner_type: crate::types::PartnerType::Customer,
            partner_id: fixture.partner_id,
            amount,
            currency_id: 1,
            date: None,
            journal_id: bank_journal_id,
            ref_: Some("Harness payment".to_string()),
            memo: Some("Invoice settlement".to_string()),
        },
    )?;

    let payment_id = ctx
        .db
        .account_payment()
        .iter()
        .find(|p| {
            p.organization_id == org_id && p.ref_ == Some("Harness payment".to_string())
        })
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
        return Err("Invoice id not linked on payment after register_payment_on_invoice".to_string());
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
            company_id,
            payment_type: PaymentType::InBound,
            partner_type: crate::types::PartnerType::Customer,
            partner_id: fixture.partner_id,
            amount,
            currency_id: 1,
            date: None,
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
