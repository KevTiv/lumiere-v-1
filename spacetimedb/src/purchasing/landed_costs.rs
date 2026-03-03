use crate::helpers::{check_permission, write_audit_log};
use crate::types::{LandedCostState, SplitMethod};
/// Landed Costs Module — Additional costs allocation for incoming shipments
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **StockLandedCost** | Landed cost allocations |
/// | **StockLandedCostLines** | Individual cost lines for landed costs |
use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

/// Stock Landed Cost — Additional costs (freight, insurance, duties) allocated to products
#[spacetimedb::table(
    accessor = stock_landed_cost,
    public,
    index(name = "by_state", accessor = stock_landed_cost_by_state, btree(columns = [state]))
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
    index(name = "by_landed_cost", accessor = stock_landed_cost_lines_by_landed_cost, btree(columns = [landed_cost_id]))
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

// ============================================================================
// REDUCERS
// ============================================================================

/// Create a new landed cost record
#[reducer]
pub fn create_landed_cost(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    account_move_id: Option<u64>,
    date: Timestamp,
    target_move: String,
    currency_id: u64,
    amount_total: f64,
    valuation_adjustment_lines: Vec<u64>,
    cost_lines: Vec<u64>,
    picking_ids: Vec<u64>,
    description: Option<String>,
    vendor_bill_id: Option<u64>,
    account_journal_id: Option<u64>,
    activity_ids: Vec<u64>,
    message_follower_ids: Vec<u64>,
    message_ids: Vec<u64>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_landed_cost", "create")?;

    if picking_ids.is_empty() {
        return Err("At least one picking must be selected".to_string());
    }

    let landed_cost = ctx.db.stock_landed_cost().insert(StockLandedCost {
        id: 0,
        state: LandedCostState::Draft,
        date,
        target_move,
        company_id,
        account_move_id,
        account_journal_id,
        vendor_bill_id,
        currency_id,
        amount_total,
        valuation_adjustment_lines,
        picking_ids,
        cost_lines,
        description,
        activity_ids,
        message_follower_ids,
        message_ids,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "stock_landed_cost",
        landed_cost.id,
        "create",
        None,
        None,
        vec!["id".to_string()],
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
    product_id: u64,
    price_unit: f64,
    split_method: SplitMethod,
    currency_id: u64,
    metadata: Option<String>,
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
            product_id,
            price_unit,
            split_method,
            currency_id,
            currency_price_unit: price_unit,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata,
        });

    // Update landed cost total
    let new_total = landed_cost.amount_total + price_unit;
    ctx.db.stock_landed_cost().id().update(StockLandedCost {
        amount_total: new_total,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..landed_cost
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(landed_cost.company_id),
        "stock_landed_cost_lines",
        cost_line.id,
        "create",
        None,
        Some(serde_json::json!({ "price_unit": price_unit }).to_string()),
        vec!["landed_cost_id".to_string(), "price_unit".to_string()],
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

    // Get all cost lines
    let cost_lines: Vec<_> = ctx
        .db
        .stock_landed_cost_lines()
        .iter()
        .filter(|l| l.landed_cost_id == landed_cost_id)
        .collect();

    if cost_lines.is_empty() {
        return Err("No cost lines found for this landed cost".to_string());
    }

    // Calculate total cost amount
    let total_cost: f64 = cost_lines.iter().map(|l| l.price_unit).sum();

    // Here we would typically:
    // 1. Get all pickings and their move lines
    // 2. Get all products from those pickings
    // 3. Allocate costs based on split_method
    // 4. Create valuation adjustment lines
    // For now, we validate and update state

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

    write_audit_log(
        ctx,
        organization_id,
        Some(landed_cost.company_id),
        "stock_landed_cost",
        landed_cost_id,
        "compute",
        None,
        Some(serde_json::json!({ "total_cost": total_cost }).to_string()),
        vec!["amount_total".to_string()],
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

    // Here we would typically:
    // 1. Create journal entries for the valuation adjustments
    // 2. Update product costs
    // 3. Link to account moves

    ctx.db.stock_landed_cost().id().update(StockLandedCost {
        state: LandedCostState::Posted,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..landed_cost
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(landed_cost.company_id),
        "stock_landed_cost",
        landed_cost_id,
        "post",
        Some("Draft".to_string()),
        Some("Posted".to_string()),
        vec!["state".to_string()],
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

    write_audit_log(
        ctx,
        organization_id,
        Some(landed_cost.company_id),
        "stock_landed_cost",
        landed_cost_id,
        "cancel",
        Some(serde_json::json!({ "state": format!("{:?}", landed_cost.state) }).to_string()),
        Some("Cancelled".to_string()),
        vec!["state".to_string()],
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

    // Update landed cost total
    let new_total = landed_cost.amount_total - line.price_unit;
    ctx.db.stock_landed_cost().id().update(StockLandedCost {
        amount_total: new_total,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..landed_cost
    });

    ctx.db.stock_landed_cost_lines().id().delete(&line_id);

    write_audit_log(
        ctx,
        organization_id,
        Some(landed_cost.company_id),
        "stock_landed_cost_lines",
        line_id,
        "delete",
        None,
        None,
        vec!["id".to_string()],
    );

    Ok(())
}
