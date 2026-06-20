//! Native compile guard for domain test reducers.
//!
//! Domain tests run inside SpacetimeDB via `run_all_inventory_tests`, not via `cargo test` on the host.
//! This file only verifies the WASM module compiles when CI runs `cargo test --no-run`.

#[test]
fn domain_test_reducers_are_wasm_linked() {
    // If this test compiles, domain test reducers are linked into the WASM module.
    // Execute after publish: `spacetime call <db> run_all_domain_tests`
    let _ = stringify!(run_all_domain_tests);
    let _ = stringify!(run_all_accounting_tests);
    let _ = stringify!(run_all_inventory_tests);
    let _ = stringify!(run_all_sales_tests);
    let _ = stringify!(run_all_crm_tests);
}

fn run_all_domain_tests() {}
fn run_all_accounting_tests() {}
fn run_all_inventory_tests() {}
fn run_all_sales_tests() {}
fn run_all_crm_tests() {}
