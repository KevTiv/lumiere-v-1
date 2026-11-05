//! AIH-16/17: read-only source/decision inspection and scoped knowledge reuse.
//!
//! Both routes are reads. They re-authorize against the organization and
//! company at request time (see `orchestrator::evidence_inspector`) and never
//! return an excerpt for a source outside that scope, or for a passage whose
//! access was revoked or whose content was deleted.

mod history_reader;

pub(crate) use lumiere_auth_context::CapabilityGrantBounds;
use lumiere_auth_context::{ActorContext as ActorCredentials, CapabilityGrantEnvelope};
use std::time::Duration;

use axum::{
    extract::State,
    http::{header::CACHE_CONTROL, HeaderMap, HeaderValue},
    response::{IntoResponse, Response},
    Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use futures::{stream, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{
    error::{AppError, AppResult},
    orchestrator::evidence_inspector::{
        inspect, inspect_workflow_step, retrieve_reusable_knowledge, ActorIdentity, InspectTarget,
        Inspection, KnowledgeRetrieval, Viewer,
    },
    orchestrator::review_queue::{build_queue, DEFAULT_QUEUE_LIMIT},
    state::AppState,
};

const ACTOR_GRANT_TIMEOUT: Duration = Duration::from_secs(3);
const INSPECT_CAPABILITY: &str = "ai.evidence.inspect";
const KNOWLEDGE_RETRIEVE_CAPABILITY: &str = "ai.knowledge.retrieve";
const MAX_RUN_TRANSCRIPT_STEPS: usize = 200;
const MAX_RUN_CLAIMS: usize = 100;
const DEFAULT_RUN_HISTORY_LIMIT: u16 = 20;
const MAX_RUN_HISTORY_LIMIT: u16 = 50;
const MAX_RUN_ECONOMICS_ROWS: usize = 200;
const MAX_PROVIDER_MODELS: usize = 8;
/// Exact authority to have persisted evidence passages placed in a RAG answer.
/// Deliberately distinct from `ai.knowledge.retrieve` (reviewed knowledge
/// reuse): holding one never implies the other, and neither is seeded by
/// default.
pub(crate) const RAG_EVIDENCE_RETRIEVE_CAPABILITY: &str = "ai.evidence.retrieve";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RunInspectionRequest {
    pub run_id: u64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RunHistoryRequest {
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub limit: Option<u16>,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelSummary {
    pub provider: String,
    pub model: String,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MeteredUsageTotal {
    /// Only native billing units, never provider response content.
    pub unit: String,
    pub allowance: Option<u64>,
    pub actual_units: Option<u64>,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MeteredUsageSummary {
    pub totals: Vec<MeteredUsageTotal>,
    pub complete: bool,
    pub truncated: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunEconomicsSummary {
    pub provider_models: Vec<ProviderModelSummary>,
    pub provider_models_truncated: bool,
    pub attempt_count: Option<u64>,
    pub attempt_statuses: Vec<String>,
    pub reservation_statuses: Vec<String>,
    pub outcome_unknown: bool,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub currency: Option<String>,
    pub reserved_units: Option<u64>,
    pub settled_units: Option<u64>,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metered_usage: Option<MeteredUsageSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunTranscriptStep {
    pub id: u64,
    pub step_no: u64,
    pub tool_name: String,
    /// Raw tool arguments are never exposed; only their persisted hash.
    pub input_hash: String,
    /// Result payloads stay private. This bounded status is enough to reconstruct
    /// the observable run without exporting sensitive tool output.
    pub result_summary: String,
    pub output_row_count: Option<u64>,
    pub duration_ms: u64,
    pub error: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEvidenceInspection {
    pub run_id: u64,
    pub status: String,
    pub answer: Option<String>,
    pub step_count: u64,
    pub tokens_used: Option<u64>,
    pub error_message: Option<String>,
    pub transcript: Vec<RunTranscriptStep>,
    pub contribution_ids: Vec<u64>,
    pub claim_ids: Vec<u64>,
    pub claims: Vec<Inspection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub economics: Option<RunEconomicsSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunHistoryItem {
    pub run_id: u64,
    pub status: String,
    pub skill_id: u64,
    pub agent_id: u64,
    pub step_count: u64,
    pub tokens_used: Option<u64>,
    pub started_at: String,
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub economics: Option<RunEconomicsSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunHistoryResponse {
    pub runs: Vec<RunHistoryItem>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Copy)]
enum RunResponseShape {
    Inspection,
    Export,
}

fn serialized_run_size(
    inspection: &RunEvidenceInspection,
    shape: RunResponseShape,
) -> AppResult<usize> {
    let encoded = match shape {
        RunResponseShape::Inspection => serde_json::to_vec(inspection),
        RunResponseShape::Export => serde_json::to_vec(&json!({
            "schemaVersion": 1,
            "kind": "lumiere_run_evidence_export",
            "run": inspection,
        })),
    }
    .map_err(|error| AppError::Internal(error.to_string()))?;
    Ok(encoded.len())
}

/// Reduce optional run detail until the exact response envelope fits the
/// actor's byte grant. The required run identity and counters are never
/// silently truncated; an impossibly small grant fails closed.
fn enforce_run_byte_bound(
    inspection: &mut RunEvidenceInspection,
    max_bytes: u64,
    shape: RunResponseShape,
) -> AppResult<()> {
    let fits = |inspection: &RunEvidenceInspection| {
        serialized_run_size(inspection, shape).map(|size| size as u64 <= max_bytes)
    };
    if !fits(inspection)? {
        inspection.economics = None;
    }
    while !inspection.claims.is_empty() && !fits(inspection)? {
        inspection.claims.pop();
        inspection.claim_ids.pop();
    }
    while !inspection.transcript.is_empty() && !fits(inspection)? {
        inspection.transcript.pop();
    }
    while !inspection.contribution_ids.is_empty() && !fits(inspection)? {
        inspection.contribution_ids.pop();
    }
    if !fits(inspection)? {
        inspection.answer = None;
        inspection.error_message = None;
    }
    if !fits(inspection)? {
        return Err(AppError::Forbidden(
            "evidence response exceeds the acting user's grant".into(),
        ));
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InspectRequest {
    /// component | decision | claim | knowledge_version | workflow_step | source
    pub kind: String,
    /// For `workflow_step`, the workflow version id.
    pub id: u64,
    /// The stable node key; required for, and only allowed with, `workflow_step`.
    #[serde(default)]
    pub node_key: Option<String>,
}

/// Ask the session-owning API server for the actor's current grants. Any
/// transport failure, timeout, non-success status or malformed envelope is an
/// error: authority that cannot be established is denied.
async fn fetch_actor_grants(
    http: &reqwest::Client,
    api_server_url: &str,
    actor: &ActorCredentials,
    timeout: Duration,
) -> AppResult<CapabilityGrantEnvelope> {
    lumiere_auth_context::fetch_capability_grants(http, api_server_url, actor, timeout)
        .await
        .map_err(|error| match error {
            lumiere_auth_context::AuthorityError::Denied => AppError::Forbidden(error.to_string()),
            lumiere_auth_context::AuthorityError::Unavailable => {
                AppError::Unavailable(error.to_string())
            }
        })
}

async fn require_actor_grant_bounds(
    state: &AppState,
    actor: &ActorCredentials,
    capability: &str,
) -> AppResult<CapabilityGrantBounds> {
    let api_server_url =
        state.config.api_server_url.as_deref().ok_or_else(|| {
            AppError::Unavailable("acting-user authorization is unavailable".into())
        })?;
    let grants =
        fetch_actor_grants(&state.http, api_server_url, actor, ACTOR_GRANT_TIMEOUT).await?;
    grants
        .bounds_for(actor, capability)
        .ok_or_else(|| AppError::Forbidden("evidence access is not permitted".into()))
}

/// Re-check a BFF-supplied acting user's exact capability before a route reads
/// persisted evidence. The envelope must echo the same actor and tenant scope;
/// an unavailable grant service fails closed. The returned bounds are the
/// actor's own limits; a caller must still intersect them with its ceilings.
pub(crate) async fn require_scoped_capability_grant(
    state: &AppState,
    actor_identity: &str,
    actor_token: &str,
    organization_id: u64,
    company_id: u64,
    capability: &str,
) -> AppResult<CapabilityGrantBounds> {
    let actor = ActorCredentials::new(actor_identity, actor_token, organization_id, company_id)?;
    require_actor_grant_bounds(state, &actor, capability).await
}

pub async fn post_inspect(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<InspectRequest>,
) -> AppResult<Response> {
    if req.id == 0 {
        return Err(AppError::BadRequest("id is required".into()));
    }
    let actor = ActorCredentials::from_headers(&headers)?;
    // Resolve the exact acting-user grant again at the gateway boundary. This
    // happens before the target row or any nested lineage node is loaded.
    let _grants = require_actor_grant_bounds(&state, &actor, INSPECT_CAPABILITY).await?;
    let viewer = Viewer {
        organization_id: actor.organization_id,
        company_id: actor.company_id,
        actor_identity: ActorIdentity::parse(&actor.identity),
    };
    let inspected = if req.kind == "workflow_step" {
        // A step is addressed by workflow version and stable node key.
        let node_key = req
            .node_key
            .as_deref()
            .filter(|key| !key.is_empty() && key.len() <= 128)
            .ok_or_else(|| {
                AppError::BadRequest("nodeKey is required for a workflow step".into())
            })?;
        inspect_workflow_step(state.stdb.as_ref(), viewer, req.id, node_key).await
    } else {
        if req.node_key.is_some() {
            return Err(AppError::BadRequest(
                "nodeKey is only valid for a workflow step".into(),
            ));
        }
        let target = InspectTarget::parse(&req.kind, req.id).ok_or_else(|| {
            AppError::BadRequest(
                "kind must be component, decision, claim, knowledge_version or workflow_step"
                    .into(),
            )
        })?;
        inspect(state.stdb.as_ref(), viewer, target).await
    };
    let inspection = inspected.map_err(|error| {
        // A record outside the caller's scope reads as absent, not forbidden.
        if error.to_string().contains("not found") {
            AppError::NotFound(error.to_string())
        } else {
            AppError::Internal(error.to_string())
        }
    })?;
    let mut response = Json(inspection).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

fn row_u64(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
}

fn row_text(row: &Value, camel: &str, snake: &str) -> Option<String> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn bounded_row_text(row: &Value, camel: &str, snake: &str, max: usize) -> Option<String> {
    row_text(row, camel, snake).map(|value| value.chars().take(max).collect())
}

fn bounded_row_display(row: &Value, camel: &str, snake: &str, max: usize) -> Option<String> {
    let value = row.get(camel).or_else(|| row.get(snake))?;
    if value.is_null() {
        return None;
    }
    let value = value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string());
    Some(value.chars().take(max).collect())
}

fn encode_run_cursor(run_id: u64) -> String {
    URL_SAFE_NO_PAD.encode(run_id.to_be_bytes())
}

fn decode_run_cursor(cursor: Option<&str>) -> AppResult<Option<u64>> {
    let Some(cursor) = cursor else {
        return Ok(None);
    };
    if cursor.is_empty() || cursor.len() > 32 {
        return Err(AppError::BadRequest("run history cursor is invalid".into()));
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(cursor)
        .map_err(|_| AppError::BadRequest("run history cursor is invalid".into()))?;
    let bytes: [u8; 8] = bytes
        .try_into()
        .map_err(|_| AppError::BadRequest("run history cursor is invalid".into()))?;
    let run_id = u64::from_be_bytes(bytes);
    if run_id == 0 {
        return Err(AppError::BadRequest("run history cursor is invalid".into()));
    }
    Ok(Some(run_id))
}

fn allowed_attempt_status(value: &str) -> bool {
    matches!(
        value,
        "accepted" | "dispatched" | "succeeded" | "failed" | "outcome_unknown" | "abandoned"
    )
}

fn allowed_reservation_status(value: &str) -> bool {
    matches!(value, "reserved" | "settled" | "released")
}

fn row_matches_run(row: &Value, organization_id: u64, company_id: u64, run_id: u64) -> bool {
    row_u64(row, "organizationId", "organization_id") == Some(organization_id)
        && row_u64(row, "companyId", "company_id") == Some(company_id)
        && row_u64(row, "runId", "run_id") == Some(run_id)
}

fn is_native_metered_row(row: &Value) -> bool {
    // Native non-generation reservations deliberately have no LLM price snapshot.
    // Model recognition also covers old projections that omit that sentinel.
    row_u64(row, "priceSnapshotId", "price_snapshot_id") == Some(0)
        || bounded_row_text(row, "model", "model", 128)
            .is_some_and(|model| model == "mistral-embed" || model.starts_with("mistral-ocr-"))
}

fn economics_from_rows(
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    attempt_rows: &[Value],
    reservation_rows: &[Value],
) -> Option<RunEconomicsSummary> {
    use std::collections::BTreeSet;

    let attempts = attempt_rows
        .iter()
        .filter(|row| {
            row_u64(row, "organizationId", "organization_id") == Some(organization_id)
                && row_u64(row, "companyId", "company_id") == Some(company_id)
                && row_u64(row, "runId", "run_id") == Some(run_id)
        })
        .take(MAX_RUN_ECONOMICS_ROWS + 1)
        .collect::<Vec<_>>();
    let reservations = reservation_rows
        .iter()
        .filter(|row| {
            row_u64(row, "organizationId", "organization_id") == Some(organization_id)
                && row_u64(row, "companyId", "company_id") == Some(company_id)
                && row_u64(row, "runId", "run_id") == Some(run_id)
        })
        .take(MAX_RUN_ECONOMICS_ROWS + 1)
        .collect::<Vec<_>>();
    if attempts.is_empty() && reservations.is_empty() {
        return None;
    }

    let truncated =
        attempts.len() > MAX_RUN_ECONOMICS_ROWS || reservations.len() > MAX_RUN_ECONOMICS_ROWS;
    let metered = attempts
        .iter()
        .chain(reservations.iter())
        .any(|row| is_native_metered_row(row));
    let attempts = attempts.into_iter().take(MAX_RUN_ECONOMICS_ROWS);
    let reservations = reservations
        .into_iter()
        .take(MAX_RUN_ECONOMICS_ROWS)
        .collect::<Vec<_>>();
    let mut provider_models = BTreeSet::new();
    let mut attempt_statuses = BTreeSet::new();
    let mut input_tokens = 0_u64;
    let mut output_tokens = 0_u64;
    let mut attempt_count = 0_u64;
    let mut usage_complete = true;
    let mut outcome_unknown = false;
    for row in attempts {
        attempt_count = attempt_count.saturating_add(1);
        match (
            row_u64(row, "inputTokens", "input_tokens").and_then(|n| input_tokens.checked_add(n)),
            row_u64(row, "outputTokens", "output_tokens")
                .and_then(|n| output_tokens.checked_add(n)),
        ) {
            (Some(input), Some(output)) => {
                input_tokens = input;
                output_tokens = output;
            }
            _ => usage_complete = false,
        }
        if let Some(status) = bounded_row_text(row, "status", "status", 32)
            .filter(|status| allowed_attempt_status(status))
        {
            outcome_unknown |= status == "outcome_unknown";
            usage_complete &= matches!(status.as_str(), "succeeded" | "failed");
            attempt_statuses.insert(status);
        } else {
            usage_complete = false;
        }
        if let (Some(provider), Some(model)) = (
            bounded_row_text(row, "provider", "provider", 128),
            bounded_row_text(row, "model", "model", 128),
        ) {
            if !provider.is_empty() && !model.is_empty() {
                provider_models.insert((provider, model));
            }
        }
    }

    let mut reservation_statuses = BTreeSet::new();
    let mut currencies = BTreeSet::new();
    let mut reserved_units = 0_u64;
    let mut settled_units = 0_u64;
    for row in reservations {
        reserved_units = reserved_units
            .saturating_add(row_u64(row, "reservedUnits", "reserved_units").unwrap_or_default());
        settled_units = settled_units
            .saturating_add(row_u64(row, "settledUnits", "settled_units").unwrap_or_default());
        if let Some(status) = bounded_row_text(row, "status", "status", 32)
            .filter(|status| allowed_reservation_status(status))
        {
            reservation_statuses.insert(status);
        }
        if let Some(currency) = bounded_row_text(row, "currency", "currency", 16)
            .filter(|currency| !currency.is_empty())
        {
            currencies.insert(currency);
        }
        if let (Some(provider), Some(model)) = (
            bounded_row_text(row, "provider", "provider", 128),
            bounded_row_text(row, "model", "model", 128),
        ) {
            if !provider.is_empty() && !model.is_empty() {
                provider_models.insert((provider, model));
            }
        }
    }
    let currency = (currencies.len() == 1)
        .then(|| currencies.into_iter().next())
        .flatten();
    let provider_models_truncated = provider_models.len() > MAX_PROVIDER_MODELS;
    Some(RunEconomicsSummary {
        provider_models: provider_models
            .into_iter()
            .take(MAX_PROVIDER_MODELS)
            .map(|(provider, model)| ProviderModelSummary { provider, model })
            .collect(),
        provider_models_truncated,
        attempt_count: (!truncated).then_some(attempt_count),
        attempt_statuses: attempt_statuses.into_iter().collect(),
        reservation_statuses: reservation_statuses.into_iter().collect(),
        outcome_unknown,
        input_tokens: (!metered && !truncated && usage_complete).then_some(input_tokens),
        output_tokens: (!metered && !truncated && usage_complete).then_some(output_tokens),
        currency,
        reserved_units: (!truncated).then_some(reserved_units),
        settled_units: (!truncated).then_some(settled_units),
        truncated,
        metered_usage: metered.then_some(MeteredUsageSummary {
            totals: vec![],
            complete: false,
            truncated,
        }),
    })
}

/// Join only exact-run native meters to canonical reservations. Unknown,
/// outstanding, malformed or truncated usage never becomes a zero total.
fn apply_metered_usage(
    summary: &mut RunEconomicsSummary,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    reservation_rows: &[Value],
    meter_rows: &[Value],
) {
    use std::collections::{BTreeMap, BTreeSet};

    let rows = meter_rows
        .iter()
        .filter(|row| row_matches_run(row, organization_id, company_id, run_id))
        .take(MAX_RUN_ECONOMICS_ROWS + 1)
        .collect::<Vec<_>>();
    if rows.is_empty() {
        return;
    }
    summary.input_tokens = None;
    summary.output_tokens = None;
    let reservations = reservation_rows
        .iter()
        .filter(|row| row_matches_run(row, organization_id, company_id, run_id))
        .filter(|row| is_native_metered_row(row))
        .filter_map(|row| row_u64(row, "id", "id").map(|id| (id, row)))
        .collect::<BTreeMap<_, _>>();
    let truncated = summary.truncated || rows.len() > MAX_RUN_ECONOMICS_ROWS;
    let mut complete = !truncated;
    let mut seen = BTreeSet::new();
    let mut totals = BTreeMap::<String, (Option<u64>, Option<u64>)>::new();
    for row in rows.into_iter().take(MAX_RUN_ECONOMICS_ROWS) {
        let Some(id) = row_u64(row, "reservationId", "reservation_id") else {
            complete = false;
            continue;
        };
        let Some(reservation) = reservations.get(&id).filter(|_| seen.insert(id)) else {
            complete = false;
            continue;
        };
        let unit = row_text(row, "unit", "unit").unwrap_or_default();
        let model = row_text(row, "model", "model");
        if !matches!(unit.as_str(), "tokens" | "pages")
            || model != row_text(reservation, "model", "model")
        {
            complete = false;
            continue;
        }
        let allowance = row_u64(row, "allowance", "allowance").filter(|units| *units > 0);
        let actual = row_u64(row, "actualUnits", "actual_units")
            .filter(|units| allowance.is_some_and(|allowance| *units <= allowance));
        let settled = row_text(reservation, "status", "status").as_deref() == Some("settled");
        complete &= allowance.is_some() && actual.is_some() && settled;
        let total = totals.entry(unit).or_insert((Some(0), Some(0)));
        total.0 = total
            .0
            .zip(allowance)
            .and_then(|(total, value)| total.checked_add(value));
        total.1 = total
            .1
            .zip(actual)
            .and_then(|(total, value)| total.checked_add(value));
        complete &= total.0.is_some() && total.1.is_some();
    }
    complete &= seen.len() == reservations.len() && !reservations.is_empty();
    summary.metered_usage = Some(MeteredUsageSummary {
        totals: totals
            .into_iter()
            .map(|(unit, (allowance, actual_units))| MeteredUsageTotal {
                unit,
                allowance: (!truncated).then_some(allowance).flatten(),
                actual_units: complete.then_some(actual_units).flatten(),
            })
            .collect(),
        complete,
        truncated,
    });
}

async fn load_run_economics(
    state: &AppState,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
) -> Option<RunEconomicsSummary> {
    let Some(reader) = state.spend_read_stdb.as_deref() else {
        return None;
    };
    let row_limit = MAX_RUN_ECONOMICS_ROWS + 1;
    let attempts = reader
        .query_sql(&format!(
            "SELECT id, organization_id, company_id, run_id, provider, model, status, input_tokens, output_tokens FROM ai_provider_attempt_read WHERE organization_id = {organization_id} AND company_id = {company_id} AND run_id = {run_id} LIMIT {row_limit}"
        ))
        .await
        .map_err(|error| tracing::warn!(%error, run_id, "run provider economics unavailable"))
        .ok()?;
    let reservations = reader
        .query_sql(&format!(
            "SELECT id, organization_id, company_id, run_id, provider, model, price_snapshot_id, currency, reserved_units, settled_units, status FROM ai_spend_reservation_read WHERE organization_id = {organization_id} AND company_id = {company_id} AND run_id = {run_id} LIMIT {row_limit}"
        ))
        .await
        .map_err(|error| tracing::warn!(%error, run_id, "run reservation economics unavailable"))
        .ok()?;
    let mut summary = economics_from_rows(
        organization_id,
        company_id,
        run_id,
        &attempts,
        &reservations,
    )?;
    if summary.metered_usage.is_none() {
        return Some(summary);
    }
    // Older deployments may not have the native meter view. Preserve their
    // monetary and legacy LLM summaries; recognized native meters stay unknown.
    let meter_query = format!(
        "SELECT reservation_id, organization_id, company_id, run_id, model, unit, allowance, actual_units FROM ai_metered_usage_read WHERE organization_id = {organization_id} AND company_id = {company_id} AND run_id = {run_id} LIMIT {row_limit}"
    );
    if let Ok(Ok(rows)) =
        tokio::time::timeout(Duration::from_millis(250), reader.query_sql(&meter_query)).await
    {
        apply_metered_usage(
            &mut summary,
            organization_id,
            company_id,
            run_id,
            &reservations,
            &rows,
        );
    }
    Some(summary)
}

fn redacted_step(row: &Value) -> Option<RunTranscriptStep> {
    let row_count = row_u64(row, "outputRowCount", "output_row_count");
    let error_message = row_text(row, "errorMessage", "error_message");
    Some(RunTranscriptStep {
        id: row_u64(row, "id", "id")?,
        step_no: row_u64(row, "stepNo", "step_no")?,
        tool_name: row_text(row, "toolName", "tool_name")?,
        input_hash: row_text(row, "inputHash", "input_hash")?,
        result_summary: if error_message.is_some() {
            "tool failed".to_string()
        } else if let Some(count) = row_count {
            format!("{count} row(s)")
        } else {
            "completed".to_string()
        },
        output_row_count: row_count,
        duration_ms: row_u64(row, "durationMs", "duration_ms").unwrap_or_default(),
        error: error_message.is_some(),
    })
}

async fn inspect_run(
    state: &AppState,
    actor: &ActorCredentials,
    run_id: u64,
    shape: RunResponseShape,
) -> AppResult<RunEvidenceInspection> {
    if run_id == 0 {
        return Err(AppError::BadRequest("runId is required".into()));
    }
    let grant = require_actor_grant_bounds(state, actor, INSPECT_CAPABILITY).await?;
    let runs = state
        .stdb
        .query_sql(&format!(
            "SELECT * FROM ai_agent_run WHERE organization_id = {} AND company_id = {} AND id = {} LIMIT 1",
            actor.organization_id, actor.company_id, run_id
        ))
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?;
    let run = runs
        .into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound("run not found".into()))?;

    let mut transcript = state
        .stdb
        .query_sql(&format!(
            "SELECT * FROM ai_agent_run_step WHERE organization_id = {} AND run_id = {}",
            actor.organization_id, run_id
        ))
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?
        .iter()
        .filter_map(redacted_step)
        .collect::<Vec<_>>();
    transcript.sort_by_key(|step| (step.step_no, step.id));
    let mut remaining_rows =
        usize::try_from(grant.max_rows.saturating_sub(1)).unwrap_or(usize::MAX);
    transcript.truncate(MAX_RUN_TRANSCRIPT_STEPS.min(remaining_rows));
    remaining_rows = remaining_rows.saturating_sub(transcript.len());

    let reader = state
        .spend_read_stdb
        .as_deref()
        .ok_or_else(|| AppError::Internal("evidence reader is not configured".into()))?;
    let contributions = reader
        .query_sql(&format!(
            "SELECT * FROM ai_evidence_contribution_read WHERE organization_id = {} AND company_id = {}",
            actor.organization_id, actor.company_id
        ))
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?;
    let mut contribution_ids = contributions
        .iter()
        .filter(|row| row_u64(row, "agentRunId", "agent_run_id") == Some(run_id))
        .filter_map(|row| row_u64(row, "id", "id"))
        .collect::<Vec<_>>();
    contribution_ids.sort_unstable();
    contribution_ids.dedup();
    contribution_ids.truncate(remaining_rows);
    remaining_rows = remaining_rows.saturating_sub(contribution_ids.len());

    let viewer = Viewer {
        organization_id: actor.organization_id,
        company_id: actor.company_id,
        actor_identity: ActorIdentity::parse(&actor.identity),
    };
    let contribution_set = contribution_ids
        .iter()
        .copied()
        .collect::<std::collections::BTreeSet<_>>();
    let claim_rows = reader
        .query_sql(&format!(
            "SELECT * FROM ai_evidence_claim_read WHERE organization_id = {} AND company_id = {}",
            actor.organization_id, actor.company_id
        ))
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?;
    let mut claim_ids = claim_rows
        .iter()
        .filter(|row| {
            row_u64(row, "contributionId", "contribution_id")
                .is_some_and(|id| contribution_set.contains(&id))
        })
        .filter_map(|row| row_u64(row, "id", "id"))
        .collect::<Vec<_>>();
    claim_ids.sort_unstable();
    claim_ids.dedup();
    claim_ids.truncate(MAX_RUN_CLAIMS.min(remaining_rows));

    let mut claims = Vec::with_capacity(claim_ids.len());
    for claim_id in &claim_ids {
        let inspection = inspect(reader, viewer, InspectTarget::Claim(*claim_id))
            .await
            .map_err(|error| AppError::Internal(error.to_string()))?;
        claims.push(inspection);
    }

    let mut inspection = RunEvidenceInspection {
        run_id,
        status: row_text(&run, "status", "status").unwrap_or_else(|| "unknown".into()),
        answer: row_text(&run, "summary", "summary"),
        step_count: row_u64(&run, "stepCount", "step_count").unwrap_or_default(),
        tokens_used: Some(row_u64(&run, "tokensUsed", "tokens_used").unwrap_or_default()),
        error_message: row_text(&run, "errorMessage", "error_message"),
        transcript,
        contribution_ids,
        claim_ids,
        claims,
        economics: load_run_economics(state, actor.organization_id, actor.company_id, run_id).await,
    };
    if row_u64(&run, "skillId", "skill_id") == Some(0)
        || inspection
            .economics
            .as_ref()
            .is_some_and(|summary| summary.metered_usage.is_some())
    {
        inspection.tokens_used = None;
    }
    enforce_run_byte_bound(&mut inspection, grant.max_bytes, shape)?;
    Ok(inspection)
}

pub async fn post_run_inspect(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<RunInspectionRequest>,
) -> AppResult<Response> {
    let actor = ActorCredentials::from_headers(&headers)?;
    let inspection = inspect_run(&state, &actor, req.run_id, RunResponseShape::Inspection).await?;
    let mut response = Json(inspection).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

fn history_item_from_row(row: &Value) -> AppResult<RunHistoryItem> {
    let required_number = |camel: &str, snake: &str| {
        row_u64(row, camel, snake)
            .ok_or_else(|| AppError::Internal(format!("run history row is missing {camel}")))
    };
    let required_text = |camel: &str, snake: &str, max: usize| {
        bounded_row_text(row, camel, snake, max)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::Internal(format!("run history row is missing {camel}")))
    };
    Ok(RunHistoryItem {
        run_id: required_number("id", "id")?,
        status: required_text("status", "status", 64)?,
        skill_id: required_number("skillId", "skill_id")?,
        agent_id: required_number("agentId", "agent_id")?,
        step_count: required_number("stepCount", "step_count")?,
        tokens_used: (required_number("skillId", "skill_id")? != 0)
            .then_some(required_number("tokensUsed", "tokens_used")?),
        started_at: bounded_row_display(row, "startedAt", "started_at", 128)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::Internal("run history row is missing startedAt".into()))?,
        completed_at: bounded_row_display(row, "completedAt", "completed_at", 128)
            .filter(|value| !value.is_empty()),
        economics: None,
    })
}

/// Tenant-bound, newest-first run history. The cursor contains only the last
/// returned run id and grants no authority; actor, organization, company, row,
/// and byte bounds are rechecked on every page.
pub async fn post_run_history(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<RunHistoryRequest>,
) -> AppResult<Response> {
    let actor = ActorCredentials::from_headers(&headers)?;
    let grant = require_actor_grant_bounds(&state, &actor, INSPECT_CAPABILITY).await?;
    let before_run_id = decode_run_cursor(req.cursor.as_deref())?;
    let requested_limit = req.limit.unwrap_or(DEFAULT_RUN_HISTORY_LIMIT);
    if requested_limit == 0 || requested_limit > MAX_RUN_HISTORY_LIMIT {
        return Err(AppError::BadRequest(format!(
            "limit must be between 1 and {MAX_RUN_HISTORY_LIMIT}"
        )));
    }
    let limit =
        usize::from(requested_limit).min(usize::try_from(grant.max_rows).unwrap_or(usize::MAX));
    if limit == 0 {
        return Err(AppError::Forbidden("run history row grant is empty".into()));
    }
    let page = history_reader::read_run_history(
        &state.stdb,
        actor.organization_id,
        actor.company_id,
        before_run_id,
        limit,
    )
    .await?;
    let mut has_more = page.has_more;
    let rows = page.rows;
    let mut runs = Vec::with_capacity(rows.len());
    for row in rows {
        runs.push(history_item_from_row(&row)?);
    }
    let organization_id = actor.organization_id;
    let company_id = actor.company_id;
    // Economics are optional. Bound the whole enrichment phase, not each row:
    // a slow provider ledger must not consume the API's 15s forward timeout.
    let economics_deadline = tokio::time::Instant::now() + Duration::from_secs(2);
    let runs = stream::iter(runs.into_iter().map(|mut item| {
        let state = &state;
        async move {
            item.economics = if tokio::time::Instant::now() < economics_deadline {
                tokio::time::timeout_at(
                    economics_deadline,
                    load_run_economics(state, organization_id, company_id, item.run_id),
                )
                .await
                .ok()
                .flatten()
            } else {
                None
            };
            if item
                .economics
                .as_ref()
                .is_some_and(|summary| summary.metered_usage.is_some())
            {
                item.tokens_used = None;
            }
            item
        }
    }))
    .buffered(8)
    .collect::<Vec<_>>()
    .await;
    let mut runs = runs;

    let had_runs = !runs.is_empty();
    loop {
        let next_cursor = has_more
            .then(|| runs.last().map(|run| encode_run_cursor(run.run_id)))
            .flatten();
        let response = RunHistoryResponse { runs, next_cursor };
        let encoded =
            serde_json::to_vec(&response).map_err(|error| AppError::Internal(error.to_string()))?;
        if encoded.len() as u64 <= grant.max_bytes {
            let mut response = Json(response).into_response();
            response
                .headers_mut()
                .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
            return Ok(response);
        }
        runs = response.runs;
        if let Some(run) = runs.iter_mut().rev().find(|run| run.economics.is_some()) {
            run.economics = None;
            continue;
        }
        if runs.pop().is_none() {
            return Err(AppError::Forbidden(
                "run history response exceeds the acting user's byte grant".into(),
            ));
        }
        has_more = true;
        if had_runs && runs.is_empty() {
            return Err(AppError::Forbidden(
                "run history response exceeds the acting user's byte grant".into(),
            ));
        }
    }
}

pub async fn post_run_export(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<RunInspectionRequest>,
) -> AppResult<Response> {
    let actor = ActorCredentials::from_headers(&headers)?;
    let inspection = inspect_run(&state, &actor, req.run_id, RunResponseShape::Export).await?;
    let mut response = Json(json!({
        "schemaVersion": 1,
        "kind": "lumiere_run_evidence_export",
        "run": inspection,
    }))
    .into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

/// The reviewer's queue for the acting user's company. It grants no review
/// right: it needs the same exact `ai.evidence.inspect` grant as inspection,
/// and the review reducers still enforce permission, membership and
/// independence.
pub async fn post_review_queue(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Response> {
    let actor = ActorCredentials::from_headers(&headers)?;
    let _grants = require_actor_grant_bounds(&state, &actor, INSPECT_CAPABILITY).await?;
    let viewer = Viewer {
        organization_id: actor.organization_id,
        company_id: actor.company_id,
        actor_identity: ActorIdentity::parse(&actor.identity),
    };
    let queue = build_queue(state.stdb.as_ref(), viewer, DEFAULT_QUEUE_LIMIT)
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?;
    let mut response = Json(queue).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct KnowledgeRetrieveRequest {
    pub entry_key: String,
}

pub async fn post_knowledge_retrieve(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<KnowledgeRetrieveRequest>,
) -> AppResult<Json<KnowledgeRetrieval>> {
    if req.entry_key.trim().is_empty() || req.entry_key.len() > 128 {
        return Err(AppError::BadRequest("entryKey is invalid".into()));
    }
    let actor = ActorCredentials::from_headers(&headers)?;
    let _grants = require_actor_grant_bounds(&state, &actor, KNOWLEDGE_RETRIEVE_CAPABILITY).await?;
    let viewer = Viewer {
        organization_id: actor.organization_id,
        company_id: actor.company_id,
        actor_identity: ActorIdentity::parse(&actor.identity),
    };
    let retrieval = retrieve_reusable_knowledge(state.stdb.as_ref(), viewer, &req.entry_key)
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?;
    Ok(Json(retrieval))
}

#[cfg(test)]
mod route_tests {
    use super::*;
    use serde_json::json;

    fn actor_headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-lumiere-actor-identity",
            HeaderValue::from_static(
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            ),
        );
        headers.insert("x-lumiere-actor-token", HeaderValue::from_static("token"));
        headers.insert("x-lumiere-organization-id", HeaderValue::from_static("7"));
        headers.insert("x-lumiere-company-id", HeaderValue::from_static("9"));
        headers
    }

    #[test]
    fn run_transcript_never_exposes_raw_tool_output() {
        let step = redacted_step(&json!({
            "id": 1,
            "stepNo": 2,
            "toolName": "erp.search",
            "inputHash": "abc123",
            "outputSummary": "customer secret should never leave the gateway",
            "outputRowCount": 3,
            "durationMs": 17,
            "errorMessage": null
        }))
        .expect("redacted step");
        let encoded = serde_json::to_value(step).expect("serialize");
        assert_eq!(encoded["resultSummary"], "3 row(s)");
        assert_eq!(encoded["inputHash"], "abc123");
        assert!(encoded.get("outputSummary").is_none());
        assert!(!encoded.to_string().contains("customer secret"));
    }

    #[test]
    fn run_export_is_trimmed_to_the_exact_byte_grant() {
        let mut inspection = RunEvidenceInspection {
            run_id: 11,
            status: "completed".to_string(),
            answer: Some("sensitive answer".repeat(50)),
            step_count: 1,
            tokens_used: Some(20),
            error_message: None,
            transcript: vec![RunTranscriptStep {
                id: 1,
                step_no: 1,
                tool_name: "erp.search".to_string(),
                input_hash: "abc123".to_string(),
                result_summary: "3 row(s)".to_string(),
                output_row_count: Some(3),
                duration_ms: 17,
                error: false,
            }],
            contribution_ids: vec![7, 8],
            claim_ids: vec![],
            claims: vec![],
            economics: Some(RunEconomicsSummary {
                provider_models: vec![ProviderModelSummary {
                    provider: "provider".into(),
                    model: "model".into(),
                }],
                provider_models_truncated: false,
                attempt_count: Some(1),
                attempt_statuses: vec!["succeeded".into()],
                reservation_statuses: vec!["settled".into()],
                outcome_unknown: false,
                input_tokens: Some(10),
                output_tokens: Some(10),
                currency: Some("USD".into()),
                reserved_units: Some(10),
                settled_units: Some(10),
                truncated: false,
                metered_usage: None,
            }),
        };
        let minimal = RunEvidenceInspection {
            run_id: 11,
            status: "completed".to_string(),
            answer: None,
            step_count: 1,
            tokens_used: Some(20),
            error_message: None,
            transcript: vec![],
            contribution_ids: vec![],
            claim_ids: vec![],
            claims: vec![],
            economics: None,
        };
        let max_bytes = serialized_run_size(&minimal, RunResponseShape::Export)
            .expect("serialize minimal export") as u64;

        enforce_run_byte_bound(&mut inspection, max_bytes, RunResponseShape::Export)
            .expect("trim export");

        assert!(inspection.answer.is_none());
        assert!(inspection.economics.is_none());
        assert!(inspection.transcript.is_empty());
        assert!(inspection.contribution_ids.is_empty());
        assert!(
            serialized_run_size(&inspection, RunResponseShape::Export)
                .expect("serialize bounded export") as u64
                <= max_bytes
        );
    }

    #[test]
    fn actor_scope_is_header_only_and_fail_closed() {
        let actor = ActorCredentials::from_headers(&actor_headers()).expect("actor context");
        assert_eq!(actor.identity, "a".repeat(64));
        assert_eq!(actor.token, "token");
        assert_eq!(actor.organization_id, 7);
        assert_eq!(actor.company_id, 9);

        let mut missing = actor_headers();
        missing.remove("x-lumiere-actor-token");
        assert!(ActorCredentials::from_headers(&missing).is_err());

        let mut malformed = actor_headers();
        malformed.insert("x-lumiere-company-id", HeaderValue::from_static("other"));
        assert!(ActorCredentials::from_headers(&malformed).is_err());
    }

    #[test]
    fn browser_body_cannot_choose_authority() {
        for extra in [
            json!({ "orgId": 7 }),
            json!({ "companyId": 9 }),
            json!({ "actorIdentity": "forged" }),
            json!({ "actorToken": "forged" }),
            json!({ "grants": ["ai.evidence.inspect"] }),
        ] {
            let mut body = json!({ "kind": "claim", "id": 11 });
            body.as_object_mut()
                .expect("body object")
                .extend(extra.as_object().expect("extra object").clone());
            assert!(serde_json::from_value::<InspectRequest>(body).is_err());
        }
    }

    #[test]
    fn grant_envelope_requires_exact_positive_capability() {
        let parse = |value| serde_json::from_value::<CapabilityGrantEnvelope>(value);
        let actor = ActorCredentials::from_headers(&actor_headers()).expect("actor");
        assert!(parse(json!({
            "organizationId": 7,
            "companyId": 9,
            "actorIdentity": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "grants": [{
                "capabilityKey": "ai.evidence.inspect",
                "maxRows": 1,
                "maxBytes": 1
            }]
        }))
        .expect("grant envelope")
        .permits(&actor, INSPECT_CAPABILITY));
        for denied in [
            json!({"organizationId": 7, "companyId": 9, "actorIdentity": "a".repeat(64), "grants": []}),
            json!({"organizationId": 7, "companyId": 9, "actorIdentity": "a".repeat(64), "grants": [{"capabilityKey": "*", "maxRows": 1, "maxBytes": 1}]}),
            json!({"organizationId": 7, "companyId": 9, "actorIdentity": "a".repeat(64), "grants": [{"capabilityKey": "ai.evidence.inspect", "maxRows": 0, "maxBytes": 1}]}),
            json!({"organizationId": 7, "companyId": 9, "actorIdentity": "a".repeat(64), "grants": [{"capabilityKey": "ai.evidence.inspect", "maxRows": 1}]}),
            json!({"organizationId": 8, "companyId": 9, "actorIdentity": "a".repeat(64), "grants": [{"capabilityKey": "ai.evidence.inspect", "maxRows": 1, "maxBytes": 1}]}),
            json!({"organizationId": 7, "companyId": 10, "actorIdentity": "a".repeat(64), "grants": [{"capabilityKey": "ai.evidence.inspect", "maxRows": 1, "maxBytes": 1}]}),
            json!({"organizationId": 7, "companyId": 9, "actorIdentity": "other", "grants": [{"capabilityKey": "ai.evidence.inspect", "maxRows": 1, "maxBytes": 1}]}),
        ] {
            match parse(denied) {
                Ok(envelope) => assert!(!envelope.permits(&actor, INSPECT_CAPABILITY)),
                Err(_) => {}
            }
        }
        assert!(parse(json!({"organizationId": 7, "companyId": 9, "actorIdentity": "a".repeat(64), "grants": [], "actor": "forged"})).is_err());
    }

    #[test]
    fn grant_envelope_accepts_trusted_snapshot_fields_but_rejects_unknown_fields() {
        let envelope = json!({
            "organizationId": 7,
            "companyId": 9,
            "actorIdentity": "a".repeat(64),
            "knowledgeTeamRefs": ["department:42"],
            "placementGeneration": 3,
            "policySnapshotHash": "policy-v3",
            "capabilityGrantsHash": "grants-v3",
            "grants": [{
                "capabilityKey": INSPECT_CAPABILITY,
                "maxRows": 4,
                "maxBytes": 2048
            }]
        });
        assert!(serde_json::from_value::<CapabilityGrantEnvelope>(envelope.clone()).is_ok());
        let mut unknown = envelope;
        unknown["unexpectedAuthority"] = json!(true);
        assert!(serde_json::from_value::<CapabilityGrantEnvelope>(unknown).is_err());
    }

    #[test]
    fn knowledge_reuse_requires_its_own_exact_capability() {
        let actor = ActorCredentials::from_headers(&actor_headers()).expect("actor");
        let envelope = serde_json::from_value::<CapabilityGrantEnvelope>(json!({
            "organizationId": 7,
            "companyId": 9,
            "actorIdentity": "a".repeat(64),
            "knowledgeTeamRefs": ["department:42"],
            "grants": [{
                "capabilityKey": KNOWLEDGE_RETRIEVE_CAPABILITY,
                "maxRows": 1,
                "maxBytes": 1
            }]
        }))
        .expect("grant envelope");
        assert!(envelope.permits(&actor, KNOWLEDGE_RETRIEVE_CAPABILITY));
        assert!(!envelope.permits(&actor, INSPECT_CAPABILITY));
    }

    #[test]
    fn knowledge_body_cannot_choose_actor_scope_or_team() {
        assert!(serde_json::from_value::<KnowledgeRetrieveRequest>(json!({
            "entryKey": "sl",
            "orgId": 7
        }))
        .is_err());
        assert!(serde_json::from_value::<KnowledgeRetrieveRequest>(json!({
            "entryKey": "sl",
            "companyId": 9
        }))
        .is_err());
        assert!(serde_json::from_value::<KnowledgeRetrieveRequest>(json!({
            "entryKey": "sl",
            "knowledgeTeamRefs": ["department:42"]
        }))
        .is_err());
    }

    #[test]
    fn actor_grant_resolution_has_a_short_timeout() {
        assert_eq!(ACTOR_GRANT_TIMEOUT, Duration::from_secs(3));
    }

    fn envelope(grants: serde_json::Value) -> CapabilityGrantEnvelope {
        serde_json::from_value(json!({
            "organizationId": 7,
            "companyId": 9,
            "actorIdentity": "a".repeat(64),
            "grants": grants,
        }))
        .expect("grant envelope")
    }

    #[test]
    fn rag_uses_its_own_exact_evidence_capability() {
        assert_eq!(RAG_EVIDENCE_RETRIEVE_CAPABILITY, "ai.evidence.retrieve");
        assert_ne!(
            RAG_EVIDENCE_RETRIEVE_CAPABILITY,
            KNOWLEDGE_RETRIEVE_CAPABILITY
        );
        assert_ne!(RAG_EVIDENCE_RETRIEVE_CAPABILITY, INSPECT_CAPABILITY);

        let actor = ActorCredentials::from_headers(&actor_headers()).expect("actor");
        // Neither neighbouring capability, a wildcard, nor a prefix authorizes RAG.
        for held in [
            KNOWLEDGE_RETRIEVE_CAPABILITY,
            INSPECT_CAPABILITY,
            "*",
            "ai.evidence",
            "ai.evidence.retrieve.extra",
            "AI.EVIDENCE.RETRIEVE",
        ] {
            let held = envelope(json!([{"capabilityKey": held, "maxRows": 5, "maxBytes": 500}]));
            assert!(!held.permits(&actor, RAG_EVIDENCE_RETRIEVE_CAPABILITY));
        }
        // And an empty grant set (the default: nothing is seeded) denies.
        assert!(envelope(json!([]))
            .bounds_for(&actor, RAG_EVIDENCE_RETRIEVE_CAPABILITY)
            .is_none());
    }

    #[test]
    fn exact_actor_org_and_company_match_returns_typed_bounds() {
        let actor = ActorCredentials::from_headers(&actor_headers()).expect("actor");
        let granted = envelope(json!([
            {"capabilityKey": "ai.evidence.inspect", "maxRows": 99, "maxBytes": 999},
            {"capabilityKey": RAG_EVIDENCE_RETRIEVE_CAPABILITY, "maxRows": 4, "maxBytes": 2048},
        ]));
        assert_eq!(
            granted.bounds_for(&actor, RAG_EVIDENCE_RETRIEVE_CAPABILITY),
            Some(CapabilityGrantBounds {
                max_rows: 4,
                max_bytes: 2048
            })
        );

        for (field, value) in [
            ("organizationId", json!(8)),
            ("companyId", json!(10)),
            ("actorIdentity", json!("b".repeat(64))),
        ] {
            let mut foreign = json!({
                "organizationId": 7,
                "companyId": 9,
                "actorIdentity": "a".repeat(64),
                "grants": [{"capabilityKey": RAG_EVIDENCE_RETRIEVE_CAPABILITY, "maxRows": 4, "maxBytes": 2048}],
            });
            foreign[field] = value;
            let foreign: CapabilityGrantEnvelope =
                serde_json::from_value(foreign).expect("foreign envelope");
            assert!(
                foreign
                    .bounds_for(&actor, RAG_EVIDENCE_RETRIEVE_CAPABILITY)
                    .is_none(),
                "{field} mismatch must deny"
            );
        }
    }

    #[test]
    fn duplicate_capability_rows_can_only_narrow_bounds() {
        let actor = ActorCredentials::from_headers(&actor_headers()).expect("actor");
        let duplicated = envelope(json!([
            {"capabilityKey": RAG_EVIDENCE_RETRIEVE_CAPABILITY, "maxRows": 10, "maxBytes": 100},
            {"capabilityKey": RAG_EVIDENCE_RETRIEVE_CAPABILITY, "maxRows": 3, "maxBytes": 900},
            {"capabilityKey": RAG_EVIDENCE_RETRIEVE_CAPABILITY, "maxRows": 0, "maxBytes": 1},
        ]));
        assert_eq!(
            duplicated.bounds_for(&actor, RAG_EVIDENCE_RETRIEVE_CAPABILITY),
            Some(CapabilityGrantBounds {
                max_rows: 3,
                max_bytes: 100
            })
        );
    }

    #[test]
    fn malformed_grant_envelopes_do_not_parse() {
        for malformed in [
            json!({"organizationId": 7, "companyId": 9, "actorIdentity": "a", "grants": [{"capabilityKey": "x", "maxRows": -1, "maxBytes": 1}]}),
            json!({"organizationId": 7, "companyId": 9, "actorIdentity": "a", "grants": [{"capabilityKey": "x", "maxRows": "1", "maxBytes": 1}]}),
            json!({"organizationId": 7, "companyId": 9, "actorIdentity": "a", "grants": [{"capabilityKey": "x", "maxRows": 1, "maxBytes": 1, "extra": true}]}),
            json!({"organizationId": 7, "companyId": 9, "grants": []}),
            json!({"companyId": 9, "actorIdentity": "a", "grants": []}),
            json!({"organizationId": 7, "companyId": 9, "actorIdentity": "a"}),
            json!({"grants": []}),
            json!("grants"),
        ] {
            assert!(
                serde_json::from_value::<CapabilityGrantEnvelope>(malformed.clone()).is_err(),
                "{malformed}"
            );
        }
    }

    /// Serve `handler` on an ephemeral loopback port for one test.
    async fn grant_service(router: axum::Router) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind grant service");
        let address = listener.local_addr().expect("local addr");
        tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        format!("http://{address}")
    }

    #[tokio::test]
    async fn grant_service_outcomes_fail_closed() {
        use axum::{http::StatusCode, routing::get, Router};

        let actor = ActorCredentials::from_headers(&actor_headers()).expect("actor");
        let http = reqwest::Client::new();
        let short = Duration::from_millis(150);

        // Healthy: parses to a typed envelope.
        let body = json!({
            "organizationId": 7,
            "companyId": 9,
            "actorIdentity": "a".repeat(64),
            "grants": [{"capabilityKey": RAG_EVIDENCE_RETRIEVE_CAPABILITY, "maxRows": 2, "maxBytes": 64}],
        });
        let healthy = grant_service(Router::new().route(
            "/v1/ai/capability-grants",
            get(move || {
                let body = body.clone();
                async move { axum::Json(body) }
            }),
        ))
        .await;
        let envelope = fetch_actor_grants(&http, &healthy, &actor, short)
            .await
            .expect("healthy grant service");
        assert!(envelope.permits(&actor, RAG_EVIDENCE_RETRIEVE_CAPABILITY));

        // Timeout: no answer within the deadline is "unavailable", never "allowed".
        let slow = grant_service(Router::new().route(
            "/v1/ai/capability-grants",
            get(|| async {
                tokio::time::sleep(Duration::from_secs(5)).await;
                axum::Json(json!({"grants": []}))
            }),
        ))
        .await;
        let started = std::time::Instant::now();
        assert!(matches!(
            fetch_actor_grants(&http, &slow, &actor, short).await,
            Err(AppError::Unavailable(_))
        ));
        assert!(started.elapsed() < Duration::from_secs(2));

        // Server error is unavailable; client error (revoked session) is forbidden.
        let broken = grant_service(Router::new().route(
            "/v1/ai/capability-grants",
            get(|| async { StatusCode::INTERNAL_SERVER_ERROR }),
        ))
        .await;
        assert!(matches!(
            fetch_actor_grants(&http, &broken, &actor, short).await,
            Err(AppError::Unavailable(_))
        ));
        let unauthorized = grant_service(Router::new().route(
            "/v1/ai/capability-grants",
            get(|| async { StatusCode::UNAUTHORIZED }),
        ))
        .await;
        assert!(matches!(
            fetch_actor_grants(&http, &unauthorized, &actor, short).await,
            Err(AppError::Forbidden(_))
        ));

        // A 200 with a malformed envelope is unavailable, not an empty allow.
        let malformed = grant_service(Router::new().route(
            "/v1/ai/capability-grants",
            get(|| async { axum::Json(json!({"grants": [{"capabilityKey": "x"}]})) }),
        ))
        .await;
        assert!(matches!(
            fetch_actor_grants(&http, &malformed, &actor, short).await,
            Err(AppError::Unavailable(_))
        ));

        // Nothing listening at all.
        assert!(matches!(
            fetch_actor_grants(&http, "http://127.0.0.1:9", &actor, short).await,
            Err(AppError::Unavailable(_))
        ));
    }

    #[test]
    fn run_history_cursor_round_trips_and_rejects_forgery_shapes() {
        let cursor = encode_run_cursor(42);
        assert_eq!(decode_run_cursor(Some(&cursor)).expect("cursor"), Some(42));
        assert_eq!(decode_run_cursor(None).expect("empty cursor"), None);
        let zero_cursor = URL_SAFE_NO_PAD.encode([0_u8; 8]);
        for invalid in ["", "42", "not/base64", zero_cursor.as_str()] {
            assert!(decode_run_cursor(Some(invalid)).is_err(), "{invalid}");
        }
    }

    #[test]
    fn economics_are_tenant_bound_bounded_and_never_expose_failure_text() {
        let attempts = vec![
            json!({"organizationId": 7, "companyId": 9, "runId": 42, "provider": "openai", "model": "gpt-test", "status": "succeeded", "inputTokens": 100, "outputTokens": 20, "failureReason": "secret"}),
            json!({"organizationId": 7, "companyId": 9, "runId": 42, "provider": "openai", "model": "gpt-test", "status": "outcome_unknown", "inputTokens": 0, "outputTokens": 0, "failureReason": "private network detail"}),
            json!({"organizationId": 7, "companyId": 10, "runId": 42, "provider": "foreign", "model": "foreign", "status": "failed", "inputTokens": 999, "outputTokens": 999}),
        ];
        let reservations = vec![
            json!({"organizationId": 7, "companyId": 9, "runId": 42, "currency": "USD", "reservedUnits": 90, "settledUnits": 30, "status": "settled"}),
            json!({"organizationId": 8, "companyId": 9, "runId": 42, "currency": "EUR", "reservedUnits": 999, "settledUnits": 999, "status": "settled"}),
        ];
        let summary = economics_from_rows(7, 9, 42, &attempts, &reservations).expect("economics");
        assert_eq!(summary.attempt_count, Some(2));
        assert_eq!(summary.input_tokens, None);
        assert_eq!(summary.output_tokens, None);
        assert_eq!(summary.currency.as_deref(), Some("USD"));
        assert_eq!(summary.reserved_units, Some(90));
        assert_eq!(summary.settled_units, Some(30));
        assert!(summary.outcome_unknown);
        assert_eq!(
            summary.provider_models,
            vec![ProviderModelSummary {
                provider: "openai".into(),
                model: "gpt-test".into(),
            }]
        );
        let encoded = serde_json::to_string(&summary).expect("serialize");
        assert!(!encoded.contains("secret"));
        assert!(!encoded.contains("private network detail"));
        assert!(!encoded.contains("foreign"));
    }

    #[test]
    fn incomplete_provider_usage_never_becomes_zero_or_an_overflowed_total() {
        let known = json!({"organizationId": 7, "companyId": 9, "runId": 42,
            "status": "succeeded", "inputTokens": 6173, "outputTokens": 449});
        let summary = economics_from_rows(7, 9, 42, &[known.clone()], &[]).expect("usage");
        assert_eq!(summary.input_tokens, Some(6173));
        assert_eq!(summary.output_tokens, Some(449));
        for bad in [
            json!({"inputTokens": null}),
            json!({"inputTokens": -1}),
            json!({"status": "dispatched"}),
            json!({"status": "unrecognized"}),
        ] {
            let mut row = known.clone();
            row.as_object_mut()
                .expect("object")
                .extend(bad.as_object().expect("patch").clone());
            let summary = economics_from_rows(7, 9, 42, &[row], &[]).expect("usage");
            assert_eq!(summary.input_tokens, None);
            assert_eq!(summary.output_tokens, None);
        }
        let mut huge = known.clone();
        huge["inputTokens"] = json!(u64::MAX);
        let summary = economics_from_rows(7, 9, 42, &[known, huge], &[]).expect("usage");
        assert_eq!(summary.input_tokens, None);
    }

    #[test]
    fn native_metered_usage_is_exact_scoped_and_never_exports_private_output() {
        let attempts = vec![json!({"organizationId":7,"companyId":9,"runId":42,
            "provider":"mistral","model":"mistral-ocr-2505","status":"succeeded",
            "inputTokens":0,"outputTokens":0})];
        let reservations = vec![json!({"id":90,"organizationId":7,"companyId":9,"runId":42,
            "model":"mistral-ocr-2505","priceSnapshotId":0,"status":"settled",
            "currency":"USD","reservedUnits":50,"settledUnits":30})];
        let meters = vec![
            json!({"reservationId":90,"organizationId":7,"companyId":9,"runId":42,
                "model":"mistral-ocr-2505","unit":"pages","allowance":5,"actualUnits":3,
                "resultJson":"private document text","actorIdentity":"private identity","requestKey":"private key"}),
            json!({"reservationId":91,"organizationId":8,"companyId":9,"runId":42,
                "model":"foreign","unit":"pages","allowance":99,"actualUnits":99}),
        ];
        let mut summary = economics_from_rows(7, 9, 42, &attempts, &reservations).unwrap();
        // Even before native metadata is available, LLM token0 is not usage.
        assert_eq!(summary.input_tokens, None);
        assert_eq!(summary.output_tokens, None);
        assert!(!summary.metered_usage.as_ref().unwrap().complete);
        apply_metered_usage(&mut summary, 7, 9, 42, &reservations, &meters);
        let usage = summary.metered_usage.as_ref().unwrap();
        assert!(usage.complete);
        assert_eq!(
            usage.totals,
            vec![MeteredUsageTotal {
                unit: "pages".into(),
                allowance: Some(5),
                actual_units: Some(3)
            }]
        );
        assert_eq!(summary.settled_units, Some(30));
        let encoded = serde_json::to_string(&summary).unwrap();
        for forbidden in [
            "private",
            "resultJson",
            "actorIdentity",
            "requestKey",
            "foreign",
        ] {
            assert!(!encoded.contains(forbidden), "{forbidden}");
        }
    }

    #[test]
    fn native_usage_missing_pending_or_malformed_never_claims_a_complete_total() {
        let reservation = json!({"id":90,"organizationId":7,"companyId":9,"runId":42,
            "model":"mistral-embed","priceSnapshotId":0,"status":"settled",
            "currency":"USD","reservedUnits":50,"settledUnits":30});
        let meter = json!({"reservationId":90,"organizationId":7,"companyId":9,"runId":42,
            "model":"mistral-embed","unit":"tokens","allowance":100,"actualUnits":75});
        let missing = economics_from_rows(7, 9, 42, &[], &[reservation.clone()]).unwrap();
        assert!(missing.metered_usage.as_ref().unwrap().totals.is_empty());
        assert_eq!(missing.input_tokens, None);
        assert_eq!(missing.settled_units, Some(30));
        for patch in [
            json!({"actualUnits":null}),
            json!({"actualUnits":101}),
            json!({"reservationId":91}),
            json!({"unit":"requests"}),
            json!({"model":"other"}),
            json!({"allowance":null}),
        ] {
            let mut row = meter.clone();
            row.as_object_mut()
                .unwrap()
                .extend(patch.as_object().unwrap().clone());
            let mut summary = missing.clone();
            apply_metered_usage(&mut summary, 7, 9, 42, &[reservation.clone()], &[row]);
            let usage = summary.metered_usage.unwrap();
            assert!(!usage.complete);
            assert!(usage
                .totals
                .iter()
                .all(|total| total.actual_units.is_none()));
        }
        let mut pending = reservation.clone();
        pending["status"] = json!("reserved");
        let mut summary = missing.clone();
        apply_metered_usage(&mut summary, 7, 9, 42, &[pending], &[meter.clone()]);
        assert!(!summary.metered_usage.as_ref().unwrap().complete);
        let mut complete = missing.clone();
        apply_metered_usage(
            &mut complete,
            7,
            9,
            42,
            &[reservation.clone()],
            &[meter.clone()],
        );
        assert_eq!(
            complete.metered_usage.unwrap().totals[0].actual_units,
            Some(75)
        );
        let mut duplicate = missing.clone();
        apply_metered_usage(
            &mut duplicate,
            7,
            9,
            42,
            &[reservation.clone()],
            &[meter.clone(), meter.clone()],
        );
        assert!(!duplicate.metered_usage.unwrap().complete);
        let mut truncated = missing;
        apply_metered_usage(
            &mut truncated,
            7,
            9,
            42,
            &[reservation],
            &vec![meter; MAX_RUN_ECONOMICS_ROWS + 1],
        );
        let usage = truncated.metered_usage.unwrap();
        assert!(usage.truncated);
        assert!(!usage.complete);
        assert!(usage
            .totals
            .iter()
            .all(|total| total.allowance.is_none() && total.actual_units.is_none()));
    }

    #[test]
    fn native_accounting_history_never_exposes_the_run_token_placeholder() {
        let item = history_item_from_row(&json!({"id":42,"status":"completed","skillId":0,
            "agentId":7,"stepCount":0,"tokensUsed":0,"startedAt":"2026-11-04"}))
        .unwrap();
        assert_eq!(item.tokens_used, None);
    }

    #[test]
    fn truncated_economics_never_claim_complete_totals() {
        let attempts = (0..=MAX_RUN_ECONOMICS_ROWS)
            .map(|id| json!({"id": id + 1, "organizationId": 7, "companyId": 9, "runId": 42, "provider": "p", "model": "m", "status": "succeeded", "inputTokens": 1, "outputTokens": 1}))
            .collect::<Vec<_>>();
        let summary = economics_from_rows(7, 9, 42, &attempts, &[]).expect("economics");
        assert!(summary.truncated);
        assert_eq!(summary.attempt_count, None);
        assert_eq!(summary.input_tokens, None);
        assert_eq!(summary.output_tokens, None);
        assert_eq!(summary.reserved_units, None);
        assert_eq!(summary.settled_units, None);
    }

    #[test]
    fn economics_preserve_recovery_statuses_and_flag_provider_truncation() {
        let attempts = (0..=MAX_PROVIDER_MODELS)
            .map(|index| {
                json!({
                    "organizationId": 7,
                    "companyId": 9,
                    "runId": 42,
                    "provider": format!("provider-{index}"),
                    "model": "model",
                    "status": "abandoned",
                    "inputTokens": 0,
                    "outputTokens": 0
                })
            })
            .collect::<Vec<_>>();
        let reservations = vec![json!({
            "organizationId": 7,
            "companyId": 9,
            "runId": 42,
            "provider": "provider-0",
            "model": "model",
            "currency": "USD",
            "reservedUnits": 10,
            "settledUnits": 0,
            "status": "released"
        })];
        let summary = economics_from_rows(7, 9, 42, &attempts, &reservations).expect("economics");
        assert_eq!(summary.attempt_statuses, vec!["abandoned"]);
        assert_eq!(summary.reservation_statuses, vec!["released"]);
        assert!(summary.provider_models_truncated);
        assert!(!summary.truncated);
        assert_eq!(summary.attempt_count, Some(9));
    }
}
