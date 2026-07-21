//! Fleet domain test suite — invoke via `run_all_fleet_tests` reducer.
pub mod wave_a_test;

use spacetimedb::ReducerContext;

#[spacetimedb::reducer]
pub fn run_fleet_wave_a_test(ctx: &ReducerContext) -> Result<(), String> {
    wave_a_test::test_create_requires_company_scope(ctx)
        .map_err(|e| format!("create_requires_company_scope: {e}"))?;
    wave_a_test::test_company_isolation_on_position_update(ctx)
        .map_err(|e| format!("company_isolation_on_position_update: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_all_fleet_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_fleet_wave_a_test(ctx)?;
    Ok(())
}
