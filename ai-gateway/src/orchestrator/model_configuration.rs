//! Versioned model-profile and intelligence-policy resolution.
//!
//! DecisionGraph and ERP code never select provider/model names. They request
//! an intelligence role; this layer resolves the versioned profile selected by
//! organizational policy. Existing AiAgent configuration is retained only as
//! a compatibility fallback when no explicit intelligence policy exists.

use std::collections::HashMap;

use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::Value;
use stdb_client::StdbClient;

use crate::{
    ai_agent::ResolvedAgentConfig,
    providers::llm::normalize_provider,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(super) enum IntelligenceRole {
    Decision,
    Reasoning,
    Generation,
    Review,
    Shadow,
}

impl IntelligenceRole {
    pub fn label(self) -> &'static str {
        match self {
            Self::Decision => "decision",
            Self::Reasoning => "reasoning",
            Self::Generation => "generation",
            Self::Review => "review",
            Self::Shadow => "shadow",
        }
    }

    pub fn requires_tool_calling(self) -> bool {
        matches!(self, Self::Decision | Self::Reasoning | Self::Review)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(super) struct ModelProfileRef {
    pub key: String,
    pub version: u32,
}

impl ModelProfileRef {
    pub fn parse(value: &str) -> Result<Self> {
        let (key, version) = value
            .trim()
            .rsplit_once('@')
            .context("model profile ref must use profile_key@version")?;
        if key.trim().is_empty() {
            bail!("model profile key must be nonempty");
        }
        let version = version
            .parse::<u32>()
            .context("model profile version must be a positive integer")?;
        if version == 0 {
            bail!("model profile version must be positive");
        }
        Ok(Self {
            key: key.trim().to_string(),
            version,
        })
    }

    pub fn stable_ref(&self) -> String {
        format!("{}@{}", self.key, self.version)
    }
}

#[derive(Clone, Debug)]
pub(super) struct ModelProfile {
    pub reference: ModelProfileRef,
    pub provider: String,
    pub model: String,
    pub allowed_roles: Vec<IntelligenceRole>,
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

impl ModelProfile {
    pub fn validate_for(&self, role: IntelligenceRole) -> Result<()> {
        if self.provider.trim().is_empty() || self.model.trim().is_empty() {
            bail!("model profile must define provider and model");
        }
        if normalize_provider(&self.provider).trim().is_empty() {
            bail!("model profile provider must be nonempty");
        }
        if !self.allowed_roles.contains(&role) {
            bail!(
                "model profile '{}' does not allow '{}' role",
                self.reference.stable_ref(),
                role.label()
            );
        }
        if role.requires_tool_calling() && !self.supports_tool_calling {
            bail!(
                "model profile '{}' lacks tool-calling required by '{}' role",
                self.reference.stable_ref(),
                role.label()
            );
        }
        if self.max_tokens == 0 || self.context_window == 0 || self.max_concurrency == 0 {
            bail!("model profile limits must be positive");
        }
        Ok(())
    }

    pub fn legacy(agent: &ResolvedAgentConfig) -> Self {
        let provider = normalize_provider(&agent.provider);
        let supports_tools = provider != "ollama";
        Self {
            reference: ModelProfileRef {
                key: "legacy-agent-default".to_string(),
                version: 1,
            },
            provider,
            model: agent.model.clone(),
            allowed_roles: vec![
                IntelligenceRole::Decision,
                IntelligenceRole::Reasoning,
                IntelligenceRole::Generation,
                IntelligenceRole::Review,
                IntelligenceRole::Shadow,
            ],
            temperature: Some(agent.temperature),
            top_p: Some(agent.top_p),
            max_tokens: agent.max_tokens,
            context_window: agent.context_window,
            timeout_ms: 60_000,
            max_retries: 0,
            max_concurrency: 1,
            supports_tool_calling: supports_tools,
            supports_structured_output: supports_tools,
            supports_parallel_requests: true,
            input_cost_per_1k_microunits: None,
            output_cost_per_1k_microunits: None,
            per_request_cost_ceiling_microunits: None,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct DecisionTypeOverrideWire {
    #[serde(default)]
    primary: Option<String>,
    #[serde(default)]
    review: Option<String>,
    #[serde(default)]
    shadows: Vec<String>,
    #[serde(default, rename = "requireDistinctReviewProfile")]
    require_distinct_review_profile: bool,
    #[serde(default, rename = "requireDistinctReviewProvider")]
    require_distinct_review_provider: bool,
    #[serde(default, rename = "preferDistinctReviewProvider")]
    prefer_distinct_review_provider: bool,
}

#[derive(Clone, Debug)]
struct DecisionTypeOverride {
    primary: Option<ModelProfileRef>,
    review: Option<ModelProfileRef>,
    shadows: Vec<ModelProfileRef>,
    require_distinct_review_profile: bool,
    require_distinct_review_provider: bool,
    prefer_distinct_review_provider: bool,
}

#[derive(Clone, Debug)]
pub(super) struct IntelligencePolicy {
    pub key: String,
    pub version: u32,
    defaults: HashMap<IntelligenceRole, ModelProfileRef>,
    shadows: Vec<ModelProfileRef>,
    overrides: HashMap<String, DecisionTypeOverride>,
    fallbacks: HashMap<IntelligenceRole, Vec<ModelProfileRef>>,
}

#[derive(Clone, Debug)]
pub(super) struct IntelligenceRoute {
    pub role: IntelligenceRole,
    pub primary: ModelProfile,
    pub fallbacks: Vec<ModelProfile>,
    pub shadows: Vec<ModelProfile>,
    pub policy_ref: String,
}

#[async_trait]
pub(super) trait ModelConfigurationStore: Send + Sync {
    async fn profile(
        &self,
        organization_id: u64,
        reference: &ModelProfileRef,
    ) -> Result<Option<ModelProfile>>;

    async fn policy(
        &self,
        organization_id: u64,
        policy_key: &str,
        policy_version: Option<u32>,
    ) -> Result<Option<IntelligencePolicy>>;
}

pub(super) struct StdbModelConfigurationStore<'a> {
    pub reader: &'a StdbClient,
}

#[async_trait]
impl ModelConfigurationStore for StdbModelConfigurationStore<'_> {
    async fn profile(
        &self,
        organization_id: u64,
        reference: &ModelProfileRef,
    ) -> Result<Option<ModelProfile>> {
        if organization_id == 0 {
            bail!("organization_id must be nonzero");
        }
        let key = sql_escape(&reference.key);
        let rows = self
            .reader
            .query_sql(&format!(
                "SELECT * FROM ai_model_profile WHERE organization_id = {organization_id} \
                 AND profile_key = '{key}' AND profile_version = {} \
                 AND is_active = true LIMIT 1",
                reference.version
            ))
            .await
            .context("load model profile")?;
        rows.first().map(decode_profile).transpose()
    }

    async fn policy(
        &self,
        organization_id: u64,
        policy_key: &str,
        policy_version: Option<u32>,
    ) -> Result<Option<IntelligencePolicy>> {
        if organization_id == 0 {
            bail!("organization_id must be nonzero");
        }
        let key = sql_escape(policy_key);
        let version_clause = policy_version
            .map(|version| format!("AND policy_version = {version}"))
            .unwrap_or_default();
        let rows = self
            .reader
            .query_sql(&format!(
                "SELECT * FROM ai_intelligence_policy WHERE organization_id = {organization_id} \
                 AND policy_key = '{key}' {version_clause} AND is_active = true \
                 ORDER BY policy_version DESC LIMIT 1"
            ))
            .await
            .context("load intelligence policy")?;
        rows.first().map(decode_policy).transpose()
    }
}

pub(super) struct IntelligenceRouteResolver<'a> {
    store: &'a dyn ModelConfigurationStore,
    organization_id: u64,
    policy_key: Option<String>,
    policy_version: Option<u32>,
    explicit_policy: bool,
    require_policy: bool,
    legacy_profile: ModelProfile,
}

impl<'a> IntelligenceRouteResolver<'a> {
    pub fn new(
        store: &'a dyn ModelConfigurationStore,
        organization_id: u64,
        agent: &ResolvedAgentConfig,
        policy_ref: Option<&str>,
    ) -> Result<Self> {
        Self::new_with_mode(store, organization_id, agent, policy_ref, false)
    }

    pub fn new_governed(
        store: &'a dyn ModelConfigurationStore,
        organization_id: u64,
        agent: &ResolvedAgentConfig,
        policy_ref: Option<&str>,
    ) -> Result<Self> {
        Self::new_with_mode(store, organization_id, agent, policy_ref, true)
    }

    fn new_with_mode(
        store: &'a dyn ModelConfigurationStore,
        organization_id: u64,
        agent: &ResolvedAgentConfig,
        policy_ref: Option<&str>,
        require_policy: bool,
    ) -> Result<Self> {
        let explicit_policy = policy_ref.is_some_and(|value| !value.trim().is_empty());
        let (policy_key, policy_version) = match policy_ref {
            Some(value) if !value.trim().is_empty() => {
                let parsed = ModelProfileRef::parse(value)
                    .context("intelligence policy ref must use policy_key@version")?;
                (Some(parsed.key), Some(parsed.version))
            }
            _ => (Some("default".to_string()), None),
        };
        Ok(Self {
            store,
            organization_id,
            policy_key,
            policy_version,
            explicit_policy,
            require_policy,
            legacy_profile: ModelProfile::legacy(agent),
        })
    }

    pub async fn resolve(
        &self,
        role: IntelligenceRole,
        decision_type: Option<&str>,
    ) -> Result<IntelligenceRoute> {
        let Some(policy_key) = self.policy_key.as_deref() else {
            return self.legacy_route(role);
        };
        let Some(policy) = self
            .store
            .policy(self.organization_id, policy_key, self.policy_version)
            .await?
        else {
            if self.explicit_policy || self.require_policy {
                bail!(
                    "governed intelligence policy '{}{}' was not found",
                    policy_key,
                    self.policy_version
                        .map(|version| format!("@{version}"))
                        .unwrap_or_default()
                );
            }
            return self.legacy_route(role);
        };

        let primary_ref = policy.primary_ref(role, decision_type)?;
        let primary = self
            .load_profile(&primary_ref, role)
            .await
            .with_context(|| format!("resolve primary '{}' profile", role.label()))?;
        let mut fallbacks = Vec::new();
        for reference in policy.fallback_refs(role) {
            fallbacks.push(self.load_profile(reference, role).await?);
        }
        let mut shadows = Vec::new();
        if role == IntelligenceRole::Decision {
            for reference in policy.shadow_refs(decision_type) {
                shadows.push(self.load_profile(reference, IntelligenceRole::Shadow).await?);
            }
        }

        Ok(IntelligenceRoute {
            role,
            primary,
            fallbacks,
            shadows,
            policy_ref: format!("{}@{}", policy.key, policy.version),
        })
    }

    pub async fn validate_review_independence(
        &self,
        decision_type: &str,
    ) -> Result<()> {
        let policy_key = self
            .policy_key
            .as_deref()
            .context("governed review independence requires a policy")?;
        let policy = self
            .store
            .policy(self.organization_id, policy_key, self.policy_version)
            .await?
            .context("governed review independence policy not found")?;
        let (
            mut require_distinct_profile,
            require_distinct_provider,
            mut prefer_distinct_provider,
        ) = policy.review_independence(Some(decision_type));
        if self.require_policy
            && !require_distinct_profile
            && !require_distinct_provider
            && !prefer_distinct_provider
        {
            require_distinct_profile = true;
            prefer_distinct_provider = true;
        }
        if require_distinct_provider {
            require_distinct_profile = true;
        }
        if !require_distinct_profile && !require_distinct_provider && !prefer_distinct_provider {
            return Ok(());
        }

        let decision_ref = policy.primary_ref(IntelligenceRole::Decision, Some(decision_type))?;
        let review_ref = policy.primary_ref(IntelligenceRole::Review, Some(decision_type))?;
        let decision = self.load_profile(&decision_ref, IntelligenceRole::Decision).await?;
        let review = self.load_profile(&review_ref, IntelligenceRole::Review).await?;

        if require_distinct_profile && decision.reference == review.reference {
            bail!(
                "review profile must be distinct from decision profile for '{}'",
                decision_type
            );
        }
        let same_provider =
            normalize_provider(&decision.provider) == normalize_provider(&review.provider);
        if require_distinct_provider && same_provider {
            bail!(
                "review provider must be distinct from decision provider for '{}' (both resolve to '{}')",
                decision_type,
                normalize_provider(&decision.provider)
            );
        }
        if prefer_distinct_provider && same_provider {
            tracing::warn!(
                decision_type,
                provider = %decision.provider,
                "review policy prefers a distinct provider but only a distinct profile is configured"
            );
        }
        Ok(())
    }

    async fn load_profile(
        &self,
        reference: &ModelProfileRef,
        role: IntelligenceRole,
    ) -> Result<ModelProfile> {
        let profile = self
            .store
            .profile(self.organization_id, reference)
            .await?
            .with_context(|| format!("model profile '{}' not found", reference.stable_ref()))?;
        profile.validate_for(role)?;
        Ok(profile)
    }

    fn legacy_route(&self, role: IntelligenceRole) -> Result<IntelligenceRoute> {
        self.legacy_profile.validate_for(role)?;
        Ok(IntelligenceRoute {
            role,
            primary: self.legacy_profile.clone(),
            fallbacks: Vec::new(),
            shadows: Vec::new(),
            policy_ref: "legacy-agent-default@1".to_string(),
        })
    }
}

impl IntelligencePolicy {
    fn primary_ref(
        &self,
        role: IntelligenceRole,
        decision_type: Option<&str>,
    ) -> Result<ModelProfileRef> {
        if let Some(name) = decision_type {
            if let Some(override_) = self.overrides.get(name) {
                match role {
                    IntelligenceRole::Decision => {
                        if let Some(reference) = &override_.primary {
                            return Ok(reference.clone());
                        }
                    }
                    IntelligenceRole::Review => {
                        if let Some(reference) = &override_.review {
                            return Ok(reference.clone());
                        }
                    }
                    _ => {}
                }
            }
        }
        self.defaults
            .get(&role)
            .cloned()
            .with_context(|| format!("policy has no default '{}' profile", role.label()))
    }

    fn fallback_refs(&self, role: IntelligenceRole) -> &[ModelProfileRef] {
        self.fallbacks.get(&role).map(Vec::as_slice).unwrap_or(&[])
    }

    fn review_independence(
        &self,
        decision_type: Option<&str>,
    ) -> (bool, bool, bool) {
        decision_type
            .and_then(|name| self.overrides.get(name))
            .map(|override_| {
                (
                    override_.require_distinct_review_profile,
                    override_.require_distinct_review_provider,
                    override_.prefer_distinct_review_provider,
                )
            })
            .unwrap_or((false, false, false))
    }

    fn shadow_refs(&self, decision_type: Option<&str>) -> Vec<&ModelProfileRef> {
        if let Some(name) = decision_type {
            if let Some(override_) = self.overrides.get(name) {
                if !override_.shadows.is_empty() {
                    return override_.shadows.iter().collect();
                }
            }
        }
        self.shadows.iter().collect()
    }
}

fn decode_profile(row: &Value) -> Result<ModelProfile> {
    let allowed_roles = row_string_list(row, "allowedRoles")
        .into_iter()
        .map(|role| parse_role(&role))
        .collect::<Result<Vec<_>>>()?;
    let profile = ModelProfile {
        reference: ModelProfileRef {
            key: row_string(row, "profileKey").context("profileKey")?,
            version: row_u64(row, "profileVersion").context("profileVersion")? as u32,
        },
        provider: row_string(row, "provider").context("provider")?,
        model: row_string(row, "model").context("model")?,
        allowed_roles,
        temperature: row_f64(row, "temperature"),
        top_p: row_f64(row, "topP"),
        max_tokens: row_u64(row, "maxTokens").unwrap_or_default() as u32,
        context_window: row_u64(row, "contextWindow").unwrap_or_default() as u32,
        timeout_ms: row_u64(row, "timeoutMs").unwrap_or_default() as u32,
        max_retries: row_u64(row, "maxRetries").unwrap_or_default() as u32,
        max_concurrency: row_u64(row, "maxConcurrency").unwrap_or_default() as u32,
        supports_tool_calling: row_bool(row, "supportsToolCalling").unwrap_or(false),
        supports_structured_output: row_bool(row, "supportsStructuredOutput").unwrap_or(false),
        supports_parallel_requests: row_bool(row, "supportsParallelRequests").unwrap_or(false),
        input_cost_per_1k_microunits: row_u64(row, "inputCostPer1kMicrounits"),
        output_cost_per_1k_microunits: row_u64(row, "outputCostPer1kMicrounits"),
        per_request_cost_ceiling_microunits: row_u64(row, "perRequestCostCeilingMicrounits"),
    };
    Ok(profile)
}

fn decode_policy(row: &Value) -> Result<IntelligencePolicy> {
    let mut defaults = HashMap::new();
    for (role, field) in [
        (IntelligenceRole::Decision, "defaultDecisionProfile"),
        (IntelligenceRole::Reasoning, "defaultReasoningProfile"),
        (IntelligenceRole::Generation, "defaultGenerationProfile"),
        (IntelligenceRole::Review, "defaultReviewProfile"),
    ] {
        defaults.insert(
            role,
            ModelProfileRef::parse(&row_string(row, field).with_context(|| field.to_string())?)?,
        );
    }

    let overrides_raw = row_string(row, "decisionTypeOverridesJson")
        .unwrap_or_else(|| "{}".to_string());
    let overrides_wire: HashMap<String, DecisionTypeOverrideWire> =
        serde_json::from_str(&overrides_raw).context("parse decision type overrides")?;
    let mut overrides = HashMap::new();
    for (name, wire) in overrides_wire {
        overrides.insert(
            name,
            DecisionTypeOverride {
                primary: wire.primary.as_deref().map(ModelProfileRef::parse).transpose()?,
                review: wire.review.as_deref().map(ModelProfileRef::parse).transpose()?,
                shadows: wire
                    .shadows
                    .iter()
                    .map(|value| ModelProfileRef::parse(value))
                    .collect::<Result<Vec<_>>>()?,
                require_distinct_review_profile: wire.require_distinct_review_profile,
                require_distinct_review_provider: wire.require_distinct_review_provider,
                prefer_distinct_review_provider: wire.prefer_distinct_review_provider,
            },
        );
    }

    let fallbacks_raw =
        row_string(row, "fallbackProfilesJson").unwrap_or_else(|| "{}".to_string());
    let fallback_wire: HashMap<String, Vec<String>> =
        serde_json::from_str(&fallbacks_raw).context("parse fallback profile map")?;
    let mut fallbacks = HashMap::new();
    for (role, refs) in fallback_wire {
        let role = parse_role(&role)?;
        fallbacks.insert(
            role,
            refs.iter()
                .map(|value| ModelProfileRef::parse(value))
                .collect::<Result<Vec<_>>>()?,
        );
    }

    Ok(IntelligencePolicy {
        key: row_string(row, "policyKey").context("policyKey")?,
        version: row_u64(row, "policyVersion").context("policyVersion")? as u32,
        defaults,
        shadows: row_string_list(row, "shadowProfiles")
            .iter()
            .map(|value| ModelProfileRef::parse(value))
            .collect::<Result<Vec<_>>>()?,
        overrides,
        fallbacks,
    })
}

fn parse_role(value: &str) -> Result<IntelligenceRole> {
    match value {
        "decision" => Ok(IntelligenceRole::Decision),
        "reasoning" => Ok(IntelligenceRole::Reasoning),
        "generation" => Ok(IntelligenceRole::Generation),
        "review" => Ok(IntelligenceRole::Review),
        "shadow" => Ok(IntelligenceRole::Shadow),
        other => bail!("unknown intelligence role '{other}'"),
    }
}

fn sql_escape(value: &str) -> String {
    value.replace('\'', "''")
}

fn snake(key: &str) -> String {
    let mut out = String::with_capacity(key.len() + 4);
    for ch in key.chars() {
        if ch.is_ascii_uppercase() {
            out.push('_');
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

fn field<'a>(row: &'a Value, key: &str) -> Option<&'a Value> {
    let snake = snake(key);
    row.get(key).or_else(|| row.get(&snake))
}

fn row_string(row: &Value, key: &str) -> Option<String> {
    field(row, key).and_then(Value::as_str).map(str::to_string)
}

fn row_u64(row: &Value, key: &str) -> Option<u64> {
    field(row, key).and_then(|value| {
        value
            .as_u64()
            .or_else(|| value.as_str().and_then(|raw| raw.parse().ok()))
    })
}

fn row_f64(row: &Value, key: &str) -> Option<f64> {
    field(row, key).and_then(|value| {
        value
            .as_f64()
            .or_else(|| value.as_str().and_then(|raw| raw.parse().ok()))
    })
}

fn row_bool(row: &Value, key: &str) -> Option<bool> {
    field(row, key).and_then(Value::as_bool)
}

fn row_string_list(row: &Value, key: &str) -> Vec<String> {
    field(row, key)
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct FakeStore {
        profiles: Mutex<HashMap<(u64, String, u32), ModelProfile>>,
        policies: Mutex<HashMap<(u64, String, u32), IntelligencePolicy>>,
    }

    impl FakeStore {
        fn new() -> Self {
            Self {
                profiles: Mutex::new(HashMap::new()),
                policies: Mutex::new(HashMap::new()),
            }
        }

        fn insert_profile(&self, organization_id: u64, profile: ModelProfile) {
            self.profiles.lock().unwrap().insert(
                (
                    organization_id,
                    profile.reference.key.clone(),
                    profile.reference.version,
                ),
                profile,
            );
        }

        fn insert_policy(&self, organization_id: u64, policy: IntelligencePolicy) {
            self.policies.lock().unwrap().insert(
                (organization_id, policy.key.clone(), policy.version),
                policy,
            );
        }
    }

    #[async_trait]
    impl ModelConfigurationStore for FakeStore {
        async fn profile(
            &self,
            organization_id: u64,
            reference: &ModelProfileRef,
        ) -> Result<Option<ModelProfile>> {
            Ok(self
                .profiles
                .lock()
                .unwrap()
                .get(&(organization_id, reference.key.clone(), reference.version))
                .cloned())
        }

        async fn policy(
            &self,
            organization_id: u64,
            policy_key: &str,
            policy_version: Option<u32>,
        ) -> Result<Option<IntelligencePolicy>> {
            let policies = self.policies.lock().unwrap();
            if let Some(version) = policy_version {
                return Ok(policies
                    .get(&(organization_id, policy_key.to_string(), version))
                    .cloned());
            }
            Ok(policies
                .iter()
                .filter(|((org, key, _), _)| *org == organization_id && key == policy_key)
                .max_by_key(|((_, _, version), _)| *version)
                .map(|(_, policy)| policy.clone()))
        }
    }

    fn agent() -> ResolvedAgentConfig {
        ResolvedAgentConfig {
            agent_id: 7,
            provider: "mistral".to_string(),
            model: "legacy-model".to_string(),
            system_prompt: "test".to_string(),
            temperature: 0.7,
            max_tokens: 2048,
            context_window: 32_000,
            top_p: 1.0,
            allowed_actions: vec!["skill_run".to_string()],
            allowed_models: Vec::new(),
            monthly_budget: None,
            monthly_spend: 0.0,
            cost_per_1k_tokens: 0.0,
            rate_limit_per_minute: 60,
        }
    }

    fn profile(key: &str, role: IntelligenceRole, model: &str) -> ModelProfile {
        ModelProfile {
            reference: ModelProfileRef {
                key: key.to_string(),
                version: 1,
            },
            provider: "mistral".to_string(),
            model: model.to_string(),
            allowed_roles: vec![role],
            temperature: Some(0.1),
            top_p: Some(0.9),
            max_tokens: 1024,
            context_window: 32_000,
            timeout_ms: 30_000,
            max_retries: 0,
            max_concurrency: 1,
            supports_tool_calling: !matches!(role, IntelligenceRole::Generation),
            supports_structured_output: true,
            supports_parallel_requests: true,
            input_cost_per_1k_microunits: None,
            output_cost_per_1k_microunits: None,
            per_request_cost_ceiling_microunits: None,
        }
    }

    fn policy() -> IntelligencePolicy {
        IntelligencePolicy {
            key: "default".to_string(),
            version: 1,
            defaults: HashMap::from([
                (
                    IntelligenceRole::Decision,
                    ModelProfileRef {
                        key: "decision".to_string(),
                        version: 1,
                    },
                ),
                (
                    IntelligenceRole::Reasoning,
                    ModelProfileRef {
                        key: "reasoning".to_string(),
                        version: 1,
                    },
                ),
                (
                    IntelligenceRole::Generation,
                    ModelProfileRef {
                        key: "generation".to_string(),
                        version: 1,
                    },
                ),
                (
                    IntelligenceRole::Review,
                    ModelProfileRef {
                        key: "review".to_string(),
                        version: 1,
                    },
                ),
            ]),
            shadows: Vec::new(),
            overrides: HashMap::from([(
                "FraudConcern".to_string(),
                DecisionTypeOverride {
                    primary: Some(ModelProfileRef {
                        key: "fraud".to_string(),
                        version: 1,
                    }),
                    review: None,
                    shadows: Vec::new(),
                    require_distinct_review_profile: false,
                    require_distinct_review_provider: false,
                    prefer_distinct_review_provider: false,
                },
            )]),
            fallbacks: HashMap::new(),
        }
    }

    #[tokio::test]
    async fn resolves_default_profile_by_intelligence_role() {
        let store = FakeStore::new();
        store.insert_profile(9, profile("decision", IntelligenceRole::Decision, "decision-model"));
        store.insert_policy(9, policy());

        let resolver = IntelligenceRouteResolver::new(&store, 9, &agent(), None).unwrap();
        let route = resolver
            .resolve(IntelligenceRole::Decision, Some("PaymentDisposition"))
            .await
            .unwrap();

        assert_eq!(route.primary.model, "decision-model");
        assert_eq!(route.policy_ref, "default@1");
    }

    #[tokio::test]
    async fn resolves_shadow_profiles_only_for_decision_role() {
        let store = FakeStore::new();
        store.insert_profile(9, profile("decision", IntelligenceRole::Decision, "decision-model"));
        store.insert_profile(9, profile("reasoning", IntelligenceRole::Reasoning, "reasoning-model"));
        store.insert_profile(9, profile("shadow-a", IntelligenceRole::Shadow, "shadow-a-model"));
        let mut with_shadows = policy();
        with_shadows.shadows = vec![ModelProfileRef {
            key: "shadow-a".to_string(),
            version: 1,
        }];
        store.insert_policy(9, with_shadows);

        let resolver = IntelligenceRouteResolver::new(&store, 9, &agent(), None).unwrap();

        let decision_route = resolver
            .resolve(IntelligenceRole::Decision, Some("PaymentDisposition"))
            .await
            .unwrap();
        assert_eq!(decision_route.shadows.len(), 1);
        assert_eq!(decision_route.shadows[0].model, "shadow-a-model");

        // Shadows are a decision-only concept: no other role resolves them,
        // even though the same policy carries `shadow_profiles`.
        let reasoning_route = resolver
            .resolve(IntelligenceRole::Reasoning, None)
            .await
            .unwrap();
        assert!(reasoning_route.shadows.is_empty());
    }

    #[tokio::test]
    async fn decision_type_override_changes_profile_not_program_semantics() {
        let store = FakeStore::new();
        store.insert_profile(9, profile("decision", IntelligenceRole::Decision, "decision-model"));
        store.insert_profile(9, profile("fraud", IntelligenceRole::Decision, "fraud-model"));
        store.insert_policy(9, policy());

        let resolver = IntelligenceRouteResolver::new(&store, 9, &agent(), None).unwrap();
        let route = resolver
            .resolve(IntelligenceRole::Decision, Some("FraudConcern"))
            .await
            .unwrap();

        assert_eq!(route.primary.reference.key, "fraud");
        assert_eq!(route.primary.model, "fraud-model");
    }

    #[tokio::test]
    async fn explicit_policy_missing_fails_closed() {
        let store = FakeStore::new();
        let resolver =
            IntelligenceRouteResolver::new(&store, 9, &agent(), Some("production@7")).unwrap();

        let error = resolver
            .resolve(IntelligenceRole::Decision, Some("FraudConcern"))
            .await
            .unwrap_err();

        assert!(error.to_string().contains("governed intelligence policy"));
    }

    #[tokio::test]
    async fn governed_resolver_fails_closed_when_default_policy_is_absent() {
        let store = InMemoryModelConfigurationStore::new();
        let resolver =
            IntelligenceRouteResolver::new_governed(&store, 9, &agent(), None).unwrap();
        let error = resolver
            .resolve(IntelligenceRole::Decision, Some("ReportAttentionNeed"))
            .await
            .unwrap_err();
        assert!(error.to_string().contains("governed intelligence policy"));
    }

    #[tokio::test]
    async fn absent_default_policy_uses_legacy_agent_profile() {
        let store = FakeStore::new();
        let resolver = IntelligenceRouteResolver::new(&store, 9, &agent(), None).unwrap();

        let route = resolver
            .resolve(IntelligenceRole::Generation, None)
            .await
            .unwrap();

        assert_eq!(route.policy_ref, "legacy-agent-default@1");
        assert_eq!(route.primary.model, "legacy-model");
    }
}
