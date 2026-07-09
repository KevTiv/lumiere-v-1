//! CRM domain test suite — invoke via `run_all_crm_tests` reducer.
pub mod contact_identity_test;
pub mod contact_lifecycle_test;
pub mod opportunity_lifecycle_test;

use spacetimedb::ReducerContext;

/// Run all CRM domain tests. Call from SpacetimeDB client or CLI:
/// `spacetime call <db> run_all_crm_tests`
#[spacetimedb::reducer]
pub fn run_all_crm_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_crm_opportunity_convert_test(ctx)?;
    run_crm_contact_update_delete_test(ctx)?;
    run_crm_contact_identity_test(ctx)?;
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
pub fn run_crm_contact_identity_test(ctx: &ReducerContext) -> Result<(), String> {
    contact_identity_test::test_phone_normalization(ctx)
        .map_err(|e| format!("phone_normalization: {e}"))?;
    contact_identity_test::test_create_and_normalize_contact_identity(ctx)
        .map_err(|e| format!("create_and_normalize_contact_identity: {e}"))?;
    contact_identity_test::test_preferred_identity_uniqueness(ctx)
        .map_err(|e| format!("preferred_identity_uniqueness: {e}"))?;
    contact_identity_test::test_verify_and_archive_contact_identity(ctx)
        .map_err(|e| format!("verify_and_archive_contact_identity: {e}"))?;
    contact_identity_test::test_contact_role_assignment_lifecycle(ctx)
        .map_err(|e| format!("contact_role_assignment_lifecycle: {e}"))?;
    contact_identity_test::test_duplicate_identity_detection(ctx)
        .map_err(|e| format!("duplicate_identity_detection: {e}"))
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
