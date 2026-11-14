use axum::{http::StatusCode, response::IntoResponse, Json};
use serde_json::json;
use thiserror::Error;

#[derive(Error, Debug)]
#[error("AI skill '{skill_key}' is not provisioned. An administrator can open AI Skills and select Set up AI features to register missing built-in skills.")]
pub struct SurfaceSkillNotProvisioned {
    pub skill_key: String,
}

/// Managed setup has not installed a usable default for this request scope.
#[derive(Error, Debug)]
#[error("AI setup is incomplete. Ask an administrator to apply the harness AI profile for this company.")]
pub struct DefaultAgentNotProvisioned;

/// Keep internal catalog and binding errors out of the public response.
#[derive(Error, Debug, Clone)]
#[error("This AI skill is currently unavailable for the selected company.")]
pub struct SkillUnavailable;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("This question and its context exceed the Assistant input limit. Shorten the question or remove references and try again.")]
    ChatInputTooLarge,

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

    /// Static guidance only: provider failures must never enter the public body.
    #[error("AI retrieval is unavailable and no authorized grounding was found. A platform administrator needs to check this company's AI service. You can instead open a permitted record or provide authorized live context before asking again.")]
    RetrievalUnavailable,

    #[error(transparent)]
    SkillNotProvisioned(#[from] SurfaceSkillNotProvisioned),

    #[error(transparent)]
    DefaultAgentNotProvisioned(#[from] DefaultAgentNotProvisioned),

    #[error(transparent)]
    SkillUnavailable(#[from] SkillUnavailable),
}

impl AppError {
    /// Preserve skill availability failures during execution.
    pub fn from_generation(error: anyhow::Error) -> Self {
        if error.is::<SkillUnavailable>() {
            Self::from_agent_resolution(error)
        } else {
            Self::Internal(error.to_string())
        }
    }

    /// Missing catalog setup is unavailable, while other agent validation
    /// failures retain their existing bad-request behavior.
    pub fn from_agent_resolution(error: anyhow::Error) -> Self {
        if error.is::<SkillUnavailable>() {
            return Self::SkillUnavailable(SkillUnavailable);
        }
        match error.downcast::<SurfaceSkillNotProvisioned>() {
            Ok(error) => Self::SkillNotProvisioned(error),
            Err(error) => match error.downcast::<DefaultAgentNotProvisioned>() {
                Ok(error) => Self::DefaultAgentNotProvisioned(error),
                Err(error) => Self::BadRequest(error.to_string()),
            },
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let (status, message) = match &self {
            AppError::NotFound(m) => (StatusCode::NOT_FOUND, m.clone()),
            AppError::BadRequest(m) => (StatusCode::BAD_REQUEST, m.clone()),
            AppError::ChatInputTooLarge => (StatusCode::PAYLOAD_TOO_LARGE, self.to_string()),
            AppError::Forbidden(m) => (StatusCode::FORBIDDEN, m.clone()),
            AppError::BudgetExceeded(m) => (StatusCode::PAYMENT_REQUIRED, m.clone()),
            AppError::RateLimitExceeded(m) => (StatusCode::TOO_MANY_REQUESTS, m.clone()),
            AppError::Qdrant(e) => (StatusCode::BAD_GATEWAY, e.to_string()),
            AppError::Embedding(m) => (StatusCode::BAD_GATEWAY, m.clone()),
            AppError::Internal(m) => (StatusCode::INTERNAL_SERVER_ERROR, m.clone()),
            AppError::Unavailable(m) => (StatusCode::SERVICE_UNAVAILABLE, m.clone()),
            AppError::RetrievalUnavailable => (StatusCode::SERVICE_UNAVAILABLE, self.to_string()),
            AppError::SkillUnavailable(_) => (StatusCode::SERVICE_UNAVAILABLE, self.to_string()),
            AppError::DefaultAgentNotProvisioned(error) => {
                (StatusCode::SERVICE_UNAVAILABLE, error.to_string())
            }
            AppError::SkillNotProvisioned(error) => {
                (StatusCode::SERVICE_UNAVAILABLE, error.to_string())
            }
        };

        tracing::error!("Request error: {}", message);
        let mut body = json!({ "error": message });
        if matches!(&self, Self::ChatInputTooLarge) {
            body["code"] = json!("ai_chat_input_too_large");
        }
        if matches!(&self, Self::SkillUnavailable(_)) {
            body["code"] = json!("ai_skill_unavailable");
        }
        if matches!(&self, Self::RetrievalUnavailable) {
            body["code"] = json!("ai_retrieval_unavailable");
        }
        if matches!(&self, Self::DefaultAgentNotProvisioned(_)) {
            body["code"] = json!("ai_default_agent_not_provisioned");
            body["recovery_path"] = json!("/ai-skills");
        }
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
    async fn skill_unavailable_is_typed_and_sanitized() {
        for during_generation in [false, true] {
            let error = anyhow::Error::new(SkillUnavailable).context("private SQL detail");
            let response = if during_generation {
                AppError::from_generation(error)
            } else {
                AppError::from_agent_resolution(error)
            }
            .into_response();
            assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
            let body = axum::body::to_bytes(response.into_body(), 4096)
                .await
                .unwrap();
            let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(body["code"], "ai_skill_unavailable");
            assert_eq!(body["error"], SkillUnavailable.to_string());
            assert!(body["error"].as_str().unwrap().contains("selected company"));
            assert!(!body.to_string().contains("private SQL"));
            assert!(body.get("recovery_path").is_none());
        }
    }

    #[tokio::test]
    async fn retrieval_unavailable_returns_static_safe_recovery() {
        let response = AppError::RetrievalUnavailable.into_response();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["code"], "ai_retrieval_unavailable");
        assert!(body.get("recovery_path").is_none());
        assert_eq!(body["error"], AppError::RetrievalUnavailable.to_string());
        assert!(body["error"].as_str().unwrap().contains("administrator"));
        assert!(body["error"].as_str().unwrap().contains("permitted record"));
        assert!(!body["error"].as_str().unwrap().contains("Retry"));
    }

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

    #[tokio::test]
    async fn missing_default_returns_structured_setup_error() {
        let error = anyhow::Error::new(DefaultAgentNotProvisioned).context("resolve surface");
        let response = AppError::from_agent_resolution(error).into_response();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["code"], "ai_default_agent_not_provisioned");
        assert_eq!(body["recovery_path"], "/ai-skills");
    }

    #[test]
    fn other_agent_errors_keep_existing_bad_request_status() {
        let error = AppError::from_agent_resolution(anyhow::anyhow!(
            "AI surface is disabled for this company"
        ));
        assert_eq!(error.into_response().status(), StatusCode::BAD_REQUEST);
    }
}
