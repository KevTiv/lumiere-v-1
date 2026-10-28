//! Resolve the caller's saved quotation without exposing internal order metadata.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use stdb_auth::{has_resource_read_permission, identity_sql_literal, FieldAccessContext};
use tower_cookies::Cookies;

use crate::auth_password::identity_cell_to_hex;
use crate::error::ApiError;
use crate::query_exec::{resolve_sales_company_id, row_u64};
use crate::state::AppState;
use crate::trusted_context::TrustedOperationContext;
use crate::web_session::resolve_session;

#[derive(Deserialize)]
pub(super) struct CreationQuery {
    #[serde(rename = "companyId")]
    company_id: u64,
}

fn valid_receipt(receipt: &str) -> bool {
    receipt.len() == 36
        && receipt.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

fn creation_sql(
    org: u64,
    company: u64,
    actor: &str,
    access: &FieldAccessContext,
) -> Result<String, ApiError> {
    if org == 0
        || company == 0
        || access.organization_id != org
        || !has_resource_read_permission(Some(access), "sale-orders")
    {
        return Err(ApiError::Forbidden(
            "Quotation read access is required".into(),
        ));
    }
    let actor = identity_sql_literal(actor).map_err(ApiError::BadRequest)?;
    // Metadata is read internally only. The response contains mandatory record IDs,
    // never metadata, prices, notes or other fields excluded by the caller's mask.
    Ok(format!("SELECT id, organization_id, company_id, create_uid, metadata FROM sale_order WHERE organization_id = {org} AND company_id = {company} AND create_uid = {actor}"))
}

fn creation_rows(rows: &[Value], receipt: &str, org: u64, company: u64, actor: &str) -> Vec<Value> {
    let mut matches = rows.iter().filter_map(|row| {
        if row_u64(row, "organizationId", "organization_id")
            .ok()
            .flatten()
            != Some(org)
            || row_u64(row, "companyId", "company_id").ok().flatten() != Some(company)
        {
            return None;
        }
        let creator = row.get("createUid").or_else(|| row.get("create_uid"))?;
        if identity_cell_to_hex(creator).as_deref() != Some(actor) {
            return None;
        }
        let metadata = row.get("metadata")?;
        let metadata = metadata.get("some").unwrap_or(metadata).as_str()?;
        let metadata: Value = serde_json::from_str(metadata).ok()?;
        if metadata.get("sales_create_receipt").and_then(Value::as_str) != Some(receipt) {
            return None;
        }
        row_u64(row, "id", "id").ok().flatten().filter(|id| *id > 0)
    });
    match (matches.next(), matches.next()) {
        (Some(id), None) => vec![json!({
            "id": id.to_string(), "organizationId": org.to_string(),
            "companyId": company.to_string(), "receipt": receipt,
        })],
        _ => Vec::new(),
    }
}

pub(super) async fn get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(receipt): Path<String>,
    Query(query): Query<CreationQuery>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    if !valid_receipt(&receipt) || query.company_id == 0 {
        return Err(ApiError::BadRequest(
            "A valid receipt and companyId are required".into(),
        ));
    }
    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    // Check resource permission before any membership or order read.
    let sql = creation_sql(
        context.organization_id(),
        query.company_id,
        context.actor_identity(),
        context.field_access(),
    )?;
    let company = resolve_sales_company_id(
        context.client(),
        context.organization_id(),
        context.actor_identity(),
        Some(query.company_id),
    )
    .await?;
    let context = context.with_company_scope(vec![company])?;
    context.require_company_scope(&[query.company_id])?;
    // An oversized source fails the lookup instead of accepting a partial,
    // apparently unique receipt. The already acknowledged save is not repeated.
    let rows = context
        .client()
        .with_query_limits(10_000, 16 * 1024 * 1024)
        .map_err(ApiError::internal)?
        .query_sql(&sql)
        .await
        .map_err(ApiError::internal)?;
    let data = creation_rows(
        &rows,
        &receipt,
        context.organization_id(),
        company,
        context.actor_identity(),
    );
    context.require_current_placement(&state.organization_placements)?;
    Ok(Json(json!({ "data": data })))
}

#[cfg(test)]
mod tests;
