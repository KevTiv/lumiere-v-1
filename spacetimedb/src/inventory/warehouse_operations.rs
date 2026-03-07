/// Warehouse Operations — Tables and Reducers
///
/// Tables:
///   - WarehouseTask
///   - PickingWave
///   - PackagingMaterial
///   - CartonizationResult
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
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

    let old_status = task.state.clone();

    ctx.db.warehouse_task().id().update(WarehouseTask {
        state: new_status.clone(),
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
