//! COV-07h: one persisted BOM-to-close proof with distinct stock identities.
//! Fixture data supplies opening stock; every manufacturing effect uses reducers.

use std::collections::HashSet;
use std::time::Duration;

use spacetimedb::{ReducerContext, Table};

use crate::core::persistence::{
    organization_commit, organization_commit_cursor, organization_row_change,
};

use crate::inventory::product::{create_product, product, CreateProductParams};
use crate::inventory::quality::{
    create_workorder_quality_check, pass_quality_check, quality_check,
};
use crate::inventory::stock::{stock_move, stock_quant, StockQuant};
use crate::inventory::warehouse::warehouse;
use crate::manufacturing::bill_of_materials::{
    create_bom, create_bom_byproduct, create_routing_workcenter, mrp_bom, mrp_bom_byproduct,
    mrp_bom_line, mrp_routing_workcenter, BomLineInput, CreateBomByproductParams, CreateBomParams,
    CreateRoutingWorkcenterParams,
};
use crate::manufacturing::costing::{
    configure_workcenter_cost_rate, mrp_production_cost, mrp_productivity_cost,
};
use crate::manufacturing::manufacturing_orders::{
    confirm_manufacturing_order, consume_mo_materials, create_manufacturing_order,
    create_workorder, finish_manufacturing_order, finish_workorder, mrp_production, mrp_workorder,
    produce_manufacturing_order, start_manufacturing_order, start_workorder,
    CreateMrpProductionParams, CreateWorkorderParams,
};
use crate::manufacturing::work_centers::{
    create_workcenter, log_workcenter_productivity, mrp_workcenter, mrp_workcenter_productivity,
    CreateWorkcenterParams, CreateWorkcenterProductivityParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{BomType, MoState, WorkorderState};

fn exact(actual: f64, expected: f64, label: &str) -> Result<(), String> {
    if !actual.is_finite() || (actual - expected).abs() > 1e-9 {
        return Err(format!("{label}: expected {expected}, got {actual}"));
    }
    Ok(())
}

/// Capture owned effects and stock values so rejected commands and replay are
/// checked for side effects, rather than only checking their return values.
fn snapshot(ctx: &ReducerContext, organization_id: u64) -> Vec<String> {
    let mut rows = Vec::new();
    if let Some(cursor) = ctx
        .db
        .organization_commit_cursor()
        .organization_id()
        .find(&organization_id)
    {
        rows.push(serde_json::json!(["commit_cursor", cursor.next_sequence]).to_string());
    }
    for commit in ctx
        .db
        .organization_commit()
        .organization_commit_by_organization()
        .filter(&organization_id)
    {
        rows.push(
            serde_json::json!([
                "commit",
                commit.id,
                commit.operation_id,
                commit.row_change_count,
                commit.checksum
            ])
            .to_string(),
        );
    }
    for change in ctx
        .db
        .organization_row_change()
        .organization_row_change_by_organization()
        .filter(&organization_id)
    {
        rows.push(
            serde_json::json!([
                "row_change",
                change.id,
                change.table_name,
                change.row_identity_json,
                change.change_kind,
                change.row_json,
                change.checksum
            ])
            .to_string(),
        );
    }
    for mo in ctx
        .db
        .mrp_production()
        .mrp_production_by_org()
        .filter(&organization_id)
    {
        rows.push(
            serde_json::json!([
                "mo",
                mo.id,
                format!("{:?}", mo.state),
                mo.qty_produced,
                mo.qty_producing,
                mo.move_raw_ids,
                mo.move_raw_count,
                mo.move_finished_ids,
                mo.move_finished_count,
                mo.workorder_ids,
                mo.date_finished
                    .map(|date| date.to_micros_since_unix_epoch())
            ])
            .to_string(),
        );
    }
    for mv in ctx
        .db
        .stock_move()
        .iter()
        .filter(|row| row.organization_id == organization_id)
    {
        rows.push(
            serde_json::json!([
                "move",
                mv.id,
                mv.company_id,
                mv.production_id,
                mv.product_id,
                mv.product_uom,
                mv.location_id,
                mv.location_dest_id,
                mv.product_uom_qty,
                mv.quantity_done,
                mv.state,
                mv.is_done,
                mv.is_assigned,
                mv.cost_share,
                mv.price_unit,
                mv.reference,
                mv.metadata
            ])
            .to_string(),
        );
    }
    for quant in ctx
        .db
        .stock_quant()
        .iter()
        .filter(|row| row.organization_id == organization_id)
    {
        rows.push(
            serde_json::json!([
                "quant",
                quant.id,
                quant.company_id,
                quant.product_id,
                quant.location_id,
                quant.lot_id,
                quant.package_id,
                quant.owner_id,
                quant.quantity,
                quant.available_quantity,
                quant.reserved_quantity,
                quant.cost,
                quant.value,
                quant.inventory_quantity,
                quant.accounting_entry_ids
            ])
            .to_string(),
        );
    }
    for wo in ctx
        .db
        .mrp_workorder()
        .iter()
        .filter(|row| row.organization_id == organization_id)
    {
        rows.push(
            serde_json::json!([
                "workorder",
                wo.id,
                wo.company_id,
                wo.production_id,
                wo.workcenter_id,
                wo.operation_id,
                wo.blocked_by_workorder_id,
                format!("{:?}", wo.state),
                wo.duration,
                wo.progress,
                wo.time_ids,
                wo.check_ids,
                wo.is_user_working,
                wo.is_produced,
                wo.quality_state,
                wo.quality_check_todo,
                wo.quality_check_fail
            ])
            .to_string(),
        );
    }
    for row in ctx
        .db
        .mrp_workcenter_productivity()
        .iter()
        .filter(|row| row.organization_id == organization_id)
    {
        rows.push(
            serde_json::json!([
                "productivity",
                row.id,
                row.company_id,
                row.workorder_id,
                row.workcenter_id,
                row.duration,
                row.date_end.map(|date| date.to_micros_since_unix_epoch())
            ])
            .to_string(),
        );
    }
    for row in ctx
        .db
        .quality_check()
        .iter()
        .filter(|row| row.organization_id == organization_id)
    {
        rows.push(
            serde_json::json!([
                "quality",
                row.id,
                row.company_id,
                row.workorder_id,
                row.production_id,
                row.product_id,
                row.qty_tested,
                row.status,
                row.quality_state,
                row.is_failed
            ])
            .to_string(),
        );
    }
    for row in ctx
        .db
        .mrp_workcenter()
        .mrp_workcenter_by_org()
        .filter(&organization_id)
    {
        rows.push(
            serde_json::json!([
                "center",
                row.id,
                row.order_ids,
                row.workorder_count,
                row.workorder_pending_count,
                row.workorder_progress_count,
                row.productivity_ids,
                row.productive_time
            ])
            .to_string(),
        );
    }
    for row in ctx
        .db
        .mrp_productivity_cost()
        .mrp_productivity_cost_by_org()
        .filter(&organization_id)
    {
        rows.push(
            serde_json::json!([
                "productivity_cost",
                row.productivity_id,
                row.company_id,
                row.production_id,
                row.workorder_id,
                row.workcenter_id,
                row.currency_id,
                row.duration_minutes,
                row.hourly_rate,
                row.configured,
                row.value
            ])
            .to_string(),
        );
    }
    for row in ctx
        .db
        .mrp_production_cost()
        .mrp_production_cost_by_org()
        .filter(&organization_id)
    {
        rows.push(
            serde_json::json!([
                "production_cost",
                row.production_id,
                row.company_id,
                row.currency_id,
                row.material_value,
                row.workcenter_value,
                row.total_value,
                row.inventory_value,
                row.variance_value,
                row.raw_move_ids,
                row.output_move_ids,
                row.productivity_cost_ids,
                row.account_move_id,
                row.account_move_line_ids
            ])
            .to_string(),
        );
    }
    rows.sort_unstable();
    rows
}

fn require_durable_row<T: spacetimedb_sats::Serialize + ?Sized>(
    ctx: &ReducerContext,
    organization_id: u64,
    production_id: u64,
    operation_id: &str,
    table: &str,
    identity: serde_json::Value,
    expected: &T,
) -> Result<(), String> {
    let correlation = format!("manufacturing-order:{production_id}:{operation_id}");
    let commit = ctx
        .db
        .organization_commit()
        .organization_commit_by_organization()
        .filter(&organization_id)
        .filter(|row| row.operation_id == operation_id && row.correlation_id == correlation)
        .max_by_key(|row| row.sequence)
        .ok_or_else(|| format!("missing durable commit for {operation_id}"))?;
    let changes: Vec<_> = ctx
        .db
        .organization_row_change()
        .organization_row_change_by_commit()
        .filter((&organization_id, &commit.sequence))
        .collect();
    if changes.len() != commit.row_change_count as usize {
        return Err(format!(
            "{operation_id}: durable envelope row count mismatch"
        ));
    }
    let matches: Vec<_> = changes
        .iter()
        .filter(|row| {
            row.table_name == table
                && serde_json::from_str::<serde_json::Value>(&row.row_identity_json)
                    .ok()
                    .as_ref()
                    == Some(&identity)
        })
        .collect();
    if matches.len() != 1 || matches[0].change_kind != "upsert" {
        return Err(format!(
            "{operation_id}: missing/duplicate full-row effect {table}/{identity}"
        ));
    }
    let persisted: serde_json::Value = serde_json::from_str(
        matches[0]
            .row_json
            .as_deref()
            .ok_or("durable upsert missing row JSON")?,
    )
    .map_err(|error| format!("durable row JSON: {error}"))?;
    let expected = serde_json::to_value(spacetimedb_sats::serde::SerdeWrapper::from_ref(expected))
        .map_err(|error| format!("expected durable row: {error}"))?;
    if persisted != expected {
        return Err(format!(
            "{operation_id}: durable full row differs from authoritative {table}/{identity}"
        ));
    }
    Ok(())
}

fn rejected_without_effect(
    ctx: &ReducerContext,
    organization_id: u64,
    label: &str,
    action: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let before = snapshot(ctx, organization_id);
    if action().is_ok() {
        return Err(format!("{label}: command unexpectedly succeeded"));
    }
    if snapshot(ctx, organization_id) != before {
        return Err(format!(
            "{label}: rejected command changed persisted effects"
        ));
    }
    Ok(())
}

fn quant(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    product_id: u64,
) -> Result<StockQuant, String> {
    let rows: Vec<_> = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&product_id)
        .filter(|row| {
            row.organization_id == fixture.organization_id
                && row.company_id == fixture.company_id
                && row.location_id == fixture.location_id
                && row.lot_id.is_none()
                && row.package_id.is_none()
                && row.owner_id.is_none()
        })
        .collect();
    if rows.len() != 1 {
        return Err(format!(
            "product {product_id}: expected one exact untracked quant, got {}",
            rows.len()
        ));
    }
    rows.into_iter()
        .next()
        .ok_or_else(|| "quant disappeared".to_string())
}

fn create_output_product(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    code: &str,
    cost: f64,
) -> Result<u64, String> {
    let raw = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("raw product missing")?;
    create_product(
        ctx,
        fixture.organization_id,
        CreateProductParams {
            name: code.to_string(),
            categ_id: raw.categ_id,
            type_: "storable".to_string(),
            uom_id: raw.uom_id,
            uom_po_id: raw.uom_po_id,
            standard_price: cost,
            list_price: cost + 5.0,
            currency_id: fixture.currency_id,
            default_code: Some(code.to_string()),
            barcode: None,
            description: None,
            sale_ok: Some(false),
            purchase_ok: Some(false),
            display_name: None,
            cost_method: None,
            valuation: None,
            volume: None,
            weight: None,
            can_be_expensed: None,
            available_in_pos: None,
            invoicing_policy: None,
            expense_policy: None,
            priority: None,
            is_published: None,
            description_purchase: None,
            description_sale: None,
            service_type: None,
            service_tracking: None,
            image_1920_url: None,
            image_128_url: None,
            color: None,
            responsible_id: None,
            pricelist_id: None,
            description_picking: None,
            description_pickingout: None,
            description_pickingin: None,
            location_id: None,
            warehouse_id: Some(fixture.warehouse_id),
            tracking: None,
            has_configurable_attributes: None,
            taxes_id: None,
            supplier_taxes_id: None,
            route_ids: None,
            route_from_categ_ids: None,
            property_account_income_id: None,
            property_account_expense_id: None,
            variant_attribute_ids: None,
            attribute_line_ids: None,
            metadata: Some(r#"{"cov":"07h"}"#.to_string()),
        },
    )?;
    let rows: Vec<_> = ctx
        .db
        .product()
        .product_by_org()
        .filter(&fixture.organization_id)
        .filter(|row| row.default_code.as_deref() == Some(code))
        .collect();
    if rows.len() != 1 {
        return Err(format!("{code}: expected one created product"));
    }
    Ok(rows[0].id)
}

/// One reducer transaction proves the complete owner graph, not isolated stages.
pub fn test_bom_to_close_domain_lifecycle(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let company = fixture.company_id;
    let raw = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("raw product missing")?;
    let warehouse = ctx
        .db
        .warehouse()
        .id()
        .find(&fixture.warehouse_id)
        .ok_or("warehouse missing")?;
    let opening = quant(ctx, &fixture, raw.id)?;
    exact(opening.quantity, 100.0, "opening raw stock")?;
    exact(opening.cost, 10.0, "opening raw cost")?;
    exact(opening.value, 1_000.0, "opening raw value")?;
    let primary_id = create_output_product(ctx, &fixture, "COV-07H-PRIMARY", 17.0)?;
    let byproduct_id = create_output_product(ctx, &fixture, "COV-07H-BYPRODUCT", 3.0)?;

    create_workcenter(
        ctx,
        org,
        CreateWorkcenterParams {
            company_id: Some(company),
            name: "COV-07H Center".to_string(),
            active: true,
            code: None,
            working_state: "normal".to_string(),
            oee_target: 85.0,
            time_efficiency: 100.0,
            capacity: 2.0,
            capacity_ids: vec![],
            alternative_workcenter_ids: vec![],
            color: None,
            resource_calendar_id: None,
            tag_ids: vec![],
            default_capacity_parent_id: None,
            default_time_efficiency: 100.0,
            default_oee_target: 85.0,
            sequence: 10,
            metadata: None,
        },
    )?;
    let center = ctx
        .db
        .mrp_workcenter()
        .mrp_workcenter_by_org()
        .filter(&org)
        .find(|row| row.name == "COV-07H Center")
        .ok_or("center missing")?;
    configure_workcenter_cost_rate(ctx, org, company, center.id, 60.0)?;
    let mut operations = Vec::new();
    for name in ["COV-07H Assemble", "COV-07H Inspect"] {
        let blockers = operations.clone();
        create_routing_workcenter(
            ctx,
            org,
            CreateRoutingWorkcenterParams {
                workcenter_id: center.id,
                name: name.to_string(),
                worksheet_type: "none".to_string(),
                time_mode: "manual".to_string(),
                time_mode_batch: 1,
                time_cycle_manual: 10.0,
                time_cycle: 10.0,
                sequence: operations.len() as u32 + 1,
                worksheet: None,
                worksheet_google_slide: None,
                worksheet_url: None,
                blocked_by_operation_ids: blockers,
                metadata: None,
            },
        )?;
        let operation = ctx
            .db
            .mrp_routing_workcenter()
            .iter()
            .find(|row| row.organization_id == org && row.name == name)
            .ok_or("operation missing")?;
        if operation.company_id != company || operation.workcenter_id != center.id {
            return Err("routing operation scope mismatch".to_string());
        }
        operations.push(operation.id);
    }

    create_bom(
        ctx,
        org,
        CreateBomParams {
            company_id: Some(company),
            type_: BomType::Manufacture,
            product_id: primary_id,
            product_qty: 2.0,
            product_uom_id: raw.uom_id,
            ready_to_produce: "all_available".to_string(),
            consumption: "flexible".to_string(),
            sequence: 10,
            lines: [1.5, 0.5]
                .into_iter()
                .enumerate()
                .map(|(index, quantity)| BomLineInput {
                    product_id: raw.id,
                    product_qty: quantity,
                    product_uom_id: raw.uom_id,
                    sequence: index as u32 + 1,
                    manual_consumption: false,
                    attachments_count: 0,
                    operation_id: Some(operations[0]),
                    child_bom_id: None,
                    bom_product_template_attribute_value_ids: vec![],
                    possible_bom_product_template_attribute_value_ids: vec![],
                    metadata: None,
                })
                .collect(),
            picking_type_id: Some(warehouse.pick_type_id),
            location_src_id: Some(fixture.location_id),
            location_dest_id: Some(fixture.location_id),
            warehouse_id: Some(warehouse.id),
            routing_id: Some(operations[0]),
            metadata: None,
        },
    )?;
    let bom = ctx
        .db
        .mrp_bom()
        .mrp_bom_by_product()
        .filter(&primary_id)
        .find(|row| row.organization_id == org)
        .ok_or("BOM missing")?;
    exact(
        bom.estimated_cost,
        20.0,
        "cached BOM component standard cost",
    )?;
    let lines: Vec<_> = ctx
        .db
        .mrp_bom_line()
        .mrp_bom_line_by_bom()
        .filter(&bom.id)
        .collect();
    let line_ids: HashSet<_> = lines.iter().map(|line| line.id).collect();
    if lines.len() != 2
        || line_ids != bom.bom_line_ids.iter().copied().collect()
        || lines.iter().any(|line| {
            line.organization_id != org
                || line.company_id != company
                || line.product_id != raw.id
                || line.operation_id != Some(operations[0])
        })
    {
        return Err("exact BOM component ownership mismatch".to_string());
    }
    create_bom_byproduct(
        ctx,
        org,
        bom.id,
        CreateBomByproductParams {
            product_id: byproduct_id,
            product_qty: 0.5,
            product_uom_id: raw.uom_id,
            cost_share: 20.0,
            sequence: 2,
            metadata: None,
        },
    )?;
    let definition = ctx
        .db
        .mrp_bom_byproduct()
        .mrp_bom_byproduct_by_bom()
        .filter(&bom.id)
        .next()
        .ok_or("byproduct definition missing")?;
    let owned_bom = ctx
        .db
        .mrp_bom()
        .id()
        .find(&bom.id)
        .ok_or("BOM disappeared")?;
    if owned_bom.byproduct_ids != vec![definition.id]
        || definition.organization_id != org
        || definition.company_id != company
        || definition.product_id != byproduct_id
    {
        return Err("exact BOM byproduct ownership mismatch".to_string());
    }

    create_manufacturing_order(
        ctx,
        org,
        CreateMrpProductionParams {
            company_id: Some(company),
            product_id: primary_id,
            product_qty: 0.5,
            product_uom_id: raw.uom_id,
            date_planned_start: ctx.timestamp,
            date_planned_finished: ctx.timestamp + Duration::from_secs(3_600),
            location_src_id: fixture.location_id,
            location_dest_id: fixture.location_id,
            warehouse_id: warehouse.id,
            picking_type_id: warehouse.pick_type_id,
            consumption: None,
            bom_id: Some(bom.id),
            routing_id: Some(operations[0]),
            proc_group_id: None,
            procurement_group_id: None,
            date_deadline: None,
            origin: Some("COV-07H-LIFECYCLE".to_string()),
            responsible_user_id: None,
            metadata: None,
        },
    )?;
    let mo = ctx
        .db
        .mrp_production()
        .mrp_production_by_org()
        .filter(&org)
        .find(|row| row.origin.as_deref() == Some("COV-07H-LIFECYCLE"))
        .ok_or("MO missing")?;
    if mo.state != MoState::Draft
        || mo.company_id != company
        || mo.bom_id != Some(bom.id)
        || mo.product_id != primary_id
        || !mo.move_raw_ids.is_empty()
        || !mo.move_finished_ids.is_empty()
    {
        return Err("draft MO owner graph mismatch".to_string());
    }
    rejected_without_effect(ctx, org, "draft consumption", || {
        consume_mo_materials(ctx, org, company, mo.id)
    })?;
    confirm_manufacturing_order(ctx, org, company, mo.id)?;
    rejected_without_effect(ctx, org, "confirm replay", || {
        confirm_manufacturing_order(ctx, org, company, mo.id)
    })?;
    start_manufacturing_order(ctx, org, company, mo.id)?;
    rejected_without_effect(ctx, org, "start replay", || {
        start_manufacturing_order(ctx, org, company, mo.id)
    })?;

    let mut workorders = Vec::new();
    for (index, operation_id) in operations.iter().enumerate() {
        let before: HashSet<_> = ctx
            .db
            .mrp_workorder()
            .mrp_workorder_by_production()
            .filter(&mo.id)
            .map(|row| row.id)
            .collect();
        create_workorder(
            ctx,
            org,
            CreateWorkorderParams {
                workcenter_id: center.id,
                production_id: mo.id,
                duration_expected: 10.0,
                name: format!("COV-07H Step {index}"),
                sequence: index as u32 + 1,
                capacity: None,
                worksheet: None,
                worksheet_url: None,
                operation_note: None,
                operation_id: Some(*operation_id),
                blocked_by_workorder_id: workorders.last().copied(),
                metadata: None,
            },
        )?;
        let created: Vec<_> = ctx
            .db
            .mrp_workorder()
            .mrp_workorder_by_production()
            .filter(&mo.id)
            .filter(|row| !before.contains(&row.id))
            .collect();
        if created.len() != 1
            || created[0].company_id != company
            || created[0].operation_id != Some(*operation_id)
        {
            return Err("exact routed workorder creation mismatch".to_string());
        }
        exact(created[0].capacity, 2.0, "derived workcenter capacity")?;
        workorders.push(created[0].id);
    }
    rejected_without_effect(ctx, org, "routing blocker", || {
        start_workorder(ctx, org, company, workorders[1])
    })?;
    consume_mo_materials(ctx, org, company, mo.id)?;
    let consumed = ctx
        .db
        .mrp_production()
        .id()
        .find(&mo.id)
        .ok_or("MO missing after consumption")?;
    let raw_ids: HashSet<_> = consumed.move_raw_ids.iter().copied().collect();
    require_durable_row(
        ctx,
        org,
        mo.id,
        "erp.consume_mo_materials",
        "mrp_production",
        serde_json::json!({"id": mo.id}),
        &consumed,
    )?;
    if raw_ids.len() != 2 || consumed.move_raw_ids.len() != 2 || consumed.move_raw_count != 2 {
        return Err("exact raw move ownership/count mismatch".to_string());
    }
    let mut quantities = Vec::new();
    for id in &consumed.move_raw_ids {
        let row = ctx
            .db
            .stock_move()
            .id()
            .find(id)
            .ok_or("owned raw move missing")?;
        if row.organization_id != org
            || row.company_id != company
            || row.production_id != Some(mo.id)
            || row.product_id != raw.id
            || row.product_uom != raw.uom_id
            || row.location_id != fixture.location_id
            || row.location_dest_id != fixture.location_id
            || row.state != "done"
            || !row.is_done
            || row.is_assigned
        {
            return Err("raw move exact scope/terminal state mismatch".to_string());
        }
        exact(
            row.quantity_done,
            row.product_uom_qty,
            "consumed raw move quantity",
        )?;
        exact(row.price_unit, 10.0, "raw source cost snapshot")?;
        require_durable_row(
            ctx,
            org,
            mo.id,
            "erp.consume_mo_materials",
            "stock_move",
            serde_json::json!({"id": row.id}),
            &row,
        )?;
        let metadata: serde_json::Value =
            serde_json::from_str(row.metadata.as_deref().ok_or("raw cost metadata missing")?)
                .map_err(|error| format!("raw cost metadata: {error}"))?;
        let cost = &metadata["manufacturing_material_cost"];
        if cost["source_quant_id"].as_u64() != Some(opening.id)
            || cost["currency_id"].as_u64() != Some(fixture.currency_id)
        {
            return Err("raw cost snapshot lost exact quant/currency identity".to_string());
        }
        exact(
            cost["consumed_quantity"]
                .as_f64()
                .ok_or("raw cost quantity missing")?,
            row.quantity_done,
            "raw snapshot quantity",
        )?;
        exact(
            cost["value"].as_f64().ok_or("raw cost value missing")?,
            row.quantity_done * 10.0,
            "raw snapshot value",
        )?;
        quantities.push(row.quantity_done);
    }
    quantities.sort_by(f64::total_cmp);
    if quantities != vec![0.125, 0.375] {
        return Err(format!("raw quantities: {quantities:?}"));
    }
    let remaining_raw = quant(ctx, &fixture, raw.id)?;
    if remaining_raw.id != opening.id {
        return Err("raw quant identity changed".to_string());
    }
    exact(remaining_raw.quantity, 99.5, "raw remaining stock")?;
    exact(
        remaining_raw.available_quantity,
        99.5,
        "raw available stock",
    )?;
    exact(remaining_raw.cost, 10.0, "preserved raw cost")?;
    exact(remaining_raw.value, 995.0, "raw remaining value")?;
    require_durable_row(
        ctx,
        org,
        mo.id,
        "erp.consume_mo_materials",
        "stock_quant",
        serde_json::json!({"id": remaining_raw.id}),
        &remaining_raw,
    )?;
    let before_replay = snapshot(ctx, org);
    consume_mo_materials(ctx, org, company, mo.id)?;
    if snapshot(ctx, org) != before_replay {
        return Err("consumption replay changed persisted effects".to_string());
    }

    produce_manufacturing_order(ctx, org, company, mo.id, 0.2)?;
    let partial = ctx
        .db
        .mrp_production()
        .id()
        .find(&mo.id)
        .ok_or("partial MO missing")?;
    if partial.state != MoState::Progress {
        return Err("partial output prematurely reached ToClose".to_string());
    }
    exact(partial.qty_produced, 0.2, "partial output")?;
    rejected_without_effect(ctx, org, "overproduction", || {
        produce_manufacturing_order(ctx, org, company, mo.id, 0.4)
    })?;
    produce_manufacturing_order(ctx, org, company, mo.id, 0.3)?;
    rejected_without_effect(ctx, org, "unfinished workorder close", || {
        finish_manufacturing_order(ctx, org, company, mo.id)
    })?;

    let mut log_ids = Vec::new();
    let mut check_ids = Vec::new();
    for (index, workorder_id) in workorders.iter().enumerate() {
        let duration = if index == 0 { 4.0 } else { 6.0 };
        start_workorder(ctx, org, company, *workorder_id)?;
        log_workcenter_productivity(
            ctx,
            org,
            center.id,
            CreateWorkcenterProductivityParams {
                workorder_id: *workorder_id,
                loss_id: None,
                description: Some("COV-07H productive time".to_string()),
                duration,
                metadata: None,
            },
        )?;
        let logs: Vec<_> = ctx
            .db
            .mrp_workcenter_productivity()
            .mrp_productivity_by_workorder()
            .filter(workorder_id)
            .collect();
        if logs.len() != 1
            || logs[0].organization_id != org
            || logs[0].company_id != company
            || logs[0].workcenter_id != center.id
            || logs[0].workorder_id != *workorder_id
        {
            return Err("exact productivity owner graph mismatch".to_string());
        }
        log_ids.push(logs[0].id);
        let time_cost = ctx
            .db
            .mrp_productivity_cost()
            .productivity_id()
            .find(&logs[0].id)
            .ok_or("productivity cost missing")?;
        if time_cost.organization_id != org
            || time_cost.company_id != company
            || time_cost.production_id != mo.id
            || time_cost.workorder_id != *workorder_id
            || time_cost.workcenter_id != center.id
            || time_cost.currency_id != fixture.currency_id
            || !time_cost.configured
        {
            return Err("productivity cost exact owner/configuration mismatch".to_string());
        }
        exact(
            time_cost.duration_minutes,
            duration,
            "costed workorder duration",
        )?;
        exact(time_cost.hourly_rate, 60.0, "configured hourly cost rate")?;
        exact(time_cost.value, duration, "workorder labor cost")?;
        require_durable_row(
            ctx,
            org,
            mo.id,
            "erp.log_workcenter_productivity",
            "mrp_workcenter_productivity",
            serde_json::json!({"id": logs[0].id}),
            &logs[0],
        )?;
        require_durable_row(
            ctx,
            org,
            mo.id,
            "erp.log_workcenter_productivity",
            "mrp_productivity_cost",
            serde_json::json!({"productivity_id": logs[0].id}),
            &time_cost,
        )?;
        create_workorder_quality_check(
            ctx,
            org,
            company,
            *workorder_id,
            format!("COV-07H Inspection {index}"),
        )?;
        let checks: Vec<_> = ctx
            .db
            .quality_check()
            .iter()
            .filter(|row| row.workorder_id == Some(*workorder_id))
            .collect();
        if checks.len() != 1
            || checks[0].organization_id != org
            || checks[0].company_id != company
            || checks[0].production_id != Some(mo.id)
            || checks[0].product_id != Some(primary_id)
        {
            return Err("exact quality owner graph mismatch".to_string());
        }
        let check_id = checks[0].id;
        exact(checks[0].qty_tested, 0.5, "quality tested quantity")?;
        check_ids.push(check_id);
        rejected_without_effect(ctx, org, "pending quality workorder finish", || {
            finish_workorder(ctx, org, company, *workorder_id)
        })?;
        rejected_without_effect(ctx, org, "pending quality MO finish", || {
            finish_manufacturing_order(ctx, org, company, mo.id)
        })?;
        pass_quality_check(ctx, org, company, check_id, None, None, None)?;
        rejected_without_effect(ctx, org, "quality pass replay", || {
            pass_quality_check(ctx, org, company, check_id, None, None, None)
        })?;
        finish_workorder(ctx, org, company, *workorder_id)?;
        let wo = ctx
            .db
            .mrp_workorder()
            .id()
            .find(workorder_id)
            .ok_or("completed workorder missing")?;
        if wo.state != WorkorderState::Done
            || wo.time_ids != vec![logs[0].id]
            || wo.check_ids != vec![check_id]
            || wo.quality_state.as_deref() != Some("pass")
            || wo.quality_check_todo
            || wo.quality_check_fail
            || wo.is_user_working
            || !wo.is_produced
            || wo.date_finished.is_none()
        {
            return Err("completed workorder lost productivity/quality owners".to_string());
        }
        exact(wo.duration, duration, "completed workorder duration")?;
        exact(wo.progress, 100.0, "completed workorder progress")?;
        let closed_log = ctx
            .db
            .mrp_workcenter_productivity()
            .id()
            .find(&logs[0].id)
            .ok_or("closed log missing")?;
        if closed_log.date_end.is_none() {
            return Err("productivity log did not close".to_string());
        }
        rejected_without_effect(ctx, org, "workorder finish replay", || {
            finish_workorder(ctx, org, company, *workorder_id)
        })?;
    }

    finish_manufacturing_order(ctx, org, company, mo.id)?;
    let closed = ctx
        .db
        .mrp_production()
        .id()
        .find(&mo.id)
        .ok_or("closed MO missing")?;
    if closed.state != MoState::Done
        || closed.date_finished.is_none()
        || closed.workorder_ids != workorders
        || closed.move_raw_ids != consumed.move_raw_ids
        || closed.move_raw_count != 2
        || closed.move_finished_count != 2
        || closed.move_finished_ids.len() != 2
    {
        return Err("closed MO exact owner graph mismatch".to_string());
    }
    exact(closed.qty_produced, 0.5, "closed MO output")?;
    require_durable_row(
        ctx,
        org,
        mo.id,
        "erp.finish_manufacturing_order",
        "mrp_production",
        serde_json::json!({"id": mo.id}),
        &closed,
    )?;
    let finished_ids: HashSet<_> = closed.move_finished_ids.iter().copied().collect();
    if finished_ids.len() != 2 || !finished_ids.is_disjoint(&raw_ids) {
        return Err("finished/raw move ownership overlaps or duplicates".to_string());
    }
    let mut output_products = HashSet::new();
    for id in &closed.move_finished_ids {
        let row = ctx
            .db
            .stock_move()
            .id()
            .find(id)
            .ok_or("owned output move missing")?;
        if row.organization_id != org
            || row.company_id != company
            || row.production_id != Some(mo.id)
            || row.product_uom != raw.uom_id
            || row.location_dest_id != fixture.location_id
            || row.state != "done"
            || !row.is_done
            || row.is_assigned
        {
            return Err("finished move scope/terminal state mismatch".to_string());
        }
        output_products.insert(row.product_id);
        exact(
            row.quantity_done,
            row.product_uom_qty,
            "output done/planned quantity",
        )?;
        exact(row.price_unit, 24.0, "allocated actual output unit cost")?;
        require_durable_row(
            ctx,
            org,
            mo.id,
            "erp.finish_manufacturing_order",
            "stock_move",
            serde_json::json!({"id": row.id}),
            &row,
        )?;
        if row.product_id == primary_id {
            exact(row.quantity_done, 0.5, "primary output quantity")?;
            exact(row.cost_share, 0.0, "primary move existing cost share")?;
        } else if row.product_id == byproduct_id {
            exact(row.quantity_done, 0.125, "byproduct output quantity")?;
            exact(row.cost_share, 20.0, "byproduct allocated share metadata")?;
            if row.reference.as_deref()
                != Some(format!("MO/{}/BYPRODUCT/{}", mo.id, definition.id).as_str())
            {
                return Err("byproduct move does not reference exact BOM definition".to_string());
            }
        } else {
            return Err("unexpected output product".to_string());
        }
    }
    if output_products != HashSet::from([primary_id, byproduct_id]) {
        return Err("primary and byproduct exact effect set mismatch".to_string());
    }
    let owned_moves: HashSet<_> = ctx
        .db
        .stock_move()
        .iter()
        .filter(|row| row.production_id == Some(mo.id))
        .map(|row| row.id)
        .collect();
    if owned_moves != raw_ids.union(&finished_ids).copied().collect() {
        return Err("MO has unowned or missing stock effects".to_string());
    }
    for (product_id, quantity, cost, value) in [
        (primary_id, 0.5, 17.0, 8.5),
        (byproduct_id, 0.125, 3.0, 0.375),
    ] {
        let output = quant(ctx, &fixture, product_id)?;
        exact(output.quantity, quantity, "output quant quantity")?;
        exact(
            output.available_quantity,
            quantity,
            "output available quantity",
        )?;
        exact(output.reserved_quantity, 0.0, "output reserved quantity")?;
        exact(output.cost, cost, "output standard cost")?;
        exact(output.value, value, "output standard-cost value")?;
        require_durable_row(
            ctx,
            org,
            mo.id,
            "erp.finish_manufacturing_order",
            "stock_quant",
            serde_json::json!({"id": output.id}),
            &output,
        )?;
    }
    let final_raw = quant(ctx, &fixture, raw.id)?;
    exact(final_raw.quantity, 99.5, "close preserves raw quantity")?;
    exact(final_raw.value, 995.0, "close preserves raw value")?;
    let final_center = ctx
        .db
        .mrp_workcenter()
        .id()
        .find(&center.id)
        .ok_or("final center missing")?;
    if final_center.order_ids != workorders
        || final_center.workorder_count != 2
        || final_center.workorder_pending_count != 0
        || final_center.workorder_progress_count != 0
        || final_center.productivity_ids != log_ids
        || check_ids.len() != 2
    {
        return Err("completed workcenter ownership/count mismatch".to_string());
    }
    exact(final_center.productive_time, 10.0, "total productive time")?;
    let cost = ctx
        .db
        .mrp_production_cost()
        .production_id()
        .find(&mo.id)
        .ok_or("production cost result missing")?;
    let cost_raw_ids: HashSet<_> = cost.raw_move_ids.iter().copied().collect();
    require_durable_row(
        ctx,
        org,
        mo.id,
        "erp.finish_manufacturing_order",
        "mrp_production_cost",
        serde_json::json!({"production_id": mo.id}),
        &cost,
    )?;
    let cost_output_ids: HashSet<_> = cost.output_move_ids.iter().copied().collect();
    let cost_productivity_ids: HashSet<_> = cost.productivity_cost_ids.iter().copied().collect();
    if cost.organization_id != org
        || cost.company_id != company
        || cost.currency_id != fixture.currency_id
        || cost_raw_ids != raw_ids
        || cost.raw_move_ids.len() != 2
        || cost_output_ids != finished_ids
        || cost.output_move_ids.len() != 2
        || cost_productivity_ids != log_ids.iter().copied().collect()
        || cost.productivity_cost_ids.len() != 2
        || cost.account_move_id.is_some()
        || !cost.account_move_line_ids.is_empty()
    {
        return Err("production cost result exact effect/currency ownership mismatch".to_string());
    }
    exact(cost.material_value, 5.0, "production material value")?;
    exact(cost.workcenter_value, 10.0, "production labor value")?;
    exact(cost.total_value, 15.0, "production total actual value")?;
    exact(
        cost.inventory_value,
        8.875,
        "production standard inventory value",
    )?;
    exact(
        cost.variance_value,
        6.125,
        "actual/standard production variance",
    )?;
    rejected_without_effect(ctx, org, "MO finish replay", || {
        finish_manufacturing_order(ctx, org, company, mo.id)
    })?;
    rejected_without_effect(ctx, org, "terminal consumption", || {
        consume_mo_materials(ctx, org, company, mo.id)
    })?;
    rejected_without_effect(ctx, org, "terminal output replay", || {
        produce_manufacturing_order(ctx, org, company, mo.id, 0.5)
    })?;
    log::info!(
        "COV-07h complete persisted BOM-to-close domain proof passed: MO {}",
        mo.id
    );
    Ok(())
}
