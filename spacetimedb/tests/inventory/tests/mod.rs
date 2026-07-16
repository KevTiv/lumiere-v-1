//! Inventory domain test suite — invoke via `run_all_inventory_tests` reducer.
pub mod gap_fixes_test;
pub mod inventory_adjustments_tests;
pub mod product_category_tests;
pub mod product_update_test;
pub mod stock_picking_quant_test;
pub mod stock_test;

use spacetimedb::ReducerContext;

/// Run all inventory domain tests. Call from SpacetimeDB client or CLI:
/// `spacetime call <db> run_all_inventory_tests`
#[spacetimedb::reducer]
pub fn run_all_inventory_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_inventory_product_category_test(ctx)?;
    run_inventory_product_update_test(ctx)?;
    run_inventory_stock_inventory_test(ctx)?;
    run_inventory_adjustment_test(ctx)?;
    run_inventory_stock_quant_test(ctx)?;
    run_inventory_receipt_quant_test(ctx)?;
    run_inventory_delivery_quant_test(ctx)?;
    run_inventory_company_isolation_test(ctx)?;
    run_inventory_atp_fail_closed_test(ctx)?;
    run_inventory_lot_reserve_test(ctx)?;
    run_inventory_serial_reserve_test(ctx)?;
    run_inventory_lot_validate_test(ctx)?;
    run_inventory_expired_lot_test(ctx)?;
    run_inventory_fefo_test(ctx)?;
    run_inventory_serial_id_validate_test(ctx)?;
    run_inventory_replenishment_demand_test(ctx)?;
    run_inventory_qc_quarantine_test(ctx)?;
    run_inventory_wave_release_test(ctx)?;
    run_inventory_uom_conversion_test(ctx)?;
    run_inventory_close_lock_test(ctx)?;
    run_inventory_3pl_asn_test(ctx)?;
    run_inventory_cartonization_test(ctx)?;
    run_inventory_consignment_atp_test(ctx)?;
    run_inventory_cross_dock_test(ctx)?;
    log::info!("✅ run_all_inventory_tests complete");
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_inventory_product_category_test(ctx: &ReducerContext) -> Result<(), String> {
    product_category_tests::test_product_category_lifecycle(ctx)
        .map_err(|e| format!("product_category: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_product_update_test(ctx: &ReducerContext) -> Result<(), String> {
    product_update_test::test_product_update_and_delete(ctx)
        .map_err(|e| format!("product_update: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_stock_inventory_test(ctx: &ReducerContext) -> Result<(), String> {
    inventory_adjustments_tests::test_stock_inventory_create(ctx)
        .map_err(|e| format!("stock_inventory: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_adjustment_test(ctx: &ReducerContext) -> Result<(), String> {
    inventory_adjustments_tests::test_inventory_adjustment_create(ctx)
        .map_err(|e| format!("inventory_adjustment: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_stock_quant_test(ctx: &ReducerContext) -> Result<(), String> {
    stock_test::test_stock_quant_create(ctx).map_err(|e| format!("stock_quant: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_receipt_quant_test(ctx: &ReducerContext) -> Result<(), String> {
    stock_picking_quant_test::test_receipt_increases_quant(ctx)
        .map_err(|e| format!("receipt_quant: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_delivery_quant_test(ctx: &ReducerContext) -> Result<(), String> {
    stock_picking_quant_test::test_delivery_decreases_reserved_or_moves_quant(ctx)
        .map_err(|e| format!("delivery_quant: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_company_isolation_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_company_isolation_on_reserve(ctx)
        .map_err(|e| format!("company_isolation: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_atp_fail_closed_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_atp_fail_closed_on_over_reserve(ctx)
        .map_err(|e| format!("atp_fail_closed: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_lot_reserve_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_lot_required_on_reserve(ctx).map_err(|e| format!("lot_reserve: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_serial_reserve_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_serial_required_on_reserve(ctx)
        .map_err(|e| format!("serial_reserve: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_lot_validate_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_lot_required_on_validate(ctx).map_err(|e| format!("lot_validate: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_expired_lot_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_expired_lot_blocked_on_reserve(ctx)
        .map_err(|e| format!("expired_lot: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_fefo_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_fefo_prefers_earlier_expiry(ctx).map_err(|e| format!("fefo: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_serial_id_validate_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_serial_id_on_validate(ctx).map_err(|e| format!("serial_id_validate: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_replenishment_demand_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_replenishment_creates_draft_po(ctx)
        .map_err(|e| format!("replenishment_demand: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_qc_quarantine_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_quality_fail_quarantines_from_atp(ctx)
        .map_err(|e| format!("qc_quarantine: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_wave_release_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_wave_release_orchestrates_tasks(ctx)
        .map_err(|e| format!("wave_release: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_uom_conversion_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_uom_conversion_on_move_and_reserve(ctx)
        .map_err(|e| format!("uom_conversion: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_close_lock_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_inventory_close_locks_stock(ctx)
        .map_err(|e| format!("inventory_close: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_3pl_asn_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_3pl_asn_inbound_posts_stock(ctx).map_err(|e| format!("3pl_asn: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_cartonization_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_cartonization_packs_moves(ctx).map_err(|e| format!("cartonization: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_consignment_atp_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_consignment_excluded_from_atp(ctx)
        .map_err(|e| format!("consignment_atp: {e}"))
}

#[spacetimedb::reducer]
pub fn run_inventory_cross_dock_test(ctx: &ReducerContext) -> Result<(), String> {
    gap_fixes_test::test_cross_dock_creates_outbound(ctx).map_err(|e| format!("cross_dock: {e}"))
}
