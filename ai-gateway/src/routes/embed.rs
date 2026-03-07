/// POST /v1/embed  — compute embedding and index to Qdrant
/// DELETE /v1/embed — remove a point from Qdrant by STDB embedding ID
use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, AppResult},
    qdrant_client::EmbedPoint,
    state::AppState,
};

#[derive(Deserialize)]
pub struct EmbedRequest {
    pub company_id: u64,
    pub content_type: String,
    pub content_id: u64,
    pub stdb_embedding_id: u64,
    pub text: String,
}

#[derive(Serialize)]
pub struct EmbedResponse {
    pub stdb_embedding_id: u64,
    pub dim: u32,
    pub model: String,
}

pub async fn post_embed(
    State(state): State<AppState>,
    Json(req): Json<EmbedRequest>,
) -> AppResult<Json<EmbedResponse>> {
    if req.text.trim().is_empty() {
        return Err(AppError::BadRequest("text must not be empty".into()));
    }

    // Truncate text for the snippet stored in Qdrant payload
    let snippet: String = req.text.chars().take(200).collect();
    // Capture before moving into EmbedPoint
    let content_type = req.content_type.clone();

    // Compute embedding via Voyage AI
    let vector = state
        .embedder
        .embed(&req.text)
        .await
        .map_err(|e| AppError::Embedding(e.to_string()))?;

    let dim = vector.len() as u32;

    // Upsert into Qdrant (point ID = STDB embedding id)
    state
        .vector_store
        .upsert(EmbedPoint {
            id: req.stdb_embedding_id,
            vector,
            company_id: req.company_id,
            content_type: req.content_type,
            content_id: req.content_id,
            text_snippet: snippet,
        })
        .await
        .map_err(AppError::Qdrant)?;

    // Confirm sync back to SpacetimeDB so SearchEmbedding.sync_status = "synced"
    let model = state.config.embedding_model.clone();
    if let Err(e) = state
        .stdb
        .mark_embedding_synced(Some(req.company_id), req.stdb_embedding_id, &model, dim)
        .await
    {
        // Log but don't fail the request — Qdrant already has the vector.
        // The reconciliation worker will retry.
        tracing::warn!(
            embedding_id = req.stdb_embedding_id,
            "mark_embedding_synced failed (will reconcile): {}",
            e
        );
    }

    tracing::info!(
        embedding_id = req.stdb_embedding_id,
        content_type = %content_type,
        content_id = req.content_id,
        "Embedding indexed"
    );

    Ok(Json(EmbedResponse {
        stdb_embedding_id: req.stdb_embedding_id,
        dim,
        model,
    }))
}

#[derive(Deserialize)]
pub struct DeleteEmbedRequest {
    pub stdb_embedding_id: u64,
}

pub async fn delete_embed(
    State(state): State<AppState>,
    Json(req): Json<DeleteEmbedRequest>,
) -> AppResult<impl IntoResponse> {
    state
        .vector_store
        .delete(req.stdb_embedding_id)
        .await
        .map_err(AppError::Qdrant)?;

    tracing::info!(embedding_id = req.stdb_embedding_id, "Embedding deleted from Qdrant");

    Ok(StatusCode::NO_CONTENT)
}
