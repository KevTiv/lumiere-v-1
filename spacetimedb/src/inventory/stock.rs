/// Stock Management — Tables and Reducers
///
/// Tables:
///   - StockQuant
///   - StockMove
///   - StockMoveLine
///   - StockPicking
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
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
    index(accessor = move_by_picking, btree(columns = [picking_id])),
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
    pub package_id: Option<u64>,
    pub result_package_id: Option<u64>,
    pub owner_id: Option<u64>,
    pub package_level_id: Option<u64>,
    pub product_type: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateStockPickingParams {
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

// ── Reducers ─────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: STOCK QUANT
// ══════════════════════════════════════════════════════════════════════════════

#[reducer]
pub fn create_stock_quant(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateStockQuantParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_quant", "create")?;

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
    company_id: u64,
    quant_id: u64,
    quantity: f64,
) -> Result<(), String> {
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
            old_values: Some(
                serde_json::json!({ "quantity": quant.quantity }).to_string(),
            ),
            new_values: Some(
                serde_json::json!({ "quantity": quantity }).to_string(),
            ),
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
    company_id: u64,
    quant_id: u64,
    reserve_qty: f64,
) -> Result<(), String> {
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

    let new_reserved = quant.reserved_quantity + reserve_qty;
    if new_reserved > quant.quantity {
        return Err("Cannot reserve more than available quantity".to_string());
    }

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
            new_values: Some(
                serde_json::json!({ "reserved_quantity": new_reserved }).to_string(),
            ),
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
    company_id: u64,
    quant_id: u64,
    unreserve_qty: f64,
) -> Result<(), String> {
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
            new_values: Some(
                serde_json::json!({ "reserved_quantity": new_reserved }).to_string(),
            ),
            changed_fields: vec!["reserved_quantity".to_string()],
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
    company_id: u64,
    params: CreateStockMoveParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_move", "create")?;

    if params.name.is_empty() {
        return Err("Move name cannot be empty".to_string());
    }

    ProcureMethod::from_str(&params.procure_method)?;

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
        product_qty: params.product_uom_qty,
        product_tmpl_id: params.product_tmpl_id,
        location_id: params.location_id,
        location_dest_id: params.location_dest_id,
        partner_id: params.partner_id,
        company_id,
        picking_id: params.picking_id,
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
    company_id: u64,
    move_id: u64,
) -> Result<(), String> {
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
    company_id: u64,
    move_id: u64,
) -> Result<(), String> {
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
    company_id: u64,
    move_id: u64,
    quantity_done: f64,
) -> Result<(), String> {
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

    ctx.db.stock_move().id().update(StockMove {
        state: "done".to_string(),
        is_done: true,
        quantity_done,
        product_uom_qty_done: quantity_done,
        date: Some(ctx.timestamp),
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
            new_values: Some(
                serde_json::json!({ "state": "done", "quantity_done": quantity_done }).to_string(),
            ),
            changed_fields: vec!["state".to_string(), "quantity_done".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn cancel_stock_move(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    move_id: u64,
) -> Result<(), String> {
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
    company_id: u64,
    params: CreateStockPickingParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_picking", "create")?;

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
    company_id: u64,
    picking_id: u64,
) -> Result<(), String> {
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
        .move_by_org()
        .filter(&picking.organization_id)
    {
        if move_record.picking_id != Some(picking_id) {
            continue;
        }
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
    company_id: u64,
    picking_id: u64,
) -> Result<(), String> {
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
        .move_by_org()
        .filter(&picking.organization_id)
    {
        if move_record.picking_id != Some(picking_id) {
            continue;
        }
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
    company_id: u64,
    picking_id: u64,
) -> Result<(), String> {
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

    ctx.db.stock_picking().id().update(StockPicking {
        state: "done".to_string(),
        date_done: Some(ctx.timestamp),
        show_validate: false,
        updated_at: ctx.timestamp,
        ..picking.clone()
    });

    for mut move_record in ctx
        .db
        .stock_move()
        .move_by_org()
        .filter(&picking.organization_id)
    {
        if move_record.picking_id != Some(picking_id) {
            continue;
        }
        if move_record.state == "assigned" {
            move_record.state = "done".to_string();
            move_record.is_done = true;
            move_record.date = Some(ctx.timestamp);
            move_record.quantity_done = move_record.product_uom_qty;
            ctx.db.stock_move().id().update(move_record);
        }
    }

    // Propagate delivered quantities back to SaleOrderLine
    if let Some(so_id) = picking.sale_id {
        // Collect qty_done per sale_line_id
        let mut delivered: std::collections::HashMap<u64, f64> =
            std::collections::HashMap::new();
        for move_record in ctx
            .db
            .stock_move()
            .move_by_org()
            .filter(&picking.organization_id)
        {
            if move_record.picking_id != Some(picking_id) || !move_record.is_done {
                continue;
            }
            if let Some(sl_id) = move_record.sale_line_id {
                *delivered.entry(sl_id).or_default() +=
                    move_record.quantity_done;
            }
        }

        for (sl_id, qty_done) in &delivered {
            if let Some(sol) = ctx.db.sale_order_line().id().find(sl_id) {
                let new_qty_delivered = sol.qty_delivered + qty_done;
                let new_qty_to_invoice =
                    (sol.product_uom_qty - sol.qty_invoiced - new_qty_delivered).max(0.0);
                let new_line_status = if new_qty_delivered >= sol.product_uom_qty {
                    LineInvoiceStatus::ToInvoice
                } else {
                    sol.invoice_status.clone()
                };

                ctx.db.sale_order_line().id().update(
                    crate::sales::sales_core::SaleOrderLine {
                        qty_delivered: new_qty_delivered,
                        is_delivered: new_qty_delivered >= sol.product_uom_qty,
                        qty_to_invoice: new_qty_to_invoice,
                        invoice_status: new_line_status,
                        write_uid: ctx.sender(),
                        write_date: ctx.timestamp,
                        ..sol
                    },
                );
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
                        ctx.db.sale_order().id().update(
                            crate::sales::sales_core::SaleOrder {
                                invoice_status: InvoiceStatus::ToInvoice,
                                write_uid: ctx.sender(),
                                write_date: ctx.timestamp,
                                ..so
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
    company_id: u64,
    picking_id: u64,
) -> Result<(), String> {
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
        .move_by_org()
        .filter(&picking.organization_id)
    {
        if move_record.picking_id != Some(picking_id) {
            continue;
        }
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
    company_id: u64,
    picking_id: u64,
    user_id: Option<Identity>,
) -> Result<(), String> {
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
