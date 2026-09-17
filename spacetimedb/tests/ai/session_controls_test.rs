//! AIH-24: session controls — idempotent resume, control-version concurrency,
//! provider-attempt reconciliation, interrupt parking, manifest dependency
//! recheck, fork lineage, manifest comparison, event cursors, inspect.

use spacetimedb::{ReducerContext, Table};

use crate::ai::agents::{ai_agent, create_ai_agent, CreateAiAgentParams};
use crate::ai::continuation::{
    ai_continuation_manifest, create_ai_continuation_manifest, AiContinuationManifest,
    CreateAiContinuationManifestParams,
};
use crate::ai::lineage::{ai_decision, create_ai_decision, CreateAiDecisionParams};
use crate::ai::provenance::{
    ai_source_version, create_ai_source_version, CreateAiSourceVersionParams,
};
use crate::ai::questions::{
    ai_question, create_ai_question, reply_to_ai_question, supersede_ai_question,
    CreateAiQuestionParams, ReplyAiQuestionParams,
};
use crate::ai::session_controls::{
    ai_run_control_state, ai_run_event_cursor, ai_session_control, record_ai_run_event_cursor,
    request_ai_run_compare, request_ai_run_fork, request_ai_run_inspect, request_ai_run_interrupt,
    request_ai_run_resume, AiRunControlState, AiSessionControl, RequestAiRunCompareParams,
    RequestAiRunForkParams, RequestAiRunInterruptParams, RequestAiRunResumeParams,
};
use crate::ai::skills::{
    ai_agent_run, ai_agent_run_step, ai_skill, append_ai_agent_run_step, complete_ai_agent_run,
    create_ai_agent_run, create_ai_skill, AiAgentRun, AppendAiAgentRunStepParams,
    CompleteAiAgentRunParams, CreateAiAgentRunParams, CreateAiSkillParams,
};
use crate::ai::spend::{ai_provider_attempt, AiProviderAttempt};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

// ── Fixture helpers ──────────────────────────────────────────────────────────

struct RunFixture {
    organization_id: u64,
    company_id: u64,
    skill_id: u64,
    agent_id: u64,
    run_id: u64,
    run_key: String,
}

/// Seed an org + company + active skill + active agent + one "running" run via
/// the real reducer fns so permission and binding paths stay covered.
fn seed_run_fixture(ctx: &ReducerContext, prefix: &str) -> Result<RunFixture, String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;

    let skill_key = format!("skill-{prefix}");
    create_ai_skill(
        ctx,
        org,
        CreateAiSkillParams {
            skill_key: skill_key.clone(),
            name: format!("Skill {prefix}"),
            description: None,
            category: "research".to_string(),
            prompt_template: "Do the task".to_string(),
            required_tools: vec![],
            optional_tools: vec![],
            default_max_steps: 4,
            default_max_tool_calls: 8,
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
        .iter()
        .find(|s| s.organization_id == org && s.skill_key == skill_key)
        .map(|s| s.id)
        .ok_or("fixture skill not found")?;

    let agent_name = format!("agent-{prefix}");
    create_ai_agent(
        ctx,
        org,
        None,
        CreateAiAgentParams {
            name: agent_name.clone(),
            model: "mistral-small".to_string(),
            provider: "mistral".to_string(),
            temperature: 0.2,
            max_tokens: 4096,
            rate_limit_per_minute: 60,
            cost_per_1k_tokens: 0.1,
            context_window: 32_000,
            top_p: 0.9,
            frequency_penalty: 0.0,
            presence_penalty: 0.0,
            is_active: true,
            is_default: false,
            allowed_models: vec!["mistral-small".to_string()],
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
        .iter()
        .find(|a| a.organization_id == org && a.name == agent_name)
        .map(|a| a.id)
        .ok_or("fixture agent not found")?;

    let run_key = format!("run-{prefix}");
    create_ai_agent_run(
        ctx,
        org,
        CreateAiAgentRunParams {
            company_id: fixture.company_id,
            skill_id,
            skill_config_id: None,
            agent_id,
            team_member_id: None,
            run_key: run_key.clone(),
            inputs_json: r#"{"objective":"AIH-24 fixture"}"#.to_string(),
            triggered_by_hex: ctx.sender().to_hex().to_string(),
            metadata: None,
        },
    )?;
    let run_id = ctx
        .db
        .ai_agent_run()
        .ai_agent_run_by_run_key()
        .filter(&run_key)
        .next()
        .map(|r| r.id)
        .ok_or("fixture run not found")?;

    Ok(RunFixture {
        organization_id: org,
        company_id: fixture.company_id,
        skill_id,
        agent_id,
        run_id,
        run_key,
    })
}

fn question_params(run_id: u64, key: &str) -> CreateAiQuestionParams {
    CreateAiQuestionParams {
        company_id: None,
        run_id,
        decision_id: None,
        component_id: None,
        question_key: key.to_string(),
        question_text: format!("Question {key}: please clarify"),
        kind: "required".to_string(),
        authorized_respondents_json: None,
        status: "open".to_string(),
        version: 1,
        parent_question_id: None,
        deadline_at: None,
    }
}

fn source_params(title: &str, origin: &str, hash: &str) -> CreateAiSourceVersionParams {
    CreateAiSourceVersionParams {
        company_id: None,
        kind: "book".to_string(),
        title: title.to_string(),
        authors_json: None,
        publisher: None,
        publication_date: None,
        edition: None,
        version_label: None,
        uri: None,
        doi: None,
        file_reference: None,
        content_hash: hash.to_string(),
        snapshot_ref: None,
        retrieval_time: None,
        origin: origin.to_string(),
        owner_identity: None,
        scope: "organization".to_string(),
        retention_policy: "retain".to_string(),
        inspection_state: "inspected".to_string(),
    }
}

/// Minimal manifest with parameterizable ref arrays. Uses fixed dummy
/// non-empty hashes (validated for presence/length only).
#[allow(clippy::too_many_arguments)]
fn manifest_params(
    run_id: u64,
    decision_ids_json: &str,
    question_ids_json: &str,
    source_ids_json: &str,
    candidate_versions_json: &str,
    completed_effects_json: &str,
    budget: u32,
    deadline: spacetimedb::Timestamp,
    summary: Option<String>,
) -> CreateAiContinuationManifestParams {
    CreateAiContinuationManifestParams {
        company_id: None,
        run_id,
        objective_hash: "obj-hash-aih24".to_string(),
        constraints_json: r#"{"max_tokens":1000}"#.to_string(),
        constraints_hash: "cstr-hash-aih24".to_string(),
        accepted_decision_ids_json: decision_ids_json.to_string(),
        pending_question_ids_json: question_ids_json.to_string(),
        completed_effects_json: completed_effects_json.to_string(),
        candidate_versions_json: candidate_versions_json.to_string(),
        progress_state_json: r#"{"steps":0}"#.to_string(),
        remaining_budget_tokens: budget,
        budget_reserved_until: deadline,
        snapshot_sources_json: source_ids_json.to_string(),
        summary,
    }
}

fn interrupt_run(
    ctx: &ReducerContext,
    organization_id: u64,
    run_id: u64,
    key: &str,
) -> Result<(), String> {
    request_ai_run_interrupt(
        ctx,
        organization_id,
        RequestAiRunInterruptParams {
            run_id,
            idempotency_key: key.to_string(),
            reason: Some("AIH-24 test interrupt".to_string()),
        },
    )
}

fn resume_run(
    ctx: &ReducerContext,
    organization_id: u64,
    run_id: u64,
    key: &str,
    expected_control_version: u32,
    manifest_id: Option<u64>,
) -> Result<(), String> {
    request_ai_run_resume(
        ctx,
        organization_id,
        RequestAiRunResumeParams {
            run_id,
            idempotency_key: key.to_string(),
            expected_control_version,
            manifest_id,
        },
    )
}

// ── Assertion helpers ────────────────────────────────────────────────────────

fn intents_for(
    ctx: &ReducerContext,
    organization_id: u64,
    idempotency_key: &str,
) -> Vec<AiSessionControl> {
    let key = idempotency_key.to_string();
    ctx.db
        .ai_session_control()
        .ai_session_control_by_org_key()
        .filter((&organization_id, &key))
        .collect()
}

fn run_status(ctx: &ReducerContext, run_id: u64) -> Result<String, String> {
    ctx.db
        .ai_agent_run()
        .id()
        .find(&run_id)
        .map(|r| r.status)
        .ok_or_else(|| "run not found".to_string())
}

fn control_state_for(
    ctx: &ReducerContext,
    organization_id: u64,
    run_id: u64,
) -> Result<AiRunControlState, String> {
    ctx.db
        .ai_run_control_state()
        .ai_run_control_state_by_run()
        .filter(&run_id)
        .find(|cs| cs.organization_id == organization_id)
        .ok_or_else(|| "control state not found".to_string())
}

fn parse_result(intent: &AiSessionControl) -> Result<serde_json::Value, String> {
    let raw = intent
        .result_json
        .as_deref()
        .ok_or("intent has no result_json")?;
    serde_json::from_str(raw).map_err(|e| format!("invalid result JSON: {e}"))
}

fn question_id_by_key(
    ctx: &ReducerContext,
    organization_id: u64,
    key: &str,
) -> Result<u64, String> {
    ctx.db
        .ai_question()
        .iter()
        .find(|q| q.organization_id == organization_id && q.question_key == key)
        .map(|q| q.id)
        .ok_or_else(|| format!("question {key} not found"))
}

fn manifest_by_summary(
    ctx: &ReducerContext,
    organization_id: u64,
    run_id: u64,
    summary: &str,
) -> Result<AiContinuationManifest, String> {
    ctx.db
        .ai_continuation_manifest()
        .ai_continuation_manifest_by_run()
        .filter(&run_id)
        .find(|m| m.organization_id == organization_id && m.summary.as_deref() == Some(summary))
        .ok_or_else(|| format!("manifest {summary} not found"))
}

// ── AIH-24.1: duplicate resume is idempotent ─────────────────────────────────

/// Two identical resume requests produce exactly one applied + one duplicate
/// intent; control_version bumps once; the run is re-queued once.
pub fn test_session_duplicate_resume_is_idempotent(ctx: &ReducerContext) -> Result<(), String> {
    let fx = seed_run_fixture(ctx, "aih24-1")?;
    assert_eq!(run_status(ctx, fx.run_id)?, "running");

    interrupt_run(ctx, fx.organization_id, fx.run_id, "int-aih24-1")?;
    assert_eq!(run_status(ctx, fx.run_id)?, "interrupted");
    let cs = control_state_for(ctx, fx.organization_id, fx.run_id)?;
    if cs.phase != "interrupted" || cs.control_version != 1 {
        return Err("AIH-24.1 interrupt should park the run at version 1".to_string());
    }

    let params = RequestAiRunResumeParams {
        run_id: fx.run_id,
        idempotency_key: "res-aih24-1".to_string(),
        expected_control_version: 1,
        manifest_id: None,
    };
    request_ai_run_resume(ctx, fx.organization_id, params.clone())?;
    assert_eq!(run_status(ctx, fx.run_id)?, "pending");
    let cs = control_state_for(ctx, fx.organization_id, fx.run_id)?;
    if cs.phase != "resumed" || cs.control_version != 2 {
        return Err("AIH-24.1 resume should re-queue at version 2".to_string());
    }

    // Retried identical request: duplicate, no re-apply.
    request_ai_run_resume(ctx, fx.organization_id, params)?;
    let intents = intents_for(ctx, fx.organization_id, "res-aih24-1");
    let applied = intents.iter().filter(|i| i.status == "applied").count();
    let duplicate = intents.iter().filter(|i| i.status == "duplicate").count();
    if applied != 1 || duplicate != 1 || intents.len() != 2 {
        return Err(format!(
            "AIH-24.1 expected 1 applied + 1 duplicate resume intent, got {} rows (applied={applied}, duplicate={duplicate})",
            intents.len()
        ));
    }
    let cs = control_state_for(ctx, fx.organization_id, fx.run_id)?;
    if cs.control_version != 2 {
        return Err("AIH-24.1 duplicate resume must not bump control_version".to_string());
    }
    assert_eq!(run_status(ctx, fx.run_id)?, "pending");
    Ok(())
}

// ── AIH-24.2: stale expected_control_version rejects ─────────────────────────

/// A resume whose expected_control_version does not match is recorded as a
/// rejected intent without bumping the version; the correct version applies.
pub fn test_session_stale_control_version_rejects(ctx: &ReducerContext) -> Result<(), String> {
    let fx = seed_run_fixture(ctx, "aih24-2")?;
    interrupt_run(ctx, fx.organization_id, fx.run_id, "int-aih24-2")?;

    resume_run(
        ctx,
        fx.organization_id,
        fx.run_id,
        "res-aih24-2-stale",
        0,
        None,
    )?;
    let intents = intents_for(ctx, fx.organization_id, "res-aih24-2-stale");
    if intents.len() != 1 || intents[0].status != "rejected" {
        return Err("AIH-24.2 stale resume should record one rejected intent".to_string());
    }
    let reason = intents[0].reason.as_deref().unwrap_or_default();
    if !reason.contains("control version mismatch") {
        return Err(format!("AIH-24.2 unexpected rejection reason: {reason}"));
    }
    let cs = control_state_for(ctx, fx.organization_id, fx.run_id)?;
    if cs.control_version != 1 {
        return Err("AIH-24.2 rejected resume must not bump control_version".to_string());
    }
    assert_eq!(run_status(ctx, fx.run_id)?, "interrupted");

    // With the current version the resume applies.
    resume_run(
        ctx,
        fx.organization_id,
        fx.run_id,
        "res-aih24-2-ok",
        1,
        None,
    )?;
    let intents = intents_for(ctx, fx.organization_id, "res-aih24-2-ok");
    if intents.len() != 1 || intents[0].status != "applied" {
        return Err("AIH-24.2 resume with current version should apply".to_string());
    }
    assert_eq!(run_status(ctx, fx.run_id)?, "pending");
    let cs = control_state_for(ctx, fx.organization_id, fx.run_id)?;
    if cs.control_version != 2 {
        return Err("AIH-24.2 applied resume should bump to version 2".to_string());
    }
    Ok(())
}

// ── AIH-24.3: resume requires provider-attempt reconciliation ────────────────

/// An `outcome_unknown` provider attempt blocks resume until it is reconciled
/// to a known outcome.
pub fn test_session_resume_requires_provider_reconciliation(
    ctx: &ReducerContext,
) -> Result<(), String> {
    let fx = seed_run_fixture(ctx, "aih24-3")?;
    interrupt_run(ctx, fx.organization_id, fx.run_id, "int-aih24-3")?;

    // Direct-insert fixture row: the full spend reservation/admission pipeline
    // is not the unit under test; the resume gate only scans attempt status.
    let attempt = ctx.db.ai_provider_attempt().insert(AiProviderAttempt {
        id: 0,
        organization_id: fx.organization_id,
        company_id: fx.company_id,
        agent_id: fx.agent_id,
        run_id: fx.run_id,
        reservation_id: 9_000,
        request_key: format!("aih24-3-req-{}", fx.run_id),
        provider: "mistral".to_string(),
        model: "mistral-small".to_string(),
        status: "outcome_unknown".to_string(),
        input_tokens: 0,
        output_tokens: 0,
        failure_reason: None,
        resolution: None,
        accepted_by: ctx.sender(),
        write_uid: ctx.sender(),
        created_at: ctx.timestamp,
        dispatched_at: Some(ctx.timestamp),
        finished_at: None,
        write_date: ctx.timestamp,
    });

    resume_run(ctx, fx.organization_id, fx.run_id, "res-aih24-3", 1, None)?;
    let intents = intents_for(ctx, fx.organization_id, "res-aih24-3");
    if intents.len() != 1 || intents[0].status != "rejected" {
        return Err("AIH-24.3 unknown-outcome attempt should block resume".to_string());
    }
    let reason = intents[0].reason.as_deref().unwrap_or_default();
    if !reason.contains("pending reconciliation for attempts")
        || !reason.contains(&attempt.id.to_string())
    {
        return Err(format!(
            "AIH-24.3 rejection should list the attempt id, got: {reason}"
        ));
    }
    assert_eq!(run_status(ctx, fx.run_id)?, "interrupted");
    let cs = control_state_for(ctx, fx.organization_id, fx.run_id)?;
    if cs.control_version != 1 {
        return Err("AIH-24.3 blocked resume must not bump control_version".to_string());
    }

    // Direct update to a known outcome: reconciliation normally flows through
    // reconcile_ai_provider_attempt, which needs a full reservation fixture;
    // the gate only requires that no attempt is outcome_unknown.
    ctx.db.ai_provider_attempt().id().update(AiProviderAttempt {
        status: "succeeded".to_string(),
        finished_at: Some(ctx.timestamp),
        ..attempt
    });

    resume_run(
        ctx,
        fx.organization_id,
        fx.run_id,
        "res-aih24-3-ok",
        1,
        None,
    )?;
    let intents = intents_for(ctx, fx.organization_id, "res-aih24-3-ok");
    if intents.len() != 1 || intents[0].status != "applied" {
        return Err("AIH-24.3 resume should apply after reconciliation".to_string());
    }
    let result = parse_result(&intents[0])?;
    if result["reconciled_checks"] != serde_json::json!(["provider_attempts"]) {
        return Err(format!(
            "AIH-24.3 unexpected reconciled_checks: {}",
            result["reconciled_checks"]
        ));
    }
    assert_eq!(run_status(ctx, fx.run_id)?, "pending");
    Ok(())
}

// ── AIH-24.4: interrupt parks runs; terminal rejects; duplicate idempotent ──

/// Interrupt parks a running run and a pending run as `interrupted`; a
/// duplicate interrupt is idempotent; interrupting a terminal run rejects.
pub fn test_session_interrupt_parks_and_terminal_rejects(
    ctx: &ReducerContext,
) -> Result<(), String> {
    let fx = seed_run_fixture(ctx, "aih24-4")?;

    // Park run A from "running".
    interrupt_run(ctx, fx.organization_id, fx.run_id, "int-aih24-4-a")?;
    assert_eq!(run_status(ctx, fx.run_id)?, "interrupted");
    let cs = control_state_for(ctx, fx.organization_id, fx.run_id)?;
    if cs.phase != "interrupted" || cs.control_version != 1 {
        return Err("AIH-24.4 interrupt should park run A at version 1".to_string());
    }

    // Duplicate interrupt with the same key: recorded, not re-applied.
    interrupt_run(ctx, fx.organization_id, fx.run_id, "int-aih24-4-a")?;
    let intents = intents_for(ctx, fx.organization_id, "int-aih24-4-a");
    let applied = intents.iter().filter(|i| i.status == "applied").count();
    let duplicate = intents.iter().filter(|i| i.status == "duplicate").count();
    if applied != 1 || duplicate != 1 {
        return Err("AIH-24.4 duplicate interrupt should be idempotent".to_string());
    }
    let cs = control_state_for(ctx, fx.organization_id, fx.run_id)?;
    if cs.control_version != 1 {
        return Err("AIH-24.4 duplicate interrupt must not bump control_version".to_string());
    }
    assert_eq!(run_status(ctx, fx.run_id)?, "interrupted");

    // Park run B from "pending". Fixture note: no reducer re-queues a run to
    // "pending" except resume, so set the status directly.
    let run_b_key = "run-aih24-4-b".to_string();
    create_ai_agent_run(
        ctx,
        fx.organization_id,
        CreateAiAgentRunParams {
            company_id: fx.company_id,
            skill_id: fx.skill_id,
            skill_config_id: None,
            agent_id: fx.agent_id,
            team_member_id: None,
            run_key: run_b_key.clone(),
            inputs_json: r#"{"objective":"AIH-24 fixture B"}"#.to_string(),
            triggered_by_hex: ctx.sender().to_hex().to_string(),
            metadata: None,
        },
    )?;
    let run_b = ctx
        .db
        .ai_agent_run()
        .ai_agent_run_by_run_key()
        .filter(&run_b_key)
        .next()
        .ok_or("AIH-24.4 run B not found")?;
    ctx.db.ai_agent_run().id().update(AiAgentRun {
        status: "pending".to_string(),
        ..run_b
    });
    interrupt_run(ctx, fx.organization_id, run_b.id, "int-aih24-4-b")?;
    assert_eq!(run_status(ctx, run_b.id)?, "interrupted");

    // Terminal runs reject the interrupt.
    complete_ai_agent_run(
        ctx,
        fx.organization_id,
        fx.company_id,
        fx.run_id,
        CompleteAiAgentRunParams {
            status: "completed".to_string(),
            summary: Some("done".to_string()),
            artifacts_json: None,
            citations_json: None,
            action_draft_ids: vec![],
            step_count: 0,
            tokens_used: 0,
            error_message: None,
        },
    )?;
    assert_eq!(run_status(ctx, fx.run_id)?, "completed");
    interrupt_run(ctx, fx.organization_id, fx.run_id, "int-aih24-4-terminal")?;
    let intents = intents_for(ctx, fx.organization_id, "int-aih24-4-terminal");
    if intents.len() != 1 || intents[0].status != "rejected" {
        return Err("AIH-24.4 terminal interrupt should be rejected".to_string());
    }
    let reason = intents[0].reason.as_deref().unwrap_or_default();
    if !reason.contains("terminal") {
        return Err(format!("AIH-24.4 unexpected terminal reason: {reason}"));
    }
    assert_eq!(run_status(ctx, fx.run_id)?, "completed");
    let cs = control_state_for(ctx, fx.organization_id, fx.run_id)?;
    if cs.control_version != 1 {
        return Err("AIH-24.4 rejected terminal interrupt must not bump version".to_string());
    }
    Ok(())
}

// ── AIH-24.5: resume rechecks checkpoint questions ───────────────────────────

/// A checkpoint question answered since the checkpoint lets resume proceed;
/// a question superseded since the checkpoint rejects with "requirements
/// changed".
pub fn test_session_resume_rechecks_manifest_questions(ctx: &ReducerContext) -> Result<(), String> {
    // Scenario A: answered since checkpoint → proceed.
    let fx = seed_run_fixture(ctx, "aih24-5a")?;
    create_ai_question(
        ctx,
        fx.organization_id,
        question_params(fx.run_id, "aih24-5-q-a"),
    )?;
    let q_id = question_id_by_key(ctx, fx.organization_id, "aih24-5-q-a")?;
    let pending = format!("[{q_id}]");
    create_ai_continuation_manifest(
        ctx,
        fx.organization_id,
        manifest_params(
            fx.run_id,
            "[]",
            &pending,
            "[]",
            "[]",
            "[]",
            500,
            ctx.timestamp,
            Some("aih24-5a".to_string()),
        ),
    )?;
    let manifest = manifest_by_summary(ctx, fx.organization_id, fx.run_id, "aih24-5a")?;
    interrupt_run(ctx, fx.organization_id, fx.run_id, "int-aih24-5a")?;

    reply_to_ai_question(
        ctx,
        fx.organization_id,
        ReplyAiQuestionParams {
            question_id: q_id,
            answer: "answered since checkpoint".to_string(),
        },
    )?;
    let question = ctx
        .db
        .ai_question()
        .id()
        .find(&q_id)
        .ok_or("AIH-24.5 question A disappeared")?;
    if question.status != "answered" {
        return Err("AIH-24.5 scenario A question should be answered".to_string());
    }

    resume_run(
        ctx,
        fx.organization_id,
        fx.run_id,
        "res-aih24-5a",
        1,
        Some(manifest.id),
    )?;
    let intents = intents_for(ctx, fx.organization_id, "res-aih24-5a");
    if intents.len() != 1 || intents[0].status != "applied" {
        return Err("AIH-24.5 answered question should let resume proceed".to_string());
    }
    let result = parse_result(&intents[0])?;
    if result["reconciled_checks"]
        != serde_json::json!(["provider_attempts", "questions", "sources"])
    {
        return Err(format!(
            "AIH-24.5 unexpected reconciled_checks: {}",
            result["reconciled_checks"]
        ));
    }
    if result["manifest_id"] != serde_json::json!(manifest.id) {
        return Err("AIH-24.5 result should echo the manifest id".to_string());
    }
    assert_eq!(run_status(ctx, fx.run_id)?, "pending");

    // Scenario B: superseded since checkpoint → reject.
    let fx = seed_run_fixture(ctx, "aih24-5b")?;
    create_ai_question(
        ctx,
        fx.organization_id,
        question_params(fx.run_id, "aih24-5-q-b"),
    )?;
    let q_id = question_id_by_key(ctx, fx.organization_id, "aih24-5-q-b")?;
    let pending = format!("[{q_id}]");
    create_ai_continuation_manifest(
        ctx,
        fx.organization_id,
        manifest_params(
            fx.run_id,
            "[]",
            &pending,
            "[]",
            "[]",
            "[]",
            500,
            ctx.timestamp,
            Some("aih24-5b".to_string()),
        ),
    )?;
    let manifest = manifest_by_summary(ctx, fx.organization_id, fx.run_id, "aih24-5b")?;
    interrupt_run(ctx, fx.organization_id, fx.run_id, "int-aih24-5b")?;

    supersede_ai_question(
        ctx,
        fx.organization_id,
        q_id,
        "aih24-5-q-b-next".to_string(),
    )?;
    resume_run(
        ctx,
        fx.organization_id,
        fx.run_id,
        "res-aih24-5b",
        1,
        Some(manifest.id),
    )?;
    let intents = intents_for(ctx, fx.organization_id, "res-aih24-5b");
    if intents.len() != 1 || intents[0].status != "rejected" {
        return Err("AIH-24.5 superseded question should reject the resume".to_string());
    }
    let reason = intents[0].reason.as_deref().unwrap_or_default();
    if !reason.contains("requirements changed since checkpoint") {
        return Err(format!("AIH-24.5 unexpected rejection reason: {reason}"));
    }
    assert_eq!(run_status(ctx, fx.run_id)?, "interrupted");
    let cs = control_state_for(ctx, fx.organization_id, fx.run_id)?;
    if cs.control_version != 1 {
        return Err("AIH-24.5 rejected resume must not bump control_version".to_string());
    }
    Ok(())
}

// ── AIH-24.6: resume rejects a recalled snapshot source (no content leak) ────

/// A snapshot source whose origin is recalled rejects the resume; the
/// rejection reason names only the source id, never the title or content.
pub fn test_session_resume_rejects_recalled_source(ctx: &ReducerContext) -> Result<(), String> {
    let fx = seed_run_fixture(ctx, "aih24-6")?;
    let title = "AIH-24.6 Recalled Source";
    create_ai_source_version(
        ctx,
        fx.organization_id,
        source_params(title, "recalled", "hash-aih24-6"),
    )?;
    let source_id = ctx
        .db
        .ai_source_version()
        .iter()
        .find(|s| s.organization_id == fx.organization_id && s.title == title)
        .map(|s| s.id)
        .ok_or("AIH-24.6 source not found")?;
    let sources = format!("[{source_id}]");

    create_ai_continuation_manifest(
        ctx,
        fx.organization_id,
        manifest_params(
            fx.run_id,
            "[]",
            "[]",
            &sources,
            "[]",
            "[]",
            500,
            ctx.timestamp,
            Some("aih24-6".to_string()),
        ),
    )?;
    let manifest = manifest_by_summary(ctx, fx.organization_id, fx.run_id, "aih24-6")?;
    interrupt_run(ctx, fx.organization_id, fx.run_id, "int-aih24-6")?;

    resume_run(
        ctx,
        fx.organization_id,
        fx.run_id,
        "res-aih24-6",
        1,
        Some(manifest.id),
    )?;
    let intents = intents_for(ctx, fx.organization_id, "res-aih24-6");
    if intents.len() != 1 || intents[0].status != "rejected" {
        return Err("AIH-24.6 recalled source should reject the resume".to_string());
    }
    let reason = intents[0].reason.as_deref().unwrap_or_default();
    if !reason.contains("no longer available") {
        return Err(format!("AIH-24.6 unexpected rejection reason: {reason}"));
    }
    if reason.contains(title) {
        return Err("AIH-24.6 rejection reason must not expose source content".to_string());
    }
    assert_eq!(run_status(ctx, fx.run_id)?, "interrupted");
    Ok(())
}

// ── AIH-24.7: fork creates a new run and manifest with lineage ───────────────

/// A fork supersedes the parent manifest, creates an active fork manifest with
/// the supplied budget, creates a new pending run with lineage metadata and no
/// drafts/approvals, seeds its control state, and records the fork intent
/// under the parent run with the parent version bumped.
pub fn test_session_fork_creates_run_and_manifest(ctx: &ReducerContext) -> Result<(), String> {
    let fx = seed_run_fixture(ctx, "aih24-7")?;
    create_ai_continuation_manifest(
        ctx,
        fx.organization_id,
        manifest_params(
            fx.run_id,
            "[]",
            "[]",
            "[]",
            "[]",
            "[]",
            500,
            ctx.timestamp,
            Some("aih24-7-parent".to_string()),
        ),
    )?;
    let parent = manifest_by_summary(ctx, fx.organization_id, fx.run_id, "aih24-7-parent")?;

    request_ai_run_fork(
        ctx,
        fx.organization_id,
        RequestAiRunForkParams {
            run_id: fx.run_id,
            parent_manifest_id: parent.id,
            idempotency_key: "fork-aih24-7".to_string(),
            new_remaining_budget_tokens: 800,
            new_budget_reserved_until: ctx.timestamp,
            new_progress_state_json: r#"{"steps":0}"#.to_string(),
        },
    )?;

    // Parent manifest superseded; fork manifest active with the new budget.
    let parent_after = ctx
        .db
        .ai_continuation_manifest()
        .id()
        .find(&parent.id)
        .ok_or("AIH-24.7 parent manifest disappeared")?;
    if parent_after.status != "superseded_by_fork" {
        return Err("AIH-24.7 parent manifest should be superseded".to_string());
    }
    let fork_manifest = ctx
        .db
        .ai_continuation_manifest()
        .ai_continuation_manifest_by_run()
        .filter(&fx.run_id)
        .find(|m| m.parent_manifest_id == Some(parent.id))
        .ok_or("AIH-24.7 fork manifest not found")?;
    if fork_manifest.status != "active"
        || fork_manifest.revision != parent.revision + 1
        || fork_manifest.remaining_budget_tokens != 800
    {
        return Err(format!(
            "AIH-24.7 unexpected fork manifest: status={} revision={} budget={}",
            fork_manifest.status, fork_manifest.revision, fork_manifest.remaining_budget_tokens
        ));
    }

    // New run: parked pending, no drafts, lineage metadata.
    let fork_run_key = format!("{}-fork-fork-aih24-7", fx.run_key);
    let fork_run = ctx
        .db
        .ai_agent_run()
        .ai_agent_run_by_run_key()
        .filter(&fork_run_key)
        .next()
        .ok_or("AIH-24.7 fork run not found")?;
    if fork_run.status != "pending" {
        return Err(format!(
            "AIH-24.7 fork run should be pending, got {}",
            fork_run.status
        ));
    }
    if !fork_run.action_draft_ids.is_empty() {
        return Err("AIH-24.7 fork run must not inherit action drafts".to_string());
    }
    let metadata: serde_json::Value =
        serde_json::from_str(fork_run.metadata.as_deref().unwrap_or("{}"))
            .map_err(|e| format!("AIH-24.7 invalid fork run metadata: {e}"))?;
    if metadata["parent_run_id"] != serde_json::json!(fx.run_id)
        || metadata["parent_manifest_id"] != serde_json::json!(parent.id)
        || metadata["fork_manifest_id"] != serde_json::json!(fork_manifest.id)
        || metadata["forked_by"] != serde_json::json!(ctx.sender().to_hex().to_string())
    {
        return Err(format!("AIH-24.7 unexpected fork run metadata: {metadata}"));
    }

    // Fresh control state for the new run.
    let fork_cs = control_state_for(ctx, fx.organization_id, fork_run.id)?;
    if fork_cs.control_version != 0 || fork_cs.phase != "active" {
        return Err("AIH-24.7 fork run should get a fresh control state".to_string());
    }

    // Fork intent recorded under the PARENT run with lineage result.
    let intents = intents_for(ctx, fx.organization_id, "fork-aih24-7");
    if intents.len() != 1 || intents[0].status != "applied" {
        return Err("AIH-24.7 fork intent should be applied once".to_string());
    }
    if intents[0].run_id != fx.run_id {
        return Err("AIH-24.7 fork intent must be recorded under the parent run".to_string());
    }
    let result = parse_result(&intents[0])?;
    if result["parent_run_id"] != serde_json::json!(fx.run_id)
        || result["parent_manifest_id"] != serde_json::json!(parent.id)
        || result["fork_run_id"] != serde_json::json!(fork_run.id)
        || result["fork_manifest_id"] != serde_json::json!(fork_manifest.id)
        || result["revision"] != serde_json::json!(fork_manifest.revision)
        || result["erp_state_rolled_back"] != serde_json::json!(false)
    {
        return Err(format!("AIH-24.7 unexpected fork result: {result}"));
    }
    let cs = control_state_for(ctx, fx.organization_id, fx.run_id)?;
    if cs.control_version != 1 {
        return Err("AIH-24.7 fork should bump the parent control_version".to_string());
    }
    Ok(())
}

// ── AIH-24.8: compare records the manifest diff ──────────────────────────────

/// Compare records decision/question/source/candidate/effect differences with
/// `erp_state_rolled_back: false`, and a superseded baseline (parent-vs-fork)
/// remains comparable.
pub fn test_session_compare_records_manifest_diff(ctx: &ReducerContext) -> Result<(), String> {
    let fx = seed_run_fixture(ctx, "aih24-8")?;
    let org = fx.organization_id;

    create_ai_decision(
        ctx,
        org,
        CreateAiDecisionParams {
            company_id: None,
            claim_id: None,
            supporting_claims_json: None,
            supporting_sources_json: None,
            applicability: None,
            alternatives_json: None,
            adaptations_json: None,
            rationale: "AIH-24.8 baseline decision".to_string(),
            status: "approved".to_string(),
            reviewer_identity: None,
        },
    )?;
    let decision_id = ctx
        .db
        .ai_decision()
        .iter()
        .find(|d| d.organization_id == org && d.rationale == "AIH-24.8 baseline decision")
        .map(|d| d.id)
        .ok_or("AIH-24.8 decision not found")?;

    create_ai_question(ctx, org, question_params(fx.run_id, "aih24-8-q"))?;
    let question_id = question_id_by_key(ctx, org, "aih24-8-q")?;

    create_ai_source_version(
        ctx,
        org,
        source_params("AIH-24.8 Source 1", "retrieved", "hash-aih24-8-1"),
    )?;
    let source_1 = ctx
        .db
        .ai_source_version()
        .iter()
        .find(|s| s.organization_id == org && s.title == "AIH-24.8 Source 1")
        .map(|s| s.id)
        .ok_or("AIH-24.8 source 1 not found")?;
    create_ai_source_version(
        ctx,
        org,
        source_params("AIH-24.8 Source 2", "retrieved", "hash-aih24-8-2"),
    )?;
    let source_2 = ctx
        .db
        .ai_source_version()
        .iter()
        .find(|s| s.organization_id == org && s.title == "AIH-24.8 Source 2")
        .map(|s| s.id)
        .ok_or("AIH-24.8 source 2 not found")?;

    create_ai_continuation_manifest(
        ctx,
        org,
        manifest_params(
            fx.run_id,
            &format!("[{decision_id}]"),
            "[]",
            &format!("[{source_1}]"),
            r#"[{"component_id":1,"version":1,"hash":"h1"}]"#,
            r#"[{"tool":"lookup","input_hash":"i1","output_hash":"o1"}]"#,
            500,
            ctx.timestamp,
            Some("aih24-8-baseline".to_string()),
        ),
    )?;
    let baseline = manifest_by_summary(ctx, org, fx.run_id, "aih24-8-baseline")?;

    create_ai_continuation_manifest(
        ctx,
        org,
        manifest_params(
            fx.run_id,
            "[]",
            &format!("[{question_id}]"),
            &format!("[{source_1},{source_2}]"),
            r#"[{"component_id":1,"version":2,"hash":"h2"},{"component_id":2,"version":1,"hash":"h3"}]"#,
            r#"[{"tool":"lookup","input_hash":"i1","output_hash":"o1"},{"tool":"write","input_hash":"i2","output_hash":"o2"}]"#,
            600,
            ctx.timestamp,
            Some("aih24-8-candidate".to_string()),
        ),
    )?;
    let candidate = manifest_by_summary(ctx, org, fx.run_id, "aih24-8-candidate")?;

    request_ai_run_compare(
        ctx,
        org,
        RequestAiRunCompareParams {
            run_id: fx.run_id,
            baseline_manifest_id: baseline.id,
            candidate_manifest_id: candidate.id,
            idempotency_key: "cmp-aih24-8".to_string(),
        },
    )?;
    let intents = intents_for(ctx, org, "cmp-aih24-8");
    if intents.len() != 1 || intents[0].status != "applied" {
        return Err("AIH-24.8 compare intent should be applied".to_string());
    }
    let result = parse_result(&intents[0])?;
    if result["objective_same"] != serde_json::json!(true)
        || result["constraints_same"] != serde_json::json!(true)
    {
        return Err("AIH-24.8 objective/constraints should match".to_string());
    }
    if result["decisions_added"] != serde_json::json!([])
        || result["decisions_removed"] != serde_json::json!([decision_id])
    {
        return Err(format!(
            "AIH-24.8 unexpected decisions diff: {} / {}",
            result["decisions_added"], result["decisions_removed"]
        ));
    }
    if result["questions_opened"] != serde_json::json!([question_id])
        || result["questions_resolved"] != serde_json::json!([])
    {
        return Err(format!(
            "AIH-24.8 unexpected questions diff: {} / {}",
            result["questions_opened"], result["questions_resolved"]
        ));
    }
    if result["sources_added"] != serde_json::json!([source_2])
        || result["sources_removed"] != serde_json::json!([])
    {
        return Err(format!(
            "AIH-24.8 unexpected sources diff: {} / {}",
            result["sources_added"], result["sources_removed"]
        ));
    }
    let changed = result["candidates_changed"]
        .as_array()
        .ok_or("AIH-24.8 candidates_changed should be an array")?;
    if changed.len() != 2
        || !changed.contains(&serde_json::json!({
            "component_id": 1,
            "baseline_version": 1,
            "candidate_version": 2,
        }))
        || !changed.contains(&serde_json::json!({
            "component_id": 2,
            "baseline_version": 0,
            "candidate_version": 1,
        }))
    {
        return Err(format!("AIH-24.8 unexpected candidates diff: {changed:?}"));
    }
    if result["baseline_completed_effects"] != serde_json::json!(1)
        || result["candidate_completed_effects"] != serde_json::json!(2)
    {
        return Err("AIH-24.8 unexpected completed-effects counts".to_string());
    }
    if result["erp_state_rolled_back"] != serde_json::json!(false) {
        return Err("AIH-24.8 comparison must never roll back ERP state".to_string());
    }
    let note = result["note"].as_str().unwrap_or_default();
    if !note.contains("never reverses posted ERP state") {
        return Err("AIH-24.8 comparison note is missing".to_string());
    }

    // Compare mutates no run/manifest state (control version stays 0 —
    // observation intents never advance the version).
    assert_eq!(run_status(ctx, fx.run_id)?, "running");
    let cs = control_state_for(ctx, org, fx.run_id)?;
    if cs.control_version != 0 {
        return Err("AIH-24.8 compare must not bump control_version".to_string());
    }

    // Parent-vs-fork use case: superseded baseline remains comparable.
    request_ai_run_fork(
        ctx,
        org,
        RequestAiRunForkParams {
            run_id: fx.run_id,
            parent_manifest_id: baseline.id,
            idempotency_key: "fork-aih24-8".to_string(),
            new_remaining_budget_tokens: 400,
            new_budget_reserved_until: ctx.timestamp,
            new_progress_state_json: r#"{"steps":0}"#.to_string(),
        },
    )?;
    let fork_manifest = ctx
        .db
        .ai_continuation_manifest()
        .ai_continuation_manifest_by_run()
        .filter(&fx.run_id)
        .find(|m| m.parent_manifest_id == Some(baseline.id))
        .ok_or("AIH-24.8 fork manifest not found")?;
    request_ai_run_compare(
        ctx,
        org,
        RequestAiRunCompareParams {
            run_id: fx.run_id,
            baseline_manifest_id: baseline.id,
            candidate_manifest_id: fork_manifest.id,
            idempotency_key: "cmp-aih24-8b".to_string(),
        },
    )?;
    let intents = intents_for(ctx, org, "cmp-aih24-8b");
    if intents.len() != 1 || intents[0].status != "applied" {
        return Err("AIH-24.8 superseded baseline should remain comparable".to_string());
    }
    let result = parse_result(&intents[0])?;
    if result["objective_same"] != serde_json::json!(true) {
        return Err("AIH-24.8 fork should preserve the objective hash".to_string());
    }
    Ok(())
}

// ── AIH-24.9: event cursors coexist, advance, and never go backwards ────────

/// Two client keys coexist per run, advances apply, and a decreasing
/// last_step_id is rejected.
pub fn test_session_event_cursor_upsert_and_monotonic(ctx: &ReducerContext) -> Result<(), String> {
    let fx = seed_run_fixture(ctx, "aih24-9")?;

    record_ai_run_event_cursor(
        ctx,
        fx.organization_id,
        fx.run_id,
        "client-a".to_string(),
        10,
    )?;
    record_ai_run_event_cursor(
        ctx,
        fx.organization_id,
        fx.run_id,
        "client-b".to_string(),
        5,
    )?;
    let cursors: Vec<_> = ctx
        .db
        .ai_run_event_cursor()
        .ai_run_event_cursor_by_run()
        .filter(&fx.run_id)
        .collect();
    if cursors.len() != 2 {
        return Err("AIH-24.9 two client keys should coexist".to_string());
    }

    record_ai_run_event_cursor(
        ctx,
        fx.organization_id,
        fx.run_id,
        "client-a".to_string(),
        11,
    )?;
    let cursor_a = ctx
        .db
        .ai_run_event_cursor()
        .ai_run_event_cursor_by_run()
        .filter(&fx.run_id)
        .find(|c| c.client_key == "client-a")
        .ok_or("AIH-24.9 cursor A not found")?;
    if cursor_a.last_step_id != 11 {
        return Err("AIH-24.9 cursor advance should apply".to_string());
    }

    let err = record_ai_run_event_cursor(
        ctx,
        fx.organization_id,
        fx.run_id,
        "client-a".to_string(),
        9,
    );
    match err {
        Err(ref e) if e.contains("must not go backwards") => {}
        other => {
            return Err(format!(
                "AIH-24.9 decreasing cursor should reject, got {other:?}"
            ))
        }
    }
    let cursor_a = ctx
        .db
        .ai_run_event_cursor()
        .ai_run_event_cursor_by_run()
        .filter(&fx.run_id)
        .find(|c| c.client_key == "client-a")
        .ok_or("AIH-24.9 cursor A not found after rejection")?;
    if cursor_a.last_step_id != 11 {
        return Err("AIH-24.9 rejected decrease must not change the cursor".to_string());
    }
    Ok(())
}

// ── AIH-24.10: inspect reports run/control state, questions, steps ──────────

/// Inspect result_json carries the run status, control phase/version, open
/// questions and step bookkeeping.
pub fn test_session_inspect_reports_run_state(ctx: &ReducerContext) -> Result<(), String> {
    let fx = seed_run_fixture(ctx, "aih24-10")?;

    append_ai_agent_run_step(
        ctx,
        fx.organization_id,
        fx.company_id,
        fx.run_id,
        AppendAiAgentRunStepParams {
            step_no: 1,
            tool_name: "lookup".to_string(),
            input_hash: "hash-step-1".to_string(),
            output_summary: "looked up 3 rows".to_string(),
            output_row_count: Some(3),
            citations_json: None,
            duration_ms: 12,
            error_message: None,
        },
    )?;
    let step_id = ctx
        .db
        .ai_agent_run_step()
        .ai_agent_run_step_by_run()
        .filter(&fx.run_id)
        .next()
        .map(|s| s.id)
        .ok_or("AIH-24.10 step not found")?;
    create_ai_question(
        ctx,
        fx.organization_id,
        question_params(fx.run_id, "aih24-10-q"),
    )?;

    request_ai_run_inspect(
        ctx,
        fx.organization_id,
        fx.run_id,
        "ins-aih24-10".to_string(),
    )?;
    let intents = intents_for(ctx, fx.organization_id, "ins-aih24-10");
    if intents.len() != 1 || intents[0].status != "applied" {
        return Err("AIH-24.10 inspect intent should be applied".to_string());
    }
    let result = parse_result(&intents[0])?;
    if result["run_id"] != serde_json::json!(fx.run_id)
        || result["run_status"] != serde_json::json!("running")
        || result["control_phase"] != serde_json::json!("active")
        || result["control_version"] != serde_json::json!(0)
    {
        return Err(format!("AIH-24.10 unexpected inspect header: {}", result));
    }
    if result["step_count"] != serde_json::json!(1)
        || result["last_step_id"] != serde_json::json!(step_id)
    {
        return Err("AIH-24.10 unexpected step bookkeeping".to_string());
    }
    let open = result["open_questions"]
        .as_array()
        .ok_or("AIH-24.10 open_questions should be an array")?;
    if open.len() != 1
        || open[0]["question_key"] != serde_json::json!("aih24-10-q")
        || open[0]["kind"] != serde_json::json!("required")
    {
        return Err(format!("AIH-24.10 unexpected open questions: {open:?}"));
    }

    // Inspect lazily created the control state without advancing it.
    let cs = control_state_for(ctx, fx.organization_id, fx.run_id)?;
    if cs.control_version != 0 || cs.phase != "active" {
        return Err("AIH-24.10 inspect must not advance the control state".to_string());
    }
    Ok(())
}
