use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use serde::Deserialize;
use std::time::Duration;

/// Provider-reported token usage accompanies vectors for canonical spend settlement.
#[derive(Debug, Clone)]
pub struct EmbedBatchResult {
    pub vectors: Vec<Vec<f32>>,
    /// None means usage was not reported; callers must not invent zero usage.
    pub input_tokens: Option<u32>,
}

/// Common interface for all embedding providers.
/// Implement this trait to add a new embedding backend.
#[async_trait]
pub trait EmbedProvider: Send + Sync {
    async fn embed(&self, text: &str) -> Result<Vec<f32>>;
    async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>>;
    /// Existing local adapters may omit usage. Paid admission must reject missing usage.
    async fn embed_batch_with_usage(&self, texts: &[String]) -> Result<EmbedBatchResult> {
        Ok(EmbedBatchResult {
            vectors: self.embed_batch(texts).await?,
            input_tokens: None,
        })
    }
    /// Output vector dimension (must match Qdrant collection).
    fn dimensions(&self) -> u64;
    fn name(&self) -> &'static str;
}

// ── Ollama ────────────────────────────────────────────────────────────────────

pub struct OllamaEmbed {
    client: reqwest::Client,
    base_url: String,
    model: String,
    dimensions: u64,
}

#[derive(Deserialize)]
struct OllamaEmbedResponse {
    embeddings: Vec<Vec<f64>>,
}

impl OllamaEmbed {
    pub fn new(base_url: &str, model: &str) -> Self {
        // nomic-embed-text → 768 dims; mxbai-embed-large → 1024
        let dimensions = if model.contains("large") { 1024 } else { 768 };
        OllamaEmbed {
            client: reqwest::Client::new(),
            base_url: base_url.trim_end_matches('/').to_string(),
            model: model.to_string(),
            dimensions,
        }
    }
}

#[async_trait]
impl EmbedProvider for OllamaEmbed {
    async fn embed(&self, text: &str) -> Result<Vec<f32>> {
        let results = self.embed_batch(&[text.to_string()]).await?;
        results
            .into_iter()
            .next()
            .ok_or_else(|| anyhow::anyhow!("Empty embedding response"))
    }

    async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        let url = format!("{}/api/embed", self.base_url);
        let body = serde_json::json!({
            "model": self.model,
            "input": texts,
        });

        let resp: OllamaEmbedResponse = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        Ok(resp
            .embeddings
            .into_iter()
            .map(|v| v.into_iter().map(|x| x as f32).collect())
            .collect())
    }

    fn dimensions(&self) -> u64 {
        self.dimensions
    }

    fn name(&self) -> &'static str {
        "ollama"
    }
}

// ── Mistral ───────────────────────────────────────────────────────────────────

pub const MISTRAL_EMBED_MODEL: &str = "mistral-embed";
pub const MISTRAL_EMBED_DIMENSIONS: u64 = 1024;
const MAX_EMBED_BATCH: usize = 128;
const MAX_EMBED_INPUT_BYTES: usize = 16_384;
const MAX_EMBED_RESPONSE_BYTES: usize = 16 * 1024 * 1024;

pub struct MistralEmbed {
    client: reqwest::Client,
    api_key: String,
}

#[derive(Deserialize)]
struct MistralEmbedData {
    index: usize,
    embedding: Vec<f32>,
}

#[derive(Deserialize)]
struct MistralEmbedUsage {
    prompt_tokens: u32,
    total_tokens: u32,
}

#[derive(Deserialize)]
struct MistralEmbedResponse {
    model: String,
    data: Vec<MistralEmbedData>,
    usage: MistralEmbedUsage,
}

fn validate_embedding_inputs(texts: &[String]) -> Result<()> {
    if texts.is_empty() || texts.len() > MAX_EMBED_BATCH {
        bail!("embedding batch must contain 1..={MAX_EMBED_BATCH} inputs");
    }
    if texts
        .iter()
        .any(|text| text.trim().is_empty() || text.len() > MAX_EMBED_INPUT_BYTES)
    {
        bail!("embedding inputs must be nonempty and bounded");
    }
    Ok(())
}

fn decode_mistral_embeddings(
    response: MistralEmbedResponse,
    expected: usize,
) -> Result<EmbedBatchResult> {
    if response.model != MISTRAL_EMBED_MODEL || response.data.len() != expected {
        bail!("embedding response model or cardinality mismatch");
    }
    if response.usage.prompt_tokens == 0
        || response.usage.total_tokens != response.usage.prompt_tokens
    {
        bail!("embedding response has invalid usage");
    }
    let mut vectors = vec![None; expected];
    for item in response.data {
        if item.index >= expected
            || vectors[item.index].is_some()
            || item.embedding.len() != MISTRAL_EMBED_DIMENSIONS as usize
            || item.embedding.iter().any(|v| !v.is_finite())
            || item.embedding.iter().all(|v| *v == 0.0)
        {
            bail!("embedding response has invalid vectors or indexes");
        }
        vectors[item.index] = Some(item.embedding);
    }
    Ok(EmbedBatchResult {
        vectors: vectors
            .into_iter()
            .map(|vector| vector.context("embedding response is incomplete"))
            .collect::<Result<_>>()?,
        input_tokens: Some(response.usage.prompt_tokens),
    })
}

impl MistralEmbed {
    pub fn new(api_key: &str) -> Result<Self> {
        if api_key.trim().is_empty() {
            bail!("Mistral embedding credentials are unavailable");
        }
        Ok(MistralEmbed {
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(30))
                .build()
                .context("create Mistral embedding client")?,
            api_key: api_key.to_string(),
        })
    }
}

#[async_trait]
impl EmbedProvider for MistralEmbed {
    async fn embed(&self, text: &str) -> Result<Vec<f32>> {
        self.embed_batch(&[text.to_string()])
            .await?
            .into_iter()
            .next()
            .context("embedding response is empty")
    }

    async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        Ok(self.embed_batch_with_usage(texts).await?.vectors)
    }

    async fn embed_batch_with_usage(&self, texts: &[String]) -> Result<EmbedBatchResult> {
        validate_embedding_inputs(texts)?;
        let mut response = self
            .client
            .post("https://api.mistral.ai/v1/embeddings")
            .bearer_auth(&self.api_key)
            .json(&serde_json::json!({ "model": MISTRAL_EMBED_MODEL, "input": texts }))
            .send()
            .await
            .map_err(|_| anyhow::anyhow!("Mistral embedding request failed"))?;
        if !response.status().is_success() {
            bail!("Mistral embedding provider rejected request");
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| anyhow::anyhow!("Mistral embedding response unavailable"))?
        {
            if bytes.len().saturating_add(chunk.len()) > MAX_EMBED_RESPONSE_BYTES {
                bail!("embedding response exceeds limit");
            }
            bytes.extend_from_slice(&chunk);
        }
        let response =
            serde_json::from_slice(&bytes).context("invalid Mistral embedding response")?;
        decode_mistral_embeddings(response, texts.len())
    }

    fn dimensions(&self) -> u64 {
        MISTRAL_EMBED_DIMENSIONS
    }
    fn name(&self) -> &'static str {
        "mistral"
    }
}

// ── Gemini ────────────────────────────────────────────────────────────────────

pub struct GeminiEmbed {
    client: reqwest::Client,
    api_key: String,
    model: String,
}

#[derive(Deserialize)]
struct GeminiEmbedResponse {
    embedding: GeminiEmbeddingValues,
}

#[derive(Deserialize)]
struct GeminiEmbeddingValues {
    values: Vec<f32>,
}

impl GeminiEmbed {
    pub fn new(api_key: &str, model: &str) -> Self {
        GeminiEmbed {
            client: reqwest::Client::new(),
            api_key: api_key.to_string(),
            model: model.to_string(),
        }
    }

    fn embed_url(&self) -> String {
        format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:embedContent",
            self.model
        )
    }
}

#[async_trait]
impl EmbedProvider for GeminiEmbed {
    async fn embed(&self, text: &str) -> Result<Vec<f32>> {
        let results = self.embed_batch(&[text.to_string()]).await?;
        results
            .into_iter()
            .next()
            .ok_or_else(|| anyhow::anyhow!("Empty Gemini embedding response"))
    }

    async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        let mut out = Vec::with_capacity(texts.len());
        for text in texts {
            let url = format!("{}?key={}", self.embed_url(), self.api_key);
            let body = serde_json::json!({
                "content": {
                    "parts": [{ "text": text }]
                }
            });

            let resp: GeminiEmbedResponse = self
                .client
                .post(&url)
                .json(&body)
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?;

            out.push(resp.embedding.values);
        }
        Ok(out)
    }

    fn dimensions(&self) -> u64 {
        // text-embedding-004 → 768
        768
    }

    fn name(&self) -> &'static str {
        "gemini"
    }
}

#[cfg(test)]
mod mistral_tests {
    use super::*;
    fn response(indices: &[usize]) -> MistralEmbedResponse {
        MistralEmbedResponse {
            model: MISTRAL_EMBED_MODEL.into(),
            data: indices
                .iter()
                .map(|index| MistralEmbedData {
                    index: *index,
                    embedding: vec![1.0; 1024],
                })
                .collect(),
            usage: MistralEmbedUsage {
                prompt_tokens: 17,
                total_tokens: 17,
            },
        }
    }
    #[test]
    fn mistral_reorders_vectors_and_keeps_actual_usage() {
        let mut r = response(&[1, 0]);
        r.data[0].embedding[0] = 2.0;
        let result = decode_mistral_embeddings(r, 2).unwrap();
        assert_eq!(result.input_tokens, Some(17));
        assert_eq!(result.vectors[0][0], 1.0);
        assert_eq!(result.vectors[1][0], 2.0);
    }
    #[test]
    fn mistral_rejects_ambiguous_or_incompatible_vectors() {
        for indexes in [vec![], vec![0, 0], vec![0, 2]] {
            assert!(decode_mistral_embeddings(response(&indexes), 2).is_err());
        }
        let mut r = response(&[0]);
        r.data[0].embedding.pop();
        assert!(decode_mistral_embeddings(r, 1).is_err());
        let mut r = response(&[0]);
        r.data[0].embedding[0] = f32::NAN;
        assert!(decode_mistral_embeddings(r, 1).is_err());
        let mut r = response(&[0]);
        r.data[0].embedding.fill(0.0);
        assert!(decode_mistral_embeddings(r, 1).is_err());
        let mut r = response(&[0]);
        r.model = "other-model".into();
        assert!(decode_mistral_embeddings(r, 1).is_err());
    }
    #[test]
    fn mistral_requires_real_consistent_usage_and_bounded_inputs() {
        let mut r = response(&[0]);
        r.usage.prompt_tokens = 0;
        assert!(decode_mistral_embeddings(r, 1).is_err());
        let mut r = response(&[0]);
        r.usage.total_tokens += 1;
        assert!(decode_mistral_embeddings(r, 1).is_err());
        assert!(validate_embedding_inputs(&[]).is_err());
        assert!(validate_embedding_inputs(&[" ".into()]).is_err());
        assert!(validate_embedding_inputs(&["a".repeat(MAX_EMBED_INPUT_BYTES + 1)]).is_err());
        assert!(validate_embedding_inputs(&vec!["text".into(); MAX_EMBED_BATCH + 1]).is_err());
        assert!(validate_embedding_inputs(&["invoice text".into()]).is_ok());
    }
}
