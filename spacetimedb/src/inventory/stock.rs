/// Stock Management — Tables and Reducers
///
/// Tables:
///   - StockQuant
///   - StockMove
///   - StockMoveLine
///   - StockPicking
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};
use serde_json;

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.11: STOCK QUANT
// ══════════════════════════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: STOCK QUANT
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_stock_quant(
    ctx: &ReducerContext,
    organization_id: u64,
    product_id: u64,
    location_id: u64,
    company_id: u64,
    quantity: f64,
    cost: f64,
    lot_id: Option<u64>,
    package_id: Option<u64>,
    owner_id: Option<u64>,
    product_variant_id: Option<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_quant", "create")?;

    let value = quantity * cost;

    let quant = ctx.db.stock_quant().insert(StockQuant {
        id: 0,
        organization_id,
        product_id,
        product_variant_id,
        location_id,
        lot_id,
        package_id,
        owner_id,
        company_id,
        quantity,
        reserved_quantity: 0.0,
        available_quantity: quantity,
        in_date: Some(ctx.timestamp),
        inventory_quantity: quantity,
        inventory_diff_quantity: 0.0,
        inventory_quantity_set: false,
        is_outdated: false,
        user_id: None,
        inventory_date: None,
        cost,
        value,
        cost_method: None,
        accounting_date: None,
        currency_id: None,
        accounting_entry_ids: vec![],
        metadata: None,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "stock_quant",
        quant.id,
        "create",
        None,
        Some(serde_json::json!({ "product_id": product_id, "location_id": location_id, "quantity": quantity }).to_string()),
        vec!["quantity".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_stock_quant_quantity(
    ctx: &ReducerContext,
    quant_id: u64,
    quantity: f64,
) -> Result<(), String> {
    let quant = ctx
        .db
        .stock_quant()
        .id()
        .find(&quant_id)
        .ok_or("Quant not found")?;

    check_permission(ctx, quant.organization_id, "stock_quant", "write")?;

    let available_quantity = quantity - quant.reserved_quantity;
    let value = quantity * quant.cost;

    ctx.db.stock_quant().id().update(StockQuant {
        quantity,
        available_quantity,
        value,
        ..quant
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn reserve_stock_quant(
    ctx: &ReducerContext,
    quant_id: u64,
    reserve_qty: f64,
) -> Result<(), String> {
    let quant = ctx
        .db
        .stock_quant()
        .id()
        .find(&quant_id)
        .ok_or("Quant not found")?;

    check_permission(ctx, quant.organization_id, "stock_quant", "write")?;

    let new_reserved = quant.reserved_quantity + reserve_qty;
    if new_reserved > quant.quantity {
        return Err("Cannot reserve more than available quantity".to_string());
    }

    let available_quantity = quant.quantity - new_reserved;

    ctx.db.stock_quant().id().update(StockQuant {
        reserved_quantity: new_reserved,
        available_quantity,
        ..quant
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn unreserve_stock_quant(
    ctx: &ReducerContext,
    quant_id: u64,
    unreserve_qty: f64,
) -> Result<(), String> {
    let quant = ctx
        .db
        .stock_quant()
        .id()
        .find(&quant_id)
        .ok_or("Quant not found")?;

    check_permission(ctx, quant.organization_id, "stock_quant", "write")?;

    let new_reserved = (quant.reserved_quantity - unreserve_qty).max(0.0);
    let available_quantity = quant.quantity - new_reserved;

    ctx.db.stock_quant().id().update(StockQuant {
        reserved_quantity: new_reserved,
        available_quantity,
        ..quant
    });

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: STOCK MOVE
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_stock_move(
    ctx: &ReducerContext,
    organization_id: u64,
    product_id: u64,
    product_tmpl_id: u64,
    name: String,
    location_id: u64,
    location_dest_id: u64,
    product_uom_qty: f64,
    product_uom: u64,
    company_id: u64,
    date_expected: Timestamp,
    move_type: String,
    picking_id: Option<u64>,
    picking_type_id: Option<u64>,
    partner_id: Option<u64>,
    product_variant_id: Option<u64>,
    // Reference and origin information
    reference: Option<String>,
    origin: Option<String>,
    note: Option<String>,
    // Date information
    date: Option<Timestamp>,
    date_deadline: Option<Timestamp>,
    // Procurement information
    group_id: Option<u64>,
    rule_id: Option<u64>,
    // Packaging information
    product_packaging_id: Option<u64>,
    // Production information
    warehouse_id: Option<u64>,
    production_id: Option<u64>,
    // Inventory tracking
    lot_id: Option<u64>,
    package_id: Option<u64>,
    result_package_id: Option<u64>,
    owner_id: Option<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_move", "create")?;

    if name.is_empty() {
        return Err("Move name cannot be empty".to_string());
    }

    let move_record = ctx.db.stock_move().insert(StockMove {
        id: 0,
        organization_id,
        name: Some(name.clone()),
        reference,
        sequence: 10,
        origin,
        note,
        move_type,
        state: "draft".to_string(),
        priority: "normal".to_string(),
        date,
        date_expected,
        date_deadline,
        product_id,
        product_variant_id,
        product_uom_qty,
        product_uom,
        product_qty: product_uom_qty,
        product_tmpl_id,
        location_id,
        location_dest_id,
        partner_id,
        company_id,
        picking_id,
        picking_type_id,
        origin_returned_move_id: None,
        procure_method: "make_to_stock".to_string(),
        created_purchase_line_id: None,
        price_unit: 0.0,
        scrapped: false,
        group_id,
        rule_id,
        propagate_cancel: true,
        delay_alert: false,
        picking_type_code: None,
        is_initial_demand_editable: true,
        is_locked: true,
        is_done: false,
        product_packaging_id,
        product_packaging_qty: 0.0,
        to_refund: false,
        warehouse_id,
        production_id,
        raw_material_production_id: None,
        unbuild_id: None,
        consume_unbuild_id: None,
        cost_share: 0.0,
        is_subcontract: false,
        purchase_line_id: None,
        created_production_id: None,
        need_release: false,
        release_ready: false,
        propagation_cancel: false,
        move_dest_ids: vec![],
        move_orig_ids: vec![],
        returned_move_ids: vec![],
        account_move_ids: vec![],
        valuation_line_ids: vec![],
        has_tracking: false,
        quantity_done: 0.0,
        product_uom_qty_done: 0.0,
        inventory_id: None,
        sale_line_id: None,
        lot_id,
        package_id,
        result_package_id,
        owner_id,
        from_loc: None,
        to_loc: None,
        lots_visible: false,
        show_details_visible: false,
        show_operations: false,
        additional: false,
        has_move_lines: false,
        package_level_id: None,
        product_type: None,
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
        metadata: None,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "stock_move",
        move_record.id,
        "create",
        None,
        Some(
            serde_json::json!({ "name": name, "product_id": product_id, "qty": product_uom_qty })
                .to_string(),
        ),
        vec!["name".to_string(), "product_uom_qty".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn confirm_stock_move(ctx: &ReducerContext, move_id: u64) -> Result<(), String> {
    let move_record = ctx
        .db
        .stock_move()
        .id()
        .find(&move_id)
        .ok_or("Move not found")?;

    check_permission(ctx, move_record.organization_id, "stock_move", "write")?;

    if move_record.state != "draft" {
        return Err("Move must be in draft state to confirm".to_string());
    }

    ctx.db.stock_move().id().update(StockMove {
        state: "confirmed".to_string(),
        is_initial_demand_editable: false,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..move_record
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn assign_stock_move(ctx: &ReducerContext, move_id: u64) -> Result<(), String> {
    let move_record = ctx
        .db
        .stock_move()
        .id()
        .find(&move_id)
        .ok_or("Move not found")?;

    check_permission(ctx, move_record.organization_id, "stock_move", "write")?;

    if move_record.state != "confirmed" {
        return Err("Move must be confirmed before assignment".to_string());
    }

    ctx.db.stock_move().id().update(StockMove {
        state: "assigned".to_string(),
        is_assigned: true,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..move_record
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn done_stock_move(
    ctx: &ReducerContext,
    move_id: u64,
    quantity_done: f64,
) -> Result<(), String> {
    let move_record = ctx
        .db
        .stock_move()
        .id()
        .find(&move_id)
        .ok_or("Move not found")?;

    check_permission(ctx, move_record.organization_id, "stock_move", "write")?;

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
        ..move_record
    });

    write_audit_log(
        ctx,
        move_record.organization_id,
        Some(move_record.company_id),
        "stock_move",
        move_id,
        "done",
        Some(serde_json::json!({ "state": move_record.state }).to_string()),
        Some(serde_json::json!({ "state": "done", "quantity_done": quantity_done }).to_string()),
        vec!["state".to_string(), "quantity_done".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn cancel_stock_move(ctx: &ReducerContext, move_id: u64) -> Result<(), String> {
    let move_record = ctx
        .db
        .stock_move()
        .id()
        .find(&move_id)
        .ok_or("Move not found")?;

    check_permission(ctx, move_record.organization_id, "stock_move", "write")?;

    if move_record.state == "done" {
        return Err("Cannot cancel a completed move".to_string());
    }

    ctx.db.stock_move().id().update(StockMove {
        state: "cancel".to_string(),
        is_done: false,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..move_record
    });

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: STOCK PICKING
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_stock_picking(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    picking_type_id: u64,
    location_id: u64,
    location_dest_id: u64,
    company_id: u64,
    partner_id: Option<u64>,
    contact_id: Option<u64>,
    scheduled_date: Option<Timestamp>,
    origin: Option<String>,
    move_type: String,
    priority: String,
    // Additional picking details
    note: Option<String>,
    user_id: Option<Identity>,
    // Reference IDs
    sale_id: Option<u64>,
    purchase_id: Option<u64>,
    group_id: Option<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_picking", "create")?;

    if name.is_empty() {
        return Err("Picking name cannot be empty".to_string());
    }

    let picking = ctx.db.stock_picking().insert(StockPicking {
        id: 0,
        organization_id,
        name: name.clone(),
        origin,
        note,
        state: "draft".to_string(),
        priority,
        scheduled_date,
        date: None,
        date_done: None,
        move_type,
        company_id,
        user_id,
        partner_id,
        contact_id,
        picking_type_id,
        location_id,
        location_dest_id,
        sale_id,
        purchase_id,
        backorder_id: None,
        group_id,
        backorder_ids: vec![],
        is_locked: true,
        is_printed: false,
        is_return: false,
        has_scrap_move: false,
        has_tracking: false,
        immediate_transfer: false,
        show_operations: false,
        show_lots_text: false,
        show_reserved: false,
        show_check_availability: true,
        show_validate: false,
        show_mark_as_todo: true,
        show_set_qty_button: true,
        show_clear_qty_button: false,
        show_lots_m2o: false,
        product_id: None,
        lot_id: None,
        package_id: None,
        result_package_id: None,
        owner_id: None,
        display_lot_id: None,
        location_id_name: None,
        location_dest_id_name: None,
        picking_code: None,
        product_tracking: None,
        product_barcode: None,
        move_line_exist: false,
        has_packages: false,
        has_move_lines: false,
        has_package: false,
        has_lot: false,
        has_owner: false,
        has_entire_package_src: false,
        has_entire_package_dest: false,
        package_level_ids: vec![],
        batch_id: None,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: None,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "stock_picking",
        picking.id,
        "create",
        None,
        Some(serde_json::json!({ "name": name }).to_string()),
        vec!["name".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn confirm_stock_picking(ctx: &ReducerContext, picking_id: u64) -> Result<(), String> {
    let picking = ctx
        .db
        .stock_picking()
        .id()
        .find(&picking_id)
        .ok_or("Picking not found")?;

    check_permission(ctx, picking.organization_id, "stock_picking", "write")?;

    if picking.state != "draft" {
        return Err("Picking must be in draft state to confirm".to_string());
    }

    ctx.db.stock_picking().id().update(StockPicking {
        state: "confirmed".to_string(),
        show_mark_as_todo: false,
        show_check_availability: true,
        updated_at: ctx.timestamp,
        ..picking
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

    Ok(())
}

#[spacetimedb::reducer]
pub fn assign_stock_picking(ctx: &ReducerContext, picking_id: u64) -> Result<(), String> {
    let picking = ctx
        .db
        .stock_picking()
        .id()
        .find(&picking_id)
        .ok_or("Picking not found")?;

    check_permission(ctx, picking.organization_id, "stock_picking", "write")?;

    if picking.state != "confirmed" {
        return Err("Picking must be confirmed before assignment".to_string());
    }

    ctx.db.stock_picking().id().update(StockPicking {
        state: "assigned".to_string(),
        show_check_availability: false,
        show_validate: true,
        show_reserved: true,
        updated_at: ctx.timestamp,
        ..picking
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

    Ok(())
}

#[spacetimedb::reducer]
pub fn validate_stock_picking(ctx: &ReducerContext, picking_id: u64) -> Result<(), String> {
    let picking = ctx
        .db
        .stock_picking()
        .id()
        .find(&picking_id)
        .ok_or("Picking not found")?;

    check_permission(ctx, picking.organization_id, "stock_picking", "write")?;

    if picking.state != "assigned" {
        return Err("Picking must be assigned before validation".to_string());
    }

    ctx.db.stock_picking().id().update(StockPicking {
        state: "done".to_string(),
        date_done: Some(ctx.timestamp),
        show_validate: false,
        updated_at: ctx.timestamp,
        ..picking
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

    write_audit_log(
        ctx,
        picking.organization_id,
        Some(picking.company_id),
        "stock_picking",
        picking_id,
        "validate",
        Some(serde_json::json!({ "state": picking.state }).to_string()),
        Some(serde_json::json!({ "state": "done" }).to_string()),
        vec!["state".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn cancel_stock_picking(ctx: &ReducerContext, picking_id: u64) -> Result<(), String> {
    let picking = ctx
        .db
        .stock_picking()
        .id()
        .find(&picking_id)
        .ok_or("Picking not found")?;

    check_permission(ctx, picking.organization_id, "stock_picking", "write")?;

    if picking.state == "done" {
        return Err("Cannot cancel a completed picking".to_string());
    }

    ctx.db.stock_picking().id().update(StockPicking {
        state: "cancel".to_string(),
        updated_at: ctx.timestamp,
        ..picking
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

    Ok(())
}

#[spacetimedb::reducer]
pub fn assign_user_to_picking(
    ctx: &ReducerContext,
    picking_id: u64,
    user_id: Option<Identity>,
) -> Result<(), String> {
    let picking = ctx
        .db
        .stock_picking()
        .id()
        .find(&picking_id)
        .ok_or("Picking not found")?;

    check_permission(ctx, picking.organization_id, "stock_picking", "write")?;

    ctx.db.stock_picking().id().update(StockPicking {
        user_id,
        updated_at: ctx.timestamp,
        ..picking
    });

    Ok(())
}
