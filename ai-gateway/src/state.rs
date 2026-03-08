use std::sync::Arc;

use dashmap::DashMap;

use crate::{
    config::Config,
    embeddings::EmbeddingClient,
    kaggle::{DownloadJobStatus, KaggleCacheEntry},
    qdrant_client::VectorStore,
    stdb_client::StdbClient,
};

/// Shared application state injected into every Axum handler via Extension.
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub embedder: Arc<EmbeddingClient>,
    pub vector_store: Arc<VectorStore>,
    pub stdb: Arc<StdbClient>,
    pub http: Arc<reqwest::Client>,
    /// In-flight and completed Kaggle download jobs (job_id → status).
    pub download_jobs: Arc<DashMap<String, DownloadJobStatus>>,
    /// Short-lived Kaggle search result cache (cache_key → entry).
    pub kaggle_search_cache: Arc<DashMap<String, KaggleCacheEntry>>,
}
