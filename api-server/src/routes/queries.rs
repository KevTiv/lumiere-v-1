//! Authenticated query and authoritative-record handlers.

use crate::error::ApiError;
use crate::query_exec::{
    execute_authorized_resource_record, execute_resource_query_for_company, resolve_crm_company_id,
    resolve_sales_company_id,
};
use crate::session::resolve_api_session;
use crate::state::AppState;
use crate::web_session::stdb_identity_hex_hint;
use axum::{
    extract::{Path, Query, State},
    http::{header::AUTHORIZATION, HeaderMap},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

#[derive(Debug, Deserialize)]
pub(crate) struct OrgQuery {
    #[serde(rename = "organizationId")]
    organization_id: Option<u64>,
    #[serde(rename = "companyId")]
    company_id: Option<u64>,
    cursor: Option<String>,
    limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AuthoritativeQuery {
    #[serde(rename = "companyId")]
    company_id: u64,
}

pub(crate) async fn get_query(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: tower_cookies::Cookies,
    Path(resource): Path<String>,
    Query(q): Query<OrgQuery>,
) -> Result<Json<Value>, ApiError> {
    let auth = headers.get(AUTHORIZATION).and_then(|v| v.to_str().ok());
    let id_hint = stdb_identity_hex_hint(&headers, &cookies);
    let cookie_tok = cookies.get("stdb_token").map(|c| c.value().to_string());

    let session = resolve_api_session(&state, auth, cookie_tok.as_deref(), id_hint.as_deref())
        .await?
        .ok_or(ApiError::Unauthorized)?;

    let org_id = session
        .organization_id
        .ok_or_else(|| ApiError::Forbidden("No organization assigned".into()))?;
    if let Some(override_org) = q.organization_id {
        if override_org != org_id {
            return Err(ApiError::Forbidden(
                "Cannot query another organization's data".into(),
            ));
        }
    }

    // Private workflow tables are not readable with the user JWT; use the module
    // owner token and enforce identity/company filters in `workflow_reads`.
    let client = if crate::workflow_reads::is_private_workflow_resource(&resource)
        || crate::query_exec::crm_resource(&resource)
    {
        state.stdb.clone()
    } else {
        state.client_with_token(&session.stdb_token)
    };
    // "pos-orders" is cursor-paginated (hot+cold merge) and needs a response
    // envelope beyond the generic `{"data": [...]}` — special-cased here
    // rather than folded into `execute_resource_query_for_company`, whose
    // signature is shared by ~40 resources that don't need a cursor.
    if resource == "pos-orders" {
        let company_id =
            resolve_sales_company_id(&state.stdb, org_id, &session.identity_hex, q.company_id)
                .await?;
        let page = crate::cold_tier::pos_order_read::merged_page(
            &client,
            org_id,
            Some(company_id),
            q.cursor.clone(),
            q.limit,
        )
        .await?;
        return Ok(Json(
            json!({ "data": page.rows, "nextCursor": page.next_cursor }),
        ));
    }

    let data = execute_resource_query_for_company(
        &client,
        &resource,
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
        q.company_id,
    )
    .await?;

    Ok(Json(json!({ "data": data })))
}

pub(crate) async fn get_authoritative_resource(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: tower_cookies::Cookies,
    Path((resource, record_id)): Path<(String, u64)>,
    Query(query): Query<AuthoritativeQuery>,
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
    let organization_id = session
        .organization_id
        .ok_or_else(|| ApiError::Forbidden("No organization assigned".into()))?;

    // The requested company is only actor intent. Resolve it against the active
    // membership so a company-bound actor cannot pivot within the organization.
    let company_id = resolve_crm_company_id(
        &state.stdb,
        organization_id,
        &session.identity_hex,
        Some(query.company_id),
    )
    .await?;

    let client = if crate::query_exec::crm_resource(&resource) {
        state.stdb.clone()
    } else {
        state.client_with_token(&session.stdb_token)
    };
    let row = execute_authorized_resource_record(
        &client,
        &resource,
        organization_id,
        company_id,
        record_id,
        session.field_access.as_ref(),
    )
    .await?
    .ok_or_else(|| ApiError::NotFound("Authoritative resource not found".into()))?;

    Ok(Json(json!({ "data": row })))
}
