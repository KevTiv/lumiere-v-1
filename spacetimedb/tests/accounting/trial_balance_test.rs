use std::time::Duration;

use spacetimedb::{ReducerContext, Table};

use crate::accounting::financial_statements::{
    create_financial_report, financial_report, generate_financial_report,
    CreateFinancialReportParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::ReportType;

use super::helpers::create_balanced_customer_invoice;

pub fn test_trial_balance_summary_balances(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    create_balanced_customer_invoice(ctx, &fixture, 120.0, true)?;

    create_financial_report(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateFinancialReportParams {
            name: "Harness trial balance".to_string(),
            report_type: ReportType::TrialBalance,
            date_from: ctx.timestamp,
            date_to: ctx.timestamp + Duration::from_secs(86_400),
            currency_id: 1,
            target_move: "posted".to_string(),
            comparison_mode: "none".to_string(),
            filter_analytic_account_ids: vec![],
            filter_account_ids: vec![],
            filter_partner_ids: vec![],
            filter_journal_ids: vec![],
            hierarchy_level: 0,
            show_zero_lines: true,
            show_hierarchy: false,
            show_percentage: false,
            show_debit_credit: true,
            report_data: None,
            export_format: None,
            exported_file_url: None,
            result_currency_id: 1,
            metadata: None,
        },
    )?;

    let report_id = ctx
        .db
        .financial_report()
        .iter()
        .filter(|r| {
            r.organization_id == fixture.organization_id
                && r.name == "Harness trial balance"
        })
        .map(|r| r.id)
        .last()
        .ok_or("Financial report not found after create")?;

    generate_financial_report(ctx, fixture.organization_id, fixture.company_id, report_id)?;

    let report = ctx
        .db
        .financial_report()
        .id()
        .find(&report_id)
        .ok_or("Generated report not found")?;
    let raw = report
        .report_data
        .as_deref()
        .ok_or("Missing report_data after generate")?;
    let parsed: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("Invalid report_data JSON: {e}"))?;
    let summary = parsed
        .get("summary")
        .ok_or("Missing summary in report_data")?;
    let period_debit = summary
        .get("period_debit")
        .and_then(|v| v.as_f64())
        .ok_or("Missing period_debit")?;
    let period_credit = summary
        .get("period_credit")
        .and_then(|v| v.as_f64())
        .ok_or("Missing period_credit")?;

    if (period_debit - period_credit).abs() > 0.01 {
        return Err(format!(
            "Trial balance not balanced: debit={period_debit} credit={period_credit}"
        ));
    }

    Ok(())
}
