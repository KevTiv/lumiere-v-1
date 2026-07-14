use anyhow::{Context, Result};
use serde_json::Value;
use stdb_client::StdbClient;

use crate::sandbox::{
    datasets::{
        default_price_search_specs, default_process_research_specs, default_report_analysis_specs,
        parse_dataset_specs,
    },
    DatasetSpec,
};
use crate::skills::{compose_prompt, load_bundled_skill};

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
    pub dataset_specs_raw: Option<String>,
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
            dataset_specs_raw: skill_row
                .get("datasetSpecs")
                .and_then(|v| v.as_str())
                .map(str::to_string),
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
        dataset_specs_raw: md.dataset_specs.clone(),
        allowed_action_drafts: md.allowed_action_drafts.clone(),
        source: SkillSource::Bundled,
    }
}

fn apply_bundled_overlay(skill: &mut LoadedSkill) {
    let Ok(Some(md)) = load_bundled_skill(&skill.skill_key) else {
        return;
    };

    skill.prompt_template = compose_prompt(&md);
    if skill.dataset_specs_raw.is_none() {
        skill.dataset_specs_raw = md.dataset_specs.clone();
    }
    if skill.required_tools.is_empty() && !md.required_tools.is_empty() {
        skill.required_tools = md.required_tools.clone();
        skill.optional_tools = md.optional_tools.clone();
    }
    if skill.allowed_action_drafts.is_empty() && !md.allowed_action_drafts.is_empty() {
        skill.allowed_action_drafts = md.allowed_action_drafts.clone();
    }
    skill.source = SkillSource::Merged;
}

pub fn resolve_dataset_specs(skill: &LoadedSkill) -> Vec<DatasetSpec> {
    let parsed = parse_dataset_specs(skill.dataset_specs_raw.as_deref());
    if !parsed.is_empty() {
        return parsed;
    }
    match skill.skill_key.as_str() {
        "report_analysis" => default_report_analysis_specs(),
        "process_research" => default_process_research_specs(),
        "price_search" => default_price_search_specs(),
        _ => Vec::new(),
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
) -> Result<u64> {
    stdb.call_reducer(
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
                "metadata": serde_json::Value::Null,
            }
        ]),
    )
    .await
    .context("create_ai_agent_run")?;

    lookup_run_id(stdb, run_key).await
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
    stdb.call_reducer(
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
    )
    .await
    .context("complete_ai_agent_run")?;
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
        stdb.call_reducer(
            "upsert_ai_skill",
            serde_json::json!([
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
            ]),
        )
        .await
        .with_context(|| format!("upsert bundled skill {}", md.skill_key))?;
        synced.push(md.skill_key);
    }

    Ok(synced)
}
