//! Cookie / Bearer session extraction for domain routes.

use axum::http::{header::AUTHORIZATION, HeaderMap};
use tower_cookies::Cookies;

use crate::error::ApiError;
use crate::session::{resolve_api_session, ApiSession};
use crate::state::AppState;

/// Prefer `x-stdb-identity`, else `stdb_identity` cookie — matches `frontend/web/lib/api-session.ts`.
pub fn stdb_identity_hex_hint(headers: &HeaderMap, cookies: &Cookies) -> Option<String> {
    let from_header = headers
        .get("x-stdb-identity")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    from_header.or_else(|| {
        cookies
            .get("stdb_identity")
            .map(|c| c.value().to_string())
            .filter(|s| !s.is_empty())
    })
}

pub async fn resolve_session(
    state: &AppState,
    headers: &HeaderMap,
    cookies: &Cookies,
) -> Result<Option<ApiSession>, ApiError> {
    let auth = headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let id_hint = stdb_identity_hex_hint(headers, cookies);
    let cookie_tok = cookies.get("stdb_token").map(|c| c.value().to_string());
    resolve_api_session(state, auth, cookie_tok.as_deref(), id_hint.as_deref()).await
}

pub fn require_org(session: &ApiSession) -> Result<u64, ApiError> {
    session
        .organization_id
        .ok_or_else(|| ApiError::Forbidden("No organization assigned".into()))
}
