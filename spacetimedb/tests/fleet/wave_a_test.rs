//! Fleet Wave A — company isolation on create / position update.
use spacetimedb::{ReducerContext, Table};

use crate::core::organization::{company, create_company, CreateCompanyParams};
use crate::fleet::fleet::{
    create_fleet_vehicle, fleet_vehicle, update_vehicle_position, CreateFleetVehicleParams,
    UpdateVehiclePositionParams, VehicleStatus,
};
use crate::test_harness::OrgFixture;

fn create_vehicle(ctx: &ReducerContext, fixture: &OrgFixture, name: &str) -> Result<u64, String> {
    create_fleet_vehicle(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateFleetVehicleParams {
            name: name.to_string(),
            vehicle_type: "truck".to_string(),
            license_plate: Some("ABC-1".to_string()),
            driver_name: None,
            driver_id: None,
            service_type_id: None,
            metadata: None,
        },
    )?;
    ctx.db
        .fleet_vehicle()
        .iter()
        .find(|v| {
            v.organization_id == fixture.organization_id
                && v.company_id == fixture.company_id
                && v.name == name
        })
        .map(|v| v.id)
        .ok_or_else(|| format!("vehicle {name} not found after create"))
}

fn seed_sibling_company(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    create_company(
        ctx,
        fixture.organization_id,
        CreateCompanyParams {
            name: "Fleet Iso Company B".to_string(),
            code: format!("FB-{}", fixture.company_id),
            currency_id: 1,
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
            metadata: Some(r#"{"harness":"fleet-iso-b"}"#.to_string()),
        },
    )?;
    ctx.db
        .company()
        .company_by_org()
        .filter(&fixture.organization_id)
        .map(|c| c.id)
        .filter(|id| *id != fixture.company_id)
        .max()
        .ok_or_else(|| "sibling company B missing".to_string())
}

/// Sibling company in the same org cannot update another company's vehicle.
pub fn test_company_isolation_on_position_update(ctx: &ReducerContext) -> Result<(), String> {
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let company_b = seed_sibling_company(ctx, &fixture_a)?;
    let vehicle_id = create_vehicle(ctx, &fixture_a, "Iso Truck A")?;

    let err = update_vehicle_position(
        ctx,
        fixture_a.organization_id,
        company_b,
        vehicle_id,
        UpdateVehiclePositionParams {
            latitude: -33.8688,
            longitude: 151.2093,
            speed_kmh: 40.0,
            heading: 90.0,
            status: "active".to_string(),
        },
    )
    .expect_err("company B must not update company A vehicle");

    if !err.contains("does not belong") {
        return Err(format!("unexpected isolation error: {err}"));
    }

    update_vehicle_position(
        ctx,
        fixture_a.organization_id,
        fixture_a.company_id,
        vehicle_id,
        UpdateVehiclePositionParams {
            latitude: -33.8688,
            longitude: 151.2093,
            speed_kmh: 40.0,
            heading: 90.0,
            status: "active".to_string(),
        },
    )?;

    let row = ctx
        .db
        .fleet_vehicle()
        .id()
        .find(&vehicle_id)
        .ok_or("vehicle missing after update")?;
    if row.company_id != fixture_a.company_id {
        return Err("company_id mutated unexpectedly".to_string());
    }
    if row.status != VehicleStatus::Active {
        return Err("status not Active after update".to_string());
    }
    if row.latitude != Some(-33.8688) || row.longitude != Some(151.2093) {
        return Err("position not updated".to_string());
    }
    Ok(())
}

/// Create requires a company in the organization and stores company_id.
pub fn test_create_requires_company_scope(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let other = OrgFixture::seed_minimal(ctx)?;

    let err = create_fleet_vehicle(
        ctx,
        fixture.organization_id,
        other.company_id,
        CreateFleetVehicleParams {
            name: "Cross Org".to_string(),
            vehicle_type: "van".to_string(),
            license_plate: None,
            driver_name: None,
            driver_id: None,
            service_type_id: None,
            metadata: None,
        },
    )
    .expect_err("foreign company_id must be rejected");

    if !err.contains("Company does not belong") {
        return Err(format!("unexpected create error: {err}"));
    }

    let id = create_vehicle(ctx, &fixture, "Scoped Van")?;
    let row = ctx
        .db
        .fleet_vehicle()
        .id()
        .find(&id)
        .ok_or("vehicle missing")?;
    if row.company_id != fixture.company_id {
        return Err("create did not persist company_id".to_string());
    }
    if row.status != VehicleStatus::Idle {
        return Err("new vehicle should start Idle".to_string());
    }
    Ok(())
}
