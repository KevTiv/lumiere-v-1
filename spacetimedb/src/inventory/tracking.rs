/// Lot & Serial Tracking — Tables and Reducers
///
/// Tables:
///   - StockProductionLot
///   - StockProductionSerial
///   - SerialLotTraceability
///   - StockTraceabilityReport
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.15: STOCK PRODUCTION LOT
// ══════════════════════════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: STOCK PRODUCTION LOT
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_stock_production_lot(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    product_id: u64,
    company_id: u64,
    product_variant_id: Option<u64>,
    ref_: Option<String>,
    note: Option<String>,
    expiration_date: Option<Timestamp>,
    use_date: Option<Timestamp>,
    removal_date: Option<Timestamp>,
    alert_date: Option<Timestamp>,
    location_id: Option<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_production_lot", "create")?;

    if name.is_empty() {
        return Err("Lot name cannot be empty".to_string());
    }

    let lot = ctx.db.stock_production_lot().insert(StockProductionLot {
        id: 0,
        organization_id,
        name: name.clone(),
        ref_,
        product_id,
        product_variant_id,
        company_id,
        note,
        expiration_date,
        use_date,
        removal_date,
        alert_date,
        product_qty: 0.0,
        location_id,
        package_id: None,
        owner_id: None,
        is_scrap: false,
        is_locked: false,
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
        metadata: None,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "stock_production_lot",
        lot.id,
        "create",
        None,
        Some(format!(
            r#"{{"name":"{}","product_id":{}}}"#,
            name, product_id
        )),
        vec!["name".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_stock_production_lot(
    ctx: &ReducerContext,
    lot_id: u64,
    name: Option<String>,
    note: Option<String>,
    expiration_date: Option<Timestamp>,
    use_date: Option<Timestamp>,
    removal_date: Option<Timestamp>,
    alert_date: Option<Timestamp>,
    product_qty: Option<f64>,
    location_id: Option<u64>,
    is_locked: Option<bool>,
) -> Result<(), String> {
    let lot = ctx
        .db
        .stock_production_lot()
        .id()
        .find(&lot_id)
        .ok_or("Lot not found")?;

    check_permission(ctx, lot.organization_id, "stock_production_lot", "write")?;

    ctx.db
        .stock_production_lot()
        .id()
        .update(StockProductionLot {
            name: name.unwrap_or_else(|| lot.name.clone()),
            note: note.or(lot.note),
            expiration_date: expiration_date.or(lot.expiration_date),
            use_date: use_date.or(lot.use_date),
            removal_date: removal_date.or(lot.removal_date),
            alert_date: alert_date.or(lot.alert_date),
            product_qty: product_qty.unwrap_or(lot.product_qty),
            location_id: location_id.or(lot.location_id),
            is_locked: is_locked.unwrap_or(lot.is_locked),
            write_date: ctx.timestamp,
            ..lot
        });

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_stock_production_lot(ctx: &ReducerContext, lot_id: u64) -> Result<(), String> {
    let lot = ctx
        .db
        .stock_production_lot()
        .id()
        .find(&lot_id)
        .ok_or("Lot not found")?;

    check_permission(ctx, lot.organization_id, "stock_production_lot", "delete")?;

    let lot_name = lot.name.clone();
    ctx.db.stock_production_lot().id().delete(&lot_id);

    write_audit_log(
        ctx,
        lot.organization_id,
        Some(lot.company_id),
        "stock_production_lot",
        lot_id,
        "delete",
        Some(format!(r#"{{"name":"{}"}}"#, lot_name)),
        None,
        vec!["deleted".to_string()],
    );

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: STOCK PRODUCTION SERIAL
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_stock_production_serial(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    product_id: u64,
    company_id: u64,
    product_variant_id: Option<u64>,
    lot_id: Option<u64>,
    ref_: Option<String>,
    note: Option<String>,
    expiration_date: Option<Timestamp>,
    use_date: Option<Timestamp>,
    removal_date: Option<Timestamp>,
    alert_date: Option<Timestamp>,
    location_id: Option<u64>,
    warranty_expiration: Option<Timestamp>,
    warranty_start: Option<Timestamp>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_production_serial", "create")?;

    if name.is_empty() {
        return Err("Serial name cannot be empty".to_string());
    }

    let serial = ctx
        .db
        .stock_production_serial()
        .insert(StockProductionSerial {
            id: 0,
            organization_id,
            name: name.clone(),
            ref_,
            product_id,
            product_variant_id,
            lot_id,
            company_id,
            note,
            expiration_date,
            use_date,
            removal_date,
            alert_date,
            product_qty: 1.0,
            location_id,
            package_id: None,
            owner_id: None,
            state: "free".to_string(),
            is_scrap: false,
            is_locked: false,
            warranty_expiration,
            warranty_start,
            last_maintenance: None,
            next_maintenance: None,
            maintenance_count: 0,
            create_date: ctx.timestamp,
            write_date: ctx.timestamp,
            metadata: None,
        });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "stock_production_serial",
        serial.id,
        "create",
        None,
        Some(format!(
            r#"{{"name":"{}","product_id":{}}}"#,
            name, product_id
        )),
        vec!["name".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_stock_production_serial(
    ctx: &ReducerContext,
    serial_id: u64,
    name: Option<String>,
    note: Option<String>,
    state: Option<String>,
    expiration_date: Option<Timestamp>,
    use_date: Option<Timestamp>,
    removal_date: Option<Timestamp>,
    alert_date: Option<Timestamp>,
    location_id: Option<u64>,
    is_locked: Option<bool>,
    warranty_expiration: Option<Timestamp>,
    warranty_start: Option<Timestamp>,
    last_maintenance: Option<Timestamp>,
    next_maintenance: Option<Timestamp>,
) -> Result<(), String> {
    let serial = ctx
        .db
        .stock_production_serial()
        .id()
        .find(&serial_id)
        .ok_or("Serial not found")?;

    check_permission(
        ctx,
        serial.organization_id,
        "stock_production_serial",
        "write",
    )?;

    let new_maintenance_count = if last_maintenance.is_some() {
        serial.maintenance_count + 1
    } else {
        serial.maintenance_count
    };

    ctx.db
        .stock_production_serial()
        .id()
        .update(StockProductionSerial {
            name: name.unwrap_or_else(|| serial.name.clone()),
            note: note.or(serial.note),
            state: state.unwrap_or_else(|| serial.state.clone()),
            expiration_date: expiration_date.or(serial.expiration_date),
            use_date: use_date.or(serial.use_date),
            removal_date: removal_date.or(serial.removal_date),
            alert_date: alert_date.or(serial.alert_date),
            location_id: location_id.or(serial.location_id),
            is_locked: is_locked.unwrap_or(serial.is_locked),
            warranty_expiration: warranty_expiration.or(serial.warranty_expiration),
            warranty_start: warranty_start.or(serial.warranty_start),
            last_maintenance: last_maintenance.or(serial.last_maintenance),
            next_maintenance: next_maintenance.or(serial.next_maintenance),
            maintenance_count: new_maintenance_count,
            write_date: ctx.timestamp,
            ..serial
        });

    Ok(())
}

#[spacetimedb::reducer]
pub fn reserve_serial(ctx: &ReducerContext, serial_id: u64) -> Result<(), String> {
    let serial = ctx
        .db
        .stock_production_serial()
        .id()
        .find(&serial_id)
        .ok_or("Serial not found")?;

    check_permission(
        ctx,
        serial.organization_id,
        "stock_production_serial",
        "write",
    )?;

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

    Ok(())
}

#[spacetimedb::reducer]
pub fn use_serial(ctx: &ReducerContext, serial_id: u64) -> Result<(), String> {
    let serial = ctx
        .db
        .stock_production_serial()
        .id()
        .find(&serial_id)
        .ok_or("Serial not found")?;

    check_permission(
        ctx,
        serial.organization_id,
        "stock_production_serial",
        "write",
    )?;

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

    Ok(())
}

#[spacetimedb::reducer]
pub fn block_serial(
    ctx: &ReducerContext,
    serial_id: u64,
    reason: Option<String>,
) -> Result<(), String> {
    let serial = ctx
        .db
        .stock_production_serial()
        .id()
        .find(&serial_id)
        .ok_or("Serial not found")?;

    check_permission(
        ctx,
        serial.organization_id,
        "stock_production_serial",
        "write",
    )?;

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

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_stock_production_serial(ctx: &ReducerContext, serial_id: u64) -> Result<(), String> {
    let serial = ctx
        .db
        .stock_production_serial()
        .id()
        .find(&serial_id)
        .ok_or("Serial not found")?;

    check_permission(
        ctx,
        serial.organization_id,
        "stock_production_serial",
        "delete",
    )?;

    let serial_name = serial.name.clone();
    ctx.db.stock_production_serial().id().delete(&serial_id);

    write_audit_log(
        ctx,
        serial.organization_id,
        Some(serial.company_id),
        "stock_production_serial",
        serial_id,
        "delete",
        Some(format!(r#"{{"name":"{}"}}"#, serial_name)),
        None,
        vec!["deleted".to_string()],
    );

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: SERIAL/LOT TRACEABILITY
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_traceability_record(
    ctx: &ReducerContext,
    organization_id: u64,
    product_id: u64,
    document_type: String,
    document_id: u64,
    quantity: f64,
    uom_id: u64,
    serial_id: Option<u64>,
    lot_id: Option<u64>,
    document_line_id: Option<u64>,
    move_id: Option<u64>,
    partner_id: Option<u64>,
    origin: Option<String>,
    notes: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "serial_lot_traceability", "create")?;

    if document_type.is_empty() {
        return Err("Document type cannot be empty".to_string());
    }

    let doc_type = document_type.clone();
    let trace = ctx
        .db
        .serial_lot_traceability()
        .insert(SerialLotTraceability {
            id: 0,
            organization_id,
            serial_id,
            lot_id,
            product_id,
            document_type,
            document_id,
            document_line_id,
            move_id,
            quantity,
            uom_id,
            date: ctx.timestamp,
            partner_id,
            origin,
            notes,
            created_at: ctx.timestamp,
            metadata: None,
        });

    write_audit_log(
        ctx,
        organization_id,
        None,
        "serial_lot_traceability",
        trace.id,
        "create",
        None,
        Some(format!(
            r#"{{"product_id":{},"document_type":"{}","document_id":{}}}"#,
            product_id, doc_type, document_id
        )),
        vec!["product_id".to_string(), "document_type".to_string()],
    );

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: STOCK TRACEABILITY REPORT
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_traceability_report(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    date_from: Timestamp,
    date_to: Timestamp,
    product_ids: Vec<u64>,
    lot_ids: Vec<u64>,
    serial_ids: Vec<u64>,
    location_ids: Vec<u64>,
    warehouse_ids: Vec<u64>,
    partner_ids: Vec<u64>,
    picking_type_ids: Vec<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_traceability_report", "create")?;

    if name.is_empty() {
        return Err("Report name cannot be empty".to_string());
    }

    let report = ctx
        .db
        .stock_traceability_report()
        .insert(StockTraceabilityReport {
            id: 0,
            organization_id,
            name: name.clone(),
            date_from,
            date_to,
            product_ids,
            lot_ids,
            serial_ids,
            location_ids,
            warehouse_ids,
            partner_ids,
            picking_type_ids,
            state: "draft".to_string(),
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
            metadata: None,
        });

    write_audit_log(
        ctx,
        organization_id,
        None,
        "stock_traceability_report",
        report.id,
        "create",
        None,
        Some(format!(r#"{{"name":"{}"}}"#, name)),
        vec!["name".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn run_traceability_report(ctx: &ReducerContext, report_id: u64) -> Result<(), String> {
    let report = ctx
        .db
        .stock_traceability_report()
        .id()
        .find(&report_id)
        .ok_or("Report not found")?;

    check_permission(
        ctx,
        report.organization_id,
        "stock_traceability_report",
        "write",
    )?;

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

    Ok(())
}
