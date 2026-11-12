//! Native database tests, registered in the existing AI suite. No provider calls.
use crate::ai::agents::ai_agent;
use crate::ai::owner_configuration::*;
use crate::ai::skills::ai_agent_run;
use crate::ai::spend::{
    ai_price_snapshot, ai_spend_budget, configure_ai_spend, ConfigureAiSpendParams,
};
use crate::core::permissions::{role, Role};
use crate::core::users::{
    find_user_profile_for_organization, user_organization, user_profile, UserProfile,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use spacetimedb::{ReducerContext, Table};

pub fn test_agent_action_preserves_configuration(ctx: &ReducerContext) -> Result<(), String> {
    use crate::ai::agents::{
        check_ai_agent_activation, set_ai_agent_action, set_ai_agent_model, AiAgent,
    };
    use crate::core::audit::audit_log;
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let run_id = super::decision_events_test::seed_run(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        &format!("action-toggle-{}", fixture.organization_id),
    )?;
    let run = ctx
        .db
        .ai_agent_run()
        .id()
        .find(run_id)
        .ok_or("run missing")?;
    let agent_id = run.agent_id;
    let original = ctx
        .db
        .ai_agent()
        .id()
        .find(agent_id)
        .ok_or("agent missing")?;
    let original = ctx.db.ai_agent().id().update(AiAgent {
        provider: "Mistral".into(),
        model: "mistral-small-2506".into(),
        allowed_models: vec!["mistral-small-2506".into()],
        system_prompt: Some("Keep this private prompt".into()),
        monthly_budget: Some(42.0),
        allowed_actions: vec!["analytics_read".into()],
        ..original
    });
    // Seed real paid-admission rows before editing capabilities, without provider I/O.
    use crate::ai::metered_spend::*;
    use crate::ai::spend::{ai_provider_attempt, ai_spend_reservation};
    ctx.db.ai_agent().id().update(AiAgent {
        allowed_models: vec![original.model.clone(), "mistral-embed".into()],
        ..original.clone()
    });
    configure_ai_spend(
        ctx,
        fixture.organization_id,
        agent_id,
        ConfigureAiSpendParams {
            billing_period: current_period(ctx.timestamp)?,
            currency: "USD".into(),
            limit_units: 10_000,
            provider: "mistral".into(),
            model: "mistral-embed".into(),
            input_units_per_1k: 1_000,
            output_units_per_1k: 1_000,
        },
    )?;
    configure_ai_metered_price(
        ctx,
        fixture.organization_id,
        agent_id,
        ConfigureAiMeteredPriceParams {
            model: "mistral-embed".into(),
            unit: "tokens".into(),
            currency: "USD".into(),
            units_per_1k: 1_000,
        },
    )?;
    use crate::core::cold_tier_identity::{cold_tier_service_identity, ColdTierServiceIdentity};
    let writer_key = format!("toggle-history-writer-{agent_id}");
    ctx.db
        .cold_tier_service_identity()
        .insert(ColdTierServiceIdentity {
            platform_id: writer_key.clone(),
            organization_id: fixture.organization_id,
            service_name: "ai_spend_writer".into(),
            identity: ctx.sender(),
            is_active: true,
            registered_by: ctx.sender(),
            registered_at: ctx.timestamp,
            retired_at: None,
        });
    reserve_ai_metered_spend(
        ctx,
        fixture.organization_id,
        ReserveAiMeteredSpendParams {
            company_id: fixture.company_id,
            agent_id,
            run_id,
            actor_identity: ctx.sender().to_hex().to_string(),
            request_key: format!("toggle:history:{agent_id}"),
            model: "mistral-embed".into(),
            unit: "tokens".into(),
            allowance: 17,
        },
    )?;
    let reservation = ctx
        .db
        .ai_spend_reservation()
        .iter()
        .find(|row| {
            row.organization_id == fixture.organization_id
                && row.request_key == format!("toggle:history:{agent_id}")
        })
        .ok_or("history reservation missing")?;
    crate::ai::spend::accept_ai_provider_attempt(
        ctx,
        fixture.organization_id,
        crate::ai::spend::AcceptAiProviderAttemptParams {
            company_id: fixture.company_id,
            agent_id,
            run_id,
            reservation_id: reservation.id,
            request_key: reservation.request_key,
            provider: "mistral".into(),
            model: "mistral-embed".into(),
        },
    )?;
    ctx.db
        .cold_tier_service_identity()
        .platform_id()
        .delete(writer_key);
    ctx.db.ai_agent().id().update(original.clone());
    // Compare complete encoded rows, including attribution, counters and timestamps.
    // Nonempty admission/usage rows prove preservation, not merely unchanged counts.
    let history_snapshot = || {
        let mut rows = Vec::new();
        macro_rules! snapshot {
            ($table:ident) => {
                for row in ctx.db.$table().iter().filter(|r| r.agent_id == agent_id) {
                    rows.push(
                        spacetimedb::sats::bsatn::to_vec(&row).expect("fixture row encoding"),
                    );
                }
            };
        }
        snapshot!(ai_spend_budget);
        snapshot!(ai_price_snapshot);
        snapshot!(ai_spend_reservation);
        snapshot!(ai_provider_attempt);
        snapshot!(ai_metered_price);
        snapshot!(ai_metered_usage);
        snapshot!(ai_agent_run);
        rows.sort();
        rows
    };
    let before_history = history_snapshot();
    if before_history.len() != 7 {
        return Err("Expected nonempty budget, prices, reservation, attempt, usage and run".into());
    }
    let audit_count = ctx.db.audit_log().iter().count();
    check_ai_agent_activation(ctx, fixture.organization_id, agent_id, true)?;
    check_ai_agent_activation(ctx, fixture.organization_id, agent_id, true)?;
    if before_history != history_snapshot() || ctx.db.audit_log().iter().count() != audit_count {
        return Err("Activation authority probe changed application history".into());
    }
    // Remove platform bypass as well as the tenant profile bypass.
    let profiles = ctx
        .db
        .user_profile()
        .iter()
        .filter(|p| p.identity == ctx.sender())
        .collect::<Vec<_>>();
    let profile_authority = profiles
        .iter()
        .map(|p| (p.id, p.is_superuser))
        .collect::<Vec<_>>();
    for profile in profiles {
        ctx.db.user_profile().id().update(UserProfile {
            is_superuser: false,
            ..profile
        });
    }
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(ctx.sender())
        .find(|m| m.organization_id == fixture.organization_id && m.is_active)
        .ok_or("membership missing")?;
    let assigned = ctx
        .db
        .role()
        .id()
        .find(membership.role_id)
        .ok_or("role missing")?;
    let editor = ctx.db.role().id().update(Role {
        permissions: vec!["ai_agent:write".into()],
        ..assigned.clone()
    });
    if check_ai_agent_activation(ctx, fixture.organization_id, agent_id, false).is_ok() {
        return Err("Activation probe ignored missing skill binding authority".into());
    }
    ctx.db.role().id().update(Role {
        permissions: vec!["ai_agent:write".into(), "ai_skill:write".into()],
        ..editor.clone()
    });
    check_ai_agent_activation(ctx, fixture.organization_id, agent_id, false)?;
    if check_ai_agent_activation(ctx, fixture.organization_id, agent_id, true).is_ok() {
        return Err("Activation probe granted platform pricing to an ordinary editor".into());
    }
    ctx.db.role().id().update(editor.clone());
    let audits = || {
        ctx.db
            .audit_log()
            .audit_by_org()
            .filter(fixture.organization_id)
            .filter(|a| {
                a.table_name == "ai_agent"
                    && a.record_id == agent_id
                    && a.changed_fields == vec!["allowed_models".to_string()]
            })
            .collect::<Vec<_>>()
    };
    let before_audits = audits().len();
    // Historical invalid entries can be removed exactly, but never re-enabled.
    for legacy in ["mistral-latest", "placeholder", " legacy alias ", ""] {
        let agent = ctx
            .db
            .ai_agent()
            .id()
            .find(agent_id)
            .ok_or("agent missing")?;
        let mut allowed_models = agent.allowed_models.clone();
        allowed_models.push(legacy.into());
        ctx.db.ai_agent().id().update(AiAgent {
            allowed_models,
            ..agent
        });
        set_ai_agent_model(ctx, fixture.organization_id, agent_id, legacy.into(), false)?;
        set_ai_agent_model(ctx, fixture.organization_id, agent_id, legacy.into(), false)?;
        if set_ai_agent_model(ctx, fixture.organization_id, agent_id, legacy.into(), true).is_ok() {
            return Err("Historical invalid model was re-enabled".into());
        }
    }
    let before_audits = before_audits + 4;
    for _ in 0..2 {
        set_ai_agent_model(
            ctx,
            fixture.organization_id,
            agent_id,
            "mistral-embed".into(),
            true,
        )?;
    }
    let added = ctx
        .db
        .ai_agent()
        .id()
        .find(agent_id)
        .ok_or("agent missing")?;
    if added.allowed_models != vec!["mistral-small-2506", "mistral-embed"]
        || audits().len() != before_audits + 1
    {
        return Err("Model addition was not exact, audited and idempotent".into());
    }
    for invalid in [
        "",
        "*",
        "mistral-latest",
        "rolling",
        "placeholder",
        "mistral-embed\n",
        "x;DROP",
        "gpt-4o",
    ] {
        if set_ai_agent_model(ctx, fixture.organization_id, agent_id, invalid.into(), true).is_ok()
        {
            return Err(format!("Invalid/incompatible model accepted: {invalid:?}"));
        }
    }
    if set_ai_agent_model(
        ctx,
        foreign.organization_id,
        agent_id,
        "mistral-embed".into(),
        false,
    )
    .is_ok()
        || set_ai_agent_model(
            ctx,
            fixture.organization_id,
            agent_id,
            original.model.clone(),
            false,
        )
        .is_ok()
    {
        return Err("Foreign organization or selected-model removal accepted".into());
    }
    // Inactive callers cannot mutate even when their role otherwise grants write.
    let profile = find_user_profile_for_organization(ctx, ctx.sender(), fixture.organization_id)
        .ok_or("profile missing")?;
    let profile_id = profile.id;
    let was_active = profile.is_active;
    ctx.db.user_profile().id().update(UserProfile {
        is_active: false,
        ..profile
    });
    let denied = set_ai_agent_model(
        ctx,
        fixture.organization_id,
        agent_id,
        "mistral-embed".into(),
        false,
    );
    let profile = ctx
        .db
        .user_profile()
        .id()
        .find(profile_id)
        .ok_or("profile missing")?;
    ctx.db.user_profile().id().update(UserProfile {
        is_active: was_active,
        ..profile
    });
    if denied.is_ok() {
        return Err("Unauthorized model removal accepted".into());
    }
    ctx.db.role().id().update(Role {
        permissions: vec![],
        ..editor.clone()
    });
    let no_permission_model = set_ai_agent_model(
        ctx,
        fixture.organization_id,
        agent_id,
        "mistral-embed".into(),
        false,
    );
    let no_permission_action = set_ai_agent_action(
        ctx,
        fixture.organization_id,
        agent_id,
        "embedding_query".into(),
        true,
    );
    // An expired additive grant cannot rescue the active role with no permissions.
    use crate::core::permissions::{user_role_assignment, UserRoleAssignment};
    let expired_role = ctx.db.role().insert(Role {
        id: 0,
        ..editor.clone()
    });
    let expired = ctx.db.user_role_assignment().insert(UserRoleAssignment {
        id: 0,
        user_identity: ctx.sender(),
        role_id: expired_role.id,
        organization_id: fixture.organization_id,
        assigned_by: ctx.sender(),
        assigned_at: ctx.timestamp,
        expires_at: Some(ctx.timestamp),
        is_active: true,
        metadata: None,
    });
    let expired_model = set_ai_agent_model(
        ctx,
        fixture.organization_id,
        agent_id,
        "mistral-embed".into(),
        false,
    );
    let expired_action = set_ai_agent_action(
        ctx,
        fixture.organization_id,
        agent_id,
        "embedding_query".into(),
        true,
    );
    ctx.db.user_role_assignment().id().delete(expired.id);
    ctx.db.role().id().delete(expired_role.id);
    ctx.db.role().id().update(editor);
    if no_permission_model.is_ok()
        || no_permission_action.is_ok()
        || expired_model.is_ok()
        || expired_action.is_ok()
    {
        return Err("Unprivileged or expired role changed capabilities".into());
    }
    use crate::core::permissions::{delegated_admin_scope, DelegatedAdminScope};
    let delegated = ctx.db.delegated_admin_scope().insert(DelegatedAdminScope {
        id: 0,
        organization_id: fixture.organization_id,
        company_id: foreign.company_id,
        user_identity: ctx.sender(),
        granted_by: ctx.sender(),
        granted_at: ctx.timestamp,
        is_active: true,
        metadata: None,
    });
    let denied = set_ai_agent_model(
        ctx,
        fixture.organization_id,
        agent_id,
        "mistral-embed".into(),
        false,
    );
    let action_denied = set_ai_agent_action(
        ctx,
        fixture.organization_id,
        agent_id,
        "embedding_query".into(),
        true,
    );
    ctx.db.delegated_admin_scope().id().delete(delegated.id);
    if denied.is_ok() || action_denied.is_ok() {
        return Err("Cross-company capability edit accepted".into());
    }
    for _ in 0..2 {
        set_ai_agent_model(
            ctx,
            fixture.organization_id,
            agent_id,
            "mistral-embed".into(),
            false,
        )?;
    }
    let restored = ctx
        .db
        .ai_agent()
        .id()
        .find(agent_id)
        .ok_or("agent missing")?;
    if restored.allowed_models != original.allowed_models
        || audits().len() != before_audits + 2
        || audits().iter().skip(before_audits).any(|a| {
            a.company_id != original.company_id
                || a.user_identity != ctx.sender()
                || a.old_values.is_none()
                || a.new_values.is_none()
        })
    {
        return Err("Model removal/no-op or audit preservation failed".into());
    }
    for action in ["embedding_query", "embedding_index"] {
        set_ai_agent_action(ctx, fixture.organization_id, agent_id, action.into(), true)?;
        let saved = ctx
            .db
            .ai_agent()
            .id()
            .find(agent_id)
            .ok_or("agent missing")?;
        if !saved.allowed_actions.iter().any(|a| a == action) {
            return Err("Embedding action not persisted".into());
        }
        set_ai_agent_action(ctx, fixture.organization_id, agent_id, action.into(), false)?;
    }
    for _ in 0..2 {
        set_ai_agent_action(ctx, fixture.organization_id, agent_id, "chat".into(), true)?;
    }
    let enabled = ctx
        .db
        .ai_agent()
        .id()
        .find(agent_id)
        .ok_or("agent missing")?;
    if enabled.allowed_actions != vec!["analytics_read", "chat"] {
        return Err("Action toggle lost another binding or duplicated a retry".into());
    }
    if set_ai_agent_action(ctx, foreign.organization_id, agent_id, "chat".into(), false).is_ok()
        || set_ai_agent_action(
            ctx,
            fixture.organization_id,
            agent_id,
            "unknown".into(),
            true,
        )
        .is_ok()
    {
        return Err("Action toggle accepted a foreign organization or unknown action".into());
    }
    set_ai_agent_action(ctx, fixture.organization_id, agent_id, "chat".into(), false)?;
    let saved = ctx
        .db
        .ai_agent()
        .id()
        .find(agent_id)
        .ok_or("agent missing")?;
    if saved.allowed_actions != original.allowed_actions
        || saved.system_prompt != original.system_prompt
        || saved.monthly_budget != original.monthly_budget
        || saved.rate_limit_per_minute != original.rate_limit_per_minute
        || saved.temperature != original.temperature
        || saved.max_tokens != original.max_tokens
        || saved.is_default != original.is_default
        || saved.is_active != original.is_active
        || saved.provider != original.provider
        || saved.model != original.model
        || saved.allowed_models != original.allowed_models
        || saved.company_id != original.company_id
        || saved.monthly_spend != original.monthly_spend
        || saved.create_uid != original.create_uid
        || saved.create_date != original.create_date
        || saved.metadata != original.metadata
        || saved.api_key_reference != original.api_key_reference
        || saved.context_window != original.context_window
        || saved.top_p != original.top_p
        || saved.frequency_penalty != original.frequency_penalty
        || saved.presence_penalty != original.presence_penalty
        || saved.cost_per_1k_tokens != original.cost_per_1k_tokens
    {
        return Err("Action toggle changed unrelated agent configuration".into());
    }
    let history = ctx
        .db
        .ai_agent_run()
        .id()
        .find(run_id)
        .ok_or("history removed")?;
    if history.agent_id != run.agent_id
        || history.company_id != run.company_id
        || history_snapshot() != before_history
    {
        return Err("Capability repair changed run history".into());
    }
    ctx.db.role().id().update(assigned);
    for (id, is_superuser) in profile_authority {
        let profile = ctx
            .db
            .user_profile()
            .id()
            .find(id)
            .ok_or("profile missing")?;
        ctx.db.user_profile().id().update(UserProfile {
            is_superuser,
            ..profile
        });
    }
    Ok(())
}

pub fn test_owner_configuration(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let local = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let run_id = super::decision_events_test::seed_run(
        ctx,
        local.organization_id,
        local.company_id,
        &format!("owner-config-{}", local.organization_id),
    )?;
    let run = ctx
        .db
        .ai_agent_run()
        .id()
        .find(run_id)
        .ok_or("fixture run missing")?;
    let agent_id = run.agent_id;
    let period = current_period(ctx.timestamp)?;
    configure_ai_spend(
        ctx,
        local.organization_id,
        agent_id,
        ConfigureAiSpendParams {
            billing_period: period.clone(),
            currency: "USD".into(),
            limit_units: 10_000_000,
            provider: "mistral".into(),
            model: "mistral-large-latest".into(),
            input_units_per_1k: 100,
            output_units_per_1k: 200,
        },
    )?;
    let rows = ctx
        .db
        .ai_spend_budget()
        .ai_spend_budget_by_agent_period()
        .filter((&agent_id, &period))
        .collect::<Vec<_>>();
    let [budget] = rows.as_slice() else {
        return Err("fixture budget not unique".into());
    };
    let original_prices = ctx
        .db
        .ai_price_snapshot()
        .ai_price_snapshot_by_agent()
        .filter(&agent_id)
        .count();
    let limit = SetAiOwnerLimitParams {
        budget_id: budget.id,
        expected_revision: 0,
        expected_limit_units: 10_000_000,
        limit_units: 5_000_000,
        request_key: format!("owner-limit-{}", agent_id),
        reason: "Owner approval: shared monthly limit".into(),
    };
    set_ai_owner_limit(ctx, local.organization_id, agent_id, limit.clone())?;
    set_ai_owner_limit(ctx, local.organization_id, agent_id, limit.clone())?;
    let saved = ctx
        .db
        .ai_spend_budget()
        .id()
        .find(budget.id)
        .ok_or("saved budget missing")?;
    let cfg = ctx
        .db
        .ai_owner_configuration()
        .agent_id()
        .find(agent_id)
        .ok_or("configuration missing")?;
    if saved.limit_units != 5_000_000
        || cfg.revision != 1
        || saved.settled_units != budget.settled_units
        || saved.outstanding_units != budget.outstanding_units
        || ctx
            .db
            .ai_price_snapshot()
            .ai_price_snapshot_by_agent()
            .filter(&agent_id)
            .count()
            != original_prices
    {
        return Err("limit update changed prices/usage or replay advanced revision".into());
    }
    if ctx
        .db
        .ai_owner_configuration_receipt()
        .ai_owner_configuration_receipt_by_key()
        .filter((local.organization_id, &limit.request_key))
        .count()
        != 1
    {
        return Err("replay created duplicate receipt".into());
    }
    let mut conflict = limit.clone();
    conflict.limit_units = 20_000_000;
    if set_ai_owner_limit(ctx, local.organization_id, agent_id, conflict).is_ok() {
        return Err("same request key accepted a different payload".into());
    }
    let mut stale = limit.clone();
    stale.request_key.push_str("-stale");
    if set_ai_owner_limit(ctx, local.organization_id, agent_id, stale).is_ok() {
        return Err("stale expected revision accepted".into());
    }
    let share = ShareAiOwnerAgentParams {
        budget_id: budget.id,
        expected_revision: 1,
        expected_company_id: local.company_id,
        request_key: format!("owner-share-{}", agent_id),
        reason: "Share the existing pool".into(),
    };
    share_ai_owner_agent(ctx, local.organization_id, agent_id, share.clone())?;
    share_ai_owner_agent(ctx, local.organization_id, agent_id, share.clone())?;
    if ctx
        .db
        .ai_agent()
        .id()
        .find(agent_id)
        .ok_or("agent missing")?
        .company_id
        .is_some()
        || ctx
            .db
            .ai_agent_run()
            .id()
            .find(run_id)
            .ok_or("run missing")?
            .company_id
            != local.company_id
        || ctx
            .db
            .ai_spend_budget()
            .id()
            .find(budget.id)
            .ok_or("budget missing")?
            .agent_id
            != agent_id
    {
        return Err("scope update changed run attribution or ledger identity".into());
    }
    if share_ai_owner_agent(ctx, foreign.organization_id, agent_id, share).is_ok() {
        return Err("cross-organization agent scope change accepted".into());
    }
    let mut below = limit.clone();
    below.request_key.push_str("-below");
    below.expected_revision = 2;
    below.expected_limit_units = 5_000_000;
    below.limit_units = 99;
    let before_floor = ctx
        .db
        .ai_spend_budget()
        .id()
        .find(budget.id)
        .ok_or("budget missing")?;
    ctx.db
        .ai_spend_budget()
        .id()
        .update(crate::ai::spend::AiSpendBudget {
            settled_units: 60,
            outstanding_units: 40,
            ..before_floor.clone()
        });
    let floor_result = set_ai_owner_limit(ctx, local.organization_id, agent_id, below);
    let after_floor = ctx
        .db
        .ai_spend_budget()
        .id()
        .find(budget.id)
        .ok_or("budget missing")?;
    if floor_result.is_ok()
        || after_floor.limit_units != 5_000_000
        || after_floor.settled_units != 60
        || after_floor.outstanding_units != 40
    {
        return Err("committed-spend floor failed or rejection changed counters".into());
    }
    // Ordinary agent editors are not organization administrators.
    let profile = find_user_profile_for_organization(ctx, ctx.sender(), local.organization_id)
        .ok_or("profile missing")?;
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|m| m.organization_id == local.organization_id && m.is_active)
        .ok_or("membership missing")?;
    let assigned = ctx
        .db
        .role()
        .id()
        .find(membership.role_id)
        .ok_or("role missing")?;
    let profile_id = profile.id;
    let was_superuser = profile.is_superuser;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: false,
        ..profile
    });
    ctx.db.role().id().update(Role {
        permissions: vec!["ai_agent:write".into()],
        ..assigned.clone()
    });
    let mut unauthorized = limit.clone();
    unauthorized.request_key.push_str("-unauthorized");
    unauthorized.expected_revision = 2;
    unauthorized.expected_limit_units = 5_000_000;
    let denied = set_ai_owner_limit(ctx, local.organization_id, agent_id, unauthorized);
    ctx.db.role().id().update(assigned);
    let restored = ctx
        .db
        .user_profile()
        .id()
        .find(profile_id)
        .ok_or("profile missing")?;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: was_superuser,
        ..restored
    });
    if denied.is_ok() {
        return Err("ordinary agent editor changed a spending limit".into());
    }
    let active = find_user_profile_for_organization(ctx, ctx.sender(), local.organization_id)
        .ok_or("profile missing")?;
    let active_id = active.id;
    let was_active = active.is_active;
    ctx.db.user_profile().id().update(UserProfile {
        is_active: false,
        ..active
    });
    let mut inactive_request = limit.clone();
    inactive_request.request_key.push_str("-inactive");
    inactive_request.expected_revision = 2;
    inactive_request.expected_limit_units = 5_000_000;
    let inactive = set_ai_owner_limit(ctx, local.organization_id, agent_id, inactive_request);
    let restored = ctx
        .db
        .user_profile()
        .id()
        .find(active_id)
        .ok_or("profile missing")?;
    ctx.db.user_profile().id().update(UserProfile {
        is_active: was_active,
        ..restored
    });
    if inactive.is_ok() {
        return Err("inactive principal changed an allowance".into());
    }

    if ctx
        .db
        .ai_owner_configuration()
        .agent_id()
        .find(agent_id)
        .ok_or("config missing")?
        .revision
        != 2
    {
        return Err("rejected command changed configuration revision".into());
    }
    let mut unbounded = limit.clone();
    unbounded.request_key.push_str("-unbounded");
    unbounded.expected_revision = 2;
    unbounded.expected_limit_units = 5_000_000;
    unbounded.limit_units = u64::MAX;
    if set_ai_owner_limit(ctx, local.organization_id, agent_id, unbounded).is_ok() {
        return Err("owner expanded a sponsored provider-funded ceiling".into());
    }
    use crate::core::permissions::{delegated_admin_scope, DelegatedAdminScope};
    let delegated = ctx.db.delegated_admin_scope().insert(DelegatedAdminScope {
        id: 0,
        organization_id: local.organization_id,
        company_id: local.company_id,
        user_identity: ctx.sender(),
        granted_by: ctx.sender(),
        granted_at: ctx.timestamp,
        is_active: true,
        metadata: None,
    });
    let mut scoped = limit.clone();
    scoped.request_key.push_str("-delegated");
    scoped.expected_revision = 2;
    scoped.expected_limit_units = 5_000_000;
    let delegated_result = set_ai_owner_limit(ctx, local.organization_id, agent_id, scoped);
    ctx.db.delegated_admin_scope().id().delete(delegated.id);
    if delegated_result.is_ok() {
        return Err("company-delegated administrator edited an organization cap".into());
    }

    // Privileged price provisioning may not bypass the owner cap command.
    let refused = configure_ai_spend(
        ctx,
        local.organization_id,
        agent_id,
        ConfigureAiSpendParams {
            billing_period: period,
            currency: "USD".into(),
            limit_units: 20_000_000,
            provider: "mistral".into(),
            model: "mistral-large-latest".into(),
            input_units_per_1k: 100,
            output_units_per_1k: 200,
        },
    );
    if refused.is_ok()
        || ctx
            .db
            .ai_price_snapshot()
            .ai_price_snapshot_by_agent()
            .filter(&agent_id)
            .count()
            != original_prices
    {
        return Err(
            "full provisioning bypassed the owner cap or appended a price on rejection".into(),
        );
    }
    use crate::core::audit::audit_log;
    if ctx
        .db
        .audit_log()
        .audit_by_org()
        .filter(&local.organization_id)
        .filter(|a| {
            a.table_name == "ai_owner_configuration"
                && a.record_id == agent_id
                && a.user_identity == ctx.sender()
        })
        .count()
        != 2
    {
        return Err("configuration audit actor/count does not match two applied commands".into());
    }
    use crate::core::cold_tier_identity::{
        cold_tier_service_identity, ColdTierServiceIdentity, AI_SPEND_READER_SERVICE,
    };
    let reader = spacetimedb::Identity::from_byte_array([0xe1; 32]);
    let unknown = spacetimedb::Identity::from_byte_array([0xe2; 32]);
    if ai_owner_configuration_read(&spacetimedb::ViewContext::new(unknown))
        .iter()
        .any(|c| c.organization_id == local.organization_id)
    {
        return Err("unregistered reader saw owner configuration".into());
    }
    let binding = ColdTierServiceIdentity {
        platform_id: format!("owner-config-reader-{}", local.organization_id),
        organization_id: local.organization_id,
        service_name: AI_SPEND_READER_SERVICE.into(),
        identity: reader,
        is_active: true,
        registered_by: ctx.sender(),
        registered_at: ctx.timestamp,
        retired_at: None,
    };
    ctx.db.cold_tier_service_identity().insert(binding.clone());
    let view = spacetimedb::ViewContext::new(reader);
    let read = ai_owner_configuration_read(&view);
    if read.len() != 1
        || read[0].agent_id != agent_id
        || read[0].revision != 2
        || ai_owner_configuration_receipt_read(&view).len() != 2
    {
        return Err("active reader failed exact configuration/receipt readback".into());
    }
    ctx.db
        .cold_tier_service_identity()
        .platform_id()
        .update(ColdTierServiceIdentity {
            is_active: false,
            retired_at: Some(ctx.timestamp),
            ..binding
        });
    if !ai_owner_configuration_read(&view).is_empty()
        || !ai_owner_configuration_receipt_read(&view).is_empty()
    {
        return Err("retired reader retained owner configuration access".into());
    }
    let mut restore = limit.clone();
    restore.request_key.push_str("-restore");
    restore.expected_revision = 2;
    restore.expected_limit_units = 5_000_000;
    restore.limit_units = 10_000_000;
    set_ai_owner_limit(ctx, local.organization_id, agent_id, restore)?;
    if ctx
        .db
        .ai_spend_budget()
        .id()
        .find(budget.id)
        .ok_or("budget missing")?
        .limit_units
        != 10_000_000
    {
        return Err("owner could not restore its existing approved ceiling".into());
    }
    Ok(())
}

pub fn test_legacy_missing_period_and_recovery(ctx: &ReducerContext) -> Result<(), String> {
    use crate::ai::spend::{
        ai_spend_reservation, reserve_ai_spend, AiSpendReservation, ReserveAiSpendParams,
    };
    ensure_test_superuser(ctx)?;
    let scope = OrgFixture::seed_minimal(ctx)?;
    let run_id = super::decision_events_test::seed_run(
        ctx,
        scope.organization_id,
        scope.company_id,
        &format!("owner-month-boundary-{}", scope.organization_id),
    )?;
    let agent = ctx
        .db
        .ai_agent_run()
        .id()
        .find(run_id)
        .ok_or("run missing")?
        .agent_id;
    let period = current_period(ctx.timestamp)?;
    configure_ai_spend(
        ctx,
        scope.organization_id,
        agent,
        ConfigureAiSpendParams {
            billing_period: period.clone(),
            currency: "USD".into(),
            limit_units: 10_000_000,
            provider: "mistral".into(),
            model: "mistral-large-latest".into(),
            input_units_per_1k: 100,
            output_units_per_1k: 200,
        },
    )?;
    let rows = ctx
        .db
        .ai_spend_budget()
        .ai_spend_budget_by_agent_period()
        .filter((&agent, &period))
        .collect::<Vec<_>>();
    let [budget] = rows.as_slice() else {
        return Err("fixture budget not unique".into());
    };
    set_ai_owner_limit(
        ctx,
        scope.organization_id,
        agent,
        SetAiOwnerLimitParams {
            budget_id: budget.id,
            expected_revision: 0,
            expected_limit_units: 10_000_000,
            limit_units: 5_000_000,
            request_key: format!("month-policy-{}", agent),
            reason: "Owner-selected cap, not funding".into(),
        },
    )?;
    let prices = ctx
        .db
        .ai_price_snapshot()
        .ai_price_snapshot_by_agent()
        .filter(&agent)
        .collect::<Vec<_>>();
    let [price] = prices.as_slice() else {
        return Err("fixture price not unique".into());
    };
    let mut accepted = ReserveAiSpendParams {
        company_id: scope.company_id,
        agent_id: agent,
        run_id,
        request_key: format!("old-paid-request-{}", agent),
        provider: "mistral".into(),
        model: price.model.clone(),
        billing_period: period.clone(),
        currency: "USD".into(),
        price_snapshot_id: price.id,
        input_token_allowance: 1000,
        output_token_allowance: 1000,
    };
    reserve_ai_spend(ctx, scope.organization_id, accepted.clone())?;
    let held = ctx
        .db
        .ai_spend_reservation()
        .ai_spend_reservation_by_request()
        .filter((scope.organization_id, &accepted.request_key))
        .next()
        .ok_or("accepted reservation missing")?;
    // Seed the durable snapshot at a later month boundary; no clock mutation exists in production.
    let old_period = if period == "2000-01" {
        "1999-12"
    } else {
        "2000-01"
    };
    let old = ctx
        .db
        .ai_spend_budget()
        .id()
        .find(budget.id)
        .ok_or("budget missing")?;
    ctx.db
        .ai_spend_budget()
        .id()
        .update(crate::ai::spend::AiSpendBudget {
            billing_period: old_period.into(),
            settled_units: 60,
            ..old
        });
    ctx.db
        .ai_spend_reservation()
        .id()
        .update(AiSpendReservation {
            billing_period: old_period.into(),
            ..held.clone()
        });
    accepted.billing_period = old_period.into();
    let mut fresh = accepted.clone();
    fresh.billing_period = period.clone();
    fresh.request_key.push_str("-current");
    if reserve_ai_spend(ctx, scope.organization_id, fresh.clone()).is_ok()
        || ctx
            .db
            .ai_spend_budget()
            .ai_spend_budget_by_agent_period()
            .filter((&agent, &period))
            .next()
            .is_some()
    {
        return Err("owner cap minted a new sponsored monthly allowance".into());
    }
    // Mutable pool selection must not hide an accepted exact reservation.
    let original_policy = ctx
        .db
        .ai_owner_configuration()
        .agent_id()
        .find(agent)
        .ok_or("policy missing")?;
    let other_run = super::decision_events_test::seed_run(
        ctx,
        scope.organization_id,
        scope.company_id,
        &format!("next-pool-{}", scope.organization_id),
    )?;
    let other_agent = ctx
        .db
        .ai_agent_run()
        .id()
        .find(other_run)
        .ok_or("other run missing")?
        .agent_id;
    ctx.db.ai_owner_configuration().agent_id().delete(agent);
    ctx.db
        .ai_owner_configuration()
        .insert(AiOwnerConfiguration {
            agent_id: other_agent,
            ..original_policy.clone()
        });
    let recovered = reserve_ai_spend(ctx, scope.organization_id, accepted.clone());
    let rejected = reserve_ai_spend(ctx, scope.organization_id, fresh.clone());
    ctx.db
        .ai_owner_configuration()
        .agent_id()
        .delete(other_agent);
    ctx.db.ai_owner_configuration().insert(original_policy);
    if recovered.is_err() || rejected.is_ok() {
        return Err("mutable pool selection broke exact recovery or admitted a new hold".into());
    }
    let old = ctx
        .db
        .ai_spend_budget()
        .id()
        .find(budget.id)
        .ok_or("old budget removed")?;
    let reservation = ctx
        .db
        .ai_spend_reservation()
        .id()
        .find(held.id)
        .ok_or("old hold removed")?;
    if old.billing_period != old_period
        || old.settled_units != 60
        || old.outstanding_units != 300
        || reservation.billing_period != old_period
        || reservation.reserved_units != 300
        || reservation.status != "reserved"
        || ctx
            .db
            .ai_spend_reservation()
            .ai_spend_reservation_by_request()
            .filter((scope.organization_id, &accepted.request_key))
            .count()
            != 1
        || ctx
            .db
            .ai_price_snapshot()
            .ai_price_snapshot_by_agent()
            .filter(&agent)
            .count()
            != 1
    {
        return Err("month/policy change erased or duplicated prior spend or prices".into());
    }
    Ok(())
}
