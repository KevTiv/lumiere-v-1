//! Focused reducer tests for durable queue delivery semantics.
use std::time::Duration;

use spacetimedb::{ReducerContext, Table};

use crate::core::organization::{create_organization, organization, CreateOrganizationParams};
use crate::core::queue::{
    cancel_queue_job, claim_queue_job, complete_queue_job, enqueue_job, queue_attempt,
    queue_effect_receipt, queue_job, queue_worker, register_queue_worker,
    retry_dead_letter_queue_job, worker_heartbeat, CancelQueueJobParams, ClaimQueueJobParams,
    CompleteQueueJobParams, EnqueueJobParams, RegisterQueueWorkerParams, RetryDeadLetterJobParams,
};
use crate::types::{QueueAttemptOutcome, QueueCompletionOutcome, QueueJobStatus};

fn create_test_organization(ctx: &ReducerContext, code: &str, name: &str) -> Result<u64, String> {
    create_organization(
        ctx,
        CreateOrganizationParams {
            name: name.to_string(),
            code: code.to_string(),
            timezone: "UTC".to_string(),
            date_format: "YYYY-MM-DD".to_string(),
            language: "en".to_string(),
            is_active: true,
            description: None,
            logo_url: None,
            website: None,
            email: None,
            phone: None,
            currency_id: None,
            metadata: None,
        },
    )?;
    ctx.db
        .organization()
        .iter()
        .find(|organization| organization.code == code)
        .map(|organization| organization.id)
        .ok_or_else(|| format!("test organization {code} was not created"))
}

fn register_test_worker(
    ctx: &ReducerContext,
    organization_id: u64,
    name: &str,
    queue: &str,
) -> Result<u64, String> {
    register_queue_worker(
        ctx,
        organization_id,
        RegisterQueueWorkerParams {
            company_id: None,
            name: name.to_string(),
            queues: vec![queue.to_string()],
            metadata: None,
        },
    )?;
    ctx.db
        .queue_worker()
        .iter()
        .find(|worker| worker.organization_id == organization_id && worker.name == name)
        .map(|worker| worker.id)
        .ok_or("test queue worker was not created".to_string())
}

fn enqueue_test_job(
    ctx: &ReducerContext,
    organization_id: u64,
    semantic_key: &str,
    payload: &str,
    max_attempts: u32,
) -> Result<u64, String> {
    enqueue_job(
        ctx,
        organization_id,
        EnqueueJobParams {
            company_id: None,
            queue_name: "test".to_string(),
            job_type: "test.execute".to_string(),
            payload: payload.to_string(),
            semantic_key: semantic_key.to_string(),
            priority: 5,
            max_attempts,
            available_at_micros: None,
            correlation_id: format!("correlation:{semantic_key}"),
            causation_id: Some("queue-test".to_string()),
            metadata: None,
        },
    )?;
    ctx.db
        .queue_job()
        .iter()
        .find(|job| job.organization_id == organization_id && job.semantic_key == semantic_key)
        .map(|job| job.id)
        .ok_or("test queue job was not created".to_string())
}

fn claim_params(
    ctx: &ReducerContext,
    expected_revision: u64,
    worker_id: u64,
    token: &str,
) -> ClaimQueueJobParams {
    ClaimQueueJobParams {
        expected_revision,
        worker_id,
        lease_token: token.to_string(),
        lease_expires_at_micros: (ctx.timestamp + Duration::from_secs(60))
            .to_micros_since_unix_epoch() as u64,
    }
}

/// Covers enqueue replay/conflict, serialized claims, completion replay and receipts.
#[spacetimedb::reducer]
pub fn test_queue_system(ctx: &ReducerContext) -> Result<(), String> {
    let organization_id = create_test_organization(ctx, "QUEUE_FINAL", "Queue Final Contract")?;
    let worker_id = register_test_worker(ctx, organization_id, "worker-a", "test")?;

    let job_id = enqueue_test_job(ctx, organization_id, "semantic:one", r#"{"b":2,"a":1}"#, 3)?;
    enqueue_test_job(
        ctx,
        organization_id,
        "semantic:one",
        r#"{ "a": 1, "b": 2 }"#,
        3,
    )?;
    let replay_count = ctx
        .db
        .queue_job()
        .iter()
        .filter(|job| job.organization_id == organization_id && job.semantic_key == "semantic:one")
        .count();
    assert_eq!(replay_count, 1, "identical replay inserted another job");

    let conflict = enqueue_job(
        ctx,
        organization_id,
        EnqueueJobParams {
            company_id: None,
            queue_name: "test".to_string(),
            job_type: "test.execute".to_string(),
            payload: r#"{"a":2}"#.to_string(),
            semantic_key: "semantic:one".to_string(),
            priority: 5,
            max_attempts: 3,
            available_at_micros: None,
            correlation_id: "correlation:semantic:one".to_string(),
            causation_id: None,
            metadata: None,
        },
    );
    assert!(
        conflict.is_err(),
        "semantic-key input conflict was accepted"
    );

    claim_queue_job(
        ctx,
        organization_id,
        job_id,
        claim_params(ctx, 0, worker_id, "lease-one"),
    )?;
    let duplicate_claim = claim_queue_job(
        ctx,
        organization_id,
        job_id,
        claim_params(ctx, 0, worker_id, "lease-two"),
    );
    assert!(
        duplicate_claim.is_err(),
        "a stale concurrent claim succeeded"
    );

    complete_queue_job(
        ctx,
        organization_id,
        job_id,
        CompleteQueueJobParams {
            expected_revision: 1,
            worker_id,
            lease_token: "lease-one".to_string(),
            outcome: QueueCompletionOutcome::Succeeded,
            error_summary: None,
            response_fingerprint: Some("response:v1".to_string()),
            retry_jitter_micros: 0,
        },
    )?;
    // Identical callback replay is a no-op even though its revision is stale.
    complete_queue_job(
        ctx,
        organization_id,
        job_id,
        CompleteQueueJobParams {
            expected_revision: 1,
            worker_id,
            lease_token: "lease-one".to_string(),
            outcome: QueueCompletionOutcome::Succeeded,
            error_summary: None,
            response_fingerprint: Some("response:v1".to_string()),
            retry_jitter_micros: 0,
        },
    )?;

    let job = ctx
        .db
        .queue_job()
        .id()
        .find(&job_id)
        .ok_or("completed queue job disappeared")?;
    assert_eq!(job.status, QueueJobStatus::Completed);
    assert_eq!(job.revision, 2);
    assert_eq!(
        ctx.db
            .queue_effect_receipt()
            .queue_effect_receipt_by_job()
            .filter(&job_id)
            .count(),
        1
    );
    assert_eq!(
        ctx.db
            .queue_attempt()
            .queue_attempt_by_job()
            .filter(&job_id)
            .count(),
        2
    );
    Ok(())
}

/// Covers expired reclaim, stale completion, backoff, dead-letter retry and cancellation.
#[spacetimedb::reducer]
pub fn test_queue_job_edge_cases(ctx: &ReducerContext) -> Result<(), String> {
    let organization_id = create_test_organization(ctx, "QUEUE_EDGE_FINAL", "Queue Edge Final")?;
    let worker_a = register_test_worker(ctx, organization_id, "worker-a", "test")?;
    let worker_b = register_test_worker(ctx, organization_id, "worker-b", "test")?;

    let reclaimed_job_id = enqueue_test_job(ctx, organization_id, "semantic:reclaim", "{}", 3)?;
    claim_queue_job(
        ctx,
        organization_id,
        reclaimed_job_id,
        claim_params(ctx, 0, worker_a, "expired-token"),
    )?;
    let leased = ctx
        .db
        .queue_job()
        .id()
        .find(&reclaimed_job_id)
        .ok_or("leased job disappeared")?;
    ctx.db
        .queue_job()
        .id()
        .update(crate::core::queue::QueueJob {
            lease_expires_at: Some(ctx.timestamp - Duration::from_secs(1)),
            ..leased
        });
    claim_queue_job(
        ctx,
        organization_id,
        reclaimed_job_id,
        claim_params(ctx, 1, worker_b, "replacement-token"),
    )?;
    let reclaimed = ctx
        .db
        .queue_job()
        .id()
        .find(&reclaimed_job_id)
        .ok_or("reclaimed job disappeared")?;
    assert_eq!(reclaimed.attempt_count, 2);
    assert_eq!(reclaimed.lease_worker_id, Some(worker_b));
    assert!(ctx
        .db
        .queue_attempt()
        .queue_attempt_by_job()
        .filter(&reclaimed_job_id)
        .any(|attempt| attempt.outcome == QueueAttemptOutcome::LeaseExpired));
    let stale_completion = complete_queue_job(
        ctx,
        organization_id,
        reclaimed_job_id,
        CompleteQueueJobParams {
            expected_revision: 1,
            worker_id: worker_a,
            lease_token: "expired-token".to_string(),
            outcome: QueueCompletionOutcome::Succeeded,
            error_summary: None,
            response_fingerprint: Some("stale".to_string()),
            retry_jitter_micros: 0,
        },
    );
    assert!(
        stale_completion.is_err(),
        "stale lease completion succeeded"
    );

    let dead_job_id = enqueue_test_job(ctx, organization_id, "semantic:dead", "{}", 1)?;
    claim_queue_job(
        ctx,
        organization_id,
        dead_job_id,
        claim_params(ctx, 0, worker_a, "dead-token"),
    )?;
    complete_queue_job(
        ctx,
        organization_id,
        dead_job_id,
        CompleteQueueJobParams {
            expected_revision: 1,
            worker_id: worker_a,
            lease_token: "dead-token".to_string(),
            outcome: QueueCompletionOutcome::Failed,
            error_summary: Some("provider unavailable".to_string()),
            response_fingerprint: None,
            retry_jitter_micros: 500,
        },
    )?;
    let dead = ctx
        .db
        .queue_job()
        .id()
        .find(&dead_job_id)
        .ok_or("dead-lettered job disappeared")?;
    assert_eq!(dead.status, QueueJobStatus::DeadLettered);
    assert!(dead.dead_lettered_at.is_some());

    retry_dead_letter_queue_job(
        ctx,
        organization_id,
        dead_job_id,
        RetryDeadLetterJobParams {
            expected_revision: dead.revision,
            available_at_micros: None,
            additional_attempts: 1,
            reason: "operator approved retry".to_string(),
        },
    )?;
    let retried = ctx
        .db
        .queue_job()
        .id()
        .find(&dead_job_id)
        .ok_or("retried job disappeared")?;
    assert_eq!(retried.status, QueueJobStatus::Pending);
    assert_eq!(retried.max_attempts, 2);

    cancel_queue_job(
        ctx,
        organization_id,
        dead_job_id,
        CancelQueueJobParams {
            expected_revision: retried.revision,
            reason: "work no longer required".to_string(),
        },
    )?;
    let cancelled = ctx
        .db
        .queue_job()
        .id()
        .find(&dead_job_id)
        .ok_or("cancelled job disappeared")?;
    assert_eq!(cancelled.status, QueueJobStatus::Cancelled);
    assert_eq!(
        cancelled.cancellation_reason.as_deref(),
        Some("work no longer required")
    );
    assert!(cancelled.cancelled_by.is_some());
    Ok(())
}

/// Covers worker validation, scoping and heartbeat evidence.
#[spacetimedb::reducer]
pub fn test_worker_edge_cases(ctx: &ReducerContext) -> Result<(), String> {
    let organization_id =
        create_test_organization(ctx, "QUEUE_WORKER_FINAL", "Queue Worker Final")?;
    let empty_registration = register_queue_worker(
        ctx,
        organization_id,
        RegisterQueueWorkerParams {
            company_id: None,
            name: "invalid-worker".to_string(),
            queues: Vec::new(),
            metadata: None,
        },
    );
    assert!(
        empty_registration.is_err(),
        "worker without a queue was accepted"
    );

    let worker_id = register_test_worker(ctx, organization_id, "worker", "test")?;
    worker_heartbeat(ctx, organization_id, worker_id)?;
    let worker = ctx
        .db
        .queue_worker()
        .id()
        .find(&worker_id)
        .ok_or("worker disappeared after heartbeat")?;
    assert_eq!(worker.organization_id, organization_id);
    assert!(worker.is_active);
    assert!(worker.last_heartbeat >= worker.started_at);
    Ok(())
}
