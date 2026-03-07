/// Cycle Counting — Tables and Reducers
///
/// Tables:
///   - StockCycleCount
///   - StockCountSheet
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::stock::{stock_quant, StockQuant};
use serde_json;

// ── Tables ───────────────────────────────────────────────────────────────────

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

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateCycleCountPlanParams {
    /// If None, defaults to "Cycle Count @ {location_id}"
    pub name: Option<String>,
    pub count_by: String,
    pub frequency: String,
    pub tolerance_percentage: f64,
    pub tolerance_value: f64,
    pub next_count_date: Option<Timestamp>,
    pub user_id: Option<Identity>,
    pub team_id: Option<u64>,
    pub product_ids: Vec<u64>,
    pub product_category_ids: Vec<u64>,
    pub reason: Option<String>,
    pub notes: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordCycleCountLineParams {
    pub product_id: u64,
    pub location_id: u64,
    pub lot_id: Option<u64>,
    pub qty_counted: f64,
    pub uom_id: u64,
    pub notes: Option<String>,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

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
    params: CreateCycleCountPlanParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_cycle_count", "create")?;

    let plan_name = params
        .name
        .unwrap_or_else(|| format!("Cycle Count @ {}", location_id));
    if plan_name.trim().is_empty() {
        return Err("Cycle count plan name cannot be empty".to_string());
    }

    let product_count = params.product_ids.len();
    let category_count = params.product_category_ids.len();

    // state starts as "draft"; line_ids and inventory_id are system-managed
    let cycle = ctx.db.stock_cycle_count().insert(StockCycleCount {
        id: 0,
        organization_id,
        name: plan_name.clone(),
        state: "draft".to_string(),
        location_id,
        product_ids: params.product_ids,
        product_category_ids: params.product_category_ids,
        count_by: params.count_by,
        frequency: params.frequency,
        last_count_date: None,
        next_count_date: params.next_count_date,
        tolerance_percentage: params.tolerance_percentage,
        tolerance_value: params.tolerance_value,
        user_id: params.user_id,
        team_id: params.team_id,
        company_id,
        inventory_id: None,
        line_ids: vec![],
        reason: params.reason,
        notes: params.notes,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_cycle_count",
            record_id: cycle.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "state": "draft",
                    "location_id": location_id,
                    "product_count": product_count,
                    "category_count": category_count,
                })
                .to_string(),
            ),
            changed_fields: vec!["state".to_string(), "location_id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Phase-3 alias: start cycle count session
#[spacetimedb::reducer]
pub fn start_cycle_count_session(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    cycle_count_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_cycle_count", "write")?;

    let cycle = ctx
        .db
        .stock_cycle_count()
        .id()
        .find(&cycle_count_id)
        .ok_or("Cycle count not found")?;

    if cycle.organization_id != organization_id {
        return Err("Cycle count does not belong to this organization".to_string());
    }
    if cycle.company_id != company_id {
        return Err("Cycle count does not belong to this company".to_string());
    }
    if cycle.state != "draft" && cycle.state != "validated" {
        return Err("Only draft/validated cycle counts can be started".to_string());
    }

    ctx.db.stock_cycle_count().id().update(StockCycleCount {
        state: "in_progress".to_string(),
        updated_at: ctx.timestamp,
        ..cycle
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_cycle_count",
            record_id: cycle_count_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "draft" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "in_progress" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Phase-3 alias: record cycle count line
#[spacetimedb::reducer]
pub fn record_cycle_count_line(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    cycle_count_id: u64,
    params: RecordCycleCountLineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_count_sheet", "create")?;

    let cycle = ctx
        .db
        .stock_cycle_count()
        .id()
        .find(&cycle_count_id)
        .ok_or("Cycle count not found")?;

    if cycle.organization_id != organization_id {
        return Err("Cycle count does not belong to this organization".to_string());
    }
    if cycle.company_id != company_id {
        return Err("Cycle count does not belong to this company".to_string());
    }
    if cycle.state != "in_progress" {
        return Err("Cycle count must be in_progress to record lines".to_string());
    }

    let expected_qty = ctx
        .db
        .stock_quant()
        .iter()
        .find(|q| {
            q.organization_id == organization_id
                && q.product_id == params.product_id
                && q.location_id == params.location_id
                && q.lot_id == params.lot_id
        })
        .map(|q| q.quantity)
        .unwrap_or(0.0);

    let quant_cost = ctx
        .db
        .stock_quant()
        .iter()
        .find(|q| {
            q.organization_id == organization_id
                && q.product_id == params.product_id
                && q.location_id == params.location_id
                && q.lot_id == params.lot_id
        })
        .map(|q| q.cost);

    let variance = params.qty_counted - expected_qty;
    let variance_value =
        compute_sheet_variance_value(expected_qty, params.qty_counted, quant_cost);

    // is_processed and processed_at are system-managed; set by post_cycle_count_adjustments
    let sheet = ctx.db.stock_count_sheet().insert(StockCountSheet {
        id: 0,
        organization_id,
        cycle_count_id,
        product_id: params.product_id,
        location_id: params.location_id,
        lot_id: params.lot_id,
        expected_qty,
        counted_qty: params.qty_counted,
        uom_id: params.uom_id,
        variance,
        variance_value,
        counted_by: Some(ctx.sender()),
        counted_at: Some(ctx.timestamp),
        notes: params.notes,
        is_processed: false,
        processed_at: None,
        created_at: ctx.timestamp,
        metadata: params.metadata,
    });

    let mut ids = cycle.line_ids.clone();
    ids.push(sheet.id);
    ctx.db.stock_cycle_count().id().update(StockCycleCount {
        line_ids: ids,
        updated_at: ctx.timestamp,
        ..cycle
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_count_sheet",
            record_id: sheet.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "product_id": params.product_id,
                    "counted_qty": params.qty_counted,
                    "variance": variance,
                })
                .to_string(),
            ),
            changed_fields: vec!["counted_qty".to_string(), "variance".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Compare counted vs expected and mark the session as validated.
/// This does not mutate stock yet.
#[spacetimedb::reducer]
pub fn validate_cycle_count(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    cycle_count_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_cycle_count", "write")?;

    let cycle = ctx
        .db
        .stock_cycle_count()
        .id()
        .find(&cycle_count_id)
        .ok_or("Cycle count not found")?;

    if cycle.organization_id != organization_id {
        return Err("Cycle count does not belong to this organization".to_string());
    }
    if cycle.company_id != company_id {
        return Err("Cycle count does not belong to this company".to_string());
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

    ctx.db.stock_cycle_count().id().update(StockCycleCount {
        state: "validated".to_string(),
        updated_at: ctx.timestamp,
        ..cycle
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_cycle_count",
            record_id: cycle_count_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "in_progress" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "validated" }).to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

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
    company_id: u64,
    cycle_count_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_cycle_count", "write")?;

    let cycle = ctx
        .db
        .stock_cycle_count()
        .id()
        .find(&cycle_count_id)
        .ok_or("Cycle count not found")?;

    if cycle.organization_id != organization_id {
        return Err("Cycle count does not belong to this organization".to_string());
    }
    if cycle.company_id != company_id {
        return Err("Cycle count does not belong to this company".to_string());
    }
    if cycle.state != "validated" {
        return Err("Cycle count must be validated before posting adjustments".to_string());
    }

    let sheet_ids = cycle.line_ids.clone();
    for sheet_id in sheet_ids {
        let sheet = ctx
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

        ctx.db.stock_count_sheet().id().update(StockCountSheet {
            is_processed: true,
            processed_at: Some(ctx.timestamp),
            ..sheet
        });
    }

    ctx.db.stock_cycle_count().id().update(StockCycleCount {
        state: "posted".to_string(),
        last_count_date: Some(ctx.timestamp),
        updated_at: ctx.timestamp,
        ..cycle
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_cycle_count",
            record_id: cycle_count_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": "validated" }).to_string()),
            new_values: Some(serde_json::json!({ "state": "posted" }).to_string()),
            changed_fields: vec!["state".to_string(), "last_count_date".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
