//! Exact source-owned bill-line provenance; no product-based effect discovery.
use std::collections::BTreeSet;

use spacetimedb::{ReducerContext, Table};

use crate::accounting::journal_entries::{
    account_move_line, create_bill_from_purchase_order, AddAccountMoveLineParams,
    CreateBillFromPurchaseOrderParams,
};
use crate::crm::contacts::{contact, Contact};
use crate::purchasing::purchase_orders::{
    add_purchase_order_line, confirm_purchase_order, create_purchase_order, purchase_order,
    purchase_order_line, receive_po_line, AddPurchaseOrderLineParams, CreatePurchaseOrderParams,
    PurchaseOrderLine,
};
use crate::test_harness::{PurchasingIntegrityFixture, PurchasingIntegrityScope};

fn bill_line_params(account_id: u64) -> AddAccountMoveLineParams {
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

fn bill_params(
    ctx: &ReducerContext,
    scope: &PurchasingIntegrityScope,
) -> CreateBillFromPurchaseOrderParams {
    let mut payable_line = bill_line_params(scope.payable_account_id);
    payable_line.exclude_from_invoice_tab = true;
    CreateBillFromPurchaseOrderParams {
        journal_id: scope.journal_id,
        default_expense_account_id: scope.expense_account_id,
        invoice_date: ctx.timestamp,
        expense_line: bill_line_params(scope.expense_account_id),
        payable_line,
        metadata: None,
    }
}

fn source_line(ctx: &ReducerContext, id: u64) -> Result<PurchaseOrderLine, String> {
    ctx.db
        .purchase_order_line()
        .id()
        .find(&id)
        .ok_or_else(|| format!("source PO line {id} missing"))
}

fn assert_mapping(
    ctx: &ReducerContext,
    source: &PurchaseOrderLine,
    expected_quantities: &[f64],
    expense_account_id: u64,
) -> Result<BTreeSet<u64>, String> {
    let ids: BTreeSet<_> = source.invoice_lines.iter().copied().collect();
    if ids.len() != expected_quantities.len() || ids.len() != source.invoice_lines.len() {
        return Err("missing or duplicate source-owned invoice-line mapping".to_string());
    }
    for (&id, &quantity) in source.invoice_lines.iter().zip(expected_quantities) {
        let row = ctx
            .db
            .account_move_line()
            .id()
            .find(&id)
            .ok_or("mapped account move line missing")?;
        if row.organization_id != source.organization_id
            || row.company_id != source.company_id
            || row.product_id != Some(source.product_id)
            || row.account_id != expense_account_id
            || row.tax_line_id.is_some()
            || row.exclude_from_invoice_tab
            || (row.quantity - quantity).abs() > 1e-9
            || (row.price_unit - source.price_unit).abs() > 1e-9
            || (row.debit - quantity * source.price_unit).abs() > 1e-9
        {
            return Err(format!("exact mapped row {id} does not match its source"));
        }
        let order = ctx
            .db
            .purchase_order()
            .id()
            .find(&source.order_id)
            .ok_or("mapped source order missing")?;
        if !order.invoice_ids.contains(&row.move_id) {
            return Err("mapped row belongs to an unlinked bill".to_string());
        }
    }
    Ok(ids)
}

pub fn test_purchase_bill_exact_invoice_provenance(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = PurchasingIntegrityFixture::seed(ctx)?;
    let scope = &fixture.primary;
    create_purchase_order(
        ctx,
        scope.organization_id,
        CreatePurchaseOrderParams {
            company_id: Some(scope.company_id),
            partner_id: scope.vendor_id,
            currency_id: scope.currency_id,
            origin: None,
            partner_ref: None,
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
            metadata: None,
        },
    )?;
    // The fixture owns a fresh scope. Require exactly one row, never newest/name lookup.
    let orders: Vec<_> = ctx
        .db
        .purchase_order()
        .iter()
        .filter(|row| {
            row.organization_id == scope.organization_id && row.company_id == scope.company_id
        })
        .collect();
    if orders.len() != 1 {
        return Err("fixture scope must contain exactly one purchase order".to_string());
    }
    let order_id = orders[0].id;
    let mut source_ids = Vec::new();
    for (quantity, price_unit) in [(5.0, 37.0), (9.0, 83.0)] {
        let before: BTreeSet<_> = ctx
            .db
            .purchase_order_line()
            .purchase_order_line_by_order()
            .filter(&order_id)
            .map(|row| row.id)
            .collect();
        add_purchase_order_line(
            ctx,
            scope.organization_id,
            order_id,
            AddPurchaseOrderLineParams {
                product_id: scope.product_id,
                quantity,
                uom_id: scope.uom_id,
                price_unit,
                discount: 0.0,
                tax_ids: vec![],
                name: None,
                sequence: None,
                display_type: None,
                product_variant_id: None,
                account_analytic_id: None,
                date_planned: None,
                propagate_cancel: None,
                lot_id: None,
                metadata: None,
            },
        )?;
        let inserted: Vec<_> = ctx
            .db
            .purchase_order_line()
            .purchase_order_line_by_order()
            .filter(&order_id)
            .filter(|row| !before.contains(&row.id))
            .collect();
        if inserted.len() != 1 {
            return Err("add PO line must persist exactly one new source row".to_string());
        }
        source_ids.push(inserted[0].id);
    }
    confirm_purchase_order(ctx, scope.organization_id, order_id)?;
    for (&id, qty) in source_ids.iter().zip([2.0, 3.0]) {
        receive_po_line(ctx, scope.organization_id, id, qty, None)?;
    }
    let mut foreign_templates = bill_params(ctx, scope);
    foreign_templates.expense_line.partner_id = Some(fixture.foreign.vendor_id);
    foreign_templates.payable_line.partner_id = Some(fixture.foreign.vendor_id);
    create_bill_from_purchase_order(ctx, scope.organization_id, order_id, foreign_templates)?;
    let first = source_line(ctx, source_ids[0])?;
    let second = source_line(ctx, source_ids[1])?;
    let first_ids = assert_mapping(ctx, &first, &[2.0], scope.expense_account_id)?;
    let second_ids = assert_mapping(ctx, &second, &[3.0], scope.expense_account_id)?;
    if !first_ids.is_disjoint(&second_ids) {
        return Err("same-product source lines share invoice mappings".to_string());
    }
    // An unreceived retry fails before writes. This is not late-failure rollback proof.
    if create_bill_from_purchase_order(
        ctx,
        scope.organization_id,
        order_id,
        bill_params(ctx, scope),
    )
    .is_ok()
    {
        return Err("bill without newly received quantities unexpectedly succeeded".to_string());
    }
    for source in [&first, &second] {
        let after = source_line(ctx, source.id)?;
        if after.invoice_lines != source.invoice_lines || after.qty_invoiced != source.qty_invoiced
        {
            return Err("rejected bill changed source provenance or invoiced quantity".to_string());
        }
    }
    for (&id, qty) in source_ids.iter().zip([3.0, 6.0]) {
        receive_po_line(ctx, scope.organization_id, id, qty, None)?;
    }
    let supplier = ctx
        .db
        .contact()
        .id()
        .find(&scope.vendor_id)
        .ok_or("supplier missing")?;
    let other_supplier = ctx.db.contact().insert(Contact { id: 0, ..supplier });
    let mut other_templates = bill_params(ctx, scope);
    other_templates.expense_line.partner_id = Some(other_supplier.id);
    other_templates.payable_line.partner_id = Some(other_supplier.id);
    create_bill_from_purchase_order(ctx, scope.organization_id, order_id, other_templates)?;
    let first_after = source_line(ctx, first.id)?;
    let second_after = source_line(ctx, second.id)?;
    if !first_after.invoice_lines.starts_with(&first.invoice_lines)
        || !second_after
            .invoice_lines
            .starts_with(&second.invoice_lines)
    {
        return Err("subsequent bill replaced prior provenance".to_string());
    }
    let first_ids = assert_mapping(ctx, &first_after, &[2.0, 3.0], scope.expense_account_id)?;
    let second_ids = assert_mapping(ctx, &second_after, &[3.0, 6.0], scope.expense_account_id)?;
    if !first_ids.is_disjoint(&second_ids)
        || first_after.qty_invoiced != 5.0
        || second_after.qty_invoiced != 9.0
    {
        return Err("subsequent bill cross-mapped sources or lost invoiced quantity".to_string());
    }
    let mapped: BTreeSet<_> = first_ids.union(&second_ids).copied().collect();
    let order = ctx
        .db
        .purchase_order()
        .id()
        .find(&order_id)
        .ok_or("billed order missing")?;
    if order.invoice_ids.len() != 2 {
        return Err("expected exactly two linked bills".to_string());
    }
    for bill_id in order.invoice_ids {
        let rows: Vec<_> = ctx
            .db
            .account_move_line()
            .move_line_by_move()
            .filter(&bill_id)
            .collect();
        if rows.len() != 3 {
            return Err("expected two product rows and one payable row per bill".to_string());
        }
        for row in rows {
            if row.partner_id != Some(scope.vendor_id) {
                return Err("caller template partner persisted instead of PO supplier".to_string());
            }
            let is_source_product = row.account_id == scope.expense_account_id
                && row.product_id == Some(scope.product_id)
                && row.tax_line_id.is_none()
                && !row.exclude_from_invoice_tab;
            if mapped.contains(&row.id) != is_source_product {
                return Err(
                    "payable/tax/nonproduct row spuriously mapped or product row unmapped"
                        .to_string(),
                );
            }
        }
    }
    Ok(())
}
