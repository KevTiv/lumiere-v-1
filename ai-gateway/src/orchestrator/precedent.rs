//! GP-06 (governed intelligence program): decision precedent and
//! institutional memory, per `decision-precedent-memory-layer.md`.
//!
//! Precedent **informs** a `DecisionStep`; it never grants permission,
//! bypasses current policy, substitutes for STDB business invariants, or
//! silently changes a current program branch (architecture invariant #15).
//! Nothing in this module executes anything — it only ranks and summarizes
//! prior `DecisionCase` records into `intelligence::PrecedentSummaryRef`
//! values, the same type `DecisionRequest`/`ReasoningRequest` (GP-01)
//! already carry (today always empty — this module is what will fill it,
//! once wired).
//!
//! `PrecedentStore` is provider-neutral; `InMemoryPrecedentStore` is a
//! reference implementation for tests. Production wiring binds this to the
//! durable `AiDecisionCase`/`AiDecisionPattern` tables (`spacetimedb/src/ai/
//! decision_precedent.rs`) — not done in this pass, consistent with every
//! prior GP step: additive only, no production route switch.
//!
//! Retrieval is hybrid, not embedding-only (no embedding provider is wired
//! here): it filters hard on tenant scope and decision type, excludes
//! rejected/superseded cases unconditionally (invariant #3 — a rejected or
//! superseded case is never silently treated as positive precedent), then
//! ranks survivors by program/step match, structural context similarity,
//! outcome/review quality, and recency.

use std::collections::HashMap;

use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use serde_json::{json, Value};
use stdb_client::StdbClient;

use super::intelligence::{DecisionTypeRef, PrecedentSummaryRef};

/// Mirrors `decision-precedent-memory-layer.md`'s `DecisionCaseStatus`.
/// Ordering here is not `Ord`-derived on purpose: `Rejected`/`Superseded`
/// are not "below" `Observed` in a quality sense, they are excluded
/// outright (see `quality_rank`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum DecisionCaseStatus {
    Observed,
    Verified,
    Reviewed,
    Approved,
    Rejected,
    Superseded,
}

impl DecisionCaseStatus {
    /// `None` means "never usable as precedent" (invariant #3). `Some`
    /// values are comparable: higher is stronger evidence.
    fn quality_rank(self) -> Option<u8> {
        match self {
            DecisionCaseStatus::Observed => Some(0),
            DecisionCaseStatus::Verified => Some(1),
            DecisionCaseStatus::Reviewed => Some(2),
            DecisionCaseStatus::Approved => Some(3),
            DecisionCaseStatus::Rejected | DecisionCaseStatus::Superseded => None,
        }
    }
}

/// One immutable prior decision, as the retrieval layer sees it. Mirrors
/// `DecisionCase` from `decision-precedent-memory-layer.md` §3, narrowed to
/// what retrieval/ranking actually needs (not the full audit record, which
/// is the durable STDB table's job).
#[derive(Clone, Debug)]
pub(super) struct DecisionCaseRecord {
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub run_id: u64,
    pub step_no: u32,
    pub request_hash: String,
    pub context_fingerprint: String,
    pub provider_attempt_id: Option<u64>,
    pub precedent_refs: Vec<u64>,
    pub decision_type: DecisionTypeRef,
    /// e.g. "skill:low_stock_reorder@3" — program + version this case ran under.
    pub program_ref: String,
    pub step_id: String,
    /// Structural context used for the similarity signal — an object of
    /// entity/material-constraint fields, not raw transcript history.
    pub material_constraints: Value,
    pub selected: Value,
    pub confidence: Option<f64>,
    pub status: DecisionCaseStatus,
    /// Set only when this case is itself a correction of a prior one.
    /// Corrections are append-only — see the STDB reducer, not this module.
    pub correction_of: Option<u64>,
    pub recorded_at_micros: i64,
}

/// A `DecisionStep`'s declared precedent policy (§5 of the plan doc).
#[derive(Clone, Debug)]
pub(super) struct PrecedentPolicy {
    pub enabled: bool,
    pub max_cases: u32,
    pub minimum_status: DecisionCaseStatus,
    pub require_same_program_step: bool,
    /// Reserved for `DecisionPattern` inclusion; no pattern store is wired
    /// in this pass, so this is currently a no-op flag, not a silent lie —
    /// `retrieve` never claims a pattern match it cannot produce.
    pub include_patterns: bool,
}

impl PrecedentPolicy {
    pub fn validate(&self) -> Result<()> {
        if self.max_cases == 0 || self.max_cases > 100 {
            bail!("max_cases must be between 1 and 100");
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub(super) struct PrecedentQuery {
    pub decision_type: DecisionTypeRef,
    pub organization_id: u64,
    pub company_id: u64,
    pub program_ref: String,
    pub step_id: String,
    pub material_constraints: Value,
    pub policy: PrecedentPolicy,
    pub now_micros: i64,
}

impl PrecedentQuery {
    pub fn validate(&self) -> Result<()> {
        self.decision_type.validate()?;
        if self.organization_id == 0 {
            bail!("organization_id must be nonzero");
        }
        if self.company_id == 0 {
            bail!("company_id must be nonzero");
        }
        if !self.material_constraints.is_object() {
            bail!("material_constraints must be a JSON object");
        }
        self.policy.validate()
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub(super) struct PrecedentScoreBreakdown {
    pub program_step_match: f64,
    pub context_similarity: f64,
    pub quality: f64,
    pub recency: f64,
}

impl PrecedentScoreBreakdown {
    fn total(&self) -> f64 {
        0.25 * self.program_step_match
            + 0.35 * self.context_similarity
            + 0.25 * self.quality
            + 0.15 * self.recency
    }
}

#[derive(Clone, Debug)]
pub(super) struct PrecedentMatch {
    pub case: DecisionCaseRecord,
    pub score: f64,
    pub breakdown: PrecedentScoreBreakdown,
}

/// Provider-neutral precedent store. Never an authorization or execution
/// authority — see module docs.
#[async_trait]
pub(super) trait PrecedentStore: Send + Sync {
    async fn retrieve(&self, query: &PrecedentQuery) -> Result<Vec<PrecedentMatch>>;
    async fn record(&self, case: DecisionCaseRecord) -> Result<u64>;
}

/// Reference implementation for tests. Production wiring binds to the
/// durable STDB tables instead (see module docs).
pub(super) struct InMemoryPrecedentStore {
    cases: std::sync::Mutex<Vec<DecisionCaseRecord>>,
    next_id: std::sync::atomic::AtomicU64,
}

impl InMemoryPrecedentStore {
    pub fn new() -> Self {
        Self {
            cases: std::sync::Mutex::new(Vec::new()),
            next_id: std::sync::atomic::AtomicU64::new(1),
        }
    }
}

impl Default for InMemoryPrecedentStore {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl PrecedentStore for InMemoryPrecedentStore {
    async fn retrieve(&self, query: &PrecedentQuery) -> Result<Vec<PrecedentMatch>> {
        query.validate()?;
        let cases = self.cases.lock().unwrap();
        let mut matches: Vec<PrecedentMatch> = cases
            .iter()
            .filter(|case| passes_hard_filters(case, query))
            .map(|case| score_case(case, query))
            .collect();
        // Highest score first; ties broken by most recent.
        matches.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.case.recorded_at_micros.cmp(&a.case.recorded_at_micros))
        });
        matches.truncate(query.policy.max_cases as usize);
        Ok(matches)
    }

    async fn record(&self, mut case: DecisionCaseRecord) -> Result<u64> {
        if case.organization_id == 0 || case.company_id == 0 {
            bail!("organization_id and company_id must be nonzero");
        }
        case.decision_type.validate()?;
        let id = self
            .next_id
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        case.id = id;
        self.cases.lock().unwrap().push(case);
        Ok(id)
    }
}


pub(super) struct StdbPrecedentStore<'a> {
    pub writer: &'a StdbClient,
    pub reader: &'a StdbClient,
}

#[async_trait]
impl PrecedentStore for StdbPrecedentStore<'_> {
    async fn retrieve(&self, query: &PrecedentQuery) -> Result<Vec<PrecedentMatch>> {
        query.validate()?;
        if !query.policy.enabled {
            return Ok(Vec::new());
        }
        let name = sql_escape(&query.decision_type.name);
        let sql = format!(
            "SELECT * FROM ai_decision_case \
             WHERE organization_id = {} AND company_id = {} \
             AND decision_type_name = '{}' AND decision_type_version = {} \
             LIMIT {}",
            query.organization_id,
            query.company_id,
            name,
            query.decision_type.version,
            query.policy.max_cases.saturating_mul(8).max(query.policy.max_cases)
        );
        let rows = self
            .reader
            .query_sql(&sql)
            .await
            .context("query governed decision precedent")?;
        let mut matches = rows
            .iter()
            .filter_map(|row| decode_case(row).transpose())
            .collect::<Result<Vec<_>>>()?
            .into_iter()
            .filter(|case| passes_hard_filters(case, query))
            .map(|case| score_case(&case, query))
            .collect::<Vec<_>>();
        matches.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.case.recorded_at_micros.cmp(&a.case.recorded_at_micros))
        });
        matches.truncate(query.policy.max_cases as usize);
        Ok(matches)
    }

    async fn record(&self, case: DecisionCaseRecord) -> Result<u64> {
        if case.organization_id == 0 || case.company_id == 0 || case.run_id == 0 {
            bail!("organization_id, company_id and run_id must be nonzero");
        }
        case.decision_type.validate()?;
        if case.request_hash.trim().is_empty() || case.context_fingerprint.trim().is_empty() {
            bail!("request_hash and context_fingerprint are required");
        }
        self.writer
            .call_reducer(stdb_client::reducer_call!(
                "record_ai_decision_case",
                json!([
                    case.organization_id,
                    case.company_id,
                    {
                        "run_id": case.run_id,
                        "step_no": case.step_no,
                        "decision_type_name": case.decision_type.name.clone(),
                        "decision_type_version": case.decision_type.version,
                        "program_ref": case.program_ref.clone(),
                        "step_id": case.step_id.clone(),
                        "request_hash": case.request_hash.clone(),
                        "context_fingerprint": case.context_fingerprint.clone(),
                        "material_constraints_json": serde_json::to_string(&case.material_constraints)?,
                        "selected_json": serde_json::to_string(&case.selected)?,
                        "confidence": case.confidence,
                        "provider_attempt_id": case.provider_attempt_id,
                        "precedent_refs": case.precedent_refs.clone(),
                    }
                ])
            ))
            .await
            .context("record governed decision precedent")?;
        let escaped = sql_escape(&case.request_hash);
        let sql = format!(
            "SELECT id FROM ai_decision_case WHERE organization_id = {} \
             AND request_hash = '{}' LIMIT 1",
            case.organization_id, escaped
        );
        let rows = self
            .reader
            .query_sql(&sql)
            .await
            .context("resolve recorded decision case")?;
        rows.first()
            .and_then(|row| row_u64(row, "id"))
            .context("recorded decision case not found after reducer")
    }
}

fn decode_case(row: &Value) -> Result<Option<DecisionCaseRecord>> {
    let Some(id) = row_u64(row, "id") else {
        return Ok(None);
    };
    let status = match row_string(row, "status").as_deref() {
        Some("observed") => DecisionCaseStatus::Observed,
        Some("verified") => DecisionCaseStatus::Verified,
        Some("reviewed") => DecisionCaseStatus::Reviewed,
        Some("approved") => DecisionCaseStatus::Approved,
        Some("rejected") => DecisionCaseStatus::Rejected,
        Some("superseded") => DecisionCaseStatus::Superseded,
        Some(other) => bail!("unknown decision case status '{other}'"),
        None => bail!("decision case status is missing"),
    };
    let material_constraints = parse_json_field(row, "materialConstraintsJson")?;
    let selected = parse_json_field(row, "selectedJson")?;
    Ok(Some(DecisionCaseRecord {
        id,
        organization_id: row_u64(row, "organizationId").unwrap_or_default(),
        company_id: row_u64(row, "companyId").unwrap_or_default(),
        run_id: row_u64(row, "runId").unwrap_or_default(),
        step_no: row_u64(row, "stepNo").unwrap_or_default() as u32,
        request_hash: row_string(row, "requestHash").unwrap_or_default(),
        context_fingerprint: row_string(row, "contextFingerprint").unwrap_or_default(),
        provider_attempt_id: row_u64(row, "providerAttemptId"),
        precedent_refs: row_u64_list(row, "precedentRefs"),
        decision_type: DecisionTypeRef {
            name: row_string(row, "decisionTypeName").unwrap_or_default(),
            version: row_u64(row, "decisionTypeVersion").unwrap_or_default() as u32,
        },
        program_ref: row_string(row, "programRef").unwrap_or_default(),
        step_id: row_string(row, "stepId").unwrap_or_default(),
        material_constraints,
        selected,
        confidence: row_f64(row, "confidence"),
        status,
        correction_of: row_u64(row, "correctionOf"),
        recorded_at_micros: timestamp_micros(
            row.get("createDate").or_else(|| row.get("create_date")),
        ),
    }))
}

fn parse_json_field(row: &Value, camel: &str) -> Result<Value> {
    let snake = camel_to_snake(camel);
    let raw = row
        .get(camel)
        .or_else(|| row.get(&snake))
        .and_then(Value::as_str)
        .with_context(|| format!("missing JSON field '{camel}'"))?;
    serde_json::from_str(raw).with_context(|| format!("parse JSON field '{camel}'"))
}

fn row_u64(row: &Value, key: &str) -> Option<u64> {
    let snake = camel_to_snake(key);
    row.get(key)
        .or_else(|| row.get(&snake))
        .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
}

fn row_f64(row: &Value, key: &str) -> Option<f64> {
    let snake = camel_to_snake(key);
    row.get(key)
        .or_else(|| row.get(&snake))
        .and_then(|value| value.as_f64().or_else(|| value.as_str()?.parse().ok()))
}

fn row_string(row: &Value, key: &str) -> Option<String> {
    let snake = camel_to_snake(key);
    row.get(key)
        .or_else(|| row.get(&snake))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn row_u64_list(row: &Value, key: &str) -> Vec<u64> {
    let snake = camel_to_snake(key);
    row.get(key)
        .or_else(|| row.get(&snake))
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_u64).collect())
        .unwrap_or_default()
}

fn timestamp_micros(value: Option<&Value>) -> i64 {
    let Some(value) = value else { return 0; };
    value
        .as_object()
        .and_then(|object| object.get("__timestamp_micros_since_unix_epoch__"))
        .and_then(Value::as_i64)
        .or_else(|| value.as_i64())
        .unwrap_or_default()
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

fn passes_hard_filters(case: &DecisionCaseRecord, query: &PrecedentQuery) -> bool {
    // No cross-tenant precedent leakage (invariant #17): scope must match
    // exactly, not merely overlap.
    if case.organization_id != query.organization_id || case.company_id != query.company_id {
        return false;
    }
    if case.decision_type.name != query.decision_type.name
        || case.decision_type.version != query.decision_type.version
    {
        return false;
    }
    let Some(quality) = case.status.quality_rank() else {
        // Rejected/superseded: never positive precedent (invariant #3),
        // regardless of the requested minimum_status.
        return false;
    };
    let Some(minimum) = query.policy.minimum_status.quality_rank() else {
        // A policy asking for at least Rejected/Superseded quality is
        // asking for something that can never be positive precedent —
        // treat it as "nothing qualifies" rather than "everything does".
        return false;
    };
    if quality < minimum {
        return false;
    }
    if query.policy.require_same_program_step
        && (case.program_ref != query.program_ref || case.step_id != query.step_id)
    {
        return false;
    }
    true
}

fn score_case(case: &DecisionCaseRecord, query: &PrecedentQuery) -> PrecedentMatch {
    let program_step_match =
        if case.program_ref == query.program_ref && case.step_id == query.step_id {
            1.0
        } else if case.program_ref == query.program_ref {
            0.5
        } else {
            0.0
        };
    let context_similarity =
        jaccard_similarity(&case.material_constraints, &query.material_constraints);
    // quality_rank is Some(_) here — passes_hard_filters already excluded None.
    let quality = case.status.quality_rank().unwrap_or(0) as f64 / 3.0;
    let recency = recency_score(case.recorded_at_micros, query.now_micros);

    let breakdown = PrecedentScoreBreakdown {
        program_step_match,
        context_similarity,
        quality,
        recency,
    };
    PrecedentMatch {
        case: case.clone(),
        score: breakdown.total(),
        breakdown,
    }
}

/// Structural similarity over flattened top-level key/value pairs. This is
/// the "material constraint match" / "entity and context shape" signal from
/// the hybrid retrieval requirement (§4) without requiring an embedding
/// provider; a real embedding signal can be added as another weighted term
/// later without changing this contract.
fn jaccard_similarity(a: &Value, b: &Value) -> f64 {
    let (Some(a), Some(b)) = (a.as_object(), b.as_object()) else {
        return 0.0;
    };
    if a.is_empty() && b.is_empty() {
        return 1.0;
    }
    let a_pairs: HashMap<&str, String> =
        a.iter().map(|(k, v)| (k.as_str(), v.to_string())).collect();
    let b_pairs: HashMap<&str, String> =
        b.iter().map(|(k, v)| (k.as_str(), v.to_string())).collect();
    let intersection = a_pairs
        .iter()
        .filter(|(k, v)| b_pairs.get(*k) == Some(*v))
        .count();
    let union = a_pairs.len() + b_pairs.len() - intersection;
    if union == 0 {
        1.0
    } else {
        intersection as f64 / union as f64
    }
}

/// Half-life of 30 days: a case from today scores 1.0, one from 30 days
/// ago scores 0.5, and so on. A case somehow dated after `now` clamps to
/// 1.0 rather than exceeding it.
fn recency_score(recorded_at_micros: i64, now_micros: i64) -> f64 {
    const HALF_LIFE_DAYS: f64 = 30.0;
    const MICROS_PER_DAY: f64 = 86_400.0 * 1_000_000.0;
    let age_days = (now_micros - recorded_at_micros).max(0) as f64 / MICROS_PER_DAY;
    0.5_f64.powf(age_days / HALF_LIFE_DAYS)
}

/// Condenses ranked matches into the bounded `PrecedentSummaryRef` list
/// `DecisionRequest`/`ReasoningRequest` (GP-01) carry. Providers receive
/// compact facts and outcomes, not raw historical transcripts (§5).
pub(super) fn summarize(matches: &[PrecedentMatch]) -> Vec<PrecedentSummaryRef> {
    matches
        .iter()
        .map(|m| PrecedentSummaryRef {
            decision_case_id: m.case.id.to_string(),
            summary: format!(
                "{} v{} selected {} (status {:?}, score {:.2})",
                m.case.decision_type.name,
                m.case.decision_type.version,
                m.case.selected,
                m.case.status,
                m.score
            ),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn decision_type() -> DecisionTypeRef {
        DecisionTypeRef {
            name: "StockReorderPriority".to_string(),
            version: 1,
        }
    }

    fn case(
        id: u64,
        org: u64,
        company: u64,
        status: DecisionCaseStatus,
        constraints: Value,
        recorded_at_micros: i64,
    ) -> DecisionCaseRecord {
        DecisionCaseRecord {
            id,
            organization_id: org,
            company_id: company,
            run_id: 1,
            step_no: 1,
            request_hash: format!("request-{id}"),
            context_fingerprint: format!("context-{id}"),
            provider_attempt_id: None,
            precedent_refs: Vec::new(),
            decision_type: decision_type(),
            program_ref: "skill:low_stock_reorder@3".to_string(),
            step_id: "priority".to_string(),
            material_constraints: constraints,
            selected: json!("reorder_now"),
            confidence: Some(0.7),
            status,
            correction_of: None,
            recorded_at_micros,
        }
    }

    fn policy() -> PrecedentPolicy {
        PrecedentPolicy {
            enabled: true,
            max_cases: 5,
            minimum_status: DecisionCaseStatus::Observed,
            require_same_program_step: false,
            include_patterns: false,
        }
    }

    fn query(constraints: Value) -> PrecedentQuery {
        PrecedentQuery {
            decision_type: decision_type(),
            organization_id: 1,
            company_id: 1,
            program_ref: "skill:low_stock_reorder@3".to_string(),
            step_id: "priority".to_string(),
            material_constraints: constraints,
            policy: policy(),
            now_micros: 1_000_000_000_000,
        }
    }

    #[tokio::test]
    async fn cross_tenant_cases_never_returned() {
        let store = InMemoryPrecedentStore::new();
        store
            .record(case(
                0,
                2, // foreign org
                1,
                DecisionCaseStatus::Approved,
                json!({"sku": "A1"}),
                1_000_000_000_000,
            ))
            .await
            .unwrap();

        let matches = store.retrieve(&query(json!({"sku": "A1"}))).await.unwrap();
        assert!(matches.is_empty(), "cross-tenant case leaked into results");
    }

    #[tokio::test]
    async fn rejected_and_superseded_cases_are_never_positive_precedent() {
        let store = InMemoryPrecedentStore::new();
        store
            .record(case(
                0,
                1,
                1,
                DecisionCaseStatus::Rejected,
                json!({"sku": "A1"}),
                1_000_000_000_000,
            ))
            .await
            .unwrap();
        store
            .record(case(
                0,
                1,
                1,
                DecisionCaseStatus::Superseded,
                json!({"sku": "A1"}),
                1_000_000_000_000,
            ))
            .await
            .unwrap();

        let matches = store.retrieve(&query(json!({"sku": "A1"}))).await.unwrap();
        assert!(
            matches.is_empty(),
            "rejected/superseded cases must never be returned as precedent"
        );
    }

    #[tokio::test]
    async fn minimum_status_filters_below_threshold_cases() {
        let store = InMemoryPrecedentStore::new();
        store
            .record(case(
                0,
                1,
                1,
                DecisionCaseStatus::Observed,
                json!({"sku": "A1"}),
                1_000_000_000_000,
            ))
            .await
            .unwrap();

        let mut q = query(json!({"sku": "A1"}));
        q.policy.minimum_status = DecisionCaseStatus::Reviewed;
        let matches = store.retrieve(&q).await.unwrap();
        assert!(matches.is_empty());
    }

    #[tokio::test]
    async fn asking_for_rejected_or_superseded_minimum_yields_nothing() {
        let store = InMemoryPrecedentStore::new();
        store
            .record(case(
                0,
                1,
                1,
                DecisionCaseStatus::Approved,
                json!({"sku": "A1"}),
                1_000_000_000_000,
            ))
            .await
            .unwrap();

        let mut q = query(json!({"sku": "A1"}));
        q.policy.minimum_status = DecisionCaseStatus::Rejected;
        let matches = store.retrieve(&q).await.unwrap();
        assert!(
            matches.is_empty(),
            "a minimum_status that can never be positive precedent must exclude everything"
        );
    }

    #[tokio::test]
    async fn require_same_program_step_excludes_other_steps() {
        let store = InMemoryPrecedentStore::new();
        let mut other_step = case(
            0,
            1,
            1,
            DecisionCaseStatus::Approved,
            json!({"sku": "A1"}),
            1_000_000_000_000,
        );
        other_step.step_id = "different-step".to_string();
        store.record(other_step).await.unwrap();

        let mut q = query(json!({"sku": "A1"}));
        q.policy.require_same_program_step = true;
        let matches = store.retrieve(&q).await.unwrap();
        assert!(matches.is_empty());
    }

    #[tokio::test]
    async fn higher_context_similarity_ranks_first() {
        let store = InMemoryPrecedentStore::new();
        store
            .record(case(
                0,
                1,
                1,
                DecisionCaseStatus::Approved,
                json!({"sku": "A1", "warehouse": "east"}),
                1_000_000_000_000,
            ))
            .await
            .unwrap();
        store
            .record(case(
                0,
                1,
                1,
                DecisionCaseStatus::Approved,
                json!({"sku": "Z9", "warehouse": "west"}),
                1_000_000_000_000,
            ))
            .await
            .unwrap();

        let matches = store
            .retrieve(&query(json!({"sku": "A1", "warehouse": "east"})))
            .await
            .unwrap();
        assert_eq!(matches.len(), 2);
        assert!(matches[0].breakdown.context_similarity > matches[1].breakdown.context_similarity);
        assert!(matches[0].score > matches[1].score);
    }

    #[tokio::test]
    async fn more_recent_case_ranks_first_when_otherwise_equal() {
        let store = InMemoryPrecedentStore::new();
        store
            .record(case(
                0,
                1,
                1,
                DecisionCaseStatus::Approved,
                json!({"sku": "A1"}),
                1_000_000_000_000 - 60 * 86_400 * 1_000_000, // 60 days old
            ))
            .await
            .unwrap();
        store
            .record(case(
                0,
                1,
                1,
                DecisionCaseStatus::Approved,
                json!({"sku": "A1"}),
                1_000_000_000_000 - 1 * 86_400 * 1_000_000, // 1 day old
            ))
            .await
            .unwrap();

        let matches = store.retrieve(&query(json!({"sku": "A1"}))).await.unwrap();
        assert_eq!(matches.len(), 2);
        assert!(matches[0].case.recorded_at_micros > matches[1].case.recorded_at_micros);
    }

    #[tokio::test]
    async fn max_cases_bounds_result_size() {
        let store = InMemoryPrecedentStore::new();
        for i in 0..10 {
            store
                .record(case(
                    0,
                    1,
                    1,
                    DecisionCaseStatus::Approved,
                    json!({"sku": format!("A{i}")}),
                    1_000_000_000_000,
                ))
                .await
                .unwrap();
        }
        let mut q = query(json!({"sku": "A1"}));
        q.policy.max_cases = 3;
        let matches = store.retrieve(&q).await.unwrap();
        assert_eq!(matches.len(), 3);
    }

    #[test]
    fn recency_score_half_life_is_thirty_days() {
        let now = 1_000_000_000_000_i64;
        let thirty_days_ago = now - 30 * 86_400 * 1_000_000;
        let score = recency_score(thirty_days_ago, now);
        assert!((score - 0.5).abs() < 0.01, "expected ~0.5, got {score}");
    }

    #[test]
    fn recency_score_future_case_clamps_to_one() {
        let now = 1_000_000_000_000_i64;
        let future = now + 86_400 * 1_000_000;
        assert_eq!(recency_score(future, now), 1.0);
    }

    #[test]
    fn jaccard_similarity_empty_objects_are_identical() {
        assert_eq!(jaccard_similarity(&json!({}), &json!({})), 1.0);
    }

    #[test]
    fn jaccard_similarity_disjoint_objects_score_zero() {
        assert_eq!(jaccard_similarity(&json!({"a": 1}), &json!({"b": 2})), 0.0);
    }

    #[test]
    fn jaccard_similarity_non_object_scores_zero() {
        assert_eq!(jaccard_similarity(&json!("not an object"), &json!({})), 0.0);
    }

    #[tokio::test]
    async fn summarize_produces_bounded_precedent_summary_refs() {
        let store = InMemoryPrecedentStore::new();
        store
            .record(case(
                0,
                1,
                1,
                DecisionCaseStatus::Approved,
                json!({"sku": "A1"}),
                1_000_000_000_000,
            ))
            .await
            .unwrap();
        let matches = store.retrieve(&query(json!({"sku": "A1"}))).await.unwrap();
        let summaries = summarize(&matches);
        assert_eq!(summaries.len(), 1);
        assert!(summaries[0].decision_case_id.parse::<u64>().is_ok());
        assert!(summaries[0].validate().is_ok());
    }

    #[tokio::test]
    async fn record_assigns_ids_and_rejects_zero_scope() {
        let store = InMemoryPrecedentStore::new();
        let first = store
            .record(case(0, 1, 1, DecisionCaseStatus::Observed, json!({}), 0))
            .await
            .unwrap();
        let second = store
            .record(case(0, 1, 1, DecisionCaseStatus::Observed, json!({}), 0))
            .await
            .unwrap();
        assert_ne!(first, second);

        let bad = store
            .record(case(0, 0, 1, DecisionCaseStatus::Observed, json!({}), 0))
            .await;
        assert!(bad.is_err());
    }

    #[tokio::test]
    async fn query_rejects_non_object_material_constraints() {
        let store = InMemoryPrecedentStore::new();
        let mut q = query(json!("not-an-object"));
        q.organization_id = 1;
        assert!(store.retrieve(&q).await.is_err());
    }
}
