/// Landed Costs Module — Additional costs allocation for incoming shipments
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **StockLandedCost** | Landed cost allocations |
/// | **StockLandedCostLines** | Individual cost lines for landed costs |
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::{LandedCostState, SplitMethod};

// ── Tables ───────────────────────────────────────────────────────────────────

/// Stock Landed Cost — Additional costs (freight, insurance, duties) allocated to products
#[spacetimedb::table(
    accessor = stock_landed_cost,
    public,
    index(accessor = stock_landed_cost_by_state, btree(columns = [state]))
)]
pub struct StockLandedCost {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub state: LandedCostState,
    pub date: Timestamp,
    pub target_move: String,
    pub company_id: u64,
    pub account_move_id: Option<u64>,
    pub account_journal_id: Option<u64>,
    pub vendor_bill_id: Option<u64>,
    pub currency_id: u64,
    pub amount_total: f64,
    pub valuation_adjustment_lines: Vec<u64>,
    pub picking_ids: Vec<u64>,
    pub cost_lines: Vec<u64>,
    pub description: Option<String>,
    pub activity_ids: Vec<u64>,
    pub message_follower_ids: Vec<u64>,
    pub message_ids: Vec<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Stock Landed Cost Lines — Individual cost components
#[spacetimedb::table(
    accessor = stock_landed_cost_lines,
    public,
    index(accessor = stock_landed_cost_lines_by_landed_cost, btree(columns = [landed_cost_id]))
)]
pub struct StockLandedCostLines {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub landed_cost_id: u64,

    pub product_id: u64,
    pub price_unit: f64,
    pub split_method: SplitMethod,
    pub currency_id: u64,
    pub currency_price_unit: f64,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ──────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateLandedCostParams {
    pub date: Timestamp,
    pub target_move: String,
    pub currency_id: u64,
    pub amount_total: f64,
    pub picking_ids: Vec<u64>,
    pub cost_lines: Vec<u64>,
    pub valuation_adjustment_lines: Vec<u64>,
    pub account_move_id: Option<u64>,
    pub account_journal_id: Option<u64>,
    pub vendor_bill_id: Option<u64>,
    pub description: Option<String>,
    pub activity_ids: Vec<u64>,
    pub message_follower_ids: Vec<u64>,
    pub message_ids: Vec<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct AddLandedCostLineParams {
    pub product_id: u64,
    pub price_unit: f64,
    pub split_method: SplitMethod,
    pub currency_id: u64,
    pub metadata: Option<String>,
}

// ── Reducers ──────────────────────────────────────────────────────────────────

/// Create a new landed cost record
#[reducer]
pub fn create_landed_cost(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateLandedCostParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_landed_cost", "create")?;

    if params.picking_ids.is_empty() {
        return Err("At least one picking must be selected".to_string());
    }

    let landed_cost = ctx.db.stock_landed_cost().insert(StockLandedCost {
        id: 0,
        state: LandedCostState::Draft,
        date: params.date,
        target_move: params.target_move,
        company_id,
        account_move_id: params.account_move_id,
        account_journal_id: params.account_journal_id,
        vendor_bill_id: params.vendor_bill_id,
        currency_id: params.currency_id,
        amount_total: params.amount_total,
        valuation_adjustment_lines: params.valuation_adjustment_lines,
        picking_ids: params.picking_ids,
        cost_lines: params.cost_lines,
        description: params.description,
        activity_ids: params.activity_ids,
        message_follower_ids: params.message_follower_ids,
        message_ids: params.message_ids,
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
            table_name: "stock_landed_cost",
            record_id: landed_cost.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "id": landed_cost.id }).to_string()),
            changed_fields: vec!["id".to_string()],
            metadata: None,
        },
    );

    log::info!("Landed cost {} created", landed_cost.id);
    Ok(())
}

/// Add a cost line to a landed cost
#[reducer]
pub fn add_landed_cost_line(
    ctx: &ReducerContext,
    organization_id: u64,
    landed_cost_id: u64,
    params: AddLandedCostLineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_landed_cost_lines", "create")?;

    let landed_cost = ctx
        .db
        .stock_landed_cost()
        .id()
        .find(&landed_cost_id)
        .ok_or("Landed cost not found")?;

    if !matches!(landed_cost.state, LandedCostState::Draft) {
        return Err("Can only add lines to draft landed costs".to_string());
    }

    let cost_line = ctx
        .db
        .stock_landed_cost_lines()
        .insert(StockLandedCostLines {
            id: 0,
            landed_cost_id,
            product_id: params.product_id,
            price_unit: params.price_unit,
            split_method: params.split_method,
            currency_id: params.currency_id,
            currency_price_unit: params.price_unit,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: params.metadata,
        });

    // Update landed cost total
    let new_total = landed_cost.amount_total + params.price_unit;
    ctx.db.stock_landed_cost().id().update(StockLandedCost {
        amount_total: new_total,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..landed_cost
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(landed_cost.company_id),
            table_name: "stock_landed_cost_lines",
            record_id: cost_line.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "price_unit": params.price_unit }).to_string(),
            ),
            changed_fields: vec!["landed_cost_id".to_string(), "price_unit".to_string()],
            metadata: None,
        },
    );

    log::info!("Landed cost line {} added", cost_line.id);
    Ok(())
}

/// Validate and compute landed costs
#[reducer]
pub fn compute_landed_costs(
    ctx: &ReducerContext,
    organization_id: u64,
    landed_cost_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_landed_cost", "compute")?;

    let landed_cost = ctx
        .db
        .stock_landed_cost()
        .id()
        .find(&landed_cost_id)
        .ok_or("Landed cost not found")?;

    if !matches!(landed_cost.state, LandedCostState::Draft) {
        return Err("Can only compute draft landed costs".to_string());
    }

    let cost_lines: Vec<_> = ctx
        .db
        .stock_landed_cost_lines()
        .iter()
        .filter(|l| l.landed_cost_id == landed_cost_id)
        .collect();

    if cost_lines.is_empty() {
        return Err("No cost lines found for this landed cost".to_string());
    }

    let total_cost: f64 = cost_lines.iter().map(|l| l.price_unit).sum();

    log::info!(
        "Computing landed cost {} with total amount {}",
        landed_cost_id,
        total_cost
    );

    ctx.db.stock_landed_cost().id().update(StockLandedCost {
        amount_total: total_cost,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..landed_cost
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(landed_cost.company_id),
            table_name: "stock_landed_cost",
            record_id: landed_cost_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "total_cost": total_cost }).to_string()),
            changed_fields: vec!["amount_total".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Post/validate landed costs (final state)
#[reducer]
pub fn post_landed_costs(
    ctx: &ReducerContext,
    organization_id: u64,
    landed_cost_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_landed_cost", "post")?;

    let landed_cost = ctx
        .db
        .stock_landed_cost()
        .id()
        .find(&landed_cost_id)
        .ok_or("Landed cost not found")?;

    if !matches!(landed_cost.state, LandedCostState::Draft) {
        return Err("Can only post draft landed costs".to_string());
    }

    if landed_cost.amount_total <= 0.0 {
        return Err("Landed cost must have a positive total amount".to_string());
    }

    ctx.db.stock_landed_cost().id().update(StockLandedCost {
        state: LandedCostState::Posted,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..landed_cost
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(landed_cost.company_id),
            table_name: "stock_landed_cost",
            record_id: landed_cost_id,
            action: "UPDATE",
            old_values: Some("Draft".to_string()),
            new_values: Some("Posted".to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Cancel a landed cost
#[reducer]
pub fn cancel_landed_cost(
    ctx: &ReducerContext,
    organization_id: u64,
    landed_cost_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_landed_cost", "cancel")?;

    let landed_cost = ctx
        .db
        .stock_landed_cost()
        .id()
        .find(&landed_cost_id)
        .ok_or("Landed cost not found")?;

    if matches!(landed_cost.state, LandedCostState::Posted) {
        return Err("Cannot cancel posted landed costs".to_string());
    }

    ctx.db.stock_landed_cost().id().update(StockLandedCost {
        state: LandedCostState::Cancelled,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..landed_cost
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(landed_cost.company_id),
            table_name: "stock_landed_cost",
            record_id: landed_cost_id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({ "state": format!("{:?}", landed_cost.state) }).to_string(),
            ),
            new_values: Some("Cancelled".to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Remove a cost line from a landed cost
#[reducer]
pub fn remove_landed_cost_line(
    ctx: &ReducerContext,
    organization_id: u64,
    line_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_landed_cost_lines", "delete")?;

    let line = ctx
        .db
        .stock_landed_cost_lines()
        .id()
        .find(&line_id)
        .ok_or("Cost line not found")?;

    let landed_cost = ctx
        .db
        .stock_landed_cost()
        .id()
        .find(&line.landed_cost_id)
        .ok_or("Landed cost not found")?;

    if !matches!(landed_cost.state, LandedCostState::Draft) {
        return Err("Can only remove lines from draft landed costs".to_string());
    }

    let new_total = landed_cost.amount_total - line.price_unit;
    ctx.db.stock_landed_cost().id().update(StockLandedCost {
        amount_total: new_total,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..landed_cost
    });

    ctx.db.stock_landed_cost_lines().id().delete(&line_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(landed_cost.company_id),
            table_name: "stock_landed_cost_lines",
            record_id: line_id,
            action: "DELETE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
