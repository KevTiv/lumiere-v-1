/// Inventory Adjustments — Core Tables and Reducers
///
/// Tables:
///   - StockInventory
///   - StockInventoryLine
///   - InventoryAdjustment
///   - AdjustmentReason
///   - StockCountSheet
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};
use serde_json;

/// Stock Inventory
#[spacetimedb::table(
    accessor = stock_inventory,
    public,
    index(accessor = inventory_by_org, btree(columns = [organization_id])),
    index(accessor = inventory_by_state, btree(columns = [state])),
    index(accessor = inventory_by_date, btree(columns = [date]))
)]
pub struct StockInventory {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub state: String,
    pub location_ids: Vec<u64>,
    pub product_ids: Vec<u64>,
    pub lot_ids: Vec<u64>,
    pub owner_ids: Vec<u64>,
    pub package_ids: Vec<u64>,
    pub company_id: u64,
    pub date: Timestamp,
    pub accounting_date: Option<Timestamp>,
    pub done_move_ids: Vec<u64>,
    pub move_ids: Vec<u64>,
    pub adjustment_count: i32,
    pub category_id: Option<u64>,
    pub has_account_moves: bool,
    pub exhausted: bool,
    pub prefilled_count: i32,
    pub counted_mode: String,
    pub started: bool,
    pub is_editable: bool,
    pub is_stock_check: bool,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: Option<String>,
}

/// Stock Inventory Line
#[spacetimedb::table(
    accessor = stock_inventory_line,
    public,
    index(accessor = inventory_line_by_org, btree(columns = [organization_id])),
    index(accessor = inventory_line_by_inventory, btree(columns = [inventory_id])),
    index(accessor = inventory_line_by_product, btree(columns = [product_id]))
)]
pub struct StockInventoryLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub inventory_id: u64,
    pub product_id: u64,
    pub product_variant_id: Option<u64>,
    pub product_uom_id: u64,
    pub location_id: u64,
    pub location_name: Option<String>,
    pub prod_lot_id: Option<u64>,
    pub package_id: Option<u64>,
    pub partner_id: Option<u64>,
    pub company_id: u64,
    pub theoretical_qty: f64,
    pub product_qty: f64,
    pub inventory_location_id: Option<u64>,
    pub inventory_product_id: Option<u64>,
    pub inventory_prod_lot_id: Option<u64>,
    pub inventory_package_id: Option<u64>,
    pub inventory_partner_id: Option<u64>,
    pub package_level_id: Option<u64>,
    pub package_level_id_visible: bool,
    pub state: String,
    pub product_tracking: String,
    pub product_barcode: Option<String>,
    pub product_type: String,
    pub is_editable: bool,
    pub outdated: bool,
    pub inventory_location_id_name: Option<String>,
    pub inventory_product_id_name: Option<String>,
    pub theoretical_qty_text: Option<String>,
    pub product_uom_category_id: Option<u64>,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: Option<String>,
}

/// Inventory Adjustment
#[spacetimedb::table(
    accessor = inventory_adjustment,
    public,
    index(accessor = adjustment_by_org, btree(columns = [organization_id])),
    index(accessor = adjustment_by_state, btree(columns = [state])),
    index(accessor = adjustment_by_product, btree(columns = [product_id]))
)]
pub struct InventoryAdjustment {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub state: String,
    pub adjustment_type: String,
    pub inventory_id: Option<u64>,
    pub product_id: u64,
    pub location_id: u64,
    pub lot_id: Option<u64>,
    pub package_id: Option<u64>,
    pub quantity_before: f64,
    pub quantity_after: f64,
    pub difference: f64,
    pub uom_id: u64,
    pub unit_cost: f64,
    pub total_value: f64,
    pub reason_code: String,
    pub reason_notes: Option<String>,
    pub requested_by: Option<Identity>,
    pub approved_by: Option<Identity>,
    pub posted_by: Option<Identity>,
    pub move_id: Option<u64>,
    pub accounting_entry_id: Option<u64>,
    pub created_at: Timestamp,
    pub approved_at: Option<Timestamp>,
    pub posted_at: Option<Timestamp>,
    pub metadata: Option<String>,
}

/// Adjustment Reason
#[spacetimedb::table(
    accessor = adjustment_reason,
    public,
    index(accessor = reason_by_org, btree(columns = [organization_id])),
    index(accessor = reason_by_code, btree(columns = [code]))
)]
pub struct AdjustmentReason {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub code: String,
    pub description: Option<String>,
    pub is_active: bool,
    pub is_system: bool,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

/// Create a new stock inventory
pub fn create_stock_inventory(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    location_ids: Vec<u64>,
    product_ids: Vec<u64>,
    company_id: u64,
    lot_ids: Vec<u64>,
    owner_ids: Vec<u64>,
    package_ids: Vec<u64>,
    state: String,
    accounting_date: Option<Timestamp>,
    category_id: Option<u64>,
    counted_mode: String,
    done_move_ids: Vec<u64>,
    move_ids: Vec<u64>,
    adjustment_count: i32,
    has_account_moves: bool,
    exhausted: bool,
    prefilled_count: i32,
    started: bool,
    is_editable: bool,
    is_stock_check: bool,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_inventory", "create")?;

    if name.is_empty() {
        return Err("Inventory name cannot be empty".to_string());
    }

    let state_clone = state.clone();
    let location_ids_clone = location_ids.clone();
    let product_ids_clone = product_ids.clone();

    let inventory = ctx.db.stock_inventory().insert(StockInventory {
        id: 0,
        organization_id,
        name: name.clone(),
        state,
        location_ids,
        product_ids,
        lot_ids,
        owner_ids,
        package_ids,
        company_id,
        date: ctx.timestamp,
        accounting_date,
        done_move_ids,
        move_ids,
        adjustment_count,
        category_id,
        has_account_moves,
        exhausted,
        prefilled_count,
        counted_mode,
        started,
        is_editable,
        is_stock_check,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata,
    });

    write_audit_log(
        ctx,
        organization_id,
        None,
        "stock_inventory",
        inventory.id,
        "create",
        None,
        Some(
            serde_json::json!({
                "name": name,
                "state": state_clone,
                "location_count": location_ids_clone.len(),
                "product_count": product_ids_clone.len()
            })
            .to_string(),
        ),
        vec!["name".to_string(), "state".to_string()],
    );

    Ok(())
}

/// Create a new inventory adjustment
pub fn create_inventory_adjustment(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    product_id: u64,
    location_id: u64,
    quantity_before: f64,
    quantity_after: f64,
    reason_code: String,
    state: String,
    adjustment_type: String,
    inventory_id: Option<u64>,
    lot_id: Option<u64>,
    package_id: Option<u64>,
    uom_id: u64,
    unit_cost: f64,
    reason_notes: Option<String>,
    requested_by: Option<Identity>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "inventory_adjustment", "create")?;

    if name.is_empty() {
        return Err("Adjustment name cannot be empty".to_string());
    }

    let adjustment_type_clone = adjustment_type.clone();
    let state_clone = state.clone();

    let adjustment = ctx.db.inventory_adjustment().insert(InventoryAdjustment {
        id: 0,
        organization_id,
        name: name.clone(),
        state,
        adjustment_type,
        inventory_id,
        product_id,
        location_id,
        lot_id,
        package_id,
        quantity_before,
        quantity_after,
        difference: quantity_after - quantity_before,
        uom_id,
        unit_cost,
        total_value: (quantity_after - quantity_before) * unit_cost,
        reason_code,
        reason_notes,
        requested_by,
        approved_by: None,
        posted_by: None,
        move_id: None,
        accounting_entry_id: None,
        created_at: ctx.timestamp,
        approved_at: None,
        posted_at: None,
        metadata: None,
    });

    write_audit_log(
        ctx,
        organization_id,
        None,
        "inventory_adjustment",
        adjustment.id,
        "create",
        None,
        Some(
            serde_json::json!({
                "name": name,
                "product_id": product_id,
                "quantity_before": quantity_before,
                "quantity_after": quantity_after,
                "adjustment_type": adjustment_type_clone,
                "state": state_clone
            })
            .to_string(),
        ),
        vec![
            "name".to_string(),
            "product_id".to_string(),
            "adjustment_type".to_string(),
        ],
    );

    Ok(())
}

/// Create a new stock inventory line
pub fn create_stock_inventory_line(
    ctx: &ReducerContext,
    organization_id: u64,
    inventory_id: u64,
    product_id: u64,
    location_id: u64,
    product_variant_id: Option<u64>,
    product_uom_id: u64,
    theoretical_qty: f64,
    product_qty: f64,
    state: String,
    product_tracking: String,
    product_type: String,
    is_editable: bool,
    outdated: bool,
    location_name: Option<String>,
    prod_lot_id: Option<u64>,
    package_id: Option<u64>,
    partner_id: Option<u64>,
    inventory_location_id: Option<u64>,
    inventory_product_id: Option<u64>,
    inventory_prod_lot_id: Option<u64>,
    inventory_package_id: Option<u64>,
    inventory_partner_id: Option<u64>,
    package_level_id: Option<u64>,
    package_level_id_visible: bool,
    product_barcode: Option<String>,
    inventory_location_id_name: Option<String>,
    inventory_product_id_name: Option<String>,
    theoretical_qty_text: Option<String>,
    product_uom_category_id: Option<u64>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_inventory_line", "create")?;

    let inventory = ctx
        .db
        .stock_inventory()
        .id()
        .find(&inventory_id)
        .ok_or("Inventory not found")?;

    let state_clone = state.clone();
    let product_tracking_clone = product_tracking.clone();
    let product_type_clone = product_type.clone();

    let line = ctx.db.stock_inventory_line().insert(StockInventoryLine {
        id: 0,
        organization_id,
        inventory_id,
        product_id,
        product_variant_id,
        product_uom_id,
        location_id,
        location_name,
        prod_lot_id,
        package_id,
        partner_id,
        company_id: inventory.company_id,
        theoretical_qty,
        product_qty,
        inventory_location_id,
        inventory_product_id,
        inventory_prod_lot_id,
        inventory_package_id,
        inventory_partner_id,
        package_level_id,
        package_level_id_visible,
        state: state.clone(),
        product_tracking: product_tracking.clone(),
        product_barcode,
        product_type: product_type.clone(),
        is_editable,
        outdated,
        inventory_location_id_name,
        inventory_product_id_name,
        theoretical_qty_text,
        product_uom_category_id,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata,
    });

    write_audit_log(
        ctx,
        organization_id,
        None,
        "stock_inventory_line",
        line.id,
        "create",
        None,
        Some(
            serde_json::json!({
                "inventory_id": inventory_id,
                "product_id": product_id,
                "product_variant_id": product_variant_id,
                "product_uom_id": product_uom_id,
                "theoretical_qty": theoretical_qty,
                "product_qty": product_qty,
                "state": state_clone,
                "product_tracking": product_tracking_clone,
                "product_type": product_type_clone,
                "is_editable": is_editable,
                "outdated": outdated
            })
            .to_string(),
        ),
        vec![
            "inventory_id".to_string(),
            "product_id".to_string(),
            "product_variant_id".to_string(),
            "product_uom_id".to_string(),
            "state".to_string(),
            "product_tracking".to_string(),
            "product_type".to_string(),
            "is_editable".to_string(),
            "outdated".to_string(),
        ],
    );

    Ok(())
}

/// Create a new adjustment reason
pub fn create_adjustment_reason(
    ctx: &ReducerContext,
    organization_id: u64,
    code: String,
    description: String,
    is_active: bool,
    is_system: bool,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "adjustment_reason", "create")?;

    if code.is_empty() {
        return Err("Reason code cannot be empty".to_string());
    }

    let description_clone = description.clone();
    let reason = ctx.db.adjustment_reason().insert(AdjustmentReason {
        id: 0,
        organization_id,
        code: code.clone(),
        description: Some(description),
        is_active,
        is_system,
        created_at: ctx.timestamp,
        metadata,
    });

    write_audit_log(
        ctx,
        organization_id,
        None,
        "adjustment_reason",
        reason.id,
        "create",
        None,
        Some(
            serde_json::json!({
                "code": code,
                "description": description_clone,
                "is_active": is_active,
                "is_system": is_system
            })
            .to_string(),
        ),
        vec![
            "code".to_string(),
            "description".to_string(),
            "is_active".to_string(),
            "is_system".to_string(),
        ],
    );

    Ok(())
}

/// Update stock inventory state
pub fn update_stock_inventory_state(
    ctx: &ReducerContext,
    organization_id: u64,
    inventory_id: u64,
    new_state: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_inventory", "update")?;

    if let Some(mut inventory) = ctx.db.stock_inventory().id().find(&inventory_id) {
        let old_state = inventory.state.clone();
        let new_state_clone = new_state.clone();
        inventory.state = new_state;
        ctx.db.stock_inventory().id().update(inventory);

        write_audit_log(
            ctx,
            organization_id,
            None,
            "stock_inventory",
            inventory_id,
            "update",
            Some(serde_json::json!({ "state": old_state }).to_string()),
            Some(serde_json::json!({ "state": new_state_clone }).to_string()),
            vec!["state".to_string()],
        );
    } else {
        return Err("Inventory not found".to_string());
    }

    Ok(())
}

/// Process inventory adjustment
pub fn process_inventory_adjustment(
    ctx: &ReducerContext,
    organization_id: u64,
    adjustment_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "inventory_adjustment", "update")?;

    if let Some(mut adjustment) = ctx.db.inventory_adjustment().id().find(&adjustment_id) {
        if adjustment.state != "draft" {
            return Err("Only draft adjustments can be processed".to_string());
        }

        let old_state = adjustment.state.clone();
        adjustment.state = "processed".to_string();
        adjustment.posted_at = Some(ctx.timestamp);
        adjustment.posted_by = Some(ctx.sender());
        ctx.db.inventory_adjustment().id().update(adjustment);

        write_audit_log(
            ctx,
            organization_id,
            None,
            "inventory_adjustment",
            adjustment_id,
            "update",
            Some(serde_json::json!({ "state": old_state }).to_string()),
            Some(serde_json::json!({ "state": "processed" }).to_string()),
            vec!["state".to_string()],
        );
    } else {
        return Err("Adjustment not found".to_string());
    }

    Ok(())
}
