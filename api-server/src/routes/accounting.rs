//! `/v1/accounting/*` — parity with `frontend/web/app/api/accounting/*/route.ts`.

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountsListQuery {
    code: Option<String>,
    search: Option<String>,
    #[serde(default)]
    limit: Option<u64>,
    #[serde(default)]
    offset: Option<u64>,
}

fn paginate_limit_offset(limit: Option<u64>, offset: Option<u64>) -> (usize, usize) {
    let limit = limit.unwrap_or(50).min(100).max(1) as usize;
    let offset = offset.unwrap_or(0) as usize;
    (limit, offset)
}

fn list_meta(total: usize, offset: usize, limit: usize) -> Value {
    json!({
        "total": total,
        "page": (offset / limit).saturating_add(1),
        "limit": limit,
    })
}

async fn accounts_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(q): Query<AccountsListQuery>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let (limit, offset) = paginate_limit_offset(q.limit, q.offset);

    let client = state.client_with_token(&session.stdb_token);
    let mut rows = execute_resource_query(
        &client,
        "account-accounts",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;

    rows.sort_by(|a, b| {
        let ca = a
            .get("code")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase();
        let cb = b
            .get("code")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase();
        ca.cmp(&cb)
    });

    if let Some(ref prefix) = q.code {
        rows.retain(|r| {
            r.get("code")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .starts_with(prefix)
        });
    }
    if let Some(ref term) = q.search {
        let t = term.to_lowercase();
        rows.retain(|r| {
            let code = r
                .get("code")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            let name = r
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            code.contains(&t) || name.contains(&t)
        });
    }

    let total = rows.len();
    let page_rows: Vec<Value> = rows.into_iter().skip(offset).take(limit).collect();
    Ok(Json(
        json!({ "data": page_rows, "meta": list_meta(total, offset, limit) }),
    ))
}

async fn accounts_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;

    body.get("name")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ApiError::BadRequest("Name is required".into()))?;

    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer("create_account_account", json!([org_id, body]))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "data": { "message": "Account created successfully" } })),
    ))
}

fn to_unit_enum(value: &Value) -> Result<Value, ApiError> {
    match value {
        Value::String(s) => Ok(json!({ s: [] })),
        _ => Err(ApiError::BadRequest("expected enum variant string".into())),
    }
}

#[derive(Debug, Deserialize)]
struct PaymentListQuery {
    #[serde(default)]
    limit: Option<u64>,
    #[serde(default)]
    offset: Option<u64>,
}

fn payment_account_create_params(body: &Value) -> Result<Value, ApiError> {
    let company_id = body
        .get("company_id")
        .ok_or_else(|| ApiError::BadRequest("missing company_id".into()))?
        .clone();
    let provider_code = body
        .get("provider_code")
        .ok_or_else(|| ApiError::BadRequest("missing provider_code".into()))?;
    let name = body
        .get("name")
        .ok_or_else(|| ApiError::BadRequest("missing name".into()))?
        .clone();
    let reference_raw = body.get("reference_raw").cloned().unwrap_or(Value::Null);
    let currency_id = body
        .get("currency_id")
        .ok_or_else(|| ApiError::BadRequest("missing currency_id".into()))?
        .clone();
    let account_journal_id = body
        .get("account_journal_id")
        .ok_or_else(|| ApiError::BadRequest("missing account_journal_id".into()))?
        .clone();
    Ok(json!({
        "company_id": company_id,
        "provider_code": to_unit_enum(provider_code)?,
        "name": name,
        "provider_label": body.get("provider_label").cloned().unwrap_or(Value::Null),
        "reference_raw": reference_raw,
        "currency_id": currency_id,
        "account_journal_id": account_journal_id,
        "fee_account_id": body.get("fee_account_id").cloned().unwrap_or(Value::Null),
        "clearing_account_id": body.get("clearing_account_id").cloned().unwrap_or(Value::Null),
        "is_primary": body.get("is_primary").cloned().unwrap_or(json!(false)),
        "metadata": body.get("metadata").cloned().unwrap_or(Value::Null),
    }))
}

async fn payment_accounts_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(q): Query<PaymentListQuery>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let (limit, offset) = paginate_limit_offset(q.limit, q.offset);

    let client = state.client_with_token(&session.stdb_token);
    let rows = execute_resource_query(
        &client,
        "payment-accounts",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;

    let total = rows.len();
    let data: Vec<Value> = rows.into_iter().skip(offset).take(limit).collect();
    Ok(Json(json!({ "data": data, "meta": list_meta(total, offset, limit) })))
}

async fn payment_accounts_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let params = payment_account_create_params(&body)?;
    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer("create_payment_account", json!([org_id, params]))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "data": { "message": "Payment account created successfully" } })),
    ))
}

async fn payment_account_put(
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
        .call_reducer("update_payment_account", json!([org_id, id, body]))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(json!({ "data": { "message": "Payment account updated successfully" } })))
}

async fn payment_account_archive(
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
        .call_reducer("archive_payment_account", json!([org_id, id]))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(json!({ "data": { "message": "Payment account archived successfully" } })))
}

fn payment_transaction_create_params(body: &Value) -> Result<Value, ApiError> {
    let company_id = body
        .get("company_id")
        .ok_or_else(|| ApiError::BadRequest("missing company_id".into()))?
        .clone();
    let payment_account_id = body
        .get("payment_account_id")
        .ok_or_else(|| ApiError::BadRequest("missing payment_account_id".into()))?
        .clone();
    let direction = body
        .get("direction")
        .ok_or_else(|| ApiError::BadRequest("missing direction".into()))?;
    let partner_type = body
        .get("partner_type")
        .ok_or_else(|| ApiError::BadRequest("missing partner_type".into()))?;
    let partner_id = body
        .get("partner_id")
        .ok_or_else(|| ApiError::BadRequest("missing partner_id".into()))?
        .clone();
    Ok(json!({
        "company_id": company_id,
        "payment_account_id": payment_account_id,
        "direction": to_unit_enum(direction)?,
        "partner_type": to_unit_enum(partner_type)?,
        "partner_id": partner_id,
        "external_reference": body.get("external_reference").cloned().unwrap_or(Value::Null),
        "gross_external_amount": body.get("gross_external_amount").cloned().unwrap_or(json!(0.0)),
        "settlement_amount": body.get("settlement_amount").cloned().unwrap_or(json!(0.0)),
        "net_account_amount": body.get("net_account_amount").cloned().unwrap_or(json!(0.0)),
        "currency_id": body.get("currency_id").cloned().unwrap_or(json!(0)),
        "occurred_at": body.get("occurred_at").cloned().unwrap_or(Value::Null),
        "source_entity": body.get("source_entity").cloned().unwrap_or(Value::Null),
        "source_entity_id": body.get("source_entity_id").cloned().unwrap_or(Value::Null),
        "evidence_document_ids": body.get("evidence_document_ids").cloned().unwrap_or(json!([])),
        "metadata": body.get("metadata").cloned().unwrap_or(Value::Null),
    }))
}

async fn payment_transactions_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(q): Query<PaymentListQuery>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let (limit, offset) = paginate_limit_offset(q.limit, q.offset);

    let client = state.client_with_token(&session.stdb_token);
    let rows = execute_resource_query(
        &client,
        "payment-transactions",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;

    let total = rows.len();
    let data: Vec<Value> = rows.into_iter().skip(offset).take(limit).collect();
    Ok(Json(json!({ "data": data, "meta": list_meta(total, offset, limit) })))
}

async fn payment_transactions_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let params = payment_transaction_create_params(&body)?;
    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer("create_payment_transaction", json!([org_id, params]))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "data": { "message": "Payment transaction created successfully" } })),
    ))
}

async fn payment_transaction_put(
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
        .call_reducer("update_payment_transaction", json!([org_id, id, body]))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(json!({ "data": { "message": "Payment transaction updated successfully" } })))
}

async fn payment_transaction_post(
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
        .call_reducer("post_payment_transaction", json!([org_id, id]))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(json!({ "data": { "message": "Payment transaction posted successfully" } })))
}

async fn payment_transaction_void(
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
        .call_reducer("void_payment_transaction", json!([org_id, id]))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(json!({ "data": { "message": "Payment transaction voided successfully" } })))
}

fn payment_fee_create_params(body: &Value) -> Result<Value, ApiError> {
    let bearer = body
        .get("bearer")
        .ok_or_else(|| ApiError::BadRequest("missing bearer".into()))?;
    Ok(json!({
        "company_id": body.get("company_id").cloned().unwrap_or(json!(0)),
        "payment_transaction_id": body.get("payment_transaction_id").cloned().unwrap_or(json!(0)),
        "bearer": to_unit_enum(bearer)?,
        "amount": body.get("amount").cloned().unwrap_or(json!(0.0)),
        "currency_id": body.get("currency_id").cloned().unwrap_or(json!(0)),
        "fee_account_id": body.get("fee_account_id").cloned().unwrap_or(Value::Null),
        "tax_account_id": body.get("tax_account_id").cloned().unwrap_or(Value::Null),
        "tax_amount": body.get("tax_amount").cloned().unwrap_or(json!(0.0)),
        "provider_reference": body.get("provider_reference").cloned().unwrap_or(Value::Null),
        "metadata": body.get("metadata").cloned().unwrap_or(Value::Null),
    }))
}

async fn payment_transaction_fee_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(_id): Path<u64>,
    Json(body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let params = payment_fee_create_params(&body)?;
    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer("create_payment_fee", json!([org_id, params]))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "data": { "message": "Payment fee added successfully" } })),
    ))
}

async fn payment_transaction_allocate_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(_id): Path<u64>,
    Json(body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer("allocate_payment_transaction", json!([org_id, body]))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "data": { "message": "Payment allocated successfully" } })),
    ))
}

async fn payment_transaction_reverse_post(
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
        .call_reducer("reverse_payment_transaction", json!([org_id, id, body]))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(json!({ "data": { "message": "Payment transaction reversed successfully" } })))
}

async fn payment_reconciliations_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(q): Query<PaymentListQuery>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let (limit, offset) = paginate_limit_offset(q.limit, q.offset);

    let client = state.client_with_token(&session.stdb_token);
    let rows = execute_resource_query(
        &client,
        "payment-reconciliations",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;

    let total = rows.len();
    let data: Vec<Value> = rows.into_iter().skip(offset).take(limit).collect();
    Ok(Json(json!({ "data": data, "meta": list_meta(total, offset, limit) })))
}

async fn payment_reversals_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(q): Query<PaymentListQuery>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let (limit, offset) = paginate_limit_offset(q.limit, q.offset);

    let client = state.client_with_token(&session.stdb_token);
    let rows = execute_resource_query(
        &client,
        "payment-reversals",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;

    let total = rows.len();
    let data: Vec<Value> = rows.into_iter().skip(offset).take(limit).collect();
    Ok(Json(json!({ "data": data, "meta": list_meta(total, offset, limit) })))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/accounting/accounts",
            get(accounts_get).post(accounts_post),
        )
        .route(
            "/accounting/payment-accounts",
            get(payment_accounts_get).post(payment_accounts_post),
        )
        .route(
            "/accounting/payment-accounts/:id",
            put(payment_account_put),
        )
        .route(
            "/accounting/payment-accounts/:id/archive",
            post(payment_account_archive),
        )
        .route(
            "/accounting/payment-transactions",
            get(payment_transactions_get).post(payment_transactions_post),
        )
        .route(
            "/accounting/payment-transactions/:id",
            put(payment_transaction_put),
        )
        .route(
            "/accounting/payment-transactions/:id/post",
            post(payment_transaction_post),
        )
        .route(
            "/accounting/payment-transactions/:id/void",
            post(payment_transaction_void),
        )
        .route(
            "/accounting/payment-transactions/:id/fees",
            post(payment_transaction_fee_post),
        )
        .route(
            "/accounting/payment-transactions/:id/allocate",
            post(payment_transaction_allocate_post),
        )
        .route(
            "/accounting/payment-transactions/:id/reverse",
            post(payment_transaction_reverse_post),
        )
        .route(
            "/accounting/payment-reconciliations",
            get(payment_reconciliations_get),
        )
        .route(
            "/accounting/payment-reversals",
            get(payment_reversals_get),
        )
}
