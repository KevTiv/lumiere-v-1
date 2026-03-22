/// AI Agents Module — AI model configurations and team member personas
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **AiAgent** | AI model configuration (provider, params, budget) |
/// | **AiTeamMember** | AI persona with role, personality, and responsibilities |
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

// ============================================================================
// PARAMS TYPES
// ============================================================================

/// Params for creating an AI agent configuration.
/// Scope: `organization_id` + optional `company_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAiAgentParams {
    pub name: String,
    pub model: String,
    pub provider: String,
    pub temperature: f64,
    pub max_tokens: u32,
    pub rate_limit_per_minute: u32,
    pub cost_per_1k_tokens: f64,
    pub context_window: u32,
    pub top_p: f64,
    pub frequency_penalty: f64,
    pub presence_penalty: f64,
    pub is_active: bool,
    pub is_default: bool,
    pub allowed_models: Vec<String>,
    pub allowed_actions: Vec<String>,
    pub description: Option<String>,
    pub api_key_reference: Option<String>,
    pub system_prompt: Option<String>,
    pub monthly_budget: Option<f64>,
    pub metadata: Option<String>,
}

/// Params for updating AI agent configuration.
/// Scope: `organization_id` + `agent_id` are flat reducer params.
/// Option fields: None = keep existing value.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateAiAgentParams {
    pub temperature: f64,
    pub max_tokens: u32,
    pub rate_limit_per_minute: u32,
    pub context_window: Option<u32>,
    pub top_p: Option<f64>,
    pub frequency_penalty: Option<f64>,
    pub presence_penalty: Option<f64>,
    pub system_prompt: Option<String>,
    pub monthly_budget: Option<f64>,
}

/// Params for creating an AI team member persona.
/// Scope: `organization_id` + optional `company_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAiTeamMemberParams {
    pub name: String,
    pub ai_agent_id: u64,
    pub role: String,
    pub response_style: String,
    pub is_active: bool,
    pub responsibilities: Vec<String>,
    pub expertise_areas: Vec<String>,
    pub avatar_url: Option<String>,
    pub greeting_message: Option<String>,
    pub personality: Option<String>,
    pub metadata: Option<String>,
}

// ============================================================================
// TABLES
// ============================================================================

/// AiAgent — Configuration for an AI model used within the system
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_agent,
    public,
    index(accessor = ai_agent_by_org, btree(columns = [organization_id])),
    index(accessor = ai_agent_by_company, btree(columns = [company_id]))
)]
pub struct AiAgent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64, // Tenant isolation
    pub name: String,
    pub description: Option<String>,
    pub model: String,                     // e.g., "claude-sonnet-4-6", "gpt-4o"
    pub provider: String,                  // OpenAI, Anthropic, Ollama, Mistral, etc.
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
    pub company_id: Option<u64>, // ERP company entity scope (within org)
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// AiTeamMember — An AI persona with a defined role and personality
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_team_member,
    public,
    index(accessor = ai_team_member_by_org, btree(columns = [organization_id])),
    index(name = "by_agent", accessor = team_member_by_agent, btree(columns = [ai_agent_id])),
    index(accessor = team_member_by_company, btree(columns = [company_id]))
)]
pub struct AiTeamMember {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64, // Tenant isolation
    pub name: String,
    pub ai_agent_id: u64,
    pub role: String, // Assistant, Analyst, Advisor, etc.
    pub responsibilities: Vec<String>,
    pub expertise_areas: Vec<String>,
    pub is_active: bool,
    pub avatar_url: Option<String>,
    pub greeting_message: Option<String>,
    pub personality: Option<String>,
    pub response_style: String,  // Formal, Casual, Technical, Friendly
    pub company_id: Option<u64>, // ERP company entity scope (within org)
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
    organization_id: u64,
    company_id: Option<u64>,
    params: CreateAiAgentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_agent", "create")?;

    if params.temperature < 0.0 || params.temperature > 2.0 {
        return Err("Temperature must be between 0.0 and 2.0".to_string());
    }
    if !(0.0..=1.0).contains(&params.top_p) {
        return Err("top_p must be between 0.0 and 1.0".to_string());
    }
    if !(-2.0..=2.0).contains(&params.frequency_penalty) {
        return Err("frequency_penalty must be between -2.0 and 2.0".to_string());
    }
    if !(-2.0..=2.0).contains(&params.presence_penalty) {
        return Err("presence_penalty must be between -2.0 and 2.0".to_string());
    }

    let agent = ctx.db.ai_agent().insert(AiAgent {
        id: 0,
        organization_id,
        name: params.name,
        description: params.description,
        model: params.model,
        provider: params.provider,
        api_key_reference: params.api_key_reference,
        temperature: params.temperature,
        max_tokens: params.max_tokens,
        top_p: params.top_p,
        frequency_penalty: params.frequency_penalty,
        presence_penalty: params.presence_penalty,
        system_prompt: params.system_prompt,
        context_window: params.context_window,
        is_active: params.is_active,
        is_default: params.is_default,
        allowed_models: params.allowed_models,
        allowed_actions: params.allowed_actions,
        rate_limit_per_minute: params.rate_limit_per_minute,
        cost_per_1k_tokens: params.cost_per_1k_tokens,
        monthly_budget: params.monthly_budget,
        // System-managed: starts at 0, incremented by record_ai_spend
        monthly_spend: 0.0,
        company_id,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name: "ai_agent",
            record_id: agent.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec!["created".to_string()],
            metadata: None,
        },
    );

    log::info!(
        "AI agent created: id={}, provider={}",
        agent.id,
        agent.provider
    );
    Ok(())
}

/// Update AI agent configuration
#[reducer]
pub fn update_ai_agent(
    ctx: &ReducerContext,
    organization_id: u64,
    agent_id: u64,
    params: UpdateAiAgentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_agent", "write")?;

    if params.temperature < 0.0 || params.temperature > 2.0 {
        return Err("Temperature must be between 0.0 and 2.0".to_string());
    }
    if let Some(tp) = params.top_p {
        if !(0.0..=1.0).contains(&tp) {
            return Err("top_p must be between 0.0 and 1.0".to_string());
        }
    }
    if let Some(fp) = params.frequency_penalty {
        if !(-2.0..=2.0).contains(&fp) {
            return Err("frequency_penalty must be between -2.0 and 2.0".to_string());
        }
    }
    if let Some(pp) = params.presence_penalty {
        if !(-2.0..=2.0).contains(&pp) {
            return Err("presence_penalty must be between -2.0 and 2.0".to_string());
        }
    }

    let agent = ctx
        .db
        .ai_agent()
        .id()
        .find(&agent_id)
        .ok_or("AI agent not found")?;

    if agent.organization_id != organization_id {
        return Err("AI agent does not belong to this organization".to_string());
    }

    ctx.db.ai_agent().id().update(AiAgent {
        temperature: params.temperature,
        max_tokens: params.max_tokens,
        system_prompt: params.system_prompt,
        monthly_budget: params.monthly_budget,
        rate_limit_per_minute: params.rate_limit_per_minute,
        context_window: params.context_window.unwrap_or(agent.context_window),
        top_p: params.top_p.unwrap_or(agent.top_p),
        frequency_penalty: params.frequency_penalty.unwrap_or(agent.frequency_penalty),
        presence_penalty: params.presence_penalty.unwrap_or(agent.presence_penalty),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..agent
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "ai_agent",
            record_id: agent_id,
            action: "write",
            old_values: None,
            new_values: None,
            changed_fields: vec!["updated".to_string()],
            metadata: None,
        },
    );

    log::info!("AI agent updated: id={}", agent_id);
    Ok(())
}

/// Activate or deactivate an AI agent
#[reducer]
pub fn set_ai_agent_active(
    ctx: &ReducerContext,
    organization_id: u64,
    agent_id: u64,
    is_active: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_agent", "write")?;

    let agent = ctx
        .db
        .ai_agent()
        .id()
        .find(&agent_id)
        .ok_or("AI agent not found")?;

    if agent.organization_id != organization_id {
        return Err("AI agent does not belong to this organization".to_string());
    }

    ctx.db.ai_agent().id().update(AiAgent {
        is_active,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..agent
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "ai_agent",
            record_id: agent_id,
            action: "write",
            old_values: None,
            new_values: None,
            changed_fields: vec![if is_active {
                "activated".to_string()
            } else {
                "deactivated".to_string()
            }],
            metadata: None,
        },
    );

    log::info!(
        "AI agent active state: id={}, active={}",
        agent_id,
        is_active
    );
    Ok(())
}

/// Record monthly spend for an AI agent (called after each API use)
#[reducer]
pub fn record_ai_spend(
    ctx: &ReducerContext,
    organization_id: u64,
    agent_id: u64,
    tokens_used: u32,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_agent", "write")?;

    let agent = ctx
        .db
        .ai_agent()
        .id()
        .find(&agent_id)
        .ok_or("AI agent not found")?;

    if agent.organization_id != organization_id {
        return Err("AI agent does not belong to this organization".to_string());
    }

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
    organization_id: u64,
    company_id: Option<u64>,
    params: CreateAiTeamMemberParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_team_member", "create")?;

    // Verify the agent exists and belongs to this org
    let agent = ctx
        .db
        .ai_agent()
        .id()
        .find(&params.ai_agent_id)
        .ok_or("AI agent not found")?;

    if agent.organization_id != organization_id {
        return Err("AI agent does not belong to this organization".to_string());
    }

    let member = ctx.db.ai_team_member().insert(AiTeamMember {
        id: 0,
        organization_id,
        name: params.name,
        ai_agent_id: params.ai_agent_id,
        role: params.role,
        responsibilities: params.responsibilities,
        expertise_areas: params.expertise_areas,
        is_active: params.is_active,
        avatar_url: params.avatar_url,
        greeting_message: params.greeting_message,
        personality: params.personality,
        response_style: params.response_style,
        company_id,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name: "ai_team_member",
            record_id: member.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec!["created".to_string()],
            metadata: None,
        },
    );

    log::info!(
        "AI team member created: id={}, role={}",
        member.id,
        member.role
    );
    Ok(())
}
