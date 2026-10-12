//! Wave E purchasing gap-fix domain tests.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_journal, create_account_journal, CreateAccountJournalParams,
};
use crate::accounting::journal_entries::{
    account_move, account_move_line, create_bill_from_purchase_order, post_invoice,
    AddAccountMoveLineParams, CreateBillFromPurchaseOrderParams,
};
use crate::crm::contacts::{contact, create_contact, CreateContactParams};
use crate::inventory::product::product;
use crate::purchasing::purchase_orders::{
    approve_purchase_requisition, confirm_purchase_order, convert_purchase_requisition_to_po,
    create_purchase_requisition, purchase_order, purchase_order_line, purchase_requisition,
    receive_po_line, submit_purchase_requisition, CreatePurchaseRequisitionLineParams,
    CreatePurchaseRequisitionParams,
};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::JournalType;

use super::gap_fixes_test::seed_vendor_po;

pub(super) fn empty_move_line(account_id: u64) -> AddAccountMoveLineParams {
    AddAccountMoveLineParams {
        account_id,
        name: String::new(),
        debit: 0.0,
        credit: 0.0,
        sequence: 0,
        quantity: 0.0,
        price_unit: 0.0,
        discount: 0.0,
        tax_ids: vec![],
        partner_id: None,
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
    }
}

pub(super) fn expense_and_ap(fixture: &OrgFixture) -> Result<(u64, u64), String> {
    let ap_id = *fixture
        .chart_account_ids
        .get(chart_keys::AP)
        .ok_or("AP account missing")?;
    let expense_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("expense stand-in account missing")?;
    Ok((expense_id, ap_id))
}

/// Approved requisition with a line converts to a draft PO that copies product/qty.
pub fn test_requisition_convert_copies_lines(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    create_contact(
        ctx,
        org_id,
        CreateContactParams {
            name: "Req Vendor".to_string(),
            type_: "contact".to_string(),
            email: None,
            phone: None,
            mobile: None,
            company_id: Some(company_id),
            is_customer: false,
            is_vendor: true,
            is_employee: false,
            is_prospect: false,
            is_partner: false,
            customer_rank: 0,
            supplier_rank: 1,
            display_name: Some("Req Vendor".to_string()),
            first_name: None,
            last_name: None,
            title: None,
            email_secondary: None,
            fax: None,
            website: None,
            street: None,
            street2: None,
            city: None,
            state_code: None,
            zip: None,
            country_code: None,
            tax_id: None,
            company_registry: None,
            industry: None,
            employees_count: None,
            annual_revenue: None,
            description: None,
            salesperson_id: None,
            assigned_user_id: None,
            parent_id: None,
            user_id: None,
            color: None,
            metadata: Some(r#"{"test":"req-vendor"}"#.to_string()),
        },
    )?;
    let vendor_id = ctx
        .db
        .contact()
        .iter()
        .find(|c| c.organization_id == org_id && c.display_name == "Req Vendor")
        .map(|c| c.id)
        .ok_or("vendor missing")?;

    let product_row = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("product missing")?;

    create_purchase_requisition(
        ctx,
        org_id,
        CreatePurchaseRequisitionParams {
            company_id: Some(company_id),
            origin: Some("wave-e-req".to_string()),
            description: Some("Need stock".to_string()),
            ordering_date: None,
            date_end: None,
            schedule_date: None,
            department_id: None,
            exclusive: None,
            multiple_product: false,
            line_ids: vec![],
            lines: vec![CreatePurchaseRequisitionLineParams {
                product_id: fixture.product_id,
                product_uom: product_row.uom_id,
                product_uom_qty: 4.0,
                name: Some("Req line".to_string()),
                sequence: Some(10),
            }],
            purchase_ids: vec![],
            vendor_id: Some(vendor_id),
            activity_ids: vec![],
            message_follower_ids: vec![],
            message_ids: vec![],
            metadata: None,
        },
    )?;

    let requisition = ctx
        .db
        .purchase_requisition()
        .iter()
        .find(|r| r.organization_id == org_id && r.origin.as_deref() == Some("wave-e-req"))
        .ok_or("requisition missing")?;
    if requisition.line_ids.is_empty() {
        return Err("expected requisition line_ids populated".into());
    }

    submit_purchase_requisition(ctx, org_id, requisition.id)?;
    if approve_purchase_requisition(ctx, org_id, requisition.id).is_ok() {
        return Err("requester approved their own requisition".into());
    }
    let submitted = ctx
        .db
        .purchase_requisition()
        .id()
        .find(&requisition.id)
        .ok_or("submitted requisition missing")?;
    if submitted.state != crate::types::RequisitionState::InProgress {
        return Err("self-approval changed requisition state".into());
    }
    // This single-context reducer harness seeds a separate requester. The
    // browser certification uses two real authenticated sessions instead.
    let requester = spacetimedb::Identity::from_byte_array(
        if ctx.sender() == spacetimedb::Identity::from_byte_array([0xfa; 32]) {
            [0xfb; 32]
        } else {
            [0xfa; 32]
        },
    );
    ctx.db.purchase_requisition().id().update(
        crate::purchasing::purchase_orders::PurchaseRequisition {
            user_id: requester,
            create_uid: requester,
            ..submitted
        },
    );
    approve_purchase_requisition(ctx, org_id, requisition.id)?;
    if approve_purchase_requisition(ctx, org_id, requisition.id).is_ok() {
        return Err("approved requisition accepted a stale approval".into());
    }
    convert_purchase_requisition_to_po(ctx, org_id, company_id, requisition.id)?;

    let po = ctx
        .db
        .purchase_order()
        .iter()
        .find(|o| {
            o.organization_id == org_id
                && o.origin.as_deref() == Some(&format!("requisition:{}", requisition.id))
        })
        .ok_or("converted PO missing")?;

    let lines: Vec<_> = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&po.id)
        .collect();
    if lines.len() != 1 {
        return Err(format!("expected 1 PO line, got {}", lines.len()));
    }
    if lines[0].product_id != fixture.product_id {
        return Err("PO line product mismatch".into());
    }
    if (lines[0].product_qty - 4.0).abs() > 0.001 {
        return Err(format!("expected qty 4.0, got {}", lines[0].product_qty));
    }
    Ok(())
}

/// Org B cannot receive or bill org A's PO.
pub fn test_company_isolation_on_receive_and_bill(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;

    let (org_a, order_a) = seed_vendor_po(ctx, &fixture_a, "ISO-RECV-A")?;
    confirm_purchase_order(ctx, org_a, order_a)?;

    let line_id = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&order_a)
        .next()
        .map(|l| l.id)
        .ok_or("line missing")?;

    match receive_po_line(ctx, fixture_b.organization_id, line_id, 1.0, None) {
        Err(_) => {}
        Ok(()) => {
            return Err(
                "company isolation failed: org B received org A purchase order line".to_string(),
            )
        }
    }

    receive_po_line(ctx, org_a, line_id, 1.0, None)?;

    let (expense_id, ap_id) = expense_and_ap(&fixture_a)?;
    let journal_code = format!("WB{org_a}");
    let journal_id = if let Some(j) = ctx
        .db
        .account_journal()
        .iter()
        .find(|j| j.organization_id == org_a && j.code == journal_code)
    {
        j.id
    } else {
        create_account_journal(
            ctx,
            org_a,
            CreateAccountJournalParams {
                company_id: Some(fixture_a.company_id),
                name: "Wave E Purchase Journal".to_string(),
                code: journal_code.clone(),
                type_: JournalType::Purchase,
                currency_id: Some(1),
                default_account_id: Some(expense_id),
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
        ctx.db
            .account_journal()
            .iter()
            .find(|j| j.code == journal_code)
            .map(|j| j.id)
            .ok_or("journal missing")?
    };

    let partner_id = ctx
        .db
        .purchase_order()
        .id()
        .find(&order_a)
        .map(|o| o.partner_id)
        .ok_or("po missing")?;
    let mut expense = empty_move_line(expense_id);
    expense.partner_id = Some(partner_id);
    let mut payable = empty_move_line(ap_id);
    payable.name = "AP".to_string();
    payable.exclude_from_invoice_tab = true;

    match create_bill_from_purchase_order(
        ctx,
        fixture_b.organization_id,
        order_a,
        CreateBillFromPurchaseOrderParams {
            journal_id,
            default_expense_account_id: expense_id,
            invoice_date: ctx.timestamp,
            expense_line: expense.clone(),
            payable_line: payable.clone(),
            metadata: None,
        },
    ) {
        Err(_) => {}
        Ok(()) => {
            return Err("company isolation failed: org B billed org A purchase order".to_string())
        }
    }

    create_bill_from_purchase_order(
        ctx,
        org_a,
        order_a,
        CreateBillFromPurchaseOrderParams {
            journal_id,
            default_expense_account_id: expense_id,
            invoice_date: ctx.timestamp,
            expense_line: expense,
            payable_line: payable,
            metadata: None,
        },
    )?;

    Ok(())
}

/// Price variance beyond tolerance fails closed on `post_invoice`.
pub fn test_price_match_blocks_post_invoice(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let (org_id, order_id) = seed_vendor_po(ctx, &fixture, "PRICE-MATCH-1")?;
    confirm_purchase_order(ctx, org_id, order_id)?;

    let line_id = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&order_id)
        .next()
        .map(|l| l.id)
        .ok_or("line missing")?;
    receive_po_line(ctx, org_id, line_id, 3.0, None)?;

    let (expense_id, ap_id) = expense_and_ap(&fixture)?;
    let journal_code = format!("PM{org_id}");
    let journal_id = if let Some(j) = ctx
        .db
        .account_journal()
        .iter()
        .find(|j| j.organization_id == org_id && j.code == journal_code)
    {
        j.id
    } else {
        create_account_journal(
            ctx,
            org_id,
            CreateAccountJournalParams {
                company_id: Some(fixture.company_id),
                name: "Price Match Journal".to_string(),
                code: journal_code.clone(),
                type_: JournalType::Purchase,
                currency_id: Some(1),
                default_account_id: Some(expense_id),
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
        ctx.db
            .account_journal()
            .iter()
            .find(|j| j.code == journal_code)
            .map(|j| j.id)
            .ok_or("journal missing")?
    };

    let partner_id = ctx
        .db
        .purchase_order()
        .id()
        .find(&order_id)
        .map(|o| o.partner_id)
        .ok_or("po missing")?;
    let mut expense = empty_move_line(expense_id);
    expense.partner_id = Some(partner_id);
    let mut payable = empty_move_line(ap_id);
    payable.name = "AP".to_string();
    payable.exclude_from_invoice_tab = true;

    create_bill_from_purchase_order(
        ctx,
        org_id,
        order_id,
        CreateBillFromPurchaseOrderParams {
            journal_id,
            default_expense_account_id: expense_id,
            invoice_date: ctx.timestamp,
            expense_line: expense,
            payable_line: payable,
            metadata: None,
        },
    )?;

    let po = ctx
        .db
        .purchase_order()
        .id()
        .find(&order_id)
        .ok_or("po after bill")?;
    let bill_id = *po.invoice_ids.first().ok_or("no bill id")?;

    let product_line = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&bill_id)
        .find(|l| l.debit > 0.0 && l.product_id.is_some())
        .ok_or("expense product line missing")?;
    let po_price = ctx
        .db
        .purchase_order_line()
        .id()
        .find(&line_id)
        .map(|l| l.price_unit)
        .ok_or("po line")?;
    let correction = |qty, price, expected_qty, expected_price| {
        crate::accounting::journal_entries::UpdateAccountMoveLineParams {
            company_id: Some(fixture.company_id),
            name: None,
            debit: None,
            credit: None,
            partner_id: None,
            analytic_account_id: None,
            metadata: None,
            quantity: Some(qty),
            price_unit: Some(price),
            expected_quantity: Some(expected_qty),
            expected_price_unit: Some(expected_price),
        }
    };
    let update = crate::accounting::journal_entries::update_account_move_line;
    update(
        ctx,
        org_id,
        product_line.id,
        correction(
            3.0,
            po_price + 5.0,
            product_line.quantity,
            product_line.price_unit,
        ),
    )?;
    let altered = ctx
        .db
        .account_move_line()
        .id()
        .find(&product_line.id)
        .ok_or("corrected line")?;
    let bill_before = ctx.db.account_move().id().find(&bill_id).ok_or("bill")?;
    if (altered.debit - 3.0 * (po_price + 5.0)).abs() > 1e-8
        || (bill_before.amount_total - altered.debit).abs() > 1e-8
    {
        return Err("correction did not rebalance bill economics".into());
    }
    match post_invoice(ctx, org_id, bill_id, expense_id, expense_id) {
        Err(e) if e.contains("three-way match failed") && e.contains("bill price") => {}
        Err(e) => return Err(format!("expected price match error, got: {e}")),
        Ok(()) => return Err("price match should have blocked post_invoice".into()),
    }
    if update(
        ctx,
        org_id,
        product_line.id,
        correction(
            3.0,
            po_price,
            product_line.quantity,
            product_line.price_unit,
        ),
    )
    .is_ok()
    {
        return Err("stale reviewed price was accepted".into());
    }
    if update(
        ctx,
        org_id,
        product_line.id,
        correction(f64::NAN, po_price, 3.0, po_price + 5.0),
    )
    .is_ok()
    {
        return Err("non-finite correction was accepted".into());
    }
    if update(
        ctx,
        org_id,
        product_line.id,
        correction(4.0, po_price, 3.0, po_price + 5.0),
    )
    .is_ok()
    {
        return Err("over-received correction was accepted".into());
    }
    let rejected = ctx
        .db
        .account_move()
        .id()
        .find(&bill_id)
        .ok_or("rejected bill")?;
    if rejected.state != crate::types::AccountMoveState::Draft
        || rejected.amount_total != bill_before.amount_total
    {
        return Err("rejection changed bill state or totals".into());
    }
    update(
        ctx,
        org_id,
        product_line.id,
        correction(2.0, po_price, 3.0, po_price + 5.0),
    )?;
    let source = ctx
        .db
        .purchase_order_line()
        .id()
        .find(&line_id)
        .ok_or("source")?;
    if source.qty_invoiced != 2.0
        || source.qty_to_invoice != 1.0
        || source.match_state != "under_billed"
    {
        return Err("quantity correction did not refresh source quantities".into());
    }
    update(
        ctx,
        org_id,
        product_line.id,
        correction(3.0, po_price, 2.0, po_price),
    )?;
    exercise_broader_bill_correction(ctx, &fixture, order_id, bill_id, product_line.id)?;
    post_invoice(ctx, org_id, bill_id, expense_id, expense_id)?;
    if update(
        ctx,
        org_id,
        product_line.id,
        correction(3.0, po_price, 3.0, po_price),
    )
    .is_ok()
    {
        return Err("posted bill accepted correction".into());
    }
    Ok(())
}
/// Authored runtime evidence: one PO bill transitions through discount, tax and FX
/// shapes, preserving exact source IDs. This fixture does not constitute execution.
fn exercise_broader_bill_correction(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    po_id: u64,
    bill_id: u64,
    expense_id: u64,
) -> Result<(), String> {
    use crate::accounting::journal_entries::{
        compute_invoice_totals, update_account_move_line, AccountMoveLine,
        UpdateAccountMoveLineParams,
    };
    use crate::accounting::tax_management::{account_tax, AccountTax};
    use crate::core::reference::{currency, currency_rate, CurrencyRate};
    use crate::types::{TaxAmountType, TaxTypeUse};
    let org = fixture.organization_id;
    let bill = ctx.db.account_move().id().find(&bill_id).ok_or("bill")?;
    let original = ctx
        .db
        .account_move_line()
        .id()
        .find(&expense_id)
        .ok_or("expense")?;
    let payable = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&bill_id)
        .find(|l| l.account_internal_type.as_deref() == Some("Payable"))
        .ok_or("payable")?;
    let po = ctx.db.purchase_order().id().find(&po_id).ok_or("PO")?;
    let source = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&po_id)
        .find(|p| p.invoice_lines.contains(&expense_id))
        .ok_or("source")?;
    let fx_currency = ctx
        .db
        .currency()
        .currency_by_organization()
        .filter(&org)
        .find(|c| c.id != bill.company_currency_id && c.active)
        .ok_or("FX fixture currency")?;
    let tax = ctx.db.account_tax().insert(AccountTax {
        id: 0,
        organization_id: org,
        name: format!("Correction VAT {bill_id}"),
        description: None,
        type_tax_use: TaxTypeUse::Purchase,
        amount_type: TaxAmountType::Percent,
        amount: 20.0,
        active: true,
        price_include: false,
        include_base_amount: false,
        is_base_affected: false,
        sequence: 1,
        company_id: fixture.company_id,
        tax_group_id: None,
        country_id: None,
        country_code: None,
        tags: vec![],
        has_negative_factor: false,
        invoice_repartition_line_ids: vec![],
        refund_repartition_line_ids: vec![],
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: None,
        write_date: None,
        metadata: None,
    });
    let fx_rate = ctx.db.currency_rate().insert(CurrencyRate {
        id: 0,
        organization_id: org,
        from_currency_id: fx_currency.id,
        to_currency_id: bill.company_currency_id,
        rate: 1.25,
        inverse_rate: 0.8,
        date: bill.invoice_date.unwrap_or(bill.date),
        company_id: Some(fixture.company_id),
        created_at: ctx.timestamp,
        metadata: None,
    });
    let amounts = |mut row: AccountMoveLine, amount: f64, total: f64, rate: f64, credit: bool| {
        let ledger = if rate == 1.0 {
            amount
        } else {
            (amount * rate * 100.0).round() / 100.0
        };
        row.price = amount;
        row.price_subtotal = amount;
        row.price_total = total;
        row.debit = if credit { 0.0 } else { ledger };
        row.credit = if credit { ledger } else { 0.0 };
        let sign = if credit { -1.0 } else { 1.0 };
        row.balance = sign * ledger;
        row.amount_currency = sign * amount;
        row.amount_residual = sign * ledger;
        row.amount_residual_currency = sign * amount;
        row.debit_currency = if credit { 0.0 } else { amount };
        row.credit_currency = if credit { amount } else { 0.0 };
        row
    };
    for (taxed, foreign) in [(false, false), (true, false), (true, true)] {
        let rate = if foreign { 1.25 } else { 1.0 };
        let currency = if foreign {
            fx_currency.id
        } else {
            bill.currency_id
        };
        let net = original.quantity * original.price_unit * 0.9;
        let tax_amount = if taxed { net * 0.2 } else { 0.0 };
        let mut expense = amounts(original.clone(), net, net + tax_amount, rate, false);
        expense.discount = 10.0;
        expense.currency_id = currency;
        expense.currency_id_field = Some(currency);
        expense.tax_ids = if taxed { vec![tax.id] } else { vec![] };
        let mut counter = amounts(
            payable.clone(),
            net + tax_amount,
            net + tax_amount,
            rate,
            true,
        );
        counter.price_unit = net + tax_amount;
        counter.currency_id = currency;
        counter.currency_id_field = Some(currency);
        ctx.db.account_move_line().id().update(expense.clone());
        ctx.db.account_move_line().id().update(counter);
        ctx.db
            .account_move()
            .id()
            .update(crate::accounting::journal_entries::AccountMove {
                currency_id: currency,
                ..bill.clone()
            });
        ctx.db
            .purchase_order()
            .id()
            .update(crate::purchasing::purchase_orders::PurchaseOrder {
                currency_id: currency,
                ..ctx.db.purchase_order().id().find(&po_id).ok_or("PO")?
            });
        ctx.db.purchase_order_line().id().update(
            crate::purchasing::purchase_orders::PurchaseOrderLine {
                currency_id: currency,
                ..ctx
                    .db
                    .purchase_order_line()
                    .id()
                    .find(&source.id)
                    .ok_or("source")?
            },
        );
        let tax_row = if taxed {
            let mut row = amounts(original.clone(), tax_amount, tax_amount, rate, false);
            row.id = 0;
            row.quantity = 1.0;
            row.price_unit = tax_amount;
            row.product_id = None;
            row.product_uom_id = None;
            row.tax_line_id = Some(tax.id);
            row.tax_base_amount = net;
            row.currency_id = currency;
            row.currency_id_field = Some(currency);
            Some(ctx.db.account_move_line().insert(row))
        } else {
            None
        };
        compute_invoice_totals(ctx, org, bill_id)?;
        let params = || UpdateAccountMoveLineParams {
            company_id: Some(fixture.company_id),
            quantity: Some(2.0),
            price_unit: Some(original.price_unit),
            expected_quantity: Some(original.quantity),
            expected_price_unit: Some(original.price_unit),
            name: None,
            debit: None,
            credit: None,
            partner_id: None,
            analytic_account_id: None,
            metadata: None,
        };
        // Missing aggregate tax evidence must not leave partial writes.
        if let Some(row) = &tax_row {
            ctx.db.account_move_line().id().delete(row.id);
            if update_account_move_line(ctx, org, expense_id, params()).is_ok() {
                return Err("missing tax row accepted correction".into());
            }
            let unchanged = ctx
                .db
                .account_move_line()
                .id()
                .find(&expense_id)
                .ok_or("expense")?;
            if unchanged.quantity != expense.quantity || unchanged.debit != expense.debit {
                return Err("rejected correction changed economics".into());
            }
            ctx.db.account_move_line().insert(row.clone());
        }
        if foreign {
            ctx.db.currency_rate().id().update(CurrencyRate {
                rate: 1.5,
                inverse_rate: 1.0 / 1.5,
                ..ctx
                    .db
                    .currency_rate()
                    .id()
                    .find(&fx_rate.id)
                    .ok_or("FX rate")?
            });
            if update_account_move_line(ctx, org, expense_id, params()).is_ok() {
                return Err("changed FX evidence was silently applied".into());
            }
            ctx.db.currency_rate().id().update(CurrencyRate {
                rate: 1.25,
                inverse_rate: 0.8,
                ..ctx
                    .db
                    .currency_rate()
                    .id()
                    .find(&fx_rate.id)
                    .ok_or("FX rate")?
            });
        }
        update_account_move_line(ctx, org, expense_id, params())?;
        let corrected = ctx
            .db
            .account_move_line()
            .id()
            .find(&expense_id)
            .ok_or("expense")?;
        let new_bill = ctx.db.account_move().id().find(&bill_id).ok_or("bill")?;
        let new_net = 2.0 * original.price_unit * 0.9;
        let new_tax = if taxed { new_net * 0.2 } else { 0.0 };
        let lines: Vec<_> = ctx
            .db
            .account_move_line()
            .move_line_by_move()
            .filter(&bill_id)
            .collect();
        let balance: f64 = lines.iter().map(|l| l.debit - l.credit).sum();
        if corrected.discount != 10.0
            || (corrected.price_subtotal - new_net).abs() > 1e-8
            || (new_bill.amount_total - new_net - new_tax).abs() > 1e-8
            || (new_bill.amount_tax - new_tax).abs() > 1e-8
            || balance.abs() > 1e-8
        {
            return Err("discount/tax/FX correction did not conserve amounts".into());
        }
        if foreign && (new_bill.amount_total_signed - (new_bill.amount_total * rate)).abs() > 0.01 {
            return Err("FX ledger totals use the wrong currency".into());
        }
        // Restore source quantity using the real correction, then restore the
        // test-only shape before the next scenario and final ordinary posting.
        update_account_move_line(
            ctx,
            org,
            expense_id,
            UpdateAccountMoveLineParams {
                quantity: Some(original.quantity),
                expected_quantity: Some(2.0),
                ..params()
            },
        )?;
        if let Some(row) = tax_row {
            ctx.db.account_move_line().id().delete(row.id);
        }
        ctx.db.account_move_line().id().update(original.clone());
        ctx.db.account_move_line().id().update(payable.clone());
        ctx.db.account_move().id().update(bill.clone());
        ctx.db
            .purchase_order()
            .id()
            .update(crate::purchasing::purchase_orders::PurchaseOrder {
                currency_id: po.currency_id,
                ..ctx.db.purchase_order().id().find(&po_id).ok_or("PO")?
            });
        ctx.db.purchase_order_line().id().update(
            crate::purchasing::purchase_orders::PurchaseOrderLine {
                currency_id: source.currency_id,
                ..ctx
                    .db
                    .purchase_order_line()
                    .id()
                    .find(&source.id)
                    .ok_or("source")?
            },
        );
    }
    Ok(())
}
