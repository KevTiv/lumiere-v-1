/// Cycle Counting — Tables and Reducers
///
/// Tables:
///   - StockCycleCount
///   - StockCountSheet
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};
use serde_json;

/// Stock Cycle Count
#[spacetimedb::table(
    accessor = stock_cycle_count,
    public,
    index(accessor = cycle_count_by_org, btree(columns = [organization_id])),
    index(accessor = cycle_count_by_state, btree(columns = [state])),
    index(accessor = cycle_count_by_location, btree(columns = [location_id]))
)]
pub struct StockCycleCount {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub state: String,
    pub location_id: u64,
    pub product_ids: Vec<u64>,
    pub product_category_ids: Vec<u64>,
    pub count_by: String,
    pub frequency: String,
    pub last_count_date: Option<Timestamp>,
    pub next_count_date: Option<Timestamp>,
    pub tolerance_percentage: f64,
    pub tolerance_value: f64,
    pub user_id: Option<Identity>,
    pub team_id: Option<u64>,
    pub company_id: u64,
    pub inventory_id: Option<u64>,
    pub line_ids: Vec<u64>,
    pub reason: Option<String>,
    pub notes: Option<String>,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: Option<String>,
}

/// Stock Count Sheet
#[spacetimedb::table(
    accessor = stock_count_sheet,
    public,
    index(accessor = count_sheet_by_org, btree(columns = [organization_id])),
    index(accessor = count_sheet_by_cycle, btree(columns = [cycle_count_id])),
    index(accessor = count_sheet_by_product, btree(columns = [product_id]))
)]
pub struct StockCountSheet {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub cycle_count_id: u64,
    pub product_id: u64,
    pub location_id: u64,
    pub lot_id: Option<u64>,
    pub expected_qty: f64,
    pub counted_qty: f64,
    pub uom_id: u64,
    pub variance: f64,
    pub variance_value: f64,
    pub counted_by: Option<Identity>,
    pub counted_at: Option<Timestamp>,
    pub notes: Option<String>,
    pub is_processed: bool,
    pub processed_at: Option<Timestamp>,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

/// Create a new stock cycle count
pub fn create_stock_cycle_count(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    location_id: u64,
    product_ids: Vec<u64>,
    product_category_ids: Vec<u64>,
    count_by: String,
    frequency: String,
    tolerance_percentage: f64,
    tolerance_value: f64,
    user_id: Option<Identity>,
    team_id: Option<u64>,
    company_id: u64,
    state: String,
    inventory_id: Option<u64>,
    line_ids: Vec<u64>,
    last_count_date: Option<Timestamp>,
    next_count_date: Option<Timestamp>,
    reason: Option<String>,
    notes: Option<String>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_cycle_count", "create")?;

    if name.is_empty() {
        return Err("Cycle count name cannot be empty".to_string());
    }

    let name_clone = name.clone();
    let product_ids_clone = product_ids.clone();
    let product_category_ids_clone = product_category_ids.clone();
    let count_by_clone = count_by.clone();
    let frequency_clone = frequency.clone();

    let cycle_count = ctx.db.stock_cycle_count().insert(StockCycleCount {
        id: 0,
        organization_id,
        name: name.clone(),
        state,
        location_id,
        product_ids: product_ids_clone.clone(),
        product_category_ids: product_category_ids_clone.clone(),
        count_by: count_by_clone.clone(),
        frequency: frequency_clone.clone(),
        last_count_date,
        next_count_date,
        tolerance_percentage,
        tolerance_value,
        user_id,
        team_id,
        company_id,
        inventory_id,
        line_ids,
        reason,
        notes,
        metadata,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });

    write_audit_log(
        ctx,
        organization_id,
        None,
        "stock_cycle_count",
        cycle_count.id,
        "create",
        None,
        Some(
            serde_json::json!({
                "name": name_clone,
                "location_id": location_id,
                "product_count": product_ids_clone.len(),
                "category_count": product_category_ids_clone.len(),
                "count_by": count_by_clone,
                "frequency": frequency_clone,
                "tolerance_percentage": tolerance_percentage,
                "tolerance_value": tolerance_value
            })
            .to_string(),
        ),
        vec![
            "name".to_string(),
            "location_id".to_string(),
            "product_ids".to_string(),
            "product_category_ids".to_string(),
            "count_by".to_string(),
            "frequency".to_string(),
            "tolerance_percentage".to_string(),
            "tolerance_value".to_string(),
            "state".to_string(),
        ],
    );

    Ok(())
}

/// Create a new stock count sheet
pub fn create_stock_count_sheet(
    ctx: &ReducerContext,
    organization_id: u64,
    cycle_count_id: u64,
    product_id: u64,
    location_id: u64,
    lot_id: Option<u64>,
    expected_qty: f64,
    counted_qty: f64,
    uom_id: u64,
    variance: f64,
    variance_value: f64,
    counted_by: Option<Identity>,
    counted_at: Option<Timestamp>,
    notes: Option<String>,
    is_processed: bool,
    processed_at: Option<Timestamp>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_count_sheet", "create")?;

    let _cycle_count = ctx
        .db
        .stock_cycle_count()
        .id()
        .find(&cycle_count_id)
        .ok_or("Cycle count not found")?;

    let sheet = ctx.db.stock_count_sheet().insert(StockCountSheet {
        id: 0,
        organization_id,
        cycle_count_id,
        product_id,
        location_id,
        lot_id,
        expected_qty,
        counted_qty,
        uom_id,
        variance,
        variance_value,
        counted_by,
        counted_at,
        notes,
        is_processed,
        processed_at,
        created_at: ctx.timestamp,
        metadata,
    });

    write_audit_log(
        ctx,
        organization_id,
        None,
        "stock_count_sheet",
        sheet.id,
        "create",
        None,
        Some(
            serde_json::json!({
                "cycle_count_id": cycle_count_id,
                "product_id": product_id,
                "lot_id": lot_id,
                "expected_qty": expected_qty,
                "counted_qty": counted_qty,
                "uom_id": uom_id,
                "variance": variance,
                "variance_value": variance_value,
                "is_processed": is_processed
            })
            .to_string(),
        ),
        vec![
            "cycle_count_id".to_string(),
            "product_id".to_string(),
            "lot_id".to_string(),
            "expected_qty".to_string(),
            "counted_qty".to_string(),
            "uom_id".to_string(),
            "variance".to_string(),
            "variance_value".to_string(),
            "is_processed".to_string(),
        ],
    );

    Ok(())
}

/// Update stock count sheet with counted quantity
pub fn update_stock_count_sheet(
    ctx: &ReducerContext,
    organization_id: u64,
    sheet_id: u64,
    counted_qty: f64,
    counted_by: Option<Identity>,
    notes: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_count_sheet", "update")?;

    if let Some(mut sheet) = ctx.db.stock_count_sheet().id().find(&sheet_id) {
        let old_counted_qty = sheet.counted_qty;
        let old_variance = sheet.variance;
        let old_variance_value = sheet.variance_value;

        let variance = counted_qty - sheet.expected_qty;
        sheet.counted_qty = counted_qty;
        sheet.variance = variance;
        sheet.variance_value = variance * 1.0; // Placeholder for unit cost
        sheet.counted_by = counted_by;
        sheet.counted_at = Some(ctx.timestamp);
        if let Some(notes) = notes {
            sheet.notes = Some(notes.clone());
        }
        ctx.db.stock_count_sheet().id().update(sheet);

        write_audit_log(
            ctx,
            organization_id,
            None,
            "stock_count_sheet",
            sheet_id,
            "update",
            Some(
                serde_json::json!({
                    "counted_qty": old_counted_qty,
                    "variance": old_variance,
                    "variance_value": old_variance_value
                })
                .to_string(),
            ),
            Some(
                serde_json::json!({
                    "counted_qty": counted_qty,
                    "variance": variance,
                    "variance_value": variance * 1.0
                })
                .to_string(),
            ),
            vec![
                "counted_qty".to_string(),
                "variance".to_string(),
                "notes".to_string(),
            ],
        );
    } else {
        return Err("Stock count sheet not found".to_string());
    }

    Ok(())
}

/// Process stock count sheet
pub fn process_stock_count_sheet(
    ctx: &ReducerContext,
    organization_id: u64,
    sheet_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_count_sheet", "update")?;

    if let Some(mut sheet) = ctx.db.stock_count_sheet().id().find(&sheet_id) {
        if sheet.is_processed {
            return Err("Sheet is already processed".to_string());
        }

        if sheet.counted_qty == 0.0 {
            return Err("Cannot process sheet without counted quantity".to_string());
        }

        sheet.is_processed = true;
        sheet.processed_at = Some(ctx.timestamp);
        ctx.db.stock_count_sheet().id().update(sheet);

        write_audit_log(
            ctx,
            organization_id,
            None,
            "stock_count_sheet",
            sheet_id,
            "update",
            Some(serde_json::json!({ "is_processed": false }).to_string()),
            Some(serde_json::json!({ "is_processed": true }).to_string()),
            vec!["is_processed".to_string()],
        );
    } else {
        return Err("Stock count sheet not found".to_string());
    }

    Ok(())
}
