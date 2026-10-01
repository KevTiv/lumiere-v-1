//! Read-only category projection. Organization/actor authority is never query input.
use crate::{
    error::ApiError,
    offline::{
        authority,
        core::{self, FeedError},
        source::StdbCategorySource,
        SCHEMA_HASH,
    },
    state::AppState,
    web_session::resolve_session,
};
use axum::{
    extract::{Query, State},
    http::{header::CACHE_CONTROL, HeaderMap, HeaderValue},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use std::{sync::Arc, time::Duration};
use tower_cookies::Cookies;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadQuery {
    company_id: Option<String>,
    authorization_version: Option<String>,
    cursor: Option<String>,
}
#[derive(Clone, Copy)]
enum Mode {
    Scope,
    Snapshot,
    Pull,
    Grant,
}

fn feed_error(error: FeedError) -> ApiError {
    match error {
        FeedError::Reset => ApiError::Gone(error.to_string()),
        FeedError::Unavailable => ApiError::Unavailable(error.to_string()),
        FeedError::InvalidCursor => ApiError::BadRequest(error.to_string()),
        FeedError::InvalidSource(message) => ApiError::Internal(message),
    }
}

async fn execute(
    state: &AppState,
    headers: &HeaderMap,
    cookies: &Cookies,
    query: &ReadQuery,
    mode: Mode,
) -> Result<Json<serde_json::Value>, ApiError> {
    let requested_company = query
        .company_id
        .as_deref()
        .map(core::parse_cursor)
        .transpose()
        .map_err(feed_error)?;
    let session = resolve_session(state, headers, cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let scope = authority::resolve(state, &session, requested_company).await?;
    if matches!(mode, Mode::Scope) {
        if query.cursor.is_some() || query.authorization_version.is_some() {
            return Err(ApiError::BadRequest(
                "Scope discovery accepts company selection only".into(),
            ));
        }
        return Ok(Json(
            serde_json::json!({"scope": scope, "schemaHash": SCHEMA_HASH}),
        ));
    }
    if query.authorization_version.as_deref() != Some(scope.authorization_version.as_str()) {
        return Err(ApiError::Conflict(
            "Offline authorization changed; rediscover projection scope".into(),
        ));
    }
    let source = StdbCategorySource {
        client: &state.stdb,
        scope: &scope,
    };
    let data = match mode {
        Mode::Snapshot => {
            if query.cursor.is_some() {
                return Err(ApiError::BadRequest(
                    "Snapshot cannot select a replay cursor".into(),
                ));
            }
            core::snapshot(&source, &scope, SCHEMA_HASH)
                .await
                .map_err(feed_error)?
        }
        Mode::Pull => {
            let cursor = query
                .cursor
                .as_deref()
                .ok_or_else(|| ApiError::BadRequest("Replay cursor required".into()))?;
            core::pull(
                &source,
                &scope,
                SCHEMA_HASH,
                core::parse_cursor(cursor).map_err(feed_error)?,
            )
            .await
            .map_err(feed_error)?
        }
        Mode::Grant => {
            if query.cursor.is_some() {
                return Err(ApiError::BadRequest(
                    "Grant cannot select a replay cursor".into(),
                ));
            }
            // Reauthorize again below before signing; unsigned client scope is never accepted.
            serde_json::Value::Null
        }
        Mode::Scope => unreachable!("scope discovery returned above"),
    };
    let current_session = resolve_session(state, headers, cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let current_scope = authority::resolve(state, &current_session, requested_company).await?;
    if current_scope != scope {
        return Err(ApiError::Conflict(
            "Offline authorization changed during read".into(),
        ));
    }
    if matches!(mode, Mode::Grant) {
        let signer = state
            .config
            .offline_grants
            .as_ref()
            .ok_or_else(|| ApiError::NotFound("Offline grants are disabled".into()))?;
        return Ok(Json(
            serde_json::to_value(signer.issue(&current_scope).map_err(ApiError::internal)?)
                .map_err(ApiError::internal)?,
        ));
    }
    Ok(Json(data))
}

async fn respond(
    state: Arc<AppState>,
    headers: HeaderMap,
    cookies: Cookies,
    query: ReadQuery,
    mode: Mode,
) -> Response {
    let result = tokio::time::timeout(
        Duration::from_secs(10),
        execute(&state, &headers, &cookies, &query, mode),
    )
    .await
    .unwrap_or_else(|_| Err(ApiError::Unavailable("Offline read timed out".into())));
    let mut response = result.into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}
async fn scope(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(query): Query<ReadQuery>,
) -> Response {
    respond(state, headers, cookies, query, Mode::Scope).await
}
async fn snapshot(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(query): Query<ReadQuery>,
) -> Response {
    respond(state, headers, cookies, query, Mode::Snapshot).await
}
async fn pull(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(query): Query<ReadQuery>,
) -> Response {
    respond(state, headers, cookies, query, Mode::Pull).await
}
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/offline/product-categories/scope", get(scope))
        .route("/offline/product-categories/snapshot", get(snapshot))
        .route("/offline/product-categories/pull", get(pull))
        .route("/offline/product-categories/grant", get(grant))
}

async fn grant(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(query): Query<ReadQuery>,
) -> Response {
    respond(state, headers, cookies, query, Mode::Grant).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tower::ServiceExt;
    #[tokio::test]
    async fn anonymous_requests_have_no_owner_read_or_cached_success() {
        let state = AppState::new(crate::session::test_support::test_config(Some(
            "server-test-token",
        )));
        for endpoint in ["scope", "snapshot", "pull", "grant"] {
            let request = axum::http::Request::builder()
                .uri(format!("/offline/product-categories/{endpoint}"))
                .body(axum::body::Body::empty())
                .unwrap();
            let response = router()
                .layer(tower_cookies::CookieManagerLayer::new())
                .with_state(Arc::new(state.clone()))
                .oneshot(request)
                .await
                .unwrap();
            assert_eq!(response.status(), axum::http::StatusCode::UNAUTHORIZED);
            assert_eq!(response.headers()[CACHE_CONTROL], "no-store");
        }
    }
    #[test]
    fn scope_smuggling_and_malformed_cursors_fail_closed() {
        assert!(
            serde_json::from_value::<ReadQuery>(serde_json::json!({"organizationId":"8"})).is_err()
        );
        assert!(core::parse_cursor("1 OR 1=1").is_err());
    }
}
