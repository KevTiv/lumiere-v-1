//! `/v1/vertical-packs/*` — company-scoped vertical product pack state.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::get,
    Json, Router,
};
use serde_json::{json, Value};
use tower_cookies::Cookies;

use crate::error::ApiError;
use crate::state::AppState;
use crate::web_session::{require_org, resolve_session};

async fn company_packs_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(company_id): Path<u64>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let organization_id = require_org(&session)?;
    let client = state.client_with_token(&session.stdb_token);
    let company_rows = client
        .query_sql(&format!(
            "SELECT id FROM company WHERE organization_id = {organization_id} AND id = {company_id} AND deleted_at IS NULL LIMIT 1"
        ))
        .await
        .map_err(|error| ApiError::Internal(error.to_string()))?;
    if company_rows.is_empty() {
        return Err(ApiError::NotFound("company not found".into()));
    }
    let data = client
        .query_sql(&format!(
            "SELECT id, company_id, pack_key, enabled, configuration, updated_at FROM company_vertical_pack WHERE organization_id = {organization_id} AND company_id = {company_id}"
        ))
        .await
        .map_err(|error| ApiError::Internal(error.to_string()))?;
    Ok(Json(json!({ "data": data })))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/vertical-packs/:company_id", get(company_packs_get))
}
