use std::{fs, path::PathBuf};
use std::{str::FromStr, sync::Arc};

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
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
    let client = state.client_with_token(&session.stdb_token);
    Ok(Json(
        report_history(&client, organization_id, query.company_id).await?,
    ))
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
    record_generated_report(&state, &client, organization_id, &preview, &bytes).await?;
    Ok((
        [(axum::http::header::CONTENT_TYPE, "application/pdf")],
        bytes,
    )
        .into_response())
}

async fn record_generated_report(
    state: &AppState,
    client: &stdb_client::StdbClient,
    organization_id: u64,
    preview: &ReportPreview,
    pdf: &[u8],
) -> Result<(), ApiError> {
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
    let correlation_id = format!("owner-report:{}:{}", report_key, &output_hash[..16]);
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
        .call_reducer(
            "record_generated_owner_report",
            json!([organization_id, company_id, params]),
        )
        .await
        .map_err(|error| ApiError::Internal(format!("record generated owner report: {error}")));
    if result.is_err() {
        let _ = fs::remove_file(&artifact_path);
    }
    result
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
        .route("/reports/:report_key/preview", post(preview_post))
        .route("/reports/:report_key/pdf", post(pdf_post))
}
