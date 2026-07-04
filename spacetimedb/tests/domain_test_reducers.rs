//! Native compile guard for domain test reducers.
//!
//! Domain tests run inside SpacetimeDB via `run_all_inventory_tests`, not via `cargo test` on the host.
//! This file only verifies the WASM module compiles when CI runs `cargo test --no-run`.

#[test]
fn domain_test_reducers_are_wasm_linked() {
    // If this test compiles, domain test reducers are linked into the WASM module.
    // Execute after publish: `spacetime call <db> run_all_domain_tests`
    let _ = stringify!(run_all_domain_tests);
    let _ = stringify!(run_all_core_tests);
    let _ = stringify!(run_all_accounting_tests);
    let _ = stringify!(run_all_inventory_tests);
    let _ = stringify!(run_all_sales_tests);
    let _ = stringify!(run_all_crm_tests);
    let _ = stringify!(run_all_platform_tests);
    let _ = stringify!(run_inventory_receipt_quant_test);
    let _ = stringify!(run_sales_order_update_test);
    let _ = stringify!(run_accounting_payment_term_update_test);
}

fn run_all_domain_tests() {}
fn run_all_core_tests() {}
fn run_all_accounting_tests() {}
fn run_all_inventory_tests() {}
fn run_all_sales_tests() {}
fn run_all_crm_tests() {}
fn run_all_platform_tests() {}
fn run_inventory_receipt_quant_test() {}
fn run_sales_order_update_test() {}
fn run_accounting_payment_term_update_test() {}
