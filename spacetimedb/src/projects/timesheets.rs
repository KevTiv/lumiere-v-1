/// Timesheets Module — Time tracking for project tasks
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **ProjectTimesheet** | Time log entries against tasks and projects |
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::projects::projects::project_project;
use crate::projects::tasks::{project_task, ProjectTask};
use crate::types::TimesheetInvoiceType;

// ── Tables ───────────────────────────────────────────────────────────────────

/// Project Timesheet — Hours logged against a project/task by an employee
#[derive(Clone)]
#[spacetimedb::table(
    accessor = project_timesheet,
    public,
    index(accessor = timesheet_by_project, btree(columns = [project_id])),
    index(accessor = timesheet_by_employee, btree(columns = [employee_id])),
    index(accessor = timesheet_by_company, btree(columns = [company_id]))
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

// ── Input Params ──────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct LogTimesheetParams {
    pub project_id: u64,
    pub task_id: Option<u64>,
    pub employee_id: u64,
    pub name: String,
    pub date: Timestamp,
    pub unit_amount: f64,
    pub currency_id: u64,
    pub employee_cost: f64,
    pub timesheet_invoice_type: Option<String>,
    pub product_id: Option<u64>,
    pub product_uom_id: Option<u64>,
    pub account_id: Option<u64>,
    pub encoding_uom_id: u64,
    pub so_line: Option<u64>,
    pub department_id: Option<u64>,
    pub manager_id: Option<Identity>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct StartTimesheetTimerParams {
    pub project_id: u64,
    pub task_id: Option<u64>,
    pub employee_id: u64,
    pub name: String,
    pub currency_id: u64,
    pub employee_cost: f64,
    pub timesheet_invoice_type: Option<String>,
    pub product_id: Option<u64>,
    pub product_uom_id: Option<u64>,
    pub account_id: Option<u64>,
    pub encoding_uom_id: u64,
    pub so_line: Option<u64>,
    pub department_id: Option<u64>,
    pub manager_id: Option<Identity>,
    pub metadata: Option<String>,
}

// ── Reducers ──────────────────────────────────────────────────────────────────

/// Log hours against a task
#[reducer]
pub fn log_timesheet(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: LogTimesheetParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_timesheet", "create")?;

    if params.unit_amount <= 0.0 {
        return Err("Hours must be greater than 0".to_string());
    }

    // Validate or derive timesheet_invoice_type
    let resolved_invoice_type = match params.timesheet_invoice_type {
        Some(ref t) => {
            TimesheetInvoiceType::from_str(t)?;
            t.clone()
        }
        None => {
            let bill_type = ctx
                .db
                .project_project()
                .id()
                .find(&params.project_id)
                .map(|p| p.bill_type)
                .unwrap_or_else(|| "no".to_string());
            TimesheetInvoiceType::default_for_bill_type(&bill_type)
                .as_str()
                .to_string()
        }
    };

    // Validate task belongs to project
    if let Some(tid) = params.task_id {
        let task = ctx
            .db
            .project_task()
            .id()
            .find(&tid)
            .ok_or("Task not found")?;
        if task.project_id != Some(params.project_id) {
            return Err("Task does not belong to this project".to_string());
        }
    }

    let amount = params.unit_amount * params.employee_cost;
    let revenue = params.unit_amount * params.employee_cost;

    let entry = ctx.db.project_timesheet().insert(ProjectTimesheet {
        id: 0,
        name: params.name,
        project_id: params.project_id,
        task_id: params.task_id,
        employee_id: params.employee_id,
        user_id: ctx.sender(),
        date: params.date,
        unit_amount: params.unit_amount,
        amount,
        product_id: params.product_id,
        product_uom_id: params.product_uom_id,
        account_id: params.account_id,
        currency_id: params.currency_id,
        company_id,
        is_timer_running: false,
        timer_start: None,
        timer_pause: None,
        employee_cost: params.employee_cost,
        timesheet_invoice_type: resolved_invoice_type,
        timesheet_invoice_id: None,
        timesheet_revenue: revenue,
        so_line: params.so_line,
        encoding_uom_id: params.encoding_uom_id,
        validation_status: "draft".to_string(),
        validated_by: None,
        validated_at: None,
        department_id: params.department_id,
        manager_id: params.manager_id,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    // Update task effective hours and remaining hours
    if let Some(tid) = params.task_id {
        if let Some(task) = ctx.db.project_task().id().find(&tid) {
            let effective_hours = task.effective_hours + params.unit_amount;
            let total_hours_spent = task.total_hours_spent + params.unit_amount;
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

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "project_timesheet",
            record_id: entry.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "hours": entry.unit_amount, "project_id": entry.project_id })
                    .to_string(),
            ),
            changed_fields: vec!["logged".to_string()],
            metadata: None,
        },
    );

    log::info!(
        "Timesheet logged: id={}, hours={}, project={}",
        entry.id,
        entry.unit_amount,
        entry.project_id
    );
    Ok(())
}

/// Start a timer for a timesheet entry
#[reducer]
pub fn start_timesheet_timer(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: StartTimesheetTimerParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_timesheet", "create")?;

    // Validate or derive timesheet_invoice_type
    let resolved_invoice_type = match params.timesheet_invoice_type {
        Some(ref t) => {
            TimesheetInvoiceType::from_str(t)?;
            t.clone()
        }
        None => {
            let bill_type = ctx
                .db
                .project_project()
                .id()
                .find(&params.project_id)
                .map(|p| p.bill_type)
                .unwrap_or_else(|| "no".to_string());
            TimesheetInvoiceType::default_for_bill_type(&bill_type)
                .as_str()
                .to_string()
        }
    };

    let entry = ctx.db.project_timesheet().insert(ProjectTimesheet {
        id: 0,
        name: params.name,
        project_id: params.project_id,
        task_id: params.task_id,
        employee_id: params.employee_id,
        user_id: ctx.sender(),
        date: ctx.timestamp,
        unit_amount: 0.0,
        amount: 0.0,
        product_id: params.product_id,
        product_uom_id: params.product_uom_id,
        account_id: params.account_id,
        currency_id: params.currency_id,
        company_id,
        is_timer_running: true,
        timer_start: Some(ctx.timestamp),
        timer_pause: None,
        employee_cost: params.employee_cost,
        timesheet_invoice_type: resolved_invoice_type,
        timesheet_invoice_id: None,
        timesheet_revenue: 0.0,
        so_line: params.so_line,
        encoding_uom_id: params.encoding_uom_id,
        validation_status: "draft".to_string(),
        validated_by: None,
        validated_at: None,
        department_id: params.department_id,
        manager_id: params.manager_id,
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
            table_name: "project_timesheet",
            record_id: entry.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "project_id": entry.project_id }).to_string()),
            changed_fields: vec!["timer_started".to_string()],
            metadata: None,
        },
    );

    log::info!("Timesheet timer started: project={}", entry.project_id);
    Ok(())
}

/// Stop a running timer and record hours
#[reducer]
pub fn stop_timesheet_timer(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    timesheet_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_timesheet", "write")?;

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

    ctx.db.project_timesheet().id().update(ProjectTimesheet {
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

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "project_timesheet",
            record_id: timesheet_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "hours": unit_amount }).to_string()),
            changed_fields: vec!["timer_stopped".to_string()],
            metadata: None,
        },
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
    organization_id: u64,
    company_id: u64,
    timesheet_ids: Vec<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_timesheet", "validate")?;

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

        ctx.db.project_timesheet().id().update(ProjectTimesheet {
            validation_status: "validated".to_string(),
            validated_by: Some(ctx.sender()),
            validated_at: Some(ctx.timestamp),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..entry
        });
    }

    for tid in &timesheet_ids {
        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(company_id),
                table_name: "project_timesheet",
                record_id: *tid,
                action: "UPDATE",
                old_values: None,
                new_values: Some(
                    serde_json::json!({ "validation_status": "validated" }).to_string(),
                ),
                changed_fields: vec!["validated".to_string()],
                metadata: None,
            },
        );
    }

    log::info!("Timesheets validated: count={}", timesheet_ids.len());
    Ok(())
}
