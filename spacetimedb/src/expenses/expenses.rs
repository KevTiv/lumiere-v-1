/// Expenses — HrExpense & HrExpenseSheet
///
/// Individual expense lines (receipts) grouped into expense reports (sheets).
/// Sheets can be submitted for approval and then posted as an AccountMove Entry
/// (Dr expense / Cr employee payable) with optional reimbursement clearing.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::chart_of_accounts::{account_account, account_journal};
use crate::accounting::fiscal_periods::ensure_accounting_period_open_for_date;
use crate::accounting::journal_entries::{
    account_move, account_move_line, insert_draft_account_move_line, AccountMove,
    AddAccountMoveLineParams,
};
use crate::accounting::tax_management::{account_tax, account_tax_group};
use crate::core::country_pack::pack_expense_evidence_rules;
use crate::core::organization::{company, company_id_from_scope};
use crate::core::reference::{
    require_active_currency_by_id, require_currency_by_id, resolve_currency_rate_as_of,
};
use crate::expenses::expense_depth::{
    allocations_for_expense, hr_expense_mileage_rate, hr_expense_per_diem_rate,
};
use crate::expenses::expense_wave_d::{
    advance_applied_for_sheet, find_duplicate_by_receipt_content_hash, find_duplicate_expense,
    has_approved_policy_exception, has_pending_policy_exception, hr_expense_policy_exception,
};
use crate::expenses::expense_wave_e::sheet_matched_fx_fee_total;
use crate::helpers::{check_permission, next_doc_number, write_audit_log_v2, AuditLogParams};
use crate::hr::employees::hr_employee;
use crate::inventory::product::product;
use crate::projects::projects::project_project;
use crate::types::{
    AccountMoveState, ExpenseLineKind, ExpensePaymentMode, ExpenseSheetState, ExpenseState,
    MoveType, PaymentState, TaxAmountType, TaxTypeUse,
};
use crate::workflow::action_registry::{
    GuardedActionInput, GuardedActionKey, GUARDED_ACTION_SCHEMA_VERSION,
};
use crate::workflow::approval_gate::{
    request_guarded_action, GuardedActionGateOutcome, RequestGuardedActionParams,
};

// ── Tables ────────────────────────────────────────────────────────────────────

/// HR Expense — A single expense line (receipt/item) submitted by an employee.
#[spacetimedb::table(
    accessor = hr_expense,
    public,
    index(accessor = expense_by_employee, btree(columns = [employee_id])),
    index(accessor = expense_by_sheet, btree(columns = [sheet_id])),
    index(accessor = expense_by_org, btree(columns = [organization_id]))
)]
pub struct HrExpense {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    pub employee_id: u64,
    pub product_id: Option<u64>,
    pub date: Timestamp,
    pub total_amount: f64,
    pub currency_id: u64,
    pub quantity: f64,
    pub unit_amount: f64,
    pub tax_ids: Vec<u64>,
    pub account_id: Option<u64>,
    pub analytic_account_id: Option<u64>,
    pub project_id: Option<u64>,
    pub line_kind: ExpenseLineKind,
    pub mileage_distance: Option<f64>,
    pub mileage_rate_id: Option<u64>,
    pub per_diem_days: Option<f64>,
    pub per_diem_rate_id: Option<u64>,
    pub sheet_id: Option<u64>,
    pub state: ExpenseState,
    pub description: Option<String>,
    pub attachment_ids: Vec<u64>,
    /// Denormalized for bounded SQL queues (`expenses-missing-receipt`).
    pub has_receipt: bool,
    /// Mobile / delayed-sync idempotency key.
    pub client_request_id: Option<String>,
    pub payment_mode: ExpensePaymentMode,
    /// Normalized merchant key for duplicate detection (card feed / OCR).
    pub merchant_key: Option<String>,
    pub fraud_hold: bool,
    pub fraud_reason: Option<String>,
    pub duplicate_of_id: Option<u64>,
    /// Soft hold while a policy exception is pending (or until approved).
    pub policy_hold: bool,
    pub created_at: Timestamp,
}

/// HR Expense Sheet — An expense report grouping multiple expense lines.
#[spacetimedb::table(
    accessor = expense_sheet,
    public,
    index(accessor = sheet_by_employee, btree(columns = [employee_id])),
    index(accessor = sheet_by_state, btree(columns = [state])),
    index(accessor = sheet_by_org, btree(columns = [organization_id]))
)]
pub struct HrExpenseSheet {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    pub employee_id: u64,
    pub state: ExpenseSheetState,
    pub total_amount: f64,
    pub currency_id: u64,
    /// Document → company currency rate snapped at submit (`company = doc * rate`).
    pub currency_rate: f64,
    pub company_currency_id: u64,
    pub accounting_date: Option<Timestamp>,
    pub account_move_id: Option<u64>,
    pub reimbursement_move_id: Option<u64>,
    pub rebill_move_id: Option<u64>,
    pub submitted_by: Option<Identity>,
    pub approver_id: Option<Identity>,
    pub notes: Option<String>,
    pub metadata: Option<String>,
    pub created_at: Timestamp,
}

/// Per-company expense amount caps (optional).
#[spacetimedb::table(
    accessor = hr_expense_policy,
    public,
    index(accessor = expense_policy_by_org, btree(columns = [organization_id])),
    index(accessor = expense_policy_by_company, btree(columns = [company_id]))
)]
pub struct HrExpensePolicy {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub max_line_amount: Option<f64>,
    pub max_sheet_amount: Option<f64>,
    pub active: bool,
    pub metadata: Option<String>,
}

/// Registered receipt / evidence row. Blob bytes live outside reducers; this stores metadata + opaque storage key.
#[spacetimedb::table(
    accessor = hr_expense_receipt,
    public,
    index(accessor = expense_receipt_by_org, btree(columns = [organization_id])),
    index(accessor = expense_receipt_by_company, btree(columns = [company_id])),
    index(accessor = expense_receipt_by_employee, btree(columns = [employee_id]))
)]
pub struct HrExpenseReceipt {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub employee_id: u64,
    pub file_name: Option<String>,
    pub mime_type: Option<String>,
    /// Opaque client/worker key (no blob in reducer).
    pub storage_key: String,
    pub content_hash: Option<String>,
    pub client_request_id: Option<String>,
    pub created_at: Timestamp,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateExpenseParams {
    pub company_id: Option<u64>,
    pub employee_id: u64,
    pub name: String,
    pub date: Timestamp,
    pub unit_amount: f64,
    pub quantity: f64,
    pub currency_id: u64,
    pub product_id: Option<u64>,
    pub description: Option<String>,
    pub tax_ids: Vec<u64>,
    pub account_id: Option<u64>,
    pub analytic_account_id: Option<u64>,
    pub project_id: Option<u64>,
    pub line_kind: ExpenseLineKind,
    pub mileage_distance: Option<f64>,
    pub mileage_rate_id: Option<u64>,
    pub per_diem_days: Option<f64>,
    pub per_diem_rate_id: Option<u64>,
    pub attachment_ids: Vec<u64>,
    pub client_request_id: Option<String>,
    pub payment_mode: ExpensePaymentMode,
    pub merchant_key: Option<String>,
    /// When set, policy cap failures create a pending exception instead of hard-failing.
    pub policy_exception_reason: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateExpenseParams {
    pub company_id: Option<u64>,
    pub name: Option<String>,
    pub unit_amount: Option<f64>,
    pub quantity: Option<f64>,
    pub description: Option<String>,
    pub account_id: Option<u64>,
    pub product_id: Option<u64>,
    pub tax_ids: Option<Vec<u64>>,
    pub payment_mode: Option<ExpensePaymentMode>,
    pub merchant_key: Option<String>,
    pub attachment_ids: Option<Vec<u64>>,
    pub mileage_distance: Option<f64>,
    pub mileage_rate_id: Option<u64>,
    pub per_diem_days: Option<f64>,
    pub per_diem_rate_id: Option<u64>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateExpenseReceiptParams {
    pub company_id: Option<u64>,
    pub employee_id: u64,
    pub file_name: Option<String>,
    pub mime_type: Option<String>,
    pub storage_key: String,
    pub content_hash: Option<String>,
    pub client_request_id: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateExpenseSheetParams {
    pub company_id: Option<u64>,
    pub employee_id: u64,
    pub name: String,
    pub currency_id: u64,
    pub notes: Option<String>,
    pub accounting_date: Option<Timestamp>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RefuseExpenseSheetParams {
    pub reason: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct PostExpenseSheetParams {
    pub journal_id: u64,
    pub payable_account_id: u64,
    pub default_expense_account_id: u64,
    /// Fallback recoverable-tax account when tax groups omit `tax_receivable_account_id`.
    pub default_tax_account_id: Option<u64>,
    /// Credit side for corporate-card lines (required when sheet has card lines).
    pub card_liability_account_id: Option<u64>,
    /// Clearing account for advances applied to this sheet (required when advances applied).
    pub advance_account_id: Option<u64>,
    /// Expense account for cross-border card FX fees (required when matched FX fees > 0).
    pub fx_fee_account_id: Option<u64>,
    /// Optional override; when None, fees are summed from matched card statement lines.
    pub fx_fee_amount: Option<f64>,
    pub accounting_date: Timestamp,
    pub client_request_id: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateExpenseReimbursementParams {
    pub journal_id: u64,
    pub liquidity_account_id: u64,
    pub payable_account_id: u64,
    pub payment_date: Timestamp,
    /// When set, reimburse this amount (`0 < amount ≤ residual`). When `None`, pay full residual.
    pub amount: Option<f64>,
    pub client_request_id: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpsertExpensePolicyParams {
    pub company_id: Option<u64>,
    pub max_line_amount: Option<f64>,
    pub max_sheet_amount: Option<f64>,
    pub active: bool,
    pub metadata: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Every attachment id must reference a real `hr_expense_receipt` for the same org/company/employee.
/// Rejects `0`. Historically stubbed `1` is only accepted when that receipt row actually exists.
pub(crate) fn validate_expense_attachment_ids(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
    attachment_ids: &[u64],
) -> Result<(), String> {
    for &id in attachment_ids {
        if id == 0 {
            return Err("Invalid attachment id 0".to_string());
        }
        let receipt = ctx
            .db
            .hr_expense_receipt()
            .id()
            .find(&id)
            .ok_or_else(|| format!("Receipt attachment {id} not found"))?;
        if receipt.organization_id != organization_id || receipt.company_id != company_id {
            return Err(format!("Receipt {id} does not belong to this company"));
        }
        if receipt.employee_id != employee_id {
            return Err(format!("Receipt {id} does not belong to this employee"));
        }
    }
    Ok(())
}

/// Insert a receipt row (used by create reducer and intent apply). Returns the new id.
pub(crate) fn insert_expense_receipt(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: &CreateExpenseReceiptParams,
) -> Result<u64, String> {
    if params.storage_key.trim().is_empty() {
        return Err("storage_key cannot be empty".to_string());
    }
    if let Some(ref req) = params.client_request_id {
        if !req.is_empty() {
            if let Some(existing) = ctx.db.hr_expense_receipt().iter().find(|r| {
                r.organization_id == organization_id
                    && r.client_request_id.as_deref() == Some(req.as_str())
            }) {
                return Ok(existing.id);
            }
        }
    }
    let emp = ctx
        .db
        .hr_employee()
        .id()
        .find(&params.employee_id)
        .ok_or("Employee not found")?;
    if emp.organization_id != organization_id || emp.company_id != company_id {
        return Err("Employee does not belong to this company".to_string());
    }
    let row = ctx.db.hr_expense_receipt().insert(HrExpenseReceipt {
        id: 0,
        organization_id,
        company_id,
        employee_id: params.employee_id,
        file_name: params.file_name.clone(),
        mime_type: params.mime_type.clone(),
        storage_key: params.storage_key.clone(),
        content_hash: params.content_hash.clone(),
        client_request_id: params.client_request_id.clone(),
        created_at: ctx.timestamp,
    });
    Ok(row.id)
}

fn sheet_lines(ctx: &ReducerContext, sheet_id: u64) -> Vec<HrExpense> {
    ctx.db
        .hr_expense()
        .iter()
        .filter(|e| e.sheet_id == Some(sheet_id))
        .collect()
}

fn sync_line_states(ctx: &ReducerContext, sheet_id: u64, state: ExpenseState) {
    for line in sheet_lines(ctx, sheet_id) {
        ctx.db.hr_expense().id().update(HrExpense {
            state: state.clone(),
            ..line
        });
    }
}

fn recompute_sheet_total(ctx: &ReducerContext, sheet_id: u64) -> f64 {
    sheet_lines(ctx, sheet_id)
        .iter()
        .map(|l| l.total_amount)
        .sum()
}

fn merge_metadata(existing: Option<&str>, patch: serde_json::Value) -> Option<String> {
    let mut map = match existing.and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok()) {
        Some(serde_json::Value::Object(m)) => m,
        _ => serde_json::Map::new(),
    };
    if let serde_json::Value::Object(p) = patch {
        for (k, v) in p {
            map.insert(k, v);
        }
    }
    Some(serde_json::Value::Object(map).to_string())
}

/// Exact JSON string-field match for idempotency keys (never substring / `.contains`).
pub(crate) fn metadata_str_eq(metadata: Option<&str>, key: &str, expected: &str) -> bool {
    let Some(raw) = metadata else {
        return false;
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) else {
        return false;
    };
    v.get(key).and_then(|x| x.as_str()) == Some(expected)
}

/// Debit=credit assert for expense-posted Entry moves (epsilon matches journal post).
fn assert_move_lines_balanced(ctx: &ReducerContext, move_id: u64) -> Result<(), String> {
    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .collect();
    let total_debit: f64 = lines.iter().map(|l| l.debit).sum();
    let total_credit: f64 = lines.iter().map(|l| l.credit).sum();
    if (total_debit - total_credit).abs() > 0.01 {
        return Err(format!(
            "Expense move is not balanced: debit={total_debit} credit={total_credit}"
        ));
    }
    Ok(())
}

fn active_policy_for_company(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
) -> Option<HrExpensePolicy> {
    ctx.db
        .hr_expense_policy()
        .expense_policy_by_company()
        .filter(&company_id)
        .find(|p| p.organization_id == organization_id && p.active)
}

fn product_expense_max_amount(metadata: &Option<String>) -> Option<f64> {
    let raw = metadata.as_deref()?;
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    v.get("expense_max_amount")
        .and_then(|x| x.as_f64())
        .filter(|n| *n > 0.0)
}

/// Returns `Ok(true)` when a policy cap was breached but an exception was requested.
fn enforce_expense_product_policy(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: Option<u64>,
    line_amount: f64,
    allow_exception: bool,
) -> Result<bool, String> {
    let mut needs_exception = false;
    if let Some(pid) = product_id {
        let prod = ctx
            .db
            .product()
            .id()
            .find(&pid)
            .ok_or("Expense product not found")?;
        if prod.organization_id != organization_id {
            return Err("Expense product belongs to a different organization".to_string());
        }
        if !prod.can_be_expensed {
            return Err(format!("Product {} cannot be expensed", prod.name));
        }
        let policy = prod.expense_policy.to_ascii_lowercase();
        if policy == "no" || policy.is_empty() {
            return Err(format!(
                "Product {} expense policy forbids expense claims",
                prod.name
            ));
        }
        if let Some(max) = product_expense_max_amount(&prod.metadata) {
            if line_amount > max + 0.0001 {
                if allow_exception {
                    needs_exception = true;
                } else {
                    return Err(format!(
                        "Expense amount {:.2} exceeds product cap {:.2} for {}",
                        line_amount, max, prod.name
                    ));
                }
            }
        }
    }
    if let Some(pol) = active_policy_for_company(ctx, organization_id, company_id) {
        if let Some(max) = pol.max_line_amount {
            if line_amount > max + 0.0001 {
                if allow_exception {
                    needs_exception = true;
                } else {
                    return Err(format!(
                        "Expense amount {:.2} exceeds company line cap {:.2}",
                        line_amount, max
                    ));
                }
            }
        }
    }
    Ok(needs_exception)
}

fn enforce_sheet_amount_cap(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    sheet_total: f64,
) -> Result<(), String> {
    if let Some(pol) = active_policy_for_company(ctx, organization_id, company_id) {
        if let Some(max) = pol.max_sheet_amount {
            if sheet_total > max + 0.0001 {
                return Err(format!(
                    "Sheet total {:.2} exceeds company sheet cap {:.2}",
                    sheet_total, max
                ));
            }
        }
    }
    Ok(())
}

fn expense_exchange_rate_snapshot(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    currency_id: u64,
) -> Result<(f64, u64, String, String), String> {
    let company_row = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found for expense sheet")?;
    let company_currency_id = company_row.currency_id;
    let from = require_currency_by_id(ctx, currency_id)?.code;
    let to = require_currency_by_id(ctx, company_currency_id)?.code;
    if currency_id == company_currency_id {
        return Ok((1.0, company_currency_id, from, to));
    }
    let rate = resolve_currency_rate_as_of(
        ctx,
        organization_id,
        company_id,
        currency_id,
        company_currency_id,
        ctx.timestamp,
    )?;
    Ok((rate, company_currency_id, from, to))
}

struct TaxRecoveryLine {
    tax_id: u64,
    amount_company: f64,
    account_id: u64,
    label: String,
}

/// Rate is usable when active window covers `at`:
/// `effective_from <= at` (or open) and `effective_to` is None or `>= at`.
fn rate_effective_on(at: Timestamp, from: Option<Timestamp>, to: Option<Timestamp>) -> bool {
    if let Some(f) = from {
        if at.to_micros_since_unix_epoch() < f.to_micros_since_unix_epoch() {
            return false;
        }
    }
    if let Some(t) = to {
        if at.to_micros_since_unix_epoch() > t.to_micros_since_unix_epoch() {
            return false;
        }
    }
    true
}

fn ensure_rate_effective_on(
    at: Timestamp,
    from: Option<Timestamp>,
    to: Option<Timestamp>,
    label: &str,
) -> Result<(), String> {
    if rate_effective_on(at, from, to) {
        Ok(())
    } else {
        Err(format!(
            "{label} is not effective on the expense date (check effective_from/effective_to)"
        ))
    }
}

fn tax_recoverable_account(
    ctx: &ReducerContext,
    tax_group_id: Option<u64>,
    default_tax_account_id: Option<u64>,
) -> Result<u64, String> {
    if let Some(gid) = tax_group_id {
        if let Some(group) = ctx.db.account_tax_group().id().find(&gid) {
            if let Some(aid) = group.tax_receivable_account_id {
                return Ok(aid);
            }
        }
    }
    default_tax_account_id.ok_or_else(|| {
        "Tax recovery requires tax group receivable account or default_tax_account_id".to_string()
    })
}

fn compute_tax_recovery_for_line(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    tax_ids: &[u64],
    base_company: f64,
    default_tax_account_id: Option<u64>,
) -> Result<(f64, f64, Vec<TaxRecoveryLine>), String> {
    // Returns (expense_debit_company, tax_total_company, tax lines).
    // Untaxed expense debit starts as base; price-inclusive taxes reduce it.
    let mut expense_debit = base_company;
    let mut tax_total = 0.0;
    let mut tax_lines = Vec::new();

    for tid in tax_ids {
        let tax = ctx
            .db
            .account_tax()
            .id()
            .find(tid)
            .ok_or_else(|| format!("Tax {tid} not found"))?;
        if tax.organization_id != organization_id {
            return Err(format!("Tax {tid} belongs to a different organization"));
        }
        if tax.company_id != company_id {
            return Err(format!("Tax {tid} does not belong to this company"));
        }
        if !tax.active {
            continue;
        }
        if tax.type_tax_use != TaxTypeUse::Purchase && tax.type_tax_use != TaxTypeUse::None {
            return Err(format!(
                "Tax {} is not a purchase/recoverable tax",
                tax.name
            ));
        }
        let account_id = tax_recoverable_account(ctx, tax.tax_group_id, default_tax_account_id)?;
        validate_account(ctx, company_id, account_id, "Tax recoverable")?;

        let (tax_amt, reduce_base) = match tax.amount_type {
            TaxAmountType::Percent => {
                if tax.price_include {
                    let factor = 1.0 + (tax.amount / 100.0);
                    if factor <= 0.0 {
                        return Err(format!("Invalid inclusive tax rate on {}", tax.name));
                    }
                    let untaxed = base_company / factor;
                    (base_company - untaxed, true)
                } else {
                    (base_company * (tax.amount / 100.0), false)
                }
            }
            TaxAmountType::Fixed => (tax.amount, false),
            TaxAmountType::Division | TaxAmountType::PythonCode => {
                return Err(format!(
                    "Tax {} amount type is not supported on expense post",
                    tax.name
                ));
            }
        };
        if tax_amt < -0.0001 {
            return Err(format!("Tax {} computed a negative amount", tax.name));
        }
        if reduce_base {
            expense_debit = (expense_debit - tax_amt).max(0.0);
        }
        tax_total += tax_amt;
        tax_lines.push(TaxRecoveryLine {
            tax_id: tax.id,
            amount_company: tax_amt,
            account_id,
            label: format!("Tax recovery — {}", tax.name),
        });
    }

    Ok((expense_debit, tax_total, tax_lines))
}

fn employee_remittance_partner(ctx: &ReducerContext, employee_id: u64) -> Option<u64> {
    ctx.db
        .hr_employee()
        .id()
        .find(&employee_id)
        .and_then(|e| e.work_contact_partner_id)
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

// ── Reducers: Expenses ────────────────────────────────────────────────────────

#[reducer]
pub fn create_expense(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateExpenseParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense", "create")?;

    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    require_active_currency_by_id(ctx, params.currency_id)?;
    // EXP-002: Validate employee_id FK.
    let _emp = ctx
        .db
        .hr_employee()
        .id()
        .find(&params.employee_id)
        .ok_or("Employee not found")?;
    if _emp.organization_id != organization_id || _emp.company_id != company_id {
        return Err("Employee does not belong to this company".to_string());
    }

    if let Some(ref req) = params.client_request_id {
        if !req.is_empty()
            && ctx.db.hr_expense().iter().any(|e| {
                e.organization_id == organization_id
                    && e.client_request_id.as_deref() == Some(req.as_str())
            })
        {
            return Ok(());
        }
    }

    if params.name.is_empty() {
        return Err("Expense description cannot be empty".to_string());
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

    let (
        line_kind,
        unit_amount,
        quantity,
        total_amount,
        mileage_distance,
        mileage_rate_id,
        per_diem_days,
        per_diem_rate_id,
    ) = match params.line_kind {
        ExpenseLineKind::Standard => {
            if params.unit_amount < 0.0 {
                return Err("Unit amount cannot be negative".to_string());
            }
            if params.quantity <= 0.0 {
                return Err("Quantity must be positive".to_string());
            }
            let total = params.unit_amount * params.quantity;
            (
                ExpenseLineKind::Standard,
                params.unit_amount,
                params.quantity,
                total,
                None,
                None,
                None,
                None,
            )
        }
        ExpenseLineKind::Mileage => {
            let distance = params
                .mileage_distance
                .filter(|d| *d > 0.0)
                .ok_or("Mileage distance must be positive")?;
            let rate_id = params
                .mileage_rate_id
                .ok_or("mileage_rate_id is required for mileage expenses")?;
            let rate = ctx
                .db
                .hr_expense_mileage_rate()
                .id()
                .find(&rate_id)
                .ok_or("Mileage rate not found")?;
            if rate.organization_id != organization_id || rate.company_id != company_id {
                return Err("Mileage rate does not belong to this company".to_string());
            }
            if !rate.active {
                return Err("Mileage rate is inactive".to_string());
            }
            ensure_rate_effective_on(
                params.date,
                rate.effective_from,
                rate.effective_to,
                "Mileage rate",
            )?;
            if rate.currency_id != params.currency_id {
                return Err("Mileage rate currency must match expense currency".to_string());
            }
            let unit_amount = rate.rate_per_unit;
            let total = distance * unit_amount;
            (
                ExpenseLineKind::Mileage,
                unit_amount,
                distance,
                total,
                Some(distance),
                Some(rate_id),
                None,
                None,
            )
        }
        ExpenseLineKind::PerDiem => {
            let days = params
                .per_diem_days
                .filter(|d| *d > 0.0)
                .ok_or("Per diem days must be positive")?;
            let rate_id = params
                .per_diem_rate_id
                .ok_or("per_diem_rate_id is required for per diem expenses")?;
            let rate = ctx
                .db
                .hr_expense_per_diem_rate()
                .id()
                .find(&rate_id)
                .ok_or("Per diem rate not found")?;
            if rate.organization_id != organization_id || rate.company_id != company_id {
                return Err("Per diem rate does not belong to this company".to_string());
            }
            if !rate.active {
                return Err("Per diem rate is inactive".to_string());
            }
            ensure_rate_effective_on(
                params.date,
                rate.effective_from,
                rate.effective_to,
                "Per diem rate",
            )?;
            if rate.currency_id != params.currency_id {
                return Err("Per diem rate currency must match expense currency".to_string());
            }
            let unit_amount = rate.amount_per_day;
            let total = days * unit_amount;
            (
                ExpenseLineKind::PerDiem,
                unit_amount,
                days,
                total,
                None,
                None,
                Some(days),
                Some(rate_id),
            )
        }
    };

    let allow_exception = params
        .policy_exception_reason
        .as_ref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let cap_exception = enforce_expense_product_policy(
        ctx,
        organization_id,
        company_id,
        params.product_id,
        total_amount,
        allow_exception,
    )?;
    if cap_exception && !allow_exception {
        return Err("Expense exceeds policy caps".to_string());
    }
    // AU pack: entertainment / FBT category products get a soft policy hold.
    let pack_rules = pack_expense_evidence_rules(ctx, organization_id, company_id);
    let fbt_hold = if pack_rules.fbt_entertainment {
        params
            .product_id
            .and_then(|pid| ctx.db.product().id().find(&pid))
            .is_some_and(|prod| {
                let fbt_meta = prod.metadata.as_deref().is_some_and(|m| {
                    m.contains("\"expense_fbt_category\":true")
                        || m.contains("\"expense_fbt_category\": true")
                });
                let p = prod.expense_policy.to_ascii_lowercase();
                fbt_meta || p.contains("fbt") || p.contains("entertainment")
            })
    } else {
        false
    };
    let needs_exception = cap_exception || fbt_hold;
    validate_expense_attachment_ids(
        ctx,
        organization_id,
        company_id,
        params.employee_id,
        &params.attachment_ids,
    )?;
    let has_receipt = !params.attachment_ids.is_empty();
    let merchant_key = params.merchant_key.clone();
    // Prefer receipt content_hash when present; fall back to amount/day/merchant.
    let duplicate_of_id = find_duplicate_by_receipt_content_hash(
        ctx,
        organization_id,
        company_id,
        &params.attachment_ids,
        None,
    )
    .or_else(|| {
        find_duplicate_expense(
            ctx,
            organization_id,
            company_id,
            params.employee_id,
            total_amount,
            params.date,
            merchant_key.as_deref(),
            None,
        )
    });
    let fraud_hold = duplicate_of_id.is_some();
    let fraud_reason = duplicate_of_id.map(|id| format!("Possible duplicate of expense {id}"));
    let expense = ctx.db.hr_expense().insert(HrExpense {
        id: 0,
        organization_id,
        company_id,
        name: params.name,
        employee_id: params.employee_id,
        product_id: params.product_id,
        date: params.date,
        total_amount,
        currency_id: params.currency_id,
        quantity,
        unit_amount,
        tax_ids: params.tax_ids,
        account_id: params.account_id,
        analytic_account_id: params.analytic_account_id,
        project_id: params.project_id,
        line_kind,
        mileage_distance,
        mileage_rate_id,
        per_diem_days,
        per_diem_rate_id,
        sheet_id: None,
        state: ExpenseState::Draft,
        description: params.description,
        attachment_ids: params.attachment_ids,
        has_receipt,
        client_request_id: params.client_request_id,
        payment_mode: params.payment_mode,
        merchant_key,
        fraud_hold,
        fraud_reason,
        duplicate_of_id,
        policy_hold: needs_exception,
        created_at: ctx.timestamp,
    });
    if needs_exception {
        let reason = params.policy_exception_reason.clone().unwrap_or_else(|| {
            if fbt_hold {
                "AU FBT / entertainment category hold".into()
            } else {
                "Over policy cap".into()
            }
        });
        ctx.db.hr_expense_policy_exception().insert(
            crate::expenses::expense_wave_d::HrExpensePolicyException {
                id: 0,
                organization_id,
                company_id,
                expense_id: expense.id,
                reason,
                state: crate::types::ExpensePolicyExceptionState::Pending,
                requested_by: ctx.sender(),
                approved_by: None,
                created_at: ctx.timestamp,
                resolved_at: None,
                metadata: None,
            },
        );
    }
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_expense",
            record_id: expense.id,
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
pub fn update_expense(
    ctx: &ReducerContext,
    organization_id: u64,
    expense_id: u64,
    params: UpdateExpenseParams,
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
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    if expense.company_id != company_id {
        return Err("Expense does not belong to this company".to_string());
    }
    if expense.state != ExpenseState::Draft {
        return Err("Only draft expenses can be edited".to_string());
    }

    let (
        new_unit,
        new_qty,
        total_amount,
        mileage_distance,
        mileage_rate_id,
        per_diem_days,
        per_diem_rate_id,
    ) = match expense.line_kind {
        ExpenseLineKind::Standard => {
            let new_unit = params.unit_amount.unwrap_or(expense.unit_amount);
            let new_qty = params.quantity.unwrap_or(expense.quantity);
            if new_unit < 0.0 {
                return Err("Unit amount cannot be negative".to_string());
            }
            if new_qty <= 0.0 {
                return Err("Quantity must be positive".to_string());
            }
            (
                new_unit,
                new_qty,
                new_unit * new_qty,
                None,
                None,
                None,
                None,
            )
        }
        ExpenseLineKind::Mileage => {
            // Kind-safe: totals always come from rate × distance.
            let distance = params
                .mileage_distance
                .or(expense.mileage_distance)
                .filter(|d| *d > 0.0)
                .ok_or("Mileage distance must be positive")?;
            let rate_id = params
                .mileage_rate_id
                .or(expense.mileage_rate_id)
                .ok_or("mileage_rate_id is required for mileage expenses")?;
            let rate = ctx
                .db
                .hr_expense_mileage_rate()
                .id()
                .find(&rate_id)
                .ok_or("Mileage rate not found")?;
            if rate.organization_id != organization_id || rate.company_id != company_id {
                return Err("Mileage rate does not belong to this company".to_string());
            }
            if !rate.active {
                return Err("Mileage rate is inactive".to_string());
            }
            ensure_rate_effective_on(
                expense.date,
                rate.effective_from,
                rate.effective_to,
                "Mileage rate",
            )?;
            if rate.currency_id != expense.currency_id {
                return Err("Mileage rate currency must match expense currency".to_string());
            }
            let unit_amount = rate.rate_per_unit;
            // Reject unit/qty-only edits that would diverge from rate × distance.
            if params.mileage_distance.is_none() && params.mileage_rate_id.is_none() {
                if let Some(u) = params.unit_amount {
                    if (u - unit_amount).abs() > 0.0001 {
                        return Err(
                            "Mileage expenses must be updated via mileage_distance/mileage_rate_id, not unit/qty"
                                .to_string(),
                        );
                    }
                }
                if let Some(q) = params.quantity {
                    if (q - distance).abs() > 0.0001 {
                        return Err(
                            "Mileage expenses must be updated via mileage_distance/mileage_rate_id, not unit/qty"
                                .to_string(),
                        );
                    }
                }
            }
            (
                unit_amount,
                distance,
                distance * unit_amount,
                Some(distance),
                Some(rate_id),
                None,
                None,
            )
        }
        ExpenseLineKind::PerDiem => {
            let days = params
                .per_diem_days
                .or(expense.per_diem_days)
                .filter(|d| *d > 0.0)
                .ok_or("Per diem days must be positive")?;
            let rate_id = params
                .per_diem_rate_id
                .or(expense.per_diem_rate_id)
                .ok_or("per_diem_rate_id is required for per diem expenses")?;
            let rate = ctx
                .db
                .hr_expense_per_diem_rate()
                .id()
                .find(&rate_id)
                .ok_or("Per diem rate not found")?;
            if rate.organization_id != organization_id || rate.company_id != company_id {
                return Err("Per diem rate does not belong to this company".to_string());
            }
            if !rate.active {
                return Err("Per diem rate is inactive".to_string());
            }
            ensure_rate_effective_on(
                expense.date,
                rate.effective_from,
                rate.effective_to,
                "Per diem rate",
            )?;
            if rate.currency_id != expense.currency_id {
                return Err("Per diem rate currency must match expense currency".to_string());
            }
            let unit_amount = rate.amount_per_day;
            if params.per_diem_days.is_none() && params.per_diem_rate_id.is_none() {
                if let Some(u) = params.unit_amount {
                    if (u - unit_amount).abs() > 0.0001 {
                        return Err(
                            "Per diem expenses must be updated via per_diem_days/per_diem_rate_id, not unit/qty"
                                .to_string(),
                        );
                    }
                }
                if let Some(q) = params.quantity {
                    if (q - days).abs() > 0.0001 {
                        return Err(
                            "Per diem expenses must be updated via per_diem_days/per_diem_rate_id, not unit/qty"
                                .to_string(),
                        );
                    }
                }
            }
            (
                unit_amount,
                days,
                days * unit_amount,
                None,
                None,
                Some(days),
                Some(rate_id),
            )
        }
    };

    let product_id = params.product_id.or(expense.product_id);
    let allow_exception = has_approved_policy_exception(ctx, expense_id)
        || has_pending_policy_exception(ctx, expense_id);
    enforce_expense_product_policy(
        ctx,
        organization_id,
        company_id,
        product_id,
        total_amount,
        allow_exception,
    )?;
    let attachment_ids = params
        .attachment_ids
        .clone()
        .unwrap_or_else(|| expense.attachment_ids.clone());
    validate_expense_attachment_ids(
        ctx,
        organization_id,
        company_id,
        expense.employee_id,
        &attachment_ids,
    )?;
    let has_receipt = !attachment_ids.is_empty();
    let mut changed = vec!["total_amount".to_string()];
    if params.attachment_ids.is_some() {
        changed.push("attachment_ids".to_string());
        changed.push("has_receipt".to_string());
    }
    if params.product_id.is_some() {
        changed.push("product_id".to_string());
    }
    if params.tax_ids.is_some() {
        changed.push("tax_ids".to_string());
    }
    if params.payment_mode.is_some() {
        changed.push("payment_mode".to_string());
    }
    if params.merchant_key.is_some() {
        changed.push("merchant_key".to_string());
    }
    if params.mileage_distance.is_some() || params.mileage_rate_id.is_some() {
        changed.push("mileage_distance".to_string());
        changed.push("mileage_rate_id".to_string());
    }
    if params.per_diem_days.is_some() || params.per_diem_rate_id.is_some() {
        changed.push("per_diem_days".to_string());
        changed.push("per_diem_rate_id".to_string());
    }
    ctx.db.hr_expense().id().update(HrExpense {
        name: params.name.unwrap_or(expense.name),
        unit_amount: new_unit,
        quantity: new_qty,
        total_amount,
        mileage_distance,
        mileage_rate_id,
        per_diem_days,
        per_diem_rate_id,
        description: params.description.or(expense.description),
        account_id: params.account_id.or(expense.account_id),
        product_id,
        tax_ids: params.tax_ids.unwrap_or(expense.tax_ids),
        payment_mode: params.payment_mode.unwrap_or(expense.payment_mode),
        merchant_key: params.merchant_key.or(expense.merchant_key),
        attachment_ids,
        has_receipt,
        ..expense
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_expense",
            record_id: expense_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: changed,
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn create_expense_receipt(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateExpenseReceiptParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense", "create")?;
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    let receipt_id = insert_expense_receipt(ctx, organization_id, company_id, &params)?;
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_expense_receipt",
            record_id: receipt_id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "employee_id": params.employee_id,
                    "storage_key": params.storage_key,
                    "client_request_id": params.client_request_id,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "employee_id".to_string(),
                "storage_key".to_string(),
                "client_request_id".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn submit_expense(
    ctx: &ReducerContext,
    organization_id: u64,
    expense_id: u64,
    sheet_id: u64,
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
        return Err("Only draft expenses can be submitted".to_string());
    }
    validate_expense_attachment_ids(
        ctx,
        organization_id,
        expense.company_id,
        expense.employee_id,
        &expense.attachment_ids,
    )?;
    let sheet = ctx
        .db
        .expense_sheet()
        .id()
        .find(&sheet_id)
        .ok_or("Expense sheet not found")?;
    if sheet.organization_id != organization_id {
        return Err("Expense sheet belongs to a different organization".to_string());
    }
    if sheet.company_id != expense.company_id {
        return Err("Expense and sheet must belong to the same company".to_string());
    }
    if sheet.employee_id != expense.employee_id {
        return Err("Expense and sheet must belong to the same employee".to_string());
    }
    if sheet.currency_id != expense.currency_id {
        return Err("Expense and sheet currencies must match".to_string());
    }
    if !matches!(
        sheet.state,
        ExpenseSheetState::Draft | ExpenseSheetState::Submitted
    ) {
        return Err("Expenses can only be added to draft or submitted sheets".to_string());
    }
    let company_id = expense.company_id;
    ctx.db.hr_expense().id().update(HrExpense {
        sheet_id: Some(sheet_id),
        state: ExpenseState::Submitted,
        ..expense
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_expense",
            record_id: expense_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["sheet_id".to_string(), "state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

// ── Reducers: Expense Sheets ──────────────────────────────────────────────────

#[reducer]
pub fn create_expense_sheet(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateExpenseSheetParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense_sheet", "create")?;

    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    require_active_currency_by_id(ctx, params.currency_id)?;
    // EXP-002: Validate employee_id FK.
    let _emp = ctx
        .db
        .hr_employee()
        .id()
        .find(&params.employee_id)
        .ok_or("Employee not found")?;
    if _emp.organization_id != organization_id || _emp.company_id != company_id {
        return Err("Employee does not belong to this company".to_string());
    }

    if params.name.is_empty() {
        return Err("Expense sheet name cannot be empty".to_string());
    }
    let company_row = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;
    let sheet = ctx.db.expense_sheet().insert(HrExpenseSheet {
        id: 0,
        organization_id,
        company_id,
        name: params.name,
        employee_id: params.employee_id,
        state: ExpenseSheetState::Draft,
        total_amount: 0.0,
        currency_id: params.currency_id,
        currency_rate: 1.0,
        company_currency_id: company_row.currency_id,
        accounting_date: params.accounting_date,
        account_move_id: None,
        reimbursement_move_id: None,
        rebill_move_id: None,
        submitted_by: None,
        approver_id: None,
        notes: params.notes,
        metadata: None,
        created_at: ctx.timestamp,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_expense_sheet",
            record_id: sheet.id,
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
pub fn submit_expense_sheet(
    ctx: &ReducerContext,
    organization_id: u64,
    sheet_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense_sheet", "update")?;
    let sheet = ctx
        .db
        .expense_sheet()
        .id()
        .find(&sheet_id)
        .ok_or("Expense sheet not found")?;
    if sheet.organization_id != organization_id {
        return Err("Expense sheet belongs to a different organization".to_string());
    }
    if sheet.state != ExpenseSheetState::Draft {
        return Err("Only draft sheets can be submitted".to_string());
    }
    let lines = sheet_lines(ctx, sheet_id);
    if lines.is_empty() {
        return Err("Cannot submit an empty expense sheet".to_string());
    }
    let pack_rules = pack_expense_evidence_rules(ctx, organization_id, sheet.company_id);
    for line in &lines {
        let is_standard = matches!(line.line_kind, ExpenseLineKind::Standard);
        // Wave A baseline: Standard lines need receipts. Pack flag can only tighten.
        let receipt_required = is_standard || pack_rules.require_receipt;
        if receipt_required && (line.attachment_ids.is_empty() || !line.has_receipt) {
            return Err(format!(
                "Expense {} is missing receipt attachments",
                line.id
            ));
        }
        validate_expense_attachment_ids(
            ctx,
            organization_id,
            sheet.company_id,
            line.employee_id,
            &line.attachment_ids,
        )?;
        if pack_rules.require_tax_ids && is_standard && line.tax_ids.is_empty() {
            return Err(format!(
                "Expense {} requires tax evidence (country pack)",
                line.id
            ));
        }
        if line.fraud_hold {
            return Err(format!(
                "Expense {} is on fraud hold{}",
                line.id,
                line.fraud_reason
                    .as_ref()
                    .map(|r| format!(": {r}"))
                    .unwrap_or_default()
            ));
        }
        if line.policy_hold && !has_approved_policy_exception(ctx, line.id) {
            return Err(format!(
                "Expense {} has a pending policy exception and cannot be submitted",
                line.id
            ));
        }
        if line.currency_id != sheet.currency_id {
            return Err(format!(
                "Expense {} currency does not match sheet currency",
                line.id
            ));
        }
        if line.company_id != sheet.company_id || line.employee_id != sheet.employee_id {
            return Err(format!(
                "Expense {} does not match sheet company/employee",
                line.id
            ));
        }
        let allow_exception = has_approved_policy_exception(ctx, line.id);
        enforce_expense_product_policy(
            ctx,
            organization_id,
            sheet.company_id,
            line.product_id,
            line.total_amount,
            allow_exception,
        )?;
    }
    let total_amount: f64 = lines.iter().map(|l| l.total_amount).sum();
    if total_amount <= 0.0 {
        return Err("Expense sheet total must be positive".to_string());
    }
    let company_id = sheet.company_id;
    enforce_sheet_amount_cap(ctx, organization_id, company_id, total_amount)?;
    let (currency_rate, company_currency_id, from_ccy, to_ccy) =
        expense_exchange_rate_snapshot(ctx, organization_id, company_id, sheet.currency_id)?;
    let metadata = merge_metadata(
        sheet.metadata.as_deref(),
        serde_json::json!({
            "fx": {
                "rate": currency_rate,
                "from": from_ccy,
                "to": to_ccy,
                "snapped_at": "submit",
            }
        }),
    );
    ctx.db.expense_sheet().id().update(HrExpenseSheet {
        total_amount,
        currency_rate,
        company_currency_id,
        state: ExpenseSheetState::Submitted,
        submitted_by: Some(ctx.sender()),
        metadata,
        ..sheet
    });
    sync_line_states(ctx, sheet_id, ExpenseState::Submitted);
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
                    "state": "Submitted",
                    "total_amount": total_amount,
                    "currency_rate": currency_rate,
                    "company_currency_id": company_currency_id,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "total_amount".to_string(),
                "state".to_string(),
                "submitted_by".to_string(),
                "currency_rate".to_string(),
                "company_currency_id".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn approve_expense_sheet(
    ctx: &ReducerContext,
    organization_id: u64,
    sheet_id: u64,
) -> Result<(), String> {
    approve_expense_sheet_impl(ctx, organization_id, sheet_id, false)
}

pub fn approve_expense_sheet_impl(
    ctx: &ReducerContext,
    organization_id: u64,
    sheet_id: u64,
    skip_approval_check: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense_sheet", "approve")?;
    let sheet = ctx
        .db
        .expense_sheet()
        .id()
        .find(&sheet_id)
        .ok_or("Expense sheet not found")?;
    if sheet.organization_id != organization_id {
        return Err("Expense sheet belongs to a different organization".to_string());
    }
    // EXP-007: Validate that the approver identity is an active hr_employee in this org.
    let is_org_employee = ctx
        .db
        .hr_employee()
        .employee_by_org()
        .filter(&organization_id)
        .any(|e| e.user_id == Some(ctx.sender()));
    if !is_org_employee {
        return Err("Approver must be an employee of this organization".to_string());
    }
    if sheet.state != ExpenseSheetState::Submitted {
        return Err("Only submitted sheets can be approved".to_string());
    }
    if !skip_approval_check {
        if let Some(submitter) = sheet.submitted_by {
            if submitter == ctx.sender() {
                return Err("Submitter cannot approve their own expense sheet (SoD)".to_string());
            }
        }
        if matches!(
            request_guarded_action(
                ctx,
                organization_id,
                RequestGuardedActionParams {
                    company_id: sheet.company_id,
                    action: GuardedActionKey::ApproveExpenseSheet,
                    action_version: GUARDED_ACTION_SCHEMA_VERSION,
                    input: GuardedActionInput::ApproveExpenseSheet { sheet_id },
                    idempotency_key: format!("approve-expense-sheet:{sheet_id}"),
                    correlation_id: format!("expense-sheet:{sheet_id}:approve"),
                    causation_id: None,
                },
            )?,
            GuardedActionGateOutcome::HumanTaskCreated { .. }
        ) {
            return Ok(());
        }
    }

    let company_id = sheet.company_id;
    ctx.db.expense_sheet().id().update(HrExpenseSheet {
        state: ExpenseSheetState::Approved,
        approver_id: Some(ctx.sender()),
        ..sheet
    });
    sync_line_states(ctx, sheet_id, ExpenseState::Approved);
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_expense_sheet",
            record_id: sheet_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "Submitted" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "Approved" }).to_string()),
            changed_fields: vec!["state".to_string(), "approver_id".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn refuse_expense_sheet(
    ctx: &ReducerContext,
    organization_id: u64,
    sheet_id: u64,
    params: RefuseExpenseSheetParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense_sheet", "approve")?;
    let sheet = ctx
        .db
        .expense_sheet()
        .id()
        .find(&sheet_id)
        .ok_or("Expense sheet not found")?;
    if sheet.organization_id != organization_id {
        return Err("Expense sheet belongs to a different organization".to_string());
    }
    if sheet.state != ExpenseSheetState::Submitted {
        return Err("Only submitted sheets can be refused".to_string());
    }
    let company_id = sheet.company_id;
    let notes = match (params.reason, sheet.notes.clone()) {
        (Some(reason), Some(existing)) => Some(format!("{existing}\nRefused: {reason}")),
        (Some(reason), None) => Some(format!("Refused: {reason}")),
        (None, existing) => existing,
    };
    ctx.db.expense_sheet().id().update(HrExpenseSheet {
        state: ExpenseSheetState::Refused,
        notes,
        ..sheet
    });
    // Lines return to Draft so the employee can edit and resubmit.
    for line in sheet_lines(ctx, sheet_id) {
        ctx.db.hr_expense().id().update(HrExpense {
            state: ExpenseState::Draft,
            sheet_id: None,
            ..line
        });
    }
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_expense_sheet",
            record_id: sheet_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "Submitted" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "Refused" }).to_string()),
            changed_fields: vec!["state".to_string(), "notes".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn post_expense_sheet(
    ctx: &ReducerContext,
    organization_id: u64,
    sheet_id: u64,
    params: PostExpenseSheetParams,
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

    if let Some(existing_move) = sheet.account_move_id {
        if let Some(req) = params.client_request_id.as_ref() {
            if metadata_str_eq(sheet.metadata.as_deref(), "client_request_id", req) {
                return Ok(());
            }
        }
        return Err(format!(
            "Expense sheet already posted (account_move_id={existing_move})"
        ));
    }

    if sheet.state != ExpenseSheetState::Approved {
        return Err("Only approved sheets can be posted".to_string());
    }

    let company_id = sheet.company_id;
    ensure_accounting_period_open_for_date(ctx, company_id, params.accounting_date)?;
    if params.payable_account_id == params.default_expense_account_id {
        return Err("Expense and payable accounts must differ".to_string());
    }
    validate_account(ctx, company_id, params.payable_account_id, "Payable")?;
    validate_account(
        ctx,
        company_id,
        params.default_expense_account_id,
        "Expense",
    )?;
    if let Some(tax_acct) = params.default_tax_account_id {
        validate_account(ctx, company_id, tax_acct, "Tax recoverable")?;
        if tax_acct == params.payable_account_id {
            return Err("Tax and payable accounts must differ".to_string());
        }
    }
    if let Some(card_acct) = params.card_liability_account_id {
        validate_account(ctx, company_id, card_acct, "Card liability")?;
        if card_acct == params.payable_account_id || card_acct == params.default_expense_account_id
        {
            return Err("Card liability account must differ from expense/payable".to_string());
        }
    }
    if let Some(adv_acct) = params.advance_account_id {
        validate_account(ctx, company_id, adv_acct, "Advance")?;
    }
    if let Some(fx_acct) = params.fx_fee_account_id {
        validate_account(ctx, company_id, fx_acct, "FX fee")?;
    }

    let journal = ctx
        .db
        .account_journal()
        .id()
        .find(&params.journal_id)
        .ok_or("Journal not found")?;
    if journal.company_id != company_id {
        return Err("Journal does not belong to this company".to_string());
    }

    let lines = sheet_lines(ctx, sheet_id);
    if lines.is_empty() {
        return Err("Cannot post an empty expense sheet".to_string());
    }
    let total_doc = recompute_sheet_total(ctx, sheet_id);
    if (total_doc - sheet.total_amount).abs() > 0.0001 {
        return Err(format!(
            "Sheet total {:.2} does not match line sum {:.2}",
            sheet.total_amount, total_doc
        ));
    }
    if total_doc <= 0.0 {
        return Err("Expense sheet total must be positive".to_string());
    }

    let rate = if sheet.currency_rate > 0.0 {
        sheet.currency_rate
    } else {
        1.0
    };
    let company_currency_id = if sheet.company_currency_id > 0 {
        sheet.company_currency_id
    } else {
        ctx.db
            .company()
            .id()
            .find(&company_id)
            .map(|c| c.currency_id)
            .unwrap_or(sheet.currency_id)
    };
    let partner_id = employee_remittance_partner(ctx, sheet.employee_id);

    let mut untaxed_company = 0.0;
    let mut tax_company = 0.0;
    let mut out_of_pocket_company = 0.0;
    let mut card_company = 0.0;
    let mut prepared_expense_lines: Vec<(
        u64,
        String,
        f64,
        Option<u64>,
        Option<u64>,
        Vec<u64>,
        f64,
        f64,
    )> = Vec::new();
    let mut prepared_tax_lines: Vec<TaxRecoveryLine> = Vec::new();

    for line in &lines {
        if line.fraud_hold {
            return Err(format!(
                "Cannot post sheet while expense {} is on fraud hold",
                line.id
            ));
        }
        let account_id = line.account_id.unwrap_or(params.default_expense_account_id);
        validate_account(ctx, company_id, account_id, "Expense line")?;
        let base_company = line.total_amount * rate;
        let (expense_debit, line_tax, tax_lines) = compute_tax_recovery_for_line(
            ctx,
            organization_id,
            company_id,
            &line.tax_ids,
            base_company,
            params.default_tax_account_id,
        )?;
        let line_total_company = expense_debit + line_tax;
        untaxed_company += expense_debit;
        tax_company += line_tax;
        match line.payment_mode {
            ExpensePaymentMode::CorporateCard => card_company += line_total_company,
            ExpensePaymentMode::OutOfPocket => out_of_pocket_company += line_total_company,
        }
        let allocs = allocations_for_expense(ctx, line.id);
        if allocs.is_empty() {
            prepared_expense_lines.push((
                account_id,
                line.name.clone(),
                expense_debit,
                line.product_id,
                line.analytic_account_id,
                line.tax_ids.clone(),
                line.quantity,
                line.unit_amount * rate,
            ));
            prepared_tax_lines.extend(tax_lines);
        } else {
            let mut allocated = 0.0;
            for (i, alloc) in allocs.iter().enumerate() {
                let mut share_debit = expense_debit * (alloc.share_percent / 100.0);
                // Last share absorbs rounding residue.
                if i + 1 == allocs.len() {
                    share_debit = (expense_debit - allocated).max(0.0);
                }
                allocated += share_debit;
                let analytic = alloc.analytic_account_id.or(line.analytic_account_id);
                prepared_expense_lines.push((
                    account_id,
                    format!("{} ({:.0}%)", line.name, alloc.share_percent),
                    share_debit,
                    line.product_id,
                    analytic,
                    line.tax_ids.clone(),
                    line.quantity * (alloc.share_percent / 100.0),
                    line.unit_amount * rate,
                ));
            }
            // Split tax recovery by the same share_percent rule (100% invariant).
            for tax_line in tax_lines {
                let mut tax_allocated = 0.0;
                for (i, alloc) in allocs.iter().enumerate() {
                    let mut share_tax = tax_line.amount_company * (alloc.share_percent / 100.0);
                    if i + 1 == allocs.len() {
                        share_tax = (tax_line.amount_company - tax_allocated).max(0.0);
                    }
                    tax_allocated += share_tax;
                    prepared_tax_lines.push(TaxRecoveryLine {
                        tax_id: tax_line.tax_id,
                        amount_company: share_tax,
                        account_id: tax_line.account_id,
                        label: format!("{} ({:.0}%)", tax_line.label, alloc.share_percent),
                    });
                }
            }
        }
    }

    let total_company = untaxed_company + tax_company;
    if total_company <= 0.0 {
        return Err("Posted expense total in company currency must be positive".to_string());
    }
    if card_company > 0.0 && params.card_liability_account_id.is_none() {
        return Err(
            "card_liability_account_id is required when posting corporate-card lines".to_string(),
        );
    }
    let advance_applied_doc = advance_applied_for_sheet(ctx, sheet_id);
    let advance_applied_company = advance_applied_doc * rate;
    if advance_applied_company > 0.0 && params.advance_account_id.is_none() {
        return Err("advance_account_id is required when advances are applied".to_string());
    }
    if advance_applied_company > out_of_pocket_company + 0.0001 {
        return Err(format!(
            "Applied advances {:.2} exceed out-of-pocket total {:.2}",
            advance_applied_company, out_of_pocket_company
        ));
    }
    let payable_credit = (out_of_pocket_company - advance_applied_company).max(0.0);
    let matched_fx_fee = sheet_matched_fx_fee_total(ctx, sheet_id);
    let fx_fee_company = params.fx_fee_amount.unwrap_or(matched_fx_fee).max(0.0);
    if fx_fee_company > 0.0 && params.fx_fee_account_id.is_none() {
        return Err(
            "fx_fee_account_id is required when posting cross-border card FX fees".to_string(),
        );
    }
    if fx_fee_company > 0.0 && card_company <= 0.0 {
        return Err("FX fees require corporate-card lines on the sheet".to_string());
    }
    let total_doc_with_tax = if rate > 0.0 {
        total_company / rate
    } else {
        total_doc
    };
    // FX fee is company-currency expense + additional card liability.
    let posted_total_company = total_company + fx_fee_company;
    let card_credit_with_fee = card_company + fx_fee_company;

    let origin = format!("EXP{sheet_id}");
    let name = next_doc_number(ctx, "EXP");
    let currency_id = sheet.currency_id;

    let move_record = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: name.clone(),
        ref_: Some(sheet.name.clone()),
        move_type: MoveType::Entry,
        auto_post: false,
        state: AccountMoveState::Draft,
        date: params.accounting_date,
        invoice_date: Some(params.accounting_date),
        invoice_date_due: None,
        invoice_payment_term_id: None,
        invoice_origin: Some(origin.clone()),
        invoice_partner_display_name: None,
        invoice_cash_rounding_id: None,
        payment_reference: Some(origin.clone()),
        partner_shipping_id: None,
        sale_order_id: None,
        partner_id,
        commercial_partner_id: partner_id,
        partner_bank_id: None,
        fiscal_position_id: None,
        invoice_user_id: Some(ctx.sender()),
        invoice_incoterm_id: None,
        incoterm_location: None,
        campaign_id: None,
        source_id: None,
        medium_id: None,
        company_id,
        journal_id: params.journal_id,
        currency_id,
        company_currency_id,
        amount_untaxed: untaxed_company + fx_fee_company,
        amount_tax: tax_company,
        amount_total: posted_total_company,
        amount_residual: posted_total_company,
        amount_untaxed_signed: untaxed_company + fx_fee_company,
        amount_tax_signed: tax_company,
        amount_total_signed: posted_total_company,
        amount_total_in_currency_signed: total_doc_with_tax
            + if rate > 0.0 {
                fx_fee_company / rate
            } else {
                fx_fee_company
            },
        amount_residual_signed: posted_total_company,
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
                "client_request_id": params.client_request_id,
                "currency_rate": rate,
                "fx_fee_company": fx_fee_company,
            })
            .to_string(),
        ),
    });

    let mut seq = 1u32;
    for (
        account_id,
        line_name,
        expense_debit,
        product_id,
        analytic_account_id,
        tax_ids,
        quantity,
        price_unit,
    ) in prepared_expense_lines
    {
        let mut line_params = empty_line_params(account_id, line_name, expense_debit, 0.0, seq);
        line_params.product_id = product_id;
        line_params.analytic_account_id = analytic_account_id;
        line_params.tax_ids = tax_ids;
        line_params.quantity = quantity;
        line_params.price_unit = price_unit;
        line_params.partner_id = partner_id;
        insert_draft_account_move_line(ctx, &move_record, line_params)?;
        seq += 1;
    }
    for tax_line in prepared_tax_lines {
        let mut line_params = empty_line_params(
            tax_line.account_id,
            tax_line.label,
            tax_line.amount_company,
            0.0,
            seq,
        );
        line_params.tax_line_id = Some(tax_line.tax_id);
        line_params.partner_id = partner_id;
        insert_draft_account_move_line(ctx, &move_record, line_params)?;
        seq += 1;
    }
    if payable_credit > 0.0001 {
        let mut payable_params = empty_line_params(
            params.payable_account_id,
            format!("Employee payable — {}", sheet.name),
            0.0,
            payable_credit,
            seq,
        );
        payable_params.partner_id = partner_id;
        insert_draft_account_move_line(ctx, &move_record, payable_params)?;
        seq += 1;
    }
    if fx_fee_company > 0.0001 {
        let fx_acct = params
            .fx_fee_account_id
            .ok_or("fx_fee_account_id is required")?;
        let mut fx_params = empty_line_params(
            fx_acct,
            format!("Card FX fee — {}", sheet.name),
            fx_fee_company,
            0.0,
            seq,
        );
        fx_params.partner_id = partner_id;
        insert_draft_account_move_line(ctx, &move_record, fx_params)?;
        seq += 1;
    }
    if card_credit_with_fee > 0.0001 {
        let card_acct = params
            .card_liability_account_id
            .ok_or("card_liability_account_id is required")?;
        let mut card_params = empty_line_params(
            card_acct,
            format!("Corporate card liability — {}", sheet.name),
            0.0,
            card_credit_with_fee,
            seq,
        );
        card_params.partner_id = partner_id;
        insert_draft_account_move_line(ctx, &move_record, card_params)?;
        seq += 1;
    }
    if advance_applied_company > 0.0001 {
        let adv_acct = params
            .advance_account_id
            .ok_or("advance_account_id is required")?;
        let mut adv_params = empty_line_params(
            adv_acct,
            format!("Expense advance applied — {}", sheet.name),
            0.0,
            advance_applied_company,
            seq,
        );
        adv_params.partner_id = partner_id;
        insert_draft_account_move_line(ctx, &move_record, adv_params)?;
    }

    assert_move_lines_balanced(ctx, move_record.id)?;

    // Mark move posted in-txn (Entry path — amounts already set).
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

    let metadata = merge_metadata(
        sheet.metadata.as_deref(),
        serde_json::json!({
            "client_request_id": params.client_request_id,
            "post_origin": origin,
            "posted_untaxed_company": untaxed_company,
            "posted_tax_company": tax_company,
            "posted_total_company": total_company,
            "posted_payable_company": payable_credit,
            "posted_card_liability_company": card_company,
            "posted_advance_company": advance_applied_company,
        }),
    );

    ctx.db.expense_sheet().id().update(HrExpenseSheet {
        state: ExpenseSheetState::Posted,
        accounting_date: Some(params.accounting_date),
        account_move_id: Some(move_record.id),
        total_amount: total_doc,
        company_currency_id,
        currency_rate: rate,
        metadata,
        ..sheet
    });
    sync_line_states(ctx, sheet_id, ExpenseState::Posted);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_expense_sheet",
            record_id: sheet_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "Approved" }).to_string()),
            new_values: Some(
                serde_json::json!({
                    "state": "Posted",
                    "account_move_id": move_record.id,
                    "amount_total_company": total_company,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "state".to_string(),
                "accounting_date".to_string(),
                "account_move_id".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn create_expense_reimbursement_payment(
    ctx: &ReducerContext,
    organization_id: u64,
    sheet_id: u64,
    params: CreateExpenseReimbursementParams,
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
    if sheet.state != ExpenseSheetState::Posted {
        return Err("Only posted sheets can be reimbursed".to_string());
    }
    let move_id = sheet
        .account_move_id
        .ok_or("Posted sheet is missing account_move_id")?;
    if let Some(req) = params.client_request_id.as_ref() {
        if metadata_str_eq(
            sheet.metadata.as_deref(),
            "reimbursement_client_request_id",
            req,
        ) {
            return Ok(());
        }
    }

    let company_id = sheet.company_id;
    ensure_accounting_period_open_for_date(ctx, company_id, params.payment_date)?;
    if params.payable_account_id == params.liquidity_account_id {
        return Err("Payable and liquidity accounts must differ".to_string());
    }
    validate_account(ctx, company_id, params.payable_account_id, "Payable")?;
    validate_account(ctx, company_id, params.liquidity_account_id, "Liquidity")?;
    let journal = ctx
        .db
        .account_journal()
        .id()
        .find(&params.journal_id)
        .ok_or("Journal not found")?;
    if journal.company_id != company_id {
        return Err("Journal does not belong to this company".to_string());
    }

    let source_move = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("Source account move not found")?;
    if source_move.company_id != company_id {
        return Err("Source move does not belong to this company".to_string());
    }
    // Residual in company currency (includes tax recovery). Full pay when amount is None.
    let residual = if source_move.amount_residual > 0.0 {
        source_move.amount_residual
    } else if sheet.reimbursement_move_id.is_none() {
        source_move.amount_total
    } else {
        0.0
    };
    if residual <= 0.0 {
        return Err("Expense sheet already fully reimbursed".to_string());
    }
    let amount = match params.amount {
        Some(a) => {
            if a <= 0.0 {
                return Err("Reimbursement amount must be positive".to_string());
            }
            if a > residual + 0.0001 {
                return Err(format!(
                    "Reimbursement amount {a} exceeds residual {residual}"
                ));
            }
            a
        }
        None => residual,
    };
    let remaining = (residual - amount).max(0.0);
    let clears_residual = remaining <= 0.0001;
    let partner_id = source_move
        .partner_id
        .or_else(|| employee_remittance_partner(ctx, sheet.employee_id));

    let name = next_doc_number(ctx, "REIM");
    let origin = format!("EXP{sheet_id}-REIM");
    let currency_id = source_move.currency_id;
    let company_currency_id = source_move.company_currency_id;

    let reimb_move = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: name.clone(),
        ref_: Some(sheet.name.clone()),
        move_type: MoveType::Entry,
        auto_post: false,
        state: AccountMoveState::Draft,
        date: params.payment_date,
        invoice_date: Some(params.payment_date),
        invoice_date_due: None,
        invoice_payment_term_id: None,
        invoice_origin: Some(origin.clone()),
        invoice_partner_display_name: None,
        invoice_cash_rounding_id: None,
        payment_reference: Some(origin),
        partner_shipping_id: None,
        sale_order_id: None,
        partner_id,
        commercial_partner_id: partner_id,
        partner_bank_id: None,
        fiscal_position_id: None,
        invoice_user_id: Some(ctx.sender()),
        invoice_incoterm_id: None,
        incoterm_location: None,
        campaign_id: None,
        source_id: None,
        medium_id: None,
        company_id,
        journal_id: params.journal_id,
        currency_id,
        company_currency_id,
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
        payment_state: PaymentState::Paid,
        restrict_mode_hash_table: false,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: Some(
            serde_json::json!({
                "expense_sheet_id": sheet_id,
                "source_move_id": move_id,
                "client_request_id": params.client_request_id,
                "kind": "expense_reimbursement",
            })
            .to_string(),
        ),
    });

    let mut clear_payable = empty_line_params(
        params.payable_account_id,
        format!("Clear employee payable — {}", sheet.name),
        amount,
        0.0,
        1,
    );
    clear_payable.partner_id = partner_id;
    insert_draft_account_move_line(ctx, &reimb_move, clear_payable)?;
    let mut liquidity = empty_line_params(
        params.liquidity_account_id,
        format!("Reimbursement payment — {}", sheet.name),
        0.0,
        amount,
        2,
    );
    liquidity.partner_id = partner_id;
    insert_draft_account_move_line(ctx, &reimb_move, liquidity)?;

    for ml in ctx
        .db
        .account_move_line()
        .iter()
        .filter(|l| l.move_id == reimb_move.id)
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
        ..reimb_move
    });

    ctx.db.account_move().id().update(AccountMove {
        amount_residual: remaining,
        amount_residual_signed: remaining,
        invoice_has_outstanding: !clears_residual,
        payment_state: if clears_residual {
            PaymentState::Paid
        } else {
            PaymentState::Partial
        },
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..source_move
    });

    let metadata = merge_metadata(
        sheet.metadata.as_deref(),
        serde_json::json!({
            "reimbursement_client_request_id": params.client_request_id,
            "reimbursement_move_id": reimb_move.id,
            "reimbursement_amount": amount,
            "reimbursement_residual": remaining,
        }),
    );

    let new_state = if clears_residual {
        ExpenseSheetState::Done
    } else {
        ExpenseSheetState::Posted
    };
    ctx.db.expense_sheet().id().update(HrExpenseSheet {
        reimbursement_move_id: Some(reimb_move.id),
        state: new_state.clone(),
        metadata,
        ..sheet
    });
    if clears_residual {
        sync_line_states(ctx, sheet_id, ExpenseState::Done);
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_expense_sheet",
            record_id: sheet_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "Posted" }).to_string()),
            new_values: Some(
                serde_json::json!({
                    "state": format!("{:?}", new_state),
                    "reimbursement_move_id": reimb_move.id,
                    "reimbursement_amount": amount,
                    "reimbursement_residual": remaining,
                })
                .to_string(),
            ),
            changed_fields: vec!["state".to_string(), "reimbursement_move_id".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn upsert_expense_policy(
    ctx: &ReducerContext,
    organization_id: u64,
    params: UpsertExpensePolicyParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_expense_sheet", "update")?;
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    if let Some(max) = params.max_line_amount {
        if max <= 0.0 {
            return Err("max_line_amount must be positive when set".to_string());
        }
    }
    if let Some(max) = params.max_sheet_amount {
        if max <= 0.0 {
            return Err("max_sheet_amount must be positive when set".to_string());
        }
    }

    if let Some(existing) = ctx
        .db
        .hr_expense_policy()
        .expense_policy_by_company()
        .filter(&company_id)
        .find(|p| p.organization_id == organization_id)
    {
        let record_id = existing.id;
        ctx.db.hr_expense_policy().id().update(HrExpensePolicy {
            max_line_amount: params.max_line_amount,
            max_sheet_amount: params.max_sheet_amount,
            active: params.active,
            metadata: params.metadata.or(existing.metadata.clone()),
            ..existing
        });
        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(company_id),
                table_name: "hr_expense_policy",
                record_id,
                action: "UPDATE",
                old_values: None,
                new_values: None,
                changed_fields: vec![
                    "max_line_amount".to_string(),
                    "max_sheet_amount".to_string(),
                    "active".to_string(),
                ],
                metadata: None,
            },
        );
        return Ok(());
    }

    let row = ctx.db.hr_expense_policy().insert(HrExpensePolicy {
        id: 0,
        organization_id,
        company_id,
        max_line_amount: params.max_line_amount,
        max_sheet_amount: params.max_sheet_amount,
        active: params.active,
        metadata: params.metadata,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_expense_policy",
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
