//! Provider-neutral intelligence routing and zero-authority shadow evaluation.
//!
//! A shadow receives the exact same immutable decision request as production.
//! Its response is captured for evaluation only and can never alter the
//! production return value or invoke a capability.

use std::sync::atomic::{AtomicU32, Ordering};

use anyhow::{bail, Result};
use futures::future::join_all;

use super::{
    intelligence::{
        DecisionProvider, DecisionRequest, DecisionResponse, GenerationProvider,
        GenerationRequest, GenerationResponse, ReasoningOutcome, ReasoningProvider,
        ReasoningRequest,
    },
    intelligence_adapters::{AgentLoopReasoner, LlmDecisionAdapter, LlmGenerationAdapter},
    model_configuration::{
        IntelligenceRole, IntelligenceRoute, IntelligenceRouteResolver, ModelProfile,
    },
    spend_admission::{spend_binding_for_profile, SpendAdmittedLlm, SpendLedger},
};
use crate::{ai_agent::ResolvedAgentConfig, providers::llm::LlmCompletion};

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
            next_scope: AtomicU32::new(1),
        })
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
        let mut profiles = Vec::with_capacity(1 + route.fallbacks.len());
        profiles.push(route.primary);
        profiles.extend(route.fallbacks);

        let mut failures = Vec::new();
        for profile in profiles {
            let scope = next_call_scope(self.role, &self.next_scope)?;
            match self.attempt(&profile, request.clone(), scope).await {
                Ok(response) => return Ok(response),
                Err(error) => failures.push(format!(
                    "{}: {}",
                    profile.reference.stable_ref(),
                    error
                )),
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
                    "{}: {}",
                    profile.reference.stable_ref(),
                    error
                )),
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
                    "{}: {}",
                    profile.reference.stable_ref(),
                    error
                )),
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
