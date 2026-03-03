use serde_json;
/// Warehouses & Locations — Tables and Reducers
///
/// Tables:
///   - Warehouse
///   - StockLocation
///   - StockRoute
///   - StockRule
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.7: WAREHOUSE
// ══════════════════════════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: WAREHOUSE
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_warehouse(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    code: String,
    company_id: u64,
    lot_stock_id: u64,
    in_type_id: u64,
    out_type_id: u64,
    int_type_id: u64,
    pack_type_id: u64,
    pick_type_id: u64,
    reception_steps: String,
    delivery_steps: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "warehouse", "create")?;

    if name.is_empty() || code.is_empty() {
        return Err("Warehouse name and code cannot be empty".to_string());
    }

    let warehouse = ctx.db.warehouse().insert(Warehouse {
        id: 0,
        organization_id,
        name: name.clone(),
        code: code.clone(),
        active: true,
        company_id,
        partner_id: None,
        lot_stock_id,
        wh_input_stock_loc_id: None,
        wh_pack_stock_loc_id: None,
        wh_output_stock_loc_id: None,
        wh_qc_stock_loc_id: None,
        wh_scrap_loc_id: None,
        in_type_id,
        out_type_id,
        int_type_id,
        pack_type_id,
        pick_type_id,
        qc_type_id: None,
        return_type_id: None,
        crossdock: false,
        reception_steps,
        delivery_steps,
        resupply_wh_ids: vec![],
        resupply_from_ids: vec![],
        buy_to_resupply: true,
        manufacture_to_resupply: true,
        manufacture_steps: "mrp_one_step".to_string(),
        resupply_subcontractor_on_order: false,
        subcontracting_to_resupply: false,
        view_location_id: None,
        mto_pull_id: None,
        buy_pull_id: None,
        pbh_dpm_ids: vec![],
        sequence: 10,
        is_active: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: None,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "warehouse",
        warehouse.id,
        "create",
        None,
        Some(serde_json::json!({ "name": name, "code": code }).to_string()),
        vec!["name".to_string(), "code".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_warehouse(
    ctx: &ReducerContext,
    warehouse_id: u64,
    name: Option<String>,
    code: Option<String>,
    active: Option<bool>,
    reception_steps: Option<String>,
    delivery_steps: Option<String>,
    buy_to_resupply: Option<bool>,
    manufacture_to_resupply: Option<bool>,
) -> Result<(), String> {
    let warehouse = ctx
        .db
        .warehouse()
        .id()
        .find(&warehouse_id)
        .ok_or("Warehouse not found")?;

    check_permission(ctx, warehouse.organization_id, "warehouse", "write")?;

    ctx.db.warehouse().id().update(Warehouse {
        name: name.unwrap_or_else(|| warehouse.name.clone()),
        code: code.unwrap_or_else(|| warehouse.code.clone()),
        active: active.unwrap_or(warehouse.active),
        reception_steps: reception_steps.unwrap_or_else(|| warehouse.reception_steps.clone()),
        delivery_steps: delivery_steps.unwrap_or_else(|| warehouse.delivery_steps.clone()),
        buy_to_resupply: buy_to_resupply.unwrap_or(warehouse.buy_to_resupply),
        manufacture_to_resupply: manufacture_to_resupply
            .unwrap_or(warehouse.manufacture_to_resupply),
        updated_at: ctx.timestamp,
        ..warehouse
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_warehouse(ctx: &ReducerContext, warehouse_id: u64) -> Result<(), String> {
    let warehouse = ctx
        .db
        .warehouse()
        .id()
        .find(&warehouse_id)
        .ok_or("Warehouse not found")?;

    check_permission(ctx, warehouse.organization_id, "warehouse", "delete")?;

    let warehouse_name = warehouse.name.clone();

    ctx.db.warehouse().id().update(Warehouse {
        active: false,
        is_active: false,
        updated_at: ctx.timestamp,
        ..warehouse
    });

    write_audit_log(
        ctx,
        warehouse.organization_id,
        Some(warehouse.company_id),
        "warehouse",
        warehouse_id,
        "delete",
        Some(serde_json::json!({ "name": warehouse_name }).to_string()),
        None,
        vec!["active".to_string()],
    );

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: STOCK LOCATION
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_stock_location(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    usage: String,
    location_id: Option<u64>,
    company_id: Option<u64>,
    scrap_location: bool,
    return_location: bool,
    barcode: Option<String>,
    location_category: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_location", "create")?;

    if name.is_empty() {
        return Err("Location name cannot be empty".to_string());
    }

    let parent_path = if let Some(pid) = location_id {
        let parent = ctx
            .db
            .stock_location()
            .id()
            .find(&pid)
            .ok_or("Parent location not found")?;
        format!("{}{}/", parent.parent_path, pid)
    } else {
        "/".to_string()
    };

    let location = ctx.db.stock_location().insert(StockLocation {
        id: 0,
        organization_id,
        name: name.clone(),
        complete_name: Some(name.clone()),
        location_id,
        parent_path,
        child_ids: vec![],
        child_left: 0,
        child_right: 0,
        usage,
        company_id,
        scrap_location,
        return_location,
        valuation_in_account_id: None,
        valuation_out_account_id: None,
        active: true,
        comment: None,
        posx: 0.0,
        posy: 0.0,
        posz: 0.0,
        barcode,
        cyclic_inventory_frequency: 0,
        last_inventory_date: None,
        next_inventory_date: None,
        location_category,
        is_active: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: None,
    });

    if let Some(pid) = location_id {
        if let Some(mut parent) = ctx.db.stock_location().id().find(&pid) {
            parent.child_ids.push(location.id);
            ctx.db.stock_location().id().update(parent);
        }
    }

    write_audit_log(
        ctx,
        organization_id,
        company_id,
        "stock_location",
        location.id,
        "create",
        None,
        Some(serde_json::json!({ "name": name, "usage": location.usage }).to_string()),
        vec!["name".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_stock_location(
    ctx: &ReducerContext,
    location_id: u64,
    name: Option<String>,
    usage: Option<String>,
    active: Option<bool>,
    scrap_location: Option<bool>,
    return_location: Option<bool>,
    barcode: Option<String>,
    comment: Option<String>,
    posx: Option<f64>,
    posy: Option<f64>,
    posz: Option<f64>,
) -> Result<(), String> {
    let location = ctx
        .db
        .stock_location()
        .id()
        .find(&location_id)
        .ok_or("Location not found")?;

    check_permission(ctx, location.organization_id, "stock_location", "write")?;

    let new_name = name.unwrap_or_else(|| location.name.clone());

    ctx.db.stock_location().id().update(StockLocation {
        name: new_name.clone(),
        complete_name: Some(new_name),
        usage: usage.unwrap_or_else(|| location.usage.clone()),
        active: active.unwrap_or(location.active),
        scrap_location: scrap_location.unwrap_or(location.scrap_location),
        return_location: return_location.unwrap_or(location.return_location),
        barcode: barcode.or(location.barcode),
        comment: comment.or(location.comment),
        posx: posx.unwrap_or(location.posx),
        posy: posy.unwrap_or(location.posy),
        posz: posz.unwrap_or(location.posz),
        updated_at: ctx.timestamp,
        ..location
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_stock_location(ctx: &ReducerContext, location_id: u64) -> Result<(), String> {
    let location = ctx
        .db
        .stock_location()
        .id()
        .find(&location_id)
        .ok_or("Location not found")?;

    check_permission(ctx, location.organization_id, "stock_location", "delete")?;

    if !location.child_ids.is_empty() {
        return Err("Cannot delete location with child locations".to_string());
    }

    ctx.db.stock_location().id().update(StockLocation {
        active: false,
        is_active: false,
        updated_at: ctx.timestamp,
        ..location
    });

    if let Some(pid) = location.location_id {
        if let Some(mut parent) = ctx.db.stock_location().id().find(&pid) {
            parent.child_ids.retain(|&id| id != location_id);
            ctx.db.stock_location().id().update(parent);
        }
    }

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: STOCK ROUTE
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_stock_route(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    sequence: i32,
    company_id: Option<u64>,
    product_selectable: bool,
    product_categ_selectable: bool,
    warehouse_selectable: bool,
    sale_selectable: bool,
    purchase_selectable: bool,
    manufacture_selectable: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_route", "create")?;

    if name.is_empty() {
        return Err("Route name cannot be empty".to_string());
    }

    let route = ctx.db.stock_route().insert(StockRoute {
        id: 0,
        organization_id,
        name: name.clone(),
        sequence,
        active: true,
        company_id,
        product_selectable,
        product_categ_selectable,
        warehouse_selectable,
        shipping_selectable: false,
        sale_selectable,
        manufacture_selectable,
        purchase_selectable,
        mto_selectable: false,
        rule_ids: vec![],
        is_active: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: None,
    });

    write_audit_log(
        ctx,
        organization_id,
        company_id,
        "stock_route",
        route.id,
        "create",
        None,
        Some(serde_json::json!({ "name": name }).to_string()),
        vec!["name".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_stock_route(
    ctx: &ReducerContext,
    route_id: u64,
    name: Option<String>,
    sequence: Option<i32>,
    active: Option<bool>,
    product_selectable: Option<bool>,
    warehouse_selectable: Option<bool>,
    sale_selectable: Option<bool>,
    purchase_selectable: Option<bool>,
) -> Result<(), String> {
    let route = ctx
        .db
        .stock_route()
        .id()
        .find(&route_id)
        .ok_or("Route not found")?;

    check_permission(ctx, route.organization_id, "stock_route", "write")?;

    ctx.db.stock_route().id().update(StockRoute {
        name: name.unwrap_or_else(|| route.name.clone()),
        sequence: sequence.unwrap_or(route.sequence),
        active: active.unwrap_or(route.active),
        product_selectable: product_selectable.unwrap_or(route.product_selectable),
        warehouse_selectable: warehouse_selectable.unwrap_or(route.warehouse_selectable),
        sale_selectable: sale_selectable.unwrap_or(route.sale_selectable),
        purchase_selectable: purchase_selectable.unwrap_or(route.purchase_selectable),
        updated_at: ctx.timestamp,
        ..route
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_stock_route(ctx: &ReducerContext, route_id: u64) -> Result<(), String> {
    let route = ctx
        .db
        .stock_route()
        .id()
        .find(&route_id)
        .ok_or("Route not found")?;

    check_permission(ctx, route.organization_id, "stock_route", "delete")?;

    if !route.rule_ids.is_empty() {
        return Err("Cannot delete route with associated rules".to_string());
    }

    ctx.db.stock_route().id().update(StockRoute {
        active: false,
        is_active: false,
        updated_at: ctx.timestamp,
        ..route
    });

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: STOCK RULE
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_stock_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    action: String,
    location_dest_id: u64,
    picking_type_id: u64,
    procure_method: String,
    route_id: Option<u64>,
    location_src_id: Option<u64>,
    company_id: Option<u64>,
    delay: i32,
    warehouse_id: Option<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_rule", "create")?;

    if name.is_empty() {
        return Err("Rule name cannot be empty".to_string());
    }

    let rule = ctx.db.stock_rule().insert(StockRule {
        id: 0,
        organization_id,
        name: name.clone(),
        action,
        active: true,
        sequence: 10,
        group_id: None,
        location_src_id,
        location_dest_id,
        location_id: None,
        procure_method,
        route_sequence: 10,
        route_id,
        picking_type_id,
        company_id,
        delay,
        propagate_cancel: true,
        warehouse_id,
        propagate_warehouse_id: None,
        auto: "manual".to_string(),
        group_propagation_option: "propagate".to_string(),
        notify_stock: false,
        is_active: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: None,
    });

    if let Some(rid) = route_id {
        if let Some(mut route) = ctx.db.stock_route().id().find(&rid) {
            route.rule_ids.push(rule.id);
            ctx.db.stock_route().id().update(route);
        }
    }

    write_audit_log(
        ctx,
        organization_id,
        company_id,
        "stock_rule",
        rule.id,
        "create",
        None,
        Some(serde_json::json!({ "name": name, "action": rule.action }).to_string()),
        vec!["name".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_stock_rule(
    ctx: &ReducerContext,
    rule_id: u64,
    name: Option<String>,
    action: Option<String>,
    active: Option<bool>,
    sequence: Option<i32>,
    delay: Option<i32>,
    propagate_cancel: Option<bool>,
    notify_stock: Option<bool>,
) -> Result<(), String> {
    let rule = ctx
        .db
        .stock_rule()
        .id()
        .find(&rule_id)
        .ok_or("Rule not found")?;

    check_permission(ctx, rule.organization_id, "stock_rule", "write")?;

    ctx.db.stock_rule().id().update(StockRule {
        name: name.unwrap_or_else(|| rule.name.clone()),
        action: action.unwrap_or_else(|| rule.action.clone()),
        active: active.unwrap_or(rule.active),
        sequence: sequence.unwrap_or(rule.sequence),
        delay: delay.unwrap_or(rule.delay),
        propagate_cancel: propagate_cancel.unwrap_or(rule.propagate_cancel),
        notify_stock: notify_stock.unwrap_or(rule.notify_stock),
        updated_at: ctx.timestamp,
        ..rule
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_stock_rule(ctx: &ReducerContext, rule_id: u64) -> Result<(), String> {
    let rule = ctx
        .db
        .stock_rule()
        .id()
        .find(&rule_id)
        .ok_or("Rule not found")?;

    check_permission(ctx, rule.organization_id, "stock_rule", "delete")?;

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
        ..rule
    });

    Ok(())
}
