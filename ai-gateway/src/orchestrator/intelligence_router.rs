//! Provider-neutral intelligence routing and zero-authority shadow evaluation.
//!
//! A shadow receives the exact same immutable decision request as production.
//! Its response is captured for evaluation only and can never alter the
//! production return value or invoke a capability.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex, OnceLock, Weak,
    },
    time::Duration,
};

use anyhow::{bail, Context, Result};
use futures::future::join_all;
use serde_json::json;
use stdb_client::{ReducerCall, StdbClient};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use super::{
    answer_gate::{DecisionClaimCoverageChecker, SourcePassage},
    governed_program::{
        run_generation_only_program, GovernedProgramContext, GovernedProgramOutcome,
        StdbIntelligenceEventRecorder, StdbProgramCheckpointStore,
    },
    governed_programs::governed_program_for_skill,
    intelligence::{
        decision_request_hash, DecisionProvider, DecisionRequest, DecisionResponse,
        DecisionTypeRef, GenerationProvider, GenerationRequest, GenerationResponse,
        ReasoningOutcome, ReasoningProvider, ReasoningRequest,
    },
    intelligence_adapters::{AgentLoopReasoner, LlmDecisionAdapter, LlmGenerationAdapter},
    model_configuration::{
        IntelligenceRole, IntelligenceRoute, IntelligenceRouteResolver, ModelProfile,
    },
    spend_admission::{spend_binding_for_profile, SpendAdmittedLlm, SpendLedger},
    text_answer_gate::{gate_text_answer_with_passages_and_reviews, GatedTextAnswer, TextEvidence},
};
use crate::{
    ai_agent::ResolvedAgentConfig,
    orchestrator::skill_loader::GovernedRunRef,
    providers::llm::{LlmCompletion, LlmRequest, LlmResponse, ProviderRejection},
};

type ProfileLimitKey = (u64, String, u32, String, String);
type ProfileLimitPool = HashMap<ProfileLimitKey, (u32, Weak<Semaphore>)>;
static PROFILE_LIMITS: OnceLock<Mutex<ProfileLimitPool>> = OnceLock::new();
const MAX_SAFE_RETRIES: u32 = 2;

/// The permit is acquired before spend admission. The deadline wraps provider
/// I/O only, so its error returns through the normal durable outcome recorder.
pub(super) struct ProfiledLlm<'a> {
    inner: &'a dyn LlmCompletion,
    timeout: Duration,
    _permit: OwnedSemaphorePermit,
}

impl<'a> ProfiledLlm<'a> {
    pub(super) async fn acquire(
        inner: &'a dyn LlmCompletion,
        organization_id: u64,
        profile: &ModelProfile,
    ) -> Result<Self> {
        if organization_id == 0
            || profile.timeout_ms == 0
            || profile.max_concurrency == 0
            || profile.max_concurrency as usize > Semaphore::MAX_PERMITS
        {
            bail!("model profile requires organization, positive timeout and concurrency limits");
        }
        let limit = if profile.supports_parallel_requests {
            profile.max_concurrency
        } else {
            1
        };
        let key = (
            organization_id,
            profile.reference.key.clone(),
            profile.reference.version,
            profile.provider.clone(),
            profile.model.clone(),
        );
        let semaphore = {
            let mut pool = PROFILE_LIMITS
                .get_or_init(|| Mutex::new(HashMap::new()))
                .lock()
                .map_err(|_| anyhow::anyhow!("model profile concurrency registry unavailable"))?;
            pool.retain(|_, (_, semaphore)| semaphore.strong_count() != 0);
            match pool
                .get(&key)
                .and_then(|(prior, weak)| weak.upgrade().map(|value| (*prior, value)))
            {
                Some((prior, semaphore)) => {
                    anyhow::ensure!(
                        prior == limit,
                        "immutable model profile concurrency limit changed"
                    );
                    semaphore
                }
                None => {
                    let semaphore = Arc::new(Semaphore::new(limit as usize));
                    pool.insert(key, (limit, Arc::downgrade(&semaphore)));
                    semaphore
                }
            }
        };
        let timeout = Duration::from_millis(u64::from(profile.timeout_ms));
        let permit = tokio::time::timeout(timeout, semaphore.acquire_owned())
            .await
            .context("model profile concurrency wait timed out before spend admission")?
            .context("model profile concurrency limiter is closed")?;
        Ok(Self {
            inner,
            timeout,
            _permit: permit,
        })
    }
}

#[async_trait::async_trait]
impl LlmCompletion for ProfiledLlm<'_> {
    fn validate_request(&self, request: &LlmRequest) -> Result<()> {
        self.inner.validate_request(request)
    }

    async fn complete(&self, request: LlmRequest) -> Result<LlmResponse> {
        tokio::time::timeout(self.timeout, self.inner.complete(request))
            .await
            .context("provider deadline exceeded; dispatched outcome is unknown")?
    }
}

pub(super) async fn record_retryable_failure(
    profile: &ModelProfile,
    attempt_no: u32,
    error: anyhow::Error,
    failures: &mut Vec<String>,
) -> Result<()> {
    // Only an explicit rate rejection survives spend result+settlement as this
    // typed cause. Unknown transport/cancellation/ledger errors stop all routes.
    if !error
        .downcast_ref::<ProviderRejection>()
        .is_some_and(ProviderRejection::retryable)
    {
        return Err(error.context("automatic provider retry and fallback stopped"));
    }
    failures.push(format!(
        "{} attempt {}: {}",
        profile.reference.stable_ref(),
        attempt_no + 1,
        error
    ));
    if attempt_no < profile.max_retries.min(MAX_SAFE_RETRIES) {
        tokio::time::sleep(Duration::from_millis(100_u64 << attempt_no)).await;
    }
    Ok(())
}

/// Durable sink for GP-15 zero-authority shadow decision attempts. A shadow
/// result is recorded regardless of success/failure but never fed back into
/// the production decision — see `record_ai_decision_shadow_event` in
/// `spacetimedb/src/ai/decision_events.rs`.
#[async_trait::async_trait]
pub(super) trait ShadowDecisionRecorder: Send + Sync {
    #[allow(clippy::too_many_arguments)]
    async fn record(
        &self,
        organization_id: u64,
        company_id: u64,
        run_id: u64,
        shadow_profile_ref: &str,
        decision_type: &DecisionTypeRef,
        request_hash: &str,
        request_json: &str,
        attempt: Result<&DecisionResponse, &str>,
    ) -> Result<()>;
}

pub(super) struct NoopShadowDecisionRecorder;

#[async_trait::async_trait]
impl ShadowDecisionRecorder for NoopShadowDecisionRecorder {
    async fn record(
        &self,
        _organization_id: u64,
        _company_id: u64,
        _run_id: u64,
        _shadow_profile_ref: &str,
        _decision_type: &DecisionTypeRef,
        _request_hash: &str,
        _request_json: &str,
        _attempt: Result<&DecisionResponse, &str>,
    ) -> Result<()> {
        Ok(())
    }
}

pub(super) struct StdbShadowDecisionRecorder<'a> {
    pub writer: &'a StdbClient,
}

#[async_trait::async_trait]
impl ShadowDecisionRecorder for StdbShadowDecisionRecorder<'_> {
    async fn record(
        &self,
        organization_id: u64,
        company_id: u64,
        run_id: u64,
        shadow_profile_ref: &str,
        decision_type: &DecisionTypeRef,
        request_hash: &str,
        request_json: &str,
        attempt: Result<&DecisionResponse, &str>,
    ) -> Result<()> {
        let params = match attempt {
            Ok(response) => json!({
                "shadow_profile_ref": shadow_profile_ref,
                "decision_type_name": decision_type.name,
                "decision_type_version": decision_type.version,
                "request_hash": request_hash,
                "request_json": request_json,
                "outcome_kind": decision_kind_label(response.kind),
                "output_json": serde_json::to_string(response)?,
                "confidence": response.confidence,
                "provider": response.provider,
                "model": response.model,
                "input_tokens": response.input_tokens,
                "output_tokens": response.output_tokens,
                "shadow_error": null,
            }),
            Err(error) => json!({
                "shadow_profile_ref": shadow_profile_ref,
                "decision_type_name": decision_type.name,
                "decision_type_version": decision_type.version,
                "request_hash": request_hash,
                "request_json": request_json,
                "outcome_kind": null,
                "output_json": null,
                "confidence": null,
                "provider": "",
                "model": "",
                "input_tokens": 0,
                "output_tokens": 0,
                "shadow_error": error,
            }),
        };
        self.writer
            .call_reducer(ReducerCall::from_name(
                "record_ai_decision_shadow_event",
                json!([organization_id, company_id, run_id, params]),
            ))
            .await
            .context("record durable shadow decision event")
    }
}

fn decision_kind_label(kind: super::intelligence::DecisionKind) -> &'static str {
    match kind {
        super::intelligence::DecisionKind::Choice => "choice",
        super::intelligence::DecisionKind::Score => "score",
        super::intelligence::DecisionKind::Probability => "probability",
    }
}

/// The only model/profile selection surface intended for governed runtime code.
pub(super) struct ConfiguredIntelligenceRouter<'a> {
    resolver: IntelligenceRouteResolver<'a>,
}

impl<'a> ConfiguredIntelligenceRouter<'a> {
    pub fn new(resolver: IntelligenceRouteResolver<'a>) -> Self {
        Self { resolver }
    }

    pub async fn route(
        &self,
        role: IntelligenceRole,
        decision_type: Option<&str>,
    ) -> Result<IntelligenceRoute> {
        self.resolver.resolve(role, decision_type).await
    }
}

/// Execute one typed generation request through the durable routed provider.
/// Retained for legacy skill summaries that do not yet have a catalogued graph.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn generate_routed_for_run(
    store: &super::model_configuration::StdbModelConfigurationStore<'_>,
    ledger: &dyn SpendLedger,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    agent: &ResolvedAgentConfig,
    policy_ref: Option<&str>,
    transport: &dyn LlmCompletion,
    request: GenerationRequest,
) -> Result<GenerationResponse> {
    if run_id == 0 {
        bail!("durable run_id is required for routed generation");
    }
    let resolver = IntelligenceRouteResolver::new(store, organization_id, agent, policy_ref)?;
    let router = ConfiguredIntelligenceRouter::new(resolver);
    RoutedGenerationProvider::new(
        &router,
        transport,
        ledger,
        agent,
        organization_id,
        company_id,
        run_id,
    )
    .generate(request)
    .await
}

/// Execute one catalogued generation surface through the normal routed
/// generation provider and common GovernedProgramExecutor.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_catalogued_generation_surface(
    store: &super::model_configuration::StdbModelConfigurationStore<'_>,
    ledger: &dyn SpendLedger,
    writer: &stdb_client::StdbClient,
    reader: &stdb_client::StdbClient,
    organization_id: u64,
    company_id: u64,
    run: &GovernedRunRef,
    agent: &ResolvedAgentConfig,
    transport: &dyn LlmCompletion,
    skill_key: &str,
    objective: String,
    bounded_state: serde_json::Value,
    generation_instructions: Option<String>,
    generation_max_tokens: Option<u32>,
) -> Result<GovernedProgramOutcome> {
    let catalog = governed_program_for_skill(skill_key).with_context(|| {
        format!("skill '{skill_key}' is not registered in governed program catalog")
    })?;
    if run.program_ref.as_deref() != Some(catalog.program_ref) {
        bail!(
            "run program identity mismatch for '{skill_key}': expected {}, got {:?}",
            catalog.program_ref,
            run.program_ref
        );
    }
    let resolver = IntelligenceRouteResolver::new(
        store,
        organization_id,
        agent,
        run.intelligence_policy_ref.as_deref(),
    )?;
    let router = ConfiguredIntelligenceRouter::new(resolver);
    let generation = RoutedGenerationProvider::new(
        &router,
        transport,
        ledger,
        agent,
        organization_id,
        company_id,
        run.run_id,
    );
    let checkpoint_store = StdbProgramCheckpointStore { writer, reader };
    let recorder = StdbIntelligenceEventRecorder { writer, reader };
    let context = GovernedProgramContext {
        organization_id,
        company_id,
        run_id: run.run_id,
        program_ref: catalog.program_ref.to_string(),
        objective,
        bounded_state,
        evidence: Vec::new(),
        generation_instructions,
        generation_max_tokens,
    };
    run_generation_only_program(
        &catalog.graph,
        &context,
        &generation,
        Some(&checkpoint_store),
        &recorder,
    )
    .await
}

/// Judge one RAG candidate against the passages its actor is authorized to
/// see. Passage-backed claims are checked for semantic support by a
/// review-role model routed and spend-admitted like every other model call in
/// the run. If that model cannot be routed or fails, the claim stays
/// unchecked and the answer requires review — it is never admitted.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn gate_rag_answer_with_review(
    store: &super::model_configuration::StdbModelConfigurationStore<'_>,
    ledger: &dyn SpendLedger,
    organization_id: u64,
    company_id: u64,
    run: &GovernedRunRef,
    agent: &ResolvedAgentConfig,
    transport: &dyn LlmCompletion,
    candidate: &str,
    evidence: &TextEvidence,
    passages: &[SourcePassage],
    reviewed_claims: Option<&dyn super::reviewed_claims::ReviewedClaimResolver>,
) -> Result<GatedTextAnswer> {
    let resolver = IntelligenceRouteResolver::new(
        store,
        organization_id,
        agent,
        run.intelligence_policy_ref.as_deref(),
    )?;
    let router = ConfiguredIntelligenceRouter::new(resolver);
    let reviewer = RoutedDecisionProvider::new(
        &router,
        transport,
        ledger,
        agent,
        organization_id,
        company_id,
        run.run_id,
        IntelligenceRole::Review,
        &NoopShadowDecisionRecorder,
    )?;
    let checker = DecisionClaimCoverageChecker {
        reviewer: &reviewer,
    };
    gate_text_answer_with_passages_and_reviews(
        organization_id,
        company_id,
        candidate,
        evidence,
        passages,
        Some(&checker),
        reviewed_claims,
    )
    .await
}

fn role_scope(role: IntelligenceRole) -> u32 {
    match role {
        IntelligenceRole::Decision => 1,
        IntelligenceRole::Reasoning => 2,
        IntelligenceRole::Generation => 3,
        IntelligenceRole::Review => 4,
        IntelligenceRole::Shadow => 5,
    }
}

fn next_call_scope(role: IntelligenceRole, counter: &AtomicU32) -> Result<u32> {
    let call = counter.fetch_add(1, Ordering::SeqCst);
    if call >= 1_000 {
        bail!("intelligence role call scope exhausted");
    }
    Ok(role_scope(role) * 1_000 + call)
}

pub(super) struct RoutedDecisionProvider<'a> {
    router: &'a ConfiguredIntelligenceRouter<'a>,
    transport: &'a dyn LlmCompletion,
    ledger: &'a dyn SpendLedger,
    agent: &'a ResolvedAgentConfig,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    role: IntelligenceRole,
    shadow_recorder: &'a dyn ShadowDecisionRecorder,
    next_scope: AtomicU32,
}

impl<'a> RoutedDecisionProvider<'a> {
    pub fn new(
        router: &'a ConfiguredIntelligenceRouter<'a>,
        transport: &'a dyn LlmCompletion,
        ledger: &'a dyn SpendLedger,
        agent: &'a ResolvedAgentConfig,
        organization_id: u64,
        company_id: u64,
        run_id: u64,
        role: IntelligenceRole,
        shadow_recorder: &'a dyn ShadowDecisionRecorder,
    ) -> Result<Self> {
        if !matches!(role, IntelligenceRole::Decision | IntelligenceRole::Review) {
            bail!("RoutedDecisionProvider requires decision or review role");
        }
        Ok(Self {
            router,
            transport,
            ledger,
            agent,
            organization_id,
            company_id,
            run_id,
            role,
            shadow_recorder,
            next_scope: AtomicU32::new(1),
        })
    }

    /// Evaluate every resolved shadow profile against the exact same
    /// request the production decision received. Zero live authority: a
    /// shadow's response or failure is only ever recorded, never returned
    /// to the caller or allowed to influence `decide`'s result.
    async fn run_shadows(&self, shadows: &[ModelProfile], request: &DecisionRequest) {
        if shadows.is_empty() {
            return;
        }
        let Ok(request_hash) = decision_request_hash(request) else {
            return;
        };
        let Ok(request_json) = serde_json::to_string(request) else {
            return;
        };
        let attempts = shadows.iter().map(|profile| {
            let request_hash = request_hash.clone();
            let request_json = request_json.clone();
            async move {
                let result = match next_call_scope(IntelligenceRole::Shadow, &self.next_scope) {
                    Ok(scope) => self.attempt(profile, request.clone(), scope).await,
                    Err(error) => Err(error),
                };
                let record_result = match &result {
                    Ok(response) => {
                        self.shadow_recorder
                            .record(
                                self.organization_id,
                                self.company_id,
                                self.run_id,
                                &profile.reference.stable_ref(),
                                &request.decision_type,
                                &request_hash,
                                &request_json,
                                Ok(response),
                            )
                            .await
                    }
                    Err(error) => {
                        self.shadow_recorder
                            .record(
                                self.organization_id,
                                self.company_id,
                                self.run_id,
                                &profile.reference.stable_ref(),
                                &request.decision_type,
                                &request_hash,
                                &request_json,
                                Err(error.to_string().as_str()),
                            )
                            .await
                    }
                };
                if let Err(error) = record_result {
                    tracing::warn!("failed to record shadow decision event: {error:#}");
                }
            }
        });
        join_all(attempts).await;
    }

    async fn attempt(
        &self,
        profile: &ModelProfile,
        request: DecisionRequest,
        call_scope: u32,
    ) -> Result<DecisionResponse> {
        let binding = spend_binding_for_profile(
            self.agent,
            profile,
            self.organization_id,
            self.company_id,
            self.run_id,
        )?;
        let transport = ProfiledLlm::acquire(self.transport, self.organization_id, profile).await?;
        let admitted = SpendAdmittedLlm::new_scoped(&transport, self.ledger, binding, call_scope)?;
        LlmDecisionAdapter::from_profile(&admitted, profile)
            .decide(request)
            .await
    }
}

#[async_trait::async_trait]
impl DecisionProvider for RoutedDecisionProvider<'_> {
    async fn decide(&self, request: DecisionRequest) -> Result<DecisionResponse> {
        let route = self
            .router
            .route(self.role, Some(&request.decision_type.name))
            .await?;
        let shadows = route.shadows;
        let mut profiles = Vec::with_capacity(1 + route.fallbacks.len());
        profiles.push(route.primary);
        profiles.extend(route.fallbacks);

        let mut failures = Vec::new();
        for profile in profiles {
            for attempt_no in 0..=profile.max_retries.min(MAX_SAFE_RETRIES) {
                let scope = next_call_scope(self.role, &self.next_scope)?;
                match self.attempt(&profile, request.clone(), scope).await {
                    Ok(response) => {
                        self.run_shadows(&shadows, &request).await;
                        return Ok(response);
                    }
                    Err(error) => {
                        record_retryable_failure(&profile, attempt_no, error, &mut failures).await?
                    }
                }
            }
        }
        bail!(
            "all configured '{}' model profiles failed: {}",
            self.role.label(),
            failures.join(" | ")
        )
    }
}

pub(super) struct RoutedReasoningProvider<'a> {
    router: &'a ConfiguredIntelligenceRouter<'a>,
    transport: &'a dyn LlmCompletion,
    ledger: &'a dyn SpendLedger,
    agent: &'a ResolvedAgentConfig,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    next_scope: AtomicU32,
}

impl<'a> RoutedReasoningProvider<'a> {
    pub fn new(
        router: &'a ConfiguredIntelligenceRouter<'a>,
        transport: &'a dyn LlmCompletion,
        ledger: &'a dyn SpendLedger,
        agent: &'a ResolvedAgentConfig,
        organization_id: u64,
        company_id: u64,
        run_id: u64,
    ) -> Self {
        Self {
            router,
            transport,
            ledger,
            agent,
            organization_id,
            company_id,
            run_id,
            next_scope: AtomicU32::new(1),
        }
    }
}

#[async_trait::async_trait]
impl ReasoningProvider for RoutedReasoningProvider<'_> {
    async fn reason(&self, request: ReasoningRequest) -> Result<ReasoningOutcome> {
        let route = self.router.route(IntelligenceRole::Reasoning, None).await?;
        let mut profiles = Vec::with_capacity(1 + route.fallbacks.len());
        profiles.push(route.primary);
        profiles.extend(route.fallbacks);
        let mut failures = Vec::new();
        for profile in profiles {
            for attempt_no in 0..=profile.max_retries.min(MAX_SAFE_RETRIES) {
                let binding = spend_binding_for_profile(
                    self.agent,
                    &profile,
                    self.organization_id,
                    self.company_id,
                    self.run_id,
                )?;
                let scope = next_call_scope(IntelligenceRole::Reasoning, &self.next_scope)?;
                // The profile is the model ceiling; the agent remains the
                // shared budget owner. Build the request with their minimum
                // before any spend reservation or provider dispatch.
                let mut effective_profile = profile.clone();
                effective_profile.max_tokens = binding.agent_max_tokens;
                let transport =
                    ProfiledLlm::acquire(self.transport, self.organization_id, &profile).await?;
                let admitted =
                    SpendAdmittedLlm::new_scoped(&transport, self.ledger, binding, scope)?;
                match AgentLoopReasoner::from_profile(&admitted, &effective_profile)
                    .reason(request.clone())
                    .await
                {
                    Ok(response) => return Ok(response),
                    Err(error) => {
                        record_retryable_failure(&profile, attempt_no, error, &mut failures).await?
                    }
                }
            }
        }
        bail!(
            "all configured reasoning profiles failed: {}",
            failures.join(" | ")
        )
    }
}

pub(super) struct RoutedGenerationProvider<'a> {
    router: &'a ConfiguredIntelligenceRouter<'a>,
    transport: &'a dyn LlmCompletion,
    ledger: &'a dyn SpendLedger,
    agent: &'a ResolvedAgentConfig,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    next_scope: AtomicU32,
}

impl<'a> RoutedGenerationProvider<'a> {
    pub fn new(
        router: &'a ConfiguredIntelligenceRouter<'a>,
        transport: &'a dyn LlmCompletion,
        ledger: &'a dyn SpendLedger,
        agent: &'a ResolvedAgentConfig,
        organization_id: u64,
        company_id: u64,
        run_id: u64,
    ) -> Self {
        Self {
            router,
            transport,
            ledger,
            agent,
            organization_id,
            company_id,
            run_id,
            next_scope: AtomicU32::new(1),
        }
    }
}

#[async_trait::async_trait]
impl GenerationProvider for RoutedGenerationProvider<'_> {
    async fn generate(&self, request: GenerationRequest) -> Result<GenerationResponse> {
        let route = self
            .router
            .route(IntelligenceRole::Generation, None)
            .await?;
        let mut profiles = Vec::with_capacity(1 + route.fallbacks.len());
        profiles.push(route.primary);
        profiles.extend(route.fallbacks);
        let mut failures = Vec::new();
        for profile in profiles {
            for attempt_no in 0..=profile.max_retries.min(MAX_SAFE_RETRIES) {
                let binding = spend_binding_for_profile(
                    self.agent,
                    &profile,
                    self.organization_id,
                    self.company_id,
                    self.run_id,
                )?;
                let scope = next_call_scope(IntelligenceRole::Generation, &self.next_scope)?;
                let transport =
                    ProfiledLlm::acquire(self.transport, self.organization_id, &profile).await?;
                let admitted =
                    SpendAdmittedLlm::new_scoped(&transport, self.ledger, binding, scope)?;
                match LlmGenerationAdapter::from_profile(&admitted, &profile)
                    .generate(request.clone())
                    .await
                {
                    Ok(response) => return Ok(response),
                    Err(error) => {
                        record_retryable_failure(&profile, attempt_no, error, &mut failures).await?
                    }
                }
            }
        }
        bail!(
            "all configured generation profiles failed: {}",
            failures.join(" | ")
        )
    }
}

pub(super) struct ShadowDecisionProvider<'a> {
    pub profile: String,
    pub provider: &'a dyn DecisionProvider,
}

#[derive(Clone, Debug)]
pub(super) struct ShadowDecisionResult {
    pub profile: String,
    pub response: Option<DecisionResponse>,
    pub error: Option<String>,
}

pub(super) struct IntelligenceRouter<'a> {
    primary: &'a dyn DecisionProvider,
    shadows: Vec<ShadowDecisionProvider<'a>>,
}

impl<'a> IntelligenceRouter<'a> {
    pub fn new(primary: &'a dyn DecisionProvider) -> Self {
        Self {
            primary,
            shadows: Vec::new(),
        }
    }

    pub fn with_shadow(
        mut self,
        profile: impl Into<String>,
        provider: &'a dyn DecisionProvider,
    ) -> Self {
        self.shadows.push(ShadowDecisionProvider {
            profile: profile.into(),
            provider,
        });
        self
    }

    pub async fn decide(
        &self,
        request: DecisionRequest,
    ) -> Result<(DecisionResponse, Vec<ShadowDecisionResult>)> {
        request.validate()?;
        let primary_request = request.clone();
        let shadow_futures = self.shadows.iter().map(|shadow| {
            let request = request.clone();
            async move {
                match shadow.provider.decide(request).await {
                    Ok(response) => ShadowDecisionResult {
                        profile: shadow.profile.clone(),
                        response: Some(response),
                        error: None,
                    },
                    Err(error) => ShadowDecisionResult {
                        profile: shadow.profile.clone(),
                        response: None,
                        error: Some(error.to_string()),
                    },
                }
            }
        });
        let (primary, shadows) = tokio::join!(
            self.primary.decide(primary_request),
            join_all(shadow_futures)
        );
        let primary = primary?;
        primary.validate_against(&request)?;
        // Shadow failures deliberately do not fail or change production.
        Ok((primary, shadows))
    }
}

#[cfg(test)]
mod tests {
    use super::super::intelligence::{DecisionKind, DecisionTypeRef};
    use super::super::model_configuration::ModelProfileRef;
    use super::*;
    use anyhow::{bail, Result};
    use async_trait::async_trait;
    use serde_json::json;

    fn limit_profile(key: &str) -> ModelProfile {
        ModelProfile {
            reference: ModelProfileRef {
                key: key.into(),
                version: 1,
            },
            provider: "mistral".into(),
            model: "mistral-small".into(),
            allowed_roles: vec![IntelligenceRole::Generation],
            temperature: None,
            top_p: None,
            max_tokens: 256,
            context_window: 32_000,
            timeout_ms: 20,
            max_retries: 1,
            max_concurrency: 1,
            supports_tool_calling: true,
            supports_structured_output: true,
            supports_parallel_requests: true,
            input_cost_per_1k_microunits: None,
            output_cost_per_1k_microunits: None,
            per_request_cost_ceiling_microunits: None,
        }
    }

    struct PendingTransport;

    #[async_trait]
    impl LlmCompletion for PendingTransport {
        async fn complete(&self, _: LlmRequest) -> Result<LlmResponse> {
            std::future::pending().await
        }
    }

    #[tokio::test]
    async fn profile_limits_are_shared_across_routes_and_release_on_drop() {
        let profile = limit_profile("shared-routes");
        let first = ProfiledLlm::acquire(&PendingTransport, 10, &profile)
            .await
            .unwrap();
        // A second independently constructed route shares this profile's permit.
        let second = ProfiledLlm::acquire(&PendingTransport, 10, &profile).await;
        assert!(second
            .err()
            .unwrap()
            .to_string()
            .contains("before spend admission"));
        // Another organization does not consume this organization's permits.
        let other = ProfiledLlm::acquire(&PendingTransport, 11, &profile)
            .await
            .unwrap();
        drop(first);
        let resumed = ProfiledLlm::acquire(&PendingTransport, 10, &profile)
            .await
            .unwrap();
        drop((other, resumed));
    }

    #[tokio::test]
    async fn zero_timeout_and_changed_concurrency_fail_closed() {
        let mut profile = limit_profile("immutable-limit");
        profile.timeout_ms = 0;
        assert!(ProfiledLlm::acquire(&PendingTransport, 12, &profile)
            .await
            .is_err());
        profile.timeout_ms = 20;
        let first = ProfiledLlm::acquire(&PendingTransport, 12, &profile)
            .await
            .unwrap();
        profile.max_concurrency = 2;
        assert!(ProfiledLlm::acquire(&PendingTransport, 12, &profile)
            .await
            .is_err());
        drop(first);
    }

    #[tokio::test]
    async fn only_explicit_rate_rejections_allow_bounded_retry_and_backoff() {
        let profile = limit_profile("retry-rate");
        let mut failures = Vec::new();
        let start = std::time::Instant::now();
        let rate =
            crate::providers::llm::check_mistral_status(reqwest::StatusCode::TOO_MANY_REQUESTS)
                .unwrap_err();
        record_retryable_failure(&profile, 0, rate, &mut failures)
            .await
            .unwrap();
        assert!(start.elapsed() >= Duration::from_millis(100));
        assert_eq!(failures.len(), 1);
        for error in [
            anyhow::anyhow!("provider deadline exceeded"),
            anyhow::anyhow!("settlement failed"),
            crate::providers::llm::check_mistral_status(reqwest::StatusCode::SERVICE_UNAVAILABLE)
                .unwrap_err(),
        ] {
            assert!(record_retryable_failure(&profile, 0, error, &mut failures)
                .await
                .is_err());
        }
        assert_eq!(failures.len(), 1);
    }

    struct Fixed(&'static str);
    struct Broken;

    #[async_trait]
    impl DecisionProvider for Fixed {
        async fn decide(&self, _request: DecisionRequest) -> Result<DecisionResponse> {
            Ok(DecisionResponse {
                kind: DecisionKind::Choice,
                choice: Some(self.0.to_string()),
                score: None,
                probability: None,
                confidence: Some(0.8),
                rationale: None,
                model: "m".to_string(),
                provider: "p".to_string(),
                input_tokens: 1,
                output_tokens: 1,
            })
        }
    }

    #[async_trait]
    impl DecisionProvider for Broken {
        async fn decide(&self, _request: DecisionRequest) -> Result<DecisionResponse> {
            bail!("shadow unavailable")
        }
    }

    fn request() -> DecisionRequest {
        DecisionRequest {
            decision_type: DecisionTypeRef {
                name: "Test".to_string(),
                version: 1,
            },
            kind: DecisionKind::Choice,
            question: "pick".to_string(),
            bounded_state: json!({}),
            candidates: vec!["a".to_string(), "b".to_string()],
            precedent: Vec::new(),
            evidence: Vec::new(),
        }
    }

    #[tokio::test]
    async fn shadow_failure_never_changes_primary_result() {
        let router = IntelligenceRouter::new(&Fixed("a")).with_shadow("candidate", &Broken);
        let (primary, shadows) = router.decide(request()).await.unwrap();
        assert_eq!(primary.choice.as_deref(), Some("a"));
        assert_eq!(shadows.len(), 1);
        assert!(shadows[0].response.is_none());
        assert!(shadows[0].error.is_some());
    }
}
