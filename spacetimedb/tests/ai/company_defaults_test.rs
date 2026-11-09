//! Real reducer readback: setup preserves spend, explicit configuration and disables.
use crate::ai::agents::{ai_agent, set_ai_agent_action};
use crate::ai::company_defaults::provision_ai_company_defaults;
use crate::ai::model_configuration::*;
use crate::ai::skills::*;
use crate::ai::spend::*;
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use spacetimedb::{ReducerContext, Table};

pub fn test_company_defaults(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let company = fixture.company_id;
    let run = super::decision_events_test::seed_run(ctx, org, company, &format!("defaults-{org}"))?;
    let agent_id = ctx
        .db
        .ai_agent_run()
        .id()
        .find(run)
        .ok_or("run missing")?
        .agent_id;
    register_ai_model_profile(
        ctx,
        org,
        RegisterAiModelProfileParams {
            profile_key: "defaults".into(),
            profile_version: 1,
            provider: "mistral".into(),
            model: "mistral-large-latest".into(),
            allowed_roles: vec![
                "generation".into(),
                "review".into(),
                "reasoning".into(),
                "decision".into(),
            ],
            temperature: Some(0.2),
            top_p: Some(1.0),
            max_tokens: 1024,
            context_window: 32000,
            timeout_ms: 30000,
            max_retries: 0,
            max_concurrency: 1,
            supports_tool_calling: true,
            supports_structured_output: true,
            supports_parallel_requests: false,
            input_cost_per_1k_microunits: Some(100),
            output_cost_per_1k_microunits: Some(200),
            per_request_cost_ceiling_microunits: None,
        },
    )?;
    register_ai_intelligence_policy(
        ctx,
        org,
        RegisterAiIntelligencePolicyParams {
            policy_key: "defaults".into(),
            policy_version: 1,
            default_decision_profile: "defaults@1".into(),
            default_generation_profile: "defaults@1".into(),
            default_reasoning_profile: "defaults@1".into(),
            default_review_profile: "defaults@1".into(),
            shadow_profiles: vec![],
            decision_type_overrides_json: "{}".into(),
            fallback_profiles_json: "{}".into(),
        },
    )?;
    if provision_ai_company_defaults(ctx, org, company, agent_id, "defaults@1".into()).is_ok() {
        return Err("setup created an unfunded agent binding".into());
    }
    configure_ai_spend(
        ctx,
        org,
        agent_id,
        ConfigureAiSpendParams {
            billing_period: crate::ai::owner_configuration::current_period(ctx.timestamp)?,
            currency: "USD".into(),
            limit_units: 5000000,
            provider: "mistral".into(),
            model: "mistral-large-latest".into(),
            input_units_per_1k: 100,
            output_units_per_1k: 200,
        },
    )?;
    for key in [
        "rag_generation",
        "form_suggestion",
        "action_draft_generation",
    ] {
        create_ai_skill(
            ctx,
            org,
            CreateAiSkillParams {
                skill_key: key.into(),
                name: key.into(),
                description: None,
                category: "test".into(),
                prompt_template: "test".into(),
                required_tools: vec![],
                optional_tools: vec![],
                default_max_steps: 5,
                default_max_tool_calls: 5,
                output_schema: None,
                config_schema: None,
                dataset_specs: None,
                allowed_action_drafts: vec![],
                is_active: true,
                is_system: false,
                metadata: None,
            },
        )?;
        let id = ctx
            .db
            .ai_skill()
            .ai_skill_by_org()
            .filter(&org)
            .find(|row| row.skill_key == key)
            .ok_or("skill missing")?
            .id;
        // An inherited disablement and an explicit custom policy both survive.
        if key != "rag_generation" {
            upsert_ai_skill_config(
                ctx,
                org,
                UpsertAiSkillConfigParams {
                    company_id: None,
                    skill_id: id,
                    is_enabled: key != "form_suggestion",
                    config_json: if key == "action_draft_generation" {
                        r#"{"defaultAgentId":999}"#
                    } else {
                        "{}"
                    }
                    .into(),
                    custom_instructions: Some("keep".into()),
                    tool_overrides: vec![],
                    metadata: None,
                },
            )?;
        }
    }
    let budget_before = ctx
        .db
        .ai_spend_budget()
        .ai_spend_budget_by_org()
        .filter(&org)
        .next()
        .ok_or("budget missing")?;
    let prices_before = ctx
        .db
        .ai_price_snapshot()
        .ai_price_snapshot_by_agent()
        .filter(&agent_id)
        .count();
    provision_ai_company_defaults(ctx, org, company, agent_id, "defaults@1".into())?;
    let agent = ctx
        .db
        .ai_agent()
        .id()
        .find(agent_id)
        .ok_or("agent missing")?;
    if agent.allowed_actions != vec!["chat"] {
        return Err("setup changed unrelated/disabled actions".into());
    }
    set_ai_agent_action(ctx, org, agent_id, "chat".into(), false)?;
    provision_ai_company_defaults(ctx, org, company, agent_id, "defaults@1".into())?;
    if !ctx
        .db
        .ai_agent()
        .id()
        .find(agent_id)
        .ok_or("agent missing")?
        .allowed_actions
        .is_empty()
    {
        return Err("retry re-enabled deliberately disabled action".into());
    }
    let configs: Vec<_> = ctx
        .db
        .ai_skill_config()
        .ai_skill_config_by_org()
        .filter(&org)
        .collect();
    if configs.len() != 3
        || configs
            .iter()
            .filter(|row| row.company_id == Some(company))
            .count()
            != 1
    {
        return Err("setup duplicated configs or shadowed inherited overrides".into());
    }
    let chat = configs
        .iter()
        .find(|row| row.company_id == Some(company))
        .ok_or("chat config missing")?;
    let value: serde_json::Value =
        serde_json::from_str(&chat.config_json).map_err(|e| e.to_string())?;
    if value["defaultAgentId"] != agent_id || value["intelligencePolicyRef"] != "defaults@1" {
        return Err("chat default binding was not persisted".into());
    }
    let after = ctx
        .db
        .ai_spend_budget()
        .id()
        .find(budget_before.id)
        .ok_or("budget missing")?;
    if after.limit_units != budget_before.limit_units
        || after.settled_units != budget_before.settled_units
        || after.outstanding_units != budget_before.outstanding_units
        || ctx
            .db
            .ai_price_snapshot()
            .ai_price_snapshot_by_agent()
            .filter(&agent_id)
            .count()
            != prices_before
    {
        return Err("setup changed spend or pricing".into());
    }
    if provision_ai_company_defaults(ctx, org, foreign.company_id, agent_id, "defaults@1".into())
        .is_ok()
        || provision_ai_company_defaults(
            ctx,
            foreign.organization_id,
            foreign.company_id,
            agent_id,
            "defaults@1".into(),
        )
        .is_ok()
    {
        return Err("setup accepted a cross-tenant binding".into());
    }
    Ok(())
}
