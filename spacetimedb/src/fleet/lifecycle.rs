//! Immutable vehicle service and inspection history.

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::require_company_in_organization;
use crate::core::persistence::{record_organization_commit, OrganizationCommitInput, RowChange};
use crate::fleet::fleet::{
    fleet_vehicle, require_fleet_driver_in_org_and_company,
    require_fleet_service_type_in_org_and_company, require_fleet_vehicle_company, FleetVehicle,
};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum FleetInspectionOutcome {
    Passed,
    Failed,
    AttentionRequired,
}

impl FleetInspectionOutcome {
    fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "passed" => Ok(Self::Passed),
            "failed" => Ok(Self::Failed),
            "attention_required" => Ok(Self::AttentionRequired),
            _ => Err("Inspection outcome must be passed, failed, or attention_required".into()),
        }
    }
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = fleet_service_record,
    public,
    index(accessor = fleet_service_record_by_org, btree(columns = [organization_id])),
    index(accessor = fleet_service_record_by_company, btree(columns = [company_id])),
    index(accessor = fleet_service_record_by_vehicle, btree(columns = [vehicle_id])),
    index(accessor = fleet_service_record_by_type, btree(columns = [service_type_id]))
)]
pub struct FleetServiceRecord {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub vehicle_id: u64,
    pub service_type_id: u64,
    pub serviced_at: Timestamp,
    pub odometer_km: Option<f64>,
    pub provider: Option<String>,
    pub notes: Option<String>,
    pub client_request_id: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = fleet_inspection,
    public,
    index(accessor = fleet_inspection_by_org, btree(columns = [organization_id])),
    index(accessor = fleet_inspection_by_company, btree(columns = [company_id])),
    index(accessor = fleet_inspection_by_vehicle, btree(columns = [vehicle_id]))
)]
pub struct FleetInspection {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub vehicle_id: u64,
    pub inspector_id: Option<u64>,
    pub inspected_at: Timestamp,
    pub outcome: FleetInspectionOutcome,
    pub odometer_km: Option<f64>,
    pub notes: Option<String>,
    pub client_request_id: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordFleetServiceParams {
    pub vehicle_id: u64,
    pub service_type_id: u64,
    pub serviced_at: Option<Timestamp>,
    pub odometer_km: Option<f64>,
    pub provider: Option<String>,
    pub notes: Option<String>,
    pub client_request_id: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordFleetInspectionParams {
    pub vehicle_id: u64,
    pub inspector_id: Option<u64>,
    pub inspected_at: Option<Timestamp>,
    pub outcome: String,
    pub odometer_km: Option<f64>,
    pub notes: Option<String>,
    pub client_request_id: Option<String>,
}

fn normalized(value: Option<String>) -> Option<String> {
    value.and_then(|text| {
        let text = text.trim();
        (!text.is_empty()).then(|| text.to_string())
    })
}

fn request_id(value: Option<String>) -> Result<Option<String>, String> {
    let value = normalized(value);
    if value.as_ref().is_some_and(|value| value.len() > 128) {
        return Err("client_request_id must not exceed 128 characters".into());
    }
    Ok(value)
}

fn require_vehicle(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    vehicle_id: u64,
) -> Result<FleetVehicle, String> {
    require_company_in_organization(ctx, organization_id, company_id)?;
    let vehicle = ctx
        .db
        .fleet_vehicle()
        .id()
        .find(&vehicle_id)
        .ok_or_else(|| format!("Vehicle {vehicle_id} not found"))?;
    require_fleet_vehicle_company(&vehicle, organization_id, company_id)?;
    Ok(vehicle)
}

fn odometer(value: Option<f64>) -> Result<Option<f64>, String> {
    if value.is_some_and(|value| !value.is_finite() || value < 0.0) {
        return Err("odometer_km must be a finite non-negative value".into());
    }
    Ok(value)
}

fn latest_odometer(vehicle: &FleetVehicle, value: Option<f64>) -> Option<f64> {
    match (vehicle.odometer_km, value) {
        (Some(current), Some(candidate)) => Some(current.max(candidate)),
        (None, Some(candidate)) => Some(candidate),
        (current, None) => current,
    }
}

fn commit(
    ctx: &ReducerContext,
    organization_id: u64,
    operation_id: &str,
    correlation_id: String,
    changes: Vec<RowChange>,
) -> Result<(), String> {
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: operation_id.into(),
            correlation_id,
            changes,
        },
    )?;
    Ok(())
}

#[reducer]
pub fn record_fleet_service(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: RecordFleetServiceParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "fleet_vehicle", "write")?;
    let vehicle = require_vehicle(ctx, organization_id, company_id, params.vehicle_id)?;
    require_fleet_service_type_in_org_and_company(
        ctx,
        organization_id,
        company_id,
        params.service_type_id,
    )?;
    let request_id = request_id(params.client_request_id)?;
    if request_id.as_deref().is_some_and(|key| {
        ctx.db.fleet_service_record().iter().any(|row| {
            row.organization_id == organization_id
                && row.company_id == company_id
                && row.client_request_id.as_deref() == Some(key)
        })
    }) {
        return Ok(());
    }
    let odometer_km = odometer(params.odometer_km)?;
    let row = ctx.db.fleet_service_record().insert(FleetServiceRecord {
        id: 0,
        organization_id,
        company_id,
        vehicle_id: params.vehicle_id,
        service_type_id: params.service_type_id,
        serviced_at: params.serviced_at.unwrap_or(ctx.timestamp),
        odometer_km,
        provider: normalized(params.provider),
        notes: normalized(params.notes),
        client_request_id: request_id.clone(),
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
    });
    let vehicle = FleetVehicle {
        service_type_id: Some(params.service_type_id),
        odometer_km: latest_odometer(&vehicle, odometer_km),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..vehicle
    };
    ctx.db.fleet_vehicle().id().update(vehicle.clone());
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "fleet_service_record",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "vehicle_id": row.vehicle_id,
                    "service_type_id": row.service_type_id,
                    "odometer_km": row.odometer_km,
                })
                .to_string(),
            ),
            changed_fields: vec!["vehicle_id".into(), "service_type_id".into()],
            metadata: None,
        },
    );
    commit(
        ctx,
        organization_id,
        "erp.record_fleet_service",
        request_id.unwrap_or_else(|| format!("fleet-service:{}", row.id)),
        vec![
            RowChange::upsert_stdb_row(
                "fleet_service_record",
                serde_json::json!({"id": row.id}),
                &row,
            )?,
            RowChange::upsert_stdb_row(
                "fleet_vehicle",
                serde_json::json!({"id": vehicle.id}),
                &vehicle,
            )?,
        ],
    )
}

#[reducer]
pub fn record_fleet_inspection(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: RecordFleetInspectionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "fleet_vehicle", "write")?;
    let vehicle = require_vehicle(ctx, organization_id, company_id, params.vehicle_id)?;
    if let Some(inspector_id) = params.inspector_id {
        require_fleet_driver_in_org_and_company(ctx, organization_id, company_id, inspector_id)?;
    }
    let outcome = FleetInspectionOutcome::parse(&params.outcome)?;
    let request_id = request_id(params.client_request_id)?;
    if request_id.as_deref().is_some_and(|key| {
        ctx.db.fleet_inspection().iter().any(|row| {
            row.organization_id == organization_id
                && row.company_id == company_id
                && row.client_request_id.as_deref() == Some(key)
        })
    }) {
        return Ok(());
    }
    let odometer_km = odometer(params.odometer_km)?;
    let row = ctx.db.fleet_inspection().insert(FleetInspection {
        id: 0,
        organization_id,
        company_id,
        vehicle_id: params.vehicle_id,
        inspector_id: params.inspector_id,
        inspected_at: params.inspected_at.unwrap_or(ctx.timestamp),
        outcome,
        odometer_km,
        notes: normalized(params.notes),
        client_request_id: request_id.clone(),
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
    });
    let vehicle = FleetVehicle {
        odometer_km: latest_odometer(&vehicle, odometer_km),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..vehicle
    };
    ctx.db.fleet_vehicle().id().update(vehicle.clone());
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "fleet_inspection",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "vehicle_id": row.vehicle_id,
                    "outcome": params.outcome,
                    "odometer_km": row.odometer_km,
                })
                .to_string(),
            ),
            changed_fields: vec!["vehicle_id".into(), "outcome".into()],
            metadata: None,
        },
    );
    commit(
        ctx,
        organization_id,
        "erp.record_fleet_inspection",
        request_id.unwrap_or_else(|| format!("fleet-inspection:{}", row.id)),
        vec![
            RowChange::upsert_stdb_row(
                "fleet_inspection",
                serde_json::json!({"id": row.id}),
                &row,
            )?,
            RowChange::upsert_stdb_row(
                "fleet_vehicle",
                serde_json::json!({"id": vehicle.id}),
                &vehicle,
            )?,
        ],
    )
}
