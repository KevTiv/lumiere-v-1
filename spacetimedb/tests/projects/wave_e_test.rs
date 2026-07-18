//! Wave E — change-order dual baselines + project rev-rec isolation from subscriptions.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_journal, create_account_journal, CreateAccountJournalParams,
};
use crate::projects::project_accounting::{
    project_margin_snapshot, project_subcontractor_cost, refresh_project_margin_snapshot,
};
use crate::projects::projects::{create_project, project_project, CreateProjectParams};
use crate::projects::psa_advanced::{
    apply_project_change_order, create_project_change_order, create_project_revenue_line,
    create_project_revenue_schedule, link_subcontractor_cost_to_project, project_baseline,
    project_change_order, project_revenue_line, project_revenue_schedule,
    recognize_project_revenue, refresh_project_earned_value, ApplyProjectChangeOrderParams,
    CreateProjectChangeOrderParams, CreateProjectRevenueLineParams,
    CreateProjectRevenueScheduleParams, LinkSubcontractorCostParams,
    RecognizeProjectRevenueParams, RefreshProjectEarnedValueParams,
};
use crate::projects::tasks::{create_task, project_task, CreateTaskParams};
use crate::subscriptions::tables::{deferred_revenue_line, deferred_revenue_schedule};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{JournalType, TaskState};

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
            date_start: Some(ctx.timestamp),
            date: None,
            date_end: None,
            allow_subtasks: true,
            allow_recurring_tasks: false,
            allow_task_dependencies: false,
            allow_timesheets: true,
            allow_timesheet_timer: true,
            allow_material: false,
            allow_worksheets: false,
            allow_forecast: true,
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
    planned_hours: f64,
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
            planned_hours,
            total_hours_spent: 0.0,
            effective_hours: planned_hours * 0.5,
            progress: 50.0,
            remaining_hours: planned_hours * 0.5,
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

fn seed_misc_journal(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let code = format!("PE{company_id}");
    if let Some(j) = ctx
        .db
        .account_journal()
        .iter()
        .find(|j| j.organization_id == org_id && j.code == code)
    {
        return Ok(j.id);
    }
    let revenue_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("revenue")?;
    create_account_journal(
        ctx,
        org_id,
        CreateAccountJournalParams {
            company_id: Some(company_id),
            name: format!("PSA E Misc {company_id}"),
            code: code.clone(),
            type_: JournalType::General,
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
        .find(|j| j.organization_id == org_id && j.code == code)
        .map(|j| j.id)
        .ok_or_else(|| "misc journal missing".to_string())
}

/// Change order retains original baseline while advancing current baseline.
pub fn test_change_order_dual_baselines(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let project_id = seed_billable_project(ctx, &fixture, "CO Project")?;
    let _task = seed_task(ctx, &fixture, project_id, "CO Task", 100.0)?;

    create_project_change_order(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateProjectChangeOrderParams {
            project_id,
            name: "CO-1 Scope up".to_string(),
            description: Some("Add scope".to_string()),
            scope_delta: Some("+2 deliverables".to_string()),
            budget_delta: 5000.0,
            planned_hours_delta: 40.0,
            rate_delta_percent: 5.0,
            metadata: None,
        },
    )?;

    let co = ctx
        .db
        .project_change_order()
        .change_order_by_project()
        .filter(&project_id)
        .find(|c| c.company_id == fixture.company_id)
        .ok_or("change order missing")?;

    apply_project_change_order(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        co.id,
        ApplyProjectChangeOrderParams { metadata: None },
    )?;

    let baseline = ctx
        .db
        .project_baseline()
        .baseline_by_project()
        .filter(&project_id)
        .find(|b| b.company_id == fixture.company_id)
        .ok_or("project baseline missing after apply")?;

    if (baseline.original_budget - co.baseline_budget).abs() > 0.01 {
        return Err(format!(
            "original baseline budget not retained: {} vs {}",
            baseline.original_budget, co.baseline_budget
        ));
    }
    if (baseline.current_budget - co.revised_budget).abs() > 0.01 {
        return Err(format!(
            "current baseline not revised: {} vs {}",
            baseline.current_budget, co.revised_budget
        ));
    }
    if baseline.current_change_order_id != Some(co.id) {
        return Err("current_change_order_id not set".to_string());
    }

    let applied = ctx
        .db
        .project_change_order()
        .id()
        .find(&co.id)
        .ok_or("co gone")?;
    if applied.state != "applied" {
        return Err(format!("expected applied, got {}", applied.state));
    }

    refresh_project_earned_value(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        RefreshProjectEarnedValueParams {
            project_ids: vec![project_id],
            metadata: None,
        },
    )?;

    Ok(())
}

/// Project rev-rec posts JE via project_revenue_* only — subscription deferred tables untouched.
pub fn test_project_revrec_isolation(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let project_id = seed_billable_project(ctx, &fixture, "RevRec Project")?;
    let journal_id = seed_misc_journal(ctx, &fixture)?;
    // Harness has AR/AP/REVENUE — reuse AP as deferred liability stand-in.
    let deferred_id = *fixture
        .chart_account_ids
        .get(chart_keys::AP)
        .ok_or("AP")?;
    let income_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("revenue")?;

    let sched_count_before = ctx.db.deferred_revenue_schedule().iter().count();
    let line_count_before = ctx.db.deferred_revenue_line().iter().count();

    create_project_revenue_schedule(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateProjectRevenueScheduleParams {
            project_id,
            milestone_id: None,
            name: "POC schedule".to_string(),
            recognition_method: "poc".to_string(),
            total_amount: 10_000.0,
            currency_id: 1,
            journal_id,
            deferred_account_id: deferred_id,
            income_account_id: income_id,
            metadata: None,
        },
    )?;

    let schedule = ctx
        .db
        .project_revenue_schedule()
        .proj_rev_sched_by_project()
        .filter(&project_id)
        .find(|s| s.company_id == fixture.company_id)
        .ok_or("project revenue schedule missing")?;

    create_project_revenue_line(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateProjectRevenueLineParams {
            schedule_id: schedule.id,
            recognition_date: ctx.timestamp,
            amount: 2500.0,
            percent: 25.0,
            milestone_id: None,
            metadata: None,
        },
    )?;

    let line = ctx
        .db
        .project_revenue_line()
        .proj_rev_line_by_schedule()
        .filter(&schedule.id)
        .find(|l| !l.recognized)
        .ok_or("project revenue line missing")?;

    recognize_project_revenue(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        line.id,
        RecognizeProjectRevenueParams {
            reference: Some("PE-TEST".to_string()),
            metadata: None,
        },
    )?;

    let line = ctx
        .db
        .project_revenue_line()
        .id()
        .find(&line.id)
        .ok_or("line after recognize")?;
    if !line.recognized || line.move_id.is_none() {
        return Err("project revenue line not recognized with move".to_string());
    }

    let schedule = ctx
        .db
        .project_revenue_schedule()
        .id()
        .find(&schedule.id)
        .ok_or("schedule after")?;
    if (schedule.recognized_amount - 2500.0).abs() > 0.01 {
        return Err(format!(
            "recognized_amount expected 2500 got {}",
            schedule.recognized_amount
        ));
    }

    let sched_count_after = ctx.db.deferred_revenue_schedule().iter().count();
    let line_count_after = ctx.db.deferred_revenue_line().iter().count();
    if sched_count_after != sched_count_before || line_count_after != line_count_before {
        return Err(format!(
            "subscription deferred_revenue_* mutated: schedules {sched_count_before}->{sched_count_after}, lines {line_count_before}->{line_count_after}"
        ));
    }

    Ok(())
}

/// Subcontractor cost rolls into project_margin_snapshot.subcontractor_cost.
pub fn test_subcontractor_in_margin(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let project_id = seed_billable_project(ctx, &fixture, "Subcon Project")?;

    link_subcontractor_cost_to_project(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        LinkSubcontractorCostParams {
            project_id,
            purchase_order_id: Some(999),
            purchase_order_line_id: None,
            vendor_bill_move_id: None,
            vendor_bill_line_id: None,
            partner_id: Some(fixture.partner_id),
            amount: 750.0,
            currency_id: 1,
            name: Some("Vendor services".to_string()),
            active: true,
            metadata: None,
        },
    )?;

    let _linked = ctx
        .db
        .project_subcontractor_cost()
        .subcon_by_project()
        .filter(&project_id)
        .find(|c| c.company_id == fixture.company_id)
        .ok_or("subcontractor cost row missing")?;

    refresh_project_margin_snapshot(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        project_id,
    );
    let snap = ctx
        .db
        .project_margin_snapshot()
        .margin_by_project()
        .filter(&project_id)
        .find(|s| s.company_id == fixture.company_id)
        .ok_or("margin snapshot missing")?;
    if (snap.subcontractor_cost - 750.0).abs() > 0.01 {
        return Err(format!(
            "expected subcontractor_cost 750, got {}",
            snap.subcontractor_cost
        ));
    }
    Ok(())
}
