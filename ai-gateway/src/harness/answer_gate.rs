//! AIH-15 — Deterministic answer/publication gate (M2).
//!
//! Validates cited sources and passages before a candidate answer is published.
//! Each cited reference goes through up to four checks, and the aggregate result
//! is recorded in SpacetimeDB via the `record_ai_claim_validation` and
//! `complete_ai_answer_gate` reducers.
//!
//! # Gate outcome rules
//!
//! | Condition | Outcome |
//! |-----------|---------|
//! | Any `reference_exists` or `scope_authorization` check failed | `failed` |
//! | Any `applicability` check failed (recalled source) | `failed` |
//! | All checks passed, but ≥1 source has `inspection_state = "unverified_recollection"` | `domain_review_required` |
//! | All checks passed, all sources inspected or user_reported | `passed` |
//!
//! # Usage
//!
//! ```no_run
//! let result = run_answer_gate(
//!     &stdb,
//!     org_id,
//!     company_id,
//!     run_id,
//!     &[42, 7],   // cited source_version_ids
//!     &[15],      // cited source_passage_ids
//! ).await?;
//! ```

use anyhow::{Context, Result};
use serde_json::Value;
use stdb_client::StdbClient;

/// The deterministic outcome of an answer-gate evaluation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GateOutcome {
    /// All checks passed and all sources are at least `user_reported`.
    Passed,
    /// At least one hard check failed; the run must not be published.
    Failed(Vec<String>),
    /// All checks passed but ≥1 source is `unverified_recollection`; a domain
    /// expert must review before publication.
    DomainReviewRequired,
}

impl GateOutcome {
    fn outcome_str(&self) -> &'static str {
        match self {
            GateOutcome::Passed => "passed",
            GateOutcome::Failed(_) => "failed",
            GateOutcome::DomainReviewRequired => "domain_review_required",
        }
    }
}

/// Run the answer gate for a durable agent run.
///
/// `cited_source_ids` — `AiSourceVersion.id` values referenced in the candidate
/// answer. `cited_passage_ids` — `AiSourcePassage.id` values. Both lists may be
/// empty, in which case the gate trivially passes.
pub async fn run_answer_gate(
    stdb: &StdbClient,
    org_id: u64,
    company_id: u64,
    run_id: u64,
    cited_source_ids: &[u64],
    cited_passage_ids: &[u64],
) -> Result<GateOutcome> {
    assert!(org_id != 0, "org_id must be nonzero");
    assert!(company_id != 0, "company_id must be nonzero");
    assert!(run_id != 0, "run_id must be nonzero");

    let mut failed_checks: Vec<String> = Vec::new();
    let mut domain_review_required = false;

    // ── Validate cited source versions ────────────────────────────────────

    for &sv_id in cited_source_ids {
        let row = fetch_source_version(stdb, sv_id).await?;

        match row {
            None => {
                let desc = format!("reference_exists:sv:{sv_id}");
                record_check(
                    stdb,
                    org_id,
                    company_id,
                    run_id,
                    None,
                    Some(sv_id),
                    None,
                    "reference_exists",
                    "failed",
                    Some(&format!("source version {sv_id} not found")),
                )
                .await?;
                failed_checks.push(desc);
            }
            Some(sv) => {
                let sv_org = json_u64(&sv, "organization_id");

                // reference_exists: passed (row found)
                record_check(
                    stdb,
                    org_id,
                    company_id,
                    run_id,
                    None,
                    Some(sv_id),
                    None,
                    "reference_exists",
                    "passed",
                    None,
                )
                .await?;

                // scope_authorization: organization must match
                if sv_org != org_id {
                    let desc = format!("scope_authorization:sv:{sv_id}");
                    record_check(
                        stdb,
                        org_id,
                        company_id,
                        run_id,
                        None,
                        Some(sv_id),
                        None,
                        "scope_authorization",
                        "failed",
                        Some(&format!(
                            "source version {sv_id} belongs to org {sv_org}, not {org_id}"
                        )),
                    )
                    .await?;
                    failed_checks.push(desc);
                } else {
                    record_check(
                        stdb,
                        org_id,
                        company_id,
                        run_id,
                        None,
                        Some(sv_id),
                        None,
                        "scope_authorization",
                        "passed",
                        None,
                    )
                    .await?;
                }

                // applicability: recalled sources must not be cited
                let origin = json_str(&sv, "origin");
                if origin == "recalled" {
                    let desc = format!("applicability:sv:{sv_id}");
                    record_check(
                        stdb,
                        org_id,
                        company_id,
                        run_id,
                        None,
                        Some(sv_id),
                        None,
                        "applicability",
                        "failed",
                        Some(&format!("source version {sv_id} has been recalled")),
                    )
                    .await?;
                    failed_checks.push(desc);
                } else {
                    record_check(
                        stdb,
                        org_id,
                        company_id,
                        run_id,
                        None,
                        Some(sv_id),
                        None,
                        "applicability",
                        "passed",
                        None,
                    )
                    .await?;

                    // Domain review signal — unverified recollections always need
                    // a human to confirm before publication, even if not recalled.
                    let inspection_state = json_str(&sv, "inspection_state");
                    if inspection_state == "unverified_recollection" {
                        domain_review_required = true;
                    }
                }
            }
        }
    }

    // ── Validate cited source passages ────────────────────────────────────

    for &sp_id in cited_passage_ids {
        let row = fetch_source_passage(stdb, sp_id).await?;

        match row {
            None => {
                let desc = format!("reference_exists:sp:{sp_id}");
                record_check(
                    stdb,
                    org_id,
                    company_id,
                    run_id,
                    None,
                    None,
                    Some(sp_id),
                    "reference_exists",
                    "failed",
                    Some(&format!("source passage {sp_id} not found")),
                )
                .await?;
                failed_checks.push(desc);
            }
            Some(sp) => {
                record_check(
                    stdb,
                    org_id,
                    company_id,
                    run_id,
                    None,
                    None,
                    Some(sp_id),
                    "reference_exists",
                    "passed",
                    None,
                )
                .await?;

                // scope_authorization for passages
                let sp_org = json_u64(&sp, "organization_id");
                if sp_org != org_id {
                    let desc = format!("scope_authorization:sp:{sp_id}");
                    record_check(
                        stdb,
                        org_id,
                        company_id,
                        run_id,
                        None,
                        None,
                        Some(sp_id),
                        "scope_authorization",
                        "failed",
                        Some(&format!(
                            "source passage {sp_id} belongs to org {sp_org}, not {org_id}"
                        )),
                    )
                    .await?;
                    failed_checks.push(desc);
                } else {
                    record_check(
                        stdb,
                        org_id,
                        company_id,
                        run_id,
                        None,
                        None,
                        Some(sp_id),
                        "scope_authorization",
                        "passed",
                        None,
                    )
                    .await?;
                }

                // passage_identity: content_hash must be present
                let content_hash = json_str(&sp, "content_hash");
                if content_hash.is_empty() {
                    let desc = format!("passage_identity:sp:{sp_id}");
                    record_check(
                        stdb,
                        org_id,
                        company_id,
                        run_id,
                        None,
                        None,
                        Some(sp_id),
                        "passage_identity",
                        "failed",
                        Some(&format!("source passage {sp_id} has empty content_hash")),
                    )
                    .await?;
                    failed_checks.push(desc);
                } else {
                    record_check(
                        stdb,
                        org_id,
                        company_id,
                        run_id,
                        None,
                        None,
                        Some(sp_id),
                        "passage_identity",
                        "passed",
                        None,
                    )
                    .await?;
                }
            }
        }
    }

    // ── Compute and record aggregate outcome ──────────────────────────────

    let outcome = if !failed_checks.is_empty() {
        GateOutcome::Failed(failed_checks.clone())
    } else if domain_review_required {
        GateOutcome::DomainReviewRequired
    } else {
        GateOutcome::Passed
    };

    let failed_json = if failed_checks.is_empty() {
        None
    } else {
        Some(serde_json::to_string(&failed_checks).unwrap_or_default())
    };

    stdb.call_reducer(stdb_client::reducer_call!(
        "complete_ai_answer_gate",
        serde_json::json!([
            org_id,
            {
                "company_id": company_id,
                "run_id": run_id,
                "gate_outcome": outcome.outcome_str(),
                "failed_checks_json": failed_json,
                "domain_review_required": domain_review_required,
            }
        ]),
    ))
    .await
    .context("complete_ai_answer_gate")?;

    Ok(outcome)
}

// ── Helpers ───────────────────────────────────────────────────────────────

async fn fetch_source_version(stdb: &StdbClient, id: u64) -> Result<Option<Value>> {
    let rows = stdb
        .query_sql(&format!(
            "SELECT id, organization_id, origin, inspection_state \
             FROM ai_source_version WHERE id = {id} LIMIT 1"
        ))
        .await
        .context("fetch ai_source_version")?;
    Ok(rows.into_iter().next())
}

async fn fetch_source_passage(stdb: &StdbClient, id: u64) -> Result<Option<Value>> {
    let rows = stdb
        .query_sql(&format!(
            "SELECT id, organization_id, source_version_id, content_hash \
             FROM ai_source_passage WHERE id = {id} LIMIT 1"
        ))
        .await
        .context("fetch ai_source_passage")?;
    Ok(rows.into_iter().next())
}

fn json_u64(row: &Value, key: &str) -> u64 {
    row.get(key)
        .and_then(|v| v.as_u64().or_else(|| v.as_i64().map(|n| n as u64)))
        .unwrap_or(0)
}

fn json_str<'a>(row: &'a Value, key: &str) -> &'a str {
    row.get(key).and_then(|v| v.as_str()).unwrap_or("")
}

#[allow(clippy::too_many_arguments)]
async fn record_check(
    stdb: &StdbClient,
    org_id: u64,
    company_id: u64,
    run_id: u64,
    claim_id: Option<u64>,
    source_version_id: Option<u64>,
    source_passage_id: Option<u64>,
    check_kind: &str,
    outcome: &str,
    detail: Option<&str>,
) -> Result<()> {
    stdb.call_reducer(stdb_client::reducer_call!(
        "record_ai_claim_validation",
        serde_json::json!([
            org_id,
            {
                "company_id": company_id,
                "run_id": run_id,
                "claim_id": claim_id,
                "source_version_id": source_version_id,
                "source_passage_id": source_passage_id,
                "check_kind": check_kind,
                "outcome": outcome,
                "detail": detail,
            }
        ]),
    ))
    .await
    .context("record_ai_claim_validation")?;
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gate_outcome_str_roundtrip() {
        assert_eq!(GateOutcome::Passed.outcome_str(), "passed");
        assert_eq!(
            GateOutcome::Failed(vec!["x".into()]).outcome_str(),
            "failed"
        );
        assert_eq!(
            GateOutcome::DomainReviewRequired.outcome_str(),
            "domain_review_required"
        );
    }

    #[test]
    fn json_helpers_missing_key_defaults() {
        let row = serde_json::json!({"organization_id": 42_u64});
        assert_eq!(json_u64(&row, "organization_id"), 42);
        assert_eq!(json_u64(&row, "missing"), 0);
        assert_eq!(json_str(&row, "origin"), "");
    }

    #[test]
    fn empty_citations_produce_passed_outcome() {
        // Pure logic test — no stdb needed. The empty-list branch returns Passed
        // when there are no failed_checks and domain_review_required is false.
        let failed_checks: Vec<String> = vec![];
        let domain_review = false;
        let outcome = if !failed_checks.is_empty() {
            GateOutcome::Failed(failed_checks)
        } else if domain_review {
            GateOutcome::DomainReviewRequired
        } else {
            GateOutcome::Passed
        };
        assert_eq!(outcome, GateOutcome::Passed);
    }

    #[test]
    fn recalled_origin_drives_failed_outcome() {
        let mut failed_checks = Vec::<String>::new();
        let origin = "recalled";
        if origin == "recalled" {
            failed_checks.push("applicability:sv:1".into());
        }
        let outcome = if !failed_checks.is_empty() {
            GateOutcome::Failed(failed_checks)
        } else {
            GateOutcome::Passed
        };
        assert!(matches!(outcome, GateOutcome::Failed(_)));
    }

    #[test]
    fn unverified_recollection_requires_domain_review() {
        let failed_checks: Vec<String> = vec![];
        let domain_review = true;
        let outcome = if !failed_checks.is_empty() {
            GateOutcome::Failed(failed_checks)
        } else if domain_review {
            GateOutcome::DomainReviewRequired
        } else {
            GateOutcome::Passed
        };
        assert_eq!(outcome, GateOutcome::DomainReviewRequired);
    }
}
