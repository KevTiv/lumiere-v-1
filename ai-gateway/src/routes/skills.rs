//! Skill catalog and orchestrated skill runs.

use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    error::{AppError, AppResult},
    orchestrator::{
        run::{run_skill, RunSkillRequest, RunSkillResponse},
        skill_loader::list_skills,
    },
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct GatewayRunSkillRequest {
    pub org_id: u64,
    pub company_id: u64,
    pub skill_key: String,
    #[serde(default)]
    pub inputs: Value,
    pub agent_id: Option<u64>,
    pub team_member_id: Option<u64>,
    pub triggered_by_hex: Option<String>,
    pub stdb_token: Option<String>,
    pub overrides: Option<crate::orchestrator::run::RunSkillOverrides>,
}

#[derive(Debug, Serialize)]
pub struct SkillListItem {
    pub id: u64,
    pub skill_key: String,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub is_system: bool,
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
        });
    }

    Ok(Json(out))
}

pub async fn post_run(
    State(state): State<AppState>,
    Json(req): Json<GatewayRunSkillRequest>,
) -> AppResult<Json<RunSkillResponse>> {
    if req.org_id == 0 {
        return Err(AppError::BadRequest("org_id is required".into()));
    }
    if req.company_id == 0 {
        return Err(AppError::BadRequest("company_id is required".into()));
    }
    if req.skill_key.trim().is_empty() {
        return Err(AppError::BadRequest("skill_key is required".into()));
    }

    let response = run_skill(
        &state,
        RunSkillRequest {
            org_id: req.org_id,
            company_id: req.company_id,
            skill_key: req.skill_key,
            inputs: if req.inputs.is_null() {
                Value::Object(Default::default())
            } else {
                req.inputs
            },
            agent_id: req.agent_id,
            team_member_id: req.team_member_id,
            triggered_by_hex: req.triggered_by_hex,
            stdb_token: req.stdb_token,
            overrides: req.overrides,
        },
    )
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(response))
}
