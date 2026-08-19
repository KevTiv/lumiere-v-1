//! Sales domain test suite — invoke via `run_all_sales_tests` reducer.
pub mod cancellation_test;
pub mod commission_settle_test;
pub mod gap_fixes_test;
pub mod oms_extensions_test;
pub mod pos_order_finalize_test;
pub mod sale_order_update_test;
pub mod sales_core_test;

use spacetimedb::ReducerContext;

/// Run all sales domain tests. Call from SpacetimeDB client or CLI:
/// `spacetime call <db> run_all_sales_tests`
#[spacetimedb::reducer]
pub fn run_all_sales_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_sales_order_invoice_test(ctx)?;
    run_sales_order_delivery_test(ctx)?;
    run_sales_order_cancel_test(ctx)?;
    run_sales_order_update_test(ctx)?;
    run_sales_atp_shortfall_test(ctx)?;
    run_sales_credit_hold_test(ctx)?;
    run_sales_pricelist_apply_test(ctx)?;
    run_sales_send_quotation_test(ctx)?;
    run_sales_backorder_test(ctx)?;
    run_sales_fiscal_remap_test(ctx)?;
    run_sales_oms_extensions_test(ctx)?;
    run_sales_commission_accrue_test(ctx)?;
    run_sales_commission_settle_test(ctx)?;
    run_sales_commission_clawback_test(ctx)?;
    run_sales_lock_blocks_update_test(ctx)?;
    run_sales_line_update_delete_test(ctx)?;
    run_sales_fx_fail_closed_test(ctx)?;
    run_sales_dropship_confirm_test(ctx)?;
    run_sales_company_isolation_test(ctx)?;
    run_sales_pricelist_company_scope_test(ctx)?;
    run_sales_exchange_from_return_test(ctx)?;
    run_sales_ghost_product_fail_closed_test(ctx)?;
    run_sales_cancel_done_rejected_test(ctx)?;
    run_sales_cancel_invoiced_rejected_test(ctx)?;
    run_sales_cancel_cross_org_rejected_test(ctx)?;
    run_sales_cancel_nonexistent_rejected_test(ctx)?;
    run_pos_order_finalize_test(ctx)?;
    log::info!("✅ run_all_sales_tests complete");
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_pos_order_finalize_test(ctx: &ReducerContext) -> Result<(), String> {
    pos_order_finalize_test::test_pos_order_finalize_deletes_on_version_match(ctx)
        .map_err(|e| format!("pos_order_finalize_version_match: {e}"))?;
    pos_order_finalize_test::test_pos_order_finalize_refuses_on_version_mismatch(ctx)
        .map_err(|e| format!("pos_order_finalize_version_mismatch: {e}"))?;
    pos_order_finalize_test::test_pos_order_finalize_refuses_on_cold_eligible_at_mismatch(ctx)
        .map_err(|e| format!("pos_order_finalize_cold_eligible_at_mismatch: {e}"))?;
    pos_order_finalize_test::test_pos_order_finalize_is_idempotent_when_already_gone(ctx)
        .map_err(|e| format!("pos_order_finalize_idempotent: {e}"))?;
    pos_order_finalize_test::test_pos_order_finalize_rejects_unregistered_caller(ctx)
        .map_err(|e| format!("pos_order_finalize_unregistered_caller: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_order_invoice_test(ctx: &ReducerContext) -> Result<(), String> {
    sales_core_test::test_order_confirm_to_invoice(ctx)
        .map_err(|e| format!("order_confirm_to_invoice: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_order_delivery_test(ctx: &ReducerContext) -> Result<(), String> {
    sales_core_test::test_order_to_delivery_state(ctx)
        .map_err(|e| format!("order_to_delivery_state: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_order_cancel_test(ctx: &ReducerContext) -> Result<(), String> {
    sales_core_test::test_order_confirm_cancel_releases_reservation(ctx)
        .map_err(|e| format!("order_confirm_cancel_releases_reservation: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_order_update_test(ctx: &ReducerContext) -> Result<(), String> {
    sale_order_update_test::test_draft_sale_order_update(ctx)
        .map_err(|e| format!("draft_sale_order_update: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_atp_shortfall_test(ctx: &ReducerContext) -> Result<(), String> {
    sales_core_test::test_confirm_fails_on_atp_shortfall(ctx)
        .map_err(|e| format!("confirm_fails_on_atp_shortfall: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_credit_hold_test(ctx: &ReducerContext) -> Result<(), String> {
    sales_core_test::test_confirm_blocked_by_partner_credit_hold(ctx)
        .map_err(|e| format!("confirm_blocked_by_partner_credit_hold: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_pricelist_apply_test(ctx: &ReducerContext) -> Result<(), String> {
    sales_core_test::test_pricelist_applied_on_line_create(ctx)
        .map_err(|e| format!("pricelist_applied_on_line_create: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_send_quotation_test(ctx: &ReducerContext) -> Result<(), String> {
    sales_core_test::test_send_quotation_then_confirm(ctx)
        .map_err(|e| format!("send_quotation_then_confirm: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_backorder_test(ctx: &ReducerContext) -> Result<(), String> {
    sales_core_test::test_partial_validate_creates_backorder(ctx)
        .map_err(|e| format!("partial_validate_creates_backorder: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_fiscal_remap_test(ctx: &ReducerContext) -> Result<(), String> {
    oms_extensions_test::test_fiscal_position_tax_remap(ctx)
        .map_err(|e| format!("fiscal_position_tax_remap: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_oms_extensions_test(ctx: &ReducerContext) -> Result<(), String> {
    oms_extensions_test::test_incoterm_id_and_promotion_and_options(ctx)
        .map_err(|e| format!("incoterm_promotion_options_commission: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_commission_accrue_test(ctx: &ReducerContext) -> Result<(), String> {
    commission_settle_test::test_commission_accrue_on_invoice_hook(ctx)
        .map_err(|e| format!("commission_accrue_on_invoice_hook: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_commission_settle_test(ctx: &ReducerContext) -> Result<(), String> {
    commission_settle_test::test_commission_settle_and_refuse_double(ctx)
        .map_err(|e| format!("commission_settle_and_refuse_double: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_commission_clawback_test(ctx: &ReducerContext) -> Result<(), String> {
    commission_settle_test::test_commission_cancel_clawback(ctx)
        .map_err(|e| format!("commission_cancel_clawback: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_lock_blocks_update_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_lock_blocks_update(ctx).map_err(|e| format!("lock_blocks_update: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_line_update_delete_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_update_and_delete_sale_order_line(ctx)
        .map_err(|e| format!("line_update_delete: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_fx_fail_closed_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_fx_snapshot_fail_closed(ctx).map_err(|e| format!("fx_fail_closed: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_dropship_confirm_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_dropship_confirm_creates_po(ctx)
        .map_err(|e| format!("dropship_confirm: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_company_isolation_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_company_isolation_on_confirm(ctx)
        .map_err(|e| format!("company_isolation: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_pricelist_company_scope_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_pricelist_company_scope(ctx)
        .map_err(|e| format!("pricelist_company_scope: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_exchange_from_return_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_exchange_order_from_return(ctx)
        .map_err(|e| format!("exchange_from_return: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_ghost_product_fail_closed_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_unknown_product_so_line_fail_closed(ctx)
        .map_err(|e| format!("r1_ghost_product: {e}"))
}

/// SAL-003: negative test matrix for `cancel_sale_order` invalid state transitions.
#[spacetimedb::reducer]
pub fn run_sales_cancel_done_rejected_test(ctx: &ReducerContext) -> Result<(), String> {
    cancellation_test::test_cancel_done_order_rejected(ctx)
        .map_err(|e| format!("cancel_done_order_rejected: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_cancel_invoiced_rejected_test(ctx: &ReducerContext) -> Result<(), String> {
    cancellation_test::test_cancel_invoiced_order_rejected(ctx)
        .map_err(|e| format!("cancel_invoiced_order_rejected: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_cancel_cross_org_rejected_test(ctx: &ReducerContext) -> Result<(), String> {
    cancellation_test::test_cancel_cross_org_rejected(ctx)
        .map_err(|e| format!("cancel_cross_org_rejected: {e}"))
}

#[spacetimedb::reducer]
pub fn run_sales_cancel_nonexistent_rejected_test(ctx: &ReducerContext) -> Result<(), String> {
    cancellation_test::test_cancel_nonexistent_order_rejected(ctx)
        .map_err(|e| format!("cancel_nonexistent_order_rejected: {e}"))
}
