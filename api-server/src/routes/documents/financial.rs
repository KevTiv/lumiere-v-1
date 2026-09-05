//! Financial-report document routes and database loading.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    response::Response,
};
use serde_json::Value;
use tower_cookies::Cookies;

use crate::document_render::{
    csv::trial_balance_csv,
    financial::{financial_report_lines, row_id, row_report_id},
    pdf::render_lines_pdf,
    xlsx::trial_balance_xlsx,
};
use crate::error::ApiError;
use crate::query_exec::execute_resource_query;
use crate::session::ApiSession;
use crate::state::AppState;
use crate::web_session::{require_org, resolve_session};

use super::attachment_response;

async fn load_financial_report(
    state: &AppState,
    session: &ApiSession,
    report_id: u64,
) -> Result<(Value, Vec<Value>), ApiError> {
    let org_id = require_org(session)?;
    let client = state.client_with_token(&session.stdb_token);
    let reports = execute_resource_query(
        &client,
        "financial-reports",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;
    let report = reports
        .into_iter()
        .find(|row| row_id(row) == Some(report_id))
        .ok_or_else(|| ApiError::NotFound(format!("financial report {report_id} not found")))?;

    let trial_rows = execute_resource_query(
        &client,
        "trial-balances",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?
    .into_iter()
    .filter(|row| row_report_id(row) == Some(report_id))
    .collect();

    Ok((report, trial_rows))
}

pub(super) async fn financial_report_pdf(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(report_id): Path<u64>,
) -> Result<Response, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let (report, trial_rows) = load_financial_report(&state, &session, report_id).await?;
    let title = report
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Financial Report");
    let lines = financial_report_lines(&report, &trial_rows);
    let pdf_bytes = render_lines_pdf(title, &lines)?;
    let filename = format!("financial-report-{report_id}.pdf");
    attachment_response(filename, "application/pdf", pdf_bytes)
}

pub(super) async fn financial_report_csv(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(report_id): Path<u64>,
) -> Result<Response, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let (report, trial_rows) = load_financial_report(&state, &session, report_id).await?;
    let csv = trial_balance_csv(&report, &trial_rows);
    attachment_response(
        format!("financial-report-{report_id}.csv"),
        "text/csv; charset=utf-8",
        csv.into_bytes(),
    )
}

pub(super) async fn financial_report_xlsx(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(report_id): Path<u64>,
) -> Result<Response, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let (report, trial_rows) = load_financial_report(&state, &session, report_id).await?;
    let bytes = trial_balance_xlsx(&report, &trial_rows)?;
    attachment_response(
        format!("financial-report-{report_id}.xlsx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes,
    )
}
