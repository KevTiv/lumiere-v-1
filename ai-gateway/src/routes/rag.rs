/// POST /v1/rag — Retrieval-Augmented Generation via Qdrant + Claude
use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

const CLAUDE_API_URL: &str = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL: &str = "claude-sonnet-4-6";
const RAG_MAX_CONTEXT_CHUNKS: u64 = 20;
const RAG_MAX_TOKENS: u32 = 2048;

#[derive(Deserialize)]
pub struct RagRequest {
    pub company_id: u64,
    pub query: String,
    /// Optional: limit retrieval to specific content types
    pub include_types: Option<Vec<String>>,
    #[serde(default = "default_limit")]
    pub limit: u64,
}

fn default_limit() -> u64 {
    RAG_MAX_CONTEXT_CHUNKS
}

#[derive(Serialize)]
pub struct RagSource {
    pub content_type: String,
    pub content_id: u64,
    pub score: f32,
    pub text_snippet: String,
}

#[derive(Serialize)]
pub struct RagResponse {
    pub answer: String,
    pub sources: Vec<RagSource>,
}

pub async fn post_rag(
    State(state): State<AppState>,
    Json(req): Json<RagRequest>,
) -> AppResult<Json<RagResponse>> {
    if req.query.trim().is_empty() {
        return Err(AppError::BadRequest("query must not be empty".into()));
    }

    // Embed the query
    let query_vector = state
        .embedder
        .embed(&req.query)
        .await
        .map_err(|e| AppError::Embedding(e.to_string()))?;

    // Retrieve relevant chunks (optionally filtered by content type)
    let content_type_filter = req.include_types.as_deref().and_then(|t| t.first().map(String::as_str));
    let hits = state
        .vector_store
        .search(query_vector, req.company_id, content_type_filter, req.limit, Some(0.65))
        .await
        .map_err(AppError::Qdrant)?;

    if hits.is_empty() {
        return Ok(Json(RagResponse {
            answer: "No relevant information found for your query.".to_string(),
            sources: vec![],
        }));
    }

    // Build context string from retrieved chunks
    let context = hits
        .iter()
        .enumerate()
        .map(|(i, h)| format!("[{}] ({}) {}", i + 1, h.content_type, h.text_snippet))
        .collect::<Vec<_>>()
        .join("\n\n");

    // Call Claude API with retrieved context
    let claude_payload = json!({
        "model": CLAUDE_MODEL,
        "max_tokens": RAG_MAX_TOKENS,
        "system": "You are an intelligent ERP assistant. Answer the user's question using only the provided context. Be concise and factual. If the context doesn't contain enough information, say so.",
        "messages": [
            {
                "role": "user",
                "content": format!("Context:\n{}\n\nQuestion: {}", context, req.query)
            }
        ]
    });

    let claude_resp = state
        .http
        .post(CLAUDE_API_URL)
        .header("x-api-key", state.config.anthropic_api_key.as_str())
        .header("anthropic-version", "2023-06-01")
        .json(&claude_payload)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Claude API request failed: {}", e)))?;

    if !claude_resp.status().is_success() {
        let status = claude_resp.status();
        let body = claude_resp.text().await.unwrap_or_default();
        return Err(AppError::Internal(format!("Claude API error {}: {}", status, body)));
    }

    let claude_body: serde_json::Value = claude_resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to parse Claude response: {}", e)))?;

    let answer = claude_body["content"][0]["text"]
        .as_str()
        .unwrap_or("No answer generated.")
        .to_string();

    let sources: Vec<RagSource> = hits
        .into_iter()
        .map(|h| RagSource {
            content_type: h.content_type,
            content_id: h.content_id,
            score: h.score,
            text_snippet: h.text_snippet,
        })
        .collect();

    tracing::info!(
        company_id = req.company_id,
        source_count = sources.len(),
        "RAG query answered"
    );

    Ok(Json(RagResponse { answer, sources }))
}
