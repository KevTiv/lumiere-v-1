/// Purchasing CSV Imports — PurchaseOrder, PurchaseOrderLine, ProductSupplierInfo
use spacetimedb::{ReducerContext, Table};

use crate::data_ops::helpers::*;
use crate::data_ops::import_tracker::{begin_import_job, finish_import_job, record_import_error};
use crate::helpers::check_permission;
use crate::inventory::product::{product_supplier_info, ProductSupplierInfo};
use crate::purchasing::purchase_orders::{
    purchase_order, purchase_order_line, PurchaseOrder, PurchaseOrderLine,
};
use crate::types::{LineState, PoInvoiceStatus, PoState};

// ── PurchaseOrder ─────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_purchase_order_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "purchase_order",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let partner_id = parse_u64(col(&headers, row, "partner_id"));

        if partner_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("partner_id"),
                None,
                "partner_id is required",
            );
            errors += 1;
            continue;
        }

        let currency_id = parse_u64(col(&headers, row, "currency_id"));
        if currency_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("currency_id"),
                None,
                "currency_id is required",
            );
            errors += 1;
            continue;
        }

        let date_order = opt_timestamp(col(&headers, row, "date_order")).unwrap_or(ctx.timestamp);

        ctx.db.purchase_order().insert(PurchaseOrder {
            id: 0,
            organization_id,
            name: opt_str(col(&headers, row, "name")),
            origin: opt_str(col(&headers, row, "origin")),
            partner_ref: opt_str(col(&headers, row, "partner_ref")),
            state: PoState::Draft,
            date_order,
            date_approve: None,
            partner_id,
            dest_address_id: None,
            currency_id,
            payment_term_id: opt_u64(col(&headers, row, "payment_term_id")),
            fiscal_position_id: None,
            date_planned: opt_timestamp(col(&headers, row, "date_planned")),
            date_calendar_start: None,
            date_calendar_done: None,
            company_id,
            user_id: ctx.sender(),
            invoice_count: 0,
            invoice_ids: vec![],
            invoice_status: PoInvoiceStatus::No,
            picking_count: 0,
            picking_ids: vec![],
            effective_date: None,
            amount_untaxed: 0.0,
            amount_tax: 0.0,
            amount_total: 0.0,
            receipt_status: "nothing".to_string(),
            notes: opt_str(col(&headers, row, "notes")),
            message_main_attachment_id: None,
            message_follower_ids: vec![],
            message_ids: vec![],
            has_message: false,
            activity_ids: vec![],
            activity_state: None,
            activity_date_deadline: None,
            activity_type_id: None,
            activity_user_id: None,
            activity_summary: None,
            access_url: None,
            access_token: None,
            access_warning: None,
            is_locked: false,
            is_quantity_copy: "none".to_string(),
            incoterm_id: None,
            incoterm_location: None,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import purchase_order: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── PurchaseOrderLine ─────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_purchase_order_line_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order_line", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "purchase_order_line",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let order_id = parse_u64(col(&headers, row, "order_id"));
        let product_id = parse_u64(col(&headers, row, "product_id"));

        if order_id == 0 || product_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("order_id"),
                None,
                "order_id and product_id are required",
            );
            errors += 1;
            continue;
        }

        let price_unit = parse_f64(col(&headers, row, "price_unit"));
        let qty = parse_f64(col(&headers, row, "product_qty"));
        let uom_id = parse_u64(col(&headers, row, "product_uom"));
        let currency_id = parse_u64(col(&headers, row, "currency_id"));

        let partner_id = ctx
            .db
            .purchase_order()
            .id()
            .find(&order_id)
            .map(|o| o.partner_id)
            .unwrap_or(0);

        let subtotal = price_unit * qty;

        ctx.db.purchase_order_line().insert(PurchaseOrderLine {
            id: 0,
            organization_id,
            sequence: parse_u32(col(&headers, row, "sequence")),
            product_qty: qty,
            product_uom_qty: qty,
            date_planned: opt_timestamp(col(&headers, row, "date_planned")),
            date_departure: None,
            date_arrival: None,
            product_uom: uom_id,
            product_id,
            product_type: None,
            product_variant_id: opt_u64(col(&headers, row, "product_variant_id")),
            product_template_id: None,
            price_unit,
            price_subtotal: subtotal,
            price_total: subtotal,
            price_tax: 0.0,
            order_id,
            account_analytic_id: opt_u64(col(&headers, row, "account_analytic_id")),
            analytic_tag_ids: vec![],
            company_id,
            state: LineState::Draft,
            invoice_lines: vec![],
            qty_invoiced: 0.0,
            qty_received_method: vec![],
            qty_received: 0.0,
            qty_received_manual: 0.0,
            qty_to_invoice: 0.0,
            partner_id,
            currency_id,
            display_type: None,
            product_no_variant_attribute_value_ids: vec![],
            product_custom_attribute_value_ids: vec![],
            propagate_cancel: true,
            sale_line_id: None,
            sale_order_id: None,
            move_dest_ids: vec![],
            move_ids: vec![],
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import purchase_order_line: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── ProductSupplierInfo ───────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_supplier_info_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "product_supplier_info", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "product_supplier_info",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let partner_id = parse_u64(col(&headers, row, "partner_id"));

        if partner_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("partner_id"),
                None,
                "partner_id is required",
            );
            errors += 1;
            continue;
        }

        let currency_id = parse_u64(col(&headers, row, "currency_id"));
        if currency_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("currency_id"),
                None,
                "currency_id is required",
            );
            errors += 1;
            continue;
        }

        ctx.db.product_supplier_info().insert(ProductSupplierInfo {
            id: 0,
            organization_id,
            product_tmpl_id: opt_u64(col(&headers, row, "product_tmpl_id")),
            product_id: opt_u64(col(&headers, row, "product_id")),
            partner_id,
            product_name: opt_str(col(&headers, row, "product_name")),
            product_code: opt_str(col(&headers, row, "product_code")),
            sequence: parse_u32(col(&headers, row, "sequence")) as i32,
            min_qty: parse_f64(col(&headers, row, "min_qty")),
            price: parse_f64(col(&headers, row, "price")),
            currency_id,
            company_id: opt_u64(col(&headers, row, "company_id")),
            date_start: opt_timestamp(col(&headers, row, "date_start")),
            date_end: opt_timestamp(col(&headers, row, "date_end")),
            delay: parse_i32(col(&headers, row, "delay")),
            is_active: true,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import supplier_info: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}
