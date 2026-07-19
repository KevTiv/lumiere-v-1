/// Advanced WFM stubs — labor cost snapshots, shift optimization jobs, HR capacity forecast.
///
/// Metadata-only hooks for partner optimizers and PSA adjacency; not a full WFM product.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::hr::attendance::{hr_attendance, hr_work_schedule};
use crate::hr::employees::hr_employee;
use crate::hr::leaves::hr_leave;
use crate::types::HrLeaveState;

// ── Tables ────────────────────────────────────────────────────────────────────

/// Point-in-time labor cost view (metadata for dashboards / export hooks).
#[spacetimedb::table(
    accessor = hr_labor_cost_snapshot,
    public,
    index(accessor = labor_cost_by_org, btree(columns = [organization_id])),
    index(accessor = labor_cost_by_company, btree(columns = [company_id])),
    index(accessor = labor_cost_by_employee, btree(columns = [employee_id]))
)]
pub struct HrLaborCostSnapshot {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    /// `None` = company-level rollup snapshot.
    pub employee_id: Option<u64>,
    pub period_start: Timestamp,
    pub period_end: Timestamp,
    pub total_labor_cost: f64,
    pub currency_code: String,
    /// draft | computed | stale
    pub status: String,
    pub metadata: Option<String>,
    pub created_at: Timestamp,
}

/// Async shift-optimization job hook (external engine consumes metadata).
#[spacetimedb::table(
    accessor = hr_shift_opt_job,
    public,
    index(accessor = shift_opt_by_org, btree(columns = [organization_id])),
    index(accessor = shift_opt_by_company, btree(columns = [company_id])),
    index(accessor = shift_opt_by_status, btree(columns = [status]))
)]
pub struct HrShiftOptJob {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    /// queued | running | done | failed
    pub status: String,
    /// Human-readable scope label (team, site, week, …).
    pub scope: String,
    pub metadata: Option<String>,
    pub result_summary: Option<String>,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// Leave- and attendance-aware capacity snapshot for PSA adjacency.
#[spacetimedb::table(
    accessor = hr_capacity_forecast,
    public,
    index(accessor = hr_capacity_by_org, btree(columns = [organization_id])),
    index(accessor = hr_capacity_by_company, btree(columns = [company_id])),
    index(accessor = hr_capacity_by_employee, btree(columns = [employee_id]))
)]
pub struct HrCapacityForecast {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub employee_id: u64,
    pub period_start: Timestamp,
    pub period_end: Timestamp,
    pub scheduled_hours: f64,
    pub leave_hours: f64,
    pub attendance_hours: f64,
    pub available_hours: f64,
    pub metadata: Option<String>,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateHrLaborCostSnapshotParams {
    pub employee_id: Option<u64>,
    pub period_start: Timestamp,
    pub period_end: Timestamp,
    pub total_labor_cost: f64,
    pub currency_code: String,
    pub status: String,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateHrShiftOptJobParams {
    pub scope: String,
    pub status: String,
    pub metadata: Option<String>,
    pub result_summary: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RefreshHrCapacityForecastParams {
    pub employee_id: Option<u64>,
    pub period_start: Timestamp,
    pub period_end: Timestamp,
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

fn validate_period(period_start: Timestamp, period_end: Timestamp) -> Result<(), String> {
    if period_end < period_start {
        return Err("period_end must be on or after period_start".to_string());
    }
    Ok(())
}

fn normalize_labor_cost_status(status: &str) -> Result<String, String> {
    let s = status.trim().to_lowercase();
    match s.as_str() {
        "draft" | "computed" | "stale" => Ok(s),
        _ => Err("status must be draft, computed, or stale".to_string()),
    }
}

fn normalize_shift_opt_status(status: &str) -> Result<String, String> {
    let s = status.trim().to_lowercase();
    match s.as_str() {
        "queued" | "running" | "done" | "failed" => Ok(s),
        _ => Err("status must be queued, running, done, or failed".to_string()),
    }
}

fn period_secs(start: Timestamp, end: Timestamp) -> f64 {
    let start_us = start
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_micros() as f64;
    let end_us = end
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_micros() as f64;
    ((end_us - start_us) / 1_000_000.0).max(0.0)
}

fn timestamps_overlap(a_start: Timestamp, a_end: Timestamp, b_start: Timestamp, b_end: Timestamp) -> bool {
    a_start <= b_end && b_start <= a_end
}

fn active_work_hours_per_week(ctx: &ReducerContext, employee_id: u64) -> f64 {
    ctx.db
        .hr_work_schedule()
        .work_schedule_by_employee()
        .filter(&employee_id)
        .filter(|s| s.is_active)
        .map(|s| s.work_hours_per_week)
        .next()
        .unwrap_or(40.0)
}

fn leave_hours_in_period(
    ctx: &ReducerContext,
    employee_id: u64,
    period_start: Timestamp,
    period_end: Timestamp,
    hours_per_day: f64,
) -> f64 {
    let mut total = 0.0f64;
    for leave in ctx.db.hr_leave().leave_by_employee().filter(&employee_id) {
        if leave.deleted_at.is_some() {
            continue;
        }
        if leave.state != HrLeaveState::Validated {
            continue;
        }
        if !timestamps_overlap(leave.date_from, leave.date_to, period_start, period_end) {
            continue;
        }
        total += leave.number_of_days.max(0.0) * hours_per_day;
    }
    total
}

fn attendance_hours_in_period(
    ctx: &ReducerContext,
    employee_id: u64,
    period_start: Timestamp,
    period_end: Timestamp,
) -> f64 {
    let mut total = 0.0f64;
    for punch in ctx
        .db
        .hr_attendance()
        .attendance_by_employee()
        .filter(&employee_id)
    {
        if punch.check_in > period_end {
            continue;
        }
        let punch_end = punch.check_out.unwrap_or(punch.check_in);
        if punch_end < period_start {
            continue;
        }
        total += period_secs(punch.check_in, punch_end) / 3600.0;
    }
    total
}

pub fn refresh_hr_capacity_forecast_for_employee(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
    period_start: Timestamp,
    period_end: Timestamp,
) {
    let hours_per_week = active_work_hours_per_week(ctx, employee_id);
    let period_days = period_secs(period_start, period_end) / 86_400.0;
    let scheduled_hours = hours_per_week * (period_days / 7.0).max(0.0);
    let hours_per_day = (hours_per_week / 5.0).max(0.0);
    let leave_hours = leave_hours_in_period(ctx, employee_id, period_start, period_end, hours_per_day);
    let attendance_hours =
        attendance_hours_in_period(ctx, employee_id, period_start, period_end);
    let available_hours = (scheduled_hours - leave_hours).max(0.0);

    let metadata = serde_json::json!({
        "source": "hr_capacity_forecast_stub",
        "psa_adjacent": true,
        "attendance_hours": attendance_hours,
    })
    .to_string();

    let existing: Vec<u64> = ctx
        .db
        .hr_capacity_forecast()
        .hr_capacity_by_company()
        .filter(&company_id)
        .filter(|row| {
            row.organization_id == organization_id
                && row.employee_id == employee_id
                && row.period_start == period_start
                && row.period_end == period_end
        })
        .map(|row| row.id)
        .collect();

    for id in existing {
        ctx.db.hr_capacity_forecast().id().delete(&id);
    }

    ctx.db.hr_capacity_forecast().insert(HrCapacityForecast {
        id: 0,
        organization_id,
        company_id,
        employee_id,
        period_start,
        period_end,
        scheduled_hours,
        leave_hours,
        attendance_hours,
        available_hours,
        metadata: Some(metadata),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });
}

// ── Reducers ──────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_hr_labor_cost_snapshot(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateHrLaborCostSnapshotParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_labor_cost_snapshot", "create")?;
    validate_period(params.period_start, params.period_end)?;

    if let Some(employee_id) = params.employee_id {
        assert_employee_in_company(ctx, company_id, employee_id)?;
    }

    if params.currency_code.trim().is_empty() {
        return Err("currency_code cannot be empty".to_string());
    }

    let status = normalize_labor_cost_status(&params.status)?;

    let row = ctx.db.hr_labor_cost_snapshot().insert(HrLaborCostSnapshot {
        id: 0,
        organization_id,
        company_id,
        employee_id: params.employee_id,
        period_start: params.period_start,
        period_end: params.period_end,
        total_labor_cost: params.total_labor_cost,
        currency_code: params.currency_code,
        status,
        metadata: params.metadata,
        created_at: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_labor_cost_snapshot",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "employee_id": params.employee_id,
                    "total_labor_cost": params.total_labor_cost,
                })
                .to_string(),
            ),
            changed_fields: vec!["total_labor_cost".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn create_hr_shift_opt_job(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateHrShiftOptJobParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_shift_opt_job", "create")?;

    if params.scope.trim().is_empty() {
        return Err("scope cannot be empty".to_string());
    }

    let status = normalize_shift_opt_status(&params.status)?;

    let row = ctx.db.hr_shift_opt_job().insert(HrShiftOptJob {
        id: 0,
        organization_id,
        company_id,
        status,
        scope: params.scope,
        metadata: params.metadata,
        result_summary: params.result_summary,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_shift_opt_job",
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

#[reducer]
pub fn refresh_hr_capacity_forecast(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: RefreshHrCapacityForecastParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_capacity_forecast", "write")?;
    validate_period(params.period_start, params.period_end)?;

    let employee_ids: Vec<u64> = if let Some(employee_id) = params.employee_id {
        assert_employee_in_company(ctx, company_id, employee_id)?;
        vec![employee_id]
    } else {
        ctx.db
            .hr_employee()
            .iter()
            .filter(|e| e.organization_id == organization_id && e.company_id == company_id)
            .map(|e| e.id)
            .collect()
    };

    let employee_count = employee_ids.len();

    for employee_id in employee_ids {
        refresh_hr_capacity_forecast_for_employee(
            ctx,
            organization_id,
            company_id,
            employee_id,
            params.period_start,
            params.period_end,
        );
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_capacity_forecast",
            record_id: 0,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: Some(
                serde_json::json!({
                    "employee_count": employee_count,
                })
                .to_string(),
            ),
        },
    );
    Ok(())
}
