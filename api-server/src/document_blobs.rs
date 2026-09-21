//! Local object-store boundary for DMS uploads (Wave A).
//!
//! Flow: presign → PUT bytes → complete (size + sha-256 verify) → register via reducer.
//! Swap the disk backend for S3/R2 later without changing reducer contracts.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Path as AxumPath, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tower_cookies::Cookies;

use crate::error::ApiError;
use crate::evidence_ingestion::{configured_network_hosts, validate_network_url};
use crate::query_exec::resolve_membership_company_id;
use crate::state::AppState;
use crate::trusted_context::TrustedOperationContext;
use crate::web_session::{require_org, resolve_session, OrgSession};

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
    completed: bool,
    actual_size: Option<u64>,
    actual_checksum: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PresignBody {
    file_name: String,
    content_type: String,
    content_length: u64,
    company_id: Option<u64>,
    /// Optional client-computed sha-256 hex; verified on complete when present.
    checksum: Option<String>,
    /// Optional residency tag (e.g. au, sg) — selects subdirectory only in Wave A.
    residency: Option<String>,
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

pub fn blob_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/documents/blobs/presign", post(presign))
        .route(
            "/documents/blobs/upload/:organization_id/:residency/:object_id",
            put(upload),
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
    let (bin_path, meta_path) = object_paths(
        &state.config.document_blob_dir,
        organization_id,
        &object_id,
        &residency,
    );
    if let Some(parent) = bin_path.parent() {
        fs::create_dir_all(parent).map_err(ApiError::internal)?;
    }
    fs::write(&bin_path, &bytes).map_err(ApiError::internal)?;
    let checksum = hex::encode(Sha256::digest(&bytes));
    write_meta(
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
            completed: true,
            actual_size: Some(bytes.len() as u64),
            actual_checksum: Some(checksum.clone()),
        },
    )?;
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

fn object_paths(
    root: &Path,
    organization_id: u64,
    object_id: &str,
    residency: &str,
) -> (PathBuf, PathBuf) {
    let dir = root.join(format!("org-{organization_id}")).join(residency);
    let bin = dir.join(format!("{object_id}.bin"));
    let meta = dir.join(format!("{object_id}.meta.json"));
    (bin, meta)
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

pub(crate) fn read_completed_blob(
    root: &Path,
    expected_organization_id: u64,
    expected_company_id: u64,
    object_url: &str,
) -> Result<CompletedBlob, ApiError> {
    const PREFIX: &str = "/api/documents/blobs/object/";
    let key = object_url.strip_prefix(PREFIX).ok_or_else(|| {
        ApiError::Conflict("document version does not name a managed blob".into())
    })?;
    let (organization_id, residency, object_id) = parse_object_key(key)?;
    if organization_id != expected_organization_id {
        return Err(ApiError::Forbidden("organization mismatch".into()));
    }
    let (bin_path, meta_path) = object_paths(root, organization_id, &object_id, &residency);
    let meta = read_meta(&meta_path)?;
    if !meta.completed || meta.company_id != Some(expected_company_id) {
        return Err(ApiError::NotFound(
            "completed company blob not found".into(),
        ));
    }
    let bytes =
        fs::read(&bin_path).map_err(|_| ApiError::NotFound("blob bytes not found".into()))?;
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

fn read_meta(path: &Path) -> Result<BlobMeta, ApiError> {
    let bytes = fs::read(path).map_err(|e| ApiError::NotFound(format!("blob meta: {e}")))?;
    serde_json::from_slice(&bytes)
        .map_err(|e| ApiError::Internal(format!("corrupt blob meta: {e}")))
}

fn write_meta(path: &Path, meta: &BlobMeta) -> Result<(), ApiError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(ApiError::internal)?;
    }
    let json = serde_json::to_vec_pretty(meta).map_err(ApiError::internal)?;
    let mut f = fs::File::create(path).map_err(ApiError::internal)?;
    f.write_all(&json).map_err(ApiError::internal)?;
    Ok(())
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

    let (_, meta_path) = object_paths(
        &state.config.document_blob_dir,
        org_id,
        &object_id,
        &residency,
    );
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
        completed: false,
        actual_size: None,
        actual_checksum: None,
    };
    write_meta(&meta_path, &meta)?;

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

    let residency = residency_segment(Some(&path.residency));
    let (bin_path, meta_path) = object_paths(
        &state.config.document_blob_dir,
        path.organization_id,
        &path.object_id,
        &residency,
    );
    if !meta_path.exists() {
        return Err(ApiError::NotFound(
            "upload slot not found — call presign first".into(),
        ));
    }

    let mut meta = read_meta(&meta_path)?;
    if meta.organization_id != org_id {
        return Err(ApiError::Forbidden("organization mismatch".into()));
    }
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

    if let Some(parent) = bin_path.parent() {
        fs::create_dir_all(parent).map_err(ApiError::internal)?;
    }
    fs::write(&bin_path, &body).map_err(ApiError::internal)?;

    let mut hasher = Sha256::new();
    hasher.update(&body);
    let digest = hex::encode(hasher.finalize());

    if let Some(expected) = meta.expected_checksum.as_ref() {
        if expected != &digest {
            let _ = fs::remove_file(&bin_path);
            return Err(ApiError::Unprocessable(
                "uploaded bytes checksum mismatch vs presign checksum".into(),
            ));
        }
    }

    meta.actual_size = Some(len);
    meta.actual_checksum = Some(digest);
    write_meta(&meta_path, &meta)?;

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

    let (bin_path, meta_path) = object_paths(
        &state.config.document_blob_dir,
        organization_id,
        &object_id,
        &residency,
    );
    let mut meta = read_meta(&meta_path)?;
    if !bin_path.exists() {
        return Err(ApiError::Unprocessable(
            "object bytes missing — PUT upload before complete".into(),
        ));
    }

    let bytes = fs::read(&bin_path).map_err(ApiError::internal)?;
    let len = bytes.len() as u64;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let digest = hex::encode(hasher.finalize());

    if digest != checksum {
        return Err(ApiError::Unprocessable(
            "checksum does not match stored object bytes".into(),
        ));
    }
    if len != meta.expected_size {
        return Err(ApiError::Unprocessable(
            "stored size does not match presign content_length".into(),
        ));
    }

    meta.completed = true;
    meta.actual_size = Some(len);
    meta.actual_checksum = Some(digest.clone());
    write_meta(&meta_path, &meta)?;

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
) -> Result<Response, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    if org_id != path.organization_id {
        return Err(ApiError::Forbidden("organization mismatch".into()));
    }

    let residency = residency_segment(Some(&path.residency));
    let (bin_path, meta_path) = object_paths(
        &state.config.document_blob_dir,
        path.organization_id,
        &path.object_id,
        &residency,
    );
    if !meta_path.exists() {
        return Err(ApiError::NotFound("blob not found".into()));
    }
    let meta = read_meta(&meta_path)?;
    if !meta.completed {
        return Err(ApiError::NotFound("blob not completed".into()));
    }
    let bytes = fs::read(&bin_path).map_err(|e| ApiError::NotFound(e.to_string()))?;

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
            "attachment; filename=\"{}\"",
            meta.file_name.replace('"', "")
        ))
        .unwrap_or_else(|_| header::HeaderValue::from_static("attachment")),
    );
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
