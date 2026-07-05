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
use crate::openapi;
use crate::query_exec::{default_company_id, execute_resource_query};
use crate::reducer_allowlist::{blocked_reducer_reason, ReducerAllowlistMode};
use crate::routes;
use crate::session::resolve_api_session;
use crate::state::AppState;
use crate::web_session::stdb_identity_hex_hint;

#[derive(Debug, Deserialize)]
struct OrgQuery {
    #[serde(rename = "organizationId")]
    organization_id: Option<u64>,
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
        let url = format!("{}/health", state.config.ai_gateway_url.trim_end_matches('/'));
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

async fn get_openapi() -> Json<Value> {
    Json(openapi::specification())
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

    let client = state.client_with_token(&session.stdb_token);
    let data = execute_resource_query(
        &client,
        &resource,
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
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

    let allowlist_mode = ReducerAllowlistMode::from_env();
    if let Some(reason) = blocked_reducer_reason(&reducer, allowlist_mode) {
        return Err(ApiError::Forbidden(format!(
            "Reducer '{reducer}' is not allowed: {reason}"
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
    } else if let Some(requested_org) = args.first().and_then(|v| v.as_u64()) {
        if requested_org != org_id {
            return Err(ApiError::Forbidden(
                "organization scope mismatch for reducer call".into(),
            ));
        }
    }

    let client = state.client_with_token(&session.stdb_token);
    client
        .call_reducer(&reducer, Value::Array(args))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(Json(json!({ "ok": true })))
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
        .route("/openapi.json", get(get_openapi))
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
