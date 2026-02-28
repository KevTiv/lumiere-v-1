/// Quality Control — Tables and Reducers
///
/// Tables:
///   - QualityCheck
///   - QualityAlert
///   - QualityAlertReason
///   - QualityPoint
///   - QualityTeam
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};

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

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: QUALITY CHECK
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_quality_check(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    company_id: u64,
    test_type: String,
    product_id: Option<u64>,
    product_variant_id: Option<u64>,
    picking_id: Option<u64>,
    move_line_id: Option<u64>,
    lot_id: Option<u64>,
    team_id: Option<u64>,
    user_id: Option<Identity>,
    control_point_id: Option<u64>,
    qty_tested: f64,
    tolerance_min: Option<f64>,
    tolerance_max: Option<f64>,
    norm_unit: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "quality_check", "create")?;

    if name.is_empty() {
        return Err("Check name cannot be empty".to_string());
    }

    let quality_check = ctx.db.quality_check().insert(QualityCheck {
        id: 0,
        organization_id,
        name: name.clone(),
        title: None,
        quality_state: "none".to_string(),
        status: "draft".to_string(),
        product_id,
        product_variant_id,
        picking_id,
        move_line_id,
        lot_id,
        team_id,
        user_id,
        company_id,
        warning_message: None,
        alert_message: None,
        note: None,
        is_failed: false,
        failure_location_id: None,
        control_point_id,
        workorder_id: None,
        production_id: None,
        qty_tested,
        qty_failed: 0.0,
        measure: None,
        measure_success: None,
        norm_unit,
        tolerance_min,
        tolerance_max,
        picture: None,
        picture_fail: None,
        component_id: None,
        operation_id: None,
        test_type: test_type.clone(),
        feedback: None,
        is_late: false,
        check_date: None,
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
        metadata: None,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "quality_check",
        quality_check.id,
        "create",
        None,
        Some(format!(
            r#"{{"name":"{}","test_type":"{}"}}"#,
            name,
            test_type.clone()
        )),
        vec!["name".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn start_quality_check(ctx: &ReducerContext, check_id: u64) -> Result<(), String> {
    let quality_check = ctx
        .db
        .quality_check()
        .id()
        .find(&check_id)
        .ok_or("Quality check not found")?;

    check_permission(ctx, quality_check.organization_id, "quality_check", "write")?;

    if quality_check.status != "draft" {
        return Err("Check must be in draft state to start".to_string());
    }

    ctx.db.quality_check().id().update(QualityCheck {
        status: "in_progress".to_string(),
        write_date: ctx.timestamp,
        ..quality_check
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn pass_quality_check(
    ctx: &ReducerContext,
    check_id: u64,
    measure: Option<f64>,
    note: Option<String>,
    picture: Option<String>,
) -> Result<(), String> {
    let quality_check = ctx
        .db
        .quality_check()
        .id()
        .find(&check_id)
        .ok_or("Quality check not found")?;

    check_permission(ctx, quality_check.organization_id, "quality_check", "write")?;

    if quality_check.status == "completed" {
        return Err("Check is already completed".to_string());
    }

    let is_failed = if let Some(m) = measure {
        if let (Some(min), Some(max)) = (quality_check.tolerance_min, quality_check.tolerance_max) {
            m < min || m > max
        } else {
            false
        }
    } else {
        false
    };

    ctx.db.quality_check().id().update(QualityCheck {
        quality_state: if is_failed {
            "fail".to_string()
        } else {
            "pass".to_string()
        },
        status: "completed".to_string(),
        is_failed,
        measure,
        note: note.or(quality_check.note),
        picture: picture.or(quality_check.picture),
        check_date: Some(ctx.timestamp),
        write_date: ctx.timestamp,
        ..quality_check
    });

    write_audit_log(
        ctx,
        quality_check.organization_id,
        Some(quality_check.company_id),
        "quality_check",
        check_id,
        "pass",
        None,
        Some(format!(
            r#"{{"quality_state":"{}"}}"#,
            if is_failed { "fail" } else { "pass" }
        )),
        vec!["quality_state".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn fail_quality_check(
    ctx: &ReducerContext,
    check_id: u64,
    qty_failed: f64,
    note: Option<String>,
    picture_fail: Option<String>,
    failure_location_id: Option<u64>,
) -> Result<(), String> {
    let quality_check = ctx
        .db
        .quality_check()
        .id()
        .find(&check_id)
        .ok_or("Quality check not found")?;

    check_permission(ctx, quality_check.organization_id, "quality_check", "write")?;

    if quality_check.status == "completed" {
        return Err("Check is already completed".to_string());
    }

    ctx.db.quality_check().id().update(QualityCheck {
        quality_state: "fail".to_string(),
        status: "completed".to_string(),
        is_failed: true,
        qty_failed,
        note: note.or(quality_check.note),
        picture_fail: picture_fail.or(quality_check.picture_fail),
        failure_location_id: failure_location_id.or(quality_check.failure_location_id),
        check_date: Some(ctx.timestamp),
        write_date: ctx.timestamp,
        ..quality_check
    });

    write_audit_log(
        ctx,
        quality_check.organization_id,
        Some(quality_check.company_id),
        "quality_check",
        check_id,
        "fail",
        None,
        Some(format!(
            r#"{{"quality_state":"fail","qty_failed":{}}}"#,
            qty_failed
        )),
        vec!["quality_state".to_string(), "qty_failed".to_string()],
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
    title: String,
    team_id: u64,
    company_id: u64,
    priority: String,
    product_id: Option<u64>,
    product_variant_id: Option<u64>,
    lot_id: Option<u64>,
    reason_id: Option<u64>,
    description: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "quality_alert", "create")?;

    if title.is_empty() {
        return Err("Alert title cannot be empty".to_string());
    }

    let alert = ctx.db.quality_alert().insert(QualityAlert {
        id: 0,
        organization_id,
        name: format!("QC-{}", ctx.timestamp.to_micros_since_unix_epoch()),
        title: title.clone(),
        description,
        priority,
        state: "draft".to_string(),
        reason_id,
        lot_id,
        product_id,
        product_variant_id,
        workcenter_id: None,
        team_id,
        user_id: None,
        company_id,
        tag_ids: vec![],
        activity_ids: vec![],
        message_ids: vec![],
        date_assign: None,
        date_close: None,
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
        metadata: None,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "quality_alert",
        alert.id,
        "create",
        None,
        Some(format!(
            r#"{{"title":"{}","priority":"{}"}}"#,
            title, alert.priority
        )),
        vec!["title".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn open_quality_alert(ctx: &ReducerContext, alert_id: u64) -> Result<(), String> {
    let alert = ctx
        .db
        .quality_alert()
        .id()
        .find(&alert_id)
        .ok_or("Quality alert not found")?;

    check_permission(ctx, alert.organization_id, "quality_alert", "write")?;

    if alert.state != "draft" {
        return Err("Alert must be in draft state to open".to_string());
    }

    ctx.db.quality_alert().id().update(QualityAlert {
        state: "open".to_string(),
        write_date: ctx.timestamp,
        ..alert
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn assign_quality_alert(
    ctx: &ReducerContext,
    alert_id: u64,
    user_id: Identity,
) -> Result<(), String> {
    let alert = ctx
        .db
        .quality_alert()
        .id()
        .find(&alert_id)
        .ok_or("Quality alert not found")?;

    check_permission(ctx, alert.organization_id, "quality_alert", "write")?;

    ctx.db.quality_alert().id().update(QualityAlert {
        state: "in_progress".to_string(),
        user_id: Some(user_id),
        date_assign: Some(ctx.timestamp),
        write_date: ctx.timestamp,
        ..alert
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn solve_quality_alert(
    ctx: &ReducerContext,
    alert_id: u64,
    description: Option<String>,
) -> Result<(), String> {
    let alert = ctx
        .db
        .quality_alert()
        .id()
        .find(&alert_id)
        .ok_or("Quality alert not found")?;

    check_permission(ctx, alert.organization_id, "quality_alert", "write")?;

    if alert.state == "solved" || alert.state == "cancelled" {
        return Err("Alert is already closed".to_string());
    }

    ctx.db.quality_alert().id().update(QualityAlert {
        state: "solved".to_string(),
        description: description.or(alert.description),
        date_close: Some(ctx.timestamp),
        write_date: ctx.timestamp,
        ..alert
    });

    write_audit_log(
        ctx,
        alert.organization_id,
        Some(alert.company_id),
        "quality_alert",
        alert_id,
        "solve",
        None,
        Some(r#"{"state":"solved"}"#.to_string()),
        vec!["state".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn cancel_quality_alert(
    ctx: &ReducerContext,
    alert_id: u64,
    description: Option<String>,
) -> Result<(), String> {
    let alert = ctx
        .db
        .quality_alert()
        .id()
        .find(&alert_id)
        .ok_or("Quality alert not found")?;

    check_permission(ctx, alert.organization_id, "quality_alert", "write")?;

    if alert.state == "solved" || alert.state == "cancelled" {
        return Err("Alert is already closed".to_string());
    }

    ctx.db.quality_alert().id().update(QualityAlert {
        state: "cancelled".to_string(),
        description: description.or(alert.description),
        date_close: Some(ctx.timestamp),
        write_date: ctx.timestamp,
        ..alert
    });

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: QUALITY ALERT REASON
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_quality_alert_reason(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    description: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "quality_alert_reason", "create")?;

    if name.is_empty() {
        return Err("Reason name cannot be empty".to_string());
    }

    let reason = ctx.db.quality_alert_reason().insert(QualityAlertReason {
        id: 0,
        organization_id,
        name: name.clone(),
        description,
        is_active: true,
        created_at: ctx.timestamp,
        metadata: None,
    });

    write_audit_log(
        ctx,
        organization_id,
        None,
        "quality_alert_reason",
        reason.id,
        "create",
        None,
        Some(format!(r#"{{"name":"{}"}}"#, name)),
        vec!["name".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_quality_alert_reason(
    ctx: &ReducerContext,
    reason_id: u64,
    name: Option<String>,
    description: Option<String>,
    is_active: Option<bool>,
) -> Result<(), String> {
    let reason = ctx
        .db
        .quality_alert_reason()
        .id()
        .find(&reason_id)
        .ok_or("Quality alert reason not found")?;

    check_permission(ctx, reason.organization_id, "quality_alert_reason", "write")?;

    ctx.db
        .quality_alert_reason()
        .id()
        .update(QualityAlertReason {
            name: name.unwrap_or_else(|| reason.name.clone()),
            description: description.or(reason.description),
            is_active: is_active.unwrap_or(reason.is_active),
            ..reason
        });

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_quality_alert_reason(ctx: &ReducerContext, reason_id: u64) -> Result<(), String> {
    let reason = ctx
        .db
        .quality_alert_reason()
        .id()
        .find(&reason_id)
        .ok_or("Quality alert reason not found")?;

    check_permission(
        ctx,
        reason.organization_id,
        "quality_alert_reason",
        "delete",
    )?;

    ctx.db.quality_alert_reason().id().delete(&reason_id);

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: QUALITY POINT
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_quality_point(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    company_id: u64,
    test_type: String,
    control_type: String,
    sequence: i32,
    team_id: Option<u64>,
    user_id: Option<Identity>,
    note: Option<String>,
    product_ids: Vec<u64>,
    product_category_ids: Vec<u64>,
    picking_type_id: Option<u64>,
    tolerance_min: Option<f64>,
    tolerance_max: Option<f64>,
    norm_unit: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "quality_point", "create")?;

    if name.is_empty() {
        return Err("Point name cannot be empty".to_string());
    }

    let point = ctx.db.quality_point().insert(QualityPoint {
        id: 0,
        organization_id,
        name: name.clone(),
        title: None,
        sequence,
        test_type: test_type.clone(),
        team_id,
        user_id,
        note,
        product_ids,
        product_category_ids,
        operation_id: None,
        workcenter_id: None,
        picking_type_id,
        code: None,
        control_type,
        company_id,
        norm_unit,
        tolerance_min,
        tolerance_max,
        is_active: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: None,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "quality_point",
        point.id,
        "create",
        None,
        Some(format!(
            r#"{{"name":"{}","test_type":"{}"}}"#,
            name, test_type
        )),
        vec!["name".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_quality_point(
    ctx: &ReducerContext,
    point_id: u64,
    name: Option<String>,
    sequence: Option<i32>,
    test_type: Option<String>,
    team_id: Option<u64>,
    user_id: Option<Identity>,
    note: Option<String>,
    tolerance_min: Option<f64>,
    tolerance_max: Option<f64>,
    norm_unit: Option<String>,
    is_active: Option<bool>,
) -> Result<(), String> {
    let point = ctx
        .db
        .quality_point()
        .id()
        .find(&point_id)
        .ok_or("Quality point not found")?;

    check_permission(ctx, point.organization_id, "quality_point", "write")?;

    ctx.db.quality_point().id().update(QualityPoint {
        name: name.unwrap_or_else(|| point.name.clone()),
        sequence: sequence.unwrap_or(point.sequence),
        test_type: test_type.unwrap_or_else(|| point.test_type.clone()),
        team_id: team_id.or(point.team_id),
        user_id: user_id.or(point.user_id),
        note: note.or(point.note),
        tolerance_min: tolerance_min.or(point.tolerance_min),
        tolerance_max: tolerance_max.or(point.tolerance_max),
        norm_unit: norm_unit.or(point.norm_unit),
        is_active: is_active.unwrap_or(point.is_active),
        updated_at: ctx.timestamp,
        ..point
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_quality_point(ctx: &ReducerContext, point_id: u64) -> Result<(), String> {
    let point = ctx
        .db
        .quality_point()
        .id()
        .find(&point_id)
        .ok_or("Quality point not found")?;

    check_permission(ctx, point.organization_id, "quality_point", "delete")?;

    ctx.db.quality_point().id().update(QualityPoint {
        is_active: false,
        updated_at: ctx.timestamp,
        ..point
    });

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: QUALITY TEAM
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_quality_team(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    description: Option<String>,
    email: Option<String>,
    phone: Option<String>,
    member_ids: Vec<Identity>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "quality_team", "create")?;

    if name.is_empty() {
        return Err("Team name cannot be empty".to_string());
    }

    let team = ctx.db.quality_team().insert(QualityTeam {
        id: 0,
        organization_id,
        name: name.clone(),
        description,
        email,
        phone,
        member_ids,
        is_active: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: None,
    });

    write_audit_log(
        ctx,
        organization_id,
        None,
        "quality_team",
        team.id,
        "create",
        None,
        Some(format!(r#"{{"name":"{}"}}"#, name)),
        vec!["name".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_quality_team(
    ctx: &ReducerContext,
    team_id: u64,
    name: Option<String>,
    description: Option<String>,
    email: Option<String>,
    phone: Option<String>,
    member_ids: Option<Vec<Identity>>,
    is_active: Option<bool>,
) -> Result<(), String> {
    let team = ctx
        .db
        .quality_team()
        .id()
        .find(&team_id)
        .ok_or("Quality team not found")?;

    check_permission(ctx, team.organization_id, "quality_team", "write")?;

    ctx.db.quality_team().id().update(QualityTeam {
        name: name.unwrap_or_else(|| team.name.clone()),
        description: description.or(team.description),
        email: email.or(team.email),
        phone: phone.or(team.phone),
        member_ids: member_ids.unwrap_or_else(|| team.member_ids.clone()),
        is_active: is_active.unwrap_or(team.is_active),
        updated_at: ctx.timestamp,
        ..team
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn add_member_to_quality_team(
    ctx: &ReducerContext,
    team_id: u64,
    member_id: Identity,
) -> Result<(), String> {
    let team = ctx
        .db
        .quality_team()
        .id()
        .find(&team_id)
        .ok_or("Quality team not found")?;

    check_permission(ctx, team.organization_id, "quality_team", "write")?;

    if team.member_ids.contains(&member_id) {
        return Err("Member already in team".to_string());
    }

    let mut member_ids = team.member_ids;
    member_ids.push(member_id);

    ctx.db.quality_team().id().update(QualityTeam {
        member_ids,
        updated_at: ctx.timestamp,
        ..team
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn remove_member_from_quality_team(
    ctx: &ReducerContext,
    team_id: u64,
    member_id: Identity,
) -> Result<(), String> {
    let team = ctx
        .db
        .quality_team()
        .id()
        .find(&team_id)
        .ok_or("Quality team not found")?;

    check_permission(ctx, team.organization_id, "quality_team", "write")?;

    let mut member_ids = team.member_ids;
    member_ids.retain(|id| id != &member_id);

    ctx.db.quality_team().id().update(QualityTeam {
        member_ids,
        updated_at: ctx.timestamp,
        ..team
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_quality_team(ctx: &ReducerContext, team_id: u64) -> Result<(), String> {
    let team = ctx
        .db
        .quality_team()
        .id()
        .find(&team_id)
        .ok_or("Quality team not found")?;

    check_permission(ctx, team.organization_id, "quality_team", "delete")?;

    ctx.db.quality_team().id().update(QualityTeam {
        is_active: false,
        updated_at: ctx.timestamp,
        ..team
    });

    Ok(())
}
