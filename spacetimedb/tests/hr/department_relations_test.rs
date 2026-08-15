//! Persisted HR-003/004 coverage for department hierarchy and manager relations.

use spacetimedb::ReducerContext;

use crate::core::organization::{company, create_company, CreateCompanyParams};
use crate::hr::employees::{
    create_department, create_employee, hr_department, hr_employee, update_department,
    CreateDepartmentParams, CreateEmployeeParams, UpdateDepartmentParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::EmploymentType;

fn seed_company(ctx: &ReducerContext, fixture: &OrgFixture, tag: &str) -> Result<u64, String> {
    let name = format!("HR Relations {tag} {}", fixture.company_id);
    let currency_id = ctx
        .db
        .company()
        .id()
        .find(&fixture.company_id)
        .ok_or("fixture company missing while seeding HR relations company")?
        .currency_id;
    create_company(
        ctx,
        fixture.organization_id,
        CreateCompanyParams {
            name: name.clone(),
            code: format!("HR-{tag}-{}", fixture.company_id),
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
            metadata: Some(r#"{"test":"hr_department_relations"}"#.to_string()),
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

fn seed_employee(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    name: &str,
    is_active: bool,
) -> Result<u64, String> {
    create_employee(
        ctx,
        organization_id,
        CreateEmployeeParams {
            company_id: Some(company_id),
            name: name.to_string(),
            job_id: None,
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
            date_hired: Some(ctx.timestamp),
            gender: None,
            birthday: None,
            marital: None,
            emergency_contact: None,
            emergency_phone: None,
            barcode: None,
            pin: None,
            image_url: None,
            color: None,
            is_active,
            metadata: Some(r#"{"test":"hr_department_relations"}"#.to_string()),
        },
    )?;
    ctx.db
        .hr_employee()
        .employee_by_company()
        .filter(&company_id)
        .find(|employee| employee.name == name)
        .map(|employee| employee.id)
        .ok_or_else(|| format!("employee {name} missing after create"))
}

fn create_department_row(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    name: &str,
    parent_id: Option<u64>,
    manager_id: Option<u64>,
) -> Result<u64, String> {
    create_department(
        ctx,
        organization_id,
        CreateDepartmentParams {
            company_id: Some(company_id),
            name: name.to_string(),
            parent_id,
            complete_name: None,
            manager_id,
            note: Some("HR-003/004 persisted test".to_string()),
            is_active: true,
            color: None,
        },
    )?;
    ctx.db
        .hr_department()
        .dept_by_company()
        .filter(&company_id)
        .find(|department| department.name == name)
        .map(|department| department.id)
        .ok_or_else(|| format!("department {name} missing after create"))
}

fn assert_create_rejected(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    name: &str,
    parent_id: Option<u64>,
    manager_id: Option<u64>,
) -> Result<(), String> {
    let result = create_department_row(
        ctx,
        organization_id,
        company_id,
        name,
        parent_id,
        manager_id,
    );
    if result.is_ok() {
        return Err(format!("invalid department {name} was accepted"));
    }
    if ctx
        .db
        .hr_department()
        .dept_by_company()
        .filter(&company_id)
        .any(|department| department.name == name)
    {
        return Err(format!("rejected department {name} was persisted"));
    }
    Ok(())
}

pub fn test_department_create_relationships(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let local = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let sibling_company_id = seed_company(ctx, &local, "Sibling")?;

    let manager_id = seed_employee(
        ctx,
        local.organization_id,
        local.company_id,
        "HR Relations Manager",
        true,
    )?;
    let inactive_manager_id = seed_employee(
        ctx,
        local.organization_id,
        local.company_id,
        "HR Relations Inactive Manager",
        false,
    )?;
    let sibling_manager_id = seed_employee(
        ctx,
        local.organization_id,
        sibling_company_id,
        "HR Relations Sibling Manager",
        true,
    )?;
    let foreign_manager_id = seed_employee(
        ctx,
        foreign.organization_id,
        foreign.company_id,
        "HR Relations Foreign Manager",
        true,
    )?;

    let parent_id = create_department_row(
        ctx,
        local.organization_id,
        local.company_id,
        "HR Relations Parent",
        None,
        Some(manager_id),
    )?;
    let child_id = create_department_row(
        ctx,
        local.organization_id,
        local.company_id,
        "HR Relations Child",
        Some(parent_id),
        Some(manager_id),
    )?;
    let child = ctx
        .db
        .hr_department()
        .id()
        .find(&child_id)
        .ok_or("valid child department was not persisted")?;
    if child.parent_id != Some(parent_id) || child.manager_id != Some(manager_id) {
        return Err("valid department relations were not persisted".into());
    }

    let foreign_parent_id = create_department_row(
        ctx,
        foreign.organization_id,
        foreign.company_id,
        "HR Relations Foreign Parent",
        None,
        Some(foreign_manager_id),
    )?;
    let sibling_parent_id = create_department_row(
        ctx,
        local.organization_id,
        sibling_company_id,
        "HR Relations Sibling Parent",
        None,
        Some(sibling_manager_id),
    )?;

    assert_create_rejected(
        ctx,
        local.organization_id,
        local.company_id,
        "HR Relations Missing Parent",
        Some(u64::MAX),
        Some(manager_id),
    )?;
    assert_create_rejected(
        ctx,
        local.organization_id,
        local.company_id,
        "HR Relations Foreign Parent Rejected",
        Some(foreign_parent_id),
        Some(manager_id),
    )?;
    assert_create_rejected(
        ctx,
        local.organization_id,
        local.company_id,
        "HR Relations Sibling Parent Rejected",
        Some(sibling_parent_id),
        Some(manager_id),
    )?;
    assert_create_rejected(
        ctx,
        local.organization_id,
        local.company_id,
        "HR Relations Missing Manager",
        None,
        Some(u64::MAX),
    )?;
    assert_create_rejected(
        ctx,
        local.organization_id,
        local.company_id,
        "HR Relations Foreign Manager Rejected",
        None,
        Some(foreign_manager_id),
    )?;
    assert_create_rejected(
        ctx,
        local.organization_id,
        local.company_id,
        "HR Relations Sibling Manager Rejected",
        None,
        Some(sibling_manager_id),
    )?;
    assert_create_rejected(
        ctx,
        local.organization_id,
        local.company_id,
        "HR Relations Inactive Manager Rejected",
        None,
        Some(inactive_manager_id),
    )?;
    Ok(())
}

pub fn test_department_update_relationships(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let local = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let sibling_company_id = seed_company(ctx, &local, "UpdateSibling")?;

    let manager_id = seed_employee(
        ctx,
        local.organization_id,
        local.company_id,
        "HR Update Manager",
        true,
    )?;
    let replacement_manager_id = seed_employee(
        ctx,
        local.organization_id,
        local.company_id,
        "HR Update Replacement Manager",
        true,
    )?;
    let inactive_manager_id = seed_employee(
        ctx,
        local.organization_id,
        local.company_id,
        "HR Update Inactive Manager",
        false,
    )?;
    let foreign_manager_id = seed_employee(
        ctx,
        foreign.organization_id,
        foreign.company_id,
        "HR Update Foreign Manager",
        true,
    )?;
    let sibling_manager_id = seed_employee(
        ctx,
        local.organization_id,
        sibling_company_id,
        "HR Update Sibling Manager",
        true,
    )?;

    let root_id = create_department_row(
        ctx,
        local.organization_id,
        local.company_id,
        "HR Update Root",
        None,
        Some(manager_id),
    )?;
    let child_id = create_department_row(
        ctx,
        local.organization_id,
        local.company_id,
        "HR Update Child",
        Some(root_id),
        Some(manager_id),
    )?;
    let foreign_parent_id = create_department_row(
        ctx,
        foreign.organization_id,
        foreign.company_id,
        "HR Update Foreign Parent",
        None,
        Some(foreign_manager_id),
    )?;

    let update = |parent_id, manager_id| UpdateDepartmentParams {
        company_id: Some(local.company_id),
        name: None,
        parent_id,
        manager_id,
        note: None,
        is_active: None,
    };

    if update_department(
        ctx,
        local.organization_id,
        root_id,
        update(Some(child_id), None),
    )
    .is_ok()
    {
        return Err("department hierarchy cycle was accepted".into());
    }
    if update_department(
        ctx,
        local.organization_id,
        child_id,
        update(Some(u64::MAX), None),
    )
    .is_ok()
    {
        return Err("missing parent was accepted on update".into());
    }
    if update_department(
        ctx,
        local.organization_id,
        child_id,
        update(Some(foreign_parent_id), None),
    )
    .is_ok()
    {
        return Err("cross-organization parent was accepted on update".into());
    }
    for (label, invalid_manager_id) in [
        ("missing", u64::MAX),
        ("cross-organization", foreign_manager_id),
        ("cross-company", sibling_manager_id),
        ("inactive", inactive_manager_id),
    ] {
        if update_department(
            ctx,
            local.organization_id,
            child_id,
            update(None, Some(invalid_manager_id)),
        )
        .is_ok()
        {
            return Err(format!("{label} manager was accepted on update"));
        }
    }

    let root = ctx
        .db
        .hr_department()
        .id()
        .find(&root_id)
        .ok_or("root department missing after rejected cycle update")?;
    let child = ctx
        .db
        .hr_department()
        .id()
        .find(&child_id)
        .ok_or("child department missing after rejected updates")?;
    if root.parent_id.is_some()
        || child.parent_id != Some(root_id)
        || child.manager_id != Some(manager_id)
    {
        return Err("rejected department update changed persisted relations".into());
    }

    update_department(
        ctx,
        local.organization_id,
        child_id,
        update(None, Some(replacement_manager_id)),
    )?;
    let child = ctx
        .db
        .hr_department()
        .id()
        .find(&child_id)
        .ok_or("child department missing after valid manager update")?;
    if child.manager_id != Some(replacement_manager_id) {
        return Err("valid manager update was not persisted".into());
    }
    Ok(())
}
