//! `/v1/accounting/bank-statement-imports` — reviewed statement-import workspace.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::get,
    Json, Router,
};
use serde_json::{json, Value};
use tower_cookies::Cookies;

use crate::error::ApiError;
use crate::state::AppState;
use crate::web_session::{require_org, resolve_session};

async fn statement_imports_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(company_id): Path<u64>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let organization_id = require_org(&session)?;
    let client = state.client_with_token(&session.stdb_token);
    let company = client
        .query_sql(&format!(
            "SELECT id FROM company WHERE organization_id = {organization_id} AND id = {company_id} AND deleted_at IS NULL LIMIT 1"
        ))
        .await
        .map_err(|error| ApiError::Internal(error.to_string()))?;
    if company.is_empty() {
        return Err(ApiError::NotFound("company not found".into()));
    }
    let imports = client
        .query_sql(&format!(
            "SELECT id, company_id, journal_id, currency_id, file_name, idempotency_key, state, opening_balance, total_rows, valid_rows, invalid_rows, approved_statement_id, created_at, approved_at FROM bank_statement_import WHERE organization_id = {organization_id} AND company_id = {company_id}"
        ))
        .await
        .map_err(|error| ApiError::Internal(error.to_string()))?;
    let lines = client
        .query_sql(&format!(
            "SELECT line.id, line.import_id, line.row_number, line.date, line.amount, line.reference, line.description, line.validation_error, line.created_statement_line_id FROM bank_statement_import_line AS line JOIN bank_statement_import AS statement_import ON line.import_id = statement_import.id WHERE line.organization_id = {organization_id} AND statement_import.company_id = {company_id}"
        ))
        .await
        .map_err(|error| ApiError::Internal(error.to_string()))?;
    Ok(Json(json!({ "imports": imports, "lines": lines })))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route(
        "/accounting/bank-statement-imports/:company_id",
        get(statement_imports_get),
    )
}
