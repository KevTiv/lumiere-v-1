//! FLT-003/FLT-004: driver_id (hr_employee FK) and service_type_id
//! (FleetVehicleServiceType FK) relation guards.
use spacetimedb::{ReducerContext, Table};

use crate::fleet::fleet::{
    create_fleet_vehicle, create_fleet_vehicle_service_type, fleet_vehicle,
    fleet_vehicle_service_type, update_fleet_vehicle, CreateFleetVehicleParams,
    CreateFleetVehicleServiceTypeParams, UpdateFleetVehicleParams,
};
use crate::hr::employees::{create_employee, hr_employee, CreateEmployeeParams};
use crate::test_harness::OrgFixture;
use crate::types::EmploymentType;

fn create_vehicle(ctx: &ReducerContext, fixture: &OrgFixture, name: &str) -> Result<u64, String> {
    create_fleet_vehicle(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateFleetVehicleParams {
            name: name.to_string(),
            vehicle_type: "van".to_string(),
            license_plate: None,
            driver_name: None,
            driver_id: None,
            service_type_id: None,
            metadata: None,
        },
    )?;
    ctx.db
        .fleet_vehicle()
        .iter()
        .find(|v| v.organization_id == fixture.organization_id && v.name == name)
        .map(|v| v.id)
        .ok_or_else(|| format!("vehicle {name} not found after create"))
}

fn create_test_employee(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    name: &str,
) -> Result<u64, String> {
    create_employee(
        ctx,
        fixture.organization_id,
        CreateEmployeeParams {
            company_id: Some(fixture.company_id),
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
            metadata: None,
        },
    )?;
    ctx.db
        .hr_employee()
        .iter()
        .find(|e| e.organization_id == fixture.organization_id && e.name == name)
        .map(|e| e.id)
        .ok_or_else(|| format!("employee {name} not found after create"))
}

/// FLT-003: driver_id must resolve to a real, active, same-org/company hr_employee.
pub fn test_driver_id_relations(ctx: &ReducerContext) -> Result<(), String> {
    let local = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;

    let local_driver_id = create_test_employee(ctx, &local, "FLT-003 Local Driver")?;
    let foreign_driver_id = create_test_employee(ctx, &foreign, "FLT-003 Foreign Driver")?;
    let inactive_driver_id = create_test_employee(ctx, &local, "FLT-003 Inactive Driver")?;
    // Deactivate directly — there is no dedicated deactivate reducer for employees.
    if let Some(row) = ctx.db.hr_employee().id().find(&inactive_driver_id) {
        ctx.db.hr_employee().id().update(crate::hr::employees::HrEmployee {
            is_active: false,
            ..row
        });
    }
    let missing_driver_id = ctx
        .db
        .hr_employee()
        .iter()
        .map(|e| e.id)
        .max()
        .unwrap_or(0)
        + 1000;

    for (case, driver_id, expected) in [
        ("missing", missing_driver_id, "not found"),
        ("cross-org", foreign_driver_id, "organization"),
        ("inactive", inactive_driver_id, "not active"),
    ] {
        let create_result = create_fleet_vehicle(
            ctx,
            local.organization_id,
            local.company_id,
            CreateFleetVehicleParams {
                name: format!("FLT-003 Rejected Create {case}"),
                vehicle_type: "van".to_string(),
                license_plate: None,
                driver_name: None,
                driver_id: Some(driver_id),
                service_type_id: None,
                metadata: None,
            },
        );
        match create_result {
            Err(ref e) if e.contains(expected) => {}
            other => {
                return Err(format!(
                    "{case} driver create: expected {expected:?} error, got {other:?}"
                ))
            }
        }
        if ctx
            .db
            .fleet_vehicle()
            .iter()
            .any(|v| v.name == format!("FLT-003 Rejected Create {case}"))
        {
            return Err(format!("{case} driver create persisted a vehicle"));
        }

        let vehicle_id = create_vehicle(ctx, &local, &format!("FLT-003 Update Target {case}"))?;
        let update_result = update_fleet_vehicle(
            ctx,
            local.organization_id,
            local.company_id,
            vehicle_id,
            UpdateFleetVehicleParams {
                driver_id: Some(Some(driver_id)),
                service_type_id: None,
            },
        );
        match update_result {
            Err(ref e) if e.contains(expected) => {}
            other => {
                return Err(format!(
                    "{case} driver update: expected {expected:?} error, got {other:?}"
                ))
            }
        }
        let unchanged = ctx
            .db
            .fleet_vehicle()
            .id()
            .find(&vehicle_id)
            .ok_or("vehicle missing after rejected update")?;
        if unchanged.driver_id.is_some() {
            return Err(format!("{case} driver update mutated driver_id"));
        }
    }

    // Valid driver persists on create and update.
    let vehicle_id = create_vehicle(ctx, &local, "FLT-003 Valid Base")?;
    update_fleet_vehicle(
        ctx,
        local.organization_id,
        local.company_id,
        vehicle_id,
        UpdateFleetVehicleParams {
            driver_id: Some(Some(local_driver_id)),
            service_type_id: None,
        },
    )?;
    let persisted = ctx
        .db
        .fleet_vehicle()
        .id()
        .find(&vehicle_id)
        .ok_or("vehicle missing after valid update")?;
    if persisted.driver_id != Some(local_driver_id) {
        return Err("valid driver_id was not persisted".to_string());
    }

    Ok(())
}

/// FLT-004: service_type_id must resolve to a real, active, same-org
/// FleetVehicleServiceType (company-scoped when the type carries a company_id).
pub fn test_service_type_id_relations(ctx: &ReducerContext) -> Result<(), String> {
    let local = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;

    create_fleet_vehicle_service_type(
        ctx,
        local.organization_id,
        CreateFleetVehicleServiceTypeParams {
            name: "FLT-004 Local Type".to_string(),
            company_id: Some(local.company_id),
        },
    )?;
    let local_type_id = ctx
        .db
        .fleet_vehicle_service_type()
        .iter()
        .find(|t| t.organization_id == local.organization_id && t.name == "FLT-004 Local Type")
        .map(|t| t.id)
        .ok_or("local service type missing after create")?;

    create_fleet_vehicle_service_type(
        ctx,
        foreign.organization_id,
        CreateFleetVehicleServiceTypeParams {
            name: "FLT-004 Foreign Type".to_string(),
            company_id: None,
        },
    )?;
    let foreign_type_id = ctx
        .db
        .fleet_vehicle_service_type()
        .iter()
        .find(|t| t.organization_id == foreign.organization_id && t.name == "FLT-004 Foreign Type")
        .map(|t| t.id)
        .ok_or("foreign service type missing after create")?;

    create_fleet_vehicle_service_type(
        ctx,
        local.organization_id,
        CreateFleetVehicleServiceTypeParams {
            name: "FLT-004 Inactive Type".to_string(),
            company_id: Some(local.company_id),
        },
    )?;
    let inactive_type_id = ctx
        .db
        .fleet_vehicle_service_type()
        .iter()
        .find(|t| t.organization_id == local.organization_id && t.name == "FLT-004 Inactive Type")
        .map(|t| t.id)
        .ok_or("inactive service type missing after create")?;
    if let Some(row) = ctx
        .db
        .fleet_vehicle_service_type()
        .id()
        .find(&inactive_type_id)
    {
        ctx.db
            .fleet_vehicle_service_type()
            .id()
            .update(crate::fleet::fleet::FleetVehicleServiceType {
                is_active: false,
                ..row
            });
    }

    let missing_type_id = ctx
        .db
        .fleet_vehicle_service_type()
        .iter()
        .map(|t| t.id)
        .max()
        .unwrap_or(0)
        + 1000;

    for (case, type_id, expected) in [
        ("missing", missing_type_id, "not found"),
        ("cross-org", foreign_type_id, "organization"),
        ("inactive", inactive_type_id, "not active"),
    ] {
        let create_result = create_fleet_vehicle(
            ctx,
            local.organization_id,
            local.company_id,
            CreateFleetVehicleParams {
                name: format!("FLT-004 Rejected Create {case}"),
                vehicle_type: "van".to_string(),
                license_plate: None,
                driver_name: None,
                driver_id: None,
                service_type_id: Some(type_id),
                metadata: None,
            },
        );
        match create_result {
            Err(ref e) if e.contains(expected) => {}
            other => {
                return Err(format!(
                    "{case} service type create: expected {expected:?} error, got {other:?}"
                ))
            }
        }
        if ctx
            .db
            .fleet_vehicle()
            .iter()
            .any(|v| v.name == format!("FLT-004 Rejected Create {case}"))
        {
            return Err(format!("{case} service type create persisted a vehicle"));
        }
    }

    // Valid, company-scoped service type persists on create.
    let vehicle_id = create_fleet_vehicle(
        ctx,
        local.organization_id,
        local.company_id,
        CreateFleetVehicleParams {
            name: "FLT-004 Valid Vehicle".to_string(),
            vehicle_type: "van".to_string(),
            license_plate: None,
            driver_name: None,
            driver_id: None,
            service_type_id: Some(local_type_id),
            metadata: None,
        },
    )
    .and_then(|_| {
        ctx.db
            .fleet_vehicle()
            .iter()
            .find(|v| v.organization_id == local.organization_id && v.name == "FLT-004 Valid Vehicle")
            .map(|v| v.id)
            .ok_or_else(|| "valid vehicle missing after create".to_string())
    })?;
    let persisted = ctx
        .db
        .fleet_vehicle()
        .id()
        .find(&vehicle_id)
        .ok_or("vehicle missing after valid create")?;
    if persisted.service_type_id != Some(local_type_id) {
        return Err("valid service_type_id was not persisted".to_string());
    }

    Ok(())
}
