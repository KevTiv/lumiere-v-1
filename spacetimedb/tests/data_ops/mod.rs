//! Data-operations persistence contract tests.

pub mod commit_test;

use spacetimedb::ReducerContext;

#[spacetimedb::reducer]
pub fn run_data_ops_commit_test(ctx: &ReducerContext) -> Result<(), String> {
    commit_test::test_analytics_import_records_one_ordered_commit(ctx)
}
