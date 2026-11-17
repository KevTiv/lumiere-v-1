use anyhow::{Context, Result};
use serde_json::Value;
use sha2::{Digest, Sha256};
use stdb_client::StdbClient;

use crate::skills::{compose_prompt, load_bundled_skill};

/// Recheck the effective catalog and company binding at the point of use.
pub(crate) async fn require_enabled_skill(
    stdb: &StdbClient,
    organization_id: u64,
    company_id: u64,
    skill_key: &str,
) -> Result<()> {
    let row = load_effective_catalog_skill(stdb, organization_id, skill_key)
        .await
        .map_err(|error| error.context(crate::error::SkillUnavailable))?
        .ok_or(crate::error::SkillUnavailable)?;
    if load_skill_config(stdb, organization_id, company_id, row_u64(&row, "id"))
        .await
        .map_err(|error| error.context(crate::error::SkillUnavailable))?
        .is_some_and(|config| !row_bool(&config, "isEnabled"))
    {
        return Err(crate::error::SkillUnavailable.into());
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GovernedRunRef {
    pub run_id: u64,
    pub run_key: String,
    pub skill_id: u64,
    pub skill_config_id: Option<u64>,
    /// Immutable routing-policy binding resolved from the active skill config
    /// at run creation time. None means use the organization's default policy.
    pub intelligence_policy_ref: Option<String>,
    pub program_ref: Option<String>,
}

#[derive(Clone, Debug)]
pub struct LoadedSkill {
    pub id: u64,
    pub skill_key: String,
    pub name: String,
    pub category: String,
    pub prompt_template: String,
    pub required_tools: Vec<String>,
    pub optional_tools: Vec<String>,
    pub default_max_steps: u32,
    pub default_max_tool_calls: u32,
    pub config_json: Value,
    pub custom_instructions: Option<String>,
    pub skill_config_id: Option<u64>,
    pub enabled: bool,
    pub allowed_action_drafts: Vec<String>,
    pub source: SkillSource,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SkillSource {
    Remote,
    Bundled,
    Merged,
}

fn row_u64(row: &Value, key: &str) -> u64 {
    row.get(key)
        .and_then(|v| v.as_u64().or_else(|| v.as_i64().map(|n| n as u64)))
        .unwrap_or(0)
}

fn row_string(row: &Value, key: &str) -> String {
    row.get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn row_bool(row: &Value, key: &str) -> bool {
    row.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}

fn row_string_list(row: &Value, key: &str) -> Vec<String> {
    row.get(key)
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn sats_option(value: Option<Value>) -> Value {
    match value {
        Some(value) => serde_json::json!({ "some": value }),
        None => serde_json::json!({ "none": [] }),
    }
}

pub fn intelligence_policy_ref(config: &Value) -> Result<Option<String>> {
    let Some(value) = config
        .get("intelligencePolicyRef")
        .or_else(|| config.get("intelligence_policy_ref"))
    else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let reference = value
        .as_str()
        .context("intelligencePolicyRef must be a string")?
        .trim();
    if reference.is_empty() {
        return Ok(None);
    }
    let (key, version) = reference
        .rsplit_once('@')
        .context("intelligencePolicyRef must use policy_key@version")?;
    if key.trim().is_empty() {
        anyhow::bail!("intelligencePolicyRef policy key must be nonempty");
    }
    let version = version
        .parse::<u32>()
        .context("intelligencePolicyRef version must be a positive integer")?;
    if version == 0 {
        anyhow::bail!("intelligencePolicyRef version must be positive");
    }
    Ok(Some(format!("{}@{}", key.trim(), version)))
}

/// An admin-authored company skill binding avoids changing the organization's
/// default agent. Explicit agent/persona selection continues to take precedence.
pub fn skill_agent_id(
    config: &Value,
    requested_agent_id: Option<u64>,
    team_member_id: Option<u64>,
) -> Result<Option<u64>> {
    if requested_agent_id.is_some() || team_member_id.is_some() {
        return Ok(requested_agent_id);
    }
    let value = config
        .get("defaultAgentId")
        .or_else(|| config.get("default_agent_id"));
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => {
            let id = value
                .as_u64()
                .filter(|id| *id > 0)
                .context("defaultAgentId must be a positive integer")?;
            Ok(Some(id))
        }
    }
}

/// Resolve the effective catalog entry before interpreting activity. A local
/// disablement or ambiguity must never expose a global (or bundled) fallback.
pub(crate) async fn load_effective_catalog_skill(
    stdb: &StdbClient,
    org_id: u64,
    skill_key: &str,
) -> Result<Option<Value>> {
    let escaped = skill_key.replace('\'', "''");
    let scopes = if org_id == 0 {
        vec![0]
    } else {
        vec![org_id, 0]
    };
    for scope in scopes {
        let rows = stdb
            .query_sql(&format!(
                "SELECT * FROM ai_skill WHERE skill_key = '{escaped}' \
                 AND organization_id = {scope} LIMIT 2"
            ))
            .await
            .context("load scoped ai_skill")?;
        if rows.len() > 1 {
            anyhow::bail!("effective skill catalog is ambiguous");
        }
        let Some(row) = rows.into_iter().next() else {
            continue;
        };
        if row.get("organizationId").and_then(Value::as_u64) != Some(scope)
            || row.get("skillKey").and_then(Value::as_str) != Some(skill_key)
            || row
                .get("id")
                .and_then(Value::as_u64)
                .is_none_or(|id| id == 0)
        {
            anyhow::bail!("effective skill catalog returned a wrong scope or key");
        }
        if row.get("isActive").and_then(Value::as_bool) != Some(true) {
            anyhow::bail!("effective skill catalog entry is inactive");
        }
        return Ok(Some(row));
    }
    Ok(None)
}

pub async fn load_skill(
    stdb: &StdbClient,
    org_id: u64,
    company_id: u64,
    skill_key: &str,
) -> Result<LoadedSkill> {
    if let Some(skill_row) = load_effective_catalog_skill(stdb, org_id, skill_key).await? {
        let skill_row = &skill_row;
        let skill_id = row_u64(skill_row, "id");
        let config = load_skill_config(stdb, org_id, company_id, skill_id).await?;
        let mut skill = LoadedSkill {
            id: skill_id,
            skill_key: row_string(skill_row, "skillKey"),
            name: row_string(skill_row, "name"),
            category: row_string(skill_row, "category"),
            prompt_template: row_string(skill_row, "promptTemplate"),
            required_tools: row_string_list(skill_row, "requiredTools"),
            optional_tools: row_string_list(skill_row, "optionalTools"),
            default_max_steps: row_u64(skill_row, "defaultMaxSteps") as u32,
            default_max_tool_calls: row_u64(skill_row, "defaultMaxToolCalls") as u32,
            config_json: config
                .as_ref()
                .and_then(|row| row.get("configJson"))
                .and_then(|v| v.as_str())
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_else(|| serde_json::json!({})),
            custom_instructions: config
                .as_ref()
                .and_then(|row| row.get("customInstructions"))
                .and_then(|v| v.as_str())
                .map(str::to_string),
            skill_config_id: config.as_ref().map(|row| row_u64(row, "id")),
            enabled: config
                .as_ref()
                .map(|row| row_bool(row, "isEnabled"))
                .unwrap_or(true),
            allowed_action_drafts: row_string_list(skill_row, "allowedActionDrafts"),
            source: SkillSource::Remote,
        };
        apply_bundled_overlay(&mut skill)?;
        return Ok(skill);
    }

    load_bundled_skill_only(skill_key)
}

fn load_bundled_skill_only(skill_key: &str) -> Result<LoadedSkill> {
    let md = load_bundled_skill(skill_key)?
        .ok_or_else(|| anyhow::anyhow!("skill '{skill_key}' not found"))?;
    bundled_to_loaded(&md)
}

fn bundled_to_loaded(md: &crate::skills::BundledSkillMd) -> Result<LoadedSkill> {
    Ok(LoadedSkill {
        id: 0,
        skill_key: md.skill_key.clone(),
        name: md.name.clone(),
        category: md.category.clone(),
        prompt_template: compose_prompt(md)?,
        required_tools: md.required_tools.clone(),
        optional_tools: md.optional_tools.clone(),
        default_max_steps: md.default_max_steps,
        default_max_tool_calls: md.default_max_tool_calls,
        config_json: serde_json::json!({}),
        custom_instructions: None,
        skill_config_id: None,
        enabled: true,
        allowed_action_drafts: md.allowed_action_drafts.clone(),
        source: SkillSource::Bundled,
    })
}

fn apply_bundled_overlay(skill: &mut LoadedSkill) -> Result<()> {
    let Some(md) = load_bundled_skill(&skill.skill_key)? else {
        return Ok(());
    };

    skill.prompt_template = compose_prompt(&md)?;
    // Bundled metadata describes the compiled program; stale database tool lists
    // must not resurrect retired tools or draft workflows during overlay.
    skill.required_tools = md.required_tools.clone();
    skill.optional_tools = md.optional_tools.clone();
    skill.allowed_action_drafts = md.allowed_action_drafts.clone();
    migrate_legacy_analytics_tools(skill);
    skill.source = SkillSource::Merged;
    Ok(())
}

fn migrate_legacy_analytics_tools(skill: &mut LoadedSkill) {
    if !matches!(
        skill.skill_key.as_str(),
        "report_analysis" | "process_research"
    ) {
        return;
    }

    skill.required_tools.retain(|tool| {
        !matches!(
            tool.as_str(),
            "list_datasets" | "describe_dataset" | "run_query"
        )
    });
    skill.optional_tools.retain(|tool| {
        !matches!(
            tool.as_str(),
            "list_datasets" | "describe_dataset" | "run_query"
        )
    });
    if !skill
        .required_tools
        .iter()
        .any(|tool| tool == "analytics_summary")
    {
        skill.required_tools.push("analytics_summary".to_string());
    }
}

async fn load_skill_config(
    stdb: &StdbClient,
    org_id: u64,
    company_id: u64,
    skill_id: u64,
) -> Result<Option<Value>> {
    let rows = stdb
        .query_sql(&format!(
            "SELECT * FROM ai_skill_config WHERE organization_id = {org_id} \
             AND skill_id = {skill_id}"
        ))
        .await
        .context("load ai_skill_config")?;
    select_skill_config(rows, company_id)
}

fn select_skill_config(rows: Vec<Value>, company_id: u64) -> Result<Option<Value>> {
    let exact: Vec<_> = rows
        .iter()
        .filter(|row| row_u64(row, "companyId") == company_id)
        .collect();
    let inherited: Vec<_> = rows
        .iter()
        .filter(|row| row.get("companyId").is_none_or(Value::is_null))
        .collect();
    if exact.len() > 1 || inherited.len() > 1 {
        anyhow::bail!("effective skill binding is ambiguous");
    }
    Ok(exact
        .first()
        .or_else(|| inherited.first())
        .copied()
        .cloned())
}

pub async fn lookup_run_id(stdb: &StdbClient, run_key: &str) -> Result<u64> {
    let escaped = run_key.replace('\'', "''");
    let sql = format!("SELECT id FROM ai_agent_run WHERE run_key = '{escaped}' LIMIT 1");
    let rows = stdb.query_sql(&sql).await.context("lookup ai_agent_run")?;
    rows.first()
        .map(|row| row_u64(row, "id"))
        .filter(|id| *id > 0)
        .ok_or_else(|| anyhow::anyhow!("run not found for key '{run_key}'"))
}

pub async fn create_run(
    stdb: &StdbClient,
    org_id: u64,
    company_id: u64,
    skill: &LoadedSkill,
    agent_id: u64,
    team_member_id: Option<u64>,
    run_key: &str,
    inputs_json: &str,
    triggered_by_hex: &str,
) -> Result<GovernedRunRef> {
    create_run_with_program_ref(
        stdb,
        org_id,
        company_id,
        skill,
        agent_id,
        team_member_id,
        run_key,
        inputs_json,
        triggered_by_hex,
        None,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn create_run_with_program_ref(
    stdb: &StdbClient,
    org_id: u64,
    company_id: u64,
    skill: &LoadedSkill,
    agent_id: u64,
    team_member_id: Option<u64>,
    run_key: &str,
    inputs_json: &str,
    triggered_by_hex: &str,
    program_ref: Option<&str>,
) -> Result<GovernedRunRef> {
    let policy_ref = intelligence_policy_ref(&skill.config_json)?;
    let metadata = serde_json::json!({
        "intelligence_policy_ref": policy_ref.clone(),
        "skill_id": skill.id,
        "skill_config_id": skill.skill_config_id,
        "program_ref": program_ref,
    })
    .to_string();
    stdb.call_reducer(stdb_client::reducer_call!(
        "create_ai_agent_run",
        serde_json::json!([
            org_id,
            {
                "company_id": company_id,
                "skill_id": skill.id,
                "skill_config_id": sats_option(skill.skill_config_id.map(Value::from)),
                "agent_id": agent_id,
                "team_member_id": sats_option(team_member_id.map(Value::from)),
                "run_key": run_key,
                "inputs_json": inputs_json,
                "triggered_by_hex": triggered_by_hex,
                "metadata": sats_option(Some(Value::String(metadata))),
            }
        ]),
    ))
    .await
    .context("create_ai_agent_run")?;

    let run_id = lookup_run_id(stdb, run_key).await?;
    initialize_run_lifecycle(
        stdb,
        org_id,
        company_id,
        run_id,
        skill.id,
        agent_id,
        team_member_id,
        run_key,
        inputs_json,
        triggered_by_hex,
    )
    .await?;
    Ok(GovernedRunRef {
        run_id,
        run_key: run_key.to_string(),
        skill_id: skill.id,
        skill_config_id: skill.skill_config_id,
        intelligence_policy_ref: policy_ref,
        program_ref: program_ref.map(str::to_string),
    })
}

/// Resolve a system/bundled generation surface to a provisioned `ai_skill`
/// and create a normal durable run for it. Runtime never provisions the skill;
/// deployments must sync bundled skills first.
#[allow(clippy::too_many_arguments)]
pub async fn create_generation_surface_run(
    stdb: &StdbClient,
    org_id: u64,
    company_id: u64,
    skill_key: &str,
    agent_id: u64,
    team_member_id: Option<u64>,
    inputs_json: &str,
    triggered_by_hex: &str,
) -> Result<GovernedRunRef> {
    let skill = load_skill(stdb, org_id, company_id, skill_key).await?;
    if skill.id == 0 {
        anyhow::bail!(
            "generation surface skill '{skill_key}' is not provisioned; sync bundled skills before serving this route"
        );
    }
    if !skill.enabled {
        anyhow::bail!("generation surface skill '{skill_key}' is disabled");
    }
    let catalog = super::governed_programs::governed_program_for_skill(skill_key)
        .with_context(|| format!(
            "generation surface skill '{skill_key}' is not registered in the governed program catalog"
        ))?;
    let run_key = uuid::Uuid::new_v4().to_string();
    create_run_with_program_ref(
        stdb,
        org_id,
        company_id,
        &skill,
        agent_id,
        team_member_id,
        &run_key,
        inputs_json,
        triggered_by_hex,
        Some(catalog.program_ref),
    )
    .await
}

/// Resolve a generation surface and reuse its exact durable run when a caller
/// retries the same stable run key. A concurrent create that loses the
/// `run_key` race recovers only an exact tenant-, payload-, and actor-bound
/// match; it never selects a latest run.
#[allow(clippy::too_many_arguments)]
pub async fn create_or_recover_generation_surface_run(
    stdb: &StdbClient,
    org_id: u64,
    company_id: u64,
    skill_key: &str,
    agent_id: u64,
    team_member_id: Option<u64>,
    run_key: &str,
    inputs_json: &str,
    triggered_by_hex: &str,
) -> Result<GovernedRunRef> {
    let skill = load_skill(stdb, org_id, company_id, skill_key).await?;
    if skill.id == 0 {
        anyhow::bail!(
            "generation surface skill '{skill_key}' is not provisioned; sync bundled skills before serving this route"
        );
    }
    if !skill.enabled {
        anyhow::bail!("generation surface skill '{skill_key}' is disabled");
    }
    let catalog = super::governed_programs::governed_program_for_skill(skill_key)
        .with_context(|| format!(
            "generation surface skill '{skill_key}' is not registered in the governed program catalog"
        ))?;
    let binding = GenerationSurfaceRunBinding {
        organization_id: org_id,
        company_id,
        skill_id: skill.id,
        skill_config_id: skill.skill_config_id,
        agent_id,
        team_member_id,
        run_key,
        inputs_json,
        triggered_by_hex,
        intelligence_policy_ref: intelligence_policy_ref(&skill.config_json)?,
        program_ref: Some(catalog.program_ref),
    };

    if let Some(run) = load_exact_generation_surface_run(stdb, &binding).await? {
        initialize_bound_run_lifecycle(stdb, &binding, run.run_id).await?;
        return Ok(run);
    }

    let create_result = create_run_with_program_ref(
        stdb,
        org_id,
        company_id,
        &skill,
        agent_id,
        team_member_id,
        run_key,
        inputs_json,
        triggered_by_hex,
        Some(catalog.program_ref),
    )
    .await;
    match create_result {
        Ok(run) => Ok(run),
        Err(create_error) => match load_exact_generation_surface_run(stdb, &binding).await {
            Ok(Some(run)) => {
                initialize_bound_run_lifecycle(stdb, &binding, run.run_id).await?;
                Ok(run)
            }
            Ok(None) | Err(_) => Err(create_error),
        },
    }
}

struct GenerationSurfaceRunBinding<'a> {
    organization_id: u64,
    company_id: u64,
    skill_id: u64,
    skill_config_id: Option<u64>,
    agent_id: u64,
    team_member_id: Option<u64>,
    run_key: &'a str,
    inputs_json: &'a str,
    triggered_by_hex: &'a str,
    intelligence_policy_ref: Option<String>,
    program_ref: Option<&'a str>,
}

async fn initialize_bound_run_lifecycle(
    stdb: &StdbClient,
    binding: &GenerationSurfaceRunBinding<'_>,
    run_id: u64,
) -> Result<()> {
    initialize_run_lifecycle(
        stdb,
        binding.organization_id,
        binding.company_id,
        run_id,
        binding.skill_id,
        binding.agent_id,
        binding.team_member_id,
        binding.run_key,
        binding.inputs_json,
        binding.triggered_by_hex,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn initialize_run_lifecycle(
    stdb: &StdbClient,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    skill_id: u64,
    agent_id: u64,
    team_member_id: Option<u64>,
    run_key: &str,
    inputs_json: &str,
    triggered_by_hex: &str,
) -> Result<()> {
    let checkpoint_hash = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&serde_json::json!({
            "organization_id": organization_id,
            "company_id": company_id,
            "run_id": run_id,
            "skill_id": skill_id,
            "agent_id": agent_id,
            "team_member_id": team_member_id,
            "run_key": run_key,
            "inputs_json": inputs_json,
            "triggered_by_hex": triggered_by_hex,
        }))?)
    );
    stdb.call_reducer(stdb_client::reducer_call!(
        "initialize_ai_run_lifecycle",
        serde_json::json!([
            organization_id,
            company_id,
            run_id,
            {
                "checkpoint_hash": checkpoint_hash,
                "cursor": 0,
                "idempotency_key": format!("run-created:{run_id}"),
            }
        ]),
    ))
    .await
    .context("initialize durable AI run lifecycle")?;
    Ok(())
}

async fn load_exact_generation_surface_run(
    stdb: &StdbClient,
    binding: &GenerationSurfaceRunBinding<'_>,
) -> Result<Option<GovernedRunRef>> {
    let escaped = binding.run_key.replace('\'', "''");
    let rows = stdb
        .query_sql(&format!(
            "SELECT * FROM ai_agent_run WHERE run_key = '{escaped}'"
        ))
        .await
        .context("lookup exact generation-surface run")?;
    select_exact_generation_surface_run(&rows, binding)
}

fn select_exact_generation_surface_run(
    rows: &[Value],
    binding: &GenerationSurfaceRunBinding<'_>,
) -> Result<Option<GovernedRunRef>> {
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    if rows.len() != 1 {
        anyhow::bail!(
            "multiple ai_agent_run rows found for stable run key '{}'",
            binding.run_key
        );
    }

    let metadata = row
        .get("metadata")
        .and_then(Value::as_str)
        .map(serde_json::from_str::<Value>)
        .transpose()
        .context("parse generation-surface run metadata")?
        .unwrap_or(Value::Null);
    let actual_policy_ref = metadata
        .get("intelligence_policy_ref")
        .and_then(Value::as_str);
    let actual_program_ref = metadata.get("program_ref").and_then(Value::as_str);
    let expected_policy_ref = binding.intelligence_policy_ref.as_deref();

    let matches = row_u64(row, "organizationId") == binding.organization_id
        && row_u64(row, "companyId") == binding.company_id
        && row_u64(row, "skillId") == binding.skill_id
        && row_optional_u64(row, "skillConfigId") == binding.skill_config_id
        && row_u64(row, "agentId") == binding.agent_id
        && row_optional_u64(row, "teamMemberId") == binding.team_member_id
        && row_string(row, "runKey") == binding.run_key
        && row_string(row, "inputsJson") == binding.inputs_json
        && row_string(row, "triggeredByHex") == binding.triggered_by_hex
        && actual_policy_ref == expected_policy_ref
        && actual_program_ref == binding.program_ref;
    if !matches {
        anyhow::bail!(
            "stable run key '{}' is already bound to a different tenant, payload, actor, or policy",
            binding.run_key
        );
    }

    let run_id = row_u64(row, "id");
    if run_id == 0 {
        anyhow::bail!(
            "stable run key '{}' resolved to an invalid run id",
            binding.run_key
        );
    }

    Ok(Some(GovernedRunRef {
        run_id,
        run_key: binding.run_key.to_string(),
        skill_id: binding.skill_id,
        skill_config_id: binding.skill_config_id,
        intelligence_policy_ref: binding.intelligence_policy_ref.clone(),
        program_ref: binding.program_ref.map(str::to_string),
    }))
}

fn row_optional_u64(row: &Value, key: &str) -> Option<u64> {
    row.get(key)
        .filter(|value| !value.is_null())
        .and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_i64().and_then(|number| u64::try_from(number).ok()))
        })
}

pub async fn complete_run(
    stdb: &StdbClient,
    org_id: u64,
    company_id: u64,
    run_id: u64,
    status: &str,
    summary: Option<String>,
    artifacts_json: Option<String>,
    citations_json: Option<String>,
    step_count: u32,
    tokens_used: u32,
    error_message: Option<String>,
) -> Result<()> {
    stdb.call_reducer(stdb_client::reducer_call!(
        "complete_ai_agent_run",
        serde_json::json!([
            org_id,
            company_id,
            run_id,
            {
                "status": status,
                "summary": sats_option(summary.map(Value::String)),
                "artifacts_json": sats_option(artifacts_json.map(Value::String)),
                "citations_json": sats_option(citations_json.map(Value::String)),
                "action_draft_ids": [],
                "step_count": step_count,
                "tokens_used": tokens_used,
                "error_message": sats_option(error_message.map(Value::String)),
            }
        ]),
    ))
    .await
    .context("complete_ai_agent_run")?;
    Ok(())
}

/// Park an open run in a non-terminal wait state. `status` must be a wait state
/// the module accepts (`awaiting_approval` or `agent_settled`); a run already in
/// that state replays without change.
pub async fn resume_run(
    stdb: &StdbClient,
    reader: &StdbClient,
    org_id: u64,
    company_id: u64,
    run_id: u64,
) -> Result<()> {
    let row = reader
        .query_sql(&format!(
            "SELECT checkpoint_hash, cursor, concurrency_version FROM ai_run_lifecycle_state_read \
             WHERE organization_id = {org_id} AND company_id = {company_id} AND run_id = {run_id} LIMIT 1"
        ))
        .await
        .context("load checked run continuation")?
        .into_iter()
        .next()
        .context("run lifecycle is not initialized")?;
    let checkpoint_hash = row
        .get("checkpointHash")
        .and_then(Value::as_str)
        .context("run lifecycle checkpoint hash missing")?;
    let cursor = row_u64(&row, "cursor") as u32;
    let concurrency_version = row_u64(&row, "concurrencyVersion");
    stdb.call_reducer(stdb_client::reducer_call!(
        "resume_ai_run_checked",
        serde_json::json!([
            org_id,
            company_id,
            run_id,
            {
                "continuation": {
                    "checkpoint_hash": checkpoint_hash,
                    "cursor": cursor,
                    "concurrency_version": concurrency_version,
                },
                "idempotency_key": format!("runtime-resume:{run_id}:{concurrency_version}"),
            }
        ]),
    ))
    .await
    .context("resume governed ai_agent_run through checked lifecycle")?;
    Ok(())
}

pub async fn load_run_key(
    stdb: &StdbClient,
    org_id: u64,
    company_id: u64,
    run_id: u64,
) -> Result<String> {
    let rows = stdb
        .query_sql(&format!(
            "SELECT run_key, status FROM ai_agent_run WHERE organization_id = {org_id}              AND company_id = {company_id} AND id = {run_id} LIMIT 1"
        ))
        .await
        .context("load resumable ai_agent_run")?;
    let row = rows.first().context("resumable run not found")?;
    let status = row
        .get("status")
        .and_then(Value::as_str)
        .context("resumable run status missing")?;
    if !matches!(status, "running" | "awaiting_approval" | "agent_settled") {
        anyhow::bail!("run status '{status}' is not resumable");
    }
    row.get("runKey")
        .or_else(|| row.get("run_key"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .context("resumable run key missing")
}

pub async fn set_run_wait_state(
    stdb: &StdbClient,
    org_id: u64,
    company_id: u64,
    run_id: u64,
    status: &str,
) -> Result<()> {
    stdb.call_reducer(stdb_client::reducer_call!(
        "set_ai_agent_run_wait_state",
        serde_json::json!([org_id, company_id, run_id, { "status": status }]),
    ))
    .await
    .context("set_ai_agent_run_wait_state")?;
    Ok(())
}

pub async fn list_skills(stdb: &StdbClient, org_id: u64) -> Result<Vec<Value>> {
    let sql = format!(
        "SELECT * FROM ai_skill \
         WHERE is_active = true AND (organization_id = 0 OR organization_id = {org_id}) \
         ORDER BY organization_id DESC, skill_key ASC"
    );
    let mut rows = stdb.query_sql(&sql).await.context("list ai_skill")?;

    let mut seen = std::collections::HashSet::new();
    rows.retain(|row| {
        let key = row
            .get("skillKey")
            .or_else(|| row.get("skill_key"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if key.is_empty() {
            return false;
        }
        seen.insert(key)
    });

    for md in crate::skills::discover_bundled_skills()? {
        if seen.contains(&md.skill_key) {
            continue;
        }
        rows.push(serde_json::json!({
            "id": 0,
            "skillKey": md.skill_key,
            "name": md.name,
            "description": md.description,
            "category": md.category,
            "isSystem": true,
            "source": "bundled_md",
        }));
    }

    Ok(rows)
}

pub async fn sync_bundled_skills(stdb: &StdbClient, organization_id: u64) -> Result<Vec<String>> {
    let bundled = crate::skills::discover_bundled_skills()?;
    let mut synced = Vec::new();

    for md in bundled {
        let payload = crate::skills::bundled_to_sync_payload(&md)?;
        stdb.call_reducer(stdb_client::reducer_call!("upsert_ai_skill", serde_json::json!([
                organization_id,
                {
                    "skill_key": payload.skill_key,
                    "name": payload.name,
                    "description": sats_option(payload.description.map(Value::String)),
                    "category": payload.category,
                    "prompt_template": payload.prompt_template,
                    "required_tools": payload.required_tools,
                    "optional_tools": payload.optional_tools,
                    "default_max_steps": payload.default_max_steps,
                    "default_max_tool_calls": payload.default_max_tool_calls,
                    "output_schema": sats_option(Some(Value::String(
                        r#"{"type":"object","properties":{"summary":{"type":"string"}}}"#.to_string(),
                    ))),
                    "config_schema": sats_option(Some(Value::String(
                        r#"{"type":"object","properties":{"default_limit":{"type":"integer"},"max_snapshots":{"type":"integer"}}}"#.to_string(),
                    ))),
                    "dataset_specs": sats_option(payload.dataset_specs.map(Value::String)),
                    "allowed_action_drafts": payload.allowed_action_drafts,
                    "is_active": true,
                    "is_system": organization_id == 0,
                    "metadata": sats_option(Some(Value::String(payload.metadata))),
                }
            ]),))
        .await
        .with_context(|| format!("upsert bundled skill {}", md.skill_key))?;
        synced.push(md.skill_key);
    }

    Ok(synced)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn skill_availability_rows(
        statement: &str,
        key: &str,
        case: &str,
    ) -> Option<Vec<Value>> {
        use serde_json::json;
        if statement.contains("FROM ai_skill_config ") {
            return Some(vec![json!({
                "id": 1, "company_id": 3, "is_enabled": case != "disabled"
            })]);
        }
        if statement.contains("FROM ai_skill ") {
            assert!(statement.contains("LIMIT 2"));
            assert!(!statement.contains("is_active ="));
            if case == "missing" {
                return Some(vec![]);
            }
            return Some(vec![json!({
                "id": 8, "organization_id": if case == "foreign" { 999 } else { 1 },
                "skill_key": key, "is_active": case != "inactive"
            })]);
        }
        None
    }

    #[tokio::test]
    async fn effective_catalog_sql_fails_closed_and_only_falls_back_on_absence() {
        use axum::{extract::State, routing::post, Json, Router};
        use std::sync::{Arc, Mutex};
        type Fixture = (Vec<Value>, Vec<Value>, Vec<String>);
        async fn sql(State(state): State<Arc<Mutex<Fixture>>>, statement: String) -> Json<Value> {
            let mut state = state.lock().unwrap();
            assert!(statement.contains("FROM ai_skill "));
            assert!(statement.contains("skill_key = 'rag_generation'"));
            assert!(statement.ends_with("LIMIT 2"));
            assert!(!statement.contains("is_active ="));
            assert!(!statement.contains(" OR "));
            let rows = if statement.contains("organization_id = 1 ") {
                state.0.clone()
            } else {
                assert!(statement.contains("organization_id = 0 "));
                state.1.clone()
            };
            state.2.push(statement);
            Json(sats_rows(rows))
        }
        let state = Arc::new(Mutex::new((vec![], vec![], vec![])));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let stdb = StdbClient::new(
            format!("http://{}", listener.local_addr().unwrap()),
            "fixture".into(),
            "gateway".into(),
        );
        let app = Router::new()
            .route("/v1/database/fixture/sql", post(sql))
            .with_state(state.clone());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let local = serde_json::json!({
            "id": 8, "organization_id": 1, "skill_key": "rag_generation", "is_active": true
        });
        let global = serde_json::json!({
            "id": 9, "organization_id": 0, "skill_key": "rag_generation", "is_active": true
        });
        let mut inactive_local = local.clone();
        inactive_local["is_active"] = false.into();
        let mut inactive_global = global.clone();
        inactive_global["is_active"] = false.into();
        let mut wrong_scope = local.clone();
        wrong_scope["organization_id"] = 99.into();
        let mut wrong_key = local.clone();
        wrong_key["skill_key"] = "other".into();
        for (locals, globals, reads, success) in [
            (vec![inactive_local], vec![global.clone()], 1, false),
            (vec![], vec![inactive_global], 2, false),
            (
                vec![local.clone(), local.clone()],
                vec![global.clone()],
                1,
                false,
            ),
            (vec![], vec![global.clone(), global.clone()], 2, false),
            (vec![wrong_scope], vec![global.clone()], 1, false),
            (vec![wrong_key], vec![global.clone()], 1, false),
            (vec![], vec![global], 2, true),
        ] {
            *state.lock().unwrap() = (locals, globals, vec![]);
            let result = load_effective_catalog_skill(&stdb, 1, "rag_generation").await;
            assert_eq!(result.is_ok(), success);
            if success {
                assert_eq!(result.unwrap().unwrap()["id"], 9);
            }
            assert_eq!(state.lock().unwrap().2.len(), reads);
            if !success {
                // Both entry points use the same SQL rule and stop before any
                // release/config lookup (or a bundled fallback).
                state.lock().unwrap().2.clear();
                assert!(load_skill(&stdb, 1, 3, "rag_generation").await.is_err());
                assert_eq!(state.lock().unwrap().2.len(), reads);
                state.lock().unwrap().2.clear();
                assert!(
                    crate::harness::release_registry::load_builtin_execution_manifest(
                        &stdb,
                        1,
                        3,
                        "rag_generation",
                        1
                    )
                    .await
                    .is_err()
                );
                assert_eq!(state.lock().unwrap().2.len(), reads);
            }
        }
        server.abort();
    }

    pub(crate) fn sats_rows(rows: Vec<Value>) -> Value {
        let names: Vec<_> = rows
            .first()
            .and_then(Value::as_object)
            .map(|row| row.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        serde_json::json!([{
            "schema": {"elements": names.iter().map(|name| serde_json::json!({"name": {"some": name}})).collect::<Vec<_>>()},
            "rows": rows.iter().map(|row| names.iter().map(|name| row[name].clone()).collect::<Vec<_>>()).collect::<Vec<_>>()
        }])
    }

    #[tokio::test]
    async fn built_in_generation_uses_catalog_and_company_binding_without_release_queries() {
        use axum::{extract::State, routing::post, Json, Router};
        use std::sync::{Arc, Mutex};
        async fn sql(
            State(state): State<Arc<Mutex<(&'static str, &'static str)>>>,
            statement: String,
        ) -> Json<Value> {
            let (key, case) = *state.lock().unwrap();
            Json(sats_rows(
                skill_availability_rows(&statement, key, case)
                    .unwrap_or_else(|| panic!("unexpected skill query: {statement}")),
            ))
        }
        let state = Arc::new(Mutex::new(("rag_generation", "active")));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let stdb = StdbClient::new(
            format!("http://{}", listener.local_addr().unwrap()),
            "fixture".into(),
            "gateway".into(),
        );
        let app = Router::new()
            .route("/v1/database/fixture/sql", post(sql))
            .with_state(state.clone());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        for key in super::super::generation_surface_certification::KEYS {
            for case in ["active", "disabled", "inactive", "missing", "foreign"] {
                *state.lock().unwrap() = (key, case);
                let result = require_enabled_skill(&stdb, 1, 3, key).await;
                assert_eq!(result.is_ok(), case == "active", "{key}: {case}");
                let manifest = crate::harness::release_registry::load_builtin_execution_manifest(
                    &stdb, 1, 3, key, 1,
                )
                .await;
                assert_eq!(manifest.is_ok(), case == "active", "{key}: {case}");
            }
        }
        server.abort();
    }

    fn legacy_analytics_skill(skill_key: &str) -> LoadedSkill {
        LoadedSkill {
            id: 1,
            skill_key: skill_key.to_string(),
            name: "Legacy analytics".to_string(),
            category: "analytics".to_string(),
            prompt_template: String::new(),
            required_tools: vec![
                "erp_search".to_string(),
                "list_datasets".to_string(),
                "run_query".to_string(),
            ],
            optional_tools: vec!["describe_dataset".to_string()],
            default_max_steps: 5,
            default_max_tool_calls: 12,
            config_json: serde_json::json!({}),
            custom_instructions: None,
            skill_config_id: None,
            enabled: true,
            allowed_action_drafts: vec![],
            source: SkillSource::Remote,
        }
    }

    #[test]
    fn governed_run_ref_preserves_canonical_identity() {
        let run = GovernedRunRef {
            run_id: 42,
            run_key: "run-42".to_string(),
            skill_id: 7,
            skill_config_id: Some(9),
            intelligence_policy_ref: Some("finance-generation@2".to_string()),
            program_ref: Some("skill:test@1".to_string()),
        };

        assert_eq!(run.run_id, 42);
        assert_eq!(run.run_key, "run-42");
        assert_eq!(run.skill_id, 7);
        assert_eq!(run.skill_config_id, Some(9));
        assert_eq!(
            run.intelligence_policy_ref.as_deref(),
            Some("finance-generation@2")
        );
        assert_eq!(run.program_ref.as_deref(), Some("skill:test@1"));
    }

    #[test]
    fn intelligence_policy_ref_is_strict_and_versioned() {
        assert_eq!(
            intelligence_policy_ref(&serde_json::json!({})).unwrap(),
            None
        );
        assert_eq!(
            intelligence_policy_ref(&serde_json::json!({
                "intelligencePolicyRef": "generation-default@3"
            }))
            .unwrap()
            .as_deref(),
            Some("generation-default@3")
        );
        assert!(intelligence_policy_ref(&serde_json::json!({
            "intelligencePolicyRef": "generation-default"
        }))
        .is_err());
        assert!(intelligence_policy_ref(&serde_json::json!({
            "intelligencePolicyRef": 7
        }))
        .is_err());
    }

    #[test]
    fn company_agent_binding_preserves_explicit_agent_and_persona_selection() {
        let config = serde_json::json!({"defaultAgentId": 7});
        assert_eq!(skill_agent_id(&config, None, None).unwrap(), Some(7));
        assert_eq!(skill_agent_id(&config, Some(8), None).unwrap(), Some(8));
        assert_eq!(skill_agent_id(&config, None, Some(9)).unwrap(), None);
        assert_eq!(
            skill_agent_id(&serde_json::json!({}), None, None).unwrap(),
            None
        );
        assert!(skill_agent_id(&serde_json::json!({"defaultAgentId": 0}), None, None).is_err());
        assert!(skill_agent_id(&serde_json::json!({"defaultAgentId": "7"}), None, None).is_err());
    }

    #[test]
    fn company_skill_config_takes_precedence_without_optional_sql_predicates() {
        let selected = select_skill_config(
            vec![
                serde_json::json!({"id": 1, "companyId": null}),
                serde_json::json!({"id": 2, "companyId": 267}),
            ],
            267,
        )
        .unwrap()
        .unwrap();
        assert_eq!(row_u64(&selected, "id"), 2);

        let fallback =
            select_skill_config(vec![serde_json::json!({"id": 1, "companyId": null})], 999)
                .unwrap()
                .unwrap();
        assert_eq!(row_u64(&fallback, "id"), 1);
    }

    #[test]
    fn ambiguous_skill_bindings_never_pick_an_arbitrary_row() {
        for company in [serde_json::json!(267), Value::Null] {
            assert!(select_skill_config(
                vec![
                    serde_json::json!({"id": 51, "companyId": company, "isEnabled": false}),
                    serde_json::json!({"id": 73, "companyId": company, "isEnabled": true}),
                ],
                267,
            )
            .is_err());
        }
    }

    fn generation_run_binding(inputs_json: &str) -> GenerationSurfaceRunBinding<'_> {
        GenerationSurfaceRunBinding {
            organization_id: 9,
            company_id: 7,
            skill_id: 5,
            skill_config_id: Some(3),
            agent_id: 11,
            team_member_id: None,
            run_key: "harness-action-draft:stable",
            inputs_json,
            triggered_by_hex: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            intelligence_policy_ref: Some("generation-default@1".to_string()),
            program_ref: Some("skill:action_draft_generation@1"),
        }
    }

    fn generation_run_row(inputs_json: &str) -> Value {
        serde_json::json!({
            "id": 41,
            "organizationId": 9,
            "companyId": 7,
            "skillId": 5,
            "skillConfigId": 3,
            "agentId": 11,
            "teamMemberId": null,
            "runKey": "harness-action-draft:stable",
            "inputsJson": inputs_json,
            "triggeredByHex": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "metadata": serde_json::json!({
                "intelligence_policy_ref": "generation-default@1",
                "program_ref": "skill:action_draft_generation@1",
            }).to_string(),
        })
    }

    #[test]
    fn exact_generation_run_replay_recovers_one_matching_row() {
        let inputs = r#"{"surface":"harness_action_draft_bridge","correlation_id":"corr-41"}"#;
        let run = select_exact_generation_surface_run(
            &[generation_run_row(inputs)],
            &generation_run_binding(inputs),
        )
        .expect("exact replay")
        .expect("existing run");

        assert_eq!(run.run_id, 41);
        assert_eq!(run.run_key, "harness-action-draft:stable");
    }

    #[test]
    fn exact_generation_run_replay_rejects_payload_change() {
        let original = r#"{"surface":"harness_action_draft_bridge","correlation_id":"corr-41"}"#;
        let changed = r#"{"surface":"harness_action_draft_bridge","correlation_id":"corr-41","input":{"customer_id":12}}"#;

        let error = select_exact_generation_surface_run(
            &[generation_run_row(original)],
            &generation_run_binding(changed),
        )
        .expect_err("changed payload must conflict");

        assert!(error
            .to_string()
            .contains("different tenant, payload, actor, or policy"));
    }

    #[test]
    fn exact_generation_run_replay_rejects_ambiguous_identity() {
        let inputs = r#"{"surface":"harness_action_draft_bridge","correlation_id":"corr-41"}"#;
        let row = generation_run_row(inputs);

        let error = select_exact_generation_surface_run(
            &[row.clone(), row],
            &generation_run_binding(inputs),
        )
        .expect_err("duplicate stable run identity must fail closed");

        assert!(error
            .to_string()
            .contains("multiple ai_agent_run rows found"));
    }

    #[test]
    fn nested_reducer_options_use_sats_sum_encoding() {
        assert_eq!(
            sats_option(Some(Value::from(9))),
            serde_json::json!({"some": 9})
        );
        assert_eq!(sats_option(None), serde_json::json!({"none": []}));
    }

    #[test]
    fn bundled_overlay_cannot_restore_database_only_tools_or_drafts() {
        let mut skill = legacy_analytics_skill("report_analysis");
        skill.allowed_action_drafts = vec!["create_task".into()];
        apply_bundled_overlay(&mut skill).unwrap();
        assert_eq!(skill.required_tools, vec!["analytics_summary"]);
        assert!(skill.optional_tools.is_empty());
        assert!(skill.allowed_action_drafts.is_empty());
        assert_eq!(skill.source, SkillSource::Merged);
    }

    #[test]
    fn migrates_legacy_report_analysis_tools() {
        let mut skill = legacy_analytics_skill("report_analysis");
        migrate_legacy_analytics_tools(&mut skill);

        assert_eq!(
            skill.required_tools,
            vec!["erp_search", "analytics_summary"]
        );
        assert!(skill.optional_tools.is_empty());
    }

    #[test]
    fn leaves_unrelated_skills_unchanged() {
        let mut skill = legacy_analytics_skill("price_search");
        migrate_legacy_analytics_tools(&mut skill);

        assert!(skill.required_tools.iter().any(|tool| tool == "run_query"));
        assert!(skill
            .optional_tools
            .iter()
            .any(|tool| tool == "describe_dataset"));
    }
}
