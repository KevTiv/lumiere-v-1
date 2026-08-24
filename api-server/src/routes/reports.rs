use std::{fs, path::PathBuf};
use std::{str::FromStr, sync::Arc};

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, patch, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use tower_cookies::Cookies;

use crate::{
    error::ApiError,
    reports::{
        auth::{
            ensure_report_access, ensure_report_history_access, mask_report_preview, ReportAccess,
        },
        catalog::{report_catalog, ReportCatalogV1},
        common::{GeneratedOwnerReportHistoryRow, ReportKey, ReportPreviewRequest},
        render::render_pdf,
        service::{preview_report, report_artifact_key, report_history, ReportPreview},
    },
    state::AppState,
    web_session::{require_org, resolve_session},
};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReportHistoryQuery {
    company_id: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleQuery {
    company_id: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnerScheduleInput {
    name: String,
    company_id: u64,
    report_key: String,
    frequency: String,
    hour: u8,
    minute: u8,
    timezone: String,
    recipient_identities: Vec<String>,
    next_run: String,
    is_active: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnerScheduleUpdateInput {
    name: Option<String>,
    frequency: Option<String>,
    hour: Option<u8>,
    minute: Option<u8>,
    timezone: Option<String>,
    recipient_identities: Option<Vec<String>>,
    is_active: Option<bool>,
    next_run: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OwnerScheduleList {
    schedules: Vec<serde_json::Value>,
    runs: Vec<serde_json::Value>,
}

async fn catalog_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
) -> Result<Json<ReportCatalogV1>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    require_org(&session)?;

    Ok(Json(report_catalog()))
}

async fn preview_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(report_key): Path<String>,
    Json(request): Json<ReportPreviewRequest>,
) -> Result<Json<ReportPreview>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let organization_id = require_org(&session)?;
    let report_key = ReportKey::from_str(&report_key)
        .map_err(|_| ApiError::NotFound("Unknown report key".into()))?;
    ensure_report_access(
        session.field_access.as_ref(),
        report_key,
        ReportAccess::Preview,
    )?;
    let client = state.stdb.clone();
    let preview = preview_report(
        &client,
        report_key,
        organization_id,
        &session.identity_hex,
        request,
    )
    .await?;
    let preview = mask_report_preview(preview, session.field_access.as_ref());

    Ok(Json(preview))
}

async fn history_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(query): Query<ReportHistoryQuery>,
) -> Result<Json<Vec<GeneratedOwnerReportHistoryRow>>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let organization_id = require_org(&session)?;
    if query.company_id == 0 {
        return Err(ApiError::BadRequest(
            "companyId must be greater than zero".into(),
        ));
    }
    ensure_report_history_access(session.field_access.as_ref())?;
    let client = state.stdb.clone();
    Ok(Json(
        report_history(&client, organization_id, query.company_id).await?,
    ))
}

async fn owner_schedule_recipients_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
) -> Result<Json<Vec<serde_json::Value>>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let organization_id = require_org(&session)?;
    ensure_report_history_access(session.field_access.as_ref())?;
    let client = state.client_with_token(&session.stdb_token);
    let rows = client
        .query_sql(&format!(
            "SELECT user_identity FROM user_organization WHERE organization_id = {organization_id} AND is_active = true"
        ))
        .await
        .map_err(|error| ApiError::Internal(format!("list owner-report recipients: {error}")))?;
    Ok(Json(rows))
}

async fn owner_schedules_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(query): Query<ScheduleQuery>,
) -> Result<Json<OwnerScheduleList>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let organization_id = require_org(&session)?;
    ensure_report_history_access(session.field_access.as_ref())?;
    if query.company_id == 0 {
        return Err(ApiError::BadRequest(
            "companyId must be greater than zero".into(),
        ));
    }
    let client = state.client_with_token(&session.stdb_token);
    let schedules = client.query_sql(&format!(
        "SELECT * FROM scheduled_report WHERE organization_id = {organization_id} AND company_id = {} AND owner_report_key IS NOT NULL",
        query.company_id
    )).await.map_err(|error| ApiError::Internal(format!("list owner-report schedules: {error}")))?;
    let schedule_ids: std::collections::HashSet<u64> = schedules
        .iter()
        .filter_map(|schedule| schedule.get("id").and_then(|value| value.as_u64()))
        .collect();
    let runs = client
        .query_sql(&format!(
        "SELECT * FROM scheduled_report_run WHERE organization_id = {organization_id} LIMIT 100"
    ))
        .await
        .map_err(|error| ApiError::Internal(format!("list owner-report runs: {error}")))?
        .into_iter()
        .filter(|run| {
            run.get("scheduledReportId")
                .or_else(|| run.get("scheduled_report_id"))
                .and_then(|value| value.as_u64())
                .is_some_and(|id| schedule_ids.contains(&id))
        })
        .collect();
    Ok(Json(OwnerScheduleList { schedules, runs }))
}

async fn owner_schedule_create(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(input): Json<OwnerScheduleInput>,
) -> Result<StatusCode, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let organization_id = require_org(&session)?;
    let report_key = ReportKey::from_str(&input.report_key)
        .map_err(|_| ApiError::BadRequest("unknown owner report key".into()))?;
    ensure_report_access(
        session.field_access.as_ref(),
        report_key,
        ReportAccess::Export,
    )?;
    let timezone = crate::reports::timezone::parse_timezone(&input.timezone)?;
    let next_run = parse_schedule_timestamp(&input.next_run)?;
    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer(stdb_client::reducer_call!(
            "create_scheduled_report",
            json!([organization_id, input.company_id, {
                "name": input.name,
                "report_template_id": null,
                "owner_report_key": input.report_key,
                "timezone": timezone.name(),
                "model": "owner_report",
                "frequency": input.frequency,
                "hour": input.hour,
                "minute": input.minute,
                "attachment_format": "PDF",
                "next_run": timestamp_json(next_run),
                "is_active": input.is_active.unwrap_or(true),
                "recipients": [],
                "recipient_identities": input.recipient_identities,
                "description": null,
                "domain": null,
                "day_of_week": null,
                "day_of_month": null,
                "subject": null,
                "body": null,
                "metadata": null,
            }]),
        ))
        .await
        .map_err(|error| ApiError::BadRequest(format!("create owner-report schedule: {error}")))?;
    Ok(StatusCode::CREATED)
}

async fn owner_schedule_update(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(report_id): Path<u64>,
    Json(input): Json<OwnerScheduleUpdateInput>,
) -> Result<StatusCode, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let organization_id = require_org(&session)?;
    ensure_report_history_access(session.field_access.as_ref())?;
    let next_run = input
        .next_run
        .as_deref()
        .map(parse_schedule_timestamp)
        .transpose()?;
    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer(stdb_client::reducer_call!(
            "update_owner_report_schedule",
            json!([organization_id, report_id, {
                "name": input.name,
                "frequency": input.frequency,
                "hour": input.hour,
                "minute": input.minute,
                "timezone": input.timezone,
                "recipient_identities": input.recipient_identities,
                "is_active": input.is_active,
                "next_run": next_run.map(timestamp_json),
            }]),
        ))
        .await
        .map_err(|error| ApiError::BadRequest(format!("update owner-report schedule: {error}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn owner_schedule_run_now(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(report_id): Path<u64>,
) -> Result<StatusCode, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let organization_id = require_org(&session)?;
    ensure_report_history_access(session.field_access.as_ref())?;
    state
        .client_with_token(&session.stdb_token)
        .call_reducer(stdb_client::reducer_call!(
            "run_owner_report_schedule",
            json!([organization_id, report_id]),
        ))
        .await
        .map_err(|error| ApiError::BadRequest(format!("run owner-report schedule: {error}")))?;
    Ok(StatusCode::ACCEPTED)
}

fn parse_schedule_timestamp(value: &str) -> Result<i64, ApiError> {
    DateTime::parse_from_rfc3339(value.trim())
        .map(|timestamp| timestamp.with_timezone(&Utc).timestamp_micros())
        .map_err(|_| ApiError::BadRequest("nextRun must be an ISO-8601 timestamp".into()))
}

fn timestamp_json(micros: i64) -> serde_json::Value {
    json!({ "__timestamp_micros_since_unix_epoch__": micros })
}

async fn artifact_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(report_id): Path<u64>,
) -> Result<Response, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let organization_id = require_org(&session)?;
    ensure_report_history_access(session.field_access.as_ref())?;
    let client = state.client_with_token(&session.stdb_token);
    let (_company_id, artifact_key) =
        report_artifact_key(&client, organization_id, report_id).await?;
    let path = artifact_path(&state.config.report_artifact_dir, &artifact_key)?;
    let bytes = fs::read(path).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => ApiError::NotFound("report artifact is unavailable".into()),
        _ => ApiError::Internal(format!("read report artifact: {error}")),
    })?;
    Ok((
        [
            (axum::http::header::CONTENT_TYPE, "application/pdf"),
            (axum::http::header::CONTENT_DISPOSITION, "attachment"),
        ],
        bytes,
    )
        .into_response())
}

async fn pdf_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(report_key): Path<String>,
    Json(request): Json<ReportPreviewRequest>,
) -> Result<Response, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let organization_id = require_org(&session)?;
    let report_key = ReportKey::from_str(&report_key)
        .map_err(|_| ApiError::NotFound("Unknown report key".into()))?;
    ensure_report_access(
        session.field_access.as_ref(),
        report_key,
        ReportAccess::Export,
    )?;
    let client = state.client_with_token(&session.stdb_token);
    let preview = preview_report(
        &client,
        report_key,
        organization_id,
        &session.identity_hex,
        request,
    )
    .await?;
    let preview = mask_report_preview(preview, session.field_access.as_ref());
    let bytes = render_pdf(&state, &preview).await?;
    record_generated_report(&state, &client, organization_id, &preview, &bytes, None).await?;
    Ok((
        [(axum::http::header::CONTENT_TYPE, "application/pdf")],
        bytes,
    )
        .into_response())
}

#[derive(Debug, serde::Deserialize)]
pub(crate) struct RecordedOwnerReport {
    pub id: u64,
    pub document_id: u64,
}

pub(crate) async fn record_generated_report(
    state: &AppState,
    client: &stdb_client::StdbClient,
    organization_id: u64,
    preview: &ReportPreview,
    pdf: &[u8],
    correlation_suffix: Option<&str>,
) -> Result<RecordedOwnerReport, ApiError> {
    let value = serde_json::to_value(preview)
        .map_err(|error| ApiError::Internal(format!("serialize generated report: {error}")))?;
    let report_key = value["reportKey"]
        .as_str()
        .ok_or_else(|| ApiError::Internal("typed report did not include reportKey".into()))?;
    let company_id = value["scope"]["companyId"]
        .as_u64()
        .ok_or_else(|| ApiError::Internal("typed report did not include scope.companyId".into()))?;
    let output_hash = hex::encode(Sha256::digest(pdf));
    let artifact_key = format!("{output_hash}.pdf");
    let artifact_path = artifact_path(&state.config.report_artifact_dir, &artifact_key)?;
    persist_artifact(&artifact_path, pdf)?;
    let correlation_id = match correlation_suffix {
        Some(suffix) => format!("owner-report:{report_key}:{suffix}"),
        None => format!("owner-report:{report_key}:{}", &output_hash[..16]),
    };
    let params = json!({
        "report_key": report_key,
        "schema_version": value["schemaVersion"].as_u64().unwrap_or(1),
        "parameters_json": json!({ "scope": value["scope"] }).to_string(),
        "source_watermark_json": value["sourceWatermark"].to_string(),
        "output_hash": format!("sha256:{output_hash}"),
        "renderer_version": "chromium-worker-v1",
        "artifact_key": artifact_key,
        "artifact_size": pdf.len(),
        "correlation_id": correlation_id,
        "metadata": json!({ "watermark": value["watermark"] }).to_string(),
    });
    let result = client
        .call_reducer(stdb_client::reducer_call!(
            "record_generated_owner_report",
            json!([organization_id, company_id, params]),
        ))
        .await
        .map_err(|error| ApiError::Internal(format!("record generated owner report: {error}")));
    if result.is_err() {
        let _ = fs::remove_file(&artifact_path);
    }
    result?;
    let correlation_sql = correlation_id.replace('\'', "''");
    let rows = client
        .query_sql(&format!(
            "SELECT id, document_id FROM generated_owner_report WHERE organization_id = {organization_id} AND correlation_id = '{correlation_sql}' LIMIT 1"
        ))
        .await
        .map_err(|error| ApiError::Internal(format!("read generated owner report: {error}")))?;
    let row = rows
        .into_iter()
        .next()
        .ok_or_else(|| ApiError::Internal("generated owner report was not persisted".into()))?;
    serde_json::from_value(row)
        .map_err(|error| ApiError::Internal(format!("invalid generated owner report row: {error}")))
}

fn artifact_path(root: &std::path::Path, artifact_key: &str) -> Result<PathBuf, ApiError> {
    if !artifact_key.ends_with(".pdf") || artifact_key.contains('/') || artifact_key.contains('\\')
    {
        return Err(ApiError::Internal("invalid report artifact key".into()));
    }
    Ok(root.join(artifact_key))
}

fn persist_artifact(path: &std::path::Path, bytes: &[u8]) -> Result<(), ApiError> {
    let directory = path
        .parent()
        .ok_or_else(|| ApiError::Internal("report artifact path has no parent".into()))?;
    fs::create_dir_all(directory).map_err(|error| {
        ApiError::Internal(format!("create report artifact directory: {error}"))
    })?;
    if path.exists() {
        return Ok(());
    }
    fs::write(path, bytes)
        .map_err(|error| ApiError::Internal(format!("write report artifact: {error}")))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/reports/catalog", get(catalog_get))
        .route("/reports/history", get(history_get))
        .route("/reports/history/:report_id/pdf", get(artifact_get))
        .route(
            "/reports/schedules/recipients",
            get(owner_schedule_recipients_get),
        )
        .route(
            "/reports/schedules",
            get(owner_schedules_get).post(owner_schedule_create),
        )
        .route(
            "/reports/schedules/:report_id",
            patch(owner_schedule_update),
        )
        .route(
            "/reports/schedules/:report_id/run",
            post(owner_schedule_run_now),
        )
        .route("/reports/:report_key/preview", post(preview_post))
        .route("/reports/:report_key/pdf", post(pdf_post))
}
