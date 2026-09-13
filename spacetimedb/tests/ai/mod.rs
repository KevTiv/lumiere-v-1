//! AI domain test suite — invoke via `run_all_ai_tests` reducer.
pub mod capability_grants_test;
pub mod embedding_isolation_test;
pub mod relational_integrity_test;

use spacetimedb::ReducerContext;

#[spacetimedb::reducer]
pub fn run_ai_insight_org_scope_test(ctx: &ReducerContext) -> Result<(), String> {
    relational_integrity_test::test_insight_org_scope(ctx)
        .map_err(|e| format!("insight_org_scope: {e}"))
}

#[spacetimedb::reducer]
pub fn run_ai_document_processing_job_document_relation_test(
    ctx: &ReducerContext,
) -> Result<(), String> {
    relational_integrity_test::test_document_processing_job_document_relation(ctx)
        .map_err(|e| format!("document_processing_job_document_relation: {e}"))
}

#[spacetimedb::reducer]
pub fn run_ai_embedding_org_isolation_test(ctx: &ReducerContext) -> Result<(), String> {
    embedding_isolation_test::test_search_embedding_org_isolation(ctx)
        .map_err(|e| format!("search_embedding_org_isolation: {e}"))
}

#[spacetimedb::reducer]
pub fn run_ai_capability_grants_tests(ctx: &ReducerContext) -> Result<(), String> {
    capability_grants_test::test_capability_grant_org_scope(ctx)
        .map_err(|e| format!("capability_grant_org_scope: {e}"))?;
    capability_grants_test::test_capability_grant_role_org_mismatch(ctx)
        .map_err(|e| format!("capability_grant_role_org_mismatch: {e}"))?;
    capability_grants_test::test_capability_grant_input_validation(ctx)
        .map_err(|e| format!("capability_grant_input_validation: {e}"))?;
    capability_grants_test::test_capability_grant_upsert_and_delete(ctx)
        .map_err(|e| format!("capability_grant_upsert_and_delete: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_all_ai_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_ai_insight_org_scope_test(ctx)?;
    run_ai_document_processing_job_document_relation_test(ctx)?;
    run_ai_embedding_org_isolation_test(ctx)?;
    run_ai_capability_grants_tests(ctx)?;
    log::info!("✅ run_all_ai_tests complete");
    Ok(())
}
