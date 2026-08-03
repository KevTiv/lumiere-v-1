//! Project accounting projections — margin snapshot, utilisation, optional WIP hook.
//!
//! # Tables
//! | Table | Description |
//! |-------|-------------|
//! | **ProjectMarginSnapshot** | Live margin per project (revenue, labor, expenses) |
//! | **ResourceUtilisationSnapshot** | Available vs billable/non-billable hours |

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::budgeting::crossovered_budget_lines;
use crate::accounting::fiscal_periods::ensure_accounting_period_open_for_date;
use crate::accounting::journal_entries::{
    account_move, account_move_line, AccountMove, AccountMoveLine,
};
use crate::core::organization::{company, company_id_from_scope};
use crate::expenses::expenses::{expense_sheet, hr_expense};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::projects::capacity::resource_capacity_snapshot;
use crate::projects::milestones::project_milestone;
use crate::projects::projects::project_project;
use crate::projects::timesheets::project_timesheet;
use crate::types::{AccountMoveState, ExpenseState, MoveType, PaymentState};

// ── Tables ───────────────────────────────────────────────────────────────────

/// Materialised project margin for live `project-margin-by-project` subscriptions.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = project_margin_snapshot,
    public,
    index(accessor = margin_by_org, btree(columns = [organization_id])),
    index(accessor = margin_by_company, btree(columns = [company_id])),
    index(accessor = margin_by_project, btree(columns = [project_id]))
)]
pub struct ProjectMarginSnapshot {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub project_id: u64,
    /// Billed T&M + milestone + expense rebill (company currency).
    pub billed_revenue: f64,
    /// Validated billable time not yet invoiced (company currency).
    pub unbilled_revenue: f64,
    /// Validated/billed labor cost (company currency).
    pub labor_cost: f64,
    /// Posted/done project expense cost (document currency, best-effort).
    pub expense_cost: f64,
    /// Linked vendor PO / bill subcontractor cost (company currency).
    pub subcontractor_cost: f64,
    /// billed_revenue − labor_cost − expense_cost − subcontractor_cost
    pub margin_amount: f64,
    /// margin_amount / billed_revenue × 100 (0 when billed_revenue == 0)
    pub margin_percent: f64,
    /// Sum of crossovered_budget_lines.planned_amount for this project.
    pub budget_planned: f64,
    /// labor_cost + expense_cost (actual spend proxy for budget vs actual).
    pub budget_actual: f64,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Vendor PO / bill line cost attributed to a project (subcontractor) — Wave E.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = project_subcontractor_cost,
    public,
    index(accessor = subcon_by_org, btree(columns = [organization_id])),
    index(accessor = subcon_by_company, btree(columns = [company_id])),
    index(accessor = subcon_by_project, btree(columns = [project_id])),
    index(accessor = subcon_by_po_line, btree(columns = [purchase_order_line_id]))
)]
pub struct ProjectSubcontractorCost {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
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
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Materialised utilisation for live `resource-utilisation-by-employee` subscriptions.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = resource_utilisation_snapshot,
    public,
    index(accessor = utilisation_by_org, btree(columns = [organization_id])),
    index(accessor = utilisation_by_company, btree(columns = [company_id])),
    index(accessor = utilisation_by_employee, btree(columns = [employee_id]))
)]
pub struct ResourceUtilisationSnapshot {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub employee_id: u64,
    pub period_start: Timestamp,
    pub period_end: Timestamp,
    pub available_hours: f64,
    pub billable_hours: f64,
    pub non_billable_hours: f64,
    /// (billable + non_billable) / available × 100
    pub utilisation_percent: f64,
    /// billable / available × 100
    pub billable_utilisation_percent: f64,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct RefreshProjectMarginParams {
    pub project_ids: Vec<u64>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RefreshResourceUtilisationParams {
    pub employee_id: Option<u64>,
    pub period_start: Option<Timestamp>,
    pub period_end: Option<Timestamp>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct PostTimesheetWipParams {
    pub journal_id: u64,
    pub wip_account_id: u64,
    pub labor_account_id: u64,
}

// ── Margin math ──────────────────────────────────────────────────────────────

fn company_amount(amount: f64, currency_rate: f64) -> f64 {
    if currency_rate > 0.0 {
        amount * currency_rate
    } else {
        amount
    }
}

/// Recompute and upsert margin snapshot for one project (company-scoped).
pub fn refresh_project_margin_snapshot(
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

    let mut billed_revenue = 0.0f64;
    let mut unbilled_revenue = 0.0f64;
    let mut labor_cost = 0.0f64;

    for ts in ctx
        .db
        .project_timesheet()
        .timesheet_by_project()
        .filter(&project_id)
    {
        if ts.organization_id != organization_id || ts.company_id != company_id {
            continue;
        }
        let is_validated_or_billed =
            ts.validation_status == "validated" || ts.timesheet_invoice_id.is_some();
        if !is_validated_or_billed {
            continue;
        }

        let cost = if ts.amount_company > 0.0 {
            ts.amount_company
        } else {
            company_amount(ts.amount, ts.currency_rate)
        };
        labor_cost += cost;

        if ts.timesheet_invoice_type != "billable" {
            continue;
        }
        let rev = if ts.timesheet_revenue_company > 0.0 {
            ts.timesheet_revenue_company
        } else {
            company_amount(ts.timesheet_revenue, ts.currency_rate)
        };
        if ts.timesheet_invoice_id.is_some() {
            billed_revenue += rev;
        } else if ts.validation_status == "validated" {
            unbilled_revenue += rev;
        }
    }

    // Milestone fixed-fee bills
    for ms in ctx
        .db
        .project_milestone()
        .milestone_by_project()
        .filter(&project_id)
    {
        if ms.organization_id != organization_id || ms.company_id != company_id {
            continue;
        }
        if ms.invoice_move_id.is_some() && ms.billed_amount > 0.0 {
            billed_revenue += ms.billed_amount;
        }
    }

    // Expense cost + rebill revenue (posted/done lines on this project)
    let mut expense_cost = 0.0f64;
    let mut rebill_revenue = 0.0f64;
    for exp in ctx.db.hr_expense().iter().filter(|e| {
        e.organization_id == organization_id
            && e.company_id == company_id
            && e.project_id == Some(project_id)
            && matches!(
                e.state,
                ExpenseState::Posted | ExpenseState::Done | ExpenseState::Approved
            )
    }) {
        expense_cost += exp.total_amount;
        if let Some(sheet_id) = exp.sheet_id {
            if let Some(sheet) = ctx.db.expense_sheet().id().find(&sheet_id) {
                if sheet.rebill_move_id.is_some() {
                    let rate = if sheet.currency_rate > 0.0 {
                        sheet.currency_rate
                    } else {
                        1.0
                    };
                    rebill_revenue += exp.total_amount * rate;
                }
            }
        }
    }
    billed_revenue += rebill_revenue;

    // Subcontractor costs linked via Wave E `project_subcontractor_cost` (sibling module table).
    let subcontractor_cost: f64 = ctx
        .db
        .project_subcontractor_cost()
        .subcon_by_project()
        .filter(&project_id)
        .filter(|c| c.organization_id == organization_id && c.company_id == company_id && c.active)
        .map(|c| c.amount)
        .sum();

    let budget_planned: f64 = ctx
        .db
        .crossovered_budget_lines()
        .iter()
        .filter(|l| {
            l.organization_id == organization_id
                && l.company_id == company_id
                && l.project_id == Some(project_id)
        })
        .map(|l| l.planned_amount)
        .sum();

    let budget_actual = labor_cost + expense_cost + subcontractor_cost;
    let margin_amount = billed_revenue - labor_cost - expense_cost - subcontractor_cost;
    let margin_percent = if billed_revenue.abs() > f64::EPSILON {
        (margin_amount / billed_revenue) * 100.0
    } else {
        0.0
    };

    let existing: Vec<u64> = ctx
        .db
        .project_margin_snapshot()
        .margin_by_project()
        .filter(&project_id)
        .filter(|s| s.organization_id == organization_id && s.company_id == company_id)
        .map(|s| s.id)
        .collect();
    for id in existing {
        ctx.db.project_margin_snapshot().id().delete(&id);
    }

    ctx.db
        .project_margin_snapshot()
        .insert(ProjectMarginSnapshot {
            id: 0,
            organization_id,
            company_id,
            project_id,
            billed_revenue,
            unbilled_revenue,
            labor_cost,
            expense_cost,
            subcontractor_cost,
            margin_amount,
            margin_percent,
            budget_planned,
            budget_actual,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: Some(
                serde_json::json!({
                    "formula": "billed_revenue - labor_cost - expense_cost - subcontractor_cost",
                    "rebill_revenue": rebill_revenue,
                })
                .to_string(),
            ),
        });
}

/// Refresh margin for each distinct project id (skips unknown / wrong-tenant).
pub fn refresh_project_margin_for_projects(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    project_ids: impl IntoIterator<Item = u64>,
) {
    let mut seen = std::collections::BTreeSet::new();
    for pid in project_ids {
        if seen.insert(pid) {
            refresh_project_margin_snapshot(ctx, organization_id, company_id, pid);
        }
    }
}

// ── Utilisation ──────────────────────────────────────────────────────────────

fn default_utilisation_period(ctx: &ReducerContext) -> (Timestamp, Timestamp) {
    let start_micros = ctx.timestamp.to_micros_since_unix_epoch();
    // ~30-day window ending now
    let period_start =
        Timestamp::from_micros_since_unix_epoch(start_micros.saturating_sub(30 * 86_400_000_000));
    (period_start, ctx.timestamp)
}

/// Upsert utilisation for one employee from capacity snapshot + timesheet split.
pub fn refresh_resource_utilisation_snapshot(
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

    let mut billable_hours = 0.0f64;
    let mut non_billable_hours = 0.0f64;
    for ts in ctx
        .db
        .project_timesheet()
        .timesheet_by_employee()
        .filter(&employee_id)
    {
        if ts.organization_id != organization_id || ts.company_id != company_id {
            continue;
        }
        if ts.date < period_start || ts.date > period_end {
            continue;
        }
        if ts.timesheet_invoice_type == "billable" {
            billable_hours += ts.unit_amount;
        } else {
            non_billable_hours += ts.unit_amount;
        }
    }

    let total = billable_hours + non_billable_hours;
    let utilisation_percent = if available_hours > f64::EPSILON {
        (total / available_hours) * 100.0
    } else {
        0.0
    };
    let billable_utilisation_percent = if available_hours > f64::EPSILON {
        (billable_hours / available_hours) * 100.0
    } else {
        0.0
    };

    let existing: Vec<u64> = ctx
        .db
        .resource_utilisation_snapshot()
        .utilisation_by_employee()
        .filter(&employee_id)
        .filter(|s| s.organization_id == organization_id && s.company_id == company_id)
        .map(|s| s.id)
        .collect();
    for id in existing {
        ctx.db.resource_utilisation_snapshot().id().delete(&id);
    }

    ctx.db
        .resource_utilisation_snapshot()
        .insert(ResourceUtilisationSnapshot {
            id: 0,
            organization_id,
            company_id,
            employee_id,
            period_start,
            period_end,
            available_hours,
            billable_hours,
            non_billable_hours,
            utilisation_percent,
            billable_utilisation_percent,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: Some(
                serde_json::json!({
                    "formula": "(billable+non_billable)/available",
                })
                .to_string(),
            ),
        });
}

// ── Optional WIP JE ──────────────────────────────────────────────────────────

/// When project.allow_wip_je and accounts provided, post a draft WIP Entry for
/// newly validated billable labor cost. Idempotent per timesheet via metadata.
pub fn maybe_post_wip_je_for_validated(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    timesheet_ids: &[u64],
    wip: &PostTimesheetWipParams,
) -> Result<(), String> {
    ensure_accounting_period_open_for_date(ctx, company_id, ctx.timestamp)?;

    let company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;

    let mut by_project: std::collections::BTreeMap<u64, f64> = std::collections::BTreeMap::new();
    let mut touched_ids: Vec<u64> = Vec::new();

    for tid in timesheet_ids {
        let ts = ctx
            .db
            .project_timesheet()
            .id()
            .find(tid)
            .ok_or("Timesheet not found")?;
        if ts.company_id != company_id || ts.organization_id != organization_id {
            continue;
        }
        if ts.validation_status != "validated" {
            continue;
        }
        if ts.timesheet_invoice_type != "billable" {
            continue;
        }
        // Skip if already WIP'd
        if ts
            .metadata
            .as_deref()
            .map(|m| m.contains("\"wip_move_id\""))
            .unwrap_or(false)
        {
            continue;
        }
        let project = ctx
            .db
            .project_project()
            .id()
            .find(&ts.project_id)
            .ok_or("Project not found")?;
        if !project.allow_wip_je {
            continue;
        }
        let cost = if ts.amount_company > 0.0 {
            ts.amount_company
        } else {
            company_amount(ts.amount, ts.currency_rate)
        };
        if cost <= 0.0 {
            continue;
        }
        *by_project.entry(ts.project_id).or_insert(0.0) += cost;
        touched_ids.push(*tid);
    }

    if by_project.is_empty() {
        return Ok(());
    }

    for (project_id, amount) in by_project {
        let move_row = ctx.db.account_move().insert(AccountMove {
            id: 0,
            organization_id,
            name: String::new(),
            ref_: Some(format!("WIP-P{project_id}")),
            move_type: MoveType::Entry,
            auto_post: false,
            state: AccountMoveState::Draft,
            date: ctx.timestamp,
            invoice_date: None,
            invoice_date_due: None,
            invoice_payment_term_id: None,
            invoice_origin: Some(format!("Project WIP {project_id}")),
            invoice_partner_display_name: None,
            invoice_cash_rounding_id: None,
            payment_reference: None,
            partner_shipping_id: None,
            sale_order_id: None,
            partner_id: None,
            commercial_partner_id: None,
            partner_bank_id: None,
            fiscal_position_id: None,
            invoice_user_id: Some(ctx.sender()),
            invoice_incoterm_id: None,
            incoterm_location: None,
            campaign_id: None,
            source_id: None,
            medium_id: None,
            company_id,
            journal_id: wip.journal_id,
            currency_id: company.currency_id,
            company_currency_id: company.currency_id,
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
            posted_before: false,
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
            metadata: Some(
                serde_json::json!({
                    "kind": "project_wip",
                    "project_id": project_id,
                })
                .to_string(),
            ),
        });
        let move_id = move_row.id;

        // Debit WIP
        ctx.db.account_move_line().insert(AccountMoveLine {
            id: 0,
            organization_id,
            move_id,
            move_name: None,
            date: ctx.timestamp,
            ref_: None,
            parent_state: AccountMoveState::Draft,
            journal_id: wip.journal_id,
            company_id,
            company_currency_id: company.currency_id,
            sequence: 1,
            name: format!("WIP labor — project {project_id}"),
            quantity: 1.0,
            price_unit: amount,
            price: amount,
            price_subtotal: amount,
            price_total: amount,
            discount: 0.0,
            balance: amount,
            currency_id: company.currency_id,
            amount_currency: amount,
            amount_residual: amount,
            amount_residual_currency: amount,
            debit: amount,
            credit: 0.0,
            debit_currency: amount,
            credit_currency: 0.0,
            tax_base_amount: 0.0,
            account_id: wip.wip_account_id,
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
            metadata: None,
        });
        // Credit labor / clearing
        ctx.db.account_move_line().insert(AccountMoveLine {
            id: 0,
            organization_id,
            move_id,
            move_name: None,
            date: ctx.timestamp,
            ref_: None,
            parent_state: AccountMoveState::Draft,
            journal_id: wip.journal_id,
            company_id,
            company_currency_id: company.currency_id,
            sequence: 2,
            name: format!("Labor clearing — project {project_id}"),
            quantity: 1.0,
            price_unit: amount,
            price: amount,
            price_subtotal: amount,
            price_total: amount,
            discount: 0.0,
            balance: -amount,
            currency_id: company.currency_id,
            amount_currency: -amount,
            amount_residual: 0.0,
            amount_residual_currency: 0.0,
            debit: 0.0,
            credit: amount,
            debit_currency: 0.0,
            credit_currency: amount,
            tax_base_amount: 0.0,
            account_id: wip.labor_account_id,
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
            metadata: None,
        });

        for tid in &touched_ids {
            let Some(ts) = ctx.db.project_timesheet().id().find(tid) else {
                continue;
            };
            if ts.project_id != project_id {
                continue;
            }
            let metadata = {
                let mut map = match ts
                    .metadata
                    .as_deref()
                    .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
                {
                    Some(serde_json::Value::Object(m)) => m,
                    _ => serde_json::Map::new(),
                };
                map.insert("wip_move_id".into(), serde_json::json!(move_id));
                Some(serde_json::Value::Object(map).to_string())
            };
            ctx.db
                .project_timesheet()
                .id()
                .update(crate::projects::timesheets::ProjectTimesheet {
                    metadata,
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..ts
                });
        }

        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(company_id),
                table_name: "account_move",
                record_id: move_id,
                action: "CREATE",
                old_values: None,
                new_values: Some(
                    serde_json::json!({
                        "kind": "project_wip",
                        "project_id": project_id,
                        "amount": amount,
                    })
                    .to_string(),
                ),
                changed_fields: vec!["wip".to_string()],
                metadata: None,
            },
        );
    }

    Ok(())
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn refresh_project_margin(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: RefreshProjectMarginParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_project", "read")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;
    if params.project_ids.is_empty() {
        for p in ctx
            .db
            .project_project()
            .project_by_company()
            .filter(&company_id)
            .filter(|p| p.organization_id == organization_id)
        {
            refresh_project_margin_snapshot(ctx, organization_id, company_id, p.id);
        }
    } else {
        refresh_project_margin_for_projects(ctx, organization_id, company_id, params.project_ids);
    }
    Ok(())
}

#[reducer]
pub fn refresh_resource_utilisation(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: RefreshResourceUtilisationParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "project_timesheet", "read")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;
    let (default_start, default_end) = default_utilisation_period(ctx);
    let period_start = params.period_start.unwrap_or(default_start);
    let period_end = params.period_end.unwrap_or(default_end);

    if let Some(eid) = params.employee_id {
        refresh_resource_utilisation_snapshot(
            ctx,
            organization_id,
            company_id,
            eid,
            period_start,
            period_end,
        );
    } else {
        let employee_ids: std::collections::BTreeSet<u64> = ctx
            .db
            .project_timesheet()
            .timesheet_by_company()
            .filter(&company_id)
            .filter(|t| t.organization_id == organization_id)
            .map(|t| t.employee_id)
            .collect();
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
    }
    Ok(())
}
