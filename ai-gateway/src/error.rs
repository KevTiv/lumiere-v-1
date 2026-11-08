use axum::{http::StatusCode, response::IntoResponse, Json};
use serde_json::json;
use thiserror::Error;

#[derive(Error, Debug)]
#[error("AI skill '{skill_key}' is not provisioned. An administrator can open AI Skills and select Set up AI features to register missing built-in skills.")]
pub struct SurfaceSkillNotProvisioned {
    pub skill_key: String,
}

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Qdrant error: {0}")]
    Qdrant(#[from] anyhow::Error),

    #[error("Embedding error: {0}")]
    Embedding(String),

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("Budget exceeded: {0}")]
    BudgetExceeded(String),

    #[error("Rate limit exceeded: {0}")]
    RateLimitExceeded(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Unavailable: {0}")]
    Unavailable(String),

    #[error(transparent)]
    SkillNotProvisioned(#[from] SurfaceSkillNotProvisioned),
}

impl AppError {
    /// Missing catalog setup is unavailable, while other agent validation
    /// failures retain their existing bad-request behavior.
    pub fn from_agent_resolution(error: anyhow::Error) -> Self {
        match error.downcast::<SurfaceSkillNotProvisioned>() {
            Ok(error) => Self::SkillNotProvisioned(error),
            Err(error) => Self::BadRequest(error.to_string()),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let (status, message) = match &self {
            AppError::NotFound(m) => (StatusCode::NOT_FOUND, m.clone()),
            AppError::BadRequest(m) => (StatusCode::BAD_REQUEST, m.clone()),
            AppError::Forbidden(m) => (StatusCode::FORBIDDEN, m.clone()),
            AppError::BudgetExceeded(m) => (StatusCode::PAYMENT_REQUIRED, m.clone()),
            AppError::RateLimitExceeded(m) => (StatusCode::TOO_MANY_REQUESTS, m.clone()),
            AppError::Qdrant(e) => (StatusCode::BAD_GATEWAY, e.to_string()),
            AppError::Embedding(m) => (StatusCode::BAD_GATEWAY, m.clone()),
            AppError::Internal(m) => (StatusCode::INTERNAL_SERVER_ERROR, m.clone()),
            AppError::Unavailable(m) => (StatusCode::SERVICE_UNAVAILABLE, m.clone()),
            AppError::SkillNotProvisioned(error) => {
                (StatusCode::SERVICE_UNAVAILABLE, error.to_string())
            }
        };

        tracing::error!("Request error: {}", message);
        let mut body = json!({ "error": message });
        if let Self::SkillNotProvisioned(error) = self {
            body["code"] = json!("ai_surface_skill_not_provisioned");
            body["skill_key"] = json!(error.skill_key);
            body["recovery_path"] = json!("/ai-skills");
        }
        (status, Json(body)).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;

impl From<lumiere_auth_context::ActorContextError> for AppError {
    fn from(error: lumiere_auth_context::ActorContextError) -> Self {
        Self::Forbidden(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn missing_surface_returns_actionable_service_unavailable() {
        let error = anyhow::Error::new(SurfaceSkillNotProvisioned {
            skill_key: "rag_generation".into(),
        })
        .context("resolve chat agent");
        let response = AppError::from_agent_resolution(error).into_response();

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["code"], "ai_surface_skill_not_provisioned");
        assert_eq!(body["skill_key"], "rag_generation");
        assert_eq!(body["recovery_path"], "/ai-skills");
        assert!(body["error"]
            .as_str()
            .unwrap()
            .contains("Set up AI features"));
    }

    #[test]
    fn other_agent_errors_keep_existing_bad_request_status() {
        let error = AppError::from_agent_resolution(anyhow::anyhow!(
            "AI surface is disabled for this company"
        ));
        assert_eq!(error.into_response().status(), StatusCode::BAD_REQUEST);
    }
}
