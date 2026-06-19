use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

use crate::{
    ai_agent::{
        ensure_allowed_action, ensure_model_allowed, ensure_within_budget,
        enforce_chargeable_limits, record_ai_spend, resolve_agent,
    },
    orchestrator::skill_loader::{complete_run, create_run, load_skill, resolve_dataset_specs, LoadedSkill},
    providers::llm::LlmMessage,
    sandbox::{default_analysis_sql, SandboxSession},
    state::AppState,
    tools::{
        registry::ToolRegistry,
        types::{SkillCitation, ToolContext},
    },
};

const DEFAULT_MAX_STEPS: u32 = 5;

#[derive(Debug, Deserialize)]
pub struct RunSkillRequest {
    pub org_id: u64,
    pub company_id: u64,
    pub skill_key: String,
    pub inputs: Value,
    pub agent_id: Option<u64>,
    pub team_member_id: Option<u64>,
    pub triggered_by_hex: Option<String>,
    pub stdb_token: Option<String>,
    pub overrides: Option<RunSkillOverrides>,
}

#[derive(Debug, Deserialize, Default)]
pub struct RunSkillOverrides {
    pub max_steps: Option<u32>,
}

#[derive(Debug, Serialize, Clone)]
pub struct SkillArtifact {
    pub kind: String,
    pub title: String,
    pub content: Value,
}

#[derive(Debug, Serialize, Clone)]
pub struct RunSkillStepSummary {
    pub step_no: u32,
    pub tool: String,
    pub duration_ms: u64,
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct RunSkillResponse {
    pub run_id: u64,
    pub run_key: String,
    pub status: String,
    pub summary: String,
    pub artifacts: Vec<SkillArtifact>,
    pub citations: Vec<SkillCitation>,
    pub steps: Vec<RunSkillStepSummary>,
    pub agent_id: u64,
    pub skill_key: String,
}

pub async fn run_skill(state: &AppState, req: RunSkillRequest) -> Result<RunSkillResponse> {
    if req.org_id == 0 {
        anyhow::bail!("org_id is required");
    }
    if req.company_id == 0 {
        anyhow::bail!("company_id is required");
    }
    let skill_key = req.skill_key.trim();
    if skill_key.is_empty() {
        anyhow::bail!("skill_key is required");
    }

    let stdb = req
        .stdb_token
        .as_ref()
        .filter(|t| !t.trim().is_empty())
        .map(|token| state.stdb.with_token(token.clone()))
        .unwrap_or_else(|| state.stdb.as_ref().clone());

    let skill = load_skill(&stdb, req.org_id, req.company_id, skill_key).await?;
    if !skill.enabled {
        anyhow::bail!("skill '{skill_key}' is disabled for this company");
    }

    let agent = resolve_agent(
        &stdb,
        req.org_id,
        req.agent_id,
        req.team_member_id,
    )
    .await?;
    ensure_allowed_action(&agent, "skill_run")?;
    ensure_model_allowed(&agent)?;
    ensure_within_budget(&agent)?;

    let run_key = Uuid::new_v4().to_string();
    let inputs_json = serde_json::to_string(&req.inputs).context("serialize inputs")?;
    let triggered_by_hex = req
        .triggered_by_hex
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("0000000000000000000000000000000000000000000000000000000000000000")
        .to_string();

    let run_id = create_run(
        &stdb,
        req.org_id,
        req.company_id,
        &skill,
        agent.agent_id,
        req.team_member_id,
        &run_key,
        &inputs_json,
        &triggered_by_hex,
    )
    .await?;

    let registry = ToolRegistry::new();
    let allowed_tools = resolve_allowed_tools(&skill, &agent);
    let dataset_specs = resolve_dataset_specs(&skill);
    let needs_sandbox = allowed_tools.iter().any(|t| {
        matches!(t.as_str(), "list_datasets" | "describe_dataset" | "run_query")
    });
    let sandbox = if needs_sandbox && !dataset_specs.is_empty() {
        Some(Arc::new(Mutex::new(
            SandboxSession::materialize(
                &stdb,
                req.org_id,
                req.company_id,
                run_id,
                &dataset_specs,
                &req.inputs,
            )
            .await
            .context("materialize analytics sandbox")?,
        )))
    } else {
        None
    };

    let tool_ctx = ToolContext {
        state: state.clone(),
        stdb: Arc::new(stdb.clone()),
        org_id: req.org_id,
        company_id: req.company_id,
        run_id,
        skill_key: skill.skill_key.clone(),
        config_json: skill.config_json.clone(),
        inputs: req.inputs.clone(),
        sandbox,
        dataset_specs,
        allowed_action_drafts: skill.allowed_action_drafts.clone(),
    };

    let max_steps = req
        .overrides
        .as_ref()
        .and_then(|o| o.max_steps)
        .unwrap_or(skill.default_max_steps)
        .min(12);

    let mut step_no = 0_u32;
    let mut steps: Vec<RunSkillStepSummary> = Vec::new();
    let mut citations: Vec<SkillCitation> = Vec::new();
    let mut tool_payloads: Vec<Value> = Vec::new();

    let query = extract_query(&req.inputs);
    let entity_type = req
        .inputs
        .get("entity_type")
        .or_else(|| req.inputs.get("entityType"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let entity_id = req
        .inputs
        .get("entity_id")
        .or_else(|| req.inputs.get("entityId"))
        .or_else(|| req.inputs.get("product_id"))
        .or_else(|| req.inputs.get("productId"))
        .and_then(|v| v.as_u64().or_else(|| v.as_str()?.parse().ok()));
    let entity_type = entity_type.or_else(|| {
        if req.inputs.get("product_id").or_else(|| req.inputs.get("productId")).is_some() {
            Some("product".to_string())
        } else {
            None
        }
    });

    if allowed_tools.iter().any(|t| t == "erp_snapshot")
        && step_no < max_steps
        && entity_type.is_some()
        && entity_id.is_some()
    {
        step_no += 1;
        let input = json!({
            "entity_type": entity_type,
            "entity_id": entity_id,
            "max_snapshots": skill.config_json.get("max_snapshots").and_then(|v| v.as_u64()).unwrap_or(3),
        });
        let output = registry
            .run_and_record(
                &stdb,
                req.org_id,
                req.company_id,
                run_id,
                step_no,
                "erp_snapshot",
                &tool_ctx,
                &input,
            )
            .await?;
        steps.push(RunSkillStepSummary {
            step_no,
            tool: "erp_snapshot".to_string(),
            duration_ms: 0,
            summary: output.summary.clone(),
        });
        citations.extend(output.citations.clone());
        tool_payloads.push(json!({ "tool": "erp_snapshot", "data": output.data }));
    }

    if allowed_tools.iter().any(|t| t == "erp_search") && step_no < max_steps && !query.is_empty()
    {
        step_no += 1;
        let input = json!({
            "query": query,
            "limit": skill.config_json.get("default_limit").and_then(|v| v.as_u64()).unwrap_or(8),
        });
        let output = registry
            .run_and_record(
                &stdb,
                req.org_id,
                req.company_id,
                run_id,
                step_no,
                "erp_search",
                &tool_ctx,
                &input,
            )
            .await?;
        steps.push(RunSkillStepSummary {
            step_no,
            tool: "erp_search".to_string(),
            duration_ms: 0,
            summary: output.summary.clone(),
        });
        citations.extend(output.citations.clone());
        tool_payloads.push(json!({ "tool": "erp_search", "data": output.data }));
    }

    if allowed_tools.iter().any(|t| t == "list_datasets") && step_no < max_steps {
        step_no += 1;
        let output = registry
            .run_and_record(
                &stdb,
                req.org_id,
                req.company_id,
                run_id,
                step_no,
                "list_datasets",
                &tool_ctx,
                &json!({}),
            )
            .await?;
        steps.push(RunSkillStepSummary {
            step_no,
            tool: "list_datasets".to_string(),
            duration_ms: 0,
            summary: output.summary.clone(),
        });
        tool_payloads.push(json!({ "tool": "list_datasets", "data": output.data }));
    }

    let mut query_artifact: Option<SkillArtifact> = None;
    if allowed_tools.iter().any(|t| t == "run_query") && step_no < max_steps {
        let sql = extract_analysis_sql(&req.inputs, &skill);
        if let Some(sql) = sql {
            step_no += 1;
            let output = registry
                .run_and_record(
                    &stdb,
                    req.org_id,
                    req.company_id,
                    run_id,
                    step_no,
                    "run_query",
                    &tool_ctx,
                    &json!({ "sql": sql }),
                )
                .await?;
            steps.push(RunSkillStepSummary {
                step_no,
                tool: "run_query".to_string(),
                duration_ms: 0,
                summary: output.summary.clone(),
            });
            tool_payloads.push(json!({ "tool": "run_query", "data": output.data }));
            query_artifact = Some(SkillArtifact {
                kind: "table".to_string(),
                title: "Analytics query result".to_string(),
                content: output.data,
            });
        }
    }

    let mut comparison_artifact: Option<SkillArtifact> = None;
    if allowed_tools.iter().any(|t| t == "web_search") && step_no < max_steps {
        if let Some(web_query) = build_web_search_query(&skill.skill_key, &req.inputs, &query) {
            step_no += 1;
            let output = registry
                .run_and_record(
                    &stdb,
                    req.org_id,
                    req.company_id,
                    run_id,
                    step_no,
                    "web_search",
                    &tool_ctx,
                    &json!({ "query": web_query }),
                )
                .await?;
            steps.push(RunSkillStepSummary {
                step_no,
                tool: "web_search".to_string(),
                duration_ms: 0,
                summary: output.summary.clone(),
            });
            citations.extend(output.citations.clone());
            tool_payloads.push(json!({ "tool": "web_search", "data": output.data }));
            if skill.skill_key == "price_search" {
                comparison_artifact = Some(SkillArtifact {
                    kind: "table".to_string(),
                    title: "External price candidates".to_string(),
                    content: price_comparison_from_web(&output.data),
                });
            }
        }
    }

    let (summary, tokens_used) = synthesize_summary(
        state,
        req.org_id,
        &agent,
        &skill,
        &query,
        &tool_payloads,
    )
    .await?;

    let artifact = SkillArtifact {
        kind: "markdown".to_string(),
        title: format!("{} summary", skill.name),
        content: Value::String(summary.clone()),
    };

    let mut artifacts = vec![artifact.clone()];
    if let Some(table) = query_artifact {
        artifacts.push(table);
    }
    if let Some(table) = comparison_artifact {
        artifacts.push(table);
    }

    if allowed_tools.iter().any(|t| t == "save_artifact") && step_no < max_steps {
        step_no += 1;
        let input = json!({
            "kind": "markdown",
            "title": artifact.title,
            "content": artifact.content,
        });
        let output = registry
            .run_and_record(
                &stdb,
                req.org_id,
                req.company_id,
                run_id,
                step_no,
                "save_artifact",
                &tool_ctx,
                &input,
            )
            .await?;
        steps.push(RunSkillStepSummary {
            step_no,
            tool: "save_artifact".to_string(),
            duration_ms: 0,
            summary: output.summary,
        });
    }

    let artifacts_json = serde_json::to_string(&artifacts).ok();
    let citations_json = serde_json::to_string(&citations).ok();

    complete_run(
        &stdb,
        req.org_id,
        req.company_id,
        run_id,
        "completed",
        Some(summary.clone()),
        artifacts_json,
        citations_json,
        step_no,
        tokens_used,
        None,
    )
    .await?;

    if tokens_used > 0 {
        let _ = record_ai_spend(&stdb, req.org_id, agent.agent_id, tokens_used).await;
    }

    Ok(RunSkillResponse {
        run_id,
        run_key,
        status: "completed".to_string(),
        summary,
        artifacts,
        citations,
        steps,
        agent_id: agent.agent_id,
        skill_key: skill.skill_key,
    })
}

fn resolve_allowed_tools(skill: &LoadedSkill, agent: &crate::ai_agent::ResolvedAgentConfig) -> Vec<String> {
    let registry = ToolRegistry::new();
    let mut tool_names = skill.required_tools.clone();
    for name in &skill.optional_tools {
        if !tool_names.iter().any(|existing| existing == name) {
            tool_names.push(name.clone());
        }
    }
    registry
        .filter_for_agent(agent, &tool_names)
        .into_iter()
        .map(|tool| tool.name().to_string())
        .collect()
}

fn build_web_search_query(skill_key: &str, inputs: &Value, query: &str) -> Option<String> {
    if !query.trim().is_empty() {
        return Some(query.trim().to_string());
    }
    if skill_key == "price_search" || skill_key == "supplier_discovery" {
        let product_name = inputs
            .get("product_name")
            .or_else(|| inputs.get("productName"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let sku = inputs
            .get("default_code")
            .or_else(|| inputs.get("sku"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let category = inputs
            .get("category")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let mut parts = Vec::new();
        if skill_key == "price_search" {
            parts.push("supplier price".to_string());
        } else {
            parts.push("supplier discovery".to_string());
        }
        if let Some(name) = product_name {
            parts.push(name.to_string());
        }
        if let Some(code) = sku {
            parts.push(code.to_string());
        }
        if let Some(cat) = category {
            parts.push(cat.to_string());
        }
        if parts.len() > 1 {
            return Some(parts.join(" "));
        }
    }
    None
}

fn price_comparison_from_web(data: &Value) -> Value {
    let rows = data
        .get("results")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .enumerate()
                .map(|(idx, row)| {
                    json!({
                        "rank": idx + 1,
                        "title": row.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                        "url": row.get("url").and_then(|v| v.as_str()).unwrap_or(""),
                        "snippet": row.get("snippet").and_then(|v| v.as_str()).unwrap_or(""),
                        "score": row.get("score"),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "columns": ["rank", "title", "url", "snippet", "score"],
        "rows": rows,
    })
}

fn extract_analysis_sql(inputs: &Value, skill: &LoadedSkill) -> Option<String> {
    for key in ["analysis_sql", "sql", "analysisSql"] {
        if let Some(value) = inputs.get(key).and_then(|v| v.as_str()) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    default_analysis_sql(&skill.skill_key).map(str::to_string)
}

fn extract_query(inputs: &Value) -> String {
    for key in ["query", "goal", "question", "prompt"] {
        if let Some(value) = inputs.get(key).and_then(|v| v.as_str()) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    String::new()
}

async fn synthesize_summary(
    state: &AppState,
    org_id: u64,
    agent: &crate::ai_agent::ResolvedAgentConfig,
    skill: &LoadedSkill,
    query: &str,
    tool_payloads: &[Value],
) -> Result<(String, u32)> {
    if tool_payloads.is_empty() {
        return Ok((
            "No ERP data was retrieved for this skill run. Provide a query and/or entity focus."
                .to_string(),
            0,
        ));
    }

    enforce_chargeable_limits(state.agent_rate_limiter.as_ref(), org_id, agent)
        .map_err(|violation| anyhow::Error::new(violation))?;

    let tool_context = serde_json::to_string_pretty(tool_payloads).unwrap_or_default();
    let custom = skill
        .custom_instructions
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|s| format!("\nTenant instructions:\n{s}"))
        .unwrap_or_default();

    let system = format!(
        "{}\n\n{}\n{custom}\n\nUse only the tool results below. Be concise and cite entity ids when present.",
        agent.system_prompt, skill.prompt_template
    );

    let user = if query.is_empty() {
        format!("Skill: {}\n\nTool results:\n{}", skill.name, tool_context)
    } else {
        format!(
            "Skill: {}\nUser request: {}\n\nTool results:\n{}",
            skill.name, query, tool_context
        )
    };

    let response = state
        .providers
        .llm
        .complete(crate::providers::llm::LlmRequest {
            provider: agent.provider.clone(),
            model: agent.model.clone(),
            system,
            messages: vec![LlmMessage {
                role: "user".to_string(),
                content: user,
            }],
            max_tokens: agent.max_tokens.min(2048),
            temperature: Some(agent.temperature),
            top_p: Some(agent.top_p),
        })
        .await
        .context("skill synthesis LLM")?;

    let tokens_used = response.input_tokens.saturating_add(response.output_tokens);
    Ok((response.text.trim().to_string(), tokens_used))
}
