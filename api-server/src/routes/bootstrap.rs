//! `/v1/bootstrap/*` — parity with `frontend/web/app/api/bootstrap/tenant/route.ts`.

use std::sync::Arc;

use axum::{extract::State, http::HeaderMap, routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tower_cookies::Cookies;

use crate::error::ApiError;
use crate::session::resolve_api_session;
use crate::state::AppState;
use crate::web_session::stdb_identity_hex_hint;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OrganizationInput {
    pub name: String,
    pub code: String,
    pub timezone: String,
    pub date_format: String,
    pub language: String,
    pub is_active: bool,
    pub description: Option<String>,
    pub logo_url: Option<String>,
    pub website: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub currency_id: Option<u64>,
    pub metadata: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsInput {
    pub module_config: Option<String>,
    pub feature_flags: Vec<String>,
    pub integration_keys: Option<String>,
    pub metadata: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapTenantBody {
    pub organization: OrganizationInput,
    pub default_company_name: String,
    pub default_company_code: String,
    pub default_company_currency_code: String,
    pub fiscal_year_end_month: u32,
    pub fiscal_year_end_day: u32,
    pub seed_form_configs: bool,
    pub settings: SettingsInput,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapReducerArg {
    organization: OrganizationInput,
    default_company_name: String,
    default_company_code: String,
    default_company_currency_code: String,
    fiscal_year_end_month: u32,
    fiscal_year_end_day: u32,
    seed_form_configs: bool,
    settings: SettingsReducerArg,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsReducerArg {
    module_config: Option<String>,
    feature_flags: Vec<String>,
    integration_keys: Option<String>,
    metadata: Option<String>,
}

fn validate_bootstrap(b: &BootstrapTenantBody) -> Result<(), ApiError> {
    let o = &b.organization;
    if o.name.trim().is_empty() {
        return Err(ApiError::BadRequest("Organization name is required".into()));
    }
    if o.code.trim().is_empty() {
        return Err(ApiError::BadRequest("Organization code is required".into()));
    }
    if o.timezone.trim().is_empty() {
        return Err(ApiError::BadRequest("Timezone is required".into()));
    }
    if o.date_format.trim().is_empty() {
        return Err(ApiError::BadRequest("Date format is required".into()));
    }
    if o.language.trim().is_empty() {
        return Err(ApiError::BadRequest("Language is required".into()));
    }
    if b.default_company_name.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "Default company name is required".into(),
        ));
    }
    if b.default_company_code.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "Default company code is required".into(),
        ));
    }
    let cur = b.default_company_currency_code.trim();
    if cur.len() < 3 || cur.len() > 3 {
        return Err(ApiError::BadRequest(
            "defaultCompanyCurrencyCode must be exactly 3 characters".into(),
        ));
    }
    if !(1..=12).contains(&b.fiscal_year_end_month) {
        return Err(ApiError::BadRequest(
            "fiscalYearEndMonth must be between 1 and 12".into(),
        ));
    }
    if !(1..=31).contains(&b.fiscal_year_end_day) {
        return Err(ApiError::BadRequest(
            "fiscalYearEndDay must be between 1 and 31".into(),
        ));
    }
    Ok(())
}

async fn bootstrap_tenant_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<BootstrapTenantBody>,
) -> Result<Json<Value>, ApiError> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let id_hint = stdb_identity_hex_hint(&headers, &cookies);
    let cookie_tok = cookies.get("stdb_token").map(|c| c.value().to_string());

    let session = resolve_api_session(&state, auth, cookie_tok.as_deref(), id_hint.as_deref())
        .await?
        .ok_or(ApiError::Unauthorized)?;

    if session.identity_hex == "unknown" {
        return Err(ApiError::Unauthorized); // same message bucket as Next "Identity not resolved"
    }
    if session.organization_id.is_some() {
        return Err(ApiError::Conflict(
            "Already belongs to an organization".into(),
        ));
    }

    validate_bootstrap(&body)?;

    let arg = BootstrapReducerArg {
        organization: body.organization.clone(),
        default_company_name: body.default_company_name.clone(),
        default_company_code: body.default_company_code.clone(),
        default_company_currency_code: body.default_company_currency_code.to_uppercase(),
        fiscal_year_end_month: body.fiscal_year_end_month,
        fiscal_year_end_day: body.fiscal_year_end_day,
        seed_form_configs: body.seed_form_configs,
        settings: SettingsReducerArg {
            module_config: body.settings.module_config.clone(),
            feature_flags: body.settings.feature_flags.clone(),
            integration_keys: body.settings.integration_keys.clone(),
            metadata: body.settings.metadata.clone(),
        },
    };

    let payload = serde_json::to_value(&arg).map_err(|e| ApiError::Internal(e.to_string()))?;
    let client = state.client_with_token(&session.stdb_token);
    match client
        .call_reducer("bootstrap_new_tenant", json!([payload]))
        .await
    {
        Ok(()) => Ok(Json(json!({ "ok": true }))),
        Err(e) => Err(ApiError::Internal(e.to_string())),
    }
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/bootstrap/tenant", post(bootstrap_tenant_post))
}
