//! `/v1/crm/*` — parity with `frontend/web/app/api/crm/*/route.ts`.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tower_cookies::Cookies;

use crate::domain_queries::query_lead_by_id;
use crate::error::ApiError;
use crate::query_exec::execute_resource_query;
use crate::state::AppState;
use crate::web_session::{require_org, resolve_session};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LeadsListQuery {
    state: Option<String>,
    user_id: Option<String>,
    priority: Option<String>,
    #[serde(default)]
    limit: Option<u64>,
    #[serde(default)]
    offset: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContactsListQuery {
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

fn value_as_u64(v: &Value) -> Option<u64> {
    v.as_u64()
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

fn value_as_str(v: &Value) -> Option<&str> {
    v.as_str()
}

async fn leads_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(q): Query<LeadsListQuery>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let (limit, offset) = paginate_limit_offset(q.limit, q.offset);

    let client = state.client_with_token(&session.stdb_token);
    let mut rows = execute_resource_query(
        &client,
        "leads",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;

    if let Some(ref st) = q.state {
        rows.retain(|r| value_as_str(r.get("state").unwrap_or(&Value::Null)) == Some(st.as_str()));
    }
    if let Some(ref uid) = q.user_id {
        if let Ok(n) = uid.parse::<u64>() {
            rows.retain(|r| value_as_u64(r.get("userId").unwrap_or(&Value::Null)) == Some(n));
        }
    }
    if let Some(ref pr) = q.priority {
        rows.retain(|r| {
            value_as_str(r.get("priority").unwrap_or(&Value::Null)) == Some(pr.as_str())
        });
    }

    let total = rows.len();
    let page_rows: Vec<Value> = rows.into_iter().skip(offset).take(limit).collect();
    Ok(Json(
        json!({ "data": page_rows, "meta": list_meta(total, offset, limit) }),
    ))
}

fn lead_create_params(body: &Value) -> Result<Value, ApiError> {
    let name = body
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ApiError::BadRequest("Name is required".into()))?;
    Ok(json!({
        "name": name,
        "priority": body.get("priority").and_then(|v| v.as_str()).unwrap_or("medium"),
        "state": body.get("state").and_then(|v| v.as_str()).unwrap_or("new"),
        "expectedRevenue": body.get("expectedRevenue").and_then(value_as_u64).unwrap_or(0),
        "probability": body.get("probability").and_then(|v| v.as_f64()).unwrap_or(0.0),
        "tagIds": body.get("tagIds").cloned().unwrap_or(json!([])),
        "email": body.get("email").cloned().unwrap_or(Value::Null),
        "phone": body.get("phone").cloned().unwrap_or(Value::Null),
        "mobile": body.get("mobile").cloned().unwrap_or(Value::Null),
        "companyName": body.get("companyName").cloned().unwrap_or(Value::Null),
        "contactName": body.get("contactName").cloned().unwrap_or(Value::Null),
        "title": body.get("title").cloned().unwrap_or(Value::Null),
        "street": body.get("street").cloned().unwrap_or(Value::Null),
        "city": body.get("city").cloned().unwrap_or(Value::Null),
        "zip": body.get("zip").cloned().unwrap_or(Value::Null),
        "countryCode": body.get("countryCode").cloned().unwrap_or(Value::Null),
        "website": body.get("website").cloned().unwrap_or(Value::Null),
        "industry": body.get("industry").cloned().unwrap_or(Value::Null),
        "sourceId": body.get("sourceId").cloned().unwrap_or(Value::Null),
        "campaignId": body.get("campaignId").cloned().unwrap_or(Value::Null),
        "mediumId": body.get("mediumId").cloned().unwrap_or(Value::Null),
        "referredBy": body.get("referredBy").cloned().unwrap_or(Value::Null),
        "description": body.get("description").cloned().unwrap_or(Value::Null),
        "userId": body.get("userId").cloned().unwrap_or(Value::Null),
        "teamId": body.get("teamId").cloned().unwrap_or(Value::Null),
        "partnerId": body.get("partnerId").cloned().unwrap_or(Value::Null),
        "dateDeadline": body.get("dateDeadline").cloned().unwrap_or(Value::Null),
        "metadata": body.get("metadata").cloned().unwrap_or(Value::Null),
    }))
}

async fn leads_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let params = lead_create_params(&body)?;
    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer("create_lead", json!([org_id, params]))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "data": { "message": "Lead created successfully" } })),
    ))
}

async fn lead_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let lead_id: u64 = id
        .parse()
        .map_err(|_| ApiError::BadRequest("Invalid lead ID".into()))?;
    let client = state.client_with_token(&session.stdb_token);
    let lead = query_lead_by_id(&client, lead_id, org_id, session.field_access.as_ref())
        .await?
        .ok_or_else(|| ApiError::NotFound("Lead not found".into()))?;
    Ok(Json(json!({ "data": lead })))
}

async fn lead_put(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let lead_id: u64 = id
        .parse()
        .map_err(|_| ApiError::BadRequest("Invalid lead ID".into()))?;
    let b = body
        .as_object()
        .ok_or_else(|| ApiError::BadRequest("Invalid body".into()))?;

    let has_details = b.contains_key("contactName")
        || b.contains_key("title")
        || b.contains_key("website")
        || b.contains_key("industry")
        || b.contains_key("referredBy")
        || b.contains_key("description");
    let has_address = b.contains_key("street")
        || b.contains_key("city")
        || b.contains_key("zip")
        || b.contains_key("countryCode");
    let has_revenue = b.contains_key("expectedRevenue") || b.contains_key("probability");

    if !has_details && !has_address && !has_revenue {
        return Err(ApiError::BadRequest("No valid fields to update".into()));
    }

    let client = state.client_with_token(&session.stdb_token);

    let params_details = if has_details {
        Some(json!({
            "contact_name": b.get("contactName").and_then(|v| v.as_str()),
            "title": b.get("title").and_then(|v| v.as_str()),
            "website": b.get("website").and_then(|v| v.as_str()),
            "industry": b.get("industry").and_then(|v| v.as_str()),
            "referred_by": b.get("referredBy").and_then(|v| v.as_str()),
            "description": b.get("description").and_then(|v| v.as_str()),
        }))
    } else {
        None
    };
    let params_address = if has_address {
        Some(json!({
            "street": b.get("street").and_then(|v| v.as_str()),
            "city": b.get("city").and_then(|v| v.as_str()),
            "zip": b.get("zip").and_then(|v| v.as_str()),
            "country_code": b.get("countryCode").and_then(|v| v.as_str()),
        }))
    } else {
        None
    };
    let params_revenue = if has_revenue {
        Some(json!({
            "expected_revenue": b.get("expectedRevenue").and_then(|v| v.as_f64()),
            "probability": b.get("probability").and_then(|v| v.as_f64()),
        }))
    } else {
        None
    };

    let c1 = client.clone();
    let c2 = client.clone();
    let c3 = client.clone();
    let lid = lead_id;

    let f1 = async {
        if let Some(p) = params_details {
            c1.call_reducer("update_lead_details", json!([org_id, lid, p]))
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
        }
        Ok::<(), ApiError>(())
    };
    let f2 = async {
        if let Some(p) = params_address {
            c2.call_reducer("update_lead_address", json!([org_id, lid, p]))
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
        }
        Ok::<(), ApiError>(())
    };
    let f3 = async {
        if let Some(p) = params_revenue {
            c3.call_reducer("update_lead_revenue", json!([org_id, lid, p]))
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
        }
        Ok::<(), ApiError>(())
    };

    tokio::try_join!(f1, f2, f3)?;

    Ok(Json(
        json!({ "data": { "message": "Lead updated successfully" } }),
    ))
}

async fn lead_delete(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let lead_id: u64 = id
        .parse()
        .map_err(|_| ApiError::BadRequest("Invalid lead ID".into()))?;
    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer("delete_lead", json!([org_id, lead_id]))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Json(
        json!({ "data": { "message": "Lead deleted successfully" } }),
    ))
}

fn contact_create_params(body: &Value) -> Result<Value, ApiError> {
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

async fn contacts_get(
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

    let client = state.client_with_token(&session.stdb_token);
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

async fn contacts_post(
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
        .call_reducer("create_contact", json!([org_id, params]))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "data": { "message": "Contact created successfully" } })),
    ))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/crm/leads", get(leads_get).post(leads_post))
        .route(
            "/crm/leads/:id",
            get(lead_get).put(lead_put).delete(lead_delete),
        )
        .route("/crm/contacts", get(contacts_get).post(contacts_post))
}
