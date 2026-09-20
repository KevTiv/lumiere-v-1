use anyhow::{Context, Result};
use serde_json::Value;
use sha2::{Digest, Sha256};
use stdb_client::StdbClient;

use crate::skills::{compose_prompt, load_bundled_skill};

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

pub async fn load_skill(
    stdb: &StdbClient,
    org_id: u64,
    company_id: u64,
    skill_key: &str,
) -> Result<LoadedSkill> {
    let escaped = skill_key.replace('\'', "''");
    let sql = format!(
        "SELECT * FROM ai_skill \
         WHERE skill_key = '{escaped}' AND is_active = true \
         AND (organization_id = 0 OR organization_id = {org_id}) \
         ORDER BY organization_id DESC LIMIT 1"
    );
    let rows = stdb.query_sql(&sql).await.context("load ai_skill")?;

    if let Some(skill_row) = rows.first() {
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
        apply_bundled_overlay(&mut skill);
        return Ok(skill);
    }

    load_bundled_skill_only(skill_key)
}

fn load_bundled_skill_only(skill_key: &str) -> Result<LoadedSkill> {
    let md = load_bundled_skill(skill_key)?
        .ok_or_else(|| anyhow::anyhow!("skill '{skill_key}' not found"))?;
    Ok(bundled_to_loaded(&md))
}

fn bundled_to_loaded(md: &crate::skills::BundledSkillMd) -> LoadedSkill {
    LoadedSkill {
        id: 0,
        skill_key: md.skill_key.clone(),
        name: md.name.clone(),
        category: md.category.clone(),
        prompt_template: compose_prompt(md),
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
    }
}

fn apply_bundled_overlay(skill: &mut LoadedSkill) {
    let Ok(Some(md)) = load_bundled_skill(&skill.skill_key) else {
        return;
    };

    skill.prompt_template = compose_prompt(&md);
    if skill.required_tools.is_empty() && !md.required_tools.is_empty() {
        skill.required_tools = md.required_tools.clone();
        skill.optional_tools = md.optional_tools.clone();
    }
    if skill.allowed_action_drafts.is_empty() && !md.allowed_action_drafts.is_empty() {
        skill.allowed_action_drafts = md.allowed_action_drafts.clone();
    }
    migrate_legacy_analytics_tools(skill);
    skill.source = SkillSource::Merged;
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
    let sql = format!(
        "SELECT * FROM ai_skill_config \
         WHERE organization_id = {org_id} AND skill_id = {skill_id} \
         AND (company_id = {company_id} OR company_id IS NULL) \
         ORDER BY company_id DESC LIMIT 1"
    );
    let rows = stdb.query_sql(&sql).await.context("load ai_skill_config")?;
    Ok(rows.into_iter().next())
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
    stdb.call_reducer(stdb_client::reducer_call!(
        "create_ai_agent_run",
        serde_json::json!([
            org_id,
            {
                "company_id": company_id,
                "skill_id": skill.id,
                "skill_config_id": skill.skill_config_id,
                "agent_id": agent_id,
                "team_member_id": team_member_id,
                "run_key": run_key,
                "inputs_json": inputs_json,
                "triggered_by_hex": triggered_by_hex,
                "metadata": serde_json::json!({
                    "intelligence_policy_ref": policy_ref.clone(),
                    "skill_id": skill.id,
                    "skill_config_id": skill.skill_config_id,
                    "program_ref": program_ref,
                }).to_string(),
            }
        ]),
    ))
    .await
    .context("create_ai_agent_run")?;

    let run_id = lookup_run_id(stdb, run_key).await?;
    let checkpoint_hash = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&serde_json::json!({
            "organization_id": org_id,
            "company_id": company_id,
            "run_id": run_id,
            "skill_id": skill.id,
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
            org_id,
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
                "summary": summary,
                "artifacts_json": artifacts_json,
                "citations_json": citations_json,
                "action_draft_ids": [],
                "step_count": step_count,
                "tokens_used": tokens_used,
                "error_message": error_message,
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
    org_id: u64,
    company_id: u64,
    run_id: u64,
) -> Result<()> {
    let row = stdb
        .query_sql(&format!(
            "SELECT checkpoint_hash, cursor, concurrency_version FROM ai_run_lifecycle_state \
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

    for md in crate::skills::discover_bundled_skills().unwrap_or_default() {
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
        let payload = crate::skills::bundled_to_sync_payload(&md);
        stdb.call_reducer(stdb_client::reducer_call!("upsert_ai_skill", serde_json::json!([
                organization_id,
                {
                    "skill_key": payload.skill_key,
                    "name": payload.name,
                    "description": payload.description,
                    "category": payload.category,
                    "prompt_template": payload.prompt_template,
                    "required_tools": payload.required_tools,
                    "optional_tools": payload.optional_tools,
                    "default_max_steps": payload.default_max_steps,
                    "default_max_tool_calls": payload.default_max_tool_calls,
                    "output_schema": r#"{"type":"object","properties":{"summary":{"type":"string"}}}"#,
                    "config_schema": r#"{"type":"object","properties":{"default_limit":{"type":"integer"},"max_snapshots":{"type":"integer"}}}"#,
                    "dataset_specs": payload.dataset_specs,
                    "allowed_action_drafts": payload.allowed_action_drafts,
                    "is_active": true,
                    "is_system": organization_id == 0,
                    "metadata": payload.metadata,
                }
            ]),))
        .await
        .with_context(|| format!("upsert bundled skill {}", md.skill_key))?;
        synced.push(md.skill_key);
    }

    Ok(synced)
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(intelligence_policy_ref(&serde_json::json!({})).unwrap(), None);
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
