//! Versioned model profiles and intelligence routing policy.

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

const MAX_JSON_LEN: usize = 128_000;
const INTELLIGENCE_ROLES: [&str; 5] = ["decision", "reasoning", "generation", "review", "shadow"];

#[derive(Clone, Debug)]
#[spacetimedb::table(
    accessor = ai_model_profile,
    public,
    index(accessor = ai_model_profile_by_org, btree(columns = [organization_id])),
    index(accessor = ai_model_profile_by_key, btree(columns = [organization_id, profile_key]))
)]
pub struct AiModelProfile {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub profile_key: String,
    pub profile_version: u32,
    pub provider: String,
    pub model: String,
    pub allowed_roles: Vec<String>,
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub max_tokens: u32,
    pub context_window: u32,
    pub timeout_ms: u32,
    pub max_retries: u32,
    pub max_concurrency: u32,
    pub supports_tool_calling: bool,
    pub supports_structured_output: bool,
    pub supports_parallel_requests: bool,
    pub input_cost_per_1k_microunits: Option<u64>,
    pub output_cost_per_1k_microunits: Option<u64>,
    pub per_request_cost_ceiling_microunits: Option<u64>,
    pub is_active: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

#[derive(Clone, Debug)]
#[spacetimedb::table(
    accessor = ai_intelligence_policy,
    public,
    index(accessor = ai_intelligence_policy_by_org, btree(columns = [organization_id])),
    index(accessor = ai_intelligence_policy_by_key, btree(columns = [organization_id, policy_key]))
)]
pub struct AiIntelligencePolicy {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub policy_key: String,
    pub policy_version: u32,
    pub default_decision_profile: String,
    pub default_reasoning_profile: String,
    pub default_generation_profile: String,
    pub default_review_profile: String,
    pub shadow_profiles: Vec<String>,
    pub decision_type_overrides_json: String,
    pub fallback_profiles_json: String,
    pub is_active: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RegisterAiModelProfileParams {
    pub profile_key: String,
    pub profile_version: u32,
    pub provider: String,
    pub model: String,
    pub allowed_roles: Vec<String>,
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub max_tokens: u32,
    pub context_window: u32,
    pub timeout_ms: u32,
    pub max_retries: u32,
    pub max_concurrency: u32,
    pub supports_tool_calling: bool,
    pub supports_structured_output: bool,
    pub supports_parallel_requests: bool,
    pub input_cost_per_1k_microunits: Option<u64>,
    pub output_cost_per_1k_microunits: Option<u64>,
    pub per_request_cost_ceiling_microunits: Option<u64>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RegisterAiIntelligencePolicyParams {
    pub policy_key: String,
    pub policy_version: u32,
    pub default_decision_profile: String,
    pub default_reasoning_profile: String,
    pub default_generation_profile: String,
    pub default_review_profile: String,
    pub shadow_profiles: Vec<String>,
    pub decision_type_overrides_json: String,
    pub fallback_profiles_json: String,
}

#[reducer]
pub fn register_ai_model_profile(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RegisterAiModelProfileParams,
) -> Result<(), String> {
    if organization_id == 0 {
        return Err("organization_id must be nonzero".to_string());
    }
    check_permission(ctx, organization_id, "ai_model_profile", "create")?;
    validate_model_profile_params(&params)?;

    if let Some(existing) = find_model_profile(
        ctx,
        organization_id,
        params.profile_key.trim(),
        params.profile_version,
    ) {
        if model_profile_matches(&existing, &params) {
            return Ok(());
        }
        return Err("model profile version already exists with different content".to_string());
    }

    let inserted = ctx.db.ai_model_profile().insert(AiModelProfile {
        id: 0,
        organization_id,
        profile_key: params.profile_key.trim().to_string(),
        profile_version: params.profile_version,
        provider: params.provider.trim().to_lowercase(),
        model: params.model.trim().to_string(),
        allowed_roles: params.allowed_roles,
        temperature: params.temperature,
        top_p: params.top_p,
        max_tokens: params.max_tokens,
        context_window: params.context_window,
        timeout_ms: params.timeout_ms,
        max_retries: params.max_retries,
        max_concurrency: params.max_concurrency,
        supports_tool_calling: params.supports_tool_calling,
        supports_structured_output: params.supports_structured_output,
        supports_parallel_requests: params.supports_parallel_requests,
        input_cost_per_1k_microunits: params.input_cost_per_1k_microunits,
        output_cost_per_1k_microunits: params.output_cost_per_1k_microunits,
        per_request_cost_ceiling_microunits: params.per_request_cost_ceiling_microunits,
        is_active: true,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "ai_model_profile",
            record_id: inserted.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec!["created".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn set_ai_model_profile_active(
    ctx: &ReducerContext,
    organization_id: u64,
    profile_id: u64,
    is_active: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_model_profile", "write")?;
    let row = ctx
        .db
        .ai_model_profile()
        .id()
        .find(&profile_id)
        .ok_or("model profile not found")?;
    if row.organization_id != organization_id {
        return Err("model profile belongs to another organization".to_string());
    }
    ctx.db.ai_model_profile().id().update(AiModelProfile {
        is_active,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..row
    });
    Ok(())
}

#[reducer]
pub fn register_ai_intelligence_policy(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RegisterAiIntelligencePolicyParams,
) -> Result<(), String> {
    if organization_id == 0 {
        return Err("organization_id must be nonzero".to_string());
    }
    check_permission(ctx, organization_id, "ai_intelligence_policy", "create")?;
    validate_policy_params(ctx, organization_id, &params)?;

    if let Some(existing) = find_policy(
        ctx,
        organization_id,
        params.policy_key.trim(),
        params.policy_version,
    ) {
        if policy_matches(&existing, &params) {
            return Ok(());
        }
        return Err("intelligence policy version already exists with different content".to_string());
    }

    ctx.db.ai_intelligence_policy().insert(AiIntelligencePolicy {
        id: 0,
        organization_id,
        policy_key: params.policy_key.trim().to_string(),
        policy_version: params.policy_version,
        default_decision_profile: params.default_decision_profile,
        default_reasoning_profile: params.default_reasoning_profile,
        default_generation_profile: params.default_generation_profile,
        default_review_profile: params.default_review_profile,
        shadow_profiles: params.shadow_profiles,
        decision_type_overrides_json: params.decision_type_overrides_json,
        fallback_profiles_json: params.fallback_profiles_json,
        is_active: true,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });
    Ok(())
}

#[reducer]
pub fn set_ai_intelligence_policy_active(
    ctx: &ReducerContext,
    organization_id: u64,
    policy_id: u64,
    is_active: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_intelligence_policy", "write")?;
    let row = ctx
        .db
        .ai_intelligence_policy()
        .id()
        .find(&policy_id)
        .ok_or("intelligence policy not found")?;
    if row.organization_id != organization_id {
        return Err("intelligence policy belongs to another organization".to_string());
    }
    ctx.db
        .ai_intelligence_policy()
        .id()
        .update(AiIntelligencePolicy {
            is_active,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..row
        });
    Ok(())
}

fn validate_model_profile_params(params: &RegisterAiModelProfileParams) -> Result<(), String> {
    if params.profile_key.trim().is_empty()
        || params.model.trim().is_empty()
        || params.provider.trim().is_empty()
    {
        return Err("profile_key, provider and model are required".to_string());
    }
    if params.profile_version == 0 {
        return Err("profile_version must be positive".to_string());
    }
    if params.allowed_roles.is_empty()
        || params
            .allowed_roles
            .iter()
            .any(|role| !INTELLIGENCE_ROLES.contains(&role.as_str()))
    {
        return Err(format!("allowed_roles must use {INTELLIGENCE_ROLES:?}"));
    }
    if let Some(temperature) = params.temperature {
        if !(0.0..=2.0).contains(&temperature) {
            return Err("temperature must be within [0, 2]".to_string());
        }
    }
    if let Some(top_p) = params.top_p {
        if !(0.0..=1.0).contains(&top_p) {
            return Err("top_p must be within [0, 1]".to_string());
        }
    }
    if params.max_tokens == 0 || params.context_window == 0 || params.max_concurrency == 0 {
        return Err("max_tokens, context_window and max_concurrency must be positive".to_string());
    }
    Ok(())
}

fn validate_policy_params(
    ctx: &ReducerContext,
    organization_id: u64,
    params: &RegisterAiIntelligencePolicyParams,
) -> Result<(), String> {
    if params.policy_key.trim().is_empty() || params.policy_version == 0 {
        return Err("policy_key and positive policy_version are required".to_string());
    }
    for field in [
        &params.decision_type_overrides_json,
        &params.fallback_profiles_json,
    ] {
        if field.len() > MAX_JSON_LEN {
            return Err("policy JSON field exceeds size limit".to_string());
        }
        let value: serde_json::Value =
            serde_json::from_str(field).map_err(|_| "policy JSON field is invalid JSON")?;
        if !value.is_object() {
            return Err("policy JSON fields must be objects".to_string());
        }
    }

    for (role, profile_ref) in [
        ("decision", params.default_decision_profile.as_str()),
        ("reasoning", params.default_reasoning_profile.as_str()),
        ("generation", params.default_generation_profile.as_str()),
        ("review", params.default_review_profile.as_str()),
    ] {
        validate_profile_ref(ctx, organization_id, profile_ref, role)?;
    }
    for profile_ref in &params.shadow_profiles {
        validate_profile_ref(ctx, organization_id, profile_ref, "shadow")?;
    }

    let overrides: serde_json::Value = serde_json::from_str(&params.decision_type_overrides_json)
        .map_err(|_| "decision_type_overrides_json is invalid JSON")?;
    if let Some(entries) = overrides.as_object() {
        for value in entries.values() {
            let object = value
                .as_object()
                .ok_or("decision type override must be an object")?;
            if let Some(primary) = object.get("primary").and_then(|value| value.as_str()) {
                validate_profile_ref(ctx, organization_id, primary, "decision")?;
            }
            if let Some(review) = object.get("review").and_then(|value| value.as_str()) {
                validate_profile_ref(ctx, organization_id, review, "review")?;
            }
            if let Some(shadows) = object.get("shadows").and_then(|value| value.as_array()) {
                for shadow in shadows {
                    let profile_ref = shadow
                        .as_str()
                        .ok_or("decision type shadow override must be a string")?;
                    validate_profile_ref(ctx, organization_id, profile_ref, "shadow")?;
                }
            }

            let require_distinct_profile =
                bool_override(object, "requireDistinctReviewProfile")?;
            let require_distinct_provider =
                bool_override(object, "requireDistinctReviewProvider")?;
            let _prefer_distinct_provider =
                bool_override(object, "preferDistinctReviewProvider")?;

            if require_distinct_provider {
                let decision_ref = object
                    .get("primary")
                    .and_then(|value| value.as_str())
                    .unwrap_or(params.default_decision_profile.as_str());
                let review_ref = object
                    .get("review")
                    .and_then(|value| value.as_str())
                    .unwrap_or(params.default_review_profile.as_str());

                if decision_ref == review_ref {
                    return Err(
                        "requireDistinctReviewProvider also requires distinct decision/review profiles"
                            .to_string(),
                    );
                }
                let decision_provider =
                    provider_for_profile_ref(ctx, organization_id, decision_ref)?;
                let review_provider =
                    provider_for_profile_ref(ctx, organization_id, review_ref)?;
                if decision_provider == review_provider {
                    return Err(format!(
                        "requireDistinctReviewProvider resolved both profiles to provider '{}'",
                        decision_provider
                    ));
                }
            } else if require_distinct_profile {
                let decision_ref = object
                    .get("primary")
                    .and_then(|value| value.as_str())
                    .unwrap_or(params.default_decision_profile.as_str());
                let review_ref = object
                    .get("review")
                    .and_then(|value| value.as_str())
                    .unwrap_or(params.default_review_profile.as_str());
                if decision_ref == review_ref {
                    return Err(
                        "requireDistinctReviewProfile resolved decision and review to the same profile"
                            .to_string(),
                    );
                }
            }
        }
    }

    let fallbacks: serde_json::Value = serde_json::from_str(&params.fallback_profiles_json)
        .map_err(|_| "fallback_profiles_json is invalid JSON")?;
    if let Some(entries) = fallbacks.as_object() {
        for (role, value) in entries {
            if !INTELLIGENCE_ROLES.contains(&role.as_str()) || role == "shadow" {
                return Err("fallback role must be decision, reasoning, generation, or review".to_string());
            }
            let refs = value
                .as_array()
                .ok_or("fallback profile list must be an array")?;
            for profile_ref in refs {
                let profile_ref = profile_ref
                    .as_str()
                    .ok_or("fallback profile ref must be a string")?;
                validate_profile_ref(ctx, organization_id, profile_ref, role)?;
            }
        }
    }
    Ok(())
}

fn bool_override(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Result<bool, String> {
    match object.get(key) {
        None => Ok(false),
        Some(value) => value
            .as_bool()
            .ok_or_else(|| format!("{key} must be a boolean")),
    }
}

fn provider_for_profile_ref(
    ctx: &ReducerContext,
    organization_id: u64,
    profile_ref: &str,
) -> Result<String, String> {
    let (key, version) = parse_profile_ref(profile_ref)?;
    let profile = find_model_profile(ctx, organization_id, key, version)
        .ok_or_else(|| format!("model profile '{profile_ref}' not found"))?;
    if !profile.is_active {
        return Err(format!("model profile '{profile_ref}' is inactive"));
    }
    Ok(profile.provider.trim().to_lowercase())
}

fn validate_profile_ref(
    ctx: &ReducerContext,
    organization_id: u64,
    profile_ref: &str,
    role: &str,
) -> Result<(), String> {
    let (key, version) = parse_profile_ref(profile_ref)?;
    let profile = find_model_profile(ctx, organization_id, key, version)
        .ok_or_else(|| format!("model profile '{profile_ref}' not found"))?;
    if !profile.is_active {
        return Err(format!("model profile '{profile_ref}' is inactive"));
    }
    if !profile.allowed_roles.iter().any(|allowed| allowed == role) {
        return Err(format!(
            "model profile '{profile_ref}' does not allow intelligence role '{role}'"
        ));
    }
    Ok(())
}

fn parse_profile_ref(value: &str) -> Result<(&str, u32), String> {
    let (key, version) = value
        .trim()
        .rsplit_once('@')
        .ok_or("profile ref must use profile_key@version")?;
    if key.trim().is_empty() {
        return Err("profile ref key must be nonempty".to_string());
    }
    let version = version
        .parse::<u32>()
        .map_err(|_| "profile ref version must be a positive integer")?;
    if version == 0 {
        return Err("profile ref version must be positive".to_string());
    }
    Ok((key, version))
}

fn find_model_profile(
    ctx: &ReducerContext,
    organization_id: u64,
    key: &str,
    version: u32,
) -> Option<AiModelProfile> {
    ctx.db
        .ai_model_profile()
        .ai_model_profile_by_org()
        .filter(&organization_id)
        .find(|row| row.profile_key == key && row.profile_version == version)
}

fn find_policy(
    ctx: &ReducerContext,
    organization_id: u64,
    key: &str,
    version: u32,
) -> Option<AiIntelligencePolicy> {
    ctx.db
        .ai_intelligence_policy()
        .ai_intelligence_policy_by_org()
        .filter(&organization_id)
        .find(|row| row.policy_key == key && row.policy_version == version)
}

fn model_profile_matches(existing: &AiModelProfile, params: &RegisterAiModelProfileParams) -> bool {
    existing.profile_key == params.profile_key.trim()
        && existing.profile_version == params.profile_version
        && existing.provider == params.provider.trim().to_lowercase()
        && existing.model == params.model.trim()
        && existing.allowed_roles == params.allowed_roles
        && existing.temperature == params.temperature
        && existing.top_p == params.top_p
        && existing.max_tokens == params.max_tokens
        && existing.context_window == params.context_window
        && existing.timeout_ms == params.timeout_ms
        && existing.max_retries == params.max_retries
        && existing.max_concurrency == params.max_concurrency
        && existing.supports_tool_calling == params.supports_tool_calling
        && existing.supports_structured_output == params.supports_structured_output
        && existing.supports_parallel_requests == params.supports_parallel_requests
        && existing.input_cost_per_1k_microunits == params.input_cost_per_1k_microunits
        && existing.output_cost_per_1k_microunits == params.output_cost_per_1k_microunits
        && existing.per_request_cost_ceiling_microunits
            == params.per_request_cost_ceiling_microunits
}

fn policy_matches(
    existing: &AiIntelligencePolicy,
    params: &RegisterAiIntelligencePolicyParams,
) -> bool {
    existing.policy_key == params.policy_key.trim()
        && existing.policy_version == params.policy_version
        && existing.default_decision_profile == params.default_decision_profile
        && existing.default_reasoning_profile == params.default_reasoning_profile
        && existing.default_generation_profile == params.default_generation_profile
        && existing.default_review_profile == params.default_review_profile
        && existing.shadow_profiles == params.shadow_profiles
        && existing.decision_type_overrides_json == params.decision_type_overrides_json
        && existing.fallback_profiles_json == params.fallback_profiles_json
}
