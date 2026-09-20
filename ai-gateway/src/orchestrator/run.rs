use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use uuid::Uuid;

use super::{
    agent_loop_adapters::AuthorizedLoopTools,
    answer_gate::{
        DecisionClaimCoverageChecker, EvidenceBackedVerificationService,
        EvidenceGatedAnswerAdmission, GatePolicy, GateScope, StdbPassageCatalog,
    },
    decision_graph::{DecisionGraph, DecisionNode, GateCondition},
    decision_type::{DecisionTypeRegistry, StdbDecisionTypeRegistry},
    evidence_inspector::Viewer,
    evidence_recorder::{
        AnswerEvidenceRecorder, RecordingAnswerAdmission, RunEvidenceScope, StdbEvidenceRecorder,
    },
    governed_program::{
        graph_requests_generated_capabilities, BuiltinComputeService, GovernedProgramContext,
        GovernedProgramExecutor, GovernedProgramStop, StdbIntelligenceEventRecorder,
        StdbProgramCheckpointStore,
    },
    governed_programs::governed_program_for_skill,
    governed_services::{
        GovernedCapabilityService, PolicyBackedCapabilityAdmission, StdbApprovalCoordinator,
        StdbExecutionRecovery, ToolsBackedCapabilityExecutor,
    },
    graduation::{
        production_deterministic_candidates, GovernedDecisionResolver,
        StdbAuthorityRollbackRecorder, StdbDecisionResolutionPolicy, StdbDriftMonitor,
        StdbModelShadowRecorder,
    },
    intelligence::{EvidenceRef, GenerationRequest},
    intelligence_router::{
        generate_routed_for_run, ConfiguredIntelligenceRouter, NoopShadowDecisionRecorder,
        RoutedDecisionProvider, RoutedGenerationProvider, RoutedReasoningProvider,
        StdbShadowDecisionRecorder,
    },
    invocation_policy::ReviewedInvocationPolicy,
    knowledge_context::{compile_knowledge_context, knowledge_entry_keys, merge_into_inputs},
    model_configuration::{
        IntelligenceRole, IntelligenceRouteResolver, StdbModelConfigurationStore,
    },
    output_gate::{
        admit_structured_output, persist_or_withhold_generated_output, GeneratedOutputDraft,
        PublicationIdentity,
    },
    precedent::StdbPrecedentStore,
    probabilistic::{CalibrationProfileStore, StdbCalibrationProfileStore},
    run_review::{
        RunReviewDisposition, RunReviewProgram, RunReviewRecorder, StdbRunReviewRecorder,
    },
    spend_admission::StdbSpendLedger,
    text_answer_gate::{TextAnswerProvenance, TextAnswerVerification, TextEvidence},
};
use crate::{
    ai_agent::{
        enforce_chargeable_limits, ensure_allowed_action, ensure_model_allowed,
        ensure_within_budget, resolve_agent,
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
        complete_run, create_run, load_run_key, load_skill, resume_run, set_run_wait_state,
        LoadedSkill,
    },
    state::AppState,
    tools::{
        generated_read::{resolve_actor_grants, GeneratedReadTools},
        registry::ToolRegistry,
        types::{SkillCitation, ToolContext},
    },
};

const DEFAULT_MAX_STEPS: u32 = 5;

/// `key:value` scope tags a skill requires cited passages to apply to
/// (`config_json.requiredApplicability`). Absent means no requirement. A
/// present-but-malformed value is an error: silently dropping a required
/// tag would make the gate more permissive than the skill's owner intended.
fn required_applicability(config: &Value) -> Result<Vec<String>> {
    let Some(raw) = config
        .get("requiredApplicability")
        .or_else(|| config.get("required_applicability"))
    else {
        return Ok(Vec::new());
    };
    let tags = raw
        .as_array()
        .context("requiredApplicability must be an array of 'key:value' strings")?;
    tags.iter()
        .map(|tag| {
            let tag = tag
                .as_str()
                .filter(|tag| {
                    tag.split_once(':')
                        .is_some_and(|(k, v)| !k.is_empty() && !v.is_empty())
                })
                .with_context(|| {
                    format!("requiredApplicability entry {tag} must be a 'key:value' string")
                })?;
            Ok(tag.to_string())
        })
        .collect()
}

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
    /// Ids of the `ai_evidence_claim` rows recorded for this run's answer
    /// (AIH-14), in order. Inspectable via `POST /v1/evidence/inspect`.
    /// Omitted when the run recorded none.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub evidence_claim_ids: Vec<u64>,
    /// The §7.3 verdict on a free-text candidate answer (direct-execution
    /// loop). When present, `summary` is the gated text or a withheld notice,
    /// never the raw candidate.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification: Option<TextAnswerVerification>,
    /// Claim-level support, calculations, and durable recording state for a
    /// direct-loop answer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provenance: Option<TextAnswerProvenance>,
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

    run_legacy_skill(state, req).await
}

/// Legacy bundled-skill runner. This is intentionally private so no harness
/// adapter can bypass the typed governed admission boundary.
async fn run_legacy_skill(
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
        .run_id
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

    let (candidate_summary, tokens_used) = synthesize_summary(
        state,
        req.org_id,
        req.company_id,
        run_id,
        &agent,
        &skill,
        &query,
        &tool_payloads,
    )
    .await?;

    // The classic loop is also a publication boundary. Tool payloads are
    // server-produced; bind the generated prose explicitly to those exact
    // results, then persist the gate's claim assessments before exposing the
    // summary or its markdown artifact.
    let mut summary_evidence = TextEvidence::default();
    for (index, payload) in tool_payloads.iter().enumerate() {
        summary_evidence.add_ref(
            "run_tool_result",
            format!("run:{run_id}:result:{}", index + 1),
        );
        if let Some(data) = payload.get("data") {
            summary_evidence.add_json(data);
        }
    }
    let summary_draft =
        GeneratedOutputDraft::single_claim(candidate_summary, summary_evidence.refs.clone());
    let mut gated_summary = admit_structured_output(
        req.org_id,
        req.company_id,
        &summary_draft,
        &summary_evidence,
    )
    .await?;
    persist_or_withhold_generated_output(
        &mut gated_summary,
        state.stdb.as_ref(),
        state.spend_read_stdb.as_deref(),
        PublicationIdentity {
            organization_id: req.org_id,
            company_id: req.company_id,
            session_ref: format!("run:{run_id}:classic_summary"),
            event_ref: "classic_run_summary".to_string(),
            note: "classic run summary admitted by the publication gate".to_string(),
        },
    )
    .await;
    let summary = gated_summary
        .released
        .clone()
        .unwrap_or_else(|| gated_summary.withheld_notice());
    let evidence_claim_ids = gated_summary.provenance.claim_ids.clone();
    let verification = Some(gated_summary.verification.clone());
    let provenance = Some(gated_summary.provenance.clone());

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
        evidence_claim_ids,
        verification,
        provenance,
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
    pub max_steps: Option<u32>,
    /// Resume an existing governed run/checkpoint instead of creating a new run.
    pub resume_run_id: Option<u64>,
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
    // The admitted harness boundary is governed-only. Falling through to the
    // legacy direct-execution loop would let provider tool calls regain
    // execution authority outside the typed DecisionGraph runtime.
    if governed_catalog.is_none() {
        anyhow::bail!(
            "skill '{skill_key}' has no governed program; direct-execution admitted runs are disabled"
        );
    }
    let reviewed_calls = if req.reviewed_calls.is_empty() {
        governed_catalog
            .as_ref()
            .map(|entry| entry.reviewed_calls.clone())
            .context("governed program must declare reviewed calls")?
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

    let inputs_json = serde_json::to_string(&req.inputs).context("serialize inputs")?;
    let triggered_by_hex = req
        .triggered_by_hex
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("0000000000000000000000000000000000000000000000000000000000000000")
        .to_string();
    let is_resume = req.resume_run_id.is_some();
    let (run_id, run_key) = if let Some(resume_run_id) = req.resume_run_id {
        validate_resume_identity(
            &stdb,
            req.org_id,
            req.company_id,
            resume_run_id,
            skill.id,
            agent.agent_id,
            &inputs_json,
        )
        .await?;
        let run_key = load_run_key(&stdb, req.org_id, req.company_id, resume_run_id).await?;
        (resume_run_id, run_key)
    } else {
        let run_key = Uuid::new_v4().to_string();
        if skill.id > 0 {
            let run = create_run(
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
            (run.run_id, run.run_key)
        } else {
            (0, run_key)
        }
    };

    let manifest = load_active_manifest(&stdb, req.org_id, &skill_key, req.skill_version)
        .await
        .map_err(|message| anyhow::anyhow!(message))?;

    let ledger = StdbSpendLedger {
        writer: &state.stdb,
        reader: spend_reader,
    };
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
    let engine = PolicyEngine::new(
        SkillRegistry::exact(manifest.clone()),
        ResourceRegistry::built_in(),
    );
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
        // AIH-15: the §7.3 answer gate. Passages resolve against the
        // server-side catalog; claim coverage is judged by the review-role
        // provider (model-assisted, recorded as such, never approval).
        let verification = EvidenceBackedVerificationService;
        let passage_catalog = StdbPassageCatalog {
            reader: spend_reader,
        };
        let claim_checker = DecisionClaimCoverageChecker {
            reviewer: &review_provider,
        };
        let answer_admission = EvidenceGatedAnswerAdmission {
            scope: GateScope {
                organization_id: req.org_id,
                company_id: req.company_id,
                as_of_micros: chrono::Utc::now().timestamp_micros(),
                required_applicability: required_applicability(&skill.config_json)?,
            },
            policy: GatePolicy::default(),
            catalog: &passage_catalog,
            claim_checker: Some(&claim_checker),
        };
        // AIH-14: persist the provenance of every answer the gate judges, so
        // it can be inspected claim by claim and invalidated with its sources.
        let evidence_recorder = StdbEvidenceRecorder {
            writer: state.stdb.as_ref(),
            reader: spend_reader,
        };
        let recording_admission = RecordingAnswerAdmission {
            gate: &answer_admission,
            recorder: &evidence_recorder,
            scope: RunEvidenceScope {
                organization_id: req.org_id,
                company_id: req.company_id,
                run_id,
            },
            recorded: std::sync::Mutex::new(Vec::new()),
        };
        let compute = BuiltinComputeService;
        let calibration = StdbCalibrationProfileStore {
            reader: tool_ctx.stdb.as_ref(),
        };
        validate_governed_runtime_configuration(req.org_id, &graph, &decision_types, &calibration)
            .await?;
        let deterministic_candidates = production_deterministic_candidates();
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
            candidates: deterministic_candidates,
            model: &decision_provider,
            model_shadow_recorder: &model_shadow_recorder,
            drift_monitor: Some(&drift_monitor),
            rollback_recorder: Some(&rollback_recorder),
        };
        let checkpoint_store = StdbProgramCheckpointStore {
            writer: state.stdb.as_ref(),
            reader: tool_ctx.stdb.as_ref(),
        };
        let executor = GovernedProgramExecutor {
            decision_provider: &decision_provider,
            checkpoint_store: Some(&checkpoint_store),
            decision_resolver: Some(&decision_resolver),
            generation_provider: &generation_provider,
            reasoning_provider: &reasoning_provider,
            decision_types: &decision_types,
            precedent: &precedent,
            capabilities: &capabilities,
            verification: &verification,
            answer_admission: &recording_admission,
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
                let extracted = extract_query(&req.inputs);
                let query = build_web_search_query(&skill_key, &req.inputs, &extracted)
                    .or_else(|| (!extracted.trim().is_empty()).then_some(extracted));
                if let Some(query) = query {
                    object.insert("query".to_string(), Value::String(query));
                }
            }
        }
        // AIH-17: compile the approved knowledge the skill asks for. Entries
        // are re-authorized and re-validated now, not trusted from when they
        // were approved, and request inputs can never forge them.
        let knowledge = compile_knowledge_context(
            spend_reader,
            Viewer {
                organization_id: req.org_id,
                company_id: req.company_id,
                actor_identity: req
                    .triggered_by_hex
                    .as_deref()
                    .and_then(super::evidence_inspector::ActorIdentity::parse),
            },
            &knowledge_entry_keys(&skill.config_json)?,
        )
        .await?;
        merge_into_inputs(&mut governed_inputs, &knowledge);
        let mut run_evidence = vec![EvidenceRef {
            kind: "governed_run_step".to_string(),
            id: format!("run:{run_id}:analytics"),
        }];
        run_evidence.extend(knowledge.evidence.iter().cloned());
        let program_context = GovernedProgramContext {
            organization_id: req.org_id,
            company_id: req.company_id,
            run_id,
            program_ref: catalog.program_ref.to_string(),
            objective: skill.prompt_template.clone(),
            bounded_state: governed_inputs,
            evidence: run_evidence,
        };
        if is_resume {
            checkpoint_store
                .validate_resume(&program_context, &graph)
                .await?;
            // This mutation happens only after the current actor, skill,
            // bounded inputs, graph and knowledge/source dependencies have
            // all been re-authorized and matched to the immutable checkpoint.
            resume_run(&stdb, req.org_id, req.company_id, run_id).await?;
        }
        let program = executor.run(&graph, &program_context).await?;
        let evidence_claim_ids = recording_admission
            .recorded
            .lock()
            .map(|ids| ids.clone())
            .unwrap_or_default();

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
                    evidence_claim_ids,
                    verification: None,
                    provenance: None,
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
            GovernedProgramStop::Denied(reason) | GovernedProgramStop::UnableToProgress(reason) => {
                ("failed".to_string(), reason.clone(), Some(reason.clone()))
            }
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
            evidence_claim_ids,
            verification: None,
            provenance: None,
        });
    }

    anyhow::bail!("governed program catalog invariant violated for skill '{skill_key}'")
}

async fn validate_resume_identity(
    stdb: &stdb_client::StdbClient,
    org_id: u64,
    company_id: u64,
    run_id: u64,
    skill_id: u64,
    agent_id: u64,
    expected_inputs_json: &str,
) -> Result<()> {
    let rows = stdb
        .query_sql(&format!(
            "SELECT * FROM ai_agent_run WHERE organization_id = {org_id}              AND company_id = {company_id} AND id = {run_id} LIMIT 1"
        ))
        .await
        .context("load governed run resume identity")?;
    let row = rows
        .first()
        .context("governed run to resume was not found")?;
    let stored_skill_id = row
        .get("skillId")
        .or_else(|| row.get("skill_id"))
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let stored_agent_id = row
        .get("agentId")
        .or_else(|| row.get("agent_id"))
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let stored_inputs = row
        .get("inputsJson")
        .or_else(|| row.get("inputs_json"))
        .and_then(Value::as_str)
        .context("resumable run inputs missing")?;
    if skill_id > 0 && stored_skill_id != skill_id {
        anyhow::bail!("resume run skill identity does not match current skill");
    }
    if stored_agent_id != agent_id {
        anyhow::bail!("resume run agent identity does not match current agent");
    }
    let stored_value: Value =
        serde_json::from_str(stored_inputs).context("decode stored resume inputs")?;
    let expected_value: Value =
        serde_json::from_str(expected_inputs_json).context("decode expected resume inputs")?;
    if stored_value != expected_value {
        anyhow::bail!("resume run inputs do not match the original bounded state");
    }
    Ok(())
}

async fn validate_governed_runtime_configuration(
    organization_id: u64,
    graph: &DecisionGraph,
    decision_types: &dyn DecisionTypeRegistry,
    calibration: &dyn CalibrationProfileStore,
) -> Result<()> {
    for node in &graph.nodes {
        let decision_type = match &node.kind {
            DecisionNode::Choice(node) => Some(&node.decision_type),
            DecisionNode::Score(node) => Some(&node.decision_type),
            DecisionNode::Probability(node) => Some(&node.decision_type),
            _ => None,
        };
        if let Some(reference) = decision_type {
            decision_types
                .get(&reference.name, reference.version)
                .await?
                .with_context(|| {
                    format!(
                        "governed DecisionType '{}@{}' is not provisioned; run governed bootstrap first",
                        reference.name, reference.version
                    )
                })?;
        }

        if let DecisionNode::Gate(gate) = &node.kind {
            for branch in &gate.branches {
                if let GateCondition::ThresholdPolicy {
                    calibration_profile: Some(reference),
                    ..
                } = &branch.condition
                {
                    calibration
                        .get(organization_id, reference)
                        .await?
                        .with_context(|| {
                            format!(
                                "calibration profile '{}@{}' is not provisioned; run governed bootstrap first",
                                reference.name, reference.version
                            )
                        })?;
                }
            }
        }
    }
    Ok(())
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
    fn required_applicability_parses_absent_valid_and_rejects_malformed() {
        assert!(required_applicability(&json!({})).unwrap().is_empty());
        assert_eq!(
            required_applicability(&json!({"requiredApplicability": ["jurisdiction:US"]})).unwrap(),
            vec!["jurisdiction:US".to_string()]
        );
        for bad in [
            json!({"requiredApplicability": "jurisdiction:US"}),
            json!({"requiredApplicability": ["jurisdiction"]}),
            json!({"requiredApplicability": [7]}),
        ] {
            assert!(required_applicability(&bad).is_err());
        }
    }

    #[tokio::test]
    async fn governed_runtime_preflight_never_bootstraps_missing_calibration() {
        let decision_types =
            super::super::decision_type::InMemoryDecisionTypeRegistry::with_builtins();
        let calibration = super::super::probabilistic::InMemoryCalibrationProfileStore::new();
        let graph = super::super::governed_programs::report_analysis_graph();

        let error =
            validate_governed_runtime_configuration(9, &graph, &decision_types, &calibration)
                .await
                .unwrap_err();
        assert!(error.to_string().contains("run governed bootstrap first"));

        calibration
            .register(super::super::probabilistic::CalibrationProfile {
                profile_ref: super::super::probabilistic::CalibrationProfileRef {
                    name: "report-attention".to_string(),
                    version: 1,
                },
                breakpoints: vec![(0.0, 0.0), (0.35, 0.35), (0.65, 0.65), (1.0, 1.0)],
            })
            .unwrap();

        validate_governed_runtime_configuration(9, &graph, &decision_types, &calibration)
            .await
            .unwrap();
    }

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
    company_id: u64,
    run_id: u64,
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

    if run_id == 0 {
        anyhow::bail!(
            "classic skill synthesis requires a durable run; sync the bundled skill before execution"
        );
    }
    let spend_reader = state
        .spend_read_stdb
        .as_deref()
        .context("spend_read_stdb is required for routed generation")?;
    let model_store = StdbModelConfigurationStore {
        reader: state.stdb.as_ref(),
    };
    let ledger = StdbSpendLedger {
        writer: state.stdb.as_ref(),
        reader: spend_reader,
    };
    let response = generate_routed_for_run(
        &model_store,
        &ledger,
        org_id,
        company_id,
        run_id,
        agent,
        skill
            .config_json
            .get("intelligencePolicyRef")
            .or_else(|| skill.config_json.get("intelligence_policy_ref"))
            .and_then(Value::as_str),
        state.providers.llm.as_ref(),
        GenerationRequest {
            objective: user,
            context: json!({"tool_results": tool_payloads}),
            format: "concise grounded ERP skill summary".to_string(),
            instructions: Some(system),
            max_tokens: Some(agent.max_tokens.min(2048)),
        },
    )
    .await
    .context("skill synthesis LLM")?;

    let tokens_used = response.input_tokens.saturating_add(response.output_tokens);
    Ok((response.content.trim().to_string(), tokens_used))
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
