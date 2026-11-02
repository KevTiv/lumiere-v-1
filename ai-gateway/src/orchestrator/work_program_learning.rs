//! Bounded observable learning records and zero-effect forensic comparison.
//!
//! This module does not dispatch providers, replay effects or approve knowledge.
//! Trusted readers must resolve and authorize every referenced record before
//! constructing a snapshot. Existing intelligence events remain provider audit
//! authority; observable nodes point at them instead of copying their payloads.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{bail, ensure, Result};
use serde::{Deserialize, Serialize};

const MAX_NODES: usize = 256;
const MAX_REFS: usize = 32;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ObservationOrigin {
    DeterministicRuntime,
    ProviderReported,
    HarnessObserved,
    ReviewerDerived,
    UserProvided,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ObservationKind {
    Fact,
    Evidence,
    Decision,
    Alternative,
    Uncertainty,
    ToolResult,
    Artifact,
    Outcome,
    Correction,
}

/// IDs and hashes only: private thought, raw rows and provider text are absent.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct ObservableNode {
    pub key: String,
    pub kind: ObservationKind,
    pub origin: ObservationOrigin,
    pub content_hash: String,
    pub parent_keys: Vec<String>,
    pub evidence_refs: Vec<String>,
    pub intelligence_event_id: Option<String>,
    pub corrects_key: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct ObservableRunSnapshot {
    pub organization_id: String,
    pub company_id: String,
    pub run_id: String,
    pub graph_hash: String,
    pub application_contract: String,
    pub nodes: Vec<ObservableNode>,
}

impl ObservableRunSnapshot {
    pub(crate) fn validate(&self) -> Result<()> {
        positive_id(&self.organization_id)?;
        positive_id(&self.company_id)?;
        positive_id(&self.run_id)?;
        hash(&self.graph_hash)?;
        bounded_key(&self.application_contract)?;
        ensure!(
            self.nodes.len() <= MAX_NODES,
            "observable node limit exceeded"
        );
        let mut seen = BTreeSet::new();
        for node in &self.nodes {
            bounded_key(&node.key)?;
            hash(&node.content_hash)?;
            ensure!(!seen.contains(&node.key), "duplicate observable node key");
            ensure!(
                node.parent_keys.len() <= MAX_REFS,
                "parent reference limit exceeded"
            );
            ensure!(
                node.evidence_refs.len() <= MAX_REFS,
                "evidence reference limit exceeded"
            );
            let mut parents = BTreeSet::new();
            for parent in &node.parent_keys {
                ensure!(seen.contains(parent), "parent must precede its child");
                ensure!(parents.insert(parent), "duplicate parent reference");
            }
            let mut refs = BTreeSet::new();
            for reference in &node.evidence_refs {
                evidence_reference(reference)?;
                ensure!(refs.insert(reference), "duplicate evidence reference");
            }
            if let Some(event) = &node.intelligence_event_id {
                positive_id(event)?;
            }
            if node.origin == ObservationOrigin::ProviderReported {
                ensure!(
                    node.intelligence_event_id.is_some(),
                    "provider observation needs canonical event reference"
                );
            }
            match (&node.kind, &node.corrects_key) {
                (ObservationKind::Correction, Some(target)) => {
                    ensure!(
                        seen.contains(target),
                        "correction target must precede correction"
                    );
                    ensure!(
                        node.parent_keys.contains(target),
                        "correction must retain target lineage"
                    );
                    ensure!(
                        matches!(
                            node.origin,
                            ObservationOrigin::UserProvided | ObservationOrigin::ReviewerDerived
                        ),
                        "correction needs attributable human provenance"
                    );
                }
                (ObservationKind::Correction, None) => bail!("correction target is required"),
                (_, Some(_)) => bail!("only correction nodes may name a correction target"),
                (_, None) => {}
            }
            seen.insert(node.key.clone());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ObservableDifference {
    pub node_key: String,
    pub change: &'static str,
}

/// Compare metadata from two already-authorized snapshots. There is no client,
/// token, execution callback or replay instruction in the returned report.
pub(crate) fn compare_forensic_snapshots(
    original: &ObservableRunSnapshot,
    candidate: &ObservableRunSnapshot,
) -> Result<Vec<ObservableDifference>> {
    original.validate()?;
    candidate.validate()?;
    ensure!(
        original.organization_id == candidate.organization_id
            && original.company_id == candidate.company_id,
        "comparison scope differs"
    );
    ensure!(
        original.run_id != candidate.run_id,
        "comparison requires distinct runs"
    );
    let before: BTreeMap<_, _> = original.nodes.iter().map(|n| (&n.key, n)).collect();
    let after: BTreeMap<_, _> = candidate.nodes.iter().map(|n| (&n.key, n)).collect();
    let keys: BTreeSet<_> = before.keys().chain(after.keys()).copied().collect();
    let mut differences = Vec::new();
    for key in keys {
        let change = match (before.get(key), after.get(key)) {
            (Some(left), Some(right)) if left == right => continue,
            (Some(_), Some(_)) => "changed",
            (Some(_), None) => "removed",
            (None, Some(_)) => "added",
            (None, None) => continue,
        };
        differences.push(ObservableDifference {
            node_key: key.clone(),
            change,
        });
    }
    if original.graph_hash != candidate.graph_hash
        || original.application_contract != candidate.application_contract
    {
        differences.insert(
            0,
            ObservableDifference {
                node_key: "$program".into(),
                change: "changed",
            },
        );
    }
    Ok(differences)
}

fn bounded_key(value: &str) -> Result<()> {
    ensure!(
        !value.is_empty()
            && value.len() <= 160
            && value.trim() == value
            && !value.chars().any(char::is_control),
        "invalid observable reference"
    );
    ensure!(value != "$program", "reserved observable key");
    Ok(())
}

fn positive_id(value: &str) -> Result<()> {
    let id = value.parse::<u64>()?;
    ensure!(
        id > 0 && id.to_string() == value,
        "noncanonical positive id"
    );
    Ok(())
}

fn evidence_reference(value: &str) -> Result<()> {
    let (kind, id) = value
        .split_once(':')
        .ok_or_else(|| anyhow::anyhow!("invalid canonical evidence reference"))?;
    ensure!(
        matches!(
            kind,
            "source"
                | "passage"
                | "claim"
                | "decision"
                | "artifact"
                | "knowledge_version"
                | "capability_execution"
                | "provider_attempt"
                | "run_step"
        ),
        "unknown evidence reference kind"
    );
    positive_id(id)
}

fn hash(value: &str) -> Result<()> {
    ensure!(
        value.len() == 64
            && value
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)),
        "invalid SHA-256 hash"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(run: &str) -> ObservableRunSnapshot {
        ObservableRunSnapshot {
            organization_id: "1".into(),
            company_id: "2".into(),
            run_id: run.into(),
            graph_hash: "a".repeat(64),
            application_contract: "0.3.163".into(),
            nodes: vec![ObservableNode {
                key: "source".into(),
                kind: ObservationKind::Fact,
                origin: ObservationOrigin::DeterministicRuntime,
                content_hash: "b".repeat(64),
                parent_keys: vec![],
                evidence_refs: vec!["passage:5".into()],
                intelligence_event_id: None,
                corrects_key: None,
            }],
        }
    }

    #[test]
    fn rejects_unattributed_provider_claims_and_noncanonical_ids() {
        let mut run = snapshot("3");
        run.nodes[0].origin = ObservationOrigin::ProviderReported;
        assert!(run.validate().is_err());
        run.nodes[0].intelligence_event_id = Some("7".into());
        assert!(run.validate().is_ok());
        run.run_id = "03".into();
        assert!(run.validate().is_err());
    }

    #[test]
    fn rejects_cycles_duplicate_keys_and_duplicate_refs() {
        let mut run = snapshot("3");
        run.nodes[0].parent_keys.push("source".into());
        assert!(run.validate().is_err());
        run.nodes[0].parent_keys.clear();
        run.nodes.push(run.nodes[0].clone());
        assert!(run.validate().is_err());
        run.nodes.pop();
        run.nodes[0].evidence_refs.push("passage:5".into());
        assert!(run.validate().is_err());
    }

    #[test]
    fn correction_keeps_original_and_requires_human_lineage() {
        let mut run = snapshot("3");
        let original = run.nodes[0].clone();
        run.nodes.push(ObservableNode {
            key: "correction".into(),
            kind: ObservationKind::Correction,
            origin: ObservationOrigin::UserProvided,
            content_hash: "c".repeat(64),
            parent_keys: vec!["source".into()],
            evidence_refs: vec![],
            intelligence_event_id: None,
            corrects_key: Some("source".into()),
        });
        assert!(run.validate().is_ok());
        assert_eq!(run.nodes[0], original);
        run.nodes[1].origin = ObservationOrigin::HarnessObserved;
        assert!(run.validate().is_err());
    }

    #[test]
    fn comparison_rejects_foreign_scope_and_same_run() {
        let before = snapshot("3");
        assert!(compare_forensic_snapshots(&before, &before).is_err());
        let mut after = snapshot("4");
        after.company_id = "99".into();
        assert!(compare_forensic_snapshots(&before, &after).is_err());
    }

    #[test]
    fn comparison_reports_lineage_changes_and_program_drift_without_effects() {
        let before = snapshot("3");
        let mut after = snapshot("4");
        assert!(compare_forensic_snapshots(&before, &after)
            .unwrap()
            .is_empty());
        after.nodes[0].evidence_refs = vec!["passage:6".into()];
        after.graph_hash = "d".repeat(64);
        let diff = compare_forensic_snapshots(&before, &after).unwrap();
        assert_eq!(diff.len(), 2);
        assert_eq!(diff[0].node_key, "$program");
        assert_eq!(diff[1].node_key, "source");
    }

    #[test]
    fn wire_rejects_payloads_and_authority_outside_closed_contract() {
        let mut value = serde_json::to_value(snapshot("3")).unwrap();
        value["providerToken"] = serde_json::json!("forged");
        assert!(serde_json::from_value::<ObservableRunSnapshot>(value).is_err());
        let mut value = serde_json::to_value(snapshot("3")).unwrap();
        value["nodes"][0]["rawThought"] = serde_json::json!("not observable evidence");
        assert!(serde_json::from_value::<ObservableRunSnapshot>(value).is_err());
    }
}
