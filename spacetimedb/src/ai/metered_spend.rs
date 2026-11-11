//! Non-generative Mistral usage shares the ordinary monetary reservation pool.
//!
//! Pages are never represented as tokens. Private metadata records the meter,
//! its immutable price and actual units; the existing reservation remains the
//! sole owner of held/settled money and therefore of prepaid credit admission.

use spacetimedb::{reducer, ReducerContext, SpacetimeType, Table, Timestamp, ViewContext};

use super::{
    agents::ai_agent,
    skills::{ai_agent_run, AiAgentRun},
    spend::{
        self, ai_provider_attempt, ai_spend_budget, ai_spend_reservation, AiProviderAttempt,
        AiSpendBudget, AiSpendReservation,
    },
};
use crate::core::cold_tier_identity::cold_tier_service_identity;
use crate::core::users::find_user_profile_for_identity;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

const MAX_USAGE: u32 = 10_000_000;

fn require_metered_writer(ctx: &ReducerContext, organization_id: u64) -> Result<(), String> {
    let service = "ai_spend_writer".to_string();
    let bindings: Vec<_> = ctx
        .db
        .cold_tier_service_identity()
        .cold_tier_service_identity_by_name()
        .filter((organization_id, &service))
        .filter(|binding| binding.is_active)
        .collect();
    if bindings.len() != 1 || bindings[0].identity != ctx.sender() {
        return Err(
            "metered provider operations require the registered ai_spend_writer identity".into(),
        );
    }
    Ok(())
}
pub(super) fn require_platform_superuser(ctx: &ReducerContext) -> Result<(), String> {
    let user = find_user_profile_for_identity(ctx, ctx.sender()).ok_or("User not found")?;
    if !user.is_active || !user.is_superuser {
        return Err(
            "metered price configuration and reconciliation require an active platform superuser"
                .into(),
        );
    }
    Ok(())
}

#[derive(Clone)]
#[spacetimedb::table(accessor = ai_metered_price,
    index(accessor = ai_metered_price_by_org, btree(columns = [organization_id])))]
pub struct AiMeteredPrice {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub agent_id: u64,
    pub model: String,
    /// tokens | pages, interpreted only by the corresponding provider adapter.
    pub unit: String,
    pub currency: String,
    /// Integer currency microunits per 1,000 units (including OCR pages).
    pub units_per_1k: u64,
    pub version: u64,
    pub created_by: spacetimedb::Identity,
    pub created_at: Timestamp,
}

#[derive(Clone)]
#[spacetimedb::table(accessor = ai_metered_usage,
    index(accessor = ai_metered_usage_by_org, btree(columns = [organization_id])))]
pub struct AiMeteredUsage {
    #[primary_key]
    pub reservation_id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub agent_id: u64,
    pub run_id: u64,
    pub request_key: String,
    pub actor_identity: String,
    pub price_id: u64,
    pub model: String,
    /// Unique per-invocation dispatch owner; retries cannot acquire it twice.
    pub dispatch_claim: Option<String>,
    pub unit: String,
    pub allowance: u32,
    pub actual_units: Option<u32>,
    /// Private, bounded provider output for exact retry recovery. Never an
    /// authorization grant or independently verified business evidence.
    pub result_json: Option<String>,
}

#[derive(Clone, SpacetimeType)]
pub struct ConfigureAiMeteredPriceParams {
    pub model: String,
    pub unit: String,
    pub currency: String,
    pub units_per_1k: u64,
}

#[derive(Clone, SpacetimeType)]
pub struct ReserveAiMeteredSpendParams {
    pub company_id: u64,
    pub agent_id: u64,
    /// Zero requests a non-executable, hash-only infrastructure run.
    pub run_id: u64,
    pub actor_identity: String,
    pub request_key: String,
    pub model: String,
    pub unit: String,
    pub allowance: u32,
}

#[derive(Clone, SpacetimeType)]
pub struct SettleAiMeteredSpendParams {
    pub reservation_id: u64,
    pub attempt_id: u64,
    pub actual_units: u32,
    pub result_json: String,
}

#[derive(Clone, SpacetimeType)]
pub struct ReconcileAiMeteredSpendParams {
    pub reservation_id: u64,
    pub attempt_id: u64,
    pub actual_units: u32,
    pub result_json: String,
    pub actor_identity: String,
    pub approval_id: String,
    pub resolution: String,
}

fn validate_meter(model: &str, unit: &str) -> Result<(), String> {
    if model.is_empty()
        || model.len() > 128
        || model.chars().any(char::is_control)
        || model.ends_with("-latest")
        || !matches!(unit, "tokens" | "pages")
    {
        return Err("an exact model and supported usage meter are required".into());
    }
    if (unit == "tokens" && model != "mistral-embed")
        || (unit == "pages" && !model.starts_with("mistral-ocr-"))
    {
        return Err("model does not support the requested usage meter".into());
    }
    Ok(())
}

fn metered_cost(rate: u64, usage: u32) -> Result<u64, String> {
    let numerator = u128::from(rate)
        .checked_mul(u128::from(usage))
        .ok_or("metered cost overflow")?;
    u64::try_from(numerator.div_ceil(1_000)).map_err(|_| "metered cost overflow".into())
}

#[reducer]
pub fn configure_ai_metered_price(
    ctx: &ReducerContext,
    organization_id: u64,
    agent_id: u64,
    params: ConfigureAiMeteredPriceParams,
) -> Result<(), String> {
    // Tenant Owner wildcards are not platform authority to change provider prices.
    require_platform_superuser(ctx)?;
    check_permission(ctx, organization_id, "ai_spend", "configure_meter")?;
    validate_meter(&params.model, &params.unit)?;
    if params.currency.len() != 3
        || !params.currency.bytes().all(|b| b.is_ascii_uppercase())
        || params.units_per_1k == 0
        || params.units_per_1k > 1_000_000_000_000
    {
        return Err("invalid metered currency or price".into());
    }
    let agent = ctx
        .db
        .ai_agent()
        .id()
        .find(&agent_id)
        .ok_or("agent not found")?;
    if agent.organization_id != organization_id
        || !agent.is_active
        || !spend::provider_eq(&agent.provider, "mistral")
        || !spend::model_allowed(&agent.allowed_models, &params.model)
    {
        return Err("metered model is not allowed for this agent".into());
    }
    let latest = ctx
        .db
        .ai_metered_price()
        .ai_metered_price_by_org()
        .filter(&organization_id)
        .filter(|p| {
            p.agent_id == agent_id
                && p.model == params.model
                && p.unit == params.unit
                && p.currency == params.currency
        })
        .max_by_key(|p| p.version);
    if latest
        .as_ref()
        .is_some_and(|p| p.units_per_1k == params.units_per_1k)
    {
        return Ok(());
    }
    let version = latest
        .map_or(Some(1), |p| p.version.checked_add(1))
        .ok_or("price version overflow")?;
    let row = ctx.db.ai_metered_price().insert(AiMeteredPrice {
        id: 0,
        organization_id,
        agent_id,
        model: params.model,
        unit: params.unit,
        currency: params.currency,
        units_per_1k: params.units_per_1k,
        version,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "ai_metered_price",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some("configured immutable metered price".into()),
            changed_fields: vec!["metered_price".into()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn reserve_ai_metered_spend(
    ctx: &ReducerContext,
    organization_id: u64,
    params: ReserveAiMeteredSpendParams,
) -> Result<(), String> {
    require_metered_writer(ctx, organization_id)?;
    check_permission(ctx, organization_id, "ai_spend", "reserve")?;
    validate_meter(&params.model, &params.unit)?;
    if params.company_id == 0
        || params.allowance == 0
        || params.allowance > MAX_USAGE
        || params.request_key.is_empty()
        || params.request_key.len() > 160
        || !params
            .request_key
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b':' || b == b'_')
    {
        return Err("invalid metered scope, allowance or request key".into());
    }
    let actor = if params.actor_identity.is_empty() {
        ctx.sender().to_hex().to_string()
    } else {
        params.actor_identity.clone()
    };
    if actor.len() != 64 || !actor.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("metered actor identity is invalid".into());
    }
    let agent = ctx
        .db
        .ai_agent()
        .id()
        .find(&params.agent_id)
        .ok_or("agent not found")?;
    if agent.organization_id != organization_id
        || agent.company_id.is_some_and(|id| id != params.company_id)
    {
        return Err("metered agent is outside this company".into());
    }
    crate::core::organization::require_company_in_organization(
        ctx,
        organization_id,
        params.company_id,
    )?;
    if let Some(existing) = ctx
        .db
        .ai_spend_reservation()
        .ai_spend_reservation_by_request()
        .filter((&organization_id, &params.request_key))
        .next()
    {
        let meter = ctx
            .db
            .ai_metered_usage()
            .reservation_id()
            .find(&existing.id)
            .ok_or("request key belongs to another spend kind")?;
        if meter.company_id == params.company_id
            && meter.agent_id == params.agent_id
            && (params.run_id == 0 || meter.run_id == params.run_id)
            && meter.actor_identity == actor
            && existing.model == params.model
            && meter.unit == params.unit
            && meter.allowance == params.allowance
        {
            return Ok(());
        }
        return Err("metered request key was reused with different bindings".into());
    }
    if !agent.is_active
        || !spend::provider_eq(&agent.provider, "mistral")
        || !spend::model_allowed(&agent.allowed_models, &params.model)
    {
        return Err("metered model is not allowed in this company".into());
    }
    super::owner_configuration::require_single_pool(ctx, organization_id, params.agent_id)?;
    let period = spend::current_period(ctx.timestamp)?;
    let budgets: Vec<_> = ctx
        .db
        .ai_spend_budget()
        .ai_spend_budget_by_agent_period()
        .filter((&params.agent_id, &period))
        .filter(|p| p.organization_id == organization_id)
        .collect();
    if budgets.len() != 1 {
        return Err("one existing current-period budget is required".into());
    }
    let currency = &budgets[0].currency;
    let prices: Vec<_> = ctx
        .db
        .ai_metered_price()
        .ai_metered_price_by_org()
        .filter(&organization_id)
        .filter(|p| {
            p.agent_id == params.agent_id
                && p.model == params.model
                && p.unit == params.unit
                && &p.currency == currency
        })
        .collect();
    let price = prices
        .into_iter()
        .max_by_key(|p| p.version)
        .ok_or("metered price is not configured")?;
    let budget = super::owner_configuration::budget_for_reservation(
        ctx,
        organization_id,
        params.agent_id,
        &period,
        &price.currency,
    )?;
    let reserved = metered_cost(price.units_per_1k, params.allowance)?;
    let outstanding = spend::reserve_units(
        budget.limit_units,
        budget.settled_units,
        budget.outstanding_units,
        reserved,
    )?;
    super::prepaid::require_prepaid_credit(
        ctx,
        organization_id,
        params.agent_id,
        &price.currency,
        reserved,
    )?;
    let run_id = if params.run_id == 0 {
        ctx.db.ai_agent_run().insert(AiAgentRun { id: 0, organization_id, company_id: params.company_id,
            // This is infrastructure accounting, never a certified skill or executable program.
            skill_id: 0, skill_config_id: None, agent_id: params.agent_id, team_member_id: None,
            run_key: format!("meter:{organization_id}:{}", params.request_key), status: "running".into(),
            inputs_json: "{}".into(), summary: None, artifacts_json: None, citations_json: None,
            action_draft_ids: vec![], step_count: 0, tokens_used: 0, error_message: None,
            triggered_by_hex: actor.clone(), started_at: ctx.timestamp, completed_at: None,
            create_date: ctx.timestamp, write_date: ctx.timestamp,
            metadata: Some(serde_json::json!({"kind":"provider_metering","unit":params.unit,"model":params.model}).to_string()) }).id
    } else {
        let run = ctx
            .db
            .ai_agent_run()
            .id()
            .find(&params.run_id)
            .ok_or("metered run not found")?;
        spend::validate_run(
            ctx,
            organization_id,
            &run,
            params.company_id,
            params.agent_id,
        )?;
        params.run_id
    };
    ctx.db.ai_spend_budget().id().update(AiSpendBudget {
        outstanding_units: outstanding,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..budget
    });
    let reservation = ctx.db.ai_spend_reservation().insert(AiSpendReservation {
        id: 0,
        organization_id,
        company_id: params.company_id,
        agent_id: params.agent_id,
        run_id,
        request_key: params.request_key.clone(),
        provider: "mistral".into(),
        model: params.model.clone(),
        billing_period: period,
        currency: price.currency,
        // Zero is reserved for typed non-token prices. Ordinary price IDs are auto-incremented.
        price_snapshot_id: 0,
        reserved_units: reserved,
        settled_units: 0,
        input_token_allowance: 0,
        output_token_allowance: 0,
        status: "reserved".into(),
        reserved_by: ctx.sender(),
        settled_by: None,
        created_at: ctx.timestamp,
        settled_at: None,
        settled_input_tokens: 0,
        settled_output_tokens: 0,
    });
    ctx.db.ai_metered_usage().insert(AiMeteredUsage {
        reservation_id: reservation.id,
        organization_id,
        company_id: params.company_id,
        agent_id: params.agent_id,
        run_id,
        request_key: params.request_key,
        actor_identity: actor,
        price_id: price.id,
        model: params.model,
        dispatch_claim: None,
        unit: params.unit,
        allowance: params.allowance,
        actual_units: None,
        result_json: None,
    });
    audit_meter(
        ctx,
        organization_id,
        Some(params.company_id),
        reservation.id,
        "reserved metered provider spend",
    );
    Ok(())
}

/// Bind a single gateway invocation before provider I/O. A different invocation
/// can never treat an idempotent state transition as permission to dispatch.
#[reducer]
pub fn claim_ai_metered_dispatch(
    ctx: &ReducerContext,
    organization_id: u64,
    reservation_id: u64,
    attempt_id: u64,
    claim_id: String,
) -> Result<(), String> {
    require_metered_writer(ctx, organization_id)?;
    check_permission(ctx, organization_id, "ai_spend", "reserve")?;
    if claim_id.len() != 32 || !claim_id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("invalid metered dispatch claim".into());
    }
    let meter = ctx
        .db
        .ai_metered_usage()
        .reservation_id()
        .find(&reservation_id)
        .ok_or("meter not found")?;
    let reservation = ctx
        .db
        .ai_spend_reservation()
        .id()
        .find(&reservation_id)
        .ok_or("reservation not found")?;
    let attempt = ctx
        .db
        .ai_provider_attempt()
        .id()
        .find(&attempt_id)
        .ok_or("attempt not found")?;
    if meter.organization_id != organization_id
        || reservation.reserved_by != ctx.sender()
        || attempt.accepted_by != ctx.sender()
        || reservation.organization_id != organization_id
        || attempt.organization_id != organization_id
        || attempt.reservation_id != reservation_id
        || attempt.run_id != meter.run_id
        || reservation.status != "reserved"
    {
        return Err("metered dispatch claim scope mismatch".into());
    }
    if let Some(existing) = &meter.dispatch_claim {
        return if existing == &claim_id && attempt.status == "dispatched" {
            Ok(())
        } else {
            Err("metered dispatch belongs to another invocation".into())
        };
    }
    if attempt.status != "accepted" {
        return Err("metered attempt is not accepted".into());
    }
    let run = ctx
        .db
        .ai_agent_run()
        .id()
        .find(&meter.run_id)
        .ok_or("metered run not found")?;
    spend::validate_run(ctx, organization_id, &run, meter.company_id, meter.agent_id)?;
    let agent = ctx
        .db
        .ai_agent()
        .id()
        .find(&meter.agent_id)
        .ok_or("metered agent not found")?;
    if !spend::provider_eq(&agent.provider, "mistral")
        || !spend::model_allowed(&agent.allowed_models, &meter.model)
    {
        return Err("metered model is no longer admitted for dispatch".into());
    }
    ctx.db
        .ai_metered_usage()
        .reservation_id()
        .update(AiMeteredUsage {
            dispatch_claim: Some(claim_id),
            ..meter
        });
    ctx.db.ai_provider_attempt().id().update(AiProviderAttempt {
        status: "dispatched".into(),
        dispatched_at: Some(ctx.timestamp),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..attempt
    });
    audit_meter(
        ctx,
        organization_id,
        Some(reservation.company_id),
        reservation_id,
        "claimed single metered provider dispatch",
    );
    Ok(())
}

#[reducer]
pub fn settle_ai_metered_spend(
    ctx: &ReducerContext,
    organization_id: u64,
    params: SettleAiMeteredSpendParams,
) -> Result<(), String> {
    require_metered_writer(ctx, organization_id)?;
    check_permission(ctx, organization_id, "ai_spend", "settle")?;
    settle_meter(ctx, organization_id, params, None)
}

#[reducer]
pub fn reconcile_ai_metered_spend(
    ctx: &ReducerContext,
    organization_id: u64,
    params: ReconcileAiMeteredSpendParams,
) -> Result<(), String> {
    require_platform_superuser(ctx)?;
    check_permission(ctx, organization_id, "ai_spend", "reconcile")?;
    spend::validate_recovery_attribution(
        &params.actor_identity,
        &params.approval_id,
        &params.resolution,
    )?;
    let attribution = (params.actor_identity, params.approval_id, params.resolution);
    settle_meter(
        ctx,
        organization_id,
        SettleAiMeteredSpendParams {
            reservation_id: params.reservation_id,
            attempt_id: params.attempt_id,
            actual_units: params.actual_units,
            result_json: params.result_json,
        },
        Some(attribution),
    )
}

fn settle_meter(
    ctx: &ReducerContext,
    organization_id: u64,
    params: SettleAiMeteredSpendParams,
    attribution: Option<(String, String, String)>,
) -> Result<(), String> {
    if params.result_json.len() > 1_048_576
        || serde_json::from_str::<serde_json::Value>(&params.result_json).is_err()
    {
        return Err("metered result must be bounded valid JSON".into());
    }
    let meter = ctx
        .db
        .ai_metered_usage()
        .reservation_id()
        .find(&params.reservation_id)
        .ok_or("metered usage not found")?;
    let reservation = ctx
        .db
        .ai_spend_reservation()
        .id()
        .find(&params.reservation_id)
        .ok_or("reservation not found")?;
    let attempt = ctx
        .db
        .ai_provider_attempt()
        .id()
        .find(&params.attempt_id)
        .ok_or("attempt not found")?;
    if meter.organization_id != organization_id
        || reservation.organization_id != organization_id
        || attempt.organization_id != organization_id
        || attempt.reservation_id != reservation.id
        || attempt.company_id != reservation.company_id
        || attempt.agent_id != reservation.agent_id
        || attempt.run_id != reservation.run_id
        || attempt.request_key != reservation.request_key
        || attempt.provider != reservation.provider
        || attempt.model != reservation.model
        || params.actual_units > meter.allowance
    {
        return Err("metered settlement scope or usage does not match".into());
    }
    if attribution.is_none()
        && (reservation.reserved_by != ctx.sender() || attempt.accepted_by != ctx.sender())
    {
        return Err(
            "ordinary metered settlement requires the original reservation and attempt writer"
                .into(),
        );
    }
    if reservation.status == "settled" {
        if meter.actual_units == Some(params.actual_units)
            && meter.result_json.as_ref() == Some(&params.result_json)
            && attempt.status == "succeeded"
            && attribution
                .as_ref()
                .is_none_or(|(actor, approval, resolution)| {
                    attempt.reconciliation_actor.as_ref() == Some(actor)
                        && attempt.reconciliation_approval_id.as_ref() == Some(approval)
                        && attempt.resolution.as_ref() == Some(resolution)
                })
        {
            return Ok(());
        }
        return Err("metered settlement replay differs".into());
    }
    if reservation.status != "reserved"
        || (attribution.is_none() && attempt.status != "dispatched")
        || (attribution.is_some()
            && !matches!(attempt.status.as_str(), "outcome_unknown" | "dispatched"))
    {
        return Err("metered provider attempt cannot settle from this state".into());
    }
    let price = ctx
        .db
        .ai_metered_price()
        .id()
        .find(&meter.price_id)
        .ok_or("metered price not found")?;
    let actual = metered_cost(price.units_per_1k, params.actual_units)?;
    let budget = ctx
        .db
        .ai_spend_budget()
        .ai_spend_budget_by_agent_period()
        .filter((&reservation.agent_id, &reservation.billing_period))
        .find(|p| p.organization_id == organization_id && p.currency == reservation.currency)
        .ok_or("budget not found")?;
    let (settled, outstanding) = spend::settle_units(
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
            settled_units: actual,
            settled_by: Some(ctx.sender()),
            settled_at: Some(ctx.timestamp),
            ..reservation.clone()
        });
    ctx.db
        .ai_metered_usage()
        .reservation_id()
        .update(AiMeteredUsage {
            actual_units: Some(params.actual_units),
            result_json: Some(params.result_json),
            ..meter
        });
    let mut completed = AiProviderAttempt {
        status: "succeeded".into(),
        input_tokens: 0,
        output_tokens: 0,
        finished_at: Some(ctx.timestamp),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..attempt
    };
    if let Some((actor, approval, resolution)) = attribution {
        completed.reconciliation_actor = Some(actor);
        completed.reconciliation_approval_id = Some(approval);
        completed.resolution = Some(resolution);
    }
    ctx.db.ai_provider_attempt().id().update(completed);
    if let Some(run) = ctx.db.ai_agent_run().id().find(&reservation.run_id) {
        if run.skill_id == 0 && run.run_key.starts_with("meter:") {
            ctx.db.ai_agent_run().id().update(AiAgentRun {
                status: "completed".into(),
                completed_at: Some(ctx.timestamp),
                write_date: ctx.timestamp,
                ..run
            });
        }
    }
    audit_meter(
        ctx,
        organization_id,
        Some(reservation.company_id),
        reservation.id,
        "settled metered provider spend",
    );
    Ok(())
}

#[derive(Clone, SpacetimeType)]
pub struct AiMeteredPriceRead {
    pub id: u64,
    pub organization_id: u64,
    pub agent_id: u64,
    pub model: String,
    pub unit: String,
    pub currency: String,
    pub units_per_1k: u64,
    pub version: u64,
}

#[spacetimedb::view(accessor = ai_metered_price_read, public, primary_key = id)]
pub fn ai_metered_price_read(ctx: &ViewContext) -> Vec<AiMeteredPriceRead> {
    super::spend_reads::authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|org| {
            ctx.db
                .ai_metered_price()
                .ai_metered_price_by_org()
                .filter(&org)
                .map(|p| AiMeteredPriceRead {
                    id: p.id,
                    organization_id: p.organization_id,
                    agent_id: p.agent_id,
                    model: p.model,
                    unit: p.unit,
                    currency: p.currency,
                    units_per_1k: p.units_per_1k,
                    version: p.version,
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

#[spacetimedb::view(accessor = ai_metered_usage_read, public, primary_key = reservation_id)]
pub fn ai_metered_usage_read(ctx: &ViewContext) -> Vec<AiMeteredUsage> {
    super::spend_reads::authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|org| {
            ctx.db
                .ai_metered_usage()
                .ai_metered_usage_by_org()
                .filter(&org)
                .collect::<Vec<_>>()
        })
        .collect()
}

fn audit_meter(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    id: u64,
    summary: &str,
) {
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name: "ai_metered_usage",
            record_id: id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(summary.into()),
            changed_fields: vec!["metered_spend".into()],
            metadata: None,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn metered_cost_rounds_up_and_does_not_wrap() {
        assert_eq!(metered_cost(1_500, 2), Ok(3));
        assert_eq!(metered_cost(1, 1), Ok(1));
        assert_eq!(metered_cost(1_500, 0), Ok(0));
        assert!(metered_cost(u64::MAX, u32::MAX).is_err());
    }
    #[test]
    fn page_and_token_meters_cannot_be_confused() {
        assert!(validate_meter("mistral-embed", "tokens").is_ok());
        assert!(validate_meter("mistral-ocr-2603", "pages").is_ok());
        assert!(validate_meter("mistral-embed", "pages").is_err());
        assert!(validate_meter("mistral-ocr-2603", "tokens").is_err());
        assert!(validate_meter("mistral-ocr-latest", "pages").is_err());
    }
}
