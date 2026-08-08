/// Bill of Materials Module — BOMs, BOM Lines, and Routing Operations
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **MrpBom** | Bill of Materials header |
/// | **MrpBomLine** | BOM component lines |
/// | **MrpRoutingWorkcenter** | Routing workcenter operations |
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::company_id_from_scope;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::product::product;
use crate::manufacturing::relations::{
    require_bom_in_company, require_location_for_manufacturing, require_product_for_manufacturing,
    require_routing_workcenter_in_company, require_uom_compatible, require_uom_in_org,
    require_warehouse_for_manufacturing, validate_positive_qty,
};
use crate::manufacturing::manufacturing_orders::mrp_production;
use crate::manufacturing::work_centers::mrp_workcenter;
use crate::types::BomType;
use serde_json;

// ============================================================================
// BILL OF MATERIALS TABLES
// ============================================================================

/// Bill of Materials — Defines the components required to manufacture a product
#[derive(Clone)]
#[spacetimedb::table(
    accessor = mrp_bom,
    public,
    index(accessor = mrp_bom_by_org, btree(columns = [organization_id])),
    index(accessor = mrp_bom_by_product, btree(columns = [product_id])),
    index(accessor = mrp_bom_by_company, btree(columns = [company_id]))
)]
pub struct MrpBom {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64,
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
#[derive(Clone)]
#[spacetimedb::table(
    accessor = mrp_bom_line,
    public,
    index(accessor = mrp_bom_line_by_org, btree(columns = [organization_id])),
    index(accessor = mrp_bom_line_by_bom, btree(columns = [bom_id]))
)]
pub struct MrpBomLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64,
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
#[derive(Clone)]
#[spacetimedb::table(
    accessor = mrp_routing_workcenter,
    public,
    index(accessor = mrp_routing_by_org, btree(columns = [organization_id])),
    index(accessor = mrp_routing_by_workcenter, btree(columns = [workcenter_id]))
)]
pub struct MrpRoutingWorkcenter {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64,
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
#[derive(Clone)]
#[spacetimedb::table(
    accessor = bom_explosion_result,
    public,
    index(name = "by_root_bom", accessor = bom_explosion_by_root_bom, btree(columns = [root_bom_id])),
    index(accessor = bom_explosion_by_bom, btree(columns = [bom_id]))
)]
pub struct BomExplosionResult {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64,
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

// ── Input Params ─────────────────────────────────────────────────────────────

/// Component line input for BOM creation.
///
/// `product_tmpl_id` and `child_line_ids` are server-derived/managed and are
/// excluded from caller input. `parent_product_tmpl_id` is also derived from
/// the parent BOM product and excluded.
#[derive(SpacetimeType, Debug, Clone)]
pub struct BomLineInput {
    pub product_id: u64,
    pub product_qty: f64,
    pub product_uom_id: u64,
    pub sequence: u32,
    pub manual_consumption: bool,
    pub attachments_count: u32,
    pub operation_id: Option<u64>,
    pub child_bom_id: Option<u64>,
    pub bom_product_template_attribute_value_ids: Vec<u64>,
    pub possible_bom_product_template_attribute_value_ids: Vec<u64>,
    pub metadata: Option<String>,
}

/// BOM creation input — user intent only.
///
/// `product_tmpl_id` is derived from the loaded product. `estimated_cost` is
/// computed by `compute_bom_cost` after lines are inserted and is excluded
/// from caller input.
#[derive(SpacetimeType, Debug, Clone)]
pub struct CreateBomParams {
    pub company_id: Option<u64>,
    pub type_: BomType,
    pub product_id: u64,
    pub product_qty: f64,
    pub product_uom_id: u64,
    pub ready_to_produce: String,
    pub consumption: String,
    pub sequence: u32,
    pub lines: Vec<BomLineInput>,
    pub picking_type_id: Option<u64>,
    pub location_src_id: Option<u64>,
    pub location_dest_id: Option<u64>,
    pub warehouse_id: Option<u64>,
    pub routing_id: Option<u64>,
    pub metadata: Option<String>,
}

/// Update params for an existing BOM.
///
/// Scalar fields (`product_qty`, `ready_to_produce`, `consumption`, `sequence`)
/// use single-option — `None` preserves the existing value, `Some(v)` sets it.
///
/// Reference/clearable fields use double-option semantics:
/// - `None`         → preserve existing value (no change)
/// - `Some(None)`   → clear the field (set to NULL)
/// - `Some(Some(v))` → set to the given value
///
/// This allows callers to explicitly clear a previously-set warehouse, location,
/// routing, or picking-type reference without ambiguity.
#[derive(SpacetimeType, Debug, Clone)]
pub struct UpdateBomParams {
    pub product_qty: Option<f64>,
    pub ready_to_produce: Option<String>,
    pub consumption: Option<String>,
    pub sequence: Option<u32>,
    pub picking_type_id: Option<Option<u64>>,
    pub location_src_id: Option<Option<u64>>,
    pub location_dest_id: Option<Option<u64>>,
    pub warehouse_id: Option<Option<u64>>,
    pub routing_id: Option<Option<u64>>,
    pub metadata: Option<Option<String>>,
}

#[derive(SpacetimeType, Debug, Clone)]
pub struct CreateRoutingWorkcenterParams {
    pub workcenter_id: u64,
    pub name: String,
    pub worksheet_type: String,
    pub time_mode: String,
    pub time_mode_batch: u32,
    pub time_cycle_manual: f64,
    pub time_cycle: f64,
    pub sequence: u32,
    pub worksheet: Option<String>,
    pub worksheet_google_slide: Option<String>,
    pub worksheet_url: Option<String>,
    pub blocked_by_operation_ids: Vec<u64>,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

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
    organization_id: u64,
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
    if bom.organization_id != organization_id {
        return Err("BOM does not belong to this organization".to_string());
    }

    visited.push(bom_id);

    // Emit header row
    ctx.db.bom_explosion_result().insert(BomExplosionResult {
        id: 0,
        organization_id,
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
            organization_id,
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
                organization_id,
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

// ============================================================================
// REDUCERS: BILL OF MATERIALS
// ============================================================================

/// Create a new Bill of Materials.
///
/// `product_tmpl_id` is derived from the loaded product; callers do not supply
/// it. `estimated_cost` is computed after line insertion via `compute_bom_cost`.
#[reducer]
pub fn create_bom(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateBomParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mrp_bom", "create")?;

    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    // --- Validate BOM header relations ---

    validate_positive_qty(params.product_qty, "product_qty")?;

    let product =
        require_product_for_manufacturing(ctx, organization_id, params.product_id, "BOM product")?;

    let product_uom =
        require_uom_in_org(ctx, organization_id, product.uom_id, "BOM product UOM")?;
    let bom_uom =
        require_uom_in_org(ctx, organization_id, params.product_uom_id, "BOM quantity UOM")?;
    require_uom_compatible(&product_uom, &bom_uom, "BOM")?;

    if let Some(warehouse_id) = params.warehouse_id {
        require_warehouse_for_manufacturing(
            ctx,
            organization_id,
            company_id,
            warehouse_id,
            "BOM warehouse",
        )?;
    }

    if let Some(location_src_id) = params.location_src_id {
        require_location_for_manufacturing(
            ctx,
            organization_id,
            location_src_id,
            "BOM source location",
        )?;
    }

    if let Some(location_dest_id) = params.location_dest_id {
        require_location_for_manufacturing(
            ctx,
            organization_id,
            location_dest_id,
            "BOM destination location",
        )?;
    }

    if let Some(routing_id) = params.routing_id {
        require_routing_workcenter_in_company(
            ctx,
            organization_id,
            company_id,
            routing_id,
            "BOM routing",
        )?;
    }

    // Derive product_tmpl_id from the loaded product (products use their own id
    // as the template id in this schema).
    let product_tmpl_id = product.id;

    // Create BOM header
    let bom = ctx.db.mrp_bom().insert(MrpBom {
        id: 0,
        organization_id,
        type_: params.type_,
        product_id: params.product_id,
        product_tmpl_id,
        product_qty: params.product_qty,
        product_uom_id: params.product_uom_id,
        sequence: params.sequence,
        company_id,
        ready_to_produce: params.ready_to_produce,
        consumption: params.consumption,
        picking_type_id: params.picking_type_id,
        location_src_id: params.location_src_id,
        location_dest_id: params.location_dest_id,
        warehouse_id: params.warehouse_id,
        routing_id: params.routing_id,
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
        metadata: params.metadata,
    });

    // --- Validate and insert BOM lines ---
    let mut line_ids = Vec::new();
    for line_input in params.lines {
        validate_positive_qty(line_input.product_qty, "BOM line product_qty")?;

        let line_product = require_product_for_manufacturing(
            ctx,
            organization_id,
            line_input.product_id,
            "BOM line product",
        )?;

        let line_product_uom = require_uom_in_org(
            ctx,
            organization_id,
            line_product.uom_id,
            "BOM line product UOM",
        )?;
        let line_bom_uom = require_uom_in_org(
            ctx,
            organization_id,
            line_input.product_uom_id,
            "BOM line quantity UOM",
        )?;
        require_uom_compatible(&line_product_uom, &line_bom_uom, "BOM line")?;

        // Validate operation if supplied
        if let Some(op_id) = line_input.operation_id {
            require_routing_workcenter_in_company(
                ctx,
                organization_id,
                company_id,
                op_id,
                "BOM line operation",
            )?;
        }

        // Validate child BOM if supplied (prevents cross-company and missing references;
        // circular cycle detection happens during explosion).
        if let Some(child_bom_id) = line_input.child_bom_id {
            if child_bom_id == bom.id {
                return Err("BOM line cannot reference its own BOM as a child".to_string());
            }
            require_bom_in_company(
                ctx,
                organization_id,
                company_id,
                child_bom_id,
                "BOM line child BOM",
            )?;
        }

        // product_tmpl_id and parent_product_tmpl_id are derived from loaded rows;
        // child_line_ids is managed by the server.
        let line = ctx.db.mrp_bom_line().insert(MrpBomLine {
            id: 0,
            organization_id,
            bom_id: bom.id,
            product_id: line_input.product_id,
            product_tmpl_id: line_product.id,
            product_qty: line_input.product_qty,
            product_uom_id: line_input.product_uom_id,
            sequence: line_input.sequence,
            manual_consumption: line_input.manual_consumption,
            operation_id: line_input.operation_id,
            bom_product_template_attribute_value_ids: line_input
                .bom_product_template_attribute_value_ids,
            parent_product_tmpl_id: Some(product_tmpl_id),
            possible_bom_product_template_attribute_value_ids: line_input
                .possible_bom_product_template_attribute_value_ids,
            child_bom_id: line_input.child_bom_id,
            child_line_ids: Vec::new(),
            attachments_count: line_input.attachments_count,
            company_id,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: line_input.metadata,
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

    // Compute initial cached BOM cost (company derived from BOM)
    compute_bom_cost(ctx, organization_id, bom.id)?;

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "mrp_bom",
            record_id: bom.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "product_id": bom.product_id, "product_qty": bom.product_qty })
                    .to_string(),
            ),
            changed_fields: vec!["product_id".to_string(), "product_qty".to_string()],
            metadata: None,
        },
    );

    log::info!("BOM created: id={}", bom.id);
    Ok(())
}

/// Update an existing Bill of Materials.
///
/// Company is derived from the stored BOM — callers do not supply it.
#[reducer]
pub fn update_bom(
    ctx: &ReducerContext,
    organization_id: u64,
    bom_id: u64,
    params: UpdateBomParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mrp_bom", "write")?;

    let bom = ctx.db.mrp_bom().id().find(&bom_id).ok_or("BOM not found")?;

    if bom.organization_id != organization_id {
        return Err("BOM does not belong to this organization".to_string());
    }

    // Derive company from the BOM — never trust a parallel caller argument.
    let company_id = bom.company_id;

    if let Some(qty) = params.product_qty {
        validate_positive_qty(qty, "product_qty")?;
    }

    ctx.db.mrp_bom().id().update(MrpBom {
        product_qty: params.product_qty.unwrap_or(bom.product_qty),
        ready_to_produce: params
            .ready_to_produce
            .unwrap_or_else(|| bom.ready_to_produce.clone()),
        consumption: params
            .consumption
            .unwrap_or_else(|| bom.consumption.clone()),
        sequence: params.sequence.unwrap_or(bom.sequence),
        // Double-option: None = preserve, Some(None) = clear, Some(Some(v)) = set.
        picking_type_id: match params.picking_type_id {
            None => bom.picking_type_id,
            Some(v) => v,
        },
        location_src_id: match params.location_src_id {
            None => bom.location_src_id,
            Some(v) => v,
        },
        location_dest_id: match params.location_dest_id {
            None => bom.location_dest_id,
            Some(v) => v,
        },
        warehouse_id: match params.warehouse_id {
            None => bom.warehouse_id,
            Some(v) => v,
        },
        routing_id: match params.routing_id {
            None => bom.routing_id,
            Some(v) => v,
        },
        metadata: match params.metadata {
            None => bom.metadata.clone(),
            Some(v) => v,
        },
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..bom
    });

    compute_bom_cost(ctx, organization_id, bom_id)?;

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "mrp_bom",
            record_id: bom_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["updated".to_string()],
            metadata: None,
        },
    );

    log::info!("BOM updated: id={}", bom_id);
    Ok(())
}

/// Delete a Bill of Materials.
///
/// Company is derived from the stored BOM — callers do not supply it.
#[reducer]
pub fn delete_bom(
    ctx: &ReducerContext,
    organization_id: u64,
    bom_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mrp_bom", "delete")?;

    let bom = ctx.db.mrp_bom().id().find(&bom_id).ok_or("BOM not found")?;

    if bom.organization_id != organization_id {
        return Err("BOM does not belong to this organization".to_string());
    }

    // Derive company from the BOM for audit attribution.
    let company_id = bom.company_id;

    // Reject deletion if any manufacturing order references this BOM (MFG-004).
    let referencing_mo = ctx
        .db
        .mrp_production()
        .mrp_production_by_company()
        .filter(&company_id)
        .find(|mo| mo.bom_id == Some(bom_id));
    if referencing_mo.is_some() {
        return Err(format!(
            "cannot delete BOM {}: it is referenced by one or more manufacturing orders",
            bom_id
        ));
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

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "mrp_bom",
            record_id: bom_id,
            action: "DELETE",
            old_values: Some(
                serde_json::json!({ "product_id": bom.product_id, "product_qty": bom.product_qty })
                    .to_string(),
            ),
            new_values: None,
            changed_fields: vec!["deleted".to_string()],
            metadata: None,
        },
    );

    log::info!("BOM deleted: id={}", bom_id);
    Ok(())
}

// ============================================================================
// REDUCERS: ROUTING WORKCENTER
// ============================================================================

/// Create a routing workcenter operation.
///
/// Company is derived from the loaded workcenter — callers do not supply it.
/// Validates that the workcenter belongs to the organization and is active,
/// then uses its `company_id` for the new routing record.
///
/// `worksheet_type` must be one of: `"pdf"`, `"google_slide"`, `"url"`,
/// `"text"`, `"none"`.
/// `time_mode` must be one of: `"auto"`, `"manual"`.
/// Each entry in `blocked_by_operation_ids` must refer to an existing routing
/// operation in the same organization and company; no duplicates are allowed.
#[reducer]
pub fn create_routing_workcenter(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateRoutingWorkcenterParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mrp_routing_workcenter", "create")?;

    // Load workcenter to derive company — never trust a flat caller argument.
    let wc = ctx
        .db
        .mrp_workcenter()
        .id()
        .find(&params.workcenter_id)
        .ok_or("routing workcenter: workcenter not found")?;
    if wc.organization_id != organization_id {
        return Err(
            "routing workcenter: workcenter does not belong to this organization".to_string(),
        );
    }
    if !wc.active {
        return Err("routing workcenter: workcenter is not active".to_string());
    }
    let company_id = wc.company_id;

    // Validate worksheet_type enum values.
    match params.worksheet_type.as_str() {
        "pdf" | "google_slide" | "url" | "text" | "none" => {}
        other => {
            return Err(format!(
                "invalid worksheet_type '{other}': must be one of pdf, google_slide, url, text, none"
            ));
        }
    }

    // Validate time_mode enum values.
    match params.time_mode.as_str() {
        "auto" | "manual" => {}
        other => {
            return Err(format!(
                "invalid time_mode '{other}': must be one of auto, manual"
            ));
        }
    }

    // Validate blocked_by_operation_ids: no duplicates, each must exist in
    // same org and company.
    let mut seen_blocker_ids: Vec<u64> = Vec::new();
    for &blocker_id in &params.blocked_by_operation_ids {
        if seen_blocker_ids.contains(&blocker_id) {
            return Err(format!(
                "blocked_by_operation_ids contains duplicate id {blocker_id}"
            ));
        }
        seen_blocker_ids.push(blocker_id);

        let blocker = ctx
            .db
            .mrp_routing_workcenter()
            .id()
            .find(&blocker_id)
            .ok_or_else(|| format!("blocker operation {blocker_id} not found"))?;
        if blocker.organization_id != organization_id {
            return Err(format!(
                "blocker operation {blocker_id} does not belong to this organization"
            ));
        }
        if blocker.company_id != company_id {
            return Err(format!(
                "blocker operation {blocker_id} does not belong to this company"
            ));
        }
    }

    let routing = ctx
        .db
        .mrp_routing_workcenter()
        .insert(MrpRoutingWorkcenter {
            id: 0,
            organization_id,
            workcenter_id: params.workcenter_id,
            name: params.name.clone(),
            worksheet: params.worksheet,
            worksheet_type: params.worksheet_type,
            worksheet_google_slide: params.worksheet_google_slide,
            time_mode: params.time_mode,
            time_mode_batch: params.time_mode_batch,
            time_cycle_manual: params.time_cycle_manual,
            time_cycle: params.time_cycle,
            sequence: params.sequence,
            company_id,
            worksheet_url: params.worksheet_url,
            blocked_by_operation_ids: params.blocked_by_operation_ids,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: params.metadata,
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "mrp_routing_workcenter",
            record_id: routing.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": routing.name,
                    "workcenter_id": routing.workcenter_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["name".to_string(), "workcenter_id".to_string()],
            metadata: None,
        },
    );

    log::info!("Routing workcenter created: id={}", routing.id);
    Ok(())
}

// ============================================================================
// REDUCERS: BOM COST & EXPLOSION
// ============================================================================

/// Compute and cache estimated BOM cost using component standard costs.
///
/// Company is derived from the stored BOM — callers do not supply it.
#[reducer]
pub fn compute_bom_cost(
    ctx: &ReducerContext,
    organization_id: u64,
    bom_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mrp_bom", "write")?;

    let bom = ctx.db.mrp_bom().id().find(&bom_id).ok_or("BOM not found")?;
    if bom.organization_id != organization_id {
        return Err("BOM does not belong to this organization".to_string());
    }

    // Derive company from the BOM for audit attribution.
    let company_id = bom.company_id;

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

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "mrp_bom",
            record_id: bom_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "estimated_cost": estimated_cost }).to_string()),
            changed_fields: vec!["estimated_cost".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Rebuild cached BOM explosion rows for a root BOM.
///
/// Company is derived from the stored BOM — callers do not supply it.
#[reducer]
pub fn explode_bom(
    ctx: &ReducerContext,
    organization_id: u64,
    bom_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mrp_bom", "read")?;

    let bom = ctx.db.mrp_bom().id().find(&bom_id).ok_or("BOM not found")?;
    if bom.organization_id != organization_id {
        return Err("BOM does not belong to this organization".to_string());
    }

    // Derive company from the BOM for audit attribution.
    let company_id = bom.company_id;

    clear_bom_explosion_cache(ctx, bom_id);

    let mut visited = Vec::new();
    explode_bom_recursive(
        ctx,
        organization_id,
        bom_id,
        bom_id,
        bom_id,
        0,
        1.0,
        &mut visited,
    )?;

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "bom_explosion_result",
            record_id: bom_id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "root_bom_id": bom_id }).to_string()),
            changed_fields: vec!["exploded".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
