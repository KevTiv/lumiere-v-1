//! Sales domain test suite — invoke via `run_all_sales_tests` reducer.
pub mod sale_order_update_test;
pub mod sales_core_test;

use spacetimedb::ReducerContext;

/// Run all sales domain tests. Call from SpacetimeDB client or CLI:
/// `spacetime call <db> run_all_sales_tests`
#[spacetimedb::reducer]
pub fn run_all_sales_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_sales_order_invoice_test(ctx)?;
    run_sales_order_delivery_test(ctx)?;
    run_sales_order_cancel_test(ctx)?;
    run_sales_order_update_test(ctx)?;
    log::info!("✅ run_all_sales_tests complete");
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_sales_order_invoice_test(ctx: &ReducerContext) -> Result<(), String> {
    sales_core_test::test_order_confirm_to_invoice(ctx)
        .map_err(|e| format!("order_confirm_to_invoice: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_order_delivery_test(ctx: &ReducerContext) -> Result<(), String> {
    sales_core_test::test_order_to_delivery_state(ctx)
        .map_err(|e| format!("order_to_delivery_state: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_order_cancel_test(ctx: &ReducerContext) -> Result<(), String> {
    sales_core_test::test_order_confirm_cancel_releases_reservation(ctx)
        .map_err(|e| format!("order_confirm_cancel_releases_reservation: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_order_update_test(ctx: &ReducerContext) -> Result<(), String> {
    sale_order_update_test::test_draft_sale_order_update(ctx)
        .map_err(|e| format!("draft_sale_order_update: {e}"))
}
