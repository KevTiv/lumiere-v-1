//! Expenses domain test suite — invoke via `run_expenses_*_test` reducers.
pub mod wave_a_test;
pub mod wave_b_test;
pub mod wave_c_test;
pub mod wave_d_test;

use spacetimedb::ReducerContext;

#[spacetimedb::reducer]
pub fn run_expenses_wave_a_test(ctx: &ReducerContext) -> Result<(), String> {
    wave_a_test::test_expense_lifecycle_posts_move(ctx)
        .map_err(|e| format!("expense_lifecycle_posts_move: {e}"))?;
    wave_a_test::test_refuse_only_from_submitted(ctx)
        .map_err(|e| format!("refuse_only_from_submitted: {e}"))?;
    wave_a_test::test_company_isolation_on_post(ctx)
        .map_err(|e| format!("company_isolation_on_post: {e}"))?;
    wave_a_test::test_submit_rejects_missing_receipt(ctx)
        .map_err(|e| format!("submit_rejects_missing_receipt: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_expenses_wave_b_test(ctx: &ReducerContext) -> Result<(), String> {
    wave_b_test::test_product_policy_and_line_cap(ctx)
        .map_err(|e| format!("product_policy_and_line_cap: {e}"))?;
    wave_b_test::test_tax_recovery_and_partner_on_post(ctx)
        .map_err(|e| format!("tax_recovery_and_partner_on_post: {e}"))?;
    wave_b_test::test_fx_snapshot_on_submit(ctx)
        .map_err(|e| format!("fx_snapshot_on_submit: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_expenses_wave_c_test(ctx: &ReducerContext) -> Result<(), String> {
    wave_c_test::test_mileage_line_from_rate(ctx)
        .map_err(|e| format!("mileage_line_from_rate: {e}"))?;
    wave_c_test::test_per_diem_rate(ctx).map_err(|e| format!("per_diem_rate: {e}"))?;
    wave_c_test::test_allocations_and_project_rebill(ctx)
        .map_err(|e| format!("allocations_and_project_rebill: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_expenses_wave_d_test(ctx: &ReducerContext) -> Result<(), String> {
    wave_d_test::test_card_feed_and_liability_post(ctx)
        .map_err(|e| format!("card_feed_and_liability_post: {e}"))?;
    wave_d_test::test_duplicate_fraud_hold_blocks_submit(ctx)
        .map_err(|e| format!("duplicate_fraud_hold_blocks_submit: {e}"))?;
    wave_d_test::test_advance_and_delayed_sync(ctx)
        .map_err(|e| format!("advance_and_delayed_sync: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_all_expenses_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_expenses_wave_a_test(ctx)?;
    run_expenses_wave_b_test(ctx)?;
    run_expenses_wave_c_test(ctx)?;
    run_expenses_wave_d_test(ctx)?;
    Ok(())
}
