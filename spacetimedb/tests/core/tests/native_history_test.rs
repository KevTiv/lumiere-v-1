//! Persisted native coverage for explicit company and organization-wide history.

use spacetimedb::ReducerContext;

use crate::core::audit::{log_audit_event, LogAuditEventParams};
use crate::core::business_changes::{business_change, organization_business_change};
use crate::core::persistence::{organization_commit, organization_row_change};
use crate::fleet::fleet::{
    create_fleet_vehicle, fleet_vehicle, upsert_warehouse_geo, warehouse_geo,
    CreateFleetVehicleParams,
};
use crate::fleet::lifecycle::{
    fleet_inspection, record_fleet_inspection, RecordFleetInspectionParams,
};
use crate::inventory::product::{product, update_product, UpdateProductParams};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

pub(super) fn test_native_audit_capture(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let original_name = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("Product fixture missing")?
        .name;
    update_product(
        ctx,
        org,
        fixture.product_id,
        UpdateProductParams {
            name: Some("Native source history product".into()),
            categ_id: None,
            standard_price: None,
            list_price: None,
            description: None,
            sale_ok: None,
            purchase_ok: None,
            active: None,
            is_published: None,
        },
    )?;
    let history = ctx
        .db
        .organization_business_change()
        .organization_business_change_by_organization()
        .filter(&org)
        .find(|row| {
            row.resource == "product"
                && row.record_id == fixture.product_id
                && row.operation == "update_product"
        })
        .ok_or("organization-wide native product history missing")?;
    if history.actor_identity != ctx.sender() || history.subject_record_id != fixture.product_id {
        return Err("organization-wide native history lost exact actor or record".into());
    }
    let deltas: serde_json::Value =
        serde_json::from_str(&history.changes_json).map_err(|e| e.to_string())?;
    if !deltas.as_array().is_some_and(|rows| {
        rows.iter().any(|row| {
            row["field"] == "name"
                && row["before"] == original_name
                && row["after"] == "Native source history product"
        })
    }) {
        return Err("native product update did not preserve the actual name comparison".into());
    }
    let commit = ctx
        .db
        .organization_commit()
        .organization_commit_by_organization()
        .filter(&org)
        .find(|row| row.correlation_id == format!("organization-business-change:{}", history.id))
        .ok_or("organization-wide history durable commit missing")?;
    let exact = ctx
        .db
        .organization_row_change()
        .organization_row_change_by_organization()
        .filter(&org)
        .filter(|row| row.commit_sequence == commit.sequence)
        .collect::<Vec<_>>();
    if exact.len() != 2
        || !exact
            .iter()
            .any(|row| row.table_name == "organization_business_change")
        || !exact.iter().any(|row| row.table_name == "audit_log")
    {
        return Err("organization-wide history commit is incomplete".into());
    }

    create_fleet_vehicle(
        ctx,
        org,
        fixture.company_id,
        CreateFleetVehicleParams {
            name: "History company vehicle".into(),
            vehicle_type: "truck".into(),
            license_plate: None,
            driver_name: None,
            driver_id: None,
            service_type_id: None,
            metadata: None,
        },
    )?;
    let vehicle = ctx
        .db
        .fleet_vehicle()
        .fleet_vehicle_by_org()
        .filter(&org)
        .find(|row| row.name == "History company vehicle")
        .ok_or("native history vehicle fixture missing")?;
    let event = ctx
        .db
        .business_change()
        .business_change_by_organization()
        .filter(&org)
        .find(|row| row.resource == "fleet_vehicle" && row.record_id == vehicle.id)
        .ok_or("company-owned native history missing")?;
    if event.company_id != fixture.company_id
        || event.actor_identity != ctx.sender()
        || !event.changes_json.contains("History company vehicle")
    {
        return Err("company-owned native history lost scope or creation values".into());
    }

    let before = ctx
        .db
        .organization_commit()
        .organization_commit_by_organization()
        .filter(&org)
        .map(|row| row.sequence)
        .max()
        .unwrap_or(0);
    upsert_warehouse_geo(
        ctx,
        org,
        fixture.warehouse_id,
        1.0,
        2.0,
        None,
        None,
        None,
        None,
    )?;
    let geo = ctx
        .db
        .warehouse_geo()
        .warehouse_geo_by_warehouse()
        .filter(&fixture.warehouse_id)
        .next()
        .ok_or("Warehouse geo history fixture missing")?;
    assert_one_owner_envelope(
        ctx,
        org,
        before,
        "erp.upsert_warehouse_geo",
        "warehouse_geo",
        geo.id,
        "organization_business_change",
    )?;
    let before = ctx
        .db
        .organization_commit()
        .organization_commit_by_organization()
        .filter(&org)
        .map(|row| row.sequence)
        .max()
        .unwrap_or(0);
    record_fleet_inspection(
        ctx,
        org,
        fixture.company_id,
        RecordFleetInspectionParams {
            vehicle_id: vehicle.id,
            inspector_id: None,
            inspected_at: None,
            outcome: "passed".into(),
            odometer_km: Some(10.0),
            notes: None,
            client_request_id: None,
        },
    )?;
    let inspection = ctx
        .db
        .fleet_inspection()
        .fleet_inspection_by_vehicle()
        .filter(&vehicle.id)
        .next()
        .ok_or("Inspection history fixture missing")?;
    assert_one_owner_envelope(
        ctx,
        org,
        before,
        "erp.record_fleet_inspection",
        "fleet_inspection",
        inspection.id,
        "business_change",
    )?;

    let count = ctx
        .db
        .organization_business_change()
        .organization_business_change_by_organization()
        .filter(&org)
        .count();
    log_audit_event(
        ctx,
        org,
        LogAuditEventParams {
            company_id: None,
            table_name: "product".into(),
            record_id: fixture.product_id,
            action: "UPDATE".into(),
            old_values: Some("{\"name\":\"forged\"}".into()),
            new_values: Some("{\"name\":\"forged again\"}".into()),
            changed_fields: vec!["name".into()],
            session_id: None,
            ip_address: None,
            user_agent: None,
            metadata: Some(
                "{\"native_business_history\":{\"coverage\":\"captured-audit-fields\"}}".into(),
            ),
        },
    )?;
    if ctx
        .db
        .organization_business_change()
        .organization_business_change_by_organization()
        .filter(&org)
        .count()
        != count
    {
        return Err("caller-authored audit minted trusted organization-wide history".into());
    }
    Ok(())
}

fn assert_one_owner_envelope(
    ctx: &ReducerContext,
    org: u64,
    before: u64,
    operation: &str,
    source: &str,
    record: u64,
    private_table: &str,
) -> Result<(), String> {
    let commits = ctx
        .db
        .organization_commit()
        .organization_commit_by_organization()
        .filter(&org)
        .filter(|row| row.sequence > before)
        .collect::<Vec<_>>();
    let [commit] = commits.as_slice() else {
        return Err(
            "history split an authoritative native outcome into multiple organization commits"
                .into(),
        );
    };
    if commit.operation_id != operation {
        return Err("native history replaced the owner operation identity".into());
    }
    let rows = ctx
        .db
        .organization_row_change()
        .organization_row_change_by_organization()
        .filter(&org)
        .filter(|row| row.commit_sequence == commit.sequence)
        .collect::<Vec<_>>();
    if !rows.iter().any(|row| {
        row.table_name == source
            && serde_json::from_str::<serde_json::Value>(&row.row_identity_json)
                .ok()
                .is_some_and(|id| id["id"].as_u64() == Some(record))
    }) || !rows.iter().any(|row| row.table_name == private_table)
        || !rows.iter().any(|row| row.table_name == "audit_log")
    {
        return Err("native owner outcome omitted its source row, audit or private history".into());
    }
    Ok(())
}
