use anyhow::{bail, Result};
use async_trait::async_trait;
use serde_json::Value;

use crate::{
    harness::{
        audit::{DecisionOutcome, PolicyDecision, PolicyReasonCode},
        manifest::Capability,
        policy_engine::{
            ExecutionPlan, PlannedToolCall, PolicyControlledRequest, PolicyEngine,
            PolicyExecutionRequest,
        },
    },
    providers::llm::ToolCallRequest,
    tools::types::ToolOutput,
};

use super::agent_loop::LoopPolicy;

/// Policy adapter for a reviewed set of tools in an agent invocation.
///
/// The base request supplies only the trusted tenant, skill, correlation and
/// output-contract context. The reviewed descriptors, not the base plan or
/// model arguments, authorize an individual tool call.
#[derive(Clone, Debug)]
pub(super) struct ReviewedInvocationPolicy {
    engine: PolicyEngine,
    base: PolicyExecutionRequest,
    reviewed_calls: Vec<PlannedToolCall>,
}

impl ReviewedInvocationPolicy {
    pub(super) fn new(
        engine: PolicyEngine,
        base: PolicyExecutionRequest,
        reviewed_calls: Vec<PlannedToolCall>,
    ) -> Result<Self> {
        if base.organization_id == 0 || base.company_id == 0 {
            bail!("organization_id and company_id must be nonzero");
        }
        if base.correlation_id.trim().is_empty() {
            bail!("correlation_id must be nonempty");
        }
        if reviewed_calls.is_empty() {
            bail!("reviewed tool calls must be nonempty");
        }
        if base.plan.tool_calls.is_empty() {
            bail!("base plan must contain a reviewed tool call");
        }
        if base
            .plan
            .tool_calls
            .iter()
            .any(|call| call.capability == Capability::ActionExecute)
            || reviewed_calls
                .iter()
                .any(|call| call.capability == Capability::ActionExecute)
        {
            bail!("action-execute capability is not supported by the invocation policy");
        }

        let mut names = std::collections::HashSet::with_capacity(reviewed_calls.len());
        for call in &reviewed_calls {
            if call.tool_name.trim().is_empty() || !names.insert(call.tool_name.clone()) {
                bail!("reviewed tool names must be unique and nonempty");
            }
            if let Some(resource) = &call.named_resource {
                if !base
                    .plan
                    .named_resources
                    .iter()
                    .any(|declared| declared == resource)
                {
                    bail!("reviewed tool resource is absent from the base resource contract");
                }
            }
        }

        // The base plan is context, not authorization. Every descriptor it
        // carries must be explicitly present in the reviewed set; calls are
        // still looked up in `reviewed_calls` below.
        if base
            .plan
            .tool_calls
            .iter()
            .any(|base_call| !reviewed_calls.iter().any(|reviewed| reviewed == base_call))
        {
            bail!("base plan contains a tool call absent from reviewed descriptors");
        }

        Ok(Self {
            engine,
            base,
            reviewed_calls,
        })
    }

    pub(super) fn ensure_context(
        &self,
        organization_id: u64,
        company_id: u64,
        skill_key: &str,
    ) -> Result<()> {
        if organization_id == 0 || company_id == 0 {
            bail!("organization_id and company_id must be nonzero");
        }
        if organization_id != self.base.organization_id
            || company_id != self.base.company_id
            || skill_key != self.base.skill.skill_key
        {
            bail!("invocation context does not match the reviewed policy");
        }
        Ok(())
    }

    pub(super) async fn evaluate(
        &self,
        call: &ToolCallRequest,
        completed_calls: u32,
    ) -> Result<PolicyDecision> {
        let steps = completed_calls
            .checked_add(1)
            .ok_or_else(|| anyhow::anyhow!("cumulative tool-call step count overflow"))?;
        let request = self.request_for_call(call, steps);
        let mut decision = self.engine.evaluate(&request);

        if !self
            .reviewed_calls
            .iter()
            .any(|reviewed| reviewed.tool_name == call.name)
        {
            decision.outcome = DecisionOutcome::Deny;
            if !decision
                .reasons
                .iter()
                .any(|reason| reason.code == PolicyReasonCode::ToolDenied)
            {
                decision
                    .reasons
                    .push(crate::harness::audit::DecisionReason::new(
                        PolicyReasonCode::ToolDenied,
                        format!("tool '{}' is not in the reviewed invocation", call.name),
                    ));
            }
        }

        if has_scope_override(
            &call.arguments,
            self.base.organization_id,
            self.base.company_id,
        ) && decision.outcome != DecisionOutcome::Deny
        {
            decision.outcome = DecisionOutcome::Deny;
            decision
                .reasons
                .push(crate::harness::audit::DecisionReason::new(
                    PolicyReasonCode::InvalidInput,
                    "tool arguments may not override invocation organization or company scope",
                ));
        }

        // PolicyEngine sees one call at a time, so enforce the invocation-wide
        // cap after that one-call evaluation while retaining its audit hashes.
        if decision.outcome != DecisionOutcome::Deny {
            if let Some(limits) = decision.enforced_limits {
                if completed_calls >= limits.max_tool_calls {
                    decision.outcome = DecisionOutcome::Deny;
                    decision
                        .reasons
                        .push(crate::harness::audit::DecisionReason::new(
                            PolicyReasonCode::ToolCallLimitExceeded,
                            format!(
                                "cumulative tool calls {} exceeds limit {}",
                                completed_calls.saturating_add(1),
                                limits.max_tool_calls
                            ),
                        ));
                }
            }
        }
        Ok(decision)
    }

    pub(super) async fn protect_output(
        &self,
        call: &ToolCallRequest,
        completed_calls: u32,
        output: ToolOutput,
    ) -> Result<ToolOutput> {
        let decision = self.evaluate(call, completed_calls).await?;
        if decision.outcome != DecisionOutcome::Allow {
            bail!("tool output rejected by policy: {:?}", decision.reasons);
        }

        let request = self.request_for_call(
            call,
            completed_calls
                .checked_add(1)
                .ok_or_else(|| anyhow::anyhow!("cumulative tool-call step count overflow"))?,
        );
        let result = self.engine.execute_controlled(PolicyControlledRequest {
            execution: request,
            candidate_output: output.data,
        });
        if result.decision.outcome != DecisionOutcome::Allow {
            bail!(
                "tool output rejected by policy: {:?}",
                result.decision.reasons
            );
        }
        let data = result
            .output
            .ok_or_else(|| anyhow::anyhow!("policy returned no protected tool output"))?;
        Ok(ToolOutput {
            summary: "policy-validated tool result".to_string(),
            data,
            citations: Vec::new(),
            row_count: result.privacy.map(|report| report.rows_processed),
        })
    }

    fn request_for_call(&self, call: &ToolCallRequest, steps: u32) -> PolicyExecutionRequest {
        let descriptor = self
            .reviewed_calls
            .iter()
            .find(|reviewed| reviewed.tool_name == call.name)
            .cloned()
            // Deliberately do not infer a capability or resource from model
            // arguments. The engine will produce a real ToolDenied decision.
            .unwrap_or_else(|| PlannedToolCall {
                tool_name: call.name.clone(),
                capability: Capability::NamedRead,
                named_resource: None,
            });
        let named_resources = descriptor.named_resource.clone().into_iter().collect();
        PolicyExecutionRequest {
            skill: self.base.skill.clone(),
            organization_id: self.base.organization_id,
            company_id: self.base.company_id,
            correlation_id: self.base.correlation_id.clone(),
            metadata: self.base.metadata.clone(),
            input: call.arguments.clone(),
            plan: ExecutionPlan {
                named_resources,
                tool_calls: vec![descriptor],
                steps,
                expected_rows: self.base.plan.expected_rows,
                output_type: self.base.plan.output_type.clone(),
            },
        }
    }
}

#[async_trait]
impl LoopPolicy for ReviewedInvocationPolicy {
    async fn evaluate(
        &self,
        call: &ToolCallRequest,
        completed_calls: u32,
    ) -> Result<PolicyDecision> {
        ReviewedInvocationPolicy::evaluate(self, call, completed_calls).await
    }

    async fn protect_output(
        &self,
        call: &ToolCallRequest,
        completed_calls: u32,
        output: ToolOutput,
    ) -> Result<ToolOutput> {
        ReviewedInvocationPolicy::protect_output(self, call, completed_calls, output).await
    }
}

fn has_scope_override(value: &Value, organization_id: u64, company_id: u64) -> bool {
    match value {
        Value::Object(fields) => fields.iter().any(|(key, value)| {
            let normalized = key
                .chars()
                .filter(|character| character.is_ascii_alphanumeric())
                .flat_map(char::to_lowercase)
                .collect::<String>();
            if normalized == "organizationid" {
                return numeric_scope_value(value) != Some(organization_id);
            }
            if normalized == "companyid" {
                return numeric_scope_value(value) != Some(company_id);
            }
            has_scope_override(value, organization_id, company_id)
        }),
        Value::Array(values) => values
            .iter()
            .any(|value| has_scope_override(value, organization_id, company_id)),
        _ => false,
    }
}

fn numeric_scope_value(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harness::{
        low_stock::{LOW_STOCK_OUTPUT_TYPE, LOW_STOCK_RESOURCE, NAMED_READ_TOOL},
        manifest::SkillVersionRef,
    };

    fn base() -> PolicyExecutionRequest {
        PolicyExecutionRequest {
            skill: SkillVersionRef::new("low_stock", 1),
            organization_id: 7,
            company_id: 11,
            correlation_id: "corr-1".to_string(),
            metadata: Default::default(),
            input: serde_json::json!({"threshold": 3.0}),
            plan: ExecutionPlan {
                named_resources: vec![LOW_STOCK_RESOURCE.to_string()],
                tool_calls: vec![PlannedToolCall {
                    tool_name: NAMED_READ_TOOL.to_string(),
                    capability: Capability::NamedRead,
                    named_resource: Some(LOW_STOCK_RESOURCE.to_string()),
                }],
                steps: 1,
                expected_rows: 0,
                output_type: LOW_STOCK_OUTPUT_TYPE.to_string(),
            },
        }
    }

    fn call(name: &str, arguments: Value) -> ToolCallRequest {
        ToolCallRequest {
            id: Some("call-1".to_string()),
            name: name.to_string(),
            arguments,
            arguments_error: None,
        }
    }

    #[tokio::test]
    async fn reviewed_low_stock_call_is_allowed() {
        let base = base();
        let policy = ReviewedInvocationPolicy::new(
            PolicyEngine::default(),
            base.clone(),
            base.plan.tool_calls.clone(),
        )
        .unwrap();
        let decision = policy
            .evaluate(
                &call(NAMED_READ_TOOL, serde_json::json!({"threshold": 3.0})),
                0,
            )
            .await
            .unwrap();
        assert_eq!(decision.outcome, DecisionOutcome::Allow);
    }

    #[tokio::test]
    async fn unknown_tool_is_a_real_deny() {
        let base = base();
        let policy = ReviewedInvocationPolicy::new(
            PolicyEngine::default(),
            base.clone(),
            base.plan.tool_calls.clone(),
        )
        .unwrap();
        let decision = policy
            .evaluate(
                &call("not_reviewed", serde_json::json!({"threshold": 3.0})),
                0,
            )
            .await
            .unwrap();
        assert_eq!(decision.outcome, DecisionOutcome::Deny);
        assert!(decision
            .reasons
            .iter()
            .any(|reason| reason.code == PolicyReasonCode::ToolDenied));
    }

    #[tokio::test]
    async fn cumulative_limit_and_scope_override_are_denied() {
        let base = base();
        let policy = ReviewedInvocationPolicy::new(
            PolicyEngine::default(),
            base.clone(),
            base.plan.tool_calls.clone(),
        )
        .unwrap();
        let limit = policy
            .evaluate(
                &call(NAMED_READ_TOOL, serde_json::json!({"threshold": 3.0})),
                1,
            )
            .await
            .unwrap();
        assert_eq!(limit.outcome, DecisionOutcome::Deny);
        assert!(limit
            .reasons
            .iter()
            .any(|reason| reason.code == PolicyReasonCode::StepLimitExceeded));

        let override_decision = policy
            .evaluate(
                &call(
                    NAMED_READ_TOOL,
                    serde_json::json!({"nested": {"companyId": 99}, "threshold": 3.0}),
                ),
                0,
            )
            .await
            .unwrap();
        assert_eq!(override_decision.outcome, DecisionOutcome::Deny);
        assert!(override_decision
            .reasons
            .iter()
            .any(|reason| reason.code == PolicyReasonCode::InvalidInput));
    }

    #[tokio::test]
    async fn protect_output_rejects_cross_company_and_scrubs_metadata() {
        let base = base();
        let policy = ReviewedInvocationPolicy::new(
            PolicyEngine::default(),
            base.clone(),
            base.plan.tool_calls.clone(),
        )
        .unwrap();
        let cross_company = ToolOutput {
            summary: "untrusted".to_string(),
            data: serde_json::json!({"items": [{
                "organization_id": 7, "company_id": 99, "product_id": 1,
                "sku": "SKU-1", "name": "Item", "quantity_on_hand": 1.0,
                "reorder_level": 2.0
            }]}),
            citations: Vec::new(),
            row_count: Some(1),
        };
        assert!(policy
            .protect_output(
                &call(NAMED_READ_TOOL, serde_json::json!({"threshold": 3.0})),
                0,
                cross_company,
            )
            .await
            .is_err());

        let safe = ToolOutput {
            summary: "untrusted".to_string(),
            data: serde_json::json!({"items": []}),
            citations: vec![],
            row_count: None,
        };
        let protected = policy
            .protect_output(
                &call(NAMED_READ_TOOL, serde_json::json!({"threshold": 3.0})),
                0,
                safe,
            )
            .await
            .unwrap();
        assert_eq!(protected.summary, "policy-validated tool result");
        assert!(protected.citations.is_empty());
    }

    #[test]
    fn invalid_context_and_action_execute_are_rejected() {
        let mut invalid = base();
        invalid.organization_id = 0;
        assert!(ReviewedInvocationPolicy::new(
            PolicyEngine::default(),
            invalid,
            base().plan.tool_calls.clone()
        )
        .is_err());

        let mut execute = base();
        execute.plan.tool_calls[0].capability = Capability::ActionExecute;
        assert!(ReviewedInvocationPolicy::new(
            PolicyEngine::default(),
            execute.clone(),
            execute.plan.tool_calls
        )
        .is_err());
    }
}
