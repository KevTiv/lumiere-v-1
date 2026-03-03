/// Warehouse Operations — Tables and Reducers
///
/// Tables:
///   - WarehouseTask
///   - PickingWave
///   - PackagingMaterial
///   - CartonizationResult
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};
use serde_json;

/// Warehouse Task
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

/// Create a new picking wave
pub fn create_picking_wave(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    picking_type_id: u64,
    company_id: u64,
    date_done: Option<Timestamp>,
    picking_ids: Vec<u64>,
    move_line_ids: Vec<u64>,
    state: String,
    user_id: Option<Identity>,
    team_id: Option<u64>,
    date_start: Option<Timestamp>,
    is_wave: bool,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "picking_wave", "create")?;

    if name.is_empty() {
        return Err("Wave name cannot be empty".to_string());
    }

    let state_clone = state.clone();

    let wave = ctx.db.picking_wave().insert(PickingWave {
        id: 0,
        organization_id,
        name: name.clone(),
        state,
        picking_type_id,
        user_id,
        team_id,
        date_start,
        date_done,
        picking_ids,
        move_line_ids,
        company_id,
        is_wave,
        created_at: ctx.timestamp,
        metadata,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "picking_wave",
        wave.id,
        "create",
        None,
        Some(serde_json::json!({ "name": name, "picking_type_id": picking_type_id, "state": state_clone, "is_wave": is_wave }).to_string()),
        vec!["name".to_string(), "state".to_string()],
    );

    Ok(())
}

/// Create a new warehouse task
pub fn create_warehouse_task(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    task_type: String,
    picking_id: Option<u64>,
    company_id: u64,
    state: String,
    priority: String,
    user_id: Option<Identity>,
    move_id: Option<u64>,
    move_line_id: Option<u64>,
    location_id: Option<u64>,
    location_dest_id: Option<u64>,
    product_id: Option<u64>,
    lot_id: Option<u64>,
    package_id: Option<u64>,
    quantity: f64,
    uom_id: Option<u64>,
    date_scheduled: Option<Timestamp>,
    date_started: Option<Timestamp>,
    date_finished: Option<Timestamp>,
    duration_expected: Option<f64>,
    duration_real: Option<f64>,
    notes: Option<String>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "warehouse_task", "create")?;

    if name.is_empty() {
        return Err("Task name cannot be empty".to_string());
    }

    let task_type_clone = task_type.clone();
    let state_clone = state.clone();
    let priority_clone = priority.clone();

    let task = ctx.db.warehouse_task().insert(WarehouseTask {
        id: 0,
        organization_id,
        name: name.clone(),
        task_type,
        state,
        priority,
        user_id,
        picking_id,
        move_id,
        move_line_id,
        location_id,
        location_dest_id,
        product_id,
        lot_id,
        package_id,
        quantity,
        uom_id,
        company_id,
        date_scheduled,
        date_started,
        date_finished,
        duration_expected,
        duration_real,
        notes,
        created_at: ctx.timestamp,
        metadata,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "warehouse_task",
        task.id,
        "create",
        None,
        Some(serde_json::json!({ "name": name, "task_type": task_type_clone, "picking_id": picking_id, "state": state_clone, "priority": priority_clone }).to_string()),
        vec![
            "name".to_string(),
            "task_type".to_string(),
            "state".to_string(),
        ],
    );

    Ok(())
}

/// Complete picking wave
pub fn complete_picking_wave(
    ctx: &ReducerContext,
    organization_id: u64,
    wave_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "picking_wave", "update")?;

    if let Some(mut wave) = ctx.db.picking_wave().id().find(&wave_id) {
        if wave.state != "in_progress" {
            return Err("Only waves in progress can be completed".to_string());
        }

        let old_state = wave.state.clone();
        wave.state = "done".to_string();
        wave.date_done = Some(ctx.timestamp);
        ctx.db.picking_wave().id().update(wave);

        write_audit_log(
            ctx,
            organization_id,
            None,
            "picking_wave",
            wave_id,
            "update",
            Some(serde_json::json!({ "state": old_state }).to_string()),
            Some(serde_json::json!({ "state": "done" }).to_string()),
            vec!["state".to_string()],
        );
    } else {
        return Err("Wave not found".to_string());
    }

    Ok(())
}

/// Update warehouse task status
pub fn update_warehouse_task_status(
    ctx: &ReducerContext,
    organization_id: u64,
    task_id: u64,
    new_status: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "warehouse_task", "update")?;

    if let Some(mut task) = ctx.db.warehouse_task().id().find(&task_id) {
        let old_status = task.state.clone();
        task.state = new_status.clone();
        ctx.db.warehouse_task().id().update(task);

        write_audit_log(
            ctx,
            organization_id,
            None,
            "warehouse_task",
            task_id,
            "update",
            Some(serde_json::json!({ "state": old_status }).to_string()),
            Some(serde_json::json!({ "state": new_status }).to_string()),
            vec!["state".to_string()],
        );
    } else {
        return Err("Task not found".to_string());
    }

    Ok(())
}
