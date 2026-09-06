//! Health and metrics handlers.

use crate::metrics;
use crate::state::AppState;
use axum::{extract::State, http::StatusCode};
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

const AI_GATEWAY_READINESS_TIMEOUT: Duration = Duration::from_secs(2);
const STDB_READINESS_TIMEOUT: Duration = Duration::from_secs(3);

pub(crate) async fn health() -> StatusCode {
    StatusCode::OK
}

pub(crate) async fn health_ready(
    State(state): State<Arc<AppState>>,
) -> Result<StatusCode, StatusCode> {
    let token = state
        .config
        .stdb_server_token
        .as_deref()
        .filter(|t| !t.is_empty())
        .unwrap_or("");
    let client = state.client_with_token(token);
    let postgres = async {
        crate::cold_tier::pg_pool::check_ready()
            .await
            .map_err(|error| anyhow::anyhow!("PostgreSQL readiness failed: {error}"))
    };
    let spacetime = check_stdb_ready(&client, STDB_READINESS_TIMEOUT);
    let ai_gateway = async {
        if state.config.ai_gateway_required {
            check_ai_gateway_ready(
                &state.http,
                &state.config.ai_gateway_url,
                AI_GATEWAY_READINESS_TIMEOUT,
            )
            .await?;
        }
        Ok::<(), anyhow::Error>(())
    };

    if let Err(error) = tokio::try_join!(postgres, spacetime, ai_gateway) {
        tracing::warn!(%error, "api-server readiness probe failed");
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }
    Ok(StatusCode::OK)
}

fn ai_gateway_readiness_url(base_url: &str) -> String {
    format!("{}/health/ready", base_url.trim_end_matches('/'))
}

async fn check_stdb_ready(
    client: &stdb_client::StdbClient,
    timeout: Duration,
) -> anyhow::Result<()> {
    bounded_probe(timeout, client.query_sql("SELECT 1"))
        .await
        .map_err(|_| anyhow::anyhow!("SpacetimeDB readiness probe timed out"))??;
    Ok(())
}

async fn check_ai_gateway_ready(
    client: &reqwest::Client,
    base_url: &str,
    timeout: Duration,
) -> anyhow::Result<()> {
    let response = bounded_probe(
        timeout,
        client.get(ai_gateway_readiness_url(base_url)).send(),
    )
    .await
    .map_err(|_| anyhow::anyhow!("AI gateway readiness probe timed out"))??;
    ensure_success_status(response.status())
        .map_err(|status| anyhow::anyhow!("AI gateway readiness returned {status}"))?;
    Ok(())
}

fn ensure_success_status(status: reqwest::StatusCode) -> Result<(), reqwest::StatusCode> {
    status.is_success().then_some(()).ok_or(status)
}

async fn bounded_probe<T>(
    timeout: Duration,
    probe: impl Future<Output = T>,
) -> Result<T, tokio::time::error::Elapsed> {
    tokio::time::timeout(timeout, probe).await
}

pub(crate) async fn metrics_handler() -> (StatusCode, String) {
    (StatusCode::OK, metrics::render_prometheus())
}

#[cfg(test)]
mod tests {
    use super::{ai_gateway_readiness_url, bounded_probe, ensure_success_status};
    use std::time::Duration;

    #[test]
    fn readiness_probe_uses_gateway_ready_endpoint() {
        assert_eq!(
            ai_gateway_readiness_url("http://gateway///"),
            "http://gateway/health/ready"
        );
    }

    #[test]
    fn readiness_probe_rejects_non_success_status() {
        assert!(ensure_success_status(reqwest::StatusCode::OK).is_ok());
        assert_eq!(
            ensure_success_status(reqwest::StatusCode::SERVICE_UNAVAILABLE),
            Err(reqwest::StatusCode::SERVICE_UNAVAILABLE)
        );
    }

    #[tokio::test]
    async fn readiness_probe_is_bounded() {
        let error = bounded_probe(Duration::from_millis(1), std::future::pending::<()>())
            .await
            .unwrap_err();
        let _: tokio::time::error::Elapsed = error;
    }
}
