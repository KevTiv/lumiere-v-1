//! Promoted green skill: low-stock inventory scan.

use axum::{extract::State, Json};
use serde::Deserialize;

use crate::{
    error::{AppError, AppResult},
    harness::{
        data_scope_resolver::ResourceRegistry,
        low_stock::{
            scan_low_stock, LowStockInput, LowStockScanResult, LOW_STOCK_SKILL_KEY,
            LOW_STOCK_SKILL_VERSION,
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
pub struct GatewayLowStockScanRequest {
    pub org_id: u64,
    pub company_id: u64,
    pub threshold: f64,
    pub location_id: Option<u64>,
    pub stdb_token: String,
    pub identity_hex: Option<String>,
    #[serde(default)]
    pub org_privacy_policy: OrgPrivacyPolicy,
}

pub async fn post_scan(
    State(state): State<AppState>,
    Json(req): Json<GatewayLowStockScanRequest>,
) -> AppResult<Json<LowStockScanResult>> {
    if req.org_id == 0 {
        return Err(AppError::BadRequest("org_id is required".into()));
    }
    if req.company_id == 0 {
        return Err(AppError::BadRequest("company_id is required".into()));
    }
    if req.stdb_token.trim().is_empty() {
        return Err(AppError::BadRequest("stdb_token is required".into()));
    }
    if !req.threshold.is_finite() || req.threshold < 0.0 {
        return Err(AppError::BadRequest(
            "threshold must be a finite non-negative number".into(),
        ));
    }

    let identity_hex = req.identity_hex.unwrap_or_else(|| "low-stock".to_string());
    let manifest = load_active_manifest(
        &state.stdb,
        req.org_id,
        LOW_STOCK_SKILL_KEY,
        LOW_STOCK_SKILL_VERSION,
    )
    .await
    .map_err(AppError::Forbidden)?;
    let policy = PolicyEngine::new(SkillRegistry::exact(manifest), ResourceRegistry::built_in())
        .with_org_privacy(req.org_privacy_policy);
    let stdb = state.stdb.with_token(req.stdb_token);

    let result = scan_low_stock(
        &stdb,
        req.org_id,
        &identity_hex,
        LowStockInput {
            threshold: req.threshold,
            location_id: req.location_id,
        },
        req.company_id,
        policy,
    )
    .await
    .map_err(AppError::Internal)?;

    Ok(Json(result))
}
