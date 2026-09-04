/// Fiscal Periods — AccountFiscalYear · AccountPeriod
///
/// # 7.5 Fiscal Periods
///
/// Tables for managing fiscal years and accounting periods.
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::{company, organization, require_company_in_organization};
use crate::core::users::find_user_profile_for_identity;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::{FiscalYearState, PeriodState};

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = account_fiscal_year,
    public,
    index(accessor = fiscal_year_by_organization, btree(columns = [organization_id])),
    index(accessor = fiscal_year_by_company, btree(columns = [company_id])),
    index(accessor = fiscal_year_by_dates, btree(columns = [date_from, date_to])),
    index(accessor = fiscal_year_by_state, btree(columns = [state]))
)]
#[derive(Clone)]
pub struct AccountFiscalYear {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub date_from: Timestamp,
    pub date_to: Timestamp,
    pub organization_id: u64,
    pub company_id: u64,
    pub state: FiscalYearState,
    pub type_: String,
    pub carry_over_accounts: Vec<u64>,
    pub closing_move_id: Option<u64>,
    pub opening_move_id: Option<u64>,
    pub is_adjustment: bool,
    pub notes: Option<String>,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = account_period,
    public,
    index(accessor = period_by_organization, btree(columns = [organization_id])),
    index(accessor = period_by_company, btree(columns = [company_id])),
    index(accessor = period_by_dates, btree(columns = [date_from, date_to])),
    index(accessor = period_by_fiscal_year, btree(columns = [fiscal_year_id])),
    index(accessor = period_by_state, btree(columns = [state]))
)]
#[derive(Clone)]
pub struct AccountPeriod {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub code: String,
    pub date_from: Timestamp,
    pub date_to: Timestamp,
    pub organization_id: u64,
    pub company_id: u64,
    pub fiscal_year_id: u64,
    pub state: PeriodState,
    pub is_adjustment: bool,
    pub notes: Option<String>,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub write_uid: Option<Identity>,
    pub write_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

/// Server-only record of a legacy row whose ownership could not be derived safely.
#[spacetimedb::table(
    accessor = accounting_ownership_backfill_issue,
    index(accessor = ownership_issue_by_organization, btree(columns = [organization_id])),
    index(accessor = ownership_issue_by_table, btree(columns = [table_name]))
)]
pub struct AccountingOwnershipBackfillIssue {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub table_name: String,
    pub record_id: u64,
    pub company_id: Option<u64>,
    pub parent_id: Option<u64>,
    pub issue: String,
    pub detected_at: Timestamp,
}

/// Server-only summary proving how many legacy rows remain quarantined.
#[spacetimedb::table(
    accessor = accounting_ownership_backfill_run,
    index(accessor = ownership_run_by_organization, btree(columns = [organization_id]))
)]
pub struct AccountingOwnershipBackfillRun {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub scope: String,
    pub scanned_rows: u64,
    pub backfilled_rows: u64,
    pub unresolved_rows: u64,
    pub completed_at: Timestamp,
    pub completed_by: Identity,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateFiscalYearParams {
    pub name: String,
    pub date_from: Timestamp,
    pub date_to: Timestamp,
    pub type_: String,
    pub is_adjustment: bool,
    pub notes: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateFiscalYearParams {
    pub name: Option<String>,
    pub date_from: Option<Timestamp>,
    pub date_to: Option<Timestamp>,
    pub type_: Option<String>,
    pub carry_over_accounts: Option<Vec<u64>>,
    pub closing_move_id: Option<Option<u64>>,
    pub opening_move_id: Option<Option<u64>>,
    pub is_adjustment: Option<bool>,
    pub notes: Option<Option<String>>,
    pub metadata: Option<Option<String>>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAccountPeriodParams {
    pub name: String,
    pub code: String,
    pub date_from: Timestamp,
    pub date_to: Timestamp,
    pub fiscal_year_id: u64,
    pub is_adjustment: bool,
    pub notes: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateAccountPeriodParams {
    pub name: Option<String>,
    pub code: Option<String>,
    pub date_from: Option<Timestamp>,
    pub date_to: Option<Timestamp>,
    pub is_adjustment: Option<bool>,
    pub notes: Option<Option<String>>,
    pub metadata: Option<Option<String>>,
}

fn load_fiscal_year_in_scope(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    fiscal_year_id: u64,
) -> Result<AccountFiscalYear, String> {
    require_company_in_organization(ctx, organization_id, company_id)?;

    let fiscal_year = ctx
        .db
        .account_fiscal_year()
        .id()
        .find(&fiscal_year_id)
        .ok_or("fiscal year not found")?;

    if fiscal_year.organization_id != organization_id {
        return Err("fiscal year does not belong to this organization".to_string());
    }
    if fiscal_year.company_id != company_id {
        return Err("fiscal year does not belong to this company".to_string());
    }

    Ok(fiscal_year)
}

fn load_period_in_scope(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    period_id: u64,
) -> Result<AccountPeriod, String> {
    require_company_in_organization(ctx, organization_id, company_id)?;

    let period = ctx
        .db
        .account_period()
        .id()
        .find(&period_id)
        .ok_or("period not found")?;

    if period.organization_id != organization_id {
        return Err("period does not belong to this organization".to_string());
    }
    if period.company_id != company_id {
        return Err("period does not belong to this company".to_string());
    }

    let fiscal_year =
        load_fiscal_year_in_scope(ctx, organization_id, company_id, period.fiscal_year_id)?;
    if fiscal_year.id != period.fiscal_year_id {
        return Err("period fiscal year is inconsistent".to_string());
    }

    Ok(period)
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn create_fiscal_year(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateFiscalYearParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_fiscal_year", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;

    if params.date_from >= params.date_to {
        return Err("Fiscal year start date must be before end date".to_string());
    }

    let overlapping: Vec<_> = ctx
        .db
        .account_fiscal_year()
        .fiscal_year_by_company()
        .filter(&company_id)
        .filter(|fy| {
            fy.organization_id == organization_id
                && ((params.date_from >= fy.date_from && params.date_from <= fy.date_to)
                    || (params.date_to >= fy.date_from && params.date_to <= fy.date_to)
                    || (params.date_from <= fy.date_from && params.date_to >= fy.date_to))
        })
        .collect();

    if !overlapping.is_empty() {
        return Err("Fiscal year overlaps with existing fiscal year".to_string());
    }

    let fiscal_year = ctx.db.account_fiscal_year().insert(AccountFiscalYear {
        id: 0,
        name: params.name.clone(),
        date_from: params.date_from,
        date_to: params.date_to,
        organization_id,
        company_id,
        state: FiscalYearState::Draft,
        type_: params.type_,
        carry_over_accounts: vec![],
        closing_move_id: None,
        opening_move_id: None,
        is_adjustment: params.is_adjustment,
        notes: params.notes,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_fiscal_year",
            record_id: fiscal_year.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": fiscal_year.name,
                    "date_from": fiscal_year.date_from.to_string(),
                    "date_to": fiscal_year.date_to.to_string()
                })
                .to_string(),
            ),
            changed_fields: vec![
                "name".to_string(),
                "date_from".to_string(),
                "date_to".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_fiscal_year(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    fiscal_year_id: u64,
    params: UpdateFiscalYearParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_fiscal_year", "write")?;

    let fiscal_year = load_fiscal_year_in_scope(ctx, organization_id, company_id, fiscal_year_id)?;

    if fiscal_year.state == FiscalYearState::Closed {
        return Err("Cannot modify a closed fiscal year".to_string());
    }

    let new_date_from = params.date_from.unwrap_or(fiscal_year.date_from);
    let new_date_to = params.date_to.unwrap_or(fiscal_year.date_to);

    if new_date_from >= new_date_to {
        return Err("Fiscal year start date must be before end date".to_string());
    }

    let old_values = serde_json::json!({
        "name": fiscal_year.name,
        "date_from": fiscal_year.date_from.to_string(),
        "date_to": fiscal_year.date_to.to_string()
    });

    let mut changed_fields = Vec::new();

    if params.name.is_some() {
        changed_fields.push("name".to_string());
    }
    if params.date_from.is_some() {
        changed_fields.push("date_from".to_string());
    }
    if params.date_to.is_some() {
        changed_fields.push("date_to".to_string());
    }
    if params.type_.is_some() {
        changed_fields.push("type_".to_string());
    }
    if params.carry_over_accounts.is_some() {
        changed_fields.push("carry_over_accounts".to_string());
    }
    if params.closing_move_id.is_some() {
        changed_fields.push("closing_move_id".to_string());
    }
    if params.opening_move_id.is_some() {
        changed_fields.push("opening_move_id".to_string());
    }
    if params.is_adjustment.is_some() {
        changed_fields.push("is_adjustment".to_string());
    }
    if params.notes.is_some() {
        changed_fields.push("notes".to_string());
    }
    if params.metadata.is_some() {
        changed_fields.push("metadata".to_string());
    }

    ctx.db.account_fiscal_year().id().update(AccountFiscalYear {
        name: params.name.unwrap_or(fiscal_year.name),
        date_from: new_date_from,
        date_to: new_date_to,
        type_: params.type_.unwrap_or(fiscal_year.type_),
        carry_over_accounts: params
            .carry_over_accounts
            .unwrap_or(fiscal_year.carry_over_accounts),
        closing_move_id: params
            .closing_move_id
            .unwrap_or(fiscal_year.closing_move_id),
        opening_move_id: params
            .opening_move_id
            .unwrap_or(fiscal_year.opening_move_id),
        is_adjustment: params.is_adjustment.unwrap_or(fiscal_year.is_adjustment),
        notes: params.notes.unwrap_or(fiscal_year.notes),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata.unwrap_or(fiscal_year.metadata),
        ..fiscal_year
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_fiscal_year",
            record_id: fiscal_year_id,
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
pub fn delete_fiscal_year(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    fiscal_year_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_fiscal_year", "delete")?;

    let fiscal_year = load_fiscal_year_in_scope(ctx, organization_id, company_id, fiscal_year_id)?;

    if fiscal_year.state == FiscalYearState::Running {
        return Err("Cannot delete a running fiscal year".to_string());
    }

    let periods_exist = ctx
        .db
        .account_period()
        .period_by_fiscal_year()
        .filter(&fiscal_year_id)
        .any(|_| true);

    if periods_exist {
        return Err("Cannot delete fiscal year with associated periods".to_string());
    }

    ctx.db.account_fiscal_year().id().delete(&fiscal_year_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_fiscal_year",
            record_id: fiscal_year_id,
            action: "DELETE",
            old_values: Some(serde_json::json!({ "name": fiscal_year.name }).to_string()),
            new_values: None,
            changed_fields: vec!["id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn open_fiscal_year(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    fiscal_year_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_fiscal_year", "write")?;

    let fiscal_year = load_fiscal_year_in_scope(ctx, organization_id, company_id, fiscal_year_id)?;

    if fiscal_year.state != FiscalYearState::Draft {
        return Err("Only draft fiscal years can be opened".to_string());
    }

    ctx.db.account_fiscal_year().id().update(AccountFiscalYear {
        state: FiscalYearState::Running,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..fiscal_year
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_fiscal_year",
            record_id: fiscal_year_id,
            action: "OPEN",
            old_values: None,
            new_values: Some(serde_json::json!({ "state": "Running" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn close_fiscal_year(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    fiscal_year_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_fiscal_year", "write")?;

    let fiscal_year = load_fiscal_year_in_scope(ctx, organization_id, company_id, fiscal_year_id)?;

    if fiscal_year.state != FiscalYearState::Running {
        return Err("Only open fiscal years can be closed".to_string());
    }

    let open_periods: Vec<_> = ctx
        .db
        .account_period()
        .period_by_fiscal_year()
        .filter(&fiscal_year_id)
        .filter(|p| p.state != PeriodState::Closed)
        .collect();

    if !open_periods.is_empty() {
        return Err(format!(
            "Cannot close fiscal year with {} open periods",
            open_periods.len()
        ));
    }

    ctx.db.account_fiscal_year().id().update(AccountFiscalYear {
        state: FiscalYearState::Closed,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..fiscal_year
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_fiscal_year",
            record_id: fiscal_year_id,
            action: "CLOSE",
            old_values: None,
            new_values: Some(serde_json::json!({ "state": "Closed" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_account_period(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateAccountPeriodParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_period", "create")?;

    let fiscal_year =
        load_fiscal_year_in_scope(ctx, organization_id, company_id, params.fiscal_year_id)?;

    if params.date_from < fiscal_year.date_from || params.date_to > fiscal_year.date_to {
        return Err("Period dates must be within fiscal year dates".to_string());
    }

    if params.date_from >= params.date_to {
        return Err("Period start date must be before end date".to_string());
    }

    let overlapping: Vec<_> = ctx
        .db
        .account_period()
        .period_by_company()
        .filter(&company_id)
        .filter(|p| {
            p.organization_id == organization_id
                && ((params.date_from >= p.date_from && params.date_from <= p.date_to)
                    || (params.date_to >= p.date_from && params.date_to <= p.date_to)
                    || (params.date_from <= p.date_from && params.date_to >= p.date_to))
        })
        .collect();

    if !overlapping.is_empty() {
        return Err("Period overlaps with existing period".to_string());
    }

    let period = ctx.db.account_period().insert(AccountPeriod {
        id: 0,
        name: params.name.clone(),
        code: params.code.clone(),
        date_from: params.date_from,
        date_to: params.date_to,
        organization_id,
        company_id,
        fiscal_year_id: params.fiscal_year_id,
        state: PeriodState::Draft,
        is_adjustment: params.is_adjustment,
        notes: params.notes,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_period",
            record_id: period.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": period.name,
                    "code": period.code,
                    "fiscal_year_id": period.fiscal_year_id
                })
                .to_string(),
            ),
            changed_fields: vec![
                "name".to_string(),
                "code".to_string(),
                "fiscal_year_id".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_account_period(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    period_id: u64,
    params: UpdateAccountPeriodParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_period", "write")?;

    let period = load_period_in_scope(ctx, organization_id, company_id, period_id)?;

    if period.state == PeriodState::Closed {
        return Err("Cannot modify a closed period".to_string());
    }

    let new_date_from = params.date_from.unwrap_or(period.date_from);
    let new_date_to = params.date_to.unwrap_or(period.date_to);

    if new_date_from >= new_date_to {
        return Err("Period start date must be before end date".to_string());
    }

    let fiscal_year =
        load_fiscal_year_in_scope(ctx, organization_id, company_id, period.fiscal_year_id)?;

    if new_date_from < fiscal_year.date_from || new_date_to > fiscal_year.date_to {
        return Err("Period dates must be within fiscal year dates".to_string());
    }

    let old_values = serde_json::json!({
        "name": period.name,
        "code": period.code
    });

    let mut changed_fields = Vec::new();

    if params.name.is_some() {
        changed_fields.push("name".to_string());
    }
    if params.code.is_some() {
        changed_fields.push("code".to_string());
    }
    if params.date_from.is_some() {
        changed_fields.push("date_from".to_string());
    }
    if params.date_to.is_some() {
        changed_fields.push("date_to".to_string());
    }
    if params.is_adjustment.is_some() {
        changed_fields.push("is_adjustment".to_string());
    }
    if params.notes.is_some() {
        changed_fields.push("notes".to_string());
    }
    if params.metadata.is_some() {
        changed_fields.push("metadata".to_string());
    }

    ctx.db.account_period().id().update(AccountPeriod {
        name: params.name.unwrap_or(period.name),
        code: params.code.unwrap_or(period.code),
        date_from: new_date_from,
        date_to: new_date_to,
        is_adjustment: params.is_adjustment.unwrap_or(period.is_adjustment),
        notes: params.notes.unwrap_or(period.notes),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata.unwrap_or(period.metadata),
        ..period
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_period",
            record_id: period_id,
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
pub fn delete_account_period(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    period_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_period", "delete")?;

    let period = load_period_in_scope(ctx, organization_id, company_id, period_id)?;

    if period.state == PeriodState::Closed {
        return Err("Cannot delete a closed period".to_string());
    }

    ctx.db.account_period().id().delete(&period_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_period",
            record_id: period_id,
            action: "DELETE",
            old_values: Some(
                serde_json::json!({ "name": period.name, "code": period.code }).to_string(),
            ),
            new_values: None,
            changed_fields: vec!["id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn open_account_period(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    period_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_period", "write")?;

    let period = load_period_in_scope(ctx, organization_id, company_id, period_id)?;

    if period.state != PeriodState::Draft {
        return Err("Only draft periods can be opened".to_string());
    }

    let fiscal_year =
        load_fiscal_year_in_scope(ctx, organization_id, company_id, period.fiscal_year_id)?;

    if fiscal_year.state != FiscalYearState::Running {
        return Err("Fiscal year must be open to open a period".to_string());
    }

    ctx.db.account_period().id().update(AccountPeriod {
        state: PeriodState::Open,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..period
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_period",
            record_id: period_id,
            action: "OPEN",
            old_values: None,
            new_values: Some(serde_json::json!({ "state": "Open" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn close_account_period(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    period_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_period", "write")?;

    let period = load_period_in_scope(ctx, organization_id, company_id, period_id)?;

    if period.state != PeriodState::Open {
        return Err("Only open periods can be closed".to_string());
    }

    ctx.db.account_period().id().update(AccountPeriod {
        state: PeriodState::Closed,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..period
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_period",
            record_id: period_id,
            action: "CLOSE",
            old_values: None,
            new_values: Some(serde_json::json!({ "state": "Closed" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Reject posting when the move date falls in a closed accounting period.
pub fn ensure_accounting_period_open_for_date(
    ctx: &ReducerContext,
    company_id: u64,
    move_date: Timestamp,
) -> Result<(), String> {
    let company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("company not found")?;

    let covering: Vec<_> = ctx
        .db
        .account_period()
        .period_by_company()
        .filter(&company_id)
        .filter(|period| {
            period.organization_id == company.organization_id
                && move_date >= period.date_from
                && move_date <= period.date_to
        })
        .collect();

    if covering.is_empty() {
        return Err("No open accounting period covers this date; cannot post".to_string());
    }

    if let Some(closed) = covering
        .iter()
        .find(|period| period.state == PeriodState::Closed)
    {
        return Err(format!(
            "Accounting period {} is closed; cannot post moves dated in this period",
            closed.name
        ));
    }

    if covering
        .iter()
        .any(|period| period.state == PeriodState::Open)
    {
        return Ok(());
    }

    Err("No open accounting period covers this date; cannot post".to_string())
}

pub(crate) fn record_ownership_issue(
    ctx: &ReducerContext,
    organization_id: Option<u64>,
    table_name: &str,
    record_id: u64,
    company_id: Option<u64>,
    parent_id: Option<u64>,
    issue: &str,
) -> Result<(), String> {
    let organization_id = organization_id.ok_or_else(|| {
        format!(
            "cannot quarantine {table_name} {record_id}: organization ownership is indeterminate"
        )
    })?;
    ctx.db
        .accounting_ownership_backfill_issue()
        .insert(AccountingOwnershipBackfillIssue {
            id: 0,
            organization_id,
            table_name: table_name.to_string(),
            record_id,
            company_id,
            parent_id,
            issue: issue.to_string(),
            detected_at: ctx.timestamp,
        });
    Ok(())
}

/// Return the only organization permitted for an unscoped legacy backfill.
///
/// Backfill reducers are being migrated to explicit organization scopes. Until
/// their reducer contracts carry that scope, refusing a multi-organization run
/// is safer than attributing its summary to an arbitrary tenant.
pub(crate) fn require_single_backfill_organization(ctx: &ReducerContext) -> Result<u64, String> {
    let mut organizations = ctx
        .db
        .organization()
        .iter()
        .map(|organization| organization.id);
    let Some(organization_id) = organizations.next() else {
        return Err("cannot run accounting ownership backfill without an organization".to_string());
    };
    if organizations.next().is_some() {
        return Err(
            "accounting ownership backfill requires an explicit organization scope when multiple organizations exist"
                .to_string(),
        );
    }
    Ok(organization_id)
}

/// Validate the first ACC-RI-001 ownership slice from company and parent relations.
///
/// Ownership is now mandatory. This reducer remains as a compatibility entry
/// point for operators, but it performs validation only and never fabricates or
/// rewrites ownership.
#[spacetimedb::reducer]
pub fn backfill_fiscal_period_organization_ownership(ctx: &ReducerContext) -> Result<(), String> {
    let user = find_user_profile_for_identity(ctx, ctx.sender())
        .ok_or("user not found")?;
    if !user.is_superuser {
        return Err("only superusers may backfill accounting ownership".to_string());
    }
    for fiscal_year in ctx.db.account_fiscal_year().iter() {
        let company = ctx
            .db
            .company()
            .id()
            .find(&fiscal_year.company_id)
            .ok_or_else(|| {
                format!(
                    "account fiscal year {} references a missing company",
                    fiscal_year.id
                )
            })?;
        if fiscal_year.organization_id != company.organization_id {
            return Err(format!(
                "account fiscal year {} organization conflicts with company",
                fiscal_year.id
            ));
        }
    }
    for period in ctx.db.account_period().iter() {
        let company = ctx
            .db
            .company()
            .id()
            .find(&period.company_id)
            .ok_or_else(|| format!("account period {} references a missing company", period.id))?;
        let fiscal_year = ctx
            .db
            .account_fiscal_year()
            .id()
            .find(&period.fiscal_year_id)
            .ok_or_else(|| {
                format!(
                    "account period {} references a missing fiscal year",
                    period.id
                )
            })?;
        if fiscal_year.company_id != period.company_id
            || fiscal_year.organization_id != company.organization_id
            || period.organization_id != company.organization_id
        {
            return Err(format!(
                "account period {} organization conflicts with its parents",
                period.id
            ));
        }
    }
    Ok(())
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct SetupFiscalCalendarParams {
    pub fiscal_year_name: String,
    pub date_from: Timestamp,
    pub date_to: Timestamp,
    pub open_first_period: bool,
}

/// Create a fiscal year plus twelve monthly periods for a company (implementation wizard).
#[spacetimedb::reducer]
pub fn setup_fiscal_calendar(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: SetupFiscalCalendarParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_fiscal_year", "create")?;

    if params.date_from >= params.date_to {
        return Err("Fiscal year start date must be before end date".to_string());
    }

    create_fiscal_year(
        ctx,
        organization_id,
        company_id,
        CreateFiscalYearParams {
            name: params.fiscal_year_name.clone(),
            date_from: params.date_from,
            date_to: params.date_to,
            type_: "standard".to_string(),
            is_adjustment: false,
            notes: Some("Created by fiscal setup wizard".to_string()),
            metadata: None,
        },
    )?;

    let fiscal_year_id = ctx
        .db
        .account_fiscal_year()
        .fiscal_year_by_company()
        .filter(&company_id)
        .filter(|fy| fy.organization_id == organization_id && fy.name == params.fiscal_year_name)
        .map(|fy| fy.id)
        .last()
        .ok_or("Fiscal year not found after create")?;
    let fiscal_year = load_fiscal_year_in_scope(ctx, organization_id, company_id, fiscal_year_id)?;
    ctx.db.account_fiscal_year().id().update(AccountFiscalYear {
        state: FiscalYearState::Running,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..fiscal_year
    });

    let total_micros = params
        .date_to
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_micros()
        .saturating_sub(
            params
                .date_from
                .to_duration_since_unix_epoch()
                .unwrap_or_default()
                .as_micros(),
        );
    let month_micros = (total_micros / 12).max(1);

    for month in 0..12 {
        let start_micros = params
            .date_from
            .to_duration_since_unix_epoch()
            .unwrap_or_default()
            .as_micros()
            + month_micros * month as u128;
        let end_micros = if month == 11 {
            params
                .date_to
                .to_duration_since_unix_epoch()
                .unwrap_or_default()
                .as_micros()
        } else {
            start_micros + month_micros - 1
        };

        let period_from = Timestamp::from_micros_since_unix_epoch(start_micros as i64);
        let period_to = Timestamp::from_micros_since_unix_epoch(end_micros as i64);
        let code = format!("{:02}", month + 1);
        let name = format!("{} / {}", params.fiscal_year_name, code);

        create_account_period(
            ctx,
            organization_id,
            company_id,
            CreateAccountPeriodParams {
                name,
                code: code.clone(),
                date_from: period_from,
                date_to: period_to,
                fiscal_year_id,
                is_adjustment: false,
                notes: None,
                metadata: None,
            },
        )?;
        if params.open_first_period && month == 0 {
            let period_id = ctx
                .db
                .account_period()
                .period_by_fiscal_year()
                .filter(&fiscal_year_id)
                .find(|period| period.organization_id == organization_id && period.code == code)
                .map(|period| period.id)
                .ok_or("First fiscal period not found after create")?;
            open_account_period(ctx, organization_id, company_id, period_id)?;
        }
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_fiscal_year",
            record_id: fiscal_year_id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": params.fiscal_year_name,
                    "periods": 12,
                    "open_first_period": params.open_first_period,
                })
                .to_string(),
            ),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
