/// Timesheets Module — Time tracking for project tasks
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **ProjectTimesheet** | Time log entries against tasks and projects |
/// | **ProjectTimesheetApproval** | Append-only approval decisions (validate/reject/reopen) |
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::{company, company_id_from_scope};
use crate::core::reference::{
    require_active_currency_by_id, require_currency_by_id, resolve_currency_rate_as_of,
};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::hr::employees::hr_employee;
use crate::projects::project_accounting::{
    maybe_post_wip_je_for_validated, refresh_project_margin_for_projects,
    refresh_resource_utilisation_snapshot, PostTimesheetWipParams,
};
use crate::projects::projects::project_project;
use crate::projects::rate_cards::resolve_timesheet_rates;
use crate::projects::tasks::{project_task, ProjectTask};
use crate::types::TimesheetInvoiceType;

// ── Tables ───────────────────────────────────────────────────────────────────

/// Project Timesheet — Hours logged against a project/task by an employee
#[derive(Clone)]
#[spacetimedb::table(
    accessor = project_timesheet,
    public,
    index(accessor = timesheet_by_org, btree(columns = [organization_id])),
    index(accessor = timesheet_by_project, btree(columns = [project_id])),
    index(accessor = timesheet_by_employee, btree(columns = [employee_id])),
    index(accessor = timesheet_by_company, btree(columns = [company_id]))
)]
pub struct ProjectTimesheet {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64,
    pub name: String,
    pub project_id: u64,
    pub task_id: Option<u64>,
    pub employee_id: u64,
    pub user_id: Identity,
    pub date: Timestamp,
    pub unit_amount: f64,
    /// Internal cost total: hours × employee_cost
    pub amount: f64,
    pub product_id: Option<u64>,
    pub product_uom_id: Option<u64>,
    pub account_id: Option<u64>,
    pub currency_id: u64,
    pub company_id: u64,
    pub is_timer_running: bool,
    pub timer_start: Option<Timestamp>,
    pub timer_pause: Option<Timestamp>,
    /// Cost rate per hour
    pub employee_cost: f64,
    /// Sell / bill rate per hour (distinct from cost)
    pub sell_rate: f64,
    pub timesheet_invoice_type: String,
    pub timesheet_invoice_id: Option<u64>,
    /// Billable revenue total: hours × sell_rate
    pub timesheet_revenue: f64,
    /// FX rate to company currency (snapshotted at validate / bill)
    pub currency_rate: f64,
    pub company_currency_id: u64,
    /// Cost total in company currency: amount × currency_rate
    pub amount_company: f64,
    /// Revenue total in company currency: timesheet_revenue × currency_rate
    pub timesheet_revenue_company: f64,
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

/// Append-only approval timeline for timesheet decisions
#[derive(Clone)]
#[spacetimedb::table(
    accessor = project_timesheet_approval,
    public,
    index(accessor = timesheet_approval_by_org, btree(columns = [organization_id])),
    index(accessor = timesheet_approval_by_timesheet, btree(columns = [timesheet_id])),
    index(accessor = timesheet_approval_by_company, btree(columns = [company_id]))
)]
pub struct ProjectTimesheetApproval {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64,
    pub company_id: u64,
    pub timesheet_id: u64,
    pub actor: Identity,
    /// validated | rejected | reopened
    pub decision: String,
    pub reason: Option<String>,
    pub hours: f64,
    pub sell_rate: f64,
    pub cost_rate: f64,
    pub currency_id: u64,
    pub decided_at: Timestamp,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct LogTimesheetParams {
    pub company_id: Option<u64>,
    pub project_id: u64,
    pub task_id: Option<u64>,
    pub employee_id: u64,
    pub name: String,
    pub date: Timestamp,
    pub unit_amount: f64,
    pub currency_id: u64,
    /// When omitted, resolved from rate card (required if no card matches).
    pub employee_cost: Option<f64>,
    /// When omitted, defaults to resolved cost / rate-card sell.
    pub sell_rate: Option<f64>,
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
    pub company_id: Option<u64>,
    pub project_id: u64,
    pub task_id: Option<u64>,
    pub employee_id: u64,
    pub name: String,
    pub currency_id: u64,
    /// When omitted, resolved from rate card (required if no card matches).
    pub employee_cost: Option<f64>,
    /// When omitted, defaults to resolved cost / rate-card sell.
    pub sell_rate: Option<f64>,
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
pub struct ValidateTimesheetsParams {
    pub company_id: Option<u64>,
    pub timesheet_ids: Vec<u64>,
    /// Optional WIP JE accounts — only applied when project.allow_wip_je.
    pub wip_journal_id: Option<u64>,
    pub wip_account_id: Option<u64>,
    pub wip_labor_account_id: Option<u64>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RejectTimesheetsParams {
    pub company_id: Option<u64>,
    pub timesheet_ids: Vec<u64>,
    pub reason: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ReopenTimesheetsParams {
    pub company_id: Option<u64>,
    pub timesheet_ids: Vec<u64>,
    pub reason: Option<String>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn project_is_billable(bill_type: &str) -> bool {
    bill_type != "no"
}

/// Snapshot FX for a timesheet currency → company currency (expense-style).
pub fn timesheet_exchange_rate_snapshot(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    currency_id: u64,
) -> Result<(f64, u64), String> {
    let company_row = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found for timesheet FX")?;
    let company_currency_id = company_row.currency_id;
    if currency_id == company_currency_id {
        return Ok((1.0, company_currency_id));
    }
    require_currency_by_id(ctx, currency_id)?;
    require_currency_by_id(ctx, company_currency_id)?;
    let rate = resolve_currency_rate_as_of(
        ctx,
        organization_id,
        company_id,
        currency_id,
        company_currency_id,
        ctx.timestamp,
    )?;
    Ok((rate, company_currency_id))
}

/// Apply FX snapshot fields when missing (`currency_rate <= 0`).
pub fn ensure_timesheet_fx_snapshot(
    ctx: &ReducerContext,
    organization_id: u64,
    entry: ProjectTimesheet,
) -> Result<ProjectTimesheet, String> {
    if entry.currency_rate > 0.0 && entry.company_currency_id > 0 {
        return Ok(entry);
    }
    let (rate, company_currency_id) = timesheet_exchange_rate_snapshot(
        ctx,
        organization_id,
        entry.company_id,
        entry.currency_id,
    )?;
    Ok(ProjectTimesheet {
        currency_rate: rate,
        company_currency_id,
        amount_company: entry.amount * rate,
        timesheet_revenue_company: entry.timesheet_revenue * rate,
        ..entry
    })
}

fn employee_has_running_timer(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
) -> bool {
    ctx.db
        .project_timesheet()
        .timesheet_by_employee()
        .filter(&employee_id)
        .any(|ts| {
            ts.organization_id == organization_id
                && ts.company_id == company_id
                && ts.is_timer_running
        })
}

fn timesheet_mutation_blocked(entry: &ProjectTimesheet) -> Result<(), String> {
    if entry.timesheet_invoice_id.is_some() {
        return Err("Cannot mutate billed timesheet".to_string());
    }
    if entry.validation_status == "validated" {
        return Err("Cannot mutate validated timesheet".to_string());
    }
    Ok(())
}

fn require_timesheet_employee(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
) -> Result<(), String> {
    let employee = ctx
        .db
        .hr_employee()
        .id()
        .find(&employee_id)
        .ok_or("Employee not found")?;
    if employee.organization_id != organization_id {
        return Err("Employee belongs to a different organization".to_string());
    }
    if employee.company_id != company_id {
        return Err("Employee does not belong to this company".to_string());
    }
    Ok(())
}

fn insert_approval_snapshot(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    entry: &ProjectTimesheet,
    decision: &str,
    reason: Option<String>,
) {
    ctx.db
        .project_timesheet_approval()
        .insert(ProjectTimesheetApproval {
            id: 0,
            organization_id,
            company_id,
            timesheet_id: entry.id,
            actor: ctx.sender(),
            decision: decision.to_string(),
            reason,
            hours: entry.unit_amount,
            sell_rate: entry.sell_rate,
            cost_rate: entry.employee_cost,
            currency_id: entry.currency_id,
            decided_at: ctx.timestamp,
        });
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Log hours against a task
#[reducer]
pub fn log_timesheet(
    ctx: &ReducerContext,
    organization_id: u64,
    params: LogTimesheetParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_timesheet", "create")?;
    require_active_currency_by_id(ctx, params.currency_id)?;

    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    if params.unit_amount <= 0.0 {
        return Err("Hours must be greater than 0".to_string());
    }

    let project = ctx
        .db
        .project_project()
        .id()
        .find(&params.project_id)
        .ok_or("Project not found")?;
    if project.organization_id != organization_id {
        return Err("Project does not belong to this organization".to_string());
    }
    if project.company_id != company_id {
        return Err("Project does not belong to this company".to_string());
    }
    if !project.active {
        return Err("Cannot log timesheets on inactive project".to_string());
    }
    if !project.allow_timesheets {
        return Err("Timesheets are not allowed on this project".to_string());
    }

    // Validate or derive timesheet_invoice_type
    let resolved_invoice_type = match params.timesheet_invoice_type {
        Some(ref t) => {
            TimesheetInvoiceType::from_str(t)?;
            t.clone()
        }
        None => TimesheetInvoiceType::default_for_bill_type(&project.bill_type)
            .as_str()
            .to_string(),
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
        if task.company_id != company_id {
            return Err("Task does not belong to this company".to_string());
        }
    }

    require_timesheet_employee(ctx, organization_id, company_id, params.employee_id)?;

    let billable = project_is_billable(&project.bill_type);
    let (employee_cost, sell_rate) = resolve_timesheet_rates(
        ctx,
        organization_id,
        company_id,
        params.project_id,
        params.employee_id,
        params.task_id,
        params.currency_id,
        params.date,
        billable,
        params.employee_cost,
        params.sell_rate,
    )?;
    let amount = params.unit_amount * employee_cost;
    let revenue = params.unit_amount * sell_rate;

    let (currency_rate, company_currency_id) =
        timesheet_exchange_rate_snapshot(ctx, organization_id, company_id, params.currency_id)?;
    if company_currency_id == 0 {
        return Err("Company currency is required for timesheet FX snapshot".to_string());
    }

    let entry = ctx.db.project_timesheet().insert(ProjectTimesheet {
        id: 0,
        organization_id,
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
        employee_cost,
        sell_rate,
        timesheet_invoice_type: resolved_invoice_type,
        timesheet_invoice_id: None,
        timesheet_revenue: revenue,
        currency_rate,
        company_currency_id,
        amount_company: amount * currency_rate,
        timesheet_revenue_company: revenue * currency_rate,
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
                serde_json::json!({
                    "hours": entry.unit_amount,
                    "project_id": entry.project_id,
                    "employee_cost": entry.employee_cost,
                    "sell_rate": entry.sell_rate,
                })
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
    params: StartTimesheetTimerParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_timesheet", "create")?;
    require_active_currency_by_id(ctx, params.currency_id)?;

    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    let project = ctx
        .db
        .project_project()
        .id()
        .find(&params.project_id)
        .ok_or("Project not found")?;
    if project.organization_id != organization_id {
        return Err("Project does not belong to this organization".to_string());
    }
    if project.company_id != company_id {
        return Err("Project does not belong to this company".to_string());
    }
    if !project.active {
        return Err("Cannot start timer on inactive project".to_string());
    }
    if !project.allow_timesheet_timer {
        return Err("Timesheet timer is not allowed on this project".to_string());
    }

    // Validate or derive timesheet_invoice_type
    let resolved_invoice_type = match params.timesheet_invoice_type {
        Some(ref t) => {
            TimesheetInvoiceType::from_str(t)?;
            t.clone()
        }
        None => TimesheetInvoiceType::default_for_bill_type(&project.bill_type)
            .as_str()
            .to_string(),
    };

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
        if task.company_id != company_id {
            return Err("Task does not belong to this company".to_string());
        }
    }

    if employee_has_running_timer(ctx, organization_id, company_id, params.employee_id) {
        return Err(
            "Employee already has a running timer; stop it before starting another".to_string(),
        );
    }

    require_timesheet_employee(ctx, organization_id, company_id, params.employee_id)?;

    let billable = project_is_billable(&project.bill_type);
    let (employee_cost, sell_rate) = resolve_timesheet_rates(
        ctx,
        organization_id,
        company_id,
        params.project_id,
        params.employee_id,
        params.task_id,
        params.currency_id,
        ctx.timestamp,
        billable,
        params.employee_cost,
        params.sell_rate,
    )?;

    let (currency_rate, company_currency_id) =
        timesheet_exchange_rate_snapshot(ctx, organization_id, company_id, params.currency_id)?;
    if company_currency_id == 0 {
        return Err("Company currency is required for timesheet FX snapshot".to_string());
    }

    let entry = ctx.db.project_timesheet().insert(ProjectTimesheet {
        id: 0,
        organization_id,
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
        employee_cost,
        sell_rate,
        timesheet_invoice_type: resolved_invoice_type,
        timesheet_invoice_id: None,
        timesheet_revenue: 0.0,
        currency_rate,
        company_currency_id,
        amount_company: 0.0,
        timesheet_revenue_company: 0.0,
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
    timesheet_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_timesheet", "write")?;

    let entry = ctx
        .db
        .project_timesheet()
        .id()
        .find(&timesheet_id)
        .ok_or("Timesheet entry not found")?;

    if entry.organization_id != organization_id {
        return Err("Timesheet does not belong to this organization".to_string());
    }

    let company_id = entry.company_id;
    timesheet_mutation_blocked(&entry)?;

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
    let revenue = unit_amount * entry.sell_rate;

    ctx.db.project_timesheet().id().update(ProjectTimesheet {
        is_timer_running: false,
        unit_amount,
        amount,
        timesheet_revenue: revenue,
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

/// Validate timesheet entries (manager approval) — SoD: validator ≠ logger
#[reducer]
pub fn validate_timesheets(
    ctx: &ReducerContext,
    organization_id: u64,
    params: ValidateTimesheetsParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_timesheet", "validate")?;

    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    let timesheet_ids = params.timesheet_ids;

    for tid in &timesheet_ids {
        let entry = ctx
            .db
            .project_timesheet()
            .id()
            .find(tid)
            .ok_or("Timesheet entry not found")?;

        if entry.organization_id != organization_id {
            return Err("Timesheet does not belong to this organization".to_string());
        }
        if entry.company_id != company_id {
            return Err("Timesheet does not belong to this company".to_string());
        }
        if entry.validation_status != "draft" {
            return Err(format!(
                "Timesheet {} must be draft to validate (status={})",
                tid, entry.validation_status
            ));
        }
        if entry.timesheet_invoice_id.is_some() {
            return Err(format!("Timesheet {} is already billed", tid));
        }
        // Separation of duties: validator must not be the logger
        if ctx.sender() == entry.user_id {
            return Err(format!(
                "Cannot self-validate timesheet {} (validator equals logger)",
                tid
            ));
        }

        // Re-resolve rates from rate cards for billable projects (card wins over client)
        let project = ctx
            .db
            .project_project()
            .id()
            .find(&entry.project_id)
            .ok_or("Project not found")?;
        let billable = project_is_billable(&project.bill_type);
        let (employee_cost, sell_rate) = resolve_timesheet_rates(
            ctx,
            organization_id,
            company_id,
            entry.project_id,
            entry.employee_id,
            entry.task_id,
            entry.currency_id,
            entry.date,
            billable,
            Some(entry.employee_cost),
            Some(entry.sell_rate),
        )?;
        let amount = entry.unit_amount * employee_cost;
        let revenue = entry.unit_amount * sell_rate;

        let mut with_rates = ProjectTimesheet {
            employee_cost,
            sell_rate,
            amount,
            timesheet_revenue: revenue,
            ..entry
        };
        with_rates = ensure_timesheet_fx_snapshot(ctx, organization_id, with_rates)?;

        insert_approval_snapshot(
            ctx,
            organization_id,
            company_id,
            &with_rates,
            "validated",
            None,
        );

        ctx.db.project_timesheet().id().update(ProjectTimesheet {
            validation_status: "validated".to_string(),
            validated_by: Some(ctx.sender()),
            validated_at: Some(ctx.timestamp),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..with_rates
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
                old_values: Some(serde_json::json!({ "validation_status": "draft" }).to_string()),
                new_values: Some(
                    serde_json::json!({ "validation_status": "validated" }).to_string(),
                ),
                changed_fields: vec!["validated".to_string()],
                metadata: None,
            },
        );
    }

    // Optional WIP JE when project flag + accounts supplied
    if let (Some(journal_id), Some(wip_account_id), Some(labor_account_id)) = (
        params.wip_journal_id,
        params.wip_account_id,
        params.wip_labor_account_id,
    ) {
        maybe_post_wip_je_for_validated(
            ctx,
            organization_id,
            company_id,
            &timesheet_ids,
            &PostTimesheetWipParams {
                journal_id,
                wip_account_id,
                labor_account_id,
            },
        )?;
    }

    let mut project_ids = Vec::new();
    let mut employee_ids = std::collections::BTreeSet::new();
    for tid in &timesheet_ids {
        if let Some(ts) = ctx.db.project_timesheet().id().find(tid) {
            project_ids.push(ts.project_id);
            employee_ids.insert(ts.employee_id);
        }
    }
    refresh_project_margin_for_projects(ctx, organization_id, company_id, project_ids);
    let period_end = ctx.timestamp;
    let period_start = Timestamp::from_micros_since_unix_epoch(
        period_end
            .to_micros_since_unix_epoch()
            .saturating_sub(30 * 86_400_000_000),
    );
    for eid in employee_ids {
        refresh_resource_utilisation_snapshot(
            ctx,
            organization_id,
            company_id,
            eid,
            period_start,
            period_end,
        );
    }

    log::info!("Timesheets validated: count={}", timesheet_ids.len());
    Ok(())
}

/// Reject draft/submitted timesheets with a reason
#[reducer]
pub fn reject_timesheets(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RejectTimesheetsParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_timesheet", "validate")?;

    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    if params.reason.trim().is_empty() {
        return Err("Rejection reason is required".to_string());
    }
    let timesheet_ids = params.timesheet_ids.clone();
    let reason = params.reason;

    for tid in &timesheet_ids {
        let entry = ctx
            .db
            .project_timesheet()
            .id()
            .find(tid)
            .ok_or("Timesheet entry not found")?;

        if entry.organization_id != organization_id {
            return Err("Timesheet does not belong to this organization".to_string());
        }
        if entry.company_id != company_id {
            return Err("Timesheet does not belong to this company".to_string());
        }
        if entry.timesheet_invoice_id.is_some() {
            return Err(format!(
                "Timesheet {} is billed and cannot be rejected",
                tid
            ));
        }
        if entry.validation_status != "draft" && entry.validation_status != "submitted" {
            return Err(format!(
                "Timesheet {} must be draft or submitted to reject (status={})",
                tid, entry.validation_status
            ));
        }

        let old_status = entry.validation_status.clone();
        insert_approval_snapshot(
            ctx,
            organization_id,
            company_id,
            &entry,
            "rejected",
            Some(reason.clone()),
        );

        ctx.db.project_timesheet().id().update(ProjectTimesheet {
            validation_status: "rejected".to_string(),
            validated_by: None,
            validated_at: None,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..entry
        });

        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(company_id),
                table_name: "project_timesheet",
                record_id: *tid,
                action: "UPDATE",
                old_values: Some(
                    serde_json::json!({ "validation_status": old_status }).to_string(),
                ),
                new_values: Some(
                    serde_json::json!({
                        "validation_status": "rejected",
                        "reason": reason,
                    })
                    .to_string(),
                ),
                changed_fields: vec!["rejected".to_string()],
                metadata: None,
            },
        );
    }

    let mut project_ids = Vec::new();
    for tid in &timesheet_ids {
        if let Some(ts) = ctx.db.project_timesheet().id().find(tid) {
            project_ids.push(ts.project_id);
        }
    }
    refresh_project_margin_for_projects(ctx, organization_id, company_id, project_ids);

    log::info!("Timesheets rejected: count={}", timesheet_ids.len());
    Ok(())
}

/// Reopen validated unbilled timesheets back to draft
#[reducer]
pub fn reopen_timesheets(
    ctx: &ReducerContext,
    organization_id: u64,
    params: ReopenTimesheetsParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_timesheet", "validate")?;

    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    let timesheet_ids = params.timesheet_ids.clone();
    let reason = params.reason;

    for tid in &timesheet_ids {
        let entry = ctx
            .db
            .project_timesheet()
            .id()
            .find(tid)
            .ok_or("Timesheet entry not found")?;

        if entry.organization_id != organization_id {
            return Err("Timesheet does not belong to this organization".to_string());
        }
        if entry.company_id != company_id {
            return Err("Timesheet does not belong to this company".to_string());
        }
        if entry.timesheet_invoice_id.is_some() {
            return Err(format!(
                "Timesheet {} is billed and cannot be reopened",
                tid
            ));
        }
        if entry.validation_status != "validated" && entry.validation_status != "rejected" {
            return Err(format!(
                "Timesheet {} must be validated or rejected to reopen (status={})",
                tid, entry.validation_status
            ));
        }

        let old_status = entry.validation_status.clone();
        insert_approval_snapshot(
            ctx,
            organization_id,
            company_id,
            &entry,
            "reopened",
            reason.clone(),
        );

        ctx.db.project_timesheet().id().update(ProjectTimesheet {
            validation_status: "draft".to_string(),
            validated_by: None,
            validated_at: None,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..entry
        });

        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(company_id),
                table_name: "project_timesheet",
                record_id: *tid,
                action: "UPDATE",
                old_values: Some(
                    serde_json::json!({ "validation_status": old_status }).to_string(),
                ),
                new_values: Some(serde_json::json!({ "validation_status": "draft" }).to_string()),
                changed_fields: vec!["reopened".to_string()],
                metadata: None,
            },
        );
    }

    let mut project_ids = Vec::new();
    for tid in &timesheet_ids {
        if let Some(ts) = ctx.db.project_timesheet().id().find(tid) {
            project_ids.push(ts.project_id);
        }
    }
    refresh_project_margin_for_projects(ctx, organization_id, company_id, project_ids);

    log::info!("Timesheets reopened: count={}", timesheet_ids.len());
    Ok(())
}
