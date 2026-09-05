//! `/v1/bootstrap/*` — parity with `frontend/web/app/api/bootstrap/tenant/route.ts`.

use std::sync::Arc;

use axum::{
    extract::State,
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
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
    pub default_company_currency_id: u64,
    /// New tenants select a catalog code; the reducer seeds that currency
    /// after the organization id exists. The id remains for compatibility and
    /// is accepted only when it is already organization-owned.
    pub default_company_currency_code: Option<String>,
    pub fiscal_year_end_month: u32,
    pub fiscal_year_end_day: u32,
    pub seed_form_configs: bool,
    pub settings: SettingsInput,
}

#[derive(Debug, Serialize)]
struct BootstrapReducerArg {
    organization: OrganizationReducerArg,
    default_company_name: String,
    default_company_code: String,
    default_company_currency_id: u64,
    default_company_currency_code: Option<String>,
    fiscal_year_end_month: u32,
    fiscal_year_end_day: u32,
    seed_form_configs: bool,
    settings: SettingsReducerArg,
}

#[derive(Debug, Serialize)]
struct SettingsReducerArg {
    module_config: Value,
    feature_flags: Vec<String>,
    integration_keys: Value,
    metadata: Value,
}

#[derive(Debug, Serialize)]
struct OrganizationReducerArg {
    name: String,
    code: String,
    timezone: String,
    date_format: String,
    language: String,
    is_active: bool,
    description: Value,
    logo_url: Value,
    website: Value,
    email: Value,
    phone: Value,
    currency_id: Value,
    metadata: Value,
}

fn stdb_option<T: Serialize>(value: Option<&T>) -> Value {
    match value {
        Some(value) => json!({ "some": value }),
        None => json!({ "none": [] }),
    }
}

impl From<&OrganizationInput> for OrganizationReducerArg {
    fn from(value: &OrganizationInput) -> Self {
        Self {
            name: value.name.clone(),
            code: value.code.clone(),
            timezone: value.timezone.clone(),
            date_format: value.date_format.clone(),
            language: value.language.clone(),
            is_active: value.is_active,
            description: stdb_option(value.description.as_ref()),
            logo_url: stdb_option(value.logo_url.as_ref()),
            website: stdb_option(value.website.as_ref()),
            email: stdb_option(value.email.as_ref()),
            phone: stdb_option(value.phone.as_ref()),
            currency_id: stdb_option(value.currency_id.as_ref()),
            metadata: stdb_option(value.metadata.as_ref()),
        }
    }
}

fn reducer_arg(body: &BootstrapTenantBody) -> BootstrapReducerArg {
    BootstrapReducerArg {
        organization: OrganizationReducerArg::from(&body.organization),
        default_company_name: body.default_company_name.clone(),
        default_company_code: body.default_company_code.clone(),
        default_company_currency_id: body.default_company_currency_id,
        default_company_currency_code: body.default_company_currency_code.clone(),
        fiscal_year_end_month: body.fiscal_year_end_month,
        fiscal_year_end_day: body.fiscal_year_end_day,
        seed_form_configs: body.seed_form_configs,
        settings: SettingsReducerArg {
            module_config: stdb_option(body.settings.module_config.as_ref()),
            feature_flags: body.settings.feature_flags.clone(),
            integration_keys: stdb_option(body.settings.integration_keys.as_ref()),
            metadata: stdb_option(body.settings.metadata.as_ref()),
        },
    }
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
    if o.currency_id.is_some() {
        return Err(ApiError::BadRequest(
            "organization.currencyId must be null during tenant bootstrap".into(),
        ));
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
    if b.default_company_currency_id == 0
        && b.default_company_currency_code
            .as_deref()
            .map(str::trim)
            .unwrap_or_default()
            .is_empty()
    {
        return Err(ApiError::BadRequest(
            "defaultCompanyCurrencyCode is required when no currency id is supplied".into(),
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

    let arg = reducer_arg(&body);

    let payload = serde_json::to_value(&arg).map_err(ApiError::internal)?;
    let client = state.client_with_token(&session.stdb_token);
    match client
        .call_reducer(stdb_client::reducer_call!(
            "bootstrap_new_tenant",
            json!([payload])
        ))
        .await
    {
        Ok(()) => Ok(Json(json!({ "ok": true }))),
        Err(e) => Err(ApiError::internal(e)),
    }
}

async fn bootstrap_currencies_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
) -> Result<Json<Value>, ApiError> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    let id_hint = stdb_identity_hex_hint(&headers, &cookies);
    let cookie_token = cookies
        .get("stdb_token")
        .map(|cookie| cookie.value().to_string());
    let session = resolve_api_session(&state, auth, cookie_token.as_deref(), id_hint.as_deref())
        .await?
        .ok_or(ApiError::Unauthorized)?;
    if session.identity_hex == "unknown" {
        return Err(ApiError::Unauthorized);
    }

    // This is a pre-tenant catalog, not a query over another organization's
    // rows. The reducer seeds the selected code after the new organization id
    // exists, so no global/sentinel currency row is required.
    let currencies = [
        ("USD", "US Dollar", "$", 2),
        ("EUR", "Euro", "€", 2),
        ("GBP", "British Pound", "£", 2),
        ("CAD", "Canadian Dollar", "C$", 2),
        ("AUD", "Australian Dollar", "A$", 2),
        ("JPY", "Japanese Yen", "¥", 0),
    ]
    .into_iter()
    .map(|(code, name, symbol, decimal_places)| {
        json!({
            "id": 0,
            "code": code,
            "name": name,
            "symbol": symbol,
            "decimalPlaces": decimal_places,
        })
    })
    .collect::<Vec<_>>();

    Ok(Json(json!({ "data": currencies })))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/bootstrap/currencies", get(bootstrap_currencies_get))
        .route("/bootstrap/tenant", post(bootstrap_tenant_post))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bootstrap_reducer_wire_uses_snake_case_and_stdb_options() {
        let body = BootstrapTenantBody {
            organization: OrganizationInput {
                name: "Acme".into(),
                code: "ACME".into(),
                timezone: "UTC".into(),
                date_format: "YYYY-MM-DD".into(),
                language: "en".into(),
                is_active: true,
                description: None,
                logo_url: None,
                website: None,
                email: None,
                phone: None,
                currency_id: None,
                metadata: Some("fixture".into()),
            },
            default_company_name: "Acme Main".into(),
            default_company_code: "MAIN".into(),
            default_company_currency_id: 7,
            default_company_currency_code: Some("USD".into()),
            fiscal_year_end_month: 12,
            fiscal_year_end_day: 31,
            seed_form_configs: false,
            settings: SettingsInput {
                module_config: None,
                feature_flags: vec!["crm_multi_company".into()],
                integration_keys: None,
                metadata: Some("settings".into()),
            },
        };

        let value = serde_json::to_value(reducer_arg(&body)).expect("serialize reducer args");
        assert_eq!(value["default_company_code"], "MAIN");
        assert_eq!(value["default_company_currency_code"], "USD");
        assert!(value.get("defaultCompanyCode").is_none());
        assert_eq!(value["organization"]["description"], json!({ "none": [] }));
        assert_eq!(
            value["organization"]["metadata"],
            json!({ "some": "fixture" })
        );
        assert_eq!(value["settings"]["metadata"], json!({ "some": "settings" }));
    }
}
