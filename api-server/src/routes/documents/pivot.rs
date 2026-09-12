//! Pivot-table XLSX document route.

use std::sync::Arc;

use axum::{extract::State, http::HeaderMap, response::Response, Json};
use serde::Deserialize;
use tower_cookies::Cookies;

use crate::document_render::xlsx::pivot_table_xlsx_bytes;
use crate::error::ApiError;
use crate::state::AppState;
use crate::web_session::{require_org, resolve_session};

use super::attachment_response;

#[derive(Debug, Deserialize)]
pub(super) struct PivotTableBody {
    title: String,
    headers: Vec<String>,
    rows: Vec<Vec<serde_json::Value>>,
}

pub(super) async fn pivot_table_xlsx(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<PivotTableBody>,
) -> Result<Response, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let _org_id = require_org(&session)?;
    if body.headers.is_empty() {
        return Err(ApiError::Unprocessable("Pivot headers are required".into()));
    }
    let bytes = pivot_table_xlsx_bytes(&body.title, &body.headers, &body.rows)?;
    let slug = body
        .title
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect::<String>()
        .to_lowercase();
    attachment_response(
        format!("{slug}.xlsx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes,
    )
}
