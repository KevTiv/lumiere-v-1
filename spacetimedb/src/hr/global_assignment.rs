/// Cross-border / multi-jurisdiction employee assignments (home ↔ host company).
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::company;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::hr::employees::hr_employee;

// ── Tables ────────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = hr_global_assignment,
    public,
    index(accessor = global_assign_by_org, btree(columns = [organization_id])),
    index(accessor = global_assign_by_company, btree(columns = [company_id])),
    index(accessor = global_assign_by_employee, btree(columns = [employee_id])),
    index(accessor = global_assign_by_host, btree(columns = [host_company_id]))
)]
pub struct HrGlobalAssignment {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    /// Primary tenant scope — home company for permission checks.
    pub company_id: u64,
    pub employee_id: u64,
    pub home_company_id: u64,
    pub host_company_id: u64,
    pub date_from: Timestamp,
    pub date_to: Option<Timestamp>,
    /// planned | active | completed | cancelled
    pub status: String,
    pub notes: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateHrGlobalAssignmentParams {
    pub employee_id: u64,
    pub home_company_id: u64,
    pub host_company_id: u64,
    pub date_from: Timestamp,
    pub date_to: Option<Timestamp>,
    pub status: String,
    pub notes: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateHrGlobalAssignmentParams {
    pub home_company_id: Option<u64>,
    pub host_company_id: Option<u64>,
    pub date_from: Option<Timestamp>,
    pub date_to: Option<Timestamp>,
    pub status: Option<String>,
    pub notes: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn normalize_assignment_status(status: &str) -> Result<String, String> {
    let s = status.trim().to_lowercase();
    match s.as_str() {
        "planned" | "active" | "completed" | "cancelled" => Ok(s),
        _ => Err("status must be planned, active, completed, or cancelled".to_string()),
    }
}

fn assert_company_in_org(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    label: &str,
) -> Result<(), String> {
    let company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or_else(|| format!("{label} company not found"))?;
    if company.organization_id != organization_id {
        return Err(format!(
            "{label} company belongs to a different organization"
        ));
    }
    if company.deleted_at.is_some() {
        return Err(format!("{label} company is archived"));
    }
    Ok(())
}

fn assert_employee_scope(
    ctx: &ReducerContext,
    organization_id: u64,
    employee_id: u64,
) -> Result<HrEmployeeRef, String> {
    let emp = ctx
        .db
        .hr_employee()
        .id()
        .find(&employee_id)
        .ok_or("Employee not found")?;
    if emp.organization_id != organization_id {
        return Err("Employee belongs to a different organization".to_string());
    }
    Ok(HrEmployeeRef {
        company_id: emp.company_id,
    })
}

struct HrEmployeeRef {
    company_id: u64,
}

fn validate_assignment_dates(
    date_from: Timestamp,
    date_to: Option<Timestamp>,
) -> Result<(), String> {
    if let Some(end) = date_to {
        if end < date_from {
            return Err("date_to must be on or after date_from".to_string());
        }
    }
    Ok(())
}

// ── Reducers ──────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_hr_global_assignment(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateHrGlobalAssignmentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_global_assignment", "create")?;

    let emp = assert_employee_scope(ctx, organization_id, params.employee_id)?;
    if emp.company_id != params.home_company_id {
        return Err("Employee home company must match employee.company_id".to_string());
    }
    if company_id != params.home_company_id {
        return Err("company_id must match home_company_id for this assignment".to_string());
    }

    assert_company_in_org(ctx, organization_id, params.home_company_id, "Home")?;
    assert_company_in_org(ctx, organization_id, params.host_company_id, "Host")?;
    validate_assignment_dates(params.date_from, params.date_to)?;

    let status = normalize_assignment_status(&params.status)?;

    let row = ctx.db.hr_global_assignment().insert(HrGlobalAssignment {
        id: 0,
        organization_id,
        company_id,
        employee_id: params.employee_id,
        home_company_id: params.home_company_id,
        host_company_id: params.host_company_id,
        date_from: params.date_from,
        date_to: params.date_to,
        status,
        notes: params.notes,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_global_assignment",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "employee_id": params.employee_id,
                    "home_company_id": params.home_company_id,
                    "host_company_id": params.host_company_id,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "employee_id".to_string(),
                "home_company_id".to_string(),
                "host_company_id".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn update_hr_global_assignment(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    assignment_id: u64,
    params: UpdateHrGlobalAssignmentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_global_assignment", "update")?;

    let existing = ctx
        .db
        .hr_global_assignment()
        .id()
        .find(&assignment_id)
        .ok_or("Global assignment not found")?;
    if existing.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if existing.organization_id != organization_id {
        return Err("Record belongs to a different organization".to_string());
    }

    let home_company_id = params.home_company_id.unwrap_or(existing.home_company_id);
    let host_company_id = params.host_company_id.unwrap_or(existing.host_company_id);
    let date_from = params.date_from.unwrap_or(existing.date_from);
    let date_to = match params.date_to {
        Some(v) => Some(v),
        None => existing.date_to,
    };

    assert_company_in_org(ctx, organization_id, home_company_id, "Home")?;
    assert_company_in_org(ctx, organization_id, host_company_id, "Host")?;
    validate_assignment_dates(date_from, date_to)?;

    let status_changed = params.status.is_some();
    let status = match params.status {
        Some(s) => normalize_assignment_status(&s)?,
        None => existing.status,
    };

    let mut changed_fields: Vec<String> = Vec::new();
    if params.home_company_id.is_some() {
        changed_fields.push("home_company_id".to_string());
    }
    if params.host_company_id.is_some() {
        changed_fields.push("host_company_id".to_string());
    }
    if params.date_from.is_some() {
        changed_fields.push("date_from".to_string());
    }
    if params.date_to.is_some() {
        changed_fields.push("date_to".to_string());
    }
    if status_changed {
        changed_fields.push("status".to_string());
    }
    if params.notes.is_some() {
        changed_fields.push("notes".to_string());
    }

    ctx.db
        .hr_global_assignment()
        .id()
        .update(HrGlobalAssignment {
            home_company_id,
            host_company_id,
            date_from,
            date_to,
            status,
            notes: params.notes.or(existing.notes),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..existing
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_global_assignment",
            record_id: assignment_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields,
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn delete_hr_global_assignment(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    assignment_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_global_assignment", "delete")?;

    let existing = ctx
        .db
        .hr_global_assignment()
        .id()
        .find(&assignment_id)
        .ok_or("Global assignment not found")?;
    if existing.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if existing.organization_id != organization_id {
        return Err("Record belongs to a different organization".to_string());
    }

    ctx.db.hr_global_assignment().id().delete(&assignment_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_global_assignment",
            record_id: assignment_id,
            action: "DELETE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}
