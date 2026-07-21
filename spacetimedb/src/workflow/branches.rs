//! Structured XOR/OR/AND fork and join evidence (WF-07).
//!
//! Token mutations live in `runtime` to avoid a module cycle. This module owns
//! fork/arrival tables and pure edge-selection helpers.

use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use super::definitions::{
    workflow_edge, workflow_node, WorkflowBranchKind, WorkflowEdge, WorkflowNode, WorkflowNodeKind,
};
use super::evaluator::{evaluate_condition_program, ConditionSnapshot};

// ============================================================================
// TABLES
// ============================================================================

#[derive(Clone, Debug)]
#[spacetimedb::table(
    accessor = workflow_fork,
    index(accessor = workflow_fork_by_org, btree(columns = [organization_id])),
    index(accessor = workflow_fork_by_instance, btree(columns = [instance_id])),
    index(accessor = workflow_fork_by_node, btree(columns = [fork_node_key]))
)]
pub struct WorkflowFork {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub instance_id: u64,
    pub workflow_version_id: u64,
    pub fork_node_key: String,
    pub join_node_key: Option<String>,
    pub split_kind: WorkflowBranchKind,
    /// Branch keys that must arrive for AND / that were emitted for OR/XOR.
    pub expected_branch_keys: Vec<String>,
    pub emitted_branch_keys: Vec<String>,
    pub open: bool,
    pub revision: u64,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub closed_at: Option<Timestamp>,
}

#[derive(Clone, Debug)]
#[spacetimedb::table(
    accessor = workflow_join_arrival,
    index(accessor = workflow_join_arrival_by_fork, btree(columns = [fork_id])),
    index(
        accessor = workflow_join_arrival_by_unique,
        btree(columns = [fork_id, join_node_key, branch_key])
    )
)]
pub struct WorkflowJoinArrival {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub instance_id: u64,
    pub fork_id: u64,
    pub join_node_key: String,
    pub branch_key: String,
    pub arrival_token_id: u64,
    pub recorded_by: Identity,
    pub recorded_at: Timestamp,
}

// ============================================================================
// PURE / EVIDENCE HELPERS
// ============================================================================

/// Select outgoing fork edges per XOR/OR/AND rules.
pub(crate) fn select_fork_edges<'a>(
    fork: &WorkflowNode,
    edges: &[&'a WorkflowEdge],
    snapshot_fields: &[super::definitions::ConditionFieldDefinition],
    snapshot: Option<&ConditionSnapshot>,
) -> Result<Vec<&'a WorkflowEdge>, String> {
    if fork.kind != WorkflowNodeKind::Fork {
        return Err("select_fork_edges requires a Fork node".to_string());
    }
    let mut ordered: Vec<&WorkflowEdge> = edges
        .iter()
        .copied()
        .filter(|edge| edge.from_node_key == fork.node_key)
        .collect();
    ordered.sort_by(|a, b| {
        a.sequence
            .cmp(&b.sequence)
            .then_with(|| a.edge_key.cmp(&b.edge_key))
    });
    if ordered.len() < 2 {
        return Err(format!(
            "Fork '{}' needs at least two outgoing edges",
            fork.node_key
        ));
    }

    let mut matched = Vec::new();
    for edge in ordered {
        let passes = match edge.condition.as_ref() {
            None => true,
            Some(program) => {
                let Some(snapshot) = snapshot else {
                    return Err(format!(
                        "Fork '{}' edge '{}' has a condition but no snapshot was supplied",
                        fork.node_key, edge.edge_key
                    ));
                };
                evaluate_condition_program(program, snapshot_fields, snapshot).map_err(|error| {
                    format!(
                        "fork condition failed on edge '{}': {error}",
                        edge.edge_key
                    )
                })?
            }
        };
        if passes {
            matched.push(edge);
        }
    }

    let declared = edges
        .iter()
        .filter(|edge| edge.from_node_key == fork.node_key)
        .count();
    match fork.split_kind {
        WorkflowBranchKind::Xor => matched
            .into_iter()
            .next()
            .map(|edge| vec![edge])
            .ok_or_else(|| format!("XOR Fork '{}' matched no outgoing edge", fork.node_key)),
        WorkflowBranchKind::Or => {
            if matched.is_empty() {
                return Err(format!("OR Fork '{}' matched no outgoing edge", fork.node_key));
            }
            Ok(matched)
        }
        WorkflowBranchKind::And => {
            if matched.len() != declared {
                return Err(format!(
                    "AND Fork '{}' requires every outgoing edge to match",
                    fork.node_key
                ));
            }
            Ok(matched)
        }
        WorkflowBranchKind::None => Err("Fork split kind must not be None".to_string()),
    }
}

/// Record a unique join arrival. Returns `true` when this call newly recorded.
pub(crate) fn record_join_arrival(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    instance_id: u64,
    fork: &WorkflowFork,
    join_node_key: &str,
    branch_key: &str,
    arrival_token_id: u64,
) -> Result<(WorkflowJoinArrival, bool), String> {
    if let Some(existing) = ctx
        .db
        .workflow_join_arrival()
        .workflow_join_arrival_by_unique()
        .filter((&fork.id, &join_node_key.to_string(), &branch_key.to_string()))
        .next()
    {
        return Ok((existing, false));
    }
    let arrival = ctx.db.workflow_join_arrival().insert(WorkflowJoinArrival {
        id: 0,
        organization_id,
        company_id,
        instance_id,
        fork_id: fork.id,
        join_node_key: join_node_key.to_string(),
        branch_key: branch_key.to_string(),
        arrival_token_id,
        recorded_by: ctx.sender(),
        recorded_at: ctx.timestamp,
    });
    Ok((arrival, true))
}

/// Whether the open fork has enough arrivals to complete the join.
pub(crate) fn join_is_ready(fork: &WorkflowFork, arrival_count: usize) -> bool {
    match fork.split_kind {
        WorkflowBranchKind::And => {
            arrival_count >= fork.expected_branch_keys.len() && !fork.expected_branch_keys.is_empty()
        }
        WorkflowBranchKind::Xor | WorkflowBranchKind::Or => arrival_count >= 1,
        WorkflowBranchKind::None => false,
    }
}

/// Resolve the paired join node key for a fork via structured topology walk.
pub(crate) fn paired_join_key(
    ctx: &ReducerContext,
    workflow_version_id: u64,
    fork_node_key: &str,
) -> Result<Option<String>, String> {
    let nodes: Vec<_> = ctx
        .db
        .workflow_node()
        .workflow_node_by_version()
        .filter(&workflow_version_id)
        .collect();
    let edges: Vec<_> = ctx
        .db
        .workflow_edge()
        .workflow_edge_by_version()
        .filter(&workflow_version_id)
        .collect();
    let mut outgoing: std::collections::BTreeMap<&str, Vec<&str>> =
        std::collections::BTreeMap::new();
    for edge in &edges {
        outgoing
            .entry(edge.from_node_key.as_str())
            .or_default()
            .push(edge.to_node_key.as_str());
    }
    let mut stack: Vec<&str> = Vec::new();
    let mut queue = std::collections::VecDeque::from([fork_node_key]);
    let mut visited = std::collections::BTreeSet::new();
    while let Some(key) = queue.pop_front() {
        if !visited.insert(key) {
            continue;
        }
        if let Some(node) = nodes.iter().find(|row| row.node_key == key) {
            if node.kind == WorkflowNodeKind::Fork {
                stack.push(key);
            } else if node.kind == WorkflowNodeKind::Join {
                if let Some(top) = stack.pop() {
                    if top == fork_node_key {
                        return Ok(Some(node.node_key.clone()));
                    }
                }
            }
        }
        if let Some(targets) = outgoing.get(key) {
            for target in targets {
                queue.push_back(target);
            }
        }
    }
    Ok(None)
}
