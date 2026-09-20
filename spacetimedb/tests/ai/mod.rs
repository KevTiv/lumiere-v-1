//! AI domain test suite — invoke via `run_all_ai_tests` reducer.
pub mod capability_grants_test;
pub mod decision_events_test;
pub mod embedding_isolation_test;
pub mod evidence_provenance_test;
pub mod relational_integrity_test;
pub mod workflow_provenance_test;

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
        .map_err(|e| {
            format!("record_decision_shadow_event_records_failure_and_is_idempotent: {e}")
        })?;
    decision_events_test::test_record_decision_shadow_event_distinct_profiles_do_not_collide(ctx)
        .map_err(|e| format!("record_decision_shadow_event_distinct_profiles_do_not_collide: {e}"))?;
    decision_events_test::test_intelligence_event_status_fields_are_independent(ctx)
        .map_err(|e| format!("intelligence_event_status_fields_are_independent: {e}"))?;
    decision_events_test::test_intelligence_event_org_scope_enforced(ctx)
        .map_err(|e| format!("intelligence_event_org_scope_enforced: {e}"))?;
    Ok(())
}

/// Runs every scenario and reports all failures together, so one broken
/// fixture does not hide the state of the rest. Each scenario seeds its own
/// organization, so a failure cannot corrupt a later one; any failure still
/// fails (and rolls back) the whole reducer.
fn run_scenarios(
    scenarios: &[(&str, fn(&ReducerContext) -> Result<(), String>)],
    ctx: &ReducerContext,
) -> Result<(), String> {
    let failures: Vec<String> = scenarios
        .iter()
        .filter_map(|(name, scenario)| scenario(ctx).err().map(|error| format!("{name}: {error}")))
        .collect();
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join(" | "))
    }
}

#[spacetimedb::reducer]
pub fn run_ai_evidence_provenance_tests(ctx: &ReducerContext) -> Result<(), String> {
    use evidence_provenance_test as t;
    run_scenarios(
        &[
            (
                "sources_round_trip_and_unknowns_stay_unknown",
                t::test_sources_round_trip_and_unknowns_stay_unknown,
            ),
            ("recollected_source_stays_unverified", t::test_recollected_source_stays_unverified),
            ("cross_scope_references_are_denied", t::test_cross_scope_references_are_denied),
            (
                "lineage_reconstructs_after_edit_and_fork",
                t::test_lineage_reconstructs_after_edit_and_fork,
            ),
            (
                "knowledge_is_approved_by_review_not_usage",
                t::test_knowledge_is_approved_by_review_not_usage,
            ),
            (
                "retraction_flags_dependents_and_blocks_reuse",
                t::test_retraction_flags_dependents_and_blocks_reuse,
            ),
            (
                "correction_requires_review_and_recovers",
                t::test_correction_requires_review_and_recovers,
            ),
            (
                "deletion_and_revocation_preserve_honest_history",
                t::test_deletion_and_revocation_preserve_honest_history,
            ),
            (
                "document_blob_passage_claim_lifecycle",
                t::test_document_blob_passage_claim_lifecycle,
            ),
            (
                "discretionary_dependencies_need_acknowledgement",
                t::test_discretionary_dependencies_need_acknowledgement,
            ),
            (
                "human_review_is_independent_persisted_and_auditable",
                t::test_human_review_is_independent_persisted_and_auditable,
            ),
        ],
        ctx,
    )
}

/// Focused workflow-provenance suite: typed staging, atomic component binding,
/// clone/edit ancestry, exact-hash reviewer confirmation and source-change
/// flagging for harness-generated workflows.
#[spacetimedb::reducer]
pub fn run_workflow_provenance_tests(ctx: &ReducerContext) -> Result<(), String> {
    use workflow_provenance_test as t;
    run_scenarios(
        &[
            ("authority_is_server_resolved", t::test_authority_is_server_resolved),
            ("generated_workflow_binds_every_step", t::test_generated_workflow_binds_every_step),
            (
                "invalid_provenance_blocks_and_leaves_no_bindings",
                t::test_invalid_provenance_blocks_and_leaves_no_bindings,
            ),
            (
                "clone_and_edit_preserve_ancestry_and_exact_hash_confirmation",
                t::test_clone_and_edit_preserve_ancestry_and_exact_hash_confirmation,
            ),
            (
                "source_revocation_flags_and_blocks_workflow_reuse",
                t::test_source_revocation_flags_and_blocks_workflow_reuse,
            ),
        ],
        ctx,
    )
}

#[spacetimedb::reducer]
pub fn run_all_ai_tests(ctx: &ReducerContext) -> Result<(), String> {
    run_ai_insight_org_scope_test(ctx)?;
    run_ai_document_processing_job_document_relation_test(ctx)?;
    run_ai_embedding_org_isolation_test(ctx)?;
    run_ai_capability_grants_tests(ctx)?;
    run_ai_intelligence_events_tests(ctx)?;
    run_ai_evidence_provenance_tests(ctx)?;
    run_workflow_provenance_tests(ctx)?;
    log::info!("✅ run_all_ai_tests complete");
    Ok(())
}
