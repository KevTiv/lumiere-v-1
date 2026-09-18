//! Provider-neutral intelligence routing and zero-authority shadow evaluation.
//!
//! A shadow receives the exact same immutable decision request as production.
//! Its response is captured for evaluation only and can never alter the
//! production return value or invoke a capability.

use std::sync::atomic::{AtomicU32, Ordering};

use anyhow::{bail, Context, Result};
use futures::future::join_all;
use serde_json::json;
use stdb_client::{ReducerCall, StdbClient};

use super::{
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
};
use crate::{ai_agent::ResolvedAgentConfig, providers::llm::LlmCompletion};

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
        let admitted =
            SpendAdmittedLlm::new_scoped(self.transport, self.ledger, binding, call_scope)?;
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
            for attempt_no in 0..=profile.max_retries {
                let scope = next_call_scope(self.role, &self.next_scope)?;
                match self.attempt(&profile, request.clone(), scope).await {
                    Ok(response) => {
                        self.run_shadows(&shadows, &request).await;
                        return Ok(response);
                    }
                    Err(error) => failures.push(format!(
                        "{} attempt {}: {}",
                        profile.reference.stable_ref(),
                        attempt_no + 1,
                        error
                    )),
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
        let route = self
            .router
            .route(IntelligenceRole::Reasoning, None)
            .await?;
        let mut profiles = Vec::with_capacity(1 + route.fallbacks.len());
        profiles.push(route.primary);
        profiles.extend(route.fallbacks);
        let mut failures = Vec::new();
        for profile in profiles {
            for attempt_no in 0..=profile.max_retries {
                let binding = spend_binding_for_profile(
                    self.agent,
                    &profile,
                    self.organization_id,
                    self.company_id,
                    self.run_id,
                )?;
                let scope = next_call_scope(IntelligenceRole::Reasoning, &self.next_scope)?;
                let admitted =
                    SpendAdmittedLlm::new_scoped(self.transport, self.ledger, binding, scope)?;
                match AgentLoopReasoner::from_profile(&admitted, &profile)
                    .reason(request.clone())
                    .await
                {
                    Ok(response) => return Ok(response),
                    Err(error) => failures.push(format!(
                        "{} attempt {}: {}",
                        profile.reference.stable_ref(),
                        attempt_no + 1,
                        error
                    )),
                }
            }
        }
        bail!("all configured reasoning profiles failed: {}", failures.join(" | "))
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
            for attempt_no in 0..=profile.max_retries {
                let binding = spend_binding_for_profile(
                    self.agent,
                    &profile,
                    self.organization_id,
                    self.company_id,
                    self.run_id,
                )?;
                let scope = next_call_scope(IntelligenceRole::Generation, &self.next_scope)?;
                let admitted =
                    SpendAdmittedLlm::new_scoped(self.transport, self.ledger, binding, scope)?;
                match LlmGenerationAdapter::from_profile(&admitted, &profile)
                    .generate(request.clone())
                    .await
                {
                    Ok(response) => return Ok(response),
                    Err(error) => failures.push(format!(
                        "{} attempt {}: {}",
                        profile.reference.stable_ref(),
                        attempt_no + 1,
                        error
                    )),
                }
            }
        }
        bail!("all configured generation profiles failed: {}", failures.join(" | "))
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
    use super::*;
    use anyhow::{bail, Result};
    use async_trait::async_trait;
    use serde_json::json;
    use super::super::intelligence::{DecisionKind, DecisionTypeRef};

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
