//! AIH-7/8/9 — Run list and step transcript read surface.
//!
//! `GET /v1/runs` lists recent `ai_agent_run` rows (filterable by company,
//! skill, agent and outcome) with skill/agent names resolved in Rust, and
//! `GET /v1/runs/:run_id/steps` returns the full step transcript plus provider
//! attempts and the settled/reserved cost for one run.
//!
//! SQL notes: SpacetimeDB HTTP SQL supports neither `SELECT *` nor `JOIN`
//! (see `docs/guides/spacetimedb-http-sql-limitations.md`), so every query
//! projects an explicit column list and skill/agent names are resolved with
//! two extra org-scoped queries joined in Rust. Timestamps are compared with
//! RFC 3339 literals, matching the api-server report queries.

use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::Serialize;
use serde_json::Value;
use stdb_client::StdbClient;

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

/// `ai_agent_run.status` values, mirroring the module's transitions
/// (including the `set_ai_agent_run_wait_state` wait states).
pub(crate) const STATUS_ALLOWLIST: [&str; 7] = [
    "pending",
    "running",
    "completed",
    "failed",
    "cancelled",
    "awaiting_approval",
    "agent_settled",
];

const DEFAULT_DAYS: u32 = 7;
const MAX_DAYS: u32 = 90;
const DEFAULT_LIMIT: u32 = 50;
const MAX_LIMIT: u32 = 200;
const SUMMARY_MAX_CHARS: usize = 200;

const STATUS_SETTLED: &str = "settled";
const STATUS_RESERVED: &str = "reserved";

/// `inputs_json` and `artifacts_json` are deliberately not projected; the
/// transcript payload stays minimal.
const RUN_COLUMNS: &str = "id, run_key, organization_id, company_id, skill_id, agent_id, \
                           status, step_count, tokens_used, error_message, summary, started_at, \
                           completed_at, triggered_by_hex";
const STEP_COLUMNS: &str = "id, step_no, tool_name, input_hash, output_summary, \
                            output_row_count, citations_json, duration_ms, error_message, \
                            created_at";
const ATTEMPT_COLUMNS: &str =
    "id, provider, model, status, input_tokens, output_tokens, failure_reason";
const RESERVATION_COLUMNS: &str = "id, status, reserved_units, settled_units, currency";

#[derive(Debug, Serialize)]
pub struct RunListItem {
    pub id: u64,
    pub run_key: String,
    pub organization_id: u64,
    pub company_id: u64,
    pub skill_id: u64,
    pub skill_key: Option<String>,
    pub skill_name: Option<String>,
    pub agent_id: u64,
    pub agent_name: Option<String>,
    pub status: String,
    pub step_count: u32,
    pub tokens_used: u32,
    pub error_message: Option<String>,
    pub summary: Option<String>,
    pub started_at: u64,
    pub completed_at: Option<u64>,
    pub triggered_by_hex: String,
}

#[derive(Debug, Serialize)]
pub struct ListRunsResponse {
    pub runs: Vec<RunListItem>,
}

#[derive(Debug, Serialize)]
pub struct RunStepItem {
    pub id: u64,
    pub step_no: u32,
    pub tool_name: String,
    pub input_hash: String,
    pub output_summary: String,
    pub output_row_count: Option<u32>,
    pub citations_json: Option<String>,
    pub duration_ms: u64,
    pub error_message: Option<String>,
    pub created_at: u64,
}

#[derive(Debug, Serialize)]
pub struct ProviderAttemptItem {
    pub id: u64,
    pub provider: String,
    pub model: String,
    pub status: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub failure_reason: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RunCost {
    pub available: bool,
    pub settled_units: Option<u64>,
    pub reserved_units: Option<u64>,
    pub currency: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RunStepsResponse {
    pub run: RunListItem,
    pub steps: Vec<RunStepItem>,
    pub attempts: Vec<ProviderAttemptItem>,
    pub cost: RunCost,
}

#[derive(Clone, Debug)]
pub(crate) struct SkillInfo {
    pub skill_key: String,
    pub name: String,
}

/// Validated query parameters for `GET /v1/runs`.
#[derive(Debug)]
pub(crate) struct ListRunsQuery {
    pub org_id: u64,
    pub company_id: Option<u64>,
    pub skill_id: Option<u64>,
    pub agent_id: Option<u64>,
    pub status: Option<&'static str>,
    pub days: u32,
    pub limit: u32,
}

pub async fn list_runs(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> AppResult<Json<ListRunsResponse>> {
    let query = parse_list_query(&params)?;
    let cutoff = cutoff_rfc3339(Utc::now(), query.days);
    let sql = build_runs_sql(&query, &cutoff);

    let rows = state
        .stdb
        .query_sql(&sql)
        .await
        .map_err(|e| AppError::Internal(format!("read ai_agent_run: {e}")))?;

    let (skills, agents) = if rows.is_empty() {
        (HashMap::new(), HashMap::new())
    } else {
        fetch_enrichment_maps(&state, query.org_id).await?
    };

    let runs = rows
        .iter()
        .map(|row| map_run_row(row, &skills, &agents))
        .collect();

    Ok(Json(ListRunsResponse { runs }))
}

pub async fn run_steps(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> AppResult<Json<RunStepsResponse>> {
    let run_id = run_id
        .trim()
        .parse::<u64>()
        .ok()
        .filter(|id| *id > 0)
        .ok_or_else(|| AppError::BadRequest("run_id must be a positive integer".into()))?;
    let org_id = required_positive(&params, "org_id")?;
    let company_id = required_positive(&params, "company_id")?;

    let run_sql = build_run_by_id_sql(org_id, company_id, run_id);
    let run_rows = state
        .stdb
        .query_sql(&run_sql)
        .await
        .map_err(|e| AppError::Internal(format!("read ai_agent_run: {e}")))?;
    let run_row = run_rows
        .into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound("run not found".into()))?;

    let steps_sql = build_steps_sql(org_id, run_id);
    let step_rows = state
        .stdb
        .query_sql(&steps_sql)
        .await
        .map_err(|e| AppError::Internal(format!("read ai_agent_run_step: {e}")))?;
    let steps: Vec<RunStepItem> = step_rows.iter().map(map_step_row).collect();

    let (skills, agents) = fetch_enrichment_maps(&state, org_id).await?;
    let run = map_run_row(&run_row, &skills, &agents);

    // Attempts and cost come from the private H5b spend tables through the
    // dedicated AI_SPEND_READ_STDB_TOKEN client (same choice as ai_spend.rs).
    // Neither may fail the transcript: on error or a missing read client the
    // attempts list is empty and cost reports available=false.
    let (attempts, cost) = match state.spend_read_stdb.as_ref() {
        Some(reader) => {
            let attempts = read_attempts(reader, org_id, run_id)
                .await
                .unwrap_or_else(|error| {
                    tracing::warn!(run_id, org_id, %error, "ai_provider_attempt read failed");
                    Vec::new()
                });
            let cost = read_cost(reader, org_id, run_id)
                .await
                .unwrap_or_else(|error| {
                    tracing::warn!(run_id, org_id, %error, "ai_spend_reservation read failed");
                    RunCost::unavailable()
                });
            (attempts, cost)
        }
        None => (Vec::new(), RunCost::unavailable()),
    };

    Ok(Json(RunStepsResponse {
        run,
        steps,
        attempts,
        cost,
    }))
}

// ── Private-table reads (spend-read client) ─────────────────────────────────

async fn read_attempts(
    reader: &StdbClient,
    org_id: u64,
    run_id: u64,
) -> anyhow::Result<Vec<ProviderAttemptItem>> {
    let sql = build_attempts_sql(org_id, run_id);
    let rows = reader
        .query_sql(&sql)
        .await
        .map_err(|e| anyhow::anyhow!("read ai_provider_attempt: {e}"))?;
    let mut attempts: Vec<ProviderAttemptItem> = rows.iter().map(map_attempt_row).collect();
    attempts.sort_by_key(|attempt| attempt.id);
    Ok(attempts)
}

async fn read_cost(reader: &StdbClient, org_id: u64, run_id: u64) -> anyhow::Result<RunCost> {
    let sql = build_reservations_sql(org_id, run_id);
    let rows = reader
        .query_sql(&sql)
        .await
        .map_err(|e| anyhow::anyhow!("read ai_spend_reservation: {e}"))?;
    Ok(aggregate_cost(&rows))
}

// ── Enrichment ──────────────────────────────────────────────────────────────

async fn fetch_enrichment_maps(
    state: &AppState,
    org_id: u64,
) -> AppResult<(HashMap<u64, SkillInfo>, HashMap<u64, String>)> {
    let skill_rows = state
        .stdb
        .query_sql(&build_skills_sql(org_id))
        .await
        .map_err(|e| AppError::Internal(format!("read ai_skill: {e}")))?;
    let agent_rows = state
        .stdb
        .query_sql(&build_agents_sql(org_id))
        .await
        .map_err(|e| AppError::Internal(format!("read ai_agent: {e}")))?;
    Ok((skill_map(&skill_rows), agent_map(&agent_rows)))
}

/// Resolve `ai_skill` rows (org-owned plus system-wide `organization_id = 0`)
/// into an id-keyed map.
fn skill_map(rows: &[Value]) -> HashMap<u64, SkillInfo> {
    rows.iter()
        .map(|row| {
            (
                row_u64(row, "id", "id"),
                SkillInfo {
                    skill_key: row_str(row, "skillKey", "skill_key"),
                    name: row_str(row, "name", "name"),
                },
            )
        })
        .collect()
}

fn agent_map(rows: &[Value]) -> HashMap<u64, String> {
    rows.iter()
        .map(|row| (row_u64(row, "id", "id"), row_str(row, "name", "name")))
        .collect()
}

// ── Row mappers ─────────────────────────────────────────────────────────────

fn map_run_row(
    row: &Value,
    skills: &HashMap<u64, SkillInfo>,
    agents: &HashMap<u64, String>,
) -> RunListItem {
    let skill_id = row_u64(row, "skillId", "skill_id");
    let agent_id = row_u64(row, "agentId", "agent_id");
    RunListItem {
        id: row_u64(row, "id", "id"),
        run_key: row_str(row, "runKey", "run_key"),
        organization_id: row_u64(row, "organizationId", "organization_id"),
        company_id: row_u64(row, "companyId", "company_id"),
        skill_id,
        skill_key: skills.get(&skill_id).map(|s| s.skill_key.clone()),
        skill_name: skills.get(&skill_id).map(|s| s.name.clone()),
        agent_id,
        agent_name: agents.get(&agent_id).cloned(),
        status: row_str(row, "status", "status"),
        step_count: row_u32(row, "stepCount", "step_count"),
        tokens_used: row_u32(row, "tokensUsed", "tokens_used"),
        error_message: row_opt_str(row, "errorMessage", "error_message"),
        summary: row_opt_str(row, "summary", "summary").map(|s| truncate_summary(&s)),
        started_at: row_micros(row, "startedAt", "started_at").unwrap_or(0),
        completed_at: row_micros(row, "completedAt", "completed_at"),
        triggered_by_hex: row_str(row, "triggeredByHex", "triggered_by_hex"),
    }
}

fn map_step_row(row: &Value) -> RunStepItem {
    RunStepItem {
        id: row_u64(row, "id", "id"),
        step_no: row_u32(row, "stepNo", "step_no"),
        tool_name: row_str(row, "toolName", "tool_name"),
        input_hash: row_str(row, "inputHash", "input_hash"),
        output_summary: row_str(row, "outputSummary", "output_summary"),
        output_row_count: row_opt_u32(row, "outputRowCount", "output_row_count"),
        citations_json: row_opt_str(row, "citationsJson", "citations_json"),
        duration_ms: row_u64(row, "durationMs", "duration_ms"),
        error_message: row_opt_str(row, "errorMessage", "error_message"),
        created_at: row_micros(row, "createdAt", "created_at").unwrap_or(0),
    }
}

fn map_attempt_row(row: &Value) -> ProviderAttemptItem {
    ProviderAttemptItem {
        id: row_u64(row, "id", "id"),
        provider: row_str(row, "provider", "provider"),
        model: row_str(row, "model", "model"),
        status: row_str(row, "status", "status"),
        input_tokens: row_u32(row, "inputTokens", "input_tokens"),
        output_tokens: row_u32(row, "outputTokens", "output_tokens"),
        failure_reason: row_opt_str(row, "failureReason", "failure_reason"),
    }
}

/// Cost per run: sum of `settled_units` over settled reservations plus the sum
/// of `reserved_units` over still-reserved ones; currency from the reservation
/// rows. Unknown statuses never fail the aggregate.
fn aggregate_cost(rows: &[Value]) -> RunCost {
    if rows.is_empty() {
        return RunCost::unavailable();
    }
    let mut settled_units = 0u64;
    let mut reserved_units = 0u64;
    let mut currency = None;
    for row in rows {
        match row_str(row, "status", "status").as_str() {
            STATUS_SETTLED => {
                settled_units += row_u64(row, "settledUnits", "settled_units");
            }
            STATUS_RESERVED => {
                reserved_units += row_u64(row, "reservedUnits", "reserved_units");
            }
            _ => {}
        }
        if currency.is_none() {
            currency = row_opt_str(row, "currency", "currency");
        }
    }
    RunCost {
        available: true,
        settled_units: Some(settled_units),
        reserved_units: Some(reserved_units),
        currency,
    }
}

impl RunCost {
    fn unavailable() -> Self {
        Self {
            available: false,
            settled_units: None,
            reserved_units: None,
            currency: None,
        }
    }
}

/// Truncate a run summary to at most 200 characters, staying on char
/// boundaries.
fn truncate_summary(summary: &str) -> String {
    summary.chars().take(SUMMARY_MAX_CHARS).collect()
}

// ── Query parsing ───────────────────────────────────────────────────────────

pub(crate) fn parse_list_query(
    params: &HashMap<String, String>,
) -> Result<ListRunsQuery, AppError> {
    let org_id = required_positive(params, "org_id")?;
    Ok(ListRunsQuery {
        org_id,
        company_id: optional_positive(params, "company_id")?,
        skill_id: optional_positive(params, "skill_id")?,
        agent_id: optional_positive(params, "agent_id")?,
        status: parse_status(params)?,
        days: parse_bounded(params, "days", DEFAULT_DAYS, MAX_DAYS)?,
        limit: parse_bounded(params, "limit", DEFAULT_LIMIT, MAX_LIMIT)?,
    })
}

fn required_positive(params: &HashMap<String, String>, name: &str) -> Result<u64, AppError> {
    params
        .get(name)
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|v| *v > 0)
        .ok_or_else(|| {
            AppError::BadRequest(format!("{name} is required and must be a positive integer"))
        })
}

fn optional_positive(
    params: &HashMap<String, String>,
    name: &str,
) -> Result<Option<u64>, AppError> {
    match params.get(name).map(|v| v.trim()).filter(|v| !v.is_empty()) {
        None => Ok(None),
        Some(v) => v
            .parse::<u64>()
            .ok()
            .filter(|parsed| *parsed > 0)
            .map(Some)
            .ok_or_else(|| AppError::BadRequest(format!("{name} must be a positive integer"))),
    }
}

fn parse_status(params: &HashMap<String, String>) -> Result<Option<&'static str>, AppError> {
    match params
        .get("status")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
    {
        None => Ok(None),
        Some(status) => STATUS_ALLOWLIST
            .iter()
            .find(|allowed| **allowed == status)
            .copied()
            .map(Some)
            .ok_or_else(|| {
                AppError::BadRequest(format!(
                    "status must be one of: {}",
                    STATUS_ALLOWLIST.join(", ")
                ))
            }),
    }
}

fn parse_bounded(
    params: &HashMap<String, String>,
    name: &str,
    default: u32,
    max: u32,
) -> Result<u32, AppError> {
    match params.get(name).map(|v| v.trim()).filter(|v| !v.is_empty()) {
        None => Ok(default),
        Some(v) => v
            .parse::<u32>()
            .ok()
            .filter(|parsed| (1..=max).contains(parsed))
            .ok_or_else(|| AppError::BadRequest(format!("{name} must be between 1 and {max}"))),
    }
}

// ── SQL builders ────────────────────────────────────────────────────────────

/// Cutoff as an RFC 3339 literal; SpacetimeDB Timestamp columns compare
/// against such literals (same pattern as the api-server report queries).
pub(crate) fn cutoff_rfc3339(now: DateTime<Utc>, days: u32) -> String {
    (now - chrono::Duration::days(i64::from(days))).to_rfc3339_opts(SecondsFormat::Secs, true)
}

pub(crate) fn build_runs_sql(query: &ListRunsQuery, cutoff: &str) -> String {
    let mut sql = format!(
        "SELECT {RUN_COLUMNS} FROM ai_agent_run WHERE organization_id = {}",
        query.org_id
    );
    if let Some(company_id) = query.company_id {
        sql.push_str(&format!(" AND company_id = {company_id}"));
    }
    if let Some(skill_id) = query.skill_id {
        sql.push_str(&format!(" AND skill_id = {skill_id}"));
    }
    if let Some(agent_id) = query.agent_id {
        sql.push_str(&format!(" AND agent_id = {agent_id}"));
    }
    if let Some(status) = query.status {
        // Safe: `status` comes from the allowlist, never raw input.
        sql.push_str(&format!(" AND status = '{status}'"));
    }
    sql.push_str(&format!(
        " AND started_at >= '{cutoff}' ORDER BY id DESC LIMIT {}",
        query.limit
    ));
    sql
}

pub(crate) fn build_run_by_id_sql(org_id: u64, company_id: u64, run_id: u64) -> String {
    format!(
        "SELECT {RUN_COLUMNS} FROM ai_agent_run \
         WHERE organization_id = {org_id} AND company_id = {company_id} AND id = {run_id} LIMIT 1"
    )
}

pub(crate) fn build_steps_sql(org_id: u64, run_id: u64) -> String {
    format!(
        "SELECT {STEP_COLUMNS} FROM ai_agent_run_step \
         WHERE organization_id = {org_id} AND run_id = {run_id} ORDER BY step_no ASC"
    )
}

fn build_attempts_sql(org_id: u64, run_id: u64) -> String {
    format!(
        "SELECT {ATTEMPT_COLUMNS} FROM ai_provider_attempt \
         WHERE organization_id = {org_id} AND run_id = {run_id}"
    )
}

fn build_reservations_sql(org_id: u64, run_id: u64) -> String {
    format!(
        "SELECT {RESERVATION_COLUMNS} FROM ai_spend_reservation \
         WHERE organization_id = {org_id} AND run_id = {run_id}"
    )
}

fn build_skills_sql(org_id: u64) -> String {
    format!(
        "SELECT id, skill_key, name FROM ai_skill \
         WHERE organization_id = {org_id} OR organization_id = 0"
    )
}

fn build_agents_sql(org_id: u64) -> String {
    format!("SELECT id, name FROM ai_agent WHERE organization_id = {org_id}")
}

// ── JSON row helpers (camelCase first, snake_case fallback) ─────────────────

fn row_u64(row: &Value, camel: &str, snake: &str) -> u64 {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(|v| v.as_u64().or_else(|| v.as_i64().map(|n| n as u64)))
        .unwrap_or(0)
}

fn row_u32(row: &Value, camel: &str, snake: &str) -> u32 {
    u32::try_from(row_u64(row, camel, snake)).unwrap_or(0)
}

fn row_opt_u32(row: &Value, camel: &str, snake: &str) -> Option<u32> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .filter(|v| !v.is_null())
        .and_then(|v| v.as_u64().or_else(|| v.as_i64().map(|n| n as u64)))
        .and_then(|v| u32::try_from(v).ok())
}

fn row_str(row: &Value, camel: &str, snake: &str) -> String {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn row_opt_str(row: &Value, camel: &str, snake: &str) -> Option<String> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .filter(|v| !v.is_null())
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// Read a SpacetimeDB Timestamp cell. `query_sql` unwraps timestamps to
/// `{"microsSinceUnixEpoch": n}` objects; accept a bare integer too.
fn row_micros(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    let value = row.get(camel).or_else(|| row.get(snake))?;
    if value.is_null() {
        return None;
    }
    if let Some(micros) = value.as_u64() {
        return Some(micros);
    }
    if let Some(micros) = value.as_i64() {
        return Some(micros as u64);
    }
    value.get("microsSinceUnixEpoch").and_then(|micros| {
        micros
            .as_u64()
            .or_else(|| micros.as_i64().map(|n| n as u64))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn params(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn list_query_requires_positive_org_id() {
        assert!(matches!(
            parse_list_query(&params(&[("org_id", "0")])),
            Err(AppError::BadRequest(_))
        ));
        assert!(matches!(
            parse_list_query(&params(&[("org_id", "abc")])),
            Err(AppError::BadRequest(_))
        ));
        assert!(parse_list_query(&params(&[])).is_err());

        let query = parse_list_query(&params(&[("org_id", "7")])).expect("valid");
        assert_eq!(query.org_id, 7);
        assert_eq!(query.days, DEFAULT_DAYS);
        assert_eq!(query.limit, DEFAULT_LIMIT);
        assert_eq!(query.status, None);
        assert_eq!(query.company_id, None);
    }

    #[test]
    fn list_query_rejects_nonpositive_optional_ids() {
        for name in ["company_id", "skill_id", "agent_id"] {
            assert!(matches!(
                parse_list_query(&params(&[("org_id", "7"), (name, "0")])),
                Err(AppError::BadRequest(_))
            ));
            assert!(matches!(
                parse_list_query(&params(&[("org_id", "7"), (name, "-3")])),
                Err(AppError::BadRequest(_))
            ));
        }
        let query = parse_list_query(&params(&[
            ("org_id", "7"),
            ("company_id", "3"),
            ("skill_id", "11"),
            ("agent_id", "5"),
        ]))
        .expect("valid");
        assert_eq!(query.company_id, Some(3));
        assert_eq!(query.skill_id, Some(11));
        assert_eq!(query.agent_id, Some(5));
    }

    #[test]
    fn list_query_validates_status_against_allowlist() {
        for status in STATUS_ALLOWLIST {
            let query =
                parse_list_query(&params(&[("org_id", "7"), ("status", status)])).expect("valid");
            assert_eq!(query.status, Some(status));
        }
        for bad in ["dropped", "complete", "PENDING", "running!"] {
            let error = parse_list_query(&params(&[("org_id", "7"), ("status", bad)]))
                .expect_err("must be rejected");
            assert!(
                matches!(error, AppError::BadRequest(ref m) if m.contains("status must be one of")),
                "unexpected error: {error:?}"
            );
        }
        // Surrounding whitespace is trimmed before matching.
        assert_eq!(
            parse_list_query(&params(&[("org_id", "7"), ("status", " running ")]))
                .expect("valid")
                .status,
            Some("running")
        );
    }

    #[test]
    fn list_query_bounds_days_and_limit() {
        assert_eq!(
            parse_list_query(&params(&[("org_id", "7"), ("days", "1")]))
                .expect("valid")
                .days,
            1
        );
        assert_eq!(
            parse_list_query(&params(&[("org_id", "7"), ("days", "90")]))
                .expect("valid")
                .days,
            90
        );
        for bad in ["0", "91", "-1", "seven"] {
            assert!(
                matches!(
                    parse_list_query(&params(&[("org_id", "7"), ("days", bad)])),
                    Err(AppError::BadRequest(_))
                ),
                "days={bad:?} must be rejected"
            );
        }
        // Blank input behaves like absent input and yields the default.
        assert_eq!(
            parse_list_query(&params(&[("org_id", "7"), ("days", " ")]))
                .expect("valid")
                .days,
            DEFAULT_DAYS
        );
        assert_eq!(
            parse_list_query(&params(&[("org_id", "7"), ("limit", "200")]))
                .expect("valid")
                .limit,
            200
        );
        for bad in ["0", "201", "999999"] {
            assert!(matches!(
                parse_list_query(&params(&[("org_id", "7"), ("limit", bad)])),
                Err(AppError::BadRequest(_))
            ));
        }
    }

    #[test]
    fn runs_sql_applies_filters_in_order() {
        let query = ListRunsQuery {
            org_id: 9,
            company_id: Some(2),
            skill_id: Some(15),
            agent_id: Some(4),
            status: Some("completed"),
            days: 7,
            limit: 50,
        };
        let sql = build_runs_sql(&query, "2026-09-10T00:00:00Z");
        assert!(sql.starts_with("SELECT id, run_key, organization_id, company_id, skill_id, agent_id, status, step_count, tokens_used, error_message, summary, started_at, completed_at, triggered_by_hex FROM ai_agent_run WHERE organization_id = 9"));
        assert!(sql.contains(" AND company_id = 2"));
        assert!(sql.contains(" AND skill_id = 15"));
        assert!(sql.contains(" AND agent_id = 4"));
        assert!(sql.contains(" AND status = 'completed'"));
        assert!(
            sql.ends_with(" AND started_at >= '2026-09-10T00:00:00Z' ORDER BY id DESC LIMIT 50")
        );

        let bare = ListRunsQuery {
            org_id: 9,
            company_id: None,
            skill_id: None,
            agent_id: None,
            status: None,
            days: 7,
            limit: 50,
        };
        let sql = build_runs_sql(&bare, "2026-09-10T00:00:00Z");
        assert!(!sql.contains("company_id ="));
        assert!(!sql.contains("skill_id ="));
        assert!(!sql.contains("agent_id ="));
        assert!(!sql.contains("status ="));
    }

    #[test]
    fn runs_sql_never_projects_inputs_or_artifacts() {
        let query = ListRunsQuery {
            org_id: 1,
            company_id: None,
            skill_id: None,
            agent_id: None,
            status: None,
            days: 7,
            limit: 50,
        };
        let sql = build_runs_sql(&query, "2026-09-10T00:00:00Z");
        assert!(!sql.contains("inputs_json"));
        assert!(!sql.contains("artifacts_json"));
    }

    #[test]
    fn cutoff_is_days_before_now() {
        let now = DateTime::parse_from_rfc3339("2026-09-17T12:00:00Z")
            .expect("valid time")
            .with_timezone(&Utc);
        assert_eq!(cutoff_rfc3339(now, 7), "2026-09-10T12:00:00Z");
        assert_eq!(cutoff_rfc3339(now, 90), "2026-06-19T12:00:00Z");
        assert_eq!(cutoff_rfc3339(now, 1), "2026-09-16T12:00:00Z");
    }

    #[test]
    fn run_by_id_and_steps_sql_are_org_and_run_scoped() {
        assert_eq!(
            build_run_by_id_sql(9, 2, 77),
            "SELECT id, run_key, organization_id, company_id, skill_id, agent_id, status, \
             step_count, tokens_used, error_message, summary, started_at, completed_at, \
             triggered_by_hex FROM ai_agent_run WHERE organization_id = 9 AND company_id = 2 \
             AND id = 77 LIMIT 1"
        );
        let steps = build_steps_sql(9, 77);
        assert!(steps.contains("FROM ai_agent_run_step"));
        assert!(steps.contains("WHERE organization_id = 9 AND run_id = 77"));
        assert!(steps.ends_with("ORDER BY step_no ASC"));
    }

    fn run_row() -> Value {
        json!({
            "id": 77,
            "runKey": "rk-1",
            "organizationId": 9,
            "companyId": 2,
            "skillId": 15,
            "agentId": 4,
            "status": "completed",
            "stepCount": 3,
            "tokensUsed": 1200,
            "errorMessage": null,
            "summary": "All checks passed",
            "startedAt": { "microsSinceUnixEpoch": 1_758_000_000_000_000u64 },
            "completedAt": { "microsSinceUnixEpoch": 1_758_000_010_000_000u64 },
            "triggeredByHex": "abc123",
        })
    }

    #[test]
    fn map_run_row_enriches_names_and_truncates_summary() {
        let mut skills = HashMap::new();
        skills.insert(
            15u64,
            SkillInfo {
                skill_key: "low_stock".into(),
                name: "Low Stock".into(),
            },
        );
        let mut agents = HashMap::new();
        agents.insert(4u64, "Inventory Agent".to_string());

        let item = map_run_row(&run_row(), &skills, &agents);
        assert_eq!(item.id, 77);
        assert_eq!(item.run_key, "rk-1");
        assert_eq!(item.skill_key.as_deref(), Some("low_stock"));
        assert_eq!(item.skill_name.as_deref(), Some("Low Stock"));
        assert_eq!(item.agent_name.as_deref(), Some("Inventory Agent"));
        assert_eq!(item.status, "completed");
        assert_eq!(item.step_count, 3);
        assert_eq!(item.tokens_used, 1200);
        assert_eq!(item.error_message, None);
        assert_eq!(item.summary.as_deref(), Some("All checks passed"));
        assert_eq!(item.started_at, 1_758_000_000_000_000);
        assert_eq!(item.completed_at, Some(1_758_000_010_000_000));
        assert_eq!(item.triggered_by_hex, "abc123");
    }

    #[test]
    fn map_run_row_survives_unknown_skill_and_agent() {
        let item = map_run_row(&run_row(), &HashMap::new(), &HashMap::new());
        assert_eq!(item.skill_key, None);
        assert_eq!(item.skill_name, None);
        assert_eq!(item.agent_name, None);
    }

    #[test]
    fn map_run_row_accepts_snake_case_keys_and_bare_int_timestamps() {
        let row = json!({
            "id": 5,
            "run_key": "rk-2",
            "organization_id": 9,
            "company_id": 2,
            "skill_id": 0,
            "agent_id": 0,
            "status": "failed",
            "step_count": 1,
            "tokens_used": 10,
            "error_message": "boom",
            "summary": null,
            "started_at": 1_758_000_000_000_000u64,
            "completed_at": null,
            "triggered_by_hex": "ff",
        });
        let item = map_run_row(&row, &HashMap::new(), &HashMap::new());
        assert_eq!(item.run_key, "rk-2");
        assert_eq!(item.error_message.as_deref(), Some("boom"));
        assert_eq!(item.summary, None);
        assert_eq!(item.started_at, 1_758_000_000_000_000);
        assert_eq!(item.completed_at, None);
        assert_eq!(item.status, "failed");
    }

    #[test]
    fn summary_truncates_to_200_chars_on_char_boundaries() {
        assert_eq!(truncate_summary("short"), "short");
        let exactly_200: String = "é".repeat(200);
        assert_eq!(truncate_summary(&exactly_200).chars().count(), 200);
        let long: String = "x".repeat(350);
        let truncated = truncate_summary(&long);
        assert_eq!(truncated.len(), 200);
        // Multibyte characters are not split mid-codepoint.
        let multibyte: String = "é".repeat(300);
        let truncated = truncate_summary(&multibyte);
        assert_eq!(truncated.chars().count(), 200);
        assert!(truncated.chars().all(|c| c == 'é'));
    }

    #[test]
    fn map_step_row_reads_optional_fields() {
        let row = json!({
            "id": 1,
            "stepNo": 2,
            "toolName": "analytics_summary",
            "inputHash": "abc",
            "outputSummary": "3 rows",
            "outputRowCount": 3,
            "citationsJson": null,
            "durationMs": 45,
            "errorMessage": null,
            "createdAt": { "microsSinceUnixEpoch": 1_758_000_005_000_000u64 },
        });
        let step = map_step_row(&row);
        assert_eq!(step.step_no, 2);
        assert_eq!(step.tool_name, "analytics_summary");
        assert_eq!(step.output_row_count, Some(3));
        assert_eq!(step.citations_json, None);
        assert_eq!(step.duration_ms, 45);
        assert_eq!(step.error_message, None);
        assert_eq!(step.created_at, 1_758_000_005_000_000);
    }

    fn attempt_row(id: u64, status: &str, failure: Option<&str>) -> Value {
        json!({
            "id": id,
            "provider": "mistral",
            "model": "mistral-large",
            "status": status,
            "inputTokens": 100,
            "outputTokens": 50,
            "failureReason": failure,
        })
    }

    #[test]
    fn map_attempt_row_reads_failure_reason() {
        let attempt = map_attempt_row(&attempt_row(1, "succeeded", None));
        assert_eq!(attempt.provider, "mistral");
        assert_eq!(attempt.input_tokens, 100);
        assert_eq!(attempt.output_tokens, 50);
        assert_eq!(attempt.failure_reason, None);

        let failed = map_attempt_row(&attempt_row(2, "failed", Some("timeout")));
        assert_eq!(failed.failure_reason.as_deref(), Some("timeout"));
    }

    #[test]
    fn cost_aggregates_settled_and_reserved_units() {
        let rows = vec![
            json!({ "id": 1, "status": "settled", "settledUnits": 120, "reservedUnits": 150, "currency": "usd" }),
            json!({ "id": 2, "status": "settled", "settledUnits": 30, "reservedUnits": 40, "currency": "usd" }),
            json!({ "id": 3, "status": "reserved", "settledUnits": 0, "reservedUnits": 75, "currency": "usd" }),
            json!({ "id": 4, "status": "unknown", "settledUnits": 999, "reservedUnits": 999, "currency": "eur" }),
        ];
        let cost = aggregate_cost(&rows);
        assert!(cost.available);
        assert_eq!(cost.settled_units, Some(150));
        assert_eq!(cost.reserved_units, Some(75));
        assert_eq!(cost.currency.as_deref(), Some("usd"));
    }

    #[test]
    fn cost_is_unavailable_without_reservations() {
        let cost = aggregate_cost(&[]);
        assert!(!cost.available);
        assert_eq!(cost.settled_units, None);
        assert_eq!(cost.reserved_units, None);
        assert_eq!(cost.currency, None);
    }

    #[test]
    fn cost_reports_zero_sums_when_no_rows_match_a_status() {
        let rows = vec![json!({
            "id": 1,
            "status": "settled",
            "settledUnits": 10,
            "reservedUnits": 0,
            "currency": "kong",
        })];
        let cost = aggregate_cost(&rows);
        assert!(cost.available);
        assert_eq!(cost.settled_units, Some(10));
        assert_eq!(cost.reserved_units, Some(0));
        assert_eq!(cost.currency.as_deref(), Some("kong"));
    }

    #[test]
    fn enrichment_maps_key_by_id() {
        let skills = skill_map(&vec![
            json!({ "id": 15, "skill_key": "low_stock", "name": "Low Stock" }),
            json!({ "id": 16, "skillKey": "report_compose", "name": "Report" }),
        ]);
        assert_eq!(skills[&15].skill_key, "low_stock");
        assert_eq!(skills[&16].name, "Report");

        let agents = agent_map(&vec![json!({ "id": 4, "name": "Inventory Agent" })]);
        assert_eq!(agents[&4], "Inventory Agent");
    }
}
