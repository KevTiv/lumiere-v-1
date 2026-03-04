/// Cycle Counting — Tables and Reducers
///
/// Tables:
///   - StockCycleCount
///   - StockCountSheet
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};
use crate::inventory::stock::{stock_quant, StockQuant};
use serde_json;

/// Stock Cycle Count Plan / Session
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
    /// draft | in_progress | validated | posted | cancelled
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

/// Stock Count Sheet Line
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

fn find_quant_for_sheet(ctx: &ReducerContext, sheet: &StockCountSheet) -> Option<StockQuant> {
    ctx.db.stock_quant().iter().find(|q| {
        q.organization_id == sheet.organization_id
            && q.product_id == sheet.product_id
            && q.location_id == sheet.location_id
            && q.lot_id == sheet.lot_id
    })
}

fn compute_sheet_variance_value(
    expected_qty: f64,
    counted_qty: f64,
    quant_cost: Option<f64>,
) -> f64 {
    let variance = counted_qty - expected_qty;
    variance * quant_cost.unwrap_or(0.0)
}

/// Phase-3 alias: create cycle count plan
#[spacetimedb::reducer]
pub fn create_cycle_count_plan(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    location_id: u64,
    method: String,
    frequency: String,
    name: Option<String>,
    tolerance_percentage: Option<f64>,
    tolerance_value: Option<f64>,
    user_id: Option<Identity>,
    team_id: Option<u64>,
    product_ids: Vec<u64>,
    product_category_ids: Vec<u64>,
    notes: Option<String>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_cycle_count", "create")?;

    let plan_name = name.unwrap_or_else(|| format!("Cycle Count @ {}", location_id));
    if plan_name.trim().is_empty() {
        return Err("Cycle count plan name cannot be empty".to_string());
    }

    let cycle = ctx.db.stock_cycle_count().insert(StockCycleCount {
        id: 0,
        organization_id,
        name: plan_name.clone(),
        state: "draft".to_string(),
        location_id,
        product_ids: product_ids.clone(),
        product_category_ids: product_category_ids.clone(),
        count_by: method,
        frequency,
        last_count_date: None,
        next_count_date: None,
        tolerance_percentage: tolerance_percentage.unwrap_or(0.0),
        tolerance_value: tolerance_value.unwrap_or(0.0),
        user_id,
        team_id,
        company_id,
        inventory_id: None,
        line_ids: Vec::new(),
        reason: None,
        notes,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "stock_cycle_count",
        cycle.id,
        "create",
        None,
        Some(
            serde_json::json!({
                "state": "draft",
                "location_id": location_id,
                "product_count": product_ids.len(),
                "category_count": product_category_ids.len()
            })
            .to_string(),
        ),
        vec!["state".to_string(), "location_id".to_string()],
    );

    Ok(())
}

/// Phase-3 alias: start cycle count session
#[spacetimedb::reducer]
pub fn start_cycle_count_session(
    ctx: &ReducerContext,
    organization_id: u64,
    cycle_count_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_cycle_count", "write")?;

    let mut cycle = ctx
        .db
        .stock_cycle_count()
        .id()
        .find(&cycle_count_id)
        .ok_or("Cycle count not found")?;

    if cycle.organization_id != organization_id {
        return Err("Cycle count does not belong to this organization".to_string());
    }

    if cycle.state != "draft" && cycle.state != "validated" {
        return Err("Only draft/validated cycle counts can be started".to_string());
    }

    cycle.state = "in_progress".to_string();
    cycle.updated_at = ctx.timestamp;
    ctx.db.stock_cycle_count().id().update(cycle);

    Ok(())
}

/// Phase-3 alias: record cycle count line
#[spacetimedb::reducer]
pub fn record_cycle_count_line(
    ctx: &ReducerContext,
    organization_id: u64,
    cycle_count_id: u64,
    product_id: u64,
    location_id: u64,
    lot_id: Option<u64>,
    qty_counted: f64,
    uom_id: u64,
    notes: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_count_sheet", "create")?;

    let mut cycle = ctx
        .db
        .stock_cycle_count()
        .id()
        .find(&cycle_count_id)
        .ok_or("Cycle count not found")?;

    if cycle.organization_id != organization_id {
        return Err("Cycle count does not belong to this organization".to_string());
    }
    if cycle.state != "in_progress" {
        return Err("Cycle count must be in_progress to record lines".to_string());
    }

    let expected_qty = find_quant_for_sheet(
        ctx,
        &StockCountSheet {
            id: 0,
            organization_id,
            cycle_count_id,
            product_id,
            location_id,
            lot_id,
            expected_qty: 0.0,
            counted_qty: 0.0,
            uom_id,
            variance: 0.0,
            variance_value: 0.0,
            counted_by: None,
            counted_at: None,
            notes: None,
            is_processed: false,
            processed_at: None,
            created_at: ctx.timestamp,
            metadata: None,
        },
    )
    .map(|q| q.quantity)
    .unwrap_or(0.0);

    let quant_cost = ctx
        .db
        .stock_quant()
        .iter()
        .find(|q| {
            q.organization_id == organization_id
                && q.product_id == product_id
                && q.location_id == location_id
                && q.lot_id == lot_id
        })
        .map(|q| q.cost);

    let variance = qty_counted - expected_qty;
    let variance_value = compute_sheet_variance_value(expected_qty, qty_counted, quant_cost);

    let sheet = ctx.db.stock_count_sheet().insert(StockCountSheet {
        id: 0,
        organization_id,
        cycle_count_id,
        product_id,
        location_id,
        lot_id,
        expected_qty,
        counted_qty: qty_counted,
        uom_id,
        variance,
        variance_value,
        counted_by: Some(ctx.sender()),
        counted_at: Some(ctx.timestamp),
        notes,
        is_processed: false,
        processed_at: None,
        created_at: ctx.timestamp,
        metadata: None,
    });

    let mut ids = cycle.line_ids.clone();
    ids.push(sheet.id);
    cycle.line_ids = ids;
    cycle.updated_at = ctx.timestamp;
    ctx.db.stock_cycle_count().id().update(cycle);

    Ok(())
}

/// Compare counted vs expected and mark the session as validated.
/// This does not mutate stock yet.
#[spacetimedb::reducer]
pub fn validate_cycle_count(
    ctx: &ReducerContext,
    organization_id: u64,
    cycle_count_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_cycle_count", "write")?;

    let mut cycle = ctx
        .db
        .stock_cycle_count()
        .id()
        .find(&cycle_count_id)
        .ok_or("Cycle count not found")?;

    if cycle.organization_id != organization_id {
        return Err("Cycle count does not belong to this organization".to_string());
    }

    if cycle.state != "in_progress" {
        return Err("Cycle count must be in_progress to validate".to_string());
    }

    let sheets: Vec<_> = cycle
        .line_ids
        .iter()
        .filter_map(|id| ctx.db.stock_count_sheet().id().find(id))
        .collect();

    if sheets.is_empty() {
        return Err("Cannot validate cycle count without lines".to_string());
    }

    cycle.state = "validated".to_string();
    cycle.updated_at = ctx.timestamp;
    ctx.db.stock_cycle_count().id().update(cycle);

    Ok(())
}

/// Apply stock adjustments from validated count sheets.
/// - marks each sheet processed
/// - upserts quant quantities to counted values
/// - marks cycle as posted
#[spacetimedb::reducer]
pub fn post_cycle_count_adjustments(
    ctx: &ReducerContext,
    organization_id: u64,
    cycle_count_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_cycle_count", "write")?;

    let mut cycle = ctx
        .db
        .stock_cycle_count()
        .id()
        .find(&cycle_count_id)
        .ok_or("Cycle count not found")?;

    if cycle.organization_id != organization_id {
        return Err("Cycle count does not belong to this organization".to_string());
    }

    if cycle.state != "validated" {
        return Err("Cycle count must be validated before posting adjustments".to_string());
    }

    let sheet_ids = cycle.line_ids.clone();
    for sheet_id in sheet_ids {
        let mut sheet = ctx
            .db
            .stock_count_sheet()
            .id()
            .find(&sheet_id)
            .ok_or("Stock count sheet not found")?;

        if sheet.is_processed {
            continue;
        }

        if let Some(quant) = find_quant_for_sheet(ctx, &sheet) {
            let new_qty = sheet.counted_qty;
            let new_available = (new_qty - quant.reserved_quantity).max(0.0);
            let new_value = new_qty * quant.cost;

            ctx.db.stock_quant().id().update(StockQuant {
                quantity: new_qty,
                available_quantity: new_available,
                value: new_value,
                inventory_quantity: new_qty,
                inventory_diff_quantity: 0.0,
                inventory_quantity_set: true,
                inventory_date: Some(ctx.timestamp),
                user_id: Some(ctx.sender()),
                ..quant
            });
        } else {
            let qty = sheet.counted_qty;
            ctx.db.stock_quant().insert(StockQuant {
                id: 0,
                organization_id: sheet.organization_id,
                product_id: sheet.product_id,
                product_variant_id: None,
                location_id: sheet.location_id,
                lot_id: sheet.lot_id,
                package_id: None,
                owner_id: None,
                company_id: cycle.company_id,
                quantity: qty,
                reserved_quantity: 0.0,
                available_quantity: qty,
                in_date: Some(ctx.timestamp),
                inventory_quantity: qty,
                inventory_diff_quantity: 0.0,
                inventory_quantity_set: true,
                is_outdated: false,
                user_id: Some(ctx.sender()),
                inventory_date: Some(ctx.timestamp),
                cost: 0.0,
                value: 0.0,
                cost_method: None,
                accounting_date: None,
                currency_id: None,
                accounting_entry_ids: vec![],
                metadata: Some("{\"source\":\"cycle_count_post\"}".to_string()),
            });
        }

        sheet.is_processed = true;
        sheet.processed_at = Some(ctx.timestamp);
        ctx.db.stock_count_sheet().id().update(sheet);
    }

    cycle.state = "posted".to_string();
    cycle.last_count_date = Some(ctx.timestamp);
    cycle.updated_at = ctx.timestamp;
    let cycle_company_id = cycle.company_id;
    ctx.db.stock_cycle_count().id().update(cycle);

    write_audit_log(
        ctx,
        organization_id,
        Some(cycle_company_id),
        "stock_cycle_count",
        cycle_count_id,
        "post",
        Some(serde_json::json!({ "state": "validated" }).to_string()),
        Some(serde_json::json!({ "state": "posted" }).to_string()),
        vec!["state".to_string(), "last_count_date".to_string()],
    );

    Ok(())
}
