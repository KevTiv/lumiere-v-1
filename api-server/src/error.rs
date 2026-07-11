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
                (StatusCode::INTERNAL_SERVER_ERROR, m)
            }
        };
        (status, Json(json!({ "error": msg }))).into_response()
    }
}
