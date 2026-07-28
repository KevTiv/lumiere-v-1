//! Wave A projects/PSA lifecycle: isolation, SoD, freeze, bill sell-rate, period lock.
use std::time::Duration;

use spacetimedb::{Identity, ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_journal, create_account_journal, CreateAccountJournalParams,
};
use crate::accounting::fiscal_periods::{
    account_period, close_account_period, create_account_period, CreateAccountPeriodParams,
};
use crate::accounting::journal_entries::{
    account_move, account_move_line, bill_timesheets, BillTimesheetsParams,
};
use crate::hr::employees::{create_employee, hr_employee, CreateEmployeeParams};
use crate::projects::projects::{create_project, project_project, CreateProjectParams};
use crate::projects::tasks::{create_task, project_task, CreateTaskParams};
use crate::projects::timesheets::{
    log_timesheet, project_timesheet, stop_timesheet_timer, validate_timesheets,
    LogTimesheetParams, ValidateTimesheetsParams,
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
    let journal_code = format!("PS{company_id}");
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
            name: format!("PSA Sale {company_id}"),
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
        .ok_or_else(|| "PSA sale journal not found".to_string())
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

fn log_billable_hours(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    project_id: u64,
    task_id: u64,
    employee_id: u64,
    name: &str,
    hours: f64,
    cost: f64,
    sell_rate: f64,
) -> Result<u64, String> {
    log_timesheet(
        ctx,
        fixture.organization_id,
        LogTimesheetParams {
            company_id: Some(fixture.company_id),
            project_id,
            task_id: Some(task_id),
            employee_id,
            name: name.to_string(),
            date: ctx.timestamp,
            unit_amount: hours,
            currency_id: 1,
            employee_cost: Some(cost),
            sell_rate: Some(sell_rate),
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
    ctx.db
        .project_timesheet()
        .iter()
        .find(|t| {
            t.organization_id == fixture.organization_id
                && t.project_id == project_id
                && t.name == name
        })
        .map(|t| t.id)
        .ok_or_else(|| format!("timesheet {name} missing"))
}

/// Rewrite logger to a dummy identity so the test sender can validate (SoD).
fn reassign_logger_to_dummy(ctx: &ReducerContext, timesheet_id: u64) -> Result<(), String> {
    let entry = ctx
        .db
        .project_timesheet()
        .id()
        .find(&timesheet_id)
        .ok_or("timesheet for logger rewrite")?;
    ctx.db
        .project_timesheet()
        .id()
        .update(crate::projects::timesheets::ProjectTimesheet {
            user_id: Identity::__dummy(),
            ..entry
        });
    Ok(())
}

fn validate_as_manager(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    timesheet_id: u64,
) -> Result<(), String> {
    reassign_logger_to_dummy(ctx, timesheet_id)?;
    validate_timesheets(
        ctx,
        fixture.organization_id,
        ValidateTimesheetsParams {
            company_id: Some(fixture.company_id),
            timesheet_ids: vec![timesheet_id],
            wip_journal_id: None,
            wip_account_id: None,
            wip_labor_account_id: None,
        },
    )
}

/// Company B cannot validate company A's timesheet.
pub fn test_company_isolation_on_validate(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;
    let employee_id = seed_employee(ctx, &fixture_a, "Iso Emp")?;
    let project_id = seed_billable_project(ctx, &fixture_a, "Iso Project")?;
    let task_id = seed_task(ctx, &fixture_a, project_id, "Iso Task")?;
    let ts_id = log_billable_hours(
        ctx,
        &fixture_a,
        project_id,
        task_id,
        employee_id,
        "Iso Hours",
        2.0,
        50.0,
        100.0,
    )?;
    reassign_logger_to_dummy(ctx, ts_id)?;

    let err = validate_timesheets(
        ctx,
        fixture_a.organization_id,
        ValidateTimesheetsParams {
            company_id: Some(fixture_b.company_id),
            timesheet_ids: vec![ts_id],
            wip_journal_id: None,
            wip_account_id: None,
            wip_labor_account_id: None,
        },
    );
    if err.is_ok() {
        return Err("validate with foreign company_id should fail".into());
    }
    Ok(())
}

/// Logger cannot self-validate (SoD).
pub fn test_sod_logger_cannot_validate(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let employee_id = seed_employee(ctx, &fixture, "SoD Emp")?;
    let project_id = seed_billable_project(ctx, &fixture, "SoD Project")?;
    let task_id = seed_task(ctx, &fixture, project_id, "SoD Task")?;
    let ts_id = log_billable_hours(
        ctx,
        &fixture,
        project_id,
        task_id,
        employee_id,
        "SoD Hours",
        1.0,
        40.0,
        80.0,
    )?;

    let sod = validate_timesheets(
        ctx,
        fixture.organization_id,
        ValidateTimesheetsParams {
            company_id: Some(fixture.company_id),
            timesheet_ids: vec![ts_id],
            wip_journal_id: None,
            wip_account_id: None,
            wip_labor_account_id: None,
        },
    );
    match sod {
        Ok(()) => Err("self-validate should fail SoD".into()),
        Err(msg) if msg.contains("self-validate") || msg.contains("validator equals logger") => {
            Ok(())
        }
        Err(msg) => Err(format!("unexpected SoD error: {msg}")),
    }
}

/// Validated timesheets reject stop-timer mutations.
pub fn test_freeze_validated_blocks_stop_timer(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let employee_id = seed_employee(ctx, &fixture, "Freeze Emp")?;
    let project_id = seed_billable_project(ctx, &fixture, "Freeze Project")?;
    let task_id = seed_task(ctx, &fixture, project_id, "Freeze Task")?;
    let ts_id = log_billable_hours(
        ctx,
        &fixture,
        project_id,
        task_id,
        employee_id,
        "Freeze Hours",
        3.0,
        60.0,
        120.0,
    )?;
    validate_as_manager(ctx, &fixture, ts_id)?;

    let blocked = stop_timesheet_timer(ctx, fixture.organization_id, ts_id);
    match blocked {
        Ok(()) => Err("stop timer on validated timesheet should fail".into()),
        Err(msg) if msg.contains("validated") || msg.contains("Cannot mutate") => Ok(()),
        Err(msg) => Err(format!("unexpected freeze error: {msg}")),
    }
}

/// Bill uses sell_rate, links invoice id, second bill fails.
pub fn test_bill_uses_sell_rate_and_links_invoice(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let journal_id = seed_sale_journal(ctx, &fixture)?;
    let income_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("missing REVENUE")?;
    let employee_id = seed_employee(ctx, &fixture, "Bill Emp")?;
    let project_id = seed_billable_project(ctx, &fixture, "Bill Project")?;
    let task_id = seed_task(ctx, &fixture, project_id, "Bill Task")?;
    let hours = 2.0;
    let cost = 50.0;
    let sell = 150.0;
    let ts_id = log_billable_hours(
        ctx,
        &fixture,
        project_id,
        task_id,
        employee_id,
        "Bill Hours",
        hours,
        cost,
        sell,
    )?;
    validate_as_manager(ctx, &fixture, ts_id)?;

    bill_timesheets(
        ctx,
        fixture.organization_id,
        BillTimesheetsParams {
            company_id: Some(fixture.company_id),
            timesheet_ids: vec![ts_id],
            journal_id,
            income_account_id: income_id,
            partner_id: fixture.partner_id,
            invoice_date: Some(ctx.timestamp),
            tax_ids: vec![],
            fiscal_position_id: None,
        },
    )?;

    let ts = ctx
        .db
        .project_timesheet()
        .id()
        .find(&ts_id)
        .ok_or("timesheet after bill")?;
    let invoice_id = ts
        .timesheet_invoice_id
        .ok_or("timesheet_invoice_id unset after bill")?;
    let mv = ctx
        .db
        .account_move()
        .id()
        .find(&invoice_id)
        .ok_or("invoice missing")?;
    let expected_untaxed = hours * sell;
    if (mv.amount_untaxed - expected_untaxed).abs() > 0.01 {
        return Err(format!(
            "expected untaxed {expected_untaxed} from sell_rate, got {}",
            mv.amount_untaxed
        ));
    }
    // Line price should reflect sell rate, not employee cost
    let line = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&invoice_id)
        .find(|l| l.price_unit > 0.0)
        .ok_or("invoice product line")?;
    if (line.price_unit - sell).abs() > 0.01 {
        return Err(format!(
            "expected line price_unit {sell} (sell_rate), got {}",
            line.price_unit
        ));
    }

    let second = bill_timesheets(
        ctx,
        fixture.organization_id,
        BillTimesheetsParams {
            company_id: Some(fixture.company_id),
            timesheet_ids: vec![ts_id],
            journal_id,
            income_account_id: income_id,
            partner_id: fixture.partner_id,
            invoice_date: Some(ctx.timestamp),
            tax_ids: vec![],
            fiscal_position_id: None,
        },
    );
    match second {
        Ok(()) => Err("second bill of same timesheet should fail".into()),
        Err(msg) if msg.contains("already invoiced") || msg.contains("already billed") => Ok(()),
        Err(msg) => Err(format!("unexpected second-bill error: {msg}")),
    }
}

/// Closed accounting period rejects bill_timesheets.
pub fn test_period_lock_rejects_bill(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let journal_id = seed_sale_journal(ctx, &fixture)?;
    let income_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("missing REVENUE")?;

    create_account_period(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateAccountPeriodParams {
            name: "PSA Closed".to_string(),
            code: "PSCL".to_string(),
            date_from: ctx.timestamp,
            date_to: ctx.timestamp + Duration::from_secs(86_400),
            fiscal_year_id: fixture.fiscal_year_id,
            is_adjustment: false,
            notes: None,
            metadata: None,
        },
    )?;
    let period_id = ctx
        .db
        .account_period()
        .iter()
        .find(|p| p.company_id == fixture.company_id && p.code == "PSCL")
        .map(|p| p.id)
        .ok_or("period missing")?;
    close_account_period(ctx, fixture.organization_id, fixture.company_id, period_id)?;

    let employee_id = seed_employee(ctx, &fixture, "Lock Emp")?;
    let project_id = seed_billable_project(ctx, &fixture, "Lock Project")?;
    let task_id = seed_task(ctx, &fixture, project_id, "Lock Task")?;
    let ts_id = log_billable_hours(
        ctx,
        &fixture,
        project_id,
        task_id,
        employee_id,
        "Lock Hours",
        1.0,
        40.0,
        90.0,
    )?;
    validate_as_manager(ctx, &fixture, ts_id)?;

    let result = bill_timesheets(
        ctx,
        fixture.organization_id,
        BillTimesheetsParams {
            company_id: Some(fixture.company_id),
            timesheet_ids: vec![ts_id],
            journal_id,
            income_account_id: income_id,
            partner_id: fixture.partner_id,
            invoice_date: Some(ctx.timestamp),
            tax_ids: vec![],
            fiscal_position_id: None,
        },
    );
    match result {
        Ok(()) => Err("bill in closed period should fail".into()),
        Err(msg)
            if msg.to_lowercase().contains("closed") || msg.to_lowercase().contains("period") =>
        {
            Ok(())
        }
        Err(msg) => Err(format!("unexpected period-lock error: {msg}")),
    }
}
