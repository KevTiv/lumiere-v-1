//! Account-move PDF route.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    response::Response,
};
use base64::Engine;
use serde_json::Value;
use tower_cookies::Cookies;

use crate::document_blobs::read_completed_branding_blob;
use crate::document_render::{
    financial::row_id,
    invoice::{
        document_snapshot, draft_invoice_snapshot, needs_draft_profile, project_invoice,
        render_invoice_html, row_u64,
    },
};
use crate::error::ApiError;
use crate::query_exec::execute_resource_query;
use crate::session::ApiSession;
use crate::state::AppState;
use crate::trusted_context::TrustedOperationContext;
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
    let pdf_bytes = render_account_move_pdf(&state, &session, move_id, None).await?;
    attachment_response(
        format!("account-move-{move_id}.pdf"),
        "application/pdf",
        pdf_bytes,
    )
}

pub(crate) struct InvoicePdfReview<'a> {
    pub organization_id: u64,
    pub company_id: u64,
    pub revision: &'a [Value],
}

/// Render through the same managed document pipeline as the authenticated download.
/// Reviewed attachments additionally require the original posted invoice revision.
pub(crate) async fn render_account_move_pdf(
    state: &AppState,
    session: &ApiSession,
    move_id: u64,
    review: Option<InvoicePdfReview<'_>>,
) -> Result<Vec<u8>, ApiError> {
    let org_id = require_org(session)?;
    let trusted = TrustedOperationContext::for_resource_read(&state, &session)?;
    let client = trusted.client();
    let moves = execute_resource_query(
        &client,
        "account-moves",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;
    let mut matching = moves.into_iter().filter(|row| row_id(row) == Some(move_id));
    let mv = matching
        .next()
        .ok_or_else(|| ApiError::NotFound(format!("account move {move_id} not found")))?;
    if matching.next().is_some() {
        return Err(ApiError::Conflict("invoice record is ambiguous".into()));
    }
    let company_id = row_u64(&mv, &["companyId", "company_id"])
        .ok_or_else(|| ApiError::Conflict("invoice company is unavailable".into()))?;
    if let Some(review) = review {
        if review.organization_id != org_id
            || review.company_id != company_id
            || !invoice_revision_matches(&mv, review.revision)
        {
            return Err(ApiError::Conflict(
                "invoice changed or is unreadable since email review".into(),
            ));
        }
    }
    let draft_profile = needs_draft_profile(&mv);
    let snapshot = if draft_profile {
        None
    } else {
        document_snapshot(&mv)?
    };

    let lines = execute_resource_query(
        &client,
        "account-move-lines",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;
    // Legacy invoices have no issued presentation snapshot. Read only canonical
    // company identity through the existing authorized query; never apply live templates.
    let companies = if draft_profile
        || (snapshot.is_none()
            && stdb_auth::has_resource_read_permission(session.field_access.as_ref(), "companies"))
    {
        execute_resource_query(
            &client,
            "companies",
            org_id,
            &session.identity_hex,
            session.field_access.as_ref(),
        )
        .await?
    } else {
        Vec::new()
    };
    let company = unique_record(&companies, company_id);
    let snapshot = if draft_profile {
        let templates = execute_resource_query(
            &client,
            "document-templates",
            org_id,
            &session.identity_hex,
            session.field_access.as_ref(),
        )
        .await?;
        draft_invoice_snapshot(&mv, org_id, company, &templates)?
    } else {
        snapshot
    };
    // The same tenant catalog is exposed by authenticated /bootstrap/currencies.
    // IDs are tenant-local: never guess a code from an ID or use another tenant's row.
    let currencies = if let Some(currency_id) = row_u64(&mv, &["currencyId", "currency_id"]) {
        client.query_sql(&format!("SELECT id, code, decimal_places FROM currency WHERE organization_id = {org_id} AND id = {currency_id}"))
            .await.map_err(ApiError::internal)?
    } else {
        Vec::new()
    };
    let currency =
        row_u64(&mv, &["currencyId", "currency_id"]).and_then(|id| unique_record(&currencies, id));
    let document = project_invoice(&mv, &lines, snapshot, company, currency)?;
    let logo_uri = if document.profile.logo_url.is_empty() {
        None
    } else {
        let logo = read_completed_branding_blob(
            &state.config.document_blob_store,
            org_id,
            company_id,
            &document.profile.logo_url,
        )
        .await?;
        Some(format!(
            "data:{};base64,{}",
            logo.content_type,
            base64::engine::general_purpose::STANDARD.encode(logo.bytes)
        ))
    };

    render_pdf(
        state,
        &render_invoice_html(&document, logo_uri.as_deref()),
        move_id,
    )
    .await
}

/// Compare serialized SATS field names/variants without treating missing scope as inheritance.
pub(crate) fn invoice_revision_matches(row: &Value, revision: &[Value]) -> bool {
    let get = |camel: &str, snake: &str| row.get(camel).or_else(|| row.get(snake));
    let tag = |value: Option<&Value>| -> Option<String> {
        let value = value?;
        if let Some(text) = value.as_str() {
            return Some(text.into());
        }
        if let Some(text) = value.get("tag").and_then(Value::as_str) {
            return Some(text.into());
        }
        let object = value.as_object()?;
        if object.len() != 1 {
            return None;
        }
        let (key, payload) = object.iter().next()?;
        if !(payload.as_array().is_some_and(Vec::is_empty)
            || payload.as_object().is_some_and(serde_json::Map::is_empty))
        {
            return None;
        }
        Some(
            key.split('_')
                .map(|part| {
                    let mut chars = part.chars();
                    chars
                        .next()
                        .map(|first| first.to_uppercase().collect::<String>() + chars.as_str())
                        .unwrap_or_default()
                })
                .collect(),
        )
    };
    if revision.len() != 7 {
        return false;
    }
    let state = tag(get("state", "state"));
    let move_type = tag(get("moveType", "move_type"));
    let amount = get("amountTotal", "amount_total").and_then(Value::as_f64);
    state.as_deref() == Some("Posted")
        && matches!(move_type.as_deref(), Some("OutInvoice" | "OutRefund"))
        && revision[0].as_str() == state.as_deref()
        && revision[1].as_str() == move_type.as_deref()
        && amount.is_some_and(f64::is_finite)
        && revision[2].as_f64() == amount
        && revision[3].as_str()
            == row_u64(row, &["currencyId", "currency_id"])
                .map(|id| id.to_string())
                .as_deref()
        && revision[4].as_str() == get("name", "name").and_then(Value::as_str)
        && revision[5].as_str()
            == get("invoicePartnerDisplayName", "invoice_partner_display_name")
                .filter(|value| value.is_null() || value.is_string())
                .map(|value| value.as_str().unwrap_or_default())
        && get("metadata", "metadata").is_some_and(|value| value == &revision[6])
}

fn unique_record(rows: &[Value], id: u64) -> Option<&Value> {
    let mut matches = rows.iter().filter(|row| row_id(row) == Some(id));
    let first = matches.next()?;
    matches.next().is_none().then_some(first)
}

async fn render_pdf(state: &AppState, html: &str, move_id: u64) -> Result<Vec<u8>, ApiError> {
    let renderer_url =
        state.config.report_renderer_url.as_deref().ok_or_else(|| {
            ApiError::Unavailable("invoice PDF renderer is not configured".into())
        })?;
    let response = state.http.post(format!("{}/v1/render/pdf", renderer_url.trim_end_matches('/')))
        .timeout(std::time::Duration::from_secs(60))
        .json(&serde_json::json!({ "html": html, "filename": format!("account-move-{move_id}.pdf"), "media": "print" }))
        .send().await.map_err(|error| ApiError::Unavailable(format!("invoice PDF renderer request failed: {error}")))?;
    if !response.status().is_success() {
        return Err(ApiError::Unavailable(format!(
            "invoice PDF renderer returned {}",
            response.status()
        )));
    }
    let is_pdf = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("application/pdf"));
    if !is_pdf {
        return Err(ApiError::Unavailable(
            "invoice renderer did not return a PDF".into(),
        ));
    }
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| ApiError::Unavailable("invoice PDF could not be read".into()))?
    {
        if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
            return Err(ApiError::Unavailable(
                "invoice PDF exceeds the supported 8 MiB size".into(),
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    if !bytes.starts_with(b"%PDF-") {
        return Err(ApiError::Unavailable(
            "invoice renderer returned an invalid PDF".into(),
        ));
    }
    Ok(bytes.to_vec())
}
