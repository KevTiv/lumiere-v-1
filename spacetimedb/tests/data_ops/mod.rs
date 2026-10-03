//! Data-operations persistence contract tests.

pub mod commit_test;
pub mod import_idempotency_test;

use spacetimedb::ReducerContext;

#[spacetimedb::reducer]
pub fn run_data_ops_commit_test(ctx: &ReducerContext) -> Result<(), String> {
    commit_test::test_analytics_import_records_one_ordered_commit(ctx)?;
    import_idempotency_test::test_payslip_import_replay_is_rejected_by_file_hash(ctx)
        .map_err(|e| format!("payslip_import_replay: {e}"))
}
