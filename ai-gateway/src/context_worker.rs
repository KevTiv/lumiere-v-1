//! Drains the durable AI index queue under each actor's own live credentials.
//!
//! The queue (owned by the api-server, `lumiere_platform.ai_index_job`) holds an
//! actor identity and a record reference, never a token. There is therefore no
//! unattended background scan: a pending job is executed when the same actor next
//! presents a session (the BFF calls `/v1/context/index-jobs/drain` after the
//! actor's writes). Jobs run through `ingest_references`, so spend admission, the
//! `embedding_index` action, field-level projection and publication revalidation
//! are identical to `/v1/context/ingest`. Retry backoff is applied by the queue.
use std::collections::BTreeMap;
use std::time::Duration;

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::{
    error::{AppError, AppResult},
    harness::{ActorCredentials, EntityRef},
    routes::context::{ingest_references, IngestOutcome, IngestReport},
    state::AppState,
};

/// Same bound as `/v1/context/ingest`.
pub(crate) const BATCH_SIZE: usize = 8;
const QUEUE_TIMEOUT: Duration = Duration::from_secs(10);

/// Background scanning has no actor credentials or current indexing grant, so
/// nothing runs unattended; jobs drain through [`post_drain`].
pub async fn run(_state: AppState) {
    info!("AI index queue drains under each actor's own session; no unattended scan runs");
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueuedJob {
    pub id: i64,
    pub company_id: u64,
    pub resource_kind: String,
    pub resource_id: u64,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JobReport {
    pub id: i64,
    pub content_hash: String,
    pub outcome: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Default, Serialize, PartialEq, Eq)]
pub(crate) struct DrainSummary {
    pub claimed: usize,
    pub indexed: usize,
    pub unchanged: usize,
    pub withheld: usize,
    pub failed: usize,
}

/// Group by company (each ingest call is company-scoped) in batches of at most
/// [`BATCH_SIZE`], preserving queue order.
pub(crate) fn plan_batches(jobs: Vec<QueuedJob>) -> Vec<(u64, Vec<QueuedJob>)> {
    let mut by_company: BTreeMap<u64, Vec<QueuedJob>> = BTreeMap::new();
    for job in jobs {
        by_company.entry(job.company_id).or_default().push(job);
    }
    by_company
        .into_iter()
        .flat_map(|(company, jobs)| {
            jobs.chunks(BATCH_SIZE)
                .map(|chunk| (company, chunk.to_vec()))
                .collect::<Vec<_>>()
        })
        .collect()
}

pub(crate) fn entity_refs(jobs: &[QueuedJob]) -> Vec<EntityRef> {
    jobs.iter()
        .map(|job| EntityRef {
            entity_type: job.resource_kind.clone(),
            entity_id: job.resource_id,
            priority: 1.0,
        })
        .collect()
}

/// Map an ingest pass onto queue outcomes. A job with no reported outcome is a
/// failure (retried), never a silent success.
pub(crate) fn reports_for_ingest(jobs: &[QueuedJob], report: &IngestReport) -> Vec<JobReport> {
    jobs.iter()
        .map(|job| {
            let outcome = report
                .outcomes
                .iter()
                .find(|(kind, id, _)| *kind == job.resource_kind && *id == job.resource_id)
                .map(|(_, _, outcome)| *outcome);
            let (outcome, error) = match outcome {
                Some(IngestOutcome::Indexed) => ("indexed", None),
                Some(IngestOutcome::Unchanged) => ("unchanged", None),
                Some(IngestOutcome::Withheld) => ("withheld", None),
                None => ("failed", Some("no indexing outcome".to_owned())),
            };
            JobReport {
                id: job.id,
                content_hash: job.content_hash.clone(),
                outcome,
                error,
            }
        })
        .collect()
}

/// Failures record only a coarse class; provider and database detail never
/// reaches the queue.
pub(crate) fn reports_for_failure(jobs: &[QueuedJob], error: &AppError) -> Vec<JobReport> {
    let class = match error {
        AppError::Forbidden(_) => "indexing not permitted",
        AppError::BadRequest(_) => "projection rejected",
        _ => "indexing unavailable",
    };
    jobs.iter()
        .map(|job| JobReport {
            id: job.id,
            content_hash: job.content_hash.clone(),
            outcome: "failed",
            error: Some(class.to_owned()),
        })
        .collect()
}

fn queue_url(state: &AppState, path: &str) -> AppResult<String> {
    let base = state
        .config
        .api_server_url
        .as_deref()
        .ok_or_else(|| AppError::Unavailable("AI indexing queue is unavailable".into()))?;
    Ok(format!(
        "{}/v1/ai/index-jobs/{path}",
        base.trim_end_matches('/')
    ))
}

async fn claim(state: &AppState, actor: &ActorCredentials) -> AppResult<Vec<QueuedJob>> {
    #[derive(Deserialize)]
    struct Claimed {
        jobs: Vec<QueuedJob>,
    }
    let response = state
        .http
        .post(queue_url(state, "claim")?)
        .bearer_auth(&actor.stdb_token)
        .header("x-stdb-identity", &actor.identity_hex)
        .timeout(QUEUE_TIMEOUT)
        .send()
        .await
        .map_err(|_| AppError::Unavailable("AI indexing queue is unavailable".into()))?;
    if !response.status().is_success() {
        return Err(AppError::Unavailable(
            "AI indexing queue is unavailable".into(),
        ));
    }
    let claimed: Claimed = response
        .json()
        .await
        .map_err(|_| AppError::Unavailable("AI indexing queue is unavailable".into()))?;
    Ok(claimed.jobs)
}

async fn report(
    state: &AppState,
    actor: &ActorCredentials,
    reports: &[JobReport],
) -> AppResult<()> {
    let response = state
        .http
        .post(queue_url(state, "report")?)
        .bearer_auth(&actor.stdb_token)
        .header("x-stdb-identity", &actor.identity_hex)
        .timeout(QUEUE_TIMEOUT)
        .json(&serde_json::json!({ "outcomes": reports }))
        .send()
        .await
        .map_err(|_| AppError::Unavailable("AI indexing queue is unavailable".into()))?;
    if !response.status().is_success() {
        return Err(AppError::Unavailable(
            "AI indexing queue is unavailable".into(),
        ));
    }
    Ok(())
}

fn tally(summary: &mut DrainSummary, reports: &[JobReport]) {
    for report in reports {
        match report.outcome {
            "indexed" => summary.indexed += 1,
            "unchanged" => summary.unchanged += 1,
            "withheld" => summary.withheld += 1,
            _ => summary.failed += 1,
        }
    }
}

/// Lease this actor's due jobs and index them. A failed batch stops the pass so
/// a provider outage is not hammered; the queue backs the failed jobs off.
pub(crate) async fn drain_actor(
    state: &AppState,
    actor: &ActorCredentials,
    org_id: u64,
) -> AppResult<DrainSummary> {
    let mut summary = DrainSummary::default();
    if !state.config.embedding_enabled() {
        return Ok(summary);
    }
    let jobs = claim(state, actor).await?;
    summary.claimed = jobs.len();
    for (company_id, batch) in plan_batches(jobs) {
        let refs = entity_refs(&batch);
        let (reports, stop) = match ingest_references(state, actor, org_id, company_id, &refs).await
        {
            Ok(outcome) => (reports_for_ingest(&batch, &outcome), false),
            Err(error) => (reports_for_failure(&batch, &error), true),
        };
        tally(&mut summary, &reports);
        report(state, actor, &reports).await?;
        if stop {
            break;
        }
    }
    Ok(summary)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DrainRequest {
    pub org_id: u64,
    pub stdb_token: String,
    pub identity_hex: String,
}

pub async fn post_drain(
    State(state): State<AppState>,
    Json(req): Json<DrainRequest>,
) -> AppResult<Json<serde_json::Value>> {
    let actor = ActorCredentials::new(req.stdb_token, req.identity_hex)
        .map_err(|_| AppError::Forbidden("authenticated actor required".into()))?;
    let summary = drain_actor(&state, &actor, req.org_id).await?;
    Ok(Json(serde_json::json!(summary)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(id: i64, company_id: u64, kind: &str, resource_id: u64) -> QueuedJob {
        QueuedJob {
            id,
            company_id,
            resource_kind: kind.into(),
            resource_id,
            content_hash: format!("hash-{id}"),
        }
    }

    #[test]
    fn batches_are_company_scoped_and_at_most_eight() {
        let mut jobs: Vec<_> = (1..=10)
            .map(|id| job(id, 7, "sale_order", id as u64))
            .collect();
        jobs.push(job(11, 3, "contact", 5));
        let batches = plan_batches(jobs);
        assert_eq!(batches.len(), 3);
        assert_eq!(batches[0].0, 3);
        assert_eq!(batches[0].1.len(), 1);
        assert_eq!(batches[1].0, 7);
        assert_eq!(batches[1].1.len(), BATCH_SIZE);
        assert_eq!(batches[2].1.len(), 2);
        assert!(batches.iter().all(|(_, b)| b.len() <= BATCH_SIZE));
        assert!(plan_batches(Vec::new()).is_empty());
    }

    #[test]
    fn ingest_outcomes_map_to_queue_outcomes_including_withheld() {
        let jobs = vec![
            job(1, 7, "sale_order", 10),
            job(2, 7, "sale_order", 11),
            job(3, 7, "contact", 12),
            job(4, 7, "product", 13),
        ];
        let report = IngestReport {
            indexed: 1,
            unchanged: 1,
            withheld: 1,
            outcomes: vec![
                ("sale_order".into(), 10, IngestOutcome::Indexed),
                ("sale_order".into(), 11, IngestOutcome::Unchanged),
                ("contact".into(), 12, IngestOutcome::Withheld),
            ],
        };
        let reports = reports_for_ingest(&jobs, &report);
        let outcomes: Vec<_> = reports.iter().map(|r| r.outcome).collect();
        assert_eq!(outcomes, ["indexed", "unchanged", "withheld", "failed"]);
        assert!(reports[2].error.is_none());
        assert_eq!(reports[3].error.as_deref(), Some("no indexing outcome"));
        assert_eq!(reports[0].content_hash, "hash-1");
    }

    #[test]
    fn failures_record_only_a_coarse_class() {
        let jobs = vec![job(1, 7, "sale_order", 10)];
        let secret = AppError::Unavailable("provider key sk-secret rejected".into());
        let reports = reports_for_failure(&jobs, &secret);
        assert_eq!(reports[0].outcome, "failed");
        assert_eq!(reports[0].error.as_deref(), Some("indexing unavailable"));
        assert!(!serde_json::to_string(&reports)
            .unwrap()
            .contains("sk-secret"));
        let denied = reports_for_failure(&jobs, &AppError::Forbidden("x".into()));
        assert_eq!(denied[0].error.as_deref(), Some("indexing not permitted"));
    }

    #[test]
    fn summary_counts_each_outcome() {
        let jobs = vec![job(1, 7, "a", 1), job(2, 7, "a", 2)];
        let mut summary = DrainSummary::default();
        tally(
            &mut summary,
            &reports_for_failure(&jobs, &AppError::BadRequest("x".into())),
        );
        assert_eq!(summary.failed, 2);
        assert_eq!(summary.indexed, 0);
    }

    #[test]
    fn drain_request_rejects_unknown_fields_and_carries_no_stored_credential_field() {
        assert!(serde_json::from_value::<DrainRequest>(serde_json::json!({
            "org_id": 1, "stdb_token": "t", "identity_hex": "i", "company_id": 2
        }))
        .is_err());
    }
}
