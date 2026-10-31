//! Data-operations persistence contract tests.

pub mod accounting_cleanup_test;
pub mod commit_test;
pub mod import_idempotency_test;
pub mod import_source_trace_test;

use spacetimedb::ReducerContext;

#[spacetimedb::reducer]
pub fn run_data_ops_commit_test(ctx: &ReducerContext) -> Result<(), String> {
    accounting_cleanup_test::test_abandoned_account_move_cleanup_is_safe_and_idempotent(ctx)
        .map_err(|e| format!("accounting_import_cleanup: {e}"))?;
    commit_test::test_analytics_import_records_one_ordered_commit(ctx)?;
    import_source_trace_test::test_location_import_retains_source_row(ctx)?;
    import_idempotency_test::test_payslip_import_replay_is_rejected_by_file_hash(ctx)
        .map_err(|e| format!("payslip_import_replay: {e}"))?;
    import_idempotency_test::test_contact_assistant_import_replay_is_rejected_by_file_hash(ctx)
        .map_err(|e| format!("contact_import_replay: {e}"))
}
