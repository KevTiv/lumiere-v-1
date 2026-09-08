//! Scheduled typed owner-report queue worker.
//!
//! The worker uses its dedicated STDB worker token. It claims work through the
//! shared queue reducers, renders via the trusted Chromium service, and
//! records the same immutable artifact provenance used by interactive PDF
//! exports.

use std::{
    collections::{HashMap, HashSet},
    fs,
    net::SocketAddr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{http::StatusCode, routing::get, Router};
use chrono::{Datelike, Days, Utc};
use chrono_tz::Tz;
use rand::{rngs::OsRng, RngCore};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    config::Config,
    reports::{
        artifacts::artifact_path,
        common::{ReportKey, ReportPreviewRequest},
        execution_context::{
            ClaimedOwnerReportJob, ScheduledOwnerReportFacts, ScheduledReportContext,
            ScheduledReportRunFacts,
        },
        generation::{generate_owner_report, ReportExecutionContext},
    },
    state::AppState,
};

const BATCH_SIZE: usize = 20;
const RECOVERY_BATCH_SIZE: usize = 20;
const OWNER_REPORT_LEASE_TTL_SECS: u64 = 5 * 60;
const OWNER_REPORT_LEASE_TTL_MICROS: u64 = OWNER_REPORT_LEASE_TTL_SECS * 1_000_000;
const MAX_TIMESTAMP_MICROS: u64 = i64::MAX as u64;

#[derive(Debug, Deserialize)]
struct QueueRow {
    id: u64,
    #[serde(alias = "organizationId")]
    organization_id: u64,
    #[serde(alias = "companyId")]
    company_id: Option<u64>,
    revision: u64,
    payload: String,
    #[serde(default)]
    #[serde(alias = "leaseExpiresAt")]
    lease_expires_at: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct OwnerReportJob {
    #[serde(rename = "scheduledReportId", alias = "scheduled_report_id")]
    scheduled_report_id: u64,
    #[serde(rename = "scheduledReportRunId", alias = "scheduled_report_run_id")]
    scheduled_report_run_id: u64,
    #[serde(rename = "reportKey", alias = "report_key")]
    report_key: String,
    #[serde(rename = "companyId", alias = "company_id")]
    company_id: u64,
    timezone: String,
}

#[derive(Debug, Deserialize)]
struct WorkerRow {
    id: u64,
    #[serde(alias = "organizationId")]
    organization_id: u64,
    name: String,
    queues: Vec<String>,
    #[serde(alias = "isActive")]
    is_active: bool,
}

#[derive(Debug, Deserialize)]
struct ScheduledReportRunRow {
    #[serde(alias = "organizationId")]
    organization_id: u64,
    id: u64,
    #[serde(alias = "scheduledReportId")]
    scheduled_report_id: u64,
    #[serde(alias = "queueJobId")]
    queue_job_id: Option<u64>,
    status: String,
    #[serde(alias = "generatedOwnerReportId")]
    generated_owner_report_id: Option<u64>,
    #[serde(alias = "documentId")]
    document_id: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct ScheduledReportRow {
    #[serde(alias = "organizationId")]
    organization_id: u64,
    id: u64,
    #[serde(alias = "companyId")]
    company_id: Option<u64>,
    #[serde(alias = "ownerReportKey")]
    owner_report_key: Option<String>,
    timezone: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GeneratedOwnerReportRow {
    #[serde(alias = "organizationId")]
    organization_id: u64,
    id: u64,
    #[serde(alias = "companyId")]
    company_id: u64,
    #[serde(alias = "reportKey")]
    report_key: String,
    #[serde(alias = "outputHash")]
    output_hash: String,
    #[serde(alias = "artifactKey")]
    artifact_key: String,
    #[serde(alias = "documentId")]
    document_id: u64,
    #[serde(alias = "correlationId")]
    correlation_id: String,
}

#[derive(Debug, Deserialize)]
struct DocumentRow {
    #[serde(alias = "organizationId")]
    organization_id: u64,
    id: u64,
    #[serde(alias = "companyId")]
    company_id: Option<u64>,
}

/// Start a bounded polling worker and its internal health endpoint.
pub async fn serve() -> anyhow::Result<()> {
    let config = Config::from_worker_env()?;
    let worker_token = config.require_dedicated_worker_token("STDB_OWNER_REPORT_WORKER_TOKEN")?;
    let port = config.owner_report_worker_port;
    let mut app_state = AppState::new(config);
    app_state.stdb = app_state.stdb.with_token(worker_token);
    let state = Arc::new(app_state);
    let ready = Arc::new(AtomicBool::new(false));
    let worker_state = state.clone();
    let worker_ready = ready.clone();
    tokio::spawn(async move {
        loop {
            match process_batch(&worker_state).await {
                Ok(_) => worker_ready.store(true, Ordering::Relaxed),
                Err(error) => {
                    worker_ready.store(false, Ordering::Relaxed);
                    tracing::error!(%error, "owner-report worker batch failed");
                }
            }
            tokio::time::sleep(Duration::from_secs(
                worker_state.config.owner_report_worker_poll_secs,
            ))
            .await;
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
    tracing::info!(port, "owner-report worker listening");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn process_batch(state: &AppState) -> anyhow::Result<usize> {
    let mut worker_ids = HashMap::new();
    let organizations = due_schedule_organizations(state).await?;
    for organization_id in organizations {
        crate::service_identity::verify_registered_service_identity(
            &state.stdb,
            organization_id,
            crate::service_identity::OWNER_REPORT_WORKER_SERVICE,
        )
        .await?;
        let worker_id = ensure_worker_registration(state, organization_id).await?;
        worker_ids.insert(organization_id, worker_id);
        state
            .stdb
            .call_reducer(stdb_client::reducer_call!(
                "dispatch_due_owner_reports",
                json!([organization_id])
            ))
            .await?;
    }

    let pending_rows = state
        .stdb
        .query_sql(&format!(
            "SELECT id, organization_id, company_id, revision, payload, lease_expires_at FROM queue_job \
             WHERE queue_name = 'owner_report' AND job_type = 'owner_report.generate' \
             AND status = 'Pending' ORDER BY available_at ASC, id ASC LIMIT {BATCH_SIZE}"
        ))
        .await?;
    let leased_rows = state
        .stdb
        .query_sql(&format!(
            "SELECT id, organization_id, company_id, revision, payload, lease_expires_at FROM queue_job \
             WHERE queue_name = 'owner_report' AND job_type = 'owner_report.generate' \
             AND status = 'Leased' AND lease_expires_at IS NOT NULL \
             ORDER BY lease_expires_at ASC, id ASC LIMIT {RECOVERY_BATCH_SIZE}"
        ))
        .await?;
    let pending_jobs = pending_rows
        .into_iter()
        .map(serde_json::from_value::<QueueRow>)
        .collect::<Result<Vec<_>, _>>()?;
    let recovery_jobs = leased_rows
        .into_iter()
        .map(serde_json::from_value::<QueueRow>)
        .collect::<Result<Vec<_>, _>>()?;
    let mut jobs = pending_jobs;
    jobs.extend(select_expired_leased(recovery_jobs, now_micros()));

    for job in &jobs {
        let worker_id = match worker_ids.get(&job.organization_id).copied() {
            Some(worker_id) => worker_id,
            None => match ensure_worker_registration(state, job.organization_id).await {
                Ok(worker_id) => {
                    worker_ids.insert(job.organization_id, worker_id);
                    worker_id
                }
                Err(error) => {
                    tracing::error!(job_id = job.id, %error, "owner-report worker registration failed");
                    continue;
                }
            },
        };
        let lease_token = fresh_lease_token();
        let lease_expires_at_micros = lease_expiry_at(now_micros())
            .ok_or_else(|| anyhow::anyhow!("owner-report lease expiry is out of range"))?;
        let claimed_revision = job
            .revision
            .checked_add(1)
            .ok_or_else(|| anyhow::anyhow!("owner-report queue revision overflow"))?;
        if let Err(error) = state
            .stdb
            .call_reducer(stdb_client::reducer_call!(
                "claim_queue_job",
                json!([
                    job.organization_id,
                    job.id,
                    claim_params_json(
                        job.revision,
                        worker_id,
                        &lease_token,
                        lease_expires_at_micros,
                    )
                ])
            ))
            .await
        {
            tracing::debug!(job_id = job.id, %error, "owner-report job was claimed elsewhere");
            continue;
        }
        match process_job(
            state,
            job,
            worker_id,
            &lease_token,
            lease_expires_at_micros,
            claimed_revision,
        )
        .await
        {
            Ok(response_fingerprint) => {
                if let Err(error) = state
                    .stdb
                    .call_reducer(stdb_client::reducer_call!(
                        "complete_queue_job",
                        json!([
                            job.organization_id,
                            job.id,
                            complete_params_json(
                                claimed_revision,
                                worker_id,
                                &lease_token,
                                "Succeeded",
                                None,
                                Some(&response_fingerprint),
                            )
                        ]),
                    ))
                    .await
                {
                    tracing::error!(
                        job_id = job.id,
                        %error,
                        "owner-report queue completion failed; leaving lease for retry"
                    );
                }
            }
            Err(error) => {
                let error_message = error.to_string();
                tracing::error!(job_id = job.id, %error_message, "owner-report job failed");
                if let Ok(payload) = serde_json::from_str::<OwnerReportJob>(&job.payload) {
                    let can_fail_run = validate_failure_binding(
                        state,
                        job,
                        &payload,
                        worker_id,
                        &lease_token,
                        lease_expires_at_micros,
                        claimed_revision,
                    )
                    .await
                    .unwrap_or(false);
                    if can_fail_run {
                        let _ = state
                            .stdb
                            .call_reducer(stdb_client::reducer_call!(
                                "fail_scheduled_owner_report_run",
                                json!([
                                    job.organization_id,
                                    payload.scheduled_report_run_id,
                                    error_message
                                ]),
                            ))
                            .await;
                    }
                }
                let _ = state
                    .stdb
                    .call_reducer(stdb_client::reducer_call!(
                        "complete_queue_job",
                        json!([
                            job.organization_id,
                            job.id,
                            complete_params_json(
                                claimed_revision,
                                worker_id,
                                &lease_token,
                                "Failed",
                                Some(&error_message),
                                None,
                            )
                        ]),
                    ))
                    .await;
            }
        }
    }
    Ok(jobs.len())
}

async fn due_schedule_organizations(state: &AppState) -> anyhow::Result<Vec<u64>> {
    let rows = state
        .stdb
        .query_sql(
            "SELECT organization_id FROM scheduled_report \
             WHERE is_active = true AND owner_report_key IS NOT NULL",
        )
        .await?;
    let mut organizations = HashSet::new();
    for row in rows {
        if let Some(id) = row
            .get("organizationId")
            .or_else(|| row.get("organization_id"))
            .and_then(|value| value.as_u64())
        {
            organizations.insert(id);
        }
    }
    Ok(organizations.into_iter().collect())
}

async fn ensure_worker_registration(state: &AppState, organization_id: u64) -> anyhow::Result<u64> {
    let name = state.config.owner_report_worker_name.replace('\'', "''");
    let rows = state
        .stdb
        .query_sql(&format!(
            "SELECT id, organization_id, name, queues, is_active FROM queue_worker WHERE organization_id = {organization_id} \
             AND name = '{name}' AND is_active = true LIMIT 1"
        ))
        .await?;
    if let Some(row) = rows.into_iter().next() {
        let worker: WorkerRow = serde_json::from_value(row)?;
        verify_worker(
            &worker,
            organization_id,
            &state.config.owner_report_worker_name,
        )?;
        state
            .stdb
            .call_reducer(stdb_client::reducer_call!(
                "worker_heartbeat",
                json!([organization_id, worker.id])
            ))
            .await?;
    } else {
        state
            .stdb
            .call_reducer(stdb_client::reducer_call!("register_queue_worker", json!([
                    organization_id,
                    {
                        "companyId": null,
                        "name": state.config.owner_report_worker_name,
                        "queues": ["owner_report"],
                        "metadata": serde_json::json!({ "service": "owner-report-worker" }).to_string(),
                    }
                ]),))
            .await?;
    }

    let rows = state
        .stdb
        .query_sql(&format!(
            "SELECT id, organization_id, name, queues, is_active FROM queue_worker WHERE organization_id = {organization_id} \
             AND name = '{name}' AND is_active = true LIMIT 1"
        ))
        .await?;
    let worker: WorkerRow = rows
        .into_iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("owner-report worker registration was not persisted"))
        .and_then(|row| serde_json::from_value(row).map_err(anyhow::Error::from))?;
    verify_worker(
        &worker,
        organization_id,
        &state.config.owner_report_worker_name,
    )?;
    Ok(worker.id)
}

fn verify_worker(
    worker: &WorkerRow,
    organization_id: u64,
    expected_name: &str,
) -> anyhow::Result<()> {
    if worker.organization_id != organization_id
        || worker.name != expected_name
        || !worker.is_active
        || !worker.queues.iter().any(|queue| queue == "owner_report")
    {
        return Err(anyhow::anyhow!(
            "owner-report worker registration is not valid"
        ));
    }
    Ok(())
}

async fn process_job(
    state: &AppState,
    job: &QueueRow,
    worker_id: u64,
    lease_token: &str,
    lease_expires_at_micros: u64,
    claimed_revision: u64,
) -> anyhow::Result<String> {
    let payload: OwnerReportJob = serde_json::from_str(&job.payload)?;
    validate_payload_bindings(job, &payload)?;
    let run_row = reload_run(state, payload.scheduled_report_run_id).await?;
    let schedule = reload_schedule_facts(state, payload.scheduled_report_id).await?;
    if run_row.status == "completed" {
        return recover_completed_job(state, job, &payload, &run_row, &schedule).await;
    }
    let run = run_facts(&run_row)?;
    let context = claimed_context(
        state,
        job,
        &payload,
        run,
        schedule,
        worker_id,
        lease_token,
        lease_expires_at_micros,
        claimed_revision,
    )?;
    let report_key = context.report_key();
    let timezone = context.timezone().parse::<Tz>()?;
    let date = report_date(report_key, timezone)?;
    let generated = generate_owner_report(
        state,
        ReportExecutionContext::scheduled(context),
        report_key,
        ReportPreviewRequest {
            company_id: payload.company_id,
            date,
            timezone: payload.timezone.clone(),
        },
    )
    .await
    .map_err(|error| anyhow::anyhow!("generate owner report: {error:?}"))?;
    state
        .stdb
        .call_reducer(stdb_client::reducer_call!(
            "complete_scheduled_owner_report_run",
            json!([
                job.organization_id,
                payload.scheduled_report_run_id,
                generated.artifact.id,
                generated.artifact.document_id,
            ]),
        ))
        .await?;
    Ok(generated.artifact.output_hash)
}

async fn reload_run(state: &AppState, run_id: u64) -> anyhow::Result<ScheduledReportRunRow> {
    let rows = state
        .stdb
        .query_sql(&format!(
            "SELECT id, organization_id, scheduled_report_id, queue_job_id, status, \
             generated_owner_report_id, document_id \
             FROM scheduled_report_run WHERE id = {run_id} LIMIT 1"
        ))
        .await?;
    rows.into_iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("scheduled report run not found"))
        .and_then(|row| serde_json::from_value(row).map_err(anyhow::Error::from))
}

fn run_facts(row: &ScheduledReportRunRow) -> anyhow::Result<ScheduledReportRunFacts> {
    ScheduledReportRunFacts::new(
        row.organization_id,
        row.id,
        row.scheduled_report_id,
        row.queue_job_id,
        row.status.clone(),
    )
    .map_err(|error| anyhow::anyhow!(error.to_string()))
}

fn claimed_context(
    state: &AppState,
    job: &QueueRow,
    payload: &OwnerReportJob,
    run: ScheduledReportRunFacts,
    schedule: ScheduledOwnerReportFacts,
    worker_id: u64,
    lease_token: &str,
    lease_expires_at_micros: u64,
    claimed_revision: u64,
) -> anyhow::Result<ScheduledReportContext> {
    let claimed = ClaimedOwnerReportJob::new(
        job.organization_id,
        job.company_id,
        job.id,
        payload.scheduled_report_run_id,
        payload.scheduled_report_id,
        claimed_revision,
        worker_id,
        lease_token,
        lease_expires_at_micros,
        payload.report_key.clone(),
        payload.timezone.clone(),
        &state.config.owner_report_worker_name,
    )?;
    ScheduledReportContext::from_claimed_job(state.stdb.clone(), claimed, run, schedule)
        .map_err(|error| anyhow::anyhow!(error.to_string()))
}

/// Recheck all trusted queue/run/schedule evidence immediately before mutating
/// a run on the failure path. A completed or artifact-bearing run is never
/// eligible for the failure reducer.
async fn validate_failure_binding(
    state: &AppState,
    job: &QueueRow,
    payload: &OwnerReportJob,
    worker_id: u64,
    lease_token: &str,
    lease_expires_at_micros: u64,
    claimed_revision: u64,
) -> anyhow::Result<bool> {
    if validate_payload_bindings(job, payload).is_err() {
        return Ok(false);
    }
    let run = reload_run(state, payload.scheduled_report_run_id).await?;
    if run.status == "completed"
        || run.generated_owner_report_id.is_some()
        || run.document_id.is_some()
    {
        return Ok(false);
    }
    let schedule = reload_schedule_facts(state, payload.scheduled_report_id).await?;
    let run_facts = run_facts(&run)?;
    claimed_context(
        state,
        job,
        payload,
        run_facts,
        schedule,
        worker_id,
        lease_token,
        lease_expires_at_micros,
        claimed_revision,
    )?;
    Ok(true)
}

async fn recover_completed_job(
    state: &AppState,
    job: &QueueRow,
    payload: &OwnerReportJob,
    run: &ScheduledReportRunRow,
    schedule: &ScheduledOwnerReportFacts,
) -> anyhow::Result<String> {
    validate_completed_run_binding(job, payload, run, schedule)?;
    let generated_owner_report_id = run
        .generated_owner_report_id
        .ok_or_else(|| anyhow::anyhow!("completed owner-report run has no generated artifact"))?;
    let artifact_rows = state
        .stdb
        .query_sql(&format!(
            "SELECT id, organization_id, company_id, report_key, output_hash, artifact_key, \
             document_id, correlation_id FROM generated_owner_report \
             WHERE organization_id = {} AND id = {generated_owner_report_id} LIMIT 1",
            job.organization_id
        ))
        .await?;
    let artifact: GeneratedOwnerReportRow = artifact_rows
        .into_iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("completed owner-report artifact not found"))
        .and_then(|row| serde_json::from_value(row).map_err(anyhow::Error::from))?;
    validate_generated_artifact(job, payload, run, &artifact)?;

    let document_rows = state
        .stdb
        .query_sql(&format!(
            "SELECT id, organization_id, company_id FROM document WHERE id = {} LIMIT 1",
            artifact.document_id
        ))
        .await?;
    let document: DocumentRow = document_rows
        .into_iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("completed owner-report document not found"))
        .and_then(|row| serde_json::from_value(row).map_err(anyhow::Error::from))?;
    if document.id != run.document_id.unwrap_or_default()
        || document.organization_id != job.organization_id
        || document.company_id != Some(payload.company_id)
    {
        return Err(anyhow::anyhow!(
            "completed owner-report document binding is invalid"
        ));
    }
    let path = artifact_path(&state.config.report_artifact_dir, &artifact.artifact_key)
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    if !fs::metadata(path)
        .map(|metadata| metadata.is_file())
        .unwrap_or(false)
    {
        return Err(anyhow::anyhow!(
            "completed owner-report artifact file is missing"
        ));
    }
    Ok(artifact.output_hash)
}

fn validate_completed_run_binding(
    job: &QueueRow,
    payload: &OwnerReportJob,
    run: &ScheduledReportRunRow,
    schedule: &ScheduledOwnerReportFacts,
) -> anyhow::Result<()> {
    if run.status != "completed"
        || run.organization_id != job.organization_id
        || run.scheduled_report_id != payload.scheduled_report_id
        || run.queue_job_id != Some(job.id)
        || schedule.organization_id() != job.organization_id
        || schedule.scheduled_report_id() != payload.scheduled_report_id
        || schedule.company_id() != payload.company_id
        || schedule.report_key().as_str() != payload.report_key
        || schedule.timezone() != payload.timezone
    {
        return Err(anyhow::anyhow!(
            "completed owner-report run binding is invalid"
        ));
    }
    if run.generated_owner_report_id.is_none() || run.document_id.is_none() {
        return Err(anyhow::anyhow!(
            "completed owner-report run is missing artifact bindings"
        ));
    }
    Ok(())
}

fn validate_generated_artifact(
    job: &QueueRow,
    payload: &OwnerReportJob,
    run: &ScheduledReportRunRow,
    artifact: &GeneratedOwnerReportRow,
) -> anyhow::Result<()> {
    let expected_correlation = format!(
        "owner-report:{}:scheduled-run-{}",
        payload.report_key, payload.scheduled_report_run_id
    );
    let output_hash = artifact
        .output_hash
        .strip_prefix("sha256:")
        .filter(|hash| hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(|| anyhow::anyhow!("completed owner-report output hash is invalid"))?;
    if artifact.id != run.generated_owner_report_id.unwrap_or_default()
        || artifact.organization_id != job.organization_id
        || artifact.company_id != payload.company_id
        || artifact.report_key != payload.report_key
        || artifact.document_id != run.document_id.unwrap_or_default()
        || artifact.correlation_id != expected_correlation
        || artifact.artifact_key != format!("{output_hash}.pdf")
    {
        return Err(anyhow::anyhow!(
            "completed owner-report artifact binding is invalid"
        ));
    }
    Ok(())
}

fn select_expired_leased(mut rows: Vec<QueueRow>, now_micros: u64) -> Vec<QueueRow> {
    rows.retain(|row| {
        row.lease_expires_at
            .as_ref()
            .and_then(timestamp_micros)
            .is_some_and(|expires_at| expires_at <= now_micros)
    });
    rows
}

fn timestamp_micros(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_i64().and_then(|micros| u64::try_from(micros).ok()))
        .or_else(|| {
            value
                .get("__timestamp_micros_since_unix_epoch__")
                .and_then(timestamp_micros)
        })
        .or_else(|| value.get("some").and_then(timestamp_micros))
        .or_else(|| value.get("microsSinceUnixEpoch").and_then(timestamp_micros))
}

async fn reload_schedule_facts(
    state: &AppState,
    schedule_id: u64,
) -> anyhow::Result<ScheduledOwnerReportFacts> {
    let rows = state
        .stdb
        .query_sql(&format!(
            "SELECT id, organization_id, company_id, owner_report_key, timezone \
             FROM scheduled_report WHERE id = {schedule_id} LIMIT 1"
        ))
        .await?;
    let row: ScheduledReportRow = rows
        .into_iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("scheduled report not found"))
        .and_then(|row| serde_json::from_value(row).map_err(anyhow::Error::from))?;
    ScheduledOwnerReportFacts::new(
        row.organization_id,
        row.id,
        row.company_id,
        row.owner_report_key,
        row.timezone,
    )
    .map_err(|error| anyhow::anyhow!(error.to_string()))
}

fn validate_payload_bindings(job: &QueueRow, payload: &OwnerReportJob) -> anyhow::Result<()> {
    if job.company_id != Some(payload.company_id) {
        return Err(anyhow::anyhow!(
            "queued owner-report company does not match queue job"
        ));
    }
    Ok(())
}

fn now_micros() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_micros()).ok())
        .unwrap_or(MAX_TIMESTAMP_MICROS)
}

fn lease_expiry_at(now: u64) -> Option<u64> {
    now.checked_add(OWNER_REPORT_LEASE_TTL_MICROS)
        .filter(|expiry| *expiry <= MAX_TIMESTAMP_MICROS)
}

fn fresh_lease_token() -> String {
    let mut bytes = [0_u8; 32];
    let mut rng = OsRng;
    rng.fill_bytes(&mut bytes);
    format!("owner-report-lease:{}", hex::encode(bytes))
}

fn claim_params_json(
    expected_revision: u64,
    worker_id: u64,
    lease_token: &str,
    lease_expires_at_micros: u64,
) -> serde_json::Value {
    json!({
        "expectedRevision": expected_revision,
        "workerId": worker_id,
        "leaseToken": lease_token,
        "leaseExpiresAtMicros": lease_expires_at_micros,
    })
}

fn complete_params_json(
    expected_revision: u64,
    worker_id: u64,
    lease_token: &str,
    outcome: &str,
    error_summary: Option<&str>,
    response_fingerprint: Option<&str>,
) -> serde_json::Value {
    json!({
        "expectedRevision": expected_revision,
        "workerId": worker_id,
        "leaseToken": lease_token,
        "outcome": outcome,
        "errorSummary": error_summary,
        "responseFingerprint": response_fingerprint,
        "retryJitterMicros": 0,
    })
}

fn report_date(report_key: ReportKey, timezone: Tz) -> anyhow::Result<String> {
    let today = Utc::now().with_timezone(&timezone).date_naive();
    let date = if report_key == ReportKey::MonthlyOwnerReportV1 {
        let current_month = today
            .with_day(1)
            .ok_or_else(|| anyhow::anyhow!("invalid local date"))?;
        current_month
            .checked_sub_days(Days::new(1))
            .and_then(|last| last.with_day(1))
            .ok_or_else(|| anyhow::anyhow!("cannot determine previous local month"))?
    } else {
        today
            .checked_sub_days(Days::new(1))
            .ok_or_else(|| anyhow::anyhow!("cannot determine previous local day"))?
    };
    Ok(date.format("%Y-%m-%d").to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn queue_job(company_id: Option<u64>) -> QueueRow {
        QueueRow {
            id: 101,
            organization_id: 7,
            company_id,
            revision: 4,
            payload: String::new(),
            lease_expires_at: None,
        }
    }

    fn owner_report_job(company_id: u64) -> OwnerReportJob {
        OwnerReportJob {
            scheduled_report_id: 303,
            scheduled_report_run_id: 202,
            report_key: "daily_business_summary_v1".into(),
            company_id,
            timezone: "UTC".into(),
        }
    }

    #[test]
    fn monthly_schedule_uses_completed_calendar_month() {
        let timezone = "UTC".parse::<Tz>().expect("UTC timezone");
        let date = report_date(ReportKey::MonthlyOwnerReportV1, timezone).expect("report date");
        assert!(date.ends_with("-01"));
    }

    #[test]
    fn claim_arguments_use_current_revision_and_opaque_lease() {
        let token = fresh_lease_token();
        let expiry = lease_expiry_at(1_000_000).expect("expiry should be representable");
        let params = claim_params_json(4, 505, &token, expiry);

        assert_eq!(params["expectedRevision"], 4);
        assert_eq!(params["workerId"], 505);
        assert_eq!(params["leaseExpiresAtMicros"], expiry);
        assert!(params["leaseToken"]
            .as_str()
            .is_some_and(|value| { value.starts_with("owner-report-lease:") && value.len() > 40 }));
        assert_eq!(
            lease_expiry_at(1_000_000),
            Some(1_000_000 + OWNER_REPORT_LEASE_TTL_MICROS)
        );
        assert!(lease_expiry_at(MAX_TIMESTAMP_MICROS).is_none());
    }

    #[test]
    fn completion_arguments_preserve_revision_and_fingerprint_contract() {
        let success = complete_params_json(
            5,
            505,
            "owner-report-lease:test",
            "Succeeded",
            None,
            Some("sha256:abc"),
        );
        assert_eq!(success["expectedRevision"], 5);
        assert_eq!(success["outcome"], "Succeeded");
        assert_eq!(success["responseFingerprint"], "sha256:abc");
        assert!(success["errorSummary"].is_null());

        let failure = complete_params_json(
            5,
            505,
            "owner-report-lease:test",
            "Failed",
            Some("renderer unavailable"),
            None,
        );
        assert_eq!(failure["outcome"], "Failed");
        assert_eq!(failure["errorSummary"], "renderer unavailable");
        assert!(failure["responseFingerprint"].is_null());
    }

    #[test]
    fn payload_company_must_match_queue_company() {
        validate_payload_bindings(&queue_job(Some(11)), &owner_report_job(11))
            .expect("matching company evidence");
        assert!(validate_payload_bindings(&queue_job(Some(12)), &owner_report_job(11)).is_err());
        assert!(validate_payload_bindings(&queue_job(None), &owner_report_job(11)).is_err());
    }

    #[test]
    fn expired_leased_selection_excludes_future_and_missing_expiry() {
        let expired = QueueRow {
            lease_expires_at: Some(json!({
                "__timestamp_micros_since_unix_epoch__": 9_999
            })),
            ..queue_job(Some(11))
        };
        let future = QueueRow {
            lease_expires_at: Some(json!({
                "__timestamp_micros_since_unix_epoch__": 10_001
            })),
            ..queue_job(Some(11))
        };
        let selected = select_expired_leased(vec![expired, future, queue_job(Some(11))], 10_000);
        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].id, 101);
    }

    #[test]
    fn completed_run_binding_requires_artifact_and_document_ids() {
        let job = queue_job(Some(11));
        let payload = owner_report_job(11);
        let schedule = ScheduledOwnerReportFacts::new(
            7,
            303,
            Some(11),
            Some("daily_business_summary_v1".into()),
            Some("UTC".into()),
        )
        .expect("valid schedule facts");
        let mut run = ScheduledReportRunRow {
            organization_id: 7,
            id: 202,
            scheduled_report_id: 303,
            queue_job_id: Some(101),
            status: "completed".into(),
            generated_owner_report_id: Some(404),
            document_id: Some(405),
        };
        validate_completed_run_binding(&job, &payload, &run, &schedule)
            .expect("completed run should have complete bindings");
        run.document_id = None;
        assert!(validate_completed_run_binding(&job, &payload, &run, &schedule).is_err());
    }

    #[test]
    fn generated_artifact_binding_requires_scheduled_correlation() {
        let job = queue_job(Some(11));
        let payload = owner_report_job(11);
        let run = ScheduledReportRunRow {
            organization_id: 7,
            id: 202,
            scheduled_report_id: 303,
            queue_job_id: Some(101),
            status: "completed".into(),
            generated_owner_report_id: Some(404),
            document_id: Some(405),
        };
        let artifact = GeneratedOwnerReportRow {
            organization_id: 7,
            id: 404,
            company_id: 11,
            report_key: "daily_business_summary_v1".into(),
            output_hash: format!("sha256:{}", "a".repeat(64)),
            artifact_key: format!("{}.pdf", "a".repeat(64)),
            document_id: 405,
            correlation_id: "wrong-correlation".into(),
        };
        assert!(validate_generated_artifact(&job, &payload, &run, &artifact).is_err());
    }

    #[test]
    fn worker_registration_requires_active_owner_report_queue() {
        let worker = WorkerRow {
            id: 505,
            organization_id: 7,
            name: "owner-report-worker".into(),
            queues: vec!["owner_report".into()],
            is_active: true,
        };
        verify_worker(&worker, 7, "owner-report-worker").expect("valid worker");
        assert!(verify_worker(&worker, 8, "owner-report-worker").is_err());

        let mut wrong_queue = worker;
        wrong_queue.queues = vec!["other".into()];
        assert!(verify_worker(&wrong_queue, 7, "owner-report-worker").is_err());
    }
}
