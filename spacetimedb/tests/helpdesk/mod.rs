//! Helpdesk domain test suite — invoke via `run_helpdesk_*_test` reducers.
//! First-ever test coverage for this module (previously zero, matching
//! AI/Analytics/IoT's state before their own first suites).
pub mod relational_integrity_test;

use spacetimedb::ReducerContext;

#[spacetimedb::reducer]
pub fn run_helpdesk_relational_integrity_test(ctx: &ReducerContext) -> Result<(), String> {
    relational_integrity_test::test_csv_import_rejects_bad_fks(ctx)
        .map_err(|e| format!("csv_import_rejects_bad_fks: {e}"))?;
    relational_integrity_test::test_cross_team_assignment_rejected(ctx)
        .map_err(|e| format!("cross_team_assignment_rejected: {e}"))?;
    relational_integrity_test::test_sla_reached_is_system_only(ctx)
        .map_err(|e| format!("sla_reached_is_system_only: {e}"))?;
    relational_integrity_test::test_cross_org_ticket_rejected(ctx)
        .map_err(|e| format!("cross_org_ticket_rejected: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_all_helpdesk_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_helpdesk_relational_integrity_test(ctx)
}
