//! Immutable vehicle service and inspection history.

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::journal_entries::{
    account_move, add_account_move_line, create_account_move, post_account_move,
    CreateAccountMoveParams,
};
use crate::accounting::line_params::journal_line_params;
use crate::core::organization::require_company_in_organization;
use crate::core::persistence::{record_organization_commit, OrganizationCommitInput, RowChange};
use crate::fleet::fleet::{
    fleet_vehicle, require_fleet_driver_in_org_and_company,
    require_fleet_service_type_in_org_and_company, require_fleet_vehicle_company, FleetVehicle,
};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::{AccountMoveState, MoveType};

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
    pub cost_amount: Option<f64>,
    pub currency_id: Option<u64>,
    pub account_move_id: Option<u64>,
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
    pub cost_amount: Option<f64>,
    pub journal_id: Option<u64>,
    pub expense_account_id: Option<u64>,
    pub offset_account_id: Option<u64>,
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
    let serviced_at = params.serviced_at.unwrap_or(ctx.timestamp);

    let cost_amount = match params.cost_amount {
        Some(value) if !value.is_finite() || value <= 0.0 => {
            return Err("cost_amount must be a finite positive value".to_string());
        }
        other => other,
    };

    let (currency_id, account_move_id) = if let Some(cost_amount) = cost_amount {
        let request_id = request_id
            .as_deref()
            .ok_or("client_request_id is required when posting a fleet service cost")?;
        let journal_id = params
            .journal_id
            .ok_or("journal_id is required when posting a fleet service cost")?;
        let expense_account_id = params
            .expense_account_id
            .ok_or("expense_account_id is required when posting a fleet service cost")?;
        let offset_account_id = params
            .offset_account_id
            .ok_or("offset_account_id is required when posting a fleet service cost")?;

        let move_ref = format!("FLEET-SERVICE:{request_id}");
        create_account_move(
            ctx,
            organization_id,
            CreateAccountMoveParams {
                idempotency_key: format!("fleet-service-cost:{request_id}"),
                company_id: Some(company_id),
                journal_id,
                move_type: MoveType::Entry,
                date: serviced_at,
                name: String::new(),
                ref_: Some(move_ref.clone()),
                auto_post: false,
                to_check: false,
                is_storno: false,
                partner_id: None,
                partner_bank_id: None,
                fiscal_position_id: None,
                invoice_date: None,
                invoice_date_due: None,
                invoice_payment_term_id: None,
                payment_reference: None,
                invoice_origin: Some(format!("Fleet service vehicle {}", params.vehicle_id)),
                invoice_partner_display_name: None,
                invoice_cash_rounding_id: None,
                partner_shipping_id: None,
                sale_order_id: None,
                invoice_incoterm_id: None,
                incoterm_location: None,
                campaign_id: None,
                source_id: None,
                medium_id: None,
                secure_sequence_number: None,
                metadata: Some(
                    serde_json::json!({
                        "source": "fleet_service",
                        "vehicle_id": params.vehicle_id,
                        "service_type_id": params.service_type_id,
                        "client_request_id": request_id,
                    })
                    .to_string(),
                ),
            },
        )?;

        let move_record = ctx
            .db
            .account_move()
            .iter()
            .find(|row| {
                row.organization_id == organization_id
                    && row.company_id == company_id
                    && row.ref_.as_deref() == Some(move_ref.as_str())
            })
            .ok_or("Fleet service accounting move missing after create")?;

        add_account_move_line(
            ctx,
            organization_id,
            move_record.id,
            journal_line_params(
                expense_account_id,
                format!("Fleet service {}", params.vehicle_id),
                cost_amount,
                0.0,
                1,
            ),
        )?;
        add_account_move_line(
            ctx,
            organization_id,
            move_record.id,
            journal_line_params(
                offset_account_id,
                format!("Fleet service offset {}", params.vehicle_id),
                0.0,
                cost_amount,
                2,
            ),
        )?;
        post_account_move(ctx, organization_id, move_record.id)?;

        let posted = ctx
            .db
            .account_move()
            .id()
            .find(&move_record.id)
            .ok_or("Fleet service accounting move missing after post")?;
        if posted.state != AccountMoveState::Posted {
            return Err("Fleet service accounting move did not post".to_string());
        }
        (Some(posted.currency_id), Some(posted.id))
    } else {
        if params.journal_id.is_some()
            || params.expense_account_id.is_some()
            || params.offset_account_id.is_some()
        {
            return Err(
                "fleet service accounting fields require cost_amount".to_string(),
            );
        }
        (None, None)
    };

    let row = ctx.db.fleet_service_record().insert(FleetServiceRecord {
        id: 0,
        organization_id,
        company_id,
        vehicle_id: params.vehicle_id,
        service_type_id: params.service_type_id,
        serviced_at,
        odometer_km,
        provider: normalized(params.provider),
        notes: normalized(params.notes),
        cost_amount,
        currency_id,
        account_move_id,
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
                    "cost_amount": row.cost_amount,
                    "currency_id": row.currency_id,
                    "account_move_id": row.account_move_id,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "vehicle_id".into(),
                "service_type_id".into(),
                "cost_amount".into(),
                "currency_id".into(),
                "account_move_id".into(),
            ],
            metadata: None,
        },
    );
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.record_fleet_service".into(),
            correlation_id: request_id.unwrap_or_else(|| format!("fleet-service:{}", row.id)),
            changes: vec![
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
        },
    )?;
    Ok(())
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
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.record_fleet_inspection".into(),
            correlation_id: request_id.unwrap_or_else(|| format!("fleet-inspection:{}", row.id)),
            changes: vec![
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
        },
    )?;
    Ok(())
}
