/// Async Queue System
///
/// Tables:  QueueJob · QueueWorker
/// Pattern: Jobs transition Pending → Processing → Completed | Failed.
///          Workers register themselves and send periodic heartbeats.
///          Use `enqueue_job` from any domain reducer that needs background work.
use spacetimedb::{ReducerContext, Table, Timestamp};

use crate::helpers::check_permission;
use crate::types::JobStatus;

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = queue_job,
    public,
    index(accessor = queue_job_by_org,   btree(columns = [organization_id])),
    index(accessor = queue_job_by_queue, btree(columns = [queue_name]))
)]
pub struct QueueJob {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub queue_name: String,
    pub job_type: String,
    pub payload: String, // JSON
    pub priority: i32,
    pub attempts: u32,
    pub max_attempts: u32,
    pub status: JobStatus,
    pub scheduled_at: Option<Timestamp>,
    pub started_at: Option<Timestamp>,
    pub completed_at: Option<Timestamp>,
    pub error_message: Option<String>,
    pub created_by: spacetimedb::Identity,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = queue_worker,
    public,
    index(accessor = worker_by_org, btree(columns = [organization_id]))
)]
pub struct QueueWorker {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub queues: Vec<String>,
    pub is_active: bool,
    pub last_heartbeat: Timestamp,
    pub started_at: Timestamp,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Push a new job onto a queue. Pass `scheduled_at_micros = Some(…)` for deferred jobs.
#[spacetimedb::reducer]
pub fn enqueue_job(
    ctx: &ReducerContext,
    organization_id: u64,
    queue_name: String,
    job_type: String,
    payload: String,
    priority: i32,
    max_attempts: u32,
    scheduled_at_micros: Option<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "queue_job", "create")?;

    let scheduled_at = scheduled_at_micros
        .map(|m| Timestamp::from_micros_since_unix_epoch(m as i64));

    let status = if scheduled_at.is_some() {
        JobStatus::Scheduled
    } else {
        JobStatus::Pending
    };

    ctx.db.queue_job().insert(QueueJob {
        id: 0,
        organization_id,
        queue_name,
        job_type,
        payload,
        priority,
        attempts: 0,
        max_attempts,
        status,
        scheduled_at,
        started_at: None,
        completed_at: None,
        error_message: None,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        metadata: None,
    });

    Ok(())
}

/// Atomically claim a Pending job for processing.
#[spacetimedb::reducer]
pub fn claim_queue_job(
    ctx: &ReducerContext,
    organization_id: u64,
    job_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "queue_job", "write")?;

    let job = ctx
        .db
        .queue_job()
        .id()
        .find(&job_id)
        .ok_or("Job not found")?;

    if job.organization_id != organization_id {
        return Err("Job does not belong to this organization".to_string());
    }
    if job.status != JobStatus::Pending {
        return Err("Job is not in Pending status".to_string());
    }

    ctx.db.queue_job().id().update(QueueJob {
        status: JobStatus::Processing,
        attempts: job.attempts + 1,
        started_at: Some(ctx.timestamp),
        ..job
    });

    Ok(())
}

/// Mark a job as completed or failed. Pass `error_message = Some(…)` for failures.
/// A failed job will be reset to Pending if it has remaining attempts.
#[spacetimedb::reducer]
pub fn complete_queue_job(
    ctx: &ReducerContext,
    organization_id: u64,
    job_id: u64,
    error_message: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "queue_job", "write")?;

    let job = ctx
        .db
        .queue_job()
        .id()
        .find(&job_id)
        .ok_or("Job not found")?;

    let status = match &error_message {
        None => JobStatus::Completed,
        Some(_) if job.attempts >= job.max_attempts => JobStatus::Failed,
        Some(_) => JobStatus::Pending, // retry
    };

    ctx.db.queue_job().id().update(QueueJob {
        status,
        completed_at: Some(ctx.timestamp),
        error_message,
        ..job
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn register_queue_worker(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    queues: Vec<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "queue_worker", "create")?;

    ctx.db.queue_worker().insert(QueueWorker {
        id: 0,
        organization_id,
        name,
        queues,
        is_active: true,
        last_heartbeat: ctx.timestamp,
        started_at: ctx.timestamp,
        metadata: None,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn worker_heartbeat(
    ctx: &ReducerContext,
    organization_id: u64,
    worker_id: u64,
) -> Result<(), String> {
    let worker = ctx
        .db
        .queue_worker()
        .id()
        .find(&worker_id)
        .ok_or("Worker not found")?;

    if worker.organization_id != organization_id {
        return Err("Worker does not belong to this organization".to_string());
    }

    ctx.db.queue_worker().id().update(QueueWorker {
        last_heartbeat: ctx.timestamp,
        ..worker
    });

    Ok(())
}
