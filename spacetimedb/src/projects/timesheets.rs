/// Timesheets Module — Time tracking for project tasks
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **ProjectTimesheet** | Time log entries against tasks and projects |
use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};
use crate::projects::tasks::{project_task, ProjectTask};

// ============================================================================
// TIMESHEET TABLE
// ============================================================================

/// Project Timesheet — Hours logged against a project/task by an employee
#[derive(Clone)]
#[spacetimedb::table(
    accessor = project_timesheet,
    public,
    index(name = "by_project", accessor = timesheet_by_project, btree(columns = [project_id])),
    index(name = "by_employee", accessor = timesheet_by_employee, btree(columns = [employee_id])),
    index(name = "by_company", accessor = timesheet_by_company, btree(columns = [company_id]))
)]
pub struct ProjectTimesheet {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub name: String,
    pub project_id: u64,
    pub task_id: Option<u64>,
    pub employee_id: u64,
    pub user_id: Identity,
    pub date: Timestamp,
    pub unit_amount: f64,
    pub amount: f64,
    pub product_id: Option<u64>,
    pub product_uom_id: Option<u64>,
    pub account_id: Option<u64>,
    pub currency_id: u64,
    pub company_id: u64,
    pub is_timer_running: bool,
    pub timer_start: Option<Timestamp>,
    pub timer_pause: Option<Timestamp>,
    pub employee_cost: f64,
    pub timesheet_invoice_type: String,
    pub timesheet_invoice_id: Option<u64>,
    pub timesheet_revenue: f64,
    pub so_line: Option<u64>,
    pub encoding_uom_id: u64,
    pub validation_status: String,
    pub validated_by: Option<Identity>,
    pub validated_at: Option<Timestamp>,
    pub department_id: Option<u64>,
    pub manager_id: Option<Identity>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ============================================================================
// REDUCERS
// ============================================================================

/// Log hours against a task
#[reducer]
pub fn log_timesheet(
    ctx: &ReducerContext,
    company_id: u64,
    project_id: u64,
    task_id: Option<u64>,
    employee_id: u64,
    name: String,
    date: Timestamp,
    unit_amount: f64,
    currency_id: u64,
    employee_cost: f64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "project_timesheet", "create")?;

    if unit_amount <= 0.0 {
        return Err("Hours must be greater than 0".to_string());
    }

    // Validate task belongs to project
    if let Some(tid) = task_id {
        let task = ctx
            .db
            .project_task()
            .id()
            .find(&tid)
            .ok_or("Task not found")?;
        if task.project_id != Some(project_id) {
            return Err("Task does not belong to this project".to_string());
        }
    }

    let amount = unit_amount * employee_cost;
    let revenue = unit_amount * employee_cost; // Simplified

    let entry = ctx.db.project_timesheet().insert(ProjectTimesheet {
        id: 0,
        name,
        project_id,
        task_id,
        employee_id,
        user_id: ctx.sender(),
        date,
        unit_amount,
        amount,
        product_id: None,
        product_uom_id: None,
        account_id: None,
        currency_id,
        company_id,
        is_timer_running: false,
        timer_start: None,
        timer_pause: None,
        employee_cost,
        timesheet_invoice_type: "non_billable".to_string(),
        timesheet_invoice_id: None,
        timesheet_revenue: revenue,
        so_line: None,
        encoding_uom_id: 0,
        validation_status: "draft".to_string(),
        validated_by: None,
        validated_at: None,
        department_id: None,
        manager_id: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    // Update task effective hours and remaining hours
    if let Some(tid) = task_id {
        if let Some(task) = ctx.db.project_task().id().find(&tid) {
            let effective_hours = task.effective_hours + unit_amount;
            let total_hours_spent = task.total_hours_spent + unit_amount;
            let remaining_hours = (task.planned_hours - effective_hours).max(0.0);
            let progress = if task.planned_hours > 0.0 {
                (effective_hours / task.planned_hours * 100.0).min(100.0)
            } else {
                0.0
            };

            ctx.db.project_task().id().update(ProjectTask {
                effective_hours,
                total_hours_spent,
                remaining_hours,
                progress,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..task
            });
        }
    }

    write_audit_log(
        ctx,
        company_id,
        None,
        "project_timesheet",
        entry.id,
        "create",
        None,
        None,
        vec!["logged".to_string()],
    );

    log::info!(
        "Timesheet logged: id={}, hours={}, project={}",
        entry.id,
        unit_amount,
        project_id
    );
    Ok(())
}

/// Start a timer for a timesheet entry
#[reducer]
pub fn start_timesheet_timer(
    ctx: &ReducerContext,
    company_id: u64,
    project_id: u64,
    task_id: Option<u64>,
    employee_id: u64,
    name: String,
    currency_id: u64,
    employee_cost: f64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "project_timesheet", "create")?;

    let entry = ctx.db.project_timesheet().insert(ProjectTimesheet {
        id: 0,
        name,
        project_id,
        task_id,
        employee_id,
        user_id: ctx.sender(),
        date: ctx.timestamp,
        unit_amount: 0.0,
        amount: 0.0,
        product_id: None,
        product_uom_id: None,
        account_id: None,
        currency_id,
        company_id,
        is_timer_running: true,
        timer_start: Some(ctx.timestamp),
        timer_pause: None,
        employee_cost,
        timesheet_invoice_type: "non_billable".to_string(),
        timesheet_invoice_id: None,
        timesheet_revenue: 0.0,
        so_line: None,
        encoding_uom_id: 0,
        validation_status: "draft".to_string(),
        validated_by: None,
        validated_at: None,
        department_id: None,
        manager_id: None,
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
        "project_timesheet",
        entry.id,
        "create",
        None,
        None,
        vec!["timer_started".to_string()],
    );

    log::info!("Timesheet timer started: project={}", project_id);
    Ok(())
}

/// Stop a running timer and record hours
#[reducer]
pub fn stop_timesheet_timer(
    ctx: &ReducerContext,
    company_id: u64,
    timesheet_id: u64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "project_timesheet", "write")?;

    let entry = ctx
        .db
        .project_timesheet()
        .id()
        .find(&timesheet_id)
        .ok_or("Timesheet entry not found")?;

    if entry.company_id != company_id {
        return Err("Timesheet does not belong to this company".to_string());
    }

    if !entry.is_timer_running {
        return Err("Timer is not running".to_string());
    }

    // Calculate hours from timer_start to now using micros
    let unit_amount = if let Some(start) = entry.timer_start {
        let start_micros = start.to_micros_since_unix_epoch();
        let now_micros = ctx.timestamp.to_micros_since_unix_epoch();
        let elapsed_micros = (now_micros - start_micros).max(0) as f64;
        elapsed_micros / 3_600_000_000.0 // micros to hours
    } else {
        0.0
    };

    let amount = unit_amount * entry.employee_cost;

    ctx.db
        .project_timesheet()
        .id()
        .update(ProjectTimesheet {
            is_timer_running: false,
            unit_amount,
            amount,
            timesheet_revenue: amount,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..entry.clone()
        });

    // Update task hours
    if let Some(tid) = entry.task_id {
        if let Some(task) = ctx.db.project_task().id().find(&tid) {
            let effective_hours = task.effective_hours + unit_amount;
            let total_hours_spent = task.total_hours_spent + unit_amount;
            let remaining_hours = (task.planned_hours - effective_hours).max(0.0);
            let progress = if task.planned_hours > 0.0 {
                (effective_hours / task.planned_hours * 100.0).min(100.0)
            } else {
                0.0
            };

            ctx.db.project_task().id().update(ProjectTask {
                effective_hours,
                total_hours_spent,
                remaining_hours,
                progress,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..task
            });
        }
    }

    write_audit_log(
        ctx,
        company_id,
        None,
        "project_timesheet",
        timesheet_id,
        "write",
        None,
        None,
        vec!["timer_stopped".to_string()],
    );

    log::info!(
        "Timesheet timer stopped: id={}, hours={}",
        timesheet_id,
        unit_amount
    );
    Ok(())
}

/// Validate timesheet entries (manager approval)
#[reducer]
pub fn validate_timesheets(
    ctx: &ReducerContext,
    company_id: u64,
    timesheet_ids: Vec<u64>,
) -> Result<(), String> {
    check_permission(ctx, company_id, "project_timesheet", "validate")?;

    for tid in &timesheet_ids {
        let entry = ctx
            .db
            .project_timesheet()
            .id()
            .find(tid)
            .ok_or("Timesheet entry not found")?;

        if entry.company_id != company_id {
            return Err("Timesheet does not belong to this company".to_string());
        }

        ctx.db
            .project_timesheet()
            .id()
            .update(ProjectTimesheet {
                validation_status: "validated".to_string(),
                validated_by: Some(ctx.sender()),
                validated_at: Some(ctx.timestamp),
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..entry
            });
    }

    for tid in &timesheet_ids {
        write_audit_log(
            ctx,
            company_id,
            None,
            "project_timesheet",
            *tid,
            "write",
            None,
            None,
            vec!["validated".to_string()],
        );
    }

    log::info!("Timesheets validated: count={}", timesheet_ids.len());
    Ok(())
}
