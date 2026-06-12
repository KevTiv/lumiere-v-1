use std::sync::Arc;

use dashmap::DashMap;

use crate::{
    config::Config,
    kaggle::{DownloadJobStatus, KaggleCacheEntry},
    providers::Providers,
    qdrant_client::VectorStore,
    rig_agent::RigContext,
};
use stdb_client::StdbClient;

/// Shared application state injected into every Axum handler via Extension.
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub providers: Providers,
    pub vector_store: Arc<VectorStore>,
    pub rig: Arc<RigContext>,
    pub stdb: Arc<StdbClient>,
    pub http: Arc<reqwest::Client>,
    /// In-memory activity ingestion watermarks keyed by `org_id:table_name`.
    pub activity_watermarks: Arc<DashMap<String, i64>>,
    /// In-flight and completed Kaggle download jobs (job_id → status).
    pub download_jobs: Arc<DashMap<String, DownloadJobStatus>>,
    /// Short-lived Kaggle search result cache (cache_key → entry).
    pub kaggle_search_cache: Arc<DashMap<String, KaggleCacheEntry>>,
}
