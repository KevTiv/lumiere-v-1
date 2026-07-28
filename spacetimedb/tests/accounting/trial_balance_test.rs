use std::time::Duration;

use spacetimedb::{ReducerContext, Table};

use crate::accounting::analytic_accounting::{
    account_analytic_account, create_analytic_account, update_analytic_account,
    CreateAnalyticAccountParams, UpdateAnalyticAccountParams,
};
use crate::accounting::financial_statements::{
    create_financial_report, financial_report, generate_financial_report, trial_balance,
    CreateFinancialReportParams,
};
use crate::accounting::journal_entries::{account_move_line, AccountMoveLine};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{AccountMoveState, ReportType};

use super::helpers::create_balanced_customer_invoice;

pub fn test_analytic_account_patch_preserves_and_clears(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let code = format!("PATCH-{}", fixture.company_id);
    let metadata = r#"{"proof":"preserved"}"#.to_string();
    create_analytic_account(
        ctx,
        fixture.organization_id,
        CreateAnalyticAccountParams {
            company_id: Some(fixture.company_id),
            name: "Patch semantics source".to_string(),
            code: Some(code.clone()),
            active: true,
            currency_id: 1,
            partner_id: Some(fixture.partner_id),
            plan_id: None,
            root_id: None,
            group_id: None,
            parent_id: None,
            color: Some(17),
            is_required_in_move_lines: true,
            is_required_in_distribution: false,
            is_root_plan: false,
            metadata: Some(metadata.clone()),
        },
    )?;
    let account_id = ctx
        .db
        .account_analytic_account()
        .iter()
        .find(|account| {
            account.organization_id == fixture.organization_id && account.code == Some(code.clone())
        })
        .map(|account| account.id)
        .ok_or("patch-semantics analytic account not found")?;

    update_analytic_account(
        ctx,
        fixture.organization_id,
        account_id,
        UpdateAnalyticAccountParams {
            company_id: Some(fixture.company_id),
            name: Some("Only the name changed".to_string()),
            code: None,
            partner_id: None,
            plan_id: None,
            group_id: None,
            color: None,
            is_required_in_move_lines: None,
            metadata: None,
        },
    )?;
    let preserved = ctx
        .db
        .account_analytic_account()
        .id()
        .find(&account_id)
        .ok_or("updated analytic account not found")?;
    if preserved.code.as_deref() != Some(code.as_str())
        || preserved.partner_id != Some(fixture.partner_id)
        || preserved.color != Some(17)
        || !preserved.is_required_in_move_lines
        || preserved.metadata.as_deref() != Some(metadata.as_str())
    {
        return Err("one-field analytic update changed unrelated values".to_string());
    }

    update_analytic_account(
        ctx,
        fixture.organization_id,
        account_id,
        UpdateAnalyticAccountParams {
            company_id: Some(fixture.company_id),
            name: None,
            code: Some(None),
            partner_id: Some(None),
            plan_id: None,
            group_id: None,
            color: Some(None),
            is_required_in_move_lines: None,
            metadata: Some(None),
        },
    )?;
    let cleared = ctx
        .db
        .account_analytic_account()
        .id()
        .find(&account_id)
        .ok_or("cleared analytic account not found")?;
    if cleared.code.is_some()
        || cleared.partner_id.is_some()
        || cleared.color.is_some()
        || cleared.metadata.is_some()
    {
        return Err("explicit analytic clears were not persisted".to_string());
    }
    Ok(())
}

fn trial_balance_params(name: &str, ctx: &ReducerContext) -> CreateFinancialReportParams {
    CreateFinancialReportParams {
        name: name.to_string(),
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
    }
}

pub fn test_trial_balance_summary_balances(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    create_balanced_customer_invoice(ctx, &fixture, 120.0, true)?;

    create_financial_report(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        trial_balance_params("Harness trial balance", ctx),
    )?;

    let report_id = ctx
        .db
        .financial_report()
        .iter()
        .filter(|r| {
            r.organization_id == fixture.organization_id && r.name == "Harness trial balance"
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

pub fn test_financial_report_rejects_cross_tenant_sources_and_filters(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;
    create_analytic_account(
        ctx,
        fixture_b.organization_id,
        CreateAnalyticAccountParams {
            company_id: Some(fixture_b.company_id),
            name: "Foreign report analytic account".to_string(),
            code: Some(format!("FRA-{}", fixture_b.company_id)),
            active: true,
            currency_id: 1,
            partner_id: Some(fixture_b.partner_id),
            plan_id: None,
            root_id: None,
            group_id: None,
            parent_id: None,
            color: None,
            is_required_in_move_lines: false,
            is_required_in_distribution: false,
            is_root_plan: false,
            metadata: Some(r#"{"test":"foreign_report_filter"}"#.to_string()),
        },
    )?;
    let foreign_analytic_id = ctx
        .db
        .account_analytic_account()
        .iter()
        .find(|account| {
            account.organization_id == fixture_b.organization_id
                && account.name == "Foreign report analytic account"
        })
        .map(|account| account.id)
        .ok_or("foreign analytic account not found")?;
    create_balanced_customer_invoice(ctx, &fixture_a, 120.0, true)?;
    create_balanced_customer_invoice(ctx, &fixture_b, 987.65, true)?;

    let foreign_line = ctx
        .db
        .account_move_line()
        .iter()
        .find(|line| {
            line.organization_id == fixture_b.organization_id
                && line.company_id == fixture_b.company_id
                && line.parent_state == AccountMoveState::Posted
                && (line.debit - 987.65).abs() < 0.001
        })
        .ok_or("foreign posted move line not found")?;
    ctx.db.account_move_line().insert(AccountMoveLine {
        id: 0,
        organization_id: fixture_a.organization_id,
        company_id: fixture_a.company_id,
        metadata: Some(r#"{"test":"cross_tenant_report_source"}"#.to_string()),
        ..foreign_line.clone()
    });

    let report_count_before = ctx.db.financial_report().iter().count();
    if create_financial_report(
        ctx,
        fixture_a.organization_id,
        fixture_b.company_id,
        trial_balance_params("Foreign company report", ctx),
    )
    .is_ok()
    {
        return Err("foreign company report creation should fail".to_string());
    }

    let mut foreign_account = trial_balance_params("Foreign account filter", ctx);
    foreign_account.filter_account_ids = vec![foreign_line.account_id];
    if create_financial_report(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        foreign_account,
    )
    .is_ok()
    {
        return Err("foreign account filter should fail".to_string());
    }

    let mut foreign_partner = trial_balance_params("Foreign partner filter", ctx);
    foreign_partner.filter_partner_ids = vec![fixture_b.partner_id];
    if create_financial_report(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        foreign_partner,
    )
    .is_ok()
    {
        return Err("foreign partner filter should fail".to_string());
    }

    let mut foreign_journal = trial_balance_params("Foreign journal filter", ctx);
    foreign_journal.filter_journal_ids = vec![foreign_line.journal_id];
    if create_financial_report(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        foreign_journal,
    )
    .is_ok()
    {
        return Err("foreign journal filter should fail".to_string());
    }

    let mut foreign_analytic = trial_balance_params("Foreign analytic filter", ctx);
    foreign_analytic.filter_analytic_account_ids = vec![foreign_analytic_id];
    if create_financial_report(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        foreign_analytic,
    )
    .is_ok()
    {
        return Err("foreign analytic account filter should fail".to_string());
    }

    let mut unsupported_currency = trial_balance_params("Unsupported currency", ctx);
    unsupported_currency.currency_id = u64::MAX;
    if create_financial_report(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        unsupported_currency,
    )
    .is_ok()
    {
        return Err("unsupported currency should fail".to_string());
    }

    let mut unsupported_result_currency = trial_balance_params("Unsupported result currency", ctx);
    unsupported_result_currency.result_currency_id = u64::MAX;
    if create_financial_report(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        unsupported_result_currency,
    )
    .is_ok()
    {
        return Err("unsupported result currency should fail".to_string());
    }

    if ctx.db.financial_report().iter().count() != report_count_before {
        return Err("rejected report configurations persisted rows".to_string());
    }

    create_financial_report(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        trial_balance_params("Tenant-isolated trial balance", ctx),
    )?;
    let report = ctx
        .db
        .financial_report()
        .iter()
        .find(|report| {
            report.organization_id == fixture_a.organization_id
                && report.name == "Tenant-isolated trial balance"
        })
        .ok_or("tenant-isolated report not found")?;
    generate_financial_report(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        report.id,
    )?;

    let entries: Vec<_> = ctx
        .db
        .trial_balance()
        .trial_balance_by_report()
        .filter(&report.id)
        .collect();
    if entries.is_empty() {
        return Err("tenant-isolated report has no trial balance entries".to_string());
    }
    if entries.iter().any(|entry| {
        entry.organization_id != fixture_a.organization_id
            || entry.company_id != fixture_a.company_id
            || entry.account_id == foreign_line.account_id
    }) {
        return Err("tenant-isolated report persisted a foreign trial balance entry".to_string());
    }
    let period_debit: f64 = entries.iter().map(|entry| entry.period_debit).sum();
    let period_credit: f64 = entries.iter().map(|entry| entry.period_credit).sum();
    if (period_debit - 120.0).abs() > 0.01 || (period_credit - 120.0).abs() > 0.01 {
        return Err(format!(
            "tenant-isolated totals include foreign data: debit={period_debit} credit={period_credit}"
        ));
    }

    Ok(())
}
