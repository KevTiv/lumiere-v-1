use std::sync::Arc;

use crate::{
    config::Config, embeddings::EmbeddingClient, qdrant_client::VectorStore,
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
}
