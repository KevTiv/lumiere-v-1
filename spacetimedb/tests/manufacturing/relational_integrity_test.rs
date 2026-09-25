//! Persisted relational-integrity tests for work orders and productivity logs.

use std::collections::HashSet;
use std::time::Duration;

use spacetimedb::{ReducerContext, Table};

use crate::core::persistence::{organization_commit, organization_row_change};
use crate::inventory::product::product;
use crate::inventory::stock::{stock_move, stock_quant};
use crate::inventory::warehouse::warehouse;
use crate::manufacturing::bill_of_materials::{
    create_bom, mrp_bom, mrp_bom_line, BomLineInput, CreateBomParams, MrpBomLine,
};
use crate::manufacturing::manufacturing_orders::{
    confirm_manufacturing_order, consume_mo_materials, create_manufacturing_order,
    create_workorder, finish_manufacturing_order, mrp_production, mrp_workorder,
    produce_manufacturing_order, start_manufacturing_order, CreateMrpProductionParams,
    CreateWorkorderParams, MrpProduction, MrpWorkorder,
};
use crate::manufacturing::work_centers::{
    create_loss_category, create_workcenter, log_workcenter_productivity, mrp_loss_category,
    mrp_workcenter, mrp_workcenter_productivity, CreateLossCategoryParams, CreateWorkcenterParams,
    CreateWorkcenterProductivityParams, MrpLossCategory, MrpWorkcenter,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{BomType, MoState, WorkorderState};

fn create_test_workcenter(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    name: &str,
    active: bool,
) -> Result<MrpWorkcenter, String> {
    create_workcenter(
        ctx,
        fixture.organization_id,
        CreateWorkcenterParams {
            company_id: Some(fixture.company_id),
            name: name.to_string(),
            active,
            code: None,
            working_state: "normal".to_string(),
            oee_target: 85.0,
            time_efficiency: 100.0,
            capacity: 1.0,
            capacity_ids: vec![],
            alternative_workcenter_ids: vec![],
            color: None,
            resource_calendar_id: None,
            tag_ids: vec![],
            default_capacity_parent_id: None,
            default_time_efficiency: 100.0,
            default_oee_target: 85.0,
            sequence: 10,
            metadata: Some(r#"{"test":"manufacturing-relational-integrity"}"#.to_string()),
        },
    )?;

    ctx.db
        .mrp_workcenter()
        .mrp_workcenter_by_org()
        .filter(&fixture.organization_id)
        .find(|workcenter| workcenter.name == name)
        .ok_or_else(|| format!("workcenter {name} missing after create"))
}

fn create_test_production(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    origin: &str,
) -> Result<MrpProduction, String> {
    let product = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("fixture product missing")?;
    let warehouse = ctx
        .db
        .warehouse()
        .id()
        .find(&fixture.warehouse_id)
        .ok_or("fixture warehouse missing")?;

    create_manufacturing_order(
        ctx,
        fixture.organization_id,
        CreateMrpProductionParams {
            company_id: Some(fixture.company_id),
            product_id: fixture.product_id,
            product_qty: 1.0,
            product_uom_id: product.uom_id,
            date_planned_start: ctx.timestamp,
            date_planned_finished: ctx.timestamp + Duration::from_secs(3_600),
            location_src_id: warehouse.lot_stock_id,
            location_dest_id: warehouse.lot_stock_id,
            warehouse_id: warehouse.id,
            picking_type_id: warehouse.pick_type_id,
            consumption: None,
            bom_id: None,
            routing_id: None,
            proc_group_id: None,
            procurement_group_id: None,
            date_deadline: None,
            origin: Some(origin.to_string()),
            responsible_user_id: None,
            metadata: Some(r#"{"test":"manufacturing-relational-integrity"}"#.to_string()),
        },
    )?;

    let production = ctx
        .db
        .mrp_production()
        .mrp_production_by_org()
        .filter(&fixture.organization_id)
        .find(|production| production.origin.as_deref() == Some(origin))
        .ok_or_else(|| format!("production {origin} missing after create"))?;
    if production.consumption != "flexible" {
        return Err("omitted consumption mode did not persist the flexible default".to_string());
    }
    Ok(production)
}

fn create_test_workorder(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    production_id: u64,
    workcenter_id: u64,
    name: &str,
) -> Result<MrpWorkorder, String> {
    create_workorder(
        ctx,
        fixture.organization_id,
        CreateWorkorderParams {
            workcenter_id,
            production_id,
            duration_expected: 30.0,
            name: name.to_string(),
            sequence: 10,
            capacity: None,
            worksheet: None,
            worksheet_url: None,
            operation_note: None,
            operation_id: None,
            blocked_by_workorder_id: None,
            metadata: Some(r#"{"test":"manufacturing-relational-integrity"}"#.to_string()),
        },
    )?;

    ctx.db
        .mrp_workorder()
        .mrp_workorder_by_production()
        .filter(&production_id)
        .find(|workorder| workorder.workcenter_id == workcenter_id)
        .ok_or_else(|| format!("workorder {name} missing after create"))
}

fn create_test_loss_category(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    name: &str,
) -> Result<MrpLossCategory, String> {
    create_loss_category(
        ctx,
        fixture.organization_id,
        CreateLossCategoryParams {
            company_id: Some(fixture.company_id),
            name: name.to_string(),
            category: "availability".to_string(),
            sequence: 10,
            metadata: Some(r#"{"test":"manufacturing-relational-integrity"}"#.to_string()),
        },
    )?;

    ctx.db
        .mrp_loss_category()
        .loss_cat_by_org()
        .filter(&fixture.organization_id)
        .find(|category| category.name == name)
        .ok_or_else(|| format!("loss category {name} missing after create"))
}

fn workorder_count(ctx: &ReducerContext, production_id: u64) -> usize {
    ctx.db
        .mrp_workorder()
        .mrp_workorder_by_production()
        .filter(&production_id)
        .count()
}

fn productivity_count(ctx: &ReducerContext, workcenter_id: u64) -> usize {
    ctx.db
        .mrp_workcenter_productivity()
        .mrp_productivity_by_workcenter()
        .filter(&workcenter_id)
        .count()
}

fn productivity_params(
    workorder_id: u64,
    loss_id: Option<u64>,
) -> CreateWorkcenterProductivityParams {
    CreateWorkcenterProductivityParams {
        workorder_id,
        loss_id,
        description: Some("integrity test".to_string()),
        duration: 5.0,
        metadata: Some(r#"{"test":"manufacturing-relational-integrity"}"#.to_string()),
    }
}

/// MFG-006/MFG-008: workorder workcenters must exist, be active, and share org/company.
pub fn test_workorder_workcenter_integrity(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;
    let production_a = create_test_production(ctx, &fixture_a, "MFG-WC-INTEGRITY-A")?;
    let active_b = create_test_workcenter(ctx, &fixture_b, "MFG Cross Org WC", true)?;
    let inactive_a = create_test_workcenter(ctx, &fixture_a, "MFG Inactive WC", false)?;
    let before = workorder_count(ctx, production_a.id);

    if create_workorder(
        ctx,
        fixture_a.organization_id,
        CreateWorkorderParams {
            workcenter_id: u64::MAX,
            production_id: production_a.id,
            duration_expected: 30.0,
            name: "Missing WC".to_string(),
            sequence: 1,
            capacity: None,
            worksheet: None,
            worksheet_url: None,
            operation_note: None,
            operation_id: None,
            blocked_by_workorder_id: None,
            metadata: None,
        },
    )
    .is_ok()
    {
        return Err("create_workorder accepted a missing workcenter_id".to_string());
    }
    if workorder_count(ctx, production_a.id) != before {
        return Err("missing workcenter rejection persisted a workorder".to_string());
    }

    for (workcenter_id, label) in [
        (active_b.id, "cross-organization"),
        (inactive_a.id, "inactive"),
    ] {
        if create_workorder(
            ctx,
            fixture_a.organization_id,
            CreateWorkorderParams {
                workcenter_id,
                production_id: production_a.id,
                duration_expected: 30.0,
                name: format!("Rejected {label} WC"),
                sequence: 1,
                capacity: None,
                worksheet: None,
                worksheet_url: None,
                operation_note: None,
                operation_id: None,
                blocked_by_workorder_id: None,
                metadata: None,
            },
        )
        .is_ok()
        {
            return Err(format!("create_workorder accepted a {label} workcenter"));
        }
        if workorder_count(ctx, production_a.id) != before {
            return Err(format!(
                "{label} workcenter rejection persisted a workorder"
            ));
        }
    }

    log::info!("test_workorder_workcenter_integrity passed");
    Ok(())
}

/// MFG-007/MFG-008: productivity references must be active and tenant-compatible.
pub fn test_productivity_relational_integrity(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;
    let wc_a = create_test_workcenter(ctx, &fixture_a, "MFG Productivity WC A", true)?;
    let other_wc_a = create_test_workcenter(ctx, &fixture_a, "MFG Productivity WC A2", true)?;
    let wc_b = create_test_workcenter(ctx, &fixture_b, "MFG Productivity WC B", true)?;
    let production_a = create_test_production(ctx, &fixture_a, "MFG-PRODUCTIVITY-A")?;
    let production_b = create_test_production(ctx, &fixture_b, "MFG-PRODUCTIVITY-B")?;
    let workorder_a =
        create_test_workorder(ctx, &fixture_a, production_a.id, wc_a.id, "Productivity A")?;
    let workorder_b =
        create_test_workorder(ctx, &fixture_b, production_b.id, wc_b.id, "Productivity B")?;
    let other_workorder_a = create_test_workorder(
        ctx,
        &fixture_a,
        production_a.id,
        other_wc_a.id,
        "Productivity A2",
    )?;
    let category_a = create_test_loss_category(ctx, &fixture_a, "MFG Loss A")?;
    let category_b = create_test_loss_category(ctx, &fixture_b, "MFG Loss B")?;
    let wc_a_id = wc_a.id;
    let category_a_id = category_a.id;
    let before = productivity_count(ctx, wc_a_id);
    let before_ids = wc_a.productivity_ids.clone();

    for (params, label) in [
        (
            productivity_params(workorder_a.id, Some(u64::MAX)),
            "missing loss category",
        ),
        (
            productivity_params(workorder_a.id, Some(category_b.id)),
            "cross-organization loss category",
        ),
        (
            productivity_params(workorder_b.id, Some(category_a.id)),
            "cross-organization workorder",
        ),
        (
            productivity_params(other_workorder_a.id, Some(category_a.id)),
            "different-workcenter workorder",
        ),
    ] {
        if log_workcenter_productivity(ctx, fixture_a.organization_id, wc_a_id, params).is_ok() {
            return Err(format!("productivity logging accepted a {label}"));
        }
        if productivity_count(ctx, wc_a_id) != before {
            return Err(format!("{label} rejection persisted a productivity row"));
        }
        let current_wc = ctx
            .db
            .mrp_workcenter()
            .id()
            .find(&wc_a_id)
            .ok_or("workcenter missing after rejected productivity call")?;
        if current_wc.productivity_ids != before_ids {
            return Err(format!(
                "{label} rejection mutated workcenter productivity_ids"
            ));
        }
    }

    ctx.db.mrp_loss_category().id().update(MrpLossCategory {
        active: false,
        ..category_a
    });
    if log_workcenter_productivity(
        ctx,
        fixture_a.organization_id,
        wc_a_id,
        productivity_params(workorder_a.id, Some(category_a_id)),
    )
    .is_ok()
    {
        return Err("productivity logging accepted an inactive loss category".to_string());
    }
    if productivity_count(ctx, wc_a_id) != before {
        return Err("inactive loss category rejection persisted a productivity row".to_string());
    }

    ctx.db.mrp_workcenter().id().update(MrpWorkcenter {
        active: false,
        ..wc_a
    });
    if log_workcenter_productivity(
        ctx,
        fixture_a.organization_id,
        wc_a_id,
        productivity_params(workorder_a.id, None),
    )
    .is_ok()
    {
        return Err("productivity logging accepted an inactive workcenter".to_string());
    }
    if productivity_count(ctx, wc_a_id) != before {
        return Err("inactive workcenter rejection persisted a productivity row".to_string());
    }

    log::info!("test_productivity_relational_integrity passed");
    Ok(())
}

/// MFG-010: MO material consumption re-validates that every BOM component
/// product still exists and belongs to the manufacturing order's organization
/// before exploding the BOM into consumption moves. `create_bom` already
/// rejects a cross-org component at BOM-line creation time, so this test
/// forces the stored line directly (simulating a stale/tampered row) to
/// exercise the defense-in-depth guard in `consume_mo_materials`.
pub fn test_consume_materials_rejects_cross_org_component(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;

    let product_a = ctx
        .db
        .product()
        .id()
        .find(&fixture_a.product_id)
        .ok_or("fixture_a product missing")?;
    let warehouse_a = ctx
        .db
        .warehouse()
        .id()
        .find(&fixture_a.warehouse_id)
        .ok_or("fixture_a warehouse missing")?;

    create_bom(
        ctx,
        fixture_a.organization_id,
        CreateBomParams {
            company_id: Some(fixture_a.company_id),
            type_: BomType::Manufacture,
            product_id: fixture_a.product_id,
            product_qty: 1.0,
            product_uom_id: product_a.uom_id,
            ready_to_produce: "all_available".to_string(),
            consumption: "flexible".to_string(),
            sequence: 10,
            lines: vec![BomLineInput {
                product_id: fixture_a.product_id,
                product_qty: 2.0,
                product_uom_id: product_a.uom_id,
                sequence: 10,
                manual_consumption: false,
                attachments_count: 0,
                operation_id: None,
                child_bom_id: None,
                bom_product_template_attribute_value_ids: vec![],
                possible_bom_product_template_attribute_value_ids: vec![],
                metadata: None,
            }],
            picking_type_id: None,
            location_src_id: None,
            location_dest_id: None,
            warehouse_id: None,
            routing_id: None,
            metadata: Some(r#"{"test":"manufacturing-relational-integrity"}"#.to_string()),
        },
    )?;

    let bom = ctx
        .db
        .mrp_bom()
        .mrp_bom_by_org()
        .filter(&fixture_a.organization_id)
        .next()
        .ok_or("BOM missing after create")?;

    let line = ctx
        .db
        .mrp_bom_line()
        .mrp_bom_line_by_bom()
        .filter(&bom.id)
        .next()
        .ok_or("BOM line missing after create")?;

    let commits: Vec<_> = ctx
        .db
        .organization_commit()
        .iter()
        .filter(|commit| {
            commit.organization_id == fixture_a.organization_id
                && commit.operation_id == "erp.create_bom"
                && commit.correlation_id == format!("bom:{}", bom.id)
        })
        .collect();
    if commits.len() != 1 || commits[0].row_change_count != 2 {
        return Err(format!("BOM commit mismatch: {}", commits.len()));
    }
    let mut changes: Vec<_> = ctx
        .db
        .organization_row_change()
        .iter()
        .filter(|change| {
            change.organization_id == fixture_a.organization_id
                && change.commit_sequence == commits[0].sequence
        })
        .collect();
    changes.sort_by_key(|change| change.ordinal);
    let tables: Vec<_> = changes
        .iter()
        .map(|change| change.table_name.as_str())
        .collect();
    if tables != ["mrp_bom", "mrp_bom_line"]
        || changes
            .iter()
            .any(|change| change.organization_id != fixture_a.organization_id)
    {
        return Err(format!("BOM row order/scope mismatch: {tables:?}"));
    }

    // Force the stored line to reference fixture_b's (foreign-org) product,
    // bypassing create_bom's own line validation to simulate a stale row.
    ctx.db.mrp_bom_line().id().update(MrpBomLine {
        product_id: fixture_b.product_id,
        ..line
    });

    create_manufacturing_order(
        ctx,
        fixture_a.organization_id,
        CreateMrpProductionParams {
            company_id: Some(fixture_a.company_id),
            product_id: fixture_a.product_id,
            product_qty: 1.0,
            product_uom_id: product_a.uom_id,
            date_planned_start: ctx.timestamp,
            date_planned_finished: ctx.timestamp + Duration::from_secs(3_600),
            location_src_id: warehouse_a.lot_stock_id,
            location_dest_id: warehouse_a.lot_stock_id,
            warehouse_id: warehouse_a.id,
            picking_type_id: warehouse_a.pick_type_id,
            consumption: None,
            bom_id: Some(bom.id),
            routing_id: None,
            proc_group_id: None,
            procurement_group_id: None,
            date_deadline: None,
            origin: Some("MFG-BOM-CROSS-ORG-COMPONENT".to_string()),
            responsible_user_id: None,
            metadata: Some(r#"{"test":"manufacturing-relational-integrity"}"#.to_string()),
        },
    )?;

    let mo = ctx
        .db
        .mrp_production()
        .mrp_production_by_org()
        .filter(&fixture_a.organization_id)
        .find(|production| production.origin.as_deref() == Some("MFG-BOM-CROSS-ORG-COMPONENT"))
        .ok_or("MO missing after create")?;

    confirm_manufacturing_order(ctx, fixture_a.organization_id, fixture_a.company_id, mo.id)?;
    start_manufacturing_order(ctx, fixture_a.organization_id, fixture_a.company_id, mo.id)?;

    if consume_mo_materials(ctx, fixture_a.organization_id, fixture_a.company_id, mo.id).is_ok() {
        return Err(
            "consume_mo_materials accepted a BOM component from a foreign organization".to_string(),
        );
    }

    let mo_after = ctx
        .db
        .mrp_production()
        .id()
        .find(&mo.id)
        .ok_or("MO missing after rejected consumption")?;
    if !mo_after.move_raw_ids.is_empty() {
        return Err(
            "rejected cross-org component consumption persisted a raw stock move".to_string(),
        );
    }

    log::info!("test_consume_materials_rejects_cross_org_component passed");
    Ok(())
}


/// COV-07b: material consumption owns an exact raw-move set, closes every
/// consumed move, reports the true move count, and is idempotent on replay.
pub fn test_consume_materials_exact_effect_and_replay(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let product = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("fixture product missing")?;
    let warehouse = ctx
        .db
        .warehouse()
        .id()
        .find(&fixture.warehouse_id)
        .ok_or("fixture warehouse missing")?;

    let before_bom_ids: HashSet<u64> = ctx
        .db
        .mrp_bom()
        .mrp_bom_by_org()
        .filter(&fixture.organization_id)
        .map(|bom| bom.id)
        .collect();

    create_bom(
        ctx,
        fixture.organization_id,
        CreateBomParams {
            company_id: Some(fixture.company_id),
            type_: BomType::Manufacture,
            product_id: fixture.product_id,
            product_qty: 1.0,
            product_uom_id: product.uom_id,
            ready_to_produce: "all_available".to_string(),
            consumption: "flexible".to_string(),
            sequence: 10,
            lines: vec![
                BomLineInput {
                    product_id: fixture.product_id,
                    product_qty: 1.0,
                    product_uom_id: product.uom_id,
                    sequence: 10,
                    manual_consumption: false,
                    attachments_count: 0,
                    operation_id: None,
                    child_bom_id: None,
                    bom_product_template_attribute_value_ids: vec![],
                    possible_bom_product_template_attribute_value_ids: vec![],
                    metadata: Some(r#"{"cov":"07b","line":1}"#.to_string()),
                },
                BomLineInput {
                    product_id: fixture.product_id,
                    product_qty: 0.5,
                    product_uom_id: product.uom_id,
                    sequence: 20,
                    manual_consumption: false,
                    attachments_count: 0,
                    operation_id: None,
                    child_bom_id: None,
                    bom_product_template_attribute_value_ids: vec![],
                    possible_bom_product_template_attribute_value_ids: vec![],
                    metadata: Some(r#"{"cov":"07b","line":2}"#.to_string()),
                },
            ],
            picking_type_id: Some(warehouse.pick_type_id),
            location_src_id: Some(warehouse.lot_stock_id),
            location_dest_id: Some(warehouse.lot_stock_id),
            warehouse_id: Some(warehouse.id),
            routing_id: None,
            metadata: Some(r#"{"cov":"07b"}"#.to_string()),
        },
    )?;

    let created_boms: Vec<_> = ctx
        .db
        .mrp_bom()
        .mrp_bom_by_org()
        .filter(&fixture.organization_id)
        .filter(|bom| !before_bom_ids.contains(&bom.id))
        .collect();
    if created_boms.len() != 1 {
        return Err(format!(
            "expected exactly one COV-07b BOM, got {}",
            created_boms.len()
        ));
    }
    let bom = &created_boms[0];

    create_manufacturing_order(
        ctx,
        fixture.organization_id,
        CreateMrpProductionParams {
            company_id: Some(fixture.company_id),
            product_id: fixture.product_id,
            product_qty: 2.0,
            product_uom_id: product.uom_id,
            date_planned_start: ctx.timestamp,
            date_planned_finished: ctx.timestamp + Duration::from_secs(3_600),
            location_src_id: warehouse.lot_stock_id,
            location_dest_id: warehouse.lot_stock_id,
            warehouse_id: warehouse.id,
            picking_type_id: warehouse.pick_type_id,
            consumption: Some("flexible".to_string()),
            bom_id: Some(bom.id),
            routing_id: None,
            proc_group_id: None,
            procurement_group_id: None,
            date_deadline: None,
            origin: Some("COV-07B-EXACT-MATERIALS".to_string()),
            responsible_user_id: None,
            metadata: Some(r#"{"cov":"07b"}"#.to_string()),
        },
    )?;

    let productions: Vec<_> = ctx
        .db
        .mrp_production()
        .mrp_production_by_org()
        .filter(&fixture.organization_id)
        .filter(|production| {
            production.origin.as_deref() == Some("COV-07B-EXACT-MATERIALS")
        })
        .collect();
    if productions.len() != 1 {
        return Err(format!(
            "expected exactly one COV-07b MO, got {}",
            productions.len()
        ));
    }
    let mo_id = productions[0].id;

    confirm_manufacturing_order(ctx, fixture.organization_id, fixture.company_id, mo_id)?;
    start_manufacturing_order(ctx, fixture.organization_id, fixture.company_id, mo_id)?;
    consume_mo_materials(ctx, fixture.organization_id, fixture.company_id, mo_id)?;

    let consumed = ctx
        .db
        .mrp_production()
        .id()
        .find(&mo_id)
        .ok_or("COV-07b MO missing after consumption")?;
    if consumed.move_raw_ids.len() != 2 || consumed.move_raw_count != 2 {
        return Err(format!(
            "raw move relation/count mismatch: ids={:?} count={}",
            consumed.move_raw_ids, consumed.move_raw_count
        ));
    }
    let unique_ids: HashSet<_> = consumed.move_raw_ids.iter().copied().collect();
    if unique_ids.len() != consumed.move_raw_ids.len() {
        return Err("raw move relation contains duplicate ids".to_string());
    }

    let mut quantities = Vec::new();
    for move_id in &consumed.move_raw_ids {
        let move_row = ctx
            .db
            .stock_move()
            .id()
            .find(move_id)
            .ok_or_else(|| format!("raw move {move_id} missing"))?;
        if move_row.production_id != Some(mo_id)
            || move_row.product_id != fixture.product_id
            || move_row.product_uom != product.uom_id
            || move_row.location_id != warehouse.lot_stock_id
            || move_row.location_dest_id != warehouse.lot_stock_id
            || move_row.state != "done"
            || !move_row.is_done
            || move_row.is_assigned
            || (move_row.quantity_done - move_row.product_uom_qty).abs() > 1e-9
        {
            return Err(format!("raw move {} did not converge exactly", move_id));
        }
        quantities.push(move_row.product_uom_qty);
    }
    quantities.sort_by(|a, b| a.total_cmp(b));
    if quantities != vec![1.0, 2.0] {
        return Err(format!("unexpected raw move quantities: {quantities:?}"));
    }

    let quant_after_first = ctx
        .db
        .stock_quant()
        .iter()
        .find(|quant| {
            quant.organization_id == fixture.organization_id
                && quant.company_id == fixture.company_id
                && quant.product_id == fixture.product_id
                && quant.location_id == warehouse.lot_stock_id
                && quant.lot_id.is_none()
                && quant.package_id.is_none()
                && quant.owner_id.is_none()
        })
        .map(|quant| quant.quantity)
        .ok_or("component quant missing after first consumption")?;

    let raw_ids_after_first = consumed.move_raw_ids.clone();
    consume_mo_materials(ctx, fixture.organization_id, fixture.company_id, mo_id)?;

    let replayed = ctx
        .db
        .mrp_production()
        .id()
        .find(&mo_id)
        .ok_or("COV-07b MO missing after replay")?;
    if replayed.move_raw_ids != raw_ids_after_first || replayed.move_raw_count != 2 {
        return Err("material replay changed the exact raw-move effect set".to_string());
    }
    let move_count = ctx
        .db
        .stock_move()
        .iter()
        .filter(|move_row| move_row.production_id == Some(mo_id))
        .count();
    if move_count != 2 {
        return Err(format!(
            "material replay created duplicate stock moves: {move_count}"
        ));
    }

    let quant_after_replay = ctx
        .db
        .stock_quant()
        .iter()
        .find(|quant| {
            quant.organization_id == fixture.organization_id
                && quant.company_id == fixture.company_id
                && quant.product_id == fixture.product_id
                && quant.location_id == warehouse.lot_stock_id
                && quant.lot_id.is_none()
                && quant.package_id.is_none()
                && quant.owner_id.is_none()
        })
        .map(|quant| quant.quantity)
        .ok_or("component quant missing after replay")?;
    if (quant_after_replay - quant_after_first).abs() > 1e-9 {
        return Err(format!(
            "material replay changed component quantity: {quant_after_first} -> {quant_after_replay}"
        ));
    }

    log::info!("test_consume_materials_exact_effect_and_replay passed");
    Ok(())
}


/// COV-07c: production quantity is state/remaining bounded; one finish owns one
/// exact terminal move and one exact destination-quant increment; replay cannot
/// duplicate either effect.
pub fn test_production_output_and_finish_exact_effect(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let mo = create_test_production(ctx, &fixture, "COV-07C-OUTPUT-CLOSE")?;

    if produce_manufacturing_order(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        mo.id,
        1.0,
    )
    .is_ok()
    {
        return Err("produce accepted a Draft manufacturing order".to_string());
    }

    confirm_manufacturing_order(ctx, fixture.organization_id, fixture.company_id, mo.id)?;
    start_manufacturing_order(ctx, fixture.organization_id, fixture.company_id, mo.id)?;

    if produce_manufacturing_order(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        mo.id,
        1.5,
    )
    .is_ok()
    {
        return Err("produce accepted quantity above the remaining MO quantity".to_string());
    }

    let after_rejected_overproduction = ctx
        .db
        .mrp_production()
        .id()
        .find(&mo.id)
        .ok_or("MO missing after rejected overproduction")?;
    if after_rejected_overproduction.qty_produced != 0.0
        || after_rejected_overproduction.state != MoState::Progress
    {
        return Err("rejected overproduction changed MO quantity/state".to_string());
    }

    produce_manufacturing_order(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        mo.id,
        1.0,
    )?;

    let produced = ctx
        .db
        .mrp_production()
        .id()
        .find(&mo.id)
        .ok_or("MO missing after production")?;
    if produced.state != MoState::ToClose
        || (produced.qty_produced - produced.product_qty).abs() > 1e-9
    {
        return Err(format!(
            "MO did not converge to ToClose at planned quantity: state={:?} produced={} planned={}",
            produced.state, produced.qty_produced, produced.product_qty
        ));
    }

    if produce_manufacturing_order(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        mo.id,
        0.1,
    )
    .is_ok()
    {
        return Err("produce accepted a second output after ToClose".to_string());
    }

    let destination_candidates_before: Vec<_> = ctx
        .db
        .stock_quant()
        .iter()
        .filter(|quant| {
            quant.organization_id == fixture.organization_id
                && quant.company_id == fixture.company_id
                && quant.product_id == fixture.product_id
                && quant.location_id == fixture.location_id
                && quant.lot_id.is_none()
                && quant.package_id.is_none()
                && quant.owner_id.is_none()
        })
        .collect();
    if destination_candidates_before.len() != 1 {
        return Err(format!(
            "expected one destination quant before finish, got {}",
            destination_candidates_before.len()
        ));
    }
    let destination_quant_id = destination_candidates_before[0].id;
    let destination_qty_before = destination_candidates_before[0].quantity;

    finish_manufacturing_order(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        mo.id,
    )?;

    let finished = ctx
        .db
        .mrp_production()
        .id()
        .find(&mo.id)
        .ok_or("MO missing after finish")?;
    if finished.state != MoState::Done
        || finished.move_finished_ids.len() != 1
        || finished.move_finished_count != 1
    {
        return Err(format!(
            "finished MO relation mismatch: state={:?} ids={:?} count={}",
            finished.state, finished.move_finished_ids, finished.move_finished_count
        ));
    }

    let finished_move_id = finished.move_finished_ids[0];
    let finished_move = ctx
        .db
        .stock_move()
        .id()
        .find(&finished_move_id)
        .ok_or("finished move missing")?;
    if finished_move.organization_id != fixture.organization_id
        || finished_move.company_id != fixture.company_id
        || finished_move.production_id != Some(mo.id)
        || finished_move.product_id != fixture.product_id
        || finished_move.location_id != fixture.location_id
        || finished_move.location_dest_id != fixture.location_id
        || finished_move.state != "done"
        || !finished_move.is_done
        || finished_move.is_assigned
        || (finished_move.product_uom_qty - 1.0).abs() > 1e-9
        || (finished_move.quantity_done - 1.0).abs() > 1e-9
    {
        return Err("finished-goods move did not converge exactly".to_string());
    }

    let destination_candidates_after: Vec<_> = ctx
        .db
        .stock_quant()
        .iter()
        .filter(|quant| {
            quant.organization_id == fixture.organization_id
                && quant.company_id == fixture.company_id
                && quant.product_id == fixture.product_id
                && quant.location_id == fixture.location_id
                && quant.lot_id.is_none()
                && quant.package_id.is_none()
                && quant.owner_id.is_none()
        })
        .collect();
    if destination_candidates_after.len() != 1
        || destination_candidates_after[0].id != destination_quant_id
        || (destination_candidates_after[0].quantity - (destination_qty_before + 1.0)).abs() > 1e-9
    {
        return Err("destination quant did not converge by exact finished quantity".to_string());
    }

    if finish_manufacturing_order(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        mo.id,
    )
    .is_ok()
    {
        return Err("finish replay was accepted after MO reached Done".to_string());
    }

    let replayed = ctx
        .db
        .mrp_production()
        .id()
        .find(&mo.id)
        .ok_or("MO missing after finish replay")?;
    if replayed.move_finished_ids != finished.move_finished_ids
        || replayed.move_finished_count != 1
    {
        return Err("finish replay changed the owned finished-move set".to_string());
    }

    let quant_after_replay = ctx
        .db
        .stock_quant()
        .id()
        .find(&destination_quant_id)
        .ok_or("destination quant missing after replay")?;
    if (quant_after_replay.quantity - destination_candidates_after[0].quantity).abs() > 1e-9 {
        return Err("finish replay changed destination quantity".to_string());
    }

    log::info!("test_production_output_and_finish_exact_effect passed");
    Ok(())
}


/// COV-07d: one MO-owned workorder executes through Start → productivity →
/// Finish with the same exact parent/workcenter/productivity relations.
pub fn test_workorder_execution_exact_effect(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let workcenter =
        create_test_workcenter(ctx, &fixture, "COV-07D Workcenter", true)?;
    let production = create_test_production(ctx, &fixture, "COV-07D-MO")?;

    confirm_manufacturing_order(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        production.id,
    )?;
    start_manufacturing_order(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        production.id,
    )?;

    let workorder = create_test_workorder(
        ctx,
        &fixture,
        production.id,
        workcenter.id,
        "COV-07D Primary",
    )?;
    let pending = create_test_workorder(
        ctx,
        &fixture,
        production.id,
        workcenter.id,
        "COV-07D Pending",
    )?;

    let parent_after_create = ctx
        .db
        .mrp_production()
        .id()
        .find(&production.id)
        .ok_or("parent MO missing after workorder create")?;
    if !parent_after_create.workorder_ids.contains(&workorder.id)
        || !parent_after_create.workorder_ids.contains(&pending.id)
    {
        return Err("parent MO does not own created workorders".to_string());
    }

    let center_after_create = ctx
        .db
        .mrp_workcenter()
        .id()
        .find(&workcenter.id)
        .ok_or("workcenter missing after workorder create")?;
    let mut expected_order_ids = vec![workorder.id, pending.id];
    expected_order_ids.sort_unstable();
    if center_after_create.order_ids != expected_order_ids
        || center_after_create.workorder_count != 2
        || center_after_create.workorder_pending_count != 2
        || center_after_create.workorder_progress_count != 0
    {
        return Err(format!(
            "workcenter create projection mismatch: ids={:?} total={} pending={} progress={}",
            center_after_create.order_ids,
            center_after_create.workorder_count,
            center_after_create.workorder_pending_count,
            center_after_create.workorder_progress_count
        ));
    }

    if log_workcenter_productivity(
        ctx,
        fixture.organization_id,
        workcenter.id,
        productivity_params(pending.id, None),
    )
    .is_ok()
    {
        return Err("productivity logging accepted a Pending workorder".to_string());
    }
    if productivity_count(ctx, workcenter.id) != 0 {
        return Err("rejected Pending productivity persisted a log".to_string());
    }

    start_workorder(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        workorder.id,
    )?;

    let started = ctx
        .db
        .mrp_workorder()
        .id()
        .find(&workorder.id)
        .ok_or("workorder missing after start")?;
    if started.state != WorkorderState::Progress || !started.is_user_working {
        return Err("workorder did not converge to Progress".to_string());
    }

    let center_after_start = ctx
        .db
        .mrp_workcenter()
        .id()
        .find(&workcenter.id)
        .ok_or("workcenter missing after start")?;
    if center_after_start.workorder_progress_count != 1
        || center_after_start.workorder_pending_count != 1
        || center_after_start.workorder_count != 2
    {
        return Err("workcenter state counts did not converge after start".to_string());
    }

    if start_workorder(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        workorder.id,
    )
    .is_ok()
    {
        return Err("stale workorder Start replay was accepted".to_string());
    }

    let duration = 2.5;
    log_workcenter_productivity(
        ctx,
        fixture.organization_id,
        workcenter.id,
        CreateWorkcenterProductivityParams {
            workorder_id: workorder.id,
            loss_id: None,
            description: Some("COV-07d exact productivity".to_string()),
            duration,
            metadata: Some(r#"{"cov":"07d"}"#.to_string()),
        },
    )?;

    let logs: Vec<_> = ctx
        .db
        .mrp_workcenter_productivity()
        .mrp_productivity_by_workorder()
        .filter(&workorder.id)
        .collect();
    if logs.len() != 1 {
        return Err(format!(
            "expected exactly one productivity effect, got {}",
            logs.len()
        ));
    }
    let log = &logs[0];
    if log.organization_id != fixture.organization_id
        || log.company_id != fixture.company_id
        || log.workcenter_id != workcenter.id
        || log.workorder_id != workorder.id
        || (log.duration - duration).abs() > 1e-9
        || log.date_end.is_some()
    {
        return Err("productivity effect did not match exact workorder scope".to_string());
    }

    let workorder_after_log = ctx
        .db
        .mrp_workorder()
        .id()
        .find(&workorder.id)
        .ok_or("workorder missing after productivity")?;
    if workorder_after_log.time_ids != vec![log.id]
        || (workorder_after_log.duration - duration).abs() > 1e-9
    {
        return Err(format!(
            "workorder productivity relation mismatch: ids={:?} duration={}",
            workorder_after_log.time_ids, workorder_after_log.duration
        ));
    }

    let center_after_log = ctx
        .db
        .mrp_workcenter()
        .id()
        .find(&workcenter.id)
        .ok_or("workcenter missing after productivity")?;
    if !center_after_log.productivity_ids.contains(&log.id)
        || (center_after_log.productive_time - duration).abs() > 1e-9
    {
        return Err("workcenter productivity relation/time mismatch".to_string());
    }

    finish_workorder(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        workorder.id,
    )?;

    let finished = ctx
        .db
        .mrp_workorder()
        .id()
        .find(&workorder.id)
        .ok_or("workorder missing after finish")?;
    if finished.state != WorkorderState::Done
        || finished.time_ids != vec![log.id]
        || (finished.duration - duration).abs() > 1e-9
        || (finished.progress - 100.0).abs() > 1e-9
        || !finished.is_produced
        || finished.is_user_working
        || finished.date_finished.is_none()
    {
        return Err("finished workorder did not preserve exact productivity effect".to_string());
    }

    let completed_log = ctx
        .db
        .mrp_workcenter_productivity()
        .id()
        .find(&log.id)
        .ok_or("productivity log missing after finish")?;
    if completed_log.date_end.is_none() {
        return Err("finish did not close the workorder productivity log".to_string());
    }

    let center_after_finish = ctx
        .db
        .mrp_workcenter()
        .id()
        .find(&workcenter.id)
        .ok_or("workcenter missing after finish")?;
    if center_after_finish.order_ids != expected_order_ids
        || center_after_finish.workorder_count != 2
        || center_after_finish.workorder_progress_count != 0
        || center_after_finish.workorder_pending_count != 1
        || !center_after_finish.productivity_ids.contains(&log.id)
        || (center_after_finish.productive_time - duration).abs() > 1e-9
    {
        return Err("workcenter projections changed incorrectly after finish".to_string());
    }

    if finish_workorder(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        workorder.id,
    )
    .is_ok()
    {
        return Err("stale workorder Finish replay was accepted".to_string());
    }

    let replayed = ctx
        .db
        .mrp_workorder()
        .id()
        .find(&workorder.id)
        .ok_or("workorder missing after replay")?;
    if replayed.time_ids != vec![log.id]
        || (replayed.duration - duration).abs() > 1e-9
        || replayed.state != WorkorderState::Done
    {
        return Err("Finish replay changed workorder productivity effect".to_string());
    }

    log::info!("test_workorder_execution_exact_effect passed");
    Ok(())
}
