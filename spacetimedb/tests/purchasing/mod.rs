//! Purchasing domain test suite — invoke via `run_purchasing_*_test` reducers.
pub mod gap_fixes_test;
pub mod purchase_bill_test;
pub mod wave_e_test;

use spacetimedb::ReducerContext;

#[spacetimedb::reducer]
pub fn run_purchasing_bill_balanced_test(ctx: &ReducerContext) -> Result<(), String> {
    purchase_bill_test::test_po_confirm_to_balanced_bill(ctx)
        .map_err(|e| format!("po_confirm_to_balanced_bill: {e}"))
}

#[spacetimedb::reducer]
pub fn run_purchasing_incoming_picking_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_confirm_creates_incoming_picking(ctx)
        .map_err(|e| format!("confirm_creates_incoming_picking: {e}"))
}

#[spacetimedb::reducer]
pub fn run_purchasing_company_isolation_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_company_isolation_on_confirm(ctx)
        .map_err(|e| format!("company_isolation_on_confirm: {e}"))
}

#[spacetimedb::reducer]
pub fn run_purchasing_wave_c_smoke_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_rfq_award_and_purchase_return_smoke(ctx)
        .map_err(|e| format!("rfq_award_and_purchase_return_smoke: {e}"))
}

#[spacetimedb::reducer]
pub fn run_purchasing_wave_e_test(ctx: &ReducerContext) -> Result<(), String> {
    wave_e_test::test_requisition_convert_copies_lines(ctx)
        .map_err(|e| format!("requisition_convert_copies_lines: {e}"))?;
    wave_e_test::test_company_isolation_on_receive_and_bill(ctx)
        .map_err(|e| format!("company_isolation_on_receive_and_bill: {e}"))?;
    wave_e_test::test_price_match_blocks_post_invoice(ctx)
        .map_err(|e| format!("price_match_blocks_post_invoice: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_purchasing_lot_receive_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_receive_po_line_lot_required(ctx)
        .map_err(|e| format!("receive_po_line_lot_required: {e}"))
}

#[spacetimedb::reducer]
pub fn run_all_purchasing_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_purchasing_bill_balanced_test(ctx)?;
    run_purchasing_incoming_picking_test(ctx)?;
    run_purchasing_company_isolation_test(ctx)?;
    run_purchasing_wave_c_smoke_test(ctx)?;
    run_purchasing_wave_e_test(ctx)?;
    run_purchasing_lot_receive_test(ctx)?;
    Ok(())
}
