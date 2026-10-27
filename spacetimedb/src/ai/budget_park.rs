//! Park and resume for governed AI runs blocked by a budget window or a
//! provider rate limit (T3 V2 adoption plan section 7.2, AIH-24 addition).
//!
//! A run that spend admission (or a provider 429) blocks does not end. At a
//! step boundary it moves to the durable lifecycle state `budget_parked`,
//! recording the reason, the expected reset time and the reservation it needs.
//! Parking is refused while any effect is `dispatched` or `uncertain`, or while
//! the run still holds a `reserved` spend reservation (an `outcome_unknown`
//! provider attempt keeps its reservation reserved), so an in-flight effect is
//! always reconciled first and a parked run holds no reservation.
//!
//! A scheduled reducer fires at the reset time and ONLY records a resume
//! intent (`resume_requested`). It grants nothing: the trusted gateway reactor
//! re-runs full spend admission at current pricing and then resolves the park
//! through `resolve_ai_run_budget_park` (resume, stay parked, wait for an
//! operator, or terminate). Every transition is bound to the checked
//! continuation, a park generation and an idempotency key, so a duplicate
//! schedule firing or a replayed resolution cannot resume the run twice.
//!
//! Reducers here are deterministic: time comes only from `ctx.timestamp`.

use spacetimedb::{reducer, ReducerContext, ScheduleAt, SpacetimeType, Table, Timestamp};

use crate::ai::run_lifecycle::{
    ai_run_effect, ai_run_lifecycle_state, append_event, authorize, checked_state, command_hash,
    event_key, load_run, replayed, transition_state_and_run, validate_key, RunContinuationParams,
};
use crate::ai::skills::{ai_agent_run, AiAgentRun};
use crate::ai::spend::ai_spend_reservation;
use crate::helpers::{write_audit_log_v2, AuditLogParams};

pub const PARK_REASON_BUDGET_EXHAUSTED: &str = "budget_exhausted";
pub const PARK_REASON_PROVIDER_RATE_LIMIT: &str = "provider_rate_limit";

pub const PARK_STATUS_PARKED: &str = "parked";
pub const PARK_STATUS_RESUME_REQUESTED: &str = "resume_requested";
pub const PARK_STATUS_RESUMED: &str = "resumed";
pub const PARK_STATUS_WAITING_INPUT: &str = "waiting_input";
pub const PARK_STATUS_TERMINATED: &str = "terminated";
pub const PARK_STATUS_SUPERSEDED: &str = "superseded";

pub const PARK_TRIGGER_WINDOW_RESET: &str = "window_reset";
pub const PARK_TRIGGER_MAX_PARK_ELAPSED: &str = "max_park_elapsed";

pub const LIFECYCLE_BUDGET_PARKED: &str = "budget_parked";

/// Absolute module-side ceiling; the gateway applies its own (smaller)
/// configured maximum park duration.
const HARD_MAX_PARK_SECONDS: i64 = 40 * 24 * 60 * 60;

// ── Tables ───────────────────────────────────────────────────────────────────

/// Current park record for a run. Only the latest generation is kept; the
/// immutable lifecycle events carry the history.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_run_budget_park,
    index(accessor = ai_run_budget_park_by_org, btree(columns = [organization_id])),
    index(accessor = ai_run_budget_park_by_status, btree(columns = [status]))
)]
pub struct AiRunBudgetPark {
    #[primary_key]
    pub run_id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub park_generation: u64,
    pub reason: String,
    pub status: String,
    pub window_resets_at: Timestamp,
    pub max_park_until: Timestamp,
    pub required_units: u64,
    pub input_token_allowance: u32,
    pub output_token_allowance: u32,
    /// Binding of the blocked call, so the reactor can re-price the same
    /// allowance at current pricing without trusting the earlier snapshot.
    pub agent_id: u64,
    pub provider: String,
    pub model: String,
    pub schedule_id: Option<u64>,
    pub resume_trigger: Option<String>,
    pub resolution: Option<String>,
    pub parked_at: Timestamp,
    pub resume_requested_at: Option<Timestamp>,
    pub resolved_at: Option<Timestamp>,
}

/// One-shot schedule. Firing records an intent only; see module docs.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_run_budget_resume_job,
    index(accessor = ai_run_budget_resume_job_by_run, btree(columns = [run_id])),
    scheduled(fire_ai_run_budget_resume)
)]
pub struct AiRunBudgetResumeJob {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
    pub organization_id: u64,
    pub company_id: u64,
    pub run_id: u64,
    pub park_generation: u64,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct ParkAiRunForBudgetParams {
    pub continuation: RunContinuationParams,
    pub reason: String,
    pub window_resets_at_micros: i64,
    pub max_park_until_micros: i64,
    pub required_units: u64,
    pub input_token_allowance: u32,
    pub output_token_allowance: u32,
    pub agent_id: u64,
    pub provider: String,
    pub model: String,
    pub idempotency_key: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ResolveAiRunBudgetParkParams {
    pub continuation: RunContinuationParams,
    pub park_generation: u64,
    /// resume | stay_parked | waiting_input | terminate
    pub outcome: String,
    /// Terminal reason for `terminate`: max_park_duration | deadline |
    /// operator_cancel | resume_dispatch_failed. Empty for other outcomes.
    pub detail: String,
    /// New expected reset for `stay_parked`; 0 for other outcomes.
    pub next_window_resets_at_micros: i64,
    pub idempotency_key: String,
}

// ── Pure decision logic ──────────────────────────────────────────────────────

/// What currently stands between a run and a safe park boundary.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct ParkBlockers {
    pub dispatched_or_uncertain_effect: bool,
    pub reserved_spend: bool,
}

pub(crate) fn ensure_safe_boundary(blockers: ParkBlockers) -> Result<(), String> {
    if blockers.dispatched_or_uncertain_effect {
        return Err(
            "run has a dispatched or uncertain effect; reconcile it before parking".into(),
        );
    }
    if blockers.reserved_spend {
        return Err(
            "run still holds a spend reservation or unresolved provider attempt; reconcile it before parking"
                .into(),
        );
    }
    Ok(())
}

fn valid_reason(reason: &str) -> bool {
    matches!(
        reason,
        PARK_REASON_BUDGET_EXHAUSTED | PARK_REASON_PROVIDER_RATE_LIMIT
    )
}

/// Validate the requested window and return when the intent job must fire:
/// the reset time, or the maximum park time when that comes first.
pub(crate) fn plan_schedule(
    now_micros: i64,
    window_resets_at_micros: i64,
    max_park_until_micros: i64,
) -> Result<i64, String> {
    let hard_cap = now_micros
        .checked_add(HARD_MAX_PARK_SECONDS * 1_000_000)
        .ok_or("park window overflow")?;
    if window_resets_at_micros <= now_micros {
        return Err("window_resets_at must be in the future".into());
    }
    if max_park_until_micros <= now_micros {
        return Err("max park duration must end in the future".into());
    }
    if max_park_until_micros > hard_cap {
        return Err("max park duration exceeds the module ceiling".into());
    }
    Ok(window_resets_at_micros.min(max_park_until_micros))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FireEffect {
    Ignore,
    RecordIntent,
}

/// A schedule firing is honoured only for the current generation of a park
/// that is still waiting. Duplicate or stale firings are no-ops.
pub(crate) fn fire_effect(park_status: &str, park_generation: u64, job_generation: u64) -> FireEffect {
    if park_status == PARK_STATUS_PARKED && park_generation == job_generation {
        FireEffect::RecordIntent
    } else {
        FireEffect::Ignore
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Resolution {
    Resume,
    StayParked { next_reset_micros: i64 },
    WaitingInput,
    Terminate { detail: String, cancelled: bool },
}

pub(crate) struct ResolveInputs<'a> {
    pub park_status: &'a str,
    pub resume_trigger: Option<&'a str>,
    pub lifecycle_state: &'a str,
    pub now_micros: i64,
    pub max_park_until_micros: i64,
    pub outcome: &'a str,
    pub detail: Option<&'a str>,
    pub next_window_resets_at_micros: Option<i64>,
}

/// The only place the park state machine is defined.
///
/// parked | resume_requested -> waiting_input
/// resume_requested          -> resumed (running) | parked (re-armed)
/// waiting_input             -> resumed (operator raised the budget)
/// parked | resume_requested | waiting_input -> terminated
pub(crate) fn plan_resolution(input: ResolveInputs<'_>) -> Result<Resolution, String> {
    let open = matches!(
        input.park_status,
        PARK_STATUS_PARKED | PARK_STATUS_RESUME_REQUESTED | PARK_STATUS_WAITING_INPUT
    );
    if !open {
        return Err(format!("park is already {}", input.park_status));
    }
    match input.outcome {
        "resume" => {
            let from_intent = input.park_status == PARK_STATUS_RESUME_REQUESTED
                && input.lifecycle_state == LIFECYCLE_BUDGET_PARKED
                && input.resume_trigger == Some(PARK_TRIGGER_WINDOW_RESET);
            let from_operator = input.park_status == PARK_STATUS_WAITING_INPUT
                && input.lifecycle_state == "waiting_input";
            if from_intent || from_operator {
                Ok(Resolution::Resume)
            } else {
                Err("park has no recorded window-reset resume intent".into())
            }
        }
        "stay_parked" => {
            if input.park_status != PARK_STATUS_RESUME_REQUESTED
                || input.lifecycle_state != LIFECYCLE_BUDGET_PARKED
            {
                return Err("only a requested resume can be re-armed".into());
            }
            let next = input
                .next_window_resets_at_micros
                .ok_or("stay_parked requires next_window_resets_at_micros")?;
            if next <= input.now_micros {
                return Err("next window reset must be in the future".into());
            }
            if next > input.max_park_until_micros {
                return Err("next window reset is beyond the maximum park duration".into());
            }
            Ok(Resolution::StayParked {
                next_reset_micros: next,
            })
        }
        "waiting_input" => {
            if input.park_status == PARK_STATUS_WAITING_INPUT {
                return Err("park is already waiting for operator input".into());
            }
            if input.lifecycle_state != LIFECYCLE_BUDGET_PARKED {
                return Err("run is not budget parked".into());
            }
            Ok(Resolution::WaitingInput)
        }
        "terminate" => {
            let detail = input.detail.ok_or("terminate requires a detail code")?;
            match detail {
                "max_park_duration" | "deadline" => {
                    if input.now_micros < input.max_park_until_micros {
                        return Err("maximum park duration has not elapsed".into());
                    }
                }
                "operator_cancel" | "resume_dispatch_failed" => {}
                _ => return Err("unknown termination detail".into()),
            }
            Ok(Resolution::Terminate {
                detail: detail.to_string(),
                cancelled: detail == "operator_cancel",
            })
        }
        _ => Err("outcome must be resume, stay_parked, waiting_input, or terminate".into()),
    }
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn park_ai_run_for_budget(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: ParkAiRunForBudgetParams,
) -> Result<(), String> {
    authorize(ctx, organization_id)?;
    validate_key("idempotency_key", &params.idempotency_key)?;
    validate_key("provider", &params.provider)?;
    validate_key("model", &params.model)?;
    if !valid_reason(&params.reason) {
        return Err("reason must be budget_exhausted or provider_rate_limit".into());
    }
    let request_hash = command_hash("budget_parked", &params);
    let key = event_key(organization_id, run_id, &params.idempotency_key);
    if replayed(ctx, &key, "budget_parked", &request_hash)? {
        return Ok(());
    }
    let state = checked_state(
        ctx,
        organization_id,
        company_id,
        run_id,
        &params.continuation,
    )?;
    if state.state != "running" {
        return Err("only a running lifecycle can be budget parked".into());
    }
    let run = load_run(ctx, organization_id, company_id, run_id)?;
    if run.status != "running" {
        return Err("only a running run can be budget parked".into());
    }
    ensure_safe_boundary(ParkBlockers {
        dispatched_or_uncertain_effect: ctx
            .db
            .ai_run_effect()
            .ai_run_effect_by_run()
            .filter(&run_id)
            .any(|effect| matches!(effect.status.as_str(), "dispatched" | "uncertain")),
        reserved_spend: ctx
            .db
            .ai_spend_reservation()
            .ai_spend_reservation_by_run()
            .filter(&run_id)
            .any(|reservation| reservation.status == "reserved"),
    })?;

    let now = ctx.timestamp.to_micros_since_unix_epoch();
    let fire_micros = plan_schedule(
        now,
        params.window_resets_at_micros,
        params.max_park_until_micros,
    )?;
    let previous = ctx.db.ai_run_budget_park().run_id().find(&run_id);
    let generation = match &previous {
        Some(row)
            if matches!(
                row.status.as_str(),
                PARK_STATUS_PARKED | PARK_STATUS_RESUME_REQUESTED | PARK_STATUS_WAITING_INPUT
            ) =>
        {
            return Err("run already has an open budget park".into());
        }
        Some(row) => row
            .park_generation
            .checked_add(1)
            .ok_or("park generation overflow")?,
        None => 1,
    };
    let job = ctx.db.ai_run_budget_resume_job().insert(AiRunBudgetResumeJob {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(Timestamp::from_micros_since_unix_epoch(fire_micros)),
        organization_id,
        company_id,
        run_id,
        park_generation: generation,
    });
    let row = AiRunBudgetPark {
        run_id,
        organization_id,
        company_id,
        park_generation: generation,
        reason: params.reason.clone(),
        status: PARK_STATUS_PARKED.into(),
        window_resets_at: Timestamp::from_micros_since_unix_epoch(params.window_resets_at_micros),
        max_park_until: Timestamp::from_micros_since_unix_epoch(params.max_park_until_micros),
        required_units: params.required_units,
        input_token_allowance: params.input_token_allowance,
        output_token_allowance: params.output_token_allowance,
        agent_id: params.agent_id,
        provider: params.provider,
        model: params.model,
        schedule_id: Some(job.scheduled_id),
        resume_trigger: None,
        resolution: None,
        parked_at: ctx.timestamp,
        resume_requested_at: None,
        resolved_at: None,
    };
    if previous.is_some() {
        ctx.db.ai_run_budget_park().run_id().update(row);
    } else {
        ctx.db.ai_run_budget_park().insert(row);
    }
    transition_state_and_run(
        ctx,
        state,
        key,
        "budget_parked",
        request_hash,
        LIFECYCLE_BUDGET_PARKED,
        LIFECYCLE_BUDGET_PARKED,
        None,
    )?;
    audit(ctx, organization_id, company_id, run_id, "budget_parked");
    Ok(())
}

/// Scheduled entry point. Records a resume intent and nothing else: no state
/// transition to `running`, no reservation, no authority.
#[reducer]
pub fn fire_ai_run_budget_resume(
    ctx: &ReducerContext,
    job: AiRunBudgetResumeJob,
) -> Result<(), String> {
    if ctx.sender() != ctx.database_identity() {
        return Err("scheduled reducer is internal".into());
    }
    let Some(park) = ctx.db.ai_run_budget_park().run_id().find(&job.run_id) else {
        return Ok(());
    };
    if park.organization_id != job.organization_id || park.company_id != job.company_id {
        return Ok(());
    }
    if fire_effect(&park.status, park.park_generation, job.park_generation) == FireEffect::Ignore {
        return Ok(());
    }
    let state = ctx.db.ai_run_lifecycle_state().run_id().find(&job.run_id);
    let Some(state) = state.filter(|state| state.state == LIFECYCLE_BUDGET_PARKED) else {
        // Interrupted or otherwise moved on while parked: the intent is moot.
        ctx.db.ai_run_budget_park().run_id().update(AiRunBudgetPark {
            status: PARK_STATUS_SUPERSEDED.into(),
            schedule_id: None,
            resolved_at: Some(ctx.timestamp),
            ..park
        });
        return Ok(());
    };
    let trigger = if ctx.timestamp >= park.window_resets_at {
        PARK_TRIGGER_WINDOW_RESET
    } else {
        PARK_TRIGGER_MAX_PARK_ELAPSED
    };
    let generation = park.park_generation;
    ctx.db.ai_run_budget_park().run_id().update(AiRunBudgetPark {
        status: PARK_STATUS_RESUME_REQUESTED.into(),
        schedule_id: None,
        resume_trigger: Some(trigger.into()),
        resume_requested_at: Some(ctx.timestamp),
        ..park
    });
    let key = format!(
        "{}:{}:budget-resume:{generation}",
        job.organization_id, job.run_id
    );
    append_event(
        ctx,
        &state,
        key.clone(),
        "budget_resume_requested",
        command_hash("budget_resume_requested", &(job.run_id, generation, trigger)),
        state.concurrency_version,
        Some(serde_json::json!({"park_generation": generation, "trigger": trigger}).to_string()),
    );
    audit(
        ctx,
        job.organization_id,
        job.company_id,
        job.run_id,
        "budget_resume_requested",
    );
    Ok(())
}

#[reducer]
pub fn resolve_ai_run_budget_park(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    params: ResolveAiRunBudgetParkParams,
) -> Result<(), String> {
    authorize(ctx, organization_id)?;
    validate_key("idempotency_key", &params.idempotency_key)?;
    let request_hash = command_hash("budget_park_resolved", &params);
    let key = event_key(organization_id, run_id, &params.idempotency_key);
    if replayed(ctx, &key, "budget_park_resolved", &request_hash)? {
        return Ok(());
    }
    let state = checked_state(
        ctx,
        organization_id,
        company_id,
        run_id,
        &params.continuation,
    )?;
    let park = ctx
        .db
        .ai_run_budget_park()
        .run_id()
        .find(&run_id)
        .ok_or("run has no budget park")?;
    if park.organization_id != organization_id || park.company_id != company_id {
        return Err("budget park does not belong to this organization and company".into());
    }
    if park.park_generation != params.park_generation {
        return Err("stale park generation".into());
    }
    let now = ctx.timestamp.to_micros_since_unix_epoch();
    let resolution = plan_resolution(ResolveInputs {
        park_status: &park.status,
        resume_trigger: park.resume_trigger.as_deref(),
        lifecycle_state: &state.state,
        now_micros: now,
        max_park_until_micros: park.max_park_until.to_micros_since_unix_epoch(),
        outcome: &params.outcome,
        detail: Some(params.detail.as_str()).filter(|detail| !detail.is_empty()),
        next_window_resets_at_micros: Some(params.next_window_resets_at_micros)
            .filter(|micros| *micros != 0),
    })?;
    if matches!(resolution, Resolution::Resume) {
        // A resumed run holds nothing; the next provider call reserves again.
        ensure_safe_boundary(ParkBlockers {
            dispatched_or_uncertain_effect: ctx
                .db
                .ai_run_effect()
                .ai_run_effect_by_run()
                .filter(&run_id)
                .any(|effect| matches!(effect.status.as_str(), "dispatched" | "uncertain")),
            reserved_spend: ctx
                .db
                .ai_spend_reservation()
                .ai_spend_reservation_by_run()
                .filter(&run_id)
                .any(|reservation| reservation.status == "reserved"),
        })?;
    }
    // A pending intent job for this generation must not outlive the park.
    if let Some(schedule_id) = park.schedule_id {
        if !matches!(resolution, Resolution::Resume) {
            ctx.db
                .ai_run_budget_resume_job()
                .scheduled_id()
                .delete(&schedule_id);
        }
    }
    let kind = "budget_park_resolved";
    match resolution {
        Resolution::Resume => {
            ctx.db.ai_run_budget_park().run_id().update(AiRunBudgetPark {
                status: PARK_STATUS_RESUMED.into(),
                schedule_id: None,
                resolution: Some("resume".into()),
                resolved_at: Some(ctx.timestamp),
                ..park
            });
            transition_state_and_run(
                ctx,
                state,
                key,
                kind,
                request_hash,
                "running",
                "running",
                None,
            )?;
        }
        Resolution::StayParked { next_reset_micros } => {
            let generation = park
                .park_generation
                .checked_add(1)
                .ok_or("park generation overflow")?;
            let fire_micros = plan_schedule(
                now,
                next_reset_micros,
                park.max_park_until.to_micros_since_unix_epoch(),
            )?;
            let job = ctx.db.ai_run_budget_resume_job().insert(AiRunBudgetResumeJob {
                scheduled_id: 0,
                scheduled_at: ScheduleAt::Time(Timestamp::from_micros_since_unix_epoch(
                    fire_micros,
                )),
                organization_id,
                company_id,
                run_id,
                park_generation: generation,
            });
            ctx.db.ai_run_budget_park().run_id().update(AiRunBudgetPark {
                park_generation: generation,
                status: PARK_STATUS_PARKED.into(),
                window_resets_at: Timestamp::from_micros_since_unix_epoch(next_reset_micros),
                schedule_id: Some(job.scheduled_id),
                resume_trigger: None,
                resume_requested_at: None,
                ..park
            });
            // Re-arming keeps the lifecycle state; the event and version bump
            // let observers see that the expected resume time moved.
            crate::ai::run_lifecycle::mutate_state(
                ctx,
                &mut state.clone(),
                &params.idempotency_key,
                kind,
                request_hash,
                Some(
                    serde_json::json!({"outcome": "stay_parked", "park_generation": generation})
                        .to_string(),
                ),
                |_| Ok(()),
            )?;
        }
        Resolution::WaitingInput => {
            ctx.db.ai_run_budget_park().run_id().update(AiRunBudgetPark {
                status: PARK_STATUS_WAITING_INPUT.into(),
                schedule_id: None,
                resolution: Some("waiting_input".into()),
                ..park
            });
            transition_state_and_run(
                ctx,
                state,
                key,
                kind,
                request_hash,
                "waiting_input",
                "waiting_input",
                None,
            )?;
        }
        Resolution::Terminate { detail, cancelled } => {
            ctx.db.ai_run_budget_park().run_id().update(AiRunBudgetPark {
                status: PARK_STATUS_TERMINATED.into(),
                schedule_id: None,
                resolution: Some(detail.clone()),
                resolved_at: Some(ctx.timestamp),
                ..park
            });
            let run_status = if cancelled { "cancelled" } else { "failed" };
            transition_state_and_run(
                ctx,
                state,
                key,
                kind,
                request_hash,
                "terminated",
                run_status,
                Some(detail),
            )?;
            let run = load_run(ctx, organization_id, company_id, run_id)?;
            ctx.db.ai_agent_run().id().update(AiAgentRun {
                completed_at: Some(ctx.timestamp),
                ..run
            });
        }
    }
    audit(ctx, organization_id, company_id, run_id, "budget_park_resolved");
    Ok(())
}

fn audit(ctx: &ReducerContext, organization_id: u64, company_id: u64, run_id: u64, kind: &str) {
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_run_budget_park",
            record_id: run_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["status".to_string()],
            metadata: Some(serde_json::json!({"event": kind}).to_string()),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_000_000_000_000;
    const HOUR: i64 = 3_600_000_000;

    fn inputs<'a>(park_status: &'a str, outcome: &'a str) -> ResolveInputs<'a> {
        ResolveInputs {
            park_status,
            resume_trigger: Some(PARK_TRIGGER_WINDOW_RESET),
            lifecycle_state: LIFECYCLE_BUDGET_PARKED,
            now_micros: NOW,
            max_park_until_micros: NOW + 48 * HOUR,
            outcome,
            detail: None,
            next_window_resets_at_micros: None,
        }
    }

    #[test]
    fn parks_only_at_a_safe_step_boundary() {
        assert!(ensure_safe_boundary(ParkBlockers::default()).is_ok());
        let uncertain = ensure_safe_boundary(ParkBlockers {
            dispatched_or_uncertain_effect: true,
            reserved_spend: false,
        })
        .unwrap_err();
        assert!(uncertain.contains("reconcile"));
        // An outcome_unknown provider attempt keeps its reservation reserved,
        // so a held reservation also refuses the park.
        assert!(ensure_safe_boundary(ParkBlockers {
            dispatched_or_uncertain_effect: false,
            reserved_spend: true,
        })
        .is_err());
    }

    #[test]
    fn schedule_fires_at_reset_or_max_park_whichever_is_first() {
        assert_eq!(
            plan_schedule(NOW, NOW + 2 * HOUR, NOW + 10 * HOUR).unwrap(),
            NOW + 2 * HOUR
        );
        // Provider retry-after beyond the configured maximum is bounded.
        assert_eq!(
            plan_schedule(NOW, NOW + 20 * HOUR, NOW + 10 * HOUR).unwrap(),
            NOW + 10 * HOUR
        );
        assert!(plan_schedule(NOW, NOW, NOW + HOUR).is_err());
        assert!(plan_schedule(NOW, NOW + HOUR, NOW).is_err());
        assert!(plan_schedule(NOW, NOW + HOUR, NOW + 41 * 24 * HOUR).is_err());
    }

    #[test]
    fn duplicate_or_stale_schedule_fire_is_a_no_op() {
        assert_eq!(fire_effect("parked", 3, 3), FireEffect::RecordIntent);
        // Second firing of the same job after the intent was recorded.
        assert_eq!(fire_effect("resume_requested", 3, 3), FireEffect::Ignore);
        // Firing after the run resumed, terminated or moved on.
        for status in ["resumed", "terminated", "waiting_input", "superseded"] {
            assert_eq!(fire_effect(status, 3, 3), FireEffect::Ignore);
        }
        // A job from a previous generation cannot act on a re-armed park.
        assert_eq!(fire_effect("parked", 4, 3), FireEffect::Ignore);
    }

    #[test]
    fn resume_requires_a_recorded_reset_intent_and_happens_once() {
        assert_eq!(
            plan_resolution(inputs("resume_requested", "resume")).unwrap(),
            Resolution::Resume
        );
        // The schedule has not fired: nothing grants a resume.
        assert!(plan_resolution(inputs("parked", "resume")).is_err());
        // Already resumed: a second resolution cannot resume again.
        assert!(plan_resolution(inputs("resumed", "resume")).is_err());
        // The max-park deadline intent never resumes.
        let mut deadline = inputs("resume_requested", "resume");
        deadline.resume_trigger = Some(PARK_TRIGGER_MAX_PARK_ELAPSED);
        assert!(plan_resolution(deadline).is_err());
    }

    #[test]
    fn operator_can_resume_a_run_waiting_for_a_raised_budget() {
        let mut waiting = inputs("waiting_input", "resume");
        waiting.lifecycle_state = "waiting_input";
        waiting.resume_trigger = None;
        assert_eq!(plan_resolution(waiting).unwrap(), Resolution::Resume);
    }

    #[test]
    fn denied_again_stays_parked_within_max_park_or_waits_for_operator() {
        let mut stay = inputs("resume_requested", "stay_parked");
        stay.next_window_resets_at_micros = Some(NOW + HOUR);
        assert_eq!(
            plan_resolution(stay).unwrap(),
            Resolution::StayParked {
                next_reset_micros: NOW + HOUR
            }
        );
        let mut beyond = inputs("resume_requested", "stay_parked");
        beyond.next_window_resets_at_micros = Some(NOW + 49 * HOUR);
        assert!(plan_resolution(beyond).is_err());
        let mut past = inputs("resume_requested", "stay_parked");
        past.next_window_resets_at_micros = Some(NOW);
        assert!(plan_resolution(past).is_err());
        assert_eq!(
            plan_resolution(inputs("resume_requested", "waiting_input")).unwrap(),
            Resolution::WaitingInput
        );
        assert!(plan_resolution(inputs("waiting_input", "waiting_input")).is_err());
    }

    #[test]
    fn max_park_duration_terminates_only_after_it_elapses() {
        let mut early = inputs("parked", "terminate");
        early.detail = Some("max_park_duration");
        assert!(plan_resolution(early).is_err());
        let mut elapsed = inputs("resume_requested", "terminate");
        elapsed.detail = Some("max_park_duration");
        elapsed.now_micros = NOW + 48 * HOUR;
        assert_eq!(
            plan_resolution(elapsed).unwrap(),
            Resolution::Terminate {
                detail: "max_park_duration".into(),
                cancelled: false
            }
        );
        let mut cancel = inputs("parked", "terminate");
        cancel.detail = Some("operator_cancel");
        assert_eq!(
            plan_resolution(cancel).unwrap(),
            Resolution::Terminate {
                detail: "operator_cancel".into(),
                cancelled: true
            }
        );
        let mut unknown = inputs("parked", "terminate");
        unknown.detail = Some("because");
        assert!(plan_resolution(unknown).is_err());
        assert!(plan_resolution(inputs("terminated", "terminate")).is_err());
    }

    #[test]
    fn only_known_reasons_are_accepted() {
        assert!(valid_reason(PARK_REASON_BUDGET_EXHAUSTED));
        assert!(valid_reason(PARK_REASON_PROVIDER_RATE_LIMIT));
        assert!(!valid_reason("operator_pause"));
    }
}
