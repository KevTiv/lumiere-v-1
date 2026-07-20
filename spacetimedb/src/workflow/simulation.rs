//! Side-effect-free workflow graph simulation.
//!
//! The planner reads immutable definition rows and an immutable subject
//! snapshot, then emits an ordered trace. The reducer persists only simulation
//! result/step rows; runtime tokens, timers, outbox intents, queue jobs and
//! domain records are never created here.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use sha2::{Digest, Sha256};
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::check_permission;
use crate::workflow::definitions::{
    canonical_definition_hash, validate_workflow_graph, workflow, workflow_edge, workflow_node,
    workflow_version, Workflow, WorkflowBranchKind, WorkflowEdge, WorkflowNode, WorkflowNodeKind,
    WorkflowVersion, WorkflowVersionStatus,
};
use crate::workflow::evaluator::{evaluate_condition_program, ConditionSnapshot};

const MAX_SIMULATION_NODES: usize = 512;
const MAX_SIMULATION_STEPS: usize = 4096;
const MAX_SIMULATION_KEY_LEN: usize = 128;

/// Stable categories used by persisted and in-memory simulation traces.
#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowSimulationStepKind {
    NodeEntered,
    EdgeEvaluated,
    EdgeTaken,
    HumanTaskProposed,
    ActionProposed,
    TimerProposed,
    SubflowProposed,
    EndReached,
}

/// One deterministic trace item. Sequence starts at one.
#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub struct WorkflowSimulationTraceStep {
    pub sequence: u32,
    pub kind: WorkflowSimulationStepKind,
    pub node_key: Option<String>,
    pub edge_key: Option<String>,
    pub outcome: Option<bool>,
    pub detail: String,
}

/// Pure simulation output. It intentionally contains no generated IDs or time.
#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub struct WorkflowSimulationTrace {
    pub definition_hash: String,
    pub subject_model: String,
    pub subject_id: u64,
    pub subject_revision_hash: String,
    pub steps: Vec<WorkflowSimulationTraceStep>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct SimulateWorkflowParams {
    pub simulation_key: String,
    pub signal_key: Option<String>,
    pub snapshot: ConditionSnapshot,
}

/// Header for a persisted simulation. This table is private and is exposed to
/// clients only through the later scoped read-model layer.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = workflow_simulation_result,
    index(accessor = workflow_simulation_result_by_org, btree(columns = [organization_id])),
    index(accessor = workflow_simulation_result_by_version, btree(columns = [workflow_version_id])),
    index(accessor = workflow_simulation_result_by_key, btree(columns = [simulation_key]))
)]
pub struct WorkflowSimulationResult {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub workflow_id: u64,
    pub workflow_version_id: u64,
    pub simulation_key: String,
    pub definition_hash: String,
    pub subject_model: String,
    pub subject_id: u64,
    pub subject_revision_hash: String,
    pub trace_hash: String,
    pub step_count: u32,
    pub create_uid: Identity,
    pub create_date: Timestamp,
}

/// Append-only detail for a persisted simulation trace.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = workflow_simulation_step,
    index(accessor = workflow_simulation_step_by_result, btree(columns = [simulation_result_id])),
    index(accessor = workflow_simulation_step_by_org, btree(columns = [organization_id]))
)]
pub struct WorkflowSimulationStep {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub simulation_result_id: u64,
    pub sequence: u32,
    pub kind: WorkflowSimulationStepKind,
    pub node_key: Option<String>,
    pub edge_key: Option<String>,
    pub outcome: Option<bool>,
    pub detail: String,
}

/// Simulate one immutable version and persist only its ordered trace.
#[reducer]
pub fn simulate_workflow(
    ctx: &ReducerContext,
    organization_id: u64,
    workflow_version_id: u64,
    params: SimulateWorkflowParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow", "read")?;
    validate_simulation_key(&params.simulation_key)?;

    let version = ctx
        .db
        .workflow_version()
        .id()
        .find(&workflow_version_id)
        .ok_or_else(|| "workflow version not found".to_string())?;
    if version.organization_id != organization_id {
        return Err("workflow version does not belong to this organization".to_string());
    }
    let definition = ctx
        .db
        .workflow()
        .id()
        .find(&version.workflow_id)
        .ok_or_else(|| "workflow definition not found".to_string())?;
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

    // Complete the pure plan before inserting anything. Any planner failure
    // therefore leaves even the simulation tables unchanged.
    let trace = plan_workflow_simulation(
        &definition,
        &version,
        &nodes,
        &edges,
        &params.snapshot,
        params.signal_key.as_deref(),
    )?;
    let trace_bytes = canonical_simulation_trace_bytes(&trace)?;
    let trace_hash = format!("sha256:{:x}", Sha256::digest(trace_bytes));
    let step_count = u32::try_from(trace.steps.len())
        .map_err(|_| "simulation step count overflow".to_string())?;

    let result = ctx
        .db
        .workflow_simulation_result()
        .insert(WorkflowSimulationResult {
            id: 0,
            organization_id,
            company_id: version.company_id,
            workflow_id: version.workflow_id,
            workflow_version_id,
            simulation_key: params.simulation_key,
            definition_hash: trace.definition_hash.clone(),
            subject_model: trace.subject_model.clone(),
            subject_id: trace.subject_id,
            subject_revision_hash: trace.subject_revision_hash.clone(),
            trace_hash,
            step_count,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
        });

    for step in trace.steps {
        ctx.db
            .workflow_simulation_step()
            .insert(WorkflowSimulationStep {
                id: 0,
                organization_id,
                company_id: version.company_id,
                simulation_result_id: result.id,
                sequence: step.sequence,
                kind: step.kind,
                node_key: step.node_key,
                edge_key: step.edge_key,
                outcome: step.outcome,
                detail: step.detail,
            });
    }
    Ok(())
}

/// Produce an ordered simulation trace without reading or mutating database
/// state. Runtime uses the same condition evaluator and ordering contract.
#[allow(clippy::too_many_arguments)]
pub fn plan_workflow_simulation(
    workflow: &Workflow,
    version: &WorkflowVersion,
    nodes: &[WorkflowNode],
    edges: &[WorkflowEdge],
    snapshot: &ConditionSnapshot,
    signal_key: Option<&str>,
) -> Result<WorkflowSimulationTrace, String> {
    if workflow.id != version.workflow_id {
        return Err("workflow version belongs to a different definition".to_string());
    }
    if workflow.organization_id != version.organization_id
        || workflow.company_id != version.company_id
    {
        return Err("workflow version scope differs from its definition".to_string());
    }
    if workflow.model != snapshot.subject_model {
        return Err(format!(
            "snapshot model '{}' does not match workflow model '{}'",
            snapshot.subject_model, workflow.model
        ));
    }
    if snapshot.subject_revision_hash.trim().is_empty() {
        return Err("snapshot subject revision hash is required".to_string());
    }
    if nodes.len() > MAX_SIMULATION_NODES {
        return Err(format!(
            "workflow simulation exceeds {MAX_SIMULATION_NODES} nodes"
        ));
    }
    validate_workflow_graph(&version.snapshot_fields, nodes, edges).map_err(|errors| {
        format!(
            "cannot simulate invalid workflow graph: {}",
            errors.join("; ")
        )
    })?;

    let definition_hash = canonical_definition_hash(workflow, version, nodes, edges)?;
    if version.status == WorkflowVersionStatus::Published
        && version.content_hash.as_deref() != Some(definition_hash.as_str())
    {
        return Err("published workflow content hash does not match its graph".to_string());
    }

    let nodes_by_key: BTreeMap<_, _> = nodes
        .iter()
        .map(|node| (node.node_key.as_str(), node))
        .collect();
    let mut outgoing: BTreeMap<&str, Vec<&WorkflowEdge>> = BTreeMap::new();
    for edge in edges {
        outgoing
            .entry(edge.from_node_key.as_str())
            .or_default()
            .push(edge);
    }
    for candidates in outgoing.values_mut() {
        candidates.sort_by(|left, right| {
            (
                left.sequence,
                left.edge_key.as_str(),
                left.to_node_key.as_str(),
            )
                .cmp(&(
                    right.sequence,
                    right.edge_key.as_str(),
                    right.to_node_key.as_str(),
                ))
        });
    }

    let start = nodes
        .iter()
        .find(|node| node.kind == WorkflowNodeKind::Start)
        .ok_or_else(|| "workflow start node not found".to_string())?;
    let mut pending = VecDeque::from([start.node_key.as_str()]);
    let mut visited = BTreeSet::new();
    let mut steps = Vec::new();

    while let Some(node_key) = pending.pop_front() {
        if !visited.insert(node_key) {
            continue;
        }
        let node = nodes_by_key
            .get(node_key)
            .ok_or_else(|| format!("workflow node '{node_key}' not found"))?;
        push_step(
            &mut steps,
            WorkflowSimulationStepKind::NodeEntered,
            Some(node.node_key.clone()),
            None,
            None,
            node_kind_key(&node.kind).to_string(),
        )?;
        push_proposal_step(&mut steps, node)?;

        let mut selected = Vec::new();
        for edge in outgoing.get(node_key).into_iter().flatten() {
            let signal_matches = edge
                .signal_key
                .as_deref()
                .is_none_or(|required| signal_key == Some(required));
            let (outcome, detail) = if !signal_matches {
                (false, "signal_not_matched".to_string())
            } else if let Some(program) = edge.condition.as_ref() {
                let outcome =
                    evaluate_condition_program(program, &version.snapshot_fields, snapshot)
                        .map_err(|error| {
                            format!("edge '{}' condition failed: {error}", edge.edge_key)
                        })?;
                (
                    outcome,
                    if outcome {
                        "condition_true"
                    } else {
                        "condition_false"
                    }
                    .to_string(),
                )
            } else {
                (true, "unconditional".to_string())
            };
            push_step(
                &mut steps,
                WorkflowSimulationStepKind::EdgeEvaluated,
                Some(node.node_key.clone()),
                Some(edge.edge_key.clone()),
                Some(outcome),
                detail,
            )?;
            if outcome {
                selected.push(*edge);
                if node.kind == WorkflowNodeKind::Decision
                    || node.split_kind == WorkflowBranchKind::Xor
                {
                    break;
                }
            }
        }

        for edge in selected {
            push_step(
                &mut steps,
                WorkflowSimulationStepKind::EdgeTaken,
                Some(node.node_key.clone()),
                Some(edge.edge_key.clone()),
                Some(true),
                edge.to_node_key.clone(),
            )?;
            pending.push_back(edge.to_node_key.as_str());
        }
    }

    Ok(WorkflowSimulationTrace {
        definition_hash,
        subject_model: snapshot.subject_model.clone(),
        subject_id: snapshot.subject_id,
        subject_revision_hash: snapshot.subject_revision_hash.clone(),
        steps,
    })
}

/// Canonical binary trace encoding used for equality checks and audit hashes.
pub fn canonical_simulation_trace_bytes(
    trace: &WorkflowSimulationTrace,
) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::with_capacity(256 + trace.steps.len() * 64);
    put_string(&mut bytes, "lumiere.workflow-simulation-trace")?;
    put_string(&mut bytes, &trace.definition_hash)?;
    put_string(&mut bytes, &trace.subject_model)?;
    bytes.extend_from_slice(&trace.subject_id.to_be_bytes());
    put_string(&mut bytes, &trace.subject_revision_hash)?;
    put_len(&mut bytes, trace.steps.len())?;
    for step in &trace.steps {
        bytes.extend_from_slice(&step.sequence.to_be_bytes());
        bytes.push(step_kind_tag(&step.kind));
        put_optional_string(&mut bytes, step.node_key.as_deref())?;
        put_optional_string(&mut bytes, step.edge_key.as_deref())?;
        match step.outcome {
            None => bytes.push(0),
            Some(false) => bytes.push(1),
            Some(true) => bytes.push(2),
        }
        put_string(&mut bytes, &step.detail)?;
    }
    Ok(bytes)
}

fn push_proposal_step(
    steps: &mut Vec<WorkflowSimulationTraceStep>,
    node: &WorkflowNode,
) -> Result<(), String> {
    let proposal = match node.kind {
        WorkflowNodeKind::HumanTask => Some((
            WorkflowSimulationStepKind::HumanTaskProposed,
            "human_task".to_string(),
        )),
        WorkflowNodeKind::Action => Some((
            WorkflowSimulationStepKind::ActionProposed,
            node.action
                .as_ref()
                .map(|action| action.action_key.clone())
                .unwrap_or_else(|| "action".to_string()),
        )),
        WorkflowNodeKind::Timer => Some((
            WorkflowSimulationStepKind::TimerProposed,
            node.timer_policy
                .as_ref()
                .map(|timer| format!("delay_seconds:{}", timer.delay_seconds))
                .unwrap_or_else(|| "timer".to_string()),
        )),
        WorkflowNodeKind::Subflow => Some((
            WorkflowSimulationStepKind::SubflowProposed,
            node.subflow
                .as_ref()
                .map(|subflow| {
                    format!(
                        "workflow:{}:version:{}",
                        subflow.workflow_id, subflow.workflow_version_id
                    )
                })
                .unwrap_or_else(|| "subflow".to_string()),
        )),
        WorkflowNodeKind::End => Some((WorkflowSimulationStepKind::EndReached, "end".to_string())),
        _ => None,
    };
    if let Some((kind, detail)) = proposal {
        push_step(steps, kind, Some(node.node_key.clone()), None, None, detail)?;
    }
    Ok(())
}

fn push_step(
    steps: &mut Vec<WorkflowSimulationTraceStep>,
    kind: WorkflowSimulationStepKind,
    node_key: Option<String>,
    edge_key: Option<String>,
    outcome: Option<bool>,
    detail: String,
) -> Result<(), String> {
    if steps.len() >= MAX_SIMULATION_STEPS {
        return Err(format!(
            "workflow simulation exceeds {MAX_SIMULATION_STEPS} trace steps"
        ));
    }
    let sequence = u32::try_from(steps.len() + 1)
        .map_err(|_| "simulation trace sequence overflow".to_string())?;
    steps.push(WorkflowSimulationTraceStep {
        sequence,
        kind,
        node_key,
        edge_key,
        outcome,
        detail,
    });
    Ok(())
}

fn validate_simulation_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > MAX_SIMULATION_KEY_LEN {
        return Err(format!(
            "simulation key must contain 1 to {MAX_SIMULATION_KEY_LEN} characters"
        ));
    }
    if !key
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b':'))
    {
        return Err("simulation key contains unsupported characters".to_string());
    }
    Ok(())
}

fn node_kind_key(kind: &WorkflowNodeKind) -> &'static str {
    match kind {
        WorkflowNodeKind::Start => "start",
        WorkflowNodeKind::End => "end",
        WorkflowNodeKind::Decision => "decision",
        WorkflowNodeKind::HumanTask => "human_task",
        WorkflowNodeKind::Action => "action",
        WorkflowNodeKind::Timer => "timer",
        WorkflowNodeKind::Fork => "fork",
        WorkflowNodeKind::Join => "join",
        WorkflowNodeKind::Subflow => "subflow",
    }
}

fn step_kind_tag(kind: &WorkflowSimulationStepKind) -> u8 {
    match kind {
        WorkflowSimulationStepKind::NodeEntered => 0,
        WorkflowSimulationStepKind::EdgeEvaluated => 1,
        WorkflowSimulationStepKind::EdgeTaken => 2,
        WorkflowSimulationStepKind::HumanTaskProposed => 3,
        WorkflowSimulationStepKind::ActionProposed => 4,
        WorkflowSimulationStepKind::TimerProposed => 5,
        WorkflowSimulationStepKind::SubflowProposed => 6,
        WorkflowSimulationStepKind::EndReached => 7,
    }
}

fn put_len(bytes: &mut Vec<u8>, len: usize) -> Result<(), String> {
    let len = u32::try_from(len).map_err(|_| "canonical trace collection is too large")?;
    bytes.extend_from_slice(&len.to_be_bytes());
    Ok(())
}

fn put_string(bytes: &mut Vec<u8>, value: &str) -> Result<(), String> {
    put_len(bytes, value.len())?;
    bytes.extend_from_slice(value.as_bytes());
    Ok(())
}

fn put_optional_string(bytes: &mut Vec<u8>, value: Option<&str>) -> Result<(), String> {
    bytes.push(u8::from(value.is_some()));
    if let Some(value) = value {
        put_string(bytes, value)?;
    }
    Ok(())
}
