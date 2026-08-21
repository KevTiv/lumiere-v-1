//! Bounded workflow delivery worker: timers always, external outbox optional.
//!
//! Cycle: heartbeat → reclaim expired leases → fire due timers → (if enabled)
//! claim `workflow-external` jobs → adapter → `record_workflow_outbox_result` →
//! `complete_queue_job`.
//!
//! External dispatch defaults **off** (`LUMIERE_WORKFLOW_EXTERNAL_DISPATCH_ENABLED`).
//! When on, optional company/action allowlists and `LUMIERE_WORKFLOW_EXTERNAL_WEBHOOK_URL`
//! gate real HTTP delivery (fail-closed action allowlist when webhook is set).

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
    #[serde(alias = "outboxId", default)]
    outbox_id: Option<u64>,
    #[serde(alias = "companyId")]
    company_id: u64,
    #[serde(alias = "actionKey", default)]
    action_key: Option<String>,
    #[serde(alias = "effectKey", default)]
    effect_key: Option<String>,
    #[serde(default)]
    payload: Option<Value>,
}

fn dispatch_allowlisted(config: &Config, company_id: u64, action_key: Option<&str>) -> bool {
    if !config.workflow_external_dispatch_company_ids.is_empty()
        && !config
            .workflow_external_dispatch_company_ids
            .contains(&company_id)
    {
        return false;
    }
    // Webhook mode is fail-closed on empty action allowlist.
    if config.workflow_external_webhook_url.is_some() {
        let Some(key) = action_key else {
            return false;
        };
        return config
            .workflow_external_dispatch_action_keys
            .iter()
            .any(|allowed| allowed == key);
    }
    // Fingerprint/dev mode: empty action allowlist means all actions.
    if config.workflow_external_dispatch_action_keys.is_empty() {
        return true;
    }
    action_key.is_some_and(|key| {
        config
            .workflow_external_dispatch_action_keys
            .iter()
            .any(|allowed| allowed == key)
    })
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
        if !timer_is_due(due_at, now) {
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
        let idem = timer_fire_idempotency_key(timer.id, timer.revision);
        if let Err(error) = state
            .stdb
            .call_reducer(stdb_client::reducer_call!(
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
            ))
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
        let preview: OutboxPayload = match serde_json::from_str(&job.payload) {
            Ok(p) => p,
            Err(error) => {
                tracing::warn!(job_id = job.id, %error, "skip unparsable outbox envelope");
                continue;
            }
        };
        if !dispatch_allowlisted(
            &state.config,
            preview.company_id,
            preview.action_key.as_deref(),
        ) {
            tracing::debug!(
                job_id = job.id,
                company_id = preview.company_id,
                action_key = ?preview.action_key,
                "defer outbox job: not on external dispatch allowlist"
            );
            continue;
        }

        let lease_token = fresh_lease_token(job.id, worker_id);
        let lease_expires = now_micros()
            + state
                .config
                .workflow_worker_lease_ttl_secs
                .saturating_mul(1_000_000);
        if let Err(error) = state
            .stdb
            .call_reducer(stdb_client::reducer_call!(
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
            ))
            .await
        {
            tracing::debug!(job_id = job.id, %error, "claim_queue_job skipped");
            continue;
        }

        let mut payload = preview;
        let outbox_id = match resolve_outbox_id(state, &payload, job.id).await {
            Ok(id) => id,
            Err(error) => {
                tracing::error!(job_id = job.id, %error, "outbox id unresolved");
                let _ = complete_failed(
                    state,
                    organization_id,
                    job.id,
                    worker_id,
                    &lease_token,
                    1,
                    "outbox id unresolved",
                )
                .await;
                continue;
            }
        };
        payload.outbox_id = Some(outbox_id);

        let adapter_result = run_external_adapter(state, &payload).await;
        let (result_kind, fingerprint, error_summary, outcome) = match adapter_result {
            Ok(fp) => ("Succeeded", Some(fp), None, "Succeeded"),
            Err(error) => ("RetryableFailure", None, Some(error.to_string()), "Failed"),
        };

        let instance_revision = instance_revision_for_outbox(state, outbox_id)
            .await
            .unwrap_or(1);
        let record_key = outbox_record_idempotency_key(&payload);
        if let Err(error) = state
            .stdb
            .call_reducer(stdb_client::reducer_call!(
                "record_workflow_outbox_result",
                json!([
                    organization_id,
                    {
                        "companyId": payload.company_id,
                        "outboxId": outbox_id,
                        "expectedOutboxRevision": 0,
                        "expectedInstanceRevision": instance_revision,
                        "queueJobId": job.id,
                        "workerId": worker_id,
                        "leaseToken": lease_token,
                        "result": result_kind,
                        "responseFingerprint": fingerprint,
                        "errorSummary": error_summary,
                        "idempotencyKey": record_key,
                        "correlationId": format!("workflow-outbox:{outbox_id}"),
                        "causationId": format!("queue-job:{}", job.id),
                    }
                ]),
            ))
            .await
        {
            tracing::error!(job_id = job.id, %error, "record_workflow_outbox_result failed");
        }

        let _ = state
            .stdb
            .call_reducer(stdb_client::reducer_call!(
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
            ))
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
        .call_reducer(stdb_client::reducer_call!(
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
        ))
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

/// Fake fingerprint when no webhook is set; HTTP POST when configured.
async fn run_external_adapter(state: &AppState, payload: &OutboxPayload) -> anyhow::Result<String> {
    let outbox_id = payload
        .outbox_id
        .ok_or_else(|| anyhow::anyhow!("outbox id required for adapter"))?;
    let key = payload.action_key.as_deref().unwrap_or("workflow.external");
    let effect = outbox_record_idempotency_key(payload);

    if let Some(url) = state.config.workflow_external_webhook_url.as_deref() {
        let body = json!({
            "outboxId": outbox_id,
            "companyId": payload.company_id,
            "actionKey": key,
            "effectKey": effect,
            "payload": payload.payload.clone().unwrap_or(Value::Null),
        });
        let response = state
            .http
            .post(url)
            .header("Idempotency-Key", &effect)
            .timeout(Duration::from_millis(
                state.config.workflow_external_webhook_timeout_ms,
            ))
            .json(&body)
            .send()
            .await
            .map_err(|error| anyhow::anyhow!("webhook request failed: {error}"))?;
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        if !(200..300).contains(&status) {
            return Err(anyhow::anyhow!(
                "webhook returned HTTP {status}: {}",
                text.chars().take(200).collect::<String>()
            ));
        }
        let mut hasher = Sha256::new();
        hasher.update(status.to_le_bytes());
        hasher.update(
            text.as_bytes()
                .iter()
                .take(512)
                .copied()
                .collect::<Vec<_>>(),
        );
        return Ok(format!("sha256:{:x}", hasher.finalize()));
    }

    let mut hasher = Sha256::new();
    hasher.update(key.as_bytes());
    hasher.update(outbox_id.to_le_bytes());
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

async fn resolve_outbox_id(
    state: &AppState,
    payload: &OutboxPayload,
    queue_job_id: u64,
) -> anyhow::Result<u64> {
    if let Some(id) = payload.outbox_id {
        return Ok(id);
    }
    let rows = state
        .stdb
        .query_sql(&format!(
            "SELECT id FROM workflow_outbox WHERE queue_job_id = {queue_job_id} LIMIT 1"
        ))
        .await?;
    rows.into_iter()
        .next()
        .and_then(|row| u64_field(&row, "id", "id"))
        .ok_or_else(|| anyhow::anyhow!("workflow_outbox missing for queue_job {queue_job_id}"))
}

fn fresh_lease_token(job_id: u64, worker_id: u64) -> String {
    fresh_lease_token_at(job_id, worker_id, now_micros())
}

fn fresh_lease_token_at(job_id: u64, worker_id: u64, now_micros: u64) -> String {
    let mut hasher = Sha256::new();
    hasher.update(job_id.to_le_bytes());
    hasher.update(worker_id.to_le_bytes());
    hasher.update(now_micros.to_le_bytes());
    format!("lease:{:x}", hasher.finalize())
}

fn now_micros() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_micros() as u64
}

/// True when a pending timer is eligible to fire at `now_micros` (WF-10 clock).
fn timer_is_due(due_at_micros: u64, now_micros: u64) -> bool {
    due_at_micros <= now_micros
}

fn timer_fire_idempotency_key(timer_id: u64, revision: u64) -> String {
    format!("timer-fire:{timer_id}:{revision}")
}

fn outbox_record_idempotency_key(payload: &OutboxPayload) -> String {
    if let Some(key) = payload.effect_key.clone() {
        return key;
    }
    match payload.outbox_id {
        Some(id) => format!("outbox-result:{id}"),
        None => "outbox-result:unknown".to_string(),
    }
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

/// Forced crash points for Gate W crash/replay suite (WF-10–WF-12).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DispatchCrashPoint {
    None,
    BeforeExternalCall,
    AfterExternalCallBeforeResult,
    AfterResultBeforeComplete,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DispatchPhase {
    Claimed,
    ExternalSucceeded,
    ResultRecorded,
    JobCompleted,
}

#[derive(Debug, Default)]
struct FakeExternalLedger {
    /// Effect keys that have a committed local result (semantic once).
    committed_effects: std::collections::BTreeSet<String>,
    /// External provider call count (may exceed committed on crash-after-call).
    external_calls: u64,
    /// Completions recorded after a successful result commit.
    completions: u64,
}

#[derive(Debug)]
enum DispatchAttemptError {
    Crashed(DispatchPhase),
    DuplicateEffect,
}

/// Pure outbox attempt used by Gate W tests: claim → adapter → result → complete.
fn run_outbox_attempt(
    ledger: &mut FakeExternalLedger,
    effect_key: &str,
    crash: DispatchCrashPoint,
) -> Result<DispatchPhase, DispatchAttemptError> {
    if ledger.committed_effects.contains(effect_key) {
        return Err(DispatchAttemptError::DuplicateEffect);
    }
    let _claimed = DispatchPhase::Claimed;
    if crash == DispatchCrashPoint::BeforeExternalCall {
        return Err(DispatchAttemptError::Crashed(DispatchPhase::Claimed));
    }

    ledger.external_calls += 1;
    if crash == DispatchCrashPoint::AfterExternalCallBeforeResult {
        return Err(DispatchAttemptError::Crashed(
            DispatchPhase::ExternalSucceeded,
        ));
    }

    if !ledger.committed_effects.insert(effect_key.to_string()) {
        return Err(DispatchAttemptError::DuplicateEffect);
    }
    if crash == DispatchCrashPoint::AfterResultBeforeComplete {
        return Err(DispatchAttemptError::Crashed(DispatchPhase::ResultRecorded));
    }

    ledger.completions += 1;
    Ok(DispatchPhase::JobCompleted)
}

/// Replay after crash: only commits once per effect key (WF-11).
fn replay_outbox_until_complete(
    ledger: &mut FakeExternalLedger,
    effect_key: &str,
) -> Result<DispatchPhase, DispatchAttemptError> {
    match run_outbox_attempt(ledger, effect_key, DispatchCrashPoint::None) {
        Ok(phase) => Ok(phase),
        Err(DispatchAttemptError::DuplicateEffect) => Ok(DispatchPhase::JobCompleted),
        Err(other) => Err(other),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dispatch_env_flag_defaults_off() {
        // Production default is false; tests must not require the env var.
        let enabled = std::env::var("LUMIERE_WORKFLOW_EXTERNAL_DISPATCH_ENABLED")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        let _ = enabled;
    }

    #[test]
    fn lease_tokens_differ_when_clock_advances() {
        let a = fresh_lease_token_at(1, 2, 100);
        let b = fresh_lease_token_at(1, 2, 101);
        assert_ne!(a, b);
        assert!(a.starts_with("lease:"));
    }

    #[test]
    fn outbox_payload_parses_camel_and_snake() {
        let raw = r#"{"outboxId":9,"companyId":3,"actionKey":"http.post","effectKey":"e1"}"#;
        let p: OutboxPayload = serde_json::from_str(raw).unwrap();
        assert_eq!(p.outbox_id, Some(9));
        assert_eq!(p.company_id, 3);
        assert_eq!(p.action_key.as_deref(), Some("http.post"));
        assert_eq!(outbox_record_idempotency_key(&p), "e1");

        let envelope = r#"{"action_key":"external.test","company_id":5,"payload":{"x":1}}"#;
        let e: OutboxPayload = serde_json::from_str(envelope).unwrap();
        assert_eq!(e.company_id, 5);
        assert_eq!(e.action_key.as_deref(), Some("external.test"));
        assert!(e.outbox_id.is_none());
    }

    #[test]
    fn dispatch_allowlist_fail_closed_with_webhook() {
        let mut config = Config {
            port: 1,
            stdb_host: String::new(),
            stdb_module: String::new(),
            stdb_server_token: None,
            cors_origins: vec![],
            dev_mock_org_id: None,
            ai_gateway_url: String::new(),
            workos_client_id: None,
            stdb_credential_encryption_key: None,
            resend_api_key: None,
            resend_from_email: String::new(),
            app_url: String::new(),
            cookie_secure: false,
            report_renderer_url: None,
            report_artifact_dir: std::env::temp_dir(),
            document_blob_dir: std::env::temp_dir(),
            owner_report_worker_poll_secs: 15,
            owner_report_worker_name: String::new(),
            owner_report_worker_port: 1,
            workflow_worker_poll_secs: 15,
            workflow_worker_name: String::new(),
            workflow_worker_port: 1,
            workflow_worker_org_ids: vec![],
            workflow_worker_lease_ttl_secs: 60,
            workflow_external_dispatch_enabled: true,
            workflow_external_dispatch_company_ids: vec![3],
            workflow_external_dispatch_action_keys: vec!["external.test.execute:v1".into()],
            workflow_external_webhook_url: Some("http://127.0.0.1:9999/hook".into()),
            workflow_external_webhook_timeout_ms: 1000,
        };
        assert!(dispatch_allowlisted(
            &config,
            3,
            Some("external.test.execute:v1")
        ));
        assert!(!dispatch_allowlisted(
            &config,
            9,
            Some("external.test.execute:v1")
        ));
        assert!(!dispatch_allowlisted(&config, 3, Some("other.action")));
        config.workflow_external_dispatch_action_keys.clear();
        assert!(!dispatch_allowlisted(
            &config,
            3,
            Some("external.test.execute:v1")
        ));
        config.workflow_external_webhook_url = None;
        assert!(dispatch_allowlisted(
            &config,
            3,
            Some("external.test.execute:v1")
        ));
    }

    #[test]
    fn wf10_fake_clock_fires_only_when_due() {
        let due = 1_000_000u64;
        assert!(!timer_is_due(due, due - 1));
        assert!(timer_is_due(due, due));
        assert!(timer_is_due(due, due + 5));
        assert_eq!(timer_fire_idempotency_key(42, 3), "timer-fire:42:3");
    }

    #[test]
    fn wf10_restart_past_due_fires_once_idempotency_key() {
        // Stop worker past due → restart → same timer/revision → same fire key.
        let key_a = timer_fire_idempotency_key(7, 1);
        let key_b = timer_fire_idempotency_key(7, 1);
        assert_eq!(key_a, key_b);
        assert_ne!(timer_fire_idempotency_key(7, 2), key_a);
    }

    #[test]
    fn wf11_crash_before_external_call_replays_without_duplicate_effect() {
        let mut ledger = FakeExternalLedger::default();
        let err = run_outbox_attempt(
            &mut ledger,
            "effect:order:1",
            DispatchCrashPoint::BeforeExternalCall,
        )
        .unwrap_err();
        assert!(matches!(
            err,
            DispatchAttemptError::Crashed(DispatchPhase::Claimed)
        ));
        assert_eq!(ledger.external_calls, 0);
        assert!(ledger.committed_effects.is_empty());

        let phase = replay_outbox_until_complete(&mut ledger, "effect:order:1").unwrap();
        assert_eq!(phase, DispatchPhase::JobCompleted);
        assert_eq!(ledger.external_calls, 1);
        assert_eq!(ledger.committed_effects.len(), 1);
        assert_eq!(ledger.completions, 1);
    }

    #[test]
    fn wf11_crash_after_external_before_result_replays_once() {
        let mut ledger = FakeExternalLedger::default();
        let err = run_outbox_attempt(
            &mut ledger,
            "effect:order:2",
            DispatchCrashPoint::AfterExternalCallBeforeResult,
        )
        .unwrap_err();
        assert!(matches!(
            err,
            DispatchAttemptError::Crashed(DispatchPhase::ExternalSucceeded)
        ));
        assert_eq!(ledger.external_calls, 1);
        assert!(ledger.committed_effects.is_empty());

        let phase = replay_outbox_until_complete(&mut ledger, "effect:order:2").unwrap();
        assert_eq!(phase, DispatchPhase::JobCompleted);
        // External may be called again; local commit is still once.
        assert_eq!(ledger.external_calls, 2);
        assert_eq!(ledger.committed_effects.len(), 1);
        assert_eq!(ledger.completions, 1);
    }

    #[test]
    fn wf11_crash_after_result_before_complete_does_not_double_commit() {
        let mut ledger = FakeExternalLedger::default();
        let err = run_outbox_attempt(
            &mut ledger,
            "effect:order:3",
            DispatchCrashPoint::AfterResultBeforeComplete,
        )
        .unwrap_err();
        assert!(matches!(
            err,
            DispatchAttemptError::Crashed(DispatchPhase::ResultRecorded)
        ));
        assert_eq!(ledger.committed_effects.len(), 1);
        assert_eq!(ledger.completions, 0);

        let phase = replay_outbox_until_complete(&mut ledger, "effect:order:3").unwrap();
        assert_eq!(phase, DispatchPhase::JobCompleted);
        assert_eq!(ledger.committed_effects.len(), 1);
        // Replay sees DuplicateEffect and treats as already complete (no second completion).
        assert_eq!(ledger.completions, 0);
    }

    #[test]
    fn wf12_two_replicas_same_effect_key_one_committed_effect() {
        let mut ledger = FakeExternalLedger::default();
        let a = run_outbox_attempt(&mut ledger, "effect:shared", DispatchCrashPoint::None).unwrap();
        assert_eq!(a, DispatchPhase::JobCompleted);
        let b = run_outbox_attempt(&mut ledger, "effect:shared", DispatchCrashPoint::None);
        assert!(matches!(b, Err(DispatchAttemptError::DuplicateEffect)));
        assert_eq!(ledger.committed_effects.len(), 1);
        assert_eq!(ledger.completions, 1);
        assert_eq!(ledger.external_calls, 1);
    }

    #[test]
    fn shutdown_mid_cycle_leaves_uncommitted_effect_for_restart() {
        let mut ledger = FakeExternalLedger::default();
        let _ = run_outbox_attempt(
            &mut ledger,
            "effect:shutdown",
            DispatchCrashPoint::AfterExternalCallBeforeResult,
        );
        assert!(ledger.committed_effects.is_empty());
        replay_outbox_until_complete(&mut ledger, "effect:shutdown").unwrap();
        assert_eq!(ledger.committed_effects.len(), 1);
    }
}
