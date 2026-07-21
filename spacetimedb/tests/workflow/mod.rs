//! Workflow foundation reducer tests.

mod action_registry_test;
mod authorization_test;
mod branches_test;
mod calendar_test;
mod definitions_test;
mod delivery_test;
mod evaluator_simulation_test;
mod human_tasks_test;
mod migration_test;
mod runtime_test;

use spacetimedb::ReducerContext;

#[spacetimedb::reducer]
pub fn run_all_workflow_foundation_tests(ctx: &ReducerContext) -> Result<(), String> {
    definitions_test::test_workflow_definitions(ctx)?;
    calendar_test::test_foundation_asset_covers_pilot_markets()?;
    calendar_test::test_dst_gap_overlap_and_quarter_hour_zone()?;
    calendar_test::test_deadline_uses_observed_and_local_overlays()?;
    calendar_test::test_foundation_activation_is_idempotent(ctx)?;
    calendar_test::test_recompute_deadline_rewrites_due_at_evidence()?;
    log::info!("workflow foundation tests complete");
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_workflow_authorization_tests(ctx: &ReducerContext) -> Result<(), String> {
    authorization_test::test_workflow_authorization(ctx)
}

#[spacetimedb::reducer]
pub fn run_workflow_evaluator_simulation_tests(ctx: &ReducerContext) -> Result<(), String> {
    evaluator_simulation_test::test_workflow_evaluator_and_simulation(ctx)
}

#[spacetimedb::reducer]
pub fn run_workflow_runtime_tests(ctx: &ReducerContext) -> Result<(), String> {
    runtime_test::test_workflow_runtime(ctx)
}

#[spacetimedb::reducer]
pub fn run_workflow_delivery_tests(ctx: &ReducerContext) -> Result<(), String> {
    delivery_test::test_workflow_delivery(ctx)
}

#[spacetimedb::reducer]
pub fn run_workflow_action_registry_tests(ctx: &ReducerContext) -> Result<(), String> {
    action_registry_test::test_guarded_action_registry(ctx)
}

#[spacetimedb::reducer]
pub fn run_workflow_human_task_tests(ctx: &ReducerContext) -> Result<(), String> {
    human_tasks_test::test_workflow_human_tasks(ctx)
}

#[spacetimedb::reducer]
pub fn run_all_workflow_human_effect_tests(ctx: &ReducerContext) -> Result<(), String> {
    human_tasks_test::test_workflow_human_tasks(ctx)?;
    action_registry_test::test_guarded_action_registry(ctx)?;
    delivery_test::test_workflow_delivery(ctx)?;
    log::info!("workflow human and durable effect tests complete");
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_workflow_migration_tests(ctx: &ReducerContext) -> Result<(), String> {
    migration_test::test_workflow_migration(ctx)
}

#[spacetimedb::reducer]
pub fn run_all_workflow_deterministic_core_tests(ctx: &ReducerContext) -> Result<(), String> {
    evaluator_simulation_test::test_workflow_evaluator_and_simulation(ctx)?;
    runtime_test::test_workflow_runtime(ctx)?;
    authorization_test::test_workflow_authorization(ctx)?;
    branches_test::test_workflow_branches(ctx)?;
    migration_test::test_workflow_migration(ctx)?;
    log::info!("workflow deterministic core tests complete");
    Ok(())
}
