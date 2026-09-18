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
//! This module does not itself gate a `DecisionGraph` node (GP-08) or
//! execute anything — `ThresholdGatePolicy::evaluate` is a pure function
//! callers can use once GP-12 builds a real executor. It replaces the
//! *idea* of hardcoding a threshold literal directly in a `GateCondition`
//! (GP-08's `GateCondition::ProbabilityAtLeast(f64)` still does that
//! today) with a policy object; wiring `GateCondition` to reference a
//! `ThresholdGatePolicy` by name instead of a literal is a natural
//! follow-up, not done here to avoid reopening already-committed,
//! already-tested GP-08 code in the same pass.

use anyhow::{bail, Context, Result};
use serde_json::Value;

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
