//! GP-01 (governed intelligence program): provider-neutral intelligence
//! contracts.
//!
//! These types define the three replaceable intelligence operations —
//! `decide()`, `generate()`, `reason()` — described in
//! `docs/plans/governed-intelligence-program-architecture.md`. They are
//! additive only: nothing here is wired into `run.rs` or `agent_loop.rs`
//! yet, and none of these traits carry execution, authorization, or spend
//! authority. `ReasoningOutcome` can only ever produce a *proposal* or a
//! *candidate* draft; it has no variant that mutates state.

use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

/// Stable reference to a versioned organizational decision vocabulary entry
/// (see `governed-intelligence-program-architecture.md` §6). The registry
/// itself (GP-07) is a later work package; this is only the reference shape.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DecisionTypeRef {
    pub name: String,
    pub version: u32,
}

impl DecisionTypeRef {
    pub fn validate(&self) -> Result<()> {
        if self.name.trim().is_empty() {
            bail!("decision type name must be nonempty");
        }
        if self.version == 0 {
            bail!("decision type version must be positive");
        }
        Ok(())
    }
}

/// Reference to authorized evidence already resolved server-side. Never a
/// model-invented URL or free-text citation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EvidenceRef {
    pub kind: String,
    pub id: String,
}

impl EvidenceRef {
    pub fn validate(&self) -> Result<()> {
        if self.kind.trim().is_empty() || self.id.trim().is_empty() {
            bail!("evidence ref kind and id must be nonempty");
        }
        Ok(())
    }
}

/// Bounded summary of a prior decision case, supplied to a provider as
/// context only. Precedent informs; it never becomes current authorization
/// (architecture invariant #15).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PrecedentSummaryRef {
    pub decision_case_id: String,
    pub summary: String,
}

impl PrecedentSummaryRef {
    pub fn validate(&self) -> Result<()> {
        if self.decision_case_id.trim().is_empty() {
            bail!("precedent decision_case_id must be nonempty");
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DecisionKind {
    Choice,
    Score,
    Probability,
}

/// A bounded, typed question for a `DecisionProvider`. Contains no
/// authorization or execution state — only what the provider needs to
/// return a narrow typed judgment.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DecisionRequest {
    pub decision_type: DecisionTypeRef,
    pub kind: DecisionKind,
    pub question: String,
    /// Deterministic facts already computed by the program; the provider is
    /// not asked to infer values the runtime can derive (invariant #6).
    pub bounded_state: Value,
    /// Candidate values for `Choice`; must be empty for `Score`/`Probability`.
    pub candidates: Vec<String>,
    pub precedent: Vec<PrecedentSummaryRef>,
    pub evidence: Vec<EvidenceRef>,
}

impl DecisionRequest {
    pub fn validate(&self) -> Result<()> {
        self.decision_type.validate()?;
        if self.question.trim().is_empty() {
            bail!("decision question must be nonempty");
        }
        if !self.bounded_state.is_object() {
            bail!("decision bounded_state must be a JSON object");
        }
        match self.kind {
            DecisionKind::Choice => {
                if self.candidates.len() < 2 {
                    bail!("choice decisions require at least two candidates");
                }
                let mut seen = std::collections::HashSet::with_capacity(self.candidates.len());
                for candidate in &self.candidates {
                    if candidate.trim().is_empty() {
                        bail!("choice candidates must be nonempty");
                    }
                    if !seen.insert(candidate.as_str()) {
                        bail!("choice candidates must be unique");
                    }
                }
            }
            DecisionKind::Score | DecisionKind::Probability => {
                if !self.candidates.is_empty() {
                    bail!("score/probability decisions must not carry candidates");
                }
            }
        }
        for entry in &self.precedent {
            entry.validate()?;
        }
        for entry in &self.evidence {
            entry.validate()?;
        }
        Ok(())
    }
}

/// A provider's typed judgment. `confidence` is advisory metadata only
/// (invariant #8) — it is never assumed calibrated and the program/policy
/// owns any threshold applied to it.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DecisionResponse {
    pub kind: DecisionKind,
    pub choice: Option<String>,
    pub score: Option<f64>,
    pub probability: Option<f64>,
    pub confidence: Option<f64>,
    pub rationale: Option<String>,
    pub model: String,
    pub provider: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
}

impl DecisionResponse {
    /// Validates internal shape and consistency with the request that
    /// produced it. Malformed typed output must fail closed (GP-02).
    pub fn validate_against(&self, request: &DecisionRequest) -> Result<()> {
        if self.kind != request.kind {
            bail!("decision response kind does not match request kind");
        }
        if self.model.trim().is_empty() || self.provider.trim().is_empty() {
            bail!("decision response must record model and provider");
        }
        match self.kind {
            DecisionKind::Choice => {
                let choice = self
                    .choice
                    .as_deref()
                    .context("choice decision response missing choice")?;
                if !request.candidates.iter().any(|c| c == choice) {
                    bail!("decision response choice is not among request candidates");
                }
                if self.score.is_some() || self.probability.is_some() {
                    bail!("choice decision response must not carry score/probability");
                }
            }
            DecisionKind::Score => {
                if self.score.is_none() {
                    bail!("score decision response missing score");
                }
                if self.choice.is_some() || self.probability.is_some() {
                    bail!("score decision response must not carry choice/probability");
                }
            }
            DecisionKind::Probability => {
                let probability = self
                    .probability
                    .context("probability decision response missing probability")?;
                if !(0.0..=1.0).contains(&probability) {
                    bail!("probability must be within [0, 1]");
                }
                if self.choice.is_some() || self.score.is_some() {
                    bail!("probability decision response must not carry choice/score");
                }
            }
        }
        if let Some(confidence) = self.confidence {
            if !(0.0..=1.0).contains(&confidence) {
                bail!("confidence must be within [0, 1] when present");
            }
        }
        Ok(())
    }
}

/// `decide()`: bounded Choice/Score/Probability judgments. Never an
/// authorization or execution authority (invariant #1).
#[async_trait]
pub trait DecisionProvider: Send + Sync {
    async fn decide(&self, request: DecisionRequest) -> Result<DecisionResponse>;
}

/// `generate()`: prose/code/artifact synthesis. Output remains subject to
/// the evidence/answer admission gate (§7 of the completion plan); this
/// contract does not itself admit anything.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GenerationRequest {
    pub objective: String,
    pub context: Value,
    pub format: String,
}

impl GenerationRequest {
    pub fn validate(&self) -> Result<()> {
        if self.objective.trim().is_empty() {
            bail!("generation objective must be nonempty");
        }
        if self.format.trim().is_empty() {
            bail!("generation format must be nonempty");
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GenerationResponse {
    pub content: String,
    pub model: String,
    pub provider: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
}

#[async_trait]
pub trait GenerationProvider: Send + Sync {
    async fn generate(&self, request: GenerationRequest) -> Result<GenerationResponse>;
}

/// Labels a `ReasoningRequest` accepts for its outcome. The loop must not
/// return an outcome kind the caller did not admit for this step.
pub const PROPOSAL_KIND_DECISION: &str = "decision";
pub const PROPOSAL_KIND_CAPABILITY: &str = "capability";
pub const PROPOSAL_KIND_PROGRAM_PATCH: &str = "program_patch";
pub const PROPOSAL_KIND_CLARIFICATION: &str = "clarification";
pub const PROPOSAL_KIND_FINAL_DRAFT: &str = "final_draft";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ClarificationRequest {
    pub prompt: String,
    pub options: Vec<String>,
    pub required: bool,
}

impl ClarificationRequest {
    pub fn validate(&self) -> Result<()> {
        if self.prompt.trim().is_empty() {
            bail!("clarification prompt must be nonempty");
        }
        Ok(())
    }
}

/// A proposal to invoke one generated ERP capability. This is a proposal
/// only: `ReasoningStep` cannot execute it (invariant #11). It returns
/// through the same authorization/policy/spend path as every other
/// capability invocation (GP-03).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CapabilityProposal {
    pub capability: String,
    pub arguments: Value,
    pub rationale: Option<String>,
}

impl CapabilityProposal {
    pub fn validate(&self) -> Result<()> {
        if self.capability.trim().is_empty() {
            bail!("capability proposal must name a capability");
        }
        if !self.arguments.is_object() {
            bail!("capability proposal arguments must be a JSON object");
        }
        Ok(())
    }
}

/// A proposal to resolve a typed decision node outside the normal
/// `DecisionProvider` path (e.g. the reasoning step believes it can answer
/// a decision inline). Still subject to `DecisionResponse` validation and
/// normal gates before it can affect control flow.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DecisionProposal {
    pub decision_type: DecisionTypeRef,
    pub kind: DecisionKind,
    pub proposed_choice: Option<String>,
    pub proposed_score: Option<f64>,
    pub proposed_probability: Option<f64>,
    pub rationale: Option<String>,
}

impl DecisionProposal {
    pub fn validate(&self) -> Result<()> {
        self.decision_type.validate()?;
        match self.kind {
            DecisionKind::Choice if self.proposed_choice.is_none() => {
                bail!("choice decision proposal missing proposed_choice")
            }
            DecisionKind::Score if self.proposed_score.is_none() => {
                bail!("score decision proposal missing proposed_score")
            }
            DecisionKind::Probability => {
                let probability = self
                    .proposed_probability
                    .context("probability decision proposal missing proposed_probability")?;
                if !(0.0..=1.0).contains(&probability) {
                    bail!("proposed probability must be within [0, 1]");
                }
            }
            _ => {}
        }
        Ok(())
    }
}

/// A proposed structural change to the typed program graph itself (GP-08).
/// Interpreted and validated by `GovernedProgram`; the loop never applies
/// this directly.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProgramPatchProposal {
    pub description: String,
    pub patch: Value,
}

impl ProgramPatchProposal {
    pub fn validate(&self) -> Result<()> {
        if self.description.trim().is_empty() {
            bail!("program patch proposal must have a description");
        }
        Ok(())
    }
}

/// A candidate final answer. Still subject to the §7 answer/publication
/// gate before it may be presented as complete (architecture §9).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FinalDraft {
    pub content: String,
    pub citations: Vec<EvidenceRef>,
}

impl FinalDraft {
    pub fn validate(&self) -> Result<()> {
        if self.content.trim().is_empty() {
            bail!("final draft content must be nonempty");
        }
        for citation in &self.citations {
            citation.validate()?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UnableToProgress {
    pub reason: String,
    pub last_step_no: u32,
}

impl UnableToProgress {
    pub fn validate(&self) -> Result<()> {
        if self.reason.trim().is_empty() {
            bail!("unable-to-progress reason must be nonempty");
        }
        Ok(())
    }
}

/// The bounded set of things a reasoning round may produce. There is no
/// variant that mutates state, approves a draft, or admits a final answer;
/// every variant returns to shared governed services for that (invariant
/// #11, #13).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum ReasoningOutcome {
    DecisionProposal(DecisionProposal),
    CapabilityProposal(CapabilityProposal),
    ProgramPatchProposal(ProgramPatchProposal),
    ClarificationRequest(ClarificationRequest),
    FinalDraft(FinalDraft),
    UnableToProgress(UnableToProgress),
}

impl ReasoningOutcome {
    pub fn kind_label(&self) -> &'static str {
        match self {
            ReasoningOutcome::DecisionProposal(_) => PROPOSAL_KIND_DECISION,
            ReasoningOutcome::CapabilityProposal(_) => PROPOSAL_KIND_CAPABILITY,
            ReasoningOutcome::ProgramPatchProposal(_) => PROPOSAL_KIND_PROGRAM_PATCH,
            ReasoningOutcome::ClarificationRequest(_) => PROPOSAL_KIND_CLARIFICATION,
            ReasoningOutcome::FinalDraft(_) => PROPOSAL_KIND_FINAL_DRAFT,
            // UnableToProgress is always permitted; it carries no proposal
            // authority and cannot be excluded by `allowed_proposal_kinds`.
            ReasoningOutcome::UnableToProgress(_) => "unable_to_progress",
        }
    }

    pub fn validate(&self) -> Result<()> {
        match self {
            ReasoningOutcome::DecisionProposal(proposal) => proposal.validate(),
            ReasoningOutcome::CapabilityProposal(proposal) => proposal.validate(),
            ReasoningOutcome::ProgramPatchProposal(proposal) => proposal.validate(),
            ReasoningOutcome::ClarificationRequest(request) => request.validate(),
            ReasoningOutcome::FinalDraft(draft) => draft.validate(),
            ReasoningOutcome::UnableToProgress(outcome) => outcome.validate(),
        }
    }

    /// Rejects an outcome kind the step's request did not admit. A reasoning
    /// step declares its allowed proposal kinds up front (architecture §9);
    /// the provider cannot widen that surface by returning a different kind.
    pub fn validate_against(&self, request: &ReasoningRequest) -> Result<()> {
        self.validate()?;
        if matches!(self, ReasoningOutcome::UnableToProgress(_)) {
            return Ok(());
        }
        let label = self.kind_label();
        if !request
            .allowed_proposal_kinds
            .iter()
            .any(|kind| kind == label)
        {
            bail!("reasoning outcome '{label}' is not among the step's allowed proposal kinds");
        }
        Ok(())
    }
}

/// The admitted view a `ReasoningStep` receives: objective, bounded
/// state/evidence, optional precedent, and remaining budget. It does not
/// carry authorization, spend, or execution state.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReasoningRequest {
    pub objective: String,
    pub bounded_state: Value,
    pub precedent: Vec<PrecedentSummaryRef>,
    pub allowed_proposal_kinds: Vec<String>,
    pub remaining_rounds: u32,
}

impl ReasoningRequest {
    pub fn validate(&self) -> Result<()> {
        if self.objective.trim().is_empty() {
            bail!("reasoning objective must be nonempty");
        }
        if !self.bounded_state.is_object() {
            bail!("reasoning bounded_state must be a JSON object");
        }
        if self.allowed_proposal_kinds.is_empty() {
            bail!("reasoning request must allow at least one proposal kind");
        }
        const KNOWN: [&str; 5] = [
            PROPOSAL_KIND_DECISION,
            PROPOSAL_KIND_CAPABILITY,
            PROPOSAL_KIND_PROGRAM_PATCH,
            PROPOSAL_KIND_CLARIFICATION,
            PROPOSAL_KIND_FINAL_DRAFT,
        ];
        for kind in &self.allowed_proposal_kinds {
            if !KNOWN.contains(&kind.as_str()) {
                bail!("reasoning request has unknown allowed proposal kind '{kind}'");
            }
        }
        if self.remaining_rounds == 0 {
            bail!("reasoning request remaining_rounds must be positive");
        }
        for entry in &self.precedent {
            entry.validate()?;
        }
        Ok(())
    }
}

/// `reason()`: bounded proposal generation when the typed graph cannot
/// resolve state on its own (invariant #10, architecture §9).
#[async_trait]
pub trait ReasoningProvider: Send + Sync {
    async fn reason(&self, request: ReasoningRequest) -> Result<ReasoningOutcome>;
}

/// Deterministic, content-addressed hash of a decision request. Stable
/// across builds/restarts so identical requests map to the same durable
/// key (mirrors `ai_spend::input_request_key`).
pub fn decision_request_hash(request: &DecisionRequest) -> Result<String> {
    canonical_hash(request)
}

/// Deterministic, content-addressed hash of a reasoning request.
pub fn reasoning_request_hash(request: &ReasoningRequest) -> Result<String> {
    canonical_hash(request)
}

fn canonical_hash<T: Serialize>(value: &T) -> Result<String> {
    let canonical = serde_json::to_vec(value).context("serialize request for hashing")?;
    let digest = Sha256::digest(&canonical);
    Ok(format!("{digest:x}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn decision_type() -> DecisionTypeRef {
        DecisionTypeRef {
            name: "PaymentDisposition".to_string(),
            version: 1,
        }
    }

    fn choice_request() -> DecisionRequest {
        DecisionRequest {
            decision_type: decision_type(),
            kind: DecisionKind::Choice,
            question: "Should this payment be flagged?".to_string(),
            bounded_state: json!({"amount": 100}),
            candidates: vec!["flag".to_string(), "clear".to_string()],
            precedent: vec![],
            evidence: vec![],
        }
    }

    #[test]
    fn decision_type_requires_positive_version() {
        let mut decision_type = decision_type();
        decision_type.version = 0;
        assert!(decision_type.validate().is_err());
    }

    #[test]
    fn choice_request_requires_two_unique_candidates() {
        let mut request = choice_request();
        request.candidates = vec!["only".to_string()];
        assert!(request.validate().is_err());

        request.candidates = vec!["a".to_string(), "a".to_string()];
        assert!(request.validate().is_err());

        request.candidates = vec!["a".to_string(), "b".to_string()];
        assert!(request.validate().is_ok());
    }

    #[test]
    fn score_request_rejects_candidates() {
        let mut request = choice_request();
        request.kind = DecisionKind::Score;
        assert!(request.validate().is_err());
        request.candidates.clear();
        assert!(request.validate().is_ok());
    }

    #[test]
    fn choice_response_must_be_among_candidates() {
        let request = choice_request();
        let mut response = DecisionResponse {
            kind: DecisionKind::Choice,
            choice: Some("neither".to_string()),
            score: None,
            probability: None,
            confidence: Some(0.9),
            rationale: None,
            model: "mistral-large-latest".to_string(),
            provider: "mistral".to_string(),
            input_tokens: 10,
            output_tokens: 5,
        };
        assert!(response.validate_against(&request).is_err());
        response.choice = Some("flag".to_string());
        assert!(response.validate_against(&request).is_ok());
    }

    #[test]
    fn probability_response_bounds_enforced() {
        let request = DecisionRequest {
            kind: DecisionKind::Probability,
            candidates: vec![],
            ..choice_request()
        };
        let mut response = DecisionResponse {
            kind: DecisionKind::Probability,
            choice: None,
            score: None,
            probability: Some(1.5),
            confidence: None,
            rationale: None,
            model: "mistral-large-latest".to_string(),
            provider: "mistral".to_string(),
            input_tokens: 1,
            output_tokens: 1,
        };
        assert!(response.validate_against(&request).is_err());
        response.probability = Some(0.42);
        assert!(response.validate_against(&request).is_ok());
    }

    #[test]
    fn confidence_out_of_bounds_rejected() {
        let request = choice_request();
        let response = DecisionResponse {
            kind: DecisionKind::Choice,
            choice: Some("flag".to_string()),
            score: None,
            probability: None,
            confidence: Some(2.0),
            rationale: None,
            model: "mistral-large-latest".to_string(),
            provider: "mistral".to_string(),
            input_tokens: 1,
            output_tokens: 1,
        };
        assert!(response.validate_against(&request).is_err());
    }

    #[test]
    fn reasoning_outcome_rejects_unadmitted_kind() {
        let request = ReasoningRequest {
            objective: "investigate".to_string(),
            bounded_state: json!({}),
            precedent: vec![],
            allowed_proposal_kinds: vec![PROPOSAL_KIND_CLARIFICATION.to_string()],
            remaining_rounds: 3,
        };
        let outcome = ReasoningOutcome::CapabilityProposal(CapabilityProposal {
            capability: "erp.search".to_string(),
            arguments: json!({}),
            rationale: None,
        });
        assert!(outcome.validate_against(&request).is_err());

        let allowed = ReasoningOutcome::ClarificationRequest(ClarificationRequest {
            prompt: "which vendor?".to_string(),
            options: vec![],
            required: true,
        });
        assert!(allowed.validate_against(&request).is_ok());
    }

    #[test]
    fn unable_to_progress_always_allowed() {
        let request = ReasoningRequest {
            objective: "investigate".to_string(),
            bounded_state: json!({}),
            precedent: vec![],
            allowed_proposal_kinds: vec![PROPOSAL_KIND_CLARIFICATION.to_string()],
            remaining_rounds: 1,
        };
        let outcome = ReasoningOutcome::UnableToProgress(UnableToProgress {
            reason: "no further evidence available".to_string(),
            last_step_no: 4,
        });
        assert!(outcome.validate_against(&request).is_ok());
    }

    #[test]
    fn reasoning_request_rejects_unknown_proposal_kind() {
        let request = ReasoningRequest {
            objective: "investigate".to_string(),
            bounded_state: json!({}),
            precedent: vec![],
            allowed_proposal_kinds: vec!["execute_directly".to_string()],
            remaining_rounds: 1,
        };
        assert!(request.validate().is_err());
    }

    #[test]
    fn decision_request_hash_is_deterministic_and_content_addressed() {
        let a = choice_request();
        let b = choice_request();
        assert_eq!(
            decision_request_hash(&a).unwrap(),
            decision_request_hash(&b).unwrap()
        );

        let mut c = choice_request();
        c.question = "different question".to_string();
        assert_ne!(
            decision_request_hash(&a).unwrap(),
            decision_request_hash(&c).unwrap()
        );
    }

    #[test]
    fn reasoning_request_hash_is_deterministic() {
        let request = ReasoningRequest {
            objective: "investigate".to_string(),
            bounded_state: json!({"x": 1}),
            precedent: vec![],
            allowed_proposal_kinds: vec![PROPOSAL_KIND_FINAL_DRAFT.to_string()],
            remaining_rounds: 2,
        };
        let hash_a = reasoning_request_hash(&request).unwrap();
        let hash_b = reasoning_request_hash(&request).unwrap();
        assert_eq!(hash_a, hash_b);
        assert_eq!(hash_a.len(), 64);
    }

    #[test]
    fn capability_proposal_rejects_non_object_arguments() {
        let proposal = CapabilityProposal {
            capability: "erp.search".to_string(),
            arguments: json!("not-an-object"),
            rationale: None,
        };
        assert!(proposal.validate().is_err());
    }

    #[test]
    fn decision_proposal_validates_by_kind() {
        let mut proposal = DecisionProposal {
            decision_type: decision_type(),
            kind: DecisionKind::Probability,
            proposed_choice: None,
            proposed_score: None,
            proposed_probability: None,
            rationale: None,
        };
        assert!(proposal.validate().is_err());
        proposal.proposed_probability = Some(1.2);
        assert!(proposal.validate().is_err());
        proposal.proposed_probability = Some(0.3);
        assert!(proposal.validate().is_ok());
    }
}
