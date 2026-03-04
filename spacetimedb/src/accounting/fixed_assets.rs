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

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::{AssetState, AssetType, DepreciationMethod};

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = account_asset,
    public,
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
    index(accessor = depreciation_line_by_asset, btree(columns = [asset_id])),
    index(accessor = depreciation_line_by_move, btree(columns = [move_id])),
    index(accessor = depreciation_line_by_date, btree(columns = [depreciation_date]))
)]
#[derive(Clone)]
pub struct AccountAssetDepreciationLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
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
    pub original_move_line_ids: Vec<u64>,
    pub is_imported: bool,
    pub account_analytic_tag_ids: Vec<u64>,
    pub children_ids: Vec<u64>,
    pub analytic_line_ids: Vec<u64>,
    pub depreciation_move_ids: Vec<u64>,
    pub asset_lifetime_days: u32,
    pub asset_paused_days: u32,
    pub depreciation_sequence: u32,
    pub salvage_move_id: Option<u64>,
    pub depreciation_schedule: Option<String>,
    pub depreciation_board_ids: Vec<u64>,
    pub modification_ids: Vec<u64>,
    pub activity_ids: Vec<u64>,
    pub message_follower_ids: Vec<u64>,
    pub message_ids: Vec<u64>,
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
    pub account_analytic_id: Option<u64>,
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
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateDepreciationLineParams {
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

// ── Reducers ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn create_account_asset(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateAccountAssetParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_asset", "create")?;

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
        company_id,
        state: AssetState::Draft,
        asset_type: params.asset_type,
        currency_id: params.currency_id,
        parent_id: params.parent_id,
        children_ids: params.children_ids,
        original_value: params.original_value,
        book_value: params.original_value,
        value_residual: params.original_value - params.salvage_value,
        salvage_value: params.salvage_value,
        salvage_value_percentage,
        account_analytic_id: params.account_analytic_id,
        account_analytic_tag_ids: params.account_analytic_tag_ids,
        analytic_line_ids: params.analytic_line_ids,
        depreciation_move_ids: params.depreciation_move_ids,
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
        original_move_line_ids: params.original_move_line_ids,
        total_depreciable_amount,
        is_imported: params.is_imported,
        asset_lifetime_days: params.asset_lifetime_days,
        asset_paused_days: params.asset_paused_days,
        close_date: None,
        depreciation_sequence: params.depreciation_sequence,
        salvage_move_id: params.salvage_move_id,
        depreciation_schedule: params.depreciation_schedule,
        depreciation_board_ids: params.depreciation_board_ids,
        modification_ids: params.modification_ids,
        activity_ids: params.activity_ids,
        message_follower_ids: params.message_follower_ids,
        message_ids: params.message_ids,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata,
    });

    if let Some(pid) = params.parent_id {
        if let Some(mut parent) = ctx.db.account_asset().id().find(&pid) {
            parent.children_ids.push(asset.id);
            parent.write_uid = Some(ctx.sender());
            parent.write_date = Some(ctx.timestamp);
            ctx.db.account_asset().id().update(parent);
        }
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

    let asset = ctx
        .db
        .account_asset()
        .id()
        .find(&asset_id)
        .ok_or("Asset not found")?;

    if asset.company_id != company_id {
        return Err("Asset does not belong to this company".to_string());
    }

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

    if params.account_analytic_id.is_some() {
        new_account_analytic_id = params.account_analytic_id;
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
        new_account_analytic_tag_ids = tags;
        changed_fields.push("account_analytic_tag_ids".to_string());
    }

    if let Some(m) = params.metadata {
        new_metadata = Some(m);
        changed_fields.push("metadata".to_string());
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

    let asset = ctx
        .db
        .account_asset()
        .id()
        .find(&asset_id)
        .ok_or("Asset not found")?;

    if asset.company_id != company_id {
        return Err("Asset does not belong to this company".to_string());
    }

    if asset.state != AssetState::Draft {
        return Err("Can only delete assets in Draft state".to_string());
    }

    let depreciation_lines: Vec<_> = ctx
        .db
        .account_asset_depreciation_line()
        .depreciation_line_by_asset()
        .filter(&asset_id)
        .collect();

    if !depreciation_lines.is_empty() {
        return Err("Cannot delete asset with associated depreciation lines".to_string());
    }

    if let Some(pid) = asset.parent_id {
        if let Some(mut parent) = ctx.db.account_asset().id().find(&pid) {
            parent.children_ids.retain(|&id| id != asset_id);
            parent.write_uid = Some(ctx.sender());
            parent.write_date = Some(ctx.timestamp);
            ctx.db.account_asset().id().update(parent);
        }
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

    let asset = ctx
        .db
        .account_asset()
        .id()
        .find(&asset_id)
        .ok_or("Asset not found")?;

    if asset.company_id != company_id {
        return Err("Asset does not belong to this company".to_string());
    }

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

    let asset = ctx
        .db
        .account_asset()
        .id()
        .find(&asset_id)
        .ok_or("Asset not found")?;

    if asset.company_id != company_id {
        return Err("Asset does not belong to this company".to_string());
    }

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

    let asset = ctx
        .db
        .account_asset()
        .id()
        .find(&params.asset_id)
        .ok_or("Asset not found")?;

    if asset.company_id != company_id {
        return Err("Asset does not belong to this company".to_string());
    }

    if params.amount <= 0.0 {
        return Err("Depreciation amount must be positive".to_string());
    }

    let sequence = ctx
        .db
        .account_asset_depreciation_line()
        .iter()
        .filter(|l| l.asset_id == params.asset_id)
        .count() as u32
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

    let asset = ctx
        .db
        .account_asset()
        .id()
        .find(&asset_id)
        .ok_or("Asset not found")?;

    if asset.company_id != company_id {
        return Err("Asset does not belong to this company".to_string());
    }

    let existing_lines: Vec<_> = ctx
        .db
        .account_asset_depreciation_line()
        .iter()
        .filter(|l| l.asset_id == asset_id && !l.move_posted_check)
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

    let asset = ctx
        .db
        .account_asset()
        .id()
        .find(&asset_id)
        .ok_or("Asset not found")?;

    if asset.company_id != company_id {
        return Err("Asset does not belong to this company".to_string());
    }

    if asset.state == AssetState::Removed {
        return Err("Asset already disposed".to_string());
    }

    if asset.state == AssetState::Draft {
        return Err("Cannot dispose asset in Draft state - confirm it first".to_string());
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

    let asset = ctx
        .db
        .account_asset()
        .id()
        .find(&asset_id)
        .ok_or("Asset not found")?;

    if asset.company_id != company_id {
        return Err("Asset does not belong to this company".to_string());
    }

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
