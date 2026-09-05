//! `/v1/crm/*` — parity with `frontend/web/app/api/crm/*/route.ts`.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tower_cookies::Cookies;

use crate::error::ApiError;
use crate::query_exec::execute_resource_query;
use crate::state::AppState;
use crate::web_session::{require_org, resolve_session};

use super::paginate_limit_offset;

pub(super) fn contact_role_assign_params(body: &Value) -> Result<Value, ApiError> {
    let contact_id = body
        .get("contact_id")
        .ok_or_else(|| ApiError::BadRequest("missing contact_id".into()))?
        .clone();
    let company_id = body.get("company_id").cloned().unwrap_or(Value::Null);
    let role = body
        .get("role")
        .ok_or_else(|| ApiError::BadRequest("missing role".into()))?;
    let active_from = body.get("active_from").cloned().unwrap_or(Value::Null);
    let active_until = body.get("active_until").cloned().unwrap_or(Value::Null);
    let metadata = body.get("metadata").cloned().unwrap_or(Value::Null);
    Ok(json!({
        "contact_id": contact_id,
        "company_id": company_id,
        "role": role.clone(),
        "active_from": active_from,
        "active_until": active_until,
        "metadata": metadata,
    }))
}

#[derive(Debug, Deserialize)]
pub(super) struct RoleListQuery {
    limit: Option<u64>,
    offset: Option<u64>,
}

pub(super) async fn contact_roles_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(q): Query<RoleListQuery>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let (limit, offset) = paginate_limit_offset(q.limit, q.offset);

    let client = state.stdb.clone();
    let rows = execute_resource_query(
        &client,
        "contact-role-assignments",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;

    let total = rows.len();
    let data: Vec<Value> = rows.into_iter().skip(offset).take(limit).collect();
    Ok(Json(
        json!({ "data": data, "meta": { "total": total, "limit": limit, "offset": offset } }),
    ))
}

pub(super) async fn contact_roles_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let params = contact_role_assign_params(&body)?;
    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer(stdb_client::reducer_call!(
            "assign_contact_role",
            json!([org_id, params])
        ))
        .await
        .map_err(ApiError::internal)?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "data": { "message": "Contact role assigned successfully" } })),
    ))
}

pub(super) async fn contact_role_end(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(id): Path<u64>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let reason = body.get("reason").cloned().unwrap_or(Value::Null);
    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer(stdb_client::reducer_call!(
            "end_contact_role",
            json!([org_id, id, { "reason": reason }]),
        ))
        .await
        .map_err(ApiError::internal)?;
    Ok(Json(
        json!({ "data": { "message": "Contact role ended successfully" } }),
    ))
}
