/// Sales CSV Imports — SaleOrder, SaleOrderLine
use spacetimedb::{ReducerContext, Table};

use crate::data_ops::helpers::*;
use crate::data_ops::import_tracker::{begin_import_job, finish_import_job, record_import_error};
use crate::helpers::check_permission;
use crate::sales::sales_core::{sale_order, sale_order_line, SaleOrder, SaleOrderLine};
use crate::types::{InvoiceStatus, LineInvoiceStatus, LineState, SaleState};

// ── SaleOrder ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_sale_order_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "sale_order", None, rows.len() as u32);
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

        let date_order = opt_timestamp(col(&headers, row, "date_order")).unwrap_or(ctx.timestamp);
        let currency_id = parse_u64(col(&headers, row, "currency_id"));

        ctx.db.sale_order().insert(SaleOrder {
            id: 0,
            organization_id,
            company_id,
            origin: opt_str(col(&headers, row, "origin")),
            client_order_ref: opt_str(col(&headers, row, "client_order_ref")),
            reference: opt_str(col(&headers, row, "name")),
            state: SaleState::Draft,
            date_order,
            validity_date: opt_timestamp(col(&headers, row, "validity_date")),
            is_expired: false,
            confirmation_date: None,
            order_line: vec![],
            partner_id,
            partner_invoice_id: partner_id,
            partner_shipping_id: partner_id,
            pricelist_id: parse_u64(col(&headers, row, "pricelist_id")),
            currency_id,
            payment_term_id: opt_u64(col(&headers, row, "payment_term_id")),
            fiscal_position_id: None,
            user_id: ctx.sender(),
            team_id: None,
            origin_so_id: None,
            opportunity_id: None,
            campaign_id: None,
            medium_id: None,
            source_id: None,
            signed_by: None,
            signed_on: None,
            signature: None,
            commitment_date: None,
            expected_date: None,
            amount_untaxed: 0.0,
            amount_by_group: None,
            amount_tax: 0.0,
            amount_total: 0.0,
            amount_paid: 0.0,
            amount_residual: 0.0,
            amount_to_invoice: 0.0,
            margin: 0.0,
            note: opt_str(col(&headers, row, "note")),
            terms_and_conditions: None,
            invoice_count: 0,
            invoice_ids: vec![],
            invoice_status: InvoiceStatus::NoInvoice,
            picking_ids: vec![],
            delivery_count: 0,
            procurement_group_id: None,
            production_count: 0,
            mrp_production_ids: vec![],
            is_printed: false,
            is_locked: false,
            show_update_pricelist: false,
            show_update_fpos: false,
            last_website_so_id: None,
            analytic_account_id: None,
            invoice_num: 0,
            shipping_policy: "direct".to_string(),
            picking_policy: "direct".to_string(),
            warehouse_id: parse_u64(col(&headers, row, "warehouse_id")),
            incoterm: None,
            incoterm_location: None,
            carrier_id: None,
            weight: 0.0,
            shipping_weight: 0.0,
            volume: 0.0,
            weight_uom_name: None,
            customer_lead: 0.0,
            prepaid_amount: 0.0,
            credit_amount: 0.0,
            is_dropship: false,
            dropship_picking_count: 0,
            dropship_picking_ids: vec![],
            purchase_order_count: 0,
            purchase_order_ids: vec![],
            activities_count: 0,
            message_needaction: false,
            message_needaction_counter: 0,
            message_is_follower: false,
            message_follower_ids: vec![],
            message_partner_ids: vec![],
            message_channel_ids: vec![],
            message_ids: vec![],
            website_message_ids: vec![],
            has_message: false,
            activity_ids: vec![],
            activity_state: None,
            activity_date_deadline: None,
            activity_summary: None,
            activity_type_id: None,
            activity_user_id: None,
            rating_ids: vec![],
            rating_last_value: 0.0,
            rating_last_feedback: None,
            rating_last_image: None,
            access_warning: None,
            access_url: None,
            access_token: None,
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
        "Import sale_order: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── SaleOrderLine ─────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_sale_order_line_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order_line", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "sale_order_line",
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
        let qty = parse_f64(col(&headers, row, "product_uom_qty"));
        let discount = parse_f64(col(&headers, row, "discount"));
        let uom_id = parse_u64(col(&headers, row, "product_uom_id"));
        let currency_id = parse_u64(col(&headers, row, "currency_id"));

        // Get partner from order if available
        let order_partner_id = ctx
            .db
            .sale_order()
            .id()
            .find(&order_id)
            .map(|o| o.partner_id)
            .unwrap_or(0);

        ctx.db.sale_order_line().insert(SaleOrderLine {
            id: 0,
            order_id,
            name: col(&headers, row, "name").to_string(),
            sequence: parse_u32(col(&headers, row, "sequence")),
            invoice_status: LineInvoiceStatus::No,
            price_unit,
            price_subtotal: price_unit * qty * (1.0 - discount / 100.0),
            price_tax: 0.0,
            price_total: price_unit * qty * (1.0 - discount / 100.0),
            price_reduce: price_unit * (1.0 - discount / 100.0),
            price_reduce_taxinc: price_unit * (1.0 - discount / 100.0),
            price_reduce_taxexcl: price_unit * (1.0 - discount / 100.0),
            discount,
            product_id,
            product_variant_id: None,
            product_template_id: None,
            product_uom_qty: qty,
            product_uom: uom_id,
            product_packaging_id: None,
            product_packaging_qty: 0.0,
            qty_delivered_manual: 0.0,
            qty_delivered_method: "manual".to_string(),
            qty_delivered: 0.0,
            qty_invoiced: 0.0,
            qty_to_invoice: 0.0,
            qty_at_date: qty,
            virtual_available_at_date: 0.0,
            free_qty_today: 0.0,
            scheduled_date: None,
            is_downpayment: false,
            is_expense: false,
            currency_id,
            company_id,
            order_partner_id,
            salesman_id: ctx.sender(),
            tax_id: vec_u64(col(&headers, row, "tax_ids")),
            analytic_tag_ids: vec![],
            analytic_line_ids: vec![],
            is_service: false,
            is_delivered: false,
            display_type: None,
            product_updatable: true,
            product_type: None,
            product_no_variant_attribute_value_ids: vec![],
            product_custom_attribute_value_ids: vec![],
            margin: 0.0,
            margin_percent: 0.0,
            purchase_price: 0.0,
            cost_method: None,
            bom_id: None,
            route_id: None,
            move_ids: vec![],
            move_status: None,
            customer_lead: 0.0,
            state: LineState::Draft,
            product_remains: 0.0,
            product_packaging_qty_delivered: 0.0,
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
        "Import sale_order_line: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}
