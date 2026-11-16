//! Native OpenAI Responses transport for the gateway's project-key provider.

use std::{collections::HashSet, time::Duration};

use anyhow::{bail, ensure, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};

use super::llm::{
    bounded_completion, check_provider_response, CompletionTermination, LlmMessage, LlmRequest,
    LlmResponse, ToolCallRequest,
};

const ENDPOINT: &str = "https://api.openai.com/v1/responses";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

pub(super) async fn complete(
    http: &reqwest::Client,
    api_key: &str,
    req: &LlmRequest,
) -> Result<LlmResponse> {
    let response = http
        .post(ENDPOINT)
        .timeout(REQUEST_TIMEOUT)
        .bearer_auth(api_key)
        .json(&payload(req)?)
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("OpenAI Responses request failed"))?;

    // Neither HTTP error bodies nor decoding errors are safe to persist in
    // the attempt ledger because the provider may echo the prompt.
    check_provider_response(
        "OpenAI",
        response.status(),
        response.headers().get(reqwest::header::RETRY_AFTER),
    )?;
    let body = bounded_completion(response)
        .await
        .map_err(|_| anyhow::anyhow!("invalid OpenAI Responses envelope"))?;
    normalize(body, req)
}

pub(super) fn validate_history(req: &LlmRequest) -> Result<()> {
    ensure!(
        !req.single_shot_tool || !req.tools.is_empty(),
        "OpenAI single-shot completion requires at least one tool schema"
    );
    ensure!(
        !req.messages.is_empty(),
        "OpenAI Responses requires at least one input message"
    );
    for message in &req.messages {
        match message {
            LlmMessage::Text { role, .. } => ensure!(
                matches!(role.as_str(), "system" | "developer" | "user" | "assistant"),
                "unsupported message role for OpenAI Responses"
            ),
            LlmMessage::AssistantToolCalls { tool_calls, .. } => {
                for call in tool_calls {
                    require_call_id(call.id.as_deref())?;
                }
            }
            LlmMessage::ToolResult { tool_call_id, .. } => {
                require_call_id(tool_call_id.as_deref())?;
            }
            LlmMessage::MistralAssistant(_) => {
                bail!("OpenAI Responses cannot replay a native Mistral message");
            }
        }
    }
    Ok(())
}

fn require_call_id(id: Option<&str>) -> Result<&str> {
    id.filter(|id| {
        !id.is_empty() && id.len() <= 64 && id.bytes().all(|byte| byte.is_ascii_graphic())
    })
    .context("invalid or missing OpenAI function call ID")
}

fn payload(req: &LlmRequest) -> Result<Value> {
    validate_history(req)?;
    let mut input = Vec::with_capacity(req.messages.len());
    for message in &req.messages {
        match message {
            LlmMessage::Text { role, content } => {
                input.push(json!({"role": role, "content": content}));
            }
            LlmMessage::AssistantToolCalls {
                content,
                tool_calls,
            } => {
                if let Some(content) = content {
                    input.push(json!({"role": "assistant", "content": content}));
                }
                input.extend(tool_calls.iter().map(|call| {
                    json!({
                        "type": "function_call",
                        "call_id": call.id,
                        "name": call.name,
                        "arguments": call.arguments.to_string(),
                    })
                }));
            }
            LlmMessage::ToolResult {
                tool_call_id,
                content,
                ..
            } => input.push(json!({
                "type": "function_call_output",
                "call_id": tool_call_id,
                "output": content,
            })),
            LlmMessage::MistralAssistant(_) => {
                bail!("OpenAI Responses cannot replay a native Mistral message");
            }
        }
    }

    let mut body = json!({
        "model": req.model,
        "input": input,
        "store": false,
        "reasoning": {"effort": "none"},
        "max_output_tokens": req.max_tokens,
    });
    if !req.system.is_empty() {
        body["instructions"] = json!(req.system);
    }
    if let Some(temperature) = req.temperature {
        body["temperature"] = json!(temperature);
    }
    if let Some(top_p) = req.top_p {
        body["top_p"] = json!(top_p);
    }
    if !req.tools.is_empty() {
        let tools: Vec<_> = req
            .tools
            .iter()
            .map(|tool| {
                // Lumière schemas can have optional fields and are validated
                // by the harness without OpenAI's strict-schema rewrite.
                json!({
                    "type": "function",
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                    "strict": false,
                })
            })
            .collect();
        body["tools"] = json!(tools);
        if req.single_shot_tool {
            body["tool_choice"] = json!("required");
            body["parallel_tool_calls"] = json!(false);
        }
    }
    Ok(body)
}

#[derive(Deserialize)]
struct Response {
    model: String,
    status: ResponseStatus,
    output: Vec<OutputItem>,
    incomplete_details: Option<IncompleteDetails>,
    usage: Option<Usage>,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum ResponseStatus {
    Completed,
    Incomplete,
    #[serde(other)]
    Unsuccessful,
}

#[derive(Deserialize)]
struct IncompleteDetails {
    reason: Option<IncompleteReason>,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum IncompleteReason {
    MaxOutputTokens,
    MaxMessages,
    ContentFilter,
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
struct Usage {
    input_tokens: u32,
    output_tokens: u32,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum OutputItem {
    Message {
        content: Vec<MessageContent>,
    },
    FunctionCall {
        call_id: String,
        name: String,
        arguments: String,
        status: Option<ItemStatus>,
    },
    #[serde(other)]
    Unsupported,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum ItemStatus {
    Completed,
    #[serde(other)]
    Unsuccessful,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum MessageContent {
    OutputText {
        text: String,
    },
    Refusal,
    #[serde(other)]
    Unsupported,
}

fn normalize(body: Response, req: &LlmRequest) -> Result<LlmResponse> {
    // OpenAI lists the requested alias as its only snapshot for both pilot
    // models. Keep the audit and spend binding on the admitted model.
    ensure!(
        body.model == req.model,
        "OpenAI Responses returned a different model from the requested model"
    );
    let usage = body.usage.context("OpenAI Responses omitted token usage")?;
    let mut result = LlmResponse {
        text: String::new(),
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        model: body.model,
        provider: "openai".to_string(),
        tool_calls: Vec::new(),
        termination: CompletionTermination::Complete,
        provider_done_reason: Some("completed".to_string()),
        thinking_observed: false,
        mistral_replay: None,
    };
    match body.status {
        ResponseStatus::Completed => {}
        ResponseStatus::Incomplete => {
            let (termination, reason) = match body.incomplete_details.and_then(|d| d.reason) {
                Some(IncompleteReason::MaxOutputTokens) => {
                    (CompletionTermination::Length, "max_output_tokens")
                }
                Some(IncompleteReason::MaxMessages) => {
                    (CompletionTermination::Length, "max_messages")
                }
                Some(IncompleteReason::ContentFilter) => {
                    (CompletionTermination::Filtered, "content_filter")
                }
                _ => bail!("OpenAI Responses returned an unrecognized incomplete result"),
            };
            result.termination = termination;
            result.provider_done_reason = Some(reason.to_string());
            // Never pass actions or partial output onward from an incomplete response.
            return Ok(result);
        }
        ResponseStatus::Unsuccessful => bail!("OpenAI Responses did not complete"),
    }

    let mut seen_call_ids = HashSet::new();
    for item in &body.output {
        match item {
            OutputItem::Message { content } => {
                for part in content {
                    match part {
                        MessageContent::OutputText { text } => result.text.push_str(text),
                        MessageContent::Refusal => {
                            result.text.clear();
                            result.tool_calls.clear();
                            result.termination = CompletionTermination::Filtered;
                            result.provider_done_reason = Some("refusal".to_string());
                            return Ok(result);
                        }
                        MessageContent::Unsupported => {
                            bail!("OpenAI Responses returned unsupported message content");
                        }
                    }
                }
            }
            OutputItem::FunctionCall {
                call_id,
                name,
                arguments,
                status,
            } => {
                require_call_id(Some(call_id))?;
                ensure!(
                    seen_call_ids.insert(call_id.as_str()),
                    "OpenAI Responses returned duplicate function call IDs"
                );
                let error = if matches!(status, Some(ItemStatus::Unsuccessful)) {
                    Some("OpenAI function call did not complete")
                } else if !req.tools.iter().any(|tool| tool.name == *name) {
                    Some("OpenAI function call was not among the admitted tools")
                } else {
                    None
                };
                let arguments = serde_json::from_str::<serde_json::Map<String, Value>>(arguments);
                let (arguments, arguments_error) = match (arguments, error) {
                    (Ok(arguments), None) => (Value::Object(arguments), None),
                    (_, error) => (
                        Value::Null,
                        Some(
                            error
                                .unwrap_or("malformed OpenAI function call arguments")
                                .to_string(),
                        ),
                    ),
                };
                result.tool_calls.push(ToolCallRequest {
                    id: Some(call_id.clone()),
                    name: name.clone(),
                    arguments,
                    arguments_error,
                });
            }
            OutputItem::Unsupported => {
                bail!("OpenAI Responses returned an unsupported output item")
            }
        }
    }
    if !result.tool_calls.is_empty() {
        result.termination = CompletionTermination::ToolCall;
        result.provider_done_reason = Some("tool_calls".to_string());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::llm::{ThinkingMode, ToolSpec};

    fn request() -> LlmRequest {
        LlmRequest {
            provider: "openai".to_string(),
            model: "gpt-6-luna".to_string(),
            system: "Only use approved actions.".to_string(),
            messages: vec![LlmMessage::text("user", "How much stock is there?")],
            max_tokens: 32,
            temperature: Some(0.0),
            top_p: None,
            tools: vec![ToolSpec {
                name: "read_stock".to_string(),
                description: "Read the stock level".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {"sku": {"type": "string"}},
                }),
            }],
            single_shot_tool: false,
            thinking: ThinkingMode::ProviderDefault,
        }
    }

    fn response(status: &str, output: Value, reason: Option<&str>) -> Response {
        serde_json::from_value(json!({
            "status": status,
            "model": "gpt-6-luna",
            "usage": {"input_tokens": 23, "output_tokens": 7},
            "incomplete_details": reason.map(|reason| json!({"reason": reason})),
            "output": output,
        }))
        .unwrap()
    }

    #[test]
    fn round_trips_function_call_and_result_by_call_id() {
        let mut req = request();
        let body = response(
            "completed",
            json!([{
                "type": "function_call",
                "id": "fc_item_id",
                "call_id": "call_stock",
                "name": "read_stock",
                "arguments": "{\"sku\":\"A42\"}",
                "status": "completed",
            }]),
            None,
        );
        let decoded = normalize(body, &req).unwrap();
        assert_eq!(decoded.input_tokens, 23);
        assert_eq!(decoded.output_tokens, 7);
        assert_eq!(decoded.termination, CompletionTermination::ToolCall);
        assert_eq!(decoded.tool_calls[0].id.as_deref(), Some("call_stock"));
        req.messages.push(decoded.to_assistant_message());
        req.messages.push(LlmMessage::ToolResult {
            tool_call_id: Some("call_stock".to_string()),
            name: "read_stock".to_string(),
            content: "{\"quantity\":10}".to_string(),
        });

        let next = payload(&req).unwrap();
        assert_eq!(next["store"], false);
        assert_eq!(next["reasoning"]["effort"], "none");
        assert_eq!(next["instructions"], req.system);
        assert_eq!(next["max_output_tokens"], 32);
        assert_eq!(next["temperature"], 0.0);
        assert!(next.get("top_p").is_none());
        assert_eq!(next["tools"][0]["strict"], false);
        assert_eq!(next["tools"][0]["name"], "read_stock");
        assert_eq!(
            next["input"][1],
            json!({"type": "function_call", "call_id": "call_stock",
                "name": "read_stock", "arguments": "{\"sku\":\"A42\"}"})
        );
        assert_eq!(
            next["input"][2],
            json!({"type": "function_call_output", "call_id": "call_stock",
                "output": "{\"quantity\":10}"})
        );
    }

    #[test]
    fn structured_requests_require_one_call() {
        let mut req = request();
        req.single_shot_tool = true;
        let body = payload(&req).unwrap();
        assert_eq!(body["tool_choice"], "required");
        assert_eq!(body["parallel_tool_calls"], false);
        req.tools.clear();
        assert!(validate_history(&req).is_err());
    }

    #[test]
    fn plain_text_completion_joins_text_and_keeps_usage() {
        let body = response(
            "completed",
            json!([{"type": "message", "content": [
                {"type": "output_text", "text": "10 units"},
                {"type": "output_text", "text": " available."},
            ]}]),
            None,
        );
        let result = normalize(body, &request()).unwrap();
        assert_eq!(result.text, "10 units available.");
        assert_eq!(result.output_tokens, 7);
        assert_eq!(result.termination, CompletionTermination::Complete);
    }

    #[test]
    fn refused_or_incomplete_responses_cannot_release_calls_or_text() {
        let call = json!({
            "type": "function_call",
            "call_id": "call_stock",
            "name": "read_stock",
            "arguments": "{}",
        });
        let req = request();
        let refusal = response(
            "completed",
            json!([call, {"type": "message", "content": [
                {"type": "output_text", "text": "partial result"},
                {"type": "refusal", "refusal": "I cannot answer that."},
            ]}]),
            None,
        );
        let result = normalize(refusal, &req).unwrap();
        assert_eq!(result.termination, CompletionTermination::Filtered);
        assert!(result.text.is_empty());
        assert!(result.tool_calls.is_empty());

        let incomplete = response("incomplete", json!([call]), Some("max_output_tokens"));
        let result = normalize(incomplete, &req).unwrap();
        assert_eq!(result.termination, CompletionTermination::Length);
        assert!(result.tool_calls.is_empty());
        assert_eq!(result.output_tokens, 7);
    }

    #[test]
    fn malformed_arguments_are_sanitized_and_rejected() {
        let body = response(
            "completed",
            json!([{"type": "function_call", "call_id": "call_stock",
                "name": "read_stock", "arguments": "{\"private\":"}]),
            None,
        );
        let result = normalize(body, &request()).unwrap();
        assert_eq!(result.tool_calls[0].arguments, Value::Null);
        assert_eq!(
            result.tool_calls[0].arguments_error.as_deref(),
            Some("malformed OpenAI function call arguments")
        );
    }

    #[test]
    fn refuses_a_different_model_or_missing_usage() {
        let mut wrong_model = response("completed", json!([]), None);
        wrong_model.model = "gpt-6-sol".to_string();
        assert!(normalize(wrong_model, &request()).is_err());

        let mut missing_usage = response("completed", json!([]), None);
        missing_usage.usage = None;
        assert!(normalize(missing_usage, &request()).is_err());
    }
}
