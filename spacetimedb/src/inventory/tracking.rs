/// Lot & Serial Tracking — Tables and Reducers
///
/// Tables:
///   - StockProductionLot
///   - StockProductionSerial
///   - SerialLotTraceability
///   - StockTraceabilityReport
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use serde_json;

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.15: STOCK PRODUCTION LOT
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Clone)]
#[spacetimedb::table(
    accessor = stock_production_lot,
    public,
    index(accessor = lot_by_org, btree(columns = [organization_id])),
    index(accessor = lot_by_product, btree(columns = [product_id])),
    index(accessor = lot_by_name, btree(columns = [name])),
    index(accessor = lot_by_company, btree(columns = [company_id]))
)]
pub struct StockProductionLot {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub ref_: Option<String>,
    pub product_id: u64,
    pub product_variant_id: Option<u64>,
    pub company_id: u64,
    pub note: Option<String>,
    pub expiration_date: Option<Timestamp>,
    pub use_date: Option<Timestamp>,
    pub removal_date: Option<Timestamp>,
    pub alert_date: Option<Timestamp>,
    pub product_qty: f64,
    pub location_id: Option<u64>,
    pub package_id: Option<u64>,
    pub owner_id: Option<u64>,
    pub is_scrap: bool,
    pub is_locked: bool,
    pub create_date: Timestamp,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.16: STOCK PRODUCTION SERIAL
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Clone)]
#[spacetimedb::table(
    accessor = stock_production_serial,
    public,
    index(accessor = serial_by_org, btree(columns = [organization_id])),
    index(accessor = serial_by_product, btree(columns = [product_id])),
    index(accessor = serial_by_name, btree(columns = [name])),
    index(accessor = serial_by_company, btree(columns = [company_id])),
    index(accessor = serial_by_lot, btree(columns = [lot_id]))
)]
pub struct StockProductionSerial {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub ref_: Option<String>,
    pub product_id: u64,
    pub product_variant_id: Option<u64>,
    pub lot_id: Option<u64>,
    pub company_id: u64,
    pub note: Option<String>,
    pub expiration_date: Option<Timestamp>,
    pub use_date: Option<Timestamp>,
    pub removal_date: Option<Timestamp>,
    pub alert_date: Option<Timestamp>,
    pub product_qty: f64,
    pub location_id: Option<u64>,
    pub package_id: Option<u64>,
    pub owner_id: Option<u64>,
    pub state: String,
    pub is_scrap: bool,
    pub is_locked: bool,
    pub warranty_expiration: Option<Timestamp>,
    pub warranty_start: Option<Timestamp>,
    pub last_maintenance: Option<Timestamp>,
    pub next_maintenance: Option<Timestamp>,
    pub maintenance_count: i32,
    pub create_date: Timestamp,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.17: SERIAL/LOT TRACEABILITY
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Clone)]
#[spacetimedb::table(
    accessor = serial_lot_traceability,
    public,
    index(accessor = trace_by_org, btree(columns = [organization_id])),
    index(accessor = trace_by_serial, btree(columns = [serial_id])),
    index(accessor = trace_by_lot, btree(columns = [lot_id])),
    index(accessor = trace_by_product, btree(columns = [product_id])),
    index(accessor = trace_by_document, btree(columns = [document_type, document_id]))
)]
pub struct SerialLotTraceability {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub serial_id: Option<u64>,
    pub lot_id: Option<u64>,
    pub product_id: u64,
    pub document_type: String,
    pub document_id: u64,
    pub document_line_id: Option<u64>,
    pub move_id: Option<u64>,
    pub quantity: f64,
    pub uom_id: u64,
    pub date: Timestamp,
    pub partner_id: Option<u64>,
    pub origin: Option<String>,
    pub notes: Option<String>,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.18: STOCK TRACEABILITY REPORT
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Clone)]
#[spacetimedb::table(
    accessor = stock_traceability_report,
    public,
    index(accessor = report_by_org, btree(columns = [organization_id])),
    index(accessor = report_by_state, btree(columns = [state]))
)]
pub struct StockTraceabilityReport {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub date_from: Timestamp,
    pub date_to: Timestamp,
    pub product_ids: Vec<u64>,
    pub lot_ids: Vec<u64>,
    pub serial_ids: Vec<u64>,
    pub location_ids: Vec<u64>,
    pub warehouse_ids: Vec<u64>,
    pub partner_ids: Vec<u64>,
    pub picking_type_ids: Vec<u64>,
    pub state: String,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateStockProductionLotParams {
    pub name: String,
    pub product_id: u64,
    pub product_variant_id: Option<u64>,
    pub ref_: Option<String>,
    pub note: Option<String>,
    pub expiration_date: Option<Timestamp>,
    pub use_date: Option<Timestamp>,
    pub removal_date: Option<Timestamp>,
    pub alert_date: Option<Timestamp>,
    pub product_qty: f64,
    pub location_id: Option<u64>,
    pub package_id: Option<u64>,
    pub owner_id: Option<u64>,
    pub is_scrap: bool,
    pub is_locked: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateStockProductionLotParams {
    pub name: Option<String>,
    pub ref_: Option<String>,
    pub note: Option<String>,
    pub expiration_date: Option<Timestamp>,
    pub use_date: Option<Timestamp>,
    pub removal_date: Option<Timestamp>,
    pub alert_date: Option<Timestamp>,
    pub product_qty: Option<f64>,
    pub location_id: Option<u64>,
    pub is_locked: Option<bool>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateStockProductionSerialParams {
    pub name: String,
    pub product_id: u64,
    pub product_variant_id: Option<u64>,
    pub lot_id: Option<u64>,
    pub ref_: Option<String>,
    pub note: Option<String>,
    pub expiration_date: Option<Timestamp>,
    pub use_date: Option<Timestamp>,
    pub removal_date: Option<Timestamp>,
    pub alert_date: Option<Timestamp>,
    pub product_qty: f64,
    pub location_id: Option<u64>,
    pub package_id: Option<u64>,
    pub owner_id: Option<u64>,
    pub state: String,
    pub is_scrap: bool,
    pub is_locked: bool,
    pub warranty_expiration: Option<Timestamp>,
    pub warranty_start: Option<Timestamp>,
    pub last_maintenance: Option<Timestamp>,
    pub next_maintenance: Option<Timestamp>,
    pub maintenance_count: i32,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateStockProductionSerialParams {
    pub name: Option<String>,
    pub ref_: Option<String>,
    pub note: Option<String>,
    pub state: Option<String>,
    pub expiration_date: Option<Timestamp>,
    pub use_date: Option<Timestamp>,
    pub removal_date: Option<Timestamp>,
    pub alert_date: Option<Timestamp>,
    pub location_id: Option<u64>,
    pub is_locked: Option<bool>,
    pub warranty_expiration: Option<Timestamp>,
    pub warranty_start: Option<Timestamp>,
    pub last_maintenance: Option<Timestamp>,
    pub next_maintenance: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateTraceabilityRecordParams {
    pub product_id: u64,
    pub document_type: String,
    pub document_id: u64,
    pub quantity: f64,
    pub uom_id: u64,
    pub date: Timestamp,
    pub serial_id: Option<u64>,
    pub lot_id: Option<u64>,
    pub document_line_id: Option<u64>,
    pub move_id: Option<u64>,
    pub partner_id: Option<u64>,
    pub origin: Option<String>,
    pub notes: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateStockTraceabilityReportParams {
    pub name: String,
    pub date_from: Timestamp,
    pub date_to: Timestamp,
    pub product_ids: Vec<u64>,
    pub lot_ids: Vec<u64>,
    pub serial_ids: Vec<u64>,
    pub location_ids: Vec<u64>,
    pub warehouse_ids: Vec<u64>,
    pub partner_ids: Vec<u64>,
    pub picking_type_ids: Vec<u64>,
    pub state: String,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: STOCK PRODUCTION LOT
// ══════════════════════════════════════════════════════════════════════════════

#[reducer]
pub fn create_stock_production_lot(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateStockProductionLotParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_production_lot", "create")?;

    if params.name.is_empty() {
        return Err("Lot name cannot be empty".to_string());
    }

    let lot = ctx.db.stock_production_lot().insert(StockProductionLot {
        id: 0,
        organization_id,
        name: params.name.clone(),
        ref_: params.ref_,
        product_id: params.product_id,
        product_variant_id: params.product_variant_id,
        company_id,
        note: params.note,
        expiration_date: params.expiration_date,
        use_date: params.use_date,
        removal_date: params.removal_date,
        alert_date: params.alert_date,
        product_qty: params.product_qty,
        location_id: params.location_id,
        package_id: params.package_id,
        owner_id: params.owner_id,
        is_scrap: params.is_scrap,
        is_locked: params.is_locked,
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_production_lot",
            record_id: lot.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "name": lot.name, "product_id": lot.product_id }).to_string(),
            ),
            changed_fields: vec!["name".to_string(), "product_id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn update_stock_production_lot(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    lot_id: u64,
    params: UpdateStockProductionLotParams,
) -> Result<(), String> {
    let lot = ctx
        .db
        .stock_production_lot()
        .id()
        .find(&lot_id)
        .ok_or("Lot not found")?;

    check_permission(ctx, organization_id, "stock_production_lot", "write")?;

    if lot.company_id != company_id {
        return Err("Lot does not belong to this company".to_string());
    }

    ctx.db
        .stock_production_lot()
        .id()
        .update(StockProductionLot {
            name: params.name.unwrap_or_else(|| lot.name.clone()),
            ref_: params.ref_.or(lot.ref_),
            note: params.note.or(lot.note),
            expiration_date: params.expiration_date.or(lot.expiration_date),
            use_date: params.use_date.or(lot.use_date),
            removal_date: params.removal_date.or(lot.removal_date),
            alert_date: params.alert_date.or(lot.alert_date),
            product_qty: params.product_qty.unwrap_or(lot.product_qty),
            location_id: params.location_id.or(lot.location_id),
            is_locked: params.is_locked.unwrap_or(lot.is_locked),
            metadata: params.metadata.or(lot.metadata),
            write_date: ctx.timestamp,
            ..lot
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_production_lot",
            record_id: lot_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["updated".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn delete_stock_production_lot(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    lot_id: u64,
) -> Result<(), String> {
    let lot = ctx
        .db
        .stock_production_lot()
        .id()
        .find(&lot_id)
        .ok_or("Lot not found")?;

    check_permission(ctx, organization_id, "stock_production_lot", "delete")?;

    if lot.company_id != company_id {
        return Err("Lot does not belong to this company".to_string());
    }

    ctx.db.stock_production_lot().id().delete(&lot_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_production_lot",
            record_id: lot_id,
            action: "DELETE",
            old_values: Some(serde_json::json!({ "name": lot.name }).to_string()),
            new_values: None,
            changed_fields: vec!["deleted".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: STOCK PRODUCTION SERIAL
// ══════════════════════════════════════════════════════════════════════════════

#[reducer]
pub fn create_stock_production_serial(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateStockProductionSerialParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_production_serial", "create")?;

    if params.name.is_empty() {
        return Err("Serial name cannot be empty".to_string());
    }

    let serial = ctx
        .db
        .stock_production_serial()
        .insert(StockProductionSerial {
            id: 0,
            organization_id,
            name: params.name.clone(),
            ref_: params.ref_,
            product_id: params.product_id,
            product_variant_id: params.product_variant_id,
            lot_id: params.lot_id,
            company_id,
            note: params.note,
            expiration_date: params.expiration_date,
            use_date: params.use_date,
            removal_date: params.removal_date,
            alert_date: params.alert_date,
            product_qty: params.product_qty,
            location_id: params.location_id,
            package_id: params.package_id,
            owner_id: params.owner_id,
            state: params.state,
            is_scrap: params.is_scrap,
            is_locked: params.is_locked,
            warranty_expiration: params.warranty_expiration,
            warranty_start: params.warranty_start,
            last_maintenance: params.last_maintenance,
            next_maintenance: params.next_maintenance,
            maintenance_count: params.maintenance_count,
            create_date: ctx.timestamp,
            write_date: ctx.timestamp,
            metadata: params.metadata,
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_production_serial",
            record_id: serial.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "name": serial.name, "product_id": serial.product_id })
                    .to_string(),
            ),
            changed_fields: vec!["name".to_string(), "product_id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn update_stock_production_serial(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    serial_id: u64,
    params: UpdateStockProductionSerialParams,
) -> Result<(), String> {
    let serial = ctx
        .db
        .stock_production_serial()
        .id()
        .find(&serial_id)
        .ok_or("Serial not found")?;

    check_permission(ctx, organization_id, "stock_production_serial", "write")?;

    if serial.company_id != company_id {
        return Err("Serial does not belong to this company".to_string());
    }

    let new_maintenance_count = if params.last_maintenance.is_some() {
        serial.maintenance_count + 1
    } else {
        serial.maintenance_count
    };

    ctx.db
        .stock_production_serial()
        .id()
        .update(StockProductionSerial {
            name: params.name.unwrap_or_else(|| serial.name.clone()),
            ref_: params.ref_.or(serial.ref_),
            note: params.note.or(serial.note),
            state: params.state.unwrap_or_else(|| serial.state.clone()),
            expiration_date: params.expiration_date.or(serial.expiration_date),
            use_date: params.use_date.or(serial.use_date),
            removal_date: params.removal_date.or(serial.removal_date),
            alert_date: params.alert_date.or(serial.alert_date),
            location_id: params.location_id.or(serial.location_id),
            is_locked: params.is_locked.unwrap_or(serial.is_locked),
            warranty_expiration: params.warranty_expiration.or(serial.warranty_expiration),
            warranty_start: params.warranty_start.or(serial.warranty_start),
            last_maintenance: params.last_maintenance.or(serial.last_maintenance),
            next_maintenance: params.next_maintenance.or(serial.next_maintenance),
            maintenance_count: new_maintenance_count,
            metadata: params.metadata.or(serial.metadata),
            write_date: ctx.timestamp,
            ..serial
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_production_serial",
            record_id: serial_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["updated".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn reserve_serial(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    serial_id: u64,
) -> Result<(), String> {
    let serial = ctx
        .db
        .stock_production_serial()
        .id()
        .find(&serial_id)
        .ok_or("Serial not found")?;

    check_permission(ctx, organization_id, "stock_production_serial", "write")?;

    if serial.company_id != company_id {
        return Err("Serial does not belong to this company".to_string());
    }

    if serial.state != "free" {
        return Err(format!(
            "Serial is not free (current state: {})",
            serial.state
        ));
    }

    ctx.db
        .stock_production_serial()
        .id()
        .update(StockProductionSerial {
            state: "reserved".to_string(),
            write_date: ctx.timestamp,
            ..serial
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_production_serial",
            record_id: serial_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "free" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "reserved" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn use_serial(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    serial_id: u64,
) -> Result<(), String> {
    let serial = ctx
        .db
        .stock_production_serial()
        .id()
        .find(&serial_id)
        .ok_or("Serial not found")?;

    check_permission(ctx, organization_id, "stock_production_serial", "write")?;

    if serial.company_id != company_id {
        return Err("Serial does not belong to this company".to_string());
    }

    if serial.state != "reserved" {
        return Err(format!(
            "Serial must be reserved before use (current state: {})",
            serial.state
        ));
    }

    ctx.db
        .stock_production_serial()
        .id()
        .update(StockProductionSerial {
            state: "in_use".to_string(),
            write_date: ctx.timestamp,
            ..serial
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_production_serial",
            record_id: serial_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "reserved" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "in_use" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn block_serial(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    serial_id: u64,
    reason: Option<String>,
) -> Result<(), String> {
    let serial = ctx
        .db
        .stock_production_serial()
        .id()
        .find(&serial_id)
        .ok_or("Serial not found")?;

    check_permission(ctx, organization_id, "stock_production_serial", "write")?;

    if serial.company_id != company_id {
        return Err("Serial does not belong to this company".to_string());
    }

    let old_state = serial.state.clone();

    ctx.db
        .stock_production_serial()
        .id()
        .update(StockProductionSerial {
            state: "blocked".to_string(),
            is_locked: true,
            note: reason.or(serial.note),
            write_date: ctx.timestamp,
            ..serial
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_production_serial",
            record_id: serial_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": old_state }).to_string()),
            new_values: Some(
                serde_json::json!({ "state": "blocked", "is_locked": true }).to_string(),
            ),
            changed_fields: vec!["state".to_string(), "is_locked".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn delete_stock_production_serial(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    serial_id: u64,
) -> Result<(), String> {
    let serial = ctx
        .db
        .stock_production_serial()
        .id()
        .find(&serial_id)
        .ok_or("Serial not found")?;

    check_permission(ctx, organization_id, "stock_production_serial", "delete")?;

    if serial.company_id != company_id {
        return Err("Serial does not belong to this company".to_string());
    }

    ctx.db.stock_production_serial().id().delete(&serial_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_production_serial",
            record_id: serial_id,
            action: "DELETE",
            old_values: Some(serde_json::json!({ "name": serial.name }).to_string()),
            new_values: None,
            changed_fields: vec!["deleted".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: SERIAL/LOT TRACEABILITY
// ══════════════════════════════════════════════════════════════════════════════

#[reducer]
pub fn create_traceability_record(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateTraceabilityRecordParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "serial_lot_traceability", "create")?;

    if params.document_type.is_empty() {
        return Err("Document type cannot be empty".to_string());
    }

    let trace = ctx
        .db
        .serial_lot_traceability()
        .insert(SerialLotTraceability {
            id: 0,
            organization_id,
            serial_id: params.serial_id,
            lot_id: params.lot_id,
            product_id: params.product_id,
            document_type: params.document_type.clone(),
            document_id: params.document_id,
            document_line_id: params.document_line_id,
            move_id: params.move_id,
            quantity: params.quantity,
            uom_id: params.uom_id,
            date: params.date,
            partner_id: params.partner_id,
            origin: params.origin,
            notes: params.notes,
            created_at: ctx.timestamp,
            metadata: params.metadata,
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "serial_lot_traceability",
            record_id: trace.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "product_id": trace.product_id,
                    "document_type": trace.document_type,
                    "document_id": trace.document_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["product_id".to_string(), "document_type".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: STOCK TRACEABILITY REPORT
// ══════════════════════════════════════════════════════════════════════════════

#[reducer]
pub fn create_traceability_report(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateStockTraceabilityReportParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_traceability_report", "create")?;

    if params.name.is_empty() {
        return Err("Report name cannot be empty".to_string());
    }

    let report = ctx
        .db
        .stock_traceability_report()
        .insert(StockTraceabilityReport {
            id: 0,
            organization_id,
            name: params.name.clone(),
            date_from: params.date_from,
            date_to: params.date_to,
            product_ids: params.product_ids,
            lot_ids: params.lot_ids,
            serial_ids: params.serial_ids,
            location_ids: params.location_ids,
            warehouse_ids: params.warehouse_ids,
            partner_ids: params.partner_ids,
            picking_type_ids: params.picking_type_ids,
            state: params.state,
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
            metadata: params.metadata,
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "stock_traceability_report",
            record_id: report.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": report.name }).to_string()),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn run_traceability_report(
    ctx: &ReducerContext,
    organization_id: u64,
    report_id: u64,
) -> Result<(), String> {
    let report = ctx
        .db
        .stock_traceability_report()
        .id()
        .find(&report_id)
        .ok_or("Report not found")?;

    check_permission(ctx, organization_id, "stock_traceability_report", "write")?;

    if report.state != "draft" {
        return Err("Report must be in draft state to run".to_string());
    }

    ctx.db
        .stock_traceability_report()
        .id()
        .update(StockTraceabilityReport {
            state: "completed".to_string(),
            ..report
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "stock_traceability_report",
            record_id: report_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "draft" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "completed" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
