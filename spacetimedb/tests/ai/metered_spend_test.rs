//! Real native table/reducer invariants for shared non-generative admission.
use crate::ai::agents::{ai_agent, AiAgent};
use crate::ai::metered_spend::*;
use crate::ai::prepaid::{ai_prepaid_account, AiPrepaidAccount};
use crate::ai::skills::ai_agent_run;
use crate::ai::spend::*;
use crate::core::cold_tier_identity::{cold_tier_service_identity, ColdTierServiceIdentity};
use crate::core::users::{
    find_user_profile_for_identity, find_user_profile_for_organization, user_profile, UserProfile,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use spacetimedb::{ReducerContext, Table};

pub fn test_metered_shared_ledger(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let f = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let run_id = super::decision_events_test::seed_run(
        ctx,
        f.organization_id,
        f.company_id,
        &format!("metered-{}", f.organization_id),
    )?;
    let run = ctx
        .db
        .ai_agent_run()
        .id()
        .find(run_id)
        .ok_or("fixture run missing")?;
    let agent = ctx
        .db
        .ai_agent()
        .id()
        .find(run.agent_id)
        .ok_or("fixture agent missing")?;
    ctx.db.ai_agent().id().update(AiAgent {
        allowed_models: vec!["mistral-embed".into(), "mistral-ocr-2603".into()],
        ..agent
    });
    let period =
        chrono::DateTime::from_timestamp_micros(ctx.timestamp.to_micros_since_unix_epoch())
            .ok_or("invalid fixture date")?
            .format("%Y-%m")
            .to_string();
    configure_ai_spend(
        ctx,
        f.organization_id,
        run.agent_id,
        ConfigureAiSpendParams {
            billing_period: period.clone(),
            currency: "USD".into(),
            limit_units: 100,
            provider: "mistral".into(),
            model: "mistral-embed".into(),
            input_units_per_1k: 1_000,
            output_units_per_1k: 1_000,
        },
    )?;
    for (model, unit, rate) in [
        ("mistral-ocr-2603", "pages", 10_000),
        ("mistral-embed", "tokens", 1_000),
    ] {
        configure_ai_metered_price(
            ctx,
            f.organization_id,
            run.agent_id,
            ConfigureAiMeteredPriceParams {
                model: model.into(),
                unit: unit.into(),
                currency: "USD".into(),
                units_per_1k: rate,
            },
        )?;
    }
    // A tenant Owner retains its wildcard permission but cannot manufacture a
    // cheaper immutable price through a direct native reducer call.
    let platform_profile = find_user_profile_for_identity(ctx, ctx.sender())
        .ok_or("platform fixture profile missing")?;
    let tenant_profile = find_user_profile_for_organization(ctx, ctx.sender(), f.organization_id)
        .ok_or("tenant fixture profile missing")?;
    let platform_profile_id = platform_profile.id;
    let tenant_profile_id = tenant_profile.id;
    let platform_was_superuser = platform_profile.is_superuser;
    let tenant_was_superuser = tenant_profile.is_superuser;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: false,
        ..platform_profile
    });
    if tenant_profile_id != platform_profile_id {
        ctx.db.user_profile().id().update(UserProfile {
            is_superuser: false,
            ..tenant_profile
        });
    }
    let owner_permission =
        crate::helpers::check_permission(ctx, f.organization_id, "ai_spend", "configure_meter");
    let owner_price_change = configure_ai_metered_price(
        ctx,
        f.organization_id,
        run.agent_id,
        ConfigureAiMeteredPriceParams {
            model: "mistral-ocr-2603".into(),
            unit: "pages".into(),
            currency: "USD".into(),
            units_per_1k: 1,
        },
    );
    let owner_reserve = reserve_ai_metered_spend(
        ctx,
        f.organization_id,
        ReserveAiMeteredSpendParams {
            company_id: f.company_id,
            agent_id: run.agent_id,
            run_id: 0,
            actor_identity: ctx.sender().to_hex().to_string(),
            request_key: "owner:fake:ocr".into(),
            model: "mistral-ocr-2603".into(),
            unit: "pages".into(),
            allowance: 1,
        },
    );
    let owner_reconcile = reconcile_ai_metered_spend(
        ctx,
        f.organization_id,
        ReconcileAiMeteredSpendParams {
            reservation_id: 0,
            attempt_id: 0,
            actual_units: 0,
            result_json: "null".into(),
            actor_identity: "owner".into(),
            approval_id: "owner:approval".into(),
            resolution: "invented output".into(),
        },
    );
    let platform_profile = ctx
        .db
        .user_profile()
        .id()
        .find(platform_profile_id)
        .ok_or("platform fixture profile disappeared")?;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: platform_was_superuser,
        ..platform_profile
    });
    if tenant_profile_id != platform_profile_id {
        let tenant_profile = ctx
            .db
            .user_profile()
            .id()
            .find(tenant_profile_id)
            .ok_or("tenant fixture profile disappeared")?;
        ctx.db.user_profile().id().update(UserProfile {
            is_superuser: tenant_was_superuser,
            ..tenant_profile
        });
    }
    owner_permission.map_err(|error| {
        format!("Owner wildcard fixture lost its ordinary configure permission: {error}")
    })?;
    if owner_reserve.is_ok()
        || owner_reconcile
            .as_ref()
            .err()
            .is_none_or(|error| !error.contains("active platform superuser"))
    {
        return Err("ordinary Owner could fabricate or reconcile trusted provider output".into());
    }
    if owner_price_change.is_ok() {
        return Err("ordinary tenant Owner changed platform provider meter prices".into());
    }
    if ctx
        .db
        .ai_metered_price()
        .ai_metered_price_by_org()
        .filter(&f.organization_id)
        .any(|price| price.model == "mistral-ocr-2603" && price.units_per_1k == 1)
    {
        return Err("denied tenant price configuration persisted a lower price".into());
    }
    let params = ReserveAiMeteredSpendParams {
        company_id: f.company_id,
        agent_id: run.agent_id,
        run_id: 0,
        actor_identity: ctx.sender().to_hex().to_string(),
        request_key: format!("ocr:fixture:{}", f.organization_id),
        model: "mistral-ocr-2603".into(),
        unit: "pages".into(),
        allowance: 5,
    };
    // Platform privilege alone cannot impersonate the dedicated runtime writer.
    if reserve_ai_metered_spend(ctx, f.organization_id, params.clone()).is_ok() {
        return Err("unregistered superuser bypassed the service writer boundary".into());
    }
    let writer_key = format!("metered-test-writer-{}", f.organization_id);
    ctx.db
        .cold_tier_service_identity()
        .insert(ColdTierServiceIdentity {
            platform_id: writer_key.clone(),
            organization_id: f.organization_id,
            service_name: "ai_spend_writer".into(),
            identity: ctx.sender(),
            is_active: true,
            registered_by: ctx.sender(),
            registered_at: ctx.timestamp,
            retired_at: None,
        });
    let mut bad = params.clone();
    bad.company_id = foreign.company_id;
    if reserve_ai_metered_spend(ctx, f.organization_id, bad).is_ok() {
        return Err("foreign company accepted".into());
    }
    let mut bad = params.clone();
    bad.allowance = 11;
    if reserve_ai_metered_spend(ctx, f.organization_id, bad).is_ok() {
        return Err("monthly cap bypassed".into());
    }
    reserve_ai_metered_spend(ctx, f.organization_id, params.clone())?;
    reserve_ai_metered_spend(ctx, f.organization_id, params.clone())?;
    let meter = ctx
        .db
        .ai_metered_usage()
        .ai_metered_usage_by_org()
        .filter(&f.organization_id)
        .find(|m| m.request_key == params.request_key)
        .ok_or("meter absent")?;
    let reservation = ctx
        .db
        .ai_spend_reservation()
        .id()
        .find(meter.reservation_id)
        .ok_or("reservation absent")?;
    let budget_id = ctx
        .db
        .ai_spend_budget()
        .ai_spend_budget_by_agent_period()
        .filter((&run.agent_id, &period))
        .next()
        .ok_or("budget absent")?
        .id;
    if reservation.reserved_units != 50
        || reservation.price_snapshot_id != 0
        || reservation.input_token_allowance != 0
        || meter.unit != "pages"
    {
        return Err("page meter counterfeit or hold incorrect".into());
    }
    let mut shared_token = params.clone();
    shared_token.request_key.push_str(":shared_tokens");
    shared_token.model = "mistral-embed".into();
    shared_token.unit = "tokens".into();
    shared_token.allowance = 51;
    if reserve_ai_metered_spend(ctx, f.organization_id, shared_token).is_ok() {
        return Err("token and page reservations did not share the same monthly pool".into());
    }
    let mut bad = params.clone();
    bad.actor_identity = "f".repeat(64);
    if reserve_ai_metered_spend(ctx, f.organization_id, bad).is_ok() {
        return Err("actor replay accepted".into());
    }
    if settle_ai_spend(
        ctx,
        f.organization_id,
        SettleAiSpendParams {
            reservation_id: reservation.id,
            input_tokens: 0,
            output_tokens: 0,
        },
    )
    .is_ok()
    {
        return Err("legacy zero token settlement bypassed typed meter".into());
    }
    accept_ai_provider_attempt(
        ctx,
        f.organization_id,
        AcceptAiProviderAttemptParams {
            company_id: f.company_id,
            agent_id: run.agent_id,
            run_id: meter.run_id,
            reservation_id: meter.reservation_id,
            request_key: params.request_key.clone(),
            provider: "mistral".into(),
            model: params.model.clone(),
        },
    )?;
    let attempt = ctx
        .db
        .ai_provider_attempt()
        .ai_provider_attempt_by_request()
        .filter((&f.organization_id, &params.request_key))
        .next()
        .ok_or("attempt absent")?;
    let binding = ctx
        .db
        .cold_tier_service_identity()
        .platform_id()
        .find(&writer_key)
        .ok_or("writer binding missing")?;
    ctx.db
        .cold_tier_service_identity()
        .platform_id()
        .update(ColdTierServiceIdentity {
            identity: spacetimedb::Identity::__dummy(),
            ..binding.clone()
        });
    if claim_ai_metered_dispatch(
        ctx,
        f.organization_id,
        reservation.id,
        attempt.id,
        "f".repeat(32),
    )
    .is_ok()
        || settle_ai_metered_spend(
            ctx,
            f.organization_id,
            SettleAiMeteredSpendParams {
                reservation_id: reservation.id,
                attempt_id: attempt.id,
                actual_units: 0,
                result_json: "null".into(),
            },
        )
        .is_ok()
    {
        return Err("foreign service writer claimed or settled another service's debit".into());
    }
    ctx.db
        .cold_tier_service_identity()
        .platform_id()
        .update(binding);
    ctx.db.ai_provider_attempt().id().update(AiProviderAttempt {
        accepted_by: spacetimedb::Identity::__dummy(),
        ..attempt.clone()
    });
    if claim_ai_metered_dispatch(
        ctx,
        f.organization_id,
        reservation.id,
        attempt.id,
        "f".repeat(32),
    )
    .is_ok()
    {
        return Err("writer claimed another identity's accepted attempt".into());
    }
    ctx.db.ai_provider_attempt().id().update(attempt.clone());
    let claim = "a".repeat(32);
    if mark_ai_provider_attempt_dispatched(ctx, f.organization_id, attempt.id).is_ok() {
        return Err("legacy dispatch bypassed unique metered invocation owner".into());
    }
    claim_ai_metered_dispatch(
        ctx,
        f.organization_id,
        reservation.id,
        attempt.id,
        claim.clone(),
    )?;
    claim_ai_metered_dispatch(ctx, f.organization_id, reservation.id, attempt.id, claim)?;
    if claim_ai_metered_dispatch(
        ctx,
        f.organization_id,
        reservation.id,
        attempt.id,
        "b".repeat(32),
    )
    .is_ok()
    {
        return Err("different invocation acquired the same dispatch".into());
    }
    let dispatched = ctx
        .db
        .ai_provider_attempt()
        .id()
        .find(attempt.id)
        .ok_or("dispatched attempt missing")?;
    ctx.db.ai_provider_attempt().id().update(AiProviderAttempt {
        accepted_by: spacetimedb::Identity::__dummy(),
        ..dispatched.clone()
    });
    if settle_ai_metered_spend(
        ctx,
        f.organization_id,
        SettleAiMeteredSpendParams {
            reservation_id: reservation.id,
            attempt_id: attempt.id,
            actual_units: 0,
            result_json: "null".into(),
        },
    )
    .is_ok()
    {
        return Err("writer zero-settled another identity's dispatched attempt".into());
    }
    ctx.db.ai_provider_attempt().id().update(dispatched);
    ctx.db
        .ai_spend_reservation()
        .id()
        .update(AiSpendReservation {
            reserved_by: spacetimedb::Identity::__dummy(),
            ..reservation.clone()
        });
    if accept_ai_provider_attempt(
        ctx,
        f.organization_id,
        AcceptAiProviderAttemptParams {
            company_id: f.company_id,
            agent_id: run.agent_id,
            run_id: meter.run_id,
            reservation_id: reservation.id,
            request_key: params.request_key.clone(),
            provider: "mistral".into(),
            model: params.model.clone(),
        },
    )
    .is_ok()
        || settle_ai_metered_spend(
            ctx,
            f.organization_id,
            SettleAiMeteredSpendParams {
                reservation_id: reservation.id,
                attempt_id: attempt.id,
                actual_units: 0,
                result_json: "null".into(),
            },
        )
        .is_ok()
    {
        return Err("foreign reservation writer accepted or zero-settled a debit".into());
    }
    ctx.db
        .ai_spend_reservation()
        .id()
        .update(reservation.clone());
    if settle_ai_metered_spend(
        ctx,
        f.organization_id,
        SettleAiMeteredSpendParams {
            reservation_id: reservation.id,
            attempt_id: attempt.id,
            actual_units: 6,
            result_json: "null".into(),
        },
    )
    .is_ok()
    {
        return Err("native meter settled usage above its admitted allowance".into());
    }
    configure_ai_metered_price(
        ctx,
        f.organization_id,
        run.agent_id,
        ConfigureAiMeteredPriceParams {
            model: "mistral-ocr-2603".into(),
            unit: "pages".into(),
            currency: "USD".into(),
            units_per_1k: 100_000,
        },
    )?;
    if record_ai_provider_attempt_result(
        ctx,
        f.organization_id,
        RecordAiProviderAttemptResultParams {
            attempt_id: attempt.id,
            status: "succeeded".into(),
            input_tokens: 0,
            output_tokens: 0,
            failure_reason: None,
        },
    )
    .is_ok()
    {
        return Err("legacy attempt completed typed meter".into());
    }
    record_ai_provider_attempt_result(
        ctx,
        f.organization_id,
        RecordAiProviderAttemptResultParams {
            attempt_id: attempt.id,
            status: "outcome_unknown".into(),
            input_tokens: 0,
            output_tokens: 0,
            failure_reason: Some("lost response".into()),
        },
    )?;
    let held = ctx
        .db
        .ai_spend_budget()
        .id()
        .find(budget_id)
        .ok_or("held budget missing")?;
    if held.outstanding_units != 50 || held.settled_units != 0 {
        return Err("unknown outcome released hold".into());
    }
    let result = "\"recovered receipt text\"".to_string();
    if settle_ai_metered_spend(
        ctx,
        f.organization_id,
        SettleAiMeteredSpendParams {
            reservation_id: reservation.id,
            attempt_id: attempt.id,
            actual_units: 2,
            result_json: result.clone(),
        },
    )
    .is_ok()
    {
        return Err("unknown settled without reconciliation".into());
    }
    let reconciliation = ReconcileAiMeteredSpendParams {
        reservation_id: reservation.id,
        attempt_id: attempt.id,
        actual_units: 2,
        result_json: result.clone(),
        actor_identity: "test-operator".into(),
        approval_id: "approval:metered-test".into(),
        resolution: "provider receipt reviewed for two pages".into(),
    };
    reconcile_ai_metered_spend(ctx, f.organization_id, reconciliation.clone())?;
    reconcile_ai_metered_spend(ctx, f.organization_id, reconciliation)?;
    let complete = ctx
        .db
        .ai_metered_usage()
        .reservation_id()
        .find(reservation.id)
        .ok_or("complete meter absent")?;
    let budget = ctx
        .db
        .ai_spend_budget()
        .id()
        .find(budget_id)
        .ok_or("settled budget missing")?;
    if complete.actual_units != Some(2)
        || complete.result_json != Some(result)
        || budget.outstanding_units != 0
        || budget.settled_units != 20
    {
        return Err("settlement/result recovery was not atomic and exact".into());
    }
    // Exact recovery survives later provider policy revocation.
    let agent = ctx
        .db
        .ai_agent()
        .id()
        .find(run.agent_id)
        .ok_or("agent missing")?;
    ctx.db.ai_agent().id().update(AiAgent {
        is_active: false,
        ..agent.clone()
    });
    reserve_ai_metered_spend(ctx, f.organization_id, params.clone())?;
    ctx.db.ai_agent().id().update(agent);
    // An enabled empty prepaid account cannot borrow the sponsored monthly cap.
    ctx.db.ai_prepaid_account().insert(AiPrepaidAccount {
        id: 0,
        pool_key: format!("{}:{}", f.organization_id, run.agent_id),
        organization_id: f.organization_id,
        agent_id: run.agent_id,
        currency: "USD".into(),
        is_enabled: true,
        opening_settled_units: 20,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        enabled_by: Some(ctx.sender()),
        enabled_at: Some(ctx.timestamp),
    });
    let mut unfunded = params.clone();
    unfunded.request_key.push_str(":unfunded");
    unfunded.model = "mistral-embed".into();
    unfunded.unit = "tokens".into();
    unfunded.allowance = 1;
    if reserve_ai_metered_spend(ctx, f.organization_id, unfunded).is_ok() {
        return Err("prepaid funding gate bypassed".into());
    }
    Ok(())
}
