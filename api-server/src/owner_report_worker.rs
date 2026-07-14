//! Scheduled typed owner-report queue worker.
//!
//! The worker only uses the server token. It claims work through the shared
//! queue reducers, renders via the trusted Chromium service, and records the
//! same immutable artifact provenance used by interactive PDF exports.

use std::{
    collections::HashSet,
    net::SocketAddr,
    str::FromStr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use axum::{http::StatusCode, routing::get, Router};
use chrono::{Datelike, Days, Utc};
use chrono_tz::Tz;
use serde::Deserialize;
use serde_json::json;

use crate::{
    config::Config,
    reports::{
        common::{ReportKey, ReportPreviewRequest},
        render::render_pdf,
        service::preview_report,
    },
    routes::reports::record_generated_report,
    state::AppState,
};

const BATCH_SIZE: usize = 20;

#[derive(Debug, Deserialize)]
struct QueueRow {
    id: u64,
    organization_id: u64,
    payload: String,
}

#[derive(Debug, Deserialize)]
struct OwnerReportJob {
    #[serde(rename = "scheduledReportRunId")]
    scheduled_report_run_id: u64,
    #[serde(rename = "reportKey")]
    report_key: String,
    #[serde(rename = "companyId")]
    company_id: u64,
    timezone: String,
}

#[derive(Debug, Deserialize)]
struct WorkerRow {
    id: u64,
}

/// Start a bounded polling worker and its internal health endpoint.
pub async fn serve() -> anyhow::Result<()> {
    let config = Config::from_env()?;
    let port = config.owner_report_worker_port;
    let state = Arc::new(AppState::new(config));
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
    let organizations = due_schedule_organizations(state).await?;
    for organization_id in organizations {
        ensure_worker_registration(state, organization_id).await?;
        state
            .stdb
            .call_reducer("dispatch_due_owner_reports", json!([organization_id]))
            .await?;
    }

    let rows = state
        .stdb
        .query_sql(&format!(
            "SELECT id, organization_id, payload FROM queue_job \
             WHERE queue_name = 'owner_report' AND job_type = 'owner_report.generate' \
             AND status = 'Pending' LIMIT {BATCH_SIZE}"
        ))
        .await?;
    let jobs = rows
        .into_iter()
        .map(serde_json::from_value::<QueueRow>)
        .collect::<Result<Vec<_>, _>>()?;

    for job in &jobs {
        if let Err(error) = state
            .stdb
            .call_reducer("claim_queue_job", json!([job.organization_id, job.id]))
            .await
        {
            tracing::debug!(job_id = job.id, %error, "owner-report job was claimed elsewhere");
            continue;
        }
        if let Err(error) = process_job(state, job).await {
            let error_message = error.to_string();
            tracing::error!(job_id = job.id, %error_message, "owner-report job failed");
            if let Ok(payload) = serde_json::from_str::<OwnerReportJob>(&job.payload) {
                let _ = state
                    .stdb
                    .call_reducer(
                        "fail_scheduled_owner_report_run",
                        json!([
                            job.organization_id,
                            payload.scheduled_report_run_id,
                            error_message
                        ]),
                    )
                    .await;
            }
            let _ = state
                .stdb
                .call_reducer(
                    "complete_queue_job",
                    json!([job.organization_id, job.id, error.to_string()]),
                )
                .await;
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

async fn ensure_worker_registration(state: &AppState, organization_id: u64) -> anyhow::Result<()> {
    let name = state.config.owner_report_worker_name.replace('\'', "''");
    let rows = state
        .stdb
        .query_sql(&format!(
            "SELECT id FROM queue_worker WHERE organization_id = {organization_id} \
             AND name = '{name}' AND is_active = true LIMIT 1"
        ))
        .await?;
    if let Some(row) = rows.into_iter().next() {
        let worker: WorkerRow = serde_json::from_value(row)?;
        state
            .stdb
            .call_reducer("worker_heartbeat", json!([organization_id, worker.id]))
            .await?;
    } else {
        state
            .stdb
            .call_reducer(
                "register_queue_worker",
                json!([
                    organization_id,
                    {
                        "name": state.config.owner_report_worker_name,
                        "queues": ["owner_report"],
                        "metadata": serde_json::json!({ "service": "owner-report-worker" }).to_string(),
                    }
                ]),
            )
            .await?;
    }
    Ok(())
}

async fn process_job(state: &AppState, job: &QueueRow) -> anyhow::Result<()> {
    let payload: OwnerReportJob = serde_json::from_str(&job.payload)?;
    let report_key = ReportKey::from_str(&payload.report_key)
        .map_err(|_| anyhow::anyhow!("unknown owner report key in queued job"))?;
    let timezone = payload.timezone.parse::<Tz>()?;
    let date = report_date(report_key, timezone)?;
    let preview = preview_report(
        &state.stdb,
        report_key,
        job.organization_id,
        &state.config.owner_report_worker_name,
        ReportPreviewRequest {
            company_id: payload.company_id,
            date,
            timezone: payload.timezone,
        },
    )
    .await
    .map_err(|error| anyhow::anyhow!("build owner report preview: {error:?}"))?;
    let pdf = render_pdf(state, &preview)
        .await
        .map_err(|error| anyhow::anyhow!("render owner report PDF: {error:?}"))?;
    let artifact = record_generated_report(
        state,
        &state.stdb,
        job.organization_id,
        &preview,
        &pdf,
        Some(&format!(
            "scheduled-run-{}",
            payload.scheduled_report_run_id
        )),
    )
    .await
    .map_err(|error| anyhow::anyhow!("record owner report artifact: {error:?}"))?;
    state
        .stdb
        .call_reducer(
            "complete_scheduled_owner_report_run",
            json!([
                job.organization_id,
                payload.scheduled_report_run_id,
                artifact.id,
                artifact.document_id,
            ]),
        )
        .await?;
    state
        .stdb
        .call_reducer(
            "complete_queue_job",
            json!([job.organization_id, job.id, null]),
        )
        .await?;
    Ok(())
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

    #[test]
    fn monthly_schedule_uses_completed_calendar_month() {
        let timezone = "UTC".parse::<Tz>().expect("UTC timezone");
        let date = report_date(ReportKey::MonthlyOwnerReportV1, timezone).expect("report date");
        assert!(date.ends_with("-01"));
    }
}
