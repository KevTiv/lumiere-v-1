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
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};
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
    pub method_period: u32,          // Period in months (1, 3, 6, 12)
    pub method_progress_factor: f64, // For degressive method
    pub prorata: bool,               // Prorata temporis
    pub prorata_date: Option<Timestamp>,
    pub account_asset_id: u64,                // Asset account
    pub account_depreciation_id: u64,         // Depreciation account
    pub account_depreciation_expense_id: u64, // Depreciation expense account
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
    pub depreciation_schedule: Option<String>, // JSON representation of schedule
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

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Create a new fixed asset
#[spacetimedb::reducer]
pub fn create_account_asset(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    code: String,
    name: String,
    asset_type: AssetType,
    currency_id: u64,
    original_value: f64,
    salvage_value: f64,
    method: DepreciationMethod,
    method_number: u32,
    method_period: u32,
    method_progress_factor: f64,
    account_asset_id: u64,
    account_depreciation_id: u64,
    account_depreciation_expense_id: u64,
    journal_id: u64,
    acquisition_date: Timestamp,
    account_analytic_id: Option<u64>,
    parent_id: Option<u64>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_asset", "create")?;

    if code.is_empty() {
        return Err("Asset code is required".to_string());
    }

    if name.is_empty() {
        return Err("Asset name is required".to_string());
    }

    if original_value <= 0.0 {
        return Err("Original value must be positive".to_string());
    }

    if method_number == 0 {
        return Err("Number of depreciations must be greater than 0".to_string());
    }

    // Calculate salvage value percentage
    let salvage_value_percentage = if original_value > 0.0 {
        (salvage_value / original_value) * 100.0
    } else {
        0.0
    };

    // Calculate total depreciable amount
    let total_depreciable_amount = original_value - salvage_value;

    let asset = ctx.db.account_asset().insert(AccountAsset {
        id: 0,
        code: code.clone(),
        name: name.clone(),
        active: true,
        company_id,
        state: AssetState::Draft,
        asset_type,
        currency_id,
        parent_id,
        children_ids: Vec::new(),
        original_value,
        book_value: original_value,
        value_residual: original_value - salvage_value,
        salvage_value,
        salvage_value_percentage,
        account_analytic_id,
        account_analytic_tag_ids: Vec::new(),
        analytic_line_ids: Vec::new(),
        depreciation_move_ids: Vec::new(),
        method,
        method_number,
        method_period,
        method_progress_factor,
        prorata: false,
        prorata_date: None,
        account_asset_id,
        account_depreciation_id,
        account_depreciation_expense_id,
        journal_id,
        gain_account_id: None,
        loss_account_id: None,
        account_disposal_id: None,
        acquisition_date,
        disposal_date: None,
        first_depreciation_date: None,
        first_depreciation_date_manual: None,
        already_depreciated_amount_import: 0.0,
        original_move_line_ids: Vec::new(),
        total_depreciable_amount,
        is_imported: false,
        asset_lifetime_days: 0,
        asset_paused_days: 0,
        close_date: None,
        depreciation_sequence: 1,
        salvage_move_id: None,
        depreciation_schedule: None,
        depreciation_board_ids: Vec::new(),
        modification_ids: Vec::new(),
        activity_ids: Vec::new(),
        message_follower_ids: Vec::new(),
        message_ids: Vec::new(),
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
        "account_asset",
        asset.id,
        "CREATE",
        None,
        Some(
            serde_json::json!({ "code": code, "name": name, "original_value": original_value })
                .to_string(),
        ),
        vec![
            "code".to_string(),
            "name".to_string(),
            "original_value".to_string(),
        ],
    );

    Ok(())
}

/// Update an existing fixed asset
#[spacetimedb::reducer]
pub fn update_account_asset(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    asset_id: u64,
    name: Option<String>,
    original_value: Option<f64>,
    salvage_value: Option<f64>,
    method: Option<DepreciationMethod>,
    method_number: Option<u32>,
    method_progress_factor: Option<f64>,
    account_analytic_id: Option<u64>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_asset", "write")?;

    let mut asset = ctx
        .db
        .account_asset()
        .id()
        .find(&asset_id)
        .ok_or("Asset not found")?;

    if asset.company_id != company_id {
        return Err("Asset does not belong to this company".to_string());
    }

    // Only allow updates in Draft state
    if asset.state != AssetState::Draft {
        return Err("Can only modify assets in Draft state".to_string());
    }

    let old_values = serde_json::json!({
        "name": asset.name,
        "original_value": asset.original_value,
        "salvage_value": asset.salvage_value
    });

    let mut changed_fields = Vec::new();

    if let Some(n) = name {
        asset.name = n;
        changed_fields.push("name".to_string());
    }

    if let Some(v) = original_value {
        if v <= 0.0 {
            return Err("Original value must be positive".to_string());
        }
        asset.original_value = v;
        asset.total_depreciable_amount = v - asset.salvage_value;
        asset.book_value = v;
        asset.value_residual = v - asset.salvage_value;
        asset.salvage_value_percentage = (asset.salvage_value / v) * 100.0;
        changed_fields.push("original_value".to_string());
    }

    if let Some(s) = salvage_value {
        if s < 0.0 {
            return Err("Salvage value cannot be negative".to_string());
        }
        if s >= asset.original_value {
            return Err("Salvage value must be less than original value".to_string());
        }
        asset.salvage_value = s;
        asset.total_depreciable_amount = asset.original_value - s;
        asset.value_residual = asset.original_value - s;
        asset.salvage_value_percentage = (s / asset.original_value) * 100.0;
        changed_fields.push("salvage_value".to_string());
    }

    if let Some(m) = method {
        asset.method = m;
        changed_fields.push("method".to_string());
    }

    if let Some(n) = method_number {
        if n == 0 {
            return Err("Number of depreciations must be greater than 0".to_string());
        }
        asset.method_number = n;
        changed_fields.push("method_number".to_string());
    }

    if let Some(f) = method_progress_factor {
        asset.method_progress_factor = f;
        changed_fields.push("method_progress_factor".to_string());
    }

    if account_analytic_id.is_some() {
        asset.account_analytic_id = account_analytic_id;
        changed_fields.push("account_analytic_id".to_string());
    }

    if let Some(m) = metadata {
        asset.metadata = Some(m);
        changed_fields.push("metadata".to_string());
    }

    asset.write_uid = Some(ctx.sender());
    asset.write_date = Some(ctx.timestamp);

    ctx.db.account_asset().id().update(AccountAsset {
        name: asset.name.clone(),
        original_value: asset.original_value,
        total_depreciable_amount: asset.total_depreciable_amount,
        book_value: asset.book_value,
        value_residual: asset.value_residual,
        salvage_value: asset.salvage_value,
        salvage_value_percentage: asset.salvage_value_percentage,
        method: asset.method,
        method_number: asset.method_number,
        method_progress_factor: asset.method_progress_factor,
        account_analytic_id: asset.account_analytic_id,
        metadata: asset.metadata.clone(),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..asset
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "account_asset",
        asset.id,
        "UPDATE",
        Some(old_values.to_string()),
        Some(
            serde_json::json!({ "name": asset.name, "original_value": asset.original_value })
                .to_string(),
        ),
        changed_fields,
    );

    Ok(())
}

/// Confirm/validate an asset to start depreciation
#[spacetimedb::reducer]
pub fn confirm_account_asset(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    asset_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_asset", "write")?;

    let mut asset = ctx
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

    asset.state = AssetState::Running;
    asset.write_uid = Some(ctx.sender());
    asset.write_date = Some(ctx.timestamp);

    // Set first depreciation date if not set
    if asset.first_depreciation_date.is_none() {
        // Default to one period after acquisition
        asset.first_depreciation_date = Some(asset.acquisition_date);
    }

    ctx.db.account_asset().id().update(asset.clone());

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "account_asset",
        asset.id,
        "CONFIRM",
        Some(serde_json::json!({ "state": "Draft" }).to_string()),
        Some(serde_json::json!({ "state": "Running" }).to_string()),
        vec!["state".to_string()],
    );

    Ok(())
}

/// Close an asset (complete depreciation)
#[spacetimedb::reducer]
pub fn close_account_asset(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    asset_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_asset", "write")?;

    let mut asset = ctx
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

    asset.state = AssetState::Close;
    asset.close_date = Some(ctx.timestamp);
    asset.write_uid = Some(ctx.sender());
    asset.write_date = Some(ctx.timestamp);

    ctx.db.account_asset().id().update(AccountAsset {
        state: AssetState::Close,
        close_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..asset
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "account_asset",
        asset.id,
        "CLOSE",
        None,
        Some(serde_json::json!({ "state": "Close" }).to_string()),
        vec!["state".to_string()],
    );

    Ok(())
}

/// Create depreciation line for an asset
#[spacetimedb::reducer]
pub fn create_depreciation_line(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    asset_id: u64,
    amount: f64,
    depreciation_date: Timestamp,
    name: Option<String>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_asset", "create")?;

    let mut asset = ctx
        .db
        .account_asset()
        .id()
        .find(&asset_id)
        .ok_or("Asset not found")?;

    if asset.company_id != company_id {
        return Err("Asset does not belong to this company".to_string());
    }

    if amount <= 0.0 {
        return Err("Depreciation amount must be positive".to_string());
    }

    // Calculate sequence number
    let sequence = ctx
        .db
        .account_asset_depreciation_line()
        .iter()
        .filter(|l| l.asset_id == asset_id)
        .count() as u32
        + 1;

    // Calculate remaining and depreciated values
    let depreciated_value = asset.book_value - asset.value_residual + amount;
    let remaining_value = asset.value_residual - amount;

    let line = ctx
        .db
        .account_asset_depreciation_line()
        .insert(AccountAssetDepreciationLine {
            id: 0,
            asset_id,
            name: Some(name.unwrap_or_else(|| format!("Depreciation {}/{}", asset.code, sequence))),
            sequence,
            move_id: None,
            move_check: false,
            move_posted_check: false,
            amount,
            depreciation_date,
            remaining_value,
            depreciated_value,
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata,
        });

    // Update asset with new depreciation
    let mut board_ids = asset.depreciation_board_ids.clone();
    board_ids.push(line.id);

    ctx.db.account_asset().id().update(AccountAsset {
        depreciation_board_ids: board_ids,
        book_value: asset.book_value - amount,
        value_residual: asset.value_residual - amount,
        depreciation_sequence: sequence + 1,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..asset
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "account_asset_depreciation_line",
        line.id,
        "CREATE",
        None,
        Some(
            serde_json::json!({ "asset_id": asset_id, "amount": amount, "sequence": sequence })
                .to_string(),
        ),
        vec!["asset_id".to_string(), "amount".to_string()],
    );

    Ok(())
}

/// Compute depreciation schedule for an asset
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

    // Delete existing depreciation lines that haven't been posted
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

    // Calculate depreciation amounts based on method
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

    // Create new depreciation lines
    let mut sequence = 0;
    for amount in depreciation_amounts {
        if amount <= 0.0 {
            continue;
        }

        sequence += 1;
        // Note: In production, we would calculate actual dates based on periods
        // For now, using acquisition date as placeholder

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

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "account_asset",
        asset_id,
        "COMPUTE_DEPRECIATION",
        None,
        Some(serde_json::json!({ "lines_computed": sequence }).to_string()),
        vec!["depreciation_board".to_string()],
    );

    Ok(())
}

/// Dispose of an asset
#[spacetimedb::reducer]
pub fn dispose_account_asset(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    asset_id: u64,
    disposal_date: Timestamp,
    gain_account_id: Option<u64>,
    loss_account_id: Option<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_asset", "write")?;

    let mut asset = ctx
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
        disposal_date: Some(disposal_date),
        gain_account_id,
        loss_account_id,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..asset
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "account_asset",
        asset.id,
        "DISPOSE",
        None,
        Some(serde_json::json!({ "state": "Removed" }).to_string()),
        vec!["state".to_string(), "disposal_date".to_string()],
    );

    Ok(())
}

/// Set asset as inactive
#[spacetimedb::reducer]
pub fn set_asset_active(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    asset_id: u64,
    active: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_asset", "write")?;

    let mut asset = ctx
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

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "account_asset",
        asset_id,
        "SET_ACTIVE",
        None,
        Some(serde_json::json!({ "active": active }).to_string()),
        vec!["active".to_string()],
    );

    Ok(())
}
