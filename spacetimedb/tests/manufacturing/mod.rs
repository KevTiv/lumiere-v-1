//! Manufacturing domain test suite — invoke via `run_all_manufacturing_tests` reducer.
pub mod relational_integrity_test;
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
    run_manufacturing_workorder_workcenter_integrity_test(ctx)?;
    run_manufacturing_productivity_relational_integrity_test(ctx)?;
    run_manufacturing_consume_materials_cross_org_component_test(ctx)?;
    run_manufacturing_consume_materials_exact_effect_test(ctx)?;
    run_manufacturing_production_close_exact_effect_test(ctx)?;
    run_manufacturing_workorder_execution_exact_effect_test(ctx)?;
    log::info!("✅ run_all_manufacturing_tests complete");
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_manufacturing_workorder_workcenter_integrity_test(
    ctx: &ReducerContext,
) -> Result<(), String> {
    relational_integrity_test::test_workorder_workcenter_integrity(ctx)
        .map_err(|e| format!("workorder_workcenter_integrity: {e}"))
}

#[spacetimedb::reducer]
pub fn run_manufacturing_productivity_relational_integrity_test(
    ctx: &ReducerContext,
) -> Result<(), String> {
    relational_integrity_test::test_productivity_relational_integrity(ctx)
        .map_err(|e| format!("productivity_relational_integrity: {e}"))
}

#[spacetimedb::reducer]
pub fn run_manufacturing_consume_materials_cross_org_component_test(
    ctx: &ReducerContext,
) -> Result<(), String> {
    relational_integrity_test::test_consume_materials_rejects_cross_org_component(ctx)
        .map_err(|e| format!("consume_materials_cross_org_component: {e}"))
}

#[spacetimedb::reducer]
pub fn run_manufacturing_consume_materials_exact_effect_test(
    ctx: &ReducerContext,
) -> Result<(), String> {
    relational_integrity_test::test_consume_materials_exact_effect_and_replay(ctx)
        .map_err(|e| format!("consume_materials_exact_effect: {e}"))
}

#[spacetimedb::reducer]
pub fn run_manufacturing_production_close_exact_effect_test(
    ctx: &ReducerContext,
) -> Result<(), String> {
    relational_integrity_test::test_production_output_and_finish_exact_effect(ctx)
        .map_err(|e| format!("production_close_exact_effect: {e}"))
}

#[spacetimedb::reducer]
pub fn run_manufacturing_workorder_execution_exact_effect_test(
    ctx: &ReducerContext,
) -> Result<(), String> {
    relational_integrity_test::test_workorder_execution_exact_effect(ctx)
        .map_err(|e| format!("workorder_execution_exact_effect: {e}"))
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
