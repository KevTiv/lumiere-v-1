//! Shared serve/poll/readiness lifecycle for the expense, HR, and project integration workers.
//!
//! Each domain worker supplies an [`IntegrationWorkerSpec`] with its env-var prefix,
//! default health port, canonical reducer name, and log label. This module owns the
//! common lifecycle: env-var parsing, AppState setup, the bounded poll loop, health
//! routes, and the TCP listener. Domain-specific reducer dispatch stays explicit in
//! the spec — this module does not absorb workflow outbox or projection workers.

use std::{
    net::SocketAddr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use axum::{http::StatusCode, routing::get, Router};
use serde_json::json;

use crate::{config::Config, state::AppState};

/// Configuration for a domain integration worker.
pub struct IntegrationWorkerSpec {
    /// Env-var prefix, e.g. `"EXPENSE"`, `"HR"`, `"PROJECT"`.
    pub env_prefix: &'static str,
    /// Default health-check port if the env var is unset.
    pub default_port: u16,
    /// Canonical reducer name, e.g. `"apply_pending_expense_integration_intents"`.
    pub reducer_name: &'static str,
    /// Human-readable label used in tracing output.
    pub log_label: &'static str,
}

/// Start a bounded polling worker and its internal health endpoint.
pub async fn serve(spec: IntegrationWorkerSpec) -> anyhow::Result<()> {
    let config = Config::from_env()?;
    let port = std::env::var(format!("LUMIERE_{}_WORKER_PORT", spec.env_prefix))
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(spec.default_port);
    let poll_secs = std::env::var(format!("LUMIERE_{}_WORKER_POLL_SECS", spec.env_prefix))
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(15u64);
    let batch = std::env::var(format!("LUMIERE_{}_WORKER_BATCH", spec.env_prefix))
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(20u32);
    let org_ids = std::env::var(format!("LUMIERE_{}_WORKER_ORG_IDS", spec.env_prefix))
        .unwrap_or_default()
        .split(',')
        .filter_map(|s| s.trim().parse::<u64>().ok())
        .collect::<Vec<_>>();

    let state = Arc::new(AppState::new(config));
    // Configuration alone does not prove that the SpacetimeDB dependency and
    // reducer are reachable. Readiness becomes true only after one successful
    // batch, matching the other API-server workers.
    let ready = Arc::new(AtomicBool::new(false));
    let worker_state = state.clone();
    let worker_ready = ready.clone();
    let orgs = org_ids.clone();
    let reducer_name = spec.reducer_name;
    let log_label = spec.log_label;
    let env_prefix = spec.env_prefix;
    tokio::spawn(async move {
        if orgs.is_empty() {
            tracing::warn!("{log_label} idle: set LUMIERE_{env_prefix}_WORKER_ORG_IDS");
            return;
        }
        loop {
            match process_batch(&worker_state, &orgs, batch, reducer_name).await {
                Ok(_) => worker_ready.store(true, Ordering::Relaxed),
                Err(error) => {
                    worker_ready.store(false, Ordering::Relaxed);
                    tracing::error!(%error, "{log_label} batch failed");
                }
            }
            tokio::time::sleep(Duration::from_secs(poll_secs)).await;
        }
    });

    let app = Router::new()
        .route("/health", get(|| async { StatusCode::OK }))
        .route(
            "/health/ready",
            get(move || {
                let ready = ready.clone();
                async move { readiness_status(ready.load(Ordering::Relaxed)) }
            }),
        );
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port))).await?;
    tracing::info!(port, "{log_label} listening");
    axum::serve(listener, app).await?;
    Ok(())
}

fn readiness_status(ready: bool) -> StatusCode {
    if ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
}

async fn process_batch(
    state: &AppState,
    org_ids: &[u64],
    batch: u32,
    reducer_name: &str,
) -> anyhow::Result<()> {
    for organization_id in org_ids {
        state
            .stdb
            .call_reducer(stdb_client::ReducerCall::from_name(
                reducer_name,
                json!([organization_id, batch]),
            ))
            .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::readiness_status;
    use axum::http::StatusCode;

    #[test]
    fn integration_worker_is_unready_until_a_batch_succeeds() {
        assert_eq!(readiness_status(false), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(readiness_status(true), StatusCode::OK);
    }
}
