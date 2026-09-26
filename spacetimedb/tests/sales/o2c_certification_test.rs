//! INT-05/INT-08: order-to-cash invoicing certification.
//!
//! Proves an order is billed exactly for what it should be: never twice, never beyond what was
//! delivered under the delivery policy, and never by another tenant. Payment semantics are
//! certified separately (`pretenant/payments_cert.rs`).
use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_journal, create_account_journal, CreateAccountJournalParams,
};
use crate::accounting::journal_entries::{
    create_invoice_from_sale_order, AddAccountMoveLineParams, CreateInvoiceFromSaleOrderParams,
};
use crate::inventory::stock::{
    assign_stock_picking, confirm_stock_picking, validate_stock_picking,
    validate_stock_picking_backorder,
};
use crate::sales::sales_core::{sale_order, sale_order_line};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{InvoiceStatus, JournalType};

use super::backorder_certification_test::{
    backorder_of, company_currency_id, confirmed_order, confirmed_order_with_policy,
    expect_close, only_move, ready_delivery, record_done, scope,
};

fn move_line(
    account_id: u64,
    name: &str,
    partner_id: Option<u64>,
    exclude_from_invoice_tab: bool,
) -> AddAccountMoveLineParams {
    AddAccountMoveLineParams {
        account_id,
        name: name.to_string(),
        debit: 0.0,
        credit: 0.0,
        sequence: 0,
        quantity: 0.0,
        price_unit: 0.0,
        discount: 0.0,
        tax_ids: vec![],
        partner_id,
        product_id: None,
        product_uom_id: None,
        product_category_id: None,
        analytic_account_id: None,
        analytic_tag_ids: vec![],
        display_type: None,
        is_downpayment: false,
        exclude_from_invoice_tab,
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
    }
}

/// Invoice parameters for the fixture, creating its sales journal on first use.
fn invoice_params(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
) -> Result<CreateInvoiceFromSaleOrderParams, String> {
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let currency_id = company_currency_id(ctx, company_id)?;
    let revenue_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("Harness missing revenue account")?;
    let ar_id = *fixture
        .chart_account_ids
        .get(chart_keys::AR)
        .ok_or("Harness missing receivable account")?;

    let journal_code = format!("SO{company_id}");
    let find_journal = |ctx: &ReducerContext| {
        ctx.db
            .account_journal()
            .iter()
            .find(|j| j.organization_id == org_id && j.code == journal_code)
            .map(|j| j.id)
    };
    let journal_id = match find_journal(ctx) {
        Some(id) => id,
        None => {
            create_account_journal(
                ctx,
                org_id,
                CreateAccountJournalParams {
                    company_id: Some(company_id),
                    name: "O2C Cert Sales Journal".to_string(),
                    code: journal_code.clone(),
                    type_: JournalType::Sale,
                    currency_id: Some(currency_id),
                    default_account_id: Some(revenue_id),
                    suspense_account_id: None,
                    loss_account_id: None,
                    profit_account_id: None,
                    bank_account_id: None,
                    payment_credit_account_id: None,
                    payment_debit_account_id: None,
                    invoice_reference_type: None,
                    invoice_reference_model: None,
                    sequence_id: None,
                    refund_sequence_id: None,
                    sequence_override_regex: None,
                    secure_sequence_id: None,
                    alias_name: None,
                    alias_domain: None,
                    sale_activity_type_id: None,
                    sale_activity_user_id: None,
                    sale_activity_note: None,
                    sale_activity_date_deadline: None,
                    restrict_mode_hash_table: false,
                    active: true,
                    at_least_one_inbound: true,
                    at_least_one_outbound: true,
                    dedicated_payment_method_ids: vec![],
                    sale_activity_done: false,
                    metadata: None,
                },
            )?;
            find_journal(ctx).ok_or("Sales journal not found after create")?
        }
    };

    Ok(CreateInvoiceFromSaleOrderParams {
        journal_id,
        default_income_account_id: revenue_id,
        receivable_line: move_line(ar_id, "Accounts Receivable", Some(fixture.partner_id), true),
        income_line: move_line(revenue_id, "", None, false),
        metadata: None,
    })
}

/// Total invoiced quantity across an order's product lines.
fn invoiced_qty(ctx: &ReducerContext, order_id: u64) -> f64 {
    ctx.db
        .sale_order_line()
        .order_line_by_order()
        .filter(&order_id)
        .filter(|l| l.display_type.is_none())
        .map(|l| l.qty_invoiced)
        .sum()
}

fn to_invoice_qty(ctx: &ReducerContext, order_id: u64) -> f64 {
    ctx.db
        .sale_order_line()
        .order_line_by_order()
        .filter(&order_id)
        .filter(|l| l.display_type.is_none())
        .map(|l| l.qty_to_invoice)
        .sum()
}

fn invoice_count(ctx: &ReducerContext, order_id: u64) -> Result<usize, String> {
    ctx.db
        .sale_order()
        .id()
        .find(&order_id)
        .map(|o| o.invoice_ids.len())
        .ok_or_else(|| "Sale order missing".to_string())
}

fn invoice_status(ctx: &ReducerContext, order_id: u64) -> Result<InvoiceStatus, String> {
    ctx.db
        .sale_order()
        .id()
        .find(&order_id)
        .map(|o| o.invoice_status)
        .ok_or_else(|| "Sale order missing".to_string())
}

fn expect_refused(what: &str, result: Result<(), String>, reason: &str) -> Result<(), String> {
    match result {
        Ok(()) => Err(format!("{what} must be refused")),
        Err(e) if e.contains(reason) => Ok(()),
        Err(e) => Err(format!("{what}: expected \"{reason}\", got: {e}")),
    }
}

/// Delivery policy: bill 4 delivered, deliver the remaining 6, bill 6. Nothing is billable before
/// delivery, a repeat is refused, the order is not marked invoiced while units are undelivered
/// (which would hide billing of the rest), and the total billed is exactly what was ordered.
pub fn test_delivery_policy_invoices_only_what_was_delivered(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let order_id =
        confirmed_order_with_policy(ctx, &fixture, 10.0, "inv-delivery", Some("delivery"))?;

    // Nothing delivered: nothing to bill.
    expect_refused(
        "invoicing before any delivery",
        create_invoice_from_sale_order(ctx, org_id, order_id, invoice_params(ctx, &fixture)?),
        "No lines to invoice",
    )?;

    // Ship 4 and keep 6 owed.
    let picking_id = ready_delivery(ctx, &fixture, order_id)?;
    let (move_id, _, _) = only_move(ctx, org_id, picking_id)?;
    record_done(ctx, &fixture, move_id, 4.0)?;
    validate_stock_picking_backorder(ctx, org_id, picking_id, scope(&fixture))?;

    create_invoice_from_sale_order(ctx, org_id, order_id, invoice_params(ctx, &fixture)?)?;
    expect_close("invoiced after first invoice", invoiced_qty(ctx, order_id), 4.0)?;
    if invoice_count(ctx, order_id)? != 1 {
        return Err("Expected exactly one invoice after the first billing".to_string());
    }
    if invoice_status(ctx, order_id)? == InvoiceStatus::Invoiced {
        return Err(
            "A partly delivered order must not be Invoiced: 6 units are still to deliver and bill"
                .to_string(),
        );
    }

    // A repeat before more is delivered would double-bill: refused.
    expect_refused(
        "a duplicate invoice",
        create_invoice_from_sale_order(ctx, org_id, order_id, invoice_params(ctx, &fixture)?),
        "No lines to invoice",
    )?;
    if invoice_count(ctx, order_id)? != 1 {
        return Err("A refused duplicate must not add an invoice".to_string());
    }

    // Deliver the remainder: it becomes billable, exactly once.
    let backorder = backorder_of(ctx, org_id, picking_id)?;
    confirm_stock_picking(ctx, org_id, backorder, scope(&fixture))?;
    assign_stock_picking(ctx, org_id, backorder, scope(&fixture))?;
    validate_stock_picking(ctx, org_id, backorder, scope(&fixture))?;
    expect_close("billable after delivery", to_invoice_qty(ctx, order_id), 6.0)?;
    if invoice_status(ctx, order_id)? != InvoiceStatus::ToInvoice {
        return Err(format!(
            "Delivering the rest must make the order ToInvoice again, got {:?}",
            invoice_status(ctx, order_id)?
        ));
    }

    create_invoice_from_sale_order(ctx, org_id, order_id, invoice_params(ctx, &fixture)?)?;
    expect_close("invoiced in total", invoiced_qty(ctx, order_id), 10.0)?;
    if invoice_count(ctx, order_id)? != 2 {
        return Err("Expected two invoices for two deliveries".to_string());
    }
    if invoice_status(ctx, order_id)? != InvoiceStatus::Invoiced {
        return Err("A fully delivered and billed order must be Invoiced".to_string());
    }
    expect_refused(
        "billing a fully invoiced order",
        create_invoice_from_sale_order(ctx, org_id, order_id, invoice_params(ctx, &fixture)?),
        "No lines to invoice",
    )
}

/// Default (ordered) policy: the whole order is billed once, and a repeat is refused.
pub fn test_ordered_policy_invoice_is_not_repeatable(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let order_id = confirmed_order(ctx, &fixture, 5.0, "inv-ordered")?;

    create_invoice_from_sale_order(ctx, org_id, order_id, invoice_params(ctx, &fixture)?)?;
    expect_close("invoiced", invoiced_qty(ctx, order_id), 5.0)?;
    if invoice_status(ctx, order_id)? != InvoiceStatus::Invoiced {
        return Err("A fully billed order must be Invoiced".to_string());
    }
    expect_refused(
        "a duplicate invoice",
        create_invoice_from_sale_order(ctx, org_id, order_id, invoice_params(ctx, &fixture)?),
        "No lines to invoice",
    )?;
    if invoice_count(ctx, order_id)? != 1 {
        return Err("A refused duplicate must not add an invoice".to_string());
    }
    expect_close("invoiced after refusal", invoiced_qty(ctx, order_id), 5.0)
}

/// Another tenant cannot bill this tenant's order.
pub fn test_invoice_cross_org_rejected(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;
    // Ordered policy: billable straight away, so only the tenant check can refuse it.
    let order_id = confirmed_order(ctx, &fixture_a, 5.0, "inv-cross-org")?;

    expect_refused(
        "a foreign organization invoicing this order",
        create_invoice_from_sale_order(
            ctx,
            fixture_b.organization_id,
            order_id,
            invoice_params(ctx, &fixture_a)?,
        ),
        "does not belong to this organization",
    )?;
    if invoice_count(ctx, order_id)? != 0 {
        return Err("A rejected cross-tenant call must not create an invoice".to_string());
    }
    expect_close("invoiced", invoiced_qty(ctx, order_id), 0.0)
}
