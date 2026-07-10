//! Promoted green skill: report composer.

use axum::{extract::State, Json};
use serde::Deserialize;

use crate::{
    error::{AppError, AppResult},
    harness::report_composer::{compose_report, ReportComposerInput, ReportComposerResult},
    state::AppState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayReportComposeRequest {
    pub org_id: u64,
    pub company_id: u64,
    pub report_key: String,
    pub date: String,
    pub timezone: String,
    pub stdb_token: String,
    pub identity_hex: Option<String>,
}

pub async fn post_compose(
    State(state): State<AppState>,
    Json(req): Json<GatewayReportComposeRequest>,
) -> AppResult<Json<ReportComposerResult>> {
    if req.org_id == 0 {
        return Err(AppError::BadRequest("org_id is required".into()));
    }
    if req.company_id == 0 {
        return Err(AppError::BadRequest("company_id is required".into()));
    }
    if req.report_key.trim().is_empty() {
        return Err(AppError::BadRequest("report_key is required".into()));
    }
    if req.stdb_token.trim().is_empty() {
        return Err(AppError::BadRequest("stdb_token is required".into()));
    }

    let api_server_url = state
        .config
        .api_server_url
        .as_deref()
        .ok_or_else(|| AppError::Internal("api-server URL is not configured".into()))?;

    let identity_hex = req
        .identity_hex
        .unwrap_or_else(|| "report-composer".to_string());

    let result = compose_report(
        &state.http,
        api_server_url,
        req.org_id,
        &identity_hex,
        &req.stdb_token,
        ReportComposerInput {
            report_key: req.report_key,
            company_id: req.company_id,
            date: req.date,
            timezone: req.timezone,
        },
    )
    .await
    .map_err(|message| AppError::Internal(message))?;

    Ok(Json(result))
}
