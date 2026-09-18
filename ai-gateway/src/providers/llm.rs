//! AIH-1 — LLM chat completions with tool-calling wire format.
//!
//! `LlmRequest` carries an optional `tools` list; when non-empty, Mistral and
//! Gemini payloads include the tool declarations and `tool_choice = "auto"`.
//! `LlmResponse` carries the resulting `tool_calls` (empty when the model
//! responded with plain text). Ollama has no tool-calling requirement and
//! always returns an empty `tool_calls` list; existing callers that leave
//! `tools` empty see no behavior change.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::config::Config;

// ── Public wire types ────────────────────────────────────────────────────────

/// A tool the model may call. `parameters` must be a valid JSON Schema object.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

/// A single tool invocation requested by the model.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolCallRequest {
    /// Provider-assigned call ID (OpenAI format) or a generated ID for Gemini.
    pub id: String,
    pub name: String,
    /// Parsed arguments object. Callers must validate against the tool schema.
    pub arguments: serde_json::Value,
}

#[derive(Clone, Debug)]
pub struct LlmMessage {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Debug, Default)]
pub struct LlmRequest {
    pub provider: String,
    pub model: String,
    pub system: String,
    pub messages: Vec<LlmMessage>,
    pub max_tokens: u32,
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    /// Tool declarations to send. Empty means plain-completion (no tool_choice).
    pub tools: Vec<ToolSpec>,
}

#[derive(Clone, Debug)]
pub struct LlmResponse {
    pub text: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub model: String,
    pub provider: String,
    /// Tool calls requested by the model. Empty when the response is plain text.
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
        for msg in &req.messages {
            messages.push(json!({"role": msg.role, "content": msg.content}));
        }
        let mut payload = json!({
            "model": req.model,
            "max_tokens": req.max_tokens,
            "temperature": req.temperature.unwrap_or(0.7),
            "top_p": req.top_p,
            "messages": messages,
        });
        if !req.tools.is_empty() {
            let specs: Vec<serde_json::Value> = req
                .tools
                .iter()
                .map(|t| {
                    json!({
                        "type": "function",
                        "function": {
                            "name": t.name,
                            "description": t.description,
                            "parameters": t.parameters,
                        }
                    })
                })
                .collect();
            payload["tools"] = json!(specs);
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
        let url = format!("{}/api/chat", self.ollama_url.trim_end_matches('/'));
        let model = if req.model.trim().is_empty() {
            self.ollama_llm_model.clone()
        } else {
            req.model.clone()
        };

        let mut messages = vec![json!({"role": "system", "content": req.system})];
        for msg in &req.messages {
            messages.push(json!({"role": msg.role, "content": msg.content}));
        }

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
            tool_calls: vec![],
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

        let mut contents = Vec::new();
        for msg in &req.messages {
            contents.push(json!({
                "role": if msg.role == "assistant" { "model" } else { "user" },
                "parts": [{ "text": msg.content }]
            }));
        }

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

        // Map ToolSpec → Gemini functionDeclarations.
        if !req.tools.is_empty() {
            let decls: Vec<serde_json::Value> = req
                .tools
                .iter()
                .map(|t| {
                    json!({
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    })
                })
                .collect();
            body["tools"] = json!([{ "functionDeclarations": decls }]);
            body["toolConfig"] = json!({ "functionCallingConfig": { "mode": "AUTO" } });
        }

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

        // A candidate's parts may contain text parts OR functionCall parts (not both).
        let first_content = parsed
            .candidates
            .as_ref()
            .and_then(|c| c.first())
            .and_then(|c| c.content.as_ref());

        let text = first_content
            .map(|c| {
                c.parts
                    .iter()
                    .filter_map(|p| p.text.as_deref())
                    .collect::<Vec<_>>()
                    .join("")
            })
            .unwrap_or_default();

        // Parse functionCall parts → ToolCallRequest.
        let tool_calls: Vec<ToolCallRequest> = first_content
            .map(|c| {
                c.parts
                    .iter()
                    .enumerate()
                    .filter_map(|(i, p)| {
                        p.function_call.as_ref().map(|fc| ToolCallRequest {
                            id: format!("gemini-call-{i}"),
                            name: fc.name.clone(),
                            arguments: fc.args.clone(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let usage = parsed.usage_metadata.unwrap_or_default();

        Ok(LlmResponse {
            text,
            input_tokens: usage.prompt_token_count.unwrap_or(0) as u32,
            output_tokens: usage.candidates_token_count.unwrap_or(0) as u32,
            model,
            provider: "gemini".to_string(),
            tool_calls,
        })
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
            .and_then(|c| c.first())
            .and_then(|c| c.message.as_ref());

        let text = first_message
            .and_then(|m| m.content.as_deref())
            .unwrap_or_default()
            .to_string();

        // Parse tool_calls from the message, if present.
        let tool_calls = first_message
            .and_then(|m| m.tool_calls.as_ref())
            .map(|calls| {
                calls
                    .iter()
                    .filter_map(|tc| {
                        let name = tc.function.name.clone();
                        let args = serde_json::from_str::<serde_json::Value>(
                            &tc.function.arguments,
                        )
                        .unwrap_or(serde_json::Value::Null);
                        Some(ToolCallRequest {
                            id: tc.id.clone(),
                            name,
                            arguments: args,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

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
    id: String,
    function: OpenAiToolCallFunction,
}

#[derive(Debug, Deserialize)]
struct OpenAiToolCallFunction {
    name: String,
    /// OpenAI serializes arguments as a JSON string, not an object.
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
    name: String,
    /// Gemini serializes arguments as a JSON object directly.
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
    use serde_json::json;

    fn dummy_client() -> LlmClient {
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

    // ── OpenAI/Mistral tool-call parsing ─────────────────────────────────────

    #[test]
    fn openai_tool_call_response_populates_tool_calls() {
        let raw = json!({
            "model": "mistral-large",
            "choices": [{
                "message": {
                    "content": null,
                    "tool_calls": [{
                        "id": "call_abc123",
                        "function": {
                            "name": "get_weather",
                            "arguments": "{\"location\":\"Paris\",\"unit\":\"celsius\"}"
                        }
                    }]
                }
            }],
            "usage": { "prompt_tokens": 42, "completion_tokens": 18 }
        });

        let body: OpenAiChatResponse = serde_json::from_value(raw).unwrap();
        let client = dummy_client();
        let resp = client.from_openai_response(body, "mistral", "mistral-large");

        assert_eq!(resp.tool_calls.len(), 1);
        let tc = &resp.tool_calls[0];
        assert_eq!(tc.id, "call_abc123");
        assert_eq!(tc.name, "get_weather");
        assert_eq!(tc.arguments["location"], "Paris");
        assert_eq!(tc.arguments["unit"], "celsius");
        assert_eq!(resp.text, "");
        assert_eq!(resp.input_tokens, 42);
        assert_eq!(resp.output_tokens, 18);
    }

    #[test]
    fn openai_plain_text_response_has_empty_tool_calls() {
        let raw = json!({
            "model": "mistral-large",
            "choices": [{
                "message": {
                    "content": "Hello, world!",
                    "tool_calls": null
                }
            }],
            "usage": { "prompt_tokens": 10, "completion_tokens": 5 }
        });

        let body: OpenAiChatResponse = serde_json::from_value(raw).unwrap();
        let client = dummy_client();
        let resp = client.from_openai_response(body, "mistral", "mistral-large");

        assert!(resp.tool_calls.is_empty());
        assert_eq!(resp.text, "Hello, world!");
    }

    // ── Gemini tool-call parsing ──────────────────────────────────────────────

    #[test]
    fn gemini_tool_call_response_populates_tool_calls() {
        let raw = json!({
            "candidates": [{
                "content": {
                    "parts": [{
                        "functionCall": {
                            "name": "search_docs",
                            "args": { "query": "SpacetimeDB reducers", "limit": 5 }
                        }
                    }]
                }
            }],
            "usageMetadata": {
                "promptTokenCount": 30,
                "candidatesTokenCount": 12
            }
        });

        let parsed: GeminiGenerateResponse = serde_json::from_value(raw).unwrap();

        let first_content = parsed
            .candidates
            .as_ref()
            .and_then(|c| c.first())
            .and_then(|c| c.content.as_ref());

        let tool_calls: Vec<ToolCallRequest> = first_content
            .map(|c| {
                c.parts
                    .iter()
                    .enumerate()
                    .filter_map(|(i, p)| {
                        p.function_call.as_ref().map(|fc| ToolCallRequest {
                            id: format!("gemini-call-{i}"),
                            name: fc.name.clone(),
                            arguments: fc.args.clone(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        assert_eq!(tool_calls.len(), 1);
        let tc = &tool_calls[0];
        assert_eq!(tc.id, "gemini-call-0");
        assert_eq!(tc.name, "search_docs");
        assert_eq!(tc.arguments["query"], "SpacetimeDB reducers");
        assert_eq!(tc.arguments["limit"], 5);
    }

    #[test]
    fn gemini_plain_text_response_has_empty_tool_calls() {
        let raw = json!({
            "candidates": [{
                "content": {
                    "parts": [{ "text": "Sure, here is the answer." }]
                }
            }],
            "usageMetadata": {
                "promptTokenCount": 8,
                "candidatesTokenCount": 6
            }
        });

        let parsed: GeminiGenerateResponse = serde_json::from_value(raw).unwrap();

        let first_content = parsed
            .candidates
            .as_ref()
            .and_then(|c| c.first())
            .and_then(|c| c.content.as_ref());

        let tool_calls: Vec<ToolCallRequest> = first_content
            .map(|c| {
                c.parts
                    .iter()
                    .enumerate()
                    .filter_map(|(i, p)| {
                        p.function_call.as_ref().map(|fc| ToolCallRequest {
                            id: format!("gemini-call-{i}"),
                            name: fc.name.clone(),
                            arguments: fc.args.clone(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        assert!(tool_calls.is_empty());
    }

    // ── openai_payload: tools included/excluded correctly ────────────────────

    #[test]
    fn openai_payload_includes_tools_when_non_empty() {
        let client = dummy_client();
        let req = LlmRequest {
            provider: "mistral".to_string(),
            model: "mistral-large".to_string(),
            system: "You are helpful.".to_string(),
            messages: vec![],
            max_tokens: 100,
            temperature: None,
            top_p: None,
            tools: vec![ToolSpec {
                name: "my_tool".to_string(),
                description: "Does something".to_string(),
                parameters: json!({ "type": "object", "properties": {} }),
            }],
        };

        let payload = client.openai_payload(&req);
        assert!(payload["tools"].is_array());
        assert_eq!(payload["tool_choice"], "auto");
        let tools = payload["tools"].as_array().unwrap();
        assert_eq!(tools[0]["function"]["name"], "my_tool");
    }

    #[test]
    fn openai_payload_omits_tools_when_empty() {
        let client = dummy_client();
        let req = LlmRequest {
            provider: "mistral".to_string(),
            model: "mistral-large".to_string(),
            system: "You are helpful.".to_string(),
            messages: vec![],
            max_tokens: 100,
            temperature: None,
            top_p: None,
            tools: vec![],
        };

        let payload = client.openai_payload(&req);
        assert!(payload.get("tools").is_none() || payload["tools"].is_null());
        assert!(payload.get("tool_choice").is_none() || payload["tool_choice"].is_null());
    }
}
