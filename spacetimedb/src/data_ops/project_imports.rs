/// Project CSV Imports — ProjectProject, ProjectTask, ProjectTimesheet
use spacetimedb::{ReducerContext, Table};

use crate::data_ops::helpers::*;
use crate::data_ops::import_tracker::{begin_import_job, finish_import_job, record_import_error};
use crate::helpers::check_permission;
use crate::projects::projects::{project_project, ProjectProject};
use crate::projects::tasks::{project_task, ProjectTask};
use crate::projects::timesheets::{project_timesheet, ProjectTimesheet};
use crate::types::TaskState;

// ── ProjectProject ────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_project_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_project", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "project_project",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        let currency_id = parse_u64(col(&headers, row, "currency_id"));

        ctx.db.project_project().insert(ProjectProject {
            id: 0,
            name,
            description: opt_str(col(&headers, row, "description")),
            active: true,
            sequence: parse_u32(col(&headers, row, "sequence")),
            company_id,
            currency_id,
            partner_id: opt_u64(col(&headers, row, "partner_id")),
            partner_email: None,
            partner_phone: None,
            partner_company_id: None,
            user_id: ctx.sender(),
            date_start: opt_timestamp(col(&headers, row, "date_start")),
            date: None,
            date_end: opt_timestamp(col(&headers, row, "date_end")),
            allow_subtasks: parse_bool(col(&headers, row, "allow_subtasks")),
            allow_recurring_tasks: false,
            allow_task_dependencies: false,
            allow_timesheets: parse_bool(col(&headers, row, "allow_timesheets")),
            allow_timesheet_timer: false,
            allow_material: false,
            allow_worksheets: false,
            allow_forecast: false,
            bill_type: {
                let v = col(&headers, row, "bill_type");
                if v.is_empty() {
                    "no_invoice".to_string()
                } else {
                    v.to_string()
                }
            },
            pricing_type: {
                let v = col(&headers, row, "pricing_type");
                if v.is_empty() {
                    "task_rate".to_string()
                } else {
                    v.to_string()
                }
            },
            rating_status: "no_rating".to_string(),
            rating_status_period: "monthly".to_string(),
            privacy_visibility: {
                let v = col(&headers, row, "privacy_visibility");
                if v.is_empty() {
                    "followers".to_string()
                } else {
                    v.to_string()
                }
            },
            access_instruction_message: None,
            task_count: 0,
            task_count_open: 0,
            task_count_closed: 0,
            task_count_in_progress: 0,
            task_count_blocked: 0,
            sale_order_id: None,
            sale_line_id: None,
            last_update_status: "on_track".to_string(),
            last_update_color: None,
            is_favorite: false,
            color: None,
            stage_id: opt_u64(col(&headers, row, "stage_id")),
            analytic_account_id: opt_u64(col(&headers, row, "analytic_account_id")),
            activity_ids: vec![],
            activity_state: None,
            activity_date_deadline: None,
            activity_type_id: None,
            activity_user_id: None,
            activity_summary: None,
            message_follower_ids: vec![],
            message_ids: vec![],
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import project_project: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── ProjectTask ───────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_task_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_task", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "project_task",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        ctx.db.project_task().insert(ProjectTask {
            id: 0,
            name,
            description: opt_str(col(&headers, row, "description")),
            priority: {
                let v = col(&headers, row, "priority");
                if v.is_empty() {
                    "0".to_string()
                } else {
                    v.to_string()
                }
            },
            sequence: parse_u32(col(&headers, row, "sequence")),
            stage_id: opt_u64(col(&headers, row, "stage_id")),
            state: TaskState::InProgress,
            kanban_state: "normal".to_string(),
            date_assign: None,
            date_deadline: opt_timestamp(col(&headers, row, "date_deadline")),
            date_start: opt_timestamp(col(&headers, row, "date_start")),
            date_end: None,
            color: None,
            company_id,
            project_id: opt_u64(col(&headers, row, "project_id")),
            user_ids: vec![],
            milestone_id: None,
            planned_hours: parse_f64(col(&headers, row, "planned_hours")),
            total_hours_spent: 0.0,
            effective_hours: 0.0,
            progress: 0.0,
            remaining_hours: parse_f64(col(&headers, row, "planned_hours")),
            sale_order_id: None,
            sale_line_id: None,
            partner_id: opt_u64(col(&headers, row, "partner_id")),
            partner_email: None,
            parent_id: opt_u64(col(&headers, row, "parent_id")),
            child_ids: vec![],
            subtask_count: 0,
            closed_subtask_count: 0,
            is_closed: false,
            is_blocked: false,
            allow_task_dependencies: false,
            depend_on_ids: vec![],
            dependent_ids: vec![],
            is_private: false,
            permitted_user_ids: vec![],
            activity_ids: vec![],
            activity_state: None,
            activity_date_deadline: None,
            activity_type_id: None,
            activity_user_id: None,
            activity_summary: None,
            message_follower_ids: vec![],
            message_ids: vec![],
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import project_task: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── ProjectTimesheet ──────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_timesheet_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_timesheet", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "project_timesheet",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let project_id = parse_u64(col(&headers, row, "project_id"));
        let employee_id = parse_u64(col(&headers, row, "employee_id"));

        if project_id == 0 || employee_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("project_id"),
                None,
                "project_id and employee_id are required",
            );
            errors += 1;
            continue;
        }

        let currency_id = parse_u64(col(&headers, row, "currency_id"));
        let encoding_uom_id = {
            let v = parse_u64(col(&headers, row, "encoding_uom_id"));
            if v == 0 {
                1
            } else {
                v
            }
        };
        let date = opt_timestamp(col(&headers, row, "date")).unwrap_or(ctx.timestamp);
        let unit_amount = parse_f64(col(&headers, row, "unit_amount"));

        ctx.db.project_timesheet().insert(ProjectTimesheet {
            id: 0,
            name: col(&headers, row, "name").to_string(),
            project_id,
            task_id: opt_u64(col(&headers, row, "task_id")),
            employee_id,
            user_id: ctx.sender(),
            date,
            unit_amount,
            amount: parse_f64(col(&headers, row, "amount")),
            product_id: opt_u64(col(&headers, row, "product_id")),
            product_uom_id: opt_u64(col(&headers, row, "product_uom_id")),
            account_id: opt_u64(col(&headers, row, "account_id")),
            currency_id,
            company_id,
            is_timer_running: false,
            timer_start: None,
            timer_pause: None,
            employee_cost: parse_f64(col(&headers, row, "employee_cost")),
            timesheet_invoice_type: "non_billable".to_string(),
            timesheet_invoice_id: None,
            timesheet_revenue: 0.0,
            so_line: None,
            encoding_uom_id,
            validation_status: "draft".to_string(),
            validated_by: None,
            validated_at: None,
            department_id: None,
            manager_id: None,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import project_timesheet: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}
