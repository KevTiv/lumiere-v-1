//! Platform-approved immutable AI templates and bounded, tenant-local enrollment.
//! A template authorizes a recurring sponsored cap for a bounded number of
//! organizations. Companies share that organization's single agent and budget.
use super::agents::{ai_agent, AiAgent};
use super::model_configuration::{
    ai_intelligence_policy, ai_model_profile, AiIntelligencePolicy, AiModelProfile,
    RegisterAiModelProfileParams,
};
use super::owner_configuration::{ai_owner_configuration, AiOwnerConfiguration};
use super::skills::{ai_skill, ai_skill_config, AiSkill, AiSkillConfig, CreateAiSkillParams};
use super::spend::{ai_price_snapshot, ai_spend_budget, AiPriceSnapshot, AiSpendBudget};
use crate::core::cold_tier_identity::{
    cold_tier_service_identity, ColdTierServiceIdentity, AI_SPEND_READER_SERVICE,
};
use crate::core::organization::require_company_in_organization;
use crate::core::permissions::caller_delegated_company_scope;
use crate::core::users::find_user_profile_for_identity;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use sha2::{Digest, Sha256};
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

#[derive(Clone, Debug, SpacetimeType)]
pub struct RegisterAiPlatformTemplateParams {
    pub template_key: String,
    pub template_version: u32,
    pub generation_profile: RegisterAiModelProfileParams,
    pub review_profile: RegisterAiModelProfileParams,
    pub skill_ids: Vec<u64>,
    pub currency: String,
    pub monthly_limit_units: u64,
    pub rate_limit_per_minute: u32,
    pub max_enrolled_organizations: u32,
}

#[derive(Clone)]
#[spacetimedb::table(accessor = ai_platform_template)]
pub struct AiPlatformTemplate {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub template_key: String,
    pub template_version: u32,
    pub generation_profile: RegisterAiModelProfileParams,
    pub review_profile: RegisterAiModelProfileParams,
    pub skill_ids: Vec<u64>,
    pub skill_fingerprints: Vec<String>,
    pub spend_reader_identity: Identity,
    pub runtime_writer_identity: Identity,
    pub currency: String,
    pub monthly_limit_units: u64,
    pub rate_limit_per_minute: u32,
    pub max_enrolled_organizations: u32,
    pub created_by: Identity,
    pub created_at: Timestamp,
}

#[derive(Clone)]
#[spacetimedb::table(accessor = ai_platform_default)]
pub struct AiPlatformDefault {
    #[primary_key]
    pub id: u64,
    pub template_id: Option<u64>,
    pub updated_by: Identity,
    pub updated_at: Timestamp,
}

#[derive(Clone)]
#[spacetimedb::table(accessor = ai_managed_enrollment,
    index(accessor = ai_managed_enrollment_by_template, btree(columns = [template_id])))]
pub struct AiManagedEnrollment {
    #[primary_key]
    pub organization_id: u64,
    pub template_id: u64,
    pub agent_id: u64,
    pub intelligence_policy_ref: String,
    pub is_enabled: bool,
    pub created_at: Timestamp,
}

fn require_platform(ctx: &ReducerContext) -> Result<(), String> {
    let caller = find_user_profile_for_identity(ctx, ctx.sender()).ok_or("user not found")?;
    if !caller.is_active || !caller.is_superuser {
        return Err("active platform superuser is required".into());
    }
    Ok(())
}

#[reducer]
pub fn register_ai_platform_template(
    ctx: &ReducerContext,
    params: RegisterAiPlatformTemplateParams,
) -> Result<(), String> {
    require_platform(ctx)?;
    validate_template(&params)?;
    validate_catalog(ctx, &params.skill_ids)?;
    let existing: Vec<_> = ctx
        .db
        .ai_platform_template()
        .iter()
        .filter(|row| {
            row.template_key == params.template_key
                && row.template_version == params.template_version
        })
        .collect();
    if let [row] = existing.as_slice() {
        if row.generation_profile == params.generation_profile
            && row.review_profile == params.review_profile
            && row.skill_ids == params.skill_ids
            && row.currency == params.currency
            && row.monthly_limit_units == params.monthly_limit_units
            && row.rate_limit_per_minute == params.rate_limit_per_minute
            && row.max_enrolled_organizations == params.max_enrolled_organizations
        {
            return Ok(());
        }
        return Err("AI platform template version already exists with different content".into());
    }
    if !existing.is_empty() {
        return Err("AI platform template identity is ambiguous".into());
    }
    let spend_reader_identity =
        super::platform_runtime::platform_service_identity(ctx, AI_SPEND_READER_SERVICE)?;
    let runtime_writer_identity = super::platform_runtime::platform_service_identity(
        ctx,
        super::platform_runtime::WRITER_SERVICE,
    )?;
    if spend_reader_identity == runtime_writer_identity {
        return Err("AI spend reader and runtime writer identities must be distinct".into());
    }
    let skill_fingerprints = params
        .skill_ids
        .iter()
        .map(|id| {
            ctx.db
                .ai_skill()
                .id()
                .find(*id)
                .map(|skill| skill_fingerprint(&skill))
                .ok_or_else(|| "platform skill missing".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let row = ctx.db.ai_platform_template().insert(AiPlatformTemplate {
        id: 0,
        template_key: params.template_key,
        template_version: params.template_version,
        generation_profile: params.generation_profile,
        review_profile: params.review_profile,
        skill_ids: params.skill_ids,
        skill_fingerprints,
        spend_reader_identity,
        runtime_writer_identity,
        currency: params.currency,
        monthly_limit_units: params.monthly_limit_units,
        rate_limit_per_minute: params.rate_limit_per_minute,
        max_enrolled_organizations: params.max_enrolled_organizations,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
    });
    audit(ctx, 0, row.id, "ai_platform_template", "CREATE");
    Ok(())
}

#[reducer]
pub fn set_ai_platform_default(
    ctx: &ReducerContext,
    template_id: Option<u64>,
) -> Result<(), String> {
    require_platform(ctx)?;
    if let Some(id) = template_id {
        let template = ctx
            .db
            .ai_platform_template()
            .id()
            .find(id)
            .ok_or("AI template not found")?;
        validate_template_catalog(ctx, &template)?;
    }
    if ctx
        .db
        .ai_platform_default()
        .id()
        .find(1)
        .is_some_and(|row| row.template_id == template_id)
    {
        return Ok(());
    }
    let row = AiPlatformDefault {
        id: 1,
        template_id,
        updated_by: ctx.sender(),
        updated_at: ctx.timestamp,
    };
    if ctx.db.ai_platform_default().id().find(1).is_some() {
        ctx.db.ai_platform_default().id().update(row);
    } else {
        ctx.db.ai_platform_default().insert(row);
    }
    audit(ctx, 0, 1, "ai_platform_default", "UPDATE");
    Ok(())
}

/// Enrollment has no model, amount or identity chosen by the tenant caller.
#[reducer]
pub fn enroll_ai_company_defaults(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_agent", "write")?;
    check_permission(ctx, organization_id, "ai_skill", "write")?;
    if caller_delegated_company_scope(ctx, organization_id).is_some() {
        return Err("organization administrator is required to enroll AI defaults".into());
    }
    enroll_company_from_platform(ctx, organization_id, company_id)
}

/// Called only after authorized tenant/company creation, or the explicit
/// enrollment boundary above. No default/custom setup/capacity is a no-op.
pub(crate) fn enroll_company_from_platform(
    ctx: &ReducerContext,
    org: u64,
    company: u64,
) -> Result<(), String> {
    require_company_in_organization(ctx, org, company)?;
    let existing = ctx.db.ai_managed_enrollment().organization_id().find(org);
    let enrollment = if let Some(row) = existing {
        if !row.is_enabled {
            return Ok(());
        }
        row
    } else {
        let Some(default) = ctx
            .db
            .ai_platform_default()
            .id()
            .find(1)
            .and_then(|row| row.template_id)
        else {
            return Ok(());
        };
        let template = ctx
            .db
            .ai_platform_template()
            .id()
            .find(default)
            .ok_or("AI platform default is unavailable")?;
        // Existing custom or funded agents remain authoritative. Never create a
        // second sponsored pool during repair or adopt a tenant's credentials.
        if ctx
            .db
            .ai_agent()
            .ai_agent_by_org()
            .filter(&org)
            .next()
            .is_some()
            || ctx
                .db
                .ai_owner_configuration()
                .ai_owner_configuration_by_org()
                .filter(&org)
                .next()
                .is_some()
        {
            return Ok(());
        }
        if ctx
            .db
            .ai_managed_enrollment()
            .ai_managed_enrollment_by_template()
            .filter(&template.id)
            .count()
            >= template.max_enrolled_organizations as usize
        {
            return Ok(());
        }
        // A disabled global skill prevents new enrollment rather than silently
        // reactivating it. Existing enrollments preserve pinned identities.
        if validate_template_catalog(ctx, &template).is_err() {
            return Ok(());
        }
        let reader_history = ctx
            .db
            .cold_tier_service_identity()
            .cold_tier_service_identity_by_name()
            .filter((&org, &AI_SPEND_READER_SERVICE.to_string()))
            .collect::<Vec<_>>();
        if !reader_history.is_empty()
            && !reader_history
                .iter()
                .any(|row| row.is_active && row.identity == template.spend_reader_identity)
        {
            return Ok(());
        }
        let generation_key = format!("platform-{}-generation", template.id);
        let review_key = format!("platform-{}-review", template.id);
        let policy_key = format!("platform-{}", template.id);
        if ctx
            .db
            .ai_model_profile()
            .ai_model_profile_by_org()
            .filter(&org)
            .any(|row| row.profile_key == generation_key || row.profile_key == review_key)
            || ctx
                .db
                .ai_intelligence_policy()
                .ai_intelligence_policy_by_org()
                .filter(&org)
                .any(|row| row.policy_key == policy_key)
        {
            return Ok(());
        }
        if !super::platform_runtime::can_enroll_writer(
            ctx,
            org,
            template.runtime_writer_identity,
            template.id,
        ) {
            return Ok(());
        }
        create_enrollment(ctx, org, &template)?
    };
    let template = ctx
        .db
        .ai_platform_template()
        .id()
        .find(enrollment.template_id)
        .ok_or("enrolled AI template is unavailable")?;
    let Some(agent) = ctx
        .db
        .ai_agent()
        .id()
        .find(enrollment.agent_id)
        .filter(|row| row.organization_id == org && row.company_id.is_none() && row.is_active)
    else {
        return Ok(());
    };
    ensure_period(ctx, org, &agent, &template)?;
    for (skill_id, expected_fingerprint) in
        template.skill_ids.iter().zip(&template.skill_fingerprints)
    {
        let Some(skill) = ctx
            .db
            .ai_skill()
            .id()
            .find(*skill_id)
            .filter(|row| row.organization_id == 0 && row.is_active)
        else {
            continue;
        };
        if &skill_fingerprint(&skill) != expected_fingerprint {
            continue;
        }
        // An organization-owned catalog entry (including inactive) shadows the
        // platform entry. Never create a backdoor binding around that override.
        if ctx
            .db
            .ai_skill()
            .ai_skill_by_org()
            .filter(&org)
            .any(|row| row.skill_key == skill.skill_key)
        {
            continue;
        }
        if ctx
            .db
            .ai_skill_config()
            .ai_skill_config_by_org()
            .filter(&org)
            .any(|row| {
                row.skill_id == skill.id
                    && (row.company_id.is_none() || row.company_id == Some(company))
            })
        {
            continue;
        }
        let config = ctx.db.ai_skill_config().insert(AiSkillConfig {
            id: 0, organization_id: org, company_id: Some(company), skill_id: skill.id, is_enabled: true,
            config_json: serde_json::json!({"defaultAgentId":agent.id,"intelligencePolicyRef":enrollment.intelligence_policy_ref}).to_string(),
            custom_instructions: None, tool_overrides: vec![], create_date: ctx.timestamp, write_date: ctx.timestamp,
            metadata: Some(serde_json::json!({"platformTemplateId":template.id}).to_string()),
        });
        audit(ctx, org, config.id, "ai_skill_config", "CREATE");
    }
    Ok(())
}

fn create_enrollment(
    ctx: &ReducerContext,
    org: u64,
    template: &AiPlatformTemplate,
) -> Result<AiManagedEnrollment, String> {
    super::platform_runtime::enroll_writer(
        ctx,
        org,
        template.runtime_writer_identity,
        template.id,
        template.created_by,
    )?;
    let service_name = AI_SPEND_READER_SERVICE.to_string();
    if ctx
        .db
        .cold_tier_service_identity()
        .cold_tier_service_identity_by_name()
        .filter((&org, &service_name))
        .next()
        .is_none()
    {
        ctx.db
            .cold_tier_service_identity()
            .insert(ColdTierServiceIdentity {
                platform_id: format!("tenant-enrollment-ai_spend_reader-{org}"),
                organization_id: org,
                service_name,
                identity: template.spend_reader_identity,
                is_active: true,
                registered_by: template.created_by,
                registered_at: ctx.timestamp,
                retired_at: None,
            });
    }
    let generation_key = format!("platform-{}-generation", template.id);
    let review_key = format!("platform-{}-review", template.id);
    let policy_key = format!("platform-{}", template.id);
    // No overwrite of user-defined identities, even if the key happens to match.
    if ctx
        .db
        .ai_model_profile()
        .ai_model_profile_by_org()
        .filter(&org)
        .any(|row| row.profile_key == generation_key || row.profile_key == review_key)
        || ctx
            .db
            .ai_intelligence_policy()
            .ai_intelligence_policy_by_org()
            .filter(&org)
            .any(|row| row.policy_key == policy_key)
    {
        return Err("managed AI profile identity conflicts with existing configuration".into());
    }
    insert_profile(ctx, org, &generation_key, &template.generation_profile);
    insert_profile(ctx, org, &review_key, &template.review_profile);
    let generation_ref = format!("{generation_key}@1");
    let policy_ref = format!("{policy_key}@1");
    ctx.db
        .ai_intelligence_policy()
        .insert(AiIntelligencePolicy {
            id: 0,
            organization_id: org,
            policy_key,
            policy_version: 1,
            default_decision_profile: generation_ref.clone(),
            default_reasoning_profile: generation_ref.clone(),
            default_generation_profile: generation_ref,
            default_review_profile: format!("{review_key}@1"),
            shadow_profiles: vec![],
            decision_type_overrides_json: "{}".into(),
            fallback_profiles_json: "{}".into(),
            is_active: true,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
        });
    let p = &template.generation_profile;
    let agent = ctx.db.ai_agent().insert(AiAgent {
        id: 0,
        organization_id: org,
        name: "Lumière Assistant".into(),
        description: None,
        model: p.model.clone(),
        provider: p.provider.clone(),
        api_key_reference: None,
        temperature: p.temperature.unwrap_or(0.0),
        max_tokens: p.max_tokens,
        top_p: p.top_p.unwrap_or(1.0),
        frequency_penalty: 0.0,
        presence_penalty: 0.0,
        system_prompt: None,
        context_window: p.context_window,
        is_active: true,
        is_default: true,
        allowed_models: vec![p.model.clone(), template.review_profile.model.clone()],
        allowed_actions: vec![
            "chat".into(),
            "form_suggest".into(),
            "action_draft".into(),
            "skill_run".into(),
        ],
        rate_limit_per_minute: template.rate_limit_per_minute,
        cost_per_1k_tokens: 0.0,
        monthly_budget: None,
        monthly_spend: 0.0,
        company_id: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: Some(serde_json::json!({"platformTemplateId":template.id}).to_string()),
    });
    ctx.db
        .ai_owner_configuration()
        .insert(AiOwnerConfiguration {
            agent_id: agent.id,
            organization_id: org,
            revision: 0,
            monthly_limit_units: template.monthly_limit_units,
            sponsored_ceiling_units: template.monthly_limit_units,
            currency: template.currency.clone(),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
        });
    for (version, profile) in [
        (1, &template.generation_profile),
        (2, &template.review_profile),
    ] {
        ctx.db.ai_price_snapshot().insert(AiPriceSnapshot {
            id: 0,
            organization_id: org,
            agent_id: agent.id,
            provider: profile.provider.clone(),
            model: profile.model.clone(),
            currency: template.currency.clone(),
            input_units_per_1k: profile
                .input_cost_per_1k_microunits
                .ok_or("template input price is missing")?,
            output_units_per_1k: profile
                .output_cost_per_1k_microunits
                .ok_or("template output price is missing")?,
            version,
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
        });
    }
    let enrollment = ctx.db.ai_managed_enrollment().insert(AiManagedEnrollment {
        organization_id: org,
        template_id: template.id,
        agent_id: agent.id,
        intelligence_policy_ref: policy_ref,
        is_enabled: true,
        created_at: ctx.timestamp,
    });
    audit(ctx, org, org, "ai_managed_enrollment", "CREATE");
    Ok(enrollment)
}

/// Automatic insert-only renewal of an existing platform-approved sponsored pool.
#[reducer]
pub fn ensure_ai_managed_allowance(
    ctx: &ReducerContext,
    organization_id: u64,
    agent_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_spend", "reserve")?;
    ensure_managed_period(ctx, organization_id, agent_id)
}

pub(crate) fn ensure_managed_period(
    ctx: &ReducerContext,
    org: u64,
    agent_id: u64,
) -> Result<(), String> {
    let Some(enrollment) = ctx
        .db
        .ai_managed_enrollment()
        .organization_id()
        .find(org)
        .filter(|row| row.is_enabled && row.agent_id == agent_id)
    else {
        return Ok(());
    };
    let agent = ctx
        .db
        .ai_agent()
        .id()
        .find(agent_id)
        .filter(|row| row.organization_id == org && row.company_id.is_none() && row.is_active)
        .ok_or("managed agent is unavailable")?;
    let template = ctx
        .db
        .ai_platform_template()
        .id()
        .find(enrollment.template_id)
        .ok_or("managed template missing")?;
    ensure_period(ctx, org, &agent, &template)
}

fn ensure_period(
    ctx: &ReducerContext,
    org: u64,
    agent: &AiAgent,
    template: &AiPlatformTemplate,
) -> Result<(), String> {
    let period = super::owner_configuration::current_period(ctx.timestamp)?;
    if ctx
        .db
        .ai_spend_budget()
        .ai_spend_budget_by_agent_period()
        .filter((&agent.id, &period))
        .next()
        .is_some()
    {
        return Ok(());
    }
    // Sponsored renewal is explicitly authorized by the immutable platform
    // template. A prepaid conversion delegates renewal to funded admission.
    if super::prepaid::prepaid_enabled(ctx, org, agent.id) {
        return Ok(());
    }
    let owner = ctx
        .db
        .ai_owner_configuration()
        .agent_id()
        .find(agent.id)
        .ok_or("managed AI allowance missing")?;
    if owner.organization_id != org
        || owner.currency != template.currency
        || owner.monthly_limit_units > template.monthly_limit_units
    {
        return Err("managed AI allowance differs from approved platform funding".into());
    }
    ctx.db.ai_spend_budget().insert(AiSpendBudget {
        id: 0,
        organization_id: org,
        agent_id: agent.id,
        billing_period: period,
        currency: template.currency.clone(),
        limit_units: owner.monthly_limit_units,
        settled_units: 0,
        outstanding_units: 0,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });
    audit(ctx, org, agent.id, "ai_spend_budget", "CREATE");
    Ok(())
}

fn insert_profile(ctx: &ReducerContext, org: u64, key: &str, p: &RegisterAiModelProfileParams) {
    ctx.db.ai_model_profile().insert(AiModelProfile {
        id: 0,
        organization_id: org,
        profile_key: key.into(),
        profile_version: 1,
        provider: p.provider.clone(),
        model: p.model.clone(),
        allowed_roles: p.allowed_roles.clone(),
        temperature: p.temperature,
        top_p: p.top_p,
        max_tokens: p.max_tokens,
        context_window: p.context_window,
        timeout_ms: p.timeout_ms,
        max_retries: p.max_retries,
        max_concurrency: p.max_concurrency,
        supports_tool_calling: p.supports_tool_calling,
        supports_structured_output: p.supports_structured_output,
        supports_parallel_requests: p.supports_parallel_requests,
        input_cost_per_1k_microunits: p.input_cost_per_1k_microunits,
        output_cost_per_1k_microunits: p.output_cost_per_1k_microunits,
        per_request_cost_ceiling_microunits: p.per_request_cost_ceiling_microunits,
        is_active: true,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });
}

fn validate_template(p: &RegisterAiPlatformTemplateParams) -> Result<(), String> {
    if p.template_key.is_empty()
        || p.template_key.len() > 96
        || !p
            .template_key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        || p.template_version == 0
        || p.monthly_limit_units == 0
        || p.max_enrolled_organizations == 0
        || p.rate_limit_per_minute == 0
        || p.currency.len() != 3
        || !p.currency.bytes().all(|b| b.is_ascii_uppercase())
        || p.monthly_limit_units
            .checked_mul(u64::from(p.max_enrolled_organizations))
            .is_none()
    {
        return Err("invalid bounded platform AI funding policy".into());
    }
    for profile in [&p.generation_profile, &p.review_profile] {
        super::model_configuration::validate_model_profile_params(profile)?;
        if !matches!(profile.provider.as_str(), "mistral" | "gemini" | "ollama")
            || profile.model.len() > 128
            || profile.model.trim() != profile.model
            || profile.model.ends_with("-latest")
            || profile.model.chars().any(char::is_whitespace)
            || profile.model.contains('\0')
            || profile.max_tokens >= profile.context_window
            || profile.timeout_ms == 0
            || !profile.supports_tool_calling
            || !profile.supports_structured_output
            || profile
                .input_cost_per_1k_microunits
                .is_none_or(|n| n > 1_000_000_000_000)
            || profile
                .output_cost_per_1k_microunits
                .is_none_or(|n| n > 1_000_000_000_000)
        {
            return Err("platform model must have exact supported identity, capabilities, limits and reviewed pricing".into());
        }
    }
    if p.generation_profile.provider != p.review_profile.provider
        || p.generation_profile.model == p.review_profile.model
        || !["generation", "decision", "reasoning"]
            .iter()
            .all(|role| p.generation_profile.allowed_roles.iter().any(|r| r == role))
        || !p.review_profile.allowed_roles.iter().any(|r| r == "review")
    {
        return Err(
            "platform template requires generation and distinct review models from one provider"
                .into(),
        );
    }
    Ok(())
}

/// Publish only the bundled generation catalog. Existing definitions are never overwritten.
#[reducer]
pub fn publish_ai_platform_skill(
    ctx: &ReducerContext,
    params: CreateAiSkillParams,
) -> Result<(), String> {
    require_platform(ctx)?;
    if ![
        "rag_generation",
        "form_suggestion",
        "action_draft_generation",
    ]
    .contains(&params.skill_key.as_str())
        || params.name.trim().is_empty()
        || params.prompt_template.is_empty()
        || params.prompt_template.len() > 32000
        || !(1..=32).contains(&params.default_max_steps)
        || !(1..=64).contains(&params.default_max_tool_calls)
    {
        return Err("invalid platform generation skill definition".into());
    }
    let existing: Vec<_> = ctx
        .db
        .ai_skill()
        .ai_skill_by_org()
        .filter(&0u64)
        .filter(|row| row.skill_key == params.skill_key)
        .collect();
    let candidate = AiSkill {
        id: 0,
        organization_id: 0,
        skill_key: params.skill_key,
        name: params.name,
        description: params.description,
        category: params.category,
        prompt_template: params.prompt_template,
        required_tools: params.required_tools,
        optional_tools: params.optional_tools,
        default_max_steps: params.default_max_steps,
        default_max_tool_calls: params.default_max_tool_calls,
        output_schema: params.output_schema,
        config_schema: params.config_schema,
        dataset_specs: params.dataset_specs,
        allowed_action_drafts: params.allowed_action_drafts,
        is_active: true,
        is_system: true,
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
        metadata: params.metadata,
    };
    if let [row] = existing.as_slice() {
        if row.is_active && row.is_system && skill_fingerprint(row) == skill_fingerprint(&candidate)
        {
            return Ok(());
        }
        return Err("platform skill already exists with disabled or different content".into());
    }
    if !existing.is_empty() {
        return Err("platform skill identity is ambiguous".into());
    }
    let inserted = ctx.db.ai_skill().insert(candidate);
    audit(ctx, 0, inserted.id, "ai_skill", "CREATE");
    Ok(())
}

pub(crate) fn skill_fingerprint(skill: &AiSkill) -> String {
    format!("{:x}", Sha256::digest(serde_json::json!({
        "key":skill.skill_key,"name":skill.name,"description":skill.description,"category":skill.category,
        "prompt":skill.prompt_template,"required":skill.required_tools,"optional":skill.optional_tools,
        "maxSteps":skill.default_max_steps,"maxCalls":skill.default_max_tool_calls,"output":skill.output_schema,
        "config":skill.config_schema,"datasets":skill.dataset_specs,"actions":skill.allowed_action_drafts,
        "metadata":skill.metadata
    }).to_string().as_bytes()))
}

fn validate_template_catalog(
    ctx: &ReducerContext,
    template: &AiPlatformTemplate,
) -> Result<(), String> {
    validate_catalog(ctx, &template.skill_ids)?;
    if template.skill_ids.len() != template.skill_fingerprints.len() {
        return Err("platform skill snapshot is incomplete".into());
    }
    for (id, expected) in template.skill_ids.iter().zip(&template.skill_fingerprints) {
        let skill = ctx
            .db
            .ai_skill()
            .id()
            .find(*id)
            .ok_or("platform skill missing")?;
        if skill_fingerprint(&skill) != *expected {
            return Err("platform skill changed since template approval".into());
        }
    }
    Ok(())
}

fn validate_catalog(ctx: &ReducerContext, ids: &[u64]) -> Result<(), String> {
    if ids.len() != 3 {
        return Err("platform template requires exactly three built-in generation surfaces".into());
    }
    let mut keys = Vec::new();
    for id in ids {
        let skill = ctx
            .db
            .ai_skill()
            .id()
            .find(*id)
            .filter(|row| row.organization_id == 0 && row.is_active && row.is_system)
            .ok_or("platform template skill must be active system catalog content")?;
        if ![
            "rag_generation",
            "form_suggestion",
            "action_draft_generation",
        ]
        .contains(&skill.skill_key.as_str())
            || keys.contains(&skill.skill_key)
        {
            return Err("platform skill catalog is ambiguous or unsupported".into());
        }
        keys.push(skill.skill_key);
    }
    Ok(())
}

fn audit(ctx: &ReducerContext, org: u64, id: u64, table: &'static str, action: &'static str) {
    write_audit_log_v2(
        ctx,
        org,
        AuditLogParams {
            company_id: None,
            table_name: table,
            record_id: id,
            action,
            old_values: None,
            new_values: None,
            changed_fields: vec!["platform_ai_defaults".into()],
            metadata: None,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    fn template() -> RegisterAiPlatformTemplateParams {
        let profile = |model: &str, roles: Vec<String>| RegisterAiModelProfileParams {
            profile_key: "managed".into(),
            profile_version: 1,
            provider: "mistral".into(),
            model: model.into(),
            allowed_roles: roles,
            temperature: Some(0.0),
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
        };
        RegisterAiPlatformTemplateParams {
            template_key: "alpha".into(),
            template_version: 1,
            generation_profile: profile(
                "mistral-small-2603",
                vec!["generation".into(), "reasoning".into(), "decision".into()],
            ),
            review_profile: profile("mistral-medium-3-5", vec!["review".into()]),
            skill_ids: vec![1, 2, 3],
            currency: "USD".into(),
            monthly_limit_units: 5000000,
            rate_limit_per_minute: 10,
            max_enrolled_organizations: 100,
        }
    }
    #[test]
    fn template_has_bounded_sponsorship_and_exact_priced_profiles() {
        let valid = template();
        assert!(validate_template(&valid).is_ok());
        let mut p = valid.clone();
        p.monthly_limit_units = u64::MAX;
        assert!(validate_template(&p).is_err());
        let mut p = valid.clone();
        p.max_enrolled_organizations = 0;
        assert!(validate_template(&p).is_err());
        let mut p = valid.clone();
        p.generation_profile.input_cost_per_1k_microunits = None;
        assert!(validate_template(&p).is_err());
        let mut p = valid.clone();
        p.generation_profile.model = "mistral-small-latest".into();
        assert!(validate_template(&p).is_err());
        let mut p = valid.clone();
        p.review_profile.provider = "gemini".into();
        assert!(validate_template(&p).is_err());
        let mut p = valid.clone();
        p.review_profile.model = p.generation_profile.model.clone();
        assert!(validate_template(&p).is_err());
        let mut p = valid.clone();
        p.generation_profile.temperature = Some(f64::NAN);
        assert!(validate_template(&p).is_err());
        let mut p = valid;
        p.generation_profile.max_tokens = p.generation_profile.context_window;
        assert!(validate_template(&p).is_err());
    }
}
