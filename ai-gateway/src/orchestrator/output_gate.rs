//! Shared admission boundary for prose emitted by output-oriented adapters.
//!
//! Governed programs already use `EvidenceGatedAnswerAdmission` directly for
//! their generated final drafts.  Legacy/output adapters do not have a
//! `FinalDraft` lifecycle, so they use this narrow wrapper.  It deliberately
//! reuses the same fail-closed text gate: unsupported output is withheld and
//! qualified output carries its limitations with the released text.

use anyhow::Result;

use super::text_answer_gate::{gate_text_answer, GatedTextAnswer, TextEvidence};

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
    async fn server_grounded_output_is_released() {
        let mut evidence = TextEvidence::default();
        evidence.add_ref("live_snapshot", "sale_order:42");
        evidence.add_json(&json!({"amount_total": 1250.5}));
        let result = admit_generated_output(1, 2, "Order total is $1,250.50.", &evidence)
            .await
            .expect("gate result");
        assert_eq!(result.verification.outcome, TextAnswerOutcome::Admitted);
        assert_eq!(
            result.released.as_deref(),
            Some("Order total is $1,250.50.")
        );
    }
}
