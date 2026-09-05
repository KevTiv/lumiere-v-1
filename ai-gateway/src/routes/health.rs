use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde_json::{json, Value};
use std::future::Future;
use std::time::Duration;

use crate::state::AppState;

pub async fn health() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "service": "lumiere-ai-gateway",
    }))
}

/// Report readiness of the non-generative runtime dependencies.
///
/// This intentionally performs only bounded, read-only probes. It never calls
/// an LLM or embedding provider, so health checks cannot incur model charges.
pub async fn health_ready(State(state): State<AppState>) -> impl IntoResponse {
    match bounded_readiness(Duration::from_secs(3), dependency_probe(&state)).await {
        Ok(()) => readiness_response(true),
        Err(error) => {
            tracing::warn!(%error, "AI gateway readiness check failed");
            readiness_response(false)
        }
    }
}

async fn dependency_probe(state: &AppState) -> anyhow::Result<()> {
    state
        .stdb
        .query_sql("SELECT 1")
        .await
        .map_err(|error| anyhow::anyhow!("SpacetimeDB readiness probe failed: {error}"))?;
    state.vector_store.check_ready().await?;
    crate::providers::check_readiness(&state.config, &state.http).await?;
    Ok(())
}

async fn bounded_readiness(
    timeout: Duration,
    probe: impl Future<Output = anyhow::Result<()>>,
) -> anyhow::Result<()> {
    tokio::time::timeout(timeout, probe)
        .await
        .map_err(|_| anyhow::anyhow!("AI gateway readiness probe timed out"))?
}

fn readiness_response(ready: bool) -> (StatusCode, Json<Value>) {
    if ready {
        (
            StatusCode::OK,
            Json(json!({"status": "ready", "service": "lumiere-ai-gateway"})),
        )
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"status": "not_ready", "service": "lumiere-ai-gateway"})),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn health_returns_ok_payload() {
        let Json(body) = health().await;
        assert_eq!(body["status"], "ok");
        assert_eq!(body["service"], "lumiere-ai-gateway");
    }

    #[test]
    fn readiness_response_redacts_dependency_details() {
        let (status, Json(body)) = readiness_response(false);
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            body,
            json!({
                "status": "not_ready",
                "service": "lumiere-ai-gateway"
            })
        );
        assert!(!body.to_string().contains("Qdrant"));
    }

    #[test]
    fn readiness_response_is_ok_only_when_ready() {
        let (status, Json(body)) = readiness_response(true);
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["status"], "ready");
    }

    #[tokio::test]
    async fn readiness_probe_preserves_failure_and_bounds_waiting() {
        let failure = bounded_readiness(Duration::from_secs(1), async {
            anyhow::bail!("dependency unavailable")
        })
        .await
        .unwrap_err();
        assert_eq!(failure.to_string(), "dependency unavailable");

        let timeout = bounded_readiness(
            Duration::from_millis(1),
            std::future::pending::<anyhow::Result<()>>(),
        )
        .await
        .unwrap_err();
        assert!(timeout.to_string().contains("timed out"));
    }
}
