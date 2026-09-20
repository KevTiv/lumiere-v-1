//! Independent review of completed governed program runs.
//!
//! Review consumes only the observable completed trace/state. It cannot
//! execute capabilities, approve effects, or change the reviewed run —
//! `RunReviewProgram::review` stays a pure classification with no
//! recording side effect of its own, which is why `RunReviewRecorder` is a
//! separate seam the caller (`run.rs`) threads through explicitly, rather
//! than folded into `review()` itself.
//!
//! Durable persistence (GP-14) closes the loop that computing a typed
//! disposition and then discarding it left open: without
//! `record_ai_run_review` (`spacetimedb/src/ai/run_review.rs`), an
//! `IncidentCandidate` disposition — exactly the signal an ops/security
//! review would need to find later — only ever existed in one HTTP
//! response body.

use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use stdb_client::{ReducerCall, StdbClient};

use super::governed_program::{GovernedProgramOutcome, GovernedProgramStop};
use super::intelligence::{DecisionKind, DecisionProvider, DecisionRequest, DecisionTypeRef};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum RunReviewDisposition {
    Healthy,
    ReviewRequired,
    Defect,
    IncidentCandidate,
}

impl RunReviewDisposition {
    /// Matches this enum's own `#[serde(rename_all = "snake_case")]` and,
    /// deliberately, `spacetimedb/src/ai/run_review.rs`'s `DISPOSITIONS`
    /// constant — a durable write with a value the reducer doesn't
    /// recognize fails closed rather than silently storing a stray label.
    fn label(self) -> &'static str {
        match self {
            Self::Healthy => "healthy",
            Self::ReviewRequired => "review_required",
            Self::Defect => "defect",
            Self::IncidentCandidate => "incident_candidate",
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct RunReviewResult {
    pub disposition: RunReviewDisposition,
    pub rationale: Option<String>,
    pub provider: String,
    pub model: String,
}

pub(super) struct RunReviewProgram<'a> {
    reviewer: &'a dyn DecisionProvider,
}

impl<'a> RunReviewProgram<'a> {
    pub fn new(reviewer: &'a dyn DecisionProvider) -> Self {
        Self { reviewer }
    }

    pub async fn review(
        &self,
        objective: &str,
        outcome: &GovernedProgramOutcome,
    ) -> Result<RunReviewResult> {
        if objective.trim().is_empty() {
            bail!("run review objective must be nonempty");
        }
        if let Some(result) = deterministic_pre_review(outcome) {
            return Ok(result);
        }
        let trace = outcome
            .trace
            .iter()
            .map(|step| {
                json!({
                    "node_id": step.node_id,
                    "kind": step.kind,
                    "summary": step.summary,
                })
            })
            .collect::<Vec<_>>();
        let request = DecisionRequest {
            decision_type: DecisionTypeRef {
                name: "RunReviewDisposition".to_string(),
                version: 1,
            },
            kind: DecisionKind::Choice,
            question: "Classify the completed governed run from its observable trace and outputs. Select the narrowest justified disposition.".to_string(),
            bounded_state: json!({
                "objective": objective,
                "stop": format!("{:?}", outcome.stop),
                "trace": trace,
                "outputs": outcome.outputs,
                "final_content": outcome.final_content,
            }),
            candidates: vec![
                "healthy".to_string(),
                "review_required".to_string(),
                "defect".to_string(),
                "incident_candidate".to_string(),
            ],
            precedent: Vec::new(),
            evidence: Vec::new(),
        };
        let response = self.reviewer.decide(request.clone()).await?;
        response.validate_against(&request)?;
        let disposition = match response.choice.as_deref() {
            Some("healthy") => RunReviewDisposition::Healthy,
            Some("review_required") => RunReviewDisposition::ReviewRequired,
            Some("defect") => RunReviewDisposition::Defect,
            Some("incident_candidate") => RunReviewDisposition::IncidentCandidate,
            Some(other) => bail!("review provider returned unknown disposition '{other}'"),
            None => bail!("review provider returned no disposition"),
        };
        Ok(RunReviewResult {
            disposition,
            rationale: response.rationale,
            provider: response.provider,
            model: response.model,
        })
    }
}

fn deterministic_pre_review(outcome: &GovernedProgramOutcome) -> Option<RunReviewResult> {
    let defect = |rationale: String| RunReviewResult {
        disposition: RunReviewDisposition::Defect,
        rationale: Some(rationale),
        provider: "deterministic-review".to_string(),
        model: "trace-invariants@1".to_string(),
    };

    if outcome.trace.is_empty() {
        return Some(defect(
            "governed run has an empty observable trace".to_string(),
        ));
    }
    if matches!(outcome.stop, GovernedProgramStop::Completed)
        && outcome
            .final_content
            .as_deref()
            .is_none_or(|content| content.trim().is_empty())
    {
        return Some(defect(
            "completed governed run has no admitted final content".to_string(),
        ));
    }

    let traced_capabilities = outcome
        .trace
        .iter()
        .filter(|step| step.kind == "capability")
        .count() as u32;
    if outcome.capability_calls > traced_capabilities {
        return Some(defect(format!(
            "capability call count {} exceeds observable capability trace count {}",
            outcome.capability_calls, traced_capabilities
        )));
    }

    let traced_decisions = outcome
        .trace
        .iter()
        .filter(|step| matches!(step.kind.as_str(), "choice" | "score" | "probability"))
        .count() as u32;
    if outcome.decision_calls > traced_decisions {
        return Some(defect(format!(
            "decision call count {} exceeds observable decision trace count {}",
            outcome.decision_calls, traced_decisions
        )));
    }
    None
}

/// Durable evidence for one `RunReviewProgram::review` result. Separate
/// from `RunReviewProgram` itself — see module docs on why `review()`
/// stays free of recording side effects.
#[async_trait]
pub(super) trait RunReviewRecorder: Send + Sync {
    async fn record(
        &self,
        organization_id: u64,
        company_id: u64,
        run_id: u64,
        program_ref: &str,
        result: &RunReviewResult,
    ) -> Result<()>;
}

pub(super) struct NoopRunReviewRecorder;

#[async_trait]
impl RunReviewRecorder for NoopRunReviewRecorder {
    async fn record(
        &self,
        _organization_id: u64,
        _company_id: u64,
        _run_id: u64,
        _program_ref: &str,
        _result: &RunReviewResult,
    ) -> Result<()> {
        Ok(())
    }
}

pub(super) struct StdbRunReviewRecorder<'a> {
    pub writer: &'a StdbClient,
}

#[async_trait]
impl RunReviewRecorder for StdbRunReviewRecorder<'_> {
    async fn record(
        &self,
        organization_id: u64,
        company_id: u64,
        run_id: u64,
        program_ref: &str,
        result: &RunReviewResult,
    ) -> Result<()> {
        self.writer
            .call_reducer(ReducerCall::from_name(
                "record_ai_run_review",
                json!([
                    organization_id,
                    company_id,
                    {
                        "run_id": run_id,
                        "program_ref": program_ref,
                        "disposition": result.disposition.label(),
                        "rationale": result.rationale,
                        "provider": result.provider,
                        "model": result.model,
                    }
                ]),
            ))
            .await
            .context("record durable run review")
    }
}

#[cfg(test)]
mod tests {
    use super::super::governed_program::{GovernedProgramStop, GovernedProgramTraceStep};
    use super::super::intelligence::{DecisionProvider, DecisionResponse};
    use super::*;
    use anyhow::Result;
    use async_trait::async_trait;

    struct Reviewer;

    #[async_trait]
    impl DecisionProvider for Reviewer {
        async fn decide(&self, request: DecisionRequest) -> Result<DecisionResponse> {
            assert_eq!(request.decision_type.name, "RunReviewDisposition");
            Ok(DecisionResponse {
                kind: DecisionKind::Choice,
                choice: Some("healthy".to_string()),
                score: None,
                probability: None,
                confidence: Some(0.9),
                rationale: Some("trace is internally consistent".to_string()),
                model: "review-model".to_string(),
                provider: "review-provider".to_string(),
                input_tokens: 1,
                output_tokens: 1,
            })
        }
    }

    #[test]
    fn deterministic_review_rejects_completed_run_without_final_content() {
        let outcome = GovernedProgramOutcome {
            stop: GovernedProgramStop::Completed,
            final_content: None,
            outputs: std::collections::HashMap::new(),
            trace: vec![super::super::governed_program::GovernedProgramTraceStep {
                node_id: "generate".into(),
                kind: "generate".to_string(),
                summary: "generation attempted".into(),
            }],
            decision_calls: 0,
            capability_calls: 0,
            generation_provider: None,
            generation_model: None,
            generation_input_tokens: 0,
            generation_output_tokens: 0,
        };
        let result = deterministic_pre_review(&outcome).unwrap();
        assert_eq!(result.disposition, RunReviewDisposition::Defect);
        assert_eq!(result.provider, "deterministic-review");
    }

    #[tokio::test]
    async fn review_is_typed_and_side_effect_free() {
        let outcome = GovernedProgramOutcome {
            stop: GovernedProgramStop::Completed,
            final_content: Some("done".to_string()),
            outputs: Default::default(),
            trace: vec![
                GovernedProgramTraceStep {
                    node_id: "decide".to_string(),
                    kind: "choice".to_string(),
                    summary: "decision executed".to_string(),
                },
                GovernedProgramTraceStep {
                    node_id: "act".to_string(),
                    kind: "capability".to_string(),
                    summary: "capability executed".to_string(),
                },
                GovernedProgramTraceStep {
                    node_id: "generate".to_string(),
                    kind: "generate".to_string(),
                    summary: "generated answer admitted".to_string(),
                },
            ],
            decision_calls: 1,
            capability_calls: 1,
            generation_provider: None,
            generation_model: None,
            generation_input_tokens: 0,
            generation_output_tokens: 0,
        };
        let result = RunReviewProgram::new(&Reviewer)
            .review("summarize", &outcome)
            .await
            .unwrap();
        assert_eq!(result.disposition, RunReviewDisposition::Healthy);
    }

    #[test]
    fn disposition_labels_match_the_durable_reducer_s_accepted_set() {
        // Mirrors spacetimedb/src/ai/run_review.rs's DISPOSITIONS constant
        // exactly — a mismatch here would make every durable run review
        // write fail validation server-side.
        assert_eq!(RunReviewDisposition::Healthy.label(), "healthy");
        assert_eq!(
            RunReviewDisposition::ReviewRequired.label(),
            "review_required"
        );
        assert_eq!(RunReviewDisposition::Defect.label(), "defect");
        assert_eq!(
            RunReviewDisposition::IncidentCandidate.label(),
            "incident_candidate"
        );
    }

    struct RecordingRunReviewRecorder {
        calls: std::sync::Mutex<Vec<(u64, u64, u64, String, RunReviewDisposition)>>,
    }

    #[async_trait]
    impl RunReviewRecorder for RecordingRunReviewRecorder {
        async fn record(
            &self,
            organization_id: u64,
            company_id: u64,
            run_id: u64,
            program_ref: &str,
            result: &RunReviewResult,
        ) -> Result<()> {
            self.calls.lock().unwrap().push((
                organization_id,
                company_id,
                run_id,
                program_ref.to_string(),
                result.disposition,
            ));
            Ok(())
        }
    }

    #[tokio::test]
    async fn recorder_receives_the_reviewed_run_s_identity_and_disposition() {
        let outcome = GovernedProgramOutcome {
            stop: GovernedProgramStop::Completed,
            final_content: Some("done".to_string()),
            outputs: Default::default(),
            trace: vec![GovernedProgramTraceStep {
                node_id: "generate".to_string(),
                kind: "generate".to_string(),
                summary: "generated answer admitted".to_string(),
            }],
            decision_calls: 0,
            capability_calls: 0,
            generation_provider: None,
            generation_model: None,
            generation_input_tokens: 0,
            generation_output_tokens: 0,
        };
        let result = RunReviewProgram::new(&Reviewer)
            .review("summarize", &outcome)
            .await
            .unwrap();
        let recorder = RecordingRunReviewRecorder {
            calls: std::sync::Mutex::new(Vec::new()),
        };
        recorder
            .record(9, 3, 42, "test-program@1", &result)
            .await
            .unwrap();
        let calls = recorder.calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(
            calls[0],
            (
                9,
                3,
                42,
                "test-program@1".to_string(),
                RunReviewDisposition::Healthy
            )
        );
    }
}
