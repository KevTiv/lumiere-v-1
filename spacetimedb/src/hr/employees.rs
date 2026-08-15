/// HR Employees — HrResource, HrDepartment, HrJobPosition, HrEmployee
///
/// Core HR entity tables. Based on the Supabase/Odoo HR schema.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::company_id_from_scope;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

// ── HR-003/004 helpers ────────────────────────────────────────────────────────

/// HR-003: Validate that setting `new_parent_id` for `dept_id` would not create
/// a cycle in the department hierarchy. Walks the parent chain (BFS) up to 100
/// hops — anything deeper is treated as a cycle to prevent infinite loops.
fn validate_department_no_cycle(
    ctx: &ReducerContext,
    organization_id: u64,
    dept_id: u64,
    new_parent_id: u64,
) -> Result<(), String> {
    if new_parent_id == dept_id {
        return Err("A department cannot be its own parent".to_string());
    }
    let mut current = new_parent_id;
    for _ in 0..100 {
        let parent = match ctx.db.hr_department().id().find(&current) {
            Some(d) => d,
            None => break, // dangling parent → chain ends, no cycle
        };
        if parent.organization_id != organization_id {
            return Err("Parent department belongs to a different organization".to_string());
        }
        match parent.parent_id {
            None => break,
            Some(grand) if grand == dept_id => {
                return Err("Setting this parent would create a department hierarchy cycle".to_string());
            }
            Some(grand) => current = grand,
        }
    }
    Ok(())
}
use crate::hr::offboarding::{assert_offboarding_ready_for_archive, ArchiveEmployeeParams};
use crate::hr::pii::employee_audit_json;
use crate::types::EmploymentType;

// ── Tables ────────────────────────────────────────────────────────────────────

/// HR Resource — Scheduling capacity unit (one per employee or material resource).
#[spacetimedb::table(
    accessor = hr_resource,
    public,
    index(accessor = resource_by_org, btree(columns = [organization_id]))
)]
pub struct HrResource {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub resource_type: String, // "user" | "material"
    pub user_id: Option<Identity>,
    pub time_efficiency: f64, // 100.0 = full capacity
    pub is_active: bool,
    pub created_at: Timestamp,
}

/// HR Department — Organizational unit within a company.
#[spacetimedb::table(
    accessor = hr_department,
    public,
    index(accessor = dept_by_org, btree(columns = [organization_id])),
    index(accessor = dept_by_company, btree(columns = [company_id]))
)]
pub struct HrDepartment {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    pub complete_name: Option<String>, // e.g. "Engineering / Frontend"
    pub parent_id: Option<u64>,        // FK → HrDepartment (tree structure)
    pub manager_id: Option<u64>,       // FK → HrEmployee
    pub note: Option<String>,
    pub is_active: bool,
    pub color: Option<u32>,
    pub created_at: Timestamp,
}

/// HR Job Position — A role that can be filled by employees.
#[spacetimedb::table(
    accessor = hr_job_position,
    public,
    index(accessor = job_by_org, btree(columns = [organization_id])),
    index(accessor = job_by_dept, btree(columns = [department_id]))
)]
pub struct HrJobPosition {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    pub department_id: Option<u64>,
    pub expected_employees: u32,
    pub no_of_employee: u32,
    pub description: Option<String>,
    pub requirements: Option<String>,
    pub state: String, // "recruit" | "open"
    pub is_active: bool,
    pub created_at: Timestamp,
}

/// HR Employee — A person employed by the organization.
#[spacetimedb::table(
    accessor = hr_employee,
    public,
    index(accessor = employee_by_org, btree(columns = [organization_id])),
    index(accessor = employee_by_company, btree(columns = [company_id])),
    index(accessor = employee_by_dept, btree(columns = [department_id]))
)]
pub struct HrEmployee {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub user_id: Option<Identity>, // Linked UserProfile (if has login)
    pub resource_id: Option<u64>,  // FK → HrResource
    pub name: String,
    pub employee_number: Option<String>,
    pub job_title: Option<String>,
    pub job_id: Option<u64>,        // FK → HrJobPosition
    pub department_id: Option<u64>, // FK → HrDepartment
    pub parent_id: Option<u64>,     // FK → HrEmployee (direct manager)
    pub coach_id: Option<u64>,      // FK → HrEmployee (HR coach)
    pub work_email: Option<String>,
    pub work_phone: Option<String>,
    pub mobile_phone: Option<String>,
    pub work_location: Option<String>,
    /// Optional res.partner used as remittance / payable partner on expense posts.
    pub work_contact_partner_id: Option<u64>,
    pub date_hired: Option<Timestamp>,
    pub date_terminated: Option<Timestamp>,
    pub employment_type: EmploymentType,
    pub gender: Option<String>,
    pub birthday: Option<Timestamp>,
    pub marital: Option<String>, // "single" | "married" | "other"
    pub emergency_contact: Option<String>,
    pub emergency_phone: Option<String>,
    pub barcode: Option<String>,
    pub pin: Option<String>,
    pub image_url: Option<String>,
    pub color: Option<u32>,
    pub is_active: bool,
    pub created_at: Timestamp,
    pub deleted_at: Option<Timestamp>,
    pub metadata: Option<String>,
}

// ── Input Params ──────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateDepartmentParams {
    pub company_id: Option<u64>,
    pub name: String,
    pub parent_id: Option<u64>,
    pub complete_name: Option<String>,
    pub manager_id: Option<u64>,
    pub note: Option<String>,
    pub is_active: bool,
    pub color: Option<u32>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateDepartmentParams {
    pub company_id: Option<u64>,
    pub name: Option<String>,
    pub parent_id: Option<u64>,
    pub manager_id: Option<u64>,
    pub note: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateJobPositionParams {
    pub company_id: Option<u64>,
    pub name: String,
    pub department_id: Option<u64>,
    pub expected_employees: u32,
    pub description: Option<String>,
    pub requirements: Option<String>,
    pub state: String,
    pub is_active: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateJobPositionParams {
    pub company_id: Option<u64>,
    pub name: Option<String>,
    pub department_id: Option<u64>,
    pub description: Option<String>,
    pub requirements: Option<String>,
    pub state: Option<String>,
    pub expected_employees: Option<u32>,
    pub is_active: Option<bool>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateEmployeeParams {
    pub company_id: Option<u64>,
    pub name: String,
    pub job_id: Option<u64>,
    pub department_id: Option<u64>,
    pub employment_type: EmploymentType,
    pub work_email: Option<String>,
    pub employee_number: Option<String>,
    pub job_title: Option<String>,
    pub parent_id: Option<u64>,
    pub coach_id: Option<u64>,
    pub work_phone: Option<String>,
    pub mobile_phone: Option<String>,
    pub work_location: Option<String>,
    pub work_contact_partner_id: Option<u64>,
    pub date_hired: Option<Timestamp>,
    pub gender: Option<String>,
    pub birthday: Option<Timestamp>,
    pub marital: Option<String>,
    pub emergency_contact: Option<String>,
    pub emergency_phone: Option<String>,
    pub barcode: Option<String>,
    pub pin: Option<String>,
    pub image_url: Option<String>,
    pub color: Option<u32>,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateEmployeeParams {
    pub name: Option<String>,
    pub job_title: Option<String>,
    pub job_id: Option<u64>,
    pub department_id: Option<u64>,
    pub parent_id: Option<u64>,
    pub work_email: Option<String>,
    pub work_phone: Option<String>,
    pub mobile_phone: Option<String>,
    pub work_location: Option<String>,
    pub work_contact_partner_id: Option<u64>,
    pub employment_type: Option<EmploymentType>,
    pub user_id: Option<Identity>,
}

// ── Reducers: Departments ─────────────────────────────────────────────────────

#[reducer]
pub fn create_department(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateDepartmentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_department", "create")?;
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    if params.name.is_empty() {
        return Err("Department name cannot be empty".to_string());
    }
    // HR-004: Validate manager_id FK.
    if let Some(mid) = params.manager_id {
        let mgr = ctx.db.hr_employee().id().find(&mid)
            .ok_or("Manager employee not found")?;
        if mgr.organization_id != organization_id {
            return Err("Manager does not belong to this organization".to_string());
        }
    }
    // HR-003: Validate parent_id FK (cycle detection deferred — new dept has no id yet,
    // so only validate existence and org match on create; cycles impossible for new rows).
    if let Some(pid) = params.parent_id {
        let parent = ctx.db.hr_department().id().find(&pid)
            .ok_or("Parent department not found")?;
        if parent.organization_id != organization_id {
            return Err("Parent department belongs to a different organization".to_string());
        }
    }
    let dept = ctx.db.hr_department().insert(HrDepartment {
        id: 0,
        organization_id,
        company_id,
        name: params.name,
        complete_name: params.complete_name,
        parent_id: params.parent_id,
        manager_id: params.manager_id,
        note: params.note,
        is_active: params.is_active,
        color: params.color,
        created_at: ctx.timestamp,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_department",
            record_id: dept.id,
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
pub fn update_department(
    ctx: &ReducerContext,
    organization_id: u64,
    department_id: u64,
    params: UpdateDepartmentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_department", "update")?;
    let dept = ctx
        .db
        .hr_department()
        .id()
        .find(&department_id)
        .ok_or("Department not found")?;
    if dept.organization_id != organization_id {
        return Err("Department belongs to a different organization".to_string());
    }
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    if dept.company_id != company_id {
        return Err("Department does not belong to this company".to_string());
    }
    // HR-004: Validate manager_id FK on update.
    if let Some(mid) = params.manager_id {
        let mgr = ctx.db.hr_employee().id().find(&mid)
            .ok_or("Manager employee not found")?;
        if mgr.organization_id != organization_id {
            return Err("Manager does not belong to this organization".to_string());
        }
    }
    // HR-003: Validate parent_id FK + cycle detection on update.
    if let Some(pid) = params.parent_id {
        validate_department_no_cycle(ctx, organization_id, department_id, pid)?;
    }
    ctx.db.hr_department().id().update(HrDepartment {
        name: params.name.unwrap_or(dept.name),
        parent_id: params.parent_id.or(dept.parent_id),
        manager_id: params.manager_id.or(dept.manager_id),
        note: params.note.or(dept.note),
        is_active: params.is_active.unwrap_or(dept.is_active),
        ..dept
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_department",
            record_id: department_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

// ── Reducers: Job Positions ───────────────────────────────────────────────────

#[reducer]
pub fn create_job_position(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateJobPositionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_job_position", "create")?;
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    if params.name.is_empty() {
        return Err("Job position name cannot be empty".to_string());
    }
    let job = ctx.db.hr_job_position().insert(HrJobPosition {
        id: 0,
        organization_id,
        company_id,
        name: params.name,
        department_id: params.department_id,
        expected_employees: params.expected_employees,
        no_of_employee: 0,
        description: params.description,
        requirements: params.requirements,
        state: params.state,
        is_active: params.is_active,
        created_at: ctx.timestamp,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_job_position",
            record_id: job.id,
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
pub fn update_job_position(
    ctx: &ReducerContext,
    organization_id: u64,
    job_id: u64,
    params: UpdateJobPositionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_job_position", "update")?;
    let job = ctx
        .db
        .hr_job_position()
        .id()
        .find(&job_id)
        .ok_or("Job position not found")?;
    if job.organization_id != organization_id {
        return Err("Job position belongs to a different organization".to_string());
    }
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    if job.company_id != company_id {
        return Err("Job position does not belong to this company".to_string());
    }
    ctx.db.hr_job_position().id().update(HrJobPosition {
        name: params.name.unwrap_or(job.name),
        department_id: params.department_id.or(job.department_id),
        description: params.description.or(job.description),
        requirements: params.requirements.or(job.requirements),
        state: params.state.unwrap_or(job.state),
        expected_employees: params.expected_employees.unwrap_or(job.expected_employees),
        is_active: params.is_active.unwrap_or(job.is_active),
        ..job
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_job_position",
            record_id: job_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

// ── Reducers: Employees ───────────────────────────────────────────────────────

#[reducer]
pub fn create_employee(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateEmployeeParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_employee", "create")?;
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    if params.name.is_empty() {
        return Err("Employee name cannot be empty".to_string());
    }
    // Create a resource for scheduling
    let resource = ctx.db.hr_resource().insert(HrResource {
        id: 0,
        organization_id,
        name: params.name.clone(),
        resource_type: "user".to_string(),
        user_id: None,
        time_efficiency: 100.0,
        is_active: params.is_active,
        created_at: ctx.timestamp,
    });
    let date_hired = params.date_hired.or(Some(ctx.timestamp));
    let employee = ctx.db.hr_employee().insert(HrEmployee {
        id: 0,
        organization_id,
        company_id,
        user_id: None,
        resource_id: Some(resource.id),
        name: params.name,
        employee_number: params.employee_number,
        job_title: params.job_title,
        job_id: params.job_id,
        department_id: params.department_id,
        parent_id: params.parent_id,
        coach_id: params.coach_id,
        work_email: params.work_email,
        work_phone: params.work_phone,
        mobile_phone: params.mobile_phone,
        work_location: params.work_location,
        work_contact_partner_id: params.work_contact_partner_id,
        date_hired,
        date_terminated: None,
        employment_type: params.employment_type,
        gender: params.gender,
        birthday: params.birthday,
        marital: params.marital,
        emergency_contact: params.emergency_contact,
        emergency_phone: params.emergency_phone,
        barcode: params.barcode,
        pin: params.pin,
        image_url: params.image_url,
        color: params.color,
        is_active: params.is_active,
        created_at: ctx.timestamp,
        deleted_at: None,
        metadata: params.metadata,
    });
    let new_snapshot = employee_audit_json(&employee);
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_employee",
            record_id: employee.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(new_snapshot),
            changed_fields: vec![
                "name".to_string(),
                "department_id".to_string(),
                "employment_type".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn update_employee(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
    params: UpdateEmployeeParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_employee", "update")?;
    let emp = ctx
        .db
        .hr_employee()
        .id()
        .find(&employee_id)
        .ok_or("Employee not found")?;
    if emp.organization_id != organization_id {
        return Err("Employee belongs to a different organization".to_string());
    }
    if emp.company_id != company_id {
        return Err("Employee does not belong to this company".to_string());
    }
    let old_snapshot = employee_audit_json(&emp);
    let changed_fields: Vec<String> = [
        (params.name.is_some(), "name"),
        (params.job_title.is_some(), "job_title"),
        (params.job_id.is_some(), "job_id"),
        (params.department_id.is_some(), "department_id"),
        (params.parent_id.is_some(), "parent_id"),
        (params.work_email.is_some(), "work_email"),
        (params.work_phone.is_some(), "work_phone"),
        (params.mobile_phone.is_some(), "mobile_phone"),
        (params.work_location.is_some(), "work_location"),
        (
            params.work_contact_partner_id.is_some(),
            "work_contact_partner_id",
        ),
        (params.employment_type.is_some(), "employment_type"),
        (params.user_id.is_some(), "user_id"),
    ]
    .into_iter()
    .filter(|(set, _)| *set)
    .map(|(_, field)| field.to_string())
    .collect();
    let updated = HrEmployee {
        name: params.name.unwrap_or(emp.name),
        job_title: params.job_title.or(emp.job_title),
        job_id: params.job_id.or(emp.job_id),
        department_id: params.department_id.or(emp.department_id),
        parent_id: params.parent_id.or(emp.parent_id),
        work_email: params.work_email.or(emp.work_email),
        work_phone: params.work_phone.or(emp.work_phone),
        mobile_phone: params.mobile_phone.or(emp.mobile_phone),
        work_location: params.work_location.or(emp.work_location),
        work_contact_partner_id: params
            .work_contact_partner_id
            .or(emp.work_contact_partner_id),
        employment_type: params.employment_type.unwrap_or(emp.employment_type),
        user_id: params.user_id.or(emp.user_id),
        ..emp
    };
    let new_snapshot = employee_audit_json(&updated);
    ctx.db.hr_employee().id().update(updated);
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_employee",
            record_id: employee_id,
            action: "UPDATE",
            old_values: Some(old_snapshot),
            new_values: Some(new_snapshot),
            changed_fields,
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn archive_employee(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
    params: ArchiveEmployeeParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_employee", "update")?;
    let emp = ctx
        .db
        .hr_employee()
        .id()
        .find(&employee_id)
        .ok_or("Employee not found")?;
    if emp.organization_id != organization_id {
        return Err("Employee belongs to a different organization".to_string());
    }
    if emp.company_id != company_id {
        return Err("Employee does not belong to this company".to_string());
    }
    assert_offboarding_ready_for_archive(ctx, organization_id, company_id, employee_id, &params)?;
    let old_snapshot = employee_audit_json(&emp);
    let archived = HrEmployee {
        is_active: false,
        date_terminated: params.termination_date.or(Some(ctx.timestamp)),
        deleted_at: Some(ctx.timestamp),
        ..emp
    };
    let new_snapshot = employee_audit_json(&archived);
    ctx.db.hr_employee().id().update(archived);
    let metadata = if params.override_incomplete_checklist {
        Some(format!(
            "archive_employee;override={}",
            params.override_reason.unwrap_or_default()
        ))
    } else {
        Some("archive_employee".to_string())
    };
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_employee",
            record_id: employee_id,
            action: "UPDATE",
            old_values: Some(old_snapshot),
            new_values: Some(new_snapshot),
            changed_fields: vec![
                "is_active".to_string(),
                "date_terminated".to_string(),
                "deleted_at".to_string(),
            ],
            metadata,
        },
    );
    Ok(())
}
