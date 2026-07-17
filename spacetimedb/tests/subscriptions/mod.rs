//! Subscriptions domain test suite — invoke via `run_subscriptions_*_test` reducers.
pub mod wave_a_test;
pub mod wave_b_test;
pub mod wave_c_test;
pub mod wave_d_test;
pub mod wave_e_test;

use spacetimedb::ReducerContext;

#[spacetimedb::reducer]
pub fn run_subscriptions_wave_a_test(ctx: &ReducerContext) -> Result<(), String> {
    wave_a_test::test_subscription_create_lines_bill_idempotent(ctx)
        .map_err(|e| format!("subscription_create_lines_bill_idempotent: {e}"))?;
    wave_a_test::test_company_isolation_on_activate(ctx)
        .map_err(|e| format!("company_isolation_on_activate: {e}"))?;
    wave_a_test::test_close_requires_no_charge_without_invoices(ctx)
        .map_err(|e| format!("close_requires_no_charge_without_invoices: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_subscriptions_wave_b_test(ctx: &ReducerContext) -> Result<(), String> {
    wave_b_test::test_tax_and_auto_deferred_on_invoice(ctx)
        .map_err(|e| format!("tax_and_auto_deferred_on_invoice: {e}"))?;
    wave_b_test::test_pay_subscription_invoice_clears_residual(ctx)
        .map_err(|e| format!("pay_subscription_invoice_clears_residual: {e}"))?;
    wave_b_test::test_csv_import_draft_only(ctx)
        .map_err(|e| format!("csv_import_draft_only: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_subscriptions_wave_c_test(ctx: &ReducerContext) -> Result<(), String> {
    wave_c_test::test_amend_price_with_proration(ctx)
        .map_err(|e| format!("amend_price_with_proration: {e}"))?;
    wave_c_test::test_pause_blocks_invoice_and_resume(ctx)
        .map_err(|e| format!("pause_blocks_invoice_and_resume: {e}"))?;
    wave_c_test::test_renew_and_cancel_with_credit(ctx)
        .map_err(|e| format!("renew_and_cancel_with_credit: {e}"))?;
    wave_c_test::test_plan_update_and_deactivate(ctx)
        .map_err(|e| format!("plan_update_and_deactivate: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_subscriptions_wave_d_test(ctx: &ReducerContext) -> Result<(), String> {
    wave_d_test::test_usage_ingest_rate_and_bill(ctx)
        .map_err(|e| format!("usage_ingest_rate_and_bill: {e}"))?;
    wave_d_test::test_commitment_true_up(ctx)
        .map_err(|e| format!("commitment_true_up: {e}"))?;
    wave_d_test::test_bundle_apply(ctx).map_err(|e| format!("bundle_apply: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_subscriptions_wave_e_test(ctx: &ReducerContext) -> Result<(), String> {
    wave_e_test::test_entitlement_and_dunning_autoclose(ctx)
        .map_err(|e| format!("entitlement_and_dunning_autoclose: {e}"))?;
    wave_e_test::test_payment_intent_and_rails(ctx)
        .map_err(|e| format!("payment_intent_and_rails: {e}"))?;
    wave_e_test::test_index_linked_renewal(ctx)
        .map_err(|e| format!("index_linked_renewal: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_all_subscriptions_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_subscriptions_wave_a_test(ctx)?;
    run_subscriptions_wave_b_test(ctx)?;
    run_subscriptions_wave_c_test(ctx)?;
    run_subscriptions_wave_d_test(ctx)?;
    run_subscriptions_wave_e_test(ctx)?;
    Ok(())
}
