//! Version-pinned workflow runtime, command receipts and append-only history.
//!
//! Runtime commands are optimistic and semantically idempotent. A command key
//! replay with byte-equivalent canonical input returns the stored result; reuse
//! with different input is rejected before any state is changed.

use std::collections::BTreeSet;

use sha2::{Digest, Sha256};
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::journal_entries::account_move;
use crate::accounting::payment_management::payment_transaction;
use crate::accounting::payments::account_payment;
use crate::ai::action_drafts::ai_action_draft;
use crate::core::organization::require_company_in_organization;
use crate::core::persistence::{record_organization_commit, OrganizationCommitInput, RowChange};
use crate::expenses::expenses::expense_sheet;
use crate::helpers::check_permission;
use crate::hr::leaves::hr_leave;
use crate::purchasing::purchase_orders::purchase_order;
use crate::sales::sales_core::sale_order;
use crate::workflow::branches::{
    join_is_ready, paired_join_key, record_join_arrival, select_fork_edges, workflow_fork,
    workflow_join_arrival, WorkflowFork,
};
use crate::workflow::definitions::{
    workflow, workflow_edge, workflow_node, workflow_version, WorkflowNodeKind,
    WorkflowVersionStatus,
};
use crate::workflow::evaluator::{
    canonical_condition_snapshot_hash, evaluate_condition_program, validate_condition_snapshot,
    ConditionSnapshot,
};

const MAX_TRANSITIONS_PER_COMMAND: usize = 64;
const MAX_KEY_LEN: usize = 256;

// ============================================================================
// PUBLIC COMMAND CONTRACTS
// ============================================================================

#[derive(SpacetimeType, Clone, Debug)]
pub struct StartWorkflowParams {
    pub company_id: u64,
    pub workflow_id: u64,
    pub workflow_version_id: u64,
    pub subject_model: String,
    pub subject_id: u64,
    /// Canonical content/revision hash supplied by the registered snapshot adapter.
    pub subject_revision_hash: String,
    /// Stable trigger identity when this definition/trigger is singleton.
    pub singleton_trigger_key: Option<String>,
    pub idempotency_key: String,
    pub correlation_id: String,
    pub causation_id: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct SignalWorkflowParams {
    pub company_id: u64,
    pub instance_id: u64,
    pub expected_revision: u64,
    pub signal_key: String,
    /// Immutable, adapter-produced snapshot. Its canonical hash must still
    /// match the revision bound when the instance started.
    pub snapshot: ConditionSnapshot,
    pub idempotency_key: String,
    pub correlation_id: String,
    pub causation_id: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CancelWorkflowParams {
    pub company_id: u64,
    pub instance_id: u64,
    pub expected_revision: u64,
    pub reason: String,
    pub idempotency_key: String,
    pub correlation_id: String,
    pub causation_id: Option<String>,
}

// ============================================================================
// TYPED RUNTIME CONTRACTS
// ============================================================================

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowInstanceState {
    Active,
    Completed,
    Cancelled,
    Failed,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowTokenState {
    Active,
    Consumed,
    Cancelled,
    Completed,
    Failed,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowCommandKind {
    Start,
    Signal,
    Cancel,
    HumanDecision,
    Timer,
    ActionResult,
    Branch,
    Migration,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum WorkflowAuthorizationOutcome {
    NotApplicable,
    Allowed,
    Denied,
}

// ============================================================================
// PRIVATE AUTHORITATIVE TABLES
// ============================================================================

#[derive(Clone)]
#[spacetimedb::table(
    accessor = workflow_instance,
    index(accessor = instance_by_org, btree(columns = [organization_id])),
    index(accessor = instance_by_company, btree(columns = [company_id])),
    index(accessor = instance_by_workflow, btree(columns = [workflow_id])),
    index(accessor = instance_by_version, btree(columns = [workflow_version_id])),
    index(accessor = instance_by_subject, btree(columns = [subject_id]))
)]
pub struct WorkflowInstance {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub workflow_id: u64,
    pub workflow_version_id: u64,
    pub definition_hash: String,
    pub subject_model: String,
    pub subject_id: u64,
    pub subject_revision_hash: String,
    pub state: WorkflowInstanceState,
    pub revision: u64,
    pub active_token_count: u32,
    pub singleton_scope_key: Option<String>,
    pub started_by: Identity,
    pub started_at: Timestamp,
    pub completed_at: Option<Timestamp>,
    pub cancelled_by: Option<Identity>,
    pub cancelled_at: Option<Timestamp>,
    pub correlation_id: String,
    pub causation_id: Option<String>,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = workflow_token,
    index(accessor = workflow_token_by_org, btree(columns = [organization_id])),
    index(accessor = workflow_token_by_company, btree(columns = [company_id])),
    index(accessor = workflow_token_by_instance, btree(columns = [instance_id])),
    index(accessor = workflow_token_by_node, btree(columns = [node_id])),
    index(accessor = workflow_token_by_state, btree(columns = [state]))
)]
pub struct WorkflowToken {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub instance_id: u64,
    pub workflow_version_id: u64,
    pub node_id: u64,
    pub node_key: String,
    pub state: WorkflowTokenState,
    pub revision: u64,
    pub parent_token_id: Option<u64>,
    pub fork_id: Option<u64>,
    pub branch_key: Option<String>,
    pub lineage: Vec<u64>,
    pub created_at: Timestamp,
    pub consumed_at: Option<Timestamp>,
}

/// Append-only runtime evidence. No reducer updates or deletes these rows.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = workflow_decision_event,
    index(accessor = workflow_event_by_org, btree(columns = [organization_id])),
    index(accessor = workflow_event_by_company, btree(columns = [company_id])),
    index(accessor = workflow_event_by_instance, btree(columns = [instance_id])),
    index(accessor = workflow_event_by_token, btree(columns = [token_id]))
)]
pub struct WorkflowDecisionEvent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub workflow_id: u64,
    pub workflow_version_id: u64,
    pub instance_id: u64,
    /// Source token consumed by this event, when applicable.
    pub token_id: Option<u64>,
    /// Token created at the destination node, when applicable.
    pub result_token_id: Option<u64>,
    pub prior_node_key: Option<String>,
    pub next_node_key: Option<String>,
    pub command_kind: WorkflowCommandKind,
    pub prior_instance_state: Option<WorkflowInstanceState>,
    pub next_instance_state: WorkflowInstanceState,
    pub prior_token_state: Option<WorkflowTokenState>,
    pub next_token_state: Option<WorkflowTokenState>,
    pub actor: Identity,
    pub acting_for: Option<Identity>,
    pub matched_role_id: Option<u64>,
    pub delegation_id: Option<u64>,
    pub authorization_outcome: WorkflowAuthorizationOutcome,
    pub condition_result: Option<bool>,
    pub subject_model: String,
    pub subject_id: u64,
    pub subject_revision_hash: String,
    pub action_key: Option<String>,
    pub prior_revision: u64,
    pub next_revision: u64,
    pub idempotency_key: String,
    pub input_hash: String,
    pub domain_receipt: Option<String>,
    pub reason: Option<String>,
    pub correlation_id: String,
    pub causation_id: Option<String>,
    pub recorded_at: Timestamp,
}

/// Stable result of a successfully applied semantic command.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = workflow_command_receipt,
    index(accessor = workflow_receipt_by_org, btree(columns = [organization_id])),
    index(accessor = workflow_receipt_by_company, btree(columns = [company_id])),
    index(accessor = workflow_receipt_by_instance, btree(columns = [result_instance_id]))
)]
pub struct WorkflowCommandReceipt {
    /// `{organization_id}:{command_kind}:{idempotency_key}`.
    #[primary_key]
    pub scope_key: String,
    pub organization_id: u64,
    pub company_id: u64,
    pub command_kind: WorkflowCommandKind,
    pub idempotency_key: String,
    pub input_hash: String,
    pub result_instance_id: u64,
    pub result_instance_revision: u64,
    pub result_instance_state: WorkflowInstanceState,
    pub result_token_ids: Vec<u64>,
    pub correlation_id: String,
    pub causation_id: Option<String>,
    pub created_by: Identity,
    pub created_at: Timestamp,
}

// ============================================================================
// INTERNAL TRANSITION INTERFACE
// ============================================================================

#[derive(Clone, Debug)]
pub(crate) struct RuntimeTransition {
    pub token_id: u64,
    pub expected_token_revision: u64,
    pub edge_id: u64,
}

#[derive(Clone, Debug)]
pub(crate) enum RuntimeMutation {
    Transitions(Vec<RuntimeTransition>),
    Cancel,
}

#[derive(Clone, Debug)]
pub(crate) struct RuntimeEventContext {
    pub command_kind: WorkflowCommandKind,
    pub expected_instance_revision: u64,
    pub idempotency_key: String,
    pub input_hash: String,
    pub action_key: Option<String>,
    pub condition_result: Option<bool>,
    pub authorization_outcome: WorkflowAuthorizationOutcome,
    pub acting_for: Option<Identity>,
    pub matched_role_id: Option<u64>,
    pub delegation_id: Option<u64>,
    pub domain_receipt: Option<String>,
    pub reason: Option<String>,
    pub correlation_id: String,
    pub causation_id: Option<String>,
    /// Optional snapshot for conditioned fork expansion (signal path).
    pub condition_snapshot: Option<ConditionSnapshot>,
}

/// Apply a prevalidated runtime event atomically.
///
/// Human-task, timer, action and branch reducers use this interface after their
/// own authorization/evaluation checks. All referenced tokens and edges are
/// validated before the first projection or history write.
pub(crate) fn apply_runtime_event(
    ctx: &ReducerContext,
    instance: &WorkflowInstance,
    event: RuntimeEventContext,
    mutation: RuntimeMutation,
) -> Result<WorkflowInstance, String> {
    if instance.state != WorkflowInstanceState::Active {
        return Err("workflow instance is terminal".to_string());
    }
    if instance.revision != event.expected_instance_revision {
        return Err(format!(
            "stale workflow instance revision: expected {}, current {}",
            event.expected_instance_revision, instance.revision
        ));
    }

    match mutation {
        RuntimeMutation::Transitions(transitions) => {
            apply_transitions(ctx, instance, &event, transitions)
        }
        RuntimeMutation::Cancel => apply_cancellation(ctx, instance, &event),
    }
}

// ============================================================================
// REDUCERS
// ============================================================================

/// Start an instance pinned to an explicitly selected published version.
#[reducer]
pub fn start_workflow(
    ctx: &ReducerContext,
    organization_id: u64,
    params: StartWorkflowParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow_instance", "create")?;
    start_workflow_internal(ctx, organization_id, params)
}

pub(crate) fn start_workflow_internal(
    ctx: &ReducerContext,
    organization_id: u64,
    params: StartWorkflowParams,
) -> Result<(), String> {
    validate_command_key(&params.idempotency_key, "idempotency key")?;
    validate_command_key(&params.correlation_id, "correlation id")?;
    validate_revision_hash(&params.subject_revision_hash)?;
    validate_required(&params.subject_model, "subject model")?;
    if let Some(key) = params.singleton_trigger_key.as_deref() {
        validate_command_key(key, "singleton trigger key")?;
    }

    let input_hash = start_input_hash(organization_id, &params);
    let scope_key = receipt_scope_key(
        organization_id,
        &WorkflowCommandKind::Start,
        &params.idempotency_key,
    );
    if replay_receipt(ctx, &scope_key, &input_hash)?.is_some() {
        return Ok(());
    }

    require_company_in_organization(ctx, organization_id, params.company_id)?;
    let definition = ctx
        .db
        .workflow()
        .id()
        .find(&params.workflow_id)
        .ok_or("workflow not found")?;
    if definition.organization_id != organization_id {
        return Err("workflow does not belong to this organization".to_string());
    }
    if definition
        .company_id
        .is_some_and(|id| id != params.company_id)
    {
        return Err("workflow does not belong to this company".to_string());
    }
    if definition.model != params.subject_model {
        return Err("workflow model does not match subject model".to_string());
    }

    // WRK-001: Validate subject_id exists in the ERP table for this org
    validate_subject_id_fk(
        ctx,
        organization_id,
        &params.subject_model,
        params.subject_id,
    )?;

    let version = ctx
        .db
        .workflow_version()
        .id()
        .find(&params.workflow_version_id)
        .ok_or("workflow version not found")?;
    if version.organization_id != organization_id
        || version.workflow_id != definition.id
        || version.company_id != definition.company_id
    {
        return Err("workflow version scope does not match the workflow".to_string());
    }
    if version.status != WorkflowVersionStatus::Published {
        return Err("only a published workflow version can start".to_string());
    }
    let definition_hash = version
        .content_hash
        .clone()
        .ok_or("published workflow version has no content hash")?;

    let mut start_nodes: Vec<_> = ctx
        .db
        .workflow_node()
        .workflow_node_by_version()
        .filter(&version.id)
        .filter(|node| node.kind == WorkflowNodeKind::Start)
        .collect();
    start_nodes.sort_by(|a, b| {
        a.sequence
            .cmp(&b.sequence)
            .then_with(|| a.node_key.cmp(&b.node_key))
            .then_with(|| a.id.cmp(&b.id))
    });
    if start_nodes.len() != 1 {
        return Err("published workflow version must have exactly one start node".to_string());
    }

    let singleton_required = definition_requires_singleton(version.metadata.as_deref())?;
    if singleton_required && params.singleton_trigger_key.is_none() {
        return Err("workflow version requires a singleton trigger key".to_string());
    }
    let singleton_scope_key = params.singleton_trigger_key.as_deref().map(|key| {
        format!(
            "{organization_id}:{}:{}:{}:{key}",
            params.company_id, version.id, params.subject_model
        )
    });
    if let Some(singleton_scope) = singleton_scope_key.as_deref() {
        if ctx
            .db
            .workflow_instance()
            .iter()
            .any(|row| row.singleton_scope_key.as_deref() == Some(singleton_scope))
        {
            return Err("singleton workflow trigger already started".to_string());
        }
    }

    let start_node = &start_nodes[0];
    let instance = ctx.db.workflow_instance().insert(WorkflowInstance {
        id: 0,
        organization_id,
        company_id: params.company_id,
        workflow_id: definition.id,
        workflow_version_id: version.id,
        definition_hash,
        subject_model: params.subject_model,
        subject_id: params.subject_id,
        subject_revision_hash: params.subject_revision_hash,
        state: WorkflowInstanceState::Active,
        revision: 1,
        active_token_count: 1,
        singleton_scope_key,
        started_by: ctx.sender(),
        started_at: ctx.timestamp,
        completed_at: None,
        cancelled_by: None,
        cancelled_at: None,
        correlation_id: params.correlation_id.clone(),
        causation_id: params.causation_id.clone(),
    });
    let token = ctx.db.workflow_token().insert(WorkflowToken {
        id: 0,
        organization_id,
        company_id: params.company_id,
        instance_id: instance.id,
        workflow_version_id: version.id,
        node_id: start_node.id,
        node_key: start_node.node_key.clone(),
        state: WorkflowTokenState::Active,
        revision: 1,
        parent_token_id: None,
        fork_id: None,
        branch_key: None,
        lineage: Vec::new(),
        created_at: ctx.timestamp,
        consumed_at: None,
    });

    record_event(
        ctx,
        &instance,
        None,
        Some(&token),
        WorkflowCommandKind::Start,
        None,
        WorkflowInstanceState::Active,
        None,
        Some(WorkflowTokenState::Active),
        0,
        1,
        &params.idempotency_key,
        &input_hash,
        None,
        None,
        WorkflowAuthorizationOutcome::NotApplicable,
        None,
        None,
        None,
        None,
        None,
        &params.correlation_id,
        params.causation_id.as_deref(),
    );
    insert_receipt(
        ctx,
        scope_key,
        WorkflowCommandKind::Start,
        &params.idempotency_key,
        input_hash,
        &instance,
        vec![token.id],
        &params.correlation_id,
        params.causation_id,
    );
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.start_workflow".to_string(),
            correlation_id: params.correlation_id,
            changes: vec![
                RowChange::upsert_stdb_row(
                    "workflow_instance",
                    serde_json::json!({"id": instance.id}),
                    &instance,
                )?,
                RowChange::upsert_stdb_row(
                    "workflow_token",
                    serde_json::json!({"id": token.id}),
                    &token,
                )?,
            ],
        },
    )?;
    Ok(())
}

/// Advance active tokens over one deterministic, unconditional signal edge.
/// Conditional and structured branch selection is delegated to the evaluator
/// integration, which calls [`apply_runtime_event`] with its chosen edges.
#[reducer]
pub fn signal_workflow(
    ctx: &ReducerContext,
    organization_id: u64,
    params: SignalWorkflowParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow_instance", "write")?;
    validate_command_key(&params.idempotency_key, "idempotency key")?;
    validate_command_key(&params.correlation_id, "correlation id")?;
    validate_command_key(&params.signal_key, "signal key")?;
    validate_revision_hash(&params.snapshot.subject_revision_hash)?;

    let input_hash = signal_input_hash(organization_id, &params);
    let scope_key = receipt_scope_key(
        organization_id,
        &WorkflowCommandKind::Signal,
        &params.idempotency_key,
    );
    if replay_receipt(ctx, &scope_key, &input_hash)?.is_some() {
        return Ok(());
    }

    require_company_in_organization(ctx, organization_id, params.company_id)?;
    let instance =
        require_scoped_instance(ctx, organization_id, params.company_id, params.instance_id)?;
    if params.snapshot.subject_model != instance.subject_model
        || params.snapshot.subject_id != instance.subject_id
    {
        return Err("condition snapshot does not match the workflow subject".to_string());
    }
    let snapshot_hash = canonical_condition_snapshot_hash(&params.snapshot)
        .map_err(|error| format!("condition snapshot is invalid: {error}"))?;
    if params.snapshot.subject_revision_hash != snapshot_hash {
        return Err("condition snapshot revision hash is not canonical".to_string());
    }
    if instance.subject_revision_hash != snapshot_hash {
        return Err("subject revision changed since workflow start".to_string());
    }
    if instance.state != WorkflowInstanceState::Active {
        return Err("workflow instance is terminal".to_string());
    }
    if instance.revision != params.expected_revision {
        return Err(format!(
            "stale workflow instance revision: expected {}, current {}",
            params.expected_revision, instance.revision
        ));
    }

    let mut tokens: Vec<_> = ctx
        .db
        .workflow_token()
        .workflow_token_by_instance()
        .filter(&instance.id)
        .filter(|token| token.state == WorkflowTokenState::Active)
        .collect();
    tokens.sort_by_key(|token| token.id);

    let version = ctx
        .db
        .workflow_version()
        .id()
        .find(&instance.workflow_version_id)
        .ok_or("workflow version not found")?;
    validate_condition_snapshot(&version.snapshot_fields, &params.snapshot)
        .map_err(|error| format!("condition snapshot is invalid: {error}"))?;
    let mut transitions = Vec::new();
    let mut evaluated_condition = false;
    for token in tokens {
        let mut matches: Vec<_> = ctx
            .db
            .workflow_edge()
            .workflow_edge_by_from()
            .filter(&token.node_key)
            .filter(|edge| {
                edge.workflow_version_id == instance.workflow_version_id
                    && edge.signal_key.as_deref() == Some(params.signal_key.as_str())
            })
            .collect();
        matches.sort_by(|a, b| {
            a.sequence
                .cmp(&b.sequence)
                .then_with(|| a.edge_key.cmp(&b.edge_key))
                .then_with(|| a.to_node_key.cmp(&b.to_node_key))
                .then_with(|| a.id.cmp(&b.id))
        });
        let mut selected = Vec::new();
        for edge in matches {
            let condition_matches = match edge.condition.as_ref() {
                Some(program) => {
                    evaluated_condition = true;
                    evaluate_condition_program(program, &version.snapshot_fields, &params.snapshot)
                        .map_err(|error| {
                            format!(
                                "condition evaluation failed on edge '{}': {error}",
                                edge.edge_key
                            )
                        })?
                }
                None => true,
            };
            if condition_matches {
                selected.push(edge);
            }
        }
        if selected.len() > 1 {
            return Err("ambiguous signal requires structured branch planning".to_string());
        }
        if let Some(edge) = selected.first() {
            transitions.push(RuntimeTransition {
                token_id: token.id,
                expected_token_revision: token.revision,
                edge_id: edge.id,
            });
        }
    }
    if transitions.is_empty() {
        return Err("signal has no transition from an active token".to_string());
    }

    let updated = apply_runtime_event(
        ctx,
        &instance,
        RuntimeEventContext {
            command_kind: WorkflowCommandKind::Signal,
            expected_instance_revision: params.expected_revision,
            idempotency_key: params.idempotency_key.clone(),
            input_hash: input_hash.clone(),
            action_key: Some(params.signal_key),
            condition_result: evaluated_condition.then_some(true),
            authorization_outcome: WorkflowAuthorizationOutcome::NotApplicable,
            acting_for: None,
            matched_role_id: None,
            delegation_id: None,
            domain_receipt: None,
            reason: None,
            correlation_id: params.correlation_id.clone(),
            causation_id: params.causation_id.clone(),
            condition_snapshot: Some(params.snapshot.clone()),
        },
        RuntimeMutation::Transitions(transitions),
    )?;
    let result_token_ids = active_token_ids(ctx, updated.id);
    insert_receipt(
        ctx,
        scope_key,
        WorkflowCommandKind::Signal,
        &params.idempotency_key,
        input_hash,
        &updated,
        result_token_ids,
        &params.correlation_id,
        params.causation_id,
    );
    Ok(())
}

/// Cancel an active instance. Cancellation is terminal and never implies that
/// a domain effect was reversed or compensated.
#[reducer]
pub fn cancel_workflow(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CancelWorkflowParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow_instance", "write")?;
    validate_command_key(&params.idempotency_key, "idempotency key")?;
    validate_command_key(&params.correlation_id, "correlation id")?;
    validate_required(&params.reason, "cancellation reason")?;

    let input_hash = cancel_input_hash(organization_id, &params);
    let scope_key = receipt_scope_key(
        organization_id,
        &WorkflowCommandKind::Cancel,
        &params.idempotency_key,
    );
    if replay_receipt(ctx, &scope_key, &input_hash)?.is_some() {
        return Ok(());
    }

    require_company_in_organization(ctx, organization_id, params.company_id)?;
    let instance =
        require_scoped_instance(ctx, organization_id, params.company_id, params.instance_id)?;
    let updated = apply_runtime_event(
        ctx,
        &instance,
        RuntimeEventContext {
            command_kind: WorkflowCommandKind::Cancel,
            expected_instance_revision: params.expected_revision,
            idempotency_key: params.idempotency_key.clone(),
            input_hash: input_hash.clone(),
            action_key: None,
            condition_result: None,
            authorization_outcome: WorkflowAuthorizationOutcome::NotApplicable,
            acting_for: None,
            matched_role_id: None,
            delegation_id: None,
            domain_receipt: None,
            reason: Some(params.reason),
            correlation_id: params.correlation_id.clone(),
            causation_id: params.causation_id.clone(),
            condition_snapshot: None,
        },
        RuntimeMutation::Cancel,
    )?;
    insert_receipt(
        ctx,
        scope_key,
        WorkflowCommandKind::Cancel,
        &params.idempotency_key,
        input_hash,
        &updated,
        Vec::new(),
        &params.correlation_id,
        params.causation_id,
    );
    Ok(())
}

// ============================================================================
// MUTATION IMPLEMENTATION
// ============================================================================

#[derive(Clone)]
struct ValidatedTransition {
    token: WorkflowToken,
    next_token_revision: u64,
    target_node_id: u64,
    target_node_key: String,
    target_kind: WorkflowNodeKind,
    edge_id: u64,
}

fn expand_fork_from_parent(
    ctx: &ReducerContext,
    instance: &WorkflowInstance,
    parent: &WorkflowToken,
    fork_node: &crate::workflow::definitions::WorkflowNode,
    join_node_key: Option<String>,
    snapshot: Option<&ConditionSnapshot>,
) -> Result<(WorkflowFork, Vec<WorkflowToken>), String> {
    let version = ctx
        .db
        .workflow_version()
        .id()
        .find(&instance.workflow_version_id)
        .ok_or("workflow version not found")?;
    let edges: Vec<_> = ctx
        .db
        .workflow_edge()
        .workflow_edge_by_from()
        .filter(&fork_node.node_key)
        .filter(|edge| edge.workflow_version_id == instance.workflow_version_id)
        .collect();
    let edge_refs: Vec<_> = edges.iter().collect();
    let selected = select_fork_edges(fork_node, &edge_refs, &version.snapshot_fields, snapshot)?;
    let emitted: Vec<String> = selected.iter().map(|edge| edge.edge_key.clone()).collect();
    let expected = emitted.clone();

    let fork = ctx.db.workflow_fork().insert(WorkflowFork {
        id: 0,
        organization_id: instance.organization_id,
        company_id: instance.company_id,
        instance_id: instance.id,
        workflow_version_id: instance.workflow_version_id,
        fork_node_key: fork_node.node_key.clone(),
        join_node_key,
        split_kind: fork_node.split_kind.clone(),
        expected_branch_keys: expected,
        emitted_branch_keys: emitted,
        open: true,
        revision: 0,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        closed_at: None,
    });

    let mut children = Vec::with_capacity(selected.len());
    for edge in selected {
        let target = ctx
            .db
            .workflow_node()
            .workflow_node_by_version()
            .filter(&instance.workflow_version_id)
            .find(|node| node.node_key == edge.to_node_key)
            .ok_or("fork target node not found")?;
        let mut lineage = parent.lineage.clone();
        lineage.push(parent.id);
        let child = ctx.db.workflow_token().insert(WorkflowToken {
            id: 0,
            organization_id: instance.organization_id,
            company_id: instance.company_id,
            instance_id: instance.id,
            workflow_version_id: instance.workflow_version_id,
            node_id: target.id,
            node_key: target.node_key.clone(),
            state: if target.kind == WorkflowNodeKind::End {
                WorkflowTokenState::Completed
            } else {
                WorkflowTokenState::Active
            },
            revision: 1,
            parent_token_id: Some(parent.id),
            fork_id: Some(fork.id),
            branch_key: Some(edge.edge_key.clone()),
            lineage,
            created_at: ctx.timestamp,
            consumed_at: (target.kind == WorkflowNodeKind::End).then_some(ctx.timestamp),
        });
        children.push(child);
    }
    Ok((fork, children))
}

fn close_fork(ctx: &ReducerContext, fork: WorkflowFork) -> Result<WorkflowFork, String> {
    if !fork.open {
        return Ok(fork);
    }
    let siblings: Vec<_> = ctx
        .db
        .workflow_token()
        .workflow_token_by_instance()
        .filter(&fork.instance_id)
        .filter(|token| token.fork_id == Some(fork.id) && token.state == WorkflowTokenState::Active)
        .collect();
    for token in siblings {
        ctx.db.workflow_token().id().update(WorkflowToken {
            state: WorkflowTokenState::Cancelled,
            revision: token.revision.saturating_add(1),
            consumed_at: Some(ctx.timestamp),
            ..token
        });
    }
    Ok(ctx.db.workflow_fork().id().update(WorkflowFork {
        open: false,
        revision: fork.revision.saturating_add(1),
        closed_at: Some(ctx.timestamp),
        ..fork
    }))
}

fn apply_transitions(
    ctx: &ReducerContext,
    instance: &WorkflowInstance,
    event: &RuntimeEventContext,
    transitions: Vec<RuntimeTransition>,
) -> Result<WorkflowInstance, String> {
    if transitions.is_empty() {
        return Err("runtime transition set must not be empty".to_string());
    }
    if transitions.len() > MAX_TRANSITIONS_PER_COMMAND {
        return Err(format!(
            "runtime command exceeds {MAX_TRANSITIONS_PER_COMMAND} transitions"
        ));
    }

    let mut token_ids = BTreeSet::new();
    let mut validated = Vec::with_capacity(transitions.len());
    for transition in transitions {
        if !token_ids.insert(transition.token_id) {
            return Err("runtime command contains a duplicate token transition".to_string());
        }
        let token = ctx
            .db
            .workflow_token()
            .id()
            .find(&transition.token_id)
            .ok_or("workflow token not found")?;
        if token.organization_id != instance.organization_id
            || token.company_id != instance.company_id
            || token.instance_id != instance.id
            || token.workflow_version_id != instance.workflow_version_id
        {
            return Err("workflow token scope does not match the instance".to_string());
        }
        if token.state != WorkflowTokenState::Active {
            return Err("workflow token is not active".to_string());
        }
        if token.revision != transition.expected_token_revision {
            return Err(format!(
                "stale workflow token revision: expected {}, current {}",
                transition.expected_token_revision, token.revision
            ));
        }
        let next_token_revision = token
            .revision
            .checked_add(1)
            .ok_or("workflow token revision overflow")?;
        let edge = ctx
            .db
            .workflow_edge()
            .id()
            .find(&transition.edge_id)
            .ok_or("workflow edge not found")?;
        if edge.organization_id != instance.organization_id
            || edge.workflow_version_id != instance.workflow_version_id
            || edge.from_node_key != token.node_key
        {
            return Err("workflow edge scope/source does not match the token".to_string());
        }
        let target = ctx
            .db
            .workflow_node()
            .workflow_node_by_version()
            .filter(&instance.workflow_version_id)
            .find(|node| node.node_key == edge.to_node_key)
            .ok_or("workflow edge target node not found")?;
        if target.organization_id != instance.organization_id
            || target
                .company_id
                .is_some_and(|company| company != instance.company_id)
        {
            return Err("workflow target node scope does not match the instance".to_string());
        }
        validated.push(ValidatedTransition {
            token,
            next_token_revision,
            target_node_id: target.id,
            target_node_key: target.node_key,
            target_kind: target.kind,
            edge_id: edge.id,
        });
    }

    let current_active = usize::try_from(instance.active_token_count)
        .map_err(|_| "active token count is out of range".to_string())?;
    let actual_active = ctx
        .db
        .workflow_token()
        .workflow_token_by_instance()
        .filter(&instance.id)
        .filter(|token| token.state == WorkflowTokenState::Active)
        .count();
    if actual_active != current_active {
        return Err("workflow active token projection is inconsistent".to_string());
    }
    if validated.len() > current_active {
        return Err("runtime transition count exceeds active token count".to_string());
    }
    let next_revision = instance
        .revision
        .checked_add(1)
        .ok_or("workflow instance revision overflow")?;

    for item in validated {
        let consumed = ctx.db.workflow_token().id().update(WorkflowToken {
            state: WorkflowTokenState::Consumed,
            revision: item.next_token_revision,
            consumed_at: Some(ctx.timestamp),
            ..item.token.clone()
        });

        if item.target_kind == WorkflowNodeKind::Join {
            let fork_id = consumed.fork_id.ok_or("join arrival requires a fork_id")?;
            let branch_key = consumed
                .branch_key
                .clone()
                .ok_or("join arrival requires a branch_key")?;
            let fork = ctx
                .db
                .workflow_fork()
                .id()
                .find(&fork_id)
                .ok_or("workflow fork not found")?;
            if !fork.open || fork.instance_id != instance.id {
                return Err("workflow fork is not open for this join".to_string());
            }
            let join_key = item.target_node_key.clone();
            let (_arrival, newly_recorded) = record_join_arrival(
                ctx,
                instance.organization_id,
                instance.company_id,
                instance.id,
                &fork,
                &join_key,
                &branch_key,
                consumed.id,
            )?;
            if newly_recorded {
                let arrival_count = ctx
                    .db
                    .workflow_join_arrival()
                    .workflow_join_arrival_by_fork()
                    .filter(&fork.id)
                    .filter(|row| row.join_node_key == join_key)
                    .count();
                if join_is_ready(&fork, arrival_count) {
                    let closed = close_fork(ctx, fork)?;
                    let out_edge = ctx
                        .db
                        .workflow_edge()
                        .workflow_edge_by_from()
                        .filter(&join_key)
                        .find(|edge| edge.workflow_version_id == instance.workflow_version_id)
                        .ok_or("join node has no outgoing edge")?;
                    let past = ctx
                        .db
                        .workflow_node()
                        .workflow_node_by_version()
                        .filter(&instance.workflow_version_id)
                        .find(|node| node.node_key == out_edge.to_node_key)
                        .ok_or("join outgoing target missing")?;
                    let mut lineage = consumed.lineage.clone();
                    lineage.push(consumed.id);
                    let target_state = if past.kind == WorkflowNodeKind::End {
                        WorkflowTokenState::Completed
                    } else {
                        WorkflowTokenState::Active
                    };
                    let target = ctx.db.workflow_token().insert(WorkflowToken {
                        id: 0,
                        organization_id: instance.organization_id,
                        company_id: instance.company_id,
                        instance_id: instance.id,
                        workflow_version_id: instance.workflow_version_id,
                        node_id: past.id,
                        node_key: past.node_key.clone(),
                        state: target_state.clone(),
                        revision: 1,
                        parent_token_id: Some(consumed.id),
                        fork_id: None,
                        branch_key: None,
                        lineage,
                        created_at: ctx.timestamp,
                        consumed_at: (past.kind == WorkflowNodeKind::End).then_some(ctx.timestamp),
                    });
                    let _ = closed;
                    record_event(
                        ctx,
                        instance,
                        Some(&item.token),
                        Some(&target),
                        WorkflowCommandKind::Branch,
                        Some(instance.state.clone()),
                        WorkflowInstanceState::Active,
                        Some(WorkflowTokenState::Active),
                        Some(target.state.clone()),
                        instance.revision,
                        next_revision,
                        &event.idempotency_key,
                        &event.input_hash,
                        event.action_key.as_deref(),
                        event.condition_result,
                        event.authorization_outcome.clone(),
                        event.acting_for,
                        event.matched_role_id,
                        event.delegation_id,
                        event.domain_receipt.as_deref(),
                        event.reason.as_deref(),
                        &event.correlation_id,
                        event.causation_id.as_deref(),
                    );
                }
            }
            continue;
        }

        if item.target_kind == WorkflowNodeKind::Fork {
            let fork_node = ctx
                .db
                .workflow_node()
                .id()
                .find(&item.target_node_id)
                .ok_or("fork node not found")?;
            let join_key = paired_join_key(ctx, instance.workflow_version_id, &fork_node.node_key)?;
            let (_fork, children) = expand_fork_from_parent(
                ctx,
                instance,
                &consumed,
                &fork_node,
                join_key,
                event.condition_snapshot.as_ref(),
            )?;
            for child in &children {
                record_event(
                    ctx,
                    instance,
                    Some(&item.token),
                    Some(child),
                    WorkflowCommandKind::Branch,
                    Some(instance.state.clone()),
                    WorkflowInstanceState::Active,
                    Some(WorkflowTokenState::Active),
                    Some(child.state.clone()),
                    instance.revision,
                    next_revision,
                    &event.idempotency_key,
                    &event.input_hash,
                    event.action_key.as_deref(),
                    event.condition_result,
                    event.authorization_outcome.clone(),
                    event.acting_for,
                    event.matched_role_id,
                    event.delegation_id,
                    event.domain_receipt.as_deref(),
                    event.reason.as_deref(),
                    &event.correlation_id,
                    event.causation_id.as_deref(),
                );
            }
            continue;
        }

        let mut lineage = item.token.lineage.clone();
        lineage.push(item.token.id);
        let target_is_end = item.target_kind == WorkflowNodeKind::End;
        let target_state = if target_is_end {
            WorkflowTokenState::Completed
        } else {
            WorkflowTokenState::Active
        };
        let target = ctx.db.workflow_token().insert(WorkflowToken {
            id: 0,
            organization_id: instance.organization_id,
            company_id: instance.company_id,
            instance_id: instance.id,
            workflow_version_id: instance.workflow_version_id,
            node_id: item.target_node_id,
            node_key: item.target_node_key.clone(),
            state: target_state.clone(),
            revision: 1,
            parent_token_id: Some(consumed.id),
            fork_id: consumed.fork_id,
            branch_key: consumed.branch_key.clone(),
            lineage,
            created_at: ctx.timestamp,
            consumed_at: target_is_end.then_some(ctx.timestamp),
        });
        record_event(
            ctx,
            instance,
            Some(&item.token),
            Some(&target),
            event.command_kind.clone(),
            Some(instance.state.clone()),
            WorkflowInstanceState::Active,
            Some(WorkflowTokenState::Active),
            Some(target.state.clone()),
            instance.revision,
            next_revision,
            &event.idempotency_key,
            &event.input_hash,
            event.action_key.as_deref(),
            event.condition_result,
            event.authorization_outcome.clone(),
            event.acting_for,
            event.matched_role_id,
            event.delegation_id,
            event.domain_receipt.as_deref(),
            event.reason.as_deref(),
            &event.correlation_id,
            event.causation_id.as_deref(),
        );
        let _ = item.edge_id;
    }

    let next_active = ctx
        .db
        .workflow_token()
        .workflow_token_by_instance()
        .filter(&instance.id)
        .filter(|token| token.state == WorkflowTokenState::Active)
        .count();
    let next_state = if next_active == 0 {
        WorkflowInstanceState::Completed
    } else {
        WorkflowInstanceState::Active
    };

    let updated = ctx.db.workflow_instance().id().update(WorkflowInstance {
        state: next_state.clone(),
        revision: next_revision,
        active_token_count: u32::try_from(next_active)
            .map_err(|_| "active token count is out of range".to_string())?,
        completed_at: (next_state == WorkflowInstanceState::Completed).then_some(ctx.timestamp),
        correlation_id: event.correlation_id.clone(),
        causation_id: event.causation_id.clone(),
        ..instance.clone()
    });
    Ok(updated)
}

fn apply_cancellation(
    ctx: &ReducerContext,
    instance: &WorkflowInstance,
    event: &RuntimeEventContext,
) -> Result<WorkflowInstance, String> {
    let next_revision = instance
        .revision
        .checked_add(1)
        .ok_or("workflow instance revision overflow")?;
    let active_tokens: Vec<_> = ctx
        .db
        .workflow_token()
        .workflow_token_by_instance()
        .filter(&instance.id)
        .filter(|token| token.state == WorkflowTokenState::Active)
        .collect();
    if active_tokens.len() != instance.active_token_count as usize {
        return Err("workflow active token projection is inconsistent".to_string());
    }
    if active_tokens.iter().any(|token| token.revision == u64::MAX) {
        return Err("workflow token revision overflow".to_string());
    }

    for token in active_tokens {
        ctx.db.workflow_token().id().update(WorkflowToken {
            state: WorkflowTokenState::Cancelled,
            revision: token.revision + 1,
            consumed_at: Some(ctx.timestamp),
            ..token
        });
    }
    let updated = ctx.db.workflow_instance().id().update(WorkflowInstance {
        state: WorkflowInstanceState::Cancelled,
        revision: next_revision,
        active_token_count: 0,
        cancelled_by: Some(ctx.sender()),
        cancelled_at: Some(ctx.timestamp),
        correlation_id: event.correlation_id.clone(),
        causation_id: event.causation_id.clone(),
        ..instance.clone()
    });
    record_event(
        ctx,
        instance,
        None,
        None,
        event.command_kind.clone(),
        Some(instance.state.clone()),
        WorkflowInstanceState::Cancelled,
        None,
        None,
        instance.revision,
        next_revision,
        &event.idempotency_key,
        &event.input_hash,
        event.action_key.as_deref(),
        event.condition_result,
        event.authorization_outcome.clone(),
        event.acting_for,
        event.matched_role_id,
        event.delegation_id,
        event.domain_receipt.as_deref(),
        event.reason.as_deref(),
        &event.correlation_id,
        event.causation_id.as_deref(),
    );
    Ok(updated)
}

// ============================================================================
// RECEIPTS, EVENTS AND CANONICAL INPUTS
// ============================================================================

fn replay_receipt(
    ctx: &ReducerContext,
    scope_key: &str,
    input_hash: &str,
) -> Result<Option<WorkflowCommandReceipt>, String> {
    let Some(receipt) = ctx
        .db
        .workflow_command_receipt()
        .scope_key()
        .find(scope_key.to_string())
    else {
        return Ok(None);
    };
    if receipt.input_hash != input_hash {
        return Err("idempotency key was already used with different input".to_string());
    }
    Ok(Some(receipt))
}

#[allow(clippy::too_many_arguments)]
fn insert_receipt(
    ctx: &ReducerContext,
    scope_key: String,
    command_kind: WorkflowCommandKind,
    idempotency_key: &str,
    input_hash: String,
    instance: &WorkflowInstance,
    result_token_ids: Vec<u64>,
    correlation_id: &str,
    causation_id: Option<String>,
) {
    ctx.db
        .workflow_command_receipt()
        .insert(WorkflowCommandReceipt {
            scope_key,
            organization_id: instance.organization_id,
            company_id: instance.company_id,
            command_kind,
            idempotency_key: idempotency_key.to_string(),
            input_hash,
            result_instance_id: instance.id,
            result_instance_revision: instance.revision,
            result_instance_state: instance.state.clone(),
            result_token_ids,
            correlation_id: correlation_id.to_string(),
            causation_id,
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
        });
}

#[allow(clippy::too_many_arguments)]
fn record_event(
    ctx: &ReducerContext,
    instance: &WorkflowInstance,
    token: Option<&WorkflowToken>,
    result_token: Option<&WorkflowToken>,
    command_kind: WorkflowCommandKind,
    prior_instance_state: Option<WorkflowInstanceState>,
    next_instance_state: WorkflowInstanceState,
    prior_token_state: Option<WorkflowTokenState>,
    next_token_state: Option<WorkflowTokenState>,
    prior_revision: u64,
    next_revision: u64,
    idempotency_key: &str,
    input_hash: &str,
    action_key: Option<&str>,
    condition_result: Option<bool>,
    authorization_outcome: WorkflowAuthorizationOutcome,
    acting_for: Option<Identity>,
    matched_role_id: Option<u64>,
    delegation_id: Option<u64>,
    domain_receipt: Option<&str>,
    reason: Option<&str>,
    correlation_id: &str,
    causation_id: Option<&str>,
) {
    ctx.db
        .workflow_decision_event()
        .insert(WorkflowDecisionEvent {
            id: 0,
            organization_id: instance.organization_id,
            company_id: instance.company_id,
            workflow_id: instance.workflow_id,
            workflow_version_id: instance.workflow_version_id,
            instance_id: instance.id,
            token_id: token.map(|row| row.id),
            result_token_id: result_token.map(|row| row.id),
            prior_node_key: token.map(|row| row.node_key.clone()),
            next_node_key: result_token.map(|row| row.node_key.clone()),
            command_kind,
            prior_instance_state,
            next_instance_state,
            prior_token_state,
            next_token_state,
            actor: ctx.sender(),
            acting_for,
            matched_role_id,
            delegation_id,
            authorization_outcome,
            condition_result,
            subject_model: instance.subject_model.clone(),
            subject_id: instance.subject_id,
            subject_revision_hash: instance.subject_revision_hash.clone(),
            action_key: action_key.map(ToOwned::to_owned),
            prior_revision,
            next_revision,
            idempotency_key: idempotency_key.to_string(),
            input_hash: input_hash.to_string(),
            domain_receipt: domain_receipt.map(ToOwned::to_owned),
            reason: reason.map(ToOwned::to_owned),
            correlation_id: correlation_id.to_string(),
            causation_id: causation_id.map(ToOwned::to_owned),
            recorded_at: ctx.timestamp,
        });
}

fn require_scoped_instance(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    instance_id: u64,
) -> Result<WorkflowInstance, String> {
    let instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&instance_id)
        .ok_or("workflow instance not found")?;
    if instance.organization_id != organization_id {
        return Err("workflow instance does not belong to this organization".to_string());
    }
    if instance.company_id != company_id {
        return Err("workflow instance does not belong to this company".to_string());
    }
    Ok(instance)
}

fn active_token_ids(ctx: &ReducerContext, instance_id: u64) -> Vec<u64> {
    let mut ids: Vec<_> = ctx
        .db
        .workflow_token()
        .workflow_token_by_instance()
        .filter(&instance_id)
        .filter(|token| token.state == WorkflowTokenState::Active)
        .map(|token| token.id)
        .collect();
    ids.sort_unstable();
    ids
}

fn definition_requires_singleton(metadata: Option<&str>) -> Result<bool, String> {
    let Some(raw) = metadata else {
        return Ok(false);
    };
    let value: serde_json::Value = serde_json::from_str(raw)
        .map_err(|error| format!("workflow version metadata is invalid JSON: {error}"))?;
    Ok(value
        .get("singleton_trigger")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false))
}

fn validate_required(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{field} must not be empty"))
    } else {
        Ok(())
    }
}

fn validate_command_key(value: &str, field: &str) -> Result<(), String> {
    validate_required(value, field)?;
    if value.len() > MAX_KEY_LEN {
        return Err(format!("{field} exceeds {MAX_KEY_LEN} bytes"));
    }
    Ok(())
}

/// WRK-001: Validate that subject_id exists in the ERP table named by subject_model
/// and belongs to the caller's organization.
fn validate_subject_id_fk(
    ctx: &ReducerContext,
    organization_id: u64,
    subject_model: &str,
    subject_id: u64,
) -> Result<(), String> {
    let belongs = match subject_model {
        "purchase_order" => ctx
            .db
            .purchase_order()
            .id()
            .find(&subject_id)
            .map(|r| r.organization_id == organization_id)
            .unwrap_or(false),
        "sale_order" => ctx
            .db
            .sale_order()
            .id()
            .find(&subject_id)
            .map(|r| r.organization_id == organization_id)
            .unwrap_or(false),
        "account_move" => ctx
            .db
            .account_move()
            .id()
            .find(&subject_id)
            .map(|r| r.organization_id == organization_id)
            .unwrap_or(false),
        "account_payment" => ctx
            .db
            .account_payment()
            .id()
            .find(&subject_id)
            .map(|r| r.organization_id == organization_id)
            .unwrap_or(false),
        "hr_expense_sheet" => ctx
            .db
            .expense_sheet()
            .id()
            .find(&subject_id)
            .map(|r| r.organization_id == organization_id)
            .unwrap_or(false),
        "ai_action_draft" => ctx
            .db
            .ai_action_draft()
            .id()
            .find(&subject_id)
            .map(|r| r.organization_id == organization_id)
            .unwrap_or(false),
        "hr_leave" => ctx
            .db
            .hr_leave()
            .id()
            .find(&subject_id)
            .map(|r| r.organization_id == organization_id)
            .unwrap_or(false),
        "payment_transaction" => ctx
            .db
            .payment_transaction()
            .id()
            .find(&subject_id)
            .map(|r| r.organization_id == organization_id)
            .unwrap_or(false),
        // Unknown model — reject rather than silently accept
        other => {
            return Err(format!(
                "subject_model '{}' is not a recognized ERP model for workflow subjects",
                other
            ))
        }
    };

    if !belongs {
        return Err(format!(
            "subject_id {} not found in '{}' for this organization",
            subject_id, subject_model
        ));
    }
    Ok(())
}

fn validate_revision_hash(value: &str) -> Result<(), String> {
    let Some(hex) = value.strip_prefix("sha256:") else {
        return Err("subject revision hash must use the sha256: prefix".to_string());
    };
    if hex.len() != 64
        || !hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("subject revision hash must be 64 lowercase hexadecimal digits".to_string());
    }
    Ok(())
}

fn receipt_scope_key(
    organization_id: u64,
    command_kind: &WorkflowCommandKind,
    idempotency_key: &str,
) -> String {
    format!(
        "{organization_id}:{}:{idempotency_key}",
        command_kind_tag(command_kind)
    )
}

fn start_input_hash(organization_id: u64, params: &StartWorkflowParams) -> String {
    let fields = vec![
        organization_id.to_string(),
        params.company_id.to_string(),
        params.workflow_id.to_string(),
        params.workflow_version_id.to_string(),
        params.subject_model.clone(),
        params.subject_id.to_string(),
        params.subject_revision_hash.clone(),
        params.singleton_trigger_key.clone().unwrap_or_default(),
    ];
    canonical_field_hash(&fields)
}

fn signal_input_hash(organization_id: u64, params: &SignalWorkflowParams) -> String {
    let fields = vec![
        organization_id.to_string(),
        params.company_id.to_string(),
        params.instance_id.to_string(),
        params.expected_revision.to_string(),
        params.signal_key.clone(),
        params.snapshot.subject_revision_hash.clone(),
    ];
    canonical_field_hash(&fields)
}

fn cancel_input_hash(organization_id: u64, params: &CancelWorkflowParams) -> String {
    let fields = vec![
        organization_id.to_string(),
        params.company_id.to_string(),
        params.instance_id.to_string(),
        params.expected_revision.to_string(),
        params.reason.clone(),
    ];
    canonical_field_hash(&fields)
}

fn canonical_field_hash(fields: &[String]) -> String {
    let mut hasher = Sha256::new();
    for field in fields {
        hasher.update((field.len() as u64).to_be_bytes());
        hasher.update(field.as_bytes());
    }
    format!("sha256:{:x}", hasher.finalize())
}

fn command_kind_tag(kind: &WorkflowCommandKind) -> &'static str {
    match kind {
        WorkflowCommandKind::Start => "start",
        WorkflowCommandKind::Signal => "signal",
        WorkflowCommandKind::Cancel => "cancel",
        WorkflowCommandKind::HumanDecision => "human-decision",
        WorkflowCommandKind::Timer => "timer",
        WorkflowCommandKind::ActionResult => "action-result",
        WorkflowCommandKind::Branch => "branch",
        WorkflowCommandKind::Migration => "migration",
    }
}
