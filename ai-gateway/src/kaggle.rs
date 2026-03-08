/// Shared types for Kaggle dataset proxy (search cache + download jobs).
use std::time::Instant;

use serde::{Deserialize, Serialize};

// ── Kaggle API response types ─────────────────────────────────────────────────

/// Slimmed-down representation of a Kaggle dataset (from list endpoint).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KaggleDataset {
    /// Unique reference in the form "owner/dataset-name"
    #[serde(rename = "ref")]
    pub dataset_ref: String,
    pub title: String,
    #[serde(default)]
    pub subtitle: Option<String>,
    /// Total compressed size in bytes
    #[serde(rename = "totalBytes", default)]
    pub total_bytes: u64,
    #[serde(rename = "lastUpdated", default)]
    pub last_updated: String,
    #[serde(rename = "downloadCount", default)]
    pub download_count: u64,
    #[serde(rename = "voteCount", default)]
    pub vote_count: u64,
    #[serde(rename = "usabilityRating", default)]
    pub usability_rating: f64,
    #[serde(default)]
    pub tags: Vec<KaggleTag>,
    #[serde(rename = "ownerName", default)]
    pub owner_name: String,
    #[serde(rename = "licenseName", default)]
    pub license_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KaggleTag {
    pub name: String,
}

// ── In-memory search cache ────────────────────────────────────────────────────

pub struct KaggleCacheEntry {
    pub results: Vec<KaggleDataset>,
    pub cached_at: Instant,
}

impl KaggleCacheEntry {
    pub fn new(results: Vec<KaggleDataset>) -> Self {
        Self {
            results,
            cached_at: Instant::now(),
        }
    }

    pub fn is_expired(&self, ttl_secs: u64) -> bool {
        self.cached_at.elapsed().as_secs() >= ttl_secs
    }
}

// ── Download job tracking ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct DownloadJobStatus {
    pub job_id: String,
    pub dataset_ref: String,
    pub org_id: String,
    pub status: JobStatus,
    pub progress_bytes: u64,
    pub total_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Absolute path on disk once download is done
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Pending,
    Downloading,
    Done,
    Error,
}

impl DownloadJobStatus {
    pub fn new(job_id: String, dataset_ref: String, org_id: String) -> Self {
        Self {
            job_id,
            dataset_ref,
            org_id,
            status: JobStatus::Pending,
            progress_bytes: 0,
            total_bytes: None,
            error: None,
            local_path: None,
        }
    }
}
