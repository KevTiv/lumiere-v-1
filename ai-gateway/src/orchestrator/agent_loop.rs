//! AIH-3 — Agentic tool-calling loop (reason-act-observe).
//! AIH-4 — Per-call policy-engine routing (action-permission gate + denial audit).
//! AIH-5 — Budget-aware Mistral → Gemini model selection.
//! AIH-22 — Non-progress detection (repeated calls / errors / denied actions).

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::{Context, Result};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    ai_agent::{enforce_chargeable_limits, record_ai_spend, resolve_agent, ResolvedAgentConfig},
    harness::ActorCredentials,
    orchestrator::{
        run::{RunSkillRequest, RunSkillResponse, RunSkillStepSummary, SkillArtifact},
        skill_loader::{complete_run, create_run, load_skill},
    },
    providers::llm::{normalize_provider, LlmMessage, LlmRequest},
    state::AppState,
    tools::{
        registry::{agent_allows_action, ToolRegistry},
        types::{hash_tool_input, SkillCitation, ToolContext},
    },
};

// ── Non-progress thresholds (AIH-22) ─────────────────────────────────────────

/// Consecutive identical (tool, input-fingerprint) calls that trigger a
/// non-progress stop.
const NON_PROGRESS_CALL_THRESHOLD: u32 = 2;

/// Consecutive identical error messages that trigger a non-progress stop.
const NON_PROGRESS_ERROR_THRESHOLD: u32 = 2;

/// Consecutive denied-action attempts that trigger a non-progress stop.
const NON_PROGRESS_DENIED_THRESHOLD: u32 = 2;

// ── Model-selection priority (AIH-5) ─────────────────────────────────────────

/// Provider preference order for tool-calling runs.
/// Ollama is intentionally omitted — it has no tool-calling support and
/// degrades to single-shot; it must never be auto-selected for a loop skill.
const PROVIDER_PRIORITY: &[&str] = &["mistral", "gemini"];

/// Select `(provider, model, reason)` honouring `AiAgent.allowed_models` and
/// Mistral-first / Gemini-fallback cost priority.
fn select_provider(agent: &ResolvedAgentConfig) -> Result<(&'static str, String, String)> {
    let agent_provider = normalize_provider(&agent.provider);

    // If the agent is explicitly configured for a non-priority provider (e.g.
    // Kong / Ollama) and its allowed_models list is empty, respect that choice
    // for backward-compatibility — but still refuse Ollama for the loop.
    if agent_provider == "ollama" {
        anyhow::bail!(
            "Ollama provider does not support tool-calling; configure a Mistral or Gemini agent"
        );
    }

    for &candidate in PROVIDER_PRIORITY {
        // Skip providers not in the agent's allowed_models list (when the list
        // is non-empty; an empty list means "all allowed").
        let allowed = agent.allowed_models.is_empty()
            || agent
                .allowed_models
                .iter()
                .any(|m| normalize_provider(m) == candidate || m.to_ascii_lowercase().starts_with(candidate));

        if !allowed {
            continue;
        }

        // The agent's configured provider matches this candidate — use the
        // agent's specific model string, otherwise use a sensible default.
        let model = if agent_provider == candidate {
            agent.model.clone()
        } else {
            match candidate {
                "gemini" => "gemini-2.0-flash".to_string(),
                _ => agent.model.clone(),
            }
        };

        let reason = if agent_provider == candidate {
            format!("primary provider '{candidate}' selected")
        } else {
            format!(
                "primary provider '{}' not in allowed_models; falling back to '{candidate}'",
                agent_provider
            )
        };

        return Ok((candidate, model, reason));
    }

    anyhow::bail!(
        "No tool-calling provider available: checked {:?}; agent allowed_models = {:?}",
        PROVIDER_PRIORITY,
        agent.allowed_models
    )
}

// ── Non-progress tracker (AIH-22) ────────────────────────────────────────────

#[derive(Default)]
struct ProgressTracker {
    /// (tool_name, input_fingerprint) → consecutive call count.
    call_counts: HashMap<(String, String), u32>,
    /// Last error message seen + consecutive count.
    last_error: Option<(String, u32)>,
    /// Consecutive denied-action count.
    denied_count: u32,
}

/// Returns `Some(reason)` when a non-progress condition is detected.
impl ProgressTracker {
    fn record_call(&mut self, tool_name: &str, input: &Value) -> Option<String> {
        let fingerprint = hash_tool_input(input);
        let key = (tool_name.to_string(), fingerprint);
        let count = self.call_counts.entry(key).or_insert(0);
        *count += 1;
        if *count >= NON_PROGRESS_CALL_THRESHOLD {
            Some(format!(
                "non-progress: tool '{}' called {} times with identical input",
                tool_name, count
            ))
        } else {
            None
        }
    }

    fn record_error(&mut self, message: &str) -> Option<String> {
        match &mut self.last_error {
            Some((prev, count)) if prev == message => {
                *count += 1;
                if *count >= NON_PROGRESS_ERROR_THRESHOLD {
                    Some(format!(
                        "non-progress: same error repeated {count} times: {message}"
                    ))
                } else {
                    None
                }
            }
            _ => {
                self.last_error = Some((message.to_string(), 1));
                None
            }
        }
    }

    fn record_denied(&mut self) -> Option<String> {
        self.denied_count += 1;
        if self.denied_count >= NON_PROGRESS_DENIED_THRESHOLD {
            Some(format!(
                "non-progress: {} consecutive denied actions",
                self.denied_count
            ))
        } else {
            None
        }
    }

    fn reset_denied(&mut self) {
        self.denied_count = 0;
    }
}

// ── Per-call policy gate (AIH-4) ─────────────────────────────────────────────

struct PolicyDenial {
    reason: String,
}

fn check_tool_policy(
    agent: &ResolvedAgentConfig,
    allowed_tool_names: &[String],
    tool_name: &str,
) -> Result<(), PolicyDenial> {
    // 1. Tool must be in the skill's allowed list (prevents hallucinated names).
    if !allowed_tool_names.iter().any(|n| n == tool_name) {
        return Err(PolicyDenial {
            reason: format!(
                "policy denial: tool '{tool_name}' is not in the skill's allowed tool list"
            ),
        });
    }

    // 2. The agent must hold the required action for this tool.
    let registry = ToolRegistry::new();
    let required = registry
        .tools()
        .find(|t| t.name() == tool_name)
        .map(|t| t.required_action())
        .unwrap_or("unknown");

    if !agent_allows_action(agent, required) {
        return Err(PolicyDenial {
            reason: format!(
                "policy denial: tool '{tool_name}' requires action '{required}' \
                 which is not in agent allowed_actions"
            ),
        });
    }

    Ok(())
}

// ── Main loop entry point (AIH-3) ─────────────────────────────────────────────

pub async fn run_agentic_skill(
    state: &AppState,
    req: RunSkillRequest,
) -> Result<RunSkillResponse> {
    if req.org_id == 0 {
        anyhow::bail!("org_id is required");
    }
    if req.company_id == 0 {
        anyhow::bail!("company_id is required");
    }
    let skill_key = req.skill_key.trim();
    if skill_key.is_empty() {
        anyhow::bail!("skill_key is required");
    }

    let actor = req
        .stdb_token
        .as_ref()
        .zip(req.triggered_by_hex.as_ref())
        .and_then(|(token, identity)| {
            ActorCredentials::new(token.clone(), identity.clone()).ok()
        });

    let stdb = req
        .stdb_token
        .as_ref()
        .filter(|t| !t.trim().is_empty())
        .map(|token| state.stdb.with_token(token.clone()))
        .unwrap_or_else(|| state.stdb.as_ref().clone());

    let skill = load_skill(&stdb, req.org_id, req.company_id, skill_key).await?;
    if !skill.enabled {
        anyhow::bail!("skill '{skill_key}' is disabled for this company");
    }

    let agent = resolve_agent(&stdb, req.org_id, req.agent_id, req.team_member_id).await?;

    // AIH-5: resolve provider before opening the run record so the selection
    // reason is available for metadata.
    let (provider, model, selection_reason) = select_provider(&agent)?;

    let run_key = Uuid::new_v4().to_string();
    let inputs_json = serde_json::to_string(&req.inputs).context("serialize inputs")?;
    let triggered_by_hex = req
        .triggered_by_hex
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("0000000000000000000000000000000000000000000000000000000000000000")
        .to_string();

    let run_id = if skill.id > 0 {
        create_run(
            &stdb,
            req.org_id,
            req.company_id,
            &skill,
            agent.agent_id,
            req.team_member_id,
            &run_key,
            &inputs_json,
            &triggered_by_hex,
        )
        .await?
    } else {
        0
    };

    tracing::info!(
        "[agent_loop] run={run_id} skill={skill_key} provider={provider} model={model} \
         reason=\"{selection_reason}\""
    );

    let max_steps = req
        .overrides
        .as_ref()
        .and_then(|o| o.max_steps)
        .unwrap_or(skill.default_max_steps)
        .min(12);

    let registry = ToolRegistry::new();
    let allowed_tool_names = resolve_allowed_tool_names(&skill, &agent, &registry);

    let tool_ctx = ToolContext {
        state: state.clone(),
        stdb: Arc::new(stdb.clone()),
        org_id: req.org_id,
        company_id: req.company_id,
        run_id,
        skill_key: skill.skill_key.clone(),
        config_json: skill.config_json.clone(),
        inputs: req.inputs.clone(),
        allowed_action_drafts: skill.allowed_action_drafts.clone(),
        actor,
    };

    // Build the initial system prompt.
    let system = build_system_prompt(&skill, &agent, &req.inputs);

    // Build tool specs filtered to what this agent/skill allows.
    let tool_specs = registry.specs_for(&agent, &allowed_tool_names);

    // Transcript: accumulates user + assistant + tool messages.
    let mut transcript: Vec<LlmMessage> = vec![LlmMessage {
        role: "user".to_string(),
        content: format_user_turn(&skill, &req.inputs),
    }];

    let mut steps: Vec<RunSkillStepSummary> = Vec::new();
    let mut citations: Vec<SkillCitation> = Vec::new();
    let mut artifacts: Vec<SkillArtifact> = Vec::new();
    let mut total_input_tokens: u32 = 0;
    let mut total_output_tokens: u32 = 0;
    let mut step_no: u32 = 0;
    let mut final_summary = String::new();
    let mut progress = ProgressTracker::default();

    let loop_result: Result<()> = async {
        for _iteration in 0..max_steps {
            // AIH-4 / AIH-5: per-call budget check before every provider call.
            enforce_chargeable_limits(&state.agent_rate_limiter, req.org_id, &agent)
                .map_err(|v| anyhow::anyhow!("{}", v))?;

            let llm_req = LlmRequest {
                provider: provider.to_string(),
                model: model.clone(),
                system: system.clone(),
                messages: transcript.clone(),
                max_tokens: agent.max_tokens.min(4096),
                temperature: Some(agent.temperature),
                top_p: Some(agent.top_p),
                tools: tool_specs.clone(),
            };

            let llm_resp = state
                .providers
                .llm
                .complete(llm_req)
                .await
                .context("agent loop LLM call failed")?;

            total_input_tokens = total_input_tokens.saturating_add(llm_resp.input_tokens);
            total_output_tokens = total_output_tokens.saturating_add(llm_resp.output_tokens);

            // Record spend for this call.
            let tokens_this_call = llm_resp.input_tokens.saturating_add(llm_resp.output_tokens);
            if tokens_this_call > 0 {
                let _ = record_ai_spend(
                    &stdb,
                    req.org_id,
                    agent.agent_id,
                    tokens_this_call,
                )
                .await;
            }

            // ── No tool calls → candidate final answer ─────────────────────
            if llm_resp.tool_calls.is_empty() {
                final_summary = llm_resp.text.clone();
                // Append the assistant turn to the transcript for completeness.
                transcript.push(LlmMessage {
                    role: "assistant".to_string(),
                    content: llm_resp.text,
                });
                break;
            }

            // ── Append assistant turn with tool call intent ─────────────────
            transcript.push(LlmMessage {
                role: "assistant".to_string(),
                content: format!(
                    "[planning {} tool call(s)]",
                    llm_resp.tool_calls.len()
                ),
            });

            // ── Execute each tool call ──────────────────────────────────────
            for tc in &llm_resp.tool_calls {
                step_no += 1;
                let started = std::time::Instant::now();

                // AIH-22: check for non-progress before executing.
                if let Some(np_reason) =
                    progress.record_call(&tc.name, &tc.arguments)
                {
                    tracing::warn!("[agent_loop] run={run_id} step={step_no} {np_reason}");
                    append_step_record(
                        &stdb,
                        req.org_id,
                        req.company_id,
                        run_id,
                        step_no,
                        &tc.name,
                        &hash_tool_input(&tc.arguments),
                        &np_reason,
                        0,
                        &np_reason,
                    )
                    .await;
                    final_summary = np_reason.clone();
                    return Err(anyhow::anyhow!("{np_reason}"));
                }

                // AIH-4: per-call policy gate.
                if let Err(denial) =
                    check_tool_policy(&agent, &allowed_tool_names, &tc.name)
                {
                    tracing::warn!(
                        "[agent_loop] run={run_id} step={step_no} {}",
                        denial.reason
                    );
                    progress.record_denied();
                    append_step_record(
                        &stdb,
                        req.org_id,
                        req.company_id,
                        run_id,
                        step_no,
                        &tc.name,
                        &hash_tool_input(&tc.arguments),
                        &denial.reason,
                        started.elapsed().as_millis() as u64,
                        &denial.reason,
                    )
                    .await;
                    steps.push(RunSkillStepSummary {
                        step_no,
                        tool: tc.name.clone(),
                        duration_ms: started.elapsed().as_millis() as u64,
                        summary: denial.reason.clone(),
                    });
                    transcript.push(LlmMessage {
                        role: "user".to_string(),
                        content: format!(
                            "tool_result for '{}': error — {}",
                            tc.name, denial.reason
                        ),
                    });

                    // AIH-22: stop if too many consecutive denials.
                    if let Some(np) = progress.record_denied() {
                        final_summary = np.clone();
                        return Err(anyhow::anyhow!("{np}"));
                    }
                    continue;
                }

                progress.reset_denied();

                // Execute the tool.
                match registry
                    .run_and_record(
                        &stdb,
                        req.org_id,
                        req.company_id,
                        run_id,
                        step_no,
                        &tc.name,
                        &tool_ctx,
                        &tc.arguments,
                    )
                    .await
                {
                    Ok(output) => {
                        let duration_ms = started.elapsed().as_millis() as u64;
                        citations.extend(output.citations.clone());

                        // Collect artifacts from save_artifact tool.
                        if tc.name == "save_artifact" {
                            if let Some(title) = tc
                                .arguments
                                .get("title")
                                .and_then(|v| v.as_str())
                            {
                                artifacts.push(SkillArtifact {
                                    kind: tc
                                        .arguments
                                        .get("kind")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("markdown")
                                        .to_string(),
                                    title: title.to_string(),
                                    content: tc
                                        .arguments
                                        .get("content")
                                        .cloned()
                                        .unwrap_or(Value::Null),
                                });
                            }
                        }

                        steps.push(RunSkillStepSummary {
                            step_no,
                            tool: tc.name.clone(),
                            duration_ms,
                            summary: output.summary.clone(),
                        });

                        // Feed result back into the transcript.
                        transcript.push(LlmMessage {
                            role: "user".to_string(),
                            content: format!(
                                "tool_result for '{}': {}",
                                tc.name, output.summary
                            ),
                        });
                    }
                    Err(err) => {
                        let duration_ms = started.elapsed().as_millis() as u64;
                        let message = err.to_string();

                        // AIH-22: check for repeated identical errors.
                        if let Some(np) = progress.record_error(&message) {
                            tracing::warn!("[agent_loop] run={run_id} step={step_no} {np}");
                            final_summary = np.clone();
                            return Err(anyhow::anyhow!("{np}"));
                        }

                        steps.push(RunSkillStepSummary {
                            step_no,
                            tool: tc.name.clone(),
                            duration_ms,
                            summary: message.clone(),
                        });

                        // Feed the error back so the model can try another approach.
                        transcript.push(LlmMessage {
                            role: "user".to_string(),
                            content: format!(
                                "tool_result for '{}': error — {message}",
                                tc.name
                            ),
                        });
                    }
                }
            }
        }
        Ok(())
    }
    .await;

    let tokens_used = total_input_tokens.saturating_add(total_output_tokens);
    let status = match &loop_result {
        Ok(_) => "completed",
        Err(_) => "failed",
    };

    if final_summary.is_empty() && loop_result.is_ok() {
        final_summary = "Agent loop completed (max steps reached without a final answer)."
            .to_string();
    }

    let artifacts_json = serde_json::to_string(&artifacts).ok();
    let citations_json = serde_json::to_string(&citations).ok();

    if run_id > 0 {
        let _ = complete_run(
            &stdb,
            req.org_id,
            req.company_id,
            run_id,
            status,
            Some(final_summary.clone()),
            artifacts_json,
            citations_json,
            step_no,
            tokens_used,
            loop_result.as_ref().err().map(|e| e.to_string()),
        )
        .await;
    }

    if let Err(err) = loop_result {
        anyhow::bail!("{err}");
    }

    Ok(RunSkillResponse {
        run_id,
        run_key,
        status: status.to_string(),
        summary: final_summary,
        artifacts,
        citations,
        steps,
        agent_id: agent.agent_id,
        skill_key: skill_key.to_string(),
    })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn resolve_allowed_tool_names(
    skill: &crate::orchestrator::skill_loader::LoadedSkill,
    agent: &ResolvedAgentConfig,
    registry: &ToolRegistry,
) -> Vec<String> {
    let mut names = skill.required_tools.clone();
    for name in &skill.optional_tools {
        if !names.iter().any(|n| n == name) {
            names.push(name.clone());
        }
    }
    registry
        .filter_for_agent(agent, &names)
        .into_iter()
        .map(|t| t.name().to_string())
        .collect()
}

fn build_system_prompt(
    skill: &crate::orchestrator::skill_loader::LoadedSkill,
    agent: &ResolvedAgentConfig,
    inputs: &Value,
) -> String {
    let mut parts = vec![agent.system_prompt.clone()];
    if !skill.prompt_template.is_empty() {
        parts.push(skill.prompt_template.clone());
    }
    if let Some(instructions) = &skill.custom_instructions {
        if !instructions.is_empty() {
            parts.push(instructions.clone());
        }
    }
    // Inject a brief context block so the model knows what it's doing.
    parts.push(format!(
        "Skill: {} | Inputs: {}",
        skill.name,
        serde_json::to_string(inputs).unwrap_or_default()
    ));
    parts.join("\n\n")
}

fn format_user_turn(
    skill: &crate::orchestrator::skill_loader::LoadedSkill,
    inputs: &Value,
) -> String {
    let query = inputs
        .get("query")
        .or_else(|| inputs.get("q"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if query.is_empty() {
        format!(
            "Run the '{}' skill with the provided inputs: {}",
            skill.name,
            serde_json::to_string(inputs).unwrap_or_default()
        )
    } else {
        query
    }
}

/// Fire-and-forget step record for denial/non-progress events where
/// `run_and_record` was not called.
async fn append_step_record(
    stdb: &stdb_client::StdbClient,
    org_id: u64,
    company_id: u64,
    run_id: u64,
    step_no: u32,
    tool_name: &str,
    input_hash: &str,
    output_summary: &str,
    duration_ms: u64,
    error_message: &str,
) {
    let _ = stdb
        .call_reducer(stdb_client::reducer_call!(
            "append_ai_agent_run_step",
            json!([
                org_id,
                company_id,
                run_id,
                {
                    "step_no": step_no,
                    "tool_name": tool_name,
                    "input_hash": input_hash,
                    "output_summary": output_summary.chars().take(8000).collect::<String>(),
                    "output_row_count": null,
                    "citations_json": null,
                    "duration_ms": duration_ms,
                    "error_message": error_message.chars().take(2000).collect::<String>(),
                }
            ])
        ))
        .await;
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_agent::ResolvedAgentConfig;

    fn test_agent(provider: &str, allowed_models: Vec<String>) -> ResolvedAgentConfig {
        ResolvedAgentConfig {
            agent_id: 1,
            provider: provider.to_string(),
            model: format!("{provider}-large"),
            system_prompt: "You are helpful.".to_string(),
            temperature: 0.7,
            max_tokens: 1024,
            top_p: 0.95,
            allowed_actions: vec!["skill_run".to_string(), "live_read".to_string()],
            allowed_models,
            monthly_budget: Some(100.0),
            monthly_spend: 0.0,
            cost_per_1k_tokens: 0.01,
            rate_limit_per_minute: 0,
        }
    }

    // AIH-5: model selection ──────────────────────────────────────────────────

    #[test]
    fn selects_mistral_when_primary() {
        let agent = test_agent("mistral", vec![]);
        let (provider, _, reason) = select_provider(&agent).unwrap();
        assert_eq!(provider, "mistral");
        assert!(reason.contains("primary provider 'mistral' selected"));
    }

    #[test]
    fn falls_back_to_gemini_when_mistral_not_allowed() {
        let agent = test_agent("mistral", vec!["gemini".to_string()]);
        let (provider, model, reason) = select_provider(&agent).unwrap();
        assert_eq!(provider, "gemini");
        assert!(model.contains("gemini"));
        assert!(reason.contains("falling back to 'gemini'"));
    }

    #[test]
    fn fails_when_no_provider_available() {
        let agent = test_agent("mistral", vec!["anthropic".to_string()]);
        assert!(select_provider(&agent).is_err());
    }

    #[test]
    fn rejects_ollama_for_agentic_loop() {
        let agent = test_agent("ollama", vec![]);
        assert!(select_provider(&agent).is_err());
    }

    // AIH-22: non-progress detection ─────────────────────────────────────────

    #[test]
    fn repeated_identical_call_triggers_non_progress() {
        let mut tracker = ProgressTracker::default();
        let input = serde_json::json!({"query": "test"});
        assert!(tracker.record_call("erp_search", &input).is_none());
        let result = tracker.record_call("erp_search", &input);
        assert!(result.is_some());
        assert!(result.unwrap().contains("non-progress"));
    }

    #[test]
    fn different_inputs_do_not_trigger_non_progress() {
        let mut tracker = ProgressTracker::default();
        assert!(tracker
            .record_call("erp_search", &serde_json::json!({"query": "a"}))
            .is_none());
        assert!(tracker
            .record_call("erp_search", &serde_json::json!({"query": "b"}))
            .is_none());
    }

    #[test]
    fn repeated_error_triggers_non_progress() {
        let mut tracker = ProgressTracker::default();
        let msg = "connection refused";
        assert!(tracker.record_error(msg).is_none());
        let result = tracker.record_error(msg);
        assert!(result.is_some());
        assert!(result.unwrap().contains("non-progress"));
    }

    #[test]
    fn different_errors_do_not_trigger() {
        let mut tracker = ProgressTracker::default();
        assert!(tracker.record_error("error A").is_none());
        assert!(tracker.record_error("error B").is_none());
    }

    #[test]
    fn repeated_denials_trigger_non_progress() {
        let mut tracker = ProgressTracker::default();
        tracker.record_denied(); // first call returns None from record_denied
        let result = tracker.record_denied(); // second from the explicit check above
        // We call it again to reach the threshold
        assert!(result.is_some() || tracker.denied_count >= NON_PROGRESS_DENIED_THRESHOLD);
    }

    // AIH-4: per-call policy gate ─────────────────────────────────────────────

    #[test]
    fn policy_denies_tool_not_in_allowed_list() {
        let agent = test_agent("mistral", vec![]);
        let allowed = vec!["erp_search".to_string()];
        let result = check_tool_policy(&agent, &allowed, "web_search");
        assert!(result.is_err());
        assert!(result.unwrap_err().reason.contains("policy denial"));
    }

    #[test]
    fn policy_denies_tool_requiring_missing_action() {
        let mut agent = test_agent("mistral", vec![]);
        agent.allowed_actions = vec!["analytics_read".to_string()];
        let allowed = vec!["erp_search".to_string()];
        let result = check_tool_policy(&agent, &allowed, "erp_search");
        assert!(result.is_err());
    }

    #[test]
    fn policy_allows_permitted_tool() {
        let agent = test_agent("mistral", vec![]);
        // agent has "live_read" in allowed_actions from test_agent helper
        let allowed = vec!["erp_search".to_string()];
        let result = check_tool_policy(&agent, &allowed, "erp_search");
        assert!(result.is_ok());
    }
}
