//! AIH-16/17: read-only source/decision inspection and scoped knowledge reuse.
//!
//! Both routes are reads. They re-authorize against the organization and
//! company at request time (see `orchestrator::evidence_inspector`) and never
//! return an excerpt for a source outside that scope, or for a passage whose
//! access was revoked or whose content was deleted.

use axum::{extract::State, Json};
use serde::Deserialize;

use crate::{
    error::{AppError, AppResult},
    orchestrator::evidence_inspector::{
        inspect, retrieve_reusable_knowledge, InspectTarget, Inspection, KnowledgeRetrieval, Viewer,
    },
    state::AppState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectRequest {
    pub org_id: u64,
    pub company_id: u64,
    /// component | decision | claim | knowledge_version
    pub kind: String,
    pub id: u64,
}

pub async fn post_inspect(
    State(state): State<AppState>,
    Json(req): Json<InspectRequest>,
) -> AppResult<Json<Inspection>> {
    if req.org_id == 0 || req.company_id == 0 || req.id == 0 {
        return Err(AppError::BadRequest(
            "orgId, companyId and id are required".into(),
        ));
    }
    let target = InspectTarget::parse(&req.kind, req.id).ok_or_else(|| {
        AppError::BadRequest("kind must be component, decision, claim or knowledge_version".into())
    })?;
    let viewer = Viewer {
        organization_id: req.org_id,
        company_id: req.company_id,
    };
    let inspection = inspect(state.stdb.as_ref(), viewer, target)
        .await
        .map_err(|error| {
            // A record outside the caller's scope reads as absent, not forbidden.
            if error.to_string().contains("not found") {
                AppError::NotFound(error.to_string())
            } else {
                AppError::Internal(error.to_string())
            }
        })?;
    Ok(Json(inspection))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeRetrieveRequest {
    pub org_id: u64,
    pub company_id: u64,
    pub entry_key: String,
}

pub async fn post_knowledge_retrieve(
    State(state): State<AppState>,
    Json(req): Json<KnowledgeRetrieveRequest>,
) -> AppResult<Json<KnowledgeRetrieval>> {
    if req.org_id == 0 || req.company_id == 0 {
        return Err(AppError::BadRequest(
            "orgId and companyId are required".into(),
        ));
    }
    let viewer = Viewer {
        organization_id: req.org_id,
        company_id: req.company_id,
    };
    let retrieval = retrieve_reusable_knowledge(state.stdb.as_ref(), viewer, &req.entry_key)
        .await
        .map_err(|error| AppError::Internal(error.to_string()))?;
    Ok(Json(retrieval))
}
