//! Core domain test suite — invoke via `run_all_core_tests` reducer.
pub mod operational_messaging_test;
pub mod permissions_tests;
pub mod queue_tests;
pub mod sod_test;

use spacetimedb::ReducerContext;

#[spacetimedb::reducer]
pub fn run_all_core_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_core_operational_messaging_test(ctx)?;
    run_core_sod_test(ctx)?;
    run_core_permissions_test(ctx)?;
    run_queue_foundation_tests(ctx)?;
    log::info!("✅ run_all_core_tests complete");
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_queue_foundation_tests(ctx: &ReducerContext) -> Result<(), String> {
    queue_tests::test_queue_system(ctx)?;
    queue_tests::test_queue_job_edge_cases(ctx)?;
    queue_tests::test_worker_edge_cases(ctx)
}

#[spacetimedb::reducer]
pub fn run_core_operational_messaging_test(ctx: &ReducerContext) -> Result<(), String> {
    operational_messaging_test::test_message_template_and_single_message(ctx)
        .map_err(|e| format!("message_template_and_single_message: {e}"))
}

#[spacetimedb::reducer]
pub fn run_core_sod_test(ctx: &ReducerContext) -> Result<(), String> {
    sod_test::test_sod_blocks_conflicting_roles(ctx).map_err(|e| format!("sod_validate: {e}"))?;
    sod_test::test_sod_assign_role_blocks_conflicting_roles(ctx)
        .map_err(|e| format!("sod_assign_role: {e}"))?;
    sod_test::test_delegated_admin_cannot_grant_permission(ctx)
        .map_err(|e| format!("delegated_admin: {e}"))?;
    sod_test::test_field_write_policy_blocks_disallowed_columns(ctx)
        .map_err(|e| format!("field_write: {e}"))?;
    sod_test::test_sod_update_deactivates_rule(ctx).map_err(|e| format!("sod_update: {e}"))?;
    sod_test::test_revoke_delegated_admin_scope(ctx)
        .map_err(|e| format!("delegated_revoke: {e}"))?;
    sod_test::test_opportunity_field_write_policy(ctx).map_err(|e| format!("opp_field_write: {e}"))
}

#[spacetimedb::reducer]
pub fn run_core_permissions_test(ctx: &ReducerContext) -> Result<(), String> {
    permissions_tests::test_grant_and_revoke_field_permission(ctx)
        .map_err(|e| format!("field_permission_grant_revoke: {e}"))
}
