use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use stdb_client::ReducerCall;
use uuid::Uuid;

use crate::{
    ai_agent::{
        enforce_chargeable_limits, ensure_allowed_action, ensure_model_allowed,
        ensure_within_budget, record_ai_spend, resolve_agent,
    },
    harness::{
        data_scope_resolver::ResourceRegistry,
        policy_engine::{
            ExecutionMetadata, ExecutionPlan, PlannedToolCall, PolicyEngine, PolicyExecutionRequest,
        },
        release_registry::load_active_manifest,
        skill_registry::SkillRegistry,
        ActorCredentials,
    },
    orchestrator::skill_loader::{
        complete_run, create_run, load_skill, set_run_wait_state, LoadedSkill,
    },
    providers::llm::{LlmMessage, LlmRequest},
    state::AppState,
    tools::{
        generated_read::{resolve_actor_grants, GeneratedReadTools},
        registry::ToolRegistry,
        types::{SkillCitation, ToolContext},
    },
};
use super::{
    agent_loop::{LoopLimits, LoopStop},
    agent_loop_adapters::{
        run_finalization, run_recorded_loop, AuthorizedLoopTools, RunFinalization,
    },
    decision_type::{register_builtin_decision_types, StdbDecisionTypeRegistry},
    graduation::{
        DeterministicCandidateRegistry, GovernedDecisionResolver,
        StdbAuthorityRollbackRecorder, StdbDecisionResolutionPolicy, StdbDriftMonitor,
        StdbModelShadowRecorder,
    },
    governed_program::{
        graph_requests_generated_capabilities, BuiltinComputeService, GovernedProgramContext,
        GovernedProgramExecutor, GovernedProgramStop, StdbIntelligenceEventRecorder,
    },
    governed_programs::governed_program_for_skill,
    governed_services::{
        DeterministicFinalAnswerAdmission, GovernedCapabilityService,
        PolicyBackedCapabilityAdmission, ShapeOnlyVerificationService, StdbApprovalCoordinator,
        StdbExecutionRecovery, ToolsBackedCapabilityExecutor,
    },
    intelligence::EvidenceRef,
    intelligence_router::{
        ConfiguredIntelligenceRouter, NoopShadowDecisionRecorder, RoutedDecisionProvider,
        RoutedGenerationProvider, RoutedReasoningProvider, StdbShadowDecisionRecorder,
    },
    invocation_policy::ReviewedInvocationPolicy,
    model_configuration::{IntelligenceRole, IntelligenceRouteResolver, StdbModelConfigurationStore},
    precedent::StdbPrecedentStore,
    probabilistic::StdbCalibrationProfileStore,
    run_review::{RunReviewDisposition, RunReviewProgram, RunReviewRecorder, StdbRunReviewRecorder},
    spend_admission::{spend_binding_from_agent, StdbSpendLedger},
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

    run_skill_unlocked(state, req).await
}

/// Execute a bundled skill after a harness adapter has already enforced release
/// and policy. Callers must not expose this on `/v1/skills/run`.
pub async fn run_skill_unlocked(
    state: &AppState,
    req: RunSkillRequest,
) -> Result<RunSkillResponse> {
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

    let actor = req
        .stdb_token
        .as_ref()
        .zip(req.triggered_by_hex.as_ref())
        .and_then(|(token, identity)| ActorCredentials::new(token.clone(), identity.clone()).ok());
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
        actor,
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

/// Request for a spend-admitted governed skill run.
///
/// The caller supplies pre-reviewed tool calls and the LLM request that drives
/// the loop. H5c will insert a durable accepted-intent row before each provider
/// dispatch; this entry point wires together the H5b spend layer, the H4 policy
/// engine, and the H3 invocation seam.
#[derive(Debug)]
pub struct AdmittedRunRequest {
    pub org_id: u64,
    pub company_id: u64,
    pub skill_key: String,
    pub skill_version: u32,
    pub inputs: Value,
    pub agent_id: Option<u64>,
    pub team_member_id: Option<u64>,
    pub triggered_by_hex: Option<String>,
    pub stdb_token: Option<String>,
    pub correlation_id: String,
    pub reviewed_calls: Vec<PlannedToolCall>,
    pub llm_request: LlmRequest,
    pub max_steps: Option<u32>,
}

/// Execute a skill run through the full H5b admission stack.
///
/// Requires `AppState::spend_read_stdb` to be present; returns an error when
/// the state was started without spend-read support.
pub async fn run_skill_admitted(
    state: &AppState,
    req: AdmittedRunRequest,
) -> Result<RunSkillResponse> {
    if req.org_id == 0 {
        anyhow::bail!("org_id is required");
    }
    if req.company_id == 0 {
        anyhow::bail!("company_id is required");
    }
    let skill_key = req.skill_key.trim().to_string();
    if skill_key.is_empty() {
        anyhow::bail!("skill_key is required");
    }
    let correlation_id = req.correlation_id.trim().to_string();
    if correlation_id.is_empty() {
        anyhow::bail!("correlation_id is required");
    }
    let governed_catalog = governed_program_for_skill(&skill_key);
    let reviewed_calls = if req.reviewed_calls.is_empty() {
        governed_catalog
            .as_ref()
            .map(|entry| entry.reviewed_calls.clone())
            .context("reviewed_calls must be nonempty for non-governed admitted runs")?
    } else {
        req.reviewed_calls.clone()
    };

    // H5b: a paired read ledger is required for spend admission.
    let spend_reader = state
        .spend_read_stdb
        .as_deref()
        .context("spend_read_stdb is required for admitted runs (H5b)")?;

    let actor = req
        .stdb_token
        .as_ref()
        .zip(req.triggered_by_hex.as_ref())
        .and_then(|(token, identity)| ActorCredentials::new(token.clone(), identity.clone()).ok());
    let stdb = req
        .stdb_token
        .as_ref()
        .filter(|t| !t.trim().is_empty())
        .map(|token| state.stdb.with_token(token.clone()))
        .unwrap_or_else(|| state.stdb.as_ref().clone());

    let skill = load_skill(&stdb, req.org_id, req.company_id, &skill_key).await?;
    if !skill.enabled {
        anyhow::bail!("skill '{skill_key}' is disabled for this company");
    }

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

    let manifest = load_active_manifest(&stdb, req.org_id, &skill_key, req.skill_version)
        .await
        .map_err(|message| anyhow::anyhow!(message))?;

    let ledger = StdbSpendLedger {
        writer: &state.stdb,
        reader: spend_reader,
    };
    let binding = spend_binding_from_agent(&agent, req.org_id, req.company_id, run_id)?;

    let registry = ToolRegistry::new();
    let view = registry.authorized_view(&agent, &manifest.allowed_tools);

    let max_steps = req
        .max_steps
        .unwrap_or(manifest.limits.max_steps)
        .min(manifest.limits.max_steps);
    let plan = ExecutionPlan {
        named_resources: manifest.named_resources.clone(),
        tool_calls: reviewed_calls.clone(),
        steps: max_steps,
        expected_rows: 0,
        output_type: manifest.output_type.clone(),
    };
    let base = PolicyExecutionRequest {
        skill: manifest.skill.clone(),
        organization_id: req.org_id,
        company_id: req.company_id,
        correlation_id,
        metadata: ExecutionMetadata::default(),
        input: req.inputs.clone(),
        plan,
    };
    let engine = PolicyEngine::new(SkillRegistry::exact(manifest.clone()), ResourceRegistry::built_in());
    let policy = ReviewedInvocationPolicy::new(engine, base, reviewed_calls)?;

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
        actor,
    };

    if let Some(catalog) = governed_catalog {
        let model_config_store = StdbModelConfigurationStore {
            reader: tool_ctx.stdb.as_ref(),
        };
        let intelligence_policy_ref = skill
            .config_json
            .get("intelligencePolicyRef")
            .or_else(|| skill.config_json.get("intelligence_policy_ref"))
            .and_then(Value::as_str);
        let route_resolver = IntelligenceRouteResolver::new_governed(
            &model_config_store,
            req.org_id,
            &agent,
            intelligence_policy_ref,
        )?;
        route_resolver
            .validate_review_independence(catalog.review_independence_key)
            .await?;
        let intelligence_router = ConfiguredIntelligenceRouter::new(route_resolver);
        let shadow_recorder = StdbShadowDecisionRecorder {
            writer: state.stdb.as_ref(),
        };
        let decision_provider = RoutedDecisionProvider::new(
            &intelligence_router,
            state.providers.llm.as_ref(),
            &ledger,
            &agent,
            req.org_id,
            req.company_id,
            run_id,
            IntelligenceRole::Decision,
            &shadow_recorder,
        )?;
        let review_provider = RoutedDecisionProvider::new(
            &intelligence_router,
            state.providers.llm.as_ref(),
            &ledger,
            &agent,
            req.org_id,
            req.company_id,
            run_id,
            IntelligenceRole::Review,
            &NoopShadowDecisionRecorder,
        )?;
        let generation_provider = RoutedGenerationProvider::new(
            &intelligence_router,
            state.providers.llm.as_ref(),
            &ledger,
            &agent,
            req.org_id,
            req.company_id,
            run_id,
        );
        let reasoning_provider = RoutedReasoningProvider::new(
            &intelligence_router,
            state.providers.llm.as_ref(),
            &ledger,
            &agent,
            req.org_id,
            req.company_id,
            run_id,
        );

        let decision_types = StdbDecisionTypeRegistry {
            writer: state.stdb.as_ref(),
            reader: tool_ctx.stdb.as_ref(),
            organization_id: req.org_id,
        };
        register_builtin_decision_types(&decision_types).await?;

        let precedent = StdbPrecedentStore {
            writer: state.stdb.as_ref(),
            reader: tool_ctx.stdb.as_ref(),
        };
        let recorder = StdbIntelligenceEventRecorder {
            writer: state.stdb.as_ref(),
            reader: tool_ctx.stdb.as_ref(),
        };

        let graph = catalog.graph;
        let generated_grants = if graph_requests_generated_capabilities(&graph)? {
            resolve_actor_grants(&tool_ctx).await?
        } else {
            Vec::new()
        };
        let loop_tools = AuthorizedLoopTools {
            view: &view,
            generated: GeneratedReadTools::new(&generated_grants),
            context: &tool_ctx,
        };
        let capability_admission = PolicyBackedCapabilityAdmission::new(&policy);
        let capability_executor = ToolsBackedCapabilityExecutor::new(&loop_tools);
        let recovery = StdbExecutionRecovery {
            writer: state.stdb.as_ref(),
            reader: spend_reader,
            organization_id: req.org_id,
            company_id: req.company_id,
        };
        let approvals = StdbApprovalCoordinator {
            writer: state.stdb.as_ref(),
            reader: spend_reader,
            organization_id: req.org_id,
            company_id: req.company_id,
        };
        let capabilities = GovernedCapabilityService::new(
            &capability_admission,
            &capability_executor,
            &recovery,
            &approvals,
        );
        let verification = ShapeOnlyVerificationService;
        let answer_admission = DeterministicFinalAnswerAdmission;
        let compute = BuiltinComputeService;
        if skill_key == "report_analysis" {
            state
                .stdb
                .call_reducer(ReducerCall::from_name(
                    "register_ai_calibration_profile",
                    json!([
                        req.org_id,
                        {
                            "profile_name": "report-attention",
                            "profile_version": 1,
                            "description": "Initial reviewed calibration profile for ReportAttentionNeed@1; versioned explicitly so routing never gates on unlabelled raw confidence.",
                            "breakpoints_json": "[[0.0,0.0],[0.35,0.35],[0.65,0.65],[1.0,1.0]]"
                        }
                    ]),
                ))
                .await
                .context("register report attention calibration profile")?;
        }
        let calibration = StdbCalibrationProfileStore {
            reader: tool_ctx.stdb.as_ref(),
        };
        let deterministic_candidates = DeterministicCandidateRegistry::default();
        let decision_resolution_policy = StdbDecisionResolutionPolicy {
            reader: tool_ctx.stdb.as_ref(),
        };
        let model_shadow_recorder = StdbModelShadowRecorder {
            writer: state.stdb.as_ref(),
        };
        let drift_monitor = StdbDriftMonitor {
            reader: tool_ctx.stdb.as_ref(),
        };
        let rollback_recorder = StdbAuthorityRollbackRecorder {
            writer: state.stdb.as_ref(),
        };
        let decision_resolver = GovernedDecisionResolver {
            policy: &decision_resolution_policy,
            candidates: &deterministic_candidates,
            model: &decision_provider,
            model_shadow_recorder: &model_shadow_recorder,
            drift_monitor: Some(&drift_monitor),
            rollback_recorder: Some(&rollback_recorder),
        };
        let executor = GovernedProgramExecutor {
            decision_provider: &decision_provider,
            decision_resolver: Some(&decision_resolver),
            generation_provider: &generation_provider,
            reasoning_provider: &reasoning_provider,
            decision_types: &decision_types,
            precedent: &precedent,
            capabilities: &capabilities,
            verification: &verification,
            answer_admission: &answer_admission,
            compute: &compute,
            recorder: &recorder,
            calibration: &calibration,
        };
        let mut governed_inputs = req.inputs.clone();
        if let Some(object) = governed_inputs.as_object_mut() {
            if object
                .get("query")
                .and_then(Value::as_str)
                .is_none_or(|value| value.trim().is_empty())
            {
                if let Some(query) = build_web_search_query(&skill_key, &req.inputs, "") {
                    object.insert("query".to_string(), Value::String(query));
                }
            }
        }
        let program_context = GovernedProgramContext {
            organization_id: req.org_id,
            company_id: req.company_id,
            run_id,
            program_ref: catalog.program_ref.to_string(),
            objective: skill.prompt_template.clone(),
            bounded_state: governed_inputs,
            evidence: vec![EvidenceRef {
                kind: "governed_run_step".to_string(),
                id: format!("run:{run_id}:analytics"),
            }],
        };
        let program = executor.run(&graph, &program_context).await?;

        let review = if matches!(&program.stop, GovernedProgramStop::Completed) {
            let result = RunReviewProgram::new(&review_provider)
                .review(&program_context.objective, &program)
                .await?;
            StdbRunReviewRecorder {
                writer: state.stdb.as_ref(),
            }
            .record(
                req.org_id,
                req.company_id,
                run_id,
                catalog.program_ref,
                &result,
            )
            .await?;
            Some(result)
        } else {
            None
        };

        if let Some(review) = &review {
            if review.disposition != RunReviewDisposition::Healthy {
                set_run_wait_state(
                    state.stdb.as_ref(),
                    req.org_id,
                    req.company_id,
                    run_id,
                    "agent_settled",
                )
                .await?;
                let rationale = review
                    .rationale
                    .clone()
                    .unwrap_or_else(|| format!("independent review: {:?}", review.disposition));
                return Ok(RunSkillResponse {
                    run_id,
                    run_key,
                    status: "agent_settled".to_string(),
                    summary: rationale,
                    artifacts: Vec::new(),
                    citations: Vec::new(),
                    steps: program
                        .trace
                        .into_iter()
                        .enumerate()
                        .map(|(index, step)| RunSkillStepSummary {
                            step_no: (index + 1) as u32,
                            tool: step.kind.to_string(),
                            duration_ms: 0,
                            summary: step.summary,
                        })
                        .collect(),
                    agent_id: agent.agent_id,
                    skill_key: skill.skill_key,
                });
            }
        }

        let (status, summary, terminal_error) = match &program.stop {
            GovernedProgramStop::Completed => (
                "completed".to_string(),
                program
                    .final_content
                    .clone()
                    .unwrap_or_else(|| format!("governed {} completed", skill_key)),
                None,
            ),
            GovernedProgramStop::EarlyStop(reason) => (
                "completed".to_string(),
                format!("governed program stopped deterministically: {reason:?}"),
                None,
            ),
            GovernedProgramStop::PendingApproval {
                capability,
                reason,
                draft_id,
            } => {
                set_run_wait_state(
                    state.stdb.as_ref(),
                    req.org_id,
                    req.company_id,
                    run_id,
                    "awaiting_approval",
                )
                .await?;
                let summary = match draft_id {
                    Some(id) => format!("{capability} awaits approval (draft #{id}): {reason}"),
                    None => format!("{capability} awaits approval: {reason}"),
                };
                ("awaiting_approval".to_string(), summary, None)
            }
            GovernedProgramStop::Clarification { prompt, .. } => {
                set_run_wait_state(
                    state.stdb.as_ref(),
                    req.org_id,
                    req.company_id,
                    run_id,
                    "agent_settled",
                )
                .await?;
                ("agent_settled".to_string(), prompt.clone(), None)
            }
            GovernedProgramStop::ReviewRequired(reason) => {
                set_run_wait_state(
                    state.stdb.as_ref(),
                    req.org_id,
                    req.company_id,
                    run_id,
                    "agent_settled",
                )
                .await?;
                ("agent_settled".to_string(), reason.clone(), None)
            }
            GovernedProgramStop::Denied(reason)
            | GovernedProgramStop::UnableToProgress(reason) => (
                "failed".to_string(),
                reason.clone(),
                Some(reason.clone()),
            ),
        };

        if matches!(status.as_str(), "completed" | "failed") {
            complete_run(
                state.stdb.as_ref(),
                req.org_id,
                req.company_id,
                run_id,
                &status,
                Some(summary.clone()),
                None,
                None,
                program.trace.len() as u32,
                0,
                terminal_error,
            )
            .await?;
        }

        return Ok(RunSkillResponse {
            run_id,
            run_key,
            status,
            summary,
            artifacts: Vec::new(),
            citations: Vec::new(),
            steps: program
                .trace
                .into_iter()
                .enumerate()
                .map(|(index, step)| RunSkillStepSummary {
                    step_no: (index + 1) as u32,
                    tool: step.kind.to_string(),
                    duration_ms: 0,
                    summary: step.summary,
                })
                .collect(),
            agent_id: agent.agent_id,
            skill_key: skill.skill_key,
        });
    }

    let limits = LoopLimits {
        max_rounds: max_steps.max(1),
        max_tool_calls: manifest.limits.max_tool_calls.max(1),
        max_tokens: u64::from(agent.context_window),
        max_unchanged_results: 3,
    };

    let outcome = run_recorded_loop(
        state.providers.llm.as_ref(),
        &ledger,
        binding,
        &view,
        &policy,
        &tool_ctx,
        req.llm_request,
        limits,
    )
    .await?;

    let summary = match &outcome.stop {
        LoopStop::CandidateFinal(answer) => answer.clone(),
        stop => format!("agent loop stopped: {stop:?}"),
    };
    let status = match run_finalization(&outcome.stop) {
        RunFinalization::Wait { status, .. } => status.to_string(),
        RunFinalization::Failed { error_code } => error_code.to_string(),
    };

    Ok(RunSkillResponse {
        run_id,
        run_key,
        status,
        summary,
        artifacts: Vec::new(),
        citations: Vec::new(),
        steps: Vec::new(),
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
            messages: vec![LlmMessage::text("user", user)],
            max_tokens: agent.max_tokens.min(2048),
            temperature: Some(agent.temperature),
            top_p: Some(agent.top_p),
            tools: Vec::new(),
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
