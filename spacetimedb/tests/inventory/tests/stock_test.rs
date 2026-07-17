/// Stock quant domain tests — in-module test helpers.
///
/// Full incoming-picking → validate → quant flow requires picking-type/location
/// scaffolding beyond [`OrgFixture::seed_minimal`]; we smoke-test quant creation
/// and quantity updates directly until warehouse graph is seeded in harness.
use spacetimedb::{ReducerContext, Table};

use crate::inventory::stock::{
    create_stock_quant, stock_quant, update_stock_quant_quantity, CreateStockQuantParams,
    UpdateStockQuantQuantityParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

pub fn test_stock_quant_create(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;

    // Harness warehouse row doubles as location stub (see inventory_adjustments_tests).
    let location_id = fixture.warehouse_id;
    let initial_qty = 5.0;

    create_stock_quant(
        ctx,
        org_id,
        CreateStockQuantParams {
            company_id: Some(fixture.company_id),
            product_id: fixture.product_id,
            product_variant_id: None,
            location_id,
            lot_id: None,
            package_id: None,
            owner_id: None,
            quantity: initial_qty,
            reserved_quantity: 0.0,
            in_date: Some(ctx.timestamp),
            inventory_quantity: 0.0,
            inventory_diff_quantity: 0.0,
            inventory_quantity_set: false,
            is_outdated: false,
            user_id: None,
            inventory_date: None,
            cost: 10.0,
            cost_method: Some("standard".to_string()),
            accounting_date: None,
            currency_id: Some(1),
            accounting_entry_ids: vec![],
            metadata: Some(r#"{"test":"stock_quant_create"}"#.to_string()),
        },
    )?;

    // Prefer the row we just created (metadata marker). seed_minimal / prior tests may
    // leave other quants on the same product+location in this org.
    let quant = ctx
        .db
        .stock_quant()
        .iter()
        .filter(|q| {
            q.organization_id == org_id
                && q.product_id == fixture.product_id
                && q.location_id == location_id
                && q.metadata.as_deref() == Some(r#"{"test":"stock_quant_create"}"#)
        })
        .max_by_key(|q| q.id)
        .ok_or("Stock quant not found after create")?;

    if (quant.quantity - initial_qty).abs() > 0.001 {
        return Err(format!(
            "Expected quantity {initial_qty}, got {}",
            quant.quantity
        ));
    }

    // Simulate receipt qty increase without full picking validate path.
    let receipt_delta = 3.0;
    update_stock_quant_quantity(
        ctx,
        org_id,
        quant.id,
        UpdateStockQuantQuantityParams {
            company_id: Some(fixture.company_id),
            quantity: initial_qty + receipt_delta,
        },
    )?;

    let updated = ctx
        .db
        .stock_quant()
        .id()
        .find(&quant.id)
        .ok_or("Stock quant not found after update")?;

    if (updated.quantity - (initial_qty + receipt_delta)).abs() > 0.001 {
        return Err(format!(
            "Expected quantity {} after receipt, got {}",
            initial_qty + receipt_delta,
            updated.quantity
        ));
    }

    Ok(())
}
