//! CRM domain test suite — invoke via `run_all_crm_tests` reducer.
pub mod opportunity_lifecycle_test;

use spacetimedb::ReducerContext;

/// Run all CRM domain tests. Call from SpacetimeDB client or CLI:
/// `spacetime call <db> run_all_crm_tests`
#[spacetimedb::reducer]
pub fn run_all_crm_tests(ctx: &ReducerContext) -> Result<(), String> {
    opportunity_lifecycle_test::test_convert_opportunity_to_sale_order(ctx)
        .map_err(|e| format!("convert_opportunity_to_sale_order: {e}"))?;

    log::info!("✅ run_all_crm_tests complete");
    Ok(())
}
