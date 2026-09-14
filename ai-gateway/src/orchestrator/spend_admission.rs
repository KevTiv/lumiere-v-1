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
//! - usage above the reserved allowance: the module rejects the result and the
//!   error propagates with the attempt dispatched and the reservation reserved.

use std::sync::atomic::{AtomicU32, Ordering};

use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use stdb_client::StdbClient;

use crate::ai_spend::{
    self, allowance, billing_period, request_key, AcceptAttemptRequest, Allowance, AttemptResult,
    PriceSnapshot, ProviderAttempt, RequestKind, Reservation, ReserveRequest, SpendBudget,
    SpendReader, ATTEMPT_ACCEPTED, STATUS_RESERVED,
};
use crate::providers::llm::{LlmCompletion, LlmMessage, LlmRequest, LlmResponse};

/// Persistence operations needed for admission; implemented over SpacetimeDB
/// in production and in memory for tests.
#[async_trait]
pub(super) trait SpendLedger: Send + Sync {
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
}

/// Writes through the gateway principal; reads through the dedicated
/// `AI_SPEND_READ_STDB_TOKEN` principal.
pub(super) struct StdbSpendLedger<'a> {
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

pub(super) struct SpendAdmittedLlm<'a> {
    inner: &'a dyn LlmCompletion,
    ledger: &'a dyn SpendLedger,
    binding: SpendBinding,
    clock: fn() -> DateTime<Utc>,
    next_call: AtomicU32,
}

impl<'a> SpendAdmittedLlm<'a> {
    pub fn new(
        inner: &'a dyn LlmCompletion,
        ledger: &'a dyn SpendLedger,
        binding: SpendBinding,
    ) -> Result<Self> {
        Self::with_clock(inner, ledger, binding, Utc::now)
    }

    fn with_clock(
        inner: &'a dyn LlmCompletion,
        ledger: &'a dyn SpendLedger,
        binding: SpendBinding,
        clock: fn() -> DateTime<Utc>,
    ) -> Result<Self> {
        if binding.organization_id == 0
            || binding.company_id == 0
            || binding.agent_id == 0
            || binding.run_id == 0
        {
            bail!("spend admission requires organization, company, agent and durable run ids");
        }
        Ok(Self {
            inner,
            ledger,
            binding,
            clock,
            next_call: AtomicU32::new(1),
        })
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
            bail!(
                "spend attempt {key} already has a {} reservation; not redispatching",
                existing.status
            );
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
            prompt_bytes(req),
            req.max_tokens,
            b.agent_max_tokens,
            b.context_window,
        )?;
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
        self.ledger.reserve(&request).await?;
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
            bail!(
                "provider attempt {key} is already {}; not redispatching",
                attempt.status
            );
        }
        Ok(attempt)
    }
}

#[async_trait]
impl LlmCompletion for SpendAdmittedLlm<'_> {
    async fn complete(&self, req: LlmRequest) -> Result<LlmResponse> {
        let organization_id = self.binding.organization_id;
        let call = self.next_call.fetch_add(1, Ordering::SeqCst);
        let key = request_key(RequestKind::Spend, self.binding.run_id, call, 0)?;
        let reservation = self.admit(&req, &key).await?;
        let attempt = self.accept(&reservation, &key).await?;
        self.ledger
            .mark_attempt_dispatched(organization_id, attempt.id)
            .await
            .with_context(|| format!("dispatch was not claimed for {key}; provider not called"))?;
        let response = match self.inner.complete(req).await {
            Ok(response) => response,
            Err(error) => {
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
                    })?;
                return Err(error.context(format!(
                    "provider dispatch failed for {key}; attempt left for reconciliation"
                )));
            }
        };
        self.ledger
            .record_attempt_result(
                organization_id,
                &AttemptResult::succeeded(
                    attempt.id,
                    response.input_tokens,
                    response.output_tokens,
                ),
            )
            .await
            .with_context(|| {
                format!("recording the result of {key} failed; attempt and reservation left for reconciliation")
            })?;
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
            })?;
        Ok(response)
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
fn prompt_bytes(req: &LlmRequest) -> usize {
    let messages: usize = req
        .messages
        .iter()
        .map(|message| match message {
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
        })
        .sum();
    let tools: usize = req
        .tools
        .iter()
        .map(|tool| serde_json::to_string(tool).map_or(0, |json| json.len()))
        .sum();
    req.system.len() + messages + tools
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_spend::{
        ATTEMPT_DISPATCHED, ATTEMPT_OUTCOME_UNKNOWN, ATTEMPT_SUCCEEDED, STATUS_SETTLED,
    };
    use anyhow::anyhow;
    use chrono::TimeZone;
    use std::sync::Mutex;

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
        }
    }

    struct Provider {
        result: Mutex<Option<Result<LlmResponse>>>,
        calls: Mutex<u32>,
    }

    impl Provider {
        fn new(result: Result<LlmResponse>) -> Self {
            Self {
                result: Mutex::new(Some(result)),
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
            self.result
                .lock()
                .unwrap()
                .take()
                .unwrap_or_else(|| Err(anyhow!("provider called twice")))
        }
    }

    #[derive(Default)]
    struct FakeLedger {
        has_budget: bool,
        has_snapshot: bool,
        /// Models a reader that sees an attempt recovered as already dispatched.
        accepts_as_dispatched: bool,
        reservations: Mutex<Vec<Reservation>>,
        attempts: Mutex<Vec<ProviderAttempt>>,
        settled: Mutex<Vec<(u64, u32, u32)>>,
        /// Ledger writes in call order, so tests can assert the sequence.
        writes: Mutex<Vec<String>>,
    }

    impl FakeLedger {
        fn configured() -> Self {
            Self {
                has_budget: true,
                has_snapshot: true,
                ..Self::default()
            }
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

        fn writes(&self) -> Vec<String> {
            self.writes.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl SpendLedger for FakeLedger {
        async fn budget(&self, _: u64, _: u64, period: &str) -> Result<Option<SpendBudget>> {
            assert_eq!(period, "2026-09");
            Ok(self.has_budget.then(|| SpendBudget {
                id: 1,
                currency: "EUR".into(),
                limit_units: 1_000_000,
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
            });
            Ok(())
        }

        async fn settle(&self, _: u64, id: u64, input: u32, output: u32) -> Result<()> {
            self.writes.lock().unwrap().push("settle".into());
            let mut rows = self.reservations.lock().unwrap();
            let row = rows
                .iter_mut()
                .find(|r| r.id == id)
                .context("no reservation")?;
            if input > row.input_token_allowance || output > row.output_token_allowance {
                bail!("actual usage exceeds reservation allowance");
            }
            row.status = STATUS_SETTLED.into();
            self.settled.lock().unwrap().push((id, input, output));
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
            Ok(())
        }
    }

    fn admitted<'a>(provider: &'a Provider, ledger: &'a FakeLedger) -> SpendAdmittedLlm<'a> {
        SpendAdmittedLlm::with_clock(provider, ledger, binding(), fixed_clock).unwrap()
    }

    const KEY: &str = "h5:spend:run:42:step:1:attempt:0";

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
            prompt_bytes(&req),
            "system".len() + "user".len() + "hello".len()
        );
        req.messages.push(LlmMessage::ToolResult {
            tool_call_id: Some("c1".into()),
            name: "lookup".into(),
            content: "rows".into(),
        });
        assert_eq!(
            prompt_bytes(&req),
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
        assert!(spend_binding_from_agent(&agent, 0, 3, 1).is_err(), "zero org");
        assert!(spend_binding_from_agent(&agent, 9, 0, 1).is_err(), "zero company");
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
}
