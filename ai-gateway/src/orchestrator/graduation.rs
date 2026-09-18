//! GP-16 deterministic graduation: cohort analysis and versioned eligibility policy.
//!
//! This module is deliberately observation-only. It can identify stable decision cohorts
//! and evaluate them against a reviewed policy, but it cannot promote a pattern, alter
//! routing, execute capabilities, or mutate ERP state.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use stdb_client::StdbClient;

use super::intelligence::DecisionTypeRef;

const MAX_ANALYSIS_ROWS: u32 = 5_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum DeterministicExpressionKind {
    ProgramBranch,
    ThresholdPolicy,
    LookupPolicy,
    DeterministicCompute,
    NativeErpRule,
    NotExpressible,
}

#[derive(Clone, Debug, PartialEq)]
pub(super) struct GraduationMetrics {
    pub decision_type: DecisionTypeRef,
    pub applicability_fingerprint: String,
    pub observed_cases: u64,
    pub verified_cases: u64,
    pub reviewed_cases: u64,
    pub correction_rate: f64,
    pub verified_outcome_rate: f64,
    pub provider_disagreement_rate: Option<f64>,
    pub shadow_cases: u64,
    pub decision_entropy: f64,
    pub precedent_consistency: f64,
    /// None means the durable case/event model cannot establish this metric yet.
    /// Missing evidence is never converted into a favorable score.
    pub policy_stability_rate: Option<f64>,
    pub evidence_shape_stability: f64,
    pub candidate_set_stability: Option<f64>,
    pub average_cost_microunits: Option<u64>,
    pub average_latency_ms: Option<u64>,
}

#[derive(Clone, Debug)]
pub(super) struct GraduationQuery {
    pub organization_id: u64,
    pub company_id: u64,
    pub decision_type: DecisionTypeRef,
    pub minimum_cases_per_cohort: u64,
    pub max_cases: u32,
}

impl GraduationQuery {
    pub fn validate(&self) -> Result<()> {
        self.decision_type.validate()?;
        if self.organization_id == 0 || self.company_id == 0 {
            bail!("graduation analysis requires nonzero organization_id and company_id");
        }
        if self.minimum_cases_per_cohort < 2 {
            bail!("minimum_cases_per_cohort must be at least 2");
        }
        if self.max_cases == 0 || self.max_cases > MAX_ANALYSIS_ROWS {
            bail!("max_cases must be within 1..={MAX_ANALYSIS_ROWS}");
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub(super) struct GraduationCandidate {
    pub decision_type: DecisionTypeRef,
    pub applicability_fingerprint: String,
    pub supporting_case_ids: Vec<u64>,
    pub dominant_selected: Value,
    pub metrics: GraduationMetrics,
    pub proposed_expression_kind: DeterministicExpressionKind,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct GraduationPolicy {
    #[serde(default)]
    pub enabled: bool,
    pub minimum_cases: u64,
    pub minimum_verified_cases: u64,
    pub maximum_correction_rate: f64,
    pub maximum_provider_disagreement_rate: Option<f64>,
    pub maximum_entropy: f64,
    pub minimum_precedent_consistency: f64,
    pub minimum_policy_stability: Option<f64>,
    pub minimum_evidence_shape_stability: f64,
    pub minimum_candidate_set_stability: Option<f64>,
    pub minimum_shadow_cases: u64,
}

impl GraduationPolicy {
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            minimum_cases: 25,
            minimum_verified_cases: 15,
            maximum_correction_rate: 0.02,
            maximum_provider_disagreement_rate: Some(0.05),
            maximum_entropy: 0.15,
            minimum_precedent_consistency: 0.95,
            minimum_policy_stability: None,
            minimum_evidence_shape_stability: 0.95,
            minimum_candidate_set_stability: Some(0.95),
            minimum_shadow_cases: 15,
        }
    }

    pub fn validate(&self) -> Result<()> {
        if self.minimum_cases < 2 {
            bail!("graduation minimum_cases must be at least 2");
        }
        if self.minimum_verified_cases > self.minimum_cases {
            bail!("minimum_verified_cases cannot exceed minimum_cases");
        }
        for (name, value) in [
            ("maximum_correction_rate", Some(self.maximum_correction_rate)),
            (
                "maximum_provider_disagreement_rate",
                self.maximum_provider_disagreement_rate,
            ),
            ("maximum_entropy", Some(self.maximum_entropy)),
            (
                "minimum_precedent_consistency",
                Some(self.minimum_precedent_consistency),
            ),
            ("minimum_policy_stability", self.minimum_policy_stability),
            (
                "minimum_evidence_shape_stability",
                Some(self.minimum_evidence_shape_stability),
            ),
            (
                "minimum_candidate_set_stability",
                self.minimum_candidate_set_stability,
            ),
        ] {
            if let Some(value) = value {
                if !(0.0..=1.0).contains(&value) {
                    bail!("{name} must be within [0, 1]");
                }
            }
        }
        Ok(())
    }

    pub fn evaluate(&self, metrics: &GraduationMetrics) -> GraduationEligibility {
        if let Err(error) = self.validate() {
            return GraduationEligibility::ineligible(vec![format!("invalid policy: {error}")]);
        }
        if !self.enabled {
            return GraduationEligibility::ineligible(vec!["graduation policy is disabled".into()]);
        }

        let mut reasons = Vec::new();
        if metrics.observed_cases < self.minimum_cases {
            reasons.push(format!(
                "observed cases {} < {}",
                metrics.observed_cases, self.minimum_cases
            ));
        }
        if metrics.verified_cases < self.minimum_verified_cases {
            reasons.push(format!(
                "verified cases {} < {}",
                metrics.verified_cases, self.minimum_verified_cases
            ));
        }
        if metrics.correction_rate > self.maximum_correction_rate {
            reasons.push("correction rate exceeds policy".into());
        }
        if metrics.decision_entropy > self.maximum_entropy {
            reasons.push("decision entropy exceeds policy".into());
        }
        if metrics.precedent_consistency < self.minimum_precedent_consistency {
            reasons.push("precedent consistency is below policy".into());
        }
        if metrics.evidence_shape_stability < self.minimum_evidence_shape_stability {
            reasons.push("evidence shape stability is below policy".into());
        }
        check_optional_maximum(
            "provider disagreement",
            metrics.provider_disagreement_rate,
            self.maximum_provider_disagreement_rate,
            &mut reasons,
        );
        check_optional_minimum(
            "policy stability",
            metrics.policy_stability_rate,
            self.minimum_policy_stability,
            &mut reasons,
        );
        check_optional_minimum(
            "candidate-set stability",
            metrics.candidate_set_stability,
            self.minimum_candidate_set_stability,
            &mut reasons,
        );
        if metrics.shadow_cases < self.minimum_shadow_cases {
            reasons.push(format!(
                "shadow cases {} < {}", metrics.shadow_cases,
                self.minimum_shadow_cases
            ));
        }

        if reasons.is_empty() {
            GraduationEligibility {
                eligible: true,
                reasons,
            }
        } else {
            GraduationEligibility::ineligible(reasons)
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct GraduationEligibility {
    pub eligible: bool,
    pub reasons: Vec<String>,
}

impl GraduationEligibility {
    fn ineligible(reasons: Vec<String>) -> Self {
        Self {
            eligible: false,
            reasons,
        }
    }
}

fn check_optional_maximum(
    name: &str,
    actual: Option<f64>,
    required: Option<f64>,
    reasons: &mut Vec<String>,
) {
    let Some(required) = required else { return };
    match actual {
        Some(actual) if actual <= required => {}
        Some(_) => reasons.push(format!("{name} exceeds policy")),
        None => reasons.push(format!("{name} evidence is unavailable")),
    }
}

fn check_optional_minimum(
    name: &str,
    actual: Option<f64>,
    required: Option<f64>,
    reasons: &mut Vec<String>,
) {
    let Some(required) = required else { return };
    match actual {
        Some(actual) if actual >= required => {}
        Some(_) => reasons.push(format!("{name} is below policy")),
        None => reasons.push(format!("{name} evidence is unavailable")),
    }
}

#[async_trait]
pub(super) trait GraduationAnalyzer: Send + Sync {
    async fn analyze(&self, query: &GraduationQuery) -> Result<Vec<GraduationCandidate>>;
}

pub(super) struct StdbGraduationAnalyzer<'a> {
    pub reader: &'a StdbClient,
}

#[derive(Clone, Debug)]
struct CaseRow {
    id: u64,
    request_hash: String,
    context_fingerprint: String,
    program_ref: String,
    step_id: String,
    selected: Value,
    material_constraints: Value,
    status: String,
    outcome_status: String,
    correction_of: Option<u64>,
    provider_attempt_id: Option<u64>,
}

#[derive(Clone, Debug)]
struct DecisionEventRow {
    request_hash: String,
    event_kind: String,
    request: Value,
    output: Option<Value>,
    shadow_error: Option<String>,
}

#[async_trait]
impl GraduationAnalyzer for StdbGraduationAnalyzer<'_> {
    async fn analyze(&self, query: &GraduationQuery) -> Result<Vec<GraduationCandidate>> {
        query.validate()?;

        let cases = self.load_cases(query).await?;
        let events = self.load_events(query).await?;
        let economics = self.load_provider_economics(query).await?;

        let event_by_request = events
            .iter()
            .filter(|event| event.event_kind == "decision")
            .map(|event| (event.request_hash.as_str(), event))
            .collect::<HashMap<_, _>>();
        let mut by_fingerprint: BTreeMap<String, Vec<CaseRow>> = BTreeMap::new();
        for case in cases {
            if case.context_fingerprint.trim().is_empty() {
                continue;
            }
            let fingerprint = applicability_fingerprint(
                &query.decision_type,
                &case,
                event_by_request.get(case.request_hash.as_str()).copied(),
            )?;
            by_fingerprint.entry(fingerprint).or_default().push(case);
        }

        let mut candidates = Vec::new();
        for (fingerprint, cohort) in by_fingerprint {
            if cohort.len() < query.minimum_cases_per_cohort as usize {
                continue;
            }
            let request_hashes = cohort
                .iter()
                .map(|case| case.request_hash.as_str())
                .collect::<HashSet<_>>();
            let cohort_events = events
                .iter()
                .filter(|event| request_hashes.contains(event.request_hash.as_str()))
                .collect::<Vec<_>>();
            let metrics = compute_metrics(
                query.decision_type.clone(),
                fingerprint.clone(),
                &cohort,
                &cohort_events,
                &economics,
            )?;
            let dominant_selected = dominant_value(cohort.iter().map(|case| &case.selected))
                .unwrap_or(Value::Null);
            candidates.push(GraduationCandidate {
                decision_type: query.decision_type.clone(),
                applicability_fingerprint: fingerprint,
                supporting_case_ids: cohort.iter().map(|case| case.id).collect(),
                dominant_selected,
                proposed_expression_kind: expression_kind(&cohort_events),
                metrics,
            });
        }

        candidates.sort_by(|a, b| {
            b.metrics
                .observed_cases
                .cmp(&a.metrics.observed_cases)
                .then_with(|| {
                    a.metrics
                        .decision_entropy
                        .partial_cmp(&b.metrics.decision_entropy)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
        });
        Ok(candidates)
    }
}

impl StdbGraduationAnalyzer<'_> {
    async fn load_cases(&self, query: &GraduationQuery) -> Result<Vec<CaseRow>> {
        let sql = format!(
            "SELECT * FROM ai_decision_case WHERE organization_id = {} AND company_id = {} \
             AND decision_type_name = '{}' AND decision_type_version = {} LIMIT {}",
            query.organization_id,
            query.company_id,
            sql_escape(&query.decision_type.name),
            query.decision_type.version,
            query.max_cases
        );
        self.reader
            .query_sql(&sql)
            .await
            .context("query decision cases for graduation analysis")?
            .iter()
            .map(decode_case)
            .collect()
    }

    async fn load_events(&self, query: &GraduationQuery) -> Result<Vec<DecisionEventRow>> {
        let sql = format!(
            "SELECT * FROM ai_intelligence_event WHERE organization_id = {} AND company_id = {} \
             AND decision_type_name = '{}' AND decision_type_version = {} LIMIT {}",
            query.organization_id,
            query.company_id,
            sql_escape(&query.decision_type.name),
            query.decision_type.version,
            query.max_cases.saturating_mul(4).min(MAX_ANALYSIS_ROWS)
        );
        self.reader
            .query_sql(&sql)
            .await
            .context("query intelligence events for graduation analysis")?
            .iter()
            .map(decode_event)
            .collect()
    }

    async fn load_provider_economics(
        &self,
        query: &GraduationQuery,
    ) -> Result<HashMap<u64, ProviderEconomics>> {
        let attempts = self
            .reader
            .query_sql(&format!(
                "SELECT * FROM ai_provider_attempt WHERE organization_id = {} AND company_id = {} LIMIT {}",
                query.organization_id, query.company_id, query.max_cases
            ))
            .await
            .context("query provider attempts for graduation economics")?;

        let reservations = self
            .reader
            .query_sql(&format!(
                "SELECT * FROM ai_spend_reservation WHERE organization_id = {} AND company_id = {} LIMIT {}",
                query.organization_id, query.company_id, query.max_cases
            ))
            .await
            .context("query spend reservations for graduation economics")?;
        let settled_by_id = reservations
            .iter()
            .filter_map(|row| {
                Some((
                    row_u64(row, "id")?,
                    row_u64(row, "settledUnits").unwrap_or_default(),
                ))
            })
            .collect::<HashMap<_, _>>();

        Ok(attempts
            .iter()
            .filter_map(|row| {
                let id = row_u64(row, "id")?;
                let reservation_id = row_u64(row, "reservationId")?;
                let latency_ms = timestamp_micros(row_value(row, "finishedAt"))
                    .zip(timestamp_micros(row_value(row, "dispatchedAt")))
                    .map(|(finished, dispatched)| {
                        finished.saturating_sub(dispatched).max(0) as u64 / 1_000
                    });
                Some((
                    id,
                    ProviderEconomics {
                        cost_microunits: settled_by_id.get(&reservation_id).copied(),
                        latency_ms,
                    },
                ))
            })
            .collect())
    }
}

#[derive(Clone, Copy, Debug)]
struct ProviderEconomics {
    cost_microunits: Option<u64>,
    latency_ms: Option<u64>,
}

fn compute_metrics(
    decision_type: DecisionTypeRef,
    fingerprint: String,
    cases: &[CaseRow],
    events: &[&DecisionEventRow],
    economics: &HashMap<u64, ProviderEconomics>,
) -> Result<GraduationMetrics> {
    let observed_cases = cases.len() as u64;
    let verified_cases = cases
        .iter()
        .filter(|case| matches!(case.status.as_str(), "verified" | "reviewed" | "approved"))
        .count() as u64;
    let reviewed_cases = cases
        .iter()
        .filter(|case| matches!(case.status.as_str(), "reviewed" | "approved"))
        .count() as u64;
    let corrected = cases
        .iter()
        .filter(|case| case.correction_of.is_some() || case.status == "superseded")
        .count() as u64;
    let correction_rate = ratio(corrected, observed_cases);
    let verified_outcomes = cases
        .iter()
        .filter(|case| case.outcome_status != "unknown")
        .count() as u64;
    let verified_outcome_rate = ratio(verified_outcomes, observed_cases);
    let decision_entropy = normalized_entropy(cases.iter().map(|case| &case.selected));
    let precedent_consistency = dominant_ratio(
        cases
            .iter()
            .filter(|case| matches!(case.status.as_str(), "verified" | "reviewed" | "approved"))
            .map(|case| &case.selected),
    );
    let evidence_shape_stability = dominant_shape_ratio(
        cases.iter().map(|case| &case.material_constraints),
    );

    let (provider_disagreement_rate, shadow_cases) = shadow_disagreement(events)?;
    let candidate_set_stability = candidate_set_stability(events);

    let case_attempt_ids = cases
        .iter()
        .filter_map(|case| case.provider_attempt_id)
        .collect::<Vec<_>>();
    let costs = case_attempt_ids
        .iter()
        .filter_map(|id| economics.get(id).and_then(|value| value.cost_microunits))
        .collect::<Vec<_>>();
    let latencies = case_attempt_ids
        .iter()
        .filter_map(|id| economics.get(id).and_then(|value| value.latency_ms))
        .collect::<Vec<_>>();

    Ok(GraduationMetrics {
        decision_type,
        applicability_fingerprint: fingerprint,
        observed_cases,
        verified_cases,
        reviewed_cases,
        correction_rate,
        verified_outcome_rate,
        provider_disagreement_rate,
        shadow_cases,
        decision_entropy,
        precedent_consistency,
        // Decision cases currently do not persist a policy-version ref. Do not
        // fabricate stability from program_ref; DG-03 will make it measurable.
        policy_stability_rate: None,
        evidence_shape_stability,
        candidate_set_stability,
        average_cost_microunits: average_u64(&costs),
        average_latency_ms: average_u64(&latencies),
    })
}

fn shadow_disagreement(events: &[&DecisionEventRow]) -> Result<(Option<f64>, u64)> {
    let mut primary = HashMap::<&str, String>::new();
    let mut shadows = Vec::<(&str, String)>::new();

    for event in events {
        if event.shadow_error.is_some() {
            continue;
        }
        let Some(output) = &event.output else { continue };
        let canonical = canonical_json(&decision_signal(output))?;
        match event.event_kind.as_str() {
            "decision" => {
                primary.insert(event.request_hash.as_str(), canonical);
            }
            "decision_shadow" => shadows.push((event.request_hash.as_str(), canonical)),
            _ => {}
        }
    }
    let comparable = shadows
        .iter()
        .filter_map(|(hash, shadow)| primary.get(hash).map(|production| (*production, shadow)))
        .collect::<Vec<_>>();
    if comparable.is_empty() {
        return Ok((None, 0));
    }
    let disagreements = comparable
        .iter()
        .filter(|(production, shadow)| *production != *shadow)
        .count() as u64;
    Ok((
        Some(ratio(disagreements, comparable.len() as u64)),
        comparable.len() as u64,
    ))
}

fn candidate_set_stability(events: &[&DecisionEventRow]) -> Option<f64> {
    let hashes = events
        .iter()
        .filter(|event| event.event_kind == "decision")
        .filter_map(|event| event.request.get("candidates").and_then(Value::as_array))
        .map(|candidates| canonical_string_list(candidates))
        .collect::<Vec<_>>();
    if hashes.is_empty() {
        return None;
    }
    Some(dominant_string_ratio(hashes.iter().map(String::as_str)))
}

fn expression_kind(events: &[&DecisionEventRow]) -> DeterministicExpressionKind {
    let kind = events
        .iter()
        .find(|event| event.event_kind == "decision")
        .and_then(|event| event.request.get("kind"))
        .and_then(Value::as_str);
    match kind {
        Some("choice") => DeterministicExpressionKind::LookupPolicy,
        Some("score" | "probability") => DeterministicExpressionKind::ThresholdPolicy,
        _ => DeterministicExpressionKind::NotExpressible,
    }
}

fn applicability_fingerprint(
    decision_type: &DecisionTypeRef,
    case: &CaseRow,
    event: Option<&DecisionEventRow>,
) -> Result<String> {
    let candidate_set_hash = event
        .and_then(|event| event.request.get("candidates"))
        .and_then(Value::as_array)
        .map(|values| canonical_string_list(values))
        .unwrap_or_else(|| "no-candidate-set".to_string());
    let evidence_shape = value_shape(&case.material_constraints);
    let material = format!(
        "{}@{}\n{}\n{}\n{}\n{}\n{}",
        decision_type.name,
        decision_type.version,
        case.program_ref,
        case.step_id,
        case.context_fingerprint,
        candidate_set_hash,
        evidence_shape,
    );
    let mut hasher = Sha256::new();
    hasher.update(material.as_bytes());
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

fn decision_signal(output: &Value) -> Value {
    let mut signal = serde_json::Map::new();
    for key in ["kind", "choice", "score", "probability"] {
        if let Some(value) = output.get(key) {
            signal.insert(key.to_string(), value.clone());
        }
    }
    Value::Object(signal)
}

fn decode_case(row: &Value) -> Result<CaseRow> {
    Ok(CaseRow {
        id: row_u64(row, "id").context("decision case id missing")?,
        request_hash: row_string(row, "requestHash").context("decision case request hash missing")?,
        context_fingerprint: row_string(row, "contextFingerprint")
            .context("decision case context fingerprint missing")?,
        program_ref: row_string(row, "programRef").context("decision case program_ref missing")?,
        step_id: row_string(row, "stepId").context("decision case step_id missing")?,
        selected: parse_json_string(row, "selectedJson")?,
        material_constraints: parse_json_string(row, "materialConstraintsJson")?,
        status: row_string(row, "status").unwrap_or_else(|| "observed".into()),
        outcome_status: row_string(row, "outcomeStatus").unwrap_or_else(|| "unknown".into()),
        correction_of: row_u64(row, "correctionOf"),
        provider_attempt_id: row_u64(row, "providerAttemptId"),
    })
}

fn decode_event(row: &Value) -> Result<DecisionEventRow> {
    let output = row_string(row, "outputJson")
        .filter(|value| !value.trim().is_empty())
        .map(|value| serde_json::from_str(&value).context("parse intelligence output_json"))
        .transpose()?;
    Ok(DecisionEventRow {
        request_hash: row_string(row, "requestHash").context("event request hash missing")?,
        event_kind: row_string(row, "eventKind").context("event kind missing")?,
        request: parse_json_string(row, "requestJson")?,
        output,
        shadow_error: row_string(row, "shadowError"),
    })
}

fn parse_json_string(row: &Value, key: &str) -> Result<Value> {
    let raw = row_string(row, key).with_context(|| format!("{key} missing"))?;
    serde_json::from_str(&raw).with_context(|| format!("parse {key}"))
}

fn canonical_json(value: &Value) -> Result<String> {
    let canonical = canonicalize(value);
    serde_json::to_string(&canonical).context("serialize canonical JSON")
}

fn canonicalize(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let sorted = object
                .iter()
                .map(|(key, value)| (key.clone(), canonicalize(value)))
                .collect::<BTreeMap<_, _>>();
            Value::Object(sorted.into_iter().collect())
        }
        Value::Array(items) => Value::Array(items.iter().map(canonicalize).collect()),
        _ => value.clone(),
    }
}

fn normalized_entropy<'a>(values: impl Iterator<Item = &'a Value>) -> f64 {
    let counts = frequency(values);
    let total = counts.values().sum::<u64>();
    if total <= 1 || counts.len() <= 1 {
        return 0.0;
    }
    let entropy = counts.values().fold(0.0, |acc, count| {
        let p = *count as f64 / total as f64;
        acc - p * p.log2()
    });
    let max_entropy = (counts.len() as f64).log2();
    if max_entropy == 0.0 { 0.0 } else { entropy / max_entropy }
}

fn dominant_ratio<'a>(values: impl Iterator<Item = &'a Value>) -> f64 {
    let counts = frequency(values);
    let total = counts.values().sum::<u64>();
    let dominant = counts.values().copied().max().unwrap_or_default();
    ratio(dominant, total)
}

fn dominant_value<'a>(values: impl Iterator<Item = &'a Value>) -> Option<Value> {
    let mut counts = HashMap::<String, (u64, Value)>::new();
    for value in values {
        let key = canonical_json(value).ok()?;
        let entry = counts.entry(key).or_insert((0, value.clone()));
        entry.0 += 1;
    }
    counts.into_values().max_by_key(|(count, _)| *count).map(|(_, value)| value)
}

fn frequency<'a>(values: impl Iterator<Item = &'a Value>) -> HashMap<String, u64> {
    let mut counts = HashMap::new();
    for value in values {
        if let Ok(key) = canonical_json(value) {
            *counts.entry(key).or_insert(0) += 1;
        }
    }
    counts
}

fn dominant_shape_ratio<'a>(values: impl Iterator<Item = &'a Value>) -> f64 {
    let shapes = values.map(value_shape).collect::<Vec<_>>();
    dominant_string_ratio(shapes.iter().map(String::as_str))
}

fn value_shape(value: &Value) -> String {
    match value {
        Value::Object(object) => {
            let mut parts = object
                .iter()
                .map(|(key, value)| format!("{key}:{}", json_type(value)))
                .collect::<Vec<_>>();
            parts.sort();
            parts.join("|")
        }
        _ => json_type(value).to_string(),
    }
}

fn json_type(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn canonical_string_list(values: &[Value]) -> String {
    let mut items = values.iter().map(Value::to_string).collect::<Vec<_>>();
    items.sort();
    let mut hasher = Sha256::new();
    hasher.update(items.join("\n").as_bytes());
    format!("{:x}", hasher.finalize())
}

fn dominant_string_ratio<'a>(values: impl Iterator<Item = &'a str>) -> f64 {
    let mut counts = HashMap::<&str, u64>::new();
    let mut total = 0_u64;
    for value in values {
        *counts.entry(value).or_insert(0) += 1;
        total += 1;
    }
    ratio(counts.values().copied().max().unwrap_or_default(), total)
}

fn ratio(numerator: u64, denominator: u64) -> f64 {
    if denominator == 0 { 0.0 } else { numerator as f64 / denominator as f64 }
}

fn average_u64(values: &[u64]) -> Option<u64> {
    if values.is_empty() {
        return None;
    }
    let total = values.iter().map(|value| u128::from(*value)).sum::<u128>();
    Some((total / values.len() as u128).min(u128::from(u64::MAX)) as u64)
}

#[async_trait]
pub(super) trait GraduationPolicyStore: Send + Sync {
    async fn policy_for(&self, decision_type: &DecisionTypeRef) -> Result<GraduationPolicy>;
}

pub(super) struct StdbGraduationPolicyStore<'a> {
    pub reader: &'a StdbClient,
    pub organization_id: u64,
}

#[async_trait]
impl GraduationPolicyStore for StdbGraduationPolicyStore<'_> {
    async fn policy_for(&self, decision_type: &DecisionTypeRef) -> Result<GraduationPolicy> {
        decision_type.validate()?;
        if self.organization_id == 0 {
            bail!("graduation policy store requires nonzero organization_id");
        }
        let rows = self
            .reader
            .query_sql(&format!(
                "SELECT precedent_policy_json FROM ai_decision_type_definition \
                 WHERE organization_id = {} AND decision_type_name = '{}' \
                 AND decision_type_version = {} LIMIT 1",
                self.organization_id,
                sql_escape(&decision_type.name),
                decision_type.version
            ))
            .await
            .context("load DecisionType graduation policy")?;
        let Some(row) = rows.first() else {
            return Ok(GraduationPolicy::disabled());
        };
        let envelope = parse_json_string(row, "precedentPolicyJson")?;
        let Some(value) = envelope.get("graduation") else {
            return Ok(GraduationPolicy::disabled());
        };
        let policy: GraduationPolicy =
            serde_json::from_value(value.clone()).context("decode graduation policy")?;
        policy.validate()?;
        Ok(policy)
    }
}

fn row_value<'a>(row: &'a Value, key: &str) -> Option<&'a Value> {
    let snake = camel_to_snake(key);
    row.get(key).or_else(|| row.get(&snake))
}

fn row_u64(row: &Value, key: &str) -> Option<u64> {
    row_value(row, key).and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
}

fn row_string(row: &Value, key: &str) -> Option<String> {
    row_value(row, key).and_then(Value::as_str).map(str::to_string)
}

fn timestamp_micros(value: Option<&Value>) -> Option<i64> {
    let value = value?;
    value
        .as_object()
        .and_then(|object| object.get("__timestamp_micros_since_unix_epoch__"))
        .and_then(Value::as_i64)
        .or_else(|| value.as_i64())
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

#[cfg(test)]
mod tests {
    use super::*;

    fn metrics() -> GraduationMetrics {
        GraduationMetrics {
            decision_type: DecisionTypeRef {
                name: "Test".into(),
                version: 1,
            },
            applicability_fingerprint: "fp".into(),
            observed_cases: 50,
            verified_cases: 40,
            reviewed_cases: 20,
            correction_rate: 0.01,
            verified_outcome_rate: 0.9,
            provider_disagreement_rate: Some(0.02),
            shadow_cases: 20,
            decision_entropy: 0.05,
            precedent_consistency: 0.98,
            policy_stability_rate: Some(1.0),
            evidence_shape_stability: 1.0,
            candidate_set_stability: Some(1.0),
            average_cost_microunits: Some(12),
            average_latency_ms: Some(50),
        }
    }

    #[test]
    fn eligibility_fails_closed_when_required_metric_is_unavailable() {
        let mut policy = GraduationPolicy::disabled();
        policy.enabled = true;
        policy.minimum_policy_stability = Some(0.95);
        let mut actual = metrics();
        actual.policy_stability_rate = None;
        let result = policy.evaluate(&actual);
        assert!(!result.eligible);
        assert!(result.reasons.iter().any(|reason| reason.contains("unavailable")));
    }

    #[test]
    fn stable_metrics_are_candidate_eligible_but_do_not_promote_anything() {
        let mut policy = GraduationPolicy::disabled();
        policy.enabled = true;
        policy.minimum_policy_stability = Some(0.95);
        let result = policy.evaluate(&metrics());
        assert!(result.eligible, "{:?}", result.reasons);
    }

    #[test]
    fn entropy_is_zero_for_identical_outputs_and_one_for_balanced_binary_outputs() {
        let a = serde_json::json!("a");
        let b = serde_json::json!("b");
        assert_eq!(normalized_entropy([&a, &a, &a].into_iter()), 0.0);
        assert!((normalized_entropy([&a, &b].into_iter()) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn evidence_shape_stability_ignores_values_but_not_types_or_keys() {
        let a = serde_json::json!({"amount": 10, "currency": "EUR"});
        let b = serde_json::json!({"amount": 20, "currency": "USD"});
        let c = serde_json::json!({"amount": "20", "currency": "USD"});
        assert_eq!(dominant_shape_ratio([&a, &b].into_iter()), 1.0);
        assert!(dominant_shape_ratio([&a, &b, &c].into_iter()) > 0.5);
    }
}
