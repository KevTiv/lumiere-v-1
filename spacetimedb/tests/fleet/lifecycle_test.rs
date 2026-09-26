//! Fleet service and inspection lifecycle regression coverage.
use spacetimedb::{ReducerContext, Table};

use crate::core::organization::{company, create_company, CreateCompanyParams};
use crate::fleet::fleet::{
    create_fleet_vehicle, create_fleet_vehicle_service_type, fleet_vehicle,
    fleet_vehicle_service_type, CreateFleetVehicleParams, CreateFleetVehicleServiceTypeParams,
};
use crate::fleet::lifecycle::{
    fleet_inspection, fleet_service_record, record_fleet_inspection, record_fleet_service,
    FleetInspectionOutcome, RecordFleetInspectionParams, RecordFleetServiceParams,
};
use crate::hr::employees::{create_employee, hr_employee, CreateEmployeeParams};
use crate::test_harness::OrgFixture;
use crate::types::EmploymentType;

fn vehicle(ctx: &ReducerContext, fixture: &OrgFixture, name: &str) -> Result<u64, String> {
    create_fleet_vehicle(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateFleetVehicleParams {
            name: name.into(),
            vehicle_type: "van".into(),
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
        .find(|row| row.organization_id == fixture.organization_id && row.name == name)
        .map(|row| row.id)
        .ok_or_else(|| format!("vehicle {name} missing after create"))
}

fn service_type(ctx: &ReducerContext, fixture: &OrgFixture, name: &str) -> Result<u64, String> {
    create_fleet_vehicle_service_type(
        ctx,
        fixture.organization_id,
        CreateFleetVehicleServiceTypeParams {
            name: name.into(),
            company_id: Some(fixture.company_id),
        },
    )?;
    ctx.db
        .fleet_vehicle_service_type()
        .iter()
        .find(|row| row.organization_id == fixture.organization_id && row.name == name)
        .map(|row| row.id)
        .ok_or_else(|| format!("service type {name} missing after create"))
}

fn employee(ctx: &ReducerContext, fixture: &OrgFixture, name: &str) -> Result<u64, String> {
    create_employee(
        ctx,
        fixture.organization_id,
        CreateEmployeeParams {
            company_id: Some(fixture.company_id),
            name: name.into(),
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
        .find(|row| row.organization_id == fixture.organization_id && row.name == name)
        .map(|row| row.id)
        .ok_or_else(|| format!("employee {name} missing after create"))
}

fn sibling_company(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    create_company(
        ctx,
        fixture.organization_id,
        CreateCompanyParams {
            name: "Fleet Lifecycle Company B".into(),
            code: format!("FLC-{}", fixture.company_id),
            currency_id: fixture.currency_id,
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
            metadata: None,
        },
    )?;
    ctx.db
        .company()
        .company_by_org()
        .filter(&fixture.organization_id)
        .map(|row| row.id)
        .filter(|id| *id != fixture.company_id)
        .max()
        .ok_or("sibling company missing".into())
}

pub fn test_history_is_immutable_and_idempotent(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let vehicle_id = vehicle(ctx, &fixture, "Fleet Lifecycle Van")?;
    let service_type_id = service_type(ctx, &fixture, "Fleet Lifecycle Service")?;
    let inspector_id = employee(ctx, &fixture, "Fleet Lifecycle Inspector")?;

    let service = RecordFleetServiceParams {
        vehicle_id,
        service_type_id,
        serviced_at: None,
        odometer_km: Some(1250.5),
        provider: Some("  Local Garage  ".into()),
        notes: Some("  oil and filter  ".into()),
        client_request_id: Some("fleet-service-idempotency".into()),
    };
    record_fleet_service(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        service.clone(),
    )?;
    record_fleet_service(ctx, fixture.organization_id, fixture.company_id, service)?;
    let services = ctx
        .db
        .fleet_service_record()
        .iter()
        .filter(|row| row.vehicle_id == vehicle_id)
        .collect::<Vec<_>>();
    if services.len() != 1 || services[0].provider.as_deref() != Some("Local Garage") {
        return Err("service history was not normalized and idempotent".into());
    }

    let inspection = RecordFleetInspectionParams {
        vehicle_id,
        inspector_id: Some(inspector_id),
        inspected_at: None,
        outcome: "attention_required".into(),
        odometer_km: Some(1240.0),
        notes: Some("  tyre pressure  ".into()),
        client_request_id: Some("fleet-inspection-idempotency".into()),
    };
    record_fleet_inspection(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        inspection.clone(),
    )?;
    record_fleet_inspection(ctx, fixture.organization_id, fixture.company_id, inspection)?;
    let inspections = ctx
        .db
        .fleet_inspection()
        .iter()
        .filter(|row| row.vehicle_id == vehicle_id)
        .collect::<Vec<_>>();
    if inspections.len() != 1 || inspections[0].outcome != FleetInspectionOutcome::AttentionRequired
    {
        return Err("inspection history was not typed and idempotent".into());
    }

    let updated = ctx
        .db
        .fleet_vehicle()
        .id()
        .find(&vehicle_id)
        .ok_or("vehicle missing after history writes")?;
    if updated.odometer_km != Some(1250.5) {
        return Err("older inspection odometer regressed the vehicle projection".into());
    }
    Ok(())
}

pub fn test_history_rejects_invalid_scope_and_values(ctx: &ReducerContext) -> Result<(), String> {
    let local = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let local_vehicle_id = vehicle(ctx, &local, "Fleet Guard Vehicle")?;
    let local_type_id = service_type(ctx, &local, "Fleet Guard Service")?;
    let foreign_type_id = service_type(ctx, &foreign, "Foreign Fleet Service")?;
    let foreign_inspector_id = employee(ctx, &foreign, "Foreign Fleet Inspector")?;
    let company_b = sibling_company(ctx, &local)?;

    let invalid_services = [
        (company_b, local_type_id, Some(1.0), "does not belong"),
        (local.company_id, foreign_type_id, Some(1.0), "organization"),
        (local.company_id, local_type_id, Some(-1.0), "non-negative"),
    ];
    for (company_id, service_type_id, odometer_km, expected) in invalid_services {
        let error = record_fleet_service(
            ctx,
            local.organization_id,
            company_id,
            RecordFleetServiceParams {
                vehicle_id: local_vehicle_id,
                service_type_id,
                serviced_at: None,
                odometer_km,
                provider: None,
                notes: None,
                client_request_id: None,
            },
        )
        .expect_err("invalid service history must be rejected");
        if !error.contains(expected) {
            return Err(format!("unexpected service validation error: {error}"));
        }
    }

    for (inspector_id, outcome, expected) in [
        (None, "unknown", "outcome"),
        (Some(foreign_inspector_id), "passed", "organization"),
    ] {
        let error = record_fleet_inspection(
            ctx,
            local.organization_id,
            local.company_id,
            RecordFleetInspectionParams {
                vehicle_id: local_vehicle_id,
                inspector_id,
                inspected_at: None,
                outcome: outcome.into(),
                odometer_km: Some(5.0),
                notes: None,
                client_request_id: None,
            },
        )
        .expect_err("invalid inspection history must be rejected");
        if !error.to_ascii_lowercase().contains(expected) {
            return Err(format!("unexpected inspection validation error: {error}"));
        }
    }

    if ctx
        .db
        .fleet_service_record()
        .iter()
        .any(|row| row.vehicle_id == local_vehicle_id)
        || ctx
            .db
            .fleet_inspection()
            .iter()
            .any(|row| row.vehicle_id == local_vehicle_id)
    {
        return Err("rejected lifecycle write persisted history".into());
    }
    Ok(())
}
