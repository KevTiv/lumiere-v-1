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
//! Passage-backed answers (`gate_text_answer_with_passages`, used by `/v1/rag`)
//! add the checks the governed-program path applies to persisted evidence: a
//! claim cites a passage only as `{"kind":"passage","id":"<id>"}`, the server
//! binds that id to the full citation from the acting user's authorized
//! catalog, and every passage-backed claim must be judged as supported by a
//! semantic checker. No checker, or a failing one, requires review — retrieval
//! alone is never support.
//!
//! What this does *not* establish: a model-assisted verdict is fallible and
//! confers no domain approval, and a live-snapshot claim is checked only for
//! traceability, not against the snapshot semantically.

use std::collections::HashSet;

use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::answer_gate::{
    collect_json_figures, extract_figures, AnswerProvenance, ClaimVerification,
    EvidenceGatedAnswerAdmission, GatePolicy, GateScope, PassageCatalog,
};
#[allow(unused_imports)] // the checker seam is also used by route tests
pub(crate) use super::answer_gate::{
    ClaimCoverageChecker, ClaimSupport, ClaimVerdict, PassageStatus, SourcePassage,
};
use super::governed_services::{
    qualified_content, AdmissionEvidence, AnswerAdmissionOutcome, VerificationMethod,
};
use super::intelligence::{
    ClaimedCalculation, EvidenceRef, FinalDraft, MaterialClaim, PassageCitation,
};
use super::reviewed_claims::{ReviewedClaimResolver, ReviewedOutcome};
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

    /// Whether any released claim rests on a durable, currently valid passage.
    /// Those answers must carry inspectable provenance before release.
    pub fn is_passage_backed(&self) -> bool {
        self.released.is_some()
            && self
                .durable_provenance
                .claims
                .iter()
                .any(|claim| !claim.passage_ids.is_empty())
    }

    /// Replace a released answer with a withheld verdict. The reason must be
    /// generic: it is shown to the user and must never carry evidence content.
    pub fn withhold(&mut self, reason: &str) {
        self.released = None;
        self.verification = TextAnswerVerification {
            outcome: TextAnswerOutcome::RequiresReview,
            methods: self.verification.methods.clone(),
            limitations: Vec::new(),
            reason: Some(reason.to_string()),
        };
        self.provenance.redact_for_withholding(reason);
        self.durable_provenance = AnswerProvenance::default();
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

/// The passages an acting user is authorized to see for one answer, held in
/// memory for the length of one gate run. It is the *only* passage authority
/// the gate consults: it cannot resolve a passage the server did not put in
/// front of the model, in another organization or company, or in another
/// version.
struct AuthorizedPassageCatalog<'a> {
    organization_id: u64,
    company_id: u64,
    passages: &'a [SourcePassage],
}

#[async_trait]
impl PassageCatalog for AuthorizedPassageCatalog<'_> {
    async fn source_passages(
        &self,
        organization_id: u64,
        company_id: u64,
        kind: &str,
        source_key: &str,
    ) -> Result<Vec<SourcePassage>> {
        if organization_id != self.organization_id || company_id != self.company_id {
            return Ok(Vec::new());
        }
        Ok(self
            .passages
            .iter()
            .filter(|passage| passage.kind == kind && passage.source_key == source_key)
            .cloned()
            .collect())
    }
}

/// The canonical model-facing reference for an authorized passage.
pub const PASSAGE_REF_KIND: &str = "passage";

fn passage_ref(passage: &SourcePassage) -> EvidenceRef {
    EvidenceRef {
        kind: PASSAGE_REF_KIND.to_string(),
        id: passage.id.to_string(),
    }
}

/// The complete citation for an authorized passage, taken from the server's
/// own record. Nothing in it comes from the model.
fn bound_citation(passage: &SourcePassage) -> PassageCitation {
    PassageCitation {
        kind: passage.kind.clone(),
        id: passage.source_key.clone(),
        source_version: passage.version.clone(),
        passage_key: passage.passage_key.clone(),
    }
}

/// A withheld candidate must not come back to the client through its own
/// verdict. The gate's findings quote the claim they are about, and a claim
/// checker's rationale or error may quote passage or provider text; none of
/// that is verified, so withheld reasons keep only the category of failure.
fn redact_withheld_reason(reason: &str, structured: &StructuredTextDraft) -> String {
    const MARKER: &str = "[claim withheld]";
    let mut texts: Vec<&str> = structured
        .claims
        .iter()
        .map(|claim| claim.text.trim())
        .chain(std::iter::once(structured.content.trim()))
        .filter(|text| !text.is_empty())
        .collect();
    texts.sort_by_key(|text| std::cmp::Reverse(text.len()));
    texts.dedup();
    let mut redacted = reason.to_string();
    for text in texts {
        redacted = redacted.replace(text, MARKER);
    }
    redacted
        .split("; ")
        .map(|segment| {
            if segment.starts_with("claim coverage check unavailable (") {
                // The provider's error text is not for the client.
                "claim coverage check unavailable".to_string()
            } else if let Some(end) = segment.find(MARKER) {
                // Drop a reviewer rationale trailing the quoted claim.
                segment[..end + MARKER.len()].to_string()
            } else {
                segment.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("; ")
}

/// Judge a free-text candidate that cites no persisted passages.
/// Deterministic and side-effect free.
pub async fn gate_text_answer(
    organization_id: u64,
    company_id: u64,
    candidate: &str,
    evidence: &TextEvidence,
) -> Result<GatedTextAnswer> {
    gate_candidate(
        organization_id,
        company_id,
        candidate,
        evidence,
        &NoPassages,
        &[],
        false,
        None,
        None,
    )
    .await
}

/// Judge a candidate against the passages the acting user is authorized to see.
///
/// A claim cites a passage only as `{"kind":"passage","id":"<passage id>"}`.
/// The server binds that id to the complete [`PassageCitation`] from
/// `passages`; a model-supplied version, key, text or hash is never accepted,
/// and an id outside `passages` blocks the candidate. Every passage-backed
/// claim must then be judged as supported by `claim_checker`; with no checker,
/// or one that fails, the answer requires review and is withheld. ANN
/// retrieval alone never counts as support.
pub(crate) async fn gate_text_answer_with_passages(
    organization_id: u64,
    company_id: u64,
    candidate: &str,
    evidence: &TextEvidence,
    passages: &[SourcePassage],
    claim_checker: Option<&dyn ClaimCoverageChecker>,
) -> Result<GatedTextAnswer> {
    gate_text_answer_with_passages_and_reviews(
        organization_id,
        company_id,
        candidate,
        evidence,
        passages,
        claim_checker,
        None,
    )
    .await
}

/// [`gate_text_answer_with_passages`] that may also reuse an exact, current,
/// human-reviewed claim in place of the semantic check. The server resolves
/// the reviewed claim; the model's output never names one.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn gate_text_answer_with_passages_and_reviews(
    organization_id: u64,
    company_id: u64,
    candidate: &str,
    evidence: &TextEvidence,
    passages: &[SourcePassage],
    claim_checker: Option<&dyn ClaimCoverageChecker>,
    reviewed_claims: Option<&dyn ReviewedClaimResolver>,
) -> Result<GatedTextAnswer> {
    let catalog = AuthorizedPassageCatalog {
        organization_id,
        company_id,
        passages,
    };
    gate_candidate(
        organization_id,
        company_id,
        candidate,
        evidence,
        &catalog,
        passages,
        true,
        claim_checker,
        reviewed_claims,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn gate_candidate(
    organization_id: u64,
    company_id: u64,
    candidate: &str,
    evidence: &TextEvidence,
    catalog: &dyn PassageCatalog,
    passages: &[SourcePassage],
    bind_passages: bool,
    claim_checker: Option<&dyn ClaimCoverageChecker>,
    reviewed_claims: Option<&dyn ReviewedClaimResolver>,
) -> Result<GatedTextAnswer> {
    let structured = match parse_candidate(candidate, evidence) {
        Ok(structured) => structured,
        Err(reason) => return Ok(blocked_text_answer(reason)),
    };
    let mut known: HashSet<EvidenceRef> = evidence.refs.iter().cloned().collect();
    if bind_passages {
        known.extend(passages.iter().map(passage_ref));
    }
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
    // Per claim: the non-passage support refs the gate reasons about, and the
    // server-bound passage citations.
    let mut run_supports: Vec<Vec<EvidenceRef>> = Vec::with_capacity(structured.claims.len());
    let mut bound_supports: Vec<Vec<PassageCitation>> = Vec::with_capacity(structured.claims.len());
    for claim in &structured.claims {
        if claim.text.trim().is_empty() || !structured.content.contains(claim.text.trim()) {
            return Ok(blocked_text_answer(
                "each structured claim must be nonempty and appear in answer content",
            ));
        }
        if bind_passages && !claim.passage_support.is_empty() {
            return Ok(blocked_text_answer(
                "passage citations are bound by the server and cannot be supplied by the answer",
            ));
        }
        let mut run = Vec::new();
        let mut bound: Vec<PassageCitation> = Vec::new();
        for support in &claim.support_refs {
            if bind_passages && support.kind == PASSAGE_REF_KIND {
                let Some(passage) = passages
                    .iter()
                    .find(|passage| passage.id != 0 && passage_ref(passage) == *support)
                else {
                    return Ok(blocked_text_answer(format!(
                        "claim cites passage '{}' that is not authorized for this answer",
                        support.id
                    )));
                };
                let citation = bound_citation(passage);
                if !bound.contains(&citation) {
                    bound.push(citation);
                }
            } else if known.contains(support) {
                run.push(support.clone());
            } else {
                return Ok(blocked_text_answer(format!(
                    "claim support '{}:{}' was not produced by this run",
                    support.kind, support.id
                )));
            }
            if !citations.contains(support) {
                citations.push(support.clone());
            }
        }
        run_supports.push(run);
        bound_supports.push(bound);
    }

    let gate = EvidenceGatedAnswerAdmission {
        scope: GateScope {
            organization_id,
            company_id,
            as_of_micros: chrono::Utc::now().timestamp_micros(),
            required_applicability: Vec::new(),
        },
        policy: GatePolicy::default(),
        catalog,
        claim_checker,
        reviewed_claims,
    };
    let draft = FinalDraft {
        content: structured.content.clone(),
        citations: citations.clone(),
        claims: structured
            .claims
            .iter()
            .zip(run_supports.iter().zip(&bound_supports))
            .map(|(claim, (run, bound))| MaterialClaim {
                text: claim.text.clone(),
                support_refs: if bind_passages {
                    run.clone()
                } else {
                    claim.support_refs.clone()
                },
                supports: if bind_passages {
                    bound.clone()
                } else {
                    claim.passage_support.clone()
                },
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

    let mut claim_limitations = Vec::new();
    let mut claim_provenance = Vec::with_capacity(structured.claims.len());
    for (index, claim) in structured.claims.iter().enumerate() {
        let (verification_method, verification_outcome) = match durable_provenance
            .claims
            .get(index)
            .map(|assessment| &assessment.verification)
        {
            Some(ClaimVerification::Model { support, .. }) => (
                "model_assisted",
                match support {
                    ClaimSupport::Supported => "supported",
                    ClaimSupport::Partial => "qualified",
                    ClaimSupport::Unsupported => "unsupported",
                },
            ),
            Some(ClaimVerification::HumanReviewed { outcome, .. }) => (
                "human_reviewed",
                match outcome {
                    ReviewedOutcome::Supported => "supported",
                    ReviewedOutcome::Qualified => "qualified",
                },
            ),
            Some(ClaimVerification::ReviewRejected { .. }) => ("human_reviewed", "unsupported"),
            Some(ClaimVerification::Unchecked) => ("none", "unverified"),
            Some(ClaimVerification::Unresolved) => ("deterministic", "unresolved"),
            Some(ClaimVerification::RunEvidence) => ("deterministic", "traceable"),
            Some(ClaimVerification::NoSupportCited) | None => ("deterministic", "unverified"),
        };
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
            passage_support: if bind_passages {
                bound_supports[index].clone()
            } else {
                claim.passage_support.clone()
            },
            verification_method,
            verification_outcome,
            limitations,
        });
    }

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
            let reason = redact_withheld_reason(&reason, &structured);
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
            let reason = redact_withheld_reason(&reason, &structured);
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

    // ── persisted-passage claims ──────────────────────────────────────────────

    const PASSAGE_BODY: &str = "Returns over 500 EUR require controller approval.";

    fn passage(id: u64, body: &str) -> SourcePassage {
        SourcePassage {
            id,
            kind: "policy".into(),
            source_key: "returns".into(),
            version: "2026".into(),
            passage_key: format!("p{id}"),
            content_hash: super::super::answer_gate::text_hash(body),
            text: body.into(),
            // Effective from the epoch: a dated passage admits cleanly.
            effective_from_micros: Some(0),
            effective_to_micros: None,
            applicability: Vec::new(),
            status: PassageStatus::Current,
        }
    }

    struct Scripted(Result<ClaimSupport, &'static str>);

    #[async_trait]
    impl ClaimCoverageChecker for Scripted {
        async fn check(
            &self,
            _claim: &str,
            passages: &[&SourcePassage],
        ) -> Result<super::super::answer_gate::ClaimVerdict> {
            assert!(
                !passages.is_empty(),
                "a checker is only asked about cited passages"
            );
            match self.0 {
                Ok(support) => Ok(super::super::answer_gate::ClaimVerdict {
                    support,
                    rationale: Some("the passage quoted: SECRET RATIONALE".into()),
                }),
                Err(error) => anyhow::bail!("{error} SECRET PROVIDER ERROR"),
            }
        }
    }

    fn passage_answer(text: &str, id: &str) -> String {
        structured(text, "passage", id)
    }

    #[tokio::test]
    async fn a_passage_reference_is_bound_to_the_servers_complete_citation() {
        let passages = [passage(7, PASSAGE_BODY)];
        let gated = gate_text_answer_with_passages(
            1,
            2,
            &passage_answer("Large returns need controller sign-off.", "7"),
            &TextEvidence::default(),
            &passages,
            Some(&Scripted(Ok(ClaimSupport::Supported))),
        )
        .await
        .unwrap();
        // A paraphrase is admitted only because the semantic check supported it.
        assert_eq!(gated.verification.outcome, TextAnswerOutcome::Admitted);
        assert_eq!(
            gated.verification.methods,
            vec!["deterministic", "model_assisted"]
        );
        assert!(gated.is_passage_backed());
        let claim = &gated.provenance.claims[0];
        assert_eq!(claim.verification_method, "model_assisted");
        assert_eq!(claim.verification_outcome, "supported");
        assert_eq!(
            claim.passage_support,
            vec![PassageCitation {
                kind: "policy".into(),
                id: "returns".into(),
                source_version: "2026".into(),
                passage_key: "p7".into(),
            }]
        );
        assert_eq!(gated.provenance.citations[0].kind, "passage");
        assert_eq!(gated.durable_provenance.claims[0].passage_ids, vec![7]);
    }

    #[tokio::test]
    async fn the_model_cannot_supply_or_widen_passage_authority() {
        let passages = [passage(7, PASSAGE_BODY)];
        let checker = Scripted(Ok(ClaimSupport::Supported));
        for candidate in [
            // A passage the actor is not authorized for.
            passage_answer("Large returns need sign-off.", "8"),
            passage_answer("Large returns need sign-off.", "0"),
            passage_answer("Large returns need sign-off.", "07"),
            // A model-authored citation, even one naming an authorized passage.
            json!({
                "content": "Large returns need sign-off.",
                "claims": [{
                    "text": "Large returns need sign-off.",
                    "supportRefs": [],
                    "passageSupport": [{"kind": "policy", "id": "returns", "source_version": "2026", "passage_key": "p7"}]
                }]
            })
            .to_string(),
        ] {
            let gated = gate_text_answer_with_passages(
                1,
                2,
                &candidate,
                &TextEvidence::default(),
                &passages,
                Some(&checker),
            )
            .await
            .unwrap();
            assert_eq!(gated.verification.outcome, TextAnswerOutcome::Blocked, "{candidate}");
            assert!(gated.released.is_none());
        }

        // With no authorized passage at all, no reference can resolve.
        let gated = gate_text_answer_with_passages(
            1,
            2,
            &passage_answer("Large returns need sign-off.", "7"),
            &TextEvidence::default(),
            &[],
            Some(&checker),
        )
        .await
        .unwrap();
        assert_eq!(gated.verification.outcome, TextAnswerOutcome::Blocked);
    }

    #[tokio::test]
    async fn the_plain_gate_still_rejects_passage_references() {
        // Publication and loop callers hold no passage catalog: a passage
        // reference there was not produced by the run.
        let gated = gate_text_answer(
            1,
            2,
            &passage_answer("Large returns need sign-off.", "7"),
            &evidence(json!({"a": 1})),
        )
        .await
        .unwrap();
        assert_eq!(gated.verification.outcome, TextAnswerOutcome::Blocked);
    }

    #[tokio::test]
    async fn an_unsupported_or_unchecked_passage_claim_is_never_admitted() {
        let passages = [passage(7, PASSAGE_BODY)];
        let claim = "Refunds never require approval.";
        let candidate = passage_answer(claim, "7");
        let unsupported = Scripted(Ok(ClaimSupport::Unsupported));
        let failing = Scripted(Err("reviewer timed out"));
        let checkers: [Option<&dyn ClaimCoverageChecker>; 3] =
            [Some(&unsupported), Some(&failing), None];
        for checker in checkers {
            let gated = gate_text_answer_with_passages(
                1,
                2,
                &candidate,
                &TextEvidence::default(),
                &passages,
                checker,
            )
            .await
            .unwrap();
            assert_eq!(
                gated.verification.outcome,
                TextAnswerOutcome::RequiresReview
            );
            assert!(gated.released.is_none());
            assert!(!gated.is_passage_backed());
            // Neither the candidate, the reviewer's rationale nor a provider
            // error comes back through the verdict.
            let verdict = serde_json::to_string(&json!({
                "notice": gated.withheld_notice(),
                "verification": gated.verification,
                "provenance": gated.provenance,
            }))
            .unwrap();
            for secret in [claim, "SECRET RATIONALE", "SECRET PROVIDER ERROR"] {
                assert!(!verdict.contains(secret), "{secret}: {verdict}");
            }
        }
    }

    #[tokio::test]
    async fn a_partly_supported_claim_is_qualified_not_admitted() {
        let passages = [passage(7, PASSAGE_BODY)];
        let gated = gate_text_answer_with_passages(
            1,
            2,
            &passage_answer("Large returns need sign-off.", "7"),
            &TextEvidence::default(),
            &passages,
            Some(&Scripted(Ok(ClaimSupport::Partial))),
        )
        .await
        .unwrap();
        assert_eq!(gated.verification.outcome, TextAnswerOutcome::Qualified);
        assert!(gated
            .released
            .as_deref()
            .unwrap()
            .contains("partly supported"));
    }

    #[tokio::test]
    async fn retrieval_alone_is_not_support() {
        let passages = [passage(7, PASSAGE_BODY)];
        let checker = Scripted(Ok(ClaimSupport::Supported));
        // The passage was retrieved, but the answer cites nothing.
        let uncited = json!({
            "content": PASSAGE_BODY,
            "claims": [{"text": PASSAGE_BODY, "supportRefs": []}]
        })
        .to_string();
        for candidate in [uncited.as_str(), PASSAGE_BODY] {
            let gated = gate_text_answer_with_passages(
                1,
                2,
                candidate,
                &TextEvidence::default(),
                &passages,
                Some(&checker),
            )
            .await
            .unwrap();
            assert_ne!(gated.verification.outcome, TextAnswerOutcome::Admitted);
            assert!(gated.released.is_none());
        }
    }

    #[tokio::test]
    async fn stale_tampered_or_undated_passages_do_not_admit() {
        let checker = Scripted(Ok(ClaimSupport::Supported));
        let run = |passage: SourcePassage| {
            let checker = &checker;
            async move {
                gate_text_answer_with_passages(
                    1,
                    2,
                    &passage_answer("Large returns need sign-off.", "7"),
                    &TextEvidence::default(),
                    &[passage],
                    Some(checker),
                )
                .await
                .unwrap()
            }
        };

        let mut tampered = passage(7, PASSAGE_BODY);
        tampered.text = "Returns never need approval.".into();
        assert_eq!(
            run(tampered).await.verification.outcome,
            TextAnswerOutcome::Blocked
        );

        let mut withdrawn = passage(7, PASSAGE_BODY);
        withdrawn.status = PassageStatus::Withdrawn;
        assert_eq!(
            run(withdrawn).await.verification.outcome,
            TextAnswerOutcome::Blocked
        );

        let mut superseded = passage(7, PASSAGE_BODY);
        superseded.status = PassageStatus::Superseded;
        let gated = run(superseded).await;
        assert_eq!(
            gated.verification.outcome,
            TextAnswerOutcome::RequiresReview
        );
        assert!(!gated.is_passage_backed());

        // Ingested documents carry no effective dates: released, but qualified.
        let mut undated = passage(7, PASSAGE_BODY);
        undated.effective_from_micros = None;
        let gated = run(undated).await;
        assert_eq!(gated.verification.outcome, TextAnswerOutcome::Qualified);
        assert!(gated.is_passage_backed());
    }

    #[tokio::test]
    async fn the_gate_only_resolves_passages_of_its_own_scope() {
        let catalog = AuthorizedPassageCatalog {
            organization_id: 1,
            company_id: 2,
            passages: &[passage(7, PASSAGE_BODY)],
        };
        assert_eq!(
            catalog
                .source_passages(1, 2, "policy", "returns")
                .await
                .unwrap()
                .len(),
            1
        );
        for (org, company, kind, key) in [
            (9, 2, "policy", "returns"),
            (1, 9, "policy", "returns"),
            (1, 2, "invoice", "returns"),
            (1, 2, "policy", "other"),
        ] {
            assert!(catalog
                .source_passages(org, company, kind, key)
                .await
                .unwrap()
                .is_empty());
        }
    }

    #[test]
    fn a_released_answer_can_be_withheld_without_leaking_its_claims() {
        let mut gated = GatedTextAnswer {
            released: Some("Secret released claim.".into()),
            verification: TextAnswerVerification {
                outcome: TextAnswerOutcome::Admitted,
                methods: vec!["deterministic"],
                limitations: Vec::new(),
                reason: None,
            },
            provenance: TextAnswerProvenance {
                claims: vec![TextClaimProvenance {
                    text: "Secret released claim.".into(),
                    support_refs: Vec::new(),
                    passage_support: Vec::new(),
                    verification_method: "deterministic",
                    verification_outcome: "traceable",
                    limitations: Vec::new(),
                }],
                citations: vec![EvidenceRef {
                    kind: "passage".into(),
                    id: "7".into(),
                }],
                calculations: Vec::new(),
                persisted: true,
                persistence_reason: None,
                contribution_id: Some(3),
                claim_ids: vec![4],
            },
            durable_provenance: AnswerProvenance::default(),
        };
        gated.withhold("evidence changed before release");
        assert!(gated.released.is_none());
        assert_eq!(
            gated.verification.outcome,
            TextAnswerOutcome::RequiresReview
        );
        let serialized = serde_json::to_string(&json!({
            "notice": gated.withheld_notice(),
            "verification": gated.verification,
            "provenance": gated.provenance,
        }))
        .unwrap();
        assert!(
            !serialized.contains("Secret released claim"),
            "{serialized}"
        );
        assert!(gated.provenance.claim_ids.is_empty());
        assert!(!gated.provenance.persisted);
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
