/// Inventory Adjustments — Core Tables and Reducers
///
/// Tables:
///   - StockInventory
///   - StockInventoryLine
///   - InventoryAdjustment
///   - AdjustmentReason
///   - StockCountSheet
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use serde_json;

// ── Tables ───────────────────────────────────────────────────────────────────

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

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateStockInventoryParams {
    pub name: String,
    pub location_ids: Vec<u64>,
    pub product_ids: Vec<u64>,
    pub lot_ids: Vec<u64>,
    pub owner_ids: Vec<u64>,
    pub package_ids: Vec<u64>,
    pub state: String,
    pub accounting_date: Option<Timestamp>,
    pub category_id: Option<u64>,
    pub counted_mode: String,
    pub done_move_ids: Vec<u64>,
    pub move_ids: Vec<u64>,
    pub adjustment_count: i32,
    pub has_account_moves: bool,
    pub exhausted: bool,
    pub prefilled_count: i32,
    pub started: bool,
    pub is_editable: bool,
    pub is_stock_check: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateInventoryAdjustmentParams {
    pub name: String,
    pub product_id: u64,
    pub location_id: u64,
    pub quantity_before: f64,
    pub quantity_after: f64,
    pub reason_code: String,
    pub state: String,
    pub adjustment_type: String,
    pub inventory_id: Option<u64>,
    pub lot_id: Option<u64>,
    pub package_id: Option<u64>,
    pub uom_id: u64,
    pub unit_cost: f64,
    pub reason_notes: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateStockInventoryLineParams {
    pub product_id: u64,
    pub product_variant_id: Option<u64>,
    pub product_uom_id: u64,
    pub location_id: u64,
    pub location_name: Option<String>,
    pub prod_lot_id: Option<u64>,
    pub package_id: Option<u64>,
    pub partner_id: Option<u64>,
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
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAdjustmentReasonParams {
    pub code: String,
    pub description: Option<String>,
    pub is_active: bool,
    pub is_system: bool,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Create a new stock inventory
#[spacetimedb::reducer]
pub fn create_stock_inventory(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateStockInventoryParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_inventory", "create")?;

    if params.name.is_empty() {
        return Err("Inventory name cannot be empty".to_string());
    }

    let location_count = params.location_ids.len();
    let product_count = params.product_ids.len();

    let inventory = ctx.db.stock_inventory().insert(StockInventory {
        id: 0,
        organization_id,
        name: params.name.clone(),
        state: params.state.clone(),
        location_ids: params.location_ids,
        product_ids: params.product_ids,
        lot_ids: params.lot_ids,
        owner_ids: params.owner_ids,
        package_ids: params.package_ids,
        company_id,
        date: ctx.timestamp,
        accounting_date: params.accounting_date,
        done_move_ids: params.done_move_ids,
        move_ids: params.move_ids,
        adjustment_count: params.adjustment_count,
        category_id: params.category_id,
        has_account_moves: params.has_account_moves,
        exhausted: params.exhausted,
        prefilled_count: params.prefilled_count,
        counted_mode: params.counted_mode,
        started: params.started,
        is_editable: params.is_editable,
        is_stock_check: params.is_stock_check,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_inventory",
            record_id: inventory.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": params.name,
                    "state": params.state,
                    "location_count": location_count,
                    "product_count": product_count,
                })
                .to_string(),
            ),
            changed_fields: vec!["name".to_string(), "state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Create a new inventory adjustment
#[spacetimedb::reducer]
pub fn create_inventory_adjustment(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateInventoryAdjustmentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "inventory_adjustment", "create")?;

    if params.name.is_empty() {
        return Err("Adjustment name cannot be empty".to_string());
    }

    let difference = params.quantity_after - params.quantity_before;
    let total_value = difference * params.unit_cost;

    // approved_by, posted_by, move_id, accounting_entry_id, approved_at, posted_at
    // are system-managed; set by dedicated approve/process reducers
    let adjustment = ctx.db.inventory_adjustment().insert(InventoryAdjustment {
        id: 0,
        organization_id,
        name: params.name.clone(),
        state: params.state.clone(),
        adjustment_type: params.adjustment_type.clone(),
        inventory_id: params.inventory_id,
        product_id: params.product_id,
        location_id: params.location_id,
        lot_id: params.lot_id,
        package_id: params.package_id,
        quantity_before: params.quantity_before,
        quantity_after: params.quantity_after,
        difference,
        uom_id: params.uom_id,
        unit_cost: params.unit_cost,
        total_value,
        reason_code: params.reason_code,
        reason_notes: params.reason_notes,
        requested_by: Some(ctx.sender()),
        approved_by: None,
        posted_by: None,
        move_id: None,
        accounting_entry_id: None,
        created_at: ctx.timestamp,
        approved_at: None,
        posted_at: None,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "inventory_adjustment",
            record_id: adjustment.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": params.name,
                    "product_id": params.product_id,
                    "quantity_before": params.quantity_before,
                    "quantity_after": params.quantity_after,
                    "adjustment_type": params.adjustment_type,
                    "state": params.state,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "name".to_string(),
                "product_id".to_string(),
                "adjustment_type".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

/// Create a new stock inventory line
#[spacetimedb::reducer]
pub fn create_stock_inventory_line(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    inventory_id: u64,
    params: CreateStockInventoryLineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_inventory_line", "create")?;

    let inventory = ctx
        .db
        .stock_inventory()
        .id()
        .find(&inventory_id)
        .ok_or("Inventory not found")?;

    if inventory.organization_id != organization_id {
        return Err("Inventory does not belong to this organization".to_string());
    }
    if inventory.company_id != company_id {
        return Err("Inventory does not belong to this company".to_string());
    }

    let line = ctx.db.stock_inventory_line().insert(StockInventoryLine {
        id: 0,
        organization_id,
        inventory_id,
        product_id: params.product_id,
        product_variant_id: params.product_variant_id,
        product_uom_id: params.product_uom_id,
        location_id: params.location_id,
        location_name: params.location_name,
        prod_lot_id: params.prod_lot_id,
        package_id: params.package_id,
        partner_id: params.partner_id,
        company_id: inventory.company_id,
        theoretical_qty: params.theoretical_qty,
        product_qty: params.product_qty,
        inventory_location_id: params.inventory_location_id,
        inventory_product_id: params.inventory_product_id,
        inventory_prod_lot_id: params.inventory_prod_lot_id,
        inventory_package_id: params.inventory_package_id,
        inventory_partner_id: params.inventory_partner_id,
        package_level_id: params.package_level_id,
        package_level_id_visible: params.package_level_id_visible,
        state: params.state.clone(),
        product_tracking: params.product_tracking.clone(),
        product_barcode: params.product_barcode,
        product_type: params.product_type.clone(),
        is_editable: params.is_editable,
        outdated: params.outdated,
        inventory_location_id_name: params.inventory_location_id_name,
        inventory_product_id_name: params.inventory_product_id_name,
        theoretical_qty_text: params.theoretical_qty_text,
        product_uom_category_id: params.product_uom_category_id,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_inventory_line",
            record_id: line.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "inventory_id": inventory_id,
                    "product_id": params.product_id,
                    "product_variant_id": params.product_variant_id,
                    "product_uom_id": params.product_uom_id,
                    "theoretical_qty": params.theoretical_qty,
                    "product_qty": params.product_qty,
                    "state": params.state,
                    "product_tracking": params.product_tracking,
                    "product_type": params.product_type,
                    "is_editable": params.is_editable,
                    "outdated": params.outdated,
                })
                .to_string(),
            ),
            changed_fields: vec![
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
            metadata: None,
        },
    );

    Ok(())
}

/// Create a new adjustment reason
#[spacetimedb::reducer]
pub fn create_adjustment_reason(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateAdjustmentReasonParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "adjustment_reason", "create")?;

    if params.code.is_empty() {
        return Err("Reason code cannot be empty".to_string());
    }

    let reason = ctx.db.adjustment_reason().insert(AdjustmentReason {
        id: 0,
        organization_id,
        code: params.code.clone(),
        description: params.description.clone(),
        is_active: params.is_active,
        is_system: params.is_system,
        created_at: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "adjustment_reason",
            record_id: reason.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "code": params.code,
                    "description": params.description,
                    "is_active": params.is_active,
                    "is_system": params.is_system,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "code".to_string(),
                "description".to_string(),
                "is_active".to_string(),
                "is_system".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

/// Update stock inventory state
#[spacetimedb::reducer]
pub fn update_stock_inventory_state(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    inventory_id: u64,
    new_state: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_inventory", "update")?;

    let inventory = ctx
        .db
        .stock_inventory()
        .id()
        .find(&inventory_id)
        .ok_or("Inventory not found")?;

    if inventory.organization_id != organization_id {
        return Err("Inventory does not belong to this organization".to_string());
    }
    if inventory.company_id != company_id {
        return Err("Inventory does not belong to this company".to_string());
    }

    let old_state = inventory.state.clone();

    ctx.db.stock_inventory().id().update(StockInventory {
        state: new_state.clone(),
        updated_at: ctx.timestamp,
        ..inventory
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_inventory",
            record_id: inventory_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": old_state }).to_string()),
            new_values: Some(serde_json::json!({ "state": new_state }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Process inventory adjustment
#[spacetimedb::reducer]
pub fn process_inventory_adjustment(
    ctx: &ReducerContext,
    organization_id: u64,
    adjustment_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "inventory_adjustment", "update")?;

    let adjustment = ctx
        .db
        .inventory_adjustment()
        .id()
        .find(&adjustment_id)
        .ok_or("Adjustment not found")?;

    if adjustment.organization_id != organization_id {
        return Err("Adjustment does not belong to this organization".to_string());
    }
    if adjustment.state != "draft" {
        return Err("Only draft adjustments can be processed".to_string());
    }

    let old_state = adjustment.state.clone();

    ctx.db.inventory_adjustment().id().update(InventoryAdjustment {
        state: "processed".to_string(),
        posted_at: Some(ctx.timestamp),
        posted_by: Some(ctx.sender()),
        ..adjustment
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "inventory_adjustment",
            record_id: adjustment_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": old_state }).to_string()),
            new_values: Some(serde_json::json!({ "state": "processed" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
