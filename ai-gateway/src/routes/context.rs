use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, AppResult},
    rig_agent::{ContextHit, IngestRequest as RigIngestRequest},
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct ContextSearchRequest {
    pub org_id: u64,
    pub query: String,
    pub top_k: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct ContextSearchResponse {
    pub hits: Vec<ContextHit>,
}

#[derive(Debug, Deserialize)]
pub struct ContextIngestRequest {
    pub org_id: u64,
}

#[derive(Debug, Serialize)]
pub struct ContextIngestResponse {
    pub ingested: usize,
}

#[derive(Debug, Deserialize)]
pub struct ContextDocumentRequest {
    pub org_id: u64,
    pub doc_id: String,
    pub doc_type: Option<String>,
    pub filename: Option<String>,
    pub content: String,
    pub mime_type: Option<String>,
    pub uploaded_by: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ContextDocumentResponse {
    pub ok: bool,
    pub doc_id: String,
    pub chunks_embedded: usize,
    pub extracted_text: String,
    pub structured_fields: serde_json::Value,
    pub stdb_job_id: Option<u64>,
}

pub async fn post_search(
    State(state): State<AppState>,
    Json(req): Json<ContextSearchRequest>,
) -> AppResult<Json<ContextSearchResponse>> {
    if req.query.trim().is_empty() {
        return Err(AppError::BadRequest("query must not be empty".into()));
    }

    let top_k = req.top_k.unwrap_or(8).clamp(1, 50);

    let hits = state
        .rig
        .search_org(req.org_id, req.query.trim(), top_k)
        .await
        .map_err(AppError::Qdrant)?;

    tracing::info!(
        org_id = req.org_id,
        top_k,
        hit_count = hits.len(),
        "Org context search completed"
    );

    Ok(Json(ContextSearchResponse { hits }))
}

pub async fn post_ingest(
    State(state): State<AppState>,
    Json(req): Json<ContextIngestRequest>,
) -> AppResult<Json<ContextIngestResponse>> {
    let ingested = crate::context_worker::ingest_for_org(&state, req.org_id)
        .await
        .map_err(AppError::Qdrant)?;

    tracing::info!(
        org_id = req.org_id,
        ingested,
        "Manual org context ingestion completed"
    );

    Ok(Json(ContextIngestResponse { ingested }))
}

pub async fn post_document(
    State(state): State<AppState>,
    Json(req): Json<ContextDocumentRequest>,
) -> AppResult<Json<ContextDocumentResponse>> {
    if req.doc_id.trim().is_empty() {
        return Err(AppError::BadRequest("doc_id must not be empty".into()));
    }

    if req.content.trim().is_empty() {
        return Err(AppError::BadRequest("content must not be empty".into()));
    }

    if req.content.len() > state.config.max_upload_bytes {
        return Err(AppError::BadRequest(format!(
            "content exceeds max upload size of {} bytes",
            state.config.max_upload_bytes
        )));
    }

    let ingest_req = RigIngestRequest {
        org_id: req.org_id,
        doc_id: req.doc_id.trim().to_string(),
        doc_type: req
            .doc_type
            .unwrap_or_else(|| "text".to_string())
            .trim()
            .to_string(),
        filename: req
            .filename
            .unwrap_or_else(|| format!("{}.txt", req.doc_id.trim()))
            .trim()
            .to_string(),
        content: req.content.into_bytes(),
        mime_type: req
            .mime_type
            .unwrap_or_else(|| "text/plain".to_string())
            .trim()
            .to_string(),
        uploaded_by: req
            .uploaded_by
            .unwrap_or_else(|| "api".to_string())
            .trim()
            .to_string(),
    };

    let result = state
        .rig
        .ingest_document(ingest_req, &state.stdb)
        .await
        .map_err(AppError::Qdrant)?;

    tracing::info!(
        org_id = req.org_id,
        doc_id = %result.doc_id,
        chunks_embedded = result.chunks_embedded,
        "Context document ingested"
    );

    Ok(Json(ContextDocumentResponse {
        ok: true,
        doc_id: result.doc_id,
        chunks_embedded: result.chunks_embedded,
        extracted_text: result.extracted_text,
        structured_fields: result.structured_fields,
        stdb_job_id: result.stdb_job_id,
    }))
}
