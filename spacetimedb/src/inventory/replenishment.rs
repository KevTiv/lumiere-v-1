/// Replenishment — Tables and Reducers
///
/// Tables:
///   - ReplenishmentRule
///   - StockReorderGroup
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::idempotency::{record_result, replayed_result};
use crate::accounting::relations::require_active_currency_id;
use crate::core::organization::require_company_in_organization;
use crate::crm::contacts::contact;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::product::{product, product_supplier_info};
use crate::inventory::stock::{
    create_stock_move, create_stock_picking, require_location_in_org, require_product_in_org,
    require_warehouse_in_org_and_company, stock_picking, stock_quant, CreateStockMoveParams,
    CreateStockPickingParams,
};
use crate::purchasing::purchase_orders::{
    add_purchase_order_line, create_purchase_order, purchase_order, AddPurchaseOrderLineParams,
    CreatePurchaseOrderParams,
};
use crate::types::PoState;
use serde_json;

// ── Tables ───────────────────────────────────────────────────────────────────

/// Replenishment Rule
#[spacetimedb::table(
    accessor = replenishment_rule,
    public,
    index(accessor = replenishment_by_org, btree(columns = [organization_id])),
    index(accessor = replenishment_by_product, btree(columns = [product_id])),
    index(accessor = replenishment_by_location, btree(columns = [location_id]))
)]
pub struct ReplenishmentRule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub product_id: u64,
    pub location_id: u64,
    pub warehouse_id: Option<u64>,
    pub uom_id: u64,
    pub product_min_qty: f64,
    pub product_max_qty: f64,
    pub qty_multiple: f64,
    pub qty_to_order: f64,
    pub lead_days: i32,
    pub route_id: Option<u64>,
    pub trigger: String,
    pub group_id: Option<u64>,
    pub company_id: u64,
    pub active: bool,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub last_run: Option<Timestamp>,
    pub next_run: Option<Timestamp>,
    pub metadata: Option<String>,
}

/// Stock Reorder Group
#[spacetimedb::table(
    accessor = stock_reorder_group,
    public,
    index(accessor = reorder_group_by_org, btree(columns = [organization_id]))
)]
pub struct StockReorderGroup {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub rule_ids: Vec<u64>,
    pub active: bool,
    pub company_id: u64,
    pub lead_days: i32,
    pub trigger: String,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateReplenishmentRuleParams {
    pub product_id: u64,
    pub location_id: u64,
    pub warehouse_id: Option<u64>,
    pub uom_id: u64,
    pub product_min_qty: f64,
    pub product_max_qty: f64,
    pub qty_multiple: f64,
    pub lead_days: i32,
    pub route_id: Option<u64>,
    pub trigger: String,
    pub group_id: Option<u64>,
    pub active: bool,
    pub last_run: Option<Timestamp>,
    pub next_run: Option<Timestamp>,
    pub metadata: Option<String>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn available_qty_at_location(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    location_id: u64,
) -> f64 {
    ctx.db
        .stock_quant()
        .quant_by_product()
        .filter(&product_id)
        .filter(|q| {
            q.organization_id == organization_id
                && q.company_id == company_id
                && q.location_id == location_id
        })
        .map(|q| (q.quantity - q.reserved_quantity).max(0.0))
        .sum()
}

fn round_up_multiple(qty: f64, multiple: f64) -> f64 {
    if qty <= 0.0 {
        return 0.0;
    }
    let m = if multiple > 1e-9 { multiple } else { 1.0 };
    ((qty / m).ceil()) * m
}

fn compute_order_qty(rule: &ReplenishmentRule, available: f64) -> f64 {
    if available + 1e-9 >= rule.product_min_qty {
        return 0.0;
    }
    let target = if rule.product_max_qty > rule.product_min_qty {
        rule.product_max_qty
    } else {
        rule.product_min_qty
    };
    let raw = (target - available).max(rule.qty_to_order).max(0.0);
    round_up_multiple(raw, rule.qty_multiple)
}

fn find_supplier_for_product(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
) -> Result<Option<(u64, f64, u64)>, String> {
    // Returns (partner_id, price, currency_id)
    let mut infos: Vec<_> = ctx
        .db
        .product_supplier_info()
        .iter()
        .filter(|s| {
            s.organization_id == organization_id
                && s.is_active
                && s.product_id == Some(product_id)
                && (s.company_id.is_none() || s.company_id == Some(company_id))
        })
        .collect();
    infos.sort_by_key(|s| s.sequence);
    for info in infos {
        if let Some(partner) = ctx.db.contact().id().find(&info.partner_id) {
            if partner.is_vendor {
                require_active_currency_id(ctx, info.currency_id, "supplier")?;
                return Ok(Some((info.partner_id, info.price, info.currency_id)));
            }
        }
    }
    Ok(None)
}

fn find_source_location_with_stock(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    dest_location_id: u64,
    need_qty: f64,
) -> Option<u64> {
    ctx.db
        .stock_quant()
        .quant_by_product()
        .filter(&product_id)
        .filter(|q| {
            q.organization_id == organization_id
                && q.company_id == company_id
                && q.location_id != dest_location_id
                && (q.quantity - q.reserved_quantity) + 1e-9 >= need_qty
        })
        .map(|q| q.location_id)
        .next()
}

fn create_buy_demand(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    rule: &ReplenishmentRule,
    order_qty: f64,
    partner_id: u64,
    price: f64,
    currency_id: u64,
) -> Result<(String, u64), String> {
    let origin_key = format!("REPLENISH-{}", rule.id);

    // Deduplication: return existing open PO with same origin to prevent duplicates on retry.
    if let Some(existing_po) = ctx.db.purchase_order().iter().find(|po| {
        po.organization_id == organization_id
            && po.company_id == company_id
            && po.origin.as_deref() == Some(&origin_key)
            && !matches!(po.state, PoState::Done | PoState::Cancelled)
    }) {
        return Ok(("buy".to_string(), existing_po.id));
    }

    let product = ctx
        .db
        .product()
        .id()
        .find(&rule.product_id)
        .ok_or("Product not found for replenishment")?;

    create_purchase_order(
        ctx,
        organization_id,
        CreatePurchaseOrderParams {
            company_id: Some(company_id),
            partner_id,
            currency_id,
            origin: Some(format!("REPLENISH-{}", rule.id)),
            partner_ref: Some(format!("RPL-{}", rule.id)),
            notes: Some(format!(
                "Auto replenishment for product {} at location {}",
                rule.product_id, rule.location_id
            )),
            date_planned: Some(
                ctx.timestamp
                    + std::time::Duration::from_secs((rule.lead_days.max(0) as u64) * 86400),
            ),
            payment_term_id: None,
            fiscal_position_id: None,
            incoterm_id: None,
            incoterm_location: None,
            user_id: None,
            invoice_ids: vec![],
            picking_ids: vec![],
            message_follower_ids: vec![],
            message_ids: vec![],
            activity_ids: vec![],
            is_quantity_copy: None,
            metadata: Some(
                serde_json::json!({
                    "replenishment_rule_id": rule.id,
                    "demand_type": "buy",
                })
                .to_string(),
            ),
        },
    )?;

    let order = ctx
        .db
        .purchase_order()
        .iter()
        .filter(|o| {
            o.organization_id == organization_id
                && o.company_id == company_id
                && o.partner_ref == Some(format!("RPL-{}", rule.id))
        })
        .max_by_key(|o| o.id)
        .ok_or("Draft PO missing after replenishment create")?;

    add_purchase_order_line(
        ctx,
        organization_id,
        order.id,
        AddPurchaseOrderLineParams {
            product_id: rule.product_id,
            quantity: order_qty,
            uom_id: rule.uom_id,
            price_unit: if price > 0.0 {
                price
            } else {
                product.standard_price
            },
            discount: 0.0,
            tax_ids: vec![],
            name: Some(format!("Replenish {}", product.name)),
            sequence: Some(10),
            display_type: None,
            product_variant_id: None,
            account_analytic_id: None,
            date_planned: order.date_planned,
            propagate_cancel: Some(true),
            lot_id: None,
            metadata: Some(serde_json::json!({ "replenishment_rule_id": rule.id }).to_string()),
        },
    )?;

    Ok(("buy".to_string(), order.id))
}

fn create_transfer_demand(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    rule: &ReplenishmentRule,
    order_qty: f64,
    source_location_id: u64,
) -> Result<(String, u64), String> {
    let picking_name = format!("INT-RPL-{}", rule.id);

    // Deduplication: return existing open picking with same name to prevent duplicates on retry.
    if let Some(existing_picking) = ctx.db.stock_picking().iter().find(|p| {
        p.organization_id == organization_id
            && p.company_id == company_id
            && p.name == picking_name
            && p.state != "done"
            && p.state != "cancel"
    }) {
        return Ok(("transfer".to_string(), existing_picking.id));
    }

    let product = ctx
        .db
        .product()
        .id()
        .find(&rule.product_id)
        .ok_or("Product not found for replenishment transfer")?;

    create_stock_picking(
        ctx,
        organization_id,
        CreateStockPickingParams {
            company_id: Some(company_id),
            name: picking_name.clone(),
            picking_type_id: 0,
            location_id: source_location_id,
            location_dest_id: rule.location_id,
            move_type: "direct".to_string(),
            priority: "1".to_string(),
            partner_id: None,
            contact_id: None,
            scheduled_date: Some(ctx.timestamp),
            origin: Some(format!("REPLENISH-{}", rule.id)),
            note: Some("Auto replenishment internal transfer".to_string()),
            user_id: None,
            sale_id: None,
            purchase_id: None,
            group_id: None,
            is_locked: false,
            immediate_transfer: false,
            is_printed: false,
            is_return: false,
            has_scrap_move: false,
            has_tracking: product.tracking != "none",
            date: None,
            date_done: None,
            backorder_id: None,
            backorder_ids: vec![],
            show_operations: true,
            show_lots_text: false,
            show_reserved: true,
            show_check_availability: true,
            show_validate: true,
            show_mark_as_todo: true,
            show_set_qty_button: false,
            show_clear_qty_button: false,
            show_lots_m2o: false,
            product_id: Some(rule.product_id),
            lot_id: None,
            package_id: None,
            result_package_id: None,
            owner_id: None,
            display_lot_id: None,
            location_id_name: None,
            location_dest_id_name: None,
            picking_code: Some("internal".to_string()),
            product_tracking: Some(product.tracking.clone()),
            product_barcode: None,
            move_line_exist: false,
            has_packages: false,
            has_move_lines: true,
            has_package: false,
            has_lot: false,
            has_owner: false,
            has_entire_package_src: false,
            has_entire_package_dest: false,
            package_level_ids: vec![],
            batch_id: None,
            metadata: Some(
                serde_json::json!({
                    "replenishment_rule_id": rule.id,
                    "demand_type": "transfer",
                })
                .to_string(),
            ),
        },
    )?;

    let picking = ctx
        .db
        .stock_picking()
        .iter()
        .filter(|p| p.organization_id == organization_id && p.name == picking_name)
        .max_by_key(|p| p.id)
        .ok_or("Internal transfer picking missing after replenishment create")?;

    create_stock_move(
        ctx,
        organization_id,
        CreateStockMoveParams {
            company_id: Some(company_id),
            name: format!("Replenish {}", product.name),
            product_id: rule.product_id,
            product_tmpl_id: rule.product_id,
            product_uom: rule.uom_id,
            product_uom_qty: order_qty,
            location_id: source_location_id,
            location_dest_id: rule.location_id,
            date_expected: ctx.timestamp,
            move_type: "internal".to_string(),
            priority: "1".to_string(),
            reference: Some(format!("REPLENISH-{}", rule.id)),
            sequence: 10,
            origin: Some(format!("REPLENISH-{}", rule.id)),
            note: None,
            date: None,
            date_deadline: None,
            picking_id: Some(picking.id),
            picking_type_id: None,
            partner_id: None,
            product_variant_id: None,
            group_id: None,
            rule_id: None,
            procure_method: "make_to_stock".to_string(),
            price_unit: product.standard_price,
            scrapped: false,
            to_refund: false,
            propagate_cancel: true,
            delay_alert: false,
            product_packaging_id: None,
            product_packaging_qty: 0.0,
            warehouse_id: rule.warehouse_id,
            production_id: None,
            raw_material_production_id: None,
            unbuild_id: None,
            consume_unbuild_id: None,
            cost_share: 0.0,
            is_subcontract: false,
            purchase_line_id: None,
            need_release: false,
            release_ready: false,
            propagation_cancel: true,
            has_tracking: product.tracking != "none",
            inventory_id: None,
            sale_line_id: None,
            lot_id: None,
            serial_id: None,
            package_id: None,
            result_package_id: None,
            owner_id: None,
            package_level_id: None,
            product_type: Some(product.type_.clone()),
            metadata: Some(serde_json::json!({ "replenishment_rule_id": rule.id }).to_string()),
        },
    )?;

    Ok(("transfer".to_string(), picking.id))
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Create a new replenishment rule
#[spacetimedb::reducer]
pub fn create_replenishment_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateReplenishmentRuleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "replenishment_rule", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;

    require_product_in_org(ctx, organization_id, params.product_id)?;
    require_location_in_org(ctx, organization_id, params.location_id)?;
    if let Some(wid) = params.warehouse_id {
        require_warehouse_in_org_and_company(ctx, organization_id, company_id, wid)?;
    }

    // qty_to_order derived from min/max quantities
    let qty_to_order = if params.product_max_qty > params.product_min_qty {
        params.product_max_qty - params.product_min_qty
    } else {
        0.0
    };

    let rule = ctx.db.replenishment_rule().insert(ReplenishmentRule {
        id: 0,
        organization_id,
        product_id: params.product_id,
        location_id: params.location_id,
        warehouse_id: params.warehouse_id,
        uom_id: params.uom_id,
        product_min_qty: params.product_min_qty,
        product_max_qty: params.product_max_qty,
        qty_multiple: params.qty_multiple,
        qty_to_order,
        lead_days: params.lead_days,
        route_id: params.route_id,
        trigger: params.trigger.clone(),
        group_id: params.group_id,
        company_id,
        active: params.active,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        last_run: params.last_run,
        next_run: params.next_run,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "replenishment_rule",
            record_id: rule.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "product_id": params.product_id,
                    "location_id": params.location_id,
                    "min_qty": params.product_min_qty,
                    "max_qty": params.product_max_qty,
                    "trigger": params.trigger,
                    "active": params.active,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "product_id".to_string(),
                "location_id".to_string(),
                "trigger".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

/// Execute replenishment rule — creates draft buy (PO) or internal transfer demand when below min.
#[spacetimedb::reducer]
pub fn execute_replenishment_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    rule_id: u64,
    idempotency_key: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "replenishment_rule", "execute")?;
    require_company_in_organization(ctx, organization_id, company_id)?;

    let rule = ctx
        .db
        .replenishment_rule()
        .id()
        .find(&rule_id)
        .ok_or("Rule not found")?;

    if rule.organization_id != organization_id {
        return Err("Rule does not belong to this organization".to_string());
    }
    if rule.company_id != company_id {
        return Err("Rule does not belong to this company".to_string());
    }
    if !rule.active {
        return Err("Rule is not active".to_string());
    }

    let fingerprint = format!("{}:{}:{}", rule.id, rule.product_id, rule.product_min_qty);
    if let Some(existing_id) = replayed_result(
        ctx,
        organization_id,
        company_id,
        "replenishment_demand",
        &idempotency_key,
        &fingerprint,
    )? {
        log::info!(
            "Replenishment rule {} already executed, returning existing demand {}",
            rule.id,
            existing_id
        );
        return Ok(());
    }

    let available = available_qty_at_location(
        ctx,
        organization_id,
        company_id,
        rule.product_id,
        rule.location_id,
    );
    let order_qty = compute_order_qty(&rule, available);

    let mut demand_type = "none".to_string();
    let mut demand_id: Option<u64> = None;

    if order_qty > 1e-9 {
        if let Some((partner_id, price, currency_id)) =
            find_supplier_for_product(ctx, organization_id, company_id, rule.product_id)?
        {
            let (dtype, id) = create_buy_demand(
                ctx,
                organization_id,
                company_id,
                &rule,
                order_qty,
                partner_id,
                price,
                currency_id,
            )?;
            demand_type = dtype;
            demand_id = Some(id);
        } else if let Some(source_location_id) = find_source_location_with_stock(
            ctx,
            organization_id,
            company_id,
            rule.product_id,
            rule.location_id,
            order_qty,
        ) {
            let (dtype, id) = create_transfer_demand(
                ctx,
                organization_id,
                company_id,
                &rule,
                order_qty,
                source_location_id,
            )?;
            demand_type = dtype;
            demand_id = Some(id);
        } else {
            return Err(format!(
                "Cannot create replenishment demand for product {} (need {:.4}): no vendor supplier info and no source location with stock",
                rule.product_id, order_qty
            ));
        }
    }

    if let Some(did) = demand_id {
        let result_table = if demand_type == "buy" {
            "purchase_order"
        } else {
            "stock_picking"
        };
        record_result(
            ctx,
            organization_id,
            company_id,
            "replenishment_demand",
            idempotency_key,
            fingerprint,
            result_table,
            did,
        );
    }

    let last_run = ctx.timestamp;
    let next_run = ctx.timestamp + std::time::Duration::from_secs(86400);
    let metadata = Some(
        serde_json::json!({
            "last_available": available,
            "order_qty": order_qty,
            "demand_type": demand_type,
            "demand_id": demand_id,
        })
        .to_string(),
    );

    ctx.db.replenishment_rule().id().update(ReplenishmentRule {
        last_run: Some(last_run),
        next_run: Some(next_run),
        updated_at: ctx.timestamp,
        metadata,
        ..rule
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "replenishment_rule",
            record_id: rule_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "last_run": last_run.to_string(),
                    "next_run": next_run.to_string(),
                    "available": available,
                    "order_qty": order_qty,
                    "demand_type": demand_type,
                    "demand_id": demand_id,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "last_run".to_string(),
                "next_run".to_string(),
                "metadata".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}
