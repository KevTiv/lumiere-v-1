//! Account-move PDF route.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    response::Response,
};
use tower_cookies::Cookies;

use crate::document_render::{financial::row_id, pdf::render_lines_pdf};
use crate::error::ApiError;
use crate::query_exec::execute_resource_query;
use crate::state::AppState;
use crate::web_session::{require_org, resolve_session};

use super::attachment_response;

pub(super) async fn account_move_pdf(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(move_id): Path<u64>,
) -> Result<Response, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;

    let client = state.client_with_token(&session.stdb_token);
    let moves = execute_resource_query(
        &client,
        "account-moves",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;
    let mv = moves
        .into_iter()
        .find(|row| row_id(row) == Some(move_id))
        .ok_or_else(|| ApiError::NotFound(format!("account move {move_id} not found")))?;

    let name = mv.get("name").and_then(|v| v.as_str()).unwrap_or("Invoice");
    let amount = mv
        .get("amountTotal")
        .or_else(|| mv.get("amount_total"))
        .map(|v| v.to_string())
        .unwrap_or_else(|| "0".to_string());
    let move_type = mv
        .get("moveType")
        .or_else(|| mv.get("move_type"))
        .map(|v| v.to_string())
        .unwrap_or_else(|| "Entry".to_string());

    let lines = vec![
        format!("Document: {name}"),
        format!("Type: {move_type}"),
        format!("Total: {amount}"),
        String::new(),
        "Generated from Lumiere ERP document pipeline.".to_string(),
    ];

    let pdf_bytes = render_lines_pdf(name, &lines)?;
    attachment_response(
        format!("account-move-{move_id}.pdf"),
        "application/pdf",
        pdf_bytes,
    )
}
