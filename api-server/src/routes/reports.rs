use std::{str::FromStr, sync::Arc};

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use tower_cookies::Cookies;

use crate::{
    error::ApiError,
    reports::{
        catalog::{report_catalog, ReportCatalogV1},
        common::{ReportKey, ReportPreviewRequest},
        service::{preview_report, ReportPreview},
    },
    state::AppState,
    web_session::{require_org, resolve_session},
};

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
    let client = state.client_with_token(&session.stdb_token);
    let preview = preview_report(
        &client,
        report_key,
        organization_id,
        &session.identity_hex,
        request,
    )
    .await?;

    Ok(Json(preview))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/reports/catalog", get(catalog_get))
        .route("/reports/:report_key/preview", post(preview_post))
}
