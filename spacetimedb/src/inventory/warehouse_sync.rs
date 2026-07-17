//! Offline / intermittent remote warehouse sync — durable intents + apply.
//!
//! Clients queue ops with idempotency keys, flush when online, and apply once.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::barcode::{record_barcode_scan, RecordBarcodeScanParams};
use crate::inventory::cycle_count::{record_cycle_count_line, RecordCycleCountLineParams};
use crate::inventory::inventory_close::assert_inventory_writable;
use serde_json::{self, Value};

// ── Tables ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
#[spacetimedb::table(
    accessor = warehouse_sync_intent,
    public,
    index(accessor = warehouse_sync_intent_by_org, btree(columns = [organization_id])),
    index(accessor = warehouse_sync_intent_by_company, btree(columns = [company_id])),
    index(accessor = warehouse_sync_intent_by_status, btree(columns = [status])),
    index(accessor = warehouse_sync_intent_by_key, btree(columns = [idempotency_key]))
)]
pub struct WarehouseSyncIntent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub warehouse_id: u64,
    /// barcode_scan | cycle_count_line
    pub op_type: String,
    pub status: String,
    pub idempotency_key: String,
    pub device_id: Option<String>,
    pub payload: String,
    pub last_error: Option<String>,
    pub attempt_count: u32,
    pub applied_at: Option<Timestamp>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateWarehouseSyncIntentParams {
    pub warehouse_id: u64,
    pub op_type: String,
    pub idempotency_key: String,
    pub device_id: Option<String>,
    pub payload: String,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct FailWarehouseSyncIntentParams {
    pub last_error: String,
    pub metadata: Option<String>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn apply_payload(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    op_type: &str,
    payload: &str,
) -> Result<(), String> {
    let v: Value = serde_json::from_str(payload)
        .map_err(|e| format!("Invalid sync payload JSON: {e}"))?;
    match op_type {
        "barcode_scan" => {
            let barcode = v
                .get("barcode")
                .and_then(|x| x.as_str())
                .ok_or("barcode_scan payload requires barcode")?
                .to_string();
            let barcode_type = v
                .get("barcode_type")
                .and_then(|x| x.as_str())
                .unwrap_or("unknown")
                .to_string();
            record_barcode_scan(
                ctx,
                organization_id,
                RecordBarcodeScanParams {
                    barcode,
                    barcode_type,
                    context_type: v
                        .get("context_type")
                        .and_then(|x| x.as_str())
                        .map(|s| s.to_string()),
                    context_id: v.get("context_id").and_then(|x| x.as_u64()),
                    quantity: v.get("quantity").and_then(|x| x.as_f64()),
                    uom_id: v.get("uom_id").and_then(|x| x.as_u64()),
                    session_id: v
                        .get("session_id")
                        .and_then(|x| x.as_str())
                        .map(|s| s.to_string()),
                    device_id: v
                        .get("device_id")
                        .and_then(|x| x.as_str())
                        .map(|s| s.to_string()),
                    metadata: v
                        .get("metadata")
                        .and_then(|x| x.as_str())
                        .map(|s| s.to_string()),
                },
            )
        }
        "cycle_count_line" => {
            let cycle_count_id = v
                .get("cycle_count_id")
                .and_then(|x| x.as_u64())
                .ok_or("cycle_count_line payload requires cycle_count_id")?;
            let product_id = v
                .get("product_id")
                .and_then(|x| x.as_u64())
                .ok_or("cycle_count_line payload requires product_id")?;
            let location_id = v
                .get("location_id")
                .and_then(|x| x.as_u64())
                .ok_or("cycle_count_line payload requires location_id")?;
            let qty_counted = v
                .get("qty_counted")
                .and_then(|x| x.as_f64())
                .ok_or("cycle_count_line payload requires qty_counted")?;
            let uom_id = v
                .get("uom_id")
                .and_then(|x| x.as_u64())
                .ok_or("cycle_count_line payload requires uom_id")?;
            record_cycle_count_line(
                ctx,
                organization_id,
                company_id,
                cycle_count_id,
                RecordCycleCountLineParams {
                    product_id,
                    location_id,
                    lot_id: v.get("lot_id").and_then(|x| x.as_u64()),
                    qty_counted,
                    uom_id,
                    notes: v
                        .get("notes")
                        .and_then(|x| x.as_str())
                        .map(|s| s.to_string()),
                    metadata: v
                        .get("metadata")
                        .and_then(|x| x.as_str())
                        .map(|s| s.to_string()),
                },
            )
        }
        other => Err(format!(
            "Unsupported op_type '{}'; expected barcode_scan|cycle_count_line",
            other
        )),
    }
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_warehouse_sync_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateWarehouseSyncIntentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_picking", "write")?;
    if params.idempotency_key.trim().is_empty() {
        return Err("idempotency_key is required".to_string());
    }
    let op_type = params.op_type.trim().to_string();
    if !matches!(op_type.as_str(), "barcode_scan" | "cycle_count_line") {
        return Err(format!(
            "Invalid op_type '{}'; expected barcode_scan|cycle_count_line",
            op_type
        ));
    }
    if params.payload.trim().is_empty() {
        return Err("payload is required".to_string());
    }

    let existing = ctx
        .db
        .warehouse_sync_intent()
        .warehouse_sync_intent_by_key()
        .filter(&params.idempotency_key)
        .find(|i| i.organization_id == organization_id);
    if existing.is_some() {
        return Ok(());
    }

    let row = ctx.db.warehouse_sync_intent().insert(WarehouseSyncIntent {
        id: 0,
        organization_id,
        company_id,
        warehouse_id: params.warehouse_id,
        op_type,
        status: "pending".to_string(),
        idempotency_key: params.idempotency_key,
        device_id: params.device_id,
        payload: params.payload,
        last_error: None,
        attempt_count: 0,
        applied_at: None,
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
            table_name: "warehouse_sync_intent",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "op_type": row.op_type,
                    "status": row.status,
                    "idempotency_key": row.idempotency_key,
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
pub fn apply_warehouse_sync_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    intent_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_picking", "write")?;
    let intent = ctx
        .db
        .warehouse_sync_intent()
        .id()
        .find(&intent_id)
        .ok_or("Warehouse sync intent not found")?;
    if intent.organization_id != organization_id || intent.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if intent.status == "applied" {
        return Ok(());
    }
    if intent.status == "failed" {
        return Err("Intent previously failed; create a new intent or clear failure".to_string());
    }

    assert_inventory_writable(ctx, organization_id, company_id)?;

    // Domain errors must commit as status=failed (returning Err would roll back).
    let apply_result = apply_payload(
        ctx,
        organization_id,
        company_id,
        &intent.op_type,
        &intent.payload,
    );
    match apply_result {
        Ok(()) => {
            ctx.db
                .warehouse_sync_intent()
                .id()
                .update(WarehouseSyncIntent {
                    status: "applied".to_string(),
                    last_error: None,
                    attempt_count: intent.attempt_count.saturating_add(1),
                    applied_at: Some(ctx.timestamp),
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..intent
                });
            write_audit_log_v2(
                ctx,
                organization_id,
                AuditLogParams {
                    company_id: Some(company_id),
                    table_name: "warehouse_sync_intent",
                    record_id: intent_id,
                    action: "UPDATE",
                    old_values: None,
                    new_values: Some(serde_json::json!({ "status": "applied" }).to_string()),
                    changed_fields: vec!["status".to_string()],
                    metadata: None,
                },
            );
            Ok(())
        }
        Err(e) => {
            ctx.db
                .warehouse_sync_intent()
                .id()
                .update(WarehouseSyncIntent {
                    status: "failed".to_string(),
                    last_error: Some(e.clone()),
                    attempt_count: intent.attempt_count.saturating_add(1),
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..intent
                });
            write_audit_log_v2(
                ctx,
                organization_id,
                AuditLogParams {
                    company_id: Some(company_id),
                    table_name: "warehouse_sync_intent",
                    record_id: intent_id,
                    action: "UPDATE",
                    old_values: None,
                    new_values: Some(
                        serde_json::json!({ "status": "failed", "last_error": e }).to_string(),
                    ),
                    changed_fields: vec!["status".to_string(), "last_error".to_string()],
                    metadata: None,
                },
            );
            Ok(())
        }
    }
}

#[reducer]
pub fn fail_warehouse_sync_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    intent_id: u64,
    params: FailWarehouseSyncIntentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_picking", "write")?;
    let intent = ctx
        .db
        .warehouse_sync_intent()
        .id()
        .find(&intent_id)
        .ok_or("Warehouse sync intent not found")?;
    if intent.organization_id != organization_id || intent.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if intent.status == "applied" {
        return Err("Cannot fail an already applied intent".to_string());
    }

    ctx.db
        .warehouse_sync_intent()
        .id()
        .update(WarehouseSyncIntent {
            status: "failed".to_string(),
            last_error: Some(params.last_error.clone()),
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
            table_name: "warehouse_sync_intent",
            record_id: intent_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "status": "failed",
                    "last_error": params.last_error,
                })
                .to_string(),
            ),
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}
