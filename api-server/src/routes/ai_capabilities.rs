//! Session-derived role grants for generated AI capabilities.

use std::{collections::BTreeMap, sync::Arc};

use axum::{
    body::Body,
    extract::{Query, State},
    http::{header::AUTHORIZATION, header::CACHE_CONTROL, HeaderMap, HeaderValue, Request},
    middleware::{self, Next},
    response::Response,
    routing::get,
    Json, Router,
};
use serde::Serialize;
use serde_json::{json, Value};
use stdb_auth::identity_sql_literal;

use crate::{
    error::ApiError, query_exec::resolve_membership_company_id, session::resolve_api_session,
    state::AppState, trusted_context::TrustedOperationContext, web_session::stdb_identity_hex_hint,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CapabilityGrant {
    pub(crate) capability_key: String,
    pub(crate) max_rows: u64,
    pub(crate) max_bytes: u64,
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/ai/capability-grants", get(get_capability_grants))
        .route_layer(middleware::from_fn(no_store))
}

async fn no_store(request: Request<Body>, next: Next) -> Response {
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

#[derive(Debug, Default, serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CapabilityGrantQuery {
    company_id: Option<u64>,
}

async fn get_capability_grants(
    State(state): State<Arc<AppState>>,
    Query(query): Query<CapabilityGrantQuery>,
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

    let effective = resolve_effective_capability_grants(
        &state,
        context.organization_id(),
        context.actor_identity(),
        chrono::Utc::now().timestamp_micros(),
    )
    .await?;
    let authority = if let Some(requested_company_id) = query.company_id {
        let company_id = resolve_membership_company_id(
            &state.stdb,
            context.organization_id(),
            context.actor_identity(),
            Some(requested_company_id),
            "Capability grant company scope mismatch",
        )
        .await?;
        let team_refs = resolve_knowledge_team_refs(
            &state,
            context.organization_id(),
            company_id,
            context.actor_identity(),
        )
        .await?;
        Some((
            context.organization_id(),
            company_id,
            context.actor_identity(),
            team_refs,
        ))
    } else {
        None
    };
    Ok(Json(capability_response(effective, authority)))
}

fn capability_response(
    grants: Vec<CapabilityGrant>,
    authority: Option<(u64, u64, &str, Vec<String>)>,
) -> Value {
    match authority {
        Some((organization_id, company_id, actor_identity, team_refs)) => json!({
            "organizationId": organization_id,
            "companyId": company_id,
            "actorIdentity": actor_identity,
            "knowledgeTeamRefs": team_refs,
            "grants": grants,
        }),
        // Preserve the established generated-read contract for callers that
        // do not request the AIH-16 company-bound authorization envelope.
        None => json!({ "grants": grants }),
    }
}

/// Resolve knowledge teams from the actor's one canonical active membership.
/// A department is the only supported team namespace; ambiguous membership or
/// a company mismatch produces no team authority.
async fn resolve_knowledge_team_refs(
    state: &AppState,
    organization_id: u64,
    company_id: u64,
    actor_identity: &str,
) -> Result<Vec<String>, ApiError> {
    let identity = identity_sql_literal(actor_identity).map_err(ApiError::Internal)?;
    let memberships = state
        .stdb
        .query_sql(&format!(
            "SELECT company_id, department_id FROM user_organization \
             WHERE organization_id = {organization_id} \
             AND user_identity = {identity} AND is_active = true"
        ))
        .await
        .map_err(ApiError::internal)?;
    let [membership] = memberships.as_slice() else {
        return Ok(Vec::new());
    };
    let membership_company = row_u64(membership, "companyId", "company_id");
    if membership_company.is_some_and(|value| value != company_id) {
        return Ok(Vec::new());
    }
    Ok(row_u64(membership, "departmentId", "department_id")
        .filter(|value| *value > 0)
        .map(|department_id| vec![format!("department:{department_id}")])
        .unwrap_or_default())
}

/// Resolve the actor's current capability grants from canonical membership,
/// active roles and unexpired extra assignments. Empty or malformed authority
/// remains an empty grant set.
pub(crate) async fn resolve_effective_capability_grants(
    state: &AppState,
    organization_id: u64,
    actor_identity: &str,
    now_micros: i64,
) -> Result<Vec<CapabilityGrant>, ApiError> {
    let identity = identity_sql_literal(actor_identity).map_err(ApiError::Internal)?;
    let memberships = state
        .stdb
        .query_sql(&format!(
            "SELECT role_id FROM user_organization \
             WHERE organization_id = {organization_id} \
             AND user_identity = {identity} AND is_active = true"
        ))
        .await
        .map_err(ApiError::internal)?;
    let assignments = state
        .stdb
        .query_sql(&format!(
            "SELECT role_id, expires_at FROM user_role_assignment \
             WHERE organization_id = {organization_id} \
             AND user_identity = {identity} AND is_active = true"
        ))
        .await
        .map_err(ApiError::internal)?;
    let roles = state
        .stdb
        .query_sql(&format!(
            "SELECT id FROM role WHERE organization_id = {organization_id} AND is_active = true"
        ))
        .await
        .map_err(ApiError::internal)?;
    let role_ids = current_role_ids(&memberships, &assignments, &roles, now_micros);
    if role_ids.is_empty() {
        return Ok(Vec::new());
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
    Ok(effective)
}

fn current_role_ids(
    memberships: &[Value],
    assignments: &[Value],
    active_roles: &[Value],
    now_micros: i64,
) -> Vec<u64> {
    // More than one active membership row is ambiguous authority and denies.
    let [membership] = memberships else {
        return Vec::new();
    };
    let active = active_roles
        .iter()
        .filter_map(|row| row_u64(row, "id", "id"))
        .collect::<Vec<_>>();
    let mut role_ids = row_u64(membership, "roleId", "role_id")
        .filter(|role_id| active.contains(role_id))
        .into_iter()
        .collect::<Vec<_>>();
    role_ids.extend(assignments.iter().filter_map(|row| {
        let role_id = row_u64(row, "roleId", "role_id")?;
        (active.contains(&role_id) && assignment_is_current(row, now_micros)).then_some(role_id)
    }));
    role_ids.sort_unstable();
    role_ids.dedup();
    role_ids
}

fn assignment_is_current(row: &Value, now_micros: i64) -> bool {
    match row.get("expiresAt").or_else(|| row.get("expires_at")) {
        None | Some(Value::Null) => true,
        Some(value) => timestamp_micros(value).is_some_and(|expires| expires > now_micros),
    }
}

fn timestamp_micros(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|value| i64::try_from(value).ok()))
        .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
        .or_else(|| {
            value
                .get("__timestamp_micros_since_unix_epoch__")
                .and_then(timestamp_micros)
        })
        .or_else(|| value.get("microsSinceUnixEpoch").and_then(timestamp_micros))
        .or_else(|| value.get("some").and_then(timestamp_micros))
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

    #[test]
    fn current_roles_include_base_and_unexpired_active_assignments_only() {
        let memberships = vec![json!({"roleId": 1})];
        let assignments = vec![
            json!({"roleId": 2, "expiresAt": null}),
            json!({"roleId": 3, "expiresAt": {"__timestamp_micros_since_unix_epoch__": 101}}),
            json!({"roleId": 4, "expiresAt": {"__timestamp_micros_since_unix_epoch__": 99}}),
            json!({"roleId": 5, "expiresAt": "malformed"}),
        ];
        let active_roles = vec![
            json!({"id": 1}),
            json!({"id": 2}),
            json!({"id": 3}),
            json!({"id": 4}),
        ];
        assert_eq!(
            current_role_ids(&memberships, &assignments, &active_roles, 100),
            vec![1, 2, 3]
        );
    }

    #[test]
    fn inactive_base_role_and_ambiguous_membership_fail_closed() {
        let membership = json!({"roleId": 1});
        assert!(current_role_ids(
            std::slice::from_ref(&membership),
            &[],
            &[json!({"id": 2})],
            100
        )
        .is_empty());
        assert!(current_role_ids(
            &[membership.clone(), membership],
            &[],
            &[json!({"id": 1})],
            100
        )
        .is_empty());
    }

    #[test]
    fn legacy_grant_envelope_stays_grants_only() {
        let grant = CapabilityGrant {
            capability_key: "example".into(),
            max_rows: 1,
            max_bytes: 2,
        };
        assert_eq!(
            capability_response(vec![grant], None),
            json!({"grants": [{"capabilityKey": "example", "maxRows": 1, "maxBytes": 2}]})
        );
        let bound = capability_response(
            Vec::new(),
            Some((7, 9, "actor", vec!["department:42".into()])),
        );
        assert_eq!(bound["organizationId"], 7);
        assert_eq!(bound["companyId"], 9);
        assert_eq!(bound["actorIdentity"], "actor");
        assert_eq!(bound["knowledgeTeamRefs"], json!(["department:42"]));
    }
}
