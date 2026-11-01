//! Budget park and resume for governed runs (T3 V2 adoption plan section 7.2).
//!
//! When spend admission denies because the billing window is exhausted, or a
//! provider answers HTTP 429 with a retry hint, the run is parked instead of
//! ended. The module records the park (reason, expected reset, the allowance it
//! needs) and schedules a reducer that ONLY records a resume intent. This
//! module's reactor then reads each intent and decides, never trusting the
//! schedule: it re-runs spend admission against the current budget and pricing
//! and asks the module to resume, stay parked, wait for an operator, or
//! terminate. A parked run holds no reservation; the next provider call
//! reserves again through the ordinary `SpendAdmittedLlm` path.
//!
//! Persistence goes through [`ParkStore`] so the decision logic is tested
//! without a database. The production store calls the park reducers through
//! the compile-time checked `reducer_call!` contract (pinned since v0.3.152).
//! A failed park leaves the run to end exactly as it did before this change.

// The resume reactor, its admission probe and the Stdb store's read half are
// exercised by tests but not spawned yet (no production dispatcher; see the
// AIH-24 status), so they are intentionally unused in non-test builds.
#![allow(dead_code)]

use std::time::Duration;

use anyhow::{Context, Result};
use async_trait::async_trait;
use chrono::{DateTime, Datelike, TimeZone, Utc};
use serde_json::{json, Value};
use stdb_client::StdbClient;

use crate::ai_spend::{Allowance, PriceSnapshot};
use crate::providers::llm::ProviderRejection;

use super::spend_admission::SpendLedger;

pub(crate) const REASON_BUDGET_EXHAUSTED: &str = "budget_exhausted";
pub(crate) const REASON_PROVIDER_RATE_LIMIT: &str = "provider_rate_limit";

pub(crate) const TRIGGER_WINDOW_RESET: &str = "window_reset";
pub(crate) const DEFAULT_MAX_PARK_SECS: u64 = 35 * 24 * 60 * 60;
pub(crate) const DEFAULT_RETRY_AFTER_SECS: u64 = 60;

/// Typed denial raised by spend admission when the budget window cannot cover
/// the call. Carried through anyhow contexts so the run can park.
#[derive(Debug, Clone, thiserror::Error)]
#[error("spend budget window exhausted; resets at {window_resets_at}")]
pub(crate) struct BudgetBlocked {
    pub window_resets_at: DateTime<Utc>,
    pub required_units: u64,
    pub allowance: Allowance,
}

/// Which agent, provider and model a denied or rate-limited call was bound
/// to. Attached as an error context so the park can re-price the same call.
#[derive(Debug, Clone, thiserror::Error)]
#[error("admitted binding agent {agent_id} {provider}/{model}")]
pub(crate) struct AdmittedBinding {
    pub agent_id: u64,
    pub provider: String,
    pub model: String,
}

/// Park the run when `error` is a budget denial or a retryable provider
/// rejection. The module decides whether the boundary is safe; any refusal, or
/// a contract that does not know the park reducers yet, returns `None` so the
/// caller ends the run exactly as before.
pub(crate) async fn try_park(
    store: &dyn ParkStore,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    error: &anyhow::Error,
    now: DateTime<Utc>,
    policy: &ParkPolicy,
) -> Option<ParkRequest> {
    // Do not strand a synchronous run: this build has no production resume
    // dispatcher. Only an admitted consumer may enable parking.
    if !policy.resume_dispatch_available {
        return None;
    }
    let request = classify(error, now, policy)?;
    let binding = error.downcast_ref::<AdmittedBinding>()?;
    let target = ParkTarget {
        organization_id,
        company_id,
        run_id,
        agent_id: binding.agent_id,
        provider: binding.provider.clone(),
        model: binding.model.clone(),
    };
    match store.park(&target, &request).await {
        Ok(()) => Some(request),
        Err(park_error) => {
            tracing::warn!(run_id, error = %park_error, "run could not be budget parked");
            None
        }
    }
}

/// First instant of the next UTC calendar month: budgets are per `YYYY-MM`.
pub(crate) fn next_window_start(now: DateTime<Utc>) -> DateTime<Utc> {
    let (year, month) = if now.month() == 12 {
        (now.year() + 1, 1)
    } else {
        (now.year(), now.month() + 1)
    };
    Utc.with_ymd_and_hms(year, month, 1, 0, 0, 0)
        .single()
        .unwrap_or(now)
}

/// Units a call needs at the given pricing; mirrors the module's
/// round-up-per-1k integer arithmetic.
pub(crate) fn required_units(snapshot: &PriceSnapshot, allowance: &Allowance) -> Result<u64> {
    fn cost(tokens: u32, per_1k: u64) -> Result<u64> {
        u64::from(tokens)
            .checked_mul(per_1k)
            .and_then(|value| value.checked_add(999))
            .map(|value| value / 1000)
            .context("usage cost overflow")
    }
    cost(allowance.input_tokens, snapshot.input_units_per_1k)?
        .checked_add(cost(allowance.output_tokens, snapshot.output_units_per_1k)?)
        .context("usage cost overflow")
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct ParkPolicy {
    resume_dispatch_available: bool,
    pub max_park: Duration,
    pub default_retry_after: Duration,
}

impl ParkPolicy {
    /// `AI_BUDGET_PARK_MAX_SECS` bounds how long a run may stay parked; unset
    /// or invalid falls back to a window that covers one monthly budget reset.
    pub(crate) fn from_env() -> Self {
        Self::new(
            std::env::var("AI_BUDGET_PARK_MAX_SECS")
                .ok()
                .and_then(|value| value.trim().parse::<u64>().ok())
                .filter(|value| *value > 0)
                .unwrap_or(DEFAULT_MAX_PARK_SECS),
        )
    }

    pub(crate) fn new(max_park_secs: u64) -> Self {
        Self {
            // This is a build admission, not an environment opt-in. Enable it
            // only alongside a wired and verified production resume consumer.
            resume_dispatch_available: false,
            max_park: Duration::from_secs(max_park_secs.max(1)),
            default_retry_after: Duration::from_secs(DEFAULT_RETRY_AFTER_SECS),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ParkRequest {
    pub reason: &'static str,
    pub window_resets_at: DateTime<Utc>,
    pub max_park_until: DateTime<Utc>,
    pub required_units: u64,
    pub input_tokens: u32,
    pub output_tokens: u32,
}

/// Decide whether a failed execution may park instead of ending. Anything but
/// a typed budget denial or a retryable provider rejection returns `None`, as
/// does a reset time beyond the configured maximum park duration.
pub(crate) fn classify(
    error: &anyhow::Error,
    now: DateTime<Utc>,
    policy: &ParkPolicy,
) -> Option<ParkRequest> {
    let max_park = chrono::Duration::from_std(policy.max_park).ok()?;
    let max_park_until = now.checked_add_signed(max_park)?;
    let request = if let Some(blocked) = error.downcast_ref::<BudgetBlocked>() {
        ParkRequest {
            reason: REASON_BUDGET_EXHAUSTED,
            window_resets_at: blocked.window_resets_at,
            max_park_until,
            required_units: blocked.required_units,
            input_tokens: blocked.allowance.input_tokens,
            output_tokens: blocked.allowance.output_tokens,
        }
    } else if let Some(rejection) = error
        .downcast_ref::<ProviderRejection>()
        .filter(|rejection| rejection.retryable())
    {
        let wait = rejection
            .retry_after()
            .unwrap_or(policy.default_retry_after);
        ParkRequest {
            reason: REASON_PROVIDER_RATE_LIMIT,
            window_resets_at: now.checked_add_signed(chrono::Duration::from_std(wait).ok()?)?,
            max_park_until,
            required_units: 0,
            input_tokens: 0,
            output_tokens: 0,
        }
    } else {
        return None;
    };
    (request.window_resets_at > now && request.window_resets_at <= request.max_park_until)
        .then_some(request)
}

/// Run binding the park needs; the module re-checks every field.
#[derive(Clone, Debug)]
pub(crate) struct ParkTarget {
    pub organization_id: u64,
    pub company_id: u64,
    pub run_id: u64,
    pub agent_id: u64,
    pub provider: String,
    pub model: String,
}

/// A recorded resume intent waiting for the reactor.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ParkIntent {
    pub organization_id: u64,
    pub company_id: u64,
    pub run_id: u64,
    pub park_generation: u64,
    pub reason: String,
    pub resume_trigger: String,
    pub max_park_until: DateTime<Utc>,
    pub agent_id: u64,
    pub provider: String,
    pub model: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ResolveCommand {
    Resume,
    StayParked {
        next_window_resets_at: DateTime<Utc>,
    },
    WaitingInput,
    Terminate {
        detail: &'static str,
    },
}

impl ResolveCommand {
    fn outcome(&self) -> &'static str {
        match self {
            Self::Resume => "resume",
            Self::StayParked { .. } => "stay_parked",
            Self::WaitingInput => "waiting_input",
            Self::Terminate { .. } => "terminate",
        }
    }
}

#[async_trait]
pub(crate) trait ParkStore: Send + Sync {
    /// Park the run; errors if the module refuses (uncertain effect, held
    /// reservation, stale continuation) or does not know the reducer yet.
    async fn park(&self, target: &ParkTarget, request: &ParkRequest) -> Result<()>;
    async fn pending_intents(&self, limit: usize) -> Result<Vec<ParkIntent>>;
    async fn resolve(&self, intent: &ParkIntent, command: &ResolveCommand) -> Result<()>;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Probe {
    Admitted,
    /// Headroom is short but a later window could cover the call.
    Denied,
    /// The call can never fit the budget, or no budget or price exists.
    NeedsOperator,
}

#[async_trait]
pub(crate) trait ResumeAdmission: Send + Sync {
    async fn probe(&self, intent: &ParkIntent, now: DateTime<Utc>) -> Result<Probe>;
}

/// Hands a resumed run back to the governed executor. Resolving a park to
/// `running` is only half of a resume; something with the actor's authority
/// must re-enter the run.
#[async_trait]
pub(crate) trait ContinuationDispatcher: Send + Sync {
    async fn dispatch(&self, intent: &ParkIntent) -> Result<()>;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum IntentOutcome {
    Resumed,
    StayedParked,
    WaitingInput,
    Terminated(&'static str),
}

/// Handle one resume intent. A schedule firing grants nothing: the decision is
/// made here from current budget and pricing, and each module transition is
/// idempotent per (run, generation, outcome).
pub(crate) async fn process_intent(
    store: &dyn ParkStore,
    admission: &dyn ResumeAdmission,
    dispatcher: &dyn ContinuationDispatcher,
    intent: &ParkIntent,
    now: DateTime<Utc>,
) -> Result<IntentOutcome> {
    if intent.resume_trigger != TRIGGER_WINDOW_RESET || now >= intent.max_park_until {
        store
            .resolve(
                intent,
                &ResolveCommand::Terminate {
                    detail: "max_park_duration",
                },
            )
            .await?;
        return Ok(IntentOutcome::Terminated("max_park_duration"));
    }
    match admission.probe(intent, now).await? {
        Probe::Admitted => {
            store.resolve(intent, &ResolveCommand::Resume).await?;
            if let Err(error) = dispatcher.dispatch(intent).await {
                // A run left `running` with nothing executing would be stuck;
                // end it visibly instead.
                tracing::error!(run_id = intent.run_id, %error, "budget resume dispatch failed");
                store
                    .resolve(
                        intent,
                        &ResolveCommand::Terminate {
                            detail: "resume_dispatch_failed",
                        },
                    )
                    .await?;
                return Ok(IntentOutcome::Terminated("resume_dispatch_failed"));
            }
            Ok(IntentOutcome::Resumed)
        }
        Probe::Denied => {
            let next = next_window_start(now);
            if intent.reason == REASON_BUDGET_EXHAUSTED && next <= intent.max_park_until {
                store
                    .resolve(
                        intent,
                        &ResolveCommand::StayParked {
                            next_window_resets_at: next,
                        },
                    )
                    .await?;
                Ok(IntentOutcome::StayedParked)
            } else {
                store.resolve(intent, &ResolveCommand::WaitingInput).await?;
                Ok(IntentOutcome::WaitingInput)
            }
        }
        Probe::NeedsOperator => {
            store.resolve(intent, &ResolveCommand::WaitingInput).await?;
            Ok(IntentOutcome::WaitingInput)
        }
    }
}

/// One reactor pass over recorded intents; failures of one run do not stop
/// the others.
pub(crate) async fn run_reactor_once(
    store: &dyn ParkStore,
    admission: &dyn ResumeAdmission,
    dispatcher: &dyn ContinuationDispatcher,
    now: DateTime<Utc>,
    limit: usize,
) -> Result<Vec<(u64, Result<IntentOutcome>)>> {
    let mut results = Vec::new();
    for intent in store.pending_intents(limit).await? {
        let outcome = process_intent(store, admission, dispatcher, &intent, now).await;
        results.push((intent.run_id, outcome));
    }
    Ok(results)
}

/// Re-runs the admission arithmetic against the current period budget and the
/// latest price snapshot. It reserves nothing: the next call reserves.
pub(crate) struct LedgerAdmission<'a> {
    pub ledger: &'a dyn SpendLedger,
}

#[async_trait]
impl ResumeAdmission for LedgerAdmission<'_> {
    async fn probe(&self, intent: &ParkIntent, now: DateTime<Utc>) -> Result<Probe> {
        if intent.reason == REASON_PROVIDER_RATE_LIMIT {
            return Ok(Probe::Admitted);
        }
        let period = crate::ai_spend::billing_period(now);
        let Some(budget) = self
            .ledger
            .budget(intent.organization_id, intent.agent_id, &period)
            .await?
        else {
            return Ok(Probe::NeedsOperator);
        };
        let Some(snapshot) = self
            .ledger
            .latest_price_snapshot(
                intent.organization_id,
                intent.agent_id,
                &intent.provider,
                &intent.model,
                &budget.currency,
            )
            .await?
        else {
            return Ok(Probe::NeedsOperator);
        };
        let needed = required_units(
            &snapshot,
            &Allowance {
                input_tokens: intent.input_tokens,
                output_tokens: intent.output_tokens,
            },
        )?;
        if needed > budget.limit_units {
            return Ok(Probe::NeedsOperator);
        }
        let committed = budget
            .settled_units
            .saturating_add(budget.outstanding_units)
            .saturating_add(needed);
        Ok(if committed > budget.limit_units {
            Probe::Denied
        } else {
            Probe::Admitted
        })
    }
}

// ── SpacetimeDB store ────────────────────────────────────────────────────────

pub(crate) struct StdbParkStore<'a> {
    pub writer: &'a StdbClient,
    pub reader: &'a StdbClient,
}

async fn call(
    writer: &StdbClient,
    name: &'static str,
    call: impl stdb_client::IntoReducerCall,
) -> Result<()> {
    writer
        .call_reducer(call)
        .await
        .with_context(|| format!("{name} reducer failed"))
}

async fn continuation(
    reader: &StdbClient,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
) -> Result<Value> {
    let row = reader
        .query_sql(&format!(
            "SELECT checkpoint_hash, cursor, concurrency_version FROM ai_run_lifecycle_state_read \
             WHERE organization_id = {organization_id} AND company_id = {company_id} AND run_id = {run_id} LIMIT 1"
        ))
        .await
        .context("load checked run continuation")?
        .into_iter()
        .next()
        .context("run lifecycle is not initialized")?;
    Ok(json!({
        "checkpoint_hash": row.get("checkpointHash").and_then(Value::as_str).context("checkpoint hash missing")?,
        "cursor": row_u64(&row, "cursor")? as u32,
        "concurrency_version": row_u64(&row, "concurrencyVersion")?,
    }))
}

fn row_u64(row: &Value, key: &str) -> Result<u64> {
    row.get(key)
        .and_then(|value| value.as_u64().or_else(|| value.as_i64().map(|v| v as u64)))
        .with_context(|| format!("park row is missing {key}"))
}

fn row_str(row: &Value, key: &str) -> Result<String> {
    row.get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .with_context(|| format!("park row is missing {key}"))
}

fn row_time(row: &Value, key: &str) -> Result<DateTime<Utc>> {
    let value = row
        .get(key)
        .with_context(|| format!("park row is missing {key}"))?;
    let micros = value
        .get("__timestamp_micros_since_unix_epoch__")
        .unwrap_or(value)
        .as_i64()
        .with_context(|| format!("park row {key} is not a timestamp"))?;
    DateTime::from_timestamp_micros(micros).with_context(|| format!("park row {key} out of range"))
}

#[async_trait]
impl ParkStore for StdbParkStore<'_> {
    async fn park(&self, target: &ParkTarget, request: &ParkRequest) -> Result<()> {
        let continuation = continuation(
            self.reader,
            target.organization_id,
            target.company_id,
            target.run_id,
        )
        .await?;
        let concurrency = continuation["concurrency_version"].as_u64().unwrap_or(0);
        call(
            self.writer,
            "park_ai_run_for_budget",
            stdb_client::reducer_call!(
                "park_ai_run_for_budget",
                json!([
                    target.organization_id,
                    target.company_id,
                    target.run_id,
                    {
                        "continuation": continuation,
                        "reason": request.reason,
                        "window_resets_at_micros": request.window_resets_at.timestamp_micros(),
                        "max_park_until_micros": request.max_park_until.timestamp_micros(),
                        "required_units": request.required_units,
                        "input_token_allowance": request.input_tokens,
                        "output_token_allowance": request.output_tokens,
                        "agent_id": target.agent_id,
                        "provider": target.provider,
                        "model": target.model,
                        "idempotency_key": format!("budget-park:{}:{concurrency}", target.run_id),
                    }
                ])
            ),
        )
        .await
    }

    async fn pending_intents(&self, limit: usize) -> Result<Vec<ParkIntent>> {
        let rows = self
            .reader
            .query_sql(&format!(
                "SELECT * FROM ai_run_budget_park_read WHERE status = 'resume_requested' LIMIT {limit}"
            ))
            .await
            .context("read pending budget park intents")?;
        rows.iter()
            .map(|row| {
                Ok(ParkIntent {
                    organization_id: row_u64(row, "organizationId")?,
                    company_id: row_u64(row, "companyId")?,
                    run_id: row_u64(row, "runId")?,
                    park_generation: row_u64(row, "parkGeneration")?,
                    reason: row_str(row, "reason")?,
                    resume_trigger: row_str(row, "resumeTrigger").unwrap_or_default(),
                    max_park_until: row_time(row, "maxParkUntil")?,
                    agent_id: row_u64(row, "agentId")?,
                    provider: row_str(row, "provider")?,
                    model: row_str(row, "model")?,
                    input_tokens: row_u64(row, "inputTokenAllowance")? as u32,
                    output_tokens: row_u64(row, "outputTokenAllowance")? as u32,
                })
            })
            .collect()
    }

    async fn resolve(&self, intent: &ParkIntent, command: &ResolveCommand) -> Result<()> {
        let continuation = continuation(
            self.reader,
            intent.organization_id,
            intent.company_id,
            intent.run_id,
        )
        .await?;
        let (detail, next) = match command {
            ResolveCommand::Terminate { detail } => ((*detail).to_string(), 0),
            ResolveCommand::StayParked {
                next_window_resets_at,
            } => (String::new(), next_window_resets_at.timestamp_micros()),
            _ => (String::new(), 0),
        };
        call(
            self.writer,
            "resolve_ai_run_budget_park",
            stdb_client::reducer_call!(
                "resolve_ai_run_budget_park",
                json!([
                    intent.organization_id,
                    intent.company_id,
                    intent.run_id,
                    {
                        "continuation": continuation,
                        "park_generation": intent.park_generation,
                        "outcome": command.outcome(),
                        "detail": detail,
                        "next_window_resets_at_micros": next,
                        // Deterministic per (run, generation, outcome): a repeated
                        // reactor pass replays instead of transitioning twice.
                        "idempotency_key": format!(
                            "budget-resolve:{}:{}:{}",
                            intent.run_id, intent.park_generation, command.outcome()
                        ),
                    }
                ])
            ),
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 13, 12, 0, 0).unwrap()
    }

    fn policy() -> ParkPolicy {
        ParkPolicy {
            resume_dispatch_available: true,
            ..ParkPolicy::new(DEFAULT_MAX_PARK_SECS)
        }
    }

    fn blocked(reset: DateTime<Utc>) -> anyhow::Error {
        anyhow::Error::new(BudgetBlocked {
            window_resets_at: reset,
            required_units: 40,
            allowance: Allowance {
                input_tokens: 100,
                output_tokens: 50,
            },
        })
        .context("provider call denied")
    }

    #[test]
    fn budget_window_resets_at_the_next_utc_month() {
        assert_eq!(
            next_window_start(now()),
            Utc.with_ymd_and_hms(2026, 10, 1, 0, 0, 0).unwrap()
        );
        let december = Utc.with_ymd_and_hms(2026, 12, 31, 23, 59, 59).unwrap();
        assert_eq!(
            next_window_start(december),
            Utc.with_ymd_and_hms(2027, 1, 1, 0, 0, 0).unwrap()
        );
    }

    #[test]
    fn required_units_round_up_like_the_module() {
        let snapshot = PriceSnapshot {
            id: 1,
            version: 1,
            input_units_per_1k: 3,
            output_units_per_1k: 7,
        };
        let allowance = Allowance {
            input_tokens: 1,
            output_tokens: 1001,
        };
        // ceil(3/1000)=1, ceil(7007/1000)=8
        assert_eq!(required_units(&snapshot, &allowance).unwrap(), 9);
    }

    #[test]
    fn budget_denial_parks_through_anyhow_contexts() {
        let reset = next_window_start(now());
        let request = classify(&blocked(reset), now(), &policy()).expect("parks");
        assert_eq!(request.reason, REASON_BUDGET_EXHAUSTED);
        assert_eq!(request.window_resets_at, reset);
        assert_eq!(request.required_units, 40);
        assert_eq!((request.input_tokens, request.output_tokens), (100, 50));
    }

    #[test]
    fn unrelated_errors_and_unreachable_resets_do_not_park() {
        assert!(classify(&anyhow::anyhow!("boom"), now(), &policy()).is_none());
        // Reset beyond the configured maximum park duration: end the run now.
        let far = now() + chrono::Duration::days(60);
        assert!(classify(&blocked(far), now(), &policy()).is_none());
        assert!(classify(&blocked(now()), now(), &policy()).is_none());
    }

    #[test]
    fn provider_retry_after_parks_with_the_provider_reset_time() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(reqwest::header::RETRY_AFTER, "90".parse().unwrap());
        let rejection = crate::providers::llm::check_mistral_response(
            reqwest::StatusCode::TOO_MANY_REQUESTS,
            headers.get(reqwest::header::RETRY_AFTER),
        )
        .unwrap_err();
        let request = classify(&rejection, now(), &policy()).expect("parks");
        assert_eq!(request.reason, REASON_PROVIDER_RATE_LIMIT);
        assert_eq!(
            request.window_resets_at,
            now() + chrono::Duration::seconds(90)
        );
        assert_eq!(request.required_units, 0);
    }

    #[test]
    fn provider_429_without_a_hint_uses_the_default_and_bounds_long_hints() {
        let bare =
            crate::providers::llm::check_mistral_status(reqwest::StatusCode::TOO_MANY_REQUESTS)
                .unwrap_err();
        assert_eq!(
            classify(&bare, now(), &policy()).unwrap().window_resets_at,
            now() + chrono::Duration::seconds(DEFAULT_RETRY_AFTER_SECS as i64)
        );
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(reqwest::header::RETRY_AFTER, "999999999".parse().unwrap());
        let long = crate::providers::llm::check_mistral_response(
            reqwest::StatusCode::TOO_MANY_REQUESTS,
            headers.get(reqwest::header::RETRY_AFTER),
        )
        .unwrap_err();
        assert!(classify(&long, now(), &ParkPolicy::new(3_600)).is_none());
        // Non-retryable rejections never park.
        let forbidden = crate::providers::llm::check_mistral_status(reqwest::StatusCode::FORBIDDEN)
            .unwrap_err();
        assert!(classify(&forbidden, now(), &policy()).is_none());
    }

    // ── reactor ──────────────────────────────────────────────────────────────

    #[derive(Default)]
    struct FakeStore {
        resolved: Mutex<Vec<ResolveCommand>>,
        intents: Mutex<Vec<ParkIntent>>,
    }

    #[async_trait]
    impl ParkStore for FakeStore {
        async fn park(&self, _: &ParkTarget, _: &ParkRequest) -> Result<()> {
            Ok(())
        }
        async fn pending_intents(&self, _: usize) -> Result<Vec<ParkIntent>> {
            Ok(self.intents.lock().unwrap().clone())
        }
        async fn resolve(&self, _: &ParkIntent, command: &ResolveCommand) -> Result<()> {
            self.resolved.lock().unwrap().push(command.clone());
            Ok(())
        }
    }

    struct FixedProbe(Probe);

    #[async_trait]
    impl ResumeAdmission for FixedProbe {
        async fn probe(&self, _: &ParkIntent, _: DateTime<Utc>) -> Result<Probe> {
            Ok(self.0.clone())
        }
    }

    #[derive(Default)]
    struct Dispatcher {
        calls: Mutex<u32>,
        fail: bool,
    }

    #[async_trait]
    impl ContinuationDispatcher for Dispatcher {
        async fn dispatch(&self, _: &ParkIntent) -> Result<()> {
            *self.calls.lock().unwrap() += 1;
            if self.fail {
                anyhow::bail!("no actor credential");
            }
            Ok(())
        }
    }

    fn intent(reason: &str, trigger: &str) -> ParkIntent {
        ParkIntent {
            organization_id: 9,
            company_id: 3,
            run_id: 42,
            park_generation: 1,
            reason: reason.into(),
            resume_trigger: trigger.into(),
            max_park_until: now() + chrono::Duration::days(35),
            agent_id: 7,
            provider: "mistral".into(),
            model: "mistral-small".into(),
            input_tokens: 100,
            output_tokens: 50,
        }
    }

    #[tokio::test]
    async fn admitted_intent_resumes_once_and_dispatches_the_continuation() {
        let store = FakeStore::default();
        let dispatcher = Dispatcher::default();
        let outcome = process_intent(
            &store,
            &FixedProbe(Probe::Admitted),
            &dispatcher,
            &intent(REASON_BUDGET_EXHAUSTED, TRIGGER_WINDOW_RESET),
            now(),
        )
        .await
        .unwrap();
        assert_eq!(outcome, IntentOutcome::Resumed);
        assert_eq!(
            *store.resolved.lock().unwrap(),
            vec![ResolveCommand::Resume]
        );
        assert_eq!(*dispatcher.calls.lock().unwrap(), 1);
    }

    #[tokio::test]
    async fn denied_again_stays_parked_until_the_next_window() {
        let store = FakeStore::default();
        let outcome = process_intent(
            &store,
            &FixedProbe(Probe::Denied),
            &Dispatcher::default(),
            &intent(REASON_BUDGET_EXHAUSTED, TRIGGER_WINDOW_RESET),
            now(),
        )
        .await
        .unwrap();
        assert_eq!(outcome, IntentOutcome::StayedParked);
        assert_eq!(
            *store.resolved.lock().unwrap(),
            vec![ResolveCommand::StayParked {
                next_window_resets_at: next_window_start(now())
            }]
        );
    }

    #[tokio::test]
    async fn denied_beyond_max_park_or_unfittable_waits_for_the_operator() {
        let store = FakeStore::default();
        let mut short = intent(REASON_BUDGET_EXHAUSTED, TRIGGER_WINDOW_RESET);
        short.max_park_until = now() + chrono::Duration::days(2);
        let dispatcher = Dispatcher::default();
        assert_eq!(
            process_intent(
                &store,
                &FixedProbe(Probe::Denied),
                &dispatcher,
                &short,
                now()
            )
            .await
            .unwrap(),
            IntentOutcome::WaitingInput
        );
        assert_eq!(
            process_intent(
                &store,
                &FixedProbe(Probe::NeedsOperator),
                &dispatcher,
                &intent(REASON_BUDGET_EXHAUSTED, TRIGGER_WINDOW_RESET),
                now()
            )
            .await
            .unwrap(),
            IntentOutcome::WaitingInput
        );
        assert_eq!(
            *store.resolved.lock().unwrap(),
            vec![ResolveCommand::WaitingInput, ResolveCommand::WaitingInput]
        );
        assert_eq!(*dispatcher.calls.lock().unwrap(), 0);
    }

    #[tokio::test]
    async fn max_park_duration_terminates_without_probing_admission() {
        let store = FakeStore::default();
        let mut expired = intent(REASON_BUDGET_EXHAUSTED, TRIGGER_WINDOW_RESET);
        expired.max_park_until = now();
        let by_trigger = intent(REASON_PROVIDER_RATE_LIMIT, "max_park_elapsed");
        let dispatcher = Dispatcher::default();
        // An admitted probe must not matter once the park window has elapsed.
        for intent in [&expired, &by_trigger] {
            assert_eq!(
                process_intent(
                    &store,
                    &FixedProbe(Probe::Admitted),
                    &dispatcher,
                    intent,
                    now()
                )
                .await
                .unwrap(),
                IntentOutcome::Terminated("max_park_duration")
            );
        }
        assert_eq!(*dispatcher.calls.lock().unwrap(), 0);
    }

    #[tokio::test]
    async fn failed_dispatch_after_resume_ends_the_run_instead_of_stranding_it() {
        let store = FakeStore::default();
        let dispatcher = Dispatcher {
            fail: true,
            ..Dispatcher::default()
        };
        let outcome = process_intent(
            &store,
            &FixedProbe(Probe::Admitted),
            &dispatcher,
            &intent(REASON_PROVIDER_RATE_LIMIT, TRIGGER_WINDOW_RESET),
            now(),
        )
        .await
        .unwrap();
        assert_eq!(outcome, IntentOutcome::Terminated("resume_dispatch_failed"));
        assert_eq!(
            *store.resolved.lock().unwrap(),
            vec![
                ResolveCommand::Resume,
                ResolveCommand::Terminate {
                    detail: "resume_dispatch_failed"
                }
            ]
        );
    }

    #[tokio::test]
    async fn reactor_pass_isolates_failures_per_run() {
        struct Failing;
        #[async_trait]
        impl ParkStore for Failing {
            async fn park(&self, _: &ParkTarget, _: &ParkRequest) -> Result<()> {
                Ok(())
            }
            async fn pending_intents(&self, _: usize) -> Result<Vec<ParkIntent>> {
                let mut second = intent(REASON_PROVIDER_RATE_LIMIT, TRIGGER_WINDOW_RESET);
                second.run_id = 43;
                Ok(vec![
                    intent(REASON_PROVIDER_RATE_LIMIT, TRIGGER_WINDOW_RESET),
                    second,
                ])
            }
            async fn resolve(&self, intent: &ParkIntent, _: &ResolveCommand) -> Result<()> {
                if intent.run_id == 42 {
                    anyhow::bail!("module refused");
                }
                Ok(())
            }
        }
        let results = run_reactor_once(
            &Failing,
            &FixedProbe(Probe::Admitted),
            &Dispatcher::default(),
            now(),
            10,
        )
        .await
        .unwrap();
        assert!(results[0].1.is_err());
        assert_eq!(results[1].1.as_ref().unwrap(), &IntentOutcome::Resumed);
    }

    // ── ledger admission ─────────────────────────────────────────────────────

    use super::super::spend_admission::tests::FakeLedger;

    #[tokio::test]
    async fn provider_rate_limit_intent_needs_no_budget_probe() {
        let ledger = FakeLedger::default();
        let probe = LedgerAdmission { ledger: &ledger };
        assert_eq!(
            probe
                .probe(
                    &intent(REASON_PROVIDER_RATE_LIMIT, TRIGGER_WINDOW_RESET),
                    now()
                )
                .await
                .unwrap(),
            Probe::Admitted
        );
    }

    #[tokio::test]
    async fn budget_intent_without_a_configured_budget_needs_the_operator() {
        let ledger = FakeLedger::default();
        let probe = LedgerAdmission { ledger: &ledger };
        assert_eq!(
            probe
                .probe(
                    &intent(REASON_BUDGET_EXHAUSTED, TRIGGER_WINDOW_RESET),
                    now()
                )
                .await
                .unwrap(),
            Probe::NeedsOperator
        );
    }

    #[tokio::test]
    async fn budget_intent_is_repriced_against_the_current_budget() {
        let probe_for = |limit| {
            let ledger = FakeLedger::configured().with_budget_limit(limit);
            async move {
                LedgerAdmission { ledger: &ledger }
                    .probe(
                        &intent(REASON_BUDGET_EXHAUSTED, TRIGGER_WINDOW_RESET),
                        now(),
                    )
                    .await
                    .unwrap()
            }
        };
        // 100 in at 200/1k + 50 out at 600/1k -> 20 + 30 = 50 units.
        assert_eq!(probe_for(1_000_000).await, Probe::Admitted);
        assert_eq!(probe_for(50).await, Probe::Admitted);
        // A budget that can never hold the call needs an operator.
        assert_eq!(probe_for(49).await, Probe::NeedsOperator);
    }

    struct RefusingStore(bool);

    #[async_trait]
    impl ParkStore for RefusingStore {
        async fn park(&self, _: &ParkTarget, _: &ParkRequest) -> Result<()> {
            if self.0 {
                anyhow::bail!(
                    "run has a dispatched or uncertain effect; reconcile it before parking"
                );
            }
            Ok(())
        }
        async fn pending_intents(&self, _: usize) -> Result<Vec<ParkIntent>> {
            Ok(Vec::new())
        }
        async fn resolve(&self, _: &ParkIntent, _: &ResolveCommand) -> Result<()> {
            Ok(())
        }
    }

    fn bound(error: anyhow::Error) -> anyhow::Error {
        error.context(AdmittedBinding {
            agent_id: 7,
            provider: "mistral".into(),
            model: "mistral-small".into(),
        })
    }

    #[tokio::test]
    async fn unavailable_resume_dispatcher_never_writes_a_park() {
        struct NoParkWrites;
        #[async_trait]
        impl ParkStore for NoParkWrites {
            async fn park(&self, _: &ParkTarget, _: &ParkRequest) -> Result<()> {
                panic!("parking requires a production resume dispatcher");
            }
            async fn pending_intents(&self, _: usize) -> Result<Vec<ParkIntent>> {
                unreachable!()
            }
            async fn resolve(&self, _: &ParkIntent, _: &ResolveCommand) -> Result<()> {
                unreachable!()
            }
        }
        for error in [
            bound(blocked(next_window_start(now()))),
            bound(
                crate::providers::llm::check_mistral_status(reqwest::StatusCode::TOO_MANY_REQUESTS)
                    .unwrap_err(),
            ),
        ] {
            assert!(try_park(
                &NoParkWrites,
                9,
                3,
                42,
                &error,
                now(),
                &ParkPolicy::from_env(),
            )
            .await
            .is_none());
        }
    }

    #[tokio::test]
    async fn module_refusal_to_park_falls_back_to_the_normal_failure_path() {
        let error = bound(blocked(next_window_start(now())));
        let parked = try_park(&RefusingStore(false), 9, 3, 42, &error, now(), &policy()).await;
        assert_eq!(parked.unwrap().reason, REASON_BUDGET_EXHAUSTED);
        // An uncertain effect (or any module refusal) means: do not park.
        assert!(
            try_park(&RefusingStore(true), 9, 3, 42, &error, now(), &policy())
                .await
                .is_none()
        );
        // Without the admitted binding the park cannot be re-priced.
        let unbound = blocked(next_window_start(now()));
        assert!(
            try_park(&RefusingStore(false), 9, 3, 42, &unbound, now(), &policy())
                .await
                .is_none()
        );
    }
}
