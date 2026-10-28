//! Budgeted handoff on provider fallback (plan section 7.5).
//!
//! [`select_handoff`] is pure and deterministic. It keeps, in priority order,
//! the objective, decision-graph state, admitted evidence references and as
//! many recent turns as fit a token budget, and records everything dropped.
//! Pending approvals, uncertain effects and raw provider reasoning never cross.

use serde::Serialize;

use super::instance::SelectionRecord;

pub const HANDOFF_SELECTION_POLICY: &str =
    "objective>graph_state>admitted_evidence>recent_turns_newest_first/v1";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnKind {
    Message,
    PendingApproval,
    UncertainEffect,
    ProviderReasoning,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct HandoffItem {
    pub id: String,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct EvidenceRef {
    pub reference: String,
    pub admitted: bool,
    pub tokens: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct HandoffTurn {
    pub id: String,
    pub kind: TurnKind,
    pub text: String,
}

/// `recent_turns` are chronological (oldest first).
#[derive(Clone, Debug, Default)]
pub struct HandoffInput {
    pub objective: String,
    pub graph_state: Vec<HandoffItem>,
    pub evidence_refs: Vec<EvidenceRef>,
    pub recent_turns: Vec<HandoffTurn>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DropReason {
    OverBudget,
    NotAdmitted,
    NeverCrosses,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DroppedKind {
    GraphState,
    Evidence,
    Turn,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Dropped {
    pub kind: DroppedKind,
    pub id: String,
    pub reason: DropReason,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct HandoffRecord {
    pub source_instance: String,
    pub target_instance: String,
    pub selection_policy: String,
    pub token_budget: u32,
    pub tokens_used: u32,
    pub objective: String,
    pub graph_state: Vec<HandoffItem>,
    pub evidence_refs: Vec<String>,
    pub recent_turns: Vec<HandoffTurn>,
    pub dropped: Vec<Dropped>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum HandoffError {
    #[error("objective alone exceeds the handoff token budget")]
    ObjectiveExceedsBudget,
    #[error("handoff would cross the {0} boundary")]
    BoundaryCrossed(&'static str),
}

/// Deterministic estimate: ceil(chars / 4).
pub fn estimate_tokens(text: &str) -> u32 {
    (text.chars().count() as u32).div_ceil(4)
}

pub fn select_handoff(
    source_instance: &str,
    target_instance: &str,
    input: &HandoffInput,
    token_budget: u32,
) -> Result<HandoffRecord, HandoffError> {
    let mut used = estimate_tokens(&input.objective);
    if used > token_budget {
        return Err(HandoffError::ObjectiveExceedsBudget);
    }
    let mut dropped = Vec::new();

    let mut graph_state = Vec::new();
    for item in &input.graph_state {
        let cost = estimate_tokens(&item.text);
        if used.saturating_add(cost) <= token_budget {
            used += cost;
            graph_state.push(item.clone());
        } else {
            dropped.push(Dropped {
                kind: DroppedKind::GraphState,
                id: item.id.clone(),
                reason: DropReason::OverBudget,
            });
        }
    }

    let mut evidence_refs = Vec::new();
    for evidence in &input.evidence_refs {
        let reason = if !evidence.admitted {
            Some(DropReason::NotAdmitted)
        } else if used.saturating_add(evidence.tokens) > token_budget {
            Some(DropReason::OverBudget)
        } else {
            None
        };
        match reason {
            Some(reason) => dropped.push(Dropped {
                kind: DroppedKind::Evidence,
                id: evidence.reference.clone(),
                reason,
            }),
            None => {
                used += evidence.tokens;
                evidence_refs.push(evidence.reference.clone());
            }
        }
    }

    // Newest first; once one turn does not fit, every older turn is dropped so
    // the carried history stays contiguous.
    let mut kept_rev = Vec::new();
    let mut budget_exhausted = false;
    for turn in input.recent_turns.iter().rev() {
        if turn.kind != TurnKind::Message {
            dropped.push(Dropped {
                kind: DroppedKind::Turn,
                id: turn.id.clone(),
                reason: DropReason::NeverCrosses,
            });
            continue;
        }
        let cost = estimate_tokens(&turn.text);
        if !budget_exhausted && used.saturating_add(cost) <= token_budget {
            used += cost;
            kept_rev.push(turn.clone());
        } else {
            budget_exhausted = true;
            dropped.push(Dropped {
                kind: DroppedKind::Turn,
                id: turn.id.clone(),
                reason: DropReason::OverBudget,
            });
        }
    }
    kept_rev.reverse();

    Ok(HandoffRecord {
        source_instance: source_instance.to_string(),
        target_instance: target_instance.to_string(),
        selection_policy: HANDOFF_SELECTION_POLICY.to_string(),
        token_budget,
        tokens_used: used,
        objective: input.objective.clone(),
        graph_state,
        evidence_refs,
        recent_turns: kept_rev,
        dropped,
    })
}

/// Handoff for a fallback selection. Refuses to carry context across an
/// organization, region or shared-budget boundary.
pub fn handoff_for_fallback(
    source: &SelectionRecord,
    target: &SelectionRecord,
    input: &HandoffInput,
    token_budget: u32,
) -> Result<HandoffRecord, HandoffError> {
    if source.instance_organization_id != target.instance_organization_id
        || source.organization_id != target.organization_id
    {
        return Err(HandoffError::BoundaryCrossed("organization"));
    }
    if source.region != target.region {
        return Err(HandoffError::BoundaryCrossed("region"));
    }
    if source.budget_scope != target.budget_scope {
        return Err(HandoffError::BoundaryCrossed("budget"));
    }
    select_handoff(
        &source.instance_id,
        &target.instance_id,
        input,
        token_budget,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::instance::{ProviderDriver, SelectionReason};

    fn turn(id: &str, kind: TurnKind, text: &str) -> HandoffTurn {
        HandoffTurn {
            id: id.into(),
            kind,
            text: text.into(),
        }
    }

    fn input() -> HandoffInput {
        HandoffInput {
            objective: "find low stock".into(), // 4 tokens
            graph_state: vec![HandoffItem {
                id: "n1".into(),
                text: "node one state".into(), // 4
            }],
            evidence_refs: vec![
                EvidenceRef {
                    reference: "ev-1".into(),
                    admitted: true,
                    tokens: 2,
                },
                EvidenceRef {
                    reference: "ev-2".into(),
                    admitted: false,
                    tokens: 2,
                },
            ],
            recent_turns: vec![
                turn("t1", TurnKind::Message, "aaaaaaaaaaaaaaaa"), // 4
                turn("t2", TurnKind::PendingApproval, "approve po"),
                turn("t3", TurnKind::ProviderReasoning, "secret chain"),
                turn("t4", TurnKind::UncertainEffect, "maybe sent"),
                turn("t5", TurnKind::Message, "bbbbbbbb"), // 2
            ],
        }
    }

    #[test]
    fn handoff_is_deterministic_and_never_carries_forbidden_kinds() {
        let a = select_handoff("a", "b", &input(), 100).unwrap();
        let b = select_handoff("a", "b", &input(), 100).unwrap();
        assert_eq!(a, b);
        assert_eq!(a.selection_policy, HANDOFF_SELECTION_POLICY);
        assert_eq!(a.evidence_refs, vec!["ev-1"]);
        assert_eq!(
            a.recent_turns
                .iter()
                .map(|t| t.id.as_str())
                .collect::<Vec<_>>(),
            vec!["t1", "t5"]
        );
        let never: Vec<_> = a
            .dropped
            .iter()
            .filter(|d| d.reason == DropReason::NeverCrosses)
            .map(|d| d.id.as_str())
            .collect();
        assert_eq!(never, vec!["t4", "t3", "t2"]);
        assert!(a
            .dropped
            .iter()
            .any(|d| d.id == "ev-2" && d.reason == DropReason::NotAdmitted));
        assert_eq!(a.tokens_used, 4 + 4 + 2 + 4 + 2);
    }

    #[test]
    fn handoff_records_budget_drops_and_keeps_history_contiguous() {
        // objective 4 + graph 4 + ev-1 2 + t5 2 = 12; t1 (4) does not fit in 13.
        let record = select_handoff("a", "b", &input(), 13).unwrap();
        assert_eq!(record.tokens_used, 12);
        assert!(record.tokens_used <= record.token_budget);
        assert_eq!(record.recent_turns.len(), 1);
        assert!(record
            .dropped
            .iter()
            .any(|d| d.id == "t1" && d.reason == DropReason::OverBudget));

        let tight = select_handoff("a", "b", &input(), 5).unwrap();
        assert!(tight.graph_state.is_empty());
        assert!(tight
            .dropped
            .iter()
            .any(|d| d.id == "n1" && d.reason == DropReason::OverBudget));
        assert!(tight.recent_turns.is_empty());

        assert_eq!(
            select_handoff("a", "b", &input(), 3).unwrap_err(),
            HandoffError::ObjectiveExceedsBudget
        );
    }

    #[test]
    fn fallback_handoff_refuses_boundary_crossing() {
        let record = |id: &str, org: Option<u64>, region: &str, budget: &str| SelectionRecord {
            driver: ProviderDriver::Mistral,
            instance_id: id.into(),
            instance_organization_id: org,
            organization_id: 1,
            model: "m".into(),
            region: Some(region.into()),
            budget_scope: Some(budget.into()),
            reason: SelectionReason::Preferred,
            policy_reason: String::new(),
            pricing_snapshot_ref: None,
            capability_revision: 1,
            fallback_of: None,
            excluded: vec![],
        };
        let src = record("a", Some(1), "eu", "b1");
        let ok =
            handoff_for_fallback(&src, &record("b", Some(1), "eu", "b1"), &input(), 100).unwrap();
        assert_eq!(
            (ok.source_instance.as_str(), ok.target_instance.as_str()),
            ("a", "b")
        );
        for (target, boundary) in [
            (record("b", Some(2), "eu", "b1"), "organization"),
            (record("b", Some(1), "us", "b1"), "region"),
            (record("b", Some(1), "eu", "b2"), "budget"),
        ] {
            assert_eq!(
                handoff_for_fallback(&src, &target, &input(), 100).unwrap_err(),
                HandoffError::BoundaryCrossed(boundary)
            );
        }
    }
}
