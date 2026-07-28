/// Financial Statements — FinancialReport, TrialBalance
///
/// # 8.6 Financial Statements
///
/// Tables for generating and storing financial reports including
/// balance sheets, profit & loss statements, cash flow statements,
/// and trial balances.
///
/// ## Tables
/// - `FinancialReport` — Report configurations and generated data
/// - `TrialBalance` — Trial balance entries per account
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::analytic_accounting::account_analytic_account;
use crate::accounting::chart_of_accounts::{account_account, account_journal};
use crate::accounting::journal_entries::{account_move, account_move_line};
use crate::core::organization::require_company_in_organization;
use crate::core::reference::{legacy_currency_code_for_id, require_currency_row};
use crate::crm::contacts::contact;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::{AccountInternalGroup, AccountMoveState, MoveType, ReportState, ReportType};

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = financial_report,
    public,
    index(accessor = financial_report_by_org, btree(columns = [organization_id])),
    index(accessor = financial_report_by_type, btree(columns = [report_type])),
    index(accessor = financial_report_by_company, btree(columns = [company_id])),
    index(accessor = financial_report_by_state, btree(columns = [state])),
    index(accessor = financial_report_by_date, btree(columns = [date_from, date_to]))
)]
#[derive(Clone)]
pub struct FinancialReport {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// Tenant isolation
    pub organization_id: u64,
    pub name: String,
    pub report_type: ReportType,
    pub date_from: Timestamp,
    pub date_to: Timestamp,
    pub company_id: u64,
    pub currency_id: u64,
    pub target_move: String,     // "posted", "all"
    pub comparison_mode: String, // "none", "previous_period", "previous_year"
    pub filter_analytic_account_ids: Vec<u64>,
    pub filter_account_ids: Vec<u64>,
    pub filter_partner_ids: Vec<u64>,
    pub filter_journal_ids: Vec<u64>,
    pub hierarchy_level: u8, // 0-9, depth of account hierarchy to show
    pub show_zero_lines: bool,
    pub show_hierarchy: bool,
    pub show_percentage: bool,
    pub show_debit_credit: bool,
    pub result_currency_id: u64,
    pub state: ReportState,
    pub generated_by: Option<Identity>,
    pub generated_at: Option<Timestamp>,
    pub report_data: Option<String>, // JSON representation of the report
    pub export_format: Option<String>, // "pdf", "xlsx", "csv"
    pub exported_file_url: Option<String>,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = trial_balance,
    public,
    index(accessor = trial_balance_by_org, btree(columns = [organization_id])),
    index(accessor = trial_balance_by_account, btree(columns = [account_id])),
    index(accessor = trial_balance_by_company, btree(columns = [company_id])),
    index(accessor = trial_balance_by_report, btree(columns = [report_id])),
    index(accessor = trial_balance_by_parent, btree(columns = [parent_id]))
)]
pub struct TrialBalance {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// Tenant isolation
    pub organization_id: u64,
    pub report_id: u64,
    pub account_id: u64,
    pub account_code: String,
    pub account_name: String,
    pub opening_debit: f64,
    pub opening_credit: f64,
    pub period_debit: f64,
    pub period_credit: f64,
    pub closing_debit: f64,
    pub closing_credit: f64,
    pub currency_id: u64,
    pub parent_id: Option<u64>,
    pub level: u8,
    pub is_leaf: bool,
    pub company_id: u64,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = balance_sheet_line,
    public,
    index(accessor = balance_sheet_line_by_org, btree(columns = [organization_id])),
    index(accessor = balance_sheet_by_report, btree(columns = [report_id])),
    index(accessor = balance_sheet_by_account, btree(columns = [account_id])),
    index(accessor = balance_sheet_by_parent, btree(columns = [parent_id]))
)]
pub struct BalanceSheetLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// Tenant isolation
    pub organization_id: u64,
    pub report_id: u64,
    pub sequence: u32,
    pub name: String,
    pub account_id: Option<u64>,
    pub account_codes: Vec<String>,
    pub line_type: String, // "asset", "liability", "equity", "total", "subtotal"
    pub parent_id: Option<u64>,
    pub level: u8,
    pub is_leaf: bool,
    pub amount: f64,
    pub comparison_amount: f64,
    pub variance: f64,
    pub variance_percentage: f64,
    pub company_id: u64,
    pub currency_id: u64,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = profit_loss_line,
    public,
    index(accessor = profit_loss_line_by_org, btree(columns = [organization_id])),
    index(accessor = profit_loss_by_report, btree(columns = [report_id])),
    index(accessor = profit_loss_by_account, btree(columns = [account_id])),
    index(accessor = profit_loss_by_parent, btree(columns = [parent_id]))
)]
pub struct ProfitLossLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// Tenant isolation
    pub organization_id: u64,
    pub report_id: u64,
    pub sequence: u32,
    pub name: String,
    pub account_id: Option<u64>,
    pub account_codes: Vec<String>,
    pub line_type: String, // "income", "expense", "gross_profit", "operating_income", "net_income", "total", "subtotal"
    pub parent_id: Option<u64>,
    pub level: u8,
    pub is_leaf: bool,
    pub amount: f64,
    pub comparison_amount: f64,
    pub variance: f64,
    pub variance_percentage: f64,
    pub company_id: u64,
    pub currency_id: u64,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = cash_flow_line,
    public,
    index(accessor = cash_flow_line_by_org, btree(columns = [organization_id])),
    index(accessor = cash_flow_by_report, btree(columns = [report_id])),
    index(accessor = cash_flow_by_parent, btree(columns = [parent_id]))
)]
pub struct CashFlowLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// Tenant isolation
    pub organization_id: u64,
    pub report_id: u64,
    pub sequence: u32,
    pub name: String,
    pub line_type: String, // "operating", "investing", "financing", "total", "subtotal"
    pub parent_id: Option<u64>,
    pub level: u8,
    pub is_leaf: bool,
    pub amount: f64,
    pub comparison_amount: f64,
    pub variance: f64,
    pub variance_percentage: f64,
    pub company_id: u64,
    pub currency_id: u64,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

// Note: ReportTemplate table is defined in analytics/reports.rs

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateFinancialReportParams {
    pub name: String,
    pub report_type: ReportType,
    pub date_from: Timestamp,
    pub date_to: Timestamp,
    pub currency_id: u64,
    pub target_move: String,
    pub comparison_mode: String,
    pub filter_analytic_account_ids: Vec<u64>,
    pub filter_account_ids: Vec<u64>,
    pub filter_partner_ids: Vec<u64>,
    pub filter_journal_ids: Vec<u64>,
    pub hierarchy_level: u8,
    pub show_zero_lines: bool,
    pub show_hierarchy: bool,
    pub show_percentage: bool,
    pub show_debit_credit: bool,
    pub report_data: Option<String>,
    pub export_format: Option<String>,
    pub exported_file_url: Option<String>,
    pub result_currency_id: u64,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateFinancialReportParams {
    pub name: Option<String>,
    pub date_from: Option<Timestamp>,
    pub date_to: Option<Timestamp>,
    pub target_move: Option<String>,
    pub comparison_mode: Option<String>,
    pub filter_analytic_account_ids: Option<Vec<u64>>,
    pub filter_account_ids: Option<Vec<u64>>,
    pub filter_partner_ids: Option<Vec<u64>>,
    pub filter_journal_ids: Option<Vec<u64>>,
    pub hierarchy_level: Option<u8>,
    pub show_zero_lines: Option<bool>,
    pub show_hierarchy: Option<bool>,
    pub show_percentage: Option<bool>,
    pub show_debit_credit: Option<bool>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateTrialBalanceEntryParams {
    pub report_id: u64,
    pub account_id: u64,
    pub account_code: String,
    pub account_name: String,
    pub opening_debit: f64,
    pub opening_credit: f64,
    pub period_debit: f64,
    pub period_credit: f64,
    pub currency_id: u64,
    pub parent_id: Option<u64>,
    pub level: u8,
    pub is_leaf: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ExportFinancialReportParams {
    pub export_format: String,
}

fn validate_report_currency_id(ctx: &ReducerContext, currency_id: u64) -> Result<(), String> {
    if !(1..=9).contains(&currency_id) {
        return Err("currency is not supported".to_string());
    }
    let currency = require_currency_row(ctx, legacy_currency_code_for_id(currency_id))?;
    if !currency.active {
        return Err("currency is inactive".to_string());
    }
    Ok(())
}

struct ReportFilterRefs<'a> {
    currency_id: u64,
    result_currency_id: u64,
    analytic_account_ids: &'a [u64],
    account_ids: &'a [u64],
    partner_ids: &'a [u64],
    journal_ids: &'a [u64],
}

fn validate_report_filters(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    filters: ReportFilterRefs<'_>,
) -> Result<(), String> {
    require_company_in_organization(ctx, organization_id, company_id)?;
    validate_report_currency_id(ctx, filters.currency_id)?;
    validate_report_currency_id(ctx, filters.result_currency_id)?;

    for account_id in filters.account_ids {
        let account = ctx
            .db
            .account_account()
            .id()
            .find(account_id)
            .ok_or("account filter not found")?;
        if account.organization_id != organization_id || account.company_id != company_id {
            return Err(
                "account filter does not belong to this organization and company".to_string(),
            );
        }
        if account.deprecated {
            return Err("account filter is deprecated".to_string());
        }
    }

    for analytic_account_id in filters.analytic_account_ids {
        let analytic_account = ctx
            .db
            .account_analytic_account()
            .id()
            .find(analytic_account_id)
            .ok_or("analytic account filter not found")?;
        if analytic_account.organization_id != organization_id
            || analytic_account.company_id != company_id
        {
            return Err(
                "analytic account filter does not belong to this organization and company"
                    .to_string(),
            );
        }
        if !analytic_account.active {
            return Err("analytic account filter is inactive".to_string());
        }
    }

    for partner_id in filters.partner_ids {
        let partner = ctx
            .db
            .contact()
            .id()
            .find(partner_id)
            .ok_or("partner filter not found")?;
        if partner.organization_id != organization_id
            || partner
                .company_id
                .is_some_and(|partner_company_id| partner_company_id != company_id)
        {
            return Err(
                "partner filter does not belong to this organization and company".to_string(),
            );
        }
        if partner.deleted_at.is_some() || partner.merge_target_id.is_some() {
            return Err("partner filter is inactive".to_string());
        }
    }

    for journal_id in filters.journal_ids {
        let journal = ctx
            .db
            .account_journal()
            .id()
            .find(journal_id)
            .ok_or("journal filter not found")?;
        if journal.organization_id != organization_id || journal.company_id != company_id {
            return Err(
                "journal filter does not belong to this organization and company".to_string(),
            );
        }
        if !journal.active {
            return Err("journal filter is inactive".to_string());
        }
    }

    Ok(())
}

fn line_matches_report_filters(
    line: &crate::accounting::journal_entries::AccountMoveLine,
    report: &FinancialReport,
) -> bool {
    (report.filter_account_ids.is_empty() || report.filter_account_ids.contains(&line.account_id))
        && (report.filter_analytic_account_ids.is_empty()
            || line
                .analytic_account_id
                .is_some_and(|id| report.filter_analytic_account_ids.contains(&id)))
        && (report.filter_partner_ids.is_empty()
            || line
                .partner_id
                .is_some_and(|id| report.filter_partner_ids.contains(&id)))
        && (report.filter_journal_ids.is_empty()
            || report.filter_journal_ids.contains(&line.journal_id))
}

fn scoped_parent_move_for_report(
    ctx: &ReducerContext,
    line: &crate::accounting::journal_entries::AccountMoveLine,
    report: &FinancialReport,
) -> Option<crate::accounting::journal_entries::AccountMove> {
    if line.organization_id != report.organization_id || line.company_id != report.company_id {
        return None;
    }
    let parent = ctx.db.account_move().id().find(&line.move_id)?;
    if parent.organization_id != report.organization_id
        || parent.company_id != report.company_id
        || parent.journal_id != line.journal_id
    {
        return None;
    }
    Some(parent)
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Create a new financial report configuration
#[spacetimedb::reducer]
pub fn create_financial_report(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateFinancialReportParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "financial_report", "create")?;
    validate_report_filters(
        ctx,
        organization_id,
        company_id,
        ReportFilterRefs {
            currency_id: params.currency_id,
            result_currency_id: params.result_currency_id,
            analytic_account_ids: &params.filter_analytic_account_ids,
            account_ids: &params.filter_account_ids,
            partner_ids: &params.filter_partner_ids,
            journal_ids: &params.filter_journal_ids,
        },
    )?;

    if params.name.is_empty() {
        return Err("Report name is required".to_string());
    }

    if params.date_to <= params.date_from {
        return Err("End date must be after start date".to_string());
    }

    if params.target_move != "posted" && params.target_move != "all" {
        return Err("target_move must be 'posted' or 'all'".to_string());
    }

    let valid_comparison_modes = ["none", "previous_period", "previous_year"];
    if !valid_comparison_modes.contains(&params.comparison_mode.as_str()) {
        return Err(format!(
            "Invalid comparison_mode. Must be one of: {}",
            valid_comparison_modes.join(", ")
        ));
    }

    if params.hierarchy_level > 9 {
        return Err("Hierarchy level must be between 0 and 9".to_string());
    }

    let report = ctx.db.financial_report().insert(FinancialReport {
        id: 0,
        organization_id,
        name: params.name.clone(),
        report_type: params.report_type.clone(),
        date_from: params.date_from,
        date_to: params.date_to,
        company_id,
        currency_id: params.currency_id,
        target_move: params.target_move.clone(),
        comparison_mode: params.comparison_mode.clone(),
        filter_analytic_account_ids: params.filter_analytic_account_ids.clone(),
        filter_account_ids: params.filter_account_ids.clone(),
        filter_partner_ids: params.filter_partner_ids.clone(),
        filter_journal_ids: params.filter_journal_ids.clone(),
        hierarchy_level: params.hierarchy_level,
        show_zero_lines: params.show_zero_lines,
        show_hierarchy: params.show_hierarchy,
        show_percentage: params.show_percentage,
        show_debit_credit: params.show_debit_credit,
        result_currency_id: params.result_currency_id,
        state: ReportState::Draft,
        generated_by: Option::from(ctx.sender().clone()),
        generated_at: Some(ctx.timestamp),
        report_data: params.report_data,
        export_format: params.export_format,
        exported_file_url: params.exported_file_url,
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
            table_name: "financial_report",
            record_id: report.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": params.name,
                    "report_type": format!("{:?}", params.report_type),
                    "date_from": format!("{:?}", params.date_from),
                    "date_to": format!("{:?}", params.date_to)
                })
                .to_string(),
            ),
            changed_fields: vec![
                "name".to_string(),
                "report_type".to_string(),
                "date_from".to_string(),
                "date_to".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

/// Update a financial report configuration
#[spacetimedb::reducer]
pub fn update_financial_report(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    report_id: u64,
    params: UpdateFinancialReportParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "financial_report", "write")?;

    let mut report = ctx
        .db
        .financial_report()
        .id()
        .find(&report_id)
        .ok_or("Financial report not found")?;

    if report.organization_id != organization_id {
        return Err("Report does not belong to this organization".to_string());
    }

    if report.company_id != company_id {
        return Err("Report does not belong to this company".to_string());
    }

    if report.state != ReportState::Draft {
        return Err("Can only modify reports in Draft state".to_string());
    }

    validate_report_filters(
        ctx,
        report.organization_id,
        report.company_id,
        ReportFilterRefs {
            currency_id: report.currency_id,
            result_currency_id: report.result_currency_id,
            analytic_account_ids: params
                .filter_analytic_account_ids
                .as_deref()
                .unwrap_or(&report.filter_analytic_account_ids),
            account_ids: params
                .filter_account_ids
                .as_deref()
                .unwrap_or(&report.filter_account_ids),
            partner_ids: params
                .filter_partner_ids
                .as_deref()
                .unwrap_or(&report.filter_partner_ids),
            journal_ids: params
                .filter_journal_ids
                .as_deref()
                .unwrap_or(&report.filter_journal_ids),
        },
    )?;

    let mut changed_fields = Vec::new();

    if let Some(n) = params.name {
        if n.is_empty() {
            return Err("Report name cannot be empty".to_string());
        }
        report.name = n;
        changed_fields.push("name".to_string());
    }

    if let Some(df) = params.date_from {
        let end_date = params.date_to.unwrap_or(report.date_to);
        if end_date <= df {
            return Err("End date must be after start date".to_string());
        }
        report.date_from = df;
        changed_fields.push("date_from".to_string());
    }

    if let Some(dt) = params.date_to {
        if dt <= report.date_from {
            return Err("End date must be after start date".to_string());
        }
        report.date_to = dt;
        changed_fields.push("date_to".to_string());
    }

    if let Some(tm) = params.target_move {
        if tm != "posted" && tm != "all" {
            return Err("target_move must be 'posted' or 'all'".to_string());
        }
        report.target_move = tm;
        changed_fields.push("target_move".to_string());
    }

    if let Some(cm) = params.comparison_mode {
        let valid_modes = ["none", "previous_period", "previous_year"];
        if !valid_modes.contains(&cm.as_str()) {
            return Err(format!(
                "Invalid comparison_mode. Must be one of: {}",
                valid_modes.join(", ")
            ));
        }
        report.comparison_mode = cm;
        changed_fields.push("comparison_mode".to_string());
    }

    if let Some(faa) = params.filter_analytic_account_ids {
        report.filter_analytic_account_ids = faa;
        changed_fields.push("filter_analytic_account_ids".to_string());
    }

    if let Some(fa) = params.filter_account_ids {
        report.filter_account_ids = fa;
        changed_fields.push("filter_account_ids".to_string());
    }

    if let Some(fp) = params.filter_partner_ids {
        report.filter_partner_ids = fp;
        changed_fields.push("filter_partner_ids".to_string());
    }

    if let Some(fj) = params.filter_journal_ids {
        report.filter_journal_ids = fj;
        changed_fields.push("filter_journal_ids".to_string());
    }

    if let Some(hl) = params.hierarchy_level {
        if hl > 9 {
            return Err("Hierarchy level must be between 0 and 9".to_string());
        }
        report.hierarchy_level = hl;
        changed_fields.push("hierarchy_level".to_string());
    }

    if let Some(szl) = params.show_zero_lines {
        report.show_zero_lines = szl;
        changed_fields.push("show_zero_lines".to_string());
    }

    if let Some(sh) = params.show_hierarchy {
        report.show_hierarchy = sh;
        changed_fields.push("show_hierarchy".to_string());
    }

    if let Some(sp) = params.show_percentage {
        report.show_percentage = sp;
        changed_fields.push("show_percentage".to_string());
    }

    if let Some(sdc) = params.show_debit_credit {
        report.show_debit_credit = sdc;
        changed_fields.push("show_debit_credit".to_string());
    }

    if let Some(m) = params.metadata {
        report.metadata = Some(m);
        changed_fields.push("metadata".to_string());
    }

    report.write_uid = Some(ctx.sender());
    report.write_date = Some(ctx.timestamp);

    ctx.db.financial_report().id().update(report.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "financial_report",
            record_id: report_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": report.name }).to_string()),
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
}

/// Generate a financial report
#[spacetimedb::reducer]
pub fn generate_financial_report(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    report_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "financial_report", "write")?;

    let mut report = ctx
        .db
        .financial_report()
        .id()
        .find(&report_id)
        .ok_or("Financial report not found")?;

    if report.organization_id != organization_id {
        return Err("Report does not belong to this organization".to_string());
    }

    if report.company_id != company_id {
        return Err("Report does not belong to this company".to_string());
    }

    if report.state != ReportState::Draft {
        return Err("Report must be in Draft state to generate".to_string());
    }

    validate_report_filters(
        ctx,
        report.organization_id,
        report.company_id,
        ReportFilterRefs {
            currency_id: report.currency_id,
            result_currency_id: report.result_currency_id,
            analytic_account_ids: &report.filter_analytic_account_ids,
            account_ids: &report.filter_account_ids,
            partner_ids: &report.filter_partner_ids,
            journal_ids: &report.filter_journal_ids,
        },
    )?;
    let organization_id = report.organization_id;
    let company_id = report.company_id;

    // Remove existing trial balance rows for this report before regenerating
    let existing_entries: Vec<_> = ctx
        .db
        .trial_balance()
        .trial_balance_by_report()
        .filter(&report_id)
        .collect();
    for entry in existing_entries {
        ctx.db.trial_balance().id().delete(&entry.id);
    }

    // Aggregate posted/all move lines into trial balance buckets
    #[derive(Clone)]
    struct TrialBalanceBucket {
        account_id: u64,
        account_code: String,
        account_name: String,
        opening_debit: f64,
        opening_credit: f64,
        period_debit: f64,
        period_credit: f64,
    }

    let mut buckets: std::collections::BTreeMap<u64, TrialBalanceBucket> =
        std::collections::BTreeMap::new();

    for line in ctx.db.account_move_line().iter() {
        let Some(parent_move) = scoped_parent_move_for_report(ctx, &line, &report) else {
            continue;
        };

        // target_move filter
        if report.target_move == "posted" && parent_move.state != AccountMoveState::Posted {
            continue;
        }

        if !line_matches_report_filters(&line, &report) {
            continue;
        }

        let account = match ctx.db.account_account().id().find(&line.account_id) {
            Some(acc)
                if acc.organization_id == organization_id
                    && acc.company_id == company_id
                    && !acc.deprecated =>
            {
                acc
            }
            None => continue,
            Some(_) => continue,
        };

        let bucket = buckets
            .entry(line.account_id)
            .or_insert_with(|| TrialBalanceBucket {
                account_id: line.account_id,
                account_code: account.code.clone(),
                account_name: account.name.clone(),
                opening_debit: 0.0,
                opening_credit: 0.0,
                period_debit: 0.0,
                period_credit: 0.0,
            });

        if line.date < report.date_from {
            bucket.opening_debit += line.debit;
            bucket.opening_credit += line.credit;
        } else if line.date <= report.date_to {
            bucket.period_debit += line.debit;
            bucket.period_credit += line.credit;
        }
    }

    // Persist trial balance entries and compute report summary totals
    let mut summary_opening_debit = 0.0f64;
    let mut summary_opening_credit = 0.0f64;
    let mut summary_period_debit = 0.0f64;
    let mut summary_period_credit = 0.0f64;
    let mut summary_closing_debit = 0.0f64;
    let mut summary_closing_credit = 0.0f64;

    for bucket in buckets.values() {
        let closing_debit = if bucket.opening_debit + bucket.period_debit
            > bucket.opening_credit + bucket.period_credit
        {
            bucket.opening_debit + bucket.period_debit
                - bucket.opening_credit
                - bucket.period_credit
        } else {
            0.0
        };

        let closing_credit = if bucket.opening_credit + bucket.period_credit
            > bucket.opening_debit + bucket.period_debit
        {
            bucket.opening_credit + bucket.period_credit
                - bucket.opening_debit
                - bucket.period_debit
        } else {
            0.0
        };

        // hide all-zero rows when requested
        if !report.show_zero_lines
            && bucket.opening_debit.abs() < 0.000_001
            && bucket.opening_credit.abs() < 0.000_001
            && bucket.period_debit.abs() < 0.000_001
            && bucket.period_credit.abs() < 0.000_001
            && closing_debit.abs() < 0.000_001
            && closing_credit.abs() < 0.000_001
        {
            continue;
        }

        ctx.db.trial_balance().insert(TrialBalance {
            id: 0,
            organization_id,
            report_id,
            account_id: bucket.account_id,
            account_code: bucket.account_code.clone(),
            account_name: bucket.account_name.clone(),
            opening_debit: bucket.opening_debit,
            opening_credit: bucket.opening_credit,
            period_debit: bucket.period_debit,
            period_credit: bucket.period_credit,
            closing_debit,
            closing_credit,
            currency_id: report.result_currency_id,
            parent_id: None,
            level: 0,
            is_leaf: true,
            company_id,
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: report.metadata.clone(),
        });

        summary_opening_debit += bucket.opening_debit;
        summary_opening_credit += bucket.opening_credit;
        summary_period_debit += bucket.period_debit;
        summary_period_credit += bucket.period_credit;
        summary_closing_debit += closing_debit;
        summary_closing_credit += closing_credit;
    }

    // Clear prior statement lines for this report (re-generate)
    for row in ctx
        .db
        .balance_sheet_line()
        .balance_sheet_by_report()
        .filter(&report_id)
        .collect::<Vec<_>>()
    {
        ctx.db.balance_sheet_line().id().delete(&row.id);
    }
    for row in ctx
        .db
        .profit_loss_line()
        .profit_loss_by_report()
        .filter(&report_id)
        .collect::<Vec<_>>()
    {
        ctx.db.profit_loss_line().id().delete(&row.id);
    }
    for row in ctx
        .db
        .cash_flow_line()
        .cash_flow_by_report()
        .filter(&report_id)
        .collect::<Vec<_>>()
    {
        ctx.db.cash_flow_line().id().delete(&row.id);
    }

    let statement_extra = match report.report_type {
        ReportType::BalanceSheet => {
            populate_balance_sheet_from_trial_balance(ctx, &report)?;
            serde_json::json!({ "statement": "balance_sheet" })
        }
        ReportType::ProfitAndLoss => {
            populate_profit_loss_from_trial_balance(ctx, &report)?;
            serde_json::json!({ "statement": "profit_and_loss" })
        }
        ReportType::CashFlow => {
            populate_cash_flow_from_trial_balance(ctx, &report)?;
            serde_json::json!({ "statement": "cash_flow" })
        }
        ReportType::AgedReceivable => build_aging_report_data(ctx, &report, true)?,
        ReportType::AgedPayable => build_aging_report_data(ctx, &report, false)?,
        ReportType::PartnerBalance => build_partner_balance_data(ctx, &report)?,
        ReportType::TrialBalance | ReportType::GeneralLedger | ReportType::VatReturn => {
            serde_json::json!({})
        }
    };

    let report_data = serde_json::json!({
        "report_type": format!("{:?}", report.report_type),
        "period": {
            "from": report.date_from.to_string(),
            "to": report.date_to.to_string()
        },
        "target_move": report.target_move,
        "summary": {
            "opening_debit": summary_opening_debit,
            "opening_credit": summary_opening_credit,
            "period_debit": summary_period_debit,
            "period_credit": summary_period_credit,
            "closing_debit": summary_closing_debit,
            "closing_credit": summary_closing_credit
        },
        "line_count": ctx.db.trial_balance().trial_balance_by_report().filter(&report_id).count(),
        "extra": statement_extra,
        "drill_down": {
            "trial_balance_report_id": report_id,
            "source": "account_move_line"
        }
    })
    .to_string();

    report.state = ReportState::Generated;
    report.generated_by = Some(ctx.sender());
    report.generated_at = Some(ctx.timestamp);
    report.report_data = Some(report_data);
    report.write_uid = Some(ctx.sender());
    report.write_date = Some(ctx.timestamp);

    ctx.db.financial_report().id().update(report.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "financial_report",
            record_id: report_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "Draft" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "Generated" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: report.metadata.clone(),
        },
    );

    Ok(())
}

fn closing_net(debit: f64, credit: f64) -> f64 {
    debit - credit
}

fn populate_balance_sheet_from_trial_balance(
    ctx: &ReducerContext,
    report: &FinancialReport,
) -> Result<(), String> {
    let mut sequence = 1_u32;
    for tb in ctx
        .db
        .trial_balance()
        .trial_balance_by_report()
        .filter(&report.id)
    {
        let account = ctx
            .db
            .account_account()
            .id()
            .find(&tb.account_id)
            .ok_or("Account missing for trial balance row")?;
        let group = account
            .internal_group
            .unwrap_or(AccountInternalGroup::Other);
        let line_type = match group {
            AccountInternalGroup::Asset => "asset",
            AccountInternalGroup::Liability => "liability",
            AccountInternalGroup::Equity => "equity",
            _ => continue,
        };
        let amount = match group {
            AccountInternalGroup::Asset => closing_net(tb.closing_debit, tb.closing_credit),
            _ => closing_net(tb.closing_credit, tb.closing_debit),
        };
        ctx.db.balance_sheet_line().insert(BalanceSheetLine {
            id: 0,
            organization_id: report.organization_id,
            report_id: report.id,
            sequence,
            name: tb.account_name.clone(),
            account_id: Some(tb.account_id),
            account_codes: vec![tb.account_code.clone()],
            line_type: line_type.to_string(),
            parent_id: None,
            level: 0,
            is_leaf: true,
            amount,
            comparison_amount: 0.0,
            variance: 0.0,
            variance_percentage: 0.0,
            company_id: report.company_id,
            currency_id: report.result_currency_id,
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: report.metadata.clone(),
        });
        sequence += 1;
    }
    Ok(())
}

fn populate_profit_loss_from_trial_balance(
    ctx: &ReducerContext,
    report: &FinancialReport,
) -> Result<(), String> {
    let mut sequence = 1_u32;
    for tb in ctx
        .db
        .trial_balance()
        .trial_balance_by_report()
        .filter(&report.id)
    {
        let account = ctx
            .db
            .account_account()
            .id()
            .find(&tb.account_id)
            .ok_or("Account missing for trial balance row")?;
        let group = account
            .internal_group
            .unwrap_or(AccountInternalGroup::Other);
        let line_type = match group {
            AccountInternalGroup::Income => "income",
            AccountInternalGroup::Expense => "expense",
            _ => continue,
        };
        let amount = match group {
            AccountInternalGroup::Income => closing_net(tb.period_credit, tb.period_debit),
            _ => closing_net(tb.period_debit, tb.period_credit),
        };
        ctx.db.profit_loss_line().insert(ProfitLossLine {
            id: 0,
            organization_id: report.organization_id,
            report_id: report.id,
            sequence,
            name: tb.account_name.clone(),
            account_id: Some(tb.account_id),
            account_codes: vec![tb.account_code.clone()],
            line_type: line_type.to_string(),
            parent_id: None,
            level: 0,
            is_leaf: true,
            amount,
            comparison_amount: 0.0,
            variance: 0.0,
            variance_percentage: 0.0,
            company_id: report.company_id,
            currency_id: report.result_currency_id,
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: report.metadata.clone(),
        });
        sequence += 1;
    }
    Ok(())
}

fn populate_cash_flow_from_trial_balance(
    ctx: &ReducerContext,
    report: &FinancialReport,
) -> Result<(), String> {
    // Indirect cash flow: period net by liquidity vs P&L proxies from trial balance.
    let mut operating = 0.0;
    let mut investing = 0.0;
    let mut financing = 0.0;
    for tb in ctx
        .db
        .trial_balance()
        .trial_balance_by_report()
        .filter(&report.id)
    {
        let account = match ctx.db.account_account().id().find(&tb.account_id) {
            Some(a) => a,
            None => continue,
        };
        let period_net = closing_net(tb.period_debit, tb.period_credit);
        match account
            .internal_group
            .unwrap_or(AccountInternalGroup::Other)
        {
            AccountInternalGroup::Income | AccountInternalGroup::Expense => {
                operating += -period_net;
            }
            AccountInternalGroup::Asset if account.is_bank_account || account.reconcile => {
                operating += -period_net;
            }
            AccountInternalGroup::Asset => investing += -period_net,
            AccountInternalGroup::Liability | AccountInternalGroup::Equity => {
                financing += -period_net;
            }
            _ => {}
        }
    }

    let sections = [
        ("operating", operating),
        ("investing", investing),
        ("financing", financing),
        ("total", operating + investing + financing),
    ];
    for (i, (line_type, amount)) in sections.iter().enumerate() {
        ctx.db.cash_flow_line().insert(CashFlowLine {
            id: 0,
            organization_id: report.organization_id,
            report_id: report.id,
            sequence: (i as u32) + 1,
            name: line_type.to_string(),
            line_type: line_type.to_string(),
            parent_id: None,
            level: 0,
            is_leaf: *line_type != "total",
            amount: *amount,
            comparison_amount: 0.0,
            variance: 0.0,
            variance_percentage: 0.0,
            company_id: report.company_id,
            currency_id: report.result_currency_id,
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: report.metadata.clone(),
        });
    }
    Ok(())
}

fn build_aging_report_data(
    ctx: &ReducerContext,
    report: &FinancialReport,
    receivable: bool,
) -> Result<serde_json::Value, String> {
    let mut buckets: std::collections::BTreeMap<u64, [f64; 5]> = std::collections::BTreeMap::new();
    // [current, 1-30, 31-60, 61-90, 90+]
    let as_of = report.date_to;
    let as_of_secs = as_of
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_secs();

    for mv in ctx.db.account_move().iter() {
        if mv.organization_id != report.organization_id
            || mv.company_id != report.company_id
            || mv.state != AccountMoveState::Posted
        {
            continue;
        }
        let is_ar = matches!(mv.move_type, MoveType::OutInvoice | MoveType::OutRefund);
        let is_ap = matches!(mv.move_type, MoveType::InInvoice | MoveType::InRefund);
        if receivable && !is_ar {
            continue;
        }
        if !receivable && !is_ap {
            continue;
        }
        let residual = mv.amount_residual.abs();
        if residual < 0.000_001 {
            continue;
        }
        let Some(partner_id) = mv.partner_id else {
            continue;
        };
        if !report.filter_partner_ids.is_empty() && !report.filter_partner_ids.contains(&partner_id)
        {
            continue;
        }
        if !report.filter_journal_ids.is_empty()
            && !report.filter_journal_ids.contains(&mv.journal_id)
        {
            continue;
        }
        if (!report.filter_account_ids.is_empty() || !report.filter_analytic_account_ids.is_empty())
            && !ctx
                .db
                .account_move_line()
                .move_line_by_move()
                .filter(&mv.id)
                .any(|line| {
                    line.organization_id == report.organization_id
                        && line.company_id == report.company_id
                        && line_matches_report_filters(&line, report)
                })
        {
            continue;
        }
        let due = mv.invoice_date_due.unwrap_or(mv.date);
        let due_secs = due
            .to_duration_since_unix_epoch()
            .unwrap_or_default()
            .as_secs();
        let days_past = as_of_secs.saturating_sub(due_secs) / 86_400;
        let idx = if due_secs >= as_of_secs {
            0
        } else if days_past <= 30 {
            1
        } else if days_past <= 60 {
            2
        } else if days_past <= 90 {
            3
        } else {
            4
        };
        let entry = buckets.entry(partner_id).or_insert([0.0; 5]);
        entry[idx] += residual;
    }

    let partners: Vec<_> = buckets
        .into_iter()
        .map(|(partner_id, b)| {
            serde_json::json!({
                "partner_id": partner_id,
                "current": b[0],
                "d1_30": b[1],
                "d31_60": b[2],
                "d61_90": b[3],
                "d90_plus": b[4],
                "total": b.iter().sum::<f64>(),
            })
        })
        .collect();

    Ok(serde_json::json!({
        "aging": if receivable { "receivable" } else { "payable" },
        "partners": partners,
    }))
}

fn build_partner_balance_data(
    ctx: &ReducerContext,
    report: &FinancialReport,
) -> Result<serde_json::Value, String> {
    let mut by_partner: std::collections::BTreeMap<u64, f64> = std::collections::BTreeMap::new();
    for line in ctx.db.account_move_line().iter() {
        let Some(parent_move) = scoped_parent_move_for_report(ctx, &line, report) else {
            continue;
        };
        if report.target_move == "posted" && parent_move.state != AccountMoveState::Posted {
            continue;
        }
        if line.date < report.date_from || line.date > report.date_to {
            continue;
        }
        if !line_matches_report_filters(&line, report) {
            continue;
        }
        let Some(partner_id) = line.partner_id else {
            continue;
        };
        *by_partner.entry(partner_id).or_insert(0.0) += line.debit - line.credit;
    }
    let partners: Vec<_> = by_partner
        .into_iter()
        .map(|(partner_id, balance)| {
            serde_json::json!({ "partner_id": partner_id, "balance": balance })
        })
        .collect();
    Ok(serde_json::json!({ "partner_balances": partners }))
}

/// Export a financial report
#[spacetimedb::reducer]
pub fn export_financial_report(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    report_id: u64,
    params: ExportFinancialReportParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "financial_report", "write")?;

    let valid_formats = ["pdf", "xlsx", "csv"];
    if !valid_formats.contains(&params.export_format.as_str()) {
        return Err(format!(
            "Invalid export format. Must be one of: {}",
            valid_formats.join(", ")
        ));
    }

    let mut report = ctx
        .db
        .financial_report()
        .id()
        .find(&report_id)
        .ok_or("Financial report not found")?;

    if report.organization_id != organization_id {
        return Err("Report does not belong to this organization".to_string());
    }

    if report.company_id != company_id {
        return Err("Report does not belong to this company".to_string());
    }

    if report.state != ReportState::Generated {
        return Err("Report must be generated before exporting".to_string());
    }

    report.export_format = Some(params.export_format.clone());
    report.exported_file_url = Some(format!(
        "/api/documents/{}/financial-report/{}",
        params.export_format.to_lowercase(),
        report_id
    ));
    report.state = ReportState::Exported;
    report.write_uid = Some(ctx.sender());
    report.write_date = Some(ctx.timestamp);

    ctx.db.financial_report().id().update(report.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "financial_report",
            record_id: report_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "format": params.export_format }).to_string()),
            changed_fields: vec!["export_format".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Archive a financial report
#[spacetimedb::reducer]
pub fn archive_financial_report(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    report_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "financial_report", "write")?;

    let mut report = ctx
        .db
        .financial_report()
        .id()
        .find(&report_id)
        .ok_or("Financial report not found")?;

    if report.organization_id != organization_id {
        return Err("Report does not belong to this organization".to_string());
    }

    if report.company_id != company_id {
        return Err("Report does not belong to this company".to_string());
    }

    if report.state != ReportState::Exported {
        return Err("Report must be exported before archiving".to_string());
    }

    report.state = ReportState::Archived;
    report.write_uid = Some(ctx.sender());
    report.write_date = Some(ctx.timestamp);

    ctx.db.financial_report().id().update(report.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "financial_report",
            record_id: report_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "Exported" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "Archived" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Create a trial balance entry
#[spacetimedb::reducer]
pub fn create_trial_balance_entry(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateTrialBalanceEntryParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "financial_report", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;

    if params.level > 9 {
        return Err("Level must be between 0 and 9".to_string());
    }

    let parent_report = ctx
        .db
        .financial_report()
        .id()
        .find(&params.report_id)
        .ok_or("Financial report not found")?;

    if parent_report.organization_id != organization_id {
        return Err("Report does not belong to this organization".to_string());
    }

    if parent_report.company_id != company_id {
        return Err("Report does not belong to this company".to_string());
    }

    let account = ctx
        .db
        .account_account()
        .id()
        .find(&params.account_id)
        .ok_or("account not found")?;
    if account.organization_id != parent_report.organization_id
        || account.company_id != parent_report.company_id
    {
        return Err("account does not belong to the report organization and company".to_string());
    }
    validate_report_currency_id(ctx, params.currency_id)?;
    if params.currency_id != parent_report.result_currency_id {
        return Err("trial balance currency must match the report currency".to_string());
    }
    if let Some(parent_id) = params.parent_id {
        let parent = ctx
            .db
            .trial_balance()
            .id()
            .find(&parent_id)
            .ok_or("parent trial balance entry not found")?;
        if parent.report_id != parent_report.id
            || parent.organization_id != parent_report.organization_id
            || parent.company_id != parent_report.company_id
        {
            return Err("parent trial balance entry does not belong to the report".to_string());
        }
    }

    let closing_debit = if params.opening_debit + params.period_debit
        > params.opening_credit + params.period_credit
    {
        params.opening_debit + params.period_debit - params.opening_credit - params.period_credit
    } else {
        0.0
    };

    let closing_credit = if params.opening_credit + params.period_credit
        > params.opening_debit + params.period_debit
    {
        params.opening_credit + params.period_credit - params.opening_debit - params.period_debit
    } else {
        0.0
    };

    let entry = ctx.db.trial_balance().insert(TrialBalance {
        id: 0,
        organization_id: parent_report.organization_id,
        report_id: params.report_id,
        account_id: params.account_id,
        account_code: account.code.clone(),
        account_name: account.name,
        opening_debit: params.opening_debit,
        opening_credit: params.opening_credit,
        period_debit: params.period_debit,
        period_credit: params.period_credit,
        closing_debit,
        closing_credit,
        currency_id: parent_report.result_currency_id,
        parent_id: params.parent_id,
        level: params.level,
        is_leaf: params.is_leaf,
        company_id: parent_report.company_id,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: None,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "trial_balance",
            record_id: entry.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "report_id": params.report_id,
                    "account_code": account.code,
                    "period_debit": params.period_debit,
                    "period_credit": params.period_credit
                })
                .to_string(),
            ),
            changed_fields: vec![
                "report_id".to_string(),
                "account_code".to_string(),
                "period_debit".to_string(),
                "period_credit".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

/// Delete a financial report
#[spacetimedb::reducer]
pub fn delete_financial_report(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    report_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "financial_report", "delete")?;

    let report = ctx
        .db
        .financial_report()
        .id()
        .find(&report_id)
        .ok_or("Financial report not found")?;

    if report.organization_id != organization_id {
        return Err("Report does not belong to this organization".to_string());
    }

    if report.company_id != company_id {
        return Err("Report does not belong to this company".to_string());
    }

    if report.state == ReportState::Archived {
        return Err("Cannot delete an archived report".to_string());
    }

    // Delete associated trial balance entries
    let trial_balance_entries: Vec<_> = ctx
        .db
        .trial_balance()
        .trial_balance_by_report()
        .filter(&report_id)
        .collect();

    for entry in trial_balance_entries {
        ctx.db.trial_balance().id().delete(&entry.id);
    }

    ctx.db.financial_report().id().delete(&report_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "financial_report",
            record_id: report_id,
            action: "DELETE",
            old_values: Some(serde_json::json!({ "name": report.name }).to_string()),
            new_values: None,
            changed_fields: vec!["id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct GenerateEuVatReportParams {
    pub name: String,
    pub date_from: Timestamp,
    pub date_to: Timestamp,
    pub currency_id: u64,
    pub locale: String,
}

/// Generate an EU VAT return summary from posted customer/vendor invoices in the period.
#[spacetimedb::reducer]
pub fn generate_eu_vat_report(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: GenerateEuVatReportParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "financial_report", "write")?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    validate_report_currency_id(ctx, params.currency_id)?;

    if params.date_from >= params.date_to {
        return Err("End date must be after start date".to_string());
    }

    let report = ctx.db.financial_report().insert(FinancialReport {
        id: 0,
        organization_id,
        name: params.name.clone(),
        report_type: ReportType::VatReturn,
        date_from: params.date_from,
        date_to: params.date_to,
        company_id,
        currency_id: params.currency_id,
        target_move: "posted".to_string(),
        comparison_mode: "none".to_string(),
        filter_analytic_account_ids: vec![],
        filter_account_ids: vec![],
        filter_partner_ids: vec![],
        filter_journal_ids: vec![],
        hierarchy_level: 0,
        show_zero_lines: false,
        show_hierarchy: false,
        show_percentage: false,
        show_debit_credit: true,
        result_currency_id: params.currency_id,
        state: ReportState::Draft,
        generated_by: None,
        generated_at: None,
        report_data: None,
        export_format: None,
        exported_file_url: None,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: Some(format!(r#"{{"locale":"{}"}}"#, params.locale)),
    });

    let report_id = report.id;

    let mut sales_base = 0.0f64;
    let mut sales_tax = 0.0f64;
    let mut purchase_base = 0.0f64;
    let mut purchase_tax = 0.0f64;

    for mv in ctx.db.account_move().iter() {
        if mv.organization_id != organization_id || mv.company_id != company_id {
            continue;
        }
        if mv.state != AccountMoveState::Posted {
            continue;
        }
        if mv.date < params.date_from || mv.date > params.date_to {
            continue;
        }
        match mv.move_type {
            crate::types::MoveType::OutInvoice | crate::types::MoveType::OutRefund => {
                sales_base += mv.amount_untaxed;
                sales_tax += mv.amount_tax;
            }
            crate::types::MoveType::InInvoice | crate::types::MoveType::InRefund => {
                purchase_base += mv.amount_untaxed;
                purchase_tax += mv.amount_tax;
            }
            _ => {}
        }
    }

    let report_data = serde_json::json!({
        "locale": params.locale,
        "boxes": {
            "box_01_taxable_supplies": sales_base,
            "box_02_vat_due_on_sales": sales_tax,
            "box_03_taxable_purchases": purchase_base,
            "box_04_vat_deductible": purchase_tax,
            "box_71_vat_payable": (sales_tax - purchase_tax).max(0.0),
            "box_72_vat_refundable": (purchase_tax - sales_tax).max(0.0),
        },
        "summary": {
            "sales_base": sales_base,
            "sales_tax": sales_tax,
            "purchase_base": purchase_base,
            "purchase_tax": purchase_tax,
            "net_vat": sales_tax - purchase_tax,
        }
    })
    .to_string();

    let mut updated = report;
    updated.state = ReportState::Generated;
    updated.generated_by = Some(ctx.sender());
    updated.generated_at = Some(ctx.timestamp);
    updated.report_data = Some(report_data);
    updated.write_uid = Some(ctx.sender());
    updated.write_date = Some(ctx.timestamp);
    ctx.db.financial_report().id().update(updated);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "financial_report",
            record_id: report_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "Draft" }).to_string()),
            new_values: Some(
                serde_json::json!({ "state": "Generated", "report_type": "VatReturn" }).to_string(),
            ),
            changed_fields: vec!["state".to_string(), "report_data".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
