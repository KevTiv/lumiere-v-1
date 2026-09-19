//! AIH-14 gateway wiring: persist an answer's provenance.
//!
//! The §7.3 gate (`answer_gate`) decides whether an answer may be released and,
//! while doing so, learns exactly how each material claim fared: which
//! current passages it rests on, and whether the support was checked
//! deterministically, judged by a model, or never checked. Until now that was
//! reduced to one admission outcome and lost. This module writes it down as
//! `ai_evidence_claim` rows introduced by an `ai_evidence_contribution` for the
//! run, so an answer can be inspected claim by claim
//! (`evidence_inspector`) and its evidence can be invalidated when a source
//! changes (AIH-18).
//!
//! # What is and is not claimed
//!
//! - The contributor is the *agent run*, recorded through the gateway's
//!   service identity. A user's own contribution needs the user's session
//!   identity and belongs to the BFF, not here.
//! - A model's verdict is recorded `model_assisted`. Only a human reviewer can
//!   produce `human_reviewed` (`review_ai_evidence_claim`), and no claim
//!   recorded here can reach it.
//! - A claim whose passages are no longer current is recorded as an
//!   *unsupported inference*, never as sourced fact.
//! - Recording is idempotent per run: a retry finds the run's contribution and
//!   each already-recorded statement and does not duplicate them.

use anyhow::{Context, Result};
use async_trait::async_trait;
use serde::Serialize;
use serde_json::{json, Value};
use stdb_client::StdbClient;

use super::answer_gate::{
    AnswerProvenance, CalculationAssessment, ClaimAssessment, ClaimSupport, ClaimVerification,
    EvidenceGatedAnswerAdmission,
};
use super::governed_services::{
    AdmissionEvidence, AnswerAdmissionOutcome, AnswerAdmissionReport, FinalAnswerAdmission,
};
use super::intelligence::{EvidenceRef, FinalDraft};

/// Longest claim statement the module accepts.
const MAX_STATEMENT_CHARS: usize = 4_000;
const MAX_NOTE_CHARS: usize = 2_000;
/// Longest run of claims recorded for one answer, so a runaway draft cannot
/// turn one answer into an unbounded number of reducer calls.
const MAX_CLAIMS_RECORDED: usize = 64;

#[derive(Debug, Clone, Copy)]
pub(super) struct RunEvidenceScope {
    pub organization_id: u64,
    pub company_id: u64,
    pub run_id: u64,
}

impl RunEvidenceScope {
    /// The marker that ties an answer's contribution back to its run. It is a
    /// plain string column, so it can be looked up with SQL (`Option` columns
    /// cannot be filtered).
    fn session_ref(&self) -> String {
        format!("run:{}:final_answer", self.run_id)
    }

    fn calculation_ref(&self, index: usize) -> String {
        format!("run:{}:calc:{}", self.run_id, index + 1)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct RecordedEvidence {
    pub contribution_id: u64,
    pub claim_ids: Vec<u64>,
}

#[async_trait]
pub(super) trait AnswerEvidenceRecorder: Send + Sync {
    async fn record(
        &self,
        scope: &RunEvidenceScope,
        provenance: &AnswerProvenance,
    ) -> Result<RecordedEvidence>;
}

// ── Pure mapping ─────────────────────────────────────────────────────────────

/// What to persist for one claim. Every combination here is one
/// `record_ai_evidence_claim` accepts; see `validate_claim_params` in the module.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ClaimRecord {
    pub kind: &'static str,
    pub verification_method: &'static str,
    pub verification_outcome: &'static str,
    pub note: Option<String>,
}

pub(super) fn claim_record(assessment: &ClaimAssessment) -> ClaimRecord {
    let has_passages = !assessment.passage_ids.is_empty();
    let unsupported = |note: &str| ClaimRecord {
        // Nothing citable stands behind it: an unsupported inference is the
        // only honest description.
        kind: "inference",
        verification_method: "deterministic",
        verification_outcome: "unsupported",
        note: Some(note.to_string()),
    };
    match &assessment.verification {
        ClaimVerification::NoSupportCited => {
            unsupported("the answer cited no passage for this claim")
        }
        ClaimVerification::Unresolved => {
            unsupported("the cited passages did not resolve to recorded passages")
        }
        _ if !has_passages => {
            unsupported("the cited passages are no longer current and cannot support new work")
        }
        ClaimVerification::Unchecked => ClaimRecord {
            kind: "sourced_fact",
            verification_method: "none",
            verification_outcome: "unverified",
            note: Some("no semantic check ran for this claim".to_string()),
        },
        ClaimVerification::Model { support, rationale } => ClaimRecord {
            kind: "sourced_fact",
            verification_method: "model_assisted",
            verification_outcome: match support {
                ClaimSupport::Supported => "supported",
                ClaimSupport::Partial => "qualified",
                ClaimSupport::Unsupported => "unsupported",
            },
            note: Some(match rationale {
                Some(text) if !text.trim().is_empty() => {
                    format!("model-assisted check (not domain approval): {text}")
                }
                _ => "model-assisted check (not domain approval)".to_string(),
            }),
        },
    }
}

pub(super) fn calculation_record(assessment: &CalculationAssessment) -> ClaimRecord {
    ClaimRecord {
        kind: "calculation",
        verification_method: "deterministic",
        verification_outcome: if assessment.recomputes {
            "supported"
        } else {
            "unsupported"
        },
        note: Some(if assessment.recomputes {
            "recomputed from its operands".to_string()
        } else {
            "does not recompute from its operands".to_string()
        }),
    }
}

fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.trim().to_string()
    } else {
        let mut out: String = text.chars().take(max.saturating_sub(1)).collect();
        out.push('…');
        out.trim().to_string()
    }
}

/// An optional value as the module's wire format expects it.
fn opt<T: Serialize>(value: Option<T>) -> Value {
    match value {
        Some(inner) => json!({ "some": inner }),
        None => json!({ "none": [] }),
    }
}

fn contribution_params(scope: &RunEvidenceScope) -> Value {
    json!({
        "contributor_kind": "agent",
        "agent_run_id": opt(Some(scope.run_id)),
        "session_ref": scope.session_ref(),
        "turn_ref": opt::<String>(None),
        "event_ref": opt(Some("final_answer")),
        "introduced_kind": "concept",
        "source_version_id": opt::<u64>(None),
        // What the agent produced is model output, not an inspected source.
        "inspection_state": "unverified_recollection",
        "is_secondary_quotation": false,
        "note": opt(Some("final answer drafted by the governed program")),
    })
}

fn claim_params(
    statement: &str,
    passage_ids: &[u64],
    calculation_ref: Option<String>,
    contribution_id: u64,
    record: &ClaimRecord,
) -> Value {
    json!({
        "kind": record.kind,
        "statement": truncate_chars(statement, MAX_STATEMENT_CHARS),
        "supporting_passage_ids": passage_ids,
        "contradicting_passage_ids": Vec::<u64>::new(),
        "calculation_ref": opt(calculation_ref),
        "assumptions": Vec::<String>::new(),
        "contribution_id": opt(Some(contribution_id)),
        "verification_method": record.verification_method,
        "verification_outcome": record.verification_outcome,
        "verification_note": opt(record.note.as_deref().map(|note| truncate_chars(note, MAX_NOTE_CHARS))),
        "supersedes_claim_id": opt::<u64>(None),
    })
}

// ── STDB-backed recorder ─────────────────────────────────────────────────────

pub(super) struct StdbEvidenceRecorder<'a> {
    /// The gateway's service principal; its role must grant create on
    /// `ai_evidence_contribution` and `ai_evidence_claim`.
    pub writer: &'a StdbClient,
    /// Reads private tables to find what was already recorded.
    pub reader: &'a StdbClient,
}

impl StdbEvidenceRecorder<'_> {
    async fn contribution_id(&self, scope: &RunEvidenceScope) -> Result<Option<u64>> {
        let rows = self
            .reader
            .query_sql(&format!(
                "SELECT * FROM ai_evidence_contribution WHERE organization_id = {} \
                 AND session_ref = '{}' LIMIT 1",
                scope.organization_id,
                scope.session_ref()
            ))
            .await
            .context("look up run contribution")?;
        Ok(rows
            .first()
            .filter(|row| row.get("companyId").and_then(Value::as_u64) == Some(scope.company_id))
            .and_then(|row| row.get("id").and_then(Value::as_u64)))
    }

    /// The id of the claim with this exact statement under this contribution.
    /// `statement` is a plain string column, so it can be filtered in SQL;
    /// the contribution is then matched in Rust because `Option` columns
    /// cannot be.
    async fn claim_id(
        &self,
        scope: &RunEvidenceScope,
        contribution_id: u64,
        statement: &str,
    ) -> Result<Option<u64>> {
        let literal = statement.replace('\'', "''");
        let rows = self
            .reader
            .query_sql(&format!(
                "SELECT * FROM ai_evidence_claim WHERE organization_id = {} \
                 AND statement = '{literal}'",
                scope.organization_id
            ))
            .await
            .context("look up recorded claim")?;
        Ok(rows
            .iter()
            .filter(|row| {
                row.get("contributionId").and_then(Value::as_u64) == Some(contribution_id)
            })
            .filter_map(|row| row.get("id").and_then(Value::as_u64))
            .min())
    }

    async fn record_one(
        &self,
        scope: &RunEvidenceScope,
        contribution_id: u64,
        statement: &str,
        passage_ids: &[u64],
        calculation_ref: Option<String>,
        record: &ClaimRecord,
    ) -> Result<u64> {
        let statement = truncate_chars(statement, MAX_STATEMENT_CHARS);
        if let Some(existing) = self.claim_id(scope, contribution_id, &statement).await? {
            return Ok(existing);
        }
        self.writer
            .call_reducer(stdb_client::reducer_call!(
                "record_ai_evidence_claim",
                json!([
                    scope.organization_id,
                    scope.company_id,
                    claim_params(
                        &statement,
                        passage_ids,
                        calculation_ref,
                        contribution_id,
                        record
                    )
                ]),
            ))
            .await
            .context("record_ai_evidence_claim reducer failed")?;
        self.claim_id(scope, contribution_id, &statement)
            .await?
            .context("claim was recorded but could not be read back")
    }
}

#[async_trait]
impl AnswerEvidenceRecorder for StdbEvidenceRecorder<'_> {
    async fn record(
        &self,
        scope: &RunEvidenceScope,
        provenance: &AnswerProvenance,
    ) -> Result<RecordedEvidence> {
        if provenance.claims.is_empty() && provenance.calculations.is_empty() {
            // Nothing material to attribute; do not create an empty contribution.
            return Ok(RecordedEvidence {
                contribution_id: 0,
                claim_ids: Vec::new(),
            });
        }
        let contribution_id = match self.contribution_id(scope).await? {
            Some(id) => id,
            None => {
                self.writer
                    .call_reducer(stdb_client::reducer_call!(
                        "record_ai_evidence_contribution",
                        json!([
                            scope.organization_id,
                            scope.company_id,
                            contribution_params(scope)
                        ]),
                    ))
                    .await
                    .context("record_ai_evidence_contribution reducer failed")?;
                self.contribution_id(scope)
                    .await?
                    .context("contribution was recorded but could not be read back")?
            }
        };

        let mut claim_ids = Vec::new();
        for assessment in provenance.claims.iter().take(MAX_CLAIMS_RECORDED) {
            let record = claim_record(assessment);
            let passages: &[u64] = if record.kind == "sourced_fact" {
                &assessment.passage_ids
            } else {
                &[]
            };
            claim_ids.push(
                self.record_one(
                    scope,
                    contribution_id,
                    &assessment.text,
                    passages,
                    None,
                    &record,
                )
                .await?,
            );
        }
        for (index, calculation) in provenance.calculations.iter().enumerate() {
            let record = calculation_record(calculation);
            claim_ids.push(
                self.record_one(
                    scope,
                    contribution_id,
                    &format!("Calculation: {}", calculation.label),
                    &[],
                    Some(scope.calculation_ref(index)),
                    &record,
                )
                .await?,
            );
        }
        Ok(RecordedEvidence {
            contribution_id,
            claim_ids,
        })
    }
}

// ── Decorator over the gate ──────────────────────────────────────────────────

/// Wraps the evidence gate so a governed run persists the provenance of every
/// answer it judges. If provenance cannot be recorded the answer is not
/// silently released as fully traceable: an `Admitted`/`Qualified` outcome is
/// lowered to `RequiresReview`. A `Blocked` outcome stays blocked.
pub(super) struct RecordingAnswerAdmission<'a> {
    pub gate: &'a EvidenceGatedAnswerAdmission<'a>,
    pub recorder: &'a dyn AnswerEvidenceRecorder,
    pub scope: RunEvidenceScope,
    /// Claim ids recorded for the answer, in order, for the caller to surface.
    pub recorded: std::sync::Mutex<Vec<u64>>,
}

pub(super) fn lower_for_unrecorded_provenance(
    outcome: AnswerAdmissionOutcome,
    error: &str,
) -> AnswerAdmissionOutcome {
    match outcome {
        AnswerAdmissionOutcome::Admitted | AnswerAdmissionOutcome::Qualified { .. } => {
            AnswerAdmissionOutcome::RequiresReview {
                reason: format!("answer provenance could not be recorded: {error}"),
            }
        }
        other => other,
    }
}

#[async_trait]
impl FinalAnswerAdmission for RecordingAnswerAdmission<'_> {
    async fn admit(
        &self,
        draft: &FinalDraft,
        known_evidence: &std::collections::HashSet<EvidenceRef>,
    ) -> Result<AnswerAdmissionOutcome> {
        Ok(self
            .admit_with_report(
                draft,
                &AdmissionEvidence {
                    known: known_evidence,
                    data_figures: &[],
                },
            )
            .await?
            .outcome)
    }

    async fn admit_with_report(
        &self,
        draft: &FinalDraft,
        evidence: &AdmissionEvidence<'_>,
    ) -> Result<AnswerAdmissionReport> {
        let (mut report, provenance) = self.gate.evaluate(draft, evidence).await?;
        match self.recorder.record(&self.scope, &provenance).await {
            Ok(recorded) => {
                if let Ok(mut slot) = self.recorded.lock() {
                    *slot = recorded.claim_ids;
                }
            }
            Err(error) => {
                tracing::warn!(
                    run_id = self.scope.run_id,
                    error = %error,
                    "answer provenance was not recorded"
                );
                report.outcome =
                    lower_for_unrecorded_provenance(report.outcome, &format!("{error:#}"));
            }
        }
        Ok(report)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assessment(passage_ids: Vec<u64>, verification: ClaimVerification) -> ClaimAssessment {
        ClaimAssessment {
            text: "The VAT rate is 20%.".into(),
            passage_ids,
            verification,
        }
    }

    #[test]
    fn model_verdicts_are_recorded_model_assisted_and_never_human_reviewed() {
        for (support, outcome) in [
            (ClaimSupport::Supported, "supported"),
            (ClaimSupport::Partial, "qualified"),
            (ClaimSupport::Unsupported, "unsupported"),
        ] {
            let record = claim_record(&assessment(
                vec![7],
                ClaimVerification::Model {
                    support,
                    rationale: Some("matches section 3".into()),
                },
            ));
            assert_eq!(record.kind, "sourced_fact");
            assert_eq!(record.verification_method, "model_assisted");
            assert_eq!(record.verification_outcome, outcome);
            assert!(record.note.unwrap().contains("not domain approval"));
        }
    }

    #[test]
    fn unchecked_claims_are_unverified_never_supported() {
        let record = claim_record(&assessment(vec![7], ClaimVerification::Unchecked));
        assert_eq!(record.verification_method, "none");
        assert_eq!(record.verification_outcome, "unverified");
    }

    #[test]
    fn claims_without_current_support_are_unsupported_inferences() {
        for verification in [
            ClaimVerification::NoSupportCited,
            ClaimVerification::Unresolved,
        ] {
            let record = claim_record(&assessment(vec![], verification));
            assert_eq!(record.kind, "inference");
            assert_eq!(record.verification_outcome, "unsupported");
        }
        // A model "supported" verdict cannot make a claim sourced when none of
        // its passages is current any more.
        let record = claim_record(&assessment(
            vec![],
            ClaimVerification::Model {
                support: ClaimSupport::Supported,
                rationale: None,
            },
        ));
        assert_eq!(record.kind, "inference");
        assert_eq!(record.verification_outcome, "unsupported");
        assert!(record.note.unwrap().contains("no longer current"));
    }

    #[test]
    fn calculations_record_their_recomputation() {
        let ok = calculation_record(&CalculationAssessment {
            label: "net".into(),
            recomputes: true,
        });
        assert_eq!(
            (ok.kind, ok.verification_method, ok.verification_outcome),
            ("calculation", "deterministic", "supported")
        );
        let bad = calculation_record(&CalculationAssessment {
            label: "net".into(),
            recomputes: false,
        });
        assert_eq!(bad.verification_outcome, "unsupported");
    }

    #[test]
    fn statements_are_bounded_on_a_character_boundary() {
        let long = "é".repeat(MAX_STATEMENT_CHARS + 10);
        let truncated = truncate_chars(&long, MAX_STATEMENT_CHARS);
        assert_eq!(truncated.chars().count(), MAX_STATEMENT_CHARS);
        assert!(truncated.ends_with('…'));
        assert_eq!(truncate_chars("  short  ", 100), "short");
    }

    #[test]
    fn wire_params_use_tagged_options_and_carry_the_run_marker() {
        let scope = RunEvidenceScope {
            organization_id: 1,
            company_id: 2,
            run_id: 9,
        };
        let params = contribution_params(&scope);
        assert_eq!(params["contributor_kind"], "agent");
        assert_eq!(params["session_ref"], "run:9:final_answer");
        assert_eq!(params["agent_run_id"], json!({ "some": 9 }));
        assert_eq!(params["turn_ref"], json!({ "none": [] }));
        assert_eq!(params["inspection_state"], "unverified_recollection");

        let record = claim_record(&assessment(vec![3, 4], ClaimVerification::Unchecked));
        let claim = claim_params("A claim", &[3, 4], None, 5, &record);
        assert_eq!(claim["supporting_passage_ids"], json!([3, 4]));
        assert_eq!(claim["contribution_id"], json!({ "some": 5 }));
        assert_eq!(claim["calculation_ref"], json!({ "none": [] }));
        assert_eq!(claim["supersedes_claim_id"], json!({ "none": [] }));
    }

    #[test]
    fn unrecorded_provenance_lowers_a_release_but_never_a_block() {
        let lowered = lower_for_unrecorded_provenance(AnswerAdmissionOutcome::Admitted, "db down");
        assert!(matches!(
            lowered,
            AnswerAdmissionOutcome::RequiresReview { .. }
        ));
        let lowered = lower_for_unrecorded_provenance(
            AnswerAdmissionOutcome::Qualified {
                limitations: vec!["x".into()],
            },
            "db down",
        );
        assert!(matches!(
            lowered,
            AnswerAdmissionOutcome::RequiresReview { .. }
        ));
        let blocked = lower_for_unrecorded_provenance(
            AnswerAdmissionOutcome::Blocked {
                reason: "bad".into(),
            },
            "db down",
        );
        assert_eq!(
            blocked,
            AnswerAdmissionOutcome::Blocked {
                reason: "bad".into()
            }
        );
    }

    // ── Decorator over the real gate ────────────────────────────────────────

    use std::collections::HashSet;
    use std::sync::Mutex;

    use super::super::answer_gate::{
        text_hash, ClaimCoverageChecker, ClaimVerdict, GatePolicy, GateScope, PassageCatalog,
        PassageStatus, SourcePassage,
    };
    use super::super::intelligence::{MaterialClaim, PassageCitation};

    const AS_OF: i64 = 1_700_000_000_000_000;

    struct Catalog(Vec<SourcePassage>);

    #[async_trait]
    impl PassageCatalog for Catalog {
        async fn source_passages(
            &self,
            _organization_id: u64,
            _company_id: u64,
            kind: &str,
            source_key: &str,
        ) -> Result<Vec<SourcePassage>> {
            Ok(self
                .0
                .iter()
                .filter(|p| p.kind == kind && p.source_key == source_key)
                .cloned()
                .collect())
        }
    }

    struct Supports;
    #[async_trait]
    impl ClaimCoverageChecker for Supports {
        async fn check(&self, _claim: &str, _passages: &[&SourcePassage]) -> Result<ClaimVerdict> {
            Ok(ClaimVerdict {
                support: ClaimSupport::Supported,
                rationale: Some("quoted in s1".into()),
            })
        }
    }

    fn passage(id: u64, status: PassageStatus) -> SourcePassage {
        let text = "The standard VAT rate is 20 percent.";
        SourcePassage {
            id,
            kind: "policy".into(),
            source_key: "vat-guide".into(),
            version: "2".into(),
            passage_key: "s1".into(),
            content_hash: text_hash(text),
            text: text.into(),
            effective_from_micros: Some(AS_OF - 1_000),
            effective_to_micros: None,
            applicability: vec![],
            status,
        }
    }

    fn draft() -> FinalDraft {
        FinalDraft {
            content: "The standard VAT rate is 20 percent, and exports are exempt.".into(),
            citations: vec![],
            claims: vec![
                MaterialClaim {
                    text: "The standard VAT rate is 20 percent.".into(),
                    supports: vec![PassageCitation {
                        kind: "policy".into(),
                        id: "vat-guide".into(),
                        source_version: "2".into(),
                        passage_key: "s1".into(),
                    }],
                },
                MaterialClaim {
                    text: "Exports are exempt.".into(),
                    supports: vec![],
                },
            ],
            calculations: vec![],
        }
    }

    fn gate<'a>(
        catalog: &'a Catalog,
        checker: Option<&'a dyn ClaimCoverageChecker>,
    ) -> EvidenceGatedAnswerAdmission<'a> {
        EvidenceGatedAnswerAdmission {
            scope: GateScope {
                organization_id: 1,
                company_id: 2,
                as_of_micros: AS_OF,
                required_applicability: vec![],
            },
            policy: GatePolicy::default(),
            catalog,
            claim_checker: checker,
        }
    }

    #[derive(Default)]
    struct MemoryRecorder {
        seen: Mutex<Vec<AnswerProvenance>>,
    }

    #[async_trait]
    impl AnswerEvidenceRecorder for MemoryRecorder {
        async fn record(
            &self,
            _: &RunEvidenceScope,
            provenance: &AnswerProvenance,
        ) -> Result<RecordedEvidence> {
            self.seen.lock().unwrap().push(provenance.clone());
            Ok(RecordedEvidence {
                contribution_id: 1,
                claim_ids: (1..=provenance.claims.len() as u64).collect(),
            })
        }
    }

    struct FailingRecorder;
    #[async_trait]
    impl AnswerEvidenceRecorder for FailingRecorder {
        async fn record(
            &self,
            _: &RunEvidenceScope,
            _: &AnswerProvenance,
        ) -> Result<RecordedEvidence> {
            anyhow::bail!("stdb unavailable")
        }
    }

    fn scope() -> RunEvidenceScope {
        RunEvidenceScope {
            organization_id: 1,
            company_id: 2,
            run_id: 42,
        }
    }

    #[tokio::test]
    async fn the_gate_reports_which_current_passage_backs_each_claim() {
        let catalog = Catalog(vec![passage(5, PassageStatus::Current)]);
        let checker = Supports;
        let gate = gate(&catalog, Some(&checker));
        let recorder = MemoryRecorder::default();
        let admission = RecordingAnswerAdmission {
            gate: &gate,
            recorder: &recorder,
            scope: scope(),
            recorded: Mutex::new(Vec::new()),
        };
        let known = HashSet::new();
        let report = admission
            .admit_with_report(
                &draft(),
                &AdmissionEvidence {
                    known: &known,
                    data_figures: &[],
                },
            )
            .await
            .unwrap();

        let seen = recorder.seen.lock().unwrap();
        let provenance = &seen[0];
        assert_eq!(provenance.claims.len(), 2);
        assert_eq!(provenance.claims[0].passage_ids, vec![5]);
        assert!(matches!(
            provenance.claims[0].verification,
            ClaimVerification::Model {
                support: ClaimSupport::Supported,
                ..
            }
        ));
        assert_eq!(
            provenance.claims[1].verification,
            ClaimVerification::NoSupportCited
        );
        // The unsupported claim still qualifies the answer; recording changed nothing.
        assert!(
            matches!(report.outcome, AnswerAdmissionOutcome::Qualified { .. }),
            "{:?}",
            report.outcome
        );
        assert_eq!(*admission.recorded.lock().unwrap(), vec![1, 2]);
    }

    #[tokio::test]
    async fn a_withdrawn_passage_is_never_recorded_as_support() {
        let catalog = Catalog(vec![passage(5, PassageStatus::Withdrawn)]);
        let gate = gate(&catalog, None);
        let (_, provenance) = gate
            .evaluate(
                &draft(),
                &AdmissionEvidence {
                    known: &HashSet::new(),
                    data_figures: &[],
                },
            )
            .await
            .unwrap();
        assert!(provenance.claims[0].passage_ids.is_empty());
        // ...so it is persisted as an unsupported inference, not sourced fact.
        let record = claim_record(&provenance.claims[0]);
        assert_eq!(record.kind, "inference");
        assert_eq!(record.verification_outcome, "unsupported");
    }

    #[tokio::test]
    async fn failing_to_record_provenance_lowers_a_release_to_review() {
        let catalog = Catalog(vec![passage(5, PassageStatus::Current)]);
        let checker = Supports;
        let gate = gate(&catalog, Some(&checker));
        let mut only_supported = draft();
        only_supported.claims.truncate(1);
        let known = HashSet::new();
        let evidence = AdmissionEvidence {
            known: &known,
            data_figures: &[],
        };

        let healthy = MemoryRecorder::default();
        let ok = RecordingAnswerAdmission {
            gate: &gate,
            recorder: &healthy,
            scope: scope(),
            recorded: Mutex::new(Vec::new()),
        };
        let released = ok
            .admit_with_report(&only_supported, &evidence)
            .await
            .unwrap();
        assert!(
            !matches!(
                released.outcome,
                AnswerAdmissionOutcome::RequiresReview { .. }
            ),
            "{:?}",
            released.outcome
        );

        let broken = RecordingAnswerAdmission {
            gate: &gate,
            recorder: &FailingRecorder,
            scope: scope(),
            recorded: Mutex::new(Vec::new()),
        };
        let lowered = broken
            .admit_with_report(&only_supported, &evidence)
            .await
            .unwrap();
        match lowered.outcome {
            AnswerAdmissionOutcome::RequiresReview { reason } => {
                assert!(reason.contains("stdb unavailable"), "{reason}")
            }
            other => panic!("expected review, got {other:?}"),
        }
    }

    /// Records an answer's provenance into a real module and reads it back
    /// through the inspector. Needs a SpacetimeDB module that has run the
    /// `run_ai_intelligence_events_tests` reducer (which seeds agent runs):
    ///
    /// ```text
    /// STDB_URL=http://127.0.0.1:3000 STDB_MODULE=<db> STDB_TOKEN=<owner token> \
    ///   cargo test --bin gateway live_recorder -- --ignored
    /// ```
    #[tokio::test]
    #[ignore = "needs a live SpacetimeDB module seeded by run_ai_intelligence_events_tests"]
    async fn live_recorder_persists_claims_idempotently_and_they_inspect() {
        use super::super::evidence_inspector::{inspect, Availability, InspectTarget, Viewer};

        let env = |name: &str| std::env::var(name).unwrap_or_else(|_| panic!("{name} is required"));
        let client = StdbClient::new(env("STDB_URL"), env("STDB_MODULE"), env("STDB_TOKEN"));
        let num = |row: &Value, field: &str| row.get(field).and_then(Value::as_u64).unwrap();

        let runs = client
            .query_sql("SELECT * FROM ai_agent_run LIMIT 1")
            .await
            .unwrap();
        let run = runs.first().expect("a seeded agent run");
        let scope = RunEvidenceScope {
            organization_id: num(run, "organizationId"),
            company_id: num(run, "companyId"),
            run_id: num(run, "id"),
        };
        let (org, company) = (scope.organization_id, scope.company_id);

        // A source, an inspected version and a passage, written through the
        // same wire format the gateway uses everywhere.
        let key = format!("live-{}", chrono::Utc::now().timestamp_micros());
        client
            .call_reducer(stdb_client::reducer_call!(
                "record_ai_evidence_source",
                json!([org, company, {
                    "source_kind": "book", "source_key": key, "title": "Live Book",
                    "author_attribution": "known", "authors": ["Ada Author"],
                    "author_organization": opt::<String>(None),
                    "scope": "company", "retention_policy": "retain_snapshot",
                }]),
            ))
            .await
            .expect("record source");
        let sources = client
            .query_sql(&format!(
                "SELECT * FROM ai_evidence_source WHERE source_key = '{key}'"
            ))
            .await
            .unwrap();
        let source_id = num(&sources[0], "id");
        client
            .call_reducer(stdb_client::reducer_call!(
                "record_ai_evidence_source_version",
                json!([org, company, source_id, {
                    "version": "1", "edition": opt(Some("1st")),
                    "publication_date_micros": opt::<i64>(None), "uri": opt::<String>(None),
                    "retrieved_at_micros": opt::<i64>(None),
                    "content_hash": opt(Some("a".repeat(64))), "snapshot_ref": opt::<String>(None),
                    "origin": "book_paper", "verification": "inspected",
                    "supersedes_version_id": opt::<u64>(None),
                }]),
            ))
            .await
            .expect("record version");
        let versions = client
            .query_sql(&format!(
                "SELECT * FROM ai_evidence_source_version WHERE source_id = {source_id}"
            ))
            .await
            .unwrap();
        let version_id = num(&versions[0], "id");
        client
            .call_reducer(stdb_client::reducer_call!(
                "record_ai_evidence_passage",
                json!([org, company, {
                    "source_kind": "book", "source_key": key, "source_version": "1",
                    "passage_key": "p1", "passage_text": "Depreciation is straight line.",
                    "effective_from_micros": opt::<i64>(None), "effective_to_micros": opt::<i64>(None),
                    "applicability": Vec::<String>::new(),
                    "source_version_id": opt(Some(version_id)),
                    "coordinates": ["page:12"], "text_origin": "original",
                    "processor_ref": opt::<String>(None),
                }]),
            ))
            .await
            .expect("record passage");
        let passages = client
            .query_sql(&format!(
                "SELECT * FROM ai_evidence_passage WHERE source_key = '{key}'"
            ))
            .await
            .unwrap();
        let passage_id = num(&passages[0], "id");

        let provenance = AnswerProvenance {
            claims: vec![
                ClaimAssessment {
                    text: format!("Depreciation is straight line. ({key})"),
                    passage_ids: vec![passage_id],
                    verification: ClaimVerification::Model {
                        support: ClaimSupport::Supported,
                        rationale: Some("matches the passage".into()),
                    },
                },
                ClaimAssessment {
                    text: format!("Exports are exempt. ({key})"),
                    passage_ids: vec![],
                    verification: ClaimVerification::NoSupportCited,
                },
            ],
            calculations: vec![CalculationAssessment {
                label: format!("net {key}"),
                recomputes: true,
            }],
        };
        let recorder = StdbEvidenceRecorder {
            writer: &client,
            reader: &client,
        };

        let first = recorder
            .record(&scope, &provenance)
            .await
            .expect("first record");
        assert_eq!(first.claim_ids.len(), 3);
        // A retry (resume, replay) must not duplicate anything.
        let second = recorder
            .record(&scope, &provenance)
            .await
            .expect("second record");
        assert_eq!(second, first, "recording is idempotent per run");
        let contributions = client
            .query_sql(&format!(
                "SELECT * FROM ai_evidence_contribution WHERE session_ref = 'run:{}:final_answer'",
                scope.run_id
            ))
            .await
            .unwrap();
        assert_eq!(contributions.len(), 1);
        assert_eq!(contributions[0]["contributorKind"], "agent");
        assert_eq!(
            contributions[0]["inspectionState"],
            "unverified_recollection"
        );

        // What was stored is exactly what the mapping says.
        let viewer = Viewer {
            organization_id: org,
            company_id: company,
        };
        let supported = inspect(&client, viewer, InspectTarget::Claim(first.claim_ids[0]))
            .await
            .unwrap();
        let claim = &supported.claims[0];
        assert_eq!(claim.kind, "sourced_fact");
        assert_eq!(claim.verification_method, "model_assisted");
        assert_eq!(claim.verification_outcome, "supported");
        assert_ne!(claim.verification_method, "human_reviewed");
        assert_eq!(claim.supporting_passage_ids, vec![passage_id]);
        assert_eq!(supported.passages[0].availability, Availability::Available);
        assert_eq!(supported.sources[0].authors, vec!["Ada Author"]);
        // The introducing contribution is the agent run, not the author.
        assert_eq!(supported.contributions[0].contributor_kind, "agent");
        assert_eq!(supported.contributions[0].agent_run_id, Some(scope.run_id));

        let unsupported = inspect(&client, viewer, InspectTarget::Claim(first.claim_ids[1]))
            .await
            .unwrap();
        assert_eq!(unsupported.claims[0].kind, "inference");
        assert_eq!(unsupported.claims[0].verification_outcome, "unsupported");
        assert!(
            !unsupported.lineage_passes
                || unsupported
                    .findings
                    .iter()
                    .any(|f| f.code == "claim_unsupported")
        );

        let calculation = inspect(&client, viewer, InspectTarget::Claim(first.claim_ids[2]))
            .await
            .unwrap();
        assert_eq!(calculation.claims[0].kind, "calculation");
        assert_eq!(calculation.claims[0].verification_method, "deterministic");
    }

    #[test]
    fn scope_markers_are_stable() {
        let scope = scope();
        assert_eq!(scope.session_ref(), "run:42:final_answer");
        assert_eq!(scope.calculation_ref(0), "run:42:calc:1");
    }
}
