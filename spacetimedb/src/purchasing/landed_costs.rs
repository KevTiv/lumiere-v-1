/// Landed Costs Module — Additional costs allocation for incoming shipments
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **StockLandedCost** | Landed cost allocations |
/// | **StockLandedCostLines** | Individual cost lines for landed costs |
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::chart_of_accounts::account_journal;
use crate::accounting::journal_entries::account_move;
use crate::core::organization::require_company_in_organization;
use crate::core::reference::currency;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::product::product;
use crate::inventory::stock::{stock_move, stock_picking, stock_quant, StockQuant};
use crate::purchasing::require_purchasing_ri_phase0_unsafe_actions_enabled;
use crate::types::{AccountMoveState, JournalType, LandedCostState, MoveType, SplitMethod};

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

/// Durable completion marker for a landed-cost application.
///
/// A posted landed cost stays `Posted`; this record is the authoritative proof
/// that its quant allocations committed. `landed_cost_id` is unique so retries
/// cannot apply the same logical operation twice.
#[spacetimedb::table(
    accessor = stock_landed_cost_application,
    public,
    index(accessor = landed_cost_application_by_org, btree(columns = [organization_id]))
)]
pub struct StockLandedCostApplication {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    #[unique]
    pub landed_cost_id: u64,
    pub allocation_count: u32,
    pub applied_by: Identity,
    pub applied_at: Timestamp,
}

/// Persisted evidence for each quant adjustment made by an application.
#[spacetimedb::table(
    accessor = stock_landed_cost_allocation,
    public,
    index(accessor = landed_cost_allocation_by_application, btree(columns = [application_id])),
    index(accessor = landed_cost_allocation_by_landed_cost, btree(columns = [landed_cost_id]))
)]
pub struct StockLandedCostAllocation {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub landed_cost_id: u64,
    pub application_id: u64,
    pub cost_line_id: u64,
    pub stock_move_id: u64,
    pub stock_quant_id: u64,
    pub allocated_amount: f64,
    pub quant_value_before: f64,
    pub quant_value_after: f64,
    pub created_at: Timestamp,
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

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateLandedCostParams {
    pub date: Option<Timestamp>,
    pub target_move: Option<String>,
    pub currency_id: Option<u64>,
    pub amount_total: Option<f64>,
    pub picking_ids: Option<Vec<u64>>,
    pub description: Option<String>,
    pub metadata: Option<String>,
}

// ── Scoped relation loaders ─────────────────────────────────────────────────

/// Load a landed cost for a lifecycle mutation. Every lifecycle action has a
/// distinct caller but shares the non-negotiable tenant/company checks.
fn load_landed_cost_for_lifecycle_mutation(
    ctx: &ReducerContext,
    organization_id: u64,
    landed_cost_id: u64,
    action: &str,
) -> Result<StockLandedCost, String> {
    let landed_cost = ctx
        .db
        .stock_landed_cost()
        .id()
        .find(&landed_cost_id)
        .ok_or_else(|| format!("Landed cost not found for {action}"))?;
    if landed_cost.organization_id != organization_id {
        return Err(format!(
            "Landed cost does not belong to this organization for {action}"
        ));
    }
    require_company_in_organization(ctx, organization_id, landed_cost.company_id)?;
    Ok(landed_cost)
}

fn load_draft_landed_cost(
    ctx: &ReducerContext,
    organization_id: u64,
    landed_cost_id: u64,
    action: &str,
) -> Result<StockLandedCost, String> {
    let landed_cost =
        load_landed_cost_for_lifecycle_mutation(ctx, organization_id, landed_cost_id, action)?;
    if landed_cost.state != LandedCostState::Draft {
        return Err(format!("Can only {action} draft landed costs"));
    }
    Ok(landed_cost)
}

fn validate_active_currency(ctx: &ReducerContext, currency_id: u64) -> Result<(), String> {
    let row = ctx
        .db
        .currency()
        .id()
        .find(&currency_id)
        .ok_or("Landed cost currency not found")?;
    if !row.active {
        return Err("Landed cost currency is inactive".to_string());
    }
    Ok(())
}

fn validate_picking_ids(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    picking_ids: &[u64],
) -> Result<(), String> {
    if picking_ids.is_empty() {
        return Err("At least one picking must be selected".to_string());
    }
    let mut seen = std::collections::HashSet::with_capacity(picking_ids.len());
    for picking_id in picking_ids {
        if !seen.insert(*picking_id) {
            return Err("A picking may only be selected once".to_string());
        }
        let picking = ctx
            .db
            .stock_picking()
            .id()
            .find(picking_id)
            .ok_or("Selected picking not found")?;
        if picking.organization_id != organization_id || picking.company_id != company_id {
            return Err("Selected picking is outside the landed-cost company scope".to_string());
        }
        if picking.state.eq_ignore_ascii_case("cancel")
            || picking.state.eq_ignore_ascii_case("cancelled")
            || picking.picking_code.as_deref() != Some("incoming")
        {
            return Err("Selected picking is not an active incoming picking".to_string());
        }
    }
    Ok(())
}

fn validate_accounting_relations(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    currency_id: u64,
    account_move_id: Option<u64>,
    account_journal_id: Option<u64>,
    vendor_bill_id: Option<u64>,
) -> Result<(), String> {
    if let Some(journal_id) = account_journal_id {
        let journal = ctx
            .db
            .account_journal()
            .id()
            .find(&journal_id)
            .ok_or("Landed cost journal not found")?;
        if journal.organization_id != organization_id || journal.company_id != company_id {
            return Err("Landed cost journal is outside the company scope".to_string());
        }
        if !journal.active {
            return Err("Landed cost journal is inactive".to_string());
        }
        if !matches!(
            journal.type_,
            JournalType::Purchase | JournalType::General | JournalType::Inventory
        ) {
            return Err("Landed cost journal has an incompatible type".to_string());
        }
        if journal.currency_id.is_some_and(|id| id != currency_id) {
            return Err("Landed cost journal currency is incompatible".to_string());
        }
    }

    if let Some(move_id) = account_move_id {
        let account_move = ctx
            .db
            .account_move()
            .id()
            .find(&move_id)
            .ok_or("Landed cost account move not found")?;
        if account_move.organization_id != organization_id || account_move.company_id != company_id
        {
            return Err("Landed cost account move is outside the company scope".to_string());
        }
        if account_move.state == AccountMoveState::Cancelled
            || account_move.currency_id != currency_id
        {
            return Err(
                "Landed cost account move is cancelled or has an incompatible currency".to_string(),
            );
        }
        if let Some(journal_id) = account_journal_id {
            if account_move.journal_id != journal_id {
                return Err("Landed cost account move must use the selected journal".to_string());
            }
        }
    }

    if let Some(vendor_bill_id) = vendor_bill_id {
        let vendor_bill = ctx
            .db
            .account_move()
            .id()
            .find(&vendor_bill_id)
            .ok_or("Landed cost vendor bill not found")?;
        if vendor_bill.organization_id != organization_id || vendor_bill.company_id != company_id {
            return Err("Landed cost vendor bill is outside the company scope".to_string());
        }
        if !matches!(
            vendor_bill.move_type,
            MoveType::InInvoice | MoveType::InRefund
        ) || vendor_bill.state == AccountMoveState::Cancelled
            || vendor_bill.currency_id != currency_id
        {
            return Err("Landed cost vendor bill is incompatible".to_string());
        }
        if let Some(journal_id) = account_journal_id {
            if vendor_bill.journal_id != journal_id {
                return Err("Landed cost vendor bill must use the selected journal".to_string());
            }
        }
    }
    Ok(())
}

/// These legacy header vectors are reverse relations. A new parent has no
/// safe way to prove that pre-existing rows are its children, so accepting IDs
/// here would recreate the cross-record attachment vulnerability.
fn reject_unowned_reverse_relations(params: &CreateLandedCostParams) -> Result<(), String> {
    if !params.cost_lines.is_empty()
        || !params.valuation_adjustment_lines.is_empty()
        || !params.activity_ids.is_empty()
        || !params.message_follower_ids.is_empty()
        || !params.message_ids.is_empty()
    {
        return Err(
            "Cost lines, valuation adjustments, activities, followers, and messages are server-owned relations and cannot be attached during landed-cost creation"
                .to_string(),
        );
    }
    Ok(())
}

fn validate_landed_cost_create_relations(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: &CreateLandedCostParams,
) -> Result<(), String> {
    require_company_in_organization(ctx, organization_id, company_id)?;
    validate_active_currency(ctx, params.currency_id)?;
    validate_picking_ids(ctx, organization_id, company_id, &params.picking_ids)?;
    validate_accounting_relations(
        ctx,
        organization_id,
        company_id,
        params.currency_id,
        params.account_move_id,
        params.account_journal_id,
        params.vendor_bill_id,
    )?;
    reject_unowned_reverse_relations(params)
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
    validate_landed_cost_create_relations(ctx, organization_id, company_id, &params)?;

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
        valuation_adjustment_lines: vec![],
        picking_ids: params.picking_ids,
        cost_lines: vec![],
        description: params.description,
        activity_ids: vec![],
        message_follower_ids: vec![],
        message_ids: vec![],
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

    let landed_cost = load_draft_landed_cost(ctx, organization_id, landed_cost_id, "add lines to")?;
    let product = ctx
        .db
        .product()
        .id()
        .find(&params.product_id)
        .ok_or("Landed cost product not found")?;
    if product.organization_id != organization_id || !product.active || !product.purchase_ok {
        return Err(
            "Landed cost product is inactive or outside the organization scope".to_string(),
        );
    }
    validate_active_currency(ctx, params.currency_id)?;

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

    let landed_cost = load_draft_landed_cost(ctx, organization_id, landed_cost_id, "compute")?;

    let cost_lines: Vec<_> = ctx
        .db
        .stock_landed_cost_lines()
        .iter()
        .filter(|l| l.landed_cost_id == landed_cost_id && l.organization_id == organization_id)
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

    let landed_cost = load_draft_landed_cost(ctx, organization_id, landed_cost_id, "post")?;

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

    let landed_cost =
        load_landed_cost_for_lifecycle_mutation(ctx, organization_id, landed_cost_id, "cancel")?;

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

/// Update a draft landed cost header fields.
#[reducer]
pub fn update_landed_cost(
    ctx: &ReducerContext,
    organization_id: u64,
    landed_cost_id: u64,
    params: UpdateLandedCostParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_landed_cost", "write")?;

    let landed_cost = load_draft_landed_cost(ctx, organization_id, landed_cost_id, "update")?;

    let mut updated = landed_cost;

    if let Some(d) = params.date {
        updated.date = d;
    }
    if let Some(ref tm) = params.target_move {
        updated.target_move = tm.clone();
    }
    if let Some(cid) = params.currency_id {
        validate_active_currency(ctx, cid)?;
        validate_accounting_relations(
            ctx,
            organization_id,
            updated.company_id,
            cid,
            updated.account_move_id,
            updated.account_journal_id,
            updated.vendor_bill_id,
        )?;
        updated.currency_id = cid;
    }
    if let Some(amt) = params.amount_total {
        updated.amount_total = amt;
    }
    if let Some(ref pids) = params.picking_ids {
        validate_picking_ids(ctx, organization_id, updated.company_id, pids)?;
        updated.picking_ids = pids.clone();
    }
    if let Some(ref desc) = params.description {
        updated.description = Some(desc.clone());
    }
    if let Some(ref m) = params.metadata {
        updated.metadata = Some(m.clone());
    }

    let company_id = updated.company_id;
    updated.write_uid = ctx.sender();
    updated.write_date = ctx.timestamp;

    ctx.db.stock_landed_cost().id().update(updated);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_landed_cost",
            record_id: landed_cost_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "id": landed_cost_id }).to_string()),
            new_values: Some("updated".to_string()),
            changed_fields: vec!["write_date".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Explicitly clear a nullable draft landed-cost value.
#[reducer]
pub fn clear_landed_cost_field(
    ctx: &ReducerContext,
    organization_id: u64,
    landed_cost_id: u64,
    field: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_landed_cost", "write")?;
    let mut landed_cost =
        load_draft_landed_cost(ctx, organization_id, landed_cost_id, "clear field")?;
    match field.trim() {
        "description" => landed_cost.description = None,
        "metadata" => landed_cost.metadata = None,
        _ => return Err("Unsupported landed-cost clear field".to_string()),
    }
    let company_id = landed_cost.company_id;
    landed_cost.write_uid = ctx.sender();
    landed_cost.write_date = ctx.timestamp;
    ctx.db.stock_landed_cost().id().update(landed_cost);
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_landed_cost",
            record_id: landed_cost_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(format!(r#"{{"cleared":"{field:?}"}}"#)),
            changed_fields: vec![format!("{field:?}")],
            metadata: None,
        },
    );
    Ok(())
}

/// Permanently delete a draft landed cost and its lines.
#[reducer]
pub fn delete_landed_cost(
    ctx: &ReducerContext,
    organization_id: u64,
    landed_cost_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_landed_cost", "delete")?;

    let landed_cost = load_draft_landed_cost(ctx, organization_id, landed_cost_id, "delete")?;

    let company_id = landed_cost.company_id;

    let lines: Vec<_> = ctx
        .db
        .stock_landed_cost_lines()
        .stock_landed_cost_lines_by_landed_cost()
        .filter(&landed_cost_id)
        .collect();

    for line in lines {
        ctx.db.stock_landed_cost_lines().id().delete(&line.id);
    }

    ctx.db.stock_landed_cost().id().delete(&landed_cost_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_landed_cost",
            record_id: landed_cost_id,
            action: "DELETE",
            old_values: Some(
                serde_json::json!({ "id": landed_cost_id, "action": "deleted" }).to_string(),
            ),
            new_values: None,
            changed_fields: vec!["id".to_string()],
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

    let landed_cost = load_draft_landed_cost(
        ctx,
        organization_id,
        line.landed_cost_id,
        "remove lines from",
    )?;
    if line.organization_id != landed_cost.organization_id {
        return Err("Cost line does not belong to the landed-cost organization".to_string());
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
    require_purchasing_ri_phase0_unsafe_actions_enabled(ctx, organization_id)?;
    require_company_in_organization(ctx, organization_id, company_id)?;

    let lc =
        load_landed_cost_for_lifecycle_mutation(ctx, organization_id, landed_cost_id, "apply")?;
    if lc.company_id != company_id {
        return Err("Landed cost does not belong to this company".to_string());
    }

    if lc.state != LandedCostState::Posted {
        return Err("Landed cost must be posted before applying".to_string());
    }

    if lc.picking_ids.is_empty() {
        return Err("No pickings linked to this landed cost".to_string());
    }

    // A committed application is the idempotency boundary. It intentionally
    // returns success on retry without touching quants or producing more audit
    // rows. The unique table column also protects this invariant at storage.
    if ctx
        .db
        .stock_landed_cost_application()
        .landed_cost_id()
        .find(&landed_cost_id)
        .is_some()
    {
        return Ok(());
    }

    validate_active_currency(ctx, lc.currency_id)?;
    validate_picking_ids(ctx, organization_id, company_id, &lc.picking_ids)?;
    validate_accounting_relations(
        ctx,
        organization_id,
        company_id,
        lc.currency_id,
        lc.account_move_id,
        lc.account_journal_id,
        lc.vendor_bill_id,
    )?;

    // Collect all done moves from the linked pickings
    let done_moves: Vec<_> = ctx
        .db
        .stock_move()
        .iter()
        .filter(|m| {
            m.is_done
                && m.organization_id == organization_id
                && m.company_id == company_id
                && m.picking_id
                    .map(|pid| lc.picking_ids.contains(&pid))
                    .unwrap_or(false)
        })
        .collect();

    if done_moves.is_empty() {
        return Err("No completed moves found for the selected incoming pickings".to_string());
    }

    // Fetch cost lines
    let cost_lines: Vec<_> = ctx
        .db
        .stock_landed_cost_lines()
        .stock_landed_cost_lines_by_landed_cost()
        .filter(&landed_cost_id)
        .filter(|line| line.organization_id == organization_id)
        .collect();

    if cost_lines.is_empty() {
        return Err("No cost lines found for this landed cost".to_string());
    }

    #[derive(Clone)]
    struct PlannedAllocation {
        cost_line_id: u64,
        stock_move_id: u64,
        quant: StockQuant,
        allocated_amount: f64,
    }

    // Plan and validate every allocation before changing a quant. This makes
    // all domain failures happen before the first write in the transaction.
    let mut planned = Vec::new();

    for cost_line in &cost_lines {
        validate_active_currency(ctx, cost_line.currency_id)?;
        if cost_line.currency_id != lc.currency_id {
            return Err("Landed cost line currency is incompatible with its header".to_string());
        }
        let total_cost = cost_line.price_unit;
        if total_cost == 0.0 {
            continue;
        }

        // Compute each move's basis value depending on split method
        let basis_values: Vec<f64> = done_moves
            .iter()
            .map(|m| {
                Ok(match cost_line.split_method {
                    SplitMethod::Equal => 1.0,
                    SplitMethod::ByQuantity => m.quantity_done,
                    SplitMethod::ByCurrentCost | SplitMethod::ByWeight | SplitMethod::ByVolume => {
                        // Weight and volume are not modelled on move lines. Use
                        // the persisted quant quantity as the documented proxy,
                        // but never silently fall back when the quant is absent.
                        ctx.db
                            .stock_quant()
                            .iter()
                            .find(|q| {
                                q.product_id == m.product_id
                                    && q.location_id == m.location_dest_id
                                    && q.organization_id == organization_id
                                    && q.company_id == company_id
                            })
                            .map(|q| {
                                if matches!(cost_line.split_method, SplitMethod::ByCurrentCost) {
                                    q.value
                                } else {
                                    q.quantity
                                }
                            })
                            .ok_or("No matching stock quant found for landed-cost allocation")?
                    }
                })
            })
            .collect::<Result<Vec<_>, String>>()?;

        let total_basis: f64 = basis_values.iter().sum();
        if total_basis == 0.0 {
            continue;
        }

        for (mv, basis) in done_moves.iter().zip(basis_values.iter()) {
            let allocated = total_cost * (basis / total_basis);
            if allocated == 0.0 {
                continue;
            }

            let quant = ctx
                .db
                .stock_quant()
                .iter()
                .find(|q| {
                    q.product_id == mv.product_id
                        && q.location_id == mv.location_dest_id
                        && q.organization_id == organization_id
                        && q.company_id == company_id
                        && q.lot_id.is_none()
                        && q.package_id.is_none()
                        && q.owner_id.is_none()
                })
                .ok_or("No matching stock quant found for landed-cost allocation")?;
            planned.push(PlannedAllocation {
                cost_line_id: cost_line.id,
                stock_move_id: mv.id,
                quant,
                allocated_amount: allocated,
            });
        }
    }

    if planned.is_empty() {
        return Err("Landed cost produced no quant allocations".to_string());
    }

    let application = ctx
        .db
        .stock_landed_cost_application()
        .insert(StockLandedCostApplication {
            id: 0,
            organization_id,
            company_id,
            landed_cost_id,
            allocation_count: planned.len() as u32,
            applied_by: ctx.sender(),
            applied_at: ctx.timestamp,
        });

    for allocation in planned {
        let value_before = allocation.quant.value;
        let value_after = value_before + allocation.allocated_amount;
        let new_cost = if allocation.quant.quantity > 0.0 {
            value_after / allocation.quant.quantity
        } else {
            allocation.quant.cost
        };
        ctx.db.stock_quant().id().update(StockQuant {
            value: value_after,
            cost: new_cost,
            user_id: Some(ctx.sender()),
            inventory_date: Some(ctx.timestamp),
            ..allocation.quant
        });
        ctx.db
            .stock_landed_cost_allocation()
            .insert(StockLandedCostAllocation {
                id: 0,
                organization_id,
                company_id,
                landed_cost_id,
                application_id: application.id,
                cost_line_id: allocation.cost_line_id,
                stock_move_id: allocation.stock_move_id,
                stock_quant_id: allocation.quant.id,
                allocated_amount: allocation.allocated_amount,
                quant_value_before: value_before,
                quant_value_after: value_after,
                created_at: ctx.timestamp,
            });
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
