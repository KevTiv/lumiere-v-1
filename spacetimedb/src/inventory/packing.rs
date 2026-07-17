//! Packing workflow — physical stock packages beyond cartonization suggestions.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::inventory_close::assert_inventory_writable;
use crate::inventory::product::product;
use crate::inventory::stock::{stock_move, stock_picking, StockMove};
use crate::inventory::warehouse::warehouse;
use crate::inventory::warehouse_operations::packaging_material;
use serde_json;

// ── Tables ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
#[spacetimedb::table(
    accessor = stock_package,
    public,
    index(accessor = stock_package_by_org, btree(columns = [organization_id])),
    index(accessor = stock_package_by_company, btree(columns = [company_id])),
    index(accessor = stock_package_by_picking, btree(columns = [picking_id])),
    index(accessor = stock_package_by_state, btree(columns = [state]))
)]
pub struct StockPackage {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    /// draft | confirmed | done | cancelled
    pub state: String,
    pub packaging_material_id: Option<u64>,
    /// Denormalized for index filterability (0 = none).
    pub picking_id: u64,
    pub location_id: Option<u64>,
    pub location_dest_id: Option<u64>,
    pub weight: f64,
    pub volume: f64,
    pub move_ids: Vec<u64>,
    pub shipping_weight: f64,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateStockPackageParams {
    pub name: String,
    pub packaging_material_id: Option<u64>,
    pub picking_id: Option<u64>,
    pub location_id: Option<u64>,
    pub location_dest_id: Option<u64>,
    pub weight: f64,
    pub volume: f64,
    pub shipping_weight: f64,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct PackMovesIntoPackageParams {
    pub move_ids: Vec<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct PackStockPickingParams {
    pub picking_id: u64,
    pub packaging_material_id: Option<u64>,
    pub name: Option<String>,
    pub metadata: Option<String>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

pub(crate) fn insert_stock_package(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateStockPackageParams,
) -> Result<StockPackage, String> {
    if params.name.trim().is_empty() {
        return Err("Package name cannot be empty".to_string());
    }
    if let Some(mid) = params.packaging_material_id {
        let mat = ctx
            .db
            .packaging_material()
            .id()
            .find(&mid)
            .ok_or("Packaging material not found")?;
        if mat.organization_id != organization_id {
            return Err("Packaging material does not belong to this organization".to_string());
        }
    }
    let picking_id = params.picking_id.unwrap_or(0);
    if picking_id > 0 {
        let picking = ctx
            .db
            .stock_picking()
            .id()
            .find(&picking_id)
            .ok_or("Picking not found")?;
        if picking.organization_id != organization_id || picking.company_id != company_id {
            return Err("Picking does not belong to this company".to_string());
        }
    }

    Ok(ctx.db.stock_package().insert(StockPackage {
        id: 0,
        organization_id,
        company_id,
        name: params.name.clone(),
        state: "draft".to_string(),
        packaging_material_id: params.packaging_material_id,
        picking_id,
        location_id: params.location_id,
        location_dest_id: params.location_dest_id,
        weight: params.weight,
        volume: params.volume,
        move_ids: vec![],
        shipping_weight: params.shipping_weight,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    }))
}

fn require_package(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    package_id: u64,
) -> Result<StockPackage, String> {
    let pkg = ctx
        .db
        .stock_package()
        .id()
        .find(&package_id)
        .ok_or("Stock package not found")?;
    if pkg.organization_id != organization_id || pkg.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    Ok(pkg)
}

fn stamp_moves_package(
    ctx: &ReducerContext,
    move_ids: &[u64],
    package_id: u64,
    organization_id: u64,
    company_id: u64,
) -> Result<(), String> {
    for &move_id in move_ids {
        let mv = ctx
            .db
            .stock_move()
            .id()
            .find(&move_id)
            .ok_or_else(|| format!("Stock move {move_id} not found"))?;
        if mv.organization_id != organization_id || mv.company_id != company_id {
            return Err(format!("Move {move_id} does not belong to this company"));
        }
        if mv.state == "cancel" {
            return Err(format!("Cannot pack cancelled move {move_id}"));
        }
        ctx.db.stock_move().id().update(StockMove {
            result_package_id: Some(package_id),
            package_id: Some(package_id),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..mv
        });
    }
    Ok(())
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_stock_package(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateStockPackageParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_picking", "create")?;
    assert_inventory_writable(ctx, organization_id, company_id)?;
    let row = insert_stock_package(ctx, organization_id, company_id, params)?;
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_package",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "name": row.name, "state": row.state }).to_string(),
            ),
            changed_fields: vec!["name".to_string(), "state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Attach open moves to a draft package (does not yet stamp result_package_id).
#[reducer]
pub fn pack_moves_into_package(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    package_id: u64,
    params: PackMovesIntoPackageParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_picking", "update")?;
    assert_inventory_writable(ctx, organization_id, company_id)?;
    let pkg = require_package(ctx, organization_id, company_id, package_id)?;
    if pkg.state != "draft" {
        return Err(format!("Only draft packages can accept moves (state: {})", pkg.state));
    }
    if params.move_ids.is_empty() {
        return Err("move_ids cannot be empty".to_string());
    }

    let mut move_ids = pkg.move_ids.clone();
    let mut weight = pkg.weight;
    let mut volume = pkg.volume;
    for &move_id in &params.move_ids {
        let mv = ctx
            .db
            .stock_move()
            .id()
            .find(&move_id)
            .ok_or_else(|| format!("Stock move {move_id} not found"))?;
        if mv.organization_id != organization_id || mv.company_id != company_id {
            return Err(format!("Move {move_id} does not belong to this company"));
        }
        if mv.state == "done" || mv.state == "cancel" {
            return Err(format!("Move {move_id} is {} — cannot pack", mv.state));
        }
        if pkg.picking_id > 0 {
            let pk = mv.picking_id.unwrap_or(0);
            if pk != pkg.picking_id {
                return Err(format!(
                    "Move {move_id} picking {} does not match package picking {}",
                    pk, pkg.picking_id
                ));
            }
        }
        if !move_ids.contains(&move_id) {
            move_ids.push(move_id);
        }
        let qty = mv.product_qty.max(mv.product_uom_qty).max(0.0);
        if let Some(prod) = ctx.db.product().id().find(&mv.product_id) {
            let unit_wt = if prod.weight > 0.0 { prod.weight } else { 0.1 };
            let unit_vol = if prod.volume > 0.0 { prod.volume } else { 1.0 };
            weight += unit_wt * qty;
            volume += unit_vol * qty;
        } else {
            weight += qty * 0.1;
            volume += qty;
        }
    }

    ctx.db.stock_package().id().update(StockPackage {
        move_ids: move_ids.clone(),
        weight,
        volume,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata.or(pkg.metadata.clone()),
        ..pkg
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_package",
            record_id: package_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "move_ids": move_ids, "weight": weight }).to_string(),
            ),
            changed_fields: vec!["move_ids".to_string(), "weight".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Confirm package: stamp `result_package_id` on contained moves.
#[reducer]
pub fn confirm_stock_package(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    package_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_picking", "update")?;
    assert_inventory_writable(ctx, organization_id, company_id)?;
    let pkg = require_package(ctx, organization_id, company_id, package_id)?;
    if pkg.state != "draft" {
        return Err(format!("Only draft packages can be confirmed (state: {})", pkg.state));
    }
    if pkg.move_ids.is_empty() {
        return Err("Package has no moves — pack_moves_into_package first".to_string());
    }

    stamp_moves_package(
        ctx,
        &pkg.move_ids,
        package_id,
        organization_id,
        company_id,
    )?;

    ctx.db.stock_package().id().update(StockPackage {
        state: "confirmed".to_string(),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..pkg
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_package",
            record_id: package_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "draft" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "confirmed" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Mark package done (ready to ship / leave pack zone).
#[reducer]
pub fn done_stock_package(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    package_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_picking", "update")?;
    assert_inventory_writable(ctx, organization_id, company_id)?;
    let pkg = require_package(ctx, organization_id, company_id, package_id)?;
    if pkg.state != "confirmed" {
        return Err(format!("Only confirmed packages can be done (state: {})", pkg.state));
    }

    // Prefer warehouse pack location when dest unset.
    let location_dest_id = pkg.location_dest_id.or_else(|| {
        if pkg.picking_id == 0 {
            return None;
        }
        let picking = ctx.db.stock_picking().id().find(&pkg.picking_id)?;
        ctx.db.warehouse().iter().find_map(|w| {
            if w.organization_id == organization_id
                && w.company_id == company_id
                && (picking.location_id == w.lot_stock_id
                    || picking.location_dest_id == w.lot_stock_id
                    || picking.location_id == w.id)
            {
                w.wh_pack_stock_loc_id
            } else {
                None
            }
        })
    });

    ctx.db.stock_package().id().update(StockPackage {
        state: "done".to_string(),
        location_dest_id,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..pkg
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_package",
            record_id: package_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "confirmed" }).to_string()),
            new_values: Some(
                serde_json::json!({
                    "state": "done",
                    "location_dest_id": location_dest_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn cancel_stock_package(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    package_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_picking", "update")?;
    assert_inventory_writable(ctx, organization_id, company_id)?;
    let pkg = require_package(ctx, organization_id, company_id, package_id)?;
    if pkg.state == "done" {
        return Err("Done packages cannot be cancelled".to_string());
    }
    if pkg.state == "cancelled" {
        return Ok(());
    }

    // Clear package stamps on moves.
    for &move_id in &pkg.move_ids {
        if let Some(mv) = ctx.db.stock_move().id().find(&move_id) {
            if mv.result_package_id == Some(package_id) || mv.package_id == Some(package_id) {
                ctx.db.stock_move().id().update(StockMove {
                    result_package_id: None,
                    package_id: None,
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..mv
                });
            }
        }
    }

    ctx.db.stock_package().id().update(StockPackage {
        state: "cancelled".to_string(),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..pkg
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_package",
            record_id: package_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "state": "cancelled" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// One-shot: create draft package from picking open moves, pack them, confirm.
#[reducer]
pub fn pack_stock_picking(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: PackStockPickingParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_picking", "update")?;
    assert_inventory_writable(ctx, organization_id, company_id)?;

    let picking = ctx
        .db
        .stock_picking()
        .id()
        .find(&params.picking_id)
        .ok_or("Picking not found")?;
    if picking.organization_id != organization_id || picking.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    let move_ids: Vec<u64> = ctx
        .db
        .stock_move()
        .move_by_picking()
        .filter(&params.picking_id)
        .filter(|m| m.state != "done" && m.state != "cancel")
        .map(|m| m.id)
        .collect();
    if move_ids.is_empty() {
        return Err("Picking has no open moves to pack".to_string());
    }

    let name = params
        .name
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| format!("PACK-{}", params.picking_id));

    let pkg = insert_stock_package(
        ctx,
        organization_id,
        company_id,
        CreateStockPackageParams {
            name,
            packaging_material_id: params.packaging_material_id,
            picking_id: Some(params.picking_id),
            location_id: Some(picking.location_id),
            location_dest_id: None,
            weight: 0.0,
            volume: 0.0,
            shipping_weight: 0.0,
            metadata: params.metadata.clone(),
        },
    )?;

    pack_moves_into_package(
        ctx,
        organization_id,
        company_id,
        pkg.id,
        PackMovesIntoPackageParams {
            move_ids,
            metadata: params.metadata.clone(),
        },
    )?;
    confirm_stock_package(ctx, organization_id, company_id, pkg.id)?;
    Ok(())
}
