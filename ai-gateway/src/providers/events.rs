//! Provider-neutral events (H5d). Adapters in `llm.rs` decode each driver's
//! payload into [`LlmResponse`]; this module turns that into the events the
//! orchestration layer consumes so it never branches on provider payloads.
//! Native reasoning/replay state is deliberately not representable here.

use super::llm::{CompletionTermination, LlmResponse, ToolCallRequest};

#[derive(Clone, Debug, PartialEq)]
pub enum ProviderEvent {
    Text(String),
    ToolCall(ToolCallRequest),
    Usage {
        input_tokens: u32,
        output_tokens: u32,
    },
    Completed {
        termination: CompletionTermination,
        done_reason: Option<String>,
    },
}

pub fn normalize_response(response: &LlmResponse) -> Vec<ProviderEvent> {
    let mut events = Vec::new();
    if !response.text.is_empty() {
        events.push(ProviderEvent::Text(response.text.clone()));
    }
    events.extend(
        response
            .tool_calls
            .iter()
            .cloned()
            .map(ProviderEvent::ToolCall),
    );
    events.push(ProviderEvent::Usage {
        input_tokens: response.input_tokens,
        output_tokens: response.output_tokens,
    });
    events.push(ProviderEvent::Completed {
        termination: response.termination,
        done_reason: response.provider_done_reason.clone(),
    });
    events
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::llm::{LlmCompletion, LlmRequest, ThinkingMode};
    use async_trait::async_trait;

    struct Fake(&'static str);

    #[async_trait]
    impl LlmCompletion for Fake {
        async fn complete(&self, req: LlmRequest) -> anyhow::Result<LlmResponse> {
            Ok(LlmResponse {
                text: "ok".into(),
                input_tokens: 3,
                output_tokens: 2,
                model: req.model,
                provider: self.0.into(),
                tool_calls: vec![ToolCallRequest {
                    id: Some("c1".into()),
                    name: "stock".into(),
                    arguments: serde_json::json!({"sku": "A"}),
                    arguments_error: None,
                }],
                termination: CompletionTermination::ToolCall,
                provider_done_reason: Some("tool_calls".into()),
                thinking_observed: true,
                mistral_replay: None,
            })
        }
    }

    // Orchestration-side consumer: operates on events only, never on provider.
    fn tool_names(events: &[ProviderEvent]) -> Vec<String> {
        events
            .iter()
            .filter_map(|e| match e {
                ProviderEvent::ToolCall(call) => Some(call.name.clone()),
                _ => None,
            })
            .collect()
    }

    #[tokio::test]
    async fn orchestration_consumes_identical_events_for_any_provider() {
        let mut seen = Vec::new();
        for provider in ["mistral", "gemini", "ollama", "openai_compatible"] {
            let response = Fake(provider)
                .complete(LlmRequest {
                    provider: provider.into(),
                    model: "m".into(),
                    system: String::new(),
                    messages: vec![],
                    max_tokens: 8,
                    temperature: None,
                    top_p: None,
                    tools: vec![],
                    single_shot_tool: false,
                    thinking: ThinkingMode::ProviderDefault,
                })
                .await
                .unwrap();
            let events = normalize_response(&response);
            assert_eq!(tool_names(&events), vec!["stock"]);
            seen.push(events);
        }
        assert!(seen.windows(2).all(|pair| pair[0] == pair[1]));
    }
}
