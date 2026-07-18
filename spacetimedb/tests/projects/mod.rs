//! Projects / PSA domain test suite — invoke via `run_projects_*_test` reducers.
pub mod wave_a_test;
pub mod wave_c_test;
pub mod wave_d_test;
pub mod wave_e_test;

use spacetimedb::ReducerContext;

#[spacetimedb::reducer]
pub fn run_projects_wave_a_test(ctx: &ReducerContext) -> Result<(), String> {
    wave_a_test::test_company_isolation_on_validate(ctx)
        .map_err(|e| format!("company_isolation_on_validate: {e}"))?;
    wave_a_test::test_sod_logger_cannot_validate(ctx)
        .map_err(|e| format!("sod_logger_cannot_validate: {e}"))?;
    wave_a_test::test_freeze_validated_blocks_stop_timer(ctx)
        .map_err(|e| format!("freeze_validated_blocks_stop_timer: {e}"))?;
    wave_a_test::test_bill_uses_sell_rate_and_links_invoice(ctx)
        .map_err(|e| format!("bill_uses_sell_rate_and_links_invoice: {e}"))?;
    wave_a_test::test_period_lock_rejects_bill(ctx)
        .map_err(|e| format!("period_lock_rejects_bill: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_projects_wave_c_test(ctx: &ReducerContext) -> Result<(), String> {
    wave_c_test::test_over_allocation_rejected(ctx)
        .map_err(|e| format!("over_allocation_rejected: {e}"))?;
    wave_c_test::test_milestone_and_wbs(ctx)
        .map_err(|e| format!("milestone_and_wbs: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_projects_wave_d_test(ctx: &ReducerContext) -> Result<(), String> {
    wave_d_test::test_margin_math_on_validate_and_bill(ctx)
        .map_err(|e| format!("margin_math_on_validate_and_bill: {e}"))?;
    wave_d_test::test_margin_company_isolation(ctx)
        .map_err(|e| format!("margin_company_isolation: {e}"))?;
    wave_d_test::test_milestone_bill_updates_margin(ctx)
        .map_err(|e| format!("milestone_bill_updates_margin: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_projects_wave_e_test(ctx: &ReducerContext) -> Result<(), String> {
    wave_e_test::test_change_order_dual_baselines(ctx)
        .map_err(|e| format!("change_order_dual_baselines: {e}"))?;
    wave_e_test::test_project_revrec_isolation(ctx)
        .map_err(|e| format!("project_revrec_isolation: {e}"))?;
    wave_e_test::test_subcontractor_in_margin(ctx)
        .map_err(|e| format!("subcontractor_in_margin: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_all_projects_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_projects_wave_a_test(ctx)?;
    run_projects_wave_c_test(ctx)?;
    run_projects_wave_d_test(ctx)?;
    run_projects_wave_e_test(ctx)?;
    Ok(())
}
