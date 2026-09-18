//! Reviewed production-shaped governed programs.
//!
//! Known ERP workflows belong here as explicit typed graphs. Providers never
//! author these graphs at runtime.

use super::{
    decision_graph::{
        CapabilityNode, DecisionGraph, DecisionNode, GateBranch, GateCondition, GateNode,
        GenerateNode, GraphNode, ProbabilityDecisionNode, VerifyNode,
    },
    intelligence::{DecisionTypeRef},
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
                            condition: GateCondition::ProbabilityAtLeast(0.65),
                            target: "generate_attention".to_string(),
                        },
                        GateBranch {
                            condition: GateCondition::Default,
                            target: "generate_summary".to_string(),
                        },
                    ],
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::orchestrator::decision_graph::validate_graph;

    #[test]
    fn report_analysis_program_is_valid() {
        validate_graph(&report_analysis_graph()).unwrap();
    }
}
