//! Axum router and `serve` — shared by `lib` and the `api-server` binary.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::{
        header::{HeaderName, ACCEPT, ACCEPT_LANGUAGE, AUTHORIZATION, CONTENT_TYPE, COOKIE},
        HeaderMap, Method, StatusCode,
    },
    middleware::from_fn,
    routing::{get, post},
    Json, Router,
};

use crate::realtime;
use serde::Deserialize;
use serde_json::{json, Value};
use tower_cookies::CookieManagerLayer;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::config::Config;
use crate::error::ApiError;
use crate::metrics;
use crate::middleware::metrics::track_http_metrics;
use crate::query_exec::{default_company_id, execute_resource_query_for_company};
use crate::routes;
use crate::session::resolve_api_session;
use crate::state::AppState;
use crate::web_session::stdb_identity_hex_hint;
use stdb_client::{Exposure, ReducerCall, ReducerContract};

#[derive(Debug, Deserialize)]
struct OrgQuery {
    #[serde(rename = "organizationId")]
    organization_id: Option<u64>,
    #[serde(rename = "companyId")]
    company_id: Option<u64>,
    /// Keyset cursor for paginated resources (currently only "pos-orders");
    /// other resources ignore it.
    cursor: Option<String>,
    /// Page size for paginated resources; other resources ignore it.
    limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct CallQuery {
    #[serde(default, rename = "withCompany")]
    with_company: bool,
}

async fn health() -> StatusCode {
    StatusCode::OK
}

async fn health_ready(State(state): State<Arc<AppState>>) -> Result<StatusCode, StatusCode> {
    let token = state
        .config
        .stdb_server_token
        .as_deref()
        .filter(|t| !t.is_empty())
        .unwrap_or("");
    let client = state.client_with_token(token);
    if client.query_sql("SELECT 1").await.is_err() {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }
    if !state.config.ai_gateway_url.is_empty() {
        let url = format!(
            "{}/health",
            state.config.ai_gateway_url.trim_end_matches('/')
        );
        if let Ok(resp) = state.http.get(&url).send().await {
            if !resp.status().is_success() {
                return Err(StatusCode::SERVICE_UNAVAILABLE);
            }
        }
    }
    Ok(StatusCode::OK)
}

async fn metrics_handler() -> (StatusCode, String) {
    (StatusCode::OK, metrics::render_prometheus())
}

async fn get_query(
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
        let page = crate::cold_tier::pos_order_read::merged_page(
            &client,
            org_id,
            q.company_id,
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

async fn post_call(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: tower_cookies::Cookies,
    Path(reducer): Path<String>,
    Query(q): Query<CallQuery>,
    Json(body): Json<Value>,
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

    let contract = stdb_client::reducer_contract(&reducer).ok_or_else(|| {
        ApiError::Forbidden(format!(
            "Reducer '{reducer}' is not exposed by the module contract"
        ))
    })?;
    if contract.exposure != Exposure::Session {
        return Err(ApiError::Forbidden(format!(
            "Reducer '{reducer}' is not session-exposed"
        )));
    }

    let mut args: Vec<Value> = if let Some(a) = body.as_array() {
        a.clone()
    } else {
        vec![body]
    };

    if q.with_company {
        let client = state.client_with_token(&session.stdb_token);
        let company_id = default_company_id(&client, org_id)
            .await?
            .ok_or_else(|| ApiError::Unprocessable("No company found for organization".into()))?;
        let mut next = vec![json!(org_id), json!(company_id)];
        next.append(&mut args);
        args = next;
    }

    let company_id = validate_reducer_scope(contract, &args, org_id)?;
    let call = ReducerCall::from_name(&reducer, Value::Array(args))
        .map_err(|error| ApiError::Unprocessable(error.to_string()))?;
    let client = state.client_with_token(&session.stdb_token);
    if let Some(company_id) = company_id {
        let rows = state
            .stdb
            .query_sql(&format!(
                "SELECT id FROM company WHERE id = {company_id} AND organization_id = {org_id} LIMIT 1"
            ))
            .await
            .map_err(|error| ApiError::Internal(error.to_string()))?;
        if rows.is_empty() {
            return Err(ApiError::Forbidden(
                "company scope mismatch for reducer call".into(),
            ));
        }
    }
    client
        .call_reducer(call)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(Json(json!({ "ok": true })))
}

fn validate_reducer_scope(
    contract: &'static ReducerContract,
    args: &[Value],
    session_organization_id: u64,
) -> Result<Option<u64>, ApiError> {
    if let Some(position) = contract.organization_position {
        let requested_organization =
            args.get(position).and_then(Value::as_u64).ok_or_else(|| {
                ApiError::Unprocessable(format!(
                    "Reducer '{}' requires an organization_id at argument {position}",
                    contract.name
                ))
            })?;
        if requested_organization != session_organization_id {
            return Err(ApiError::Forbidden(
                "organization scope mismatch for reducer call".into(),
            ));
        }
    } else if contract.company_position.is_none() && contract.unscoped_reason.is_none() {
        return Err(ApiError::Forbidden(format!(
            "Reducer '{}' has no reviewed tenant scope",
            contract.name
        )));
    }

    let company_id = contract
        .company_position
        .and_then(|position| args.get(position))
        .and_then(Value::as_u64);
    if contract.organization_position.is_none()
        && contract.company_position.is_some()
        && company_id.is_none()
    {
        return Err(ApiError::Unprocessable(format!(
            "Reducer '{}' requires a company_id scope",
            contract.name
        )));
    }
    Ok(company_id)
}

fn load_dotenv_files() {
    // Playwright e2e-smoke sets LUMIERE_E2E=1 and injects STDB_HOST/token via the Makefile so
    // api-server/.env.local (maincloud) does not override local SpacetimeDB settings.
    if std::env::var("LUMIERE_E2E").ok().as_deref() == Some("1") {
        return;
    }
    let _ = dotenvy::dotenv();
    // `dotenv()` only reads `.env` in CWD. When you `cargo run -p api-server` from the repo
    // root, `api-server/.env.local` is never loaded unless we pull it in explicitly.
    let server_local = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(".env.local");
    let _ = dotenvy::from_path_override(&server_local);
    let _ = dotenvy::from_filename_override(".env.local");
}

pub async fn serve() -> anyhow::Result<()> {
    load_dotenv_files();
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "api_server=debug,tower_http=info".parse().unwrap()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_env()?;

    // Browsers forbid `Access-Control-Allow-Origin: *` when `credentials: 'include'` (web
    // `apiFetch` + `NEXT_PUBLIC_API_GATEWAY_URL`). Use explicit origins + credentials.
    const DEFAULT_DEV_ORIGINS: &[&str] = &[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        // `next start` + Playwright default (`PLAYWRIGHT_BASE_URL` / port 3100)
        "http://localhost:3100",
        "http://127.0.0.1:3100",
    ];

    let origins: Vec<axum::http::HeaderValue> = if config.cors_origins.is_empty() {
        DEFAULT_DEV_ORIGINS
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect()
    } else {
        config
            .cors_origins
            .iter()
            .filter_map(|s| s.parse().ok())
            .collect()
    };

    let allow_origin = if origins.is_empty() {
        tracing::warn!(
            "no valid CORS origins; falling back to http://localhost:3000 (set CORS_ORIGINS otherwise)"
        );
        tower_http::cors::AllowOrigin::exact(
            "http://localhost:3000"
                .parse()
                .expect("static localhost origin"),
        )
    } else {
        tower_http::cors::AllowOrigin::list(origins)
    };

    // With `allow_credentials(true)`, tower-http forbids `*` for methods/headers/expose.
    const CORS_ALLOW_METHODS: [Method; 7] = [
        Method::GET,
        Method::POST,
        Method::PUT,
        Method::PATCH,
        Method::DELETE,
        Method::OPTIONS,
        Method::HEAD,
    ];
    const CORS_ALLOW_HEADERS: [HeaderName; 11] = [
        AUTHORIZATION,
        CONTENT_TYPE,
        ACCEPT,
        ACCEPT_LANGUAGE,
        HeaderName::from_static("x-stdb-identity"),
        COOKIE,
        HeaderName::from_static("connection"),
        HeaderName::from_static("upgrade"),
        HeaderName::from_static("sec-websocket-key"),
        HeaderName::from_static("sec-websocket-version"),
        HeaderName::from_static("sec-websocket-protocol"),
    ];

    let cors = CorsLayer::new()
        .allow_origin(allow_origin)
        .allow_credentials(true)
        .allow_methods(CORS_ALLOW_METHODS)
        .allow_headers(CORS_ALLOW_HEADERS);

    let port = config.port;
    let state = Arc::new(AppState::new(config));
    tracing::info!(
        "api-server on 0.0.0.0:{} → STDB {} / {}",
        port,
        state.config.stdb_host,
        state.config.stdb_module
    );

    let v1 = Router::new()
        .route("/query/:resource", get(get_query))
        .route("/call/:reducer", post(post_call))
        .route("/realtime/ws", get(realtime::realtime_ws_upgrade))
        .route("/realtime/info", get(realtime::realtime_info))
        // Auth + STDB routes before domain routers so `/stdb/*` catch-all does not shadow `/stdb/subscription-queries`.
        .merge(routes::domain_router());

    let app = Router::new()
        .route("/health", get(health))
        .route("/health/ready", get(health_ready))
        .route("/metrics", get(metrics_handler))
        .nest("/v1", v1)
        .layer(CookieManagerLayer::new())
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .layer(from_fn(track_http_metrics))
        .with_state(state);

    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn identity_first_reducer_uses_manifest_organization_position() {
        let contract = stdb_client::reducer_contract("assign_role").expect("assign_role");
        assert!(
            validate_reducer_scope(contract, &[json!({}), json!(9), json!(7), json!({})], 7)
                .is_ok()
        );
        assert!(matches!(
            validate_reducer_scope(contract, &[json!({}), json!(9), json!(8), json!({})], 7),
            Err(ApiError::Forbidden(_))
        ));
    }

    #[test]
    fn company_first_reducer_is_not_compared_directly_to_organization() {
        let contract = stdb_client::reducer_contract("delete_company").expect("delete_company");
        assert_eq!(
            validate_reducer_scope(contract, &[json!(42)], 7).unwrap(),
            Some(42)
        );
    }

    #[test]
    fn zero_arg_and_unknown_reducers_are_not_session_exposed() {
        let zero_arg = stdb_client::reducer_contract("apply_global_migrations")
            .expect("apply_global_migrations");
        assert!(zero_arg.params.is_empty());
        assert_eq!(zero_arg.exposure, Exposure::Denied);
        assert!(stdb_client::reducer_contract("not_a_reducer").is_none());
    }

    #[test]
    fn reviewed_unscoped_reducer_is_explicit() {
        let contract = stdb_client::reducer_contract("create_country").expect("create_country");
        assert_eq!(contract.exposure, Exposure::Session);
        assert!(contract.organization_position.is_none());
        assert!(contract.company_position.is_none());
        assert!(contract.unscoped_reason.is_some());
        assert!(validate_reducer_scope(contract, &[json!({})], 7).is_ok());
    }
}
