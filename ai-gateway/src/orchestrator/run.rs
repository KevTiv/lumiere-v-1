use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    ai_agent::{
        enforce_chargeable_limits, ensure_allowed_action, ensure_model_allowed,
        ensure_within_budget, record_ai_spend, resolve_agent,
    },
    orchestrator::skill_loader::{complete_run, create_run, load_skill, LoadedSkill},
    providers::llm::LlmMessage,
    skills::{
        analyze_import_mapping, collect_briefing_context, preview_import_mapping, scan_insights,
        BriefingContextRequest, ImportAnalyzeRequest, ImportPreviewRequest, InsightsScanRequest,
    },
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
    crate::harness::legacy_fence::ensure_legacy_orchestrator_allowed(skill_key)
        .map_err(|message| anyhow::anyhow!(message))?;

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
    reject_legacy_analytics_sql(&req.inputs)?;

    let agent = resolve_agent(&stdb, req.org_id, req.agent_id, req.team_member_id).await?;
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

    let run_id = if skill.id > 0 {
        create_run(
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
        .await?
    } else {
        0
    };

    let registry = ToolRegistry::new();
    let allowed_tools = resolve_allowed_tools(&skill, &agent);

    let tool_ctx = ToolContext {
        state: state.clone(),
        stdb: Arc::new(stdb.clone()),
        org_id: req.org_id,
        company_id: req.company_id,
        run_id,
        skill_key: skill.skill_key.clone(),
        config_json: skill.config_json.clone(),
        inputs: req.inputs.clone(),
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

    if skill.skill_key == "daily_briefing" {
        let briefing = collect_briefing_context(
            state.rig.as_ref(),
            BriefingContextRequest {
                org_id: req.org_id,
                company_id: Some(req.company_id),
                since_micros: req.inputs.get("since_micros").and_then(|v| v.as_i64()),
                until_micros: req.inputs.get("until_micros").and_then(|v| v.as_i64()),
                allowed_modules: string_list_from_input(&req.inputs, "resources")
                    .or_else(|| string_list_from_input(&req.inputs, "allowed_modules"))
                    .unwrap_or_default(),
                activity_query: req
                    .inputs
                    .get("activity_query")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                top_k: req
                    .inputs
                    .get("top_k")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as usize),
            },
        )
        .await;
        tool_payloads.push(json!({ "tool": "daily_briefing", "data": briefing }));
    }

    if skill.skill_key == "import_mapping" {
        if let Some(result) = run_import_mapping_skill(&req.inputs) {
            tool_payloads.push(json!({ "tool": "import_mapping", "data": result }));
        }
    }

    if skill.skill_key == "insights_scan" {
        let scan = scan_insights(
            state,
            InsightsScanRequest {
                org_id: req.org_id,
                company_id: Some(req.company_id),
                max_insights: req
                    .inputs
                    .get("max_insights")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as usize),
                abnormal_amount_threshold: req
                    .inputs
                    .get("abnormal_amount_threshold")
                    .and_then(|v| v.as_f64()),
            },
        )
        .await;
        tool_payloads.push(json!({ "tool": "insights_scan", "data": scan }));
    }

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
        if req
            .inputs
            .get("product_id")
            .or_else(|| req.inputs.get("productId"))
            .is_some()
        {
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

    if allowed_tools.iter().any(|t| t == "erp_search") && step_no < max_steps && !query.is_empty() {
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

    let mut query_artifact: Option<SkillArtifact> = None;
    if allowed_tools.iter().any(|t| t == "analytics_summary") && step_no < max_steps {
        step_no += 1;
        let output = registry
            .run_and_record(
                &stdb,
                req.org_id,
                req.company_id,
                run_id,
                step_no,
                "analytics_summary",
                &tool_ctx,
                &json!({}),
            )
            .await?;
        steps.push(RunSkillStepSummary {
            step_no,
            tool: "analytics_summary".to_string(),
            duration_ms: 0,
            summary: output.summary.clone(),
        });
        tool_payloads.push(json!({ "tool": "analytics_summary", "data": output.data }));
        query_artifact = Some(SkillArtifact {
            kind: "table".to_string(),
            title: "Approved analytics summary".to_string(),
            content: output.data,
        });
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

    let (summary, tokens_used) =
        synthesize_summary(state, req.org_id, &agent, &skill, &query, &tool_payloads).await?;

    let artifact = SkillArtifact {
        kind: "markdown".to_string(),
        title: format!("{} summary", skill.name),
        content: Value::String(summary.clone()),
    };

    let mut artifacts = vec![artifact.clone()];
    if skill.skill_key == "insights_scan" {
        if let Some(payload) = tool_payloads
            .iter()
            .find(|p| p.get("tool").and_then(|v| v.as_str()) == Some("insights_scan"))
        {
            if let Some(data) = payload.get("data") {
                artifacts.push(SkillArtifact {
                    kind: "insights".to_string(),
                    title: "Insight scan preview".to_string(),
                    content: data.clone(),
                });
            }
        }
    }
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

    if run_id > 0 {
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
    }

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

fn resolve_allowed_tools(
    skill: &LoadedSkill,
    agent: &crate::ai_agent::ResolvedAgentConfig,
) -> Vec<String> {
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

fn reject_legacy_analytics_sql(inputs: &Value) -> Result<()> {
    for key in ["analysis_sql", "analysisSql", "sql"] {
        if inputs.get(key).is_some() {
            anyhow::bail!(
                "raw SQL input '{key}' is not supported; use an approved analytics skill"
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_legacy_sql_inputs() {
        assert!(reject_legacy_analytics_sql(&json!({"analysis_sql": "SELECT 1"})).is_err());
        assert!(reject_legacy_analytics_sql(&json!({"analysisSql": "SELECT 1"})).is_err());
        assert!(reject_legacy_analytics_sql(&json!({"sql": "SELECT 1"})).is_err());
        assert!(reject_legacy_analytics_sql(&json!({"query": "revenue"})).is_ok());
    }
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

fn string_list_from_input(inputs: &Value, key: &str) -> Option<Vec<String>> {
    inputs.get(key).and_then(|value| {
        if let Some(items) = value.as_array() {
            return Some(
                items
                    .iter()
                    .filter_map(|v| {
                        v.as_str()
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .map(str::to_string)
                    })
                    .collect(),
            );
        }
        value.as_str().map(|raw| {
            raw.split(|c| c == ',' || c == '\n')
                .map(str::trim)
                .filter(|part| !part.is_empty())
                .map(str::to_string)
                .collect()
        })
    })
}

fn string_matrix_from_input(inputs: &Value, key: &str) -> Option<Vec<Vec<String>>> {
    inputs.get(key).and_then(|value| {
        let rows = value.as_array()?;
        Some(
            rows.iter()
                .filter_map(|row| {
                    row.as_array().map(|cells| {
                        cells
                            .iter()
                            .map(|cell| match cell {
                                Value::String(s) => s.clone(),
                                other => other.to_string(),
                            })
                            .collect()
                    })
                })
                .collect(),
        )
    })
}

fn run_import_mapping_skill(inputs: &Value) -> Option<Value> {
    let target_entity = inputs
        .get("target_entity")
        .or_else(|| inputs.get("targetEntity"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?;

    let (headers, sample_rows) = if let Some(csv_text) = inputs
        .get("csv_text")
        .or_else(|| inputs.get("csvText"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        match crate::skills::parse_csv_text(csv_text) {
            Ok(parsed) => parsed,
            Err(message) => {
                return Some(json!({ "error": message }));
            }
        }
    } else {
        let headers = string_list_from_input(inputs, "header")
            .or_else(|| string_list_from_input(inputs, "headers"))?;
        let sample_rows = string_matrix_from_input(inputs, "sample_rows")
            .or_else(|| string_matrix_from_input(inputs, "sampleRows"))
            .unwrap_or_default();
        (headers, sample_rows)
    };

    if inputs.get("mapping").is_some() || inputs.get("mappingJson").is_some() {
        let mapping_value = inputs
            .get("mapping")
            .cloned()
            .or_else(|| inputs.get("mappingJson").cloned())?;
        let mapping = mapping_value.as_object()?.clone();
        let preview_rows_data = string_matrix_from_input(inputs, "sample_rows")
            .or_else(|| string_matrix_from_input(inputs, "sampleRows"))
            .unwrap_or(sample_rows);
        let preview = preview_import_mapping(ImportPreviewRequest {
            target_entity: target_entity.to_string(),
            headers: headers.clone(),
            rows: preview_rows_data,
            mapping: mapping.into_iter().collect(),
            max_rows: inputs
                .get("max_rows")
                .and_then(|v| v.as_u64())
                .map(|v| v as usize),
        })
        .ok()?;
        return Some(json!(preview));
    }

    let prior_mappings = inputs
        .get("prior_mappings")
        .or_else(|| inputs.get("priorMappings"))
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    let analyze = analyze_import_mapping(ImportAnalyzeRequest {
        target_entity: target_entity.to_string(),
        headers,
        sample_rows,
        prior_mappings: prior_mappings.into_iter().collect(),
        bundle_key: inputs
            .get("bundle_key")
            .or_else(|| inputs.get("bundleKey"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    })
    .ok()?;
    Some(json!(analyze))
}
