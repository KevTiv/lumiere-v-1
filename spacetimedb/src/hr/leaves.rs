/// HR Leaves — HrLeaveType & HrLeave
///
/// Manages leave types (vacation, sick, etc.) and employee leave requests.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::HrLeaveState;

// ── Tables ────────────────────────────────────────────────────────────────────

/// HR Leave Type — A category of leave (e.g. "Annual Leave", "Sick Leave").
#[spacetimedb::table(
    accessor = hr_leave_type,
    public,
    index(accessor = leave_type_by_org, btree(columns = [organization_id]))
)]
pub struct HrLeaveType {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    pub code: Option<String>,
    pub color: Option<u32>,
    pub allocation_type: String, // "no" | "fixed" | "fixed_allocation"
    pub validity_start: Option<Timestamp>,
    pub validity_stop: Option<Timestamp>,
    pub max_leaves: f64, // Maximum days allowed per year
    pub is_active: bool,
    pub created_at: Timestamp,
}

/// HR Leave — A single leave request by an employee.
#[spacetimedb::table(
    accessor = hr_leave,
    public,
    index(accessor = leave_by_employee, btree(columns = [employee_id])),
    index(accessor = leave_by_state, btree(columns = [state])),
    index(accessor = leave_by_org, btree(columns = [organization_id]))
)]
pub struct HrLeave {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub employee_id: u64,     // FK → HrEmployee
    pub leave_type_id: u64,   // FK → HrLeaveType
    pub name: Option<String>, // Optional description
    pub state: HrLeaveState,
    pub date_from: Timestamp,
    pub date_to: Timestamp,
    pub number_of_days: f64,
    pub notes: Option<String>,
    pub manager_id: Option<u64>, // FK → HrEmployee (approving manager)
    pub first_approver_id: Option<Identity>,
    pub second_approver_id: Option<Identity>,
    pub created_at: Timestamp,
    pub deleted_at: Option<Timestamp>,
}

// ── Input Params ──────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateLeaveTypeParams {
    pub name: String,
    pub allocation_type: String,
    pub max_leaves: f64,
    pub code: Option<String>,
    pub color: Option<u32>,
    pub validity_start: Option<Timestamp>,
    pub validity_stop: Option<Timestamp>,
    pub is_active: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateLeaveTypeParams {
    pub name: Option<String>,
    pub max_leaves: Option<f64>,
    pub is_active: Option<bool>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateLeaveRequestParams {
    pub employee_id: u64,
    pub leave_type_id: u64,
    pub date_from: Timestamp,
    pub date_to: Timestamp,
    pub number_of_days: f64,
    pub notes: Option<String>,
    pub name: Option<String>,
    pub manager_id: Option<u64>,
}

// ── Reducers: Leave Types ─────────────────────────────────────────────────────

#[reducer]
pub fn create_leave_type(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateLeaveTypeParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_leave_type", "create")?;
    if params.name.is_empty() {
        return Err("Leave type name cannot be empty".to_string());
    }
    let lt = ctx.db.hr_leave_type().insert(HrLeaveType {
        id: 0,
        organization_id,
        company_id,
        name: params.name,
        code: params.code,
        color: params.color,
        allocation_type: params.allocation_type,
        validity_start: params.validity_start,
        validity_stop: params.validity_stop,
        max_leaves: params.max_leaves,
        is_active: params.is_active,
        created_at: ctx.timestamp,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_leave_type",
            record_id: lt.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn update_leave_type(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    leave_type_id: u64,
    params: UpdateLeaveTypeParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_leave_type", "update")?;
    let lt = ctx
        .db
        .hr_leave_type()
        .id()
        .find(&leave_type_id)
        .ok_or("Leave type not found")?;
    if lt.organization_id != organization_id {
        return Err("Leave type belongs to a different organization".to_string());
    }
    if lt.company_id != company_id {
        return Err("Leave type does not belong to this company".to_string());
    }
    ctx.db.hr_leave_type().id().update(HrLeaveType {
        name: params.name.unwrap_or(lt.name),
        max_leaves: params.max_leaves.unwrap_or(lt.max_leaves),
        is_active: params.is_active.unwrap_or(lt.is_active),
        ..lt
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_leave_type",
            record_id: leave_type_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

// ── Reducers: Leave Requests ──────────────────────────────────────────────────

#[reducer]
pub fn create_leave_request(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateLeaveRequestParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_leave", "create")?;
    if params.number_of_days <= 0.0 {
        return Err("Number of days must be positive".to_string());
    }
    let leave = ctx.db.hr_leave().insert(HrLeave {
        id: 0,
        organization_id,
        company_id,
        employee_id: params.employee_id,
        leave_type_id: params.leave_type_id,
        name: params.name,
        state: HrLeaveState::Draft,
        date_from: params.date_from,
        date_to: params.date_to,
        number_of_days: params.number_of_days,
        notes: params.notes,
        manager_id: params.manager_id,
        first_approver_id: None,
        second_approver_id: None,
        created_at: ctx.timestamp,
        deleted_at: None,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_leave",
            record_id: leave.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn approve_leave(
    ctx: &ReducerContext,
    organization_id: u64,
    leave_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_leave", "approve")?;
    let leave = ctx
        .db
        .hr_leave()
        .id()
        .find(&leave_id)
        .ok_or("Leave request not found")?;
    if leave.organization_id != organization_id {
        return Err("Leave request belongs to a different organization".to_string());
    }
    if leave.state == HrLeaveState::Validated {
        return Err("Leave is already approved".to_string());
    }
    let company_id = leave.company_id;
    ctx.db.hr_leave().id().update(HrLeave {
        state: HrLeaveState::Validated,
        first_approver_id: Some(ctx.sender()),
        ..leave
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_leave",
            record_id: leave_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["state".to_string(), "first_approver_id".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn refuse_leave(
    ctx: &ReducerContext,
    organization_id: u64,
    leave_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_leave", "approve")?;
    let leave = ctx
        .db
        .hr_leave()
        .id()
        .find(&leave_id)
        .ok_or("Leave request not found")?;
    if leave.organization_id != organization_id {
        return Err("Leave request belongs to a different organization".to_string());
    }
    let company_id = leave.company_id;
    ctx.db.hr_leave().id().update(HrLeave {
        state: HrLeaveState::Refused,
        ..leave
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_leave",
            record_id: leave_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn reset_leave_to_draft(
    ctx: &ReducerContext,
    organization_id: u64,
    leave_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_leave", "update")?;
    let leave = ctx
        .db
        .hr_leave()
        .id()
        .find(&leave_id)
        .ok_or("Leave request not found")?;
    if leave.organization_id != organization_id {
        return Err("Leave request belongs to a different organization".to_string());
    }
    let company_id = leave.company_id;
    ctx.db.hr_leave().id().update(HrLeave {
        state: HrLeaveState::Draft,
        first_approver_id: None,
        second_approver_id: None,
        ..leave
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_leave",
            record_id: leave_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![
                "state".to_string(),
                "first_approver_id".to_string(),
                "second_approver_id".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}
