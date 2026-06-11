//! `/v1/sales/*` — parity with `frontend/web/app/api/sales/*/route.ts`.

use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::HeaderMap,
    routing::get,
    Json, Router,
};
use serde_json::{json, Value};
use tower_cookies::Cookies;

use crate::error::ApiError;
use crate::query_exec::{default_company_id, execute_resource_query};
use crate::state::AppState;
use crate::web_session::{require_org, resolve_session};

fn value_as_u64(v: &Value) -> Option<u64> {
    v.as_u64()
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

fn find_order_by_id(rows: &[Value], order_id: u64) -> Option<Value> {
    rows.iter()
        .find(|o| value_as_u64(o.get("id").unwrap_or(&Value::Null)) == Some(order_id))
        .cloned()
}

async fn sale_order_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let order_id: u64 = id
        .parse()
        .map_err(|_| ApiError::BadRequest("Invalid order ID".into()))?;

    let client = state.client_with_token(&session.stdb_token);
    let orders = execute_resource_query(
        &client,
        "sale-orders",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;
    let order = find_order_by_id(&orders, order_id)
        .ok_or_else(|| ApiError::NotFound("Sale order not found".into()))?;
    Ok(Json(json!({ "data": order })))
}

async fn sale_order_put(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(id): Path<String>,
    Json(params): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let order_id: u64 = id
        .parse()
        .map_err(|_| ApiError::BadRequest("Invalid order ID".into()))?;

    let client = state.client_with_token(&session.stdb_token);
    let company_id = default_company_id(&client, org_id)
        .await?
        .ok_or_else(|| ApiError::Unprocessable("No company found for organization".into()))?;

    client
        .call_reducer(
            "update_sale_order",
            json!([org_id, company_id, order_id, params]),
        )
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let orders = execute_resource_query(
        &client,
        "sale-orders",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;
    let updated = find_order_by_id(&orders, order_id);
    Ok(Json(json!({ "data": updated })))
}

async fn sale_order_delete(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let order_id: u64 = id
        .parse()
        .map_err(|_| ApiError::BadRequest("Invalid order ID".into()))?;

    let reason: Option<String> = if body.is_empty() {
        None
    } else {
        serde_json::from_slice::<Value>(&body).ok().and_then(|v| {
            v.get("reason")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string())
        })
    };

    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer("cancel_sale_order", json!([org_id, order_id, reason]))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(Json(
        json!({ "data": { "message": "Sale order cancelled successfully" } }),
    ))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route(
        "/sales/orders/:id",
        get(sale_order_get)
            .put(sale_order_put)
            .delete(sale_order_delete),
    )
}
