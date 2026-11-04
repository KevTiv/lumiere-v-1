//! Persisted correction regressions, executed by the existing inventory adjustment gate.
use spacetimedb::{ReducerContext, Table};

use crate::inventory::cycle_count::{
    create_cycle_count_plan, post_cycle_count_adjustments, record_cycle_count_line,
    start_cycle_count_session, stock_count_sheet, stock_cycle_count, validate_cycle_count,
    CreateCycleCountPlanParams, RecordCycleCountLineParams,
};
use crate::inventory::inventory_adjustments::{
    adjustment_reason, create_inventory_adjustment, inventory_adjustment,
    process_inventory_adjustment, AdjustmentReason, CreateInventoryAdjustmentParams,
};
use crate::inventory::inventory_close::{inventory_close, InventoryClose};
use crate::inventory::product::{product, Product};
use crate::inventory::stock::{stock_quant, StockQuant};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

fn rejected(result: Result<(), String>, expected: &str) -> Result<(), String> {
    match result {
        Err(error) if error.to_lowercase().contains(expected) => Ok(()),
        Err(error) => Err(format!("expected {expected:?}, got {error:?}")),
        Ok(()) => Err(format!("expected rejection containing {expected:?}")),
    }
}

fn quant(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<StockQuant, String> {
    ctx.db
        .stock_quant()
        .quant_by_product()
        .filter(&fixture.product_id)
        .find(|q| {
            q.organization_id == fixture.organization_id
                && q.company_id == fixture.company_id
                && q.location_id == fixture.location_id
                && q.package_id.is_none()
                && q.owner_id.is_none()
        })
        .ok_or_else(|| "fixture quant missing".to_string())
}

fn adjustment_params(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
) -> Result<CreateInventoryAdjustmentParams, String> {
    let uom_id = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("fixture product missing")?
        .uom_id;
    let reason = ctx.db.adjustment_reason().insert(AdjustmentReason {
        id: 0,
        organization_id: fixture.organization_id,
        code: "CORRECTION_REGRESSION".to_string(),
        description: None,
        is_active: true,
        is_system: false,
        created_at: ctx.timestamp,
        metadata: None,
    });
    Ok(CreateInventoryAdjustmentParams {
        name: "Correction regression".to_string(),
        product_id: fixture.product_id,
        location_id: fixture.location_id,
        quantity_after: 73.25,
        reason_id: reason.id,
        adjustment_type: "inventory".to_string(),
        inventory_id: None,
        lot_id: None,
        package_id: None,
        uom_id,
        reason_notes: Some("physical recount".to_string()),
        metadata: None,
    })
}

fn adjustment_id(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    ctx.db
        .inventory_adjustment()
        .adjustment_by_org()
        .filter(&fixture.organization_id)
        .find(|a| a.name == "Correction regression")
        .map(|a| a.id)
        .ok_or_else(|| "adjustment missing".to_string())
}

fn assert_quant(
    ctx: &ReducerContext,
    id: u64,
    quantity: f64,
    reserved: f64,
    value: f64,
) -> Result<(), String> {
    let q = ctx.db.stock_quant().id().find(&id).ok_or("quant missing")?;
    if q.quantity != quantity
        || q.reserved_quantity != reserved
        || q.available_quantity != quantity - reserved
        || q.value != value
    {
        return Err(format!(
            "unexpected quant {id}: qty={}, reserved={}, available={}, value={}",
            q.quantity, q.reserved_quantity, q.available_quantity, q.value
        ));
    }
    Ok(())
}

pub fn test_stock_correction_regressions(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    adjustment_write_down_and_replay(ctx)?;
    adjustment_stale_and_reservation_conflicts(ctx)?;
    adjustment_invalid_and_ambiguous_targets(ctx)?;
    correction_period_lock(ctx)?;
    cycle_count_preflights_all_lines(ctx)?;
    Ok(())
}

fn adjustment_write_down_and_replay(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let original = quant(ctx, &fixture)?;
    let id = original.id;
    ctx.db.stock_quant().id().update(StockQuant {
        reserved_quantity: 12.5,
        available_quantity: 87.5,
        ..original
    });
    let params = adjustment_params(ctx, &fixture)?;
    create_inventory_adjustment(ctx, fixture.organization_id, params)?;
    let adjustment_id = adjustment_id(ctx, &fixture)?;
    process_inventory_adjustment(ctx, fixture.organization_id, adjustment_id)?;
    assert_quant(ctx, id, 73.25, 12.5, 732.5)?;
    process_inventory_adjustment(ctx, fixture.organization_id, adjustment_id)?;
    assert_quant(ctx, id, 73.25, 12.5, 732.5)
}

fn adjustment_stale_and_reservation_conflicts(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let params = adjustment_params(ctx, &fixture)?;
    create_inventory_adjustment(ctx, fixture.organization_id, params)?;
    let id = adjustment_id(ctx, &fixture)?;
    let original = quant(ctx, &fixture)?;
    let quant_id = original.id;
    ctx.db.stock_quant().id().update(StockQuant {
        quantity: 103.0,
        available_quantity: 103.0,
        value: 1030.0,
        ..original
    });
    rejected(
        process_inventory_adjustment(ctx, fixture.organization_id, id),
        "stock changed",
    )?;
    assert_quant(ctx, quant_id, 103.0, 0.0, 1030.0)?;
    let current = quant(ctx, &fixture)?;
    ctx.db.stock_quant().id().update(StockQuant {
        quantity: 100.0,
        reserved_quantity: 80.0,
        available_quantity: 20.0,
        value: 1000.0,
        ..current
    });
    rejected(
        process_inventory_adjustment(ctx, fixture.organization_id, id),
        "reserved",
    )?;
    assert_quant(ctx, quant_id, 100.0, 80.0, 1000.0)?;
    let draft = ctx
        .db
        .inventory_adjustment()
        .id()
        .find(&id)
        .ok_or("draft missing")?;
    if draft.state != "draft" || draft.posted_at.is_some() {
        return Err("rejected correction marked the draft processed".to_string());
    }
    Ok(())
}

fn adjustment_invalid_and_ambiguous_targets(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let params = adjustment_params(ctx, &fixture)?;
    let count = ctx.db.inventory_adjustment().iter().count();
    for value in [-1.0, f64::NAN, f64::INFINITY] {
        rejected(
            create_inventory_adjustment(
                ctx,
                fixture.organization_id,
                CreateInventoryAdjustmentParams {
                    quantity_after: value,
                    ..params.clone()
                },
            ),
            "finite",
        )?;
    }
    let foreign = OrgFixture::seed_minimal(ctx)?;
    rejected(
        create_inventory_adjustment(
            ctx,
            fixture.organization_id,
            CreateInventoryAdjustmentParams {
                location_id: foreign.location_id,
                ..params.clone()
            },
        ),
        "organization",
    )?;
    let original = quant(ctx, &fixture)?;
    ctx.db.stock_quant().insert(StockQuant {
        id: 0,
        cost: 17.0,
        value: 1700.0,
        ..original
    });
    rejected(
        create_inventory_adjustment(ctx, fixture.organization_id, params),
        "ambiguous",
    )?;
    if ctx.db.inventory_adjustment().iter().count() != count {
        return Err("invalid correction created an adjustment draft".to_string());
    }
    Ok(())
}

fn correction_period_lock(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let params = adjustment_params(ctx, &fixture)?;
    create_inventory_adjustment(ctx, fixture.organization_id, params)?;
    let id = adjustment_id(ctx, &fixture)?;
    ctx.db.inventory_close().insert(InventoryClose {
        id: 0,
        organization_id: fixture.organization_id,
        company_id: fixture.company_id,
        name: "Correction lock regression".to_string(),
        as_of: ctx.timestamp,
        state: "closed".to_string(),
        locked: true,
        line_count: 0,
        total_quantity: 0.0,
        total_value: 0.0,
        journal_id: None,
        inventory_account_id: None,
        valuation_account_id: None,
        account_move_id: None,
        closed_at: Some(ctx.timestamp),
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });
    rejected(
        process_inventory_adjustment(ctx, fixture.organization_id, id),
        "locked",
    )?;
    assert_quant(ctx, quant(ctx, &fixture)?.id, 100.0, 0.0, 1000.0)
}

fn cycle_count_preflights_all_lines(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let first_quant = quant(ctx, &fixture)?;
    let first_quant_id = first_quant.id;
    let product = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("product missing")?;
    let uom_id = product.uom_id;
    let second_product = ctx.db.product().insert(Product {
        id: 0,
        name: "Second correction target".to_string(),
        ..product
    });
    let second_quant = ctx.db.stock_quant().insert(StockQuant {
        id: 0,
        product_id: second_product.id,
        quantity: 20.0,
        reserved_quantity: 15.0,
        available_quantity: 5.0,
        value: 200.0,
        ..first_quant
    });
    create_cycle_count_plan(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        fixture.location_id,
        CreateCycleCountPlanParams {
            name: Some("Atomic correction regression".to_string()),
            count_by: "product".to_string(),
            frequency: "manual".to_string(),
            tolerance_percentage: 0.0,
            tolerance_value: 0.0,
            next_count_date: None,
            user_id: None,
            team_id: None,
            product_ids: vec![fixture.product_id, second_product.id],
            product_category_ids: vec![],
            reason: Some("physical recount".to_string()),
            notes: None,
            metadata: None,
        },
    )?;
    let cycle_id = ctx
        .db
        .stock_cycle_count()
        .cycle_count_by_org()
        .filter(&fixture.organization_id)
        .find(|c| c.name == "Atomic correction regression")
        .map(|c| c.id)
        .ok_or("cycle missing")?;
    start_cycle_count_session(ctx, fixture.organization_id, fixture.company_id, cycle_id)?;
    // A packaged-only target cannot be counted through a DTO without a package selector.
    let packaged = ctx
        .db
        .stock_quant()
        .id()
        .find(&first_quant_id)
        .ok_or("first quant missing")?;
    ctx.db.stock_quant().id().update(StockQuant {
        package_id: Some(u64::MAX),
        ..packaged
    });
    rejected(
        record_cycle_count_line(
            ctx,
            fixture.organization_id,
            fixture.company_id,
            cycle_id,
            RecordCycleCountLineParams {
                product_id: fixture.product_id,
                location_id: fixture.location_id,
                lot_id: None,
                qty_counted: 93.5,
                uom_id,
                notes: None,
                metadata: None,
            },
        ),
        "packaged",
    )?;
    let packaged = ctx
        .db
        .stock_quant()
        .id()
        .find(&first_quant_id)
        .ok_or("first quant missing")?;
    ctx.db.stock_quant().id().update(StockQuant {
        package_id: None,
        ..packaged
    });
    for (product_id, qty_counted) in [(fixture.product_id, 93.5), (second_product.id, 7.0)] {
        record_cycle_count_line(
            ctx,
            fixture.organization_id,
            fixture.company_id,
            cycle_id,
            RecordCycleCountLineParams {
                product_id,
                location_id: fixture.location_id,
                lot_id: None,
                qty_counted,
                uom_id,
                notes: None,
                metadata: None,
            },
        )?;
    }
    validate_cycle_count(ctx, fixture.organization_id, fixture.company_id, cycle_id)?;
    // Package changes after recording must also reject before any line is changed.
    let first = ctx
        .db
        .stock_quant()
        .id()
        .find(&first_quant_id)
        .ok_or("first quant missing")?;
    let extra = ctx.db.stock_quant().insert(StockQuant {
        id: 0,
        package_id: Some(u64::MAX),
        ..first
    });
    rejected(
        post_cycle_count_adjustments(ctx, fixture.organization_id, fixture.company_id, cycle_id),
        "packaged",
    )?;
    assert_quant(ctx, first_quant_id, 100.0, 0.0, 1000.0)?;
    ctx.db.stock_quant().id().delete(&extra.id);

    rejected(
        post_cycle_count_adjustments(ctx, fixture.organization_id, fixture.company_id, cycle_id),
        "reserved",
    )?;
    assert_quant(ctx, first_quant_id, 100.0, 0.0, 1000.0)?;
    assert_quant(ctx, second_quant.id, 20.0, 15.0, 200.0)?;
    if ctx
        .db
        .stock_count_sheet()
        .count_sheet_by_cycle()
        .filter(&cycle_id)
        .any(|s| s.is_processed)
    {
        return Err("failed multi-line preflight marked a line processed".to_string());
    }
    let current = ctx
        .db
        .stock_quant()
        .id()
        .find(&second_quant.id)
        .ok_or("second quant missing")?;
    ctx.db.stock_quant().id().update(StockQuant {
        reserved_quantity: 2.0,
        available_quantity: 18.0,
        ..current
    });
    post_cycle_count_adjustments(ctx, fixture.organization_id, fixture.company_id, cycle_id)?;
    assert_quant(ctx, first_quant_id, 93.5, 0.0, 935.0)?;
    assert_quant(ctx, second_quant.id, 7.0, 2.0, 70.0)?;
    rejected(
        post_cycle_count_adjustments(ctx, fixture.organization_id, fixture.company_id, cycle_id),
        "validated",
    )?;
    Ok(())
}
