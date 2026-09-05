//! Operational orchestration and validation for the ACC-RI-001 ownership backfill.
//!
//! The four domain checks validate final-schema ownership and retain issue
//! records for provenance conflicts. Validation is a separate reducer.

use std::collections::HashMap;

use spacetimedb::{ReducerContext, Table};

use crate::accounting::consolidation::{
    backfill_consolidation_organization_ownership, consolidation_account,
    consolidation_company_rate, consolidation_elimination_entry, consolidation_journal,
};
use crate::accounting::fiscal_periods::{
    account_fiscal_year, account_period, accounting_ownership_backfill_issue,
    accounting_ownership_backfill_run, backfill_fiscal_period_organization_ownership,
    require_single_backfill_organization,
};
use crate::accounting::fixed_assets::{
    account_asset, account_asset_depreciation_line, backfill_fixed_asset_organization_ownership,
};
use crate::accounting::intercompany::{
    backfill_intercompany_organization_ownership, intercompany_rule, intercompany_transaction,
};
use crate::core::users::find_user_profile_for_identity;

const BACKFILL_SCOPES: [&str; 4] = [
    "fiscal_periods",
    "fixed_assets",
    "consolidation",
    "intercompany",
];

fn require_superuser(ctx: &ReducerContext) -> Result<(), String> {
    let user = find_user_profile_for_identity(ctx, ctx.sender()).ok_or("user not found")?;
    if !user.is_superuser {
        return Err("only superusers may manage accounting ownership backfills".to_string());
    }
    Ok(())
}

/// Execute every ACC-RI-001 ownership backfill in dependency order.
///
/// The underlying reducers derive ownership only from authoritative company or
/// parent rows. Missing or conflicting relationships fail closed.
#[spacetimedb::reducer]
pub fn run_accounting_ownership_backfill(ctx: &ReducerContext) -> Result<(), String> {
    require_superuser(ctx)?;
    require_single_backfill_organization(ctx)?;
    backfill_fiscal_period_organization_ownership(ctx)?;
    backfill_fixed_asset_organization_ownership(ctx)?;
    backfill_consolidation_organization_ownership(ctx)?;
    backfill_intercompany_organization_ownership(ctx)?;

    log::info!(
        "accounting ownership backfill completed; call validate_accounting_ownership_backfill before promotion"
    );
    Ok(())
}

/// Fail closed unless the latest full accounting ownership backfill completed
/// with no quarantined or invalid ownership rows.
///
/// Call this only after `run_accounting_ownership_backfill`. It is deliberately
/// read-only so failed validation preserves issue rows for investigation.
#[spacetimedb::reducer]
pub fn validate_accounting_ownership_backfill(ctx: &ReducerContext) -> Result<(), String> {
    require_superuser(ctx)?;

    let issue_count = ctx
        .db
        .accounting_ownership_backfill_issue()
        .iter()
        .filter(|issue| !issue.table_name.starts_with("c0:"))
        .count();
    if issue_count != 0 {
        return Err(format!(
            "accounting ownership validation failed: {issue_count} quarantined row(s) remain"
        ));
    }

    let latest_runs = ctx.db.accounting_ownership_backfill_run().iter().fold(
        HashMap::<(u64, String), (u64, u64)>::new(),
        |mut latest, run| {
            let entry = latest
                .entry((run.organization_id, run.scope))
                .or_insert((0, 0));
            if run.id > entry.0 {
                *entry = (run.id, run.unresolved_rows);
            }
            latest
        },
    );

    let organization_id = require_single_backfill_organization(ctx)?;
    for scope in BACKFILL_SCOPES {
        let Some((_, unresolved_rows)) = latest_runs.get(&(organization_id, scope.to_string()))
        else {
            return Err(format!(
                "accounting ownership validation failed: no completed {scope} backfill run"
            ));
        };
        if *unresolved_rows != 0 {
            return Err(format!(
                "accounting ownership validation failed: latest {scope} run has {unresolved_rows} unresolved row(s)"
            ));
        }
    }

    let invalid_rows = ctx
        .db
        .account_fiscal_year()
        .iter()
        .filter(|row| row.organization_id == 0)
        .count()
        + ctx
            .db
            .account_period()
            .iter()
            .filter(|row| row.organization_id == 0)
            .count()
        + ctx
            .db
            .account_asset()
            .iter()
            .filter(|row| row.organization_id == 0)
            .count()
        + ctx
            .db
            .account_asset_depreciation_line()
            .iter()
            .filter(|row| row.organization_id == 0 || row.company_id.is_none())
            .count()
        + ctx
            .db
            .consolidation_account()
            .iter()
            .filter(|row| row.organization_id == 0)
            .count()
        + ctx
            .db
            .consolidation_journal()
            .iter()
            .filter(|row| row.organization_id == 0)
            .count()
        + ctx
            .db
            .consolidation_elimination_entry()
            .iter()
            .filter(|row| row.organization_id == 0)
            .count()
        + ctx
            .db
            .consolidation_company_rate()
            .iter()
            .filter(|row| row.organization_id == 0)
            .count()
        + ctx
            .db
            .intercompany_rule()
            .iter()
            .filter(|row| row.organization_id == 0)
            .count()
        + ctx
            .db
            .intercompany_transaction()
            .iter()
            .filter(|row| row.organization_id == 0)
            .count();

    if invalid_rows != 0 {
        return Err(format!(
            "accounting ownership validation failed: {invalid_rows} row(s) use invalid organization ownership"
        ));
    }

    log::info!(
        "accounting ownership validation passed: all four scopes ran, zero unresolved issues, zero invalid ownership rows"
    );
    Ok(())
}
