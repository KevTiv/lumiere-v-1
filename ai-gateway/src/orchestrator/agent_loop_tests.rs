use super::agent_loop::*;
use crate::harness::audit::{
    CorrelationMetadata, DecisionHashes, DecisionOutcome, DecisionReason, PolicyDecision,
    PolicyReasonCode,
};
use crate::harness::manifest::SkillVersionRef;
use crate::providers::llm::{
    LlmCompletion, LlmMessage, LlmRequest, LlmResponse, ToolCallRequest, ToolSpec,
};
use crate::tools::types::ToolOutput;
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

fn request() -> LlmRequest {
    LlmRequest {
        provider: "scripted".into(),
        model: "test-model".into(),
        system: "test".into(),
        messages: vec![LlmMessage::text("user", "start")],
        max_tokens: 128,
        temperature: None,
        top_p: None,
        tools: vec![ToolSpec {
            name: "lookup".into(),
            description: "test lookup".into(),
            parameters: json!({"type": "object"}),
        }],
    }
}

fn limits() -> LoopLimits {
    LoopLimits {
        max_rounds: 8,
        max_tool_calls: 8,
        max_tokens: 10_000,
    }
}

fn response(text: &str, calls: Vec<ToolCallRequest>) -> LlmResponse {
    LlmResponse {
        text: text.into(),
        input_tokens: 1,
        output_tokens: 1,
        model: "test-model".into(),
        provider: "scripted".into(),
        tool_calls: calls,
    }
}

fn call(id: &str, name: &str, arguments: Value) -> ToolCallRequest {
    ToolCallRequest {
        id: Some(id.into()),
        name: name.into(),
        arguments,
        arguments_error: None,
    }
}

struct ScriptedProvider {
    responses: Mutex<VecDeque<Result<LlmResponse>>>,
    requests: Mutex<Vec<LlmRequest>>,
}

impl ScriptedProvider {
    fn new(responses: Vec<Result<LlmResponse>>) -> Self {
        Self {
            responses: Mutex::new(responses.into()),
            requests: Mutex::new(Vec::new()),
        }
    }

    fn request_count(&self) -> usize {
        self.requests.lock().expect("requests lock").len()
    }
}

#[async_trait]
impl LlmCompletion for ScriptedProvider {
    async fn complete(&self, req: LlmRequest) -> Result<LlmResponse> {
        self.requests.lock().expect("requests lock").push(req);
        self.responses
            .lock()
            .expect("responses lock")
            .pop_front()
            .unwrap_or_else(|| Err(anyhow!("script exhausted")))
    }
}

struct ScriptedTools {
    calls: Mutex<Vec<ToolCallRequest>>,
    fail: bool,
}

struct ScriptedPolicy {
    decisions: Mutex<VecDeque<Result<PolicyDecision>>>,
    evaluated: Mutex<Vec<String>>,
    protect_error: bool,
    transform_output: bool,
}

impl ScriptedPolicy {
    fn allow() -> Self {
        Self {
            decisions: Mutex::new(VecDeque::new()),
            evaluated: Mutex::new(Vec::new()),
            protect_error: false,
            transform_output: false,
        }
    }

    fn decision(outcome: DecisionOutcome) -> PolicyDecision {
        PolicyDecision {
            outcome,
            skill: SkillVersionRef::new("test-skill", 1),
            risk: None,
            reasons: vec![DecisionReason::new(
                PolicyReasonCode::Allowed,
                "test policy",
            )],
            correlation: CorrelationMetadata {
                correlation_id: "test-correlation".into(),
                organization_id: 1,
                company_id: 1,
                actor_id: Some("test-actor".into()),
                causation_id: Some("test-causation".into()),
            },
            hashes: DecisionHashes {
                request_hash: "request-hash".into(),
                input_hash: "input-hash".into(),
                manifest_hash: Some("manifest-hash".into()),
            },
            enforced_limits: None,
        }
    }
}

#[async_trait]
impl LoopPolicy for ScriptedPolicy {
    async fn evaluate(
        &self,
        call: &ToolCallRequest,
        _completed_calls: u32,
    ) -> Result<PolicyDecision> {
        self.evaluated
            .lock()
            .expect("policy lock")
            .push(call.id.clone().unwrap_or_default());
        self.decisions
            .lock()
            .expect("decisions lock")
            .pop_front()
            .unwrap_or_else(|| Ok(Self::decision(DecisionOutcome::Allow)))
    }

    async fn protect_output(
        &self,
        _call: &ToolCallRequest,
        _completed_calls: u32,
        mut output: ToolOutput,
    ) -> Result<ToolOutput> {
        if self.protect_error {
            return Err(anyhow!("output policy failed"));
        }
        if self.transform_output {
            output.summary = "protected result".into();
            output.data = json!({"value": "protected"});
        }
        Ok(output)
    }
}

fn allow_policy() -> ScriptedPolicy {
    ScriptedPolicy::allow()
}

#[async_trait]
impl LoopTools for ScriptedTools {
    async fn execute(&self, call: &ToolCallRequest) -> Result<ToolOutput> {
        self.calls.lock().expect("tools lock").push(call.clone());
        if self.fail {
            return Err(anyhow!("tool failed"));
        }
        Ok(ToolOutput {
            summary: "tool result".into(),
            data: json!({"value": 42}),
            citations: vec![],
            row_count: Some(1),
        })
    }
}

struct ScriptedRecorder {
    events: Mutex<Vec<LoopEvent>>,
    fail_at: Option<usize>,
}

#[async_trait]
impl LoopRecorder for ScriptedRecorder {
    async fn record(&self, event: &LoopEvent) -> Result<()> {
        let mut events = self.events.lock().expect("events lock");
        let next = events.len() + 1;
        if self.fail_at == Some(next) {
            return Err(anyhow!("recorder failed"));
        }
        events.push(event.clone());
        Ok(())
    }
}

fn recorder() -> Arc<ScriptedRecorder> {
    Arc::new(ScriptedRecorder {
        events: Mutex::new(Vec::new()),
        fail_at: None,
    })
}

#[tokio::test]
async fn executes_two_calls_then_returns_candidate_and_preserves_transcript() {
    let provider = ScriptedProvider::new(vec![
        Ok(response("", vec![call("a", "lookup", json!({"q": "one"}))])),
        Ok(response("", vec![call("b", "lookup", json!({"q": "two"}))])),
        Ok(response("done", vec![])),
    ]);
    let tools = ScriptedTools {
        calls: Mutex::new(Vec::new()),
        fail: false,
    };
    let rec = recorder();
    let out = run_loop(
        7,
        &provider,
        &tools,
        &allow_policy(),
        rec.as_ref(),
        request(),
        limits(),
    )
    .await
    .expect("loop");
    assert_eq!(out.stop, LoopStop::CandidateFinal("done".into()));
    assert_eq!(provider.request_count(), 3);
    let requests = provider.requests.lock().expect("requests");
    for (round, id) in [(1, "a"), (2, "b")] {
        assert!(requests[round]
            .messages
            .iter()
            .any(|message| matches!(message,
            LlmMessage::AssistantToolCalls { tool_calls, .. }
                if tool_calls.iter().any(|call| call.id.as_deref() == Some(id)))));
        assert!(requests[round].messages.iter().any(|message| matches!(message,
            LlmMessage::ToolResult { tool_call_id, name, content }
                if tool_call_id.as_deref() == Some(id) && name == "lookup"
                    && serde_json::from_str::<Value>(content).expect("tool result JSON")["data"]["value"] == 42)));
    }
    assert_eq!(tools.calls.lock().expect("tools lock").len(), 2);
    assert!(out
        .transcript
        .iter()
        .any(|m| matches!(m, LlmMessage::ToolResult { content, .. } if content.contains("42"))));
    assert!(rec.events.lock().expect("events").iter().any(|event| {
        event.kind == "policy" && event.input["decision"]["skill"]["skill_key"] == "test-skill"
    }));
    assert!(out.input_tokens > 0 && out.output_tokens > 0);
}

#[tokio::test]
async fn run_zero_has_no_side_effects() {
    let provider = ScriptedProvider::new(vec![Ok(response(
        "",
        vec![call("token", "lookup", json!({}))],
    ))]);
    let tools = ScriptedTools {
        calls: Mutex::new(Vec::new()),
        fail: false,
    };
    let rec = recorder();
    assert!(run_loop(
        0,
        &provider,
        &tools,
        &allow_policy(),
        rec.as_ref(),
        request(),
        limits()
    )
    .await
    .is_err());
    assert_eq!(provider.request_count(), 0);
    assert!(tools.calls.lock().expect("tools lock").is_empty());
    assert!(rec.events.lock().expect("events lock").is_empty());
}

#[tokio::test]
async fn malformed_batch_denies_the_whole_batch() {
    let provider = ScriptedProvider::new(vec![Ok(response(
        "",
        vec![
            call("ok", "lookup", json!({})),
            ToolCallRequest {
                id: Some("bad".into()),
                name: "lookup".into(),
                arguments: json!({}),
                arguments_error: Some("bad json".into()),
            },
        ],
    ))]);
    let tools = ScriptedTools {
        calls: Mutex::new(Vec::new()),
        fail: false,
    };
    let rec = recorder();
    let out = run_loop(
        1,
        &provider,
        &tools,
        &allow_policy(),
        rec.as_ref(),
        request(),
        limits(),
    )
    .await
    .expect("loop");
    assert_eq!(out.stop, LoopStop::MalformedCall);
    assert!(tools.calls.lock().expect("tools lock").is_empty());
}

#[tokio::test]
async fn unknown_tool_is_denied_without_execution() {
    let provider = ScriptedProvider::new(vec![Ok(response(
        "",
        vec![call("x", "missing", json!({}))],
    ))]);
    let tools = ScriptedTools {
        calls: Mutex::new(Vec::new()),
        fail: false,
    };
    let out = run_loop(
        2,
        &provider,
        &tools,
        &allow_policy(),
        recorder().as_ref(),
        request(),
        limits(),
    )
    .await
    .expect("loop");
    assert_eq!(out.stop, LoopStop::ToolDenied);
    assert!(tools.calls.lock().expect("tools lock").is_empty());
}

#[tokio::test]
async fn round_tool_and_token_caps_stop_without_unbounded_calls() {
    let provider = ScriptedProvider::new(
        (0..4)
            .map(|_| Ok(response("", vec![call("x", "lookup", json!({}))])))
            .collect(),
    );
    let tools = ScriptedTools {
        calls: Mutex::new(Vec::new()),
        fail: false,
    };
    let out = run_loop(
        3,
        &provider,
        &tools,
        &allow_policy(),
        recorder().as_ref(),
        request(),
        LoopLimits {
            max_rounds: 1,
            max_tool_calls: 8,
            max_tokens: 100,
        },
    )
    .await
    .expect("loop");
    assert_eq!(out.stop, LoopStop::RoundLimit);
    assert!(provider.request_count() <= 1);

    let provider = ScriptedProvider::new(
        (0..4)
            .map(|_| Ok(response("", vec![call("x", "lookup", json!({}))])))
            .collect(),
    );
    let tools = ScriptedTools {
        calls: Mutex::new(Vec::new()),
        fail: false,
    };
    let out = run_loop(
        4,
        &provider,
        &tools,
        &allow_policy(),
        recorder().as_ref(),
        request(),
        LoopLimits {
            max_rounds: 8,
            max_tool_calls: 1,
            max_tokens: 100,
        },
    )
    .await
    .expect("loop");
    assert_eq!(out.stop, LoopStop::ToolLimit);

    let provider = ScriptedProvider::new(vec![Ok(response(
        "",
        vec![call("token", "lookup", json!({}))],
    ))]);
    let tools = ScriptedTools {
        calls: Mutex::new(Vec::new()),
        fail: false,
    };
    let out = run_loop(
        5,
        &provider,
        &tools,
        &allow_policy(),
        recorder().as_ref(),
        request(),
        LoopLimits {
            max_rounds: 8,
            max_tool_calls: 8,
            max_tokens: 2,
        },
    )
    .await
    .expect("loop");
    assert_eq!(out.stop, LoopStop::TokenLimit);
}

#[tokio::test]
async fn zero_usage_is_still_bounded() {
    let provider = ScriptedProvider::new(
        (0..3)
            .map(|index| {
                let mut next = response("", vec![call(&format!("x-{index}"), "lookup", json!({}))]);
                next.input_tokens = 0;
                next.output_tokens = 0;
                Ok(next)
            })
            .collect(),
    );
    let tools = ScriptedTools {
        calls: Mutex::new(Vec::new()),
        fail: false,
    };
    let out = run_loop(
        6,
        &provider,
        &tools,
        &allow_policy(),
        recorder().as_ref(),
        request(),
        LoopLimits {
            max_rounds: 2,
            max_tool_calls: 2,
            max_tokens: 100,
        },
    )
    .await
    .expect("loop");
    assert!(matches!(
        out.stop,
        LoopStop::TokenLimit | LoopStop::RoundLimit | LoopStop::ToolLimit
    ));
    assert!(provider.request_count() <= 2);
}

#[tokio::test]
async fn recorder_failure_before_provider_is_returned() {
    let provider = ScriptedProvider::new(vec![Ok(response("done", vec![]))]);
    let tools = ScriptedTools {
        calls: Mutex::new(Vec::new()),
        fail: false,
    };
    let rec = ScriptedRecorder {
        events: Mutex::new(Vec::new()),
        fail_at: Some(1),
    };
    assert!(run_loop(
        8,
        &provider,
        &tools,
        &allow_policy(),
        &rec,
        request(),
        limits()
    )
    .await
    .is_err());
    assert_eq!(provider.request_count(), 0);
}

#[tokio::test]
async fn recorder_failure_after_tool_prevents_next_provider_call() {
    let provider = ScriptedProvider::new(vec![
        Ok(response("", vec![call("x", "lookup", json!({}))])),
        Ok(response("done", vec![])),
    ]);
    let tools = ScriptedTools {
        calls: Mutex::new(Vec::new()),
        fail: false,
    };
    let rec = ScriptedRecorder {
        events: Mutex::new(Vec::new()),
        fail_at: Some(4),
    };
    assert!(run_loop(
        9,
        &provider,
        &tools,
        &allow_policy(),
        &rec,
        request(),
        limits()
    )
    .await
    .is_err());
    assert_eq!(provider.request_count(), 1);
}

#[tokio::test]
async fn provider_and_tool_errors_are_persisted_and_stop() {
    let provider = ScriptedProvider::new(vec![Err(anyhow!("provider failed"))]);
    let tools = ScriptedTools {
        calls: Mutex::new(Vec::new()),
        fail: false,
    };
    let rec = recorder();
    let out = run_loop(
        10,
        &provider,
        &tools,
        &allow_policy(),
        rec.as_ref(),
        request(),
        limits(),
    )
    .await
    .expect("loop");
    assert_eq!(out.stop, LoopStop::ProviderFailed);
    assert!(!rec.events.lock().expect("events lock").is_empty());

    let provider =
        ScriptedProvider::new(vec![Ok(response("", vec![call("x", "lookup", json!({}))]))]);
    let tools = ScriptedTools {
        calls: Mutex::new(Vec::new()),
        fail: true,
    };
    let rec = recorder();
    let out = run_loop(
        11,
        &provider,
        &tools,
        &allow_policy(),
        rec.as_ref(),
        request(),
        limits(),
    )
    .await
    .expect("loop");
    assert_eq!(out.stop, LoopStop::ToolFailed);
    assert!(!rec.events.lock().expect("events lock").is_empty());
}

#[tokio::test]
async fn successful_events_are_contiguous_and_have_terminal_stop() {
    let provider = ScriptedProvider::new(vec![Ok(response("done", vec![]))]);
    let tools = ScriptedTools {
        calls: Mutex::new(Vec::new()),
        fail: false,
    };
    let rec = recorder();
    run_loop(
        12,
        &provider,
        &tools,
        &allow_policy(),
        rec.as_ref(),
        request(),
        limits(),
    )
    .await
    .expect("loop");
    let events = rec.events.lock().expect("events lock");
    assert_eq!(
        events.first().map(|event| event.kind.as_str()),
        Some("started")
    );
    assert_eq!(
        events.last().map(|event| event.kind.as_str()),
        Some("stopped")
    );
    assert!(events
        .iter()
        .enumerate()
        .all(|(index, event)| event.step_no == (index + 1) as u32));
}

#[tokio::test]
async fn over_budget_final_response_stops_before_candidate_acceptance() {
    let mut final_response = response("too late", vec![]);
    final_response.input_tokens = 1;
    final_response.output_tokens = 1;
    let provider = ScriptedProvider::new(vec![Ok(final_response)]);
    let tools = ScriptedTools {
        calls: Mutex::new(Vec::new()),
        fail: false,
    };
    let out = run_loop(
        13,
        &provider,
        &tools,
        &allow_policy(),
        recorder().as_ref(),
        request(),
        LoopLimits {
            max_rounds: 2,
            max_tool_calls: 2,
            max_tokens: 1,
        },
    )
    .await
    .expect("loop");
    assert_eq!(out.stop, LoopStop::TokenLimit);
}

#[tokio::test]
async fn replayed_or_empty_ids_are_rejected_before_any_tool_executes() {
    let provider = ScriptedProvider::new(vec![
        Ok(response("", vec![call("same", "lookup", json!({}))])),
        Ok(response("", vec![call("same", "lookup", json!({}))])),
    ]);
    let tools = ScriptedTools {
        calls: Mutex::new(Vec::new()),
        fail: false,
    };
    let out = run_loop(
        14,
        &provider,
        &tools,
        &allow_policy(),
        recorder().as_ref(),
        request(),
        limits(),
    )
    .await
    .expect("loop");
    assert_eq!(out.stop, LoopStop::MalformedCall);
    assert_eq!(tools.calls.lock().expect("tools lock").len(), 1);

    let provider = ScriptedProvider::new(vec![Ok(response(
        "",
        vec![
            call("", "lookup", json!({})),
            ToolCallRequest {
                id: None,
                name: "lookup".into(),
                arguments: json!({}),
                arguments_error: None,
            },
        ],
    ))]);
    let tools = ScriptedTools {
        calls: Mutex::new(Vec::new()),
        fail: false,
    };
    let out = run_loop(
        15,
        &provider,
        &tools,
        &allow_policy(),
        recorder().as_ref(),
        request(),
        limits(),
    )
    .await
    .expect("loop");
    assert_eq!(out.stop, LoopStop::MalformedCall);
    assert!(tools.calls.lock().expect("tools lock").is_empty());
}

#[tokio::test]
async fn next_provider_request_shrinks_max_tokens_after_usage() {
    let provider = ScriptedProvider::new(vec![
        Ok(response("", vec![call("first", "lookup", json!({}))])),
        Ok(response("done", vec![])),
    ]);
    let tools = ScriptedTools {
        calls: Mutex::new(Vec::new()),
        fail: false,
    };
    run_loop(
        16,
        &provider,
        &tools,
        &allow_policy(),
        recorder().as_ref(),
        request(),
        LoopLimits {
            max_rounds: 8,
            max_tool_calls: 8,
            max_tokens: 5,
        },
    )
    .await
    .expect("loop");
    let requests = provider.requests.lock().expect("requests lock");
    assert_eq!(requests.len(), 2);
    assert!(requests[1].max_tokens < requests[0].max_tokens);
}

#[tokio::test]
async fn each_call_is_evaluated_and_second_denial_prevents_execution_and_next_provider() {
    let provider = ScriptedProvider::new(vec![Ok(response(
        "",
        vec![
            call("first", "lookup", json!({})),
            call("second", "lookup", json!({})),
        ],
    ))]);
    let tools = ScriptedTools {
        calls: Mutex::new(Vec::new()),
        fail: false,
    };
    let policy = ScriptedPolicy {
        decisions: Mutex::new(VecDeque::from([
            Ok(ScriptedPolicy::decision(DecisionOutcome::Allow)),
            Ok(ScriptedPolicy::decision(DecisionOutcome::Deny)),
        ])),
        evaluated: Mutex::new(Vec::new()),
        protect_error: false,
        transform_output: false,
    };
    let out = run_loop(
        17,
        &provider,
        &tools,
        &policy,
        recorder().as_ref(),
        request(),
        limits(),
    )
    .await
    .expect("loop");
    assert_eq!(out.stop, LoopStop::ToolDenied);
    assert_eq!(provider.request_count(), 1);
    assert_eq!(
        *policy.evaluated.lock().expect("policy"),
        vec!["first".to_string(), "second".to_string()]
    );
    assert_eq!(tools.calls.lock().expect("tools").len(), 1);
}

#[tokio::test]
async fn draft_only_stops_pending_approval_without_tool_execution() {
    let provider = ScriptedProvider::new(vec![Ok(response(
        "",
        vec![call("draft", "lookup", json!({}))],
    ))]);
    let tools = ScriptedTools {
        calls: Mutex::new(Vec::new()),
        fail: false,
    };
    let policy = ScriptedPolicy {
        decisions: Mutex::new(VecDeque::from([Ok(ScriptedPolicy::decision(
            DecisionOutcome::DraftOnly,
        ))])),
        ..ScriptedPolicy::allow()
    };
    let out = run_loop(
        18,
        &provider,
        &tools,
        &policy,
        recorder().as_ref(),
        request(),
        limits(),
    )
    .await
    .expect("loop");
    assert_eq!(out.stop, LoopStop::PendingApproval);
    assert!(tools.calls.lock().expect("tools").is_empty());
}

#[tokio::test]
async fn policy_record_failure_prevents_tool_execution() {
    let provider =
        ScriptedProvider::new(vec![Ok(response("", vec![call("x", "lookup", json!({}))]))]);
    let tools = ScriptedTools {
        calls: Mutex::new(Vec::new()),
        fail: false,
    };
    let rec = ScriptedRecorder {
        events: Mutex::new(Vec::new()),
        fail_at: Some(3),
    };
    assert!(run_loop(
        19,
        &provider,
        &tools,
        &allow_policy(),
        &rec,
        request(),
        limits()
    )
    .await
    .is_err());
    assert!(tools.calls.lock().expect("tools").is_empty());
}

#[tokio::test]
async fn policy_evaluation_failure_stops_with_policy_failed() {
    let provider =
        ScriptedProvider::new(vec![Ok(response("", vec![call("x", "lookup", json!({}))]))]);
    let tools = ScriptedTools {
        calls: Mutex::new(Vec::new()),
        fail: false,
    };
    let policy = ScriptedPolicy {
        decisions: Mutex::new(VecDeque::from([Err(anyhow!("policy unavailable"))])),
        ..ScriptedPolicy::allow()
    };
    let out = run_loop(
        20,
        &provider,
        &tools,
        &policy,
        recorder().as_ref(),
        request(),
        limits(),
    )
    .await
    .expect("loop");
    assert_eq!(out.stop, LoopStop::PolicyFailed);
    assert!(tools.calls.lock().expect("tools").is_empty());
}

#[tokio::test]
async fn protected_output_error_stops_before_raw_output_reaches_transcript_or_provider() {
    let provider = ScriptedProvider::new(vec![
        Ok(response("", vec![call("x", "lookup", json!({}))])),
        Ok(response("done", vec![])),
    ]);
    let tools = ScriptedTools {
        calls: Mutex::new(Vec::new()),
        fail: false,
    };
    let policy = ScriptedPolicy {
        protect_error: true,
        ..ScriptedPolicy::allow()
    };
    let out = run_loop(
        21,
        &provider,
        &tools,
        &policy,
        recorder().as_ref(),
        request(),
        limits(),
    )
    .await
    .expect("loop");
    assert_eq!(out.stop, LoopStop::PolicyFailed);
    assert_eq!(provider.request_count(), 1);
    assert!(!out.transcript.iter().any(|message| matches!(message, LlmMessage::ToolResult { content, .. } if content.contains("42"))));
}

#[tokio::test]
async fn protected_output_is_transformed_before_next_provider_request() {
    let provider = ScriptedProvider::new(vec![
        Ok(response("", vec![call("x", "lookup", json!({}))])),
        Ok(response("done", vec![])),
    ]);
    let tools = ScriptedTools {
        calls: Mutex::new(Vec::new()),
        fail: false,
    };
    let policy = ScriptedPolicy {
        transform_output: true,
        ..ScriptedPolicy::allow()
    };
    run_loop(
        22,
        &provider,
        &tools,
        &policy,
        recorder().as_ref(),
        request(),
        limits(),
    )
    .await
    .expect("loop");
    let requests = provider.requests.lock().expect("requests");
    let content = requests[1]
        .messages
        .iter()
        .find_map(|message| match message {
            LlmMessage::ToolResult { content, .. } => Some(content),
            _ => None,
        })
        .expect("tool result");
    assert!(content.contains("protected"));
    assert!(!content.contains("42"));
}
