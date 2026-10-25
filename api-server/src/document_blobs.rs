//! Private local/S3 object-store boundary for managed DMS uploads.
//!
//! Flow: presign → PUT bytes → complete (size + sha-256 verify) → register via reducer.
//! Stable managed URLs keep storage credentials and object keys behind authorization.

use std::path::Path;
use std::sync::Arc;
#[cfg(test)]
use std::{fs, path::PathBuf};

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path as AxumPath, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tower_cookies::Cookies;

use crate::document_blob_store::{self as storage, DocumentBlobStoreConfig};
use crate::error::ApiError;
use crate::evidence_ingestion::{configured_network_hosts, validate_network_url};
use crate::query_exec::{execute_resource_query_for_company, resolve_membership_company_id};
use crate::session::ApiSession;
use crate::state::AppState;
use crate::trusted_context::TrustedOperationContext;
use crate::web_session::{require_org, resolve_session, OrgSession};

#[path = "document_blob_access.rs"]
mod generated_access;
use generated_access::{
    branding_blob_is_visible, document_blob_is_visible, expense_receipt_blob_is_visible,
    DocumentBlobScope,
};

#[path = "document_blob_policy.rs"]
mod upload_policy;
use upload_policy::{
    creator_matches, require_upload_permission, validate_upload_purpose, BlobPurpose,
};

#[cfg(test)]
#[path = "document_blob_route_tests.rs"]
mod route_tests;

const MAX_UPLOAD_BYTES: u64 = 50 * 1024 * 1024; // 50 MiB pilot cap

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlobMeta {
    organization_id: u64,
    company_id: Option<u64>,
    object_key: String,
    file_name: String,
    content_type: String,
    expected_size: u64,
    expected_checksum: Option<String>,
    residency: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_url: Option<String>,
    /// Set from the authenticated session, never supplied by a reservation caller.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    created_by: Option<String>,
    #[serde(default)]
    purpose: BlobPurpose,
    /// Kept for compatibility with already archived server-generated output.
    #[serde(default)]
    generated_pdf: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    generated_by: Option<String>,
    completed: bool,
    actual_size: Option<u64>,
    actual_checksum: Option<String>,
}

impl BlobMeta {
    fn creator_identity(&self) -> Option<&str> {
        self.created_by.as_deref().or_else(|| {
            if self.generated_pdf {
                self.generated_by.as_deref()
            } else {
                None
            }
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PresignBody {
    file_name: String,
    content_type: String,
    content_length: u64,
    company_id: Option<u64>,
    /// Optional client-computed sha-256 hex; verified on complete when present.
    checksum: Option<String>,
    /// Logical namespace only. The configured bucket determines physical residency.
    residency: Option<String>,
    #[serde(default)]
    purpose: BlobPurpose,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PresignResponse {
    object_key: String,
    upload_url: String,
    public_url: String,
    headers: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompleteBody {
    object_key: String,
    checksum: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompleteResponse {
    url: String,
    object_key: String,
    file_size: u64,
    checksum: String,
    mimetype: String,
    file_name: String,
}

#[derive(Debug, Deserialize)]
struct ObjectPath {
    organization_id: u64,
    residency: String,
    object_id: String,
}

#[derive(Debug, Default, Deserialize)]
struct BlobDownloadQuery {
    sha256: Option<String>,
}

pub fn blob_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/documents/blobs/presign", post(presign))
        .route(
            "/documents/blobs/upload/:organization_id/:residency/:object_id",
            put(upload).layer(DefaultBodyLimit::max(MAX_UPLOAD_BYTES as usize)),
        )
        .route("/documents/blobs/complete", post(complete))
        .route("/documents/blobs/import-network", post(import_network))
        .route(
            "/documents/blobs/object/:organization_id/:residency/:object_id",
            get(download),
        )
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct NetworkImportBody {
    company_id: u64,
    source_url: String,
    file_name: Option<String>,
}

async fn import_network(
    State(state): State<Arc<AppState>>,
    OrgSession {
        session,
        organization_id,
    }: OrgSession,
    Json(body): Json<NetworkImportBody>,
) -> Result<Json<CompleteResponse>, ApiError> {
    require_upload_permission(
        session.field_access.as_ref(),
        organization_id,
        &session.identity_hex,
        BlobPurpose::Document,
    )?;
    if body.company_id == 0 {
        return Err(ApiError::BadRequest("companyId must be positive".into()));
    }
    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    let company_id = resolve_membership_company_id(
        context.client(),
        organization_id,
        context.actor_identity(),
        Some(body.company_id),
        "network ingestion company scope mismatch",
    )
    .await?;
    let hosts = configured_network_hosts()?;
    let source_url = validate_network_url(&body.source_url, &hosts)?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(ApiError::internal)?;
    let mut response = client
        .get(source_url.clone())
        .header(
            header::ACCEPT,
            "application/pdf,text/plain,text/html,application/json,application/xml",
        )
        .send()
        .await
        .map_err(ApiError::unavailable)?;
    if response.status().is_redirection() || !response.status().is_success() {
        return Err(ApiError::UnavailableSource(anyhow::anyhow!(
            "network evidence source returned {}",
            response.status()
        )));
    }
    if response
        .content_length()
        .is_some_and(|length| length == 0 || length > MAX_UPLOAD_BYTES)
    {
        return Err(ApiError::Unprocessable(
            "network source exceeds the blob size limit".into(),
        ));
    }
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .split(';')
        .next()
        .unwrap_or("application/octet-stream")
        .trim()
        .to_ascii_lowercase();
    let mut bytes = Vec::with_capacity(response.content_length().unwrap_or(0) as usize);
    while let Some(chunk) = response.chunk().await.map_err(ApiError::unavailable)? {
        if bytes.len().saturating_add(chunk.len()) > MAX_UPLOAD_BYTES as usize {
            return Err(ApiError::Unprocessable(
                "network source exceeds the blob size limit".into(),
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.is_empty() {
        return Err(ApiError::Unprocessable("network source is empty".into()));
    }

    let file_name = body.file_name.unwrap_or_else(|| {
        source_url
            .path_segments()
            .and_then(Iterator::last)
            .filter(|name| !name.is_empty())
            .unwrap_or("network-source.bin")
            .to_owned()
    });
    let file_name = sanitize_file_name(&file_name);
    let residency = "network".to_string();
    let mut id_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut id_bytes);
    let object_id = hex::encode(id_bytes);
    let object_key = format!("org-{organization_id}/{residency}/{object_id}");
    let store = &state.config.document_blob_store;
    let (bin_path, meta_path) = object_keys(organization_id, &object_id, &residency);
    storage::put_immutable(store, &bin_path, &bytes, &content_type).await?;
    let checksum = hex::encode(Sha256::digest(&bytes));
    create_meta(
        store,
        &meta_path,
        &BlobMeta {
            organization_id,
            company_id: Some(company_id),
            object_key: object_key.clone(),
            file_name: file_name.clone(),
            content_type: content_type.clone(),
            expected_size: bytes.len() as u64,
            expected_checksum: Some(checksum.clone()),
            residency: Some(residency.clone()),
            source_url: Some(source_url.to_string()),
            created_by: Some(session.identity_hex.clone()),
            purpose: BlobPurpose::Document,
            generated_pdf: false,
            generated_by: None,
            completed: true,
            actual_size: Some(bytes.len() as u64),
            actual_checksum: Some(checksum.clone()),
        },
    )
    .await?;
    Ok(Json(CompleteResponse {
        url: format!("/api/documents/blobs/object/{organization_id}/{residency}/{object_id}"),
        object_key,
        file_size: bytes.len() as u64,
        checksum,
        mimetype: content_type.clone(),
        file_name,
    }))
}

fn sanitize_file_name(name: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("upload.bin");
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ') {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.trim().is_empty() {
        "upload.bin".to_string()
    } else {
        cleaned
    }
}

fn normalize_checksum(checksum: &str) -> Result<String, ApiError> {
    let c = checksum.trim().to_lowercase();
    if c.len() != 64 || !c.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err(ApiError::Unprocessable(
            "checksum must be a 64-character sha-256 hex digest".into(),
        ));
    }
    Ok(c)
}

fn residency_segment(residency: Option<&str>) -> String {
    match residency.map(str::trim).filter(|s| !s.is_empty()) {
        Some(r) if r.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') => {
            r.to_ascii_lowercase()
        }
        _ => "default".to_string(),
    }
}

fn object_keys(organization_id: u64, object_id: &str, residency: &str) -> (String, String) {
    let key = format!("org-{organization_id}/{residency}/{object_id}");
    (format!("{key}.bin"), format!("{key}.meta.json"))
}

#[cfg(test)]
fn object_paths(
    root: &Path,
    organization_id: u64,
    object_id: &str,
    residency: &str,
) -> (PathBuf, PathBuf) {
    let (binary, metadata) = object_keys(organization_id, object_id, residency);
    (root.join(binary), root.join(metadata))
}

fn parse_object_key(object_key: &str) -> Result<(u64, String, String), ApiError> {
    // org-{id}/{residency}/{uuid}
    let parts: Vec<&str> = object_key.split('/').collect();
    if parts.len() != 3 {
        return Err(ApiError::Unprocessable("invalid object_key".into()));
    }
    let org_part = parts[0];
    if !org_part.starts_with("org-") {
        return Err(ApiError::Unprocessable(
            "invalid object_key org segment".into(),
        ));
    }
    let organization_id: u64 = org_part[4..]
        .parse()
        .map_err(|_| ApiError::Unprocessable("invalid object_key org id".into()))?;
    let residency = parts[1].to_string();
    let object_id = parts[2].to_string();
    if residency.is_empty()
        || residency.len() > 32
        || !residency
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(ApiError::Unprocessable("invalid residency segment".into()));
    }
    if object_id.len() != 32 || !object_id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(ApiError::Unprocessable("invalid object_id".into()));
    }
    Ok((organization_id, residency, object_id))
}

pub(crate) fn managed_blob_url(
    expected_organization_id: u64,
    object_key: &str,
) -> Result<String, ApiError> {
    let (organization_id, residency, object_id) = parse_object_key(object_key)?;
    if organization_id != expected_organization_id {
        return Err(ApiError::Forbidden("organization mismatch".into()));
    }
    Ok(format!(
        "/api/documents/blobs/object/{organization_id}/{residency}/{object_id}"
    ))
}

pub(crate) struct CompletedBlob {
    pub object_key: String,
    pub content_type: String,
    pub checksum: String,
    pub source_url: Option<String>,
    pub bytes: Vec<u8>,
}

/// The immutable bytes produced by a server renderer, ready for document registration.
pub(crate) struct GeneratedPdfBlob {
    pub url: String,
    pub checksum: String,
    pub size: u64,
}

/// Write a new, company-owned object without an upload URL that could replace it.
/// Callers register the result through the canonical `create_document` operation.
pub(crate) async fn store_generated_pdf(
    store: &DocumentBlobStoreConfig,
    organization_id: u64,
    company_id: u64,
    actor_identity: &str,
    file_name: &str,
    bytes: &[u8],
) -> Result<GeneratedPdfBlob, ApiError> {
    if organization_id == 0
        || company_id == 0
        || !bytes.starts_with(b"%PDF-")
        || bytes.len() > 8 * 1024 * 1024
    {
        return Err(ApiError::Unprocessable(
            "invalid generated PDF or company scope".into(),
        ));
    }
    let generated_by = stdb_auth::identity_sql_literal(actor_identity)
        .map_err(|_| ApiError::Unprocessable("invalid generated PDF creator".into()))?;
    let mut id_bytes = [0_u8; 16];
    rand::thread_rng().fill_bytes(&mut id_bytes);
    let object_id = hex::encode(id_bytes);
    let residency = "generated";
    let (bin_path, meta_path) = object_keys(organization_id, &object_id, residency);
    storage::put_immutable(store, &bin_path, bytes, "application/pdf").await?;
    let checksum = hex::encode(Sha256::digest(bytes));
    let meta = BlobMeta {
        organization_id,
        company_id: Some(company_id),
        object_key: format!("org-{organization_id}/{residency}/{object_id}"),
        file_name: sanitize_file_name(file_name),
        content_type: "application/pdf".into(),
        expected_size: bytes.len() as u64,
        expected_checksum: Some(checksum.clone()),
        residency: Some(residency.into()),
        source_url: None,
        created_by: Some(generated_by.clone()),
        purpose: BlobPurpose::Document,
        generated_pdf: true,
        generated_by: Some(generated_by),
        completed: true,
        actual_size: Some(bytes.len() as u64),
        actual_checksum: Some(checksum.clone()),
    };
    create_meta(store, &meta_path, &meta).await?;
    Ok(GeneratedPdfBlob {
        url: format!("/api/documents/blobs/object/{organization_id}/{residency}/{object_id}"),
        checksum,
        size: bytes.len() as u64,
    })
}

/// Apply the current download policy before private bytes reach extraction or OCR.
pub(crate) async fn read_authorized_document_blob(
    state: &AppState,
    session: &ApiSession,
    expected_company_id: u64,
    document_id: u64,
    object_url: &str,
) -> Result<CompletedBlob, ApiError> {
    let organization_id = require_org(session)?;
    let key = completed_blob_key(object_url)?;
    let (key_organization_id, residency, object_id) = parse_object_key(&key)?;
    if key_organization_id != organization_id {
        return Err(ApiError::NotFound("document blob not found".into()));
    }
    let store = &state.config.document_blob_store;
    let (bin_path, meta_path) = object_keys(organization_id, &object_id, &residency);
    let meta = read_meta(store, &meta_path).await?;
    if !meta.completed
        || meta.organization_id != organization_id
        || meta.company_id != Some(expected_company_id)
        || meta.object_key != key
        || meta.purpose != BlobPurpose::Document
    {
        return Err(ApiError::NotFound("document blob not found".into()));
    }
    require_blob_company(state, session, meta.company_id).await?;
    require_blob_read(state, session, &meta, object_url, None, Some(document_id)).await?;
    let bytes = storage::read(store, &bin_path, MAX_UPLOAD_BYTES)
        .await?
        .ok_or_else(|| ApiError::NotFound("blob bytes not found".into()))?;
    let checksum = meta
        .actual_checksum
        .as_deref()
        .ok_or_else(|| ApiError::NotFound("blob checksum is unavailable".into()))?;
    verify_pinned_download(&meta, &bytes, organization_id, checksum)?;
    Ok(CompletedBlob {
        object_key: meta.object_key,
        content_type: meta.content_type,
        checksum: checksum.to_owned(),
        source_url: meta.source_url,
        bytes,
    })
}

#[cfg(test)]
async fn read_completed_blob(
    store: &DocumentBlobStoreConfig,
    expected_organization_id: u64,
    expected_company_id: u64,
    object_url: &str,
) -> Result<CompletedBlob, ApiError> {
    read_completed_scoped_blob(
        store,
        expected_organization_id,
        expected_company_id,
        object_url,
        false,
        None,
    )
    .await
}

/// Branding may use an organization logo or the invoice's exact company logo.
/// This exception does not change the stricter company-owned evidence boundary.
pub(crate) async fn read_completed_branding_blob(
    store: &DocumentBlobStoreConfig,
    expected_organization_id: u64,
    expected_company_id: u64,
    object_url: &str,
) -> Result<CompletedBlob, ApiError> {
    let (object_url, expected_checksum) = pinned_branding_reference(object_url)?;
    let blob = read_completed_scoped_blob(
        store,
        expected_organization_id,
        expected_company_id,
        object_url,
        true,
        Some(2 * 1024 * 1024),
    )
    .await?;
    if blob.checksum != expected_checksum {
        return Err(ApiError::Conflict(
            "pinned invoice logo content has changed".into(),
        ));
    }
    validate_branding_raster(&blob.content_type, &blob.bytes)?;
    Ok(blob)
}

fn pinned_branding_reference(object_url: &str) -> Result<(&str, &str), ApiError> {
    let (url, checksum) = object_url.split_once("?sha256=").ok_or_else(|| {
        ApiError::Unprocessable("invoice logo requires a pinned SHA-256 content hash".into())
    })?;
    validate_pinned_checksum(checksum)?;
    Ok((url, checksum))
}

fn validate_pinned_checksum(checksum: &str) -> Result<(), ApiError> {
    if checksum.len() != 64
        || !checksum
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(ApiError::Unprocessable(
            "invalid pinned SHA-256 content hash".into(),
        ));
    }
    Ok(())
}

fn completed_blob_key(object_url: &str) -> Result<String, ApiError> {
    const PREFIX: &str = "/api/documents/blobs/object/";
    let key = object_url.strip_prefix(PREFIX).ok_or_else(|| {
        ApiError::Conflict("document version does not name a managed blob".into())
    })?;
    // Object URLs use `/object/7/...`; storage keys use `org-7/...`.
    // Keep support for previously stored key-form URLs without accepting arbitrary URLs.
    Ok(if key.starts_with("org-") {
        key.to_string()
    } else {
        format!("org-{key}")
    })
}

async fn read_completed_scoped_blob(
    store: &DocumentBlobStoreConfig,
    expected_organization_id: u64,
    expected_company_id: u64,
    object_url: &str,
    allow_organization_owned: bool,
    max_bytes: Option<u64>,
) -> Result<CompletedBlob, ApiError> {
    let key = completed_blob_key(object_url)?;
    let (organization_id, residency, object_id) = parse_object_key(&key)?;
    if organization_id != expected_organization_id {
        return Err(ApiError::Forbidden("organization mismatch".into()));
    }
    let (bin_path, meta_path) = object_keys(organization_id, &object_id, &residency);
    let meta = read_meta(store, &meta_path).await?;
    let company_allowed = meta.company_id == Some(expected_company_id)
        || (allow_organization_owned && meta.company_id.is_none());
    if !meta.completed
        || meta.organization_id != expected_organization_id
        || meta.object_key != key
        || !company_allowed
    {
        return Err(ApiError::NotFound(
            "completed company blob not found".into(),
        ));
    }
    // A confidential image uploaded as a document cannot be reused as a logo to
    // bypass the document reader through a template or generated invoice.
    if allow_organization_owned
        && (meta.purpose != BlobPurpose::Branding
            || meta
                .creator_identity()
                .and_then(|identity| stdb_auth::identity_sql_literal(identity).ok())
                .is_none())
    {
        return Err(ApiError::NotFound("branding asset not found".into()));
    }
    if let Some(limit) = max_bytes {
        let size = storage::size(store, &bin_path)
            .await?
            .ok_or_else(|| ApiError::NotFound("blob bytes not found".into()))?;
        if size == 0 || size > limit {
            return Err(ApiError::Unprocessable(
                "invoice logo must be at most 2 MiB".into(),
            ));
        }
    }
    let bytes = storage::read(store, &bin_path, max_bytes.unwrap_or(MAX_UPLOAD_BYTES))
        .await?
        .ok_or_else(|| ApiError::NotFound("blob bytes not found".into()))?;
    if max_bytes.is_some_and(|limit| bytes.is_empty() || bytes.len() as u64 > limit) {
        return Err(ApiError::Unprocessable(
            "invoice logo must be at most 2 MiB".into(),
        ));
    }
    let checksum = hex::encode(Sha256::digest(&bytes));
    if meta.actual_size != Some(bytes.len() as u64)
        || meta.actual_checksum.as_deref() != Some(checksum.as_str())
    {
        return Err(ApiError::Conflict(
            "server-owned blob integrity check failed".into(),
        ));
    }
    Ok(CompletedBlob {
        object_key: meta.object_key,
        content_type: meta.content_type,
        checksum,
        source_url: meta.source_url,
        bytes,
    })
}

/// Limit decoded pixels before giving an image to Chromium. Only PNG and JPEG
/// signatures with bounded dimensions are admitted; SVG, HTML and remote assets never are.
fn validate_branding_raster(content_type: &str, bytes: &[u8]) -> Result<(), ApiError> {
    let invalid = || {
        ApiError::Unprocessable(
            "invoice logo must be a valid PNG or JPEG within 4096px and 4 megapixels".into(),
        )
    };
    let dimensions = match content_type {
        "image/png"
            if bytes.starts_with(b"\x89PNG\r\n\x1a\n")
                && bytes.get(8..16) == Some(&b"\0\0\0\rIHDR"[..])
                && bytes.len() >= 45
                && bytes.ends_with(b"\0\0\0\0IEND\xaeB`\x82") =>
        {
            let width = bytes
                .get(16..20)
                .and_then(|value| <[u8; 4]>::try_from(value).ok())
                .map(u32::from_be_bytes);
            let height = bytes
                .get(20..24)
                .and_then(|value| <[u8; 4]>::try_from(value).ok())
                .map(u32::from_be_bytes);
            width.zip(height)
        }
        "image/jpeg" if bytes.starts_with(&[0xff, 0xd8]) && bytes.ends_with(&[0xff, 0xd9]) => {
            jpeg_dimensions(bytes)
        }
        _ => None,
    }
    .ok_or_else(invalid)?;
    let (width, height) = dimensions;
    if width == 0
        || height == 0
        || width > 4096
        || height > 4096
        || u64::from(width) * u64::from(height) > 4_000_000
    {
        return Err(invalid());
    }
    Ok(())
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    let mut offset = 2;
    while offset < bytes.len() {
        if bytes.get(offset) != Some(&0xff) {
            return None;
        }
        while bytes.get(offset) == Some(&0xff) {
            offset += 1;
        }
        let marker = *bytes.get(offset)?;
        offset += 1;
        if matches!(marker, 0xd9 | 0xda) {
            return None;
        }
        if matches!(marker, 0x01 | 0xd0..=0xd8) {
            continue;
        }
        let length = u16::from_be_bytes([*bytes.get(offset)?, *bytes.get(offset + 1)?]) as usize;
        if length < 2 {
            return None;
        }
        let segment = bytes.get(offset..offset.checked_add(length)?)?;
        if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) {
            if segment.len() < 8 {
                return None;
            }
            return Some((
                u32::from(u16::from_be_bytes([segment[5], segment[6]])),
                u32::from(u16::from_be_bytes([segment[3], segment[4]])),
            ));
        }
        offset += length;
    }
    None
}

async fn read_meta(store: &DocumentBlobStoreConfig, key: &str) -> Result<BlobMeta, ApiError> {
    let bytes = storage::read(store, key, 256 * 1024)
        .await?
        .ok_or_else(|| ApiError::NotFound("blob metadata not found".into()))?;
    serde_json::from_slice(&bytes)
        .map_err(|e| ApiError::Internal(format!("corrupt blob metadata: {e}")))
}

async fn create_meta(
    store: &DocumentBlobStoreConfig,
    key: &str,
    meta: &BlobMeta,
) -> Result<(), ApiError> {
    let json = serde_json::to_vec_pretty(meta).map_err(ApiError::internal)?;
    storage::put_immutable(store, key, &json, "application/json").await
}

async fn write_meta(
    store: &DocumentBlobStoreConfig,
    key: &str,
    meta: &BlobMeta,
) -> Result<(), ApiError> {
    let json = serde_json::to_vec_pretty(meta).map_err(ApiError::internal)?;
    storage::write_metadata(store, key, &json).await
}

async fn require_blob_company(
    state: &AppState,
    session: &ApiSession,
    company_id: Option<u64>,
) -> Result<(), ApiError> {
    let trusted = TrustedOperationContext::for_resource_read(state, session)?;
    if let Some(company_id) = company_id {
        resolve_membership_company_id(
            trusted.client(),
            trusted.organization_id(),
            trusted.actor_identity(),
            Some(company_id),
            "document blob company scope mismatch",
        )
        .await?;
    }
    Ok(())
}

async fn require_blob_upload(
    state: &AppState,
    session: &ApiSession,
    meta: &BlobMeta,
    object_key: &str,
) -> Result<(), ApiError> {
    let organization_id = require_org(session)?;
    if meta.organization_id != organization_id
        || meta.object_key != object_key
        || !creator_matches(meta.creator_identity(), &session.identity_hex)
        || meta.generated_pdf
    {
        return Err(ApiError::NotFound("upload reservation not found".into()));
    }
    require_upload_permission(
        session.field_access.as_ref(),
        organization_id,
        &session.identity_hex,
        meta.purpose,
    )?;
    validate_upload_purpose(
        meta.purpose,
        &meta.content_type,
        meta.expected_size,
        meta.company_id,
    )?;
    require_blob_company(state, session, meta.company_id).await
}

async fn presign(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<PresignBody>,
) -> Result<Json<PresignResponse>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;

    if body.content_length == 0 {
        return Err(ApiError::Unprocessable("content_length must be > 0".into()));
    }
    if body.content_length > MAX_UPLOAD_BYTES {
        return Err(ApiError::Unprocessable(format!(
            "file exceeds max size of {MAX_UPLOAD_BYTES} bytes"
        )));
    }
    if body.content_type.trim().is_empty() {
        return Err(ApiError::Unprocessable("content_type is required".into()));
    }
    require_upload_permission(
        session.field_access.as_ref(),
        org_id,
        &session.identity_hex,
        body.purpose,
    )?;
    validate_upload_purpose(
        body.purpose,
        body.content_type.trim(),
        body.content_length,
        body.company_id,
    )?;
    require_blob_company(&state, &session, body.company_id).await?;
    let expected_checksum = match body.checksum.as_deref() {
        Some(c) if !c.trim().is_empty() => Some(normalize_checksum(c)?),
        _ => None,
    };

    let residency = residency_segment(body.residency.as_deref());
    let mut id_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut id_bytes);
    let object_id = hex::encode(id_bytes);
    let object_key = format!("org-{org_id}/{residency}/{object_id}");
    let file_name = sanitize_file_name(&body.file_name);

    let (_, meta_path) = object_keys(org_id, &object_id, &residency);
    let meta = BlobMeta {
        organization_id: org_id,
        company_id: body.company_id,
        object_key: object_key.clone(),
        file_name,
        content_type: body.content_type.trim().to_string(),
        expected_size: body.content_length,
        expected_checksum,
        residency: Some(residency.clone()),
        source_url: None,
        created_by: Some(session.identity_hex.clone()),
        purpose: body.purpose,
        generated_pdf: false,
        generated_by: None,
        completed: false,
        actual_size: None,
        actual_checksum: None,
    };
    create_meta(&state.config.document_blob_store, &meta_path, &meta).await?;

    // Same-origin `/api/...` paths so Next BFF can forward cookies to api-server `/v1/...`.
    let upload_url = format!("/api/documents/blobs/upload/{org_id}/{residency}/{object_id}");
    let public_url = format!("/api/documents/blobs/object/{org_id}/{residency}/{object_id}");

    let mut headers_map = serde_json::Map::new();
    headers_map.insert(
        "Content-Type".into(),
        serde_json::Value::String(meta.content_type.clone()),
    );

    Ok(Json(PresignResponse {
        object_key,
        upload_url,
        public_url,
        headers: headers_map,
    }))
}

async fn upload(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    AxumPath(path): AxumPath<ObjectPath>,
    body: Bytes,
) -> Result<StatusCode, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    if org_id != path.organization_id {
        return Err(ApiError::Forbidden("organization mismatch".into()));
    }

    let (_, residency, object_id) = parse_object_key(&format!(
        "org-{}/{}/{}",
        path.organization_id, path.residency, path.object_id,
    ))?;
    let store = &state.config.document_blob_store;
    let (bin_path, meta_path) = object_keys(path.organization_id, &object_id, &residency);
    let meta = read_meta(store, &meta_path).await?;
    let object_key = format!("org-{org_id}/{residency}/{object_id}");
    require_blob_upload(&state, &session, &meta, &object_key).await?;
    if meta.completed {
        return Err(ApiError::Unprocessable("blob already completed".into()));
    }

    let len = body.len() as u64;
    if len == 0 {
        return Err(ApiError::Unprocessable("empty body".into()));
    }
    if len > MAX_UPLOAD_BYTES {
        return Err(ApiError::Unprocessable(format!(
            "file exceeds max size of {MAX_UPLOAD_BYTES} bytes"
        )));
    }
    if len != meta.expected_size {
        return Err(ApiError::Unprocessable(format!(
            "uploaded size {len} does not match declared content_length {}",
            meta.expected_size
        )));
    }

    let mut hasher = Sha256::new();
    hasher.update(&body);
    let digest = hex::encode(hasher.finalize());

    if let Some(expected) = meta.expected_checksum.as_ref() {
        if expected != &digest {
            return Err(ApiError::Unprocessable(
                "uploaded bytes checksum mismatch vs presign checksum".into(),
            ));
        }
    }
    if meta.purpose == BlobPurpose::Branding {
        validate_branding_raster(&meta.content_type, &body)?;
    }

    // Reserve bytes exactly once. Completion alone advances metadata, so a
    // concurrent/late upload cannot reset an already completed slot.
    storage::put_immutable(store, &bin_path, &body, &meta.content_type).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn complete(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<CompleteBody>,
) -> Result<Json<CompleteResponse>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let checksum = normalize_checksum(&body.checksum)?;
    let (organization_id, residency, object_id) = parse_object_key(&body.object_key)?;
    if organization_id != org_id {
        return Err(ApiError::Forbidden("organization mismatch".into()));
    }

    let store = &state.config.document_blob_store;
    let (bin_path, meta_path) = object_keys(organization_id, &object_id, &residency);
    let mut meta = read_meta(store, &meta_path).await?;
    require_blob_upload(&state, &session, &meta, &body.object_key).await?;
    let bytes = storage::read(store, &bin_path, MAX_UPLOAD_BYTES)
        .await?
        .ok_or_else(|| {
            ApiError::Unprocessable("object bytes missing — PUT upload before complete".into())
        })?;
    let len = bytes.len() as u64;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let digest = hex::encode(hasher.finalize());

    if digest != checksum
        || meta
            .expected_checksum
            .as_deref()
            .is_some_and(|expected| expected != digest)
    {
        return Err(ApiError::Unprocessable(
            "checksum does not match stored object bytes".into(),
        ));
    }
    if len != meta.expected_size {
        return Err(ApiError::Unprocessable(
            "stored size does not match presign content_length".into(),
        ));
    }
    if meta.purpose == BlobPurpose::Branding {
        validate_branding_raster(&meta.content_type, &bytes)?;
    }

    meta.completed = true;
    meta.actual_size = Some(len);
    meta.actual_checksum = Some(digest.clone());
    write_meta(store, &meta_path, &meta).await?;

    let url = format!("/api/documents/blobs/object/{organization_id}/{residency}/{object_id}");

    Ok(Json(CompleteResponse {
        url,
        object_key: meta.object_key,
        file_size: len,
        checksum: digest,
        mimetype: meta.content_type,
        file_name: meta.file_name,
    }))
}

async fn download(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    AxumPath(path): AxumPath<ObjectPath>,
    Query(query): Query<BlobDownloadQuery>,
) -> Result<Response, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    if org_id != path.organization_id {
        return Err(ApiError::Forbidden("organization mismatch".into()));
    }

    if let Some(checksum) = query.sha256.as_deref() {
        validate_pinned_checksum(checksum)?;
    }
    let (_, residency, object_id) = parse_object_key(&format!(
        "org-{}/{}/{}",
        path.organization_id, path.residency, path.object_id
    ))?;
    let store = &state.config.document_blob_store;
    let (bin_path, meta_path) = object_keys(path.organization_id, &object_id, &residency);
    let meta = read_meta(store, &meta_path).await?;
    let object_key = format!("org-{org_id}/{residency}/{object_id}");
    if !meta.completed || meta.organization_id != org_id || meta.object_key != object_key {
        return Err(ApiError::NotFound("completed blob not found".into()));
    }
    require_blob_company(&state, &session, meta.company_id).await?;
    let url = format!("/api/documents/blobs/object/{org_id}/{residency}/{object_id}");
    require_blob_read(&state, &session, &meta, &url, query.sha256.as_deref(), None).await?;
    let max_bytes = if meta.purpose == BlobPurpose::Branding {
        2 * 1024 * 1024
    } else {
        MAX_UPLOAD_BYTES
    };
    let bytes = storage::read(store, &bin_path, max_bytes)
        .await?
        .ok_or_else(|| ApiError::NotFound("blob bytes not found".into()))?;
    let checksum = meta
        .actual_checksum
        .as_deref()
        .ok_or_else(|| ApiError::NotFound("blob checksum is unavailable".into()))?;
    verify_pinned_download(
        &meta,
        &bytes,
        org_id,
        query.sha256.as_deref().unwrap_or(checksum),
    )?;
    if meta.purpose == BlobPurpose::Branding {
        validate_branding_raster(&meta.content_type, &bytes)?;
    }

    let mut response = bytes.into_response();
    let headers_mut = response.headers_mut();
    headers_mut.insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_str(&meta.content_type)
            .unwrap_or_else(|_| header::HeaderValue::from_static("application/octet-stream")),
    );
    headers_mut.insert(
        header::CONTENT_DISPOSITION,
        header::HeaderValue::from_str(&format!(
            "{}; filename=\"{}\"",
            if meta.purpose == BlobPurpose::Branding {
                "inline"
            } else {
                "attachment"
            },
            meta.file_name.replace('"', "")
        ))
        .unwrap_or_else(|_| header::HeaderValue::from_static("attachment")),
    );
    headers_mut.insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("private, no-store"),
    );
    headers_mut.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        header::HeaderValue::from_static("nosniff"),
    );
    Ok(response)
}

/// Each purpose resolves through canonical projected records. The only
/// preregistration read is a bounded, write-authorized branding preview.
async fn require_blob_read(
    state: &AppState,
    session: &ApiSession,
    meta: &BlobMeta,
    url: &str,
    pinned_checksum: Option<&str>,
    document_id: Option<u64>,
) -> Result<(), ApiError> {
    let trusted = TrustedOperationContext::for_resource_read(state, session)?;
    let access = Some(trusted.field_access());
    let scope = DocumentBlobScope {
        organization_id: trusted.organization_id(),
        company_id: meta.company_id,
        creator_identity: meta.creator_identity(),
        url,
        checksum: meta
            .actual_checksum
            .as_deref()
            .ok_or_else(|| ApiError::NotFound("blob checksum is unavailable".into()))?,
    };
    if scope
        .creator_identity
        .and_then(|identity| stdb_auth::identity_sql_literal(identity).ok())
        .is_none()
    {
        return Err(ApiError::NotFound("blob creator is unavailable".into()));
    }
    let query = |resource: &'static str| {
        execute_resource_query_for_company(
            trusted.client(),
            resource,
            scope.organization_id,
            trusted.actor_identity(),
            access,
            scope.company_id,
        )
    };
    let visible = match meta.purpose {
        BlobPurpose::Document => {
            if !stdb_auth::has_resource_read_permission(access, "documents") {
                return Err(ApiError::Forbidden(
                    "document read permission is required".into(),
                ));
            }
            let mut documents = query("documents").await?;
            if let Some(document_id) = document_id {
                // Ingestion is bound to its exact source record. Another owned
                // record for the same bytes cannot authorize a different source.
                documents.retain(|row| {
                    crate::query_exec::row_u64(row, "id", "id").ok().flatten() == Some(document_id)
                });
            }
            if document_blob_is_visible(&scope, access, &documents, &[]) {
                true
            } else {
                let versions =
                    if stdb_auth::has_resource_read_permission(access, "document-versions") {
                        query("document-versions").await?
                    } else {
                        Vec::new()
                    };
                document_blob_is_visible(&scope, access, &documents, &versions)
            }
        }
        BlobPurpose::ExpenseReceipt => {
            if !stdb_auth::has_resource_read_permission(access, "expense-receipts") {
                return Err(ApiError::Forbidden(
                    "receipt read permission is required".into(),
                ));
            }
            let receipts = query("expense-receipts").await?;
            expense_receipt_blob_is_visible(&scope, &meta.object_key, access, &receipts)
        }
        BlobPurpose::Branding => {
            if pinned_checksum != Some(scope.checksum) {
                return Err(ApiError::NotFound("pinned branding asset not found".into()));
            }
            validate_upload_purpose(
                meta.purpose,
                &meta.content_type,
                meta.actual_size.unwrap_or(0),
                meta.company_id,
            )?;
            if creator_matches(scope.creator_identity, trusted.actor_identity())
                && require_upload_permission(
                    access,
                    scope.organization_id,
                    trusted.actor_identity(),
                    BlobPurpose::Branding,
                )
                .is_ok()
            {
                true
            } else {
                let templates =
                    if stdb_auth::has_resource_read_permission(access, "document-templates") {
                        query("document-templates").await?
                    } else {
                        Vec::new()
                    };
                if branding_blob_is_visible(&scope, access, &templates, &[]) {
                    true
                } else {
                    let invoices =
                        if stdb_auth::has_resource_read_permission(access, "account-moves") {
                            query("account-moves").await?
                        } else {
                            Vec::new()
                        };
                    branding_blob_is_visible(&scope, access, &templates, &invoices)
                }
            }
        }
    };
    if visible {
        Ok(())
    } else {
        Err(ApiError::NotFound("document blob not found".into()))
    }
}

fn verify_pinned_download(
    meta: &BlobMeta,
    bytes: &[u8],
    organization_id: u64,
    expected_checksum: &str,
) -> Result<(), ApiError> {
    validate_pinned_checksum(expected_checksum)?;
    if meta.organization_id != organization_id {
        return Err(ApiError::Forbidden("organization mismatch".into()));
    }
    let actual = hex::encode(Sha256::digest(bytes));
    if meta.actual_size != Some(bytes.len() as u64)
        || meta.actual_checksum.as_deref() != Some(actual.as_str())
        || actual != expected_checksum
    {
        return Err(ApiError::Conflict("pinned blob content has changed".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    fn read_fixture_meta(path: &Path) -> Result<BlobMeta, ApiError> {
        serde_json::from_slice(&fs::read(path).map_err(ApiError::internal)?)
            .map_err(ApiError::internal)
    }

    fn write_fixture_meta(path: &Path, meta: &BlobMeta) -> Result<(), ApiError> {
        fs::create_dir_all(path.parent().expect("fixture parent")).map_err(ApiError::internal)?;
        fs::write(path, serde_json::to_vec(meta).map_err(ApiError::internal)?)
            .map_err(ApiError::internal)
    }

    #[tokio::test]
    async fn generated_pdf_is_completed_company_bound_and_checksum_pinned() {
        let root =
            std::env::temp_dir().join(format!("lumiere-generated-{}", rand::random::<u64>()));
        let store = DocumentBlobStoreConfig::Local { root: root.clone() };
        let bytes = b"%PDF-1.7\ngenerated quotation test";
        let actor = "a".repeat(64);
        let generated = store_generated_pdf(&store, 7, 3, &actor, "quotation.pdf", bytes)
            .await
            .expect("store output");
        let read = read_completed_blob(&store, 7, 3, &generated.url)
            .await
            .expect("read immutable output");
        assert_eq!(read.bytes, bytes);
        assert_eq!(read.checksum, generated.checksum);
        assert_eq!(generated.size, bytes.len() as u64);
        assert!(read_completed_blob(&store, 7, 4, &generated.url)
            .await
            .is_err());
        assert!(read_completed_blob(&store, 8, 3, &generated.url)
            .await
            .is_err());
        assert!(
            store_generated_pdf(&store, 7, 3, &actor, "bad.pdf", b"not PDF")
                .await
                .is_err()
        );
        assert!(
            store_generated_pdf(&store, 7, 3, "invalid", "quotation.pdf", bytes)
                .await
                .is_err()
        );
        let next = store_generated_pdf(&store, 7, 3, &actor, "quotation.pdf", b"%PDF-1.7\nchanged")
            .await
            .expect("new output");
        assert_ne!(generated.url, next.url);
        assert_eq!(
            read_completed_blob(&store, 7, 3, &generated.url)
                .await
                .unwrap()
                .bytes,
            bytes
        );
        std::fs::remove_dir_all(root).expect("remove fixture");
    }

    struct BrandingFixture {
        root: PathBuf,
        store: DocumentBlobStoreConfig,
        url: String,
        pinned_url: String,
        bin: PathBuf,
        meta: PathBuf,
    }

    impl BrandingFixture {
        fn new(company_id: Option<u64>, completed: bool) -> Self {
            let root = std::env::temp_dir().join(format!(
                "lumiere-branding-test-{}-{}",
                std::process::id(),
                rand::random::<u64>()
            ));
            let object_id = "0123456789abcdef0123456789abcdef";
            let (bin, meta_path) = object_paths(&root, 7, object_id, "eu");
            let bytes = base64::engine::general_purpose::STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=").expect("PNG fixture");
            let checksum = hex::encode(Sha256::digest(&bytes));
            let meta = BlobMeta {
                organization_id: 7,
                company_id,
                object_key: format!("org-7/eu/{object_id}"),
                file_name: "logo.png".into(),
                content_type: "image/png".into(),
                expected_size: bytes.len() as u64,
                expected_checksum: Some(checksum.clone()),
                residency: Some("eu".into()),
                source_url: None,
                created_by: Some("a".repeat(64)),
                purpose: BlobPurpose::Branding,
                generated_pdf: false,
                generated_by: None,
                completed,
                actual_size: Some(bytes.len() as u64),
                actual_checksum: Some(checksum.clone()),
            };
            write_fixture_meta(&meta_path, &meta).expect("fixture metadata");
            fs::write(&bin, bytes).expect("fixture PNG");
            Self {
                store: DocumentBlobStoreConfig::Local { root: root.clone() },
                root,
                url: format!("/api/documents/blobs/object/7/eu/{object_id}"),
                pinned_url: format!(
                    "/api/documents/blobs/object/7/eu/{object_id}?sha256={checksum}"
                ),
                bin,
                meta: meta_path,
            }
        }
    }

    impl Drop for BrandingFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn managed_blob_urls_reject_cross_org_and_unsafe_residency_segments() {
        let key = "org-7/eu/0123456789abcdef0123456789abcdef";
        assert_eq!(
            managed_blob_url(7, key).expect("valid managed blob key"),
            "/api/documents/blobs/object/7/eu/0123456789abcdef0123456789abcdef"
        );
        assert!(managed_blob_url(8, key).is_err());
        assert!(managed_blob_url(7, "org-7/../0123456789abcdef0123456789abcdef").is_err());
    }

    #[tokio::test]
    async fn branding_allows_same_org_logo_without_relaxing_company_evidence_scope() {
        let organization_logo = BrandingFixture::new(None, true);
        assert!(read_completed_branding_blob(
            &organization_logo.store,
            7,
            3,
            &organization_logo.pinned_url
        )
        .await
        .is_ok());
        assert!(
            read_completed_blob(&organization_logo.store, 7, 3, &organization_logo.url)
                .await
                .is_err()
        );
        let company_logo = BrandingFixture::new(Some(3), true);
        assert!(
            read_completed_branding_blob(&company_logo.store, 7, 3, &company_logo.pinned_url)
                .await
                .is_ok()
        );
        assert!(
            read_completed_blob(&company_logo.store, 7, 3, &company_logo.url)
                .await
                .is_ok()
        );
        assert!(
            read_completed_branding_blob(&company_logo.store, 7, 4, &company_logo.pinned_url)
                .await
                .is_err()
        );
        assert!(
            read_completed_branding_blob(&company_logo.store, 8, 3, &company_logo.pinned_url)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn branding_requires_completed_integrity_checked_local_raster() {
        let fixture = BrandingFixture::new(Some(3), false);
        assert!(
            read_completed_branding_blob(&fixture.store, 7, 3, &fixture.pinned_url)
                .await
                .is_err()
        );
        let fixture = BrandingFixture::new(Some(3), true);
        fs::write(&fixture.bin, b"changed after completion").expect("corrupt fixture");
        assert!(
            read_completed_branding_blob(&fixture.store, 7, 3, &fixture.pinned_url)
                .await
                .is_err()
        );
        for url in [
            "https://example.test/logo.png",
            "data:image/png;base64,AA==",
            "/api/documents/blobs/object/7/../0123456789abcdef0123456789abcdef",
        ] {
            assert!(read_completed_branding_blob(&fixture.store, 7, 3, url)
                .await
                .is_err());
        }
        let fixture = BrandingFixture::new(Some(3), true);
        let mut meta = read_fixture_meta(&fixture.meta).expect("meta");
        meta.content_type = "image/svg+xml".into();
        write_fixture_meta(&fixture.meta, &meta).expect("change MIME");
        assert!(
            read_completed_branding_blob(&fixture.store, 7, 3, &fixture.pinned_url)
                .await
                .is_err()
        );
    }

    #[test]
    fn raster_signature_and_decoded_pixel_caps_reject_disguised_or_oversized_images() {
        assert!(validate_branding_raster("image/png", b"<svg>bad</svg>").is_err());
        assert!(validate_branding_raster("image/jpeg", b"not a JPEG").is_err());
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        png.extend_from_slice(&3000_u32.to_be_bytes());
        png.extend_from_slice(&3000_u32.to_be_bytes());
        assert!(validate_branding_raster("image/png", &png).is_err());
        let mut jpeg = vec![0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0, 2, 0, 3, 1];
        assert_eq!(jpeg_dimensions(&jpeg), Some((3, 2)));
        jpeg[8] = 0xff;
        jpeg[9] = 0xff;
        assert!(validate_branding_raster("image/jpeg", &jpeg).is_err());
    }

    #[tokio::test]
    async fn logo_hash_pin_rejects_mutation_even_when_completed_blob_metadata_is_replaced() {
        let fixture = BrandingFixture::new(Some(3), true);
        let original = read_fixture_meta(&fixture.meta)
            .expect("original metadata")
            .actual_checksum
            .expect("checksum");
        assert!(
            read_completed_branding_blob(&fixture.store, 7, 3, &fixture.url)
                .await
                .is_err(),
            "unversioned logo must be rejected"
        );
        let mut bytes = fs::read(&fixture.bin).expect("original bytes");
        bytes[32] ^= 1;
        fs::write(&fixture.bin, &bytes).expect("replace bytes");
        let mut meta = read_fixture_meta(&fixture.meta).expect("metadata");
        meta.actual_checksum = Some(hex::encode(Sha256::digest(&bytes)));
        write_fixture_meta(&fixture.meta, &meta).expect("replace completed metadata");
        assert!(read_completed_blob(&fixture.store, 7, 3, &fixture.url)
            .await
            .is_ok());
        assert!(
            read_completed_branding_blob(&fixture.store, 7, 3, &fixture.pinned_url)
                .await
                .is_err()
        );
        assert!(verify_pinned_download(&meta, &bytes, 7, &original).is_err());
        assert!(verify_pinned_download(
            &meta,
            &bytes,
            7,
            meta.actual_checksum.as_deref().expect("new checksum")
        )
        .is_ok());
        for invalid in [
            "",
            "NOT_A_HASH",
            &"A".repeat(64),
            &format!("{}&extra=1", original),
        ] {
            assert!(validate_pinned_checksum(invalid).is_err());
        }
    }

    #[tokio::test]
    async fn branding_rejects_oversized_blob_before_image_decode() {
        let fixture = BrandingFixture::new(Some(3), true);
        fs::write(&fixture.bin, vec![0_u8; 2 * 1024 * 1024 + 1]).expect("oversized fixture");
        let error = read_completed_branding_blob(&fixture.store, 7, 3, &fixture.pinned_url)
            .await
            .err()
            .expect("size error");
        assert!(matches!(error, ApiError::Unprocessable(message) if message.contains("2 MiB")));
    }
}
