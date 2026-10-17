//! LLM chat completions via Kong AI Gateway (optional) or direct provider HTTP.

use anyhow::{Context, Result};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::config::{Config, MistralReasoningEffort};

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
    MistralAssistant(MistralAssistantReplay),
    ToolResult {
        tool_call_id: Option<String>,
        name: String,
        content: String,
    },
}

/// Ephemeral native assistant state. Deliberately has no serde implementation:
/// signatures and private thinking must never enter persisted chat history.
#[derive(Clone, PartialEq)]
pub struct MistralAssistantReplay {
    requested_model: String,
    resolved_model: String,
    native: serde_json::Value,
    bytes: usize,
    visible: Box<LlmMessage>,
}

impl std::fmt::Debug for MistralAssistantReplay {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MistralAssistantReplay")
            .field("bytes", &self.bytes)
            .finish_non_exhaustive()
    }
}

const MAX_MISTRAL_REPLAY_BYTES: usize = 1024 * 1024;

impl LlmMessage {
    /// Bytes of opaque native history included in a matching direct request.
    /// Callers must include these bytes in prompt admission/spend estimation.
    pub fn mistral_replay_bytes(&self, provider: &str, model: &str) -> Result<usize> {
        match self {
            Self::MistralAssistant(replay) => {
                anyhow::ensure!(normalize_provider(provider) == "mistral" && replay.requested_model == model,
                    "Mistral assistant replay requires its original direct provider and requested model");
                Ok(replay.bytes)
            }
            _ => Ok(0),
        }
    }

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
/// Providers may return JSON arguments as a string or an object, with an
/// optional call id. Both argument forms normalize to this representation so
/// the orchestrator does not need provider-specific parsing.
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
    /// Allow one exact schema response without native provider tool calls.
    /// Typed intelligence adapters opt in; agent-loop requests do not.
    pub single_shot_tool: bool,
    /// Provider-visible thinking control. Only transports with an explicit
    /// control apply it; other transports leave their request unchanged.
    pub thinking: ThinkingMode,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ThinkingMode {
    #[default]
    ProviderDefault,
    Enabled,
    Disabled,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum CompletionTermination {
    Complete,
    Length,
    ToolCall,
    Filtered,
    #[default]
    Unknown,
}

#[derive(Clone, Debug)]
pub struct LlmResponse {
    pub text: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub model: String,
    pub provider: String,
    pub tool_calls: Vec<ToolCallRequest>,
    /// Provider-neutral terminal classification plus the provider's bounded
    /// reason label. Neither field contains model-authored reasoning text.
    pub termination: CompletionTermination,
    pub provider_done_reason: Option<String>,
    /// Whether the provider returned a nonempty thinking channel. Private native
    /// content is retained only in bounded, ephemeral Mistral replay.
    pub thinking_observed: bool,
    pub mistral_replay: Option<MistralAssistantReplay>,
}

impl LlmResponse {
    /// Preserve native Mistral assistant state for an in-memory continuation.
    pub fn to_assistant_message(&self) -> LlmMessage {
        if let Some(replay) = &self.mistral_replay {
            // Public normalized response fields may have been transformed by a
            // caller. Fall back to visible history rather than replay stale
            // native calls/content; resolved aliases are compared separately
            // from the requested model used for continuation binding.
            if normalize_provider(&self.provider) == "mistral"
                && self.model == replay.resolved_model
                && matches!(
                    self.termination,
                    CompletionTermination::Complete | CompletionTermination::ToolCall
                )
                && self.visible_assistant_message() == *replay.visible
            {
                return LlmMessage::MistralAssistant(replay.clone());
            }
        }
        self.visible_assistant_message()
    }

    fn visible_assistant_message(&self) -> LlmMessage {
        if self.tool_calls.is_empty() {
            LlmMessage::text("assistant", self.text.clone())
        } else {
            LlmMessage::AssistantToolCalls {
                content: (!self.text.is_empty()).then(|| self.text.clone()),
                tool_calls: self.tool_calls.clone(),
            }
        }
    }

    pub fn exhausted_before_content(&self) -> bool {
        self.termination == CompletionTermination::Length
            && self.text.trim().is_empty()
            && !self
                .tool_calls
                .iter()
                .any(|call| call.arguments_error.is_none())
    }

    pub fn thinking_exhausted_before_content(&self) -> bool {
        self.exhausted_before_content() && self.thinking_observed
    }
}

/// Routes chat completion to Kong (when configured) or direct Mistral/Gemini/Ollama APIs.
pub struct LlmClient {
    http: reqwest::Client,
    kong_url: Option<String>,
    kong_token: Option<String>,
    mistral_api_key: Option<String>,
    mistral_reasoning_effort: Option<MistralReasoningEffort>,
    mistral_reasoning_models: Vec<String>,
    google_api_key: Option<String>,
    ollama_url: String,
    ollama_llm_model: String,
}

#[async_trait]
pub trait LlmCompletion: Send + Sync {
    fn validate_request(&self, _req: &LlmRequest) -> Result<()> {
        Ok(())
    }
    async fn complete(&self, req: LlmRequest) -> Result<LlmResponse>;
}

#[async_trait]
impl LlmCompletion for LlmClient {
    fn validate_request(&self, req: &LlmRequest) -> Result<()> {
        LlmClient::validate_request(self, req)
    }
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
            mistral_reasoning_effort: config.mistral_reasoning_effort,
            mistral_reasoning_models: config.mistral_reasoning_models.clone(),
            google_api_key: config.google_api_key.clone(),
            ollama_url: config.ollama_url.clone(),
            ollama_llm_model: config.ollama_llm_model.clone(),
        })
    }

    pub fn validate_request(&self, req: &LlmRequest) -> Result<()> {
        let mut replay_bytes = 0usize;
        for message in &req.messages {
            replay_bytes = replay_bytes
                .checked_add(message.mistral_replay_bytes(&req.provider, &req.model)?)
                .context("Mistral assistant replay history exceeds its byte limit")?;
            anyhow::ensure!(
                replay_bytes <= MAX_MISTRAL_REPLAY_BYTES,
                "Mistral assistant replay history exceeds its byte limit"
            );
            anyhow::ensure!(
                self.kong_url.is_none() || !matches!(message, LlmMessage::MistralAssistant(_)),
                "Mistral assistant replay cannot be sent through Kong"
            );
        }
        if self.kong_url.is_none() && normalize_provider(&req.provider) == "mistral" {
            anyhow::ensure!(
                req.thinking != ThinkingMode::Enabled
                    || self
                        .mistral_reasoning_models
                        .iter()
                        .any(|model| model == &req.model),
                "Mistral reasoning is not enabled for this exact model ID"
            );
        }
        Ok(())
    }

    pub async fn complete(&self, req: LlmRequest) -> Result<LlmResponse> {
        self.validate_request(&req)?;
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

    fn mistral_payload(&self, req: &LlmRequest) -> serde_json::Value {
        let mut payload = self.openai_payload(req);
        let mut messages = vec![json!({"role": "system", "content": req.system})];
        messages.extend(req.messages.iter().map(|message| match message {
            LlmMessage::MistralAssistant(replay) if replay.requested_model == req.model => {
                replay.native.clone()
            }
            _ => openai_message(message),
        }));
        payload["messages"] = json!(messages);
        if self
            .mistral_reasoning_models
            .iter()
            .any(|model| model == &req.model)
        {
            let effort = match req.thinking {
                ThinkingMode::Enabled => Some(MistralReasoningEffort::High),
                ThinkingMode::Disabled => Some(MistralReasoningEffort::None),
                ThinkingMode::ProviderDefault => self.mistral_reasoning_effort,
            };
            if let Some(effort) = effort {
                payload["reasoning_effort"] = json!(effort.as_str());
            }
        }
        if req.single_shot_tool && !req.tools.is_empty() {
            // Typed decision/reasoning adapters require exactly one outcome.
            // Mistral's default "auto" may return prose or multiple calls.
            payload["tool_choice"] = json!("any");
            payload["parallel_tool_calls"] = json!(false);
        }
        payload
    }

    async fn complete_mistral(&self, req: &LlmRequest) -> Result<LlmResponse> {
        anyhow::ensure!(
            req.thinking != ThinkingMode::Enabled
                || self
                    .mistral_reasoning_models
                    .iter()
                    .any(|model| model == &req.model),
            "Mistral reasoning is not enabled for this exact model ID"
        );
        let key = self
            .mistral_api_key
            .as_deref()
            .context("MISTRAL_API_KEY required for Mistral agent")?;

        let resp = self
            .http
            .post("https://api.mistral.ai/v1/chat/completions")
            .bearer_auth(key)
            .json(&self.mistral_payload(req))
            .send()
            .await
            .context("Mistral chat request failed")?;

        // Error bodies may echo signed/private history. Never read or attach
        // them to errors: the spend layer persists provider error messages.
        check_mistral_status(resp.status())?;
        let body = resp
            .json()
            .await
            .map_err(|_| anyhow::anyhow!("invalid Mistral response envelope"))?;
        decode_mistral_response(body, &req.model)
    }

    async fn complete_ollama(&self, req: &LlmRequest) -> Result<LlmResponse> {
        // Native tool calling is admitted only through the model profile's
        // explicit OLLAMA_SUPPORTS_TOOL_CALLING opt-in; the transport itself
        // serves both native tools and the single-shot schema path.
        if req.single_shot_tool && req.tools.is_empty() {
            anyhow::bail!("Ollama single-shot completion requires at least one output schema");
        }

        let url = format!("{}/api/chat", self.ollama_url.trim_end_matches('/'));
        let model = if req.model.trim().is_empty() {
            self.ollama_llm_model.clone()
        } else {
            req.model.clone()
        };

        let body = self.ollama_payload(req, &model);

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
        Ok(Self::from_ollama_response(parsed, req, model))
    }

    fn ollama_payload(&self, req: &LlmRequest, model: &str) -> serde_json::Value {
        let mut messages = vec![json!({"role": "system", "content": req.system})];
        messages.extend(req.messages.iter().map(ollama_message));
        let mut body = json!({
            "model": model,
            "stream": false,
            "messages": messages,
            "options": {
                "temperature": req.temperature.unwrap_or(0.7),
                "num_predict": req.max_tokens,
            }
        });
        match req.thinking {
            ThinkingMode::ProviderDefault => {}
            ThinkingMode::Enabled => body["think"] = json!(true),
            ThinkingMode::Disabled => body["think"] = json!(false),
        }
        if req.single_shot_tool {
            body["format"] = ollama_output_schema(&req.tools);
        } else if !req.tools.is_empty() {
            body["tools"] = json!(req
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
        }
        body
    }

    fn from_ollama_response(
        parsed: OllamaChatResponse,
        req: &LlmRequest,
        model: String,
    ) -> LlmResponse {
        let (text, thinking_observed, native_tool_calls) = parsed
            .message
            .map(|message| {
                (
                    message.content.unwrap_or_default(),
                    message
                        .thinking
                        .is_some_and(|thinking| !thinking.trim().is_empty()),
                    message.tool_calls.unwrap_or_default(),
                )
            })
            .unwrap_or_default();
        let tool_calls = if req.single_shot_tool {
            ollama_tool_calls(&req.tools, &text)
        } else {
            native_tool_calls
                .into_iter()
                .map(|call| ToolCallRequest {
                    id: call.id,
                    name: call.function.name,
                    arguments: call.function.arguments,
                    arguments_error: None,
                })
                .collect()
        };
        let (termination, provider_done_reason) = completion_termination(parsed.done_reason);
        LlmResponse {
            text,
            input_tokens: parsed.prompt_eval_count.unwrap_or(0) as u32,
            output_tokens: parsed.eval_count.unwrap_or(0) as u32,
            model,
            provider: "ollama".to_string(),
            tool_calls,
            termination,
            provider_done_reason,
            thinking_observed,
            mistral_replay: None,
        }
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
        let (termination, provider_done_reason) = completion_termination(
            first_candidate.and_then(|candidate| candidate.finish_reason.clone()),
        );

        LlmResponse {
            text,
            input_tokens: usage.prompt_token_count.unwrap_or(0) as u32,
            output_tokens: usage.candidates_token_count.unwrap_or(0) as u32,
            model,
            provider: "gemini".to_string(),
            tool_calls,
            termination,
            provider_done_reason,
            thinking_observed: false,
            mistral_replay: None,
        }
    }

    fn from_openai_response(
        &self,
        body: OpenAiChatResponse,
        provider: &str,
        model: &str,
    ) -> LlmResponse {
        normalize_openai_response(body, provider, model, false)
    }
}

fn check_mistral_status(status: reqwest::StatusCode) -> Result<()> {
    anyhow::ensure!(
        status.is_success(),
        "Mistral request failed with HTTP {status}"
    );
    Ok(())
}

/// Decode direct Mistral responses without exposing a constructor for native
/// replay. The requested model binds opaque state even when the API resolves an alias.
pub(crate) fn decode_mistral_response(
    body: serde_json::Value,
    requested_model: &str,
) -> Result<LlmResponse> {
    // serde error chains can quote offending provider-controlled values.
    let body = serde_json::from_value(body)
        .map_err(|_| anyhow::anyhow!("invalid Mistral response envelope"))?;
    Ok(normalize_openai_response(
        body,
        "mistral",
        requested_model,
        true,
    ))
}

fn normalize_openai_response(
    body: OpenAiChatResponse,
    provider: &str,
    model: &str,
    native_mistral: bool,
) -> LlmResponse {
    let first_message = body
        .choices
        .as_ref()
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.message.as_ref());
    let (text, thinking_observed) = first_message
        .and_then(|message| message.content.as_ref())
        .map(OpenAiContent::visible_text)
        .unwrap_or_default();

    let tool_calls = first_message
        .into_iter()
        .flat_map(|message| message.tool_calls.as_ref())
        .flatten()
        .map(|call| {
            let (arguments, arguments_error) = match &call.function.arguments {
                OpenAiFunctionArguments::Json(encoded) => match serde_json::from_str(encoded) {
                    Ok(arguments) => (arguments, None),
                    Err(error) => (serde_json::Value::Null, Some(error.to_string())),
                },
                OpenAiFunctionArguments::Object(arguments) => {
                    (serde_json::Value::Object(arguments.clone()), None)
                }
            };
            ToolCallRequest {
                id: call.id.clone(),
                name: call.function.name.clone(),
                arguments,
                arguments_error,
            }
        })
        .collect();

    let native = first_message.map(|message| message.native.clone());
    let (input_tokens, output_tokens) = body
        .usage
        .map(|u| {
            (
                u.prompt_tokens.unwrap_or(0),
                u.completion_tokens.unwrap_or(0),
            )
        })
        .unwrap_or((0, 0));
    let (termination, provider_done_reason) = completion_termination(
        body.choices
            .as_ref()
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.finish_reason.clone()),
    );

    let mut response = LlmResponse {
        text,
        input_tokens,
        output_tokens,
        model: body.model.unwrap_or_else(|| model.to_string()),
        provider: provider.to_string(),
        tool_calls,
        termination,
        provider_done_reason,
        thinking_observed,
        mistral_replay: None,
    };
    // Native replay is needed only for thinking protocol state, including
    // signed/closed thinking chunks with no text. Ordinary/empty assistant
    // responses keep using the normalized history representation.
    let has_native_thinking = native
        .as_ref()
        .and_then(|message| message.get("content"))
        .and_then(serde_json::Value::as_array)
        .is_some_and(|chunks| {
            chunks.iter().any(|chunk| {
                chunk.get("type").and_then(serde_json::Value::as_str) == Some("thinking")
            })
        });
    if native_mistral
        && has_native_thinking
        && normalize_provider(provider) == "mistral"
        && matches!(
            termination,
            CompletionTermination::Complete | CompletionTermination::ToolCall
        )
        && response.tool_calls.iter().all(|call| {
            call.arguments_error.is_none()
                && call.arguments.is_object()
                && !call.name.trim().is_empty()
                && call.id.as_ref().is_some_and(|id| {
                    id.len() == 9 && id.bytes().all(|byte| byte.is_ascii_alphanumeric())
                })
        })
    {
        if let Some(mut native) = native {
            // Response arguments may be objects, but native assistant request
            // arguments are JSON strings in Mistral's SDK and OpenCode.
            if let Some(calls) = native
                .get_mut("tool_calls")
                .and_then(serde_json::Value::as_array_mut)
            {
                for call in calls {
                    if let Some(arguments) = call
                        .get_mut("function")
                        .and_then(|function| function.get_mut("arguments"))
                    {
                        if arguments.is_object() {
                            *arguments = json!(serde_json::to_string(arguments)
                                .unwrap_or_else(|_| "null".to_string()));
                        }
                    }
                }
            }
            // Omit the whole native message when oversized; never truncate
            // signed thinking blocks or replay partial/truncated responses.
            if let Ok(encoded) = serde_json::to_vec(&native) {
                if encoded.len() <= MAX_MISTRAL_REPLAY_BYTES {
                    response.mistral_replay = Some(MistralAssistantReplay {
                        requested_model: model.to_string(),
                        resolved_model: response.model.clone(),
                        bytes: encoded.len(),
                        native,
                        visible: Box::new(response.visible_assistant_message()),
                    });
                }
            }
        }
    }
    response
}

fn ollama_output_schema(tools: &[ToolSpec]) -> serde_json::Value {
    if let [tool] = tools {
        return tool.parameters.clone();
    }
    json!({
        "oneOf": tools.iter().map(|tool| json!({
            "type": "object",
            "properties": {
                "name": {"const": tool.name},
                "arguments": tool.parameters,
            },
            "required": ["name", "arguments"],
            "additionalProperties": false,
        })).collect::<Vec<_>>()
    })
}

fn ollama_tool_calls(tools: &[ToolSpec], text: &str) -> Vec<ToolCallRequest> {
    let parsed = serde_json::from_str::<serde_json::Value>(text);
    if let [tool] = tools {
        return vec![match parsed {
            Ok(arguments) => ToolCallRequest {
                id: None,
                name: tool.name.clone(),
                arguments,
                arguments_error: None,
            },
            Err(error) => invalid_ollama_tool_call(
                tool.name.clone(),
                format!("invalid single-shot JSON: {error}"),
            ),
        }];
    }
    let envelope = parsed
        .ok()
        .and_then(|value| value.as_object().cloned())
        .and_then(|object| {
            let name = object.get("name")?.as_str()?.to_string();
            let arguments = object.get("arguments")?.clone();
            Some((name, arguments))
        });
    match envelope {
        Some((name, arguments)) if tools.iter().any(|tool| tool.name == name) => {
            vec![ToolCallRequest {
                id: None,
                name,
                arguments,
                arguments_error: None,
            }]
        }
        Some((name, _)) => vec![invalid_ollama_tool_call(
            name,
            "single-shot outcome was not among the admitted schemas".to_string(),
        )],
        None => vec![invalid_ollama_tool_call(
            String::new(),
            "invalid multi-outcome single-shot JSON envelope".to_string(),
        )],
    }
}

fn invalid_ollama_tool_call(name: String, error: String) -> ToolCallRequest {
    ToolCallRequest {
        id: None,
        name,
        arguments: serde_json::Value::Null,
        arguments_error: Some(error),
    }
}

fn completion_termination(
    provider_reason: Option<String>,
) -> (CompletionTermination, Option<String>) {
    let provider_reason = provider_reason
        .map(|reason| reason.trim().chars().take(64).collect::<String>())
        .filter(|reason| !reason.is_empty());
    let termination = match provider_reason.as_deref().map(str::to_ascii_lowercase) {
        Some(reason) if matches!(reason.as_str(), "stop" | "end_turn") => {
            CompletionTermination::Complete
        }
        Some(reason) if matches!(reason.as_str(), "length" | "model_length" | "max_tokens") => {
            CompletionTermination::Length
        }
        Some(reason) if matches!(reason.as_str(), "tool_call" | "tool_calls") => {
            CompletionTermination::ToolCall
        }
        Some(reason)
            if matches!(
                reason.as_str(),
                "content_filter"
                    | "safety"
                    | "recitation"
                    | "blocked"
                    | "blocklist"
                    | "prohibited_content"
                    | "spii"
            ) =>
        {
            CompletionTermination::Filtered
        }
        _ => CompletionTermination::Unknown,
    };
    (termination, provider_reason)
}

fn openai_message(message: &LlmMessage) -> serde_json::Value {
    match message {
        // Generic transports see only the visible answer and normalized calls.
        LlmMessage::MistralAssistant(replay) => openai_message(&replay.visible),
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

/// Like `openai_message`, but Ollama's `/api/chat` takes tool-call arguments
/// as a native JSON object (not a stringified-JSON `arguments` field) and
/// keys tool results by `tool_name` rather than `tool_call_id`.
fn ollama_message(message: &LlmMessage) -> serde_json::Value {
    match message {
        // Generic transports see only the visible answer and normalized calls.
        LlmMessage::MistralAssistant(replay) => ollama_message(&replay.visible),
        LlmMessage::Text { role, content } => json!({"role": role, "content": content}),
        LlmMessage::AssistantToolCalls {
            content,
            tool_calls,
        } => json!({
            "role": "assistant",
            "content": content,
            "tool_calls": tool_calls.iter().map(|call| json!({
                "function": {
                    "name": call.name,
                    "arguments": call.arguments,
                }
            })).collect::<Vec<_>>()
        }),
        LlmMessage::ToolResult { name, content, .. } => json!({
            "role": "tool",
            "tool_name": name,
            "content": content,
        }),
    }
}

fn gemini_message(message: &LlmMessage) -> serde_json::Value {
    match message {
        // Generic transports see only the visible answer and normalized calls.
        LlmMessage::MistralAssistant(replay) => gemini_message(&replay.visible),
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
    finish_reason: Option<String>,
}

#[derive(Debug)]
struct OpenAiMessage {
    content: Option<OpenAiContent>,
    tool_calls: Option<Vec<OpenAiToolCall>>,
    native: serde_json::Value,
}

impl<'de> Deserialize<'de> for OpenAiMessage {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        let raw = serde_json::Value::deserialize(deserializer)?;
        let content = raw
            .get("content")
            .filter(|value| !value.is_null())
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(serde::de::Error::custom)?;
        let tool_calls = raw
            .get("tool_calls")
            .filter(|value| !value.is_null())
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(serde::de::Error::custom)?;
        // Only native assistant request fields are replayable; retain opaque
        // metadata inside their ordered content/tool-call trees verbatim.
        let mut native = json!({"role": "assistant"});
        for key in ["content", "tool_calls"] {
            if let Some(value) = raw.get(key) {
                native[key] = value.clone();
            }
        }
        Ok(Self {
            content,
            tool_calls,
            native,
        })
    }
}

/// Mistral returns either plain text or typed content chunks. Only answer
/// text enters the visible response; native thinking stays in opaque replay.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum OpenAiContent {
    Text(String),
    Chunks(Vec<OpenAiContentChunk>),
}

impl OpenAiContent {
    fn visible_text(&self) -> (String, bool) {
        match self {
            Self::Text(text) => (text.clone(), false),
            Self::Chunks(chunks) => {
                let mut text = String::new();
                let mut thinking_observed = false;
                for chunk in chunks {
                    match chunk {
                        OpenAiContentChunk::Text { text: part } => text.push_str(part),
                        OpenAiContentChunk::Thinking { thinking } => {
                            thinking_observed |= thinking.iter().any(|part| match part {
                                OpenAiThinkingChunk::Text { text } => !text.trim().is_empty(),
                                OpenAiThinkingChunk::Other => true,
                            });
                        }
                        OpenAiContentChunk::Other => {}
                    }
                }
                (text, thinking_observed)
            }
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum OpenAiContentChunk {
    Text {
        text: String,
    },
    Thinking {
        thinking: Vec<OpenAiThinkingChunk>,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum OpenAiThinkingChunk {
    Text {
        text: String,
    },
    // References carry no answer text and must not invalidate a completion.
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
struct OpenAiToolCall {
    id: Option<String>,
    function: OpenAiFunctionCall,
}

#[derive(Debug, Deserialize)]
struct OpenAiFunctionCall {
    name: String,
    arguments: OpenAiFunctionArguments,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum OpenAiFunctionArguments {
    Json(String),
    Object(serde_json::Map<String, serde_json::Value>),
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
    done_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OllamaMessage {
    content: Option<String>,
    thinking: Option<String>,
    #[serde(default)]
    tool_calls: Option<Vec<OllamaToolCall>>,
}

#[derive(Debug, Deserialize)]
struct OllamaToolCall {
    id: Option<String>,
    function: OllamaFunctionCall,
}

#[derive(Debug, Deserialize)]
struct OllamaFunctionCall {
    name: String,
    /// Ollama returns arguments as a native JSON object, unlike the
    /// OpenAI-compatible stringified-JSON `arguments` field.
    arguments: serde_json::Value,
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
    #[serde(rename = "finishReason")]
    finish_reason: Option<String>,
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

    fn native_fixture(reason: &str) -> OpenAiChatResponse {
        serde_json::from_value(json!({
            "model": "mistral-large-4-2609",
            "usage": {"prompt_tokens": 9, "completion_tokens": 12},
            "choices": [{"finish_reason": reason, "message": {
                "role": "assistant",
                "content": [
                    {"type": "thinking", "thinking": [
                        {"type": "text", "text": "PRIVATE_THINKING"},
                        {"type": "reference", "reference_ids": [7], "future": true}
                    ], "signature": "PRIVATE_SIGNATURE", "closed": true},
                    {"type": "future_block", "opaque": {"secret": "PRIVATE_UNKNOWN"}},
                    {"type": "text", "text": "Looking up stock."}
                ],
                "tool_calls": [{"id": "abcdefghi", "type": "function", "index": 0,
                    "function": {"name": "stock", "arguments": "{\"sku\":\"A\"}"}}]
            }}]
        }))
        .unwrap()
    }

    #[test]
    fn mistral_native_replay_roundtrips_ordered_opaque_blocks_and_tool_calls() {
        let client = client();
        let fixture = native_fixture("tool_calls");
        let native = fixture.choices.as_ref().unwrap()[0]
            .message
            .as_ref()
            .unwrap()
            .native
            .clone();
        let response = normalize_openai_response(fixture, "mistral", "mistral-large-4", true);
        assert_eq!(response.text, "Looking up stock.");
        let message = response.to_assistant_message();
        assert_eq!(
            message
                .mistral_replay_bytes("mistral", "mistral-large-4")
                .unwrap(),
            serde_json::to_vec(&native).unwrap().len()
        );
        assert!(message
            .mistral_replay_bytes("mistral", "mistral-large-4-2609")
            .is_err());
        let mut req = request(vec![]);
        req.model = "mistral-large-4".into();
        req.messages.push(message);
        req.messages.push(LlmMessage::ToolResult {
            tool_call_id: Some("abcdefghi".into()),
            name: "stock".into(),
            content: "42".into(),
        });
        assert!(client.validate_request(&req).is_ok());
        let payload = client.mistral_payload(&req);
        assert_eq!(payload["messages"][2], native);
        assert_eq!(payload["messages"][3]["tool_call_id"], "abcdefghi");
        assert_eq!(payload["messages"][3]["content"], "42");
        assert_eq!(response.model, "mistral-large-4-2609");
    }

    #[test]
    fn mistral_replay_is_redacted_and_cannot_cross_provider_model_or_proxy() {
        let mut client = client();
        let response = normalize_openai_response(
            native_fixture("tool_calls"),
            "mistral",
            "mistral-large-4",
            true,
        );
        let message = response.to_assistant_message();
        let debug = format!("{response:?} {message:?}");
        for secret in ["PRIVATE_THINKING", "PRIVATE_SIGNATURE", "PRIVATE_UNKNOWN"] {
            assert!(!debug.contains(secret));
            for generic in [
                openai_message(&message),
                gemini_message(&message),
                ollama_message(&message),
            ] {
                assert!(!generic.to_string().contains(secret));
            }
        }
        let mut req = request(vec![]);
        req.messages.push(message);
        req.model = "mistral-large-4".into();
        for provider in ["gemini", "ollama", "kong"] {
            req.provider = provider.into();
            assert!(client.validate_request(&req).is_err());
        }
        req.provider = "mistral".into();
        req.model = "another-model".into();
        assert!(client.validate_request(&req).is_err());
        req.model = "mistral-large-4".into();
        client.kong_url = Some("http://unused.invalid".into());
        assert!(client.validate_request(&req).is_err());
        assert!(client
            .from_openai_response(native_fixture("tool_calls"), "kong", "mistral-large-4")
            .mistral_replay
            .is_none());
    }

    #[test]
    fn mistral_replay_omits_partial_failed_and_oversized_native_messages() {
        for reason in ["length", "model_length", "content_filter", "unknown"] {
            let response = normalize_openai_response(
                native_fixture(reason),
                "mistral",
                "mistral-large-4",
                true,
            );
            assert!(response.mistral_replay.is_none());
        }
        for reason in ["stop", "tool_calls"] {
            assert!(normalize_openai_response(
                native_fixture(reason),
                "mistral",
                "mistral-large-4",
                true
            )
            .mistral_replay
            .is_some());
        }
        let mut fixture = native_fixture("stop");
        fixture.choices.as_mut().unwrap()[0]
            .message
            .as_mut()
            .unwrap()
            .native["content"][0]["signature"] = json!("x".repeat(MAX_MISTRAL_REPLAY_BYTES));
        let response = normalize_openai_response(fixture, "mistral", "mistral-large-4", true);
        assert!(response.mistral_replay.is_none());
        assert_eq!(response.text, "Looking up stock.");
        assert_eq!(response.output_tokens, 12);
    }

    #[test]
    fn mistral_replay_history_is_bounded_across_messages() {
        let client = client();
        let mut fixture = native_fixture("tool_calls");
        fixture.choices.as_mut().unwrap()[0]
            .message
            .as_mut()
            .unwrap()
            .native["content"][0]["signature"] = json!("x".repeat(MAX_MISTRAL_REPLAY_BYTES / 2));
        let response = normalize_openai_response(fixture, "mistral", "mistral-large-4", true);
        assert!(response.mistral_replay.is_some());
        let mut req = request(vec![]);
        req.model = "mistral-large-4".into();
        req.messages.push(response.to_assistant_message());
        assert!(client.validate_request(&req).is_ok());
        req.messages.push(response.to_assistant_message());
        assert!(client.validate_request(&req).is_err());
    }

    #[test]
    fn mistral_response_mutation_falls_back_to_normalized_visible_history() {
        let original = normalize_openai_response(
            native_fixture("tool_calls"),
            "mistral",
            "mistral-large-4",
            true,
        );
        assert!(matches!(
            original.to_assistant_message(),
            LlmMessage::MistralAssistant(_)
        ));
        let mut changed = original.clone();
        changed.text = "Changed visible text".into();
        assert!(!matches!(
            changed.to_assistant_message(),
            LlmMessage::MistralAssistant(_)
        ));
        changed = original.clone();
        changed.tool_calls[0].arguments = json!({"sku": "B"});
        assert!(!matches!(
            changed.to_assistant_message(),
            LlmMessage::MistralAssistant(_)
        ));
        changed = original.clone();
        changed.provider = "gemini".into();
        assert!(!matches!(
            changed.to_assistant_message(),
            LlmMessage::MistralAssistant(_)
        ));
        changed = original.clone();
        changed.termination = CompletionTermination::Filtered;
        assert!(!matches!(
            changed.to_assistant_message(),
            LlmMessage::MistralAssistant(_)
        ));
        changed = original;
        changed.model = "different-model".into();
        assert!(!matches!(
            changed.to_assistant_message(),
            LlmMessage::MistralAssistant(_)
        ));
    }

    #[test]
    fn mistral_replay_requires_valid_complete_function_calls() {
        for arguments in ["{broken", "null", "[]", "42"] {
            let mut fixture = native_fixture("tool_calls");
            fixture.choices.as_mut().unwrap()[0]
                .message
                .as_mut()
                .unwrap()
                .tool_calls
                .as_mut()
                .unwrap()[0]
                .function
                .arguments = OpenAiFunctionArguments::Json(arguments.into());
            let response = normalize_openai_response(fixture, "mistral", "mistral-large-4", true);
            assert!(response.mistral_replay.is_none());
        }
        for id in [None, Some(""), Some("short"), Some("abc!efghi")] {
            let mut fixture = native_fixture("tool_calls");
            fixture.choices.as_mut().unwrap()[0]
                .message
                .as_mut()
                .unwrap()
                .tool_calls
                .as_mut()
                .unwrap()[0]
                .id = id.map(str::to_string);
            assert!(
                normalize_openai_response(fixture, "mistral", "mistral-large-4", true)
                    .mistral_replay
                    .is_none()
            );
        }
        let mut fixture = native_fixture("tool_calls");
        fixture.choices.as_mut().unwrap()[0]
            .message
            .as_mut()
            .unwrap()
            .tool_calls
            .as_mut()
            .unwrap()[0]
            .function
            .name
            .clear();
        assert!(
            normalize_openai_response(fixture, "mistral", "mistral-large-4", true)
                .mistral_replay
                .is_none()
        );
    }

    #[test]
    fn mistral_object_arguments_are_strings_in_native_replay_requests() {
        let fixture = json!({"model": "resolved-model", "choices": [{"finish_reason": "tool_calls", "message": {
            "role": "assistant", "content": [{"type": "thinking", "thinking": [{"type": "text", "text": "private"}], "signature": "sig", "closed": true}],
            "tool_calls": [{"id": "abcdefghi", "type": "function", "future": "keep", "function": {"name": "stock", "arguments": {"sku": "A"}, "unknown": true}}]
        }}]});
        let response = decode_mistral_response(fixture.clone(), "mistral-large-4").unwrap();
        let mut req = request(vec![]);
        req.model = "mistral-large-4".into();
        req.messages.push(response.to_assistant_message());
        let payload = client().mistral_payload(&req);
        let native = &payload["messages"][2];
        assert_eq!(
            native["content"],
            fixture["choices"][0]["message"]["content"]
        );
        assert_eq!(
            native["tool_calls"][0]["function"]["arguments"],
            "{\"sku\":\"A\"}"
        );
        assert_eq!(native["tool_calls"][0]["future"], "keep");
        assert_eq!(native["tool_calls"][0]["function"]["unknown"], true);
        // A generic Kong response identifying itself as Mistral is still not
        // proof of the native protocol and must never create replay state.
        let generic = client().from_openai_response(
            serde_json::from_value(fixture).unwrap(),
            "mistral",
            "mistral-large-4",
        );
        assert!(generic.mistral_replay.is_none());
    }

    #[test]
    fn mistral_errors_cannot_echo_provider_private_state() {
        let sentinel = "PRIVATE_SIGNATURE_FROM_PROVIDER_BODY";
        let malformed = json!({"choices": [{"message": {"content": [{"type": "text", "text": sentinel.chars().collect::<Vec<_>>() }], "tool_calls": sentinel}}]});
        let error = decode_mistral_response(malformed, "mistral-large-4").unwrap_err();
        assert!(!format!("{error} {error:?} {error:#}").contains(sentinel));
        // The status checker cannot receive or inspect the raw error body.
        let error = check_mistral_status(reqwest::StatusCode::BAD_REQUEST).unwrap_err();
        assert_eq!(
            error.to_string(),
            "Mistral request failed with HTTP 400 Bad Request"
        );
        assert!(!format!("{error:?} {error:#}").contains(sentinel));
    }

    #[test]
    fn mistral_replay_requires_native_thinking_and_keeps_empty_signed_thinking() {
        for message in [
            json!({}),
            json!({"content": "Ordinary answer"}),
            json!({"content": [{"type": "text", "text": "Ordinary answer"}]}),
        ] {
            let response = decode_mistral_response(
                json!({"choices": [{"finish_reason": "stop", "message": message}]}),
                "mistral-large-4",
            )
            .unwrap();
            assert!(response.mistral_replay.is_none());
            assert!(!matches!(
                response.to_assistant_message(),
                LlmMessage::MistralAssistant(_)
            ));
        }
        let response = decode_mistral_response(json!({"choices": [{"finish_reason": "stop", "message": {
            "content": [{"type": "thinking", "thinking": [], "signature": "opaque", "closed": true}, {"type": "text", "text": "Answer"}]
        }}]}), "mistral-large-4").unwrap();
        assert!(response.mistral_replay.is_some());
        assert!(!response.thinking_observed);
        assert_eq!(response.text, "Answer");
    }

    #[test]
    fn mistral_effort_is_explicit_exact_model_opt_in_and_transport_local() {
        let mut client = client();
        let mut req = request(vec![]);
        req.model = "mistral-large-4".into();
        req.thinking = ThinkingMode::Enabled;
        assert!(client.validate_request(&req).is_err());
        client.mistral_reasoning_models = vec!["mistral-large-4".into()];
        assert!(client.validate_request(&req).is_ok());
        assert_eq!(client.mistral_payload(&req)["reasoning_effort"], "high");
        req.thinking = ThinkingMode::Disabled;
        assert_eq!(client.mistral_payload(&req)["reasoning_effort"], "none");
        req.thinking = ThinkingMode::ProviderDefault;
        assert!(client
            .mistral_payload(&req)
            .get("reasoning_effort")
            .is_none());
        client.mistral_reasoning_effort = Some(MistralReasoningEffort::High);
        assert_eq!(client.mistral_payload(&req)["reasoning_effort"], "high");
        assert!(client
            .openai_payload(&req)
            .get("reasoning_effort")
            .is_none());
        assert!(client
            .ollama_payload(&req, &req.model)
            .get("reasoning_effort")
            .is_none());
        req.model = "MISTRAL-LARGE-4".into();
        req.thinking = ThinkingMode::Enabled;
        assert!(client.validate_request(&req).is_err());
        req.thinking = ThinkingMode::Disabled;
        assert!(client.validate_request(&req).is_ok());
        assert!(client
            .mistral_payload(&req)
            .get("reasoning_effort")
            .is_none());
        client.kong_url = Some("http://unused.invalid".into());
        req.thinking = ThinkingMode::Enabled;
        assert!(client.validate_request(&req).is_ok());
        assert!(client
            .openai_payload(&req)
            .get("reasoning_effort")
            .is_none());
    }

    fn client() -> LlmClient {
        LlmClient {
            http: reqwest::Client::new(),
            kong_url: None,
            kong_token: None,
            mistral_api_key: None,
            mistral_reasoning_effort: None,
            mistral_reasoning_models: Vec::new(),
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
            single_shot_tool: false,
            thinking: ThinkingMode::ProviderDefault,
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
    fn mistral_single_shot_requires_one_structured_outcome() {
        let mut req = request(vec![stock_tool()]);
        req.single_shot_tool = true;

        let payload = client().mistral_payload(&req);

        assert_eq!(payload["tool_choice"], "any");
        assert_eq!(payload["parallel_tool_calls"], false);
        // Generic Kong payloads retain their existing compatibility behavior.
        assert_eq!(client().openai_payload(&req)["tool_choice"], "auto");

        req.single_shot_tool = false;
        let payload = client().mistral_payload(&req);
        assert_eq!(payload["tool_choice"], "auto");
        assert!(payload.get("parallel_tool_calls").is_none());

        req.tools.clear();
        req.single_shot_tool = true;
        let payload = client().mistral_payload(&req);
        assert!(payload.get("tool_choice").is_none());
        assert!(payload.get("parallel_tool_calls").is_none());
    }

    #[test]
    fn mistral_chunked_content_preserves_answer_and_usage_without_thinking_text() {
        let body: OpenAiChatResponse = serde_json::from_value(json!({
            "model": "mistral-medium-3-5",
            "choices": [{
                "finish_reason": "stop",
                "message": {
                    "content": [
                        {"type": "thinking", "thinking": [
                            {"type": "text", "text": "private reasoning must not escape"}
                        ]},
                        {"type": "text", "text": "Stock: "},
                        {"type": "citation", "text": "not answer text"},
                        {"type": "text", "text": "7."}
                    ]
                }
            }],
            "usage": {"prompt_tokens": 19, "completion_tokens": 37}
        }))
        .expect("valid Mistral chunked fixture");

        let response = client().from_openai_response(body, "mistral", "requested-model");

        assert_eq!(response.text, "Stock: 7.");
        assert!(response.thinking_observed);
        assert_eq!((response.input_tokens, response.output_tokens), (19, 37));
        assert_eq!(response.model, "mistral-medium-3-5");
        assert_eq!(response.termination, CompletionTermination::Complete);
        assert!(!format!("{response:?}").contains("private reasoning"));
    }

    #[test]
    fn mistral_thinking_only_length_stop_is_not_a_final_answer() {
        let body: OpenAiChatResponse = serde_json::from_value(json!({
            "choices": [{
                "finish_reason": "length",
                "message": {"content": [
                    {"type": "thinking", "thinking": [
                        {"type": "text", "text": "still thinking"}
                    ]}
                ]}
            }],
            "usage": {"prompt_tokens": 20, "completion_tokens": 256}
        }))
        .expect("valid thinking-only fixture");

        let response = client().from_openai_response(body, "mistral", "model");

        assert!(response.text.is_empty());
        assert!(response.thinking_exhausted_before_content());
        assert_eq!(response.output_tokens, 256);
    }

    #[test]
    fn mistral_chunked_answer_can_accompany_a_tool_call() {
        let body: OpenAiChatResponse = serde_json::from_value(json!({
            "choices": [{
                "finish_reason": "tool_calls",
                "message": {
                    "content": [{"type": "text", "text": "Checking stock."}],
                    "tool_calls": [{
                        "id": "Ab12Cd34E",
                        "function": {"name": "erp_snapshot", "arguments": "{\"entity_id\":42}"}
                    }]
                }
            }]
        }))
        .expect("valid chunked tool-call fixture");

        let response = client().from_openai_response(body, "mistral", "model");

        assert_eq!(response.text, "Checking stock.");
        assert!(!response.thinking_observed);
        assert_eq!(response.tool_calls[0].arguments, json!({"entity_id": 42}));
        assert_eq!(response.termination, CompletionTermination::ToolCall);
    }

    #[test]
    fn mistral_thinking_accepts_reference_chunks_without_exposing_them() {
        // Mistral's ThinkChunk schema permits TextChunk, ReferenceChunk and
        // ToolReferenceChunk; OpenCode retains these as native replay metadata.
        let body = serde_json::from_value(json!({
            "model": "mistral-large-4",
            "choices": [{
                "finish_reason": "stop",
                "message": {"content": [
                    {"type": "thinking", "signature": "opaque-signature", "closed": true,
                     "thinking": [
                        {"type": "reference", "reference_ids": [17, "ref-1"]},
                        {"type": "tool_reference", "tool": "lookup", "title": "Private lookup",
                         "url": "https://example.test/private"},
                        {"type": "text", "text": "private reasoning"}
                     ]},
                    {"type": "text", "text": "Visible answer."}
                ]}
            }]
        }))
        .expect("valid Mistral thinking union");

        let response = client().from_openai_response(body, "mistral", "mistral-large-4");

        assert_eq!(response.text, "Visible answer.");
        assert!(response.thinking_observed);
        let debug = format!("{response:?}");
        for private in [
            "private reasoning",
            "opaque-signature",
            "ref-1",
            "Private lookup",
            "example.test",
        ] {
            assert!(!debug.contains(private));
        }
    }

    #[test]
    fn mistral_object_tool_arguments_normalize_and_replay_as_json_string() {
        // Both Mistral FunctionCall and OpenCode's native Mistral decoder admit
        // object-valued arguments as well as the common JSON-encoded string.
        let body = serde_json::from_value(json!({
            "model": "mistral-large-4",
            "choices": [{
                "finish_reason": "tool_calls",
                "message": {"content": null, "tool_calls": [{
                    "id": "Ab12Cd34E", "type": "function",
                    "function": {"name": "erp_snapshot", "arguments": {"entity_id": 42}}
                }]}
            }],
            "usage": {"prompt_tokens": 28, "completion_tokens": 12}
        }))
        .expect("valid object-valued Mistral arguments");

        let response = client().from_openai_response(body, "mistral", "mistral-large-4");

        assert_eq!(response.tool_calls[0].arguments, json!({"entity_id": 42}));
        assert!(response.tool_calls[0].arguments_error.is_none());
        assert_eq!(response.termination, CompletionTermination::ToolCall);
        assert_eq!((response.input_tokens, response.output_tokens), (28, 12));

        let mut req = request(vec![stock_tool()]);
        req.messages.push(LlmMessage::AssistantToolCalls {
            content: None,
            tool_calls: response.tool_calls,
        });
        let payload = client().mistral_payload(&req);
        assert_eq!(
            payload["messages"][2]["tool_calls"][0]["function"]["arguments"],
            "{\"entity_id\":42}"
        );
    }

    #[test]
    fn mistral_model_length_is_an_exhausted_completion() {
        let body = serde_json::from_value(json!({
            "choices": [{"finish_reason": "model_length", "message": {"content": null}}]
        }))
        .expect("valid Mistral model-length stop");

        let response = client().from_openai_response(body, "mistral", "mistral-large-4");

        assert!(response.exhausted_before_content());
        assert_eq!(
            response.provider_done_reason.as_deref(),
            Some("model_length")
        );
    }

    #[test]
    fn openai_plain_and_empty_content_keep_their_existing_meaning() {
        for (content, expected_text) in [
            (json!("Plain answer."), "Plain answer."),
            (json!(null), ""),
            (json!([]), ""),
            (json!([{"type": "thinking", "thinking": []}]), ""),
        ] {
            let body = serde_json::from_value(json!({
                "choices": [{"finish_reason": "stop", "message": {"content": content}}]
            }))
            .expect("valid content fixture");

            let response = client().from_openai_response(body, "kong", "model");

            assert_eq!(response.text, expected_text);
            assert!(!response.thinking_observed);
            assert!(response.tool_calls.is_empty());
        }
        assert!(serde_json::from_value::<OpenAiChatResponse>(json!({
            "choices": [{"message": {"content": [{"type": "text", "text": 123}]}}]
        }))
        .is_err());
    }

    #[test]
    fn mistral_fixture_populates_tool_calls() {
        let body: OpenAiChatResponse = serde_json::from_value(json!({
            "model": "mistral-large-latest",
            "choices": [{
                "finish_reason": "tool_calls",
                "message": {
                    "content": null,
                    "tool_calls": [{
                        "id": "Ab12Cd34E",
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
        assert_eq!(response.tool_calls[0].id.as_deref(), Some("Ab12Cd34E"));
        assert_eq!(response.tool_calls[0].name, "erp_snapshot");
        assert_eq!(response.tool_calls[0].arguments, json!({ "entity_id": 42 }));
        assert_eq!(response.tool_calls[0].arguments_error, None);
        assert_eq!(response.termination, CompletionTermination::ToolCall);
        assert_eq!(response.provider_done_reason.as_deref(), Some("tool_calls"));
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
                "finishReason": "STOP",
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
        assert_eq!(response.termination, CompletionTermination::Complete);
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

    #[test]
    fn ollama_payload_omits_tools_and_applies_disabled_thinking() {
        let mut req = request(Vec::new());
        req.thinking = ThinkingMode::Disabled;
        let body = client().ollama_payload(&req, "gemma4:e2b-mlx");

        assert_eq!(body["model"], "gemma4:e2b-mlx");
        assert_eq!(body["think"], false);
        assert_eq!(body["stream"], false);
        assert!(body.get("tools").is_none());
        assert_eq!(body["messages"][0]["role"], "system");
    }

    #[test]
    fn ollama_payload_declares_function_tools() {
        let body = client().ollama_payload(&request(vec![stock_tool()]), "gemma4:e2b-mlx");

        assert_eq!(body["tools"][0]["type"], "function");
        assert_eq!(body["tools"][0]["function"]["name"], "erp_snapshot");
        assert_eq!(
            body["tools"][0]["function"]["parameters"]["required"][0],
            "entity_id"
        );
        // Unlike the OpenAI/Kong path, Ollama never gets a `tool_choice` key.
        assert!(body.get("tool_choice").is_none());
    }

    #[test]
    fn ollama_message_sends_native_json_arguments_not_a_string() {
        let call = ToolCallRequest {
            id: Some("call_1".to_string()),
            name: "erp_snapshot".to_string(),
            arguments: json!({"entity_id": 42}),
            arguments_error: None,
        };
        let assistant = LlmMessage::AssistantToolCalls {
            content: None,
            tool_calls: vec![call],
        };

        let body = ollama_message(&assistant);

        // Ollama takes structured JSON args, not a stringified-JSON field like
        // the OpenAI-compatible `openai_message` path.
        assert_eq!(
            body["tool_calls"][0]["function"]["arguments"]["entity_id"],
            42
        );
        assert!(body["tool_calls"][0]["function"]["arguments"].is_object());
    }

    #[test]
    fn ollama_message_tool_result_uses_tool_name_not_tool_call_id() {
        let result = LlmMessage::ToolResult {
            tool_call_id: Some("call_1".to_string()),
            name: "erp_snapshot".to_string(),
            content: "{\"stock\":7}".to_string(),
        };

        let body = ollama_message(&result);

        assert_eq!(body["role"], "tool");
        assert_eq!(body["tool_name"], "erp_snapshot");
        assert_eq!(body["content"], "{\"stock\":7}");
    }

    #[test]
    fn ollama_response_parses_native_json_tool_call_arguments() {
        let raw = json!({
            "message": {
                "role": "assistant",
                "content": "",
                "tool_calls": [{
                    "id": "call_nq3sckva",
                    "function": {
                        "name": "erp_snapshot",
                        "arguments": {"entity_id": 42}
                    }
                }]
            },
            "prompt_eval_count": 26,
            "eval_count": 3
        });

        let parsed: OllamaChatResponse = serde_json::from_value(raw).unwrap();
        let message = parsed.message.expect("message present");
        let tool_calls = message.tool_calls.expect("tool_calls present");

        assert_eq!(tool_calls.len(), 1);
        assert_eq!(tool_calls[0].function.name, "erp_snapshot");
        assert_eq!(tool_calls[0].function.arguments["entity_id"], 42);
        assert_eq!(tool_calls[0].id.as_deref(), Some("call_nq3sckva"));
    }

    /// Live smoke check against a real local Ollama instance running a
    /// tool-capable model (e.g. `gemma4:e2b-mlx`). Not run in CI — requires
    /// `spacetime`-adjacent local infra this crate's test suite doesn't
    /// otherwise depend on. Run manually with:
    ///   OLLAMA_SMOKE_MODEL=gemma4:e2b-mlx cargo test --bin gateway \
    ///     live_ollama_model_returns_a_real_tool_call -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn live_ollama_model_returns_a_real_tool_call() {
        let model =
            std::env::var("OLLAMA_SMOKE_MODEL").unwrap_or_else(|_| "gemma4:e2b-mlx".to_string());
        let mut llm_client = client();
        llm_client.ollama_llm_model = model.clone();

        let mut req = request(vec![ToolSpec {
            name: "get_stock".to_string(),
            description: "Get stock level for a SKU".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {"sku": {"type": "string"}},
                "required": ["sku"]
            }),
        }]);
        req.messages = vec![LlmMessage::text(
            "user",
            "What is the stock level of product SKU-42?",
        )];
        req.model = model;

        let response = llm_client
            .complete_ollama(&req)
            .await
            .expect("local Ollama must be running with the smoke model pulled");

        assert_eq!(response.provider, "ollama");
        assert_eq!(response.tool_calls.len(), 1);
        assert_eq!(response.tool_calls[0].name, "get_stock");
        assert_eq!(response.tool_calls[0].arguments["sku"], "SKU-42");
    }

    #[test]
    fn ollama_response_without_tool_calls_parses_plain_text() {
        let raw = json!({
            "message": {"role": "assistant", "content": "Hello there."},
            "prompt_eval_count": 10,
            "eval_count": 3
        });

        let parsed: OllamaChatResponse = serde_json::from_value(raw).unwrap();
        let message = parsed.message.expect("message present");

        assert_eq!(message.content.as_deref(), Some("Hello there."));
        assert!(message.tool_calls.is_none());
    }

    #[test]
    fn ollama_payload_applies_explicit_thinking_and_multi_outcome_schema() {
        let mut req = request(vec![
            stock_tool(),
            ToolSpec {
                name: "unable_to_progress".to_string(),
                description: "Stop safely.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {"reason": {"type": "string"}},
                    "required": ["reason"],
                    "additionalProperties": false,
                }),
            },
        ]);
        req.single_shot_tool = true;
        req.thinking = ThinkingMode::Enabled;

        let payload = client().ollama_payload(&req, "gemma4:e2b-mlx");

        assert_eq!(payload["think"], true);
        assert_eq!(payload["options"]["num_predict"], 256);
        assert_eq!(payload["format"]["oneOf"].as_array().unwrap().len(), 2);
        assert_eq!(
            payload["format"]["oneOf"][0]["properties"]["name"]["const"],
            "erp_snapshot"
        );
    }

    #[test]
    fn ollama_thinking_trace_is_reduced_to_safe_starvation_metadata() {
        let mut req = request(vec![stock_tool()]);
        req.single_shot_tool = true;
        req.thinking = ThinkingMode::Enabled;
        let parsed: OllamaChatResponse = serde_json::from_value(json!({
            "message": {
                "content": "",
                "thinking": "SECRET MODEL TRACE THAT MUST NOT SURVIVE"
            },
            "done_reason": "length",
            "prompt_eval_count": 41,
            "eval_count": 256
        }))
        .unwrap();

        let response = LlmClient::from_ollama_response(parsed, &req, "gemma4:e2b-mlx".into());

        assert_eq!(response.termination, CompletionTermination::Length);
        assert_eq!(response.provider_done_reason.as_deref(), Some("length"));
        assert!(response.thinking_observed);
        assert!(response.thinking_exhausted_before_content());
        assert!(!format!("{response:?}").contains("SECRET MODEL TRACE"));
    }

    #[test]
    fn ollama_multi_outcome_envelope_becomes_one_admitted_tool_call() {
        let tools = vec![
            stock_tool(),
            ToolSpec {
                name: "unable_to_progress".to_string(),
                description: "Stop safely.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {"reason": {"type": "string"}},
                    "required": ["reason"],
                    "additionalProperties": false,
                }),
            },
        ];
        let calls = ollama_tool_calls(
            &tools,
            r#"{"name":"unable_to_progress","arguments":{"reason":"no evidence"}}"#,
        );

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "unable_to_progress");
        assert_eq!(calls[0].arguments, json!({"reason": "no evidence"}));
        assert!(calls[0].arguments_error.is_none());

        let rejected = ollama_tool_calls(&tools, r#"{"name":"unreviewed_action","arguments":{}}"#);
        assert!(rejected[0].arguments_error.is_some());
    }

    #[test]
    fn provider_done_reason_is_bounded_and_unknown_values_stay_non_authoritative() {
        let raw = format!("vendor_reason_{}", "x".repeat(100));
        let (termination, reason) = completion_termination(Some(raw));
        assert_eq!(termination, CompletionTermination::Unknown);
        assert_eq!(reason.unwrap().chars().count(), 64);
    }

    #[tokio::test]
    #[ignore = "requires GOV00A_OLLAMA_MODEL and a local Ollama service"]
    async fn live_ollama_reports_starvation_and_accepts_closed_union_fallback() {
        let model = std::env::var("GOV00A_OLLAMA_MODEL")
            .expect("set GOV00A_OLLAMA_MODEL to an installed thinking-capable model");
        let tools = vec![
            stock_tool(),
            ToolSpec {
                name: "unable_to_progress".to_string(),
                description: "Stop safely when bounded evidence is insufficient.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {"reason": {"type": "string"}},
                    "required": ["reason"],
                    "additionalProperties": false,
                }),
            },
        ];
        let mut req = request(tools);
        req.provider = "ollama".to_string();
        req.model = model;
        req.system = "Return exactly one JSON object matching the supplied schema. Choose unable_to_progress because no evidence is available.".to_string();
        req.messages = vec![LlmMessage::text("user", "Resolve the bounded task.")];
        req.single_shot_tool = true;
        req.thinking = ThinkingMode::Enabled;
        req.max_tokens = 256;

        let first = client().complete_ollama(&req).await.unwrap();
        assert!(
            first.thinking_exhausted_before_content()
                || first
                    .tool_calls
                    .iter()
                    .any(|call| call.arguments_error.is_none()),
            "thinking request must yield a valid outcome or the exact typed exhausted state: {first:?}"
        );

        req.thinking = ThinkingMode::Disabled;
        let fallback = client().complete_ollama(&req).await.unwrap();
        assert_eq!(fallback.termination, CompletionTermination::Complete);
        assert!(!fallback.thinking_observed);
        assert_eq!(fallback.tool_calls.len(), 1);
        assert_eq!(fallback.tool_calls[0].name, "unable_to_progress");
        assert!(fallback.tool_calls[0].arguments_error.is_none());
    }
}
