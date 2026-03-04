/// Manufacturing CSV Imports — MrpWorkcenter, MrpBom, MrpBomLine, MrpProduction
use spacetimedb::{ReducerContext, Table};

use crate::data_ops::helpers::*;
use crate::data_ops::import_tracker::{begin_import_job, finish_import_job, record_import_error};
use crate::helpers::check_permission;
use crate::manufacturing::bill_of_materials::{mrp_bom, mrp_bom_line, MrpBom, MrpBomLine};
use crate::manufacturing::manufacturing_orders::{mrp_production, MrpProduction};
use crate::manufacturing::work_centers::{mrp_workcenter, MrpWorkcenter};
use crate::types::{BomType, MoState};

// ── MrpWorkcenter ─────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_workcenter_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mrp_workcenter", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "mrp_workcenter",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        ctx.db.mrp_workcenter().insert(MrpWorkcenter {
            id: 0,
            name,
            active: parse_bool(col(&headers, row, "active")),
            code: opt_str(col(&headers, row, "code")),
            company_id,
            working_state: "normal".to_string(),
            oee_target: parse_f64(col(&headers, row, "oee_target")),
            time_efficiency: {
                let v = parse_f64(col(&headers, row, "time_efficiency"));
                if v == 0.0 {
                    100.0
                } else {
                    v
                }
            },
            capacity: {
                let v = parse_f64(col(&headers, row, "capacity"));
                if v == 0.0 {
                    1.0
                } else {
                    v
                }
            },
            capacity_ids: vec![],
            oee: 0.0,
            performance: 0.0,
            blocked_time: 0.0,
            productive_time: 0.0,
            workingstate: "normal".to_string(),
            productivity_ids: vec![],
            order_ids: vec![],
            workorder_count: 0,
            workorder_ready_count: 0,
            workorder_progress_count: 0,
            workorder_pending_count: 0,
            workorder_late_count: 0,
            alternative_workcenter_ids: vec![],
            color: None,
            resource_calendar_id: opt_u64(col(&headers, row, "resource_calendar_id")),
            tag_ids: vec![],
            default_capacity_parent_id: None,
            default_time_efficiency: 100.0,
            default_oee_target: parse_f64(col(&headers, row, "oee_target")),
            sequence: parse_u32(col(&headers, row, "sequence")),
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import mrp_workcenter: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── MrpBom ────────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_bom_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mrp_bom", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "mrp_bom", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let product_id = parse_u64(col(&headers, row, "product_id"));
        let product_tmpl_id = parse_u64(col(&headers, row, "product_tmpl_id"));

        if product_id == 0 && product_tmpl_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("product_id"),
                None,
                "product_id or product_tmpl_id is required",
            );
            errors += 1;
            continue;
        }

        let product_uom_id = parse_u64(col(&headers, row, "product_uom_id"));
        let bom_type = {
            let t = col(&headers, row, "type_");
            match t {
                "kit" => BomType::Kit,
                "subcontract" => BomType::Subcontract,
                _ => BomType::Manufacture,
            }
        };

        ctx.db.mrp_bom().insert(MrpBom {
            id: 0,
            type_: bom_type,
            product_id: if product_id != 0 {
                product_id
            } else {
                product_tmpl_id
            },
            product_tmpl_id: if product_tmpl_id != 0 {
                product_tmpl_id
            } else {
                product_id
            },
            product_qty: {
                let v = parse_f64(col(&headers, row, "product_qty"));
                if v == 0.0 {
                    1.0
                } else {
                    v
                }
            },
            product_uom_id,
            sequence: parse_u32(col(&headers, row, "sequence")),
            company_id,
            ready_to_produce: "all_available".to_string(),
            consumption: "allowed".to_string(),
            picking_type_id: opt_u64(col(&headers, row, "picking_type_id")),
            location_src_id: opt_u64(col(&headers, row, "location_src_id")),
            location_dest_id: opt_u64(col(&headers, row, "location_dest_id")),
            warehouse_id: opt_u64(col(&headers, row, "warehouse_id")),
            routing_id: None,
            bom_line_ids: vec![],
            byproduct_ids: vec![],
            operation_ids: vec![],
            message_follower_ids: vec![],
            activity_ids: vec![],
            message_ids: vec![],
            estimated_cost: 0.0,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!("Import mrp_bom: imported={}, errors={}", imported, errors);
    Ok(())
}

// ── MrpBomLine ────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_bom_line_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mrp_bom_line", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "mrp_bom_line",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let bom_id = parse_u64(col(&headers, row, "bom_id"));
        let product_id = parse_u64(col(&headers, row, "product_id"));

        if bom_id == 0 || product_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("bom_id"),
                None,
                "bom_id and product_id are required",
            );
            errors += 1;
            continue;
        }

        let product_tmpl_id = parse_u64(col(&headers, row, "product_tmpl_id"));
        let product_uom_id = parse_u64(col(&headers, row, "product_uom_id"));

        ctx.db.mrp_bom_line().insert(MrpBomLine {
            id: 0,
            bom_id,
            product_id,
            product_tmpl_id: if product_tmpl_id != 0 {
                product_tmpl_id
            } else {
                product_id
            },
            product_qty: {
                let v = parse_f64(col(&headers, row, "product_qty"));
                if v == 0.0 {
                    1.0
                } else {
                    v
                }
            },
            product_uom_id,
            sequence: parse_u32(col(&headers, row, "sequence")),
            manual_consumption: parse_bool(col(&headers, row, "manual_consumption")),
            operation_id: opt_u64(col(&headers, row, "operation_id")),
            bom_product_template_attribute_value_ids: vec![],
            parent_product_tmpl_id: None,
            possible_bom_product_template_attribute_value_ids: vec![],
            child_bom_id: None,
            child_line_ids: vec![],
            attachments_count: 0,
            company_id,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import mrp_bom_line: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── MrpProduction ─────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_manufacturing_order_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mrp_production", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "mrp_production",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let product_id = parse_u64(col(&headers, row, "product_id"));

        if product_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("product_id"),
                None,
                "product_id is required",
            );
            errors += 1;
            continue;
        }

        let product_uom_id = parse_u64(col(&headers, row, "product_uom_id"));
        let warehouse_id = parse_u64(col(&headers, row, "warehouse_id"));
        let picking_type_id = parse_u64(col(&headers, row, "picking_type_id"));
        let location_src_id = parse_u64(col(&headers, row, "location_src_id"));
        let location_dest_id = parse_u64(col(&headers, row, "location_dest_id"));

        let date_planned =
            opt_timestamp(col(&headers, row, "date_planned_start")).unwrap_or(ctx.timestamp);
        let date_finished =
            opt_timestamp(col(&headers, row, "date_planned_finished")).unwrap_or(ctx.timestamp);

        ctx.db.mrp_production().insert(MrpProduction {
            id: 0,
            origin: opt_str(col(&headers, row, "origin")),
            product_id,
            product_tmpl_id: parse_u64(col(&headers, row, "product_tmpl_id")),
            product_qty: {
                let v = parse_f64(col(&headers, row, "product_qty"));
                if v == 0.0 {
                    1.0
                } else {
                    v
                }
            },
            product_uom_id,
            product_uom_qty: parse_f64(col(&headers, row, "product_qty")),
            product_tracking: "none".to_string(),
            lot_producing_id: None,
            lot_producing_count: 0,
            qty_producing: 0.0,
            qty_produced: 0.0,
            product_uom_qty_producing: 0.0,
            company_id,
            state: MoState::Draft,
            availability: "none".to_string(),
            date_planned_start: date_planned,
            date_planned_finished: date_finished,
            date_deadline: opt_timestamp(col(&headers, row, "date_deadline")),
            date_start: None,
            date_finished: None,
            bom_id: opt_u64(col(&headers, row, "bom_id")),
            routing_id: None,
            location_src_id,
            location_dest_id,
            location_finished_id: location_dest_id,
            warehouse_id,
            picking_type_id,
            proc_group_id: None,
            move_raw_ids: vec![],
            move_finished_ids: vec![],
            finished_move_line_ids: vec![],
            workorder_ids: vec![],
            is_planned: false,
            is_locked: false,
            is_delayed: false,
            delay_alert_date: None,
            procurement_group_id: None,
            reservation_state: "confirmed".to_string(),
            user_id: ctx.sender(),
            activity_user_id: None,
            activity_date_deadline: None,
            activity_state: None,
            activity_type_id: None,
            activity_summary: None,
            delay_alert: false,
            message_follower_ids: vec![],
            activity_ids: vec![],
            message_ids: vec![],
            is_workorder: false,
            mo_count: 0,
            move_raw_count: 0,
            move_finished_count: 0,
            check_to_done: false,
            unreserve_visible: false,
            post_visible: false,
            consumption: "allowed".to_string(),
            picking_ids: vec![],
            delivery_count: 0,
            confirm_cancel_backorder: false,
            components_availability: "".to_string(),
            components_availability_state: "".to_string(),
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import mrp_production: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}
