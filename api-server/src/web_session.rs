//! Cookie / Bearer session extraction for domain routes.

use axum::http::{header::AUTHORIZATION, HeaderMap};
use axum::{
    extract::FromRequestParts,
    http::request::Parts,
    response::{IntoResponse, Response},
};
use std::sync::Arc;
use tower_cookies::Cookies;

use crate::error::ApiError;
use crate::session::{resolve_api_session, ApiSession};
use crate::state::AppState;

/// Authenticated organization context. It never chooses a client or a company.
/// Place after Path/Query extraction to preserve their existing rejection order.
pub struct OrgSession {
    pub session: ApiSession,
    pub organization_id: u64,
}

impl OrgSession {
    fn from_session(session: Option<ApiSession>) -> Result<Self, ApiError> {
        let session = session.ok_or(ApiError::Unauthorized)?;
        let organization_id = require_org(&session)?;
        Ok(Self {
            session,
            organization_id,
        })
    }
}

#[axum::async_trait]
impl FromRequestParts<Arc<AppState>> for OrgSession {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Response> {
        let cookies = Cookies::from_request_parts(parts, state)
            .await
            .map_err(IntoResponse::into_response)?;
        let session = resolve_session(state, &parts.headers, &cookies)
            .await
            .map_err(IntoResponse::into_response)?;
        Self::from_session(session).map_err(IntoResponse::into_response)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::test_support::test_config;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };

    #[test]
    fn organization_context_rejects_missing_session_or_membership() {
        assert!(matches!(
            OrgSession::from_session(None),
            Err(ApiError::Unauthorized)
        ));
        let session = ApiSession {
            stdb_token: "client-token".into(),
            identity_hex: "actor".into(),
            organization_id: None,
            field_access: None,
        };
        assert!(matches!(
            OrgSession::from_session(Some(session)),
            Err(ApiError::Forbidden(_))
        ));
    }

    #[test]
    fn organization_context_preserves_authenticated_identity_and_token() {
        let session = ApiSession {
            stdb_token: "client-token".into(),
            identity_hex: "actor".into(),
            organization_id: Some(42),
            field_access: None,
        };
        let context = OrgSession::from_session(Some(session))
            .ok()
            .expect("organization context");
        assert_eq!(context.organization_id, 42);
        assert_eq!(context.session.stdb_token, "client-token");
        assert_eq!(context.session.identity_hex, "actor");
    }

    #[tokio::test]
    async fn extractor_preserves_cookie_middleware_rejection_and_anonymous_401() {
        let state = Arc::new(AppState::new(test_config(Some(
            "admin-token-must-not-be-used",
        ))));
        let (mut parts, _) = Request::new(Body::empty()).into_parts();
        let response = OrgSession::from_request_parts(&mut parts, &state)
            .await
            .err()
            .expect("missing middleware");
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        parts.extensions.insert(Cookies::default());
        let response = OrgSession::from_request_parts(&mut parts, &state)
            .await
            .err()
            .expect("anonymous");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
}

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
    let auth = headers.get(AUTHORIZATION).and_then(|v| v.to_str().ok());
    let id_hint = stdb_identity_hex_hint(headers, cookies);
    let cookie_tok = cookies.get("stdb_token").map(|c| c.value().to_string());
    resolve_api_session(state, auth, cookie_tok.as_deref(), id_hint.as_deref()).await
}

pub fn require_org(session: &ApiSession) -> Result<u64, ApiError> {
    session
        .organization_id
        .ok_or_else(|| ApiError::Forbidden("No organization assigned".into()))
}
