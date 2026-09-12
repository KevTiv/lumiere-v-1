use anyhow::{bail, Result};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::collections::HashSet;

use crate::{
    harness::audit::{DecisionOutcome, PolicyDecision},
    providers::llm::{LlmCompletion, LlmMessage, LlmRequest, ToolCallRequest},
    tools::types::ToolOutput,
};

#[derive(Clone, Copy, Debug)]
pub(super) struct LoopLimits {
    pub max_rounds: u32,
    pub max_tool_calls: u32,
    pub max_tokens: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub(super) enum LoopStop {
    CandidateFinal(String),
    MalformedCall,
    ToolDenied,
    /// Policy requires approval; no draft is created by this loop yet.
    PendingApproval,
    PolicyFailed,
    ToolFailed,
    ProviderFailed,
    RoundLimit,
    ToolLimit,
    TokenLimit,
}

#[derive(Clone, Debug)]
pub(super) struct LoopOutcome {
    pub transcript: Vec<LlmMessage>,
    pub stop: LoopStop,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

#[derive(Clone, Debug)]
pub(super) struct LoopEvent {
    pub step_no: u32,
    pub kind: String,
    pub tool_name: Option<String>,
    pub input: Value,
    pub summary: String,
    pub error: Option<String>,
}

#[async_trait]
pub(super) trait LoopTools: Send + Sync {
    async fn execute(&self, call: &ToolCallRequest) -> Result<ToolOutput>;
}

/// Reevaluate reviewed policy for each invocation and protect its output.
#[async_trait]
pub(super) trait LoopPolicy: Send + Sync {
    async fn evaluate(
        &self,
        call: &ToolCallRequest,
        completed_calls: u32,
    ) -> Result<PolicyDecision>;
    async fn protect_output(
        &self,
        call: &ToolCallRequest,
        completed_calls: u32,
        output: ToolOutput,
    ) -> Result<ToolOutput>;
}

#[async_trait]
pub(super) trait LoopRecorder: Send + Sync {
    async fn record(&self, event: &LoopEvent) -> Result<()>;
}

pub(super) async fn run_loop(
    run_id: u64,
    llm: &dyn LlmCompletion,
    tools: &dyn LoopTools,
    policy: &dyn LoopPolicy,
    recorder: &dyn LoopRecorder,
    request: LlmRequest,
    limits: LoopLimits,
) -> Result<LoopOutcome> {
    if run_id == 0 {
        bail!("run_id must be nonzero");
    }
    if limits.max_rounds == 0
        || limits.max_tool_calls == 0
        || limits.max_tokens == 0
        || limits.max_rounds > 1_000
        || limits.max_tool_calls > 1_000
    {
        bail!("loop limits must be positive");
    }
    if request.max_tokens == 0 {
        bail!("request max_tokens must be positive");
    }
    if request.provider.eq_ignore_ascii_case("ollama") {
        bail!("ollama does not support the agent loop");
    }
    let mut advertised = HashSet::with_capacity(request.tools.len());
    for tool in &request.tools {
        if tool.name.trim().is_empty() || !advertised.insert(tool.name.clone()) {
            bail!("request tools must have unique nonempty names");
        }
    }

    let mut transcript = request.messages.clone();
    let mut input_tokens = 0_u64;
    let mut output_tokens = 0_u64;
    let mut tool_calls_used = 0_u32;
    let mut event_step = 2_u32;
    record(
        recorder,
        LoopEvent {
            step_no: 1,
            kind: "started".to_string(),
            tool_name: None,
            input: json!({"run_id": run_id}),
            summary: "agent loop started".to_string(),
            error: None,
        },
    )
    .await?;

    let mut seen_ids = HashSet::new();
    for _round in 0..limits.max_rounds {
        let used = input_tokens.saturating_add(output_tokens);
        if used >= limits.max_tokens {
            return stop(
                recorder,
                &mut event_step,
                transcript,
                LoopStop::TokenLimit,
                input_tokens,
                output_tokens,
            )
            .await;
        }
        let remaining = limits.max_tokens - used;
        let mut provider_request = request.clone();
        provider_request.messages = transcript.clone();
        provider_request.max_tokens = u32::try_from(remaining)
            .unwrap_or(u32::MAX)
            .min(request.max_tokens);
        if provider_request.max_tokens == 0 {
            return stop(
                recorder,
                &mut event_step,
                transcript,
                LoopStop::TokenLimit,
                input_tokens,
                output_tokens,
            )
            .await;
        }

        let response = match llm.complete(provider_request).await {
            Ok(response) => response,
            Err(error) => {
                record_provider_error(recorder, &mut event_step, error.to_string()).await?;
                return stop(
                    recorder,
                    &mut event_step,
                    transcript,
                    LoopStop::ProviderFailed,
                    input_tokens,
                    output_tokens,
                )
                .await;
            }
        };
        input_tokens = input_tokens.saturating_add(u64::from(response.input_tokens));
        output_tokens = output_tokens.saturating_add(u64::from(response.output_tokens));
        record(
            recorder,
            LoopEvent {
                step_no: next_step(&mut event_step),
                kind: "provider".to_string(),
                tool_name: None,
                input: json!({
                    "input_tokens": response.input_tokens,
                    "output_tokens": response.output_tokens,
                    "model": response.model,
                    "provider": response.provider,
                }),
                summary: "provider completion".to_string(),
                error: None,
            },
        )
        .await?;

        let calls = response.tool_calls;
        if input_tokens.saturating_add(output_tokens) >= limits.max_tokens {
            transcript.push(if calls.is_empty() {
                LlmMessage::text("assistant", response.text.clone())
            } else {
                LlmMessage::AssistantToolCalls {
                    content: (!response.text.is_empty()).then_some(response.text.clone()),
                    tool_calls: calls.clone(),
                }
            });
            return stop(
                recorder,
                &mut event_step,
                transcript,
                LoopStop::TokenLimit,
                input_tokens,
                output_tokens,
            )
            .await;
        }
        if calls.is_empty() {
            transcript.push(LlmMessage::text("assistant", response.text.clone()));
            return stop(
                recorder,
                &mut event_step,
                transcript,
                LoopStop::CandidateFinal(response.text),
                input_tokens,
                output_tokens,
            )
            .await;
        }
        transcript.push(LlmMessage::AssistantToolCalls {
            content: (!response.text.is_empty()).then_some(response.text),
            tool_calls: calls.clone(),
        });

        if calls.len() > (limits.max_tool_calls - tool_calls_used) as usize {
            record_tool_batch_error(
                recorder,
                &mut event_step,
                &calls,
                "tool call limit exceeded",
            )
            .await?;
            return stop(
                recorder,
                &mut event_step,
                transcript,
                LoopStop::ToolLimit,
                input_tokens,
                output_tokens,
            )
            .await;
        }

        if let Some(error) = validate_calls(&calls, &advertised, &mut seen_ids) {
            record_tool_batch_error(recorder, &mut event_step, &calls, &error).await?;
            let stop_reason = if error.starts_with("unknown tool") {
                LoopStop::ToolDenied
            } else {
                LoopStop::MalformedCall
            };
            return stop(
                recorder,
                &mut event_step,
                transcript,
                stop_reason,
                input_tokens,
                output_tokens,
            )
            .await;
        }

        for call in calls {
            let decision = match policy.evaluate(&call, tool_calls_used).await {
                Ok(decision) => decision,
                Err(error) => {
                    record(
                        recorder,
                        LoopEvent {
                            step_no: next_step(&mut event_step),
                            kind: "policy".into(),
                            tool_name: Some(call.name.clone()),
                            input: json!({"id":call.id}),
                            summary: "policy evaluation failed".into(),
                            error: Some(error.to_string()),
                        },
                    )
                    .await?;
                    return stop(
                        recorder,
                        &mut event_step,
                        transcript,
                        LoopStop::PolicyFailed,
                        input_tokens,
                        output_tokens,
                    )
                    .await;
                }
            };
            record(
                recorder,
                LoopEvent {
                    step_no: next_step(&mut event_step),
                    kind: "policy".into(),
                    tool_name: Some(call.name.clone()),
                    input: json!({"id":call.id,"decision":decision}),
                    summary: "per-call policy decision".into(),
                    error: None,
                },
            )
            .await?;
            let policy_stop = match decision.outcome {
                DecisionOutcome::Allow => None,
                DecisionOutcome::Deny => Some(LoopStop::ToolDenied),
                DecisionOutcome::DraftOnly => Some(LoopStop::PendingApproval),
            };
            if let Some(reason) = policy_stop {
                return stop(
                    recorder,
                    &mut event_step,
                    transcript,
                    reason,
                    input_tokens,
                    output_tokens,
                )
                .await;
            }
            tool_calls_used = tool_calls_used.saturating_add(1);
            let input = call.arguments.clone();
            match tools.execute(&call).await {
                Ok(output) => {
                    let output = match policy
                        .protect_output(&call, tool_calls_used - 1, output)
                        .await
                    {
                        Ok(output) => output,
                        Err(error) => {
                            record(
                                recorder,
                                LoopEvent {
                                    step_no: next_step(&mut event_step),
                                    kind: "policy".into(),
                                    tool_name: Some(call.name.clone()),
                                    input: json!({"id":call.id}),
                                    summary: "tool output rejected by policy".into(),
                                    error: Some(error.to_string()),
                                },
                            )
                            .await?;
                            return stop(
                                recorder,
                                &mut event_step,
                                transcript,
                                LoopStop::PolicyFailed,
                                input_tokens,
                                output_tokens,
                            )
                            .await;
                        }
                    };
                    let summary = output.summary.clone();
                    let event_input = json!({
                        "id": call.id,
                        "arguments": input,
                        "output": {
                            "summary": summary,
                            "data": output.data.clone(),
                            "citations": output.citations.clone(),
                            "row_count": output.row_count,
                        },
                    });
                    let content = serde_json::to_string(&json!({
                        "summary": output.summary,
                        "data": output.data,
                        "citations": output.citations,
                        "row_count": output.row_count,
                    }))?;
                    transcript.push(LlmMessage::ToolResult {
                        tool_call_id: call.id.clone(),
                        name: call.name.clone(),
                        content,
                    });
                    record(
                        recorder,
                        LoopEvent {
                            step_no: next_step(&mut event_step),
                            kind: "tool".to_string(),
                            tool_name: Some(call.name),
                            input: event_input,
                            summary,
                            error: None,
                        },
                    )
                    .await?;
                }
                Err(error) => {
                    let message = error.to_string();
                    transcript.push(LlmMessage::ToolResult {
                        tool_call_id: call.id.clone(),
                        name: call.name.clone(),
                        content: serde_json::to_string(&json!({"error": message}))?,
                    });
                    record(
                        recorder,
                        LoopEvent {
                            step_no: next_step(&mut event_step),
                            kind: "tool".to_string(),
                            tool_name: Some(call.name),
                            input,
                            summary: "tool execution failed".to_string(),
                            error: Some(message),
                        },
                    )
                    .await?;
                    return stop(
                        recorder,
                        &mut event_step,
                        transcript,
                        LoopStop::ToolFailed,
                        input_tokens,
                        output_tokens,
                    )
                    .await;
                }
            }
        }
    }

    stop(
        recorder,
        &mut event_step,
        transcript,
        LoopStop::RoundLimit,
        input_tokens,
        output_tokens,
    )
    .await
}

fn validate_calls(
    calls: &[ToolCallRequest],
    advertised: &HashSet<String>,
    seen_ids: &mut HashSet<String>,
) -> Option<String> {
    let mut batch_ids = HashSet::new();
    for call in calls {
        if let Some(error) = &call.arguments_error {
            return Some(format!("malformed arguments: {error}"));
        }
        if !call.arguments.is_object() {
            return Some("tool arguments must be a JSON object".to_string());
        }
        if call.name.trim().is_empty() {
            return Some("tool name must be nonempty".to_string());
        }
        if let Some(id) = &call.id {
            if id.is_empty() || !batch_ids.insert(id.clone()) || !seen_ids.insert(id.clone()) {
                return Some("duplicate tool call id".to_string());
            }
        }
        if !advertised.contains(&call.name) {
            return Some(format!("unknown tool '{}'", call.name));
        }
    }
    None
}

async fn record(recorder: &dyn LoopRecorder, event: LoopEvent) -> Result<()> {
    recorder.record(&event).await
}

fn next_step(step: &mut u32) -> u32 {
    let current = *step;
    *step = step.saturating_add(1);
    current
}

async fn record_provider_error(
    recorder: &dyn LoopRecorder,
    step: &mut u32,
    error: String,
) -> Result<()> {
    record(
        recorder,
        LoopEvent {
            step_no: next_step(step),
            kind: "provider".to_string(),
            tool_name: None,
            input: json!({"input_tokens": 0, "output_tokens": 0}),
            summary: "provider completion failed".to_string(),
            error: Some(error),
        },
    )
    .await
}

async fn record_tool_batch_error(
    recorder: &dyn LoopRecorder,
    step: &mut u32,
    calls: &[ToolCallRequest],
    error: &str,
) -> Result<()> {
    record(
        recorder,
        LoopEvent {
            step_no: next_step(step),
            kind: "tool".to_string(),
            tool_name: None,
            input: json!({
                "call_count": calls.len(),
                "calls": calls.iter().take(1).map(|call| json!({
                    "id": call.id,
                    "name": call.name,
                    "arguments": call.arguments,
                })).collect::<Vec<_>>(),
            }),
            summary: "tool call batch rejected".to_string(),
            error: Some(error.to_string()),
        },
    )
    .await
}

async fn stop(
    recorder: &dyn LoopRecorder,
    step: &mut u32,
    transcript: Vec<LlmMessage>,
    reason: LoopStop,
    input_tokens: u64,
    output_tokens: u64,
) -> Result<LoopOutcome> {
    let summary = format!("loop stopped: {reason:?}");
    record(
        recorder,
        LoopEvent {
            step_no: next_step(step),
            kind: "stopped".to_string(),
            tool_name: None,
            input: json!({
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
            }),
            summary,
            error: match &reason {
                LoopStop::CandidateFinal(_) | LoopStop::PendingApproval => None,
                ref terminal => Some(format!("{terminal:?}")),
            },
        },
    )
    .await?;
    Ok(LoopOutcome {
        transcript,
        stop: reason,
        input_tokens,
        output_tokens,
    })
}
