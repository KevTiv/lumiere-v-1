//! `/v1/crm/*` — parity with `frontend/web/app/api/crm/*/route.ts`.

use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::HeaderMap,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tower_cookies::Cookies;

use crate::error::ApiError;
use crate::query_exec::execute_resource_query;
use crate::state::AppState;
use crate::web_session::{require_org, resolve_session};

use super::{list_meta, paginate_limit_offset, value_as_str, value_as_u64};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ContactsListQuery {
    #[serde(rename = "type")]
    type_: Option<String>,
    is_customer: Option<String>,
    is_vendor: Option<String>,
    is_prospect: Option<String>,
    search: Option<String>,
    #[serde(default)]
    limit: Option<u64>,
    #[serde(default)]
    offset: Option<u64>,
}

pub(super) fn contact_create_params(body: &Value) -> Result<Value, ApiError> {
    let name = body
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ApiError::BadRequest("Name is required".into()))?;
    Ok(json!({
        "name": name,
        "type": body.get("type").and_then(|v| v.as_str()).unwrap_or("person"),
        "email": body.get("email").cloned().unwrap_or(Value::Null),
        "phone": body.get("phone").cloned().unwrap_or(Value::Null),
        "mobile": body.get("mobile").cloned().unwrap_or(Value::Null),
        "companyId": body.get("companyId").cloned().unwrap_or(Value::Null),
        "isCustomer": body.get("isCustomer").and_then(|v| v.as_bool()).unwrap_or(false),
        "isVendor": body.get("isVendor").and_then(|v| v.as_bool()).unwrap_or(false),
        "isEmployee": body.get("isEmployee").and_then(|v| v.as_bool()).unwrap_or(false),
        "isProspect": body.get("isProspect").and_then(|v| v.as_bool()).unwrap_or(false),
        "isPartner": body.get("isPartner").and_then(|v| v.as_bool()).unwrap_or(false),
        "customerRank": body.get("customerRank").and_then(value_as_u64).unwrap_or(0),
        "supplierRank": body.get("supplierRank").and_then(value_as_u64).unwrap_or(0),
        "displayName": body.get("displayName").cloned().unwrap_or(Value::Null),
        "firstName": body.get("firstName").cloned().unwrap_or(Value::Null),
        "lastName": body.get("lastName").cloned().unwrap_or(Value::Null),
        "title": body.get("title").cloned().unwrap_or(Value::Null),
        "emailSecondary": body.get("emailSecondary").cloned().unwrap_or(Value::Null),
        "fax": body.get("fax").cloned().unwrap_or(Value::Null),
        "website": body.get("website").cloned().unwrap_or(Value::Null),
        "street": body.get("street").cloned().unwrap_or(Value::Null),
        "street2": body.get("street2").cloned().unwrap_or(Value::Null),
        "city": body.get("city").cloned().unwrap_or(Value::Null),
        "stateCode": body.get("stateCode").cloned().unwrap_or(Value::Null),
        "zip": body.get("zip").cloned().unwrap_or(Value::Null),
        "countryCode": body.get("countryCode").cloned().unwrap_or(Value::Null),
        "taxId": body.get("taxId").cloned().unwrap_or(Value::Null),
        "companyRegistry": body.get("companyRegistry").cloned().unwrap_or(Value::Null),
        "industry": body.get("industry").cloned().unwrap_or(Value::Null),
        "employeesCount": body.get("employeesCount").cloned().unwrap_or(Value::Null),
        "annualRevenue": body.get("annualRevenue").cloned().unwrap_or(Value::Null),
        "description": body.get("description").cloned().unwrap_or(Value::Null),
        "salespersonId": body.get("salespersonId").cloned().unwrap_or(Value::Null),
        "assignedUserId": body.get("assignedUserId").cloned().unwrap_or(Value::Null),
        "parentId": body.get("parentId").cloned().unwrap_or(Value::Null),
        "userId": body.get("userId").cloned().unwrap_or(Value::Null),
        "color": body.get("color").cloned().unwrap_or(Value::Null),
        "metadata": body.get("metadata").cloned().unwrap_or(Value::Null),
    }))
}

pub(super) async fn contacts_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(q): Query<ContactsListQuery>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let (limit, offset) = paginate_limit_offset(q.limit, q.offset);

    let client = state.stdb.clone();
    let mut rows = execute_resource_query(
        &client,
        "contacts",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;

    if let Some(ref t) = q.type_ {
        rows.retain(|r| value_as_str(r.get("type").unwrap_or(&Value::Null)) == Some(t.as_str()));
    }
    if let Some(ref s) = q.is_customer {
        let want = s == "true";
        rows.retain(|r| {
            r.get("isCustomer")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
                == want
        });
    }
    if let Some(ref s) = q.is_vendor {
        let want = s == "true";
        rows.retain(|r| r.get("isVendor").and_then(|v| v.as_bool()).unwrap_or(false) == want);
    }
    if let Some(ref s) = q.is_prospect {
        let want = s == "true";
        rows.retain(|r| {
            r.get("isProspect")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
                == want
        });
    }
    if let Some(ref search) = q.search {
        let term = search.to_lowercase();
        rows.retain(|r| {
            let name = r
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            let email = r
                .get("email")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            let display = r
                .get("displayName")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            name.contains(&term) || email.contains(&term) || display.contains(&term)
        });
    }

    let total = rows.len();
    let page_rows: Vec<Value> = rows.into_iter().skip(offset).take(limit).collect();
    Ok(Json(
        json!({ "data": page_rows, "meta": list_meta(total, offset, limit) }),
    ))
}

pub(super) async fn contacts_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let params = contact_create_params(&body)?;
    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer(stdb_client::reducer_call!(
            "create_contact",
            json!([org_id, params])
        ))
        .await
        .map_err(ApiError::internal)?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "data": { "message": "Contact created successfully" } })),
    ))
}
