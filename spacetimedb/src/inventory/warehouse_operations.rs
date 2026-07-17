/// Warehouse Operations — Tables and Reducers
///
/// Tables:
///   - WarehouseTask
///   - PickingWave
///   - PackagingMaterial
///   - CartonizationResult
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::CompanyScopeParams;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::inventory_close::assert_inventory_writable;
use crate::inventory::packing::stock_package;
use crate::inventory::product::product;
use crate::inventory::stock::{
    assign_stock_picking, confirm_stock_picking, stock_move, stock_picking, StockMove,
};
use serde_json;

// ══════════════════════════════════════════════════════════════════════════════
// TABLES
// ══════════════════════════════════════════════════════════════════════════════

/// Warehouse Task
#[derive(Clone)]
#[spacetimedb::table(
    accessor = warehouse_task,
    public,
    index(accessor = task_by_org, btree(columns = [organization_id])),
    index(accessor = task_by_state, btree(columns = [state])),
    index(accessor = task_by_picking, btree(columns = [picking_id]))
)]
pub struct WarehouseTask {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub task_type: String,
    pub state: String,
    pub priority: String,
    pub user_id: Option<Identity>,
    pub picking_id: Option<u64>,
    pub move_id: Option<u64>,
    pub move_line_id: Option<u64>,
    pub location_id: Option<u64>,
    pub location_dest_id: Option<u64>,
    pub product_id: Option<u64>,
    pub lot_id: Option<u64>,
    pub package_id: Option<u64>,
    pub quantity: f64,
    pub uom_id: Option<u64>,
    pub company_id: u64,
    pub date_scheduled: Option<Timestamp>,
    pub date_started: Option<Timestamp>,
    pub date_finished: Option<Timestamp>,
    pub duration_expected: Option<f64>,
    pub duration_real: Option<f64>,
    pub notes: Option<String>,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

/// Picking Wave
#[derive(Clone)]
#[spacetimedb::table(
    accessor = picking_wave,
    public,
    index(accessor = wave_by_org, btree(columns = [organization_id])),
    index(accessor = wave_by_state, btree(columns = [state])),
    index(accessor = wave_by_type, btree(columns = [picking_type_id]))
)]
pub struct PickingWave {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub state: String,
    pub picking_type_id: u64,
    pub user_id: Option<Identity>,
    pub team_id: Option<u64>,
    pub date_start: Option<Timestamp>,
    pub date_done: Option<Timestamp>,
    pub picking_ids: Vec<u64>,
    pub move_line_ids: Vec<u64>,
    pub company_id: u64,
    pub is_wave: bool,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

/// Packaging Material
#[derive(Clone)]
#[spacetimedb::table(
    accessor = packaging_material,
    public,
    index(accessor = material_by_org, btree(columns = [organization_id])),
    index(accessor = material_by_type, btree(columns = [material_type]))
)]
pub struct PackagingMaterial {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub material_type: String,
    pub weight: f64,
    pub max_weight: f64,
    pub length: f64,
    pub width: f64,
    pub height: f64,
    pub volume: f64,
    pub cost: f64,
    pub currency_id: u64,
    pub barcode: Option<String>,
    pub is_active: bool,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

/// Cartonization Result
#[derive(Clone)]
#[spacetimedb::table(
    accessor = cartonization_result,
    public,
    index(accessor = cartonization_by_org, btree(columns = [organization_id])),
    index(accessor = cartonization_by_package, btree(columns = [package_id]))
)]
pub struct CartonizationResult {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub package_id: u64,
    pub packaging_material_id: u64,
    pub total_items: i32,
    pub total_volume: f64,
    pub total_weight: f64,
    pub utilization_percentage: f64,
    pub move_line_ids: Vec<u64>,
    pub is_optimal: bool,
    pub algorithm_used: String,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePickingWaveParams {
    pub name: String,
    pub picking_type_id: u64,
    pub state: String,
    pub is_wave: bool,
    pub picking_ids: Vec<u64>,
    pub move_line_ids: Vec<u64>,
    pub user_id: Option<Identity>,
    pub team_id: Option<u64>,
    pub date_start: Option<Timestamp>,
    pub date_done: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateWarehouseTaskParams {
    pub name: String,
    pub task_type: String,
    pub state: String,
    pub priority: String,
    pub quantity: f64,
    pub user_id: Option<Identity>,
    pub picking_id: Option<u64>,
    pub move_id: Option<u64>,
    pub move_line_id: Option<u64>,
    pub location_id: Option<u64>,
    pub location_dest_id: Option<u64>,
    pub product_id: Option<u64>,
    pub lot_id: Option<u64>,
    pub package_id: Option<u64>,
    pub uom_id: Option<u64>,
    pub date_scheduled: Option<Timestamp>,
    pub date_started: Option<Timestamp>,
    pub date_finished: Option<Timestamp>,
    pub duration_expected: Option<f64>,
    pub duration_real: Option<f64>,
    pub notes: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePackagingMaterialParams {
    pub name: String,
    pub material_type: String,
    pub weight: f64,
    pub max_weight: f64,
    pub length: f64,
    pub width: f64,
    pub height: f64,
    pub volume: f64,
    pub cost: f64,
    pub currency_id: u64,
    pub barcode: Option<String>,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RunCartonizationParams {
    pub picking_id: u64,
    /// Prefer this material; otherwise choose smallest fit by volume.
    pub packaging_material_id: Option<u64>,
    pub metadata: Option<String>,
}

struct CartonLine {
    move_id: u64,
    #[allow(dead_code)]
    product_id: u64,
    #[allow(dead_code)]
    qty: f64,
    volume: f64,
    weight: f64,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_picking_wave(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreatePickingWaveParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "picking_wave", "create")?;

    if params.name.is_empty() {
        return Err("Wave name cannot be empty".to_string());
    }

    let wave = ctx.db.picking_wave().insert(PickingWave {
        id: 0,
        organization_id,
        name: params.name.clone(),
        state: params.state.clone(),
        picking_type_id: params.picking_type_id,
        user_id: params.user_id,
        team_id: params.team_id,
        date_start: params.date_start,
        date_done: params.date_done,
        picking_ids: params.picking_ids,
        move_line_ids: params.move_line_ids,
        company_id,
        is_wave: params.is_wave,
        created_at: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "picking_wave",
            record_id: wave.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": wave.name,
                    "picking_type_id": wave.picking_type_id,
                    "state": wave.state,
                    "is_wave": wave.is_wave,
                })
                .to_string(),
            ),
            changed_fields: vec!["name".to_string(), "state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn create_warehouse_task(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateWarehouseTaskParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "warehouse_task", "create")?;

    if params.name.is_empty() {
        return Err("Task name cannot be empty".to_string());
    }

    let task = ctx.db.warehouse_task().insert(WarehouseTask {
        id: 0,
        organization_id,
        name: params.name.clone(),
        task_type: params.task_type.clone(),
        state: params.state.clone(),
        priority: params.priority.clone(),
        user_id: params.user_id,
        picking_id: params.picking_id,
        move_id: params.move_id,
        move_line_id: params.move_line_id,
        location_id: params.location_id,
        location_dest_id: params.location_dest_id,
        product_id: params.product_id,
        lot_id: params.lot_id,
        package_id: params.package_id,
        quantity: params.quantity,
        uom_id: params.uom_id,
        company_id,
        date_scheduled: params.date_scheduled,
        date_started: params.date_started,
        date_finished: params.date_finished,
        duration_expected: params.duration_expected,
        duration_real: params.duration_real,
        notes: params.notes,
        created_at: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "warehouse_task",
            record_id: task.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": task.name,
                    "task_type": task.task_type,
                    "state": task.state,
                    "priority": task.priority,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "name".to_string(),
                "task_type".to_string(),
                "state".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

/// Release a wave: confirm/assign linked pickings and create pick tasks per move.
#[reducer]
pub fn release_picking_wave(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    wave_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "picking_wave", "update")?;

    let wave = ctx
        .db
        .picking_wave()
        .id()
        .find(&wave_id)
        .ok_or("Wave not found")?;

    if wave.organization_id != organization_id {
        return Err("Wave does not belong to this organization".to_string());
    }
    if wave.company_id != company_id {
        return Err("Wave does not belong to this company".to_string());
    }
    if wave.state == "done" || wave.state == "cancelled" {
        return Err(format!("Cannot release wave in state {}", wave.state));
    }
    if wave.picking_ids.is_empty() {
        return Err("Wave has no pickings to release".to_string());
    }

    let scope = CompanyScopeParams {
        company_id: Some(company_id),
    };
    let mut tasks_created = 0u32;

    for &picking_id in &wave.picking_ids {
        let picking = ctx
            .db
            .stock_picking()
            .id()
            .find(&picking_id)
            .ok_or_else(|| format!("Picking {} not found for wave", picking_id))?;
        if picking.company_id != company_id {
            return Err(format!(
                "Picking {} does not belong to this company",
                picking_id
            ));
        }

        match picking.state.as_str() {
            "draft" => {
                confirm_stock_picking(ctx, organization_id, picking_id, scope.clone())?;
                assign_stock_picking(ctx, organization_id, picking_id, scope.clone())?;
            }
            "confirmed" => {
                assign_stock_picking(ctx, organization_id, picking_id, scope.clone())?;
            }
            "assigned" | "done" => {}
            other => {
                return Err(format!(
                    "Picking {} in state {} cannot be released in a wave",
                    picking_id, other
                ));
            }
        }

        for move_record in ctx
            .db
            .stock_move()
            .move_by_picking()
            .filter(&picking_id)
        {
            if move_record.state == "done" || move_record.state == "cancel" {
                continue;
            }
            let already = ctx
                .db
                .warehouse_task()
                .task_by_org()
                .filter(&organization_id)
                .any(|t| {
                    t.company_id == company_id
                        && t.picking_id == Some(picking_id)
                        && t.move_id == Some(move_record.id)
                        && t.state != "cancelled"
                });
            if already {
                continue;
            }

            ctx.db.warehouse_task().insert(WarehouseTask {
                id: 0,
                organization_id,
                name: format!(
                    "Pick {} / move {}",
                    picking.name,
                    move_record
                        .name
                        .clone()
                        .unwrap_or_else(|| move_record.id.to_string())
                ),
                task_type: "pick".to_string(),
                state: "pending".to_string(),
                priority: move_record.priority.clone(),
                user_id: wave.user_id,
                picking_id: Some(picking_id),
                move_id: Some(move_record.id),
                move_line_id: None,
                location_id: Some(move_record.location_id),
                location_dest_id: Some(move_record.location_dest_id),
                product_id: Some(move_record.product_id),
                lot_id: move_record.lot_id,
                package_id: move_record.package_id,
                quantity: move_record.product_uom_qty,
                uom_id: Some(move_record.product_uom),
                company_id,
                date_scheduled: wave.date_start.or(Some(ctx.timestamp)),
                date_started: None,
                date_finished: None,
                duration_expected: None,
                duration_real: None,
                notes: Some(format!("wave:{}", wave_id)),
                created_at: ctx.timestamp,
                metadata: Some(
                    serde_json::json!({ "wave_id": wave_id, "picking_id": picking_id }).to_string(),
                ),
            });
            tasks_created += 1;
        }
    }

    let old_state = wave.state.clone();
    ctx.db.picking_wave().id().update(PickingWave {
        state: "in_progress".to_string(),
        date_start: wave.date_start.or(Some(ctx.timestamp)),
        ..wave
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "picking_wave",
            record_id: wave_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": old_state }).to_string()),
            new_values: Some(
                serde_json::json!({
                    "state": "in_progress",
                    "tasks_created": tasks_created,
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
pub fn complete_picking_wave(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    wave_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "picking_wave", "update")?;

    let wave = ctx
        .db
        .picking_wave()
        .id()
        .find(&wave_id)
        .ok_or("Wave not found")?;

    if wave.company_id != company_id {
        return Err("Wave does not belong to this company".to_string());
    }

    if wave.state != "in_progress" {
        return Err("Only waves in progress can be completed".to_string());
    }

    // All wave pick tasks must be done/cancelled before wave completion.
    let open_tasks = ctx
        .db
        .warehouse_task()
        .task_by_org()
        .filter(&organization_id)
        .filter(|t| {
            t.company_id == company_id
                && t.state != "done"
                && t.state != "cancelled"
                && t.notes
                    .as_deref()
                    .map(|n| n.contains(&format!("wave:{wave_id}")))
                    .unwrap_or(false)
        })
        .count();
    if open_tasks > 0 {
        return Err(format!(
            "Wave {} still has {} open pick task(s)",
            wave_id, open_tasks
        ));
    }

    for &picking_id in &wave.picking_ids {
        if let Some(picking) = ctx.db.stock_picking().id().find(&picking_id) {
            if picking.state != "done" {
                return Err(format!(
                    "Picking {} must be validated (done) before completing wave (state: {})",
                    picking_id, picking.state
                ));
            }
        }
    }

    let old_state = wave.state.clone();

    ctx.db.picking_wave().id().update(PickingWave {
        state: "done".to_string(),
        date_done: Some(ctx.timestamp),
        ..wave
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "picking_wave",
            record_id: wave_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": old_state }).to_string()),
            new_values: Some(serde_json::json!({ "state": "done" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn update_warehouse_task_status(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    task_id: u64,
    new_status: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "warehouse_task", "update")?;

    let task = ctx
        .db
        .warehouse_task()
        .id()
        .find(&task_id)
        .ok_or("Task not found")?;

    if task.company_id != company_id {
        return Err("Task does not belong to this company".to_string());
    }

    let allowed = ["pending", "in_progress", "done", "cancelled"];
    if !allowed.contains(&new_status.as_str()) {
        return Err(format!(
            "Invalid task status '{}'; expected one of {:?}",
            new_status, allowed
        ));
    }

    let old_status = task.state.clone();
    let date_started = if new_status == "in_progress" {
        task.date_started.or(Some(ctx.timestamp))
    } else {
        task.date_started
    };
    let date_finished = if new_status == "done" || new_status == "cancelled" {
        Some(ctx.timestamp)
    } else {
        task.date_finished
    };

    ctx.db.warehouse_task().id().update(WarehouseTask {
        state: new_status.clone(),
        date_started,
        date_finished,
        ..task
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "warehouse_task",
            record_id: task_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": old_status }).to_string()),
            new_values: Some(serde_json::json!({ "state": new_status }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn create_packaging_material(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreatePackagingMaterialParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "warehouse_task", "create")?;
    let _ = company_id;
    if params.name.trim().is_empty() {
        return Err("Packaging material name cannot be empty".to_string());
    }
    if params.volume <= 0.0 && params.max_weight <= 0.0 {
        return Err("Packaging material needs positive volume or max_weight".to_string());
    }
    let row = ctx.db.packaging_material().insert(PackagingMaterial {
        id: 0,
        organization_id,
        name: params.name.clone(),
        material_type: params.material_type.clone(),
        weight: params.weight,
        max_weight: params.max_weight,
        length: params.length,
        width: params.width,
        height: params.height,
        volume: params.volume,
        cost: params.cost,
        currency_id: params.currency_id,
        barcode: params.barcode,
        is_active: params.is_active,
        created_at: ctx.timestamp,
        metadata: params.metadata,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "packaging_material",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": row.name,
                    "volume": row.volume,
                    "max_weight": row.max_weight,
                })
                .to_string(),
            ),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Greedy first-fit decreasing cartonization for a picking's open moves.
#[reducer]
pub fn run_cartonization(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: RunCartonizationParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "warehouse_task", "create")?;
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

    let mut lines: Vec<CartonLine> = Vec::new();
    for mv in ctx
        .db
        .stock_move()
        .move_by_picking()
        .filter(&params.picking_id)
    {
        if mv.state == "done" || mv.state == "cancel" {
            continue;
        }
        let prod = ctx
            .db
            .product()
            .id()
            .find(&mv.product_id)
            .ok_or_else(|| format!("Product {} not found", mv.product_id))?;
        let qty = mv.product_qty.max(mv.product_uom_qty).max(0.0);
        if qty <= 0.0 {
            continue;
        }
        let unit_vol = if prod.volume > 0.0 { prod.volume } else { 1.0 };
        let unit_wt = if prod.weight > 0.0 { prod.weight } else { 0.1 };
        lines.push(CartonLine {
            move_id: mv.id,
            product_id: mv.product_id,
            qty,
            volume: unit_vol * qty,
            weight: unit_wt * qty,
        });
    }
    if lines.is_empty() {
        return Err("Picking has no open moves to cartonize".to_string());
    }
    lines.sort_by(|a, b| {
        b.volume
            .partial_cmp(&a.volume)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut materials: Vec<_> = ctx
        .db
        .packaging_material()
        .material_by_org()
        .filter(&organization_id)
        .filter(|m| m.is_active)
        .collect();
    if materials.is_empty() {
        return Err("No active packaging materials — create_packaging_material first".to_string());
    }
    if let Some(pref) = params.packaging_material_id {
        materials.sort_by_key(|m| if m.id == pref { 0u8 } else { 1u8 });
    } else {
        materials.sort_by(|a, b| {
            a.volume
                .partial_cmp(&b.volume)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    }

    struct OpenCarton {
        material_id: u64,
        max_volume: f64,
        max_weight: f64,
        used_volume: f64,
        used_weight: f64,
        move_ids: Vec<u64>,
        item_count: i32,
    }

    let mut cartons: Vec<OpenCarton> = Vec::new();

    for line in &lines {
        let mut placed = false;
        for carton in &mut cartons {
            let vol_ok = carton.max_volume <= 0.0
                || carton.used_volume + line.volume <= carton.max_volume + 1e-9;
            let wt_ok = carton.max_weight <= 0.0
                || carton.used_weight + line.weight <= carton.max_weight + 1e-9;
            if vol_ok && wt_ok {
                carton.used_volume += line.volume;
                carton.used_weight += line.weight;
                carton.move_ids.push(line.move_id);
                carton.item_count += 1;
                placed = true;
                break;
            }
        }
        if placed {
            continue;
        }

        let material = materials
            .iter()
            .find(|m| {
                (m.volume <= 0.0 || line.volume <= m.volume + 1e-9)
                    && (m.max_weight <= 0.0 || line.weight <= m.max_weight + 1e-9)
            })
            .ok_or_else(|| {
                format!(
                    "No packaging material fits move {} (vol {}, wt {})",
                    line.move_id, line.volume, line.weight
                )
            })?;
        cartons.push(OpenCarton {
            material_id: material.id,
            max_volume: material.volume,
            max_weight: material.max_weight,
            used_volume: line.volume,
            used_weight: line.weight,
            move_ids: vec![line.move_id],
            item_count: 1,
        });
    }

    let mut results_created = 0u32;
    for (idx, carton) in cartons.iter().enumerate() {
        let util = if carton.max_volume > 0.0 {
            (carton.used_volume / carton.max_volume) * 100.0
        } else if carton.max_weight > 0.0 {
            (carton.used_weight / carton.max_weight) * 100.0
        } else {
            0.0
        };
        // Create a real draft→confirmed stock package for this carton.
        let pkg = crate::inventory::packing::insert_stock_package(
            ctx,
            organization_id,
            company_id,
            crate::inventory::packing::CreateStockPackageParams {
                name: format!("CARTON-{}-{}", params.picking_id, idx + 1),
                packaging_material_id: Some(carton.material_id),
                picking_id: Some(params.picking_id),
                location_id: None,
                location_dest_id: None,
                weight: carton.used_weight,
                volume: carton.used_volume,
                shipping_weight: carton.used_weight,
                metadata: Some(
                    serde_json::json!({
                        "from_cartonization": true,
                        "carton_index": idx + 1,
                    })
                    .to_string(),
                ),
            },
        )?;
        let package_id = pkg.id;
        ctx.db.stock_package().id().update(crate::inventory::packing::StockPackage {
            move_ids: carton.move_ids.clone(),
            state: "confirmed".to_string(),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..pkg
        });

        let row = ctx.db.cartonization_result().insert(CartonizationResult {
            id: 0,
            organization_id,
            package_id,
            packaging_material_id: carton.material_id,
            total_items: carton.item_count,
            total_volume: carton.used_volume,
            total_weight: carton.used_weight,
            utilization_percentage: util,
            move_line_ids: carton.move_ids.clone(),
            is_optimal: false,
            algorithm_used: "first_fit_decreasing".to_string(),
            created_at: ctx.timestamp,
            metadata: Some(
                serde_json::json!({
                    "picking_id": params.picking_id,
                    "company_id": company_id,
                    "carton_index": idx + 1,
                    "stock_package_id": package_id,
                })
                .to_string(),
            ),
        });
        results_created += 1;

        for &move_id in &carton.move_ids {
            if let Some(mv) = ctx.db.stock_move().id().find(&move_id) {
                ctx.db.stock_move().id().update(StockMove {
                    result_package_id: Some(package_id),
                    package_id: Some(package_id),
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..mv
                });
            }
        }

        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(company_id),
                table_name: "cartonization_result",
                record_id: row.id,
                action: "CREATE",
                old_values: None,
                new_values: Some(
                    serde_json::json!({
                        "package_id": package_id,
                        "utilization_percentage": util,
                        "total_items": carton.item_count,
                    })
                    .to_string(),
                ),
                changed_fields: vec!["package_id".to_string()],
                metadata: params.metadata.clone(),
            },
        );
    }

    if results_created == 0 {
        return Err("Cartonization produced no cartons".to_string());
    }
    Ok(())
}
