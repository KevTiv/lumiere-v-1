//! Exact attributed output, tracked waste and in-progress material waste proof.
//! Products are isolated test fixture rows; all BOM, MO and stock effects use
//! their operational reducers.
use std::time::Duration;

use spacetimedb::{ReducerContext, Table};

use crate::inventory::product::{product, Product};
use crate::inventory::stock::{stock_move, stock_quant, StockQuant};
use crate::inventory::tracking::{
    create_stock_production_lot, create_stock_production_serial, stock_production_lot,
    stock_production_serial, CreateStockProductionLotParams, CreateStockProductionSerialParams,
    StockProductionLot, StockProductionSerial,
};
use crate::inventory::warehouse::{
    create_stock_location, stock_location, warehouse, CreateStockLocationParams,
};
use crate::manufacturing::bill_of_materials::{
    create_bom, create_bom_byproduct, mrp_bom, mrp_bom_byproduct, BomLineInput,
    CreateBomByproductParams, CreateBomParams, MrpBomByproduct,
};
use crate::manufacturing::manufacturing_orders::{
    confirm_manufacturing_order, consume_mo_materials, create_manufacturing_order,
    finish_manufacturing_order_with_tracking, mrp_production, produce_manufacturing_order,
    scrap_manufacturing_material, scrap_tracked_manufacturing_output, start_manufacturing_order,
    CreateMrpProductionParams, FinishManufacturingTrackingParams, ManufacturingByproductTracking,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::BomType;

#[spacetimedb::reducer]
pub fn run_manufacturing_tracked_output_test(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let primary = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("fixture product missing")?;
    ctx.db.product().id().update(Product {
        tracking: "lot".to_string(),
        ..ctx
            .db
            .product()
            .id()
            .find(&primary.id)
            .ok_or("primary fixture missing")?
    });
    let byproduct = ctx.db.product().insert(Product {
        id: 0,
        name: "COV-07L serial byproduct fixture".to_string(),
        tracking: "serial".to_string(),
        ..ctx
            .db
            .product()
            .id()
            .find(&primary.id)
            .ok_or("primary fixture missing")?
    });
    let lot_id = create_lot(ctx, &fixture, primary.id, "COV-07L primary")?;
    create_stock_production_serial(
        ctx,
        fixture.organization_id,
        CreateStockProductionSerialParams {
            company_id: Some(fixture.company_id),
            name: "COV-07L byproduct serial".to_string(),
            product_id: byproduct.id,
            product_variant_id: None,
            lot_id: None,
            ref_: None,
            note: None,
            expiration_date: None,
            use_date: None,
            removal_date: None,
            alert_date: None,
            product_qty: 1.0,
            location_id: None,
            package_id: None,
            owner_id: None,
            state: "free".to_string(),
            is_scrap: false,
            is_locked: false,
            warranty_expiration: None,
            warranty_start: None,
            last_maintenance: None,
            next_maintenance: None,
            maintenance_count: 0,
            metadata: None,
        },
    )?;
    let serial = ctx
        .db
        .stock_production_serial()
        .serial_by_product()
        .filter(&byproduct.id)
        .next()
        .ok_or("byproduct serial missing")?;
    let bom_id = create_test_bom(ctx, &fixture, primary.id, Vec::new())?;
    create_bom_byproduct(
        ctx,
        fixture.organization_id,
        bom_id,
        CreateBomByproductParams {
            product_id: byproduct.id,
            product_qty: 1.0,
            product_uom_id: primary.uom_id,
            cost_share: 20.0,
            sequence: 1,
            metadata: None,
        },
    )?;
    let definition = ctx
        .db
        .mrp_bom_byproduct()
        .mrp_bom_byproduct_by_bom()
        .filter(&bom_id)
        .next()
        .ok_or("byproduct definition missing")?;
    let mo_id = create_test_mo(ctx, &fixture, bom_id, "COV-07L-ATTRIBUTED")?;
    confirm_manufacturing_order(ctx, fixture.organization_id, fixture.company_id, mo_id)?;
    start_manufacturing_order(ctx, fixture.organization_id, fixture.company_id, mo_id)?;
    produce_manufacturing_order(ctx, fixture.organization_id, fixture.company_id, mo_id, 1.0)?;
    let attribution = FinishManufacturingTrackingParams {
        lot_id: Some(lot_id),
        serial_id: None,
        byproducts: vec![ManufacturingByproductTracking {
            bom_byproduct_id: definition.id,
            lot_id: None,
            serial_id: Some(serial.id),
        }],
    };
    let effects_before = owned_move_count(ctx, mo_id);
    let mut invalid = attribution.clone();
    invalid.byproducts[0].bom_byproduct_id = u64::MAX;
    reject_close_without_effect(ctx, &fixture, mo_id, invalid, effects_before)?;
    let mut invalid = attribution.clone();
    invalid.byproducts.push(invalid.byproducts[0].clone());
    reject_close_without_effect(ctx, &fixture, mo_id, invalid, effects_before)?;
    let other = OrgFixture::seed_minimal(ctx)?;
    let other_product = ctx
        .db
        .product()
        .id()
        .find(&other.product_id)
        .ok_or("foreign fixture missing")?;
    ctx.db.product().id().update(Product {
        tracking: "lot".to_string(),
        ..other_product
    });
    let other_lot = create_lot(ctx, &other, other.product_id, "COV-07L foreign")?;
    let mut invalid = attribution.clone();
    invalid.lot_id = Some(other_lot);
    reject_close_without_effect(ctx, &fixture, mo_id, invalid, effects_before)?;
    let lot = ctx
        .db
        .stock_production_lot()
        .id()
        .find(&lot_id)
        .ok_or("lot missing")?;
    ctx.db
        .stock_production_lot()
        .id()
        .update(StockProductionLot {
            company_id: other.company_id,
            ..lot.clone()
        });
    reject_close_without_effect(ctx, &fixture, mo_id, attribution.clone(), effects_before)?;
    ctx.db.stock_production_lot().id().update(lot.clone());
    ctx.db
        .stock_production_lot()
        .id()
        .update(StockProductionLot {
            is_locked: true,
            ..lot.clone()
        });
    reject_close_without_effect(ctx, &fixture, mo_id, attribution.clone(), effects_before)?;
    ctx.db.stock_production_lot().id().update(lot);
    ctx.db
        .stock_production_serial()
        .id()
        .update(StockProductionSerial {
            is_locked: true,
            ..serial.clone()
        });
    reject_close_without_effect(ctx, &fixture, mo_id, attribution.clone(), effects_before)?;
    ctx.db.stock_production_serial().id().update(serial.clone());
    ctx.db.mrp_bom_byproduct().id().update(MrpBomByproduct {
        product_qty: 0.5,
        ..definition.clone()
    });
    reject_close_without_effect(ctx, &fixture, mo_id, attribution.clone(), effects_before)?;
    ctx.db.mrp_bom_byproduct().id().update(definition);
    finish_manufacturing_order_with_tracking(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        mo_id,
        attribution.clone(),
    )?;
    let mo = ctx
        .db
        .mrp_production()
        .id()
        .find(&mo_id)
        .ok_or("closed MO missing")?;
    let moves: Vec<_> = mo
        .move_finished_ids
        .iter()
        .filter_map(|id| ctx.db.stock_move().id().find(id))
        .collect();
    if moves.len() != 2 || mo.lot_producing_id != Some(lot_id) {
        return Err("attributed close did not own exactly two outputs".to_string());
    }
    let lot_output = moves
        .iter()
        .find(|mv| mv.product_id == primary.id)
        .ok_or("primary output missing")?;
    let serial_output = moves
        .iter()
        .find(|mv| mv.product_id == byproduct.id)
        .ok_or("serial output missing")?;
    if lot_output.lot_id != Some(lot_id)
        || !lot_output.has_tracking
        || serial_output.serial_id != Some(serial.id)
        || !serial_output.has_tracking
        || !lot_output.is_done
        || !serial_output.is_done
    {
        return Err("output move lost exact tracking attribution".to_string());
    }
    let lot_quant = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&primary.id)
        .find(|q| {
            q.company_id == fixture.company_id
                && q.location_id == mo.location_dest_id
                && q.lot_id == Some(lot_id)
        })
        .ok_or("lot output quant missing")?;
    if (lot_quant.quantity - 1.0).abs() > 1e-9 {
        return Err("lot output was posted outside its exact quant identity".to_string());
    }
    let posted_serial = ctx
        .db
        .stock_production_serial()
        .id()
        .find(&serial.id)
        .ok_or("serial missing")?;
    if posted_serial.location_id != Some(mo.location_dest_id) || posted_serial.state != "free" {
        return Err("serial output placement did not converge".to_string());
    }
    reject_close_without_effect(
        ctx,
        &fixture,
        mo_id,
        attribution,
        owned_move_count(ctx, mo_id),
    )?;
    let scrap_id = create_scrap_location(ctx, &fixture)?;
    let before_scrap = owned_move_count(ctx, mo_id);
    if scrap_tracked_manufacturing_output(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        mo_id,
        serial_output.id,
        scrap_id,
        0.5,
        "fractional".to_string(),
    )
    .is_ok()
        || owned_move_count(ctx, mo_id) != before_scrap
    {
        return Err("fractional serial scrap changed effects".to_string());
    }
    if scrap_tracked_manufacturing_output(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        mo_id,
        u64::MAX,
        scrap_id,
        0.1,
        "foreign-output".to_string(),
    )
    .is_ok()
        || owned_move_count(ctx, mo_id) != before_scrap
    {
        return Err("unowned output scrap changed effects".to_string());
    }
    scrap_tracked_manufacturing_output(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        mo_id,
        lot_output.id,
        scrap_id,
        0.4,
        "lot-waste".to_string(),
    )?;
    let after_scrap = owned_move_count(ctx, mo_id);
    for (quantity, request) in [(0.4, "lot-waste"), (0.7, "too-much")] {
        if scrap_tracked_manufacturing_output(
            ctx,
            fixture.organization_id,
            fixture.company_id,
            mo_id,
            lot_output.id,
            scrap_id,
            quantity,
            request.to_string(),
        )
        .is_ok()
            || owned_move_count(ctx, mo_id) != after_scrap
        {
            return Err("replayed or excessive lot scrap changed effects".to_string());
        }
    }
    let lot_remaining = ctx
        .db
        .stock_quant()
        .id()
        .find(&lot_quant.id)
        .ok_or("source lot missing")?;
    let lot_scrap = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&primary.id)
        .find(|q| {
            q.company_id == fixture.company_id
                && q.location_id == scrap_id
                && q.lot_id == Some(lot_id)
        })
        .ok_or("lot scrap quant missing")?;
    if (lot_remaining.quantity - 0.6).abs() > 1e-9 || (lot_scrap.quantity - 0.4).abs() > 1e-9 {
        return Err("lot scrap stock identity or conservation failed".to_string());
    }
    scrap_tracked_manufacturing_output(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        mo_id,
        serial_output.id,
        scrap_id,
        1.0,
        "serial-waste".to_string(),
    )?;
    let scrapped_serial = ctx
        .db
        .stock_production_serial()
        .id()
        .find(&serial.id)
        .ok_or("serial disappeared")?;
    if scrapped_serial.location_id != Some(scrap_id)
        || !scrapped_serial.is_scrap
        || scrapped_serial.state != "scrapped"
    {
        return Err("serial scrap lost exact serial lifecycle".to_string());
    }
    let effects_after = owned_move_count(ctx, mo_id);
    if scrap_tracked_manufacturing_output(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        mo_id,
        serial_output.id,
        scrap_id,
        1.0,
        "serial-waste".to_string(),
    )
    .is_ok()
        || owned_move_count(ctx, mo_id) != effects_after
    {
        return Err("serial scrap replay changed effects".to_string());
    }
    test_material_wastage(ctx)?;
    test_serial_primary_lot_byproduct(ctx)?;
    Ok(())
}

fn test_serial_primary_lot_byproduct(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let primary = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("serial primary fixture missing")?;
    ctx.db.product().id().update(Product {
        tracking: "serial".to_string(),
        ..ctx
            .db
            .product()
            .id()
            .find(&primary.id)
            .ok_or("serial primary fixture missing")?
    });
    let byproduct = ctx.db.product().insert(Product {
        id: 0,
        name: "COV-07L lot byproduct fixture".to_string(),
        tracking: "lot".to_string(),
        ..ctx
            .db
            .product()
            .id()
            .find(&primary.id)
            .ok_or("serial primary fixture missing")?
    });
    let lot_id = create_lot(ctx, &fixture, byproduct.id, "COV-07L byproduct lot")?;
    create_stock_production_serial(
        ctx,
        fixture.organization_id,
        CreateStockProductionSerialParams {
            company_id: Some(fixture.company_id),
            name: "COV-07L primary serial".to_string(),
            product_id: primary.id,
            product_variant_id: None,
            lot_id: None,
            ref_: None,
            note: None,
            expiration_date: None,
            use_date: None,
            removal_date: None,
            alert_date: None,
            product_qty: 1.0,
            location_id: None,
            package_id: None,
            owner_id: None,
            state: "free".to_string(),
            is_scrap: false,
            is_locked: false,
            warranty_expiration: None,
            warranty_start: None,
            last_maintenance: None,
            next_maintenance: None,
            maintenance_count: 0,
            metadata: None,
        },
    )?;
    let serial_id = ctx
        .db
        .stock_production_serial()
        .serial_by_product()
        .filter(&primary.id)
        .next()
        .ok_or("primary serial missing")?
        .id;
    let bom_id = create_test_bom(ctx, &fixture, primary.id, Vec::new())?;
    create_bom_byproduct(
        ctx,
        fixture.organization_id,
        bom_id,
        CreateBomByproductParams {
            product_id: byproduct.id,
            product_qty: 0.5,
            product_uom_id: primary.uom_id,
            cost_share: 10.0,
            sequence: 1,
            metadata: None,
        },
    )?;
    let definition_id = ctx
        .db
        .mrp_bom_byproduct()
        .mrp_bom_byproduct_by_bom()
        .filter(&bom_id)
        .next()
        .ok_or("lot byproduct definition missing")?
        .id;
    let mo_id = create_test_mo(ctx, &fixture, bom_id, "COV-07L-SERIAL-PRIMARY")?;
    confirm_manufacturing_order(ctx, fixture.organization_id, fixture.company_id, mo_id)?;
    start_manufacturing_order(ctx, fixture.organization_id, fixture.company_id, mo_id)?;
    produce_manufacturing_order(ctx, fixture.organization_id, fixture.company_id, mo_id, 1.0)?;
    finish_manufacturing_order_with_tracking(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        mo_id,
        FinishManufacturingTrackingParams {
            lot_id: None,
            serial_id: Some(serial_id),
            byproducts: vec![ManufacturingByproductTracking {
                bom_byproduct_id: definition_id,
                lot_id: Some(lot_id),
                serial_id: None,
            }],
        },
    )?;
    let mo = ctx
        .db
        .mrp_production()
        .id()
        .find(&mo_id)
        .ok_or("serial primary MO missing")?;
    let moves: Vec<_> = mo
        .move_finished_ids
        .iter()
        .filter_map(|id| ctx.db.stock_move().id().find(id))
        .collect();
    let primary_move = moves
        .iter()
        .find(|mv| mv.product_id == primary.id)
        .ok_or("serial primary move missing")?;
    let byproduct_move = moves
        .iter()
        .find(|mv| mv.product_id == byproduct.id)
        .ok_or("lot byproduct move missing")?;
    if primary_move.serial_id != Some(serial_id)
        || byproduct_move.lot_id != Some(lot_id)
        || (byproduct_move.quantity_done - 0.5).abs() > 1e-9
    {
        return Err("serial primary or lot byproduct lost exact attribution".to_string());
    }
    let scrap_id = create_scrap_location(ctx, &fixture)?;
    scrap_tracked_manufacturing_output(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        mo_id,
        primary_move.id,
        scrap_id,
        1.0,
        "primary-serial".to_string(),
    )?;
    scrap_tracked_manufacturing_output(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        mo_id,
        byproduct_move.id,
        scrap_id,
        0.2,
        "byproduct-lot".to_string(),
    )?;
    let remaining: f64 = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&byproduct.id)
        .filter(|q| {
            q.company_id == fixture.company_id
                && q.location_id == mo.location_dest_id
                && q.lot_id == Some(lot_id)
        })
        .map(|q| q.quantity)
        .sum();
    if (remaining - 0.3).abs() > 1e-9 {
        return Err("lot byproduct scrap did not conserve exact output".to_string());
    }
    Ok(())
}

fn reject_close_without_effect(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    mo_id: u64,
    params: FinishManufacturingTrackingParams,
    before: usize,
) -> Result<(), String> {
    if finish_manufacturing_order_with_tracking(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        mo_id,
        params,
    )
    .is_ok()
        || owned_move_count(ctx, mo_id) != before
    {
        return Err("denied/replayed attributed close changed output effects".to_string());
    }
    Ok(())
}

fn owned_move_count(ctx: &ReducerContext, mo_id: u64) -> usize {
    ctx.db
        .stock_move()
        .iter()
        .filter(|mv| mv.production_id == Some(mo_id))
        .count()
}

fn create_lot(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    product_id: u64,
    name: &str,
) -> Result<u64, String> {
    create_stock_production_lot(
        ctx,
        fixture.organization_id,
        CreateStockProductionLotParams {
            company_id: Some(fixture.company_id),
            name: name.to_string(),
            product_id,
            product_variant_id: None,
            ref_: None,
            note: None,
            expiration_date: None,
            use_date: None,
            removal_date: None,
            alert_date: None,
            product_qty: 0.0,
            location_id: None,
            package_id: None,
            owner_id: None,
            is_scrap: false,
            is_locked: false,
            metadata: None,
        },
    )?;
    ctx.db
        .stock_production_lot()
        .lot_by_product()
        .filter(&product_id)
        .find(|lot| lot.organization_id == fixture.organization_id && lot.name == name)
        .map(|lot| lot.id)
        .ok_or_else(|| "test lot missing".to_string())
}

fn create_test_bom(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    product_id: u64,
    lines: Vec<BomLineInput>,
) -> Result<u64, String> {
    let product = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or("BOM product missing")?;
    create_bom(
        ctx,
        fixture.organization_id,
        CreateBomParams {
            company_id: Some(fixture.company_id),
            type_: BomType::Manufacture,
            product_id,
            product_qty: 1.0,
            product_uom_id: product.uom_id,
            ready_to_produce: "all_available".to_string(),
            consumption: "flexible".to_string(),
            sequence: 10,
            lines,
            picking_type_id: None,
            location_src_id: Some(fixture.location_id),
            location_dest_id: Some(fixture.location_id),
            warehouse_id: Some(fixture.warehouse_id),
            routing_id: None,
            metadata: None,
        },
    )?;
    ctx.db
        .mrp_bom()
        .mrp_bom_by_product()
        .filter(&product_id)
        .find(|bom| {
            bom.organization_id == fixture.organization_id && bom.company_id == fixture.company_id
        })
        .map(|bom| bom.id)
        .ok_or_else(|| "test BOM missing".to_string())
}

fn create_test_mo(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    bom_id: u64,
    origin: &str,
) -> Result<u64, String> {
    let product = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("MO product missing")?;
    let warehouse = ctx
        .db
        .warehouse()
        .id()
        .find(&fixture.warehouse_id)
        .ok_or("warehouse missing")?;
    create_manufacturing_order(
        ctx,
        fixture.organization_id,
        CreateMrpProductionParams {
            company_id: Some(fixture.company_id),
            product_id: product.id,
            product_qty: 1.0,
            product_uom_id: product.uom_id,
            date_planned_start: ctx.timestamp,
            date_planned_finished: ctx.timestamp + Duration::from_secs(3600),
            location_src_id: warehouse.lot_stock_id,
            location_dest_id: warehouse.lot_stock_id,
            warehouse_id: warehouse.id,
            picking_type_id: warehouse.pick_type_id,
            consumption: None,
            bom_id: Some(bom_id),
            routing_id: None,
            proc_group_id: None,
            procurement_group_id: None,
            date_deadline: None,
            origin: Some(origin.to_string()),
            responsible_user_id: None,
            metadata: None,
        },
    )?;
    ctx.db
        .mrp_production()
        .mrp_production_by_org()
        .filter(&fixture.organization_id)
        .find(|mo| mo.origin.as_deref() == Some(origin))
        .map(|mo| mo.id)
        .ok_or_else(|| "test MO missing".to_string())
}

fn create_scrap_location(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    create_stock_location(
        ctx,
        fixture.organization_id,
        CreateStockLocationParams {
            name: "COV-07L scrap".to_string(),
            usage: "inventory".to_string(),
            location_category: "scrap".to_string(),
            parent_path: "/".to_string(),
            child_left: 0,
            child_right: 0,
            scrap_location: true,
            return_location: false,
            active: true,
            posx: 0.0,
            posy: 0.0,
            posz: 0.0,
            cyclic_inventory_frequency: 0,
            location_id: None,
            complete_name: None,
            valuation_in_account_id: None,
            valuation_out_account_id: None,
            comment: None,
            barcode: None,
            last_inventory_date: None,
            next_inventory_date: None,
            metadata: None,
        },
    )?;
    ctx.db
        .stock_location()
        .iter()
        .find(|loc| loc.organization_id == fixture.organization_id && loc.name == "COV-07L scrap")
        .map(|loc| loc.id)
        .ok_or_else(|| "scrap location missing".to_string())
}

fn test_material_wastage(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let primary = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("material fixture missing")?;
    let component = ctx.db.product().insert(Product {
        id: 0,
        name: "COV-07L material fixture".to_string(),
        ..ctx
            .db
            .product()
            .id()
            .find(&primary.id)
            .ok_or("material fixture missing")?
    });
    let bom_id = create_test_bom(
        ctx,
        &fixture,
        primary.id,
        vec![BomLineInput {
            product_id: component.id,
            product_qty: 2.0,
            product_uom_id: component.uom_id,
            sequence: 1,
            manual_consumption: false,
            attachments_count: 0,
            operation_id: None,
            child_bom_id: None,
            bom_product_template_attribute_value_ids: Vec::new(),
            possible_bom_product_template_attribute_value_ids: Vec::new(),
            metadata: None,
        }],
    )?;
    let mo_id = create_test_mo(ctx, &fixture, bom_id, "COV-07L-MATERIAL")?;
    let scrap_id = create_scrap_location(ctx, &fixture)?;
    let base_quant = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&primary.id)
        .find(|q| q.company_id == fixture.company_id && q.location_id == fixture.location_id)
        .ok_or("base fixture quant missing")?;
    let source = ctx.db.stock_quant().insert(StockQuant {
        id: 0,
        product_id: component.id,
        quantity: 5.0,
        available_quantity: 5.0,
        reserved_quantity: 0.0,
        inventory_quantity: 5.0,
        value: 5.0 * base_quant.cost,
        ..base_quant
    });
    if scrap_manufacturing_material(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        mo_id,
        source.id,
        scrap_id,
        0.5,
        "draft".to_string(),
    )
    .is_ok()
    {
        return Err("draft material scrap was accepted".to_string());
    }
    confirm_manufacturing_order(ctx, fixture.organization_id, fixture.company_id, mo_id)?;
    start_manufacturing_order(ctx, fixture.organization_id, fixture.company_id, mo_id)?;
    if scrap_manufacturing_material(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        mo_id,
        u64::MAX,
        scrap_id,
        0.5,
        "foreign-quant".to_string(),
    )
    .is_ok()
    {
        return Err("unowned material scrap was accepted".to_string());
    }
    scrap_manufacturing_material(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        mo_id,
        source.id,
        scrap_id,
        0.5,
        "material-waste".to_string(),
    )?;
    let count_after = owned_move_count(ctx, mo_id);
    if scrap_manufacturing_material(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        mo_id,
        source.id,
        scrap_id,
        0.5,
        "material-waste".to_string(),
    )
    .is_ok()
        || owned_move_count(ctx, mo_id) != count_after
    {
        return Err("material scrap replay changed effects".to_string());
    }
    let before_consumption = ctx
        .db
        .stock_quant()
        .id()
        .find(&source.id)
        .ok_or("material source missing")?;
    if (before_consumption.quantity - 4.5).abs() > 1e-9 {
        return Err("material wastage did not conserve source stock".to_string());
    }
    consume_mo_materials(ctx, fixture.organization_id, fixture.company_id, mo_id)?;
    let consumed = ctx
        .db
        .mrp_production()
        .id()
        .find(&mo_id)
        .ok_or("consumed MO missing")?;
    if consumed.move_raw_ids.len() != 1 {
        return Err("material scrap was confused with BOM consumption".to_string());
    }
    let raw = ctx
        .db
        .stock_move()
        .id()
        .find(&consumed.move_raw_ids[0])
        .ok_or("consumption move missing")?;
    if raw.scrapped || (raw.quantity_done - 2.0).abs() > 1e-9 {
        return Err("additional material waste reduced the original BOM requirement".to_string());
    }
    if scrap_manufacturing_material(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        mo_id,
        source.id,
        scrap_id,
        0.5,
        "after-consumption".to_string(),
    )
    .is_ok()
    {
        return Err("material scrap after consumption was accepted".to_string());
    }
    Ok(())
}
