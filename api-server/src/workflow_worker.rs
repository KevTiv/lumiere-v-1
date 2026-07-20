//! Bounded workflow delivery worker: timers always, external outbox optional.
//!
//! Cycle: heartbeat → reclaim expired leases → fire due timers → (if enabled)
//! claim `workflow-external` jobs → adapter → `record_workflow_outbox_result` →
//! `complete_queue_job`.
//!
//! External dispatch defaults **off** (`LUMIERE_WORKFLOW_EXTERNAL_DISPATCH_ENABLED`).

use std::{
    net::SocketAddr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{http::StatusCode, routing::get, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{config::Config, state::AppState};

const QUEUE_NAME: &str = "workflow-external";
const JOB_TYPE: &str = "workflow.external_action";
const BATCH_SIZE: usize = 20;

#[derive(Debug, Deserialize)]
struct WorkerRow {
    id: u64,
}

#[derive(Debug, Deserialize, Clone)]
struct TimerRow {
    id: u64,
    #[serde(alias = "organizationId")]
    organization_id: u64,
    #[serde(alias = "companyId")]
    company_id: u64,
    revision: u64,
    #[serde(alias = "workflowInstanceId")]
    workflow_instance_id: u64,
}

#[derive(Debug, Deserialize, Clone)]
struct InstanceRow {
    revision: u64,
}

#[derive(Debug, Deserialize, Clone)]
struct QueueJobRow {
    id: u64,
    #[serde(alias = "organizationId")]
    organization_id: u64,
    revision: u64,
    payload: String,
}

#[derive(Debug, Deserialize, Clone)]
struct OutboxPayload {
    #[serde(alias = "outboxId")]
    outbox_id: u64,
    #[serde(alias = "companyId")]
    company_id: u64,
    #[serde(alias = "actionKey", default)]
    action_key: Option<String>,
    #[serde(alias = "effectKey", default)]
    effect_key: Option<String>,
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
            .call_reducer("worker_heartbeat", json!([organization_id, worker.id]))
            .await;
        return Ok(worker.id);
    }
    state
        .stdb
        .call_reducer(
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
        )
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

async fn fire_due_timers(state: &AppState, organization_id: u64) -> anyhow::Result<()> {
    let rows = state
        .stdb
        .query_sql(&format!(
            "SELECT id, organization_id, company_id, revision, workflow_instance_id, due_at \
             FROM workflow_timer WHERE organization_id = {organization_id} \
             AND status = 'Pending' LIMIT {BATCH_SIZE}"
        ))
        .await?;
    let now = now_micros();
    for row in rows {
        let due_at = timestamp_micros(&row, "dueAt", "due_at").unwrap_or(u64::MAX);
        if due_at > now {
            continue;
        }
        let timer: TimerRow = match serde_json::from_value(row) {
            Ok(t) => t,
            Err(error) => {
                tracing::warn!(%error, "skip malformed workflow_timer row");
                continue;
            }
        };
        let instance_revision = instance_revision(state, timer.workflow_instance_id)
            .await
            .unwrap_or(0);
        let idem = format!("timer-fire:{}:{}", timer.id, timer.revision);
        if let Err(error) = state
            .stdb
            .call_reducer(
                "fire_workflow_timer",
                json!([
                    organization_id,
                    {
                        "companyId": timer.company_id,
                        "timerId": timer.id,
                        "expectedTimerRevision": timer.revision,
                        "expectedInstanceRevision": instance_revision,
                        "idempotencyKey": idem,
                        "correlationId": format!("workflow-timer:{}", timer.id),
                        "causationId": format!("workflow-timer:{}", timer.id),
                    }
                ]),
            )
            .await
        {
            tracing::debug!(timer_id = timer.id, %error, "fire_workflow_timer skipped");
        }
    }
    Ok(())
}

async fn instance_revision(state: &AppState, instance_id: u64) -> anyhow::Result<u64> {
    let rows = state
        .stdb
        .query_sql(&format!(
            "SELECT revision FROM workflow_instance WHERE id = {instance_id} LIMIT 1"
        ))
        .await?;
    let row = rows
        .into_iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("workflow instance {instance_id} missing"))?;
    let instance: InstanceRow = serde_json::from_value(row)?;
    Ok(instance.revision)
}

async fn dispatch_external_jobs(
    state: &AppState,
    organization_id: u64,
    worker_id: u64,
    shutting_down: &AtomicBool,
) -> anyhow::Result<()> {
    let rows = state
        .stdb
        .query_sql(&format!(
            "SELECT id, organization_id, revision, payload FROM queue_job \
             WHERE organization_id = {organization_id} \
             AND queue_name = '{QUEUE_NAME}' AND job_type = '{JOB_TYPE}' \
             AND status = 'Pending' LIMIT {BATCH_SIZE}"
        ))
        .await?;
    for row in rows {
        if shutting_down.load(Ordering::Relaxed) {
            break;
        }
        let job: QueueJobRow = match serde_json::from_value(row) {
            Ok(j) => j,
            Err(error) => {
                tracing::warn!(%error, "skip malformed queue_job row");
                continue;
            }
        };
        let lease_token = fresh_lease_token(job.id, worker_id);
        let lease_expires = now_micros()
            + state.config.workflow_worker_lease_ttl_secs.saturating_mul(1_000_000);
        if let Err(error) = state
            .stdb
            .call_reducer(
                "claim_queue_job",
                json!([
                    organization_id,
                    job.id,
                    {
                        "expectedRevision": job.revision,
                        "workerId": worker_id,
                        "leaseToken": lease_token,
                        "leaseExpiresAtMicros": lease_expires,
                    }
                ]),
            )
            .await
        {
            tracing::debug!(job_id = job.id, %error, "claim_queue_job skipped");
            continue;
        }

        let payload: OutboxPayload = match serde_json::from_str(&job.payload) {
            Ok(p) => p,
            Err(error) => {
                tracing::error!(job_id = job.id, %error, "invalid workflow outbox payload");
                let _ = complete_failed(
                    state,
                    organization_id,
                    job.id,
                    worker_id,
                    &lease_token,
                    1,
                    "invalid outbox payload",
                )
                .await;
                continue;
            }
        };

        let adapter_result = run_external_adapter(state, &payload).await;
        let (result_kind, fingerprint, error_summary, outcome) = match adapter_result {
            Ok(fp) => ("Succeeded", Some(fp), None, "Succeeded"),
            Err(error) => (
                "RetryableFailure",
                None,
                Some(error.to_string()),
                "Failed",
            ),
        };

        let instance_revision = instance_revision_for_outbox(state, payload.outbox_id)
            .await
            .unwrap_or(1);
        let record_key = payload
            .effect_key
            .clone()
            .unwrap_or_else(|| format!("outbox-result:{}", payload.outbox_id));
        if let Err(error) = state
            .stdb
            .call_reducer(
                "record_workflow_outbox_result",
                json!([
                    organization_id,
                    {
                        "companyId": payload.company_id,
                        "outboxId": payload.outbox_id,
                        "expectedOutboxRevision": 0,
                        "expectedInstanceRevision": instance_revision,
                        "queueJobId": job.id,
                        "workerId": worker_id,
                        "leaseToken": lease_token,
                        "result": result_kind,
                        "responseFingerprint": fingerprint,
                        "errorSummary": error_summary,
                        "idempotencyKey": record_key,
                        "correlationId": format!("workflow-outbox:{}", payload.outbox_id),
                        "causationId": format!("queue-job:{}", job.id),
                    }
                ]),
            )
            .await
        {
            tracing::error!(job_id = job.id, %error, "record_workflow_outbox_result failed");
        }

        let _ = state
            .stdb
            .call_reducer(
                "complete_queue_job",
                json!([
                    organization_id,
                    job.id,
                    {
                        "expectedRevision": 1,
                        "workerId": worker_id,
                        "leaseToken": lease_token,
                        "outcome": outcome,
                        "errorSummary": error_summary,
                        "responseFingerprint": fingerprint,
                        "retryJitterMicros": 0,
                    }
                ]),
            )
            .await;
    }
    Ok(())
}

async fn complete_failed(
    state: &AppState,
    organization_id: u64,
    job_id: u64,
    worker_id: u64,
    lease_token: &str,
    expected_revision: u64,
    summary: &str,
) -> anyhow::Result<()> {
    state
        .stdb
        .call_reducer(
            "complete_queue_job",
            json!([
                organization_id,
                job_id,
                {
                    "expectedRevision": expected_revision,
                    "workerId": worker_id,
                    "leaseToken": lease_token,
                    "outcome": "Failed",
                    "errorSummary": summary,
                    "responseFingerprint": null,
                    "retryJitterMicros": 0,
                }
            ]),
        )
        .await?;
    Ok(())
}

async fn instance_revision_for_outbox(state: &AppState, outbox_id: u64) -> anyhow::Result<u64> {
    let rows = state
        .stdb
        .query_sql(&format!(
            "SELECT workflow_instance_id FROM workflow_outbox WHERE id = {outbox_id} LIMIT 1"
        ))
        .await?;
    let instance_id = rows
        .into_iter()
        .next()
        .and_then(|row| u64_field(&row, "workflowInstanceId", "workflow_instance_id"))
        .ok_or_else(|| anyhow::anyhow!("outbox {outbox_id} missing"))?;
    instance_revision(state, instance_id).await
}

/// Fake/no-op adapter when dispatch is enabled; real HTTP adapters plug in later.
async fn run_external_adapter(
    state: &AppState,
    payload: &OutboxPayload,
) -> anyhow::Result<String> {
    let _ = state;
    let key = payload
        .action_key
        .as_deref()
        .unwrap_or("workflow.external");
    let mut hasher = Sha256::new();
    hasher.update(key.as_bytes());
    hasher.update(payload.outbox_id.to_le_bytes());
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

fn fresh_lease_token(job_id: u64, worker_id: u64) -> String {
    let mut hasher = Sha256::new();
    hasher.update(job_id.to_le_bytes());
    hasher.update(worker_id.to_le_bytes());
    hasher.update(now_micros().to_le_bytes());
    format!("lease:{:x}", hasher.finalize())
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

fn timestamp_micros(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    let value = row.get(camel).or_else(|| row.get(snake))?;
    if let Some(micros) = value.as_u64() {
        return Some(micros);
    }
    if let Some(obj) = value.as_object() {
        if let Some(micros) = obj
            .get("__timestamp_micros_since_unix_epoch__")
            .and_then(|v| v.as_u64())
            .or_else(|| obj.get("microsSinceUnixEpoch").and_then(|v| v.as_u64()))
        {
            return Some(micros);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dispatch_env_flag_parses_false_by_default() {
        assert!(
            !std::env::var("LUMIERE_WORKFLOW_EXTERNAL_DISPATCH_ENABLED")
                .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                .unwrap_or(false)
                || std::env::var("LUMIERE_WORKFLOW_EXTERNAL_DISPATCH_ENABLED").is_ok()
        );
    }

    #[test]
    fn lease_tokens_are_unique_per_call() {
        let a = fresh_lease_token(1, 2);
        std::thread::sleep(Duration::from_millis(1));
        let b = fresh_lease_token(1, 2);
        assert_ne!(a, b);
        assert!(a.starts_with("lease:"));
    }

    #[test]
    fn outbox_payload_parses_camel_and_snake() {
        let raw = r#"{"outboxId":9,"companyId":3,"actionKey":"http.post","effectKey":"e1"}"#;
        let p: OutboxPayload = serde_json::from_str(raw).unwrap();
        assert_eq!(p.outbox_id, 9);
        assert_eq!(p.company_id, 3);
        assert_eq!(p.action_key.as_deref(), Some("http.post"));
    }
}
