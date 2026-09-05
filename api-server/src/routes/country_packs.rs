//! `/v1/country-packs/*` — global catalog + company-scoped locale pack activations.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use serde_json::{json, Value};

use crate::error::ApiError;
use crate::state::AppState;
use crate::web_session::OrgSession;

async fn catalog_get(
    State(state): State<Arc<AppState>>,
    OrgSession { session, organization_id: _ }: OrgSession,
) -> Result<Json<Value>, ApiError> {
    let client = state.client_with_token(&session.stdb_token);
    let data = client
        .query_sql(
            "SELECT pack_key, country_code, name, region, version, is_active, metadata \
             FROM country_pack_definition WHERE is_active = true ORDER BY name",
        )
        .await
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "data": data })))
}

async fn company_packs_get(
    State(state): State<Arc<AppState>>,
    Path(company_id): Path<u64>,
    OrgSession { session, organization_id }: OrgSession,
) -> Result<Json<Value>, ApiError> {
    let client = state.client_with_token(&session.stdb_token);
    let company_rows = client
        .query_sql(&format!(
            "SELECT id FROM company WHERE organization_id = {organization_id} AND id = {company_id} AND deleted_at IS NULL LIMIT 1"
        ))
        .await
        .map_err(ApiError::internal)?;
    if company_rows.is_empty() {
        return Err(ApiError::NotFound("company not found".into()));
    }
    let data = client
        .query_sql(&format!(
            "SELECT id, company_id, pack_key, enabled, configuration, activated_at, updated_at \
             FROM company_country_pack WHERE organization_id = {organization_id} AND company_id = {company_id}"
        ))
        .await
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "data": data })))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/country-packs/catalog", get(catalog_get))
        .route("/country-packs/:company_id", get(company_packs_get))
}
