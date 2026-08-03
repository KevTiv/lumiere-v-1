//! Configurable AI skills, tenant skill config, and agent run audit trail.

use spacetimedb::{reducer, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::ai::agents::ai_team_member;
use crate::core::organization::require_company_in_organization;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

const MAX_PROMPT_TEMPLATE_LEN: usize = 32_000;
const MAX_JSON_FIELD_LEN: usize = 256_000;
const MAX_STEP_OUTPUT_SUMMARY_LEN: usize = 8_000;

// ── Tables ───────────────────────────────────────────────────────────────────

/// Catalog entry for a reusable AI skill playbook (system or org-custom).
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_skill,
    public,
    index(accessor = ai_skill_by_org, btree(columns = [organization_id])),
    index(accessor = ai_skill_by_org_key, btree(columns = [organization_id, skill_key]))
)]
pub struct AiSkill {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// `0` = system-wide skill available to all organizations.
    pub organization_id: u64,
    pub skill_key: String,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub prompt_template: String,
    pub required_tools: Vec<String>,
    pub optional_tools: Vec<String>,
    pub default_max_steps: u32,
    pub default_max_tool_calls: u32,
    pub output_schema: Option<String>,
    pub config_schema: Option<String>,
    pub dataset_specs: Option<String>,
    pub allowed_action_drafts: Vec<String>,
    pub is_active: bool,
    pub is_system: bool,
    pub create_date: Timestamp,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Tenant-specific skill enablement and configuration JSON.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_skill_config,
    public,
    index(accessor = ai_skill_config_by_org, btree(columns = [organization_id])),
    index(
        accessor = ai_skill_config_by_company_skill,
        btree(columns = [company_id, skill_id])
    )
)]
pub struct AiSkillConfig {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub skill_id: u64,
    pub is_enabled: bool,
    pub config_json: String,
    pub custom_instructions: Option<String>,
    pub tool_overrides: Vec<String>,
    pub create_date: Timestamp,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Links an AI team member persona to skills it may invoke.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_team_member_skill,
    public,
    index(accessor = ai_team_member_skill_by_member, btree(columns = [team_member_id])),
    index(accessor = ai_team_member_skill_by_org, btree(columns = [organization_id]))
)]
pub struct AiTeamMemberSkill {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub team_member_id: u64,
    pub skill_id: u64,
    pub is_default: bool,
    pub module_hint: Option<String>,
    pub create_date: Timestamp,
    pub write_date: Timestamp,
}

/// One execution of an AI skill (orchestrator run).
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_agent_run,
    public,
    index(accessor = ai_agent_run_by_org, btree(columns = [organization_id])),
    index(accessor = ai_agent_run_by_company, btree(columns = [company_id])),
    index(accessor = ai_agent_run_by_skill, btree(columns = [skill_id])),
    index(accessor = ai_agent_run_by_status, btree(columns = [status])),
    index(accessor = ai_agent_run_by_run_key, btree(columns = [run_key]))
)]
pub struct AiAgentRun {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub skill_id: u64,
    pub skill_config_id: Option<u64>,
    pub agent_id: u64,
    pub team_member_id: Option<u64>,
    /// Client-generated correlation id for gateway lookup after insert.
    pub run_key: String,
    /// pending | running | completed | failed | cancelled
    pub status: String,
    pub inputs_json: String,
    pub summary: Option<String>,
    pub artifacts_json: Option<String>,
    pub citations_json: Option<String>,
    pub action_draft_ids: Vec<u64>,
    pub step_count: u32,
    pub tokens_used: u32,
    pub error_message: Option<String>,
    pub triggered_by_hex: String,
    pub started_at: Timestamp,
    pub completed_at: Option<Timestamp>,
    pub create_date: Timestamp,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Audit row for each tool invocation within a run.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_agent_run_step,
    public,
    index(accessor = ai_agent_run_step_by_run, btree(columns = [run_id]))
)]
pub struct AiAgentRunStep {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub run_id: u64,
    pub step_no: u32,
    pub tool_name: String,
    pub input_hash: String,
    pub output_summary: String,
    pub output_row_count: Option<u32>,
    pub citations_json: Option<String>,
    pub duration_ms: u64,
    pub error_message: Option<String>,
    pub created_at: Timestamp,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAiSkillParams {
    pub skill_key: String,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub prompt_template: String,
    pub required_tools: Vec<String>,
    pub optional_tools: Vec<String>,
    pub default_max_steps: u32,
    pub default_max_tool_calls: u32,
    pub output_schema: Option<String>,
    pub config_schema: Option<String>,
    pub dataset_specs: Option<String>,
    pub allowed_action_drafts: Vec<String>,
    pub is_active: bool,
    pub is_system: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpsertAiSkillConfigParams {
    pub company_id: Option<u64>,
    pub skill_id: u64,
    pub is_enabled: bool,
    pub config_json: String,
    pub custom_instructions: Option<String>,
    pub tool_overrides: Vec<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpsertAiSkillParams {
    pub skill_key: String,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub prompt_template: String,
    pub required_tools: Vec<String>,
    pub optional_tools: Vec<String>,
    pub default_max_steps: u32,
    pub default_max_tool_calls: u32,
    pub output_schema: Option<String>,
    pub config_schema: Option<String>,
    pub dataset_specs: Option<String>,
    pub allowed_action_drafts: Vec<String>,
    pub is_active: bool,
    pub is_system: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct AssignTeamMemberSkillParams {
    pub team_member_id: u64,
    pub skill_id: u64,
    pub is_default: bool,
    pub module_hint: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAiAgentRunParams {
    pub company_id: u64,
    pub skill_id: u64,
    pub skill_config_id: Option<u64>,
    pub agent_id: u64,
    pub team_member_id: Option<u64>,
    pub run_key: String,
    pub inputs_json: String,
    pub triggered_by_hex: String,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct AppendAiAgentRunStepParams {
    pub step_no: u32,
    pub tool_name: String,
    pub input_hash: String,
    pub output_summary: String,
    pub output_row_count: Option<u32>,
    pub citations_json: Option<String>,
    pub duration_ms: u64,
    pub error_message: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CompleteAiAgentRunParams {
    pub status: String,
    pub summary: Option<String>,
    pub artifacts_json: Option<String>,
    pub citations_json: Option<String>,
    pub action_draft_ids: Vec<u64>,
    pub step_count: u32,
    pub tokens_used: u32,
    pub error_message: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_ai_skill(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateAiSkillParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_skill", "create")?;

    let skill_key = params.skill_key.trim().to_string();
    if skill_key.is_empty() {
        return Err("skill_key is required".to_string());
    }
    if params.name.trim().is_empty() {
        return Err("name is required".to_string());
    }
    if params.prompt_template.len() > MAX_PROMPT_TEMPLATE_LEN {
        return Err("prompt_template is too long".to_string());
    }
    if params.default_max_steps == 0 || params.default_max_steps > 32 {
        return Err("default_max_steps must be between 1 and 32".to_string());
    }
    if params.default_max_tool_calls == 0 || params.default_max_tool_calls > 64 {
        return Err("default_max_tool_calls must be between 1 and 64".to_string());
    }

    if skill_key_exists(ctx, organization_id, &skill_key) {
        return Err(format!("skill_key '{skill_key}' already exists"));
    }

    let row = ctx.db.ai_skill().insert(AiSkill {
        id: 0,
        organization_id,
        skill_key: skill_key.clone(),
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
        is_active: params.is_active,
        is_system: params.is_system,
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "ai_skill",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "skill_key": skill_key,
                    "category": row.category,
                    "is_active": row.is_active,
                })
                .to_string(),
            ),
            changed_fields: vec!["skill_key".to_string(), "name".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn upsert_ai_skill(
    ctx: &ReducerContext,
    organization_id: u64,
    params: UpsertAiSkillParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_skill", "write")?;

    let skill_key = params.skill_key.trim().to_string();
    if skill_key.is_empty() {
        return Err("skill_key is required".to_string());
    }
    if params.name.trim().is_empty() {
        return Err("name is required".to_string());
    }
    if params.prompt_template.len() > MAX_PROMPT_TEMPLATE_LEN {
        return Err("prompt_template is too long".to_string());
    }
    if params.default_max_steps == 0 || params.default_max_steps > 32 {
        return Err("default_max_steps must be between 1 and 32".to_string());
    }
    if params.default_max_tool_calls == 0 || params.default_max_tool_calls > 64 {
        return Err("default_max_tool_calls must be between 1 and 64".to_string());
    }

    let existing = ctx
        .db
        .ai_skill()
        .ai_skill_by_org()
        .filter(&organization_id)
        .find(|row| row.skill_key == skill_key);

    if let Some(row) = existing {
        ctx.db.ai_skill().id().update(AiSkill {
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
            is_active: params.is_active,
            is_system: params.is_system,
            write_date: ctx.timestamp,
            metadata: params.metadata,
            ..row
        });

        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: None,
                table_name: "ai_skill",
                record_id: row.id,
                action: "UPDATE",
                old_values: None,
                new_values: Some(
                    serde_json::json!({
                        "skill_key": skill_key,
                        "source": "upsert",
                    })
                    .to_string(),
                ),
                changed_fields: vec!["prompt_template".to_string(), "name".to_string()],
                metadata: None,
            },
        );
    } else {
        let row = ctx.db.ai_skill().insert(AiSkill {
            id: 0,
            organization_id,
            skill_key: skill_key.clone(),
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
            is_active: params.is_active,
            is_system: params.is_system,
            create_date: ctx.timestamp,
            write_date: ctx.timestamp,
            metadata: params.metadata,
        });

        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: None,
                table_name: "ai_skill",
                record_id: row.id,
                action: "CREATE",
                old_values: None,
                new_values: Some(
                    serde_json::json!({
                        "skill_key": skill_key,
                        "source": "upsert",
                    })
                    .to_string(),
                ),
                changed_fields: vec!["skill_key".to_string(), "name".to_string()],
                metadata: None,
            },
        );
    }

    Ok(())
}

#[reducer]
pub fn set_ai_skill_active(
    ctx: &ReducerContext,
    organization_id: u64,
    skill_id: u64,
    active: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_skill", "write")?;

    let skill = load_org_skill(ctx, organization_id, skill_id)?;
    ctx.db.ai_skill().id().update(AiSkill {
        is_active: active,
        write_date: ctx.timestamp,
        ..skill
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "ai_skill",
            record_id: skill_id,
            action: "SET_ACTIVE",
            old_values: None,
            new_values: Some(serde_json::json!({ "is_active": active }).to_string()),
            changed_fields: vec!["is_active".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn upsert_ai_skill_config(
    ctx: &ReducerContext,
    organization_id: u64,
    params: UpsertAiSkillConfigParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_skill", "write")?;

    if params.config_json.len() > MAX_JSON_FIELD_LEN {
        return Err("config_json is too long".to_string());
    }

    let skill = load_org_or_system_skill(ctx, organization_id, params.skill_id)?;

    if let Some(company_id) = params.company_id {
        if company_id == 0 {
            return Err("company_id must be positive when set".to_string());
        }
    }

    let existing = ctx
        .db
        .ai_skill_config()
        .ai_skill_config_by_org()
        .filter(&organization_id)
        .find(|row| {
            row.skill_id == skill.id
                && row.company_id == params.company_id
                && row.organization_id == organization_id
        });

    if let Some(row) = existing {
        let updated = AiSkillConfig {
            is_enabled: params.is_enabled,
            config_json: params.config_json.clone(),
            custom_instructions: params.custom_instructions.clone(),
            tool_overrides: params.tool_overrides.clone(),
            write_date: ctx.timestamp,
            metadata: params.metadata.clone(),
            ..row
        };
        ctx.db.ai_skill_config().id().update(updated.clone());

        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: params.company_id,
                table_name: "ai_skill_config",
                record_id: row.id,
                action: "UPDATE",
                old_values: None,
                new_values: Some(
                    serde_json::json!({
                        "skill_id": skill.id,
                        "is_enabled": params.is_enabled,
                    })
                    .to_string(),
                ),
                changed_fields: vec!["is_enabled".to_string(), "config_json".to_string()],
                metadata: None,
            },
        );
    } else {
        let row = ctx.db.ai_skill_config().insert(AiSkillConfig {
            id: 0,
            organization_id,
            company_id: params.company_id,
            skill_id: skill.id,
            is_enabled: params.is_enabled,
            config_json: params.config_json.clone(),
            custom_instructions: params.custom_instructions.clone(),
            tool_overrides: params.tool_overrides.clone(),
            create_date: ctx.timestamp,
            write_date: ctx.timestamp,
            metadata: params.metadata.clone(),
        });

        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: params.company_id,
                table_name: "ai_skill_config",
                record_id: row.id,
                action: "CREATE",
                old_values: None,
                new_values: Some(
                    serde_json::json!({
                        "skill_id": skill.id,
                        "is_enabled": params.is_enabled,
                    })
                    .to_string(),
                ),
                changed_fields: vec!["skill_id".to_string(), "is_enabled".to_string()],
                metadata: None,
            },
        );
    }

    Ok(())
}

#[reducer]
pub fn assign_team_member_skill(
    ctx: &ReducerContext,
    organization_id: u64,
    params: AssignTeamMemberSkillParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_team_member", "write")?;

    let _skill = load_org_or_system_skill(ctx, organization_id, params.skill_id)?;

    let member = ctx
        .db
        .ai_team_member()
        .id()
        .find(&params.team_member_id)
        .ok_or("Team member not found")?;
    if member.organization_id != organization_id {
        return Err("Team member does not belong to this organization".to_string());
    }

    let exists = ctx
        .db
        .ai_team_member_skill()
        .ai_team_member_skill_by_member()
        .filter(&params.team_member_id)
        .any(|row| row.skill_id == params.skill_id);

    if exists {
        return Err("Skill already assigned to this team member".to_string());
    }

    let row = ctx.db.ai_team_member_skill().insert(AiTeamMemberSkill {
        id: 0,
        organization_id,
        team_member_id: params.team_member_id,
        skill_id: params.skill_id,
        is_default: params.is_default,
        module_hint: params.module_hint.clone(),
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: member.company_id,
            table_name: "ai_team_member_skill",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "team_member_id": params.team_member_id,
                    "skill_id": params.skill_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["team_member_id".to_string(), "skill_id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn unassign_team_member_skill(
    ctx: &ReducerContext,
    organization_id: u64,
    team_member_skill_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_team_member", "write")?;

    let row = ctx
        .db
        .ai_team_member_skill()
        .id()
        .find(&team_member_skill_id)
        .ok_or("Team member skill assignment not found")?;
    if row.organization_id != organization_id {
        return Err("Record does not belong to this organization".to_string());
    }

    ctx.db
        .ai_team_member_skill()
        .id()
        .delete(&team_member_skill_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "ai_team_member_skill",
            record_id: team_member_skill_id,
            action: "DELETE",
            old_values: Some(
                serde_json::json!({
                    "team_member_id": row.team_member_id,
                    "skill_id": row.skill_id,
                })
                .to_string(),
            ),
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn create_ai_agent_run(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateAiAgentRunParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_agent_run", "create")?;

    if params.company_id == 0 {
        return Err("company_id is required".to_string());
    }
    require_company_in_organization(ctx, organization_id, params.company_id)?;
    let run_key = params.run_key.trim().to_string();
    if run_key.is_empty() {
        return Err("run_key is required".to_string());
    }
    if !is_valid_identity_hex(&params.triggered_by_hex) {
        return Err("triggered_by_hex must be a 64-character hex identity".to_string());
    }
    if params.inputs_json.len() > MAX_JSON_FIELD_LEN {
        return Err("inputs_json is too long".to_string());
    }

    let _skill = load_org_or_system_skill(ctx, organization_id, params.skill_id)?;

    if run_key_exists(ctx, &run_key) {
        return Err("run_key already exists".to_string());
    }

    let row = ctx.db.ai_agent_run().insert(AiAgentRun {
        id: 0,
        organization_id,
        company_id: params.company_id,
        skill_id: params.skill_id,
        skill_config_id: params.skill_config_id,
        agent_id: params.agent_id,
        team_member_id: params.team_member_id,
        run_key: run_key.clone(),
        status: "running".to_string(),
        inputs_json: params.inputs_json,
        summary: None,
        artifacts_json: None,
        citations_json: None,
        action_draft_ids: Vec::new(),
        step_count: 0,
        tokens_used: 0,
        error_message: None,
        triggered_by_hex: params.triggered_by_hex,
        started_at: ctx.timestamp,
        completed_at: None,
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(params.company_id),
            table_name: "ai_agent_run",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "run_key": run_key,
                    "skill_id": params.skill_id,
                    "status": "running",
                })
                .to_string(),
            ),
            changed_fields: vec!["status".to_string(), "skill_id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn append_ai_agent_run_step(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: AppendAiAgentRunStepParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_agent_run", "write")?;

    let run = load_company_run(ctx, organization_id, company_id, run_id)?;
    if run.status != "running" && run.status != "pending" {
        return Err("run is not active".to_string());
    }
    if params.tool_name.trim().is_empty() {
        return Err("tool_name is required".to_string());
    }
    if params.output_summary.len() > MAX_STEP_OUTPUT_SUMMARY_LEN {
        return Err("output_summary is too long".to_string());
    }

    ctx.db.ai_agent_run_step().insert(AiAgentRunStep {
        id: 0,
        run_id,
        step_no: params.step_no,
        tool_name: params.tool_name.clone(),
        input_hash: params.input_hash,
        output_summary: params.output_summary,
        output_row_count: params.output_row_count,
        citations_json: params.citations_json,
        duration_ms: params.duration_ms,
        error_message: params.error_message,
        created_at: ctx.timestamp,
    });

    ctx.db.ai_agent_run().id().update(AiAgentRun {
        step_count: run.step_count.saturating_add(1),
        write_date: ctx.timestamp,
        ..run
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_agent_run_step",
            record_id: run_id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "step_no": params.step_no,
                    "tool_name": params.tool_name,
                })
                .to_string(),
            ),
            changed_fields: vec!["step_count".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn complete_ai_agent_run(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: CompleteAiAgentRunParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_agent_run", "write")?;

    let run = load_company_run(ctx, organization_id, company_id, run_id)?;
    let status = params.status.trim().to_string();
    if !matches!(status.as_str(), "completed" | "failed" | "cancelled") {
        return Err("status must be completed, failed, or cancelled".to_string());
    }

    ctx.db.ai_agent_run().id().update(AiAgentRun {
        status: status.clone(),
        summary: params.summary,
        artifacts_json: params.artifacts_json,
        citations_json: params.citations_json,
        action_draft_ids: params.action_draft_ids,
        step_count: params.step_count,
        tokens_used: params.tokens_used,
        error_message: params.error_message,
        completed_at: Some(ctx.timestamp),
        write_date: ctx.timestamp,
        ..run
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_agent_run",
            record_id: run_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "status": status }).to_string()),
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn cancel_ai_agent_run(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    reason: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_agent_run", "write")?;

    let run = load_company_run(ctx, organization_id, company_id, run_id)?;
    if run.status != "running" && run.status != "pending" {
        return Err("run is not active".to_string());
    }

    ctx.db.ai_agent_run().id().update(AiAgentRun {
        status: "cancelled".to_string(),
        error_message: reason,
        completed_at: Some(ctx.timestamp),
        write_date: ctx.timestamp,
        ..run
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_agent_run",
            record_id: run_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "status": "cancelled" }).to_string()),
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn is_valid_identity_hex(value: &str) -> bool {
    let hex = value
        .trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X");
    hex.len() == 64 && hex.chars().all(|c| c.is_ascii_hexdigit())
}

fn skill_key_exists(ctx: &ReducerContext, organization_id: u64, skill_key: &str) -> bool {
    ctx.db
        .ai_skill()
        .ai_skill_by_org()
        .filter(&organization_id)
        .any(|row| row.skill_key == skill_key)
}

fn run_key_exists(ctx: &ReducerContext, run_key: &str) -> bool {
    ctx.db
        .ai_agent_run()
        .ai_agent_run_by_run_key()
        .filter(&run_key.to_string())
        .next()
        .is_some()
}

fn load_org_skill(
    ctx: &ReducerContext,
    organization_id: u64,
    skill_id: u64,
) -> Result<AiSkill, String> {
    let skill = ctx
        .db
        .ai_skill()
        .id()
        .find(&skill_id)
        .ok_or("Skill not found")?;
    if skill.organization_id != organization_id {
        return Err("Skill does not belong to this organization".to_string());
    }
    Ok(skill)
}

fn load_org_or_system_skill(
    ctx: &ReducerContext,
    organization_id: u64,
    skill_id: u64,
) -> Result<AiSkill, String> {
    let skill = ctx
        .db
        .ai_skill()
        .id()
        .find(&skill_id)
        .ok_or("Skill not found")?;
    if skill.organization_id != organization_id && skill.organization_id != 0 {
        return Err("Skill is not available for this organization".to_string());
    }
    Ok(skill)
}

fn load_company_run(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
) -> Result<AiAgentRun, String> {
    let run = ctx
        .db
        .ai_agent_run()
        .id()
        .find(&run_id)
        .ok_or("Run not found")?;
    if run.organization_id != organization_id {
        return Err("Run does not belong to this organization".to_string());
    }
    if run.company_id != company_id {
        return Err("Run does not belong to this company".to_string());
    }
    Ok(run)
}

#[cfg(test)]
mod tests {
    use super::is_valid_identity_hex;

    #[test]
    fn identity_hex_validation() {
        assert!(is_valid_identity_hex(
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        ));
        assert!(!is_valid_identity_hex("abc"));
    }
}
