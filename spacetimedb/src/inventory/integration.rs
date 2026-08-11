//! Inventory 3PL / WMS integration — durable intents + result recording.
//!
//! External ASN/outbound workers call create → (HTTP outside reducer) → record.
//! Successful `asn_inbound` results may post stock when product/location/qty are supplied.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::inventory_close::assert_inventory_writable;
use crate::inventory::stock::increase_quant_at_location;
use serde_json;

// ── Tables ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
#[spacetimedb::table(
    accessor = inventory_integration_intent,
    public,
    index(accessor = inventory_integration_intent_by_org, btree(columns = [organization_id])),
    index(accessor = inventory_integration_intent_by_status, btree(columns = [status])),
    index(accessor = inventory_integration_intent_by_key, btree(columns = [idempotency_key]))
)]
pub struct InventoryIntegrationIntent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub provider: String,
    /// asn_inbound | asn_outbound | stock_sync | adjust
    pub intent_type: String,
    pub warehouse_id: Option<u64>,
    pub picking_id: Option<u64>,
    pub status: String,
    pub idempotency_key: String,
    pub request_payload: Option<String>,
    pub last_error: Option<String>,
    pub external_reference: Option<String>,
    pub attempt_count: u32,
    pub applied: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateInventoryIntegrationIntentParams {
    pub provider: String,
    pub intent_type: String,
    pub warehouse_id: Option<u64>,
    pub picking_id: Option<u64>,
    pub idempotency_key: String,
    pub request_payload: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordInventoryIntegrationResultParams {
    pub status: String,
    pub external_reference: Option<String>,
    pub last_error: Option<String>,
    /// Optional stock post for successful asn_inbound (product stock UoM qty).
    pub product_id: Option<u64>,
    pub location_id: Option<u64>,
    pub quantity: Option<f64>,
    pub cost: Option<f64>,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_inventory_integration_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateInventoryIntegrationIntentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_picking", "write")?;
    if params.idempotency_key.trim().is_empty() {
        return Err("idempotency_key is required".to_string());
    }
    if params.provider.trim().is_empty() {
        return Err("provider is required".to_string());
    }
    let intent_type = params.intent_type.trim().to_string();
    let allowed = ["asn_inbound", "asn_outbound", "stock_sync", "adjust"];
    if !allowed.contains(&intent_type.as_str()) {
        return Err(format!(
            "Invalid intent_type '{}'; expected one of {:?}",
            intent_type, allowed
        ));
    }

    let existing = ctx
        .db
        .inventory_integration_intent()
        .inventory_integration_intent_by_key()
        .filter(&params.idempotency_key)
        .find(|i| i.organization_id == organization_id && i.company_id == company_id);
    if existing.is_some() {
        return Ok(());
    }

    let row = ctx
        .db
        .inventory_integration_intent()
        .insert(InventoryIntegrationIntent {
            id: 0,
            organization_id,
            company_id,
            provider: params.provider,
            intent_type,
            warehouse_id: params.warehouse_id,
            picking_id: params.picking_id,
            status: "pending".to_string(),
            idempotency_key: params.idempotency_key,
            request_payload: params.request_payload,
            last_error: None,
            external_reference: None,
            attempt_count: 0,
            applied: false,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: params.metadata,
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "inventory_integration_intent",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "provider": row.provider,
                    "intent_type": row.intent_type,
                    "status": row.status,
                })
                .to_string(),
            ),
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn record_inventory_integration_result(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    intent_id: u64,
    params: RecordInventoryIntegrationResultParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_picking", "write")?;
    let intent = ctx
        .db
        .inventory_integration_intent()
        .id()
        .find(&intent_id)
        .ok_or("Integration intent not found")?;
    if intent.organization_id != organization_id || intent.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    let status = params.status.trim().to_string();
    let allowed = ["pending", "succeeded", "failed", "cancelled"];
    if !allowed.contains(&status.as_str()) {
        return Err(format!(
            "Invalid status '{}'; expected one of {:?}",
            status, allowed
        ));
    }

    if status == "failed" && intent.applied {
        return Err("Cannot mark as failed: integration has already been applied".to_string());
    }

    if status == "succeeded"
        && intent.intent_type == "asn_inbound"
        && params.product_id.is_some()
        && params.location_id.is_some()
        && params.quantity.unwrap_or(0.0) > 0.0
    {
        if intent.applied {
            return Ok(());
        }
        assert_inventory_writable(ctx, organization_id, company_id)?;
        let product_id = params.product_id.unwrap();
        let location_id = params.location_id.unwrap();
        let qty = params.quantity.unwrap();
        let cost = params.cost.unwrap_or(0.0);
        increase_quant_at_location(
            ctx,
            organization_id,
            company_id,
            product_id,
            location_id,
            qty,
            cost,
        )?;
        ctx.db
            .inventory_integration_intent()
            .id()
            .update(InventoryIntegrationIntent {
                applied: true,
                ..intent.clone()
            });
    }

    ctx.db
        .inventory_integration_intent()
        .id()
        .update(InventoryIntegrationIntent {
            status: status.clone(),
            external_reference: params.external_reference.clone(),
            last_error: params.last_error.clone(),
            attempt_count: intent.attempt_count.saturating_add(1),
            metadata: params.metadata.or(intent.metadata.clone()),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..intent
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "inventory_integration_intent",
            record_id: intent_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "status": status }).to_string()),
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}
