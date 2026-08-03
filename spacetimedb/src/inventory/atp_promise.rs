//! Multi-warehouse promise ATP — calendar / lead-time helpers + promise refresh.
//!
//! Working calendar MVP: Monday–Friday only (no holiday table).
use spacetimedb::{reducer, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::product::{product, product_supplier_info};
use crate::inventory::stock::{
    product_requires_stock, resolve_warehouse_stock_location, stock_picking, stock_quant,
    to_product_stock_qty,
};
use crate::inventory::warehouse::warehouse;
use crate::sales::sales_core::{sale_order, sale_order_line, SaleOrder, SaleOrderLine};
use serde_json;

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Order warehouse first, then `resupply_wh_ids` (deduped).
pub(crate) fn warehouse_network(ctx: &ReducerContext, order_warehouse_id: u64) -> Vec<u64> {
    let mut out = vec![order_warehouse_id];
    if let Some(wh) = ctx.db.warehouse().id().find(&order_warehouse_id) {
        for id in wh.resupply_wh_ids {
            if id > 0 && !out.contains(&id) {
                out.push(id);
            }
        }
    }
    out
}

/// Company-owned available qty at a warehouse stock location (sum of quants).
pub(crate) fn available_qty_at_warehouse(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    warehouse_id: u64,
) -> f64 {
    let location_id = resolve_warehouse_stock_location(ctx, warehouse_id);
    ctx.db
        .stock_quant()
        .quant_by_product()
        .filter(&product_id)
        .filter(|q| {
            q.organization_id == organization_id
                && q.company_id == company_id
                && q.location_id == location_id
                && q.owner_id.is_none()
        })
        .map(|q| q.available_quantity.max(0.0))
        .sum()
}

/// Lead days: max(customer_lead, min supplier delay for product).
pub(crate) fn lead_days_for_line(
    ctx: &ReducerContext,
    organization_id: u64,
    product_id: u64,
    _route_id: Option<u64>,
    customer_lead: f64,
) -> i32 {
    let mut days = customer_lead.ceil().max(0.0) as i32;

    let mut min_supplier: Option<i32> = None;
    for info in ctx
        .db
        .product_supplier_info()
        .iter()
        .filter(|s| s.organization_id == organization_id && s.product_id == Some(product_id))
    {
        min_supplier = Some(match min_supplier {
            Some(m) => m.min(info.delay),
            None => info.delay,
        });
    }
    if let Some(d) = min_supplier {
        days = days.max(d.max(0));
    }
    days
}

/// Add `days` working days (Mon–Fri) to a timestamp.
pub(crate) fn add_working_days(from: Timestamp, days: i32) -> Timestamp {
    if days <= 0 {
        return from;
    }
    let start = from
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_secs();
    let mut secs = start;
    let mut remaining = days;
    while remaining > 0 {
        secs = secs.saturating_add(86400);
        // Unix day 0 = Thursday 1970-01-01. weekday: 0=Thu ... use (days_since_epoch+4)%7 == 0 Sun
        let day = (secs / 86400 + 4) % 7; // 0=Sun .. 6=Sat
        if day != 0 && day != 6 {
            remaining -= 1;
        }
    }
    // Reconstruct Timestamp from micros
    Timestamp::from_micros_since_unix_epoch((secs as i64).saturating_mul(1_000_000))
}

/// Transfer lead days when fulfillment WH differs from order WH.
pub(crate) fn inter_wh_transfer_days() -> i32 {
    1
}

pub(crate) struct LinePromise {
    pub free_qty_today: f64,
    pub promise_date: Timestamp,
    pub virtual_available_at_date: f64,
    /// Fulfillment warehouse chosen for this line (for callers / future UI).
    #[allow(dead_code)]
    pub source_warehouse_id: u64,
}

pub(crate) fn compute_line_promise(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    order_warehouse_id: u64,
    product_id: u64,
    stock_qty: f64,
    route_id: Option<u64>,
    customer_lead: f64,
) -> LinePromise {
    let network = warehouse_network(ctx, order_warehouse_id);
    let mut free_today = 0.0;
    let mut source_wh = order_warehouse_id;
    for wh_id in &network {
        let avail =
            available_qty_at_warehouse(ctx, organization_id, company_id, product_id, *wh_id);
        if avail + 1e-9 >= stock_qty {
            free_today = avail;
            source_wh = *wh_id;
            break;
        }
        if avail > free_today {
            free_today = avail;
            source_wh = *wh_id;
        }
    }

    let mut lead = lead_days_for_line(ctx, organization_id, product_id, route_id, customer_lead);
    if source_wh != order_warehouse_id {
        lead = lead.max(inter_wh_transfer_days());
    }
    // Immediate if full qty available at source today and source is primary with 0 lead.
    let promise = if free_today + 1e-9 >= stock_qty && source_wh == order_warehouse_id && lead == 0
    {
        ctx.timestamp
    } else if free_today + 1e-9 >= stock_qty {
        add_working_days(
            ctx.timestamp,
            lead.max(if source_wh != order_warehouse_id {
                inter_wh_transfer_days()
            } else {
                0
            }),
        )
    } else {
        // Short: promise after lead (inbound-aware deferred)
        add_working_days(ctx.timestamp, lead.max(1))
    };

    LinePromise {
        free_qty_today: free_today,
        source_warehouse_id: source_wh,
        promise_date: promise,
        virtual_available_at_date: free_today.max(stock_qty),
    }
}

/// Create an unreserved draft INT picking (ops demand) from fulfillment → primary.
pub(crate) fn create_network_transfer_demand(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    qty: f64,
    from_warehouse_id: u64,
    to_warehouse_id: u64,
    sale_order_id: u64,
) -> Result<u64, String> {
    use crate::inventory::stock::{
        create_stock_move, create_stock_picking, CreateStockMoveParams, CreateStockPickingParams,
    };

    let product = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or("Product not found for ATP transfer demand")?;
    let from_loc = resolve_warehouse_stock_location(ctx, from_warehouse_id);
    let to_loc = resolve_warehouse_stock_location(ctx, to_warehouse_id);
    let name = format!("INT-ATP-{sale_order_id}-{from_warehouse_id}");

    create_stock_picking(
        ctx,
        organization_id,
        CreateStockPickingParams {
            company_id: Some(company_id),
            name: name.clone(),
            picking_type_id: 0,
            location_id: from_loc,
            location_dest_id: to_loc,
            move_type: "direct".to_string(),
            priority: "1".to_string(),
            partner_id: None,
            contact_id: None,
            scheduled_date: Some(ctx.timestamp),
            origin: Some(format!("SO-ATP-{sale_order_id}")),
            note: Some("Multi-WH promise ATP transfer demand".to_string()),
            user_id: None,
            // Leave sale_id unset so SO confirm idempotency (outgoing pickings) is not confused.
            sale_id: None,
            purchase_id: None,
            group_id: None,
            is_locked: false,
            immediate_transfer: false,
            is_printed: false,
            is_return: false,
            has_scrap_move: false,
            has_tracking: product.tracking != "none",
            date: None,
            date_done: None,
            backorder_id: None,
            backorder_ids: vec![],
            show_operations: true,
            show_lots_text: false,
            show_reserved: true,
            show_check_availability: true,
            show_validate: true,
            show_mark_as_todo: true,
            show_set_qty_button: false,
            show_clear_qty_button: false,
            show_lots_m2o: false,
            product_id: Some(product_id),
            lot_id: None,
            package_id: None,
            result_package_id: None,
            owner_id: None,
            display_lot_id: None,
            location_id_name: None,
            location_dest_id_name: None,
            picking_code: Some("internal".to_string()),
            product_tracking: Some(product.tracking.clone()),
            product_barcode: None,
            move_line_exist: false,
            has_packages: false,
            has_move_lines: true,
            has_package: false,
            has_lot: false,
            has_owner: false,
            has_entire_package_src: false,
            has_entire_package_dest: false,
            package_level_ids: vec![],
            batch_id: None,
            metadata: Some(
                serde_json::json!({
                    "atp_transfer": true,
                    "from_warehouse_id": from_warehouse_id,
                    "to_warehouse_id": to_warehouse_id,
                })
                .to_string(),
            ),
        },
    )?;

    let picking = ctx
        .db
        .stock_picking()
        .iter()
        .filter(|p| p.organization_id == organization_id && p.name == name)
        .max_by_key(|p| p.id)
        .ok_or("ATP transfer picking not found after create")?;

    create_stock_move(
        ctx,
        organization_id,
        CreateStockMoveParams {
            company_id: Some(company_id),
            name: format!("ATP transfer {}", product.name),
            product_id,
            product_tmpl_id: product_id,
            product_uom: product.uom_id,
            product_uom_qty: qty,
            location_id: from_loc,
            location_dest_id: to_loc,
            date_expected: ctx.timestamp,
            move_type: "internal".to_string(),
            priority: "1".to_string(),
            reference: Some(format!("SO-ATP-{sale_order_id}")),
            sequence: 10,
            origin: Some(format!("SO-ATP-{sale_order_id}")),
            note: None,
            date: None,
            date_deadline: None,
            picking_id: Some(picking.id),
            picking_type_id: None,
            partner_id: None,
            product_variant_id: None,
            group_id: None,
            rule_id: None,
            procure_method: "make_to_stock".to_string(),
            price_unit: product.standard_price,
            scrapped: false,
            to_refund: false,
            propagate_cancel: true,
            delay_alert: false,
            product_packaging_id: None,
            product_packaging_qty: 0.0,
            warehouse_id: Some(from_warehouse_id),
            production_id: None,
            raw_material_production_id: None,
            unbuild_id: None,
            consume_unbuild_id: None,
            cost_share: 0.0,
            is_subcontract: false,
            purchase_line_id: None,
            need_release: false,
            release_ready: false,
            propagation_cancel: true,
            has_tracking: product.tracking != "none",
            inventory_id: None,
            sale_line_id: None,
            lot_id: None,
            serial_id: None,
            package_id: None,
            result_package_id: None,
            owner_id: None,
            package_level_id: None,
            product_type: Some(product.type_.clone()),
            metadata: Some(
                serde_json::json!({ "atp_transfer": true, "sale_order_id": sale_order_id })
                    .to_string(),
            ),
        },
    )?;

    Ok(picking.id)
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn refresh_sale_order_promise_dates(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    order_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "sale_order", "write")?;
    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("Sale order not found")?;
    if order.organization_id != organization_id || order.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    let mut max_promise: Option<Timestamp> = None;
    let lines: Vec<_> = ctx
        .db
        .sale_order_line()
        .order_line_by_order()
        .filter(&order_id)
        .filter(|l| l.display_type.is_none() && l.product_uom_qty > 0.0)
        .collect();

    for line in lines {
        if !product_requires_stock(ctx, line.product_id) {
            continue;
        }
        let stock_qty = to_product_stock_qty(
            ctx,
            organization_id,
            line.product_id,
            line.product_uom,
            line.product_uom_qty,
        )?;
        let promise = compute_line_promise(
            ctx,
            organization_id,
            company_id,
            order.warehouse_id,
            line.product_id,
            stock_qty,
            line.route_id,
            line.customer_lead.max(order.customer_lead),
        );
        max_promise = Some(match max_promise {
            Some(m)
                if m.to_micros_since_unix_epoch()
                    >= promise.promise_date.to_micros_since_unix_epoch() =>
            {
                m
            }
            _ => promise.promise_date,
        });
        ctx.db.sale_order_line().id().update(SaleOrderLine {
            free_qty_today: promise.free_qty_today,
            virtual_available_at_date: promise.virtual_available_at_date,
            scheduled_date: Some(promise.promise_date),
            qty_at_date: promise.free_qty_today.min(stock_qty),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..line
        });
    }

    let commitment = order.commitment_date.or(max_promise);
    ctx.db.sale_order().id().update(SaleOrder {
        commitment_date: commitment,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "sale_order",
            record_id: order_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "commitment_date": commitment.map(|t| t.to_micros_since_unix_epoch()),
                    "promise_refreshed": true,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "commitment_date".to_string(),
                "scheduled_date".to_string(),
                "free_qty_today".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}
