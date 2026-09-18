//! GP-08 (governed intelligence program): typed DecisionGraph IR —
//! `typed-decision-graph-and-run-review-plan.md` §2 (TDG-02).
//!
//! This module defines the graph data model and its validator. It does
//! **not** execute a graph: walking a validated `DecisionGraph` and
//! dispatching each node to `GovernedCapabilityService` (GP-03),
//! `DecisionTypeRegistry` (GP-07), `PrecedentStore` (GP-06), etc. is GP-12's
//! job ("first production-shaped typed governed program"), which needs a
//! real chosen workflow to build against rather than a speculative
//! executor. GP-08's own acceptance bar is narrower and is what this module
//! delivers: add the node kinds, compile/validate a graph before execution,
//! and reject cycles unless they are explicit bounded constructs.
//!
//! The graph owns control flow; intelligence providers only satisfy the
//! typed uncertainty nodes (`Choice`/`Score`/`Probability`/`Reason`).
//! Nothing here lets a node's *runtime* output rewrite the graph's edges —
//! all edges (data dependencies and gate branches) are declared statically
//! by whoever authors the graph, not derived from a provider response.

use std::collections::{HashMap, HashSet};

use anyhow::{bail, Context, Result};

use super::intelligence::{DecisionKind, DecisionTypeRef};
use super::probabilistic::{CalibrationProfileRef, GateDecision, ThresholdGatePolicy};

pub(super) type NodeId = String;

/// Use whenever the answer can be derived from authoritative state without
/// model judgment (§2.1): sums, balances, date windows, exact statuses,
/// cardinality checks, policy/version comparisons, deterministic
/// thresholds. The IR does not embed executable code — `function_ref`
/// names a deterministic function the runtime resolves.
#[derive(Clone, Debug)]
pub(super) struct ComputeNode {
    pub function_ref: String,
}

#[derive(Clone, Debug)]
pub(super) struct ChoiceDecisionNode {
    pub decision_type: DecisionTypeRef,
    pub question: String,
    pub candidates: Vec<String>,
}

#[derive(Clone, Debug)]
pub(super) struct ScoreDecisionNode {
    pub decision_type: DecisionTypeRef,
    pub question: String,
}

#[derive(Clone, Debug)]
pub(super) struct ProbabilityDecisionNode {
    pub decision_type: DecisionTypeRef,
    pub question: String,
}

/// Independent typed questions over the same bounded state (§5). Members
/// must not depend on one another — the validator enforces that, not the
/// runtime.
#[derive(Clone, Debug)]
pub(super) struct DecisionBatchNode {
    pub members: Vec<NodeId>,
}

/// Fetches evidence only when needed, re-evaluating only the declared
/// affected nodes (§6) rather than the whole graph.
#[derive(Clone, Debug)]
pub(super) struct AcquireEvidenceNode {
    pub capability: String,
    pub max_rows: u32,
    pub affects: Vec<NodeId>,
}

/// A structural condition, not free code — the same reason `intelligence`'s
/// providers answer through typed tool calls rather than parsed prose.
#[derive(Clone, Debug)]
pub(super) enum GateCondition {
    ProbabilityAtLeast(f64),
    ProbabilityBelow(f64),
    ScoreAtLeast(f64),
    ScoreBelow(f64),
    ChoiceEquals(String),
    /// Routes through GP-09's typed `Confidence`/`ThresholdGatePolicy`
    /// instead of comparing a raw provider probability/score literal
    /// directly (what every other non-`Default` variant above still
    /// does): reads the gate source's `confidence` — never `probability`/
    /// `score`, which stay untouched provider metadata — as
    /// `Confidence::Raw`, calibrates it through `calibration_profile`
    /// first when one is named, evaluates `policy`, and matches this
    /// branch when the resulting `GateDecision` equals `on`. `policy` is
    /// program/policy-owned data the graph author writes, exactly like
    /// the literal thresholds elsewhere in this enum — never provider
    /// state.
    ThresholdPolicy {
        policy: ThresholdGatePolicy,
        calibration_profile: Option<CalibrationProfileRef>,
        on: GateDecision,
    },
    /// Matches when no other branch does. A gate must have exactly one.
    Default,
}

#[derive(Clone, Debug)]
pub(super) struct GateBranch {
    pub condition: GateCondition,
    pub target: NodeId,
}

/// Converts probabilistic/typed state into deterministic program control
/// (§4, §8). Thresholds live in the branch conditions the graph author
/// writes, never in the provider.
#[derive(Clone, Debug)]
pub(super) struct GateNode {
    /// The upstream `Choice`/`Score`/`Probability` node (or a
    /// `DecisionBatch` member) this gate reads.
    pub source: NodeId,
    pub branches: Vec<GateBranch>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum StopReason {
    AlreadySettled,
    WrongScope,
    DuplicateEffect,
    PolicyViolation,
    InsufficientEvidence,
}

/// Explicit, deterministic termination (§7). A model cannot override an
/// already-triggered stop — there is no node kind through which provider
/// output can remove or bypass this one.
#[derive(Clone, Debug)]
pub(super) struct EarlyStopNode {
    pub source: NodeId,
    pub reason: StopReason,
}

/// One generated ERP capability invocation. Routes through
/// `GovernedCapabilityService` (GP-03) when the graph executes — this node
/// only names which capability, never executes it itself.
#[derive(Clone, Debug)]
pub(super) struct CapabilityNode {
    pub capability: String,
}

/// Routes an upstream node's output through `VerificationService` (GP-03)
/// before it may be consumed downstream.
#[derive(Clone, Debug)]
pub(super) struct VerifyNode {
    pub source: NodeId,
}

/// Bounded proposal generation for when the typed graph genuinely cannot
/// resolve the state (architecture §9). `loop_back_to` is the *only*
/// mechanism through which the graph may contain a control-flow cycle, and
/// only when `max_iterations > 0` — see `validate_graph`. A `Reason` node
/// with no `loop_back_to` is a plain dead-end step, not a loop.
#[derive(Clone, Debug)]
pub(super) struct ReasonNode {
    pub allowed_proposal_kinds: Vec<String>,
    pub max_iterations: u32,
    pub loop_back_to: Option<NodeId>,
}

#[derive(Clone, Debug)]
pub(super) struct GenerateNode {
    pub format: String,
}

/// Routes an upstream node's output through human/policy-controlled
/// approval before it may take effect.
#[derive(Clone, Debug)]
pub(super) struct RequireApprovalNode {
    pub source: NodeId,
    /// Exact governed capability that may continue after human approval.
    pub capability: String,
}

#[derive(Clone, Debug)]
pub(super) enum DecisionNode {
    Compute(ComputeNode),
    Choice(ChoiceDecisionNode),
    Score(ScoreDecisionNode),
    Probability(ProbabilityDecisionNode),
    Batch(DecisionBatchNode),
    AcquireEvidence(AcquireEvidenceNode),
    Gate(GateNode),
    EarlyStop(EarlyStopNode),
    Capability(CapabilityNode),
    Verify(VerifyNode),
    Reason(ReasonNode),
    Generate(GenerateNode),
    RequireApproval(RequireApprovalNode),
}

impl DecisionNode {
    pub(super) fn label(&self) -> &'static str {
        match self {
            DecisionNode::Compute(_) => "compute",
            DecisionNode::Choice(_) => "choice",
            DecisionNode::Score(_) => "score",
            DecisionNode::Probability(_) => "probability",
            DecisionNode::Batch(_) => "batch",
            DecisionNode::AcquireEvidence(_) => "acquire_evidence",
            DecisionNode::Gate(_) => "gate",
            DecisionNode::EarlyStop(_) => "early_stop",
            DecisionNode::Capability(_) => "capability",
            DecisionNode::Verify(_) => "verify",
            DecisionNode::Reason(_) => "reason",
            DecisionNode::Generate(_) => "generate",
            DecisionNode::RequireApproval(_) => "require_approval",
        }
    }

    /// Whether a `GateNode` may read this node's output. Only nodes that
    /// produce a Choice/Score/Probability-shaped value qualify.
    fn is_gate_source_compatible(&self) -> bool {
        matches!(
            self,
            DecisionNode::Choice(_) | DecisionNode::Score(_) | DecisionNode::Probability(_)
        )
    }
}

#[derive(Clone, Debug)]
pub(super) struct GraphNode {
    pub id: NodeId,
    /// Data dependencies: nodes whose output this node consumes. This is
    /// the graph the deterministic-first/no-cycle rule applies to.
    pub depends_on: Vec<NodeId>,
    /// Normal deterministic control-flow successor. Gates choose one of
    /// their branch targets instead; bounded Reason nodes may loop through
    /// loop_back_to.
    pub next: Option<NodeId>,
    pub kind: DecisionNode,
}

#[derive(Clone, Debug)]
pub(super) struct DecisionGraph {
    pub nodes: Vec<GraphNode>,
    pub entry: NodeId,
}

impl DecisionGraph {
    pub(super) fn get(&self, id: &str) -> Option<&GraphNode> {
        self.nodes.iter().find(|n| n.id == id)
    }
}

/// Every gate-branch target and every `source`/`affects`/`members`
/// reference this node kind declares, collected uniformly so the validator
/// does not repeat the same "does this id exist" check per node kind.
fn referenced_ids(node: &GraphNode) -> Vec<&str> {
    let mut ids: Vec<&str> = node.depends_on.iter().map(String::as_str).collect();
    if let Some(next) = node.next.as_deref() {
        ids.push(next);
    }
    match &node.kind {
        DecisionNode::Batch(batch) => ids.extend(batch.members.iter().map(String::as_str)),
        DecisionNode::AcquireEvidence(evidence) => {
            ids.extend(evidence.affects.iter().map(String::as_str))
        }
        DecisionNode::Gate(gate) => {
            ids.push(&gate.source);
            ids.extend(gate.branches.iter().map(|b| b.target.as_str()));
        }
        DecisionNode::EarlyStop(stop) => ids.push(&stop.source),
        DecisionNode::Verify(verify) => ids.push(&verify.source),
        DecisionNode::RequireApproval(approval) => ids.push(&approval.source),
        DecisionNode::Reason(reason) => {
            if let Some(target) = &reason.loop_back_to {
                ids.push(target);
            }
        }
        DecisionNode::Compute(_)
        | DecisionNode::Choice(_)
        | DecisionNode::Score(_)
        | DecisionNode::Probability(_)
        | DecisionNode::Capability(_)
        | DecisionNode::Generate(_) => {}
    }
    ids
}

/// Control-flow edges: `Gate` branch targets, plus a `Reason` node's
/// `loop_back_to` when `max_iterations > 0`. These are allowed to form a
/// cycle, but only when every cycle they form passes through at least one
/// bounded `Reason` node (§2, "cycles only through explicit bounded
/// constructs") — a `Reason` node with `max_iterations == 0` contributes no
/// edge at all, so it cannot bound anything.
fn control_flow_edges(node: &GraphNode) -> Vec<&str> {
    let mut edges = node.next.as_deref().into_iter().collect::<Vec<_>>();
    match &node.kind {
        DecisionNode::Gate(gate) => {
            edges.clear();
            edges.extend(gate.branches.iter().map(|b| b.target.as_str()));
        }
        DecisionNode::Reason(reason) if reason.max_iterations > 0 => {
            if let Some(target) = reason.loop_back_to.as_deref() {
                edges.push(target);
            }
        }
        _ => {}
    }
    edges
}

/// Compiles/validates a `DecisionGraph` before it may execute (GP-08's
/// core requirement). Checks, in order: unique node ids, a resolvable
/// entry, every reference resolves to a real node, the data-dependency
/// graph (`depends_on`) is strictly acyclic, `DecisionBatch` members are
/// mutually independent, `Gate` sources are Choice/Score/Probability-
/// shaped, every `Gate` has exactly one `Default` branch, and any
/// control-flow cycle (through `Gate` branch targets) passes through a
/// bounded `Reason` node.
pub(super) fn validate_graph(graph: &DecisionGraph) -> Result<()> {
    if graph.nodes.is_empty() {
        bail!("decision graph must contain at least one node");
    }

    let mut seen = HashSet::with_capacity(graph.nodes.len());
    for node in &graph.nodes {
        if node.id.trim().is_empty() {
            bail!("node id must be nonempty");
        }
        if !seen.insert(node.id.as_str()) {
            bail!("duplicate node id '{}'", node.id);
        }
    }

    if graph.get(&graph.entry).is_none() {
        bail!("entry node '{}' does not exist", graph.entry);
    }

    let ids: HashSet<&str> = graph.nodes.iter().map(|n| n.id.as_str()).collect();
    for node in &graph.nodes {
        validate_node_contract(node)?;
        for referenced in referenced_ids(node) {
            if !ids.contains(referenced) {
                bail!(
                    "node '{}' references unknown node '{}'",
                    node.id,
                    referenced
                );
            }
        }
    }

    validate_acyclic_dependencies(graph)?;
    validate_batches_independent(graph)?;
    validate_gates(graph)?;
    validate_control_flow_cycles_are_bounded(graph)?;

    Ok(())
}


fn validate_node_contract(node: &GraphNode) -> Result<()> {
    if matches!(&node.kind, DecisionNode::Gate(_)) && node.next.is_some() {
        bail!("gate node '{}' must use branch targets instead of next", node.id);
    }
    match &node.kind {
        DecisionNode::Choice(decision) => {
            decision.decision_type.validate()?;
            if decision.question.trim().is_empty() {
                bail!("choice node '{}' must define a question", node.id);
            }
            if decision.candidates.len() < 2 {
                bail!("choice node '{}' must define at least two candidates", node.id);
            }
            let unique = decision
                .candidates
                .iter()
                .map(|candidate| candidate.trim())
                .collect::<HashSet<_>>();
            if unique.len() != decision.candidates.len() || unique.iter().any(|c| c.is_empty()) {
                bail!("choice node '{}' candidates must be nonempty and unique", node.id);
            }
        }
        DecisionNode::Score(decision) => {
            decision.decision_type.validate()?;
            if decision.question.trim().is_empty() {
                bail!("score node '{}' must define a question", node.id);
            }
        }
        DecisionNode::Probability(decision) => {
            decision.decision_type.validate()?;
            if decision.question.trim().is_empty() {
                bail!("probability node '{}' must define a question", node.id);
            }
        }
        DecisionNode::AcquireEvidence(acquire) => {
            if acquire.capability.trim().is_empty() {
                bail!("acquire evidence node '{}' must name a capability", node.id);
            }
            if acquire.max_rows == 0 {
                bail!("acquire evidence node '{}' max_rows must be positive", node.id);
            }
            if acquire.affects.is_empty() {
                bail!("acquire evidence node '{}' must declare at least one affected node", node.id);
            }
            let unique = acquire.affects.iter().collect::<HashSet<_>>();
            if unique.len() != acquire.affects.len() {
                bail!("acquire evidence node '{}' affects must be unique", node.id);
            }
            if acquire.affects.iter().any(|affected| affected == &node.id) {
                bail!("acquire evidence node '{}' cannot affect itself", node.id);
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_acyclic_dependencies(graph: &DecisionGraph) -> Result<()> {
    #[derive(Clone, Copy, PartialEq)]
    enum Mark {
        Visiting,
        Done,
    }
    let mut marks: HashMap<&str, Mark> = HashMap::new();

    fn visit<'a>(
        graph: &'a DecisionGraph,
        id: &'a str,
        marks: &mut HashMap<&'a str, Mark>,
        stack: &mut Vec<&'a str>,
    ) -> Result<()> {
        match marks.get(id) {
            Some(Mark::Done) => return Ok(()),
            Some(Mark::Visiting) => {
                stack.push(id);
                bail!("cyclic data dependency: {}", stack.join(" -> "));
            }
            None => {}
        }
        marks.insert(id, Mark::Visiting);
        stack.push(id);
        if let Some(node) = graph.get(id) {
            for dep in &node.depends_on {
                visit(graph, dep, marks, stack)?;
            }
        }
        stack.pop();
        marks.insert(id, Mark::Done);
        Ok(())
    }

    for node in &graph.nodes {
        let mut stack = Vec::new();
        visit(graph, &node.id, &mut marks, &mut stack)?;
    }
    Ok(())
}

fn validate_batches_independent(graph: &DecisionGraph) -> Result<()> {
    for node in &graph.nodes {
        let DecisionNode::Batch(batch) = &node.kind else {
            continue;
        };
        if batch.members.len() < 2 {
            bail!("decision batch '{}' requires at least two members", node.id);
        }
        let member_set: HashSet<&str> = batch.members.iter().map(String::as_str).collect();
        for member_id in &batch.members {
            let Some(member) = graph.get(member_id) else {
                continue; // already reported by referenced_ids check
            };
            if transitively_depends_on_any(graph, &member.id, &member_set) {
                bail!(
                    "decision batch '{}' member '{}' depends on another member — batch members must be independent",
                    node.id,
                    member_id
                );
            }
        }
    }
    Ok(())
}

fn transitively_depends_on_any(
    graph: &DecisionGraph,
    start: &str,
    targets: &HashSet<&str>,
) -> bool {
    let mut visited = HashSet::new();
    let mut stack = vec![start];
    while let Some(id) = stack.pop() {
        if !visited.insert(id) {
            continue;
        }
        let Some(node) = graph.get(id) else { continue };
        for dep in &node.depends_on {
            if targets.contains(dep.as_str()) {
                return true;
            }
            stack.push(dep.as_str());
        }
    }
    false
}

fn validate_gates(graph: &DecisionGraph) -> Result<()> {
    for node in &graph.nodes {
        let DecisionNode::Gate(gate) = &node.kind else {
            continue;
        };
        let Some(source) = graph.get(&gate.source) else {
            continue; // already reported by referenced_ids check
        };
        if !source.kind.is_gate_source_compatible() {
            bail!(
                "gate '{}' reads node '{}' of kind '{}', which is not Choice/Score/Probability-shaped",
                node.id,
                source.id,
                source.kind.label()
            );
        }
        if gate.branches.is_empty() {
            bail!("gate '{}' must declare at least one branch", node.id);
        }
        let default_count = gate
            .branches
            .iter()
            .filter(|b| matches!(b.condition, GateCondition::Default))
            .count();
        if default_count != 1 {
            bail!(
                "gate '{}' must declare exactly one Default branch, found {}",
                node.id,
                default_count
            );
        }
        for branch in &gate.branches {
            if let GateCondition::ThresholdPolicy {
                policy,
                calibration_profile,
                ..
            } = &branch.condition
            {
                policy
                    .validate()
                    .with_context(|| format!("gate '{}' threshold policy invalid", node.id))?;
                if let Some(profile_ref) = calibration_profile {
                    profile_ref.validate().with_context(|| {
                        format!("gate '{}' calibration profile ref invalid", node.id)
                    })?;
                }
            }
        }
    }
    Ok(())
}

/// Any cycle formed purely by `Gate` branch targets is rejected unless the
/// cycle passes through at least one `Reason` node with `max_iterations >
/// 0` — the only construct allowed to reintroduce a loop, and only a
/// bounded one.
fn validate_control_flow_cycles_are_bounded(graph: &DecisionGraph) -> Result<()> {
    #[derive(Clone, Copy, PartialEq)]
    enum Mark {
        Visiting,
        Done,
    }
    let mut marks: HashMap<&str, Mark> = HashMap::new();

    fn is_bounded_reason(graph: &DecisionGraph, id: &str) -> bool {
        matches!(
            graph.get(id).map(|n| &n.kind),
            Some(DecisionNode::Reason(r)) if r.max_iterations > 0
        )
    }

    fn visit<'a>(
        graph: &'a DecisionGraph,
        id: &'a str,
        marks: &mut HashMap<&'a str, Mark>,
        stack: &mut Vec<&'a str>,
    ) -> Result<()> {
        match marks.get(id) {
            Some(Mark::Done) => return Ok(()),
            Some(Mark::Visiting) => {
                stack.push(id);
                let cycle_has_bounded_reason = stack
                    .iter()
                    .any(|node_id| is_bounded_reason(graph, node_id));
                if !cycle_has_bounded_reason {
                    bail!(
                        "unbounded control-flow cycle: {} (add a Reason node with max_iterations > 0 to the cycle to make it explicit and bounded)",
                        stack.join(" -> ")
                    );
                }
                return Ok(());
            }
            None => {}
        }
        marks.insert(id, Mark::Visiting);
        stack.push(id);
        if let Some(node) = graph.get(id) {
            for next in control_flow_edges(node) {
                visit(graph, next, marks, stack)?;
            }
        }
        stack.pop();
        marks.insert(id, Mark::Done);
        Ok(())
    }

    for node in &graph.nodes {
        let mut stack = Vec::new();
        visit(graph, &node.id, &mut marks, &mut stack)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decision_type(name: &str) -> DecisionTypeRef {
        DecisionTypeRef {
            name: name.to_string(),
            version: 1,
        }
    }

    fn graph(nodes: Vec<GraphNode>, entry: &str) -> DecisionGraph {
        DecisionGraph {
            nodes,
            entry: entry.to_string(),
        }
    }

    fn compute(id: &str, depends_on: &[&str]) -> GraphNode {
        GraphNode {
            id: id.to_string(),
            depends_on: depends_on.iter().map(|s| s.to_string()).collect(),
            next: None,
            kind: DecisionNode::Compute(ComputeNode {
                function_ref: "sum_open_invoices".to_string(),
            }),
        }
    }

    fn probability(id: &str, depends_on: &[&str]) -> GraphNode {
        GraphNode {
            id: id.to_string(),
            depends_on: depends_on.iter().map(|s| s.to_string()).collect(),
            next: None,
            kind: DecisionNode::Probability(ProbabilityDecisionNode {
                decision_type: decision_type("FraudConcern"),
                question: "How likely is this transaction to be fraudulent?".to_string(),
            }),
        }
    }

    fn gate(id: &str, source: &str, branches: Vec<GateBranch>) -> GraphNode {
        GraphNode {
            id: id.to_string(),
            depends_on: vec![source.to_string()],
            next: None,
            kind: DecisionNode::Gate(GateNode {
                source: source.to_string(),
                branches,
            }),
        }
    }

    #[test]
    fn empty_graph_is_rejected() {
        let g = graph(vec![], "entry");
        assert!(validate_graph(&g).is_err());
    }

    #[test]
    fn unknown_entry_is_rejected() {
        let g = graph(vec![compute("a", &[])], "missing");
        assert!(validate_graph(&g).is_err());
    }

    #[test]
    fn duplicate_node_ids_are_rejected() {
        let g = graph(vec![compute("a", &[]), compute("a", &[])], "a");
        assert!(validate_graph(&g).is_err());
    }

    #[test]
    fn dangling_dependency_reference_is_rejected() {
        let g = graph(vec![compute("a", &["missing"])], "a");
        assert!(validate_graph(&g).is_err());
    }

    #[test]
    fn a_valid_linear_graph_passes() {
        let g = graph(
            vec![compute("facts", &[]), probability("risk", &["facts"])],
            "facts",
        );
        assert!(validate_graph(&g).is_ok());
    }

    #[test]
    fn direct_dependency_cycle_is_rejected() {
        let g = graph(vec![compute("a", &["b"]), compute("b", &["a"])], "a");
        let err = validate_graph(&g).unwrap_err().to_string();
        assert!(err.contains("cyclic data dependency"), "{err}");
    }

    #[test]
    fn self_dependency_is_rejected() {
        let g = graph(vec![compute("a", &["a"])], "a");
        assert!(validate_graph(&g).is_err());
    }

    #[test]
    fn indirect_dependency_cycle_is_rejected() {
        let g = graph(
            vec![
                compute("a", &["c"]),
                compute("b", &["a"]),
                compute("c", &["b"]),
            ],
            "a",
        );
        assert!(validate_graph(&g).is_err());
    }

    #[test]
    fn batch_requires_at_least_two_members() {
        let g = graph(
            vec![
                compute("facts", &[]),
                probability("only_one", &["facts"]),
                GraphNode {
                    id: "batch".to_string(),
                    depends_on: vec![],
            next: None,
                    kind: DecisionNode::Batch(DecisionBatchNode {
                        members: vec!["only_one".to_string()],
                    }),
                },
            ],
            "facts",
        );
        assert!(validate_graph(&g).is_err());
    }

    #[test]
    fn batch_members_must_be_mutually_independent() {
        let g = graph(
            vec![
                compute("facts", &[]),
                probability("q1", &["facts"]),
                probability("q2", &["q1"]), // depends on a fellow batch member
                GraphNode {
                    id: "batch".to_string(),
                    depends_on: vec![],
            next: None,
                    kind: DecisionNode::Batch(DecisionBatchNode {
                        members: vec!["q1".to_string(), "q2".to_string()],
                    }),
                },
            ],
            "facts",
        );
        let err = validate_graph(&g).unwrap_err().to_string();
        assert!(err.contains("must be independent"), "{err}");
    }

    #[test]
    fn independent_batch_members_pass() {
        let g = graph(
            vec![
                compute("facts", &[]),
                probability("q1", &["facts"]),
                probability("q2", &["facts"]),
                GraphNode {
                    id: "batch".to_string(),
                    depends_on: vec![],
            next: None,
                    kind: DecisionNode::Batch(DecisionBatchNode {
                        members: vec!["q1".to_string(), "q2".to_string()],
                    }),
                },
            ],
            "facts",
        );
        assert!(validate_graph(&g).is_ok());
    }

    #[test]
    fn gate_source_must_be_choice_score_or_probability() {
        let g = graph(
            vec![
                compute("facts", &[]),
                gate(
                    "route",
                    "facts",
                    vec![GateBranch {
                        condition: GateCondition::Default,
                        target: "facts".to_string(),
                    }],
                ),
            ],
            "facts",
        );
        let err = validate_graph(&g).unwrap_err().to_string();
        assert!(err.contains("not Choice/Score/Probability-shaped"), "{err}");
    }

    #[test]
    fn gate_requires_exactly_one_default_branch() {
        let g = graph(
            vec![
                compute("facts", &[]),
                probability("risk", &["facts"]),
                gate(
                    "route",
                    "risk",
                    vec![GateBranch {
                        condition: GateCondition::ProbabilityAtLeast(0.8),
                        target: "risk".to_string(),
                    }],
                ),
            ],
            "facts",
        );
        let err = validate_graph(&g).unwrap_err().to_string();
        assert!(err.contains("exactly one Default branch"), "{err}");
    }

    #[test]
    fn gate_requires_at_least_one_branch() {
        let g = graph(
            vec![
                compute("facts", &[]),
                probability("risk", &["facts"]),
                gate("route", "risk", vec![]),
            ],
            "facts",
        );
        assert!(validate_graph(&g).is_err());
    }

    #[test]
    fn threshold_policy_gate_with_valid_policy_passes() {
        let g = graph(
            vec![
                compute("facts", &[]),
                probability("risk", &["facts"]),
                gate(
                    "route",
                    "risk",
                    vec![
                        GateBranch {
                            condition: GateCondition::ThresholdPolicy {
                                policy: ThresholdGatePolicy {
                                    name: "fraud-review".to_string(),
                                    hard_stop_at_least: Some(0.8),
                                    continue_below: Some(0.2),
                                    require_calibrated: true,
                                },
                                calibration_profile: Some(CalibrationProfileRef {
                                    name: "fraud-model".to_string(),
                                    version: 1,
                                }),
                                on: GateDecision::Escalate,
                            },
                            target: "risk".to_string(),
                        },
                        GateBranch {
                            condition: GateCondition::Default,
                            target: "risk".to_string(),
                        },
                    ],
                ),
            ],
            "facts",
        );
        assert!(validate_graph(&g).is_ok());
    }

    #[test]
    fn threshold_policy_gate_rejects_an_invalid_policy() {
        let g = graph(
            vec![
                compute("facts", &[]),
                probability("risk", &["facts"]),
                gate(
                    "route",
                    "risk",
                    vec![
                        GateBranch {
                            condition: GateCondition::ThresholdPolicy {
                                policy: ThresholdGatePolicy {
                                    name: String::new(),
                                    hard_stop_at_least: Some(0.8),
                                    continue_below: Some(0.2),
                                    require_calibrated: false,
                                },
                                calibration_profile: None,
                                on: GateDecision::Escalate,
                            },
                            target: "risk".to_string(),
                        },
                        GateBranch {
                            condition: GateCondition::Default,
                            target: "risk".to_string(),
                        },
                    ],
                ),
            ],
            "facts",
        );
        let err = validate_graph(&g).unwrap_err().to_string();
        assert!(err.contains("threshold policy invalid"), "{err}");
    }

    #[test]
    fn threshold_policy_gate_rejects_an_invalid_calibration_profile_ref() {
        let g = graph(
            vec![
                compute("facts", &[]),
                probability("risk", &["facts"]),
                gate(
                    "route",
                    "risk",
                    vec![
                        GateBranch {
                            condition: GateCondition::ThresholdPolicy {
                                policy: ThresholdGatePolicy {
                                    name: "fraud-review".to_string(),
                                    hard_stop_at_least: Some(0.8),
                                    continue_below: Some(0.2),
                                    require_calibrated: true,
                                },
                                calibration_profile: Some(CalibrationProfileRef {
                                    name: "fraud-model".to_string(),
                                    version: 0,
                                }),
                                on: GateDecision::Escalate,
                            },
                            target: "risk".to_string(),
                        },
                        GateBranch {
                            condition: GateCondition::Default,
                            target: "risk".to_string(),
                        },
                    ],
                ),
            ],
            "facts",
        );
        let err = validate_graph(&g).unwrap_err().to_string();
        assert!(err.contains("calibration profile ref invalid"), "{err}");
    }

    #[test]
    fn unbounded_control_flow_cycle_is_rejected() {
        // route_a -(Default)-> route_b -(Default)-> route_a: a control-flow
        // cycle with no Reason node anywhere in it.
        let g = graph(
            vec![
                compute("facts", &[]),
                probability("risk", &["facts"]),
                GraphNode {
                    id: "route_a".to_string(),
                    depends_on: vec!["risk".to_string()],
            next: None,
                    kind: DecisionNode::Gate(GateNode {
                        source: "risk".to_string(),
                        branches: vec![GateBranch {
                            condition: GateCondition::Default,
                            target: "route_b".to_string(),
                        }],
                    }),
                },
                GraphNode {
                    id: "route_b".to_string(),
                    depends_on: vec!["risk".to_string()],
            next: None,
                    kind: DecisionNode::Gate(GateNode {
                        source: "risk".to_string(),
                        branches: vec![GateBranch {
                            condition: GateCondition::Default,
                            target: "route_a".to_string(),
                        }],
                    }),
                },
            ],
            "facts",
        );
        let err = validate_graph(&g).unwrap_err().to_string();
        assert!(err.contains("unbounded control-flow cycle"), "{err}");
    }

    #[test]
    fn control_flow_cycle_through_a_bounded_reason_node_is_allowed() {
        // route -> reason -> route: a genuine cycle, but reason bounds it
        // with max_iterations > 0.
        let g = graph(
            vec![
                compute("facts", &[]),
                probability("risk", &["facts"]),
                gate(
                    "route",
                    "risk",
                    vec![
                        GateBranch {
                            condition: GateCondition::ProbabilityBelow(0.5),
                            target: "reason".to_string(),
                        },
                        GateBranch {
                            condition: GateCondition::Default,
                            target: "risk".to_string(),
                        },
                    ],
                ),
                GraphNode {
                    id: "reason".to_string(),
                    depends_on: vec![],
            next: None,
                    kind: DecisionNode::Reason(ReasonNode {
                        allowed_proposal_kinds: vec!["clarification".to_string()],
                        max_iterations: 3,
                        loop_back_to: Some("route".to_string()),
                    }),
                },
            ],
            "facts",
        );
        assert!(validate_graph(&g).is_ok());
    }

    #[test]
    fn reason_node_with_zero_max_iterations_contributes_no_control_flow_edge() {
        // route -> reason, with reason's loop_back_to pointing back to
        // route. max_iterations == 0 means reason contributes no outgoing
        // control-flow edge at all, so this is a dead end, not a cycle —
        // it is a Reason node's *presence* on a cycle that must be bounded
        // to be allowed, and an unbounded Reason simply cannot form one.
        // The true unbounded-cycle rejection is
        // `unbounded_control_flow_cycle_is_rejected`, which has no Reason
        // node involved at all.
        let g = graph(
            vec![
                compute("facts", &[]),
                probability("risk", &["facts"]),
                gate(
                    "route",
                    "risk",
                    vec![GateBranch {
                        condition: GateCondition::Default,
                        target: "reason".to_string(),
                    }],
                ),
                GraphNode {
                    id: "reason".to_string(),
                    depends_on: vec![],
            next: None,
                    kind: DecisionNode::Reason(ReasonNode {
                        allowed_proposal_kinds: vec!["clarification".to_string()],
                        max_iterations: 0,
                        loop_back_to: Some("route".to_string()),
                    }),
                },
            ],
            "facts",
        );
        assert!(validate_graph(&g).is_ok());
    }

    #[test]
    fn early_stop_source_must_resolve() {
        let g = graph(
            vec![GraphNode {
                id: "stop".to_string(),
                depends_on: vec![],
            next: None,
                kind: DecisionNode::EarlyStop(EarlyStopNode {
                    source: "missing".to_string(),
                    reason: StopReason::AlreadySettled,
                }),
            }],
            "stop",
        );
        assert!(validate_graph(&g).is_err());
    }

    #[test]
    fn capability_and_generate_nodes_validate_with_no_extra_references() {
        let g = graph(
            vec![
                GraphNode {
                    id: "capability".to_string(),
                    depends_on: vec![],
            next: None,
                    kind: DecisionNode::Capability(CapabilityNode {
                        capability: "erp.search".to_string(),
                    }),
                },
                GraphNode {
                    id: "generate".to_string(),
                    depends_on: vec!["capability".to_string()],
            next: None,
                    kind: DecisionNode::Generate(GenerateNode {
                        format: "prose".to_string(),
                    }),
                },
            ],
            "capability",
        );
        assert!(validate_graph(&g).is_ok());
    }

    #[test]
    fn verify_and_require_approval_sources_must_resolve() {
        let capability = GraphNode {
            id: "capability".to_string(),
            depends_on: vec![],
            next: None,
            kind: DecisionNode::Capability(CapabilityNode {
                capability: "erp.mutate".to_string(),
            }),
        };
        let verify = GraphNode {
            id: "verify".to_string(),
            depends_on: vec!["capability".to_string()],
            next: None,
            kind: DecisionNode::Verify(VerifyNode {
                source: "capability".to_string(),
            }),
        };
        let approval = GraphNode {
            id: "approval".to_string(),
            depends_on: vec!["verify".to_string()],
            next: None,
            kind: DecisionNode::RequireApproval(RequireApprovalNode {
                source: "verify".to_string(),
                capability: "test_mutation".to_string(),
            }),
        };
        let g = graph(vec![capability, verify, approval], "capability");
        assert!(validate_graph(&g).is_ok());

        let mut broken = g.clone();
        broken.nodes[2].kind = DecisionNode::RequireApproval(RequireApprovalNode {
            source: "missing".to_string(),
            capability: "test_mutation".to_string(),
        });
        assert!(validate_graph(&broken).is_err());
    }

    #[test]
    fn acquire_evidence_affects_must_resolve() {
        let g = graph(
            vec![
                compute("facts", &[]),
                GraphNode {
                    id: "evidence".to_string(),
                    depends_on: vec![],
            next: None,
                    kind: DecisionNode::AcquireEvidence(AcquireEvidenceNode {
                        capability: "erp.search".to_string(),
                        max_rows: 50,
                        affects: vec!["facts".to_string()],
                    }),
                },
            ],
            "facts",
        );
        assert!(validate_graph(&g).is_ok());

        let mut broken = g.clone();
        broken.nodes[1].kind = DecisionNode::AcquireEvidence(AcquireEvidenceNode {
            capability: "erp.search".to_string(),
            max_rows: 50,
            affects: vec!["missing".to_string()],
        });
        assert!(validate_graph(&broken).is_err());
    }
}
