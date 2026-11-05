//! Persisted native coverage for explicit company and organization-wide history.

use spacetimedb::{ReducerContext, Table};

use crate::core::audit::{log_audit_event, LogAuditEventParams};
use crate::core::business_changes::{business_change, organization_business_change};
use crate::core::persistence::{organization_commit, organization_row_change};
use crate::fleet::fleet::{create_fleet_vehicle, fleet_vehicle, CreateFleetVehicleParams};
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
