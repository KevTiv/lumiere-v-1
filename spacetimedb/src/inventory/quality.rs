/// Quality Control — Tables and Reducers
///
/// Tables:
///   - QualityCheck
///   - QualityAlert
///   - QualityAlertReason
///   - QualityPoint
///   - QualityTeam
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use serde_json;

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.22: QUALITY CHECK
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = quality_check,
    public,
    index(accessor = quality_check_by_org, btree(columns = [organization_id])),
    index(accessor = quality_check_by_product, btree(columns = [product_id])),
    index(accessor = quality_check_by_picking, btree(columns = [picking_id])),
    index(accessor = quality_check_by_state, btree(columns = [quality_state]))
)]
pub struct QualityCheck {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub title: Option<String>,
    pub quality_state: String,
    pub status: String,
    pub product_id: Option<u64>,
    pub product_variant_id: Option<u64>,
    pub picking_id: Option<u64>,
    pub move_line_id: Option<u64>,
    pub lot_id: Option<u64>,
    pub team_id: Option<u64>,
    pub user_id: Option<Identity>,
    pub company_id: u64,
    pub warning_message: Option<String>,
    pub alert_message: Option<String>,
    pub note: Option<String>,
    pub is_failed: bool,
    pub failure_location_id: Option<u64>,
    pub control_point_id: Option<u64>,
    pub workorder_id: Option<u64>,
    pub production_id: Option<u64>,
    pub qty_tested: f64,
    pub qty_failed: f64,
    pub measure: Option<f64>,
    pub measure_success: Option<String>,
    pub norm_unit: Option<String>,
    pub tolerance_min: Option<f64>,
    pub tolerance_max: Option<f64>,
    pub picture: Option<String>,
    pub picture_fail: Option<String>,
    pub component_id: Option<u64>,
    pub operation_id: Option<u64>,
    pub test_type: String,
    pub feedback: Option<String>,
    pub is_late: bool,
    pub check_date: Option<Timestamp>,
    pub create_date: Timestamp,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.23: QUALITY ALERT
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = quality_alert,
    public,
    index(accessor = quality_alert_by_org, btree(columns = [organization_id])),
    index(accessor = quality_alert_by_product, btree(columns = [product_id])),
    index(accessor = quality_alert_by_state, btree(columns = [state])),
    index(accessor = quality_alert_by_team, btree(columns = [team_id]))
)]
pub struct QualityAlert {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub title: String,
    pub description: Option<String>,
    pub priority: String,
    pub state: String,
    pub reason_id: Option<u64>,
    pub lot_id: Option<u64>,
    pub product_id: Option<u64>,
    pub product_variant_id: Option<u64>,
    pub workcenter_id: Option<u64>,
    pub team_id: u64,
    pub user_id: Option<Identity>,
    pub company_id: u64,
    pub tag_ids: Vec<u64>,
    pub activity_ids: Vec<u64>,
    pub message_ids: Vec<u64>,
    pub date_assign: Option<Timestamp>,
    pub date_close: Option<Timestamp>,
    pub create_date: Timestamp,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.24: QUALITY ALERT REASON
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = quality_alert_reason,
    public,
    index(accessor = alert_reason_by_org, btree(columns = [organization_id]))
)]
pub struct QualityAlertReason {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub description: Option<String>,
    pub is_active: bool,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.25: QUALITY POINT
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = quality_point,
    public,
    index(accessor = quality_point_by_org, btree(columns = [organization_id])),
    index(accessor = quality_point_by_picking_type, btree(columns = [picking_type_id]))
)]
pub struct QualityPoint {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub title: Option<String>,
    pub sequence: i32,
    pub test_type: String,
    pub team_id: Option<u64>,
    pub user_id: Option<Identity>,
    pub note: Option<String>,
    pub product_ids: Vec<u64>,
    pub product_category_ids: Vec<u64>,
    pub operation_id: Option<u64>,
    pub workcenter_id: Option<u64>,
    pub picking_type_id: Option<u64>,
    pub code: Option<String>,
    pub control_type: String,
    pub company_id: u64,
    pub norm_unit: Option<String>,
    pub tolerance_min: Option<f64>,
    pub tolerance_max: Option<f64>,
    pub is_active: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.26: QUALITY TEAM
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = quality_team,
    public,
    index(accessor = quality_team_by_org, btree(columns = [organization_id]))
)]
pub struct QualityTeam {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub description: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub member_ids: Vec<Identity>,
    pub is_active: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateQualityCheckParams {
    pub name: String,
    pub test_type: String,
    pub product_id: Option<u64>,
    pub product_variant_id: Option<u64>,
    pub picking_id: Option<u64>,
    pub move_line_id: Option<u64>,
    pub lot_id: Option<u64>,
    pub team_id: Option<u64>,
    /// Manager-assigned user; None means unassigned
    pub user_id: Option<Identity>,
    pub control_point_id: Option<u64>,
    pub qty_tested: f64,
    pub tolerance_min: Option<f64>,
    pub tolerance_max: Option<f64>,
    pub norm_unit: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateQualityAlertParams {
    pub title: String,
    pub priority: String,
    pub product_id: Option<u64>,
    pub product_variant_id: Option<u64>,
    pub lot_id: Option<u64>,
    pub reason_id: Option<u64>,
    pub workcenter_id: Option<u64>,
    pub description: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateQualityAlertReasonParams {
    pub name: String,
    pub description: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateQualityAlertReasonParams {
    pub name: Option<String>,
    pub description: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateQualityPointParams {
    pub name: String,
    pub test_type: String,
    pub control_type: String,
    pub sequence: i32,
    pub team_id: Option<u64>,
    /// Manager-assigned user; None means unassigned
    pub user_id: Option<Identity>,
    pub note: Option<String>,
    pub product_ids: Vec<u64>,
    pub product_category_ids: Vec<u64>,
    pub picking_type_id: Option<u64>,
    pub tolerance_min: Option<f64>,
    pub tolerance_max: Option<f64>,
    pub norm_unit: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateQualityPointParams {
    pub name: Option<String>,
    pub sequence: Option<i32>,
    pub test_type: Option<String>,
    pub team_id: Option<u64>,
    pub user_id: Option<Identity>,
    pub note: Option<String>,
    pub tolerance_min: Option<f64>,
    pub tolerance_max: Option<f64>,
    pub norm_unit: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateQualityTeamParams {
    pub name: String,
    pub description: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateQualityTeamParams {
    pub name: Option<String>,
    pub description: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub is_active: Option<bool>,
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: QUALITY CHECK
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_quality_check(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateQualityCheckParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "quality_check", "create")?;

    if params.name.is_empty() {
        return Err("Check name cannot be empty".to_string());
    }

    // quality_state starts as "none"; is_failed/failure_location_id/feedback/
    // qty_failed/check_date are system-managed by pass/fail state transitions
    let row = ctx.db.quality_check().insert(QualityCheck {
        id: 0,
        organization_id,
        name: params.name.clone(),
        title: None,
        quality_state: "none".to_string(), // initial state
        status: "draft".to_string(),        // initial status
        product_id: params.product_id,
        product_variant_id: params.product_variant_id,
        picking_id: params.picking_id,
        move_line_id: params.move_line_id,
        lot_id: params.lot_id,
        team_id: params.team_id,
        user_id: params.user_id,
        company_id,
        warning_message: None,
        alert_message: None,
        note: None,
        is_failed: false,           // system-managed by fail reducer
        failure_location_id: None,  // system-managed by fail reducer
        control_point_id: params.control_point_id,
        workorder_id: None,
        production_id: None,
        qty_tested: params.qty_tested,
        qty_failed: 0.0,            // system-managed by fail reducer
        measure: None,
        measure_success: None,
        norm_unit: params.norm_unit,
        tolerance_min: params.tolerance_min,
        tolerance_max: params.tolerance_max,
        picture: None,
        picture_fail: None,
        component_id: None,
        operation_id: None,
        test_type: params.test_type.clone(),
        feedback: None,             // system-managed by pass/fail reducer
        is_late: false,
        check_date: None,           // set by state transition reducers
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "quality_check",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": params.name,
                    "test_type": params.test_type,
                    "status": "draft",
                })
                .to_string(),
            ),
            changed_fields: vec!["name".to_string(), "test_type".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn start_quality_check(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    check_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "quality_check", "write")?;

    let record = ctx
        .db
        .quality_check()
        .id()
        .find(&check_id)
        .ok_or("Quality check not found")?;

    if record.organization_id != organization_id {
        return Err("Quality check does not belong to this organization".to_string());
    }
    if record.company_id != company_id {
        return Err("Quality check does not belong to this company".to_string());
    }

    if record.status != "draft" {
        return Err("Check must be in draft state to start".to_string());
    }

    ctx.db.quality_check().id().update(QualityCheck {
        status: "in_progress".to_string(),
        write_date: ctx.timestamp,
        ..record
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "quality_check",
            record_id: check_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "status": "in_progress" }).to_string()),
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn pass_quality_check(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    check_id: u64,
    measure: Option<f64>,
    note: Option<String>,
    picture: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "quality_check", "write")?;

    let record = ctx
        .db
        .quality_check()
        .id()
        .find(&check_id)
        .ok_or("Quality check not found")?;

    if record.organization_id != organization_id {
        return Err("Quality check does not belong to this organization".to_string());
    }
    if record.company_id != company_id {
        return Err("Quality check does not belong to this company".to_string());
    }

    if record.status == "completed" {
        return Err("Check is already completed".to_string());
    }

    let is_failed = if let Some(m) = measure {
        if let (Some(min), Some(max)) = (record.tolerance_min, record.tolerance_max) {
            m < min || m > max
        } else {
            false
        }
    } else {
        false
    };

    let new_quality_state = if is_failed {
        "fail".to_string()
    } else {
        "pass".to_string()
    };

    ctx.db.quality_check().id().update(QualityCheck {
        quality_state: new_quality_state.clone(),
        status: "completed".to_string(),
        is_failed,
        measure,
        note: note.or(record.note.clone()),
        picture: picture.or(record.picture.clone()),
        check_date: Some(ctx.timestamp),
        write_date: ctx.timestamp,
        ..record
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "quality_check",
            record_id: check_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "quality_state": new_quality_state,
                    "status": "completed",
                    "is_failed": is_failed,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "quality_state".to_string(),
                "status".to_string(),
                "is_failed".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn fail_quality_check(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    check_id: u64,
    qty_failed: f64,
    note: Option<String>,
    picture_fail: Option<String>,
    failure_location_id: Option<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "quality_check", "write")?;

    let record = ctx
        .db
        .quality_check()
        .id()
        .find(&check_id)
        .ok_or("Quality check not found")?;

    if record.organization_id != organization_id {
        return Err("Quality check does not belong to this organization".to_string());
    }
    if record.company_id != company_id {
        return Err("Quality check does not belong to this company".to_string());
    }

    if record.status == "completed" {
        return Err("Check is already completed".to_string());
    }

    ctx.db.quality_check().id().update(QualityCheck {
        quality_state: "fail".to_string(),
        status: "completed".to_string(),
        is_failed: true,
        qty_failed,
        note: note.or(record.note.clone()),
        picture_fail: picture_fail.or(record.picture_fail.clone()),
        failure_location_id: failure_location_id.or(record.failure_location_id),
        check_date: Some(ctx.timestamp),
        write_date: ctx.timestamp,
        ..record
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "quality_check",
            record_id: check_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "quality_state": "fail",
                    "status": "completed",
                    "qty_failed": qty_failed,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "quality_state".to_string(),
                "status".to_string(),
                "qty_failed".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: QUALITY ALERT
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_quality_alert(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    team_id: u64,
    params: CreateQualityAlertParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "quality_alert", "create")?;

    if params.title.is_empty() {
        return Err("Alert title cannot be empty".to_string());
    }

    // tag_ids/activity_ids/message_ids are system-managed relations, always empty on create
    let row = ctx.db.quality_alert().insert(QualityAlert {
        id: 0,
        organization_id,
        name: format!("QA-{}", ctx.timestamp.to_micros_since_unix_epoch()),
        title: params.title.clone(),
        description: params.description,
        priority: params.priority.clone(),
        state: "draft".to_string(), // initial state
        reason_id: params.reason_id,
        lot_id: params.lot_id,
        product_id: params.product_id,
        product_variant_id: params.product_variant_id,
        workcenter_id: params.workcenter_id,
        team_id,
        user_id: None,      // set by assign_quality_alert
        company_id,
        tag_ids: vec![],        // system-managed
        activity_ids: vec![],   // system-managed
        message_ids: vec![],    // system-managed
        date_assign: None,      // set by assign_quality_alert
        date_close: None,       // set by solve/cancel reducers
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "quality_alert",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "title": params.title,
                    "priority": params.priority,
                    "state": "draft",
                })
                .to_string(),
            ),
            changed_fields: vec!["title".to_string(), "priority".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn open_quality_alert(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    alert_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "quality_alert", "write")?;

    let record = ctx
        .db
        .quality_alert()
        .id()
        .find(&alert_id)
        .ok_or("Quality alert not found")?;

    if record.organization_id != organization_id {
        return Err("Quality alert does not belong to this organization".to_string());
    }
    if record.company_id != company_id {
        return Err("Quality alert does not belong to this company".to_string());
    }

    if record.state != "draft" {
        return Err("Alert must be in draft state to open".to_string());
    }

    ctx.db.quality_alert().id().update(QualityAlert {
        state: "open".to_string(),
        write_date: ctx.timestamp,
        ..record
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "quality_alert",
            record_id: alert_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "state": "open" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn assign_quality_alert(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    alert_id: u64,
    user_id: Identity,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "quality_alert", "write")?;

    let record = ctx
        .db
        .quality_alert()
        .id()
        .find(&alert_id)
        .ok_or("Quality alert not found")?;

    if record.organization_id != organization_id {
        return Err("Quality alert does not belong to this organization".to_string());
    }
    if record.company_id != company_id {
        return Err("Quality alert does not belong to this company".to_string());
    }

    ctx.db.quality_alert().id().update(QualityAlert {
        state: "in_progress".to_string(),
        user_id: Some(user_id),
        date_assign: Some(ctx.timestamp),
        write_date: ctx.timestamp,
        ..record
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "quality_alert",
            record_id: alert_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "state": "in_progress" }).to_string()),
            changed_fields: vec!["state".to_string(), "user_id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn solve_quality_alert(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    alert_id: u64,
    description: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "quality_alert", "write")?;

    let record = ctx
        .db
        .quality_alert()
        .id()
        .find(&alert_id)
        .ok_or("Quality alert not found")?;

    if record.organization_id != organization_id {
        return Err("Quality alert does not belong to this organization".to_string());
    }
    if record.company_id != company_id {
        return Err("Quality alert does not belong to this company".to_string());
    }

    if record.state == "solved" || record.state == "cancelled" {
        return Err("Alert is already closed".to_string());
    }

    ctx.db.quality_alert().id().update(QualityAlert {
        state: "solved".to_string(),
        description: description.or(record.description.clone()),
        date_close: Some(ctx.timestamp),
        write_date: ctx.timestamp,
        ..record
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "quality_alert",
            record_id: alert_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "state": "solved" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn cancel_quality_alert(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    alert_id: u64,
    description: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "quality_alert", "write")?;

    let record = ctx
        .db
        .quality_alert()
        .id()
        .find(&alert_id)
        .ok_or("Quality alert not found")?;

    if record.organization_id != organization_id {
        return Err("Quality alert does not belong to this organization".to_string());
    }
    if record.company_id != company_id {
        return Err("Quality alert does not belong to this company".to_string());
    }

    if record.state == "solved" || record.state == "cancelled" {
        return Err("Alert is already closed".to_string());
    }

    ctx.db.quality_alert().id().update(QualityAlert {
        state: "cancelled".to_string(),
        description: description.or(record.description.clone()),
        date_close: Some(ctx.timestamp),
        write_date: ctx.timestamp,
        ..record
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "quality_alert",
            record_id: alert_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "state": "cancelled" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: QUALITY ALERT REASON
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_quality_alert_reason(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateQualityAlertReasonParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "quality_alert_reason", "create")?;

    if params.name.is_empty() {
        return Err("Reason name cannot be empty".to_string());
    }

    let row = ctx.db.quality_alert_reason().insert(QualityAlertReason {
        id: 0,
        organization_id,
        name: params.name.clone(),
        description: params.description,
        is_active: true, // active by default on create
        created_at: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None, // QualityAlertReason has no company_id
            table_name: "quality_alert_reason",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": params.name }).to_string()),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_quality_alert_reason(
    ctx: &ReducerContext,
    organization_id: u64,
    reason_id: u64,
    params: UpdateQualityAlertReasonParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "quality_alert_reason", "write")?;

    let record = ctx
        .db
        .quality_alert_reason()
        .id()
        .find(&reason_id)
        .ok_or("Quality alert reason not found")?;

    if record.organization_id != organization_id {
        return Err("Quality alert reason does not belong to this organization".to_string());
    }

    ctx.db
        .quality_alert_reason()
        .id()
        .update(QualityAlertReason {
            name: params.name.unwrap_or_else(|| record.name.clone()),
            description: params.description.or(record.description.clone()),
            is_active: params.is_active.unwrap_or(record.is_active),
            ..record
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "quality_alert_reason",
            record_id: reason_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_quality_alert_reason(
    ctx: &ReducerContext,
    organization_id: u64,
    reason_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "quality_alert_reason", "delete")?;

    let record = ctx
        .db
        .quality_alert_reason()
        .id()
        .find(&reason_id)
        .ok_or("Quality alert reason not found")?;

    if record.organization_id != organization_id {
        return Err("Quality alert reason does not belong to this organization".to_string());
    }

    ctx.db.quality_alert_reason().id().delete(&reason_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "quality_alert_reason",
            record_id: reason_id,
            action: "DELETE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: QUALITY POINT
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_quality_point(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateQualityPointParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "quality_point", "create")?;

    if params.name.is_empty() {
        return Err("Point name cannot be empty".to_string());
    }

    let row = ctx.db.quality_point().insert(QualityPoint {
        id: 0,
        organization_id,
        name: params.name.clone(),
        title: None,
        sequence: params.sequence,
        test_type: params.test_type.clone(),
        team_id: params.team_id,
        user_id: params.user_id,
        note: params.note,
        product_ids: params.product_ids,
        product_category_ids: params.product_category_ids,
        operation_id: None,
        workcenter_id: None,
        picking_type_id: params.picking_type_id,
        code: None,
        control_type: params.control_type,
        company_id,
        norm_unit: params.norm_unit,
        tolerance_min: params.tolerance_min,
        tolerance_max: params.tolerance_max,
        is_active: true, // active by default on create
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "quality_point",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": params.name,
                    "test_type": params.test_type,
                })
                .to_string(),
            ),
            changed_fields: vec!["name".to_string(), "test_type".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_quality_point(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    point_id: u64,
    params: UpdateQualityPointParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "quality_point", "write")?;

    let record = ctx
        .db
        .quality_point()
        .id()
        .find(&point_id)
        .ok_or("Quality point not found")?;

    if record.organization_id != organization_id {
        return Err("Quality point does not belong to this organization".to_string());
    }
    if record.company_id != company_id {
        return Err("Quality point does not belong to this company".to_string());
    }

    ctx.db.quality_point().id().update(QualityPoint {
        name: params.name.unwrap_or_else(|| record.name.clone()),
        sequence: params.sequence.unwrap_or(record.sequence),
        test_type: params.test_type.unwrap_or_else(|| record.test_type.clone()),
        team_id: params.team_id.or(record.team_id),
        user_id: params.user_id.or(record.user_id),
        note: params.note.or(record.note.clone()),
        tolerance_min: params.tolerance_min.or(record.tolerance_min),
        tolerance_max: params.tolerance_max.or(record.tolerance_max),
        norm_unit: params.norm_unit.or(record.norm_unit.clone()),
        is_active: params.is_active.unwrap_or(record.is_active),
        updated_at: ctx.timestamp,
        ..record
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "quality_point",
            record_id: point_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_quality_point(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    point_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "quality_point", "delete")?;

    let record = ctx
        .db
        .quality_point()
        .id()
        .find(&point_id)
        .ok_or("Quality point not found")?;

    if record.organization_id != organization_id {
        return Err("Quality point does not belong to this organization".to_string());
    }
    if record.company_id != company_id {
        return Err("Quality point does not belong to this company".to_string());
    }

    // Soft-delete: deactivate rather than remove the row
    ctx.db.quality_point().id().update(QualityPoint {
        is_active: false,
        updated_at: ctx.timestamp,
        ..record
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "quality_point",
            record_id: point_id,
            action: "DELETE",
            old_values: None,
            new_values: Some(serde_json::json!({ "is_active": false }).to_string()),
            changed_fields: vec!["is_active".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: QUALITY TEAM
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_quality_team(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateQualityTeamParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "quality_team", "create")?;

    if params.name.is_empty() {
        return Err("Team name cannot be empty".to_string());
    }

    // member_ids are managed via add/remove_member reducers
    let row = ctx.db.quality_team().insert(QualityTeam {
        id: 0,
        organization_id,
        name: params.name.clone(),
        description: params.description,
        email: params.email,
        phone: params.phone,
        member_ids: vec![], // system-managed; use add_member_to_quality_team
        is_active: true,    // active by default on create
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None, // QualityTeam has no company_id
            table_name: "quality_team",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": params.name }).to_string()),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_quality_team(
    ctx: &ReducerContext,
    organization_id: u64,
    team_id: u64,
    params: UpdateQualityTeamParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "quality_team", "write")?;

    let record = ctx
        .db
        .quality_team()
        .id()
        .find(&team_id)
        .ok_or("Quality team not found")?;

    if record.organization_id != organization_id {
        return Err("Quality team does not belong to this organization".to_string());
    }

    ctx.db.quality_team().id().update(QualityTeam {
        name: params.name.unwrap_or_else(|| record.name.clone()),
        description: params.description.or(record.description.clone()),
        email: params.email.or(record.email.clone()),
        phone: params.phone.or(record.phone.clone()),
        is_active: params.is_active.unwrap_or(record.is_active),
        updated_at: ctx.timestamp,
        ..record
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "quality_team",
            record_id: team_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn add_member_to_quality_team(
    ctx: &ReducerContext,
    organization_id: u64,
    team_id: u64,
    member_identity: Identity,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "quality_team", "write")?;

    let record = ctx
        .db
        .quality_team()
        .id()
        .find(&team_id)
        .ok_or("Quality team not found")?;

    if record.organization_id != organization_id {
        return Err("Quality team does not belong to this organization".to_string());
    }

    if record.member_ids.contains(&member_identity) {
        return Err("Member already in team".to_string());
    }

    let mut member_ids = record.member_ids.clone();
    member_ids.push(member_identity);

    ctx.db.quality_team().id().update(QualityTeam {
        member_ids,
        updated_at: ctx.timestamp,
        ..record
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "quality_team",
            record_id: team_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "action": "add_member" }).to_string()),
            changed_fields: vec!["member_ids".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn remove_member_from_quality_team(
    ctx: &ReducerContext,
    organization_id: u64,
    team_id: u64,
    member_identity: Identity,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "quality_team", "write")?;

    let record = ctx
        .db
        .quality_team()
        .id()
        .find(&team_id)
        .ok_or("Quality team not found")?;

    if record.organization_id != organization_id {
        return Err("Quality team does not belong to this organization".to_string());
    }

    let mut member_ids = record.member_ids.clone();
    member_ids.retain(|id| id != &member_identity);

    ctx.db.quality_team().id().update(QualityTeam {
        member_ids,
        updated_at: ctx.timestamp,
        ..record
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "quality_team",
            record_id: team_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "action": "remove_member" }).to_string()),
            changed_fields: vec!["member_ids".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_quality_team(
    ctx: &ReducerContext,
    organization_id: u64,
    team_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "quality_team", "delete")?;

    let record = ctx
        .db
        .quality_team()
        .id()
        .find(&team_id)
        .ok_or("Quality team not found")?;

    if record.organization_id != organization_id {
        return Err("Quality team does not belong to this organization".to_string());
    }

    // Soft-delete: deactivate rather than remove the row
    ctx.db.quality_team().id().update(QualityTeam {
        is_active: false,
        updated_at: ctx.timestamp,
        ..record
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "quality_team",
            record_id: team_id,
            action: "DELETE",
            old_values: None,
            new_values: Some(serde_json::json!({ "is_active": false }).to_string()),
            changed_fields: vec!["is_active".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
