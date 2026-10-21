/// Purchase order → vendor bill balanced draft move domain test.
use spacetimedb::{ReducerContext, Table, Timestamp};

use crate::accounting::chart_of_accounts::{
    account_journal, create_account_journal, CreateAccountJournalParams,
};
use crate::accounting::journal_entries::{
    account_move, account_move_line, create_bill_from_purchase_order, AddAccountMoveLineParams,
    CreateBillFromPurchaseOrderParams,
};
use crate::core::organization::company;
use crate::crm::contacts::{contact, create_contact, CreateContactParams};
use crate::inventory::product::{product, Product};
use crate::inventory::stock::{stock_move, stock_picking};
use crate::purchasing::purchase_orders::{
    add_purchase_order_line, confirm_purchase_order, create_purchase_order, invoice_po_line,
    purchase_order, purchase_order_line, receive_po_line, AddPurchaseOrderLineParams,
    CreatePurchaseOrderParams,
};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{JournalType, MoveType, PoInvoiceStatus, PoState};

pub fn test_po_confirm_to_balanced_bill(ctx: &ReducerContext) -> Result<(), String> {
    test_po_bill_cycle(ctx, false, false)?;
    test_po_bill_cycle(ctx, true, false)?;
    test_po_bill_cycle(ctx, true, true)
}

/// Existing balanced-bill gate also exercises exact residual stock and service cycles.
fn test_po_bill_cycle(ctx: &ReducerContext, partial: bool, service: bool) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let currency_id = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Harness company not found")?
        .currency_id;

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
        .find(|c| c.organization_id == org_id && c.display_name == "Harness Vendor".to_string())
        .map(|c| c.id)
        .ok_or("Harness vendor contact not found")?;

    let product_row = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("Harness product not found")?;

    let product_uom_id = product_row.uom_id;
    if service {
        ctx.db.product().id().update(Product {
            type_: "service".to_string(),
            ..product_row
        });
    }

    create_purchase_order(
        ctx,
        org_id,
        CreatePurchaseOrderParams {
            company_id: Some(company_id),
            partner_id: vendor_id,
            currency_id,
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
            o.organization_id == org_id && o.partner_ref == Some("HARNESS-PO-001".to_string())
        })
        .ok_or("Purchase order not found after create")?;

    add_purchase_order_line(
        ctx,
        org_id,
        order.id,
        AddPurchaseOrderLineParams {
            product_id: fixture.product_id,
            quantity: if partial { 10.0 } else { 2.0 },
            uom_id: product_uom_id,
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

    let original_move = if partial && !service {
        let moves: Vec<_> = ctx
            .db
            .stock_move()
            .iter()
            .filter(|m| m.organization_id == org_id && m.purchase_line_id == Some(line.id))
            .collect();
        if moves.len() != 1 {
            return Err("Expected one exact original PO receipt move".to_string());
        }
        Some(moves[0].clone())
    } else {
        None
    };
    receive_po_line(
        ctx,
        org_id,
        line.id,
        if partial { 4.0 } else { line.product_qty },
        None,
    )?;
    if ctx
        .db
        .purchase_order()
        .id()
        .find(&order.id)
        .ok_or("Missing received PO")?
        .invoice_status
        != PoInvoiceStatus::No
    {
        return Err("Receipt without invoices must retain No invoice status".to_string());
    }

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
                currency_id: Some(currency_id),
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

    let bill_params = CreateBillFromPurchaseOrderParams {
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
            partner_id: if service { None } else { Some(u64::MAX) },
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
            partner_id: if service { None } else { Some(u64::MAX) },
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
    };
    create_bill_from_purchase_order(ctx, org_id, order.id, bill_params.clone())?;

    let billed = ctx
        .db
        .purchase_order()
        .id()
        .find(&order.id)
        .ok_or("Purchase order not found after billing")?;

    if billed.invoice_count == 0 || billed.invoice_ids.is_empty() {
        return Err(
            "Purchase order has no linked bill after create_bill_from_purchase_order".to_string(),
        );
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
    if lines.iter().any(|row| row.partner_id != Some(vendor_id)) {
        return Err("Generated bill lines must derive the PO supplier".to_string());
    }

    let total_debit: f64 = lines.iter().map(|l| l.debit).sum();
    let total_credit: f64 = lines.iter().map(|l| l.credit).sum();

    if (total_debit - total_credit).abs() >= 0.01 {
        return Err(format!(
            "Draft vendor bill move lines not balanced: debit={total_debit} credit={total_credit}"
        ));
    }

    if partial {
        if billed.invoice_status != PoInvoiceStatus::Invoiced
            || billed.invoice_count != 1
            || billed.invoice_ids.len() != 1
        {
            return Err(
                "First partial bill must cover current receipt with one exact relation".to_string(),
            );
        }
        let first_product_lines: Vec<_> = lines
            .iter()
            .filter(|l| l.product_id == Some(fixture.product_id))
            .collect();
        if first_product_lines.len() != 1 || first_product_lines[0].quantity != 4.0 {
            return Err("First bill must contain exact received quantity 4".to_string());
        }
        let residual = if let Some(original) = original_move {
            let original_picking_id = original.picking_id.ok_or("Original picking missing")?;
            let picking = ctx
                .db
                .stock_picking()
                .id()
                .find(&original_picking_id)
                .ok_or("Original picking not found")?;
            if picking.backorder_ids.len() != 1 {
                return Err("Expected one exact backorder relation".to_string());
            }
            let backorder_id = picking.backorder_ids[0];
            let backorder = ctx
                .db
                .stock_picking()
                .id()
                .find(&backorder_id)
                .ok_or("Backorder picking missing")?;
            if backorder.backorder_id != Some(original_picking_id) {
                return Err("Backorder parent relation changed".to_string());
            }
            let moves: Vec<_> = ctx
                .db
                .stock_move()
                .iter()
                .filter(|m| {
                    m.organization_id == org_id
                        && m.purchase_line_id == Some(line.id)
                        && !m.is_done
                        && m.state != "cancel"
                        && m.state != "done"
                })
                .collect();
            if moves.len() != 1
                || moves[0].picking_id != Some(backorder_id)
                || moves[0].product_uom_qty - moves[0].quantity_done != 6.0
            {
                return Err(
                    "Expected exact residual move quantity 6 on linked backorder".to_string(),
                );
            }
            Some(moves[0].clone())
        } else {
            if ctx
                .db
                .stock_move()
                .iter()
                .any(|m| m.purchase_line_id == Some(line.id))
            {
                return Err("Service receipt unexpectedly created a stock move".to_string());
            }
            None
        };

        // Native calls must reject before writes, including the service receipt bypass.
        let snapshot = || -> Result<_, String> {
            let source = ctx
                .db
                .purchase_order_line()
                .id()
                .find(&line.id)
                .ok_or("Source missing during quantity guard check")?;
            let po = ctx
                .db
                .purchase_order()
                .id()
                .find(&order.id)
                .ok_or("PO missing during quantity guard check")?;
            let mut moves: Vec<_> = ctx
                .db
                .stock_move()
                .iter()
                .filter(|row| row.organization_id == org_id)
                .map(|row| {
                    (
                        row.id,
                        row.purchase_line_id,
                        row.picking_id,
                        row.product_uom_qty.to_bits(),
                        row.quantity_done.to_bits(),
                        row.state,
                        row.is_done,
                    )
                })
                .collect();
            moves.sort_by_key(|row| row.0);
            let mut pickings: Vec<_> = ctx
                .db
                .stock_picking()
                .iter()
                .filter(|row| row.organization_id == org_id)
                .map(|row| (row.id, row.state, row.backorder_id, row.backorder_ids))
                .collect();
            pickings.sort_by_key(|row| row.0);
            let mut bills: Vec<_> = ctx
                .db
                .account_move()
                .iter()
                .filter(|row| row.organization_id == org_id)
                .map(|row| row.id)
                .collect();
            bills.sort_unstable();
            let mut bill_lines: Vec<_> = ctx
                .db
                .account_move_line()
                .iter()
                .filter(|row| row.organization_id == org_id)
                .map(|row| {
                    (
                        row.id,
                        row.move_id,
                        row.quantity.to_bits(),
                        row.debit.to_bits(),
                        row.credit.to_bits(),
                        row.partner_id,
                    )
                })
                .collect();
            bill_lines.sort_by_key(|row| row.0);
            Ok((
                format!(
                    "{:?}",
                    (
                        source.qty_received.to_bits(),
                        source.qty_invoiced.to_bits(),
                        source.qty_to_invoice.to_bits(),
                        source.invoice_lines,
                        source.match_state,
                        source.metadata,
                        source.write_uid,
                        source.write_date,
                        po.invoice_ids,
                        po.invoice_count,
                        po.invoice_status,
                        po.picking_ids,
                    )
                ),
                moves,
                pickings,
                bills,
                bill_lines,
            ))
        };
        let before_invalid = snapshot()?;
        for qty in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 0.0, -1.0] {
            if receive_po_line(ctx, org_id, line.id, qty, None).is_ok() {
                return Err(format!("Invalid receipt quantity {qty} accepted"));
            }
            if snapshot()? != before_invalid {
                return Err("Rejected invalid receipt changed persisted state".to_string());
            }
            if invoice_po_line(ctx, org_id, line.id, qty).is_ok() {
                return Err(format!("Invalid invoice quantity {qty} accepted"));
            }
            if snapshot()? != before_invalid {
                return Err("Rejected invalid invoice changed persisted state".to_string());
            }
        }

        // Rejection occurs before writes; check canonical state rather than only error text.
        if receive_po_line(ctx, org_id, line.id, 7.0, None).is_ok() {
            return Err("Over-receipt unexpectedly accepted".to_string());
        }
        let after_rejection = ctx
            .db
            .purchase_order()
            .id()
            .find(&order.id)
            .ok_or("PO missing after rejection")?;
        let rejected_line = ctx
            .db
            .purchase_order_line()
            .id()
            .find(&line.id)
            .ok_or("PO line missing after rejection")?;
        if after_rejection.invoice_status != PoInvoiceStatus::Invoiced
            || after_rejection.invoice_ids != billed.invoice_ids
            || after_rejection.invoice_count != 1
            || rejected_line.qty_received != 4.0
            || rejected_line.qty_invoiced != 4.0
        {
            return Err("Rejected receipt changed canonical invoice/quantity state".to_string());
        }
        if let Some(ref residual) = residual {
            let unchanged = ctx
                .db
                .stock_move()
                .id()
                .find(&residual.id)
                .ok_or("Residual move missing after rejection")?;
            if unchanged.quantity_done != residual.quantity_done
                || unchanged.state != residual.state
            {
                return Err("Rejected receipt changed residual stock move".to_string());
            }
        }

        receive_po_line(ctx, org_id, line.id, 6.0, None)?;
        let received_again = ctx
            .db
            .purchase_order()
            .id()
            .find(&order.id)
            .ok_or("PO missing after second receipt")?;
        if received_again.invoice_status != PoInvoiceStatus::Partial
            || received_again.invoice_ids != billed.invoice_ids
            || received_again.invoice_count != 1
        {
            return Err(
                "Later receipt must reopen billable status without changing prior bill relation"
                    .to_string(),
            );
        }
        if let Some(residual) = residual {
            let completed = ctx
                .db
                .stock_move()
                .id()
                .find(&residual.id)
                .ok_or("Exact residual move missing after receipt")?;
            if !completed.is_done || completed.state != "done" || completed.quantity_done != 6.0 {
                return Err("Exact residual move was not completed for quantity 6".to_string());
            }
        }
        create_bill_from_purchase_order(ctx, org_id, order.id, bill_params)?;
        let final_po = ctx
            .db
            .purchase_order()
            .id()
            .find(&order.id)
            .ok_or("PO missing after second bill")?;
        let final_line = ctx
            .db
            .purchase_order_line()
            .id()
            .find(&line.id)
            .ok_or("PO line missing after second bill")?;
        if final_po.invoice_status != PoInvoiceStatus::Invoiced
            || final_po.invoice_count != 2
            || final_po.invoice_ids.len() != 2
            || final_po.invoice_ids[0] != bill_move_id
            || final_po.invoice_ids[1] == bill_move_id
            || final_line.qty_received != 10.0
            || final_line.qty_invoiced != 10.0
            || final_line.qty_to_invoice != 0.0
        {
            return Err(
                "Second bill did not converge quantities/status or preserve prior relation"
                    .to_string(),
            );
        }
        let second_lines: Vec<_> = ctx
            .db
            .account_move_line()
            .move_line_by_move()
            .filter(&final_po.invoice_ids[1])
            .filter(|l| l.product_id == Some(fixture.product_id))
            .collect();
        if second_lines.len() != 1 || second_lines[0].quantity != 6.0 {
            return Err("Second exact linked bill must contain quantity 6".to_string());
        }
        let first_lines_after: Vec<_> = ctx
            .db
            .account_move_line()
            .move_line_by_move()
            .filter(&bill_move_id)
            .filter(|l| l.product_id == Some(fixture.product_id))
            .collect();
        if first_lines_after.len() != 1
            || first_lines_after[0].id != first_product_lines[0].id
            || first_lines_after[0].quantity != 4.0
        {
            return Err("Second bill changed the prior bill line".to_string());
        }
    }

    let _invoice_date: Timestamp = bill.invoice_date.unwrap_or(ctx.timestamp);
    Ok(())
}
