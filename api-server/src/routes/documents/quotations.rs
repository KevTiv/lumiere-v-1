//! Review and persist a quotation from a company-authorized visual template.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use base64::Engine;
use lumiere_contracts::bindings::CreateDocumentParams;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use spacetimedb_sats::serde::SerdeWrapper;
use tower_cookies::Cookies;

use crate::{
    commands::dispatch_session_reducer,
    document_blobs::{read_completed_branding_blob, store_generated_pdf, GeneratedPdfBlob},
    document_render::{
        invoice::row_u64,
        quotation::{
            cell, company_or_global, exact_company, project_quotation, quotation_revision,
            read_template, render_quotation_html, QuotationData, QuotationTemplate,
        },
    },
    error::ApiError,
    query_exec::{
        execute_authorized_resource_record, execute_resource_query_for_company,
        resolve_membership_company_id,
    },
    session::ApiSession,
    state::AppState,
    trusted_context::TrustedOperationContext,
    web_session::{require_org, resolve_session},
};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct PreviewRequest {
    company_id: String,
    template_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct GenerateRequest {
    company_id: String,
    template_id: String,
    expected_revision: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PreviewResponse {
    html: String,
    revision: String,
    template_id: String,
    template_name: String,
    order_id: String,
    reference: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GenerateResponse {
    document_id: String,
    download_url: String,
    file_name: String,
    checksum: String,
    revision: String,
}

struct PreparedQuotation {
    template: QuotationTemplate,
    data: QuotationData,
    html: String,
    revision: String,
}

fn parse_id(value: &str) -> Result<u64, ApiError> {
    value
        .parse::<u64>()
        .ok()
        .filter(|id| *id > 0 && id.to_string() == value)
        .ok_or_else(|| {
            ApiError::BadRequest("IDs must be canonical positive decimal strings".into())
        })
}

fn validate_revision(expected: &str, actual: &str) -> Result<(), ApiError> {
    if expected.len() != 64
        || !expected
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(ApiError::BadRequest(
            "a valid preview revision is required".into(),
        ));
    }
    if expected != actual {
        return Err(ApiError::Conflict("quotation, customer, brand asset or template changed after preview; review it again before generating".into()));
    }
    Ok(())
}

pub(super) async fn preview(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(order_id): Path<String>,
    Json(request): Json<PreviewRequest>,
) -> Result<Json<PreviewResponse>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let prepared = prepare(
        &state,
        &session,
        parse_id(&order_id)?,
        parse_id(&request.company_id)?,
        parse_id(&request.template_id)?,
    )
    .await?;
    Ok(Json(PreviewResponse {
        html: prepared.html,
        revision: prepared.revision,
        template_id: prepared.template.id.to_string(),
        template_name: prepared.template.name,
        order_id,
        reference: prepared.data.reference,
    }))
}

pub(super) async fn generate(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(order_id): Path<String>,
    Json(request): Json<GenerateRequest>,
) -> Result<Json<GenerateResponse>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let access = session
        .field_access
        .as_ref()
        .ok_or(ApiError::Unauthorized)?;
    if !stdb_auth::permission_allowed(access, "document", "create")
        || !stdb_auth::has_resource_read_permission(Some(access), "documents")
    {
        return Err(ApiError::Forbidden(
            "creating quotation output requires document create and read permissions".into(),
        ));
    }
    let order_id = parse_id(&order_id)?;
    let company_id = parse_id(&request.company_id)?;
    let template_id = parse_id(&request.template_id)?;
    let prepared = prepare(&state, &session, order_id, company_id, template_id).await?;
    validate_revision(&request.expected_revision, &prepared.revision)?;
    let pdf = render_pdf(&state, &prepared.html, order_id).await?;
    // Catch edits made while Chromium was rendering, before registering this snapshot.
    let current = prepare(&state, &session, order_id, company_id, template_id).await?;
    validate_revision(&prepared.revision, &current.revision)?;
    let file_name = format!("quotation-{order_id}-{}.pdf", &prepared.revision[..12]);
    let checksum = hex::encode(Sha256::digest(&pdf));
    let metadata = json!({ "generatedQuotation": {
        "schemaVersion": 1, "rendererVersion": "quotation-renderer-v1",
        "revision": prepared.revision, "templateId": template_id.to_string(),
        "templateName": prepared.template.name, "templateVersion": prepared.template.version,
        "templateSnapshot": prepared.template.snapshot,
        "source": prepared.data, "outputChecksum": checksum,
        "generatedAt": chrono::Utc::now().to_rfc3339(),
    }})
    .to_string();
    if metadata.len() > 1_900_000 {
        return Err(ApiError::Unprocessable(
            "quotation provenance exceeds the supported snapshot size".into(),
        ));
    }
    let root = state.config.document_blob_dir.clone();
    let stored_name = file_name.clone();
    let actor_identity = session.identity_hex.clone();
    let blob = tokio::task::spawn_blocking(move || {
        store_generated_pdf(
            &root,
            org_id,
            company_id,
            &actor_identity,
            &stored_name,
            &pdf,
        )
    })
    .await
    .map_err(ApiError::internal)??;
    let params = document_registration_params(
        order_id,
        parse_id(&current.data.partner_id)?,
        &current.data.reference,
        &file_name,
        &blob,
        metadata,
    )?;
    let registered = dispatch_session_reducer(
        &state,
        &session,
        "create_document",
        json!([org_id, company_id, params]),
    )
    .await?;
    let documents = execute_resource_query_for_company(
        registered.client(),
        "documents",
        org_id,
        &session.identity_hex,
        Some(access),
        Some(company_id),
    )
    .await?;
    let document_id = documents
        .iter()
        .find(|row| {
            exact_company(row, org_id, company_id)
                && cell(row, &["url"]).and_then(Value::as_str) == Some(blob.url.as_str())
        })
        .and_then(|row| row_u64(row, &["id"]))
        .ok_or_else(|| {
            ApiError::Internal(
                "generated quotation was registered but could not be read back".into(),
            )
        })?;
    Ok(Json(GenerateResponse {
        document_id: document_id.to_string(),
        download_url: format!("{}?sha256={}", blob.url, blob.checksum),
        file_name,
        checksum: blob.checksum,
        revision: current.revision,
    }))
}

fn document_registration_params(
    order_id: u64,
    partner_id: u64,
    reference: &str,
    file_name: &str,
    blob: &GeneratedPdfBlob,
    metadata: String,
) -> Result<Value, ApiError> {
    // Composite reducer parameters use SATS sums for Option fields. Serialize
    // the released type instead of maintaining a second handwritten wire shape.
    let params = CreateDocumentParams {
        name: format!("{reference} — quotation"),
        description: Some(
            "Generated quotation snapshot; future template edits do not change this file".into(),
        ),
        file_name: file_name.into(),
        file_size: blob.size,
        mimetype: "application/pdf".into(),
        url: blob.url.clone(),
        checksum: blob.checksum.clone(),
        folder_id: None,
        res_model: Some("sale_order".into()),
        res_id: Some(order_id),
        partner_id: Some(partner_id),
        tag_ids: Vec::new(),
        is_favorite: false,
        classification_id: None,
        retention_days: None,
        fiscal_kind: None,
        residency_region: Some("generated".into()),
        metadata: Some(metadata),
    };
    serde_json::to_value(SerdeWrapper::from_ref(&params)).map_err(ApiError::internal)
}

async fn prepare(
    state: &AppState,
    session: &ApiSession,
    order_id: u64,
    company_id: u64,
    template_id: u64,
) -> Result<PreparedQuotation, ApiError> {
    let org_id = require_org(session)?;
    let trusted = TrustedOperationContext::for_resource_read(state, session)?;
    let client = trusted.client();
    resolve_membership_company_id(
        client,
        org_id,
        trusted.actor_identity(),
        Some(company_id),
        "quotation company scope mismatch",
    )
    .await?;
    let order = execute_authorized_resource_record(
        client,
        "sale-orders",
        org_id,
        company_id,
        order_id,
        session.field_access.as_ref(),
    )
    .await?
    .ok_or_else(|| ApiError::NotFound("quotation not found".into()))?;
    let partner_id = row_u64(&order, &["partnerId", "partner_id"])
        .ok_or_else(|| ApiError::Unprocessable("quotation customer is unavailable".into()))?;
    let currency_id = row_u64(&order, &["currencyId", "currency_id"])
        .ok_or_else(|| ApiError::Unprocessable("quotation currency is unavailable".into()))?;
    let customer = execute_authorized_resource_record(
        client,
        "contacts",
        org_id,
        company_id,
        partner_id,
        session.field_access.as_ref(),
    )
    .await?
    .ok_or_else(|| ApiError::NotFound("quotation customer not found".into()))?;
    let templates = execute_resource_query_for_company(
        client,
        "document-templates",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
        Some(company_id),
    )
    .await?;
    let template_row = unique(&templates, template_id)
        .filter(|row| company_or_global(row, org_id, company_id))
        .ok_or_else(|| ApiError::NotFound("quotation template not found".into()))?;
    let template = read_template(template_row, org_id, company_id)?;
    let companies = execute_resource_query_for_company(
        client,
        "companies",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
        Some(company_id),
    )
    .await?;
    let company = unique(&companies, company_id)
        .ok_or_else(|| ApiError::NotFound("quotation company not found".into()))?;
    if !stdb_auth::has_resource_read_permission(session.field_access.as_ref(), "sale-order-lines") {
        return Err(ApiError::Forbidden(
            "quotation line read permission is required".into(),
        ));
    }
    let line_sql = stdb_auth::select_org_and_company_scoped_sql(
        "sale-order-lines",
        "sale_order_line",
        org_id,
        company_id,
        session.field_access.as_ref(),
        &format!(" AND order_id = {order_id}"),
        " LIMIT 1001",
    )
    .map_err(ApiError::Internal)?;
    let lines = client
        .query_sql(&line_sql)
        .await
        .map_err(ApiError::internal)?;
    // This is the same organization catalog exposed by authenticated currency bootstrap.
    let currencies = client.query_sql(&format!("SELECT id, organization_id, code, decimal_places FROM currency WHERE organization_id = {org_id} AND id = {currency_id}"))
        .await.map_err(ApiError::internal)?;
    let currency = unique(&currencies, currency_id)
        .ok_or_else(|| ApiError::NotFound("quotation currency not found".into()))?;
    let data = project_quotation(
        &order, &lines, company, &customer, currency, org_id, company_id,
    )?;
    if serde_json::to_vec(&data).map_err(ApiError::internal)?.len() > 1_000_000 {
        return Err(ApiError::Unprocessable(
            "quotation source exceeds the 1 MB snapshot limit".into(),
        ));
    }
    let logo_uri = if let Some(url) = &template.logo_url {
        let root = state.config.document_blob_dir.clone();
        let url = url.clone();
        let logo = tokio::task::spawn_blocking(move || {
            read_completed_branding_blob(&root, org_id, company_id, &url)
        })
        .await
        .map_err(ApiError::internal)??;
        Some(format!(
            "data:{};base64,{}",
            logo.content_type,
            base64::engine::general_purpose::STANDARD.encode(logo.bytes)
        ))
    } else {
        None
    };
    let html = render_quotation_html(&template, &data, logo_uri.as_deref())?;
    if html.len() > 6 * 1024 * 1024 {
        return Err(ApiError::Unprocessable(
            "quotation preview exceeds the 6 MiB limit".into(),
        ));
    }
    let revision = quotation_revision(&template, &data, &html)?;
    Ok(PreparedQuotation {
        template,
        data,
        html,
        revision,
    })
}

fn unique(rows: &[Value], id: u64) -> Option<&Value> {
    let mut found = rows.iter().filter(|row| row_u64(row, &["id"]) == Some(id));
    let first = found.next()?;
    found.next().is_none().then_some(first)
}

async fn render_pdf(state: &AppState, html: &str, order_id: u64) -> Result<Vec<u8>, ApiError> {
    let renderer =
        state.config.report_renderer_url.as_deref().ok_or_else(|| {
            ApiError::Unavailable("quotation PDF renderer is not configured".into())
        })?;
    let mut response = state.http.post(format!("{}/v1/render/pdf", renderer.trim_end_matches('/')))
        .timeout(std::time::Duration::from_secs(60))
        .json(&json!({ "html": html, "filename": format!("quotation-{order_id}.pdf"), "media": "print" }))
        .send().await.map_err(|error| ApiError::Unavailable(format!("quotation renderer request failed: {error}")))?;
    if !response.status().is_success()
        || !response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.starts_with("application/pdf"))
    {
        return Err(ApiError::Unavailable(
            "quotation renderer did not return a PDF".into(),
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| ApiError::Unavailable("quotation PDF could not be read".into()))?
    {
        if bytes.len().saturating_add(chunk.len()) > 8 * 1024 * 1024 {
            return Err(ApiError::Unavailable(
                "quotation PDF exceeds the 8 MiB limit".into(),
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    if !bytes.starts_with(b"%PDF-") {
        return Err(ApiError::Unavailable(
            "quotation renderer returned an invalid PDF".into(),
        ));
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_ids_remain_exact_and_preview_revision_is_required() {
        assert_eq!(parse_id("9007199254740993").unwrap(), 9_007_199_254_740_993);
        for invalid in ["0", "01", "-1", "+1", "1.0", " 1", "18446744073709551616"] {
            assert!(parse_id(invalid).is_err());
        }
        assert!(validate_revision(&"a".repeat(64), &"a".repeat(64)).is_ok());
        assert!(validate_revision(&"a".repeat(64), &"b".repeat(64)).is_err());
        assert!(validate_revision("", "").is_err());
    }

    #[test]
    fn document_registration_uses_an_existing_session_scoped_contract() {
        let contract = crate::commands::session_reducer_contract("create_document")
            .expect("session operation");
        assert_eq!(contract.params[1].name, "company_id");
        assert_eq!(
            contract.params[1].kind,
            stdb_client::ScalarKind::OptionalUnsignedInteger
        );
        let blob = GeneratedPdfBlob {
            url: "/api/documents/blobs/object/7/generated/0123456789abcdef".into(),
            checksum: "a".repeat(64),
            size: 1024,
        };
        let metadata = r#"{"generatedQuotation":{"revision":"reviewed"}}"#;
        let params = document_registration_params(
            9_007_199_254_740_993,
            4,
            "Q/2026/9",
            "quotation.pdf",
            &blob,
            metadata.into(),
        )
        .unwrap();
        let decoded: SerdeWrapper<CreateDocumentParams> =
            serde_json::from_value(params.clone()).expect("canonical SATS params");
        assert_eq!(decoded.0.res_id, Some(9_007_199_254_740_993));
        assert_eq!(decoded.0.res_model.as_deref(), Some("sale_order"));
        assert_eq!(decoded.0.partner_id, Some(4));
        assert_eq!(decoded.0.folder_id, None);
        assert_eq!(decoded.0.metadata.as_deref(), Some(metadata));
        assert_eq!(decoded.0.url, blob.url);
        assert_eq!(decoded.0.checksum, blob.checksum);
        assert!(
            stdb_client::ReducerCall::from_name("create_document", json!([7, 3, params])).is_ok()
        );
    }
}
