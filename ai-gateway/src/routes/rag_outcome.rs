//! AIH-33: per-turn answer outcome for chat (RAG) runs.
//!
//! Every RAG turn records one content-free outcome on its durable run as a
//! single `ai_agent_run_step` (existing table and reducer, no schema change).
//! The outcome carries only closed vocabulary and numbers: the
//! [`WithholdReason`], provider, model, request language, a plan-kind
//! placeholder, token spend and the repair attempt count. It never carries the
//! question, the answer, claim text, evidence or provider error text.
//!
//! The admin read aggregates the last seven days into a withhold rate by
//! reason and model for the acting user's company.

use std::collections::BTreeMap;

use axum::{
    extract::State,
    http::{header::CACHE_CONTROL, HeaderMap, HeaderValue},
    response::{IntoResponse, Response},
    Json,
};
use lumiere_auth_context::ActorContext;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use stdb_client::StdbClient;

use crate::{
    error::{AppError, AppResult},
    orchestrator::text_answer_gate::WithholdReason,
    routes::evidence::require_scoped_capability_grant,
    state::AppState,
};

/// Step tool name that marks an outcome record.
pub(crate) const OUTCOME_STEP_TOOL: &str = "rag_answer_outcome";
const OUTCOME_VERSION: u8 = 1;
/// Admin read capability: the same exact grant as run history and review.
const OUTCOME_READ_CAPABILITY: &str = "ai.evidence.inspect";
pub(crate) const WINDOW_DAYS: i64 = 7;
const WINDOW_MICROS: i64 = WINDOW_DAYS * 24 * 60 * 60 * 1_000_000;
/// Upper bound on one read. SpacetimeDB's HTTP SQL has no ordering, so a window
/// larger than this is reported as `truncated` instead of silently partial.
const MAX_OUTCOME_ROWS: usize = 20_000;
const MAX_LANGUAGE_BYTES: usize = 35;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RagOutcome {
    pub v: u8,
    pub company_id: u64,
    pub recorded_at_micros: i64,
    pub released: bool,
    pub withhold_reason: Option<WithholdReason>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub language: Option<String>,
    /// Reserved for the read planner (AIH-32); always null until it lands.
    pub plan_kind: Option<String>,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub repair_attempts: u32,
    pub repair_input_tokens: u32,
    pub repair_output_tokens: u32,
}

impl RagOutcome {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        company_id: u64,
        released: bool,
        withhold_reason: Option<WithholdReason>,
        provider: Option<String>,
        model: Option<String>,
        language: Option<String>,
        spend: Spend,
    ) -> Self {
        Self {
            v: OUTCOME_VERSION,
            company_id,
            recorded_at_micros: chrono::Utc::now().timestamp_micros(),
            released,
            withhold_reason: withhold_reason.filter(|_| !released),
            provider,
            model,
            language,
            plan_kind: None,
            input_tokens: spend.input_tokens,
            output_tokens: spend.output_tokens,
            repair_attempts: spend.repair_attempts,
            repair_input_tokens: spend.repair_input_tokens,
            repair_output_tokens: spend.repair_output_tokens,
        }
    }
}

/// Generation spend of one turn, including the single repair attempt.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Spend {
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub repair_attempts: u32,
    pub repair_input_tokens: u32,
    pub repair_output_tokens: u32,
}

impl Spend {
    pub(crate) fn total_tokens(&self) -> u32 {
        self.input_tokens
            .saturating_add(self.output_tokens)
            .saturating_add(self.repair_input_tokens)
            .saturating_add(self.repair_output_tokens)
    }

    pub(crate) fn add_first(&mut self, input: u32, output: u32) {
        self.input_tokens = self.input_tokens.saturating_add(input);
        self.output_tokens = self.output_tokens.saturating_add(output);
    }

    pub(crate) fn add_repair(&mut self, input: u32, output: u32) {
        self.repair_input_tokens = self.repair_input_tokens.saturating_add(input);
        self.repair_output_tokens = self.repair_output_tokens.saturating_add(output);
    }
}

/// A request locale is metadata only. Keep a BCP-47-shaped tag, drop anything else.
pub(crate) fn normalize_language(locale: Option<&str>) -> Option<String> {
    let tag = locale?.trim();
    let valid = !tag.is_empty()
        && tag.len() <= MAX_LANGUAGE_BYTES
        && tag.split('-').enumerate().all(|(index, part)| {
            !part.is_empty()
                && part.len() <= 8
                && part.bytes().all(|byte| byte.is_ascii_alphanumeric())
                && (index > 0 || part.bytes().all(|byte| byte.is_ascii_alphabetic()))
        });
    valid.then(|| tag.to_string())
}

/// Best-effort: a failed write is logged and never changes the answer or run.
pub(crate) async fn record_outcome(
    stdb: &StdbClient,
    organization_id: u64,
    run_id: u64,
    outcome: &RagOutcome,
) {
    let Ok(summary) = serde_json::to_string(outcome) else {
        return;
    };
    if let Err(error) = crate::tools::registry::persist_step(
        stdb,
        organization_id,
        outcome.company_id,
        run_id,
        1,
        OUTCOME_STEP_TOOL,
        "",
        &summary,
        None,
        None,
        0,
        None,
    )
    .await
    {
        tracing::warn!(run_id, error = %format!("{error:#}"), "RAG outcome was not recorded");
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelTotal {
    pub provider: Option<String>,
    pub model: Option<String>,
    pub turns: u64,
    pub withheld: u64,
    pub repaired: u64,
    pub withhold_rate: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReasonCell {
    pub provider: Option<String>,
    pub model: Option<String>,
    pub reason: WithholdReason,
    pub withheld: u64,
    /// `withheld` over all turns for the same provider and model.
    pub rate: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WithholdReport {
    pub window_days: i64,
    pub turns: u64,
    pub withheld: u64,
    pub withhold_rate: f64,
    pub models: Vec<ModelTotal>,
    pub by_reason_and_model: Vec<ReasonCell>,
    /// True when the read hit its row bound: counts may under-report.
    pub truncated: bool,
}

fn rate(part: u64, whole: u64) -> f64 {
    if whole == 0 {
        0.0
    } else {
        ((part as f64 / whole as f64) * 10_000.0).round() / 10_000.0
    }
}

/// Aggregate outcomes of one company recorded in the window ending at `now`.
pub(crate) fn aggregate(
    outcomes: &[RagOutcome],
    company_id: u64,
    now_micros: i64,
    truncated: bool,
) -> WithholdReport {
    type Key = (Option<String>, Option<String>);
    let mut totals: BTreeMap<Key, (u64, u64, u64)> = BTreeMap::new();
    let mut cells: BTreeMap<(Key, WithholdReason), u64> = BTreeMap::new();
    let (mut turns, mut withheld) = (0_u64, 0_u64);
    for outcome in outcomes.iter().filter(|outcome| {
        outcome.company_id == company_id
            && outcome.recorded_at_micros > now_micros - WINDOW_MICROS
            && outcome.recorded_at_micros <= now_micros
    }) {
        let key = (outcome.provider.clone(), outcome.model.clone());
        let total = totals.entry(key.clone()).or_default();
        total.0 += 1;
        turns += 1;
        if outcome.repair_attempts > 0 && outcome.released {
            total.2 += 1;
        }
        if let Some(reason) = outcome.withhold_reason.filter(|_| !outcome.released) {
            total.1 += 1;
            withheld += 1;
            *cells.entry((key, reason)).or_default() += 1;
        }
    }
    let models = totals
        .iter()
        .map(
            |((provider, model), (turns, withheld, repaired))| ModelTotal {
                provider: provider.clone(),
                model: model.clone(),
                turns: *turns,
                withheld: *withheld,
                repaired: *repaired,
                withhold_rate: rate(*withheld, *turns),
            },
        )
        .collect();
    let mut by_reason_and_model: Vec<ReasonCell> = cells
        .into_iter()
        .map(|(((provider, model), reason), count)| {
            let model_turns = totals
                .get(&(provider.clone(), model.clone()))
                .map_or(0, |total| total.0);
            ReasonCell {
                provider,
                model,
                reason,
                withheld: count,
                rate: rate(count, model_turns),
            }
        })
        .collect();
    by_reason_and_model.sort_by(|a, b| {
        b.withheld
            .cmp(&a.withheld)
            .then_with(|| a.reason.cmp(&b.reason))
    });
    WithholdReport {
        window_days: WINDOW_DAYS,
        turns,
        withheld,
        withhold_rate: rate(withheld, turns),
        models,
        by_reason_and_model,
        truncated,
    }
}

fn parse_rows(rows: &[Value]) -> Vec<RagOutcome> {
    rows.iter()
        .filter_map(|row| {
            row.get("output_summary")
                .or_else(|| row.get("outputSummary"))
        })
        .filter_map(Value::as_str)
        .filter_map(|summary| serde_json::from_str::<RagOutcome>(summary).ok())
        .filter(|outcome| outcome.v == OUTCOME_VERSION)
        .collect()
}

async fn read_outcomes(
    stdb: &StdbClient,
    organization_id: u64,
) -> AppResult<(Vec<RagOutcome>, bool)> {
    let rows = stdb
        .query_sql(&format!(
            "SELECT output_summary FROM ai_agent_run_step WHERE organization_id = {organization_id} AND tool_name = '{OUTCOME_STEP_TOOL}' LIMIT {}",
            MAX_OUTCOME_ROWS + 1
        ))
        .await
        .map_err(|error| AppError::Internal(format!("read RAG outcomes: {error}")))?;
    let truncated = rows.len() > MAX_OUTCOME_ROWS;
    Ok((parse_rows(&rows), truncated))
}

/// Withhold rate by reason and model for the last seven days, for the acting
/// user's own company. Needs the same exact grant as run history; counts and
/// closed vocabulary only.
pub async fn post_rag_outcomes(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Response> {
    let actor = ActorContext::from_headers(&headers)?;
    require_scoped_capability_grant(
        &state,
        &actor.identity,
        &actor.token,
        actor.organization_id,
        actor.company_id,
        OUTCOME_READ_CAPABILITY,
    )
    .await?;
    let (outcomes, truncated) = read_outcomes(state.stdb.as_ref(), actor.organization_id).await?;
    let report = aggregate(
        &outcomes,
        actor.company_id,
        chrono::Utc::now().timestamp_micros(),
        truncated,
    );
    let mut response = Json(report).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000_000_000;
    const DAY: i64 = 86_400_000_000;

    fn outcome(
        model: &str,
        age_days: i64,
        reason: Option<WithholdReason>,
        repair_attempts: u32,
    ) -> RagOutcome {
        let mut outcome = RagOutcome::new(
            7,
            reason.is_none(),
            reason,
            Some("anthropic".into()),
            Some(model.into()),
            Some("fr".into()),
            Spend {
                repair_attempts,
                ..Spend::default()
            },
        );
        outcome.recorded_at_micros = NOW - age_days * DAY;
        outcome
    }

    #[test]
    fn counts_withhold_rate_by_reason_and_model_for_seven_days() {
        let outcomes = vec![
            outcome("a", 1, None, 0),
            outcome("a", 2, Some(WithholdReason::CoverageGap), 1),
            outcome("a", 3, Some(WithholdReason::CoverageGap), 0),
            outcome("a", 3, None, 1),
            outcome("b", 1, Some(WithholdReason::UnsupportedClaim), 0),
            outcome("a", 8, Some(WithholdReason::NoClaims), 0),
            {
                let mut other_company = outcome("a", 1, Some(WithholdReason::NoClaims), 0);
                other_company.company_id = 8;
                other_company
            },
        ];
        let report = aggregate(&outcomes, 7, NOW, false);
        assert_eq!((report.turns, report.withheld), (5, 3));
        let a = report
            .models
            .iter()
            .find(|m| m.model.as_deref() == Some("a"))
            .unwrap();
        assert_eq!((a.turns, a.withheld, a.repaired), (4, 2, 1));
        assert_eq!(a.withhold_rate, 0.5);
        let cell = &report.by_reason_and_model[0];
        assert_eq!(cell.reason, WithholdReason::CoverageGap);
        assert_eq!((cell.withheld, cell.rate), (2, 0.5));
        assert!(!report.truncated);
    }

    #[test]
    fn rows_without_a_valid_outcome_are_ignored() {
        let valid = serde_json::to_string(&outcome("a", 0, None, 0)).unwrap();
        let rows = vec![
            serde_json::json!({ "output_summary": valid }),
            serde_json::json!({ "output_summary": "not json" }),
            serde_json::json!({ "output_summary": "{\"v\":2}" }),
        ];
        assert_eq!(parse_rows(&rows).len(), 1);
    }

    #[test]
    fn outcome_record_is_closed_vocabulary_only() {
        let json =
            serde_json::to_value(outcome("a", 0, Some(WithholdReason::AccessChanged), 0)).unwrap();
        assert_eq!(json["withholdReason"], "access_changed");
        assert!(json["planKind"].is_null());
        let keys: Vec<&str> = json
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert!(keys
            .iter()
            .all(|key| !matches!(*key, "query" | "answer" | "claims")));
    }

    #[test]
    fn language_is_a_bounded_tag_or_dropped() {
        for ok in ["en", "fr", "rw", "sw", "pt-BR"] {
            assert_eq!(normalize_language(Some(ok)).as_deref(), Some(ok));
        }
        for bad in ["", "e n", "en_US", "<script>", "pt-", "1x", &"a".repeat(40)] {
            assert_eq!(normalize_language(Some(bad)), None, "{bad}");
        }
        assert_eq!(normalize_language(None), None);
    }
}
