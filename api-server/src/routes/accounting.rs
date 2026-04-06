//! `/v1/accounting/*` — parity with `frontend/web/app/api/accounting/*/route.ts`.

use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::HeaderMap,
    routing::get,
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
    Ok(Json(json!({ "data": page_rows, "meta": list_meta(total, offset, limit) })))
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

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/accounting/accounts", get(accounts_get).post(accounts_post))
}
