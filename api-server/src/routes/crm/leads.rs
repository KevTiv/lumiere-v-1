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

use crate::domain_queries::query_lead_by_id;
use crate::error::ApiError;
use crate::query_exec::execute_resource_query;
use crate::state::AppState;
use crate::web_session::{require_org, resolve_session};

use super::{list_meta, paginate_limit_offset, value_as_str, value_as_u64};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeadsListQuery {
    state: Option<String>,
    user_id: Option<String>,
    priority: Option<String>,
    #[serde(default)]
    limit: Option<u64>,
    #[serde(default)]
    offset: Option<u64>,
}

pub(super) async fn leads_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(q): Query<LeadsListQuery>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let (limit, offset) = paginate_limit_offset(q.limit, q.offset);

    let client = state.stdb.clone();
    let mut rows = execute_resource_query(
        &client,
        "leads",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;

    if let Some(ref st) = q.state {
        rows.retain(|r| value_as_str(r.get("state").unwrap_or(&Value::Null)) == Some(st.as_str()));
    }
    if let Some(ref uid) = q.user_id {
        if let Ok(n) = uid.parse::<u64>() {
            rows.retain(|r| value_as_u64(r.get("userId").unwrap_or(&Value::Null)) == Some(n));
        }
    }
    if let Some(ref pr) = q.priority {
        rows.retain(|r| {
            value_as_str(r.get("priority").unwrap_or(&Value::Null)) == Some(pr.as_str())
        });
    }

    let total = rows.len();
    let page_rows: Vec<Value> = rows.into_iter().skip(offset).take(limit).collect();
    Ok(Json(
        json!({ "data": page_rows, "meta": list_meta(total, offset, limit) }),
    ))
}

pub(super) fn lead_create_params(body: &Value) -> Result<Value, ApiError> {
    let name = body
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ApiError::BadRequest("Name is required".into()))?;
    Ok(json!({
        "name": name,
        "priority": body.get("priority").and_then(|v| v.as_str()).unwrap_or("medium"),
        "state": body.get("state").and_then(|v| v.as_str()).unwrap_or("new"),
        "expectedRevenue": body.get("expectedRevenue").and_then(value_as_u64).unwrap_or(0),
        "probability": body.get("probability").and_then(|v| v.as_f64()).unwrap_or(0.0),
        "tagIds": body.get("tagIds").cloned().unwrap_or(json!([])),
        "email": body.get("email").cloned().unwrap_or(Value::Null),
        "phone": body.get("phone").cloned().unwrap_or(Value::Null),
        "mobile": body.get("mobile").cloned().unwrap_or(Value::Null),
        "companyName": body.get("companyName").cloned().unwrap_or(Value::Null),
        "contactName": body.get("contactName").cloned().unwrap_or(Value::Null),
        "title": body.get("title").cloned().unwrap_or(Value::Null),
        "street": body.get("street").cloned().unwrap_or(Value::Null),
        "city": body.get("city").cloned().unwrap_or(Value::Null),
        "zip": body.get("zip").cloned().unwrap_or(Value::Null),
        "countryCode": body.get("countryCode").cloned().unwrap_or(Value::Null),
        "website": body.get("website").cloned().unwrap_or(Value::Null),
        "industry": body.get("industry").cloned().unwrap_or(Value::Null),
        "sourceId": body.get("sourceId").cloned().unwrap_or(Value::Null),
        "campaignId": body.get("campaignId").cloned().unwrap_or(Value::Null),
        "mediumId": body.get("mediumId").cloned().unwrap_or(Value::Null),
        "referredBy": body.get("referredBy").cloned().unwrap_or(Value::Null),
        "description": body.get("description").cloned().unwrap_or(Value::Null),
        "userId": body.get("userId").cloned().unwrap_or(Value::Null),
        "teamId": body.get("teamId").cloned().unwrap_or(Value::Null),
        "partnerId": body.get("partnerId").cloned().unwrap_or(Value::Null),
        "dateDeadline": body.get("dateDeadline").cloned().unwrap_or(Value::Null),
        "metadata": body.get("metadata").cloned().unwrap_or(Value::Null),
    }))
}

pub(super) async fn leads_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let params = lead_create_params(&body)?;
    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer(stdb_client::reducer_call!(
            "create_lead",
            json!([org_id, params])
        ))
        .await
        .map_err(ApiError::internal)?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "data": { "message": "Lead created successfully" } })),
    ))
}

pub(super) async fn lead_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let lead_id: u64 = id
        .parse()
        .map_err(|_| ApiError::BadRequest("Invalid lead ID".into()))?;
    let client = state.stdb.clone();
    let lead = query_lead_by_id(&client, lead_id, org_id, session.field_access.as_ref())
        .await?
        .ok_or_else(|| ApiError::NotFound("Lead not found".into()))?;
    Ok(Json(json!({ "data": lead })))
}

pub(super) fn copy_patch_field(
    out: &mut serde_json::Map<String, Value>,
    body: &serde_json::Map<String, Value>,
    camel_key: &str,
    snake_key: &str,
) {
    if let Some(v) = body.get(camel_key) {
        out.insert(snake_key.to_string(), v.clone());
    }
}

pub(super) async fn lead_put(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let lead_id: u64 = id
        .parse()
        .map_err(|_| ApiError::BadRequest("Invalid lead ID".into()))?;
    let b = body
        .as_object()
        .ok_or_else(|| ApiError::BadRequest("Invalid body".into()))?;

    let mut params = serde_json::Map::new();
    copy_patch_field(&mut params, b, "contactName", "contact_name");
    copy_patch_field(&mut params, b, "title", "title");
    copy_patch_field(&mut params, b, "website", "website");
    copy_patch_field(&mut params, b, "industry", "industry");
    copy_patch_field(&mut params, b, "referredBy", "referred_by");
    copy_patch_field(&mut params, b, "description", "description");
    copy_patch_field(&mut params, b, "street", "street");
    copy_patch_field(&mut params, b, "city", "city");
    copy_patch_field(&mut params, b, "zip", "zip");
    copy_patch_field(&mut params, b, "countryCode", "country_code");
    copy_patch_field(&mut params, b, "expectedRevenue", "expected_revenue");
    copy_patch_field(&mut params, b, "probability", "probability");

    if params.is_empty() {
        return Err(ApiError::BadRequest("No valid fields to update".into()));
    }

    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer(stdb_client::reducer_call!(
            "update_lead",
            json!([org_id, lead_id, Value::Object(params)]),
        ))
        .await
        .map_err(ApiError::internal)?;

    Ok(Json(
        json!({ "data": { "message": "Lead updated successfully" } }),
    ))
}

pub(super) async fn lead_delete(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let lead_id: u64 = id
        .parse()
        .map_err(|_| ApiError::BadRequest("Invalid lead ID".into()))?;
    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer(stdb_client::reducer_call!(
            "delete_lead",
            json!([org_id, lead_id])
        ))
        .await
        .map_err(ApiError::internal)?;
    Ok(Json(
        json!({ "data": { "message": "Lead deleted successfully" } }),
    ))
}
