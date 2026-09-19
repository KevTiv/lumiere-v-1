//! AI-IE-001..009: `AiIntelligenceEvent` durable recording, replay
//! idempotency, validation, and independent verification/escalation/
//! acceptance settability (GP-05).
use spacetimedb::ReducerContext;

use crate::ai::agents::{ai_agent, create_ai_agent, CreateAiAgentParams};
use crate::ai::decision_events::{
    ai_intelligence_event, record_ai_decision_event, record_ai_decision_shadow_event,
    record_ai_reasoning_event, set_ai_intelligence_event_acceptance,
    set_ai_intelligence_event_escalation, set_ai_intelligence_event_verification,
    RecordAiDecisionEventParams, RecordAiDecisionShadowEventParams, RecordAiReasoningEventParams,
};
use crate::ai::skills::{
    ai_agent_run, ai_skill, create_ai_agent_run, create_ai_skill, CreateAiAgentRunParams,
    CreateAiSkillParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

fn seed_run(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    label: &str,
) -> Result<u64, String> {
    let skill_key = format!("test-skill-{label}");
    create_ai_skill(
        ctx,
        organization_id,
        CreateAiSkillParams {
            skill_key: skill_key.clone(),
            name: format!("Test Skill {label}"),
            description: None,
            category: "test".to_string(),
            prompt_template: "test".to_string(),
            required_tools: vec![],
            optional_tools: vec![],
            default_max_steps: 5,
            default_max_tool_calls: 5,
            output_schema: None,
            config_schema: None,
            dataset_specs: None,
            allowed_action_drafts: vec![],
            is_active: true,
            is_system: false,
            metadata: None,
        },
    )?;
    let skill_id = ctx
        .db
        .ai_skill()
        .ai_skill_by_org()
        .filter(&organization_id)
        .find(|s| s.skill_key == skill_key)
        .map(|s| s.id)
        .ok_or_else(|| format!("skill {skill_key} not found after create"))?;

    create_ai_agent(
        ctx,
        organization_id,
        Some(company_id),
        CreateAiAgentParams {
            name: format!("Test Agent {label}"),
            model: "mistral-large-latest".to_string(),
            provider: "mistral".to_string(),
            temperature: 0.2,
            max_tokens: 1024,
            rate_limit_per_minute: 60,
            cost_per_1k_tokens: 0.01,
            context_window: 32_000,
            top_p: 1.0,
            frequency_penalty: 0.0,
            presence_penalty: 0.0,
            is_active: true,
            is_default: false,
            allowed_models: vec!["mistral-large-latest".to_string()],
            allowed_actions: vec![],
            description: None,
            api_key_reference: None,
            system_prompt: None,
            monthly_budget: None,
            metadata: None,
        },
    )?;
    let agent_id = ctx
        .db
        .ai_agent()
        .ai_agent_by_org()
        .filter(&organization_id)
        .map(|a| a.id)
        .max()
        .ok_or("agent not found after create")?;

    let run_key = format!("test-run-{label}");
    create_ai_agent_run(
        ctx,
        organization_id,
        CreateAiAgentRunParams {
            company_id,
            skill_id,
            skill_config_id: None,
            agent_id,
            team_member_id: None,
            run_key: run_key.clone(),
            inputs_json: "{}".to_string(),
            triggered_by_hex: "0".repeat(64),
            metadata: None,
        },
    )?;
    let run_id = ctx
        .db
        .ai_agent_run()
        .ai_agent_run_by_run_key()
        .filter(&run_key)
        .map(|r| r.id)
        .next();
    run_id.ok_or_else(|| format!("run {run_key} not found after create"))
}

fn decision_params(step_no: u32, request_hash: &str) -> RecordAiDecisionEventParams {
    RecordAiDecisionEventParams {
        step_no,
        decision_type_name: "PaymentDisposition".to_string(),
        decision_type_version: 1,
        request_hash: request_hash.to_string(),
        request_json: r#"{"question":"flag or clear?"}"#.to_string(),
        outcome_kind: "choice".to_string(),
        output_json: r#"{"choice":"flag"}"#.to_string(),
        confidence: Some(0.8),
        provider: "mistral".to_string(),
        model: "mistral-large-latest".to_string(),
        provider_attempt_id: None,
        input_tokens: 12,
        output_tokens: 8,
    }
}

fn shadow_success_params(request_hash: &str, shadow_profile_ref: &str) -> RecordAiDecisionShadowEventParams {
    RecordAiDecisionShadowEventParams {
        shadow_profile_ref: shadow_profile_ref.to_string(),
        decision_type_name: "PaymentDisposition".to_string(),
        decision_type_version: 1,
        request_hash: request_hash.to_string(),
        request_json: r#"{"question":"flag or clear?"}"#.to_string(),
        outcome_kind: Some("choice".to_string()),
        output_json: Some(r#"{"choice":"clear"}"#.to_string()),
        confidence: Some(0.6),
        provider: "gemini".to_string(),
        model: "gemini-shadow".to_string(),
        input_tokens: 10,
        output_tokens: 6,
        shadow_error: None,
    }
}

fn shadow_failure_params(request_hash: &str, shadow_profile_ref: &str) -> RecordAiDecisionShadowEventParams {
    RecordAiDecisionShadowEventParams {
        shadow_profile_ref: shadow_profile_ref.to_string(),
        decision_type_name: "PaymentDisposition".to_string(),
        decision_type_version: 1,
        request_hash: request_hash.to_string(),
        request_json: r#"{"question":"flag or clear?"}"#.to_string(),
        outcome_kind: None,
        output_json: None,
        confidence: None,
        provider: "gemini".to_string(),
        model: "gemini-shadow".to_string(),
        input_tokens: 0,
        output_tokens: 0,
        shadow_error: Some("provider timeout".to_string()),
    }
}

/// AI-IE-010: a successful shadow decision event round-trips with zero
/// live authority — `acceptance_status` is always "rejected" — and is
/// correlated to the production event only by `request_hash`, not a
/// shared `step_no`.
pub fn test_record_decision_shadow_event_persists(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let run_id = seed_run(ctx, fixture.organization_id, fixture.company_id, "ie010")?;

    record_ai_decision_event(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        run_id,
        decision_params(1, "hash-ie010"),
    )?;
    record_ai_decision_shadow_event(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        run_id,
        shadow_success_params("hash-ie010", "shadow-profile@1"),
    )?;

    let event = ctx
        .db
        .ai_intelligence_event()
        .ai_intelligence_event_by_run()
        .filter(&run_id)
        .find(|e| e.event_kind == "decision_shadow")
        .ok_or("AI-IE-010: shadow event not found after record")?;

    if event.request_hash != "hash-ie010"
        || event.shadow_profile_ref.as_deref() != Some("shadow-profile@1")
        || event.shadow_error.is_some()
        || event.outcome_kind != "choice"
        || event.acceptance_status != "rejected"
    {
        return Err(format!("AI-IE-010: unexpected persisted shadow event {event:?}"));
    }
    let production_count = ctx
        .db
        .ai_intelligence_event()
        .ai_intelligence_event_by_run()
        .filter(&run_id)
        .filter(|e| e.event_kind == "decision")
        .count();
    if production_count != 1 {
        return Err("AI-IE-010: shadow event must never mutate the production event".to_string());
    }
    Ok(())
}

/// AI-IE-011: a failed shadow attempt is recorded with `shadow_error` set
/// and no `outcome_kind`/`output_json`, and replaying the identical
/// failure payload is idempotent rather than a duplicate row.
pub fn test_record_decision_shadow_event_records_failure_and_is_idempotent(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let run_id = seed_run(ctx, fixture.organization_id, fixture.company_id, "ie011")?;

    let params = shadow_failure_params("hash-ie011", "shadow-profile@1");
    record_ai_decision_shadow_event(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        run_id,
        params.clone(),
    )?;
    record_ai_decision_shadow_event(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        run_id,
        params,
    )?;

    let matches: Vec<_> = ctx
        .db
        .ai_intelligence_event()
        .ai_intelligence_event_by_run()
        .filter(&run_id)
        .filter(|e| e.event_kind == "decision_shadow")
        .collect();
    if matches.len() != 1 {
        return Err(format!(
            "AI-IE-011: expected exactly one shadow row, got {}",
            matches.len()
        ));
    }
    let event = &matches[0];
    if event.shadow_error.as_deref() != Some("provider timeout") || event.outcome_kind != "failed" {
        return Err(format!("AI-IE-011: unexpected failed shadow event {event:?}"));
    }
    Ok(())
}

/// AI-IE-012: two shadow profiles evaluating the same production request
/// (same `request_hash`) each persist their own row rather than
/// colliding on idempotency.
pub fn test_record_decision_shadow_event_distinct_profiles_do_not_collide(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let run_id = seed_run(ctx, fixture.organization_id, fixture.company_id, "ie012")?;

    record_ai_decision_shadow_event(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        run_id,
        shadow_success_params("hash-ie012", "shadow-a@1"),
    )?;
    record_ai_decision_shadow_event(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        run_id,
        shadow_success_params("hash-ie012", "shadow-b@1"),
    )?;

    let count = ctx
        .db
        .ai_intelligence_event()
        .ai_intelligence_event_by_run()
        .filter(&run_id)
        .filter(|e| e.event_kind == "decision_shadow")
        .count();
    if count != 2 {
        return Err(format!(
            "AI-IE-012: expected two independent shadow rows, got {count}"
        ));
    }
    Ok(())
}

/// AI-IE-001: a decision event round-trips through the durable table with
/// its fields intact and starts pending/unverified/unescalated.
pub fn test_record_decision_event_persists(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let run_id = seed_run(ctx, fixture.organization_id, fixture.company_id, "ie001")?;

    record_ai_decision_event(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        run_id,
        decision_params(1, "hash-ie001"),
    )?;

    let event = ctx
        .db
        .ai_intelligence_event()
        .ai_intelligence_event_by_run()
        .filter(&run_id)
        .find(|e| e.step_no == 1)
        .ok_or("AI-IE-001: event not found after record")?;

    if event.event_kind != "decision"
        || event.decision_type_name.as_deref() != Some("PaymentDisposition")
        || event.decision_type_version != Some(1)
        || event.outcome_kind != "choice"
        || event.confidence != Some(0.8)
        || event.verification_status.is_some()
        || event.escalation_status != "none"
        || event.acceptance_status != "pending"
    {
        return Err(format!("AI-IE-001: unexpected persisted event {event:?}"));
    }
    Ok(())
}

/// AI-IE-002: replaying the identical payload for the same run/step is a
/// no-op, not a duplicate row.
pub fn test_record_decision_event_replay_is_idempotent(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let run_id = seed_run(ctx, fixture.organization_id, fixture.company_id, "ie002")?;

    let params = decision_params(1, "hash-ie002");
    record_ai_decision_event(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        run_id,
        params.clone(),
    )?;
    record_ai_decision_event(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        run_id,
        params,
    )?;

    let count = ctx
        .db
        .ai_intelligence_event()
        .ai_intelligence_event_by_run()
        .filter(&run_id)
        .count();
    if count != 1 {
        return Err(format!("AI-IE-002: expected exactly one row, got {count}"));
    }
    Ok(())
}

/// AI-IE-003: a differing payload for an already-recorded run/step is
/// rejected rather than silently overwriting the original.
pub fn test_record_decision_event_replay_conflict_is_rejected(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let run_id = seed_run(ctx, fixture.organization_id, fixture.company_id, "ie003")?;

    record_ai_decision_event(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        run_id,
        decision_params(1, "hash-ie003-a"),
    )?;
    let conflicting = record_ai_decision_event(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        run_id,
        decision_params(1, "hash-ie003-b"),
    );
    match conflicting {
        Err(ref e) if e.to_lowercase().contains("conflict") => {}
        other => {
            return Err(format!(
                "AI-IE-003: expected replay-conflict error, got {other:?}"
            ))
        }
    }
    Ok(())
}

/// AI-IE-004: an outcome_kind outside {choice, score, probability} is
/// rejected for a decision event.
pub fn test_record_decision_event_rejects_unknown_outcome_kind(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let run_id = seed_run(ctx, fixture.organization_id, fixture.company_id, "ie004")?;

    let mut params = decision_params(1, "hash-ie004");
    params.outcome_kind = "capability_proposal".to_string();
    let result = record_ai_decision_event(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        run_id,
        params,
    );
    match result {
        Err(ref e) if e.contains("outcome_kind") => {}
        other => {
            return Err(format!(
                "AI-IE-004: expected outcome_kind validation error, got {other:?}"
            ))
        }
    }
    Ok(())
}

/// AI-IE-005: confidence outside [0, 1] is rejected.
pub fn test_record_decision_event_rejects_out_of_range_confidence(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let run_id = seed_run(ctx, fixture.organization_id, fixture.company_id, "ie005")?;

    let mut params = decision_params(1, "hash-ie005");
    params.confidence = Some(1.4);
    let result = record_ai_decision_event(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        run_id,
        params,
    );
    match result {
        Err(ref e) if e.contains("confidence") => {}
        other => {
            return Err(format!(
                "AI-IE-005: expected confidence validation error, got {other:?}"
            ))
        }
    }
    Ok(())
}

/// AI-IE-006: a `provider_attempt_id` that does not reference an existing
/// attempt is rejected rather than persisted as a dangling link.
pub fn test_record_decision_event_rejects_unknown_provider_attempt(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let run_id = seed_run(ctx, fixture.organization_id, fixture.company_id, "ie006")?;

    let mut params = decision_params(1, "hash-ie006");
    params.provider_attempt_id = Some(999_999_999);
    let result = record_ai_decision_event(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        run_id,
        params,
    );
    match result {
        Err(ref e) if e.contains("provider_attempt_id") => {}
        other => {
            return Err(format!(
                "AI-IE-006: expected provider_attempt_id validation error, got {other:?}"
            ))
        }
    }
    Ok(())
}

/// AI-IE-007: a reasoning event whose outcome is `clarification_request`
/// pre-sets `escalation_status` to "clarification" without a second call.
pub fn test_record_reasoning_event_clarification_escalates_automatically(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let run_id = seed_run(ctx, fixture.organization_id, fixture.company_id, "ie007")?;

    record_ai_reasoning_event(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        run_id,
        RecordAiReasoningEventParams {
            step_no: 1,
            request_hash: "hash-ie007".to_string(),
            request_json: r#"{"objective":"investigate"}"#.to_string(),
            outcome_kind: "clarification_request".to_string(),
            output_json: r#"{"prompt":"which vendor?"}"#.to_string(),
            provider: "mistral".to_string(),
            model: "mistral-large-latest".to_string(),
            provider_attempt_id: None,
            input_tokens: 5,
            output_tokens: 5,
        },
    )?;

    let event = ctx
        .db
        .ai_intelligence_event()
        .ai_intelligence_event_by_run()
        .filter(&run_id)
        .find(|e| e.step_no == 1)
        .ok_or("AI-IE-007: event not found after record")?;
    if event.event_kind != "reasoning" || event.escalation_status != "clarification" {
        return Err(format!(
            "AI-IE-007: expected auto-escalated clarification event, got {event:?}"
        ));
    }
    Ok(())
}

/// AI-IE-008: verification, escalation and acceptance are independently
/// settable — setting one does not change the others — and each rejects
/// an unknown status value.
pub fn test_intelligence_event_status_fields_are_independent(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let run_id = seed_run(ctx, fixture.organization_id, fixture.company_id, "ie008")?;

    record_ai_decision_event(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        run_id,
        decision_params(1, "hash-ie008"),
    )?;
    let event_id = ctx
        .db
        .ai_intelligence_event()
        .ai_intelligence_event_by_run()
        .filter(&run_id)
        .find(|e| e.step_no == 1)
        .ok_or("AI-IE-008: event not found after record")?
        .id;

    let bad_verification = set_ai_intelligence_event_verification(
        ctx,
        fixture.organization_id,
        event_id,
        "not-a-status".to_string(),
        None,
    );
    if bad_verification.is_ok() {
        return Err("AI-IE-008: expected unknown verification status to be rejected".to_string());
    }

    set_ai_intelligence_event_verification(
        ctx,
        fixture.organization_id,
        event_id,
        "verified".to_string(),
        Some("shape check passed".to_string()),
    )?;
    set_ai_intelligence_event_escalation(
        ctx,
        fixture.organization_id,
        event_id,
        "review_required".to_string(),
        Some("high risk decision type".to_string()),
    )?;
    set_ai_intelligence_event_acceptance(
        ctx,
        fixture.organization_id,
        event_id,
        "accepted".to_string(),
        None,
    )?;

    let event = ctx
        .db
        .ai_intelligence_event()
        .id()
        .find(&event_id)
        .ok_or("AI-IE-008: event disappeared")?;
    if event.verification_status.as_deref() != Some("verified")
        || event.escalation_status != "review_required"
        || event.acceptance_status != "accepted"
    {
        return Err(format!(
            "AI-IE-008: expected all three statuses to hold independently, got {event:?}"
        ));
    }
    Ok(())
}

/// AI-IE-009: an event cannot be read or updated through another
/// organization's scope.
pub fn test_intelligence_event_org_scope_enforced(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let local = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let run_id = seed_run(ctx, local.organization_id, local.company_id, "ie009")?;

    record_ai_decision_event(
        ctx,
        local.organization_id,
        local.company_id,
        run_id,
        decision_params(1, "hash-ie009"),
    )?;
    let event_id = ctx
        .db
        .ai_intelligence_event()
        .ai_intelligence_event_by_run()
        .filter(&run_id)
        .find(|e| e.step_no == 1)
        .ok_or("AI-IE-009: event not found after record")?
        .id;

    let cross_org = set_ai_intelligence_event_verification(
        ctx,
        foreign.organization_id,
        event_id,
        "verified".to_string(),
        None,
    );
    match cross_org {
        Err(ref e) if e.to_lowercase().contains("organization") => {}
        other => {
            return Err(format!(
                "AI-IE-009: expected cross-org denial, got {other:?}"
            ))
        }
    }
    Ok(())
}
