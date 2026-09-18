//! Session-derived role grants for generated AI capabilities.

use std::{collections::BTreeMap, sync::Arc};

use axum::{
    extract::State,
    http::{header::AUTHORIZATION, HeaderMap},
    routing::get,
    Json, Router,
};
use serde::Serialize;
use serde_json::{json, Value};
use stdb_auth::identity_sql_literal;

use crate::{
    error::ApiError, session::resolve_api_session, state::AppState,
    trusted_context::TrustedOperationContext, web_session::stdb_identity_hex_hint,
};

#[derive(Debug, Serialize)]
struct CapabilityGrant {
    capability_key: String,
    max_rows: u64,
    max_bytes: u64,
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/ai/capability-grants", get(get_capability_grants))
}

async fn get_capability_grants(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: tower_cookies::Cookies,
) -> Result<Json<Value>, ApiError> {
    let auth = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    let identity_hint = stdb_identity_hex_hint(&headers, &cookies);
    let cookie_token = cookies
        .get("stdb_token")
        .map(|cookie| cookie.value().to_string());
    let session = resolve_api_session(
        &state,
        auth,
        cookie_token.as_deref(),
        identity_hint.as_deref(),
    )
    .await?
    .ok_or(ApiError::Unauthorized)?;
    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    context.require_current_placement(&state.organization_placements)?;

    let identity = identity_sql_literal(context.actor_identity()).map_err(ApiError::Internal)?;
    let organization_id = context.organization_id();
    let assignments = state
        .stdb
        .query_sql(&format!(
            "SELECT role_id FROM user_role_assignment \
             WHERE organization_id = {organization_id} \
             AND user_identity = {identity} AND is_active = true"
        ))
        .await
        .map_err(ApiError::internal)?;
    let role_ids = assignments
        .iter()
        .filter_map(|row| row_u64(row, "roleId", "role_id"))
        .collect::<Vec<_>>();
    if role_ids.is_empty() {
        return Ok(Json(json!({ "grants": [] })));
    }

    let grants = state
        .stdb
        .query_sql(&format!(
            "SELECT role_id, capability_key, max_rows, max_bytes \
             FROM ai_capability_role_grant \
             WHERE organization_id = {organization_id} AND is_active = true"
        ))
        .await
        .map_err(ApiError::internal)?;
    let effective = effective_grants(&role_ids, &grants);
    Ok(Json(json!({ "grants": effective })))
}

/// Roles are additive. For the same capability, the actor receives the largest
/// row and byte bounds granted by any assigned role; the gateway still narrows
/// both against the reviewed global contract ceiling.
fn effective_grants(role_ids: &[u64], rows: &[Value]) -> Vec<CapabilityGrant> {
    let mut effective = BTreeMap::<String, (u64, u64)>::new();
    for row in rows {
        let Some(role_id) = row_u64(row, "roleId", "role_id") else {
            continue;
        };
        if !role_ids.contains(&role_id) {
            continue;
        }
        let Some(capability_key) = row
            .get("capabilityKey")
            .or_else(|| row.get("capability_key"))
            .and_then(Value::as_str)
            .filter(|key| !key.trim().is_empty())
        else {
            continue;
        };
        let Some(max_rows) = row_u64(row, "maxRows", "max_rows").filter(|value| *value > 0) else {
            continue;
        };
        let Some(max_bytes) = row_u64(row, "maxBytes", "max_bytes").filter(|value| *value > 0)
        else {
            continue;
        };
        let bounds = effective
            .entry(capability_key.to_string())
            .or_insert((0, 0));
        bounds.0 = bounds.0.max(max_rows);
        bounds.1 = bounds.1.max(max_bytes);
    }
    effective
        .into_iter()
        .map(|(capability_key, (max_rows, max_bytes))| CapabilityGrant {
            capability_key,
            max_rows,
            max_bytes,
        })
        .collect()
}

fn row_u64(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    row.get(camel).or_else(|| row.get(snake)).and_then(|value| {
        value
            .as_u64()
            .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grants_are_role_scoped_additive_and_sorted() {
        let rows = vec![
            json!({"roleId": 2, "capabilityKey": "b", "maxRows": 5, "maxBytes": 50}),
            json!({"roleId": 1, "capabilityKey": "a", "maxRows": 10, "maxBytes": 100}),
            json!({"roleId": 2, "capabilityKey": "a", "maxRows": 20, "maxBytes": 80}),
            json!({"roleId": 3, "capabilityKey": "a", "maxRows": 99, "maxBytes": 999}),
        ];
        let grants = effective_grants(&[1, 2], &rows);
        assert_eq!(grants.len(), 2);
        assert_eq!(grants[0].capability_key, "a");
        assert_eq!(grants[0].max_rows, 20);
        assert_eq!(grants[0].max_bytes, 100);
        assert_eq!(grants[1].capability_key, "b");
    }

    #[test]
    fn malformed_and_unassigned_rows_do_not_grant_access() {
        let rows = vec![
            json!({"roleId": 2, "capabilityKey": "a", "maxRows": 1, "maxBytes": 1}),
            json!({"roleId": 1, "capabilityKey": "", "maxRows": 1, "maxBytes": 1}),
            json!({"roleId": 1, "capabilityKey": "a", "maxRows": 0, "maxBytes": 1}),
        ];
        assert!(effective_grants(&[1], &rows).is_empty());
    }
}
