use super::*;

use crate::query_exec::{execute_authorized_resource_search, AuthoritativeSearchQuery};

/// Resolve a record reference under the same actor, placement, and company
/// policy as the authoritative single-record read.
pub(crate) async fn get_authoritative_search(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: tower_cookies::Cookies,
    Path(resource): Path<String>,
    Query(query): Query<AuthoritativeSearchQuery>,
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
    let session_client = state.client_with_token(&session.stdb_token);
    let context = TrustedOperationContext::from_session_with_placement(
        &session,
        session_client,
        RESOURCE_QUERY_OPERATION_ID,
        &state.organization_placements,
    )?;
    let organization_id = context.organization_id();
    context.require_current_placement(&state.organization_placements)?;
    let owner_read = crate::query_exec::crm_resource(&resource);
    if owner_read {
        require_owner_read_permission(&resource, &context)?;
    }
    let company_id = resolve_crm_company_id(
        context.client(),
        organization_id,
        context.actor_identity(),
        Some(query.company_id),
    )
    .await?;
    let client = if owner_read {
        state.stdb.clone()
    } else {
        context.client().clone()
    };
    let context = context.with_company_scope(vec![company_id])?;
    context.require_company_scope(&[query.company_id])?;
    let result = execute_authorized_resource_search(
        &client,
        &resource,
        organization_id,
        &query,
        context.field_access(),
    )
    .await?;
    context.require_current_placement(&state.organization_placements)?;
    Ok(Json(json!(result)))
}
