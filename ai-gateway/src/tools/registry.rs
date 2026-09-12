use std::time::Instant;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde_json::Value;

use crate::{
    ai_agent::ResolvedAgentConfig,
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

    async fn execute(&self, ctx: &ToolContext, input: &Value) -> Result<ToolOutput> {
        action_draft::execute(ctx, input).await
    }
}

pub struct ToolRegistry {
    tools: Vec<Box<dyn AgentTool>>,
}

/// The model-facing subset of a [`ToolRegistry`].
///
/// This view owns no tools; it only borrows entries selected by both the
/// skill allowlist and the resolved agent action policy. Model-selected names
/// must be resolved through this type rather than the legacy raw registry.
pub struct AuthorizedToolView<'a> {
    tools: Vec<&'a dyn AgentTool>,
}

impl<'a> AuthorizedToolView<'a> {
    fn resolve(&self, name: &str) -> Result<&'a dyn AgentTool> {
        self.tools
            .iter()
            .find(|tool| tool.name() == name)
            .copied()
            .ok_or_else(|| anyhow!("tool '{name}' is not authorized"))
    }

    /// Execute an allowlisted tool by its exact registry name.
    pub async fn run_named(
        &self,
        name: &str,
        ctx: &ToolContext,
        input: &Value,
    ) -> Result<ToolOutput> {
        reject_model_scope_override(input)?;
        let tool = self.resolve(name)?;
        tool.execute(ctx, input).await
    }

    pub fn tool_names(&self) -> impl Iterator<Item = &'static str> + '_ {
        self.tools.iter().map(|tool| tool.name())
    }
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

    /// Discover generated ERP tools from the verified, pinned catalog.
    ///
    /// This namespace never falls back to the local runtime tools. Nonempty
    /// catalogs remain unsupported until the contract supplies provider metadata.
    pub fn generated_specs(&self) -> Result<Vec<crate::providers::llm::ToolSpec>> {
        Ok(super::generated::embedded_catalog()?.specs()?)
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

    /// Build the only registry surface intended for model-selected calls.
    pub fn authorized_view<'a>(
        &'a self,
        agent: &ResolvedAgentConfig,
        allowed_tool_names: &[String],
    ) -> AuthorizedToolView<'a> {
        AuthorizedToolView {
            tools: self.filter_for_agent(agent, allowed_tool_names),
        }
    }

    /// Legacy unrestricted lookup for fixed internal callers.
    ///
    /// Model-selected calls must use [`AuthorizedToolView::run_named`].
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

fn reject_model_scope_override(input: &Value) -> Result<()> {
    fn visit(value: &Value) -> Option<&str> {
        match value {
            Value::Object(fields) => fields.iter().find_map(|(key, value)| {
                if matches!(
                    key.as_str(),
                    "org_id"
                        | "organization_id"
                        | "company_id"
                        | "orgId"
                        | "organizationId"
                        | "companyId"
                ) {
                    Some(key.as_str())
                } else {
                    visit(value)
                }
            }),
            Value::Array(values) => values.iter().find_map(visit),
            _ => None,
        }
    }

    if let Some(key) = visit(input) {
        anyhow::bail!("model input cannot set scope field '{key}'")
    }
    Ok(())
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

#[cfg(test)]
mod generated_registry_tests {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    use crate::{
        config::Config, providers, qdrant_client::VectorStore, rig_agent::RigContext,
        state::AppState,
    };
    use stdb_client::StdbClient;

    use super::*;

    #[test]
    fn empty_generated_catalog_does_not_fall_back_to_runtime_tools() {
        let registry = ToolRegistry::new();
        assert_eq!(registry.tool_names().len(), 7);
        assert!(registry
            .generated_specs()
            .expect("valid pinned catalog")
            .is_empty());
    }

    fn sample_agent() -> ResolvedAgentConfig {
        ResolvedAgentConfig {
            agent_id: 1,
            provider: "test".into(),
            model: "test".into(),
            system_prompt: String::new(),
            temperature: 0.0,
            max_tokens: 1,
            top_p: 1.0,
            allowed_actions: vec!["chat".into()],
            allowed_models: vec![],
            monthly_budget: None,
            monthly_spend: 0.0,
            cost_per_1k_tokens: 0.0,
            rate_limit_per_minute: 1,
        }
    }

    #[test]
    fn authorized_view_contains_only_allowlisted_action_permitted_tools() {
        let registry = ToolRegistry::new();
        let view = registry.authorized_view(
            &sample_agent(),
            &[
                "erp_snapshot".into(),
                "web_search".into(),
                "not_registered".into(),
            ],
        );
        let names: Vec<_> = view.tool_names().collect();
        assert_eq!(names, vec!["erp_snapshot"]);
    }

    struct CounterTool {
        calls: Arc<AtomicUsize>,
    }

    #[async_trait]
    impl AgentTool for CounterTool {
        fn name(&self) -> &'static str {
            "synthetic_counter"
        }

        fn required_action(&self) -> &'static str {
            "chat"
        }

        async fn execute(&self, ctx: &ToolContext, _input: &Value) -> Result<ToolOutput> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(ToolOutput {
                summary: format!("{}:{}", ctx.org_id, ctx.company_id),
                data: Value::Null,
                citations: vec![],
                row_count: None,
            })
        }
    }

    async fn test_context() -> ToolContext {
        let config = Config {
            port: 8080,
            internal_secret: None,
            qdrant_url: "http://127.0.0.1:6334".into(),
            qdrant_api_key: None,
            qdrant_collection: "test".into(),
            stdb_host: "http://127.0.0.1:3000".into(),
            stdb_module: "test".into(),
            stdb_token: "test-token".into(),
            ai_certification_stdb_token: None,
            ai_certification_runtime_hash: None,
            ai_certification_poll_secs: 60,
            ai_certification_batch_size: 1,
            ai_certification_timeout_secs: 1,
            worker_poll_secs: 60,
            worker_batch_size: 1,
            kaggle_username: None,
            kaggle_api_key: None,
            dataset_cache_dir: "/tmp".into(),
            kaggle_cache_ttl_secs: 60,
            embedding_provider: "ollama".into(),
            ollama_url: "http://127.0.0.1:11434".into(),
            ollama_embed_model: "test".into(),
            ollama_vision_model: "test".into(),
            ollama_llm_model: "test".into(),
            mistral_api_key: None,
            google_api_key: None,
            gemini_embed_model: "test".into(),
            kong_llm_url: None,
            kong_llm_service_token: None,
            kong_llm_readiness_url: None,
            vision_provider: "ollama".into(),
            document_parser: "plain".into(),
            unstructured_url: "http://127.0.0.1:8000".into(),
            unstructured_api_key: None,
            activity_refs_collection: "test".into(),
            activity_ingest_interval_secs: 60,
            max_upload_bytes: 1024,
            web_search_provider: "disabled".into(),
            web_search_api_key: None,
            web_fetch_max_bytes: 1024,
            api_server_url: None,
        };
        let http = reqwest::Client::new();
        let providers = providers::build(&config, http.clone()).expect("test providers");
        let vector_store = Arc::new(
            VectorStore::new(
                &config.qdrant_url,
                config.qdrant_api_key.as_deref(),
                config.activity_refs_collection.clone(),
            )
            .await
            .expect("test vector store"),
        );
        let rig = Arc::new(
            RigContext::new(&config, providers.clone())
                .await
                .expect("test rig context"),
        );
        let stdb = Arc::new(StdbClient::new(
            config.stdb_host.clone(),
            config.stdb_module.clone(),
            config.stdb_token.clone(),
        ));
        ToolContext {
            state: AppState {
                config: Arc::new(config),
                providers,
                vector_store,
                rig,
                stdb: stdb.clone(),
                http: Arc::new(http),
                activity_watermarks: Arc::new(dashmap::DashMap::new()),
                download_jobs: Arc::new(dashmap::DashMap::new()),
                kaggle_search_cache: Arc::new(dashmap::DashMap::new()),
                agent_rate_limiter: Arc::new(crate::rate_limit::AgentRateLimiter::new()),
            },
            stdb,
            org_id: 12,
            company_id: 34,
            run_id: 1,
            skill_key: "test".into(),
            config_json: Value::Null,
            inputs: Value::Null,
            allowed_action_drafts: vec![],
            actor: None,
        }
    }

    #[tokio::test]
    async fn authorized_view_executes_only_allowed_counter_calls() {
        let calls = Arc::new(AtomicUsize::new(0));
        let counter = CounterTool {
            calls: calls.clone(),
        };
        let view = AuthorizedToolView {
            tools: vec![&counter],
        };
        let ctx = test_context().await;

        let output = view
            .run_named("synthetic_counter", &ctx, &serde_json::json!({}))
            .await
            .expect("allowlisted counter executes");
        assert_eq!(output.summary, "12:34");
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        let unknown = match view
            .run_named("not_allowlisted", &ctx, &serde_json::json!({}))
            .await
        {
            Ok(_) => panic!("unknown name unexpectedly executed"),
            Err(error) => error,
        };
        assert!(unknown.to_string().contains("not authorized"));
        let scope = match view
            .run_named(
                "synthetic_counter",
                &ctx,
                &serde_json::json!({"nested": {"companyId": 99}}),
            )
            .await
        {
            Ok(_) => panic!("scope override unexpectedly executed"),
            Err(error) => error,
        };
        assert!(scope.to_string().contains("cannot set scope"));
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        let denied_agent = ResolvedAgentConfig {
            allowed_actions: vec![],
            ..sample_agent()
        };
        let denied_registry = ToolRegistry {
            tools: vec![Box::new(CounterTool {
                calls: calls.clone(),
            })],
        };
        let denied_view =
            denied_registry.authorized_view(&denied_agent, &["synthetic_counter".into()]);
        let denied = match denied_view
            .run_named("synthetic_counter", &ctx, &serde_json::json!({}))
            .await
        {
            Ok(_) => panic!("action-filtered tool unexpectedly executed"),
            Err(error) => error,
        };
        assert!(denied.to_string().contains("not authorized"));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
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
