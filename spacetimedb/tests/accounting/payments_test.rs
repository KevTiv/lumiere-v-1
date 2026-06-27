/// Payment registration and invoice reconciliation domain tests.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::journal_entries::{
    account_move, create_account_move, post_account_move, reconcile_payment_with_invoice,
    AddAccountMoveLineParams, CreateAccountMoveParams,
};
use crate::accounting::payments::{
    account_payment, cancel_payment, create_payment, post_payment, register_payment_on_invoice,
    CreatePaymentParams,
};
use crate::core::audit::audit_log;
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{MoveType, PartnerType, PaymentState, PaymentType};

use super::helpers::{create_balanced_customer_invoice, patch_receivable_line_type, seed_bank_journal};

pub fn test_payment_reconciles_invoice(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let amount = 100.0;

    let ar_id = *fixture
        .chart_account_ids
        .get(chart_keys::AR)
        .ok_or("Harness missing AR account")?;

    let invoice_move_id = create_balanced_customer_invoice(ctx, &fixture, amount, true)?;

    let (bank_journal_id, bank_account_id) = seed_bank_journal(ctx, &fixture)?;

    create_account_move(
        ctx,
        org_id,
        CreateAccountMoveParams {
            company_id: Some(company_id),
            journal_id: bank_journal_id,
            move_type: MoveType::Entry,
            date: ctx.timestamp,
            name: String::new(),
            ref_: Some("Harness payment entry".to_string()),
            auto_post: false,
            to_check: false,
            is_storno: false,
            partner_id: Some(fixture.partner_id),
            partner_bank_id: None,
            fiscal_position_id: None,
            invoice_date: None,
            invoice_date_due: None,
            invoice_payment_term_id: None,
            payment_reference: None,
            invoice_origin: None,
            invoice_partner_display_name: None,
            invoice_cash_rounding_id: None,
            partner_shipping_id: None,
            sale_order_id: None,
            invoice_incoterm_id: None,
            incoterm_location: None,
            campaign_id: None,
            source_id: None,
            medium_id: None,
            secure_sequence_number: None,
            metadata: Some(r#"{"test":"payment_entry"}"#.to_string()),
        },
    )?;

    let payment_move_id = ctx
        .db
        .account_move()
        .iter()
        .find(|m| {
            m.organization_id == org_id
                && m.ref_ == Some("Harness payment entry".to_string())
        })
        .map(|m| m.id)
        .ok_or("Payment move not found after create")?;

    add_payment_move_lines(
        ctx,
        org_id,
        payment_move_id,
        bank_account_id,
        ar_id,
        fixture.partner_id,
        amount,
    )?;

    post_account_move(ctx, org_id, payment_move_id)?;

    create_payment(
        ctx,
        org_id,
        CreatePaymentParams {
            company_id,
            payment_type: PaymentType::InBound,
            partner_type: PartnerType::Customer,
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

    register_payment_on_invoice(ctx, org_id, payment_id, vec![invoice_move_id], false)?;

    reconcile_payment_with_invoice(ctx, org_id, payment_move_id, invoice_move_id)?;

    let payment = ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("Payment not found after reconcile")?;

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
            "Invoice residual should be near zero after reconcile, got {}",
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
            partner_type: PartnerType::Customer,
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

fn add_payment_move_lines(
    ctx: &ReducerContext,
    org_id: u64,
    move_id: u64,
    bank_account_id: u64,
    ar_account_id: u64,
    partner_id: u64,
    amount: f64,
) -> Result<(), String> {
    use crate::accounting::journal_entries::add_account_move_line;

    add_account_move_line(
        ctx,
        org_id,
        move_id,
        AddAccountMoveLineParams {
            account_id: bank_account_id,
            name: "Bank".to_string(),
            debit: amount,
            credit: 0.0,
            sequence: 1,
            quantity: 1.0,
            price_unit: amount,
            discount: 0.0,
            tax_ids: vec![],
            partner_id: Some(partner_id),
            product_id: None,
            product_uom_id: None,
            product_category_id: None,
            analytic_account_id: None,
            analytic_tag_ids: vec![],
            display_type: None,
            is_downpayment: false,
            exclude_from_invoice_tab: false,
            blocked: false,
            group_tax_id: None,
            tax_line_id: None,
            tax_group_id: None,
            tax_repartition_line_id: None,
            tax_audit: None,
            reconcile_model_id: None,
            payment_id: None,
            statement_line_id: None,
            matching_number: None,
            matching_label: None,
            expected_pay_date: None,
            expected_pay_date_currency_id: None,
            expected_pay_date_amount: 0.0,
            expected_pay_date_residual: 0.0,
            metadata: None,
        },
    )?;

    add_account_move_line(
        ctx,
        org_id,
        move_id,
        AddAccountMoveLineParams {
            account_id: ar_account_id,
            name: "Accounts Receivable".to_string(),
            debit: 0.0,
            credit: amount,
            sequence: 2,
            quantity: 1.0,
            price_unit: amount,
            discount: 0.0,
            tax_ids: vec![],
            partner_id: Some(partner_id),
            product_id: None,
            product_uom_id: None,
            product_category_id: None,
            analytic_account_id: None,
            analytic_tag_ids: vec![],
            display_type: None,
            is_downpayment: false,
            exclude_from_invoice_tab: false,
            blocked: false,
            group_tax_id: None,
            tax_line_id: None,
            tax_group_id: None,
            tax_repartition_line_id: None,
            tax_audit: None,
            reconcile_model_id: None,
            payment_id: None,
            statement_line_id: None,
            matching_number: None,
            matching_label: None,
            expected_pay_date: None,
            expected_pay_date_currency_id: None,
            expected_pay_date_amount: 0.0,
            expected_pay_date_residual: 0.0,
            metadata: None,
        },
    )?;

    patch_receivable_line_type(ctx, move_id, ar_account_id)?;

    Ok(())
}
