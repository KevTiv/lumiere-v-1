//! `/v1/bootstrap/*` — parity with `frontend/web/app/api/bootstrap/tenant/route.ts`.

use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::HeaderMap,
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tower_cookies::Cookies;

use crate::commands::dispatch_tenant_bootstrap;
use crate::error::ApiError;
use crate::session::{membership_rows_for_identity, resolve_api_session};
use crate::state::AppState;
use crate::trusted_context::TrustedOperationContext;
use crate::web_session::stdb_identity_hex_hint;

const ONBOARDING_CURRENCIES: [(&str, &str, &str, u8); 7] = [
    ("USD", "US Dollar", "$", 2),
    ("EUR", "Euro", "€", 2),
    ("GBP", "British Pound", "£", 2),
    ("CAD", "Canadian Dollar", "C$", 2),
    ("AUD", "Australian Dollar", "A$", 2),
    ("JPY", "Japanese Yen", "¥", 0),
    ("RWF", "Rwandan Franc", "FRw", 0),
];

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
    default_company_currency_code: Value,
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

fn tenant_currency_sql(organization_id: u64) -> String {
    format!(
        "SELECT id, code, name, symbol, decimal_places, rounding_factor FROM currency WHERE organization_id = {organization_id} AND active = true"
    )
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
        default_company_currency_code: stdb_option(body.default_company_currency_code.as_ref()),
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
    let additional_approval = std::env::var("LUMIERE_ALPHA_ADDITIONAL_TENANT_APPROVAL").ok();
    let approved_additional_tenant = additional_approval
        .as_deref()
        .and_then(stdb_auth::AdditionalTenantApproval::parse)
        .zip(session.organization_id)
        .is_some_and(|(approval, source_id)| {
            approval.permits_request(&session.identity_hex, source_id, &body.organization.code)
        });
    if session.organization_id.is_some() && !approved_additional_tenant {
        return Err(ApiError::Conflict(
            "Already belongs to an organization".into(),
        ));
    }

    validate_bootstrap(&body)?;

    let arg = reducer_arg(&body);

    let payload = serde_json::to_value(&arg).map_err(ApiError::internal)?;
    dispatch_tenant_bootstrap(&state, &session, json!([payload])).await?;
    Ok(Json(json!({ "ok": true })))
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

    let additional_approval = std::env::var("LUMIERE_ALPHA_ADDITIONAL_TENANT_APPROVAL").ok();
    let approved_source = additional_approval
        .as_deref()
        .and_then(stdb_auth::AdditionalTenantApproval::parse)
        .zip(session.organization_id)
        .is_some_and(|(approval, source_id)| {
            approval.permits_source(&session.identity_hex, source_id)
        });
    if let Some(organization_id) = session.organization_id.filter(|_| !approved_source) {
        let context = TrustedOperationContext::for_resource_read(&state, &session)?;
        let mut currencies = context
            .client()
            .query_sql(&tenant_currency_sql(organization_id))
            .await
            .map_err(ApiError::internal)?;
        currencies.sort_by(|left, right| {
            left.get("code")
                .and_then(Value::as_str)
                .cmp(&right.get("code").and_then(Value::as_str))
        });
        return Ok(Json(json!({ "data": currencies })));
    }

    // A user without a tenant receives a code-only onboarding catalog, not
    // rows from another organization. The reducer seeds the selected code
    // after the new organization id exists, so these ids deliberately remain
    // zero and must never be used by an established tenant.
    let currencies = ONBOARDING_CURRENCIES
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

#[derive(Debug, Deserialize)]
struct BootstrapLookup {
    code: String,
}

fn lookup_code_is_valid(code: &str) -> bool {
    (2..=32).contains(&code.len())
        && code
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn row_id(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(|v| v.as_u64().or_else(|| v.as_str()?.parse().ok()))
        .filter(|id| *id > 0)
}

/// Bootstrap metadata discovery follows the verified identity's memberships,
/// rather than the currently selected tenant. It exposes no ERP record data.
fn owned_bootstrap_organization(
    organizations: &[Value],
    memberships: &[Value],
    code: &str,
) -> Result<Value, ApiError> {
    let owned: Vec<_> = organizations
        .iter()
        .filter(|org| {
            let Some(id) = row_id(org, "id", "id") else {
                return false;
            };
            org.get("code").and_then(Value::as_str) == Some(code)
                && org
                    .get("isActive")
                    .or_else(|| org.get("is_active"))
                    .and_then(Value::as_bool)
                    == Some(true)
                && row_id(org, "organizationId", "organization_id") == Some(id)
                && memberships.iter().any(|member| {
                    row_id(member, "organizationId", "organization_id") == Some(id)
                        && member
                            .get("isActive")
                            .or_else(|| member.get("is_active"))
                            .and_then(Value::as_bool)
                            == Some(true)
                })
        })
        .collect();
    match owned.as_slice() {
        [org] => Ok(json!({"id": org["id"], "name": org["name"], "code": org["code"]})),
        [] => Err(ApiError::NotFound("organization not found".into())),
        _ => Err(ApiError::Conflict("organization code is ambiguous".into())),
    }
}

async fn bootstrap_tenant_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Query(lookup): Query<BootstrapLookup>,
) -> Result<Json<Value>, ApiError> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let hint = stdb_identity_hex_hint(&headers, &cookies);
    let cookie = cookies.get("stdb_token").map(|c| c.value().to_string());
    let session = resolve_api_session(&state, auth, cookie.as_deref(), hint.as_deref())
        .await?
        .ok_or(ApiError::Unauthorized)?;
    if !lookup_code_is_valid(&lookup.code) {
        return Err(ApiError::BadRequest(
            "choose a valid organization code".into(),
        ));
    }
    let memberships = membership_rows_for_identity(&state, &session.identity_hex, true).await?;
    // Code has a strict ASCII allowlist above; no quote or SQL syntax is accepted.
    let organizations = state
        .stdb
        .query_sql(&format!(
            "SELECT id, organization_id, name, code, is_active FROM organization WHERE code = '{}'",
            lookup.code,
        ))
        .await
        .map_err(ApiError::internal)?;
    Ok(Json(
        json!({"data": owned_bootstrap_organization(&organizations, &memberships, &lookup.code)?}),
    ))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/bootstrap/currencies", get(bootstrap_currencies_get))
        .route(
            "/bootstrap/tenant",
            get(bootstrap_tenant_get).post(bootstrap_tenant_post),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bootstrap_lookup_requires_active_self_owned_membership_and_minimizes_output() {
        let org = json!({"id": "42", "organizationId": "42", "name": "Farm", "code": "FARM", "isActive": true, "email": "private@example.com"});
        let member = json!({"organizationId": "42", "isActive": true});
        assert_eq!(
            owned_bootstrap_organization(&[org.clone()], &[member.clone()], "FARM")
                .expect("owned organization"),
            json!({"id":"42","name":"Farm","code":"FARM"})
        );
        assert!(owned_bootstrap_organization(&[org.clone()], &[], "FARM").is_err());
        assert!(owned_bootstrap_organization(
            &[org.clone()],
            &[json!({"organizationId":42,"isActive":false})],
            "FARM"
        )
        .is_err());
        assert!(owned_bootstrap_organization(
            &[org.clone()],
            &[json!({"organizationId":1,"isActive":true})],
            "FARM"
        )
        .is_err());
        assert!(owned_bootstrap_organization(&[org.clone()], &[member.clone()], "OTHER").is_err());
        let mut invalid = org.clone();
        invalid["organizationId"] = json!(1);
        assert!(owned_bootstrap_organization(&[invalid], &[member.clone()], "FARM").is_err());
        let mut inactive = org.clone();
        inactive["isActive"] = json!(false);
        assert!(owned_bootstrap_organization(&[inactive], &[member.clone()], "FARM").is_err());
        assert!(owned_bootstrap_organization(&[org.clone(), org], &[member], "FARM").is_err());
    }

    #[test]
    fn bootstrap_lookup_rejects_sql_syntax_and_unbounded_codes() {
        assert!(lookup_code_is_valid("UMUNUPFU_MUGISHA"));
        for code in [
            "",
            "A",
            "FARM' OR true",
            "FARM;SELECT",
            "FARM ",
            "*",
            &"A".repeat(33),
        ] {
            assert!(!lookup_code_is_valid(code));
        }
    }

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
        assert_eq!(
            value["default_company_currency_code"],
            json!({ "some": "USD" })
        );
        assert!(value.get("defaultCompanyCode").is_none());
        assert_eq!(value["organization"]["description"], json!({ "none": [] }));
        assert_eq!(
            value["organization"]["metadata"],
            json!({ "some": "fixture" })
        );
        assert_eq!(value["settings"]["metadata"], json!({ "some": "settings" }));
    }

    #[test]
    fn tenant_currency_query_is_directly_organization_scoped() {
        assert_eq!(
            tenant_currency_sql(42),
            "SELECT id, code, name, symbol, decimal_places, rounding_factor FROM currency WHERE organization_id = 42 AND active = true"
        );
    }

    #[test]
    fn onboarding_catalog_includes_zero_decimal_rwandan_franc() {
        assert!(ONBOARDING_CURRENCIES.contains(&("RWF", "Rwandan Franc", "FRw", 0)));
    }
}
