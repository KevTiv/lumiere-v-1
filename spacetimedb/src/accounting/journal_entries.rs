/// Journal Entries — AccountMove, AccountMoveLine
///
/// # 7.2 Journal Entries
///
/// Tables for accounting journal entries and move lines.
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::budgeting::{
    budget_post, crossovered_budget, crossovered_budget_lines, CrossoveredBudget,
    CrossoveredBudgetLines,
};
use crate::accounting::chart_of_accounts::{account_account, account_journal};
use crate::accounting::fiscal_periods::ensure_accounting_period_open_for_date;
use crate::accounting::tax_management::account_tax;
use crate::core::organization::{company, company_id_from_scope, require_company_in_organization};
use crate::crm::contacts::contact;
use crate::helpers::{
    calculate_tax, check_permission, next_doc_number, write_audit_log_v2, AuditLogParams,
};
use crate::inventory::product::product;
use crate::inventory::stock::stock_quant;
use crate::projects::milestones::{project_milestone, ProjectMilestone};
use crate::projects::project_accounting::refresh_project_margin_for_projects;
use crate::projects::projects::project_project;
use crate::projects::timesheets::{
    ensure_timesheet_fx_snapshot, project_timesheet, ProjectTimesheet,
};
use crate::purchasing::purchase_orders::{
    purchase_order, purchase_order_line, validate_three_way_match_po_lines,
    DEFAULT_QTY_MATCH_TOLERANCE,
};
use crate::sales::sales_core::{sale_order, sale_order_line, SaleOrderLine};
use crate::types::{
    AccountMoveState, BudgetState, InvoiceStatus, LineInvoiceStatus, MoveType, PaymentState,
    PoInvoiceStatus, TaxTypeUse,
};
use crate::workflow::action_registry::{
    GuardedActionInput, GuardedActionKey, GUARDED_ACTION_SCHEMA_VERSION,
};
use crate::workflow::approval_gate::{
    request_guarded_action, GuardedActionGateOutcome, RequestGuardedActionParams,
};

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = account_move,
    public,
    index(accessor = account_move_by_org, btree(columns = [organization_id])),
    index(accessor = move_by_company, btree(columns = [company_id])),
    index(accessor = move_by_journal, btree(columns = [journal_id])),
    index(accessor = move_by_partner, btree(columns = [partner_id])),
    index(accessor = move_by_state, btree(columns = [state])),
    index(accessor = move_by_date, btree(columns = [date])),
    index(accessor = move_by_name, btree(columns = [name]))
)]
#[derive(Clone)]
pub struct AccountMove {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// Tenant isolation — always required
    pub organization_id: u64,
    pub name: String,
    pub ref_: Option<String>,
    pub move_type: MoveType,
    pub auto_post: bool,
    pub state: AccountMoveState,
    pub date: Timestamp,
    pub invoice_date: Option<Timestamp>,
    pub invoice_date_due: Option<Timestamp>,
    pub invoice_payment_term_id: Option<u64>,
    pub invoice_origin: Option<String>,
    pub invoice_partner_display_name: Option<String>,
    pub invoice_cash_rounding_id: Option<u64>,
    pub payment_reference: Option<String>,
    pub partner_shipping_id: Option<u64>,
    pub sale_order_id: Option<u64>,
    pub partner_id: Option<u64>,
    pub commercial_partner_id: Option<u64>,
    pub partner_bank_id: Option<u64>,
    pub fiscal_position_id: Option<u64>,
    pub invoice_user_id: Option<Identity>,
    pub invoice_incoterm_id: Option<u64>,
    pub incoterm_location: Option<String>,
    pub campaign_id: Option<u64>,
    pub source_id: Option<u64>,
    pub medium_id: Option<u64>,
    pub company_id: u64,
    pub journal_id: u64,
    pub currency_id: u64,
    pub company_currency_id: u64,
    pub amount_untaxed: f64,
    pub amount_tax: f64,
    pub amount_total: f64,
    pub amount_residual: f64,
    pub amount_untaxed_signed: f64,
    pub amount_tax_signed: f64,
    pub amount_total_signed: f64,
    pub amount_total_in_currency_signed: f64,
    pub amount_residual_signed: f64,
    pub to_check: bool,
    pub posted_before: bool,
    pub is_storno: bool,
    pub is_move_sent: bool,
    pub secure_sequence_number: Option<u64>,
    pub invoice_has_outstanding: bool,
    pub payment_state: PaymentState,
    pub restrict_mode_hash_table: bool,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = account_move_line,
    public,
    index(accessor = account_move_line_by_org, btree(columns = [organization_id])),
    index(accessor = move_line_by_move, btree(columns = [move_id])),
    index(accessor = move_line_by_account, btree(columns = [account_id])),
    index(accessor = move_line_by_partner, btree(columns = [partner_id])),
    index(accessor = move_line_by_date, btree(columns = [date]))
)]
#[derive(Clone)]
pub struct AccountMoveLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// Tenant isolation — always required
    pub organization_id: u64,
    pub move_id: u64,
    pub move_name: Option<String>,
    pub date: Timestamp,
    pub ref_: Option<String>,
    pub parent_state: AccountMoveState,
    pub journal_id: u64,
    pub company_id: u64,
    pub company_currency_id: u64,
    pub sequence: u32,
    pub name: String,
    pub quantity: f64,
    pub price_unit: f64,
    pub price: f64,
    pub price_subtotal: f64,
    pub price_total: f64,
    pub discount: f64,
    pub balance: f64,
    pub currency_id: u64,
    pub amount_currency: f64,
    pub amount_residual: f64,
    pub amount_residual_currency: f64,
    pub debit: f64,
    pub credit: f64,
    pub debit_currency: f64,
    pub credit_currency: f64,
    pub tax_base_amount: f64,
    pub account_id: u64,
    pub account_internal_type: Option<String>,
    pub account_internal_group: Option<String>,
    pub account_root_id: Option<u64>,
    pub group_tax_id: Option<u64>,
    pub tax_line_id: Option<u64>,
    pub tax_group_id: Option<u64>,
    pub tax_ids: Vec<u64>,
    pub tax_repartition_line_id: Option<u64>,
    pub tax_audit: Option<String>,
    pub partner_id: Option<u64>,
    pub commercial_partner_id: Option<u64>,
    pub reconcile_model_id: Option<u64>,
    pub payment_id: Option<u64>,
    pub statement_line_id: Option<u64>,
    pub currency_id_field: Option<u64>,
    pub blocked: bool,
    pub matching_number: Option<String>,
    pub matching_label: Option<String>,
    pub is_matching: bool,
    pub expected_pay_date: Option<Timestamp>,
    pub expected_pay_date_currency_id: Option<u64>,
    pub expected_pay_date_amount: f64,
    pub expected_pay_date_residual: f64,
    pub display_type: Option<String>,
    pub is_downpayment: bool,
    pub exclude_from_invoice_tab: bool,
    pub analytic_account_id: Option<u64>,
    pub analytic_tag_ids: Vec<u64>,
    pub product_id: Option<u64>,
    pub product_uom_id: Option<u64>,
    pub product_category_id: Option<u64>,
    pub cogs_amount: f64,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

/// Parameters for creating a new journal entry (account move).
/// All user-settable fields are required; system-managed fields
/// (state, payment_state, amounts, posted_before) are initialized by the reducer.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAccountMoveParams {
    /// Legal entity; default company for the org when omitted.
    pub company_id: Option<u64>,
    pub journal_id: u64,
    pub move_type: MoveType,
    pub date: Timestamp,
    /// Pre-set name; leave empty to auto-generate on post.
    pub name: String,
    pub ref_: Option<String>,
    pub auto_post: bool,
    pub to_check: bool,
    pub is_storno: bool,
    pub partner_id: Option<u64>,
    pub partner_bank_id: Option<u64>,
    pub fiscal_position_id: Option<u64>,
    pub invoice_date: Option<Timestamp>,
    pub invoice_date_due: Option<Timestamp>,
    pub invoice_payment_term_id: Option<u64>,
    pub payment_reference: Option<String>,
    pub invoice_origin: Option<String>,
    pub invoice_partner_display_name: Option<String>,
    pub invoice_cash_rounding_id: Option<u64>,
    pub partner_shipping_id: Option<u64>,
    pub sale_order_id: Option<u64>,
    pub invoice_incoterm_id: Option<u64>,
    pub incoterm_location: Option<String>,
    pub campaign_id: Option<u64>,
    pub source_id: Option<u64>,
    pub medium_id: Option<u64>,
    pub secure_sequence_number: Option<u64>,
    pub metadata: Option<String>,
}

/// Parameters for adding a move line to a draft journal entry.
/// System-derived fields (move_name, date, parent_state, journal_id, company_id,
/// company_currency_id, currency_id_field, balance, amount_currency, amount_residual,
/// debit_currency, credit_currency, price, price_subtotal, price_total,
/// tax_base_amount, account_internal_type/group/root, commercial_partner_id,
/// is_matching, cogs_amount) are computed by the reducer.
#[derive(SpacetimeType, Clone, Debug)]
pub struct AddAccountMoveLineParams {
    pub account_id: u64,
    pub name: String,
    pub debit: f64,
    pub credit: f64,
    pub sequence: u32,
    pub quantity: f64,
    pub price_unit: f64,
    pub discount: f64,
    pub tax_ids: Vec<u64>,
    pub partner_id: Option<u64>,
    pub product_id: Option<u64>,
    pub product_uom_id: Option<u64>,
    pub product_category_id: Option<u64>,
    pub analytic_account_id: Option<u64>,
    pub analytic_tag_ids: Vec<u64>,
    pub display_type: Option<String>,
    pub is_downpayment: bool,
    pub exclude_from_invoice_tab: bool,
    pub blocked: bool,
    pub group_tax_id: Option<u64>,
    pub tax_line_id: Option<u64>,
    pub tax_group_id: Option<u64>,
    pub tax_repartition_line_id: Option<u64>,
    pub tax_audit: Option<String>,
    pub reconcile_model_id: Option<u64>,
    pub payment_id: Option<u64>,
    pub statement_line_id: Option<u64>,
    pub matching_number: Option<String>,
    pub matching_label: Option<String>,
    pub expected_pay_date: Option<Timestamp>,
    pub expected_pay_date_currency_id: Option<u64>,
    pub expected_pay_date_amount: f64,
    pub expected_pay_date_residual: f64,
    pub metadata: Option<String>,
}

/// Parameters for creating a customer invoice from a confirmed sale order.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateInvoiceFromSaleOrderParams {
    pub journal_id: u64,
    pub default_income_account_id: u64,
    pub receivable_line: AddAccountMoveLineParams,
    pub income_line: AddAccountMoveLineParams,
    /// User-entered invoice narration; falls back to the sale order's `note` when omitted.
    pub metadata: Option<String>,
}

/// Parameters for creating a customer credit note (OutRefund) from a posted invoice.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateCreditNoteParams {
    /// Invoice line ids to credit; empty means full reversal of all lines on the invoice.
    pub line_ids: Vec<u64>,
    /// Optional correction reason stored on the credit note metadata.
    pub reason: Option<String>,
}

/// Parameters for creating a vendor bill from a confirmed purchase order.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateBillFromPurchaseOrderParams {
    pub journal_id: u64,
    pub default_expense_account_id: u64,
    pub invoice_date: Timestamp,
    pub expense_line: AddAccountMoveLineParams,
    pub payable_line: AddAccountMoveLineParams,
    /// User-entered bill narration; falls back to the PO's `notes` when omitted.
    pub metadata: Option<String>,
}

/// Parameters for updating an existing draft move line.
/// `None` means "no change"; `Some(None)` clears a nullable field.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateAccountMoveLineParams {
    pub company_id: Option<u64>,
    pub name: Option<String>,
    pub debit: Option<f64>,
    pub credit: Option<f64>,
    pub partner_id: Option<Option<u64>>,
    pub analytic_account_id: Option<Option<u64>>,
    pub metadata: Option<String>,
}

/// Parameters for the `bill_timesheets` workflow action.
/// Creates a draft OutInvoice for a set of validated, billable timesheets.
#[derive(SpacetimeType, Clone, Debug)]
pub struct BillTimesheetsParams {
    pub company_id: Option<u64>,
    pub timesheet_ids: Vec<u64>,
    pub journal_id: u64,
    pub income_account_id: u64,
    pub partner_id: u64,
    pub invoice_date: Option<Timestamp>,
    /// Sale tax IDs for services invoice lines. When empty, the first active
    /// company Sale tax (e.g. country-pack GST/VAT) is applied if present.
    pub tax_ids: Vec<u64>,
    pub fiscal_position_id: Option<u64>,
}

/// Parameters for fixed-fee / milestone AR billing (extends same OutInvoice path).
#[derive(SpacetimeType, Clone, Debug)]
pub struct BillProjectMilestoneParams {
    /// Override amount; when None uses milestone.bill_amount × percent_complete/100.
    pub amount: Option<f64>,
    pub percent_complete: Option<f64>,
    pub journal_id: u64,
    pub income_account_id: u64,
    pub partner_id: Option<u64>,
    pub invoice_date: Option<Timestamp>,
    pub tax_ids: Vec<u64>,
    pub fiscal_position_id: Option<u64>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct DeleteAccountMoveLineParams {
    pub company_id: Option<u64>,
}

// ── Accounting helpers and invoice posting ───────────────────────────────────

fn compute_invoice_totals_internal(ctx: &ReducerContext, move_id: u64) -> Result<(), String> {
    let mut move_record = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("Move not found")?;

    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .collect();

    if lines.is_empty() {
        return Err("Cannot compute totals for a move without lines".to_string());
    }

    let mut amount_untaxed = 0.0f64;
    let mut amount_tax = 0.0f64;
    let mut amount_total = 0.0f64;
    let mut amount_residual = 0.0f64;

    for line in lines {
        if line.tax_line_id.is_some() || line.tax_group_id.is_some() {
            amount_tax += line.price_total.abs();
        } else {
            amount_untaxed += line.price_subtotal.abs();
        }

        amount_total += line.balance.abs();
        amount_residual += line.amount_residual.abs();
    }

    move_record.amount_untaxed = amount_untaxed;
    move_record.amount_tax = amount_tax;
    move_record.amount_total = if amount_total > 0.0 {
        amount_total
    } else {
        amount_untaxed + amount_tax
    };
    move_record.amount_residual = amount_residual;
    move_record.amount_untaxed_signed = amount_untaxed;
    move_record.amount_tax_signed = amount_tax;
    move_record.amount_total_signed = move_record.amount_total;
    move_record.amount_total_in_currency_signed = move_record.amount_total;
    move_record.amount_residual_signed = amount_residual;
    move_record.write_uid = Some(ctx.sender());
    move_record.write_date = Some(ctx.timestamp);

    ctx.db.account_move().id().update(move_record);
    Ok(())
}

fn compute_weighted_average_cost(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    required_qty: f64,
) -> f64 {
    if required_qty <= 0.0 {
        return 0.0;
    }

    let mut total_qty = 0.0f64;
    let mut total_value = 0.0f64;

    for quant in ctx.db.stock_quant().quant_by_product().filter(&product_id) {
        if quant.organization_id != organization_id || quant.company_id != company_id {
            continue;
        }
        if quant.quantity <= 0.0 {
            continue;
        }

        total_qty += quant.quantity;
        total_value += quant.value;
    }

    if total_qty <= 0.0 {
        0.0
    } else {
        (total_value / total_qty) * required_qty
    }
}

fn compute_fifo_cost(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    required_qty: f64,
) -> f64 {
    if required_qty <= 0.0 {
        return 0.0;
    }

    let mut quants: Vec<_> = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&product_id)
        .filter(|q| {
            q.organization_id == organization_id && q.company_id == company_id && q.quantity > 0.0
        })
        .collect();

    quants.sort_by_key(|q| q.in_date);

    let mut remaining = required_qty;
    let mut total_cost = 0.0f64;

    for quant in quants {
        if remaining <= 0.0 {
            break;
        }

        let take_qty = remaining.min(quant.quantity);
        let unit_cost = if quant.quantity.abs() > f64::EPSILON {
            quant.value / quant.quantity
        } else {
            quant.cost
        };

        total_cost += take_qty * unit_cost;
        remaining -= take_qty;
    }

    total_cost
}

fn compute_lifo_cost(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    required_qty: f64,
) -> f64 {
    if required_qty <= 0.0 {
        return 0.0;
    }

    let mut quants: Vec<_> = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&product_id)
        .filter(|q| {
            q.organization_id == organization_id && q.company_id == company_id && q.quantity > 0.0
        })
        .collect();

    quants.sort_by_key(|q| q.in_date);
    quants.reverse();

    let mut remaining = required_qty;
    let mut total_cost = 0.0f64;

    for quant in quants {
        if remaining <= 0.0 {
            break;
        }

        let take_qty = remaining.min(quant.quantity);
        let unit_cost = if quant.quantity.abs() > f64::EPSILON {
            quant.value / quant.quantity
        } else {
            quant.cost
        };

        total_cost += take_qty * unit_cost;
        remaining -= take_qty;
    }

    total_cost
}

fn resolve_cost_for_line(
    ctx: &ReducerContext,
    line: &AccountMoveLine,
    organization_id: u64,
    company_id: u64,
) -> f64 {
    let product_id = match line.product_id {
        Some(id) => id,
        None => return 0.0,
    };

    let product = match ctx.db.product().id().find(&product_id) {
        Some(p) => p,
        None => return 0.0,
    };

    match product.cost_method.as_str() {
        "fifo" => compute_fifo_cost(ctx, organization_id, company_id, product_id, line.quantity),
        "lifo" => compute_lifo_cost(ctx, organization_id, company_id, product_id, line.quantity),
        "average" | "weighted_average" => compute_weighted_average_cost(
            ctx,
            organization_id,
            company_id,
            product_id,
            line.quantity,
        ),
        _ => line.quantity * product.standard_price,
    }
}

fn post_cogs_entries(
    ctx: &ReducerContext,
    organization_id: u64,
    move_record: &AccountMove,
    cogs_account_id: u64,
    inventory_account_id: u64,
) -> Result<(), String> {
    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_record.id)
        .collect();

    let mut sequence: u32 = lines.iter().map(|l| l.sequence).max().unwrap_or(0) + 1;
    let mut total_cogs = 0.0f64;

    for line in lines {
        let cost = resolve_cost_for_line(ctx, &line, organization_id, move_record.company_id);
        if cost <= 0.0 {
            continue;
        }

        total_cogs += cost;

        ctx.db.account_move_line().id().update(AccountMoveLine {
            cogs_amount: cost,
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            ..line
        });
    }

    if total_cogs <= 0.0 {
        return Ok(());
    }

    let cogs_line = AccountMoveLine {
        id: 0,
        organization_id: move_record.organization_id,
        move_id: move_record.id,
        move_name: Some(move_record.name.clone()),
        date: move_record.date,
        ref_: move_record.ref_.clone(),
        parent_state: move_record.state.clone(),
        journal_id: move_record.journal_id,
        company_id: move_record.company_id,
        company_currency_id: move_record.company_currency_id,
        sequence,
        name: "Cost of Goods Sold".to_string(),
        quantity: 1.0,
        price_unit: total_cogs,
        price: total_cogs,
        price_subtotal: total_cogs,
        price_total: total_cogs,
        discount: 0.0,
        balance: total_cogs,
        currency_id: move_record.currency_id,
        amount_currency: total_cogs,
        amount_residual: 0.0,
        amount_residual_currency: 0.0,
        debit: total_cogs,
        credit: 0.0,
        debit_currency: total_cogs,
        credit_currency: 0.0,
        tax_base_amount: 0.0,
        account_id: cogs_account_id,
        account_internal_type: Some("Expense".to_string()),
        account_internal_group: Some("Expense".to_string()),
        account_root_id: None,
        group_tax_id: None,
        tax_line_id: None,
        tax_group_id: None,
        tax_ids: vec![],
        tax_repartition_line_id: None,
        tax_audit: None,
        partner_id: move_record.partner_id,
        commercial_partner_id: move_record.commercial_partner_id,
        reconcile_model_id: None,
        payment_id: None,
        statement_line_id: None,
        currency_id_field: Some(move_record.currency_id),
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
        exclude_from_invoice_tab: true,
        analytic_account_id: None,
        analytic_tag_ids: vec![],
        product_id: None,
        product_uom_id: None,
        product_category_id: None,
        cogs_amount: total_cogs,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: Some("{\"auto_generated\":\"cogs_debit\"}".to_string()),
    };
    ctx.db.account_move_line().insert(cogs_line);

    sequence += 1;

    let inventory_line = AccountMoveLine {
        id: 0,
        organization_id: move_record.organization_id,
        move_id: move_record.id,
        move_name: Some(move_record.name.clone()),
        date: move_record.date,
        ref_: move_record.ref_.clone(),
        parent_state: move_record.state.clone(),
        journal_id: move_record.journal_id,
        company_id: move_record.company_id,
        company_currency_id: move_record.company_currency_id,
        sequence,
        name: "Inventory Valuation".to_string(),
        quantity: 1.0,
        price_unit: total_cogs,
        price: total_cogs,
        price_subtotal: total_cogs,
        price_total: total_cogs,
        discount: 0.0,
        balance: -total_cogs,
        currency_id: move_record.currency_id,
        amount_currency: -total_cogs,
        amount_residual: 0.0,
        amount_residual_currency: 0.0,
        debit: 0.0,
        credit: total_cogs,
        debit_currency: 0.0,
        credit_currency: total_cogs,
        tax_base_amount: 0.0,
        account_id: inventory_account_id,
        account_internal_type: Some("Asset".to_string()),
        account_internal_group: Some("Asset".to_string()),
        account_root_id: None,
        group_tax_id: None,
        tax_line_id: None,
        tax_group_id: None,
        tax_ids: vec![],
        tax_repartition_line_id: None,
        tax_audit: None,
        partner_id: move_record.partner_id,
        commercial_partner_id: move_record.commercial_partner_id,
        reconcile_model_id: None,
        payment_id: None,
        statement_line_id: None,
        currency_id_field: Some(move_record.currency_id),
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
        exclude_from_invoice_tab: true,
        analytic_account_id: None,
        analytic_tag_ids: vec![],
        product_id: None,
        product_uom_id: None,
        product_category_id: None,
        cogs_amount: total_cogs,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: Some("{\"auto_generated\":\"cogs_credit\"}".to_string()),
    };
    ctx.db.account_move_line().insert(inventory_line);

    Ok(())
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn compute_invoice_totals(
    ctx: &ReducerContext,
    organization_id: u64,
    move_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move", "write")?;

    let move_record = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("Move not found")?;

    match move_record.move_type {
        MoveType::OutInvoice | MoveType::InInvoice | MoveType::OutRefund | MoveType::InRefund => {}
        _ => {
            return Err("compute_invoice_totals is only valid for invoice/refund moves".to_string())
        }
    }

    compute_invoice_totals_internal(ctx, move_id)?;

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(move_record.company_id),
            table_name: "account_move",
            record_id: move_id,
            action: "COMPUTE_TOTALS",
            old_values: None,
            new_values: None,
            changed_fields: vec![
                "amount_untaxed".to_string(),
                "amount_tax".to_string(),
                "amount_total".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

/// Mark all lines on a draft move as posted, re-loading each row by primary key so
/// stale index snapshots cannot trigger WASM update panics.
fn mark_move_lines_posted(ctx: &ReducerContext, move_id: u64, name: &str) -> Result<(), String> {
    let line_ids: Vec<u64> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .map(|l| l.id)
        .collect();

    if line_ids.is_empty() {
        return Err("Cannot post a move without lines".to_string());
    }

    for line_id in line_ids {
        if line_id == 0 {
            return Err("Encountered move line with invalid id 0".to_string());
        }
        let line = ctx
            .db
            .account_move_line()
            .id()
            .find(&line_id)
            .ok_or_else(|| format!("Move line {line_id} not found before post"))?;
        ctx.db.account_move_line().id().update(AccountMoveLine {
            parent_state: AccountMoveState::Posted,
            move_name: Some(name.to_string()),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            ..line
        });
    }

    Ok(())
}

/// Enforce PO three-way match before posting a vendor bill linked via `invoice_origin` (e.g. `PO123`).
fn validate_in_invoice_three_way_match(
    ctx: &ReducerContext,
    move_record: &AccountMove,
    move_id: u64,
) -> Result<(), String> {
    let Some(origin) = move_record.invoice_origin.as_ref() else {
        return Ok(());
    };
    let Some(po_id_str) = origin.strip_prefix("PO") else {
        return Ok(());
    };
    let Ok(po_id) = po_id_str.parse::<u64>() else {
        return Ok(());
    };

    let po_lines: Vec<_> = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&po_id)
        .collect();

    if po_lines.is_empty() {
        return Ok(());
    }

    let po = ctx.db.purchase_order().id().find(&po_id);
    let tolerance = po
        .as_ref()
        .map(|o| crate::purchasing::purchase_orders::qty_match_tolerance_for_order(o))
        .unwrap_or(DEFAULT_QTY_MATCH_TOLERANCE);
    let price_tol = po
        .as_ref()
        .map(|o| crate::purchasing::purchase_orders::price_match_tolerance_for_order(o))
        .unwrap_or(crate::purchasing::purchase_orders::DEFAULT_PRICE_MATCH_TOLERANCE);
    validate_three_way_match_po_lines(&po_lines, tolerance)?;

    for ml in ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
    {
        if ml.debit <= 0.0 {
            continue;
        }
        let Some(product_id) = ml.product_id else {
            continue;
        };
        let Some(po_line) = po_lines.iter().find(|l| l.product_id == product_id) else {
            continue;
        };
        if ml.quantity > po_line.qty_received + tolerance {
            return Err(format!(
                "three-way match failed: line {} billed {:.4} exceeds received {:.4}",
                po_line.id, ml.quantity, po_line.qty_received
            ));
        }
        if (ml.price_unit - po_line.price_unit).abs() > price_tol {
            return Err(format!(
                "three-way match failed: line {} bill price {:.4} differs from PO price {:.4} (tol {:.4})",
                po_line.id, ml.price_unit, po_line.price_unit, price_tol
            ));
        }
    }

    Ok(())
}

#[spacetimedb::reducer]
pub fn post_invoice(
    ctx: &ReducerContext,
    organization_id: u64,
    move_id: u64,
    cogs_account_id: u64,
    inventory_account_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move", "write")?;

    let move_record = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("Invoice not found")?;

    if move_record.state != AccountMoveState::Draft {
        return Err("Invoice is not in draft state".to_string());
    }

    match move_record.move_type {
        MoveType::OutInvoice | MoveType::InInvoice | MoveType::OutRefund | MoveType::InRefund => {}
        _ => return Err("post_invoice is only valid for invoice/refund moves".to_string()),
    }

    if move_record.move_type == MoveType::InInvoice {
        validate_in_invoice_three_way_match(ctx, &move_record, move_id)?;
    }

    ensure_accounting_period_open_for_date(ctx, move_record.company_id, move_record.date)?;

    crate::accounting::credit_control::ensure_partner_credit_allows_invoice(
        ctx,
        organization_id,
        move_record.company_id,
        move_record.partner_id,
        move_record.amount_total,
    )?;

    compute_invoice_totals_internal(ctx, move_id)?;
    post_cogs_entries(
        ctx,
        organization_id,
        &move_record,
        cogs_account_id,
        inventory_account_id,
    )?;

    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .collect();

    let total_debit: f64 = lines.iter().map(|l| l.debit).sum();
    let total_credit: f64 = lines.iter().map(|l| l.credit).sum();

    if (total_debit - total_credit).abs() > 0.01 {
        return Err("Invoice move is not balanced after COGS posting".to_string());
    }

    let name = if move_record.name.is_empty() {
        format!("INV{}/{}", move_record.journal_id, move_id)
    } else {
        move_record.name.clone()
    };

    mark_move_lines_posted(ctx, move_id, &name)?;

    let refreshed = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("Invoice not found after totals computation")?;

    ctx.db.account_move().id().update(AccountMove {
        state: AccountMoveState::Posted,
        name,
        posted_before: true,
        payment_state: PaymentState::NotPaid,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..refreshed
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(move_record.company_id),
            table_name: "account_move",
            record_id: move_id,
            action: "POST_INVOICE",
            old_values: Some(serde_json::json!({ "state": "Draft" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "Posted" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    if move_record.move_type == MoveType::OutInvoice {
        if let Some(sale_order_id) = move_record.sale_order_id {
            crate::sales::oms_extensions::maybe_accrue_commission_on_invoice_post(
                ctx,
                organization_id,
                sale_order_id,
            )?;
        }
    }

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_account_move(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateAccountMoveParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move", "create")?;

    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    // Validate journal exists and belongs to company
    let journal = ctx
        .db
        .account_journal()
        .id()
        .find(&params.journal_id)
        .ok_or("Journal not found")?;

    if journal.company_id != company_id {
        return Err("Journal does not belong to the specified company".to_string());
    }

    // Get company for currency
    let company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;

    let move_type_str = format!("{:?}", params.move_type);
    let date_str = params.date.to_string();

    let move_record = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: params.name.clone(),
        ref_: params.ref_,
        move_type: params.move_type,
        auto_post: params.auto_post,
        // System-managed: always starts as Draft
        state: AccountMoveState::Draft,
        date: params.date,
        invoice_date: params.invoice_date,
        invoice_date_due: params.invoice_date_due,
        invoice_payment_term_id: params.invoice_payment_term_id,
        invoice_origin: params.invoice_origin,
        invoice_partner_display_name: params.invoice_partner_display_name,
        invoice_cash_rounding_id: params.invoice_cash_rounding_id,
        payment_reference: params.payment_reference,
        partner_shipping_id: params.partner_shipping_id,
        sale_order_id: params.sale_order_id,
        partner_id: params.partner_id,
        // Derived: commercial partner mirrors billing partner on create
        commercial_partner_id: params.partner_id,
        partner_bank_id: params.partner_bank_id,
        fiscal_position_id: params.fiscal_position_id,
        invoice_user_id: Some(ctx.sender()),
        invoice_incoterm_id: params.invoice_incoterm_id,
        incoterm_location: params.incoterm_location,
        campaign_id: params.campaign_id,
        source_id: params.source_id,
        medium_id: params.medium_id,
        company_id,
        journal_id: params.journal_id,
        // Derived from journal/company lookup
        currency_id: journal.currency_id.unwrap_or(company.currency_id),
        company_currency_id: company.currency_id,
        // System-managed: amounts start at 0, computed on post
        amount_untaxed: 0.0,
        amount_tax: 0.0,
        amount_total: 0.0,
        amount_residual: 0.0,
        amount_untaxed_signed: 0.0,
        amount_tax_signed: 0.0,
        amount_total_signed: 0.0,
        amount_total_in_currency_signed: 0.0,
        amount_residual_signed: 0.0,
        to_check: params.to_check,
        // System-managed: set to true on first post
        posted_before: false,
        is_storno: params.is_storno,
        // System-managed: set when move is sent
        is_move_sent: false,
        secure_sequence_number: params.secure_sequence_number,
        // System-managed: set during reconciliation
        invoice_has_outstanding: false,
        // System-managed: starts as not paid
        payment_state: PaymentState::NotPaid,
        // Derived from journal configuration
        restrict_mode_hash_table: journal.restrict_mode_hash_table,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_move",
            record_id: move_record.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "move_type": move_type_str, "date": date_str }).to_string(),
            ),
            changed_fields: vec!["move_type".to_string(), "date".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Insert a line on a draft move using caller-supplied [`AddAccountMoveLineParams`].
pub(crate) fn insert_draft_account_move_line(
    ctx: &ReducerContext,
    move_record: &AccountMove,
    params: AddAccountMoveLineParams,
) -> Result<AccountMoveLine, String> {
    let account = ctx
        .db
        .account_account()
        .id()
        .find(&params.account_id)
        .ok_or("Account not found")?;

    let balance = params.debit - params.credit;
    let subtotal = params.quantity * params.price_unit * (1.0 - params.discount / 100.0);

    let line = ctx.db.account_move_line().insert(AccountMoveLine {
        id: 0,
        organization_id: move_record.organization_id,
        move_id: move_record.id,
        move_name: Some(move_record.name.clone()),
        date: move_record.date,
        ref_: move_record.ref_.clone(),
        parent_state: move_record.state.clone(),
        journal_id: move_record.journal_id,
        company_id: move_record.company_id,
        company_currency_id: move_record.company_currency_id,
        sequence: params.sequence,
        name: params.name.clone(),
        quantity: params.quantity,
        price_unit: params.price_unit,
        price: subtotal,
        price_subtotal: subtotal,
        price_total: subtotal,
        discount: params.discount,
        balance,
        currency_id: move_record.currency_id,
        amount_currency: balance,
        amount_residual: balance,
        amount_residual_currency: balance,
        debit: params.debit,
        credit: params.credit,
        debit_currency: params.debit,
        credit_currency: params.credit,
        tax_base_amount: 0.0,
        account_id: params.account_id,
        account_internal_type: account.internal_type.as_ref().map(|t| format!("{:?}", t)),
        account_internal_group: account.internal_group.as_ref().map(|g| format!("{:?}", g)),
        account_root_id: account.root_id,
        group_tax_id: params.group_tax_id,
        tax_line_id: params.tax_line_id,
        tax_group_id: params.tax_group_id,
        tax_ids: params.tax_ids,
        tax_repartition_line_id: params.tax_repartition_line_id,
        tax_audit: params.tax_audit,
        partner_id: params.partner_id,
        commercial_partner_id: params.partner_id,
        reconcile_model_id: params.reconcile_model_id,
        payment_id: params.payment_id,
        statement_line_id: params.statement_line_id,
        currency_id_field: Some(move_record.currency_id),
        blocked: params.blocked,
        matching_number: params.matching_number,
        matching_label: params.matching_label,
        is_matching: false,
        expected_pay_date: params.expected_pay_date,
        expected_pay_date_currency_id: params.expected_pay_date_currency_id,
        expected_pay_date_amount: params.expected_pay_date_amount,
        expected_pay_date_residual: params.expected_pay_date_residual,
        display_type: params.display_type,
        is_downpayment: params.is_downpayment,
        exclude_from_invoice_tab: params.exclude_from_invoice_tab,
        analytic_account_id: params.analytic_account_id,
        analytic_tag_ids: params.analytic_tag_ids,
        product_id: params.product_id,
        product_uom_id: params.product_uom_id,
        product_category_id: params.product_category_id,
        cogs_amount: 0.0,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata,
    });

    Ok(line)
}

#[spacetimedb::reducer]
pub fn add_account_move_line(
    ctx: &ReducerContext,
    organization_id: u64,
    move_id: u64,
    params: AddAccountMoveLineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move_line", "create")?;

    let move_record = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("Move not found")?;

    if move_record.state != AccountMoveState::Draft {
        return Err("Cannot add lines to a posted move".to_string());
    }

    let line = insert_draft_account_move_line(ctx, &move_record, params.clone())?;

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(move_record.company_id),
            table_name: "account_move_line",
            record_id: line.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": params.name,
                    "debit": params.debit,
                    "credit": params.credit,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "name".to_string(),
                "debit".to_string(),
                "credit".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn post_account_move(
    ctx: &ReducerContext,
    organization_id: u64,
    move_id: u64,
) -> Result<(), String> {
    post_account_move_impl(ctx, organization_id, move_id, false)
}

pub fn post_account_move_impl(
    ctx: &ReducerContext,
    organization_id: u64,
    move_id: u64,
    skip_approval_check: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move", "write")?;

    let move_record = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("Move not found")?;

    if move_record.organization_id != organization_id {
        return Err("Move belongs to a different organization".to_string());
    }
    require_company_in_organization(ctx, organization_id, move_record.company_id)?;

    if move_record.state != AccountMoveState::Draft {
        return Err("Only draft moves can be posted".to_string());
    }

    let is_vendor_bill = matches!(
        move_record.move_type,
        MoveType::InInvoice | MoveType::InRefund
    );

    if !skip_approval_check && is_vendor_bill {
        if matches!(
            request_guarded_action(
                ctx,
                organization_id,
                RequestGuardedActionParams {
                    company_id: move_record.company_id,
                    action: GuardedActionKey::PostAccountMove,
                    action_version: GUARDED_ACTION_SCHEMA_VERSION,
                    input: GuardedActionInput::PostAccountMove { move_id },
                    idempotency_key: format!("post-account-move:{move_id}"),
                    correlation_id: format!("account-move:{move_id}:post"),
                    causation_id: None,
                },
            )?,
            GuardedActionGateOutcome::HumanTaskCreated { .. }
        ) {
            return Ok(());
        }
    }

    // Check balance - sum of debit must equal sum of credit
    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .collect();

    if lines.iter().any(|line| {
        line.organization_id != organization_id || line.company_id != move_record.company_id
    }) {
        return Err("Move lines do not match the move organization and company".to_string());
    }

    let total_debit: f64 = lines.iter().map(|l| l.debit).sum();
    let total_credit: f64 = lines.iter().map(|l| l.credit).sum();

    if (total_debit - total_credit).abs() > 0.01 {
        return Err("Move is not balanced".to_string());
    }

    if lines.is_empty() {
        return Err("Cannot post a move without lines".to_string());
    }

    ensure_accounting_period_open_for_date(ctx, move_record.company_id, move_record.date)?;

    // Generate name from document sequence if not set
    let name = if move_record.name.is_empty() {
        let doc_type = match move_record.move_type {
            MoveType::OutInvoice | MoveType::OutRefund => "INV",
            MoveType::InInvoice | MoveType::InRefund => "BILL",
            _ => "JRNL",
        };
        next_doc_number(ctx, doc_type)
    } else {
        move_record.name.clone()
    };

    // Update all lines to posted state (re-fetch each row by id — avoid stale snapshots).
    mark_move_lines_posted(ctx, move_id, &name)?;

    // Update move to posted
    let move_record = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("Move not found before state update")?;

    ctx.db.account_move().id().update(AccountMove {
        state: AccountMoveState::Posted,
        name,
        posted_before: true,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..move_record
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(move_record.company_id),
            table_name: "account_move",
            record_id: move_id,
            action: "POST",
            old_values: Some(serde_json::json!({ "state": "Draft" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "Posted" }).to_string()),
            changed_fields: vec!["state".to_string(), "posted_before".to_string()],
            metadata: None,
        },
    );

    // Auto-sync budget actuals for lines that carry an analytic account
    let move_date = move_record.date;
    let move_company_id = move_record.company_id;
    let posted_lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .collect();
    for line in posted_lines {
        let Some(analytic_id) = line.analytic_account_id else {
            continue;
        };
        let net_amount = line.debit - line.credit;
        if net_amount == 0.0 {
            continue;
        }
        // Find all BudgetPosts that include this line's GL account
        for bp in ctx.db.budget_post().iter().filter(|bp| {
            bp.company_id == move_company_id && bp.account_ids.contains(&line.account_id)
        }) {
            // Find matching budget lines (analytic + date range)
            for bline in ctx
                .db
                .crossovered_budget_lines()
                .iter()
                .filter(|bl| bl.analytic_account_id == Some(analytic_id))
            {
                if bline.general_budget_id != bp.id {
                    continue;
                }
                if move_date < bline.date_from || move_date > bline.date_to {
                    continue;
                }
                let Some(budget) = ctx
                    .db
                    .crossovered_budget()
                    .id()
                    .find(&bline.general_budget_id)
                else {
                    continue;
                };
                if budget.state != BudgetState::Validate && budget.state != BudgetState::Confirm {
                    continue;
                }
                let old_practical = bline.practical_amount;
                let new_practical = old_practical + net_amount;
                let variance = new_practical - bline.planned_amount;
                let achieve_pct = if bline.planned_amount != 0.0 {
                    (new_practical / bline.planned_amount) * 100.0
                } else {
                    0.0
                };
                let variance_pct = if bline.planned_amount != 0.0 {
                    (variance / bline.planned_amount) * 100.0
                } else {
                    0.0
                };
                ctx.db
                    .crossovered_budget_lines()
                    .id()
                    .update(CrossoveredBudgetLines {
                        practical_amount: new_practical,
                        variance,
                        variance_percentage: variance_pct,
                        achieve_percentage: achieve_pct,
                        is_above_budget: new_practical > bline.planned_amount,
                        write_uid: Some(ctx.sender()),
                        write_date: Some(ctx.timestamp),
                        ..bline
                    });
                let new_total = budget.total_practical - old_practical + new_practical;
                let total_var_pct = if budget.total_planned != 0.0 {
                    ((new_total - budget.total_planned) / budget.total_planned) * 100.0
                } else {
                    0.0
                };
                ctx.db.crossovered_budget().id().update(CrossoveredBudget {
                    total_practical: new_total,
                    variance_percentage: total_var_pct,
                    write_uid: Some(ctx.sender()),
                    write_date: Some(ctx.timestamp),
                    ..budget
                });
            }
        }
    }

    Ok(())
}

#[spacetimedb::reducer]
pub fn cancel_account_move(
    ctx: &ReducerContext,
    organization_id: u64,
    move_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move", "write")?;

    let move_record = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("Move not found")?;

    if move_record.state != AccountMoveState::Draft && move_record.state != AccountMoveState::Posted
    {
        return Err("Only draft or posted moves can be cancelled".to_string());
    }

    let old_state = format!("{:?}", move_record.state);

    // Update all lines
    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .collect();

    for line in lines {
        ctx.db.account_move_line().id().update(AccountMoveLine {
            parent_state: AccountMoveState::Cancelled,
            ..line
        });
    }

    ctx.db.account_move().id().update(AccountMove {
        state: AccountMoveState::Cancelled,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..move_record
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(move_record.company_id),
            table_name: "account_move",
            record_id: move_id,
            action: "CANCEL",
            old_values: Some(serde_json::json!({ "state": old_state }).to_string()),
            new_values: Some(serde_json::json!({ "state": "Cancelled" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_account_move_line(
    ctx: &ReducerContext,
    organization_id: u64,
    line_id: u64,
    params: UpdateAccountMoveLineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move_line", "write")?;

    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    let line = ctx
        .db
        .account_move_line()
        .id()
        .find(&line_id)
        .ok_or("Move line not found")?;

    // Check parent move is draft
    let move_record = ctx
        .db
        .account_move()
        .id()
        .find(&line.move_id)
        .ok_or("Parent move not found")?;

    if move_record.company_id != company_id {
        return Err("Move does not belong to this company".to_string());
    }

    if move_record.state != AccountMoveState::Draft {
        return Err("Cannot edit lines of a posted move".to_string());
    }

    let new_debit = params.debit.unwrap_or(line.debit);
    let new_credit = params.credit.unwrap_or(line.credit);
    let new_balance = new_debit - new_credit;

    let old_values = serde_json::json!({
        "name": line.name,
        "debit": line.debit,
        "credit": line.credit,
    });

    let mut changed_fields = Vec::new();
    if params.name.is_some() {
        changed_fields.push("name".to_string());
    }
    if params.debit.is_some() {
        changed_fields.push("debit".to_string());
    }
    if params.credit.is_some() {
        changed_fields.push("credit".to_string());
    }
    if params.partner_id.is_some() {
        changed_fields.push("partner_id".to_string());
    }
    if params.analytic_account_id.is_some() {
        changed_fields.push("analytic_account_id".to_string());
    }
    if params.metadata.is_some() {
        changed_fields.push("metadata".to_string());
    }

    ctx.db.account_move_line().id().update(AccountMoveLine {
        name: params.name.unwrap_or(line.name),
        debit: new_debit,
        credit: new_credit,
        balance: new_balance,
        amount_currency: new_balance,
        amount_residual: new_balance,
        amount_residual_currency: new_balance,
        debit_currency: new_debit,
        credit_currency: new_credit,
        partner_id: params.partner_id.unwrap_or(line.partner_id),
        analytic_account_id: params
            .analytic_account_id
            .unwrap_or(line.analytic_account_id),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata.map(Some).unwrap_or(line.metadata),
        ..line
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_move_line",
            record_id: line_id,
            action: "UPDATE",
            old_values: Some(old_values.to_string()),
            new_values: Some(
                serde_json::json!({
                    "debit": new_debit,
                    "credit": new_credit,
                })
                .to_string(),
            ),
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_account_move_line(
    ctx: &ReducerContext,
    organization_id: u64,
    line_id: u64,
    params: DeleteAccountMoveLineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move_line", "delete")?;

    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    let line = ctx
        .db
        .account_move_line()
        .id()
        .find(&line_id)
        .ok_or("Move line not found")?;

    // Check parent move is draft
    let move_record = ctx
        .db
        .account_move()
        .id()
        .find(&line.move_id)
        .ok_or("Parent move not found")?;

    if move_record.company_id != company_id {
        return Err("Move does not belong to this company".to_string());
    }

    if move_record.state != AccountMoveState::Draft {
        return Err("Cannot delete lines from a posted move".to_string());
    }

    ctx.db.account_move_line().id().delete(&line_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_move_line",
            record_id: line_id,
            action: "DELETE",
            old_values: Some(
                serde_json::json!({
                    "name": line.name,
                    "debit": line.debit,
                    "credit": line.credit,
                })
                .to_string(),
            ),
            new_values: None,
            changed_fields: vec!["id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

// ── Billing flow reducers ─────────────────────────────────────────────────────

/// Create a customer invoice (OutInvoice) from a confirmed Sale Order.
///
/// Returns an error if there are no lines to invoice.
#[spacetimedb::reducer]
pub fn create_invoice_from_sale_order(
    ctx: &ReducerContext,
    organization_id: u64,
    sale_order_id: u64,
    params: CreateInvoiceFromSaleOrderParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move", "create")?;

    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&sale_order_id)
        .ok_or("Sale order not found")?;

    if order.organization_id != organization_id {
        return Err("Sale order does not belong to this organization".to_string());
    }

    use crate::types::SaleState;
    if order.state != SaleState::Sale && order.state != SaleState::Done {
        return Err("Sale order must be confirmed before invoicing".to_string());
    }

    // Delivery-based policy: refresh qty_to_invoice from delivered residual before selecting lines.
    if order.invoice_policy == "delivery" {
        for line in ctx
            .db
            .sale_order_line()
            .order_line_by_order()
            .filter(&sale_order_id)
        {
            if line.display_type.is_some() {
                continue;
            }
            let qty_to_invoice = (line.qty_delivered - line.qty_invoiced).max(0.0);
            if (qty_to_invoice - line.qty_to_invoice).abs() > f64::EPSILON {
                ctx.db.sale_order_line().id().update(SaleOrderLine {
                    qty_to_invoice,
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..line
                });
            }
        }
    }

    let invoiceable_lines: Vec<_> = ctx
        .db
        .sale_order_line()
        .order_line_by_order()
        .filter(&sale_order_id)
        .filter(|l| l.qty_to_invoice > 0.0 && l.display_type.is_none())
        .collect();

    if invoiceable_lines.is_empty() {
        return Err("No lines to invoice on this sale order".to_string());
    }

    let journal = ctx
        .db
        .account_journal()
        .id()
        .find(&params.journal_id)
        .ok_or("Journal not found")?;

    let company = ctx
        .db
        .company()
        .id()
        .find(&order.company_id)
        .ok_or("Company not found")?;

    let partner_display_name = ctx
        .db
        .contact()
        .id()
        .find(&order.partner_invoice_id)
        .map(|c| c.display_name.clone());

    let move_record = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: String::new(), // auto-assigned on post
        ref_: order.client_order_ref.clone(),
        move_type: MoveType::OutInvoice,
        auto_post: false,
        state: AccountMoveState::Draft,
        date: ctx.timestamp,
        invoice_date: None,
        invoice_date_due: None,
        invoice_payment_term_id: order.payment_term_id,
        invoice_origin: Some(format!("SO{}", sale_order_id)),
        invoice_partner_display_name: partner_display_name.clone(),
        invoice_cash_rounding_id: None,
        payment_reference: None,
        partner_shipping_id: Some(order.partner_shipping_id),
        sale_order_id: Some(sale_order_id),
        partner_id: Some(order.partner_invoice_id),
        commercial_partner_id: Some(order.partner_invoice_id),
        partner_bank_id: None,
        fiscal_position_id: order.fiscal_position_id,
        invoice_user_id: Some(ctx.sender()),
        invoice_incoterm_id: order.incoterm_id,
        incoterm_location: order.incoterm_location.clone(),
        campaign_id: order.campaign_id,
        source_id: order.source_id,
        medium_id: order.medium_id,
        company_id: order.company_id,
        journal_id: params.journal_id,
        currency_id: journal.currency_id.unwrap_or(order.currency_id),
        company_currency_id: company.currency_id,
        amount_untaxed: 0.0,
        amount_tax: 0.0,
        amount_total: 0.0,
        amount_residual: 0.0,
        amount_untaxed_signed: 0.0,
        amount_tax_signed: 0.0,
        amount_total_signed: 0.0,
        amount_total_in_currency_signed: 0.0,
        amount_residual_signed: 0.0,
        to_check: false,
        posted_before: false,
        is_storno: false,
        is_move_sent: false,
        secure_sequence_number: None,
        invoice_has_outstanding: false,
        payment_state: PaymentState::NotPaid,
        restrict_mode_hash_table: journal.restrict_mode_hash_table,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata.clone().or_else(|| order.note.clone()),
    });

    let mut amount_untaxed = 0.0f64;
    let mut amount_tax = 0.0f64;
    let invoice_line_count = invoiceable_lines.len();

    for (seq, line) in invoiceable_lines.into_iter().enumerate() {
        let qty = line.qty_to_invoice;
        let subtotal = qty * line.price_unit * (1.0 - line.discount / 100.0);
        let tax_amount = calculate_tax(ctx, &line.tax_id, subtotal);
        let tax_ids = line.tax_id.clone();
        let analytic_tag_ids = line.analytic_tag_ids.clone();
        let is_downpayment = line.is_downpayment;
        let product_id = line.product_id;
        let product_uom = line.product_uom;
        let line_name = line.name.clone();
        let line_discount = line.discount;
        let qty_invoiced_prev = line.qty_invoiced;

        let mut line_params = params.income_line.clone();
        line_params.account_id = params.default_income_account_id;
        line_params.name = line_name;
        line_params.debit = 0.0;
        line_params.credit = subtotal;
        line_params.sequence = seq as u32;
        line_params.quantity = qty;
        line_params.price_unit = line.price_unit;
        line_params.discount = line_discount;
        line_params.tax_ids = tax_ids;
        if line_params.partner_id.is_none() {
            line_params.partner_id = Some(order.partner_invoice_id);
        }
        line_params.product_id = Some(product_id);
        line_params.product_uom_id = Some(product_uom);
        line_params.is_downpayment = is_downpayment;
        if line_params.analytic_account_id.is_none() {
            line_params.analytic_account_id = order.analytic_account_id;
        }
        if line_params.analytic_tag_ids.is_empty() {
            line_params.analytic_tag_ids = analytic_tag_ids;
        }

        insert_draft_account_move_line(ctx, &move_record, line_params)?;

        ctx.db
            .sale_order_line()
            .id()
            .update(crate::sales::sales_core::SaleOrderLine {
                qty_invoiced: qty_invoiced_prev + qty,
                qty_to_invoice: 0.0,
                invoice_status: LineInvoiceStatus::Invoiced,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..line
            });

        amount_untaxed += subtotal;
        amount_tax += tax_amount;
    }

    let amount_total = amount_untaxed + amount_tax;

    let mut receivable_params = params.receivable_line.clone();
    receivable_params.debit = amount_total;
    receivable_params.credit = 0.0;
    receivable_params.sequence = invoice_line_count as u32;
    receivable_params.quantity = 1.0;
    receivable_params.price_unit = amount_total;
    if receivable_params.name.is_empty() {
        receivable_params.name = partner_display_name
            .clone()
            .unwrap_or_else(|| "Accounts Receivable".to_string());
    }
    if receivable_params.partner_id.is_none() {
        receivable_params.partner_id = Some(order.partner_invoice_id);
    }
    insert_draft_account_move_line(ctx, &move_record, receivable_params)?;

    // Update AccountMove totals
    ctx.db.account_move().id().update(AccountMove {
        amount_untaxed,
        amount_tax,
        amount_total,
        amount_residual: amount_total,
        amount_untaxed_signed: amount_untaxed,
        amount_tax_signed: amount_tax,
        amount_total_signed: amount_total,
        amount_total_in_currency_signed: amount_total,
        amount_residual_signed: amount_total,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..move_record.clone()
    });

    // Determine new invoice_status: all lines invoiced → Invoiced, else ToInvoice
    let any_remaining = ctx
        .db
        .sale_order_line()
        .order_line_by_order()
        .filter(&sale_order_id)
        .any(|l| l.qty_to_invoice > 0.0 && l.display_type.is_none());

    let new_invoice_status = if any_remaining {
        InvoiceStatus::ToInvoice
    } else {
        InvoiceStatus::Invoiced
    };

    // Update SaleOrder
    let mut updated_invoice_ids = order.invoice_ids.clone();
    updated_invoice_ids.push(move_record.id);
    let new_invoice_count = order.invoice_count + 1;
    let company_id = order.company_id;

    ctx.db
        .sale_order()
        .id()
        .update(crate::sales::sales_core::SaleOrder {
            invoice_ids: updated_invoice_ids,
            invoice_count: new_invoice_count,
            invoice_status: new_invoice_status,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..order
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_move",
            record_id: move_record.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "move_type": "OutInvoice",
                    "sale_order_id": sale_order_id,
                    "amount_total": amount_total,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "move_type".to_string(),
                "sale_order_id".to_string(),
                "amount_total".to_string(),
            ],
            metadata: None,
        },
    );

    log::info!(
        "Created invoice {} for sale order {}",
        move_record.id,
        sale_order_id
    );
    Ok(())
}

/// Create a vendor bill (InInvoice) from a confirmed Purchase Order.
///
/// Lines are created for any PO line where `qty_received > qty_invoiced`.
/// Returns an error if there are no uninvoiced received quantities.
#[spacetimedb::reducer]
pub fn create_bill_from_purchase_order(
    ctx: &ReducerContext,
    organization_id: u64,
    purchase_order_id: u64,
    params: CreateBillFromPurchaseOrderParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move", "create")?;

    let po = ctx
        .db
        .purchase_order()
        .id()
        .find(&purchase_order_id)
        .ok_or("Purchase order not found")?;

    if po.organization_id != organization_id {
        return Err("Purchase order does not belong to this organization".to_string());
    }

    use crate::types::PoState;
    if po.state != PoState::Purchase && po.state != PoState::Done {
        return Err("Purchase order must be confirmed before billing".to_string());
    }

    let billable_lines: Vec<_> = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&purchase_order_id)
        .filter(|l| l.qty_received > l.qty_invoiced)
        .collect();

    if billable_lines.is_empty() {
        return Err("No received quantity to bill on this purchase order".to_string());
    }

    let journal = ctx
        .db
        .account_journal()
        .id()
        .find(&params.journal_id)
        .ok_or("Journal not found")?;

    let company = ctx
        .db
        .company()
        .id()
        .find(&po.company_id)
        .ok_or("Company not found")?;

    let partner_display_name = ctx
        .db
        .contact()
        .id()
        .find(&po.partner_id)
        .map(|c| c.display_name.clone());

    let move_record = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: String::new(),
        ref_: po.partner_ref.clone(),
        move_type: MoveType::InInvoice,
        auto_post: false,
        state: AccountMoveState::Draft,
        date: ctx.timestamp,
        invoice_date: Some(params.invoice_date),
        invoice_date_due: None,
        invoice_payment_term_id: po.payment_term_id,
        invoice_origin: Some(format!("PO{}", purchase_order_id)),
        invoice_partner_display_name: partner_display_name.clone(),
        invoice_cash_rounding_id: None,
        payment_reference: None,
        partner_shipping_id: None,
        sale_order_id: None,
        partner_id: Some(po.partner_id),
        commercial_partner_id: Some(po.partner_id),
        partner_bank_id: None,
        fiscal_position_id: po.fiscal_position_id,
        invoice_user_id: Some(ctx.sender()),
        invoice_incoterm_id: po.incoterm_id,
        incoterm_location: po.incoterm_location.clone(),
        campaign_id: None,
        source_id: None,
        medium_id: None,
        company_id: po.company_id,
        journal_id: params.journal_id,
        currency_id: journal.currency_id.unwrap_or(po.currency_id),
        company_currency_id: company.currency_id,
        amount_untaxed: 0.0,
        amount_tax: 0.0,
        amount_total: 0.0,
        amount_residual: 0.0,
        amount_untaxed_signed: 0.0,
        amount_tax_signed: 0.0,
        amount_total_signed: 0.0,
        amount_total_in_currency_signed: 0.0,
        amount_residual_signed: 0.0,
        to_check: false,
        posted_before: false,
        is_storno: false,
        is_move_sent: false,
        secure_sequence_number: None,
        invoice_has_outstanding: false,
        payment_state: PaymentState::NotPaid,
        restrict_mode_hash_table: journal.restrict_mode_hash_table,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata.clone().or_else(|| po.notes.clone()),
    });

    let mut amount_untaxed = 0.0f64;
    let mut amount_tax = 0.0f64;
    let bill_line_count = billable_lines.len();

    for (seq, line) in billable_lines.into_iter().enumerate() {
        let qty = line.qty_received - line.qty_invoiced;
        let subtotal = qty * line.price_unit;
        let tax_amount = line.price_tax * (qty / line.product_qty.max(1.0));
        let analytic_tag_ids = line.analytic_tag_ids.clone();
        let account_analytic_id = line.account_analytic_id;
        let product_id = line.product_id;
        let product_uom = line.product_uom;
        let price_unit = line.price_unit;
        let qty_invoiced_prev = line.qty_invoiced;
        let product_qty = line.product_qty;

        let mut line_params = params.expense_line.clone();
        line_params.account_id = params.default_expense_account_id;
        line_params.name = format!("Product {}", product_id);
        line_params.debit = subtotal;
        line_params.credit = 0.0;
        line_params.sequence = seq as u32;
        line_params.quantity = qty;
        line_params.price_unit = price_unit;
        if line_params.partner_id.is_none() {
            line_params.partner_id = Some(po.partner_id);
        }
        line_params.product_id = Some(product_id);
        line_params.product_uom_id = Some(product_uom);
        if line_params.analytic_account_id.is_none() {
            line_params.analytic_account_id = account_analytic_id;
        }
        if line_params.analytic_tag_ids.is_empty() {
            line_params.analytic_tag_ids = analytic_tag_ids;
        }

        insert_draft_account_move_line(ctx, &move_record, line_params)?;

        ctx.db.purchase_order_line().id().update(
            crate::purchasing::purchase_orders::PurchaseOrderLine {
                qty_invoiced: qty_invoiced_prev + qty,
                qty_to_invoice: (product_qty - (qty_invoiced_prev + qty)).max(0.0),
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..line
            },
        );

        amount_untaxed += subtotal;
        amount_tax += tax_amount;
    }

    let amount_total = amount_untaxed + amount_tax;

    let mut payable_params = params.payable_line.clone();
    payable_params.credit = amount_total;
    payable_params.debit = 0.0;
    payable_params.sequence = bill_line_count as u32;
    payable_params.quantity = 1.0;
    payable_params.price_unit = amount_total;
    if payable_params.name.is_empty() {
        payable_params.name = partner_display_name
            .clone()
            .unwrap_or_else(|| "Accounts Payable".to_string());
    }
    if payable_params.partner_id.is_none() {
        payable_params.partner_id = Some(po.partner_id);
    }
    insert_draft_account_move_line(ctx, &move_record, payable_params)?;

    // Update AccountMove totals
    ctx.db.account_move().id().update(AccountMove {
        amount_untaxed,
        amount_tax,
        amount_total,
        amount_residual: amount_total,
        amount_untaxed_signed: amount_untaxed,
        amount_tax_signed: amount_tax,
        amount_total_signed: amount_total,
        amount_total_in_currency_signed: amount_total,
        amount_residual_signed: amount_total,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..move_record.clone()
    });

    // Update PO invoice tracking
    let all_invoiced = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&purchase_order_id)
        .all(|l| l.qty_received <= l.qty_invoiced);

    let new_invoice_status = if all_invoiced {
        PoInvoiceStatus::Invoiced
    } else {
        PoInvoiceStatus::Partial
    };

    let mut updated_invoice_ids = po.invoice_ids.clone();
    updated_invoice_ids.push(move_record.id);
    let new_invoice_count = po.invoice_count + 1;
    let company_id = po.company_id;

    ctx.db
        .purchase_order()
        .id()
        .update(crate::purchasing::purchase_orders::PurchaseOrder {
            invoice_ids: updated_invoice_ids,
            invoice_count: new_invoice_count,
            invoice_status: new_invoice_status,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..po
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_move",
            record_id: move_record.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "move_type": "InInvoice",
                    "purchase_order_id": purchase_order_id,
                    "amount_total": amount_total,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "move_type".to_string(),
                "purchase_order_id".to_string(),
                "amount_total".to_string(),
            ],
            metadata: None,
        },
    );

    log::info!(
        "Created bill {} for purchase order {}",
        move_record.id,
        purchase_order_id
    );
    Ok(())
}

fn inverted_move_line_params(line: &AccountMoveLine, sequence: u32) -> AddAccountMoveLineParams {
    AddAccountMoveLineParams {
        account_id: line.account_id,
        name: if line.name.starts_with("Credit: ") {
            line.name.clone()
        } else {
            format!("Credit: {}", line.name)
        },
        debit: line.credit,
        credit: line.debit,
        sequence,
        quantity: line.quantity,
        price_unit: line.price_unit,
        discount: line.discount,
        tax_ids: line.tax_ids.clone(),
        partner_id: line.partner_id,
        product_id: line.product_id,
        product_uom_id: line.product_uom_id,
        product_category_id: line.product_category_id,
        analytic_account_id: line.analytic_account_id,
        analytic_tag_ids: line.analytic_tag_ids.clone(),
        display_type: line.display_type.clone(),
        is_downpayment: line.is_downpayment,
        exclude_from_invoice_tab: line.exclude_from_invoice_tab,
        blocked: line.blocked,
        group_tax_id: line.group_tax_id,
        tax_line_id: line.tax_line_id,
        tax_group_id: line.tax_group_id,
        tax_repartition_line_id: line.tax_repartition_line_id,
        tax_audit: line.tax_audit.clone(),
        reconcile_model_id: line.reconcile_model_id,
        payment_id: line.payment_id,
        statement_line_id: line.statement_line_id,
        matching_number: line.matching_number.clone(),
        matching_label: line.matching_label.clone(),
        expected_pay_date: line.expected_pay_date,
        expected_pay_date_currency_id: line.expected_pay_date_currency_id,
        expected_pay_date_amount: line.expected_pay_date_amount,
        expected_pay_date_residual: line.expected_pay_date_residual,
        metadata: line.metadata.clone(),
    }
}

/// Create a draft customer credit note (OutRefund) reversing a posted customer invoice.
#[spacetimedb::reducer]
pub fn create_credit_note_from_invoice(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    invoice_id: u64,
    params: CreateCreditNoteParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move", "create")?;

    let source = ctx
        .db
        .account_move()
        .id()
        .find(&invoice_id)
        .ok_or("Invoice not found")?;

    if source.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    if source.move_type != MoveType::OutInvoice {
        return Err("Credit notes can only be created from customer invoices".to_string());
    }

    if source.state != AccountMoveState::Posted {
        return Err("Invoice must be posted before creating a credit note".to_string());
    }

    let all_lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&invoice_id)
        .collect();

    if all_lines.is_empty() {
        return Err("Invoice has no lines".to_string());
    }

    let metadata = Some(
        serde_json::json!({
            "reversed_entry_id": invoice_id,
            "reason": params.reason,
        })
        .to_string(),
    );

    let credit_note = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: String::new(),
        ref_: source.ref_.clone(),
        move_type: MoveType::OutRefund,
        auto_post: false,
        state: AccountMoveState::Draft,
        date: ctx.timestamp,
        invoice_date: source.invoice_date,
        invoice_date_due: source.invoice_date_due,
        invoice_payment_term_id: source.invoice_payment_term_id,
        invoice_origin: Some(format!("Reversal of {}", source.name)),
        invoice_partner_display_name: source.invoice_partner_display_name.clone(),
        invoice_cash_rounding_id: source.invoice_cash_rounding_id,
        payment_reference: source.payment_reference.clone(),
        partner_shipping_id: source.partner_shipping_id,
        sale_order_id: source.sale_order_id,
        partner_id: source.partner_id,
        commercial_partner_id: source.commercial_partner_id,
        partner_bank_id: source.partner_bank_id,
        fiscal_position_id: source.fiscal_position_id,
        invoice_user_id: Some(ctx.sender()),
        invoice_incoterm_id: source.invoice_incoterm_id,
        incoterm_location: source.incoterm_location.clone(),
        campaign_id: source.campaign_id,
        source_id: source.source_id,
        medium_id: source.medium_id,
        company_id: source.company_id,
        journal_id: source.journal_id,
        currency_id: source.currency_id,
        company_currency_id: source.company_currency_id,
        amount_untaxed: 0.0,
        amount_tax: 0.0,
        amount_total: 0.0,
        amount_residual: 0.0,
        amount_untaxed_signed: 0.0,
        amount_tax_signed: 0.0,
        amount_total_signed: 0.0,
        amount_total_in_currency_signed: 0.0,
        amount_residual_signed: 0.0,
        to_check: false,
        posted_before: false,
        is_storno: false,
        is_move_sent: false,
        secure_sequence_number: None,
        invoice_has_outstanding: false,
        payment_state: PaymentState::NotPaid,
        restrict_mode_hash_table: source.restrict_mode_hash_table,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: metadata.clone(),
    });

    let full_reversal = params.line_ids.is_empty();
    let mut amount_untaxed = 0.0f64;
    let mut amount_tax = 0.0f64;
    let amount_total;
    let mut sequence = 0u32;

    if full_reversal {
        for line in &all_lines {
            insert_draft_account_move_line(
                ctx,
                &credit_note,
                inverted_move_line_params(line, sequence),
            )?;
            sequence += 1;
        }
        amount_untaxed = source.amount_untaxed;
        amount_tax = source.amount_tax;
        amount_total = source.amount_total;
    } else {
        let selected: Vec<_> = all_lines
            .iter()
            .filter(|line| params.line_ids.contains(&line.id))
            .collect();

        if selected.is_empty() {
            return Err("No matching invoice lines found for credit note".to_string());
        }

        let mut receivable_credit = 0.0f64;
        for line in selected {
            let line_amount = line.debit.max(line.credit).max(line.price_subtotal.abs());
            receivable_credit += line_amount;
            if line.product_id.is_some() && line.display_type.is_none() {
                amount_untaxed += line.price_subtotal.abs();
            }
            insert_draft_account_move_line(
                ctx,
                &credit_note,
                inverted_move_line_params(line, sequence),
            )?;
            sequence += 1;
        }

        let receivable_source = all_lines
            .iter()
            .find(|line| line.product_id.is_none() && line.debit > line.credit)
            .or_else(|| all_lines.iter().find(|line| line.debit > line.credit));

        let receivable_account_id = receivable_source
            .map(|line| line.account_id)
            .ok_or("Could not resolve receivable account on source invoice")?;

        let receivable_partner = receivable_source
            .and_then(|line| line.partner_id)
            .or(source.partner_id);

        insert_draft_account_move_line(
            ctx,
            &credit_note,
            AddAccountMoveLineParams {
                account_id: receivable_account_id,
                name: format!(
                    "Credit: {}",
                    source
                        .invoice_partner_display_name
                        .clone()
                        .unwrap_or_else(|| "Accounts Receivable".to_string())
                ),
                debit: 0.0,
                credit: receivable_credit,
                sequence,
                quantity: 1.0,
                price_unit: receivable_credit,
                discount: 0.0,
                tax_ids: Vec::new(),
                partner_id: receivable_partner,
                product_id: None,
                product_uom_id: None,
                product_category_id: None,
                analytic_account_id: None,
                analytic_tag_ids: Vec::new(),
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
            },
        )?;

        amount_total = receivable_credit;
    }

    ctx.db.account_move().id().update(AccountMove {
        amount_untaxed,
        amount_tax,
        amount_total,
        amount_residual: amount_total,
        amount_untaxed_signed: amount_untaxed,
        amount_tax_signed: amount_tax,
        amount_total_signed: amount_total,
        amount_total_in_currency_signed: amount_total,
        amount_residual_signed: amount_total,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..credit_note.clone()
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_move",
            record_id: credit_note.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "move_type": "OutRefund",
                    "reversed_entry_id": invoice_id,
                    "amount_total": amount_total,
                    "reason": params.reason,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "move_type".to_string(),
                "reversed_entry_id".to_string(),
                "amount_total".to_string(),
            ],
            metadata: None,
        },
    );

    log::info!(
        "Created credit note {} from invoice {}",
        credit_note.id,
        invoice_id
    );
    Ok(())
}

/// Match Debug (`Receivable`) or snake (`receivable`) stamps on move lines.
fn is_receivable_or_payable_line_type(account_internal_type: Option<&str>) -> bool {
    account_internal_type.is_some_and(|t| {
        t.eq_ignore_ascii_case("receivable") || t.eq_ignore_ascii_case("payable")
    })
}

/// Reconcile a payment AccountMove against an invoice AccountMove.
///
/// Marks the receivable/payable lines as matched and updates the invoice's
/// `payment_state` to `Partial` or `Paid` depending on remaining residual.
#[spacetimedb::reducer]
pub fn reconcile_payment_with_invoice(
    ctx: &ReducerContext,
    organization_id: u64,
    payment_move_id: u64,
    invoice_move_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move", "write")?;

    let payment_move = ctx
        .db
        .account_move()
        .id()
        .find(&payment_move_id)
        .ok_or("Payment move not found")?;

    let invoice_move = ctx
        .db
        .account_move()
        .id()
        .find(&invoice_move_id)
        .ok_or("Invoice move not found")?;

    if payment_move.organization_id != organization_id
        || invoice_move.organization_id != organization_id
    {
        return Err("Payment or invoice move belongs to a different organization".to_string());
    }
    if payment_move.company_id != invoice_move.company_id {
        return Err("Payment and invoice must belong to the same company".to_string());
    }

    if payment_move.state != AccountMoveState::Posted {
        return Err("Payment move must be posted".to_string());
    }
    if invoice_move.state != AccountMoveState::Posted {
        return Err("Invoice move must be posted".to_string());
    }

    let matching_number = format!("MATCH-{}-{}", payment_move_id, invoice_move_id);

    // Find the receivable/payable line on the invoice
    let invoice_lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&invoice_move_id)
        .filter(|l| is_receivable_or_payable_line_type(l.account_internal_type.as_deref()))
        .collect();

    // Find the matching line on the payment
    let payment_lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&payment_move_id)
        .filter(|l| is_receivable_or_payable_line_type(l.account_internal_type.as_deref()))
        .collect();

    if invoice_lines.is_empty() {
        return Err("Invoice has no receivable/payable lines to reconcile".to_string());
    }
    if payment_lines.is_empty() {
        return Err("Payment has no receivable/payable lines to reconcile".to_string());
    }

    let payment_amount: f64 = payment_lines.iter().map(|l| l.amount_residual.abs()).sum();

    let mut remaining_payment = payment_amount;

    for line in &invoice_lines {
        if remaining_payment <= 0.0 {
            break;
        }
        let apply = remaining_payment.min(line.amount_residual.abs());
        let new_residual = (line.amount_residual.abs() - apply).max(0.0);
        remaining_payment -= apply;

        ctx.db.account_move_line().id().update(AccountMoveLine {
            amount_residual: new_residual,
            amount_residual_currency: new_residual,
            matching_number: Some(matching_number.clone()),
            is_matching: new_residual == 0.0,
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            ..(*line).clone()
        });
    }

    // Mark payment lines as matched
    for line in &payment_lines {
        ctx.db.account_move_line().id().update(AccountMoveLine {
            matching_number: Some(matching_number.clone()),
            is_matching: true,
            amount_residual: 0.0,
            amount_residual_currency: 0.0,
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            ..(*line).clone()
        });
    }

    // Recompute invoice residual and payment_state
    let remaining_invoice_residual: f64 = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&invoice_move_id)
        .filter(|l| is_receivable_or_payable_line_type(l.account_internal_type.as_deref()))
        .map(|l| l.amount_residual.abs())
        .sum();

    let new_payment_state = if remaining_invoice_residual == 0.0 {
        PaymentState::Paid
    } else {
        PaymentState::Partial
    };

    // Update SO amount_paid / amount_residual if this invoice links to a SO
    if let Some(so_id) = invoice_move.sale_order_id {
        if let Some(so) = ctx.db.sale_order().id().find(&so_id) {
            let applied = payment_amount - remaining_payment.max(0.0);
            ctx.db
                .sale_order()
                .id()
                .update(crate::sales::sales_core::SaleOrder {
                    amount_paid: so.amount_paid + applied,
                    amount_residual: (so.amount_residual - applied).max(0.0),
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..so
                });
        }
    }

    let company_id = invoice_move.company_id;

    ctx.db.account_move().id().update(AccountMove {
        payment_state: new_payment_state,
        amount_residual: remaining_invoice_residual,
        amount_residual_signed: remaining_invoice_residual,
        invoice_has_outstanding: remaining_invoice_residual > 0.0,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..invoice_move
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_move",
            record_id: invoice_move_id,
            action: "RECONCILE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "payment_move_id": payment_move_id,
                    "matching_number": matching_number,
                })
                .to_string(),
            ),
            changed_fields: vec!["payment_state".to_string(), "amount_residual".to_string()],
            metadata: None,
        },
    );

    log::info!(
        "Reconciled payment {} against invoice {}",
        payment_move_id,
        invoice_move_id
    );
    Ok(())
}

/// Resolve sale tax IDs for T&M timesheet billing.
/// Explicit `tax_ids` win; otherwise the lowest-sequence active Sale tax for the company
/// (typically country-pack GST/VAT) is used so a non-zero tax path is available when configured.
fn resolve_timesheet_bill_tax_ids(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    explicit: &[u64],
) -> Vec<u64> {
    if !explicit.is_empty() {
        return explicit.to_vec();
    }
    let mut sale_taxes: Vec<_> = ctx
        .db
        .account_tax()
        .tax_by_company()
        .filter(&company_id)
        .filter(|t| {
            t.organization_id == organization_id && t.active && t.type_tax_use == TaxTypeUse::Sale
        })
        .collect();
    sale_taxes.sort_by_key(|t| t.sequence);
    sale_taxes
        .into_iter()
        .next()
        .map(|t| vec![t.id])
        .unwrap_or_default()
}

/// Create a customer invoice from validated billable timesheets.
///
/// Validates each timesheet (must be validated, billable, not yet invoiced),
/// creates an OutInvoice AccountMove with one line per timesheet priced from
/// `sell_rate`, applies sale tax, enforces an open accounting period, then marks
/// each timesheet with the resulting invoice id in the same transaction.
#[spacetimedb::reducer]
pub fn bill_timesheets(
    ctx: &ReducerContext,
    organization_id: u64,
    params: BillTimesheetsParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move", "create")?;

    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    if params.timesheet_ids.is_empty() {
        return Err("No timesheets provided".to_string());
    }

    let inv_date = params.invoice_date.unwrap_or(ctx.timestamp);
    ensure_accounting_period_open_for_date(ctx, company_id, inv_date)?;

    // Fetch and validate all timesheets upfront
    let mut billable_sheets: Vec<ProjectTimesheet> = Vec::new();
    for ts_id in &params.timesheet_ids {
        let ts = ctx
            .db
            .project_timesheet()
            .id()
            .find(ts_id)
            .ok_or_else(|| format!("Timesheet {} not found", ts_id))?;
        if ts.company_id != company_id {
            return Err(format!(
                "Timesheet {} does not belong to this company",
                ts_id
            ));
        }
        if ts.validation_status != "validated" {
            return Err(format!(
                "Timesheet {} must be validated before billing",
                ts_id
            ));
        }
        if ts.timesheet_invoice_type != "billable" {
            return Err(format!("Timesheet {} is not billable", ts_id));
        }
        if ts.timesheet_invoice_id.is_some() {
            return Err(format!("Timesheet {} is already invoiced", ts_id));
        }
        // Snapshot FX at bill if validate did not (e.g. legacy rows)
        let ts = ensure_timesheet_fx_snapshot(ctx, organization_id, ts)?;
        billable_sheets.push(ts);
    }

    // billable_sheets is guaranteed non-empty (checked above)
    let currency_id = billable_sheets[0].currency_id;
    if billable_sheets
        .iter()
        .any(|ts| ts.currency_id != currency_id)
    {
        return Err(
            "Mixed currencies across timesheet batch are not supported; bill separately per currency"
                .to_string(),
        );
    }

    let tax_ids = resolve_timesheet_bill_tax_ids(ctx, organization_id, company_id, &params.tax_ids);

    let company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;

    let mut amount_untaxed = 0.0f64;
    let mut amount_tax = 0.0f64;
    let mut line_amounts: Vec<(f64, f64)> = Vec::with_capacity(billable_sheets.len());
    for ts in &billable_sheets {
        let line_untaxed = ts.unit_amount * ts.sell_rate;
        let line_tax = calculate_tax(ctx, &tax_ids, line_untaxed);
        amount_untaxed += line_untaxed;
        amount_tax += line_tax;
        line_amounts.push((line_untaxed, line_tax));
    }
    let amount_total = amount_untaxed + amount_tax;

    let move_row = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: String::new(),
        ref_: None,
        move_type: MoveType::OutInvoice,
        auto_post: false,
        state: AccountMoveState::Draft,
        date: inv_date,
        invoice_date: Some(inv_date),
        invoice_date_due: None,
        invoice_payment_term_id: None,
        invoice_origin: Some("Timesheets".to_string()),
        invoice_partner_display_name: None,
        invoice_cash_rounding_id: None,
        payment_reference: None,
        partner_shipping_id: None,
        sale_order_id: None,
        partner_id: Some(params.partner_id),
        commercial_partner_id: Some(params.partner_id),
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
        currency_id,
        company_currency_id: company.currency_id,
        amount_untaxed,
        amount_tax,
        amount_total,
        amount_residual: amount_total,
        amount_untaxed_signed: amount_untaxed,
        amount_tax_signed: amount_tax,
        amount_total_signed: amount_total,
        amount_total_in_currency_signed: amount_total,
        amount_residual_signed: amount_total,
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
        metadata: None,
    });

    let move_id = move_row.id;

    // One AccountMoveLine per timesheet entry — priced from sell_rate (not cost)
    for (seq, ts) in billable_sheets.iter().enumerate() {
        let (line_untaxed, line_tax) = line_amounts[seq];
        let price_total = line_untaxed + line_tax;
        ctx.db.account_move_line().insert(AccountMoveLine {
            id: 0,
            organization_id,
            move_id,
            move_name: None,
            date: inv_date,
            ref_: None,
            parent_state: AccountMoveState::Draft,
            journal_id: params.journal_id,
            company_id,
            company_currency_id: company.currency_id,
            sequence: (seq + 1) as u32,
            name: ts.name.clone(),
            quantity: ts.unit_amount,
            price_unit: ts.sell_rate,
            price: line_untaxed,
            price_subtotal: line_untaxed,
            price_total,
            discount: 0.0,
            balance: line_untaxed,
            currency_id: ts.currency_id,
            amount_currency: line_untaxed,
            amount_residual: line_untaxed,
            amount_residual_currency: line_untaxed,
            debit: line_untaxed,
            credit: 0.0,
            debit_currency: line_untaxed,
            credit_currency: 0.0,
            tax_base_amount: line_untaxed,
            account_id: params.income_account_id,
            account_internal_type: None,
            account_internal_group: None,
            account_root_id: None,
            group_tax_id: None,
            tax_line_id: None,
            tax_group_id: None,
            tax_ids: tax_ids.clone(),
            tax_repartition_line_id: None,
            tax_audit: None,
            partner_id: Some(params.partner_id),
            commercial_partner_id: Some(params.partner_id),
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
            analytic_account_id: ts.account_id,
            analytic_tag_ids: vec![],
            product_id: ts.product_id,
            product_uom_id: ts.product_uom_id,
            product_category_id: None,
            cogs_amount: 0.0,
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: None,
        });
    }

    // Mark each timesheet as invoiced (atomic with move create)
    let mut project_ids: Vec<u64> = Vec::new();
    for ts in billable_sheets {
        project_ids.push(ts.project_id);
        ctx.db.project_timesheet().id().update(ProjectTimesheet {
            timesheet_invoice_id: Some(move_id),
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
                    "move_type": "OutInvoice",
                    "timesheet_count": params.timesheet_ids.len(),
                    "amount_untaxed": amount_untaxed,
                    "amount_tax": amount_tax,
                    "amount_total": amount_total,
                    "currency_id": currency_id,
                    "tax_ids": tax_ids,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "amount_untaxed".to_string(),
                "amount_tax".to_string(),
                "amount_total".to_string(),
                "timesheet_invoice_id".to_string(),
            ],
            metadata: None,
        },
    );

    refresh_project_margin_for_projects(ctx, organization_id, company_id, project_ids);

    log::info!(
        "Created invoice {} from {} timesheets (untaxed: {}, tax: {}, total: {})",
        move_id,
        params.timesheet_ids.len(),
        amount_untaxed,
        amount_tax,
        amount_total
    );
    Ok(())
}

/// Create a draft OutInvoice from a project milestone (fixed-fee / % complete).
/// Reuses period lock + tax patterns from `bill_timesheets`; does not fork AR.
#[spacetimedb::reducer]
pub fn bill_project_milestone(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    milestone_id: u64,
    params: BillProjectMilestoneParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move", "create")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

    let milestone = ctx
        .db
        .project_milestone()
        .id()
        .find(&milestone_id)
        .ok_or("Milestone not found")?;
    if milestone.organization_id != organization_id {
        return Err("Milestone does not belong to this organization".to_string());
    }
    if milestone.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if milestone.invoice_move_id.is_some() {
        return Err("Milestone is already billed".to_string());
    }
    if !milestone.active {
        return Err("Milestone is inactive".to_string());
    }

    let project = ctx
        .db
        .project_project()
        .id()
        .find(&milestone.project_id)
        .ok_or("Project not found")?;
    if project.company_id != company_id {
        return Err("Project does not belong to this company".to_string());
    }

    let percent = params
        .percent_complete
        .unwrap_or(if milestone.percent_complete > 0.0 {
            milestone.percent_complete
        } else {
            100.0
        });
    if percent <= 0.0 || percent > 100.0 {
        return Err("percent_complete must be between 0 and 100".to_string());
    }

    let amount_untaxed = match params.amount {
        Some(a) if a > 0.0 => a,
        Some(_) => return Err("amount must be positive".to_string()),
        None => {
            if milestone.bill_amount <= 0.0 {
                return Err(
                    "Milestone bill_amount must be set (or pass amount in params)".to_string(),
                );
            }
            milestone.bill_amount * (percent / 100.0)
        }
    };

    let partner_id = params
        .partner_id
        .or(project.partner_id)
        .ok_or("Milestone bill requires partner_id (project or params)")?;

    let inv_date = params.invoice_date.unwrap_or(ctx.timestamp);
    ensure_accounting_period_open_for_date(ctx, company_id, inv_date)?;

    let tax_ids = resolve_timesheet_bill_tax_ids(ctx, organization_id, company_id, &params.tax_ids);
    let amount_tax = calculate_tax(ctx, &tax_ids, amount_untaxed);
    let amount_total = amount_untaxed + amount_tax;

    let company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;

    let move_row = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: String::new(),
        ref_: Some(format!("MS-{}", milestone.id)),
        move_type: MoveType::OutInvoice,
        auto_post: false,
        state: AccountMoveState::Draft,
        date: inv_date,
        invoice_date: Some(inv_date),
        invoice_date_due: None,
        invoice_payment_term_id: None,
        invoice_origin: Some(format!("Milestone: {}", milestone.name)),
        invoice_partner_display_name: None,
        invoice_cash_rounding_id: None,
        payment_reference: None,
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
        currency_id: project.currency_id,
        company_currency_id: company.currency_id,
        amount_untaxed,
        amount_tax,
        amount_total,
        amount_residual: amount_total,
        amount_untaxed_signed: amount_untaxed,
        amount_tax_signed: amount_tax,
        amount_total_signed: amount_total,
        amount_total_in_currency_signed: amount_total,
        amount_residual_signed: amount_total,
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
                "kind": "project_milestone_bill",
                "milestone_id": milestone_id,
                "project_id": milestone.project_id,
                "percent_complete": percent,
            })
            .to_string(),
        ),
    });
    let move_id = move_row.id;

    let price_total = amount_untaxed + amount_tax;
    ctx.db.account_move_line().insert(AccountMoveLine {
        id: 0,
        organization_id,
        move_id,
        move_name: None,
        date: inv_date,
        ref_: None,
        parent_state: AccountMoveState::Draft,
        journal_id: params.journal_id,
        company_id,
        company_currency_id: company.currency_id,
        sequence: 1,
        name: format!("{} ({:.0}%)", milestone.name, percent),
        quantity: 1.0,
        price_unit: amount_untaxed,
        price: amount_untaxed,
        price_subtotal: amount_untaxed,
        price_total,
        discount: 0.0,
        balance: amount_untaxed,
        currency_id: project.currency_id,
        amount_currency: amount_untaxed,
        amount_residual: amount_untaxed,
        amount_residual_currency: amount_untaxed,
        debit: amount_untaxed,
        credit: 0.0,
        debit_currency: amount_untaxed,
        credit_currency: 0.0,
        tax_base_amount: amount_untaxed,
        account_id: params.income_account_id,
        account_internal_type: None,
        account_internal_group: None,
        account_root_id: None,
        group_tax_id: None,
        tax_line_id: None,
        tax_group_id: None,
        tax_ids: tax_ids.clone(),
        tax_repartition_line_id: None,
        tax_audit: None,
        partner_id: Some(partner_id),
        commercial_partner_id: Some(partner_id),
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
        analytic_account_id: project.analytic_account_id,
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

    let project_id = milestone.project_id;
    ctx.db.project_milestone().id().update(ProjectMilestone {
        invoice_move_id: Some(move_id),
        billed_amount: amount_untaxed,
        percent_complete: percent,
        is_reached: true,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..milestone
    });

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
                    "move_type": "OutInvoice",
                    "kind": "project_milestone_bill",
                    "milestone_id": milestone_id,
                    "amount_untaxed": amount_untaxed,
                    "amount_tax": amount_tax,
                    "percent_complete": percent,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "amount_untaxed".to_string(),
                "amount_tax".to_string(),
                "milestone_invoice".to_string(),
            ],
            metadata: None,
        },
    );

    refresh_project_margin_for_projects(ctx, organization_id, company_id, [project_id]);

    log::info!(
        "Created milestone invoice {} for milestone {} (untaxed: {}, tax: {})",
        move_id,
        milestone_id,
        amount_untaxed,
        amount_tax
    );
    Ok(())
}
