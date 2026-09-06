//! Bounded workflow delivery worker: timers always, external outbox optional.
//!
//! Cycle: heartbeat → reclaim expired leases → fire due timers → (if enabled)
//! claim `workflow-external` jobs → adapter → `record_workflow_outbox_result` →
//! `complete_queue_job`.
//!
//! External dispatch defaults **off** (`LUMIERE_WORKFLOW_EXTERNAL_DISPATCH_ENABLED`).
//! When on, optional company/action allowlists and `LUMIERE_WORKFLOW_EXTERNAL_WEBHOOK_URL`
//! gate real HTTP delivery (fail-closed action allowlist when webhook is set).

mod adapter;
mod outbox;
#[cfg(test)]
mod tests;
mod timers;

use self::{outbox::dispatch_external_jobs, timers::fire_due_timers};
use crate::{config::Config, state::AppState};
use axum::{http::StatusCode, routing::get, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    net::SocketAddr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
const QUEUE_NAME: &str = "workflow-external";
const JOB_TYPE: &str = "workflow.external_action";
const BATCH_SIZE: usize = 20;

#[derive(Debug, Deserialize)]
struct WorkerRow {
    id: u64,
}

/// Start the polling worker and its internal health endpoint.
pub async fn serve() -> anyhow::Result<()> {
    let config = Config::from_env()?;
    let port = config.workflow_worker_port;
    let state = Arc::new(AppState::new(config));
    let ready = Arc::new(AtomicBool::new(false));
    let shutting_down = Arc::new(AtomicBool::new(false));
    let worker_state = state.clone();
    let worker_ready = ready.clone();
    let worker_shutdown = shutting_down.clone();
    tokio::spawn(async move {
        loop {
            if worker_shutdown.load(Ordering::Relaxed) {
                break;
            }
            match process_cycle(&worker_state, &worker_shutdown).await {
                Ok(_) => worker_ready.store(true, Ordering::Relaxed),
                Err(error) => {
                    worker_ready.store(false, Ordering::Relaxed);
                    tracing::error!(%error, "workflow worker cycle failed");
                }
            }
            tokio::time::sleep(Duration::from_secs(
                worker_state.config.workflow_worker_poll_secs,
            ))
            .await;
        }
    });

    let app = Router::new()
        .route("/health", get(|| async { StatusCode::OK }))
        .route(
            "/health/ready",
            get({
                let ready = ready.clone();
                move || {
                    let ready = ready.clone();
                    async move {
                        if ready.load(Ordering::Relaxed) {
                            StatusCode::OK
                        } else {
                            StatusCode::SERVICE_UNAVAILABLE
                        }
                    }
                }
            }),
        );
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port))).await?;
    tracing::info!(
        port,
        dispatch_enabled = state.config.workflow_external_dispatch_enabled,
        "workflow worker listening"
    );
    axum::serve(listener, app).await?;
    shutting_down.store(true, Ordering::Relaxed);
    Ok(())
}

async fn process_cycle(state: &AppState, shutting_down: &AtomicBool) -> anyhow::Result<()> {
    let org_ids = resolve_org_ids(state).await?;
    if org_ids.is_empty() {
        tracing::debug!("workflow worker: no organizations to scan");
        return Ok(());
    }
    for organization_id in org_ids {
        if shutting_down.load(Ordering::Relaxed) {
            break;
        }
        let worker_id = ensure_worker_registration(state, organization_id).await?;
        fire_due_timers(state, organization_id).await?;
        if state.config.workflow_external_dispatch_enabled {
            dispatch_external_jobs(state, organization_id, worker_id, shutting_down).await?;
        }
    }
    Ok(())
}

async fn resolve_org_ids(state: &AppState) -> anyhow::Result<Vec<u64>> {
    if !state.config.workflow_worker_org_ids.is_empty() {
        return Ok(state.config.workflow_worker_org_ids.clone());
    }
    let rows = state
        .stdb
        .query_sql(
            "SELECT DISTINCT organization_id FROM workflow_timer WHERE status = 'Pending' LIMIT 100",
        )
        .await
        .unwrap_or_default();
    let mut ids = Vec::new();
    for row in rows {
        if let Some(id) = u64_field(&row, "organizationId", "organization_id") {
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
    }
    Ok(ids)
}

async fn ensure_worker_registration(state: &AppState, organization_id: u64) -> anyhow::Result<u64> {
    let name = state.config.workflow_worker_name.replace('\'', "''");
    let rows = state
        .stdb
        .query_sql(&format!(
            "SELECT id FROM queue_worker WHERE organization_id = {organization_id} \
             AND name = '{name}' AND is_active = true LIMIT 1"
        ))
        .await?;
    if let Some(row) = rows.into_iter().next() {
        let worker: WorkerRow = serde_json::from_value(row)?;
        let _ = state
            .stdb
            .call_reducer(stdb_client::reducer_call!(
                "worker_heartbeat",
                json!([organization_id, worker.id])
            ))
            .await;
        return Ok(worker.id);
    }
    state
        .stdb
        .call_reducer(stdb_client::reducer_call!(
            "register_queue_worker",
            json!([
                organization_id,
                {
                    "companyId": null,
                    "name": state.config.workflow_worker_name,
                    "queues": [QUEUE_NAME],
                    "metadata": serde_json::json!({ "service": "workflow-worker" }).to_string(),
                }
            ]),
        ))
        .await?;
    let rows = state
        .stdb
        .query_sql(&format!(
            "SELECT id FROM queue_worker WHERE organization_id = {organization_id} \
             AND name = '{name}' AND is_active = true LIMIT 1"
        ))
        .await?;
    let worker: WorkerRow = serde_json::from_value(
        rows.into_iter()
            .next()
            .ok_or_else(|| anyhow::anyhow!("workflow worker registration missing"))?,
    )?;
    Ok(worker.id)
}

fn now_micros() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_micros() as u64
}

fn u64_field(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(|v| v.as_u64())
}
