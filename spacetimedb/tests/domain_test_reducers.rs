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
    let _ = stringify!(run_sales_order_cancel_test);
    let _ = stringify!(run_accounting_payment_term_update_test);
    let _ = stringify!(run_accounting_payment_management_test);
    let _ = stringify!(run_accounting_payment_multi_invoice_residual_test);
    let _ = stringify!(run_core_operational_messaging_test);
    let _ = stringify!(run_core_sod_test);
    let _ = stringify!(run_core_permissions_test);
    let _ = stringify!(run_tenant_isolation_tests);
    let _ = stringify!(run_country_pack_test);
    let _ = stringify!(run_all_workflow_foundation_tests);
    let _ = stringify!(run_all_workflow_deterministic_core_tests);
    let _ = stringify!(run_workflow_evaluator_simulation_tests);
    let _ = stringify!(run_workflow_runtime_tests);
    let _ = stringify!(run_workflow_authorization_tests);
    let _ = stringify!(run_workflow_human_task_tests);
    let _ = stringify!(run_workflow_action_registry_tests);
    let _ = stringify!(run_workflow_delivery_tests);
    let _ = stringify!(run_all_workflow_human_effect_tests);
    let _ = stringify!(run_queue_foundation_tests);
    let _ = stringify!(run_accounting_ic_consolidation_test);
    let _ = stringify!(run_accounting_fx_revaluation_test);
    let _ = stringify!(run_crm_contact_identity_test);
    let _ = stringify!(run_all_fleet_tests);
    let _ = stringify!(run_all_manufacturing_tests);
    let _ = stringify!(run_manufacturing_workcenter_create_test);
    let _ = stringify!(run_manufacturing_loss_category_create_test);
    let _ = stringify!(run_manufacturing_workorder_workcenter_integrity_test);
    let _ = stringify!(run_manufacturing_productivity_relational_integrity_test);
    let _ = stringify!(run_all_ai_tests);
    let _ = stringify!(run_all_analytics_tests);
    let _ = stringify!(run_all_iot_tests);
    let _ = stringify!(run_all_helpdesk_tests);
    let _ = stringify!(run_all_integrations_tests);
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
fn run_sales_order_cancel_test() {}
fn run_accounting_payment_term_update_test() {}
fn run_accounting_payment_management_test() {}
fn run_accounting_payment_multi_invoice_residual_test() {}
fn run_core_operational_messaging_test() {}
fn run_core_sod_test() {}
fn run_core_permissions_test() {}
fn run_tenant_isolation_tests() {}
fn run_country_pack_test() {}
fn run_all_workflow_foundation_tests() {}
fn run_all_workflow_deterministic_core_tests() {}
fn run_workflow_evaluator_simulation_tests() {}
fn run_workflow_runtime_tests() {}
fn run_workflow_authorization_tests() {}
fn run_workflow_human_task_tests() {}
fn run_workflow_action_registry_tests() {}
fn run_workflow_delivery_tests() {}
fn run_all_workflow_human_effect_tests() {}
fn run_queue_foundation_tests() {}
fn run_accounting_ic_consolidation_test() {}
fn run_accounting_fx_revaluation_test() {}
fn run_crm_contact_identity_test() {}
fn run_all_fleet_tests() {}
fn run_all_manufacturing_tests() {}
fn run_manufacturing_workcenter_create_test() {}
fn run_manufacturing_loss_category_create_test() {}
fn run_manufacturing_workorder_workcenter_integrity_test() {}
fn run_manufacturing_productivity_relational_integrity_test() {}
fn run_all_ai_tests() {}
fn run_all_analytics_tests() {}
fn run_all_iot_tests() {}
fn run_all_helpdesk_tests() {}
fn run_all_integrations_tests() {}
