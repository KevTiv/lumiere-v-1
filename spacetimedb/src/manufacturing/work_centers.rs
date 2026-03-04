/// Work Centers Module — Work center definitions and productivity tracking
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **MrpWorkcenter** | Work center definitions |
/// | **MrpWorkcenterProductivity** | Work center productivity tracking |
use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

use crate::types::WorkingState;

use crate::helpers::{check_permission, write_audit_log};

// ============================================================================
// WORK CENTER TABLES
// ============================================================================

/// Work Center — Manufacturing resource where operations are performed
#[spacetimedb::table(
    accessor = mrp_workcenter,
    public,
    index(name = "by_company", accessor = mrp_workcenter_by_company, btree(columns = [company_id]))
)]
pub struct MrpWorkcenter {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub name: String,
    pub active: bool,
    pub code: Option<String>,
    pub company_id: u64,
    pub working_state: String,
    pub oee_target: f64,
    pub time_efficiency: f64,
    pub capacity: f64,
    pub capacity_ids: Vec<u64>,
    pub oee: f64,
    pub performance: f64,
    pub blocked_time: f64,
    pub productive_time: f64,
    pub productivity_ids: Vec<u64>,
    pub order_ids: Vec<u64>,
    pub workorder_count: u32,
    pub workorder_ready_count: u32,
    pub workorder_progress_count: u32,
    pub workorder_pending_count: u32,
    pub workorder_late_count: u32,
    pub alternative_workcenter_ids: Vec<u64>,
    pub color: Option<u8>,
    pub resource_calendar_id: Option<u64>,
    pub tag_ids: Vec<u64>,
    pub default_capacity_parent_id: Option<u64>,
    pub default_time_efficiency: f64,
    pub default_oee_target: f64,
    pub sequence: u32,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Work Center Productivity — Time tracking and productivity logs
#[spacetimedb::table(
    accessor = mrp_workcenter_productivity,
    public,
    index(name = "by_workorder", accessor = mrp_productivity_by_workorder, btree(columns = [workorder_id])),
    index(name = "by_workcenter", accessor = mrp_productivity_by_workcenter, btree(columns = [workcenter_id]))
)]
pub struct MrpWorkcenterProductivity {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub workcenter_id: u64,
    pub workorder_id: u64,
    pub description: Option<String>,
    pub loss_id: u64,
    pub date_start: Timestamp,
    pub date_end: Option<Timestamp>,
    pub duration: f64,
    pub user_id: Identity,
    pub company_id: u64,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ============================================================================
// REDUCERS
// ============================================================================

/// Create a new work center
#[reducer]
pub fn create_workcenter(
    ctx: &ReducerContext,
    company_id: u64,
    name: String,
    code: Option<String>,
    capacity: f64,
    time_efficiency: f64,
    oee_target: f64,
    working_state: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, company_id, "mrp_workcenter", "create")?;

    // Validate working_state if provided
    if let Some(ref ws) = working_state {
        WorkingState::from_str(ws)?;
    }

    let wc = ctx.db.mrp_workcenter().insert(MrpWorkcenter {
        id: 0,
        name,
        active: true,
        code,
        company_id,
        working_state: working_state.unwrap_or_else(|| "normal".to_string()),
        oee_target,
        time_efficiency,
        capacity,
        capacity_ids: Vec::new(),
        oee: 0.0,
        performance: 0.0,
        blocked_time: 0.0,
        productive_time: 0.0,
        productivity_ids: Vec::new(),
        order_ids: Vec::new(),
        workorder_count: 0,
        workorder_ready_count: 0,
        workorder_progress_count: 0,
        workorder_pending_count: 0,
        workorder_late_count: 0,
        alternative_workcenter_ids: Vec::new(),
        color: None,
        resource_calendar_id: None,
        tag_ids: Vec::new(),
        default_capacity_parent_id: None,
        default_time_efficiency: time_efficiency,
        default_oee_target: oee_target,
        sequence: 0,
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
        "mrp_workcenter",
        wc.id,
        "create",
        None,
        None,
        vec!["created".to_string()],
    );

    log::info!("Work center created: id={}", wc.id);
    Ok(())
}

/// Update a work center
#[reducer]
pub fn update_workcenter(
    ctx: &ReducerContext,
    company_id: u64,
    workcenter_id: u64,
    name: String,
    capacity: f64,
    time_efficiency: f64,
    active: bool,
) -> Result<(), String> {
    check_permission(ctx, company_id, "mrp_workcenter", "write")?;

    let wc = ctx
        .db
        .mrp_workcenter()
        .id()
        .find(&workcenter_id)
        .ok_or("Work center not found")?;

    if wc.company_id != company_id {
        return Err("Work center does not belong to this company".to_string());
    }

    ctx.db.mrp_workcenter().id().update(MrpWorkcenter {
        name,
        capacity,
        time_efficiency,
        active,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..wc
    });

    write_audit_log(
        ctx,
        company_id,
        None,
        "mrp_workcenter",
        workcenter_id,
        "write",
        None,
        None,
        vec!["updated".to_string()],
    );

    log::info!("Work center updated: id={}", workcenter_id);
    Ok(())
}

/// Block a work center (mark as blocked for maintenance or other reasons)
#[reducer]
pub fn block_workcenter(
    ctx: &ReducerContext,
    company_id: u64,
    workcenter_id: u64,
    reason: String,
) -> Result<(), String> {
    check_permission(ctx, company_id, "mrp_workcenter", "write")?;

    let wc = ctx
        .db
        .mrp_workcenter()
        .id()
        .find(&workcenter_id)
        .ok_or("Work center not found")?;

    if wc.company_id != company_id {
        return Err("Work center does not belong to this company".to_string());
    }

    ctx.db.mrp_workcenter().id().update(MrpWorkcenter {
        working_state: "blocked".to_string(),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..wc
    });

    write_audit_log(
        ctx,
        company_id,
        None,
        "mrp_workcenter",
        workcenter_id,
        "write",
        None,
        None,
        vec!["blocked".to_string(), reason],
    );

    log::info!("Work center blocked: id={}", workcenter_id);
    Ok(())
}

/// Unblock a work center
#[reducer]
pub fn unblock_workcenter(
    ctx: &ReducerContext,
    company_id: u64,
    workcenter_id: u64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "mrp_workcenter", "write")?;

    let wc = ctx
        .db
        .mrp_workcenter()
        .id()
        .find(&workcenter_id)
        .ok_or("Work center not found")?;

    if wc.company_id != company_id {
        return Err("Work center does not belong to this company".to_string());
    }

    ctx.db.mrp_workcenter().id().update(MrpWorkcenter {
        working_state: "normal".to_string(),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..wc
    });

    write_audit_log(
        ctx,
        company_id,
        None,
        "mrp_workcenter",
        workcenter_id,
        "write",
        None,
        None,
        vec!["unblocked".to_string()],
    );

    log::info!("Work center unblocked: id={}", workcenter_id);
    Ok(())
}

/// Log productivity time for a work center
#[reducer]
pub fn log_workcenter_productivity(
    ctx: &ReducerContext,
    company_id: u64,
    workcenter_id: u64,
    workorder_id: u64,
    loss_id: u64,
    description: Option<String>,
    duration: f64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "mrp_workcenter_productivity", "create")?;

    let wc = ctx
        .db
        .mrp_workcenter()
        .id()
        .find(&workcenter_id)
        .ok_or("Work center not found")?;

    if wc.company_id != company_id {
        return Err("Work center does not belong to this company".to_string());
    }

    let productivity = ctx
        .db
        .mrp_workcenter_productivity()
        .insert(MrpWorkcenterProductivity {
            id: 0,
            workcenter_id,
            workorder_id,
            description,
            loss_id,
            date_start: ctx.timestamp,
            date_end: None,
            duration,
            user_id: ctx.sender(),
            company_id,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: None,
        });

    // Update work center productivity tracking
    let mut prod_ids = wc.productivity_ids.clone();
    prod_ids.push(productivity.id);

    let productive_time = wc.productive_time + duration;

    ctx.db.mrp_workcenter().id().update(MrpWorkcenter {
        productivity_ids: prod_ids,
        productive_time,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..wc
    });

    write_audit_log(
        ctx,
        company_id,
        None,
        "mrp_workcenter_productivity",
        productivity.id,
        "create",
        None,
        None,
        vec!["logged".to_string()],
    );

    log::info!(
        "Work center productivity logged: id={}, wc={}, duration={}",
        productivity.id,
        workcenter_id,
        duration
    );
    Ok(())
}

/// Complete a productivity log entry
#[reducer]
pub fn complete_productivity_log(
    ctx: &ReducerContext,
    company_id: u64,
    log_id: u64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "mrp_workcenter_productivity", "write")?;

    let log = ctx
        .db
        .mrp_workcenter_productivity()
        .id()
        .find(&log_id)
        .ok_or("Productivity log not found")?;

    if log.company_id != company_id {
        return Err("Log does not belong to this company".to_string());
    }

    // Calculate actual duration
    let duration = log.duration; // Simplified - in real implementation would calculate from timestamps

    ctx.db
        .mrp_workcenter_productivity()
        .id()
        .update(MrpWorkcenterProductivity {
            date_end: Some(ctx.timestamp),
            duration,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..log
        });

    write_audit_log(
        ctx,
        company_id,
        None,
        "mrp_workcenter_productivity",
        log_id,
        "write",
        None,
        None,
        vec!["completed".to_string()],
    );

    log::info!("Productivity log completed: id={}", log_id);
    Ok(())
}
