//! Queue lease, external delivery, result recording and completion ordering.
use super::adapter::{
    dispatch_allowlisted, outbox_record_idempotency_key, run_external_adapter, OutboxPayload,
};
use super::timers::instance_revision;
use super::{now_micros, u64_field, BATCH_SIZE, JOB_TYPE, QUEUE_NAME};
use crate::state::AppState;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Deserialize, Clone)]
struct QueueJobRow {
    id: u64,
    revision: u64,
    payload: String,
}

pub(super) async fn dispatch_external_jobs(
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

pub(super) fn fresh_lease_token_at(job_id: u64, worker_id: u64, now_micros: u64) -> String {
    let mut hasher = Sha256::new();
    hasher.update(job_id.to_le_bytes());
    hasher.update(worker_id.to_le_bytes());
    hasher.update(now_micros.to_le_bytes());
    format!("lease:{:x}", hasher.finalize())
}
