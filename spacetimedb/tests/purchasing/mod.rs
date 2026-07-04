//! Purchasing domain test suite — invoke via `run_purchasing_bill_balanced_test` reducer.
pub mod purchase_bill_test;

use spacetimedb::ReducerContext;

#[spacetimedb::reducer]
pub fn run_purchasing_bill_balanced_test(ctx: &ReducerContext) -> Result<(), String> {
    purchase_bill_test::test_po_confirm_to_balanced_bill(ctx)
        .map_err(|e| format!("po_confirm_to_balanced_bill: {e}"))
}
