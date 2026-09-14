//! LLM chat completions via Kong AI Gateway (optional) or direct provider HTTP.

use anyhow::{Context, Result};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::config::Config;

#[derive(Clone, Debug, PartialEq)]
pub enum LlmMessage {
    Text {
        role: String,
        content: String,
    },
    AssistantToolCalls {
        content: Option<String>,
        tool_calls: Vec<ToolCallRequest>,
    },
    ToolResult {
        tool_call_id: Option<String>,
        name: String,
        content: String,
    },
}

impl LlmMessage {
    pub fn text(role: impl Into<String>, content: impl Into<String>) -> Self {
        Self::Text {
            role: role.into(),
            content: content.into(),
        }
    }
}

/// Provider-neutral description of a function that a model may call.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

/// A function call returned by an LLM provider.
///
/// OpenAI-compatible providers return a call id and JSON arguments encoded as
/// a string. Gemini returns structured arguments and does not provide an id.
/// Both are normalized to this representation so the orchestrator does not
/// need provider-specific parsing.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ToolCallRequest {
    pub id: Option<String>,
    pub name: String,
    pub arguments: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments_error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct LlmRequest {
    pub provider: String,
    pub model: String,
    pub system: String,
    pub messages: Vec<LlmMessage>,
    pub max_tokens: u32,
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub tools: Vec<ToolSpec>,
}

#[derive(Clone, Debug)]
pub struct LlmResponse {
    pub text: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub model: String,
    pub provider: String,
    pub tool_calls: Vec<ToolCallRequest>,
}

/// Routes chat completion to Kong (when configured) or direct Mistral/Gemini/Ollama APIs.
pub struct LlmClient {
    http: reqwest::Client,
    kong_url: Option<String>,
    kong_token: Option<String>,
    mistral_api_key: Option<String>,
    google_api_key: Option<String>,
    ollama_url: String,
    ollama_llm_model: String,
}

#[async_trait]
pub trait LlmCompletion: Send + Sync {
    async fn complete(&self, req: LlmRequest) -> Result<LlmResponse>;
}

#[async_trait]
impl LlmCompletion for LlmClient {
    async fn complete(&self, req: LlmRequest) -> Result<LlmResponse> {
        LlmClient::complete(self, req).await
    }
}

impl LlmClient {
    pub fn from_config(config: &Config) -> Result<Self> {
        Ok(LlmClient {
            http: reqwest::Client::new(),
            kong_url: config.kong_llm_url.clone(),
            kong_token: config.kong_llm_service_token.clone(),
            mistral_api_key: config.mistral_api_key.clone(),
            google_api_key: config.google_api_key.clone(),
            ollama_url: config.ollama_url.clone(),
            ollama_llm_model: config.ollama_llm_model.clone(),
        })
    }

    pub async fn complete(&self, req: LlmRequest) -> Result<LlmResponse> {
        if self.kong_url.is_some() {
            return self.complete_via_kong(&req).await;
        }
        self.complete_direct(&req).await
    }

    async fn complete_via_kong(&self, req: &LlmRequest) -> Result<LlmResponse> {
        let base = self
            .kong_url
            .as_deref()
            .context("KONG_LLM_URL not configured")?
            .trim_end_matches('/');
        let url = format!("{base}/v1/chat/completions");

        let mut request = self.http.post(&url).json(&self.openai_payload(req));
        if let Some(token) = &self.kong_token {
            request = request.header("Authorization", format!("Bearer {token}"));
        }

        let resp = request.send().await.context("Kong LLM request failed")?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Kong LLM error {status}: {body}");
        }

        let body: OpenAiChatResponse = resp.json().await.context("parse Kong LLM response")?;
        Ok(self.from_openai_response(body, &req.provider, &req.model))
    }

    async fn complete_direct(&self, req: &LlmRequest) -> Result<LlmResponse> {
        let provider = normalize_provider(&req.provider);
        match provider.as_str() {
            "mistral" => self.complete_mistral(req).await,
            "gemini" => self.complete_gemini(req).await,
            "ollama" => self.complete_ollama(req).await,
            other => {
                anyhow::bail!("Unsupported LLM provider '{other}'. Use Mistral, Gemini, or Ollama.")
            }
        }
    }

    fn openai_payload(&self, req: &LlmRequest) -> serde_json::Value {
        let mut messages = vec![json!({"role": "system", "content": req.system})];
        messages.extend(req.messages.iter().map(openai_message));
        let mut payload = json!({
            "model": req.model,
            "max_tokens": req.max_tokens,
            "temperature": req.temperature.unwrap_or(0.7),
            "top_p": req.top_p,
            "messages": messages,
        });

        // Keep the legacy plain-completion payload unchanged when no tools
        // are requested. Some Kong deployments reject an empty tools array.
        if !req.tools.is_empty() {
            payload["tools"] = json!(req
                .tools
                .iter()
                .map(|tool| {
                    json!({
                        "type": "function",
                        "function": {
                            "name": tool.name,
                            "description": tool.description,
                            "parameters": tool.parameters,
                        }
                    })
                })
                .collect::<Vec<_>>());
            payload["tool_choice"] = json!("auto");
        }

        payload
    }

    async fn complete_mistral(&self, req: &LlmRequest) -> Result<LlmResponse> {
        let key = self
            .mistral_api_key
            .as_deref()
            .context("MISTRAL_API_KEY required for Mistral agent")?;

        let resp = self
            .http
            .post("https://api.mistral.ai/v1/chat/completions")
            .bearer_auth(key)
            .json(&self.openai_payload(req))
            .send()
            .await
            .context("Mistral chat request failed")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Mistral error {status}: {body}");
        }

        let body: OpenAiChatResponse = resp.json().await.context("parse Mistral response")?;
        Ok(self.from_openai_response(body, "mistral", &req.model))
    }

    async fn complete_ollama(&self, req: &LlmRequest) -> Result<LlmResponse> {
        if !req.tools.is_empty() {
            anyhow::bail!(
                "Ollama tool calling is not admitted; select the explicit single-shot path"
            );
        }

        let url = format!("{}/api/chat", self.ollama_url.trim_end_matches('/'));
        let model = if req.model.trim().is_empty() {
            self.ollama_llm_model.clone()
        } else {
            req.model.clone()
        };

        let mut messages = vec![json!({"role": "system", "content": req.system})];
        messages.extend(req.messages.iter().map(openai_message));

        let body = json!({
            "model": model,
            "stream": false,
            "messages": messages,
            "options": {
                "temperature": req.temperature.unwrap_or(0.7),
                "num_predict": req.max_tokens,
            }
        });

        let resp = self
            .http
            .post(&url)
            .json(&body)
            .send()
            .await
            .context("Ollama chat request failed")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("Ollama error {status}: {text}");
        }

        let parsed: OllamaChatResponse = resp.json().await.context("parse Ollama response")?;
        let text = parsed.message.and_then(|m| m.content).unwrap_or_default();

        Ok(LlmResponse {
            text,
            input_tokens: parsed.prompt_eval_count.unwrap_or(0) as u32,
            output_tokens: parsed.eval_count.unwrap_or(0) as u32,
            model,
            provider: "ollama".to_string(),
            tool_calls: Vec::new(),
        })
    }

    async fn complete_gemini(&self, req: &LlmRequest) -> Result<LlmResponse> {
        let key = self
            .google_api_key
            .as_deref()
            .context("GOOGLE_API_KEY required for Gemini agent")?;

        let model = if req.model.trim().is_empty() {
            "gemini-2.0-flash".to_string()
        } else {
            req.model.clone()
        };

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
        );

        let body = self.gemini_payload(req);

        let resp = self
            .http
            .post(&url)
            .json(&body)
            .send()
            .await
            .context("Gemini chat request failed")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("Gemini error {status}: {text}");
        }

        let parsed: GeminiGenerateResponse = resp.json().await.context("parse Gemini response")?;
        Ok(Self::from_gemini_response(parsed, model))
    }

    fn gemini_payload(&self, req: &LlmRequest) -> serde_json::Value {
        let contents = req.messages.iter().map(gemini_message).collect::<Vec<_>>();
        let mut body = json!({
            "systemInstruction": {
                "parts": [{ "text": req.system }]
            },
            "contents": contents,
            "generationConfig": {
                "maxOutputTokens": req.max_tokens,
                "temperature": req.temperature.unwrap_or(0.7),
                "topP": req.top_p,
            }
        });

        if !req.tools.is_empty() {
            body["tools"] = json!([{
                "functionDeclarations": req.tools.iter().map(|tool| {
                    json!({
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.parameters,
                    })
                }).collect::<Vec<_>>()
            }]);
        }

        body
    }

    fn from_gemini_response(body: GeminiGenerateResponse, model: String) -> LlmResponse {
        let first_candidate = body
            .candidates
            .as_ref()
            .and_then(|candidates| candidates.first());
        let text = first_candidate
            .and_then(|candidate| candidate.content.as_ref())
            .and_then(|content| content.parts.iter().find_map(|part| part.text.clone()))
            .unwrap_or_default();
        let usage = body.usage_metadata.unwrap_or_default();
        let tool_calls = first_candidate
            .into_iter()
            .flat_map(|candidate| candidate.content.as_ref())
            .flat_map(|content| content.parts.iter())
            .filter_map(|part| part.function_call.as_ref())
            .map(|call| ToolCallRequest {
                id: call.id.clone(),
                name: call.name.clone(),
                arguments: call.args.clone(),
                arguments_error: None,
            })
            .collect();

        LlmResponse {
            text,
            input_tokens: usage.prompt_token_count.unwrap_or(0) as u32,
            output_tokens: usage.candidates_token_count.unwrap_or(0) as u32,
            model,
            provider: "gemini".to_string(),
            tool_calls,
        }
    }

    fn from_openai_response(
        &self,
        body: OpenAiChatResponse,
        provider: &str,
        model: &str,
    ) -> LlmResponse {
        let first_message = body
            .choices
            .as_ref()
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.message.as_ref());
        let text = first_message
            .and_then(|message| message.content.clone())
            .unwrap_or_default();

        let tool_calls = first_message
            .into_iter()
            .flat_map(|message| message.tool_calls.as_ref())
            .flatten()
            .map(|call| {
                let (arguments, arguments_error) =
                    match serde_json::from_str(&call.function.arguments) {
                        Ok(arguments) => (arguments, None),
                        Err(error) => (serde_json::Value::Null, Some(error.to_string())),
                    };
                ToolCallRequest {
                    id: call.id.clone(),
                    name: call.function.name.clone(),
                    arguments,
                    arguments_error,
                }
            })
            .collect();

        let (input_tokens, output_tokens) = body
            .usage
            .map(|u| {
                (
                    u.prompt_tokens.unwrap_or(0),
                    u.completion_tokens.unwrap_or(0),
                )
            })
            .unwrap_or((0, 0));

        LlmResponse {
            text,
            input_tokens,
            output_tokens,
            model: body.model.unwrap_or_else(|| model.to_string()),
            provider: provider.to_string(),
            tool_calls,
        }
    }
}

fn openai_message(message: &LlmMessage) -> serde_json::Value {
    match message {
        LlmMessage::Text { role, content } => json!({"role": role, "content": content}),
        LlmMessage::AssistantToolCalls {
            content,
            tool_calls,
        } => json!({
            "role": "assistant",
            "content": content,
            "tool_calls": tool_calls.iter().map(|call| json!({
                "id": call.id,
                "type": "function",
                "function": {
                    "name": call.name,
                    "arguments": serde_json::to_string(&call.arguments)
                        .unwrap_or_else(|_| "null".to_string()),
                }
            })).collect::<Vec<_>>()
        }),
        LlmMessage::ToolResult {
            tool_call_id,
            name,
            content,
        } => json!({
            "role": "tool",
            "tool_call_id": tool_call_id,
            "name": name,
            "content": content,
        }),
    }
}

fn gemini_message(message: &LlmMessage) -> serde_json::Value {
    match message {
        LlmMessage::Text { role, content } => json!({
            "role": if role == "assistant" { "model" } else { "user" },
            "parts": [{ "text": content }]
        }),
        LlmMessage::AssistantToolCalls {
            content,
            tool_calls,
        } => {
            let mut parts = Vec::with_capacity(tool_calls.len() + usize::from(content.is_some()));
            if let Some(text) = content {
                parts.push(json!({"text": text}));
            }
            parts.extend(tool_calls.iter().map(|call| {
                json!({
                    "functionCall": {
                        "name": call.name,
                        "args": call.arguments,
                    }
                })
            }));
            json!({"role": "model", "parts": parts})
        }
        LlmMessage::ToolResult { name, content, .. } => {
            let response = serde_json::from_str::<serde_json::Value>(content)
                .unwrap_or_else(|_| json!({"result": content}));
            json!({
                "role": "user",
                "parts": [{
                    "functionResponse": {
                        "name": name,
                        "response": response,
                    }
                }]
            })
        }
    }
}

pub fn normalize_provider(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "mistral" => "mistral".to_string(),
        "google" | "gemini" | "google gemini" => "gemini".to_string(),
        "ollama" => "ollama".to_string(),
        other => other.to_string(),
    }
}

#[derive(Debug, Deserialize)]
struct OpenAiChatResponse {
    model: Option<String>,
    choices: Option<Vec<OpenAiChoice>>,
    usage: Option<OpenAiUsage>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: Option<OpenAiMessage>,
}

#[derive(Debug, Deserialize)]
struct OpenAiMessage {
    content: Option<String>,
    tool_calls: Option<Vec<OpenAiToolCall>>,
}

#[derive(Debug, Deserialize)]
struct OpenAiToolCall {
    id: Option<String>,
    function: OpenAiFunctionCall,
}

#[derive(Debug, Deserialize)]
struct OpenAiFunctionCall {
    name: String,
    arguments: String,
}

#[derive(Debug, Deserialize)]
struct OpenAiUsage {
    prompt_tokens: Option<u32>,
    completion_tokens: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct OllamaChatResponse {
    message: Option<OllamaMessage>,
    prompt_eval_count: Option<u64>,
    eval_count: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct OllamaMessage {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GeminiGenerateResponse {
    candidates: Option<Vec<GeminiCandidate>>,
    #[serde(rename = "usageMetadata")]
    usage_metadata: Option<GeminiUsageMetadata>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiContent>,
}

#[derive(Debug, Deserialize)]
struct GeminiContent {
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Deserialize)]
struct GeminiPart {
    text: Option<String>,
    #[serde(rename = "functionCall")]
    function_call: Option<GeminiFunctionCall>,
}

#[derive(Debug, Deserialize)]
struct GeminiFunctionCall {
    id: Option<String>,
    name: String,
    #[serde(default)]
    args: serde_json::Value,
}

#[derive(Debug, Default, Deserialize)]
struct GeminiUsageMetadata {
    #[serde(rename = "promptTokenCount")]
    prompt_token_count: Option<u64>,
    #[serde(rename = "candidatesTokenCount")]
    candidates_token_count: Option<u64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client() -> LlmClient {
        LlmClient {
            http: reqwest::Client::new(),
            kong_url: None,
            kong_token: None,
            mistral_api_key: None,
            google_api_key: None,
            ollama_url: "http://localhost:11434".to_string(),
            ollama_llm_model: "llama3".to_string(),
        }
    }

    fn request(tools: Vec<ToolSpec>) -> LlmRequest {
        LlmRequest {
            provider: "mistral".to_string(),
            model: "mistral-large-latest".to_string(),
            system: "Use tools when needed.".to_string(),
            messages: vec![LlmMessage::text("user", "Find the stock level.")],
            max_tokens: 256,
            temperature: Some(0.2),
            top_p: Some(0.9),
            tools,
        }
    }

    fn stock_tool() -> ToolSpec {
        ToolSpec {
            name: "erp_snapshot".to_string(),
            description: "Read an authorized ERP snapshot.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "entity_id": { "type": "integer" }
                },
                "required": ["entity_id"]
            }),
        }
    }

    #[test]
    fn empty_tools_preserve_plain_openai_payload() {
        let payload = client().openai_payload(&request(Vec::new()));

        assert!(payload.get("tools").is_none());
        assert!(payload.get("tool_choice").is_none());
        assert_eq!(payload["messages"][0]["role"], "system");
    }

    #[test]
    fn openai_payload_declares_function_tools() {
        let payload = client().openai_payload(&request(vec![stock_tool()]));

        assert_eq!(payload["tool_choice"], "auto");
        assert_eq!(payload["tools"][0]["type"], "function");
        assert_eq!(payload["tools"][0]["function"]["name"], "erp_snapshot");
        assert_eq!(
            payload["tools"][0]["function"]["parameters"]["required"][0],
            "entity_id"
        );
    }

    #[test]
    fn openai_payload_round_trips_tool_transcript() {
        let mut req = request(vec![stock_tool()]);
        req.messages.push(LlmMessage::AssistantToolCalls {
            content: None,
            tool_calls: vec![ToolCallRequest {
                id: Some("call_123".to_string()),
                name: "erp_snapshot".to_string(),
                arguments: json!({"entity_id": 42}),
                arguments_error: None,
            }],
        });
        req.messages.push(LlmMessage::ToolResult {
            tool_call_id: Some("call_123".to_string()),
            name: "erp_snapshot".to_string(),
            content: "{\"stock\":7}".to_string(),
        });

        let payload = client().openai_payload(&req);

        assert_eq!(payload["messages"][2]["role"], "assistant");
        assert_eq!(
            payload["messages"][2]["tool_calls"][0]["function"]["arguments"],
            "{\"entity_id\":42}"
        );
        assert_eq!(payload["messages"][3]["role"], "tool");
        assert_eq!(payload["messages"][3]["tool_call_id"], "call_123");
    }

    #[test]
    fn mistral_fixture_populates_tool_calls() {
        let body: OpenAiChatResponse = serde_json::from_value(json!({
            "model": "mistral-large-latest",
            "choices": [{
                "message": {
                    "content": null,
                    "tool_calls": [{
                        "id": "call_123",
                        "type": "function",
                        "function": {
                            "name": "erp_snapshot",
                            "arguments": "{\"entity_id\":42}"
                        }
                    }]
                }
            }],
            "usage": { "prompt_tokens": 19, "completion_tokens": 7 }
        }))
        .expect("valid OpenAI-compatible fixture");

        let response = client().from_openai_response(body, "mistral", "mistral-large-latest");

        assert_eq!(response.text, "");
        assert_eq!(response.input_tokens, 19);
        assert_eq!(response.output_tokens, 7);
        assert_eq!(response.tool_calls.len(), 1);
        assert_eq!(response.tool_calls[0].id.as_deref(), Some("call_123"));
        assert_eq!(response.tool_calls[0].name, "erp_snapshot");
        assert_eq!(response.tool_calls[0].arguments, json!({ "entity_id": 42 }));
        assert_eq!(response.tool_calls[0].arguments_error, None);
    }

    #[test]
    fn malformed_openai_tool_arguments_remain_explicitly_invalid() {
        let body: OpenAiChatResponse = serde_json::from_value(json!({
            "choices": [{
                "message": {
                    "tool_calls": [{
                        "id": "call_bad",
                        "function": {
                            "name": "erp_snapshot",
                            "arguments": "{not-json"
                        }
                    }]
                }
            }]
        }))
        .expect("valid response envelope");

        let response = client().from_openai_response(body, "mistral", "model");

        assert_eq!(response.tool_calls[0].arguments, serde_json::Value::Null);
        assert!(response.tool_calls[0].arguments_error.is_some());
    }

    #[test]
    fn gemini_fixture_populates_function_calls() {
        let body: GeminiGenerateResponse = serde_json::from_value(json!({
            "candidates": [{
                "content": {
                    "parts": [{
                        "functionCall": {
                            "id": "gemini-call-42",
                            "name": "erp_snapshot",
                            "args": { "entity_id": 42 }
                        }
                    }]
                }
            }],
            "usageMetadata": {
                "promptTokenCount": 23,
                "candidatesTokenCount": 9
            }
        }))
        .expect("valid Gemini fixture");

        let response = LlmClient::from_gemini_response(body, "gemini-2.0-flash".to_string());

        assert_eq!(response.provider, "gemini");
        assert_eq!(response.input_tokens, 23);
        assert_eq!(response.output_tokens, 9);
        assert_eq!(response.tool_calls.len(), 1);
        assert_eq!(response.tool_calls[0].id.as_deref(), Some("gemini-call-42"));
        assert_eq!(response.tool_calls[0].name, "erp_snapshot");
        assert_eq!(response.tool_calls[0].arguments, json!({ "entity_id": 42 }));
    }

    #[test]
    fn gemini_payload_declares_function_tools() {
        let req = request(vec![stock_tool()]);
        let body = client().gemini_payload(&req);

        assert_eq!(
            body["tools"][0]["functionDeclarations"][0]["name"],
            "erp_snapshot"
        );
        assert_eq!(
            body["tools"][0]["functionDeclarations"][0]["parameters"]["type"],
            "object"
        );
    }

    #[test]
    fn gemini_payload_round_trips_tool_transcript() {
        let mut req = request(vec![stock_tool()]);
        req.messages.push(LlmMessage::AssistantToolCalls {
            content: None,
            tool_calls: vec![ToolCallRequest {
                id: None,
                name: "erp_snapshot".to_string(),
                arguments: json!({"entity_id": 42}),
                arguments_error: None,
            }],
        });
        req.messages.push(LlmMessage::ToolResult {
            tool_call_id: None,
            name: "erp_snapshot".to_string(),
            content: "{\"stock\":7}".to_string(),
        });

        let body = client().gemini_payload(&req);

        assert_eq!(
            body["contents"][1]["parts"][0]["functionCall"]["name"],
            "erp_snapshot"
        );
        assert_eq!(
            body["contents"][2]["parts"][0]["functionResponse"]["response"]["stock"],
            7
        );
    }

    #[tokio::test]
    async fn ollama_rejects_tool_enabled_requests_before_network_dispatch() {
        let error = client()
            .complete_ollama(&request(vec![stock_tool()]))
            .await
            .expect_err("tool-enabled Ollama requests must fail closed");

        assert!(error.to_string().contains("single-shot"));
    }
}
