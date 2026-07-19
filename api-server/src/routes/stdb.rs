use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::header::AUTHORIZATION;
use axum::http::{HeaderMap, HeaderName, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get};
use axum::Json;
use axum::Router;
use serde::Deserialize;
use serde_json::json;
use tower_cookies::Cookies;

use crate::error::ApiError;
use crate::session::resolve_api_session;
use crate::state::AppState;
use crate::web_session::stdb_identity_hex_hint;
use stdb_auth::{
    create_client_subscriptions, full_client_subscription_resources_vec,
    subscription_queries_for_resource, subscription_resource_keys_vec, SubscriptionQueryContext,
};

#[derive(Debug, Deserialize)]
struct SubscriptionQuery {
    resource: String,
}

fn hop_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailers"
            | "transfer-encoding"
            | "upgrade"
    )
}

async fn subscription_queries(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(q): Query<SubscriptionQuery>,
) -> Result<Response, ApiError> {
    let auth = headers.get(AUTHORIZATION).and_then(|v| v.to_str().ok());
    let id_hint = stdb_identity_hex_hint(&headers, &cookies);
    let cookie_tok = cookies.get("stdb_token").map(|c| c.value().to_string());

    let session = resolve_api_session(&state, auth, cookie_tok.as_deref(), id_hint.as_deref())
        .await?
        .ok_or(ApiError::Unauthorized)?;

    let available: Vec<String> = {
        let mut a = subscription_resource_keys_vec();
        a.push("all".into());
        a
    };

    let resource = q.resource.trim();
    if resource.is_empty() {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Missing query param: resource",
                "available": available,
            })),
        )
            .into_response());
    }

    let identity_hex = (session.identity_hex != "unknown").then_some(session.identity_hex.as_str());

    let ctx = SubscriptionQueryContext {
        organization_id: session.organization_id,
        company_ids: None,
        identity_hex,
        role_names: None,
        manager_employee_id: None,
        field_access: session.field_access.as_ref(),
    };

    if resource == "all" {
        let full = full_client_subscription_resources_vec();
        let queries =
            create_client_subscriptions(&full, &ctx).map_err(|e| ApiError::Internal(e))?;
        return Ok(Json(json!({
            "resource": "all",
            "organizationId": session.organization_id,
            "queries": queries,
        }))
        .into_response());
    }

    let queries =
        subscription_queries_for_resource(resource, &ctx).map_err(|e| ApiError::Internal(e))?;
    let Some(queries) = queries else {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Unknown resource, or missing context (e.g. organizationId for ERP tables, identity for user-roles)",
                "resource": resource,
                "available": available,
            })),
        )
            .into_response());
    };

    Ok(Json(json!({
        "resource": resource,
        "organizationId": session.organization_id,
        "queries": queries,
    }))
    .into_response())
}

async fn stdb_http_proxy(
    State(state): State<Arc<AppState>>,
    method: Method,
    Path(path): Path<String>,
    headers: HeaderMap,
    cookies: Cookies,
    uri: axum::http::Uri,
    body: Body,
) -> Result<Response, ApiError> {
    if method == Method::OPTIONS {
        return Ok(Response::builder()
            .status(StatusCode::NO_CONTENT)
            .header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            .header(
                "Access-Control-Allow-Headers",
                "Authorization, Content-Type",
            )
            .body(Body::empty())
            .unwrap());
    }

    let query = uri.query().unwrap_or("");
    let path = path.trim_start_matches('/');
    let target = format!(
        "{}/{}{}",
        state.config.stdb_host.trim_end_matches('/'),
        path,
        if query.is_empty() {
            String::new()
        } else {
            format!("?{query}")
        }
    );

    let mut bearer: Option<String> = None;
    if let Some(a) = headers.get(AUTHORIZATION).and_then(|v| v.to_str().ok()) {
        if let Some(rest) = a.strip_prefix("Bearer ") {
            bearer = Some(rest.trim().to_string());
        }
    }
    if bearer.is_none() {
        if let Some(c) = cookies.get("stdb_token") {
            bearer = Some(c.value().to_string());
        }
    }

    let reqwest_method =
        reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap_or(reqwest::Method::GET);

    let mut rb = state.http.request(reqwest_method, &target);
    if let Some(b) = bearer {
        rb = rb.bearer_auth(b);
    }
    if let Some(ct) = headers.get("content-type").and_then(|v| v.to_str().ok()) {
        rb = rb.header("Content-Type", ct);
    }

    let bytes = axum::body::to_bytes(body, 32 * 1024 * 1024)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    if method != Method::GET && method != Method::HEAD {
        rb = rb.body(bytes.to_vec());
    }

    let res = rb
        .send()
        .await
        .map_err(|e| ApiError::Internal(format!("stdb proxy: {e}")))?;

    let status = StatusCode::from_u16(res.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let mut builder = Response::builder().status(status);

    for (k, v) in res.headers().iter() {
        let name = k.as_str();
        if hop_header(name) {
            continue;
        }
        if let Ok(name) = HeaderName::try_from(name) {
            if let Ok(val) = v.to_str() {
                builder = builder.header(name, val);
            }
        }
    }

    let body_bytes = res
        .bytes()
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    builder
        .body(Body::from(body_bytes))
        .map_err(|e| ApiError::Internal(e.to_string()))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/stdb/subscription-queries", get(subscription_queries))
        .route("/stdb/*path", any(stdb_http_proxy))
}
