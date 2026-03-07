/// POST /v1/search — semantic ANN search with mandatory company_id tenant filter
use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

#[derive(Deserialize)]
pub struct SearchRequest {
    pub company_id: u64,
    pub query: String,
    /// Optional: filter to a specific content type (product, contact, document, etc.)
    pub content_type: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: u64,
    /// Minimum cosine similarity score (0.0–1.0). Defaults to 0.7.
    pub score_threshold: Option<f32>,
}

fn default_limit() -> u64 {
    20
}

#[derive(Serialize)]
pub struct SearchHit {
    pub score: f32,
    pub content_type: String,
    pub content_id: u64,
    pub stdb_embedding_id: u64,
    pub text_snippet: String,
}

#[derive(Serialize)]
pub struct SearchResponse {
    pub query: String,
    pub company_id: u64,
    pub results: Vec<SearchHit>,
}

pub async fn post_search(
    State(state): State<AppState>,
    Json(req): Json<SearchRequest>,
) -> AppResult<Json<SearchResponse>> {
    if req.query.trim().is_empty() {
        return Err(AppError::BadRequest("query must not be empty".into()));
    }

    // Embed the query text
    let query_vector = state
        .embedder
        .embed(&req.query)
        .await
        .map_err(|e| AppError::Embedding(e.to_string()))?;

    // ANN search in Qdrant — company_id filter is ALWAYS applied
    let hits = state
        .vector_store
        .search(
            query_vector,
            req.company_id,
            req.content_type.as_deref(),
            req.limit,
            req.score_threshold,
        )
        .await
        .map_err(AppError::Qdrant)?;

    let results: Vec<SearchHit> = hits
        .into_iter()
        .map(|h| SearchHit {
            score: h.score,
            content_type: h.content_type,
            content_id: h.content_id,
            stdb_embedding_id: h.stdb_embedding_id,
            text_snippet: h.text_snippet,
        })
        .collect();

    tracing::info!(
        company_id = req.company_id,
        result_count = results.len(),
        "Semantic search completed"
    );

    Ok(Json(SearchResponse {
        query: req.query,
        company_id: req.company_id,
        results,
    }))
}
