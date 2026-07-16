//! Directed putaway — choose a bin and move stock from receipt/input location.
use spacetimedb::{reducer, ReducerContext, SpacetimeType};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::inventory_close::assert_inventory_writable;
use crate::inventory::stock::{move_stock_quant, stock_quant, MoveStockQuantParams};
use crate::inventory::warehouse::{stock_location, stock_rule, warehouse};
use crate::inventory::warehouse_operations::{create_warehouse_task, CreateWarehouseTaskParams};
use serde_json;

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct ExecuteDirectedPutawayParams {
    pub warehouse_id: u64,
    pub product_id: u64,
    pub source_location_id: u64,
    /// Quantity in product stock UoM (available at source).
    pub quantity: f64,
    /// Explicit bin override; when set, strategy is ignored.
    pub dest_location_id: Option<u64>,
    /// "rule" | "least_loaded" | "fixed" (fixed requires dest_location_id)
    pub strategy: String,
    pub metadata: Option<String>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn resolve_putaway_dest(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    warehouse_id: u64,
    product_id: u64,
    source_location_id: u64,
    strategy: &str,
    dest_override: Option<u64>,
) -> Result<u64, String> {
    if let Some(dest) = dest_override {
        if dest == source_location_id {
            return Err("Putaway destination must differ from source".to_string());
        }
        return Ok(dest);
    }

    let strategy = strategy.trim().to_ascii_lowercase();
    if strategy == "fixed" {
        return Err("fixed strategy requires dest_location_id".to_string());
    }

    let wh = ctx
        .db
        .warehouse()
        .id()
        .find(&warehouse_id)
        .ok_or("Warehouse not found")?;
    if wh.organization_id != organization_id || wh.company_id != company_id {
        return Err("Warehouse does not belong to this company".to_string());
    }

    // Prefer stock_rule with action containing "putaway".
    if strategy == "rule" || strategy.is_empty() {
        if let Some(rule) = ctx
            .db
            .stock_rule()
            .rule_by_org()
            .filter(&organization_id)
            .filter(|r| {
                r.is_active
                    && r.active
                    && r.warehouse_id == Some(warehouse_id)
                    && r.action.to_ascii_lowercase().contains("putaway")
                    && r.location_dest_id != source_location_id
                    && (r.company_id.is_none() || r.company_id == Some(company_id))
            })
            .min_by_key(|r| r.sequence)
        {
            return Ok(rule.location_dest_id);
        }
    }

    // Least-loaded: among child bins / internal locations under lot stock, pick lowest on-hand for product.
    let stock_root = wh.lot_stock_id;
    let mut bins: Vec<_> = ctx
        .db
        .stock_location()
        .location_by_org()
        .filter(&organization_id)
        .filter(|l| {
            l.is_active
                && l.active
                && !l.scrap_location
                && l.id != source_location_id
                && (l.location_id == Some(stock_root)
                    || l.id == stock_root
                    || l.location_category.to_ascii_lowercase().contains("bin")
                    || l.usage.to_ascii_lowercase().contains("internal"))
        })
        .collect();

    if bins.is_empty() {
        if stock_root != source_location_id {
            return Ok(stock_root);
        }
        return Err(
            "No putaway destination: configure a stock_rule (action putaway) or bin locations"
                .to_string(),
        );
    }

    bins.sort_by_key(|l| {
        let qty: i64 = ctx
            .db
            .stock_quant()
            .quant_by_product()
            .filter(&product_id)
            .filter(|q| {
                q.organization_id == organization_id
                    && q.company_id == company_id
                    && q.location_id == l.id
                    && q.owner_id.is_none()
            })
            .map(|q| (q.quantity * 1000.0) as i64)
            .sum();
        qty
    });

    Ok(bins[0].id)
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Resolve a putaway bin and move available company-owned stock into it.
#[reducer]
pub fn execute_directed_putaway(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: ExecuteDirectedPutawayParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_quant", "write")?;
    assert_inventory_writable(ctx, organization_id, company_id)?;
    if params.quantity <= 0.0 {
        return Err("quantity must be positive".to_string());
    }

    let dest = resolve_putaway_dest(
        ctx,
        organization_id,
        company_id,
        params.warehouse_id,
        params.product_id,
        params.source_location_id,
        &params.strategy,
        params.dest_location_id,
    )?;

    let quant = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&params.product_id)
        .find(|q| {
            q.organization_id == organization_id
                && q.company_id == company_id
                && q.location_id == params.source_location_id
                && q.owner_id.is_none()
                && q.available_quantity + 1e-9 >= params.quantity
        })
        .ok_or_else(|| {
            format!(
                "No available company-owned stock for product {} at location {}",
                params.product_id, params.source_location_id
            )
        })?;

    move_stock_quant(
        ctx,
        organization_id,
        quant.id,
        MoveStockQuantParams {
            company_id: Some(company_id),
            dest_location_id: dest,
            quantity: params.quantity,
        },
    )?;

    create_warehouse_task(
        ctx,
        organization_id,
        company_id,
        CreateWarehouseTaskParams {
            name: format!(
                "Putaway {} → loc {}",
                params.product_id, dest
            ),
            task_type: "putaway".to_string(),
            state: "done".to_string(),
            priority: "1".to_string(),
            quantity: params.quantity,
            user_id: None,
            picking_id: None,
            move_id: None,
            move_line_id: None,
            location_id: Some(params.source_location_id),
            location_dest_id: Some(dest),
            product_id: Some(params.product_id),
            lot_id: quant.lot_id,
            package_id: None,
            uom_id: None,
            date_scheduled: Some(ctx.timestamp),
            date_started: Some(ctx.timestamp),
            date_finished: Some(ctx.timestamp),
            duration_expected: None,
            duration_real: None,
            notes: Some(format!("strategy:{}", params.strategy)),
            metadata: Some(
                serde_json::json!({
                    "putaway": true,
                    "warehouse_id": params.warehouse_id,
                    "source_location_id": params.source_location_id,
                    "dest_location_id": dest,
                })
                .to_string(),
            ),
        },
    )?;

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "stock_quant",
            record_id: quant.id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({ "location_id": params.source_location_id }).to_string(),
            ),
            new_values: Some(
                serde_json::json!({
                    "location_id": dest,
                    "quantity": params.quantity,
                    "strategy": params.strategy,
                })
                .to_string(),
            ),
            changed_fields: vec!["location_id".to_string()],
            metadata: params.metadata,
        },
    );

    Ok(())
}
