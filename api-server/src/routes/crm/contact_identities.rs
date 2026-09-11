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

use crate::commands::dispatch_session_reducer;
use crate::error::ApiError;
use crate::query_exec::execute_resource_query;
use crate::state::AppState;
use crate::trusted_context::TrustedOperationContext;
use crate::web_session::{require_org, resolve_session};

use super::paginate_limit_offset;

pub(super) fn to_unit_enum(value: &Value) -> Result<Value, ApiError> {
    match value {
        Value::String(s) => Ok(json!({ s: [] })),
        _ => Err(ApiError::BadRequest("expected enum variant string".into())),
    }
}

pub(super) fn contact_identity_create_params(body: &Value) -> Result<Value, ApiError> {
    let contact_id = body
        .get("contact_id")
        .ok_or_else(|| ApiError::BadRequest("missing contact_id".into()))?
        .clone();
    let company_id = body.get("company_id").cloned().unwrap_or(Value::Null);
    let kind = body
        .get("kind")
        .ok_or_else(|| ApiError::BadRequest("missing kind".into()))?
        .clone();
    let raw_value = body
        .get("raw_value")
        .ok_or_else(|| ApiError::BadRequest("missing raw_value".into()))?
        .clone();
    let is_preferred = body.get("is_preferred").cloned().unwrap_or(json!(false));
    let verification_state = body
        .get("verification_state")
        .cloned()
        .unwrap_or(Value::String("Unverified".into()));
    let metadata = body.get("metadata").cloned().unwrap_or(Value::Null);
    Ok(json!({
        "contact_id": contact_id,
        "company_id": company_id,
        "kind": to_unit_enum(&kind)?,
        "raw_value": raw_value,
        "is_preferred": is_preferred,
        "verification_state": to_unit_enum(&verification_state)?,
        "metadata": metadata,
    }))
}

pub(super) fn contact_identity_update_params(body: &Value) -> Result<Value, ApiError> {
    let company_id = body.get("company_id").cloned().unwrap_or(Value::Null);
    let raw_value = body
        .get("raw_value")
        .ok_or_else(|| ApiError::BadRequest("missing raw_value".into()))?
        .clone();
    let is_preferred = body.get("is_preferred").cloned().unwrap_or(json!(false));
    let verification_state = body
        .get("verification_state")
        .cloned()
        .unwrap_or(Value::String("Unverified".into()));
    let metadata = body.get("metadata").cloned().unwrap_or(Value::Null);
    Ok(json!({
        "company_id": company_id,
        "raw_value": raw_value,
        "is_preferred": is_preferred,
        "verification_state": to_unit_enum(&verification_state)?,
        "metadata": metadata,
    }))
}

#[derive(Debug, Deserialize)]
pub(super) struct IdentityListQuery {
    limit: Option<u64>,
    offset: Option<u64>,
}

pub(super) async fn contact_identities_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(q): Query<IdentityListQuery>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let (limit, offset) = paginate_limit_offset(q.limit, q.offset);

    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    let client = state.stdb.clone();
    let rows = execute_resource_query(
        &client,
        "contact-phone-identities",
        org_id,
        context.actor_identity(),
        Some(context.field_access()),
    )
    .await?;

    let total = rows.len();
    let data: Vec<Value> = rows.into_iter().skip(offset).take(limit).collect();
    Ok(Json(
        json!({ "data": data, "meta": { "total": total, "limit": limit, "offset": offset } }),
    ))
}

pub(super) async fn contact_identities_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let params = contact_identity_create_params(&body)?;
    dispatch_session_reducer(
        &state,
        &session,
        "create_contact_identity",
        json!([org_id, params]),
    )
    .await?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "data": { "message": "Contact identity created successfully" } })),
    ))
}

pub(super) async fn contact_identity_put(
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
    let params = contact_identity_update_params(&body)?;
    dispatch_session_reducer(
        &state,
        &session,
        "update_contact_identity",
        json!([org_id, id, params]),
    )
    .await?;
    Ok(Json(
        json!({ "data": { "message": "Contact identity updated successfully" } }),
    ))
}

pub(super) async fn contact_identity_verify(
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
    let state_value = body
        .get("state")
        .ok_or_else(|| ApiError::BadRequest("missing state".into()))?;
    dispatch_session_reducer(
        &state,
        &session,
        "verify_contact_identity",
        json!([org_id, id, to_unit_enum(state_value)?]),
    )
    .await?;
    Ok(Json(
        json!({ "data": { "message": "Contact identity verified successfully" } }),
    ))
}

pub(super) async fn contact_identity_archive(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(id): Path<u64>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    dispatch_session_reducer(
        &state,
        &session,
        "archive_contact_identity",
        json!([org_id, id]),
    )
    .await?;
    Ok(Json(
        json!({ "data": { "message": "Contact identity archived successfully" } }),
    ))
}
