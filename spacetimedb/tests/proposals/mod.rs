//! Proposals domain test suite — invoke via `run_all_proposals_tests` reducer.
pub mod wave_a_test;
pub mod wave_d_test;

use spacetimedb::ReducerContext;

#[spacetimedb::reducer]
pub fn run_proposals_wave_a_test(ctx: &ReducerContext) -> Result<(), String> {
    wave_a_test::test_create_requires_company_scope(ctx)
        .map_err(|e| format!("create_requires_company_scope: {e}"))?;
    wave_a_test::test_company_isolation_on_section_upsert(ctx)
        .map_err(|e| format!("company_isolation_on_section_upsert: {e}"))?;
    wave_a_test::test_bid_decision_required_before_submit(ctx)
        .map_err(|e| format!("bid_decision_required_before_submit: {e}"))?;
    wave_a_test::test_no_bid_blocks_submit(ctx)
        .map_err(|e| format!("no_bid_blocks_submit: {e}"))?;
    wave_a_test::test_section_revision_conflict(ctx)
        .map_err(|e| format!("section_revision_conflict: {e}"))?;
    wave_a_test::test_server_version_snapshot_and_restore(ctx)
        .map_err(|e| format!("server_version_snapshot_and_restore: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_proposals_wave_d_test(ctx: &ReducerContext) -> Result<(), String> {
    wave_d_test::test_template_apply_creates_sections(ctx)
        .map_err(|e| format!("template_apply_creates_sections: {e}"))?;
    wave_d_test::test_incomplete_compliance_blocks_submit(ctx)
        .map_err(|e| format!("incomplete_compliance_blocks_submit: {e}"))?;
    wave_d_test::test_analysis_materializes_compliance(ctx)
        .map_err(|e| format!("analysis_materializes_compliance: {e}"))?;
    wave_d_test::test_pdf_integration_intent_created(ctx)
        .map_err(|e| format!("pdf_integration_intent_created: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_all_proposals_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_proposals_wave_a_test(ctx)?;
    run_proposals_wave_d_test(ctx)?;
    Ok(())
}
