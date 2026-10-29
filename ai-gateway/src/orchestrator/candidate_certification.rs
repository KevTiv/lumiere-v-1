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
    #[serde(default)]
    finance_source: Option<Value>,
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
    capability: String,
    arguments: Value,
    output: ToolOutput,
}

#[async_trait]
impl CapabilityExecutor for FixtureAnalytics {
    async fn execute(&self, proposal: &CapabilityProposal) -> Result<ToolOutput> {
        ensure!(
            proposal.capability == self.capability && !proposal.poll,
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
        ensure!(
            request.response_format == super::intelligence::GenerationResponseFormat::FinalDraft,
            "report certification must exercise the structured generation contract"
        );
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
    execute_review_program(request, None).await
}

pub(crate) async fn execute_finance(
    request: CandidateExecutionRequest,
) -> Result<CandidateExecution> {
    let spec = lumiere_finance_review_core::skill(&request.version.skill_key)?;
    execute_review_program(request, Some(spec)).await
}

async fn execute_review_program(
    request: CandidateExecutionRequest,
    finance: Option<lumiere_finance_review_core::Skill>,
) -> Result<CandidateExecution> {
    let resource_name = finance.map_or(REPORT_ANALYSIS_RESOURCE, |s| s.resource);
    let tool_name = if finance.is_some() {
        "finance_review_read"
    } else {
        "analytics_summary"
    };
    let program_ref = finance.map_or(REPORT_ANALYSIS_PROGRAM_REF, |s| s.program);
    let graph = if finance.is_some() {
        super::governed_programs::finance_review_graph()
    } else {
        report_analysis_graph()
    };
    ensure!(
        request.version.resources == [resource_name],
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
        .unwrap_or("Review the authorized finance observation");
    let dataset = ImmutableCertificationDataset::parse(
        request.scope,
        &request.version.resources,
        &request.environment,
    )?;
    let resource = dataset.resource(resource_name)?;
    let mut fixture: ReportFixture = serde_json::from_value(resource.value().clone())
        .context("invalid report certification environment")?;
    if let Some(spec) = finance {
        let sources = fixture
            .finance_source
            .as_ref()
            .context("finance fixture needs pinned source inputs")?;
        let observation = lumiere_finance_review_core::fixture_observation(
            spec.key,
            request.scope.organization_id,
            request.scope.company_id,
            &input.inputs,
            sources,
        )?;
        let response = json!({"schemaVersion":1,"skillKey":spec.key,"organizationId":request.scope.organization_id,"companyId":request.scope.company_id,"observedAt":chrono::DateTime::from_timestamp_micros(fixture.as_of_micros).context("fixture time invalid")?.to_rfc3339(),"observation":observation});
        let (output, passage) = crate::tools::finance_review::output(
            spec.key,
            request.scope.organization_id,
            request.scope.company_id,
            request.fixture_id,
            &input.inputs,
            response,
        )?;
        fixture.analytics_arguments = input.inputs.clone();
        fixture.analytics_output = output;
        // The catalog is derived from actual deterministic output, never from
        // expected output or a fixture-supplied passage replacement.
        fixture.passages = vec![FixturePassage {
            id: 1,
            kind: "finance_review_snapshot".into(),
            source_key: passage["id"].as_str().context("source id missing")?.into(),
            version: passage["source_version"]
                .as_str()
                .context("source version missing")?
                .into(),
            passage_key: "result".into(),
            content_hash: {
                use sha2::{Digest, Sha256};
                format!(
                    "{:x}",
                    Sha256::digest(
                        passage["text"]
                            .as_str()
                            .context("passage missing")?
                            .as_bytes()
                    )
                )
            },
            text: passage["text"].as_str().context("passage missing")?.into(),
            effective_from_micros: None,
            effective_to_micros: None,
            applicability: vec![],
            status: "current".into(),
        }];
    }
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
        tool_name: tool_name.to_string(),
        capability: Capability::NamedRead,
        named_resource: Some(resource_name.to_string()),
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
            named_resources: vec![resource_name.to_string()],
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
        tool_name,
        request.scope,
        resource_name,
        dataset.environment_fingerprint(),
        &fixture.analytics_arguments,
        &serde_json::to_value(&fixture.analytics_output)?,
    );
    let analytics = FixtureAnalytics {
        capability: tool_name.to_string(),
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
        program_ref: program_ref.to_string(),
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
    .run(&graph, &context)
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
        "runtime did not consume the exact pinned provider transcript: stop={:?}, trace={:?}",
        result.stop,
        result.trace
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
            "programRef": program_ref, "provider": FIXTURE_PROVIDER,
            "capabilityEvidence": [evidence], "certificationEnvironmentId": request.environment.id,
            "policyEvidence": {"decisionHashes": &decision.hashes, "outcome": decision.outcome},
        })),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn finance_request(key: &str, input: Value, sources: Value) -> CandidateExecutionRequest {
        let mut request = request();
        let spec = lumiere_finance_review_core::skill(key).unwrap();
        request.version.skill_key = key.into();
        request.version.version = lumiere_finance_review_core::VERSION.into();
        request.version.source_hash = crate::harness::finance_skills::bundle_hash(key);
        request.version.resources = vec![spec.resource.into()];
        request.version.output_types = vec![spec.output.into()];
        request.version.max_steps = 5;
        request.version.max_tool_calls = 1;
        request.input = json!({"inputs":input});
        let observation =
            lumiere_finance_review_core::fixture_observation(key, 1, 1, &input, &sources).unwrap();
        let response = json!({"schemaVersion":1,"skillKey":key,"organizationId":1,"companyId":1,"observedAt":chrono::DateTime::from_timestamp_micros(1000).unwrap().to_rfc3339(),"observation":observation});
        let (_, passage) =
            crate::tools::finance_review::output(key, 1, 1, request.fixture_id, &input, response)
                .unwrap();
        let content = "The snapshot records finance review evidence.";
        let draft = json!({"content":content,"citations":[{"kind":passage["kind"],"id":passage["id"]}],"claims":[{"text":content,"supports":[{"kind":passage["kind"],"id":passage["id"],"source_version":passage["source_version"],"passage_key":"result"}]}],"calculations":[]});
        request.environment.dataset = json!({spec.resource:{"organizationId":1,"companyId":1,"data":{
            "financeSource":sources,"analyticsArguments":input,"analyticsOutput":{"summary":"ignored fixture placeholder","data":{},"citations":[],"row_count":0},
            "decisions":[{"decisionType":{"name":"ClaimEvidenceSupport","version":1},"response":{"kind":"choice","choice":"supported","probability":null,"confidence":1,"score":null,"rationale":"Synthetic review","model":"fixture","provider":"fixture","input_tokens":0,"output_tokens":0}}],
            "generations":[{"format":crate::harness::finance_skills::FORMAT,"response":{"content":serde_json::to_string(&draft).unwrap(),"provider":"fixture","model":"fixture","input_tokens":0,"output_tokens":0}}],
            "reasoning":[],"passages":[],"asOfMicros":1000
        }}});
        request
    }

    fn finance_cases() -> Vec<(&'static str, Value, Value)> {
        let mut preview: Value = serde_json::from_str(include_str!(
            "../harness/finance_review/fixtures/receivables.json"
        ))
        .unwrap();
        preview["scope"]["organizationId"] = json!(1);
        preview["scope"]["companyId"] = json!(1);
        let mut baseline = preview.clone();
        // Preserve the exact full owner envelope while moving its reporting day.
        for object in ["scope", "sourceWatermark"] {
            let text = serde_json::to_string(&baseline[object])
                .unwrap()
                .replace("2026-10-25", "2026-10-24")
                .replace("2026-10-26", "2026-10-25")
                .replace("2026-10-27", "2026-10-26");
            baseline[object] = serde_json::from_str(&text).unwrap();
        }
        vec![
            (
                "finance_report_review",
                json!({"reportKey":"customer_balances_v1","date":"2026-10-26","timezone":"Africa/Kigali"}),
                json!({"preview":preview.clone()}),
            ),
            (
                "bank_reconciliation_review",
                json!({"statementId":1}),
                json!({"statements":[{"id":1,"organizationId":1,"companyId":1,"currencyId":1,"state":"Open","date":0,"balanceStart":0,"balanceEnd":0}],"lines":[],"candidates":[],"invoices":[],"payments":[]}),
            ),
            (
                "period_close_review",
                json!({"periodId":1}),
                json!({"periods":[{"id":1,"organizationId":1,"companyId":1,"state":"Open","dateFrom":0,"dateTo":2000}],"moves":[],"statements":[],"lines":[]}),
            ),
            (
                "expense_evidence_review",
                json!({"recordKind":"expense","recordId":1}),
                json!({"record":{"id":1,"organizationId":1,"companyId":1,"totalAmount":10,"currencyId":1,"date":0},"source":{"status":"unavailable_extraction"}}),
            ),
            (
                "finance_variance_review",
                json!({"reportKey":"customer_balances_v1","actualDate":"2026-10-26","baselineDate":"2026-10-25","timezone":"Africa/Kigali"}),
                json!({"actual":preview,"baseline":baseline}),
            ),
        ]
    }

    #[tokio::test]
    async fn all_five_finance_programs_execute_actual_projections_and_release_only_reviewed_claims()
    {
        use crate::harness::release_registry::{CandidateCertificationInputs, CandidateFixture};
        for (key, input, sources) in finance_cases() {
            let request = finance_request(key, input, sources);
            let candidate = CandidateCertificationInputs {
                version: request.version.clone(),
                fixture: CandidateFixture {
                    id: request.fixture_id,
                    organization_id: 1,
                    skill_id: 11,
                    fixture_key: request.fixture_key.clone(),
                    input: request.input.clone(),
                    expected_output: json!({"summary":"must never be copied"}),
                },
            };
            let result = crate::harness::certification::CandidateAdapterRegistry::production()
                .execute(candidate, request.environment, 1, 1)
                .await
                .unwrap();
            assert_eq!(
                result.actual_output["status"], "completed",
                "{key}: {:?}",
                result.actual_output
            );
            assert_eq!(result.actual_output["capabilityCalls"], 1);
            assert_eq!(result.actual_output["steps"].as_array().unwrap().len(), 3);
            assert_eq!(result.metadata.as_ref().unwrap()["billableCalls"], 0);
        }
    }

    #[tokio::test]
    async fn finance_semantic_rejection_withholds_prose_for_every_skill() {
        for (key, input, sources) in finance_cases() {
            let mut request = finance_request(key, input, sources);
            let spec = lumiere_finance_review_core::skill(key).unwrap();
            request.environment.dataset[spec.resource]["data"]["decisions"][0]["response"]
                ["choice"] = json!("unsupported");
            let result = execute_finance(request).await.unwrap();
            assert_eq!(result.actual_output["status"], "review_required");
            assert!(result.actual_output["summary"].is_null());
        }
    }
    use crate::harness::{
        certification::{
            report_analysis_certification_bundle_hash, REPORT_ANALYSIS_CERTIFICATION_VERSION,
        },
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
                version: REPORT_ANALYSIS_CERTIFICATION_VERSION.into(),
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

    fn documented_response(key: &str) -> Value {
        let relative = match key {
            "report_analysis" => {
                include_str!("../../../erp-skills/report_analysis/references/response-example.md")
            }
            "finance_report_review" => include_str!(
                "../../../erp-skills/finance_report_review/references/response-example.md"
            ),
            _ => panic!("unknown pilot example"),
        };
        serde_json::from_str(
            relative
                .split("```json\n")
                .nth(1)
                .unwrap()
                .split("```")
                .next()
                .unwrap(),
        )
        .unwrap()
    }

    #[tokio::test]
    async fn documented_report_example_passes_the_actual_program_and_answer_gate() {
        let mut request = generated_report(0.1);
        data(&mut request)["generations"][0]["response"]["content"] =
            json!(serde_json::to_string(&documented_response("report_analysis")).unwrap());
        let result = execute_report_analysis(request).await.unwrap();
        assert_eq!(result.actual_output["status"], "completed");
        assert_eq!(
            result.actual_output["summary"],
            documented_response("report_analysis")["content"]
        );
    }

    #[tokio::test]
    async fn documented_finance_example_binds_to_real_owner_projection_and_answer_gate() {
        let mut preview: Value = serde_json::from_str(include_str!(
            "../harness/finance_review/fixtures/payables.json"
        ))
        .unwrap();
        assert_eq!(preview["report"]["totalOpen"]["minorUnits"], 16500);
        preview["scope"]["organizationId"] = json!(1);
        preview["scope"]["companyId"] = json!(1);
        let mut request = finance_request(
            "finance_report_review",
            json!({"reportKey":"supplier_payables_v1","date":"2026-10-26","timezone":"Africa/Kigali"}),
            json!({"preview":preview}),
        );
        let spec = lumiere_finance_review_core::skill("finance_report_review").unwrap();
        let generation = &mut request.environment.dataset[spec.resource]["data"]["generations"][0]
            ["response"]["content"];
        let actual: Value = serde_json::from_str(generation.as_str().unwrap()).unwrap();
        let mut example = documented_response("finance_report_review");
        // The example's placeholders are never evidence. Bind them to this
        // actual owner projection, exactly as a live model must copy its passage.
        example["claims"][0]["supports"] = actual["claims"][0]["supports"].clone();
        *generation = json!(serde_json::to_string(&example).unwrap());
        let result = execute_finance(request).await.unwrap();
        assert_eq!(
            result.actual_output["status"], "completed",
            "{:?}",
            result.actual_output
        );
        // The real gate qualifies this fixture because its passage lacks effective
        // dates. Preserve that limitation rather than treating generation as proof.
        let summary = result.actual_output["summary"].as_str().unwrap();
        assert!(summary.starts_with(example["content"].as_str().unwrap()));
        assert!(summary.contains("effective dates are not recorded"));
    }

    #[test]
    fn proposed_manifest_and_dev_fixture_bind_the_current_report_bundle() {
        let manifest: Value = serde_json::from_str(include_str!(
            "../../../infra/railway/pilots/report-analysis-certification-manifest.proposed.json"
        ))
        .unwrap();
        let bundle = report_analysis_certification_bundle_hash();
        assert_eq!(manifest["source_hash"], bundle);
        assert_eq!(manifest["version"], REPORT_ANALYSIS_CERTIFICATION_VERSION);
        let seed = include_str!("../../../spacetimedb/src/seed.rs");
        assert!(seed.contains(&format!("\"{bundle}\".to_string()")));
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
        candidate.version.version = "1.0.0".into();
        assert!(matches!(
            registry
                .execute(candidate.clone(), request.environment.clone(), 1, 1)
                .await,
            Err(CertificationExecutionError::UnsupportedSkill { .. })
        ));
        candidate.version.version = REPORT_ANALYSIS_CERTIFICATION_VERSION.into();
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

    fn generated_report(probability: f64) -> CandidateExecutionRequest {
        let mut request = request();
        let fixture = data(&mut request);
        fixture["decisions"][0]["response"]["probability"] = json!(probability);
        fixture["decisions"][0]["response"]["confidence"] = json!(0.9);
        let draft = fixture["reasoning"][0].clone();
        fixture["reasoning"] = json!([]);
        let format = if probability < 0.35 {
            "concise factual analytics summary"
        } else {
            "concise report highlighting anomalies, material changes, and concrete follow-up questions"
        };
        let mut draft = draft;
        draft.as_object_mut().unwrap().remove("outcome");
        fixture["generations"] = json!([{
            "format": format,
            "response": {"content": serde_json::to_string(&draft).unwrap(),
                "provider": "fixture", "model": "fixture", "input_tokens": 0, "output_tokens": 0}
        }]);
        request
    }

    #[tokio::test]
    async fn both_generation_routes_release_structured_evidence_checked_prose() {
        for probability in [0.1, 0.9] {
            let execution = execute_report_analysis(generated_report(probability))
                .await
                .unwrap();
            assert_eq!(execution.actual_output["status"], "completed");
            assert_eq!(
                execution.actual_output["summary"],
                "This synthetic report has no overdue items."
            );
            let steps = execution.actual_output["steps"].as_array().unwrap();
            assert_eq!(steps.last().unwrap()["kind"], "generate");
            assert!(!execution.actual_output["summary"]
                .as_str()
                .unwrap()
                .starts_with('{'));
        }
    }

    fn generated_snapshot_report(citation_id: &str) -> CandidateExecutionRequest {
        let mut request = generated_report(0.1);
        let snapshot_id = format!("run:{}:stock_movement_by_state", request.fixture_id);
        let fixture = data(&mut request);
        let passage =
            &mut fixture["analyticsOutput"]["data"]["artifacts"][0]["artifacts"]["evidencePassage"];
        passage["kind"] = json!("analytics_snapshot");
        passage["id"] = json!(snapshot_id);
        fixture["passages"][0]["kind"] = json!("analytics_snapshot");
        fixture["passages"][0]["sourceKey"] = json!(snapshot_id);
        let mut draft: Value = serde_json::from_str(
            fixture["generations"][0]["response"]["content"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
        draft["claims"][0]["supports"][0]["kind"] = json!("analytics_snapshot");
        draft["claims"][0]["supports"][0]["id"] = json!(snapshot_id);
        draft["citations"] = json!([{ "kind": "analytics_snapshot", "id": citation_id }]);
        fixture["generations"][0]["response"]["content"] =
            json!(serde_json::to_string(&draft).unwrap());
        request
    }

    #[tokio::test]
    async fn recorded_snapshot_citations_reach_independent_claim_review() {
        let mut request = generated_snapshot_report("run:5:stock_movement_by_state");
        let execution = execute_report_analysis(request.clone()).await.unwrap();
        assert_eq!(execution.actual_output["status"], "completed");
        data(&mut request)["decisions"][1]["response"]["choice"] = json!("unsupported");
        let execution = execute_report_analysis(request).await.unwrap();
        assert_ne!(execution.actual_output["status"], "completed");
        assert!(execution.actual_output["summary"].is_null());
    }

    #[tokio::test]
    async fn generated_claims_still_need_independent_semantic_support() {
        let mut request = generated_report(0.1);
        data(&mut request)["decisions"][1]["response"]["choice"] = json!("unsupported");
        let execution = execute_report_analysis(request).await.unwrap();
        assert_ne!(execution.actual_output["status"], "completed");
        assert!(execution.actual_output["summary"].is_null());
    }

    #[tokio::test]
    async fn reports_cannot_cite_another_runs_observation_or_hide_unchecked_prose() {
        for generated in [false, true] {
            let mut request = if generated {
                generated_report(0.1)
            } else {
                request()
            };
            data(&mut request)["analyticsOutput"]["data"]["artifacts"][0]["artifacts"] = json!({});
            let error = execute_report_analysis(request).await.unwrap_err();
            assert!(error.to_string().contains("outside this run"));
        }
        let mut request = generated_report(0.1);
        let raw = data(&mut request)["generations"][0]["response"]["content"]
            .as_str()
            .unwrap()
            .to_string();
        let mut draft: Value = serde_json::from_str(&raw).unwrap();
        draft["content"] =
            json!("This synthetic report has no overdue items. Profits will double.");
        data(&mut request)["generations"][0]["response"]["content"] =
            json!(serde_json::to_string(&draft).unwrap());
        assert!(execute_report_analysis(request)
            .await
            .unwrap_err()
            .to_string()
            .contains("complete answer"));
    }

    #[tokio::test]
    async fn a_claimless_generation_is_held_for_review() {
        let mut claimless = request();
        data(&mut claimless)["decisions"]
            .as_array_mut()
            .unwrap()
            .truncate(1);
        data(&mut claimless)["decisions"][0]["response"]["confidence"] = json!(0.9);
        data(&mut claimless)["decisions"][0]["response"]["probability"] = json!(0.9);
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
