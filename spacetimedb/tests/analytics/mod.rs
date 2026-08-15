//! Analytics domain test suite — invoke via `run_all_analytics_tests` reducer.
pub mod relational_integrity_test;

use spacetimedb::ReducerContext;

#[spacetimedb::reducer]
pub fn run_analytics_dashboard_company_scope_test(ctx: &ReducerContext) -> Result<(), String> {
    relational_integrity_test::test_dashboard_company_scope(ctx)
        .map_err(|e| format!("dashboard_company_scope: {e}"))
}

#[spacetimedb::reducer]
pub fn run_analytics_cross_company_widget_add_test(ctx: &ReducerContext) -> Result<(), String> {
    relational_integrity_test::test_cross_company_widget_add_rejected(ctx)
        .map_err(|e| format!("cross_company_widget_add: {e}"))
}

#[spacetimedb::reducer]
pub fn run_all_analytics_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_analytics_dashboard_company_scope_test(ctx)?;
    run_analytics_cross_company_widget_add_test(ctx)?;
    log::info!("✅ run_all_analytics_tests complete");
    Ok(())
}
