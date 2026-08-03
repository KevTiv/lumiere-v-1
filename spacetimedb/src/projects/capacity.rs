//! PSA working calendars, public holidays, resource allocations, and capacity snapshots.
//!
//! # Capacity projection choice
//! SpacetimeDB live SQL cannot join calendar − leave − allocations − timesheets into a
//! single computed view. Remaining capacity is therefore materialised in
//! [`ResourceCapacitySnapshot`] and refreshed in-reducer (same txn) when allocations or
//! leave change. The subscription key `resource-capacity-by-employee` reads that table.
//!
//! # Tables
//! | Table | Description |
//! |-------|-------------|
//! | **WorkingCalendar** | Company working-hours calendar (pack-aware) |
//! | **PublicHoliday** | Pack-keyed holiday dates (org-scoped copies) |
//! | **ResourceAllocation** | Employee/resource booking onto project/task |
//! | **ResourceCapacitySnapshot** | Materialised remaining capacity per employee |

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::company_id_from_scope;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::hr::employees::{hr_employee, hr_resource};
use crate::hr::leaves::hr_leave;
use crate::projects::projects::project_project;
use crate::projects::tasks::project_task;
use crate::projects::timesheets::project_timesheet;
use crate::types::HrLeaveState;

// ── Tables ───────────────────────────────────────────────────────────────────

/// Company working calendar — hours/day and weekday mask (PSA-owned; not manufacturing).
#[derive(Clone)]
#[spacetimedb::table(
    accessor = working_calendar,
    public,
    index(accessor = calendar_by_org, btree(columns = [organization_id])),
    index(accessor = calendar_by_company, btree(columns = [company_id])),
    index(accessor = calendar_by_pack, btree(columns = [pack_key]))
)]
pub struct WorkingCalendar {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    /// Country pack key (`au`, `nz`, `za`, `sg`, …). Empty string when unassigned.
    pub pack_key: String,
    pub hours_per_day: f64,
    pub work_monday: bool,
    pub work_tuesday: bool,
    pub work_wednesday: bool,
    pub work_thursday: bool,
    pub work_friday: bool,
    pub work_saturday: bool,
    pub work_sunday: bool,
    pub active: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Public holiday — pack-keyed, org-scoped (pilot seeds copy pack catalogs into the org).
#[derive(Clone)]
#[spacetimedb::table(
    accessor = public_holiday,
    public,
    index(accessor = holiday_by_org, btree(columns = [organization_id])),
    index(accessor = holiday_by_pack, btree(columns = [pack_key])),
    index(accessor = holiday_by_calendar, btree(columns = [calendar_id]))
)]
pub struct PublicHoliday {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub calendar_id: Option<u64>,
    pub pack_key: String,
    pub name: String,
    pub holiday_date: Timestamp,
    pub is_recurring: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Resource allocation booking — employee and/or hr_resource onto project/task.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = resource_allocation,
    public,
    index(accessor = allocation_by_org, btree(columns = [organization_id])),
    index(accessor = allocation_by_company, btree(columns = [company_id])),
    index(accessor = allocation_by_employee, btree(columns = [employee_id])),
    index(accessor = allocation_by_resource, btree(columns = [resource_id])),
    index(accessor = allocation_by_project, btree(columns = [project_id]))
)]
pub struct ResourceAllocation {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub employee_id: Option<u64>,
    pub resource_id: Option<u64>,
    pub project_id: u64,
    pub task_id: Option<u64>,
    pub date_from: Timestamp,
    pub date_to: Timestamp,
    /// Absolute hours booked in the range (0 when using percent).
    pub allocated_hours: f64,
    /// Percent of available capacity (0–100); 0 when using absolute hours.
    pub allocation_percent: f64,
    pub name: Option<String>,
    pub notes: Option<String>,
    /// When true, create/update rejects if remaining capacity would go negative.
    pub enforce_capacity: bool,
    pub active: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Materialised remaining capacity for live `resource-capacity-by-employee` subscriptions.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = resource_capacity_snapshot,
    public,
    index(accessor = capacity_by_org, btree(columns = [organization_id])),
    index(accessor = capacity_by_company, btree(columns = [company_id])),
    index(accessor = capacity_by_employee, btree(columns = [employee_id])),
    index(accessor = capacity_by_resource, btree(columns = [resource_id]))
)]
pub struct ResourceCapacitySnapshot {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub employee_id: Option<u64>,
    pub resource_id: Option<u64>,
    pub period_start: Timestamp,
    pub period_end: Timestamp,
    pub available_hours: f64,
    pub leave_hours: f64,
    pub allocated_hours: f64,
    pub actual_hours: f64,
    /// available − leave − allocations − actual timesheet hours
    pub remaining_hours: f64,
    pub calendar_id: Option<u64>,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateWorkingCalendarParams {
    pub name: String,
    pub pack_key: String,
    pub hours_per_day: f64,
    pub work_monday: bool,
    pub work_tuesday: bool,
    pub work_wednesday: bool,
    pub work_thursday: bool,
    pub work_friday: bool,
    pub work_saturday: bool,
    pub work_sunday: bool,
    pub active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateWorkingCalendarParams {
    pub name: Option<String>,
    pub pack_key: Option<String>,
    pub hours_per_day: Option<f64>,
    pub work_monday: Option<bool>,
    pub work_tuesday: Option<bool>,
    pub work_wednesday: Option<bool>,
    pub work_thursday: Option<bool>,
    pub work_friday: Option<bool>,
    pub work_saturday: Option<bool>,
    pub work_sunday: Option<bool>,
    pub active: Option<bool>,
    pub metadata: Option<Option<String>>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePublicHolidayParams {
    pub calendar_id: Option<u64>,
    pub pack_key: String,
    pub name: String,
    pub holiday_date: Timestamp,
    pub is_recurring: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdatePublicHolidayParams {
    pub calendar_id: Option<Option<u64>>,
    pub pack_key: Option<String>,
    pub name: Option<String>,
    pub holiday_date: Option<Timestamp>,
    pub is_recurring: Option<bool>,
    pub metadata: Option<Option<String>>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateResourceAllocationParams {
    pub employee_id: Option<u64>,
    pub resource_id: Option<u64>,
    pub project_id: u64,
    pub task_id: Option<u64>,
    pub date_from: Timestamp,
    pub date_to: Timestamp,
    pub allocated_hours: f64,
    pub allocation_percent: f64,
    pub name: Option<String>,
    pub notes: Option<String>,
    pub enforce_capacity: bool,
    pub active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateResourceAllocationParams {
    pub employee_id: Option<Option<u64>>,
    pub resource_id: Option<Option<u64>>,
    pub project_id: Option<u64>,
    pub task_id: Option<Option<u64>>,
    pub date_from: Option<Timestamp>,
    pub date_to: Option<Timestamp>,
    pub allocated_hours: Option<f64>,
    pub allocation_percent: Option<f64>,
    pub name: Option<Option<String>>,
    pub notes: Option<Option<String>>,
    pub enforce_capacity: Option<bool>,
    pub active: Option<bool>,
    pub metadata: Option<Option<String>>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct SeedPackHolidaysParams {
    /// Pack keys to seed (e.g. `au`, `nz`, `za`, `sg`). Empty = default pilot set.
    pub pack_keys: Vec<String>,
    pub calendar_id: Option<u64>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const MICROS_PER_DAY: i64 = 86_400_000_000;
const DEFAULT_PERIOD_DAYS: i64 = 28;

fn ts_day_index(ts: Timestamp) -> i64 {
    ts.to_micros_since_unix_epoch() / MICROS_PER_DAY
}

fn ranges_overlap(a_from: Timestamp, a_to: Timestamp, b_from: Timestamp, b_to: Timestamp) -> bool {
    a_from.to_micros_since_unix_epoch() <= b_to.to_micros_since_unix_epoch()
        && b_from.to_micros_since_unix_epoch() <= a_to.to_micros_since_unix_epoch()
}

fn default_period(now: Timestamp) -> (Timestamp, Timestamp) {
    let start = now;
    let end = Timestamp::from_micros_since_unix_epoch(
        now.to_micros_since_unix_epoch() + DEFAULT_PERIOD_DAYS * MICROS_PER_DAY,
    );
    (start, end)
}

fn company_calendar(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
) -> Option<WorkingCalendar> {
    ctx.db
        .working_calendar()
        .calendar_by_company()
        .filter(&company_id)
        .find(|c| c.organization_id == organization_id && c.active)
}

fn count_working_days(
    calendar: &WorkingCalendar,
    from: Timestamp,
    to: Timestamp,
    holiday_days: &[i64],
) -> u32 {
    let start = ts_day_index(from);
    let end = ts_day_index(to);
    if end < start {
        return 0;
    }
    let mut count = 0u32;
    for day in start..=end {
        if holiday_days.binary_search(&day).is_ok() {
            continue;
        }
        // Unix epoch day 0 was Thursday; weekday = (day + 3) % 7, Mon=0 … Sun=6
        let weekday = ((day + 3).rem_euclid(7)) as u8;
        let works = match weekday {
            0 => calendar.work_monday,
            1 => calendar.work_tuesday,
            2 => calendar.work_wednesday,
            3 => calendar.work_thursday,
            4 => calendar.work_friday,
            5 => calendar.work_saturday,
            _ => calendar.work_sunday,
        };
        if works {
            count += 1;
        }
    }
    count
}

fn holiday_day_indexes(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    pack_key: &str,
    calendar_id: Option<u64>,
) -> Vec<i64> {
    let mut days: Vec<i64> = ctx
        .db
        .public_holiday()
        .holiday_by_org()
        .filter(&organization_id)
        .filter(|h| {
            h.company_id == company_id
                && (h.pack_key == pack_key
                    || calendar_id.is_some_and(|cid| h.calendar_id == Some(cid)))
        })
        .map(|h| ts_day_index(h.holiday_date))
        .collect();
    days.sort_unstable();
    days.dedup();
    days
}

fn resolve_employee_resource(
    ctx: &ReducerContext,
    organization_id: u64,
    employee_id: Option<u64>,
    resource_id: Option<u64>,
) -> Result<(Option<u64>, Option<u64>), String> {
    if employee_id.is_none() && resource_id.is_none() {
        return Err("allocation requires employee_id or resource_id".to_string());
    }
    if let Some(eid) = employee_id {
        let emp = ctx
            .db
            .hr_employee()
            .id()
            .find(&eid)
            .ok_or("Employee not found")?;
        if emp.organization_id != organization_id {
            return Err("Employee does not belong to this organization".to_string());
        }
        let rid = resource_id.or(emp.resource_id);
        return Ok((Some(eid), rid));
    }
    if let Some(rid) = resource_id {
        let res = ctx
            .db
            .hr_resource()
            .id()
            .find(&rid)
            .ok_or("HR resource not found")?;
        if res.organization_id != organization_id {
            return Err("HR resource does not belong to this organization".to_string());
        }
        return Ok((None, Some(rid)));
    }
    Ok((employee_id, resource_id))
}

fn allocation_hours_in_range(alloc: &ResourceAllocation, available_in_range: f64) -> f64 {
    if alloc.allocated_hours > 0.0 {
        alloc.allocated_hours
    } else if alloc.allocation_percent > 0.0 {
        available_in_range * (alloc.allocation_percent / 100.0)
    } else {
        0.0
    }
}

/// Recompute materialised capacity for one employee (or resource) in the default window.
pub fn recompute_resource_capacity(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: Option<u64>,
    resource_id: Option<u64>,
) {
    let (period_start, period_end) = default_period(ctx.timestamp);
    let calendar = company_calendar(ctx, organization_id, company_id);
    let pack_key = calendar
        .as_ref()
        .map(|c| c.pack_key.clone())
        .unwrap_or_default();
    let calendar_id = calendar.as_ref().map(|c| c.id);
    let hours_per_day = calendar.as_ref().map(|c| c.hours_per_day).unwrap_or(8.0);
    let efficiency = resource_id
        .and_then(|rid| ctx.db.hr_resource().id().find(&rid))
        .map(|r| (r.time_efficiency / 100.0).clamp(0.0, 2.0))
        .unwrap_or(1.0);

    let holiday_days =
        holiday_day_indexes(ctx, organization_id, company_id, &pack_key, calendar_id);
    let working_days = calendar
        .as_ref()
        .map(|c| count_working_days(c, period_start, period_end, &holiday_days))
        .unwrap_or(20);
    let available_hours = (working_days as f64) * hours_per_day * efficiency;

    let leave_hours = if let Some(eid) = employee_id {
        ctx.db
            .hr_leave()
            .leave_by_employee()
            .filter(&eid)
            .filter(|l| {
                l.organization_id == organization_id
                    && l.company_id == company_id
                    && l.state == HrLeaveState::Validated
                    && l.deleted_at.is_none()
                    && ranges_overlap(l.date_from, l.date_to, period_start, period_end)
            })
            .map(|l| l.number_of_days * hours_per_day)
            .sum()
    } else {
        0.0
    };

    let allocated_hours: f64 = ctx
        .db
        .resource_allocation()
        .allocation_by_company()
        .filter(&company_id)
        .filter(|a| {
            a.organization_id == organization_id
                && a.active
                && (employee_id.is_some_and(|eid| a.employee_id == Some(eid))
                    || resource_id.is_some_and(|rid| a.resource_id == Some(rid)))
                && ranges_overlap(a.date_from, a.date_to, period_start, period_end)
        })
        .map(|a| allocation_hours_in_range(&a, available_hours))
        .sum();

    let actual_hours: f64 = if let Some(eid) = employee_id {
        ctx.db
            .project_timesheet()
            .iter()
            .filter(|t| {
                t.organization_id == organization_id
                    && t.company_id == company_id
                    && t.employee_id == eid
                    && ranges_overlap(t.date, t.date, period_start, period_end)
            })
            .map(|t| t.unit_amount)
            .sum()
    } else {
        0.0
    };

    let remaining_hours = available_hours - leave_hours - allocated_hours - actual_hours;

    // Upsert: delete existing snapshots for this employee/resource in org, insert fresh.
    let existing: Vec<u64> = ctx
        .db
        .resource_capacity_snapshot()
        .capacity_by_company()
        .filter(&company_id)
        .filter(|s| {
            s.organization_id == organization_id
                && s.employee_id == employee_id
                && s.resource_id == resource_id
        })
        .map(|s| s.id)
        .collect();
    for id in existing {
        ctx.db.resource_capacity_snapshot().id().delete(&id);
    }

    ctx.db
        .resource_capacity_snapshot()
        .insert(ResourceCapacitySnapshot {
            id: 0,
            organization_id,
            company_id,
            employee_id,
            resource_id,
            period_start,
            period_end,
            available_hours,
            leave_hours,
            allocated_hours,
            actual_hours,
            remaining_hours,
            calendar_id,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: Some(
                serde_json::json!({
                    "formula": "available - leave - allocations - actual",
                    "projection": "resource_capacity_snapshot",
                })
                .to_string(),
            ),
        });
}

/// Hook for leave approve — same txn as `approve_leave`.
pub fn on_leave_approved(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
) {
    let resource_id = ctx
        .db
        .hr_employee()
        .id()
        .find(&employee_id)
        .and_then(|e| e.resource_id);
    recompute_resource_capacity(
        ctx,
        organization_id,
        company_id,
        Some(employee_id),
        resource_id,
    );
}

fn validate_allocation_targets(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    project_id: u64,
    task_id: Option<u64>,
) -> Result<(), String> {
    let project = ctx
        .db
        .project_project()
        .id()
        .find(&project_id)
        .ok_or("Project not found")?;
    if project.organization_id != organization_id || project.company_id != company_id {
        return Err("Project does not belong to this company".to_string());
    }
    if let Some(tid) = task_id {
        let task = ctx
            .db
            .project_task()
            .id()
            .find(&tid)
            .ok_or("Task not found")?;
        if task.organization_id != organization_id || task.company_id != company_id {
            return Err("Task does not belong to this company".to_string());
        }
        if task.project_id.is_some_and(|pid| pid != project_id) {
            return Err("Task does not belong to the allocation project".to_string());
        }
    }
    Ok(())
}

fn assert_capacity_allows(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: Option<u64>,
    resource_id: Option<u64>,
    additional_hours: f64,
    exclude_allocation_id: Option<u64>,
) -> Result<(), String> {
    recompute_resource_capacity(ctx, organization_id, company_id, employee_id, resource_id);
    let snap = ctx
        .db
        .resource_capacity_snapshot()
        .capacity_by_company()
        .filter(&company_id)
        .find(|s| {
            s.organization_id == organization_id
                && s.employee_id == employee_id
                && s.resource_id == resource_id
        });
    let Some(snap) = snap else {
        return Ok(());
    };
    // Snapshot already includes all active allocations; when updating, add delta only.
    let _ = exclude_allocation_id;
    if snap.remaining_hours - additional_hours < -0.001 {
        return Err(format!(
            "over-allocation rejected: remaining {:.2}h, requested {:.2}h",
            snap.remaining_hours, additional_hours
        ));
    }
    Ok(())
}

fn micros_ymd(year: i32, month: u32, day: u32) -> i64 {
    // Approximate civil date → UTC midnight via days since 1970-01-01 (pilot seeds only).
    let (y, m) = if month <= 2 {
        (year - 1, month + 9)
    } else {
        (year, month - 3)
    };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u32;
    let doy = (153 * m + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = (era as i64) * 146097 + doe as i64 - 719468;
    days * MICROS_PER_DAY
}

fn holiday_seed_rows() -> Vec<(&'static str, &'static str, i64)> {
    // Sample pilot dates (not exhaustive statutory calendars).
    // AU/NZ (Oceania), ZA (Africa), SG (Asia). BR municipal overlays deferred.
    vec![
        ("au", "Australia Day", micros_ymd(2026, 1, 26)),
        ("au", "ANZAC Day", micros_ymd(2026, 4, 25)),
        ("au", "Christmas Day", micros_ymd(2026, 12, 25)),
        ("nz", "Waitangi Day", micros_ymd(2026, 2, 6)),
        ("nz", "ANZAC Day", micros_ymd(2026, 4, 25)),
        ("nz", "Christmas Day", micros_ymd(2026, 12, 25)),
        ("za", "Human Rights Day", micros_ymd(2026, 3, 21)),
        ("za", "Freedom Day", micros_ymd(2026, 4, 27)),
        ("za", "Day of Reconciliation", micros_ymd(2026, 12, 16)),
        ("sg", "Chinese New Year", micros_ymd(2026, 2, 17)),
        ("sg", "National Day", micros_ymd(2026, 8, 9)),
        ("sg", "Deepavali", micros_ymd(2026, 11, 8)),
        // Note: BR (LatAm) municipal overlays and SG region variants need pack metadata
        // beyond national samples — tracked for Wave C+ localization depth.
    ]
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_working_calendar(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateWorkingCalendarParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "working_calendar", "create")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;
    if params.name.trim().is_empty() {
        return Err("Calendar name cannot be empty".to_string());
    }
    if params.hours_per_day <= 0.0 {
        return Err("hours_per_day must be positive".to_string());
    }

    let row = ctx.db.working_calendar().insert(WorkingCalendar {
        id: 0,
        organization_id,
        company_id,
        name: params.name,
        pack_key: params.pack_key,
        hours_per_day: params.hours_per_day,
        work_monday: params.work_monday,
        work_tuesday: params.work_tuesday,
        work_wednesday: params.work_wednesday,
        work_thursday: params.work_thursday,
        work_friday: params.work_friday,
        work_saturday: params.work_saturday,
        work_sunday: params.work_sunday,
        active: params.active,
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
            table_name: "working_calendar",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": row.name,
                    "pack_key": row.pack_key,
                    "hours_per_day": row.hours_per_day,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "name".to_string(),
                "pack_key".to_string(),
                "hours_per_day".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn update_working_calendar(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    calendar_id: u64,
    params: UpdateWorkingCalendarParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "working_calendar", "write")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;
    let existing = ctx
        .db
        .working_calendar()
        .id()
        .find(&calendar_id)
        .ok_or("Working calendar not found")?;
    if existing.organization_id != organization_id {
        return Err("Calendar does not belong to this organization".to_string());
    }
    if existing.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    let updated = WorkingCalendar {
        name: params.name.unwrap_or(existing.name.clone()),
        pack_key: params.pack_key.unwrap_or(existing.pack_key.clone()),
        hours_per_day: params.hours_per_day.unwrap_or(existing.hours_per_day),
        work_monday: params.work_monday.unwrap_or(existing.work_monday),
        work_tuesday: params.work_tuesday.unwrap_or(existing.work_tuesday),
        work_wednesday: params.work_wednesday.unwrap_or(existing.work_wednesday),
        work_thursday: params.work_thursday.unwrap_or(existing.work_thursday),
        work_friday: params.work_friday.unwrap_or(existing.work_friday),
        work_saturday: params.work_saturday.unwrap_or(existing.work_saturday),
        work_sunday: params.work_sunday.unwrap_or(existing.work_sunday),
        active: params.active.unwrap_or(existing.active),
        metadata: match params.metadata {
            Some(v) => v,
            None => existing.metadata.clone(),
        },
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..existing
    };
    ctx.db.working_calendar().id().update(updated.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "working_calendar",
            record_id: calendar_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": updated.name }).to_string()),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn create_public_holiday(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreatePublicHolidayParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "public_holiday", "create")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;
    if params.name.trim().is_empty() {
        return Err("Holiday name cannot be empty".to_string());
    }
    if params.pack_key.trim().is_empty() {
        return Err("pack_key is required".to_string());
    }
    if let Some(cid) = params.calendar_id {
        let cal = ctx
            .db
            .working_calendar()
            .id()
            .find(&cid)
            .ok_or("Working calendar not found")?;
        if cal.organization_id != organization_id || cal.company_id != company_id {
            return Err("Calendar does not belong to this company".to_string());
        }
    }

    let row = ctx.db.public_holiday().insert(PublicHoliday {
        id: 0,
        organization_id,
        company_id,
        calendar_id: params.calendar_id,
        pack_key: params.pack_key,
        name: params.name,
        holiday_date: params.holiday_date,
        is_recurring: params.is_recurring,
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
            table_name: "public_holiday",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": row.name,
                    "pack_key": row.pack_key,
                })
                .to_string(),
            ),
            changed_fields: vec!["name".to_string(), "pack_key".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn update_public_holiday(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    holiday_id: u64,
    params: UpdatePublicHolidayParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "public_holiday", "write")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;
    let existing = ctx
        .db
        .public_holiday()
        .id()
        .find(&holiday_id)
        .ok_or("Public holiday not found")?;
    if existing.organization_id != organization_id {
        return Err("Holiday does not belong to this organization".to_string());
    }
    if existing.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    let updated = PublicHoliday {
        calendar_id: match params.calendar_id {
            Some(v) => v,
            None => existing.calendar_id,
        },
        pack_key: params.pack_key.unwrap_or(existing.pack_key.clone()),
        name: params.name.unwrap_or(existing.name.clone()),
        holiday_date: params.holiday_date.unwrap_or(existing.holiday_date),
        is_recurring: params.is_recurring.unwrap_or(existing.is_recurring),
        metadata: match params.metadata {
            Some(v) => v,
            None => existing.metadata.clone(),
        },
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..existing
    };
    ctx.db.public_holiday().id().update(updated.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "public_holiday",
            record_id: holiday_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": updated.name }).to_string()),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn seed_pack_holidays(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: SeedPackHolidaysParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "public_holiday", "create")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

    let keys: Vec<String> = if params.pack_keys.is_empty() {
        vec!["au".into(), "nz".into(), "za".into(), "sg".into()]
    } else {
        params.pack_keys
    };

    let mut created = 0u32;
    for (pack, name, micros) in holiday_seed_rows() {
        if !keys.iter().any(|k| k.eq_ignore_ascii_case(pack)) {
            continue;
        }
        let already = ctx
            .db
            .public_holiday()
            .holiday_by_org()
            .filter(&organization_id)
            .any(|h| {
                h.company_id == company_id
                    && h.pack_key.eq_ignore_ascii_case(pack)
                    && h.name == name
            });
        if already {
            continue;
        }
        ctx.db.public_holiday().insert(PublicHoliday {
            id: 0,
            organization_id,
            company_id,
            calendar_id: params.calendar_id,
            pack_key: pack.to_string(),
            name: name.to_string(),
            holiday_date: Timestamp::from_micros_since_unix_epoch(micros),
            is_recurring: false,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: Some(
                serde_json::json!({
                    "seed": "pilot",
                    "coverage_notes": "AU/NZ Oceania, ZA Africa, SG Asia national samples; BR municipal overlays deferred",
                })
                .to_string(),
            ),
        });
        created += 1;
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "public_holiday",
            record_id: 0,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "seeded": created }).to_string()),
            changed_fields: vec!["seed_pack_holidays".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn create_resource_allocation(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateResourceAllocationParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "resource_allocation", "create")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

    if params.date_to.to_micros_since_unix_epoch() < params.date_from.to_micros_since_unix_epoch() {
        return Err("date_to must be on or after date_from".to_string());
    }
    if params.allocated_hours < 0.0 || params.allocation_percent < 0.0 {
        return Err("allocated hours/percent cannot be negative".to_string());
    }
    if params.allocated_hours <= 0.0 && params.allocation_percent <= 0.0 {
        return Err("provide allocated_hours or allocation_percent".to_string());
    }

    let (employee_id, resource_id) =
        resolve_employee_resource(ctx, organization_id, params.employee_id, params.resource_id)?;
    validate_allocation_targets(
        ctx,
        organization_id,
        company_id,
        params.project_id,
        params.task_id,
    )?;

    let requested = if params.allocated_hours > 0.0 {
        params.allocated_hours
    } else {
        // Percent resolved against current available after recompute
        recompute_resource_capacity(ctx, organization_id, company_id, employee_id, resource_id);
        let avail = ctx
            .db
            .resource_capacity_snapshot()
            .capacity_by_company()
            .filter(&company_id)
            .find(|s| s.employee_id == employee_id && s.resource_id == resource_id)
            .map(|s| s.available_hours)
            .unwrap_or(160.0);
        avail * (params.allocation_percent / 100.0)
    };

    if params.enforce_capacity {
        // Pre-insert check: remaining must cover requested (snapshot without this row).
        recompute_resource_capacity(ctx, organization_id, company_id, employee_id, resource_id);
        assert_capacity_allows(
            ctx,
            organization_id,
            company_id,
            employee_id,
            resource_id,
            requested,
            None,
        )?;
    }

    let row = ctx.db.resource_allocation().insert(ResourceAllocation {
        id: 0,
        organization_id,
        company_id,
        employee_id,
        resource_id,
        project_id: params.project_id,
        task_id: params.task_id,
        date_from: params.date_from,
        date_to: params.date_to,
        allocated_hours: params.allocated_hours,
        allocation_percent: params.allocation_percent,
        name: params.name,
        notes: params.notes,
        enforce_capacity: params.enforce_capacity,
        active: params.active,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    recompute_resource_capacity(ctx, organization_id, company_id, employee_id, resource_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "resource_allocation",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "employee_id": row.employee_id,
                    "resource_id": row.resource_id,
                    "project_id": row.project_id,
                    "allocated_hours": row.allocated_hours,
                    "allocation_percent": row.allocation_percent,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "employee_id".to_string(),
                "project_id".to_string(),
                "allocated_hours".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn update_resource_allocation(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    allocation_id: u64,
    params: UpdateResourceAllocationParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "resource_allocation", "write")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

    let existing = ctx
        .db
        .resource_allocation()
        .id()
        .find(&allocation_id)
        .ok_or("Resource allocation not found")?;
    if existing.organization_id != organization_id {
        return Err("Allocation does not belong to this organization".to_string());
    }
    if existing.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    let project_id = params.project_id.unwrap_or(existing.project_id);
    let task_id = match params.task_id {
        Some(v) => v,
        None => existing.task_id,
    };
    validate_allocation_targets(ctx, organization_id, company_id, project_id, task_id)?;

    let (employee_id, resource_id) = resolve_employee_resource(
        ctx,
        organization_id,
        match params.employee_id {
            Some(v) => v,
            None => existing.employee_id,
        },
        match params.resource_id {
            Some(v) => v,
            None => existing.resource_id,
        },
    )?;

    let updated = ResourceAllocation {
        employee_id,
        resource_id,
        project_id,
        task_id,
        date_from: params.date_from.unwrap_or(existing.date_from),
        date_to: params.date_to.unwrap_or(existing.date_to),
        allocated_hours: params.allocated_hours.unwrap_or(existing.allocated_hours),
        allocation_percent: params
            .allocation_percent
            .unwrap_or(existing.allocation_percent),
        name: match params.name {
            Some(v) => v,
            None => existing.name.clone(),
        },
        notes: match params.notes {
            Some(v) => v,
            None => existing.notes.clone(),
        },
        enforce_capacity: params.enforce_capacity.unwrap_or(existing.enforce_capacity),
        active: params.active.unwrap_or(existing.active),
        metadata: match params.metadata {
            Some(v) => v,
            None => existing.metadata.clone(),
        },
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..existing
    };

    if updated.date_to.to_micros_since_unix_epoch() < updated.date_from.to_micros_since_unix_epoch()
    {
        return Err("date_to must be on or after date_from".to_string());
    }

    // Temporarily deactivate for capacity check, then apply.
    ctx.db
        .resource_allocation()
        .id()
        .update(ResourceAllocation {
            active: false,
            ..existing.clone()
        });

    if updated.enforce_capacity && updated.active {
        let requested = if updated.allocated_hours > 0.0 {
            updated.allocated_hours
        } else {
            0.0
        };
        if requested > 0.0 {
            if let Err(e) = assert_capacity_allows(
                ctx,
                organization_id,
                company_id,
                employee_id,
                resource_id,
                requested,
                Some(allocation_id),
            ) {
                // restore
                ctx.db.resource_allocation().id().update(existing);
                return Err(e);
            }
        }
    }

    ctx.db.resource_allocation().id().update(updated.clone());
    recompute_resource_capacity(ctx, organization_id, company_id, employee_id, resource_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "resource_allocation",
            record_id: allocation_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "allocated_hours": updated.allocated_hours,
                    "active": updated.active,
                })
                .to_string(),
            ),
            changed_fields: vec!["allocated_hours".to_string(), "active".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn delete_resource_allocation(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    allocation_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "resource_allocation", "delete")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;

    let existing = ctx
        .db
        .resource_allocation()
        .id()
        .find(&allocation_id)
        .ok_or("Resource allocation not found")?;
    if existing.organization_id != organization_id {
        return Err("Allocation does not belong to this organization".to_string());
    }
    if existing.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    let employee_id = existing.employee_id;
    let resource_id = existing.resource_id;
    ctx.db.resource_allocation().id().delete(&allocation_id);
    recompute_resource_capacity(ctx, organization_id, company_id, employee_id, resource_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "resource_allocation",
            record_id: allocation_id,
            action: "DELETE",
            old_values: Some(serde_json::json!({ "project_id": existing.project_id }).to_string()),
            new_values: None,
            changed_fields: vec!["deleted".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn refresh_resource_capacity(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "resource_allocation", "read")?;
    let _ = company_id_from_scope(ctx, organization_id, Some(company_id))?;
    let emp = ctx
        .db
        .hr_employee()
        .id()
        .find(&employee_id)
        .ok_or("Employee not found")?;
    if emp.organization_id != organization_id || emp.company_id != company_id {
        return Err("Employee does not belong to this company".to_string());
    }
    recompute_resource_capacity(
        ctx,
        organization_id,
        company_id,
        Some(employee_id),
        emp.resource_id,
    );
    Ok(())
}
