//! `/v1/messaging/*` — operational message templates, single messages, and batches.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post, put},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tower_cookies::Cookies;

use crate::error::ApiError;
use crate::query_exec::execute_resource_query;
use crate::state::AppState;
use crate::web_session::{require_org, resolve_session};

fn to_unit_enum(value: &Value) -> Result<Value, ApiError> {
    match value {
        Value::String(s) => Ok(json!({ s: [] })),
        _ => Err(ApiError::BadRequest("expected enum variant string".into())),
    }
}

fn paginate_limit_offset(limit: Option<u64>, offset: Option<u64>) -> (usize, usize) {
    let limit = limit.unwrap_or(50).min(100).max(1) as usize;
    let offset = offset.unwrap_or(0) as usize;
    (limit, offset)
}

#[derive(Debug, Deserialize)]
struct ListQuery {
    #[serde(default)]
    limit: Option<u64>,
    #[serde(default)]
    offset: Option<u64>,
}

fn list_meta(total: usize, offset: usize, limit: usize) -> Value {
    json!({
        "total": total,
        "page": (offset / limit).saturating_add(1),
        "limit": limit,
    })
}

async fn list_resource(
    state: &AppState,
    stdb_token: &str,
    identity_hex: &str,
    field_access: Option<&stdb_auth::FieldAccessContext>,
    org_id: u64,
    resource: &str,
    limit: usize,
    offset: usize,
) -> Result<Value, ApiError> {
    let client = state.client_with_token(stdb_token);
    let rows =
        execute_resource_query(&client, resource, org_id, identity_hex, field_access).await?;
    let total = rows.len();
    let data: Vec<Value> = rows.into_iter().skip(offset).take(limit).collect();
    Ok(json!({ "data": data, "meta": list_meta(total, offset, limit) }))
}

fn message_template_create_params(body: &Value) -> Result<Value, ApiError> {
    let key = body
        .get("key")
        .ok_or_else(|| ApiError::BadRequest("missing key".into()))?
        .clone();
    let name = body
        .get("name")
        .ok_or_else(|| ApiError::BadRequest("missing name".into()))?
        .clone();
    let body_template = body
        .get("body_template")
        .ok_or_else(|| ApiError::BadRequest("missing body_template".into()))?
        .clone();
    let applicable_channels = body
        .get("applicable_channels")
        .and_then(|v| v.as_array())
        .ok_or_else(|| ApiError::BadRequest("missing applicable_channels".into()))?;
    let channels: Result<Vec<Value>, _> = applicable_channels.iter().map(to_unit_enum).collect();
    Ok(json!({
        "company_id": body.get("company_id").cloned().unwrap_or(Value::Null),
        "key": key,
        "name": name,
        "locale": body.get("locale").cloned().unwrap_or(json!("en")),
        "subject": body.get("subject").cloned().unwrap_or(Value::Null),
        "body_template": body_template,
        "allowed_variables": body.get("allowed_variables").cloned().unwrap_or(json!([])),
        "applicable_channels": channels?,
        "retention_classification": body.get("retention_classification").cloned().unwrap_or(json!("operational")),
        "metadata": body.get("metadata").cloned().unwrap_or(Value::Null),
    }))
}

async fn message_templates_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(q): Query<ListQuery>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let (limit, offset) = paginate_limit_offset(q.limit, q.offset);
    let data = list_resource(
        &state,
        &session.stdb_token,
        &session.identity_hex,
        session.field_access.as_ref(),
        org_id,
        "message-templates",
        limit,
        offset,
    )
    .await?;
    Ok(Json(data))
}

async fn message_templates_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let params = message_template_create_params(&body)?;
    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer(stdb_client::reducer_call!(
            "create_message_template",
            json!([org_id, params])
        ))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "data": { "message": "Message template created successfully" } })),
    ))
}

async fn message_template_put(
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
    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer(stdb_client::reducer_call!(
            "update_message_template",
            json!([org_id, id, body])
        ))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(
        json!({ "data": { "message": "Message template updated successfully" } }),
    ))
}

fn operational_message_create_params(body: &Value) -> Result<Value, ApiError> {
    let channel = body
        .get("channel")
        .ok_or_else(|| ApiError::BadRequest("missing channel".into()))?;
    let status = body
        .get("status")
        .ok_or_else(|| ApiError::BadRequest("missing status".into()))?;
    let variables = body.get("variables").cloned().unwrap_or(json!([]));
    Ok(json!({
        "company_id": body.get("company_id").cloned().unwrap_or(Value::Null),
        "template_id": body.get("template_id").cloned().unwrap_or(json!(0)),
        "contact_id": body.get("contact_id").cloned().unwrap_or(json!(0)),
        "phone_identity_id": body.get("phone_identity_id").cloned().unwrap_or(json!(0)),
        "channel": to_unit_enum(channel)?,
        "subject_model": body.get("subject_model").cloned().unwrap_or(json!("")),
        "subject_id": body.get("subject_id").cloned().unwrap_or(json!(0)),
        "rendered_subject": body.get("rendered_subject").cloned().unwrap_or(Value::Null),
        "rendered_body": body.get("rendered_body").cloned().unwrap_or(json!("")),
        "variables": variables,
        "status": to_unit_enum(status)?,
        "metadata": body.get("metadata").cloned().unwrap_or(Value::Null),
    }))
}

async fn operational_messages_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(q): Query<ListQuery>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let (limit, offset) = paginate_limit_offset(q.limit, q.offset);
    let data = list_resource(
        &state,
        &session.stdb_token,
        &session.identity_hex,
        session.field_access.as_ref(),
        org_id,
        "operational-messages",
        limit,
        offset,
    )
    .await?;
    Ok(Json(data))
}

async fn operational_messages_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let params = operational_message_create_params(&body)?;
    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer(stdb_client::reducer_call!(
            "create_operational_message",
            json!([org_id, params])
        ))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "data": { "message": "Operational message created successfully" } })),
    ))
}

async fn operational_message_copied(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(id): Path<u64>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer(stdb_client::reducer_call!(
            "record_message_copied",
            json!([org_id, id])
        ))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(
        json!({ "data": { "message": "Message copy recorded successfully" } }),
    ))
}

async fn message_batches_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(q): Query<ListQuery>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let (limit, offset) = paginate_limit_offset(q.limit, q.offset);
    let data = list_resource(
        &state,
        &session.stdb_token,
        &session.identity_hex,
        session.field_access.as_ref(),
        org_id,
        "message-batches",
        limit,
        offset,
    )
    .await?;
    Ok(Json(data))
}

async fn message_batches_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let channel = body
        .get("channel")
        .ok_or_else(|| ApiError::BadRequest("missing channel".into()))?;
    let params = json!({
        "company_id": body.get("company_id").cloned().unwrap_or(Value::Null),
        "template_id": body.get("template_id").cloned().unwrap_or(json!(0)),
        "channel": to_unit_enum(channel)?,
        "subject_model": body.get("subject_model").cloned().unwrap_or(json!("")),
        "subject_query": body.get("subject_query").cloned().unwrap_or(Value::Null),
        "candidate_contact_ids": body.get("candidate_contact_ids").cloned().unwrap_or(json!([])),
        "metadata": body.get("metadata").cloned().unwrap_or(Value::Null),
    });
    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer(stdb_client::reducer_call!(
            "create_message_batch",
            json!([org_id, params])
        ))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "data": { "message": "Message batch created successfully" } })),
    ))
}

async fn message_batch_review(
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
    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer(stdb_client::reducer_call!(
            "review_message_batch",
            json!([org_id, id, body])
        ))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(
        json!({ "data": { "message": "Message batch reviewed successfully" } }),
    ))
}

async fn message_batch_cancel(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(id): Path<u64>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer(stdb_client::reducer_call!(
            "cancel_message_batch",
            json!([org_id, id])
        ))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(
        json!({ "data": { "message": "Message batch cancelled successfully" } }),
    ))
}

async fn contact_preferences_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(q): Query<ListQuery>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let (limit, offset) = paginate_limit_offset(q.limit, q.offset);
    let data = list_resource(
        &state,
        &session.stdb_token,
        &session.identity_hex,
        session.field_access.as_ref(),
        org_id,
        "contact-communication-preferences",
        limit,
        offset,
    )
    .await?;
    Ok(Json(data))
}

async fn contact_preferences_put(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(contact_id): Path<u64>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let channel = body
        .get("channel")
        .ok_or_else(|| ApiError::BadRequest("missing channel".into()))?;
    let opted_in = body
        .get("opted_in")
        .and_then(|v| v.as_bool())
        .ok_or_else(|| ApiError::BadRequest("missing opted_in".into()))?;
    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer(stdb_client::reducer_call!(
            "set_contact_communication_preference",
            json!([
                org_id,
                body.get("company_id").cloned().unwrap_or(Value::Null),
                contact_id,
                to_unit_enum(channel)?,
                opted_in
            ]),
        ))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(
        json!({ "data": { "message": "Contact preference updated successfully" } }),
    ))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/messaging/templates",
            get(message_templates_get).post(message_templates_post),
        )
        .route("/messaging/templates/:id", put(message_template_put))
        .route(
            "/messaging/messages",
            get(operational_messages_get).post(operational_messages_post),
        )
        .route(
            "/messaging/messages/:id/copy",
            post(operational_message_copied),
        )
        .route(
            "/messaging/batches",
            get(message_batches_get).post(message_batches_post),
        )
        .route("/messaging/batches/:id/review", post(message_batch_review))
        .route("/messaging/batches/:id/cancel", post(message_batch_cancel))
        .route(
            "/messaging/contact-preferences",
            get(contact_preferences_get),
        )
        .route(
            "/messaging/contact-preferences/:contact_id",
            put(contact_preferences_put),
        )
}
