//! Reviewed production-shaped governed programs.
//!
//! Known ERP workflows belong here as explicit typed graphs. Providers never
//! author these graphs at runtime.

use super::{
    decision_graph::{
        AcquireEvidenceNode, CapabilityNode, ChoiceDecisionNode, ComputeNode, DecisionGraph,
        DecisionNode, EarlyStopNode, GateBranch, GateCondition, GateNode, GenerateNode, GraphNode,
        ProbabilityDecisionNode, ReasonNode, RequireApprovalNode, StopReason, VerifyNode,
    },
    intelligence::{
        DecisionTypeRef, PROPOSAL_KIND_CLARIFICATION, PROPOSAL_KIND_FINAL_DRAFT,
    },
    probabilistic::{CalibrationProfileRef, GateDecision, ThresholdGatePolicy},
};

pub(super) const REPORT_ANALYSIS_PROGRAM_REF: &str = "skill:report_analysis@1";

pub(super) fn report_analysis_graph() -> DecisionGraph {
    DecisionGraph {
        entry: "analytics".to_string(),
        nodes: vec![
            GraphNode {
                id: "analytics".to_string(),
                depends_on: Vec::new(),
                next: Some("verify_analytics".to_string()),
                kind: DecisionNode::Capability(CapabilityNode {
                    capability: "analytics_summary".to_string(),
                }),
            },
            GraphNode {
                id: "verify_analytics".to_string(),
                depends_on: vec!["analytics".to_string()],
                next: Some("attention_need".to_string()),
                kind: DecisionNode::Verify(VerifyNode {
                    source: "analytics".to_string(),
                }),
            },
            GraphNode {
                id: "attention_need".to_string(),
                depends_on: vec!["analytics".to_string()],
                next: Some("route".to_string()),
                kind: DecisionNode::Probability(ProbabilityDecisionNode {
                    decision_type: DecisionTypeRef {
                        name: "ReportAttentionNeed".to_string(),
                        version: 1,
                    },
                    question: "How likely is this approved analytics result to require focused human follow-up rather than a routine summary?".to_string(),
                }),
            },
            GraphNode {
                id: "route".to_string(),
                depends_on: vec!["attention_need".to_string()],
                next: None,
                kind: DecisionNode::Gate(GateNode {
                    source: "attention_need".to_string(),
                    branches: vec![
                        GateBranch {
                            condition: GateCondition::ThresholdPolicy {
                                policy: ThresholdGatePolicy {
                                    name: "report-attention-routing".to_string(),
                                    hard_stop_at_least: Some(0.65),
                                    continue_below: Some(0.35),
                                    require_calibrated: true,
                                },
                                calibration_profile: Some(CalibrationProfileRef {
                                    name: "report-attention".to_string(),
                                    version: 1,
                                }),
                                on: GateDecision::Escalate,
                            },
                            target: "generate_attention".to_string(),
                        },
                        GateBranch {
                            condition: GateCondition::ThresholdPolicy {
                                policy: ThresholdGatePolicy {
                                    name: "report-attention-routing".to_string(),
                                    hard_stop_at_least: Some(0.65),
                                    continue_below: Some(0.35),
                                    require_calibrated: true,
                                },
                                calibration_profile: Some(CalibrationProfileRef {
                                    name: "report-attention".to_string(),
                                    version: 1,
                                }),
                                on: GateDecision::Continue,
                            },
                            target: "generate_summary".to_string(),
                        },
                        GateBranch {
                            condition: GateCondition::Default,
                            target: "reason_ambiguous".to_string(),
                        },
                    ],
                }),
            },
            GraphNode {
                id: "reason_ambiguous".to_string(),
                depends_on: vec!["analytics".to_string(), "attention_need".to_string()],
                next: Some("generate_attention".to_string()),
                kind: DecisionNode::Reason(ReasonNode {
                    allowed_proposal_kinds: vec![
                        PROPOSAL_KIND_CLARIFICATION.to_string(),
                        PROPOSAL_KIND_FINAL_DRAFT.to_string(),
                    ],
                    max_iterations: 1,
                    loop_back_to: None,
                }),
            },
            GraphNode {
                id: "generate_attention".to_string(),
                depends_on: vec!["analytics".to_string(), "attention_need".to_string()],
                next: None,
                kind: DecisionNode::Generate(GenerateNode {
                    format: "concise report highlighting anomalies, material changes, and concrete follow-up questions".to_string(),
                }),
            },
            GraphNode {
                id: "generate_summary".to_string(),
                depends_on: vec!["analytics".to_string(), "attention_need".to_string()],
                next: None,
                kind: DecisionNode::Generate(GenerateNode {
                    format: "concise factual analytics summary".to_string(),
                }),
            },
        ],
    }
}


pub(super) fn conditional_evidence_reference_graph() -> DecisionGraph {
    let policy = ThresholdGatePolicy {
        name: "reference-evidence-confidence".to_string(),
        hard_stop_at_least: Some(0.8),
        continue_below: Some(0.3),
        require_calibrated: false,
    };
    DecisionGraph {
        entry: "input".to_string(),
        nodes: vec![
            GraphNode {
                id: "input".to_string(),
                depends_on: Vec::new(),
                next: Some("initial_decision".to_string()),
                kind: DecisionNode::Compute(ComputeNode {
                    function_ref: "program_input".to_string(),
                }),
            },
            GraphNode {
                id: "initial_decision".to_string(),
                depends_on: vec!["input".to_string()],
                next: Some("evidence_gate".to_string()),
                kind: DecisionNode::Probability(ProbabilityDecisionNode {
                    decision_type: DecisionTypeRef {
                        name: "StockReorderPriority".to_string(),
                        version: 1,
                    },
                    question: "Is the current evidence sufficient to treat this as urgent?".to_string(),
                }),
            },
            GraphNode {
                id: "evidence_gate".to_string(),
                depends_on: vec!["initial_decision".to_string()],
                next: None,
                kind: DecisionNode::Gate(GateNode {
                    source: "initial_decision".to_string(),
                    branches: vec![
                        GateBranch {
                            condition: GateCondition::ThresholdPolicy {
                                policy: policy.clone(),
                                calibration_profile: None,
                                on: GateDecision::AcquireEvidence,
                            },
                            target: "acquire_detail".to_string(),
                        },
                        GateBranch {
                            condition: GateCondition::ThresholdPolicy {
                                policy: policy.clone(),
                                calibration_profile: None,
                                on: GateDecision::Escalate,
                            },
                            target: "urgent_stop".to_string(),
                        },
                        GateBranch {
                            condition: GateCondition::ThresholdPolicy {
                                policy,
                                calibration_profile: None,
                                on: GateDecision::Continue,
                            },
                            target: "routine_summary".to_string(),
                        },
                        GateBranch {
                            condition: GateCondition::Default,
                            target: "acquire_detail".to_string(),
                        },
                    ],
                }),
            },
            GraphNode {
                id: "acquire_detail".to_string(),
                depends_on: vec!["initial_decision".to_string()],
                next: Some("refined_decision".to_string()),
                kind: DecisionNode::AcquireEvidence(AcquireEvidenceNode {
                    capability: "inventory_snapshot".to_string(),
                    max_rows: 25,
                    affects: vec!["refined_decision".to_string()],
                }),
            },
            GraphNode {
                id: "refined_decision".to_string(),
                depends_on: vec!["input".to_string(), "acquire_detail".to_string()],
                next: Some("routine_summary".to_string()),
                kind: DecisionNode::Probability(ProbabilityDecisionNode {
                    decision_type: DecisionTypeRef {
                        name: "StockReorderPriority".to_string(),
                        version: 1,
                    },
                    question: "Re-evaluate urgency using the newly acquired bounded evidence.".to_string(),
                }),
            },
            GraphNode {
                id: "urgent_stop".to_string(),
                depends_on: vec!["initial_decision".to_string()],
                next: None,
                kind: DecisionNode::EarlyStop(EarlyStopNode {
                    source: "initial_decision".to_string(),
                    reason: StopReason::PolicyViolation,
                }),
            },
            GraphNode {
                id: "routine_summary".to_string(),
                depends_on: vec!["input".to_string()],
                next: None,
                kind: DecisionNode::Generate(GenerateNode {
                    format: "bounded inventory assessment with evidence provenance".to_string(),
                }),
            },
        ],
    }
}

pub(super) fn consequential_mutation_reference_graph() -> DecisionGraph {
    DecisionGraph {
        entry: "input".to_string(),
        nodes: vec![
            GraphNode {
                id: "input".to_string(),
                depends_on: Vec::new(),
                next: Some("mutation_decision".to_string()),
                kind: DecisionNode::Compute(ComputeNode {
                    function_ref: "program_input".to_string(),
                }),
            },
            GraphNode {
                id: "mutation_decision".to_string(),
                depends_on: vec!["input".to_string()],
                next: Some("mutation_gate".to_string()),
                kind: DecisionNode::Choice(ChoiceDecisionNode {
                    decision_type: DecisionTypeRef {
                        name: "PaymentDisposition".to_string(),
                        version: 1,
                    },
                    question: "Should this bounded transaction proceed to the governed mutation path?".to_string(),
                    candidates: vec!["clear".to_string(), "flag".to_string()],
                }),
            },
            GraphNode {
                id: "mutation_gate".to_string(),
                depends_on: vec!["mutation_decision".to_string()],
                next: None,
                kind: DecisionNode::Gate(GateNode {
                    source: "mutation_decision".to_string(),
                    branches: vec![
                        GateBranch {
                            condition: GateCondition::ChoiceEquals("clear".to_string()),
                            target: "approval".to_string(),
                        },
                        GateBranch {
                            condition: GateCondition::Default,
                            target: "blocked".to_string(),
                        },
                    ],
                }),
            },
            GraphNode {
                id: "approval".to_string(),
                depends_on: vec!["mutation_decision".to_string()],
                next: Some("mutate".to_string()),
                kind: DecisionNode::RequireApproval(RequireApprovalNode {
                    source: "mutation_decision".to_string(),
                }),
            },
            GraphNode {
                id: "mutate".to_string(),
                depends_on: vec!["approval".to_string()],
                next: Some("verify_mutation".to_string()),
                kind: DecisionNode::Capability(CapabilityNode {
                    capability: "post_payment".to_string(),
                }),
            },
            GraphNode {
                id: "verify_mutation".to_string(),
                depends_on: vec!["mutate".to_string()],
                next: Some("receipt".to_string()),
                kind: DecisionNode::Verify(VerifyNode {
                    source: "mutate".to_string(),
                }),
            },
            GraphNode {
                id: "receipt".to_string(),
                depends_on: vec!["verify_mutation".to_string()],
                next: None,
                kind: DecisionNode::Generate(GenerateNode {
                    format: "mutation receipt with verification evidence".to_string(),
                }),
            },
            GraphNode {
                id: "blocked".to_string(),
                depends_on: vec!["mutation_decision".to_string()],
                next: None,
                kind: DecisionNode::EarlyStop(EarlyStopNode {
                    source: "mutation_decision".to_string(),
                    reason: StopReason::PolicyViolation,
                }),
            },
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::orchestrator::decision_graph::validate_graph;

    #[test]
    fn report_analysis_program_is_valid() {
        validate_graph(&report_analysis_graph()).unwrap();
    }

    #[test]
    fn conditional_evidence_reference_program_is_valid() {
        validate_graph(&conditional_evidence_reference_graph()).unwrap();
    }

    #[test]
    fn consequential_mutation_reference_program_is_valid() {
        validate_graph(&consequential_mutation_reference_graph()).unwrap();
    }
}
