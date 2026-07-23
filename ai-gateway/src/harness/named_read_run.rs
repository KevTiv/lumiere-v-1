//! Shared policy-gated named-read execution helper for harness skill adapters.

use serde_json::Value;

use super::{
    audit::{DecisionOutcome, PolicyResult},
    audit_logger::HarnessAuditLogger,
    manifest::{Capability, SkillVersionRef},
    policy_engine::{
        ExecutionMetadata, ExecutionPlan, PlannedToolCall, PolicyControlledRequest, PolicyEngine,
        PolicyExecutionRequest,
    },
};

pub const NAMED_READ_TOOL: &str = "named_resource_read";

pub struct NamedReadRunArgs<'a> {
    pub skill_key: &'a str,
    pub skill_version: u32,
    pub resource: &'a str,
    pub output_type: &'a str,
    pub organization_id: u64,
    pub company_id: u64,
    pub identity_hex: &'a str,
    pub input: Value,
    pub candidate_output: Value,
    pub expected_rows: u32,
    pub steps: u32,
    pub audit_label: &'a str,
}

pub struct NamedReadRunOutcome {
    pub decision: PolicyResult,
    pub audit: HarnessAuditLogger,
    pub allowed: bool,
}

pub fn execute_named_read(
    policy: &PolicyEngine,
    args: NamedReadRunArgs<'_>,
) -> NamedReadRunOutcome {
    let correlation_id = uuid::Uuid::new_v4().to_string();
    let mut audit = HarnessAuditLogger::new(correlation_id.clone());
    audit.record(
        "requested",
        format!(
            "{} org={} company={}",
            args.audit_label, args.organization_id, args.company_id
        ),
    );
    audit.record(
        "resource_accessed",
        format!("{} prepared for policy", args.resource),
    );

    let request = PolicyControlledRequest {
        execution: PolicyExecutionRequest {
            skill: SkillVersionRef::new(args.skill_key, args.skill_version),
            organization_id: args.organization_id,
            company_id: args.company_id,
            correlation_id: correlation_id.clone(),
            metadata: ExecutionMetadata {
                actor_id: Some(args.identity_hex.to_string()),
                causation_id: Some(correlation_id),
                ..Default::default()
            },
            input: args.input,
            plan: ExecutionPlan {
                named_resources: vec![args.resource.to_string()],
                tool_calls: vec![PlannedToolCall {
                    tool_name: NAMED_READ_TOOL.to_string(),
                    capability: Capability::NamedRead,
                    named_resource: Some(args.resource.to_string()),
                }],
                steps: args.steps,
                expected_rows: args.expected_rows,
                output_type: args.output_type.to_string(),
            },
        },
        candidate_output: args.candidate_output,
    };

    let decision = policy.execute_controlled(request);
    audit.record(
        "policy",
        format!(
            "outcome={:?} reasons={}",
            decision.decision.outcome,
            decision.decision.reasons.len()
        ),
    );

    let allowed = decision.decision.outcome != DecisionOutcome::Deny;
    if !allowed {
        audit.record(
            "completed",
            format!("{} denied by policy", args.audit_label),
        );
    }

    NamedReadRunOutcome {
        decision,
        audit,
        allowed,
    }
}
