//! Independent review of completed governed program runs.
//!
//! Review consumes only the observable completed trace/state. It cannot
//! execute capabilities, approve effects, or change the reviewed run.

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::governed_program::GovernedProgramOutcome;
use super::intelligence::{
    DecisionKind, DecisionProvider, DecisionRequest, DecisionTypeRef,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum RunReviewDisposition {
    Healthy,
    ReviewRequired,
    Defect,
    IncidentCandidate,
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

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::Result;
    use async_trait::async_trait;
    use super::super::governed_program::{
        GovernedProgramStop, GovernedProgramTraceStep,
    };
    use super::super::intelligence::{DecisionResponse, DecisionProvider};

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

    #[tokio::test]
    async fn review_is_typed_and_side_effect_free() {
        let outcome = GovernedProgramOutcome {
            stop: GovernedProgramStop::Completed,
            final_content: Some("done".to_string()),
            outputs: Default::default(),
            trace: vec![GovernedProgramTraceStep {
                node_id: "generate".to_string(),
                kind: "generate",
                summary: "generated answer admitted".to_string(),
            }],
            decision_calls: 1,
            capability_calls: 1,
        };
        let result = RunReviewProgram::new(&Reviewer)
            .review("summarize", &outcome)
            .await
            .unwrap();
        assert_eq!(result.disposition, RunReviewDisposition::Healthy);
    }
}
