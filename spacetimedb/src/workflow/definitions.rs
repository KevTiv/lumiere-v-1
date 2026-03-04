/// Workflow Definitions Module — Workflow, Activity, and Transition tables
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **Workflow** | Workflow definitions attached to ERP models |
/// | **WorkflowActivity** | Individual steps/nodes within a workflow |
/// | **WorkflowTransition** | Directed edges between activities with conditions |
use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};

// ============================================================================
// TABLES
// ============================================================================

/// Workflow — Defines an automated workflow for a specific ERP model
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
    name: String,
    model: String,
    state_field: String,
    on_create: bool,
) -> Result<(), String> {
    let cid = company_id.unwrap_or(0);
    check_permission(ctx, cid, "workflow", "create")?;

    let wf = ctx.db.workflow().insert(Workflow {
        id: 0,
        name,
        description: None,
        model,
        state_field,
        on_create,
        is_active: true,
        activity_ids: Vec::new(),
        transition_ids: Vec::new(),
        transition_count: 0,
        company_id,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    write_audit_log(
        ctx,
        cid,
        None,
        "workflow",
        wf.id,
        "create",
        None,
        None,
        vec!["created".to_string()],
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
    name: String,
    kind: String,
    action: Option<String>,
    split_mode: String,
    join_mode: String,
    flow_start: bool,
    flow_stop: bool,
    state_from: Option<String>,
    state_to: Option<String>,
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
        name,
        description: None,
        workflow_id,
        sequence: 0,
        kind,
        action,
        action_id: None,
        trigger_model: None,
        trigger_expr_id: None,
        split_mode,
        join_mode,
        signal_send: None,
        subflow_id: None,
        outgoing_transition_ids: Vec::new(),
        incoming_transition_ids: Vec::new(),
        flow_start,
        flow_stop,
        state_from,
        state_to,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
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

    write_audit_log(
        ctx,
        cid,
        None,
        "workflow_activity",
        activity.id,
        "create",
        None,
        None,
        vec!["created".to_string()],
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
    signal: Option<String>,
    condition: Option<String>,
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
        sequence: 0,
        signal,
        condition,
        trigger_model: None,
        trigger_expr_id: None,
        group_id: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
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
        transition_count: wf.transition_count + 1,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..wf
    });

    write_audit_log(
        ctx,
        cid,
        None,
        "workflow_transition",
        transition.id,
        "create",
        None,
        None,
        vec!["created".to_string()],
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

    write_audit_log(
        ctx,
        cid,
        None,
        "workflow",
        workflow_id,
        "write",
        None,
        None,
        vec![if is_active {
            "activated".to_string()
        } else {
            "deactivated".to_string()
        }],
    );

    log::info!(
        "Workflow active state changed: id={}, active={}",
        workflow_id,
        is_active
    );
    Ok(())
}
