/// Voyage AI embedding client.
/// Docs: https://docs.voyageai.com/reference/embeddings-api
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Clone)]
pub struct EmbeddingClient {
    http: reqwest::Client,
    api_key: String,
    model: String,
}

#[derive(Serialize)]
struct VoyageRequest<'a> {
    input: Vec<&'a str>,
    model: &'a str,
}

#[derive(Deserialize)]
struct VoyageResponse {
    data: Vec<VoyageEmbedding>,
}

#[derive(Deserialize)]
struct VoyageEmbedding {
    embedding: Vec<f32>,
}

impl EmbeddingClient {
    pub fn new(api_key: String, model: String) -> Self {
        EmbeddingClient {
            http: reqwest::Client::new(),
            api_key,
            model,
        }
    }

    /// Embed a single text string. Returns a Vec<f32> vector.
    pub async fn embed(&self, text: &str) -> Result<Vec<f32>> {
        let resp = self
            .http
            .post("https://api.voyageai.com/v1/embeddings")
            .bearer_auth(&self.api_key)
            .json(&VoyageRequest {
                input: vec![text],
                model: &self.model,
            })
            .send()
            .await
            .context("Voyage AI request failed")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Voyage AI error {}: {}", status, body);
        }

        let body: VoyageResponse = resp.json().await.context("Failed to parse Voyage response")?;
        body.data
            .into_iter()
            .next()
            .map(|e| e.embedding)
            .context("Empty embedding response from Voyage AI")
    }

    /// Embed a batch of texts. Returns one Vec<f32> per input.
    pub async fn embed_batch(&self, texts: Vec<&str>) -> Result<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(vec![]);
        }

        let resp = self
            .http
            .post("https://api.voyageai.com/v1/embeddings")
            .bearer_auth(&self.api_key)
            .json(&VoyageRequest {
                input: texts,
                model: &self.model,
            })
            .send()
            .await
            .context("Voyage AI batch request failed")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Voyage AI batch error {}: {}", status, body);
        }

        let body: VoyageResponse = resp.json().await.context("Failed to parse Voyage batch response")?;
        Ok(body.data.into_iter().map(|e| e.embedding).collect())
    }
}
