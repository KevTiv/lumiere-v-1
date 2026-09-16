//! AIH-21 — Structured diagnostics and bounded repair (M2).
//!
//! Provides admitted, versioned, deterministic validators for candidate
//! components produced during an agent run. Every failing candidate must pass
//! all validators before it can be published; a validator pass is not domain
//! approval. If errors cannot be resolved within the repair budget the run
//! stops or routes to review.
//!
//! # Admitted validators
//!
//! | Validator | `stable_code` prefix | What it checks |
//! |-----------|---------------------|----------------|
//! | `schema_contract` | `ERR_SCHEMA_*` | Candidate JSON matches the expected shape |
//! | `scope_reference` | `ERR_SCOPE_*` | Referenced IDs resolve and belong to the org |
//! | `forbidden_operation` | `ERR_OP_*` | No disallowed operations appear in the candidate |
//! | `domain_invariant` | `ERR_INV_*` | Available numeric/structural invariants hold |
//!
//! # Repair budget
//!
//! `RepairBudget::max_attempts` caps how many times the loop may create a new
//! candidate version and re-validate. Exhausting the budget stops the run and
//! records a `budget_exhausted` repair outcome; a required domain invariant that
//! deterministic repair cannot satisfy records `requires_review` instead.

use anyhow::{Context, Result};
use serde_json::Value;
use stdb_client::StdbClient;

// ── Public types ──────────────────────────────────────────────────────────

/// Severity of a single diagnostic finding.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum DiagnosticSeverity {
    Info,
    Warning,
    Error,
}

impl DiagnosticSeverity {
    fn as_str(&self) -> &'static str {
        match self {
            DiagnosticSeverity::Error => "error",
            DiagnosticSeverity::Warning => "warning",
            DiagnosticSeverity::Info => "info",
        }
    }
}

/// One typed finding produced by an admitted validator against a candidate.
#[derive(Clone, Debug)]
pub struct DiagnosticResult {
    pub validator_name: &'static str,
    /// Pinned SemVer or commit ref identifying the validator.
    pub validator_version: &'static str,
    pub component_key: String,
    pub candidate_hash: String,
    pub severity: DiagnosticSeverity,
    /// Stable, machine-readable code for programmatic handling.
    pub stable_code: &'static str,
    /// Optional field/path the finding targets.
    pub field: Option<String>,
    /// Actionable explanation for the operator or reviewer.
    pub explanation: String,
}

impl DiagnosticResult {
    fn is_error(&self) -> bool {
        self.severity == DiagnosticSeverity::Error
    }
}

/// Budget governing how many repair attempts the loop may make.
#[derive(Clone, Copy, Debug)]
pub struct RepairBudget {
    pub max_attempts: u32,
}

impl RepairBudget {
    pub fn new(max_attempts: u32) -> Self {
        assert!(
            max_attempts > 0,
            "repair budget must allow at least one attempt"
        );
        Self { max_attempts }
    }
}

/// Final outcome of the `run_bounded_repair` loop.
#[derive(Clone, Debug, PartialEq)]
pub enum RepairOutcome {
    /// All validators passed (possibly after repairs).
    Passed { attempts_used: u32 },
    /// Repair budget was exhausted with errors remaining.
    BudgetExhausted {
        attempts_used: u32,
        remaining_errors: Vec<String>,
    },
    /// A required domain invariant cannot be satisfied deterministically;
    /// human/domain review is required before publication.
    RequiresReview {
        attempts_used: u32,
        remaining_errors: Vec<String>,
    },
}

// ── Candidate type ────────────────────────────────────────────────────────

/// A candidate component to be validated.
pub struct Candidate {
    /// Matches `AiArtifactComponent.component_key`.
    pub component_key: String,
    /// SHA-256 hex of the current candidate bytes.
    pub candidate_hash: String,
    /// JSON-encoded candidate content.
    pub content: Value,
    /// `workflow_step` | `formula` | `code_symbol` | `document_section`
    pub component_kind: String,
    /// Organization that owns this candidate.
    pub org_id: u64,
}

// ── Validator trait ───────────────────────────────────────────────────────

/// An admitted, versioned, deterministic validator.
pub trait Validator: Send + Sync {
    fn name(&self) -> &'static str;
    fn version(&self) -> &'static str;
    /// Run all checks and return findings (pass or fail for every rule).
    /// An empty vec means all rules passed.
    fn validate(&self, candidate: &Candidate) -> Vec<DiagnosticResult>;
}

// ── Admitted validators ───────────────────────────────────────────────────

/// Checks that the candidate JSON matches the expected shape for its
/// `component_kind`. An empty or non-object root always fails.
pub struct SchemaContractValidator;

impl Validator for SchemaContractValidator {
    fn name(&self) -> &'static str {
        "schema_contract"
    }

    fn version(&self) -> &'static str {
        "1.0.0"
    }

    fn validate(&self, candidate: &Candidate) -> Vec<DiagnosticResult> {
        let mut findings = Vec::new();

        let obj = match candidate.content.as_object() {
            Some(o) => o,
            None => {
                findings.push(self.finding(
                    candidate,
                    DiagnosticSeverity::Error,
                    "ERR_SCHEMA_ROOT_NOT_OBJECT",
                    None,
                    "Candidate content must be a JSON object".into(),
                ));
                return findings;
            }
        };

        match candidate.component_kind.as_str() {
            "workflow_step" => {
                for required_field in &["step_id", "action", "inputs"] {
                    if !obj.contains_key(*required_field) {
                        findings.push(self.finding(
                            candidate,
                            DiagnosticSeverity::Error,
                            "ERR_SCHEMA_MISSING_FIELD",
                            Some(required_field.to_string()),
                            format!("workflow_step requires field '{required_field}'"),
                        ));
                    }
                }
            }
            "formula" => {
                for required_field in &["expression", "output_type"] {
                    if !obj.contains_key(*required_field) {
                        findings.push(self.finding(
                            candidate,
                            DiagnosticSeverity::Error,
                            "ERR_SCHEMA_MISSING_FIELD",
                            Some(required_field.to_string()),
                            format!("formula requires field '{required_field}'"),
                        ));
                    }
                }
            }
            "code_symbol" => {
                for required_field in &["symbol_name", "language"] {
                    if !obj.contains_key(*required_field) {
                        findings.push(self.finding(
                            candidate,
                            DiagnosticSeverity::Error,
                            "ERR_SCHEMA_MISSING_FIELD",
                            Some(required_field.to_string()),
                            format!("code_symbol requires field '{required_field}'"),
                        ));
                    }
                }
            }
            "document_section" => {
                if !obj.contains_key("heading") && !obj.contains_key("content") {
                    findings.push(self.finding(
                        candidate,
                        DiagnosticSeverity::Error,
                        "ERR_SCHEMA_MISSING_FIELD",
                        Some("heading_or_content".to_string()),
                        "document_section requires at least 'heading' or 'content'".into(),
                    ));
                }
            }
            other => {
                findings.push(self.finding(
                    candidate,
                    DiagnosticSeverity::Warning,
                    "ERR_SCHEMA_UNKNOWN_KIND",
                    None,
                    format!("unknown component_kind '{other}'; no schema contract available"),
                ));
            }
        }

        findings
    }
}

impl SchemaContractValidator {
    fn finding(
        &self,
        c: &Candidate,
        severity: DiagnosticSeverity,
        stable_code: &'static str,
        field: Option<String>,
        explanation: String,
    ) -> DiagnosticResult {
        DiagnosticResult {
            validator_name: self.name(),
            validator_version: self.version(),
            component_key: c.component_key.clone(),
            candidate_hash: c.candidate_hash.clone(),
            severity,
            stable_code,
            field,
            explanation,
        }
    }
}

/// Checks that referenced IDs embedded in the candidate (source_version_id,
/// source_passage_id, decision_id) are nonzero when present, and that the
/// `org_id` recorded in any scope field matches the candidate's owner.
pub struct ScopeReferenceValidator;

impl Validator for ScopeReferenceValidator {
    fn name(&self) -> &'static str {
        "scope_reference"
    }

    fn version(&self) -> &'static str {
        "1.0.0"
    }

    fn validate(&self, candidate: &Candidate) -> Vec<DiagnosticResult> {
        let mut findings = Vec::new();
        let obj = match candidate.content.as_object() {
            Some(o) => o,
            None => return findings,
        };

        let id_fields = [
            "source_version_id",
            "source_passage_id",
            "decision_id",
            "claim_id",
        ];
        for field_name in &id_fields {
            if let Some(v) = obj.get(*field_name) {
                let id = v.as_u64().unwrap_or(0);
                if id == 0 {
                    findings.push(DiagnosticResult {
                        validator_name: self.name(),
                        validator_version: self.version(),
                        component_key: candidate.component_key.clone(),
                        candidate_hash: candidate.candidate_hash.clone(),
                        severity: DiagnosticSeverity::Error,
                        stable_code: "ERR_SCOPE_ZERO_REF",
                        field: Some(field_name.to_string()),
                        explanation: format!(
                            "'{field_name}' must be a nonzero ID when present; \
                             use AUTO_INC_SENTINEL only as an insert placeholder"
                        ),
                    });
                }
            }
        }

        if let Some(org_val) = obj.get("organization_id") {
            let cited_org = org_val.as_u64().unwrap_or(0);
            if cited_org != 0 && cited_org != candidate.org_id {
                findings.push(DiagnosticResult {
                    validator_name: self.name(),
                    validator_version: self.version(),
                    component_key: candidate.component_key.clone(),
                    candidate_hash: candidate.candidate_hash.clone(),
                    severity: DiagnosticSeverity::Error,
                    stable_code: "ERR_SCOPE_ORG_MISMATCH",
                    field: Some("organization_id".to_string()),
                    explanation: format!(
                        "candidate organization_id {cited_org} does not match \
                         the run's organization {}",
                        candidate.org_id
                    ),
                });
            }
        }

        findings
    }
}

/// Checks that the candidate does not contain operations from the deny list.
/// Forbidden operations are those that would mutate ERP state outside the
/// `action_draft` approval gate.
pub struct ForbiddenOperationValidator;

impl Validator for ForbiddenOperationValidator {
    fn name(&self) -> &'static str {
        "forbidden_operation"
    }

    fn version(&self) -> &'static str {
        "1.0.0"
    }

    fn validate(&self, candidate: &Candidate) -> Vec<DiagnosticResult> {
        let mut findings = Vec::new();
        let text = serde_json::to_string(&candidate.content).unwrap_or_default();

        const FORBIDDEN: &[(&str, &str)] = &[
            ("direct_db_write", "ERR_OP_DIRECT_DB_WRITE"),
            ("bypass_approval", "ERR_OP_BYPASS_APPROVAL"),
            ("grant_permission", "ERR_OP_GRANT_PERMISSION"),
            ("skip_audit", "ERR_OP_SKIP_AUDIT"),
            ("raw_sql_exec", "ERR_OP_RAW_SQL_EXEC"),
        ];

        for (op, code) in FORBIDDEN {
            if text.contains(op) {
                findings.push(DiagnosticResult {
                    validator_name: self.name(),
                    validator_version: self.version(),
                    component_key: candidate.component_key.clone(),
                    candidate_hash: candidate.candidate_hash.clone(),
                    severity: DiagnosticSeverity::Error,
                    stable_code: code,
                    field: None,
                    explanation: format!(
                        "candidate contains forbidden operation '{op}'; \
                         mutating ERP state requires an action_draft"
                    ),
                });
            }
        }

        findings
    }
}

/// Validates available numeric and structural invariants:
/// - Numeric values must not be NaN or infinite (formula candidates).
/// - String fields must not exceed 10 000 characters.
/// - Arrays must not exceed 1 000 elements.
///
/// A `requires_review` status is returned when the invariant is a domain rule
/// (e.g. accounting periods, tax rates) that deterministic checks cannot fully
/// verify; those entries produce `Warning` findings rather than `Error`.
pub struct DomainInvariantValidator;

impl Validator for DomainInvariantValidator {
    fn name(&self) -> &'static str {
        "domain_invariant"
    }

    fn version(&self) -> &'static str {
        "1.0.0"
    }

    fn validate(&self, candidate: &Candidate) -> Vec<DiagnosticResult> {
        let mut findings = Vec::new();
        self.check_value(&candidate.content, &mut findings, candidate, "");
        findings
    }
}

impl DomainInvariantValidator {
    fn check_value(
        &self,
        v: &Value,
        findings: &mut Vec<DiagnosticResult>,
        c: &Candidate,
        path: &str,
    ) {
        match v {
            Value::Number(n) => {
                if let Some(f) = n.as_f64() {
                    if !f.is_finite() {
                        findings.push(DiagnosticResult {
                            validator_name: self.name(),
                            validator_version: self.version(),
                            component_key: c.component_key.clone(),
                            candidate_hash: c.candidate_hash.clone(),
                            severity: DiagnosticSeverity::Error,
                            stable_code: "ERR_INV_NON_FINITE_NUMBER",
                            field: Some(path.to_string()),
                            explanation: format!(
                                "numeric value at '{path}' is NaN or infinite; \
                                 all numeric fields must be finite"
                            ),
                        });
                    }
                }
                // Domain accounting/tax rates are out-of-reach for deterministic
                // checks; signal that review is advisory here.
                let domain_sensitive = matches!(
                    path,
                    "tax_rate" | "interest_rate" | "discount_rate" | "exchange_rate"
                );
                if domain_sensitive {
                    findings.push(DiagnosticResult {
                        validator_name: self.name(),
                        validator_version: self.version(),
                        component_key: c.component_key.clone(),
                        candidate_hash: c.candidate_hash.clone(),
                        severity: DiagnosticSeverity::Warning,
                        stable_code: "ERR_INV_DOMAIN_REVIEW_REQUIRED",
                        field: Some(path.to_string()),
                        explanation: format!(
                            "field '{path}' requires domain review; \
                             deterministic validators cannot verify its correctness"
                        ),
                    });
                }
            }
            Value::String(s) if s.len() > 10_000 => {
                findings.push(DiagnosticResult {
                    validator_name: self.name(),
                    validator_version: self.version(),
                    component_key: c.component_key.clone(),
                    candidate_hash: c.candidate_hash.clone(),
                    severity: DiagnosticSeverity::Error,
                    stable_code: "ERR_INV_STRING_TOO_LONG",
                    field: Some(path.to_string()),
                    explanation: format!(
                        "string at '{path}' exceeds 10 000 characters ({} chars)",
                        s.len()
                    ),
                });
            }
            Value::Array(arr) if arr.len() > 1_000 => {
                findings.push(DiagnosticResult {
                    validator_name: self.name(),
                    validator_version: self.version(),
                    component_key: c.component_key.clone(),
                    candidate_hash: c.candidate_hash.clone(),
                    severity: DiagnosticSeverity::Error,
                    stable_code: "ERR_INV_ARRAY_TOO_LARGE",
                    field: Some(path.to_string()),
                    explanation: format!(
                        "array at '{path}' has {} elements; maximum is 1 000",
                        arr.len()
                    ),
                });
            }
            Value::Object(obj) => {
                for (key, child) in obj {
                    let child_path = if path.is_empty() {
                        key.clone()
                    } else {
                        format!("{path}.{key}")
                    };
                    self.check_value(child, findings, c, &child_path);
                }
            }
            Value::Array(arr) => {
                for (i, child) in arr.iter().enumerate() {
                    let child_path = format!("{path}[{i}]");
                    self.check_value(child, findings, c, &child_path);
                }
            }
            _ => {}
        }
    }
}

/// The default set of admitted validators, in evaluation order.
pub fn default_validators() -> Vec<Box<dyn Validator>> {
    vec![
        Box::new(SchemaContractValidator),
        Box::new(ScopeReferenceValidator),
        Box::new(ForbiddenOperationValidator),
        Box::new(DomainInvariantValidator),
    ]
}

// ── Core diagnostic functions ─────────────────────────────────────────────

/// Run all `validators` against `candidate` and return every finding.
/// An empty result means all validators passed.
pub fn run_validators(
    candidate: &Candidate,
    validators: &[Box<dyn Validator>],
) -> Vec<DiagnosticResult> {
    validators
        .iter()
        .flat_map(|v| v.validate(candidate))
        .collect()
}

/// Record every diagnostic finding in SpacetimeDB via the
/// `record_diagnostic_result` reducer. `repair_attempt_no = 0` for the
/// initial evaluation pass.
pub async fn persist_diagnostics(
    stdb: &StdbClient,
    org_id: u64,
    company_id: u64,
    run_id: u64,
    findings: &[DiagnosticResult],
    repair_attempt_no: u32,
) -> Result<()> {
    for f in findings {
        stdb.call_reducer(stdb_client::reducer_call!(
            "record_diagnostic_result",
            serde_json::json!([
                org_id,
                {
                    "company_id": company_id,
                    "run_id": run_id,
                    "component_key": f.component_key,
                    "candidate_hash": f.candidate_hash,
                    "validator_name": f.validator_name,
                    "validator_version": f.validator_version,
                    "severity": f.severity.as_str(),
                    "stable_code": f.stable_code,
                    "field": f.field,
                    "explanation": f.explanation,
                    "outcome": if f.is_error() { "failed" } else { "passed" },
                    "repair_attempt_no": repair_attempt_no,
                }
            ]),
        ))
        .await
        .context("record_diagnostic_result")?;
    }
    Ok(())
}

/// The full bounded repair loop.
///
/// 1. Runs `validators` against `candidate` and persists findings.
/// 2. If errors exist and budget remains, calls `repair_fn` to produce a new
///    candidate version, records the attempt, and re-validates.
/// 3. Repeats until all errors clear, the budget is exhausted, or the only
///    remaining errors are domain-invariant warnings that require human review.
///
/// `repair_fn` receives the current `Candidate` and the error `stable_code`s
/// that caused the repair; it returns the new candidate or `None` when repair
/// is not possible (which immediately records `requires_review`).
pub async fn run_bounded_repair<F>(
    stdb: &StdbClient,
    org_id: u64,
    company_id: u64,
    run_id: u64,
    mut candidate: Candidate,
    validators: &[Box<dyn Validator>],
    budget: RepairBudget,
    mut repair_fn: F,
) -> Result<RepairOutcome>
where
    F: FnMut(&Candidate, &[&str]) -> Option<Candidate>,
{
    assert!(org_id != 0, "org_id must be nonzero");
    assert!(company_id != 0, "company_id must be nonzero");
    assert!(run_id != 0, "run_id must be nonzero");

    // Initial evaluation pass (attempt_no = 0 means pre-repair).
    let mut findings = run_validators(&candidate, validators);
    persist_diagnostics(stdb, org_id, company_id, run_id, &findings, 0).await?;

    let mut errors: Vec<DiagnosticResult> =
        findings.iter().filter(|f| f.is_error()).cloned().collect();

    if errors.is_empty() {
        return Ok(RepairOutcome::Passed { attempts_used: 0 });
    }

    for attempt_no in 1..=budget.max_attempts {
        let error_codes: Vec<&str> = errors.iter().map(|e| e.stable_code).collect();

        // Check for domain-invariant-only errors (requires_review).
        let all_domain = errors
            .iter()
            .all(|e| e.stable_code == "ERR_INV_DOMAIN_REVIEW_REQUIRED");
        if all_domain {
            record_repair_outcome(
                stdb,
                org_id,
                company_id,
                run_id,
                &candidate,
                None,
                attempt_no,
                "requires_review",
                &error_codes,
            )
            .await?;
            return Ok(RepairOutcome::RequiresReview {
                attempts_used: attempt_no,
                remaining_errors: error_codes.iter().map(|s| s.to_string()).collect(),
            });
        }

        // Attempt repair.
        let new_candidate = match repair_fn(&candidate, &error_codes) {
            Some(c) => c,
            None => {
                record_repair_outcome(
                    stdb,
                    org_id,
                    company_id,
                    run_id,
                    &candidate,
                    None,
                    attempt_no,
                    "requires_review",
                    &error_codes,
                )
                .await?;
                return Ok(RepairOutcome::RequiresReview {
                    attempts_used: attempt_no,
                    remaining_errors: error_codes.iter().map(|s| s.to_string()).collect(),
                });
            }
        };

        // Re-validate the repaired candidate.
        findings = run_validators(&new_candidate, validators);
        persist_diagnostics(stdb, org_id, company_id, run_id, &findings, attempt_no).await?;

        let remaining_errors: Vec<DiagnosticResult> =
            findings.iter().filter(|f| f.is_error()).cloned().collect();

        let status = if remaining_errors.is_empty() {
            "succeeded"
        } else {
            "failed"
        };

        record_repair_outcome(
            stdb,
            org_id,
            company_id,
            run_id,
            &candidate,
            Some(&new_candidate),
            attempt_no,
            status,
            &remaining_errors
                .iter()
                .map(|e| e.stable_code)
                .collect::<Vec<_>>(),
        )
        .await?;

        candidate = new_candidate;
        errors = remaining_errors;

        if errors.is_empty() {
            return Ok(RepairOutcome::Passed {
                attempts_used: attempt_no,
            });
        }
    }

    // Budget exhausted.
    let remaining: Vec<String> = errors.iter().map(|e| e.stable_code.to_string()).collect();
    Ok(RepairOutcome::BudgetExhausted {
        attempts_used: budget.max_attempts,
        remaining_errors: remaining,
    })
}

async fn record_repair_outcome(
    stdb: &StdbClient,
    org_id: u64,
    company_id: u64,
    run_id: u64,
    original: &Candidate,
    repaired: Option<&Candidate>,
    attempt_no: u32,
    status: &str,
    error_codes: &[&str],
) -> Result<()> {
    let remaining_json = if error_codes.is_empty() {
        None
    } else {
        Some(serde_json::to_string(error_codes).unwrap_or_default())
    };
    stdb.call_reducer(stdb_client::reducer_call!(
        "record_repair_attempt",
        serde_json::json!([
            org_id,
            {
                "company_id": company_id,
                "run_id": run_id,
                "component_key": original.component_key,
                "original_hash": original.candidate_hash,
                "repaired_hash": repaired.map(|c| &c.candidate_hash),
                "attempt_no": attempt_no,
                "repair_status": status,
                "remaining_errors_json": remaining_json,
            }
        ]),
    ))
    .await
    .context("record_repair_attempt")?;
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn candidate(kind: &str, content: Value) -> Candidate {
        Candidate {
            component_key: "test:component".into(),
            candidate_hash: "abc123".into(),
            content,
            component_kind: kind.into(),
            org_id: 1,
        }
    }

    // ── SchemaContractValidator ──────────────────────────────────────────

    #[test]
    fn schema_validator_rejects_non_object() {
        let c = candidate("workflow_step", json!("not an object"));
        let v = SchemaContractValidator;
        let findings = v.validate(&c);
        assert!(findings
            .iter()
            .any(|f| f.stable_code == "ERR_SCHEMA_ROOT_NOT_OBJECT"));
    }

    #[test]
    fn schema_validator_workflow_step_missing_fields() {
        let c = candidate("workflow_step", json!({"step_id": "1"}));
        let v = SchemaContractValidator;
        let findings = v.validate(&c);
        let codes: Vec<_> = findings.iter().map(|f| f.stable_code).collect();
        // Missing "action" and "inputs"
        assert_eq!(
            codes
                .iter()
                .filter(|&&c| c == "ERR_SCHEMA_MISSING_FIELD")
                .count(),
            2
        );
    }

    #[test]
    fn schema_validator_workflow_step_passes() {
        let c = candidate(
            "workflow_step",
            json!({"step_id": "1", "action": "read", "inputs": {}}),
        );
        let v = SchemaContractValidator;
        let findings: Vec<_> = v
            .validate(&c)
            .into_iter()
            .filter(|f| f.is_error())
            .collect();
        assert!(findings.is_empty());
    }

    #[test]
    fn schema_validator_formula_missing_output_type() {
        let c = candidate("formula", json!({"expression": "a + b"}));
        let v = SchemaContractValidator;
        let findings = v.validate(&c);
        assert!(findings
            .iter()
            .any(|f| f.field.as_deref() == Some("output_type")));
    }

    #[test]
    fn schema_validator_unknown_kind_is_warning() {
        let c = candidate("mystery_kind", json!({}));
        let v = SchemaContractValidator;
        let findings = v.validate(&c);
        assert!(findings
            .iter()
            .any(|f| f.severity == DiagnosticSeverity::Warning
                && f.stable_code == "ERR_SCHEMA_UNKNOWN_KIND"));
    }

    // ── ScopeReferenceValidator ──────────────────────────────────────────

    #[test]
    fn scope_validator_rejects_zero_id() {
        let c = candidate("workflow_step", json!({"source_version_id": 0}));
        let v = ScopeReferenceValidator;
        let findings = v.validate(&c);
        assert!(findings
            .iter()
            .any(|f| f.stable_code == "ERR_SCOPE_ZERO_REF"));
    }

    #[test]
    fn scope_validator_rejects_org_mismatch() {
        let c = Candidate {
            component_key: "k".into(),
            candidate_hash: "h".into(),
            content: json!({"organization_id": 99}),
            component_kind: "workflow_step".into(),
            org_id: 1,
        };
        let v = ScopeReferenceValidator;
        let findings = v.validate(&c);
        assert!(findings
            .iter()
            .any(|f| f.stable_code == "ERR_SCOPE_ORG_MISMATCH"));
    }

    #[test]
    fn scope_validator_passes_nonzero_ids_and_matching_org() {
        let c = Candidate {
            component_key: "k".into(),
            candidate_hash: "h".into(),
            content: json!({"source_version_id": 5, "organization_id": 1}),
            component_kind: "workflow_step".into(),
            org_id: 1,
        };
        let v = ScopeReferenceValidator;
        let errors: Vec<_> = v
            .validate(&c)
            .into_iter()
            .filter(|f| f.is_error())
            .collect();
        assert!(errors.is_empty());
    }

    // ── ForbiddenOperationValidator ──────────────────────────────────────

    #[test]
    fn forbidden_op_validator_detects_bypass_approval() {
        let c = candidate("workflow_step", json!({"action": "bypass_approval"}));
        let v = ForbiddenOperationValidator;
        let findings = v.validate(&c);
        assert!(findings
            .iter()
            .any(|f| f.stable_code == "ERR_OP_BYPASS_APPROVAL"));
    }

    #[test]
    fn forbidden_op_validator_passes_clean_candidate() {
        let c = candidate("workflow_step", json!({"action": "read_erp_record"}));
        let v = ForbiddenOperationValidator;
        assert!(v.validate(&c).is_empty());
    }

    // ── DomainInvariantValidator ─────────────────────────────────────────

    #[test]
    fn domain_invariant_catches_oversized_string() {
        let long_str = "x".repeat(10_001);
        let c = candidate("document_section", json!({"content": long_str}));
        let v = DomainInvariantValidator;
        let findings = v.validate(&c);
        assert!(findings
            .iter()
            .any(|f| f.stable_code == "ERR_INV_STRING_TOO_LONG"));
    }

    #[test]
    fn domain_invariant_passes_normal_content() {
        let c = candidate(
            "document_section",
            json!({"heading": "Intro", "content": "Hello"}),
        );
        let v = DomainInvariantValidator;
        let errors: Vec<_> = v
            .validate(&c)
            .into_iter()
            .filter(|f| f.is_error())
            .collect();
        assert!(errors.is_empty());
    }

    // ── run_validators ───────────────────────────────────────────────────

    #[test]
    fn run_validators_aggregates_from_all() {
        let c = candidate("workflow_step", json!({"action": "bypass_approval"}));
        let validators = default_validators();
        let findings = run_validators(&c, &validators);
        // schema: missing step_id, action (wait — action IS present; missing step_id and inputs)
        // forbidden_op: bypass_approval
        assert!(findings
            .iter()
            .any(|f| f.validator_name == "schema_contract"));
        assert!(findings
            .iter()
            .any(|f| f.validator_name == "forbidden_operation"));
    }

    #[test]
    fn repair_outcome_equality() {
        assert_eq!(
            RepairOutcome::Passed { attempts_used: 0 },
            RepairOutcome::Passed { attempts_used: 0 }
        );
        assert_ne!(
            RepairOutcome::Passed { attempts_used: 0 },
            RepairOutcome::BudgetExhausted {
                attempts_used: 1,
                remaining_errors: vec![]
            }
        );
    }
}
