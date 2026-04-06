//! `/v1/inventory/*` — parity with `frontend/web/app/api/inventory/*/route.ts`.

use std::sync::Arc;

use axum::{
    extract::State,
    http::HeaderMap,
    routing::get,
    Json, Router,
};
use serde_json::{json, Value};
use tower_cookies::Cookies;

use crate::error::ApiError;
use crate::query_exec::execute_resource_query;
use crate::state::AppState;
use crate::web_session::{require_org, resolve_session};

async fn pickings_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let client = state.client_with_token(&session.stdb_token);
    let data = execute_resource_query(
        &client,
        "stock-pickings",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;
    Ok(Json(json!({ "data": data })))
}

async fn pickings_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer("create_stock_picking", json!([org_id, body]))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "data": { "message": "Stock picking created successfully" } })),
    ))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/inventory/pickings", get(pickings_get).post(pickings_post))
}
