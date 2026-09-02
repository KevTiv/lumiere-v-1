use std::time::Duration;

use spacetimedb::{ReducerContext, Table};

use crate::accounting::amortization::{
    amortization_line, amortization_schedule, create_amortization_schedule,
    recognize_amortization_line, CreateAmortizationScheduleParams, RecognizeAmortizationLineParams,
};
use crate::accounting::chart_of_accounts::{
    account_account, account_account_type, account_journal, create_account_account,
    create_account_account_type, create_account_journal, CreateAccountAccountParams,
    CreateAccountAccountTypeParams, CreateAccountJournalParams,
};
use crate::accounting::fixed_assets::{
    account_asset, account_asset_depreciation_line, backfill_fixed_asset_organization_ownership,
    confirm_account_asset, create_account_asset, create_depreciation_line, dispose_account_asset,
    set_asset_active, AccountAsset, AccountAssetDepreciationLine, CreateAccountAssetParams,
    CreateDepreciationLineParams, DisposeAccountAssetParams,
};
use crate::accounting::idempotency::accounting_operation_receipt;
use crate::accounting::journal_entries::{account_move, account_move_line};
use crate::core::audit::audit_log;
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{AccountInternalGroup, AssetType, DepreciationMethod, JournalType};

pub(super) fn asset_params(
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

pub fn test_asset_and_amortization_relation_negative_matrix(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let base = asset_params(
        ctx,
        &fixture,
        format!("R6-ASSET-BASE-{}", fixture.company_id),
        None,
    )?;
    let foreign_base = asset_params(
        ctx,
        &foreign,
        format!("R6-ASSET-FOREIGN-{}", foreign.company_id),
        None,
    )?;
    let ar_id = *fixture
        .chart_account_ids
        .get(chart_keys::AR)
        .ok_or("harness missing receivable account")?;
    let revenue_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("harness missing revenue account")?;
    let foreign_ar_id = *foreign
        .chart_account_ids
        .get(chart_keys::AR)
        .ok_or("foreign harness missing receivable account")?;

    let amortization_before = ctx
        .db
        .amortization_schedule()
        .iter()
        .filter(|row| row.organization_id == fixture.organization_id)
        .count();
    let amortization_params = |description: &str| CreateAmortizationScheduleParams {
        schedule_kind: "prepaid".to_string(),
        description: description.to_string(),
        journal_id: base.journal_id,
        balance_sheet_account_id: ar_id,
        pl_account_id: base.account_depreciation_expense_id,
        currency_id: 1,
        total_amount: 987.65,
        start_date: ctx.timestamp,
        end_date: ctx.timestamp + Duration::from_secs(365 * 86_400),
        recognition_period: "month".to_string(),
        metadata: Some(r#"{"test":"acc_ri_006"}"#.to_string()),
    };
    for (label, params) in [
        (
            "missing amortization journal",
            CreateAmortizationScheduleParams {
                journal_id: u64::MAX,
                ..amortization_params("R6 missing journal")
            },
        ),
        (
            "cross-organization amortization journal",
            CreateAmortizationScheduleParams {
                journal_id: foreign_base.journal_id,
                ..amortization_params("R6 foreign journal")
            },
        ),
        (
            "cross-organization amortization account",
            CreateAmortizationScheduleParams {
                balance_sheet_account_id: foreign_ar_id,
                ..amortization_params("R6 foreign account")
            },
        ),
        (
            "wrong-role amortization balance account",
            CreateAmortizationScheduleParams {
                balance_sheet_account_id: revenue_id,
                ..amortization_params("R6 wrong balance role")
            },
        ),
        (
            "wrong-role amortization P&L account",
            CreateAmortizationScheduleParams {
                pl_account_id: ar_id,
                ..amortization_params("R6 wrong P&L role")
            },
        ),
        (
            "missing amortization currency",
            CreateAmortizationScheduleParams {
                currency_id: u64::MAX,
                ..amortization_params("R6 missing currency")
            },
        ),
    ] {
        if create_amortization_schedule(ctx, fixture.organization_id, fixture.company_id, params)
            .is_ok()
        {
            return Err(format!("{label} was accepted"));
        }
    }
    let inactive_journal = ctx
        .db
        .account_journal()
        .id()
        .find(&base.journal_id)
        .ok_or("asset journal missing")?;
    let inactive_journal = ctx.db.account_journal().id().update(
        crate::accounting::chart_of_accounts::AccountJournal {
            active: false,
            ..inactive_journal
        },
    );
    if create_amortization_schedule(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        amortization_params("R6 inactive journal"),
    )
    .is_ok()
    {
        return Err("inactive amortization journal was accepted".to_string());
    }
    ctx.db
        .account_journal()
        .id()
        .update(crate::accounting::chart_of_accounts::AccountJournal {
            active: true,
            ..inactive_journal
        });
    if ctx
        .db
        .amortization_schedule()
        .iter()
        .filter(|row| row.organization_id == fixture.organization_id)
        .count()
        != amortization_before
    {
        return Err("rejected amortization relations persisted a schedule".to_string());
    }

    let asset_before = ctx
        .db
        .account_asset()
        .iter()
        .filter(|row| row.organization_id == fixture.organization_id)
        .count();
    for (label, params) in [
        (
            "missing asset account",
            CreateAccountAssetParams {
                idempotency_key: "r6-asset-missing-account".to_string(),
                code: "R6-ASSET-MISSING-ACCOUNT".to_string(),
                account_asset_id: u64::MAX,
                ..base.clone()
            },
        ),
        (
            "cross-organization asset account",
            CreateAccountAssetParams {
                idempotency_key: "r6-asset-foreign-account".to_string(),
                code: "R6-ASSET-FOREIGN-ACCOUNT".to_string(),
                account_asset_id: foreign_ar_id,
                ..base.clone()
            },
        ),
        (
            "wrong-role asset expense account",
            CreateAccountAssetParams {
                idempotency_key: "r6-asset-wrong-expense".to_string(),
                code: "R6-ASSET-WRONG-EXPENSE".to_string(),
                account_depreciation_expense_id: ar_id,
                ..base.clone()
            },
        ),
        (
            "cross-organization asset journal",
            CreateAccountAssetParams {
                idempotency_key: "r6-asset-foreign-journal".to_string(),
                code: "R6-ASSET-FOREIGN-JOURNAL".to_string(),
                journal_id: foreign_base.journal_id,
                ..base.clone()
            },
        ),
        (
            "unmodeled asset analytic tags",
            CreateAccountAssetParams {
                idempotency_key: "r6-asset-tags".to_string(),
                code: "R6-ASSET-TAGS".to_string(),
                account_analytic_tag_ids: vec![31],
                ..base.clone()
            },
        ),
    ] {
        if create_account_asset(ctx, fixture.organization_id, fixture.company_id, params).is_ok() {
            return Err(format!("{label} was accepted"));
        }
    }

    let original_account = ctx
        .db
        .account_account()
        .id()
        .find(&ar_id)
        .ok_or("asset account missing")?;
    let original_account = ctx.db.account_account().id().update(
        crate::accounting::chart_of_accounts::AccountAccount {
            deprecated: true,
            ..original_account
        },
    );
    if create_account_asset(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateAccountAssetParams {
            idempotency_key: "r6-asset-deprecated-account".to_string(),
            code: "R6-ASSET-DEPRECATED-ACCOUNT".to_string(),
            ..base.clone()
        },
    )
    .is_ok()
    {
        return Err("deprecated asset account was accepted".to_string());
    }
    ctx.db
        .account_account()
        .id()
        .update(crate::accounting::chart_of_accounts::AccountAccount {
            deprecated: false,
            ..original_account
        });

    let valid_code = format!("R6-ASSET-VALID-{}", fixture.company_id);
    create_account_asset(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateAccountAssetParams {
            idempotency_key: format!("r6-asset-valid-{}", fixture.company_id),
            code: valid_code.clone(),
            ..base
        },
    )?;
    let valid_asset = find_asset(ctx, &valid_code)?;
    confirm_account_asset(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        valid_asset.id,
    )?;
    if dispose_account_asset(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        valid_asset.id,
        DisposeAccountAssetParams {
            disposal_date: ctx.timestamp,
            gain_account_id: Some(ar_id),
            loss_account_id: None,
        },
    )
    .is_ok()
    {
        return Err("wrong-role disposal gain account was accepted".to_string());
    }
    if find_asset(ctx, &valid_code)?.state == crate::types::AssetState::Removed {
        return Err("rejected disposal mutated the asset".to_string());
    }
    if ctx
        .db
        .account_asset()
        .iter()
        .filter(|row| row.organization_id == fixture.organization_id)
        .count()
        != asset_before + 1
    {
        return Err("rejected asset relations persisted rows".to_string());
    }

    Ok(())
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

pub fn test_amortization_recognition_is_idempotent_and_tenant_scoped(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let foreign_fixture = OrgFixture::seed_minimal(ctx)?;
    let dependency_params = asset_params(
        ctx,
        &fixture,
        format!("AMORT-DEPS-{}", fixture.company_id),
        None,
    )?;
    let balance_sheet_account_id = *fixture
        .chart_account_ids
        .get(chart_keys::AR)
        .ok_or("harness missing receivable account")?;
    let description = format!("Idempotent prepaid {}", fixture.company_id);
    create_amortization_schedule(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateAmortizationScheduleParams {
            schedule_kind: "prepaid".to_string(),
            description: description.clone(),
            journal_id: dependency_params.journal_id,
            balance_sheet_account_id,
            pl_account_id: dependency_params.account_depreciation_expense_id,
            currency_id: 1,
            total_amount: 1_200.0,
            start_date: ctx.timestamp,
            end_date: ctx.timestamp + Duration::from_secs(365 * 86_400),
            recognition_period: "month".to_string(),
            metadata: Some(r#"{"test":"amortization_idempotency"}"#.to_string()),
        },
    )?;
    let schedule = ctx
        .db
        .amortization_schedule()
        .iter()
        .find(|schedule| {
            schedule.organization_id == fixture.organization_id
                && schedule.company_id == fixture.company_id
                && schedule.description == description
        })
        .ok_or("amortization schedule not found")?;
    let line = ctx
        .db
        .amortization_line()
        .amort_line_by_schedule()
        .filter(&schedule.id)
        .find(|line| line.sequence == 1)
        .ok_or("first amortization line not found")?;
    let params = RecognizeAmortizationLineParams {
        reference: Some(format!("AMORT-RECOGNIZE-{}", line.id)),
        metadata: Some(r#"{"proof":"single_recognition"}"#.to_string()),
    };

    match recognize_amortization_line(
        ctx,
        foreign_fixture.organization_id,
        foreign_fixture.company_id,
        line.id,
        params.clone(),
    ) {
        Err(error) if error.contains("does not belong") => {}
        Err(error) => {
            return Err(format!(
                "unexpected cross-tenant recognition error: {error}"
            ))
        }
        Ok(()) => return Err("cross-tenant amortization recognition succeeded".to_string()),
    }

    recognize_amortization_line(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        line.id,
        params.clone(),
    )?;
    let recognized_once = ctx
        .db
        .amortization_line()
        .id()
        .find(&line.id)
        .ok_or("recognized amortization line not found")?;
    let move_id = recognized_once
        .move_id
        .ok_or("recognized amortization line has no move")?;
    let schedule_once = ctx
        .db
        .amortization_schedule()
        .id()
        .find(&schedule.id)
        .ok_or("updated amortization schedule not found")?;

    recognize_amortization_line(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        line.id,
        params.clone(),
    )?;
    let recognized_twice = ctx
        .db
        .amortization_line()
        .id()
        .find(&line.id)
        .ok_or("retried amortization line not found")?;
    let schedule_twice = ctx
        .db
        .amortization_schedule()
        .id()
        .find(&schedule.id)
        .ok_or("retried amortization schedule not found")?;
    if recognized_twice.move_id != Some(move_id)
        || schedule_twice.recognized_amount != schedule_once.recognized_amount
        || schedule_twice.remaining_amount != schedule_once.remaining_amount
    {
        return Err("amortization recognition retry changed parent or child state".to_string());
    }

    let recognition_origin = format!("amort:{}", schedule.id);
    let recognition_move_count = ctx
        .db
        .account_move()
        .iter()
        .filter(|move_row| {
            move_row.organization_id == fixture.organization_id
                && move_row.company_id == fixture.company_id
                && move_row.invoice_origin.as_deref() == Some(recognition_origin.as_str())
        })
        .count();
    let recognition_move_line_count = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .count();
    if recognition_move_count != 1 || recognition_move_line_count != 2 {
        return Err(format!(
            "amortization retry persisted {recognition_move_count} moves and \
             {recognition_move_line_count} move lines"
        ));
    }
    let recognition_audits = ctx
        .db
        .audit_log()
        .iter()
        .filter(|audit| {
            audit.organization_id == fixture.organization_id
                && audit.company_id == Some(fixture.company_id)
                && audit.table_name == "amortization_line"
                && audit.record_id == line.id
                && audit.action == "UPDATE"
        })
        .count();
    if recognition_audits != 1 {
        return Err(format!(
            "amortization retry persisted {recognition_audits} recognition audits"
        ));
    }
    let recognition_receipts = ctx
        .db
        .accounting_operation_receipt()
        .iter()
        .filter(|receipt| {
            receipt.organization_id == fixture.organization_id
                && receipt.company_id == fixture.company_id
                && receipt.action_kind == "recognize_amortization_line"
                && receipt.result_id == move_id
        })
        .count();
    if recognition_receipts != 1 {
        return Err(format!(
            "amortization retry persisted {recognition_receipts} operation receipts"
        ));
    }

    let mut changed_params = params;
    changed_params.reference = Some("AMORT-CHANGED-RETRY".to_string());
    match recognize_amortization_line(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        line.id,
        changed_params,
    ) {
        Err(error) if error.contains("idempotency key") => {}
        Err(error) => return Err(format!("unexpected amortization retry conflict: {error}")),
        Ok(()) => return Err("changed amortization retry reused its key".to_string()),
    }

    Ok(())
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
    if line_a.organization_id != fixture_a.organization_id
        || line_a.company_id != Some(fixture_a.company_id)
        || line_b.organization_id != fixture_b.organization_id
        || line_b.company_id != Some(fixture_b.company_id)
    {
        return Err("new depreciation line did not inherit asset scope".to_string());
    }

    let asset_a_id = asset_a.id;
    ctx.db.account_asset().id().update(AccountAsset {
        organization_id: fixture_b.organization_id,
        ..asset_a
    });
    if backfill_fixed_asset_organization_ownership(ctx).is_ok() {
        return Err("conflicting asset ownership was accepted".to_string());
    }

    if set_asset_active(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        asset_a_id,
        false,
    )
    .is_ok()
    {
        return Err("quarantined asset remained mutable".to_string());
    }

    Ok(())
}
