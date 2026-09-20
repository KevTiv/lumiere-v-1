//! Reviewed production-shaped governed programs.
//!
//! Known ERP workflows belong here as explicit typed graphs. Providers never
//! author these graphs at runtime.

use crate::harness::{manifest::Capability, policy_engine::PlannedToolCall};

use super::{
    decision_graph::{
        AcquireEvidenceNode, CapabilityNode, ChoiceDecisionNode, ComputeNode, DecisionGraph,
        DecisionNode, EarlyStopNode, GateBranch, GateCondition, GateNode, GenerateNode, GraphNode,
        ProbabilityDecisionNode, ReasonNode, RequireApprovalNode, StopReason, VerifyNode,
    },
    intelligence::{DecisionTypeRef, PROPOSAL_KIND_CLARIFICATION, PROPOSAL_KIND_FINAL_DRAFT},
    probabilistic::{CalibrationProfileRef, GateDecision, ThresholdGatePolicy},
};

pub(super) const REPORT_ANALYSIS_PROGRAM_REF: &str = "skill:report_analysis@1";
pub(super) const RAG_GENERATION_PROGRAM_REF: &str = "skill:rag_generation@1";
pub(super) const FORM_SUGGESTION_PROGRAM_REF: &str = "skill:form_suggestion@1";
pub(super) const ACTION_DRAFT_GENERATION_PROGRAM_REF: &str =
    "skill:action_draft_generation@1";

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
                    question: "Is the current evidence sufficient to treat this as urgent?"
                        .to_string(),
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
                next: Some("initial_decision".to_string()),
                kind: DecisionNode::AcquireEvidence(AcquireEvidenceNode {
                    capability: "inventory_snapshot".to_string(),
                    max_rows: 25,
                    affects: vec!["initial_decision".to_string()],
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
                    question:
                        "Should this bounded transaction proceed to the governed mutation path?"
                            .to_string(),
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
                next: Some("verify_mutation".to_string()),
                kind: DecisionNode::RequireApproval(RequireApprovalNode {
                    source: "mutation_decision".to_string(),
                    capability: "post_payment".to_string(),
                }),
            },
            GraphNode {
                id: "verify_mutation".to_string(),
                depends_on: vec!["approval".to_string()],
                next: Some("receipt".to_string()),
                kind: DecisionNode::Verify(VerifyNode {
                    source: "approval".to_string(),
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

pub(super) fn rag_generation_graph() -> DecisionGraph {
    generation_surface_graph(
        "schema-constrained grounded JSON answer from authorized retrieval and live ERP evidence",
    )
}

pub(super) fn form_suggestion_graph() -> DecisionGraph {
    generation_surface_graph(
        "schema-constrained advisory ERP form suggestions using only the supplied field schema and authorized source context",
    )
}

pub(super) fn action_draft_generation_graph() -> DecisionGraph {
    generation_surface_graph(
        "schema-constrained advisory ERP action draft proposals only; never execute reducers or imply mutation authority",
    )
}

fn generation_surface_graph(format: &str) -> DecisionGraph {
    DecisionGraph {
        entry: "input".to_string(),
        nodes: vec![
            GraphNode {
                id: "input".to_string(),
                depends_on: Vec::new(),
                next: Some("generate".to_string()),
                kind: DecisionNode::Compute(ComputeNode {
                    function_ref: "program_input".to_string(),
                }),
            },
            GraphNode {
                id: "generate".to_string(),
                depends_on: vec!["input".to_string()],
                next: None,
                kind: DecisionNode::Generate(GenerateNode {
                    format: format.to_string(),
                }),
            },
        ],
    }
}

pub(super) struct GovernedProgramCatalogEntry {
    pub program_ref: &'static str,
    pub graph: DecisionGraph,
    pub review_independence_key: &'static str,
    pub reviewed_calls: Vec<PlannedToolCall>,
}

pub(crate) fn governed_program_for_skill(skill_key: &str) -> Option<GovernedProgramCatalogEntry> {
    match skill_key {
        "report_analysis" => Some(GovernedProgramCatalogEntry {
            program_ref: REPORT_ANALYSIS_PROGRAM_REF,
            graph: report_analysis_graph(),
            review_independence_key: "ReportAttentionNeed",
            reviewed_calls: vec![named_read_call("analytics_summary")],
        }),
        "process_research" => Some(GovernedProgramCatalogEntry {
            program_ref: "skill:process_research@1",
            graph: process_research_graph(),
            review_independence_key: "RunReviewDisposition",
            reviewed_calls: vec![
                named_read_call("analytics_summary"),
                named_read_call("erp_search"),
            ],
        }),
        "supplier_discovery" => Some(GovernedProgramCatalogEntry {
            program_ref: "skill:supplier_discovery@1",
            graph: supplier_discovery_graph(),
            review_independence_key: "RunReviewDisposition",
            reviewed_calls: vec![named_read_call("erp_search"), network_call("web_search")],
        }),
        "price_search" => Some(GovernedProgramCatalogEntry {
            program_ref: "skill:price_search@1",
            graph: price_search_graph(),
            review_independence_key: "RunReviewDisposition",
            reviewed_calls: vec![named_read_call("erp_search"), network_call("web_search")],
        }),
        "rag_generation" => Some(GovernedProgramCatalogEntry {
            program_ref: RAG_GENERATION_PROGRAM_REF,
            graph: rag_generation_graph(),
            review_independence_key: "RunReviewDisposition",
            reviewed_calls: Vec::new(),
        }),
        "form_suggestion" => Some(GovernedProgramCatalogEntry {
            program_ref: FORM_SUGGESTION_PROGRAM_REF,
            graph: form_suggestion_graph(),
            review_independence_key: "RunReviewDisposition",
            reviewed_calls: Vec::new(),
        }),
        "action_draft_generation" => Some(GovernedProgramCatalogEntry {
            program_ref: ACTION_DRAFT_GENERATION_PROGRAM_REF,
            graph: action_draft_generation_graph(),
            review_independence_key: "RunReviewDisposition",
            reviewed_calls: Vec::new(),
        }),
        _ => None,
    }
}

fn named_read_call(tool_name: &str) -> PlannedToolCall {
    PlannedToolCall {
        tool_name: tool_name.to_string(),
        capability: Capability::NamedRead,
        named_resource: None,
    }
}

fn network_call(tool_name: &str) -> PlannedToolCall {
    PlannedToolCall {
        tool_name: tool_name.to_string(),
        capability: Capability::Network,
        named_resource: None,
    }
}

pub(super) fn process_research_graph() -> DecisionGraph {
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
                next: Some("erp_context".to_string()),
                kind: DecisionNode::Verify(VerifyNode {
                    source: "analytics".to_string(),
                }),
            },
            GraphNode {
                id: "erp_context".to_string(),
                depends_on: Vec::new(),
                next: Some("verify_context".to_string()),
                kind: DecisionNode::Capability(CapabilityNode {
                    capability: "erp_search".to_string(),
                }),
            },
            GraphNode {
                id: "verify_context".to_string(),
                depends_on: vec!["erp_context".to_string()],
                next: Some("generate".to_string()),
                kind: DecisionNode::Verify(VerifyNode {
                    source: "erp_context".to_string(),
                }),
            },
            GraphNode {
                id: "generate".to_string(),
                depends_on: vec!["analytics".to_string(), "erp_context".to_string()],
                next: None,
                kind: DecisionNode::Generate(GenerateNode {
                    format: "concise operations research summary identifying bottlenecks, delays, state distributions, and evidence-backed anomalies".to_string(),
                }),
            },
        ],
    }
}

pub(super) fn supplier_discovery_graph() -> DecisionGraph {
    DecisionGraph {
        entry: "erp_context".to_string(),
        nodes: vec![
            GraphNode {
                id: "erp_context".to_string(),
                depends_on: Vec::new(),
                next: Some("verify_erp".to_string()),
                kind: DecisionNode::Capability(CapabilityNode {
                    capability: "erp_search".to_string(),
                }),
            },
            GraphNode {
                id: "verify_erp".to_string(),
                depends_on: vec!["erp_context".to_string()],
                next: Some("web_candidates".to_string()),
                kind: DecisionNode::Verify(VerifyNode {
                    source: "erp_context".to_string(),
                }),
            },
            GraphNode {
                id: "web_candidates".to_string(),
                depends_on: Vec::new(),
                next: Some("verify_web".to_string()),
                kind: DecisionNode::Capability(CapabilityNode {
                    capability: "web_search".to_string(),
                }),
            },
            GraphNode {
                id: "verify_web".to_string(),
                depends_on: vec!["web_candidates".to_string()],
                next: Some("generate".to_string()),
                kind: DecisionNode::Verify(VerifyNode {
                    source: "web_candidates".to_string(),
                }),
            },
            GraphNode {
                id: "generate".to_string(),
                depends_on: vec!["erp_context".to_string(), "web_candidates".to_string()],
                next: None,
                kind: DecisionNode::Generate(GenerateNode {
                    format: "ranked supplier shortlist grounded in authorized ERP vendor context and retrieved web evidence, with credibility and region-fit caveats".to_string(),
                }),
            },
        ],
    }
}

pub(super) fn price_search_graph() -> DecisionGraph {
    DecisionGraph {
        entry: "erp_context".to_string(),
        nodes: vec![
            GraphNode {
                id: "erp_context".to_string(),
                depends_on: Vec::new(),
                next: Some("verify_erp".to_string()),
                kind: DecisionNode::Capability(CapabilityNode {
                    capability: "erp_search".to_string(),
                }),
            },
            GraphNode {
                id: "verify_erp".to_string(),
                depends_on: vec!["erp_context".to_string()],
                next: Some("web_prices".to_string()),
                kind: DecisionNode::Verify(VerifyNode {
                    source: "erp_context".to_string(),
                }),
            },
            GraphNode {
                id: "web_prices".to_string(),
                depends_on: Vec::new(),
                next: Some("verify_web".to_string()),
                kind: DecisionNode::Capability(CapabilityNode {
                    capability: "web_search".to_string(),
                }),
            },
            GraphNode {
                id: "verify_web".to_string(),
                depends_on: vec!["web_prices".to_string()],
                next: Some("generate".to_string()),
                kind: DecisionNode::Verify(VerifyNode {
                    source: "web_prices".to_string(),
                }),
            },
            GraphNode {
                id: "generate".to_string(),
                depends_on: vec!["erp_context".to_string(), "web_prices".to_string()],
                next: None,
                kind: DecisionNode::Generate(GenerateNode {
                    format: "procurement price comparison grounded in internal ERP context and cited external supplier evidence; do not create or execute a purchase order".to_string(),
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

    #[test]
    fn generation_surface_programs_are_catalogued_and_valid() {
        for (skill, expected_ref) in [
            ("rag_generation", RAG_GENERATION_PROGRAM_REF),
            ("form_suggestion", FORM_SUGGESTION_PROGRAM_REF),
            (
                "action_draft_generation",
                ACTION_DRAFT_GENERATION_PROGRAM_REF,
            ),
        ] {
            let entry = governed_program_for_skill(skill)
                .unwrap_or_else(|| panic!("{skill} must be in the governed program catalog"));
            assert_eq!(entry.program_ref, expected_ref);
            assert!(
                entry.reviewed_calls.is_empty(),
                "generation-only surfaces must not gain capability authority"
            );
            validate_graph(&entry.graph).unwrap();
            assert!(entry
                .graph
                .nodes
                .iter()
                .any(|node| matches!(node.kind, DecisionNode::Generate(_))));
            assert!(!entry.graph.nodes.iter().any(|node| matches!(
                node.kind,
                DecisionNode::Capability(_)
                    | DecisionNode::AcquireEvidence(_)
                    | DecisionNode::RequireApproval(_)
            )));
        }
    }

    #[test]
    fn first_gp17_programs_are_valid() {
        for skill in ["process_research", "supplier_discovery", "price_search"] {
            let entry = governed_program_for_skill(skill).unwrap();
            validate_graph(&entry.graph).unwrap();
            assert!(!entry.reviewed_calls.is_empty());
        }
    }
}
