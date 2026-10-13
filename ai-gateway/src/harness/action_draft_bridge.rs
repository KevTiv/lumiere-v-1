//! Action-draft bridge for harness-controlled red skills.
//!
//! Red skills are never executed directly. When a promoted red skill's manifest
//! permits only `NamedRead` and `ActionDraft` capabilities, the policy engine
//! returns `DecisionOutcome::DraftOnly` and this bridge produces a structured
//! `ActionDraftProposal`. The canonical persistence path is the existing
//! `create_ai_run_action_draft` request mapping, where it enters the normal
//! human approval flow with exact run/request identity.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{
    audit::ActionDraftProposal,
    manifest::Capability,
    policy_engine::{PlannedToolCall, PolicyControlledRequest},
};

#[derive(Clone, Debug, thiserror::Error)]
pub enum BridgeError {
    #[error("no action-draft tool call in approved plan")]
    MissingActionDraft,
    #[error("multiple action-draft tool calls are not supported in Phase 1")]
    MultipleActionDrafts,
    #[error("invalid input: {0}")]
    InvalidInput(String),
}

#[derive(Clone, Debug, thiserror::Error)]
pub enum ActionDraftResumeError {
    #[error("action-draft scope does not match the pending request")]
    ScopeMismatch,
    #[error("action-draft request does not match the pending request")]
    RequestMismatch,
    #[error("action-draft id does not match the pending request")]
    DraftMismatch,
}

/// Exact durable identity for one action-draft request.
///
/// This is deliberately a tenant/run/request identity, rather than a draft
/// status query. Callers persist through the existing
/// `create_ai_run_action_draft` request mapping and resolve the resulting row
/// with all four fields. In particular, a caller cannot use this type to ask
/// for the "latest" draft.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionDraftRequestIdentity {
    pub organization_id: u64,
    pub company_id: u64,
    pub run_id: u64,
    pub request_id: String,
}

impl ActionDraftRequestIdentity {
    pub fn new(
        organization_id: u64,
        company_id: u64,
        run_id: u64,
        request_id: impl Into<String>,
    ) -> Result<Self, BridgeError> {
        let identity = Self {
            organization_id,
            company_id,
            run_id,
            request_id: request_id.into().trim().to_string(),
        };
        identity.validate()?;
        Ok(identity)
    }

    /// Bind a policy-controlled request to a durable run.
    pub fn from_request(
        request: &PolicyControlledRequest,
        run_id: u64,
    ) -> Result<Self, BridgeError> {
        Self::new(
            request.execution.organization_id,
            request.execution.company_id,
            run_id,
            &request.execution.correlation_id,
        )
    }

    fn validate(&self) -> Result<(), BridgeError> {
        if self.organization_id == 0 || self.company_id == 0 || self.run_id == 0 {
            return Err(BridgeError::InvalidInput(
                "action draft requires nonzero organization, company, and run ids".to_string(),
            ));
        }
        if self.request_id.is_empty() {
            return Err(BridgeError::InvalidInput(
                "action draft requires a request correlation id".to_string(),
            ));
        }
        Ok(())
    }

    /// Build the existing H5 request-map key from the complete immutable
    /// identity and proposal. Replays of the same request return the same key;
    /// changing tenant, run, request, or proposal cannot alias it.
    pub fn request_key(&self, proposal: &ActionDraftProposal) -> Result<String, BridgeError> {
        let payload = serde_json::to_value(proposal)
            .map_err(|error| BridgeError::InvalidInput(error.to_string()))?;
        self.request_key_for_payload(&payload)
    }

    /// Build the same key for an already-typed canonical-executor payload.
    /// This keeps the bridge on the existing request-map protocol without
    /// forcing other executors to invent an `ActionDraftProposal` wrapper.
    pub fn request_key_for_payload(&self, payload: &Value) -> Result<String, BridgeError> {
        self.validate()?;
        crate::ai_spend::input_request_key(
            crate::ai_spend::RequestKind::Draft,
            self.run_id,
            &json!({
                "organization_id": self.organization_id,
                "company_id": self.company_id,
                "request_id": self.request_id,
                "payload": payload,
            }),
        )
        .map_err(|error| BridgeError::InvalidInput(error.to_string()))
    }
}

/// Durable checkpoint returned when the canonical executor must stop for
/// human approval. It contains enough information to perform one exact
/// request-map lookup after a restart.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionDraftWait {
    pub identity: ActionDraftRequestIdentity,
    pub request_key: String,
    pub draft_id: u64,
}

impl ActionDraftWait {
    /// Construct a wait checkpoint using the bridge's canonical request key.
    pub fn for_proposal(
        identity: ActionDraftRequestIdentity,
        proposal: &ActionDraftProposal,
        draft_id: u64,
    ) -> Result<Self, BridgeError> {
        let request_key = identity.request_key(proposal)?;
        Self::new(identity, request_key, draft_id)
    }

    /// Construct a wait checkpoint for a canonical-executor payload while
    /// retaining the same exact H5 request identity.
    pub fn for_payload(
        identity: ActionDraftRequestIdentity,
        payload: &Value,
        draft_id: u64,
    ) -> Result<Self, BridgeError> {
        let request_key = identity.request_key_for_payload(payload)?;
        Self::new(identity, request_key, draft_id)
    }

    fn new(
        identity: ActionDraftRequestIdentity,
        request_key: String,
        draft_id: u64,
    ) -> Result<Self, BridgeError> {
        identity.validate()?;
        crate::ai_spend::validate_request_key(&request_key)
            .map_err(|error| BridgeError::InvalidInput(error.to_string()))?;
        if draft_id == 0 {
            return Err(BridgeError::InvalidInput(
                "action draft wait requires a nonzero draft id".to_string(),
            ));
        }
        Ok(Self {
            identity,
            request_key,
            draft_id,
        })
    }

    /// Check exact read-back identity before interpreting approval state.
    /// This rejects stale checkpoints, cross-company replay, and a different
    /// draft returned for the same run instead of silently resuming it.
    pub fn resume(
        &self,
        current_identity: &ActionDraftRequestIdentity,
        observed: ActionDraftObservation,
    ) -> Result<ActionDraftControlOutcome, ActionDraftResumeError> {
        if current_identity.organization_id != self.identity.organization_id
            || current_identity.company_id != self.identity.company_id
            || current_identity.run_id != self.identity.run_id
        {
            return Err(ActionDraftResumeError::ScopeMismatch);
        }
        if current_identity.request_id != self.identity.request_id {
            return Err(ActionDraftResumeError::RequestMismatch);
        }
        if observed.organization_id != self.identity.organization_id
            || observed.company_id != self.identity.company_id
            || observed.run_id != self.identity.run_id
        {
            return Err(ActionDraftResumeError::ScopeMismatch);
        }
        if observed.request_key != self.request_key {
            return Err(ActionDraftResumeError::RequestMismatch);
        }
        if observed.draft_id != self.draft_id {
            return Err(ActionDraftResumeError::DraftMismatch);
        }

        Ok(match observed.resolution {
            ActionDraftResolution::Pending => {
                ActionDraftControlOutcome::Wait { wait: self.clone() }
            }
            resolution => ActionDraftControlOutcome::Resume {
                wait: self.clone(),
                resolution,
            },
        })
    }
}

/// Approval result read for the exact request-map row.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum ActionDraftResolution {
    Pending,
    Approved { execution_record_id: Option<u64> },
    Rejected { reason: String },
}

/// Exact durable observation supplied by the existing action-draft store.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionDraftObservation {
    pub organization_id: u64,
    pub company_id: u64,
    pub run_id: u64,
    pub request_key: String,
    pub draft_id: u64,
    pub resolution: ActionDraftResolution,
}

/// Typed control-flow result for the canonical executor.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum ActionDraftControlOutcome {
    Wait {
        wait: ActionDraftWait,
    },
    Resume {
        wait: ActionDraftWait,
        resolution: ActionDraftResolution,
    },
}

/// Build a deterministic action-draft proposal from an approved red request.
///
/// Phase 1 supports a single action-draft tool call per request. The reducer
/// name is taken from the tool call; params are built from the request input
/// plus the company scope from the execution metadata.
pub fn build_proposal(
    request: &PolicyControlledRequest,
) -> Result<ActionDraftProposal, BridgeError> {
    let action_calls: Vec<&PlannedToolCall> = request
        .execution
        .plan
        .tool_calls
        .iter()
        .filter(|call| call.capability == Capability::ActionDraft)
        .collect();

    if action_calls.is_empty() {
        return Err(BridgeError::MissingActionDraft);
    }
    if action_calls.len() > 1 {
        return Err(BridgeError::MultipleActionDrafts);
    }

    let tool_call = action_calls[0];
    let reducer_name = tool_call.tool_name.trim().to_string();
    if reducer_name.is_empty() {
        return Err(BridgeError::InvalidInput(
            "action-draft reducer name is required".to_string(),
        ));
    }

    let company_id = request.execution.company_id;
    if request.execution.organization_id == 0 || company_id == 0 {
        return Err(BridgeError::InvalidInput(
            "action draft requires nonzero organization and company ids".to_string(),
        ));
    }
    let mut params = match request.execution.input.as_object() {
        Some(obj) => obj.clone(),
        None => {
            return Err(BridgeError::InvalidInput(
                "red action input must be a JSON object".to_string(),
            ))
        }
    };

    // Ensure the company scope is pinned to the request's company and cannot be
    // overridden by user/model input.
    params.insert("company_id".to_string(), Value::Number(company_id.into()));

    let summary = format!(
        "Proposed {} for company {} via skill {} (correlation {})",
        reducer_name,
        company_id,
        request.execution.skill.skill_key,
        request.execution.correlation_id
    );

    Ok(ActionDraftProposal {
        reducer_name,
        params_json: Value::Object(params).to_string(),
        summary,
        elevated: true,
        warnings: vec![
            "This is a red action draft requiring independent human approval.".to_string(),
        ],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harness::{
        manifest::SkillVersionRef,
        policy_engine::{
            ExecutionMetadata, ExecutionPlan, PlannedToolCall, PolicyExecutionRequest,
        },
    };

    fn red_request() -> PolicyControlledRequest {
        PolicyControlledRequest {
            execution: PolicyExecutionRequest {
                skill: SkillVersionRef::new("red_action", 1),
                organization_id: 7,
                company_id: 8,
                correlation_id: "corr-red-1".to_string(),
                metadata: ExecutionMetadata::default(),
                input: serde_json::json!({"partner_id": 123}),
                plan: ExecutionPlan {
                    named_resources: vec![],
                    tool_calls: vec![PlannedToolCall {
                        tool_name: "create_sale_order".to_string(),
                        capability: Capability::ActionDraft,
                        named_resource: None,
                    }],
                    steps: 1,
                    expected_rows: 0,
                    output_type: "action_draft".to_string(),
                },
            },
            candidate_output: Value::Null,
        }
    }

    #[test]
    fn proposal_pins_company_id_and_preserves_input() {
        let proposal = build_proposal(&red_request()).unwrap();
        assert_eq!(proposal.reducer_name, "create_sale_order");
        assert!(proposal.elevated);
        let params: Value = serde_json::from_str(&proposal.params_json).unwrap();
        assert_eq!(params["company_id"], 8);
        assert_eq!(params["partner_id"], 123);
    }

    #[test]
    fn proposal_requires_action_draft_capability() {
        let mut request = red_request();
        request.execution.plan.tool_calls[0].capability = Capability::ActionExecute;
        assert!(matches!(
            build_proposal(&request),
            Err(BridgeError::MissingActionDraft)
        ));
    }

    #[test]
    fn request_identity_is_run_and_request_correlated_and_idempotent() {
        let request = red_request();
        let proposal = build_proposal(&request).expect("proposal");
        let identity =
            ActionDraftRequestIdentity::from_request(&request, 41).expect("request identity");

        let first = identity.request_key(&proposal).expect("first key");
        let replay = identity.request_key(&proposal).expect("replay key");
        assert_eq!(first, replay);

        let different_run =
            ActionDraftRequestIdentity::from_request(&request, 42).expect("second run identity");
        assert_ne!(
            first,
            different_run
                .request_key(&proposal)
                .expect("second run key")
        );

        let mut different_request = request.clone();
        different_request.execution.correlation_id = "corr-red-2".to_string();
        let different_request = ActionDraftRequestIdentity::from_request(&different_request, 41)
            .expect("second request identity");
        assert_ne!(
            first,
            different_request
                .request_key(&proposal)
                .expect("second request key")
        );
    }

    #[test]
    fn request_identity_isolated_by_organization_and_company() {
        let request = red_request();
        let proposal = build_proposal(&request).expect("proposal");
        let original =
            ActionDraftRequestIdentity::from_request(&request, 41).expect("request identity");

        let mut other_company = request.clone();
        other_company.execution.company_id = 9;
        let other_company = ActionDraftRequestIdentity::from_request(&other_company, 41)
            .expect("other company identity");
        assert_ne!(
            original.request_key(&proposal).expect("original key"),
            other_company
                .request_key(&proposal)
                .expect("other company key")
        );

        let mut other_organization = request;
        other_organization.execution.organization_id = 10;
        let other_organization = ActionDraftRequestIdentity::from_request(&other_organization, 41)
            .expect("other organization identity");
        assert_ne!(
            original.request_key(&proposal).expect("original key"),
            other_organization
                .request_key(&proposal)
                .expect("other organization key")
        );
    }

    fn observed(
        wait: &ActionDraftWait,
        resolution: ActionDraftResolution,
    ) -> ActionDraftObservation {
        ActionDraftObservation {
            organization_id: wait.identity.organization_id,
            company_id: wait.identity.company_id,
            run_id: wait.identity.run_id,
            request_key: wait.request_key.clone(),
            draft_id: wait.draft_id,
            resolution,
        }
    }

    #[test]
    fn exact_pending_draft_waits_and_exact_approval_resumes() {
        let request = red_request();
        let proposal = build_proposal(&request).expect("proposal");
        let identity =
            ActionDraftRequestIdentity::from_request(&request, 41).expect("request identity");
        let wait = ActionDraftWait::for_proposal(identity, &proposal, 73).expect("wait token");

        assert_eq!(
            wait.resume(
                &wait.identity,
                observed(&wait, ActionDraftResolution::Pending)
            )
            .expect("pending outcome"),
            ActionDraftControlOutcome::Wait { wait: wait.clone() }
        );
        assert_eq!(
            wait.resume(
                &wait.identity,
                observed(
                    &wait,
                    ActionDraftResolution::Approved {
                        execution_record_id: Some(91),
                    },
                ),
            )
            .expect("approved outcome"),
            ActionDraftControlOutcome::Resume {
                wait: wait.clone(),
                resolution: ActionDraftResolution::Approved {
                    execution_record_id: Some(91),
                },
            }
        );
    }

    #[test]
    fn resume_rejects_cross_company_stale_request_and_wrong_draft() {
        let request = red_request();
        let proposal = build_proposal(&request).expect("proposal");
        let identity =
            ActionDraftRequestIdentity::from_request(&request, 41).expect("request identity");
        let wait = ActionDraftWait::for_proposal(identity, &proposal, 73).expect("wait token");

        let mut cross_company = wait.identity.clone();
        cross_company.company_id += 1;
        assert!(matches!(
            wait.resume(
                &cross_company,
                observed(&wait, ActionDraftResolution::Pending)
            ),
            Err(ActionDraftResumeError::ScopeMismatch)
        ));

        let mut wrong_run = wait.identity.clone();
        wrong_run.run_id += 1;
        assert!(matches!(
            wait.resume(&wrong_run, observed(&wait, ActionDraftResolution::Pending)),
            Err(ActionDraftResumeError::ScopeMismatch)
        ));

        let mut replayed_request = wait.identity.clone();
        replayed_request.request_id = "corr-red-replay".to_string();
        assert!(matches!(
            wait.resume(
                &replayed_request,
                observed(&wait, ActionDraftResolution::Pending)
            ),
            Err(ActionDraftResumeError::RequestMismatch)
        ));

        let mut cross_company_observation = observed(&wait, ActionDraftResolution::Pending);
        cross_company_observation.company_id += 1;
        assert!(matches!(
            wait.resume(&wait.identity, cross_company_observation),
            Err(ActionDraftResumeError::ScopeMismatch)
        ));

        let mut stale_request = observed(&wait, ActionDraftResolution::Pending);
        stale_request.request_key = stale_request.request_key.replace("input", "stale");
        assert!(matches!(
            wait.resume(&wait.identity, stale_request),
            Err(ActionDraftResumeError::RequestMismatch)
        ));

        let mut wrong_draft = observed(&wait, ActionDraftResolution::Pending);
        wrong_draft.draft_id += 1;
        assert!(matches!(
            wait.resume(&wait.identity, wrong_draft),
            Err(ActionDraftResumeError::DraftMismatch)
        ));
    }

    #[test]
    fn identity_and_wait_reject_missing_durable_ids() {
        let request = red_request();
        assert!(matches!(
            ActionDraftRequestIdentity::from_request(&request, 0),
            Err(BridgeError::InvalidInput(_))
        ));

        let identity =
            ActionDraftRequestIdentity::from_request(&request, 41).expect("request identity");
        let proposal = build_proposal(&request).expect("proposal");
        assert!(matches!(
            ActionDraftWait::for_proposal(identity, &proposal, 0),
            Err(BridgeError::InvalidInput(_))
        ));
    }

    #[test]
    fn serialized_wait_resumes_the_same_exact_request_after_restart() {
        let request = red_request();
        let proposal = build_proposal(&request).expect("proposal");
        let identity =
            ActionDraftRequestIdentity::from_request(&request, 41).expect("request identity");
        let wait = ActionDraftWait::for_proposal(identity, &proposal, 73).expect("wait token");
        let encoded = serde_json::to_string(&wait).expect("serialize wait token");
        let restored: ActionDraftWait =
            serde_json::from_str(&encoded).expect("restore wait token after restart");

        assert_eq!(restored, wait);
        assert!(matches!(
            restored
                .resume(
                    &restored.identity,
                    observed(
                        &restored,
                        ActionDraftResolution::Approved {
                            execution_record_id: Some(91),
                        },
                    ),
                )
                .expect("resume restored token"),
            ActionDraftControlOutcome::Resume {
                resolution: ActionDraftResolution::Approved { .. },
                ..
            }
        ));
    }
}
