//! Dedicated harness skill routes (fenced off legacy `/v1/skills/run`).

use axum::{extract::State, Json};
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::{
    error::{AppError, AppResult},
    harness::{
        daily_briefing::{
            run_daily_briefing, DailyBriefingInput, DailyBriefingResult, DAILY_BRIEFING_SKILL_KEY,
            DAILY_BRIEFING_SKILL_VERSION,
        },
        data_scope_resolver::ResourceRegistry,
        governed_llm_skills::{
            run_governed_llm_skill, GovernedLlmSkillInput, GovernedLlmSkillResult,
            LLM_BUNDLED_SKILL_VERSION, PRICE_SEARCH_SKILL_KEY, PROCESS_RESEARCH_SKILL_KEY,
            REPORT_ANALYSIS_SKILL_KEY, SUPPLIER_DISCOVERY_SKILL_KEY,
        },
        import_mapping::{
            run_import_mapping, ImportMappingInput, ImportMappingResult, IMPORT_MAPPING_SKILL_KEY,
            IMPORT_MAPPING_SKILL_VERSION,
        },
        insights_scan::{
            run_insights_scan, InsightsScanHarnessResult, InsightsScanInput,
            INSIGHTS_SCAN_SKILL_KEY, INSIGHTS_SCAN_SKILL_VERSION,
        },
        manifest::OrgPrivacyPolicy,
        policy_engine::PolicyEngine,
        release_registry::load_active_manifest,
        skill_registry::SkillRegistry,
    },
    state::AppState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayImportMappingRequest {
    pub org_id: u64,
    pub company_id: u64,
    pub target_entity: String,
    pub csv_text: Option<String>,
    pub headers: Option<Vec<String>>,
    pub sample_rows: Option<Vec<Vec<String>>>,
    pub mapping: Option<Map<String, Value>>,
    pub prior_mappings: Option<Map<String, Value>>,
    pub bundle_key: Option<String>,
    pub max_rows: Option<usize>,
    pub stdb_token: String,
    pub identity_hex: Option<String>,
    #[serde(default)]
    pub org_privacy_policy: OrgPrivacyPolicy,
}

pub async fn post_import_mapping(
    State(state): State<AppState>,
    Json(req): Json<GatewayImportMappingRequest>,
) -> AppResult<Json<ImportMappingResult>> {
    validate_scope(req.org_id, req.company_id, &req.stdb_token)?;
    let identity_hex = identity_or(req.identity_hex, "import-mapping");
    let policy = policy_for(
        &state,
        req.org_id,
        IMPORT_MAPPING_SKILL_KEY,
        IMPORT_MAPPING_SKILL_VERSION,
        req.org_privacy_policy,
    )
    .await?;
    let result = run_import_mapping(
        req.org_id,
        &identity_hex,
        ImportMappingInput {
            target_entity: req.target_entity,
            csv_text: req.csv_text,
            headers: req.headers,
            sample_rows: req.sample_rows,
            mapping: req.mapping,
            prior_mappings: req.prior_mappings,
            bundle_key: req.bundle_key,
            max_rows: req.max_rows,
        },
        req.company_id,
        policy,
    )
    .map_err(AppError::Internal)?;
    Ok(Json(result))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayInsightsScanRequest {
    pub org_id: u64,
    pub company_id: u64,
    pub max_insights: Option<usize>,
    pub abnormal_amount_threshold: Option<f64>,
    pub stdb_token: String,
    pub identity_hex: Option<String>,
    #[serde(default)]
    pub org_privacy_policy: OrgPrivacyPolicy,
}

pub async fn post_insights_scan(
    State(state): State<AppState>,
    Json(req): Json<GatewayInsightsScanRequest>,
) -> AppResult<Json<InsightsScanHarnessResult>> {
    validate_scope(req.org_id, req.company_id, &req.stdb_token)?;
    let identity_hex = identity_or(req.identity_hex, "insights-scan");
    let policy = policy_for(
        &state,
        req.org_id,
        INSIGHTS_SCAN_SKILL_KEY,
        INSIGHTS_SCAN_SKILL_VERSION,
        req.org_privacy_policy,
    )
    .await?;
    let result = run_insights_scan(
        &state,
        req.org_id,
        &identity_hex,
        InsightsScanInput {
            max_insights: req.max_insights,
            abnormal_amount_threshold: req.abnormal_amount_threshold,
        },
        req.company_id,
        policy,
    )
    .await
    .map_err(AppError::Internal)?;
    Ok(Json(result))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayDailyBriefingRequest {
    pub org_id: u64,
    pub company_id: u64,
    pub since_micros: Option<i64>,
    pub until_micros: Option<i64>,
    #[serde(default)]
    pub allowed_modules: Vec<String>,
    pub activity_query: Option<String>,
    pub top_k: Option<usize>,
    pub stdb_token: String,
    pub identity_hex: Option<String>,
    #[serde(default)]
    pub org_privacy_policy: OrgPrivacyPolicy,
}

pub async fn post_daily_briefing(
    State(state): State<AppState>,
    Json(req): Json<GatewayDailyBriefingRequest>,
) -> AppResult<Json<DailyBriefingResult>> {
    validate_scope(req.org_id, req.company_id, &req.stdb_token)?;
    let identity_hex = identity_or(req.identity_hex, "daily-briefing");
    let policy = policy_for(
        &state,
        req.org_id,
        DAILY_BRIEFING_SKILL_KEY,
        DAILY_BRIEFING_SKILL_VERSION,
        req.org_privacy_policy,
    )
    .await?;
    let result = run_daily_briefing(
        state.rig.as_ref(),
        req.org_id,
        &identity_hex,
        DailyBriefingInput {
            since_micros: req.since_micros,
            until_micros: req.until_micros,
            allowed_modules: req.allowed_modules,
            activity_query: req.activity_query,
            top_k: req.top_k,
        },
        req.company_id,
        policy,
    )
    .await
    .map_err(AppError::Internal)?;
    Ok(Json(result))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayGovernedLlmSkillRequest {
    pub org_id: u64,
    pub company_id: u64,
    #[serde(default)]
    pub inputs: Value,
    pub agent_id: Option<u64>,
    pub team_member_id: Option<u64>,
    pub max_steps: Option<u32>,
    pub stdb_token: String,
    pub identity_hex: Option<String>,
    #[serde(default)]
    pub org_privacy_policy: OrgPrivacyPolicy,
}

pub async fn post_report_analysis(
    State(state): State<AppState>,
    Json(req): Json<GatewayGovernedLlmSkillRequest>,
) -> AppResult<Json<GovernedLlmSkillResult>> {
    run_llm_route(&state, req, REPORT_ANALYSIS_SKILL_KEY).await
}

pub async fn post_process_research(
    State(state): State<AppState>,
    Json(req): Json<GatewayGovernedLlmSkillRequest>,
) -> AppResult<Json<GovernedLlmSkillResult>> {
    run_llm_route(&state, req, PROCESS_RESEARCH_SKILL_KEY).await
}

pub async fn post_price_search(
    State(state): State<AppState>,
    Json(req): Json<GatewayGovernedLlmSkillRequest>,
) -> AppResult<Json<GovernedLlmSkillResult>> {
    run_llm_route(&state, req, PRICE_SEARCH_SKILL_KEY).await
}

pub async fn post_supplier_discovery(
    State(state): State<AppState>,
    Json(req): Json<GatewayGovernedLlmSkillRequest>,
) -> AppResult<Json<GovernedLlmSkillResult>> {
    run_llm_route(&state, req, SUPPLIER_DISCOVERY_SKILL_KEY).await
}

async fn run_llm_route(
    state: &AppState,
    req: GatewayGovernedLlmSkillRequest,
    skill_key: &str,
) -> AppResult<Json<GovernedLlmSkillResult>> {
    validate_scope(req.org_id, req.company_id, &req.stdb_token)?;
    let identity_hex = identity_or(req.identity_hex, &skill_key.replace('_', "-"));
    let policy = policy_for(
        state,
        req.org_id,
        skill_key,
        LLM_BUNDLED_SKILL_VERSION,
        req.org_privacy_policy,
    )
    .await?;
    let result = run_governed_llm_skill(
        state,
        skill_key,
        req.org_id,
        &identity_hex,
        &req.stdb_token,
        GovernedLlmSkillInput {
            inputs: req.inputs,
            agent_id: req.agent_id,
            team_member_id: req.team_member_id,
            max_steps: req.max_steps,
        },
        req.company_id,
        policy,
    )
    .await
    .map_err(AppError::Internal)?;
    Ok(Json(result))
}

async fn policy_for(
    state: &AppState,
    org_id: u64,
    skill_key: &str,
    skill_version: u32,
    org_privacy_policy: OrgPrivacyPolicy,
) -> AppResult<PolicyEngine> {
    let manifest = load_active_manifest(&state.stdb, org_id, skill_key, skill_version)
        .await
        .map_err(AppError::Forbidden)?;
    Ok(
        PolicyEngine::new(SkillRegistry::exact(manifest), ResourceRegistry::built_in())
            .with_org_privacy(org_privacy_policy),
    )
}

fn identity_or(identity_hex: Option<String>, fallback: &str) -> String {
    identity_hex.unwrap_or_else(|| fallback.to_string())
}

fn validate_scope(org_id: u64, company_id: u64, stdb_token: &str) -> AppResult<()> {
    if org_id == 0 {
        return Err(AppError::BadRequest("org_id is required".into()));
    }
    if company_id == 0 {
        return Err(AppError::BadRequest("company_id is required".into()));
    }
    if stdb_token.trim().is_empty() {
        return Err(AppError::BadRequest("stdb_token is required".into()));
    }
    Ok(())
}
