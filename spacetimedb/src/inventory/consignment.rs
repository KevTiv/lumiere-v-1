//! Consignment ownership — vendor-owned quants excluded from company ATP.
use spacetimedb::{reducer, ReducerContext, SpacetimeType};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::inventory_close::assert_inventory_writable;
use crate::inventory::stock::increase_quant_at_location_owned;
use crate::inventory::warehouse::warehouse;
use crate::purchasing::procurement_advanced::{consignment_agreement, ConsignmentAgreement};
use serde_json;

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct ReceiveConsignmentStockParams {
    pub agreement_id: u64,
    pub location_id: Option<u64>,
    pub quantity: f64,
    pub cost: f64,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn activate_consignment_agreement(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    agreement_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "write")?;
    let row = ctx
        .db
        .consignment_agreement()
        .id()
        .find(&agreement_id)
        .ok_or("Consignment agreement not found")?;
    if row.organization_id != organization_id || row.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if row.state == "active" {
        return Ok(());
    }
    if row.state != "draft" && row.state != "active" {
        return Err(format!("Cannot activate agreement in state {}", row.state));
    }
    ctx.db
        .consignment_agreement()
        .id()
        .update(ConsignmentAgreement {
            state: "active".to_string(),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..row
        });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "consignment_agreement",
            record_id: agreement_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "state": "active" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Receive vendor-owned consignment stock (owner_id = partner). Excluded from company ATP.
#[reducer]
pub fn receive_consignment_stock(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: ReceiveConsignmentStockParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_quant", "create")?;
    assert_inventory_writable(ctx, organization_id, company_id)?;
    if params.quantity <= 0.0 {
        return Err("quantity must be positive".to_string());
    }

    let agreement = ctx
        .db
        .consignment_agreement()
        .id()
        .find(&params.agreement_id)
        .ok_or("Consignment agreement not found")?;
    if agreement.organization_id != organization_id || agreement.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if agreement.state != "active" {
        return Err("Consignment agreement must be active to receive stock".to_string());
    }

    let wh = ctx
        .db
        .warehouse()
        .id()
        .find(&agreement.warehouse_id)
        .ok_or("Warehouse not found for consignment agreement")?;
    if wh.company_id != company_id {
        return Err("Warehouse does not belong to this company".to_string());
    }

    let location_id = params.location_id.unwrap_or(wh.lot_stock_id);
    let method = crate::inventory::costing::product_for_costing(ctx, agreement.product_id)
        .map(|p| crate::inventory::costing::normalize_cost_method(&p.cost_method))
        .unwrap_or_else(|_| "standard".to_string());
    increase_quant_at_location_owned(
        ctx,
        organization_id,
        company_id,
        agreement.product_id,
        location_id,
        params.quantity,
        params.cost,
        Some(agreement.partner_id),
        None,
        &method,
    )?;

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "consignment_agreement",
            record_id: agreement.id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "received_qty": params.quantity,
                    "location_id": location_id,
                    "owner_id": agreement.partner_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["stock".to_string()],
            metadata: params.metadata,
        },
    );
    Ok(())
}
