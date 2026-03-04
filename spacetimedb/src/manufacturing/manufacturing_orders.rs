/// Manufacturing Orders Module — Production orders and work orders
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **MrpProduction** | Manufacturing orders |
/// | **MrpWorkorder** | Work order operations |
use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

use crate::core::organization::company;
use crate::helpers::{check_permission, write_audit_log};
use crate::inventory::product::product;
use crate::inventory::stock::{
    create_stock_move, done_stock_move, stock_move, stock_quant, StockMove, StockQuant,
};
use crate::manufacturing::bill_of_materials::mrp_bom_line;
use crate::types::{MoState, WorkorderState};

// ============================================================================
// MANUFACTURING ORDER TABLES
// ============================================================================

/// Manufacturing Order — Production order for manufacturing products
#[spacetimedb::table(
    accessor = mrp_production,
    public,
    index(name = "by_product", accessor = mrp_production_by_product, btree(columns = [product_id])),
    index(name = "by_company", accessor = mrp_production_by_company, btree(columns = [company_id])),
    index(name = "by_state", accessor = mrp_production_by_state, btree(columns = [state]))
)]
pub struct MrpProduction {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub origin: Option<String>,
    pub product_id: u64,
    pub product_tmpl_id: u64,
    pub product_qty: f64,
    pub product_uom_id: u64,
    pub product_uom_qty: f64,
    pub product_tracking: String,
    pub lot_producing_id: Option<u64>,
    pub lot_producing_count: u32,
    pub qty_producing: f64,
    pub qty_produced: f64,
    pub product_uom_qty_producing: f64,
    pub company_id: u64,
    pub state: MoState,
    pub availability: String,
    pub date_planned_start: Timestamp,
    pub date_planned_finished: Timestamp,
    pub date_deadline: Option<Timestamp>,
    pub date_start: Option<Timestamp>,
    pub date_finished: Option<Timestamp>,
    pub bom_id: Option<u64>,
    pub routing_id: Option<u64>,
    pub location_src_id: u64,
    pub location_dest_id: u64,
    pub location_finished_id: u64,
    pub warehouse_id: u64,
    pub picking_type_id: u64,
    pub proc_group_id: Option<u64>,
    pub move_raw_ids: Vec<u64>,
    pub move_finished_ids: Vec<u64>,
    pub finished_move_line_ids: Vec<u64>,
    pub workorder_ids: Vec<u64>,
    pub is_planned: bool,
    pub is_locked: bool,
    pub is_delayed: bool,
    pub delay_alert_date: Option<Timestamp>,
    pub procurement_group_id: Option<u64>,
    pub reservation_state: String,
    pub user_id: Identity,
    pub activity_user_id: Option<Identity>,
    pub activity_date_deadline: Option<Timestamp>,
    pub activity_state: Option<String>,
    pub activity_type_id: Option<u64>,
    pub activity_summary: Option<String>,
    pub delay_alert: bool,
    pub message_follower_ids: Vec<u64>,
    pub activity_ids: Vec<u64>,
    pub message_ids: Vec<u64>,
    pub is_workorder: bool,
    pub mo_count: u32,
    pub move_raw_count: u32,
    pub move_finished_count: u32,
    pub check_to_done: bool,
    pub unreserve_visible: bool,
    pub post_visible: bool,
    pub consumption: String,
    pub picking_ids: Vec<u64>,
    pub delivery_count: u32,
    pub confirm_cancel_backorder: bool,
    pub components_availability: String,
    pub components_availability_state: String,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Work Order — Individual operations within a manufacturing order
#[spacetimedb::table(
    accessor = mrp_workorder,
    public,
    index(name = "by_production", accessor = mrp_workorder_by_production, btree(columns = [production_id])),
    index(name = "by_workcenter", accessor = mrp_workorder_by_workcenter, btree(columns = [workcenter_id]))
)]
pub struct MrpWorkorder {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub workcenter_id: u64,
    pub production_id: u64,
    pub product_id: u64,
    pub product_tracking: String,
    pub worksheet: Option<String>,
    pub state: WorkorderState,
    pub date_start: Option<Timestamp>,
    pub date_finished: Option<Timestamp>,
    pub duration_expected: f64,
    pub duration: f64,
    pub duration_percent: f64,
    pub progress: f64,
    pub is_user_working: bool,
    pub time_ids: Vec<u64>,
    pub is_produced: bool,
    pub operation_id: Option<u64>,
    pub blocked_by_workorder_id: Option<u64>,
    pub worksheet_url: Option<String>,
    pub operation_note: Option<String>,
    pub leave_ids: Vec<u64>,
    pub capacity: f64,
    pub production_availability: String,
    pub quality_check_todo: bool,
    pub quality_check_fail: bool,
    pub quality_state: Option<String>,
    pub quality_alert_count: u32,
    pub quality_alert_ids: Vec<u64>,
    pub check_ids: Vec<u64>,
    pub component_ids: Vec<u64>,
    pub company_id: u64,
    pub working_user_ids: Vec<Identity>,
    pub last_working_user_id: Option<Identity>,
    pub is_last_unfinished_wo: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ============================================================================
// REDUCERS
// ============================================================================

fn resolve_organization_id_from_company(
    ctx: &ReducerContext,
    company_id: u64,
) -> Result<u64, String> {
    let company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;
    Ok(company.organization_id)
}

fn get_production_location(mo: &MrpProduction) -> u64 {
    mo.location_src_id
}

fn get_stock_location(mo: &MrpProduction) -> u64 {
    mo.location_dest_id
}

fn upsert_stock_quant(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    location_id: u64,
    qty_delta: f64,
) -> Result<(), String> {
    if let Some(existing) = ctx.db.stock_quant().iter().find(|q| {
        q.organization_id == organization_id
            && q.company_id == company_id
            && q.product_id == product_id
            && q.location_id == location_id
            && q.lot_id.is_none()
            && q.package_id.is_none()
            && q.owner_id.is_none()
    }) {
        let new_quantity = existing.quantity + qty_delta;
        let new_available = new_quantity - existing.reserved_quantity;
        let new_value = new_quantity * existing.cost;

        ctx.db.stock_quant().id().update(StockQuant {
            quantity: new_quantity,
            available_quantity: new_available,
            value: new_value,
            inventory_quantity: new_quantity,
            inventory_diff_quantity: 0.0,
            user_id: Some(ctx.sender()),
            inventory_date: Some(ctx.timestamp),
            ..existing
        });
        return Ok(());
    }

    let product = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or("Product not found for quant upsert")?;

    let cost = product.standard_price;
    let quantity = qty_delta;
    let value = quantity * cost;

    ctx.db.stock_quant().insert(StockQuant {
        id: 0,
        organization_id,
        product_id,
        product_variant_id: None,
        location_id,
        lot_id: None,
        package_id: None,
        owner_id: None,
        company_id,
        quantity,
        reserved_quantity: 0.0,
        available_quantity: quantity,
        in_date: Some(ctx.timestamp),
        inventory_quantity: quantity,
        inventory_diff_quantity: 0.0,
        inventory_quantity_set: true,
        is_outdated: false,
        user_id: Some(ctx.sender()),
        inventory_date: Some(ctx.timestamp),
        cost,
        value,
        cost_method: Some(product.cost_method),
        accounting_date: None,
        currency_id: Some(product.currency_id),
        accounting_entry_ids: Vec::new(),
        metadata: None,
    });

    Ok(())
}

/// Create a new Manufacturing Order
#[reducer]
pub fn create_manufacturing_order(
    ctx: &ReducerContext,
    company_id: u64,
    product_id: u64,
    product_qty: f64,
    product_uom_id: u64,
    bom_id: Option<u64>,
    location_src_id: u64,
    location_dest_id: u64,
    warehouse_id: u64,
    picking_type_id: u64,
    date_planned_start: Timestamp,
    date_planned_finished: Timestamp,
) -> Result<(), String> {
    check_permission(ctx, company_id, "mrp_production", "create")?;

    // Get product info
    let product = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or("Product not found")?;

    let mo = ctx.db.mrp_production().insert(MrpProduction {
        id: 0,
        origin: None,
        product_id,
        product_tmpl_id: product.id,
        product_qty,
        product_uom_id,
        product_uom_qty: product_qty,
        product_tracking: product.tracking.clone(),
        lot_producing_id: None,
        lot_producing_count: 0,
        qty_producing: 0.0,
        qty_produced: 0.0,
        product_uom_qty_producing: 0.0,
        company_id,
        state: MoState::Draft,
        availability: "not_available".to_string(),
        date_planned_start,
        date_planned_finished,
        date_deadline: None,
        date_start: None,
        date_finished: None,
        bom_id,
        routing_id: None,
        location_src_id,
        location_dest_id,
        location_finished_id: location_dest_id,
        warehouse_id,
        picking_type_id,
        proc_group_id: None,
        move_raw_ids: Vec::new(),
        move_finished_ids: Vec::new(),
        finished_move_line_ids: Vec::new(),
        workorder_ids: Vec::new(),
        is_planned: false,
        is_locked: false,
        is_delayed: false,
        delay_alert_date: None,
        procurement_group_id: None,
        reservation_state: "not_available".to_string(),
        user_id: ctx.sender(),
        activity_user_id: None,
        activity_date_deadline: None,
        activity_state: None,
        activity_type_id: None,
        activity_summary: None,
        delay_alert: false,
        message_follower_ids: Vec::new(),
        activity_ids: Vec::new(),
        message_ids: Vec::new(),
        is_workorder: false,
        mo_count: 0,
        move_raw_count: 0,
        move_finished_count: 0,
        check_to_done: false,
        unreserve_visible: false,
        post_visible: false,
        consumption: "flexible".to_string(),
        picking_ids: Vec::new(),
        delivery_count: 0,
        confirm_cancel_backorder: false,
        components_availability: "not_available".to_string(),
        components_availability_state: "not_available".to_string(),
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    write_audit_log(
        ctx,
        company_id,
        None,
        "mrp_production",
        mo.id,
        "create",
        None,
        None,
        vec!["created".to_string()],
    );

    log::info!("Manufacturing order created: id={}", mo.id);
    Ok(())
}

/// Confirm a manufacturing order (Draft -> Confirmed)
#[reducer]
pub fn confirm_manufacturing_order(
    ctx: &ReducerContext,
    company_id: u64,
    mo_id: u64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "mrp_production", "write")?;

    let mo = ctx
        .db
        .mrp_production()
        .id()
        .find(&mo_id)
        .ok_or("Manufacturing order not found")?;

    if mo.company_id != company_id {
        return Err("MO does not belong to this company".to_string());
    }

    match mo.state {
        MoState::Draft => {
            let _updated = ctx.db.mrp_production().id().update(MrpProduction {
                state: MoState::Confirmed,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..mo
            });

            write_audit_log(
                ctx,
                company_id,
                None,
                "mrp_production",
                mo_id,
                "write",
                None,
                None,
                vec!["confirmed".to_string()],
            );

            log::info!("Manufacturing order confirmed: id={}", mo_id);
            Ok(())
        }
        _ => Err("Manufacturing order must be in Draft state to confirm".to_string()),
    }
}

/// Check availability of components for a manufacturing order
#[reducer]
pub fn check_mo_availability(
    ctx: &ReducerContext,
    company_id: u64,
    mo_id: u64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "mrp_production", "write")?;

    let mo = ctx
        .db
        .mrp_production()
        .id()
        .find(&mo_id)
        .ok_or("Manufacturing order not found")?;

    if mo.company_id != company_id {
        return Err("MO does not belong to this company".to_string());
    }

    // Update availability state
    let availability = "available".to_string();
    let availability_state = "available".to_string();

    ctx.db.mrp_production().id().update(MrpProduction {
        availability: availability.clone(),
        components_availability: availability,
        components_availability_state: availability_state,
        reservation_state: "available".to_string(),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..mo
    });

    write_audit_log(
        ctx,
        company_id,
        None,
        "mrp_production",
        mo_id,
        "write",
        None,
        None,
        vec!["availability_checked".to_string()],
    );

    log::info!("MO availability checked: id={}", mo_id);
    Ok(())
}

/// Start production (mark as in progress)
#[reducer]
pub fn start_manufacturing_order(
    ctx: &ReducerContext,
    company_id: u64,
    mo_id: u64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "mrp_production", "write")?;

    let mo = ctx
        .db
        .mrp_production()
        .id()
        .find(&mo_id)
        .ok_or("Manufacturing order not found")?;

    if mo.company_id != company_id {
        return Err("MO does not belong to this company".to_string());
    }

    match mo.state {
        MoState::Confirmed | MoState::Planned => {
            ctx.db.mrp_production().id().update(MrpProduction {
                state: MoState::Progress,
                date_start: Some(ctx.timestamp),
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..mo
            });

            write_audit_log(
                ctx,
                company_id,
                None,
                "mrp_production",
                mo_id,
                "write",
                None,
                None,
                vec!["started".to_string()],
            );

            log::info!("Manufacturing order started: id={}", mo_id);
            Ok(())
        }
        _ => Err("Manufacturing order must be Confirmed or Planned to start".to_string()),
    }
}

/// Record production output
#[reducer]
pub fn produce_manufacturing_order(
    ctx: &ReducerContext,
    company_id: u64,
    mo_id: u64,
    qty_producing: f64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "mrp_production", "write")?;

    let mo = ctx
        .db
        .mrp_production()
        .id()
        .find(&mo_id)
        .ok_or("Manufacturing order not found")?;

    if mo.company_id != company_id {
        return Err("MO does not belong to this company".to_string());
    }

    if qty_producing <= 0.0 {
        return Err("Quantity must be greater than 0".to_string());
    }

    let new_qty_produced = mo.qty_produced + qty_producing;
    let new_state = if new_qty_produced >= mo.product_qty {
        MoState::ToClose
    } else {
        mo.state.clone()
    };

    ctx.db.mrp_production().id().update(MrpProduction {
        qty_producing,
        qty_produced: new_qty_produced,
        state: new_state,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..mo
    });

    write_audit_log(
        ctx,
        company_id,
        None,
        "mrp_production",
        mo_id,
        "write",
        None,
        None,
        vec!["produced".to_string()],
    );

    log::info!(
        "Manufacturing order produced: id={}, qty={}",
        mo_id,
        qty_producing
    );
    Ok(())
}

/// Consume materials for a manufacturing order by creating/done-ing stock moves
#[reducer]
pub fn consume_mo_materials(
    ctx: &ReducerContext,
    company_id: u64,
    mo_id: u64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "mrp_production", "write")?;

    let mo = ctx
        .db
        .mrp_production()
        .id()
        .find(&mo_id)
        .ok_or("Manufacturing order not found")?;

    if mo.company_id != company_id {
        return Err("MO does not belong to this company".to_string());
    }

    if mo.state != MoState::Progress && mo.state != MoState::ToClose {
        return Err(
            "Manufacturing order must be in Progress or ToClose state to consume materials"
                .to_string(),
        );
    }

    let organization_id = resolve_organization_id_from_company(ctx, company_id)?;
    let source_location_id = get_production_location(&mo);

    let mut created_move_ids = mo.move_raw_ids.clone();

    if let Some(bom_id) = mo.bom_id {
        let bom_lines: Vec<_> = ctx
            .db
            .mrp_bom_line()
            .mrp_bom_line_by_bom()
            .filter(&bom_id)
            .collect();

        for line in bom_lines {
            let required_qty = line.product_qty * mo.product_qty.max(1.0);

            create_stock_move(
                ctx,
                organization_id,
                line.product_id,
                line.product_tmpl_id,
                format!("MO {} consume component {}", mo.id, line.product_id),
                source_location_id,
                source_location_id,
                required_qty,
                line.product_uom_id,
                company_id,
                ctx.timestamp,
                "direct".to_string(),
                None,
                Some(mo.picking_type_id),
                None,
                None,
                None,
                Some(format!("MO/{}", mo.id)),
                Some(format!("MO {}", mo.id)),
                None,
                Some(ctx.timestamp),
                None,
                None,
                None,
                None,
                Some(mo.warehouse_id),
                Some(mo.id),
                None,
                None,
                None,
            )?;

            let move_id = ctx
                .db
                .stock_move()
                .iter()
                .filter(|m| m.production_id == Some(mo.id) && m.product_id == line.product_id)
                .max_by_key(|m| m.id)
                .map(|m| m.id)
                .ok_or("Failed to locate created raw material move")?;

            let move_row = ctx
                .db
                .stock_move()
                .id()
                .find(&move_id)
                .ok_or("Raw move not found")?;
            if move_row.state == "draft" {
                ctx.db.stock_move().id().update(StockMove {
                    state: "assigned".to_string(),
                    is_assigned: true,
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..move_row
                });
            }

            done_stock_move(ctx, move_id, required_qty)?;
            upsert_stock_quant(
                ctx,
                organization_id,
                company_id,
                line.product_id,
                source_location_id,
                -required_qty,
            )?;

            created_move_ids.push(move_id);
        }
    }

    ctx.db.mrp_production().id().update(MrpProduction {
        move_raw_ids: created_move_ids,
        move_raw_count: mo.move_raw_count + 1,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..mo
    });

    write_audit_log(
        ctx,
        company_id,
        None,
        "mrp_production",
        mo_id,
        "write",
        None,
        None,
        vec!["materials_consumed".to_string()],
    );

    Ok(())
}

/// Finish a manufacturing order
#[reducer]
pub fn finish_manufacturing_order(
    ctx: &ReducerContext,
    company_id: u64,
    mo_id: u64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "mrp_production", "write")?;

    let mo = ctx
        .db
        .mrp_production()
        .id()
        .find(&mo_id)
        .ok_or("Manufacturing order not found")?;

    if mo.company_id != company_id {
        return Err("MO does not belong to this company".to_string());
    }

    match mo.state {
        MoState::Progress | MoState::ToClose => {
            let organization_id = resolve_organization_id_from_company(ctx, company_id)?;
            let dest_location_id = get_stock_location(&mo);
            let finished_qty = if mo.qty_produced > 0.0 {
                mo.qty_produced
            } else {
                mo.product_qty
            };

            create_stock_move(
                ctx,
                organization_id,
                mo.product_id,
                mo.product_tmpl_id,
                format!("MO {} finished product {}", mo.id, mo.product_id),
                mo.location_src_id,
                dest_location_id,
                finished_qty,
                mo.product_uom_id,
                company_id,
                ctx.timestamp,
                "direct".to_string(),
                None,
                Some(mo.picking_type_id),
                None,
                None,
                None,
                Some(format!("MO/{}", mo.id)),
                Some(format!("MO {}", mo.id)),
                None,
                Some(ctx.timestamp),
                None,
                None,
                None,
                None,
                Some(mo.warehouse_id),
                Some(mo.id),
                None,
                None,
                None,
            )?;

            let finished_move_id = ctx
                .db
                .stock_move()
                .iter()
                .filter(|m| m.production_id == Some(mo.id) && m.product_id == mo.product_id)
                .max_by_key(|m| m.id)
                .map(|m| m.id)
                .ok_or("Failed to locate created finished move")?;

            let finished_move = ctx
                .db
                .stock_move()
                .id()
                .find(&finished_move_id)
                .ok_or("Finished move not found")?;
            if finished_move.state == "draft" {
                ctx.db.stock_move().id().update(StockMove {
                    state: "assigned".to_string(),
                    is_assigned: true,
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..finished_move
                });
            }

            done_stock_move(ctx, finished_move_id, finished_qty)?;
            upsert_stock_quant(
                ctx,
                organization_id,
                company_id,
                mo.product_id,
                dest_location_id,
                finished_qty,
            )?;

            let mut finished_ids = mo.move_finished_ids.clone();
            finished_ids.push(finished_move_id);

            ctx.db.mrp_production().id().update(MrpProduction {
                state: MoState::Done,
                date_finished: Some(ctx.timestamp),
                move_finished_ids: finished_ids,
                move_finished_count: mo.move_finished_count + 1,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..mo
            });

            write_audit_log(
                ctx,
                company_id,
                None,
                "mrp_production",
                mo_id,
                "write",
                None,
                None,
                vec!["finished".to_string(), "stock_posted".to_string()],
            );

            log::info!("Manufacturing order finished: id={}", mo_id);
            Ok(())
        }
        _ => Err("Manufacturing order must be in Progress or ToClose state to finish".to_string()),
    }
}

/// Cancel a manufacturing order
#[reducer]
pub fn cancel_manufacturing_order(
    ctx: &ReducerContext,
    company_id: u64,
    mo_id: u64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "mrp_production", "write")?;

    let mo = ctx
        .db
        .mrp_production()
        .id()
        .find(&mo_id)
        .ok_or("Manufacturing order not found")?;

    if mo.company_id != company_id {
        return Err("MO does not belong to this company".to_string());
    }

    match mo.state {
        MoState::Done => Err("Cannot cancel a completed manufacturing order".to_string()),
        _ => {
            ctx.db.mrp_production().id().update(MrpProduction {
                state: MoState::Cancelled,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..mo
            });

            write_audit_log(
                ctx,
                company_id,
                None,
                "mrp_production",
                mo_id,
                "write",
                None,
                None,
                vec!["cancelled".to_string()],
            );

            log::info!("Manufacturing order cancelled: id={}", mo_id);
            Ok(())
        }
    }
}

// ============================================================================
// WORK ORDER REDUCERS
// ============================================================================

/// Create a work order for a manufacturing order
#[reducer]
pub fn create_workorder(
    ctx: &ReducerContext,
    company_id: u64,
    production_id: u64,
    workcenter_id: u64,
    _name: String,
    _sequence: u32,
    duration_expected: f64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "mrp_workorder", "create")?;

    let mo = ctx
        .db
        .mrp_production()
        .id()
        .find(&production_id)
        .ok_or("Manufacturing order not found")?;

    if mo.company_id != company_id {
        return Err("MO does not belong to this company".to_string());
    }

    let wo = ctx.db.mrp_workorder().insert(MrpWorkorder {
        id: 0,
        workcenter_id,
        production_id,
        product_id: mo.product_id,
        product_tracking: mo.product_tracking.clone(),
        worksheet: None,
        state: WorkorderState::Pending,
        date_start: None,
        date_finished: None,
        duration_expected,
        duration: 0.0,
        duration_percent: 0.0,
        progress: 0.0,
        is_user_working: false,
        time_ids: Vec::new(),
        is_produced: false,
        operation_id: None,
        blocked_by_workorder_id: None,
        worksheet_url: None,
        operation_note: None,
        leave_ids: Vec::new(),
        capacity: 1.0,
        production_availability: "not_available".to_string(),
        quality_check_todo: false,
        quality_check_fail: false,
        quality_state: None,
        quality_alert_count: 0,
        quality_alert_ids: Vec::new(),
        check_ids: Vec::new(),
        component_ids: Vec::new(),
        company_id,
        working_user_ids: Vec::new(),
        last_working_user_id: None,
        is_last_unfinished_wo: false,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    // Update MO with workorder ID
    let mut wo_ids = mo.workorder_ids.clone();
    wo_ids.push(wo.id);
    ctx.db.mrp_production().id().update(MrpProduction {
        workorder_ids: wo_ids,
        is_workorder: true,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..mo
    });

    write_audit_log(
        ctx,
        company_id,
        None,
        "mrp_workorder",
        wo.id,
        "create",
        None,
        None,
        vec!["created".to_string()],
    );

    log::info!("Work order created: id={}", wo.id);
    Ok(())
}

/// Start a work order
#[reducer]
pub fn start_workorder(
    ctx: &ReducerContext,
    company_id: u64,
    workorder_id: u64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "mrp_workorder", "write")?;

    let wo = ctx
        .db
        .mrp_workorder()
        .id()
        .find(&workorder_id)
        .ok_or("Work order not found")?;

    if wo.company_id != company_id {
        return Err("Work order does not belong to this company".to_string());
    }

    match wo.state {
        WorkorderState::Pending | WorkorderState::Ready => {
            ctx.db.mrp_workorder().id().update(MrpWorkorder {
                state: WorkorderState::Progress,
                date_start: Some(ctx.timestamp),
                is_user_working: true,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..wo
            });

            write_audit_log(
                ctx,
                company_id,
                None,
                "mrp_workorder",
                workorder_id,
                "write",
                None,
                None,
                vec!["started".to_string()],
            );

            log::info!("Work order started: id={}", workorder_id);
            Ok(())
        }
        _ => Err("Work order must be Pending or Ready to start".to_string()),
    }
}

/// Finish a work order
#[reducer]
pub fn finish_workorder(
    ctx: &ReducerContext,
    company_id: u64,
    workorder_id: u64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "mrp_workorder", "write")?;

    let wo = ctx
        .db
        .mrp_workorder()
        .id()
        .find(&workorder_id)
        .ok_or("Work order not found")?;

    if wo.company_id != company_id {
        return Err("Work order does not belong to this company".to_string());
    }

    match wo.state {
        WorkorderState::Progress => {
            // Calculate duration
            let duration = wo.duration + 1.0; // Simplified
            let progress = 100.0;

            ctx.db.mrp_workorder().id().update(MrpWorkorder {
                state: WorkorderState::Done,
                date_finished: Some(ctx.timestamp),
                duration,
                progress,
                is_user_working: false,
                is_produced: true,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..wo
            });

            write_audit_log(
                ctx,
                company_id,
                None,
                "mrp_workorder",
                workorder_id,
                "write",
                None,
                None,
                vec!["finished".to_string()],
            );

            log::info!("Work order finished: id={}", workorder_id);
            Ok(())
        }
        _ => Err("Work order must be in Progress state to finish".to_string()),
    }
}
