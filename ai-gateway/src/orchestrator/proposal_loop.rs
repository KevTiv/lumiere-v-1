//! GP-04 (governed intelligence program): proposal-only reasoning loop.
//!
//! Reasoning providers emit typed proposals. Capability proposals are routed
//! through `GovernedCapabilityService`; they are never executed directly by
//! the reasoning/model loop. Final drafts pass through `FinalAnswerAdmission`.
//!
//! This loop owns only bounded reasoning state, rounds, non-progress detection,
//! clarification, and proposal generation. Authorization, execution, recovery,
//! approvals, verification, publication admission, and precedent persistence
//! remain governed-runtime responsibilities.

use anyhow::{bail, Result};
use serde_json::{json, Value};

use super::agent_loop::{LoopEvent, LoopRecorder};
use super::governed_services::{
    qualified_content, AnswerAdmissionOutcome, CapabilityStepOutcome, FinalAnswerAdmission,
    GovernedCapabilityService,
};
use super::intelligence::{
    ClarificationRequest, DecisionProposal, EvidenceRef, ReasoningOutcome, ReasoningProvider,
    ReasoningRequest,
};
use super::progress::{Progress, ProgressTracker, MAX_UNCHANGED_RESULTS};
use crate::tools::types::{hash_tool_input, ToolOutput};

const MAX_RERETRIEVAL_ATTEMPTS: u32 = 2;
const MAX_REPAIR_ATTEMPTS: u32 = 2;
const MAX_REPLAN_ATTEMPTS: u32 = 1;
const MAX_POLL_ATTEMPTS: u32 = 4;
const MAX_POLL_WINDOW_MS: u64 = 5_000;
const POLL_BASE_BACKOFF_MS: u64 = 50;
const POLL_MAX_BACKOFF_MS: u64 = 400;

#[derive(Clone, Copy, Debug)]
pub(super) struct ProposalLoopLimits {
    pub max_rounds: u32,
    pub max_capability_calls: u32,
    /// See `progress::ProgressTracker`; bounds consecutive capability
    /// results that repeat known evidence.
    pub max_unchanged_results: u32,
}

#[derive(Clone, Debug)]
pub(super) enum ProposalLoopStop {
    /// `FinalAnswerAdmission` admitted the draft.
    CandidateAdmitted(String),
    /// Withheld pending review. Raw draft content is intentionally discarded
    /// at this boundary so callers cannot accidentally publish it.
    CandidateRequiresReview {
        reason: String,
    },
    /// The draft failed shape/citation admission outright.
    CandidateBlocked {
        reason: String,
    },
    ClarificationNeeded(ClarificationRequest),
    CapabilityDenied(String),
    PendingApproval(super::governed_services::ApprovalRequest),
    /// No `DecisionStep`/`GovernedProgram` exists yet to consume this
    /// (GP-07/GP-08); the proposal is recorded, not silently dropped or
    /// accepted.
    DecisionProposed(DecisionProposal),
    /// No `GovernedProgram` exists yet to apply this (GP-08).
    ProgramPatchProposed(String),
    UnableToProgress(String),
    /// Capability results stopped adding evidence (AIH-22).
    NoProgress,
    /// `ReasoningProvider::reason` returned an error or an outcome that
    /// failed `ReasoningOutcome::validate_against`.
    ReasoningFailed(String),
    RoundLimit,
    CapabilityLimit,
}

#[derive(Clone, Debug)]
pub(super) struct ProposalLoopOutcome {
    pub stop: ProposalLoopStop,
    pub state: Value,
    pub rounds_used: u32,
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn run_proposal_loop(
    run_id: u64,
    reasoning: &dyn ReasoningProvider,
    capabilities: &GovernedCapabilityService<'_>,
    final_answer: &dyn FinalAnswerAdmission,
    recorder: &dyn LoopRecorder,
    objective: String,
    mut state: Value,
    allowed_proposal_kinds: Vec<String>,
    limits: ProposalLoopLimits,
) -> Result<ProposalLoopOutcome> {
    if run_id == 0 {
        bail!("run_id must be nonzero");
    }
    if !state.is_object() {
        bail!("bounded state must be a JSON object");
    }
    if limits.max_rounds == 0 || limits.max_rounds > 1_000 {
        bail!("max_rounds must be positive and bounded");
    }
    if limits.max_capability_calls == 0 || limits.max_capability_calls > 1_000 {
        bail!("max_capability_calls must be positive and bounded");
    }
    if limits.max_unchanged_results > MAX_UNCHANGED_RESULTS {
        bail!("unchanged-result allowance must not exceed {MAX_UNCHANGED_RESULTS}");
    }

    let mut event_step = 1_u32;
    recorder
        .record(&LoopEvent {
            step_no: event_step,
            kind: "started".to_string(),
            tool_name: None,
            input: json!({"run_id": run_id}),
            summary: "proposal loop started".to_string(),
            error: None,
        })
        .await?;

    let mut progress = ProgressTracker::new(limits.max_unchanged_results);
    let mut capability_calls_used = 0_u32;
    let mut known_evidence: std::collections::HashSet<EvidenceRef> = extract_known_evidence(&state);

    for round in 0..limits.max_rounds {
        let remaining_rounds = limits.max_rounds - round;
        let request = ReasoningRequest {
            objective: objective.clone(),
            bounded_state: state.clone(),
            // GP-06 (decision precedent foundation) is not built yet.
            precedent: Vec::new(),
            allowed_proposal_kinds: allowed_proposal_kinds.clone(),
            remaining_rounds,
        };

        let outcome = match reasoning.reason(request).await {
            Ok(outcome) => outcome,
            Err(error) => {
                let message = error.to_string();
                record(
                    recorder,
                    &mut event_step,
                    "reasoning",
                    None,
                    json!({}),
                    "reasoning step failed",
                    Some(message.clone()),
                )
                .await?;
                return finish(
                    recorder,
                    &mut event_step,
                    state,
                    ProposalLoopStop::ReasoningFailed(message),
                    round,
                )
                .await;
            }
        };

        match outcome {
            ReasoningOutcome::CapabilityProposal(proposal) => {
                if capability_calls_used >= limits.max_capability_calls {
                    record(
                        recorder,
                        &mut event_step,
                        "capability",
                        Some(proposal.capability.clone()),
                        json!({"arguments": proposal.arguments}),
                        "capability call limit exceeded",
                        Some("capability call limit exceeded".to_string()),
                    )
                    .await?;
                    return finish(
                        recorder,
                        &mut event_step,
                        state,
                        ProposalLoopStop::CapabilityLimit,
                        round,
                    )
                    .await;
                }

                if proposal.poll {
                    match reserve_poll_attempt(&mut state, &proposal) {
                        Ok(poll) => {
                            record(
                                recorder,
                                &mut event_step,
                                "polling",
                                Some(proposal.capability.clone()),
                                json!({
                                    "attempt": poll.attempt,
                                    "backoff_ms": poll.backoff_ms,
                                    "elapsed_ms": poll.elapsed_ms,
                                }),
                                "bounded poll attempt admitted",
                                None,
                            )
                            .await?;
                            if poll.backoff_ms > 0 {
                                tokio::time::sleep(std::time::Duration::from_millis(
                                    poll.backoff_ms,
                                ))
                                .await;
                            }
                        }
                        Err(reason) => {
                            record(
                                recorder,
                                &mut event_step,
                                "polling",
                                Some(proposal.capability.clone()),
                                json!({}),
                                "polling budget exhausted",
                                Some(reason.clone()),
                            )
                            .await?;
                            return finish(
                                recorder,
                                &mut event_step,
                                state,
                                ProposalLoopStop::UnableToProgress(reason),
                                round,
                            )
                            .await;
                        }
                    }
                }

                let step_outcome = capabilities
                    .run(run_id, &proposal, capability_calls_used)
                    .await?;
                match step_outcome {
                    CapabilityStepOutcome::Executed(output)
                    | CapabilityStepOutcome::Replayed(output) => {
                        capability_calls_used = capability_calls_used.saturating_add(1);
                        known_evidence.insert(EvidenceRef {
                            kind: "capability_output".to_string(),
                            id: proposal.capability.clone(),
                        });
                        record(
                            recorder,
                            &mut event_step,
                            "capability",
                            Some(proposal.capability.clone()),
                            json!({"arguments": proposal.arguments, "output_summary": output.summary}),
                            "capability proposal executed",
                            None,
                        )
                        .await?;
                        let stalled = match progress.observe(&output) {
                            Progress::New => false,
                            Progress::Unchanged { consecutive }
                            | Progress::Stalled { consecutive } => {
                                let stalled =
                                    !proposal.poll && consecutive > limits.max_unchanged_results;
                                record(
                                    recorder,
                                    &mut event_step,
                                    "progress",
                                    Some(proposal.capability.clone()),
                                    json!({
                                        "consecutive_unchanged": consecutive,
                                        "explicit_poll": proposal.poll,
                                    }),
                                    "capability result repeated known evidence",
                                    stalled.then(|| "no new evidence".to_string()),
                                )
                                .await?;
                                stalled
                            }
                        };
                        if stalled {
                            return finish(
                                recorder,
                                &mut event_step,
                                state,
                                ProposalLoopStop::NoProgress,
                                round,
                            )
                            .await;
                        }
                        state = merge_evidence(
                            state,
                            &proposal.capability,
                            &proposal.arguments,
                            &output,
                        );
                    }
                    CapabilityStepOutcome::Denied(reason) => {
                        record(
                            recorder,
                            &mut event_step,
                            "capability",
                            Some(proposal.capability.clone()),
                            json!({"arguments": proposal.arguments}),
                            "capability proposal denied",
                            Some(reason.clone()),
                        )
                        .await?;
                        return finish(
                            recorder,
                            &mut event_step,
                            state,
                            ProposalLoopStop::CapabilityDenied(reason),
                            round,
                        )
                        .await;
                    }
                    CapabilityStepOutcome::PendingApproval(approval) => {
                        record(
                            recorder,
                            &mut event_step,
                            "capability",
                            Some(proposal.capability.clone()),
                            json!({"arguments": proposal.arguments}),
                            "capability proposal awaits approval",
                            None,
                        )
                        .await?;
                        return finish(
                            recorder,
                            &mut event_step,
                            state,
                            ProposalLoopStop::PendingApproval(approval),
                            round,
                        )
                        .await;
                    }
                }
            }
            ReasoningOutcome::DecisionProposal(proposal) => {
                record(
                    recorder,
                    &mut event_step,
                    "decision_proposal",
                    None,
                    json!({"decision_type": proposal.decision_type.name}),
                    "decision proposal has no consuming DecisionStep yet",
                    None,
                )
                .await?;
                return finish(
                    recorder,
                    &mut event_step,
                    state,
                    ProposalLoopStop::DecisionProposed(proposal),
                    round,
                )
                .await;
            }
            ReasoningOutcome::ProgramPatchProposal(proposal) => {
                record(
                    recorder,
                    &mut event_step,
                    "program_patch_proposal",
                    None,
                    json!({"description": proposal.description}),
                    "program patch proposal has no consuming GovernedProgram yet",
                    None,
                )
                .await?;
                return finish(
                    recorder,
                    &mut event_step,
                    state,
                    ProposalLoopStop::ProgramPatchProposed(proposal.description),
                    round,
                )
                .await;
            }
            ReasoningOutcome::ClarificationRequest(request) => {
                record(
                    recorder,
                    &mut event_step,
                    "clarification",
                    None,
                    json!({"prompt": request.prompt, "required": request.required}),
                    "reasoning step requested clarification",
                    None,
                )
                .await?;
                return finish(
                    recorder,
                    &mut event_step,
                    state,
                    ProposalLoopStop::ClarificationNeeded(request),
                    round,
                )
                .await;
            }
            ReasoningOutcome::FinalDraft(draft) => {
                let admission = final_answer.admit(&draft, &known_evidence).await?;
                let stop = match admission {
                    AnswerAdmissionOutcome::Admitted => {
                        ProposalLoopStop::CandidateAdmitted(draft.content)
                    }
                    AnswerAdmissionOutcome::Qualified { limitations } => {
                        ProposalLoopStop::CandidateAdmitted(qualified_content(
                            &draft.content,
                            &limitations,
                        ))
                    }
                    AnswerAdmissionOutcome::RequiresReview { reason } => {
                        if reason_needs_retrieval(&reason)
                            && consume_recovery_attempt(
                                &mut state,
                                "retrieval_attempts",
                                MAX_RERETRIEVAL_ATTEMPTS,
                                "re_retrieval",
                                &reason,
                            )
                        {
                            record(
                                recorder,
                                &mut event_step,
                                "re_retrieval",
                                None,
                                json!({"reason": reason}),
                                "answer gate requested bounded evidence re-retrieval",
                                None,
                            )
                            .await?;
                            continue;
                        }
                        ProposalLoopStop::CandidateRequiresReview { reason }
                    }
                    AnswerAdmissionOutcome::Blocked { reason } => {
                        if reason_is_repairable(&reason)
                            && consume_recovery_attempt(
                                &mut state,
                                "repair_attempts",
                                MAX_REPAIR_ATTEMPTS,
                                "repair",
                                &reason,
                            )
                        {
                            record(
                                recorder,
                                &mut event_step,
                                "repair",
                                None,
                                json!({"reason": reason}),
                                "answer gate requested bounded candidate repair",
                                None,
                            )
                            .await?;
                            continue;
                        }
                        ProposalLoopStop::CandidateBlocked { reason }
                    }
                };
                record(
                    recorder,
                    &mut event_step,
                    "final_draft",
                    None,
                    json!({}),
                    "final draft evaluated by answer admission",
                    match &stop {
                        ProposalLoopStop::CandidateAdmitted(_) => None,
                        ProposalLoopStop::CandidateRequiresReview { reason, .. }
                        | ProposalLoopStop::CandidateBlocked { reason } => Some(reason.clone()),
                        _ => None,
                    },
                )
                .await?;
                return finish(recorder, &mut event_step, state, stop, round).await;
            }
            ReasoningOutcome::UnableToProgress(unable) => {
                if consume_recovery_attempt(
                    &mut state,
                    "replan_attempts",
                    MAX_REPLAN_ATTEMPTS,
                    "replan",
                    &unable.reason,
                ) {
                    record(
                        recorder,
                        &mut event_step,
                        "replan",
                        None,
                        json!({"last_step_no": unable.last_step_no, "reason": unable.reason}),
                        "bounded replan requested after unable-to-progress",
                        None,
                    )
                    .await?;
                    continue;
                }
                record(
                    recorder,
                    &mut event_step,
                    "unable_to_progress",
                    None,
                    json!({"last_step_no": unable.last_step_no}),
                    "reasoning step reported it cannot progress",
                    Some(unable.reason.clone()),
                )
                .await?;
                return finish(
                    recorder,
                    &mut event_step,
                    state,
                    ProposalLoopStop::UnableToProgress(unable.reason),
                    round,
                )
                .await;
            }
        }
    }

    finish(
        recorder,
        &mut event_step,
        state,
        ProposalLoopStop::RoundLimit,
        limits.max_rounds,
    )
    .await
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PollAttempt {
    attempt: u32,
    elapsed_ms: u64,
    backoff_ms: u64,
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn recovery_state(state: &mut Value) -> &mut serde_json::Map<String, Value> {
    let object = state
        .as_object_mut()
        .expect("bounded state is validated as an object before recovery");
    if !object.get("recovery").is_some_and(Value::is_object) {
        object.insert("recovery".to_string(), json!({}));
    }
    object
        .get_mut("recovery")
        .and_then(Value::as_object_mut)
        .expect("recovery state is an object")
}

fn consume_recovery_attempt(
    state: &mut Value,
    counter: &str,
    limit: u32,
    kind: &str,
    reason: &str,
) -> bool {
    let recovery = recovery_state(state);
    let used = recovery
        .get(counter)
        .and_then(Value::as_u64)
        .unwrap_or_default() as u32;
    if used >= limit {
        return false;
    }
    let next = used.saturating_add(1);
    recovery.insert(counter.to_string(), json!(next));
    let diagnostic = json!({
        "kind": kind,
        "attempt": next,
        "limit": limit,
        "reason": reason,
    });
    match recovery.get_mut("diagnostics").and_then(Value::as_array_mut) {
        Some(items) => items.push(diagnostic),
        None => {
            recovery.insert("diagnostics".to_string(), json!([diagnostic]));
        }
    }
    true
}

fn reason_needs_retrieval(reason: &str) -> bool {
    let reason = reason.to_ascii_lowercase();
    ["evidence", "citation", "source", "support", "ground"]
        .iter()
        .any(|needle| reason.contains(needle))
}

fn reason_is_repairable(reason: &str) -> bool {
    let reason = reason.to_ascii_lowercase();
    !["forbidden", "denied", "revoked", "withdrawn", "out of scope", "unauthorized"]
        .iter()
        .any(|needle| reason.contains(needle))
}

fn reserve_poll_attempt(
    state: &mut Value,
    proposal: &super::intelligence::CapabilityProposal,
) -> std::result::Result<PollAttempt, String> {
    let fingerprint = hash_tool_input(&json!({
        "capability": proposal.capability,
        "arguments": proposal.arguments,
    }));
    let now = now_millis();
    let recovery = recovery_state(state);
    if !recovery.get("polls").is_some_and(Value::is_object) {
        recovery.insert("polls".to_string(), json!({}));
    }
    let polls = recovery
        .get_mut("polls")
        .and_then(Value::as_object_mut)
        .expect("poll state is an object");
    let poll = polls.entry(fingerprint).or_insert_with(|| {
        json!({
            "attempts": 0,
            "started_at_ms": now,
        })
    });
    let poll = poll
        .as_object_mut()
        .ok_or_else(|| "poll recovery state is malformed".to_string())?;
    let attempts = poll
        .get("attempts")
        .and_then(Value::as_u64)
        .unwrap_or_default() as u32;
    let started_at = poll
        .get("started_at_ms")
        .and_then(Value::as_u64)
        .unwrap_or(now);
    let elapsed_ms = now.saturating_sub(started_at);
    if attempts >= MAX_POLL_ATTEMPTS || elapsed_ms > MAX_POLL_WINDOW_MS {
        return Err(format!(
            "polling budget exhausted after {attempts} attempts / {elapsed_ms}ms"
        ));
    }
    let attempt = attempts.saturating_add(1);
    poll.insert("attempts".to_string(), json!(attempt));
    let exponent = attempt.saturating_sub(1).min(8);
    let backoff_ms = if attempt <= 1 {
        0
    } else {
        POLL_BASE_BACKOFF_MS
            .saturating_mul(1_u64 << exponent)
            .min(POLL_MAX_BACKOFF_MS)
    };
    if elapsed_ms.saturating_add(backoff_ms) > MAX_POLL_WINDOW_MS {
        return Err(format!(
            "polling time budget exhausted before attempt {attempt}"
        ));
    }
    Ok(PollAttempt {
        attempt,
        elapsed_ms,
        backoff_ms,
    })
}

fn merge_evidence(
    mut state: Value,
    capability: &str,
    arguments: &Value,
    output: &ToolOutput,
) -> Value {
    let entry = json!({
        "capability": capability,
        "arguments": arguments,
        "summary": output.summary,
        "data": output.data,
        "row_count": output.row_count,
    });
    let object = state
        .as_object_mut()
        .expect("bounded state is validated as an object before the loop starts");
    match object.get_mut("evidence").and_then(Value::as_array_mut) {
        Some(evidence) => evidence.push(entry),
        None => {
            object.insert("evidence".to_string(), json!([entry]));
        }
    }
    state
}

fn extract_known_evidence(state: &Value) -> std::collections::HashSet<EvidenceRef> {
    let mut known = std::collections::HashSet::new();
    if let Some(evidence) = state.get("evidence").and_then(Value::as_array) {
        for entry in evidence {
            if let Some(cap) = entry.get("capability").and_then(Value::as_str) {
                known.insert(EvidenceRef {
                    kind: "capability_output".to_string(),
                    id: cap.to_string(),
                });
            }
            if let (Some(kind), Some(id)) = (
                entry.get("kind").and_then(Value::as_str),
                entry.get("id").and_then(Value::as_str),
            ) {
                known.insert(EvidenceRef {
                    kind: kind.to_string(),
                    id: id.to_string(),
                });
            }
        }
    }
    known
}

#[allow(clippy::too_many_arguments)]
async fn record(
    recorder: &dyn LoopRecorder,
    step: &mut u32,
    kind: &str,
    tool_name: Option<String>,
    input: Value,
    summary: &str,
    error: Option<String>,
) -> Result<()> {
    *step = step.saturating_add(1);
    recorder
        .record(&LoopEvent {
            step_no: *step,
            kind: kind.to_string(),
            tool_name,
            input,
            summary: summary.to_string(),
            error,
        })
        .await
}

async fn finish(
    recorder: &dyn LoopRecorder,
    step: &mut u32,
    state: Value,
    stop: ProposalLoopStop,
    rounds_used: u32,
) -> Result<ProposalLoopOutcome> {
    *step = step.saturating_add(1);
    let summary = format!("proposal loop stopped: {stop:?}");
    recorder
        .record(&LoopEvent {
            step_no: *step,
            kind: "stopped".to_string(),
            tool_name: None,
            input: json!({"rounds_used": rounds_used}),
            summary,
            error: match &stop {
                ProposalLoopStop::CandidateAdmitted(_)
                | ProposalLoopStop::CandidateRequiresReview { .. }
                | ProposalLoopStop::ClarificationNeeded(_)
                | ProposalLoopStop::PendingApproval(_)
                | ProposalLoopStop::DecisionProposed(_)
                | ProposalLoopStop::ProgramPatchProposed(_) => None,
                other => Some(format!("{other:?}")),
            },
        })
        .await?;
    Ok(ProposalLoopOutcome {
        stop,
        state,
        rounds_used,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex;

    use crate::harness::audit::{
        CorrelationMetadata, DecisionHashes, DecisionOutcome, DecisionReason, PolicyDecision,
        PolicyReasonCode,
    };
    use crate::harness::manifest::SkillVersionRef;
    use crate::orchestrator::agent_loop::{LoopPolicy, LoopTools};
    use crate::orchestrator::governed_services::{
        InMemoryExecutionRecovery, PolicyBackedCapabilityAdmission, RecordingApprovalCoordinator,
        ShapeOnlyFinalAnswerAdmission, ToolsBackedCapabilityExecutor,
    };
    use crate::orchestrator::intelligence::{
        CapabilityProposal, DecisionKind, DecisionProposal, DecisionTypeRef, EvidenceRef,
        FinalDraft, ReasoningOutcome, UnableToProgress, PROPOSAL_KIND_CAPABILITY,
        PROPOSAL_KIND_FINAL_DRAFT,
    };
    use crate::providers::llm::ToolCallRequest;
    use serde_json::json;

    fn decision(outcome: DecisionOutcome) -> PolicyDecision {
        PolicyDecision {
            outcome,
            skill: SkillVersionRef::new("test-skill", 1),
            risk: None,
            reasons: vec![DecisionReason::new(
                PolicyReasonCode::Allowed,
                "test policy",
            )],
            correlation: CorrelationMetadata {
                correlation_id: "test-correlation".into(),
                organization_id: 1,
                company_id: 1,
                actor_id: Some("test-actor".into()),
                causation_id: Some("test-causation".into()),
            },
            hashes: DecisionHashes {
                request_hash: "request-hash".into(),
                input_hash: "input-hash".into(),
                manifest_hash: Some("manifest-hash".into()),
            },
            enforced_limits: None,
        }
    }

    struct AllowPolicy;

    #[async_trait]
    impl LoopPolicy for AllowPolicy {
        async fn evaluate(
            &self,
            _call: &ToolCallRequest,
            _completed: u32,
        ) -> Result<PolicyDecision> {
            Ok(decision(DecisionOutcome::Allow))
        }
        async fn protect_output(
            &self,
            _call: &ToolCallRequest,
            _completed: u32,
            output: ToolOutput,
        ) -> Result<ToolOutput> {
            Ok(output)
        }
    }

    struct StubTools {
        outputs: Mutex<Vec<ToolOutput>>,
    }

    #[async_trait]
    impl LoopTools for StubTools {
        async fn execute(&self, _call: &ToolCallRequest) -> Result<ToolOutput> {
            let mut outputs = self.outputs.lock().unwrap();
            if outputs.len() > 1 {
                Ok(outputs.remove(0))
            } else {
                Ok(outputs[0].clone())
            }
        }
    }

    fn output(summary: &str) -> ToolOutput {
        ToolOutput {
            summary: summary.to_string(),
            data: json!({"ok": true}),
            citations: vec![],
            row_count: Some(1),
        }
    }

    struct ScriptedReasoner {
        outcomes: Mutex<Vec<Result<ReasoningOutcome, String>>>,
    }

    #[async_trait]
    impl ReasoningProvider for ScriptedReasoner {
        async fn reason(&self, _request: ReasoningRequest) -> Result<ReasoningOutcome> {
            let mut outcomes = self.outcomes.lock().unwrap();
            match outcomes.remove(0) {
                Ok(outcome) => Ok(outcome),
                Err(message) => Err(anyhow::anyhow!(message)),
            }
        }
    }

    struct RecordingRecorder {
        events: Mutex<Vec<LoopEvent>>,
    }

    impl RecordingRecorder {
        fn new() -> Self {
            Self {
                events: Mutex::new(Vec::new()),
            }
        }
    }

    #[async_trait]
    impl LoopRecorder for RecordingRecorder {
        async fn record(&self, event: &LoopEvent) -> Result<()> {
            self.events.lock().unwrap().push(event.clone());
            Ok(())
        }
    }

    fn limits() -> ProposalLoopLimits {
        ProposalLoopLimits {
            max_rounds: 5,
            max_capability_calls: 5,
            max_unchanged_results: 3,
        }
    }

    #[tokio::test]
    async fn capability_proposal_executes_then_final_draft_is_admitted() {
        let policy = AllowPolicy;
        let tools = StubTools {
            outputs: Mutex::new(vec![output("PO-42 found")]),
        };
        let admission = PolicyBackedCapabilityAdmission::new(&policy);
        let executor = ToolsBackedCapabilityExecutor::new(&tools);
        let recovery = InMemoryExecutionRecovery::new();
        let approvals = RecordingApprovalCoordinator;
        let capabilities =
            GovernedCapabilityService::new(&admission, &executor, &recovery, &approvals);
        let final_answer = ShapeOnlyFinalAnswerAdmission;
        let recorder = RecordingRecorder::new();

        let reasoner = ScriptedReasoner {
            outcomes: Mutex::new(vec![
                Ok(ReasoningOutcome::CapabilityProposal(CapabilityProposal {
                    capability: "erp.search".to_string(),
                    arguments: json!({"q": "PO-42"}),
                    rationale: None,
                })),
                Ok(ReasoningOutcome::FinalDraft(FinalDraft {
                    content: "PO-42 was found.".to_string(),
                    citations: vec![EvidenceRef {
                        kind: "erp_record".to_string(),
                        id: "PO-42".to_string(),
                    }],
                    ..Default::default()
                })),
            ]),
        };

        let outcome = run_proposal_loop(
            9,
            &reasoner,
            &capabilities,
            &final_answer,
            &recorder,
            "find PO-42".to_string(),
            json!({}),
            vec![
                PROPOSAL_KIND_CAPABILITY.to_string(),
                PROPOSAL_KIND_FINAL_DRAFT.to_string(),
            ],
            limits(),
        )
        .await
        .unwrap();

        match outcome.stop {
            ProposalLoopStop::CandidateAdmitted(content) => {
                assert_eq!(content, "PO-42 was found.");
            }
            other => panic!("expected CandidateAdmitted, got {other:?}"),
        }
        let evidence = outcome.state.get("evidence").unwrap().as_array().unwrap();
        assert_eq!(evidence.len(), 1);
        assert_eq!(evidence[0]["capability"], "erp.search");
    }

    #[tokio::test]
    async fn final_draft_without_citations_requires_review_not_admission() {
        let policy = AllowPolicy;
        let tools = StubTools {
            outputs: Mutex::new(vec![output("n/a")]),
        };
        let admission = PolicyBackedCapabilityAdmission::new(&policy);
        let executor = ToolsBackedCapabilityExecutor::new(&tools);
        let recovery = InMemoryExecutionRecovery::new();
        let approvals = RecordingApprovalCoordinator;
        let capabilities =
            GovernedCapabilityService::new(&admission, &executor, &recovery, &approvals);
        let final_answer = ShapeOnlyFinalAnswerAdmission;
        let recorder = RecordingRecorder::new();

        let reasoner = ScriptedReasoner {
            outcomes: Mutex::new(vec![Ok(ReasoningOutcome::FinalDraft(FinalDraft {
                content: "an uncited answer".to_string(),
                citations: vec![],
                ..Default::default()
            }))]),
        };

        let outcome = run_proposal_loop(
            9,
            &reasoner,
            &capabilities,
            &final_answer,
            &recorder,
            "answer".to_string(),
            json!({}),
            vec![PROPOSAL_KIND_FINAL_DRAFT.to_string()],
            limits(),
        )
        .await
        .unwrap();

        assert!(matches!(
            outcome.stop,
            ProposalLoopStop::CandidateRequiresReview { .. }
        ));
    }

    #[tokio::test]
    async fn malformed_reasoning_output_is_terminal_not_retried() {
        let policy = AllowPolicy;
        let tools = StubTools {
            outputs: Mutex::new(vec![output("n/a")]),
        };
        let admission = PolicyBackedCapabilityAdmission::new(&policy);
        let executor = ToolsBackedCapabilityExecutor::new(&tools);
        let recovery = InMemoryExecutionRecovery::new();
        let approvals = RecordingApprovalCoordinator;
        let capabilities =
            GovernedCapabilityService::new(&admission, &executor, &recovery, &approvals);
        let final_answer = ShapeOnlyFinalAnswerAdmission;
        let recorder = RecordingRecorder::new();

        let reasoner = ScriptedReasoner {
            outcomes: Mutex::new(vec![Err("malformed tool_call JSON".to_string())]),
        };

        let outcome = run_proposal_loop(
            9,
            &reasoner,
            &capabilities,
            &final_answer,
            &recorder,
            "answer".to_string(),
            json!({}),
            vec![PROPOSAL_KIND_FINAL_DRAFT.to_string()],
            limits(),
        )
        .await
        .unwrap();

        assert!(matches!(outcome.stop, ProposalLoopStop::ReasoningFailed(_)));
        assert_eq!(outcome.rounds_used, 0);
    }

    #[tokio::test]
    async fn denied_capability_stops_the_loop() {
        struct DenyPolicy;
        #[async_trait]
        impl LoopPolicy for DenyPolicy {
            async fn evaluate(
                &self,
                _call: &ToolCallRequest,
                _completed: u32,
            ) -> Result<PolicyDecision> {
                Ok(decision(DecisionOutcome::Deny))
            }
            async fn protect_output(
                &self,
                _call: &ToolCallRequest,
                _completed: u32,
                output: ToolOutput,
            ) -> Result<ToolOutput> {
                Ok(output)
            }
        }
        let policy = DenyPolicy;
        let tools = StubTools {
            outputs: Mutex::new(vec![output("n/a")]),
        };
        let admission = PolicyBackedCapabilityAdmission::new(&policy);
        let executor = ToolsBackedCapabilityExecutor::new(&tools);
        let recovery = InMemoryExecutionRecovery::new();
        let approvals = RecordingApprovalCoordinator;
        let capabilities =
            GovernedCapabilityService::new(&admission, &executor, &recovery, &approvals);
        let final_answer = ShapeOnlyFinalAnswerAdmission;
        let recorder = RecordingRecorder::new();

        let reasoner = ScriptedReasoner {
            outcomes: Mutex::new(vec![Ok(ReasoningOutcome::CapabilityProposal(
                CapabilityProposal {
                    capability: "erp.mutate".to_string(),
                    arguments: json!({}),
                    rationale: None,
                },
            ))]),
        };

        let outcome = run_proposal_loop(
            9,
            &reasoner,
            &capabilities,
            &final_answer,
            &recorder,
            "mutate".to_string(),
            json!({}),
            vec![PROPOSAL_KIND_CAPABILITY.to_string()],
            limits(),
        )
        .await
        .unwrap();

        assert!(matches!(
            outcome.stop,
            ProposalLoopStop::CapabilityDenied(_)
        ));
    }

    #[tokio::test]
    async fn repeated_identical_capability_output_stalls_within_the_allowance() {
        let policy = AllowPolicy;
        let tools = StubTools {
            outputs: Mutex::new(vec![output("same every time")]),
        };
        let admission = PolicyBackedCapabilityAdmission::new(&policy);
        let executor = ToolsBackedCapabilityExecutor::new(&tools);
        let recovery = InMemoryExecutionRecovery::new();
        let approvals = RecordingApprovalCoordinator;
        let capabilities =
            GovernedCapabilityService::new(&admission, &executor, &recovery, &approvals);
        let final_answer = ShapeOnlyFinalAnswerAdmission;
        let recorder = RecordingRecorder::new();

        // Distinct capability names avoid the ExecutionRecovery dedup path
        // (same run_id + capability + arguments), so each proposal reaches
        // the executor and the tracker sees genuinely repeated *evidence*.
        let mut scripted = Vec::new();
        for i in 0..6 {
            scripted.push(Ok(ReasoningOutcome::CapabilityProposal(
                CapabilityProposal {
                    capability: format!("erp.search_{i}"),
                    arguments: json!({"q": "same"}),
                    rationale: None,
                },
            )));
        }
        let reasoner = ScriptedReasoner {
            outcomes: Mutex::new(scripted),
        };

        let outcome = run_proposal_loop(
            9,
            &reasoner,
            &capabilities,
            &final_answer,
            &recorder,
            "search".to_string(),
            json!({}),
            vec![PROPOSAL_KIND_CAPABILITY.to_string()],
            ProposalLoopLimits {
                max_rounds: 10,
                max_capability_calls: 10,
                max_unchanged_results: 3,
            },
        )
        .await
        .unwrap();

        assert!(matches!(outcome.stop, ProposalLoopStop::NoProgress));
    }

    #[tokio::test]
    async fn unable_to_progress_outcome_stops_the_loop() {
        let policy = AllowPolicy;
        let tools = StubTools {
            outputs: Mutex::new(vec![output("n/a")]),
        };
        let admission = PolicyBackedCapabilityAdmission::new(&policy);
        let executor = ToolsBackedCapabilityExecutor::new(&tools);
        let recovery = InMemoryExecutionRecovery::new();
        let approvals = RecordingApprovalCoordinator;
        let capabilities =
            GovernedCapabilityService::new(&admission, &executor, &recovery, &approvals);
        let final_answer = ShapeOnlyFinalAnswerAdmission;
        let recorder = RecordingRecorder::new();

        let reasoner = ScriptedReasoner {
            outcomes: Mutex::new(vec![Ok(ReasoningOutcome::UnableToProgress(
                UnableToProgress {
                    reason: "no further evidence available".to_string(),
                    last_step_no: 1,
                },
            ))]),
        };

        let outcome = run_proposal_loop(
            9,
            &reasoner,
            &capabilities,
            &final_answer,
            &recorder,
            "search".to_string(),
            json!({}),
            vec![PROPOSAL_KIND_CAPABILITY.to_string()],
            limits(),
        )
        .await
        .unwrap();

        assert!(matches!(
            outcome.stop,
            ProposalLoopStop::UnableToProgress(_)
        ));
    }

    #[tokio::test]
    async fn decision_proposal_is_recorded_and_stops_with_no_consuming_service() {
        let policy = AllowPolicy;
        let tools = StubTools {
            outputs: Mutex::new(vec![output("n/a")]),
        };
        let admission = PolicyBackedCapabilityAdmission::new(&policy);
        let executor = ToolsBackedCapabilityExecutor::new(&tools);
        let recovery = InMemoryExecutionRecovery::new();
        let approvals = RecordingApprovalCoordinator;
        let capabilities =
            GovernedCapabilityService::new(&admission, &executor, &recovery, &approvals);
        let final_answer = ShapeOnlyFinalAnswerAdmission;
        let recorder = RecordingRecorder::new();

        let reasoner = ScriptedReasoner {
            outcomes: Mutex::new(vec![Ok(ReasoningOutcome::DecisionProposal(
                DecisionProposal {
                    decision_type: DecisionTypeRef {
                        name: "SupplierRisk".to_string(),
                        version: 1,
                    },
                    kind: DecisionKind::Probability,
                    proposed_choice: None,
                    proposed_score: None,
                    proposed_probability: Some(0.4),
                    rationale: None,
                },
            ))]),
        };

        let outcome = run_proposal_loop(
            9,
            &reasoner,
            &capabilities,
            &final_answer,
            &recorder,
            "assess supplier".to_string(),
            json!({}),
            vec!["decision".to_string()],
            limits(),
        )
        .await
        .unwrap();

        assert!(matches!(
            outcome.stop,
            ProposalLoopStop::DecisionProposed(_)
        ));
    }

    #[tokio::test]
    async fn round_limit_stops_the_loop_when_reasoning_never_settles() {
        let policy = AllowPolicy;
        let tools = StubTools {
            outputs: Mutex::new(vec![output("n/a")]),
        };
        let admission = PolicyBackedCapabilityAdmission::new(&policy);
        let executor = ToolsBackedCapabilityExecutor::new(&tools);
        let recovery = InMemoryExecutionRecovery::new();
        let approvals = RecordingApprovalCoordinator;
        let capabilities =
            GovernedCapabilityService::new(&admission, &executor, &recovery, &approvals);
        let final_answer = ShapeOnlyFinalAnswerAdmission;
        let recorder = RecordingRecorder::new();

        let mut scripted = Vec::new();
        for i in 0..3 {
            scripted.push(Ok(ReasoningOutcome::CapabilityProposal(
                CapabilityProposal {
                    capability: format!("erp.search_{i}"),
                    arguments: json!({"q": format!("q{i}")}),
                    rationale: None,
                },
            )));
        }
        let reasoner = ScriptedReasoner {
            outcomes: Mutex::new(scripted),
        };

        let outcome = run_proposal_loop(
            9,
            &reasoner,
            &capabilities,
            &final_answer,
            &recorder,
            "search".to_string(),
            json!({}),
            vec![PROPOSAL_KIND_CAPABILITY.to_string()],
            ProposalLoopLimits {
                max_rounds: 3,
                max_capability_calls: 10,
                max_unchanged_results: 8,
            },
        )
        .await
        .unwrap();

        assert!(matches!(outcome.stop, ProposalLoopStop::RoundLimit));
    }

    #[tokio::test]
    async fn rejects_non_object_bounded_state() {
        let policy = AllowPolicy;
        let tools = StubTools {
            outputs: Mutex::new(vec![output("n/a")]),
        };
        let admission = PolicyBackedCapabilityAdmission::new(&policy);
        let executor = ToolsBackedCapabilityExecutor::new(&tools);
        let recovery = InMemoryExecutionRecovery::new();
        let approvals = RecordingApprovalCoordinator;
        let capabilities =
            GovernedCapabilityService::new(&admission, &executor, &recovery, &approvals);
        let final_answer = ShapeOnlyFinalAnswerAdmission;
        let recorder = RecordingRecorder::new();
        let reasoner = ScriptedReasoner {
            outcomes: Mutex::new(vec![]),
        };

        let result = run_proposal_loop(
            9,
            &reasoner,
            &capabilities,
            &final_answer,
            &recorder,
            "search".to_string(),
            json!("not an object"),
            vec![PROPOSAL_KIND_CAPABILITY.to_string()],
            limits(),
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn rejects_zero_run_id() {
        let policy = AllowPolicy;
        let tools = StubTools {
            outputs: Mutex::new(vec![output("n/a")]),
        };
        let admission = PolicyBackedCapabilityAdmission::new(&policy);
        let executor = ToolsBackedCapabilityExecutor::new(&tools);
        let recovery = InMemoryExecutionRecovery::new();
        let approvals = RecordingApprovalCoordinator;
        let capabilities =
            GovernedCapabilityService::new(&admission, &executor, &recovery, &approvals);
        let final_answer = ShapeOnlyFinalAnswerAdmission;
        let recorder = RecordingRecorder::new();
        let reasoner = ScriptedReasoner {
            outcomes: Mutex::new(vec![]),
        };

        let result = run_proposal_loop(
            0,
            &reasoner,
            &capabilities,
            &final_answer,
            &recorder,
            "search".to_string(),
            json!({}),
            vec![PROPOSAL_KIND_CAPABILITY.to_string()],
            limits(),
        )
        .await;
        assert!(result.is_err());
    }
}
