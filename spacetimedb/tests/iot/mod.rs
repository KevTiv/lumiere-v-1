//! IoT domain test suite — invoke via `run_iot_*_test` reducers. First-ever
//! test coverage for this module (previously zero, matching AI/Analytics'
//! state before their own first suites).
pub mod relational_integrity_test;

use spacetimedb::ReducerContext;

#[spacetimedb::reducer]
pub fn run_iot_relational_integrity_test(ctx: &ReducerContext) -> Result<(), String> {
    relational_integrity_test::test_telemetry_and_threshold_company_id(ctx)
        .map_err(|e| format!("telemetry_and_threshold_company_id: {e}"))?;
    relational_integrity_test::test_alert_and_action_company_id(ctx)
        .map_err(|e| format!("alert_and_action_company_id: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_all_iot_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_iot_relational_integrity_test(ctx)
}
