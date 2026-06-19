//! SpacetimeDB AI agent resolution and spend tracking.

use anyhow::{Context, Result};
use serde_json::Value;
use stdb_client::StdbClient;

use crate::{
    error::AppError,
    providers::llm::normalize_provider,
    rate_limit::AgentRateLimiter,
};

const BASE_ERP_RULES: &str = "You are an intelligent ERP assistant for Lumiere. Answer using only the provided context. Be concise and factual. If the context is insufficient, say so. Never invent data or claim to have performed mutations.";

#[derive(Clone, Debug)]
pub struct ResolvedAgentConfig {
    pub agent_id: u64,
    pub provider: String,
    pub model: String,
    pub system_prompt: String,
    pub temperature: f64,
    pub max_tokens: u32,
    pub top_p: f64,
    pub allowed_actions: Vec<String>,
    pub allowed_models: Vec<String>,
    pub monthly_budget: Option<f64>,
    pub monthly_spend: f64,
    pub cost_per_1k_tokens: f64,
    pub rate_limit_per_minute: u32,
}

#[derive(Clone, Debug, Default)]
pub struct TeamMemberPersona {
    pub name: String,
    pub role: String,
    pub responsibilities: Vec<String>,
    pub expertise_areas: Vec<String>,
    pub personality: Option<String>,
    pub response_style: String,
}

pub async fn resolve_agent(
    stdb: &StdbClient,
    org_id: u64,
    agent_id: Option<u64>,
    team_member_id: Option<u64>,
) -> Result<ResolvedAgentConfig> {
    let (agent_row, persona) = if let Some(member_id) = team_member_id {
        let member = fetch_team_member(stdb, org_id, member_id).await?;
        let agent = fetch_agent(stdb, org_id, member.ai_agent_id).await?;
        (agent, Some(member.persona))
    } else if let Some(id) = agent_id {
        (fetch_agent(stdb, org_id, id).await?, None)
    } else {
        (fetch_default_agent(stdb, org_id).await?, None)
    };

    let config = row_to_agent_config(&agent_row, persona.as_ref())?;
    validate_provider(&config.provider)?;
    Ok(config)
}

pub fn agent_allows_live_read(agent: &ResolvedAgentConfig) -> bool {
    agent
        .allowed_actions
        .iter()
        .any(|action| action == "live_read" || action == "chat")
}

pub fn ensure_allowed_action(agent: &ResolvedAgentConfig, action: &str) -> Result<()> {
    if agent.allowed_actions.iter().any(|a| a == action) {
        return Ok(());
    }
    // Backward compatibility with seeded actions
    if action == "form_suggest"
        && agent
            .allowed_actions
            .iter()
            .any(|a| a == "summarize" || a == "form_suggest")
    {
        return Ok(());
    }
    if action == "action_draft"
        && agent
            .allowed_actions
            .iter()
            .any(|a| {
                a == "action_draft"
                    || a == "chat"
                    || a == "summarize"
                    || a == "form_suggest"
            })
    {
        return Ok(());
    }
    if action == "skill_run"
        && agent
            .allowed_actions
            .iter()
            .any(|a| a == "skill_run" || a == "chat" || a == "summarize")
    {
        return Ok(());
    }
    anyhow::bail!("Agent is not allowed to perform action '{action}'");
}

pub fn ensure_within_budget(agent: &ResolvedAgentConfig) -> Result<()> {
    if let Some(budget) = agent.monthly_budget {
        if agent.monthly_spend >= budget {
            anyhow::bail!(
                "AI agent monthly budget exceeded (spent {:.4} of {:.4} cap)",
                agent.monthly_spend,
                budget
            );
        }
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentLimitViolation {
    BudgetExceeded(String),
    RateLimitExceeded(String),
}

impl AgentLimitViolation {
    pub fn into_app_error(self) -> AppError {
        match self {
            Self::BudgetExceeded(message) => AppError::BudgetExceeded(message),
            Self::RateLimitExceeded(message) => AppError::RateLimitExceeded(message),
        }
    }
}

impl std::fmt::Display for AgentLimitViolation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BudgetExceeded(message) | Self::RateLimitExceeded(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for AgentLimitViolation {}

/// Enforce monthly budget and per-minute rate limits immediately before a chargeable LLM call.
pub fn enforce_chargeable_limits(
    limiter: &AgentRateLimiter,
    org_id: u64,
    agent: &ResolvedAgentConfig,
) -> Result<(), AgentLimitViolation> {
    ensure_within_budget(agent).map_err(|err| AgentLimitViolation::BudgetExceeded(err.to_string()))?;

    if agent.rate_limit_per_minute > 0
        && !limiter.check_and_acquire(org_id, agent.agent_id, agent.rate_limit_per_minute)
    {
        return Err(AgentLimitViolation::RateLimitExceeded(format!(
            "AI agent rate limit exceeded: maximum {} requests per minute",
            agent.rate_limit_per_minute
        )));
    }

    Ok(())
}

pub fn map_anyhow_limit_error(err: anyhow::Error) -> AppError {
    if let Some(violation) = err.downcast_ref::<AgentLimitViolation>() {
        return violation.clone().into_app_error();
    }
    AppError::Internal(err.to_string())
}

pub fn ensure_model_allowed(agent: &ResolvedAgentConfig) -> Result<()> {
    if agent.allowed_models.is_empty() {
        return Ok(());
    }
    if agent
        .allowed_models
        .iter()
        .any(|m| m.eq_ignore_ascii_case(&agent.model))
    {
        return Ok(());
    }
    anyhow::bail!("Model '{}' is not in agent allowed_models", agent.model);
}

pub async fn record_ai_spend(
    stdb: &StdbClient,
    org_id: u64,
    agent_id: u64,
    tokens_used: u32,
) -> Result<()> {
    stdb.call_reducer(
        "record_ai_spend",
        serde_json::json!([org_id, agent_id, tokens_used]),
    )
    .await
    .context("record_ai_spend reducer failed")
}

struct AgentRow {
    id: u64,
    provider: String,
    model: String,
    system_prompt: Option<String>,
    temperature: f64,
    max_tokens: u32,
    top_p: f64,
    allowed_actions: Vec<String>,
    allowed_models: Vec<String>,
    monthly_budget: Option<f64>,
    monthly_spend: f64,
    cost_per_1k_tokens: f64,
    rate_limit_per_minute: u32,
}

struct TeamMemberRow {
    ai_agent_id: u64,
    persona: TeamMemberPersona,
}

async fn fetch_agent(stdb: &StdbClient, org_id: u64, agent_id: u64) -> Result<AgentRow> {
    let sql = format!(
        "SELECT * FROM ai_agent WHERE id = {agent_id} AND organization_id = {org_id} LIMIT 1"
    );
    let rows = stdb.query_sql(&sql).await?;
    let row = rows
        .first()
        .context("AI agent not found")?;
    parse_agent_row(row)
}

async fn fetch_default_agent(stdb: &StdbClient, org_id: u64) -> Result<AgentRow> {
    let sql = format!(
        "SELECT * FROM ai_agent WHERE organization_id = {org_id} AND is_default = true AND is_active = true LIMIT 1"
    );
    let rows = stdb.query_sql(&sql).await?;
    let row = rows
        .first()
        .context("No default AI agent configured for this organization")?;
    parse_agent_row(row)
}

async fn fetch_team_member(
    stdb: &StdbClient,
    org_id: u64,
    member_id: u64,
) -> Result<TeamMemberRow> {
    let sql = format!(
        "SELECT * FROM ai_team_member WHERE id = {member_id} AND organization_id = {org_id} LIMIT 1"
    );
    let rows = stdb.query_sql(&sql).await?;
    let row = rows.first().context("AI team member not found")?;

    let ai_agent_id = u64_field(row, "aiAgentId", "ai_agent_id")
        .context("team member missing ai_agent_id")?;

    Ok(TeamMemberRow {
        ai_agent_id,
        persona: TeamMemberPersona {
            name: string_field(row, "name", None).unwrap_or_default(),
            role: string_field(row, "role", None).unwrap_or_default(),
            responsibilities: string_vec_field(row, "responsibilities", None),
            expertise_areas: string_vec_field(row, "expertiseAreas", Some("expertise_areas")),
            personality: string_field(row, "personality", None),
            response_style: string_field(row, "responseStyle", Some("response_style"))
                .unwrap_or_else(|| "Professional".to_string()),
        },
    })
}

fn parse_agent_row(row: &Value) -> Result<AgentRow> {
    let is_active = row
        .get("isActive")
        .or_else(|| row.get("is_active"))
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    if !is_active {
        anyhow::bail!("AI agent is inactive");
    }

    Ok(AgentRow {
        id: u64_field(row, "id", "id").context("agent id")?,
        provider: string_field(row, "provider", None).context("agent provider")?,
        model: string_field(row, "model", None).context("agent model")?,
        system_prompt: string_field(row, "systemPrompt", Some("system_prompt")),
        temperature: f64_field(row, "temperature", None).unwrap_or(0.7),
        max_tokens: u64_field(row, "maxTokens", "max_tokens")
            .map(|v| v as u32)
            .unwrap_or(4096),
        top_p: f64_field(row, "topP", Some("top_p")).unwrap_or(1.0),
        allowed_actions: string_vec_field(row, "allowedActions", Some("allowed_actions")),
        allowed_models: string_vec_field(row, "allowedModels", Some("allowed_models")),
        monthly_budget: optional_f64(row, "monthlyBudget", "monthly_budget"),
        monthly_spend: f64_field(row, "monthlySpend", Some("monthly_spend")).unwrap_or(0.0),
        cost_per_1k_tokens: f64_field(row, "costPer1KTokens", Some("cost_per_1k_tokens"))
            .unwrap_or(0.0),
        rate_limit_per_minute: u64_field(row, "rateLimitPerMinute", "rate_limit_per_minute")
            .map(|v| v as u32)
            .unwrap_or(0),
    })
}

fn row_to_agent_config(row: &AgentRow, persona: Option<&TeamMemberPersona>) -> Result<ResolvedAgentConfig> {
    let mut system_prompt = BASE_ERP_RULES.to_string();
    if let Some(custom) = row.system_prompt.as_deref().filter(|s| !s.trim().is_empty()) {
        system_prompt.push_str("\n\n");
        system_prompt.push_str(custom);
    }
    if let Some(p) = persona {
        system_prompt.push_str("\n\nPersona:\n");
        system_prompt.push_str(&format!("Name: {}\nRole: {}\n", p.name, p.role));
        if !p.responsibilities.is_empty() {
            system_prompt.push_str(&format!(
                "Responsibilities: {}\n",
                p.responsibilities.join(", ")
            ));
        }
        if !p.expertise_areas.is_empty() {
            system_prompt.push_str(&format!(
                "Expertise: {}\n",
                p.expertise_areas.join(", ")
            ));
        }
        if let Some(personality) = p.personality.as_deref().filter(|s| !s.is_empty()) {
            system_prompt.push_str(&format!("Personality: {personality}\n"));
        }
        system_prompt.push_str(&format!("Response style: {}\n", p.response_style));
    }

    Ok(ResolvedAgentConfig {
        agent_id: row.id,
        provider: row.provider.clone(),
        model: row.model.clone(),
        system_prompt,
        temperature: row.temperature,
        max_tokens: row.max_tokens,
        top_p: row.top_p,
        allowed_actions: row.allowed_actions.clone(),
        allowed_models: row.allowed_models.clone(),
        monthly_budget: row.monthly_budget,
        monthly_spend: row.monthly_spend,
        cost_per_1k_tokens: row.cost_per_1k_tokens,
        rate_limit_per_minute: row.rate_limit_per_minute,
    })
}

fn validate_provider(provider: &str) -> Result<()> {
    match normalize_provider(provider).as_str() {
        "mistral" | "gemini" | "ollama" => Ok(()),
        other => anyhow::bail!(
            "Unsupported provider '{other}'. Configure Mistral, Gemini, or Ollama."
        ),
    }
}

fn u64_field(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
}

fn f64_field(row: &Value, camel: &str, snake: Option<&str>) -> Option<f64> {
    let v = row
        .get(camel)
        .or_else(|| snake.and_then(|s| row.get(s)))?;
    v.as_f64()
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

fn optional_f64(row: &Value, camel: &str, snake: &str) -> Option<f64> {
    f64_field(row, camel, Some(snake))
}

fn string_field(row: &Value, camel: &str, snake: Option<&str>) -> Option<String> {
    row.get(camel)
        .or_else(|| snake.and_then(|s| row.get(s)))
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

fn string_vec_field(row: &Value, camel: &str, snake: Option<&str>) -> Vec<String> {
    row.get(camel)
        .or_else(|| snake.and_then(|s| row.get(s)))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_agent(monthly_budget: Option<f64>, monthly_spend: f64, rate_limit: u32) -> ResolvedAgentConfig {
        ResolvedAgentConfig {
            agent_id: 9,
            provider: "mistral".to_string(),
            model: "mistral-small".to_string(),
            system_prompt: "test".to_string(),
            temperature: 0.7,
            max_tokens: 1024,
            top_p: 1.0,
            allowed_actions: vec!["chat".to_string()],
            allowed_models: vec![],
            monthly_budget,
            monthly_spend,
            cost_per_1k_tokens: 0.01,
            rate_limit_per_minute: rate_limit,
        }
    }

    #[test]
    fn ensure_within_budget_rejects_exhausted_cap() {
        let agent = sample_agent(Some(10.0), 10.0, 60);
        let err = ensure_within_budget(&agent).unwrap_err();
        assert!(err.to_string().contains("monthly budget exceeded"));
    }

    #[test]
    fn enforce_chargeable_limits_applies_rate_limit() {
        let limiter = AgentRateLimiter::new();
        let agent = sample_agent(None, 0.0, 1);
        enforce_chargeable_limits(&limiter, 1, &agent).expect("first request");
        let err = enforce_chargeable_limits(&limiter, 1, &agent).unwrap_err();
        assert!(matches!(err, AgentLimitViolation::RateLimitExceeded(_)));
    }
}
