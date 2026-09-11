//! `/v1/accounting/bank-statement-imports` — reviewed statement-import workspace.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use serde_json::{json, Value};

use crate::error::ApiError;
use crate::query_exec::resolve_membership_company_id;
use crate::state::AppState;
use crate::trusted_context::TrustedOperationContext;
use crate::web_session::OrgSession;

async fn statement_imports_get(
    State(state): State<Arc<AppState>>,
    Path(company_id): Path<u64>,
    OrgSession {
        session,
        organization_id,
    }: OrgSession,
) -> Result<Json<Value>, ApiError> {
    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    let company_id = resolve_membership_company_id(
        context.client(),
        organization_id,
        context.actor_identity(),
        Some(company_id),
        "statement-import company scope mismatch",
    )
    .await?;
    let context = context.with_company_scope(vec![company_id])?;
    let imports = context
        .client()
        .query_sql(&format!(
            "SELECT id, company_id, journal_id, currency_id, file_name, idempotency_key, state, opening_balance, total_rows, valid_rows, invalid_rows, approved_statement_id, created_at, approved_at FROM bank_statement_import WHERE organization_id = {organization_id} AND company_id = {company_id}"
        ))
        .await
        .map_err(ApiError::internal)?;
    let lines = context
        .client()
        .query_sql(&format!(
            "SELECT line.id, line.import_id, line.row_number, line.date, line.amount, line.reference, line.description, line.validation_error, line.created_statement_line_id FROM bank_statement_import_line AS line JOIN bank_statement_import AS statement_import ON line.import_id = statement_import.id WHERE line.organization_id = {organization_id} AND statement_import.company_id = {company_id}"
        ))
        .await
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "imports": imports, "lines": lines })))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route(
        "/accounting/bank-statement-imports/:company_id",
        get(statement_imports_get),
    )
}
