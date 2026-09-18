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

use crate::tools::types::ToolOutput;

use super::{
    decision_graph::{
        validate_graph, DecisionGraph, DecisionNode, GateCondition, GraphNode, StopReason,
    },
    decision_type::{admit_decision, DecisionTypeRegistry},
    graduation::{DecisionResolutionContext, GovernedDecisionResolver},
    governed_services::{
        AnswerAdmissionOutcome, CapabilityStepOutcome, FinalAnswerAdmission,
        GovernedCapabilityService, VerificationOutcome, VerificationService,
    },
    intelligence::{
        decision_request_hash, reasoning_request_hash, CapabilityProposal, DecisionKind,
        DecisionProvider, DecisionRequest, DecisionResponse, EvidenceRef, FinalDraft,
        GenerationProvider, GenerationRequest, ReasoningOutcome, ReasoningProvider,
        ReasoningRequest,
    },
    precedent::{summarize, DecisionCaseRecord, DecisionCaseStatus, PrecedentQuery, PrecedentStore},
    probabilistic::{CalibrationProfileStore, Confidence, GateDecision},
};

#[derive(Clone, Debug)]
pub(super) struct GovernedProgramContext {
    pub organization_id: u64,
    pub company_id: u64,
    pub run_id: u64,
    pub program_ref: String,
    pub objective: String,
    pub bounded_state: Value,
    pub evidence: Vec<EvidenceRef>,
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
        for evidence in &self.evidence {
            evidence.validate()?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub(super) enum GovernedProgramStop {
    Completed,
    EarlyStop(StopReason),
    Denied(String),
    PendingApproval {
        capability: String,
        reason: String,
        draft_id: Option<u64>,
    },
    Clarification { prompt: String, options: Vec<String> },
    ReviewRequired(String),
    UnableToProgress(String),
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct GovernedProgramTraceStep {
    pub node_id: String,
    pub kind: &'static str,
    pub summary: String,
}

#[derive(Clone, Debug)]
pub(super) struct GovernedProgramOutcome {
    pub stop: GovernedProgramStop,
    pub final_content: Option<String>,
    pub outputs: HashMap<String, Value>,
    pub trace: Vec<GovernedProgramTraceStep>,
    pub decision_calls: u32,
    pub capability_calls: u32,
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

#[derive(Clone, Debug, Serialize, Deserialize)]
struct GovernedProgramCheckpoint {
    schema_version: u32,
    program_ref: String,
    graph_hash: String,
    current_node: String,
    values: HashMap<String, NodeValue>,
    trace: Vec<GovernedProgramTraceStep>,
    event_step: u32,
    decision_calls: u32,
    capability_calls: u32,
    reason_iterations: HashMap<String, u32>,
    pending_approval: Option<PendingApprovalCheckpoint>,
}

#[async_trait]
pub(super) trait ProgramCheckpointStore: Send + Sync {
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

pub(super) struct StdbProgramCheckpointStore<'a> {
    pub writer: &'a StdbClient,
    pub reader: &'a StdbClient,
}

#[async_trait]
impl ProgramCheckpointStore for StdbProgramCheckpointStore<'_> {
    async fn load(
        &self,
        context: &GovernedProgramContext,
        graph_hash: &str,
    ) -> Result<Option<GovernedProgramCheckpoint>> {
        let program_ref = context.program_ref.replace(''', "''");
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
        let checkpoint: GovernedProgramCheckpoint =
            serde_json::from_str(raw).context("decode governed program checkpoint")?;
        if checkpoint.schema_version != 1
            || checkpoint.program_ref != context.program_ref
            || checkpoint.graph_hash != graph_hash
        {
            bail!("governed program checkpoint identity is invalid");
        }
        Ok(Some(checkpoint))
    }

    async fn save(
        &self,
        context: &GovernedProgramContext,
        checkpoint: &GovernedProgramCheckpoint,
        status: &str,
    ) -> Result<()> {
        let checkpoint_json =
            serde_json::to_string(checkpoint).context("serialize governed program checkpoint")?;
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
                        format!("dependency '{key}' must be an object for merge_object_dependencies")
                    })?;
                    for (field, value) in object {
                        if let Some(existing) = merged.get(field) {
                            if existing != value {
                                bail!(
                                    "merge_object_dependencies conflict for field '{field}'"
                                );
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
pub(super) trait IntelligenceEventRecorder: Send + Sync {
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
pub(super) struct StdbIntelligenceEventRecorder<'a> {
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
            .call_reducer(ReducerCall::from_name("record_ai_decision_event", json!([
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
                ])))
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
            .call_reducer(ReducerCall::from_name("record_ai_reasoning_event", json!([
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
                ])))
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
                        kind: "require_approval",
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
                None,
                "running",
            )
            .await?;

            match &node.kind {
                DecisionNode::Compute(compute) => {
                    let deps = dependency_json(&node, &values);
                    let value = self
                        .compute
                        .compute(&compute.function_ref, &context.bounded_state, &deps)
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
                    values.insert(
                        node.id.clone(),
                        NodeValue::Json(Value::Object(batch_json)),
                    );
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
                    };
                    match self
                        .capabilities
                        .run(context.run_id, &proposal, capability_calls.saturating_sub(1))
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
                    let mut arguments =
                        arguments_for_node(&node, &values, &context.bounded_state);
                    if let Some(object) = arguments.as_object_mut() {
                        object.insert("max_rows".to_string(), acquire.max_rows.into());
                    }
                    let proposal = CapabilityProposal {
                        capability: acquire.capability.clone(),
                        arguments,
                        rationale: Some("conditional evidence acquisition".to_string()),
                    };
                    match self
                        .capabilities
                        .run(context.run_id, &proposal, capability_calls.saturating_sub(1))
                        .await?
                    {
                        CapabilityStepOutcome::Executed(output)
                        | CapabilityStepOutcome::Replayed(output) => {
                            values.insert(node.id.clone(), NodeValue::Tool(output));
                            trace.push(step(&node, "conditional evidence acquired"));
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
                    let source = values
                        .get(&verify.source)
                        .with_context(|| format!("verify source '{}' has no output", verify.source))?;
                    let NodeValue::Tool(tool) = source else {
                        bail!("verify node '{}' source must be a capability output", node.id);
                    };
                    match self.verification.verify(tool, &context.evidence).await? {
                        VerificationOutcome::Verified => {
                            values.insert(node.id.clone(), NodeValue::Json(json!({"verified": true})));
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
                            context: Value::Object(
                                dependency_json(&node, &values).into_iter().collect(),
                            ),
                            format: generate.format.clone(),
                        })
                        .await?;
                    let draft = FinalDraft {
                        content: response.content.clone(),
                        citations: evidence_for_node(&node, &values, &context.evidence),
                    };
                    let known_evidence = known_evidence_for_run(context, &values);
                    match self.answer_admission.admit(&draft, &known_evidence).await? {
                        AnswerAdmissionOutcome::Admitted => {
                            values.insert(node.id.clone(), NodeValue::Text(response.content.clone()));
                            trace.push(step(&node, "generated answer admitted"));
                            if let Some(next) = &node.next {
                                current = next.clone();
                            } else {
                                return Ok(outcome(
                                    GovernedProgramStop::Completed,
                                    Some(response.content),
                                    values,
                                    trace,
                                    decision_calls,
                                    capability_calls,
                                ));
                            }
                        }
                        AnswerAdmissionOutcome::RequiresReview { reason }
                        | AnswerAdmissionOutcome::Blocked { reason } => {
                            return Ok(outcome(
                                GovernedProgramStop::ReviewRequired(reason),
                                Some(response.content),
                                values,
                                trace,
                                decision_calls,
                                capability_calls,
                            ));
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
                    let request = ReasoningRequest {
                        objective: context.objective.clone(),
                        bounded_state: state_for_node(&node, &values, &context.bounded_state),
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
                                    trace.push(step(&node, "reasoning capability proposal admitted"));
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
                            values.insert(node.id.clone(), NodeValue::Json(serde_json::to_value(proposal)?));
                            trace.push(step(&node, "reasoning decision proposal returned to runtime"));
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
                            let admission = self.answer_admission.admit(&draft, &known_evidence).await?;
                            let (verification_status, verification_reason) = match &admission {
                                AnswerAdmissionOutcome::Admitted => ("verified", None),
                                AnswerAdmissionOutcome::RequiresReview { reason } => {
                                    ("requires_review", Some(reason.clone()))
                                }
                                AnswerAdmissionOutcome::Blocked { reason } => {
                                    ("failed", Some(reason.clone()))
                                }
                            };
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
                                AnswerAdmissionOutcome::RequiresReview { reason }
                                | AnswerAdmissionOutcome::Blocked { reason } => {
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
                    schema_version: 1,
                    program_ref: context.program_ref.clone(),
                    graph_hash: graph_hash.to_string(),
                    current_node: current_node.to_string(),
                    values: values.clone(),
                    trace: trace.to_vec(),
                    event_step,
                    decision_calls,
                    capability_calls,
                    reason_iterations: reason_iterations.clone(),
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
        let bounded_state = state_for_node(node, values, &context.bounded_state);
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
        _ => serde_json::to_value(dependency_json(node, values)).unwrap_or_else(|_| fallback.clone()),
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
                GateCondition::ProbabilityBelow(threshold) => decision
                    .probability
                    .is_some_and(|value| value < *threshold),
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

/// Whether any `Capability`/`AcquireEvidence` node in `graph` names a
/// capability the embedded generated-capability catalog advertises.
/// Mirrors `agent_loop_adapters::run_recorded_loop`'s `generated_requested`
/// check for the direct-execution loop — same reason: resolving actor
/// grants (`generated_read::resolve_actor_grants`) requires real actor
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
        CapabilityNode, ComputeNode, GateBranch, GateNode, GenerateNode,
        ProbabilityDecisionNode, ReasonNode, VerifyNode,
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
        kind: node.kind.label(),
        summary: summary.into(),
    }
}

fn next_or_complete(node: &GraphNode) -> Result<String> {
    if let Some(next) = &node.next {
        return Ok(next.clone());
    }
    bail!("terminal node '{}' must be Generate, EarlyStop, or have a next successor", node.id)
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
        DecisionRequest, DecisionResponse, GenerationRequest, GenerationResponse,
        ReasoningOutcome, ReasoningRequest,
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
            Ok(self.next_id.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1)
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
            Ok(self.next_id.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1)
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
        assert!(matches!(outcome.stop, GovernedProgramStop::ReviewRequired(_)));
        let escalations = recorder.escalations.lock().unwrap();
        assert_eq!(escalations.len(), 1);
        assert_eq!(escalations[0].1, "review_required");
        assert!(escalations[0].2.is_some());
        assert!(
            recorder.acceptances.lock().unwrap().is_empty(),
            "a decision requiring escalation must not also be marked accepted"
        );
    }
}
