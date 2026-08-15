/// Work Centers Module — Work center definitions and productivity tracking
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **MrpWorkcenter** | Work center definitions |
/// | **MrpWorkcenterProductivity** | Work center productivity tracking |
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::company_id_from_scope;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::manufacturing::relations::{
    require_workorder_in_company, validate_positive_capacity, validate_positive_duration,
};
use crate::types::WorkingState;
use serde_json;

// ── Tables ───────────────────────────────────────────────────────────────────

/// Authoritative loss category for workcenter productivity tracking (MFG-009).
#[spacetimedb::table(
    accessor = mrp_loss_category,
    public,
    index(accessor = loss_cat_by_org, btree(columns = [organization_id])),
    index(accessor = loss_cat_by_company, btree(columns = [organization_id, company_id]))
)]
pub struct MrpLossCategory {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    /// Canonical category type: "availability", "performance", "quality", "productive"
    pub category: String,
    pub active: bool,
    pub sequence: u32,
    pub metadata: Option<String>,
}

/// Work Center — Manufacturing resource where operations are performed
#[spacetimedb::table(
    accessor = mrp_workcenter,
    public,
    index(accessor = mrp_workcenter_by_org, btree(columns = [organization_id])),
    index(accessor = mrp_workcenter_by_company, btree(columns = [company_id]))
)]
pub struct MrpWorkcenter {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64,
    pub name: String,
    pub active: bool,
    pub code: Option<String>,
    pub company_id: u64,
    pub working_state: String,
    pub oee_target: f64,
    pub time_efficiency: f64,
    pub capacity: f64,
    pub capacity_ids: Vec<u64>,
    pub oee: f64,
    pub performance: f64,
    pub blocked_time: f64,
    pub productive_time: f64,
    pub productivity_ids: Vec<u64>,
    pub order_ids: Vec<u64>,
    pub workorder_count: u32,
    pub workorder_ready_count: u32,
    pub workorder_progress_count: u32,
    pub workorder_pending_count: u32,
    pub workorder_late_count: u32,
    pub alternative_workcenter_ids: Vec<u64>,
    pub color: Option<u8>,
    pub resource_calendar_id: Option<u64>,
    pub tag_ids: Vec<u64>,
    pub default_capacity_parent_id: Option<u64>,
    pub default_time_efficiency: f64,
    pub default_oee_target: f64,
    pub sequence: u32,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Work Center Productivity — Time tracking and productivity logs
#[spacetimedb::table(
    accessor = mrp_workcenter_productivity,
    public,
    index(accessor = mrp_productivity_by_org, btree(columns = [organization_id])),
    index(name = "by_workorder", accessor = mrp_productivity_by_workorder, btree(columns = [workorder_id])),
    index(accessor = mrp_productivity_by_workcenter, btree(columns = [workcenter_id]))
)]
pub struct MrpWorkcenterProductivity {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64,
    pub workcenter_id: u64,
    pub workorder_id: u64,
    pub description: Option<String>,
    /// Optional authoritative [`MrpLossCategory`] reference.
    pub loss_id: Option<u64>,
    pub date_start: Timestamp,
    pub date_end: Option<Timestamp>,
    pub duration: f64,
    pub user_id: Identity,
    pub company_id: u64,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

/// Intent-shaped create params for work centers.
///
/// Server-computed aggregate fields are excluded — the server always
/// initializes them to zero/empty: `oee`, `performance`, `blocked_time`,
/// `productive_time`, `productivity_ids`, `order_ids`, `workorder_count`,
/// `workorder_ready_count`, `workorder_progress_count`,
/// `workorder_pending_count`, `workorder_late_count`.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateWorkcenterParams {
    pub company_id: Option<u64>,
    pub name: String,
    pub active: bool,
    pub code: Option<String>,
    pub working_state: String,
    pub oee_target: f64,
    pub time_efficiency: f64,
    pub capacity: f64,
    pub capacity_ids: Vec<u64>,
    pub alternative_workcenter_ids: Vec<u64>,
    pub color: Option<u8>,
    pub resource_calendar_id: Option<u64>,
    pub tag_ids: Vec<u64>,
    pub default_capacity_parent_id: Option<u64>,
    pub default_time_efficiency: f64,
    pub default_oee_target: f64,
    pub sequence: u32,
    pub metadata: Option<String>,
}

/// Params for updating a work center. All fields are optional; only Some values
/// are applied. System-computed fields (oee, performance, workorder counts,
/// productivity_ids, order_ids) are omitted — they are managed by domain logic.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateWorkcenterParams {
    pub company_id: Option<u64>,
    pub name: Option<String>,
    pub active: Option<bool>,
    pub code: Option<String>,
    pub working_state: Option<String>,
    pub capacity: Option<f64>,
    pub time_efficiency: Option<f64>,
    pub oee_target: Option<f64>,
    pub color: Option<u8>,
    pub resource_calendar_id: Option<u64>,
    pub tag_ids: Option<Vec<u64>>,
    pub alternative_workcenter_ids: Option<Vec<u64>>,
    pub capacity_ids: Option<Vec<u64>>,
    pub default_capacity_parent_id: Option<u64>,
    pub default_time_efficiency: Option<f64>,
    pub default_oee_target: Option<f64>,
    pub sequence: Option<u32>,
    pub metadata: Option<String>,
}

/// Params for logging productivity time against a work center.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateWorkcenterProductivityParams {
    pub workorder_id: u64,
    pub loss_id: Option<u64>,
    pub description: Option<String>,
    pub duration: f64,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateLossCategoryParams {
    pub company_id: Option<u64>,
    pub name: String,
    /// One of: "availability", "performance", "quality", "productive"
    pub category: String,
    pub sequence: u32,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Create a new work center
#[reducer]
pub fn create_workcenter(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateWorkcenterParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mrp_workcenter", "create")?;

    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    WorkingState::from_str(&params.working_state)?;

    validate_positive_capacity(params.capacity, "capacity")?;

    let wc = ctx.db.mrp_workcenter().insert(MrpWorkcenter {
        id: 0,
        organization_id,
        name: params.name,
        active: params.active,
        code: params.code,
        company_id,
        working_state: params.working_state,
        oee_target: params.oee_target,
        time_efficiency: params.time_efficiency,
        capacity: params.capacity,
        capacity_ids: params.capacity_ids,
        oee: 0.0,
        performance: 0.0,
        blocked_time: 0.0,
        productive_time: 0.0,
        productivity_ids: Vec::new(),
        order_ids: Vec::new(),
        workorder_count: 0,
        workorder_ready_count: 0,
        workorder_progress_count: 0,
        workorder_pending_count: 0,
        workorder_late_count: 0,
        alternative_workcenter_ids: params.alternative_workcenter_ids,
        color: params.color,
        resource_calendar_id: params.resource_calendar_id,
        tag_ids: params.tag_ids,
        default_capacity_parent_id: params.default_capacity_parent_id,
        default_time_efficiency: params.default_time_efficiency,
        default_oee_target: params.default_oee_target,
        sequence: params.sequence,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "mrp_workcenter",
            record_id: wc.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "name": wc.name, "capacity": wc.capacity }).to_string(),
            ),
            changed_fields: vec!["name".to_string(), "capacity".to_string()],
            metadata: None,
        },
    );

    log::info!("Work center created: id={}", wc.id);
    Ok(())
}

/// Update a work center
#[reducer]
pub fn update_workcenter(
    ctx: &ReducerContext,
    organization_id: u64,
    workcenter_id: u64,
    params: UpdateWorkcenterParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mrp_workcenter", "write")?;

    let wc = ctx
        .db
        .mrp_workcenter()
        .id()
        .find(&workcenter_id)
        .ok_or("Work center not found")?;

    if wc.organization_id != organization_id {
        return Err("Work center does not belong to this organization".to_string());
    }

    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    if wc.company_id != company_id {
        return Err("Work center does not belong to this company".to_string());
    }

    if let Some(ref ws) = params.working_state {
        WorkingState::from_str(ws)?;
    }

    ctx.db.mrp_workcenter().id().update(MrpWorkcenter {
        name: params.name.unwrap_or(wc.name.clone()),
        active: params.active.unwrap_or(wc.active),
        code: params.code.or(wc.code.clone()),
        working_state: params.working_state.unwrap_or(wc.working_state.clone()),
        capacity: params.capacity.unwrap_or(wc.capacity),
        time_efficiency: params.time_efficiency.unwrap_or(wc.time_efficiency),
        oee_target: params.oee_target.unwrap_or(wc.oee_target),
        color: params.color.or(wc.color),
        resource_calendar_id: params.resource_calendar_id.or(wc.resource_calendar_id),
        tag_ids: params.tag_ids.unwrap_or(wc.tag_ids.clone()),
        alternative_workcenter_ids: params
            .alternative_workcenter_ids
            .unwrap_or(wc.alternative_workcenter_ids.clone()),
        capacity_ids: params.capacity_ids.unwrap_or(wc.capacity_ids.clone()),
        default_capacity_parent_id: params
            .default_capacity_parent_id
            .or(wc.default_capacity_parent_id),
        default_time_efficiency: params
            .default_time_efficiency
            .unwrap_or(wc.default_time_efficiency),
        default_oee_target: params.default_oee_target.unwrap_or(wc.default_oee_target),
        sequence: params.sequence.unwrap_or(wc.sequence),
        metadata: params.metadata.or(wc.metadata.clone()),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..wc
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "mrp_workcenter",
            record_id: workcenter_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["updated".to_string()],
            metadata: None,
        },
    );

    log::info!("Work center updated: id={}", workcenter_id);
    Ok(())
}

/// Block a work center (mark as blocked for maintenance or other reasons)
#[reducer]
pub fn block_workcenter(
    ctx: &ReducerContext,
    organization_id: u64,
    workcenter_id: u64,
    reason: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mrp_workcenter", "write")?;

    let wc = ctx
        .db
        .mrp_workcenter()
        .id()
        .find(&workcenter_id)
        .ok_or("Work center not found")?;

    if wc.organization_id != organization_id {
        return Err("Work center does not belong to this organization".to_string());
    }

    let company_id = wc.company_id;

    ctx.db.mrp_workcenter().id().update(MrpWorkcenter {
        working_state: "blocked".to_string(),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..wc
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "mrp_workcenter",
            record_id: workcenter_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "working_state": "blocked", "reason": reason }).to_string(),
            ),
            changed_fields: vec!["working_state".to_string()],
            metadata: None,
        },
    );

    log::info!("Work center blocked: id={}", workcenter_id);
    Ok(())
}

/// Unblock a work center
#[reducer]
pub fn unblock_workcenter(
    ctx: &ReducerContext,
    organization_id: u64,
    workcenter_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mrp_workcenter", "write")?;

    let wc = ctx
        .db
        .mrp_workcenter()
        .id()
        .find(&workcenter_id)
        .ok_or("Work center not found")?;

    if wc.organization_id != organization_id {
        return Err("Work center does not belong to this organization".to_string());
    }

    let company_id = wc.company_id;

    ctx.db.mrp_workcenter().id().update(MrpWorkcenter {
        working_state: "normal".to_string(),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..wc
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "mrp_workcenter",
            record_id: workcenter_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "working_state": "normal" }).to_string()),
            changed_fields: vec!["working_state".to_string()],
            metadata: None,
        },
    );

    log::info!("Work center unblocked: id={}", workcenter_id);
    Ok(())
}

/// Create a loss category for productivity tracking (MFG-009).
#[reducer]
pub fn create_loss_category(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateLossCategoryParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mrp_loss_category", "create")?;
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    let name = params.name.trim().to_string();
    if name.is_empty() {
        return Err("loss category name is required".to_string());
    }

    let category = params.category.trim().to_string();
    match category.as_str() {
        "availability" | "performance" | "quality" | "productive" => {}
        other => {
            return Err(format!(
                "invalid loss category type '{}'; expected availability, performance, quality, or productive",
                other
            ))
        }
    }

    let cat = ctx.db.mrp_loss_category().insert(MrpLossCategory {
        id: 0,
        organization_id,
        company_id,
        name,
        category,
        active: true,
        sequence: params.sequence,
        metadata: params.metadata,
    });

    log::info!("Loss category created: id={}", cat.id);
    Ok(())
}

/// Log productivity time for a work center.
///
/// Company is derived from the loaded workcenter — callers do not supply it.
/// The workorder must belong to the same company as the workcenter.
#[reducer]
pub fn log_workcenter_productivity(
    ctx: &ReducerContext,
    organization_id: u64,
    workcenter_id: u64,
    params: CreateWorkcenterProductivityParams,
) -> Result<(), String> {
    check_permission(
        ctx,
        organization_id,
        "mrp_workcenter_productivity",
        "create",
    )?;

    validate_positive_duration(params.duration, "duration")?;

    let wc = ctx
        .db
        .mrp_workcenter()
        .id()
        .find(&workcenter_id)
        .ok_or("Work center not found")?;

    if wc.organization_id != organization_id {
        return Err("Work center does not belong to this organization".to_string());
    }
    if !wc.active {
        return Err("Work center is inactive".to_string());
    }

    // Derive company from the workcenter — never trust a parallel caller argument.
    let company_id = wc.company_id;

    // Validate workorder belongs to the same company as the workcenter.
    let workorder = require_workorder_in_company(
        ctx,
        organization_id,
        company_id,
        params.workorder_id,
        "productivity workorder",
    )?;
    if workorder.workcenter_id != workcenter_id {
        return Err("productivity workorder does not belong to this work center".to_string());
    }

    // Validate loss_id against the authoritative loss category table (MFG-009).
    if let Some(lid) = params.loss_id {
        let cat = ctx
            .db
            .mrp_loss_category()
            .id()
            .find(&lid)
            .ok_or("loss category not found")?;
        if cat.organization_id != organization_id {
            return Err("loss category does not belong to this organization".to_string());
        }
        if cat.company_id != company_id {
            return Err("loss category does not belong to this company".to_string());
        }
        if !cat.active {
            return Err("loss category is inactive".to_string());
        }
    }

    let productivity = ctx
        .db
        .mrp_workcenter_productivity()
        .insert(MrpWorkcenterProductivity {
            id: 0,
            organization_id,
            workcenter_id,
            workorder_id: params.workorder_id,
            description: params.description,
            loss_id: params.loss_id,
            date_start: ctx.timestamp,
            date_end: None,
            duration: params.duration,
            user_id: ctx.sender(),
            company_id,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: params.metadata,
        });

    // Update work center productivity tracking
    let mut prod_ids = wc.productivity_ids.clone();
    prod_ids.push(productivity.id);
    let productive_time = wc.productive_time + params.duration;

    ctx.db.mrp_workcenter().id().update(MrpWorkcenter {
        productivity_ids: prod_ids,
        productive_time,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..wc
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "mrp_workcenter_productivity",
            record_id: productivity.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "workcenter_id": workcenter_id,
                    "workorder_id": productivity.workorder_id,
                    "duration": productivity.duration,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "workcenter_id".to_string(),
                "workorder_id".to_string(),
                "duration".to_string(),
            ],
            metadata: None,
        },
    );

    log::info!(
        "Work center productivity logged: id={}, wc={}, duration={}",
        productivity.id,
        workcenter_id,
        productivity.duration
    );
    Ok(())
}

/// Complete a productivity log entry.
///
/// Company is derived from the stored log entry — callers do not supply it.
#[reducer]
pub fn complete_productivity_log(
    ctx: &ReducerContext,
    organization_id: u64,
    log_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mrp_workcenter_productivity", "write")?;

    let log_entry = ctx
        .db
        .mrp_workcenter_productivity()
        .id()
        .find(&log_id)
        .ok_or("Productivity log not found")?;

    if log_entry.organization_id != organization_id {
        return Err("Log does not belong to this organization".to_string());
    }

    // Derive company from the log entry for audit attribution.
    let company_id = log_entry.company_id;

    ctx.db
        .mrp_workcenter_productivity()
        .id()
        .update(MrpWorkcenterProductivity {
            date_end: Some(ctx.timestamp),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..log_entry
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "mrp_workcenter_productivity",
            record_id: log_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "date_end": "set" }).to_string()),
            changed_fields: vec!["date_end".to_string()],
            metadata: None,
        },
    );

    log::info!("Productivity log completed: id={}", log_id);
    Ok(())
}
