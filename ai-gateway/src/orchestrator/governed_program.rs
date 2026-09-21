//! Governed typed-program execution.
//!
//! This is the convergence runtime for GP-09 through GP-13: the graph owns
//! control flow, providers answer narrow typed questions, capabilities always
//! route through the shared governed execution service, and reasoning can only
//! return proposals that are re-admitted by the runtime.

use std::collections::HashMap;

use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use chrono::Utc;
use futures::future::join_all;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use stdb_client::{ReducerCall, StdbClient};

use crate::{harness::audit::PolicyDecision, tools::types::ToolOutput};

const MAX_EVIDENCE_RERETRIEVALS: u32 = 2;
const MAX_GENERATION_REPAIRS: u32 = 2;
const MAX_REASON_REPLANS: u32 = 1;
const MAX_POLL_ATTEMPTS: u32 = 4;
const POLL_BASE_BACKOFF_MS: u64 = 50;
const POLL_MAX_BACKOFF_MS: u64 = 400;

use super::{
    answer_gate::collect_json_figures,
    decision_graph::{
        validate_graph, DecisionGraph, DecisionNode, GateCondition, GraphNode, StopReason,
    },
    decision_type::{admit_decision, DecisionTypeRegistry, InMemoryDecisionTypeRegistry},
    governed_services::{
        qualified_content, AdmissionEvidence, AnswerAdmissionOutcome, CapabilityAdmission,
        CapabilityExecutor, CapabilityStepOutcome, FinalAnswerAdmission, GovernedCapabilityService,
        InMemoryExecutionRecovery, RecordingApprovalCoordinator, ShapeOnlyVerificationService,
        VerificationOutcome, VerificationService,
    },
    graduation::{DecisionResolutionContext, GovernedDecisionResolver},
    intelligence::{
        decision_request_hash, reasoning_request_hash, CapabilityProposal, DecisionKind,
        DecisionProvider, DecisionRequest, DecisionResponse, EvidenceRef, FinalDraft,
        GenerationProvider, GenerationRequest, ReasoningOutcome, ReasoningProvider,
        ReasoningRequest,
    },
    precedent::{
        summarize, DecisionCaseRecord, DecisionCaseStatus, InMemoryPrecedentStore, PrecedentQuery,
        PrecedentStore,
    },
    probabilistic::{
        CalibrationProfileStore, Confidence, GateDecision, InMemoryCalibrationProfileStore,
    },
};

#[derive(Clone, Debug)]
pub(crate) struct GovernedProgramContext {
    pub organization_id: u64,
    pub company_id: u64,
    pub run_id: u64,
    pub program_ref: String,
    pub objective: String,
    pub bounded_state: Value,
    pub evidence: Vec<EvidenceRef>,
    /// Trusted per-run generation instructions supplied by the runtime surface,
    /// not by the model. Generate nodes inherit this value.
    pub generation_instructions: Option<String>,
    /// Optional per-run generation ceiling applied in addition to the resolved
    /// immutable model profile limit.
    pub generation_max_tokens: Option<u32>,
}

impl GovernedProgramContext {
    fn validate(&self) -> Result<()> {
        if self.organization_id == 0 || self.company_id == 0 || self.run_id == 0 {
            bail!("governed program requires nonzero organization, company and run ids");
        }
        if self.program_ref.trim().is_empty() || self.objective.trim().is_empty() {
            bail!("governed program requires program_ref and objective");
        }
        if !self.bounded_state.is_object() {
            bail!("governed program bounded_state must be a JSON object");
        }
        if self.generation_max_tokens == Some(0) {
            bail!("governed program generation_max_tokens must be positive when present");
        }
        for evidence in &self.evidence {
            evidence.validate()?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub(crate) enum GovernedProgramStop {
    Completed,
    EarlyStop(StopReason),
    Denied(String),
    PendingApproval {
        capability: String,
        reason: String,
        draft_id: Option<u64>,
    },
    Clarification {
        prompt: String,
        options: Vec<String>,
    },
    ReviewRequired(String),
    UnableToProgress(String),
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct GovernedProgramTraceStep {
    pub node_id: String,
    pub kind: String,
    pub summary: String,
}

#[derive(Clone, Debug)]
pub(crate) struct GovernedProgramOutcome {
    pub stop: GovernedProgramStop,
    pub final_content: Option<String>,
    pub outputs: HashMap<String, Value>,
    pub trace: Vec<GovernedProgramTraceStep>,
    pub decision_calls: u32,
    pub capability_calls: u32,
    pub generation_provider: Option<String>,
    pub generation_model: Option<String>,
    pub generation_input_tokens: u32,
    pub generation_output_tokens: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
enum NodeValue {
    Json(Value),
    Decision(DecisionResponse),
    Tool(ToolOutput),
    Text(String),
}

impl NodeValue {
    fn as_json(&self) -> Value {
        match self {
            NodeValue::Json(value) => value.clone(),
            NodeValue::Decision(value) => serde_json::to_value(value).unwrap_or(Value::Null),
            NodeValue::Tool(value) => serde_json::to_value(value).unwrap_or(Value::Null),
            NodeValue::Text(value) => Value::String(value.clone()),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct PendingApprovalCheckpoint {
    node_id: String,
    capability: String,
    reason: String,
    draft_id: Option<u64>,
    next_node: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct ContinuationManifest {
    bounded_state_hash: String,
    dependency_refs: Vec<String>,
    acquired_evidence_hash: String,
    decision_state_hash: String,
    decision_event_cursor: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct CompactionSummary {
    current_node: String,
    completed_nodes: Vec<String>,
    event_step: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct GovernedProgramCheckpoint {
    schema_version: u32,
    program_ref: String,
    graph_hash: String,
    checkpoint_sequence: u64,
    concurrency_version: u64,
    parent_checkpoint_hash: Option<String>,
    continuation_manifest: ContinuationManifest,
    continuation_manifest_hash: String,
    compaction_summary: CompactionSummary,
    compaction_summary_hash: String,
    /// Hash from the durable event envelope, never serialized into the
    /// checkpoint itself. Parent links must use the exact persisted bytes,
    /// not a reserialization of maps with potentially different key order.
    #[serde(skip)]
    persisted_hash: Option<String>,
    current_node: String,
    values: HashMap<String, NodeValue>,
    trace: Vec<GovernedProgramTraceStep>,
    event_step: u32,
    decision_calls: u32,
    capability_calls: u32,
    reason_iterations: HashMap<String, u32>,
    #[serde(default)]
    evidence_overlays: HashMap<String, Vec<Value>>,
    #[serde(default)]
    evidence_acquisitions: HashMap<String, u32>,
    pending_approval: Option<PendingApprovalCheckpoint>,
}

#[async_trait]
pub(crate) trait ProgramCheckpointStore: Send + Sync {
    async fn load(
        &self,
        context: &GovernedProgramContext,
        graph_hash: &str,
    ) -> Result<Option<GovernedProgramCheckpoint>>;

    async fn save(
        &self,
        context: &GovernedProgramContext,
        checkpoint: &GovernedProgramCheckpoint,
        status: &str,
    ) -> Result<()>;
}

pub(crate) struct StdbProgramCheckpointStore<'a> {
    pub writer: &'a StdbClient,
    pub reader: &'a StdbClient,
}

impl StdbProgramCheckpointStore<'_> {
    /// Verify the latest continuation against the current graph, bounded
    /// inputs and freshly authorized dependency snapshot before a waiting run
    /// is transitioned back to `running`.
    pub(super) async fn validate_resume(
        &self,
        context: &GovernedProgramContext,
        graph: &DecisionGraph,
    ) -> Result<()> {
        self.load(context, &graph_hash(graph))
            .await?
            .context("resumable governed-program checkpoint was not found")?;
        Ok(())
    }
}

#[async_trait]
impl ProgramCheckpointStore for StdbProgramCheckpointStore<'_> {
    async fn load(
        &self,
        context: &GovernedProgramContext,
        graph_hash: &str,
    ) -> Result<Option<GovernedProgramCheckpoint>> {
        let program_ref = context.program_ref.replace('\'', "''");
        let rows = self
            .reader
            .query_sql(&format!(
                "SELECT * FROM ai_intelligence_event WHERE organization_id = {}                  AND run_id = {} AND event_kind = 'program_checkpoint'                  AND shadow_profile_ref = '{}' ORDER BY id DESC LIMIT 1",
                context.organization_id, context.run_id, program_ref
            ))
            .await
            .context("load governed program checkpoint")?;
        let Some(row) = rows.first() else {
            return Ok(None);
        };
        let stored_graph_hash = row
            .get("model")
            .and_then(Value::as_str)
            .context("checkpoint graph hash missing")?;
        if stored_graph_hash != graph_hash {
            bail!(
                "governed program checkpoint graph hash mismatch: stored {stored_graph_hash}, current {graph_hash}"
            );
        }
        let raw = row
            .get("outputJson")
            .or_else(|| row.get("output_json"))
            .and_then(Value::as_str)
            .context("checkpoint output_json missing")?;
        let mut checkpoint: GovernedProgramCheckpoint =
            serde_json::from_str(raw).context("decode governed program checkpoint")?;
        let stored_checkpoint_hash = row
            .get("requestHash")
            .or_else(|| row.get("request_hash"))
            .and_then(Value::as_str)
            .context("checkpoint hash missing")?;
        let actual_checkpoint_hash = format!("{:x}", Sha256::digest(raw.as_bytes()));
        if stored_checkpoint_hash != actual_checkpoint_hash {
            bail!("governed program checkpoint payload hash mismatch");
        }
        checkpoint.persisted_hash = Some(stored_checkpoint_hash.to_string());
        if checkpoint.schema_version != 2
            || checkpoint.program_ref != context.program_ref
            || checkpoint.graph_hash != graph_hash
        {
            bail!("governed program checkpoint identity is invalid");
        }
        checkpoint.validate_continuation(context)?;
        Ok(Some(checkpoint))
    }

    async fn save(
        &self,
        context: &GovernedProgramContext,
        checkpoint: &GovernedProgramCheckpoint,
        status: &str,
    ) -> Result<()> {
        let mut checkpoint = checkpoint.clone();
        let previous = self.load(context, &checkpoint.graph_hash).await?;
        checkpoint.checkpoint_sequence = previous
            .as_ref()
            .map_or(1, |value| value.checkpoint_sequence.saturating_add(1));
        checkpoint.concurrency_version = checkpoint.checkpoint_sequence;
        checkpoint.parent_checkpoint_hash = previous
            .as_ref()
            .and_then(|value| value.persisted_hash.clone());
        checkpoint.continuation_manifest = continuation_manifest(
            context,
            checkpoint.event_step,
            &checkpoint.values,
            &checkpoint.evidence_overlays,
        )?;
        checkpoint.continuation_manifest_hash = hash_json(&checkpoint.continuation_manifest)?;
        checkpoint.compaction_summary = compaction_summary(&checkpoint);
        checkpoint.compaction_summary_hash = hash_json(&checkpoint.compaction_summary)?;
        let checkpoint_json =
            serde_json::to_string(&checkpoint).context("serialize governed program checkpoint")?;
        let checkpoint_hash = format!("{:x}", Sha256::digest(checkpoint_json.as_bytes()));
        self.writer
            .call_reducer(ReducerCall::from_name(
                "record_ai_program_checkpoint",
                json!([
                    context.organization_id,
                    context.company_id,
                    context.run_id,
                    {
                        "program_ref": context.program_ref,
                        "graph_hash": checkpoint.graph_hash,
                        "checkpoint_hash": checkpoint_hash,
                        "checkpoint_json": checkpoint_json,
                        "status": status,
                    }
                ]),
            ))
            .await
            .context("persist governed program checkpoint")
    }
}

impl GovernedProgramCheckpoint {
    fn validate_continuation(&self, context: &GovernedProgramContext) -> Result<()> {
        if self.checkpoint_sequence == 0
            || self.concurrency_version != self.checkpoint_sequence
            || self.continuation_manifest.decision_event_cursor != self.event_step
            || (self.checkpoint_sequence == 1 && self.parent_checkpoint_hash.is_some())
            || (self.checkpoint_sequence > 1 && self.parent_checkpoint_hash.is_none())
        {
            bail!("governed program checkpoint cursor/concurrency lineage is invalid");
        }
        let expected_manifest = continuation_manifest(
            context,
            self.event_step,
            &self.values,
            &self.evidence_overlays,
        )?;
        if self.continuation_manifest != expected_manifest
            || self.continuation_manifest_hash != hash_json(&expected_manifest)?
        {
            bail!("governed program continuation dependencies changed or were revoked");
        }
        let expected_summary = compaction_summary(self);
        if self.compaction_summary != expected_summary
            || self.compaction_summary_hash != hash_json(&expected_summary)?
        {
            bail!("governed program compaction summary does not match persisted state");
        }
        Ok(())
    }
}

fn continuation_manifest(
    context: &GovernedProgramContext,
    decision_event_cursor: u32,
    values: &HashMap<String, NodeValue>,
    evidence_overlays: &HashMap<String, Vec<Value>>,
) -> Result<ContinuationManifest> {
    let mut dependency_refs = context
        .evidence
        .iter()
        .map(|evidence| format!("{}:{}", evidence.kind, evidence.id))
        .collect::<Vec<_>>();
    dependency_refs.sort();
    dependency_refs.dedup();
    let decision_state = values
        .iter()
        .filter_map(|(node_id, value)| match value {
            NodeValue::Decision(_) => Some((node_id.clone(), value.as_json())),
            _ => None,
        })
        .collect::<serde_json::Map<_, _>>();
    Ok(ContinuationManifest {
        bounded_state_hash: hash_json(&context.bounded_state)?,
        dependency_refs,
        acquired_evidence_hash: hash_json(evidence_overlays)?,
        decision_state_hash: hash_json(&decision_state)?,
        decision_event_cursor,
    })
}

fn compaction_summary(checkpoint: &GovernedProgramCheckpoint) -> CompactionSummary {
    let mut completed_nodes = checkpoint.values.keys().cloned().collect::<Vec<_>>();
    completed_nodes.sort();
    CompactionSummary {
        current_node: checkpoint.current_node.clone(),
        completed_nodes,
        event_step: checkpoint.event_step,
    }
}

fn hash_json(value: &impl Serialize) -> Result<String> {
    let canonical = serde_json::to_value(value).context("serialize checkpoint lineage value")?;
    let bytes = serde_json::to_vec(&canonical).context("encode checkpoint lineage value")?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

#[async_trait]
pub(super) trait ComputeService: Send + Sync {
    async fn compute(
        &self,
        function_ref: &str,
        program_state: &Value,
        dependencies: &HashMap<String, Value>,
    ) -> Result<Value>;
}

/// Small provider-free deterministic compute registry shared by governed
/// programs. Keep generic structural functions here; domain business rules
/// remain in STDB/native ERP services and should be referenced, not copied.
pub(super) struct BuiltinComputeService;

#[async_trait]
impl ComputeService for BuiltinComputeService {
    async fn compute(
        &self,
        function_ref: &str,
        program_state: &Value,
        dependencies: &HashMap<String, Value>,
    ) -> Result<Value> {
        match function_ref {
            "program_input" => Ok(program_state.clone()),
            "dependency_object" => Ok(serde_json::to_value(dependencies)?),
            "dependency_count" => Ok(Value::from(dependencies.len() as u64)),
            "dependency_keys" => {
                let mut keys = dependencies.keys().cloned().collect::<Vec<_>>();
                keys.sort();
                Ok(serde_json::to_value(keys)?)
            }
            "merge_object_dependencies" => {
                let mut keys = dependencies.keys().cloned().collect::<Vec<_>>();
                keys.sort();
                let mut merged = serde_json::Map::new();
                for key in keys {
                    let value = dependencies
                        .get(&key)
                        .context("dependency disappeared during deterministic merge")?;
                    let object = value.as_object().with_context(|| {
                        format!(
                            "dependency '{key}' must be an object for merge_object_dependencies"
                        )
                    })?;
                    for (field, value) in object {
                        if let Some(existing) = merged.get(field) {
                            if existing != value {
                                bail!("merge_object_dependencies conflict for field '{field}'");
                            }
                        } else {
                            merged.insert(field.clone(), value.clone());
                        }
                    }
                }
                Ok(Value::Object(merged))
            }
            other => bail!("unknown deterministic compute function '{other}'"),
        }
    }
}

/// Durable evidence for one `decide()`/`reason()` call and, once known,
/// what the governed program did with it (GP-05). `record_decision`/
/// `record_reasoning` return the durable event id so a caller can later
/// settle `verification`/`escalation`/`acceptance` on that exact row —
/// three independently-settable fields (decision_events.rs's module
/// docs): verification is whether the decision type's required check
/// happened, escalation is whether the outcome required review, and
/// acceptance is whether the governed program ultimately acted on the
/// judgment. None of the three implies the others, so none of the three
/// setters implies the other two either.
#[async_trait]
pub(crate) trait IntelligenceEventRecorder: Send + Sync {
    async fn record_decision(
        &self,
        context: &GovernedProgramContext,
        step_no: u32,
        request_hash: &str,
        request: &DecisionRequest,
        response: &DecisionResponse,
    ) -> Result<u64>;

    async fn record_reasoning(
        &self,
        context: &GovernedProgramContext,
        step_no: u32,
        request_hash: &str,
        request: &ReasoningRequest,
        outcome: &ReasoningOutcome,
    ) -> Result<u64>;

    async fn set_verification(
        &self,
        context: &GovernedProgramContext,
        event_id: u64,
        status: &str,
        reason: Option<String>,
    ) -> Result<()>;

    async fn set_escalation(
        &self,
        context: &GovernedProgramContext,
        event_id: u64,
        status: &str,
        reason: Option<String>,
    ) -> Result<()>;

    async fn set_acceptance(
        &self,
        context: &GovernedProgramContext,
        event_id: u64,
        status: &str,
        reason: Option<String>,
    ) -> Result<()>;
}

pub(super) struct NoopIntelligenceEventRecorder;

#[async_trait]
impl IntelligenceEventRecorder for NoopIntelligenceEventRecorder {
    async fn record_decision(
        &self,
        _context: &GovernedProgramContext,
        _step_no: u32,
        _request_hash: &str,
        _request: &DecisionRequest,
        _response: &DecisionResponse,
    ) -> Result<u64> {
        Ok(0)
    }

    async fn record_reasoning(
        &self,
        _context: &GovernedProgramContext,
        _step_no: u32,
        _request_hash: &str,
        _request: &ReasoningRequest,
        _outcome: &ReasoningOutcome,
    ) -> Result<u64> {
        Ok(0)
    }

    async fn set_verification(
        &self,
        _context: &GovernedProgramContext,
        _event_id: u64,
        _status: &str,
        _reason: Option<String>,
    ) -> Result<()> {
        Ok(())
    }

    async fn set_escalation(
        &self,
        _context: &GovernedProgramContext,
        _event_id: u64,
        _status: &str,
        _reason: Option<String>,
    ) -> Result<()> {
        Ok(())
    }

    async fn set_acceptance(
        &self,
        _context: &GovernedProgramContext,
        _event_id: u64,
        _status: &str,
        _reason: Option<String>,
    ) -> Result<()> {
        Ok(())
    }
}

/// Production implementation. `reader` resolves the durable event id a
/// `record_*` reducer cannot return directly (reducers return no data) —
/// the table is public, so, like `StdbCalibrationProfileStore`, no
/// dedicated read principal is needed; `writer` and `reader` may be the
/// same client.
pub(crate) struct StdbIntelligenceEventRecorder<'a> {
    pub writer: &'a StdbClient,
    pub reader: &'a StdbClient,
}

impl StdbIntelligenceEventRecorder<'_> {
    async fn resolve_event_id(
        &self,
        context: &GovernedProgramContext,
        step_no: u32,
        event_kind: &str,
    ) -> Result<u64> {
        let rows = self
            .reader
            .query_sql(&format!(
                "SELECT id FROM ai_intelligence_event WHERE organization_id = {} \
                 AND run_id = {} AND step_no = {step_no} AND event_kind = '{event_kind}' LIMIT 1",
                context.organization_id, context.run_id
            ))
            .await
            .context("resolve durable intelligence event id")?;
        rows.first()
            .and_then(|row| row.get("id").and_then(Value::as_u64))
            .context("intelligence event not found immediately after recording it")
    }

    async fn set_status(
        &self,
        reducer_name: &'static str,
        organization_id: u64,
        event_id: u64,
        status: &str,
        reason: Option<String>,
    ) -> Result<()> {
        self.writer
            .call_reducer(ReducerCall::from_name(
                reducer_name,
                json!([organization_id, event_id, status, reason]),
            ))
            .await
            .with_context(|| format!("{reducer_name} for durable intelligence event"))
    }
}

#[async_trait]
impl IntelligenceEventRecorder for StdbIntelligenceEventRecorder<'_> {
    async fn record_decision(
        &self,
        context: &GovernedProgramContext,
        step_no: u32,
        request_hash: &str,
        request: &DecisionRequest,
        response: &DecisionResponse,
    ) -> Result<u64> {
        self.writer
            .call_reducer(ReducerCall::from_name(
                "record_ai_decision_event",
                json!([
                    context.organization_id,
                    context.company_id,
                    context.run_id,
                    {
                        "step_no": step_no,
                        "decision_type_name": request.decision_type.name.clone(),
                        "decision_type_version": request.decision_type.version,
                        "request_hash": request_hash,
                        "request_json": serde_json::to_string(request)?,
                        "outcome_kind": decision_kind_label(response.kind),
                        "output_json": serde_json::to_string(response)?,
                        "confidence": response.confidence,
                        "provider": response.provider.clone(),
                        "model": response.model.clone(),
                        "provider_attempt_id": null,
                        "input_tokens": response.input_tokens,
                        "output_tokens": response.output_tokens,
                    }
                ]),
            ))
            .await
            .context("record durable decision event")?;
        self.resolve_event_id(context, step_no, "decision").await
    }

    async fn record_reasoning(
        &self,
        context: &GovernedProgramContext,
        step_no: u32,
        request_hash: &str,
        request: &ReasoningRequest,
        outcome: &ReasoningOutcome,
    ) -> Result<u64> {
        self.writer
            .call_reducer(ReducerCall::from_name(
                "record_ai_reasoning_event",
                json!([
                    context.organization_id,
                    context.company_id,
                    context.run_id,
                    {
                        "step_no": step_no,
                        "request_hash": request_hash,
                        "request_json": serde_json::to_string(request)?,
                        "outcome_kind": reasoning_outcome_kind_label(outcome),
                        "output_json": serde_json::to_string(outcome)?,
                        "provider": reasoning_outcome_provider(outcome),
                        "model": reasoning_outcome_model(outcome),
                        "provider_attempt_id": null,
                        "input_tokens": 0,
                        "output_tokens": 0,
                    }
                ]),
            ))
            .await
            .context("record durable reasoning event")?;
        self.resolve_event_id(context, step_no, "reasoning").await
    }

    async fn set_verification(
        &self,
        context: &GovernedProgramContext,
        event_id: u64,
        status: &str,
        reason: Option<String>,
    ) -> Result<()> {
        self.set_status(
            "set_ai_intelligence_event_verification",
            context.organization_id,
            event_id,
            status,
            reason,
        )
        .await
    }

    async fn set_escalation(
        &self,
        context: &GovernedProgramContext,
        event_id: u64,
        status: &str,
        reason: Option<String>,
    ) -> Result<()> {
        self.set_status(
            "set_ai_intelligence_event_escalation",
            context.organization_id,
            event_id,
            status,
            reason,
        )
        .await
    }

    async fn set_acceptance(
        &self,
        context: &GovernedProgramContext,
        event_id: u64,
        status: &str,
        reason: Option<String>,
    ) -> Result<()> {
        self.set_status(
            "set_ai_intelligence_event_acceptance",
            context.organization_id,
            event_id,
            status,
            reason,
        )
        .await
    }
}

/// `ReasoningOutcome`'s own `kind_label()` returns the GP-01 proposal-kind
/// vocabulary (`"decision"`, `"capability"`, ...) used for
/// `allowed_proposal_kinds` matching; durable recording uses
/// decision_events.rs's distinct `REASONING_KINDS` vocabulary
/// (`"decision_proposal"`, `"capability_proposal"`, ...) instead, so the
/// two are not interchangeable despite describing the same outcome.
fn reasoning_outcome_kind_label(outcome: &ReasoningOutcome) -> &'static str {
    match outcome {
        ReasoningOutcome::DecisionProposal(_) => "decision_proposal",
        ReasoningOutcome::CapabilityProposal(_) => "capability_proposal",
        ReasoningOutcome::ProgramPatchProposal(_) => "program_patch_proposal",
        ReasoningOutcome::ClarificationRequest(_) => "clarification_request",
        ReasoningOutcome::FinalDraft(_) => "final_draft",
        ReasoningOutcome::UnableToProgress(_) => "unable_to_progress",
    }
}

/// A `ReasoningOutcome` is a runtime-produced proposal, not itself a
/// provider/model attribution — none of its variants carry one. Durable
/// recording still requires nonempty `provider`/`model` strings
/// (`decision_events.rs`'s `validate_common`), so these name the
/// governed-program runtime itself as the origin of the *outcome record*,
/// distinct from whichever `ReasoningProvider` produced it (that
/// attribution lives in the provider-attempt/spend trail instead).
const REASONING_OUTCOME_PROVIDER: &str = "governed_program";
const REASONING_OUTCOME_MODEL: &str = "n/a";

fn reasoning_outcome_provider(_outcome: &ReasoningOutcome) -> &'static str {
    REASONING_OUTCOME_PROVIDER
}

fn reasoning_outcome_model(_outcome: &ReasoningOutcome) -> &'static str {
    REASONING_OUTCOME_MODEL
}

struct UnreachableDecisionProvider;

#[async_trait]
impl DecisionProvider for UnreachableDecisionProvider {
    async fn decide(&self, _request: DecisionRequest) -> Result<DecisionResponse> {
        bail!("generation-only governed program cannot execute decision nodes")
    }
}

struct UnreachableReasoningProvider;

#[async_trait]
impl ReasoningProvider for UnreachableReasoningProvider {
    async fn reason(&self, _request: ReasoningRequest) -> Result<ReasoningOutcome> {
        bail!("generation-only governed program cannot execute reasoning nodes")
    }
}

struct UnreachableCapabilityAdmission;

#[async_trait]
impl CapabilityAdmission for UnreachableCapabilityAdmission {
    async fn admit(
        &self,
        _proposal: &CapabilityProposal,
        _completed_calls: u32,
    ) -> Result<PolicyDecision> {
        bail!("generation-only governed program cannot admit capabilities")
    }

    async fn protect_output(
        &self,
        _proposal: &CapabilityProposal,
        _completed_calls: u32,
        _output: ToolOutput,
    ) -> Result<ToolOutput> {
        bail!("generation-only governed program cannot protect capability output")
    }
}

struct UnreachableCapabilityExecutor;

#[async_trait]
impl CapabilityExecutor for UnreachableCapabilityExecutor {
    async fn execute(&self, _proposal: &CapabilityProposal) -> Result<ToolOutput> {
        bail!("generation-only governed program cannot execute capabilities")
    }
}

/// Transitional admission for catalogued generation surfaces. It validates
/// generated draft shape and allows the route's existing surface-specific
/// parser/evidence gate to make the publication decision. Point 5 replaces
/// this with the common durable evidence/publication admission path.
struct GenerationSurfaceDraftAdmission;

#[async_trait]
impl FinalAnswerAdmission for GenerationSurfaceDraftAdmission {
    async fn admit(
        &self,
        draft: &FinalDraft,
        _known_evidence: &std::collections::HashSet<EvidenceRef>,
    ) -> Result<AnswerAdmissionOutcome> {
        match draft.validate() {
            Ok(()) => Ok(AnswerAdmissionOutcome::Admitted),
            Err(error) => Ok(AnswerAdmissionOutcome::Blocked {
                reason: error.to_string(),
            }),
        }
    }
}

/// Execute a catalogued compute/generate-only graph through the common
/// GovernedProgramExecutor. Any accidental decision, reasoning, capability,
/// or approval node fails closed through unreachable services.
pub(crate) async fn run_generation_only_program(
    graph: &DecisionGraph,
    context: &GovernedProgramContext,
    generation_provider: &dyn GenerationProvider,
    checkpoint_store: Option<&dyn ProgramCheckpointStore>,
    recorder: &dyn IntelligenceEventRecorder,
) -> Result<GovernedProgramOutcome> {
    let decision_provider = UnreachableDecisionProvider;
    let reasoning_provider = UnreachableReasoningProvider;
    let decision_types = InMemoryDecisionTypeRegistry::new();
    let precedent = InMemoryPrecedentStore::new();
    let admission = UnreachableCapabilityAdmission;
    let capability_executor = UnreachableCapabilityExecutor;
    let recovery = InMemoryExecutionRecovery::new();
    let approvals = RecordingApprovalCoordinator;
    let capabilities =
        GovernedCapabilityService::new(&admission, &capability_executor, &recovery, &approvals);
    let verification = ShapeOnlyVerificationService;
    let answer_admission = GenerationSurfaceDraftAdmission;
    let compute = BuiltinComputeService;
    let calibration = InMemoryCalibrationProfileStore::new();

    GovernedProgramExecutor {
        decision_provider: &decision_provider,
        checkpoint_store,
        decision_resolver: None,
        generation_provider,
        reasoning_provider: &reasoning_provider,
        decision_types: &decision_types,
        precedent: &precedent,
        capabilities: &capabilities,
        verification: &verification,
        answer_admission: &answer_admission,
        compute: &compute,
        recorder,
        calibration: &calibration,
    }
    .run(graph, context)
    .await
}

pub(super) struct GovernedProgramExecutor<'a> {
    pub decision_provider: &'a dyn DecisionProvider,
    pub checkpoint_store: Option<&'a dyn ProgramCheckpointStore>,
    pub decision_resolver: Option<&'a GovernedDecisionResolver<'a>>,
    pub generation_provider: &'a dyn GenerationProvider,
    pub reasoning_provider: &'a dyn ReasoningProvider,
    pub decision_types: &'a dyn DecisionTypeRegistry,
    pub precedent: &'a dyn PrecedentStore,
    pub capabilities: &'a GovernedCapabilityService<'a>,
    pub verification: &'a dyn VerificationService,
    pub answer_admission: &'a dyn FinalAnswerAdmission,
    pub compute: &'a dyn ComputeService,
    pub recorder: &'a dyn IntelligenceEventRecorder,
    pub calibration: &'a dyn CalibrationProfileStore,
}

struct DecisionExecution {
    value: DecisionResponse,
    review_reason: Option<String>,
}

fn answer_reason_needs_retrieval(reason: &str) -> bool {
    let reason = reason.to_ascii_lowercase();
    ["evidence", "citation", "source", "support", "ground"]
        .iter()
        .any(|needle| reason.contains(needle))
}

fn answer_reason_is_repairable(reason: &str) -> bool {
    let reason = reason.to_ascii_lowercase();
    !["forbidden", "denied", "revoked", "withdrawn", "out of scope", "unauthorized"]
        .iter()
        .any(|needle| reason.contains(needle))
}

fn recovery_evidence_node(graph: &DecisionGraph, target: &str) -> Option<String> {
    graph.nodes.iter().find_map(|node| match &node.kind {
        DecisionNode::AcquireEvidence(acquire)
            if acquire.affects.iter().any(|affected| affected == target) =>
        {
            Some(node.id.clone())
        }
        _ => None,
    })
}

fn push_recovery_diagnostic(
    evidence_overlays: &mut HashMap<String, Vec<Value>>,
    node_id: &str,
    kind: &str,
    attempt: u32,
    limit: u32,
    reason: &str,
) {
    evidence_overlays
        .entry(node_id.to_string())
        .or_default()
        .push(json!({
            "recovery_diagnostic": {
                "kind": kind,
                "attempt": attempt,
                "limit": limit,
                "reason": reason,
            }
        }));
}

fn reserve_recovery_attempt(
    counters: &mut HashMap<String, u32>,
    key: String,
    limit: u32,
) -> Option<u32> {
    let count = counters.entry(key).or_default();
    if *count >= limit {
        return None;
    }
    *count = count.saturating_add(1);
    Some(*count)
}

fn poll_backoff_ms(attempt: u32) -> u64 {
    if attempt <= 1 {
        return 0;
    }
    let exponent = attempt.saturating_sub(2).min(8);
    POLL_BASE_BACKOFF_MS
        .saturating_mul(1_u64 << exponent)
        .min(POLL_MAX_BACKOFF_MS)
}

fn graph_hash(graph: &DecisionGraph) -> String {
    let mut canonical = graph
        .nodes
        .iter()
        .map(|node| {
            format!(
                "{}|{}|{:?}|{:?}|{:?}",
                node.id,
                node.kind.label(),
                node.depends_on,
                node.next,
                node.kind
            )
        })
        .collect::<Vec<_>>();
    canonical.sort();
    format!("{:x}", Sha256::digest(canonical.join("\n").as_bytes()))
}

impl GovernedProgramExecutor<'_> {
    pub async fn run(
        &self,
        graph: &DecisionGraph,
        context: &GovernedProgramContext,
    ) -> Result<GovernedProgramOutcome> {
        validate_graph(graph)?;
        context.validate()?;

        let graph_hash = graph_hash(graph);
        let restored = if let Some(store) = self.checkpoint_store {
            store.load(context, &graph_hash).await?
        } else {
            None
        };
        let (
            mut values,
            mut trace,
            mut current,
            mut event_step,
            mut decision_calls,
            mut capability_calls,
            mut reason_iterations,
            mut evidence_overlays,
            mut evidence_acquisitions,
            pending_approval,
        ) = if let Some(checkpoint) = restored {
            (
                checkpoint.values,
                checkpoint.trace,
                checkpoint.current_node,
                checkpoint.event_step,
                checkpoint.decision_calls,
                checkpoint.capability_calls,
                checkpoint.reason_iterations,
                checkpoint.evidence_overlays,
                checkpoint.evidence_acquisitions,
                checkpoint.pending_approval,
            )
        } else {
            (
                HashMap::<String, NodeValue>::new(),
                Vec::new(),
                graph.entry.clone(),
                0_u32,
                0_u32,
                0_u32,
                HashMap::<String, u32>::new(),
                HashMap::<String, Vec<Value>>::new(),
                HashMap::<String, u32>::new(),
                None,
            )
        };
        let max_steps = graph.nodes.len().saturating_mul(16).max(32);

        if let Some(pending) = pending_approval {
            let Some(draft_id) = pending.draft_id else {
                return Ok(outcome(
                    GovernedProgramStop::PendingApproval {
                        capability: pending.capability,
                        reason: pending.reason,
                        draft_id: None,
                    },
                    None,
                    values,
                    trace,
                    decision_calls,
                    capability_calls,
                ));
            };
            match self.capabilities.approval_status(draft_id).await? {
                super::governed_services::ApprovalStatus::Approved {
                    execution_record_id,
                } => {
                    values.insert(
                        pending.node_id.clone(),
                        NodeValue::Tool(ToolOutput {
                            summary: format!(
                                "approved capability '{}' executed via draft #{}",
                                pending.capability, draft_id
                            ),
                            data: json!({
                                "approved": true,
                                "draft_id": draft_id,
                                "capability": pending.capability,
                                "execution_record_id": execution_record_id,
                            }),
                            citations: Vec::new(),
                            row_count: Some(1),
                        }),
                    );
                    trace.push(GovernedProgramTraceStep {
                        node_id: pending.node_id,
                        kind: "require_approval".to_string(),
                        summary: "human approval completed; resuming governed program".to_string(),
                    });
                    current = pending.next_node;
                }
                super::governed_services::ApprovalStatus::Pending => {
                    return Ok(outcome(
                        GovernedProgramStop::PendingApproval {
                            capability: pending.capability,
                            reason: pending.reason,
                            draft_id: Some(draft_id),
                        },
                        None,
                        values,
                        trace,
                        decision_calls,
                        capability_calls,
                    ));
                }
                super::governed_services::ApprovalStatus::Rejected(reason) => {
                    return Ok(outcome(
                        GovernedProgramStop::Denied(reason),
                        None,
                        values,
                        trace,
                        decision_calls,
                        capability_calls,
                    ));
                }
            }
        }

        for _ in 0..max_steps {
            let node = graph
                .get(&current)
                .with_context(|| format!("control flow reached unknown node '{current}'"))?
                .clone();
            ensure_dependencies(&node, &values)?;
            self.checkpoint(
                context,
                &graph_hash,
                &current,
                &values,
                &trace,
                event_step,
                decision_calls,
                capability_calls,
                &reason_iterations,
                &evidence_overlays,
                &evidence_acquisitions,
                None,
                "running",
            )
            .await?;

            match &node.kind {
                DecisionNode::Compute(compute) => {
                    let deps = dependency_json(&node, &values);
                    let program_state = state_for_node_with_evidence(
                        &node,
                        &values,
                        &context.bounded_state,
                        &evidence_overlays,
                    );
                    let value = self
                        .compute
                        .compute(&compute.function_ref, &program_state, &deps)
                        .await?;
                    values.insert(node.id.clone(), NodeValue::Json(value));
                    trace.push(step(&node, "deterministic compute completed"));
                    current = next_or_complete(&node)?;
                }
                DecisionNode::Choice(decision) => {
                    event_step += 1;
                    decision_calls += 1;
                    let execution = self
                        .execute_decision(
                            context,
                            &node,
                            decision.decision_type.clone(),
                            DecisionKind::Choice,
                            decision.question.clone(),
                            decision.candidates.clone(),
                            event_step,
                            &values,
                            &evidence_overlays,
                        )
                        .await?;
                    let review = execution.review_reason.clone();
                    values.insert(node.id.clone(), NodeValue::Decision(execution.value));
                    trace.push(step(&node, "typed choice completed"));
                    if let Some(reason) = review {
                        return Ok(outcome(
                            GovernedProgramStop::ReviewRequired(reason),
                            None,
                            values,
                            trace,
                            decision_calls,
                            capability_calls,
                        ));
                    }
                    current = next_or_complete(&node)?;
                }
                DecisionNode::Score(decision) => {
                    event_step += 1;
                    decision_calls += 1;
                    let execution = self
                        .execute_decision(
                            context,
                            &node,
                            decision.decision_type.clone(),
                            DecisionKind::Score,
                            decision.question.clone(),
                            Vec::new(),
                            event_step,
                            &values,
                            &evidence_overlays,
                        )
                        .await?;
                    let review = execution.review_reason.clone();
                    values.insert(node.id.clone(), NodeValue::Decision(execution.value));
                    trace.push(step(&node, "typed score completed"));
                    if let Some(reason) = review {
                        return Ok(outcome(
                            GovernedProgramStop::ReviewRequired(reason),
                            None,
                            values,
                            trace,
                            decision_calls,
                            capability_calls,
                        ));
                    }
                    current = next_or_complete(&node)?;
                }
                DecisionNode::Probability(decision) => {
                    event_step += 1;
                    decision_calls += 1;
                    let execution = self
                        .execute_decision(
                            context,
                            &node,
                            decision.decision_type.clone(),
                            DecisionKind::Probability,
                            decision.question.clone(),
                            Vec::new(),
                            event_step,
                            &values,
                            &evidence_overlays,
                        )
                        .await?;
                    let review = execution.review_reason.clone();
                    values.insert(node.id.clone(), NodeValue::Decision(execution.value));
                    trace.push(step(&node, "typed probability completed"));
                    if let Some(reason) = review {
                        return Ok(outcome(
                            GovernedProgramStop::ReviewRequired(reason),
                            None,
                            values,
                            trace,
                            decision_calls,
                            capability_calls,
                        ));
                    }
                    current = next_or_complete(&node)?;
                }
                DecisionNode::Batch(batch) => {
                    let mut work = Vec::with_capacity(batch.members.len());
                    let values_ref = &values;
                    let context_ref = context;
                    let executor_ref = self;
                    for member_id in &batch.members {
                        let member = graph
                            .get(member_id)
                            .with_context(|| format!("batch member '{member_id}' missing"))?
                            .clone();
                        ensure_dependencies(&member, &values)?;
                        event_step += 1;
                        let step_no = event_step;
                        let (decision_type, kind, question, candidates) = match &member.kind {
                            DecisionNode::Choice(decision) => (
                                decision.decision_type.clone(),
                                DecisionKind::Choice,
                                decision.question.clone(),
                                decision.candidates.clone(),
                            ),
                            DecisionNode::Score(decision) => (
                                decision.decision_type.clone(),
                                DecisionKind::Score,
                                decision.question.clone(),
                                Vec::new(),
                            ),
                            DecisionNode::Probability(decision) => (
                                decision.decision_type.clone(),
                                DecisionKind::Probability,
                                decision.question.clone(),
                                Vec::new(),
                            ),
                            _ => bail!("batch member '{member_id}' is not a decision node"),
                        };
                        let member_id = member_id.clone();
                        let values_ref = &values;
                        let overlays_ref = &evidence_overlays;
                        work.push(async move {
                            let result = self
                                .execute_decision(
                                    context,
                                    &member,
                                    decision_type,
                                    kind,
                                    question,
                                    candidates,
                                    step_no,
                                    values_ref,
                                    overlays_ref,
                                )
                                .await;
                            (member_id, result)
                        });
                    }
                    let results = join_all(work)
                        .await
                        .into_iter()
                        .map(|(id, result)| result.map(|value| (id, value)))
                        .collect::<Result<Vec<_>>>()?;
                    let mut batch_json = serde_json::Map::new();
                    for (id, execution) in results {
                        decision_calls += 1;
                        if let Some(reason) = execution.review_reason {
                            return Ok(outcome(
                                GovernedProgramStop::ReviewRequired(reason),
                                None,
                                values,
                                trace,
                                decision_calls,
                                capability_calls,
                            ));
                        }
                        batch_json.insert(id.clone(), serde_json::to_value(&execution.value)?);
                        values.insert(id, NodeValue::Decision(execution.value));
                    }
                    values.insert(node.id.clone(), NodeValue::Json(Value::Object(batch_json)));
                    trace.push(step(&node, "parallel decision batch completed"));
                    current = next_or_complete(&node)?;
                }
                DecisionNode::Gate(gate) => {
                    let source = values
                        .get(&gate.source)
                        .with_context(|| format!("gate source '{}' has no output", gate.source))?;
                    let target = self
                        .select_gate_target(context.organization_id, &gate.branches, source)
                        .await?;
                    values.insert(
                        node.id.clone(),
                        NodeValue::Json(json!({"selected_target": target})),
                    );
                    trace.push(step(&node, "deterministic gate selected a branch"));
                    current = target;
                }
                DecisionNode::Capability(capability) => {
                    capability_calls += 1;
                    let proposal = CapabilityProposal {
                        capability: capability.capability.clone(),
                        arguments: arguments_for_node(&node, &values, &context.bounded_state),
                        rationale: Some(format!(
                            "declared capability node '{}' in {}",
                            node.id, context.program_ref
                        )),
                        poll: false,
                    };
                    match self
                        .capabilities
                        .run(
                            context.run_id,
                            &proposal,
                            capability_calls.saturating_sub(1),
                        )
                        .await?
                    {
                        CapabilityStepOutcome::Executed(output)
                        | CapabilityStepOutcome::Replayed(output) => {
                            values.insert(node.id.clone(), NodeValue::Tool(output));
                            trace.push(step(&node, "governed capability completed"));
                            current = next_or_complete(&node)?;
                        }
                        CapabilityStepOutcome::Denied(reason) => {
                            return Ok(outcome(
                                GovernedProgramStop::Denied(reason),
                                None,
                                values,
                                trace,
                                decision_calls,
                                capability_calls,
                            ));
                        }
                        CapabilityStepOutcome::PendingApproval(request) => {
                            let next_node = node.next.clone().with_context(|| {
                                format!("pending capability node '{}' has no continuation", node.id)
                            })?;
                            self.checkpoint(
                                context,
                                &graph_hash,
                                &node.id,
                                &values,
                                &trace,
                                event_step,
                                decision_calls,
                                capability_calls,
                                &reason_iterations,
                                &evidence_overlays,
                                &evidence_acquisitions,
                                Some(PendingApprovalCheckpoint {
                                    node_id: node.id.clone(),
                                    capability: request.capability.clone(),
                                    reason: request.reason.clone(),
                                    draft_id: request.draft_id,
                                    next_node,
                                }),
                                "awaiting_approval",
                            )
                            .await?;
                            return Ok(outcome(
                                GovernedProgramStop::PendingApproval {
                                    capability: request.capability,
                                    reason: request.reason,
                                    draft_id: request.draft_id,
                                },
                                None,
                                values,
                                trace,
                                decision_calls,
                                capability_calls,
                            ));
                        }
                    }
                }
                DecisionNode::AcquireEvidence(acquire) => {
                    capability_calls += 1;
                    let mut arguments = arguments_for_node(&node, &values, &context.bounded_state);
                    if let Some(object) = arguments.as_object_mut() {
                        object.insert("max_rows".to_string(), acquire.max_rows.into());
                    }
                    let proposal = CapabilityProposal {
                        capability: acquire.capability.clone(),
                        arguments,
                        rationale: Some("conditional evidence acquisition".to_string()),
                        poll: false,
                    };
                    match self
                        .capabilities
                        .run(
                            context.run_id,
                            &proposal,
                            capability_calls.saturating_sub(1),
                        )
                        .await?
                    {
                        CapabilityStepOutcome::Executed(output)
                        | CapabilityStepOutcome::Replayed(output) => {
                            let count = evidence_acquisitions.entry(node.id.clone()).or_default();
                            if *count >= MAX_EVIDENCE_RERETRIEVALS {
                                return Ok(outcome(
                                    GovernedProgramStop::EarlyStop(
                                        StopReason::InsufficientEvidence,
                                    ),
                                    None,
                                    values,
                                    trace,
                                    decision_calls,
                                    capability_calls,
                                ));
                            }
                            *count += 1;

                            let evidence_value = serde_json::to_value(&output)
                                .context("serialize acquired evidence for re-evaluation")?;
                            values.insert(node.id.clone(), NodeValue::Tool(output));
                            trace.push(step(&node, "conditional evidence acquired"));

                            let invalidated = affected_closure(graph, &acquire.affects);
                            for affected in &acquire.affects {
                                evidence_overlays
                                    .entry(affected.clone())
                                    .or_default()
                                    .push(evidence_value.clone());
                            }
                            for stale in &invalidated {
                                if stale != &node.id {
                                    values.remove(stale);
                                    reason_iterations.remove(stale);
                                }
                            }
                            trace.push(GovernedProgramTraceStep {
                                node_id: node.id.clone(),
                                kind: "acquire_evidence".to_string(),
                                summary: format!(
                                    "invalidated {} affected/downstream node(s) for bounded re-evaluation",
                                    invalidated.len()
                                ),
                            });
                            current = acquire.affects.first().cloned().context(
                                "acquire evidence must declare at least one affected node",
                            )?;
                        }
                        CapabilityStepOutcome::Denied(reason) => {
                            return Ok(outcome(
                                GovernedProgramStop::Denied(reason),
                                None,
                                values,
                                trace,
                                decision_calls,
                                capability_calls,
                            ));
                        }
                        CapabilityStepOutcome::PendingApproval(request) => {
                            let next_node = node.next.clone().with_context(|| {
                                format!("pending capability node '{}' has no continuation", node.id)
                            })?;
                            self.checkpoint(
                                context,
                                &graph_hash,
                                &node.id,
                                &values,
                                &trace,
                                event_step,
                                decision_calls,
                                capability_calls,
                                &reason_iterations,
                                &evidence_overlays,
                                &evidence_acquisitions,
                                Some(PendingApprovalCheckpoint {
                                    node_id: node.id.clone(),
                                    capability: request.capability.clone(),
                                    reason: request.reason.clone(),
                                    draft_id: request.draft_id,
                                    next_node,
                                }),
                                "awaiting_approval",
                            )
                            .await?;
                            return Ok(outcome(
                                GovernedProgramStop::PendingApproval {
                                    capability: request.capability,
                                    reason: request.reason,
                                    draft_id: request.draft_id,
                                },
                                None,
                                values,
                                trace,
                                decision_calls,
                                capability_calls,
                            ));
                        }
                    }
                }
                DecisionNode::Verify(verify) => {
                    let source = values.get(&verify.source).with_context(|| {
                        format!("verify source '{}' has no output", verify.source)
                    })?;
                    let NodeValue::Tool(tool) = source else {
                        bail!(
                            "verify node '{}' source must be a capability output",
                            node.id
                        );
                    };
                    match self.verification.verify(tool, &context.evidence).await? {
                        VerificationOutcome::Verified => {
                            values.insert(
                                node.id.clone(),
                                NodeValue::Json(json!({"verified": true})),
                            );
                            trace.push(step(&node, "verification passed"));
                            current = next_or_complete(&node)?;
                        }
                        VerificationOutcome::RequiresReview { reason } => {
                            return Ok(outcome(
                                GovernedProgramStop::ReviewRequired(reason),
                                None,
                                values,
                                trace,
                                decision_calls,
                                capability_calls,
                            ));
                        }
                        VerificationOutcome::Failed { reason } => {
                            return Ok(outcome(
                                GovernedProgramStop::Denied(reason),
                                None,
                                values,
                                trace,
                                decision_calls,
                                capability_calls,
                            ));
                        }
                    }
                }
                DecisionNode::Generate(generate) => {
                    let response = self
                        .generation_provider
                        .generate(GenerationRequest {
                            objective: context.objective.clone(),
                            context: state_for_node_with_evidence(
                                &node,
                                &values,
                                &Value::Object(
                                    dependency_json(&node, &values).into_iter().collect(),
                                ),
                                &evidence_overlays,
                            ),
                            format: generate.format.clone(),
                            instructions: context.generation_instructions.clone(),
                            max_tokens: context.generation_max_tokens,
                        })
                        .await?;
                    let draft = FinalDraft {
                        content: response.content.clone(),
                        citations: evidence_for_node(&node, &values, &context.evidence),
                        ..Default::default()
                    };
                    let known_evidence = known_evidence_for_run(context, &values);
                    let data_figures = data_figures_for_run(&values);
                    let report = self
                        .answer_admission
                        .admit_with_report(
                            &draft,
                            &AdmissionEvidence {
                                known: &known_evidence,
                                data_figures: &data_figures,
                            },
                        )
                        .await?;
                    let admitted = match report.outcome {
                        AnswerAdmissionOutcome::Admitted => {
                            Ok((response.content.clone(), "generated answer admitted"))
                        }
                        AnswerAdmissionOutcome::Qualified { limitations } => Ok((
                            qualified_content(&response.content, &limitations),
                            "generated answer admitted with limitations",
                        )),
                        AnswerAdmissionOutcome::RequiresReview { reason } => {
                            if answer_reason_needs_retrieval(&reason) {
                                if let Some(acquire_node) = recovery_evidence_node(graph, &node.id) {
                                    let used = evidence_acquisitions
                                        .get(&acquire_node)
                                        .copied()
                                        .unwrap_or_default();
                                    if used < MAX_EVIDENCE_RERETRIEVALS {
                                        push_recovery_diagnostic(
                                            &mut evidence_overlays,
                                            &node.id,
                                            "re_retrieval",
                                            used.saturating_add(1),
                                            MAX_EVIDENCE_RERETRIEVALS,
                                            &reason,
                                        );
                                        trace.push(GovernedProgramTraceStep {
                                            node_id: node.id.clone(),
                                            kind: "re_retrieval".to_string(),
                                            summary: reason.clone(),
                                        });
                                        current = acquire_node;
                                        continue;
                                    }
                                }
                            }
                            Err(reason)
                        }
                        AnswerAdmissionOutcome::Blocked { reason } => {
                            if answer_reason_is_repairable(&reason) {
                                let key = format!("__repair__:{}", node.id);
                                if let Some(attempt) = reserve_recovery_attempt(
                                    &mut reason_iterations,
                                    key,
                                    MAX_GENERATION_REPAIRS,
                                ) {
                                    push_recovery_diagnostic(
                                        &mut evidence_overlays,
                                        &node.id,
                                        "repair",
                                        attempt,
                                        MAX_GENERATION_REPAIRS,
                                        &reason,
                                    );
                                    trace.push(GovernedProgramTraceStep {
                                        node_id: node.id.clone(),
                                        kind: "repair".to_string(),
                                        summary: reason.clone(),
                                    });
                                    current = node.id.clone();
                                    continue;
                                }
                            }
                            Err(reason)
                        },
                    };
                    match admitted {
                        Ok((content, summary)) => {
                            values.insert(node.id.clone(), NodeValue::Text(content.clone()));
                            trace.push(step(&node, summary));
                            if let Some(next) = &node.next {
                                current = next.clone();
                            } else {
                                let mut completed = outcome(
                                    GovernedProgramStop::Completed,
                                    Some(content),
                                    values,
                                    trace,
                                    decision_calls,
                                    capability_calls,
                                );
                                completed.generation_provider = Some(response.provider.clone());
                                completed.generation_model = Some(response.model.clone());
                                completed.generation_input_tokens = response.input_tokens;
                                completed.generation_output_tokens = response.output_tokens;
                                return Ok(completed);
                            }
                        }
                        Err(reason) => {
                            let mut review = outcome(
                                GovernedProgramStop::ReviewRequired(reason),
                                Some(response.content.clone()),
                                values,
                                trace,
                                decision_calls,
                                capability_calls,
                            );
                            review.generation_provider = Some(response.provider.clone());
                            review.generation_model = Some(response.model.clone());
                            review.generation_input_tokens = response.input_tokens;
                            review.generation_output_tokens = response.output_tokens;
                            return Ok(review);
                        }
                    }
                }
                DecisionNode::Reason(reason) => {
                    let count = reason_iterations.entry(node.id.clone()).or_default();
                    if reason.max_iterations == 0 || *count >= reason.max_iterations {
                        return Ok(outcome(
                            GovernedProgramStop::UnableToProgress(format!(
                                "reasoning node '{}' exhausted its bounded iterations",
                                node.id
                            )),
                            None,
                            values,
                            trace,
                            decision_calls,
                            capability_calls,
                        ));
                    }
                    *count += 1;
                    let reasoning_attempt = *count;
                    let request = ReasoningRequest {
                        objective: context.objective.clone(),
                        bounded_state: state_for_node_with_evidence(
                            &node,
                            &values,
                            &context.bounded_state,
                            &evidence_overlays,
                        ),
                        precedent: Vec::new(),
                        allowed_proposal_kinds: reason.allowed_proposal_kinds.clone(),
                        remaining_rounds: reason.max_iterations - *count + 1,
                    };
                    event_step += 1;
                    let reasoning_request_hash = reasoning_request_hash(&request)?;
                    let reasoning_outcome = self.reasoning_provider.reason(request.clone()).await?;
                    let reasoning_event_id = self
                        .recorder
                        .record_reasoning(
                            context,
                            event_step,
                            &reasoning_request_hash,
                            &request,
                            &reasoning_outcome,
                        )
                        .await?;
                    match reasoning_outcome {
                        ReasoningOutcome::CapabilityProposal(proposal) => {
                            if proposal.poll {
                                let key = format!("__poll__:{}", proposal.capability);
                                let Some(attempt) = reserve_recovery_attempt(
                                    &mut reason_iterations,
                                    key,
                                    MAX_POLL_ATTEMPTS,
                                ) else {
                                    return Ok(outcome(
                                        GovernedProgramStop::UnableToProgress(format!(
                                            "polling budget exhausted for capability '{}'",
                                            proposal.capability
                                        )),
                                        None,
                                        values,
                                        trace,
                                        decision_calls,
                                        capability_calls,
                                    ));
                                };
                                let backoff_ms = poll_backoff_ms(attempt);
                                trace.push(GovernedProgramTraceStep {
                                    node_id: node.id.clone(),
                                    kind: "polling".to_string(),
                                    summary: format!(
                                        "poll attempt {attempt}/{MAX_POLL_ATTEMPTS}; backoff={backoff_ms}ms"
                                    ),
                                });
                                if backoff_ms > 0 {
                                    tokio::time::sleep(std::time::Duration::from_millis(
                                        backoff_ms,
                                    ))
                                    .await;
                                }
                            }
                            capability_calls += 1;
                            match self
                                .capabilities
                                .run(
                                    context.run_id,
                                    &proposal,
                                    capability_calls.saturating_sub(1),
                                )
                                .await?
                            {
                                CapabilityStepOutcome::Executed(output)
                                | CapabilityStepOutcome::Replayed(output) => {
                                    values.insert(node.id.clone(), NodeValue::Tool(output));
                                    trace.push(step(
                                        &node,
                                        "reasoning capability proposal admitted",
                                    ));
                                }
                                CapabilityStepOutcome::Denied(reason) => {
                                    return Ok(outcome(
                                        GovernedProgramStop::Denied(reason),
                                        None,
                                        values,
                                        trace,
                                        decision_calls,
                                        capability_calls,
                                    ));
                                }
                                CapabilityStepOutcome::PendingApproval(request) => {
                                    let next_node = reason
                                        .loop_back_to
                                        .clone()
                                        .or_else(|| node.next.clone())
                                        .with_context(|| {
                                            format!("reasoning node '{}' has no continuation after approval", node.id)
                                        })?;
                                    self.checkpoint(
                                        context,
                                        &graph_hash,
                                        &node.id,
                                        &values,
                                        &trace,
                                        event_step,
                                        decision_calls,
                                        capability_calls,
                                        &reason_iterations,
                                        &evidence_overlays,
                                        &evidence_acquisitions,
                                        Some(PendingApprovalCheckpoint {
                                            node_id: node.id.clone(),
                                            capability: request.capability.clone(),
                                            reason: request.reason.clone(),
                                            draft_id: request.draft_id,
                                            next_node,
                                        }),
                                        "awaiting_approval",
                                    )
                                    .await?;
                                    return Ok(outcome(
                                        GovernedProgramStop::PendingApproval {
                                            capability: request.capability,
                                            reason: request.reason,
                                            draft_id: request.draft_id,
                                        },
                                        None,
                                        values,
                                        trace,
                                        decision_calls,
                                        capability_calls,
                                    ));
                                }
                            }
                        }
                        ReasoningOutcome::DecisionProposal(proposal) => {
                            proposal.validate()?;
                            values.insert(
                                node.id.clone(),
                                NodeValue::Json(serde_json::to_value(proposal)?),
                            );
                            trace.push(step(
                                &node,
                                "reasoning decision proposal returned to runtime",
                            ));
                        }
                        ReasoningOutcome::ProgramPatchProposal(proposal) => {
                            return Ok(outcome(
                                GovernedProgramStop::ReviewRequired(format!(
                                    "program patch proposal requires governed validation: {}",
                                    proposal.description
                                )),
                                None,
                                values,
                                trace,
                                decision_calls,
                                capability_calls,
                            ));
                        }
                        ReasoningOutcome::ClarificationRequest(request) => {
                            return Ok(outcome(
                                GovernedProgramStop::Clarification {
                                    prompt: request.prompt,
                                    options: request.options,
                                },
                                None,
                                values,
                                trace,
                                decision_calls,
                                capability_calls,
                            ));
                        }
                        ReasoningOutcome::FinalDraft(draft) => {
                            let known_evidence = known_evidence_for_run(context, &values);
                            let data_figures = data_figures_for_run(&values);
                            let report = self
                                .answer_admission
                                .admit_with_report(
                                    &draft,
                                    &AdmissionEvidence {
                                        known: &known_evidence,
                                        data_figures: &data_figures,
                                    },
                                )
                                .await?;
                            let (verification_status, verification_reason) =
                                report.verification_record();
                            let admission = report.outcome;
                            self.recorder
                                .set_verification(
                                    context,
                                    reasoning_event_id,
                                    verification_status,
                                    verification_reason,
                                )
                                .await?;
                            match admission {
                                AnswerAdmissionOutcome::Admitted => {
                                    return Ok(outcome(
                                        GovernedProgramStop::Completed,
                                        Some(draft.content),
                                        values,
                                        trace,
                                        decision_calls,
                                        capability_calls,
                                    ));
                                }
                                AnswerAdmissionOutcome::Qualified { limitations } => {
                                    return Ok(outcome(
                                        GovernedProgramStop::Completed,
                                        Some(qualified_content(&draft.content, &limitations)),
                                        values,
                                        trace,
                                        decision_calls,
                                        capability_calls,
                                    ));
                                }
                                AnswerAdmissionOutcome::RequiresReview { reason } => {
                                    if answer_reason_needs_retrieval(&reason) {
                                        if let Some(acquire_node) =
                                            recovery_evidence_node(graph, &node.id)
                                        {
                                            let used = evidence_acquisitions
                                                .get(&acquire_node)
                                                .copied()
                                                .unwrap_or_default();
                                            if used < MAX_EVIDENCE_RERETRIEVALS {
                                                push_recovery_diagnostic(
                                                    &mut evidence_overlays,
                                                    &node.id,
                                                    "re_retrieval",
                                                    used.saturating_add(1),
                                                    MAX_EVIDENCE_RERETRIEVALS,
                                                    &reason,
                                                );
                                                trace.push(GovernedProgramTraceStep {
                                                    node_id: node.id.clone(),
                                                    kind: "re_retrieval".to_string(),
                                                    summary: reason,
                                                });
                                                current = acquire_node;
                                                continue;
                                            }
                                        }
                                    }
                                    return Ok(outcome(
                                        GovernedProgramStop::ReviewRequired(reason),
                                        Some(draft.content),
                                        values,
                                        trace,
                                        decision_calls,
                                        capability_calls,
                                    ));
                                }
                                AnswerAdmissionOutcome::Blocked { reason } => {
                                    if answer_reason_is_repairable(&reason)
                                        && reasoning_attempt < reason.max_iterations
                                    {
                                        push_recovery_diagnostic(
                                            &mut evidence_overlays,
                                            &node.id,
                                            "repair",
                                            reasoning_attempt,
                                            reason.max_iterations,
                                            &reason,
                                        );
                                        trace.push(GovernedProgramTraceStep {
                                            node_id: node.id.clone(),
                                            kind: "repair".to_string(),
                                            summary: reason,
                                        });
                                        current = node.id.clone();
                                        continue;
                                    }
                                    return Ok(outcome(
                                        GovernedProgramStop::ReviewRequired(reason),
                                        Some(draft.content),
                                        values,
                                        trace,
                                        decision_calls,
                                        capability_calls,
                                    ));
                                }
                            }
                        }
                        ReasoningOutcome::UnableToProgress(unable) => {
                            let key = format!("__replan__:{}", node.id);
                            if reasoning_attempt < reason.max_iterations {
                                if let Some(attempt) = reserve_recovery_attempt(
                                    &mut reason_iterations,
                                    key,
                                    MAX_REASON_REPLANS,
                                ) {
                                    push_recovery_diagnostic(
                                        &mut evidence_overlays,
                                        &node.id,
                                        "replan",
                                        attempt,
                                        MAX_REASON_REPLANS,
                                        &unable.reason,
                                    );
                                    trace.push(GovernedProgramTraceStep {
                                        node_id: node.id.clone(),
                                        kind: "replan".to_string(),
                                        summary: unable.reason,
                                    });
                                    current = node.id.clone();
                                    continue;
                                }
                            }
                            return Ok(outcome(
                                GovernedProgramStop::UnableToProgress(unable.reason),
                                None,
                                values,
                                trace,
                                decision_calls,
                                capability_calls,
                            ));
                        }
                    }
                    current = reason
                        .loop_back_to
                        .clone()
                        .or_else(|| node.next.clone())
                        .context("reasoning node completed without a successor")?;
                }
                DecisionNode::EarlyStop(stop) => {
                    trace.push(step(&node, "deterministic early stop"));
                    return Ok(outcome(
                        GovernedProgramStop::EarlyStop(stop.reason),
                        None,
                        values,
                        trace,
                        decision_calls,
                        capability_calls,
                    ));
                }
                DecisionNode::RequireApproval(approval) => {
                    let source = values.get(&approval.source).with_context(|| {
                        format!("approval source '{}' has no output", approval.source)
                    })?;
                    let proposal = CapabilityProposal {
                        capability: approval.capability.clone(),
                        arguments: source.as_json(),
                        rationale: Some(format!(
                            "explicit approval gate '{}' for capability '{}'",
                            node.id, approval.capability
                        )),
                        poll: false,
                    };
                    let request = match self
                        .capabilities
                        .request_explicit_approval(context.run_id, &proposal, capability_calls)
                        .await?
                    {
                        Ok(request) => request,
                        Err(reason) => {
                            return Ok(outcome(
                                GovernedProgramStop::Denied(reason),
                                None,
                                values,
                                trace,
                                decision_calls,
                                capability_calls,
                            ));
                        }
                    };
                    let next_node = node.next.clone().with_context(|| {
                        format!("approval node '{}' has no continuation", node.id)
                    })?;
                    let pending = PendingApprovalCheckpoint {
                        node_id: node.id.clone(),
                        capability: request.capability.clone(),
                        reason: request.reason.clone(),
                        draft_id: request.draft_id,
                        next_node,
                    };
                    self.checkpoint(
                        context,
                        &graph_hash,
                        &node.id,
                        &values,
                        &trace,
                        event_step,
                        decision_calls,
                        capability_calls,
                        &reason_iterations,
                        &evidence_overlays,
                        &evidence_acquisitions,
                        Some(pending),
                        "awaiting_approval",
                    )
                    .await?;
                    return Ok(outcome(
                        GovernedProgramStop::PendingApproval {
                            capability: request.capability,
                            reason: request.reason,
                            draft_id: request.draft_id,
                        },
                        None,
                        values,
                        trace,
                        decision_calls,
                        capability_calls,
                    ));
                }
            }
        }

        Ok(outcome(
            GovernedProgramStop::UnableToProgress("program step bound exhausted".to_string()),
            None,
            values,
            trace,
            decision_calls,
            capability_calls,
        ))
    }

    async fn checkpoint(
        &self,
        context: &GovernedProgramContext,
        graph_hash: &str,
        current_node: &str,
        values: &HashMap<String, NodeValue>,
        trace: &[GovernedProgramTraceStep],
        event_step: u32,
        decision_calls: u32,
        capability_calls: u32,
        reason_iterations: &HashMap<String, u32>,
        evidence_overlays: &HashMap<String, Vec<Value>>,
        evidence_acquisitions: &HashMap<String, u32>,
        pending_approval: Option<PendingApprovalCheckpoint>,
        status: &str,
    ) -> Result<()> {
        let Some(store) = self.checkpoint_store else {
            return Ok(());
        };
        store
            .save(
                context,
                &GovernedProgramCheckpoint {
                    schema_version: 2,
                    program_ref: context.program_ref.clone(),
                    graph_hash: graph_hash.to_string(),
                    checkpoint_sequence: 0,
                    concurrency_version: 0,
                    parent_checkpoint_hash: None,
                    continuation_manifest: continuation_manifest(
                        context,
                        event_step,
                        values,
                        evidence_overlays,
                    )?,
                    continuation_manifest_hash: String::new(),
                    compaction_summary: CompactionSummary {
                        current_node: current_node.to_string(),
                        completed_nodes: Vec::new(),
                        event_step,
                    },
                    compaction_summary_hash: String::new(),
                    persisted_hash: None,
                    current_node: current_node.to_string(),
                    values: values.clone(),
                    trace: trace.to_vec(),
                    event_step,
                    decision_calls,
                    capability_calls,
                    reason_iterations: reason_iterations.clone(),
                    evidence_overlays: evidence_overlays.clone(),
                    evidence_acquisitions: evidence_acquisitions.clone(),
                    pending_approval,
                },
                status,
            )
            .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn execute_decision(
        &self,
        context: &GovernedProgramContext,
        node: &GraphNode,
        decision_type: super::intelligence::DecisionTypeRef,
        kind: DecisionKind,
        question: String,
        candidates: Vec<String>,
        step_no: u32,
        values: &HashMap<String, NodeValue>,
        evidence_overlays: &HashMap<String, Vec<Value>>,
    ) -> Result<DecisionExecution> {
        let definition = self
            .decision_types
            .get(&decision_type.name, decision_type.version)
            .await?
            .with_context(|| {
                format!(
                    "decision type '{}' v{} is not registered",
                    decision_type.name, decision_type.version
                )
            })?;
        let bounded_state =
            state_for_node_with_evidence(node, values, &context.bounded_state, evidence_overlays);
        let matches = self
            .precedent
            .retrieve(&PrecedentQuery {
                decision_type: decision_type.clone(),
                organization_id: context.organization_id,
                company_id: context.company_id,
                program_ref: context.program_ref.clone(),
                step_id: node.id.clone(),
                material_constraints: bounded_state.clone(),
                policy: definition.precedent_policy.clone(),
                now_micros: Utc::now().timestamp_micros(),
            })
            .await?;
        let precedent = summarize(&matches);
        let request = DecisionRequest {
            decision_type: decision_type.clone(),
            kind,
            question,
            bounded_state: bounded_state.clone(),
            candidates,
            precedent,
            evidence: context.evidence.clone(),
        };
        request.validate()?;
        let request_hash = decision_request_hash(&request)?;
        let response = if let Some(resolver) = self.decision_resolver {
            resolver
                .decide(
                    &DecisionResolutionContext {
                        organization_id: context.organization_id,
                        company_id: context.company_id,
                        run_id: context.run_id,
                        program_ref: context.program_ref.clone(),
                        step_id: node.id.clone(),
                    },
                    request.clone(),
                )
                .await?
        } else {
            self.decision_provider.decide(request.clone()).await?
        };
        response.validate_against(&request)?;
        let admission = admit_decision(&definition, &request, &response)?;

        let event_id = self
            .recorder
            .record_decision(context, step_no, &request_hash, &request, &response)
            .await?;

        let selected = decision_value(&response)?;
        let precedent_refs = request
            .precedent
            .iter()
            .filter_map(|item| item.decision_case_id.parse::<u64>().ok())
            .collect();
        self.precedent
            .record(DecisionCaseRecord {
                id: 0,
                organization_id: context.organization_id,
                company_id: context.company_id,
                run_id: context.run_id,
                step_no,
                request_hash: request_hash.clone(),
                context_fingerprint: json_fingerprint(&bounded_state)?,
                provider_attempt_id: None,
                precedent_refs,
                decision_type,
                program_ref: context.program_ref.clone(),
                step_id: node.id.clone(),
                material_constraints: bounded_state,
                selected,
                confidence: response.confidence,
                status: DecisionCaseStatus::Observed,
                correction_of: None,
                recorded_at_micros: Utc::now().timestamp_micros(),
            })
            .await?;

        if admission.verification_required {
            self.recorder
                .set_verification(
                    context,
                    event_id,
                    "requires_review",
                    Some("decision type requires independent verification".to_string()),
                )
                .await?;
        }
        let review_reason = if admission.escalation_required {
            let reason = admission
                .escalation_reason
                .unwrap_or_else(|| "decision requires escalation".to_string());
            self.recorder
                .set_escalation(context, event_id, "review_required", Some(reason.clone()))
                .await?;
            Some(reason)
        } else if admission.verification_required {
            Some("decision type requires independent verification".to_string())
        } else {
            None
        };
        if review_reason.is_none() {
            // Nothing stopped the graph from proceeding on this decision's
            // output — the governed program is about to act on it.
            self.recorder
                .set_acceptance(context, event_id, "accepted", None)
                .await?;
        }
        Ok(DecisionExecution {
            value: response,
            review_reason,
        })
    }
}

fn ensure_dependencies(node: &GraphNode, values: &HashMap<String, NodeValue>) -> Result<()> {
    for dependency in &node.depends_on {
        if !values.contains_key(dependency) {
            bail!(
                "node '{}' reached before dependency '{}' produced output",
                node.id,
                dependency
            );
        }
    }
    Ok(())
}

fn dependency_json(
    node: &GraphNode,
    values: &HashMap<String, NodeValue>,
) -> HashMap<String, Value> {
    node.depends_on
        .iter()
        .filter_map(|id| values.get(id).map(|value| (id.clone(), value.as_json())))
        .collect()
}

fn state_for_node_with_evidence(
    node: &GraphNode,
    values: &HashMap<String, NodeValue>,
    fallback: &Value,
    evidence_overlays: &HashMap<String, Vec<Value>>,
) -> Value {
    let base = state_for_node(node, values, fallback);
    let Some(overlays) = evidence_overlays.get(&node.id) else {
        return base;
    };
    match base {
        Value::Object(mut object) => {
            object.insert(
                "acquired_evidence".to_string(),
                Value::Array(overlays.clone()),
            );
            Value::Object(object)
        }
        other => json!({
            "value": other,
            "acquired_evidence": overlays,
        }),
    }
}

fn affected_closure(graph: &DecisionGraph, roots: &[String]) -> std::collections::HashSet<String> {
    let mut affected = roots
        .iter()
        .cloned()
        .collect::<std::collections::HashSet<_>>();
    let mut changed = true;
    while changed {
        changed = false;
        for node in &graph.nodes {
            if affected.contains(&node.id) {
                continue;
            }
            let depends_on_affected = node
                .depends_on
                .iter()
                .any(|dependency| affected.contains(dependency));
            let structurally_reads_affected = match &node.kind {
                DecisionNode::Gate(gate) => affected.contains(&gate.source),
                DecisionNode::Verify(verify) => affected.contains(&verify.source),
                DecisionNode::EarlyStop(stop) => affected.contains(&stop.source),
                DecisionNode::RequireApproval(approval) => affected.contains(&approval.source),
                DecisionNode::Batch(batch) => {
                    batch.members.iter().any(|member| affected.contains(member))
                }
                _ => false,
            };
            if depends_on_affected || structurally_reads_affected {
                affected.insert(node.id.clone());
                changed = true;
            }
        }
    }
    affected
}

fn state_for_node(
    node: &GraphNode,
    values: &HashMap<String, NodeValue>,
    fallback: &Value,
) -> Value {
    match node.depends_on.as_slice() {
        [] => fallback.clone(),
        [only] => values
            .get(only)
            .map(NodeValue::as_json)
            .unwrap_or_else(|| fallback.clone()),
        _ => {
            serde_json::to_value(dependency_json(node, values)).unwrap_or_else(|_| fallback.clone())
        }
    }
}

fn arguments_for_node(
    node: &GraphNode,
    values: &HashMap<String, NodeValue>,
    fallback: &Value,
) -> Value {
    let value = state_for_node(node, values, fallback);
    if value.is_object() {
        value
    } else {
        json!({"value": value})
    }
}

impl GovernedProgramExecutor<'_> {
    /// Selects the branch target for one `Gate` node. `ThresholdPolicy`
    /// branches are the only ones that can require I/O (a calibration
    /// profile lookup), which is why this — unlike every other branch
    /// condition — needs `&self`/`.await` rather than being a pure
    /// function of `(branches, source)`.
    async fn select_gate_target(
        &self,
        organization_id: u64,
        branches: &[super::decision_graph::GateBranch],
        source: &NodeValue,
    ) -> Result<String> {
        let decision = match source {
            NodeValue::Decision(decision) => decision,
            _ => bail!("gate source must be a typed decision output"),
        };
        let default = branches
            .iter()
            .find(|branch| matches!(&branch.condition, GateCondition::Default))
            .context("gate has no default branch")?;
        for branch in branches {
            let matched = match &branch.condition {
                GateCondition::ProbabilityAtLeast(threshold) => decision
                    .probability
                    .is_some_and(|value| value >= *threshold),
                GateCondition::ProbabilityBelow(threshold) => {
                    decision.probability.is_some_and(|value| value < *threshold)
                }
                GateCondition::ScoreAtLeast(threshold) => {
                    decision.score.is_some_and(|value| value >= *threshold)
                }
                GateCondition::ScoreBelow(threshold) => {
                    decision.score.is_some_and(|value| value < *threshold)
                }
                GateCondition::ChoiceEquals(expected) => {
                    decision.choice.as_deref() == Some(expected.as_str())
                }
                GateCondition::ThresholdPolicy {
                    policy,
                    calibration_profile,
                    on,
                } => {
                    // No confidence signal at all: this branch cannot
                    // match — try the remaining branches rather than
                    // failing the whole gate.
                    let Some(raw) = decision.confidence else {
                        continue;
                    };
                    let mut confidence = Confidence::Raw(raw);
                    if let Some(profile_ref) = calibration_profile {
                        let profile = self
                            .calibration
                            .get(organization_id, profile_ref)
                            .await?
                            .with_context(|| {
                                format!(
                                    "calibration profile '{}' v{} not found",
                                    profile_ref.name, profile_ref.version
                                )
                            })?;
                        confidence = profile.calibrate(confidence)?;
                    }
                    policy.evaluate(confidence)? == *on
                }
                GateCondition::Default => false,
            };
            if matched {
                return Ok(branch.target.clone());
            }
        }
        Ok(default.target.clone())
    }
}

fn decision_value(response: &DecisionResponse) -> Result<Value> {
    match response.kind {
        DecisionKind::Choice => response
            .choice
            .as_ref()
            .map(|value| Value::String(value.clone()))
            .context("choice response missing choice"),
        DecisionKind::Score => response
            .score
            .map(Value::from)
            .context("score response missing score"),
        DecisionKind::Probability => response
            .probability
            .map(Value::from)
            .context("probability response missing probability"),
    }
}

fn json_fingerprint(value: &Value) -> Result<String> {
    let encoded = serde_json::to_vec(value)?;
    Ok(format!("{:x}", Sha256::digest(encoded)))
}

fn evidence_for_node(
    node: &GraphNode,
    values: &HashMap<String, NodeValue>,
    base: &[EvidenceRef],
) -> Vec<EvidenceRef> {
    let mut evidence = base.to_vec();
    for dependency in &node.depends_on {
        if matches!(values.get(dependency), Some(NodeValue::Tool(_))) {
            evidence.push(EvidenceRef {
                kind: "capability_output".to_string(),
                id: dependency.clone(),
            });
        }
    }
    evidence
}

/// Every `EvidenceRef` the server has actually established for this run so
/// far: the run's baseline authorized evidence (`context.evidence`) plus a
/// `"capability_output"` ref for every node currently holding a real tool
/// output — a strict superset of what any single node's `evidence_for_node`
/// call would produce, since a model-authored `FinalDraft` (unlike a
/// `Generate` node's server-built citations) may legitimately cite any
/// earlier tool-backed node's output, not only its own declared
/// dependencies. `DeterministicFinalAnswerAdmission` checks every citation
/// against exactly this set — see its docs for why.
fn known_evidence_for_run(
    context: &GovernedProgramContext,
    values: &HashMap<String, NodeValue>,
) -> std::collections::HashSet<EvidenceRef> {
    let mut known: std::collections::HashSet<EvidenceRef> =
        context.evidence.iter().cloned().collect();
    for (node_id, value) in values {
        if matches!(value, NodeValue::Tool(_)) {
            known.insert(EvidenceRef {
                kind: "capability_output".to_string(),
                id: node_id.clone(),
            });
        }
    }
    known
}

/// Every number in this run's capability outputs — what the answer gate
/// checks the prose's figures against, so a figure has to trace to data
/// the server produced rather than to the drafter's say-so.
fn data_figures_for_run(values: &HashMap<String, NodeValue>) -> Vec<f64> {
    let mut figures = Vec::new();
    for value in values.values() {
        if let NodeValue::Tool(output) = value {
            collect_json_figures(&output.data, &mut figures);
        }
    }
    figures
}

/// Whether any `Capability`/`AcquireEvidence` node in `graph` names a
/// capability the embedded generated-capability catalog advertises.
/// Resolve actor grants only when the typed graph actually references a
/// generated capability. Resolving actor grants
/// (`generated_read::resolve_actor_grants`) requires real actor
/// credentials and a live HTTP round-trip to the API server, so a graph
/// that never touches a generated capability should not have to pay for
/// (or require) either.
pub(super) fn graph_requests_generated_capabilities(graph: &DecisionGraph) -> Result<bool> {
    let catalog = crate::tools::generated::embedded_catalog()?;
    Ok(graph.nodes.iter().any(|node| match &node.kind {
        DecisionNode::Capability(capability) => catalog.advertises(&capability.capability),
        DecisionNode::AcquireEvidence(acquire) => catalog.advertises(&acquire.capability),
        _ => false,
    }))
}

#[cfg(test)]
mod generated_capability_detection_tests {
    use super::*;
    use crate::orchestrator::decision_graph::{AcquireEvidenceNode, CapabilityNode};

    fn graph_with(node: GraphNode) -> DecisionGraph {
        DecisionGraph {
            entry: node.id.clone(),
            nodes: vec![node],
        }
    }

    #[test]
    fn a_built_in_tool_name_does_not_request_generated_capabilities() {
        // report_analysis_graph()'s real "analytics_summary" node — a
        // ToolRegistry built-in, not a catalog entry.
        let graph = graph_with(GraphNode {
            id: "analytics".to_string(),
            depends_on: Vec::new(),
            next: None,
            kind: DecisionNode::Capability(CapabilityNode {
                capability: "analytics_summary".to_string(),
            }),
        });
        assert!(!graph_requests_generated_capabilities(&graph).unwrap());
    }

    #[test]
    fn a_catalog_advertised_capability_key_requests_generated_capabilities() {
        // A real entry's tool.name from the embedded generated-capability
        // catalog — `advertises` checks the reviewed tool name (what a
        // CapabilityProposal/ToolCallRequest actually carries), not the
        // dotted capability_key.
        let graph = graph_with(GraphNode {
            id: "products".to_string(),
            depends_on: Vec::new(),
            next: None,
            kind: DecisionNode::Capability(CapabilityNode {
                capability: "inventory_products_read".to_string(),
            }),
        });
        assert!(graph_requests_generated_capabilities(&graph).unwrap());
    }

    #[test]
    fn an_acquire_evidence_node_is_also_checked() {
        let graph = graph_with(GraphNode {
            id: "evidence".to_string(),
            depends_on: Vec::new(),
            next: None,
            kind: DecisionNode::AcquireEvidence(AcquireEvidenceNode {
                capability: "inventory_stock_quants_read".to_string(),
                max_rows: 10,
                affects: Vec::new(),
            }),
        });
        assert!(graph_requests_generated_capabilities(&graph).unwrap());
    }
}

pub(super) fn report_analysis_graph() -> DecisionGraph {
    use super::decision_graph::{
        CapabilityNode, ComputeNode, GateBranch, GateNode, GenerateNode, ProbabilityDecisionNode,
        ReasonNode, VerifyNode,
    };
    use super::intelligence::{
        DecisionTypeRef, PROPOSAL_KIND_CLARIFICATION, PROPOSAL_KIND_FINAL_DRAFT,
    };

    DecisionGraph {
        entry: "input".to_string(),
        nodes: vec![
            GraphNode {
                id: "input".to_string(),
                depends_on: Vec::new(),
                next: Some("analytics".to_string()),
                kind: DecisionNode::Compute(ComputeNode {
                    function_ref: "program_input".to_string(),
                }),
            },
            GraphNode {
                id: "analytics".to_string(),
                depends_on: vec!["input".to_string()],
                next: Some("verify_analytics".to_string()),
                kind: DecisionNode::Capability(CapabilityNode {
                    capability: "analytics_summary".to_string(),
                }),
            },
            GraphNode {
                id: "verify_analytics".to_string(),
                depends_on: vec!["analytics".to_string()],
                next: Some("attention".to_string()),
                kind: DecisionNode::Verify(VerifyNode {
                    source: "analytics".to_string(),
                }),
            },
            GraphNode {
                id: "attention".to_string(),
                depends_on: vec!["analytics".to_string()],
                next: Some("route".to_string()),
                kind: DecisionNode::Probability(ProbabilityDecisionNode {
                    decision_type: DecisionTypeRef {
                        name: "ReportAttentionNeed".to_string(),
                        version: 1,
                    },
                    question: "How likely is it that this analytics summary contains a material pattern that deserves focused human follow-up?".to_string(),
                }),
            },
            GraphNode {
                id: "route".to_string(),
                depends_on: vec!["attention".to_string()],
                next: None,
                kind: DecisionNode::Gate(GateNode {
                    source: "attention".to_string(),
                    branches: vec![
                        GateBranch {
                            condition: GateCondition::ProbabilityAtLeast(0.65),
                            target: "generate_attention".to_string(),
                        },
                        GateBranch {
                            condition: GateCondition::ProbabilityBelow(0.35),
                            target: "generate_standard".to_string(),
                        },
                        GateBranch {
                            condition: GateCondition::Default,
                            target: "reason_ambiguous".to_string(),
                        },
                    ],
                }),
            },
            GraphNode {
                id: "reason_ambiguous".to_string(),
                depends_on: vec!["analytics".to_string(), "attention".to_string()],
                next: None,
                kind: DecisionNode::Reason(ReasonNode {
                    allowed_proposal_kinds: vec![
                        PROPOSAL_KIND_FINAL_DRAFT.to_string(),
                        PROPOSAL_KIND_CLARIFICATION.to_string(),
                    ],
                    max_iterations: 1,
                    loop_back_to: None,
                }),
            },
            GraphNode {
                id: "generate_attention".to_string(),
                depends_on: vec!["analytics".to_string(), "attention".to_string()],
                next: None,
                kind: DecisionNode::Generate(GenerateNode {
                    format: "concise report highlighting material patterns and follow-up items".to_string(),
                }),
            },
            GraphNode {
                id: "generate_standard".to_string(),
                depends_on: vec!["analytics".to_string(), "attention".to_string()],
                next: None,
                kind: DecisionNode::Generate(GenerateNode {
                    format: "concise analytical summary".to_string(),
                }),
            },
        ],
    }
}

fn decision_kind_label(kind: DecisionKind) -> &'static str {
    match kind {
        DecisionKind::Choice => "choice",
        DecisionKind::Score => "score",
        DecisionKind::Probability => "probability",
    }
}

fn step(node: &GraphNode, summary: impl Into<String>) -> GovernedProgramTraceStep {
    GovernedProgramTraceStep {
        node_id: node.id.clone(),
        kind: node.kind.label().to_string(),
        summary: summary.into(),
    }
}

fn next_or_complete(node: &GraphNode) -> Result<String> {
    if let Some(next) = &node.next {
        return Ok(next.clone());
    }
    bail!(
        "terminal node '{}' must be Generate, EarlyStop, or have a next successor",
        node.id
    )
}

fn outcome(
    stop: GovernedProgramStop,
    final_content: Option<String>,
    values: HashMap<String, NodeValue>,
    trace: Vec<GovernedProgramTraceStep>,
    decision_calls: u32,
    capability_calls: u32,
) -> GovernedProgramOutcome {
    GovernedProgramOutcome {
        stop,
        final_content,
        outputs: values
            .into_iter()
            .map(|(id, value)| (id, value.as_json()))
            .collect(),
        trace,
        decision_calls,
        capability_calls,
        generation_provider: None,
        generation_model: None,
        generation_input_tokens: 0,
        generation_output_tokens: 0,
    }
}

#[cfg(test)]
mod continuation_lineage_tests {
    use super::*;

    fn context(evidence_id: &str) -> GovernedProgramContext {
        GovernedProgramContext {
            organization_id: 7,
            company_id: 11,
            run_id: 13,
            program_ref: "lineage-test".to_string(),
            objective: "test checked continuation".to_string(),
            bounded_state: json!({"question": "what changed?"}),
            evidence: vec![EvidenceRef {
                kind: "knowledge_version".to_string(),
                id: evidence_id.to_string(),
            }],
            generation_instructions: None,
            generation_max_tokens: None,
        }
    }

    fn checkpoint(context: &GovernedProgramContext) -> GovernedProgramCheckpoint {
        let mut checkpoint = GovernedProgramCheckpoint {
            schema_version: 2,
            program_ref: context.program_ref.clone(),
            graph_hash: "graph-hash".to_string(),
            checkpoint_sequence: 2,
            concurrency_version: 2,
            parent_checkpoint_hash: Some("b".repeat(64)),
            continuation_manifest: continuation_manifest(
                context,
                3,
                &HashMap::new(),
                &HashMap::new(),
            )
            .unwrap(),
            continuation_manifest_hash: String::new(),
            compaction_summary: CompactionSummary {
                current_node: String::new(),
                completed_nodes: Vec::new(),
                event_step: 0,
            },
            compaction_summary_hash: String::new(),
            persisted_hash: None,
            current_node: "review".to_string(),
            values: HashMap::from([("collect".to_string(), NodeValue::Json(json!({"ok": true})))]),
            trace: vec![GovernedProgramTraceStep {
                node_id: "collect".to_string(),
                kind: "compute".to_string(),
                summary: "collected".to_string(),
            }],
            event_step: 3,
            decision_calls: 1,
            capability_calls: 0,
            reason_iterations: HashMap::new(),
            evidence_overlays: HashMap::new(),
            evidence_acquisitions: HashMap::new(),
            pending_approval: None,
        };
        checkpoint.continuation_manifest = continuation_manifest(
            context,
            checkpoint.event_step,
            &checkpoint.values,
            &checkpoint.evidence_overlays,
        )
        .unwrap();
        checkpoint.continuation_manifest_hash =
            hash_json(&checkpoint.continuation_manifest).unwrap();
        checkpoint.compaction_summary = compaction_summary(&checkpoint);
        checkpoint.compaction_summary_hash = hash_json(&checkpoint.compaction_summary).unwrap();
        checkpoint
    }

    #[test]
    fn continuation_rejects_revoked_or_replaced_dependency_snapshot() {
        let original = context("knowledge:42:version:3");
        let checkpoint = checkpoint(&original);
        checkpoint.validate_continuation(&original).unwrap();

        let replacement = context("knowledge:42:version:4");
        let error = checkpoint.validate_continuation(&replacement).unwrap_err();
        assert!(error
            .to_string()
            .contains("dependencies changed or were revoked"));
    }

    #[test]
    fn continuation_rejects_forged_compaction_summary_and_cursor() {
        let context = context("knowledge:42:version:3");
        let mut forged_summary = checkpoint(&context);
        forged_summary.compaction_summary.current_node = "publish".to_string();
        assert!(forged_summary.validate_continuation(&context).is_err());

        let mut forged_cursor = checkpoint(&context);
        forged_cursor.concurrency_version = 9;
        assert!(forged_cursor.validate_continuation(&context).is_err());
    }
}

#[cfg(test)]
mod threshold_gate_tests {
    //! End-to-end coverage for GP-09's raw-vs-calibrated confidence
    //! invariant actually reaching `GovernedProgramExecutor::run` — the
    //! gap this module's docs used to describe as "GP-08's
    //! `GateCondition::ProbabilityAtLeast(f64)` still does that [hardcodes
    //! a literal] today" (`probabilistic.rs`). A `Gate` node with a
    //! `GateCondition::ThresholdPolicy` branch must read `confidence`
    //! (never `probability`), and `require_calibrated` must actually
    //! block an uncalibrated value from reaching a consequential branch,
    //! not just type-check in isolation the way `probabilistic.rs`'s own
    //! unit tests already proved before this module wired it in.

    use super::*;
    use crate::orchestrator::decision_graph::{
        DecisionGraph, GateBranch, GateNode, ProbabilityDecisionNode,
    };
    use crate::orchestrator::decision_type::InMemoryDecisionTypeRegistry;
    use crate::orchestrator::governed_services::{
        CapabilityAdmission, CapabilityExecutor, InMemoryExecutionRecovery,
        RecordingApprovalCoordinator, ShapeOnlyFinalAnswerAdmission, ShapeOnlyVerificationService,
    };
    use crate::orchestrator::intelligence::{
        DecisionRequest, DecisionResponse, GenerationRequest, GenerationResponse, ReasoningOutcome,
        ReasoningRequest,
    };
    use crate::orchestrator::precedent::InMemoryPrecedentStore;
    use crate::orchestrator::probabilistic::{
        CalibrationProfile, CalibrationProfileRef, GateDecision, InMemoryCalibrationProfileStore,
        ThresholdGatePolicy,
    };
    use crate::tools::types::ToolOutput;

    struct FixedDecisionProvider(DecisionResponse);

    #[async_trait]
    impl DecisionProvider for FixedDecisionProvider {
        async fn decide(&self, _request: DecisionRequest) -> Result<DecisionResponse> {
            Ok(self.0.clone())
        }
    }

    struct UnreachableGenerationProvider;

    #[async_trait]
    impl GenerationProvider for UnreachableGenerationProvider {
        async fn generate(&self, _request: GenerationRequest) -> Result<GenerationResponse> {
            bail!("generation provider must not be called by a gate-only test graph")
        }
    }

    struct UnreachableReasoningProvider;

    #[async_trait]
    impl ReasoningProvider for UnreachableReasoningProvider {
        async fn reason(&self, _request: ReasoningRequest) -> Result<ReasoningOutcome> {
            bail!("reasoning provider must not be called by a gate-only test graph")
        }
    }

    struct UnreachableCapabilityAdmission;

    #[async_trait]
    impl CapabilityAdmission for UnreachableCapabilityAdmission {
        async fn admit(
            &self,
            _proposal: &CapabilityProposal,
            _completed_calls: u32,
        ) -> Result<crate::harness::audit::PolicyDecision> {
            bail!("capability admission must not be called by a gate-only test graph")
        }

        async fn protect_output(
            &self,
            _proposal: &CapabilityProposal,
            _completed_calls: u32,
            _output: ToolOutput,
        ) -> Result<ToolOutput> {
            bail!("capability admission must not be called by a gate-only test graph")
        }
    }

    struct UnreachableCapabilityExecutor;

    #[async_trait]
    impl CapabilityExecutor for UnreachableCapabilityExecutor {
        async fn execute(&self, _proposal: &CapabilityProposal) -> Result<ToolOutput> {
            bail!("capability executor must not be called by a gate-only test graph")
        }
    }

    /// `risk` (Probability, StockReorderPriority builtin) -> `gate` (the
    /// `ThresholdPolicy` branch under test, escalate vs default) ->
    /// `stop_escalate` | `stop_continue` (distinguishable `EarlyStop`
    /// reasons standing in for whatever real downstream nodes would do).
    fn graph(condition: super::super::decision_graph::GateCondition) -> DecisionGraph {
        DecisionGraph {
            entry: "risk".to_string(),
            nodes: vec![
                GraphNode {
                    id: "risk".to_string(),
                    depends_on: Vec::new(),
                    next: Some("gate".to_string()),
                    kind: DecisionNode::Probability(ProbabilityDecisionNode {
                        decision_type: super::super::intelligence::DecisionTypeRef {
                            name: "StockReorderPriority".to_string(),
                            version: 1,
                        },
                        question: "how urgent is this reorder?".to_string(),
                    }),
                },
                GraphNode {
                    id: "gate".to_string(),
                    depends_on: vec!["risk".to_string()],
                    next: None,
                    kind: DecisionNode::Gate(GateNode {
                        source: "risk".to_string(),
                        branches: vec![
                            GateBranch {
                                condition,
                                target: "stop_escalate".to_string(),
                            },
                            GateBranch {
                                condition: super::super::decision_graph::GateCondition::Default,
                                target: "stop_continue".to_string(),
                            },
                        ],
                    }),
                },
                GraphNode {
                    id: "stop_escalate".to_string(),
                    depends_on: Vec::new(),
                    next: None,
                    kind: DecisionNode::EarlyStop(super::super::decision_graph::EarlyStopNode {
                        source: "gate".to_string(),
                        reason: StopReason::PolicyViolation,
                    }),
                },
                GraphNode {
                    id: "stop_continue".to_string(),
                    depends_on: Vec::new(),
                    next: None,
                    kind: DecisionNode::EarlyStop(super::super::decision_graph::EarlyStopNode {
                        source: "gate".to_string(),
                        reason: StopReason::AlreadySettled,
                    }),
                },
            ],
        }
    }

    fn context() -> GovernedProgramContext {
        GovernedProgramContext {
            organization_id: 9,
            company_id: 3,
            run_id: 42,
            program_ref: "test-threshold-gate".to_string(),
            objective: "decide reorder urgency".to_string(),
            bounded_state: json!({"sku": "SKU-1"}),
            evidence: Vec::new(),
            generation_instructions: None,
            generation_max_tokens: None,
        }
    }

    fn probability_response(confidence: f64) -> DecisionResponse {
        DecisionResponse {
            kind: DecisionKind::Probability,
            choice: None,
            score: None,
            probability: Some(0.5),
            confidence: Some(confidence),
            rationale: None,
            model: "test-model".to_string(),
            provider: "test-provider".to_string(),
            input_tokens: 1,
            output_tokens: 1,
        }
    }

    async fn run_graph(
        condition: super::super::decision_graph::GateCondition,
        confidence: f64,
        calibration: &dyn super::super::probabilistic::CalibrationProfileStore,
    ) -> Result<GovernedProgramOutcome> {
        let decision_provider = FixedDecisionProvider(probability_response(confidence));
        let generation_provider = UnreachableGenerationProvider;
        let reasoning_provider = UnreachableReasoningProvider;
        let decision_types = InMemoryDecisionTypeRegistry::with_builtins();
        let precedent = InMemoryPrecedentStore::new();
        let admission = UnreachableCapabilityAdmission;
        let executor_svc = UnreachableCapabilityExecutor;
        let recovery = InMemoryExecutionRecovery::new();
        let approvals = RecordingApprovalCoordinator;
        let capabilities =
            GovernedCapabilityService::new(&admission, &executor_svc, &recovery, &approvals);
        let verification = ShapeOnlyVerificationService;
        let answer_admission = ShapeOnlyFinalAnswerAdmission;
        let compute = BuiltinComputeService;
        let recorder = NoopIntelligenceEventRecorder;
        let executor = GovernedProgramExecutor {
            decision_provider: &decision_provider,
            checkpoint_store: None,
            decision_resolver: None,
            generation_provider: &generation_provider,
            reasoning_provider: &reasoning_provider,
            decision_types: &decision_types,
            precedent: &precedent,
            capabilities: &capabilities,
            verification: &verification,
            answer_admission: &answer_admission,
            compute: &compute,
            recorder: &recorder,
            calibration,
        };
        executor.run(&graph(condition), &context()).await
    }

    #[test]
    fn affected_closure_invalidates_only_declared_downstream_dependents() {
        let graph = DecisionGraph {
            entry: "a".into(),
            nodes: vec![
                GraphNode {
                    id: "a".into(),
                    depends_on: vec![],
                    next: Some("b".into()),
                    kind: DecisionNode::Compute(super::super::decision_graph::ComputeNode {
                        function_ref: "program_input".into(),
                    }),
                },
                GraphNode {
                    id: "b".into(),
                    depends_on: vec!["a".into()],
                    next: Some("c".into()),
                    kind: DecisionNode::Compute(super::super::decision_graph::ComputeNode {
                        function_ref: "dependency_object".into(),
                    }),
                },
                GraphNode {
                    id: "c".into(),
                    depends_on: vec!["b".into()],
                    next: None,
                    kind: DecisionNode::Generate(super::super::decision_graph::GenerateNode {
                        format: "x".into(),
                    }),
                },
                GraphNode {
                    id: "unrelated".into(),
                    depends_on: vec![],
                    next: None,
                    kind: DecisionNode::Compute(super::super::decision_graph::ComputeNode {
                        function_ref: "program_input".into(),
                    }),
                },
            ],
        };
        let affected = affected_closure(&graph, &["a".to_string()]);
        assert!(affected.contains("a"));
        assert!(affected.contains("b"));
        assert!(affected.contains("c"));
        assert!(!affected.contains("unrelated"));
    }

    #[test]
    fn evidence_overlay_preserves_original_object_shape() {
        let node = GraphNode {
            id: "decision".into(),
            depends_on: vec![],
            next: None,
            kind: DecisionNode::Probability(ProbabilityDecisionNode {
                decision_type: super::super::intelligence::DecisionTypeRef {
                    name: "StockReorderPriority".into(),
                    version: 1,
                },
                question: "q".into(),
            }),
        };
        let overlays = HashMap::from([(
            "decision".to_string(),
            vec![json!({"summary":"new evidence"})],
        )]);
        let state = state_for_node_with_evidence(
            &node,
            &HashMap::new(),
            &json!({"sku":"SKU-1"}),
            &overlays,
        );
        assert_eq!(state["sku"], "SKU-1");
        assert_eq!(state["acquired_evidence"][0]["summary"], "new evidence");
    }

    #[test]
    fn graph_hash_changes_when_graph_semantics_change() {
        let first = graph(super::super::decision_graph::GateCondition::ProbabilityAtLeast(0.5));
        let second = graph(super::super::decision_graph::GateCondition::ProbabilityAtLeast(0.6));
        assert_ne!(graph_hash(&first), graph_hash(&second));
    }

    #[tokio::test]
    async fn raw_confidence_above_hard_stop_escalates() {
        let calibration = InMemoryCalibrationProfileStore::new();
        let condition = super::super::decision_graph::GateCondition::ThresholdPolicy {
            policy: ThresholdGatePolicy {
                name: "reorder-urgency".to_string(),
                hard_stop_at_least: Some(0.8),
                continue_below: Some(0.2),
                require_calibrated: false,
            },
            calibration_profile: None,
            on: GateDecision::Escalate,
        };
        let outcome = run_graph(condition, 0.9, &calibration).await.unwrap();
        assert!(matches!(
            outcome.stop,
            GovernedProgramStop::EarlyStop(StopReason::PolicyViolation)
        ));
    }

    #[tokio::test]
    async fn require_calibrated_blocks_a_qualifying_raw_confidence() {
        // Same 0.9 raw confidence, same 0.8 hard-stop threshold as the
        // test above — the only difference is require_calibrated: true
        // with no calibration profile. If this escalated, GP-09's core
        // invariant ("raw confidence never gates a consequential
        // decision") would be violated by the actual executor, not just
        // unenforced in probabilistic.rs's orphaned types.
        let calibration = InMemoryCalibrationProfileStore::new();
        let condition = super::super::decision_graph::GateCondition::ThresholdPolicy {
            policy: ThresholdGatePolicy {
                name: "reorder-urgency".to_string(),
                hard_stop_at_least: Some(0.8),
                continue_below: Some(0.2),
                require_calibrated: true,
            },
            calibration_profile: None,
            on: GateDecision::Escalate,
        };
        let outcome = run_graph(condition, 0.9, &calibration).await.unwrap();
        assert!(matches!(
            outcome.stop,
            GovernedProgramStop::EarlyStop(StopReason::AlreadySettled)
        ));
    }

    #[tokio::test]
    async fn calibrated_confidence_from_a_registered_profile_can_escalate() {
        let calibration = InMemoryCalibrationProfileStore::new();
        let profile_ref = CalibrationProfileRef {
            name: "reorder-identity".to_string(),
            version: 1,
        };
        calibration
            .register(CalibrationProfile {
                profile_ref: profile_ref.clone(),
                breakpoints: vec![(0.0, 0.0), (1.0, 1.0)],
            })
            .unwrap();
        let condition = super::super::decision_graph::GateCondition::ThresholdPolicy {
            policy: ThresholdGatePolicy {
                name: "reorder-urgency".to_string(),
                hard_stop_at_least: Some(0.8),
                continue_below: Some(0.2),
                require_calibrated: true,
            },
            calibration_profile: Some(profile_ref),
            on: GateDecision::Escalate,
        };
        let outcome = run_graph(condition, 0.9, &calibration).await.unwrap();
        assert!(matches!(
            outcome.stop,
            GovernedProgramStop::EarlyStop(StopReason::PolicyViolation)
        ));
    }

    #[tokio::test]
    async fn unresolvable_calibration_profile_fails_closed_rather_than_silently_proceeding() {
        let calibration = InMemoryCalibrationProfileStore::new();
        let condition = super::super::decision_graph::GateCondition::ThresholdPolicy {
            policy: ThresholdGatePolicy {
                name: "reorder-urgency".to_string(),
                hard_stop_at_least: Some(0.8),
                continue_below: Some(0.2),
                require_calibrated: true,
            },
            calibration_profile: Some(CalibrationProfileRef {
                name: "does-not-exist".to_string(),
                version: 1,
            }),
            on: GateDecision::Escalate,
        };
        let error = run_graph(condition, 0.9, &calibration).await.unwrap_err();
        assert!(error.to_string().contains("not found"));
    }

    /// GP-05: durable evidence for the *lifecycle* around a recorded
    /// decision event — verification/escalation/acceptance — not just the
    /// initial `record_decision` call. Captures every `IntelligenceEventRecorder`
    /// call instead of a real `StdbClient`, since none of these tests need
    /// the SQL round-trip `StdbIntelligenceEventRecorder::resolve_event_id`
    /// performs against a live server.
    #[derive(Default)]
    struct RecordingIntelligenceRecorder {
        next_id: std::sync::atomic::AtomicU64,
        decisions: std::sync::Mutex<Vec<DecisionResponse>>,
        reasonings: std::sync::Mutex<Vec<String>>,
        verifications: std::sync::Mutex<Vec<(u64, String, Option<String>)>>,
        escalations: std::sync::Mutex<Vec<(u64, String, Option<String>)>>,
        acceptances: std::sync::Mutex<Vec<(u64, String, Option<String>)>>,
    }

    #[async_trait]
    impl IntelligenceEventRecorder for RecordingIntelligenceRecorder {
        async fn record_decision(
            &self,
            _context: &GovernedProgramContext,
            _step_no: u32,
            _request_hash: &str,
            _request: &DecisionRequest,
            response: &DecisionResponse,
        ) -> Result<u64> {
            self.decisions.lock().unwrap().push(response.clone());
            Ok(self
                .next_id
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
                + 1)
        }

        async fn record_reasoning(
            &self,
            _context: &GovernedProgramContext,
            _step_no: u32,
            _request_hash: &str,
            _request: &ReasoningRequest,
            outcome: &ReasoningOutcome,
        ) -> Result<u64> {
            self.reasonings
                .lock()
                .unwrap()
                .push(reasoning_outcome_kind_label(outcome).to_string());
            Ok(self
                .next_id
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
                + 1)
        }

        async fn set_verification(
            &self,
            _context: &GovernedProgramContext,
            event_id: u64,
            status: &str,
            reason: Option<String>,
        ) -> Result<()> {
            self.verifications
                .lock()
                .unwrap()
                .push((event_id, status.to_string(), reason));
            Ok(())
        }

        async fn set_escalation(
            &self,
            _context: &GovernedProgramContext,
            event_id: u64,
            status: &str,
            reason: Option<String>,
        ) -> Result<()> {
            self.escalations
                .lock()
                .unwrap()
                .push((event_id, status.to_string(), reason));
            Ok(())
        }

        async fn set_acceptance(
            &self,
            _context: &GovernedProgramContext,
            event_id: u64,
            status: &str,
            reason: Option<String>,
        ) -> Result<()> {
            self.acceptances
                .lock()
                .unwrap()
                .push((event_id, status.to_string(), reason));
            Ok(())
        }
    }

    /// A single Probability decision node followed by an EarlyStop — just
    /// enough graph to exercise `execute_decision`'s recorder lifecycle
    /// without a Gate in the way.
    fn single_decision_graph() -> DecisionGraph {
        DecisionGraph {
            entry: "risk".to_string(),
            nodes: vec![
                GraphNode {
                    id: "risk".to_string(),
                    depends_on: Vec::new(),
                    next: Some("stop".to_string()),
                    kind: DecisionNode::Probability(ProbabilityDecisionNode {
                        decision_type: super::super::intelligence::DecisionTypeRef {
                            name: "StockReorderPriority".to_string(),
                            version: 1,
                        },
                        question: "how urgent is this reorder?".to_string(),
                    }),
                },
                GraphNode {
                    id: "stop".to_string(),
                    depends_on: Vec::new(),
                    next: None,
                    kind: DecisionNode::EarlyStop(super::super::decision_graph::EarlyStopNode {
                        source: "risk".to_string(),
                        reason: StopReason::AlreadySettled,
                    }),
                },
            ],
        }
    }

    async fn run_single_decision(
        confidence: f64,
        recorder: &RecordingIntelligenceRecorder,
    ) -> GovernedProgramOutcome {
        let decision_provider = FixedDecisionProvider(probability_response(confidence));
        let generation_provider = UnreachableGenerationProvider;
        let reasoning_provider = UnreachableReasoningProvider;
        let decision_types = InMemoryDecisionTypeRegistry::with_builtins();
        let precedent = InMemoryPrecedentStore::new();
        let admission = UnreachableCapabilityAdmission;
        let executor_svc = UnreachableCapabilityExecutor;
        let recovery = InMemoryExecutionRecovery::new();
        let approvals = RecordingApprovalCoordinator;
        let capabilities =
            GovernedCapabilityService::new(&admission, &executor_svc, &recovery, &approvals);
        let verification = ShapeOnlyVerificationService;
        let answer_admission = ShapeOnlyFinalAnswerAdmission;
        let compute = BuiltinComputeService;
        let calibration = InMemoryCalibrationProfileStore::new();
        let executor = GovernedProgramExecutor {
            decision_provider: &decision_provider,
            checkpoint_store: None,
            decision_resolver: None,
            generation_provider: &generation_provider,
            reasoning_provider: &reasoning_provider,
            decision_types: &decision_types,
            precedent: &precedent,
            capabilities: &capabilities,
            verification: &verification,
            answer_admission: &answer_admission,
            compute: &compute,
            recorder,
            calibration: &calibration,
        };
        executor
            .run(&single_decision_graph(), &context())
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn a_decision_the_program_proceeds_on_is_marked_accepted() {
        // StockReorderPriority's escalation_policy.min_confidence is 0.4;
        // 0.9 clears it, so admit_decision never sets escalation_required
        // and the graph proceeds straight to the EarlyStop.
        let recorder = RecordingIntelligenceRecorder::default();
        let outcome = run_single_decision(0.9, &recorder).await;
        assert!(matches!(
            outcome.stop,
            GovernedProgramStop::EarlyStop(StopReason::AlreadySettled)
        ));
        assert_eq!(recorder.decisions.lock().unwrap().len(), 1);
        let acceptances = recorder.acceptances.lock().unwrap();
        assert_eq!(acceptances.len(), 1);
        assert_eq!(acceptances[0].1, "accepted");
        assert!(recorder.escalations.lock().unwrap().is_empty());
        assert!(recorder.verifications.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_decision_below_the_confidence_floor_is_escalated_not_accepted() {
        // 0.1 < StockReorderPriority's 0.4 floor: admit_decision sets
        // escalation_required, so the run stops for review before ever
        // reaching the EarlyStop node.
        let recorder = RecordingIntelligenceRecorder::default();
        let outcome = run_single_decision(0.1, &recorder).await;
        assert!(matches!(
            outcome.stop,
            GovernedProgramStop::ReviewRequired(_)
        ));
        let escalations = recorder.escalations.lock().unwrap();
        assert_eq!(escalations.len(), 1);
        assert_eq!(escalations[0].1, "review_required");
        assert!(escalations[0].2.is_some());
        assert!(
            recorder.acceptances.lock().unwrap().is_empty(),
            "a decision requiring escalation must not also be marked accepted"
        );
    }

    // ── AIH-15: the real answer gate, through the program runtime ──────────

    struct ScriptedGeneration(&'static str);

    #[async_trait]
    impl GenerationProvider for ScriptedGeneration {
        async fn generate(&self, _request: GenerationRequest) -> Result<GenerationResponse> {
            Ok(GenerationResponse {
                content: self.0.to_string(),
                model: "m".to_string(),
                provider: "p".to_string(),
                input_tokens: 1,
                output_tokens: 1,
            })
        }
    }

    struct ScriptedReasoning(std::sync::Mutex<Option<ReasoningOutcome>>);

    #[async_trait]
    impl ReasoningProvider for ScriptedReasoning {
        async fn reason(&self, _request: ReasoningRequest) -> Result<ReasoningOutcome> {
            Ok(self.0.lock().unwrap().take().expect("one scripted outcome"))
        }
    }

    struct EmptyCatalog;

    #[async_trait]
    impl crate::orchestrator::answer_gate::PassageCatalog for EmptyCatalog {
        async fn source_passages(
            &self,
            _organization_id: u64,
            _company_id: u64,
            _kind: &str,
            _source_key: &str,
        ) -> Result<Vec<crate::orchestrator::answer_gate::SourcePassage>> {
            Ok(Vec::new())
        }
    }

    fn gate_context() -> GovernedProgramContext {
        GovernedProgramContext {
            evidence: vec![EvidenceRef {
                kind: "governed_run_step".to_string(),
                id: "run:42:analytics".to_string(),
            }],
            ..context()
        }
    }

    fn generate_graph() -> DecisionGraph {
        DecisionGraph {
            entry: "input".to_string(),
            nodes: vec![
                GraphNode {
                    id: "input".to_string(),
                    depends_on: Vec::new(),
                    next: Some("answer".to_string()),
                    kind: DecisionNode::Compute(super::super::decision_graph::ComputeNode {
                        function_ref: "program_input".to_string(),
                    }),
                },
                GraphNode {
                    id: "answer".to_string(),
                    depends_on: vec!["input".to_string()],
                    next: None,
                    kind: DecisionNode::Generate(super::super::decision_graph::GenerateNode {
                        format: "summary".to_string(),
                    }),
                },
            ],
        }
    }

    fn reason_graph() -> DecisionGraph {
        DecisionGraph {
            entry: "think".to_string(),
            nodes: vec![GraphNode {
                id: "think".to_string(),
                depends_on: Vec::new(),
                next: None,
                kind: DecisionNode::Reason(super::super::decision_graph::ReasonNode {
                    allowed_proposal_kinds: vec![
                        super::super::intelligence::PROPOSAL_KIND_FINAL_DRAFT.to_string(),
                    ],
                    max_iterations: 1,
                    loop_back_to: None,
                }),
            }],
        }
    }

    async fn run_with_real_gate(
        graph: &DecisionGraph,
        generation: &dyn GenerationProvider,
        reasoning: &dyn ReasoningProvider,
        recorder: &RecordingIntelligenceRecorder,
    ) -> GovernedProgramOutcome {
        use crate::orchestrator::answer_gate::{
            EvidenceBackedVerificationService, EvidenceGatedAnswerAdmission, GatePolicy, GateScope,
        };
        let decision_provider = FixedDecisionProvider(probability_response(0.9));
        let decision_types = InMemoryDecisionTypeRegistry::with_builtins();
        let precedent = InMemoryPrecedentStore::new();
        let admission = UnreachableCapabilityAdmission;
        let executor_svc = UnreachableCapabilityExecutor;
        let recovery = InMemoryExecutionRecovery::new();
        let approvals = RecordingApprovalCoordinator;
        let capabilities =
            GovernedCapabilityService::new(&admission, &executor_svc, &recovery, &approvals);
        let verification = EvidenceBackedVerificationService;
        let catalog = EmptyCatalog;
        let answer_admission = EvidenceGatedAnswerAdmission {
            scope: GateScope {
                organization_id: 9,
                company_id: 3,
                as_of_micros: 1_700_000_000_000_000,
                required_applicability: Vec::new(),
            },
            policy: GatePolicy::default(),
            catalog: &catalog,
            claim_checker: None,
            reviewed_claims: None,
        };
        let compute = BuiltinComputeService;
        let calibration = InMemoryCalibrationProfileStore::new();
        let executor = GovernedProgramExecutor {
            decision_provider: &decision_provider,
            checkpoint_store: None,
            decision_resolver: None,
            generation_provider: generation,
            reasoning_provider: reasoning,
            decision_types: &decision_types,
            precedent: &precedent,
            capabilities: &capabilities,
            verification: &verification,
            answer_admission: &answer_admission,
            compute: &compute,
            recorder,
            calibration: &calibration,
        };
        executor.run(graph, &gate_context()).await.unwrap()
    }

    #[tokio::test]
    async fn a_generated_answer_with_ungrounded_figures_completes_qualified() {
        let recorder = RecordingIntelligenceRecorder::default();
        let outcome = run_with_real_gate(
            &generate_graph(),
            &ScriptedGeneration("Revenue was $9,999.99 this quarter."),
            &UnreachableReasoningProvider,
            &recorder,
        )
        .await;
        assert!(matches!(outcome.stop, GovernedProgramStop::Completed));
        let content = outcome.final_content.unwrap();
        assert!(content.contains("Revenue was $9,999.99"));
        assert!(content.contains("Limitations of this answer:"));
        assert!(content.contains("9,999.99"));
        assert_eq!(
            outcome.trace.last().unwrap().summary,
            "generated answer admitted with limitations"
        );
    }

    #[tokio::test]
    async fn a_generated_answer_without_material_figures_is_admitted_plainly() {
        let recorder = RecordingIntelligenceRecorder::default();
        let outcome = run_with_real_gate(
            &generate_graph(),
            &ScriptedGeneration("3 orders shipped in 2024."),
            &UnreachableReasoningProvider,
            &recorder,
        )
        .await;
        assert!(matches!(outcome.stop, GovernedProgramStop::Completed));
        assert_eq!(outcome.final_content.unwrap(), "3 orders shipped in 2024.");
    }

    #[tokio::test]
    async fn a_reasoned_draft_citing_a_fabricated_passage_is_held_and_recorded_as_failed() {
        use crate::orchestrator::intelligence::{FinalDraft, MaterialClaim, PassageCitation};
        let draft = FinalDraft {
            content: "The standard rate applies.".to_string(),
            citations: vec![EvidenceRef {
                kind: "governed_run_step".to_string(),
                id: "run:42:analytics".to_string(),
            }],
            claims: vec![MaterialClaim {
                text: "standard rate applies".to_string(),
                support_refs: Vec::new(),
                supports: vec![PassageCitation {
                    kind: "policy".to_string(),
                    id: "vat-guide".to_string(),
                    source_version: "9".to_string(),
                    passage_key: "s1".to_string(),
                }],
            }],
            ..Default::default()
        };
        let reasoning = ScriptedReasoning(std::sync::Mutex::new(Some(
            ReasoningOutcome::FinalDraft(draft),
        )));
        let recorder = RecordingIntelligenceRecorder::default();
        let outcome = run_with_real_gate(
            &reason_graph(),
            &UnreachableGenerationProvider,
            &reasoning,
            &recorder,
        )
        .await;
        assert!(matches!(
            outcome.stop,
            GovernedProgramStop::ReviewRequired(_)
        ));
        // The draft is preserved for inspection but not released as complete.
        assert_eq!(
            outcome.final_content.as_deref(),
            Some("The standard rate applies.")
        );
        let verifications = recorder.verifications.lock().unwrap();
        assert_eq!(verifications.len(), 1);
        assert_eq!(verifications[0].1, "failed");
        let reason = verifications[0].2.as_deref().unwrap();
        assert!(reason.starts_with("[deterministic]"), "{reason}");
        assert!(
            reason.contains("does not resolve to a recorded passage"),
            "{reason}"
        );
    }
}
