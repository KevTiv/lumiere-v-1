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
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::answer_gate::{
    collect_json_figures, extract_figures, AnswerProvenance, EvidenceGatedAnswerAdmission,
    GatePolicy, GateScope, PassageCatalog, SourcePassage,
};
use super::governed_services::{
    qualified_content, AdmissionEvidence, AnswerAdmissionOutcome, VerificationMethod,
};
use super::intelligence::{
    ClaimedCalculation, EvidenceRef, FinalDraft, MaterialClaim, PassageCitation,
};
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

/// One claim in a free-text answer and the server-known evidence the claim
/// relies on. Support references are never copied from display snippets.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextClaimProvenance {
    pub text: String,
    pub support_refs: Vec<EvidenceRef>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub passage_support: Vec<PassageCitation>,
    pub verification_method: &'static str,
    pub verification_outcome: &'static str,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub limitations: Vec<String>,
}

/// Structured provenance returned with every model-produced text answer.
/// `persisted` is explicit because run-local tool results can support release
/// without automatically becoming durable source passages.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextAnswerProvenance {
    pub claims: Vec<TextClaimProvenance>,
    pub citations: Vec<EvidenceRef>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub calculations: Vec<TextCalculationProvenance>,
    pub persisted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub persistence_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contribution_id: Option<u64>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub claim_ids: Vec<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextCalculationProvenance {
    #[serde(flatten)]
    pub calculation: ClaimedCalculation,
    pub verification_method: &'static str,
    pub verification_outcome: &'static str,
}

impl TextAnswerProvenance {
    pub fn withheld(reason: impl Into<String>) -> Self {
        Self {
            claims: Vec::new(),
            citations: Vec::new(),
            calculations: Vec::new(),
            persisted: false,
            persistence_reason: Some(reason.into()),
            contribution_id: None,
            claim_ids: Vec::new(),
        }
    }

    pub fn mark_persisted(&mut self, contribution_id: u64, claim_ids: Vec<u64>) {
        self.persisted = true;
        self.persistence_reason = None;
        self.contribution_id = (contribution_id != 0).then_some(contribution_id);
        self.claim_ids = claim_ids;
    }

    pub fn mark_not_persisted(&mut self, reason: impl Into<String>) {
        self.persisted = false;
        self.persistence_reason = Some(reason.into());
        self.contribution_id = None;
        self.claim_ids.clear();
    }

    /// Remove every model-authored or model-selected value before a candidate
    /// is withheld. A safe answer notice must not be paired with raw claim
    /// text, calculations, or citation selections in another response field.
    pub fn redact_for_withholding(&mut self, reason: impl Into<String>) {
        self.claims.clear();
        self.citations.clear();
        self.calculations.clear();
        self.persisted = false;
        self.persistence_reason = Some(reason.into());
        self.contribution_id = None;
        self.claim_ids.clear();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct GatedTextAnswer {
    /// The text safe to show: the candidate (with limitations appended when
    /// qualified), or `None` when it was withheld.
    pub released: Option<String>,
    pub verification: TextAnswerVerification,
    pub provenance: TextAnswerProvenance,
    pub(super) durable_provenance: AnswerProvenance,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StructuredTextDraft {
    content: String,
    claims: Vec<StructuredTextClaim>,
    #[serde(default)]
    calculations: Vec<ClaimedCalculation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StructuredTextClaim {
    text: String,
    #[serde(default)]
    support_refs: Vec<EvidenceRef>,
    #[serde(default)]
    passage_support: Vec<PassageCitation>,
}

fn empty_provenance(reason: &str) -> TextAnswerProvenance {
    TextAnswerProvenance::withheld(reason)
}

fn blocked_text_answer(reason: impl Into<String>) -> GatedTextAnswer {
    let reason = reason.into();
    GatedTextAnswer {
        released: None,
        verification: TextAnswerVerification {
            outcome: TextAnswerOutcome::Blocked,
            methods: vec!["deterministic"],
            limitations: Vec::new(),
            reason: Some(reason.clone()),
        },
        provenance: empty_provenance(&reason),
        durable_provenance: AnswerProvenance::default(),
    }
}

fn parse_candidate(
    candidate: &str,
    _evidence: &TextEvidence,
) -> Result<StructuredTextDraft, String> {
    let trimmed = candidate.trim();
    if trimmed.starts_with('{') {
        return serde_json::from_str(trimmed)
            .map_err(|error| format!("structured answer is malformed: {error}"));
    }
    Ok(StructuredTextDraft {
        content: candidate.to_string(),
        claims: (!trimmed.is_empty())
            .then(|| StructuredTextClaim {
                text: candidate.to_string(),
                // Compatibility only: a prose response has no trustworthy
                // claim-to-evidence mapping. Co-occurrence with run evidence
                // is not support, so the synthesized claim stays unverified
                // and forces a qualified/review outcome.
                support_refs: Vec::new(),
                passage_support: Vec::new(),
            })
            .into_iter()
            .collect(),
        calculations: Vec::new(),
    })
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
    let structured = match parse_candidate(candidate, evidence) {
        Ok(structured) => structured,
        Err(reason) => return Ok(blocked_text_answer(reason)),
    };
    let known: HashSet<EvidenceRef> = evidence.refs.iter().cloned().collect();
    if structured.claims.is_empty() && !structured.content.trim().is_empty() {
        return Ok(blocked_text_answer(
            "structured answer must identify at least one material claim",
        ));
    }
    let normalized_content = structured
        .content
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let normalized_claims = structured
        .claims
        .iter()
        .flat_map(|claim| claim.text.split_whitespace())
        .collect::<Vec<_>>()
        .join(" ");
    if normalized_content != normalized_claims {
        return Ok(blocked_text_answer(
            "structured claims must cover the complete answer content in order",
        ));
    }

    let mut citations = Vec::new();
    let mut claim_provenance = Vec::with_capacity(structured.claims.len());
    let mut claim_limitations = Vec::new();
    for claim in &structured.claims {
        if claim.text.trim().is_empty() || !structured.content.contains(claim.text.trim()) {
            return Ok(blocked_text_answer(
                "each structured claim must be nonempty and appear in answer content",
            ));
        }
        for support in &claim.support_refs {
            if !known.contains(support) {
                return Ok(blocked_text_answer(format!(
                    "claim support '{}:{}' was not produced by this run",
                    support.kind, support.id
                )));
            }
            if !citations.contains(support) {
                citations.push(support.clone());
            }
        }
        let limitations = if claim.support_refs.is_empty() {
            let limitation = format!("claim has no server-known support: {}", claim.text.trim());
            claim_limitations.push(limitation.clone());
            vec![limitation]
        } else {
            Vec::new()
        };
        claim_provenance.push(TextClaimProvenance {
            text: claim.text.trim().to_string(),
            support_refs: claim.support_refs.clone(),
            passage_support: claim.passage_support.clone(),
            verification_method: "deterministic",
            verification_outcome: if claim.support_refs.is_empty() {
                "unverified"
            } else {
                "traceable"
            },
            limitations,
        });
    }

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
    let draft = FinalDraft {
        content: structured.content.clone(),
        citations: citations.clone(),
        claims: structured
            .claims
            .iter()
            .map(|claim| MaterialClaim {
                text: claim.text.clone(),
                support_refs: claim.support_refs.clone(),
                supports: claim.passage_support.clone(),
            })
            .collect(),
        calculations: structured.calculations.clone(),
    };
    let (report, durable_provenance) = gate
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
    let calculations = structured
        .calculations
        .iter()
        .zip(&durable_provenance.calculations)
        .map(|(calculation, assessment)| TextCalculationProvenance {
            calculation: calculation.clone(),
            verification_method: "deterministic",
            verification_outcome: if assessment.recomputes {
                "supported"
            } else {
                "unsupported"
            },
        })
        .collect();
    let provenance = TextAnswerProvenance {
        claims: claim_provenance,
        citations,
        calculations,
        persisted: false,
        persistence_reason: Some("answer provenance has not been durably recorded".to_string()),
        contribution_id: None,
        claim_ids: Vec::new(),
    };
    let outcome = match report.outcome {
        AnswerAdmissionOutcome::Admitted if !claim_limitations.is_empty() => {
            AnswerAdmissionOutcome::Qualified {
                limitations: claim_limitations,
            }
        }
        other => other,
    };
    Ok(match outcome {
        AnswerAdmissionOutcome::Admitted => GatedTextAnswer {
            released: Some(structured.content.clone()),
            verification: TextAnswerVerification {
                outcome: TextAnswerOutcome::Admitted,
                methods,
                limitations: Vec::new(),
                reason: None,
            },
            provenance,
            durable_provenance,
        },
        AnswerAdmissionOutcome::Qualified { limitations } => GatedTextAnswer {
            released: Some(qualified_content(&structured.content, &limitations)),
            verification: TextAnswerVerification {
                outcome: TextAnswerOutcome::Qualified,
                methods,
                limitations,
                reason: None,
            },
            provenance,
            durable_provenance,
        },
        AnswerAdmissionOutcome::RequiresReview { reason } => {
            let mut provenance = provenance;
            provenance.redact_for_withholding("candidate withheld pending review");
            GatedTextAnswer {
                released: None,
                verification: TextAnswerVerification {
                    outcome: TextAnswerOutcome::RequiresReview,
                    methods,
                    limitations: Vec::new(),
                    reason: Some(reason),
                },
                provenance,
                durable_provenance: AnswerProvenance::default(),
            }
        }
        AnswerAdmissionOutcome::Blocked { reason } => {
            let mut provenance = provenance;
            provenance.redact_for_withholding("candidate blocked by answer gate");
            GatedTextAnswer {
                released: None,
                verification: TextAnswerVerification {
                    outcome: TextAnswerOutcome::Blocked,
                    methods,
                    limitations: Vec::new(),
                    reason: Some(reason),
                },
                provenance,
                durable_provenance: AnswerProvenance::default(),
            }
        }
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

    fn structured(content: &str, kind: &str, id: &str) -> String {
        json!({
            "content": content,
            "claims": [{
                "text": content,
                "supportRefs": [{"kind": kind, "id": id}],
                "passageSupport": []
            }],
            "calculations": []
        })
        .to_string()
    }

    #[tokio::test]
    async fn an_answer_whose_figures_trace_to_the_data_is_admitted_unchanged() {
        let evidence = evidence(json!({ "amount_total": 1250.5, "state": "sale" }));
        let content = "Order #42 totals $1,250.50 and is confirmed.";
        let answer = structured(content, "live_snapshot", "sale_order:42");
        let gated = gate_text_answer(1, 2, &answer, &evidence).await.unwrap();
        assert_eq!(gated.verification.outcome, TextAnswerOutcome::Admitted);
        assert_eq!(gated.released.as_deref(), Some(content));
        assert_eq!(gated.verification.methods, vec!["deterministic"]);
        assert_eq!(gated.provenance.claims[0].verification_outcome, "traceable");
    }

    #[tokio::test]
    async fn unstructured_prose_is_withheld_even_when_a_figure_is_traceable() {
        let evidence = evidence(json!({ "amount_total": 1250.5 }));
        let gated = gate_text_answer(1, 2, "Order #42 totals $9,999.99.", &evidence)
            .await
            .unwrap();
        assert_eq!(
            gated.verification.outcome,
            TextAnswerOutcome::RequiresReview
        );
        assert!(gated.released.is_none());
        assert!(gated.provenance.claims.is_empty());
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
        assert_eq!(
            gated.verification.outcome,
            TextAnswerOutcome::RequiresReview
        );
        assert!(gated.released.is_none());
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
        let complete = serde_json::to_string(&json!({
            "answer": gated.withheld_notice(),
            "verification": gated.verification,
            "provenance": gated.provenance,
        }))
        .unwrap();
        assert!(!complete.contains("Secret unverified"), "{complete}");
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
        let answer = structured("We sold $12,345.67.", "tool_result", "call-1");
        let gated = gate_text_answer(1, 2, &answer, &evidence).await.unwrap();
        assert_eq!(gated.verification.outcome, TextAnswerOutcome::Admitted);
        assert!(gated.is_released());
    }

    #[tokio::test]
    async fn malformed_unknown_or_incomplete_claim_provenance_is_blocked() {
        let evidence = evidence(json!({"amount_total": 1250.5}));
        for candidate in [
            r#"{"content":"answer","claims":[]}"#,
            r#"{"content":"answer","claims":[{"text":"answer","supportRefs":[{"kind":"live_snapshot","id":"sale_order:999"}]}]}"#,
            r#"{"content":"first second","claims":[{"text":"first","supportRefs":[{"kind":"live_snapshot","id":"sale_order:42"}]}]}"#,
            r#"{"content":"answer","claims": [}"#,
        ] {
            let gated = gate_text_answer(1, 2, candidate, &evidence).await.unwrap();
            assert_eq!(gated.verification.outcome, TextAnswerOutcome::Blocked);
            assert!(gated.released.is_none());
        }
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
