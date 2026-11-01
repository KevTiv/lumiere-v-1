//! Native reducer invariants; run via run_ai_prepaid_tests inside an isolated module.
use crate::ai::agents::{ai_agent, create_ai_agent, CreateAiAgentParams};
use crate::ai::prepaid::*;
use crate::ai::skills::{ai_agent_run, AiAgentRun};
use crate::ai::spend::*;
use crate::core::cold_tier_identity::{cold_tier_service_identity, ColdTierServiceIdentity};
use crate::core::users::{find_user_profile_for_organization, user_profile, UserProfile};
use crate::helpers::check_permission;
use crate::test_harness::OrgFixture;
use spacetimedb::{ReducerContext, Table};

struct Fixture {
    org: u64,
    company: u64,
    agent: u64,
    run: u64,
    price: u64,
    period: String,
}
fn seed(ctx: &ReducerContext) -> Result<Fixture, String> {
    let f = OrgFixture::seed_minimal(ctx)?;
    create_ai_agent(
        ctx,
        f.organization_id,
        None,
        CreateAiAgentParams {
            name: "Prepaid invariant agent".into(),
            description: None,
            model: "prepaid-test".into(),
            provider: "mistral".into(),
            api_key_reference: None,
            temperature: 0.0,
            max_tokens: 100,
            context_window: 1000,
            top_p: 1.0,
            frequency_penalty: 0.0,
            presence_penalty: 0.0,
            system_prompt: None,
            is_active: true,
            is_default: false,
            allowed_models: vec!["prepaid-test".into()],
            allowed_actions: vec!["skill_run".into()],
            rate_limit_per_minute: 10,
            cost_per_1k_tokens: 0.0,
            monthly_budget: None,
            metadata: None,
        },
    )?;
    let agents = ctx
        .db
        .ai_agent()
        .ai_agent_by_org()
        .filter(&f.organization_id)
        .filter(|a| a.name == "Prepaid invariant agent")
        .collect::<Vec<_>>();
    if agents.len() != 1 {
        return Err("prepaid fixture agent identity is ambiguous".into());
    }
    let agent = agents[0].id;
    let run = ctx.db.ai_agent_run().insert(AiAgentRun {
        id: 0,
        organization_id: f.organization_id,
        company_id: f.company_id,
        skill_id: 1,
        skill_config_id: None,
        agent_id: agent,
        team_member_id: None,
        run_key: format!("prepaid-{}", f.organization_id),
        status: "running".into(),
        inputs_json: "{}".into(),
        summary: None,
        artifacts_json: None,
        citations_json: None,
        action_draft_ids: vec![],
        step_count: 0,
        tokens_used: 0,
        error_message: None,
        triggered_by_hex: ctx.sender().to_hex().to_string(),
        started_at: ctx.timestamp,
        completed_at: None,
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
        metadata: None,
    });
    let period =
        chrono::DateTime::from_timestamp_micros(ctx.timestamp.to_micros_since_unix_epoch())
            .ok_or("test date invalid")?
            .format("%Y-%m")
            .to_string();
    configure_ai_spend(
        ctx,
        f.organization_id,
        agent,
        ConfigureAiSpendParams {
            billing_period: period.clone(),
            currency: "USD".into(),
            limit_units: 1000,
            provider: "mistral".into(),
            model: "prepaid-test".into(),
            input_units_per_1k: 1000,
            output_units_per_1k: 1000,
        },
    )?;
    let prices = ctx
        .db
        .ai_price_snapshot()
        .ai_price_snapshot_by_agent()
        .filter(&agent)
        .collect::<Vec<_>>();
    if prices.len() != 1 {
        return Err("test price identity is ambiguous".into());
    }
    Ok(Fixture {
        org: f.organization_id,
        company: f.company_id,
        agent,
        run: run.id,
        price: prices[0].id,
        period,
    })
}
fn bind_funder(ctx: &ReducerContext, f: &Fixture) {
    ctx.db
        .cold_tier_service_identity()
        .insert(ColdTierServiceIdentity {
            platform_id: format!("prepaid-test-funder-{}", f.org),
            organization_id: f.org,
            service_name: "ai_credit_funder".into(),
            identity: ctx.sender(),
            is_active: true,
            registered_by: ctx.sender(),
            registered_at: ctx.timestamp,
            retired_at: None,
        });
}
fn reserve(ctx: &ReducerContext, f: &Fixture, key: &str, units: u32) -> Result<u64, String> {
    reserve_ai_spend(
        ctx,
        f.org,
        ReserveAiSpendParams {
            company_id: f.company,
            agent_id: f.agent,
            run_id: f.run,
            request_key: key.into(),
            provider: "mistral".into(),
            model: "prepaid-test".into(),
            billing_period: f.period.clone(),
            currency: "USD".into(),
            price_snapshot_id: f.price,
            input_token_allowance: 0,
            output_token_allowance: units,
        },
    )?;
    let rows = ctx
        .db
        .ai_spend_reservation()
        .ai_spend_reservation_by_request()
        .filter((f.org, &key.to_string()))
        .collect::<Vec<_>>();
    if rows.len() != 1 {
        return Err("reservation identity is ambiguous".into());
    }
    Ok(rows[0].id)
}
fn funding(
    ctx: &ReducerContext,
    f: &Fixture,
    account: u64,
    key: &str,
    units: u64,
    original: Option<u64>,
) -> Result<(), String> {
    record_ai_prepaid_funding(
        ctx,
        f.org,
        RecordAiPrepaidFundingParams {
            account_id: account,
            request_key: key.into(),
            source_reference: key.into(),
            units,
            original_entry_id: original,
        },
    )
}
fn account_id(ctx: &ReducerContext, f: &Fixture) -> Result<u64, String> {
    ctx.db
        .ai_prepaid_account()
        .pool_key()
        .find(&format!("{}:{}", f.org, f.agent))
        .map(|a| a.id)
        .ok_or("account missing".into())
}

pub fn test_owner_wildcard_cannot_fund(ctx: &ReducerContext) -> Result<(), String> {
    let f = seed(ctx)?;
    let profile =
        find_user_profile_for_organization(ctx, ctx.sender(), f.org).ok_or("profile missing")?;
    let profile_id = profile.id;
    let was_superuser = profile.is_superuser;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: false,
        ..profile
    });
    // The actual owner permission resolves broadly; a dedicated binding is still mandatory.
    let wildcard = check_permission(ctx, f.org, "ai_credit", "fund");
    let result = create_ai_prepaid_account(ctx, f.org, f.agent, "USD".into());
    let profile = ctx
        .db
        .user_profile()
        .id()
        .find(&profile_id)
        .ok_or("profile missing after check")?;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: was_superuser,
        ..profile
    });
    wildcard?;
    if result.is_ok()
        || ctx
            .db
            .ai_prepaid_account()
            .pool_key()
            .find(&format!("{}:{}", f.org, f.agent))
            .is_some()
    {
        return Err("owner minted a prepaid account without funding binding".into());
    }
    bind_funder(ctx, &f);
    create_ai_prepaid_account(ctx, f.org, f.agent, "USD".into())?;
    let account = account_id(ctx, &f)?;
    // Remove the binding to exercise the FUND reducer too, not just creation.
    let binding = ctx
        .db
        .cold_tier_service_identity()
        .platform_id()
        .find(&format!("prepaid-test-funder-{}", f.org))
        .ok_or("binding missing")?;
    ctx.db
        .cold_tier_service_identity()
        .platform_id()
        .update(ColdTierServiceIdentity {
            is_active: false,
            ..binding.clone()
        });
    let result = funding(ctx, &f, account, "untrusted-grant", 10, None);
    ctx.db
        .cold_tier_service_identity()
        .platform_id()
        .update(binding);
    if result.is_ok() {
        return Err("unbound owner funded prepaid credits".into());
    }
    Ok(())
}

pub fn test_prepaid_cutover_and_settlement(ctx: &ReducerContext) -> Result<(), String> {
    let f = seed(ctx)?;
    // Legacy admission is unchanged before explicit opt-in.
    let sponsored = reserve(ctx, &f, "sponsored", 20)?;
    settle_ai_spend(
        ctx,
        f.org,
        SettleAiSpendParams {
            reservation_id: sponsored,
            input_tokens: 0,
            output_tokens: 10,
        },
    )?;
    let hold = reserve(ctx, &f, "precutover-hold", 40)?;
    bind_funder(ctx, &f);
    create_ai_prepaid_account(ctx, f.org, f.agent, "USD".into())?;
    let account = account_id(ctx, &f)?;
    funding(ctx, &f, account, "approved-grant", 30, None)?;
    if enable_ai_prepaid_account(ctx, f.org, account).is_ok() {
        return Err("cutover ignored outstanding holds".into());
    }
    funding(ctx, &f, account, "additional-grant", 20, None)?;
    enable_ai_prepaid_account(ctx, f.org, account)?;
    if reserve(ctx, &f, "too-large", 11).is_ok() {
        return Err("credit exhaustion did not block reservation".into());
    }
    settle_ai_spend(
        ctx,
        f.org,
        SettleAiSpendParams {
            reservation_id: hold,
            input_tokens: 0,
            output_tokens: 20,
        },
    )?;
    // Sponsored spend is excluded once; a replay cannot reset the opening baseline.
    enable_ai_prepaid_account(ctx, f.org, account)?;
    settle_ai_spend(
        ctx,
        f.org,
        SettleAiSpendParams {
            reservation_id: hold,
            input_tokens: 0,
            output_tokens: 20,
        },
    )?;
    let next = reserve(ctx, &f, "new-hold", 30)?;
    let grant = ctx
        .db
        .ai_prepaid_funding_entry()
        .operation_key()
        .find(&format!("{}:approved-grant", f.org))
        .ok_or("grant missing")?;
    funding(ctx, &f, account, "refund", 30, Some(grant.id))?;
    if reserve(ctx, &f, "after-reversal", 1).is_ok() {
        return Err("reversal deficit permitted another call".into());
    }
    // Previously committed provider work can settle despite a later funding reversal.
    settle_ai_spend(
        ctx,
        f.org,
        SettleAiSpendParams {
            reservation_id: next,
            input_tokens: 0,
            output_tokens: 10,
        },
    )?;
    if reserve(ctx, &f, "after-settlement", 1).is_ok() {
        return Err("settlement erased prepaid deficit".into());
    }
    let saved = ctx
        .db
        .ai_prepaid_account()
        .id()
        .find(&account)
        .ok_or("account missing")?;
    if saved.opening_settled_units != 10 {
        return Err("cutover replay changed baseline".into());
    }
    let budget = ctx
        .db
        .ai_spend_budget()
        .ai_spend_budget_by_agent_period()
        .filter((f.agent, &f.period))
        .next()
        .ok_or("budget missing")?;
    if budget.limit_units != 1000 || budget.settled_units != 40 {
        return Err("funding changed monthly cap or usage".into());
    }
    Ok(())
}

pub fn test_funding_identity_and_reversal_bounds(ctx: &ReducerContext) -> Result<(), String> {
    let f = seed(ctx)?;
    bind_funder(ctx, &f);
    create_ai_prepaid_account(ctx, f.org, f.agent, "USD".into())?;
    let account = account_id(ctx, &f)?;
    funding(ctx, &f, account, "grant-once", 100, None)?;
    funding(ctx, &f, account, "grant-once", 100, None)?;
    if ctx
        .db
        .ai_prepaid_funding_entry()
        .ai_prepaid_funding_by_account()
        .filter(&account)
        .count()
        != 1
    {
        return Err("grant replay duplicated funds".into());
    }
    if funding(ctx, &f, account, "grant-once", 101, None).is_ok() {
        return Err("conflicting funding replay succeeded".into());
    }
    let grant = ctx
        .db
        .ai_prepaid_funding_entry()
        .operation_key()
        .find(&format!("{}:grant-once", f.org))
        .ok_or("grant missing")?;
    funding(ctx, &f, account, "reversal-one", 60, Some(grant.id))?;
    funding(ctx, &f, account, "reversal-one", 60, Some(grant.id))?;
    if funding(ctx, &f, account, "over-reversal", 41, Some(grant.id)).is_ok() {
        return Err("reversals exceeded original grant".into());
    }
    let foreign = seed(ctx)?;
    bind_funder(ctx, &foreign);
    create_ai_prepaid_account(ctx, foreign.org, foreign.agent, "USD".into())?;
    let other = account_id(ctx, &foreign)?;
    if funding(ctx, &f, other, "foreign-account", 10, None).is_ok() {
        return Err("foreign credit account was funded".into());
    }
    if funding(ctx, &foreign, other, "foreign-reversal", 1, Some(grant.id)).is_ok() {
        return Err("foreign grant was reversed".into());
    }
    Ok(())
}

pub fn test_old_month_holds_and_release(ctx: &ReducerContext) -> Result<(), String> {
    let f = seed(ctx)?;
    let reservation = reserve(ctx, &f, "old-period-hold", 80)?;
    let old = ctx
        .db
        .ai_spend_reservation()
        .id()
        .find(&reservation)
        .ok_or("hold missing")?;
    // Represent a real persisted hold left from a prior period; no new past-period
    // reservation is admitted. Current-period validation stays in reserve_ai_spend.
    let prior_period = if f.period == "2001-01" {
        "2000-01"
    } else {
        "2001-01"
    };
    ctx.db
        .ai_spend_reservation()
        .id()
        .update(AiSpendReservation {
            billing_period: prior_period.into(),
            ..old
        });
    let current = ctx
        .db
        .ai_spend_budget()
        .ai_spend_budget_by_agent_period()
        .filter((f.agent, &f.period))
        .next()
        .ok_or("current budget missing")?;
    ctx.db.ai_spend_budget().id().update(AiSpendBudget {
        outstanding_units: 0,
        ..current
    });
    ctx.db.ai_spend_budget().insert(AiSpendBudget {
        id: 0,
        organization_id: f.org,
        agent_id: f.agent,
        billing_period: prior_period.into(),
        currency: "USD".into(),
        limit_units: 1000,
        settled_units: 0,
        outstanding_units: 80,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });
    bind_funder(ctx, &f);
    create_ai_prepaid_account(ctx, f.org, f.agent, "USD".into())?;
    let account = account_id(ctx, &f)?;
    funding(ctx, &f, account, "old-period-funding", 100, None)?;
    enable_ai_prepaid_account(ctx, f.org, account)?;
    if reserve(ctx, &f, "new-month-too-large", 21).is_ok() {
        return Err("new month erased an older credit hold".into());
    }
    accept_ai_provider_attempt(
        ctx,
        f.org,
        AcceptAiProviderAttemptParams {
            company_id: f.company,
            agent_id: f.agent,
            run_id: f.run,
            reservation_id: reservation,
            request_key: "old-period-hold".into(),
            provider: "mistral".into(),
            model: "prepaid-test".into(),
        },
    )?;
    let attempt = ctx
        .db
        .ai_provider_attempt()
        .ai_provider_attempt_by_request()
        .filter((f.org, &"old-period-hold".to_string()))
        .next()
        .ok_or("accepted attempt missing")?;
    let recovery = RecoverAiProviderAttemptParams {
        attempt_id: attempt.id,
        action: "abandon_accepted".into(),
        resolution: "isolated test proves no provider dispatch".into(),
        actor_identity: ctx.sender().to_hex().to_string(),
        approval_id: "test-release".into(),
    };
    recover_ai_provider_attempt(ctx, f.org, recovery.clone())?;
    recover_ai_provider_attempt(ctx, f.org, recovery)?;
    let after = reserve(ctx, &f, "after-proven-release", 100)?;
    settle_ai_spend(
        ctx,
        f.org,
        SettleAiSpendParams {
            reservation_id: after,
            input_tokens: 0,
            output_tokens: 30,
        },
    )?;
    settle_ai_spend(
        ctx,
        f.org,
        SettleAiSpendParams {
            reservation_id: after,
            input_tokens: 0,
            output_tokens: 30,
        },
    )?;
    // Exact settlement replay leaves70credit, not40 from a duplicate debit.
    reserve(ctx, &f, "remaining-after-replay", 70)?;
    if reserve(ctx, &f, "overspend-after-replay", 1).is_ok() {
        return Err("settled replay or release corrupted headroom".into());
    }
    Ok(())
}

/// Actual combined owner-limit + prepaid reservation reducers. Raising a cap
/// never funds the pool or removes a hold, even when that cap exceeds sponsorship.
pub fn test_prepaid_owner_limit_does_not_mint_credit(ctx: &ReducerContext) -> Result<(), String> {
    use crate::ai::owner_configuration::{
        ai_owner_configuration, set_ai_owner_limit, SetAiOwnerLimitParams,
    };
    let f = seed(ctx)?;
    let budget = ctx
        .db
        .ai_spend_budget()
        .ai_spend_budget_by_agent_period()
        .filter((f.agent, &f.period))
        .next()
        .ok_or("budget missing")?;
    let prices_before = ctx
        .db
        .ai_price_snapshot()
        .ai_price_snapshot_by_agent()
        .filter(&f.agent)
        .count();
    let mut edit = SetAiOwnerLimitParams {
        budget_id: budget.id,
        expected_revision: 0,
        expected_limit_units: 1000,
        limit_units: 2000,
        request_key: "prepaid-owner-cap".into(),
        reason: "Raise the monthly cap without adding funds".into(),
    };
    if set_ai_owner_limit(ctx, f.org, f.agent, edit.clone()).is_ok() {
        return Err("legacy owner increased the approved sponsored ceiling".into());
    }
    bind_funder(ctx, &f);
    create_ai_prepaid_account(ctx, f.org, f.agent, "USD".into())?;
    let account = account_id(ctx, &f)?;
    funding(ctx, &f, account, "approved-owner-limit-grant", 50, None)?;
    if set_ai_owner_limit(ctx, f.org, f.agent, edit.clone()).is_ok() {
        return Err("funding a disabled account bypassed the sponsored ceiling".into());
    }
    enable_ai_prepaid_account(ctx, f.org, account)?;
    set_ai_owner_limit(ctx, f.org, f.agent, edit.clone())?;
    set_ai_owner_limit(ctx, f.org, f.agent, edit.clone())?;
    let config = ctx
        .db
        .ai_owner_configuration()
        .agent_id()
        .find(f.agent)
        .ok_or("configuration missing")?;
    if config.monthly_limit_units != 2000
        || config.sponsored_ceiling_units != 1000
        || config.revision != 1
    {
        return Err("prepaid cap edit changed sponsorship or replay advanced revision".into());
    }
    if reserve(ctx, &f, "over-funded-credit", 51).is_ok() {
        return Err("raised owner cap minted spendable credit".into());
    }
    let hold = reserve(ctx, &f, "prepaid-owner-hold", 40)?;
    edit.expected_revision = 1;
    edit.expected_limit_units = 2000;
    edit.limit_units = 3000;
    edit.request_key = "prepaid-owner-cap-with-hold".into();
    set_ai_owner_limit(ctx, f.org, f.agent, edit)?;
    if reserve(ctx, &f, "over-remaining-credit", 11).is_ok() {
        return Err("cap edit erased an existing prepaid hold".into());
    }
    let committed = ctx
        .db
        .ai_spend_budget()
        .id()
        .find(budget.id)
        .ok_or("budget missing")?;
    if committed.limit_units != 3000
        || committed.outstanding_units != 40
        || committed.settled_units != 0
    {
        return Err("owner cap edit changed usage or holds".into());
    }
    settle_ai_spend(
        ctx,
        f.org,
        SettleAiSpendParams {
            reservation_id: hold,
            input_tokens: 0,
            output_tokens: 20,
        },
    )?;
    if reserve(ctx, &f, "over-credit-after-settlement", 31).is_ok() {
        return Err("settlement lost the prepaid debit".into());
    }
    reserve(ctx, &f, "exact-remaining-credit", 30)?;
    let entries = ctx
        .db
        .ai_prepaid_funding_entry()
        .ai_prepaid_funding_by_account()
        .filter(&account)
        .collect::<Vec<_>>();
    if entries.len() != 1
        || entries[0].units != 50
        || ctx
            .db
            .ai_price_snapshot()
            .ai_price_snapshot_by_agent()
            .filter(&f.agent)
            .count()
            != prices_before
    {
        return Err("owner limit edit changed funding or provider prices".into());
    }
    Ok(())
}
