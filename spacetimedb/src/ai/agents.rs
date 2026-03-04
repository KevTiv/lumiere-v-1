/// AI Agents Module — AI model configurations and team member personas
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **AiAgent** | AI model configuration (provider, params, budget) |
/// | **AiTeamMember** | AI persona with role, personality, and responsibilities |
use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};

// ============================================================================
// TABLES
// ============================================================================

/// AiAgent — Configuration for an AI model used within the system
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_agent,
    public,
    index(name = "by_company", accessor = ai_agent_by_company, btree(columns = [company_id]))
)]
pub struct AiAgent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub name: String,
    pub description: Option<String>,
    pub model: String,                 // e.g., "claude-sonnet-4-6", "gpt-4o"
    pub provider: String,              // OpenAI, Anthropic, Ollama, Mistral, etc.
    pub api_key_reference: Option<String>, // Reference key name (never the key itself)
    pub temperature: f64,
    pub max_tokens: u32,
    pub top_p: f64,
    pub frequency_penalty: f64,
    pub presence_penalty: f64,
    pub system_prompt: Option<String>,
    pub context_window: u32,
    pub is_active: bool,
    pub is_default: bool,
    pub allowed_models: Vec<String>,
    pub allowed_actions: Vec<String>,
    pub rate_limit_per_minute: u32,
    pub cost_per_1k_tokens: f64,
    pub monthly_budget: Option<f64>,
    pub monthly_spend: f64,
    pub company_id: Option<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// AiTeamMember — An AI persona with a defined role and personality
#[spacetimedb::table(
    accessor = ai_team_member,
    public,
    index(name = "by_agent", accessor = team_member_by_agent, btree(columns = [ai_agent_id])),
    index(name = "by_company", accessor = team_member_by_company, btree(columns = [company_id]))
)]
pub struct AiTeamMember {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub name: String,
    pub ai_agent_id: u64,
    pub role: String,                    // Assistant, Analyst, Advisor, etc.
    pub responsibilities: Vec<String>,
    pub expertise_areas: Vec<String>,
    pub is_active: bool,
    pub avatar_url: Option<String>,
    pub greeting_message: Option<String>,
    pub personality: Option<String>,
    pub response_style: String,          // Formal, Casual, Technical, Friendly
    pub company_id: Option<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ============================================================================
// REDUCERS
// ============================================================================

/// Register a new AI agent configuration
#[reducer]
pub fn create_ai_agent(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    name: String,
    model: String,
    provider: String,
    temperature: f64,
    max_tokens: u32,
    system_prompt: Option<String>,
    monthly_budget: Option<f64>,
    rate_limit_per_minute: u32,
    cost_per_1k_tokens: f64,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "ai_agent", "create")?;

    if temperature < 0.0 || temperature > 2.0 {
        return Err("Temperature must be between 0.0 and 2.0".to_string());
    }

    let agent = ctx.db.ai_agent().insert(AiAgent {
        id: 0,
        name,
        description: None,
        model,
        provider,
        api_key_reference: None,
        temperature,
        max_tokens,
        top_p: 1.0,
        frequency_penalty: 0.0,
        presence_penalty: 0.0,
        system_prompt,
        context_window: 128_000,
        is_active: true,
        is_default: false,
        allowed_models: Vec::new(),
        allowed_actions: Vec::new(),
        rate_limit_per_minute,
        cost_per_1k_tokens,
        monthly_budget,
        monthly_spend: 0.0,
        company_id,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    write_audit_log(
        ctx,
        cid,
        None,
        "ai_agent",
        agent.id,
        "create",
        None,
        None,
        vec!["created".to_string()],
    );

    log::info!("AI agent created: id={}, provider={}", agent.id, agent.provider);
    Ok(())
}

/// Update AI agent configuration
#[reducer]
pub fn update_ai_agent(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    agent_id: u64,
    temperature: f64,
    max_tokens: u32,
    system_prompt: Option<String>,
    monthly_budget: Option<f64>,
    rate_limit_per_minute: u32,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "ai_agent", "write")?;

    let agent = ctx
        .db
        .ai_agent()
        .id()
        .find(&agent_id)
        .ok_or("AI agent not found")?;

    ctx.db.ai_agent().id().update(AiAgent {
        temperature,
        max_tokens,
        system_prompt,
        monthly_budget,
        rate_limit_per_minute,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..agent
    });

    write_audit_log(
        ctx,
        cid,
        None,
        "ai_agent",
        agent_id,
        "write",
        None,
        None,
        vec!["updated".to_string()],
    );

    log::info!("AI agent updated: id={}", agent_id);
    Ok(())
}

/// Activate or deactivate an AI agent
#[reducer]
pub fn set_ai_agent_active(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    agent_id: u64,
    is_active: bool,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "ai_agent", "write")?;

    let agent = ctx
        .db
        .ai_agent()
        .id()
        .find(&agent_id)
        .ok_or("AI agent not found")?;

    ctx.db.ai_agent().id().update(AiAgent {
        is_active,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..agent
    });

    write_audit_log(
        ctx,
        cid,
        None,
        "ai_agent",
        agent_id,
        "write",
        None,
        None,
        vec![if is_active {
            "activated".to_string()
        } else {
            "deactivated".to_string()
        }],
    );

    log::info!("AI agent active state: id={}, active={}", agent_id, is_active);
    Ok(())
}

/// Record monthly spend for an AI agent (called after each API use)
#[reducer]
pub fn record_ai_spend(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    agent_id: u64,
    tokens_used: u32,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "ai_agent", "write")?;

    let agent = ctx
        .db
        .ai_agent()
        .id()
        .find(&agent_id)
        .ok_or("AI agent not found")?;

    let cost = (tokens_used as f64 / 1000.0) * agent.cost_per_1k_tokens;
    let monthly_spend = agent.monthly_spend + cost;

    // Warn if approaching budget
    if let Some(budget) = agent.monthly_budget {
        if monthly_spend > budget {
            log::warn!(
                "AI agent {} exceeded monthly budget: spend={:.4}, budget={:.4}",
                agent_id,
                monthly_spend,
                budget
            );
        }
    }

    ctx.db.ai_agent().id().update(AiAgent {
        monthly_spend,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..agent
    });

    log::info!(
        "AI spend recorded: agent={}, tokens={}, cost={:.4}",
        agent_id,
        tokens_used,
        cost
    );
    Ok(())
}

/// Create an AI team member persona
#[reducer]
pub fn create_ai_team_member(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    name: String,
    ai_agent_id: u64,
    role: String,
    response_style: String,
    greeting_message: Option<String>,
    personality: Option<String>,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "ai_team_member", "create")?;

    // Verify the agent exists
    ctx.db
        .ai_agent()
        .id()
        .find(&ai_agent_id)
        .ok_or("AI agent not found")?;

    let member = ctx.db.ai_team_member().insert(AiTeamMember {
        id: 0,
        name,
        ai_agent_id,
        role,
        responsibilities: Vec::new(),
        expertise_areas: Vec::new(),
        is_active: true,
        avatar_url: None,
        greeting_message,
        personality,
        response_style,
        company_id,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    write_audit_log(
        ctx,
        cid,
        None,
        "ai_team_member",
        member.id,
        "create",
        None,
        None,
        vec!["created".to_string()],
    );

    log::info!("AI team member created: id={}, role={}", member.id, member.role);
    Ok(())
}
