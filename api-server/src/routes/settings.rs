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

use crate::error::ApiError;
use crate::query_exec::execute_resource_query;
use crate::state::AppState;
use crate::trusted_context::TrustedOperationContext;
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

    let trusted = TrustedOperationContext::for_resource_read(&state, &session)?;
    let client = trusted.client();
    let access = session
        .field_access
        .as_ref()
        .ok_or(ApiError::Unauthorized)?;
    if !stdb_auth::permission_allowed(access, "user_organization", "read") {
        return Err(ApiError::Forbidden(
            "You cannot view organization users".into(),
        ));
    }
    let can_manage = stdb_auth::permission_allowed(access, "user_organization", "write")
        || stdb_auth::permission_allowed(access, "user_organization", "delete");
    let active_filter = if can_manage {
        ""
    } else {
        " AND is_active = true"
    };
    let actor =
        stdb_auth::identity_sql_literal(&session.identity_hex).map_err(ApiError::Internal)?;
    let scopes = client.query_sql(&format!("SELECT company_id FROM delegated_admin_scope WHERE organization_id = {org_id} AND user_identity = {actor} AND is_active = true"))
        .await.map_err(ApiError::internal)?;
    let company_filter = match scopes.as_slice() {
        [] => String::new(),
        [scope] => {
            let company = scope
                .get("companyId")
                .or_else(|| scope.get("company_id"))
                .and_then(|v| v.as_u64().or_else(|| v.as_str()?.parse().ok()))
                .filter(|id| *id > 0)
                .ok_or_else(|| ApiError::Forbidden("Invalid delegated company scope".into()))?;
            format!(" AND company_id = {company}")
        }
        _ => {
            return Err(ApiError::Forbidden(
                "Ambiguous delegated company scope".into(),
            ))
        }
    };
    let member_columns = stdb_auth::resolve_http_sql_columns("user-organization", Some(access))
        .map_err(ApiError::Internal)?
        .join(", ");
    let memberships = client.query_sql(&format!("SELECT {member_columns} FROM user_organization WHERE organization_id = {org_id}{active_filter}{company_filter}"))
        .await.map_err(ApiError::internal)?;
    let assignments = client.query_sql(&format!("SELECT id, user_identity, role_id, is_active, expires_at FROM user_role_assignment WHERE organization_id = {org_id}"))
        .await.map_err(ApiError::internal)?;
    let profile_columns = stdb_auth::resolve_http_sql_columns("user-profile", Some(access))
        .map_err(ApiError::Internal)?
        .join(", ");
    let profiles = state
        .stdb
        .query_sql(&format!(
            "SELECT {profile_columns} FROM user_profile WHERE organization_id = {org_id}"
        ))
        .await
        .map_err(ApiError::internal)?;
    let identity = |row: &Value, camel: &str, snake: &str| {
        row.get(camel)
            .or_else(|| row.get(snake))
            .and_then(Value::as_str)
            .map(crate::session::normalize_identity_hex_for_sql)
    };
    let mut users = Vec::new();
    for mut profile in profiles {
        let Some(id) = identity(&profile, "identity", "identity") else {
            continue;
        };
        let Some(membership) = memberships
            .iter()
            .find(|m| identity(m, "userIdentity", "user_identity").as_deref() == Some(&id))
        else {
            continue;
        };
        let role_assignments: Vec<_> = assignments
            .iter()
            .filter(|a| identity(a, "userIdentity", "user_identity").as_deref() == Some(&id))
            .cloned()
            .collect();
        if let Some(row) = profile.as_object_mut() {
            row.insert("membership".into(), membership.clone());
            row.insert("roleAssignments".into(), json!(role_assignments));
        }
        users.push(profile);
    }

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
    Ok(Json(
        json!({ "data": page_rows, "meta": list_meta(total, offset, limit) }),
    ))
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

    let trusted = TrustedOperationContext::for_resource_read(&state, &session)?;
    let client = trusted.client();
    let roles = execute_resource_query(
        &client,
        "roles",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;

    let total = roles.len();
    let page_rows: Vec<Value> = roles.into_iter().skip(offset).take(limit).collect();
    Ok(Json(
        json!({ "data": page_rows, "meta": list_meta(total, offset, limit) }),
    ))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/settings/users", get(users_get))
        .route("/settings/roles", get(roles_get))
}
