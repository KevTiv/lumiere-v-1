/// POST /v1/search — semantic ANN search with mandatory company_id tenant filter
use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, AppResult},
    qdrant_client::SemanticIndexRecord,
    state::AppState,
    stdb_embed::company_belongs_to_organization,
};

#[derive(Deserialize)]
pub struct SearchRequest {
    pub org_id: u64,
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
    #[serde(flatten)]
    pub record: SemanticIndexRecord,
}

#[derive(Serialize)]
pub struct SearchResponse {
    pub query: String,
    pub org_id: u64,
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

    let company_is_in_scope =
        company_belongs_to_organization(state.stdb.as_ref(), req.org_id, req.company_id)
            .await
            .map_err(|error| AppError::Internal(error.to_string()))?;
    if !company_is_in_scope {
        return Err(AppError::Forbidden(
            "company does not belong to organization".into(),
        ));
    }

    // Embed the query text
    let query_vector = state
        .providers
        .embedder
        .embed(&req.query)
        .await
        .map_err(|e| AppError::Embedding(e.to_string()))?;

    // ANN search in Qdrant — company_id filter is ALWAYS applied
    let hits = state
        .vector_store
        .search(
            query_vector,
            req.org_id,
            req.company_id,
            req.content_type.as_deref(),
            req.limit,
            req.score_threshold,
        )
        .await
        .map_err(AppError::Qdrant)?;

    let results: Vec<SearchHit> = hits
        .into_iter()
        .map(|hit| SearchHit {
            score: hit.score,
            record: hit.record,
        })
        .collect();

    tracing::info!(
        org_id = req.org_id,
        company_id = req.company_id,
        result_count = results.len(),
        "Semantic search completed"
    );

    Ok(Json(SearchResponse {
        query: req.query,
        org_id: req.org_id,
        company_id: req.company_id,
        results,
    }))
}
