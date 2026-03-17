/// Workflow Runtime Module — Instance and work item execution tables
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **WorkflowInstance** | A running instance of a workflow bound to an ERP record |
/// | **WorkflowWorkitem** | An active work item (token) within a workflow instance |
use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::{InstanceState, WorkitemState};
use crate::workflow::definitions::{
    workflow_activity, workflow_transition, WorkflowActivity, WorkflowTransition,
};

// ============================================================================
// TABLES
// ============================================================================

/// WorkflowInstance — A live execution of a workflow attached to an ERP record
#[derive(Clone)]
#[spacetimedb::table(
    accessor = workflow_instance,
    public,
    index(accessor = instance_by_org, btree(columns = [organization_id])),
    index(accessor = instance_by_workflow, btree(columns = [workflow_id])),
    index(name = "by_res", accessor = instance_by_res, btree(columns = [res_id]))
)]
pub struct WorkflowInstance {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64,    // Tenant isolation
    pub workflow_id: u64,
    pub res_id: u64,         // ID of the related ERP record
    pub res_type: String,    // Model name, e.g., "sale_order"
    pub state: InstanceState,
    pub activity_ids: Vec<u64>, // Currently active activity IDs
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// WorkflowWorkitem — A process token active within a workflow instance
#[derive(Clone)]
#[spacetimedb::table(
    accessor = workflow_workitem,
    public,
    index(name = "by_instance", accessor = workitem_by_instance, btree(columns = [instance_id])),
    index(name = "by_activity", accessor = workitem_by_activity, btree(columns = [act_id]))
)]
pub struct WorkflowWorkitem {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64,    // Tenant isolation (inherited from parent WorkflowInstance)
    pub instance_id: u64,
    pub act_id: u64,                        // Current activity
    pub wkf_evaled_condition: Option<String>, // Last evaluated condition result
    pub state: WorkitemState,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ============================================================================
// REDUCERS
// ============================================================================

/// Start a new workflow instance for an ERP record
#[reducer]
pub fn start_workflow(
    ctx: &ReducerContext,
    organization_id: u64,
    workflow_id: u64,
    res_id: u64,
    res_type: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow_instance", "create")?;

    // Find the start activity for this workflow
    let start_activities: Vec<WorkflowActivity> = ctx
        .db
        .workflow_activity()
        .activity_by_workflow()
        .filter(&workflow_id)
        .filter(|a| a.flow_start)
        .collect();

    if start_activities.is_empty() {
        return Err("Workflow has no start activity defined".to_string());
    }

    let start_act = &start_activities[0];

    let instance = ctx.db.workflow_instance().insert(WorkflowInstance {
        id: 0,
        organization_id,
        workflow_id,
        res_id,
        res_type,
        state: InstanceState::Active,
        activity_ids: vec![start_act.id],
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    // Create the initial work item at the start activity
    ctx.db.workflow_workitem().insert(WorkflowWorkitem {
        id: 0,
        organization_id,
        instance_id: instance.id,
        act_id: start_act.id,
        wkf_evaled_condition: None,
        state: WorkitemState::Active,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "workflow_instance",
            record_id: instance.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec!["started".to_string()],
            metadata: None,
        },
    );

    log::info!(
        "Workflow instance started: id={}, workflow={}, res_id={}",
        instance.id,
        workflow_id,
        res_id
    );
    Ok(())
}

/// Fire a signal to advance a workflow instance along matching transitions
#[reducer]
pub fn signal_workflow(
    ctx: &ReducerContext,
    organization_id: u64,
    instance_id: u64,
    signal: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow_instance", "write")?;

    let instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&instance_id)
        .ok_or("Workflow instance not found")?;

    if instance.organization_id != organization_id {
        return Err("Workflow instance does not belong to this organization".to_string());
    }

    if instance.state != InstanceState::Active {
        return Err("Workflow instance is not active".to_string());
    }

    // Collect active workitems for this instance
    let active_items: Vec<WorkflowWorkitem> = ctx
        .db
        .workflow_workitem()
        .workitem_by_instance()
        .filter(&instance_id)
        .filter(|w| w.state == WorkitemState::Active)
        .collect();

    let mut new_activity_ids: Vec<u64> = instance.activity_ids.clone();
    let mut any_advanced = false;

    for item in &active_items {
        // Find outgoing transitions from current activity that match the signal
        let matching: Vec<WorkflowTransition> = ctx
            .db
            .workflow_transition()
            .transition_by_from()
            .filter(&item.act_id)
            .filter(|t| t.signal.as_deref() == Some(&signal))
            .collect();

        for transition in matching {
            let target_act = ctx
                .db
                .workflow_activity()
                .id()
                .find(&transition.activity_to);

            if let Some(act) = target_act {
                // Complete current workitem
                ctx.db
                    .workflow_workitem()
                    .id()
                    .update(WorkflowWorkitem {
                        state: WorkitemState::Complete,
                        write_uid: ctx.sender(),
                        write_date: ctx.timestamp,
                        ..item.clone()
                    });

                // Remove old activity, add new
                new_activity_ids.retain(|&a| a != item.act_id);
                new_activity_ids.push(act.id);

                // If target is a stop node, mark instance complete
                if act.flow_stop {
                    ctx.db.workflow_instance().id().update(WorkflowInstance {
                        state: InstanceState::Complete,
                        activity_ids: new_activity_ids.clone(),
                        write_uid: ctx.sender(),
                        write_date: ctx.timestamp,
                        ..instance.clone()
                    });
                    any_advanced = true;
                    break;
                }

                // Otherwise create new workitem at target activity
                ctx.db.workflow_workitem().insert(WorkflowWorkitem {
                    id: 0,
                    organization_id,
                    instance_id,
                    act_id: act.id,
                    wkf_evaled_condition: None,
                    state: WorkitemState::Active,
                    create_uid: ctx.sender(),
                    create_date: ctx.timestamp,
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    metadata: None,
                });

                any_advanced = true;
            }
        }
    }

    if any_advanced {
        // Update activity_ids on the instance (if not already updated in flow_stop branch)
        if let Some(inst) = ctx.db.workflow_instance().id().find(&instance_id) {
            if inst.state == InstanceState::Active {
                ctx.db.workflow_instance().id().update(WorkflowInstance {
                    activity_ids: new_activity_ids,
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..inst
                });
            }
        }
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "workflow_instance",
            record_id: instance_id,
            action: "write",
            old_values: None,
            new_values: None,
            changed_fields: vec![format!("signal:{}", signal)],
            metadata: None,
        },
    );

    log::info!(
        "Workflow signal fired: instance={}, signal={}",
        instance_id,
        signal
    );
    Ok(())
}

/// Mark a workitem as an exception (blocked/failed)
#[reducer]
pub fn set_workitem_exception(
    ctx: &ReducerContext,
    organization_id: u64,
    workitem_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow_workitem", "write")?;

    let item = ctx
        .db
        .workflow_workitem()
        .id()
        .find(&workitem_id)
        .ok_or("Workitem not found")?;

    if item.organization_id != organization_id {
        return Err("Workitem does not belong to this organization".to_string());
    }

    if item.state != WorkitemState::Active {
        return Err("Workitem is not active".to_string());
    }

    // Mark the parent instance as exception too
    if let Some(instance) = ctx.db.workflow_instance().id().find(&item.instance_id) {
        ctx.db
            .workflow_instance()
            .id()
            .update(WorkflowInstance {
                state: InstanceState::Exception,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..instance
            });
    }

    ctx.db
        .workflow_workitem()
        .id()
        .update(WorkflowWorkitem {
            state: WorkitemState::Exception,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..item
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "workflow_workitem",
            record_id: workitem_id,
            action: "write",
            old_values: None,
            new_values: None,
            changed_fields: vec!["exception".to_string()],
            metadata: None,
        },
    );

    log::info!("Workitem exception set: id={}", workitem_id);
    Ok(())
}

/// Cancel a running workflow instance
#[reducer]
pub fn cancel_workflow_instance(
    ctx: &ReducerContext,
    organization_id: u64,
    instance_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "workflow_instance", "write")?;

    let instance = ctx
        .db
        .workflow_instance()
        .id()
        .find(&instance_id)
        .ok_or("Workflow instance not found")?;

    if instance.organization_id != organization_id {
        return Err("Workflow instance does not belong to this organization".to_string());
    }

    if instance.state != InstanceState::Active && instance.state != InstanceState::Exception {
        return Err("Workflow instance cannot be cancelled in its current state".to_string());
    }

    // Complete all active workitems
    let active_items: Vec<WorkflowWorkitem> = ctx
        .db
        .workflow_workitem()
        .workitem_by_instance()
        .filter(&instance_id)
        .filter(|w| w.state == WorkitemState::Active)
        .collect();

    for item in active_items {
        ctx.db
            .workflow_workitem()
            .id()
            .update(WorkflowWorkitem {
                state: WorkitemState::Complete,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..item
            });
    }

    ctx.db
        .workflow_instance()
        .id()
        .update(WorkflowInstance {
            state: InstanceState::Complete,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..instance
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "workflow_instance",
            record_id: instance_id,
            action: "write",
            old_values: None,
            new_values: None,
            changed_fields: vec!["cancelled".to_string()],
            metadata: None,
        },
    );

    log::info!("Workflow instance cancelled: id={}", instance_id);
    Ok(())
}
