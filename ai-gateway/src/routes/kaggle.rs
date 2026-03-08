/// Kaggle dataset proxy — search, async download, and job status.
///
/// Routes:
///   POST /v1/kaggle/search           — search Kaggle dataset catalogue (cached)
///   POST /v1/kaggle/download         — kick off async dataset download → job_id
///   GET  /v1/kaggle/status/:job_id   — poll download progress
use std::path::PathBuf;

use axum::{
    extract::{Path, State},
    Json,
};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

use crate::{
    error::{AppError, AppResult},
    kaggle::{DownloadJobStatus, JobStatus, KaggleCacheEntry, KaggleDataset},
    state::AppState,
};

const KAGGLE_API_BASE: &str = "https://www.kaggle.com/api/v1";

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Returns (username, api_key) or a 503 AppError if Kaggle is not configured.
fn kaggle_creds(state: &AppState) -> AppResult<(&str, &str)> {
    match (
        state.config.kaggle_username.as_deref(),
        state.config.kaggle_api_key.as_deref(),
    ) {
        (Some(u), Some(k)) => Ok((u, k)),
        _ => Err(AppError::Internal(
            "Kaggle integration is not configured (KAGGLE_USERNAME / KAGGLE_KEY missing)".into(),
        )),
    }
}

/// Build the local cache path for a dataset. Creates parent dirs if needed.
/// Layout: {dataset_cache_dir}/{org_id}/{owner}/{dataset_name}/
async fn dataset_dir(state: &AppState, org_id: &str, dataset_ref: &str) -> AppResult<PathBuf> {
    // dataset_ref is "owner/dataset-name"
    let safe_ref = dataset_ref.replace('/', std::path::MAIN_SEPARATOR_STR);
    let dir = PathBuf::from(&state.config.dataset_cache_dir)
        .join(org_id)
        .join(safe_ref);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to create cache dir: {e}")))?;
    Ok(dir)
}

// ── POST /v1/kaggle/search ────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct SearchRequest {
    pub query: String,
    #[serde(default = "default_page")]
    pub page: u32,
    #[serde(default = "default_page_size")]
    pub page_size: u32,
}

fn default_page() -> u32 {
    1
}
fn default_page_size() -> u32 {
    20
}

#[derive(Serialize)]
pub struct SearchResponse {
    pub results: Vec<KaggleDataset>,
    pub cached: bool,
}

pub async fn post_search(
    State(state): State<AppState>,
    Json(req): Json<SearchRequest>,
) -> AppResult<Json<SearchResponse>> {
    if req.query.trim().is_empty() {
        return Err(AppError::BadRequest("query must not be empty".into()));
    }

    let (username, api_key) = kaggle_creds(&state)?;
    let cache_key = format!("{}:{}:{}", req.query.trim(), req.page, req.page_size);

    // Check in-memory cache
    if let Some(entry) = state.kaggle_search_cache.get(&cache_key) {
        if !entry.is_expired(state.config.kaggle_cache_ttl_secs) {
            tracing::debug!(query = %req.query, "Kaggle search cache hit");
            return Ok(Json(SearchResponse {
                results: entry.results.clone(),
                cached: true,
            }));
        }
    }

    // Fetch from Kaggle API
    let url = format!(
        "{}/datasets/list?search={}&page={}&pageSize={}",
        KAGGLE_API_BASE,
        urlenccode(&req.query),
        req.page,
        req.page_size,
    );

    let resp = state
        .http
        .get(&url)
        .basic_auth(username, Some(api_key))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Kaggle API request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Internal(format!(
            "Kaggle API error {status}: {body}"
        )));
    }

    let datasets: Vec<KaggleDataset> = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to parse Kaggle response: {e}")))?;

    // Store in cache
    state
        .kaggle_search_cache
        .insert(cache_key, KaggleCacheEntry::new(datasets.clone()));

    tracing::info!(
        query = %req.query,
        count = datasets.len(),
        "Kaggle search completed"
    );

    Ok(Json(SearchResponse {
        results: datasets,
        cached: false,
    }))
}

/// Minimal percent-encoding for query string values (spaces → %20, etc.).
fn urlenccode(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            ' ' => "%20".to_string(),
            c => format!("%{:02X}", c as u32),
        })
        .collect()
}

// ── POST /v1/kaggle/download ──────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct DownloadRequest {
    /// Dataset reference in the form "owner/dataset-name"
    pub dataset_ref: String,
    pub org_id: String,
}

#[derive(Serialize)]
pub struct DownloadResponse {
    pub job_id: String,
    pub message: String,
}

pub async fn post_download(
    State(state): State<AppState>,
    Json(req): Json<DownloadRequest>,
) -> AppResult<Json<DownloadResponse>> {
    if !req.dataset_ref.contains('/') {
        return Err(AppError::BadRequest(
            "dataset_ref must be in the form 'owner/dataset-name'".into(),
        ));
    }
    let (username, api_key) = kaggle_creds(&state)?;

    // Check if already downloaded
    let dest_dir = dataset_dir(&state, &req.org_id, &req.dataset_ref).await?;
    let zip_path = dest_dir.join("dataset.zip");
    if zip_path.exists() {
        // Return a synthetic "done" job so client gets the path immediately
        let job_id = uuid::Uuid::new_v4().to_string();
        let mut status = DownloadJobStatus::new(
            job_id.clone(),
            req.dataset_ref.clone(),
            req.org_id.clone(),
        );
        status.status = JobStatus::Done;
        status.local_path = Some(zip_path.to_string_lossy().into_owned());
        state.download_jobs.insert(job_id.clone(), status);
        return Ok(Json(DownloadResponse {
            job_id,
            message: "Dataset already cached".into(),
        }));
    }

    let job_id = uuid::Uuid::new_v4().to_string();
    let initial_status =
        DownloadJobStatus::new(job_id.clone(), req.dataset_ref.clone(), req.org_id.clone());
    state
        .download_jobs
        .insert(job_id.clone(), initial_status);

    // Clone everything the background task needs
    let jobs = state.download_jobs.clone();
    let http = state.http.clone();
    let dataset_ref = req.dataset_ref.clone();
    let jid = job_id.clone();
    let username = username.to_owned();
    let api_key = api_key.to_owned();

    tokio::spawn(async move {
        run_download(jobs, http, jid, dataset_ref, zip_path, username, api_key).await;
    });

    tracing::info!(job_id = %job_id, dataset = %req.dataset_ref, "Kaggle download job queued");

    Ok(Json(DownloadResponse {
        job_id,
        message: "Download started".into(),
    }))
}

/// Background download task — streams Kaggle ZIP to disk and updates job status.
async fn run_download(
    jobs: std::sync::Arc<dashmap::DashMap<String, DownloadJobStatus>>,
    http: std::sync::Arc<reqwest::Client>,
    job_id: String,
    dataset_ref: String,
    dest_path: PathBuf,
    username: String,
    api_key: String,
) {
    // Split "owner/dataset-name"
    let parts: Vec<&str> = dataset_ref.splitn(2, '/').collect();
    let (owner, name) = (parts[0], parts[1]);

    let url = format!("{KAGGLE_API_BASE}/datasets/{owner}/{name}/download");

    // Set status → Downloading
    if let Some(mut job) = jobs.get_mut(&job_id) {
        job.status = JobStatus::Downloading;
    }

    let result = async {
        let resp = http
            .get(&url)
            .basic_auth(&username, Some(&api_key))
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Kaggle download error {status}: {body}"));
        }

        let total_bytes = resp.content_length();

        // Update total_bytes in job
        if let Some(mut job) = jobs.get_mut(&job_id) {
            job.total_bytes = total_bytes;
        }

        let mut file = tokio::fs::File::create(&dest_path)
            .await
            .map_err(|e| format!("Failed to create file: {e}"))?;

        let mut stream = resp.bytes_stream();
        let mut downloaded: u64 = 0;

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Stream error: {e}"))?;
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("Write error: {e}"))?;
            downloaded += chunk.len() as u64;

            // Update progress every chunk
            if let Some(mut job) = jobs.get_mut(&job_id) {
                job.progress_bytes = downloaded;
            }
        }

        file.flush()
            .await
            .map_err(|e| format!("Flush error: {e}"))?;

        Ok::<_, String>(dest_path.to_string_lossy().into_owned())
    }
    .await;

    match result {
        Ok(local_path) => {
            tracing::info!(job_id = %job_id, path = %local_path, "Kaggle download complete");
            if let Some(mut job) = jobs.get_mut(&job_id) {
                job.status = JobStatus::Done;
                job.local_path = Some(local_path);
            }
        }
        Err(e) => {
            tracing::error!(job_id = %job_id, error = %e, "Kaggle download failed");
            if let Some(mut job) = jobs.get_mut(&job_id) {
                job.status = JobStatus::Error;
                job.error = Some(e);
            }
        }
    }
}

// ── GET /v1/kaggle/status/:job_id ─────────────────────────────────────────────

pub async fn get_status(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> AppResult<Json<DownloadJobStatus>> {
    state
        .download_jobs
        .get(&job_id)
        .map(|entry| Json(entry.clone()))
        .ok_or_else(|| AppError::NotFound(format!("job_id '{job_id}' not found")))
}
