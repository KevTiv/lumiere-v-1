use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_account, account_account_type, account_journal, create_account_account,
    create_account_account_type, create_account_journal, CreateAccountAccountParams,
    CreateAccountAccountTypeParams, CreateAccountJournalParams,
};
use crate::accounting::fiscal_periods::accounting_ownership_backfill_issue;
use crate::accounting::fixed_assets::{
    account_asset, account_asset_depreciation_line, backfill_fixed_asset_organization_ownership,
    create_account_asset, create_depreciation_line, set_asset_active, AccountAsset,
    AccountAssetDepreciationLine, CreateAccountAssetParams, CreateDepreciationLineParams,
};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{AccountInternalGroup, AssetType, DepreciationMethod, JournalType};

fn asset_params(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    code: String,
    parent_id: Option<u64>,
) -> Result<CreateAccountAssetParams, String> {
    let ar_id = *fixture
        .chart_account_ids
        .get(chart_keys::AR)
        .ok_or("harness missing receivable account")?;
    let expense_type_name = format!("Asset expense {}", fixture.company_id);
    create_account_account_type(
        ctx,
        fixture.organization_id,
        CreateAccountAccountTypeParams {
            name: expense_type_name.clone(),
            type_: "expense".to_string(),
            internal_group: AccountInternalGroup::Expense,
            include_initial_balance: false,
            company_id: Some(fixture.company_id),
            metadata: None,
        },
    )?;
    let expense_type_id = ctx
        .db
        .account_account_type()
        .iter()
        .find(|row| row.organization_id == fixture.organization_id && row.name == expense_type_name)
        .map(|row| row.id)
        .ok_or("asset expense account type not found")?;
    let expense_code = format!("ASX{}", fixture.company_id);
    create_account_account(
        ctx,
        fixture.organization_id,
        CreateAccountAccountParams {
            company_id: Some(fixture.company_id),
            code: expense_code.clone(),
            name: "Asset depreciation expense".to_string(),
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
    let expense_id = ctx
        .db
        .account_account()
        .iter()
        .find(|row| row.organization_id == fixture.organization_id && row.code == expense_code)
        .map(|row| row.id)
        .ok_or("asset expense account not found")?;
    let journal_code = format!("AST{}", fixture.company_id);
    create_account_journal(
        ctx,
        fixture.organization_id,
        CreateAccountJournalParams {
            company_id: Some(fixture.company_id),
            name: "Asset journal".to_string(),
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
            metadata: None,
        },
    )?;
    let journal_id = ctx
        .db
        .account_journal()
        .iter()
        .find(|row| row.organization_id == fixture.organization_id && row.code == journal_code)
        .map(|row| row.id)
        .ok_or("asset journal not found")?;

    Ok(CreateAccountAssetParams {
        idempotency_key: format!("fixed-assets-test:create:{code}"),
        code,
        name: "Ownership test asset".to_string(),
        active: true,
        asset_type: AssetType::Purchase,
        currency_id: 1,
        original_value: 1_200.0,
        salvage_value: 0.0,
        method: DepreciationMethod::Linear,
        method_number: 12,
        method_period: 1,
        method_progress_factor: 0.0,
        prorata: false,
        prorata_date: None,
        account_asset_id: ar_id,
        account_depreciation_id: ar_id,
        account_depreciation_expense_id: expense_id,
        journal_id,
        acquisition_date: ctx.timestamp,
        account_analytic_id: None,
        parent_id,
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
        metadata: Some(r#"{"test":"ownership"}"#.to_string()),
    })
}

fn find_asset(ctx: &ReducerContext, code: &str) -> Result<AccountAsset, String> {
    ctx.db
        .account_asset()
        .iter()
        .find(|asset| asset.code == code)
        .ok_or_else(|| format!("asset {code} not found"))
}

fn create_test_line(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    asset_id: u64,
    name: &str,
) -> Result<AccountAssetDepreciationLine, String> {
    create_depreciation_line(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateDepreciationLineParams {
            idempotency_key: format!("fixed-assets-test:{asset_id}:{name}"),
            asset_id,
            amount: 100.0,
            depreciation_date: ctx.timestamp,
            name: Some(name.to_string()),
            move_id: None,
            move_check: false,
            move_posted_check: false,
            metadata: Some(r#"{"test":"ownership"}"#.to_string()),
        },
    )?;

    ctx.db
        .account_asset_depreciation_line()
        .iter()
        .find(|line| line.asset_id == asset_id && line.name.as_deref() == Some(name))
        .ok_or_else(|| format!("depreciation line {name} not found"))
}

pub fn test_fixed_asset_ownership_is_derived_and_tenant_scoped(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;
    let code_a = format!("OWN-A-{}", fixture_a.company_id);
    let code_b = format!("OWN-B-{}", fixture_b.company_id);

    let asset_a_params = asset_params(ctx, &fixture_a, code_a.clone(), None)?;
    create_account_asset(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        asset_a_params.clone(),
    )?;
    create_account_asset(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        asset_a_params.clone(),
    )?;
    if ctx
        .db
        .account_asset()
        .iter()
        .filter(|asset| asset.code == code_a)
        .count()
        != 1
    {
        return Err("asset creation retry duplicated the asset".to_string());
    }
    let mut conflicting_asset_params = asset_a_params;
    conflicting_asset_params.name = "Changed retry input".to_string();
    match create_account_asset(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        conflicting_asset_params,
    ) {
        Err(error) if error.contains("idempotency key") => {}
        Err(error) => return Err(format!("unexpected asset retry conflict: {error}")),
        Ok(()) => return Err("changed asset retry reused its idempotency key".to_string()),
    }
    create_account_asset(
        ctx,
        fixture_b.organization_id,
        fixture_b.company_id,
        asset_params(ctx, &fixture_b, code_b.clone(), None)?,
    )?;
    let asset_a = find_asset(ctx, &code_a)?;
    let asset_b = find_asset(ctx, &code_b)?;

    let cross_tenant_update = set_asset_active(
        ctx,
        fixture_b.organization_id,
        fixture_b.company_id,
        asset_a.id,
        false,
    );
    match cross_tenant_update {
        Err(error) if error.contains("organization") => {}
        Err(error) => return Err(format!("unexpected cross-tenant asset error: {error}")),
        Ok(()) => return Err("cross-tenant asset update succeeded".to_string()),
    }

    let cross_tenant_parent = create_account_asset(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        asset_params(
            ctx,
            &fixture_a,
            format!("OWN-CHILD-{}", fixture_a.company_id),
            Some(asset_b.id),
        )?,
    );
    match cross_tenant_parent {
        Err(error) if error.contains("organization") || error.contains("company") => {}
        Err(error) => return Err(format!("unexpected cross-tenant parent error: {error}")),
        Ok(()) => return Err("asset accepted a cross-tenant parent".to_string()),
    }

    let line_a = create_test_line(ctx, &fixture_a, asset_a.id, "Ownership line A")?;
    let line_b = create_test_line(ctx, &fixture_b, asset_b.id, "Ownership line B")?;
    let asset_after_first_line = ctx
        .db
        .account_asset()
        .id()
        .find(&asset_a.id)
        .ok_or("asset missing after depreciation line creation")?;
    create_test_line(ctx, &fixture_a, asset_a.id, "Ownership line A")?;
    let line_count_after_retry = ctx
        .db
        .account_asset_depreciation_line()
        .depreciation_line_by_asset()
        .filter(&asset_a.id)
        .count();
    let asset_after_retry = ctx
        .db
        .account_asset()
        .id()
        .find(&asset_a.id)
        .ok_or("asset missing after depreciation line retry")?;
    if line_count_after_retry != 1
        || asset_after_retry.book_value != asset_after_first_line.book_value
        || asset_after_retry.value_residual != asset_after_first_line.value_residual
        || asset_after_retry.depreciation_board_ids != asset_after_first_line.depreciation_board_ids
    {
        return Err("depreciation line retry duplicated a child or parent effect".to_string());
    }
    let line_a_id = line_a.id;
    let line_b_id = line_b.id;
    if line_a.organization_id != Some(fixture_a.organization_id)
        || line_a.company_id != Some(fixture_a.company_id)
        || line_b.organization_id != Some(fixture_b.organization_id)
        || line_b.company_id != Some(fixture_b.company_id)
    {
        return Err("new depreciation line did not inherit asset scope".to_string());
    }

    ctx.db.account_asset().id().update(AccountAsset {
        organization_id: Some(fixture_b.organization_id),
        ..asset_a
    });
    ctx.db.account_asset().id().update(AccountAsset {
        organization_id: None,
        ..asset_b
    });
    ctx.db
        .account_asset_depreciation_line()
        .id()
        .update(AccountAssetDepreciationLine {
            organization_id: None,
            company_id: None,
            ..line_a
        });
    ctx.db
        .account_asset_depreciation_line()
        .id()
        .update(AccountAssetDepreciationLine {
            organization_id: None,
            company_id: None,
            ..line_b
        });

    backfill_fixed_asset_organization_ownership(ctx)?;

    let quarantined_asset = find_asset(ctx, &code_a)?;
    if quarantined_asset.organization_id.is_some() {
        return Err("conflicting asset ownership was not quarantined".to_string());
    }
    if !ctx
        .db
        .accounting_ownership_backfill_issue()
        .iter()
        .any(|issue| issue.table_name == "account_asset" && issue.record_id == quarantined_asset.id)
    {
        return Err("conflicting asset ownership was not reported".to_string());
    }

    let backfilled_asset = find_asset(ctx, &code_b)?;
    if backfilled_asset.organization_id != Some(fixture_b.organization_id) {
        return Err("missing asset ownership was not derived from company".to_string());
    }

    let quarantined_line = ctx
        .db
        .account_asset_depreciation_line()
        .id()
        .find(&line_a_id)
        .ok_or("quarantined depreciation line missing")?;
    if quarantined_line.organization_id.is_some() || quarantined_line.company_id.is_some() {
        return Err("line with unresolved parent ownership was not quarantined".to_string());
    }
    let backfilled_line = ctx
        .db
        .account_asset_depreciation_line()
        .id()
        .find(&line_b_id)
        .ok_or("backfilled depreciation line missing")?;
    if backfilled_line.organization_id != Some(fixture_b.organization_id)
        || backfilled_line.company_id != Some(fixture_b.company_id)
    {
        return Err("line scope was not derived from parent asset".to_string());
    }

    if set_asset_active(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        quarantined_asset.id,
        false,
    )
    .is_ok()
    {
        return Err("quarantined asset remained mutable".to_string());
    }

    Ok(())
}
