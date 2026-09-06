//! Sale-order PDF route.

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

pub(super) async fn sale_order_pdf(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(order_id): Path<u64>,
) -> Result<Response, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;

    let client = state.client_with_token(&session.stdb_token);
    let orders = execute_resource_query(
        &client,
        "sale-orders",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;
    let order = orders
        .into_iter()
        .find(|row| row_id(row) == Some(order_id))
        .ok_or_else(|| ApiError::NotFound(format!("sale order {order_id} not found")))?;

    let name = order
        .get("origin")
        .or_else(|| order.get("clientOrderRef"))
        .or_else(|| order.get("client_order_ref"))
        .and_then(|v| v.as_str())
        .unwrap_or("Sale Order");
    let amount = order
        .get("amountTotal")
        .or_else(|| order.get("amount_total"))
        .map(|v| v.to_string())
        .unwrap_or_else(|| "0".to_string());
    let state_label = order
        .get("state")
        .map(|v| v.to_string())
        .unwrap_or_else(|| "Draft".to_string());

    let lines = vec![
        format!("Sale Order: {name}"),
        format!("State: {state_label}"),
        format!("Total: {amount}"),
        String::new(),
        "Line items are available in the ERP record.".to_string(),
    ];

    let pdf_bytes = render_lines_pdf(name, &lines)?;
    attachment_response(
        format!("sale-order-{order_id}.pdf"),
        "application/pdf",
        pdf_bytes,
    )
}
