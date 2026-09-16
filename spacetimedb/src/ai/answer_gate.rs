//! AIH-15 — Claim validation and answer/publication gate (M2).
//!
//! Records per-reference validation checks and the aggregate gate decision for a
//! durable agent run. The gate produces one `AiAnswerGateResult` row per run and
//! one `AiClaimValidation` row per cited source or passage.
//!
//! Gate outcomes:
//! * `passed` — every check passed; the run may complete.
//! * `failed` — at least one hard check failed; the run stays held.
//! * `domain_review_required` — all checks passed, but one or more sources carry
//!   `inspection_state = "unverified_recollection"` and need human review.
//!
//! Check kinds:
//! * `reference_exists` — the cited source/passage resolves to a real row.
//! * `scope_authorization` — the row belongs to the requesting organization.
//! * `applicability` — the source has not been recalled (`origin != "recalled"`).
//! * `passage_identity` — the passage content_hash is non-empty (integrity signal).

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

const AUTO_INC_SENTINEL: u64 = 0;
const MAX_KIND_LEN: usize = 48;
const MAX_DETAIL_LEN: usize = 2000;

// ── Tables ─────────────────────────────────────────────────────────────────

/// Per-reference validation record for a single answer-gate check.
///
/// One row per `(run_id, check_kind, source_version_id | source_passage_id)` tuple
/// produced during a gate evaluation. The aggregate result lives in
/// `AiAnswerGateResult`.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_claim_validation,
    index(accessor = ai_claim_validation_by_org, btree(columns = [organization_id])),
    index(accessor = ai_claim_validation_by_run, btree(columns = [run_id]))
)]
pub struct AiClaimValidation {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    /// The durable agent run this check belongs to.
    pub run_id: u64,
    pub claim_id: Option<u64>,
    pub source_version_id: Option<u64>,
    pub source_passage_id: Option<u64>,
    /// `reference_exists` | `scope_authorization` | `applicability` | `passage_identity`
    pub check_kind: String,
    /// `passed` | `failed` | `skipped`
    pub outcome: String,
    /// Human-readable reason when `outcome = "failed"` or `"skipped"`.
    pub detail: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
}

/// Aggregate gate decision for a durable agent run.
///
/// Exactly one row per gate evaluation. Multiple evaluations on the same run
/// produce multiple rows; only the most recent is authoritative.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_answer_gate_result,
    index(accessor = ai_answer_gate_result_by_org, btree(columns = [organization_id])),
    index(accessor = ai_answer_gate_result_by_run, btree(columns = [run_id]))
)]
pub struct AiAnswerGateResult {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub run_id: u64,
    /// `passed` | `failed` | `domain_review_required`
    pub gate_outcome: String,
    /// JSON array of failed check descriptions, e.g. `["reference_exists:sv:42"]`.
    pub failed_checks_json: Option<String>,
    pub domain_review_required: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
}

// ── Params ─────────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordAiClaimValidationParams {
    pub company_id: Option<u64>,
    pub run_id: u64,
    pub claim_id: Option<u64>,
    pub source_version_id: Option<u64>,
    pub source_passage_id: Option<u64>,
    pub check_kind: String,
    pub outcome: String,
    pub detail: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CompleteAiAnswerGateParams {
    pub company_id: Option<u64>,
    pub run_id: u64,
    pub gate_outcome: String,
    pub failed_checks_json: Option<String>,
    pub domain_review_required: bool,
}

// ── Validation ─────────────────────────────────────────────────────────────

fn validate_check_kind(kind: &str) -> Result<String, String> {
    let k = kind.trim().to_lowercase();
    let allowed = [
        "reference_exists",
        "scope_authorization",
        "applicability",
        "passage_identity",
    ];
    if !allowed.contains(&k.as_str()) {
        return Err(format!("check_kind must be one of {}", allowed.join(", ")));
    }
    Ok(k)
}

fn validate_check_outcome(outcome: &str) -> Result<String, String> {
    let o = outcome.trim().to_lowercase();
    let allowed = ["passed", "failed", "skipped"];
    if !allowed.contains(&o.as_str()) {
        return Err(format!("outcome must be one of {}", allowed.join(", ")));
    }
    Ok(o)
}

fn validate_gate_outcome(outcome: &str) -> Result<String, String> {
    let o = outcome.trim().to_lowercase();
    let allowed = ["passed", "failed", "domain_review_required"];
    if !allowed.contains(&o.as_str()) {
        return Err(format!(
            "gate_outcome must be one of {}",
            allowed.join(", ")
        ));
    }
    Ok(o)
}

fn validate_optional_detail(value: &Option<String>, max: usize) -> Result<Option<String>, String> {
    match value {
        None => Ok(None),
        Some(raw) if raw.trim().is_empty() => Ok(None),
        Some(raw) if raw.trim().len() > max => Err(format!("detail exceeds {max} characters")),
        Some(raw) => Ok(Some(raw.trim().to_string())),
    }
}

// ── Reducers ───────────────────────────────────────────────────────────────

/// Record a single reference-validation check as part of an answer-gate pass.
///
/// Must be called once per `(run_id, check_kind, source_version_id | source_passage_id)`
/// tuple. The caller (ai-gateway harness) is responsible for deriving the
/// correct outcome from the referenced tables before calling this reducer.
#[reducer]
pub fn record_ai_claim_validation(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RecordAiClaimValidationParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_source", "write")?;
    if organization_id == 0 {
        return Err("organization_id is required".to_string());
    }
    if params.run_id == AUTO_INC_SENTINEL {
        return Err("run_id must be nonzero".to_string());
    }
    if let Some(cid) = params.company_id {
        if cid == AUTO_INC_SENTINEL {
            return Err("company_id must be nonzero when supplied".to_string());
        }
    }

    let check_kind = validate_check_kind(&params.check_kind)?;
    let outcome = validate_check_outcome(&params.outcome)?;
    let detail = validate_optional_detail(&params.detail, MAX_DETAIL_LEN)?;

    // At least one reference anchor must be provided so the check is traceable.
    if params.claim_id.is_none()
        && params.source_version_id.is_none()
        && params.source_passage_id.is_none()
    {
        return Err(
            "at least one of claim_id, source_version_id, or source_passage_id is required"
                .to_string(),
        );
    }

    let row = ctx.db.ai_claim_validation().insert(AiClaimValidation {
        id: AUTO_INC_SENTINEL,
        organization_id,
        company_id: params.company_id,
        run_id: params.run_id,
        claim_id: params.claim_id,
        source_version_id: params.source_version_id,
        source_passage_id: params.source_passage_id,
        check_kind,
        outcome,
        detail,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: params.company_id,
            table_name: "ai_claim_validation",
            record_id: row.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec!["check_kind".to_string(), "outcome".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Record the aggregate gate result for a durable agent run.
///
/// The ai-gateway harness calls this once after all per-reference checks have
/// been recorded. The `gate_outcome` drives run finalization:
/// * `passed` → the run can be completed.
/// * `failed` → the run is held; the consumer must remediate cited sources.
/// * `domain_review_required` → the run parks awaiting human inspection.
#[reducer]
pub fn complete_ai_answer_gate(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CompleteAiAnswerGateParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_source", "write")?;
    if organization_id == 0 {
        return Err("organization_id is required".to_string());
    }
    if params.run_id == AUTO_INC_SENTINEL {
        return Err("run_id must be nonzero".to_string());
    }
    if let Some(cid) = params.company_id {
        if cid == AUTO_INC_SENTINEL {
            return Err("company_id must be nonzero when supplied".to_string());
        }
    }

    let gate_outcome = validate_gate_outcome(&params.gate_outcome)?;

    let row = ctx.db.ai_answer_gate_result().insert(AiAnswerGateResult {
        id: AUTO_INC_SENTINEL,
        organization_id,
        company_id: params.company_id,
        run_id: params.run_id,
        gate_outcome: gate_outcome.clone(),
        failed_checks_json: params.failed_checks_json,
        domain_review_required: params.domain_review_required,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: params.company_id,
            table_name: "ai_answer_gate_result",
            record_id: row.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec!["gate_outcome".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_kind_normalization() {
        assert_eq!(
            validate_check_kind("  Reference_Exists  ").unwrap(),
            "reference_exists"
        );
        assert_eq!(
            validate_check_kind("APPLICABILITY").unwrap(),
            "applicability"
        );
        assert!(validate_check_kind("unknown").is_err());
    }

    #[test]
    fn check_outcome_normalization() {
        assert_eq!(validate_check_outcome("PASSED").unwrap(), "passed");
        assert_eq!(validate_check_outcome(" Skipped ").unwrap(), "skipped");
        assert!(validate_check_outcome("ok").is_err());
    }

    #[test]
    fn gate_outcome_normalization() {
        assert_eq!(validate_gate_outcome("failed").unwrap(), "failed");
        assert_eq!(
            validate_gate_outcome("Domain_Review_Required").unwrap(),
            "domain_review_required"
        );
        assert!(validate_gate_outcome("approved").is_err());
    }

    #[test]
    fn detail_truncation_rejected() {
        let long = "x".repeat(MAX_DETAIL_LEN + 1);
        assert!(validate_optional_detail(&Some(long), MAX_DETAIL_LEN).is_err());
    }

    #[test]
    fn empty_detail_becomes_none() {
        assert_eq!(
            validate_optional_detail(&Some("  ".to_string()), MAX_DETAIL_LEN).unwrap(),
            None
        );
    }
}
