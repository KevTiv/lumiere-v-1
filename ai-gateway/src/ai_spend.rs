//! H5b governed spend admission and run-correlated draft lookup.
//!
//! Writes go through the gateway principal (`STDB_TOKEN`), which must hold the
//! separately provisioned `ai_spend/reserve` and `ai_spend/settle` grants.
//! The spend, price and draft-request tables are private, so reads use a
//! dedicated read principal (`AI_SPEND_READ_STDB_TOKEN`), following the
//! api-server `workflow_reads` pattern: fixed column lists, numeric-only SQL
//! filters, and every string binding (request key, provider, model, currency,
//! billing period) matched here rather than interpolated into SQL.
//!
//! Recovering an existing reservation does not authorize dispatching the same
//! provider attempt again; attempt dispatch state is a separate H5 gate.
#![allow(dead_code)] // Routed into the governed loop in a later H5b slice.

use anyhow::{bail, Context, Result};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use stdb_client::StdbClient;

use crate::wire_decode::row_u64;

/// `ai_action_draft_request.request_key` limit; spend keys share it so one key
/// shape is valid for both reducers.
pub const REQUEST_KEY_MAX_LEN: usize = 160;
/// Mirrors `MAX_ALLOWANCE_TOKENS` in the module.
pub const MAX_ALLOWANCE_TOKENS: u32 = 10_000_000;

pub const STATUS_RESERVED: &str = "reserved";
pub const STATUS_SETTLED: &str = "settled";

/// `ai_provider_attempt.status` values, mirroring the module's transitions.
pub const ATTEMPT_ACCEPTED: &str = "accepted";
pub const ATTEMPT_DISPATCHED: &str = "dispatched";
pub const ATTEMPT_SUCCEEDED: &str = "succeeded";
pub const ATTEMPT_FAILED: &str = "failed";
pub const ATTEMPT_OUTCOME_UNKNOWN: &str = "outcome_unknown";
/// Mirrors `MAX_ATTEMPT_NOTE_LEN` in the module.
pub const ATTEMPT_NOTE_MAX_LEN: usize = 1_024;

const PRICE_SNAPSHOT_COLS: &str = "id, organization_id, agent_id, provider, model, currency, \
input_units_per_1k, output_units_per_1k, version";
const BUDGET_COLS: &str = "id, organization_id, agent_id, billing_period, currency, limit_units, \
settled_units, outstanding_units";
const RESERVATION_COLS: &str = "id, organization_id, company_id, agent_id, run_id, request_key, \
provider, model, billing_period, currency, price_snapshot_id, reserved_units, settled_units, \
input_token_allowance, output_token_allowance, status, settled_input_tokens, settled_output_tokens";
const DRAFT_REQUEST_COLS: &str =
    "id, organization_id, company_id, run_id, request_key, draft_id, creation_payload_hash";
const ATTEMPT_COLS: &str = "id, organization_id, company_id, agent_id, run_id, reservation_id, \
request_key, provider, model, status, input_tokens, output_tokens";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RequestKind {
    Spend,
    Draft,
}

impl RequestKind {
    fn label(self) -> &'static str {
        match self {
            Self::Spend => "spend",
            Self::Draft => "draft",
        }
    }
}

/// Deterministic, run-scoped request key. The same run, step and attempt always
/// map to the same key, so a retried reducer call replays instead of creating a
/// second reservation or draft.
pub fn request_key(kind: RequestKind, run_id: u64, step_no: u32, attempt: u32) -> Result<String> {
    if run_id == 0 {
        bail!("request key requires a durable nonzero run_id");
    }
    let key = format!(
        "h5:{}:run:{run_id}:step:{step_no}:attempt:{attempt}",
        kind.label()
    );
    validate_request_key(&key)?;
    Ok(key)
}

/// Deterministic, run-scoped key for a tool invocation without a step number.
/// SHA-256 over the canonical input JSON keeps the key stable across builds and
/// restarts, so a replayed invocation maps to the same draft.
pub fn input_request_key(kind: RequestKind, run_id: u64, input: &Value) -> Result<String> {
    use sha2::{Digest, Sha256};
    if run_id == 0 {
        bail!("request key requires a durable nonzero run_id");
    }
    let canonical = serde_json::to_vec(input).context("serialize tool input")?;
    let digest = Sha256::digest(&canonical);
    let hex: String = digest[..16].iter().map(|b| format!("{b:02x}")).collect();
    let key = format!("h5:{}:run:{run_id}:input:{hex}", kind.label());
    validate_request_key(&key)?;
    Ok(key)
}

pub fn validate_request_key(key: &str) -> Result<()> {
    if key.is_empty() || key.len() > REQUEST_KEY_MAX_LEN {
        bail!("request key must be 1..={REQUEST_KEY_MAX_LEN} bytes");
    }
    if !key
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b':' || b == b'_')
    {
        bail!("request key contains unsupported characters");
    }
    Ok(())
}

/// UTC calendar month, matching the module's `current_period`.
pub fn billing_period(now: DateTime<Utc>) -> String {
    now.format("%Y-%m").to_string()
}

/// Token allowances for one provider attempt, bound before dispatch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Allowance {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

/// Size a conservative allowance before dispatch. Prompt tokens are unknown
/// until the provider answers, so input is bounded at one token per 3 UTF-8
/// bytes (an overestimate for supported providers) plus a fixed overhead.
/// The module separately rejects `output > agent.max_tokens` and
/// `input + output > context_window`; this fails earlier with the same rule.
pub fn allowance(
    prompt_bytes: usize,
    max_output_tokens: u32,
    agent_max_tokens: u32,
    context_window: u32,
) -> Result<Allowance> {
    const PROMPT_OVERHEAD_TOKENS: u64 = 64;
    if max_output_tokens == 0 {
        bail!("output allowance must be positive");
    }
    if max_output_tokens > agent_max_tokens {
        bail!("output allowance exceeds agent max_tokens");
    }
    let input = (prompt_bytes as u64).div_ceil(3) + PROMPT_OVERHEAD_TOKENS;
    let input = u32::try_from(input).context("prompt is too large to reserve")?;
    if input > MAX_ALLOWANCE_TOKENS || max_output_tokens > MAX_ALLOWANCE_TOKENS {
        bail!("token allowance exceeds the reservable maximum");
    }
    if u64::from(input) + u64::from(max_output_tokens) > u64::from(context_window) {
        bail!("prompt and output allowance exceed the agent context window");
    }
    Ok(Allowance {
        input_tokens: input,
        output_tokens: max_output_tokens,
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PriceSnapshot {
    pub id: u64,
    pub version: u64,
    pub input_units_per_1k: u64,
    pub output_units_per_1k: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpendBudget {
    pub id: u64,
    pub currency: String,
    pub limit_units: u64,
    pub settled_units: u64,
    pub outstanding_units: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reservation {
    pub id: u64,
    pub company_id: u64,
    pub agent_id: u64,
    pub request_key: String,
    pub provider: String,
    pub model: String,
    pub price_snapshot_id: u64,
    pub reserved_units: u64,
    pub input_token_allowance: u32,
    pub output_token_allowance: u32,
    pub status: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DraftRequest {
    pub id: u64,
    pub draft_id: u64,
    pub creation_payload_hash: String,
}

/// Durable provider attempt bound 1:1 to a reservation by request key.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderAttempt {
    pub id: u64,
    pub company_id: u64,
    pub agent_id: u64,
    pub reservation_id: u64,
    pub request_key: String,
    pub provider: String,
    pub model: String,
    pub status: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
}

/// Exact binding for an accepted attempt, mirroring
/// `AcceptAiProviderAttemptParams`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AcceptAttemptRequest {
    pub organization_id: u64,
    pub company_id: u64,
    pub agent_id: u64,
    pub run_id: u64,
    pub reservation_id: u64,
    pub request_key: String,
    pub provider: String,
    pub model: String,
}

/// Outcome of a dispatched attempt, mirroring
/// `RecordAiProviderAttemptResultParams`. `outcome_unknown` must report no
/// usage, which `attempt_result` enforces before the call.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AttemptResult {
    pub attempt_id: u64,
    pub status: &'static str,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub failure_reason: Option<String>,
}

impl AttemptResult {
    /// The provider returned a usable response with this usage.
    pub fn succeeded(attempt_id: u64, input_tokens: u32, output_tokens: u32) -> Self {
        Self {
            attempt_id,
            status: ATTEMPT_SUCCEEDED,
            input_tokens,
            output_tokens,
            failure_reason: None,
        }
    }

    /// Dispatch produced no usable result. The provider may still have run, so
    /// the attempt reports no usage and waits for explicit reconciliation.
    pub fn outcome_unknown(attempt_id: u64, reason: &str) -> Self {
        Self {
            attempt_id,
            status: ATTEMPT_OUTCOME_UNKNOWN,
            input_tokens: 0,
            output_tokens: 0,
            failure_reason: attempt_note(reason),
        }
    }
}

/// Exact binding for a reservation request, mirroring `ReserveAiSpendParams`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReserveRequest {
    pub organization_id: u64,
    pub company_id: u64,
    pub agent_id: u64,
    pub run_id: u64,
    pub request_key: String,
    pub provider: String,
    pub model: String,
    pub billing_period: String,
    pub currency: String,
    pub price_snapshot_id: u64,
    pub allowance: Allowance,
}

/// Read-only lookups over the private spend tables.
pub struct SpendReader<'a> {
    stdb: &'a StdbClient,
}

impl<'a> SpendReader<'a> {
    /// `stdb` must be the dedicated `AI_SPEND_READ_STDB_TOKEN` client.
    pub fn new(stdb: &'a StdbClient) -> Self {
        Self { stdb }
    }

    pub async fn budget(
        &self,
        organization_id: u64,
        agent_id: u64,
        billing_period: &str,
    ) -> Result<Option<SpendBudget>> {
        let sql = format!(
            "SELECT {BUDGET_COLS} FROM ai_spend_budget \
             WHERE organization_id = {organization_id} AND agent_id = {agent_id}"
        );
        let rows = self
            .stdb
            .query_sql(&sql)
            .await
            .context("read ai_spend_budget")?;
        select_budget(&rows, organization_id, agent_id, billing_period)
    }

    pub async fn latest_price_snapshot(
        &self,
        organization_id: u64,
        agent_id: u64,
        provider: &str,
        model: &str,
        currency: &str,
    ) -> Result<Option<PriceSnapshot>> {
        let sql = format!(
            "SELECT {PRICE_SNAPSHOT_COLS} FROM ai_price_snapshot \
             WHERE organization_id = {organization_id} AND agent_id = {agent_id}"
        );
        let rows = self
            .stdb
            .query_sql(&sql)
            .await
            .context("read ai_price_snapshot")?;
        select_latest_snapshot(&rows, organization_id, agent_id, provider, model, currency)
    }

    pub async fn reservation(
        &self,
        organization_id: u64,
        run_id: u64,
        request_key: &str,
    ) -> Result<Option<Reservation>> {
        validate_request_key(request_key)?;
        let sql = format!(
            "SELECT {RESERVATION_COLS} FROM ai_spend_reservation \
             WHERE organization_id = {organization_id} AND run_id = {run_id}"
        );
        let rows = self
            .stdb
            .query_sql(&sql)
            .await
            .context("read ai_spend_reservation")?;
        find_reservation(&rows, organization_id, run_id, request_key)
    }

    pub async fn draft_request(
        &self,
        organization_id: u64,
        company_id: u64,
        run_id: u64,
        request_key: &str,
    ) -> Result<Option<DraftRequest>> {
        validate_request_key(request_key)?;
        let sql = format!(
            "SELECT {DRAFT_REQUEST_COLS} FROM ai_action_draft_request \
             WHERE organization_id = {organization_id} AND run_id = {run_id}"
        );
        let rows = self
            .stdb
            .query_sql(&sql)
            .await
            .context("read ai_action_draft_request")?;
        find_draft_request(&rows, organization_id, company_id, run_id, request_key)
    }

    /// The attempt for one request key. `accept_provider_attempt` cannot return
    /// the inserted id, so the row is read back before it is dispatched.
    pub async fn provider_attempt(
        &self,
        organization_id: u64,
        run_id: u64,
        request_key: &str,
    ) -> Result<Option<ProviderAttempt>> {
        validate_request_key(request_key)?;
        let sql = format!(
            "SELECT {ATTEMPT_COLS} FROM ai_provider_attempt \
             WHERE organization_id = {organization_id} AND run_id = {run_id}"
        );
        let rows = self
            .stdb
            .query_sql(&sql)
            .await
            .context("read ai_provider_attempt")?;
        find_attempt(&rows, organization_id, run_id, request_key)
    }
}

/// Reserve spend through the gateway principal. Replays of an identical
/// binding succeed without a second reservation.
pub async fn reserve(stdb: &StdbClient, request: &ReserveRequest) -> Result<()> {
    validate_request_key(&request.request_key)?;
    stdb.call_reducer(stdb_client::reducer_call!(
        "reserve_ai_spend",
        json!([
            request.organization_id,
            {
                "company_id": request.company_id,
                "agent_id": request.agent_id,
                "run_id": request.run_id,
                "request_key": request.request_key,
                "provider": request.provider,
                "model": request.model,
                "billing_period": request.billing_period,
                "currency": request.currency,
                "price_snapshot_id": request.price_snapshot_id,
                "input_token_allowance": request.allowance.input_tokens,
                "output_token_allowance": request.allowance.output_tokens,
            }
        ]),
    ))
    .await
    .context("reserve_ai_spend reducer failed")
}

/// Settle one reservation with actual provider usage. A replay with identical
/// usage succeeds; different usage is rejected by the module.
pub async fn settle(
    stdb: &StdbClient,
    organization_id: u64,
    reservation_id: u64,
    input_tokens: u32,
    output_tokens: u32,
) -> Result<()> {
    if reservation_id == 0 {
        bail!("settlement requires a reservation id");
    }
    stdb.call_reducer(stdb_client::reducer_call!(
        "settle_ai_spend",
        json!([
            organization_id,
            {
                "reservation_id": reservation_id,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
            }
        ]),
    ))
    .await
    .context("settle_ai_spend reducer failed")
}

/// Commit attempt intent before any provider I/O. Replaying the same binding
/// succeeds without creating a second attempt.
pub async fn accept_provider_attempt(
    stdb: &StdbClient,
    request: &AcceptAttemptRequest,
) -> Result<()> {
    validate_request_key(&request.request_key)?;
    if request.reservation_id == 0 {
        bail!("an attempt requires the reservation it is bound to");
    }
    stdb.call_reducer(stdb_client::reducer_call!(
        "accept_ai_provider_attempt",
        json!([
            request.organization_id,
            {
                "company_id": request.company_id,
                "agent_id": request.agent_id,
                "run_id": request.run_id,
                "reservation_id": request.reservation_id,
                "request_key": request.request_key,
                "provider": request.provider,
                "model": request.model,
            }
        ]),
    ))
    .await
    .context("accept_ai_provider_attempt reducer failed")
}

/// Claim the single dispatch of an accepted attempt immediately before I/O.
pub async fn mark_provider_attempt_dispatched(
    stdb: &StdbClient,
    organization_id: u64,
    attempt_id: u64,
) -> Result<()> {
    if attempt_id == 0 {
        bail!("dispatch requires an attempt id");
    }
    stdb.call_reducer(stdb_client::reducer_call!(
        "mark_ai_provider_attempt_dispatched",
        json!([organization_id, attempt_id]),
    ))
    .await
    .context("mark_ai_provider_attempt_dispatched reducer failed")
}

/// Record the outcome of a dispatched attempt. Recording never retries or
/// redispatches; an unknown outcome stays unknown until it is reconciled.
pub async fn record_provider_attempt_result(
    stdb: &StdbClient,
    organization_id: u64,
    result: &AttemptResult,
) -> Result<()> {
    if result.attempt_id == 0 {
        bail!("recording a result requires an attempt id");
    }
    stdb.call_reducer(stdb_client::reducer_call!(
        "record_ai_provider_attempt_result",
        json!([
            organization_id,
            {
                "attempt_id": result.attempt_id,
                "status": result.status,
                "input_tokens": result.input_tokens,
                "output_tokens": result.output_tokens,
                "failure_reason": result.failure_reason,
            }
        ]),
    ))
    .await
    .context("record_ai_provider_attempt_result reducer failed")
}

/// Create a run-correlated draft. `params` is the `CreateAiActionDraftParams`
/// object; the module binds it to the run and request key atomically.
pub async fn create_run_action_draft(
    stdb: &StdbClient,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    request_key: &str,
    params: Value,
) -> Result<()> {
    if run_id == 0 {
        bail!("run-correlated drafts require a durable nonzero run_id");
    }
    validate_request_key(request_key)?;
    if !params.is_object() {
        bail!("draft params must be an object");
    }
    stdb.call_reducer(stdb_client::reducer_call!(
        "create_ai_run_action_draft",
        json!([organization_id, company_id, run_id, request_key, params]),
    ))
    .await
    .context("create_ai_run_action_draft reducer failed")
}

fn select_budget(
    rows: &[Value],
    organization_id: u64,
    agent_id: u64,
    billing_period: &str,
) -> Result<Option<SpendBudget>> {
    let mut found = None;
    for row in rows {
        require_owner(row, organization_id)?;
        if req_u64(row, "agentId", "agent_id")? != agent_id
            || req_str(row, "billingPeriod", "billing_period")? != billing_period
        {
            continue;
        }
        if found.is_some() {
            bail!("multiple spend budgets for one agent and billing period");
        }
        found = Some(SpendBudget {
            id: req_u64(row, "id", "id")?,
            currency: req_str(row, "currency", "currency")?,
            limit_units: req_u64(row, "limitUnits", "limit_units")?,
            settled_units: req_u64(row, "settledUnits", "settled_units")?,
            outstanding_units: req_u64(row, "outstandingUnits", "outstanding_units")?,
        });
    }
    Ok(found)
}

fn select_latest_snapshot(
    rows: &[Value],
    organization_id: u64,
    agent_id: u64,
    provider: &str,
    model: &str,
    currency: &str,
) -> Result<Option<PriceSnapshot>> {
    let mut latest: Option<PriceSnapshot> = None;
    for row in rows {
        require_owner(row, organization_id)?;
        if req_u64(row, "agentId", "agent_id")? != agent_id
            || req_str(row, "provider", "provider")? != provider
            || req_str(row, "model", "model")? != model
            || req_str(row, "currency", "currency")? != currency
        {
            continue;
        }
        let snapshot = PriceSnapshot {
            id: req_u64(row, "id", "id")?,
            version: req_u64(row, "version", "version")?,
            input_units_per_1k: req_u64(row, "inputUnitsPer1k", "input_units_per_1k")?,
            output_units_per_1k: req_u64(row, "outputUnitsPer1k", "output_units_per_1k")?,
        };
        match &latest {
            Some(current) if current.version == snapshot.version => {
                bail!("duplicate price snapshot version {}", snapshot.version)
            }
            Some(current) if current.version > snapshot.version => {}
            _ => latest = Some(snapshot),
        }
    }
    Ok(latest)
}

fn find_reservation(
    rows: &[Value],
    organization_id: u64,
    run_id: u64,
    request_key: &str,
) -> Result<Option<Reservation>> {
    let mut found = None;
    for row in rows {
        require_owner(row, organization_id)?;
        if req_u64(row, "runId", "run_id")? != run_id
            || req_str(row, "requestKey", "request_key")? != request_key
        {
            continue;
        }
        if found.is_some() {
            bail!("multiple reservations share one request key");
        }
        let status = req_str(row, "status", "status")?;
        if status != STATUS_RESERVED && status != STATUS_SETTLED {
            bail!("reservation has unknown status '{status}'");
        }
        found = Some(Reservation {
            id: req_u64(row, "id", "id")?,
            company_id: req_u64(row, "companyId", "company_id")?,
            agent_id: req_u64(row, "agentId", "agent_id")?,
            request_key: request_key.to_string(),
            provider: req_str(row, "provider", "provider")?,
            model: req_str(row, "model", "model")?,
            price_snapshot_id: req_u64(row, "priceSnapshotId", "price_snapshot_id")?,
            reserved_units: req_u64(row, "reservedUnits", "reserved_units")?,
            input_token_allowance: req_u32(row, "inputTokenAllowance", "input_token_allowance")?,
            output_token_allowance: req_u32(row, "outputTokenAllowance", "output_token_allowance")?,
            status,
        });
    }
    Ok(found)
}

fn find_draft_request(
    rows: &[Value],
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    request_key: &str,
) -> Result<Option<DraftRequest>> {
    let mut found = None;
    for row in rows {
        require_owner(row, organization_id)?;
        if req_u64(row, "runId", "run_id")? != run_id
            || req_str(row, "requestKey", "request_key")? != request_key
        {
            continue;
        }
        if req_u64(row, "companyId", "company_id")? != company_id {
            bail!("draft request key is bound to a different company");
        }
        if found.is_some() {
            bail!("multiple draft requests share one request key");
        }
        let draft_id = req_u64(row, "draftId", "draft_id")?;
        if draft_id == 0 {
            bail!("draft request has no draft id");
        }
        found = Some(DraftRequest {
            id: req_u64(row, "id", "id")?,
            draft_id,
            creation_payload_hash: req_str(row, "creationPayloadHash", "creation_payload_hash")?,
        });
    }
    Ok(found)
}

fn find_attempt(
    rows: &[Value],
    organization_id: u64,
    run_id: u64,
    request_key: &str,
) -> Result<Option<ProviderAttempt>> {
    let mut found = None;
    for row in rows {
        require_owner(row, organization_id)?;
        if req_u64(row, "runId", "run_id")? != run_id
            || req_str(row, "requestKey", "request_key")? != request_key
        {
            continue;
        }
        if found.is_some() {
            bail!("multiple provider attempts share one request key");
        }
        let status = req_str(row, "status", "status")?;
        if !matches!(
            status.as_str(),
            ATTEMPT_ACCEPTED
                | ATTEMPT_DISPATCHED
                | ATTEMPT_SUCCEEDED
                | ATTEMPT_FAILED
                | ATTEMPT_OUTCOME_UNKNOWN
        ) {
            bail!("provider attempt has unknown status '{status}'");
        }
        let reservation_id = req_u64(row, "reservationId", "reservation_id")?;
        if reservation_id == 0 {
            bail!("provider attempt is not bound to a reservation");
        }
        found = Some(ProviderAttempt {
            id: req_u64(row, "id", "id")?,
            company_id: req_u64(row, "companyId", "company_id")?,
            agent_id: req_u64(row, "agentId", "agent_id")?,
            reservation_id,
            request_key: request_key.to_string(),
            provider: req_str(row, "provider", "provider")?,
            model: req_str(row, "model", "model")?,
            status,
            input_tokens: req_u32(row, "inputTokens", "input_tokens")?,
            output_tokens: req_u32(row, "outputTokens", "output_tokens")?,
        });
    }
    Ok(found)
}

/// Keep a failure reason inside the module's note limit. Truncation is marked
/// so a persisted reason is never silently shortened.
fn attempt_note(reason: &str) -> Option<String> {
    const MARKER: &str = " […]";
    let reason = reason.trim();
    if reason.is_empty() {
        return None;
    }
    if reason.len() <= ATTEMPT_NOTE_MAX_LEN {
        return Some(reason.to_string());
    }
    let mut end = ATTEMPT_NOTE_MAX_LEN - MARKER.len();
    while !reason.is_char_boundary(end) {
        end -= 1;
    }
    Some(format!("{}{MARKER}", &reason[..end]))
}

/// Every returned row must belong to the requested organization; a mismatch
/// means the SQL filter did not apply and the whole result is rejected.
fn require_owner(row: &Value, organization_id: u64) -> Result<()> {
    if req_u64(row, "organizationId", "organization_id")? != organization_id {
        bail!("private spend read returned a row outside the organization");
    }
    Ok(())
}

fn req_u64(row: &Value, camel: &str, snake: &str) -> Result<u64> {
    row_u64(row, camel, snake).with_context(|| format!("row is missing integer field {snake}"))
}

fn req_u32(row: &Value, camel: &str, snake: &str) -> Result<u32> {
    u32::try_from(req_u64(row, camel, snake)?).with_context(|| format!("{snake} exceeds u32"))
}

fn req_str(row: &Value, camel: &str, snake: &str) -> Result<String> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(Value::as_str)
        .map(str::to_string)
        .with_context(|| format!("row is missing string field {snake}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn snapshot_row(id: u64, org: u64, version: u64, model: &str) -> Value {
        json!({
            "id": id, "organization_id": org, "agent_id": 7, "provider": "mistral",
            "model": model, "currency": "EUR", "input_units_per_1k": 200,
            "output_units_per_1k": 600, "version": version
        })
    }

    fn reservation_row(id: u64, org: u64, run: u64, key: &str, status: &str) -> Value {
        json!({
            "id": id, "organization_id": org, "company_id": 3, "agent_id": 7, "run_id": run,
            "request_key": key, "provider": "mistral", "model": "mistral-small",
            "billing_period": "2026-09", "currency": "EUR", "price_snapshot_id": 11,
            "reserved_units": 900, "settled_units": 0, "input_token_allowance": 1000,
            "output_token_allowance": 500, "status": status,
            "settled_input_tokens": 0, "settled_output_tokens": 0
        })
    }

    #[test]
    fn request_keys_are_deterministic_and_run_scoped() {
        let key = request_key(RequestKind::Spend, 42, 3, 1).unwrap();
        assert_eq!(key, "h5:spend:run:42:step:3:attempt:1");
        assert_eq!(key, request_key(RequestKind::Spend, 42, 3, 1).unwrap());
        assert_ne!(key, request_key(RequestKind::Draft, 42, 3, 1).unwrap());
        assert!(request_key(RequestKind::Spend, 0, 3, 1).is_err());
        assert!(request_key(RequestKind::Draft, u64::MAX, u32::MAX, u32::MAX).is_ok());
    }

    #[test]
    fn input_request_keys_are_stable_and_input_bound() {
        let input = json!({"reducer_name": "confirm_sales_order", "params": {"id": 5}});
        let key = input_request_key(RequestKind::Draft, 42, &input).unwrap();
        assert!(key.starts_with("h5:draft:run:42:input:"));
        assert_eq!(key.len(), "h5:draft:run:42:input:".len() + 32);
        assert_eq!(
            key,
            input_request_key(RequestKind::Draft, 42, &input).unwrap()
        );
        let other = json!({"reducer_name": "confirm_sales_order", "params": {"id": 6}});
        assert_ne!(
            key,
            input_request_key(RequestKind::Draft, 42, &other).unwrap()
        );
        assert_ne!(
            key,
            input_request_key(RequestKind::Draft, 43, &input).unwrap()
        );
        assert!(input_request_key(RequestKind::Draft, 0, &input).is_err());
    }

    #[test]
    fn request_key_validation_rejects_sql_and_oversized_input() {
        assert!(validate_request_key("h5:spend:run:1:step:1:attempt:0").is_ok());
        assert!(validate_request_key("").is_err());
        assert!(validate_request_key("x' OR '1'='1").is_err());
        assert!(validate_request_key(&"a".repeat(REQUEST_KEY_MAX_LEN + 1)).is_err());
    }

    #[test]
    fn billing_period_is_the_utc_calendar_month() {
        let late = Utc.with_ymd_and_hms(2026, 9, 30, 23, 59, 59).unwrap();
        assert_eq!(billing_period(late), "2026-09");
        let first = Utc.with_ymd_and_hms(2026, 10, 1, 0, 0, 0).unwrap();
        assert_eq!(billing_period(first), "2026-10");
    }

    #[test]
    fn allowance_is_conservative_and_bounded() {
        let a = allowance(3_000, 500, 2_048, 32_000).unwrap();
        assert_eq!(
            a,
            Allowance {
                input_tokens: 1_064,
                output_tokens: 500
            }
        );
        assert!(allowance(3_000, 0, 2_048, 32_000).is_err());
        assert!(allowance(3_000, 4_096, 2_048, 32_000).is_err());
        assert!(allowance(96_000, 500, 2_048, 32_000).is_err());
    }

    #[test]
    fn latest_snapshot_matches_every_binding_and_highest_version() {
        let rows = vec![
            snapshot_row(1, 9, 1, "mistral-small"),
            snapshot_row(2, 9, 3, "mistral-small"),
            snapshot_row(3, 9, 5, "mistral-large"),
        ];
        let latest = select_latest_snapshot(&rows, 9, 7, "mistral", "mistral-small", "EUR")
            .unwrap()
            .unwrap();
        assert_eq!((latest.id, latest.version), (2, 3));
        assert!(
            select_latest_snapshot(&rows, 9, 7, "mistral", "mistral-small", "USD")
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn private_reads_fail_closed_on_foreign_or_ambiguous_rows() {
        let foreign = vec![snapshot_row(1, 10, 1, "mistral-small")];
        assert!(select_latest_snapshot(&foreign, 9, 7, "mistral", "mistral-small", "EUR").is_err());
        let dup = vec![
            snapshot_row(1, 9, 2, "mistral-small"),
            snapshot_row(2, 9, 2, "mistral-small"),
        ];
        assert!(select_latest_snapshot(&dup, 9, 7, "mistral", "mistral-small", "EUR").is_err());

        let key = "h5:spend:run:42:step:1:attempt:0";
        let twice = vec![
            reservation_row(1, 9, 42, key, STATUS_RESERVED),
            reservation_row(2, 9, 42, key, STATUS_RESERVED),
        ];
        assert!(find_reservation(&twice, 9, 42, key).is_err());
        let unknown = vec![reservation_row(1, 9, 42, key, "outcome_unknown")];
        assert!(find_reservation(&unknown, 9, 42, key).is_err());
    }

    #[test]
    fn reservation_lookup_is_exact_by_run_and_request_key() {
        let key = "h5:spend:run:42:step:1:attempt:0";
        let rows = vec![
            reservation_row(
                1,
                9,
                42,
                "h5:spend:run:42:step:2:attempt:0",
                STATUS_RESERVED,
            ),
            reservation_row(2, 9, 42, key, STATUS_SETTLED),
        ];
        let found = find_reservation(&rows, 9, 42, key).unwrap().unwrap();
        assert_eq!((found.id, found.status.as_str()), (2, STATUS_SETTLED));
        assert!(find_reservation(&rows, 9, 43, key).unwrap().is_none());
    }

    #[test]
    fn draft_request_lookup_is_exact_and_company_bound() {
        let key = "h5:draft:run:42:step:4:attempt:0";
        let row = json!({
            "id": 5, "organization_id": 9, "company_id": 3, "run_id": 42,
            "request_key": key, "draft_id": 77, "creation_payload_hash": "abc"
        });
        let found = find_draft_request(&[row.clone()], 9, 3, 42, key)
            .unwrap()
            .unwrap();
        assert_eq!(found.draft_id, 77);
        assert!(find_draft_request(&[row.clone()], 9, 4, 42, key).is_err());
        assert!(
            find_draft_request(&[row], 9, 3, 42, "h5:draft:run:42:step:5:attempt:0")
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn attempt_lookup_is_exact_and_fails_closed() {
        let key = "h5:spend:run:42:step:1:attempt:0";
        let row = |org: u64, run: u64, key: &str, status: &str, reservation: u64| {
            json!({
                "id": 5, "organization_id": org, "company_id": 3, "agent_id": 7, "run_id": run,
                "reservation_id": reservation, "request_key": key, "provider": "mistral",
                "model": "mistral-small", "status": status, "input_tokens": 40,
                "output_tokens": 20
            })
        };
        let found = find_attempt(&[row(9, 42, key, ATTEMPT_DISPATCHED, 100)], 9, 42, key)
            .unwrap()
            .unwrap();
        assert_eq!((found.reservation_id, found.input_tokens), (100, 40));
        assert!(
            find_attempt(&[row(9, 42, key, ATTEMPT_ACCEPTED, 100)], 9, 43, key)
                .unwrap()
                .is_none()
        );
        assert!(find_attempt(&[row(8, 42, key, ATTEMPT_ACCEPTED, 100)], 9, 42, key).is_err());
        assert!(find_attempt(&[row(9, 42, key, "queued", 100)], 9, 42, key).is_err());
        assert!(find_attempt(&[row(9, 42, key, ATTEMPT_ACCEPTED, 0)], 9, 42, key).is_err());
        let twice = vec![
            row(9, 42, key, ATTEMPT_ACCEPTED, 100),
            row(9, 42, key, ATTEMPT_ACCEPTED, 100),
        ];
        assert!(find_attempt(&twice, 9, 42, key).is_err());
    }

    #[test]
    fn attempt_results_carry_bounded_reasons_and_no_unknown_usage() {
        let succeeded = AttemptResult::succeeded(5, 40, 20);
        assert_eq!(succeeded.status, ATTEMPT_SUCCEEDED);
        assert!(succeeded.failure_reason.is_none());

        let unknown = AttemptResult::outcome_unknown(5, "  provider timeout  ");
        assert_eq!(unknown.status, ATTEMPT_OUTCOME_UNKNOWN);
        assert_eq!((unknown.input_tokens, unknown.output_tokens), (0, 0));
        assert_eq!(unknown.failure_reason.as_deref(), Some("provider timeout"));
        assert!(AttemptResult::outcome_unknown(5, "   ")
            .failure_reason
            .is_none());

        // Truncation stays inside the module limit, is marked, and never splits
        // a multi-byte character.
        let long = "é".repeat(ATTEMPT_NOTE_MAX_LEN);
        let note = AttemptResult::outcome_unknown(5, &long)
            .failure_reason
            .unwrap();
        assert!(note.len() <= ATTEMPT_NOTE_MAX_LEN);
        assert!(note.ends_with(" […]"));
    }

    #[test]
    fn budget_selection_is_per_billing_period() {
        let rows = vec![
            json!({"id": 1, "organization_id": 9, "agent_id": 7, "billing_period": "2026-08",
                   "currency": "EUR", "limit_units": 10, "settled_units": 10, "outstanding_units": 0}),
            json!({"id": 2, "organization_id": 9, "agent_id": 7, "billing_period": "2026-09",
                   "currency": "EUR", "limit_units": 50, "settled_units": 5, "outstanding_units": 3}),
        ];
        let budget = select_budget(&rows, 9, 7, "2026-09").unwrap().unwrap();
        assert_eq!((budget.id, budget.outstanding_units), (2, 3));
        assert!(select_budget(&rows, 9, 7, "2026-10").unwrap().is_none());
    }
}
