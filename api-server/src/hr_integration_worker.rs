//! Polls pending HR integration intents (STP / eSocial / CPF / SARS / bank / partner payroll) and applies them.
//!
//! Workers perform external HTTP/file exchange outside WASM; this service only flushes pending
//! intents via `apply_pending_hr_integration_intents` (payload must contain worker-prepared results).
//!
//! Configure with:
//! - `LUMIERE_HR_WORKER_ORG_IDS` — comma-separated organization ids (required)
//! - `LUMIERE_HR_WORKER_POLL_SECS` — poll interval (default 15)
//! - `LUMIERE_HR_WORKER_PORT` — health port (default 8094)
//! - `LUMIERE_HR_WORKER_BATCH` — max intents per org per tick (default 20)

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

/// Start a bounded polling worker and its internal health endpoint.
pub async fn serve() -> anyhow::Result<()> {
    let config = Config::from_env()?;
    let port = std::env::var("LUMIERE_HR_WORKER_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8094u16);
    let poll_secs = std::env::var("LUMIERE_HR_WORKER_POLL_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(15u64);
    let batch = std::env::var("LUMIERE_HR_WORKER_BATCH")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(20u32);
    let org_ids = std::env::var("LUMIERE_HR_WORKER_ORG_IDS")
        .unwrap_or_default()
        .split(',')
        .filter_map(|s| s.trim().parse::<u64>().ok())
        .collect::<Vec<_>>();

    let state = Arc::new(AppState::new(config));
    let ready = Arc::new(AtomicBool::new(!org_ids.is_empty()));
    let worker_state = state.clone();
    let worker_ready = ready.clone();
    let orgs = org_ids.clone();
    tokio::spawn(async move {
        if orgs.is_empty() {
            tracing::warn!("hr integration worker idle: set LUMIERE_HR_WORKER_ORG_IDS");
            return;
        }
        loop {
            match process_batch(&worker_state, &orgs, batch).await {
                Ok(_) => worker_ready.store(true, Ordering::Relaxed),
                Err(error) => {
                    worker_ready.store(false, Ordering::Relaxed);
                    tracing::error!(%error, "hr integration worker batch failed");
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
                async move {
                    if ready.load(Ordering::Relaxed) {
                        StatusCode::OK
                    } else {
                        StatusCode::SERVICE_UNAVAILABLE
                    }
                }
            }),
        );
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port))).await?;
    tracing::info!(port, "hr integration worker listening");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn process_batch(state: &AppState, org_ids: &[u64], batch: u32) -> anyhow::Result<()> {
    for organization_id in org_ids {
        state
            .stdb
            .call_reducer(stdb_client::reducer_call!(
                "apply_pending_hr_integration_intents",
                json!([organization_id, batch]),
            ))
            .await?;
    }
    Ok(())
}
