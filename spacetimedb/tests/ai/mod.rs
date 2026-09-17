//! AI domain test suite — invoke via `run_all_ai_tests` reducer.
pub mod continuation_test;
pub mod embedding_isolation_test;
pub mod inspector_test;
pub mod lineage_test;
pub mod provenance_test;
pub mod questions_test;
pub mod relational_integrity_test;
pub mod session_controls_test;

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
pub fn run_ai_continuation_tests(ctx: &ReducerContext) -> Result<(), String> {
    continuation_test::test_continuation_dropped_source_ref_errors(ctx)
        .map_err(|e| format!("continuation_dropped_source: {e}"))?;
    continuation_test::test_continuation_changed_constraints_blocked(ctx)
        .map_err(|e| format!("continuation_constraints: {e}"))?;
    continuation_test::test_continuation_forged_budget_rejected(ctx)
        .map_err(|e| format!("continuation_budget: {e}"))?;
    continuation_test::test_continuation_required_question_still_open(ctx)
        .map_err(|e| format!("continuation_question: {e}"))?;
    continuation_test::test_continuation_recalled_source_unavailable_no_leak(ctx)
        .map_err(|e| format!("continuation_recalled: {e}"))?;
    continuation_test::test_continuation_summary_cannot_grant_permission(ctx)
        .map_err(|e| format!("continuation_summary: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_ai_inspector_tests(ctx: &ReducerContext) -> Result<(), String> {
    inspector_test::test_inspector_claim_shows_exact_source_passage(ctx)
        .map_err(|e| format!("inspector_claim_passage: {e}"))?;
    inspector_test::test_inspector_denied_source_redacts_excerpt(ctx)
        .map_err(|e| format!("inspector_denied_redaction: {e}"))?;
    inspector_test::test_inspector_unavailable_source_is_explicit(ctx)
        .map_err(|e| format!("inspector_unavailable: {e}"))?;
    inspector_test::test_inspector_component_navigates_to_decision(ctx)
        .map_err(|e| format!("inspector_component: {e}"))?;
    inspector_test::test_inspector_answer_links_validations_and_claims(ctx)
        .map_err(|e| format!("inspector_answer: {e}"))?;
    inspector_test::test_inspector_decision_redacts_denied_supporting_source(ctx)
        .map_err(|e| format!("inspector_decision_sources: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_ai_session_controls_tests(ctx: &ReducerContext) -> Result<(), String> {
    session_controls_test::test_session_duplicate_resume_is_idempotent(ctx)
        .map_err(|e| format!("session_duplicate_resume: {e}"))?;
    session_controls_test::test_session_stale_control_version_rejects(ctx)
        .map_err(|e| format!("session_stale_version: {e}"))?;
    session_controls_test::test_session_resume_requires_provider_reconciliation(ctx)
        .map_err(|e| format!("session_reconciliation: {e}"))?;
    session_controls_test::test_session_interrupt_parks_and_terminal_rejects(ctx)
        .map_err(|e| format!("session_interrupt: {e}"))?;
    session_controls_test::test_session_resume_rechecks_manifest_questions(ctx)
        .map_err(|e| format!("session_manifest_questions: {e}"))?;
    session_controls_test::test_session_resume_rejects_recalled_source(ctx)
        .map_err(|e| format!("session_recalled_source: {e}"))?;
    session_controls_test::test_session_fork_creates_run_and_manifest(ctx)
        .map_err(|e| format!("session_fork: {e}"))?;
    session_controls_test::test_session_compare_records_manifest_diff(ctx)
        .map_err(|e| format!("session_compare: {e}"))?;
    session_controls_test::test_session_event_cursor_upsert_and_monotonic(ctx)
        .map_err(|e| format!("session_event_cursor: {e}"))?;
    session_controls_test::test_session_inspect_reports_run_state(ctx)
        .map_err(|e| format!("session_inspect: {e}"))?;
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
    run_ai_continuation_tests(ctx)?;
    run_ai_inspector_tests(ctx)?;
    run_ai_session_controls_tests(ctx)?;
    log::info!("✅ run_all_ai_tests complete");
    Ok(())
}
