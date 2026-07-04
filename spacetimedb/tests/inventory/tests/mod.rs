//! Inventory domain test suite — invoke via `run_all_inventory_tests` reducer.
pub mod inventory_adjustments_tests;
pub mod product_category_tests;
pub mod product_update_test;
pub mod stock_picking_quant_test;
pub mod stock_test;

use spacetimedb::ReducerContext;

/// Run all inventory domain tests. Call from SpacetimeDB client or CLI:
/// `spacetime call <db> run_all_inventory_tests`
#[spacetimedb::reducer]
pub fn run_all_inventory_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_inventory_product_category_test(ctx)?;
    run_inventory_product_update_test(ctx)?;
    run_inventory_stock_inventory_test(ctx)?;
    run_inventory_adjustment_test(ctx)?;
    run_inventory_stock_quant_test(ctx)?;
    run_inventory_receipt_quant_test(ctx)?;
    run_inventory_delivery_quant_test(ctx)?;
    log::info!("✅ run_all_inventory_tests complete");
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_inventory_product_category_test(ctx: &ReducerContext) -> Result<(), String> {
    product_category_tests::test_product_category_lifecycle(ctx)
        .map_err(|e| format!("product_category: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_product_update_test(ctx: &ReducerContext) -> Result<(), String> {
    product_update_test::test_product_update_and_delete(ctx)
        .map_err(|e| format!("product_update: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_stock_inventory_test(ctx: &ReducerContext) -> Result<(), String> {
    inventory_adjustments_tests::test_stock_inventory_create(ctx)
        .map_err(|e| format!("stock_inventory: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_adjustment_test(ctx: &ReducerContext) -> Result<(), String> {
    inventory_adjustments_tests::test_inventory_adjustment_create(ctx)
        .map_err(|e| format!("inventory_adjustment: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_stock_quant_test(ctx: &ReducerContext) -> Result<(), String> {
    stock_test::test_stock_quant_create(ctx).map_err(|e| format!("stock_quant: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_receipt_quant_test(ctx: &ReducerContext) -> Result<(), String> {
    stock_picking_quant_test::test_receipt_increases_quant(ctx)
        .map_err(|e| format!("receipt_quant: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_delivery_quant_test(ctx: &ReducerContext) -> Result<(), String> {
    stock_picking_quant_test::test_delivery_decreases_reserved_or_moves_quant(ctx)
        .map_err(|e| format!("delivery_quant: {e}"))
}
