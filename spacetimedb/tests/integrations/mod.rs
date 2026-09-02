//! Integrations domain test suite — invoke via `run_all_integrations_tests`.
//! First-ever test coverage for this module.
pub mod gap_fixes_test;

use spacetimedb::ReducerContext;

#[spacetimedb::reducer]
pub fn run_integrations_gap_fixes_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_whatsapp_company_id_populated_and_validated(ctx)
        .map_err(|e| format!("whatsapp_company_id_populated_and_validated: {e}"))?;
    gap_fixes_test::test_whatsapp_primary_account_integrity(ctx)
        .map_err(|e| format!("whatsapp_primary_account_integrity: {e}"))?;
    gap_fixes_test::test_google_drive_company_id_populated_and_validated(ctx)
        .map_err(|e| format!("google_drive_company_id_populated_and_validated: {e}"))?;
    gap_fixes_test::test_google_drive_conflict_policy_configurable(ctx)
        .map_err(|e| format!("google_drive_conflict_policy_configurable: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_all_integrations_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_integrations_gap_fixes_test(ctx)
}
