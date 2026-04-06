//! `/v1/settings/*` — parity with `frontend/web/app/api/settings/*/route.ts`.

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

use crate::domain_queries::query_org_users;
use crate::error::ApiError;
use crate::query_exec::execute_resource_query;
use crate::state::AppState;
use crate::web_session::{require_org, resolve_session};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsersListQuery {
    search: Option<String>,
    #[serde(default)]
    limit: Option<u64>,
    #[serde(default)]
    offset: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RolesListQuery {
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

async fn users_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(q): Query<UsersListQuery>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let (limit, offset) = paginate_limit_offset(q.limit, q.offset);

    let client = state.client_with_token(&session.stdb_token);
    let mut users = query_org_users(&client, org_id, session.field_access.as_ref()).await?;

    if let Some(ref search) = q.search {
        let term = search.to_lowercase();
        users.retain(|u| {
            let name = u
                .get("name")
                .or_else(|| u.get("username"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            let email = u
                .get("email")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            name.contains(&term) || email.contains(&term)
        });
    }

    let total = users.len();
    let page_rows: Vec<Value> = users.into_iter().skip(offset).take(limit).collect();
    Ok(Json(json!({ "data": page_rows, "meta": list_meta(total, offset, limit) })))
}

async fn roles_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(q): Query<RolesListQuery>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let (limit, offset) = paginate_limit_offset(q.limit, q.offset);

    let client = state.client_with_token(&session.stdb_token);
    let roles = execute_resource_query(
        &client,
        "roles",
        org_id, // ignored by roles SQL branch; required for session gate (org member)
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;

    let total = roles.len();
    let page_rows: Vec<Value> = roles.into_iter().skip(offset).take(limit).collect();
    Ok(Json(json!({ "data": page_rows, "meta": list_meta(total, offset, limit) })))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/settings/users", get(users_get))
        .route("/settings/roles", get(roles_get))
}
