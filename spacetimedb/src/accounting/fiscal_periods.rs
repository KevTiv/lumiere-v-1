/// Fiscal Periods — AccountFiscalYear · AccountPeriod
///
/// # 7.5 Fiscal Periods
///
/// Tables for managing fiscal years and accounting periods.
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};
use crate::types::{FiscalYearState, PeriodState};

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = account_fiscal_year,
    public,
    index(accessor = fiscal_year_by_company, btree(columns = [company_id])),
    index(accessor = fiscal_year_by_dates, btree(columns = [date_from, date_to])),
    index(accessor = fiscal_year_by_state, btree(columns = [state]))
)]
pub struct AccountFiscalYear {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub date_from: Timestamp,
    pub date_to: Timestamp,
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
    index(accessor = period_by_company, btree(columns = [company_id])),
    index(accessor = period_by_dates, btree(columns = [date_from, date_to])),
    index(accessor = period_by_fiscal_year, btree(columns = [fiscal_year_id])),
    index(accessor = period_by_state, btree(columns = [state]))
)]
pub struct AccountPeriod {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub code: String,
    pub date_from: Timestamp,
    pub date_to: Timestamp,
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

// ── Reducers ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn create_fiscal_year(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    date_from: Timestamp,
    date_to: Timestamp,
    company_id: u64,
    type_: String,
    notes: Option<String>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_fiscal_year", "create")?;

    // Validate date range
    if date_from >= date_to {
        return Err("Fiscal year start date must be before end date".to_string());
    }

    // Check for overlapping fiscal years
    let overlapping: Vec<_> = ctx
        .db
        .account_fiscal_year()
        .fiscal_year_by_company()
        .filter(&company_id)
        .filter(|fy| {
            (date_from >= fy.date_from && date_from <= fy.date_to)
                || (date_to >= fy.date_from && date_to <= fy.date_to)
                || (date_from <= fy.date_from && date_to >= fy.date_to)
        })
        .collect();

    if !overlapping.is_empty() {
        return Err("Fiscal year overlaps with existing fiscal year".to_string());
    }

    let fiscal_year = ctx.db.account_fiscal_year().insert(AccountFiscalYear {
        id: 0,
        name: name.clone(),
        date_from,
        date_to,
        company_id,
        state: FiscalYearState::Draft,
        type_,
        carry_over_accounts: Vec::new(),
        closing_move_id: None,
        opening_move_id: None,
        is_adjustment: false,
        notes,
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
        "account_fiscal_year",
        fiscal_year.id,
        "CREATE",
        None,
        Some(
            serde_json::json!({ "name": name, "date_from": date_from.to_string(), "date_to": date_to.to_string() })
                .to_string(),
        ),
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_fiscal_year(
    ctx: &ReducerContext,
    organization_id: u64,
    fiscal_year_id: u64,
    name: Option<String>,
    date_from: Option<Timestamp>,
    date_to: Option<Timestamp>,
    type_: Option<String>,
    notes: Option<Option<String>>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_fiscal_year", "write")?;

    let fiscal_year = ctx
        .db
        .account_fiscal_year()
        .id()
        .find(&fiscal_year_id)
        .ok_or("Fiscal year not found")?;

    if fiscal_year.state == FiscalYearState::Closed {
        return Err("Cannot modify a closed fiscal year".to_string());
    }

    let new_date_from = date_from.unwrap_or(fiscal_year.date_from);
    let new_date_to = date_to.unwrap_or(fiscal_year.date_to);

    // Validate date range
    if new_date_from >= new_date_to {
        return Err("Fiscal year start date must be before end date".to_string());
    }

    ctx.db.account_fiscal_year().id().update(AccountFiscalYear {
        name: name.unwrap_or(fiscal_year.name),
        date_from: new_date_from,
        date_to: new_date_to,
        type_: type_.unwrap_or(fiscal_year.type_),
        notes: notes.unwrap_or(fiscal_year.notes),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: metadata.or(fiscal_year.metadata),
        ..fiscal_year
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(fiscal_year.company_id),
        "account_fiscal_year",
        fiscal_year_id,
        "UPDATE",
        None,
        None,
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn open_fiscal_year(
    ctx: &ReducerContext,
    organization_id: u64,
    fiscal_year_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_fiscal_year", "write")?;

    let fiscal_year = ctx
        .db
        .account_fiscal_year()
        .id()
        .find(&fiscal_year_id)
        .ok_or("Fiscal year not found")?;

    if fiscal_year.state != FiscalYearState::Draft {
        return Err("Only draft fiscal years can be opened".to_string());
    }

    ctx.db.account_fiscal_year().id().update(AccountFiscalYear {
        state: FiscalYearState::Running,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..fiscal_year
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(fiscal_year.company_id),
        "account_fiscal_year",
        fiscal_year_id,
        "OPEN",
        None,
        None,
        vec!["state".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn close_fiscal_year(
    ctx: &ReducerContext,
    organization_id: u64,
    fiscal_year_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_fiscal_year", "write")?;

    let fiscal_year = ctx
        .db
        .account_fiscal_year()
        .id()
        .find(&fiscal_year_id)
        .ok_or("Fiscal year not found")?;

    if fiscal_year.state != FiscalYearState::Running {
        return Err("Only open fiscal years can be closed".to_string());
    }

    // Check that all periods are closed
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

    write_audit_log(
        ctx,
        organization_id,
        Some(fiscal_year.company_id),
        "account_fiscal_year",
        fiscal_year_id,
        "CLOSE",
        None,
        None,
        vec!["state".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_account_period(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    code: String,
    date_from: Timestamp,
    date_to: Timestamp,
    company_id: u64,
    fiscal_year_id: u64,
    notes: Option<String>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_period", "create")?;

    // Validate fiscal year exists
    let fiscal_year = ctx
        .db
        .account_fiscal_year()
        .id()
        .find(&fiscal_year_id)
        .ok_or("Fiscal year not found")?;

    if fiscal_year.company_id != company_id {
        return Err("Fiscal year does not belong to the specified company".to_string());
    }

    // Validate date range is within fiscal year
    if date_from < fiscal_year.date_from || date_to > fiscal_year.date_to {
        return Err("Period dates must be within fiscal year dates".to_string());
    }

    // Validate date range
    if date_from >= date_to {
        return Err("Period start date must be before end date".to_string());
    }

    // Check for overlapping periods
    let overlapping: Vec<_> = ctx
        .db
        .account_period()
        .period_by_company()
        .filter(&company_id)
        .filter(|p| {
            (date_from >= p.date_from && date_from <= p.date_to)
                || (date_to >= p.date_from && date_to <= p.date_to)
                || (date_from <= p.date_from && date_to >= p.date_to)
        })
        .collect();

    if !overlapping.is_empty() {
        return Err("Period overlaps with existing period".to_string());
    }

    let period = ctx.db.account_period().insert(AccountPeriod {
        id: 0,
        name: name.clone(),
        code: code.clone(),
        date_from,
        date_to,
        company_id,
        fiscal_year_id,
        state: PeriodState::Draft,
        is_adjustment: false,
        notes,
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
        "account_period",
        period.id,
        "CREATE",
        None,
        Some(serde_json::json!({ "name": name, "code": code }).to_string()),
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_account_period(
    ctx: &ReducerContext,
    organization_id: u64,
    period_id: u64,
    name: Option<String>,
    code: Option<String>,
    notes: Option<Option<String>>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_period", "write")?;

    let period = ctx
        .db
        .account_period()
        .id()
        .find(&period_id)
        .ok_or("Period not found")?;

    if period.state == PeriodState::Closed {
        return Err("Cannot modify a closed period".to_string());
    }

    ctx.db.account_period().id().update(AccountPeriod {
        name: name.unwrap_or(period.name),
        code: code.unwrap_or(period.code),
        notes: notes.unwrap_or(period.notes),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: metadata.or(period.metadata),
        ..period
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(period.company_id),
        "account_period",
        period_id,
        "UPDATE",
        None,
        None,
        vec![],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn open_account_period(
    ctx: &ReducerContext,
    organization_id: u64,
    period_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_period", "write")?;

    let period = ctx
        .db
        .account_period()
        .id()
        .find(&period_id)
        .ok_or("Period not found")?;

    if period.state != PeriodState::Draft {
        return Err("Only draft periods can be opened".to_string());
    }

    // Check fiscal year is open
    let fiscal_year = ctx
        .db
        .account_fiscal_year()
        .id()
        .find(&period.fiscal_year_id)
        .ok_or("Fiscal year not found")?;

    if fiscal_year.state != FiscalYearState::Running {
        return Err("Fiscal year must be open to open a period".to_string());
    }

    ctx.db.account_period().id().update(AccountPeriod {
        state: PeriodState::Open,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..period
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(period.company_id),
        "account_period",
        period_id,
        "OPEN",
        None,
        None,
        vec!["state".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn close_account_period(
    ctx: &ReducerContext,
    organization_id: u64,
    period_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_period", "write")?;

    let period = ctx
        .db
        .account_period()
        .id()
        .find(&period_id)
        .ok_or("Period not found")?;

    if period.state != PeriodState::Open {
        return Err("Only open periods can be closed".to_string());
    }

    // Check for unposted moves in period
    // Note: Would need to check account_move table for moves in this date range
    // that are not posted. For now, we'll skip this validation.

    ctx.db.account_period().id().update(AccountPeriod {
        state: PeriodState::Closed,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..period
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(period.company_id),
        "account_period",
        period_id,
        "CLOSE",
        None,
        None,
        vec!["state".to_string()],
    );

    Ok(())
}
