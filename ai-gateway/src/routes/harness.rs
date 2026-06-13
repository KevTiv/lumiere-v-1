//! Standalone live ERP snapshot reads for harness tools (action drafts, briefing, etc.).

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, AppResult},
    harness::snapshot::{
        fetch_live_snapshots, filter_entity_refs_by_allowed_types, EntityRef,
        HARNESS_MAX_LIVE_SNAPSHOTS, LiveSnapshot,
    },
    state::AppState,
};

#[derive(Debug, Deserialize, Default)]
pub struct HarnessSnapshotUiContext {
    pub entity_type: Option<String>,
    pub entity_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct HarnessEntityInput {
    pub entity_type: String,
    pub entity_id: u64,
    #[serde(default = "default_entity_priority")]
    pub priority: f32,
}

fn default_entity_priority() -> f32 {
    1.0
}

#[derive(Debug, Deserialize)]
pub struct HarnessSnapshotRequest {
    pub org_id: u64,
    pub company_id: u64,
    #[serde(default)]
    pub entities: Vec<HarnessEntityInput>,
    pub ui_context: Option<HarnessSnapshotUiContext>,
    #[serde(default = "default_max_snapshots")]
    pub max_snapshots: usize,
    #[serde(default)]
    pub allowed_entity_types: Vec<String>,
}

fn default_max_snapshots() -> usize {
    HARNESS_MAX_LIVE_SNAPSHOTS
}

#[derive(Debug, Serialize)]
pub struct HarnessSnapshotResponse {
    pub snapshots: Vec<LiveSnapshot>,
}

fn resolve_request_entities(req: &HarnessSnapshotRequest) -> Vec<EntityRef> {
    let mut out: Vec<EntityRef> = req
        .entities
        .iter()
        .map(|entity| EntityRef {
            entity_type: entity.entity_type.clone(),
            entity_id: entity.entity_id,
            priority: entity.priority,
        })
        .collect();

    if out.is_empty() {
        if let Some(ctx) = req.ui_context.as_ref() {
            if let (Some(entity_type), Some(entity_id)) = (
                ctx.entity_type.as_deref().filter(|value| !value.is_empty()),
                ctx.entity_id.as_deref().filter(|value| !value.is_empty()),
            ) {
                if let Some(id) = entity_id.parse::<u64>().ok().filter(|id| *id > 0) {
                    out.push(EntityRef {
                        entity_type: entity_type.to_string(),
                        entity_id: id,
                        priority: 1.0,
                    });
                }
            }
        }
    }

    out.sort_by(|a, b| {
        b.priority
            .partial_cmp(&a.priority)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let max = req.max_snapshots.clamp(1, HARNESS_MAX_LIVE_SNAPSHOTS);
    let mut seen = std::collections::HashSet::new();
    let mut deduped = Vec::new();
    for candidate in out {
        let key = (candidate.entity_type.clone(), candidate.entity_id);
        if seen.insert(key) {
            deduped.push(candidate);
        }
        if deduped.len() >= max {
            break;
        }
    }

    deduped
}

pub async fn post_snapshot(
    State(state): State<AppState>,
    Json(req): Json<HarnessSnapshotRequest>,
) -> AppResult<Json<HarnessSnapshotResponse>> {
    if req.org_id == 0 {
        return Err(AppError::BadRequest("org_id is required".into()));
    }
    if req.company_id == 0 {
        return Err(AppError::BadRequest("company_id is required".into()));
    }

    let allowed = (!req.allowed_entity_types.is_empty()).then_some(req.allowed_entity_types.as_slice());
    let candidates = filter_entity_refs_by_allowed_types(resolve_request_entities(&req), allowed);

    if candidates.is_empty() {
        return Ok(Json(HarnessSnapshotResponse {
            snapshots: Vec::new(),
        }));
    }

    let snapshots = fetch_live_snapshots(
        &state.stdb,
        req.org_id,
        req.company_id,
        &candidates,
    )
    .await
    .map_err(|err| AppError::Internal(err.to_string()))?;

    tracing::info!(
        org_id = req.org_id,
        company_id = req.company_id,
        requested = candidates.len(),
        resolved = snapshots.len(),
        "Harness live snapshots fetched"
    );

    Ok(Json(HarnessSnapshotResponse { snapshots }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_entities_from_ui_context() {
        let req = HarnessSnapshotRequest {
            org_id: 1,
            company_id: 2,
            entities: Vec::new(),
            ui_context: Some(HarnessSnapshotUiContext {
                entity_type: Some("sale_order".into()),
                entity_id: Some("42".into()),
            }),
            max_snapshots: 3,
            allowed_entity_types: Vec::new(),
        };
        let refs = resolve_request_entities(&req);
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].entity_id, 42);
    }
}
