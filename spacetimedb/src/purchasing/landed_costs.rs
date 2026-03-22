/// Landed Costs Module — Additional costs allocation for incoming shipments
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **StockLandedCost** | Landed cost allocations |
/// | **StockLandedCostLines** | Individual cost lines for landed costs |
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::stock::{stock_move, stock_quant, StockQuant};
use crate::types::{LandedCostState, SplitMethod};

// ── Tables ───────────────────────────────────────────────────────────────────

/// Stock Landed Cost — Additional costs (freight, insurance, duties) allocated to products
#[spacetimedb::table(
    accessor = stock_landed_cost,
    public,
    index(accessor = stock_landed_cost_by_org, btree(columns = [organization_id])),
    index(accessor = stock_landed_cost_by_state, btree(columns = [state]))
)]
pub struct StockLandedCost {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    /// Tenant isolation — always required
    pub organization_id: u64,
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
    index(accessor = stock_landed_cost_lines_by_org, btree(columns = [organization_id])),
    index(accessor = stock_landed_cost_lines_by_landed_cost, btree(columns = [landed_cost_id]))
)]
pub struct StockLandedCostLines {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// Tenant isolation — always required
    pub organization_id: u64,
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
        organization_id,
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
            organization_id: landed_cost.organization_id,
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
            new_values: Some(serde_json::json!({ "price_unit": params.price_unit }).to_string()),
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

/// Apply a posted landed cost to the StockQuant valuation of the related pickings.
///
/// For each cost line, collects the done moves from the landed cost's pickings,
/// computes each move's share of the cost according to the line's split_method,
/// and increments the matching StockQuant's value (and recalculates unit cost).
#[reducer]
pub fn apply_landed_costs(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    landed_cost_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_landed_cost", "write")?;

    let lc = ctx
        .db
        .stock_landed_cost()
        .id()
        .find(&landed_cost_id)
        .ok_or("Landed cost not found")?;

    if lc.organization_id != organization_id {
        return Err("Landed cost does not belong to this organization".to_string());
    }
    if lc.company_id != company_id {
        return Err("Landed cost does not belong to this company".to_string());
    }

    if lc.state != LandedCostState::Posted {
        return Err("Landed cost must be posted before applying".to_string());
    }

    if lc.picking_ids.is_empty() {
        return Err("No pickings linked to this landed cost".to_string());
    }

    // Collect all done moves from the linked pickings
    let done_moves: Vec<_> = ctx
        .db
        .stock_move()
        .iter()
        .filter(|m| {
            m.is_done
                && m.picking_id
                    .map(|pid| lc.picking_ids.contains(&pid))
                    .unwrap_or(false)
        })
        .collect();

    if done_moves.is_empty() {
        return Ok(()); // nothing to allocate
    }

    // Fetch cost lines
    let cost_lines: Vec<_> = ctx
        .db
        .stock_landed_cost_lines()
        .stock_landed_cost_lines_by_landed_cost()
        .filter(&landed_cost_id)
        .collect();

    for cost_line in &cost_lines {
        let total_cost = cost_line.price_unit;
        if total_cost == 0.0 {
            continue;
        }

        // Compute each move's basis value depending on split method
        let basis_values: Vec<f64> = done_moves
            .iter()
            .map(|m| match cost_line.split_method {
                SplitMethod::Equal => 1.0,
                SplitMethod::ByQuantity => m.quantity_done,
                SplitMethod::ByCurrentCost | SplitMethod::ByWeight | SplitMethod::ByVolume => {
                    // Fall back to current StockQuant value for ByCurrentCost;
                    // ByWeight/ByVolume require product dimensions — use quantity as proxy
                    ctx.db
                        .stock_quant()
                        .iter()
                        .find(|q| {
                            q.product_id == m.product_id
                                && q.location_id == m.location_dest_id
                                && q.company_id == company_id
                        })
                        .map(|q| {
                            if matches!(cost_line.split_method, SplitMethod::ByCurrentCost) {
                                q.value
                            } else {
                                q.quantity
                            }
                        })
                        .unwrap_or(m.quantity_done)
                }
            })
            .collect();

        let total_basis: f64 = basis_values.iter().sum();
        if total_basis == 0.0 {
            continue;
        }

        for (mv, basis) in done_moves.iter().zip(basis_values.iter()) {
            let allocated = total_cost * (basis / total_basis);
            if allocated == 0.0 {
                continue;
            }

            // Find or create the StockQuant for this product + destination location
            if let Some(quant) = ctx.db.stock_quant().iter().find(|q| {
                q.product_id == mv.product_id
                    && q.location_id == mv.location_dest_id
                    && q.company_id == company_id
                    && q.lot_id.is_none()
                    && q.package_id.is_none()
                    && q.owner_id.is_none()
            }) {
                let new_value = quant.value + allocated;
                let new_cost = if quant.quantity > 0.0 {
                    new_value / quant.quantity
                } else {
                    quant.cost
                };
                ctx.db.stock_quant().id().update(StockQuant {
                    value: new_value,
                    cost: new_cost,
                    user_id: Some(ctx.sender()),
                    inventory_date: Some(ctx.timestamp),
                    ..quant
                });
            }
        }
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_landed_cost",
            record_id: landed_cost_id,
            action: "APPLY",
            old_values: None,
            new_values: Some(serde_json::json!({ "amount_total": lc.amount_total }).to_string()),
            changed_fields: vec!["valuation_adjustment_lines".to_string()],
            metadata: None,
        },
    );

    log::info!(
        "Applied landed cost {} to {} moves across {} pickings",
        landed_cost_id,
        done_moves.len(),
        lc.picking_ids.len()
    );

    Ok(())
}
