//! Server-owned document extraction and governed evidence ingestion.
//!
//! This boundary deliberately accepts document identities, never index text.
//! It resolves the current DMS version and its immutable object-store blob,
//! verifies the stored checksum, extracts bounded text, and only then invokes
//! the fixed evidence and semantic-index reducers. Each step is idempotent so
//! a partially completed request can be retried safely.

use std::{collections::HashSet, net::IpAddr, sync::Arc};

use axum::{routing::post, Json, Router};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{
    commands::{dispatch_ai_evidence_mutation, dispatch_ai_evidence_search_mutation},
    document_blobs::{managed_blob_url, read_completed_blob},
    error::ApiError,
    query_exec::resolve_membership_company_id,
    state::AppState,
    trusted_context::TrustedOperationContext,
    web_session::OrgSession,
};

const MAX_EXTRACT_BYTES: usize = 10 * 1024 * 1024;
const MAX_EXTRACT_CHARS: usize = 32_768;
const MAX_PDF_PAGES: usize = 200;
const MAX_OCR_RESPONSE_BYTES: usize = 256 * 1024;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct IngestDocumentBody {
    company_id: u64,
    document_id: Option<u64>,
    object_key: Option<String>,
    language: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct IngestDocumentResponse {
    document_id: u64,
    version_id: u64,
    object_key: String,
    extracted_chars: usize,
    processor: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct EvidenceLifecycleBody {
    company_id: u64,
    document_id: u64,
    change_kind: String,
    reason: String,
}

#[derive(Debug)]
struct CurrentDocument {
    company_id: u64,
    current_version_id: u64,
    version_number: u64,
    title: String,
    url: String,
    checksum: String,
    mimetype: String,
    is_deleted: bool,
}

fn value_u64(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
}

fn value_text<'a>(row: &'a Value, camel: &str, snake: &str) -> Option<&'a str> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(Value::as_str)
}

fn value_bool(row: &Value, camel: &str, snake: &str) -> Option<bool> {
    row.get(camel)
        .or_else(|| row.get(snake))
        .and_then(Value::as_bool)
}

async fn load_current_document(
    context: &TrustedOperationContext,
    organization_id: u64,
    document_id: u64,
) -> Result<CurrentDocument, ApiError> {
    let documents = context
        .client()
        .query_sql_sats(&format!(
            "SELECT * FROM document WHERE organization_id = {organization_id} AND id = {document_id} LIMIT 2"
        ))
        .await
        .map_err(ApiError::internal)?;
    if documents.len() != 1 {
        return Err(ApiError::NotFound("document not found".into()));
    }
    let document = &documents[0];
    let company_id = value_u64(document, "companyId", "company_id")
        .ok_or_else(|| ApiError::Unprocessable("document is not company-scoped".into()))?;
    let current_version_id = value_u64(document, "currentVersionId", "current_version_id")
        .ok_or_else(|| ApiError::Conflict("document has no current version".into()))?;
    let is_deleted = value_bool(document, "isDeleted", "is_deleted").unwrap_or(false);

    let versions = context
        .client()
        .query_sql_sats(&format!(
            "SELECT * FROM document_version WHERE organization_id = {organization_id} AND id = {current_version_id} AND document_id = {document_id} LIMIT 2"
        ))
        .await
        .map_err(ApiError::internal)?;
    if versions.len() != 1 {
        return Err(ApiError::Conflict(
            "current document version could not be resolved".into(),
        ));
    }
    let version = &versions[0];
    Ok(CurrentDocument {
        company_id,
        current_version_id,
        title: value_text(document, "name", "name")
            .ok_or_else(|| ApiError::Internal("invalid document title".into()))?
            .to_owned(),
        version_number: value_u64(version, "versionNumber", "version_number")
            .ok_or_else(|| ApiError::Internal("invalid document version number".into()))?,
        url: value_text(version, "url", "url")
            .ok_or_else(|| ApiError::Conflict("document version has no blob URL".into()))?
            .to_owned(),
        checksum: value_text(version, "checksum", "checksum")
            .ok_or_else(|| ApiError::Conflict("document version has no checksum".into()))?
            .to_ascii_lowercase(),
        mimetype: value_text(version, "mimetype", "mimetype")
            .ok_or_else(|| ApiError::Conflict("document version has no mimetype".into()))?
            .to_owned(),
        is_deleted,
    })
}

async fn resolve_ingestion_document_id(
    context: &TrustedOperationContext,
    organization_id: u64,
    body: &IngestDocumentBody,
) -> Result<u64, ApiError> {
    match (body.document_id, body.object_key.as_deref()) {
        (Some(document_id), None) if document_id > 0 => Ok(document_id),
        (None, Some(object_key)) => {
            let url = managed_blob_url(organization_id, object_key)?;
            let versions = context
                .client()
                .query_sql_sats(&format!(
                    "SELECT * FROM document_version WHERE organization_id = {organization_id} AND url = '{url}' AND is_current = true LIMIT 2"
                ))
                .await
                .map_err(ApiError::internal)?;
            if versions.len() != 1 {
                return Err(ApiError::Conflict(
                    "managed blob is not the unique current document version".into(),
                ));
            }
            value_u64(&versions[0], "documentId", "document_id")
                .ok_or_else(|| ApiError::Internal("invalid document version owner".into()))
        }
        _ => Err(ApiError::BadRequest(
            "provide exactly one of documentId or objectKey".into(),
        )),
    }
}

fn bounded_text(text: &str) -> Option<String> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    Some(text.chars().take(MAX_EXTRACT_CHARS).collect())
}

fn strip_html(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut inside_tag = false;
    for character in input.chars() {
        match character {
            '<' => inside_tag = true,
            '>' => {
                inside_tag = false;
                result.push(' ');
            }
            _ if !inside_tag => result.push(character),
            _ => {}
        }
    }
    result
}

/// Extract text from bytes already resolved through the server-owned blob
/// store. Callers cannot supply replacement text through this seam.
pub(crate) fn extract_server_owned_text(
    content_type: &str,
    bytes: &[u8],
) -> Result<Option<String>, ApiError> {
    if bytes.len() > MAX_EXTRACT_BYTES {
        return Err(ApiError::Unprocessable(
            "document exceeds the extraction byte limit".into(),
        ));
    }
    let content_type = content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if content_type == "application/pdf" {
        let document = printpdf::lopdf::Document::load_mem(bytes)
            .map_err(|_| ApiError::Unprocessable("invalid PDF document".into()))?;
        let pages: Vec<u32> = document
            .get_pages()
            .keys()
            .copied()
            .take(MAX_PDF_PAGES)
            .collect();
        let text = document
            .extract_text(&pages)
            .map_err(|_| ApiError::Unprocessable("PDF text extraction failed".into()))?;
        return Ok(bounded_text(&text));
    }
    if content_type == "text/html" || content_type == "application/xhtml+xml" {
        let text = std::str::from_utf8(bytes)
            .map_err(|_| ApiError::Unprocessable("document text is not UTF-8".into()))?;
        return Ok(bounded_text(&strip_html(text)));
    }
    if content_type.starts_with("text/")
        || matches!(
            content_type.as_str(),
            "application/json" | "application/xml"
        )
    {
        let text = std::str::from_utf8(bytes)
            .map_err(|_| ApiError::Unprocessable("document text is not UTF-8".into()))?;
        return Ok(bounded_text(text));
    }
    Ok(None)
}

async fn external_ocr(
    content_type: &str,
    bytes: &[u8],
    language: Option<&str>,
) -> Result<Option<String>, ApiError> {
    let Ok(endpoint) = std::env::var("LUMIERE_EVIDENCE_OCR_URL") else {
        return Ok(None);
    };
    let endpoint = reqwest::Url::parse(&endpoint)
        .map_err(|_| ApiError::Internal("invalid evidence OCR endpoint".into()))?;
    if endpoint.scheme() != "https" || endpoint.host_str().is_none() {
        return Err(ApiError::Internal(
            "evidence OCR endpoint must be an absolute HTTPS URL".into(),
        ));
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(ApiError::internal)?;
    let mut response = client
        .post(endpoint)
        .json(&json!({
            "contentType": content_type,
            "contentBase64": BASE64.encode(bytes),
            "maxOutputChars": MAX_EXTRACT_CHARS,
            "language": language,
        }))
        .send()
        .await
        .map_err(ApiError::unavailable)?;
    if !response.status().is_success() {
        return Err(ApiError::Unavailable(
            "evidence OCR provider rejected the document".into(),
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_OCR_RESPONSE_BYTES as u64)
    {
        return Err(ApiError::Unavailable(
            "evidence OCR response is too large".into(),
        ));
    }
    let mut response_bytes = Vec::with_capacity(response.content_length().unwrap_or(0) as usize);
    while let Some(chunk) = response.chunk().await.map_err(ApiError::unavailable)? {
        if response_bytes.len().saturating_add(chunk.len()) > MAX_OCR_RESPONSE_BYTES {
            return Err(ApiError::UnavailableSource(anyhow::anyhow!(
                "evidence OCR response is too large"
            )));
        }
        response_bytes.extend_from_slice(&chunk);
    }
    let payload: Value = serde_json::from_slice(&response_bytes).map_err(ApiError::unavailable)?;
    Ok(payload
        .get("text")
        .and_then(Value::as_str)
        .and_then(bounded_text))
}

async fn extract_with_ocr(
    content_type: &str,
    bytes: &[u8],
    language: Option<&str>,
) -> Result<(String, String), ApiError> {
    if let Some(text) = extract_server_owned_text(content_type, bytes)? {
        return Ok((text, "native".into()));
    }
    if let Some(text) = external_ocr(content_type, bytes, language).await? {
        return Ok((text, "external_ocr".into()));
    }
    Err(ApiError::Unprocessable(
        "document has no extractable text and no OCR result".into(),
    ))
}

async fn ingest_document(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    OrgSession {
        session,
        organization_id,
    }: OrgSession,
    Json(body): Json<IngestDocumentBody>,
) -> Result<Json<IngestDocumentResponse>, ApiError> {
    if body.company_id == 0 {
        return Err(ApiError::BadRequest("invalid companyId".into()));
    }
    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    let requested_company = resolve_membership_company_id(
        context.client(),
        organization_id,
        context.actor_identity(),
        Some(body.company_id),
        "evidence ingestion company scope mismatch",
    )
    .await?;
    let document_id = resolve_ingestion_document_id(&context, organization_id, &body).await?;
    let document = load_current_document(&context, organization_id, document_id).await?;
    if document.company_id != requested_company || document.is_deleted {
        return Err(ApiError::NotFound("document not found".into()));
    }
    let blob = read_completed_blob(
        &state.config.document_blob_dir,
        organization_id,
        requested_company,
        &document.url,
    )?;
    if blob.checksum != document.checksum || blob.content_type != document.mimetype {
        return Err(ApiError::Conflict(
            "document version does not match its server-owned blob".into(),
        ));
    }
    let (content, processor) =
        extract_with_ocr(&blob.content_type, &blob.bytes, body.language.as_deref()).await?;
    let extracted_chars = content.chars().count();
    persist_document_evidence(
        &state,
        &session,
        &context,
        organization_id,
        requested_company,
        document_id,
        &document,
        &blob.object_key,
        blob.source_url.as_deref(),
        &content,
        &processor,
    )
    .await?;
    Ok(Json(IngestDocumentResponse {
        document_id,
        version_id: document.current_version_id,
        object_key: blob.object_key,
        extracted_chars,
        processor,
    }))
}

fn document_version_key(version_number: u64, checksum: &str) -> String {
    format!("v{version_number}-{}", &checksum[..checksum.len().min(16)])
}

fn passage_chunks(text: &str) -> Vec<(String, String, usize, usize)> {
    const MAX_PASSAGE_BYTES: usize = 32_768;
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < text.len() {
        let mut end = (start + MAX_PASSAGE_BYTES).min(text.len());
        while end > start && !text.is_char_boundary(end) {
            end -= 1;
        }
        if end == start {
            end = text.len();
        }
        if !text[start..end].trim().is_empty() {
            chunks.push((
                format!("chars-{start}"),
                text[start..end].to_owned(),
                start,
                end,
            ));
        }
        start = end;
    }
    chunks
}

async fn exact_row_id(rows: Vec<Value>, description: &str) -> Result<u64, ApiError> {
    if rows.len() != 1 {
        return Err(ApiError::Internal(format!(
            "{description} could not be resolved uniquely"
        )));
    }
    value_u64(&rows[0], "id", "id")
        .ok_or_else(|| ApiError::Internal(format!("invalid {description} id")))
}

#[allow(clippy::too_many_arguments)]
async fn persist_document_evidence(
    state: &AppState,
    session: &crate::session::ApiSession,
    context: &TrustedOperationContext,
    organization_id: u64,
    company_id: u64,
    document_id: u64,
    document: &CurrentDocument,
    object_key: &str,
    source_url: Option<&str>,
    content: &str,
    processor: &str,
) -> Result<(), ApiError> {
    let source_key = format!("document:{document_id}");
    dispatch_ai_evidence_mutation(
        state,
        session,
        "record_ai_evidence_source",
        json!([organization_id, company_id, {
            "source_kind": "document",
            "source_key": source_key,
            "title": document.title,
            "author_attribution": "unknown",
            "authors": [],
            "author_organization": null,
            "scope": "company",
            "retention_policy": "retain_snapshot",
        }]),
    )
    .await?;
    let source_id = exact_row_id(
        context.client().query_sql_sats(&format!(
            "SELECT * FROM ai_evidence_source WHERE organization_id = {organization_id} AND company_id = {company_id} AND source_kind = 'document' AND source_key = 'document:{document_id}' LIMIT 2"
        )).await.map_err(ApiError::internal)?,
        "document evidence source",
    ).await?;

    let version_key = document_version_key(document.version_number, &document.checksum);
    let existing_versions = context.client().query_sql_sats(&format!(
        "SELECT * FROM ai_evidence_source_version WHERE organization_id = {organization_id} AND company_id = {company_id} AND source_id = {source_id}"
    )).await.map_err(ApiError::internal)?;
    let existing = existing_versions
        .iter()
        .find(|row| value_text(row, "version", "version") == Some(version_key.as_str()));
    let predecessor_id = existing
        .and_then(|row| value_u64(row, "supersedesVersionId", "supersedes_version_id"))
        .or_else(|| {
            existing_versions.iter().find_map(|row| {
                (value_text(row, "status", "status") == Some("current")
                    && value_text(row, "version", "version") != Some(version_key.as_str()))
                .then(|| value_u64(row, "id", "id"))
                .flatten()
            })
        });
    dispatch_ai_evidence_mutation(
        state,
        session,
        "record_ai_evidence_source_version",
        json!([organization_id, company_id, source_id, {
            "version": version_key,
            "edition": format!("DMS version {}", document.version_number),
            "publication_date_micros": null,
            "uri": source_url.unwrap_or(&document.url),
            "retrieved_at_micros": null,
            "content_hash": document.checksum,
            "snapshot_ref": object_key,
            "origin": "user_provided",
            "verification": "inspected",
            "supersedes_version_id": predecessor_id,
        }]),
    )
    .await?;
    let source_version_id = exact_row_id(
        context.client().query_sql_sats(&format!(
            "SELECT * FROM ai_evidence_source_version WHERE organization_id = {organization_id} AND company_id = {company_id} AND source_id = {source_id} AND version = '{}' LIMIT 2",
            document_version_key(document.version_number, &document.checksum)
        )).await.map_err(ApiError::internal)?,
        "document evidence version",
    ).await?;
    if let Some(predecessor_id) = predecessor_id {
        if predecessor_id != source_version_id
            && existing_versions.iter().any(|row| {
                value_u64(row, "id", "id") == Some(predecessor_id)
                    && value_text(row, "status", "status") == Some("current")
            })
        {
            dispatch_ai_evidence_mutation(
                state,
                session,
                "record_ai_evidence_source_change",
                json!([organization_id, company_id, predecessor_id, {
                    "change_kind": "corrected",
                    "replacement_version_id": source_version_id,
                    "reason": format!("DMS document {document_id} current version changed"),
                }]),
            )
            .await?;
        }
    }
    let text_origin = if processor == "external_ocr" {
        "ocr"
    } else {
        "extraction"
    };
    for (passage_key, passage_text, start, end) in passage_chunks(content) {
        let source_version = document_version_key(document.version_number, &document.checksum);
        dispatch_ai_evidence_mutation(
            state,
            session,
            "record_ai_evidence_passage",
            json!([organization_id, company_id, {
                "source_kind": "document",
                "source_key": source_key,
                "source_version": source_version,
                "passage_key": passage_key,
                "passage_text": passage_text,
                "effective_from_micros": null,
                "effective_to_micros": null,
                "applicability": [format!("document:{document_id}")],
                "source_version_id": source_version_id,
                "coordinates": [format!("chars:{start}-{end}")],
                "text_origin": text_origin,
                "processor_ref": format!("server.document_blob_ingestion.v1:{processor}"),
            }]),
        )
        .await?;
        let passage_rows = context.client().query_sql_sats(&format!(
            "SELECT * FROM ai_evidence_passage WHERE organization_id = {organization_id} AND company_id = {company_id} AND source_kind = 'document' AND source_key = 'document:{document_id}' AND source_version = '{}' AND passage_key = '{}' LIMIT 2",
            document_version_key(document.version_number, &document.checksum),
            passage_key,
        )).await.map_err(ApiError::internal)?;
        if passage_rows.len() != 1 {
            return Err(ApiError::Internal(
                "persisted passage could not be resolved uniquely".into(),
            ));
        }
        let passage = &passage_rows[0];
        let passage_id = value_u64(passage, "id", "id")
            .ok_or_else(|| ApiError::Internal("invalid persisted passage id".into()))?;
        let persisted_text = value_text(passage, "passageText", "passage_text")
            .ok_or_else(|| ApiError::Internal("invalid persisted passage text".into()))?;
        let content_hash = value_text(passage, "contentHash", "content_hash")
            .ok_or_else(|| ApiError::Internal("invalid persisted passage hash".into()))?;
        if persisted_text != passage_text {
            return Err(ApiError::Conflict(
                "persisted passage differs from the extracted blob text".into(),
            ));
        }
        dispatch_ai_evidence_search_mutation(
            state,
            session,
            "upsert_search_embedding",
            json!([organization_id, company_id, {
                "content_type": "ai_evidence_passage",
                "content_id": passage_id,
                "text": persisted_text,
                "embedding": [],
                "embedding_hash": content_hash,
                "metadata": json!({
                    "sourceKind": "document",
                    "sourceKey": format!("document:{document_id}"),
                    "sourceVersion": document_version_key(document.version_number, &document.checksum),
                    "passageKey": passage_key,
                }).to_string(),
            }]),
        )
        .await?;
        dispatch_ai_evidence_search_mutation(
            state,
            session,
            "request_embedding_job",
            json!([
                organization_id,
                company_id,
                "ai_evidence_passage",
                passage_id,
                persisted_text
            ]),
        )
        .await?;
    }
    Ok(())
}

async fn evidence_source_versions(
    context: &TrustedOperationContext,
    organization_id: u64,
    company_id: u64,
    document_id: u64,
    _version_number: u64,
) -> Result<Vec<(u64, String)>, ApiError> {
    let sources = context.client().query_sql_sats(&format!(
        "SELECT * FROM ai_evidence_source WHERE organization_id = {organization_id} AND company_id = {company_id} AND source_kind = 'document' AND source_key = 'document:{document_id}' LIMIT 2"
    )).await.map_err(ApiError::internal)?;
    if sources.is_empty() {
        return Ok(Vec::new());
    }
    if sources.len() != 1 {
        return Err(ApiError::Internal(
            "document evidence source is not unique".into(),
        ));
    }
    let source_id = value_u64(&sources[0], "id", "id")
        .ok_or_else(|| ApiError::Internal("invalid evidence source id".into()))?;
    let versions = context.client().query_sql_sats(&format!(
        "SELECT * FROM ai_evidence_source_version WHERE organization_id = {organization_id} AND company_id = {company_id} AND source_id = {source_id}"
    )).await.map_err(ApiError::internal)?;
    versions
        .into_iter()
        .map(|row| {
            let id = value_u64(&row, "id", "id")
                .ok_or_else(|| ApiError::Internal("invalid evidence version id".into()))?;
            let status = value_text(&row, "status", "status")
                .ok_or_else(|| ApiError::Internal("invalid evidence version status".into()))?
                .to_owned();
            Ok((id, status))
        })
        .collect()
}

async fn change_document_evidence(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    OrgSession {
        session,
        organization_id,
    }: OrgSession,
    Json(body): Json<EvidenceLifecycleBody>,
) -> Result<Json<Value>, ApiError> {
    if body.company_id == 0
        || body.document_id == 0
        || !matches!(body.change_kind.as_str(), "access_revoked" | "deleted")
        || body.reason.trim().is_empty()
        || body.reason.len() > 2_000
    {
        return Err(ApiError::BadRequest(
            "invalid evidence lifecycle request".into(),
        ));
    }
    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    let company_id = resolve_membership_company_id(
        context.client(),
        organization_id,
        context.actor_identity(),
        Some(body.company_id),
        "evidence lifecycle company scope mismatch",
    )
    .await?;
    let document = load_current_document(&context, organization_id, body.document_id).await?;
    if document.company_id != company_id {
        return Err(ApiError::NotFound("document not found".into()));
    }
    if body.change_kind == "deleted" && !document.is_deleted {
        return Err(ApiError::Conflict(
            "document must be deleted before its evidence is tombstoned".into(),
        ));
    }
    let source_versions = evidence_source_versions(
        &context,
        organization_id,
        company_id,
        body.document_id,
        document.version_number,
    )
    .await?;
    let target_rank = if body.change_kind == "deleted" { 4 } else { 3 };
    let mut changed = Vec::new();
    for (source_version_id, status) in source_versions {
        let rank = match status.as_str() {
            "current" => 0,
            "superseded" => 1,
            "retracted" => 2,
            "access_revoked" => 3,
            "deleted" => 4,
            _ => 5,
        };
        if rank >= target_rank {
            continue;
        }
        dispatch_ai_evidence_mutation(
            &state,
            &session,
            "record_ai_evidence_source_change",
            json!([organization_id, company_id, source_version_id, {
                "change_kind": body.change_kind,
                "replacement_version_id": null,
                "reason": body.reason.trim(),
            }]),
        )
        .await?;
        changed.push(source_version_id);
    }
    Ok(Json(
        json!({ "ok": true, "changedSourceVersionIds": changed }),
    ))
}

/// Validate a network ingestion target against a mandatory, exact hostname
/// allowlist. Redirects must remain disabled by the caller.
pub(crate) fn validate_network_url(
    raw: &str,
    allowlisted_hosts: &HashSet<String>,
) -> Result<reqwest::Url, ApiError> {
    let url =
        reqwest::Url::parse(raw).map_err(|_| ApiError::BadRequest("invalid source URL".into()))?;
    let host = url
        .host_str()
        .ok_or_else(|| ApiError::BadRequest("source URL has no host".into()))?
        .to_ascii_lowercase();
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || host.parse::<IpAddr>().is_ok()
        || !allowlisted_hosts.contains(&host)
    {
        return Err(ApiError::Forbidden(
            "source URL is not on the evidence ingestion allowlist".into(),
        ));
    }
    Ok(url)
}

pub(crate) fn configured_network_hosts() -> Result<HashSet<String>, ApiError> {
    let hosts: HashSet<String> = std::env::var("LUMIERE_EVIDENCE_NETWORK_HOSTS")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|host| !host.is_empty())
        .map(str::to_ascii_lowercase)
        .collect();
    if hosts.is_empty() {
        return Err(ApiError::Forbidden(
            "network evidence ingestion is disabled".into(),
        ));
    }
    Ok(hosts)
}

pub(crate) fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/ai/evidence/ingestion/documents", post(ingest_document))
        .route(
            "/ai/evidence/ingestion/documents/lifecycle",
            post(change_document_evidence),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_only_bounded_server_owned_utf8_text() {
        let text = extract_server_owned_text("text/plain; charset=utf-8", b" evidence ")
            .expect("extract")
            .expect("text");
        assert_eq!(text, "evidence");
        assert!(extract_server_owned_text("image/png", b"not text")
            .expect("unsupported")
            .is_none());
        assert!(extract_server_owned_text("text/plain", &[0xff]).is_err());
    }

    #[test]
    fn network_sources_require_https_exact_allowlist_and_no_ip_literals() {
        let hosts = HashSet::from(["books.example.test".to_string()]);
        assert!(validate_network_url("https://books.example.test/book.pdf", &hosts).is_ok());
        for rejected in [
            "http://books.example.test/book.pdf",
            "https://evil.example/book.pdf",
            "https://books.example.test.evil.example/book.pdf",
            "https://127.0.0.1/book.pdf",
            "https://user:password@books.example.test/book.pdf",
        ] {
            assert!(
                validate_network_url(rejected, &hosts).is_err(),
                "{rejected}"
            );
        }
    }

    #[test]
    fn html_stripping_does_not_index_markup() {
        let text = extract_server_owned_text(
            "text/html; charset=utf-8",
            b"<h1>Book</h1><p>One chapter.</p>",
        )
        .expect("extract")
        .expect("text");
        assert!(!text.contains('<'));
        assert!(text.contains("Book"));
        assert!(text.contains("One chapter."));
    }

    #[test]
    fn passage_identity_matches_spacetimedb_document_ingestion() {
        assert_eq!(
            document_version_key(3, "0123456789abcdefaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            "v3-0123456789abcdef"
        );
        let text = format!("{}é", "a".repeat(32_767));
        let chunks = passage_chunks(&text);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].0, "chars-0");
        assert_eq!(chunks[0].2, 0);
        assert_eq!(chunks[0].3, 32_767);
        assert_eq!(chunks[1].1, "é");
    }
}
