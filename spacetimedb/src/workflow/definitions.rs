/// Workflow Definitions Module — Workflow, Activity, and Transition tables
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **Workflow** | Workflow definitions attached to ERP models |
/// | **WorkflowActivity** | Individual steps/nodes within a workflow |
/// | **WorkflowTransition** | Directed edges between activities with conditions |
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

// ============================================================================
// PARAMS TYPES
// ============================================================================

/// Params for creating a workflow definition.
/// Scope: `company_id` is a flat reducer param (not in this struct).
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateWorkflowParams {
    pub name: String,
    pub model: String,
    pub state_field: String,
    pub on_create: bool,
    pub is_active: bool,
    pub description: Option<String>,
    pub metadata: Option<String>,
}

/// Params for adding an activity node to a workflow.
/// Scope: `company_id` + `workflow_id` are flat reducer params.
/// `outgoing_transition_ids` + `incoming_transition_ids` are system-managed
/// (populated by `add_workflow_transition`).
#[derive(SpacetimeType, Clone, Debug)]
pub struct AddWorkflowActivityParams {
    pub name: String,
    pub kind: String,
    pub split_mode: String,
    pub join_mode: String,
    pub flow_start: bool,
    pub flow_stop: bool,
    pub sequence: u32,
    pub action: Option<String>,
    pub action_id: Option<u64>,
    pub trigger_model: Option<String>,
    pub trigger_expr_id: Option<u64>,
    pub signal_send: Option<String>,
    pub subflow_id: Option<u64>,
    pub state_from: Option<String>,
    pub state_to: Option<String>,
    pub description: Option<String>,
    pub metadata: Option<String>,
}

/// Params for adding a transition edge between two activities.
/// Scope: `company_id` + `workflow_id` + `activity_from` + `activity_to` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct AddWorkflowTransitionParams {
    pub sequence: u32,
    pub signal: Option<String>,
    pub condition: Option<String>,
    pub trigger_model: Option<String>,
    pub trigger_expr_id: Option<u64>,
    pub group_id: Option<u64>,
    pub metadata: Option<String>,
}

// ============================================================================
// TABLES
// ============================================================================

/// Workflow — Defines an automated workflow for a specific ERP model
#[derive(Clone)]
#[spacetimedb::table(
    accessor = workflow,
    public,
    index(name = "by_company", accessor = workflow_by_company, btree(columns = [company_id])),
    index(name = "by_model", accessor = workflow_by_model, btree(columns = [model]))
)]
pub struct Workflow {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub name: String,
    pub description: Option<String>,
    pub model: String,       // e.g., "sale_order", "purchase_order"
    pub state_field: String, // Field on the model to update on transitions
    pub on_create: bool,     // Auto-trigger on record creation
    pub is_active: bool,
    pub activity_ids: Vec<u64>,
    pub transition_ids: Vec<u64>,
    pub transition_count: u32,
    pub company_id: Option<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// WorkflowActivity — A single step/node in a workflow graph
#[derive(Clone)]
#[spacetimedb::table(
    accessor = workflow_activity,
    public,
    index(name = "by_workflow", accessor = activity_by_workflow, btree(columns = [workflow_id]))
)]
pub struct WorkflowActivity {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub name: String,
    pub description: Option<String>,
    pub workflow_id: u64,
    pub sequence: u32,
    pub kind: String,              // Dummy, Function, Stopall, Subflow
    pub action: Option<String>,    // Reducer name to call
    pub action_id: Option<u64>,    // Reference to a server action record
    pub trigger_model: Option<String>,
    pub trigger_expr_id: Option<u64>,
    pub split_mode: String,        // XOR, OR, AND — how outgoing transitions fire
    pub join_mode: String,         // XOR, AND — how incoming transitions merge
    pub signal_send: Option<String>,
    pub subflow_id: Option<u64>,   // If kind == Subflow, nested workflow ID
    pub outgoing_transition_ids: Vec<u64>,
    pub incoming_transition_ids: Vec<u64>,
    pub flow_start: bool,          // Entry point for the workflow
    pub flow_stop: bool,           // Terminal node
    pub state_from: Option<String>,
    pub state_to: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// WorkflowTransition — A directed edge between two activities with optional conditions
#[derive(Clone)]
#[spacetimedb::table(
    accessor = workflow_transition,
    public,
    index(name = "by_from", accessor = transition_by_from, btree(columns = [activity_from])),
    index(name = "by_to", accessor = transition_by_to, btree(columns = [activity_to]))
)]
pub struct WorkflowTransition {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub activity_from: u64,
    pub activity_to: u64,
    pub sequence: u32,
    pub signal: Option<String>,          // Signal name that fires this transition
    pub condition: Option<String>,       // Expression evaluated to allow/block
    pub trigger_model: Option<String>,
    pub trigger_expr_id: Option<u64>,
    pub group_id: Option<u64>,           // Permission group that can trigger
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ============================================================================
// REDUCERS
// ============================================================================

/// Create a workflow definition
#[reducer]
pub fn create_workflow(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    params: CreateWorkflowParams,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "workflow", "create")?;

    let wf = ctx.db.workflow().insert(Workflow {
        id: 0,
        name: params.name,
        description: params.description,
        model: params.model,
        state_field: params.state_field,
        on_create: params.on_create,
        is_active: params.is_active,
        // System-managed: start empty, populated by add_workflow_activity / add_workflow_transition
        activity_ids: Vec::new(),
        transition_ids: Vec::new(),
        transition_count: 0,
        company_id,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        cid,
        AuditLogParams {
            company_id,
            table_name: "workflow",
            record_id: wf.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec!["created".to_string()],
            metadata: None,
        },
    );

    log::info!("Workflow created: id={}, model={}", wf.id, wf.model);
    Ok(())
}

/// Add an activity (node) to a workflow
#[reducer]
pub fn add_workflow_activity(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    workflow_id: u64,
    params: AddWorkflowActivityParams,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "workflow_activity", "create")?;

    let wf = ctx
        .db
        .workflow()
        .id()
        .find(&workflow_id)
        .ok_or("Workflow not found")?;

    let activity = ctx.db.workflow_activity().insert(WorkflowActivity {
        id: 0,
        name: params.name,
        description: params.description,
        workflow_id,
        sequence: params.sequence,
        kind: params.kind,
        action: params.action,
        action_id: params.action_id,
        trigger_model: params.trigger_model,
        trigger_expr_id: params.trigger_expr_id,
        split_mode: params.split_mode,
        join_mode: params.join_mode,
        signal_send: params.signal_send,
        subflow_id: params.subflow_id,
        // System-managed: populated by add_workflow_transition
        outgoing_transition_ids: Vec::new(),
        incoming_transition_ids: Vec::new(),
        flow_start: params.flow_start,
        flow_stop: params.flow_stop,
        state_from: params.state_from,
        state_to: params.state_to,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    // Register activity on parent workflow
    let mut activity_ids = wf.activity_ids.clone();
    activity_ids.push(activity.id);
    ctx.db.workflow().id().update(Workflow {
        activity_ids,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..wf
    });

    write_audit_log_v2(
        ctx,
        cid,
        AuditLogParams {
            company_id,
            table_name: "workflow_activity",
            record_id: activity.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec!["created".to_string()],
            metadata: None,
        },
    );

    log::info!(
        "Workflow activity added: id={}, workflow={}",
        activity.id,
        workflow_id
    );
    Ok(())
}

/// Add a transition (edge) between two activities
#[reducer]
pub fn add_workflow_transition(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    workflow_id: u64,
    activity_from: u64,
    activity_to: u64,
    params: AddWorkflowTransitionParams,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "workflow_transition", "create")?;

    let wf = ctx
        .db
        .workflow()
        .id()
        .find(&workflow_id)
        .ok_or("Workflow not found")?;

    // Verify both activities belong to this workflow
    let from_act = ctx
        .db
        .workflow_activity()
        .id()
        .find(&activity_from)
        .ok_or("Source activity not found")?;
    let to_act = ctx
        .db
        .workflow_activity()
        .id()
        .find(&activity_to)
        .ok_or("Target activity not found")?;

    if from_act.workflow_id != workflow_id || to_act.workflow_id != workflow_id {
        return Err("Activities must belong to the same workflow".to_string());
    }

    let transition = ctx.db.workflow_transition().insert(WorkflowTransition {
        id: 0,
        activity_from,
        activity_to,
        sequence: params.sequence,
        signal: params.signal,
        condition: params.condition,
        trigger_model: params.trigger_model,
        trigger_expr_id: params.trigger_expr_id,
        group_id: params.group_id,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    // Update outgoing/incoming lists on the activity nodes
    let mut out_ids = from_act.outgoing_transition_ids.clone();
    out_ids.push(transition.id);
    ctx.db.workflow_activity().id().update(WorkflowActivity {
        outgoing_transition_ids: out_ids,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..from_act
    });

    let mut in_ids = to_act.incoming_transition_ids.clone();
    in_ids.push(transition.id);
    ctx.db.workflow_activity().id().update(WorkflowActivity {
        incoming_transition_ids: in_ids,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..to_act
    });

    // Register transition on workflow and increment count
    let mut transition_ids = wf.transition_ids.clone();
    transition_ids.push(transition.id);
    ctx.db.workflow().id().update(Workflow {
        transition_ids,
        // System-managed: derived count
        transition_count: wf.transition_count + 1,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..wf
    });

    write_audit_log_v2(
        ctx,
        cid,
        AuditLogParams {
            company_id,
            table_name: "workflow_transition",
            record_id: transition.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec!["created".to_string()],
            metadata: None,
        },
    );

    log::info!(
        "Workflow transition added: id={}, from={}, to={}",
        transition.id,
        activity_from,
        activity_to
    );
    Ok(())
}

/// Activate or deactivate a workflow
#[reducer]
pub fn set_workflow_active(
    ctx: &ReducerContext,
    company_id: Option<u64>,
    workflow_id: u64,
    is_active: bool,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "workflow", "write")?;

    let wf = ctx
        .db
        .workflow()
        .id()
        .find(&workflow_id)
        .ok_or("Workflow not found")?;

    ctx.db.workflow().id().update(Workflow {
        is_active,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..wf
    });

    write_audit_log_v2(
        ctx,
        cid,
        AuditLogParams {
            company_id,
            table_name: "workflow",
            record_id: workflow_id,
            action: "write",
            old_values: None,
            new_values: None,
            changed_fields: vec![if is_active {
                "activated".to_string()
            } else {
                "deactivated".to_string()
            }],
            metadata: None,
        },
    );

    log::info!(
        "Workflow active state changed: id={}, active={}",
        workflow_id,
        is_active
    );
    Ok(())
}
