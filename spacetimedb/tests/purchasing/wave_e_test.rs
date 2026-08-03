//! Wave E purchasing gap-fix domain tests.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_journal, create_account_journal, CreateAccountJournalParams,
};
use crate::accounting::journal_entries::{
    account_move_line, create_bill_from_purchase_order, post_invoice, AccountMoveLine,
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

fn empty_move_line(account_id: u64) -> AddAccountMoveLineParams {
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

fn expense_and_ap(fixture: &OrgFixture) -> Result<(u64, u64), String> {
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
    approve_purchase_requisition(ctx, org_id, requisition.id)?;
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
    ctx.db.account_move_line().id().update(AccountMoveLine {
        price_unit: po_price + 5.0,
        ..product_line
    });

    match post_invoice(ctx, org_id, bill_id, expense_id, expense_id) {
        Err(e) if e.contains("three-way match failed") && e.contains("bill price") => Ok(()),
        Err(e) => Err(format!("expected price match error, got: {e}")),
        Ok(()) => Err("price match should have blocked post_invoice".into()),
    }
}
