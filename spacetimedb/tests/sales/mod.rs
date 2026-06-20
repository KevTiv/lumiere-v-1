//! Sales domain test suite — invoke via `run_all_sales_tests` reducer.
pub mod sales_core_test;

use spacetimedb::ReducerContext;

/// Run all sales domain tests. Call from SpacetimeDB client or CLI:
/// `spacetime call <db> run_all_sales_tests`
#[spacetimedb::reducer]
pub fn run_all_sales_tests(ctx: &ReducerContext) -> Result<(), String> {
    sales_core_test::test_order_confirm_to_invoice(ctx)
        .map_err(|e| format!("order_confirm_to_invoice: {e}"))?;

    sales_core_test::test_order_to_delivery_state(ctx)
        .map_err(|e| format!("order_to_delivery_state: {e}"))?;

    log::info!("✅ run_all_sales_tests complete");
    Ok(())
}
