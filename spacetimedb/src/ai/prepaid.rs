//! Opt-in prepaid funding. Existing spend reservations remain the only usage/hold ledger.
//! Funding requires a dedicated platform-registered service identity AND a narrow permission.
//! No default grants, fake payment receipts, automatic funding or legacy admission changes.
use crate::ai::agents::ai_agent;
use crate::ai::prepaid_balance::CreditBalance;
use crate::ai::spend::ai_spend_reservation;
use crate::core::cold_tier_identity::cold_tier_service_identity;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

const FUNDER_SERVICE: &str = "ai_credit_funder";
// Admission is intentionally bounded. Until an audited checkpoint/index replaces this
// scan, a pool with more rows blocks new spend instead of ignoring older commitments.
const MAX_PROJECTION_ROWS: usize = 100_000;

#[derive(Clone)]
#[spacetimedb::table(accessor = ai_prepaid_account, index(accessor = ai_prepaid_account_by_org, btree(columns = [organization_id])))]
pub struct AiPrepaidAccount {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub pool_key: String,
    pub organization_id: u64,
    pub agent_id: u64,
    pub currency: String,
    pub is_enabled: bool,
    // Snapshot only at the explicit one-way cutover. Earlier settled use was sponsored.
    pub opening_settled_units: u64,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub enabled_by: Option<Identity>,
    pub enabled_at: Option<Timestamp>,
}

#[derive(Clone)]
#[spacetimedb::table(accessor = ai_prepaid_funding_entry, index(accessor = ai_prepaid_funding_by_account, btree(columns = [account_id])))]
pub struct AiPrepaidFundingEntry {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub operation_key: String,
    #[unique]
    pub source_key: String,
    pub organization_id: u64,
    pub account_id: u64,
    /// grant | reversal. A grant is an explicitly approved sponsored allowance, not a payment.
    pub kind: String,
    pub units: u64,
    pub source_reference: String,
    pub original_entry_id: Option<u64>,
    pub created_by: Identity,
    pub created_at: Timestamp,
}

#[derive(Clone, SpacetimeType)]
pub struct RecordAiPrepaidFundingParams {
    pub account_id: u64,
    pub request_key: String,
    pub source_reference: String,
    pub units: u64,
    pub original_entry_id: Option<u64>,
}

fn require_funder(ctx: &ReducerContext, org: u64, action: &str) -> Result<(), String> {
    let bindings = ctx
        .db
        .cold_tier_service_identity()
        .cold_tier_service_identity_by_name()
        .filter((org, &FUNDER_SERVICE.to_string()))
        .filter(|row| row.is_active)
        .collect::<Vec<_>>();
    if bindings.len() != 1 || bindings[0].identity != ctx.sender() {
        return Err("prepaid funding requires the registered funding service".into());
    }
    check_permission(ctx, org, "ai_credit", action)
}
fn key(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 160
        || !value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
    {
        return Err("prepaid reference must be a bounded identifier".into());
    }
    Ok(())
}
fn account(ctx: &ReducerContext, org: u64, id: u64) -> Result<AiPrepaidAccount, String> {
    let row = ctx
        .db
        .ai_prepaid_account()
        .id()
        .find(&id)
        .ok_or("prepaid account not found")?;
    if row.organization_id != org {
        return Err("prepaid account is outside organization".into());
    }
    Ok(row)
}
fn audit(ctx: &ReducerContext, row: &AiPrepaidAccount, action: &'static str) {
    write_audit_log_v2(
        ctx,
        row.organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "ai_prepaid_account",
            record_id: row.id,
            action,
            old_values: None,
            new_values: None,
            changed_fields: vec![action.into()],
            metadata: None,
        },
    );
}

/// Create an unfunded, disabled account. Ordinary owners cannot issue this operator command.
#[reducer]
pub fn create_ai_prepaid_account(
    ctx: &ReducerContext,
    organization_id: u64,
    agent_id: u64,
    currency: String,
) -> Result<(), String> {
    require_funder(ctx, organization_id, "manage")?;
    if currency != "USD" {
        return Err("prepaid alpha currency must be USD".into());
    }
    let agent = ctx
        .db
        .ai_agent()
        .id()
        .find(&agent_id)
        .ok_or("agent not found")?;
    if agent.organization_id != organization_id {
        return Err("agent is outside organization".into());
    }
    let pool_key = format!("{organization_id}:{agent_id}");
    if let Some(old) = ctx.db.ai_prepaid_account().pool_key().find(&pool_key) {
        if old.currency != currency {
            return Err("prepaid account currency is immutable".into());
        }
        return Ok(());
    }
    let row = ctx.db.ai_prepaid_account().insert(AiPrepaidAccount {
        id: 0,
        pool_key,
        organization_id,
        agent_id,
        currency,
        is_enabled: false,
        opening_settled_units: 0,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        enabled_by: None,
        enabled_at: None,
    });
    audit(ctx, &row, "create");
    Ok(())
}

/// One-way cutover: preserve earlier sponsored spend and carry every open hold.
#[reducer]
pub fn enable_ai_prepaid_account(
    ctx: &ReducerContext,
    organization_id: u64,
    account_id: u64,
) -> Result<(), String> {
    require_funder(ctx, organization_id, "manage")?;
    let mut row = account(ctx, organization_id, account_id)?;
    if row.is_enabled {
        return Ok(());
    }
    if ctx
        .db
        .ai_prepaid_account()
        .ai_prepaid_account_by_org()
        .filter(&organization_id)
        .any(|other| other.is_enabled && other.id != row.id)
    {
        return Err("organization already uses another prepaid pool".into());
    }
    if ctx
        .db
        .ai_spend_reservation()
        .ai_spend_reservation_by_org()
        .filter(&organization_id)
        .any(|other| other.agent_id != row.agent_id && other.status == "reserved")
    {
        return Err("another agent has open holds; reconcile before prepaid cutover".into());
    }
    let (settled, held) = usage(ctx, &row)?;
    let (funded, reversed) = funding(ctx, &row)?;
    CreditBalance {
        funded,
        reversed,
        debited: 0,
        held,
    }
    .require(0)?;
    row.is_enabled = true;
    row.opening_settled_units = settled;
    row.enabled_by = Some(ctx.sender());
    row.enabled_at = Some(ctx.timestamp);
    ctx.db.ai_prepaid_account().id().update(row.clone());
    audit(ctx, &row, "enable");
    Ok(())
}

/// Append one approved grant or a bounded reversal of a specific original grant.
#[reducer]
pub fn record_ai_prepaid_funding(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RecordAiPrepaidFundingParams,
) -> Result<(), String> {
    require_funder(
        ctx,
        organization_id,
        if params.original_entry_id.is_some() {
            "reverse"
        } else {
            "fund"
        },
    )?;
    key(&params.request_key)?;
    key(&params.source_reference)?;
    if params.units == 0 {
        return Err("prepaid units must be positive".into());
    }
    let row = account(ctx, organization_id, params.account_id)?;
    let kind = if params.original_entry_id.is_some() {
        "reversal"
    } else {
        "grant"
    };
    let operation_key = format!("{organization_id}:{}", params.request_key);
    let source_key = format!("{organization_id}:{kind}:{}", params.source_reference);
    let by_request = ctx
        .db
        .ai_prepaid_funding_entry()
        .operation_key()
        .find(&operation_key);
    let by_source = ctx
        .db
        .ai_prepaid_funding_entry()
        .source_key()
        .find(&source_key);
    if let Some(existing) = by_request.or(by_source) {
        if existing.operation_key != operation_key
            || existing.created_by != ctx.sender()
            || existing.account_id != row.id
            || existing.units != params.units
            || existing.kind != kind
            || existing.source_reference != params.source_reference
            || existing.original_entry_id != params.original_entry_id
        {
            return Err("prepaid funding identity was reused with different bindings".into());
        }
        return Ok(());
    }
    if let Some(original_id) = params.original_entry_id {
        let original = ctx
            .db
            .ai_prepaid_funding_entry()
            .id()
            .find(&original_id)
            .ok_or("original funding entry not found")?;
        if original.account_id != row.id
            || original.organization_id != organization_id
            || original.kind != "grant"
        {
            return Err("reversal must reference this account's original grant".into());
        }
        let (_, already_reversed) = sum_entries(ctx, &row, Some(original_id))?;
        if already_reversed
            .checked_add(params.units)
            .is_none_or(|total| total > original.units)
        {
            return Err("reversal exceeds the original grant".into());
        }
    }
    // Validate cumulative arithmetic before inserting, even while admission is disabled.
    let (funded, reversed) = funding(ctx, &row)?;
    if kind == "grant" {
        funded
            .checked_add(params.units)
            .ok_or("prepaid funding overflow")?;
    } else {
        reversed
            .checked_add(params.units)
            .ok_or("prepaid reversal overflow")?;
    }
    ctx.db
        .ai_prepaid_funding_entry()
        .insert(AiPrepaidFundingEntry {
            id: 0,
            operation_key,
            source_key,
            organization_id,
            account_id: row.id,
            kind: kind.into(),
            units: params.units,
            source_reference: params.source_reference,
            original_entry_id: params.original_entry_id,
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
        });
    audit(ctx, &row, kind);
    Ok(())
}

fn sum_entries(
    ctx: &ReducerContext,
    row: &AiPrepaidAccount,
    original: Option<u64>,
) -> Result<(u64, u64), String> {
    let mut funded = 0_u64;
    let mut reversed = 0_u64;
    for (index, entry) in ctx
        .db
        .ai_prepaid_funding_entry()
        .ai_prepaid_funding_by_account()
        .filter(&row.id)
        .enumerate()
    {
        if index >= MAX_PROJECTION_ROWS {
            return Err("prepaid funding projection requires reconciliation".into());
        }
        if entry.organization_id != row.organization_id {
            return Err("prepaid funding scope is invalid".into());
        }
        if original.is_some() && entry.original_entry_id != original {
            continue;
        }
        match entry.kind.as_str() {
            "grant" => {
                funded = funded
                    .checked_add(entry.units)
                    .ok_or("prepaid funding overflow")?
            }
            "reversal" => {
                reversed = reversed
                    .checked_add(entry.units)
                    .ok_or("prepaid reversal overflow")?
            }
            _ => return Err("prepaid funding kind is invalid".into()),
        }
    }
    Ok((funded, reversed))
}
fn funding(ctx: &ReducerContext, row: &AiPrepaidAccount) -> Result<(u64, u64), String> {
    sum_entries(ctx, row, None)
}
fn usage(ctx: &ReducerContext, row: &AiPrepaidAccount) -> Result<(u64, u64), String> {
    let mut settled = 0_u64;
    let mut held = 0_u64;
    for (index, reservation) in ctx
        .db
        .ai_spend_reservation()
        .ai_spend_reservation_by_org()
        .filter(&row.organization_id)
        .enumerate()
    {
        if index >= MAX_PROJECTION_ROWS {
            return Err("prepaid usage projection requires reconciliation".into());
        }
        if reservation.agent_id != row.agent_id {
            continue;
        }
        if reservation.currency != row.currency {
            return Err("prepaid usage currency is invalid".into());
        }
        match reservation.status.as_str() {
            "settled" => {
                settled = settled
                    .checked_add(reservation.settled_units)
                    .ok_or("prepaid usage overflow")?
            }
            "reserved" => {
                held = held
                    .checked_add(reservation.reserved_units)
                    .ok_or("prepaid holds overflow")?
            }
            "released" => {}
            _ => return Err("prepaid reservation state is invalid".into()),
        }
    }
    Ok((settled, held))
}

/// Called before the existing reservation insert in the same reducer transaction.
/// Settlement/release already mutate the canonical usage rows, so no second debit exists.
pub(crate) fn require_prepaid_credit(
    ctx: &ReducerContext,
    org: u64,
    agent: u64,
    currency: &str,
    units: u64,
) -> Result<(), String> {
    let accounts = ctx
        .db
        .ai_prepaid_account()
        .ai_prepaid_account_by_org()
        .filter(&org)
        .filter(|row| row.is_enabled)
        .collect::<Vec<_>>();
    let row = match accounts.as_slice() {
        [] => return Ok(()),
        [row] if row.agent_id == agent => row,
        [_] => return Err("organization uses another prepaid agent".into()),
        _ => return Err("organization prepaid pool is not unique".into()),
    };
    if row.currency != currency {
        return Err("prepaid currency differs from reservation".into());
    }
    let (settled, held) = usage(ctx, &row)?;
    let (funded, reversed) = funding(ctx, &row)?;
    let debited = settled
        .checked_sub(row.opening_settled_units)
        .ok_or("prepaid opening usage changed")?;
    CreditBalance {
        funded,
        reversed,
        debited,
        held,
    }
    .require(units)
}

/// Whether the organization has exactly this one explicitly cut-over prepaid
/// pool. This is not a balance or dispatch admission check: every reservation
/// still calls require_prepaid_credit atomically, including after a cap edit.
pub(crate) fn prepaid_enabled(ctx: &ReducerContext, org: u64, agent: u64) -> bool {
    let pools = ctx
        .db
        .ai_prepaid_account()
        .ai_prepaid_account_by_org()
        .filter(&org)
        .filter(|row| row.is_enabled)
        .collect::<Vec<_>>();
    matches!(pools.as_slice(), [pool] if pool.agent_id == agent && pool.currency == "USD")
}
