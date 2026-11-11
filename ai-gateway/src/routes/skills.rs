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
    orchestrator::{
        skill_loader::{intelligence_policy_ref, list_skills, skill_agent_id, sync_bundled_skills},
        surface_provisioning::{existing_generation_surfaces, ProvisionedSurface},
        surface_provisioning_api::{setup_error, ApiSurfaceWriter},
    },
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

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GatewayProvisionSurfacesRequest {
    pub org_id: u64,
    pub company_id: Option<u64>,
    /// API bearer credential; hosted sessions carry a WorkOS access token.
    pub stdb_token: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct ProvisionSurfacesResponse {
    pub skills: Vec<ProvisionedSurface>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub company_setup: Option<CompanySetup>,
}

#[derive(Debug, Serialize)]
pub(crate) struct CompanySetup {
    company_id: u64,
    status: &'static str,
    message: &'static str,
}

/// Explicit catalog repair through the administrator's canonical API session.
/// Only the scope-validated catalog read uses the configured native credential.
pub async fn post_provision_surfaces(
    State(state): State<AppState>,
    Json(req): Json<GatewayProvisionSurfacesRequest>,
) -> AppResult<Json<ProvisionSurfacesResponse>> {
    if req.org_id == 0 {
        return Err(AppError::BadRequest("org_id is required".into()));
    }
    if req.company_id == Some(0) {
        return Err(AppError::BadRequest("company_id must be positive".into()));
    }
    if req.stdb_token.trim().is_empty() {
        return Err(AppError::Forbidden(
            "an authenticated administrator token is required".into(),
        ));
    }
    let writer = ApiSurfaceWriter::authorize(
        state.config.api_server_url.as_deref(),
        &req.stdb_token,
        req.org_id,
    )
    .await
    .map_err(setup_error)?;
    let skills;
    let company_setup = if let Some(company_id) = req.company_id {
        // Reuse the explicitly approved company harness binding. A missing profile
        // is an actionable setup state, never permission to select an arbitrary agent.
        if let Some((agent_id, policy)) = company_harness_binding(
            state.stdb.as_ref(),
            req.org_id,
            company_id,
            "report_analysis",
        )
        .await
        .map_err(AppError::from_agent_resolution)?
        {
            skills = writer
                .provision(state.stdb.as_ref())
                .await
                .map_err(setup_error)?;
            writer
                .provision_company_defaults(company_id, agent_id, &policy)
                .await
                .map_err(setup_error)?;
            let bound = company_chat_bound(state.stdb.as_ref(), req.org_id, company_id, agent_id)
                .await
                .map_err(AppError::from_agent_resolution)?;
            Some(CompanySetup {
                company_id,
                status: if bound { "configured" } else { "preserved" },
                message: "Default AI bindings applied where eligible. Existing custom settings and disabled features are preserved.",
            })
        } else {
            writer
                .enroll_company_defaults(company_id)
                .await
                .map_err(setup_error)?;
            skills = existing_generation_surfaces(state.stdb.as_ref(), req.org_id)
                .await
                .map_err(setup_error)?;
            let status = managed_company_setup_status(state.stdb.as_ref(), req.org_id, company_id)
                .await
                .map_err(AppError::from_agent_resolution)?;
            Some(CompanySetup {
                company_id,
                status,
                message: match status {
                    "configured" => "The platform AI profile is applied. Existing custom settings and disabled features are preserved.",
                    "preserved" => "Existing AI settings are preserved. This company's chat binding is disabled or unavailable; review the company configuration before using chat.",
                    _ => "No managed AI defaults were applied. A platform administrator must configure an available profile, or review this organization's existing custom setup.",
                },
            })
        }
    } else {
        skills = writer
            .provision(state.stdb.as_ref())
            .await
            .map_err(setup_error)?;
        None
    };
    Ok(Json(ProvisionSurfacesResponse {
        skills,
        company_setup,
    }))
}

async fn managed_company_setup_status(
    reader: &stdb_client::StdbClient,
    org_id: u64,
    company_id: u64,
) -> anyhow::Result<&'static str> {
    let rows = reader.query_sql(&format!(
        "SELECT agent_id, is_enabled FROM ai_managed_enrollment WHERE organization_id = {org_id} LIMIT 2"
    )).await?;
    let [row] = rows.as_slice() else {
        return Ok("profile_required");
    };
    if row
        .get("isEnabled")
        .or_else(|| row.get("is_enabled"))
        .and_then(serde_json::Value::as_bool)
        != Some(true)
    {
        return Ok("preserved");
    }
    let Some(agent_id) = crate::wire_decode::row_u64(row, "agentId", "agent_id") else {
        return Ok("preserved");
    };
    Ok(
        if company_chat_bound(reader, org_id, company_id, agent_id).await? {
            "configured"
        } else {
            "preserved"
        },
    )
}

async fn company_chat_bound(
    reader: &stdb_client::StdbClient,
    org_id: u64,
    company_id: u64,
    agent_id: u64,
) -> anyhow::Result<bool> {
    let companies = reader.query_sql(&format!(
        "SELECT deleted_at FROM company WHERE organization_id = {org_id} AND id = {company_id} LIMIT 2"
    )).await?;
    let [company] = companies.as_slice() else {
        return Ok(false);
    };
    // SpacetimeDB SQL does not support IS NULL on optional columns.
    if !company
        .get("deletedAt")
        .or_else(|| company.get("deleted_at"))
        .is_some_and(serde_json::Value::is_null)
    {
        return Ok(false);
    }
    let agents = reader.query_sql(&format!(
        "SELECT id, company_id, allowed_actions FROM ai_agent WHERE organization_id = {org_id} AND id = {agent_id} AND is_active = true LIMIT 2"
    )).await?;
    let [agent] = agents.as_slice() else {
        return Ok(false);
    };
    let scope = agent.get("companyId").or_else(|| agent.get("company_id"));
    if !matches!(scope, Some(serde_json::Value::Null))
        && scope.and_then(serde_json::Value::as_u64) != Some(company_id)
    {
        return Ok(false);
    }
    if !agent
        .get("allowedActions")
        .or_else(|| agent.get("allowed_actions"))
        .and_then(serde_json::Value::as_array)
        .is_some_and(|actions| actions.iter().any(|action| action.as_str() == Some("chat")))
    {
        return Ok(false);
    }
    let binding = company_harness_binding(reader, org_id, company_id, "rag_generation").await?;
    Ok(binding.is_some_and(|(bound, _)| bound == agent_id))
}

async fn company_harness_binding(
    reader: &stdb_client::StdbClient,
    org_id: u64,
    company_id: u64,
    skill_key: &'static str,
) -> anyhow::Result<Option<(u64, String)>> {
    let local = reader.query_sql(&format!(
        "SELECT id, is_active FROM ai_skill WHERE organization_id = {org_id} AND skill_key = '{skill_key}' LIMIT 2"
    )).await?;
    let skills = if local.is_empty() {
        reader.query_sql(&format!("SELECT id, is_active FROM ai_skill WHERE organization_id = 0 AND skill_key = '{skill_key}' LIMIT 2")).await?
    } else {
        local
    };
    let [skill] = skills.as_slice() else {
        return Ok(None);
    };
    if skill
        .get("isActive")
        .or_else(|| skill.get("is_active"))
        .and_then(serde_json::Value::as_bool)
        != Some(true)
    {
        return Ok(None);
    }
    let Some(skill_id) = crate::wire_decode::row_u64(skill, "id", "id") else {
        return Ok(None);
    };
    let configs = reader.query_sql(&format!(
        "SELECT company_id, is_enabled, config_json FROM ai_skill_config WHERE organization_id = {org_id} AND skill_id = {skill_id}"
    )).await?;
    exact_company_harness_binding(&configs, company_id)
}

fn exact_company_harness_binding(
    configs: &[serde_json::Value],
    company_id: u64,
) -> anyhow::Result<Option<(u64, String)>> {
    // The optional company ID cannot be compared with a scalar in SpacetimeDB SQL.
    // Enrollment only reuses an explicit binding for this company.
    let mut matches = configs.iter().filter(|row| {
        crate::wire_decode::row_u64(row, "companyId", "company_id") == Some(company_id)
    });
    let (Some(config), None) = (matches.next(), matches.next()) else {
        return Ok(None);
    };
    if config
        .get("isEnabled")
        .or_else(|| config.get("is_enabled"))
        .and_then(serde_json::Value::as_bool)
        != Some(true)
    {
        return Ok(None);
    }
    let Some(raw) = config
        .get("configJson")
        .or_else(|| config.get("config_json"))
        .and_then(serde_json::Value::as_str)
    else {
        return Ok(None);
    };
    let settings = serde_json::from_str(raw)?;
    match (
        skill_agent_id(&settings, None, None)?,
        intelligence_policy_ref(&settings)?,
    ) {
        (Some(agent), Some(policy)) => Ok(Some((agent, policy))),
        _ => Ok(None),
    }
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

    #[test]
    fn managed_setup_accepts_only_company_scope_from_client() {
        let request: GatewayProvisionSurfacesRequest = serde_json::from_value(serde_json::json!({
            "org_id": 1, "company_id": 7, "stdb_token": "session"
        }))
        .unwrap();
        assert_eq!(request.company_id, Some(7));
        for key in [
            "agent_id",
            "intelligence_policy_ref",
            "model",
            "monthly_budget",
        ] {
            let mut payload =
                serde_json::json!({"org_id": 1, "company_id": 7, "stdb_token": "session"});
            payload[key] = serde_json::json!("untrusted override");
            assert!(serde_json::from_value::<GatewayProvisionSurfacesRequest>(payload).is_err());
        }
    }

    #[test]
    fn harness_binding_requires_one_enabled_config_for_the_exact_company() {
        let config = |company_id, is_enabled| {
            serde_json::json!({
                "companyId": company_id,
                "isEnabled": is_enabled,
                "configJson": r#"{"defaultAgentId":42,"intelligencePolicyRef":"reviewed@1"}"#
            })
        };
        let inherited = config(serde_json::Value::Null, true);
        let sibling = config(serde_json::json!(8), true);
        let exact = config(serde_json::json!("7"), true);
        let disabled = config(serde_json::json!(7), false);

        assert_eq!(
            exact_company_harness_binding(&[inherited.clone(), sibling.clone(), exact.clone()], 7)
                .unwrap(),
            Some((42, "reviewed@1".into()))
        );
        for rows in [
            vec![inherited, sibling],
            vec![disabled],
            vec![exact.clone(), exact],
        ] {
            assert_eq!(exact_company_harness_binding(&rows, 7).unwrap(), None);
        }
    }

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
