use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use tracing::error;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("unauthorized")]
    Unauthorized,
    /// 401 — password flow only (matches Next.js copy).
    #[error("invalid email or password")]
    InvalidEmailOrPassword,
    /// 401 — SSO account attempted password sign-in.
    #[error("account uses SSO")]
    AccountUsesSso,
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Gone(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Unprocessable(String),
    #[error("{0}")]
    Unavailable(String),
    #[error("service temporarily unavailable")]
    UnavailableSource(#[source] anyhow::Error),
    /// Compatibility boundary for upstream APIs that already return strings.
    /// Typed failures should use [`Self::internal`] to preserve their source.
    #[error("internal server error")]
    Internal(String),
    #[error("internal server error")]
    InternalSource(#[from] anyhow::Error),
}

impl ApiError {
    /// Preserve an unavailable dependency's source without exposing its details.
    pub fn unavailable(error: impl Into<anyhow::Error>) -> Self {
        Self::UnavailableSource(error.into())
    }
    /// Preserve a typed internal failure without exposing its message over HTTP.
    pub fn internal(error: impl Into<anyhow::Error>) -> Self {
        Self::InternalSource(error.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, msg) = match self {
            ApiError::Unauthorized => (StatusCode::UNAUTHORIZED, "Unauthorized".to_string()),
            ApiError::InvalidEmailOrPassword => {
                (StatusCode::UNAUTHORIZED, "Invalid email or password".into())
            }
            ApiError::AccountUsesSso => (
                StatusCode::UNAUTHORIZED,
                "This account uses SSO. Sign in with SSO instead.".into(),
            ),
            ApiError::Forbidden(m) => (StatusCode::FORBIDDEN, m),
            ApiError::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
            ApiError::Conflict(m) => (StatusCode::CONFLICT, m),
            ApiError::Gone(m) => (StatusCode::GONE, m),
            ApiError::NotFound(m) => (StatusCode::NOT_FOUND, m),
            ApiError::Unprocessable(m) => (StatusCode::UNPROCESSABLE_ENTITY, m),
            ApiError::Unavailable(m) => (StatusCode::SERVICE_UNAVAILABLE, m),
            ApiError::UnavailableSource(source) => {
                error!(error = ?source, "api dependency unavailable");
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Service temporarily unavailable".into(),
                )
            }
            ApiError::Internal(m) => {
                error!(message = %m, "internal api error");
                // Redact internal details from the response body; the source
                // message is preserved in the tracing log above.
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Internal server error".to_string(),
                )
            }
            ApiError::InternalSource(source) => {
                error!(error = ?source, "internal api error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Internal server error".into(),
                )
            }
        };
        (status, Json(json!({ "error": msg }))).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

    #[tokio::test]
    async fn unavailable_dependency_is_not_a_successful_partial_response() {
        let error = ApiError::unavailable(anyhow::anyhow!("private database endpoint"));
        assert_eq!(error.to_string(), "service temporarily unavailable");
        assert_eq!(
            error_body(error).await,
            (
                StatusCode::SERVICE_UNAVAILABLE,
                json!({"error": "Service temporarily unavailable"})
            )
        );
    }

    #[tokio::test]
    async fn typed_internal_error_retains_source_and_redacts_response() {
        let failure = anyhow::Error::new(std::io::Error::other("private upstream detail"))
            .context("load report");
        let error = ApiError::from(failure);
        assert_eq!(error.to_string(), "internal server error");
        let ApiError::InternalSource(ref source) = error else {
            panic!("source variant")
        };
        assert!(source.downcast_ref::<std::io::Error>().is_some());
        assert_eq!(source.chain().count(), 2);
        let (status, body) = error_body(error).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body, json!({"error": "Internal server error"}));
    }

    #[tokio::test]
    async fn status_and_auth_special_bodies_remain_stable() {
        for (error, expected) in [
            (
                ApiError::BadRequest("message".into()),
                StatusCode::BAD_REQUEST,
            ),
            (ApiError::Conflict("message".into()), StatusCode::CONFLICT),
            (ApiError::Gone("message".into()), StatusCode::GONE),
            (
                ApiError::Unprocessable("message".into()),
                StatusCode::UNPROCESSABLE_ENTITY,
            ),
            (
                ApiError::Unavailable("message".into()),
                StatusCode::SERVICE_UNAVAILABLE,
            ),
        ] {
            assert_eq!(
                error_body(error).await,
                (expected, json!({"error": "message"}))
            );
        }
        assert_eq!(
            error_body(ApiError::AccountUsesSso).await,
            (
                StatusCode::UNAUTHORIZED,
                json!({"error": "This account uses SSO. Sign in with SSO instead."})
            )
        );
    }

    async fn error_body(err: ApiError) -> (StatusCode, serde_json::Value) {
        let resp = err.into_response();
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), 1024).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        (status, json)
    }

    #[tokio::test]
    async fn internal_error_redacts_source_message() {
        let (status, body) = error_body(ApiError::Internal(
            "database connection failed: password=secret at postgres://user:pass@host".into(),
        ))
        .await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        let msg = body.get("error").and_then(|v| v.as_str()).unwrap();
        assert_eq!(msg, "Internal server error");
        assert!(!msg.contains("password"));
        assert!(!msg.contains("postgres://"));
    }

    #[tokio::test]
    async fn forbidden_preserves_message() {
        let (status, body) =
            error_body(ApiError::Forbidden("No organization assigned".into())).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(
            body.get("error").and_then(|v| v.as_str()).unwrap(),
            "No organization assigned"
        );
    }

    #[tokio::test]
    async fn not_found_preserves_message() {
        let (status, body) = error_body(ApiError::NotFound("report not found".into())).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(
            body.get("error").and_then(|v| v.as_str()).unwrap(),
            "report not found"
        );
    }

    #[tokio::test]
    async fn unauthorized_has_generic_message() {
        let (status, body) = error_body(ApiError::Unauthorized).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(
            body.get("error").and_then(|v| v.as_str()).unwrap(),
            "Unauthorized"
        );
    }

    #[tokio::test]
    async fn invalid_email_or_password_has_specific_body() {
        let (status, body) = error_body(ApiError::InvalidEmailOrPassword).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(
            body.get("error").and_then(|v| v.as_str()).unwrap(),
            "Invalid email or password"
        );
    }
}
