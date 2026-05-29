use anyhow::Result;
use async_trait::async_trait;
use serde::Deserialize;

/// Common interface for all embedding providers.
/// Implement this trait to add a new embedding backend.
#[async_trait]
pub trait EmbedProvider: Send + Sync {
    async fn embed(&self, text: &str) -> Result<Vec<f32>>;
    async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>>;
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

pub struct MistralEmbed {
    client: reqwest::Client,
    api_key: String,
}

#[derive(Deserialize)]
struct MistralEmbedData {
    embedding: Vec<f32>,
}

#[derive(Deserialize)]
struct MistralEmbedResponse {
    data: Vec<MistralEmbedData>,
}

impl MistralEmbed {
    pub fn new(api_key: &str) -> Self {
        MistralEmbed {
            client: reqwest::Client::new(),
            api_key: api_key.to_string(),
        }
    }
}

#[async_trait]
impl EmbedProvider for MistralEmbed {
    async fn embed(&self, text: &str) -> Result<Vec<f32>> {
        let results = self.embed_batch(&[text.to_string()]).await?;
        results
            .into_iter()
            .next()
            .ok_or_else(|| anyhow::anyhow!("Empty embedding response"))
    }

    async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        let body = serde_json::json!({
            "model": "mistral-embed",
            "input": texts,
        });

        let resp: MistralEmbedResponse = self
            .client
            .post("https://api.mistral.ai/v1/embeddings")
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        Ok(resp.data.into_iter().map(|d| d.embedding).collect())
    }

    fn dimensions(&self) -> u64 {
        1024
    }

    fn name(&self) -> &'static str {
        "mistral"
    }
}
