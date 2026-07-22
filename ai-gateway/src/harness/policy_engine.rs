use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    action_draft_bridge::{self, BridgeError},
    audit::{
        hash_serializable, ActionDraftProposal, DecisionHashes, DecisionOutcome, DecisionReason,
        PolicyDecision, PolicyReasonCode, PolicyResult,
    },
    data_scope_resolver::{DataScope, DataScopeResolver, ResourceRegistry, ScopeError},
    manifest::{
        Capability, OrgPrivacyPolicy, ReviewStatus, RiskClass, SkillManifest, SkillVersionRef,
    },
    privacy_guard::{PrivacyError, PrivacyGuard},
    skill_registry::SkillRegistry,
};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PlannedToolCall {
    pub tool_name: String,
    pub capability: Capability,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub named_resource: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ExecutionPlan {
    pub named_resources: Vec<String>,
    pub tool_calls: Vec<PlannedToolCall>,
    pub steps: u32,
    pub expected_rows: u32,
    pub output_type: String,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct ApprovalMetadata {
    pub approval_id: String,
    pub approved_by: String,
    pub approved_at: String,
}

impl ApprovalMetadata {
    fn is_explicit(&self) -> bool {
        nonempty(&self.approval_id) && nonempty(&self.approved_by) && nonempty(&self.approved_at)
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct CorrectionMetadata {
    pub correction_id: String,
    pub corrected_by: String,
    pub corrected_at: String,
    pub reason: String,
}

impl CorrectionMetadata {
    fn is_explicit(&self) -> bool {
        nonempty(&self.correction_id)
            && nonempty(&self.corrected_by)
            && nonempty(&self.corrected_at)
            && nonempty(&self.reason)
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct ExecutionMetadata {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub causation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval: Option<ApprovalMetadata>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correction: Option<CorrectionMetadata>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct PolicyExecutionRequest {
    pub skill: SkillVersionRef,
    pub organization_id: u64,
    pub company_id: u64,
    pub correlation_id: String,
    #[serde(default)]
    pub metadata: ExecutionMetadata,
    pub input: Value,
    pub plan: ExecutionPlan,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct PolicyControlledRequest {
    pub execution: PolicyExecutionRequest,
    pub candidate_output: Value,
}

#[derive(Clone, Debug)]
struct Evaluation {
    decision: PolicyDecision,
    scopes: Vec<DataScope>,
}

#[derive(Clone, Debug)]
pub struct PolicyEngine {
    skills: SkillRegistry,
    scopes: DataScopeResolver,
    privacy: PrivacyGuard,
    org_privacy: OrgPrivacyPolicy,
}

impl Default for PolicyEngine {
    fn default() -> Self {
        Self::new(SkillRegistry::built_in(), ResourceRegistry::built_in())
    }
}

impl PolicyEngine {
    pub fn new(skills: SkillRegistry, resources: ResourceRegistry) -> Self {
        Self {
            skills,
            scopes: DataScopeResolver::new(resources),
            privacy: PrivacyGuard,
            org_privacy: OrgPrivacyPolicy::default(),
        }
    }

    pub fn with_org_privacy(mut self, org_privacy: OrgPrivacyPolicy) -> Self {
        self.org_privacy = org_privacy;
        self
    }

    pub fn evaluate(&self, request: &PolicyExecutionRequest) -> PolicyDecision {
        self.evaluate_internal(request).decision
    }

    pub fn execute_controlled(&self, request: PolicyControlledRequest) -> PolicyResult {
        let evaluation = self.evaluate_internal(&request.execution);
        if evaluation.decision.outcome == DecisionOutcome::Deny {
            return PolicyResult::new(evaluation.decision, None, None, None);
        }

        let manifest = self
            .skills
            .get(&request.execution.skill)
            .expect("allowed decisions always have a registered manifest");

        // Red skills become pending action drafts; they never produce a direct
        // output or execute a reducer without independent human approval.
        if manifest.risk == RiskClass::Red
            && evaluation.decision.outcome == DecisionOutcome::DraftOnly
        {
            return match action_draft_bridge::build_proposal(&request) {
                Ok(proposal) => PolicyResult::new(evaluation.decision, None, None, Some(proposal)),
                Err(BridgeError::MissingActionDraft) => PolicyResult::new(
                    deny(
                        evaluation.decision,
                        PolicyReasonCode::CapabilityDenied,
                        "red skill plan is missing an action-draft tool call",
                    ),
                    None,
                    None,
                    None,
                ),
                Err(BridgeError::MultipleActionDrafts) => PolicyResult::new(
                    deny(
                        evaluation.decision,
                        PolicyReasonCode::CapabilityDenied,
                        "red skill plan contains multiple action-draft tool calls",
                    ),
                    None,
                    None,
                    None,
                ),
                Err(BridgeError::InvalidInput(message)) => PolicyResult::new(
                    deny(evaluation.decision, PolicyReasonCode::InvalidInput, message),
                    None,
                    None,
                    None,
                ),
            };
        }

        let Some(scope) = evaluation.scopes.first() else {
            return PolicyResult::new(
                deny(
                    evaluation.decision,
                    PolicyReasonCode::UnknownResource,
                    "no resolved named resource contract",
                ),
                None,
                None,
                None,
            );
        };
        if evaluation.scopes.len() != 1 {
            return PolicyResult::new(
                deny(
                    evaluation.decision,
                    PolicyReasonCode::OutputContractMismatch,
                    "Phase 1 controlled execution requires exactly one named resource",
                ),
                None,
                None,
                None,
            );
        }

        let contract = self
            .scopes
            .resources()
            .get(&scope.named_resource)
            .expect("resolved scopes always have a registered contract");

        let merged_privacy = manifest.privacy.merge_with_org(&self.org_privacy);
        let (protected_output, privacy_report) = match self.privacy.protect_output(
            &request.candidate_output,
            &scope.rows_field,
            request.execution.company_id,
            &merged_privacy,
        ) {
            Ok(output) => output,
            Err(error) => {
                let code = match error {
                    PrivacyError::CrossCompanyRow { .. } => PolicyReasonCode::CrossCompanyRow,
                    PrivacyError::InvalidOutput(_) => PolicyReasonCode::PrivacyViolation,
                };
                return PolicyResult::new(
                    deny(evaluation.decision, code, error.message()),
                    None,
                    None,
                    None,
                );
            }
        };

        if privacy_report.rows_processed > manifest.limits.max_rows {
            return PolicyResult::new(
                deny(
                    evaluation.decision,
                    PolicyReasonCode::RowLimitExceeded,
                    format!(
                        "output contains {} rows, limit is {}",
                        privacy_report.rows_processed, manifest.limits.max_rows
                    ),
                ),
                None,
                Some(privacy_report),
                None,
            );
        }

        if let Err(message) = (contract.validate_output)(&protected_output) {
            return PolicyResult::new(
                deny(
                    evaluation.decision,
                    PolicyReasonCode::InvalidOutput,
                    message,
                ),
                None,
                Some(privacy_report),
                None,
            );
        }

        PolicyResult::new(
            evaluation.decision,
            Some(protected_output),
            Some(privacy_report),
            None,
        )
    }

    fn evaluate_internal(&self, request: &PolicyExecutionRequest) -> Evaluation {
        let request_hash = hash_serializable(request);
        let input_hash = hash_serializable(&request.input);
        let correlation = super::audit::CorrelationMetadata {
            correlation_id: request.correlation_id.clone(),
            organization_id: request.organization_id,
            company_id: request.company_id,
            actor_id: request.metadata.actor_id.clone(),
            causation_id: request.metadata.causation_id.clone(),
        };
        let base_hashes = DecisionHashes {
            request_hash,
            input_hash,
            manifest_hash: None,
        };

        if request.organization_id == 0
            || request.company_id == 0
            || !nonempty(&request.correlation_id)
        {
            return Evaluation {
                decision: base_decision(
                    request,
                    correlation,
                    base_hashes,
                    DecisionOutcome::Deny,
                    None,
                    None,
                    DecisionReason::new(
                        PolicyReasonCode::InvalidContext,
                        "organization_id, company_id, and correlation_id are required",
                    ),
                ),
                scopes: Vec::new(),
            };
        }

        let Some(manifest) = self.skills.get(&request.skill) else {
            return Evaluation {
                decision: base_decision(
                    request,
                    correlation,
                    base_hashes,
                    DecisionOutcome::Deny,
                    None,
                    None,
                    DecisionReason::new(
                        PolicyReasonCode::UnknownSkillVersion,
                        format!(
                            "skill '{}@{}' is not in the reviewed registry",
                            request.skill.skill_key, request.skill.version
                        ),
                    ),
                ),
                scopes: Vec::new(),
            };
        };

        let hashes = DecisionHashes {
            manifest_hash: Some(hash_serializable(manifest)),
            ..base_hashes
        };
        if manifest.review.status != ReviewStatus::Promoted {
            return Evaluation {
                decision: base_decision(
                    request,
                    correlation,
                    hashes,
                    DecisionOutcome::Deny,
                    Some(manifest.risk),
                    Some(manifest.limits),
                    DecisionReason::new(
                        PolicyReasonCode::VersionNotPromoted,
                        "the exact skill version is not promoted",
                    ),
                ),
                scopes: Vec::new(),
            };
        }

        let mut violations = Vec::new();
        validate_manifest(manifest, &mut violations);

        if request.plan.output_type != manifest.output_type {
            violations.push(DecisionReason::new(
                PolicyReasonCode::OutputTypeMismatch,
                format!(
                    "requested output type '{}' does not match required type '{}'",
                    request.plan.output_type, manifest.output_type
                ),
            ));
        }
        if request.plan.expected_rows > manifest.limits.max_rows {
            violations.push(DecisionReason::new(
                PolicyReasonCode::RowLimitExceeded,
                format!(
                    "expected rows {} exceeds limit {}",
                    request.plan.expected_rows, manifest.limits.max_rows
                ),
            ));
        }
        if request.plan.steps > manifest.limits.max_steps {
            violations.push(DecisionReason::new(
                PolicyReasonCode::StepLimitExceeded,
                format!(
                    "planned steps {} exceeds limit {}",
                    request.plan.steps, manifest.limits.max_steps
                ),
            ));
        }
        if request.plan.tool_calls.len() as u32 > manifest.limits.max_tool_calls {
            violations.push(DecisionReason::new(
                PolicyReasonCode::ToolCallLimitExceeded,
                format!(
                    "planned tool calls {} exceeds limit {}",
                    request.plan.tool_calls.len(),
                    manifest.limits.max_tool_calls
                ),
            ));
        }

        for tool_call in &request.plan.tool_calls {
            if !manifest
                .allowed_tools
                .iter()
                .any(|tool| tool == &tool_call.tool_name)
            {
                violations.push(DecisionReason::new(
                    PolicyReasonCode::ToolDenied,
                    format!("tool '{}' is not allowed", tool_call.tool_name),
                ));
            }
            if !manifest
                .allowed_capabilities
                .contains(&tool_call.capability)
            {
                violations.push(DecisionReason::new(
                    PolicyReasonCode::CapabilityDenied,
                    format!("capability '{:?}' is not allowed", tool_call.capability),
                ));
            }
            if tool_call.capability == Capability::NamedRead {
                match tool_call.named_resource.as_deref() {
                    Some(resource)
                        if request.plan.named_resources.iter().any(|r| r == resource) => {}
                    _ => violations.push(DecisionReason::new(
                        PolicyReasonCode::ResourceNotAllowed,
                        format!(
                            "named-read tool '{}' must reference a requested named resource",
                            tool_call.tool_name
                        ),
                    )),
                }
            }
        }

        let has_named_read = request
            .plan
            .tool_calls
            .iter()
            .any(|call| call.capability == Capability::NamedRead);
        let scopes = if has_named_read {
            match self.scopes.resolve(
                manifest,
                request.organization_id,
                request.company_id,
                &request.plan.named_resources,
            ) {
                Ok(scopes) => scopes,
                Err(error) => {
                    violations.push(scope_reason(&error));
                    Vec::new()
                }
            }
        } else if request.plan.named_resources.is_empty() {
            // A red action-draft request can be fully bounded by its typed input
            // and company scope. It must not be forced through a read-resource
            // contract when it has no named-read tool call.
            Vec::new()
        } else {
            violations.push(DecisionReason::new(
                PolicyReasonCode::ResourceNotAllowed,
                "named resources require at least one named-read tool call",
            ));
            Vec::new()
        };

        for scope in &scopes {
            if let Some(contract) = self.scopes.resources().get(&scope.named_resource) {
                if let Err(message) = (contract.validate_input)(&request.input) {
                    violations.push(DecisionReason::new(PolicyReasonCode::InvalidInput, message));
                }
            }
        }

        let outcome = match manifest.risk {
            RiskClass::Green => {
                if request.plan.tool_calls.is_empty()
                    || request
                        .plan
                        .tool_calls
                        .iter()
                        .any(|call| call.capability != Capability::NamedRead)
                {
                    violations.push(DecisionReason::new(
                        PolicyReasonCode::CapabilityDenied,
                        "green skills may only use named-read tool calls",
                    ));
                }
                DecisionOutcome::Allow
            }
            RiskClass::Amber => {
                if request.plan.tool_calls.iter().any(|call| {
                    !matches!(
                        call.capability,
                        Capability::NamedRead | Capability::ActionDraft
                    )
                }) {
                    violations.push(DecisionReason::new(
                        PolicyReasonCode::CapabilityDenied,
                        "amber skills are draft-only and may not execute actions, SQL, network, or filesystem access",
                    ));
                }
                DecisionOutcome::DraftOnly
            }
            RiskClass::Red => {
                // Red skills are not executed directly. If the manifest permits
                // ActionDraft capability, the request is converted into a pending
                // action draft that requires independent human approval.
                let capabilities: std::collections::BTreeSet<_> = request
                    .plan
                    .tool_calls
                    .iter()
                    .map(|call| call.capability)
                    .collect();
                let only_safe = capabilities
                    .iter()
                    .all(|cap| matches!(cap, Capability::NamedRead | Capability::ActionDraft));
                let has_action_draft = capabilities.contains(&Capability::ActionDraft);

                if has_action_draft && only_safe {
                    DecisionOutcome::DraftOnly
                } else {
                    violations.push(DecisionReason::new(
                        PolicyReasonCode::RedExecutionUnavailable,
                        "red skills with execution capabilities other than action-draft are not supported",
                    ));
                    DecisionOutcome::Deny
                }
            }
        };

        if !violations.is_empty() {
            return Evaluation {
                decision: PolicyDecision {
                    outcome: DecisionOutcome::Deny,
                    skill: request.skill.clone(),
                    risk: Some(manifest.risk),
                    reasons: violations,
                    correlation,
                    hashes,
                    enforced_limits: Some(manifest.limits),
                },
                scopes,
            };
        }

        let reason = match (manifest.risk, outcome) {
            (RiskClass::Red, DecisionOutcome::DraftOnly) => DecisionReason::new(
                PolicyReasonCode::RedApprovalRequired,
                "red action requires independent human approval via action draft",
            ),
            (_, DecisionOutcome::DraftOnly) => DecisionReason::new(
                PolicyReasonCode::DraftOnly,
                "amber policy permits draft output only",
            ),
            _ => DecisionReason::new(
                PolicyReasonCode::Allowed,
                "request satisfies the promoted manifest and resource contracts",
            ),
        };
        Evaluation {
            decision: PolicyDecision {
                outcome,
                skill: request.skill.clone(),
                risk: Some(manifest.risk),
                reasons: vec![reason],
                correlation,
                hashes,
                enforced_limits: Some(manifest.limits),
            },
            scopes,
        }
    }
}

fn validate_manifest(manifest: &SkillManifest, violations: &mut Vec<DecisionReason>) {
    if manifest.limits.max_steps == 0
        || manifest.limits.max_tool_calls == 0
        || manifest.allowed_tools.is_empty()
        || manifest.output_type.trim().is_empty()
    {
        violations.push(DecisionReason::new(
            PolicyReasonCode::InvalidManifest,
            "promoted manifest is missing resources, tools, output type, privacy fields, or positive limits",
        ));
    }

    match manifest.risk {
        RiskClass::Green
            if manifest
                .allowed_capabilities
                .iter()
                .any(|capability| *capability != Capability::NamedRead) =>
        {
            violations.push(DecisionReason::new(
                PolicyReasonCode::InvalidManifest,
                "green manifests may allow named-read capability only",
            ));
        }
        RiskClass::Green
            if manifest.named_resources.is_empty()
                || manifest.privacy.allowed_fields.is_empty() =>
        {
            violations.push(DecisionReason::new(
                PolicyReasonCode::InvalidManifest,
                "green manifests require scoped named resources and an output privacy allowlist",
            ));
        }
        RiskClass::Amber
            if manifest.allowed_capabilities.iter().any(|capability| {
                !matches!(capability, Capability::NamedRead | Capability::ActionDraft)
            }) =>
        {
            violations.push(DecisionReason::new(
                PolicyReasonCode::InvalidManifest,
                "amber manifests may allow named reads and action drafts only",
            ));
        }
        _ => {}
    }

    let uses_named_reads = manifest
        .allowed_capabilities
        .iter()
        .any(|capability| *capability == Capability::NamedRead);
    if uses_named_reads
        && (manifest.limits.max_rows == 0
            || manifest.named_resources.is_empty()
            || manifest.privacy.allowed_fields.is_empty())
    {
        violations.push(DecisionReason::new(
            PolicyReasonCode::InvalidManifest,
            "manifests with named reads require a positive row limit, scoped resources, and a privacy allowlist",
        ));
    }
}

fn base_decision(
    request: &PolicyExecutionRequest,
    correlation: super::audit::CorrelationMetadata,
    hashes: DecisionHashes,
    outcome: DecisionOutcome,
    risk: Option<RiskClass>,
    enforced_limits: Option<super::manifest::ExecutionLimits>,
    reason: DecisionReason,
) -> PolicyDecision {
    PolicyDecision {
        outcome,
        skill: request.skill.clone(),
        risk,
        reasons: vec![reason],
        correlation,
        hashes,
        enforced_limits,
    }
}

fn deny(
    mut decision: PolicyDecision,
    code: PolicyReasonCode,
    message: impl Into<String>,
) -> PolicyDecision {
    decision.outcome = DecisionOutcome::Deny;
    decision.reasons = vec![DecisionReason::new(code, message)];
    decision
}

fn scope_reason(error: &ScopeError) -> DecisionReason {
    let code = match error {
        ScopeError::NoNamedResource => PolicyReasonCode::NamedResourceRequired,
        ScopeError::ResourceNotAllowed(_) => PolicyReasonCode::ResourceNotAllowed,
        ScopeError::ResourceUnknown(_) => PolicyReasonCode::UnknownResource,
        ScopeError::ResourceNotPromoted(_) => PolicyReasonCode::ResourceNotPromoted,
        ScopeError::OutputContractMismatch(_) => PolicyReasonCode::OutputContractMismatch,
    };
    DecisionReason::new(code, error.message())
}

fn nonempty(value: &str) -> bool {
    !value.trim().is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harness::{
        low_stock::{
            self, LOW_STOCK_OUTPUT_TYPE, LOW_STOCK_RESOURCE, LOW_STOCK_SKILL_KEY,
            LOW_STOCK_SKILL_VERSION, NAMED_READ_TOOL,
        },
        manifest::{ExecutionLimits, PrivacyPolicy, ReviewMetadata},
        red_action_drafts::{
            CREATE_SALE_ORDER_DRAFT_OUTPUT_TYPE, CREATE_SALE_ORDER_DRAFT_SKILL_KEY,
            CREATE_SALE_ORDER_DRAFT_VERSION,
        },
    };

    fn valid_request() -> PolicyExecutionRequest {
        PolicyExecutionRequest {
            skill: SkillVersionRef::new(LOW_STOCK_SKILL_KEY, LOW_STOCK_SKILL_VERSION),
            organization_id: 1,
            company_id: 7,
            correlation_id: "corr-123".to_string(),
            metadata: ExecutionMetadata {
                actor_id: Some("user-9".to_string()),
                causation_id: Some("request-8".to_string()),
                ..Default::default()
            },
            input: serde_json::json!({"threshold": 5.0}),
            plan: ExecutionPlan {
                named_resources: vec![LOW_STOCK_RESOURCE.to_string()],
                tool_calls: vec![PlannedToolCall {
                    tool_name: NAMED_READ_TOOL.to_string(),
                    capability: Capability::NamedRead,
                    named_resource: Some(LOW_STOCK_RESOURCE.to_string()),
                }],
                steps: 1,
                expected_rows: 1,
                output_type: LOW_STOCK_OUTPUT_TYPE.to_string(),
            },
        }
    }

    fn valid_output() -> Value {
        serde_json::json!({
            "items": [{
                "organization_id": 1,
                "company_id": 7,
                "product_id": 3,
                "sku": "W-1",
                "name": "Widget",
                "quantity_on_hand": 2.0,
                "reorder_level": 5.0
            }]
        })
    }

    fn custom_engine(risk: RiskClass, status: ReviewStatus) -> PolicyEngine {
        let mut manifest = low_stock::manifest();
        manifest.skill = SkillVersionRef::new("custom", 1);
        manifest.risk = risk;
        manifest.review.status = status;
        manifest.allowed_capabilities = match risk {
            RiskClass::Green => vec![Capability::NamedRead],
            RiskClass::Amber => vec![Capability::NamedRead, Capability::ActionDraft],
            RiskClass::Red => vec![Capability::ActionDraft],
        };
        if risk == RiskClass::Red {
            manifest.named_resources.clear();
            manifest.allowed_tools = vec!["create_sale_order".to_string()];
            manifest.output_type = "action_draft".to_string();
            manifest.limits.max_rows = 0;
        }
        let mut skills = SkillRegistry::default();
        skills.insert(manifest);
        PolicyEngine::new(skills, ResourceRegistry::built_in())
    }

    #[test]
    fn promoted_green_named_read_is_allowed() {
        let decision = PolicyEngine::default().evaluate(&valid_request());
        assert_eq!(decision.outcome, DecisionOutcome::Allow);
        assert_eq!(decision.risk, Some(RiskClass::Green));
    }

    #[test]
    fn unknown_and_unpromoted_versions_default_deny() {
        let mut unknown = valid_request();
        unknown.skill.version = 99;
        let decision = PolicyEngine::default().evaluate(&unknown);
        assert_eq!(decision.outcome, DecisionOutcome::Deny);
        assert_eq!(
            decision.reasons[0].code,
            PolicyReasonCode::UnknownSkillVersion
        );

        let mut request = valid_request();
        request.skill = SkillVersionRef::new("custom", 1);
        let decision = custom_engine(RiskClass::Green, ReviewStatus::Reviewed).evaluate(&request);
        assert_eq!(decision.outcome, DecisionOutcome::Deny);
        assert_eq!(
            decision.reasons[0].code,
            PolicyReasonCode::VersionNotPromoted
        );
    }

    #[test]
    fn green_denies_sql_network_filesystem_and_action_drafts() {
        for capability in [
            Capability::RawSql,
            Capability::Network,
            Capability::Filesystem,
            Capability::ActionDraft,
        ] {
            let mut request = valid_request();
            request.plan.tool_calls[0].capability = capability;
            let decision = PolicyEngine::default().evaluate(&request);
            assert_eq!(decision.outcome, DecisionOutcome::Deny, "{capability:?}");
            assert!(decision
                .reasons
                .iter()
                .any(|reason| reason.code == PolicyReasonCode::CapabilityDenied));
        }
    }

    #[test]
    fn limits_and_output_type_are_enforced() {
        let cases = [
            (
                101,
                1,
                1,
                LOW_STOCK_OUTPUT_TYPE,
                PolicyReasonCode::RowLimitExceeded,
            ),
            (
                1,
                2,
                1,
                LOW_STOCK_OUTPUT_TYPE,
                PolicyReasonCode::StepLimitExceeded,
            ),
            (
                1,
                1,
                2,
                LOW_STOCK_OUTPUT_TYPE,
                PolicyReasonCode::ToolCallLimitExceeded,
            ),
            (1, 1, 1, "text/plain", PolicyReasonCode::OutputTypeMismatch),
        ];
        for (rows, steps, calls, output_type, expected_code) in cases {
            let mut request = valid_request();
            request.plan.expected_rows = rows;
            request.plan.steps = steps;
            request.plan.output_type = output_type.to_string();
            if calls == 2 {
                request
                    .plan
                    .tool_calls
                    .push(request.plan.tool_calls[0].clone());
            }
            let decision = PolicyEngine::default().evaluate(&request);
            assert_eq!(decision.outcome, DecisionOutcome::Deny);
            assert!(decision
                .reasons
                .iter()
                .any(|reason| reason.code == expected_code));
        }
    }

    #[test]
    fn amber_is_always_draft_only() {
        let engine = custom_engine(RiskClass::Amber, ReviewStatus::Promoted);
        let mut request = valid_request();
        request.skill = SkillVersionRef::new("custom", 1);
        request.plan.tool_calls[0].capability = Capability::ActionDraft;
        request.plan.tool_calls[0].named_resource = None;
        request.plan.named_resources.clear();
        assert_eq!(
            engine.evaluate(&request).outcome,
            DecisionOutcome::DraftOnly
        );

        request.plan.tool_calls[0].capability = Capability::ActionExecute;
        assert_eq!(engine.evaluate(&request).outcome, DecisionOutcome::Deny);
    }

    #[test]
    fn red_without_action_draft_capability_is_denied() {
        let engine = custom_engine(RiskClass::Red, ReviewStatus::Promoted);
        let mut request = valid_request();
        request.skill = SkillVersionRef::new("custom", 1);
        assert_eq!(engine.evaluate(&request).outcome, DecisionOutcome::Deny);

        request.metadata.approval = Some(ApprovalMetadata {
            approval_id: "approval-1".to_string(),
            approved_by: "manager-1".to_string(),
            approved_at: "2026-07-10T12:00:00Z".to_string(),
        });
        assert_eq!(engine.evaluate(&request).outcome, DecisionOutcome::Deny);

        request.metadata.approval = None;
        request.metadata.correction = Some(CorrectionMetadata {
            correction_id: "correction-1".to_string(),
            corrected_by: "reviewer-1".to_string(),
            corrected_at: "2026-07-10T12:00:00Z".to_string(),
            reason: "verified exception".to_string(),
        });
        let decision = engine.evaluate(&request);
        assert_eq!(decision.outcome, DecisionOutcome::Deny);
        assert!(decision
            .reasons
            .iter()
            .any(|reason| reason.code == PolicyReasonCode::RedExecutionUnavailable));
    }

    #[test]
    fn red_action_draft_returns_proposal() {
        let engine = custom_engine(RiskClass::Red, ReviewStatus::Promoted);
        let mut request = valid_request();
        request.skill = SkillVersionRef::new("custom", 1);
        request.input = serde_json::json!({"partner_id": 42});
        request.plan.tool_calls[0].tool_name = "create_sale_order".to_string();
        request.plan.tool_calls[0].capability = Capability::ActionDraft;
        request.plan.tool_calls[0].named_resource = None;
        request.plan.named_resources.clear();
        request.plan.expected_rows = 0;
        request.plan.output_type = "action_draft".to_string();

        let result = engine.execute_controlled(PolicyControlledRequest {
            execution: request,
            candidate_output: Value::Null,
        });

        assert_eq!(result.decision.outcome, DecisionOutcome::DraftOnly);
        assert!(result
            .decision
            .reasons
            .iter()
            .any(|reason| reason.code == PolicyReasonCode::RedApprovalRequired));
        let proposal = result.action_draft.expect("action draft proposal missing");
        assert_eq!(proposal.reducer_name, "create_sale_order");
        assert!(proposal.elevated);
        assert!(proposal.params_json.contains("\"company_id\":7"));
    }

    #[test]
    fn built_in_red_skill_only_allows_a_governed_draft() {
        let mut request = valid_request();
        request.skill = SkillVersionRef::new(
            CREATE_SALE_ORDER_DRAFT_SKILL_KEY,
            CREATE_SALE_ORDER_DRAFT_VERSION,
        );
        request.input = serde_json::json!({"partner_id": 42});
        request.plan.named_resources.clear();
        request.plan.tool_calls = vec![PlannedToolCall {
            tool_name: "create_sale_order".to_string(),
            capability: Capability::ActionDraft,
            named_resource: None,
        }];
        request.plan.expected_rows = 0;
        request.plan.output_type = CREATE_SALE_ORDER_DRAFT_OUTPUT_TYPE.to_string();

        let result = PolicyEngine::default().execute_controlled(PolicyControlledRequest {
            execution: request.clone(),
            candidate_output: Value::Null,
        });
        assert_eq!(result.decision.outcome, DecisionOutcome::DraftOnly);
        assert!(result.action_draft.is_some());

        request.plan.tool_calls[0].capability = Capability::Network;
        let denied = PolicyEngine::default().evaluate(&request);
        assert_eq!(denied.outcome, DecisionOutcome::Deny);
        assert!(denied
            .reasons
            .iter()
            .any(|reason| reason.code == PolicyReasonCode::CapabilityDenied));
    }

    #[test]
    fn controlled_result_rejects_cross_company_rows() {
        let result = PolicyEngine::default().execute_controlled(PolicyControlledRequest {
            execution: valid_request(),
            candidate_output: serde_json::json!({
                "items": [{
                    "organization_id": 1,
                    "company_id": 99,
                    "product_id": 3,
                    "sku": "W-1",
                    "name": "Widget",
                    "quantity_on_hand": 2.0,
                    "reorder_level": 5.0
                }]
            }),
        });
        assert_eq!(result.decision.outcome, DecisionOutcome::Deny);
        assert_eq!(
            result.decision.reasons[0].code,
            PolicyReasonCode::CrossCompanyRow
        );
        assert!(result.output.is_none());
    }

    #[test]
    fn controlled_result_enforces_actual_rows_and_typed_output() {
        let mut skills = SkillRegistry::default();
        let mut manifest = low_stock::manifest();
        manifest.limits = ExecutionLimits {
            max_rows: 1,
            max_steps: 1,
            max_tool_calls: 1,
        };
        skills.insert(manifest);
        let engine = PolicyEngine::new(skills, ResourceRegistry::built_in());

        let mut rows = valid_output()["items"].as_array().unwrap().clone();
        rows.push(rows[0].clone());
        let result = engine.execute_controlled(PolicyControlledRequest {
            execution: valid_request(),
            candidate_output: serde_json::json!({"items": rows}),
        });
        assert_eq!(
            result.decision.reasons[0].code,
            PolicyReasonCode::RowLimitExceeded
        );

        let mut invalid = valid_output();
        invalid["items"][0].as_object_mut().unwrap().remove("sku");
        let result = engine.execute_controlled(PolicyControlledRequest {
            execution: valid_request(),
            candidate_output: invalid,
        });
        assert_eq!(
            result.decision.reasons[0].code,
            PolicyReasonCode::InvalidOutput
        );
    }

    #[test]
    fn controlled_result_is_serializable_with_hashes_and_correlation() {
        let result = PolicyEngine::default().execute_controlled(PolicyControlledRequest {
            execution: valid_request(),
            candidate_output: valid_output(),
        });
        assert_eq!(result.decision.outcome, DecisionOutcome::Allow);
        assert_eq!(result.decision.correlation.correlation_id, "corr-123");
        assert!(result.decision.hashes.request_hash.starts_with("uuid-v5:"));
        assert!(result.decision.hashes.input_hash.starts_with("uuid-v5:"));
        assert!(result
            .decision
            .hashes
            .manifest_hash
            .as_ref()
            .unwrap()
            .starts_with("uuid-v5:"));
        assert!(result.output_hash.as_ref().unwrap().starts_with("uuid-v5:"));
        assert!(result.result_hash.starts_with("uuid-v5:"));
        serde_json::to_string(&result).unwrap();
    }

    #[test]
    fn invalid_typed_input_is_denied() {
        let mut request = valid_request();
        request.input = serde_json::json!({"threshold": -1.0});
        let decision = PolicyEngine::default().evaluate(&request);
        assert_eq!(decision.outcome, DecisionOutcome::Deny);
        assert!(decision
            .reasons
            .iter()
            .any(|reason| reason.code == PolicyReasonCode::InvalidInput));
    }

    #[test]
    fn manifest_privacy_allowlist_cannot_be_empty() {
        let mut manifest = low_stock::manifest();
        manifest.skill = SkillVersionRef::new("custom", 1);
        manifest.privacy = PrivacyPolicy::new(Vec::<String>::new());
        manifest.review = ReviewMetadata {
            status: ReviewStatus::Promoted,
            reviewed_by: "reviewer".to_string(),
            reviewed_at: "2026-07-10T00:00:00Z".to_string(),
        };
        let mut skills = SkillRegistry::default();
        skills.insert(manifest);
        let engine = PolicyEngine::new(skills, ResourceRegistry::built_in());
        let mut request = valid_request();
        request.skill = SkillVersionRef::new("custom", 1);
        let decision = engine.evaluate(&request);
        assert!(decision
            .reasons
            .iter()
            .any(|reason| reason.code == PolicyReasonCode::InvalidManifest));
    }
}
