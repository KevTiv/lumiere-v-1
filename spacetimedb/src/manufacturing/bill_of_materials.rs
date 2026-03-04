/// Bill of Materials Module — BOMs, BOM Lines, and Routing Operations
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **MrpBom** | Bill of Materials header |
/// | **MrpBomLine** | BOM component lines |
/// | **MrpRoutingWorkcenter** | Routing workcenter operations |
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};
use crate::inventory::product::product;
use crate::types::BomType;

// ============================================================================
// BILL OF MATERIALS TABLES
// ============================================================================

/// Bill of Materials — Defines the components required to manufacture a product
#[spacetimedb::table(
    accessor = mrp_bom,
    public,
    index(name = "by_product", accessor = mrp_bom_by_product, btree(columns = [product_id])),
    index(name = "by_company", accessor = mrp_bom_by_company, btree(columns = [company_id]))
)]
pub struct MrpBom {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub type_: BomType,
    pub product_id: u64,
    pub product_tmpl_id: u64,
    pub product_qty: f64,
    pub product_uom_id: u64,
    pub sequence: u32,
    pub company_id: u64,
    pub ready_to_produce: String,
    pub consumption: String,
    pub picking_type_id: Option<u64>,
    pub location_src_id: Option<u64>,
    pub location_dest_id: Option<u64>,
    pub warehouse_id: Option<u64>,
    pub routing_id: Option<u64>,
    pub bom_line_ids: Vec<u64>,
    pub byproduct_ids: Vec<u64>,
    pub operation_ids: Vec<u64>,
    pub message_follower_ids: Vec<u64>,
    pub activity_ids: Vec<u64>,
    pub message_ids: Vec<u64>,
    pub estimated_cost: f64,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// BOM Line — Component lines defining materials needed for a BOM
#[spacetimedb::table(
    accessor = mrp_bom_line,
    public,
    index(name = "by_bom", accessor = mrp_bom_line_by_bom, btree(columns = [bom_id]))
)]
pub struct MrpBomLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub bom_id: u64,
    pub product_id: u64,
    pub product_tmpl_id: u64,
    pub product_qty: f64,
    pub product_uom_id: u64,
    pub sequence: u32,
    pub manual_consumption: bool,
    pub operation_id: Option<u64>,
    pub bom_product_template_attribute_value_ids: Vec<u64>,
    pub parent_product_tmpl_id: Option<u64>,
    pub possible_bom_product_template_attribute_value_ids: Vec<u64>,
    pub child_bom_id: Option<u64>,
    pub child_line_ids: Vec<u64>,
    pub attachments_count: u32,
    pub company_id: u64,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Routing Workcenter — Defines operations and work centers for manufacturing
#[spacetimedb::table(
    accessor = mrp_routing_workcenter,
    public,
    index(name = "by_workcenter", accessor = mrp_routing_by_workcenter, btree(columns = [workcenter_id]))
)]
pub struct MrpRoutingWorkcenter {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub workcenter_id: u64,
    pub name: String,
    pub worksheet: Option<String>,
    pub worksheet_type: String,
    pub worksheet_google_slide: Option<String>,
    pub time_mode: String,
    pub time_mode_batch: u32,
    pub time_cycle_manual: f64,
    pub time_cycle: f64,
    pub sequence: u32,
    pub company_id: u64,
    pub worksheet_url: Option<String>,
    pub blocked_by_operation_ids: Vec<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Debug, Clone)]
pub struct BomExplosionRow {
    pub root_bom_id: u64,
    pub parent_bom_id: u64,
    pub bom_id: u64,
    pub line_id: Option<u64>,
    pub product_id: u64,
    pub level: u32,
    pub qty: f64,
}

/// Cached exploded BOM output for client-side querying/reporting.
#[spacetimedb::table(
    accessor = bom_explosion_result,
    public,
    index(name = "by_root_bom", accessor = bom_explosion_by_root_bom, btree(columns = [root_bom_id])),
    index(name = "by_bom", accessor = bom_explosion_by_bom, btree(columns = [bom_id]))
)]
pub struct BomExplosionResult {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub company_id: u64,
    pub root_bom_id: u64,
    pub parent_bom_id: u64,
    pub bom_id: u64,
    pub line_id: Option<u64>,
    pub product_id: u64,
    pub level: u32,
    pub qty: f64,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

// ============================================================================
// REDUCERS
// ============================================================================

/// Input type for creating a BOM
#[derive(SpacetimeType, Debug, Clone)]
pub struct BomLineInput {
    pub product_id: u64,
    pub product_qty: f64,
    pub product_uom_id: u64,
    pub sequence: u32,
    pub manual_consumption: bool,
    pub operation_id: Option<u64>,
}

/// Create a new Bill of Materials
#[reducer]
pub fn create_bom(
    ctx: &ReducerContext,
    company_id: u64,
    type_: BomType,
    product_id: u64,
    product_tmpl_id: u64,
    product_qty: f64,
    product_uom_id: u64,
    ready_to_produce: String,
    consumption: String,
    picking_type_id: Option<u64>,
    location_src_id: Option<u64>,
    location_dest_id: Option<u64>,
    warehouse_id: Option<u64>,
    routing_id: Option<u64>,
    lines: Vec<BomLineInput>,
) -> Result<(), String> {
    check_permission(ctx, company_id, "mrp_bom", "create")?;

    // Create BOM header
    let bom = ctx.db.mrp_bom().insert(MrpBom {
        id: 0,
        type_,
        product_id,
        product_tmpl_id,
        product_qty,
        product_uom_id,
        sequence: 0,
        company_id,
        ready_to_produce,
        consumption,
        picking_type_id,
        location_src_id,
        location_dest_id,
        warehouse_id,
        routing_id,
        bom_line_ids: Vec::new(),
        byproduct_ids: Vec::new(),
        operation_ids: Vec::new(),
        message_follower_ids: Vec::new(),
        activity_ids: Vec::new(),
        message_ids: Vec::new(),
        estimated_cost: 0.0,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    // Create BOM lines
    let mut line_ids = Vec::new();
    for line_input in lines {
        let product = ctx
            .db
            .product()
            .id()
            .find(&line_input.product_id)
            .ok_or("Product not found")?;

        let line = ctx.db.mrp_bom_line().insert(MrpBomLine {
            id: 0,
            bom_id: bom.id,
            product_id: line_input.product_id,
            product_tmpl_id: product.id,
            product_qty: line_input.product_qty,
            product_uom_id: line_input.product_uom_id,
            sequence: line_input.sequence,
            manual_consumption: line_input.manual_consumption,
            operation_id: line_input.operation_id,
            bom_product_template_attribute_value_ids: Vec::new(),
            parent_product_tmpl_id: None,
            possible_bom_product_template_attribute_value_ids: Vec::new(),
            child_bom_id: None,
            child_line_ids: Vec::new(),
            attachments_count: 0,
            company_id,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: None,
        });
        line_ids.push(line.id);
    }

    // Update BOM with line IDs
    ctx.db.mrp_bom().id().update(MrpBom {
        bom_line_ids: line_ids,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..bom
    });

    // Compute initial cached BOM cost
    compute_bom_cost(ctx, company_id, bom.id)?;

    write_audit_log(
        ctx,
        company_id,
        None,
        "mrp_bom",
        bom.id,
        "create",
        None,
        None,
        vec!["created".to_string()],
    );

    log::info!("BOM created: id={}", bom.id);
    Ok(())
}

/// Update an existing Bill of Materials
#[reducer]
pub fn update_bom(
    ctx: &ReducerContext,
    company_id: u64,
    bom_id: u64,
    product_qty: f64,
    ready_to_produce: String,
    consumption: String,
) -> Result<(), String> {
    check_permission(ctx, company_id, "mrp_bom", "write")?;

    let bom = ctx.db.mrp_bom().id().find(&bom_id).ok_or("BOM not found")?;

    if bom.company_id != company_id {
        return Err("BOM does not belong to this company".to_string());
    }

    let _updated = ctx.db.mrp_bom().id().update(MrpBom {
        product_qty,
        ready_to_produce,
        consumption,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..bom
    });

    compute_bom_cost(ctx, company_id, bom_id)?;

    write_audit_log(
        ctx,
        company_id,
        None,
        "mrp_bom",
        bom_id,
        "write",
        None,
        None,
        vec!["updated".to_string()],
    );

    log::info!("BOM updated: id={}", bom_id);
    Ok(())
}

/// Delete a Bill of Materials
#[reducer]
pub fn delete_bom(ctx: &ReducerContext, company_id: u64, bom_id: u64) -> Result<(), String> {
    check_permission(ctx, company_id, "mrp_bom", "delete")?;

    let bom = ctx.db.mrp_bom().id().find(&bom_id).ok_or("BOM not found")?;

    if bom.company_id != company_id {
        return Err("BOM does not belong to this company".to_string());
    }

    // Delete associated BOM lines
    for line_id in &bom.bom_line_ids {
        ctx.db.mrp_bom_line().id().delete(line_id);
    }

    // Delete cached explosion rows for this root BOM
    let explosion_ids: Vec<u64> = ctx
        .db
        .bom_explosion_result()
        .bom_explosion_by_root_bom()
        .filter(&bom_id)
        .map(|r| r.id)
        .collect();
    for row_id in explosion_ids {
        ctx.db.bom_explosion_result().id().delete(&row_id);
    }

    ctx.db.mrp_bom().id().delete(&bom_id);

    write_audit_log(
        ctx,
        company_id,
        None,
        "mrp_bom",
        bom_id,
        "delete",
        None,
        None,
        vec!["deleted".to_string()],
    );

    log::info!("BOM deleted: id={}", bom_id);
    Ok(())
}

/// Create a routing workcenter operation
#[reducer]
pub fn create_routing_workcenter(
    ctx: &ReducerContext,
    company_id: u64,
    workcenter_id: u64,
    name: String,
    worksheet: Option<String>,
    worksheet_type: String,
    time_mode: String,
    time_mode_batch: u32,
    time_cycle_manual: f64,
    sequence: u32,
) -> Result<(), String> {
    check_permission(ctx, company_id, "mrp_routing_workcenter", "create")?;

    let routing = ctx
        .db
        .mrp_routing_workcenter()
        .insert(MrpRoutingWorkcenter {
            id: 0,
            workcenter_id,
            name,
            worksheet,
            worksheet_type,
            worksheet_google_slide: None,
            time_mode,
            time_mode_batch,
            time_cycle_manual,
            time_cycle: time_cycle_manual,
            sequence,
            company_id,
            worksheet_url: None,
            blocked_by_operation_ids: Vec::new(),
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: None,
        });

    write_audit_log(
        ctx,
        company_id,
        None,
        "mrp_routing_workcenter",
        routing.id,
        "create",
        None,
        None,
        vec!["created".to_string()],
    );

    log::info!("Routing workcenter created: id={}", routing.id);
    Ok(())
}

fn clear_bom_explosion_cache(ctx: &ReducerContext, root_bom_id: u64) {
    let ids: Vec<u64> = ctx
        .db
        .bom_explosion_result()
        .bom_explosion_by_root_bom()
        .filter(&root_bom_id)
        .map(|r| r.id)
        .collect();

    for id in ids {
        ctx.db.bom_explosion_result().id().delete(&id);
    }
}

fn explode_bom_recursive(
    ctx: &ReducerContext,
    company_id: u64,
    root_bom_id: u64,
    parent_bom_id: u64,
    bom_id: u64,
    level: u32,
    qty_factor: f64,
    visited: &mut Vec<u64>,
) -> Result<(), String> {
    if visited.contains(&bom_id) {
        return Err("Circular BOM dependency detected".to_string());
    }

    let bom = ctx.db.mrp_bom().id().find(&bom_id).ok_or("BOM not found")?;
    if bom.company_id != company_id {
        return Err("BOM does not belong to this company".to_string());
    }

    visited.push(bom_id);

    // Emit header row
    ctx.db.bom_explosion_result().insert(BomExplosionResult {
        id: 0,
        company_id,
        root_bom_id,
        parent_bom_id,
        bom_id,
        line_id: None,
        product_id: bom.product_id,
        level,
        qty: bom.product_qty * qty_factor,
        created_at: ctx.timestamp,
        metadata: None,
    });

    let component_lines: Vec<MrpBomLine> = ctx
        .db
        .mrp_bom_line()
        .mrp_bom_line_by_bom()
        .filter(&bom_id)
        .collect();

    for line in component_lines {
        let line_qty = line.product_qty * qty_factor;

        ctx.db.bom_explosion_result().insert(BomExplosionResult {
            id: 0,
            company_id,
            root_bom_id,
            parent_bom_id: bom_id,
            bom_id,
            line_id: Some(line.id),
            product_id: line.product_id,
            level: level + 1,
            qty: line_qty,
            created_at: ctx.timestamp,
            metadata: None,
        });

        if let Some(child_bom_id) = line.child_bom_id {
            explode_bom_recursive(
                ctx,
                company_id,
                root_bom_id,
                bom_id,
                child_bom_id,
                level + 1,
                line_qty,
                visited,
            )?;
        }
    }

    visited.pop();
    Ok(())
}

/// Compute and cache estimated BOM cost using component standard costs.
#[reducer]
pub fn compute_bom_cost(ctx: &ReducerContext, company_id: u64, bom_id: u64) -> Result<(), String> {
    check_permission(ctx, company_id, "mrp_bom", "write")?;

    let bom = ctx.db.mrp_bom().id().find(&bom_id).ok_or("BOM not found")?;
    if bom.company_id != company_id {
        return Err("BOM does not belong to this company".to_string());
    }

    let lines: Vec<MrpBomLine> = ctx
        .db
        .mrp_bom_line()
        .mrp_bom_line_by_bom()
        .filter(&bom_id)
        .collect();

    let mut estimated_cost = 0.0;
    for line in lines {
        let product = ctx
            .db
            .product()
            .id()
            .find(&line.product_id)
            .ok_or("Component product not found")?;
        estimated_cost += line.product_qty * product.standard_price;
    }

    ctx.db.mrp_bom().id().update(MrpBom {
        estimated_cost,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..bom
    });

    write_audit_log(
        ctx,
        company_id,
        None,
        "mrp_bom",
        bom_id,
        "write",
        None,
        None,
        vec!["estimated_cost".to_string()],
    );

    Ok(())
}

/// Rebuild cached BOM explosion rows for a root BOM.
#[reducer]
pub fn explode_bom(ctx: &ReducerContext, company_id: u64, bom_id: u64) -> Result<(), String> {
    check_permission(ctx, company_id, "mrp_bom", "read")?;

    let bom = ctx.db.mrp_bom().id().find(&bom_id).ok_or("BOM not found")?;
    if bom.company_id != company_id {
        return Err("BOM does not belong to this company".to_string());
    }

    clear_bom_explosion_cache(ctx, bom_id);

    let mut visited = Vec::new();
    explode_bom_recursive(
        ctx,
        company_id,
        bom_id,
        bom_id,
        bom_id,
        0,
        1.0,
        &mut visited,
    )?;

    write_audit_log(
        ctx,
        company_id,
        None,
        "bom_explosion_result",
        bom_id,
        "create",
        None,
        None,
        vec!["exploded".to_string()],
    );

    Ok(())
}
