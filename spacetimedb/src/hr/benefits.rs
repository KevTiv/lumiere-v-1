/// HR Benefits — plan catalog and employee enrollment stubs (MVP).
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::hr::employees::hr_employee;

// ── Tables ────────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = hr_benefit_plan,
    public,
    index(accessor = benefit_plan_by_org, btree(columns = [organization_id])),
    index(accessor = benefit_plan_by_company, btree(columns = [company_id]))
)]
pub struct HrBenefitPlan {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    pub description: Option<String>,
    /// health | dental | retirement | other
    pub plan_type: String,
    pub active: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

#[spacetimedb::table(
    accessor = hr_benefit_enrollment,
    public,
    index(accessor = benefit_enroll_by_plan, btree(columns = [plan_id])),
    index(accessor = benefit_enroll_by_employee, btree(columns = [employee_id])),
    index(accessor = benefit_enroll_by_org, btree(columns = [organization_id]))
)]
pub struct HrBenefitEnrollment {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub plan_id: u64,
    pub employee_id: u64,
    /// enrolled | terminated
    pub state: String,
    pub effective_from: Timestamp,
    pub effective_to: Option<Timestamp>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateBenefitPlanParams {
    pub name: String,
    pub description: Option<String>,
    pub plan_type: String,
    pub active: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct AssignBenefitEnrollmentParams {
    pub plan_id: u64,
    pub employee_id: u64,
    pub effective_from: Timestamp,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn assert_employee_scope(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
) -> Result<(), String> {
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
    Ok(())
}

fn active_enrollment_for(
    ctx: &ReducerContext,
    plan_id: u64,
    employee_id: u64,
) -> Option<HrBenefitEnrollment> {
    ctx.db
        .hr_benefit_enrollment()
        .benefit_enroll_by_plan()
        .filter(&plan_id)
        .find(|row| row.employee_id == employee_id && row.state == "enrolled")
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_benefit_plan(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateBenefitPlanParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_employee", "create")?;
    if params.name.trim().is_empty() {
        return Err("Plan name cannot be empty".to_string());
    }
    let plan_type = params.plan_type.trim();
    if !matches!(plan_type, "health" | "dental" | "retirement" | "other") {
        return Err("plan_type must be health, dental, retirement, or other".to_string());
    }

    let row = ctx.db.hr_benefit_plan().insert(HrBenefitPlan {
        id: 0,
        organization_id,
        company_id,
        name: params.name.trim().to_string(),
        description: params.description,
        plan_type: plan_type.to_string(),
        active: params.active,
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
            table_name: "hr_benefit_plan",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": row.name,
                    "plan_type": row.plan_type,
                })
                .to_string(),
            ),
            changed_fields: vec!["name".to_string(), "plan_type".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn assign_benefit_enrollment(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: AssignBenefitEnrollmentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_employee", "create")?;
    assert_employee_scope(ctx, organization_id, company_id, params.employee_id)?;

    let plan = ctx
        .db
        .hr_benefit_plan()
        .id()
        .find(&params.plan_id)
        .ok_or("Benefit plan not found")?;
    if plan.organization_id != organization_id {
        return Err("Plan belongs to a different organization".to_string());
    }
    if plan.company_id != company_id {
        return Err("Plan does not belong to this company".to_string());
    }
    if !plan.active {
        return Err("Benefit plan is not active".to_string());
    }

    if active_enrollment_for(ctx, params.plan_id, params.employee_id).is_some() {
        return Err("Employee is already enrolled in this benefit plan".to_string());
    }

    let row = ctx.db.hr_benefit_enrollment().insert(HrBenefitEnrollment {
        id: 0,
        organization_id,
        company_id,
        plan_id: params.plan_id,
        employee_id: params.employee_id,
        state: "enrolled".to_string(),
        effective_from: params.effective_from,
        effective_to: None,
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
            table_name: "hr_benefit_enrollment",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "plan_id": params.plan_id,
                    "employee_id": params.employee_id,
                    "state": "enrolled",
                })
                .to_string(),
            ),
            changed_fields: vec![
                "plan_id".to_string(),
                "employee_id".to_string(),
                "state".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn unenroll_benefit_enrollment(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    enrollment_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "hr_employee", "update")?;

    let enrollment = ctx
        .db
        .hr_benefit_enrollment()
        .id()
        .find(&enrollment_id)
        .ok_or("Benefit enrollment not found")?;
    if enrollment.organization_id != organization_id {
        return Err("Enrollment belongs to a different organization".to_string());
    }
    if enrollment.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if enrollment.state != "enrolled" {
        return Err("Only active enrollments can be unenrolled".to_string());
    }

    ctx.db
        .hr_benefit_enrollment()
        .id()
        .update(HrBenefitEnrollment {
            state: "terminated".to_string(),
            effective_to: Some(ctx.timestamp),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..enrollment
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "hr_benefit_enrollment",
            record_id: enrollment_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "enrolled" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "terminated" }).to_string()),
            changed_fields: vec!["state".to_string(), "effective_to".to_string()],
            metadata: None,
        },
    );
    Ok(())
}
