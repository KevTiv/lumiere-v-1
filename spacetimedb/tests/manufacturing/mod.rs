//! Manufacturing domain test suite — invoke via `run_all_manufacturing_tests` reducer.
pub mod workcenter_test;

use spacetimedb::ReducerContext;

/// Run all manufacturing domain tests.
/// `spacetime call <db> run_all_manufacturing_tests`
#[spacetimedb::reducer]
pub fn run_all_manufacturing_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_manufacturing_workcenter_create_test(ctx)?;
    run_manufacturing_workcenter_cross_org_test(ctx)?;
    run_manufacturing_loss_category_create_test(ctx)?;
    run_manufacturing_loss_category_invalid_category_test(ctx)?;
    log::info!("✅ run_all_manufacturing_tests complete");
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_manufacturing_workcenter_create_test(ctx: &ReducerContext) -> Result<(), String> {
    workcenter_test::test_workcenter_create(ctx).map_err(|e| format!("workcenter_create: {e}"))
}

#[spacetimedb::reducer]
pub fn run_manufacturing_workcenter_cross_org_test(ctx: &ReducerContext) -> Result<(), String> {
    workcenter_test::test_workcenter_cross_org_rejected(ctx)
        .map_err(|e| format!("workcenter_cross_org: {e}"))
}

#[spacetimedb::reducer]
pub fn run_manufacturing_loss_category_create_test(ctx: &ReducerContext) -> Result<(), String> {
    workcenter_test::test_loss_category_create(ctx)
        .map_err(|e| format!("loss_category_create: {e}"))
}

#[spacetimedb::reducer]
pub fn run_manufacturing_loss_category_invalid_category_test(
    ctx: &ReducerContext,
) -> Result<(), String> {
    workcenter_test::test_loss_category_invalid_type_rejected(ctx)
        .map_err(|e| format!("loss_category_invalid: {e}"))
}
