/// Queue Module Tests
///
/// Test reducers for QueueJob and QueueWorker tables.
use spacetimedb::{ReducerContext, Table};

use crate::core::queue::{
    queue_job, queue_worker,
    enqueue_job, claim_queue_job, complete_queue_job, register_queue_worker,
    worker_heartbeat,
};
use crate::core::organization::{organization, create_organization};
use crate::types::JobStatus;

/// Test queue system lifecycle
#[spacetimedb::reducer]
pub fn test_queue_system(ctx: &ReducerContext) -> Result<(), String> {
    // Test 1: Create test organization
    log::info!("TEST: Creating test organization...");
    create_organization(
        ctx,
        "Queue Test Org".to_string(),
        "QUEUEORG".to_string(),
        "UTC".to_string(),
        "YYYY-MM-DD".to_string(),
        "en".to_string(),
    )?;

    let org = ctx.db.organization()
        .iter()
        .find(|o| o.code == "QUEUEORG")
        .ok_or("Test organization not found")?;

    let org_id = org.id;
    log::info!("✓ Test organization created");

    // Test 2: Register queue worker
    log::info!("TEST: Registering queue worker...");
    register_queue_worker(
        ctx,
        org_id,
        "worker-001".to_string(),
        vec!["default".to_string(), "priority".to_string()],
    )?;

    let worker = ctx.db.queue_worker()
        .iter()
        .find(|w| w.name == "worker-001" && w.organization_id == org_id)
        .ok_or("Worker not registered")?;

    assert_eq!(worker.name, "worker-001");
    assert_eq!(worker.queues, vec!["default", "priority"]);
    assert!(worker.is_active);
    log::info!("✓ Queue worker registered");

    let worker_id = worker.id;

    // Test 3: Worker heartbeat
    log::info!("TEST: Worker heartbeat...");
    worker_heartbeat(ctx, org_id, worker_id)?;

    let worker_after_beat = ctx.db.queue_worker()
        .id()
        .find(&worker_id)
        .ok_or("Worker not found after heartbeat")?;

    assert!(worker_after_beat.last_heartbeat.to_micros_since_unix_epoch() > 0);
    log::info!("✓ Worker heartbeat updated");

    // Test 4: Enqueue immediate job
    log::info!("TEST: Enqueuing immediate job...");
    enqueue_job(
        ctx,
        org_id,
        "default".to_string(),
        "process_data".to_string(),
        r#"{"file": "data.csv", "format": "csv"}"#.to_string(),
        5, // priority
        3, // max_attempts
        None, // immediate
    )?;

    let jobs: Vec<_> = ctx.db.queue_job()
        .iter()
        .filter(|j| j.organization_id == org_id && j.queue_name == "default")
        .collect();

    assert!(!jobs.is_empty());

    let job = jobs.iter()
        .find(|j| j.job_type == "process_data")
        .ok_or("Job not found")?;

    assert_eq!(job.status, JobStatus::Pending);
    assert_eq!(job.priority, 5);
    assert_eq!(job.max_attempts, 3);
    assert_eq!(job.attempts, 0);
    assert!(job.scheduled_at.is_none());
    log::info!("✓ Immediate job enqueued");

    let job_id = job.id;

    // Test 5: Enqueue scheduled job
    log::info!("TEST: Enqueuing scheduled job...");
    let future_time = ctx.timestamp + std::time::Duration::from_secs(3600);
    let future_micros = future_time.to_micros_since_unix_epoch() as u64;

    enqueue_job(
        ctx,
        org_id,
        "priority".to_string(),
        "send_report".to_string(),
        r#"{"report_type": "daily"}"#.to_string(),
        10,
        5,
        Some(future_micros),
    )?;

    let scheduled_jobs: Vec<_> = ctx.db.queue_job()
        .iter()
        .filter(|j| j.job_type == "send_report")
        .collect();

    assert_eq!(scheduled_jobs.len(), 1);

    let scheduled_job = &scheduled_jobs[0];
    assert_eq!(scheduled_job.status, JobStatus::Scheduled);
    assert!(scheduled_job.scheduled_at.is_some());
    log::info!("✓ Scheduled job enqueued");

    // Test 6: Claim pending job
    log::info!("TEST: Claiming pending job...");
    claim_queue_job(ctx, org_id, job_id)?;

    let claimed_job = ctx.db.queue_job()
        .id()
        .find(&job_id)
        .ok_or("Job not found after claim")?;

    assert_eq!(claimed_job.status, JobStatus::Processing);
    assert_eq!(claimed_job.attempts, 1);
    assert!(claimed_job.started_at.is_some());
    log::info!("✓ Job claimed successfully");

    // Test 7: Complete job successfully
    log::info!("TEST: Completing job successfully...");
    complete_queue_job(ctx, org_id, job_id, None)?;

    let completed_job = ctx.db.queue_job()
        .id()
        .find(&job_id)
        .ok_or("Job not found after completion")?;

    assert_eq!(completed_job.status, JobStatus::Completed);
    assert!(completed_job.completed_at.is_some());
    assert!(completed_job.error_message.is_none());
    log::info!("✓ Job completed successfully");

    // Test 8: Job failure and retry
    log::info!("TEST: Job failure and retry...");
    enqueue_job(
        ctx,
        org_id,
        "default".to_string(),
        "failing_job".to_string(),
        "{}".to_string(),
        1,
        3, // max_attempts = 3
        None,
    )?;

    let fail_job = ctx.db.queue_job()
        .iter()
        .find(|j| j.job_type == "failing_job")
        .ok_or("Failing job not found")?;

    let fail_job_id = fail_job.id;

    // First attempt - claim
    claim_queue_job(ctx, org_id, fail_job_id)?;
    // First failure
    complete_queue_job(ctx, org_id, fail_job_id, Some("Temporary error".to_string()))?;

    let after_fail = ctx.db.queue_job()
        .id()
        .find(&fail_job_id)
        .ok_or("Job not found after first failure")?;

    assert_eq!(after_fail.status, JobStatus::Pending); // Should be retryable
    assert_eq!(after_fail.attempts, 1);
    assert!(after_fail.error_message.is_some());

    // Second attempt - claim again
    claim_queue_job(ctx, org_id, fail_job_id)?;
    // Second failure
    complete_queue_job(ctx, org_id, fail_job_id, Some("Another error".to_string()))?;

    let after_second_fail = ctx.db.queue_job()
        .id()
        .find(&fail_job_id)
        .ok_or("Job not found after second failure")?;

    assert_eq!(after_second_fail.status, JobStatus::Pending); // Still retryable
    assert_eq!(after_second_fail.attempts, 2);

    // Third attempt - claim
    claim_queue_job(ctx, org_id, fail_job_id)?;
    // Third failure - should mark as failed (max_attempts = 3)
    complete_queue_job(ctx, org_id, fail_job_id, Some("Final error".to_string()))?;

    let final_fail = ctx.db.queue_job()
        .id()
        .find(&fail_job_id)
        .ok_or("Job not found after final failure")?;

    assert_eq!(final_fail.status, JobStatus::Failed);
    assert_eq!(final_fail.attempts, 3);
    log::info!("✓ Job failure and retry handled correctly");

    // Test 9: Verify job lookup by organization
    log::info!("TEST: Verifying job lookup by organization...");
    let org_jobs: Vec<_> = ctx.db.queue_job()
        .queue_job_by_org()
        .filter(&org_id)
        .collect();

    assert!(org_jobs.len() >= 3);
    log::info!("✓ Job lookup by organization works");

    // Test 10: Verify job lookup by queue
    log::info!("TEST: Verifying job lookup by queue...");
    let default_jobs: Vec<_> = ctx.db.queue_job()
        .queue_job_by_queue()
        .filter(&"default".to_string())
        .collect();

    assert!(!default_jobs.is_empty());
    log::info!("✓ Job lookup by queue works");

    // Test 11: Error - claim already processing job
    log::info!("TEST: Error - claim already processing job...");
    enqueue_job(
        ctx,
        org_id,
        "default".to_string(),
        "processing_job".to_string(),
        "{}".to_string(),
        1,
        1,
        None,
    )?;

    let proc_job = ctx.db.queue_job()
        .iter()
        .find(|j| j.job_type == "processing_job")
        .ok_or("Processing job not found")?;

    let proc_job_id = proc_job.id;

    claim_queue_job(ctx, org_id, proc_job_id)?;

    let double_claim = claim_queue_job(ctx, org_id, proc_job_id);
    assert!(double_claim.is_err());
    log::info!("✓ Double claim prevented");

    // Test 12: Error - claim job from different organization
    log::info!("TEST: Error - claim job from different org...");
    create_organization(
        ctx,
        "Other Queue Org".to_string(),
        "OTHERQORG".to_string(),
        "UTC".to_string(),
        "YYYY-MM-DD".to_string(),
        "en".to_string(),
    )?;

    let other_org = ctx.db.organization()
        .iter()
        .find(|o| o.code == "OTHERQORG")
        .ok_or("Other org not found")?;

    let wrong_org_claim = claim_queue_job(ctx, other_org.id, proc_job_id);
    assert!(wrong_org_claim.is_err());
    log::info!("✓ Cross-org claim prevented");

    log::info!("✅ All queue system tests passed!");
    Ok(())
}

/// Test queue job edge cases
#[spacetimedb::reducer]
pub fn test_queue_job_edge_cases(ctx: &ReducerContext) -> Result<(), String> {
    // Setup
    create_organization(
        ctx,
        "Queue Edge Org".to_string(),
        "QEDGEORG".to_string(),
        "UTC".to_string(),
        "YYYY-MM-DD".to_string(),
        "en".to_string(),
    )?;

    let org = ctx.db.organization()
        .iter()
        .find(|o| o.code == "QEDGEORG")
        .ok_or("Test org not found")?;

    register_queue_worker(
        ctx,
        org.id,
        "edge-worker".to_string(),
        vec!["edge-queue".to_string()],
    )?;

    // Test 1: Job with negative priority
    log::info!("TEST: Job with negative priority...");
    enqueue_job(
        ctx,
        org.id,
        "edge-queue".to_string(),
        "low_priority".to_string(),
        "{}".to_string(),
        -10, // Negative priority
        1,
        None,
    )?;

    let low_priority = ctx.db.queue_job()
        .iter()
        .find(|j| j.job_type == "low_priority")
        .ok_or("Low priority job not found")?;

    if low_priority.priority != -10 {
        return Err("Negative priority not stored".to_string());
    }
    log::info!("✓ Negative priority stored");

    // Test 2: Job with high priority
    log::info!("TEST: Job with high priority...");
    enqueue_job(
        ctx,
        org.id,
        "edge-queue".to_string(),
        "high_priority".to_string(),
        "{}".to_string(),
        1000,
        1,
        None,
    )?;

    let high_priority = ctx.db.queue_job()
        .iter()
        .find(|j| j.job_type == "high_priority")
        .ok_or("High priority job not found")?;

    if high_priority.priority != 1000 {
        return Err("High priority not stored".to_string());
    }
    log::info!("✓ High priority stored");

    // Test 3: Job with large payload
    log::info!("TEST: Job with large payload...");
    let large_payload = r#"{"data": ""#.to_string() + &"x".repeat(10000) + r#""}"#;

    enqueue_job(
        ctx,
        org.id,
        "edge-queue".to_string(),
        "large_payload".to_string(),
        large_payload.clone(),
        5,
        1,
        None,
    )?;

    let large_job = ctx.db.queue_job()
        .iter()
        .find(|j| j.job_type == "large_payload")
        .ok_or("Large payload job not found")?;

    if large_job.payload.len() != large_payload.len() {
        return Err("Large payload not stored completely".to_string());
    }
    log::info!("✓ Large payload stored");

    // Test 4: Job with empty payload
    log::info!("TEST: Job with empty payload...");
    enqueue_job(
        ctx,
        org.id,
        "edge-queue".to_string(),
        "empty_payload".to_string(),
        "{}".to_string(),
        5,
        1,
        None,
    )?;

    let empty_job = ctx.db.queue_job()
        .iter()
        .find(|j| j.job_type == "empty_payload")
        .ok_or("Empty payload job not found")?;

    if empty_job.payload != "{}" {
        return Err("Empty payload not stored correctly".to_string());
    }
    log::info!("✓ Empty payload stored");

    // Test 5: Scheduled job in the past
    log::info!("TEST: Scheduled job in the past...");
    let past_time = ctx.timestamp - std::time::Duration::from_secs(3600);
    let past_micros = past_time.to_micros_since_unix_epoch() as u64;

    enqueue_job(
        ctx,
        org.id,
        "edge-queue".to_string(),
        "past_scheduled".to_string(),
        "{}".to_string(),
        5,
        1,
        Some(past_micros),
    )?;

    let past_job = ctx.db.queue_job()
        .iter()
        .find(|j| j.job_type == "past_scheduled")
        .ok_or("Past scheduled job not found")?;

    if past_job.status != JobStatus::Scheduled {
        return Err("Past job should still be scheduled".to_string());
    }
    log::info!("✓ Past scheduled job created");

    // Test 6: Verify timestamps
    log::info!("TEST: Verify timestamps...");
    let job = ctx.db.queue_job()
        .iter()
        .find(|j| j.job_type == "empty_payload")
        .ok_or("Job not found")?;

    if job.created_at.to_micros_since_unix_epoch() == 0 {
        return Err("Job created_at should be set".to_string());
    }
    log::info!("✓ Timestamps verified");

    log::info!("✅ Queue job edge case tests passed!");
    Ok(())
}

/// Test worker edge cases
#[spacetimedb::reducer]
pub fn test_worker_edge_cases(ctx: &ReducerContext) -> Result<(), String> {
    // Setup
    create_organization(
        ctx,
        "Worker Edge Org".to_string(),
        "WEDGEORG".to_string(),
        "UTC".to_string(),
        "YYYY-MM-DD".to_string(),
        "en".to_string(),
    )?;

    let org = ctx.db.organization()
        .iter()
        .find(|o| o.code == "WEDGEORG")
        .ok_or("Test org not found")?;

    // Test 1: Worker with no queues
    log::info!("TEST: Worker with no queues...");
    register_queue_worker(
        ctx,
        org.id,
        "no-queue-worker".to_string(),
        vec![], // Empty queues
    )?;

    let no_queue_worker = ctx.db.queue_worker()
        .iter()
        .find(|w| w.name == "no-queue-worker")
        .ok_or("No-queue worker not found")?;

    if !no_queue_worker.queues.is_empty() {
        return Err("Worker should have no queues".to_string());
    }
    log::info!("✓ Worker with no queues created");

    // Test 2: Worker with many queues
    log::info!("TEST: Worker with many queues...");
    let many_queues: Vec<String> = (0..10).map(|i| format!("queue_{}", i)).collect();

    register_queue_worker(
        ctx,
        org.id,
        "many-queue-worker".to_string(),
        many_queues.clone(),
    )?;

    let many_worker = ctx.db.queue_worker()
        .iter()
        .find(|w| w.name == "many-queue-worker")
        .ok_or("Many-queue worker not found")?;

    if many_worker.queues.len() != 10 {
        return Err(format!("Expected 10 queues, found {}", many_worker.queues.len()));
    }
    log::info!("✓ Worker with many queues created");

    // Test 3: Verify worker timestamps
    log::info!("TEST: Verify worker timestamps...");
    if many_worker.started_at.to_micros_since_unix_epoch() == 0 {
        return Err("Worker started_at should be set".to_string());
    }

    if many_worker.last_heartbeat.to_micros_since_unix_epoch() == 0 {
        return Err("Worker last_heartbeat should be set".to_string());
    }
    log::info!("✓ Worker timestamps verified");

    // Test 4: Multiple heartbeats
    log::info!("TEST: Multiple heartbeats...");
    for _ in 0..5 {
        worker_heartbeat(ctx, org.id, many_worker.id)?;
    }

    let worker_after = ctx.db.queue_worker()
        .id()
        .find(&many_worker.id)
        .ok_or("Worker not found after heartbeats")?;

    if worker_after.last_heartbeat <= many_worker.last_heartbeat {
        return Err("Heartbeat should update timestamp".to_string());
    }
    log::info!("✓ Multiple heartbeats handled");

    // Test 5: Worker lookup by organization
    log::info!("TEST: Worker lookup by organization...");
    let org_workers: Vec<_> = ctx.db.queue_worker()
        .worker_by_org()
        .filter(&org.id)
        .collect();

    if org_workers.len() != 2 {
        return Err(format!("Expected 2 workers, found {}", org_workers.len()));
    }
    log::info!("✓ Worker lookup by organization works");

    log::info!("✅ Worker edge case tests passed!");
    Ok(())
}
