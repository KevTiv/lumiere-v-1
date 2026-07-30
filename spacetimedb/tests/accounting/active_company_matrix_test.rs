//! ACC-RI-007 — active company A2 create-persist matrix.
use std::time::Duration;

use spacetimedb::{ReducerContext, Table};

use crate::accounting::analytic_accounting::{
    account_analytic_account, create_analytic_account, CreateAnalyticAccountParams,
};
use crate::accounting::budgeting::{
    create_crossovered_budget, crossovered_budget, CreateCrossoveredBudgetParams,
};
use crate::accounting::chart_of_accounts::{
    account_account, account_account_type, account_journal, create_account_account,
    create_account_account_type, create_account_journal, CreateAccountAccountParams,
    CreateAccountAccountTypeParams, CreateAccountJournalParams,
};
use crate::accounting::financial_statements::{
    create_financial_report, financial_report, CreateFinancialReportParams,
};
use crate::accounting::fixed_assets::{account_asset, create_account_asset, CreateAccountAssetParams};
use crate::accounting::journal_entries::{account_move, create_account_move, CreateAccountMoveParams};
use crate::accounting::payments::{account_payment, create_payment, CreatePaymentParams};
use crate::accounting::tax_management::{
    account_tax, account_tax_group, create_account_tax, create_account_tax_group,
    CreateAccountTaxGroupParams, CreateAccountTaxParams,
};
use crate::crm::contacts::{contact, create_contact, CreateContactParams};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{
    AccountInternalGroup, AccountTypeInternal, AssetType, DepreciationMethod, JournalType, MoveType,
    PartnerType, PaymentType, ReportType, TaxAmountType, TaxTypeUse,
};

use super::helpers::seed_sibling_company;

fn assert_company(label: &str, expected: u64, actual: u64) -> Result<(), String> {
    if actual != expected {
        return Err(format!(
            "{label} persisted company_id={actual}, expected active company A2={expected}"
        ));
    }
    Ok(())
}

pub fn test_active_company_a2_create_persist_matrix(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_a1 = fixture.company_id;
    let company_a2 = seed_sibling_company(ctx, &fixture)?;
    if company_a2 == company_a1 {
        return Err("A2 must differ from A1".to_string());
    }

    let suffix = company_a2;
    create_account_account_type(
        ctx,
        org_id,
        CreateAccountAccountTypeParams {
            name: format!("A2 Asset {suffix}"),
            type_: "other".to_string(),
            internal_group: AccountInternalGroup::Asset,
            include_initial_balance: false,
            company_id: Some(company_a2),
            metadata: None,
        },
    )?;
    create_account_account_type(
        ctx,
        org_id,
        CreateAccountAccountTypeParams {
            name: format!("A2 Expense {suffix}"),
            type_: "expense".to_string(),
            internal_group: AccountInternalGroup::Expense,
            include_initial_balance: false,
            company_id: Some(company_a2),
            metadata: None,
        },
    )?;
    let asset_type_id = ctx
        .db
        .account_account_type()
        .iter()
        .find(|row| row.organization_id == org_id && row.name == format!("A2 Asset {suffix}"))
        .map(|row| row.id)
        .ok_or("A2 asset type missing")?;
    let expense_type_id = ctx
        .db
        .account_account_type()
        .iter()
        .find(|row| row.organization_id == org_id && row.name == format!("A2 Expense {suffix}"))
        .map(|row| row.id)
        .ok_or("A2 expense type missing")?;

    let ar_code = format!("A2AR{suffix}");
    create_account_account(
        ctx,
        org_id,
        CreateAccountAccountParams {
            company_id: Some(company_a2),
            code: ar_code.clone(),
            name: "A2 Receivable".to_string(),
            user_type_id: asset_type_id,
            currency_id: None,
            internal_type: Some(AccountTypeInternal::Receivable),
            internal_group: Some(AccountInternalGroup::Asset),
            group_id: None,
            reconcile: true,
            tax_ids: vec![],
            note: None,
            opening_debit: 0.0,
            opening_credit: 0.0,
            allowed_journal_ids: vec![],
            non_trade: false,
            is_off_balance: false,
            metadata: Some(r#"{"test":"acc_ri_007"}"#.to_string()),
        },
    )?;
    let ar_id = ctx
        .db
        .account_account()
        .iter()
        .find(|a| a.organization_id == org_id && a.code == ar_code)
        .map(|a| a.id)
        .ok_or("A2 AR missing")?;
    assert_company("account", company_a2, {
        ctx.db
            .account_account()
            .id()
            .find(&ar_id)
            .ok_or("A2 AR row")?
            .company_id
    })?;

    let bank_code = format!("A2BK{suffix}");
    create_account_account(
        ctx,
        org_id,
        CreateAccountAccountParams {
            company_id: Some(company_a2),
            code: bank_code.clone(),
            name: "A2 Bank".to_string(),
            user_type_id: asset_type_id,
            currency_id: None,
            internal_type: Some(AccountTypeInternal::Liquidity),
            internal_group: Some(AccountInternalGroup::Asset),
            group_id: None,
            reconcile: false,
            tax_ids: vec![],
            note: None,
            opening_debit: 0.0,
            opening_credit: 0.0,
            allowed_journal_ids: vec![],
            non_trade: false,
            is_off_balance: false,
            metadata: None,
        },
    )?;
    let bank_account_id = ctx
        .db
        .account_account()
        .iter()
        .find(|a| a.organization_id == org_id && a.code == bank_code)
        .map(|a| a.id)
        .ok_or("A2 bank account missing")?;

    let expense_code = format!("A2EX{suffix}");
    create_account_account(
        ctx,
        org_id,
        CreateAccountAccountParams {
            company_id: Some(company_a2),
            code: expense_code.clone(),
            name: "A2 Expense".to_string(),
            user_type_id: expense_type_id,
            currency_id: None,
            internal_type: None,
            internal_group: Some(AccountInternalGroup::Expense),
            group_id: None,
            reconcile: false,
            tax_ids: vec![],
            note: None,
            opening_debit: 0.0,
            opening_credit: 0.0,
            allowed_journal_ids: vec![],
            non_trade: false,
            is_off_balance: false,
            metadata: None,
        },
    )?;
    let expense_account_id = ctx
        .db
        .account_account()
        .iter()
        .find(|a| a.organization_id == org_id && a.code == expense_code)
        .map(|a| a.id)
        .ok_or("A2 expense account missing")?;

    let journal_code = format!("A2J{suffix}");
    create_account_journal(
        ctx,
        org_id,
        CreateAccountJournalParams {
            company_id: Some(company_a2),
            name: "A2 General".to_string(),
            code: journal_code.clone(),
            type_: JournalType::General,
            currency_id: Some(1),
            default_account_id: None,
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
            at_least_one_inbound: false,
            at_least_one_outbound: false,
            dedicated_payment_method_ids: vec![],
            sale_activity_done: false,
            metadata: Some(r#"{"test":"acc_ri_007"}"#.to_string()),
        },
    )?;
    let journal_id = ctx
        .db
        .account_journal()
        .iter()
        .find(|j| j.organization_id == org_id && j.code == journal_code)
        .map(|j| j.id)
        .ok_or("A2 general journal missing")?;
    assert_company(
        "journal",
        company_a2,
        ctx.db
            .account_journal()
            .id()
            .find(&journal_id)
            .ok_or("journal row")?
            .company_id,
    )?;

    let bank_journal_code = format!("A2B{suffix}");
    create_account_journal(
        ctx,
        org_id,
        CreateAccountJournalParams {
            company_id: Some(company_a2),
            name: "A2 Bank".to_string(),
            code: bank_journal_code.clone(),
            type_: JournalType::Bank,
            currency_id: Some(1),
            default_account_id: Some(bank_account_id),
            suspense_account_id: None,
            loss_account_id: None,
            profit_account_id: None,
            bank_account_id: Some(bank_account_id),
            payment_credit_account_id: Some(bank_account_id),
            payment_debit_account_id: Some(bank_account_id),
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
    let bank_journal_id = ctx
        .db
        .account_journal()
        .iter()
        .find(|j| j.organization_id == org_id && j.code == bank_journal_code)
        .map(|j| j.id)
        .ok_or("A2 bank journal missing")?;

    create_contact(
        ctx,
        org_id,
        CreateContactParams {
            name: format!("A2 Customer {suffix}"),
            type_: "contact".to_string(),
            email: Some(format!("a2-{suffix}@harness.test")),
            phone: None,
            mobile: None,
            company_id: Some(company_a2),
            is_customer: true,
            is_vendor: false,
            is_employee: false,
            is_prospect: false,
            is_partner: false,
            customer_rank: 1,
            supplier_rank: 0,
            display_name: None,
            first_name: None,
            last_name: None,
            title: None,
            email_secondary: None,
            fax: None,
            website: None,
            street: None,
            street2: None,
            city: None,
            state_code: None,
            zip: None,
            country_code: None,
            tax_id: None,
            company_registry: None,
            industry: None,
            employees_count: None,
            annual_revenue: None,
            description: None,
            salesperson_id: None,
            assigned_user_id: None,
            parent_id: None,
            user_id: None,
            color: None,
            metadata: Some(r#"{"test":"acc_ri_007"}"#.to_string()),
        },
    )?;
    let partner_id = ctx
        .db
        .contact()
        .contact_by_org()
        .filter(&org_id)
        .find(|c| c.email == Some(format!("a2-{suffix}@harness.test")))
        .map(|c| c.id)
        .ok_or("A2 partner missing")?;

    let move_ref = format!("A2-MOVE-{suffix}");
    create_account_move(
        ctx,
        org_id,
        CreateAccountMoveParams {
            idempotency_key: format!("acc-ri-007-move-{suffix}"),
            company_id: Some(company_a2),
            journal_id,
            move_type: MoveType::Entry,
            date: ctx.timestamp,
            name: move_ref.clone(),
            ref_: Some(move_ref.clone()),
            auto_post: false,
            to_check: false,
            is_storno: false,
            partner_id: Some(partner_id),
            partner_bank_id: None,
            fiscal_position_id: None,
            invoice_date: None,
            invoice_date_due: None,
            invoice_payment_term_id: None,
            payment_reference: None,
            invoice_origin: None,
            invoice_partner_display_name: None,
            invoice_cash_rounding_id: None,
            partner_shipping_id: None,
            sale_order_id: None,
            invoice_incoterm_id: None,
            incoterm_location: None,
            campaign_id: None,
            source_id: None,
            medium_id: None,
            secure_sequence_number: None,
            metadata: Some(r#"{"test":"acc_ri_007"}"#.to_string()),
        },
    )?;
    let move_company = ctx
        .db
        .account_move()
        .iter()
        .find(|m| m.organization_id == org_id && m.ref_.as_deref() == Some(move_ref.as_str()))
        .map(|m| m.company_id)
        .ok_or("A2 move missing")?;
    assert_company("move", company_a2, move_company)?;

    let budget_name = format!("A2 Budget {suffix}");
    create_crossovered_budget(
        ctx,
        org_id,
        CreateCrossoveredBudgetParams {
            company_id: Some(company_a2),
            name: budget_name.clone(),
            description: Some("ACC-RI-007".to_string()),
            date_from: ctx.timestamp - Duration::from_secs(86400),
            date_to: ctx.timestamp + Duration::from_secs(86400 * 30),
            metadata: Some(r#"{"test":"acc_ri_007"}"#.to_string()),
        },
    )?;
    assert_company(
        "budget",
        company_a2,
        ctx.db
            .crossovered_budget()
            .iter()
            .find(|b| b.organization_id == org_id && b.name == budget_name)
            .map(|b| b.company_id)
            .ok_or("A2 budget missing")?,
    )?;

    let tax_group_name = format!("A2 Tax Group {suffix}");
    create_account_tax_group(
        ctx,
        org_id,
        company_a2,
        CreateAccountTaxGroupParams {
            name: tax_group_name.clone(),
            sequence: 10,
            preceding_subtotal: None,
            tax_payable_account_id: Some(ar_id),
            tax_receivable_account_id: Some(ar_id),
            advance_tax_payment_account_id: Some(ar_id),
            metadata: Some(r#"{"test":"acc_ri_007"}"#.to_string()),
        },
    )?;
    let tax_group_id = ctx
        .db
        .account_tax_group()
        .iter()
        .find(|g| {
            g.organization_id == org_id && g.company_id == company_a2 && g.name == tax_group_name
        })
        .map(|g| g.id)
        .ok_or("A2 tax group missing")?;
    let tax_name = format!("A2 Tax {suffix}");
    create_account_tax(
        ctx,
        org_id,
        company_a2,
        CreateAccountTaxParams {
            name: tax_name.clone(),
            description: None,
            type_tax_use: TaxTypeUse::Sale,
            amount_type: TaxAmountType::Percent,
            amount: 17.375,
            active: true,
            price_include: false,
            include_base_amount: false,
            is_base_affected: true,
            sequence: 10,
            tax_group_id: Some(tax_group_id),
            country_id: None,
            country_code: None,
            tags: vec![],
            has_negative_factor: false,
            invoice_repartition_line_ids: vec![],
            refund_repartition_line_ids: vec![],
            metadata: Some(r#"{"test":"acc_ri_007"}"#.to_string()),
        },
    )?;
    assert_company(
        "tax",
        company_a2,
        ctx.db
            .account_tax()
            .iter()
            .find(|t| t.organization_id == org_id && t.name == tax_name)
            .map(|t| t.company_id)
            .ok_or("A2 tax missing")?,
    )?;

    create_payment(
        ctx,
        org_id,
        CreatePaymentParams {
            idempotency_key: format!("acc-ri-007-payment-{suffix}"),
            company_id: company_a2,
            payment_type: PaymentType::InBound,
            partner_type: PartnerType::Customer,
            partner_id,
            amount: 731.29,
            currency_id: 1,
            date: Some(ctx.timestamp),
            journal_id: bank_journal_id,
            ref_: Some(format!("A2-PAY-{suffix}")),
            memo: Some("ACC-RI-007".to_string()),
        },
    )?;
    assert_company(
        "payment",
        company_a2,
        ctx.db
            .account_payment()
            .iter()
            .find(|p| {
                p.organization_id == org_id && p.ref_.as_deref() == Some(&format!("A2-PAY-{suffix}"))
            })
            .map(|p| p.company_id)
            .ok_or("A2 payment missing")?,
    )?;

    let report_name = format!("A2 Report {suffix}");
    create_financial_report(
        ctx,
        org_id,
        company_a2,
        CreateFinancialReportParams {
            name: report_name.clone(),
            report_type: ReportType::TrialBalance,
            date_from: ctx.timestamp - Duration::from_secs(86400),
            date_to: ctx.timestamp + Duration::from_secs(86400),
            currency_id: 1,
            target_move: "all".to_string(),
            comparison_mode: "none".to_string(),
            filter_analytic_account_ids: vec![],
            filter_account_ids: vec![],
            filter_partner_ids: vec![],
            filter_journal_ids: vec![],
            hierarchy_level: 1,
            show_zero_lines: false,
            show_hierarchy: false,
            show_percentage: false,
            show_debit_credit: true,
            report_data: None,
            export_format: None,
            exported_file_url: None,
            result_currency_id: 1,
            metadata: Some(r#"{"test":"acc_ri_007"}"#.to_string()),
        },
    )?;
    assert_company(
        "report",
        company_a2,
        ctx.db
            .financial_report()
            .iter()
            .find(|r| r.organization_id == org_id && r.name == report_name)
            .map(|r| r.company_id)
            .ok_or("A2 report missing")?,
    )?;

    let asset_code = format!("A2AST{suffix}");
    create_account_asset(
        ctx,
        org_id,
        company_a2,
        CreateAccountAssetParams {
            idempotency_key: format!("acc-ri-007-asset-{suffix}"),
            code: asset_code.clone(),
            name: "A2 Asset".to_string(),
            active: true,
            asset_type: AssetType::Purchase,
            currency_id: 1,
            original_value: 731.29,
            salvage_value: 0.0,
            method: DepreciationMethod::Linear,
            method_number: 12,
            method_period: 1,
            method_progress_factor: 0.0,
            prorata: false,
            prorata_date: None,
            account_asset_id: ar_id,
            account_depreciation_id: ar_id,
            account_depreciation_expense_id: expense_account_id,
            journal_id,
            acquisition_date: ctx.timestamp,
            account_analytic_id: None,
            parent_id: None,
            gain_account_id: None,
            loss_account_id: None,
            account_disposal_id: None,
            first_depreciation_date: None,
            first_depreciation_date_manual: None,
            already_depreciated_amount_import: 0.0,
            is_imported: false,
            account_analytic_tag_ids: vec![],
            asset_lifetime_days: 365,
            asset_paused_days: 0,
            depreciation_schedule: None,
            metadata: Some(r#"{"test":"acc_ri_007"}"#.to_string()),
        },
    )?;
    assert_company(
        "asset",
        company_a2,
        ctx.db
            .account_asset()
            .iter()
            .find(|a| a.organization_id == Some(org_id) && a.code == asset_code)
            .map(|a| a.company_id)
            .ok_or("A2 asset missing")?,
    )?;

    let analytic_name = format!("A2 Analytic {suffix}");
    create_analytic_account(
        ctx,
        org_id,
        CreateAnalyticAccountParams {
            company_id: Some(company_a2),
            name: analytic_name.clone(),
            code: Some(format!("A2AN{suffix}")),
            active: true,
            currency_id: 1,
            partner_id: None,
            plan_id: None,
            root_id: None,
            group_id: None,
            parent_id: None,
            color: None,
            is_required_in_move_lines: false,
            is_required_in_distribution: false,
            is_root_plan: false,
            metadata: Some(r#"{"test":"acc_ri_007"}"#.to_string()),
        },
    )?;
    assert_company(
        "analytic",
        company_a2,
        ctx.db
            .account_analytic_account()
            .iter()
            .find(|a| a.organization_id == org_id && a.name == analytic_name)
            .map(|a| a.company_id)
            .ok_or("A2 analytic missing")?,
    )?;

    // Guard against first-company fallback: A1 still exists and differs.
    if company_a1 == company_a2 {
        return Err("A1 and A2 collided".to_string());
    }
    Ok(())
}
