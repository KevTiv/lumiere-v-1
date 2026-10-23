//! Durable, integer-based AI spend admission and settlement.
//!
//! Gateway activation requires a released contract and a trusted principal
//! explicitly granted `ai_spend/reserve`, `ai_spend/settle`, and the separately
//! provisioned `ai_spend/reconcile` recovery permission.

use spacetimedb::{reducer, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::ai::agents::{ai_agent, ai_team_member};
use crate::ai::skills::{ai_agent_run, ai_skill_config};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

const MAX_PERIOD_LEN: usize = 7;
const MAX_CURRENCY_LEN: usize = 3;
const MAX_PROVIDER_LEN: usize = 64;
const MAX_MODEL_LEN: usize = 128;
const MAX_REQUEST_KEY_LEN: usize = 256;
const MAX_PRICE_UNITS_PER_1K: u64 = 1_000_000_000_000;
const MAX_ALLOWANCE_TOKENS: u32 = 10_000_000;
const MAX_ATTEMPT_NOTE_LEN: usize = 1_024;
const MAX_RECOVERY_ACTOR_LEN: usize = 160;
const MAX_APPROVAL_ID_LEN: usize = 160;

const RESERVATION_RESERVED: &str = "reserved";
const RESERVATION_RELEASED: &str = "released";
const ATTEMPT_ACCEPTED: &str = "accepted";
const ATTEMPT_DISPATCHED: &str = "dispatched";
const ATTEMPT_SUCCEEDED: &str = "succeeded";
const ATTEMPT_FAILED: &str = "failed";
const ATTEMPT_OUTCOME_UNKNOWN: &str = "outcome_unknown";
const ATTEMPT_ABANDONED: &str = "abandoned";
const RECOVERY_MARK_UNKNOWN: &str = "mark_outcome_unknown";
const RECOVERY_ABANDON_ACCEPTED: &str = "abandon_accepted";

/// Immutable integer price snapshot. Monetary amounts are always millionths
/// of the named currency (micro-USD, for example); prices are per 1,000 tokens.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_price_snapshot,
    index(accessor = ai_price_snapshot_by_org, btree(columns = [organization_id])),
    index(accessor = ai_price_snapshot_by_agent, btree(columns = [agent_id]))
)]
pub struct AiPriceSnapshot {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub agent_id: u64,
    pub provider: String,
    pub model: String,
    pub currency: String,
    pub input_units_per_1k: u64,
    pub output_units_per_1k: u64,
    pub version: u64,
    pub created_by: spacetimedb::Identity,
    pub created_at: Timestamp,
}

/// Organization-owned period budget. `settled_units + outstanding_units` is
/// the admission cap and is updated in the same reducer transaction.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_spend_budget,
    index(accessor = ai_spend_budget_by_org, btree(columns = [organization_id])),
    index(accessor = ai_spend_budget_by_agent_period, btree(columns = [agent_id, billing_period]))
)]
pub struct AiSpendBudget {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub agent_id: u64,
    pub billing_period: String,
    pub currency: String,
    pub limit_units: u64,
    pub settled_units: u64,
    pub outstanding_units: u64,
    pub write_uid: spacetimedb::Identity,
    pub write_date: Timestamp,
}

/// A request reservation. Rows are never expired or refunded automatically:
/// provider timeouts remain committed until explicitly reconciled.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_spend_reservation,
    index(accessor = ai_spend_reservation_by_org, btree(columns = [organization_id])),
    index(accessor = ai_spend_reservation_by_request, btree(columns = [organization_id, request_key])),
    index(accessor = ai_spend_reservation_by_run, btree(columns = [run_id]))
)]
pub struct AiSpendReservation {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub agent_id: u64,
    pub run_id: u64,
    pub request_key: String,
    pub provider: String,
    pub model: String,
    pub billing_period: String,
    pub currency: String,
    pub price_snapshot_id: u64,
    pub reserved_units: u64,
    pub settled_units: u64,
    pub input_token_allowance: u32,
    pub output_token_allowance: u32,
    /// reserved | settled | released. Release is allowed only while its
    /// provider attempt is still accepted and therefore never dispatched.
    pub status: String,
    pub reserved_by: spacetimedb::Identity,
    pub settled_by: Option<spacetimedb::Identity>,
    pub created_at: Timestamp,
    pub settled_at: Option<Timestamp>,
    pub settled_input_tokens: u32,
    pub settled_output_tokens: u32,
}

/// Durable provider attempt bound 1:1 to a spend reservation by request key.
///
/// `accepted` commits intent before any I/O; `dispatched` is claimed exactly
/// once immediately before the provider call. A dispatched attempt that loses
/// its result becomes `outcome_unknown` and can only be resolved by explicit
/// reconciliation; recovering a row never authorizes redispatch.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_provider_attempt,
    index(accessor = ai_provider_attempt_by_org, btree(columns = [organization_id])),
    index(accessor = ai_provider_attempt_by_request, btree(columns = [organization_id, request_key])),
    index(accessor = ai_provider_attempt_by_run, btree(columns = [run_id]))
)]
pub struct AiProviderAttempt {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub agent_id: u64,
    pub run_id: u64,
    pub reservation_id: u64,
    pub request_key: String,
    pub provider: String,
    pub model: String,
    /// accepted | dispatched | succeeded | failed | outcome_unknown | abandoned
    pub status: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub failure_reason: Option<String>,
    /// Required explanation when an `outcome_unknown` attempt is reconciled.
    pub resolution: Option<String>,
    /// Attributable recovery command that moved a stranded dispatched attempt
    /// to outcome_unknown, or abandoned an accepted pre-dispatch attempt.
    pub recovery_actor: Option<String>,
    pub recovery_approval_id: Option<String>,
    pub recovery_at: Option<Timestamp>,
    /// Attributable approved command that resolved outcome_unknown.
    pub reconciliation_actor: Option<String>,
    pub reconciliation_approval_id: Option<String>,
    pub accepted_by: spacetimedb::Identity,
    pub write_uid: spacetimedb::Identity,
    pub created_at: Timestamp,
    pub dispatched_at: Option<Timestamp>,
    pub finished_at: Option<Timestamp>,
    pub write_date: Timestamp,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ConfigureAiSpendParams {
    pub billing_period: String,
    pub currency: String,
    pub limit_units: u64,
    pub provider: String,
    pub model: String,
    pub input_units_per_1k: u64,
    pub output_units_per_1k: u64,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ReserveAiSpendParams {
    pub company_id: u64,
    pub agent_id: u64,
    pub run_id: u64,
    pub request_key: String,
    pub provider: String,
    pub model: String,
    pub billing_period: String,
    pub currency: String,
    pub price_snapshot_id: u64,
    pub input_token_allowance: u32,
    pub output_token_allowance: u32,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct SettleAiSpendParams {
    pub reservation_id: u64,
    pub input_tokens: u32,
    pub output_tokens: u32,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct AcceptAiProviderAttemptParams {
    pub company_id: u64,
    pub agent_id: u64,
    pub run_id: u64,
    pub reservation_id: u64,
    pub request_key: String,
    pub provider: String,
    pub model: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordAiProviderAttemptResultParams {
    pub attempt_id: u64,
    /// succeeded | failed | outcome_unknown
    pub status: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub failure_reason: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ReconcileAiProviderAttemptParams {
    pub attempt_id: u64,
    /// succeeded | failed
    pub status: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub resolution: String,
    pub actor_identity: String,
    pub approval_id: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecoverAiProviderAttemptParams {
    pub attempt_id: u64,
    /// mark_outcome_unknown | abandon_accepted
    pub action: String,
    pub resolution: String,
    pub actor_identity: String,
    pub approval_id: String,
}

/// Configure an agent's integer budget and create a new immutable price
/// snapshot. Existing period configuration is updated, but snapshots never are.
#[reducer]
pub fn configure_ai_spend(
    ctx: &ReducerContext,
    organization_id: u64,
    agent_id: u64,
    params: ConfigureAiSpendParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_agent", "write")?;
    validate_common(
        &params.billing_period,
        &params.currency,
        &params.provider,
        &params.model,
    )?;
    if params.limit_units == 0 {
        return Err("limit_units must be positive".into());
    }
    if params.input_units_per_1k > MAX_PRICE_UNITS_PER_1K
        || params.output_units_per_1k > MAX_PRICE_UNITS_PER_1K
    {
        return Err("price is out of bounds".into());
    }
    let agent = ctx
        .db
        .ai_agent()
        .id()
        .find(&agent_id)
        .ok_or_else(|| "agent not found".to_string())?;
    if agent.organization_id != organization_id {
        return Err("agent is outside the requested tenant or company".into());
    }
    if !agent.is_active
        || !provider_eq(&agent.provider, &params.provider)
        || !model_allowed(&agent.allowed_models, &params.model)
    {
        return Err("provider or model is not allowed for agent".into());
    }
    let next_version = ctx
        .db
        .ai_price_snapshot()
        .ai_price_snapshot_by_agent()
        .filter(&agent_id)
        .map(|row| row.version)
        .max()
        .unwrap_or(0)
        .checked_add(1)
        .ok_or_else(|| "price snapshot version overflow".to_string())?;
    ctx.db.ai_price_snapshot().insert(AiPriceSnapshot {
        id: 0,
        organization_id,
        agent_id,
        provider: params.provider.clone(),
        model: params.model.clone(),
        currency: params.currency.clone(),
        input_units_per_1k: params.input_units_per_1k,
        output_units_per_1k: params.output_units_per_1k,
        version: next_version,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
    });
    let existing = ctx
        .db
        .ai_spend_budget()
        .ai_spend_budget_by_agent_period()
        .filter((&agent_id, &params.billing_period))
        .find(|row| row.organization_id == organization_id);
    if let Some(row) = existing {
        let committed = row
            .settled_units
            .checked_add(row.outstanding_units)
            .ok_or_else(|| "budget total overflow".to_string())?;
        if params.limit_units < committed {
            return Err("budget limit is below committed spend".into());
        }
        if row.currency != params.currency {
            return Err("budget currency is immutable".into());
        }
        ctx.db.ai_spend_budget().id().update(AiSpendBudget {
            limit_units: params.limit_units,
            currency: params.currency,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..row
        });
    } else {
        ctx.db.ai_spend_budget().insert(AiSpendBudget {
            id: 0,
            organization_id,
            agent_id,
            billing_period: params.billing_period,
            currency: params.currency,
            limit_units: params.limit_units,
            settled_units: 0,
            outstanding_units: 0,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
        });
    }
    Ok(())
}

/// Atomically reserve the allowance against settled plus outstanding spend.
#[reducer]
pub fn reserve_ai_spend(
    ctx: &ReducerContext,
    organization_id: u64,
    params: ReserveAiSpendParams,
) -> Result<(), String> {
    // `ai_spend/reserve` is provisioned only to the trusted gateway principal;
    // ordinary run writers must not be able to mint budget reservations.
    check_permission(ctx, organization_id, "ai_spend", "reserve")?;
    validate_common(
        &params.billing_period,
        &params.currency,
        &params.provider,
        &params.model,
    )?;
    if params.company_id == 0
        || params.request_key.trim().is_empty()
        || params.request_key.len() > MAX_REQUEST_KEY_LEN
    {
        return Err("invalid request key or company".into());
    }
    if params.input_token_allowance > MAX_ALLOWANCE_TOKENS
        || params.output_token_allowance > MAX_ALLOWANCE_TOKENS
        || params.output_token_allowance == 0
    {
        return Err("token allowance is out of bounds".into());
    }
    // Recover identical reservations before checking mutable admission state.
    // Recovery is not permission to dispatch again: the gateway must separately
    // establish that the persisted attempt has not already been dispatched.
    if let Some(existing) = ctx
        .db
        .ai_spend_reservation()
        .ai_spend_reservation_by_request()
        .filter((&organization_id, &params.request_key))
        .next()
    {
        if reservation_matches(&existing, &params) {
            return Ok(());
        }
        return Err("request key was already used with different bindings".into());
    }
    if params.billing_period != current_period(ctx.timestamp)? {
        return Err("billing period must be the current period".into());
    }
    let run = ctx
        .db
        .ai_agent_run()
        .id()
        .find(&params.run_id)
        .ok_or_else(|| "run not found".to_string())?;
    validate_run(
        ctx,
        organization_id,
        &run,
        params.company_id,
        params.agent_id,
    )?;
    crate::core::organization::require_company_in_organization(
        ctx,
        organization_id,
        params.company_id,
    )?;
    let agent = ctx
        .db
        .ai_agent()
        .id()
        .find(&params.agent_id)
        .ok_or_else(|| "agent not found".to_string())?;
    if !agent.is_active
        || !provider_eq(&agent.provider, &params.provider)
        || !model_allowed(&agent.allowed_models, &params.model)
    {
        return Err("provider or model is not allowed for agent".into());
    }
    if params.output_token_allowance > agent.max_tokens
        || u64::from(params.input_token_allowance) + u64::from(params.output_token_allowance)
            > u64::from(agent.context_window)
    {
        return Err("token allowance exceeds agent limits".into());
    }
    let snapshot = ctx
        .db
        .ai_price_snapshot()
        .id()
        .find(&params.price_snapshot_id)
        .ok_or_else(|| "price snapshot not found".to_string())?;
    if snapshot.organization_id != organization_id
        || snapshot.agent_id != params.agent_id
        || !provider_eq(&snapshot.provider, &params.provider)
        || snapshot.model != params.model
        || snapshot.currency != params.currency
    {
        return Err("price snapshot binding mismatch".into());
    }
    let latest_version = ctx
        .db
        .ai_price_snapshot()
        .ai_price_snapshot_by_agent()
        .filter(&params.agent_id)
        .filter(|row| {
            row.organization_id == organization_id
                && provider_eq(&row.provider, &params.provider)
                && row.model == params.model
                && row.currency == params.currency
        })
        .map(|row| row.version)
        .max();
    if latest_version != Some(snapshot.version) {
        return Err("new reservations require the latest price snapshot".into());
    }
    let budget = ctx
        .db
        .ai_spend_budget()
        .ai_spend_budget_by_agent_period()
        .filter((&params.agent_id, &params.billing_period))
        .find(|row| row.organization_id == organization_id && row.currency == params.currency)
        .ok_or_else(|| "budget not configured".to_string())?;
    let reserved_units = allowance_cost(
        &snapshot,
        params.input_token_allowance,
        params.output_token_allowance,
    )?;
    let outstanding_units = reserve_units(
        budget.limit_units,
        budget.settled_units,
        budget.outstanding_units,
        reserved_units,
    )?;
    ctx.db.ai_spend_budget().id().update(AiSpendBudget {
        outstanding_units,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..budget
    });
    ctx.db.ai_spend_reservation().insert(AiSpendReservation {
        id: 0,
        organization_id,
        company_id: params.company_id,
        agent_id: params.agent_id,
        run_id: params.run_id,
        request_key: params.request_key,
        provider: params.provider,
        model: params.model,
        billing_period: params.billing_period,
        currency: params.currency,
        price_snapshot_id: snapshot.id,
        reserved_units,
        settled_units: 0,
        input_token_allowance: params.input_token_allowance,
        output_token_allowance: params.output_token_allowance,
        status: "reserved".into(),
        reserved_by: ctx.sender(),
        settled_by: None,
        created_at: ctx.timestamp,
        settled_at: None,
        settled_input_tokens: 0,
        settled_output_tokens: 0,
    });
    Ok(())
}

/// Settle a reservation exactly once using its immutable snapshot. A timeout
/// remains reserved until this reducer is called; there is no implicit refund.
#[reducer]
pub fn settle_ai_spend(
    ctx: &ReducerContext,
    organization_id: u64,
    params: SettleAiSpendParams,
) -> Result<(), String> {
    // Settlement is a separate trusted capability. It remains callable after
    // a terminal run so ambiguous provider outcomes can be reconciled.
    check_permission(ctx, organization_id, "ai_spend", "settle")?;
    let reservation = ctx
        .db
        .ai_spend_reservation()
        .id()
        .find(&params.reservation_id)
        .ok_or_else(|| "reservation not found".to_string())?;
    if reservation.organization_id != organization_id {
        return Err("reservation is outside the tenant".into());
    }
    let run = ctx
        .db
        .ai_agent_run()
        .id()
        .find(&reservation.run_id)
        .ok_or_else(|| "run not found".to_string())?;
    if run.organization_id != organization_id
        || run.company_id != reservation.company_id
        || run.agent_id != reservation.agent_id
    {
        return Err("reservation run binding is invalid".into());
    }
    if settlement_replay(
        &reservation.status,
        (
            reservation.settled_input_tokens,
            reservation.settled_output_tokens,
        ),
        (params.input_tokens, params.output_tokens),
    )? {
        return Ok(());
    }
    if params.input_tokens > reservation.input_token_allowance
        || params.output_tokens > reservation.output_token_allowance
    {
        return Err("actual usage exceeds reservation allowance".into());
    }
    let snapshot = ctx
        .db
        .ai_price_snapshot()
        .id()
        .find(&reservation.price_snapshot_id)
        .ok_or_else(|| "price snapshot not found".to_string())?;
    let actual = usage_cost(&snapshot, params.input_tokens, params.output_tokens)?;
    if actual > reservation.reserved_units {
        return Err("actual usage exceeds reserved amount".into());
    }
    let budget = ctx
        .db
        .ai_spend_budget()
        .ai_spend_budget_by_agent_period()
        .filter((&reservation.agent_id, &reservation.billing_period))
        .find(|row| row.organization_id == organization_id && row.currency == reservation.currency)
        .ok_or_else(|| "budget not found".to_string())?;
    let (settled, outstanding) = settle_units(
        budget.limit_units,
        budget.settled_units,
        budget.outstanding_units,
        reservation.reserved_units,
        actual,
    )?;
    ctx.db.ai_spend_budget().id().update(AiSpendBudget {
        settled_units: settled,
        outstanding_units: outstanding,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..budget
    });
    ctx.db
        .ai_spend_reservation()
        .id()
        .update(AiSpendReservation {
            status: "settled".into(),
            settled_by: Some(ctx.sender()),
            settled_units: actual,
            settled_at: Some(ctx.timestamp),
            settled_input_tokens: params.input_tokens,
            settled_output_tokens: params.output_tokens,
            ..reservation
        });
    Ok(())
}

/// Commit provider-attempt intent before any external I/O. Replaying the same
/// binding is a no-op; a different binding for the key is rejected.
#[reducer]
pub fn accept_ai_provider_attempt(
    ctx: &ReducerContext,
    organization_id: u64,
    params: AcceptAiProviderAttemptParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_spend", "reserve")?;
    if params.request_key.trim().is_empty() || params.request_key.len() > MAX_REQUEST_KEY_LEN {
        return Err("invalid request key".into());
    }
    if let Some(existing) = ctx
        .db
        .ai_provider_attempt()
        .ai_provider_attempt_by_request()
        .filter((&organization_id, &params.request_key))
        .next()
    {
        if attempt_matches(&existing, &params) {
            return Ok(());
        }
        return Err("request key was already used for a different provider attempt".into());
    }
    let reservation = ctx
        .db
        .ai_spend_reservation()
        .id()
        .find(&params.reservation_id)
        .ok_or_else(|| "reservation not found".to_string())?;
    if reservation.organization_id != organization_id
        || reservation.status != RESERVATION_RESERVED
        || reservation.request_key != params.request_key
        || reservation.company_id != params.company_id
        || reservation.agent_id != params.agent_id
        || reservation.run_id != params.run_id
        || !provider_eq(&reservation.provider, &params.provider)
        || reservation.model != params.model
    {
        return Err("attempt does not match an open reservation".into());
    }
    let run = ctx
        .db
        .ai_agent_run()
        .id()
        .find(&params.run_id)
        .ok_or_else(|| "run not found".to_string())?;
    validate_run(
        ctx,
        organization_id,
        &run,
        params.company_id,
        params.agent_id,
    )?;

    let row = ctx.db.ai_provider_attempt().insert(AiProviderAttempt {
        id: 0,
        organization_id,
        company_id: params.company_id,
        agent_id: params.agent_id,
        run_id: params.run_id,
        reservation_id: params.reservation_id,
        request_key: params.request_key,
        provider: params.provider,
        model: params.model,
        status: ATTEMPT_ACCEPTED.into(),
        input_tokens: 0,
        output_tokens: 0,
        failure_reason: None,
        resolution: None,
        recovery_actor: None,
        recovery_approval_id: None,
        recovery_at: None,
        reconciliation_actor: None,
        reconciliation_approval_id: None,
        accepted_by: ctx.sender(),
        write_uid: ctx.sender(),
        created_at: ctx.timestamp,
        dispatched_at: None,
        finished_at: None,
        write_date: ctx.timestamp,
    });
    audit_attempt(ctx, &row, "CREATE", None, "accepted provider attempt");
    Ok(())
}

/// Claim the single dispatch of an accepted attempt immediately before I/O.
#[reducer]
pub fn mark_ai_provider_attempt_dispatched(
    ctx: &ReducerContext,
    organization_id: u64,
    attempt_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_spend", "reserve")?;
    let attempt = load_attempt(ctx, organization_id, attempt_id)?;
    match attempt_transition(&attempt.status, AttemptCommand::Dispatch)? {
        AttemptTransition::Replay => Ok(()),
        AttemptTransition::Apply(next) => {
            let previous = attempt.status.clone();
            let row = AiProviderAttempt {
                status: next.into(),
                dispatched_at: Some(ctx.timestamp),
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..attempt
            };
            ctx.db.ai_provider_attempt().id().update(row.clone());
            audit_attempt(
                ctx,
                &row,
                "UPDATE",
                Some(&previous),
                "dispatched provider attempt",
            );
            Ok(())
        }
    }
}

/// Record the outcome of a dispatched attempt. `outcome_unknown` is used when
/// the provider may have completed but the result was lost.
#[reducer]
pub fn record_ai_provider_attempt_result(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RecordAiProviderAttemptResultParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_spend", "reserve")?;
    let attempt = load_attempt(ctx, organization_id, params.attempt_id)?;
    validate_note(params.failure_reason.as_deref())?;
    let command = AttemptCommand::Result(params.status.trim());
    let usage = (params.input_tokens, params.output_tokens);
    let replayed = attempt.input_tokens == params.input_tokens
        && attempt.output_tokens == params.output_tokens
        && attempt.failure_reason == params.failure_reason;
    let next = match attempt_transition(&attempt.status, command)? {
        AttemptTransition::Replay if replayed => return Ok(()),
        AttemptTransition::Replay => {
            return Err("result replay has different usage or reason".into())
        }
        AttemptTransition::Apply(next) => next,
    };
    if next == ATTEMPT_OUTCOME_UNKNOWN && usage != (0, 0) {
        return Err("an unknown outcome cannot report usage".into());
    }
    ensure_within_allowance(ctx, &attempt, usage)?;
    let previous = attempt.status.clone();
    let row = AiProviderAttempt {
        status: next.into(),
        input_tokens: params.input_tokens,
        output_tokens: params.output_tokens,
        failure_reason: params.failure_reason,
        finished_at: Some(ctx.timestamp),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..attempt
    };
    ctx.db.ai_provider_attempt().id().update(row.clone());
    audit_attempt(
        ctx,
        &row,
        "UPDATE",
        Some(&previous),
        "recorded provider attempt result",
    );
    Ok(())
}

/// Resolve an `outcome_unknown` attempt with an explicit explanation. This is a
/// separate trusted capability from recording ordinary results.
#[reducer]
pub fn recover_ai_provider_attempt(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RecoverAiProviderAttemptParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_spend", "reconcile")?;
    validate_recovery_attribution(
        &params.actor_identity,
        &params.approval_id,
        &params.resolution,
    )?;
    let attempt = load_attempt(ctx, organization_id, params.attempt_id)?;
    let action = params.action.trim();
    let command = match action {
        RECOVERY_MARK_UNKNOWN => AttemptCommand::RecoverUnknown,
        RECOVERY_ABANDON_ACCEPTED => AttemptCommand::Abandon,
        _ => return Err("unknown provider attempt recovery action".into()),
    };
    let replayed = attempt.resolution.as_deref() == Some(params.resolution.as_str())
        && attempt.recovery_actor.as_deref() == Some(params.actor_identity.as_str())
        && attempt.recovery_approval_id.as_deref() == Some(params.approval_id.as_str());
    let next = match attempt_transition(&attempt.status, command)? {
        AttemptTransition::Replay if replayed => return Ok(()),
        AttemptTransition::Replay => {
            return Err("recovery replay has different attribution or resolution".into())
        }
        AttemptTransition::Apply(next) => next,
    };

    if next == ATTEMPT_ABANDONED {
        release_accepted_reservation(ctx, &attempt)?;
    }
    let previous = attempt.status.clone();
    let row = AiProviderAttempt {
        status: next.into(),
        failure_reason: (next == ATTEMPT_OUTCOME_UNKNOWN).then(|| params.resolution.clone()),
        resolution: Some(params.resolution),
        recovery_actor: Some(params.actor_identity),
        recovery_approval_id: Some(params.approval_id),
        recovery_at: Some(ctx.timestamp),
        finished_at: (next == ATTEMPT_ABANDONED).then_some(ctx.timestamp),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..attempt
    };
    ctx.db.ai_provider_attempt().id().update(row.clone());
    audit_attempt(
        ctx,
        &row,
        "UPDATE",
        Some(&previous),
        "recovered provider attempt",
    );
    Ok(())
}

/// Resolve an `outcome_unknown` attempt with an explicit approved command.
#[reducer]
pub fn reconcile_ai_provider_attempt(
    ctx: &ReducerContext,
    organization_id: u64,
    params: ReconcileAiProviderAttemptParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_spend", "reconcile")?;
    let attempt = load_attempt(ctx, organization_id, params.attempt_id)?;
    validate_recovery_attribution(
        &params.actor_identity,
        &params.approval_id,
        &params.resolution,
    )?;
    let command = AttemptCommand::Reconcile(params.status.trim());
    let usage = (params.input_tokens, params.output_tokens);
    let replayed = attempt.input_tokens == params.input_tokens
        && attempt.output_tokens == params.output_tokens
        && attempt.resolution.as_deref() == Some(params.resolution.as_str())
        && attempt.reconciliation_actor.as_deref() == Some(params.actor_identity.as_str())
        && attempt.reconciliation_approval_id.as_deref() == Some(params.approval_id.as_str());
    let next = match attempt_transition(&attempt.status, command)? {
        AttemptTransition::Replay if replayed => return Ok(()),
        AttemptTransition::Replay => {
            return Err("reconciliation replay has different usage or resolution".into())
        }
        AttemptTransition::Apply(next) => next,
    };
    ensure_within_allowance(ctx, &attempt, usage)?;
    let previous = attempt.status.clone();
    let row = AiProviderAttempt {
        status: next.into(),
        input_tokens: params.input_tokens,
        output_tokens: params.output_tokens,
        resolution: Some(params.resolution),
        reconciliation_actor: Some(params.actor_identity),
        reconciliation_approval_id: Some(params.approval_id),
        finished_at: Some(ctx.timestamp),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..attempt
    };
    ctx.db.ai_provider_attempt().id().update(row.clone());
    audit_attempt(
        ctx,
        &row,
        "UPDATE",
        Some(&previous),
        "reconciled provider attempt",
    );
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AttemptCommand<'a> {
    Dispatch,
    Result(&'a str),
    Reconcile(&'a str),
    RecoverUnknown,
    Abandon,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AttemptTransition {
    Apply(&'static str),
    /// The attempt already reflects this command; the caller compares payloads.
    Replay,
}

/// The only allowed provider-attempt transitions.
fn attempt_transition(
    current: &str,
    command: AttemptCommand<'_>,
) -> Result<AttemptTransition, String> {
    match command {
        AttemptCommand::Dispatch => match current {
            ATTEMPT_ACCEPTED => Ok(AttemptTransition::Apply(ATTEMPT_DISPATCHED)),
            ATTEMPT_DISPATCHED => Ok(AttemptTransition::Replay),
            _ => Err("only an accepted attempt can be dispatched".into()),
        },
        AttemptCommand::Result(result) => {
            let next = match result {
                ATTEMPT_SUCCEEDED => ATTEMPT_SUCCEEDED,
                ATTEMPT_FAILED => ATTEMPT_FAILED,
                ATTEMPT_OUTCOME_UNKNOWN => ATTEMPT_OUTCOME_UNKNOWN,
                _ => return Err("result must be succeeded, failed or outcome_unknown".into()),
            };
            match current {
                ATTEMPT_DISPATCHED => Ok(AttemptTransition::Apply(next)),
                same if same == next => Ok(AttemptTransition::Replay),
                ATTEMPT_ACCEPTED => Err("an attempt must be dispatched before its result".into()),
                _ => Err("attempt result conflicts with the recorded outcome".into()),
            }
        }
        AttemptCommand::Reconcile(result) => {
            let next = match result {
                ATTEMPT_SUCCEEDED => ATTEMPT_SUCCEEDED,
                ATTEMPT_FAILED => ATTEMPT_FAILED,
                _ => return Err("reconciliation must be succeeded or failed".into()),
            };
            match current {
                ATTEMPT_OUTCOME_UNKNOWN => Ok(AttemptTransition::Apply(next)),
                same if same == next => Ok(AttemptTransition::Replay),
                _ => Err("only an outcome_unknown attempt can be reconciled".into()),
            }
        }
        AttemptCommand::RecoverUnknown => match current {
            ATTEMPT_DISPATCHED => Ok(AttemptTransition::Apply(ATTEMPT_OUTCOME_UNKNOWN)),
            ATTEMPT_OUTCOME_UNKNOWN => Ok(AttemptTransition::Replay),
            _ => Err("only a dispatched attempt can be recovered as outcome_unknown".into()),
        },
        AttemptCommand::Abandon => match current {
            ATTEMPT_ACCEPTED => Ok(AttemptTransition::Apply(ATTEMPT_ABANDONED)),
            ATTEMPT_ABANDONED => Ok(AttemptTransition::Replay),
            _ => Err("only an accepted pre-dispatch attempt can be abandoned".into()),
        },
    }
}

fn attempt_matches(row: &AiProviderAttempt, params: &AcceptAiProviderAttemptParams) -> bool {
    row.company_id == params.company_id
        && row.agent_id == params.agent_id
        && row.run_id == params.run_id
        && row.reservation_id == params.reservation_id
        && row.request_key == params.request_key
        && provider_eq(&row.provider, &params.provider)
        && row.model == params.model
}

fn load_attempt(
    ctx: &ReducerContext,
    organization_id: u64,
    attempt_id: u64,
) -> Result<AiProviderAttempt, String> {
    let attempt = ctx
        .db
        .ai_provider_attempt()
        .id()
        .find(&attempt_id)
        .ok_or_else(|| "provider attempt not found".to_string())?;
    if attempt.organization_id != organization_id {
        return Err("provider attempt is outside the tenant".into());
    }
    Ok(attempt)
}

fn ensure_within_allowance(
    ctx: &ReducerContext,
    attempt: &AiProviderAttempt,
    (input_tokens, output_tokens): (u32, u32),
) -> Result<(), String> {
    let reservation = ctx
        .db
        .ai_spend_reservation()
        .id()
        .find(&attempt.reservation_id)
        .ok_or_else(|| "reservation not found".to_string())?;
    if input_tokens > reservation.input_token_allowance
        || output_tokens > reservation.output_token_allowance
    {
        return Err("attempt usage exceeds the reservation allowance".into());
    }
    Ok(())
}

fn validate_note(note: Option<&str>) -> Result<(), String> {
    if note.is_some_and(|value| value.len() > MAX_ATTEMPT_NOTE_LEN) {
        return Err("attempt note is too long".into());
    }
    Ok(())
}

fn validate_recovery_attribution(
    actor_identity: &str,
    approval_id: &str,
    resolution: &str,
) -> Result<(), String> {
    for (label, value, max) in [
        ("actor identity", actor_identity, MAX_RECOVERY_ACTOR_LEN),
        ("approval id", approval_id, MAX_APPROVAL_ID_LEN),
        ("resolution", resolution, MAX_ATTEMPT_NOTE_LEN),
    ] {
        if value.trim().is_empty() {
            return Err(format!("recovery {label} is required"));
        }
        if value != value.trim() {
            return Err(format!(
                "recovery {label} must not have surrounding whitespace"
            ));
        }
        if value.len() > max {
            return Err(format!("recovery {label} is too long"));
        }
        if value.chars().any(char::is_control) {
            return Err(format!("recovery {label} contains control characters"));
        }
    }
    Ok(())
}

fn release_accepted_reservation(
    ctx: &ReducerContext,
    attempt: &AiProviderAttempt,
) -> Result<(), String> {
    let reservation = ctx
        .db
        .ai_spend_reservation()
        .id()
        .find(&attempt.reservation_id)
        .ok_or_else(|| "reservation not found".to_string())?;
    if reservation.organization_id != attempt.organization_id
        || reservation.company_id != attempt.company_id
        || reservation.agent_id != attempt.agent_id
        || reservation.run_id != attempt.run_id
        || reservation.request_key != attempt.request_key
    {
        return Err("accepted attempt reservation binding is invalid".into());
    }
    if reservation.status == RESERVATION_RELEASED {
        return Ok(());
    }
    if reservation.status != RESERVATION_RESERVED {
        return Err("only reserved pre-dispatch spend can be released".into());
    }
    let budget = ctx
        .db
        .ai_spend_budget()
        .ai_spend_budget_by_agent_period()
        .filter((&reservation.agent_id, &reservation.billing_period))
        .find(|row| {
            row.organization_id == attempt.organization_id && row.currency == reservation.currency
        })
        .ok_or_else(|| "budget not found".to_string())?;
    let outstanding_units = budget
        .outstanding_units
        .checked_sub(reservation.reserved_units)
        .ok_or_else(|| "budget outstanding spend is below the reservation".to_string())?;
    ctx.db.ai_spend_budget().id().update(AiSpendBudget {
        outstanding_units,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..budget
    });
    ctx.db
        .ai_spend_reservation()
        .id()
        .update(AiSpendReservation {
            status: RESERVATION_RELEASED.into(),
            ..reservation
        });
    Ok(())
}

fn audit_attempt(
    ctx: &ReducerContext,
    row: &AiProviderAttempt,
    action: &'static str,
    previous_status: Option<&str>,
    summary: &str,
) {
    write_audit_log_v2(
        ctx,
        row.organization_id,
        AuditLogParams {
            company_id: Some(row.company_id),
            table_name: "ai_provider_attempt",
            record_id: row.id,
            action,
            old_values: previous_status
                .map(|status| serde_json::json!({ "status": status }).to_string()),
            new_values: Some(
                serde_json::json!({
                    "status": row.status,
                    "run_id": row.run_id,
                    "reservation_id": row.reservation_id,
                    "input_tokens": row.input_tokens,
                    "output_tokens": row.output_tokens,
                    "recovery_actor": row.recovery_actor,
                    "recovery_approval_id": row.recovery_approval_id,
                    "reconciliation_actor": row.reconciliation_actor,
                    "reconciliation_approval_id": row.reconciliation_approval_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["status".to_string()],
            metadata: Some(serde_json::json!({ "summary": summary }).to_string()),
        },
    );
}

fn validate_common(
    period: &str,
    currency: &str,
    provider: &str,
    model: &str,
) -> Result<(), String> {
    if !valid_period(period) {
        return Err("billing period must be YYYY-MM".into());
    }
    if currency.len() != MAX_CURRENCY_LEN || !currency.bytes().all(|b| b.is_ascii_uppercase()) {
        return Err("currency must be a three-letter uppercase code".into());
    }
    if provider.is_empty()
        || provider.len() > MAX_PROVIDER_LEN
        || model.is_empty()
        || model.len() > MAX_MODEL_LEN
    {
        return Err("provider or model is invalid".into());
    }
    Ok(())
}

fn valid_period(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == MAX_PERIOD_LEN
        && bytes[4] == b'-'
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[5..].iter().all(u8::is_ascii_digit)
        && (1..=12).contains(&value[5..].parse::<u32>().unwrap_or(0))
}
fn current_period(timestamp: Timestamp) -> Result<String, String> {
    let date = chrono::DateTime::from_timestamp_micros(timestamp.to_micros_since_unix_epoch())
        .ok_or("timestamp is outside the supported calendar")?;
    Ok(date.format("%Y-%m").to_string())
}
fn model_allowed(allowed: &[String], model: &str) -> bool {
    !allowed.is_empty() && allowed.iter().any(|candidate| candidate == model)
}
fn provider_eq(left: &str, right: &str) -> bool {
    left.eq_ignore_ascii_case(right)
}
fn allowance_cost(snapshot: &AiPriceSnapshot, input: u32, output: u32) -> Result<u64, String> {
    usage_cost(snapshot, input, output)
}
fn usage_cost(snapshot: &AiPriceSnapshot, input: u32, output: u32) -> Result<u64, String> {
    checked_token_cost(input, snapshot.input_units_per_1k)?
        .checked_add(checked_token_cost(output, snapshot.output_units_per_1k)?)
        .ok_or_else(|| "usage cost overflow".into())
}
fn checked_token_cost(tokens: u32, units_per_1k: u64) -> Result<u64, String> {
    (u64::from(tokens))
        .checked_mul(units_per_1k)
        .and_then(|v| v.checked_add(999))
        .map(|v| v / 1000)
        .ok_or_else(|| "usage cost overflow".into())
}

fn reservation_matches(row: &AiSpendReservation, params: &ReserveAiSpendParams) -> bool {
    row.company_id == params.company_id
        && row.agent_id == params.agent_id
        && row.run_id == params.run_id
        && row.request_key == params.request_key
        && provider_eq(&row.provider, &params.provider)
        && row.model == params.model
        && row.billing_period == params.billing_period
        && row.currency == params.currency
        && row.price_snapshot_id == params.price_snapshot_id
        && row.input_token_allowance == params.input_token_allowance
        && row.output_token_allowance == params.output_token_allowance
}

fn settlement_replay(status: &str, stored: (u32, u32), actual: (u32, u32)) -> Result<bool, String> {
    match status {
        "reserved" => Ok(false),
        "settled" if stored == actual => Ok(true),
        "settled" => Err("settlement replay has different usage".into()),
        _ => Err("unknown reservation status".into()),
    }
}

fn reserve_units(limit: u64, settled: u64, outstanding: u64, amount: u64) -> Result<u64, String> {
    let next = outstanding
        .checked_add(amount)
        .ok_or("outstanding spend overflow")?;
    if settled.checked_add(next).ok_or("budget total overflow")? > limit {
        return Err("budget exhausted".into());
    }
    Ok(next)
}

fn settle_units(
    limit: u64,
    settled: u64,
    outstanding: u64,
    reserved: u64,
    actual: u64,
) -> Result<(u64, u64), String> {
    if actual > reserved {
        return Err("actual usage exceeds reserved amount".into());
    }
    let remaining = outstanding
        .checked_sub(reserved)
        .ok_or("reservation accounting underflow")?;
    let settled = settled
        .checked_add(actual)
        .ok_or("settled spend overflow")?;
    reserve_units(limit, settled, remaining, 0)?;
    Ok((settled, remaining))
}

fn validate_run(
    ctx: &ReducerContext,
    organization_id: u64,
    run: &crate::ai::skills::AiAgentRun,
    company_id: u64,
    agent_id: u64,
) -> Result<(), String> {
    if run.organization_id != organization_id
        || run.company_id != company_id
        || run.agent_id != agent_id
        || (run.status != "pending" && run.status != "running")
    {
        return Err("run is not active or binding does not match".into());
    }
    let agent = ctx
        .db
        .ai_agent()
        .id()
        .find(&agent_id)
        .ok_or_else(|| "agent not found".to_string())?;
    if !agent.is_active
        || agent.organization_id != organization_id
        || agent.company_id.is_some_and(|scope| scope != company_id)
    {
        return Err("agent is not active in this company".into());
    }
    if let Some(member_id) = run.team_member_id {
        let member = ctx
            .db
            .ai_team_member()
            .id()
            .find(&member_id)
            .ok_or_else(|| "team member not found".to_string())?;
        if member.organization_id != organization_id
            || member.company_id.is_some_and(|scope| scope != company_id)
            || member.ai_agent_id != agent_id
            || !member.is_active
        {
            return Err("team member binding is invalid".into());
        }
    }
    if let Some(config_id) = run.skill_config_id {
        let config = ctx
            .db
            .ai_skill_config()
            .id()
            .find(&config_id)
            .ok_or_else(|| "skill config not found".to_string())?;
        if config.organization_id != organization_id
            || config.company_id.is_some_and(|scope| scope != company_id)
            || config.skill_id != run.skill_id
            || !config.is_enabled
        {
            return Err("skill config binding is invalid".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn period_and_currency_bounds_are_strict() {
        assert!(valid_period("2026-09"));
        assert!(!valid_period("2026-9"));
        assert!(!valid_period("2026-13"));
        assert!(validate_common("2026-09", "USD", "openai", "gpt").is_ok());
        assert!(validate_common("2026-09", "usd", "openai", "gpt").is_err());
    }

    #[test]
    fn integer_cost_rounds_up_without_float() {
        assert_eq!(
            checked_token_cost(1, 7).unwrap() + checked_token_cost(1, 11).unwrap(),
            2
        );
        assert_eq!(
            checked_token_cost(1_000, 7).unwrap() + checked_token_cost(1_000, 11).unwrap(),
            18
        );
    }

    #[test]
    fn overflow_is_rejected() {
        assert!(checked_token_cost(u32::MAX, u64::MAX).is_err());
    }

    #[test]
    fn outstanding_attempt_blocks_second_admission_until_settlement() {
        let outstanding = reserve_units(100, 20, 0, 60).unwrap();
        assert!(reserve_units(100, 20, outstanding, 21).is_err());
        // An ambiguous timeout performs no settlement and retains all 60.
        assert_eq!(outstanding, 60);
        let (settled, outstanding) = settle_units(100, 20, outstanding, 60, 35).unwrap();
        assert_eq!((settled, outstanding), (55, 0));
        assert_eq!(reserve_units(100, settled, outstanding, 45).unwrap(), 45);
    }

    #[test]
    fn competing_budget_reservations_never_overspend_in_any_serialization_order() {
        // Reducers are transactionally serialized by SpacetimeDB. Exercise
        // both possible commit orders for two contenders whose combined
        // allowance exceeds the shared budget.
        for costs in [[60, 50], [50, 60]] {
            let mut outstanding = 0;
            let mut admitted = Vec::new();
            for cost in costs {
                match reserve_units(100, 0, outstanding, cost) {
                    Ok(next) => {
                        outstanding = next;
                        admitted.push(cost);
                    }
                    Err(_) => {}
                }
                assert!(outstanding <= 100);
            }
            assert_eq!(admitted, vec![costs[0]]);
            assert_eq!(outstanding, costs[0]);
        }

        // When the contenders exactly fit, both commit in either order and
        // the shared outstanding balance reaches, but never exceeds, the cap.
        for costs in [[60, 40], [40, 60]] {
            let mut outstanding = 0;
            for cost in costs {
                outstanding = reserve_units(100, 0, outstanding, cost).unwrap();
                assert!(outstanding <= 100);
            }
            assert_eq!(outstanding, 100);
        }
    }

    #[test]
    fn settlement_and_admission_reject_overflow_underflow_and_overcharge() {
        assert!(reserve_units(u64::MAX, 1, u64::MAX, 0).is_err());
        assert!(reserve_units(u64::MAX, 0, u64::MAX, 1).is_err());
        assert!(settle_units(100, 0, 9, 10, 5).is_err());
        assert!(settle_units(100, 0, 10, 10, 11).is_err());
        assert_eq!(settle_units(100, 0, 10, 10, 0).unwrap(), (0, 0));
    }

    #[test]
    fn period_uses_utc_calendar_and_rejects_unicode_without_panicking() {
        assert_eq!(
            current_period(Timestamp::from_micros_since_unix_epoch(0)).unwrap(),
            "1970-01"
        );
        assert_eq!(
            current_period(Timestamp::from_micros_since_unix_epoch(-1)).unwrap(),
            "1969-12"
        );
        for invalid in ["éé-09", "2026-é", "2026-00", "2026-13", "2026-1"] {
            assert!(!valid_period(invalid));
        }
        assert!(!model_allowed(&[], "model"));
        assert!(!model_allowed(&["allowed".into()], "other"));
    }

    #[test]
    fn settlement_replay_requires_exact_persisted_usage() {
        assert!(!settlement_replay("reserved", (0, 0), (10, 20)).unwrap());
        assert!(settlement_replay("settled", (10, 20), (10, 20)).unwrap());
        assert!(settlement_replay("settled", (10, 20), (10, 21)).is_err());
        assert!(settlement_replay("unknown", (0, 0), (0, 0)).is_err());
    }

    #[test]
    fn attempts_dispatch_exactly_once_after_acceptance() {
        use AttemptCommand::*;
        use AttemptTransition::*;
        assert_eq!(
            attempt_transition(ATTEMPT_ACCEPTED, Dispatch),
            Ok(Apply(ATTEMPT_DISPATCHED))
        );
        assert_eq!(attempt_transition(ATTEMPT_DISPATCHED, Dispatch), Ok(Replay));
        for terminal in [
            ATTEMPT_SUCCEEDED,
            ATTEMPT_FAILED,
            ATTEMPT_OUTCOME_UNKNOWN,
            ATTEMPT_ABANDONED,
        ] {
            assert!(
                attempt_transition(terminal, Dispatch).is_err(),
                "{terminal}"
            );
        }
    }

    #[test]
    fn results_require_dispatch_and_never_rewrite_an_outcome() {
        use AttemptCommand::*;
        use AttemptTransition::*;
        for result in [ATTEMPT_SUCCEEDED, ATTEMPT_FAILED, ATTEMPT_OUTCOME_UNKNOWN] {
            assert_eq!(
                attempt_transition(ATTEMPT_DISPATCHED, Result(result)),
                Ok(Apply(result))
            );
            assert_eq!(attempt_transition(result, Result(result)), Ok(Replay));
            assert!(attempt_transition(ATTEMPT_ACCEPTED, Result(result)).is_err());
        }
        assert!(attempt_transition(ATTEMPT_SUCCEEDED, Result(ATTEMPT_FAILED)).is_err());
        assert!(attempt_transition(ATTEMPT_OUTCOME_UNKNOWN, Result(ATTEMPT_SUCCEEDED)).is_err());
        assert!(attempt_transition(ATTEMPT_DISPATCHED, Result("settled")).is_err());
    }

    #[test]
    fn only_unknown_outcomes_reconcile_to_a_known_result() {
        use AttemptCommand::*;
        use AttemptTransition::*;
        for result in [ATTEMPT_SUCCEEDED, ATTEMPT_FAILED] {
            assert_eq!(
                attempt_transition(ATTEMPT_OUTCOME_UNKNOWN, Reconcile(result)),
                Ok(Apply(result))
            );
            assert_eq!(attempt_transition(result, Reconcile(result)), Ok(Replay));
            assert!(attempt_transition(ATTEMPT_DISPATCHED, Reconcile(result)).is_err());
            assert!(attempt_transition(ATTEMPT_ACCEPTED, Reconcile(result)).is_err());
        }
        assert!(
            attempt_transition(ATTEMPT_OUTCOME_UNKNOWN, Reconcile(ATTEMPT_OUTCOME_UNKNOWN))
                .is_err()
        );
        assert!(attempt_transition(ATTEMPT_SUCCEEDED, Reconcile(ATTEMPT_FAILED)).is_err());
    }

    #[test]
    fn recovery_never_authorizes_redispatch_or_abandons_after_dispatch() {
        use AttemptCommand::*;
        use AttemptTransition::*;
        assert_eq!(
            attempt_transition(ATTEMPT_DISPATCHED, RecoverUnknown),
            Ok(Apply(ATTEMPT_OUTCOME_UNKNOWN))
        );
        assert_eq!(
            attempt_transition(ATTEMPT_OUTCOME_UNKNOWN, RecoverUnknown),
            Ok(Replay)
        );
        assert!(attempt_transition(ATTEMPT_ACCEPTED, RecoverUnknown).is_err());
        assert_eq!(
            attempt_transition(ATTEMPT_ACCEPTED, Abandon),
            Ok(Apply(ATTEMPT_ABANDONED))
        );
        assert_eq!(attempt_transition(ATTEMPT_ABANDONED, Abandon), Ok(Replay));
        assert!(attempt_transition(ATTEMPT_DISPATCHED, Abandon).is_err());
        assert!(attempt_transition(ATTEMPT_ABANDONED, Dispatch).is_err());
    }

    #[test]
    fn recovery_attribution_is_required_bounded_and_printable() {
        assert!(validate_recovery_attribution("actor", "approval", "verified").is_ok());
        assert!(validate_recovery_attribution("", "approval", "verified").is_err());
        assert!(validate_recovery_attribution("actor", "", "verified").is_err());
        assert!(validate_recovery_attribution("actor", "approval", "\n").is_err());
        assert!(validate_recovery_attribution(" actor", "approval", "verified").is_err());
        assert!(validate_recovery_attribution(
            &"a".repeat(MAX_RECOVERY_ACTOR_LEN + 1),
            "approval",
            "verified",
        )
        .is_err());
    }

    #[test]
    fn attempt_notes_are_bounded() {
        assert!(validate_note(None).is_ok());
        assert!(validate_note(Some(&"x".repeat(MAX_ATTEMPT_NOTE_LEN))).is_ok());
        assert!(validate_note(Some(&"x".repeat(MAX_ATTEMPT_NOTE_LEN + 1))).is_err());
    }
}
