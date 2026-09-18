use std::time::Instant;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde_json::Value;

use crate::{
    ai_agent::ResolvedAgentConfig,
    providers::llm::ToolSpec,
    tools::{
        action_draft, analytics, erp_search, erp_snapshot, save_artifact,
        types::{hash_tool_input, ToolContext, ToolOutput},
        web_search,
    },
};

#[async_trait]
pub trait AgentTool: Send + Sync {
    fn name(&self) -> &'static str;
    fn required_action(&self) -> &'static str;
    /// JSON Schema object describing the tool's input parameters.
    fn schema(&self) -> Value;
    async fn execute(&self, ctx: &ToolContext, input: &Value) -> Result<ToolOutput>;
}

struct ErpSnapshotTool;
struct ErpSearchTool;
struct SaveArtifactTool;
struct AnalyticsSummaryTool;
struct WebSearchTool;
struct FetchUrlTool;
struct ActionDraftTool;

#[async_trait]
impl AgentTool for ErpSnapshotTool {
    fn name(&self) -> &'static str {
        "erp_snapshot"
    }

    fn required_action(&self) -> &'static str {
        "live_read"
    }

    fn schema(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "entity_type": {
                    "type": "string",
                    "description": "ERP entity type to snapshot (e.g. 'product', 'order', 'customer')"
                },
                "entity_id": {
                    "type": "string",
                    "description": "ID of the entity to snapshot"
                },
                "max_snapshots": {
                    "type": "integer",
                    "description": "Maximum number of historical snapshots to return (optional)"
                }
            },
            "required": ["entity_type", "entity_id"]
        })
    }

    async fn execute(&self, ctx: &ToolContext, input: &Value) -> Result<ToolOutput> {
        erp_snapshot::execute(ctx, input).await
    }
}

#[async_trait]
impl AgentTool for ErpSearchTool {
    fn name(&self) -> &'static str {
        "erp_search"
    }

    fn required_action(&self) -> &'static str {
        "live_read"
    }

    fn schema(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Semantic search query against the ERP knowledge base"
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of results to return (1–20, default 8)"
                },
                "score_threshold": {
                    "type": "number",
                    "description": "Minimum similarity score threshold (default 0.65)"
                }
            },
            "required": ["query"]
        })
    }

    async fn execute(&self, ctx: &ToolContext, input: &Value) -> Result<ToolOutput> {
        erp_search::execute(ctx, input).await
    }
}

#[async_trait]
impl AgentTool for SaveArtifactTool {
    fn name(&self) -> &'static str {
        "save_artifact"
    }

    fn required_action(&self) -> &'static str {
        "skill_run"
    }

    fn schema(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "Artifact title (default: 'Skill artifact')"
                },
                "kind": {
                    "type": "string",
                    "description": "Artifact format, e.g. 'markdown', 'json' (default: 'markdown')"
                },
                "content": {
                    "description": "Artifact content (string or structured value)"
                }
            },
            "required": ["content"]
        })
    }

    async fn execute(&self, ctx: &ToolContext, input: &Value) -> Result<ToolOutput> {
        save_artifact::execute(ctx, input).await
    }
}

#[async_trait]
impl AgentTool for AnalyticsSummaryTool {
    fn name(&self) -> &'static str {
        "analytics_summary"
    }

    fn required_action(&self) -> &'static str {
        "analytics_read"
    }

    fn schema(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {},
            "required": []
        })
    }

    async fn execute(&self, ctx: &ToolContext, input: &Value) -> Result<ToolOutput> {
        analytics::execute(ctx, input).await
    }
}

#[async_trait]
impl AgentTool for WebSearchTool {
    fn name(&self) -> &'static str {
        "web_search"
    }

    fn required_action(&self) -> &'static str {
        "web_search"
    }

    fn schema(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Web search query"
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of results (optional, default from config)"
                }
            },
            "required": ["query"]
        })
    }

    async fn execute(&self, ctx: &ToolContext, input: &Value) -> Result<ToolOutput> {
        web_search::execute_search(ctx, input).await
    }
}

#[async_trait]
impl AgentTool for FetchUrlTool {
    fn name(&self) -> &'static str {
        "fetch_url"
    }

    fn required_action(&self) -> &'static str {
        "web_search"
    }

    fn schema(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "URL to fetch content from"
                },
                "max_bytes": {
                    "type": "integer",
                    "description": "Maximum bytes to retrieve (optional, default from config)"
                }
            },
            "required": ["url"]
        })
    }

    async fn execute(&self, ctx: &ToolContext, input: &Value) -> Result<ToolOutput> {
        web_search::execute_fetch(ctx, input).await
    }
}

#[async_trait]
impl AgentTool for ActionDraftTool {
    fn name(&self) -> &'static str {
        "action_draft"
    }

    fn required_action(&self) -> &'static str {
        "action_draft"
    }

    fn schema(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "reducer_name": {
                    "type": "string",
                    "description": "Name of the ERP reducer to call"
                },
                "params_json": {
                    "type": "string",
                    "description": "JSON-encoded parameters for the reducer"
                },
                "summary": {
                    "type": "string",
                    "description": "Human-readable description of the proposed action"
                },
                "confidence": {
                    "type": "number",
                    "description": "Confidence score 0–1 (default 0.75)"
                },
                "elevated": {
                    "type": "boolean",
                    "description": "Whether this action requires elevated approval (default false)"
                },
                "warnings": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Optional list of caution messages"
                }
            },
            "required": ["reducer_name", "params_json"]
        })
    }

    async fn execute(&self, ctx: &ToolContext, input: &Value) -> Result<ToolOutput> {
        action_draft::execute(ctx, input).await
    }
}

pub struct ToolRegistry {
    tools: Vec<Box<dyn AgentTool>>,
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: vec![
                Box::new(ErpSnapshotTool),
                Box::new(ErpSearchTool),
                Box::new(AnalyticsSummaryTool),
                Box::new(WebSearchTool),
                Box::new(FetchUrlTool),
                Box::new(ActionDraftTool),
                Box::new(SaveArtifactTool),
            ],
        }
    }

    pub fn tool_names(&self) -> Vec<&'static str> {
        self.tools.iter().map(|t| t.name()).collect()
    }

    /// Iterate over all registered tools.
    pub fn tools(&self) -> impl Iterator<Item = &dyn AgentTool> {
        self.tools.iter().map(|t| t.as_ref())
    }

    /// Return `ToolSpec`s for all tools whose `required_action` is permitted by
    /// `agent` and whose name is in `allowed_tool_names`.  Used by `agent_loop`
    /// to build the `LlmRequest.tools` list.
    pub fn specs_for(
        &self,
        agent: &ResolvedAgentConfig,
        allowed_tool_names: &[String],
    ) -> Vec<ToolSpec> {
        self.tools
            .iter()
            .filter(|tool| {
                allowed_tool_names.iter().any(|n| n == tool.name())
                    && agent_allows_action(agent, tool.required_action())
            })
            .map(|tool| ToolSpec {
                name: tool.name().to_string(),
                description: format!(
                    "Tool: {} (requires action: {})",
                    tool.name(),
                    tool.required_action()
                ),
                parameters: tool.schema(),
            })
            .collect()
    }

    pub fn filter_for_agent<'a>(
        &'a self,
        agent: &ResolvedAgentConfig,
        allowed_tool_names: &[String],
    ) -> Vec<&'a dyn AgentTool> {
        self.tools
            .iter()
            .filter(|tool| {
                allowed_tool_names.iter().any(|name| name == tool.name())
                    && agent_allows_action(agent, tool.required_action())
            })
            .map(|tool| tool.as_ref())
            .collect()
    }

    pub async fn run_named(
        &self,
        name: &str,
        ctx: &ToolContext,
        input: &Value,
    ) -> Result<ToolOutput> {
        let tool = self
            .tools
            .iter()
            .find(|t| t.name() == name)
            .ok_or_else(|| anyhow!("unknown tool '{name}'"))?;
        tool.execute(ctx, input).await
    }

    pub async fn run_and_record(
        &self,
        stdb: &stdb_client::StdbClient,
        org_id: u64,
        company_id: u64,
        run_id: u64,
        step_no: u32,
        name: &str,
        ctx: &ToolContext,
        input: &Value,
    ) -> Result<ToolOutput> {
        let started = Instant::now();
        let input_hash = hash_tool_input(input);
        match self.run_named(name, ctx, input).await {
            Ok(output) => {
                let duration_ms = started.elapsed().as_millis() as u64;
                let citations_json = serde_json::to_string(&output.citations).ok();
                persist_step(
                    stdb,
                    org_id,
                    company_id,
                    run_id,
                    step_no,
                    name,
                    &input_hash,
                    &output.summary,
                    output.row_count,
                    citations_json.as_deref(),
                    duration_ms,
                    None,
                )
                .await?;
                Ok(output)
            }
            Err(err) => {
                let duration_ms = started.elapsed().as_millis() as u64;
                let message = err.to_string();
                persist_step(
                    stdb,
                    org_id,
                    company_id,
                    run_id,
                    step_no,
                    name,
                    &input_hash,
                    &message,
                    None,
                    None,
                    duration_ms,
                    Some(&message),
                )
                .await?;
                Err(err)
            }
        }
    }
}

pub fn agent_allows_action(agent: &ResolvedAgentConfig, action: &str) -> bool {
    if agent.allowed_actions.iter().any(|a| a == action) {
        return true;
    }
    match action {
        "live_read" => agent
            .allowed_actions
            .iter()
            .any(|a| a == "chat" || a == "live_read"),
        "skill_run" => agent
            .allowed_actions
            .iter()
            .any(|a| a == "skill_run" || a == "chat"),
        "analytics_read" => agent
            .allowed_actions
            .iter()
            .any(|a| a == "analytics_read" || a == "analytics_run" || a == "skill_run"),
        "analytics_run" => agent
            .allowed_actions
            .iter()
            .any(|a| a == "analytics_run" || a == "skill_run"),
        "web_search" => agent
            .allowed_actions
            .iter()
            .any(|a| a == "web_search" || a == "skill_run"),
        "action_draft" => agent
            .allowed_actions
            .iter()
            .any(|a| a == "action_draft" || a == "skill_run"),
        _ => false,
    }
}

async fn persist_step(
    stdb: &stdb_client::StdbClient,
    org_id: u64,
    company_id: u64,
    run_id: u64,
    step_no: u32,
    tool_name: &str,
    input_hash: &str,
    output_summary: &str,
    output_row_count: Option<u32>,
    citations_json: Option<&str>,
    duration_ms: u64,
    error_message: Option<&str>,
) -> Result<()> {
    stdb.call_reducer(stdb_client::reducer_call!(
        "append_ai_agent_run_step",
        serde_json::json!([
            org_id,
            company_id,
            run_id,
            {
                "step_no": step_no,
                "tool_name": tool_name,
                "input_hash": input_hash,
                "output_summary": output_summary.chars().take(8000).collect::<String>(),
                "output_row_count": output_row_count,
                "citations_json": citations_json,
                "duration_ms": duration_ms,
                "error_message": error_message,
            }
        ]),
    ))
    .await?;
    Ok(())
}
