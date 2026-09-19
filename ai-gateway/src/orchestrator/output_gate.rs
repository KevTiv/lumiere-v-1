//! Shared admission boundary for prose emitted by output-oriented adapters.
//!
//! Governed programs already use `EvidenceGatedAnswerAdmission` directly for
//! their generated final drafts.  Legacy/output adapters do not have a
//! `FinalDraft` lifecycle, so they use this narrow wrapper.  It deliberately
//! reuses the same fail-closed text gate: unsupported output is withheld and
//! qualified output carries its limitations with the released text.

use anyhow::{Context, Result};
use serde::Serialize;
use stdb_client::StdbClient;

use super::{
    evidence_recorder::{PublicationEvidenceScope, StdbEvidenceRecorder},
    intelligence::{ClaimedCalculation, EvidenceRef, PassageCitation},
    text_answer_gate::{gate_text_answer, GatedTextAnswer, TextEvidence},
};

#[derive(Debug, Clone)]
pub(crate) struct PublicationIdentity {
    pub organization_id: u64,
    pub company_id: u64,
    pub session_ref: String,
    pub event_ref: String,
    pub note: String,
}

/// One material claim selected by the server-side output adapter.
///
/// A caller may only attach references that it also places in `TextEvidence`.
/// The gate rejects invented references and passage citations when no trusted
/// passage catalog is available.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GeneratedOutputClaim {
    pub text: String,
    #[serde(default)]
    pub support_refs: Vec<EvidenceRef>,
    #[serde(default)]
    pub passage_support: Vec<PassageCitation>,
}

/// Structured publication candidate for reports, artifacts, and explanations.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GeneratedOutputDraft {
    pub content: String,
    pub claims: Vec<GeneratedOutputClaim>,
    #[serde(default)]
    pub calculations: Vec<ClaimedCalculation>,
}

impl GeneratedOutputDraft {
    pub(crate) fn single_claim(content: impl Into<String>, support_refs: Vec<EvidenceRef>) -> Self {
        let content = content.into();
        Self {
            claims: vec![GeneratedOutputClaim {
                text: content.clone(),
                support_refs,
                passage_support: Vec::new(),
            }],
            content,
            calculations: Vec::new(),
        }
    }
}

/// Admit a generated explanation, report fragment, or artifact body.
///
/// Callers must provide only evidence the server produced.  In particular,
/// model citations or claims must not be copied into `TextEvidence`.
pub(crate) async fn admit_generated_output(
    organization_id: u64,
    company_id: u64,
    candidate: &str,
    evidence: &TextEvidence,
) -> Result<GatedTextAnswer> {
    gate_text_answer(organization_id, company_id, candidate, evidence).await
}

/// Admit a server-constructed structured publication candidate.
///
/// This is the preferred boundary for output adapters. It prevents adapters
/// from receiving an `Admitted` result merely because evidence happened to be
/// present: each material claim must explicitly select its support.
pub(crate) async fn admit_structured_output(
    organization_id: u64,
    company_id: u64,
    draft: &GeneratedOutputDraft,
    evidence: &TextEvidence,
) -> Result<GatedTextAnswer> {
    let candidate = serde_json::to_string(draft).context("serialize structured output draft")?;
    gate_text_answer(organization_id, company_id, &candidate, evidence).await
}

/// Persist the exact claim assessments produced by the publication gate.
///
/// Publication fails closed when the private evidence reader is unavailable or
/// recording fails. A released body must never claim durable provenance while
/// carrying no inspectable claim ids.
pub(crate) async fn persist_or_withhold_generated_output(
    gated: &mut GatedTextAnswer,
    writer: &StdbClient,
    reader: Option<&StdbClient>,
    identity: PublicationIdentity,
) {
    if gated.released.is_none() {
        return;
    }
    let Some(reader) = reader else {
        withhold_for_persistence(gated, "private evidence reader is not configured");
        return;
    };
    let recorder = StdbEvidenceRecorder { writer, reader };
    let scope = PublicationEvidenceScope {
        organization_id: identity.organization_id,
        company_id: identity.company_id,
        session_ref: identity.session_ref,
        event_ref: identity.event_ref,
        note: identity.note,
    };
    match recorder
        .record_publication(&scope, &gated.durable_provenance)
        .await
    {
        Ok(recorded) if !recorded.claim_ids.is_empty() => gated
            .provenance
            .mark_persisted(recorded.contribution_id, recorded.claim_ids),
        Ok(_) => withhold_for_persistence(gated, "publication produced no durable claims"),
        Err(error) => withhold_for_persistence(
            gated,
            &format!("publication provenance could not be recorded: {error:#}"),
        ),
    }
}

fn withhold_for_persistence(gated: &mut GatedTextAnswer, reason: &str) {
    gated.released = None;
    gated.verification = super::text_answer_gate::TextAnswerVerification {
        outcome: super::text_answer_gate::TextAnswerOutcome::RequiresReview,
        methods: gated.verification.methods.clone(),
        limitations: Vec::new(),
        reason: Some(reason.to_string()),
    };
    gated.provenance.redact_for_withholding(reason);
    gated.durable_provenance = Default::default();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::orchestrator::text_answer_gate::TextAnswerOutcome;
    use serde_json::json;

    #[tokio::test]
    async fn unsupported_output_is_withheld() {
        let result =
            admit_generated_output(1, 2, "Unverified report prose", &TextEvidence::default())
                .await
                .expect("gate result");
        assert_eq!(
            result.verification.outcome,
            TextAnswerOutcome::RequiresReview
        );
        assert!(result.released.is_none());
    }

    #[tokio::test]
    async fn unstructured_server_grounded_output_is_withheld() {
        let mut evidence = TextEvidence::default();
        evidence.add_ref("live_snapshot", "sale_order:42");
        evidence.add_json(&json!({"amount_total": 1250.5}));
        let result = admit_generated_output(1, 2, "Order total is $1,250.50.", &evidence)
            .await
            .expect("gate result");
        assert_eq!(
            result.verification.outcome,
            TextAnswerOutcome::RequiresReview
        );
        assert!(result.released.is_none());
    }

    #[tokio::test]
    async fn structured_server_grounded_output_is_released_with_claim_provenance() {
        let support = crate::orchestrator::intelligence::EvidenceRef {
            kind: "live_snapshot".to_string(),
            id: "sale_order:42".to_string(),
        };
        let mut evidence = TextEvidence::default();
        evidence.refs.push(support.clone());
        evidence.add_json(&json!({"amount_total": 1250.5}));
        let draft = GeneratedOutputDraft::single_claim("Order total is $1,250.50.", vec![support]);
        let result = admit_structured_output(1, 2, &draft, &evidence)
            .await
            .expect("gate result");
        assert_eq!(result.verification.outcome, TextAnswerOutcome::Admitted);
        assert_eq!(result.released.as_deref(), Some(draft.content.as_str()));
        assert_eq!(result.provenance.claims.len(), 1);
        assert_eq!(
            result.provenance.claims[0].verification_outcome,
            "traceable"
        );
    }

    #[tokio::test]
    async fn persistence_failure_withholds_and_redacts_an_admitted_body() {
        let support = crate::orchestrator::intelligence::EvidenceRef {
            kind: "live_snapshot".to_string(),
            id: "sale_order:42".to_string(),
        };
        let mut evidence = TextEvidence::default();
        evidence.refs.push(support.clone());
        let draft = GeneratedOutputDraft::single_claim("Sensitive claim.", vec![support]);
        let mut result = admit_structured_output(1, 2, &draft, &evidence)
            .await
            .expect("gate result");

        withhold_for_persistence(&mut result, "recording unavailable");

        assert!(result.released.is_none());
        assert_eq!(
            result.verification.outcome,
            TextAnswerOutcome::RequiresReview
        );
        assert!(result.provenance.claims.is_empty());
        assert!(result.provenance.claim_ids.is_empty());
        assert!(!serde_json::to_string(&result.provenance)
            .expect("serialize provenance")
            .contains("Sensitive claim"));
    }
}
