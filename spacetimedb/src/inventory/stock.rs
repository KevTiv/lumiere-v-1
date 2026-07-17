/// Stock Management — Tables and Reducers
///
/// Tables:
///   - StockQuant
///   - StockMove
///   - StockMoveLine
///   - StockPicking
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::{company_id_from_scope, CompanyScopeParams};
use crate::core::reference::convert_uom_quantity;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::inventory_close::assert_inventory_writable;
use crate::inventory::product::product;
use crate::inventory::tracking::{
    stock_production_lot, stock_production_serial, StockProductionSerial,
};
use crate::inventory::warehouse::{stock_location, warehouse};
use crate::inventory::warehouse_operations::warehouse_task;
use crate::purchasing::purchase_orders::{purchase_order, purchase_order_line};
use crate::sales::return_orders::return_order;
use crate::sales::sales_core::{sale_order, sale_order_line};
use crate::types::{InvoiceStatus, LineInvoiceStatus, ProcureMethod};
use serde_json;

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.11: STOCK QUANT
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Clone)]
#[spacetimedb::table(
    accessor = stock_quant,
    public,
    index(accessor = quant_by_org, btree(columns = [organization_id])),
    index(accessor = quant_by_product, btree(columns = [product_id])),
    index(accessor = quant_by_location, btree(columns = [location_id])),
    index(accessor = quant_by_lot, btree(columns = [lot_id]))
)]
pub struct StockQuant {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub product_id: u64,
    pub product_variant_id: Option<u64>,
    pub location_id: u64,
    pub lot_id: Option<u64>,
    pub package_id: Option<u64>,
    pub owner_id: Option<u64>,
    pub company_id: u64,
    pub quantity: f64,
    pub reserved_quantity: f64,
    pub available_quantity: f64,
    pub in_date: Option<Timestamp>,
    pub inventory_quantity: f64,
    pub inventory_diff_quantity: f64,
    pub inventory_quantity_set: bool,
    pub is_outdated: bool,
    pub user_id: Option<Identity>,
    pub inventory_date: Option<Timestamp>,
    pub cost: f64,
    pub value: f64,
    pub cost_method: Option<String>,
    pub accounting_date: Option<Timestamp>,
    pub currency_id: Option<u64>,
    pub accounting_entry_ids: Vec<u64>,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.12: STOCK MOVE
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Clone)]
#[spacetimedb::table(
    accessor = stock_move,
    public,
    index(accessor = move_by_org, btree(columns = [organization_id])),
    index(accessor = move_by_product, btree(columns = [product_id])),
    // picking_key = picking_id.unwrap_or(0); Option columns are not FilterableValue in STDB 2.0.1.
    index(accessor = move_by_picking, btree(columns = [picking_key])),
    index(accessor = move_by_state, btree(columns = [state])),
    index(accessor = move_by_date, btree(columns = [date_expected]))
)]
pub struct StockMove {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: Option<String>,
    pub reference: Option<String>,
    pub sequence: i32,
    pub origin: Option<String>,
    pub note: Option<String>,
    pub move_type: String,
    pub state: String,
    pub priority: String,
    pub date: Option<Timestamp>,
    pub date_expected: Timestamp,
    pub date_deadline: Option<Timestamp>,
    pub product_id: u64,
    pub product_variant_id: Option<u64>,
    pub product_uom_qty: f64,
    pub product_uom: u64,
    pub product_qty: f64,
    pub product_tmpl_id: u64,
    pub location_id: u64,
    pub location_dest_id: u64,
    pub partner_id: Option<u64>,
    pub company_id: u64,
    pub picking_id: Option<u64>,
    // Denormalized picking_id.unwrap_or(0) for indexed lookups.
    pub picking_key: u64,
    pub picking_type_id: Option<u64>,
    pub origin_returned_move_id: Option<u64>,
    pub procure_method: String,
    pub created_purchase_line_id: Option<u64>,
    pub price_unit: f64,
    pub scrapped: bool,
    pub group_id: Option<u64>,
    pub rule_id: Option<u64>,
    pub propagate_cancel: bool,
    pub delay_alert: bool,
    pub picking_type_code: Option<String>,
    pub is_initial_demand_editable: bool,
    pub is_locked: bool,
    pub is_done: bool,
    pub product_packaging_id: Option<u64>,
    pub product_packaging_qty: f64,
    pub to_refund: bool,
    pub warehouse_id: Option<u64>,
    pub production_id: Option<u64>,
    pub raw_material_production_id: Option<u64>,
    pub unbuild_id: Option<u64>,
    pub consume_unbuild_id: Option<u64>,
    pub cost_share: f64,
    pub is_subcontract: bool,
    pub purchase_line_id: Option<u64>,
    pub created_production_id: Option<u64>,
    pub need_release: bool,
    pub release_ready: bool,
    pub propagation_cancel: bool,
    pub move_dest_ids: Vec<u64>,
    pub move_orig_ids: Vec<u64>,
    pub returned_move_ids: Vec<u64>,
    pub account_move_ids: Vec<u64>,
    pub valuation_line_ids: Vec<u64>,
    pub has_tracking: bool,
    pub quantity_done: f64,
    pub product_uom_qty_done: f64,
    pub inventory_id: Option<u64>,
    pub sale_line_id: Option<u64>,
    pub lot_id: Option<u64>,
    pub serial_id: Option<u64>,
    pub package_id: Option<u64>,
    pub result_package_id: Option<u64>,
    pub owner_id: Option<u64>,
    pub from_loc: Option<String>,
    pub to_loc: Option<String>,
    pub lots_visible: bool,
    pub show_details_visible: bool,
    pub show_operations: bool,
    pub additional: bool,
    pub has_move_lines: bool,
    pub package_level_id: Option<u64>,
    pub product_type: Option<String>,
    pub is_assigned: bool,
    pub is_waiting: bool,
    pub is_blocked: bool,
    pub is_late: bool,
    pub delay_hours: f64,
    pub delay_days: i32,
    pub created_uid: Identity,
    pub created_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.13: STOCK MOVE LINE
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Clone)]
#[spacetimedb::table(
    accessor = stock_move_line,
    public,
    index(accessor = move_line_by_org, btree(columns = [organization_id])),
    index(accessor = move_line_by_move, btree(columns = [move_id])),
    index(accessor = move_line_by_product, btree(columns = [product_id]))
)]
pub struct StockMoveLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub move_id: Option<u64>,
    pub company_id: u64,
    pub product_id: u64,
    pub product_variant_id: Option<u64>,
    pub product_uom_id: u64,
    pub location_id: Option<u64>,
    pub location_dest_id: Option<u64>,
    pub lot_id: Option<u64>,
    pub package_id: Option<u64>,
    pub result_package_id: Option<u64>,
    pub owner_id: Option<u64>,
    pub qty_done: f64,
    pub product_uom_qty: f64,
    pub reserved_uom_qty: f64,
    pub reserved_qty: f64,
    pub quantity_done: f64,
    pub quantity_product_uom: f64,
    pub picking_id: Option<u64>,
    pub production_id: Option<u64>,
    pub lot_produced_id: Option<u64>,
    pub lot_produced_qty: f64,
    pub workorder_id: Option<u64>,
    pub description_picking: Option<String>,
    pub date: Option<Timestamp>,
    pub state: Option<String>,
    pub is_initial_demand_editable: bool,
    pub is_locked: bool,
    pub consume_subcontract: bool,
    pub is_done: bool,
    pub reference: Option<String>,
    pub origin: Option<String>,
    pub tracking: Option<String>,
    pub has_package: bool,
    pub display_lot_id: Option<u64>,
    pub location_dest_id_name: Option<String>,
    pub location_id_name: Option<String>,
    pub origin_location_id_name: Option<String>,
    pub origin_location_dest_id_name: Option<String>,
    pub product_tracking: Option<String>,
    pub picking_code: Option<String>,
    pub product_barcode: Option<String>,
    pub show_lots_text: bool,
    pub show_lots_m2o: bool,
    pub location_process_id: Option<u64>,
    pub location_process_dest_id: Option<u64>,
    pub created_uid: Identity,
    pub created_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.14: STOCK PICKING
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Clone)]
#[spacetimedb::table(
    accessor = stock_picking,
    public,
    index(accessor = picking_by_org, btree(columns = [organization_id])),
    index(accessor = picking_by_state, btree(columns = [state])),
    index(accessor = picking_by_partner, btree(columns = [partner_id])),
    index(accessor = picking_by_date, btree(columns = [scheduled_date]))
)]
pub struct StockPicking {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub origin: Option<String>,
    pub note: Option<String>,
    pub state: String,
    pub priority: String,
    pub scheduled_date: Option<Timestamp>,
    pub date: Option<Timestamp>,
    pub date_done: Option<Timestamp>,
    pub move_type: String,
    pub company_id: u64,
    pub user_id: Option<Identity>,
    pub partner_id: Option<u64>,
    pub contact_id: Option<u64>,
    pub picking_type_id: u64,
    pub location_id: u64,
    pub location_dest_id: u64,
    pub sale_id: Option<u64>,
    pub purchase_id: Option<u64>,
    pub backorder_id: Option<u64>,
    pub group_id: Option<u64>,
    pub backorder_ids: Vec<u64>,
    pub is_locked: bool,
    pub is_printed: bool,
    pub is_return: bool,
    pub has_scrap_move: bool,
    pub has_tracking: bool,
    pub immediate_transfer: bool,
    pub show_operations: bool,
    pub show_lots_text: bool,
    pub show_reserved: bool,
    pub show_check_availability: bool,
    pub show_validate: bool,
    pub show_mark_as_todo: bool,
    pub show_set_qty_button: bool,
    pub show_clear_qty_button: bool,
    pub show_lots_m2o: bool,
    pub product_id: Option<u64>,
    pub lot_id: Option<u64>,
    pub package_id: Option<u64>,
    pub result_package_id: Option<u64>,
    pub owner_id: Option<u64>,
    pub display_lot_id: Option<u64>,
    pub location_id_name: Option<String>,
    pub location_dest_id_name: Option<String>,
    pub picking_code: Option<String>,
    pub product_tracking: Option<String>,
    pub product_barcode: Option<String>,
    pub move_line_exist: bool,
    pub has_packages: bool,
    pub has_move_lines: bool,
    pub has_package: bool,
    pub has_lot: bool,
    pub has_owner: bool,
    pub has_entire_package_src: bool,
    pub has_entire_package_dest: bool,
    pub package_level_ids: Vec<u64>,
    pub batch_id: Option<u64>,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateStockQuantParams {
    pub company_id: Option<u64>,
    pub product_id: u64,
    pub product_variant_id: Option<u64>,
    pub location_id: u64,
    pub lot_id: Option<u64>,
    pub package_id: Option<u64>,
    pub owner_id: Option<u64>,
    pub quantity: f64,
    pub reserved_quantity: f64,
    pub in_date: Option<Timestamp>,
    pub inventory_quantity: f64,
    pub inventory_diff_quantity: f64,
    pub inventory_quantity_set: bool,
    pub is_outdated: bool,
    pub user_id: Option<Identity>,
    pub inventory_date: Option<Timestamp>,
    pub cost: f64,
    pub cost_method: Option<String>,
    pub accounting_date: Option<Timestamp>,
    pub currency_id: Option<u64>,
    pub accounting_entry_ids: Vec<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateStockMoveParams {
    pub company_id: Option<u64>,
    pub name: String,
    pub product_id: u64,
    pub product_tmpl_id: u64,
    pub product_uom: u64,
    pub product_uom_qty: f64,
    pub location_id: u64,
    pub location_dest_id: u64,
    pub date_expected: Timestamp,
    pub move_type: String,
    pub priority: String,
    pub reference: Option<String>,
    pub sequence: i32,
    pub origin: Option<String>,
    pub note: Option<String>,
    pub date: Option<Timestamp>,
    pub date_deadline: Option<Timestamp>,
    pub picking_id: Option<u64>,
    pub picking_type_id: Option<u64>,
    pub partner_id: Option<u64>,
    pub product_variant_id: Option<u64>,
    pub group_id: Option<u64>,
    pub rule_id: Option<u64>,
    pub procure_method: String,
    pub price_unit: f64,
    pub scrapped: bool,
    pub to_refund: bool,
    pub propagate_cancel: bool,
    pub delay_alert: bool,
    pub product_packaging_id: Option<u64>,
    pub product_packaging_qty: f64,
    pub warehouse_id: Option<u64>,
    pub production_id: Option<u64>,
    pub raw_material_production_id: Option<u64>,
    pub unbuild_id: Option<u64>,
    pub consume_unbuild_id: Option<u64>,
    pub cost_share: f64,
    pub is_subcontract: bool,
    pub purchase_line_id: Option<u64>,
    pub need_release: bool,
    pub release_ready: bool,
    pub propagation_cancel: bool,
    pub has_tracking: bool,
    pub inventory_id: Option<u64>,
    pub sale_line_id: Option<u64>,
    pub lot_id: Option<u64>,
    pub serial_id: Option<u64>,
    pub package_id: Option<u64>,
    pub result_package_id: Option<u64>,
    pub owner_id: Option<u64>,
    pub package_level_id: Option<u64>,
    pub product_type: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateStockPickingParams {
    pub company_id: Option<u64>,
    pub name: String,
    pub picking_type_id: u64,
    pub location_id: u64,
    pub location_dest_id: u64,
    pub move_type: String,
    pub priority: String,
    pub partner_id: Option<u64>,
    pub contact_id: Option<u64>,
    pub scheduled_date: Option<Timestamp>,
    pub origin: Option<String>,
    pub note: Option<String>,
    pub user_id: Option<Identity>,
    pub sale_id: Option<u64>,
    pub purchase_id: Option<u64>,
    pub group_id: Option<u64>,
    pub is_locked: bool,
    pub immediate_transfer: bool,
    pub is_printed: bool,
    pub is_return: bool,
    pub has_scrap_move: bool,
    pub has_tracking: bool,
    pub date: Option<Timestamp>,
    pub date_done: Option<Timestamp>,
    pub backorder_id: Option<u64>,
    pub backorder_ids: Vec<u64>,
    pub show_operations: bool,
    pub show_lots_text: bool,
    pub show_reserved: bool,
    pub show_check_availability: bool,
    pub show_validate: bool,
    pub show_mark_as_todo: bool,
    pub show_set_qty_button: bool,
    pub show_clear_qty_button: bool,
    pub show_lots_m2o: bool,
    pub product_id: Option<u64>,
    pub lot_id: Option<u64>,
    pub package_id: Option<u64>,
    pub result_package_id: Option<u64>,
    pub owner_id: Option<u64>,
    pub display_lot_id: Option<u64>,
    pub location_id_name: Option<String>,
    pub location_dest_id_name: Option<String>,
    pub picking_code: Option<String>,
    pub product_tracking: Option<String>,
    pub product_barcode: Option<String>,
    pub move_line_exist: bool,
    pub has_packages: bool,
    pub has_move_lines: bool,
    pub has_package: bool,
    pub has_lot: bool,
    pub has_owner: bool,
    pub has_entire_package_src: bool,
    pub has_entire_package_dest: bool,
    pub package_level_ids: Vec<u64>,
    pub batch_id: Option<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateStockQuantQuantityParams {
    pub company_id: Option<u64>,
    pub quantity: f64,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct StockQuantReserveParams {
    pub company_id: Option<u64>,
    pub reserve_qty: f64,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct StockQuantUnreserveParams {
    pub company_id: Option<u64>,
    pub unreserve_qty: f64,
}

/// Move available quantity from one stock location to another (internal transfer at quant level).
#[derive(SpacetimeType, Clone, Debug)]
pub struct MoveStockQuantParams {
    pub company_id: Option<u64>,
    pub dest_location_id: u64,
    pub quantity: f64,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct DoneStockMoveParams {
    pub company_id: Option<u64>,
    pub quantity_done: f64,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct AssignUserToPickingParams {
    pub company_id: Option<u64>,
    pub user_id: Option<Identity>,
}

// ── Internal helpers (sales / picking integrity) ─────────────────────────────

/// On-hand location for a warehouse (`lot_stock_id` when set; else warehouse id).
pub(crate) fn resolve_warehouse_stock_location(
    ctx: &ReducerContext,
    warehouse_id: u64,
) -> u64 {
    if let Some(wh) = ctx.db.warehouse().id().find(&warehouse_id) {
        if wh.lot_stock_id > 0 {
            return wh.lot_stock_id;
        }
    }
    warehouse_id
}

/// Storable / consumable products need ATP; services do not.
pub(crate) fn product_requires_stock(ctx: &ReducerContext, product_id: u64) -> bool {
    ctx.db
        .product()
        .id()
        .find(&product_id)
        .map(|p| p.type_ != "service")
        .unwrap_or(true)
}

/// Company-owned ATP quant (`owner_id` is None). Vendor-consigned stock is excluded.
fn find_quant_at_location(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    location_id: u64,
) -> Option<StockQuant> {
    find_quant_at_location_with_owner(
        ctx,
        organization_id,
        company_id,
        product_id,
        location_id,
        None,
    )
}

fn find_quant_at_location_with_owner(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    location_id: u64,
    owner_id: Option<u64>,
) -> Option<StockQuant> {
    ctx.db
        .stock_quant()
        .quant_by_product()
        .filter(&product_id)
        .find(|q| {
            q.organization_id == organization_id
                && q.company_id == company_id
                && q.location_id == location_id
                && q.owner_id == owner_id
        })
}

/// Product tracking mode: `none` | `lot` | `serial`.
fn product_tracking_mode(ctx: &ReducerContext, product_id: u64) -> Result<&'static str, String> {
    let tracking = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or_else(|| format!("Product {} not found", product_id))?
        .tracking
        .to_ascii_lowercase();
    Ok(match tracking.as_str() {
        "lot" => "lot",
        "serial" => "serial",
        _ => "none",
    })
}

fn whole_unit_qty(qty: f64, product_id: u64) -> Result<usize, String> {
    if qty < 0.0 || (qty - qty.round()).abs() > 1e-9 {
        return Err(format!(
            "serial-tracked product {} requires a whole-number quantity (got {})",
            product_id, qty
        ));
    }
    Ok(qty.round() as usize)
}

fn timestamp_micros(ts: Timestamp) -> i64 {
    ts.to_micros_since_unix_epoch()
}

fn is_timestamp_due(ts: Option<Timestamp>, now: Timestamp) -> bool {
    ts.map(|t| timestamp_micros(t) <= timestamp_micros(now))
        .unwrap_or(false)
}

fn lot_expiry_sort_key(ctx: &ReducerContext, lot_id: Option<u64>) -> i64 {
    lot_id
        .and_then(|id| ctx.db.stock_production_lot().id().find(&id))
        .and_then(|lot| lot.expiration_date.or(lot.removal_date))
        .map(timestamp_micros)
        .unwrap_or(i64::MAX)
}

fn serial_expiry_sort_key(serial: &crate::inventory::tracking::StockProductionSerial) -> i64 {
    serial
        .expiration_date
        .or(serial.removal_date)
        .map(timestamp_micros)
        .unwrap_or(i64::MAX)
}

fn find_lot_quant_at_location(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    location_id: u64,
    qty: f64,
) -> Result<StockQuant, String> {
    let mut candidates: Vec<_> = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&product_id)
        .filter(|q| {
            q.organization_id == organization_id
                && q.company_id == company_id
                && q.location_id == location_id
                && q.owner_id.is_none() // exclude vendor-consigned from general ATP
                && q.lot_id.is_some()
                && (q.quantity - q.reserved_quantity) + 1e-9 >= qty
        })
        .filter(|q| {
            q.lot_id
                .map(|lid| ensure_lot_for_product(ctx, organization_id, company_id, product_id, lid).is_ok())
                .unwrap_or(false)
        })
        .collect();

    candidates.sort_by_key(|q| lot_expiry_sort_key(ctx, q.lot_id));

    candidates.into_iter().next().ok_or_else(|| {
        format!(
            "No non-expired lot-tracked stock quant for product {} at location {} — lot required",
            product_id, location_id
        )
    })
}

fn ensure_lot_for_product(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    lot_id: u64,
) -> Result<(), String> {
    let lot = ctx
        .db
        .stock_production_lot()
        .id()
        .find(&lot_id)
        .ok_or_else(|| format!("Lot {} not found", lot_id))?;
    if lot.organization_id != organization_id {
        return Err("Lot does not belong to this organization".to_string());
    }
    if lot.company_id != company_id {
        return Err("Lot does not belong to this company".to_string());
    }
    if lot.product_id != product_id {
        return Err(format!(
            "Lot {} belongs to product {}, not {}",
            lot_id, lot.product_id, product_id
        ));
    }
    if lot.is_locked {
        return Err(format!("Lot {} is locked", lot_id));
    }
    if is_timestamp_due(lot.expiration_date, ctx.timestamp)
        || is_timestamp_due(lot.removal_date, ctx.timestamp)
    {
        return Err(format!("Lot {} is expired or past removal date", lot_id));
    }
    Ok(())
}

fn ensure_serial_usable(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    serial: &crate::inventory::tracking::StockProductionSerial,
) -> Result<(), String> {
    if serial.organization_id != organization_id {
        return Err("Serial does not belong to this organization".to_string());
    }
    if serial.company_id != company_id {
        return Err("Serial does not belong to this company".to_string());
    }
    if serial.product_id != product_id {
        return Err(format!(
            "Serial {} belongs to product {}, not {}",
            serial.id, serial.product_id, product_id
        ));
    }
    if serial.is_locked {
        return Err(format!("Serial {} is locked", serial.id));
    }
    if is_timestamp_due(serial.expiration_date, ctx.timestamp)
        || is_timestamp_due(serial.removal_date, ctx.timestamp)
    {
        return Err(format!(
            "Serial {} is expired or past removal date",
            serial.id
        ));
    }
    Ok(())
}

fn reserve_free_serials(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    qty: usize,
    location_id: Option<u64>,
) -> Result<(), String> {
    if qty == 0 {
        return Ok(());
    }
    let mut free: Vec<_> = ctx
        .db
        .stock_production_serial()
        .serial_by_product()
        .filter(&product_id)
        .filter(|s| {
            s.state == "free"
                && location_id
                    .map(|lid| s.location_id.is_none() || s.location_id == Some(lid))
                    .unwrap_or(true)
                && ensure_serial_usable(ctx, organization_id, company_id, product_id, s).is_ok()
        })
        .collect();
    free.sort_by_key(serial_expiry_sort_key);
    free.truncate(qty);
    if free.len() < qty {
        return Err(format!(
            "Insufficient free non-expired serials for product {} (need {}, have {})",
            product_id,
            qty,
            free.len()
        ));
    }
    for serial in free {
        ctx.db
            .stock_production_serial()
            .id()
            .update(StockProductionSerial {
                state: "reserved".to_string(),
                write_date: ctx.timestamp,
                ..serial
            });
    }
    Ok(())
}

fn consume_serial_by_id(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    serial_id: u64,
) -> Result<(), String> {
    let serial = ctx
        .db
        .stock_production_serial()
        .id()
        .find(&serial_id)
        .ok_or_else(|| format!("Serial {} not found", serial_id))?;
    ensure_serial_usable(ctx, organization_id, company_id, product_id, &serial)?;
    if serial.state != "reserved" && serial.state != "free" {
        return Err(format!(
            "Serial {} must be free or reserved before validate (current state: {})",
            serial_id, serial.state
        ));
    }
    ctx.db
        .stock_production_serial()
        .id()
        .update(StockProductionSerial {
            state: "in_use".to_string(),
            write_date: ctx.timestamp,
            ..serial
        });
    Ok(())
}

fn release_reserved_serials(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    qty: usize,
) -> Result<(), String> {
    if qty == 0 {
        return Ok(());
    }
    let reserved: Vec<_> = ctx
        .db
        .stock_production_serial()
        .serial_by_product()
        .filter(&product_id)
        .filter(|s| {
            s.organization_id == organization_id
                && s.company_id == company_id
                && s.state == "reserved"
                && !s.is_locked
        })
        .take(qty)
        .collect();
    if reserved.len() < qty {
        return Err(format!(
            "Cannot release serials for product {} (need {}, have {})",
            product_id,
            qty,
            reserved.len()
        ));
    }
    for serial in reserved {
        ctx.db
            .stock_production_serial()
            .id()
            .update(StockProductionSerial {
                state: "free".to_string(),
                write_date: ctx.timestamp,
                ..serial
            });
    }
    Ok(())
}

fn consume_reserved_serials(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    qty: usize,
) -> Result<(), String> {
    if qty == 0 {
        return Ok(());
    }
    let mut reserved: Vec<_> = ctx
        .db
        .stock_production_serial()
        .serial_by_product()
        .filter(&product_id)
        .filter(|s| {
            s.state == "reserved"
                && ensure_serial_usable(ctx, organization_id, company_id, product_id, s).is_ok()
        })
        .collect();
    reserved.sort_by_key(serial_expiry_sort_key);
    reserved.truncate(qty);
    if reserved.len() < qty {
        return Err(format!(
            "Insufficient reserved non-expired serials for product {} (need {}, have {})",
            product_id,
            qty,
            reserved.len()
        ));
    }
    for serial in reserved {
        ctx.db
            .stock_production_serial()
            .id()
            .update(StockProductionSerial {
                state: "in_use".to_string(),
                write_date: ctx.timestamp,
                ..serial
            });
    }
    Ok(())
}

fn place_free_serials_at_location(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    qty: usize,
    location_id: u64,
) -> Result<(), String> {
    if qty == 0 {
        return Ok(());
    }
    let mut free: Vec<_> = ctx
        .db
        .stock_production_serial()
        .serial_by_product()
        .filter(&product_id)
        .filter(|s| {
            s.state == "free"
                && ensure_serial_usable(ctx, organization_id, company_id, product_id, s).is_ok()
        })
        .collect();
    free.sort_by_key(serial_expiry_sort_key);
    free.truncate(qty);
    if free.len() < qty {
        return Err(format!(
            "Insufficient free non-expired serials for inbound product {} (need {}, have {})",
            product_id,
            qty,
            free.len()
        ));
    }
    for serial in free {
        ctx.db
            .stock_production_serial()
            .id()
            .update(StockProductionSerial {
                location_id: Some(location_id),
                write_date: ctx.timestamp,
                ..serial
            });
    }
    Ok(())
}

fn enforce_tracking_on_quant_reserve(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    lot_id: Option<u64>,
    location_id: u64,
    qty: f64,
) -> Result<(), String> {
    match product_tracking_mode(ctx, product_id)? {
        "lot" => {
            let Some(lot_id) = lot_id else {
                return Err(format!(
                    "Lot required to reserve lot-tracked product {}",
                    product_id
                ));
            };
            ensure_lot_for_product(ctx, organization_id, company_id, product_id, lot_id)
        }
        "serial" => {
            let n = whole_unit_qty(qty, product_id)?;
            reserve_free_serials(
                ctx,
                organization_id,
                company_id,
                product_id,
                n,
                Some(location_id),
            )
        }
        _ => Ok(()),
    }
}

fn enforce_tracking_on_move_validate(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    lot_id: Option<u64>,
    serial_id: Option<u64>,
    location_dest_id: u64,
    qty_done: f64,
    is_inbound: bool,
) -> Result<(), String> {
    if qty_done <= 0.0 {
        return Ok(());
    }
    match product_tracking_mode(ctx, product_id)? {
        "lot" => {
            let Some(lot_id) = lot_id else {
                return Err(format!(
                    "Lot required to validate move for lot-tracked product {}",
                    product_id
                ));
            };
            ensure_lot_for_product(ctx, organization_id, company_id, product_id, lot_id)
        }
        "serial" => {
            let n = whole_unit_qty(qty_done, product_id)?;
            if let Some(serial_id) = serial_id {
                if n != 1 {
                    return Err(format!(
                        "Move serial_id requires quantity 1 for product {} (got {})",
                        product_id, qty_done
                    ));
                }
                if is_inbound {
                    let serial = ctx
                        .db
                        .stock_production_serial()
                        .id()
                        .find(&serial_id)
                        .ok_or_else(|| format!("Serial {} not found", serial_id))?;
                    ensure_serial_usable(ctx, organization_id, company_id, product_id, &serial)?;
                    if serial.state != "free" {
                        return Err(format!(
                            "Inbound serial {} must be free (current state: {})",
                            serial_id, serial.state
                        ));
                    }
                    ctx.db
                        .stock_production_serial()
                        .id()
                        .update(StockProductionSerial {
                            location_id: Some(location_dest_id),
                            write_date: ctx.timestamp,
                            ..serial
                        });
                    Ok(())
                } else {
                    consume_serial_by_id(ctx, organization_id, company_id, product_id, serial_id)
                }
            } else if is_inbound {
                place_free_serials_at_location(
                    ctx,
                    organization_id,
                    company_id,
                    product_id,
                    n,
                    location_dest_id,
                )
            } else {
                consume_reserved_serials(ctx, organization_id, company_id, product_id, n)
            }
        }
        _ => Ok(()),
    }
}

/// Locations that must not contribute to soft ATP (QC / quarantine / scrap).
pub(crate) fn location_blocks_atp(ctx: &ReducerContext, location_id: u64) -> bool {
    if let Some(loc) = ctx.db.stock_location().id().find(&location_id) {
        if loc.scrap_location {
            return true;
        }
        let usage = loc.usage.to_ascii_lowercase();
        if usage.contains("qc") || usage.contains("quarantine") {
            return true;
        }
    }
    ctx.db
        .warehouse()
        .iter()
        .any(|w| w.wh_qc_stock_loc_id == Some(location_id))
}

/// Move qty into a quarantine/QC location and release reservations (removes from ATP).
pub(crate) fn quarantine_quantity(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    lot_id: Option<u64>,
    source_location_id: u64,
    quarantine_location_id: u64,
    qty: f64,
) -> Result<(), String> {
    if qty <= 0.0 {
        return Ok(());
    }
    if source_location_id == quarantine_location_id {
        return Err("Quarantine location must differ from source location".to_string());
    }

    let src = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&product_id)
        .find(|q| {
            q.organization_id == organization_id
                && q.company_id == company_id
                && q.location_id == source_location_id
                && q.lot_id == lot_id
        })
        .ok_or_else(|| {
            format!(
                "No stock quant for product {} at location {} to quarantine",
                product_id, source_location_id
            )
        })?;

    if src.quantity + 1e-9 < qty {
        return Err(format!(
            "Cannot quarantine more than on-hand for product {} (have {}, need {})",
            product_id, src.quantity, qty
        ));
    }

    // Release reservation covering the quarantined qty so it leaves ATP.
    let release = qty.min(src.reserved_quantity);
    let new_reserved = (src.reserved_quantity - release).max(0.0);
    let new_qty = src.quantity - qty;
    let new_available = (new_qty - new_reserved).max(0.0);

    if new_qty <= 1e-9 {
        ctx.db.stock_quant().id().delete(&src.id);
    } else {
        ctx.db.stock_quant().id().update(StockQuant {
            quantity: new_qty,
            reserved_quantity: new_reserved,
            available_quantity: new_available,
            value: new_qty * src.cost,
            ..src.clone()
        });
    }

    if let Some(dest) = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&product_id)
        .find(|q| {
            q.organization_id == organization_id
                && q.company_id == company_id
                && q.location_id == quarantine_location_id
                && q.lot_id == lot_id
        })
    {
        let dq = dest.quantity + qty;
        // Quarantined stock is never ATP-available even if co-located.
        ctx.db.stock_quant().id().update(StockQuant {
            quantity: dq,
            available_quantity: 0.0,
            reserved_quantity: 0.0,
            value: dq * dest.cost,
            ..dest
        });
    } else {
        ctx.db.stock_quant().insert(StockQuant {
            id: 0,
            organization_id,
            product_id,
            product_variant_id: src.product_variant_id,
            location_id: quarantine_location_id,
            lot_id,
            package_id: src.package_id,
            owner_id: src.owner_id,
            company_id,
            quantity: qty,
            reserved_quantity: 0.0,
            available_quantity: 0.0,
            in_date: Some(ctx.timestamp),
            inventory_quantity: qty,
            inventory_diff_quantity: 0.0,
            inventory_quantity_set: true,
            is_outdated: false,
            user_id: Some(ctx.sender()),
            inventory_date: Some(ctx.timestamp),
            cost: src.cost,
            value: qty * src.cost,
            cost_method: src.cost_method.clone(),
            accounting_date: None,
            currency_id: src.currency_id,
            accounting_entry_ids: vec![],
            metadata: Some(r#"{"quarantine":true}"#.to_string()),
        });
    }

    Ok(())
}

fn ensure_picking_tasks_allow_validate(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    picking_id: u64,
) -> Result<(), String> {
    // Option columns are not FilterableValue in STDB 2.0.1 — scan org index.
    let open_count = ctx
        .db
        .warehouse_task()
        .task_by_org()
        .filter(&organization_id)
        .filter(|t| {
            t.company_id == company_id
                && t.picking_id == Some(picking_id)
                && t.state != "done"
                && t.state != "cancelled"
        })
        .count();

    if open_count > 0 {
        return Err(format!(
            "Picking {} has {} open warehouse task(s) — complete or cancel them before validate",
            picking_id, open_count
        ));
    }
    Ok(())
}

/// Convert a quantity expressed in `from_uom_id` into the product's stock UoM.
pub(crate) fn to_product_stock_qty(
    ctx: &ReducerContext,
    organization_id: u64,
    product_id: u64,
    from_uom_id: u64,
    qty: f64,
) -> Result<f64, String> {
    let product = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or("Product not found for UoM conversion")?;
    convert_uom_quantity(
        ctx,
        organization_id,
        from_uom_id,
        product.uom_id,
        qty,
        Some(product_id),
    )
}

/// Reserve qty at a location; fails closed when ATP is short.
/// `qty` must be in the product's stock UoM (`product.uom_id`).
pub(crate) fn reserve_quantity_at_location(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    location_id: u64,
    qty: f64,
) -> Result<(), String> {
    if qty <= 0.0 {
        return Ok(());
    }
    assert_inventory_writable(ctx, organization_id, company_id)?;
    if location_blocks_atp(ctx, location_id) {
        return Err(format!(
            "Cannot reserve ATP from quarantine/QC location {}",
            location_id
        ));
    }
    let tracking = product_tracking_mode(ctx, product_id)?;
    let quant = if tracking == "lot" {
        find_lot_quant_at_location(
            ctx,
            organization_id,
            company_id,
            product_id,
            location_id,
            qty,
        )?
    } else {
        find_quant_at_location(ctx, organization_id, company_id, product_id, location_id)
            .ok_or_else(|| {
                format!(
                    "No stock quant for product {} at location {} — cannot reserve",
                    product_id, location_id
                )
            })?
    };

    let new_reserved = quant.reserved_quantity + qty;
    if new_reserved > quant.quantity + 1e-9 {
        return Err(format!(
            "Insufficient available quantity for product {} (need {}, available {})",
            product_id,
            qty,
            (quant.quantity - quant.reserved_quantity).max(0.0)
        ));
    }

    enforce_tracking_on_quant_reserve(
        ctx,
        organization_id,
        company_id,
        product_id,
        quant.lot_id,
        location_id,
        qty,
    )?;

    let available_quantity = quant.quantity - new_reserved;
    ctx.db.stock_quant().id().update(StockQuant {
        reserved_quantity: new_reserved,
        available_quantity,
        ..quant
    });
    Ok(())
}

/// Release a prior reservation without moving on-hand qty.
pub(crate) fn unreserve_quantity_at_location(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    location_id: u64,
    qty: f64,
) -> Result<(), String> {
    if qty <= 0.0 {
        return Ok(());
    }
    let Some(quant) =
        find_quant_at_location(ctx, organization_id, company_id, product_id, location_id)
    else {
        return Ok(());
    };

    if product_tracking_mode(ctx, product_id)? == "serial" {
        let n = whole_unit_qty(qty, product_id)?;
        // Best-effort: release what we can without failing cancel paths.
        let _ = release_reserved_serials(ctx, organization_id, company_id, product_id, n);
    }

    let new_reserved = (quant.reserved_quantity - qty).max(0.0);
    let available_quantity = quant.quantity - new_reserved;
    ctx.db.stock_quant().id().update(StockQuant {
        reserved_quantity: new_reserved,
        available_quantity,
        ..quant
    });
    Ok(())
}

pub(crate) fn increase_quant_at_location(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    location_id: u64,
    qty: f64,
    cost: f64,
) -> Result<(), String> {
    let method = crate::inventory::costing::product_for_costing(ctx, product_id)
        .map(|p| crate::inventory::costing::normalize_cost_method(&p.cost_method))
        .unwrap_or_else(|_| "standard".to_string());
    increase_quant_at_location_owned(
        ctx,
        organization_id,
        company_id,
        product_id,
        location_id,
        qty,
        cost,
        None,
        &method,
    )
}

/// Increase on-hand at a location, optionally under a vendor owner (consignment).
///
/// Cost-method behavior:
/// - `standard` / `average`: merge into an existing quant (average blends unit cost)
/// - `fifo` / `lifo`: merge only when unit cost matches; otherwise insert a new layer
pub(crate) fn increase_quant_at_location_owned(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    location_id: u64,
    qty: f64,
    cost: f64,
    owner_id: Option<u64>,
    cost_method: &str,
) -> Result<(), String> {
    if qty <= 0.0 {
        return Ok(());
    }
    let method = crate::inventory::costing::normalize_cost_method(cost_method);
    let layered = method == "fifo" || method == "lifo";

    let merge_target = if layered {
        find_quant_at_location_with_owner_and_cost(
            ctx,
            organization_id,
            company_id,
            product_id,
            location_id,
            owner_id,
            cost,
        )
    } else {
        find_quant_at_location_with_owner(
            ctx,
            organization_id,
            company_id,
            product_id,
            location_id,
            owner_id,
        )
    };

    if let Some(quant) = merge_target {
        let new_qty = quant.quantity + qty;
        let (new_cost, new_value) = if method == "average" {
            let old_value = quant.value.max(0.0);
            let added = qty * cost;
            let blended = if new_qty > 1e-9 {
                (old_value + added) / new_qty
            } else {
                cost
            };
            (blended, new_qty * blended)
        } else if method == "standard" {
            (cost, new_qty * cost)
        } else {
            // Same-cost merge for fifo/lifo layers.
            (quant.cost, new_qty * quant.cost)
        };
        let available_quantity = if owner_id.is_some() {
            0.0
        } else {
            new_qty - quant.reserved_quantity
        };
        ctx.db.stock_quant().id().update(StockQuant {
            quantity: new_qty,
            available_quantity,
            cost: new_cost,
            value: new_value,
            cost_method: Some(method),
            ..quant
        });
    } else {
        let available_quantity = if owner_id.is_some() { 0.0 } else { qty };
        ctx.db.stock_quant().insert(StockQuant {
            id: 0,
            organization_id,
            product_id,
            product_variant_id: None,
            location_id,
            lot_id: None,
            package_id: None,
            owner_id,
            company_id,
            quantity: qty,
            reserved_quantity: 0.0,
            available_quantity,
            in_date: Some(ctx.timestamp),
            inventory_quantity: qty,
            inventory_diff_quantity: 0.0,
            inventory_quantity_set: true,
            is_outdated: false,
            user_id: Some(ctx.sender()),
            inventory_date: Some(ctx.timestamp),
            cost,
            value: qty * cost,
            cost_method: Some(method),
            accounting_date: None,
            currency_id: None,
            accounting_entry_ids: vec![],
            metadata: if owner_id.is_some() {
                Some(r#"{"consignment":true}"#.to_string())
            } else {
                None
            },
        });
    }
    Ok(())
}

fn find_quant_at_location_with_owner_and_cost(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    location_id: u64,
    owner_id: Option<u64>,
    cost: f64,
) -> Option<StockQuant> {
    ctx.db
        .stock_quant()
        .quant_by_product()
        .filter(&product_id)
        .find(|q| {
            q.organization_id == organization_id
                && q.company_id == company_id
                && q.location_id == location_id
                && q.owner_id == owner_id
                && crate::inventory::costing::costs_match(q.cost, cost)
        })
}

/// Apply inventory consequences for a validated stock move (outbound consume or inbound receive).
pub(crate) fn apply_validated_move_to_quants(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    location_id: u64,
    location_dest_id: u64,
    qty: f64,
    is_inbound: bool,
    move_price_unit: f64,
) -> Result<(), String> {
    if qty <= 0.0 || !product_requires_stock(ctx, product_id) {
        return Ok(());
    }

    if is_inbound {
        let product = crate::inventory::costing::product_for_costing(ctx, product_id)?;
        let method = crate::inventory::costing::normalize_cost_method(&product.cost_method);
        let cost =
            crate::inventory::costing::resolve_inbound_unit_cost(&product, move_price_unit);
        if let Some(src) =
            find_quant_at_location(ctx, organization_id, company_id, product_id, location_id)
        {
            let take = qty.min(src.quantity);
            if take > 0.0 {
                let new_qty = src.quantity - take;
                let new_reserved = src.reserved_quantity.min(new_qty);
                ctx.db.stock_quant().id().update(StockQuant {
                    quantity: new_qty,
                    reserved_quantity: new_reserved,
                    available_quantity: new_qty - new_reserved,
                    value: new_qty * src.cost,
                    ..src
                });
            }
        }
        return increase_quant_at_location_owned(
            ctx,
            organization_id,
            company_id,
            product_id,
            location_dest_id,
            qty,
            cost,
            None,
            &method,
        );
    }

    // Outbound: consume reserved qty at source and transfer to dest.
    let quant = find_quant_at_location(ctx, organization_id, company_id, product_id, location_id)
        .ok_or_else(|| {
            format!(
                "No stock quant for product {} at location {} on validate",
                product_id, location_id
            )
        })?;

    if quant.quantity + 1e-9 < qty {
        return Err(format!(
            "Cannot deliver more than on-hand for product {} (have {}, need {})",
            product_id, quant.quantity, qty
        ));
    }

    let release_reserve = qty.min(quant.reserved_quantity);
    let new_qty = quant.quantity - qty;
    let new_reserved = (quant.reserved_quantity - release_reserve).max(0.0);
    let available_quantity = new_qty - new_reserved;
    let cost = quant.cost;

    if new_qty <= 1e-9 {
        ctx.db.stock_quant().id().delete(&quant.id);
    } else {
        ctx.db.stock_quant().id().update(StockQuant {
            quantity: new_qty,
            reserved_quantity: new_reserved,
            available_quantity,
            value: new_qty * cost,
            ..quant
        });
    }

    if location_dest_id != location_id {
        increase_quant_at_location(
            ctx,
            organization_id,
            company_id,
            product_id,
            location_dest_id,
            qty,
            cost,
        )?;
    }
    Ok(())
}

// ── Reducers ─────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: STOCK QUANT
// ══════════════════════════════════════════════════════════════════════════════

#[reducer]
pub fn create_stock_quant(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateStockQuantParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_quant", "create")?;

    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    let available_quantity = params.quantity - params.reserved_quantity;
    let value = params.quantity * params.cost;

    let quant = ctx.db.stock_quant().insert(StockQuant {
        id: 0,
        organization_id,
        product_id: params.product_id,
        product_variant_id: params.product_variant_id,
        location_id: params.location_id,
        lot_id: params.lot_id,
        package_id: params.package_id,
        owner_id: params.owner_id,
        company_id,
        quantity: params.quantity,
        reserved_quantity: params.reserved_quantity,
        available_quantity,
        in_date: params.in_date,
        inventory_quantity: params.inventory_quantity,
        inventory_diff_quantity: params.inventory_diff_quantity,
        inventory_quantity_set: params.inventory_quantity_set,
        is_outdated: params.is_outdated,
        user_id: params.user_id,
        inventory_date: params.inventory_date,
        cost: params.cost,
        value,
        cost_method: params.cost_method,
        accounting_date: params.accounting_date,
        currency_id: params.currency_id,
        accounting_entry_ids: params.accounting_entry_ids,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_quant",
            record_id: quant.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "product_id": quant.product_id,
                    "location_id": quant.location_id,
                    "quantity": quant.quantity,
                })
                .to_string(),
            ),
            changed_fields: vec!["quantity".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn update_stock_quant_quantity(
    ctx: &ReducerContext,
    organization_id: u64,
    quant_id: u64,
    params: UpdateStockQuantQuantityParams,
) -> Result<(), String> {
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    let quant = ctx
        .db
        .stock_quant()
        .id()
        .find(&quant_id)
        .ok_or("Quant not found")?;

    check_permission(ctx, organization_id, "stock_quant", "write")?;

    if quant.company_id != company_id {
        return Err("Quant does not belong to this company".to_string());
    }

    let quantity = params.quantity;
    let available_quantity = quantity - quant.reserved_quantity;
    let value = quantity * quant.cost;

    ctx.db.stock_quant().id().update(StockQuant {
        quantity,
        available_quantity,
        value,
        ..quant.clone()
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_quant",
            record_id: quant_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "quantity": quant.quantity }).to_string()),
            new_values: Some(serde_json::json!({ "quantity": quantity }).to_string()),
            changed_fields: vec!["quantity".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn reserve_stock_quant(
    ctx: &ReducerContext,
    organization_id: u64,
    quant_id: u64,
    params: StockQuantReserveParams,
) -> Result<(), String> {
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    let quant = ctx
        .db
        .stock_quant()
        .id()
        .find(&quant_id)
        .ok_or("Quant not found")?;

    check_permission(ctx, organization_id, "stock_quant", "write")?;

    if quant.company_id != company_id {
        return Err("Quant does not belong to this company".to_string());
    }

    let reserve_qty = params.reserve_qty;
    let new_reserved = quant.reserved_quantity + reserve_qty;
    if new_reserved > quant.quantity {
        return Err("Cannot reserve more than available quantity".to_string());
    }

    enforce_tracking_on_quant_reserve(
        ctx,
        organization_id,
        company_id,
        quant.product_id,
        quant.lot_id,
        quant.location_id,
        reserve_qty,
    )?;

    let available_quantity = quant.quantity - new_reserved;

    ctx.db.stock_quant().id().update(StockQuant {
        reserved_quantity: new_reserved,
        available_quantity,
        ..quant.clone()
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_quant",
            record_id: quant_id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({ "reserved_quantity": quant.reserved_quantity }).to_string(),
            ),
            new_values: Some(serde_json::json!({ "reserved_quantity": new_reserved }).to_string()),
            changed_fields: vec!["reserved_quantity".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn unreserve_stock_quant(
    ctx: &ReducerContext,
    organization_id: u64,
    quant_id: u64,
    params: StockQuantUnreserveParams,
) -> Result<(), String> {
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    let quant = ctx
        .db
        .stock_quant()
        .id()
        .find(&quant_id)
        .ok_or("Quant not found")?;

    check_permission(ctx, organization_id, "stock_quant", "write")?;

    if quant.company_id != company_id {
        return Err("Quant does not belong to this company".to_string());
    }

    let unreserve_qty = params.unreserve_qty;
    if product_tracking_mode(ctx, quant.product_id)? == "serial" {
        let n = whole_unit_qty(unreserve_qty, quant.product_id)?;
        let _ = release_reserved_serials(
            ctx,
            organization_id,
            company_id,
            quant.product_id,
            n,
        );
    }
    let new_reserved = (quant.reserved_quantity - unreserve_qty).max(0.0);
    let available_quantity = quant.quantity - new_reserved;

    ctx.db.stock_quant().id().update(StockQuant {
        reserved_quantity: new_reserved,
        available_quantity,
        ..quant.clone()
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_quant",
            record_id: quant_id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({ "reserved_quantity": quant.reserved_quantity }).to_string(),
            ),
            new_values: Some(serde_json::json!({ "reserved_quantity": new_reserved }).to_string()),
            changed_fields: vec!["reserved_quantity".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn move_stock_quant(
    ctx: &ReducerContext,
    organization_id: u64,
    quant_id: u64,
    params: MoveStockQuantParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_quant", "write")?;
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    if params.quantity <= 0.0 {
        return Err("Quantity must be positive".to_string());
    }

    let src = ctx
        .db
        .stock_quant()
        .id()
        .find(&quant_id)
        .ok_or("Quant not found")?;

    if src.organization_id != organization_id {
        return Err("Quant does not belong to this organization".to_string());
    }
    if src.company_id != company_id {
        return Err("Quant does not belong to this company".to_string());
    }

    if params.dest_location_id == src.location_id {
        return Ok(());
    }

    if params.quantity > src.available_quantity {
        return Err("Cannot move more than available quantity (unreserve first)".to_string());
    }

    let qty = params.quantity;
    let eps = 1e-9_f64;

    // Find an existing quant at destination with the same product / variant / lot / package / owner.
    let mut dest_id: Option<u64> = None;
    for q in ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&src.product_id)
    {
        if q.organization_id != organization_id || q.company_id != company_id {
            continue;
        }
        if q.location_id != params.dest_location_id {
            continue;
        }
        if q.product_variant_id != src.product_variant_id {
            continue;
        }
        if q.lot_id != src.lot_id {
            continue;
        }
        if q.package_id != src.package_id {
            continue;
        }
        if q.owner_id != src.owner_id {
            continue;
        }
        dest_id = Some(q.id);
        break;
    }

    let is_emptying_src = (src.quantity - qty).abs() <= eps;

    match dest_id {
        Some(did) => {
            let dest = ctx
                .db
                .stock_quant()
                .id()
                .find(&did)
                .ok_or("Destination quant disappeared")?;
            let new_dest_qty = dest.quantity + qty;
            let new_dest_reserved = dest.reserved_quantity;
            let new_dest_available = new_dest_qty - new_dest_reserved;
            let new_dest_value = new_dest_qty * dest.cost;

            ctx.db.stock_quant().id().update(StockQuant {
                quantity: new_dest_qty,
                available_quantity: new_dest_available,
                value: new_dest_value,
                ..dest.clone()
            });

            if is_emptying_src {
                ctx.db.stock_quant().id().delete(&quant_id);
            } else {
                let new_src_qty = src.quantity - qty;
                let new_src_available = new_src_qty - src.reserved_quantity;
                let new_src_value = new_src_qty * src.cost;
                ctx.db.stock_quant().id().update(StockQuant {
                    quantity: new_src_qty,
                    available_quantity: new_src_available,
                    value: new_src_value,
                    ..src.clone()
                });
            }
        }
        None if is_emptying_src => {
            ctx.db.stock_quant().id().update(StockQuant {
                location_id: params.dest_location_id,
                ..src.clone()
            });
        }
        None => {
            let new_src_qty = src.quantity - qty;
            let new_src_available = new_src_qty - src.reserved_quantity;
            let new_src_value = new_src_qty * src.cost;
            ctx.db.stock_quant().id().update(StockQuant {
                quantity: new_src_qty,
                available_quantity: new_src_available,
                value: new_src_value,
                ..src.clone()
            });

            ctx.db.stock_quant().insert(StockQuant {
                id: 0,
                organization_id: src.organization_id,
                product_id: src.product_id,
                product_variant_id: src.product_variant_id,
                location_id: params.dest_location_id,
                lot_id: src.lot_id,
                package_id: src.package_id,
                owner_id: src.owner_id,
                company_id: src.company_id,
                quantity: qty,
                reserved_quantity: 0.0,
                available_quantity: qty,
                in_date: src.in_date,
                inventory_quantity: src.inventory_quantity,
                inventory_diff_quantity: src.inventory_diff_quantity,
                inventory_quantity_set: src.inventory_quantity_set,
                is_outdated: src.is_outdated,
                user_id: src.user_id,
                inventory_date: src.inventory_date,
                cost: src.cost,
                value: qty * src.cost,
                cost_method: src.cost_method.clone(),
                accounting_date: src.accounting_date,
                currency_id: src.currency_id,
                accounting_entry_ids: src.accounting_entry_ids.clone(),
                metadata: src.metadata.clone(),
            });
        }
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_quant",
            record_id: quant_id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({
                    "location_id": src.location_id,
                    "quantity": src.quantity,
                })
                .to_string(),
            ),
            new_values: Some(
                serde_json::json!({
                    "dest_location_id": params.dest_location_id,
                    "moved_quantity": qty,
                })
                .to_string(),
            ),
            changed_fields: vec!["location_id".to_string(), "quantity".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: STOCK MOVE
// ══════════════════════════════════════════════════════════════════════════════

#[reducer]
pub fn create_stock_move(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateStockMoveParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_move", "create")?;

    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    if params.name.is_empty() {
        return Err("Move name cannot be empty".to_string());
    }

    ProcureMethod::from_str(&params.procure_method)?;

    let product_qty = to_product_stock_qty(
        ctx,
        organization_id,
        params.product_id,
        params.product_uom,
        params.product_uom_qty,
    )?;

    let move_record = ctx.db.stock_move().insert(StockMove {
        id: 0,
        organization_id,
        name: Some(params.name.clone()),
        reference: params.reference,
        sequence: params.sequence,
        origin: params.origin,
        note: params.note,
        move_type: params.move_type,
        state: "draft".to_string(),
        priority: params.priority,
        date: params.date,
        date_expected: params.date_expected,
        date_deadline: params.date_deadline,
        product_id: params.product_id,
        product_variant_id: params.product_variant_id,
        product_uom_qty: params.product_uom_qty,
        product_uom: params.product_uom,
        product_qty,
        product_tmpl_id: params.product_tmpl_id,
        location_id: params.location_id,
        location_dest_id: params.location_dest_id,
        partner_id: params.partner_id,
        company_id,
        picking_id: params.picking_id,
        picking_key: params.picking_id.unwrap_or(0),
        picking_type_id: params.picking_type_id,
        origin_returned_move_id: None,
        procure_method: params.procure_method,
        created_purchase_line_id: None,
        price_unit: params.price_unit,
        scrapped: params.scrapped,
        group_id: params.group_id,
        rule_id: params.rule_id,
        propagate_cancel: params.propagate_cancel,
        delay_alert: params.delay_alert,
        picking_type_code: None,
        is_initial_demand_editable: true,
        is_locked: true,
        is_done: false,
        product_packaging_id: params.product_packaging_id,
        product_packaging_qty: params.product_packaging_qty,
        to_refund: params.to_refund,
        warehouse_id: params.warehouse_id,
        production_id: params.production_id,
        raw_material_production_id: params.raw_material_production_id,
        unbuild_id: params.unbuild_id,
        consume_unbuild_id: params.consume_unbuild_id,
        cost_share: params.cost_share,
        is_subcontract: params.is_subcontract,
        purchase_line_id: params.purchase_line_id,
        created_production_id: None,
        need_release: params.need_release,
        release_ready: params.release_ready,
        propagation_cancel: params.propagation_cancel,
        move_dest_ids: vec![],
        move_orig_ids: vec![],
        returned_move_ids: vec![],
        account_move_ids: vec![],
        valuation_line_ids: vec![],
        has_tracking: params.has_tracking,
        quantity_done: 0.0,
        product_uom_qty_done: 0.0,
        inventory_id: params.inventory_id,
        sale_line_id: params.sale_line_id,
        lot_id: params.lot_id,
        serial_id: params.serial_id,
        package_id: params.package_id,
        result_package_id: params.result_package_id,
        owner_id: params.owner_id,
        from_loc: None,
        to_loc: None,
        lots_visible: false,
        show_details_visible: false,
        show_operations: false,
        additional: false,
        has_move_lines: false,
        package_level_id: params.package_level_id,
        product_type: params.product_type,
        is_assigned: false,
        is_waiting: false,
        is_blocked: false,
        is_late: false,
        delay_hours: 0.0,
        delay_days: 0,
        created_uid: ctx.sender(),
        created_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_move",
            record_id: move_record.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": move_record.name,
                    "product_id": move_record.product_id,
                    "product_uom_qty": move_record.product_uom_qty,
                })
                .to_string(),
            ),
            changed_fields: vec!["name".to_string(), "product_uom_qty".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn confirm_stock_move(
    ctx: &ReducerContext,
    organization_id: u64,
    move_id: u64,
    params: CompanyScopeParams,
) -> Result<(), String> {
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    let move_record = ctx
        .db
        .stock_move()
        .id()
        .find(&move_id)
        .ok_or("Move not found")?;

    check_permission(ctx, organization_id, "stock_move", "write")?;

    if move_record.company_id != company_id {
        return Err("Move does not belong to this company".to_string());
    }

    if move_record.state != "draft" {
        return Err("Move must be in draft state to confirm".to_string());
    }

    ctx.db.stock_move().id().update(StockMove {
        state: "confirmed".to_string(),
        is_initial_demand_editable: false,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..move_record.clone()
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_move",
            record_id: move_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": move_record.state }).to_string()),
            new_values: Some(serde_json::json!({ "state": "confirmed" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn assign_stock_move(
    ctx: &ReducerContext,
    organization_id: u64,
    move_id: u64,
    params: CompanyScopeParams,
) -> Result<(), String> {
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    let move_record = ctx
        .db
        .stock_move()
        .id()
        .find(&move_id)
        .ok_or("Move not found")?;

    check_permission(ctx, organization_id, "stock_move", "write")?;

    if move_record.company_id != company_id {
        return Err("Move does not belong to this company".to_string());
    }

    if move_record.state != "confirmed" {
        return Err("Move must be confirmed before assignment".to_string());
    }

    ctx.db.stock_move().id().update(StockMove {
        state: "assigned".to_string(),
        is_assigned: true,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..move_record.clone()
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_move",
            record_id: move_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": move_record.state }).to_string()),
            new_values: Some(serde_json::json!({ "state": "assigned" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn done_stock_move(
    ctx: &ReducerContext,
    organization_id: u64,
    move_id: u64,
    params: DoneStockMoveParams,
) -> Result<(), String> {
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    let move_record = ctx
        .db
        .stock_move()
        .id()
        .find(&move_id)
        .ok_or("Move not found")?;

    check_permission(ctx, organization_id, "stock_move", "write")?;

    if move_record.company_id != company_id {
        return Err("Move does not belong to this company".to_string());
    }

    if move_record.state != "assigned" {
        return Err("Move must be assigned before marking as done".to_string());
    }

    let quantity_done = params.quantity_done;
    if quantity_done < 0.0 {
        return Err("quantity_done cannot be negative".to_string());
    }
    if quantity_done > move_record.product_uom_qty + 1e-9 {
        return Err("quantity_done cannot exceed ordered quantity".to_string());
    }

    // Record demand for validate; keep assigned so validate applies inventory once.
    ctx.db.stock_move().id().update(StockMove {
        quantity_done,
        product_uom_qty_done: quantity_done,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..move_record.clone()
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_move",
            record_id: move_id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({ "quantity_done": move_record.quantity_done }).to_string(),
            ),
            new_values: Some(
                serde_json::json!({ "quantity_done": quantity_done }).to_string(),
            ),
            changed_fields: vec!["quantity_done".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn cancel_stock_move(
    ctx: &ReducerContext,
    organization_id: u64,
    move_id: u64,
    params: CompanyScopeParams,
) -> Result<(), String> {
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    let move_record = ctx
        .db
        .stock_move()
        .id()
        .find(&move_id)
        .ok_or("Move not found")?;

    check_permission(ctx, organization_id, "stock_move", "write")?;

    if move_record.company_id != company_id {
        return Err("Move does not belong to this company".to_string());
    }

    if move_record.state == "done" {
        return Err("Cannot cancel a completed move".to_string());
    }

    ctx.db.stock_move().id().update(StockMove {
        state: "cancel".to_string(),
        is_done: false,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..move_record.clone()
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_move",
            record_id: move_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": move_record.state }).to_string()),
            new_values: Some(serde_json::json!({ "state": "cancel" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: STOCK PICKING
// ══════════════════════════════════════════════════════════════════════════════

#[reducer]
pub fn create_stock_picking(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateStockPickingParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_picking", "create")?;

    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    if params.name.is_empty() {
        return Err("Picking name cannot be empty".to_string());
    }

    let picking = ctx.db.stock_picking().insert(StockPicking {
        id: 0,
        organization_id,
        name: params.name.clone(),
        origin: params.origin,
        note: params.note,
        state: "draft".to_string(),
        priority: params.priority,
        scheduled_date: params.scheduled_date,
        date: params.date,
        date_done: params.date_done,
        move_type: params.move_type,
        company_id,
        user_id: params.user_id,
        partner_id: params.partner_id,
        contact_id: params.contact_id,
        picking_type_id: params.picking_type_id,
        location_id: params.location_id,
        location_dest_id: params.location_dest_id,
        sale_id: params.sale_id,
        purchase_id: params.purchase_id,
        backorder_id: params.backorder_id,
        group_id: params.group_id,
        backorder_ids: params.backorder_ids,
        is_locked: params.is_locked,
        is_printed: params.is_printed,
        is_return: params.is_return,
        has_scrap_move: params.has_scrap_move,
        has_tracking: params.has_tracking,
        immediate_transfer: params.immediate_transfer,
        show_operations: params.show_operations,
        show_lots_text: params.show_lots_text,
        show_reserved: params.show_reserved,
        show_check_availability: params.show_check_availability,
        show_validate: params.show_validate,
        show_mark_as_todo: params.show_mark_as_todo,
        show_set_qty_button: params.show_set_qty_button,
        show_clear_qty_button: params.show_clear_qty_button,
        show_lots_m2o: params.show_lots_m2o,
        product_id: params.product_id,
        lot_id: params.lot_id,
        package_id: params.package_id,
        result_package_id: params.result_package_id,
        owner_id: params.owner_id,
        display_lot_id: params.display_lot_id,
        location_id_name: params.location_id_name,
        location_dest_id_name: params.location_dest_id_name,
        picking_code: params.picking_code,
        product_tracking: params.product_tracking,
        product_barcode: params.product_barcode,
        move_line_exist: params.move_line_exist,
        has_packages: params.has_packages,
        has_move_lines: params.has_move_lines,
        has_package: params.has_package,
        has_lot: params.has_lot,
        has_owner: params.has_owner,
        has_entire_package_src: params.has_entire_package_src,
        has_entire_package_dest: params.has_entire_package_dest,
        package_level_ids: params.package_level_ids,
        batch_id: params.batch_id,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_picking",
            record_id: picking.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": picking.name }).to_string()),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn confirm_stock_picking(
    ctx: &ReducerContext,
    organization_id: u64,
    picking_id: u64,
    params: CompanyScopeParams,
) -> Result<(), String> {
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    let picking = ctx
        .db
        .stock_picking()
        .id()
        .find(&picking_id)
        .ok_or("Picking not found")?;

    check_permission(ctx, organization_id, "stock_picking", "write")?;

    if picking.company_id != company_id {
        return Err("Picking does not belong to this company".to_string());
    }

    if picking.state != "draft" {
        return Err("Picking must be in draft state to confirm".to_string());
    }

    ctx.db.stock_picking().id().update(StockPicking {
        state: "confirmed".to_string(),
        show_mark_as_todo: false,
        show_check_availability: true,
        updated_at: ctx.timestamp,
        ..picking.clone()
    });

    for mut move_record in ctx
        .db
        .stock_move()
        .move_by_picking()
        .filter(&picking_id)
    {
        if move_record.state == "draft" {
            move_record.state = "confirmed".to_string();
            move_record.is_initial_demand_editable = false;
            ctx.db.stock_move().id().update(move_record);
        }
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_picking",
            record_id: picking_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": picking.state }).to_string()),
            new_values: Some(serde_json::json!({ "state": "confirmed" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn assign_stock_picking(
    ctx: &ReducerContext,
    organization_id: u64,
    picking_id: u64,
    params: CompanyScopeParams,
) -> Result<(), String> {
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    let picking = ctx
        .db
        .stock_picking()
        .id()
        .find(&picking_id)
        .ok_or("Picking not found")?;

    check_permission(ctx, organization_id, "stock_picking", "write")?;

    if picking.company_id != company_id {
        return Err("Picking does not belong to this company".to_string());
    }

    if picking.state != "confirmed" {
        return Err("Picking must be confirmed before assignment".to_string());
    }

    ctx.db.stock_picking().id().update(StockPicking {
        state: "assigned".to_string(),
        show_check_availability: false,
        show_validate: true,
        show_reserved: true,
        updated_at: ctx.timestamp,
        ..picking.clone()
    });

    for mut move_record in ctx
        .db
        .stock_move()
        .move_by_picking()
        .filter(&picking_id)
    {
        if move_record.state == "confirmed" {
            move_record.state = "assigned".to_string();
            move_record.is_assigned = true;
            ctx.db.stock_move().id().update(move_record);
        }
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_picking",
            record_id: picking_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": picking.state }).to_string()),
            new_values: Some(serde_json::json!({ "state": "assigned" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn validate_stock_picking(
    ctx: &ReducerContext,
    organization_id: u64,
    picking_id: u64,
    params: CompanyScopeParams,
) -> Result<(), String> {
    validate_stock_picking_impl(ctx, organization_id, picking_id, params, false)
}

/// Validate an assigned picking and create a backorder for undelivered residual quantities.
#[reducer]
pub fn validate_stock_picking_backorder(
    ctx: &ReducerContext,
    organization_id: u64,
    picking_id: u64,
    params: CompanyScopeParams,
) -> Result<(), String> {
    validate_stock_picking_impl(ctx, organization_id, picking_id, params, true)
}

fn validate_stock_picking_impl(
    ctx: &ReducerContext,
    organization_id: u64,
    picking_id: u64,
    params: CompanyScopeParams,
    create_backorder: bool,
) -> Result<(), String> {
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    let picking = ctx
        .db
        .stock_picking()
        .id()
        .find(&picking_id)
        .ok_or("Picking not found")?;

    check_permission(ctx, organization_id, "stock_picking", "write")?;

    if picking.company_id != company_id {
        return Err("Picking does not belong to this company".to_string());
    }

    if picking.state != "assigned" {
        return Err("Picking must be assigned before validation".to_string());
    }

    ensure_picking_tasks_allow_validate(ctx, organization_id, company_id, picking_id)?;
    assert_inventory_writable(ctx, organization_id, company_id)?;

    let is_inbound = picking.is_return
        || picking.picking_code.as_deref() == Some("incoming");
    // PO receipts require explicit `quantity_done` (0 means skip / not received).
    let po_receipt = picking.purchase_id.is_some()
        && picking.picking_code.as_deref() == Some("incoming")
        && !picking.is_return;

    struct ValidatedMove {
        move_id: u64,
        product_id: u64,
        location_id: u64,
        location_dest_id: u64,
        lot_id: Option<u64>,
        serial_id: Option<u64>,
        /// Quantity done in move UoM (for move row bookkeeping).
        qty_done: f64,
        /// Quantity done in product stock UoM (for quant mutations).
        stock_qty_done: f64,
        residual: f64,
        residual_stock: f64,
        product_uom: u64,
        sale_line_id: Option<u64>,
        purchase_line_id: Option<u64>,
        warehouse_id: Option<u64>,
        partner_id: Option<u64>,
        name: Option<String>,
        price_unit: f64,
    }

    let mut validated_moves: Vec<ValidatedMove> = Vec::new();

    for move_record in ctx
        .db
        .stock_move()
        .move_by_picking()
        .filter(&picking_id)
    {
        if move_record.state != "assigned" {
            continue;
        }
        let qty_done = if po_receipt {
            move_record.quantity_done.min(move_record.product_uom_qty).max(0.0)
        } else if move_record.quantity_done > 0.0 {
            move_record.quantity_done.min(move_record.product_uom_qty)
        } else {
            move_record.product_uom_qty
        };
        let residual = (move_record.product_uom_qty - qty_done).max(0.0);
        let stock_qty_done = to_product_stock_qty(
            ctx,
            organization_id,
            move_record.product_id,
            move_record.product_uom,
            qty_done,
        )?;
        let residual_stock = to_product_stock_qty(
            ctx,
            organization_id,
            move_record.product_id,
            move_record.product_uom,
            residual,
        )?;
        validated_moves.push(ValidatedMove {
            move_id: move_record.id,
            product_id: move_record.product_id,
            location_id: move_record.location_id,
            location_dest_id: move_record.location_dest_id,
            lot_id: move_record.lot_id,
            serial_id: move_record.serial_id,
            qty_done,
            stock_qty_done,
            residual,
            residual_stock,
            product_uom: move_record.product_uom,
            sale_line_id: move_record.sale_line_id,
            purchase_line_id: move_record.purchase_line_id,
            warehouse_id: move_record.warehouse_id,
            partner_id: move_record.partner_id,
            name: move_record.name.clone(),
            price_unit: move_record.price_unit,
        });
    }

    // Fail closed on lot/serial tracking before mutating moves or quants.
    for vm in &validated_moves {
        enforce_tracking_on_move_validate(
            ctx,
            organization_id,
            company_id,
            vm.product_id,
            vm.lot_id,
            vm.serial_id,
            vm.location_dest_id,
            vm.stock_qty_done,
            is_inbound,
        )?;
    }

    for vm in &validated_moves {
        if let Some(mv) = ctx.db.stock_move().id().find(&vm.move_id) {
            ctx.db.stock_move().id().update(StockMove {
                state: "done".to_string(),
                is_done: true,
                date: Some(ctx.timestamp),
                quantity_done: vm.qty_done,
                product_uom_qty_done: vm.qty_done,
                product_qty: vm.stock_qty_done,
                product_uom_qty: if create_backorder && vm.residual > 1e-9 {
                    vm.qty_done
                } else {
                    mv.product_uom_qty
                },
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..mv
            });
        }
        if vm.stock_qty_done > 0.0 {
            apply_validated_move_to_quants(
                ctx,
                organization_id,
                company_id,
                vm.product_id,
                vm.location_id,
                vm.location_dest_id,
                vm.stock_qty_done,
                is_inbound,
                vm.price_unit,
            )?;
        }
        if vm.residual_stock > 1e-9 && !create_backorder && !is_inbound {
            if product_requires_stock(ctx, vm.product_id) {
                unreserve_quantity_at_location(
                    ctx,
                    organization_id,
                    company_id,
                    vm.product_id,
                    vm.location_id,
                    vm.residual_stock,
                )?;
            }
        }
    }

    let mut backorder_picking_id: Option<u64> = None;
    if create_backorder && !picking.is_return {
        let residual_moves: Vec<&ValidatedMove> = validated_moves
            .iter()
            .filter(|vm| vm.residual > 1e-9)
            .collect();
        if !residual_moves.is_empty() {
            let bo_name = format!("{}-BO", picking.name);
            create_stock_picking(
                ctx,
                organization_id,
                CreateStockPickingParams {
                    company_id: Some(company_id),
                    name: bo_name.clone(),
                    picking_type_id: picking.picking_type_id,
                    location_id: picking.location_id,
                    location_dest_id: picking.location_dest_id,
                    move_type: picking.move_type.clone(),
                    priority: picking.priority.clone(),
                    partner_id: picking.partner_id,
                    contact_id: picking.contact_id,
                    scheduled_date: Some(ctx.timestamp),
                    origin: picking.origin.clone(),
                    note: picking.note.clone(),
                    user_id: picking.user_id,
                    sale_id: picking.sale_id,
                    purchase_id: picking.purchase_id,
                    group_id: picking.group_id,
                    is_locked: false,
                    immediate_transfer: false,
                    is_printed: false,
                    is_return: false,
                    has_scrap_move: false,
                    has_tracking: picking.has_tracking,
                    date: None,
                    date_done: None,
                    backorder_id: Some(picking_id),
                    backorder_ids: vec![],
                    show_operations: false,
                    show_lots_text: false,
                    show_reserved: true,
                    show_check_availability: true,
                    show_validate: false,
                    show_mark_as_todo: true,
                    show_set_qty_button: false,
                    show_clear_qty_button: false,
                    show_lots_m2o: false,
                    product_id: residual_moves.first().map(|m| m.product_id),
                    lot_id: None,
                    package_id: None,
                    result_package_id: None,
                    owner_id: None,
                    display_lot_id: None,
                    location_id_name: None,
                    location_dest_id_name: None,
                    picking_code: picking.picking_code.clone(),
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
                    metadata: Some(format!(r#"{{"backorder_of":{picking_id}}}"#)),
                },
            )?;

            let bo_picking = ctx
                .db
                .stock_picking()
                .iter()
                .find(|p| {
                    p.organization_id == organization_id
                        && p.backorder_id == Some(picking_id)
                        && p.name == bo_name
                })
                .ok_or("Backorder picking not found after create")?;
            backorder_picking_id = Some(bo_picking.id);

            let bo_move_type = if picking.picking_code.as_deref() == Some("incoming") {
                "incoming".to_string()
            } else {
                "outgoing".to_string()
            };
            for (idx, vm) in residual_moves.iter().enumerate() {
                create_stock_move(
                    ctx,
                    organization_id,
                    CreateStockMoveParams {
                        company_id: Some(company_id),
                        name: vm
                            .name
                            .clone()
                            .unwrap_or_else(|| format!("Backorder {}", vm.product_id)),
                        product_id: vm.product_id,
                        product_tmpl_id: vm.product_id,
                        product_uom: vm.product_uom,
                        product_uom_qty: vm.residual,
                        location_id: vm.location_id,
                        location_dest_id: vm.location_dest_id,
                        date_expected: ctx.timestamp,
                        move_type: bo_move_type.clone(),
                        priority: "1".to_string(),
                        reference: picking.origin.clone(),
                        sequence: ((idx + 1) as i32) * 10,
                        origin: picking.origin.clone(),
                        note: None,
                        date: None,
                        date_deadline: None,
                        picking_id: Some(bo_picking.id),
                        picking_type_id: Some(picking.picking_type_id),
                        partner_id: vm.partner_id,
                        product_variant_id: None,
                        group_id: None,
                        rule_id: None,
                        procure_method: "make_to_stock".to_string(),
                        price_unit: vm.price_unit,
                        scrapped: false,
                        to_refund: false,
                        propagate_cancel: true,
                        delay_alert: false,
                        product_packaging_id: None,
                        product_packaging_qty: 0.0,
                        warehouse_id: vm.warehouse_id,
                        production_id: None,
                        raw_material_production_id: None,
                        unbuild_id: None,
                        consume_unbuild_id: None,
                        cost_share: 0.0,
                        is_subcontract: false,
                        purchase_line_id: vm.purchase_line_id,
                        need_release: false,
                        release_ready: false,
                        propagation_cancel: true,
                        has_tracking: vm.lot_id.is_some(),
                        inventory_id: None,
                        sale_line_id: vm.sale_line_id,
                        lot_id: vm.lot_id,
                        serial_id: vm.serial_id,
                        package_id: None,
                        result_package_id: None,
                        owner_id: None,
                        package_level_id: None,
                        product_type: None,
                        metadata: None,
                    },
                )?;
            }
            // Residual stays reserved from original confirm.
        }
    }

    let mut backorder_ids = picking.backorder_ids.clone();
    if let Some(bo_id) = backorder_picking_id {
        if !backorder_ids.contains(&bo_id) {
            backorder_ids.push(bo_id);
        }
    }

    ctx.db.stock_picking().id().update(StockPicking {
        state: "done".to_string(),
        date_done: Some(ctx.timestamp),
        show_validate: false,
        backorder_ids,
        updated_at: ctx.timestamp,
        ..picking.clone()
    });

    // Propagate delivered quantities back to SaleOrderLine
    if picking.is_return {
        let mut returned: std::collections::HashMap<u64, f64> = std::collections::HashMap::new();
        for move_record in ctx
            .db
            .stock_move()
            .move_by_picking()
            .filter(&picking_id)
        {
            if !move_record.is_done {
                continue;
            }
            if let Some(sl_id) = move_record.sale_line_id {
                *returned.entry(sl_id).or_default() += move_record.quantity_done;
            }
        }

        for (sl_id, qty_returned) in &returned {
            if let Some(sol) = ctx.db.sale_order_line().id().find(sl_id) {
                let new_qty_delivered = (sol.qty_delivered - qty_returned).max(0.0);
                let new_qty_to_invoice = if sol.qty_invoiced > new_qty_delivered {
                    sol.qty_invoiced - new_qty_delivered
                } else {
                    0.0
                };
                ctx.db
                    .sale_order_line()
                    .id()
                    .update(crate::sales::sales_core::SaleOrderLine {
                        qty_delivered: new_qty_delivered,
                        is_delivered: new_qty_delivered >= sol.product_uom_qty,
                        qty_to_invoice: new_qty_to_invoice,
                        invoice_status: if new_qty_to_invoice > 0.0 {
                            LineInvoiceStatus::ToInvoice
                        } else {
                            sol.invoice_status.clone()
                        },
                        write_uid: ctx.sender(),
                        write_date: ctx.timestamp,
                        ..sol
                    });
            }
        }

        for mut return_order in ctx.db.return_order().iter() {
            if return_order.organization_id != picking.organization_id
                || return_order.company_id != company_id
            {
                continue;
            }
            if return_order.picking_id != Some(picking_id) {
                continue;
            }
            if return_order.state == "confirmed" {
                return_order.state = "received".to_string();
                return_order.write_uid = ctx.sender();
                return_order.write_date = ctx.timestamp;
                let ro_id = return_order.id;
                ctx.db.return_order().id().update(return_order);
                write_audit_log_v2(
                    ctx,
                    organization_id,
                    AuditLogParams {
                        company_id: Some(company_id),
                        table_name: "return_order",
                        record_id: ro_id,
                        action: "UPDATE",
                        old_values: Some(serde_json::json!({ "state": "confirmed" }).to_string()),
                        new_values: Some(serde_json::json!({ "state": "received" }).to_string()),
                        changed_fields: vec!["state".to_string()],
                        metadata: None,
                    },
                );
            }
        }
    } else if let Some(so_id) = picking.sale_id {
        // Collect qty_done per sale_line_id
        let mut delivered: std::collections::HashMap<u64, f64> = std::collections::HashMap::new();
        for move_record in ctx
            .db
            .stock_move()
            .move_by_picking()
            .filter(&picking_id)
        {
            if !move_record.is_done {
                continue;
            }
            if let Some(sl_id) = move_record.sale_line_id {
                *delivered.entry(sl_id).or_default() += move_record.quantity_done;
            }
        }

        for (sl_id, qty_done) in &delivered {
            if let Some(sol) = ctx.db.sale_order_line().id().find(sl_id) {
                let new_qty_delivered = sol.qty_delivered + qty_done;
                let new_qty_to_invoice = (new_qty_delivered - sol.qty_invoiced).max(0.0);
                let new_line_status = if new_qty_delivered >= sol.product_uom_qty {
                    LineInvoiceStatus::ToInvoice
                } else {
                    sol.invoice_status.clone()
                };

                ctx.db
                    .sale_order_line()
                    .id()
                    .update(crate::sales::sales_core::SaleOrderLine {
                        qty_delivered: new_qty_delivered,
                        is_delivered: new_qty_delivered >= sol.product_uom_qty,
                        qty_to_invoice: new_qty_to_invoice,
                        invoice_status: new_line_status,
                        write_uid: ctx.sender(),
                        write_date: ctx.timestamp,
                        ..sol
                    });
            }
        }

        // If all lines have qty_to_invoice > 0, mark SO as ToInvoice
        if !delivered.is_empty() {
            let all_to_invoice = ctx
                .db
                .sale_order_line()
                .order_line_by_order()
                .filter(&so_id)
                .all(|l| l.qty_to_invoice > 0.0 || l.invoice_status == LineInvoiceStatus::Invoiced);

            if all_to_invoice {
                if let Some(so) = ctx.db.sale_order().id().find(&so_id) {
                    if so.invoice_status != InvoiceStatus::Invoiced {
                        ctx.db
                            .sale_order()
                            .id()
                            .update(crate::sales::sales_core::SaleOrder {
                                invoice_status: InvoiceStatus::ToInvoice,
                                write_uid: ctx.sender(),
                                write_date: ctx.timestamp,
                                ..so
                            });
                    }
                }
            }
        }
    } else if let Some(po_id) = picking.purchase_id {
        let mut received: std::collections::HashMap<u64, f64> = std::collections::HashMap::new();
        for move_record in ctx
            .db
            .stock_move()
            .move_by_picking()
            .filter(&picking_id)
        {
            if !move_record.is_done {
                continue;
            }
            if let Some(pl_id) = move_record.purchase_line_id {
                *received.entry(pl_id).or_default() += move_record.quantity_done;
            }
        }

        for (pl_id, qty_done) in &received {
            if *qty_done <= 0.0 {
                continue;
            }
            if let Some(pol) = ctx.db.purchase_order_line().id().find(pl_id) {
                let new_qty_received = (pol.qty_received + qty_done).min(pol.product_qty);
                let updated = crate::purchasing::purchase_orders::PurchaseOrderLine {
                    qty_received: new_qty_received,
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..pol
                };
                if let Some(order) = ctx.db.purchase_order().id().find(&updated.order_id) {
                    crate::purchasing::purchase_orders::persist_line_match_state(
                        ctx, &order, updated,
                    );
                } else {
                    ctx.db.purchase_order_line().id().update(updated);
                }
            }
        }

        if !received.is_empty() {
            let _ = crate::purchasing::purchase_orders::update_po_receipt_status(
                ctx,
                organization_id,
                po_id,
            );
            let _ = crate::purchasing::purchase_orders::compute_purchase_order_totals(
                ctx,
                organization_id,
                po_id,
            );
            if let Some(bo_id) = backorder_picking_id {
                if let Some(po) = ctx.db.purchase_order().id().find(&po_id) {
                    let mut picking_ids = po.picking_ids.clone();
                    if !picking_ids.contains(&bo_id) {
                        picking_ids.push(bo_id);
                        ctx.db.purchase_order().id().update(
                            crate::purchasing::purchase_orders::PurchaseOrder {
                                picking_ids: picking_ids.clone(),
                                picking_count: picking_ids.len() as u32,
                                write_uid: ctx.sender(),
                                write_date: ctx.timestamp,
                                ..po
                            },
                        );
                    }
                }
            }
        }
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_picking",
            record_id: picking_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": picking.state }).to_string()),
            new_values: Some(serde_json::json!({ "state": "done" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn cancel_stock_picking(
    ctx: &ReducerContext,
    organization_id: u64,
    picking_id: u64,
    params: CompanyScopeParams,
) -> Result<(), String> {
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    let picking = ctx
        .db
        .stock_picking()
        .id()
        .find(&picking_id)
        .ok_or("Picking not found")?;

    check_permission(ctx, organization_id, "stock_picking", "write")?;

    if picking.company_id != company_id {
        return Err("Picking does not belong to this company".to_string());
    }

    if picking.state == "done" {
        return Err("Cannot cancel a completed picking".to_string());
    }

    ctx.db.stock_picking().id().update(StockPicking {
        state: "cancel".to_string(),
        updated_at: ctx.timestamp,
        ..picking.clone()
    });

    for mut move_record in ctx
        .db
        .stock_move()
        .move_by_picking()
        .filter(&picking_id)
    {
        if move_record.state != "done" {
            move_record.state = "cancel".to_string();
            ctx.db.stock_move().id().update(move_record);
        }
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_picking",
            record_id: picking_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": picking.state }).to_string()),
            new_values: Some(serde_json::json!({ "state": "cancel" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn assign_user_to_picking(
    ctx: &ReducerContext,
    organization_id: u64,
    picking_id: u64,
    params: AssignUserToPickingParams,
) -> Result<(), String> {
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    let picking = ctx
        .db
        .stock_picking()
        .id()
        .find(&picking_id)
        .ok_or("Picking not found")?;

    check_permission(ctx, organization_id, "stock_picking", "write")?;

    if picking.company_id != company_id {
        return Err("Picking does not belong to this company".to_string());
    }

    let user_id = params.user_id;

    ctx.db.stock_picking().id().update(StockPicking {
        user_id,
        updated_at: ctx.timestamp,
        ..picking.clone()
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_picking",
            record_id: picking_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["user_id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
