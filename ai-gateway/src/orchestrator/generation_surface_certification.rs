//! Source certification of the three catalogued generation routes.
//!
//! Replays an immutable synthetic provider transcript through the SAME
//! generation-only GovernedProgramExecutor and route validators. No AppState,
//! provider credentials, live database, spend authority or expected fixture
//! output enters this module. This is not provider/account qualification.

use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

use anyhow::{ensure, Context, Result};
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{
    harness::{
        certification::{CandidateExecution, CandidateExecutionRequest},
        certification_fixtures::{ImmutableCertificationDataset, MAX_CERTIFICATION_OUTPUT_BYTES},
        manifest::{
            ExecutionLimits, PrivacyPolicy, ReviewMetadata, ReviewStatus, RiskClass, SkillManifest,
            SkillVersionRef,
        },
        release_registry::candidate_policy_manifest,
    },
    routes::{actions, forms},
};

use super::{
    governed_program::{
        run_generation_only_program, GovernedProgramContext, NoopIntelligenceEventRecorder,
    },
    governed_programs::governed_program_for_skill,
    intelligence::{
        DecisionProvider, DecisionRequest, DecisionResponse, GenerationProvider, GenerationRequest,
        GenerationResponse, GenerationResponseFormat,
    },
    output_gate::{admit_structured_output, GeneratedOutputDraft},
    text_answer_gate::TextEvidence,
};

pub(crate) const KEYS: [&str; 3] = [
    "rag_generation",
    "form_suggestion",
    "action_draft_generation",
];
pub(crate) const VERSION: &str = "1.0.2";

// Release helpers below the route modules and the local crates that implement
// scoped reads/authentication. Explicit at compile time; never filesystem discovery.
const RELEASE_HELPERS: &[(&str, &[u8])] = &[
    (
        "evidence_inspector.rs",
        include_bytes!("evidence_inspector.rs"),
    ),
    (
        "guide_source_authority.rs",
        include_bytes!("guide_source_authority.rs"),
    ),
    ("agent_loop.rs", include_bytes!("agent_loop.rs")),
    ("ai_spend.rs", include_bytes!("../ai_spend.rs")),
    ("state.rs", include_bytes!("../state.rs")),
    ("qdrant_client.rs", include_bytes!("../qdrant_client.rs")),
    ("audit.rs", include_bytes!("../harness/audit.rs")),
    ("rag_context.rs", include_bytes!("../routes/rag_context.rs")),
    (
        "rag_conversation.rs",
        include_bytes!("../routes/rag_conversation.rs"),
    ),
    (
        "rag_history_references.rs",
        include_bytes!("../routes/rag_history_references.rs"),
    ),
    (
        "rag_spreadsheet.rs",
        include_bytes!("../routes/rag_spreadsheet.rs"),
    ),
    (
        "rag_import_tasks.rs",
        include_bytes!("../routes/rag_import_tasks.rs"),
    ),
    ("evidence.rs", include_bytes!("../routes/evidence.rs")),
    (
        "guide_retrieval.rs",
        include_bytes!("../routes/guide_retrieval.rs"),
    ),
    (
        "retrieval_policy.rs",
        include_bytes!("../retrieval_policy.rs"),
    ),
    ("stdb_embed.rs", include_bytes!("../stdb_embed.rs")),
    ("snapshot.rs", include_bytes!("../harness/snapshot.rs")),
    ("harness/mod.rs", include_bytes!("../harness/mod.rs")),
    (
        "action_draft_bridge.rs",
        include_bytes!("../harness/action_draft_bridge.rs"),
    ),
    (
        "entity_registry.rs",
        include_bytes!("../harness/entity_registry.rs"),
    ),
    ("error.rs", include_bytes!("../error.rs")),
    ("Cargo.toml", include_bytes!("../../../Cargo.toml")),
    ("ai-gateway/Cargo.toml", include_bytes!("../../Cargo.toml")),
    (
        "auth-context/Cargo.toml",
        include_bytes!("../../../crates/auth-context/Cargo.toml"),
    ),
    (
        "auth-context/lib.rs",
        include_bytes!("../../../crates/auth-context/src/lib.rs"),
    ),
    (
        "stdb-client/Cargo.toml",
        include_bytes!("../../../crates/stdb-client/Cargo.toml"),
    ),
    (
        "stdb-client/lib.rs",
        include_bytes!("../../../crates/stdb-client/src/lib.rs"),
    ),
    (
        "stdb-client/contract.rs",
        include_bytes!("../../../crates/stdb-client/src/contract.rs"),
    ),
    (
        "stdb-client/generated_reducer_contract.rs",
        include_bytes!("../../../crates/stdb-client/src/generated_reducer_contract.rs"),
    ),
    (
        "stdb-auth/Cargo.toml",
        include_bytes!("../../../crates/stdb-auth/Cargo.toml"),
    ),
    (
        "stdb-auth/lib.rs",
        include_bytes!("../../../crates/stdb-auth/src/lib.rs"),
    ),
    (
        "stdb-auth/field_policy.rs",
        include_bytes!("../../../crates/stdb-auth/src/field_policy.rs"),
    ),
    (
        "stdb-auth/resource_registry.rs",
        include_bytes!("../../../crates/stdb-auth/src/resource_registry.rs"),
    ),
    (
        "stdb-auth/erp_subscriptions.rs",
        include_bytes!("../../../crates/stdb-auth/src/erp_subscriptions.rs"),
    ),
    (
        "stdb-config/Cargo.toml",
        include_bytes!("../../../crates/stdb-config/Cargo.toml"),
    ),
    (
        "stdb-config/lib.rs",
        include_bytes!("../../../crates/stdb-config/src/lib.rs"),
    ),
    (
        "policy-core/Cargo.toml",
        include_bytes!("../../../crates/policy-core/Cargo.toml"),
    ),
    (
        "policy-core/lib.rs",
        include_bytes!("../../../crates/policy-core/src/lib.rs"),
    ),
    (
        "policy-core/additional_tenant.rs",
        include_bytes!("../../../crates/policy-core/src/additional_tenant.rs"),
    ),
    (
        "policy-core/expense_allocations.rs",
        include_bytes!("../../../crates/policy-core/src/expense_allocations.rs"),
    ),
];

pub(crate) fn manifest(key: &str) -> Result<SkillManifest, String> {
    if !KEYS.contains(&key) {
        return Err(format!("unsupported generation surface '{key}'"));
    }
    Ok(SkillManifest {
        skill: SkillVersionRef::new(key, 1),
        review: ReviewMetadata {
            status: ReviewStatus::Promoted,
            reviewed_by: "compiled-generation-surface".into(),
            reviewed_at: "2026-10-31T00:00:00Z".into(),
        },
        risk: RiskClass::Green,
        // A synthetic fixture envelope, not permission to read a live resource.
        named_resources: vec![format!("generation.{key}.fixture.v1")],
        allowed_tools: vec![],
        allowed_capabilities: vec![],
        output_type: format!("generation.{key}.result.v1"),
        limits: ExecutionLimits {
            max_rows: 20,
            max_steps: 3,
            max_tool_calls: 1,
        },
        privacy: PrivacyPolicy::new(["status", "result"]),
    })
}

/// Length-delimited source bundle, including the exact surface prompt, shared
/// executor, route admission and release owners. Changing any input invalidates
/// the current source certificate. Version compatibility alone is insufficient.
pub(crate) fn bundle_hash(key: &str) -> Result<String, String> {
    let prompt: &[u8] = match key {
        "rag_generation" => include_bytes!("../../../erp-skills/rag_generation/SKILL.md"),
        "form_suggestion" => include_bytes!("../../../erp-skills/form_suggestion/SKILL.md"),
        "action_draft_generation" => {
            include_bytes!("../../../erp-skills/action_draft_generation/SKILL.md")
        }
        _ => return Err(format!("unsupported generation surface '{key}'")),
    };
    let mut hash = Sha256::new();
    for part in [
        key.as_bytes(),
        prompt,
        include_bytes!("generation_surface_certification.rs"),
        include_bytes!("governed_program.rs"),
        include_bytes!("governed_programs.rs"),
        include_bytes!("governed_services.rs"),
        include_bytes!("intelligence.rs"),
        include_bytes!("intelligence_adapters.rs"),
        include_bytes!("intelligence_router.rs"),
        include_bytes!("answer_gate.rs"),
        include_bytes!("text_answer_gate.rs"),
        include_bytes!("output_gate.rs"),
        include_bytes!("evidence_recorder.rs"),
        include_bytes!("reviewed_claims.rs"),
        include_bytes!("decision_graph.rs"),
        include_bytes!("decision_type.rs"),
        include_bytes!("precedent.rs"),
        include_bytes!("probabilistic.rs"),
        include_bytes!("invocation_policy.rs"),
        include_bytes!("skill_loader.rs"),
        include_bytes!("model_configuration.rs"),
        include_bytes!("spend_admission.rs"),
        include_bytes!("../ai_agent.rs"),
        include_bytes!("../providers/llm.rs"),
        include_bytes!("../routes/forms.rs"),
        include_bytes!("../routes/actions.rs"),
        include_bytes!("../routes/rag.rs"),
        include_bytes!("../routes/rag_ui_actions.rs"),
        include_bytes!("../routes/passage_retrieval.rs"),
        include_bytes!("../harness/certification.rs"),
        include_bytes!("../harness/certification_fixtures.rs"),
        include_bytes!("../harness/release_registry.rs"),
        include_bytes!("../harness/manifest.rs"),
        include_bytes!("../harness/privacy_guard.rs"),
        include_bytes!("../harness/policy_engine.rs"),
        include_bytes!("../harness/data_scope_resolver.rs"),
        include_bytes!("../skills/md_loader.rs"),
        include_bytes!("../../../Cargo.lock"),
    ] {
        hash.update((part.len() as u64).to_be_bytes());
        hash.update(part);
    }
    for (name, bytes) in RELEASE_HELPERS {
        for part in [name.as_bytes(), *bytes] {
            hash.update((part.len() as u64).to_be_bytes());
            hash.update(part);
        }
    }
    Ok(format!("{hash:x}", hash = hash.finalize()))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Fixture {
    generation: RecordedGeneration,
    #[serde(default)]
    reviews: Vec<RecordedReview>,
    #[serde(default)]
    passages: Vec<RecordedPassage>,
    #[serde(default)]
    deny_evidence: bool,
    #[serde(default)]
    access_transcript: Vec<RecordedAccess>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RecordedGeneration {
    format: String,
    response: GenerationResponse,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RecordedReview {
    // Bind every reply to the actual requested claim and passage text, rather
    // than letting a generic "supported" stub attest to arbitrary claims.
    bounded_state: Value,
    response: DecisionResponse,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RecordedPassage {
    passage: Value,
    version: Value,
    source: Value,
}

#[derive(Deserialize)]
#[serde(tag = "kind", deny_unknown_fields, rename_all = "camelCase")]
enum RecordedAccess {
    Grant {
        organization_id: u64,
        company_id: u64,
        // None is an explicit revocation, not a default grant.
        bounds: Option<RecordedBounds>,
    },
    Passage {
        organization_id: u64,
        company_id: u64,
        passage_id: u64,
        chain: Option<RecordedPassage>,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RecordedBounds {
    max_rows: u64,
    max_bytes: u64,
}

struct Providers {
    generation: Mutex<Option<RecordedGeneration>>,
    reviews: Mutex<VecDeque<RecordedReview>>,
}

#[async_trait]
impl GenerationProvider for Providers {
    async fn generate(&self, request: GenerationRequest) -> Result<GenerationResponse> {
        request.validate()?;
        ensure!(
            request.response_format == GenerationResponseFormat::Text,
            "unexpected generation response contract"
        );
        let mut recorded = self
            .generation
            .lock()
            .map_err(|_| anyhow::anyhow!("fixture lock poisoned"))?
            .take()
            .context("generation transcript exhausted")?;
        ensure!(
            request.format == recorded.format,
            "generation format differs from the compiled route"
        );
        ensure!(
            !recorded.response.content.trim().is_empty(),
            "empty fixture generation"
        );
        ensure!(
            recorded.response.content.len() <= MAX_CERTIFICATION_OUTPUT_BYTES,
            "fixture generation exceeds its byte bound"
        );
        recorded.response.provider = "certification-fixture".into();
        recorded.response.model = "immutable-transcript-v1".into();
        recorded.response.input_tokens = 0;
        recorded.response.output_tokens = 0;
        Ok(recorded.response)
    }
}

#[async_trait]
impl DecisionProvider for Providers {
    async fn decide(&self, request: DecisionRequest) -> Result<DecisionResponse> {
        request.validate()?;
        ensure!(
            request.decision_type.name == super::answer_gate::CLAIM_SUPPORT_DECISION_TYPE,
            "unexpected review decision type"
        );
        let mut recorded = self
            .reviews
            .lock()
            .map_err(|_| anyhow::anyhow!("fixture lock poisoned"))?
            .pop_front()
            .context("review transcript exhausted")?;
        ensure!(
            recorded.bounded_state == request.bounded_state,
            "review transcript claim or passages differ"
        );
        recorded.response.validate_against(&request)?;
        recorded.response.provider = "certification-fixture".into();
        recorded.response.model = "immutable-transcript-v1".into();
        recorded.response.input_tokens = 0;
        recorded.response.output_tokens = 0;
        Ok(recorded.response)
    }
}

pub(crate) async fn execute(request: CandidateExecutionRequest) -> Result<CandidateExecution> {
    let key = request.version.skill_key.as_str();
    ensure!(
        request.version.source_hash == bundle_hash(key).map_err(anyhow::Error::msg)?,
        "candidate source differs from compiled runtime"
    );
    ensure!(
        request.version.organization_id == request.scope.organization_id,
        "candidate organization differs"
    );
    let canonical = manifest(key).map_err(anyhow::Error::msg)?;
    ensure!(
        request.version.resources == canonical.named_resources
            && request.version.output_types == vec![canonical.output_type.clone()]
            && request.version.permissions.is_empty(),
        "candidate generation contract differs from compiled manifest"
    );
    let manifest = candidate_policy_manifest(&request.version).map_err(anyhow::Error::msg)?;
    ensure!(
        manifest.limits.max_steps <= canonical.limits.max_steps
            && manifest.limits.max_tool_calls <= canonical.limits.max_tool_calls,
        "candidate generation limits exceed compiled bounds"
    );
    ensure!(
        request.version.risk == RiskClass::Green,
        "generation source fixture cannot grant elevated authority"
    );
    let dataset = ImmutableCertificationDataset::parse(
        request.scope,
        &request.version.resources,
        &request.environment,
    )?;
    let fixture: Fixture = serde_json::from_value(
        dataset
            .resource(&manifest.named_resources[0])?
            .value()
            .clone(),
    )
    .context("invalid immutable generation fixture")?;
    ensure!(
        fixture.reviews.len() <= 20
            && fixture.passages.len() <= 20
            && fixture.access_transcript.len() <= 64,
        "fixture transcript exceeds bound"
    );
    ensure!(
        serde_json::to_vec(&request.input)?.len() <= 64_000,
        "fixture input exceeds bound"
    );
    let objective = request
        .input
        .get("query")
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
        .context("fixture query is required")?;
    let providers = Providers {
        generation: Mutex::new(Some(fixture.generation)),
        reviews: Mutex::new(fixture.reviews.into()),
    };
    let catalog =
        governed_program_for_skill(key).context("generation surface is not catalogued")?;
    let context = GovernedProgramContext {
        organization_id: request.scope.organization_id,
        company_id: request.scope.company_id,
        run_id: request.fixture_id,
        program_ref: catalog.program_ref.into(),
        objective: objective.into(),
        bounded_state: request.input.clone(),
        evidence: vec![],
        generation_instructions: None,
        generation_max_tokens: Some(2048),
    };
    let outcome = run_generation_only_program(
        &catalog.graph,
        &context,
        &providers,
        None,
        &NoopIntelligenceEventRecorder,
    )
    .await?;
    ensure!(
        outcome.trace.len() <= manifest.limits.max_steps as usize,
        "immutable execution step limit exceeded"
    );
    ensure!(
        outcome.capability_calls == 0,
        "generation fixture cannot execute capabilities"
    );
    let content = outcome
        .released_content()
        .context("generation draft was not released to route validation")?;
    let result = match key {
        "form_suggestion" => {
            ensure!(
                fixture.passages.is_empty()
                    && !fixture.deny_evidence
                    && fixture.access_transcript.is_empty(),
                "form fixture cannot request passage access"
            );
            let fields: Vec<forms::FormField> = serde_json::from_value(
                request
                    .input
                    .get("fields")
                    .cloned()
                    .context("form fields required")?,
            )?;
            let raw: Value = serde_json::from_str(forms::clean_json_response(content))?;
            serde_json::to_value(forms::parse_generated_suggestions(
                &fields,
                request.input.get("raw_text").and_then(Value::as_str),
                &raw,
            ))?
        }
        "action_draft_generation" => {
            ensure!(
                fixture.passages.is_empty()
                    && !fixture.deny_evidence
                    && fixture.access_transcript.is_empty(),
                "action fixture cannot request passage access"
            );
            let req = actions::ActionDraftRequest {
                org_id: Some(request.scope.organization_id),
                company_id: request.scope.company_id,
                query: objective.into(),
                ui_context: None,
                allowed_reducers: serde_json::from_value(
                    request
                        .input
                        .get("allowed_reducers")
                        .cloned()
                        .context("allowed reducers required")?,
                )?,
                allowed_entity_types: vec![],
                agent_id: None,
                team_member_id: None,
                stdb_token: String::new(),
                identity_hex: String::new(),
            };
            let entries = actions::allowed_catalog_entries(&req.allowed_reducers)
                .map_err(anyhow::Error::msg)?;
            let raw: Value = serde_json::from_str(forms::clean_json_response(content))?;
            let mut drafts =
                actions::parse_llm_drafts(&req, &entries, &raw).map_err(anyhow::Error::msg)?;
            actions::require_generated_drafts(&drafts).map_err(anyhow::Error::msg)?;
            let mut evidence = TextEvidence::default();
            evidence.add_user_text(objective);
            for draft in &mut drafts {
                let gated = admit_structured_output(
                    request.scope.organization_id,
                    request.scope.company_id,
                    &GeneratedOutputDraft::single_claim(
                        draft.summary.clone(),
                        evidence.refs.clone(),
                    ),
                    &evidence,
                )
                .await?;
                draft.explanation_verification = gated.verification;
                draft.explanation_provenance = gated.provenance;
                draft.summary = gated.released.unwrap_or_else(|| {
                    "Action draft explanation withheld pending evidence review.".into()
                });
            }
            json!({"drafts": drafts})
        }
        "rag_generation" => {
            execute_rag(
                &request,
                content,
                fixture.passages,
                fixture.deny_evidence,
                fixture.access_transcript,
                &providers,
            )
            .await?
        }
        _ => anyhow::bail!("unsupported generation surface"),
    };
    ensure!(
        providers
            .generation
            .lock()
            .map_err(|_| anyhow::anyhow!("fixture lock poisoned"))?
            .is_none()
            && providers
                .reviews
                .lock()
                .map_err(|_| anyhow::anyhow!("fixture lock poisoned"))?
                .is_empty(),
        "unused fixture transcript"
    );
    let actual_output = json!({"status":"completed", "result":result});
    ensure!(
        serde_json::to_vec(&actual_output)?.len() <= MAX_CERTIFICATION_OUTPUT_BYTES,
        "generation output exceeds bound"
    );
    Ok(CandidateExecution {
        actual_output,
        executor_run_id: None,
        metadata: Some(json!({
            "executionMode":"immutable_fixture_replay", "billableCalls":0,
            "provider":"certification-fixture", "programRef":catalog.program_ref,
            "certificationEnvironmentId":request.environment.id,
            "environmentFingerprint":dataset.environment_fingerprint(),
            "sourceHash":request.version.source_hash,
            "providerAcceptance":false, "durableProductionProvenance":false,
        })),
    })
}

struct FixtureAccess {
    transcript: Mutex<VecDeque<RecordedAccess>>,
    invalid_call: AtomicBool,
}

impl FixtureAccess {
    fn next(
        &self,
        scope: crate::routes::passage_retrieval::EvidenceScope,
        id: Option<u64>,
    ) -> Result<RecordedAccess> {
        let mut transcript = self
            .transcript
            .lock()
            .map_err(|_| anyhow::anyhow!("fixture access lock poisoned"))?;
        let matches = match transcript.front() {
            Some(RecordedAccess::Grant {
                organization_id,
                company_id,
                ..
            }) => {
                id.is_none()
                    && *organization_id == scope.organization_id
                    && *company_id == scope.company_id
            }
            Some(RecordedAccess::Passage {
                organization_id,
                company_id,
                passage_id,
                ..
            }) => {
                id == Some(*passage_id)
                    && *organization_id == scope.organization_id
                    && *company_id == scope.company_id
            }
            None => false,
        };
        if !matches {
            self.invalid_call.store(true, Ordering::Relaxed);
            anyhow::bail!("access transcript call kind, scope or passage id differs");
        }
        transcript
            .pop_front()
            .context("access transcript exhausted")
    }

    fn require_exhausted(&self) -> Result<()> {
        ensure!(
            !self.invalid_call.load(Ordering::Relaxed)
                && self
                    .transcript
                    .lock()
                    .map_err(|_| anyhow::anyhow!("fixture access lock poisoned"))?
                    .is_empty(),
            "unused fixture access transcript"
        );
        Ok(())
    }
}

#[async_trait]
impl crate::routes::passage_retrieval::EvidenceAccess for FixtureAccess {
    async fn grant_bounds(
        &self,
        scope: crate::routes::passage_retrieval::EvidenceScope,
    ) -> crate::error::AppResult<crate::routes::evidence::CapabilityGrantBounds> {
        let denied = || {
            crate::error::AppError::Forbidden(
                "immutable fixture grant transcript denied or mismatched".into(),
            )
        };
        let RecordedAccess::Grant {
            organization_id,
            company_id,
            bounds,
        } = self.next(scope, None).map_err(|_| denied())?
        else {
            return Err(denied());
        };
        if scope.organization_id != organization_id || scope.company_id != company_id {
            return Err(denied());
        }
        let bounds = bounds.ok_or_else(denied)?;
        Ok(crate::routes::evidence::CapabilityGrantBounds {
            max_rows: bounds.max_rows,
            max_bytes: bounds.max_bytes,
        })
    }

    async fn passage_chain(
        &self,
        scope: crate::routes::passage_retrieval::EvidenceScope,
        id: u64,
    ) -> Result<Option<crate::routes::passage_retrieval::PassageChain>> {
        let RecordedAccess::Passage {
            organization_id,
            company_id,
            passage_id,
            chain,
        } = self.next(scope, Some(id))?
        else {
            anyhow::bail!("expected passage read transcript");
        };
        ensure!(
            scope.organization_id == organization_id
                && scope.company_id == company_id
                && id == passage_id,
            "fixture passage read scope or id differs"
        );
        Ok(
            chain.map(|p| crate::routes::passage_retrieval::PassageChain {
                passage: p.passage,
                version: p.version,
                source: p.source,
            }),
        )
    }
}

struct FixtureAdmission<'a> {
    scope: crate::routes::passage_retrieval::EvidenceScope,
    providers: &'a Providers,
}

#[async_trait]
impl crate::routes::rag::RagAnswerAdmission for FixtureAdmission<'_> {
    async fn admit(
        &self,
        candidate: &str,
        evidence: &TextEvidence,
        passages: &[super::answer_gate::SourcePassage],
    ) -> Result<super::text_answer_gate::GatedTextAnswer> {
        let checker = super::answer_gate::DecisionClaimCoverageChecker {
            reviewer: self.providers,
        };
        super::text_answer_gate::gate_text_answer_with_passages(
            self.scope.organization_id,
            self.scope.company_id,
            candidate,
            evidence,
            passages,
            Some(&checker),
        )
        .await
    }
}

/// Synthetic provenance persistence, never written to a production evidence
/// graph. The actual route still requires this acknowledgement and performs its
/// before/after source rechecks. Metadata explicitly disclaims durable authority.
struct FixtureProvenance;

#[async_trait]
impl crate::routes::rag::RagProvenanceSink for FixtureProvenance {
    async fn record(
        &self,
        gated: &super::text_answer_gate::GatedTextAnswer,
    ) -> Result<(u64, Vec<u64>)> {
        ensure!(
            gated.released.is_some() && gated.is_passage_backed(),
            "fixture cannot persist withheld/unbacked answer"
        );
        ensure!(
            !gated.durable_provenance.claims.is_empty(),
            "fixture provenance has no assessed claims"
        );
        Ok((
            1,
            (1..=gated.durable_provenance.claims.len() as u64).collect(),
        ))
    }
}

async fn execute_rag(
    request: &CandidateExecutionRequest,
    content: &str,
    passages: Vec<RecordedPassage>,
    deny: bool,
    access_transcript: Vec<RecordedAccess>,
    providers: &Providers,
) -> Result<Value> {
    use crate::routes::{
        passage_retrieval::{authorize_and_resolve, EvidenceScope},
        rag,
    };
    let scope = EvidenceScope {
        organization_id: request.scope.organization_id,
        company_id: request.scope.company_id,
    };
    ensure!(!deny, "legacy fixture evidence denial");
    let access = FixtureAccess {
        transcript: Mutex::new(access_transcript.into()),
        invalid_call: AtomicBool::new(false),
    };
    let mut hits = Vec::new();
    for p in &passages {
        let id = p.passage["id"]
            .as_u64()
            .context("fixture passage id missing")?;
        ensure!(
            p.passage["organizationId"].as_u64() == Some(scope.organization_id)
                && p.passage["companyId"].as_u64() == Some(scope.company_id),
            "foreign fixture passage"
        );
        let hash = p.passage["contentHash"]
            .as_str()
            .context("fixture passage hash missing")?
            .to_string();
        hits.push(crate::qdrant_client::SearchResult {
            score: 1.0,
            record: crate::qdrant_client::SemanticIndexRecord {
                organization_id: scope.organization_id,
                company_id: scope.company_id,
                resource_kind: "ai_evidence_passage".into(),
                resource_id: id.to_string(),
                resource_version: hash.clone(),
                source_fingerprint: hash,
                embedding_model: "certification-fixture".into(),
                indexed_at: "immutable".into(),
                tags: vec![],
            },
        });
    }
    let evidence = authorize_and_resolve(&access, scope, &hits, &[], 20)
        .await
        .map_err(|error| anyhow::anyhow!("{error}"))?;
    // Invalid/withdrawn chains cannot silently turn a claimed passage-backed
    // positive fixture into an empty successful search.
    ensure!(
        evidence.passages.len() == hits.len(),
        "fixture evidence failed authoritative source resolution"
    );
    let query = request.input["query"]
        .as_str()
        .context("fixture query missing")?;
    let release = rag::release_rag_answer(
        &rag::ReleaseInputs::passage_backed(scope, 20, query, &[], &evidence),
        content,
        &FixtureAdmission { scope, providers },
        &FixtureProvenance,
        &access,
    )
    .await?;
    access.require_exhausted()?;
    // Do not publish synthetic persisted ids as if they were production ids.
    Ok(json!({
        "answer":release.answer,
        "verification":release.verification,
        "answerReleased":release.answer_released,
        "passagesDisclosed":release.passages_disclosed,
        "runFailure":release.run_failure,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harness::{
        certification::{CandidateAdapterRegistry, CertificationExecutionError},
        release_registry::{
            CandidateCertificationEnvironment, CandidateCertificationInputs, CandidateFixture,
            CandidateSkillVersion,
        },
    };

    fn candidate(
        key: &str,
        content: &str,
        input: Value,
    ) -> (
        CandidateCertificationInputs,
        CandidateCertificationEnvironment,
    ) {
        let manifest = manifest(key).unwrap();
        let graph = governed_program_for_skill(key).unwrap().graph;
        let format = graph
            .nodes
            .iter()
            .find_map(|node| match &node.kind {
                super::super::decision_graph::DecisionNode::Generate(generate) => {
                    Some(generate.format.clone())
                }
                _ => None,
            })
            .unwrap();
        let version = CandidateSkillVersion {
            id: 3,
            organization_id: 1,
            skill_id: 8,
            skill_key: key.into(),
            version: VERSION.into(),
            manifest_json: json!({}),
            source_hash: bundle_hash(key).unwrap(),
            risk: RiskClass::Green,
            max_steps: manifest.limits.max_steps,
            max_tool_calls: manifest.limits.max_tool_calls,
            permissions: vec![],
            resources: manifest.named_resources.clone(),
            output_types: vec![manifest.output_type],
        };
        let fixture = CandidateFixture {
            id: 5,
            organization_id: 1,
            skill_id: 8,
            fixture_key: format!("synthetic-{key}"),
            input,
            expected_output: json!({"privateExpectation":"must never become candidate output"}),
        };
        let environment = CandidateCertificationEnvironment {
            id: 13,
            organization_id: 1,
            skill_id: 8,
            fixture_id: 5,
            dataset: json!({manifest.named_resources[0].clone():{
                "organizationId":1,"companyId":2,"data":{
                    "generation":{"format":format,"response":{"content":content,"model":"recorded","provider":"synthetic","input_tokens":0,"output_tokens":0}}
                }
            }}),
            virtual_files: json!({}),
            environment_fingerprint: format!("sha256:{}", "e".repeat(64)),
        };
        (
            CandidateCertificationInputs { version, fixture },
            environment,
        )
    }

    fn data_mut(environment: &mut CandidateCertificationEnvironment) -> &mut Value {
        environment
            .dataset
            .as_object_mut()
            .unwrap()
            .values_mut()
            .next()
            .unwrap()
            .get_mut("data")
            .unwrap()
    }

    fn form() -> (
        CandidateCertificationInputs,
        CandidateCertificationEnvironment,
    ) {
        candidate(
            "form_suggestion",
            r#"{"suggestions":{"state":{"value":"open","confidence":0.9},"foreign":{"value":"secret"}},"validation_notes":[],"sources":[]}"#,
            json!({"query":"Suggest the observed state","fields":[{"name":"state","type":"select","options":[{"value":"open","label":"Open"}]}],"raw_text":"state: open"}),
        )
    }

    #[test]
    fn inventory_covers_release_children_and_local_authority_implementations() {
        for required in [
            "rag_context.rs",
            "rag_conversation.rs",
            "rag_history_references.rs",
            "rag_spreadsheet.rs",
            "rag_import_tasks.rs",
            "evidence.rs",
            "evidence_inspector.rs",
            "guide_source_authority.rs",
            "guide_retrieval.rs",
            "Cargo.toml",
            "ai-gateway/Cargo.toml",
            "auth-context/Cargo.toml",
            "auth-context/lib.rs",
            "stdb-client/Cargo.toml",
            "stdb-client/lib.rs",
            "stdb-client/contract.rs",
            "stdb-client/generated_reducer_contract.rs",
            "stdb-auth/Cargo.toml",
            "stdb-auth/lib.rs",
            "policy-core/lib.rs",
        ] {
            assert!(
                RELEASE_HELPERS
                    .iter()
                    .any(|(name, bytes)| *name == required && !bytes.is_empty()),
                "missing critical bundle input: {required}"
            );
        }
        let mut names = std::collections::HashSet::new();
        assert!(RELEASE_HELPERS.iter().all(|(name, _)| names.insert(name)));
    }

    #[tokio::test]
    async fn empty_malformed_and_unsupported_action_batches_never_invent_a_catalog_action() {
        for response in [
            r#"{"drafts":[]}"#,
            r#"{"drafts":"invalid"}"#,
            "not json",
            r#"{"drafts":[{"reducer_name":"execute_arbitrary_effect","params_json":{}}]}"#,
        ] {
            let (candidate, environment) = candidate(
                "action_draft_generation",
                response,
                json!({"query":"Help me","allowed_reducers":["create_task"]}),
            );
            assert!(
                CandidateAdapterRegistry::production()
                    .execute(candidate, environment, 1, 2)
                    .await
                    .is_err(),
                "{response}"
            );
        }
    }

    #[tokio::test]
    async fn immutable_release_transcripts_detect_revocation_narrowing_and_source_change() {
        for stage in [2, 4] {
            for change in ["revoked", "narrowed", "source"] {
                let (candidate, mut environment) = rag("supported");
                let transcript = data_mut(&mut environment)["accessTranscript"]
                    .as_array_mut()
                    .unwrap();
                match change {
                    "revoked" => {
                        transcript[stage]["bounds"] = Value::Null;
                        transcript.truncate(stage + 1);
                    }
                    "narrowed" => {
                        transcript[stage]["bounds"]["max_bytes"] = json!(1);
                        transcript.truncate(stage + 1);
                    }
                    "source" => {
                        transcript[stage + 1]["chain"]["version"]["status"] = json!("withdrawn");
                        transcript.truncate(stage + 2);
                    }
                    _ => unreachable!(),
                }
                let result = CandidateAdapterRegistry::production()
                    .execute(candidate, environment, 1, 2)
                    .await
                    .unwrap()
                    .actual_output;
                assert_eq!(
                    result["result"]["answerReleased"], false,
                    "{stage}/{change}"
                );
                assert_eq!(result["result"]["passagesDisclosed"], false);
            }
        }
    }

    #[tokio::test]
    async fn skipped_release_reads_cannot_return_a_successful_candidate() {
        let (candidate, mut environment) = rag("supported");
        // An unsupported answer skips both release checks, leaving these immutable
        // entries unused. This is the same guard exercised by deleting a recheck.
        data_mut(&mut environment)["reviews"][0]["response"]["choice"] = json!("unsupported");
        assert!(CandidateAdapterRegistry::production()
            .execute(candidate, environment, 1, 2)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn access_calls_are_bound_to_exact_scope_and_passage_id() {
        for field in ["organization_id", "company_id", "passage_id"] {
            let (candidate, mut environment) = rag("supported");
            data_mut(&mut environment)["accessTranscript"][1][field] = json!(999);
            assert!(
                CandidateAdapterRegistry::production()
                    .execute(candidate, environment, 1, 2)
                    .await
                    .is_err(),
                "{field}"
            );
        }
    }

    fn rag(
        choice: &str,
    ) -> (
        CandidateCertificationInputs,
        CandidateCertificationEnvironment,
    ) {
        let body = "Returns require controller approval.";
        let generated = json!({"content":body,"claims":[{"text":body,"supportRefs":[{"kind":"passage","id":"7"}],"passageSupport":[]}],"calculations":[]}).to_string();
        let (candidate, mut environment) = candidate(
            "rag_generation",
            &generated,
            json!({"query":"What is the returns policy?"}),
        );
        let hash = format!("{:x}", Sha256::digest(body.as_bytes()));
        data_mut(&mut environment)["passages"] = json!([{
            "passage":{"id":7,"organizationId":1,"companyId":2,"sourceKind":"policy","sourceKey":"returns","sourceVersion":"2026","passageKey":"p7","contentHash":hash,"passageText":body,"status":"current","textState":"present","sourceVersionId":8},
            "version":{"id":8,"organizationId":1,"companyId":2,"sourceId":9,"version":"2026","status":"current","verification":"inspected","contentHash":"document-hash"},
            "source":{"id":9,"organizationId":1,"companyId":2,"sourceKind":"policy","sourceKey":"returns","scope":"company","title":"Returns policy"}
        }]);
        data_mut(&mut environment)["reviews"] = json!([{
            "boundedState":{"claim":body,"passages":[{"passage":"policy:returns@2026#p7","text":body}]},
            "response":{"kind":"choice","choice":choice,"score":null,"probability":null,"confidence":null,"rationale":null,"model":"synthetic","provider":"synthetic","input_tokens":0,"output_tokens":0}
        }]);
        // Independently scripted calls: initial resolution, before persistence,
        // then immediately before release. Unsupported answers stop after resolution.
        let chain = data_mut(&mut environment)["passages"][0].clone();
        let grant = json!({"kind":"grant","organization_id":1,"company_id":2,
            "bounds":{"max_rows":20,"max_bytes":64000}});
        let read = json!({"kind":"passage","organization_id":1,"company_id":2,
            "passage_id":7,"chain":chain});
        data_mut(&mut environment)["accessTranscript"] = if choice == "supported" {
            json!([grant, read, grant, read, grant, read])
        } else {
            json!([grant, read])
        };
        (candidate, environment)
    }

    #[tokio::test]
    async fn executes_form_runtime_and_actual_route_parser_without_expectations() {
        let (mut candidate, environment) = form();
        let registry = CandidateAdapterRegistry::production();
        let first = registry
            .execute(candidate.clone(), environment.clone(), 1, 2)
            .await
            .unwrap();
        candidate.fixture.expected_output = json!({"tampered":"different private assertion"});
        let second = registry
            .execute(candidate, environment, 1, 2)
            .await
            .unwrap();
        assert_eq!(first.actual_output, second.actual_output);
        let suggestions = &first.actual_output["result"]["suggestions"];
        assert_eq!(suggestions["state"]["value"], "open");
        assert!(suggestions.get("foreign").is_none());
        assert!(!first
            .actual_output
            .to_string()
            .contains("privateExpectation"));
        assert_eq!(first.metadata.as_ref().unwrap()["billableCalls"], 0);
    }

    #[tokio::test]
    async fn action_route_keeps_proposals_advisory_and_withholds_unsupported_explanations() {
        let (candidate, environment) = candidate(
            "action_draft_generation",
            r#"{"drafts":[{"reducer_name":"create_task","params_json":{"company_id":999,"name":"Call vendor","foreign":true},"summary":"Vendor was paid","confidence":0.8},{"reducer_name":"execute_arbitrary_effect","params_json":{}}]}"#,
            json!({"query":"Propose a task","allowed_reducers":["create_task"]}),
        );
        let execution = CandidateAdapterRegistry::production()
            .execute(candidate, environment, 1, 2)
            .await
            .unwrap();
        let drafts = execution.actual_output["result"]["drafts"]
            .as_array()
            .unwrap();
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0]["params_json"]["company_id"], 2);
        assert!(drafts[0]["params_json"].get("foreign").is_none());
        assert!(drafts[0].get("draft_id").is_none());
        assert_ne!(drafts[0]["summary"], "Vendor was paid");
        assert_eq!(
            drafts[0]["explanation_verification"]["outcome"],
            "requires_review"
        );
    }

    #[tokio::test]
    async fn rag_exercises_real_source_resolution_review_and_release_pipeline() {
        let (candidate, environment) = rag("supported");
        let execution = CandidateAdapterRegistry::production()
            .execute(candidate, environment, 1, 2)
            .await
            .unwrap();
        assert_eq!(execution.actual_output["result"]["answerReleased"], true);
        assert_eq!(execution.actual_output["result"]["passagesDisclosed"], true);
        assert!(execution.actual_output["result"]["answer"]
            .as_str()
            .unwrap()
            .contains("Returns require controller approval."));
        assert_eq!(
            execution.metadata.unwrap()["durableProductionProvenance"],
            false
        );
    }

    #[tokio::test]
    async fn unsupported_claim_is_withheld_by_the_actual_answer_gate() {
        let (candidate, environment) = rag("unsupported");
        let execution = CandidateAdapterRegistry::production()
            .execute(candidate, environment, 1, 2)
            .await
            .unwrap();
        assert_eq!(execution.actual_output["result"]["answerReleased"], false);
        assert_eq!(
            execution.actual_output["result"]["passagesDisclosed"],
            false
        );
        assert!(!execution.actual_output["result"]["answer"]
            .as_str()
            .unwrap()
            .contains("Returns require controller approval."));
    }

    #[tokio::test]
    async fn tampered_source_unsupported_version_and_cross_skill_hash_fail_closed() {
        let registry = CandidateAdapterRegistry::production();
        for key in KEYS {
            let (mut request, environment) = candidate(key, "{}", json!({"query":"fixture"}));
            request.version.source_hash = "a".repeat(64);
            assert!(matches!(
                registry
                    .execute(request.clone(), environment.clone(), 1, 2)
                    .await,
                Err(CertificationExecutionError::UnsupportedSkill { .. })
            ));
            request.version.source_hash = bundle_hash(key).unwrap();
            request.version.version = "2.0.0".into();
            assert!(matches!(
                registry
                    .execute(request.clone(), environment.clone(), 1, 2)
                    .await,
                Err(CertificationExecutionError::UnsupportedSkill { .. })
            ));
            request.version.version = VERSION.into();
            request.version.source_hash = bundle_hash(if key == "rag_generation" {
                "form_suggestion"
            } else {
                "rag_generation"
            })
            .unwrap();
            assert!(matches!(
                registry.execute(request, environment, 1, 2).await,
                Err(CertificationExecutionError::UnsupportedSkill { .. })
            ));
        }
        assert!(bundle_hash("unregistered_generation").is_err());
        assert!(manifest("report_analysis").is_err());
    }

    #[tokio::test]
    async fn foreign_scope_tampered_passage_and_unsupported_transcript_are_rejected() {
        let registry = CandidateAdapterRegistry::production();
        for case in [
            "foreign",
            "tampered",
            "withdrawn",
            "denied",
            "review_binding",
        ] {
            let (candidate, mut environment) = rag("supported");
            match case {
                "foreign" => {
                    environment
                        .dataset
                        .as_object_mut()
                        .unwrap()
                        .values_mut()
                        .next()
                        .unwrap()["companyId"] = json!(99)
                }
                "tampered" => {
                    data_mut(&mut environment)["passages"][0]["passage"]["passageText"] =
                        json!("Unbound replacement");
                    data_mut(&mut environment)["accessTranscript"][1]["chain"]["passage"]
                        ["passageText"] = json!("Unbound replacement");
                }
                "withdrawn" => {
                    data_mut(&mut environment)["passages"][0]["version"]["status"] =
                        json!("withdrawn");
                    data_mut(&mut environment)["accessTranscript"][1]["chain"]["version"]
                        ["status"] = json!("withdrawn");
                }
                "denied" => data_mut(&mut environment)["denyEvidence"] = json!(true),
                "review_binding" => {
                    data_mut(&mut environment)["reviews"][0]["boundedState"]["claim"] =
                        json!("different claim");
                    data_mut(&mut environment)["accessTranscript"]
                        .as_array_mut()
                        .unwrap()
                        .truncate(2);
                }
                _ => unreachable!(),
            }
            let result = registry.execute(candidate, environment, 1, 2).await;
            if case == "review_binding" {
                // A reviewer error must withhold, not become synthetic support.
                let actual = result.unwrap().actual_output;
                assert_eq!(actual["result"]["answerReleased"], false);
            } else {
                assert!(result.is_err(), "{case}");
            }
        }
    }
}
