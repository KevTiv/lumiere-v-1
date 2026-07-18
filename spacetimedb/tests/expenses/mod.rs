//! Expenses domain test suite — invoke via `run_expenses_*_test` reducers.
pub mod wave_a_test;
pub mod wave_b_test;
pub mod wave_c_test;
pub mod wave_d_test;
pub mod wave_e_test;
pub mod wave_f_test;

use spacetimedb::{ReducerContext, Table};

use crate::expenses::expenses::{
    create_expense_receipt, hr_expense_receipt, CreateExpenseReceiptParams,
};

/// Register a real receipt row and return its id (replaces historic stub attachment id `1`).
pub fn test_receipt_id(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    employee_id: u64,
) -> Result<u64, String> {
    let seq = ctx.db.hr_expense_receipt().iter().count();
    let key = format!("test-rcpt-{employee_id}-{seq}");
    create_expense_receipt(
        ctx,
        organization_id,
        CreateExpenseReceiptParams {
            company_id: Some(company_id),
            employee_id,
            file_name: Some("test-receipt.pdf".into()),
            mime_type: Some("application/pdf".into()),
            storage_key: format!("test:{key}"),
            content_hash: None,
            client_request_id: Some(key.clone()),
        },
    )?;
    ctx.db
        .hr_expense_receipt()
        .iter()
        .find(|r| {
            r.organization_id == organization_id
                && r.client_request_id.as_deref() == Some(key.as_str())
        })
        .map(|r| r.id)
        .ok_or_else(|| "test receipt missing after create".into())
}

#[spacetimedb::reducer]
pub fn run_expenses_wave_a_test(ctx: &ReducerContext) -> Result<(), String> {
    wave_a_test::test_expense_lifecycle_posts_move(ctx)
        .map_err(|e| format!("expense_lifecycle_posts_move: {e}"))?;
    wave_a_test::test_refuse_only_from_submitted(ctx)
        .map_err(|e| format!("refuse_only_from_submitted: {e}"))?;
    wave_a_test::test_company_isolation_on_post(ctx)
        .map_err(|e| format!("company_isolation_on_post: {e}"))?;
    wave_a_test::test_submit_rejects_missing_receipt(ctx)
        .map_err(|e| format!("submit_rejects_missing_receipt: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_expenses_wave_b_test(ctx: &ReducerContext) -> Result<(), String> {
    wave_b_test::test_product_policy_and_line_cap(ctx)
        .map_err(|e| format!("product_policy_and_line_cap: {e}"))?;
    wave_b_test::test_tax_recovery_and_partner_on_post(ctx)
        .map_err(|e| format!("tax_recovery_and_partner_on_post: {e}"))?;
    wave_b_test::test_fx_snapshot_on_submit(ctx)
        .map_err(|e| format!("fx_snapshot_on_submit: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_expenses_wave_c_test(ctx: &ReducerContext) -> Result<(), String> {
    wave_c_test::test_mileage_line_from_rate(ctx)
        .map_err(|e| format!("mileage_line_from_rate: {e}"))?;
    wave_c_test::test_per_diem_rate(ctx).map_err(|e| format!("per_diem_rate: {e}"))?;
    wave_c_test::test_allocations_and_project_rebill(ctx)
        .map_err(|e| format!("allocations_and_project_rebill: {e}"))?;
    wave_c_test::test_mileage_rate_effective_dates(ctx)
        .map_err(|e| format!("mileage_rate_effective_dates: {e}"))?;
    wave_c_test::test_allocation_tax_split_on_post(ctx)
        .map_err(|e| format!("allocation_tax_split_on_post: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_expenses_wave_d_test(ctx: &ReducerContext) -> Result<(), String> {
    wave_d_test::test_card_feed_and_liability_post(ctx)
        .map_err(|e| format!("card_feed_and_liability_post: {e}"))?;
    wave_d_test::test_duplicate_fraud_hold_blocks_submit(ctx)
        .map_err(|e| format!("duplicate_fraud_hold_blocks_submit: {e}"))?;
    wave_d_test::test_advance_and_delayed_sync(ctx)
        .map_err(|e| format!("advance_and_delayed_sync: {e}"))?;
    wave_d_test::test_reject_policy_exception(ctx)
        .map_err(|e| format!("reject_policy_exception: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_expenses_wave_e_test(ctx: &ReducerContext) -> Result<(), String> {
    wave_e_test::test_pack_tax_evidence_required(ctx)
        .map_err(|e| format!("pack_tax_evidence_required: {e}"))?;
    wave_e_test::test_br_pack_expense_evidence_flags(ctx)
        .map_err(|e| format!("br_pack_expense_evidence_flags: {e}"))?;
    wave_e_test::test_card_statement_match_and_fx_fee(ctx)
        .map_err(|e| format!("card_statement_match_and_fx_fee: {e}"))?;
    wave_e_test::test_card_statement_unmatch(ctx)
        .map_err(|e| format!("card_statement_unmatch: {e}"))?;
    wave_e_test::test_email_inbox_intent_batch_apply(ctx)
        .map_err(|e| format!("email_inbox_intent_batch_apply: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_expenses_wave_f_test(ctx: &ReducerContext) -> Result<(), String> {
    wave_f_test::test_gate_enabled_sod_approve(ctx)
        .map_err(|e| format!("gate_enabled_sod_approve: {e}"))?;
    wave_f_test::test_isolation_rebill_card_advance(ctx)
        .map_err(|e| format!("isolation_rebill_card_advance: {e}"))?;
    wave_f_test::test_locked_period_rejects_post(ctx)
        .map_err(|e| format!("locked_period_rejects_post: {e}"))?;
    wave_f_test::test_csv_draft_only(ctx).map_err(|e| format!("csv_draft_only: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_all_expenses_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_expenses_wave_a_test(ctx)?;
    run_expenses_wave_b_test(ctx)?;
    run_expenses_wave_c_test(ctx)?;
    run_expenses_wave_d_test(ctx)?;
    run_expenses_wave_e_test(ctx)?;
    run_expenses_wave_f_test(ctx)?;
    Ok(())
}
