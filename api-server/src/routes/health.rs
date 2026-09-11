//! Health and metrics handlers.

use crate::metrics;
use crate::state::AppState;
use axum::{
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode},
};
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

const STDB_READINESS_TIMEOUT: Duration = Duration::from_secs(3);

pub(crate) async fn health() -> StatusCode {
    StatusCode::OK
}

pub(crate) async fn health_ready(
    State(state): State<Arc<AppState>>,
) -> Result<(StatusCode, HeaderMap), StatusCode> {
    let token = state
        .config
        .stdb_server_token
        .as_deref()
        .filter(|t| !t.is_empty())
        .unwrap_or("");
    let client = state.client_with_token(token);
    let spacetime = check_stdb_ready(&client, STDB_READINESS_TIMEOUT);
    // AI is an optional capability. Its outage must not remove ordinary ERP
    // traffic from service; AI diagnostics belong on a separate probe.
    let postgres = async {
        crate::cold_tier::pg_pool::check_ready_with_grace(Duration::from_secs(
            state.config.projection_lag_budget_secs,
        ))
        .await
        .map(|degraded| {
            if degraded {
                tracing::warn!("api-server readiness is degraded by PostgreSQL outage");
            }
            degraded
        })
        .map_err(|error| anyhow::anyhow!("PostgreSQL readiness failed: {error}"))
    };
    let (postgres_degraded, _) = tokio::try_join!(postgres, spacetime).map_err(|error| {
        tracing::warn!(%error, "api-server readiness probe failed");
        StatusCode::SERVICE_UNAVAILABLE
    })?;
    Ok((StatusCode::OK, readiness_headers(postgres_degraded)))
}

fn readiness_headers(postgres_degraded: bool) -> HeaderMap {
    let mut headers = HeaderMap::new();
    if postgres_degraded {
        headers.insert("x-lumiere-degraded", HeaderValue::from_static("postgres"));
    }
    headers
}

async fn check_stdb_ready(
    client: &stdb_client::StdbClient,
    timeout: Duration,
) -> anyhow::Result<()> {
    // SpacetimeDB 2.8 does not support scalar projection expressions such as
    // `SELECT 1`. Probe the published module through a bounded primary-key
    // miss instead; this validates module SQL without materializing rows.
    bounded_probe(
        timeout,
        client.query_sql("SELECT * FROM organization WHERE id = 0"),
    )
    .await
    .map_err(|_| anyhow::anyhow!("SpacetimeDB readiness probe timed out"))??;
    Ok(())
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
    use super::{bounded_probe, check_stdb_ready, readiness_headers};
    use axum::http::header::HeaderName;
    use std::time::Duration;

    #[tokio::test]
    async fn readiness_probe_is_bounded() {
        let error = bounded_probe(Duration::from_millis(1), std::future::pending::<()>())
            .await
            .unwrap_err();
        let _: tokio::time::error::Elapsed = error;
    }

    #[tokio::test]
    async fn stdb_unavailable_readiness_fails_closed() {
        let client = stdb_client::StdbClient::new(
            "not-a-url".into(),
            "missing-module".into(),
            "token".into(),
        );
        assert!(check_stdb_ready(&client, Duration::from_millis(100))
            .await
            .is_err());
    }

    #[test]
    fn readiness_exposes_bounded_postgres_degradation() {
        let headers = readiness_headers(true);
        assert_eq!(
            headers.get(HeaderName::from_static("x-lumiere-degraded")),
            Some(&axum::http::HeaderValue::from_static("postgres"))
        );
        assert!(readiness_headers(false).is_empty());
    }
}
