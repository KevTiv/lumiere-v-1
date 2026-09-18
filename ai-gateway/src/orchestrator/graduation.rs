//! GP-16 deterministic graduation: cohort analysis and versioned eligibility policy.
//!
//! This module is deliberately observation-only. It can identify stable decision cohorts
//! and evaluate them against a reviewed policy, but it cannot promote a pattern, alter
//! routing, execute capabilities, or mutate ERP state.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{Arc, RwLock};

use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use stdb_client::{ReducerCall, StdbClient};

use super::intelligence::{decision_request_hash, DecisionKind, DecisionRequest, DecisionResponse, DecisionTypeRef};
use super::probabilistic::{CalibrationProfile, Confidence, GateDecision, ThresholdGatePolicy};

const MAX_ANALYSIS_ROWS: u32 = 5_000;


#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub(super) struct DeterministicDecisionResponse {
    pub kind: DecisionKind,
    pub choice: Option<String>,
    pub score: Option<f64>,
    pub probability: Option<f64>,
    pub rationale: Option<String>,
}

impl DeterministicDecisionResponse {
    pub fn validate_against(&self, request: &DecisionRequest) -> Result<()> {
        if self.kind != request.kind {
            bail!("deterministic decision kind does not match request");
        }
        let populated = usize::from(self.choice.is_some())
            + usize::from(self.score.is_some())
            + usize::from(self.probability.is_some());
        if populated != 1 {
            bail!("deterministic decision must set exactly one typed signal");
        }
        match self.kind {
            DecisionKind::Choice => {
                let choice = self.choice.as_deref().context("choice result missing")?;
                if !request.candidates.iter().any(|candidate| candidate == choice) {
                    bail!("deterministic choice is not in the request candidate set");
                }
            }
            DecisionKind::Score => {
                let score = self.score.context("score result missing")?;
                if !score.is_finite() {
                    bail!("deterministic score must be finite");
                }
            }
            DecisionKind::Probability => {
                let probability = self.probability.context("probability result missing")?;
                if !(0.0..=1.0).contains(&probability) {
                    bail!("deterministic probability must be within [0, 1]");
                }
            }
        }
        Ok(())
    }

    fn signal_json(&self) -> Value {
        json!({
            "kind": self.kind,
            "choice": self.choice,
            "score": self.score,
            "probability": self.probability,
        })
    }
}

#[async_trait]
pub(super) trait DeterministicDecisionCandidate: Send + Sync {
    fn implementation_ref(&self) -> &str;
    fn decision_type(&self) -> DecisionTypeRef;

    async fn evaluate(&self, request: &DecisionRequest) -> Result<DeterministicDecisionResponse>;
}

#[derive(Default)]
pub(super) struct DeterministicCandidateRegistry {
    candidates: RwLock<HashMap<String, Arc<dyn DeterministicDecisionCandidate>>>,
}

impl DeterministicCandidateRegistry {
    pub fn register(&self, candidate: Arc<dyn DeterministicDecisionCandidate>) -> Result<()> {
        let implementation_ref = candidate.implementation_ref().trim();
        if implementation_ref.is_empty() {
            bail!("deterministic implementation_ref must be nonempty");
        }
        candidate.decision_type().validate()?;

        let mut candidates = self.candidates.write().unwrap();
        if candidates.contains_key(implementation_ref) {
            bail!("deterministic implementation_ref '{implementation_ref}' is already registered");
        }
        candidates.insert(implementation_ref.to_string(), candidate);
        Ok(())
    }

    pub fn get(&self, implementation_ref: &str) -> Option<Arc<dyn DeterministicDecisionCandidate>> {
        self.candidates
            .read()
            .unwrap()
            .get(implementation_ref)
            .cloned()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct DeterministicShadowEvidence {
    pub schema_version: u32,
    pub pattern_ref: String,
    pub implementation_ref: String,
    pub request_hash: String,
    pub deterministic_output: Option<DeterministicDecisionResponse>,
    pub production_signal: Value,
    pub exact_match: Option<bool>,
    pub tolerance_match: Option<bool>,
    pub production_gate_disposition: Option<String>,
    pub deterministic_gate_disposition: Option<String>,
    pub gate_disposition_match: Option<bool>,
    pub conformant: Option<bool>,
    pub evaluation_error: Option<String>,
    pub latency_ms: u64,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct NumericTolerance {
    pub absolute: f64,
    pub relative: f64,
}

impl NumericTolerance {
    fn validate(&self) -> Result<()> {
        if !self.absolute.is_finite() || self.absolute < 0.0 {
            bail!("absolute tolerance must be finite and nonnegative");
        }
        if !self.relative.is_finite() || self.relative < 0.0 {
            bail!("relative tolerance must be finite and nonnegative");
        }
        Ok(())
    }

    fn matches(&self, production: f64, deterministic: f64) -> bool {
        let delta = (production - deterministic).abs();
        if delta <= self.absolute {
            return true;
        }
        let scale = production.abs().max(deterministic.abs()).max(f64::EPSILON);
        delta / scale <= self.relative
    }
}

#[derive(Clone, Debug)]
pub(super) struct DecisionConformancePolicy {
    pub numeric_tolerance: NumericTolerance,
    pub threshold_gate: Option<ThresholdGatePolicy>,
    pub calibration_profile: Option<CalibrationProfile>,
}

impl DecisionConformancePolicy {
    pub fn validate(&self) -> Result<()> {
        self.numeric_tolerance.validate()?;
        if let Some(gate) = &self.threshold_gate {
            gate.validate()?;
        }
        if let Some(profile) = &self.calibration_profile {
            profile.validate()?;
        }
        if self.calibration_profile.is_some() && self.threshold_gate.is_none() {
            bail!("calibration profile requires a threshold gate policy");
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct ConformanceAggregate {
    pub total_events: u64,
    pub successful_evaluations: u64,
    pub exact_matches: u64,
    pub tolerance_matches: u64,
    pub gate_disposition_matches: u64,
    pub conformant_events: u64,
}

impl ConformanceAggregate {
    pub fn conformance_rate(&self) -> Option<f64> {
        (self.successful_evaluations > 0)
            .then(|| self.conformant_events as f64 / self.successful_evaluations as f64)
    }
}

#[async_trait]
pub(super) trait DeterministicShadowRecorder: Send + Sync {
    async fn record(
        &self,
        organization_id: u64,
        company_id: u64,
        run_id: u64,
        decision_type: &DecisionTypeRef,
        request: &DecisionRequest,
        evidence: &DeterministicShadowEvidence,
    ) -> Result<()>;
}

pub(super) struct StdbDeterministicShadowRecorder<'a> {
    pub writer: &'a StdbClient,
}

#[async_trait]
impl DeterministicShadowRecorder for StdbDeterministicShadowRecorder<'_> {
    async fn record(
        &self,
        organization_id: u64,
        company_id: u64,
        run_id: u64,
        decision_type: &DecisionTypeRef,
        request: &DecisionRequest,
        evidence: &DeterministicShadowEvidence,
    ) -> Result<()> {
        self.writer
            .call_reducer(ReducerCall::from_name(
                "record_ai_deterministic_shadow_event",
                json!([
                    organization_id,
                    company_id,
                    run_id,
                    {
                        "pattern_ref": evidence.pattern_ref,
                        "implementation_ref": evidence.implementation_ref,
                        "decision_type_name": decision_type.name,
                        "decision_type_version": decision_type.version,
                        "request_hash": evidence.request_hash,
                        "request_json": serde_json::to_string(request)?,
                        "evidence_json": serde_json::to_string(evidence)?,
                    }
                ]),
            ))
            .await
            .context("record deterministic graduation shadow event")
    }
}

pub(super) struct DeterministicShadowEvaluator<'a> {
    pub registry: &'a DeterministicCandidateRegistry,
    pub recorder: &'a dyn DeterministicShadowRecorder,
}

impl DeterministicShadowEvaluator<'_> {
    #[allow(clippy::too_many_arguments)]
    pub async fn evaluate(
        &self,
        organization_id: u64,
        company_id: u64,
        run_id: u64,
        pattern_ref: &str,
        implementation_ref: &str,
        request: &DecisionRequest,
        production: &DecisionResponse,
        conformance_policy: &DecisionConformancePolicy,
    ) -> Result<DeterministicShadowEvidence> {
        if organization_id == 0 || company_id == 0 || run_id == 0 {
            bail!("deterministic shadow requires nonzero organization/company/run ids");
        }
        if pattern_ref.trim().is_empty() || implementation_ref.trim().is_empty() {
            bail!("pattern_ref and implementation_ref must be nonempty");
        }
        request.validate()?;
        production.validate_against(request)?;
        conformance_policy.validate()?;

        let candidate = self
            .registry
            .get(implementation_ref)
            .with_context(|| format!("deterministic candidate '{implementation_ref}' is not registered"))?;
        if candidate.decision_type() != request.decision_type {
            bail!("deterministic candidate DecisionType does not match request");
        }

        let request_hash = decision_request_hash(request)?;
        let started = std::time::Instant::now();
        let result = candidate.evaluate(request).await;
        let latency_ms = started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;

        let production_signal = decision_response_signal(production);
        let (
            deterministic_output,
            exact_match,
            tolerance_match,
            production_gate_disposition,
            deterministic_gate_disposition,
            gate_disposition_match,
            conformant,
            evaluation_error,
        ) = match result {
            Ok(output) => {
                output.validate_against(request)?;
                let comparison =
                    compare_conformance(request, production, &output, conformance_policy)?;
                (
                    Some(output),
                    Some(comparison.exact_match),
                    comparison.tolerance_match,
                    comparison.production_gate_disposition,
                    comparison.deterministic_gate_disposition,
                    comparison.gate_disposition_match,
                    Some(comparison.conformant),
                    None,
                )
            }
            Err(error) => (None, None, None, None, None, None, None, Some(error.to_string())),
        };

        let evidence = DeterministicShadowEvidence {
            schema_version: 2,
            pattern_ref: pattern_ref.to_string(),
            implementation_ref: implementation_ref.to_string(),
            request_hash,
            deterministic_output,
            production_signal,
            exact_match,
            tolerance_match,
            production_gate_disposition,
            deterministic_gate_disposition,
            gate_disposition_match,
            conformant,
            evaluation_error,
            latency_ms,
        };

        self.recorder
            .record(
                organization_id,
                company_id,
                run_id,
                &request.decision_type,
                request,
                &evidence,
            )
            .await?;
        Ok(evidence)
    }
}

#[derive(Clone, Debug)]
struct ConformanceComparison {
    exact_match: bool,
    tolerance_match: Option<bool>,
    production_gate_disposition: Option<String>,
    deterministic_gate_disposition: Option<String>,
    gate_disposition_match: Option<bool>,
    conformant: bool,
}

fn compare_conformance(
    request: &DecisionRequest,
    production: &DecisionResponse,
    deterministic: &DeterministicDecisionResponse,
    policy: &DecisionConformancePolicy,
) -> Result<ConformanceComparison> {
    let exact_match = deterministic.signal_json() == decision_response_signal(production);
    match request.kind {
        DecisionKind::Choice => Ok(ConformanceComparison {
            exact_match,
            tolerance_match: None,
            production_gate_disposition: None,
            deterministic_gate_disposition: None,
            gate_disposition_match: None,
            conformant: exact_match,
        }),
        DecisionKind::Score => {
            let production_value = production.score.context("production score missing")?;
            let deterministic_value =
                deterministic.score.context("deterministic score missing")?;
            numeric_conformance(
                production_value,
                deterministic_value,
                exact_match,
                policy,
            )
        }
        DecisionKind::Probability => {
            let production_value =
                production.probability.context("production probability missing")?;
            let deterministic_value = deterministic
                .probability
                .context("deterministic probability missing")?;
            numeric_conformance(
                production_value,
                deterministic_value,
                exact_match,
                policy,
            )
        }
    }
}

fn numeric_conformance(
    production: f64,
    deterministic: f64,
    exact_match: bool,
    policy: &DecisionConformancePolicy,
) -> Result<ConformanceComparison> {
    let tolerance_match = policy.numeric_tolerance.matches(production, deterministic);
    let (
        production_gate_disposition,
        deterministic_gate_disposition,
        gate_disposition_match,
    ) = if let Some(gate) = &policy.threshold_gate {
        let production_gate = evaluate_gate_disposition(production, gate, policy.calibration_profile.as_ref())?;
        let deterministic_gate =
            evaluate_gate_disposition(deterministic, gate, policy.calibration_profile.as_ref())?;
        (
            Some(gate_decision_label(production_gate).to_string()),
            Some(gate_decision_label(deterministic_gate).to_string()),
            Some(production_gate == deterministic_gate),
        )
    } else {
        (None, None, None)
    };
    let disposition_ok = gate_disposition_match.unwrap_or(true);
    Ok(ConformanceComparison {
        exact_match,
        tolerance_match: Some(tolerance_match),
        production_gate_disposition,
        deterministic_gate_disposition,
        gate_disposition_match,
        conformant: tolerance_match && disposition_ok,
    })
}

fn evaluate_gate_disposition(
    value: f64,
    gate: &ThresholdGatePolicy,
    calibration: Option<&CalibrationProfile>,
) -> Result<GateDecision> {
    if !(0.0..=1.0).contains(&value) {
        bail!("threshold-gate conformance requires a normalized signal within [0, 1]");
    }
    let confidence = Confidence::Raw(value);
    let confidence = if let Some(profile) = calibration {
        profile.calibrate(confidence)?
    } else {
        confidence
    };
    gate.evaluate(confidence)
}

fn gate_decision_label(decision: GateDecision) -> &'static str {
    match decision {
        GateDecision::Continue => "continue",
        GateDecision::AcquireEvidence => "acquire_evidence",
        GateDecision::Escalate => "escalate",
    }
}

fn decision_response_signal(response: &DecisionResponse) -> Value {
    json!({
        "kind": response.kind,
        "choice": response.choice,
        "score": response.score,
        "probability": response.probability,
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum DeterministicExpressionKind {
    ProgramBranch,
    ThresholdPolicy,
    LookupPolicy,
    DeterministicCompute,
    NativeErpRule,
    NotExpressible,
}

#[derive(Clone, Debug, PartialEq)]
pub(super) struct GraduationMetrics {
    pub decision_type: DecisionTypeRef,
    pub applicability_fingerprint: String,
    pub observed_cases: u64,
    pub verified_cases: u64,
    pub reviewed_cases: u64,
    pub correction_rate: f64,
    pub verified_outcome_rate: f64,
    pub provider_disagreement_rate: Option<f64>,
    pub shadow_cases: u64,
    pub decision_entropy: f64,
    pub precedent_consistency: f64,
    /// None means the durable case/event model cannot establish this metric yet.
    /// Missing evidence is never converted into a favorable score.
    pub policy_stability_rate: Option<f64>,
    pub evidence_shape_stability: f64,
    pub candidate_set_stability: Option<f64>,
    pub average_cost_microunits: Option<u64>,
    pub average_latency_ms: Option<u64>,
}

#[derive(Clone, Debug)]
pub(super) struct GraduationQuery {
    pub organization_id: u64,
    pub company_id: u64,
    pub decision_type: DecisionTypeRef,
    pub minimum_cases_per_cohort: u64,
    pub max_cases: u32,
}

impl GraduationQuery {
    pub fn validate(&self) -> Result<()> {
        self.decision_type.validate()?;
        if self.organization_id == 0 || self.company_id == 0 {
            bail!("graduation analysis requires nonzero organization_id and company_id");
        }
        if self.minimum_cases_per_cohort < 2 {
            bail!("minimum_cases_per_cohort must be at least 2");
        }
        if self.max_cases == 0 || self.max_cases > MAX_ANALYSIS_ROWS {
            bail!("max_cases must be within 1..={MAX_ANALYSIS_ROWS}");
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub(super) struct GraduationCandidate {
    pub decision_type: DecisionTypeRef,
    pub applicability_fingerprint: String,
    pub supporting_case_ids: Vec<u64>,
    pub dominant_selected: Value,
    pub applicability: PatternApplicabilityEvidence,
    pub metrics: GraduationMetrics,
    pub proposed_expression_kind: DeterministicExpressionKind,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct PatternApplicabilityEvidence {
    pub schema_version: u32,
    pub applicability_fingerprint: String,
    pub company_id: u64,
    pub program_ref: String,
    pub step_id: String,
    pub context_fingerprint: String,
    pub candidate_set_hash: String,
    pub evidence_shape: String,
    pub graduation_policy_ref: String,
    pub material_policy_refs: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct PatternMetricsSnapshot {
    pub schema_version: u32,
    pub observed_cases: u64,
    pub verified_cases: u64,
    pub reviewed_cases: u64,
    pub correction_rate: f64,
    pub verified_outcome_rate: f64,
    pub provider_disagreement_rate: Option<f64>,
    pub shadow_cases: u64,
    pub decision_entropy: f64,
    pub precedent_consistency: f64,
    pub policy_stability_rate: Option<f64>,
    pub evidence_shape_stability: f64,
    pub candidate_set_stability: Option<f64>,
    pub average_cost_microunits: Option<u64>,
    pub average_latency_ms: Option<u64>,
    pub proposed_expression_kind: DeterministicExpressionKind,
}

#[derive(Clone, Debug)]
pub(super) struct DecisionPatternProposal {
    pub pattern_key: String,
    pub decision_type: DecisionTypeRef,
    pub supporting_case_ids: Vec<u64>,
    pub applicability: PatternApplicabilityEvidence,
    pub metrics: PatternMetricsSnapshot,
}

impl DecisionPatternProposal {
    pub fn from_candidate(
        pattern_key: impl Into<String>,
        candidate: &GraduationCandidate,
        applicability: PatternApplicabilityEvidence,
    ) -> Result<Self> {
        let pattern_key = pattern_key.into();
        if pattern_key.trim().is_empty() {
            bail!("pattern_key must be nonempty");
        }
        if candidate.applicability_fingerprint != applicability.applicability_fingerprint {
            bail!("candidate and applicability fingerprints disagree");
        }
        if applicability.schema_version != 1 {
            bail!("pattern applicability schema_version must be 1");
        }
        if applicability.graduation_policy_ref.trim().is_empty() {
            bail!("graduation_policy_ref must be nonempty");
        }
        let metrics = PatternMetricsSnapshot {
            schema_version: 1,
            observed_cases: candidate.metrics.observed_cases,
            verified_cases: candidate.metrics.verified_cases,
            reviewed_cases: candidate.metrics.reviewed_cases,
            correction_rate: candidate.metrics.correction_rate,
            verified_outcome_rate: candidate.metrics.verified_outcome_rate,
            provider_disagreement_rate: candidate.metrics.provider_disagreement_rate,
            shadow_cases: candidate.metrics.shadow_cases,
            decision_entropy: candidate.metrics.decision_entropy,
            precedent_consistency: candidate.metrics.precedent_consistency,
            policy_stability_rate: candidate.metrics.policy_stability_rate,
            evidence_shape_stability: candidate.metrics.evidence_shape_stability,
            candidate_set_stability: candidate.metrics.candidate_set_stability,
            average_cost_microunits: candidate.metrics.average_cost_microunits,
            average_latency_ms: candidate.metrics.average_latency_ms,
            proposed_expression_kind: candidate.proposed_expression_kind,
        };
        Ok(Self {
            pattern_key,
            decision_type: candidate.decision_type.clone(),
            supporting_case_ids: candidate.supporting_case_ids.clone(),
            applicability,
            metrics,
        })
    }
}

#[async_trait]
pub(super) trait DecisionPatternRecorder: Send + Sync {
    async fn propose(&self, proposal: &DecisionPatternProposal) -> Result<()>;
}

pub(super) struct StdbDecisionPatternRecorder<'a> {
    pub writer: &'a StdbClient,
    pub organization_id: u64,
}

#[async_trait]
impl DecisionPatternRecorder for StdbDecisionPatternRecorder<'_> {
    async fn propose(&self, proposal: &DecisionPatternProposal) -> Result<()> {
        proposal.decision_type.validate()?;
        if self.organization_id == 0 {
            bail!("pattern recorder requires nonzero organization_id");
        }
        self.writer
            .call_reducer(ReducerCall::from_name(
                "propose_ai_decision_pattern",
                json!([
                    self.organization_id,
                    {
                        "pattern_key": proposal.pattern_key,
                        "decision_type_name": proposal.decision_type.name,
                        "decision_type_version": proposal.decision_type.version,
                        "applicability_json": serde_json::to_string(&proposal.applicability)?,
                        "supporting_case_ids": proposal.supporting_case_ids,
                        "outcome_metrics_json": serde_json::to_string(&proposal.metrics)?,
                        "correction_rate": proposal.metrics.correction_rate,
                    }
                ]),
            ))
            .await
            .context("propose hardened deterministic graduation pattern")
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum DecisionExecutionMode {
    ModelPrimary,
    DeterministicShadow,
    DeterministicPrimaryModelShadow,
    DeterministicOnly,
}

impl Default for DecisionExecutionMode {
    fn default() -> Self {
        Self::ModelPrimary
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct GraduationPolicy {
    #[serde(default)]
    pub enabled: bool,
    pub minimum_cases: u64,
    pub minimum_verified_cases: u64,
    pub maximum_correction_rate: f64,
    pub maximum_provider_disagreement_rate: Option<f64>,
    pub maximum_entropy: f64,
    pub minimum_precedent_consistency: f64,
    pub minimum_policy_stability: Option<f64>,
    pub minimum_evidence_shape_stability: f64,
    pub minimum_candidate_set_stability: Option<f64>,
    pub minimum_shadow_cases: u64,
    #[serde(default = "default_minimum_shadow_conformance_rate")]
    pub minimum_shadow_conformance_rate: f64,
    #[serde(default)]
    pub execution_mode: DecisionExecutionMode,
}

fn default_minimum_shadow_conformance_rate() -> f64 { 0.98 }

impl GraduationPolicy {
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            minimum_cases: 25,
            minimum_verified_cases: 15,
            maximum_correction_rate: 0.02,
            maximum_provider_disagreement_rate: Some(0.05),
            maximum_entropy: 0.15,
            minimum_precedent_consistency: 0.95,
            minimum_policy_stability: None,
            minimum_evidence_shape_stability: 0.95,
            minimum_candidate_set_stability: Some(0.95),
            minimum_shadow_cases: 15,
            minimum_shadow_conformance_rate: 0.98,
            execution_mode: DecisionExecutionMode::ModelPrimary,
        }
    }

    pub fn validate(&self) -> Result<()> {
        if self.minimum_cases < 2 {
            bail!("graduation minimum_cases must be at least 2");
        }
        if self.minimum_verified_cases > self.minimum_cases {
            bail!("minimum_verified_cases cannot exceed minimum_cases");
        }
        for (name, value) in [
            ("maximum_correction_rate", Some(self.maximum_correction_rate)),
            (
                "maximum_provider_disagreement_rate",
                self.maximum_provider_disagreement_rate,
            ),
            ("maximum_entropy", Some(self.maximum_entropy)),
            (
                "minimum_precedent_consistency",
                Some(self.minimum_precedent_consistency),
            ),
            ("minimum_policy_stability", self.minimum_policy_stability),
            (
                "minimum_evidence_shape_stability",
                Some(self.minimum_evidence_shape_stability),
            ),
            (
                "minimum_candidate_set_stability",
                self.minimum_candidate_set_stability,
            ),
            (
                "minimum_shadow_conformance_rate",
                Some(self.minimum_shadow_conformance_rate),
            ),
        ] {
            if let Some(value) = value {
                if !(0.0..=1.0).contains(&value) {
                    bail!("{name} must be within [0, 1]");
                }
            }
        }
        Ok(())
    }

    pub fn evaluate(&self, metrics: &GraduationMetrics) -> GraduationEligibility {
        if let Err(error) = self.validate() {
            return GraduationEligibility::ineligible(vec![format!("invalid policy: {error}")]);
        }
        if !self.enabled {
            return GraduationEligibility::ineligible(vec!["graduation policy is disabled".into()]);
        }

        let mut reasons = Vec::new();
        if metrics.observed_cases < self.minimum_cases {
            reasons.push(format!(
                "observed cases {} < {}",
                metrics.observed_cases, self.minimum_cases
            ));
        }
        if metrics.verified_cases < self.minimum_verified_cases {
            reasons.push(format!(
                "verified cases {} < {}",
                metrics.verified_cases, self.minimum_verified_cases
            ));
        }
        if metrics.correction_rate > self.maximum_correction_rate {
            reasons.push("correction rate exceeds policy".into());
        }
        if metrics.decision_entropy > self.maximum_entropy {
            reasons.push("decision entropy exceeds policy".into());
        }
        if metrics.precedent_consistency < self.minimum_precedent_consistency {
            reasons.push("precedent consistency is below policy".into());
        }
        if metrics.evidence_shape_stability < self.minimum_evidence_shape_stability {
            reasons.push("evidence shape stability is below policy".into());
        }
        check_optional_maximum(
            "provider disagreement",
            metrics.provider_disagreement_rate,
            self.maximum_provider_disagreement_rate,
            &mut reasons,
        );
        check_optional_minimum(
            "policy stability",
            metrics.policy_stability_rate,
            self.minimum_policy_stability,
            &mut reasons,
        );
        check_optional_minimum(
            "candidate-set stability",
            metrics.candidate_set_stability,
            self.minimum_candidate_set_stability,
            &mut reasons,
        );
        if metrics.shadow_cases < self.minimum_shadow_cases {
            reasons.push(format!(
                "shadow cases {} < {}", metrics.shadow_cases,
                self.minimum_shadow_cases
            ));
        }

        if reasons.is_empty() {
            GraduationEligibility {
                eligible: true,
                reasons,
            }
        } else {
            GraduationEligibility::ineligible(reasons)
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct GraduationEligibility {
    pub eligible: bool,
    pub reasons: Vec<String>,
}

impl GraduationEligibility {
    fn ineligible(reasons: Vec<String>) -> Self {
        Self {
            eligible: false,
            reasons,
        }
    }
}

fn check_optional_maximum(
    name: &str,
    actual: Option<f64>,
    required: Option<f64>,
    reasons: &mut Vec<String>,
) {
    let Some(required) = required else { return };
    match actual {
        Some(actual) if actual <= required => {}
        Some(_) => reasons.push(format!("{name} exceeds policy")),
        None => reasons.push(format!("{name} evidence is unavailable")),
    }
}

fn check_optional_minimum(
    name: &str,
    actual: Option<f64>,
    required: Option<f64>,
    reasons: &mut Vec<String>,
) {
    let Some(required) = required else { return };
    match actual {
        Some(actual) if actual >= required => {}
        Some(_) => reasons.push(format!("{name} is below policy")),
        None => reasons.push(format!("{name} evidence is unavailable")),
    }
}

pub(super) struct StdbConformanceAggregator<'a> {
    pub reader: &'a StdbClient,
}

impl StdbConformanceAggregator<'_> {
    pub async fn aggregate(
        &self,
        organization_id: u64,
        company_id: u64,
        decision_type: &DecisionTypeRef,
        implementation_ref: &str,
        limit: u32,
    ) -> Result<ConformanceAggregate> {
        decision_type.validate()?;
        if organization_id == 0 || company_id == 0 || implementation_ref.trim().is_empty() {
            bail!("conformance aggregation requires organization/company/implementation ref");
        }
        if limit == 0 || limit > MAX_ANALYSIS_ROWS {
            bail!("conformance aggregation limit must be within 1..={MAX_ANALYSIS_ROWS}");
        }
        let rows = self
            .reader
            .query_sql(&format!(
                "SELECT output_json FROM ai_intelligence_event WHERE organization_id = {} \
                 AND company_id = {} AND event_kind = 'deterministic_shadow' \
                 AND decision_type_name = '{}' AND decision_type_version = {} \
                 AND model = '{}' LIMIT {}",
                organization_id,
                company_id,
                sql_escape(&decision_type.name),
                decision_type.version,
                sql_escape(implementation_ref),
                limit
            ))
            .await
            .context("aggregate deterministic shadow conformance")?;

        let mut aggregate = ConformanceAggregate::default();
        for row in rows {
            aggregate.total_events += 1;
            let raw = row_string(&row, "outputJson").context("deterministic shadow output_json missing")?;
            let evidence: DeterministicShadowEvidence =
                serde_json::from_str(&raw).context("decode deterministic shadow evidence")?;
            if evidence.evaluation_error.is_some() {
                continue;
            }
            aggregate.successful_evaluations += 1;
            if evidence.exact_match == Some(true) {
                aggregate.exact_matches += 1;
            }
            if evidence.tolerance_match == Some(true) {
                aggregate.tolerance_matches += 1;
            }
            if evidence.gate_disposition_match == Some(true) {
                aggregate.gate_disposition_matches += 1;
            }
            if evidence.conformant == Some(true) {
                aggregate.conformant_events += 1;
            }
        }
        Ok(aggregate)
    }
}

#[derive(Clone, Debug)]
pub(super) struct DecisionResolutionContext {
    pub organization_id: u64,
    pub company_id: u64,
    pub run_id: u64,
    pub program_ref: String,
    pub step_id: String,
}

#[derive(Clone, Debug)]
pub(super) struct PromotedDeterministicResolution {
    pub mode: DecisionExecutionMode,
    pub pattern_ref: String,
    pub implementation_ref: String,
}

#[async_trait]
pub(super) trait DecisionResolutionPolicy: Send + Sync {
    async fn resolve(
        &self,
        context: &DecisionResolutionContext,
        request: &DecisionRequest,
    ) -> Result<Option<PromotedDeterministicResolution>>;
}

pub(super) struct StdbDecisionResolutionPolicy<'a> {
    pub reader: &'a StdbClient,
}

#[async_trait]
impl DecisionResolutionPolicy for StdbDecisionResolutionPolicy<'_> {
    async fn resolve(
        &self,
        context: &DecisionResolutionContext,
        request: &DecisionRequest,
    ) -> Result<Option<PromotedDeterministicResolution>> {
        if context.organization_id == 0 || context.company_id == 0 || context.run_id == 0 {
            bail!("decision resolution requires nonzero organization/company/run ids");
        }
        request.validate()?;

        let policy_store = StdbGraduationPolicyStore {
            reader: self.reader,
            organization_id: context.organization_id,
        };
        let graduation = policy_store.policy_for(&request.decision_type).await?;
        match graduation.execution_mode {
            DecisionExecutionMode::ModelPrimary => return Ok(None),
            DecisionExecutionMode::DeterministicShadow => {
                bail!("deterministic_shadow execution mode is not admitted for live routing; use DG-05 shadow evaluation")
            }
            DecisionExecutionMode::DeterministicPrimaryModelShadow
            | DecisionExecutionMode::DeterministicOnly => {}
        }

        let rows = self
            .reader
            .query_sql(&format!(
                "SELECT * FROM ai_decision_pattern WHERE organization_id = {} \
                 AND decision_type_name = '{}' AND decision_type_version = {} \
                 AND status = 'promoted' LIMIT 100",
                context.organization_id,
                sql_escape(&request.decision_type.name),
                request.decision_type.version
            ))
            .await
            .context("query promoted deterministic decision patterns")?;

        let current_context_fingerprint = json_fingerprint(&request.bounded_state)?;
        let current_candidate_set_hash = canonical_string_list(&request.candidates.iter().map(|v| Value::String(v.clone())).collect::<Vec<_>>());
        let current_evidence_shape = value_shape(&request.bounded_state);

        let mut matches = Vec::new();
        for row in rows {
            let applicability_raw = row_string(&row, "applicabilityJson")
                .context("promoted pattern applicability_json missing")?;
            let applicability: PatternApplicabilityEvidence =
                serde_json::from_str(&applicability_raw)
                    .context("decode promoted pattern applicability")?;
            if applicability.company_id != context.company_id
                || applicability.program_ref != context.program_ref
                || applicability.step_id != context.step_id
                || applicability.context_fingerprint != current_context_fingerprint
                || applicability.candidate_set_hash != current_candidate_set_hash
                || applicability.evidence_shape != current_evidence_shape
            {
                continue;
            }

            let promotion_raw = row_string(&row, "reviewedNote")
                .context("promoted pattern is missing promotion evidence")?;
            let promotion: Value =
                serde_json::from_str(&promotion_raw).context("decode promotion evidence")?;
            let implementation_ref = promotion
                .get("implementation_ref")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .context("promotion evidence missing implementation_ref")?
                .to_string();
            let pattern_ref = row_string(&row, "patternKey")
                .context("promoted pattern key missing")?;
            let rollback_mode = latest_persisted_rollback_mode(
                self.reader,
                context.organization_id,
                context.company_id,
                &request.decision_type,
                &pattern_ref,
                &implementation_ref,
            )
            .await?;
            matches.push(PromotedDeterministicResolution {
                mode: lower_authority(graduation.execution_mode, rollback_mode),
                pattern_ref,
                implementation_ref,
            });
        }

        match matches.len() {
            0 => bail!(
                "deterministic execution mode is enabled but no promoted pattern matches the current decision partition"
            ),
            1 => Ok(matches.pop()),
            _ => bail!(
                "multiple promoted deterministic patterns match the current decision partition"
            ),
        }
    }
}

fn authority_rank(mode: DecisionExecutionMode) -> u8 {
    match mode {
        DecisionExecutionMode::ModelPrimary => 0,
        DecisionExecutionMode::DeterministicShadow => 0,
        DecisionExecutionMode::DeterministicPrimaryModelShadow => 1,
        DecisionExecutionMode::DeterministicOnly => 2,
    }
}

fn lower_authority(
    configured: DecisionExecutionMode,
    persisted: Option<DecisionExecutionMode>,
) -> DecisionExecutionMode {
    match persisted {
        Some(persisted) if authority_rank(persisted) < authority_rank(configured) => persisted,
        _ => configured,
    }
}

async fn latest_persisted_rollback_mode(
    reader: &StdbClient,
    organization_id: u64,
    company_id: u64,
    decision_type: &DecisionTypeRef,
    pattern_ref: &str,
    implementation_ref: &str,
) -> Result<Option<DecisionExecutionMode>> {
    let rows = reader
        .query_sql(&format!(
            "SELECT * FROM ai_intelligence_event WHERE organization_id = {} AND company_id = {} \
             AND event_kind = 'graduation_rollback' AND decision_type_name = '{}' \
             AND decision_type_version = {} AND model = '{}' LIMIT {}",
            organization_id,
            company_id,
            sql_escape(&decision_type.name),
            decision_type.version,
            sql_escape(implementation_ref),
            MAX_ANALYSIS_ROWS
        ))
        .await
        .context("load persisted deterministic authority rollbacks")?;

    let mut lowest: Option<DecisionExecutionMode> = None;
    for row in rows {
        if row_string(&row, "shadowProfileRef").as_deref() != Some(pattern_ref) {
            continue;
        }
        let output = row_string(&row, "outputJson").context("rollback output_json missing")?;
        let value: Value = serde_json::from_str(&output).context("decode rollback evidence")?;
        let Some(to_mode) = value.get("to_mode").and_then(Value::as_str) else {
            continue;
        };
        let parsed = match to_mode {
            "model_primary" => DecisionExecutionMode::ModelPrimary,
            "deterministic_primary_model_shadow" => {
                DecisionExecutionMode::DeterministicPrimaryModelShadow
            }
            "deterministic_only" => DecisionExecutionMode::DeterministicOnly,
            _ => continue,
        };
        lowest = Some(match lowest {
            Some(current) if authority_rank(current) <= authority_rank(parsed) => current,
            _ => parsed,
        });
    }
    Ok(lowest)
}

#[async_trait]
pub(super) trait ModelShadowRecorder: Send + Sync {
    async fn record_model_shadow(
        &self,
        organization_id: u64,
        company_id: u64,
        run_id: u64,
        request: &DecisionRequest,
        response: Result<&DecisionResponse, &str>,
    ) -> Result<()>;
}

pub(super) struct StdbModelShadowRecorder<'a> {
    pub writer: &'a StdbClient,
}

#[async_trait]
impl ModelShadowRecorder for StdbModelShadowRecorder<'_> {
    async fn record_model_shadow(
        &self,
        organization_id: u64,
        company_id: u64,
        run_id: u64,
        request: &DecisionRequest,
        response: Result<&DecisionResponse, &str>,
    ) -> Result<()> {
        let request_hash = decision_request_hash(request)?;
        let request_json = serde_json::to_string(request)?;
        let params = match response {
            Ok(response) => json!({
                "shadow_profile_ref": format!("model-shadow:{}:{}", response.provider, response.model),
                "decision_type_name": request.decision_type.name,
                "decision_type_version": request.decision_type.version,
                "request_hash": request_hash,
                "request_json": request_json,
                "outcome_kind": decision_kind_label(request.kind),
                "output_json": serde_json::to_string(response)?,
                "confidence": response.confidence,
                "provider": response.provider,
                "model": response.model,
                "input_tokens": response.input_tokens,
                "output_tokens": response.output_tokens,
                "shadow_error": null,
            }),
            Err(error) => json!({
                "shadow_profile_ref": "model-shadow:error",
                "decision_type_name": request.decision_type.name,
                "decision_type_version": request.decision_type.version,
                "request_hash": request_hash,
                "request_json": request_json,
                "outcome_kind": null,
                "output_json": null,
                "confidence": null,
                "provider": "model-shadow",
                "model": "unavailable",
                "input_tokens": 0,
                "output_tokens": 0,
                "shadow_error": error,
            }),
        };
        self.writer
            .call_reducer(ReducerCall::from_name(
                "record_ai_decision_shadow_event",
                json!([organization_id, company_id, run_id, params]),
            ))
            .await
            .context("record model shadow for deterministic-primary decision")
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum DriftReason {
    ConformanceBelowThreshold,
    CorrectionDrift,
    PolicyDrift,
    ApplicabilityDrift,
    ReviewDefect,
    PatternSuperseded,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct AuthorityDowngrade {
    pub pattern_ref: String,
    pub implementation_ref: String,
    pub from: DecisionExecutionMode,
    pub to: DecisionExecutionMode,
    pub reasons: Vec<DriftReason>,
}

fn next_lower_authority(mode: DecisionExecutionMode) -> Option<DecisionExecutionMode> {
    match mode {
        DecisionExecutionMode::DeterministicOnly => Some(DecisionExecutionMode::DeterministicPrimaryModelShadow),
        DecisionExecutionMode::DeterministicPrimaryModelShadow => Some(DecisionExecutionMode::ModelPrimary),
        DecisionExecutionMode::DeterministicShadow | DecisionExecutionMode::ModelPrimary => None,
    }
}

#[async_trait]
pub(super) trait DriftMonitor: Send + Sync {
    async fn evaluate(
        &self,
        context: &DecisionResolutionContext,
        request: &DecisionRequest,
        resolution: &PromotedDeterministicResolution,
    ) -> Result<Option<AuthorityDowngrade>>;
}

pub(super) struct StdbDriftMonitor<'a> {
    pub reader: &'a StdbClient,
}

#[async_trait]
impl DriftMonitor for StdbDriftMonitor<'_> {
    async fn evaluate(
        &self,
        context: &DecisionResolutionContext,
        request: &DecisionRequest,
        resolution: &PromotedDeterministicResolution,
    ) -> Result<Option<AuthorityDowngrade>> {
        let Some(to) = next_lower_authority(resolution.mode) else {
            return Ok(None);
        };
        let policy_store = StdbGraduationPolicyStore {
            reader: self.reader,
            organization_id: context.organization_id,
        };
        let policy = policy_store.policy_for(&request.decision_type).await?;
        let mut reasons = Vec::new();

        let aggregate = StdbConformanceAggregator { reader: self.reader }
            .aggregate(
                context.organization_id,
                context.company_id,
                &request.decision_type,
                &resolution.implementation_ref,
                MAX_ANALYSIS_ROWS,
            )
            .await?;
        if let Some(rate) = aggregate.conformance_rate() {
            if aggregate.successful_evaluations >= policy.minimum_shadow_cases
                && rate < policy.minimum_shadow_conformance_rate
            {
                reasons.push(DriftReason::ConformanceBelowThreshold);
            }
        }

        let rows = self.reader.query_sql(&format!(
            "SELECT * FROM ai_decision_pattern WHERE organization_id = {} AND pattern_key = '{}' LIMIT 1",
            context.organization_id,
            sql_escape(&resolution.pattern_ref)
        )).await.context("load promoted pattern for drift evaluation")?;
        let Some(pattern) = rows.first() else {
            return Ok(Some(AuthorityDowngrade {
                pattern_ref: resolution.pattern_ref.clone(),
                implementation_ref: resolution.implementation_ref.clone(),
                from: resolution.mode,
                to: DecisionExecutionMode::ModelPrimary,
                reasons: vec![DriftReason::PatternSuperseded],
            }));
        };

        if row_string(pattern, "status").as_deref() != Some("promoted") {
            reasons.push(DriftReason::PatternSuperseded);
        }

        let applicability_raw = row_string(pattern, "applicabilityJson")
            .context("pattern applicability missing")?;
        let applicability: PatternApplicabilityEvidence =
            serde_json::from_str(&applicability_raw).context("decode pattern applicability")?;
        let candidate_values = request
            .candidates
            .iter()
            .map(|value| Value::String(value.clone()))
            .collect::<Vec<_>>();
        if applicability.company_id != context.company_id
            || applicability.program_ref != context.program_ref
            || applicability.step_id != context.step_id
            || applicability.context_fingerprint != json_fingerprint(&request.bounded_state)?
            || applicability.candidate_set_hash != canonical_string_list(&candidate_values)
            || applicability.evidence_shape != value_shape(&request.bounded_state)
        {
            reasons.push(DriftReason::ApplicabilityDrift);
        }

        let support_ids = row_value(pattern, "supportingCaseIds")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for id in support_ids.iter().filter_map(Value::as_u64) {
            let case_rows = self.reader.query_sql(&format!(
                "SELECT status FROM ai_decision_case WHERE organization_id = {} AND id = {} LIMIT 1",
                context.organization_id, id
            )).await.context("check supporting case drift")?;
            if case_rows.first().and_then(|row| row_string(row, "status"))
                .is_some_and(|status| matches!(status.as_str(), "rejected" | "superseded"))
            {
                reasons.push(DriftReason::CorrectionDrift);
                break;
            }
        }

        if applicability.material_policy_refs.is_empty() && policy.minimum_policy_stability.is_some() {
            reasons.push(DriftReason::PolicyDrift);
        }

        let (live_shadow_samples, live_shadow_disagreement_rate, exercised_run_ids) =
            post_promotion_model_shadow_disagreement(
                self.reader,
                context.organization_id,
                context.company_id,
                &request.decision_type,
                &resolution.implementation_ref,
            )
            .await?;
        if let Some(maximum) = policy.maximum_provider_disagreement_rate {
            if live_shadow_samples >= policy.minimum_shadow_cases
                && live_shadow_disagreement_rate.is_some_and(|rate| rate > maximum)
            {
                reasons.push(DriftReason::ConformanceBelowThreshold);
            }
        }

        if !exercised_run_ids.is_empty() {
            let review_rows = self.reader.query_sql(&format!(
                "SELECT * FROM ai_run_review WHERE organization_id = {} AND company_id = {} LIMIT {}",
                context.organization_id, context.company_id, MAX_ANALYSIS_ROWS
            )).await.context("check run-review drift")?;
            if review_rows.iter().any(|row| {
                row_u64(row, "runId").is_some_and(|run_id| exercised_run_ids.contains(&run_id))
                    && row_string(row, "disposition")
                        .is_some_and(|d| matches!(d.as_str(), "defect" | "incident_candidate"))
            }) {
                reasons.push(DriftReason::ReviewDefect);
            }
        }

        reasons.sort_by_key(|reason| format!("{reason:?}"));
        reasons.dedup();
        Ok((!reasons.is_empty()).then(|| AuthorityDowngrade {
            pattern_ref: resolution.pattern_ref.clone(),
            implementation_ref: resolution.implementation_ref.clone(),
            from: resolution.mode,
            to,
            reasons,
        }))
    }
}

async fn post_promotion_model_shadow_disagreement(
    reader: &StdbClient,
    organization_id: u64,
    company_id: u64,
    decision_type: &DecisionTypeRef,
    implementation_ref: &str,
) -> Result<(u64, Option<f64>, HashSet<u64>)> {
    let rows = reader
        .query_sql(&format!(
            "SELECT * FROM ai_intelligence_event WHERE organization_id = {} AND company_id = {} \
             AND decision_type_name = '{}' AND decision_type_version = {} LIMIT {}",
            organization_id,
            company_id,
            sql_escape(&decision_type.name),
            decision_type.version,
            MAX_ANALYSIS_ROWS
        ))
        .await
        .context("query post-promotion model shadow drift")?;

    let mut deterministic_by_hash = HashMap::<String, (String, u64)>::new();
    let mut model_shadows = Vec::<(String, String, u64)>::new();

    for row in rows {
        let request_hash = row_string(&row, "requestHash").unwrap_or_default();
        let run_id = row_u64(&row, "runId").unwrap_or_default();
        let event_kind = row_string(&row, "eventKind").unwrap_or_default();
        if event_kind == "decision"
            && row_string(&row, "provider").as_deref() == Some("deterministic")
            && row_string(&row, "model").as_deref() == Some(implementation_ref)
        {
            if let Some(raw) = row_string(&row, "outputJson") {
                if let Ok(value) = serde_json::from_str::<Value>(&raw) {
                    deterministic_by_hash
                        .insert(request_hash, (canonical_json(&decision_signal(&value))?, run_id));
                }
            }
        } else if event_kind == "decision_shadow"
            && row_string(&row, "shadowProfileRef")
                .is_some_and(|value| value.starts_with("model-shadow:"))
        {
            if let Some(raw) = row_string(&row, "outputJson") {
                if let Ok(value) = serde_json::from_str::<Value>(&raw) {
                    model_shadows.push((
                        request_hash,
                        canonical_json(&decision_signal(&value))?,
                        run_id,
                    ));
                }
            }
        }
    }

    let mut comparable = 0_u64;
    let mut disagreements = 0_u64;
    let mut run_ids = HashSet::new();
    for (hash, shadow, shadow_run_id) in model_shadows {
        if let Some((production, production_run_id)) = deterministic_by_hash.get(&hash) {
            comparable += 1;
            if production != &shadow {
                disagreements += 1;
            }
            run_ids.insert(*production_run_id);
            run_ids.insert(shadow_run_id);
        }
    }
    Ok((
        comparable,
        (comparable > 0).then(|| disagreements as f64 / comparable as f64),
        run_ids,
    ))
}

#[async_trait]
pub(super) trait AuthorityRollbackRecorder: Send + Sync {
    async fn record(
        &self,
        context: &DecisionResolutionContext,
        decision_type: &DecisionTypeRef,
        downgrade: &AuthorityDowngrade,
    ) -> Result<()>;
}

pub(super) struct StdbAuthorityRollbackRecorder<'a> {
    pub writer: &'a StdbClient,
}

#[async_trait]
impl AuthorityRollbackRecorder for StdbAuthorityRollbackRecorder<'_> {
    async fn record(
        &self,
        context: &DecisionResolutionContext,
        decision_type: &DecisionTypeRef,
        downgrade: &AuthorityDowngrade,
    ) -> Result<()> {
        self.writer.call_reducer(ReducerCall::from_name(
            "record_ai_graduation_authority_rollback",
            json!([context.organization_id, context.company_id, context.run_id, {
                "decision_type_name": decision_type.name,
                "decision_type_version": decision_type.version,
                "pattern_ref": downgrade.pattern_ref,
                "implementation_ref": downgrade.implementation_ref,
                "from_mode": serde_json::to_value(downgrade.from)?,
                "to_mode": serde_json::to_value(downgrade.to)?,
                "reasons_json": serde_json::to_string(&downgrade.reasons)?,
            }]),
        )).await.context("record deterministic authority rollback")
    }
}

pub(super) struct GovernedDecisionResolver<'a> {
    pub policy: &'a dyn DecisionResolutionPolicy,
    pub candidates: &'a DeterministicCandidateRegistry,
    pub model: &'a dyn super::intelligence::DecisionProvider,
    pub model_shadow_recorder: &'a dyn ModelShadowRecorder,
    pub drift_monitor: Option<&'a dyn DriftMonitor>,
    pub rollback_recorder: Option<&'a dyn AuthorityRollbackRecorder>,
}

impl GovernedDecisionResolver<'_> {
    pub async fn decide(
        &self,
        context: &DecisionResolutionContext,
        request: DecisionRequest,
    ) -> Result<DecisionResponse> {
        let resolution = self.policy.resolve(context, &request).await?;
        let Some(mut resolution) = resolution else {
            return self.model.decide(request).await;
        };

        if let Some(monitor) = self.drift_monitor {
            if let Some(downgrade) = monitor.evaluate(context, &request, &resolution).await? {
                if let Some(recorder) = self.rollback_recorder {
                    recorder.record(context, &request.decision_type, &downgrade).await?;
                }
                resolution.mode = downgrade.to;
                if resolution.mode == DecisionExecutionMode::ModelPrimary {
                    return self.model.decide(request).await;
                }
            }
        }

        let candidate = self
            .candidates
            .get(&resolution.implementation_ref)
            .with_context(|| {
                format!(
                    "promoted deterministic implementation '{}' is not registered",
                    resolution.implementation_ref
                )
            })?;
        if candidate.decision_type() != request.decision_type {
            bail!("promoted deterministic candidate DecisionType does not match request");
        }

        match resolution.mode {
            DecisionExecutionMode::DeterministicPrimaryModelShadow => {
                let deterministic = candidate.evaluate(&request).await?;
                deterministic.validate_against(&request)?;
                let model_result = self.model.decide(request.clone()).await;
                match &model_result {
                    Ok(response) => {
                        if let Err(error) = self
                            .model_shadow_recorder
                            .record_model_shadow(
                                context.organization_id,
                                context.company_id,
                                context.run_id,
                                &request,
                                Ok(response),
                            )
                            .await
                        {
                            tracing::warn!("failed to record deterministic-primary model shadow: {error:#}");
                        }
                    }
                    Err(error) => {
                        let message = error.to_string();
                        if let Err(record_error) = self
                            .model_shadow_recorder
                            .record_model_shadow(
                                context.organization_id,
                                context.company_id,
                                context.run_id,
                                &request,
                                Err(message.as_str()),
                            )
                            .await
                        {
                            tracing::warn!("failed to record model-shadow error: {record_error:#}");
                        }
                    }
                }
                Ok(deterministic_to_decision_response(
                    deterministic,
                    &resolution.implementation_ref,
                ))
            }
            DecisionExecutionMode::DeterministicOnly => {
                let deterministic = candidate.evaluate(&request).await?;
                deterministic.validate_against(&request)?;
                Ok(deterministic_to_decision_response(
                    deterministic,
                    &resolution.implementation_ref,
                ))
            }
            DecisionExecutionMode::ModelPrimary | DecisionExecutionMode::DeterministicShadow => {
                self.model.decide(request).await
            }
        }
    }
}

fn deterministic_to_decision_response(
    response: DeterministicDecisionResponse,
    implementation_ref: &str,
) -> DecisionResponse {
    DecisionResponse {
        kind: response.kind,
        choice: response.choice,
        score: response.score,
        probability: response.probability,
        confidence: None,
        rationale: response.rationale,
        model: implementation_ref.to_string(),
        provider: "deterministic".to_string(),
        input_tokens: 0,
        output_tokens: 0,
    }
}

fn decision_kind_label(kind: DecisionKind) -> &'static str {
    match kind {
        DecisionKind::Choice => "choice",
        DecisionKind::Score => "score",
        DecisionKind::Probability => "probability",
    }
}

#[async_trait]
pub(super) trait GraduationAnalyzer: Send + Sync {
    async fn analyze(&self, query: &GraduationQuery) -> Result<Vec<GraduationCandidate>>;
}

pub(super) struct StdbGraduationAnalyzer<'a> {
    pub reader: &'a StdbClient,
}

#[derive(Clone, Debug)]
struct CaseRow {
    id: u64,
    request_hash: String,
    context_fingerprint: String,
    program_ref: String,
    step_id: String,
    selected: Value,
    material_constraints: Value,
    status: String,
    outcome_status: String,
    correction_of: Option<u64>,
    provider_attempt_id: Option<u64>,
}

#[derive(Clone, Debug)]
struct DecisionEventRow {
    request_hash: String,
    event_kind: String,
    request: Value,
    output: Option<Value>,
    shadow_error: Option<String>,
}

#[async_trait]
impl GraduationAnalyzer for StdbGraduationAnalyzer<'_> {
    async fn analyze(&self, query: &GraduationQuery) -> Result<Vec<GraduationCandidate>> {
        query.validate()?;

        let cases = self.load_cases(query).await?;
        let events = self.load_events(query).await?;
        let economics = self.load_provider_economics(query).await?;

        let event_by_request = events
            .iter()
            .filter(|event| event.event_kind == "decision")
            .map(|event| (event.request_hash.as_str(), event))
            .collect::<HashMap<_, _>>();
        let mut by_fingerprint: BTreeMap<String, Vec<CaseRow>> = BTreeMap::new();
        for case in cases {
            if case.context_fingerprint.trim().is_empty() {
                continue;
            }
            let fingerprint = applicability_fingerprint(
                &query.decision_type,
                &case,
                event_by_request.get(case.request_hash.as_str()).copied(),
            )?;
            by_fingerprint.entry(fingerprint).or_default().push(case);
        }

        let mut candidates = Vec::new();
        for (fingerprint, cohort) in by_fingerprint {
            if cohort.len() < query.minimum_cases_per_cohort as usize {
                continue;
            }
            let request_hashes = cohort
                .iter()
                .map(|case| case.request_hash.as_str())
                .collect::<HashSet<_>>();
            let cohort_events = events
                .iter()
                .filter(|event| request_hashes.contains(event.request_hash.as_str()))
                .collect::<Vec<_>>();
            let metrics = compute_metrics(
                query.decision_type.clone(),
                fingerprint.clone(),
                &cohort,
                &cohort_events,
                &economics,
            )?;
            let dominant_selected = dominant_value(cohort.iter().map(|case| &case.selected))
                .unwrap_or(Value::Null);
            let first = cohort.first().context("graduation cohort unexpectedly empty")?;
            let primary_event = cohort_events
                .iter()
                .copied()
                .find(|event| event.event_kind == "decision");
            let candidate_set_hash = primary_event
                .and_then(|event| event.request.get("candidates"))
                .and_then(Value::as_array)
                .map(|values| canonical_string_list(values))
                .unwrap_or_else(|| "no-candidate-set".to_string());
            let applicability = PatternApplicabilityEvidence {
                schema_version: 1,
                applicability_fingerprint: fingerprint.clone(),
                company_id: query.company_id,
                program_ref: first.program_ref.clone(),
                step_id: first.step_id.clone(),
                context_fingerprint: first.context_fingerprint.clone(),
                candidate_set_hash,
                evidence_shape: value_shape(&first.material_constraints),
                graduation_policy_ref: format!(
                    "decision-type:{}@{}/graduation",
                    query.decision_type.name, query.decision_type.version
                ),
                // Decision cases do not yet persist current operational policy refs.
                // Keep this explicit rather than inventing stability evidence.
                material_policy_refs: Vec::new(),
            };
            candidates.push(GraduationCandidate {
                decision_type: query.decision_type.clone(),
                applicability_fingerprint: fingerprint,
                supporting_case_ids: cohort.iter().map(|case| case.id).collect(),
                dominant_selected,
                applicability,
                proposed_expression_kind: expression_kind(&cohort_events),
                metrics,
            });
        }

        candidates.sort_by(|a, b| {
            b.metrics
                .observed_cases
                .cmp(&a.metrics.observed_cases)
                .then_with(|| {
                    a.metrics
                        .decision_entropy
                        .partial_cmp(&b.metrics.decision_entropy)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
        });
        Ok(candidates)
    }
}

impl StdbGraduationAnalyzer<'_> {
    async fn load_cases(&self, query: &GraduationQuery) -> Result<Vec<CaseRow>> {
        let sql = format!(
            "SELECT * FROM ai_decision_case WHERE organization_id = {} AND company_id = {} \
             AND decision_type_name = '{}' AND decision_type_version = {} LIMIT {}",
            query.organization_id,
            query.company_id,
            sql_escape(&query.decision_type.name),
            query.decision_type.version,
            query.max_cases
        );
        self.reader
            .query_sql(&sql)
            .await
            .context("query decision cases for graduation analysis")?
            .iter()
            .map(decode_case)
            .collect()
    }

    async fn load_events(&self, query: &GraduationQuery) -> Result<Vec<DecisionEventRow>> {
        let sql = format!(
            "SELECT * FROM ai_intelligence_event WHERE organization_id = {} AND company_id = {} \
             AND decision_type_name = '{}' AND decision_type_version = {} LIMIT {}",
            query.organization_id,
            query.company_id,
            sql_escape(&query.decision_type.name),
            query.decision_type.version,
            query.max_cases.saturating_mul(4).min(MAX_ANALYSIS_ROWS)
        );
        self.reader
            .query_sql(&sql)
            .await
            .context("query intelligence events for graduation analysis")?
            .iter()
            .map(decode_event)
            .collect()
    }

    async fn load_provider_economics(
        &self,
        query: &GraduationQuery,
    ) -> Result<HashMap<u64, ProviderEconomics>> {
        let attempts = self
            .reader
            .query_sql(&format!(
                "SELECT * FROM ai_provider_attempt WHERE organization_id = {} AND company_id = {} LIMIT {}",
                query.organization_id, query.company_id, query.max_cases
            ))
            .await
            .context("query provider attempts for graduation economics")?;

        let reservations = self
            .reader
            .query_sql(&format!(
                "SELECT * FROM ai_spend_reservation WHERE organization_id = {} AND company_id = {} LIMIT {}",
                query.organization_id, query.company_id, query.max_cases
            ))
            .await
            .context("query spend reservations for graduation economics")?;
        let settled_by_id = reservations
            .iter()
            .filter_map(|row| {
                Some((
                    row_u64(row, "id")?,
                    row_u64(row, "settledUnits").unwrap_or_default(),
                ))
            })
            .collect::<HashMap<_, _>>();

        Ok(attempts
            .iter()
            .filter_map(|row| {
                let id = row_u64(row, "id")?;
                let reservation_id = row_u64(row, "reservationId")?;
                let latency_ms = timestamp_micros(row_value(row, "finishedAt"))
                    .zip(timestamp_micros(row_value(row, "dispatchedAt")))
                    .map(|(finished, dispatched)| {
                        finished.saturating_sub(dispatched).max(0) as u64 / 1_000
                    });
                Some((
                    id,
                    ProviderEconomics {
                        cost_microunits: settled_by_id.get(&reservation_id).copied(),
                        latency_ms,
                    },
                ))
            })
            .collect())
    }
}

#[derive(Clone, Copy, Debug)]
struct ProviderEconomics {
    cost_microunits: Option<u64>,
    latency_ms: Option<u64>,
}

fn compute_metrics(
    decision_type: DecisionTypeRef,
    fingerprint: String,
    cases: &[CaseRow],
    events: &[&DecisionEventRow],
    economics: &HashMap<u64, ProviderEconomics>,
) -> Result<GraduationMetrics> {
    let observed_cases = cases.len() as u64;
    let verified_cases = cases
        .iter()
        .filter(|case| matches!(case.status.as_str(), "verified" | "reviewed" | "approved"))
        .count() as u64;
    let reviewed_cases = cases
        .iter()
        .filter(|case| matches!(case.status.as_str(), "reviewed" | "approved"))
        .count() as u64;
    let corrected = cases
        .iter()
        .filter(|case| case.correction_of.is_some() || case.status == "superseded")
        .count() as u64;
    let correction_rate = ratio(corrected, observed_cases);
    let verified_outcomes = cases
        .iter()
        .filter(|case| case.outcome_status != "unknown")
        .count() as u64;
    let verified_outcome_rate = ratio(verified_outcomes, observed_cases);
    let decision_entropy = normalized_entropy(cases.iter().map(|case| &case.selected));
    let precedent_consistency = dominant_ratio(
        cases
            .iter()
            .filter(|case| matches!(case.status.as_str(), "verified" | "reviewed" | "approved"))
            .map(|case| &case.selected),
    );
    let evidence_shape_stability = dominant_shape_ratio(
        cases.iter().map(|case| &case.material_constraints),
    );

    let (provider_disagreement_rate, shadow_cases) = shadow_disagreement(events)?;
    let candidate_set_stability = candidate_set_stability(events);

    let case_attempt_ids = cases
        .iter()
        .filter_map(|case| case.provider_attempt_id)
        .collect::<Vec<_>>();
    let costs = case_attempt_ids
        .iter()
        .filter_map(|id| economics.get(id).and_then(|value| value.cost_microunits))
        .collect::<Vec<_>>();
    let latencies = case_attempt_ids
        .iter()
        .filter_map(|id| economics.get(id).and_then(|value| value.latency_ms))
        .collect::<Vec<_>>();

    Ok(GraduationMetrics {
        decision_type,
        applicability_fingerprint: fingerprint,
        observed_cases,
        verified_cases,
        reviewed_cases,
        correction_rate,
        verified_outcome_rate,
        provider_disagreement_rate,
        shadow_cases,
        decision_entropy,
        precedent_consistency,
        // Decision cases currently do not persist a policy-version ref. Do not
        // fabricate stability from program_ref; DG-03 will make it measurable.
        policy_stability_rate: None,
        evidence_shape_stability,
        candidate_set_stability,
        average_cost_microunits: average_u64(&costs),
        average_latency_ms: average_u64(&latencies),
    })
}

fn shadow_disagreement(events: &[&DecisionEventRow]) -> Result<(Option<f64>, u64)> {
    let mut primary = HashMap::<&str, String>::new();
    let mut shadows = Vec::<(&str, String)>::new();

    for event in events {
        if event.shadow_error.is_some() {
            continue;
        }
        let Some(output) = &event.output else { continue };
        let canonical = canonical_json(&decision_signal(output))?;
        match event.event_kind.as_str() {
            "decision" => {
                primary.insert(event.request_hash.as_str(), canonical);
            }
            "decision_shadow" => shadows.push((event.request_hash.as_str(), canonical)),
            _ => {}
        }
    }
    let comparable = shadows
        .iter()
        .filter_map(|(hash, shadow)| primary.get(hash).map(|production| (*production, shadow)))
        .collect::<Vec<_>>();
    if comparable.is_empty() {
        return Ok((None, 0));
    }
    let disagreements = comparable
        .iter()
        .filter(|(production, shadow)| *production != *shadow)
        .count() as u64;
    Ok((
        Some(ratio(disagreements, comparable.len() as u64)),
        comparable.len() as u64,
    ))
}

fn candidate_set_stability(events: &[&DecisionEventRow]) -> Option<f64> {
    let hashes = events
        .iter()
        .filter(|event| event.event_kind == "decision")
        .filter_map(|event| event.request.get("candidates").and_then(Value::as_array))
        .map(|candidates| canonical_string_list(candidates))
        .collect::<Vec<_>>();
    if hashes.is_empty() {
        return None;
    }
    Some(dominant_string_ratio(hashes.iter().map(String::as_str)))
}

fn expression_kind(events: &[&DecisionEventRow]) -> DeterministicExpressionKind {
    let kind = events
        .iter()
        .find(|event| event.event_kind == "decision")
        .and_then(|event| event.request.get("kind"))
        .and_then(Value::as_str);
    match kind {
        Some("choice") => DeterministicExpressionKind::LookupPolicy,
        Some("score" | "probability") => DeterministicExpressionKind::ThresholdPolicy,
        _ => DeterministicExpressionKind::NotExpressible,
    }
}

fn json_fingerprint(value: &Value) -> Result<String> {
    let canonical = canonical_json(value)?;
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

fn applicability_fingerprint(
    decision_type: &DecisionTypeRef,
    case: &CaseRow,
    event: Option<&DecisionEventRow>,
) -> Result<String> {
    let candidate_set_hash = event
        .and_then(|event| event.request.get("candidates"))
        .and_then(Value::as_array)
        .map(|values| canonical_string_list(values))
        .unwrap_or_else(|| "no-candidate-set".to_string());
    let evidence_shape = value_shape(&case.material_constraints);
    let material = format!(
        "{}@{}\n{}\n{}\n{}\n{}\n{}",
        decision_type.name,
        decision_type.version,
        case.program_ref,
        case.step_id,
        case.context_fingerprint,
        candidate_set_hash,
        evidence_shape,
    );
    let mut hasher = Sha256::new();
    hasher.update(material.as_bytes());
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

fn decision_signal(output: &Value) -> Value {
    let mut signal = serde_json::Map::new();
    for key in ["kind", "choice", "score", "probability"] {
        if let Some(value) = output.get(key) {
            signal.insert(key.to_string(), value.clone());
        }
    }
    Value::Object(signal)
}

fn decode_case(row: &Value) -> Result<CaseRow> {
    Ok(CaseRow {
        id: row_u64(row, "id").context("decision case id missing")?,
        request_hash: row_string(row, "requestHash").context("decision case request hash missing")?,
        context_fingerprint: row_string(row, "contextFingerprint")
            .context("decision case context fingerprint missing")?,
        program_ref: row_string(row, "programRef").context("decision case program_ref missing")?,
        step_id: row_string(row, "stepId").context("decision case step_id missing")?,
        selected: parse_json_string(row, "selectedJson")?,
        material_constraints: parse_json_string(row, "materialConstraintsJson")?,
        status: row_string(row, "status").unwrap_or_else(|| "observed".into()),
        outcome_status: row_string(row, "outcomeStatus").unwrap_or_else(|| "unknown".into()),
        correction_of: row_u64(row, "correctionOf"),
        provider_attempt_id: row_u64(row, "providerAttemptId"),
    })
}

fn decode_event(row: &Value) -> Result<DecisionEventRow> {
    let output = row_string(row, "outputJson")
        .filter(|value| !value.trim().is_empty())
        .map(|value| serde_json::from_str(&value).context("parse intelligence output_json"))
        .transpose()?;
    Ok(DecisionEventRow {
        request_hash: row_string(row, "requestHash").context("event request hash missing")?,
        event_kind: row_string(row, "eventKind").context("event kind missing")?,
        request: parse_json_string(row, "requestJson")?,
        output,
        shadow_error: row_string(row, "shadowError"),
    })
}

fn parse_json_string(row: &Value, key: &str) -> Result<Value> {
    let raw = row_string(row, key).with_context(|| format!("{key} missing"))?;
    serde_json::from_str(&raw).with_context(|| format!("parse {key}"))
}

fn canonical_json(value: &Value) -> Result<String> {
    let canonical = canonicalize(value);
    serde_json::to_string(&canonical).context("serialize canonical JSON")
}

fn canonicalize(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let sorted = object
                .iter()
                .map(|(key, value)| (key.clone(), canonicalize(value)))
                .collect::<BTreeMap<_, _>>();
            Value::Object(sorted.into_iter().collect())
        }
        Value::Array(items) => Value::Array(items.iter().map(canonicalize).collect()),
        _ => value.clone(),
    }
}

fn normalized_entropy<'a>(values: impl Iterator<Item = &'a Value>) -> f64 {
    let counts = frequency(values);
    let total = counts.values().sum::<u64>();
    if total <= 1 || counts.len() <= 1 {
        return 0.0;
    }
    let entropy = counts.values().fold(0.0, |acc, count| {
        let p = *count as f64 / total as f64;
        acc - p * p.log2()
    });
    let max_entropy = (counts.len() as f64).log2();
    if max_entropy == 0.0 { 0.0 } else { entropy / max_entropy }
}

fn dominant_ratio<'a>(values: impl Iterator<Item = &'a Value>) -> f64 {
    let counts = frequency(values);
    let total = counts.values().sum::<u64>();
    let dominant = counts.values().copied().max().unwrap_or_default();
    ratio(dominant, total)
}

fn dominant_value<'a>(values: impl Iterator<Item = &'a Value>) -> Option<Value> {
    let mut counts = HashMap::<String, (u64, Value)>::new();
    for value in values {
        let key = canonical_json(value).ok()?;
        let entry = counts.entry(key).or_insert((0, value.clone()));
        entry.0 += 1;
    }
    counts.into_values().max_by_key(|(count, _)| *count).map(|(_, value)| value)
}

fn frequency<'a>(values: impl Iterator<Item = &'a Value>) -> HashMap<String, u64> {
    let mut counts = HashMap::new();
    for value in values {
        if let Ok(key) = canonical_json(value) {
            *counts.entry(key).or_insert(0) += 1;
        }
    }
    counts
}

fn dominant_shape_ratio<'a>(values: impl Iterator<Item = &'a Value>) -> f64 {
    let shapes = values.map(value_shape).collect::<Vec<_>>();
    dominant_string_ratio(shapes.iter().map(String::as_str))
}

fn value_shape(value: &Value) -> String {
    match value {
        Value::Object(object) => {
            let mut parts = object
                .iter()
                .map(|(key, value)| format!("{key}:{}", json_type(value)))
                .collect::<Vec<_>>();
            parts.sort();
            parts.join("|")
        }
        _ => json_type(value).to_string(),
    }
}

fn json_type(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn canonical_string_list(values: &[Value]) -> String {
    let mut items = values.iter().map(Value::to_string).collect::<Vec<_>>();
    items.sort();
    let mut hasher = Sha256::new();
    hasher.update(items.join("\n").as_bytes());
    format!("{:x}", hasher.finalize())
}

fn dominant_string_ratio<'a>(values: impl Iterator<Item = &'a str>) -> f64 {
    let mut counts = HashMap::<&str, u64>::new();
    let mut total = 0_u64;
    for value in values {
        *counts.entry(value).or_insert(0) += 1;
        total += 1;
    }
    ratio(counts.values().copied().max().unwrap_or_default(), total)
}

fn ratio(numerator: u64, denominator: u64) -> f64 {
    if denominator == 0 { 0.0 } else { numerator as f64 / denominator as f64 }
}

fn average_u64(values: &[u64]) -> Option<u64> {
    if values.is_empty() {
        return None;
    }
    let total = values.iter().map(|value| u128::from(*value)).sum::<u128>();
    Some((total / values.len() as u128).min(u128::from(u64::MAX)) as u64)
}

#[async_trait]
pub(super) trait GraduationPolicyStore: Send + Sync {
    async fn policy_for(&self, decision_type: &DecisionTypeRef) -> Result<GraduationPolicy>;
}

pub(super) struct StdbGraduationPolicyStore<'a> {
    pub reader: &'a StdbClient,
    pub organization_id: u64,
}

#[async_trait]
impl GraduationPolicyStore for StdbGraduationPolicyStore<'_> {
    async fn policy_for(&self, decision_type: &DecisionTypeRef) -> Result<GraduationPolicy> {
        decision_type.validate()?;
        if self.organization_id == 0 {
            bail!("graduation policy store requires nonzero organization_id");
        }
        let rows = self
            .reader
            .query_sql(&format!(
                "SELECT precedent_policy_json FROM ai_decision_type_definition \
                 WHERE organization_id = {} AND decision_type_name = '{}' \
                 AND decision_type_version = {} LIMIT 1",
                self.organization_id,
                sql_escape(&decision_type.name),
                decision_type.version
            ))
            .await
            .context("load DecisionType graduation policy")?;
        let Some(row) = rows.first() else {
            return Ok(GraduationPolicy::disabled());
        };
        let envelope = parse_json_string(row, "precedentPolicyJson")?;
        let Some(value) = envelope.get("graduation") else {
            return Ok(GraduationPolicy::disabled());
        };
        let policy: GraduationPolicy =
            serde_json::from_value(value.clone()).context("decode graduation policy")?;
        policy.validate()?;
        Ok(policy)
    }
}

fn row_value<'a>(row: &'a Value, key: &str) -> Option<&'a Value> {
    let snake = camel_to_snake(key);
    row.get(key).or_else(|| row.get(&snake))
}

fn row_u64(row: &Value, key: &str) -> Option<u64> {
    row_value(row, key).and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
}

fn row_string(row: &Value, key: &str) -> Option<String> {
    row_value(row, key).and_then(Value::as_str).map(str::to_string)
}

fn timestamp_micros(value: Option<&Value>) -> Option<i64> {
    let value = value?;
    value
        .as_object()
        .and_then(|object| object.get("__timestamp_micros_since_unix_epoch__"))
        .and_then(Value::as_i64)
        .or_else(|| value.as_i64())
}

fn camel_to_snake(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 4);
    for ch in value.chars() {
        if ch.is_ascii_uppercase() {
            out.push('_');
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

fn sql_escape(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn metrics() -> GraduationMetrics {
        GraduationMetrics {
            decision_type: DecisionTypeRef {
                name: "Test".into(),
                version: 1,
            },
            applicability_fingerprint: "fp".into(),
            observed_cases: 50,
            verified_cases: 40,
            reviewed_cases: 20,
            correction_rate: 0.01,
            verified_outcome_rate: 0.9,
            provider_disagreement_rate: Some(0.02),
            shadow_cases: 20,
            decision_entropy: 0.05,
            precedent_consistency: 0.98,
            policy_stability_rate: Some(1.0),
            evidence_shape_stability: 1.0,
            candidate_set_stability: Some(1.0),
            average_cost_microunits: Some(12),
            average_latency_ms: Some(50),
        }
    }

    #[test]
    fn eligibility_fails_closed_when_required_metric_is_unavailable() {
        let mut policy = GraduationPolicy::disabled();
        policy.enabled = true;
        policy.minimum_policy_stability = Some(0.95);
        let mut actual = metrics();
        actual.policy_stability_rate = None;
        let result = policy.evaluate(&actual);
        assert!(!result.eligible);
        assert!(result.reasons.iter().any(|reason| reason.contains("unavailable")));
    }

    #[test]
    fn stable_metrics_are_candidate_eligible_but_do_not_promote_anything() {
        let mut policy = GraduationPolicy::disabled();
        policy.enabled = true;
        policy.minimum_policy_stability = Some(0.95);
        let result = policy.evaluate(&metrics());
        assert!(result.eligible, "{:?}", result.reasons);
    }

    struct FixedDeterministicCandidate;

    #[async_trait]
    impl DeterministicDecisionCandidate for FixedDeterministicCandidate {
        fn implementation_ref(&self) -> &str {
            "deterministic:test@1"
        }

        fn decision_type(&self) -> DecisionTypeRef {
            DecisionTypeRef {
                name: "Test".into(),
                version: 1,
            }
        }

        async fn evaluate(
            &self,
            _request: &DecisionRequest,
        ) -> Result<DeterministicDecisionResponse> {
            Ok(DeterministicDecisionResponse {
                kind: DecisionKind::Choice,
                choice: Some("a".into()),
                score: None,
                probability: None,
                rationale: None,
            })
        }
    }

    struct RecordingShadowRecorder {
        calls: std::sync::Mutex<Vec<DeterministicShadowEvidence>>,
    }

    #[async_trait]
    impl DeterministicShadowRecorder for RecordingShadowRecorder {
        async fn record(
            &self,
            _organization_id: u64,
            _company_id: u64,
            _run_id: u64,
            _decision_type: &DecisionTypeRef,
            _request: &DecisionRequest,
            evidence: &DeterministicShadowEvidence,
        ) -> Result<()> {
            self.calls.lock().unwrap().push(evidence.clone());
            Ok(())
        }
    }

    fn shadow_request() -> DecisionRequest {
        DecisionRequest {
            decision_type: DecisionTypeRef {
                name: "Test".into(),
                version: 1,
            },
            kind: DecisionKind::Choice,
            question: "pick".into(),
            bounded_state: json!({}),
            candidates: vec!["a".into(), "b".into()],
            precedent: vec![],
            evidence: vec![],
        }
    }

    #[tokio::test]
    async fn deterministic_shadow_uses_exact_request_and_has_zero_authority() {
        let registry = DeterministicCandidateRegistry::default();
        registry
            .register(Arc::new(FixedDeterministicCandidate))
            .unwrap();
        let recorder = RecordingShadowRecorder {
            calls: std::sync::Mutex::new(Vec::new()),
        };
        let evaluator = DeterministicShadowEvaluator {
            registry: &registry,
            recorder: &recorder,
        };
        let production = DecisionResponse {
            kind: DecisionKind::Choice,
            choice: Some("a".into()),
            score: None,
            probability: None,
            confidence: Some(0.9),
            rationale: None,
            model: "m".into(),
            provider: "p".into(),
            input_tokens: 1,
            output_tokens: 1,
        };
        let evidence = evaluator
            .evaluate(
                1,
                2,
                3,
                "pattern:test@1",
                "deterministic:test@1",
                &shadow_request(),
                &production,
                &DecisionConformancePolicy {
                    numeric_tolerance: NumericTolerance {
                        absolute: 0.0,
                        relative: 0.0,
                    },
                    threshold_gate: None,
                    calibration_profile: None,
                },
            )
            .await
            .unwrap();
        assert_eq!(evidence.exact_match, Some(true));
        assert_eq!(evidence.conformant, Some(true));
        assert_eq!(recorder.calls.lock().unwrap().len(), 1);
    }

    #[test]
    fn deterministic_registry_rejects_duplicate_implementation_refs() {
        let registry = DeterministicCandidateRegistry::default();
        registry
            .register(Arc::new(FixedDeterministicCandidate))
            .unwrap();
        assert!(registry
            .register(Arc::new(FixedDeterministicCandidate))
            .is_err());
    }

    #[test]
    fn probability_can_be_within_tolerance_but_fail_gate_disposition() {
        let request = DecisionRequest {
            decision_type: DecisionTypeRef {
                name: "Test".into(),
                version: 1,
            },
            kind: DecisionKind::Probability,
            question: "probability".into(),
            bounded_state: json!({}),
            candidates: vec![],
            precedent: vec![],
            evidence: vec![],
        };
        let production = DecisionResponse {
            kind: DecisionKind::Probability,
            choice: None,
            score: None,
            probability: Some(0.51),
            confidence: None,
            rationale: None,
            model: "m".into(),
            provider: "p".into(),
            input_tokens: 1,
            output_tokens: 1,
        };
        let deterministic = DeterministicDecisionResponse {
            kind: DecisionKind::Probability,
            choice: None,
            score: None,
            probability: Some(0.49),
            rationale: None,
        };
        let comparison = compare_conformance(
            &request,
            &production,
            &deterministic,
            &DecisionConformancePolicy {
                numeric_tolerance: NumericTolerance {
                    absolute: 0.05,
                    relative: 0.0,
                },
                threshold_gate: Some(ThresholdGatePolicy {
                    name: "route".into(),
                    hard_stop_at_least: Some(0.5),
                    continue_below: Some(0.5),
                    require_calibrated: false,
                }),
                calibration_profile: None,
            },
        )
        .unwrap();
        assert_eq!(comparison.tolerance_match, Some(true));
        assert_eq!(comparison.gate_disposition_match, Some(false));
        assert!(!comparison.conformant);
    }

    #[test]
    fn calibrated_gate_disposition_is_compared_after_calibration() {
        use super::super::probabilistic::CalibrationProfileRef;

        let request = DecisionRequest {
            decision_type: DecisionTypeRef {
                name: "Test".into(),
                version: 1,
            },
            kind: DecisionKind::Probability,
            question: "probability".into(),
            bounded_state: json!({}),
            candidates: vec![],
            precedent: vec![],
            evidence: vec![],
        };
        let production = DecisionResponse {
            kind: DecisionKind::Probability,
            choice: None,
            score: None,
            probability: Some(0.8),
            confidence: None,
            rationale: None,
            model: "m".into(),
            provider: "p".into(),
            input_tokens: 1,
            output_tokens: 1,
        };
        let deterministic = DeterministicDecisionResponse {
            kind: DecisionKind::Probability,
            choice: None,
            score: None,
            probability: Some(0.75),
            rationale: None,
        };
        let profile = CalibrationProfile {
            profile_ref: CalibrationProfileRef {
                name: "identity".into(),
                version: 1,
            },
            breakpoints: vec![(0.0, 0.0), (1.0, 1.0)],
        };
        let comparison = compare_conformance(
            &request,
            &production,
            &deterministic,
            &DecisionConformancePolicy {
                numeric_tolerance: NumericTolerance {
                    absolute: 0.1,
                    relative: 0.0,
                },
                threshold_gate: Some(ThresholdGatePolicy {
                    name: "route".into(),
                    hard_stop_at_least: Some(0.7),
                    continue_below: Some(0.4),
                    require_calibrated: true,
                }),
                calibration_profile: Some(profile),
            },
        )
        .unwrap();
        assert_eq!(comparison.gate_disposition_match, Some(true));
        assert!(comparison.conformant);
    }

    struct NoopModelShadowRecorder;

    #[async_trait]
    impl ModelShadowRecorder for NoopModelShadowRecorder {
        async fn record_model_shadow(
            &self,
            _organization_id: u64,
            _company_id: u64,
            _run_id: u64,
            _request: &DecisionRequest,
            _response: Result<&DecisionResponse, &str>,
        ) -> Result<()> {
            Ok(())
        }
    }

    struct FixedResolutionPolicy {
        resolution: Option<PromotedDeterministicResolution>,
    }

    #[async_trait]
    impl DecisionResolutionPolicy for FixedResolutionPolicy {
        async fn resolve(
            &self,
            _context: &DecisionResolutionContext,
            _request: &DecisionRequest,
        ) -> Result<Option<PromotedDeterministicResolution>> {
            Ok(self.resolution.clone())
        }
    }

    struct FailingModel;

    #[async_trait]
    impl super::super::intelligence::DecisionProvider for FailingModel {
        async fn decide(&self, _request: DecisionRequest) -> Result<DecisionResponse> {
            bail!("model shadow failed")
        }
    }

    #[test]
    fn authority_downgrade_is_stepwise_and_never_promotes() {
        assert_eq!(
            next_lower_authority(DecisionExecutionMode::DeterministicOnly),
            Some(DecisionExecutionMode::DeterministicPrimaryModelShadow)
        );
        assert_eq!(
            next_lower_authority(DecisionExecutionMode::DeterministicPrimaryModelShadow),
            Some(DecisionExecutionMode::ModelPrimary)
        );
        assert_eq!(
            next_lower_authority(DecisionExecutionMode::ModelPrimary),
            None
        );
    }

    #[test]
    fn persisted_rollback_can_only_lower_authority() {
        assert_eq!(
            lower_authority(
                DecisionExecutionMode::DeterministicOnly,
                Some(DecisionExecutionMode::DeterministicPrimaryModelShadow),
            ),
            DecisionExecutionMode::DeterministicPrimaryModelShadow
        );
        assert_eq!(
            lower_authority(
                DecisionExecutionMode::DeterministicPrimaryModelShadow,
                Some(DecisionExecutionMode::ModelPrimary),
            ),
            DecisionExecutionMode::ModelPrimary
        );
        assert_eq!(
            lower_authority(
                DecisionExecutionMode::ModelPrimary,
                Some(DecisionExecutionMode::DeterministicOnly),
            ),
            DecisionExecutionMode::ModelPrimary
        );
    }

    #[tokio::test]
    async fn deterministic_primary_remains_live_when_model_shadow_fails() {
        let registry = DeterministicCandidateRegistry::default();
        registry
            .register(Arc::new(FixedDeterministicCandidate))
            .unwrap();
        let policy = FixedResolutionPolicy {
            resolution: Some(PromotedDeterministicResolution {
                mode: DecisionExecutionMode::DeterministicPrimaryModelShadow,
                pattern_ref: "pattern:test@1".into(),
                implementation_ref: "deterministic:test@1".into(),
            }),
        };
        let resolver = GovernedDecisionResolver {
            policy: &policy,
            candidates: &registry,
            model: &FailingModel,
            model_shadow_recorder: &NoopModelShadowRecorder,
            drift_monitor: None,
            rollback_recorder: None,
        };
        let response = resolver
            .decide(
                &DecisionResolutionContext {
                    organization_id: 1,
                    company_id: 2,
                    run_id: 3,
                    program_ref: "skill:test@1".into(),
                    step_id: "decision".into(),
                },
                shadow_request(),
            )
            .await
            .unwrap();
        assert_eq!(response.provider, "deterministic");
        assert_eq!(response.choice.as_deref(), Some("a"));
    }

    #[test]
    fn pattern_proposal_requires_matching_fingerprint_and_keeps_metric_snapshot() {
        let applicability = PatternApplicabilityEvidence {
            schema_version: 1,
            applicability_fingerprint: "fp".into(),
            company_id: 2,
            program_ref: "skill:test@1".into(),
            step_id: "decision".into(),
            context_fingerprint: "context".into(),
            candidate_set_hash: "candidates".into(),
            evidence_shape: "amount:number".into(),
            graduation_policy_ref: "decision-type:Test@1/graduation".into(),
            material_policy_refs: vec![],
        };
        let candidate = GraduationCandidate {
            decision_type: metrics().decision_type.clone(),
            applicability_fingerprint: "fp".into(),
            supporting_case_ids: vec![1, 2],
            dominant_selected: serde_json::json!("a"),
            applicability: applicability.clone(),
            proposed_expression_kind: DeterministicExpressionKind::LookupPolicy,
            metrics: metrics(),
        };
        let proposal =
            DecisionPatternProposal::from_candidate("test-pattern", &candidate, applicability)
                .unwrap();
        assert_eq!(proposal.metrics.observed_cases, 50);
        assert_eq!(proposal.metrics.correction_rate, 0.01);
    }

    #[test]
    fn entropy_is_zero_for_identical_outputs_and_one_for_balanced_binary_outputs() {
        let a = serde_json::json!("a");
        let b = serde_json::json!("b");
        assert_eq!(normalized_entropy([&a, &a, &a].into_iter()), 0.0);
        assert!((normalized_entropy([&a, &b].into_iter()) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn evidence_shape_stability_ignores_values_but_not_types_or_keys() {
        let a = serde_json::json!({"amount": 10, "currency": "EUR"});
        let b = serde_json::json!({"amount": 20, "currency": "USD"});
        let c = serde_json::json!({"amount": "20", "currency": "USD"});
        assert_eq!(dominant_shape_ratio([&a, &b].into_iter()), 1.0);
        assert!(dominant_shape_ratio([&a, &b, &c].into_iter()) > 0.5);
    }
}
