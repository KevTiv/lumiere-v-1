//! Wave E — capacity forecast, change orders, EVM, subcontractors, project rev-rec, intents.
//!
//! # Architecture
//! Project POC/milestone revenue recognition owns **separate** schedule/line tables keyed by
//! `project_id` / milestone. JE posting mirrors subscription rev-rec helpers but **never**
//! writes `deferred_revenue_schedule` / `deferred_revenue_line`.
//!
//! # Tables
//! | Table | Description |
//! |-------|-------------|
//! | **CapacityForecastSnapshot** | Forward allocations vs available / pipeline hours |
//! | **ProjectBaseline** | Dual baselines (original + current) per project |
//! | **ProjectChangeOrder** | Scope/budget/rate deltas with audit |
//! | **ProjectEarnedValueSnapshot** | PV/EV/AC, SPI/CPI |
//! | **ProjectSubcontractorCost** | Vendor PO/bill lines linked to project |
//! | **ProjectRevenueSchedule** / **ProjectRevenueLine** | Project-owned rev-rec |
//! | **ProjectIntegrationIntent** | Payroll / calendar / e-invoice durable intents |

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::fiscal_periods::ensure_accounting_period_open_for_date;
use crate::accounting::journal_entries::{
    account_move, account_move_line, AccountMove, AccountMoveLine,
};
use crate::core::organization::company_id_from_scope;
use crate::helpers::{check_permission, next_doc_number, write_audit_log_v2, AuditLogParams};
use crate::projects::capacity::{resource_allocation, resource_capacity_snapshot};
use crate::projects::milestones::project_milestone;
use crate::projects::project_accounting::{
    project_margin_snapshot, project_subcontractor_cost, refresh_project_margin_snapshot,
    ProjectSubcontractorCost,
};
use crate::projects::projects::project_project;
use crate::projects::tasks::project_task;
use crate::projects::timesheets::project_timesheet;
use crate::purchasing::purchase_orders::{purchase_order, purchase_order_line};
use crate::types::{AccountMoveState, PaymentState};

// ── Tables ───────────────────────────────────────────────────────────────────

/// Forward capacity: available vs allocated vs soft pipeline hours.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = capacity_forecast_snapshot,
    public,
    index(accessor = forecast_by_org, btree(columns = [organization_id])),
    index(accessor = forecast_by_company, btree(columns = [company_id])),
    index(accessor = forecast_by_employee, btree(columns = [employee_id]))
)]
pub struct CapacityForecastSnapshot {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub employee_id: Option<u64>,
    pub period_start: Timestamp,
    pub period_end: Timestamp,
    pub available_hours: f64,
    /// Confirmed future allocations (date_from >= now).
    pub allocated_hours: f64,
    /// Soft pipeline hours (allocations with metadata `"pipeline":true` or inactive projects).
    pub pipeline_hours: f64,
    /// available − allocated − pipeline
    pub forecast_remaining_hours: f64,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Dual baselines retained across change orders.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = project_baseline,
    public,
    index(accessor = baseline_by_org, btree(columns = [organization_id])),
    index(accessor = baseline_by_company, btree(columns = [company_id])),
    index(accessor = baseline_by_project, btree(columns = [project_id]))
)]
pub struct ProjectBaseline {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub project_id: u64,
    pub original_budget: f64,
    pub original_planned_hours: f64,
    pub original_captured_at: Timestamp,
    pub current_budget: f64,
    pub current_planned_hours: f64,
    pub current_change_order_id: Option<u64>,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = project_change_order,
    public,
    index(accessor = change_order_by_org, btree(columns = [organization_id])),
    index(accessor = change_order_by_company, btree(columns = [company_id])),
    index(accessor = change_order_by_project, btree(columns = [project_id]))
)]
pub struct ProjectChangeOrder {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub project_id: u64,
    pub name: String,
    pub description: Option<String>,
    pub scope_delta: Option<String>,
    pub budget_delta: f64,
    pub planned_hours_delta: f64,
    pub rate_delta_percent: f64,
    /// Snapshot of baselines at create (pre-apply).
    pub baseline_budget: f64,
    pub baseline_planned_hours: f64,
    pub revised_budget: f64,
    pub revised_planned_hours: f64,
    /// draft | approved | applied | cancelled
    pub state: String,
    pub applied_at: Option<Timestamp>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = project_earned_value_snapshot,
    public,
    index(accessor = evm_by_org, btree(columns = [organization_id])),
    index(accessor = evm_by_company, btree(columns = [company_id])),
    index(accessor = evm_by_project, btree(columns = [project_id]))
)]
pub struct ProjectEarnedValueSnapshot {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub project_id: u64,
    /// Planned value from current baseline × time/planned progress.
    pub planned_value: f64,
    /// Earned value from baseline × validated % complete.
    pub earned_value: f64,
    /// Actual cost: labor + expense + subcontractor.
    pub actual_cost: f64,
    pub schedule_performance_index: f64,
    pub cost_performance_index: f64,
    pub percent_complete: f64,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Project-owned revenue recognition schedule (NOT subscription deferred_revenue_*).
#[derive(Clone)]
#[spacetimedb::table(
    accessor = project_revenue_schedule,
    public,
    index(accessor = proj_rev_sched_by_org, btree(columns = [organization_id])),
    index(accessor = proj_rev_sched_by_company, btree(columns = [company_id])),
    index(accessor = proj_rev_sched_by_project, btree(columns = [project_id]))
)]
pub struct ProjectRevenueSchedule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub project_id: u64,
    pub milestone_id: Option<u64>,
    pub name: String,
    /// poc | milestone
    pub recognition_method: String,
    pub total_amount: f64,
    pub recognized_amount: f64,
    pub deferred_amount: f64,
    pub currency_id: u64,
    pub journal_id: u64,
    /// Liability (deferred) account.
    pub deferred_account_id: u64,
    /// Income account when recognized.
    pub income_account_id: u64,
    /// draft | open | finished | cancelled
    pub state: String,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = project_revenue_line,
    public,
    index(accessor = proj_rev_line_by_org, btree(columns = [organization_id])),
    index(accessor = proj_rev_line_by_schedule, btree(columns = [schedule_id])),
    index(accessor = proj_rev_line_by_project, btree(columns = [project_id]))
)]
pub struct ProjectRevenueLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub schedule_id: u64,
    pub project_id: u64,
    pub milestone_id: Option<u64>,
    pub recognition_date: Timestamp,
    pub amount: f64,
    pub percent: f64,
    pub recognized: bool,
    pub move_id: Option<u64>,
    pub move_line_id: Option<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Durable integration intent — payroll export / calendar sync / e-invoice (no HTTP in reducer).
#[derive(Clone)]
#[spacetimedb::table(
    accessor = project_integration_intent,
    public,
    index(accessor = proj_intent_by_org, btree(columns = [organization_id])),
    index(accessor = proj_intent_by_company, btree(columns = [company_id])),
    index(accessor = proj_intent_by_status, btree(columns = [status])),
    index(accessor = proj_intent_by_key, btree(columns = [idempotency_key]))
)]
pub struct ProjectIntegrationIntent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub project_id: Option<u64>,
    /// payroll_export | calendar_sync | e_invoice
    pub intent_type: String,
    pub status: String,
    pub idempotency_key: String,
    pub payload: String,
    pub result_ref: Option<String>,
    pub last_error: Option<String>,
    pub attempt_count: u32,
    pub applied_at: Option<Timestamp>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct RefreshCapacityForecastParams {
    pub employee_id: Option<u64>,
    pub period_start: Option<Timestamp>,
    pub period_end: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateProjectChangeOrderParams {
    pub project_id: u64,
    pub name: String,
    pub description: Option<String>,
    pub scope_delta: Option<String>,
    pub budget_delta: f64,
    pub planned_hours_delta: f64,
    pub rate_delta_percent: f64,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ApplyProjectChangeOrderParams {
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RefreshProjectEarnedValueParams {
    pub project_ids: Vec<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct LinkSubcontractorCostParams {
    pub project_id: u64,
    pub purchase_order_id: Option<u64>,
    pub purchase_order_line_id: Option<u64>,
    pub vendor_bill_move_id: Option<u64>,
    pub vendor_bill_line_id: Option<u64>,
    pub partner_id: Option<u64>,
    pub amount: f64,
    pub currency_id: u64,
    pub name: Option<String>,
    pub active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateProjectRevenueScheduleParams {
    pub project_id: u64,
    pub milestone_id: Option<u64>,
    pub name: String,
    pub recognition_method: String,
    pub total_amount: f64,
    pub currency_id: u64,
    pub journal_id: u64,
    pub deferred_account_id: u64,
    pub income_account_id: u64,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateProjectRevenueLineParams {
    pub schedule_id: u64,
    pub recognition_date: Timestamp,
    pub amount: f64,
    pub percent: f64,
    pub milestone_id: Option<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecognizeProjectRevenueParams {
    pub reference: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateProjectIntegrationIntentParams {
    pub company_id: Option<u64>,
    pub project_id: Option<u64>,
    pub intent_type: String,
    pub idempotency_key: String,
    pub payload: String,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct FailProjectIntegrationIntentParams {
    pub last_error: String,
    pub metadata: Option<String>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn project_planned_hours(ctx: &ReducerContext, project_id: u64) -> f64 {
    ctx.db
        .project_task()
        .iter()
        .filter(|t| t.project_id == Some(project_id))
        .map(|t| t.planned_hours)
        .sum()
}

fn project_budget_planned(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    project_id: u64,
) -> f64 {
    ctx.db
        .project_margin_snapshot()
        .margin_by_project()
        .filter(&project_id)
        .filter(|s| s.organization_id == organization_id && s.company_id == company_id)
        .map(|s| s.budget_planned)
        .next()
        .unwrap_or(0.0)
}

fn allocation_is_pipeline(alloc: &crate::projects::capacity::ResourceAllocation) -> bool {
    alloc
        .metadata
        .as_deref()
        .map(|m| m.contains("\"pipeline\":true") || m.contains("\"pipeline\": true"))
        .unwrap_or(false)
}

/// Sum active subcontractor costs for a project.
pub fn subcontractor_cost_for_project(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    project_id: u64,
) -> f64 {
    ctx.db
        .project_subcontractor_cost()
        .subcon_by_project()
        .filter(&project_id)
        .filter(|c| c.organization_id == organization_id && c.company_id == company_id && c.active)
        .map(|c| c.amount)
        .sum()
}

fn validated_progress_percent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    project_id: u64,
) -> f64 {
    let mut planned = 0.0f64;
    let mut done = 0.0f64;
    for t in ctx.db.project_task().iter().filter(|t| {
        t.project_id == Some(project_id)
            && t.organization_id == organization_id
            && t.company_id == company_id
    }) {
        planned += t.planned_hours.max(0.0);
        done += t.effective_hours.max(0.0);
    }
    if planned > f64::EPSILON {
        return ((done / planned) * 100.0).clamp(0.0, 100.0);
    }
    // Fall back to average milestone percent_complete
    let milestones: Vec<_> = ctx
        .db
        .project_milestone()
        .milestone_by_project()
        .filter(&project_id)
        .filter(|m| m.organization_id == organization_id && m.company_id == company_id && m.active)
        .collect();
    if milestones.is_empty() {
        return 0.0;
    }
    let avg: f64 =
        milestones.iter().map(|m| m.percent_complete).sum::<f64>() / milestones.len() as f64;
    avg.clamp(0.0, 100.0)
}

fn post_project_revrec_je(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    schedule: &ProjectRevenueSchedule,
    line: &ProjectRevenueLine,
    reference: Option<String>,
    metadata: Option<String>,
) -> Result<(u64, u64), String> {
    ensure_accounting_period_open_for_date(ctx, company_id, line.recognition_date)?;
    let amount = line.amount;
    if amount <= 0.0 {
        return Err("Recognition amount must be positive".to_string());
    }
    let name = next_doc_number(ctx, "PREVREC");
    let currency_id = schedule.currency_id;

    let move_record = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: name.clone(),
        ref_: reference.clone(),
        move_type: crate::types::MoveType::Entry,
        auto_post: false,
        state: AccountMoveState::Posted,
        date: line.recognition_date,
        invoice_date: None,
        invoice_date_due: None,
        invoice_payment_term_id: None,
        invoice_origin: Some(format!("Project rev-rec P{}", schedule.project_id)),
        invoice_partner_display_name: None,
        invoice_cash_rounding_id: None,
        payment_reference: reference.clone(),
        partner_shipping_id: None,
        sale_order_id: None,
        partner_id: None,
        commercial_partner_id: None,
        partner_bank_id: None,
        fiscal_position_id: None,
        invoice_user_id: None,
        invoice_incoterm_id: None,
        incoterm_location: None,
        campaign_id: None,
        source_id: None,
        medium_id: None,
        company_id,
        journal_id: schedule.journal_id,
        currency_id,
        company_currency_id: currency_id,
        amount_untaxed: amount,
        amount_tax: 0.0,
        amount_total: amount,
        amount_residual: 0.0,
        amount_untaxed_signed: amount,
        amount_tax_signed: 0.0,
        amount_total_signed: amount,
        amount_total_in_currency_signed: amount,
        amount_residual_signed: 0.0,
        to_check: false,
        posted_before: true,
        is_storno: false,
        is_move_sent: false,
        secure_sequence_number: None,
        invoice_has_outstanding: false,
        payment_state: PaymentState::NotPaid,
        restrict_mode_hash_table: false,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: metadata.clone(),
    });

    let insert_line = |account_id: u64, line_name: &str, debit: f64, credit: f64, sequence: u32| {
        ctx.db.account_move_line().insert(AccountMoveLine {
            id: 0,
            organization_id,
            move_id: move_record.id,
            move_name: Some(name.clone()),
            date: line.recognition_date,
            ref_: reference.clone(),
            parent_state: AccountMoveState::Posted,
            journal_id: schedule.journal_id,
            company_id,
            company_currency_id: currency_id,
            sequence,
            name: line_name.to_string(),
            quantity: 0.0,
            price_unit: 0.0,
            price: 0.0,
            price_subtotal: 0.0,
            price_total: 0.0,
            discount: 0.0,
            balance: debit - credit,
            currency_id,
            amount_currency: 0.0,
            amount_residual: 0.0,
            amount_residual_currency: 0.0,
            debit,
            credit,
            debit_currency: 0.0,
            credit_currency: 0.0,
            tax_base_amount: 0.0,
            account_id,
            account_internal_type: None,
            account_internal_group: None,
            account_root_id: None,
            group_tax_id: None,
            tax_line_id: None,
            tax_group_id: None,
            tax_ids: vec![],
            tax_repartition_line_id: None,
            tax_audit: None,
            partner_id: None,
            commercial_partner_id: None,
            reconcile_model_id: None,
            payment_id: None,
            statement_line_id: None,
            currency_id_field: None,
            blocked: false,
            matching_number: None,
            matching_label: None,
            is_matching: false,
            expected_pay_date: None,
            expected_pay_date_currency_id: None,
            expected_pay_date_amount: 0.0,
            expected_pay_date_residual: 0.0,
            display_type: None,
            is_downpayment: false,
            exclude_from_invoice_tab: false,
            analytic_account_id: None,
            analytic_tag_ids: vec![],
            product_id: None,
            product_uom_id: None,
            product_category_id: None,
            cogs_amount: 0.0,
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: metadata.clone(),
        })
    };

    let liability_line = insert_line(
        schedule.deferred_account_id,
        "Project deferred revenue recognition",
        amount,
        0.0,
        1,
    );
    insert_line(
        schedule.income_account_id,
        "Project recognized revenue",
        0.0,
        amount,
        2,
    );

    Ok((move_record.id, liability_line.id))
}

// ── Forecast ─────────────────────────────────────────────────────────────────

pub fn refresh_capacity_forecast_for_employee(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
    period_start: Timestamp,
    period_end: Timestamp,
) {
    let available_hours = ctx
        .db
        .resource_capacity_snapshot()
        .capacity_by_company()
        .filter(&company_id)
        .filter(|s| s.organization_id == organization_id && s.employee_id == Some(employee_id))
        .map(|s| s.available_hours)
        .next()
        .unwrap_or(0.0);

    let mut allocated_hours = 0.0f64;
    let mut pipeline_hours = 0.0f64;
    for alloc in ctx
        .db
        .resource_allocation()
        .allocation_by_company()
        .filter(&company_id)
    {
        if alloc.organization_id != organization_id || alloc.employee_id != Some(employee_id) {
            continue;
        }
        if !alloc.active {
            continue;
        }
        // Forward window: overlaps [period_start, period_end]
        if alloc.date_to < period_start || alloc.date_from > period_end {
            continue;
        }
        let hours = if alloc.allocated_hours > 0.0 {
            alloc.allocated_hours
        } else {
            0.0
        };
        if allocation_is_pipeline(&alloc) {
            pipeline_hours += hours;
        } else {
            allocated_hours += hours;
        }
    }

    let forecast_remaining_hours = available_hours - allocated_hours - pipeline_hours;

    let existing: Vec<u64> = ctx
        .db
        .capacity_forecast_snapshot()
        .forecast_by_company()
        .filter(&company_id)
        .filter(|s| s.organization_id == organization_id && s.employee_id == Some(employee_id))
        .map(|s| s.id)
        .collect();
    for id in existing {
        ctx.db.capacity_forecast_snapshot().id().delete(&id);
    }

    ctx.db
        .capacity_forecast_snapshot()
        .insert(CapacityForecastSnapshot {
            id: 0,
            organization_id,
            company_id,
            employee_id: Some(employee_id),
            period_start,
            period_end,
            available_hours,
            allocated_hours,
            pipeline_hours,
            forecast_remaining_hours,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: Some(
                serde_json::json!({
                    "formula": "available - allocated - pipeline",
                })
                .to_string(),
            ),
        });
}

#[reducer]
pub fn refresh_capacity_forecast(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: RefreshCapacityForecastParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "capacity_forecast_snapshot", "write")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

    let period_start = params.period_start.unwrap_or_else(|| {
        Timestamp::from_micros_since_unix_epoch(ctx.timestamp.to_micros_since_unix_epoch())
    });
    let period_end = params.period_end.unwrap_or_else(|| {
        Timestamp::from_micros_since_unix_epoch(
            ctx.timestamp
                .to_micros_since_unix_epoch()
                .saturating_add(90 * 86_400_000_000),
        )
    });

    let employee_ids: Vec<u64> = if let Some(eid) = params.employee_id {
        vec![eid]
    } else {
        let mut set = std::collections::BTreeSet::new();
        for s in ctx
            .db
            .resource_capacity_snapshot()
            .capacity_by_company()
            .filter(&company_id)
            .filter(|s| s.organization_id == organization_id)
        {
            if let Some(eid) = s.employee_id {
                set.insert(eid);
            }
        }
        for a in ctx
            .db
            .resource_allocation()
            .allocation_by_company()
            .filter(&company_id)
            .filter(|a| a.organization_id == organization_id)
        {
            if let Some(eid) = a.employee_id {
                set.insert(eid);
            }
        }
        set.into_iter().collect()
    };

    for eid in &employee_ids {
        refresh_capacity_forecast_for_employee(
            ctx,
            organization_id,
            company_id,
            *eid,
            period_start,
            period_end,
        );
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "capacity_forecast_snapshot",
            record_id: employee_ids.first().copied().unwrap_or(0),
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "employee_count": employee_ids.len(),
                    "period_start": format!("{:?}", period_start),
                    "period_end": format!("{:?}", period_end),
                })
                .to_string(),
            ),
            changed_fields: vec![
                "available_hours".to_string(),
                "allocated_hours".to_string(),
                "pipeline_hours".to_string(),
                "forecast_remaining_hours".to_string(),
            ],
            metadata: params.metadata,
        },
    );
    Ok(())
}

// ── Change orders ────────────────────────────────────────────────────────────

#[reducer]
pub fn create_project_change_order(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateProjectChangeOrderParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_change_order", "create")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

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
        return Err("Record does not belong to this company".to_string());
    }
    if params.name.trim().is_empty() {
        return Err("Change order name is required".to_string());
    }

    // Ensure margin (and thus budget_planned) is fresh enough for baseline snapshot.
    refresh_project_margin_snapshot(ctx, organization_id, company_id, params.project_id);

    let baseline_budget = if let Some(b) = ctx
        .db
        .project_baseline()
        .baseline_by_project()
        .filter(&params.project_id)
        .find(|b| b.organization_id == organization_id && b.company_id == company_id)
    {
        b.current_budget
    } else {
        project_budget_planned(ctx, organization_id, company_id, params.project_id)
    };
    let baseline_planned_hours = if let Some(b) = ctx
        .db
        .project_baseline()
        .baseline_by_project()
        .filter(&params.project_id)
        .find(|b| b.organization_id == organization_id && b.company_id == company_id)
    {
        b.current_planned_hours
    } else {
        project_planned_hours(ctx, params.project_id)
    };

    let revised_budget = baseline_budget + params.budget_delta;
    let revised_planned_hours = (baseline_planned_hours + params.planned_hours_delta).max(0.0);

    let row = ctx.db.project_change_order().insert(ProjectChangeOrder {
        id: 0,
        organization_id,
        company_id,
        project_id: params.project_id,
        name: params.name,
        description: params.description,
        scope_delta: params.scope_delta,
        budget_delta: params.budget_delta,
        planned_hours_delta: params.planned_hours_delta,
        rate_delta_percent: params.rate_delta_percent,
        baseline_budget,
        baseline_planned_hours,
        revised_budget,
        revised_planned_hours,
        state: "draft".to_string(),
        applied_at: None,
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
            table_name: "project_change_order",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": row.name,
                    "project_id": row.project_id,
                    "budget_delta": row.budget_delta,
                    "planned_hours_delta": row.planned_hours_delta,
                    "baseline_budget": row.baseline_budget,
                    "revised_budget": row.revised_budget,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "name".to_string(),
                "budget_delta".to_string(),
                "planned_hours_delta".to_string(),
                "rate_delta_percent".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn apply_project_change_order(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    change_order_id: u64,
    params: ApplyProjectChangeOrderParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_change_order", "write")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

    let co = ctx
        .db
        .project_change_order()
        .id()
        .find(&change_order_id)
        .ok_or("Change order not found")?;
    if co.organization_id != organization_id {
        return Err("Change order does not belong to this organization".to_string());
    }
    if co.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if co.state == "applied" {
        return Err("Change order already applied".to_string());
    }
    if co.state == "cancelled" {
        return Err("Change order is cancelled".to_string());
    }

    let old_values = serde_json::json!({
        "state": co.state,
        "baseline_budget": co.baseline_budget,
        "revised_budget": co.revised_budget,
    })
    .to_string();

    // Dual baseline: capture original once; always advance current.
    let existing_baseline = ctx
        .db
        .project_baseline()
        .baseline_by_project()
        .filter(&co.project_id)
        .find(|b| b.organization_id == organization_id && b.company_id == company_id);

    if let Some(b) = existing_baseline {
        ctx.db.project_baseline().id().update(ProjectBaseline {
            current_budget: co.revised_budget,
            current_planned_hours: co.revised_planned_hours,
            current_change_order_id: Some(co.id),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..b
        });
    } else {
        ctx.db.project_baseline().insert(ProjectBaseline {
            id: 0,
            organization_id,
            company_id,
            project_id: co.project_id,
            original_budget: co.baseline_budget,
            original_planned_hours: co.baseline_planned_hours,
            original_captured_at: ctx.timestamp,
            current_budget: co.revised_budget,
            current_planned_hours: co.revised_planned_hours,
            current_change_order_id: Some(co.id),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: None,
        });
    }

    // Distribute planned_hours_delta across root tasks (or store on a synthetic task note via metadata).
    if co.planned_hours_delta.abs() > f64::EPSILON {
        let mut tasks: Vec<_> = ctx
            .db
            .project_task()
            .iter()
            .filter(|t| {
                t.project_id == Some(co.project_id)
                    && t.organization_id == organization_id
                    && t.company_id == company_id
                    && t.parent_id.is_none()
            })
            .collect();
        if tasks.is_empty() {
            tasks = ctx
                .db
                .project_task()
                .iter()
                .filter(|t| {
                    t.project_id == Some(co.project_id)
                        && t.organization_id == organization_id
                        && t.company_id == company_id
                })
                .collect();
        }
        if let Some(mut task) = tasks.into_iter().next() {
            let new_planned = (task.planned_hours + co.planned_hours_delta).max(0.0);
            task.planned_hours = new_planned;
            task.remaining_hours = (new_planned - task.effective_hours).max(0.0);
            task.write_uid = ctx.sender();
            task.write_date = ctx.timestamp;
            ctx.db.project_task().id().update(task);
        }
    }

    ctx.db
        .project_change_order()
        .id()
        .update(ProjectChangeOrder {
            state: "applied".to_string(),
            applied_at: Some(ctx.timestamp),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: params.metadata.clone().or(co.metadata.clone()),
            ..co.clone()
        });

    refresh_project_margin_snapshot(ctx, organization_id, company_id, co.project_id);
    refresh_project_earned_value_snapshot(ctx, organization_id, company_id, co.project_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "project_change_order",
            record_id: change_order_id,
            action: "UPDATE",
            old_values: Some(old_values),
            new_values: Some(
                serde_json::json!({
                    "state": "applied",
                    "revised_budget": co.revised_budget,
                    "revised_planned_hours": co.revised_planned_hours,
                    "rate_delta_percent": co.rate_delta_percent,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "state".to_string(),
                "applied_at".to_string(),
                "current_budget".to_string(),
                "current_planned_hours".to_string(),
            ],
            metadata: params.metadata,
        },
    );
    Ok(())
}

// ── EVM ──────────────────────────────────────────────────────────────────────

pub fn refresh_project_earned_value_snapshot(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    project_id: u64,
) {
    let Some(project) = ctx.db.project_project().id().find(&project_id) else {
        return;
    };
    if project.organization_id != organization_id || project.company_id != company_id {
        return;
    }

    let baseline_budget = ctx
        .db
        .project_baseline()
        .baseline_by_project()
        .filter(&project_id)
        .find(|b| b.organization_id == organization_id && b.company_id == company_id)
        .map(|b| b.current_budget)
        .unwrap_or_else(|| project_budget_planned(ctx, organization_id, company_id, project_id));

    let percent_complete = validated_progress_percent(ctx, organization_id, company_id, project_id);

    // Time-phased PV proxy: if project has date range, use elapsed fraction; else proportion of planned hours done schedule (same as EV for MVP when no dates).
    let schedule_percent = {
        match (project.date_start, project.date_end.or(project.date)) {
            (Some(start), Some(end)) => {
                let start_m = start.to_micros_since_unix_epoch();
                let end_m = end.to_micros_since_unix_epoch();
                let now_m = ctx.timestamp.to_micros_since_unix_epoch();
                if end_m > start_m {
                    (((now_m - start_m) as f64) / ((end_m - start_m) as f64) * 100.0)
                        .clamp(0.0, 100.0)
                } else {
                    percent_complete
                }
            }
            _ => percent_complete,
        }
    };

    let planned_value = baseline_budget * (schedule_percent / 100.0);
    let earned_value = baseline_budget * (percent_complete / 100.0);

    let margin = ctx
        .db
        .project_margin_snapshot()
        .margin_by_project()
        .filter(&project_id)
        .find(|s| s.organization_id == organization_id && s.company_id == company_id);
    let labor = margin.as_ref().map(|m| m.labor_cost).unwrap_or(0.0);
    let expense = margin.as_ref().map(|m| m.expense_cost).unwrap_or(0.0);
    let subcon = margin
        .as_ref()
        .map(|m| m.subcontractor_cost)
        .unwrap_or_else(|| {
            subcontractor_cost_for_project(ctx, organization_id, company_id, project_id)
        });
    let actual_cost = labor + expense + subcon;

    let spi = if planned_value.abs() > f64::EPSILON {
        earned_value / planned_value
    } else {
        0.0
    };
    let cpi = if actual_cost.abs() > f64::EPSILON {
        earned_value / actual_cost
    } else {
        0.0
    };

    let existing: Vec<u64> = ctx
        .db
        .project_earned_value_snapshot()
        .evm_by_project()
        .filter(&project_id)
        .filter(|s| s.organization_id == organization_id && s.company_id == company_id)
        .map(|s| s.id)
        .collect();
    for id in existing {
        ctx.db.project_earned_value_snapshot().id().delete(&id);
    }

    ctx.db
        .project_earned_value_snapshot()
        .insert(ProjectEarnedValueSnapshot {
            id: 0,
            organization_id,
            company_id,
            project_id,
            planned_value,
            earned_value,
            actual_cost,
            schedule_performance_index: spi,
            cost_performance_index: cpi,
            percent_complete,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: Some(
                serde_json::json!({
                    "baseline_budget": baseline_budget,
                    "schedule_percent": schedule_percent,
                })
                .to_string(),
            ),
        });
}

#[reducer]
pub fn refresh_project_earned_value(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: RefreshProjectEarnedValueParams,
) -> Result<(), String> {
    check_permission(
        ctx,
        organization_id,
        "project_earned_value_snapshot",
        "write",
    )?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

    let project_ids: Vec<u64> = if params.project_ids.is_empty() {
        ctx.db
            .project_project()
            .project_by_company()
            .filter(&company_id)
            .filter(|p| p.organization_id == organization_id)
            .map(|p| p.id)
            .collect()
    } else {
        params.project_ids
    };

    for pid in &project_ids {
        refresh_project_margin_snapshot(ctx, organization_id, company_id, *pid);
        refresh_project_earned_value_snapshot(ctx, organization_id, company_id, *pid);
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "project_earned_value_snapshot",
            record_id: project_ids.first().copied().unwrap_or(0),
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "project_count": project_ids.len() }).to_string()),
            changed_fields: vec![
                "planned_value".to_string(),
                "earned_value".to_string(),
                "actual_cost".to_string(),
                "schedule_performance_index".to_string(),
                "cost_performance_index".to_string(),
            ],
            metadata: params.metadata,
        },
    );
    Ok(())
}

// ── Subcontractors ───────────────────────────────────────────────────────────

#[reducer]
pub fn link_subcontractor_cost_to_project(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: LinkSubcontractorCostParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_subcontractor_cost", "create")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

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
        return Err("Record does not belong to this company".to_string());
    }
    if params.amount < 0.0 {
        return Err("Subcontractor amount cannot be negative".to_string());
    }
    if params.purchase_order_line_id.is_none()
        && params.vendor_bill_line_id.is_none()
        && params.purchase_order_id.is_none()
        && params.vendor_bill_move_id.is_none()
    {
        return Err("Link at least one PO or vendor bill reference".to_string());
    }

    if let Some(line_id) = params.purchase_order_line_id {
        let line = ctx
            .db
            .purchase_order_line()
            .id()
            .find(&line_id)
            .ok_or("Purchase order line not found")?;
        if line.organization_id != organization_id || line.company_id != company_id {
            return Err("PO line does not belong to this company".to_string());
        }
        if let Some(po_id) = params.purchase_order_id {
            if line.order_id != po_id {
                return Err("PO line does not belong to the given purchase order".to_string());
            }
        }
        let _ = ctx.db.purchase_order().id().find(&line.order_id);
    }

    let row = ctx
        .db
        .project_subcontractor_cost()
        .insert(ProjectSubcontractorCost {
            id: 0,
            organization_id,
            company_id,
            project_id: params.project_id,
            purchase_order_id: params.purchase_order_id,
            purchase_order_line_id: params.purchase_order_line_id,
            vendor_bill_move_id: params.vendor_bill_move_id,
            vendor_bill_line_id: params.vendor_bill_line_id,
            partner_id: params.partner_id,
            amount: params.amount,
            currency_id: params.currency_id,
            name: params.name,
            active: params.active,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: params.metadata,
        });

    refresh_project_margin_snapshot(ctx, organization_id, company_id, params.project_id);
    refresh_project_earned_value_snapshot(ctx, organization_id, company_id, params.project_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "project_subcontractor_cost",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "project_id": row.project_id,
                    "amount": row.amount,
                    "purchase_order_line_id": row.purchase_order_line_id,
                    "vendor_bill_line_id": row.vendor_bill_line_id,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "project_id".to_string(),
                "amount".to_string(),
                "purchase_order_line_id".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

// ── Project rev-rec ──────────────────────────────────────────────────────────

#[reducer]
pub fn create_project_revenue_schedule(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateProjectRevenueScheduleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_revenue_schedule", "create")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

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
        return Err("Record does not belong to this company".to_string());
    }
    let method = params.recognition_method.to_lowercase();
    if method != "poc" && method != "milestone" {
        return Err("recognition_method must be poc or milestone".to_string());
    }
    if params.total_amount <= 0.0 {
        return Err("total_amount must be positive".to_string());
    }
    if let Some(mid) = params.milestone_id {
        let ms = ctx
            .db
            .project_milestone()
            .id()
            .find(&mid)
            .ok_or("Milestone not found")?;
        if ms.project_id != params.project_id || ms.company_id != company_id {
            return Err("Milestone does not belong to this project/company".to_string());
        }
    }

    let row = ctx
        .db
        .project_revenue_schedule()
        .insert(ProjectRevenueSchedule {
            id: 0,
            organization_id,
            company_id,
            project_id: params.project_id,
            milestone_id: params.milestone_id,
            name: params.name,
            recognition_method: method,
            total_amount: params.total_amount,
            recognized_amount: 0.0,
            deferred_amount: params.total_amount,
            currency_id: params.currency_id,
            journal_id: params.journal_id,
            deferred_account_id: params.deferred_account_id,
            income_account_id: params.income_account_id,
            state: "open".to_string(),
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
            table_name: "project_revenue_schedule",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "project_id": row.project_id,
                    "total_amount": row.total_amount,
                    "recognition_method": row.recognition_method,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "name".to_string(),
                "total_amount".to_string(),
                "recognition_method".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn create_project_revenue_line(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateProjectRevenueLineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_revenue_line", "create")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

    let schedule = ctx
        .db
        .project_revenue_schedule()
        .id()
        .find(&params.schedule_id)
        .ok_or("Schedule not found")?;
    if schedule.organization_id != organization_id {
        return Err("Schedule does not belong to this organization".to_string());
    }
    if schedule.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if params.amount <= 0.0 {
        return Err("Line amount must be positive".to_string());
    }

    let row = ctx.db.project_revenue_line().insert(ProjectRevenueLine {
        id: 0,
        organization_id,
        company_id,
        schedule_id: params.schedule_id,
        project_id: schedule.project_id,
        milestone_id: params.milestone_id.or(schedule.milestone_id),
        recognition_date: params.recognition_date,
        amount: params.amount,
        percent: params.percent,
        recognized: false,
        move_id: None,
        move_line_id: None,
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
            table_name: "project_revenue_line",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "schedule_id": row.schedule_id,
                    "amount": row.amount,
                    "percent": row.percent,
                })
                .to_string(),
            ),
            changed_fields: vec!["amount".to_string(), "percent".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn recognize_project_revenue(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    line_id: u64,
    params: RecognizeProjectRevenueParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_revenue_line", "write")?;
    check_permission(ctx, organization_id, "account_move", "create")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

    let line = ctx
        .db
        .project_revenue_line()
        .id()
        .find(&line_id)
        .ok_or("Revenue line not found")?;
    if line.organization_id != organization_id {
        return Err("Revenue line does not belong to this organization".to_string());
    }
    if line.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if line.recognized {
        return Err("Revenue already recognized for this line".to_string());
    }

    let schedule = ctx
        .db
        .project_revenue_schedule()
        .id()
        .find(&line.schedule_id)
        .ok_or("Schedule not found")?;
    if schedule.company_id != company_id {
        return Err("Schedule does not belong to this company".to_string());
    }

    // Isolation guard: never touch subscription deferred_revenue_* tables.
    let (move_id, move_line_id) = post_project_revrec_je(
        ctx,
        organization_id,
        company_id,
        &schedule,
        &line,
        params.reference.clone(),
        params.metadata.clone(),
    )?;

    ctx.db
        .project_revenue_line()
        .id()
        .update(ProjectRevenueLine {
            recognized: true,
            move_id: Some(move_id),
            move_line_id: Some(move_line_id),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..line.clone()
        });

    let new_recognized = schedule.recognized_amount + line.amount;
    let new_deferred = (schedule.deferred_amount - line.amount).max(0.0);
    let new_state = if new_deferred <= 0.0 {
        "finished".to_string()
    } else {
        schedule.state.clone()
    };
    ctx.db
        .project_revenue_schedule()
        .id()
        .update(ProjectRevenueSchedule {
            recognized_amount: new_recognized,
            deferred_amount: new_deferred,
            state: new_state,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..schedule.clone()
        });

    refresh_project_margin_snapshot(ctx, organization_id, company_id, schedule.project_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "project_revenue_line",
            record_id: line_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "recognized": false }).to_string()),
            new_values: Some(
                serde_json::json!({
                    "recognized": true,
                    "move_id": move_id,
                    "amount": line.amount,
                    "project_id": schedule.project_id,
                    "isolation": "project_revenue_* only",
                })
                .to_string(),
            ),
            changed_fields: vec![
                "recognized".to_string(),
                "move_id".to_string(),
                "move_line_id".to_string(),
            ],
            metadata: params.metadata,
        },
    );
    Ok(())
}

// ── Integration intents ──────────────────────────────────────────────────────

#[reducer]
pub fn create_project_integration_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateProjectIntegrationIntentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_integration_intent", "create")?;
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    let intent_type = params.intent_type.to_lowercase();
    if !matches!(
        intent_type.as_str(),
        "payroll_export" | "calendar_sync" | "e_invoice"
    ) {
        return Err("intent_type must be payroll_export, calendar_sync, or e_invoice".to_string());
    }
    if params.idempotency_key.trim().is_empty() {
        return Err("idempotency_key is required".to_string());
    }

    if let Some(existing) = ctx
        .db
        .project_integration_intent()
        .proj_intent_by_key()
        .filter(&params.idempotency_key)
        .find(|i| i.organization_id == organization_id)
    {
        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(company_id),
                table_name: "project_integration_intent",
                record_id: existing.id,
                action: "CREATE",
                old_values: None,
                new_values: Some(
                    serde_json::json!({ "idempotent": true, "status": existing.status })
                        .to_string(),
                ),
                changed_fields: vec![],
                metadata: params.metadata,
            },
        );
        return Ok(());
    }

    if let Some(pid) = params.project_id {
        let project = ctx
            .db
            .project_project()
            .id()
            .find(&pid)
            .ok_or("Project not found")?;
        if project.organization_id != organization_id || project.company_id != company_id {
            return Err("Project does not belong to this company".to_string());
        }
    }

    let row = ctx
        .db
        .project_integration_intent()
        .insert(ProjectIntegrationIntent {
            id: 0,
            organization_id,
            company_id,
            project_id: params.project_id,
            intent_type,
            status: "pending".to_string(),
            idempotency_key: params.idempotency_key,
            payload: params.payload,
            result_ref: None,
            last_error: None,
            attempt_count: 0,
            applied_at: None,
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
            table_name: "project_integration_intent",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "intent_type": row.intent_type,
                    "status": row.status,
                    "idempotency_key": row.idempotency_key,
                })
                .to_string(),
            ),
            changed_fields: vec!["intent_type".to_string(), "status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn apply_project_integration_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    intent_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_integration_intent", "write")?;

    let intent = ctx
        .db
        .project_integration_intent()
        .id()
        .find(&intent_id)
        .ok_or("Intent not found")?;
    if intent.organization_id != organization_id {
        return Err("Intent does not belong to this organization".to_string());
    }
    if intent.status == "applied" {
        return Ok(());
    }

    // Worker stub: durable mark applied with result_ref (HTTP belongs in api-server worker).
    let result_ref = format!(
        "stub:{}:{}:{}",
        intent.intent_type, intent.id, intent.idempotency_key
    );
    ctx.db
        .project_integration_intent()
        .id()
        .update(ProjectIntegrationIntent {
            status: "applied".to_string(),
            result_ref: Some(result_ref.clone()),
            last_error: None,
            attempt_count: intent.attempt_count.saturating_add(1),
            applied_at: Some(ctx.timestamp),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..intent.clone()
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(intent.company_id),
            table_name: "project_integration_intent",
            record_id: intent_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "status": intent.status }).to_string()),
            new_values: Some(
                serde_json::json!({ "status": "applied", "result_ref": result_ref }).to_string(),
            ),
            changed_fields: vec!["status".to_string(), "result_ref".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn fail_project_integration_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    intent_id: u64,
    params: FailProjectIntegrationIntentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_integration_intent", "write")?;

    let intent = ctx
        .db
        .project_integration_intent()
        .id()
        .find(&intent_id)
        .ok_or("Intent not found")?;
    if intent.organization_id != organization_id {
        return Err("Intent does not belong to this organization".to_string());
    }

    ctx.db
        .project_integration_intent()
        .id()
        .update(ProjectIntegrationIntent {
            status: "failed".to_string(),
            last_error: Some(params.last_error.clone()),
            attempt_count: intent.attempt_count.saturating_add(1),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: params.metadata.clone().or(intent.metadata.clone()),
            ..intent.clone()
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(intent.company_id),
            table_name: "project_integration_intent",
            record_id: intent_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "status": intent.status }).to_string()),
            new_values: Some(
                serde_json::json!({
                    "status": "failed",
                    "last_error": params.last_error,
                })
                .to_string(),
            ),
            changed_fields: vec!["status".to_string(), "last_error".to_string()],
            metadata: params.metadata,
        },
    );
    Ok(())
}

#[reducer]
pub fn apply_pending_project_integration_intents(
    ctx: &ReducerContext,
    organization_id: u64,
    limit: u32,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_integration_intent", "write")?;
    let cap = if limit == 0 { 20 } else { limit.min(100) };
    let pending: Vec<u64> = ctx
        .db
        .project_integration_intent()
        .proj_intent_by_org()
        .filter(&organization_id)
        .filter(|i| i.status == "pending")
        .take(cap as usize)
        .map(|i| i.id)
        .collect();
    for intent_id in pending {
        let _ = apply_project_integration_intent(ctx, organization_id, intent_id);
    }
    Ok(())
}
