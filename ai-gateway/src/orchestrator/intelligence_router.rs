//! Provider-neutral intelligence routing and zero-authority shadow evaluation.
//!
//! A shadow receives the exact same immutable decision request as production.
//! Its response is captured for evaluation only and can never alter the
//! production return value or invoke a capability.

use anyhow::Result;
use futures::future::join_all;

use super::intelligence::{DecisionProvider, DecisionRequest, DecisionResponse};

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
