/// Warehouses & Locations — Tables and Reducers
///
/// Tables:
///   - Warehouse
///   - StockLocation
///   - StockRoute
///   - StockRule
use spacetimedb::{reducer, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use serde_json;

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.7: WAREHOUSE
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Clone)]
#[spacetimedb::table(
    accessor = warehouse,
    public,
    index(accessor = warehouse_by_org, btree(columns = [organization_id])),
    index(accessor = warehouse_by_code, btree(columns = [code]))
)]
pub struct Warehouse {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub code: String,
    pub active: bool,
    pub company_id: u64,
    pub partner_id: Option<u64>,
    pub lot_stock_id: u64,
    pub wh_input_stock_loc_id: Option<u64>,
    pub wh_pack_stock_loc_id: Option<u64>,
    pub wh_output_stock_loc_id: Option<u64>,
    pub wh_qc_stock_loc_id: Option<u64>,
    pub wh_scrap_loc_id: Option<u64>,
    pub in_type_id: u64,
    pub out_type_id: u64,
    pub int_type_id: u64,
    pub pack_type_id: u64,
    pub pick_type_id: u64,
    pub qc_type_id: Option<u64>,
    pub return_type_id: Option<u64>,
    pub crossdock: bool,
    pub reception_steps: String,
    pub delivery_steps: String,
    pub resupply_wh_ids: Vec<u64>,
    pub resupply_from_ids: Vec<u64>,
    pub buy_to_resupply: bool,
    pub manufacture_to_resupply: bool,
    pub manufacture_steps: String,
    pub resupply_subcontractor_on_order: bool,
    pub subcontracting_to_resupply: bool,
    pub view_location_id: Option<u64>,
    pub mto_pull_id: Option<u64>,
    pub buy_pull_id: Option<u64>,
    pub pbh_dpm_ids: Vec<u64>,
    pub sequence: i32,
    pub is_active: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.8: STOCK LOCATION
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Clone)]
#[spacetimedb::table(
    accessor = stock_location,
    public,
    index(accessor = location_by_org, btree(columns = [organization_id])),
    index(accessor = location_by_parent, btree(columns = [location_id])),
    index(accessor = location_by_barcode, btree(columns = [barcode]))
)]
pub struct StockLocation {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub complete_name: Option<String>,
    pub location_id: Option<u64>,
    pub parent_path: String,
    pub child_ids: Vec<u64>,
    pub child_left: u32,
    pub child_right: u32,
    pub usage: String,
    pub company_id: Option<u64>,
    pub scrap_location: bool,
    pub return_location: bool,
    pub valuation_in_account_id: Option<u64>,
    pub valuation_out_account_id: Option<u64>,
    pub active: bool,
    pub comment: Option<String>,
    pub posx: f64,
    pub posy: f64,
    pub posz: f64,
    pub barcode: Option<String>,
    pub cyclic_inventory_frequency: u8,
    pub last_inventory_date: Option<Timestamp>,
    pub next_inventory_date: Option<Timestamp>,
    pub location_category: String,
    pub is_active: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.9: STOCK ROUTE
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Clone)]
#[spacetimedb::table(
    accessor = stock_route,
    public,
    index(accessor = route_by_org, btree(columns = [organization_id]))
)]
pub struct StockRoute {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub sequence: i32,
    pub active: bool,
    pub company_id: Option<u64>,
    pub product_selectable: bool,
    pub product_categ_selectable: bool,
    pub warehouse_selectable: bool,
    pub shipping_selectable: bool,
    pub sale_selectable: bool,
    pub manufacture_selectable: bool,
    pub purchase_selectable: bool,
    pub mto_selectable: bool,
    pub rule_ids: Vec<u64>,
    pub is_active: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.10: STOCK RULE
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Clone)]
#[spacetimedb::table(
    accessor = stock_rule,
    public,
    index(accessor = rule_by_org, btree(columns = [organization_id])),
    index(accessor = rule_by_route, btree(columns = [route_id])),
    index(accessor = rule_by_picking_type, btree(columns = [picking_type_id]))
)]
pub struct StockRule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub action: String,
    pub active: bool,
    pub sequence: i32,
    pub group_id: Option<u64>,
    pub location_src_id: Option<u64>,
    pub location_dest_id: u64,
    pub location_id: Option<u64>,
    pub procure_method: String,
    pub route_sequence: i32,
    pub route_id: Option<u64>,
    pub picking_type_id: u64,
    pub company_id: Option<u64>,
    pub delay: i32,
    pub propagate_cancel: bool,
    pub warehouse_id: Option<u64>,
    pub propagate_warehouse_id: Option<u64>,
    pub auto: String,
    pub group_propagation_option: String,
    pub notify_stock: bool,
    pub is_active: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateWarehouseParams {
    pub name: String,
    pub code: String,
    pub lot_stock_id: u64,
    pub in_type_id: u64,
    pub out_type_id: u64,
    pub int_type_id: u64,
    pub pack_type_id: u64,
    pub pick_type_id: u64,
    pub reception_steps: String,
    pub delivery_steps: String,
    pub manufacture_steps: String,
    pub active: bool,
    pub crossdock: bool,
    pub buy_to_resupply: bool,
    pub manufacture_to_resupply: bool,
    pub resupply_subcontractor_on_order: bool,
    pub subcontracting_to_resupply: bool,
    pub sequence: i32,
    pub partner_id: Option<u64>,
    pub wh_input_stock_loc_id: Option<u64>,
    pub wh_pack_stock_loc_id: Option<u64>,
    pub wh_output_stock_loc_id: Option<u64>,
    pub wh_qc_stock_loc_id: Option<u64>,
    pub wh_scrap_loc_id: Option<u64>,
    pub qc_type_id: Option<u64>,
    pub return_type_id: Option<u64>,
    pub view_location_id: Option<u64>,
    pub mto_pull_id: Option<u64>,
    pub buy_pull_id: Option<u64>,
    pub resupply_wh_ids: Vec<u64>,
    pub resupply_from_ids: Vec<u64>,
    pub pbh_dpm_ids: Vec<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateWarehouseParams {
    pub name: Option<String>,
    pub code: Option<String>,
    pub active: Option<bool>,
    pub reception_steps: Option<String>,
    pub delivery_steps: Option<String>,
    pub manufacture_steps: Option<String>,
    pub buy_to_resupply: Option<bool>,
    pub manufacture_to_resupply: Option<bool>,
    pub crossdock: Option<bool>,
    pub sequence: Option<i32>,
    pub partner_id: Option<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateStockLocationParams {
    pub name: String,
    pub usage: String,
    pub location_category: String,
    pub parent_path: String,
    pub child_left: u32,
    pub child_right: u32,
    pub scrap_location: bool,
    pub return_location: bool,
    pub active: bool,
    pub posx: f64,
    pub posy: f64,
    pub posz: f64,
    pub cyclic_inventory_frequency: u8,
    pub location_id: Option<u64>,
    pub complete_name: Option<String>,
    pub valuation_in_account_id: Option<u64>,
    pub valuation_out_account_id: Option<u64>,
    pub comment: Option<String>,
    pub barcode: Option<String>,
    pub last_inventory_date: Option<Timestamp>,
    pub next_inventory_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateStockLocationParams {
    pub name: Option<String>,
    pub usage: Option<String>,
    pub active: Option<bool>,
    pub scrap_location: Option<bool>,
    pub return_location: Option<bool>,
    pub barcode: Option<String>,
    pub comment: Option<String>,
    pub posx: Option<f64>,
    pub posy: Option<f64>,
    pub posz: Option<f64>,
    pub cyclic_inventory_frequency: Option<u8>,
    pub location_category: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateStockRouteParams {
    pub name: String,
    pub sequence: i32,
    pub active: bool,
    pub product_selectable: bool,
    pub product_categ_selectable: bool,
    pub warehouse_selectable: bool,
    pub shipping_selectable: bool,
    pub sale_selectable: bool,
    pub manufacture_selectable: bool,
    pub purchase_selectable: bool,
    pub mto_selectable: bool,
    pub rule_ids: Vec<u64>,
    pub company_id: Option<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateStockRouteParams {
    pub name: Option<String>,
    pub sequence: Option<i32>,
    pub active: Option<bool>,
    pub product_selectable: Option<bool>,
    pub warehouse_selectable: Option<bool>,
    pub sale_selectable: Option<bool>,
    pub purchase_selectable: Option<bool>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateStockRuleParams {
    pub name: String,
    pub action: String,
    pub location_dest_id: u64,
    pub picking_type_id: u64,
    pub procure_method: String,
    pub auto: String,
    pub group_propagation_option: String,
    pub active: bool,
    pub propagate_cancel: bool,
    pub notify_stock: bool,
    pub sequence: i32,
    pub route_sequence: i32,
    pub delay: i32,
    pub route_id: Option<u64>,
    pub location_src_id: Option<u64>,
    pub location_id: Option<u64>,
    pub group_id: Option<u64>,
    pub warehouse_id: Option<u64>,
    pub propagate_warehouse_id: Option<u64>,
    pub company_id: Option<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateStockRuleParams {
    pub name: Option<String>,
    pub action: Option<String>,
    pub active: Option<bool>,
    pub sequence: Option<i32>,
    pub delay: Option<i32>,
    pub propagate_cancel: Option<bool>,
    pub notify_stock: Option<bool>,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: WAREHOUSE
// ══════════════════════════════════════════════════════════════════════════════

#[reducer]
pub fn create_warehouse(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateWarehouseParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "warehouse", "create")?;

    if params.name.is_empty() || params.code.is_empty() {
        return Err("Warehouse name and code cannot be empty".to_string());
    }

    let warehouse = ctx.db.warehouse().insert(Warehouse {
        id: 0,
        organization_id,
        name: params.name.clone(),
        code: params.code.clone(),
        active: params.active,
        company_id,
        partner_id: params.partner_id,
        lot_stock_id: params.lot_stock_id,
        wh_input_stock_loc_id: params.wh_input_stock_loc_id,
        wh_pack_stock_loc_id: params.wh_pack_stock_loc_id,
        wh_output_stock_loc_id: params.wh_output_stock_loc_id,
        wh_qc_stock_loc_id: params.wh_qc_stock_loc_id,
        wh_scrap_loc_id: params.wh_scrap_loc_id,
        in_type_id: params.in_type_id,
        out_type_id: params.out_type_id,
        int_type_id: params.int_type_id,
        pack_type_id: params.pack_type_id,
        pick_type_id: params.pick_type_id,
        qc_type_id: params.qc_type_id,
        return_type_id: params.return_type_id,
        crossdock: params.crossdock,
        reception_steps: params.reception_steps,
        delivery_steps: params.delivery_steps,
        resupply_wh_ids: params.resupply_wh_ids,
        resupply_from_ids: params.resupply_from_ids,
        buy_to_resupply: params.buy_to_resupply,
        manufacture_to_resupply: params.manufacture_to_resupply,
        manufacture_steps: params.manufacture_steps,
        resupply_subcontractor_on_order: params.resupply_subcontractor_on_order,
        subcontracting_to_resupply: params.subcontracting_to_resupply,
        view_location_id: params.view_location_id,
        mto_pull_id: params.mto_pull_id,
        buy_pull_id: params.buy_pull_id,
        pbh_dpm_ids: params.pbh_dpm_ids,
        sequence: params.sequence,
        is_active: params.active,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "warehouse",
            record_id: warehouse.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "name": warehouse.name, "code": warehouse.code }).to_string(),
            ),
            changed_fields: vec!["name".to_string(), "code".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn update_warehouse(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    warehouse_id: u64,
    params: UpdateWarehouseParams,
) -> Result<(), String> {
    let warehouse = ctx
        .db
        .warehouse()
        .id()
        .find(&warehouse_id)
        .ok_or("Warehouse not found")?;

    check_permission(ctx, organization_id, "warehouse", "write")?;

    if warehouse.company_id != company_id {
        return Err("Warehouse does not belong to this company".to_string());
    }

    ctx.db.warehouse().id().update(Warehouse {
        name: params.name.unwrap_or_else(|| warehouse.name.clone()),
        code: params.code.unwrap_or_else(|| warehouse.code.clone()),
        active: params.active.unwrap_or(warehouse.active),
        reception_steps: params
            .reception_steps
            .unwrap_or_else(|| warehouse.reception_steps.clone()),
        delivery_steps: params
            .delivery_steps
            .unwrap_or_else(|| warehouse.delivery_steps.clone()),
        manufacture_steps: params
            .manufacture_steps
            .unwrap_or_else(|| warehouse.manufacture_steps.clone()),
        buy_to_resupply: params.buy_to_resupply.unwrap_or(warehouse.buy_to_resupply),
        manufacture_to_resupply: params
            .manufacture_to_resupply
            .unwrap_or(warehouse.manufacture_to_resupply),
        crossdock: params.crossdock.unwrap_or(warehouse.crossdock),
        sequence: params.sequence.unwrap_or(warehouse.sequence),
        partner_id: params.partner_id.or(warehouse.partner_id),
        metadata: params.metadata.or(warehouse.metadata),
        updated_at: ctx.timestamp,
        ..warehouse
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "warehouse",
            record_id: warehouse_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["updated".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn delete_warehouse(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    warehouse_id: u64,
) -> Result<(), String> {
    let warehouse = ctx
        .db
        .warehouse()
        .id()
        .find(&warehouse_id)
        .ok_or("Warehouse not found")?;

    check_permission(ctx, organization_id, "warehouse", "delete")?;

    if warehouse.company_id != company_id {
        return Err("Warehouse does not belong to this company".to_string());
    }

    ctx.db.warehouse().id().update(Warehouse {
        active: false,
        is_active: false,
        updated_at: ctx.timestamp,
        ..warehouse.clone()
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "warehouse",
            record_id: warehouse_id,
            action: "DELETE",
            old_values: Some(serde_json::json!({ "name": warehouse.name }).to_string()),
            new_values: None,
            changed_fields: vec!["active".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: STOCK LOCATION
// ══════════════════════════════════════════════════════════════════════════════

#[reducer]
pub fn create_stock_location(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateStockLocationParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_location", "create")?;

    if params.name.is_empty() {
        return Err("Location name cannot be empty".to_string());
    }

    let parent_path = if let Some(pid) = params.location_id {
        let parent = ctx
            .db
            .stock_location()
            .id()
            .find(&pid)
            .ok_or("Parent location not found")?;
        format!("{}{}/", parent.parent_path, pid)
    } else {
        params.parent_path.clone()
    };

    let location = ctx.db.stock_location().insert(StockLocation {
        id: 0,
        organization_id,
        name: params.name.clone(),
        complete_name: params.complete_name.or(Some(params.name.clone())),
        location_id: params.location_id,
        parent_path,
        child_ids: vec![],
        child_left: params.child_left,
        child_right: params.child_right,
        usage: params.usage.clone(),
        company_id: None,
        scrap_location: params.scrap_location,
        return_location: params.return_location,
        valuation_in_account_id: params.valuation_in_account_id,
        valuation_out_account_id: params.valuation_out_account_id,
        active: params.active,
        comment: params.comment,
        posx: params.posx,
        posy: params.posy,
        posz: params.posz,
        barcode: params.barcode,
        cyclic_inventory_frequency: params.cyclic_inventory_frequency,
        last_inventory_date: params.last_inventory_date,
        next_inventory_date: params.next_inventory_date,
        location_category: params.location_category,
        is_active: params.active,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: params.metadata,
    });

    if let Some(pid) = params.location_id {
        if let Some(mut parent) = ctx.db.stock_location().id().find(&pid) {
            parent.child_ids.push(location.id);
            ctx.db.stock_location().id().update(parent);
        }
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "stock_location",
            record_id: location.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "name": location.name, "usage": location.usage }).to_string(),
            ),
            changed_fields: vec!["name".to_string(), "usage".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn update_stock_location(
    ctx: &ReducerContext,
    organization_id: u64,
    location_id: u64,
    params: UpdateStockLocationParams,
) -> Result<(), String> {
    let location = ctx
        .db
        .stock_location()
        .id()
        .find(&location_id)
        .ok_or("Location not found")?;

    check_permission(ctx, organization_id, "stock_location", "write")?;

    let new_name = params.name.unwrap_or_else(|| location.name.clone());

    ctx.db.stock_location().id().update(StockLocation {
        name: new_name.clone(),
        complete_name: Some(new_name),
        usage: params.usage.unwrap_or_else(|| location.usage.clone()),
        active: params.active.unwrap_or(location.active),
        scrap_location: params.scrap_location.unwrap_or(location.scrap_location),
        return_location: params.return_location.unwrap_or(location.return_location),
        barcode: params.barcode.or(location.barcode),
        comment: params.comment.or(location.comment),
        posx: params.posx.unwrap_or(location.posx),
        posy: params.posy.unwrap_or(location.posy),
        posz: params.posz.unwrap_or(location.posz),
        cyclic_inventory_frequency: params
            .cyclic_inventory_frequency
            .unwrap_or(location.cyclic_inventory_frequency),
        location_category: params
            .location_category
            .unwrap_or_else(|| location.location_category.clone()),
        metadata: params.metadata.or(location.metadata),
        updated_at: ctx.timestamp,
        ..location
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "stock_location",
            record_id: location_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["updated".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn delete_stock_location(
    ctx: &ReducerContext,
    organization_id: u64,
    location_id: u64,
) -> Result<(), String> {
    let location = ctx
        .db
        .stock_location()
        .id()
        .find(&location_id)
        .ok_or("Location not found")?;

    check_permission(ctx, organization_id, "stock_location", "delete")?;

    if !location.child_ids.is_empty() {
        return Err("Cannot delete location with child locations".to_string());
    }

    ctx.db.stock_location().id().update(StockLocation {
        active: false,
        is_active: false,
        updated_at: ctx.timestamp,
        ..location.clone()
    });

    if let Some(pid) = location.location_id {
        if let Some(mut parent) = ctx.db.stock_location().id().find(&pid) {
            parent.child_ids.retain(|&id| id != location_id);
            ctx.db.stock_location().id().update(parent);
        }
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "stock_location",
            record_id: location_id,
            action: "DELETE",
            old_values: Some(serde_json::json!({ "name": location.name }).to_string()),
            new_values: None,
            changed_fields: vec!["active".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: STOCK ROUTE
// ══════════════════════════════════════════════════════════════════════════════

#[reducer]
pub fn create_stock_route(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateStockRouteParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_route", "create")?;

    if params.name.is_empty() {
        return Err("Route name cannot be empty".to_string());
    }

    let route = ctx.db.stock_route().insert(StockRoute {
        id: 0,
        organization_id,
        name: params.name.clone(),
        sequence: params.sequence,
        active: params.active,
        company_id: params.company_id,
        product_selectable: params.product_selectable,
        product_categ_selectable: params.product_categ_selectable,
        warehouse_selectable: params.warehouse_selectable,
        shipping_selectable: params.shipping_selectable,
        sale_selectable: params.sale_selectable,
        manufacture_selectable: params.manufacture_selectable,
        purchase_selectable: params.purchase_selectable,
        mto_selectable: params.mto_selectable,
        rule_ids: params.rule_ids,
        is_active: params.active,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: params.company_id,
            table_name: "stock_route",
            record_id: route.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": route.name }).to_string()),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn update_stock_route(
    ctx: &ReducerContext,
    organization_id: u64,
    route_id: u64,
    params: UpdateStockRouteParams,
) -> Result<(), String> {
    let route = ctx
        .db
        .stock_route()
        .id()
        .find(&route_id)
        .ok_or("Route not found")?;

    check_permission(ctx, organization_id, "stock_route", "write")?;

    ctx.db.stock_route().id().update(StockRoute {
        name: params.name.unwrap_or_else(|| route.name.clone()),
        sequence: params.sequence.unwrap_or(route.sequence),
        active: params.active.unwrap_or(route.active),
        product_selectable: params
            .product_selectable
            .unwrap_or(route.product_selectable),
        warehouse_selectable: params
            .warehouse_selectable
            .unwrap_or(route.warehouse_selectable),
        sale_selectable: params.sale_selectable.unwrap_or(route.sale_selectable),
        purchase_selectable: params
            .purchase_selectable
            .unwrap_or(route.purchase_selectable),
        metadata: params.metadata.or(route.metadata),
        updated_at: ctx.timestamp,
        ..route
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "stock_route",
            record_id: route_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["updated".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn delete_stock_route(
    ctx: &ReducerContext,
    organization_id: u64,
    route_id: u64,
) -> Result<(), String> {
    let route = ctx
        .db
        .stock_route()
        .id()
        .find(&route_id)
        .ok_or("Route not found")?;

    check_permission(ctx, organization_id, "stock_route", "delete")?;

    if !route.rule_ids.is_empty() {
        return Err("Cannot delete route with associated rules".to_string());
    }

    ctx.db.stock_route().id().update(StockRoute {
        active: false,
        is_active: false,
        updated_at: ctx.timestamp,
        ..route.clone()
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "stock_route",
            record_id: route_id,
            action: "DELETE",
            old_values: Some(serde_json::json!({ "name": route.name }).to_string()),
            new_values: None,
            changed_fields: vec!["active".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: STOCK RULE
// ══════════════════════════════════════════════════════════════════════════════

#[reducer]
pub fn create_stock_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateStockRuleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_rule", "create")?;

    if params.name.is_empty() {
        return Err("Rule name cannot be empty".to_string());
    }

    let rule = ctx.db.stock_rule().insert(StockRule {
        id: 0,
        organization_id,
        name: params.name.clone(),
        action: params.action.clone(),
        active: params.active,
        sequence: params.sequence,
        group_id: params.group_id,
        location_src_id: params.location_src_id,
        location_dest_id: params.location_dest_id,
        location_id: params.location_id,
        procure_method: params.procure_method,
        route_sequence: params.route_sequence,
        route_id: params.route_id,
        picking_type_id: params.picking_type_id,
        company_id: params.company_id,
        delay: params.delay,
        propagate_cancel: params.propagate_cancel,
        warehouse_id: params.warehouse_id,
        propagate_warehouse_id: params.propagate_warehouse_id,
        auto: params.auto,
        group_propagation_option: params.group_propagation_option,
        notify_stock: params.notify_stock,
        is_active: params.active,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: params.metadata,
    });

    if let Some(rid) = params.route_id {
        if let Some(mut route) = ctx.db.stock_route().id().find(&rid) {
            route.rule_ids.push(rule.id);
            ctx.db.stock_route().id().update(route);
        }
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: params.company_id,
            table_name: "stock_rule",
            record_id: rule.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "name": rule.name, "action": rule.action }).to_string(),
            ),
            changed_fields: vec!["name".to_string(), "action".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn update_stock_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    rule_id: u64,
    params: UpdateStockRuleParams,
) -> Result<(), String> {
    let rule = ctx
        .db
        .stock_rule()
        .id()
        .find(&rule_id)
        .ok_or("Rule not found")?;

    check_permission(ctx, organization_id, "stock_rule", "write")?;

    ctx.db.stock_rule().id().update(StockRule {
        name: params.name.unwrap_or_else(|| rule.name.clone()),
        action: params.action.unwrap_or_else(|| rule.action.clone()),
        active: params.active.unwrap_or(rule.active),
        sequence: params.sequence.unwrap_or(rule.sequence),
        delay: params.delay.unwrap_or(rule.delay),
        propagate_cancel: params.propagate_cancel.unwrap_or(rule.propagate_cancel),
        notify_stock: params.notify_stock.unwrap_or(rule.notify_stock),
        metadata: params.metadata.or(rule.metadata),
        updated_at: ctx.timestamp,
        ..rule
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "stock_rule",
            record_id: rule_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["updated".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn delete_stock_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    rule_id: u64,
) -> Result<(), String> {
    let rule = ctx
        .db
        .stock_rule()
        .id()
        .find(&rule_id)
        .ok_or("Rule not found")?;

    check_permission(ctx, organization_id, "stock_rule", "delete")?;

    if let Some(rid) = rule.route_id {
        if let Some(mut route) = ctx.db.stock_route().id().find(&rid) {
            route.rule_ids.retain(|&id| id != rule_id);
            ctx.db.stock_route().id().update(route);
        }
    }

    ctx.db.stock_rule().id().update(StockRule {
        active: false,
        is_active: false,
        updated_at: ctx.timestamp,
        ..rule.clone()
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "stock_rule",
            record_id: rule_id,
            action: "DELETE",
            old_values: Some(serde_json::json!({ "name": rule.name }).to_string()),
            new_values: None,
            changed_fields: vec!["active".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
