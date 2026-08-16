//! Wave C — capacity calendars, over-allocation reject, WBS/milestone smoke.
use spacetimedb::{ReducerContext, Table, Timestamp};

use crate::hr::employees::{create_employee, hr_employee, CreateEmployeeParams};
use crate::projects::capacity::{
    create_resource_allocation, create_working_calendar, resource_allocation,
    resource_capacity_snapshot, seed_pack_holidays, CreateResourceAllocationParams,
    CreateWorkingCalendarParams, SeedPackHolidaysParams,
};
use crate::projects::milestones::{
    create_project_milestone, project_milestone, CreateProjectMilestoneParams,
};
use crate::projects::projects::{create_project, project_project, CreateProjectParams};
use crate::projects::tasks::{create_task, project_task, CreateTaskParams};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{EmploymentType, TaskState};

fn micros_days_from_now(ctx: &ReducerContext, days: i64) -> Timestamp {
    Timestamp::from_micros_since_unix_epoch(
        ctx.timestamp.to_micros_since_unix_epoch() + days * 86_400_000_000,
    )
}

pub(super) fn seed_employee(ctx: &ReducerContext, fixture: &OrgFixture, name: &str) -> Result<u64, String> {
    create_employee(
        ctx,
        fixture.organization_id,
        CreateEmployeeParams {
            company_id: Some(fixture.company_id),
            name: name.to_string(),
            job_id: None,
            department_id: None,
            employment_type: EmploymentType::FullTime,
            work_email: None,
            employee_number: None,
            job_title: None,
            parent_id: None,
            coach_id: None,
            work_phone: None,
            mobile_phone: None,
            work_location: None,
            work_contact_partner_id: None,
            date_hired: None,
            gender: None,
            birthday: None,
            marital: None,
            emergency_contact: None,
            emergency_phone: None,
            barcode: None,
            pin: None,
            image_url: None,
            color: None,
            is_active: true,
            metadata: None,
        },
    )?;
    ctx.db
        .hr_employee()
        .iter()
        .find(|e| e.organization_id == fixture.organization_id && e.name == name)
        .map(|e| e.id)
        .ok_or_else(|| format!("employee {name} missing"))
}

pub(super) fn seed_project(ctx: &ReducerContext, fixture: &OrgFixture, name: &str) -> Result<u64, String> {
    create_project(
        ctx,
        fixture.organization_id,
        CreateProjectParams {
            company_id: Some(fixture.company_id),
            name: name.to_string(),
            description: None,
            active: true,
            sequence: 1,
            currency_id: 1,
            partner_id: Some(fixture.partner_id),
            partner_email: None,
            partner_phone: None,
            partner_company_id: None,
            date_start: None,
            date: None,
            date_end: None,
            allow_subtasks: true,
            allow_recurring_tasks: false,
            allow_task_dependencies: false,
            allow_timesheets: true,
            allow_timesheet_timer: true,
            allow_material: false,
            allow_worksheets: false,
            allow_forecast: false,
            allow_wip_je: false,
            bill_type: "customer_project".into(),
            pricing_type: "fixed_rate".into(),
            rating_status: "off".into(),
            rating_status_period: "monthly".into(),
            privacy_visibility: "employees".into(),
            access_instruction_message: None,
            task_count: 0,
            task_count_open: 0,
            task_count_closed: 0,
            task_count_in_progress: 0,
            task_count_blocked: 0,
            sale_order_id: None,
            sale_line_id: None,
            last_update_status: "on_track".into(),
            last_update_color: None,
            is_favorite: false,
            color: None,
            stage_id: None,
            analytic_account_id: None,
            activity_ids: vec![],
            activity_state: None,
            activity_date_deadline: None,
            activity_type_id: None,
            activity_user_id: None,
            activity_summary: None,
            message_follower_ids: vec![],
            message_ids: vec![],
            metadata: None,
        },
    )?;
    ctx.db
        .project_project()
        .iter()
        .find(|p| p.organization_id == fixture.organization_id && p.name == name)
        .map(|p| p.id)
        .ok_or_else(|| format!("project {name} missing"))
}

pub(super) fn sample_task(
    company: u64,
    project_id: u64,
    name: &str,
    milestone_id: Option<u64>,
    wbs_code: &str,
) -> CreateTaskParams {
    CreateTaskParams {
        company_id: Some(company),
        project_id: Some(project_id),
        name: name.to_string(),
        description: None,
        priority: "1".into(),
        sequence: 1,
        stage_id: None,
        state: TaskState::InProgress,
        kanban_state: "normal".into(),
        date_deadline: None,
        date_start: None,
        date_end: None,
        color: None,
        user_ids: vec![],
        milestone_id,
        wbs_code: wbs_code.to_string(),
        wbs_level: 0,
        planned_hours: 8.0,
        total_hours_spent: 0.0,
        effective_hours: 0.0,
        progress: 0.0,
        remaining_hours: 8.0,
        sale_order_id: None,
        sale_line_id: None,
        partner_id: None,
        partner_email: None,
        parent_id: None,
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
        metadata: None,
    }
}

/// Over-allocation with `enforce_capacity` must reject.
pub fn test_over_allocation_rejected(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let company = fixture.company_id;

    create_working_calendar(
        ctx,
        org,
        company,
        CreateWorkingCalendarParams {
            name: "AU Pilot".into(),
            pack_key: "au".into(),
            hours_per_day: 8.0,
            work_monday: true,
            work_tuesday: true,
            work_wednesday: true,
            work_thursday: true,
            work_friday: true,
            work_saturday: false,
            work_sunday: false,
            active: true,
            metadata: None,
        },
    )?;
    seed_pack_holidays(
        ctx,
        org,
        company,
        SeedPackHolidaysParams {
            pack_keys: vec!["au".into()],
            calendar_id: None,
        },
    )?;

    let employee_id = seed_employee(ctx, &fixture, "Wave C Allocator")?;
    let project_id = seed_project(ctx, &fixture, "Wave C Capacity Project")?;

    create_resource_allocation(
        ctx,
        org,
        company,
        CreateResourceAllocationParams {
            employee_id: Some(employee_id),
            resource_id: None,
            project_id,
            task_id: None,
            date_from: ctx.timestamp,
            date_to: micros_days_from_now(ctx, 27),
            allocated_hours: 150.0,
            allocation_percent: 0.0,
            name: Some("heavy".into()),
            notes: None,
            enforce_capacity: true,
            active: true,
            metadata: None,
        },
    )?;

    let snap = ctx
        .db
        .resource_capacity_snapshot()
        .iter()
        .find(|s| s.organization_id == org && s.employee_id == Some(employee_id))
        .ok_or("capacity snapshot missing after allocation")?;
    if snap.remaining_hours >= 150.0 {
        return Err(format!(
            "expected remaining < 150 after heavy booking, got {}",
            snap.remaining_hours
        ));
    }

    let over = create_resource_allocation(
        ctx,
        org,
        company,
        CreateResourceAllocationParams {
            employee_id: Some(employee_id),
            resource_id: None,
            project_id,
            task_id: None,
            date_from: ctx.timestamp,
            date_to: micros_days_from_now(ctx, 27),
            allocated_hours: 200.0,
            allocation_percent: 0.0,
            name: Some("overflow".into()),
            notes: None,
            enforce_capacity: true,
            active: true,
            metadata: None,
        },
    );
    if over.is_ok() {
        return Err("expected over-allocation to be rejected".into());
    }
    let msg = over.err().unwrap_or_default();
    if !msg.to_ascii_lowercase().contains("over-allocation") {
        return Err(format!("unexpected reject message: {msg}"));
    }

    let count = ctx
        .db
        .resource_allocation()
        .iter()
        .filter(|a| a.organization_id == org && a.employee_id == Some(employee_id))
        .count();
    if count != 1 {
        return Err(format!("expected 1 allocation row, got {count}"));
    }

    Ok(())
}

/// Milestone CRUD + task WBS/milestone_id FK validation.
pub fn test_milestone_and_wbs(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let company = fixture.company_id;
    let project_id = seed_project(ctx, &fixture, "Wave C Milestone Project")?;

    create_project_milestone(
        ctx,
        org,
        company,
        CreateProjectMilestoneParams {
            project_id,
            name: "M1 Delivery".into(),
            description: None,
            deadline: None,
            sequence: 1,
            is_reached: false,
            bill_amount: 0.0,
            percent_complete: 0.0,
            active: true,
            metadata: None,
        },
    )?;
    let milestone_id = ctx
        .db
        .project_milestone()
        .iter()
        .find(|m| m.organization_id == org && m.name == "M1 Delivery")
        .map(|m| m.id)
        .ok_or("milestone missing")?;

    create_task(
        ctx,
        org,
        sample_task(company, project_id, "Root WBS", Some(milestone_id), "1"),
    )?;

    let task = ctx
        .db
        .project_task()
        .iter()
        .find(|t| t.organization_id == org && t.name == "Root WBS")
        .ok_or("task missing")?;
    if task.wbs_code != "1" || task.wbs_level != 0 {
        return Err(format!(
            "bad wbs: code={} level={}",
            task.wbs_code, task.wbs_level
        ));
    }
    if task.milestone_id != Some(milestone_id) {
        return Err("task milestone_id not set".into());
    }

    let bad = create_task(
        ctx,
        org,
        sample_task(company, project_id, "Bad milestone", Some(999_999_999), "2"),
    );
    if bad.is_ok() {
        return Err("expected invalid milestone_id to fail".into());
    }

    Ok(())
}
