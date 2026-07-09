//! Core domain test suite — invoke via `run_all_core_tests` reducer.
pub mod operational_messaging_test;

use spacetimedb::ReducerContext;

#[spacetimedb::reducer]
pub fn run_all_core_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_core_operational_messaging_test(ctx)?;
    log::info!("✅ run_all_core_tests complete");
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_core_operational_messaging_test(ctx: &ReducerContext) -> Result<(), String> {
    operational_messaging_test::test_message_template_and_single_message(ctx)
        .map_err(|e| format!("message_template_and_single_message: {e}"))
}
