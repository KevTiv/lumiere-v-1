//! AI domain test suite — invoke via `run_all_ai_tests` reducer.
pub mod capability_grants_test;
pub mod decision_events_test;
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
pub fn run_ai_intelligence_events_tests(ctx: &ReducerContext) -> Result<(), String> {
    decision_events_test::test_record_decision_event_persists(ctx)
        .map_err(|e| format!("record_decision_event_persists: {e}"))?;
    decision_events_test::test_record_decision_event_replay_is_idempotent(ctx)
        .map_err(|e| format!("record_decision_event_replay_is_idempotent: {e}"))?;
    decision_events_test::test_record_decision_event_replay_conflict_is_rejected(ctx)
        .map_err(|e| format!("record_decision_event_replay_conflict_is_rejected: {e}"))?;
    decision_events_test::test_record_decision_event_rejects_unknown_outcome_kind(ctx)
        .map_err(|e| format!("record_decision_event_rejects_unknown_outcome_kind: {e}"))?;
    decision_events_test::test_record_decision_event_rejects_out_of_range_confidence(ctx)
        .map_err(|e| format!("record_decision_event_rejects_out_of_range_confidence: {e}"))?;
    decision_events_test::test_record_decision_event_rejects_unknown_provider_attempt(ctx)
        .map_err(|e| format!("record_decision_event_rejects_unknown_provider_attempt: {e}"))?;
    decision_events_test::test_record_reasoning_event_clarification_escalates_automatically(ctx)
        .map_err(|e| {
            format!("record_reasoning_event_clarification_escalates_automatically: {e}")
        })?;
    decision_events_test::test_record_decision_shadow_event_persists(ctx)
        .map_err(|e| format!("record_decision_shadow_event_persists: {e}"))?;
    decision_events_test::test_record_decision_shadow_event_records_failure_and_is_idempotent(ctx)
        .map_err(|e| format!("record_decision_shadow_event_records_failure_and_is_idempotent: {e}"))?;
    decision_events_test::test_record_decision_shadow_event_distinct_profiles_do_not_collide(ctx)
        .map_err(|e| format!("record_decision_shadow_event_distinct_profiles_do_not_collide: {e}"))?;
    decision_events_test::test_intelligence_event_status_fields_are_independent(ctx)
        .map_err(|e| format!("intelligence_event_status_fields_are_independent: {e}"))?;
    decision_events_test::test_intelligence_event_org_scope_enforced(ctx)
        .map_err(|e| format!("intelligence_event_org_scope_enforced: {e}"))?;
    Ok(())
}

#[spacetimedb::reducer]
pub fn run_all_ai_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_ai_insight_org_scope_test(ctx)?;
    run_ai_document_processing_job_document_relation_test(ctx)?;
    run_ai_embedding_org_isolation_test(ctx)?;
    run_ai_capability_grants_tests(ctx)?;
    run_ai_intelligence_events_tests(ctx)?;
    log::info!("✅ run_all_ai_tests complete");
    Ok(())
}
