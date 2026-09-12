use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, AppResult},
    harness::{fetch_authorized_live_snapshots, resolve_snapshot_candidates, ActorCredentials},
    rig_agent::ContextHit,
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct ContextSearchRequest {
    pub org_id: u64,
    pub company_id: u64,
    pub query: String,
    pub top_k: Option<usize>,
    pub stdb_token: String,
    pub identity_hex: String,
}

#[derive(Debug, Serialize)]
pub struct ContextSearchResponse {
    pub hits: Vec<ContextHit>,
}

pub async fn post_search(
    State(state): State<AppState>,
    Json(req): Json<ContextSearchRequest>,
) -> AppResult<Json<ContextSearchResponse>> {
    if req.query.trim().is_empty() {
        return Err(AppError::BadRequest("query must not be empty".into()));
    }

    let top_k = req.top_k.unwrap_or(8).clamp(1, 50);
    let actor = ActorCredentials::new(req.stdb_token, req.identity_hex)
        .map_err(|err| AppError::Forbidden(err.to_string()))?;

    let candidate_hits = state
        .rig
        .search_scope(req.org_id, req.company_id, req.query.trim(), top_k)
        .await
        .map_err(|error| {
            tracing::warn!(
                org_id = req.org_id,
                company_id = req.company_id,
                error = %error,
                "Context semantic retrieval unavailable"
            );
            AppError::Unavailable("semantic retrieval unavailable".into())
        })?;
    let candidates = resolve_snapshot_candidates(None, &[], &candidate_hits, top_k);
    let snapshots =
        fetch_authorized_live_snapshots(&state, &actor, req.org_id, req.company_id, &candidates)
            .await
            .map_err(|_| AppError::Unavailable("authoritative resolver unavailable".into()))?;
    let authorized = snapshots
        .iter()
        .map(|snapshot| (snapshot.entity_type.as_str(), snapshot.entity_id))
        .collect::<std::collections::HashSet<_>>();
    let hits = candidate_hits
        .into_iter()
        .filter(|hit| {
            hit.record
                .semantic
                .resource_id
                .parse::<u64>()
                .ok()
                .is_some_and(|id| {
                    authorized.contains(&(hit.record.semantic.resource_kind.as_str(), id))
                })
        })
        .collect::<Vec<_>>();

    tracing::info!(
        org_id = req.org_id,
        top_k,
        hit_count = hits.len(),
        "Org context search completed"
    );

    Ok(Json(ContextSearchResponse { hits }))
}

pub async fn post_ingest() -> AppResult<StatusCode> {
    Err(AppError::Unavailable(
        "Activity indexing is deferred until an authorized indexing projection is available".into(),
    ))
}

pub async fn post_document() -> AppResult<StatusCode> {
    Err(AppError::Unavailable(
        "Document indexing is deferred until the authoritative bucket/FileVersion lifecycle is available"
            .into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn activity_and_document_ingestion_are_unavailable() {
        assert!(matches!(post_ingest().await, Err(AppError::Unavailable(_))));
        assert!(matches!(
            post_document().await,
            Err(AppError::Unavailable(_))
        ));
    }
}
