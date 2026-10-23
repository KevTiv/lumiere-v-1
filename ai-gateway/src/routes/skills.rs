//! Skill catalog and the retired legacy-run migration boundary.

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, AppResult},
    harness::legacy_fence::governed_skill_replacement,
    orchestrator::skill_loader::{list_skills, sync_bundled_skills},
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct GatewayRunSkillRequest {
    pub org_id: u64,
    pub company_id: u64,
    pub skill_key: String,
}

#[derive(Debug, Serialize)]
pub struct SkillListItem {
    pub id: u64,
    pub skill_key: String,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub is_system: bool,
    #[serde(default)]
    pub source: Option<String>,
    /// Replacement for the retired `/v1/skills/run` endpoint, when this
    /// bundled skill has a governed adapter. Custom skills remain visible but
    /// are not represented as executable until an adapter is registered.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_route: Option<&'static str>,
    pub legacy_run_supported: bool,
}

pub async fn get_skills(
    State(state): State<AppState>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> AppResult<Json<Vec<SkillListItem>>> {
    let org_id = params
        .get("org_id")
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|id| *id > 0)
        .ok_or_else(|| AppError::BadRequest("org_id is required".into()))?;

    let rows = list_skills(state.stdb.as_ref(), org_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for row in rows {
        let skill_key = row
            .get("skillKey")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if skill_key.is_empty() || !seen.insert(skill_key.clone()) {
            continue;
        }
        let execution_route = governed_skill_replacement(&skill_key);
        out.push(SkillListItem {
            id: row.get("id").and_then(|v| v.as_u64()).unwrap_or(0),
            skill_key,
            name: row
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            description: row
                .get("description")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            category: row
                .get("category")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            is_system: row
                .get("isSystem")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            source: row
                .get("source")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            execution_route,
            legacy_run_supported: false,
        });
    }

    Ok(Json(out))
}

#[derive(Debug, Deserialize)]
pub struct GatewaySyncSkillsRequest {
    pub org_id: u64,
    pub stdb_token: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SyncSkillsResponse {
    pub synced: Vec<String>,
    pub skills_dir: String,
}

pub async fn post_sync(
    State(state): State<AppState>,
    Json(req): Json<GatewaySyncSkillsRequest>,
) -> AppResult<Json<SyncSkillsResponse>> {
    if req.org_id == 0 {
        return Err(AppError::BadRequest("org_id is required".into()));
    }

    let stdb = req
        .stdb_token
        .as_ref()
        .filter(|t| !t.trim().is_empty())
        .map(|token| state.stdb.with_token(token.clone()))
        .unwrap_or_else(|| state.stdb.as_ref().clone());

    let synced = sync_bundled_skills(&stdb, req.org_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(SyncSkillsResponse {
        synced,
        skills_dir: crate::skills::resolve_skills_dir()
            .to_string_lossy()
            .to_string(),
    }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LegacyRunRetiredResponse {
    error: String,
    code: &'static str,
    skill_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    replacement_path: Option<&'static str>,
}

/// The legacy route is retained as a migration signal instead of disappearing
/// as a 404 or attempting an unsafe compatibility execution. No request body
/// field can re-enable the old model-driven loop.
pub async fn post_run(Json(req): Json<GatewayRunSkillRequest>) -> Response {
    if req.org_id == 0 {
        return AppError::BadRequest("org_id is required".into()).into_response();
    }
    if req.company_id == 0 {
        return AppError::BadRequest("company_id is required".into()).into_response();
    }
    let skill_key = req.skill_key.trim();
    if skill_key.is_empty() {
        return AppError::BadRequest("skill_key is required".into()).into_response();
    }

    let replacement_path = governed_skill_replacement(skill_key);
    let error = match replacement_path {
        Some(path) => format!(
            "skill '{skill_key}' has migrated from /v1/skills/run; use {path}"
        ),
        None => format!(
            "skill '{skill_key}' has no governed execution adapter; register and certify one before execution"
        ),
    };
    (
        StatusCode::GONE,
        Json(LegacyRunRetiredResponse {
            error,
            code: "legacy_skill_run_retired",
            skill_key: skill_key.to_string(),
            replacement_path,
        }),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(skill_key: &str) -> GatewayRunSkillRequest {
        GatewayRunSkillRequest {
            org_id: 1,
            company_id: 2,
            skill_key: skill_key.to_string(),
        }
    }

    #[tokio::test]
    async fn legacy_run_returns_gone_for_migrated_and_custom_skills() {
        let migrated = post_run(Json(request("low_stock"))).await;
        assert_eq!(migrated.status(), StatusCode::GONE);
        let body = axum::body::to_bytes(migrated.into_body(), 8_192)
            .await
            .expect("retirement body");
        let body: serde_json::Value = serde_json::from_slice(&body).expect("retirement JSON");
        assert_eq!(body["code"], "legacy_skill_run_retired");
        assert_eq!(body["skillKey"], "low_stock");
        assert_eq!(body["replacementPath"], "/v1/skills/inventory/low-stock");

        let custom = post_run(Json(request("custom_tenant_skill"))).await;
        assert_eq!(custom.status(), StatusCode::GONE);
        let body = axum::body::to_bytes(custom.into_body(), 8_192)
            .await
            .expect("retirement body");
        let body: serde_json::Value = serde_json::from_slice(&body).expect("retirement JSON");
        assert_eq!(body["skillKey"], "custom_tenant_skill");
        assert!(body.get("replacementPath").is_none());
        assert!(body["error"]
            .as_str()
            .is_some_and(|message| message.contains("governed execution adapter")));
    }

    #[tokio::test]
    async fn legacy_run_still_validates_required_scope() {
        let mut req = request("low_stock");
        req.company_id = 0;
        let response = post_run(Json(req)).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}
