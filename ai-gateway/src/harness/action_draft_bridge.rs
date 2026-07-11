//! Action-draft bridge for harness-controlled red skills.
//!
//! Red skills are never executed directly. When a promoted red skill's manifest
//! permits only `NamedRead` and `ActionDraft` capabilities, the policy engine
//! returns `DecisionOutcome::DraftOnly` and this bridge produces a structured
//! `ActionDraftProposal`. A downstream caller (BFF or gateway route) persists the
//! proposal as an `AiActionDraft` row via the `create_ai_action_draft` reducer,
//! where it enters the normal human approval flow.

use serde_json::Value;

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
    let reducer_name = tool_call.tool_name.clone();

    let company_id = request.execution.company_id;
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
        manifest::{ExecutionLimits, RiskClass, SkillManifest, SkillVersionRef},
        policy_engine::{
            ExecutionMetadata, ExecutionPlan, PlannedToolCall, PolicyExecutionRequest,
        },
        skill_registry::SkillRegistry,
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
}
