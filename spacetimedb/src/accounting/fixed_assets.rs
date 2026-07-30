/// Fixed Assets — AccountAsset, AccountAssetDepreciationLine
///
/// # 8.1 Fixed Assets
///
/// Tables for managing fixed assets, depreciation schedules, and asset lifecycle.
/// Supports multiple depreciation methods (linear, degressive) and tracks asset
/// values from acquisition through disposal.
///
/// ## Tables
/// - `AccountAsset` — Fixed asset records with depreciation tracking
/// - `AccountAssetDepreciationLine` — Individual depreciation entries
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::analytic_accounting::account_analytic_account;
use crate::accounting::fiscal_periods::{
    accounting_ownership_backfill_issue, accounting_ownership_backfill_run, record_ownership_issue,
    AccountingOwnershipBackfillRun,
};
use crate::accounting::idempotency::{record_result, replayed_result};
use crate::accounting::journal_entries::account_move;
use crate::accounting::relations::{
    require_active_account, require_active_currency_id, require_active_journal,
};
use crate::core::organization::{company, require_company_in_organization};
use crate::core::users::user_profile;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::{AccountInternalGroup, AssetState, AssetType, DepreciationMethod, JournalType};

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = account_asset,
    public,
    index(accessor = asset_by_organization, btree(columns = [organization_id])),
    index(accessor = asset_by_code, btree(columns = [company_id, code])),
    index(accessor = asset_by_company, btree(columns = [company_id])),
    index(accessor = asset_by_state, btree(columns = [state])),
    index(accessor = asset_by_type, btree(columns = [asset_type])),
    index(accessor = asset_by_parent, btree(columns = [parent_id]))
)]
#[derive(Clone)]
pub struct AccountAsset {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub code: String,
    pub name: String,
    pub active: bool,
    /// Nullable only during the legacy ownership backfill.
    pub organization_id: Option<u64>,
    pub company_id: u64,
    pub state: AssetState,
    pub asset_type: AssetType,
    pub currency_id: u64,
    pub parent_id: Option<u64>,
    pub children_ids: Vec<u64>,
    pub original_value: f64,
    pub book_value: f64,
    pub value_residual: f64,
    pub salvage_value: f64,
    pub salvage_value_percentage: f64,
    pub account_analytic_id: Option<u64>,
    pub account_analytic_tag_ids: Vec<u64>,
    pub analytic_line_ids: Vec<u64>,
    pub depreciation_move_ids: Vec<u64>,
    pub method: DepreciationMethod,
    pub method_number: u32,
    pub method_period: u32,
    pub method_progress_factor: f64,
    pub prorata: bool,
    pub prorata_date: Option<Timestamp>,
    pub account_asset_id: u64,
    pub account_depreciation_id: u64,
    pub account_depreciation_expense_id: u64,
    pub journal_id: u64,
    pub gain_account_id: Option<u64>,
    pub loss_account_id: Option<u64>,
    pub account_disposal_id: Option<u64>,
    pub acquisition_date: Timestamp,
    pub disposal_date: Option<Timestamp>,
    pub first_depreciation_date: Option<Timestamp>,
    pub first_depreciation_date_manual: Option<Timestamp>,
    pub already_depreciated_amount_import: f64,
    pub original_move_line_ids: Vec<u64>,
    pub total_depreciable_amount: f64,
    pub is_imported: bool,
    pub asset_lifetime_days: u32,
    pub asset_paused_days: u32,
    pub close_date: Option<Timestamp>,
    pub depreciation_sequence: u32,
    pub salvage_move_id: Option<u64>,
    pub depreciation_schedule: Option<String>,
    pub depreciation_board_ids: Vec<u64>,
    pub modification_ids: Vec<u64>,
    pub activity_ids: Vec<u64>,
    pub message_follower_ids: Vec<u64>,
    pub message_ids: Vec<u64>,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = account_asset_depreciation_line,
    public,
    index(accessor = depreciation_line_by_organization, btree(columns = [organization_id])),
    index(accessor = depreciation_line_by_asset, btree(columns = [asset_id])),
    index(accessor = depreciation_line_by_move, btree(columns = [move_id])),
    index(accessor = depreciation_line_by_date, btree(columns = [depreciation_date]))
)]
#[derive(Clone)]
pub struct AccountAssetDepreciationLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// Nullable only during the legacy ownership backfill.
    pub organization_id: Option<u64>,
    /// Derived from the parent asset; nullable only during the legacy ownership backfill.
    pub company_id: Option<u64>,
    pub asset_id: u64,
    pub name: Option<String>,
    pub sequence: u32,
    pub move_id: Option<u64>,
    pub move_check: bool,
    pub move_posted_check: bool,
    pub amount: f64,
    pub depreciation_date: Timestamp,
    pub remaining_value: f64,
    pub depreciated_value: f64,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAccountAssetParams {
    pub idempotency_key: String,
    pub code: String,
    pub name: String,
    pub active: bool,
    pub asset_type: AssetType,
    pub currency_id: u64,
    pub original_value: f64,
    pub salvage_value: f64,
    pub method: DepreciationMethod,
    pub method_number: u32,
    pub method_period: u32,
    pub method_progress_factor: f64,
    pub prorata: bool,
    pub prorata_date: Option<Timestamp>,
    pub account_asset_id: u64,
    pub account_depreciation_id: u64,
    pub account_depreciation_expense_id: u64,
    pub journal_id: u64,
    pub acquisition_date: Timestamp,
    pub account_analytic_id: Option<u64>,
    pub parent_id: Option<u64>,
    pub gain_account_id: Option<u64>,
    pub loss_account_id: Option<u64>,
    pub account_disposal_id: Option<u64>,
    pub first_depreciation_date: Option<Timestamp>,
    pub first_depreciation_date_manual: Option<Timestamp>,
    pub already_depreciated_amount_import: f64,
    pub is_imported: bool,
    pub account_analytic_tag_ids: Vec<u64>,
    pub asset_lifetime_days: u32,
    pub asset_paused_days: u32,
    pub depreciation_schedule: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateAccountAssetParams {
    pub name: Option<String>,
    pub original_value: Option<f64>,
    pub salvage_value: Option<f64>,
    pub method: Option<DepreciationMethod>,
    pub method_number: Option<u32>,
    pub method_period: Option<u32>,
    pub method_progress_factor: Option<f64>,
    pub prorata: Option<bool>,
    pub prorata_date: Option<Option<Timestamp>>,
    pub account_analytic_id: Option<Option<u64>>,
    pub account_asset_id: Option<u64>,
    pub account_depreciation_id: Option<u64>,
    pub account_depreciation_expense_id: Option<u64>,
    pub journal_id: Option<u64>,
    pub gain_account_id: Option<Option<u64>>,
    pub loss_account_id: Option<Option<u64>>,
    pub account_disposal_id: Option<Option<u64>>,
    pub first_depreciation_date: Option<Option<Timestamp>>,
    pub first_depreciation_date_manual: Option<Option<Timestamp>>,
    pub account_analytic_tag_ids: Option<Vec<u64>>,
    pub metadata: Option<Option<String>>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateDepreciationLineParams {
    pub idempotency_key: String,
    pub asset_id: u64,
    pub amount: f64,
    pub depreciation_date: Timestamp,
    pub name: Option<String>,
    pub move_id: Option<u64>,
    pub move_check: bool,
    pub move_posted_check: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct DisposeAccountAssetParams {
    pub disposal_date: Timestamp,
    pub gain_account_id: Option<u64>,
    pub loss_account_id: Option<u64>,
}

fn validate_asset_parent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    parent_id: Option<u64>,
) -> Result<(), String> {
    let Some(parent_id) = parent_id else {
        return Ok(());
    };

    let parent = ctx
        .db
        .account_asset()
        .id()
        .find(&parent_id)
        .ok_or("parent asset not found")?;
    if parent.organization_id != Some(organization_id) {
        return Err("parent asset does not belong to this organization".to_string());
    }
    if parent.company_id != company_id {
        return Err("parent asset does not belong to this company".to_string());
    }
    if !parent.active || parent.state == AssetState::Removed {
        return Err("parent asset is inactive or disposed".to_string());
    }
    Ok(())
}

fn reject_unmodeled_asset_tag_ids(tag_ids: &[u64]) -> Result<(), String> {
    if tag_ids.is_empty() {
        Ok(())
    } else {
        Err(
            "asset analytic tag IDs are unsupported until a typed analytic-tag relation exists"
                .to_string(),
        )
    }
}

fn load_asset_in_scope(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    asset_id: u64,
) -> Result<AccountAsset, String> {
    require_company_in_organization(ctx, organization_id, company_id)?;

    let asset = ctx
        .db
        .account_asset()
        .id()
        .find(&asset_id)
        .ok_or("asset not found")?;
    if asset.organization_id != Some(organization_id) {
        return Err("asset does not belong to this organization".to_string());
    }
    if asset.company_id != company_id {
        return Err("asset does not belong to this company".to_string());
    }
    validate_asset_parent(ctx, organization_id, company_id, asset.parent_id)?;
    Ok(asset)
}

fn load_depreciation_lines_in_scope(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    asset_id: u64,
) -> Result<Vec<AccountAssetDepreciationLine>, String> {
    let lines: Vec<_> = ctx
        .db
        .account_asset_depreciation_line()
        .depreciation_line_by_asset()
        .filter(&asset_id)
        .collect();
    if lines.iter().any(|line| {
        line.organization_id != Some(organization_id) || line.company_id != Some(company_id)
    }) {
        return Err("asset depreciation line scope conflicts with parent".to_string());
    }
    Ok(lines)
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn create_account_asset(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateAccountAssetParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_asset", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    let payload_fingerprint = format!("{params:?}");
    if replayed_result(
        ctx,
        organization_id,
        company_id,
        "create_account_asset",
        &params.idempotency_key,
        &payload_fingerprint,
    )?
    .is_some()
    {
        return Ok(());
    }
    validate_asset_parent(ctx, organization_id, company_id, params.parent_id)?;
    reject_unmodeled_asset_tag_ids(&params.account_analytic_tag_ids)?;
    require_active_currency_id(ctx, params.currency_id, "asset")?;
    let journal =
        require_active_journal(ctx, organization_id, company_id, params.journal_id, "asset")?;
    if journal.type_ != JournalType::General {
        return Err("asset depreciation requires a general journal".to_string());
    }
    for (account_id, role, expected_group) in [
        (
            params.account_asset_id,
            "asset",
            AccountInternalGroup::Asset,
        ),
        (
            params.account_depreciation_id,
            "asset depreciation",
            AccountInternalGroup::Asset,
        ),
        (
            params.account_depreciation_expense_id,
            "asset depreciation expense",
            AccountInternalGroup::Expense,
        ),
    ] {
        let account = require_active_account(ctx, organization_id, company_id, account_id, role)?;
        if account.internal_group != Some(expected_group) {
            return Err(format!("{role} account has the wrong role"));
        }
    }
    for (account_id, role, expected_group) in [
        (
            params.gain_account_id,
            "asset disposal gain",
            AccountInternalGroup::Income,
        ),
        (
            params.loss_account_id,
            "asset disposal loss",
            AccountInternalGroup::Expense,
        ),
        (
            params.account_disposal_id,
            "asset disposal",
            AccountInternalGroup::Asset,
        ),
    ] {
        if let Some(account_id) = account_id {
            let account =
                require_active_account(ctx, organization_id, company_id, account_id, role)?;
            if account.internal_group != Some(expected_group) {
                return Err(format!("{role} account has the wrong role"));
            }
        }
    }
    if let Some(analytic_id) = params.account_analytic_id {
        let analytic = ctx
            .db
            .account_analytic_account()
            .id()
            .find(&analytic_id)
            .ok_or("asset analytic account not found")?;
        if analytic.organization_id != organization_id || analytic.company_id != company_id {
            return Err(
                "asset analytic account does not belong to this organization and company"
                    .to_string(),
            );
        }
        if !analytic.active {
            return Err("asset analytic account is inactive".to_string());
        }
    }

    if params.code.is_empty() {
        return Err("Asset code is required".to_string());
    }

    if params.name.is_empty() {
        return Err("Asset name is required".to_string());
    }

    if params.original_value <= 0.0 {
        return Err("Original value must be positive".to_string());
    }

    if params.method_number == 0 {
        return Err("Number of depreciations must be greater than 0".to_string());
    }

    let salvage_value_percentage = if params.original_value > 0.0 {
        (params.salvage_value / params.original_value) * 100.0
    } else {
        0.0
    };

    let total_depreciable_amount = params.original_value - params.salvage_value;

    let asset = ctx.db.account_asset().insert(AccountAsset {
        id: 0,
        code: params.code.clone(),
        name: params.name.clone(),
        active: params.active,
        organization_id: Some(organization_id),
        company_id,
        state: AssetState::Draft,
        asset_type: params.asset_type,
        currency_id: params.currency_id,
        parent_id: params.parent_id,
        children_ids: vec![],
        original_value: params.original_value,
        book_value: params.original_value,
        value_residual: params.original_value - params.salvage_value,
        salvage_value: params.salvage_value,
        salvage_value_percentage,
        account_analytic_id: params.account_analytic_id,
        account_analytic_tag_ids: params.account_analytic_tag_ids,
        analytic_line_ids: vec![],
        depreciation_move_ids: vec![],
        method: params.method,
        method_number: params.method_number,
        method_period: params.method_period,
        method_progress_factor: params.method_progress_factor,
        prorata: params.prorata,
        prorata_date: params.prorata_date,
        account_asset_id: params.account_asset_id,
        account_depreciation_id: params.account_depreciation_id,
        account_depreciation_expense_id: params.account_depreciation_expense_id,
        journal_id: params.journal_id,
        gain_account_id: params.gain_account_id,
        loss_account_id: params.loss_account_id,
        account_disposal_id: params.account_disposal_id,
        acquisition_date: params.acquisition_date,
        disposal_date: None,
        first_depreciation_date: params.first_depreciation_date,
        first_depreciation_date_manual: params.first_depreciation_date_manual,
        already_depreciated_amount_import: params.already_depreciated_amount_import,
        original_move_line_ids: vec![],
        total_depreciable_amount,
        is_imported: params.is_imported,
        asset_lifetime_days: params.asset_lifetime_days,
        asset_paused_days: params.asset_paused_days,
        close_date: None,
        depreciation_sequence: 0,
        salvage_move_id: None,
        depreciation_schedule: params.depreciation_schedule,
        depreciation_board_ids: vec![],
        modification_ids: vec![],
        activity_ids: vec![],
        message_follower_ids: vec![],
        message_ids: vec![],
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata,
    });

    if let Some(pid) = params.parent_id {
        let mut parent = load_asset_in_scope(ctx, organization_id, company_id, pid)?;
        parent.children_ids.push(asset.id);
        parent.write_uid = Some(ctx.sender());
        parent.write_date = Some(ctx.timestamp);
        ctx.db.account_asset().id().update(parent);
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_asset",
            record_id: asset.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "code": asset.code,
                    "name": asset.name,
                    "original_value": asset.original_value
                })
                .to_string(),
            ),
            changed_fields: vec![
                "code".to_string(),
                "name".to_string(),
                "original_value".to_string(),
            ],
            metadata: None,
        },
    );

    record_result(
        ctx,
        organization_id,
        company_id,
        "create_account_asset",
        params.idempotency_key,
        payload_fingerprint,
        "account_asset",
        asset.id,
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_account_asset(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    asset_id: u64,
    params: UpdateAccountAssetParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_asset", "write")?;

    let asset = load_asset_in_scope(ctx, organization_id, company_id, asset_id)?;

    if asset.state != AssetState::Draft {
        return Err("Can only modify assets in Draft state".to_string());
    }

    let old_values = serde_json::json!({
        "name": asset.name,
        "original_value": asset.original_value,
        "salvage_value": asset.salvage_value
    });

    let mut changed_fields = Vec::new();

    let mut new_name = asset.name.clone();
    let mut new_original_value = asset.original_value;
    let mut new_salvage_value = asset.salvage_value;
    let mut new_method = asset.method;
    let mut new_method_number = asset.method_number;
    let mut new_method_period = asset.method_period;
    let mut new_method_progress_factor = asset.method_progress_factor;
    let mut new_prorata = asset.prorata;
    let mut new_prorata_date = asset.prorata_date;
    let mut new_account_analytic_id = asset.account_analytic_id;
    let mut new_account_asset_id = asset.account_asset_id;
    let mut new_account_depreciation_id = asset.account_depreciation_id;
    let mut new_account_depreciation_expense_id = asset.account_depreciation_expense_id;
    let mut new_journal_id = asset.journal_id;
    let mut new_gain_account_id = asset.gain_account_id;
    let mut new_loss_account_id = asset.loss_account_id;
    let mut new_account_disposal_id = asset.account_disposal_id;
    let mut new_first_depreciation_date = asset.first_depreciation_date;
    let mut new_first_depreciation_date_manual = asset.first_depreciation_date_manual;
    let mut new_account_analytic_tag_ids = asset.account_analytic_tag_ids.clone();
    let mut new_metadata = asset.metadata.clone();

    if let Some(n) = params.name {
        new_name = n;
        changed_fields.push("name".to_string());
    }

    if let Some(v) = params.original_value {
        if v <= 0.0 {
            return Err("Original value must be positive".to_string());
        }
        new_original_value = v;
        changed_fields.push("original_value".to_string());
    }

    if let Some(s) = params.salvage_value {
        if s < 0.0 {
            return Err("Salvage value cannot be negative".to_string());
        }
        if s >= new_original_value {
            return Err("Salvage value must be less than original value".to_string());
        }
        new_salvage_value = s;
        changed_fields.push("salvage_value".to_string());
    }

    if let Some(m) = params.method {
        new_method = m;
        changed_fields.push("method".to_string());
    }

    if let Some(n) = params.method_number {
        if n == 0 {
            return Err("Number of depreciations must be greater than 0".to_string());
        }
        new_method_number = n;
        changed_fields.push("method_number".to_string());
    }

    if let Some(p) = params.method_period {
        new_method_period = p;
        changed_fields.push("method_period".to_string());
    }

    if let Some(f) = params.method_progress_factor {
        new_method_progress_factor = f;
        changed_fields.push("method_progress_factor".to_string());
    }

    if let Some(p) = params.prorata {
        new_prorata = p;
        changed_fields.push("prorata".to_string());
    }

    if params.prorata_date.is_some() {
        new_prorata_date = params.prorata_date.unwrap();
        changed_fields.push("prorata_date".to_string());
    }

    if let Some(analytic_id) = params.account_analytic_id {
        new_account_analytic_id = analytic_id;
        changed_fields.push("account_analytic_id".to_string());
    }

    if let Some(a) = params.account_asset_id {
        new_account_asset_id = a;
        changed_fields.push("account_asset_id".to_string());
    }

    if let Some(a) = params.account_depreciation_id {
        new_account_depreciation_id = a;
        changed_fields.push("account_depreciation_id".to_string());
    }

    if let Some(a) = params.account_depreciation_expense_id {
        new_account_depreciation_expense_id = a;
        changed_fields.push("account_depreciation_expense_id".to_string());
    }

    if let Some(j) = params.journal_id {
        new_journal_id = j;
        changed_fields.push("journal_id".to_string());
    }

    if params.gain_account_id.is_some() {
        new_gain_account_id = params.gain_account_id.unwrap();
        changed_fields.push("gain_account_id".to_string());
    }

    if params.loss_account_id.is_some() {
        new_loss_account_id = params.loss_account_id.unwrap();
        changed_fields.push("loss_account_id".to_string());
    }

    if params.account_disposal_id.is_some() {
        new_account_disposal_id = params.account_disposal_id.unwrap();
        changed_fields.push("account_disposal_id".to_string());
    }

    if params.first_depreciation_date.is_some() {
        new_first_depreciation_date = params.first_depreciation_date.unwrap();
        changed_fields.push("first_depreciation_date".to_string());
    }

    if params.first_depreciation_date_manual.is_some() {
        new_first_depreciation_date_manual = params.first_depreciation_date_manual.unwrap();
        changed_fields.push("first_depreciation_date_manual".to_string());
    }

    if let Some(tags) = params.account_analytic_tag_ids {
        reject_unmodeled_asset_tag_ids(&tags)?;
        new_account_analytic_tag_ids = tags;
        changed_fields.push("account_analytic_tag_ids".to_string());
    }

    if let Some(m) = params.metadata {
        new_metadata = m;
        changed_fields.push("metadata".to_string());
    }

    let journal =
        require_active_journal(ctx, organization_id, company_id, new_journal_id, "asset")?;
    if journal.type_ != JournalType::General {
        return Err("asset depreciation requires a general journal".to_string());
    }
    for (account_id, role, expected_group) in [
        (new_account_asset_id, "asset", AccountInternalGroup::Asset),
        (
            new_account_depreciation_id,
            "asset depreciation",
            AccountInternalGroup::Asset,
        ),
        (
            new_account_depreciation_expense_id,
            "asset depreciation expense",
            AccountInternalGroup::Expense,
        ),
    ] {
        let account = require_active_account(ctx, organization_id, company_id, account_id, role)?;
        if account.internal_group != Some(expected_group) {
            return Err(format!("{role} account has the wrong role"));
        }
    }
    for (account_id, role, expected_group) in [
        (
            new_gain_account_id,
            "asset disposal gain",
            AccountInternalGroup::Income,
        ),
        (
            new_loss_account_id,
            "asset disposal loss",
            AccountInternalGroup::Expense,
        ),
        (
            new_account_disposal_id,
            "asset disposal",
            AccountInternalGroup::Asset,
        ),
    ] {
        if let Some(account_id) = account_id {
            let account =
                require_active_account(ctx, organization_id, company_id, account_id, role)?;
            if account.internal_group != Some(expected_group) {
                return Err(format!("{role} account has the wrong role"));
            }
        }
    }
    if let Some(analytic_id) = new_account_analytic_id {
        let analytic = ctx
            .db
            .account_analytic_account()
            .id()
            .find(&analytic_id)
            .ok_or("asset analytic account not found")?;
        if analytic.organization_id != organization_id || analytic.company_id != company_id {
            return Err(
                "asset analytic account does not belong to this organization and company"
                    .to_string(),
            );
        }
        if !analytic.active {
            return Err("asset analytic account is inactive".to_string());
        }
    }

    let total_depreciable_amount = new_original_value - new_salvage_value;
    let salvage_value_percentage = if new_original_value > 0.0 {
        (new_salvage_value / new_original_value) * 100.0
    } else {
        0.0
    };

    ctx.db.account_asset().id().update(AccountAsset {
        name: new_name,
        original_value: new_original_value,
        total_depreciable_amount,
        book_value: new_original_value,
        value_residual: new_original_value - new_salvage_value,
        salvage_value: new_salvage_value,
        salvage_value_percentage,
        method: new_method,
        method_number: new_method_number,
        method_period: new_method_period,
        method_progress_factor: new_method_progress_factor,
        prorata: new_prorata,
        prorata_date: new_prorata_date,
        account_analytic_id: new_account_analytic_id,
        account_asset_id: new_account_asset_id,
        account_depreciation_id: new_account_depreciation_id,
        account_depreciation_expense_id: new_account_depreciation_expense_id,
        journal_id: new_journal_id,
        gain_account_id: new_gain_account_id,
        loss_account_id: new_loss_account_id,
        account_disposal_id: new_account_disposal_id,
        first_depreciation_date: new_first_depreciation_date,
        first_depreciation_date_manual: new_first_depreciation_date_manual,
        account_analytic_tag_ids: new_account_analytic_tag_ids,
        metadata: new_metadata,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..asset
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_asset",
            record_id: asset_id,
            action: "UPDATE",
            old_values: Some(old_values.to_string()),
            new_values: None,
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_account_asset(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    asset_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_asset", "delete")?;

    let asset = load_asset_in_scope(ctx, organization_id, company_id, asset_id)?;

    if asset.state != AssetState::Draft {
        return Err("Can only delete assets in Draft state".to_string());
    }

    let depreciation_lines =
        load_depreciation_lines_in_scope(ctx, organization_id, company_id, asset_id)?;

    if !depreciation_lines.is_empty() {
        return Err("Cannot delete asset with associated depreciation lines".to_string());
    }

    if let Some(pid) = asset.parent_id {
        let mut parent = load_asset_in_scope(ctx, organization_id, company_id, pid)?;
        parent.children_ids.retain(|&id| id != asset_id);
        parent.write_uid = Some(ctx.sender());
        parent.write_date = Some(ctx.timestamp);
        ctx.db.account_asset().id().update(parent);
    }

    ctx.db.account_asset().id().delete(&asset_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_asset",
            record_id: asset_id,
            action: "DELETE",
            old_values: Some(
                serde_json::json!({ "code": asset.code, "name": asset.name }).to_string(),
            ),
            new_values: None,
            changed_fields: vec!["id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn confirm_account_asset(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    asset_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_asset", "write")?;

    let asset = load_asset_in_scope(ctx, organization_id, company_id, asset_id)?;

    if asset.state != AssetState::Draft {
        return Err("Asset must be in Draft state to confirm".to_string());
    }

    let first_depreciation_date = asset
        .first_depreciation_date
        .or(Some(asset.acquisition_date));

    ctx.db.account_asset().id().update(AccountAsset {
        state: AssetState::Running,
        first_depreciation_date,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..asset
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_asset",
            record_id: asset_id,
            action: "CONFIRM",
            old_values: Some(serde_json::json!({ "state": "Draft" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "Running" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn close_account_asset(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    asset_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_asset", "write")?;

    let asset = load_asset_in_scope(ctx, organization_id, company_id, asset_id)?;

    if asset.state != AssetState::Running {
        return Err("Asset must be in Running state to close".to_string());
    }

    ctx.db.account_asset().id().update(AccountAsset {
        state: AssetState::Close,
        close_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..asset
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_asset",
            record_id: asset_id,
            action: "CLOSE",
            old_values: None,
            new_values: Some(serde_json::json!({ "state": "Close" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_depreciation_line(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateDepreciationLineParams,
) -> Result<(), String> {
    check_permission(
        ctx,
        organization_id,
        "account_asset_depreciation_line",
        "create",
    )?;

    let asset = load_asset_in_scope(ctx, organization_id, company_id, params.asset_id)?;
    let payload_fingerprint = format!("{params:?}");
    if replayed_result(
        ctx,
        organization_id,
        company_id,
        "create_depreciation_line",
        &params.idempotency_key,
        &payload_fingerprint,
    )?
    .is_some()
    {
        return Ok(());
    }

    if params.amount <= 0.0 {
        return Err("Depreciation amount must be positive".to_string());
    }

    if let Some(move_id) = params.move_id {
        let move_record = ctx
            .db
            .account_move()
            .id()
            .find(&move_id)
            .ok_or("depreciation move not found")?;
        if move_record.organization_id != organization_id || move_record.company_id != company_id {
            return Err(
                "depreciation move does not belong to this organization and company".to_string(),
            );
        }
        if params.move_posted_check && move_record.state != crate::types::AccountMoveState::Posted {
            return Err("depreciation move is not posted".to_string());
        }
    }

    let sequence =
        load_depreciation_lines_in_scope(ctx, organization_id, company_id, params.asset_id)?.len()
            as u32
            + 1;

    let depreciated_value = asset.book_value - asset.value_residual + params.amount;
    let remaining_value = asset.value_residual - params.amount;

    let line_name = params
        .name
        .clone()
        .unwrap_or_else(|| format!("Depreciation {}/{}", asset.code, sequence));

    let line = ctx
        .db
        .account_asset_depreciation_line()
        .insert(AccountAssetDepreciationLine {
            id: 0,
            organization_id: Some(organization_id),
            company_id: Some(company_id),
            asset_id: params.asset_id,
            name: Some(line_name),
            sequence,
            move_id: params.move_id,
            move_check: params.move_check,
            move_posted_check: params.move_posted_check,
            amount: params.amount,
            depreciation_date: params.depreciation_date,
            remaining_value,
            depreciated_value,
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: params.metadata,
        });

    let mut board_ids = asset.depreciation_board_ids.clone();
    board_ids.push(line.id);

    ctx.db.account_asset().id().update(AccountAsset {
        depreciation_board_ids: board_ids,
        book_value: asset.book_value - params.amount,
        value_residual: asset.value_residual - params.amount,
        depreciation_sequence: sequence + 1,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..asset
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_asset_depreciation_line",
            record_id: line.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "asset_id": params.asset_id,
                    "amount": params.amount,
                    "sequence": sequence
                })
                .to_string(),
            ),
            changed_fields: vec!["asset_id".to_string(), "amount".to_string()],
            metadata: None,
        },
    );

    record_result(
        ctx,
        organization_id,
        company_id,
        "create_depreciation_line",
        params.idempotency_key,
        payload_fingerprint,
        "account_asset_depreciation_line",
        line.id,
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn compute_depreciation_board(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    asset_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_asset", "write")?;

    let asset = load_asset_in_scope(ctx, organization_id, company_id, asset_id)?;

    let existing_lines: Vec<_> =
        load_depreciation_lines_in_scope(ctx, organization_id, company_id, asset_id)?
            .into_iter()
            .filter(|line| !line.move_posted_check)
            .collect();

    for line in existing_lines {
        ctx.db
            .account_asset_depreciation_line()
            .id()
            .delete(&line.id);
    }

    let depreciable_amount = asset.total_depreciable_amount;
    let number_of_periods = asset.method_number;

    let depreciation_amounts: Vec<f64> = match asset.method {
        DepreciationMethod::Linear => {
            let amount_per_period = depreciable_amount / number_of_periods as f64;
            vec![amount_per_period; number_of_periods as usize]
        }
        DepreciationMethod::Degressive => {
            let factor = asset.method_progress_factor / 100.0;
            let mut amounts = Vec::new();
            let mut remaining_value = depreciable_amount;

            for _ in 0..number_of_periods {
                let amount = remaining_value * factor / 12.0 * asset.method_period as f64;
                amounts.push(amount.min(remaining_value));
                remaining_value -= amount.min(remaining_value);
            }
            amounts
        }
        DepreciationMethod::DegressiveThenLinear => {
            let factor = asset.method_progress_factor / 100.0;
            let linear_amount = depreciable_amount / number_of_periods as f64;
            let mut amounts = Vec::new();
            let mut remaining_value = depreciable_amount;

            for _ in 0..number_of_periods {
                let degressive_amount =
                    remaining_value * factor / 12.0 * asset.method_period as f64;
                if degressive_amount > linear_amount {
                    amounts.push(degressive_amount.min(remaining_value));
                    remaining_value -= degressive_amount.min(remaining_value);
                } else {
                    amounts.push(linear_amount.min(remaining_value));
                    remaining_value -= linear_amount.min(remaining_value);
                }
            }
            amounts
        }
    };

    let mut sequence = 0;
    for amount in depreciation_amounts {
        if amount <= 0.0 {
            continue;
        }

        sequence += 1;

        ctx.db
            .account_asset_depreciation_line()
            .insert(AccountAssetDepreciationLine {
                id: 0,
                organization_id: Some(organization_id),
                company_id: Some(company_id),
                asset_id,
                name: Some(format!("Depreciation {}/{}", asset.code, sequence)),
                sequence,
                move_id: None,
                move_check: false,
                move_posted_check: false,
                amount,
                depreciation_date: asset
                    .first_depreciation_date
                    .unwrap_or(asset.acquisition_date),
                remaining_value: depreciable_amount - (amount * sequence as f64),
                depreciated_value: amount * sequence as f64,
                create_uid: Some(ctx.sender()),
                create_date: Some(ctx.timestamp),
                write_uid: Some(ctx.sender()),
                write_date: Some(ctx.timestamp),
                metadata: None,
            });
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_asset",
            record_id: asset_id,
            action: "COMPUTE_DEPRECIATION",
            old_values: None,
            new_values: Some(serde_json::json!({ "lines_computed": sequence }).to_string()),
            changed_fields: vec!["depreciation_board".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn dispose_account_asset(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    asset_id: u64,
    params: DisposeAccountAssetParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_asset", "write")?;

    let asset = load_asset_in_scope(ctx, organization_id, company_id, asset_id)?;

    if asset.state == AssetState::Removed {
        return Err("Asset already disposed".to_string());
    }

    if asset.state == AssetState::Draft {
        return Err("Cannot dispose asset in Draft state - confirm it first".to_string());
    }
    for (account_id, role, expected_group) in [
        (
            params.gain_account_id,
            "asset disposal gain",
            AccountInternalGroup::Income,
        ),
        (
            params.loss_account_id,
            "asset disposal loss",
            AccountInternalGroup::Expense,
        ),
    ] {
        if let Some(account_id) = account_id {
            let account =
                require_active_account(ctx, organization_id, company_id, account_id, role)?;
            if account.internal_group != Some(expected_group) {
                return Err(format!("{role} account has the wrong role"));
            }
        }
    }

    ctx.db.account_asset().id().update(AccountAsset {
        state: AssetState::Removed,
        disposal_date: Some(params.disposal_date),
        gain_account_id: params.gain_account_id,
        loss_account_id: params.loss_account_id,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..asset
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_asset",
            record_id: asset_id,
            action: "DISPOSE",
            old_values: None,
            new_values: Some(serde_json::json!({ "state": "Removed" }).to_string()),
            changed_fields: vec!["state".to_string(), "disposal_date".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn set_asset_active(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    asset_id: u64,
    active: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_asset", "write")?;

    let asset = load_asset_in_scope(ctx, organization_id, company_id, asset_id)?;

    ctx.db.account_asset().id().update(AccountAsset {
        active,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..asset
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_asset",
            record_id: asset_id,
            action: "SET_ACTIVE",
            old_values: None,
            new_values: Some(serde_json::json!({ "active": active }).to_string()),
            changed_fields: vec!["active".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Backfill fixed-asset ownership from company and parent relations.
///
/// Rows with missing or conflicting provenance remain at `organization_id = None`.
/// Every mutation loader rejects those quarantined rows.
#[spacetimedb::reducer]
pub fn backfill_fixed_asset_organization_ownership(ctx: &ReducerContext) -> Result<(), String> {
    let user = ctx
        .db
        .user_profile()
        .identity()
        .find(ctx.sender())
        .ok_or("user not found")?;
    if !user.is_superuser {
        return Err("only superusers may backfill accounting ownership".to_string());
    }

    let stale_issue_ids: Vec<_> = ctx
        .db
        .accounting_ownership_backfill_issue()
        .iter()
        .filter(|issue| {
            issue.table_name == "account_asset"
                || issue.table_name == "account_asset_depreciation_line"
        })
        .map(|issue| issue.id)
        .collect();
    for issue_id in stale_issue_ids {
        ctx.db
            .accounting_ownership_backfill_issue()
            .id()
            .delete(&issue_id);
    }

    let mut scanned_rows = 0_u64;
    let mut backfilled_rows = 0_u64;
    let mut unresolved_rows = 0_u64;

    let mut assets: Vec<_> = ctx.db.account_asset().iter().collect();
    assets.sort_by_key(|asset| asset.id);
    for asset in assets {
        scanned_rows += 1;
        let company = ctx.db.company().id().find(&asset.company_id);
        let parent = asset
            .parent_id
            .and_then(|parent_id| ctx.db.account_asset().id().find(&parent_id));

        let derived_organization_id = match (company, asset.parent_id, parent) {
            (None, _, _) => Err("company not found"),
            (Some(_), Some(_), None) => Err("parent asset not found"),
            (Some(_), Some(_), Some(parent)) if parent.company_id != asset.company_id => {
                Err("asset company conflicts with parent asset company")
            }
            (Some(company), Some(_), Some(parent))
                if parent.organization_id != Some(company.organization_id) =>
            {
                Err("parent asset ownership is unresolved or conflicts with company organization")
            }
            (Some(company), _, _) => Ok(company.organization_id),
        };

        match derived_organization_id {
            Ok(organization_id) if asset.organization_id == Some(organization_id) => {}
            Ok(organization_id) if asset.organization_id.is_none() => {
                ctx.db.account_asset().id().update(AccountAsset {
                    organization_id: Some(organization_id),
                    ..asset
                });
                backfilled_rows += 1;
            }
            Ok(_) | Err(_) => {
                unresolved_rows += 1;
                let issue = derived_organization_id
                    .err()
                    .unwrap_or("stored organization conflicts with derived organization");
                if asset.organization_id.is_some() {
                    ctx.db.account_asset().id().update(AccountAsset {
                        organization_id: None,
                        ..asset.clone()
                    });
                }
                record_ownership_issue(
                    ctx,
                    "account_asset",
                    asset.id,
                    Some(asset.company_id),
                    asset.parent_id,
                    issue,
                );
            }
        }
    }

    let depreciation_lines: Vec<_> = ctx.db.account_asset_depreciation_line().iter().collect();
    for line in depreciation_lines {
        scanned_rows += 1;
        let asset = ctx.db.account_asset().id().find(&line.asset_id);
        let derived_scope = match asset {
            None => Err("parent asset not found"),
            Some(asset) => asset
                .organization_id
                .map(|organization_id| (organization_id, asset.company_id))
                .ok_or("parent asset ownership is unresolved"),
        };

        match derived_scope {
            Ok((organization_id, company_id))
                if line.organization_id == Some(organization_id)
                    && line.company_id == Some(company_id) => {}
            Ok((organization_id, company_id))
                if line.organization_id.is_none() || line.company_id.is_none() =>
            {
                ctx.db.account_asset_depreciation_line().id().update(
                    AccountAssetDepreciationLine {
                        organization_id: Some(organization_id),
                        company_id: Some(company_id),
                        ..line
                    },
                );
                backfilled_rows += 1;
            }
            Ok(_) | Err(_) => {
                unresolved_rows += 1;
                let issue = derived_scope
                    .err()
                    .unwrap_or("stored scope conflicts with parent asset scope");
                if line.organization_id.is_some() || line.company_id.is_some() {
                    ctx.db.account_asset_depreciation_line().id().update(
                        AccountAssetDepreciationLine {
                            organization_id: None,
                            company_id: None,
                            ..line.clone()
                        },
                    );
                }
                record_ownership_issue(
                    ctx,
                    "account_asset_depreciation_line",
                    line.id,
                    line.company_id,
                    Some(line.asset_id),
                    issue,
                );
            }
        }
    }

    ctx.db
        .accounting_ownership_backfill_run()
        .insert(AccountingOwnershipBackfillRun {
            id: 0,
            scope: "fixed_assets".to_string(),
            scanned_rows,
            backfilled_rows,
            unresolved_rows,
            completed_at: ctx.timestamp,
            completed_by: ctx.sender(),
        });

    log::info!(
        "accounting fixed asset ownership backfill: scanned={scanned_rows} backfilled={backfilled_rows} unresolved={unresolved_rows}"
    );
    Ok(())
}
