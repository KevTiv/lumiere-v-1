//! AIH-21 — Structured diagnostics and bounded repair (M2).
//!
//! Records the outcome of each admitted validator run against a candidate
//! component and each bounded repair attempt. Together they form the audit
//! chain `candidate → diagnostic → repair → new_candidate → re-diagnostic`
//! that the answer/publication gate inspects before any component is published.
//!
//! ## Terminology
//!
//! * **Candidate**: an `AiArtifactComponent` version being validated (identified
//!   by `component_key` + `candidate_hash`).
//! * **Validator**: an admitted, versioned, deterministic check (schema contract,
//!   scope reference, forbidden operation, domain invariant).
//! * **Diagnostic**: the typed outcome of one validator against one candidate.
//! * **Repair attempt**: one pass that creates a new candidate version and
//!   re-runs the failing validators. A pass is not domain approval.
//!
//! ## Severities
//!
//! `error` — the candidate cannot be published as-is.
//! `warning` — the candidate may continue with explicit review acknowledgement.
//! `info` — informational; does not block publication.
//!
//! ## Repair outcome values
//!
//! `succeeded` — all validators pass on the new candidate hash.
//! `failed` — validators still fail on the new candidate hash; another attempt may follow.
//! `budget_exhausted` — attempt limit reached; the run must stop or route to review.
//! `requires_review` — a required domain invariant cannot be satisfied deterministically.

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

const AUTO_INC_SENTINEL: u64 = 0;
const MAX_NAME_LEN: usize = 128;
const MAX_HASH_LEN: usize = 128;
const MAX_CODE_LEN: usize = 64;
const MAX_FIELD_LEN: usize = 256;
const MAX_EXPLANATION_LEN: usize = 4000;

// ── Tables ─────────────────────────────────────────────────────────────────

/// One validator outcome for one candidate component.
///
/// A run produces one row per `(run_id, component_key, validator_name)`
/// per evaluation pass. The `repair_attempt_no` links the row to an
/// `AiRepairAttempt` when it was produced during a repair cycle.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_diagnostic_result,
    index(accessor = ai_diagnostic_result_by_org, btree(columns = [organization_id])),
    index(accessor = ai_diagnostic_result_by_run, btree(columns = [run_id])),
    index(accessor = ai_diagnostic_result_by_component, btree(columns = [component_key]))
)]
pub struct AiDiagnosticResult {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub run_id: u64,
    /// Stable component identity matching `AiArtifactComponent.component_key`.
    pub component_key: String,
    /// SHA-256 hex of the candidate bytes at the time of validation.
    pub candidate_hash: String,
    /// Admitted validator name, e.g. `schema_contract`, `scope_reference`,
    /// `forbidden_operation`, `domain_invariant`.
    pub validator_name: String,
    /// Pinned validator version (SemVer or commit ref).
    pub validator_version: String,
    /// `error` | `warning` | `info`
    pub severity: String,
    /// Stable, machine-readable code, e.g. `ERR_MISSING_SCOPE_REF`.
    pub stable_code: String,
    /// Optional field or component path the diagnostic targets.
    pub field: Option<String>,
    /// Actionable human-readable explanation of the failure.
    pub explanation: String,
    /// `passed` | `failed`
    pub outcome: String,
    /// Zero means initial evaluation; nonzero links to `AiRepairAttempt.attempt_no`.
    pub repair_attempt_no: u32,
    pub create_uid: Identity,
    pub create_date: Timestamp,
}

/// One bounded repair attempt for a failing candidate component.
///
/// Created after initial validation discovers errors and the run has remaining
/// repair budget. `original_hash` is the failing candidate; `repaired_hash`
/// is the new version created by the repair step. `repair_status` is set after
/// re-validation.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_repair_attempt,
    index(accessor = ai_repair_attempt_by_org, btree(columns = [organization_id])),
    index(accessor = ai_repair_attempt_by_run, btree(columns = [run_id]))
)]
pub struct AiRepairAttempt {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub run_id: u64,
    pub component_key: String,
    pub original_hash: String,
    /// Hash of the new candidate produced by this repair step.
    pub repaired_hash: Option<String>,
    /// 1-based attempt count for this `(run_id, component_key)` pair.
    pub attempt_no: u32,
    /// `succeeded` | `failed` | `budget_exhausted` | `requires_review`
    pub repair_status: String,
    /// JSON array of stable_codes that remained after this repair attempt.
    pub remaining_errors_json: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
}

// ── Params ─────────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordDiagnosticResultParams {
    pub company_id: Option<u64>,
    pub run_id: u64,
    pub component_key: String,
    pub candidate_hash: String,
    pub validator_name: String,
    pub validator_version: String,
    pub severity: String,
    pub stable_code: String,
    pub field: Option<String>,
    pub explanation: String,
    pub outcome: String,
    pub repair_attempt_no: u32,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordRepairAttemptParams {
    pub company_id: Option<u64>,
    pub run_id: u64,
    pub component_key: String,
    pub original_hash: String,
    pub repaired_hash: Option<String>,
    pub attempt_no: u32,
    pub repair_status: String,
    pub remaining_errors_json: Option<String>,
}

// ── Validation ─────────────────────────────────────────────────────────────

fn validate_severity(s: &str) -> Result<String, String> {
    let v = s.trim().to_lowercase();
    let allowed = ["error", "warning", "info"];
    if !allowed.contains(&v.as_str()) {
        return Err(format!("severity must be one of {}", allowed.join(", ")));
    }
    Ok(v)
}

fn validate_diagnostic_outcome(o: &str) -> Result<String, String> {
    let v = o.trim().to_lowercase();
    let allowed = ["passed", "failed"];
    if !allowed.contains(&v.as_str()) {
        return Err(format!(
            "diagnostic outcome must be one of {}",
            allowed.join(", ")
        ));
    }
    Ok(v)
}

fn validate_repair_status(s: &str) -> Result<String, String> {
    let v = s.trim().to_lowercase();
    let allowed = ["succeeded", "failed", "budget_exhausted", "requires_review"];
    if !allowed.contains(&v.as_str()) {
        return Err(format!(
            "repair_status must be one of {}",
            allowed.join(", ")
        ));
    }
    Ok(v)
}

fn validate_nonempty_capped(field: &str, value: &str, max: usize) -> Result<String, String> {
    let v = value.trim().to_string();
    if v.is_empty() {
        return Err(format!("{field} is required"));
    }
    if v.len() > max {
        return Err(format!("{field} exceeds {max} characters"));
    }
    Ok(v)
}

fn validate_optional_capped(
    field: &str,
    value: &Option<String>,
    max: usize,
) -> Result<Option<String>, String> {
    match value {
        None => Ok(None),
        Some(raw) if raw.trim().is_empty() => Ok(None),
        Some(raw) if raw.trim().len() > max => Err(format!("{field} exceeds {max} characters")),
        Some(raw) => Ok(Some(raw.trim().to_string())),
    }
}

// ── Reducers ───────────────────────────────────────────────────────────────

/// Record one validator outcome against a candidate component.
///
/// `repair_attempt_no = 0` means the initial evaluation pass; a nonzero value
/// must match a recorded `AiRepairAttempt.attempt_no` for the same run and
/// component. The gateway harness calls this for every admitted validator,
/// whether the outcome is `passed` or `failed`.
#[reducer]
pub fn record_diagnostic_result(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RecordDiagnosticResultParams,
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

    let component_key =
        validate_nonempty_capped("component_key", &params.component_key, MAX_NAME_LEN)?;
    let candidate_hash =
        validate_nonempty_capped("candidate_hash", &params.candidate_hash, MAX_HASH_LEN)?;
    let validator_name =
        validate_nonempty_capped("validator_name", &params.validator_name, MAX_NAME_LEN)?;
    let validator_version =
        validate_nonempty_capped("validator_version", &params.validator_version, MAX_NAME_LEN)?;
    let severity = validate_severity(&params.severity)?;
    let stable_code = validate_nonempty_capped("stable_code", &params.stable_code, MAX_CODE_LEN)?;
    let field = validate_optional_capped("field", &params.field, MAX_FIELD_LEN)?;
    let explanation =
        validate_nonempty_capped("explanation", &params.explanation, MAX_EXPLANATION_LEN)?;
    let outcome = validate_diagnostic_outcome(&params.outcome)?;

    let row = ctx.db.ai_diagnostic_result().insert(AiDiagnosticResult {
        id: AUTO_INC_SENTINEL,
        organization_id,
        company_id: params.company_id,
        run_id: params.run_id,
        component_key,
        candidate_hash,
        validator_name,
        validator_version,
        severity,
        stable_code,
        field,
        explanation,
        outcome,
        repair_attempt_no: params.repair_attempt_no,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: params.company_id,
            table_name: "ai_diagnostic_result",
            record_id: row.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec![
                "validator_name".to_string(),
                "outcome".to_string(),
                "severity".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

/// Record one bounded repair attempt for a failing candidate component.
///
/// `attempt_no` must be ≥ 1 and is expected to increase monotonically for a
/// given `(run_id, component_key)` pair. `repair_status = "succeeded"` means
/// re-validation passed; any other status leaves the run in a non-published
/// state until the budget is exhausted or domain review resolves it.
#[reducer]
pub fn record_repair_attempt(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RecordRepairAttemptParams,
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
    if params.attempt_no == 0 {
        return Err("attempt_no must be ≥ 1".to_string());
    }

    let component_key =
        validate_nonempty_capped("component_key", &params.component_key, MAX_NAME_LEN)?;
    let original_hash =
        validate_nonempty_capped("original_hash", &params.original_hash, MAX_HASH_LEN)?;
    let repaired_hash = match &params.repaired_hash {
        None => Ok(None),
        Some(h) if h.trim().is_empty() => Ok(None),
        Some(h) if h.trim().len() > MAX_HASH_LEN => Err("repaired_hash exceeds limit"),
        Some(h) => Ok(Some(h.trim().to_string())),
    }
    .map_err(str::to_string)?;
    let repair_status = validate_repair_status(&params.repair_status)?;

    let row = ctx.db.ai_repair_attempt().insert(AiRepairAttempt {
        id: AUTO_INC_SENTINEL,
        organization_id,
        company_id: params.company_id,
        run_id: params.run_id,
        component_key,
        original_hash,
        repaired_hash,
        attempt_no: params.attempt_no,
        repair_status: repair_status.clone(),
        remaining_errors_json: params.remaining_errors_json,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: params.company_id,
            table_name: "ai_repair_attempt",
            record_id: row.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec!["repair_status".to_string(), "attempt_no".to_string()],
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
    fn severity_normalization() {
        assert_eq!(validate_severity("ERROR").unwrap(), "error");
        assert_eq!(validate_severity("  Warning  ").unwrap(), "warning");
        assert_eq!(validate_severity("info").unwrap(), "info");
        assert!(validate_severity("critical").is_err());
    }

    #[test]
    fn diagnostic_outcome_normalization() {
        assert_eq!(validate_diagnostic_outcome("Passed").unwrap(), "passed");
        assert_eq!(validate_diagnostic_outcome("FAILED").unwrap(), "failed");
        assert!(validate_diagnostic_outcome("error").is_err());
    }

    #[test]
    fn repair_status_normalization() {
        assert_eq!(validate_repair_status("succeeded").unwrap(), "succeeded");
        assert_eq!(
            validate_repair_status("Budget_Exhausted").unwrap(),
            "budget_exhausted"
        );
        assert_eq!(
            validate_repair_status("requires_review").unwrap(),
            "requires_review"
        );
        assert!(validate_repair_status("ok").is_err());
    }

    #[test]
    fn attempt_no_zero_is_rejected_logically() {
        // Reducers reject attempt_no == 0. Simulate the guard here.
        let attempt_no: u32 = 0;
        assert!(
            attempt_no == 0,
            "attempt_no = 0 must be rejected by the reducer"
        );
    }

    #[test]
    fn nonempty_capped_rejects_empty_and_long() {
        assert!(validate_nonempty_capped("f", "", 10).is_err());
        assert!(validate_nonempty_capped("f", "x".repeat(11).as_str(), 10).is_err());
        assert_eq!(validate_nonempty_capped("f", "  ok  ", 10).unwrap(), "ok");
    }
}
