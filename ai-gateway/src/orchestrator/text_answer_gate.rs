//! AIH-15: the §7.3 answer gate for free-text answers.
//!
//! `/v1/rag` and the direct-execution loop produce prose, not the structured
//! claims and passage citations the governed-program path produces. They still
//! must not release a candidate as a validated answer, so this module applies
//! the checks that *do* apply to prose:
//!
//! - **Evidence exists.** An answer resting on no server-produced evidence
//!   (no live snapshot, no tool result) requires review; it is never released
//!   as validated.
//! - **Figures trace to data.** A material figure (money, a percentage, a
//!   decimal, a four-digit-plus integer) must appear in the evidence the server
//!   holds — live ERP rows, tool outputs — or in the user's own question. An
//!   untraceable figure qualifies the answer, and the limitation is appended to
//!   the released text so a caveat cannot be dropped after the gate.
//! - **Nothing unverified is released.** `RequiresReview` and `Blocked`
//!   withhold the candidate entirely; the caller gets the reason, not the text.
//!
//! What this does *not* establish: prose carries no passage citations, so no
//! claim is checked against a source passage and no semantic claim-coverage
//! check runs. The verification methods reported are therefore deterministic
//! only, and an `admitted` outcome means "no traceability defect found", never
//! domain approval.

use std::collections::HashSet;

use anyhow::Result;
use async_trait::async_trait;
use serde::Serialize;
use serde_json::Value;

use super::answer_gate::{
    collect_json_figures, extract_figures, EvidenceGatedAnswerAdmission, GatePolicy, GateScope,
    PassageCatalog, SourcePassage,
};
use super::governed_services::{
    qualified_content, AdmissionEvidence, AnswerAdmissionOutcome, VerificationMethod,
};
use super::intelligence::{EvidenceRef, FinalDraft};
use crate::providers::llm::LlmMessage;

/// What the server itself established while producing an answer.
#[derive(Debug, Clone, Default)]
pub struct TextEvidence {
    /// One reference per real piece of evidence (a live snapshot, an executed
    /// tool result).
    pub refs: Vec<EvidenceRef>,
    /// Every number in that evidence.
    pub figures: Vec<f64>,
}

impl TextEvidence {
    pub fn add_ref(&mut self, kind: &str, id: impl Into<String>) {
        self.refs.push(EvidenceRef {
            kind: kind.to_string(),
            id: id.into(),
        });
    }

    /// Numbers appearing anywhere in a JSON value the server produced.
    pub fn add_json(&mut self, value: &Value) {
        collect_json_figures(value, &mut self.figures);
    }

    /// Numbers the *user* supplied. Echoing them back is not fabrication, so
    /// they count as traceable; they are not evidence and add no reference.
    pub fn add_user_text(&mut self, text: &str) {
        self.figures
            .extend(extract_figures(text).into_iter().map(|figure| figure.value));
    }
}

/// The outcome in the vocabulary clients see.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TextAnswerOutcome {
    Admitted,
    Qualified,
    RequiresReview,
    Blocked,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TextAnswerVerification {
    pub outcome: TextAnswerOutcome,
    /// Always deterministic here; see the module docs.
    pub methods: Vec<&'static str>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub limitations: Vec<String>,
    /// Why a candidate was withheld.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GatedTextAnswer {
    /// The text safe to show: the candidate (with limitations appended when
    /// qualified), or `None` when it was withheld.
    pub released: Option<String>,
    pub verification: TextAnswerVerification,
}

impl GatedTextAnswer {
    pub fn is_released(&self) -> bool {
        self.released.is_some()
    }

    /// What to show in place of a withheld candidate.
    pub fn withheld_notice(&self) -> String {
        match &self.verification.reason {
            Some(reason) => format!("This answer could not be verified and was withheld: {reason}"),
            None => "This answer could not be verified and was withheld.".to_string(),
        }
    }
}

/// Evidence from a direct-execution loop transcript. Only what the server
/// itself produced counts: a tool result that carries data. A tool *error*, an
/// assistant message, or the model's own claim of having "checked" something
/// is not evidence. The user's own words supply figures they stated.
pub fn evidence_from_transcript(transcript: &[LlmMessage]) -> TextEvidence {
    let mut evidence = TextEvidence::default();
    for (index, message) in transcript.iter().enumerate() {
        match message {
            LlmMessage::Text { role, content } if role == "user" => {
                evidence.add_user_text(content);
            }
            LlmMessage::ToolResult {
                tool_call_id,
                name,
                content,
            } => {
                let Ok(result) = serde_json::from_str::<Value>(content) else {
                    continue;
                };
                let Some(data) = result.get("data").filter(|data| !data.is_null()) else {
                    continue;
                };
                evidence.add_ref(
                    "tool_result",
                    tool_call_id
                        .clone()
                        .unwrap_or_else(|| format!("{name}#{index}")),
                );
                evidence.add_json(data);
            }
            _ => {}
        }
    }
    evidence
}

/// Prose cites no passages, so there is nothing to resolve.
struct NoPassages;

#[async_trait]
impl PassageCatalog for NoPassages {
    async fn source_passages(
        &self,
        _organization_id: u64,
        _company_id: u64,
        _kind: &str,
        _source_key: &str,
    ) -> Result<Vec<SourcePassage>> {
        Ok(Vec::new())
    }
}

/// Judge a free-text candidate. Deterministic and side-effect free.
pub async fn gate_text_answer(
    organization_id: u64,
    company_id: u64,
    candidate: &str,
    evidence: &TextEvidence,
) -> Result<GatedTextAnswer> {
    let catalog = NoPassages;
    let gate = EvidenceGatedAnswerAdmission {
        scope: GateScope {
            organization_id,
            company_id,
            as_of_micros: chrono::Utc::now().timestamp_micros(),
            required_applicability: Vec::new(),
        },
        policy: GatePolicy::default(),
        catalog: &catalog,
        claim_checker: None,
    };
    let known: HashSet<EvidenceRef> = evidence.refs.iter().cloned().collect();
    let draft = FinalDraft::new(candidate.to_string(), evidence.refs.clone());
    let (report, _) = gate
        .evaluate(
            &draft,
            &AdmissionEvidence {
                known: &known,
                data_figures: &evidence.figures,
            },
        )
        .await?;

    let methods: Vec<&'static str> = report
        .methods
        .iter()
        .map(|method: &VerificationMethod| method.label())
        .collect();
    Ok(match report.outcome {
        AnswerAdmissionOutcome::Admitted => GatedTextAnswer {
            released: Some(candidate.to_string()),
            verification: TextAnswerVerification {
                outcome: TextAnswerOutcome::Admitted,
                methods,
                limitations: Vec::new(),
                reason: None,
            },
        },
        AnswerAdmissionOutcome::Qualified { limitations } => GatedTextAnswer {
            released: Some(qualified_content(candidate, &limitations)),
            verification: TextAnswerVerification {
                outcome: TextAnswerOutcome::Qualified,
                methods,
                limitations,
                reason: None,
            },
        },
        AnswerAdmissionOutcome::RequiresReview { reason } => GatedTextAnswer {
            released: None,
            verification: TextAnswerVerification {
                outcome: TextAnswerOutcome::RequiresReview,
                methods,
                limitations: Vec::new(),
                reason: Some(reason),
            },
        },
        AnswerAdmissionOutcome::Blocked { reason } => GatedTextAnswer {
            released: None,
            verification: TextAnswerVerification {
                outcome: TextAnswerOutcome::Blocked,
                methods,
                limitations: Vec::new(),
                reason: Some(reason),
            },
        },
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn evidence(row: Value) -> TextEvidence {
        let mut evidence = TextEvidence::default();
        evidence.add_ref("live_snapshot", "sale_order:42");
        evidence.add_json(&row);
        evidence
    }

    #[tokio::test]
    async fn an_answer_whose_figures_trace_to_the_data_is_admitted_unchanged() {
        let evidence = evidence(json!({ "amount_total": 1250.5, "state": "sale" }));
        let answer = "Order #42 totals $1,250.50 and is confirmed.";
        let gated = gate_text_answer(1, 2, answer, &evidence).await.unwrap();
        assert_eq!(gated.verification.outcome, TextAnswerOutcome::Admitted);
        assert_eq!(gated.released.as_deref(), Some(answer));
        assert_eq!(gated.verification.methods, vec!["deterministic"]);
    }

    #[tokio::test]
    async fn an_untraceable_figure_qualifies_and_the_caveat_travels_with_the_text() {
        let evidence = evidence(json!({ "amount_total": 1250.5 }));
        let gated = gate_text_answer(1, 2, "Order #42 totals $9,999.99.", &evidence)
            .await
            .unwrap();
        assert_eq!(gated.verification.outcome, TextAnswerOutcome::Qualified);
        let released = gated.released.unwrap();
        assert!(released.starts_with("Order #42 totals $9,999.99."));
        assert!(
            released.contains("Limitations of this answer:"),
            "{released}"
        );
        assert!(released.contains("9,999.99"), "{released}");
        assert!(!gated.verification.limitations.is_empty());
    }

    #[tokio::test]
    async fn an_answer_with_no_server_evidence_is_withheld_for_review() {
        let gated = gate_text_answer(1, 2, "Revenue is up 12 percent.", &TextEvidence::default())
            .await
            .unwrap();
        assert_eq!(
            gated.verification.outcome,
            TextAnswerOutcome::RequiresReview
        );
        assert!(gated.released.is_none());
        assert!(gated
            .verification
            .reason
            .as_deref()
            .unwrap()
            .contains("no evidence"));
        assert!(gated.withheld_notice().contains("withheld"));
    }

    #[tokio::test]
    async fn an_empty_candidate_is_blocked_and_never_released() {
        let gated = gate_text_answer(1, 2, "   ", &evidence(json!({ "a": 1 })))
            .await
            .unwrap();
        assert_eq!(gated.verification.outcome, TextAnswerOutcome::Blocked);
        assert!(gated.released.is_none());
    }

    #[tokio::test]
    async fn figures_the_user_supplied_are_not_fabrication() {
        let mut evidence = evidence(json!({ "state": "sale" }));
        evidence.add_user_text("Is a $5,000.00 deposit enough for order 42?");
        let gated = gate_text_answer(1, 2, "A $5,000.00 deposit is on file.", &evidence)
            .await
            .unwrap();
        assert_eq!(gated.verification.outcome, TextAnswerOutcome::Admitted);
    }

    #[tokio::test]
    async fn a_withheld_candidate_text_is_never_in_the_verdict() {
        let gated = gate_text_answer(
            1,
            2,
            "Secret unverified claim of $77.77.",
            &TextEvidence::default(),
        )
        .await
        .unwrap();
        let serialized = serde_json::to_string(&gated.verification).unwrap();
        assert!(!serialized.contains("Secret unverified"), "{serialized}");
        assert!(!gated.withheld_notice().contains("Secret unverified"));
    }

    fn tool_result(id: &str, content: Value) -> LlmMessage {
        LlmMessage::ToolResult {
            tool_call_id: Some(id.to_string()),
            name: "sales_summary".into(),
            content: content.to_string(),
        }
    }

    #[test]
    fn transcript_evidence_counts_only_tool_results_that_carry_data() {
        let transcript = vec![
            LlmMessage::text("user", "What did we sell in March, roughly $2,000.00?"),
            LlmMessage::AssistantToolCalls {
                content: Some("I checked and revenue is 99999.99".into()),
                tool_calls: vec![],
            },
            tool_result(
                "call-1",
                json!({ "summary": "ok", "data": { "total": 2048.75 } }),
            ),
            tool_result("call-2", json!({ "error": "tool failed" })),
            tool_result("call-3", json!({ "summary": "empty", "data": null })),
            LlmMessage::ToolResult {
                tool_call_id: Some("call-4".into()),
                name: "x".into(),
                content: "not json".into(),
            },
            LlmMessage::text("assistant", "Revenue was $99,999.99."),
        ];
        let evidence = evidence_from_transcript(&transcript);
        assert_eq!(
            evidence.refs,
            vec![EvidenceRef {
                kind: "tool_result".into(),
                id: "call-1".into()
            }]
        );
        assert!(evidence.figures.contains(&2048.75));
        assert!(evidence.figures.contains(&2000.0), "user figure");
        // Neither the assistant's message nor a failed tool contributes.
        assert!(!evidence
            .figures
            .iter()
            .any(|f| (*f - 99999.99).abs() < 1e-6));
    }

    #[tokio::test]
    async fn a_loop_candidate_with_no_successful_tool_result_is_withheld() {
        let transcript = vec![
            LlmMessage::text("user", "How much did we sell?"),
            tool_result("call-1", json!({ "error": "tool failed" })),
        ];
        let evidence = evidence_from_transcript(&transcript);
        let gated = gate_text_answer(1, 2, "We sold $12,345.67.", &evidence)
            .await
            .unwrap();
        assert_eq!(
            gated.verification.outcome,
            TextAnswerOutcome::RequiresReview
        );
        assert!(gated.released.is_none());
    }

    #[tokio::test]
    async fn a_loop_candidate_grounded_in_a_tool_result_is_released() {
        let transcript = vec![
            LlmMessage::text("user", "How much did we sell?"),
            tool_result(
                "call-1",
                json!({ "summary": "ok", "data": { "total": 12345.67 } }),
            ),
        ];
        let evidence = evidence_from_transcript(&transcript);
        let gated = gate_text_answer(1, 2, "We sold $12,345.67.", &evidence)
            .await
            .unwrap();
        assert_eq!(gated.verification.outcome, TextAnswerOutcome::Admitted);
        assert!(gated.is_released());
    }

    #[test]
    fn verification_serializes_with_snake_case_outcomes_and_omits_empty_fields() {
        let verification = TextAnswerVerification {
            outcome: TextAnswerOutcome::RequiresReview,
            methods: vec!["deterministic"],
            limitations: vec![],
            reason: Some("no evidence".into()),
        };
        let value = serde_json::to_value(&verification).unwrap();
        assert_eq!(value["outcome"], "requires_review");
        assert!(value.get("limitations").is_none());
        assert_eq!(value["reason"], "no evidence");
    }
}
