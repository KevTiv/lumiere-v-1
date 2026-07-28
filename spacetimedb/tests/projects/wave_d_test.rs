//! Wave D — project margin math + company isolation.
use std::time::Duration;

use spacetimedb::{Identity, ReducerContext, Table};

use crate::accounting::budgeting::{
    create_budget_line, create_crossovered_budget, crossovered_budget, crossovered_budget_lines,
    CreateCrossoveredBudgetLineParams, CreateCrossoveredBudgetParams,
};
use crate::accounting::chart_of_accounts::{
    account_journal, create_account_journal, CreateAccountJournalParams,
};
use crate::accounting::journal_entries::{
    account_move, bill_project_milestone, bill_timesheets, BillProjectMilestoneParams,
    BillTimesheetsParams,
};
use crate::hr::employees::{create_employee, hr_employee, CreateEmployeeParams};
use crate::projects::milestones::{
    create_project_milestone, project_milestone, CreateProjectMilestoneParams,
};
use crate::projects::project_accounting::{
    project_margin_snapshot, refresh_project_margin_snapshot,
};
use crate::projects::projects::{create_project, project_project, CreateProjectParams};
use crate::projects::tasks::{create_task, project_task, CreateTaskParams};
use crate::projects::timesheets::{
    log_timesheet, project_timesheet, validate_timesheets, LogTimesheetParams,
    ValidateTimesheetsParams,
};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{EmploymentType, JournalType, TaskState};

fn seed_sale_journal(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let revenue_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("Harness missing revenue account")?;
    let journal_code = format!("PD{company_id}");
    if let Some(j) = ctx
        .db
        .account_journal()
        .iter()
        .find(|j| j.organization_id == org_id && j.code == journal_code)
    {
        return Ok(j.id);
    }
    create_account_journal(
        ctx,
        org_id,
        CreateAccountJournalParams {
            company_id: Some(company_id),
            name: format!("PSA D Sale {company_id}"),
            code: journal_code.clone(),
            type_: JournalType::Sale,
            currency_id: Some(1),
            default_account_id: Some(revenue_id),
            suspense_account_id: None,
            loss_account_id: None,
            profit_account_id: None,
            bank_account_id: None,
            payment_credit_account_id: None,
            payment_debit_account_id: None,
            invoice_reference_type: None,
            invoice_reference_model: None,
            sequence_id: None,
            refund_sequence_id: None,
            sequence_override_regex: None,
            secure_sequence_id: None,
            alias_name: None,
            alias_domain: None,
            sale_activity_type_id: None,
            sale_activity_user_id: None,
            sale_activity_note: None,
            sale_activity_date_deadline: None,
            restrict_mode_hash_table: false,
            active: true,
            at_least_one_inbound: true,
            at_least_one_outbound: true,
            dedicated_payment_method_ids: vec![],
            sale_activity_done: false,
            metadata: None,
        },
    )?;
    ctx.db
        .account_journal()
        .iter()
        .find(|j| j.organization_id == org_id && j.code == journal_code)
        .map(|j| j.id)
        .ok_or_else(|| "PSA D sale journal not found".to_string())
}

fn seed_employee(ctx: &ReducerContext, fixture: &OrgFixture, name: &str) -> Result<u64, String> {
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

fn seed_billable_project(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    name: &str,
) -> Result<u64, String> {
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

fn seed_task(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    project_id: u64,
    name: &str,
) -> Result<u64, String> {
    create_task(
        ctx,
        fixture.organization_id,
        CreateTaskParams {
            company_id: Some(fixture.company_id),
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
            milestone_id: None,
            wbs_code: String::new(),
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
        },
    )?;
    ctx.db
        .project_task()
        .iter()
        .find(|t| {
            t.organization_id == fixture.organization_id
                && t.project_id == Some(project_id)
                && t.name == name
        })
        .map(|t| t.id)
        .ok_or_else(|| format!("task {name} missing"))
}

fn log_and_validate(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    project_id: u64,
    task_id: u64,
    employee_id: u64,
    hours: f64,
    cost: f64,
    sell: f64,
) -> Result<u64, String> {
    log_timesheet(
        ctx,
        fixture.organization_id,
        LogTimesheetParams {
            company_id: Some(fixture.company_id),
            project_id,
            task_id: Some(task_id),
            employee_id,
            name: format!("Wave D {hours}h"),
            date: ctx.timestamp,
            unit_amount: hours,
            currency_id: 1,
            employee_cost: Some(cost),
            sell_rate: Some(sell),
            timesheet_invoice_type: Some("billable".into()),
            product_id: None,
            product_uom_id: None,
            account_id: None,
            encoding_uom_id: 1,
            so_line: None,
            department_id: None,
            manager_id: None,
            metadata: None,
        },
    )?;
    let ts_id = ctx
        .db
        .project_timesheet()
        .iter()
        .filter(|t| t.organization_id == fixture.organization_id && t.project_id == project_id)
        .map(|t| t.id)
        .max()
        .ok_or("timesheet missing")?;
    // SoD: reassign logger away from validator (superuser)
    let ts = ctx.db.project_timesheet().id().find(&ts_id).ok_or("ts")?;
    ctx.db
        .project_timesheet()
        .id()
        .update(crate::projects::timesheets::ProjectTimesheet {
            user_id: Identity::__dummy(),
            ..ts
        });
    validate_timesheets(
        ctx,
        fixture.organization_id,
        ValidateTimesheetsParams {
            company_id: Some(fixture.company_id),
            timesheet_ids: vec![ts_id],
            wip_journal_id: None,
            wip_account_id: None,
            wip_labor_account_id: None,
        },
    )?;
    Ok(ts_id)
}

/// Margin = billed_revenue − labor_cost − expense_cost; unbilled tracked separately.
pub fn test_margin_math_on_validate_and_bill(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let emp = seed_employee(ctx, &fixture, "Margin Emp")?;
    let project_id = seed_billable_project(ctx, &fixture, "Margin Project")?;
    let task_id = seed_task(ctx, &fixture, project_id, "Margin Task")?;

    // 2h × cost 50 = 100 labor; sell 100 → 200 unbilled revenue after validate
    let ts_id = log_and_validate(ctx, &fixture, project_id, task_id, emp, 2.0, 50.0, 100.0)?;

    let snap = ctx
        .db
        .project_margin_snapshot()
        .margin_by_project()
        .filter(&project_id)
        .find(|s| s.company_id == fixture.company_id)
        .ok_or("margin snapshot missing after validate")?;
    if (snap.labor_cost - 100.0).abs() > 0.01 {
        return Err(format!("expected labor_cost 100, got {}", snap.labor_cost));
    }
    if (snap.unbilled_revenue - 200.0).abs() > 0.01 {
        return Err(format!(
            "expected unbilled_revenue 200, got {}",
            snap.unbilled_revenue
        ));
    }
    if snap.billed_revenue.abs() > 0.01 {
        return Err(format!(
            "expected billed_revenue 0 before bill, got {}",
            snap.billed_revenue
        ));
    }

    let journal_id = seed_sale_journal(ctx, &fixture)?;
    let revenue_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("revenue")?;
    bill_timesheets(
        ctx,
        fixture.organization_id,
        BillTimesheetsParams {
            company_id: Some(fixture.company_id),
            timesheet_ids: vec![ts_id],
            journal_id,
            income_account_id: revenue_id,
            partner_id: fixture.partner_id,
            invoice_date: Some(ctx.timestamp),
            tax_ids: vec![],
            fiscal_position_id: None,
        },
    )?;

    let snap = ctx
        .db
        .project_margin_snapshot()
        .margin_by_project()
        .filter(&project_id)
        .find(|s| s.company_id == fixture.company_id)
        .ok_or("margin snapshot missing after bill")?;
    if (snap.billed_revenue - 200.0).abs() > 0.01 {
        return Err(format!(
            "expected billed_revenue 200, got {}",
            snap.billed_revenue
        ));
    }
    if snap.unbilled_revenue.abs() > 0.01 {
        return Err(format!(
            "expected unbilled 0 after bill, got {}",
            snap.unbilled_revenue
        ));
    }
    // margin = 200 - 100 - 0 = 100 → 50%
    if (snap.margin_amount - 100.0).abs() > 0.01 {
        return Err(format!(
            "expected margin_amount 100, got {}",
            snap.margin_amount
        ));
    }
    if (snap.margin_percent - 50.0).abs() > 0.01 {
        return Err(format!(
            "expected margin_percent 50, got {}",
            snap.margin_percent
        ));
    }

    // Budget line link
    let date_to = ctx.timestamp + Duration::from_secs(86_400);
    create_crossovered_budget(
        ctx,
        fixture.organization_id,
        CreateCrossoveredBudgetParams {
            company_id: Some(fixture.company_id),
            name: format!("Wave D Budget {}", fixture.company_id),
            description: None,
            date_from: ctx.timestamp,
            date_to,
            metadata: None,
        },
    )?;
    let budget_id = ctx
        .db
        .crossovered_budget()
        .iter()
        .find(|b| {
            b.organization_id == fixture.organization_id
                && b.company_id == fixture.company_id
                && b.name.contains("Wave D Budget")
        })
        .map(|b| b.id)
        .ok_or("budget missing")?;
    create_budget_line(
        ctx,
        fixture.organization_id,
        budget_id,
        CreateCrossoveredBudgetLineParams {
            analytic_account_id: None,
            project_id: Some(project_id),
            date_from: ctx.timestamp,
            date_to,
            paid_date: None,
            planned_amount: 500.0,
            practical_amount: 0.0,
            theoretical_amount: 0.0,
            achieve_percentage: 0.0,
            is_above_budget: false,
            variance: 0.0,
            variance_percentage: 0.0,
            metadata: None,
        },
    )?;
    refresh_project_margin_snapshot(ctx, fixture.organization_id, fixture.company_id, project_id);
    let snap = ctx
        .db
        .project_margin_snapshot()
        .margin_by_project()
        .filter(&project_id)
        .find(|s| s.company_id == fixture.company_id)
        .ok_or("margin after budget")?;
    if (snap.budget_planned - 500.0).abs() > 0.01 {
        return Err(format!(
            "expected budget_planned 500, got {}",
            snap.budget_planned
        ));
    }
    let line = ctx
        .db
        .crossovered_budget_lines()
        .iter()
        .find(|l| l.project_id == Some(project_id))
        .ok_or("budget line project_id not set")?;
    if line.company_id != fixture.company_id {
        return Err("budget line company mismatch".into());
    }

    Ok(())
}

/// Company B timesheets must not inflate company A margin snapshot.
pub fn test_margin_company_isolation(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;
    let emp_a = seed_employee(ctx, &fixture_a, "IsoA Emp")?;
    let emp_b = seed_employee(ctx, &fixture_b, "IsoB Emp")?;
    let proj_a = seed_billable_project(ctx, &fixture_a, "IsoA Project")?;
    let proj_b = seed_billable_project(ctx, &fixture_b, "IsoB Project")?;
    let task_a = seed_task(ctx, &fixture_a, proj_a, "IsoA Task")?;
    let task_b = seed_task(ctx, &fixture_b, proj_b, "IsoB Task")?;

    log_and_validate(ctx, &fixture_a, proj_a, task_a, emp_a, 1.0, 10.0, 20.0)?;
    log_and_validate(ctx, &fixture_b, proj_b, task_b, emp_b, 10.0, 10.0, 20.0)?;

    let snap_a = ctx
        .db
        .project_margin_snapshot()
        .margin_by_project()
        .filter(&proj_a)
        .find(|s| s.company_id == fixture_a.company_id)
        .ok_or("snap A missing")?;
    if (snap_a.labor_cost - 10.0).abs() > 0.01 {
        return Err(format!(
            "company A labor_cost leaked: expected 10 got {}",
            snap_a.labor_cost
        ));
    }
    if snap_a.company_id == fixture_b.company_id {
        return Err("snapshot company_id equals B".into());
    }

    let snap_b = ctx
        .db
        .project_margin_snapshot()
        .margin_by_project()
        .filter(&proj_b)
        .find(|s| s.company_id == fixture_b.company_id)
        .ok_or("snap B missing")?;
    if (snap_b.labor_cost - 100.0).abs() > 0.01 {
        return Err(format!(
            "company B labor_cost expected 100 got {}",
            snap_b.labor_cost
        ));
    }
    Ok(())
}

/// Milestone bill creates OutInvoice and updates margin billed_revenue.
pub fn test_milestone_bill_updates_margin(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let project_id = seed_billable_project(ctx, &fixture, "Milestone Bill Project")?;
    create_project_milestone(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateProjectMilestoneParams {
            project_id,
            name: "Phase 1 Fee".into(),
            description: None,
            deadline: None,
            sequence: 1,
            is_reached: false,
            bill_amount: 1000.0,
            percent_complete: 50.0,
            active: true,
            metadata: None,
        },
    )?;
    let milestone_id = ctx
        .db
        .project_milestone()
        .iter()
        .find(|m| m.organization_id == fixture.organization_id && m.name == "Phase 1 Fee")
        .map(|m| m.id)
        .ok_or("milestone missing")?;

    let journal_id = seed_sale_journal(ctx, &fixture)?;
    let revenue_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("revenue")?;
    bill_project_milestone(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        milestone_id,
        BillProjectMilestoneParams {
            amount: None,
            percent_complete: Some(50.0),
            journal_id,
            income_account_id: revenue_id,
            partner_id: Some(fixture.partner_id),
            invoice_date: Some(ctx.timestamp),
            tax_ids: vec![],
            fiscal_position_id: None,
        },
    )?;

    let ms = ctx
        .db
        .project_milestone()
        .id()
        .find(&milestone_id)
        .ok_or("milestone after bill")?;
    if ms.invoice_move_id.is_none() {
        return Err("milestone invoice_move_id not set".into());
    }
    if (ms.billed_amount - 500.0).abs() > 0.01 {
        return Err(format!(
            "expected billed_amount 500, got {}",
            ms.billed_amount
        ));
    }
    let move_id = ms.invoice_move_id.unwrap();
    let mv = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("invoice missing")?;
    if mv.company_id != fixture.company_id {
        return Err("invoice company mismatch".into());
    }

    let snap = ctx
        .db
        .project_margin_snapshot()
        .margin_by_project()
        .filter(&project_id)
        .find(|s| s.company_id == fixture.company_id)
        .ok_or("margin after milestone bill")?;
    if (snap.billed_revenue - 500.0).abs() > 0.01 {
        return Err(format!(
            "expected billed_revenue 500 from milestone, got {}",
            snap.billed_revenue
        ));
    }
    Ok(())
}
