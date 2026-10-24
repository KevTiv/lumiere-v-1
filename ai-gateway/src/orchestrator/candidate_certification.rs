//! Candidate-only execution of the compiled report-analysis program.
//!
//! The certification worker supplies a claimed immutable version/environment.
//! This entry point has no AppState, credentials, network client, filesystem
//! broker, active-release override, or expected fixture output. Only synthetic
//! named reads and explicitly labelled provider transcripts can be replayed.
//! Policy, decision admission, calibration, graph control and answer evidence
//! checks remain owned by the same services used for admitted live runs.

use std::{collections::VecDeque, sync::Mutex};

use anyhow::{bail, ensure, Context, Result};
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    harness::{
        audit::DecisionOutcome,
        certification::{CandidateExecution, CandidateExecutionRequest},
        certification_fixtures::{
            CapabilityEvidence, CertificationTenantScope, ImmutableCertificationDataset,
        },
        data_scope_resolver::ResourceRegistry,
        governed_llm_skills::{GovernedLlmSkillInput, REPORT_ANALYSIS_RESOURCE},
        manifest::Capability,
        policy_engine::{
            ExecutionMetadata, ExecutionPlan, PlannedToolCall, PolicyEngine, PolicyExecutionRequest,
        },
        release_registry::candidate_policy_manifest,
        skill_registry::SkillRegistry,
    },
    tools::types::ToolOutput,
};

use super::{
    answer_gate::{
        DecisionClaimCoverageChecker, EvidenceBackedVerificationService,
        EvidenceGatedAnswerAdmission, GatePolicy, GateScope, PassageCatalog, PassageStatus,
        SourcePassage,
    },
    decision_type::{register_builtin_decision_types, InMemoryDecisionTypeRegistry},
    governed_program::{
        BuiltinComputeService, GovernedProgramContext, GovernedProgramExecutor,
        GovernedProgramStop, NoopIntelligenceEventRecorder,
    },
    governed_programs::{report_analysis_graph, REPORT_ANALYSIS_PROGRAM_REF},
    governed_services::{
        CapabilityExecutor, GovernedCapabilityService, InMemoryExecutionRecovery,
        PolicyBackedCapabilityAdmission, RecordingApprovalCoordinator,
    },
    intelligence::{
        CapabilityProposal, DecisionProvider, DecisionRequest, DecisionResponse, DecisionTypeRef,
        GenerationProvider, GenerationRequest, GenerationResponse, ReasoningOutcome,
        ReasoningProvider, ReasoningRequest,
    },
    invocation_policy::ReviewedInvocationPolicy,
    precedent::InMemoryPrecedentStore,
    probabilistic::{CalibrationProfile, CalibrationProfileRef, InMemoryCalibrationProfileStore},
};

const MAX_TRANSCRIPT_ITEMS: usize = 32;
const FIXTURE_PROVIDER: &str = "certification-fixture";
const FIXTURE_MODEL: &str = "immutable-transcript-v1";

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ReportFixture {
    analytics_arguments: Value,
    analytics_output: ToolOutput,
    decisions: Vec<RecordedDecision>,
    generations: Vec<RecordedGeneration>,
    reasoning: Vec<ReasoningOutcome>,
    passages: Vec<FixturePassage>,
    as_of_micros: i64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RecordedDecision {
    decision_type: DecisionTypeRef,
    response: DecisionResponse,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RecordedGeneration {
    format: String,
    response: GenerationResponse,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct FixturePassage {
    id: u64,
    kind: String,
    source_key: String,
    version: String,
    passage_key: String,
    content_hash: String,
    text: String,
    effective_from_micros: Option<i64>,
    effective_to_micros: Option<i64>,
    applicability: Vec<String>,
    status: String,
}

impl TryFrom<FixturePassage> for SourcePassage {
    type Error = anyhow::Error;

    fn try_from(value: FixturePassage) -> Result<Self> {
        ensure!(value.id > 0, "fixture passage id must be positive");
        ensure!(
            [
                &value.kind,
                &value.source_key,
                &value.version,
                &value.passage_key
            ]
            .iter()
            .all(|value| !value.trim().is_empty()),
            "fixture passage identity is incomplete"
        );
        Ok(Self {
            id: value.id,
            kind: value.kind,
            source_key: value.source_key,
            version: value.version,
            passage_key: value.passage_key,
            content_hash: value.content_hash,
            text: value.text,
            effective_from_micros: value.effective_from_micros,
            effective_to_micros: value.effective_to_micros,
            applicability: value.applicability,
            status: PassageStatus::from_label(&value.status)
                .context("invalid fixture passage status")?,
        })
    }
}

struct FixtureCatalog {
    scope: CertificationTenantScope,
    passages: Vec<SourcePassage>,
}

#[async_trait]
impl PassageCatalog for FixtureCatalog {
    async fn source_passages(
        &self,
        organization_id: u64,
        company_id: u64,
        kind: &str,
        source_key: &str,
    ) -> Result<Vec<SourcePassage>> {
        ensure!(
            self.scope.organization_id == organization_id && self.scope.company_id == company_id,
            "fixture passage read changed tenant scope"
        );
        Ok(self
            .passages
            .iter()
            .filter(|passage| passage.kind == kind && passage.source_key == source_key)
            .cloned()
            .collect())
    }
}

struct FixtureAnalytics {
    arguments: Value,
    output: ToolOutput,
}

#[async_trait]
impl CapabilityExecutor for FixtureAnalytics {
    async fn execute(&self, proposal: &CapabilityProposal) -> Result<ToolOutput> {
        ensure!(
            proposal.capability == "analytics_summary" && !proposal.poll,
            "certification only supports the reviewed analytics read"
        );
        ensure!(
            proposal.arguments == self.arguments,
            "analytics arguments differ from the pinned fixture"
        );
        Ok(self.output.clone())
    }
}

struct FixtureProviders {
    decisions: Mutex<VecDeque<RecordedDecision>>,
    generations: Mutex<VecDeque<RecordedGeneration>>,
    reasoning: Mutex<VecDeque<ReasoningOutcome>>,
}

fn next<T>(queue: &Mutex<VecDeque<T>>, kind: &str) -> Result<T> {
    queue
        .lock()
        .map_err(|_| anyhow::anyhow!("fixture transcript lock is poisoned"))?
        .pop_front()
        .with_context(|| format!("no recorded {kind} reply remains"))
}

fn consumed<T>(queue: &Mutex<VecDeque<T>>) -> Result<bool> {
    Ok(queue
        .lock()
        .map_err(|_| anyhow::anyhow!("fixture transcript lock is poisoned"))?
        .is_empty())
}

#[async_trait]
impl DecisionProvider for FixtureProviders {
    async fn decide(&self, request: DecisionRequest) -> Result<DecisionResponse> {
        request.validate()?;
        let mut reply = next(&self.decisions, "decision")?;
        ensure!(
            reply.decision_type == request.decision_type,
            "recorded decision type differs from the runtime request"
        );
        reply.response.validate_against(&request)?;
        reply.response.provider = FIXTURE_PROVIDER.to_string();
        reply.response.model = FIXTURE_MODEL.to_string();
        reply.response.input_tokens = 0;
        reply.response.output_tokens = 0;
        Ok(reply.response)
    }
}

#[async_trait]
impl GenerationProvider for FixtureProviders {
    async fn generate(&self, request: GenerationRequest) -> Result<GenerationResponse> {
        request.validate()?;
        let mut reply = next(&self.generations, "generation")?;
        ensure!(
            reply.format == request.format,
            "recorded generation format differs from the runtime request"
        );
        ensure!(
            !reply.response.content.trim().is_empty(),
            "recorded generation is empty"
        );
        reply.response.provider = FIXTURE_PROVIDER.to_string();
        reply.response.model = FIXTURE_MODEL.to_string();
        reply.response.input_tokens = 0;
        reply.response.output_tokens = 0;
        Ok(reply.response)
    }
}

#[async_trait]
impl ReasoningProvider for FixtureProviders {
    async fn reason(&self, request: ReasoningRequest) -> Result<ReasoningOutcome> {
        request.validate()?;
        let reply = next(&self.reasoning, "reasoning")?;
        reply.validate_against(&request)?;
        Ok(reply)
    }
}

/// Execute only a worker-claimed report candidate against its immutable fixture.
/// This is a source/runtime benchmark, never a live-model or spend certificate.
pub(crate) async fn execute_report_analysis(
    request: CandidateExecutionRequest,
) -> Result<CandidateExecution> {
    ensure!(
        request.version.resources == [REPORT_ANALYSIS_RESOURCE],
        "report certification requires its exact named resource"
    );
    let input: GovernedLlmSkillInput =
        serde_json::from_value(request.input.clone()).context("invalid report fixture input")?;
    ensure!(
        input.agent_id.is_none()
            && input.team_member_id.is_none()
            && input.resume_run_id.is_none()
            && input.max_steps.is_none(),
        "a certification fixture cannot bind a live agent or run"
    );
    let objective = input
        .inputs
        .get("query")
        .and_then(Value::as_str)
        .filter(|query| !query.trim().is_empty() && query.len() <= 5_000)
        .context("report fixture needs a bounded query")?;
    let dataset = ImmutableCertificationDataset::parse(
        request.scope,
        &request.version.resources,
        &request.environment,
    )?;
    let resource = dataset.resource(REPORT_ANALYSIS_RESOURCE)?;
    let fixture: ReportFixture = serde_json::from_value(resource.value().clone())
        .context("invalid report certification environment")?;
    ensure!(
        fixture.decisions.len() + fixture.generations.len() + fixture.reasoning.len()
            <= MAX_TRANSCRIPT_ITEMS,
        "fixture transcript exceeds its execution bound"
    );
    ensure!(
        fixture.passages.len() <= 32,
        "fixture passage catalog exceeds its bound"
    );
    let manifest = candidate_policy_manifest(&request.version).map_err(anyhow::Error::msg)?;
    let call = PlannedToolCall {
        tool_name: "analytics_summary".to_string(),
        capability: Capability::NamedRead,
        named_resource: Some(REPORT_ANALYSIS_RESOURCE.to_string()),
    };
    let base = PolicyExecutionRequest {
        skill: manifest.skill.clone(),
        organization_id: request.scope.organization_id,
        company_id: request.scope.company_id,
        correlation_id: format!(
            "certification:{}:{}",
            request.environment.id, request.fixture_id
        ),
        metadata: ExecutionMetadata {
            actor_id: Some("ai-gateway-certification".to_string()),
            causation_id: Some(request.environment.environment_fingerprint.clone()),
            ..Default::default()
        },
        input: request.input.clone(),
        plan: ExecutionPlan {
            named_resources: vec![REPORT_ANALYSIS_RESOURCE.to_string()],
            tool_calls: vec![call.clone()],
            steps: 1,
            expected_rows: fixture.analytics_output.row_count.unwrap_or(0),
            output_type: manifest.output_type.clone(),
        },
    };
    let engine = PolicyEngine::new(
        SkillRegistry::exact(manifest.clone()),
        ResourceRegistry::built_in(),
    );
    let decision = engine.evaluate(&base);
    ensure!(
        decision.outcome == DecisionOutcome::Allow,
        "canonical policy denied report certification"
    );
    let policy = ReviewedInvocationPolicy::new(engine, base, vec![call])?;
    let admission = PolicyBackedCapabilityAdmission::new(&policy);
    let evidence = CapabilityEvidence::new(
        "analytics_summary",
        request.scope,
        REPORT_ANALYSIS_RESOURCE,
        dataset.environment_fingerprint(),
        &fixture.analytics_arguments,
        &serde_json::to_value(&fixture.analytics_output)?,
    );
    let analytics = FixtureAnalytics {
        arguments: fixture.analytics_arguments,
        output: fixture.analytics_output,
    };
    let recovery = InMemoryExecutionRecovery::new();
    let approvals = RecordingApprovalCoordinator;
    let capabilities =
        GovernedCapabilityService::new(&admission, &analytics, &recovery, &approvals);
    let providers = FixtureProviders {
        decisions: Mutex::new(fixture.decisions.into()),
        generations: Mutex::new(fixture.generations.into()),
        reasoning: Mutex::new(fixture.reasoning.into()),
    };
    let catalog = FixtureCatalog {
        scope: request.scope,
        passages: fixture
            .passages
            .into_iter()
            .map(TryInto::try_into)
            .collect::<Result<Vec<_>>>()?,
    };
    let checker = DecisionClaimCoverageChecker {
        reviewer: &providers,
    };
    let answer_gate = EvidenceGatedAnswerAdmission {
        scope: GateScope {
            organization_id: request.scope.organization_id,
            company_id: request.scope.company_id,
            as_of_micros: fixture.as_of_micros,
            required_applicability: Vec::new(),
        },
        policy: GatePolicy::default(),
        catalog: &catalog,
        claim_checker: Some(&checker),
        reviewed_claims: None,
    };
    let decision_types = InMemoryDecisionTypeRegistry::new();
    register_builtin_decision_types(&decision_types).await?;
    let calibration = InMemoryCalibrationProfileStore::new();
    calibration.register(CalibrationProfile {
        profile_ref: CalibrationProfileRef {
            name: "report-attention".to_string(),
            version: 1,
        },
        breakpoints: vec![(0.0, 0.0), (0.35, 0.35), (0.65, 0.65), (1.0, 1.0)],
    })?;
    let precedent = InMemoryPrecedentStore::new();
    let verification = EvidenceBackedVerificationService;
    let compute = BuiltinComputeService;
    let recorder = NoopIntelligenceEventRecorder;
    let context = GovernedProgramContext {
        organization_id: request.scope.organization_id,
        company_id: request.scope.company_id,
        run_id: request.fixture_id,
        program_ref: REPORT_ANALYSIS_PROGRAM_REF.to_string(),
        objective: objective.to_string(),
        bounded_state: input.inputs.clone(),
        evidence: Vec::new(),
        generation_instructions: None,
        generation_max_tokens: None,
    };
    let result = GovernedProgramExecutor {
        decision_provider: &providers,
        checkpoint_store: None,
        decision_resolver: None,
        generation_provider: &providers,
        reasoning_provider: &providers,
        decision_types: &decision_types,
        precedent: &precedent,
        capabilities: &capabilities,
        verification: &verification,
        answer_admission: &answer_gate,
        compute: &compute,
        recorder: &recorder,
        calibration: &calibration,
    }
    .run(&report_analysis_graph(), &context)
    .await?;
    ensure!(
        result.trace.len().saturating_add(1) <= manifest.limits.max_steps as usize
            && result.capability_calls <= manifest.limits.max_tool_calls,
        "candidate execution exceeded the immutable skill limits"
    );
    ensure!(
        consumed(&providers.decisions)?
            && consumed(&providers.generations)?
            && consumed(&providers.reasoning)?,
        "runtime did not consume the exact pinned provider transcript"
    );
    let status = match &result.stop {
        GovernedProgramStop::Completed => "completed",
        GovernedProgramStop::ReviewRequired(_) => "review_required",
        GovernedProgramStop::Denied(_) => "denied",
        _ => "not_completed",
    };
    let actual_output = json!({"status": status, "summary": result.released_content(), "steps": &result.trace, "decisionCalls": result.decision_calls, "capabilityCalls": result.capability_calls});
    if serde_json::to_vec(&actual_output)?.len()
        > crate::harness::certification_fixtures::MAX_CERTIFICATION_OUTPUT_BYTES
    {
        bail!("report certification output exceeds its size bound");
    }
    Ok(CandidateExecution {
        actual_output,
        executor_run_id: None,
        metadata: Some(json!({
            "executionMode": "immutable_fixture_replay", "billableCalls": 0,
            "programRef": REPORT_ANALYSIS_PROGRAM_REF, "provider": FIXTURE_PROVIDER,
            "capabilityEvidence": [evidence], "certificationEnvironmentId": request.environment.id,
            "policyEvidence": {"decisionHashes": &decision.hashes, "outcome": decision.outcome},
        })),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harness::{
        certification::report_analysis_certification_bundle_hash,
        governed_llm_skills::REPORT_ANALYSIS_OUTPUT_TYPE,
        manifest::RiskClass,
        release_registry::{CandidateCertificationEnvironment, CandidateSkillVersion},
    };

    fn request() -> CandidateExecutionRequest {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../infra/railway/pilots/report-analysis-certification-fixture.json"
        ))
        .unwrap();
        CandidateExecutionRequest {
            version: CandidateSkillVersion {
                id: 3,
                organization_id: 1,
                skill_id: 11,
                skill_key: "report_analysis".into(),
                version: "1.0.0".into(),
                manifest_json: json!({}),
                source_hash: report_analysis_certification_bundle_hash(),
                risk: RiskClass::Green,
                max_steps: 8,
                max_tool_calls: 12,
                permissions: vec![],
                resources: vec![REPORT_ANALYSIS_RESOURCE.into()],
                output_types: vec![REPORT_ANALYSIS_OUTPUT_TYPE.into()],
            },
            fixture_id: 5,
            fixture_key: "grounded-synthetic-report".into(),
            input: fixture["input"].clone(),
            scope: CertificationTenantScope::new(1, 1).unwrap(),
            environment: CandidateCertificationEnvironment {
                id: 13,
                organization_id: 1,
                skill_id: 11,
                fixture_id: 5,
                dataset: fixture["dataset"].clone(),
                virtual_files: json!({}),
                environment_fingerprint: format!("sha256:{}", "e".repeat(64)),
            },
        }
    }

    fn data(request: &mut CandidateExecutionRequest) -> &mut Value {
        &mut request.environment.dataset[REPORT_ANALYSIS_RESOURCE]["data"]
    }

    #[tokio::test]
    async fn executes_the_shared_graph_and_releases_a_grounded_synthetic_claim() {
        let execution = execute_report_analysis(request()).await.unwrap();
        assert_eq!(execution.actual_output["status"], "completed");
        assert_eq!(
            execution.actual_output["summary"],
            "This synthetic report has no overdue items."
        );
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../infra/railway/pilots/report-analysis-certification-fixture.json"
        ))
        .unwrap();
        assert_eq!(execution.actual_output, fixture["expectedOutput"]);
        assert_eq!(execution.actual_output["capabilityCalls"], 1);
        assert_eq!(
            execution.actual_output["steps"]
                .as_array()
                .unwrap()
                .iter()
                .map(|step| step["node_id"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["analytics", "verify_analytics", "attention_need", "route"]
        );
        let metadata = execution.metadata.unwrap();
        assert_eq!(metadata["billableCalls"], 0);
        assert_eq!(metadata["provider"], FIXTURE_PROVIDER);
        assert_eq!(metadata["capabilityEvidence"][0]["companyId"], 1);
    }

    #[tokio::test]
    async fn production_registry_binds_source_and_does_not_copy_expected_output() {
        use crate::harness::{
            certification::{CandidateAdapterRegistry, CertificationExecutionError},
            release_registry::{CandidateCertificationInputs, CandidateFixture},
        };
        let request = request();
        let mut candidate = CandidateCertificationInputs {
            version: request.version,
            fixture: CandidateFixture {
                id: request.fixture_id,
                organization_id: request.scope.organization_id,
                skill_id: 11,
                fixture_key: request.fixture_key,
                input: request.input,
                expected_output: json!({"summary": "This must never become runtime output"}),
            },
        };
        let registry = CandidateAdapterRegistry::production();
        let result = registry
            .execute(candidate.clone(), request.environment.clone(), 1, 1)
            .await
            .unwrap();
        assert_ne!(result.actual_output, candidate.fixture.expected_output);
        assert_eq!(result.actual_output["status"], "completed");
        candidate.version.source_hash = format!("sha256:{}", "f".repeat(64));
        assert!(matches!(
            registry.execute(candidate, request.environment, 1, 1).await,
            Err(CertificationExecutionError::UnsupportedSkill { .. })
        ));
    }

    #[tokio::test]
    async fn rejects_policy_limit_drift_and_cross_company_output() {
        let mut limited = request();
        limited.version.max_steps = 1;
        assert!(execute_report_analysis(limited)
            .await
            .unwrap_err()
            .to_string()
            .contains("immutable skill limits"));
        let mut foreign = request();
        data(&mut foreign)["analyticsOutput"]["data"]["artifacts"][0]["companyId"] = json!(2);
        data(&mut foreign)["decisions"] = json!([]);
        data(&mut foreign)["reasoning"] = json!([]);
        assert!(execute_report_analysis(foreign)
            .await
            .unwrap_err()
            .to_string()
            .contains("CrossCompanyRow"));
    }

    #[tokio::test]
    async fn refuses_a_foreign_tenant_environment_and_live_agent_binding() {
        let mut foreign = request();
        foreign.environment.dataset[REPORT_ANALYSIS_RESOURCE]["companyId"] = json!(9);
        assert!(execute_report_analysis(foreign)
            .await
            .unwrap_err()
            .to_string()
            .contains("tenant scope"));
        let mut live = request();
        live.input["agentId"] = json!(22);
        assert!(execute_report_analysis(live)
            .await
            .unwrap_err()
            .to_string()
            .contains("live agent"));
    }

    #[tokio::test]
    async fn rejects_an_unconsumed_or_wrongly_typed_transcript() {
        let mut unused = request();
        let extra = data(&mut unused)["decisions"][0].clone();
        data(&mut unused)["decisions"]
            .as_array_mut()
            .unwrap()
            .push(extra);
        assert!(execute_report_analysis(unused)
            .await
            .unwrap_err()
            .to_string()
            .contains("exact pinned"));
        let mut wrong = request();
        data(&mut wrong)["decisions"][0]["decisionType"]["name"] = json!("OtherDecision");
        assert!(execute_report_analysis(wrong)
            .await
            .unwrap_err()
            .to_string()
            .contains("decision type differs"));
    }

    #[tokio::test]
    async fn a_forged_passage_hash_cannot_release_an_answer() {
        let mut forged = request();
        data(&mut forged)["passages"][0]["contentHash"] = json!("0".repeat(64));
        // Invalid evidence stops before semantic review, so pin only the reply the graph uses.
        data(&mut forged)["decisions"]
            .as_array_mut()
            .unwrap()
            .truncate(1);
        let execution = execute_report_analysis(forged).await.unwrap();
        assert_ne!(execution.actual_output["status"], "completed");
        assert!(execution.actual_output["summary"].is_null());
    }

    #[tokio::test]
    async fn a_claimless_generation_is_held_for_review() {
        let mut claimless = request();
        data(&mut claimless)["decisions"]
            .as_array_mut()
            .unwrap()
            .truncate(1);
        data(&mut claimless)["decisions"][0]["response"]["confidence"] = json!(0.9);
        data(&mut claimless)["reasoning"] = json!([]);
        data(&mut claimless)["generations"] = json!([{
            "format": "concise report highlighting anomalies, material changes, and concrete follow-up questions",
            "response": {"content": "An ungrounded synthetic answer", "provider": "fixture", "model": "fixture",
                "input_tokens": 0, "output_tokens": 0}
        }]);
        let execution = execute_report_analysis(claimless).await.unwrap();
        assert_eq!(execution.actual_output["status"], "review_required");
        assert!(execution.actual_output["summary"].is_null());
    }
}
