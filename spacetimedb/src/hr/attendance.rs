/// HR Attendance — punch records with approved-leave conflict guard.
use spacetimedb::{reducer, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::hr::employees::hr_employee;
use crate::hr::leaves::{hr_leave, HrLeave};
use crate::types::HrLeaveState;

// ── Tables ────────────────────────────────────────────────────────────────────

/// Time punch for an employee (check-in / check-out window).
#[spacetimedb::table(
    accessor = hr_attendance,
    public,
    index(accessor = attendance_by_org, btree(columns = [organization_id])),
    index(accessor = attendance_by_employee, btree(columns = [employee_id])),
    index(accessor = attendance_by_company, btree(columns = [company_id]))
)]
pub struct HrAttendance {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub employee_id: u64,
    pub check_in: Timestamp,
    pub check_out: Option<Timestamp>,
    /// manual | kiosk | import
    pub source: String,
    pub created_at: Timestamp,
}

/// Basic work schedule stub (hours per week; pack-keyed holidays later).
#[spacetimedb::table(
    accessor = hr_work_schedule,
    public,
    index(accessor = work_schedule_by_org, btree(columns = [organization_id])),
    index(accessor = work_schedule_by_employee, btree(columns = [employee_id]))
)]
pub struct HrWorkSchedule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub employee_id: u64,
    pub name: String,
    pub work_hours_per_week: f64,
    pub is_active: bool,
    pub created_at: Timestamp,
}

// ── Input Params ──────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAttendancePunchParams {
    pub employee_id: u64,
    pub check_in: Timestamp,
    pub check_out: Option<Timestamp>,
    pub source: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateWorkScheduleParams {
    pub employee_id: u64,
    pub name: String,
    pub work_hours_per_week: f64,
    pub is_active: bool,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn assert_employee_in_company(
    ctx: &ReducerContext,
    company_id: u64,
    employee_id: u64,
) -> Result<(), String> {
    let employee = ctx
        .db
        .hr_employee()
        .id()
        .find(&employee_id)
        .ok_or("Employee not found")?;
    if employee.company_id != company_id {
        return Err("Employee does not belong to this company".to_string());
    }
    Ok(())
}

fn timestamps_overlap(
    a_start: Timestamp,
    a_end: Timestamp,
    b_start: Timestamp,
    b_end: Timestamp,
) -> bool {
    a_start <= b_end && b_start <= a_end
}

/// Returns the first validated leave overlapping the punch window, if any.
pub fn find_validated_leave_conflict(
    ctx: &ReducerContext,
    employee_id: u64,
    punch_start: Timestamp,
    punch_end: Timestamp,
) -> Option<HrLeave> {
    ctx.db
        .hr_leave()
        .leave_by_employee()
        .filter(&employee_id)
        .find(|leave| {
            leave.state == HrLeaveState::Validated
                && leave.deleted_at.is_none()
                && timestamps_overlap(leave.date_from, leave.date_to, punch_start, punch_end)
        })
}

// ── Reducers ──────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_attendance_punch(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateAttendancePunchParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_attendance", "create")?;
    assert_employee_in_company(ctx, company_id, params.employee_id)?;

    if params.source.trim().is_empty() {
        return Err("Attendance source cannot be empty".to_string());
    }

    let punch_end = params.check_out.unwrap_or(params.check_in);
    if punch_end < params.check_in {
        return Err("check_out must be on or after check_in".to_string());
    }

    if let Some(leave) =
        find_validated_leave_conflict(ctx, params.employee_id, params.check_in, punch_end)
    {
        return Err(format!(
            "Punch overlaps approved leave id {} (employee on validated leave)",
            leave.id
        ));
    }

    let source = params.source;
    let row = ctx.db.hr_attendance().insert(HrAttendance {
        id: 0,
        organization_id,
        company_id,
        employee_id: params.employee_id,
        check_in: params.check_in,
        check_out: params.check_out,
        source: source.clone(),
        created_at: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_attendance",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "employee_id": params.employee_id,
                    "source": source,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "employee_id".to_string(),
                "check_in".to_string(),
                "check_out".to_string(),
                "source".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn create_work_schedule(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateWorkScheduleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_work_schedule", "create")?;
    assert_employee_in_company(ctx, company_id, params.employee_id)?;

    if params.name.trim().is_empty() {
        return Err("Schedule name cannot be empty".to_string());
    }
    if params.work_hours_per_week < 0.0 {
        return Err("work_hours_per_week cannot be negative".to_string());
    }

    let row = ctx.db.hr_work_schedule().insert(HrWorkSchedule {
        id: 0,
        organization_id,
        company_id,
        employee_id: params.employee_id,
        name: params.name,
        work_hours_per_week: params.work_hours_per_week,
        is_active: params.is_active,
        created_at: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_work_schedule",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}
