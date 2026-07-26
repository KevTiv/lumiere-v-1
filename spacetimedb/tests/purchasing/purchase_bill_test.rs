/// Purchase order → vendor bill balanced draft move domain test.
use spacetimedb::{ReducerContext, Table, Timestamp};

use crate::accounting::chart_of_accounts::{
    account_journal, create_account_journal, CreateAccountJournalParams,
};
use crate::accounting::journal_entries::{
    account_move, account_move_line, create_bill_from_purchase_order,
    AddAccountMoveLineParams, CreateBillFromPurchaseOrderParams,
};
use crate::crm::contacts::{contact, create_contact, CreateContactParams};
use crate::inventory::product::product;
use crate::purchasing::purchase_orders::{
    add_purchase_order_line, confirm_purchase_order, create_purchase_order, purchase_order,
    purchase_order_line, receive_po_line, AddPurchaseOrderLineParams, CreatePurchaseOrderParams,
};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{JournalType, MoveType, PoState};

pub fn test_po_confirm_to_balanced_bill(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    create_contact(
        ctx,
        org_id,
        CreateContactParams {
            name: "Harness Vendor".to_string(),
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
            display_name: Some("Harness Vendor".to_string()),
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
            metadata: Some(r#"{"test":"po_bill_vendor"}"#.to_string()),
        },
    )?;

    let vendor_id = ctx
        .db
        .contact()
        .iter()
        .find(|c| {
            c.organization_id == org_id && c.display_name == "Harness Vendor".to_string()
        })
        .map(|c| c.id)
        .ok_or("Harness vendor contact not found")?;

    let product_row = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("Harness product not found")?;

    create_purchase_order(
        ctx,
        org_id,
        CreatePurchaseOrderParams {
            company_id: Some(company_id),
            partner_id: vendor_id,
            currency_id: 1,
            origin: Some("Harness PO".to_string()),
            partner_ref: Some("HARNESS-PO-001".to_string()),
            notes: None,
            date_planned: None,
            payment_term_id: None,
            fiscal_position_id: None,
            incoterm_id: None,
            incoterm_location: None,
            user_id: None,
            invoice_ids: vec![],
            picking_ids: vec![],
            message_follower_ids: vec![],
            message_ids: vec![],
            activity_ids: vec![],
            is_quantity_copy: None,
            metadata: Some(r#"{"test":"po_confirm_to_bill"}"#.to_string()),
        },
    )?;

    let order = ctx
        .db
        .purchase_order()
        .iter()
        .find(|o| {
            o.organization_id == org_id
                && o.partner_ref == Some("HARNESS-PO-001".to_string())
        })
        .ok_or("Purchase order not found after create")?;

    add_purchase_order_line(
        ctx,
        org_id,
        order.id,
        AddPurchaseOrderLineParams {
            product_id: fixture.product_id,
            quantity: 2.0,
            uom_id: product_row.uom_id,
            price_unit: 500.0,
            discount: 0.0,
            tax_ids: vec![],
            name: None,
            sequence: Some(1),
            display_type: None,
            product_variant_id: None,
            account_analytic_id: None,
            date_planned: None,
            propagate_cancel: None,
            lot_id: None,
            metadata: None,
        },
    )?;

    confirm_purchase_order(ctx, org_id, order.id)?;

    let confirmed = ctx
        .db
        .purchase_order()
        .id()
        .find(&order.id)
        .ok_or("Purchase order not found after confirm")?;

    if confirmed.state != PoState::Purchase {
        return Err(format!(
            "Expected Purchase state after confirm, got {:?}",
            confirmed.state
        ));
    }

    let line = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&order.id)
        .next()
        .ok_or("Purchase order line not found")?;

    receive_po_line(ctx, org_id, line.id, line.product_qty, None)?;

    let ap_id = *fixture
        .chart_account_ids
        .get(chart_keys::AP)
        .ok_or("Harness missing payable account")?;
    let expense_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("Harness missing expense stand-in account")?;

    let journal_code = format!("PO{company_id}");
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
                company_id: Some(company_id),
                name: "Harness PO Purchase Journal".to_string(),
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
            .ok_or("PO purchase journal not found after create")?
    };

    create_bill_from_purchase_order(
        ctx,
        org_id,
        order.id,
        CreateBillFromPurchaseOrderParams {
            journal_id,
            default_expense_account_id: expense_id,
            invoice_date: ctx.timestamp,
            expense_line: AddAccountMoveLineParams {
                account_id: expense_id,
                name: String::new(),
                debit: 0.0,
                credit: 0.0,
                sequence: 0,
                quantity: 0.0,
                price_unit: 0.0,
                discount: 0.0,
                tax_ids: vec![],
                partner_id: Some(vendor_id),
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
            payable_line: AddAccountMoveLineParams {
                account_id: ap_id,
                name: "Accounts Payable".to_string(),
                debit: 0.0,
                credit: 0.0,
                sequence: 0,
                quantity: 0.0,
                price_unit: 0.0,
                discount: 0.0,
                tax_ids: vec![],
                partner_id: Some(vendor_id),
                product_id: None,
                product_uom_id: None,
                product_category_id: None,
                analytic_account_id: None,
                analytic_tag_ids: vec![],
                display_type: None,
                is_downpayment: false,
                exclude_from_invoice_tab: true,
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
            metadata: None,
        },
    )?;

    let billed = ctx
        .db
        .purchase_order()
        .id()
        .find(&order.id)
        .ok_or("Purchase order not found after billing")?;

    if billed.invoice_count == 0 || billed.invoice_ids.is_empty() {
        return Err("Purchase order has no linked bill after create_bill_from_purchase_order".to_string());
    }

    let bill_move_id = billed.invoice_ids[0];
    let bill = ctx
        .db
        .account_move()
        .id()
        .find(&bill_move_id)
        .ok_or("Vendor bill move not found")?;

    if bill.move_type != MoveType::InInvoice {
        return Err(format!(
            "Expected InInvoice move type, got {:?}",
            bill.move_type
        ));
    }

    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&bill_move_id)
        .collect();

    if lines.is_empty() {
        return Err("Draft vendor bill has no move lines".to_string());
    }

    let total_debit: f64 = lines.iter().map(|l| l.debit).sum();
    let total_credit: f64 = lines.iter().map(|l| l.credit).sum();

    if (total_debit - total_credit).abs() >= 0.01 {
        return Err(format!(
            "Draft vendor bill move lines not balanced: debit={total_debit} credit={total_credit}"
        ));
    }

    let _invoice_date: Timestamp = bill.invoice_date.unwrap_or(ctx.timestamp);
    Ok(())
}
