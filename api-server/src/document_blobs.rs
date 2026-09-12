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
use crate::state::AppState;
use crate::web_session::{require_org, resolve_session};

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
    /// UTF-8 text extract for `text/*` blobs (Wave C search index seed).
    #[serde(skip_serializing_if = "Option::is_none")]
    extracted_text: Option<String>,
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
        .route(
            "/documents/blobs/object/:organization_id/:residency/:object_id",
            get(download),
        )
        // Wave D: lightweight text extract for OCR workers (PDFs need an external OCR TSP).
        .route("/documents/ocr/extract", post(ocr_extract))
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
    if object_id.len() != 32 || !object_id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(ApiError::Unprocessable("invalid object_id".into()));
    }
    Ok((organization_id, residency, object_id))
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

    let extracted_text = extract_text_for_index(&meta.content_type, &bytes);

    Ok(Json(CompleteResponse {
        url,
        object_key: meta.object_key,
        file_size: len,
        checksum: digest,
        mimetype: meta.content_type,
        file_name: meta.file_name,
        extracted_text,
    }))
}

const MAX_EXTRACT_CHARS: usize = 32_768;

fn extract_text_for_index(content_type: &str, bytes: &[u8]) -> Option<String> {
    let mt = content_type.trim().to_ascii_lowercase();
    if !mt.starts_with("text/") && mt != "application/json" && mt != "application/xml" {
        return None;
    }
    let raw = std::str::from_utf8(bytes).ok()?.trim();
    if raw.is_empty() {
        return None;
    }
    if raw.chars().count() > MAX_EXTRACT_CHARS {
        Some(raw.chars().take(MAX_EXTRACT_CHARS).collect())
    } else {
        Some(raw.to_string())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OcrExtractBody {
    object_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OcrExtractResponse {
    object_key: String,
    mimetype: String,
    extracted_text: Option<String>,
    /// true when binary types need an external OCR provider
    needs_external_ocr: bool,
}

async fn ocr_extract(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<OcrExtractBody>,
) -> Result<Json<OcrExtractResponse>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
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
    let meta = read_meta(&meta_path)?;
    if !meta.completed || !bin_path.exists() {
        return Err(ApiError::Unprocessable(
            "blob not ready for OCR extract".into(),
        ));
    }
    let bytes = fs::read(&bin_path).map_err(ApiError::internal)?;
    let extracted_text = extract_text_for_index(&meta.content_type, &bytes);
    let needs_external_ocr = extracted_text.is_none();

    Ok(Json(OcrExtractResponse {
        object_key: body.object_key,
        mimetype: meta.content_type,
        extracted_text,
        needs_external_ocr,
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
