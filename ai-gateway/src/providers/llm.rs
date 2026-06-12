//! LLM chat completions via Kong AI Gateway (optional) or direct provider HTTP.

use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::json;

use crate::config::Config;

#[derive(Clone, Debug)]
pub struct LlmMessage {
    pub role: String,
    pub content: String,
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
}

#[derive(Clone, Debug)]
pub struct LlmResponse {
    pub text: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub model: String,
    pub provider: String,
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
            other => anyhow::bail!(
                "Unsupported LLM provider '{other}'. Use Mistral, Gemini, or Ollama."
            ),
        }
    }

    fn openai_payload(&self, req: &LlmRequest) -> serde_json::Value {
        let mut messages = vec![json!({"role": "system", "content": req.system})];
        for msg in &req.messages {
            messages.push(json!({"role": msg.role, "content": msg.content}));
        }
        json!({
            "model": req.model,
            "max_tokens": req.max_tokens,
            "temperature": req.temperature.unwrap_or(0.7),
            "top_p": req.top_p,
            "messages": messages,
        })
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
        let text = parsed
            .message
            .and_then(|m| m.content)
            .unwrap_or_default();

        Ok(LlmResponse {
            text,
            input_tokens: parsed.prompt_eval_count.unwrap_or(0) as u32,
            output_tokens: parsed.eval_count.unwrap_or(0) as u32,
            model,
            provider: "ollama".to_string(),
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

        let body = json!({
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
        let text = parsed
            .candidates
            .and_then(|c| c.into_iter().next())
            .and_then(|c| c.content)
            .and_then(|c| c.parts.into_iter().next())
            .and_then(|p| p.text)
            .unwrap_or_default();

        let usage = parsed.usage_metadata.unwrap_or_default();

        Ok(LlmResponse {
            text,
            input_tokens: usage.prompt_token_count.unwrap_or(0) as u32,
            output_tokens: usage.candidates_token_count.unwrap_or(0) as u32,
            model,
            provider: "gemini".to_string(),
        })
    }

    fn from_openai_response(
        &self,
        body: OpenAiChatResponse,
        provider: &str,
        model: &str,
    ) -> LlmResponse {
        let text = body
            .choices
            .and_then(|c| c.into_iter().next())
            .and_then(|c| c.message)
            .and_then(|m| m.content)
            .unwrap_or_default();

        let (input_tokens, output_tokens) = body
            .usage
            .map(|u| (u.prompt_tokens.unwrap_or(0), u.completion_tokens.unwrap_or(0)))
            .unwrap_or((0, 0));

        LlmResponse {
            text,
            input_tokens,
            output_tokens,
            model: body.model.unwrap_or_else(|| model.to_string()),
            provider: provider.to_string(),
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
}

#[derive(Debug, Default, Deserialize)]
struct GeminiUsageMetadata {
    #[serde(rename = "promptTokenCount")]
    prompt_token_count: Option<u64>,
    #[serde(rename = "candidatesTokenCount")]
    candidates_token_count: Option<u64>,
}
