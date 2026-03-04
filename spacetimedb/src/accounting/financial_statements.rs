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
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::accounting::chart_of_accounts::account_account;
use crate::accounting::journal_entries::account_move_line;
use crate::helpers::{check_permission, write_audit_log};
use crate::types::{AccountMoveState, ReportState, ReportType};

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = financial_report,
    public,
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
    index(accessor = trial_balance_by_account, btree(columns = [account_id])),
    index(accessor = trial_balance_by_company, btree(columns = [company_id])),
    index(accessor = trial_balance_by_report, btree(columns = [report_id])),
    index(accessor = trial_balance_by_parent, btree(columns = [parent_id]))
)]
pub struct TrialBalance {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
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
    index(accessor = balance_sheet_by_report, btree(columns = [report_id])),
    index(accessor = balance_sheet_by_account, btree(columns = [account_id])),
    index(accessor = balance_sheet_by_parent, btree(columns = [parent_id]))
)]
pub struct BalanceSheetLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
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
    index(accessor = profit_loss_by_report, btree(columns = [report_id])),
    index(accessor = profit_loss_by_account, btree(columns = [account_id])),
    index(accessor = profit_loss_by_parent, btree(columns = [parent_id]))
)]
pub struct ProfitLossLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
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
    index(accessor = cash_flow_by_report, btree(columns = [report_id])),
    index(accessor = cash_flow_by_parent, btree(columns = [parent_id]))
)]
pub struct CashFlowLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
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

#[spacetimedb::table(
    accessor = report_template,
    public,
    index(accessor = report_template_by_type, btree(columns = [report_type])),
    index(accessor = report_template_by_company, btree(columns = [company_id]))
)]
#[derive(Clone)]
pub struct ReportTemplate {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub report_type: ReportType,
    pub company_id: u64,
    pub is_default: bool,
    pub is_active: bool,
    pub columns: String,                // JSON array of column definitions
    pub row_definition: String,         // JSON array of row definitions
    pub filter_presets: Option<String>, // JSON for saved filters
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Create a new financial report configuration
#[spacetimedb::reducer]
pub fn create_financial_report(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    name: String,
    report_type: ReportType,
    date_from: Timestamp,
    date_to: Timestamp,
    currency_id: u64,
    target_move: String,
    comparison_mode: String,
    filter_analytic_account_ids: Vec<u64>,
    filter_account_ids: Vec<u64>,
    filter_partner_ids: Vec<u64>,
    filter_journal_ids: Vec<u64>,
    hierarchy_level: u8,
    show_zero_lines: bool,
    show_hierarchy: bool,
    show_percentage: bool,
    show_debit_credit: bool,
    result_currency_id: u64,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "financial_report", "create")?;

    if name.is_empty() {
        return Err("Report name is required".to_string());
    }

    if date_to <= date_from {
        return Err("End date must be after start date".to_string());
    }

    if target_move != "posted" && target_move != "all" {
        return Err("target_move must be 'posted' or 'all'".to_string());
    }

    let valid_comparison_modes = ["none", "previous_period", "previous_year"];
    if !valid_comparison_modes.contains(&comparison_mode.as_str()) {
        return Err(format!(
            "Invalid comparison_mode. Must be one of: {}",
            valid_comparison_modes.join(", ")
        ));
    }

    if hierarchy_level > 9 {
        return Err("Hierarchy level must be between 0 and 9".to_string());
    }

    let report = ctx.db.financial_report().insert(FinancialReport {
        id: 0,
        name: name.clone(),
        report_type: report_type.clone(),
        date_from,
        date_to,
        company_id,
        currency_id,
        target_move,
        comparison_mode,
        filter_analytic_account_ids,
        filter_account_ids,
        filter_partner_ids,
        filter_journal_ids,
        hierarchy_level,
        show_zero_lines,
        show_hierarchy,
        show_percentage,
        show_debit_credit,
        result_currency_id,
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
        metadata,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "financial_report",
        report.id,
        "CREATE",
        None,
        Some(
            serde_json::json!({
                "name": name,
                "report_type": format!("{:?}", report_type),
                "date_from": format!("{:?}", date_from),
                "date_to": format!("{:?}", date_to)
            })
            .to_string(),
        ),
        vec![
            "name".to_string(),
            "report_type".to_string(),
            "date_from".to_string(),
            "date_to".to_string(),
        ],
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
    name: Option<String>,
    date_from: Option<Timestamp>,
    date_to: Option<Timestamp>,
    target_move: Option<String>,
    comparison_mode: Option<String>,
    filter_analytic_account_ids: Option<Vec<u64>>,
    filter_account_ids: Option<Vec<u64>>,
    filter_partner_ids: Option<Vec<u64>>,
    filter_journal_ids: Option<Vec<u64>>,
    hierarchy_level: Option<u8>,
    show_zero_lines: Option<bool>,
    show_hierarchy: Option<bool>,
    show_percentage: Option<bool>,
    show_debit_credit: Option<bool>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "financial_report", "write")?;

    let mut report = ctx
        .db
        .financial_report()
        .id()
        .find(&report_id)
        .ok_or("Financial report not found")?;

    if report.company_id != company_id {
        return Err("Report does not belong to this company".to_string());
    }

    if report.state != ReportState::Draft {
        return Err("Can only modify reports in Draft state".to_string());
    }

    let mut changed_fields = Vec::new();

    if let Some(n) = name {
        if n.is_empty() {
            return Err("Report name cannot be empty".to_string());
        }
        report.name = n;
        changed_fields.push("name".to_string());
    }

    if let Some(df) = date_from {
        let end_date = date_to.unwrap_or(report.date_to);
        if end_date <= df {
            return Err("End date must be after start date".to_string());
        }
        report.date_from = df;
        changed_fields.push("date_from".to_string());
    }

    if let Some(dt) = date_to {
        if dt <= report.date_from {
            return Err("End date must be after start date".to_string());
        }
        report.date_to = dt;
        changed_fields.push("date_to".to_string());
    }

    if let Some(tm) = target_move {
        if tm != "posted" && tm != "all" {
            return Err("target_move must be 'posted' or 'all'".to_string());
        }
        report.target_move = tm;
        changed_fields.push("target_move".to_string());
    }

    if let Some(cm) = comparison_mode {
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

    if let Some(faa) = filter_analytic_account_ids {
        report.filter_analytic_account_ids = faa;
        changed_fields.push("filter_analytic_account_ids".to_string());
    }

    if let Some(fa) = filter_account_ids {
        report.filter_account_ids = fa;
        changed_fields.push("filter_account_ids".to_string());
    }

    if let Some(fp) = filter_partner_ids {
        report.filter_partner_ids = fp;
        changed_fields.push("filter_partner_ids".to_string());
    }

    if let Some(fj) = filter_journal_ids {
        report.filter_journal_ids = fj;
        changed_fields.push("filter_journal_ids".to_string());
    }

    if let Some(hl) = hierarchy_level {
        if hl > 9 {
            return Err("Hierarchy level must be between 0 and 9".to_string());
        }
        report.hierarchy_level = hl;
        changed_fields.push("hierarchy_level".to_string());
    }

    if let Some(szl) = show_zero_lines {
        report.show_zero_lines = szl;
        changed_fields.push("show_zero_lines".to_string());
    }

    if let Some(sh) = show_hierarchy {
        report.show_hierarchy = sh;
        changed_fields.push("show_hierarchy".to_string());
    }

    if let Some(sp) = show_percentage {
        report.show_percentage = sp;
        changed_fields.push("show_percentage".to_string());
    }

    if let Some(sdc) = show_debit_credit {
        report.show_debit_credit = sdc;
        changed_fields.push("show_debit_credit".to_string());
    }

    if let Some(m) = metadata {
        report.metadata = Some(m);
        changed_fields.push("metadata".to_string());
    }

    report.write_uid = Some(ctx.sender());
    report.write_date = Some(ctx.timestamp);

    ctx.db.financial_report().id().update(report.clone());

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "financial_report",
        report_id,
        "UPDATE",
        None,
        Some(serde_json::json!({ "name": report.name }).to_string()),
        changed_fields,
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

    if report.company_id != company_id {
        return Err("Report does not belong to this company".to_string());
    }

    if report.state != ReportState::Draft {
        return Err("Report must be in Draft state to generate".to_string());
    }

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
        if line.company_id != company_id {
            continue;
        }

        // target_move filter
        if report.target_move == "posted" && line.parent_state != AccountMoveState::Posted {
            continue;
        }

        // account filter
        if !report.filter_account_ids.is_empty()
            && !report.filter_account_ids.contains(&line.account_id)
        {
            continue;
        }

        // partner filter
        if !report.filter_partner_ids.is_empty() {
            match line.partner_id {
                Some(pid) if report.filter_partner_ids.contains(&pid) => {}
                _ => continue,
            }
        }

        // journal filter
        if !report.filter_journal_ids.is_empty()
            && !report.filter_journal_ids.contains(&line.journal_id)
        {
            continue;
        }

        let account = match ctx.db.account_account().id().find(&line.account_id) {
            Some(acc) => acc,
            None => continue,
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
            metadata: None,
        });

        summary_opening_debit += bucket.opening_debit;
        summary_opening_credit += bucket.opening_credit;
        summary_period_debit += bucket.period_debit;
        summary_period_credit += bucket.period_credit;
        summary_closing_debit += closing_debit;
        summary_closing_credit += closing_credit;
    }

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
        "line_count": ctx.db.trial_balance().trial_balance_by_report().filter(&report_id).count()
    })
    .to_string();

    report.state = ReportState::Generated;
    report.generated_by = Some(ctx.sender());
    report.generated_at = Some(ctx.timestamp);
    report.report_data = Some(report_data);
    report.write_uid = Some(ctx.sender());
    report.write_date = Some(ctx.timestamp);

    ctx.db.financial_report().id().update(report.clone());

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "financial_report",
        report_id,
        "GENERATE",
        Some(serde_json::json!({ "state": "Draft" }).to_string()),
        Some(serde_json::json!({ "state": "Generated" }).to_string()),
        vec!["state".to_string()],
    );

    Ok(())
}

/// Export a financial report
#[spacetimedb::reducer]
pub fn export_financial_report(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    report_id: u64,
    export_format: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "financial_report", "write")?;

    let valid_formats = ["pdf", "xlsx", "csv"];
    if !valid_formats.contains(&export_format.as_str()) {
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

    if report.company_id != company_id {
        return Err("Report does not belong to this company".to_string());
    }

    if report.state != ReportState::Generated {
        return Err("Report must be generated before exporting".to_string());
    }

    // In a real implementation, this would:
    // 1. Convert report_data to the requested format
    // 2. Store the file and set the URL

    report.export_format = Some(export_format.clone());
    report.exported_file_url = Some(format!(
        "/reports/{}/export.{}",
        report_id,
        export_format.to_lowercase()
    ));
    report.state = ReportState::Exported;
    report.write_uid = Some(ctx.sender());
    report.write_date = Some(ctx.timestamp);

    ctx.db.financial_report().id().update(report.clone());

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "financial_report",
        report_id,
        "EXPORT",
        None,
        Some(serde_json::json!({ "format": export_format }).to_string()),
        vec!["export_format".to_string()],
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

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "financial_report",
        report_id,
        "ARCHIVE",
        Some(serde_json::json!({ "state": "Exported" }).to_string()),
        Some(serde_json::json!({ "state": "Archived" }).to_string()),
        vec!["state".to_string()],
    );

    Ok(())
}

/// Create a trial balance entry
#[spacetimedb::reducer]
pub fn create_trial_balance_entry(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    report_id: u64,
    account_id: u64,
    account_code: String,
    account_name: String,
    opening_debit: f64,
    opening_credit: f64,
    period_debit: f64,
    period_credit: f64,
    currency_id: u64,
    parent_id: Option<u64>,
    level: u8,
    is_leaf: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "financial_report", "create")?;

    if account_code.is_empty() {
        return Err("Account code is required".to_string());
    }

    if account_name.is_empty() {
        return Err("Account name is required".to_string());
    }

    if level > 9 {
        return Err("Level must be between 0 and 9".to_string());
    }

    let closing_debit = if opening_debit + period_debit > opening_credit + period_credit {
        opening_debit + period_debit - opening_credit - period_credit
    } else {
        0.0
    };

    let closing_credit = if opening_credit + period_credit > opening_debit + period_debit {
        opening_credit + period_credit - opening_debit - period_debit
    } else {
        0.0
    };

    let entry = ctx.db.trial_balance().insert(TrialBalance {
        id: 0,
        report_id,
        account_id,
        account_code: account_code.clone(),
        account_name,
        opening_debit,
        opening_credit,
        period_debit,
        period_credit,
        closing_debit,
        closing_credit,
        currency_id,
        parent_id,
        level,
        is_leaf,
        company_id,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: None,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "trial_balance",
        entry.id,
        "CREATE",
        None,
        Some(
            serde_json::json!({
                "report_id": report_id,
                "account_code": account_code,
                "period_debit": period_debit,
                "period_credit": period_credit
            })
            .to_string(),
        ),
        vec![
            "report_id".to_string(),
            "account_code".to_string(),
            "period_debit".to_string(),
            "period_credit".to_string(),
        ],
    );

    Ok(())
}

/// Create a report template
#[spacetimedb::reducer]
pub fn create_report_template(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    name: String,
    report_type: ReportType,
    columns: String,
    row_definition: String,
    is_default: bool,
    filter_presets: Option<String>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "report_template", "create")?;

    if name.is_empty() {
        return Err("Template name is required".to_string());
    }

    // Validate columns JSON
    let _: Vec<serde_json::Value> =
        serde_json::from_str(&columns).map_err(|e| format!("Invalid columns JSON: {}", e))?;

    // Validate row_definition JSON
    let _: Vec<serde_json::Value> = serde_json::from_str(&row_definition)
        .map_err(|e| format!("Invalid row_definition JSON: {}", e))?;

    // If setting as default, unset other defaults for same report_type
    if is_default {
        for mut template in ctx
            .db
            .report_template()
            .report_template_by_company()
            .filter(&company_id)
            .filter(|t| t.report_type == report_type && t.is_default)
        {
            template.is_default = false;
            template.write_uid = Some(ctx.sender());
            template.write_date = Some(ctx.timestamp);
            ctx.db.report_template().id().update(template);
        }
    }

    let template = ctx.db.report_template().insert(ReportTemplate {
        id: 0,
        name: name.clone(),
        report_type: report_type.clone(),
        company_id,
        is_default,
        is_active: true,
        columns,
        row_definition,
        filter_presets,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "report_template",
        template.id,
        "CREATE",
        None,
        Some(
            serde_json::json!({ "name": name, "report_type": format!("{:?}", report_type) })
                .to_string(),
        ),
        vec!["name".to_string(), "report_type".to_string()],
    );

    Ok(())
}

/// Update a report template
#[spacetimedb::reducer]
pub fn update_report_template(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    template_id: u64,
    name: Option<String>,
    columns: Option<String>,
    row_definition: Option<String>,
    is_default: Option<bool>,
    is_active: Option<bool>,
    filter_presets: Option<String>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "report_template", "write")?;

    let mut template = ctx
        .db
        .report_template()
        .id()
        .find(&template_id)
        .ok_or("Report template not found")?;

    if template.company_id != company_id {
        return Err("Template does not belong to this company".to_string());
    }

    let mut changed_fields = Vec::new();

    if let Some(n) = name {
        if n.is_empty() {
            return Err("Template name cannot be empty".to_string());
        }
        template.name = n;
        changed_fields.push("name".to_string());
    }

    if let Some(c) = columns {
        let _: Vec<serde_json::Value> =
            serde_json::from_str(&c).map_err(|e| format!("Invalid columns JSON: {}", e))?;
        template.columns = c;
        changed_fields.push("columns".to_string());
    }

    if let Some(rd) = row_definition {
        let _: Vec<serde_json::Value> =
            serde_json::from_str(&rd).map_err(|e| format!("Invalid row_definition JSON: {}", e))?;
        template.row_definition = rd;
        changed_fields.push("row_definition".to_string());
    }

    if let Some(id) = is_default {
        if id {
            // Unset other defaults for same report_type
            for mut t in ctx
                .db
                .report_template()
                .report_template_by_company()
                .filter(&company_id)
                .filter(|t| {
                    t.report_type == template.report_type && t.is_default && t.id != template_id
                })
            {
                t.is_default = false;
                t.write_uid = Some(ctx.sender());
                t.write_date = Some(ctx.timestamp);
                ctx.db.report_template().id().update(t);
            }
        }
        template.is_default = id;
        changed_fields.push("is_default".to_string());
    }

    if let Some(ia) = is_active {
        template.is_active = ia;
        changed_fields.push("is_active".to_string());
    }

    if filter_presets.is_some() {
        template.filter_presets = filter_presets;
        changed_fields.push("filter_presets".to_string());
    }

    if let Some(m) = metadata {
        template.metadata = Some(m);
        changed_fields.push("metadata".to_string());
    }

    template.write_uid = Some(ctx.sender());
    template.write_date = Some(ctx.timestamp);

    ctx.db.report_template().id().update(template.clone());

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "report_template",
        template_id,
        "UPDATE",
        None,
        Some(serde_json::json!({ "name": template.name }).to_string()),
        changed_fields,
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

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "financial_report",
        report_id,
        "DELETE",
        Some(serde_json::json!({ "name": report.name }).to_string()),
        None,
        vec!["id".to_string()],
    );

    Ok(())
}
