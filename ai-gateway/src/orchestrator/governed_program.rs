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
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use stdb_client::{ReducerCall, StdbClient};

use crate::tools::types::ToolOutput;

use super::{
    decision_graph::{
        validate_graph, DecisionGraph, DecisionNode, GateCondition, GraphNode, StopReason,
    },
    decision_type::{admit_decision, DecisionTypeRegistry},
    governed_services::{
        AnswerAdmissionOutcome, CapabilityStepOutcome, FinalAnswerAdmission,
        GovernedCapabilityService, VerificationOutcome, VerificationService,
    },
    intelligence::{
        decision_request_hash, CapabilityProposal, DecisionKind, DecisionProvider,
        DecisionRequest, DecisionResponse, EvidenceRef, FinalDraft, GenerationProvider,
        GenerationRequest, ReasoningOutcome, ReasoningProvider, ReasoningRequest,
    },
    precedent::{summarize, DecisionCaseRecord, DecisionCaseStatus, PrecedentQuery, PrecedentStore},
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
    PendingApproval { capability: String, reason: String },
    Clarification { prompt: String, options: Vec<String> },
    ReviewRequired(String),
    UnableToProgress(String),
}

#[derive(Clone, Debug)]
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

#[derive(Clone, Debug)]
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

#[async_trait]
pub(super) trait ComputeService: Send + Sync {
    async fn compute(
        &self,
        function_ref: &str,
        program_state: &Value,
        dependencies: &HashMap<String, Value>,
    ) -> Result<Value>;
}

/// Small deterministic registry used by the first production-shaped program.
/// Domain-specific computations should be added here (or delegated to a
/// dedicated registry), never inferred by a provider.
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
            other => bail!("unknown deterministic compute function '{other}'"),
        }
    }
}

#[async_trait]
pub(super) trait IntelligenceEventRecorder: Send + Sync {
    async fn record_decision(
        &self,
        context: &GovernedProgramContext,
        step_no: u32,
        request_hash: &str,
        request: &DecisionRequest,
        response: &DecisionResponse,
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
    ) -> Result<()> {
        Ok(())
    }
}

pub(super) struct StdbIntelligenceEventRecorder<'a> {
    pub writer: &'a StdbClient,
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
    ) -> Result<()> {
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
            .context("record durable decision event")
    }
}

pub(super) struct GovernedProgramExecutor<'a> {
    pub decision_provider: &'a dyn DecisionProvider,
    pub generation_provider: &'a dyn GenerationProvider,
    pub reasoning_provider: &'a dyn ReasoningProvider,
    pub decision_types: &'a dyn DecisionTypeRegistry,
    pub precedent: &'a dyn PrecedentStore,
    pub capabilities: &'a GovernedCapabilityService<'a>,
    pub verification: &'a dyn VerificationService,
    pub answer_admission: &'a dyn FinalAnswerAdmission,
    pub compute: &'a dyn ComputeService,
    pub recorder: &'a dyn IntelligenceEventRecorder,
}

struct DecisionExecution {
    value: DecisionResponse,
    review_reason: Option<String>,
}

impl GovernedProgramExecutor<'_> {
    pub async fn run(
        &self,
        graph: &DecisionGraph,
        context: &GovernedProgramContext,
    ) -> Result<GovernedProgramOutcome> {
        validate_graph(graph)?;
        context.validate()?;

        let mut values = HashMap::<String, NodeValue>::new();
        let mut trace = Vec::new();
        let mut current = graph.entry.clone();
        let mut event_step = 0_u32;
        let mut decision_calls = 0_u32;
        let mut capability_calls = 0_u32;
        let mut reason_iterations = HashMap::<String, u32>::new();
        let max_steps = graph.nodes.len().saturating_mul(16).max(32);

        for _ in 0..max_steps {
            let node = graph
                .get(&current)
                .with_context(|| format!("control flow reached unknown node '{current}'"))?
                .clone();
            ensure_dependencies(&node, &values)?;

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
                    let target = select_gate_target(&gate.branches, source)?;
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
                            return Ok(outcome(
                                GovernedProgramStop::PendingApproval {
                                    capability: request.capability,
                                    reason: request.reason,
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
                            return Ok(outcome(
                                GovernedProgramStop::PendingApproval {
                                    capability: request.capability,
                                    reason: request.reason,
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
                    match self.answer_admission.admit(&draft).await? {
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
                    match self.reasoning_provider.reason(request).await? {
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
                                    return Ok(outcome(
                                        GovernedProgramStop::PendingApproval {
                                            capability: request.capability,
                                            reason: request.reason,
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
                            match self.answer_admission.admit(&draft).await? {
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
                DecisionNode::RequireApproval(_) => {
                    return Ok(outcome(
                        GovernedProgramStop::ReviewRequired(format!(
                            "explicit approval node '{}' requires human approval",
                            node.id
                        )),
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
        let response = self.decision_provider.decide(request.clone()).await?;
        response.validate_against(&request)?;
        let admission = admit_decision(&definition, &request, &response)?;

        self.recorder
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

        let review_reason = if admission.escalation_required {
            Some(
                admission
                    .escalation_reason
                    .unwrap_or_else(|| "decision requires escalation".to_string()),
            )
        } else if admission.verification_required {
            Some("decision type requires independent verification".to_string())
        } else {
            None
        };
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

fn select_gate_target(
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
            GateCondition::Default => false,
        };
        if matched {
            return Ok(branch.target.clone());
        }
    }
    Ok(default.target.clone())
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
