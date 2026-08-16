//! Fleet domain test suite — invoke via `run_all_fleet_tests` reducer.
pub mod gap_fixes_test;
pub mod relational_integrity_test;
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
pub fn run_fleet_relational_integrity_test(ctx: &ReducerContext) -> Result<(), String> {
    relational_integrity_test::test_driver_id_relations(ctx)
        .map_err(|e| format!("driver_id_relations: {e}"))?;
    relational_integrity_test::test_service_type_id_relations(ctx)
        .map_err(|e| format!("service_type_id_relations: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_fleet_gap_fixes_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_pos_terminal_org_isolation(ctx)
        .map_err(|e| format!("pos_terminal_org_isolation: {e}"))?;
    gap_fixes_test::test_warehouse_geo_rejects_invalid_warehouse(ctx)
        .map_err(|e| format!("warehouse_geo_rejects_invalid_warehouse: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_all_fleet_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_fleet_wave_a_test(ctx)?;
    run_fleet_relational_integrity_test(ctx)?;
    run_fleet_gap_fixes_test(ctx)?;
    Ok(())
}
