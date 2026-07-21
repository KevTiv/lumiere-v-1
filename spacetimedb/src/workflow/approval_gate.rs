//! Guarded-action workflow discovery and human-task creation.
//!
//! Domain reducers call [`request_guarded_action`] before direct execution. A
//! matching published workflow is simulated against the registered material
//! snapshot. If the selected path reaches its approval task, this function
//! starts (or reuses) the pinned instance and creates one task for its token.

use std::collections::{BTreeMap, BTreeSet};

use spacetimedb::{ReducerContext, SpacetimeType, Table};

use super::action_registry::{
    snapshot_guarded_action, GuardedActionInput, GuardedActionKey, GuardedActionSnapshot,
};
use super::approvals::{
    create_workflow_human_task_internal, workflow_human_task, CreateWorkflowHumanTaskParams,
    WorkflowTaskGuardedAction,
};
use super::definitions::{
    workflow, workflow_edge, workflow_node, workflow_version, WorkflowEdge, WorkflowNode,
    WorkflowNodeKind, WorkflowVersion, WorkflowVersionStatus,
};
use super::evaluator::evaluate_condition_program;
use super::runtime::{
    apply_runtime_event, start_workflow_internal, workflow_command_receipt, workflow_instance,
    workflow_token, RuntimeEventContext, RuntimeMutation, RuntimeTransition, StartWorkflowParams,
    WorkflowAuthorizationOutcome, WorkflowCommandKind, WorkflowInstance, WorkflowToken,
    WorkflowTokenState,
};

const MAX_GATE_PATH_NODES: usize = 128;

#[derive(SpacetimeType, Clone, Debug)]
pub struct RequestGuardedActionParams {
    pub company_id: u64,
    pub action: GuardedActionKey,
    pub action_version: u32,
    pub input: GuardedActionInput,
    pub idempotency_key: String,
    pub correlation_id: String,
    pub causation_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GuardedActionGateOutcome {
    DirectExecutionAllowed {
        subject_revision_hash: String,
    },
    HumanTaskCreated {
        workflow_instance_id: u64,
        task_id: u64,
        subject_revision_hash: String,
    },
}

/// Resolve the registered action snapshot and apply the matching published
/// workflow. Unregistered actions cannot enter this path because the request is
/// typed. A missing workflow permits the caller's ordinary low-risk execution;
/// a selected approval path always defers through a human task.
pub fn request_guarded_action(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RequestGuardedActionParams,
) -> Result<GuardedActionGateOutcome, String> {
    let snapshot = snapshot_guarded_action(
        ctx,
        organization_id,
        params.company_id,
        params.action.clone(),
        params.action_version,
        params.input.clone(),
    )?;
    let Some(plan) = discover_gate_plan(ctx, organization_id, params.company_id, &snapshot)? else {
        return Ok(GuardedActionGateOutcome::DirectExecutionAllowed {
            subject_revision_hash: snapshot.subject_revision_hash,
        });
    };
    let Some(task_node) = plan.task_node else {
        return Ok(GuardedActionGateOutcome::DirectExecutionAllowed {
            subject_revision_hash: snapshot.subject_revision_hash,
        });
    };

    let start_key = format!(
        "guarded:{}:{}:{}:{}",
        plan.version.id,
        snapshot.subject_id,
        params.action.as_str(),
        params.idempotency_key
    );
    start_workflow_internal(
        ctx,
        organization_id,
        StartWorkflowParams {
            company_id: params.company_id,
            workflow_id: plan.version.workflow_id,
            workflow_version_id: plan.version.id,
            subject_model: snapshot.condition_snapshot.subject_model.clone(),
            subject_id: snapshot.subject_id,
            subject_revision_hash: snapshot.condition_snapshot.subject_revision_hash.clone(),
            singleton_trigger_key: version_requires_singleton(plan.version.metadata.as_deref())?
                .then(|| {
                    format!(
                        "guarded:{}:{}:{}:{}",
                        plan.version.id,
                        snapshot.subject_id,
                        params.action.as_str(),
                        snapshot.subject_revision_hash
                    )
                }),
            idempotency_key: start_key.clone(),
            correlation_id: params.correlation_id.clone(),
            causation_id: params.causation_id.clone(),
        },
    )?;
    let mut instance = started_instance(ctx, organization_id, params.company_id, &start_key)?;
    if let Some(existing) = ctx
        .db
        .workflow_human_task()
        .human_task_by_instance()
        .filter(&instance.id)
        .find(|task| {
            task.guarded_action.as_ref().is_some_and(|action| {
                action.key == params.action && action.schema_version == params.action_version
            })
        })
    {
        if existing.subject_revision_hash != snapshot.subject_revision_hash {
            return Err(
                "guarded workflow replay resolved a task for a different subject revision"
                    .to_string(),
            );
        }
        return Ok(GuardedActionGateOutcome::HumanTaskCreated {
            workflow_instance_id: instance.id,
            task_id: existing.id,
            subject_revision_hash: existing.subject_revision_hash,
        });
    }
    let mut token = active_token(ctx, &instance)?;

    for (sequence, edge) in plan.path.iter().enumerate() {
        if token.node_key != edge.from_node_key {
            return Err("guarded workflow path diverged from its simulated route".to_string());
        }
        let transition_key = format!("{start_key}:route:{sequence}");
        instance = apply_runtime_event(
            ctx,
            &instance,
            RuntimeEventContext {
                command_kind: WorkflowCommandKind::Signal,
                expected_instance_revision: instance.revision,
                idempotency_key: transition_key.clone(),
                input_hash: gate_transition_hash(&start_key, edge.id, instance.revision),
                action_key: None,
                condition_result: edge.condition.as_ref().map(|_| true),
                authorization_outcome: WorkflowAuthorizationOutcome::NotApplicable,
                acting_for: None,
                matched_role_id: None,
                delegation_id: None,
                domain_receipt: None,
                reason: None,
                correlation_id: params.correlation_id.clone(),
                causation_id: params.causation_id.clone(),
                condition_snapshot: None,
            },
            RuntimeMutation::Transitions(vec![RuntimeTransition {
                token_id: token.id,
                expected_token_revision: token.revision,
                edge_id: edge.id,
            }]),
        )?;
        token = active_token(ctx, &instance)?;
    }
    if token.node_id != task_node.id || token.node_key != task_node.node_key {
        return Err("guarded workflow did not arrive at its planned human task".to_string());
    }
    let task = create_workflow_human_task_internal(
        ctx,
        organization_id,
        params.company_id,
        CreateWorkflowHumanTaskParams {
            instance_id: instance.id,
            token_id: token.id,
            guarded_action: Some(WorkflowTaskGuardedAction {
                key: params.action,
                schema_version: params.action_version,
            }),
            requested_by: ctx.sender(),
            correlation_id: params.correlation_id,
            subject_revision_hash: Some(snapshot.subject_revision_hash.clone()),
        },
    )?;
    Ok(GuardedActionGateOutcome::HumanTaskCreated {
        workflow_instance_id: instance.id,
        task_id: task.id,
        subject_revision_hash: snapshot.subject_revision_hash,
    })
}

struct GatePlan {
    version: WorkflowVersion,
    task_node: Option<WorkflowNode>,
    path: Vec<WorkflowEdge>,
}

fn discover_gate_plan(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    snapshot: &GuardedActionSnapshot,
) -> Result<Option<GatePlan>, String> {
    let mut candidates = Vec::new();
    for definition in ctx.db.workflow().iter().filter(|definition| {
        definition.organization_id == organization_id
            && definition.model == snapshot.subject_kind.as_str()
            && definition
                .company_id
                .is_none_or(|scoped_company| scoped_company == company_id)
    }) {
        for version in ctx
            .db
            .workflow_version()
            .workflow_version_by_workflow()
            .filter(&definition.id)
            .filter(|version| version.status == WorkflowVersionStatus::Published)
        {
            let nodes: Vec<_> = ctx
                .db
                .workflow_node()
                .workflow_node_by_version()
                .filter(&version.id)
                .collect();
            if nodes.iter().any(|node| {
                node.action.as_ref().is_some_and(|action| {
                    action.action_key == snapshot.action.as_str()
                        && action.input_schema_version == snapshot.action_version
                })
            }) {
                candidates.push((version, nodes));
            }
        }
    }
    candidates.sort_by_key(|(version, _)| version.id);
    if candidates.len() > 1 {
        return Err("multiple published workflows match this guarded action".to_string());
    }
    let Some((version, nodes)) = candidates.pop() else {
        return Ok(None);
    };
    let edges: Vec<_> = ctx
        .db
        .workflow_edge()
        .workflow_edge_by_version()
        .filter(&version.id)
        .collect();
    let (task_node, path) = selected_task_path(&version, &nodes, &edges, snapshot)?;
    Ok(Some(GatePlan {
        version,
        task_node,
        path,
    }))
}

fn selected_task_path(
    version: &WorkflowVersion,
    nodes: &[WorkflowNode],
    edges: &[WorkflowEdge],
    snapshot: &GuardedActionSnapshot,
) -> Result<(Option<WorkflowNode>, Vec<WorkflowEdge>), String> {
    let nodes_by_key: BTreeMap<_, _> = nodes
        .iter()
        .map(|node| (node.node_key.as_str(), node))
        .collect();
    let mut starts = nodes
        .iter()
        .filter(|node| node.kind == WorkflowNodeKind::Start);
    let mut current = starts.next().ok_or("guarded workflow has no start node")?;
    if starts.next().is_some() {
        return Err("guarded workflow has multiple start nodes".to_string());
    }
    let mut path = Vec::new();
    let mut visited = BTreeSet::new();
    for _ in 0..MAX_GATE_PATH_NODES {
        if !visited.insert(current.node_key.as_str()) {
            return Err("guarded workflow selected path contains a cycle".to_string());
        }
        if current.kind == WorkflowNodeKind::HumanTask {
            let approved_edges: Vec<_> = edges
                .iter()
                .filter(|edge| {
                    edge.from_node_key == current.node_key
                        && edge.signal_key.as_deref() == Some("approved")
                })
                .collect();
            if approved_edges.len() != 1 {
                return Err("guarded approval task requires exactly one approved edge".to_string());
            }
            let target = nodes_by_key
                .get(approved_edges[0].to_node_key.as_str())
                .copied()
                .ok_or("guarded approval edge target is missing")?;
            let targets_action = target.kind == WorkflowNodeKind::Action
                && target.action.as_ref().is_some_and(|action| {
                    action.action_key == snapshot.action.as_str()
                        && action.input_schema_version == snapshot.action_version
                });
            if !targets_action {
                return Err(
                    "guarded approval task must lead directly to its registered action node"
                        .to_string(),
                );
            }
            return Ok((Some(current.clone()), path));
        }
        if matches!(
            current.kind,
            WorkflowNodeKind::Action | WorkflowNodeKind::End
        ) {
            return Ok((None, Vec::new()));
        }
        let mut selected = Vec::new();
        let mut outgoing: Vec<_> = edges
            .iter()
            .filter(|edge| edge.from_node_key == current.node_key)
            .collect();
        outgoing.sort_by(|a, b| {
            a.sequence
                .cmp(&b.sequence)
                .then_with(|| a.edge_key.cmp(&b.edge_key))
                .then_with(|| a.id.cmp(&b.id))
        });
        for edge in outgoing {
            if edge.signal_key.is_some() {
                continue;
            }
            let matches = edge.condition.as_ref().map_or(Ok(true), |condition| {
                evaluate_condition_program(
                    condition,
                    &version.snapshot_fields,
                    &snapshot.condition_snapshot,
                )
            })
            .map_err(|error| format!("guarded workflow condition evaluation failed: {error}"))?;
            if matches {
                selected.push(edge);
                if current.kind == WorkflowNodeKind::Decision {
                    break;
                }
            }
        }
        if selected.len() != 1 {
            return Err(
                "guarded workflow path requires unsupported structured branching".to_string(),
            );
        }
        let edge = (*selected[0]).clone();
        current = nodes_by_key
            .get(edge.to_node_key.as_str())
            .copied()
            .ok_or("guarded workflow edge target is missing")?;
        path.push(edge);
    }
    Err("guarded workflow path exceeds the safety bound".to_string())
}

fn started_instance(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    start_key: &str,
) -> Result<WorkflowInstance, String> {
    let receipt = ctx
        .db
        .workflow_command_receipt()
        .iter()
        .find(|receipt| {
            receipt.organization_id == organization_id
                && receipt.company_id == company_id
                && receipt.command_kind == WorkflowCommandKind::Start
                && receipt.idempotency_key == start_key
        })
        .ok_or("guarded workflow start receipt not found")?;
    ctx.db
        .workflow_instance()
        .id()
        .find(&receipt.result_instance_id)
        .ok_or_else(|| "guarded workflow instance not found".to_string())
}

fn active_token(
    ctx: &ReducerContext,
    instance: &WorkflowInstance,
) -> Result<WorkflowToken, String> {
    let mut active: Vec<_> = ctx
        .db
        .workflow_token()
        .workflow_token_by_instance()
        .filter(&instance.id)
        .filter(|token| token.state == WorkflowTokenState::Active)
        .collect();
    active.sort_by_key(|token| token.id);
    if active.len() != 1 {
        return Err("guarded workflow requires exactly one active token before Wave 4".to_string());
    }
    Ok(active.remove(0))
}

fn gate_transition_hash(start_key: &str, edge_id: u64, revision: u64) -> String {
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    for field in [
        start_key.to_string(),
        edge_id.to_string(),
        revision.to_string(),
    ] {
        hasher.update((field.len() as u64).to_be_bytes());
        hasher.update(field.as_bytes());
    }
    format!("sha256:{:x}", hasher.finalize())
}

fn version_requires_singleton(metadata: Option<&str>) -> Result<bool, String> {
    let Some(metadata) = metadata else {
        return Ok(false);
    };
    let value: serde_json::Value = serde_json::from_str(metadata)
        .map_err(|error| format!("workflow version metadata is invalid JSON: {error}"))?;
    Ok(value
        .get("singleton_trigger")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false))
}
