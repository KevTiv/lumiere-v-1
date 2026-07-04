//! CRM domain test suite — invoke via `run_all_crm_tests` reducer.
pub mod contact_lifecycle_test;
pub mod opportunity_lifecycle_test;

use spacetimedb::ReducerContext;

/// Run all CRM domain tests. Call from SpacetimeDB client or CLI:
/// `spacetime call <db> run_all_crm_tests`
#[spacetimedb::reducer]
pub fn run_all_crm_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_crm_opportunity_convert_test(ctx)?;
    run_crm_contact_update_delete_test(ctx)?;
    log::info!("✅ run_all_crm_tests complete");
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_crm_contact_update_delete_test(ctx: &ReducerContext) -> Result<(), String> {
    contact_lifecycle_test::test_contact_update_and_delete(ctx)
        .map_err(|e| format!("contact_update_and_delete: {e}"))?;
    contact_lifecycle_test::test_lead_delete(ctx).map_err(|e| format!("lead_delete: {e}"))
}

#[spacetimedb::reducer]
pub fn run_crm_opportunity_convert_test(ctx: &ReducerContext) -> Result<(), String> {
    opportunity_lifecycle_test::test_convert_opportunity_to_sale_order(ctx)
        .map_err(|e| format!("convert_opportunity_to_sale_order: {e}"))?;
    opportunity_lifecycle_test::test_create_opportunity_line_on_unscoped_opportunity(ctx)
        .map_err(|e| format!("create_opportunity_line_on_unscoped_opportunity: {e}"))?;
    opportunity_lifecycle_test::test_opportunity_stage_transition(ctx)
        .map_err(|e| format!("opportunity_stage_transition: {e}"))
}
