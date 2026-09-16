//! AI domain test suite — invoke via `run_all_ai_tests` reducer.
pub mod embedding_isolation_test;
pub mod lineage_test;
pub mod provenance_test;
pub mod questions_test;
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
pub fn run_ai_provenance_tests(ctx: &ReducerContext) -> Result<(), String> {
    provenance_test::test_provenance_round_trip(ctx)
        .map_err(|e| format!("provenance_round_trip: {e}"))?;
    provenance_test::test_provenance_unknown_preservation(ctx)
        .map_err(|e| format!("provenance_unknown: {e}"))?;
    provenance_test::test_provenance_recalled_stays_unverified(ctx)
        .map_err(|e| format!("provenance_recalled: {e}"))?;
    provenance_test::test_provenance_cross_scope_denied(ctx)
        .map_err(|e| format!("provenance_cross_scope: {e}"))?;
    provenance_test::test_provenance_snapshot_identity(ctx)
        .map_err(|e| format!("provenance_snapshot: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_ai_lineage_tests(ctx: &ReducerContext) -> Result<(), String> {
    lineage_test::test_lineage_reconstructs_after_fork(ctx)
        .map_err(|e| format!("lineage_fork: {e}"))?;
    lineage_test::test_lineage_changed_requires_review(ctx)
        .map_err(|e| format!("lineage_review: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_ai_questions_tests(ctx: &ReducerContext) -> Result<(), String> {
    questions_test::test_question_required_blocks_only_dependent(ctx)
        .map_err(|e| format!("questions_required: {e}"))?;
    questions_test::test_question_reconnect_does_not_reask(ctx)
        .map_err(|e| format!("questions_reconnect: {e}"))?;
    questions_test::test_question_duplicate_idempotent(ctx)
        .map_err(|e| format!("questions_duplicate: {e}"))?;
    questions_test::test_question_stale_and_unauthorized_denied(ctx)
        .map_err(|e| format!("questions_stale: {e}"))?;
    questions_test::test_question_timeout_grants_no_answer(ctx)
        .map_err(|e| format!("questions_timeout: {e}"))?;
    questions_test::test_question_changed_requirements_cannot_reuse(ctx)
        .map_err(|e| format!("questions_changed: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_all_ai_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_ai_insight_org_scope_test(ctx)?;
    run_ai_document_processing_job_document_relation_test(ctx)?;
    run_ai_embedding_org_isolation_test(ctx)?;
    run_ai_provenance_tests(ctx)?;
    run_ai_lineage_tests(ctx)?;
    run_ai_questions_tests(ctx)?;
    log::info!("✅ run_all_ai_tests complete");
    Ok(())
}
