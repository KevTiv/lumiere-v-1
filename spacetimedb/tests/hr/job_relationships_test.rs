//! Persisted HR-005 coverage for employee-to-job relationships.

use spacetimedb::{ReducerContext, Table};

use crate::core::organization::{company, create_company, CreateCompanyParams};
use crate::hr::employees::{
    create_employee, create_job_position, hr_employee, hr_job_position, hr_resource,
    update_employee, CreateEmployeeParams, CreateJobPositionParams, UpdateEmployeeParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::EmploymentType;

fn seed_company(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    let name = format!("HR Job Relations Sibling {}", fixture.company_id);
    let currency_id = ctx
        .db
        .company()
        .id()
        .find(&fixture.company_id)
        .ok_or("fixture company missing while seeding HR job relationship test")?
        .currency_id;
    create_company(
        ctx,
        fixture.organization_id,
        CreateCompanyParams {
            name: name.clone(),
            code: format!("HR-JOB-{}", fixture.company_id),
            currency_id,
            fiscal_year_end_month: 12,
            fiscal_year_end_day: 31,
            is_parent: false,
            parent_id: None,
            tax_id: None,
            company_registry: None,
            address_street: None,
            address_city: None,
            address_zip: None,
            address_country_code: None,
            metadata: Some(r#"{"test":"hr_job_relationships"}"#.to_string()),
        },
    )?;
    ctx.db
        .company()
        .company_by_org()
        .filter(&fixture.organization_id)
        .find(|company| company.name == name)
        .map(|company| company.id)
        .ok_or_else(|| format!("company {name} missing after create"))
}

fn seed_job(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    name: &str,
    is_active: bool,
) -> Result<u64, String> {
    create_job_position(
        ctx,
        organization_id,
        CreateJobPositionParams {
            company_id: Some(company_id),
            name: name.to_string(),
            department_id: None,
            expected_employees: 1,
            description: Some("HR-005 persisted relationship evidence".to_string()),
            requirements: None,
            state: "open".to_string(),
            is_active,
        },
    )?;
    ctx.db
        .hr_job_position()
        .job_by_org()
        .filter(&organization_id)
        .find(|job| job.company_id == company_id && job.name == name)
        .map(|job| job.id)
        .ok_or_else(|| format!("job {name} missing after create"))
}

fn employee_params(company_id: u64, name: &str, job_id: Option<u64>) -> CreateEmployeeParams {
    CreateEmployeeParams {
        company_id: Some(company_id),
        name: name.to_string(),
        job_id,
        department_id: None,
        employment_type: EmploymentType::FullTime,
        work_email: None,
        employee_number: None,
        job_title: None,
        parent_id: None,
        coach_id: None,
        work_phone: None,
        mobile_phone: None,
        work_location: None,
        work_contact_partner_id: None,
        date_hired: None,
        gender: None,
        birthday: None,
        marital: None,
        emergency_contact: None,
        emergency_phone: None,
        barcode: None,
        pin: None,
        image_url: None,
        color: None,
        is_active: true,
        metadata: Some(r#"{"test":"hr_job_relationships"}"#.to_string()),
    }
}

fn update_job_params(job_id: u64) -> UpdateEmployeeParams {
    UpdateEmployeeParams {
        name: None,
        job_title: None,
        job_id: Some(job_id),
        department_id: None,
        parent_id: None,
        work_email: None,
        work_phone: None,
        mobile_phone: None,
        work_location: None,
        work_contact_partner_id: None,
        employment_type: None,
        user_id: None,
    }
}

fn missing_job_id(ctx: &ReducerContext) -> Result<u64, String> {
    ctx.db
        .hr_job_position()
        .iter()
        .map(|job| job.id)
        .max()
        .unwrap_or_default()
        .checked_add(1)
        .ok_or_else(|| "cannot derive a missing job id".to_string())
}

fn assert_create_rejected_without_side_effect(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    name: &str,
    job_id: u64,
    expected_error: &str,
) -> Result<(), String> {
    let employee_count = ctx.db.hr_employee().iter().count();
    let resource_count = ctx.db.hr_resource().iter().count();
    let result = create_employee(
        ctx,
        organization_id,
        employee_params(company_id, name, Some(job_id)),
    );
    let error = result.err().ok_or_else(|| {
        format!("invalid employee job assignment {name} was unexpectedly accepted")
    })?;
    if !error.contains(expected_error) {
        return Err(format!(
            "invalid employee job assignment {name} returned unexpected error: {error}"
        ));
    }
    if ctx.db.hr_employee().iter().count() != employee_count {
        return Err(format!(
            "rejected employee {name} changed persisted employees"
        ));
    }
    if ctx.db.hr_resource().iter().count() != resource_count {
        return Err(format!(
            "rejected employee {name} left an orphan HR resource"
        ));
    }
    Ok(())
}

fn assert_update_rejected_without_side_effect(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
    original_job_id: u64,
    rejected_job_id: u64,
    expected_error: &str,
) -> Result<(), String> {
    let employee_count = ctx.db.hr_employee().iter().count();
    let resource_count = ctx.db.hr_resource().iter().count();
    let result = update_employee(
        ctx,
        organization_id,
        company_id,
        employee_id,
        update_job_params(rejected_job_id),
    );
    let error = result
        .err()
        .ok_or("invalid employee job update was unexpectedly accepted")?;
    if !error.contains(expected_error) {
        return Err(format!(
            "invalid employee job update returned unexpected error: {error}"
        ));
    }
    let employee = ctx
        .db
        .hr_employee()
        .id()
        .find(&employee_id)
        .ok_or("employee disappeared after rejected job update")?;
    if employee.job_id != Some(original_job_id) {
        return Err("rejected employee job update changed the persisted job".into());
    }
    if ctx.db.hr_employee().iter().count() != employee_count
        || ctx.db.hr_resource().iter().count() != resource_count
    {
        return Err("rejected employee job update changed persisted row counts".into());
    }
    Ok(())
}

pub fn test_employee_job_relationships(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let local = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let sibling_company_id = seed_company(ctx, &local)?;

    let primary_job_id = seed_job(
        ctx,
        local.organization_id,
        local.company_id,
        &format!("HR-005 Primary Job {}", local.company_id),
        true,
    )?;
    let replacement_job_id = seed_job(
        ctx,
        local.organization_id,
        local.company_id,
        &format!("HR-005 Replacement Job {}", local.company_id),
        true,
    )?;
    let inactive_job_id = seed_job(
        ctx,
        local.organization_id,
        local.company_id,
        &format!("HR-005 Inactive Job {}", local.company_id),
        false,
    )?;
    let sibling_job_id = seed_job(
        ctx,
        local.organization_id,
        sibling_company_id,
        &format!("HR-005 Sibling Job {sibling_company_id}"),
        true,
    )?;
    let foreign_job_id = seed_job(
        ctx,
        foreign.organization_id,
        foreign.company_id,
        &format!("HR-005 Foreign Job {}", foreign.company_id),
        true,
    )?;
    let missing_job_id = missing_job_id(ctx)?;

    let employee_name = format!("HR-005 Persisted Employee {}", local.company_id);
    create_employee(
        ctx,
        local.organization_id,
        employee_params(local.company_id, &employee_name, Some(primary_job_id)),
    )?;
    let employee_id = ctx
        .db
        .hr_employee()
        .employee_by_company()
        .filter(&local.company_id)
        .find(|employee| employee.name == employee_name)
        .map(|employee| employee.id)
        .ok_or("valid employee job assignment was not persisted")?;

    update_employee(
        ctx,
        local.organization_id,
        local.company_id,
        employee_id,
        update_job_params(replacement_job_id),
    )?;
    let persisted = ctx
        .db
        .hr_employee()
        .id()
        .find(&employee_id)
        .ok_or("employee missing after valid job update")?;
    if persisted.job_id != Some(replacement_job_id) {
        return Err("valid employee job update was not persisted".into());
    }

    for (tag, job_id, expected_error) in [
        ("missing", missing_job_id, "not found"),
        ("cross-org", foreign_job_id, "different organization"),
        ("cross-company", sibling_job_id, "different company"),
        ("inactive", inactive_job_id, "not active"),
    ] {
        assert_create_rejected_without_side_effect(
            ctx,
            local.organization_id,
            local.company_id,
            &format!("HR-005 Rejected Create {tag} {}", local.company_id),
            job_id,
            expected_error,
        )?;
        assert_update_rejected_without_side_effect(
            ctx,
            local.organization_id,
            local.company_id,
            employee_id,
            replacement_job_id,
            job_id,
            expected_error,
        )?;
    }

    Ok(())
}
