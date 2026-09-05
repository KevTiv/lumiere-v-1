use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use tracing::error;

#[derive(Debug)]
pub enum ApiError {
    Unauthorized,
    /// 401 — password flow only (matches Next.js copy).
    InvalidEmailOrPassword,
    /// 401 — SSO account attempted password sign-in.
    AccountUsesSso,
    Forbidden(String),
    BadRequest(String),
    Conflict(String),
    Gone(String),
    NotFound(String),
    Unprocessable(String),
    Unavailable(String),
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, msg) = match self {
            ApiError::Unauthorized => (StatusCode::UNAUTHORIZED, "Unauthorized".to_string()),
            ApiError::InvalidEmailOrPassword => {
                return (
                    StatusCode::UNAUTHORIZED,
                    Json(json!({ "error": "Invalid email or password" })),
                )
                    .into_response();
            }
            ApiError::AccountUsesSso => {
                return (
                    StatusCode::UNAUTHORIZED,
                    Json(json!({
                        "error": "This account uses SSO. Sign in with SSO instead."
                    })),
                )
                    .into_response();
            }
            ApiError::Forbidden(m) => (StatusCode::FORBIDDEN, m),
            ApiError::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
            ApiError::Conflict(m) => (StatusCode::CONFLICT, m),
            ApiError::Gone(m) => (StatusCode::GONE, m),
            ApiError::NotFound(m) => (StatusCode::NOT_FOUND, m),
            ApiError::Unprocessable(m) => (StatusCode::UNPROCESSABLE_ENTITY, m),
            ApiError::Unavailable(m) => (StatusCode::SERVICE_UNAVAILABLE, m),
            ApiError::Internal(m) => {
                error!(message = %m, "internal api error");
                // Redact internal details from the response body; the source
                // message is preserved in the tracing log above.
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error".to_string())
            }
        };
        (status, Json(json!({ "error": msg }))).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

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
        let (status, body) =
            error_body(ApiError::NotFound("report not found".into())).await;
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
