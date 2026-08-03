//! Cross-dock — ship from inbound receipt location without putaway to stock.
use spacetimedb::{reducer, ReducerContext, SpacetimeType, Table};

use crate::core::organization::CompanyScopeParams;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::inventory_close::assert_inventory_writable;
use crate::inventory::product::product;
use crate::inventory::stock::{
    create_stock_move, create_stock_picking, stock_picking, stock_quant, CreateStockMoveParams,
    CreateStockPickingParams,
};
use crate::inventory::warehouse::warehouse;
use serde_json;

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct ExecuteCrossDockParams {
    /// Completed (or assigned with qty on dest) inbound picking.
    pub inbound_picking_id: u64,
    pub product_id: u64,
    /// Quantity in product stock UoM.
    pub quantity: f64,
    /// Ship-to partner / customer location id used as outbound dest.
    pub partner_id: u64,
    pub location_dest_id: Option<u64>,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Create an outbound picking from the inbound receipt location (skip putaway).
/// Requires a warehouse with `crossdock = true` covering the inbound dest.
#[reducer]
pub fn execute_cross_dock(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: ExecuteCrossDockParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_picking", "create")?;
    assert_inventory_writable(ctx, organization_id, company_id)?;
    if params.quantity <= 0.0 {
        return Err("quantity must be positive".to_string());
    }

    let inbound = ctx
        .db
        .stock_picking()
        .id()
        .find(&params.inbound_picking_id)
        .ok_or("Inbound picking not found")?;
    if inbound.organization_id != organization_id || inbound.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if inbound.state != "done" && inbound.state != "assigned" {
        return Err(format!(
            "Inbound picking must be assigned or done for cross-dock (state: {})",
            inbound.state
        ));
    }

    let source_loc = inbound.location_dest_id;
    let wh = ctx
        .db
        .warehouse()
        .iter()
        .find(|w| {
            w.organization_id == organization_id
                && w.company_id == company_id
                && w.crossdock
                && (w.lot_stock_id == source_loc
                    || w.wh_input_stock_loc_id == Some(source_loc)
                    || w.id == source_loc
                    || w.wh_output_stock_loc_id == Some(source_loc))
        })
        .ok_or(
            "No crossdock-enabled warehouse for inbound destination — set warehouse.crossdock",
        )?;

    // Must have company-owned on-hand at inbound dest (not consigned).
    let on_hand = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&params.product_id)
        .find(|q| {
            q.organization_id == organization_id
                && q.company_id == company_id
                && q.location_id == source_loc
                && q.owner_id.is_none()
                && q.quantity + 1e-9 >= params.quantity
        })
        .ok_or_else(|| {
            format!(
                "Insufficient on-hand at inbound location {} for product {}",
                source_loc, params.product_id
            )
        })?;
    let _ = on_hand;

    let product = ctx
        .db
        .product()
        .id()
        .find(&params.product_id)
        .ok_or("Product not found")?;
    let dest = params.location_dest_id.unwrap_or(params.partner_id);

    create_stock_picking(
        ctx,
        organization_id,
        CreateStockPickingParams {
            company_id: Some(company_id),
            name: format!("XD-{}", params.inbound_picking_id),
            picking_type_id: wh.out_type_id,
            location_id: source_loc,
            location_dest_id: dest,
            move_type: "direct".to_string(),
            priority: "1".to_string(),
            partner_id: Some(params.partner_id),
            contact_id: None,
            scheduled_date: Some(ctx.timestamp),
            origin: Some(format!("crossdock:{}", params.inbound_picking_id)),
            note: Some("Cross-dock outbound".to_string()),
            user_id: None,
            sale_id: None,
            purchase_id: inbound.purchase_id,
            group_id: None,
            is_locked: false,
            immediate_transfer: true,
            is_printed: false,
            is_return: false,
            has_scrap_move: false,
            has_tracking: false,
            date: Some(ctx.timestamp),
            date_done: None,
            backorder_id: None,
            backorder_ids: vec![],
            show_operations: false,
            show_lots_text: false,
            show_reserved: true,
            show_check_availability: true,
            show_validate: true,
            show_mark_as_todo: true,
            show_set_qty_button: false,
            show_clear_qty_button: false,
            show_lots_m2o: false,
            product_id: Some(params.product_id),
            lot_id: None,
            package_id: None,
            result_package_id: None,
            owner_id: None,
            display_lot_id: None,
            location_id_name: None,
            location_dest_id_name: None,
            picking_code: Some("outgoing".to_string()),
            product_tracking: None,
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
                    "crossdock": true,
                    "inbound_picking_id": params.inbound_picking_id,
                    "warehouse_id": wh.id,
                })
                .to_string(),
            ),
        },
    )?;

    let outbound_id = ctx
        .db
        .stock_picking()
        .iter()
        .find(|p| {
            p.organization_id == organization_id
                && p.name == format!("XD-{}", params.inbound_picking_id)
                && p.origin.as_deref() == Some(&format!("crossdock:{}", params.inbound_picking_id))
        })
        .map(|p| p.id)
        .ok_or("Cross-dock outbound picking missing after create")?;

    create_stock_move(
        ctx,
        organization_id,
        CreateStockMoveParams {
            company_id: Some(company_id),
            name: format!("Cross-dock {}", params.product_id),
            product_id: params.product_id,
            product_tmpl_id: params.product_id,
            product_uom: product.uom_id,
            product_uom_qty: params.quantity,
            location_id: source_loc,
            location_dest_id: dest,
            date_expected: ctx.timestamp,
            move_type: "outgoing".to_string(),
            priority: "1".to_string(),
            reference: None,
            sequence: 10,
            origin: Some(format!("crossdock:{}", params.inbound_picking_id)),
            note: None,
            date: None,
            date_deadline: None,
            picking_id: Some(outbound_id),
            picking_type_id: Some(wh.out_type_id),
            partner_id: Some(params.partner_id),
            product_variant_id: None,
            group_id: None,
            rule_id: None,
            procure_method: "make_to_stock".to_string(),
            price_unit: 0.0,
            scrapped: false,
            to_refund: false,
            propagate_cancel: true,
            delay_alert: false,
            product_packaging_id: None,
            product_packaging_qty: 0.0,
            warehouse_id: Some(wh.id),
            production_id: None,
            raw_material_production_id: None,
            unbuild_id: None,
            consume_unbuild_id: None,
            cost_share: 0.0,
            is_subcontract: false,
            purchase_line_id: None,
            need_release: false,
            release_ready: true,
            propagation_cancel: true,
            has_tracking: false,
            inventory_id: None,
            sale_line_id: None,
            lot_id: None,
            serial_id: None,
            package_id: None,
            result_package_id: None,
            owner_id: None,
            package_level_id: None,
            product_type: Some("product".to_string()),
            metadata: Some(r#"{"crossdock":true}"#.to_string()),
        },
    )?;

    let _scope = CompanyScopeParams {
        company_id: Some(company_id),
    };

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_picking",
            record_id: outbound_id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "crossdock": true,
                    "inbound_picking_id": params.inbound_picking_id,
                    "outbound_picking_id": outbound_id,
                    "quantity": params.quantity,
                    "source_location_id": source_loc,
                })
                .to_string(),
            ),
            changed_fields: vec!["crossdock".to_string()],
            metadata: params.metadata,
        },
    );

    Ok(())
}
