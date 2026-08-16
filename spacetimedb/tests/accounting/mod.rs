//! Accounting domain test suite — invoke via `run_all_accounting_tests` reducer.
pub mod active_company_matrix_test;
pub mod adversarial_p0_fixes_test;
pub mod budgeting_test;
pub mod fixed_assets_test;
pub mod fx_revaluation_test;
pub mod helpers;
pub mod ic_consolidation_test;
pub mod journal_entries_test;
pub mod option_vec_semantics_test;
pub mod payment_management_test;
pub mod payment_terms_test;
pub mod payments_test;
pub mod period_lock_test;
pub mod posted_immutability_test;
pub mod relational_integrity_test;
pub mod trial_balance_test;

use spacetimedb::ReducerContext;

/// Run all accounting domain tests. Call from SpacetimeDB client or CLI:
/// `spacetime call <db> run_all_accounting_tests`
#[spacetimedb::reducer]
pub fn run_all_accounting_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_accounting_post_invoice_test(ctx)?;
    run_accounting_payment_reconcile_test(ctx)?;
    run_accounting_payment_multi_invoice_residual_test(ctx)?;
    run_accounting_payment_cancel_test(ctx)?;
    run_accounting_payment_term_update_test(ctx)?;
    run_accounting_fixed_asset_ownership_test(ctx)?;
    run_accounting_budgeting_test(ctx)?;
    run_accounting_period_lock_test(ctx)?;
    run_accounting_posted_immutability_test(ctx)?;
    run_accounting_trial_balance_test(ctx)?;
    run_accounting_payment_management_test(ctx)?;
    run_accounting_ic_consolidation_test(ctx)?;
    run_accounting_fx_revaluation_test(ctx)?;
    relational_integrity_test::test_core_relation_negative_matrix(ctx)
        .map_err(|error| format!("core relation negative matrix: {error}"))?;
    relational_integrity_test::test_credit_control_relation_negative_matrix(ctx)
        .map_err(|error| format!("credit-control relation negative matrix: {error}"))?;
    active_company_matrix_test::test_active_company_a2_create_persist_matrix(ctx)
        .map_err(|error| format!("active company A2 matrix: {error}"))?;
    option_vec_semantics_test::test_account_tax_ids_option_vec_semantics(ctx)
        .map_err(|error| format!("account tax_ids Option<Vec>: {error}"))?;
    option_vec_semantics_test::test_budget_post_account_ids_option_vec_semantics(ctx)
        .map_err(|error| format!("budget_post account_ids Option<Vec>: {error}"))?;
    adversarial_p0_fixes_test::test_update_tax_jurisdiction_rejects_cross_tenant(ctx)
        .map_err(|error| format!("ACC-RI-020 tax jurisdiction: {error}"))?;
    adversarial_p0_fixes_test::test_create_analytic_account_rejects_cross_tenant_parent(ctx)
        .map_err(|error| format!("ACC-RI-021 analytic account parent: {error}"))?;
    adversarial_p0_fixes_test::test_bank_statement_reducers_reject_cross_tenant(ctx)
        .map_err(|error| format!("ACC-RI-022 bank statement: {error}"))?;
    log::info!("✅ run_all_accounting_tests complete");
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_accounting_budgeting_test(ctx: &ReducerContext) -> Result<(), String> {
    budgeting_test::test_budget_line_actuals_are_server_derived_and_recomputed_on_confirm(ctx)
        .map_err(|e| format!("budget line server-derived actuals: {e}"))
}

#[spacetimedb::reducer]
pub fn run_accounting_fixed_asset_ownership_test(ctx: &ReducerContext) -> Result<(), String> {
    fixed_assets_test::test_fixed_asset_ownership_is_derived_and_tenant_scoped(ctx)
        .map_err(|e| format!("fixed asset ownership: {e}"))?;
    fixed_assets_test::test_amortization_recognition_is_idempotent_and_tenant_scoped(ctx)
        .map_err(|e| format!("amortization recognition: {e}"))?;
    fixed_assets_test::test_asset_and_amortization_relation_negative_matrix(ctx)
        .map_err(|e| format!("asset/amortization relation matrix: {e}"))
}

#[spacetimedb::reducer]
pub fn run_accounting_post_invoice_test(ctx: &ReducerContext) -> Result<(), String> {
    journal_entries_test::test_post_customer_invoice_creates_move_lines(ctx)
        .map_err(|e| format!("post_customer_invoice: {e}"))?;
    journal_entries_test::test_cross_tenant_move_mutations_fail_closed(ctx)
        .map_err(|e| format!("cross_tenant_move_mutations: {e}"))?;
    journal_entries_test::test_create_credit_note_rejects_cross_tenant_invoice(ctx)
        .map_err(|e| format!("ACC-RI-024 credit_note_cross_tenant: {e}"))?;
    journal_entries_test::test_add_account_move_line_rejects_invalid_and_cross_org_tax_id(ctx)
        .map_err(|e| format!("ACC-004 tax_id_validation: {e}"))
}

#[spacetimedb::reducer]
pub fn run_accounting_payment_reconcile_test(ctx: &ReducerContext) -> Result<(), String> {
    payments_test::test_payment_reconciles_invoice(ctx)
        .map_err(|e| format!("payment_reconciles_invoice: {e}"))?;
    payments_test::test_payment_create_rejects_invalid_relations(ctx)
        .map_err(|e| format!("payment_create_relations: {e}"))
}

#[spacetimedb::reducer]
pub fn run_accounting_payment_multi_invoice_residual_test(
    ctx: &ReducerContext,
) -> Result<(), String> {
    payments_test::test_payment_multi_invoice_residual_and_clearing_account(ctx)
        .map_err(|e| format!("payment_multi_invoice_residual_and_clearing: {e}"))
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
    period_lock_test::test_fiscal_ownership_is_derived_and_tenant_scoped(ctx)
        .map_err(|e| format!("fiscal ownership: {e}"))?;
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
    trial_balance_test::test_analytic_account_patch_preserves_and_clears(ctx)
        .map_err(|e| format!("analytic_account_patch: {e}"))?;
    trial_balance_test::test_trial_balance_summary_balances(ctx)
        .map_err(|e| format!("trial_balance: {e}"))?;
    trial_balance_test::test_financial_report_rejects_cross_tenant_sources_and_filters(ctx)
        .map_err(|e| format!("financial_report_tenant_isolation: {e}"))
}

#[spacetimedb::reducer]
pub fn run_accounting_payment_management_test(ctx: &ReducerContext) -> Result<(), String> {
    payment_management_test::test_payment_account_lifecycle(ctx)
        .map_err(|e| format!("payment_account_lifecycle: {e}"))?;
    payment_management_test::test_payment_account_patch_preserves_and_clears(ctx)
        .map_err(|e| format!("payment_account_patch: {e}"))?;
    payment_management_test::test_update_payment_account_rejects_cross_tenant_accounts(ctx)
        .map_err(|e| format!("ACC-RI-023 payment_account_cross_tenant: {e}"))?;
    payment_management_test::test_payment_transaction_duplicate_reference(ctx)
        .map_err(|e| format!("payment_transaction_duplicate_reference: {e}"))?;
    payment_management_test::test_payment_transaction_post_creates_ledger_payment(ctx)
        .map_err(|e| format!("payment_transaction_post_creates_ledger_payment: {e}"))?;
    payment_management_test::test_payment_transaction_fee_and_void(ctx)
        .map_err(|e| format!("payment_transaction_fee_and_void: {e}"))?;
    payment_management_test::test_payment_allocation_updates_ledger_and_reverses(ctx)
        .map_err(|e| format!("payment_allocation_ledger_mutation: {e}"))?;
    log::info!("✅ run_accounting_payment_management_test complete");
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_accounting_ic_consolidation_test(ctx: &ReducerContext) -> Result<(), String> {
    ic_consolidation_test::test_intercompany_rule_requires_same_org(ctx)
        .map_err(|e| format!("ic_cross_org: {e}"))?;
    ic_consolidation_test::test_intercompany_elimination_nets_to_zero(ctx)
        .map_err(|e| format!("ic_elimination: {e}"))?;
    ic_consolidation_test::test_intercompany_rule_rejects_cross_tenant_account(ctx)
        .map_err(|e| format!("ACC-RI-024 ic_rule_cross_tenant_account: {e}"))?;
    ic_consolidation_test::test_process_intercompany_transaction_rejects_cross_tenant_destination(
        ctx,
    )
    .map_err(|e| format!("ACC-RI-015 ic_destination_document_cross_tenant: {e}"))
}

#[spacetimedb::reducer]
pub fn run_accounting_fx_revaluation_test(ctx: &ReducerContext) -> Result<(), String> {
    fx_revaluation_test::test_fx_revaluation_posts_balanced_move(ctx)
        .map_err(|e| format!("fx_revaluation: {e}"))
}
