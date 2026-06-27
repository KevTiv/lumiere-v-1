//! Accounting domain test suite — invoke via `run_all_accounting_tests` reducer.
mod helpers;
pub mod journal_entries_test;
pub mod payments_test;

use spacetimedb::ReducerContext;

/// Run all accounting domain tests. Call from SpacetimeDB client or CLI:
/// `spacetime call <db> run_all_accounting_tests`
#[spacetimedb::reducer]
pub fn run_all_accounting_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_accounting_post_invoice_test(ctx)?;
    run_accounting_payment_reconcile_test(ctx)?;
    run_accounting_payment_cancel_test(ctx)?;
    log::info!("✅ run_all_accounting_tests complete");
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_accounting_post_invoice_test(ctx: &ReducerContext) -> Result<(), String> {
    journal_entries_test::test_post_customer_invoice_creates_move_lines(ctx)
        .map_err(|e| format!("post_customer_invoice: {e}"))
}

#[spacetimedb::reducer]
pub fn run_accounting_payment_reconcile_test(ctx: &ReducerContext) -> Result<(), String> {
    payments_test::test_payment_reconciles_invoice(ctx)
        .map_err(|e| format!("payment_reconciles_invoice: {e}"))
}

#[spacetimedb::reducer]
pub fn run_accounting_payment_cancel_test(ctx: &ReducerContext) -> Result<(), String> {
    payments_test::test_cancel_payment_audited(ctx)
        .map_err(|e| format!("cancel_payment_audited: {e}"))
}
