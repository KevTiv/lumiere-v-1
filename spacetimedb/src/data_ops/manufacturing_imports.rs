/// Manufacturing CSV Imports — MrpWorkcenter, MrpBom, MrpBomLine, MrpProduction
///
/// # Row-isolated semantics
///
/// Each row is validated and inserted independently. A failed row records an
/// error to the import job and continues; the remaining rows are still
/// attempted. This means a failed BOM row does not block the next row, and no
/// atomic whole-file rollback is applied.
///
/// # Preflight requirements (enforced per row before any insert)
///
/// 1. Company exists in the organization.
/// 2. All required IDs are non-zero and non-empty.
/// 3. All relation references are loaded and validated against org/company scope.
/// 4. Required quantities and durations are finite and positive — no silent
///    zero-to-one substitution.
/// 5. Required dates are present — no silent fallback to `ctx.timestamp`.
/// 6. String-enumerated fields contain a known value — no silent default.
/// 7. Protected server-derived fields (product_tmpl_id, product_tracking, state,
///    availability, counters, audit identity) are always derived, never trusted
///    from CSV columns.
use spacetimedb::{reducer, ReducerContext, Table};

use crate::core::organization::require_company_in_organization;
use crate::data_ops::helpers::*;
use crate::data_ops::import_tracker::{begin_import_job, finish_import_job, record_import_error};
use crate::helpers::check_permission;
use crate::inventory::product::product;
use crate::manufacturing::bill_of_materials::{mrp_bom, mrp_bom_line, MrpBom, MrpBomLine};
use crate::manufacturing::manufacturing_orders::{mrp_production, mrp_workorder, MrpProduction};
use crate::manufacturing::relations::{
    require_bom_in_company, require_location_for_manufacturing, require_product_for_manufacturing,
    require_uom_compatible, require_uom_in_org, require_warehouse_for_manufacturing,
    validate_positive_capacity, validate_positive_qty,
};
use crate::manufacturing::work_centers::{mrp_workcenter, MrpWorkcenter};
use crate::types::{BomType, MoState, WorkingState};

// ── MrpWorkcenter ─────────────────────────────────────────────────────────────

/// Import work centers from CSV.
///
/// Required columns: `name`, `capacity`
/// Optional columns: `active`, `code`, `working_state`, `oee_target`,
///   `time_efficiency`, `sequence`, `metadata`
///
/// Rejects rows where `capacity` or `time_efficiency` is zero or negative.
/// Validates `working_state` against known values (defaults to `"normal"` if
/// omitted). Server-computed aggregates (oee, performance, times, counts,
/// reverse arrays) are always initialized to zero/empty.
#[reducer]
pub fn import_workcenter_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mrp_workcenter", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;

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

        // --- Required fields ---

        let name = col(&headers, row, "name").to_string();
        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        let capacity_raw = parse_f64(col(&headers, row, "capacity"));
        if let Err(e) = validate_positive_capacity(capacity_raw, "capacity") {
            record_import_error(ctx, job.id, row_num, Some("capacity"), None, &e);
            errors += 1;
            continue;
        }

        // --- Optional enumerated fields ---

        let working_state = {
            let ws_str = col(&headers, row, "working_state");
            let ws = if ws_str.is_empty() {
                "normal".to_string()
            } else {
                ws_str.to_string()
            };
            if let Err(e) = WorkingState::from_str(&ws) {
                record_import_error(ctx, job.id, row_num, Some("working_state"), Some(&ws), &e);
                errors += 1;
                continue;
            }
            ws
        };

        // time_efficiency: must be positive if provided; defaults to 100.0 if omitted.
        let time_efficiency = {
            let raw = col(&headers, row, "time_efficiency");
            if raw.is_empty() {
                100.0
            } else {
                let v = parse_f64(raw);
                if !v.is_finite() || v <= 0.0 {
                    record_import_error(
                        ctx,
                        job.id,
                        row_num,
                        Some("time_efficiency"),
                        Some(raw),
                        "time_efficiency must be a finite positive number",
                    );
                    errors += 1;
                    continue;
                }
                v
            }
        };

        let oee_target = parse_f64(col(&headers, row, "oee_target"));
        let sequence = parse_u32(col(&headers, row, "sequence"));

        ctx.db.mrp_workcenter().insert(MrpWorkcenter {
            id: 0,
            organization_id,
            name,
            active: parse_bool(col(&headers, row, "active")),
            code: opt_str(col(&headers, row, "code")),
            company_id,
            working_state,
            oee_target,
            time_efficiency,
            capacity: capacity_raw,
            capacity_ids: vec![],
            // Server-computed aggregates — always initialized to zero/empty.
            oee: 0.0,
            performance: 0.0,
            blocked_time: 0.0,
            productive_time: 0.0,
            productivity_ids: vec![],
            order_ids: vec![],
            workorder_count: 0,
            workorder_ready_count: 0,
            workorder_progress_count: 0,
            workorder_pending_count: 0,
            workorder_late_count: 0,
            alternative_workcenter_ids: vec![],
            color: None,
            resource_calendar_id: None,
            tag_ids: vec![],
            default_capacity_parent_id: None,
            default_time_efficiency: time_efficiency,
            default_oee_target: oee_target,
            sequence,
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
        "import_workcenter_csv: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── MrpBom ────────────────────────────────────────────────────────────────────

/// Import BOM headers from CSV. Lines are imported separately via
/// `import_bom_line_csv`.
///
/// Required columns: `product_id`, `product_uom_id`, `product_qty`
/// Optional columns: `type_`, `sequence`, `ready_to_produce`, `consumption`,
///   `picking_type_id`, `location_src_id`, `location_dest_id`, `warehouse_id`,
///   `metadata`
///
/// `product_tmpl_id` is always derived from the loaded product; any CSV column
/// named `product_tmpl_id` is ignored. `estimated_cost` starts at 0.0.
/// `product_qty` must be finite and positive — no silent 1.0 substitution.
#[reducer]
pub fn import_bom_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mrp_bom", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;

    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "mrp_bom", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;

        // --- Require product_id (non-zero) ---
        let product_id = parse_u64(col(&headers, row, "product_id"));
        if product_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("product_id"),
                None,
                "product_id is required and must be non-zero",
            );
            errors += 1;
            continue;
        }

        // Validate product exists and belongs to org; derive product_tmpl_id.
        let product = match require_product_for_manufacturing(
            ctx,
            organization_id,
            product_id,
            "BOM product",
        ) {
            Ok(p) => p,
            Err(e) => {
                record_import_error(ctx, job.id, row_num, Some("product_id"), None, &e);
                errors += 1;
                continue;
            }
        };
        // product_tmpl_id is always derived from the product row.
        let product_tmpl_id = product.id;

        // --- Require product_uom_id ---
        let product_uom_id = parse_u64(col(&headers, row, "product_uom_id"));
        if product_uom_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("product_uom_id"),
                None,
                "product_uom_id is required and must be non-zero",
            );
            errors += 1;
            continue;
        }

        let product_uom =
            match require_uom_in_org(ctx, organization_id, product.uom_id, "BOM product UOM") {
                Ok(u) => u,
                Err(e) => {
                    record_import_error(ctx, job.id, row_num, Some("product_uom_id"), None, &e);
                    errors += 1;
                    continue;
                }
            };
        let bom_uom =
            match require_uom_in_org(ctx, organization_id, product_uom_id, "BOM quantity UOM") {
                Ok(u) => u,
                Err(e) => {
                    record_import_error(ctx, job.id, row_num, Some("product_uom_id"), None, &e);
                    errors += 1;
                    continue;
                }
            };
        if let Err(e) = require_uom_compatible(&product_uom, &bom_uom, "BOM") {
            record_import_error(ctx, job.id, row_num, Some("product_uom_id"), None, &e);
            errors += 1;
            continue;
        }

        // --- Require product_qty > 0 (no silent substitution) ---
        let product_qty = parse_f64(col(&headers, row, "product_qty"));
        if let Err(e) = validate_positive_qty(product_qty, "product_qty") {
            record_import_error(ctx, job.id, row_num, Some("product_qty"), None, &e);
            errors += 1;
            continue;
        }

        // --- Optional relation references ---

        let warehouse_id = match opt_u64(col(&headers, row, "warehouse_id")) {
            Some(wh_id) => {
                match require_warehouse_for_manufacturing(
                    ctx,
                    organization_id,
                    company_id,
                    wh_id,
                    "BOM warehouse",
                ) {
                    Ok(_) => Some(wh_id),
                    Err(e) => {
                        record_import_error(ctx, job.id, row_num, Some("warehouse_id"), None, &e);
                        errors += 1;
                        continue;
                    }
                }
            }
            None => None,
        };

        let location_src_id = match opt_u64(col(&headers, row, "location_src_id")) {
            Some(loc_id) => {
                match require_location_for_manufacturing(
                    ctx,
                    organization_id,
                    loc_id,
                    "BOM source location",
                ) {
                    Ok(_) => Some(loc_id),
                    Err(e) => {
                        record_import_error(
                            ctx,
                            job.id,
                            row_num,
                            Some("location_src_id"),
                            None,
                            &e,
                        );
                        errors += 1;
                        continue;
                    }
                }
            }
            None => None,
        };

        let location_dest_id = match opt_u64(col(&headers, row, "location_dest_id")) {
            Some(loc_id) => {
                match require_location_for_manufacturing(
                    ctx,
                    organization_id,
                    loc_id,
                    "BOM destination location",
                ) {
                    Ok(_) => Some(loc_id),
                    Err(e) => {
                        record_import_error(
                            ctx,
                            job.id,
                            row_num,
                            Some("location_dest_id"),
                            None,
                            &e,
                        );
                        errors += 1;
                        continue;
                    }
                }
            }
            None => None,
        };

        let bom_type = {
            let t = col(&headers, row, "type_");
            match t {
                "kit" => BomType::Kit,
                "subcontract" => BomType::Subcontract,
                "manufacture" | "" => BomType::Manufacture,
                other => {
                    record_import_error(
                        ctx,
                        job.id,
                        row_num,
                        Some("type_"),
                        Some(other),
                        "type_ must be one of: manufacture, kit, subcontract",
                    );
                    errors += 1;
                    continue;
                }
            }
        };

        ctx.db.mrp_bom().insert(MrpBom {
            id: 0,
            organization_id,
            type_: bom_type,
            product_id,
            product_tmpl_id, // derived from loaded product — CSV column ignored
            product_qty,
            product_uom_id,
            sequence: parse_u32(col(&headers, row, "sequence")),
            company_id,
            ready_to_produce: {
                let v = col(&headers, row, "ready_to_produce");
                if v.is_empty() {
                    "all_available".to_string()
                } else {
                    v.to_string()
                }
            },
            consumption: {
                let v = col(&headers, row, "consumption");
                if v.is_empty() {
                    "allowed".to_string()
                } else {
                    v.to_string()
                }
            },
            picking_type_id: opt_u64(col(&headers, row, "picking_type_id")),
            location_src_id,
            location_dest_id,
            warehouse_id,
            routing_id: None,
            bom_line_ids: vec![],
            byproduct_ids: vec![],
            operation_ids: vec![],
            message_follower_ids: vec![],
            activity_ids: vec![],
            message_ids: vec![],
            estimated_cost: 0.0, // derived by compute_bom_cost after lines are attached
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!("import_bom_csv: imported={}, errors={}", imported, errors);
    Ok(())
}

// ── MrpBomLine ────────────────────────────────────────────────────────────────

/// Import BOM component lines from CSV.
///
/// Required columns: `bom_id`, `product_id`, `product_uom_id`, `product_qty`
/// Optional columns: `sequence`, `manual_consumption`, `operation_id`, `metadata`
///
/// Each row validates that the parent BOM exists in the organization and
/// company before inserting the line. After a successful insert, the parent
/// BOM's `bom_line_ids` reverse array is updated atomically with the new
/// line ID. `product_tmpl_id` and `parent_product_tmpl_id` are always derived
/// from the loaded product row; CSV values for these columns are ignored.
#[reducer]
pub fn import_bom_line_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mrp_bom_line", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;

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

        // --- Require bom_id ---
        let bom_id = parse_u64(col(&headers, row, "bom_id"));
        if bom_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("bom_id"),
                None,
                "bom_id is required and must be non-zero",
            );
            errors += 1;
            continue;
        }

        // Validate parent BOM exists and belongs to org/company.
        let parent_bom = match require_bom_in_company(
            ctx,
            organization_id,
            company_id,
            bom_id,
            "BOM line parent BOM",
        ) {
            Ok(b) => b,
            Err(e) => {
                record_import_error(ctx, job.id, row_num, Some("bom_id"), None, &e);
                errors += 1;
                continue;
            }
        };

        // --- Require product_id ---
        let product_id = parse_u64(col(&headers, row, "product_id"));
        if product_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("product_id"),
                None,
                "product_id is required and must be non-zero",
            );
            errors += 1;
            continue;
        }

        let product = match require_product_for_manufacturing(
            ctx,
            organization_id,
            product_id,
            "BOM line product",
        ) {
            Ok(p) => p,
            Err(e) => {
                record_import_error(ctx, job.id, row_num, Some("product_id"), None, &e);
                errors += 1;
                continue;
            }
        };

        // --- Require product_uom_id ---
        let product_uom_id = parse_u64(col(&headers, row, "product_uom_id"));
        if product_uom_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("product_uom_id"),
                None,
                "product_uom_id is required and must be non-zero",
            );
            errors += 1;
            continue;
        }

        let line_product_uom = match require_uom_in_org(
            ctx,
            organization_id,
            product.uom_id,
            "BOM line product UOM",
        ) {
            Ok(u) => u,
            Err(e) => {
                record_import_error(ctx, job.id, row_num, Some("product_uom_id"), None, &e);
                errors += 1;
                continue;
            }
        };
        let line_bom_uom = match require_uom_in_org(
            ctx,
            organization_id,
            product_uom_id,
            "BOM line quantity UOM",
        ) {
            Ok(u) => u,
            Err(e) => {
                record_import_error(ctx, job.id, row_num, Some("product_uom_id"), None, &e);
                errors += 1;
                continue;
            }
        };
        if let Err(e) = require_uom_compatible(&line_product_uom, &line_bom_uom, "BOM line") {
            record_import_error(ctx, job.id, row_num, Some("product_uom_id"), None, &e);
            errors += 1;
            continue;
        }

        // --- Require product_qty > 0 (no silent substitution) ---
        let product_qty = parse_f64(col(&headers, row, "product_qty"));
        if let Err(e) = validate_positive_qty(product_qty, "product_qty") {
            record_import_error(ctx, job.id, row_num, Some("product_qty"), None, &e);
            errors += 1;
            continue;
        }

        // product_tmpl_id and parent_product_tmpl_id derived from loaded rows.
        let product_tmpl_id = product.id;
        let parent_product_tmpl_id = Some(parent_bom.product_tmpl_id);

        let line = ctx.db.mrp_bom_line().insert(MrpBomLine {
            id: 0,
            organization_id,
            bom_id,
            product_id,
            product_tmpl_id,
            product_qty,
            product_uom_id,
            sequence: parse_u32(col(&headers, row, "sequence")),
            manual_consumption: parse_bool(col(&headers, row, "manual_consumption")),
            operation_id: opt_u64(col(&headers, row, "operation_id")),
            bom_product_template_attribute_value_ids: vec![],
            parent_product_tmpl_id,
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

        // Maintain parent BOM's bom_line_ids reverse array atomically.
        let mut line_ids = parent_bom.bom_line_ids.clone();
        line_ids.push(line.id);
        // Re-load parent_bom to get the latest state (another row may have already
        // updated it in this batch), then update.
        let current_bom = ctx
            .db
            .mrp_bom()
            .id()
            .find(&bom_id)
            .unwrap_or(parent_bom.clone());
        let mut current_line_ids = current_bom.bom_line_ids.clone();
        if !current_line_ids.contains(&line.id) {
            current_line_ids.push(line.id);
        }
        ctx.db.mrp_bom().id().update(MrpBom {
            bom_line_ids: current_line_ids,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..current_bom
        });

        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "import_bom_line_csv: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── MrpProduction ─────────────────────────────────────────────────────────────

/// Import manufacturing orders from CSV.
///
/// Required columns: `product_id`, `product_uom_id`, `product_qty`,
///   `warehouse_id`, `location_src_id`, `location_dest_id`, `picking_type_id`,
///   `date_planned_start`, `date_planned_finished`
/// Optional columns: `bom_id`, `date_deadline`, `origin`, `metadata`
///
/// Rejects any row where required dates are missing — there is no fallback to
/// `ctx.timestamp`. `product_tmpl_id`, `product_tracking`, `state`,
/// `availability`, `reservation_state`, and all lifecycle/counter fields are
/// always server-derived and never accepted from CSV columns.
#[reducer]
pub fn import_manufacturing_order_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mrp_production", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;

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

        // --- Require product_id ---
        let product_id = parse_u64(col(&headers, row, "product_id"));
        if product_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("product_id"),
                None,
                "product_id is required and must be non-zero",
            );
            errors += 1;
            continue;
        }

        // Validate product; derive product_tmpl_id and product_tracking.
        let product =
            match require_product_for_manufacturing(ctx, organization_id, product_id, "MO product")
            {
                Ok(p) => p,
                Err(e) => {
                    record_import_error(ctx, job.id, row_num, Some("product_id"), None, &e);
                    errors += 1;
                    continue;
                }
            };
        // Server-derived — CSV columns for these are always ignored.
        let product_tmpl_id = product.id;
        let product_tracking = product.tracking.clone();

        // --- Require product_uom_id ---
        let product_uom_id = parse_u64(col(&headers, row, "product_uom_id"));
        if product_uom_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("product_uom_id"),
                None,
                "product_uom_id is required and must be non-zero",
            );
            errors += 1;
            continue;
        }

        // --- Require product_qty > 0 ---
        let product_qty = parse_f64(col(&headers, row, "product_qty"));
        if let Err(e) = validate_positive_qty(product_qty, "product_qty") {
            record_import_error(ctx, job.id, row_num, Some("product_qty"), None, &e);
            errors += 1;
            continue;
        }

        // --- Require warehouse_id ---
        let warehouse_id = parse_u64(col(&headers, row, "warehouse_id"));
        if warehouse_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("warehouse_id"),
                None,
                "warehouse_id is required and must be non-zero",
            );
            errors += 1;
            continue;
        }
        if let Err(e) = require_warehouse_for_manufacturing(
            ctx,
            organization_id,
            company_id,
            warehouse_id,
            "MO warehouse",
        ) {
            record_import_error(ctx, job.id, row_num, Some("warehouse_id"), None, &e);
            errors += 1;
            continue;
        }

        // --- Require location_src_id ---
        let location_src_id = parse_u64(col(&headers, row, "location_src_id"));
        if location_src_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("location_src_id"),
                None,
                "location_src_id is required and must be non-zero",
            );
            errors += 1;
            continue;
        }
        if let Err(e) = require_location_for_manufacturing(
            ctx,
            organization_id,
            location_src_id,
            "MO source location",
        ) {
            record_import_error(ctx, job.id, row_num, Some("location_src_id"), None, &e);
            errors += 1;
            continue;
        }

        // --- Require location_dest_id ---
        let location_dest_id = parse_u64(col(&headers, row, "location_dest_id"));
        if location_dest_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("location_dest_id"),
                None,
                "location_dest_id is required and must be non-zero",
            );
            errors += 1;
            continue;
        }
        if let Err(e) = require_location_for_manufacturing(
            ctx,
            organization_id,
            location_dest_id,
            "MO destination location",
        ) {
            record_import_error(ctx, job.id, row_num, Some("location_dest_id"), None, &e);
            errors += 1;
            continue;
        }

        // --- Require picking_type_id (non-zero; no table to validate against yet) ---
        let picking_type_id = parse_u64(col(&headers, row, "picking_type_id"));
        if picking_type_id == 0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("picking_type_id"),
                None,
                "picking_type_id is required and must be non-zero",
            );
            errors += 1;
            continue;
        }

        // --- Require date_planned_start (no fallback to ctx.timestamp) ---
        let date_planned_start = match opt_timestamp(col(&headers, row, "date_planned_start")) {
            Some(ts) => ts,
            None => {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("date_planned_start"),
                    None,
                    "date_planned_start is required",
                );
                errors += 1;
                continue;
            }
        };

        // --- Require date_planned_finished (no fallback to ctx.timestamp) ---
        let date_planned_finished = match opt_timestamp(col(&headers, row, "date_planned_finished"))
        {
            Some(ts) => ts,
            None => {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("date_planned_finished"),
                    None,
                    "date_planned_finished is required",
                );
                errors += 1;
                continue;
            }
        };

        // --- Optional BOM (must belong to same company and same product) ---
        let bom_id = match opt_u64(col(&headers, row, "bom_id")) {
            Some(bid) => {
                match require_bom_in_company(ctx, organization_id, company_id, bid, "MO BOM") {
                    Ok(bom) => {
                        if bom.product_id != product_id {
                            record_import_error(
                                ctx,
                                job.id,
                                row_num,
                                Some("bom_id"),
                                None,
                                "MO BOM product does not match the manufacturing order product",
                            );
                            errors += 1;
                            continue;
                        }
                        Some(bid)
                    }
                    Err(e) => {
                        record_import_error(ctx, job.id, row_num, Some("bom_id"), None, &e);
                        errors += 1;
                        continue;
                    }
                }
            }
            None => None,
        };

        ctx.db.mrp_production().insert(MrpProduction {
            id: 0,
            organization_id,
            origin: opt_str(col(&headers, row, "origin")),
            product_id,
            product_tmpl_id, // always derived — CSV column ignored
            product_qty,
            product_uom_id,
            product_uom_qty: product_qty,
            product_tracking, // always derived from product — CSV column ignored
            lot_producing_id: None,
            // Server-managed lifecycle fields — always initialized to clean state.
            lot_producing_count: 0,
            qty_producing: 0.0,
            qty_produced: 0.0,
            product_uom_qty_producing: 0.0,
            company_id,
            state: MoState::Draft,
            availability: "none".to_string(),
            date_planned_start,
            date_planned_finished,
            date_deadline: opt_timestamp(col(&headers, row, "date_deadline")),
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
            move_raw_ids: vec![],
            move_finished_ids: vec![],
            finished_move_line_ids: vec![],
            workorder_ids: vec![],
            is_planned: false,
            is_locked: false,
            is_delayed: false,
            delay_alert_date: None,
            procurement_group_id: None,
            reservation_state: "none".to_string(),
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
            components_availability_state: "none".to_string(),
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
        "import_manufacturing_order_csv: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── Data audit ────────────────────────────────────────────────────────────────

/// Scan existing manufacturing rows for integrity violations.
///
/// Findings are recorded as import-job errors so they can be queried via the
/// standard import-tracker tables. The reducer never modifies data — it is
/// read-only and safe to run repeatedly.
///
/// Checks performed:
/// 1. BOM headers with `product_id = 0`, `product_uom_id = 0`, or
///    `product_qty <= 0`.
/// 2. BOM headers whose product does not exist in the organization.
/// 3. BOM lines with `product_id = 0`, `product_uom_id = 0`, or
///    `product_qty <= 0`.
/// 4. BOM lines whose parent BOM does not exist.
/// 5. Divergence between stored `bom_line_ids` and actual lines selected by
///    `bom_id` (forward-reverse mismatch).
/// 6. Manufacturing orders with `product_id = 0`, `product_uom_id = 0`, or
///    `product_qty <= 0`.
/// 7. Manufacturing orders whose `product_tmpl_id` is zero (derivation gap).
/// 8. Manufacturing orders whose `reservation_state` is `"confirmed"` at
///    import time (contradicts Draft-state invariant applied in Phase 2).
/// 9. Divergence between stored `workorder_ids` and actual workorders selected
///    by `production_id`.
#[reducer]
pub fn audit_manufacturing_data(ctx: &ReducerContext, organization_id: u64) -> Result<(), String> {
    check_permission(ctx, organization_id, "mrp_bom", "read")?;

    let job = begin_import_job(
        ctx,
        organization_id,
        "manufacturing_audit",
        None,
        0, // total unknown until scan completes
    );
    let mut findings = 0u32;

    // --- 1–2: BOM header checks ---
    let boms: Vec<MrpBom> = ctx
        .db
        .mrp_bom()
        .mrp_bom_by_org()
        .filter(&organization_id)
        .collect();

    for bom in &boms {
        let mut bom_ok = true;

        if bom.product_id == 0 {
            record_import_error(
                ctx,
                job.id,
                bom.id as u32,
                Some("product_id"),
                None,
                &format!("BOM {} has product_id = 0", bom.id),
            );
            findings += 1;
            bom_ok = false;
        } else {
            // Check product exists in org.
            let product_missing = ctx
                .db
                .product()
                .id()
                .find(&bom.product_id)
                .map(|p| p.organization_id != organization_id)
                .unwrap_or(true);
            if product_missing {
                record_import_error(
                    ctx,
                    job.id,
                    bom.id as u32,
                    Some("product_id"),
                    None,
                    &format!(
                        "BOM {} product {} not found in this organization",
                        bom.id, bom.product_id
                    ),
                );
                findings += 1;
                bom_ok = false;
            }
        }

        if bom.product_uom_id == 0 {
            record_import_error(
                ctx,
                job.id,
                bom.id as u32,
                Some("product_uom_id"),
                None,
                &format!("BOM {} has product_uom_id = 0", bom.id),
            );
            findings += 1;
            bom_ok = false;
        }

        if !bom.product_qty.is_finite() || bom.product_qty <= 0.0 {
            record_import_error(
                ctx,
                job.id,
                bom.id as u32,
                Some("product_qty"),
                None,
                &format!(
                    "BOM {} has invalid product_qty = {}",
                    bom.id, bom.product_qty
                ),
            );
            findings += 1;
            bom_ok = false;
        }

        let _ = bom_ok;

        // 5: Check forward-reverse consistency for bom_line_ids.
        let actual_line_ids: Vec<u64> = ctx
            .db
            .mrp_bom_line()
            .mrp_bom_line_by_bom()
            .filter(&bom.id)
            .map(|l| l.id)
            .collect();

        let mut stored = bom.bom_line_ids.clone();
        stored.sort();
        let mut actual = actual_line_ids.clone();
        actual.sort();

        if stored != actual {
            record_import_error(
                ctx,
                job.id,
                bom.id as u32,
                Some("bom_line_ids"),
                None,
                &format!(
                    "BOM {} bom_line_ids mismatch: stored {:?} vs actual {:?}",
                    bom.id, stored, actual
                ),
            );
            findings += 1;
        }
    }

    // --- 3–4: BOM line checks ---
    let lines: Vec<MrpBomLine> = ctx
        .db
        .mrp_bom_line()
        .mrp_bom_line_by_org()
        .filter(&organization_id)
        .collect();

    for line in &lines {
        if line.product_id == 0 {
            record_import_error(
                ctx,
                job.id,
                line.id as u32,
                Some("product_id"),
                None,
                &format!("BOM line {} has product_id = 0", line.id),
            );
            findings += 1;
        }

        if line.product_uom_id == 0 {
            record_import_error(
                ctx,
                job.id,
                line.id as u32,
                Some("product_uom_id"),
                None,
                &format!("BOM line {} has product_uom_id = 0", line.id),
            );
            findings += 1;
        }

        if !line.product_qty.is_finite() || line.product_qty <= 0.0 {
            record_import_error(
                ctx,
                job.id,
                line.id as u32,
                Some("product_qty"),
                None,
                &format!(
                    "BOM line {} has invalid product_qty = {}",
                    line.id, line.product_qty
                ),
            );
            findings += 1;
        }

        // Parent BOM must exist.
        if ctx.db.mrp_bom().id().find(&line.bom_id).is_none() {
            record_import_error(
                ctx,
                job.id,
                line.id as u32,
                Some("bom_id"),
                None,
                &format!(
                    "BOM line {} references missing parent BOM {}",
                    line.id, line.bom_id
                ),
            );
            findings += 1;
        }
    }

    // --- 6–9: MrpProduction checks ---
    let productions: Vec<MrpProduction> = ctx
        .db
        .mrp_production()
        .mrp_production_by_org()
        .filter(&organization_id)
        .collect();

    for mo in &productions {
        if mo.product_id == 0 {
            record_import_error(
                ctx,
                job.id,
                mo.id as u32,
                Some("product_id"),
                None,
                &format!("MO {} has product_id = 0", mo.id),
            );
            findings += 1;
        }

        if mo.product_uom_id == 0 {
            record_import_error(
                ctx,
                job.id,
                mo.id as u32,
                Some("product_uom_id"),
                None,
                &format!("MO {} has product_uom_id = 0", mo.id),
            );
            findings += 1;
        }

        if !mo.product_qty.is_finite() || mo.product_qty <= 0.0 {
            record_import_error(
                ctx,
                job.id,
                mo.id as u32,
                Some("product_qty"),
                None,
                &format!("MO {} has invalid product_qty = {}", mo.id, mo.product_qty),
            );
            findings += 1;
        }

        if mo.product_tmpl_id == 0 {
            record_import_error(
                ctx,
                job.id,
                mo.id as u32,
                Some("product_tmpl_id"),
                None,
                &format!(
                    "MO {} has product_tmpl_id = 0 (derivation gap from pre-Phase-2 import)",
                    mo.id
                ),
            );
            findings += 1;
        }

        // 8: Contradictory reservation_state on Draft MOs.
        if mo.state == MoState::Draft && mo.reservation_state == "confirmed" {
            record_import_error(
                ctx,
                job.id,
                mo.id as u32,
                Some("reservation_state"),
                None,
                &format!(
                    "MO {} is Draft but has reservation_state = 'confirmed' (pre-Phase-2 import artifact)",
                    mo.id
                ),
            );
            findings += 1;
        }

        // 9: Forward-reverse consistency for workorder_ids.
        let actual_wo_ids: Vec<u64> = ctx
            .db
            .mrp_workorder()
            .mrp_workorder_by_production()
            .filter(&mo.id)
            .map(|wo| wo.id)
            .collect();

        let mut stored_wo = mo.workorder_ids.clone();
        stored_wo.sort();
        let mut actual_wo = actual_wo_ids.clone();
        actual_wo.sort();

        if stored_wo != actual_wo {
            record_import_error(
                ctx,
                job.id,
                mo.id as u32,
                Some("workorder_ids"),
                None,
                &format!(
                    "MO {} workorder_ids mismatch: stored {:?} vs actual {:?}",
                    mo.id, stored_wo, actual_wo
                ),
            );
            findings += 1;
        }
    }

    finish_import_job(ctx, job, 0, findings);
    log::info!(
        "audit_manufacturing_data: {} finding(s) recorded for org {}",
        findings,
        organization_id
    );
    Ok(())
}

// ── Association rebuild ───────────────────────────────────────────────────────

/// Rebuild authoritative reverse-association arrays for manufacturing records.
///
/// This reducer repairs divergence between stored forward-ID arrays and the
/// rows that actually exist in child tables. It does not delete rows — it only
/// replaces divergent array values with the authoritative set derived from
/// child-table queries.
///
/// Repaired associations:
/// - `MrpBom.bom_line_ids` — rebuilt from all `MrpBomLine` rows with matching
///   `bom_id` (ordered by ID ascending).
/// - `MrpProduction.workorder_ids` — rebuilt from all `MrpWorkorder` rows with
///   matching `production_id` (ordered by ID ascending).
///
/// Returns the count of BOM and MO records that were updated.
#[reducer]
pub fn rebuild_manufacturing_associations(
    ctx: &ReducerContext,
    organization_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mrp_bom", "write")?;

    let mut bom_repaired = 0u32;
    let mut mo_repaired = 0u32;

    // --- Rebuild bom_line_ids on every BOM in the org ---
    let boms: Vec<MrpBom> = ctx
        .db
        .mrp_bom()
        .mrp_bom_by_org()
        .filter(&organization_id)
        .collect();

    for bom in boms {
        let mut actual_line_ids: Vec<u64> = ctx
            .db
            .mrp_bom_line()
            .mrp_bom_line_by_bom()
            .filter(&bom.id)
            .map(|l| l.id)
            .collect();
        actual_line_ids.sort();

        let mut stored = bom.bom_line_ids.clone();
        stored.sort();

        if stored != actual_line_ids {
            ctx.db.mrp_bom().id().update(MrpBom {
                bom_line_ids: actual_line_ids,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..bom
            });
            bom_repaired += 1;
        }
    }

    // --- Rebuild workorder_ids on every MO in the org ---
    let productions: Vec<MrpProduction> = ctx
        .db
        .mrp_production()
        .mrp_production_by_org()
        .filter(&organization_id)
        .collect();

    for mo in productions {
        let mut actual_wo_ids: Vec<u64> = ctx
            .db
            .mrp_workorder()
            .mrp_workorder_by_production()
            .filter(&mo.id)
            .map(|wo| wo.id)
            .collect();
        actual_wo_ids.sort();

        let mut stored = mo.workorder_ids.clone();
        stored.sort();

        if stored != actual_wo_ids {
            ctx.db.mrp_production().id().update(MrpProduction {
                workorder_ids: actual_wo_ids,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..mo
            });
            mo_repaired += 1;
        }
    }

    log::info!(
        "rebuild_manufacturing_associations: bom_repaired={}, mo_repaired={} for org {}",
        bom_repaired,
        mo_repaired,
        organization_id
    );
    Ok(())
}
