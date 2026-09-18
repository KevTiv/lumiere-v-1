//! GP-09 (governed intelligence program): first-class probabilistic
//! program state — architecture §7, `typed-decision-graph-and-run-review-
//! plan.md` §4 (TDG-03).
//!
//! Four requirements, each with a concrete type or function here:
//!
//! - **Provider confidence separated from calibrated confidence**: the
//!   `Confidence` enum has exactly two variants, `Raw` and `Calibrated`.
//!   There is no way to construct a `Calibrated` value except by running a
//!   `CalibrationProfile` over a `Raw` one — a caller cannot accidentally
//!   treat an uncalibrated number as calibrated, because the type says
//!   which one it is.
//! - **Calibration profile refs persisted**: `CalibrationProfileRef` is a
//!   stable, versioned reference (mirrors `DecisionTypeRef` from GP-01);
//!   the durable side is `spacetimedb/src/ai/calibration_profile.rs`.
//! - **Thresholds owned by policy/program configuration, never the
//!   model**: `ThresholdGatePolicy` is a plain data structure a program/
//!   policy author constructs; nothing about it comes from a provider
//!   response, and `Probabilistic<T>`/`Confidence` carry no threshold of
//!   their own to gate against.
//! - **Signals separated from operational disposition**: `Confidence`/
//!   `Probabilistic<T>` are signals. `GateDecision` is the only
//!   disposition type, and the only way to produce one is
//!   `ThresholdGatePolicy::evaluate`, which is policy-owned. No signal
//!   type can be a `GateDecision`, and no `GateDecision` variant carries a
//!   raw model utterance.
//!
//! `ThresholdGatePolicy::evaluate` is wired into `DecisionGraph` execution
//! via `decision_graph::GateCondition::ThresholdPolicy` and
//! `governed_program::GovernedProgramExecutor::select_gate_target`: a
//! branch names a policy and (optionally) a `CalibrationProfileRef`
//! instead of a raw threshold literal, and the executor reads the gate
//! source's `confidence` — never `probability`/`score`, which stay
//! provider metadata other `GateCondition` variants still compare
//! directly — calibrates it when a profile is named, and matches the
//! branch whose `on: GateDecision` equals the policy's result. The other,
//! older `GateCondition` variants (`ProbabilityAtLeast` etc.) are
//! untouched; `ThresholdPolicy` is an additional, stricter option a graph
//! author opts into per branch, not a replacement.
//!
//! `CalibrationProfileStore` closes a second, narrower gap: a
//! `CalibrationProfile`'s breakpoints have to come from *somewhere*
//! resolvable by `CalibrationProfileRef`. `StdbCalibrationProfileStore`
//! reads the durable `ai_calibration_profile` table
//! (`spacetimedb/src/ai/calibration_profile.rs`), mirroring
//! `decision_type::StdbDecisionTypeRegistry`'s trait/in-memory/durable
//! split; `governed_program.rs`'s production `GovernedProgramExecutor`
//! construction binds it.

use std::collections::HashMap;
use std::sync::RwLock;

use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use serde_json::Value;
use stdb_client::StdbClient;

use super::intelligence::EvidenceRef;

#[derive(Clone, Debug, PartialEq)]
pub(super) struct CalibrationProfileRef {
    pub name: String,
    pub version: u32,
}

impl CalibrationProfileRef {
    pub fn validate(&self) -> Result<()> {
        if self.name.trim().is_empty() {
            bail!("calibration profile name must be nonempty");
        }
        if self.version == 0 {
            bail!("calibration profile version must be positive");
        }
        Ok(())
    }
}

/// A provider's raw confidence, or a confidence that has actually been run
/// through a `CalibrationProfile`. These are never the same type — see
/// module docs.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum Confidence {
    /// Provider-reported, untrusted metadata (architecture invariant #8).
    Raw(f64),
    /// Produced only by `CalibrationProfile::calibrate`.
    Calibrated(f64),
}

impl Confidence {
    pub fn value(self) -> f64 {
        match self {
            Confidence::Raw(v) | Confidence::Calibrated(v) => v,
        }
    }

    pub fn is_calibrated(self) -> bool {
        matches!(self, Confidence::Calibrated(_))
    }

    fn validate(self) -> Result<()> {
        if !(0.0..=1.0).contains(&self.value()) {
            bail!("confidence must be within [0, 1]");
        }
        Ok(())
    }
}

/// A typed value the program has not yet collapsed to a boolean/branch —
/// architecture §7's `Probabilistic<T>`. `distribution` is an optional
/// richer representation (e.g. a histogram or named-outcome distribution);
/// most callers only need `confidence`.
#[derive(Clone, Debug)]
pub(super) struct Probabilistic<T> {
    pub value: T,
    pub confidence: Option<Confidence>,
    pub distribution: Option<Value>,
    pub calibration_profile: Option<CalibrationProfileRef>,
    pub evidence_refs: Vec<EvidenceRef>,
}

impl<T> Probabilistic<T> {
    pub fn validate(&self) -> Result<()> {
        if let Some(confidence) = self.confidence {
            confidence.validate()?;
            if confidence.is_calibrated() && self.calibration_profile.is_none() {
                bail!(
                    "a Calibrated confidence must carry the calibration_profile that produced it"
                );
            }
        }
        if let Some(profile) = &self.calibration_profile {
            profile.validate()?;
        }
        for evidence in &self.evidence_refs {
            evidence.validate()?;
        }
        Ok(())
    }
}

/// Deterministic, monotonic piecewise-linear mapping from raw provider
/// confidence to calibrated confidence. This is the only thing in this
/// module that may produce a `Confidence::Calibrated` value.
#[derive(Clone, Debug)]
pub(super) struct CalibrationProfile {
    pub profile_ref: CalibrationProfileRef,
    /// (raw, calibrated) pairs, sorted by `raw` ascending. Must cover
    /// raw = 0.0 and raw = 1.0 exactly (no extrapolation past the edges).
    pub breakpoints: Vec<(f64, f64)>,
}

impl CalibrationProfile {
    pub fn validate(&self) -> Result<()> {
        self.profile_ref.validate()?;
        if self.breakpoints.len() < 2 {
            bail!("a calibration profile needs at least two breakpoints");
        }
        for (raw, calibrated) in &self.breakpoints {
            if !(0.0..=1.0).contains(raw) || !(0.0..=1.0).contains(calibrated) {
                bail!("calibration breakpoints must lie within [0, 1]");
            }
        }
        for pair in self.breakpoints.windows(2) {
            if pair[1].0 <= pair[0].0 {
                bail!("calibration breakpoints must be strictly increasing in raw confidence");
            }
        }
        if self.breakpoints.first().map(|b| b.0) != Some(0.0) {
            bail!("calibration breakpoints must start at raw = 0.0");
        }
        if self.breakpoints.last().map(|b| b.0) != Some(1.0) {
            bail!("calibration breakpoints must end at raw = 1.0");
        }
        Ok(())
    }

    /// Linear interpolation between the two breakpoints bracketing `raw`.
    /// `raw` must already be validated to [0, 1] by the caller (it comes
    /// from a `Confidence::Raw`, which is validated on construction).
    pub fn calibrate(&self, raw: Confidence) -> Result<Confidence> {
        self.validate()?;
        let Confidence::Raw(raw_value) = raw else {
            bail!("only a Raw confidence may be calibrated");
        };
        raw.validate()?;

        for pair in self.breakpoints.windows(2) {
            let (x0, y0) = pair[0];
            let (x1, y1) = pair[1];
            if raw_value >= x0 && raw_value <= x1 {
                let span = x1 - x0;
                let calibrated = if span <= f64::EPSILON {
                    y0
                } else {
                    y0 + (y1 - y0) * (raw_value - x0) / span
                };
                return Ok(Confidence::Calibrated(calibrated.clamp(0.0, 1.0)));
            }
        }
        unreachable!("breakpoints are validated to cover [0, 1]")
    }
}

/// The only disposition type in this module. Produced solely by
/// `ThresholdGatePolicy::evaluate` — never by a provider, never embedded in
/// `Probabilistic<T>`/`Confidence` themselves (signals vs. disposition,
/// TDG §8).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum GateDecision {
    Continue,
    AcquireEvidence,
    Escalate,
}

/// A named, policy/program-owned set of thresholds — never provider state.
/// Mirrors the worked example in TDG §4:
///
/// ```text
/// P(x) >= hard_stop_at_least  -> Escalate
/// P(x) below continue_below   -> Continue
/// otherwise                   -> AcquireEvidence
/// ```
#[derive(Clone, Debug)]
pub(super) struct ThresholdGatePolicy {
    pub name: String,
    pub hard_stop_at_least: Option<f64>,
    pub continue_below: Option<f64>,
    /// When true, a `Confidence::Raw` value is never trusted for a
    /// consequential threshold decision and always routes to
    /// `AcquireEvidence` (get a calibrated read first) rather than being
    /// evaluated against the thresholds directly.
    pub require_calibrated: bool,
}

impl ThresholdGatePolicy {
    pub fn validate(&self) -> Result<()> {
        if self.name.trim().is_empty() {
            bail!("threshold gate policy name must be nonempty");
        }
        for threshold in [self.hard_stop_at_least, self.continue_below] {
            if let Some(t) = threshold {
                if !(0.0..=1.0).contains(&t) {
                    bail!("thresholds must be within [0, 1]");
                }
            }
        }
        if let (Some(stop), Some(cont)) = (self.hard_stop_at_least, self.continue_below) {
            if cont > stop {
                bail!("continue_below must not exceed hard_stop_at_least");
            }
        }
        Ok(())
    }

    pub fn evaluate(&self, confidence: Confidence) -> Result<GateDecision> {
        self.validate()?;
        confidence.validate()?;
        if self.require_calibrated && !confidence.is_calibrated() {
            return Ok(GateDecision::AcquireEvidence);
        }
        let value = confidence.value();
        if let Some(stop_at) = self.hard_stop_at_least {
            if value >= stop_at {
                return Ok(GateDecision::Escalate);
            }
        }
        if let Some(continue_below) = self.continue_below {
            if value < continue_below {
                return Ok(GateDecision::Continue);
            }
        }
        Ok(GateDecision::AcquireEvidence)
    }
}

/// Resolves a `CalibrationProfileRef` to the `CalibrationProfile` that
/// produced it. Provider-neutral, versioned, immutable-once-registered —
/// same posture as `DecisionTypeRegistry`.
#[async_trait]
pub(super) trait CalibrationProfileStore: Send + Sync {
    async fn get(
        &self,
        organization_id: u64,
        reference: &CalibrationProfileRef,
    ) -> Result<Option<CalibrationProfile>>;
}

/// Reference implementation for tests. Production wiring binds to
/// `StdbCalibrationProfileStore` instead.
pub(super) struct InMemoryCalibrationProfileStore {
    profiles: RwLock<HashMap<(String, u32), CalibrationProfile>>,
}

impl InMemoryCalibrationProfileStore {
    pub fn new() -> Self {
        Self {
            profiles: RwLock::new(HashMap::new()),
        }
    }

    pub fn register(&self, profile: CalibrationProfile) -> Result<()> {
        profile.validate()?;
        let key = (profile.profile_ref.name.clone(), profile.profile_ref.version);
        self.profiles.write().unwrap().insert(key, profile);
        Ok(())
    }
}

impl Default for InMemoryCalibrationProfileStore {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl CalibrationProfileStore for InMemoryCalibrationProfileStore {
    async fn get(
        &self,
        _organization_id: u64,
        reference: &CalibrationProfileRef,
    ) -> Result<Option<CalibrationProfile>> {
        Ok(self
            .profiles
            .read()
            .unwrap()
            .get(&(reference.name.clone(), reference.version))
            .cloned())
    }
}

/// Production implementation, reading the durable `ai_calibration_profile`
/// table (`spacetimedb/src/ai/calibration_profile.rs`) a
/// `register_ai_calibration_profile` call populates. The table is public,
/// so any connected reader can query it — unlike the ledger-style private
/// tables elsewhere in this module tree, no dedicated read principal is
/// needed.
pub(super) struct StdbCalibrationProfileStore<'a> {
    pub reader: &'a StdbClient,
}

#[async_trait]
impl CalibrationProfileStore for StdbCalibrationProfileStore<'_> {
    async fn get(
        &self,
        organization_id: u64,
        reference: &CalibrationProfileRef,
    ) -> Result<Option<CalibrationProfile>> {
        if organization_id == 0 {
            bail!("organization_id must be nonzero");
        }
        reference.validate()?;
        let name = reference.name.replace('\'', "''");
        let rows = self
            .reader
            .query_sql(&format!(
                "SELECT * FROM ai_calibration_profile WHERE organization_id = {organization_id} \
                 AND profile_name = '{name}' AND profile_version = {} \
                 AND is_active = true LIMIT 1",
                reference.version
            ))
            .await
            .context("query durable calibration profile")?;
        rows.first().map(decode_calibration_profile).transpose()
    }
}

fn decode_calibration_profile(row: &Value) -> Result<CalibrationProfile> {
    let name = calibration_row_string(row, "profileName")
        .context("calibration profile row missing profileName")?;
    let version = calibration_row_u64(row, "profileVersion")
        .context("calibration profile row missing profileVersion")? as u32;
    let breakpoints_json = calibration_row_string(row, "breakpointsJson")
        .context("calibration profile row missing breakpointsJson")?;
    let raw_pairs: Vec<(f64, f64)> = serde_json::from_str(&breakpoints_json)
        .context("decode calibration profile breakpoints_json")?;
    let profile = CalibrationProfile {
        profile_ref: CalibrationProfileRef { name, version },
        breakpoints: raw_pairs,
    };
    profile.validate()?;
    Ok(profile)
}

fn calibration_row_field<'a>(row: &'a Value, key: &str) -> Option<&'a Value> {
    row.get(key).or_else(|| row.get(snake_case(key)))
}

fn snake_case(key: &str) -> String {
    let mut out = String::with_capacity(key.len() + 4);
    for ch in key.chars() {
        if ch.is_ascii_uppercase() {
            out.push('_');
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

fn calibration_row_string(row: &Value, key: &str) -> Option<String> {
    calibration_row_field(row, key)
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn calibration_row_u64(row: &Value, key: &str) -> Option<u64> {
    calibration_row_field(row, key).and_then(|value| {
        value
            .as_u64()
            .or_else(|| value.as_str().and_then(|raw| raw.parse().ok()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn profile_ref() -> CalibrationProfileRef {
        CalibrationProfileRef {
            name: "fraud-model-v1".to_string(),
            version: 1,
        }
    }

    fn identity_profile() -> CalibrationProfile {
        CalibrationProfile {
            profile_ref: profile_ref(),
            breakpoints: vec![(0.0, 0.0), (1.0, 1.0)],
        }
    }

    #[test]
    fn confidence_out_of_range_is_rejected() {
        assert!(Confidence::Raw(1.5).validate().is_err());
        assert!(Confidence::Calibrated(-0.1).validate().is_err());
        assert!(Confidence::Raw(0.5).validate().is_ok());
    }

    #[test]
    fn probabilistic_calibrated_confidence_requires_a_profile_ref() {
        let mut value: Probabilistic<&str> = Probabilistic {
            value: "flag",
            confidence: Some(Confidence::Calibrated(0.9)),
            distribution: None,
            calibration_profile: None,
            evidence_refs: vec![],
        };
        assert!(value.validate().is_err());
        value.calibration_profile = Some(profile_ref());
        assert!(value.validate().is_ok());
    }

    #[test]
    fn probabilistic_raw_confidence_needs_no_profile_ref() {
        let value: Probabilistic<&str> = Probabilistic {
            value: "flag",
            confidence: Some(Confidence::Raw(0.5)),
            distribution: None,
            calibration_profile: None,
            evidence_refs: vec![],
        };
        assert!(value.validate().is_ok());
    }

    #[test]
    fn calibration_profile_requires_full_zero_to_one_coverage() {
        let mut profile = identity_profile();
        profile.breakpoints = vec![(0.1, 0.1), (1.0, 1.0)];
        assert!(profile.validate().is_err());

        profile.breakpoints = vec![(0.0, 0.0), (0.9, 0.9)];
        assert!(profile.validate().is_err());
    }

    #[test]
    fn calibration_profile_requires_strictly_increasing_breakpoints() {
        let mut profile = identity_profile();
        profile.breakpoints = vec![(0.0, 0.0), (0.5, 0.5), (0.5, 0.6), (1.0, 1.0)];
        assert!(profile.validate().is_err());
    }

    #[test]
    fn identity_profile_calibrates_to_the_same_value() {
        let profile = identity_profile();
        let calibrated = profile.calibrate(Confidence::Raw(0.42)).unwrap();
        assert_eq!(calibrated, Confidence::Calibrated(0.42));
    }

    #[test]
    fn calibration_interpolates_between_breakpoints() {
        let profile = CalibrationProfile {
            profile_ref: profile_ref(),
            // A model that reports 0.5 is actually only 30% likely — this
            // profile pulls midrange confidence down, a common overconfidence
            // correction.
            breakpoints: vec![(0.0, 0.0), (0.5, 0.3), (1.0, 1.0)],
        };
        let calibrated = profile.calibrate(Confidence::Raw(0.25)).unwrap();
        match calibrated {
            Confidence::Calibrated(v) => assert!((v - 0.15).abs() < 1e-9, "got {v}"),
            other => panic!("expected Calibrated, got {other:?}"),
        }
    }

    #[test]
    fn calibrating_an_already_calibrated_value_is_rejected() {
        let profile = identity_profile();
        assert!(profile.calibrate(Confidence::Calibrated(0.5)).is_err());
    }

    #[test]
    fn threshold_policy_escalates_at_or_above_hard_stop() {
        let policy = ThresholdGatePolicy {
            name: "fraud-review".to_string(),
            hard_stop_at_least: Some(0.8),
            continue_below: Some(0.2),
            require_calibrated: false,
        };
        assert_eq!(
            policy.evaluate(Confidence::Raw(0.8)).unwrap(),
            GateDecision::Escalate
        );
        assert_eq!(
            policy.evaluate(Confidence::Raw(0.95)).unwrap(),
            GateDecision::Escalate
        );
    }

    #[test]
    fn threshold_policy_continues_below_floor() {
        let policy = ThresholdGatePolicy {
            name: "fraud-review".to_string(),
            hard_stop_at_least: Some(0.8),
            continue_below: Some(0.2),
            require_calibrated: false,
        };
        assert_eq!(
            policy.evaluate(Confidence::Raw(0.1)).unwrap(),
            GateDecision::Continue
        );
    }

    #[test]
    fn threshold_policy_acquires_evidence_in_the_uncertainty_band() {
        let policy = ThresholdGatePolicy {
            name: "fraud-review".to_string(),
            hard_stop_at_least: Some(0.8),
            continue_below: Some(0.2),
            require_calibrated: false,
        };
        assert_eq!(
            policy.evaluate(Confidence::Raw(0.5)).unwrap(),
            GateDecision::AcquireEvidence
        );
    }

    #[test]
    fn threshold_policy_never_trusts_raw_confidence_when_calibration_is_required() {
        let policy = ThresholdGatePolicy {
            name: "fraud-review".to_string(),
            hard_stop_at_least: Some(0.1), // would otherwise escalate immediately
            continue_below: None,
            require_calibrated: true,
        };
        assert_eq!(
            policy.evaluate(Confidence::Raw(0.99)).unwrap(),
            GateDecision::AcquireEvidence
        );
        assert_eq!(
            policy.evaluate(Confidence::Calibrated(0.99)).unwrap(),
            GateDecision::Escalate
        );
    }

    #[test]
    fn threshold_policy_rejects_inverted_thresholds() {
        let policy = ThresholdGatePolicy {
            name: "broken".to_string(),
            hard_stop_at_least: Some(0.3),
            continue_below: Some(0.5),
            require_calibrated: false,
        };
        assert!(policy.evaluate(Confidence::Raw(0.4)).is_err());
    }

    #[test]
    fn threshold_policy_rejects_out_of_range_thresholds() {
        let policy = ThresholdGatePolicy {
            name: "broken".to_string(),
            hard_stop_at_least: Some(1.5),
            continue_below: None,
            require_calibrated: false,
        };
        assert!(policy.evaluate(Confidence::Raw(0.4)).is_err());
    }

    #[test]
    fn threshold_policy_rejects_empty_name() {
        let policy = ThresholdGatePolicy {
            name: String::new(),
            hard_stop_at_least: Some(0.8),
            continue_below: Some(0.2),
            require_calibrated: false,
        };
        assert!(policy.evaluate(Confidence::Raw(0.5)).is_err());
    }

    #[tokio::test]
    async fn in_memory_calibration_store_round_trips_a_registered_profile() {
        let store = InMemoryCalibrationProfileStore::new();
        let profile = CalibrationProfile {
            profile_ref: profile_ref(),
            breakpoints: vec![(0.0, 0.0), (1.0, 1.0)],
        };
        store.register(profile.clone()).unwrap();

        let found = store.get(9, &profile_ref()).await.unwrap().unwrap();
        assert_eq!(found.breakpoints, profile.breakpoints);

        let missing = store
            .get(
                9,
                &CalibrationProfileRef {
                    name: "does-not-exist".to_string(),
                    version: 1,
                },
            )
            .await
            .unwrap();
        assert!(missing.is_none());
    }

    #[test]
    fn in_memory_calibration_store_rejects_registering_an_invalid_profile() {
        let store = InMemoryCalibrationProfileStore::new();
        let mut invalid = identity_profile();
        invalid.breakpoints = vec![(0.1, 0.1)];
        assert!(store.register(invalid).is_err());
    }

    #[test]
    fn decode_calibration_profile_reads_camel_case_fields() {
        let row = json!({
            "profileName": "fraud-model-v1",
            "profileVersion": 1,
            "breakpointsJson": "[[0.0,0.0],[1.0,1.0]]",
        });
        let profile = decode_calibration_profile(&row).unwrap();
        assert_eq!(profile.profile_ref, profile_ref());
        assert_eq!(profile.breakpoints, vec![(0.0, 0.0), (1.0, 1.0)]);
    }

    #[test]
    fn decode_calibration_profile_falls_back_to_snake_case_fields() {
        let row = json!({
            "profile_name": "fraud-model-v1",
            "profile_version": 1,
            "breakpoints_json": "[[0.0,0.0],[1.0,1.0]]",
        });
        let profile = decode_calibration_profile(&row).unwrap();
        assert_eq!(profile.profile_ref, profile_ref());
    }

    #[test]
    fn decode_calibration_profile_rejects_invalid_breakpoints() {
        let row = json!({
            "profileName": "fraud-model-v1",
            "profileVersion": 1,
            // Doesn't cover raw = 1.0 — CalibrationProfile::validate rejects it.
            "breakpointsJson": "[[0.0,0.0],[0.5,0.5]]",
        });
        assert!(decode_calibration_profile(&row).is_err());
    }
}
