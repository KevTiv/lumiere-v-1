//! Wave F — PRJ-003 (analytic_account_id FK), PRJ-004 (task stage_id FK,
//! project-scoped), PRJ-005 (cross-project timesheet task rejection).
use spacetimedb::{ReducerContext, Table};

use crate::accounting::analytic_accounting::{
    account_analytic_account, create_analytic_account, CreateAnalyticAccountParams,
};
use crate::core::persistence::{organization_commit, organization_row_change};
use crate::projects::milestones::{
    create_project_milestone, project_milestone, CreateProjectMilestoneParams,
};
use crate::projects::projects::{create_project, project_project, CreateProjectParams};
use crate::projects::task_stages::{
    create_project_task_stage, project_task_stage, CreateProjectTaskStageParams,
};
use crate::projects::tasks::{create_task, project_task};
use crate::projects::timesheets::{log_timesheet, LogTimesheetParams};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

use super::wave_c_test::{sample_task, seed_employee, seed_project};

fn seed_analytic_account(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    name: &str,
) -> Result<u64, String> {
    create_analytic_account(
        ctx,
        fixture.organization_id,
        CreateAnalyticAccountParams {
            company_id: Some(fixture.company_id),
            name: name.to_string(),
            code: None,
            active: true,
            currency_id: 1,
            partner_id: None,
            plan_id: None,
            root_id: None,
            group_id: None,
            parent_id: None,
            color: None,
            is_required_in_move_lines: false,
            is_required_in_distribution: false,
            is_root_plan: false,
            metadata: None,
        },
    )?;
    ctx.db
        .account_analytic_account()
        .iter()
        .find(|a| a.organization_id == fixture.organization_id && a.name == name)
        .map(|a| a.id)
        .ok_or_else(|| format!("analytic account {name} missing"))
}

/// PRJ-003: create_project rejects a missing/cross-org analytic_account_id and
/// accepts a valid same-org/company one.
pub fn test_project_analytic_account_fk(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let other_org = OrgFixture::seed_minimal(ctx)?;

    let missing = create_project(
        ctx,
        fixture.organization_id,
        project_params(&fixture, "PRJ-003 Missing Account", Some(999_999_999)),
    );
    if missing.is_ok() {
        return Err("missing analytic_account_id should reject".into());
    }

    let foreign_account_id = seed_analytic_account(ctx, &other_org, "Foreign Analytic")?;
    let cross_org = create_project(
        ctx,
        fixture.organization_id,
        project_params(
            &fixture,
            "PRJ-003 Cross Org Account",
            Some(foreign_account_id),
        ),
    );
    if cross_org.is_ok() {
        return Err("cross-org analytic_account_id should reject".into());
    }

    let valid_account_id = seed_analytic_account(ctx, &fixture, "Valid Analytic")?;
    create_project(
        ctx,
        fixture.organization_id,
        project_params(&fixture, "PRJ-003 Valid Account", Some(valid_account_id)),
    )?;
    let saved = ctx
        .db
        .project_project()
        .iter()
        .find(|p| p.organization_id == fixture.organization_id && p.name == "PRJ-003 Valid Account")
        .ok_or("valid project missing")?;
    if saved.analytic_account_id != Some(valid_account_id) {
        return Err("valid analytic_account_id was not persisted".into());
    }
    Ok(())
}

fn project_params(
    fixture: &OrgFixture,
    name: &str,
    analytic_account_id: Option<u64>,
) -> CreateProjectParams {
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
        analytic_account_id,
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

/// PRJ-004: a task's stage_id must belong to the task's own project — a stage
/// created for a sibling project is rejected even though it's same org/company.
pub fn test_task_stage_fk_project_scoped(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let project_a = seed_project(ctx, &fixture, "PRJ-004 Project A")?;
    let project_b = seed_project(ctx, &fixture, "PRJ-004 Project B")?;

    create_project_task_stage(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateProjectTaskStageParams {
            project_id: project_a,
            name: "In Progress".to_string(),
            sequence: 1,
            is_closed: false,
        },
    )?;
    let stage_a = ctx
        .db
        .project_task_stage()
        .iter()
        .find(|s| s.project_id == project_a)
        .map(|s| s.id)
        .ok_or("stage A missing")?;

    // Task in project B using project A's stage must reject.
    let mut task_b_params = sample_task(fixture.company_id, project_b, "PRJ-004 Task B", None, "");
    task_b_params.stage_id = Some(stage_a);
    let cross_project = create_task(ctx, fixture.organization_id, task_b_params);
    if cross_project.is_ok() {
        return Err("task stage from a different project should reject".into());
    }

    // Task in project A using project A's stage must succeed.
    let mut task_a_params = sample_task(fixture.company_id, project_a, "PRJ-004 Task A", None, "");
    task_a_params.stage_id = Some(stage_a);
    create_task(ctx, fixture.organization_id, task_a_params)?;
    let saved_task = ctx
        .db
        .project_task()
        .iter()
        .find(|t| t.organization_id == fixture.organization_id && t.name == "PRJ-004 Task A")
        .ok_or("task A missing")?;
    if saved_task.stage_id != Some(stage_a) {
        return Err("same-project stage_id was not persisted".into());
    }
    let commits: Vec<_> = ctx
        .db
        .organization_commit()
        .iter()
        .filter(|commit| {
            commit.organization_id == fixture.organization_id
                && commit.operation_id == "erp.create_task"
                && commit.correlation_id == format!("project-task:{}", saved_task.id)
        })
        .collect();
    if commits.len() != 1 || commits[0].row_change_count != 2 {
        return Err(format!("task commit mismatch: {}", commits.len()));
    }
    let mut changes: Vec<_> = ctx
        .db
        .organization_row_change()
        .iter()
        .filter(|change| {
            change.organization_id == fixture.organization_id
                && change.commit_sequence == commits[0].sequence
        })
        .collect();
    changes.sort_by_key(|change| change.ordinal);
    let tables: Vec<_> = changes
        .iter()
        .map(|change| change.table_name.as_str())
        .collect();
    if tables != ["project_project", "project_task"]
        || changes
            .iter()
            .any(|change| change.organization_id != fixture.organization_id)
    {
        return Err(format!("task row order/scope mismatch: {tables:?}"));
    }
    Ok(())
}

/// PRJ-005: log_timesheet rejects a task_id that belongs to a different
/// project than the one named in the timesheet params.
pub fn test_log_timesheet_rejects_cross_project_task(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let employee_id = seed_employee(ctx, &fixture, "PRJ-005 Timesheet Emp")?;
    let project_a = seed_project(ctx, &fixture, "PRJ-005 Project A")?;
    let project_b = seed_project(ctx, &fixture, "PRJ-005 Project B")?;

    create_task(
        ctx,
        fixture.organization_id,
        sample_task(fixture.company_id, project_a, "PRJ-005 Task A", None, ""),
    )?;
    let task_a = ctx
        .db
        .project_task()
        .iter()
        .find(|t| t.organization_id == fixture.organization_id && t.name == "PRJ-005 Task A")
        .map(|t| t.id)
        .ok_or("task A missing")?;

    let cross = log_timesheet(
        ctx,
        fixture.organization_id,
        LogTimesheetParams {
            company_id: Some(fixture.company_id),
            project_id: project_b,
            task_id: Some(task_a),
            employee_id,
            name: "cross-project attempt".to_string(),
            date: ctx.timestamp,
            unit_amount: 1.0,
            currency_id: 1,
            employee_cost: Some(10.0),
            sell_rate: Some(20.0),
            timesheet_invoice_type: None,
            product_id: None,
            product_uom_id: None,
            account_id: None,
            encoding_uom_id: 1,
            so_line: None,
            department_id: None,
            manager_id: None,
            metadata: None,
        },
    );
    if cross.is_ok() {
        return Err("timesheet against a task from a different project should reject".into());
    }
    Ok(())
}

fn seed_milestone(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    project_id: u64,
    name: &str,
) -> Result<u64, String> {
    create_project_milestone(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateProjectMilestoneParams {
            project_id,
            name: name.to_string(),
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
    ctx.db
        .project_milestone()
        .iter()
        .find(|m| m.organization_id == fixture.organization_id && m.name == name)
        .map(|m| m.id)
        .ok_or_else(|| format!("milestone {name} missing"))
}

/// PRJ-007: a task's milestone_id must belong to the task's own project and
/// organization. `validate_milestone_fk` (src/projects/milestones.rs) is
/// already wired into create_task/update_task — this proves a milestone from
/// a sibling project (same org) and one from a different org entirely are
/// both rejected, while a same-project milestone is accepted and persisted.
pub fn test_task_milestone_fk_cross_project_and_org_rejected(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let other_org = OrgFixture::seed_minimal(ctx)?;

    let project_a = seed_project(ctx, &fixture, "PRJ-007 Project A")?;
    let project_b = seed_project(ctx, &fixture, "PRJ-007 Project B")?;

    // Same org, sibling project's milestone must reject.
    let milestone_b = seed_milestone(ctx, &fixture, project_b, "PRJ-007 Milestone B")?;
    let cross_project = create_task(
        ctx,
        fixture.organization_id,
        sample_task(
            fixture.company_id,
            project_a,
            "PRJ-007 Task Cross Project",
            Some(milestone_b),
            "",
        ),
    );
    if cross_project.is_ok() {
        return Err("task milestone from a different project should reject".into());
    }

    // A milestone belonging to a completely different organization must reject too.
    let foreign_project = seed_project(ctx, &other_org, "PRJ-007 Foreign Project")?;
    let foreign_milestone = seed_milestone(
        ctx,
        &other_org,
        foreign_project,
        "PRJ-007 Foreign Milestone",
    )?;
    let cross_org = create_task(
        ctx,
        fixture.organization_id,
        sample_task(
            fixture.company_id,
            project_a,
            "PRJ-007 Task Cross Org",
            Some(foreign_milestone),
            "",
        ),
    );
    if cross_org.is_ok() {
        return Err("task milestone from a different organization should reject".into());
    }

    // Sanity: a milestone belonging to the task's own project is accepted.
    let milestone_a = seed_milestone(ctx, &fixture, project_a, "PRJ-007 Milestone A")?;
    create_task(
        ctx,
        fixture.organization_id,
        sample_task(
            fixture.company_id,
            project_a,
            "PRJ-007 Task Valid",
            Some(milestone_a),
            "",
        ),
    )?;
    let saved = ctx
        .db
        .project_task()
        .iter()
        .find(|t| t.organization_id == fixture.organization_id && t.name == "PRJ-007 Task Valid")
        .ok_or("valid task missing")?;
    if saved.milestone_id != Some(milestone_a) {
        return Err("same-project milestone_id was not persisted".into());
    }
    Ok(())
}
