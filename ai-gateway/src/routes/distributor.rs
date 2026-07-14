//! Promoted read-only controls for the distributor workspace.

use axum::{extract::State, Json};
use serde::Deserialize;

use crate::{
    error::{AppError, AppResult},
    harness::{
        data_scope_resolver::ResourceRegistry,
        distributor_controls::{
            summarize_credit_exposure, summarize_delivery_run, CreditHoldInput,
            CreditHoldSummaryResult, DeliveryRunInput, DeliveryRunSummaryResult,
            CREDIT_HOLD_SKILL_KEY, DELIVERY_RUN_SKILL_KEY, DISTRIBUTOR_CONTROL_SKILL_VERSION,
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
pub struct GatewayCreditHoldSummaryRequest {
    pub org_id: u64,
    pub company_id: u64,
    pub minimum_outstanding: Option<f64>,
    pub stdb_token: String,
    pub identity_hex: Option<String>,
    #[serde(default)]
    pub org_privacy_policy: OrgPrivacyPolicy,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayDeliveryRunSummaryRequest {
    pub org_id: u64,
    pub company_id: u64,
    #[serde(default)]
    pub include_done: bool,
    pub stdb_token: String,
    pub identity_hex: Option<String>,
    #[serde(default)]
    pub org_privacy_policy: OrgPrivacyPolicy,
}

pub async fn post_credit_hold_summary(
    State(state): State<AppState>,
    Json(req): Json<GatewayCreditHoldSummaryRequest>,
) -> AppResult<Json<CreditHoldSummaryResult>> {
    validate_context(req.org_id, req.company_id, &req.stdb_token)?;
    let minimum_outstanding = req.minimum_outstanding.unwrap_or(0.01);
    if !minimum_outstanding.is_finite() || minimum_outstanding < 0.0 {
        return Err(AppError::BadRequest(
            "minimum_outstanding must be a finite non-negative number".into(),
        ));
    }
    let manifest = load_active_manifest(
        &state.stdb,
        req.org_id,
        CREDIT_HOLD_SKILL_KEY,
        DISTRIBUTOR_CONTROL_SKILL_VERSION,
    )
    .await
    .map_err(AppError::Forbidden)?;
    let policy = PolicyEngine::new(SkillRegistry::exact(manifest), ResourceRegistry::built_in())
        .with_org_privacy(req.org_privacy_policy);
    let stdb = state.stdb.with_token(req.stdb_token);
    let result = summarize_credit_exposure(
        &stdb,
        req.org_id,
        &req.identity_hex
            .unwrap_or_else(|| "credit-hold-summary".to_string()),
        CreditHoldInput {
            minimum_outstanding,
        },
        req.company_id,
        policy,
    )
    .await
    .map_err(AppError::Internal)?;
    Ok(Json(result))
}

pub async fn post_delivery_run_summary(
    State(state): State<AppState>,
    Json(req): Json<GatewayDeliveryRunSummaryRequest>,
) -> AppResult<Json<DeliveryRunSummaryResult>> {
    validate_context(req.org_id, req.company_id, &req.stdb_token)?;
    let manifest = load_active_manifest(
        &state.stdb,
        req.org_id,
        DELIVERY_RUN_SKILL_KEY,
        DISTRIBUTOR_CONTROL_SKILL_VERSION,
    )
    .await
    .map_err(AppError::Forbidden)?;
    let policy = PolicyEngine::new(SkillRegistry::exact(manifest), ResourceRegistry::built_in())
        .with_org_privacy(req.org_privacy_policy);
    let stdb = state.stdb.with_token(req.stdb_token);
    let result = summarize_delivery_run(
        &stdb,
        req.org_id,
        &req.identity_hex
            .unwrap_or_else(|| "delivery-run-summary".to_string()),
        DeliveryRunInput {
            include_done: req.include_done,
        },
        req.company_id,
        policy,
    )
    .await
    .map_err(AppError::Internal)?;
    Ok(Json(result))
}

fn validate_context(org_id: u64, company_id: u64, stdb_token: &str) -> AppResult<()> {
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
