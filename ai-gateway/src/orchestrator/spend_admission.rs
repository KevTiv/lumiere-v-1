//! H5b spend admission around provider completions.
//!
//! `SpendAdmittedLlm` wraps any `LlmCompletion` so each provider attempt is
//! reserved and durably accepted before dispatch, claimed once at dispatch, and
//! recorded plus settled afterwards. It is an internal seam for governed
//! routing; no HTTP handler or skill uses it yet.
//!
//! Per call the sequence is: reserve -> accept attempt -> claim dispatch ->
//! provider call -> record result -> settle. The attempt row is the provider
//! truth, so it is recorded before spend is settled; a settlement failure then
//! leaves a `succeeded` attempt against a `reserved` reservation, which is
//! unambiguous to reconcile.
//!
//! Failure policy:
//! - no budget, price snapshot or visible reservation: the provider is not called;
//! - an existing reservation or attempt for the key: the provider is not called,
//!   because recovering either row does not authorize redispatch;
//! - provider error or timeout: the attempt becomes `outcome_unknown` and the
//!   reservation stays reserved; neither is retried or settled here. The
//!   transport cannot tell a lost response from a provider that never ran, so
//!   no dispatch error is recorded as a definite `failed`;
//! - a definite unusable completion (length exhaustion, filtering, or
//!   malformed structured output): the attempt becomes `failed` with bounded
//!   metadata and its known usage is settled;
//! - usage above the reserved allowance: the module rejects the result and the
//!   error propagates with the attempt dispatched and the reservation reserved.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex, OnceLock, Weak,
    },
    time::Duration,
};

use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use stdb_client::StdbClient;

use crate::ai_spend::{
    self, allowance, billing_period, request_key, AcceptAttemptRequest, Allowance, AttemptResult,
    PriceSnapshot, ProviderAttempt, ProviderRecoveryAction, ReconcileAttemptRequest,
    RecoverAttemptRequest, RecoveryAttribution, RequestKind, Reservation, ReserveRequest,
    SpendBudget, SpendReader, ATTEMPT_ABANDONED, ATTEMPT_ACCEPTED, ATTEMPT_DISPATCHED,
    ATTEMPT_FAILED, ATTEMPT_NOTE_MAX_LEN, ATTEMPT_OUTCOME_UNKNOWN, ATTEMPT_SUCCEEDED,
    STATUS_RELEASED, STATUS_RESERVED, STATUS_SETTLED,
};
use super::budget_park::{AdmittedBinding, BudgetBlocked};
use crate::providers::llm::{
    CompletionTermination, LlmCompletion, LlmMessage, LlmRequest, LlmResponse, ProviderRejection,
};

/// Persistence operations needed for admission; implemented over SpacetimeDB
/// in production and in memory for tests.
#[async_trait]
pub(crate) trait SpendLedger: Send + Sync {
    async fn budget(
        &self,
        organization_id: u64,
        agent_id: u64,
        period: &str,
    ) -> Result<Option<SpendBudget>>;
    async fn latest_price_snapshot(
        &self,
        organization_id: u64,
        agent_id: u64,
        provider: &str,
        model: &str,
        currency: &str,
    ) -> Result<Option<PriceSnapshot>>;
    async fn reservation(
        &self,
        organization_id: u64,
        run_id: u64,
        request_key: &str,
    ) -> Result<Option<Reservation>>;
    async fn reserve(&self, request: &ReserveRequest) -> Result<()>;
    async fn settle(
        &self,
        organization_id: u64,
        reservation_id: u64,
        input_tokens: u32,
        output_tokens: u32,
    ) -> Result<()>;
    async fn provider_attempt(
        &self,
        organization_id: u64,
        run_id: u64,
        request_key: &str,
    ) -> Result<Option<ProviderAttempt>>;
    async fn accept_attempt(&self, request: &AcceptAttemptRequest) -> Result<()>;
    async fn mark_attempt_dispatched(&self, organization_id: u64, attempt_id: u64) -> Result<()>;
    async fn record_attempt_result(
        &self,
        organization_id: u64,
        result: &AttemptResult,
    ) -> Result<()>;
    async fn reconcile_attempt(
        &self,
        organization_id: u64,
        attempt_id: u64,
        outcome: ReconciledOutcome,
        input_tokens: u32,
        output_tokens: u32,
        resolution: &str,
        actor_identity: &str,
        approval_id: &str,
    ) -> Result<()>;
    async fn recover_attempt(
        &self,
        organization_id: u64,
        attempt_id: u64,
        action: ProviderRecoveryAction,
        resolution: &str,
        actor_identity: &str,
        approval_id: &str,
    ) -> Result<()>;
}

/// Writes through the gateway principal; reads through the dedicated
/// `AI_SPEND_READ_STDB_TOKEN` principal.
pub(crate) struct StdbSpendLedger<'a> {
    pub writer: &'a StdbClient,
    pub reader: &'a StdbClient,
}

#[async_trait]
impl SpendLedger for StdbSpendLedger<'_> {
    async fn budget(
        &self,
        organization_id: u64,
        agent_id: u64,
        period: &str,
    ) -> Result<Option<SpendBudget>> {
        SpendReader::new(self.reader)
            .budget(organization_id, agent_id, period)
            .await
    }

    async fn latest_price_snapshot(
        &self,
        organization_id: u64,
        agent_id: u64,
        provider: &str,
        model: &str,
        currency: &str,
    ) -> Result<Option<PriceSnapshot>> {
        SpendReader::new(self.reader)
            .latest_price_snapshot(organization_id, agent_id, provider, model, currency)
            .await
    }

    async fn reservation(
        &self,
        organization_id: u64,
        run_id: u64,
        request_key: &str,
    ) -> Result<Option<Reservation>> {
        SpendReader::new(self.reader)
            .reservation(organization_id, run_id, request_key)
            .await
    }

    async fn reserve(&self, request: &ReserveRequest) -> Result<()> {
        ai_spend::reserve(self.writer, request).await
    }

    async fn provider_attempt(
        &self,
        organization_id: u64,
        run_id: u64,
        request_key: &str,
    ) -> Result<Option<ProviderAttempt>> {
        SpendReader::new(self.reader)
            .provider_attempt(organization_id, run_id, request_key)
            .await
    }

    async fn accept_attempt(&self, request: &AcceptAttemptRequest) -> Result<()> {
        ai_spend::accept_provider_attempt(self.writer, request).await
    }

    async fn mark_attempt_dispatched(&self, organization_id: u64, attempt_id: u64) -> Result<()> {
        ai_spend::mark_provider_attempt_dispatched(self.writer, organization_id, attempt_id).await
    }

    async fn record_attempt_result(
        &self,
        organization_id: u64,
        result: &AttemptResult,
    ) -> Result<()> {
        ai_spend::record_provider_attempt_result(self.writer, organization_id, result).await
    }

    async fn reconcile_attempt(
        &self,
        organization_id: u64,
        attempt_id: u64,
        outcome: ReconciledOutcome,
        input_tokens: u32,
        output_tokens: u32,
        resolution: &str,
        actor_identity: &str,
        approval_id: &str,
    ) -> Result<()> {
        ai_spend::reconcile_provider_attempt(
            self.writer,
            &ReconcileAttemptRequest {
                organization_id,
                attempt_id,
                status: outcome.status(),
                input_tokens,
                output_tokens,
                attribution: RecoveryAttribution {
                    actor_identity: actor_identity.into(),
                    approval_id: approval_id.into(),
                    resolution: resolution.into(),
                },
            },
        )
        .await
    }

    async fn recover_attempt(
        &self,
        organization_id: u64,
        attempt_id: u64,
        action: ProviderRecoveryAction,
        resolution: &str,
        actor_identity: &str,
        approval_id: &str,
    ) -> Result<()> {
        ai_spend::recover_provider_attempt(
            self.writer,
            &RecoverAttemptRequest {
                organization_id,
                attempt_id,
                action,
                attribution: RecoveryAttribution {
                    actor_identity: actor_identity.into(),
                    approval_id: approval_id.into(),
                    resolution: resolution.into(),
                },
            },
        )
        .await
    }

    async fn settle(
        &self,
        organization_id: u64,
        reservation_id: u64,
        input_tokens: u32,
        output_tokens: u32,
    ) -> Result<()> {
        ai_spend::settle(
            self.writer,
            organization_id,
            reservation_id,
            input_tokens,
            output_tokens,
        )
        .await
    }
}

/// Trusted run and agent facts the reservation is bound to.
#[derive(Clone, Debug)]
pub(super) struct SpendBinding {
    pub organization_id: u64,
    pub company_id: u64,
    pub agent_id: u64,
    pub run_id: u64,
    pub provider: String,
    pub model: String,
    pub agent_max_tokens: u32,
    pub context_window: u32,
}

/// Operator-supplied, exact identity and known usage for resolving one
/// ambiguous provider effect. Reconciliation never authorizes provider I/O.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ProviderAttemptReconciliation {
    pub request_key: String,
    pub reservation_id: u64,
    pub attempt_id: u64,
    pub outcome: ReconciledOutcome,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub resolution: String,
    pub actor_identity: String,
    pub approval_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct AcceptedAttemptAbandonment {
    pub request_key: String,
    pub reservation_id: u64,
    pub attempt_id: u64,
    pub resolution: String,
    pub actor_identity: String,
    pub approval_id: String,
}

/// A provider outcome established outside the request transport, for example
/// from a provider usage log or support response.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ReconciledOutcome {
    Succeeded,
    Failed,
}

impl ReconciledOutcome {
    fn status(self) -> &'static str {
        match self {
            Self::Succeeded => ATTEMPT_SUCCEEDED,
            Self::Failed => ATTEMPT_FAILED,
        }
    }
}

/// Resolve an ambiguous provider attempt and settle its reservation.
///
/// The SpacetimeDB reducers remain the transition and spend authorities. This
/// function adds gateway-side exact-binding checks, verifies the committed
/// result before settlement, and deliberately contains no dispatch path.
/// Retrying the same request is safe when reconciliation committed but
/// settlement or its response was lost.
pub(super) async fn reconcile_provider_spend(
    ledger: &dyn SpendLedger,
    binding: &SpendBinding,
    request: &ProviderAttemptReconciliation,
) -> Result<()> {
    if binding.organization_id == 0
        || binding.company_id == 0
        || binding.agent_id == 0
        || binding.run_id == 0
    {
        bail!("spend reconciliation requires organization, company, agent and durable run ids");
    }
    if request.reservation_id == 0 || request.attempt_id == 0 {
        bail!("spend reconciliation requires exact reservation and attempt ids");
    }
    let resolution = request.resolution.trim();
    for (label, value, max) in [
        ("operator resolution", resolution, ATTEMPT_NOTE_MAX_LEN),
        ("actor identity", request.actor_identity.trim(), 160),
        ("approval id", request.approval_id.trim(), 160),
    ] {
        if value.is_empty() || value.len() > max || value.chars().any(char::is_control) {
            bail!("spend reconciliation requires a valid {label}");
        }
    }

    let reservation = ledger
        .reservation(
            binding.organization_id,
            binding.run_id,
            &request.request_key,
        )
        .await?
        .context("spend reconciliation reservation was not found")?;
    ensure_reconciliation_reservation(&reservation, binding, request)?;

    let mut attempt = ledger
        .provider_attempt(
            binding.organization_id,
            binding.run_id,
            &request.request_key,
        )
        .await?
        .context("spend reconciliation provider attempt was not found")?;
    ensure_reconciliation_attempt_binding(&attempt, binding, request)?;
    if attempt.status == ATTEMPT_DISPATCHED {
        ledger
            .recover_attempt(
                binding.organization_id,
                request.attempt_id,
                ProviderRecoveryAction::MarkOutcomeUnknown,
                resolution,
                request.actor_identity.trim(),
                request.approval_id.trim(),
            )
            .await?;
        attempt = ledger
            .provider_attempt(
                binding.organization_id,
                binding.run_id,
                &request.request_key,
            )
            .await?
            .context("recovered provider attempt is not visible")?;
        ensure_reconciliation_attempt_binding(&attempt, binding, request)?;
    }
    ensure_reconciliation_attempt_state(&attempt, request)?;
    if reservation.status == STATUS_SETTLED && attempt.status == ATTEMPT_OUTCOME_UNKNOWN {
        bail!("an unknown provider attempt cannot be reconciled against already settled spend");
    }

    ledger
        .reconcile_attempt(
            binding.organization_id,
            request.attempt_id,
            request.outcome,
            request.input_tokens,
            request.output_tokens,
            resolution,
            request.actor_identity.trim(),
            request.approval_id.trim(),
        )
        .await?;

    // Never settle merely because the reconciliation call returned. Confirm
    // the exact durable attempt transition and usage first.
    let committed = ledger
        .provider_attempt(
            binding.organization_id,
            binding.run_id,
            &request.request_key,
        )
        .await?
        .context("reconciled provider attempt is not visible")?;
    if committed.id != request.attempt_id
        || committed.reservation_id != request.reservation_id
        || committed.status != request.outcome.status()
        || committed.input_tokens != request.input_tokens
        || committed.output_tokens != request.output_tokens
        || committed.resolution.as_deref() != Some(resolution)
        || committed.reconciliation_actor.as_deref() != Some(request.actor_identity.trim())
        || committed.reconciliation_approval_id.as_deref() != Some(request.approval_id.trim())
    {
        bail!("reconciled provider attempt does not match the requested outcome");
    }

    ledger
        .settle(
            binding.organization_id,
            request.reservation_id,
            request.input_tokens,
            request.output_tokens,
        )
        .await
        .context("provider attempt reconciled but spend settlement remains incomplete")
}

/// Abandon a durable intent that never claimed dispatch. This is the only
/// recovery for `accepted`: the request is not resumed because its provider
/// payload was not durably hashed, and the reservation is released atomically
/// by the authoritative recovery reducer.
pub(super) async fn abandon_accepted_provider_spend(
    ledger: &dyn SpendLedger,
    binding: &SpendBinding,
    request: &AcceptedAttemptAbandonment,
) -> Result<()> {
    let resolution = request.resolution.trim();
    if binding.organization_id == 0
        || binding.company_id == 0
        || binding.agent_id == 0
        || binding.run_id == 0
        || request.reservation_id == 0
        || request.attempt_id == 0
        || resolution.is_empty()
        || resolution.len() > ATTEMPT_NOTE_MAX_LEN
        || resolution.chars().any(char::is_control)
        || request.actor_identity.trim().is_empty()
        || request.actor_identity.trim().len() > 160
        || request.approval_id.trim().is_empty()
        || request.approval_id.trim().len() > 160
    {
        bail!("accepted attempt abandonment requires exact binding and attribution");
    }
    let reservation = ledger
        .reservation(
            binding.organization_id,
            binding.run_id,
            &request.request_key,
        )
        .await?
        .context("abandonment reservation was not found")?;
    if reservation.id != request.reservation_id
        || reservation.company_id != binding.company_id
        || reservation.agent_id != binding.agent_id
        || reservation.provider != binding.provider
        || reservation.model != binding.model
        || !matches!(
            reservation.status.as_str(),
            STATUS_RESERVED | STATUS_RELEASED
        )
    {
        bail!("abandonment reservation does not match the trusted binding");
    }
    let attempt = ledger
        .provider_attempt(
            binding.organization_id,
            binding.run_id,
            &request.request_key,
        )
        .await?
        .context("abandonment provider attempt was not found")?;
    if attempt.id != request.attempt_id
        || attempt.reservation_id != request.reservation_id
        || attempt.company_id != binding.company_id
        || attempt.agent_id != binding.agent_id
        || attempt.provider != binding.provider
        || attempt.model != binding.model
        || !matches!(
            attempt.status.as_str(),
            ATTEMPT_ACCEPTED | ATTEMPT_ABANDONED
        )
    {
        bail!("only the exact accepted pre-dispatch attempt can be abandoned");
    }
    ledger
        .recover_attempt(
            binding.organization_id,
            request.attempt_id,
            ProviderRecoveryAction::AbandonAccepted,
            resolution,
            request.actor_identity.trim(),
            request.approval_id.trim(),
        )
        .await
}

fn ensure_reconciliation_reservation(
    reservation: &Reservation,
    binding: &SpendBinding,
    request: &ProviderAttemptReconciliation,
) -> Result<()> {
    if reservation.id != request.reservation_id
        || reservation.company_id != binding.company_id
        || reservation.agent_id != binding.agent_id
        || reservation.provider != binding.provider
        || reservation.model != binding.model
        || !matches!(
            reservation.status.as_str(),
            STATUS_RESERVED | STATUS_SETTLED
        )
    {
        bail!("spend reconciliation reservation does not match the trusted binding");
    }
    if request.input_tokens > reservation.input_token_allowance
        || request.output_tokens > reservation.output_token_allowance
    {
        bail!("reconciled usage exceeds the reservation allowance");
    }
    Ok(())
}

fn ensure_reconciliation_attempt_binding(
    attempt: &ProviderAttempt,
    binding: &SpendBinding,
    request: &ProviderAttemptReconciliation,
) -> Result<()> {
    if attempt.id != request.attempt_id
        || attempt.reservation_id != request.reservation_id
        || attempt.company_id != binding.company_id
        || attempt.agent_id != binding.agent_id
        || attempt.provider != binding.provider
        || attempt.model != binding.model
    {
        bail!("spend reconciliation attempt does not match the trusted binding");
    }
    Ok(())
}

fn ensure_reconciliation_attempt_state(
    attempt: &ProviderAttempt,
    request: &ProviderAttemptReconciliation,
) -> Result<()> {
    if attempt.status == ATTEMPT_OUTCOME_UNKNOWN {
        return Ok(());
    }
    // This exact terminal state may be a replay after the reconciliation
    // committed and settlement failed. The reducer checks the resolution too.
    if attempt.status == request.outcome.status()
        && attempt.input_tokens == request.input_tokens
        && attempt.output_tokens == request.output_tokens
    {
        return Ok(());
    }
    bail!(
        "provider attempt is {}; accepted attempts must be abandoned and only dispatched attempts may recover to outcome_unknown",
        attempt.status
    )
}

/// Build a [`SpendBinding`] from a resolved agent and durable run context.
///
/// Returns an error if `context_window` is zero (spend admission requires it
/// for allowance calculation) or if `organization_id` / `company_id` are zero.
/// The `run_id` may be zero here; [`SpendAdmittedLlm`] will reject it at
/// construction time if it is still zero when the binding is consumed.
pub(super) fn spend_binding_from_agent(
    agent: &crate::ai_agent::ResolvedAgentConfig,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
) -> anyhow::Result<SpendBinding> {
    if organization_id == 0 || company_id == 0 {
        bail!("organization and company are required for spend admission");
    }
    if agent.context_window == 0 {
        bail!(
            "agent {} has no context_window configured; spend admission requires it",
            agent.agent_id
        );
    }
    Ok(SpendBinding {
        organization_id,
        company_id,
        agent_id: agent.agent_id,
        run_id,
        provider: agent.provider.clone(),
        model: agent.model.clone(),
        agent_max_tokens: agent.max_tokens,
        context_window: agent.context_window,
    })
}

/// Build a spend binding for a resolved intelligence model profile.
///
/// The agent remains the budget/rate-limit owner; provider/model/context are
/// selected by versioned intelligence policy rather than by workflow code.
pub(super) fn spend_binding_for_profile(
    agent: &crate::ai_agent::ResolvedAgentConfig,
    profile: &super::model_configuration::ModelProfile,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
) -> anyhow::Result<SpendBinding> {
    if organization_id == 0 || company_id == 0 {
        bail!("organization and company are required for spend admission");
    }
    if !agent.allowed_models.is_empty()
        && !agent
            .allowed_models
            .iter()
            .any(|model| model.eq_ignore_ascii_case(&profile.model))
    {
        bail!(
            "configured model profile '{}' selects model '{}' outside agent allowed_models",
            profile.reference.stable_ref(),
            profile.model
        );
    }
    if profile.context_window == 0 || profile.max_tokens == 0 {
        bail!("configured model profile requires positive token limits");
    }
    Ok(SpendBinding {
        organization_id,
        company_id,
        agent_id: agent.agent_id,
        run_id,
        provider: profile.provider.clone(),
        model: profile.model.clone(),
        agent_max_tokens: profile.max_tokens.min(agent.max_tokens),
        context_window: profile.context_window,
    })
}

pub(super) struct SpendAdmittedLlm<'a> {
    inner: &'a dyn LlmCompletion,
    ledger: &'a dyn SpendLedger,
    binding: SpendBinding,
    clock: fn() -> DateTime<Utc>,
    call_scope: u32,
    next_call: AtomicU32,
    profile_limits: Option<(Arc<tokio::sync::Semaphore>, Duration)>,
}

/// A dispatched attempt needs reconciliation before any retry or fallback.
/// Retain the typed marker through anyhow contexts, including persistence errors.
#[derive(Debug, thiserror::Error)]
#[error("provider attempt requires reconciliation: {0}")]
pub(super) struct UnresolvedProviderAttempt(#[source] anyhow::Error);

type ProfilePermits = HashMap<(u64, String), (u32, Weak<tokio::sync::Semaphore>)>;
static PROFILE_PERMITS: OnceLock<Mutex<ProfilePermits>> = OnceLock::new();

impl<'a> SpendAdmittedLlm<'a> {
    pub fn new(
        inner: &'a dyn LlmCompletion,
        ledger: &'a dyn SpendLedger,
        binding: SpendBinding,
    ) -> Result<Self> {
        Self::with_clock_and_scope(inner, ledger, binding, Utc::now, 0)
    }

    pub fn new_scoped(
        inner: &'a dyn LlmCompletion,
        ledger: &'a dyn SpendLedger,
        binding: SpendBinding,
        call_scope: u32,
    ) -> Result<Self> {
        Self::with_clock_and_scope(inner, ledger, binding, Utc::now, call_scope)
    }

    /// Enforce immutable profile limits across concurrent runs in this gateway.
    /// Each replica has its own permits; durable spend admission remains global.
    pub fn with_profile_limits(
        mut self,
        profile: &super::model_configuration::ModelProfile,
    ) -> Result<Self> {
        if profile.timeout_ms == 0
            || profile.max_concurrency == 0
            || profile.max_concurrency as usize > tokio::sync::Semaphore::MAX_PERMITS
        {
            bail!("profile timeout and concurrency limits must be positive");
        }
        let mut permits = PROFILE_PERMITS
            .get_or_init(Mutex::default)
            .lock()
            .map_err(|_| anyhow::anyhow!("profile concurrency registry unavailable"))?;
        permits.retain(|_, (_, value)| value.strong_count() > 0);
        let key = (self.binding.organization_id, profile.reference.stable_ref());
        let limit = if profile.supports_parallel_requests {
            profile.max_concurrency
        } else {
            1
        };
        let semaphore = match permits
            .get(&key)
            .and_then(|(prior, weak)| weak.upgrade().map(|value| (*prior, value)))
        {
            Some((prior, semaphore)) => {
                anyhow::ensure!(
                    prior == limit,
                    "immutable profile concurrency limit changed"
                );
                semaphore
            }
            None => {
                let semaphore = Arc::new(tokio::sync::Semaphore::new(limit as usize));
                permits.insert(key, (limit, Arc::downgrade(&semaphore)));
                semaphore
            }
        };
        self.profile_limits = Some((
            semaphore,
            Duration::from_millis(u64::from(profile.timeout_ms)),
        ));
        Ok(self)
    }

    fn with_clock(
        inner: &'a dyn LlmCompletion,
        ledger: &'a dyn SpendLedger,
        binding: SpendBinding,
        clock: fn() -> DateTime<Utc>,
    ) -> Result<Self> {
        Self::with_clock_and_scope(inner, ledger, binding, clock, 0)
    }

    fn with_clock_and_scope(
        inner: &'a dyn LlmCompletion,
        ledger: &'a dyn SpendLedger,
        binding: SpendBinding,
        clock: fn() -> DateTime<Utc>,
        call_scope: u32,
    ) -> Result<Self> {
        if binding.organization_id == 0
            || binding.company_id == 0
            || binding.agent_id == 0
            || binding.run_id == 0
        {
            bail!("spend admission requires organization, company, agent and durable run ids");
        }
        if call_scope > 9_999 {
            bail!("spend call scope must be <= 9999");
        }
        Ok(Self {
            inner,
            ledger,
            binding,
            clock,
            call_scope,
            next_call: AtomicU32::new(1),
            profile_limits: None,
        })
    }

    fn admitted_binding(&self) -> AdmittedBinding {
        AdmittedBinding {
            agent_id: self.binding.agent_id,
            provider: self.binding.provider.clone(),
            model: self.binding.model.clone(),
        }
    }

    async fn admit(&self, req: &LlmRequest, key: &str) -> Result<Reservation> {
        let b = &self.binding;
        if req.provider != b.provider || req.model != b.model {
            bail!("provider request does not match the admitted provider and model");
        }
        if let Some(existing) = self
            .ledger
            .reservation(b.organization_id, b.run_id, key)
            .await?
        {
            return Err(UnresolvedProviderAttempt(anyhow::anyhow!(
                "spend attempt {key} already has a {} reservation; not redispatching",
                existing.status
            ))
            .into());
        }
        let period = billing_period((self.clock)());
        let budget = self
            .ledger
            .budget(b.organization_id, b.agent_id, &period)
            .await?
            .with_context(|| format!("no AI spend budget configured for {period}"))?;
        let snapshot = self
            .ledger
            .latest_price_snapshot(
                b.organization_id,
                b.agent_id,
                &b.provider,
                &b.model,
                &budget.currency,
            )
            .await?
            .context("no price snapshot for the admitted provider, model and currency")?;
        let allowance = allowance(
            prompt_bytes(req)?,
            req.max_tokens,
            b.agent_max_tokens,
            b.context_window,
        )?;
        // A denial caused by the budget window is typed so the run can park
        // until the window resets instead of ending. Nothing is reserved or
        // dispatched at this point.
        let needed = super::budget_park::required_units(&snapshot, &allowance)?;
        let blocked = || {
            anyhow::Error::new(BudgetBlocked {
                window_resets_at: super::budget_park::next_window_start((self.clock)()),
                required_units: needed,
                allowance,
            })
            .context(self.admitted_binding())
        };
        if budget
            .settled_units
            .saturating_add(budget.outstanding_units)
            .saturating_add(needed)
            > budget.limit_units
        {
            return Err(blocked());
        }
        let request = ReserveRequest {
            organization_id: b.organization_id,
            company_id: b.company_id,
            agent_id: b.agent_id,
            run_id: b.run_id,
            request_key: key.to_string(),
            provider: b.provider.clone(),
            model: b.model.clone(),
            billing_period: period,
            currency: budget.currency,
            price_snapshot_id: snapshot.id,
            allowance,
        };
        if let Err(error) = self.ledger.reserve(&request).await {
            // Lost a race for the last headroom: same typed denial.
            return Err(if format!("{error:#}").contains("budget exhausted") {
                blocked()
            } else {
                error
            });
        }
        let reservation = self
            .ledger
            .reservation(b.organization_id, b.run_id, key)
            .await?
            .context("reservation is not visible after reserve")?;
        ensure_binding(&reservation, &request)?;
        Ok(reservation)
    }

    /// Commit attempt intent for an admitted reservation and read the row back,
    /// because the reducer cannot return the inserted id.
    async fn accept(&self, reservation: &Reservation, key: &str) -> Result<ProviderAttempt> {
        let b = &self.binding;
        let request = AcceptAttemptRequest {
            organization_id: b.organization_id,
            company_id: b.company_id,
            agent_id: b.agent_id,
            run_id: b.run_id,
            reservation_id: reservation.id,
            request_key: key.to_string(),
            provider: b.provider.clone(),
            model: b.model.clone(),
        };
        self.ledger.accept_attempt(&request).await?;
        let attempt = self
            .ledger
            .provider_attempt(b.organization_id, b.run_id, key)
            .await?
            .context("provider attempt is not visible after accept")?;
        if attempt.reservation_id != reservation.id
            || attempt.company_id != b.company_id
            || attempt.agent_id != b.agent_id
            || attempt.provider != b.provider
            || attempt.model != b.model
        {
            bail!("provider attempt does not match the admitted binding");
        }
        // Only a freshly accepted attempt may be dispatched; recovering a
        // dispatched or finished row never authorizes calling the provider again.
        if attempt.status != ATTEMPT_ACCEPTED {
            return Err(UnresolvedProviderAttempt(anyhow::anyhow!(
                "provider attempt {key} is already {}; not redispatching",
                attempt.status
            ))
            .into());
        }
        Ok(attempt)
    }
}

#[async_trait]
impl LlmCompletion for SpendAdmittedLlm<'_> {
    fn validate_request(&self, req: &LlmRequest) -> Result<()> {
        self.inner.validate_request(req)
    }

    async fn complete(&self, req: LlmRequest) -> Result<LlmResponse> {
        // Deterministic transport rejection (including foreign native replay)
        // must not create a reservation or an apparently dispatched attempt.
        self.validate_request(&req)?;
        // Queue before reserving spend. Timing out here cannot have a provider
        // effect and must not leave a reservation or an accepted attempt.
        let _permit = match &self.profile_limits {
            Some((semaphore, timeout)) => Some(
                tokio::time::timeout(*timeout, semaphore.acquire())
                    .await
                    .context("profile concurrency wait timed out before spend admission")?
                    .context("profile concurrency limiter closed")?,
            ),
            None => None,
        };
        let organization_id = self.binding.organization_id;
        let call = self.next_call.fetch_add(1, Ordering::SeqCst);
        let step = self
            .call_scope
            .checked_mul(100_000)
            .and_then(|base| base.checked_add(call))
            .context("spend request key call scope overflow")?;
        let key = request_key(RequestKind::Spend, self.binding.run_id, step, 0)?;
        let reservation = self.admit(&req, &key).await?;
        let attempt = self.accept(&reservation, &key).await?;
        self.ledger
            .mark_attempt_dispatched(organization_id, attempt.id)
            .await
            .with_context(|| format!("dispatch was not claimed for {key}; provider not called"))?;
        let completion = async {
            match &self.profile_limits {
                Some((_, timeout)) => tokio::time::timeout(*timeout, self.inner.complete(req))
                    .await
                    .context("profile provider deadline exceeded")?,
                None => self.inner.complete(req).await,
            }
        };
        let response = match completion.await {
            Ok(response) => response,
            Err(error) => {
                if error.downcast_ref::<ProviderRejection>().is_some() {
                    self.ledger
                        .record_attempt_result(
                            organization_id,
                            &AttemptResult::failed(attempt.id, 0, 0, &error.to_string()),
                        )
                        .await
                        .context("could not record definite provider rejection; retry denied")
                        .map_err(UnresolvedProviderAttempt)?;
                    self.ledger
                        .settle(organization_id, reservation.id, 0, 0)
                        .await
                        .context("could not settle definite provider rejection; retry denied")
                        .map_err(UnresolvedProviderAttempt)?;
                    return Err(error
                        .context("provider rejection recorded and zero usage settled")
                        .context(self.admitted_binding()));
                }
                // The provider may have run, so the outcome is unknown rather
                // than failed, and the reservation stays reserved.
                self.ledger
                    .record_attempt_result(
                        organization_id,
                        &AttemptResult::outcome_unknown(attempt.id, &error.to_string()),
                    )
                    .await
                    .with_context(|| {
                        format!("could not record the unknown outcome of {key}: {error}")
                    })
                    .map_err(UnresolvedProviderAttempt)?;
                return Err(UnresolvedProviderAttempt(error.context(format!(
                    "provider dispatch failed for {key}; attempt left for reconciliation"
                )))
                .into());
            }
        };
        let result = match definite_completion_failure(&response) {
            Some(reason) => AttemptResult::failed(
                attempt.id,
                response.input_tokens,
                response.output_tokens,
                &reason,
            ),
            None => {
                AttemptResult::succeeded(attempt.id, response.input_tokens, response.output_tokens)
            }
        };
        self.ledger
            .record_attempt_result(organization_id, &result)
            .await
            .with_context(|| {
                format!("recording the result of {key} failed; attempt and reservation left for reconciliation")
            }).map_err(UnresolvedProviderAttempt)?;
        self.ledger
            .settle(
                organization_id,
                reservation.id,
                response.input_tokens,
                response.output_tokens,
            )
            .await
            .with_context(|| {
                format!("settlement failed for {key}; reservation left for reconciliation")
            })
            .map_err(UnresolvedProviderAttempt)?;
        Ok(response)
    }
}

fn definite_completion_failure(response: &LlmResponse) -> Option<String> {
    let content_present = !response.text.trim().is_empty()
        || response
            .tool_calls
            .iter()
            .any(|call| call.arguments_error.is_none());
    match response.termination {
        CompletionTermination::Length => Some(format!(
            "completion_termination=length; thinking_observed={}; content_present={content_present}",
            response.thinking_observed
        )),
        CompletionTermination::Filtered => Some(format!(
            "completion_termination=filtered; provider_reason={}",
            response.provider_done_reason.as_deref().unwrap_or("filtered")
        )),
        CompletionTermination::Complete
        | CompletionTermination::ToolCall
        | CompletionTermination::Unknown => {
            if response
                .tool_calls
                .iter()
                .any(|call| call.arguments_error.is_some())
            {
                Some("completion_termination=malformed_structured_output".to_string())
            } else if !content_present {
                Some(format!(
                    "completion_termination={}; content_present=false",
                    match response.termination {
                        CompletionTermination::Complete => "complete",
                        CompletionTermination::ToolCall => "tool_call",
                        CompletionTermination::Unknown => "unknown",
                        CompletionTermination::Length => "length",
                        CompletionTermination::Filtered => "filtered",
                    }
                ))
            } else {
                None
            }
        }
    }
}

fn ensure_binding(reservation: &Reservation, request: &ReserveRequest) -> Result<()> {
    let expected = Allowance {
        input_tokens: reservation.input_token_allowance,
        output_tokens: reservation.output_token_allowance,
    };
    if reservation.status != STATUS_RESERVED
        || reservation.company_id != request.company_id
        || reservation.agent_id != request.agent_id
        || reservation.provider != request.provider
        || reservation.model != request.model
        || reservation.price_snapshot_id != request.price_snapshot_id
        || expected != request.allowance
    {
        bail!("reservation does not match the requested binding");
    }
    Ok(())
}

/// UTF-8 bytes the provider will receive for this attempt.
fn prompt_bytes(req: &LlmRequest) -> Result<usize> {
    let messages = req.messages.iter().try_fold(0_usize, |total, message| {
        let bytes = match message {
            LlmMessage::Text { role, content } => role.len() + content.len(),
            LlmMessage::AssistantToolCalls {
                content,
                tool_calls,
            } => {
                content.as_deref().map_or(0, str::len)
                    + tool_calls
                        .iter()
                        .map(|call| {
                            call.name.len()
                                + call.id.as_deref().map_or(0, str::len)
                                + call.arguments.to_string().len()
                        })
                        .sum::<usize>()
            }
            LlmMessage::ToolResult {
                tool_call_id,
                name,
                content,
            } => tool_call_id.as_deref().map_or(0, str::len) + name.len() + content.len(),
            // This is the full native assistant message, including its visible
            // content and tool calls. Count it once, not again as normalized text.
            LlmMessage::MistralAssistant(_) => {
                message.mistral_replay_bytes(&req.provider, &req.model)?
            }
        };
        total
            .checked_add(bytes)
            .context("provider prompt size overflow")
    })?;
    let tools: usize = req
        .tools
        .iter()
        .map(|tool| serde_json::to_string(tool).map_or(0, |json| json.len()))
        .sum();
    req.system
        .len()
        .checked_add(messages)
        .and_then(|bytes| bytes.checked_add(tools))
        .context("provider prompt size overflow")
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use anyhow::anyhow;
    use chrono::TimeZone;
    use std::sync::Mutex;

    use crate::providers::llm::ThinkingMode;

    fn fixed_clock() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 13, 12, 0, 0).unwrap()
    }

    fn binding() -> SpendBinding {
        SpendBinding {
            organization_id: 9,
            company_id: 3,
            agent_id: 7,
            run_id: 42,
            provider: "mistral".into(),
            model: "mistral-small".into(),
            agent_max_tokens: 2_048,
            context_window: 32_000,
        }
    }

    fn request() -> LlmRequest {
        LlmRequest {
            provider: "mistral".into(),
            model: "mistral-small".into(),
            system: "system".into(),
            messages: vec![LlmMessage::text("user", "hello")],
            max_tokens: 256,
            temperature: None,
            top_p: None,
            tools: Vec::new(),
            single_shot_tool: false,
            thinking: ThinkingMode::ProviderDefault,
        }
    }

    fn response(input: u32, output: u32) -> LlmResponse {
        LlmResponse {
            text: "ok".into(),
            input_tokens: input,
            output_tokens: output,
            model: "mistral-small".into(),
            provider: "mistral".into(),
            tool_calls: Vec::new(),
            termination: CompletionTermination::Complete,
            provider_done_reason: Some("stop".into()),
            thinking_observed: false,
            mistral_replay: None,
        }
    }

    struct Provider {
        results: Mutex<Vec<Result<LlmResponse>>>,
        calls: Mutex<u32>,
    }

    impl Provider {
        fn new(result: Result<LlmResponse>) -> Self {
            Self::sequence(vec![result])
        }

        fn sequence(results: Vec<Result<LlmResponse>>) -> Self {
            Self {
                results: Mutex::new(results.into_iter().rev().collect()),
                calls: Mutex::new(0),
            }
        }
        fn calls(&self) -> u32 {
            *self.calls.lock().unwrap()
        }
    }

    #[async_trait]
    impl LlmCompletion for Provider {
        async fn complete(&self, _req: LlmRequest) -> Result<LlmResponse> {
            *self.calls.lock().unwrap() += 1;
            self.results
                .lock()
                .unwrap()
                .pop()
                .unwrap_or_else(|| Err(anyhow!("scripted provider exhausted")))
        }
    }

    #[derive(Default)]
    pub(crate) struct FakeLedger {
        has_budget: bool,
        has_snapshot: bool,
        /// Overrides the default 1_000_000-unit budget limit.
        budget_limit: Option<u64>,
        /// Models a reader that sees an attempt recovered as already dispatched.
        accepts_as_dispatched: bool,
        reservations: Mutex<Vec<Reservation>>,
        attempts: Mutex<Vec<ProviderAttempt>>,
        settled: Mutex<Vec<(u64, u32, u32)>>,
        reconciliations: Mutex<Vec<(u64, String, String, String)>>,
        result_failures: AtomicU32,
        settle_failures: AtomicU32,
        settle_response_losses: AtomicU32,
        /// Ledger writes in call order, so tests can assert the sequence.
        writes: Mutex<Vec<String>>,
    }

    impl FakeLedger {
        pub(crate) fn configured() -> Self {
            Self {
                has_budget: true,
                has_snapshot: true,
                ..Self::default()
            }
        }

        pub(crate) fn with_budget_limit(mut self, limit: u64) -> Self {
            self.budget_limit = Some(limit);
            self
        }

        fn attempt(&self, key: &str) -> ProviderAttempt {
            self.attempts
                .lock()
                .unwrap()
                .iter()
                .find(|attempt| attempt.request_key == key)
                .cloned()
                .expect("attempt was not persisted")
        }

        pub(crate) fn writes(&self) -> Vec<String> {
            self.writes.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl SpendLedger for FakeLedger {
        async fn budget(&self, _: u64, _: u64, _: &str) -> Result<Option<SpendBudget>> {
            Ok(self.has_budget.then(|| SpendBudget {
                id: 1,
                currency: "EUR".into(),
                limit_units: self.budget_limit.unwrap_or(1_000_000),
                settled_units: 0,
                outstanding_units: 0,
            }))
        }

        async fn latest_price_snapshot(
            &self,
            _: u64,
            _: u64,
            _: &str,
            _: &str,
            currency: &str,
        ) -> Result<Option<PriceSnapshot>> {
            assert_eq!(currency, "EUR");
            Ok(self.has_snapshot.then(|| PriceSnapshot {
                id: 11,
                version: 2,
                input_units_per_1k: 200,
                output_units_per_1k: 600,
            }))
        }

        async fn reservation(&self, _: u64, _: u64, key: &str) -> Result<Option<Reservation>> {
            Ok(self
                .reservations
                .lock()
                .unwrap()
                .iter()
                .find(|r| r.request_key == key)
                .cloned())
        }

        async fn reserve(&self, request: &ReserveRequest) -> Result<()> {
            self.writes.lock().unwrap().push("reserve".into());
            let mut rows = self.reservations.lock().unwrap();
            let id = rows.len() as u64 + 100;
            rows.push(Reservation {
                id,
                company_id: request.company_id,
                agent_id: request.agent_id,
                request_key: request.request_key.clone(),
                provider: request.provider.clone(),
                model: request.model.clone(),
                price_snapshot_id: request.price_snapshot_id,
                reserved_units: 1,
                input_token_allowance: request.allowance.input_tokens,
                output_token_allowance: request.allowance.output_tokens,
                status: STATUS_RESERVED.into(),
                settled_input_tokens: 0,
                settled_output_tokens: 0,
            });
            Ok(())
        }

        async fn settle(&self, _: u64, id: u64, input: u32, output: u32) -> Result<()> {
            self.writes.lock().unwrap().push("settle".into());
            if self
                .settle_failures
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |remaining| {
                    remaining.checked_sub(1)
                })
                .is_ok()
            {
                bail!("scripted settlement failure");
            }
            let mut rows = self.reservations.lock().unwrap();
            let row = rows
                .iter_mut()
                .find(|r| r.id == id)
                .context("no reservation")?;
            if row.status == STATUS_SETTLED {
                if (row.settled_input_tokens, row.settled_output_tokens) == (input, output) {
                    return Ok(());
                }
                bail!("settlement replay has different usage");
            }
            if row.status != STATUS_RESERVED {
                bail!("only a reserved reservation can be settled");
            }
            if input > row.input_token_allowance || output > row.output_token_allowance {
                bail!("actual usage exceeds reservation allowance");
            }
            row.status = STATUS_SETTLED.into();
            row.settled_input_tokens = input;
            row.settled_output_tokens = output;
            self.settled.lock().unwrap().push((id, input, output));
            if self
                .settle_response_losses
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |remaining| {
                    remaining.checked_sub(1)
                })
                .is_ok()
            {
                bail!("scripted lost settlement response");
            }
            Ok(())
        }

        async fn provider_attempt(
            &self,
            _: u64,
            _: u64,
            key: &str,
        ) -> Result<Option<ProviderAttempt>> {
            Ok(self
                .attempts
                .lock()
                .unwrap()
                .iter()
                .find(|attempt| attempt.request_key == key)
                .cloned())
        }

        /// Mirrors the module: replaying one binding is a no-op, and reusing a
        /// key for a different binding is rejected.
        async fn accept_attempt(&self, request: &AcceptAttemptRequest) -> Result<()> {
            self.writes.lock().unwrap().push("accept".into());
            let mut rows = self.attempts.lock().unwrap();
            if let Some(existing) = rows
                .iter()
                .find(|attempt| attempt.request_key == request.request_key)
            {
                if existing.reservation_id != request.reservation_id
                    || existing.company_id != request.company_id
                    || existing.agent_id != request.agent_id
                {
                    bail!("request key was already used for a different provider attempt");
                }
                return Ok(());
            }
            let id = rows.len() as u64 + 200;
            rows.push(ProviderAttempt {
                id,
                company_id: request.company_id,
                agent_id: request.agent_id,
                reservation_id: request.reservation_id,
                request_key: request.request_key.clone(),
                provider: request.provider.clone(),
                model: request.model.clone(),
                status: if self.accepts_as_dispatched {
                    ATTEMPT_DISPATCHED.into()
                } else {
                    ATTEMPT_ACCEPTED.into()
                },
                input_tokens: 0,
                output_tokens: 0,
                failure_reason: None,
                resolution: None,
                recovery_actor: None,
                recovery_approval_id: None,
                reconciliation_actor: None,
                reconciliation_approval_id: None,
            });
            Ok(())
        }

        async fn mark_attempt_dispatched(&self, _: u64, attempt_id: u64) -> Result<()> {
            self.writes.lock().unwrap().push("dispatch".into());
            let mut rows = self.attempts.lock().unwrap();
            let row = rows
                .iter_mut()
                .find(|attempt| attempt.id == attempt_id)
                .context("no attempt")?;
            if row.status != ATTEMPT_ACCEPTED {
                bail!("only an accepted attempt can be dispatched");
            }
            row.status = ATTEMPT_DISPATCHED.into();
            Ok(())
        }

        /// Mirrors the module: a result needs a dispatched attempt, an unknown
        /// outcome reports no usage, and usage stays within the allowance.
        async fn record_attempt_result(&self, _: u64, result: &AttemptResult) -> Result<()> {
            self.writes
                .lock()
                .unwrap()
                .push(format!("result:{}", result.status));
            if self
                .result_failures
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |remaining| {
                    remaining.checked_sub(1)
                })
                .is_ok()
            {
                bail!("scripted result recording failure");
            }
            let reservations = self.reservations.lock().unwrap();
            let mut rows = self.attempts.lock().unwrap();
            let row = rows
                .iter_mut()
                .find(|attempt| attempt.id == result.attempt_id)
                .context("no attempt")?;
            if row.status != ATTEMPT_DISPATCHED {
                bail!("an attempt must be dispatched before its result");
            }
            if result.status == ATTEMPT_OUTCOME_UNKNOWN
                && (result.input_tokens, result.output_tokens) != (0, 0)
            {
                bail!("an unknown outcome cannot report usage");
            }
            let reservation = reservations
                .iter()
                .find(|r| r.id == row.reservation_id)
                .context("no reservation")?;
            if result.input_tokens > reservation.input_token_allowance
                || result.output_tokens > reservation.output_token_allowance
            {
                bail!("recorded usage exceeds reservation allowance");
            }
            row.status = result.status.into();
            row.input_tokens = result.input_tokens;
            row.output_tokens = result.output_tokens;
            row.failure_reason = result.failure_reason.clone();
            Ok(())
        }

        async fn reconcile_attempt(
            &self,
            _: u64,
            attempt_id: u64,
            outcome: ReconciledOutcome,
            input_tokens: u32,
            output_tokens: u32,
            resolution: &str,
            actor_identity: &str,
            approval_id: &str,
        ) -> Result<()> {
            self.writes.lock().unwrap().push("reconcile".into());
            let mut rows = self.attempts.lock().unwrap();
            let row = rows
                .iter_mut()
                .find(|attempt| attempt.id == attempt_id)
                .context("no attempt")?;
            let status = outcome.status();
            if row.status == ATTEMPT_OUTCOME_UNKNOWN {
                row.status = status.into();
                row.input_tokens = input_tokens;
                row.output_tokens = output_tokens;
                row.resolution = Some(resolution.into());
                row.reconciliation_actor = Some(actor_identity.into());
                row.reconciliation_approval_id = Some(approval_id.into());
                self.reconciliations.lock().unwrap().push((
                    attempt_id,
                    resolution.into(),
                    actor_identity.into(),
                    approval_id.into(),
                ));
                return Ok(());
            }
            let replayed_resolution =
                self.reconciliations
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|(id, prior, actor, approval)| {
                        *id == attempt_id
                            && prior == resolution
                            && actor == actor_identity
                            && approval == approval_id
                    });
            if row.status == status
                && row.input_tokens == input_tokens
                && row.output_tokens == output_tokens
                && replayed_resolution
            {
                return Ok(());
            }
            bail!("only an unknown outcome can be reconciled");
        }

        async fn recover_attempt(
            &self,
            _: u64,
            attempt_id: u64,
            action: ProviderRecoveryAction,
            resolution: &str,
            actor_identity: &str,
            approval_id: &str,
        ) -> Result<()> {
            self.writes.lock().unwrap().push("recover".into());
            let mut attempts = self.attempts.lock().unwrap();
            let attempt = attempts
                .iter_mut()
                .find(|row| row.id == attempt_id)
                .context("no attempt")?;
            match (attempt.status.as_str(), action) {
                (ATTEMPT_DISPATCHED, ProviderRecoveryAction::MarkOutcomeUnknown) => {
                    attempt.status = ATTEMPT_OUTCOME_UNKNOWN.into();
                }
                (ATTEMPT_ACCEPTED, ProviderRecoveryAction::AbandonAccepted) => {
                    attempt.status = ATTEMPT_ABANDONED.into();
                    let mut reservations = self.reservations.lock().unwrap();
                    let reservation = reservations
                        .iter_mut()
                        .find(|row| row.id == attempt.reservation_id)
                        .context("no reservation")?;
                    reservation.status = STATUS_RELEASED.into();
                }
                (ATTEMPT_OUTCOME_UNKNOWN, ProviderRecoveryAction::MarkOutcomeUnknown)
                | (ATTEMPT_ABANDONED, ProviderRecoveryAction::AbandonAccepted)
                    if attempt.resolution.as_deref() == Some(resolution)
                        && attempt.recovery_actor.as_deref() == Some(actor_identity)
                        && attempt.recovery_approval_id.as_deref() == Some(approval_id) =>
                {
                    return Ok(())
                }
                _ => bail!("invalid recovery transition"),
            }
            attempt.resolution = Some(resolution.into());
            attempt.recovery_actor = Some(actor_identity.into());
            attempt.recovery_approval_id = Some(approval_id.into());
            Ok(())
        }
    }

    fn admitted<'a>(provider: &'a Provider, ledger: &'a FakeLedger) -> SpendAdmittedLlm<'a> {
        SpendAdmittedLlm::with_clock(provider, ledger, binding(), fixed_clock).unwrap()
    }

    const KEY: &str = "h5:spend:run:42:step:1:attempt:0";

    fn limited_profile(key: &str) -> super::super::model_configuration::ModelProfile {
        let mut profile =
            super::super::model_configuration::ModelProfile::legacy(&sample_agent(32_000));
        profile.reference.key = key.into();
        profile.timeout_ms = 10;
        profile.max_concurrency = 1;
        profile
    }

    #[tokio::test]
    async fn profile_deadline_records_unknown_without_releasing_spend() {
        struct HangingProvider;
        #[async_trait]
        impl LlmCompletion for HangingProvider {
            async fn complete(&self, _: LlmRequest) -> Result<LlmResponse> {
                std::future::pending().await
            }
        }
        let ledger = FakeLedger::configured();
        let provider = HangingProvider;
        let admitted = SpendAdmittedLlm::with_clock(&provider, &ledger, binding(), fixed_clock)
            .unwrap()
            .with_profile_limits(&limited_profile("deadline-test"))
            .unwrap();
        let error = admitted.complete(request()).await.unwrap_err();
        assert!(error.is::<UnresolvedProviderAttempt>());
        assert!(format!("{error:#}").contains("deadline exceeded"));
        assert_eq!(
            ledger.attempts.lock().unwrap()[0].status,
            ATTEMPT_OUTCOME_UNKNOWN
        );
        assert_eq!(
            ledger.reservations.lock().unwrap()[0].status,
            STATUS_RESERVED
        );
        assert!(!ledger.writes().contains(&"settle".to_string()));
    }

    #[tokio::test]
    async fn profile_queue_timeout_has_no_spend_or_provider_effect() {
        let provider = Provider::new(Ok(response(40, 20)));
        let ledger = FakeLedger::configured();
        let profile = limited_profile("queue-test");
        let first = admitted(&provider, &ledger)
            .with_profile_limits(&profile)
            .unwrap();
        let second = admitted(&provider, &ledger)
            .with_profile_limits(&profile)
            .unwrap();
        let semaphore = &first.profile_limits.as_ref().unwrap().0;
        assert!(Arc::ptr_eq(
            semaphore,
            &second.profile_limits.as_ref().unwrap().0
        ));
        let permit = semaphore.acquire().await.unwrap();
        let error = second.complete(request()).await.unwrap_err();
        assert!(error.to_string().contains("before spend admission"));
        assert_eq!(provider.calls(), 0);
        assert!(ledger.writes().is_empty());
        drop(permit);
        second.complete(request()).await.unwrap();
        assert_eq!(provider.calls(), 1);
        assert_eq!(
            ledger.reservations.lock().unwrap()[0].status,
            STATUS_SETTLED
        );
    }

    #[test]
    fn profile_concurrency_does_not_cross_organizations() {
        let provider = Provider::new(Ok(response(40, 20)));
        let ledger = FakeLedger::configured();
        let profile = limited_profile("tenant-limit-test");
        let first = admitted(&provider, &ledger)
            .with_profile_limits(&profile)
            .unwrap();
        let mut other = binding();
        other.organization_id += 1;
        let second = SpendAdmittedLlm::with_clock(&provider, &ledger, other, fixed_clock)
            .unwrap()
            .with_profile_limits(&profile)
            .unwrap();
        assert!(!Arc::ptr_eq(
            &first.profile_limits.unwrap().0,
            &second.profile_limits.unwrap().0
        ));
    }

    #[test]
    fn nonparallel_profile_is_serial_and_immutable_limits_cannot_change() {
        let provider = Provider::new(Ok(response(40, 20)));
        let ledger = FakeLedger::configured();
        let mut profile = limited_profile("immutable-serial-limit");
        profile.max_concurrency = 3;
        profile.supports_parallel_requests = false;
        let first = admitted(&provider, &ledger)
            .with_profile_limits(&profile)
            .unwrap();
        assert_eq!(
            first.profile_limits.as_ref().unwrap().0.available_permits(),
            1
        );
        profile.supports_parallel_requests = true;
        let error = admitted(&provider, &ledger)
            .with_profile_limits(&profile)
            .err()
            .unwrap();
        assert!(error.to_string().contains("immutable profile"));
        assert!(ledger.writes().is_empty());
    }

    #[tokio::test]
    async fn cancellation_retains_dispatch_and_releases_profile_permit_without_redispatch() {
        struct PendingProvider(tokio::sync::Notify);
        #[async_trait]
        impl LlmCompletion for PendingProvider {
            async fn complete(&self, _: LlmRequest) -> Result<LlmResponse> {
                self.0.notify_one();
                std::future::pending().await
            }
        }
        let provider = PendingProvider(tokio::sync::Notify::new());
        let ledger = FakeLedger::configured();
        let mut profile = limited_profile("cancel-profile");
        profile.timeout_ms = 1_000;
        let admitted = SpendAdmittedLlm::with_clock(&provider, &ledger, binding(), fixed_clock)
            .unwrap()
            .with_profile_limits(&profile)
            .unwrap();
        let mut call = Box::pin(admitted.complete(request()));
        tokio::select! {
            _ = provider.0.notified() => {},
            _ = &mut call => panic!("provider completed before cancellation"),
        }
        drop(call);
        assert_eq!(
            admitted
                .profile_limits
                .as_ref()
                .unwrap()
                .0
                .available_permits(),
            1
        );
        assert_eq!(ledger.attempt(KEY).status, ATTEMPT_DISPATCHED);
        assert_eq!(
            ledger.reservations.lock().unwrap()[0].status,
            STATUS_RESERVED
        );
        let recovered = SpendAdmittedLlm::with_clock(&provider, &ledger, binding(), fixed_clock)
            .unwrap()
            .with_profile_limits(&profile)
            .unwrap();
        assert!(recovered
            .complete(request())
            .await
            .unwrap_err()
            .is::<UnresolvedProviderAttempt>());
        assert_eq!(ledger.writes(), vec!["reserve", "accept", "dispatch"]);
    }

    #[tokio::test]
    async fn exhausted_budget_window_is_a_typed_denial_before_anything_is_reserved() {
        let provider = Provider::new(Ok(response(10, 5)));
        let ledger = FakeLedger::configured().with_budget_limit(1);
        let error = admitted(&provider, &ledger)
            .complete(request())
            .await
            .unwrap_err();
        let blocked = error
            .downcast_ref::<BudgetBlocked>()
            .expect("typed budget denial");
        // The fixed clock is 2026-09-13; budgets are per UTC calendar month.
        assert_eq!(
            blocked.window_resets_at,
            Utc.with_ymd_and_hms(2026, 10, 1, 0, 0, 0).unwrap()
        );
        assert!(blocked.required_units > 1);
        assert_eq!(provider.calls(), 0);
        assert!(ledger.writes().is_empty());
    }

    #[tokio::test]
    async fn explicit_rejection_settles_zero_before_allowing_retry() {
        let rejection =
            crate::providers::llm::check_mistral_status(reqwest::StatusCode::TOO_MANY_REQUESTS)
                .unwrap_err();
        let provider = Provider::new(Err(rejection));
        let ledger = FakeLedger::configured();
        let error = admitted(&provider, &ledger)
            .complete(request())
            .await
            .unwrap_err();
        assert!(error
            .downcast_ref::<ProviderRejection>()
            .unwrap()
            .retryable());
        assert_eq!(ledger.attempt(KEY).status, ATTEMPT_FAILED);
        assert_eq!(
            ledger.reservations.lock().unwrap()[0].status,
            STATUS_SETTLED
        );
        assert_eq!(*ledger.settled.lock().unwrap(), vec![(100, 0, 0)]);
        assert_eq!(
            ledger.writes(),
            vec!["reserve", "accept", "dispatch", "result:failed", "settle"]
        );
    }

    #[tokio::test]
    async fn rejection_with_failed_settlement_does_not_authorize_retry() {
        let rejection =
            crate::providers::llm::check_mistral_status(reqwest::StatusCode::TOO_MANY_REQUESTS)
                .unwrap_err();
        let provider = Provider::new(Err(rejection));
        let ledger = FakeLedger::configured();
        ledger.settle_failures.store(1, Ordering::SeqCst);
        let error = admitted(&provider, &ledger)
            .complete(request())
            .await
            .unwrap_err();
        assert!(error.downcast_ref::<ProviderRejection>().is_none());
        assert_eq!(ledger.attempt(KEY).status, ATTEMPT_FAILED);
        assert_eq!(
            ledger.reservations.lock().unwrap()[0].status,
            STATUS_RESERVED
        );
        assert_eq!(provider.calls(), 1);
    }

    #[tokio::test]
    async fn rejection_with_failed_result_recording_does_not_authorize_retry() {
        let rejection =
            crate::providers::llm::check_mistral_status(reqwest::StatusCode::TOO_MANY_REQUESTS)
                .unwrap_err();
        let provider = Provider::new(Err(rejection));
        let ledger = FakeLedger::configured();
        ledger.result_failures.store(1, Ordering::SeqCst);
        let error = admitted(&provider, &ledger)
            .complete(request())
            .await
            .unwrap_err();
        assert!(error.downcast_ref::<ProviderRejection>().is_none());
        assert_eq!(ledger.attempt(KEY).status, ATTEMPT_DISPATCHED);
        assert_eq!(
            ledger.reservations.lock().unwrap()[0].status,
            STATUS_RESERVED
        );
        assert!(ledger.settled.lock().unwrap().is_empty());
        assert_eq!(provider.calls(), 1);
    }

    fn reconciliation(outcome: ReconciledOutcome) -> ProviderAttemptReconciliation {
        ProviderAttemptReconciliation {
            request_key: KEY.into(),
            reservation_id: 100,
            attempt_id: 200,
            outcome,
            input_tokens: 40,
            output_tokens: 20,
            resolution: "confirmed from provider request log".into(),
            actor_identity: "actor:operator-1".into(),
            approval_id: "approval:spend-1".into(),
        }
    }

    #[tokio::test]
    async fn invalid_transport_state_is_rejected_before_reservation_or_dispatch() {
        struct InvalidTransport;
        #[async_trait]
        impl LlmCompletion for InvalidTransport {
            fn validate_request(&self, _: &LlmRequest) -> Result<()> {
                bail!("invalid native replay binding")
            }

            async fn complete(&self, _: LlmRequest) -> Result<LlmResponse> {
                panic!("invalid transport request must never dispatch")
            }
        }
        let ledger = FakeLedger::configured();
        let provider = InvalidTransport;
        let admitted =
            SpendAdmittedLlm::with_clock(&provider, &ledger, binding(), fixed_clock).unwrap();

        let error = admitted.complete(request()).await.unwrap_err();

        assert!(error.to_string().contains("invalid native replay binding"));
        assert!(ledger.writes().is_empty());
        assert!(ledger.reservations.lock().unwrap().is_empty());
        assert!(ledger.attempts.lock().unwrap().is_empty());
    }

    #[test]
    fn native_replay_is_counted_once_and_foreign_binding_cannot_be_estimated() {
        let native = serde_json::json!({
            "role": "assistant",
            "content": [
                {"type": "thinking", "signature": "opaque", "thinking": [
                    {"type": "text", "text": "private provider state"}
                ]},
                {"type": "text", "text": "Visible answer"}
            ]
        });
        let decoded = crate::providers::llm::decode_mistral_response(
            serde_json::json!({
                "model": "resolved-model",
                "choices": [{"finish_reason": "stop", "message": native}]
            }),
            "mistral-small",
        )
        .unwrap();
        let mut req = request();
        let before = prompt_bytes(&req).unwrap();
        req.messages.push(decoded.to_assistant_message());

        assert_eq!(
            prompt_bytes(&req).unwrap(),
            before + native.to_string().len()
        );
        assert!(!format!("{req:?}").contains("private provider state"));
        req.model = "different-model".into();
        assert!(prompt_bytes(&req).is_err());
        req.model = "mistral-small".into();
        req.provider = "gemini".into();
        assert!(prompt_bytes(&req).is_err());
    }

    #[tokio::test]
    async fn reserves_accepts_and_claims_dispatch_before_settling_actual_usage() {
        let provider = Provider::new(Ok(response(40, 20)));
        let ledger = FakeLedger::configured();
        admitted(&provider, &ledger)
            .complete(request())
            .await
            .unwrap();
        assert_eq!(provider.calls(), 1);
        let rows = ledger.reservations.lock().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].request_key, KEY);
        assert_eq!(rows[0].status, STATUS_SETTLED);
        assert_eq!(rows[0].output_token_allowance, 256);
        assert_eq!(*ledger.settled.lock().unwrap(), vec![(100, 40, 20)]);

        let attempt = ledger.attempt(KEY);
        assert_eq!(attempt.reservation_id, rows[0].id);
        assert_eq!(attempt.status, ATTEMPT_SUCCEEDED);
        assert_eq!((attempt.input_tokens, attempt.output_tokens), (40, 20));
        // The attempt is the provider truth, so it is durable before dispatch
        // and recorded before spend is settled.
        assert_eq!(
            ledger.writes(),
            vec![
                "reserve",
                "accept",
                "dispatch",
                &format!("result:{ATTEMPT_SUCCEEDED}"),
                "settle"
            ]
        );
    }

    #[tokio::test]
    async fn bounded_fallback_calls_receive_distinct_attempts_in_one_causal_scope() {
        let mut starved = response(40, 256);
        starved.text.clear();
        starved.termination = CompletionTermination::Length;
        starved.provider_done_reason = Some("length".into());
        starved.thinking_observed = true;
        let provider = Provider::sequence(vec![Ok(starved), Ok(response(40, 20))]);
        let ledger = FakeLedger::configured();
        let admitted =
            SpendAdmittedLlm::with_clock_and_scope(&provider, &ledger, binding(), fixed_clock, 17)
                .unwrap();

        admitted.complete(request()).await.unwrap();
        let mut fallback = request();
        fallback.thinking = ThinkingMode::Disabled;
        admitted.complete(fallback).await.unwrap();

        assert_eq!(provider.calls(), 2);
        let reservations = ledger.reservations.lock().unwrap();
        assert_eq!(reservations.len(), 2);
        assert_eq!(
            reservations[0].request_key,
            "h5:spend:run:42:step:1700001:attempt:0"
        );
        assert_eq!(
            reservations[1].request_key,
            "h5:spend:run:42:step:1700002:attempt:0"
        );
        assert!(reservations.iter().all(|row| row.status == STATUS_SETTLED));
        let attempts = ledger.attempts.lock().unwrap();
        assert_eq!(attempts.len(), 2);
        assert_eq!(attempts[0].status, ATTEMPT_FAILED);
        assert_eq!(
            attempts[0].failure_reason.as_deref(),
            Some("completion_termination=length; thinking_observed=true; content_present=false")
        );
        assert_eq!(attempts[1].status, ATTEMPT_SUCCEEDED);
        assert!(attempts[1].failure_reason.is_none());
        assert_eq!(
            ledger.writes(),
            vec![
                "reserve",
                "accept",
                "dispatch",
                &format!("result:{ATTEMPT_FAILED}"),
                "settle",
                "reserve",
                "accept",
                "dispatch",
                &format!("result:{ATTEMPT_SUCCEEDED}"),
                "settle",
            ]
        );
    }

    #[test]
    fn definite_completion_failures_are_safe_and_distinct() {
        let mut empty = response(40, 0);
        empty.text.clear();
        empty.termination = CompletionTermination::Unknown;
        empty.provider_done_reason = Some("vendor_empty".into());
        assert_eq!(
            definite_completion_failure(&empty).as_deref(),
            Some("completion_termination=unknown; content_present=false")
        );

        let mut malformed = response(40, 20);
        malformed.text.clear();
        malformed.tool_calls = vec![crate::providers::llm::ToolCallRequest {
            id: None,
            name: "submit".into(),
            arguments: serde_json::Value::Null,
            arguments_error: Some("SECRET provider output".into()),
        }];
        assert_eq!(
            definite_completion_failure(&malformed).as_deref(),
            Some("completion_termination=malformed_structured_output")
        );
        assert!(!definite_completion_failure(&malformed)
            .unwrap()
            .contains("SECRET"));
    }

    #[tokio::test]
    async fn provider_failure_records_an_unknown_outcome_and_leaves_spend_reserved() {
        let provider = Provider::new(Err(anyhow!("timeout")));
        let ledger = FakeLedger::configured();
        let err = admitted(&provider, &ledger)
            .complete(request())
            .await
            .unwrap_err();
        assert!(err.to_string().contains("left for reconciliation"));
        let rows = ledger.reservations.lock().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].status, STATUS_RESERVED);
        assert!(ledger.settled.lock().unwrap().is_empty());

        let attempt = ledger.attempt(KEY);
        assert_eq!(attempt.status, ATTEMPT_OUTCOME_UNKNOWN);
        assert_eq!((attempt.input_tokens, attempt.output_tokens), (0, 0));
        assert_eq!(
            ledger.writes(),
            vec![
                "reserve",
                "accept",
                "dispatch",
                &format!("result:{ATTEMPT_OUTCOME_UNKNOWN}")
            ]
        );
    }

    #[tokio::test]
    async fn unknown_outcome_is_reconciled_then_settled_without_redispatch() {
        let provider = Provider::new(Err(anyhow!("timeout")));
        let ledger = FakeLedger::configured();
        admitted(&provider, &ledger)
            .complete(request())
            .await
            .unwrap_err();

        reconcile_provider_spend(
            &ledger,
            &binding(),
            &reconciliation(ReconciledOutcome::Succeeded),
        )
        .await
        .unwrap();

        assert_eq!(provider.calls(), 1, "reconciliation must not redispatch");
        assert_eq!(ledger.attempt(KEY).status, ATTEMPT_SUCCEEDED);
        assert_eq!(
            ledger.reservations.lock().unwrap()[0].status,
            STATUS_SETTLED
        );
        assert_eq!(*ledger.settled.lock().unwrap(), vec![(100, 40, 20)]);
        assert_eq!(
            &ledger.writes()[4..],
            &["reconcile".to_string(), "settle".to_string()]
        );
    }

    #[tokio::test]
    async fn exact_reconciliation_replay_finishes_a_failed_settlement() {
        let provider = Provider::new(Err(anyhow!("lost response")));
        let ledger = FakeLedger::configured();
        admitted(&provider, &ledger)
            .complete(request())
            .await
            .unwrap_err();
        ledger.settle_failures.store(1, Ordering::SeqCst);
        let recovery = reconciliation(ReconciledOutcome::Failed);

        let first = reconcile_provider_spend(&ledger, &binding(), &recovery)
            .await
            .unwrap_err();
        assert!(first.to_string().contains("settlement remains incomplete"));
        assert_eq!(ledger.attempt(KEY).status, ATTEMPT_FAILED);
        assert_eq!(
            ledger.reservations.lock().unwrap()[0].status,
            STATUS_RESERVED
        );

        reconcile_provider_spend(&ledger, &binding(), &recovery)
            .await
            .unwrap();
        assert_eq!(provider.calls(), 1, "recovery replay must not redispatch");
        assert_eq!(
            ledger.reservations.lock().unwrap()[0].status,
            STATUS_SETTLED
        );
        assert_eq!(ledger.reconciliations.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn exact_replay_accepts_a_committed_settlement_with_lost_response() {
        let provider = Provider::new(Err(anyhow!("lost provider response")));
        let ledger = FakeLedger::configured();
        admitted(&provider, &ledger)
            .complete(request())
            .await
            .unwrap_err();
        ledger.settle_response_losses.store(1, Ordering::SeqCst);
        let recovery = reconciliation(ReconciledOutcome::Succeeded);

        assert!(reconcile_provider_spend(&ledger, &binding(), &recovery)
            .await
            .is_err());
        assert_eq!(
            ledger.reservations.lock().unwrap()[0].status,
            STATUS_SETTLED
        );
        reconcile_provider_spend(&ledger, &binding(), &recovery)
            .await
            .unwrap();

        assert_eq!(provider.calls(), 1);
        assert_eq!(ledger.settled.lock().unwrap().len(), 1);
        assert_eq!(ledger.reconciliations.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn conflicting_reconciler_cannot_rewrite_committed_attribution() {
        let provider = Provider::new(Err(anyhow!("timeout")));
        let ledger = FakeLedger::configured();
        admitted(&provider, &ledger)
            .complete(request())
            .await
            .unwrap_err();
        ledger.settle_failures.store(1, Ordering::SeqCst);
        let first = reconciliation(ReconciledOutcome::Succeeded);
        assert!(reconcile_provider_spend(&ledger, &binding(), &first)
            .await
            .is_err());

        let mut conflicting = first;
        conflicting.approval_id = "approval:conflicting".into();
        let error = reconcile_provider_spend(&ledger, &binding(), &conflicting)
            .await
            .unwrap_err();
        assert!(error.to_string().contains("only an unknown outcome"));
        assert_eq!(
            ledger.attempt(KEY).reconciliation_approval_id.as_deref(),
            Some("approval:spend-1")
        );
        assert_eq!(ledger.settled.lock().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn reconciliation_rejects_wrong_identity_then_recovers_dispatched_without_redispatch() {
        let provider = Provider::new(Err(anyhow!("timeout")));
        let ledger = FakeLedger::configured();
        admitted(&provider, &ledger)
            .complete(request())
            .await
            .unwrap_err();
        let writes_before = ledger.writes();

        let mut wrong_id = reconciliation(ReconciledOutcome::Succeeded);
        wrong_id.attempt_id = 999;
        let error = reconcile_provider_spend(&ledger, &binding(), &wrong_id)
            .await
            .unwrap_err();
        assert!(error.to_string().contains("trusted binding"));
        assert_eq!(ledger.writes(), writes_before);

        ledger.attempts.lock().unwrap()[0].status = ATTEMPT_DISPATCHED.into();
        reconcile_provider_spend(
            &ledger,
            &binding(),
            &reconciliation(ReconciledOutcome::Succeeded),
        )
        .await
        .unwrap();
        assert_eq!(ledger.attempt(KEY).status, ATTEMPT_SUCCEEDED);
        assert!(ledger.writes().iter().any(|write| write == "recover"));
        assert_eq!(provider.calls(), 1);
    }

    #[tokio::test]
    async fn accepted_attempt_is_abandoned_and_released_never_resumed() {
        let provider = Provider::new(Err(anyhow!("timeout")));
        let ledger = FakeLedger::configured();
        admitted(&provider, &ledger)
            .complete(request())
            .await
            .unwrap_err();
        ledger.attempts.lock().unwrap()[0].status = ATTEMPT_ACCEPTED.into();

        abandon_accepted_provider_spend(
            &ledger,
            &binding(),
            &AcceptedAttemptAbandonment {
                request_key: KEY.into(),
                reservation_id: 100,
                attempt_id: 200,
                resolution: "dispatch claim was never committed".into(),
                actor_identity: "actor:operator-1".into(),
                approval_id: "approval:abandon-1".into(),
            },
        )
        .await
        .unwrap();

        assert_eq!(provider.calls(), 1);
        assert_eq!(ledger.attempt(KEY).status, ATTEMPT_ABANDONED);
        assert_eq!(
            ledger.reservations.lock().unwrap()[0].status,
            STATUS_RELEASED
        );
        assert!(ledger.settled.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn an_attempt_recovered_as_dispatched_is_not_redispatched() {
        let provider = Provider::new(Ok(response(1, 1)));
        let ledger = FakeLedger {
            accepts_as_dispatched: true,
            ..FakeLedger::configured()
        };
        let err = admitted(&provider, &ledger)
            .complete(request())
            .await
            .unwrap_err();
        assert!(err.to_string().contains("not redispatching"));
        assert_eq!(provider.calls(), 0);
        assert_eq!(ledger.attempt(KEY).status, ATTEMPT_DISPATCHED);
        assert_eq!(ledger.writes(), vec!["reserve", "accept"]);
    }

    #[tokio::test]
    async fn a_key_bound_to_another_attempt_never_dispatches() {
        let provider = Provider::new(Ok(response(1, 1)));
        let ledger = FakeLedger::configured();
        ledger.attempts.lock().unwrap().push(ProviderAttempt {
            id: 7,
            company_id: 3,
            agent_id: 7,
            reservation_id: 999,
            request_key: KEY.into(),
            provider: "mistral".into(),
            model: "mistral-small".into(),
            status: ATTEMPT_SUCCEEDED.into(),
            input_tokens: 1,
            output_tokens: 1,
            failure_reason: None,
            resolution: None,
            recovery_actor: None,
            recovery_approval_id: None,
            reconciliation_actor: None,
            reconciliation_approval_id: None,
        });
        let err = admitted(&provider, &ledger)
            .complete(request())
            .await
            .unwrap_err();
        assert!(err.to_string().contains("different provider attempt"));
        assert_eq!(provider.calls(), 0);
        assert!(ledger.settled.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn missing_budget_or_snapshot_never_dispatches() {
        for ledger in [
            FakeLedger {
                has_snapshot: true,
                ..FakeLedger::default()
            },
            FakeLedger {
                has_budget: true,
                ..FakeLedger::default()
            },
        ] {
            let provider = Provider::new(Ok(response(1, 1)));
            assert!(admitted(&provider, &ledger)
                .complete(request())
                .await
                .is_err());
            assert_eq!(provider.calls(), 0);
            assert!(ledger.reservations.lock().unwrap().is_empty());
        }
    }

    #[tokio::test]
    async fn existing_reservation_for_attempt_blocks_redispatch() {
        let provider = Provider::new(Ok(response(1, 1)));
        let ledger = FakeLedger::configured();
        ledger.reservations.lock().unwrap().push(Reservation {
            id: 5,
            company_id: 3,
            agent_id: 7,
            request_key: "h5:spend:run:42:step:1:attempt:0".into(),
            provider: "mistral".into(),
            model: "mistral-small".into(),
            price_snapshot_id: 11,
            reserved_units: 1,
            input_token_allowance: 1,
            output_token_allowance: 1,
            status: STATUS_RESERVED.into(),
            settled_input_tokens: 0,
            settled_output_tokens: 0,
        });
        let err = admitted(&provider, &ledger)
            .complete(request())
            .await
            .unwrap_err();
        assert!(err.to_string().contains("not redispatching"));
        assert_eq!(provider.calls(), 0);
    }

    #[tokio::test]
    async fn usage_over_allowance_is_neither_recorded_nor_settled() {
        let provider = Provider::new(Ok(response(40, 999)));
        let ledger = FakeLedger::configured();
        let err = admitted(&provider, &ledger)
            .complete(request())
            .await
            .unwrap_err();
        assert!(err.to_string().contains("reconciliation"));
        assert_eq!(
            ledger.reservations.lock().unwrap()[0].status,
            STATUS_RESERVED
        );
        assert_eq!(ledger.attempt(KEY).status, ATTEMPT_DISPATCHED);
        assert!(ledger.settled.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn mismatched_provider_request_and_zero_run_are_rejected() {
        let provider = Provider::new(Ok(response(1, 1)));
        let ledger = FakeLedger::configured();
        let mut other = request();
        other.model = "mistral-large".into();
        assert!(admitted(&provider, &ledger).complete(other).await.is_err());
        assert_eq!(provider.calls(), 0);
        let zero_run = SpendBinding {
            run_id: 0,
            ..binding()
        };
        assert!(SpendAdmittedLlm::with_clock(&provider, &ledger, zero_run, fixed_clock).is_err());
    }

    #[test]
    fn prompt_bytes_counts_every_part_sent_to_the_provider() {
        let mut req = request();
        assert_eq!(
            prompt_bytes(&req).unwrap(),
            "system".len() + "user".len() + "hello".len()
        );
        req.messages.push(LlmMessage::ToolResult {
            tool_call_id: Some("c1".into()),
            name: "lookup".into(),
            content: "rows".into(),
        });
        assert_eq!(
            prompt_bytes(&req).unwrap(),
            "system".len() + "userhello".len() + "c1lookuprows".len()
        );
    }

    fn sample_agent(context_window: u32) -> crate::ai_agent::ResolvedAgentConfig {
        crate::ai_agent::ResolvedAgentConfig {
            agent_id: 5,
            provider: "mistral".into(),
            model: "mistral-small".into(),
            system_prompt: "sys".into(),
            temperature: 0.7,
            max_tokens: 512,
            context_window,
            top_p: 1.0,
            allowed_actions: vec!["skill_run".into()],
            allowed_models: vec![],
            monthly_budget: None,
            monthly_spend: 0.0,
            cost_per_1k_tokens: 0.0,
            rate_limit_per_minute: 0,
            ollama_supports_tool_calling: false,
        }
    }

    #[test]
    fn spend_binding_from_agent_builds_correct_binding() {
        let agent = sample_agent(32_000);
        let b = spend_binding_from_agent(&agent, 9, 3, 42).unwrap();
        assert_eq!(b.organization_id, 9);
        assert_eq!(b.company_id, 3);
        assert_eq!(b.agent_id, 5);
        assert_eq!(b.run_id, 42);
        assert_eq!(b.provider, "mistral");
        assert_eq!(b.model, "mistral-small");
        assert_eq!(b.agent_max_tokens, 512);
        assert_eq!(b.context_window, 32_000);
    }

    #[test]
    fn spend_binding_from_agent_rejects_zero_fields() {
        let agent = sample_agent(32_000);
        assert!(
            spend_binding_from_agent(&agent, 0, 3, 1).is_err(),
            "zero org"
        );
        assert!(
            spend_binding_from_agent(&agent, 9, 0, 1).is_err(),
            "zero company"
        );
        let no_window = sample_agent(0);
        assert!(
            spend_binding_from_agent(&no_window, 9, 3, 1).is_err(),
            "zero context_window"
        );
    }

    #[test]
    fn spend_binding_from_agent_allows_zero_run_id_at_construction() {
        // run_id == 0 is permitted here; SpendAdmittedLlm::new rejects it.
        let agent = sample_agent(8_000);
        let b = spend_binding_from_agent(&agent, 9, 3, 0).unwrap();
        assert_eq!(b.run_id, 0);
    }

    #[tokio::test]
    async fn restart_after_ambiguous_timeout_never_redispatches() {
        let timed_out_provider = Provider::new(Err(anyhow!("provider timeout")));
        let ledger = FakeLedger::configured();

        let first = admitted(&timed_out_provider, &ledger)
            .complete(request())
            .await
            .unwrap_err();
        assert!(first.to_string().contains("left for reconciliation"));
        assert_eq!(timed_out_provider.calls(), 1);
        assert_eq!(ledger.attempt(KEY).status, ATTEMPT_OUTCOME_UNKNOWN);
        assert_eq!(
            ledger.reservations.lock().unwrap()[0].status,
            STATUS_RESERVED
        );
        assert!(ledger.settled.lock().unwrap().is_empty());

        // A restarted gateway reconstructs the same run-scoped first-call key.
        // The retained reservation is reconciliation state, never authority to
        // issue the provider request again.
        let restarted_provider = Provider::new(Ok(response(1, 1)));
        let restarted = admitted(&restarted_provider, &ledger)
            .complete(request())
            .await
            .unwrap_err();

        assert!(restarted.to_string().contains("not redispatching"));
        assert_eq!(restarted_provider.calls(), 0);
        assert_eq!(ledger.attempt(KEY).status, ATTEMPT_OUTCOME_UNKNOWN);
        assert_eq!(
            ledger.reservations.lock().unwrap()[0].status,
            STATUS_RESERVED
        );
        assert!(ledger.settled.lock().unwrap().is_empty());
    }
}
