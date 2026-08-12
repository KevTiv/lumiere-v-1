//! Purchasing domain test suite — invoke via `run_purchasing_*_test` reducers.
pub mod gap_fixes_test;
pub mod phase0_containment_test;
pub mod phase0_fixture_test;
pub mod phase1_landed_costs_test;
pub mod phase1_purchase_orders_test;
pub mod phase1_relational_integrity_test;
pub mod phase1_returns_advanced_test;
pub mod phase2_blanket_release_test;
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
pub fn run_purchasing_phase0_containment_test(ctx: &ReducerContext) -> Result<(), String> {
    phase0_containment_test::test_phase0_unsafe_actions_require_explicit_tenant_opt_in(ctx)
        .map_err(|e| format!("purchasing_phase0_containment: {e}"))
}

#[spacetimedb::reducer]
pub fn run_purchasing_phase0_fixture_test(ctx: &ReducerContext) -> Result<(), String> {
    phase0_fixture_test::test_purchasing_integrity_fixture(ctx)
        .map_err(|e| format!("purchasing_phase0_fixture: {e}"))
}

#[spacetimedb::reducer]
pub fn run_purchasing_phase1_landed_costs_test(ctx: &ReducerContext) -> Result<(), String> {
    phase1_landed_costs_test::test_landed_cost_scope_and_create_contract(ctx)
        .map_err(|e| format!("purchasing_phase1_landed_costs: {e}"))
}

#[spacetimedb::reducer]
pub fn run_purchasing_phase1_relational_integrity_test(ctx: &ReducerContext) -> Result<(), String> {
    phase1_relational_integrity_test::test_phase1_vendor_and_rfq_relations(ctx)
        .map_err(|e| format!("purchasing_phase1_relational_integrity: {e}"))
}

#[spacetimedb::reducer]
pub fn run_purchasing_phase1_purchase_orders_test(ctx: &ReducerContext) -> Result<(), String> {
    phase1_purchase_orders_test::test_phase1_purchase_order_relations(ctx)
        .map_err(|e| format!("purchasing_phase1_purchase_orders: {e}"))
}

#[spacetimedb::reducer]
pub fn run_purchasing_phase1_returns_advanced_test(ctx: &ReducerContext) -> Result<(), String> {
    phase1_returns_advanced_test::test_phase1_returns_credits_and_integrations(ctx)
        .map_err(|e| format!("purchasing_phase1_returns_advanced: {e}"))
}

#[spacetimedb::reducer]
pub fn run_purchasing_phase2_blanket_release_test(ctx: &ReducerContext) -> Result<(), String> {
    phase2_blanket_release_test::test_blanket_release_effective_window(ctx)
        .map_err(|e| format!("purchasing_phase2_blanket_effective_window: {e}"))?;
    phase2_blanket_release_test::test_blanket_release_lines_bounds_and_retry(ctx)
        .map_err(|e| format!("purchasing_phase2_blanket_release: {e}"))
}

#[spacetimedb::reducer]
pub fn run_all_purchasing_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_purchasing_bill_balanced_test(ctx)?;
    run_purchasing_incoming_picking_test(ctx)?;
    run_purchasing_company_isolation_test(ctx)?;
    run_purchasing_wave_c_smoke_test(ctx)?;
    run_purchasing_wave_e_test(ctx)?;
    run_purchasing_lot_receive_test(ctx)?;
    run_purchasing_phase0_containment_test(ctx)?;
    Ok(())
}
