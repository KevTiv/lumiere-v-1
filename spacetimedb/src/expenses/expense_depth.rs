//! Wave C — mileage/per diem rates, split allocations, project rebill.
use spacetimedb::{reducer, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::chart_of_accounts::{account_account, account_journal};
use crate::accounting::fiscal_periods::ensure_accounting_period_open_for_date;
use crate::accounting::journal_entries::{
    account_move, account_move_line, insert_draft_account_move_line, AccountMove,
    AddAccountMoveLineParams,
};
use crate::accounting::tax_management::{account_tax, account_tax_group};
use crate::core::country_pack::company_enabled_pack_keys;
use crate::core::organization::company_id_from_scope;
use crate::expenses::expenses::{
    expense_sheet, hr_expense, metadata_str_eq, HrExpense, HrExpenseSheet,
};
use crate::helpers::{
    calculate_tax, check_permission, next_doc_number, write_audit_log_v2, AuditLogParams,
};
use crate::projects::project_accounting::refresh_project_margin_for_projects;
use crate::projects::projects::project_project;
use crate::sales::oms_extensions::remap_taxes_for_fiscal_position;
use crate::types::{
    AccountMoveState, ExpenseSheetState, ExpenseState, MoveType, PaymentState, TaxTypeUse,
};

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = hr_expense_mileage_rate,
    public,
    index(accessor = mileage_rate_by_org, btree(columns = [organization_id])),
    index(accessor = mileage_rate_by_company, btree(columns = [company_id]))
)]
pub struct HrExpenseMileageRate {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    pub currency_id: u64,
    /// Amount per distance unit (km/mi) in rate currency.
    pub rate_per_unit: f64,
    /// `"km"` or `"mi"`.
    pub unit: String,
    pub effective_from: Option<Timestamp>,
    pub effective_to: Option<Timestamp>,
    pub active: bool,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = hr_expense_per_diem_rate,
    public,
    index(accessor = per_diem_rate_by_org, btree(columns = [organization_id])),
    index(accessor = per_diem_rate_by_company, btree(columns = [company_id]))
)]
pub struct HrExpensePerDiemRate {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    pub currency_id: u64,
    pub location_code: String,
    pub amount_per_day: f64,
    pub effective_from: Option<Timestamp>,
    pub effective_to: Option<Timestamp>,
    pub active: bool,
    pub metadata: Option<String>,
}

/// Split of one expense line across analytic/project shares (must total 100%).
#[spacetimedb::table(
    accessor = hr_expense_allocation,
    public,
    index(accessor = allocation_by_org, btree(columns = [organization_id])),
    index(accessor = allocation_by_expense, btree(columns = [expense_id]))
)]
pub struct HrExpenseAllocation {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub expense_id: u64,
    pub analytic_account_id: Option<u64>,
    pub project_id: Option<u64>,
    pub share_percent: f64,
    pub amount: f64,
    pub billable: bool,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpsertExpenseMileageRateParams {
    pub company_id: Option<u64>,
    pub name: String,
    pub currency_id: u64,
    pub rate_per_unit: f64,
    pub unit: String,
    pub effective_from: Option<Timestamp>,
    pub effective_to: Option<Timestamp>,
    pub active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpsertExpensePerDiemRateParams {
    pub company_id: Option<u64>,
    pub name: String,
    pub currency_id: u64,
    pub location_code: String,
    pub amount_per_day: f64,
    pub effective_from: Option<Timestamp>,
    pub effective_to: Option<Timestamp>,
    pub active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ExpenseAllocationLineParams {
    pub analytic_account_id: Option<u64>,
    pub project_id: Option<u64>,
    pub share_percent: f64,
    pub billable: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct SeedStatutoryExpenseMileageRatesParams {
    pub company_id: Option<u64>,
    pub currency_id: u64,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct SetExpenseAllocationsParams {
    pub lines: Vec<ExpenseAllocationLineParams>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateExpenseProjectRebillParams {
    pub journal_id: u64,
    pub receivable_account_id: u64,
    pub income_account_id: u64,
    pub invoice_date: Timestamp,
    /// Override project partner when set.
    pub partner_id: Option<u64>,
    /// Optional fiscal position for tax remap (partner FP when known).
    pub fiscal_position_id: Option<u64>,
    pub client_request_id: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Resolve sale tax ids for project rebill — prefer expense-line taxes (remapped via
/// optional fiscal position), else company default sale tax (mirrors `bill_timesheets`).
fn resolve_rebill_tax_ids(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    line_tax_ids: &[u64],
    fiscal_position_id: Option<u64>,
) -> Result<Vec<u64>, String> {
    let mut tax_ids = if line_tax_ids.is_empty() {
        let mut sale_taxes: Vec<_> = ctx
            .db
            .account_tax()
            .tax_by_company()
            .filter(&company_id)
            .filter(|t| {
                t.organization_id == organization_id
                    && t.active
                    && t.type_tax_use == TaxTypeUse::Sale
            })
            .collect();
        sale_taxes.sort_by_key(|t| t.sequence);
        sale_taxes
            .into_iter()
            .next()
            .map(|t| vec![t.id])
            .unwrap_or_default()
    } else {
        line_tax_ids.to_vec()
    };
    tax_ids = remap_taxes_for_fiscal_position(ctx, organization_id, fiscal_position_id, &tax_ids)?;
    Ok(tax_ids)
}

fn resolve_tax_payable_account(ctx: &ReducerContext, tax_ids: &[u64]) -> Option<u64> {
    for &tax_id in tax_ids {
        let Some(tax) = ctx.db.account_tax().id().find(&tax_id) else {
            continue;
        };
        let Some(group_id) = tax.tax_group_id else {
            continue;
        };
        if let Some(group) = ctx.db.account_tax_group().id().find(&group_id) {
            if let Some(payable) = group.tax_payable_account_id.filter(|id| *id > 0) {
                return Some(payable);
            }
        }
    }
    None
}

fn empty_line_params(
    account_id: u64,
    name: String,
    debit: f64,
    credit: f64,
    sequence: u32,
) -> AddAccountMoveLineParams {
    AddAccountMoveLineParams {
        account_id,
        name,
        debit,
        credit,
        sequence,
        quantity: if debit > 0.0 || credit > 0.0 {
            1.0
        } else {
            0.0
        },
        price_unit: debit.max(credit),
        discount: 0.0,
        tax_ids: vec![],
        partner_id: None,
        product_id: None,
        product_uom_id: None,
        product_category_id: None,
        analytic_account_id: None,
        analytic_tag_ids: vec![],
        display_type: None,
        is_downpayment: false,
        exclude_from_invoice_tab: false,
        blocked: false,
        group_tax_id: None,
        tax_line_id: None,
        tax_group_id: None,
        tax_repartition_line_id: None,
        tax_audit: None,
        reconcile_model_id: None,
        payment_id: None,
        statement_line_id: None,
        matching_number: None,
        matching_label: None,
        expected_pay_date: None,
        expected_pay_date_currency_id: None,
        expected_pay_date_amount: 0.0,
        expected_pay_date_residual: 0.0,
        metadata: None,
    }
}

fn validate_account(
    ctx: &ReducerContext,
    company_id: u64,
    account_id: u64,
    label: &str,
) -> Result<(), String> {
    let account = ctx
        .db
        .account_account()
        .id()
        .find(&account_id)
        .ok_or_else(|| format!("{label} account not found"))?;
    if account.company_id != company_id {
        return Err(format!("{label} account does not belong to this company"));
    }
    Ok(())
}

pub(crate) fn allocations_for_expense(
    ctx: &ReducerContext,
    expense_id: u64,
) -> Vec<HrExpenseAllocation> {
    ctx.db
        .hr_expense_allocation()
        .allocation_by_expense()
        .filter(&expense_id)
        .collect()
}

pub(crate) fn clear_allocations_for_expense(ctx: &ReducerContext, expense_id: u64) {
    let ids: Vec<u64> = allocations_for_expense(ctx, expense_id)
        .into_iter()
        .map(|a| a.id)
        .collect();
    for id in ids {
        ctx.db.hr_expense_allocation().id().delete(&id);
    }
}

// ── Statutory mileage helpers (AU/NZ packs) ───────────────────────────────────

/// Illustrative statutory cents-per-km tables for country packs.
/// Confirm against ATO / IRD before production close — rates change by income year.
pub fn statutory_mileage_rate_specs(pack_key: &str) -> Vec<(&'static str, f64, &'static str)> {
    match pack_key {
        "au" => vec![("ATO cents per kilometre (seed)", 0.88, "km")],
        "nz" => vec![("IRD mileage rate (seed)", 0.95, "km")],
        _ => vec![],
    }
}

/// Insert missing statutory mileage rates for one pack (idempotent by name + company).
pub(crate) fn seed_statutory_mileage_rates_for_pack(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    pack_key: &str,
    currency_id: u64,
) -> Result<u32, String> {
    let mut inserted = 0u32;
    for (name, rate_per_unit, unit) in statutory_mileage_rate_specs(pack_key) {
        let exists = ctx.db.hr_expense_mileage_rate().iter().any(|r| {
            r.organization_id == organization_id && r.company_id == company_id && r.name == name
        });
        if exists {
            continue;
        }
        let meta = serde_json::json!({
            "statutory": true,
            "pack_key": pack_key,
            "source": "seed",
        })
        .to_string();
        ctx.db
            .hr_expense_mileage_rate()
            .insert(HrExpenseMileageRate {
                id: 0,
                organization_id,
                company_id,
                name: name.to_string(),
                currency_id,
                rate_per_unit,
                unit: unit.to_string(),
                effective_from: None,
                effective_to: None,
                active: true,
                metadata: Some(meta),
            });
        inserted = inserted.saturating_add(1);
    }
    Ok(inserted)
}

/// Seed AU/NZ (and any pack with specs) statutory mileage rates for enabled company packs.
#[reducer]
pub fn seed_statutory_expense_mileage_rates(
    ctx: &ReducerContext,
    organization_id: u64,
    params: SeedStatutoryExpenseMileageRatesParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense", "update")?;
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    if params.currency_id == 0 {
        return Err("currency_id is required".to_string());
    }
    let pack_keys = company_enabled_pack_keys(ctx, organization_id, company_id);
    let mut total = 0u32;
    let mut seeded_packs: Vec<String> = Vec::new();
    for key in &pack_keys {
        let n = seed_statutory_mileage_rates_for_pack(
            ctx,
            organization_id,
            company_id,
            key,
            params.currency_id,
        )?;
        if n > 0 {
            seeded_packs.push(key.clone());
            total = total.saturating_add(n);
        }
    }
    // If no packs enabled, still allow explicit AU/NZ seed for pilot companies.
    if pack_keys.is_empty() {
        for key in ["au", "nz"] {
            let n = seed_statutory_mileage_rates_for_pack(
                ctx,
                organization_id,
                company_id,
                key,
                params.currency_id,
            )?;
            if n > 0 {
                seeded_packs.push(key.to_string());
                total = total.saturating_add(n);
            }
        }
    }
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_expense_mileage_rate",
            record_id: 0,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "inserted": total,
                    "packs": seeded_packs,
                })
                .to_string(),
            ),
            changed_fields: vec!["statutory_mileage_seeds".into()],
            metadata: None,
        },
    );
    Ok(())
}

// ── Reducers: Rates ───────────────────────────────────────────────────────────

#[reducer]
pub fn upsert_expense_mileage_rate(
    ctx: &ReducerContext,
    organization_id: u64,
    rate_id: Option<u64>,
    params: UpsertExpenseMileageRateParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense", "update")?;
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    if params.name.trim().is_empty() {
        return Err("Mileage rate name cannot be empty".to_string());
    }
    if params.rate_per_unit <= 0.0 {
        return Err("Mileage rate_per_unit must be positive".to_string());
    }
    let unit = params.unit.trim().to_ascii_lowercase();
    if unit != "km" && unit != "mi" {
        return Err("Mileage unit must be km or mi".to_string());
    }

    if let Some(id) = rate_id {
        let existing = ctx
            .db
            .hr_expense_mileage_rate()
            .id()
            .find(&id)
            .ok_or("Mileage rate not found")?;
        if existing.organization_id != organization_id || existing.company_id != company_id {
            return Err("Mileage rate does not belong to this company".to_string());
        }
        ctx.db
            .hr_expense_mileage_rate()
            .id()
            .update(HrExpenseMileageRate {
                name: params.name,
                currency_id: params.currency_id,
                rate_per_unit: params.rate_per_unit,
                unit,
                effective_from: params.effective_from,
                effective_to: params.effective_to,
                active: params.active,
                metadata: params.metadata.or(existing.metadata.clone()),
                ..existing
            });
        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(company_id),
                table_name: "hr_expense_mileage_rate",
                record_id: id,
                action: "UPDATE",
                old_values: None,
                new_values: None,
                changed_fields: vec!["rate_per_unit".into(), "active".into()],
                metadata: None,
            },
        );
        return Ok(());
    }

    let row = ctx
        .db
        .hr_expense_mileage_rate()
        .insert(HrExpenseMileageRate {
            id: 0,
            organization_id,
            company_id,
            name: params.name,
            currency_id: params.currency_id,
            rate_per_unit: params.rate_per_unit,
            unit,
            effective_from: params.effective_from,
            effective_to: params.effective_to,
            active: params.active,
            metadata: params.metadata,
        });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_expense_mileage_rate",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn upsert_expense_per_diem_rate(
    ctx: &ReducerContext,
    organization_id: u64,
    rate_id: Option<u64>,
    params: UpsertExpensePerDiemRateParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense", "update")?;
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    if params.name.trim().is_empty() {
        return Err("Per diem rate name cannot be empty".to_string());
    }
    if params.amount_per_day <= 0.0 {
        return Err("Per diem amount_per_day must be positive".to_string());
    }
    if params.location_code.trim().is_empty() {
        return Err("Per diem location_code cannot be empty".to_string());
    }

    if let Some(id) = rate_id {
        let existing = ctx
            .db
            .hr_expense_per_diem_rate()
            .id()
            .find(&id)
            .ok_or("Per diem rate not found")?;
        if existing.organization_id != organization_id || existing.company_id != company_id {
            return Err("Per diem rate does not belong to this company".to_string());
        }
        ctx.db
            .hr_expense_per_diem_rate()
            .id()
            .update(HrExpensePerDiemRate {
                name: params.name,
                currency_id: params.currency_id,
                location_code: params.location_code,
                amount_per_day: params.amount_per_day,
                effective_from: params.effective_from,
                effective_to: params.effective_to,
                active: params.active,
                metadata: params.metadata.or(existing.metadata.clone()),
                ..existing
            });
        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(company_id),
                table_name: "hr_expense_per_diem_rate",
                record_id: id,
                action: "UPDATE",
                old_values: None,
                new_values: None,
                changed_fields: vec!["amount_per_day".into(), "active".into()],
                metadata: None,
            },
        );
        return Ok(());
    }

    let row = ctx
        .db
        .hr_expense_per_diem_rate()
        .insert(HrExpensePerDiemRate {
            id: 0,
            organization_id,
            company_id,
            name: params.name,
            currency_id: params.currency_id,
            location_code: params.location_code,
            amount_per_day: params.amount_per_day,
            effective_from: params.effective_from,
            effective_to: params.effective_to,
            active: params.active,
            metadata: params.metadata,
        });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_expense_per_diem_rate",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

// ── Reducers: Allocations ─────────────────────────────────────────────────────

#[reducer]
pub fn set_expense_allocations(
    ctx: &ReducerContext,
    organization_id: u64,
    expense_id: u64,
    params: SetExpenseAllocationsParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense", "update")?;
    let expense = ctx
        .db
        .hr_expense()
        .id()
        .find(&expense_id)
        .ok_or("Expense not found")?;
    if expense.organization_id != organization_id {
        return Err("Expense belongs to a different organization".to_string());
    }
    if expense.state != ExpenseState::Draft {
        return Err("Only draft expenses can change allocations".to_string());
    }
    if params.lines.is_empty() {
        clear_allocations_for_expense(ctx, expense_id);
        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(expense.company_id),
                table_name: "hr_expense_allocation",
                record_id: expense_id,
                action: "DELETE",
                old_values: None,
                new_values: None,
                changed_fields: vec![],
                metadata: Some(r#"{"cleared":true}"#.into()),
            },
        );
        return Ok(());
    }

    let share_sum: f64 = params.lines.iter().map(|l| l.share_percent).sum();
    if (share_sum - 100.0).abs() > 0.01 {
        return Err(format!(
            "Allocation shares must total 100% (got {:.2})",
            share_sum
        ));
    }
    for line in &params.lines {
        if line.share_percent <= 0.0 {
            return Err("Each allocation share_percent must be positive".to_string());
        }
        if line.analytic_account_id.is_none() && line.project_id.is_none() {
            return Err("Each allocation needs analytic_account_id or project_id".to_string());
        }
        if let Some(pid) = line.project_id {
            let project = ctx
                .db
                .project_project()
                .id()
                .find(&pid)
                .ok_or("Allocation project not found")?;
            if project.organization_id != organization_id
                || project.company_id != expense.company_id
            {
                return Err("Allocation project does not belong to this company".to_string());
            }
        }
    }

    clear_allocations_for_expense(ctx, expense_id);
    for line in params.lines {
        let amount = expense.total_amount * (line.share_percent / 100.0);
        ctx.db.hr_expense_allocation().insert(HrExpenseAllocation {
            id: 0,
            organization_id,
            company_id: expense.company_id,
            expense_id,
            analytic_account_id: line.analytic_account_id,
            project_id: line.project_id,
            share_percent: line.share_percent,
            amount,
            billable: line.billable,
            metadata: line.metadata,
        });
    }
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(expense.company_id),
            table_name: "hr_expense_allocation",
            record_id: expense_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["allocations".into()],
            metadata: None,
        },
    );
    Ok(())
}

// ── Reducers: Project rebill ──────────────────────────────────────────────────

#[reducer]
pub fn create_expense_project_rebill(
    ctx: &ReducerContext,
    organization_id: u64,
    sheet_id: u64,
    params: CreateExpenseProjectRebillParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense_sheet", "post")?;
    check_permission(ctx, organization_id, "account_move", "create")?;

    let sheet = ctx
        .db
        .expense_sheet()
        .id()
        .find(&sheet_id)
        .ok_or("Expense sheet not found")?;
    if sheet.organization_id != organization_id {
        return Err("Expense sheet belongs to a different organization".to_string());
    }
    if !matches!(
        sheet.state,
        ExpenseSheetState::Posted | ExpenseSheetState::Done
    ) {
        return Err("Only posted/done sheets can be rebilled".to_string());
    }
    if let Some(existing) = sheet.rebill_move_id {
        if let Some(req) = params.client_request_id.as_ref() {
            if metadata_str_eq(sheet.metadata.as_deref(), "rebill_client_request_id", req) {
                return Ok(());
            }
        }
        return Err(format!(
            "Expense sheet already rebilled (rebill_move_id={existing})"
        ));
    }

    let company_id = sheet.company_id;
    ensure_accounting_period_open_for_date(ctx, company_id, params.invoice_date)?;
    if params.receivable_account_id == params.income_account_id {
        return Err("Receivable and income accounts must differ".to_string());
    }
    validate_account(ctx, company_id, params.receivable_account_id, "Receivable")?;
    validate_account(ctx, company_id, params.income_account_id, "Income")?;
    let journal = ctx
        .db
        .account_journal()
        .id()
        .find(&params.journal_id)
        .ok_or("Journal not found")?;
    if journal.company_id != company_id {
        return Err("Journal does not belong to this company".to_string());
    }

    let rate = if sheet.currency_rate > 0.0 {
        sheet.currency_rate
    } else {
        1.0
    };
    let lines: Vec<HrExpense> = ctx
        .db
        .hr_expense()
        .iter()
        .filter(|e| e.sheet_id == Some(sheet_id))
        .collect();

    let mut rebill_total = 0.0;
    let mut partner_id = params.partner_id;
    let mut income_lines: Vec<(String, f64, Option<u64>, Option<u64>)> = Vec::new();
    let mut collected_tax_ids: Vec<u64> = Vec::new();

    for line in &lines {
        let allocs = allocations_for_expense(ctx, line.id);
        if allocs.is_empty() {
            if let Some(pid) = line.project_id {
                let project = ctx
                    .db
                    .project_project()
                    .id()
                    .find(&pid)
                    .ok_or("Expense project not found")?;
                if partner_id.is_none() {
                    partner_id = project.partner_id;
                }
                let amt = line.total_amount * rate;
                rebill_total += amt;
                for tid in &line.tax_ids {
                    if !collected_tax_ids.contains(tid) {
                        collected_tax_ids.push(*tid);
                    }
                }
                income_lines.push((
                    format!("{} — {}", sheet.name, line.name),
                    amt,
                    project.analytic_account_id.or(line.analytic_account_id),
                    Some(pid),
                ));
            }
        } else {
            for alloc in allocs.into_iter().filter(|a| a.billable) {
                let pid = alloc.project_id.or(line.project_id);
                if pid.is_none() {
                    continue;
                }
                let pid = pid.unwrap();
                let project = ctx
                    .db
                    .project_project()
                    .id()
                    .find(&pid)
                    .ok_or("Allocation project not found")?;
                if partner_id.is_none() {
                    partner_id = project.partner_id;
                }
                let amt = alloc.amount * rate;
                rebill_total += amt;
                for tid in &line.tax_ids {
                    if !collected_tax_ids.contains(tid) {
                        collected_tax_ids.push(*tid);
                    }
                }
                income_lines.push((
                    format!(
                        "{} — {} ({:.0}%)",
                        sheet.name, line.name, alloc.share_percent
                    ),
                    amt,
                    alloc.analytic_account_id.or(project.analytic_account_id),
                    Some(pid),
                ));
            }
        }
    }

    if income_lines.is_empty() || rebill_total <= 0.0 {
        return Err(
            "No billable project amounts to rebill (set project_id or billable allocations)"
                .to_string(),
        );
    }
    let partner_id = partner_id.ok_or(
        "Project rebill requires a customer partner (project.partner_id or params.partner_id)",
    )?;

    let tax_ids = resolve_rebill_tax_ids(
        ctx,
        organization_id,
        company_id,
        &collected_tax_ids,
        params.fiscal_position_id,
    )?;
    let amount_tax = calculate_tax(ctx, &tax_ids, rebill_total);
    let amount_total = rebill_total + amount_tax;

    let origin = format!("EXP{sheet_id}-REBILL");
    let name = next_doc_number(ctx, organization_id, "INV");
    let company_currency_id = if sheet.company_currency_id > 0 {
        sheet.company_currency_id
    } else {
        sheet.currency_id
    };

    let move_record = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: name.clone(),
        ref_: Some(sheet.name.clone()),
        move_type: MoveType::OutInvoice,
        auto_post: false,
        state: AccountMoveState::Draft,
        date: params.invoice_date,
        invoice_date: Some(params.invoice_date),
        invoice_date_due: None,
        invoice_payment_term_id: None,
        invoice_origin: Some(origin.clone()),
        invoice_partner_display_name: None,
        invoice_cash_rounding_id: None,
        payment_reference: Some(origin.clone()),
        partner_shipping_id: None,
        sale_order_id: None,
        partner_id: Some(partner_id),
        commercial_partner_id: Some(partner_id),
        partner_bank_id: None,
        fiscal_position_id: params.fiscal_position_id,
        invoice_user_id: Some(ctx.sender()),
        invoice_incoterm_id: None,
        incoterm_location: None,
        campaign_id: None,
        source_id: None,
        medium_id: None,
        company_id,
        journal_id: params.journal_id,
        currency_id: sheet.currency_id,
        company_currency_id,
        amount_untaxed: rebill_total,
        amount_tax,
        amount_total,
        amount_residual: amount_total,
        amount_untaxed_signed: rebill_total,
        amount_tax_signed: amount_tax,
        amount_total_signed: amount_total,
        amount_total_in_currency_signed: amount_total / rate.max(0.0001),
        amount_residual_signed: amount_total,
        to_check: false,
        posted_before: false,
        is_storno: false,
        is_move_sent: false,
        secure_sequence_number: None,
        invoice_has_outstanding: true,
        payment_state: PaymentState::NotPaid,
        restrict_mode_hash_table: false,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: Some(
            serde_json::json!({
                "expense_sheet_id": sheet_id,
                "kind": "expense_project_rebill",
                "client_request_id": params.client_request_id,
                "tax_ids": tax_ids,
                "amount_tax": amount_tax,
            })
            .to_string(),
        ),
    });

    let rebill_project_ids: Vec<u64> = income_lines
        .iter()
        .filter_map(|(_, _, _, pid)| *pid)
        .collect();

    let mut seq = 1u32;
    for (label, amt, analytic_id, _project_id) in income_lines {
        let mut lp = empty_line_params(params.income_account_id, label, 0.0, amt, seq);
        lp.analytic_account_id = analytic_id;
        lp.partner_id = Some(partner_id);
        lp.tax_ids = tax_ids.clone();
        insert_draft_account_move_line(ctx, &move_record, lp)?;
        seq += 1;
    }
    if amount_tax > 0.0001 {
        let tax_account =
            resolve_tax_payable_account(ctx, &tax_ids).unwrap_or(params.income_account_id);
        let mut tax_lp = empty_line_params(
            tax_account,
            format!("Tax on rebill — {}", sheet.name),
            0.0,
            amount_tax,
            seq,
        );
        tax_lp.partner_id = Some(partner_id);
        tax_lp.tax_ids = tax_ids.clone();
        insert_draft_account_move_line(ctx, &move_record, tax_lp)?;
        seq += 1;
    }
    let mut ar = empty_line_params(
        params.receivable_account_id,
        format!("Customer receivable — {}", sheet.name),
        amount_total,
        0.0,
        seq,
    );
    ar.partner_id = Some(partner_id);
    insert_draft_account_move_line(ctx, &move_record, ar)?;

    for ml in ctx
        .db
        .account_move_line()
        .iter()
        .filter(|l| l.move_id == move_record.id)
    {
        ctx.db.account_move_line().id().update(
            crate::accounting::journal_entries::AccountMoveLine {
                parent_state: AccountMoveState::Posted,
                ..ml
            },
        );
    }
    ctx.db.account_move().id().update(AccountMove {
        state: AccountMoveState::Posted,
        posted_before: true,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..move_record
    });

    let metadata = {
        let mut map = match sheet
            .metadata
            .as_deref()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        {
            Some(serde_json::Value::Object(m)) => m,
            _ => serde_json::Map::new(),
        };
        map.insert(
            "rebill_client_request_id".into(),
            serde_json::json!(params.client_request_id),
        );
        map.insert("rebill_move_id".into(), serde_json::json!(move_record.id));
        Some(serde_json::Value::Object(map).to_string())
    };

    ctx.db.expense_sheet().id().update(HrExpenseSheet {
        rebill_move_id: Some(move_record.id),
        metadata,
        ..sheet
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_expense_sheet",
            record_id: sheet_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "rebill_move_id": move_record.id,
                    "rebill_total": rebill_total,
                    "amount_tax": amount_tax,
                    "amount_total": amount_total,
                })
                .to_string(),
            ),
            changed_fields: vec!["rebill_move_id".into()],
            metadata: None,
        },
    );

    refresh_project_margin_for_projects(ctx, organization_id, company_id, rebill_project_ids);

    Ok(())
}
