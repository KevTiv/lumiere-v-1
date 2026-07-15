//! Accounting domain test suite — invoke via `run_all_accounting_tests` reducer.
mod helpers;
pub mod fx_revaluation_test;
pub mod ic_consolidation_test;
pub mod journal_entries_test;
pub mod payment_management_test;
pub mod payment_terms_test;
pub mod payments_test;
pub mod period_lock_test;
pub mod posted_immutability_test;
pub mod trial_balance_test;

use spacetimedb::ReducerContext;

/// Run all accounting domain tests. Call from SpacetimeDB client or CLI:
/// `spacetime call <db> run_all_accounting_tests`
#[spacetimedb::reducer]
pub fn run_all_accounting_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_accounting_post_invoice_test(ctx)?;
    run_accounting_payment_reconcile_test(ctx)?;
    run_accounting_payment_cancel_test(ctx)?;
    run_accounting_payment_term_update_test(ctx)?;
    run_accounting_period_lock_test(ctx)?;
    run_accounting_posted_immutability_test(ctx)?;
    run_accounting_trial_balance_test(ctx)?;
    run_accounting_payment_management_test(ctx)?;
    run_accounting_ic_consolidation_test(ctx)?;
    run_accounting_fx_revaluation_test(ctx)?;
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

#[spacetimedb::reducer]
pub fn run_accounting_payment_term_update_test(ctx: &ReducerContext) -> Result<(), String> {
    payment_terms_test::test_payment_term_update_and_delete(ctx)
        .map_err(|e| format!("payment_term_update_and_delete: {e}"))
}

#[spacetimedb::reducer]
pub fn run_accounting_period_lock_test(ctx: &ReducerContext) -> Result<(), String> {
    period_lock_test::test_post_blocked_in_closed_period(ctx)
        .map_err(|e| format!("period_lock invoice: {e}"))?;
    period_lock_test::test_post_payment_blocked_in_closed_period(ctx)
        .map_err(|e| format!("period_lock payment: {e}"))
}

#[spacetimedb::reducer]
pub fn run_accounting_posted_immutability_test(ctx: &ReducerContext) -> Result<(), String> {
    posted_immutability_test::test_cannot_edit_posted_move_line(ctx)
        .map_err(|e| format!("posted_immutability: {e}"))
}

#[spacetimedb::reducer]
pub fn run_accounting_trial_balance_test(ctx: &ReducerContext) -> Result<(), String> {
    trial_balance_test::test_trial_balance_summary_balances(ctx)
        .map_err(|e| format!("trial_balance: {e}"))
}

#[spacetimedb::reducer]
pub fn run_accounting_payment_management_test(ctx: &ReducerContext) -> Result<(), String> {
    payment_management_test::test_payment_account_lifecycle(ctx)
        .map_err(|e| format!("payment_account_lifecycle: {e}"))?;
    payment_management_test::test_payment_transaction_duplicate_reference(ctx)
        .map_err(|e| format!("payment_transaction_duplicate_reference: {e}"))?;
    payment_management_test::test_payment_transaction_post_creates_ledger_payment(ctx)
        .map_err(|e| format!("payment_transaction_post_creates_ledger_payment: {e}"))?;
    payment_management_test::test_payment_transaction_fee_and_void(ctx)
        .map_err(|e| format!("payment_transaction_fee_and_void: {e}"))?;
    log::info!("✅ run_accounting_payment_management_test complete");
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_accounting_ic_consolidation_test(ctx: &ReducerContext) -> Result<(), String> {
    ic_consolidation_test::test_intercompany_rule_requires_same_org(ctx)
        .map_err(|e| format!("ic_cross_org: {e}"))?;
    ic_consolidation_test::test_intercompany_elimination_nets_to_zero(ctx)
        .map_err(|e| format!("ic_elimination: {e}"))
}

#[spacetimedb::reducer]
pub fn run_accounting_fx_revaluation_test(ctx: &ReducerContext) -> Result<(), String> {
    fx_revaluation_test::test_fx_revaluation_posts_balanced_move(ctx)
        .map_err(|e| format!("fx_revaluation: {e}"))
}
