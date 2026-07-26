/// HR Leaves — HrLeaveType, HrLeave, HrLeaveAllocation
///
/// Manages leave types (vacation, sick, etc.), employee leave requests, and balances.
use chrono::{DateTime, Datelike, Utc};
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::hr::employees::hr_employee;
use crate::projects::capacity::on_leave_approved;
use crate::types::HrLeaveState;
use crate::workflow::action_registry::{
    GuardedActionInput, GuardedActionKey, GUARDED_ACTION_SCHEMA_VERSION,
};
use crate::workflow::approval_gate::{
    request_guarded_action, GuardedActionGateOutcome, RequestGuardedActionParams,
};

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

/// Per-employee leave balance for a leave type and calendar year.
#[spacetimedb::table(
    accessor = hr_leave_allocation,
    public,
    index(accessor = leave_allocation_by_org, btree(columns = [organization_id])),
    index(accessor = leave_allocation_by_employee, btree(columns = [employee_id]))
)]
pub struct HrLeaveAllocation {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub employee_id: u64,
    pub leave_type_id: u64,
    pub period_year: u32,
    pub allocated_days: f64,
    pub used_days: f64,
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

// ── Helpers ───────────────────────────────────────────────────────────────────

fn period_year_from_timestamp(ts: Timestamp) -> u32 {
    let micros = ts
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_micros() as i64;
    let secs = micros / 1_000_000;
    let nanos = ((micros % 1_000_000) * 1000) as u32;
    DateTime::<Utc>::from_timestamp(secs, nanos)
        .map(|dt| dt.year() as u32)
        .unwrap_or(1970)
}

fn find_leave_allocation(
    ctx: &ReducerContext,
    employee_id: u64,
    leave_type_id: u64,
    period_year: u32,
) -> Option<HrLeaveAllocation> {
    ctx.db
        .hr_leave_allocation()
        .leave_allocation_by_employee()
        .filter(&employee_id)
        .find(|row| row.leave_type_id == leave_type_id && row.period_year == period_year)
}

fn ensure_leave_allocation(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
    leave_type_id: u64,
    period_year: u32,
) -> Result<Option<HrLeaveAllocation>, String> {
    if let Some(existing) = find_leave_allocation(ctx, employee_id, leave_type_id, period_year) {
        return Ok(Some(existing));
    }

    let leave_type = ctx
        .db
        .hr_leave_type()
        .id()
        .find(&leave_type_id)
        .ok_or("Leave type not found")?;
    if leave_type.allocation_type == "no" {
        return Ok(None);
    }

    let row = ctx.db.hr_leave_allocation().insert(HrLeaveAllocation {
        id: 0,
        organization_id,
        company_id,
        employee_id,
        leave_type_id,
        period_year,
        allocated_days: leave_type.max_leaves,
        used_days: 0.0,
        created_at: ctx.timestamp,
    });
    Ok(Some(row))
}

fn consume_leave_days(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
    leave_type_id: u64,
    period_year: u32,
    days: f64,
) -> Result<f64, String> {
    let Some(alloc) = ensure_leave_allocation(
        ctx,
        organization_id,
        company_id,
        employee_id,
        leave_type_id,
        period_year,
    )?
    else {
        return Ok(0.0);
    };

    let remaining = alloc.allocated_days - alloc.used_days;
    if days > remaining + f64::EPSILON {
        return Err(format!(
            "insufficient leave balance: requested {days:.2} days, remaining {remaining:.2}"
        ));
    }

    let new_used = alloc.used_days + days;
    ctx.db.hr_leave_allocation().id().update(HrLeaveAllocation {
        used_days: new_used,
        ..alloc
    });
    Ok(days)
}

fn release_leave_days(
    ctx: &ReducerContext,
    employee_id: u64,
    leave_type_id: u64,
    period_year: u32,
    days: f64,
) -> Result<(), String> {
    if days <= 0.0 {
        return Ok(());
    }
    let Some(alloc) = find_leave_allocation(ctx, employee_id, leave_type_id, period_year) else {
        return Ok(());
    };
    let new_used = (alloc.used_days - days).max(0.0);
    ctx.db.hr_leave_allocation().id().update(HrLeaveAllocation {
        used_days: new_used,
        ..alloc
    });
    Ok(())
}

fn leave_requester_identity(ctx: &ReducerContext, leave: &HrLeave) -> Option<Identity> {
    ctx.db
        .hr_employee()
        .id()
        .find(leave.employee_id)
        .and_then(|emp| emp.user_id)
}

fn assert_not_self_approve(ctx: &ReducerContext, leave: &HrLeave) -> Result<(), String> {
    if let Some(requester) = leave_requester_identity(ctx, leave) {
        if requester == ctx.sender() {
            return Err("cannot approve your own leave request".to_string());
        }
    }
    Ok(())
}

fn requires_dual_approval(leave: &HrLeave) -> bool {
    leave.number_of_days > 5.0
}

fn guard_leave_company(leave: &HrLeave, company_id: u64) -> Result<(), String> {
    if leave.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    Ok(())
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

    let employee = ctx
        .db
        .hr_employee()
        .id()
        .find(&params.employee_id)
        .ok_or("Employee not found")?;
    if employee.organization_id != organization_id {
        return Err("Employee belongs to a different organization".to_string());
    }
    if employee.company_id != company_id {
        return Err("Employee does not belong to this company".to_string());
    }

    let leave_type = ctx
        .db
        .hr_leave_type()
        .id()
        .find(&params.leave_type_id)
        .ok_or("Leave type not found")?;
    if leave_type.organization_id != organization_id {
        return Err("Leave type belongs to a different organization".to_string());
    }
    if leave_type.company_id != company_id {
        return Err("Leave type does not belong to this company".to_string());
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
            new_values: Some(
                serde_json::json!({
                    "state": "Draft",
                    "number_of_days": params.number_of_days,
                })
                .to_string(),
            ),
            changed_fields: vec!["state".to_string(), "number_of_days".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn submit_leave(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
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
    guard_leave_company(&leave, company_id)?;
    if leave.state != HrLeaveState::Draft {
        return Err("Leave can only be submitted from Draft state".to_string());
    }

    let period_year = period_year_from_timestamp(leave.date_from);
    // Reserve allocation at submit so concurrent requests cannot oversubscribe.
    consume_leave_days(
        ctx,
        organization_id,
        company_id,
        leave.employee_id,
        leave.leave_type_id,
        period_year,
        leave.number_of_days,
    )?;

    let old_state = format!("{:?}", leave.state);
    ctx.db.hr_leave().id().update(HrLeave {
        state: HrLeaveState::Confirm,
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
            old_values: Some(serde_json::json!({ "state": old_state }).to_string()),
            new_values: Some(serde_json::json!({ "state": "Confirm" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn approve_leave(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    leave_id: u64,
) -> Result<(), String> {
    approve_leave_impl(ctx, organization_id, company_id, leave_id, false)
}

pub fn approve_leave_impl(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    leave_id: u64,
    skip_approval_check: bool,
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
    guard_leave_company(&leave, company_id)?;

    match leave.state {
        HrLeaveState::Confirm | HrLeaveState::ValidatedOne => {}
        HrLeaveState::Validated => return Err("Leave is already approved".to_string()),
        HrLeaveState::Refused => return Err("Refused leave cannot be approved".to_string()),
        HrLeaveState::Draft => {
            return Err("Leave must be submitted before approval".to_string());
        }
    }

    assert_not_self_approve(ctx, &leave)?;

    if !skip_approval_check {
        if matches!(
            request_guarded_action(
                ctx,
                organization_id,
                RequestGuardedActionParams {
                    company_id,
                    action: GuardedActionKey::ApproveLeave,
                    action_version: GUARDED_ACTION_SCHEMA_VERSION,
                    input: GuardedActionInput::ApproveLeave { leave_id },
                    idempotency_key: format!("approve-leave:{leave_id}"),
                    correlation_id: format!("hr-leave:{leave_id}:approve"),
                    causation_id: None,
                },
            )?,
            GuardedActionGateOutcome::HumanTaskCreated { .. }
        ) {
            return Ok(());
        }
    }

    let old_state = format!("{:?}", leave.state);
    let employee_id = leave.employee_id;
    let number_of_days = leave.number_of_days;

    // Days were reserved at submit; approval only advances state.
    let (updated, days_consumed, changed_fields) = match leave.state {
        HrLeaveState::Confirm if requires_dual_approval(&leave) => (
            HrLeave {
                state: HrLeaveState::ValidatedOne,
                first_approver_id: Some(ctx.sender()),
                ..leave
            },
            0.0,
            vec!["state".to_string(), "first_approver_id".to_string()],
        ),
        HrLeaveState::Confirm => (
            HrLeave {
                state: HrLeaveState::Validated,
                first_approver_id: Some(ctx.sender()),
                ..leave
            },
            number_of_days,
            vec!["state".to_string(), "first_approver_id".to_string()],
        ),
        HrLeaveState::ValidatedOne => (
            HrLeave {
                state: HrLeaveState::Validated,
                second_approver_id: Some(ctx.sender()),
                ..leave
            },
            number_of_days,
            vec!["state".to_string(), "second_approver_id".to_string()],
        ),
        _ => unreachable!(),
    };

    let new_state = updated.state.clone();
    let first_approver_id = updated.first_approver_id;
    let second_approver_id = updated.second_approver_id;
    ctx.db.hr_leave().id().update(updated);

    if new_state == HrLeaveState::Validated {
        on_leave_approved(ctx, organization_id, company_id, employee_id);
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_leave",
            record_id: leave_id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({
                    "state": old_state,
                    "number_of_days": number_of_days,
                })
                .to_string(),
            ),
            new_values: Some(
                serde_json::json!({
                    "state": format!("{new_state:?}"),
                    "days_consumed": days_consumed,
                    "first_approver_id": first_approver_id.map(|id| id.to_hex().to_string()),
                    "second_approver_id": second_approver_id.map(|id| id.to_hex().to_string()),
                })
                .to_string(),
            ),
            changed_fields,
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn refuse_leave(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
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
    guard_leave_company(&leave, company_id)?;

    match leave.state {
        HrLeaveState::Confirm | HrLeaveState::ValidatedOne => {}
        HrLeaveState::Validated => {
            return Err("Validated leave cannot be refused; use a reverse workflow".to_string());
        }
        HrLeaveState::Refused => return Err("Leave is already refused".to_string()),
        HrLeaveState::Draft => {
            return Err("Leave must be submitted before it can be refused".to_string());
        }
    }

    let old_state = format!("{:?}", leave.state);
    let period_year = period_year_from_timestamp(leave.date_from);
    release_leave_days(
        ctx,
        leave.employee_id,
        leave.leave_type_id,
        period_year,
        leave.number_of_days,
    )?;
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
            old_values: Some(serde_json::json!({ "state": old_state }).to_string()),
            new_values: Some(serde_json::json!({ "state": "Refused" }).to_string()),
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
    company_id: u64,
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
    guard_leave_company(&leave, company_id)?;

    match leave.state {
        HrLeaveState::Refused | HrLeaveState::Confirm | HrLeaveState::ValidatedOne => {}
        HrLeaveState::Validated => {
            return Err("Validated leave cannot be reset to draft".to_string());
        }
        HrLeaveState::Draft => return Err("Leave is already in Draft state".to_string()),
    }

    let old_state = format!("{:?}", leave.state);
    let should_release = matches!(
        leave.state,
        HrLeaveState::Confirm | HrLeaveState::ValidatedOne
    );
    if should_release {
        let period_year = period_year_from_timestamp(leave.date_from);
        release_leave_days(
            ctx,
            leave.employee_id,
            leave.leave_type_id,
            period_year,
            leave.number_of_days,
        )?;
    }
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
            old_values: Some(serde_json::json!({ "state": old_state }).to_string()),
            new_values: Some(serde_json::json!({ "state": "Draft" }).to_string()),
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
