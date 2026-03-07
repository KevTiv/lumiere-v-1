use anyhow::{Context, Result};

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub qdrant_url: String,
    pub qdrant_api_key: Option<String>,
    pub qdrant_collection: String,
    pub voyage_api_key: String,
    pub anthropic_api_key: String,
    pub embedding_model: String,
    pub embedding_dim: u32,
    // SpacetimeDB connection
    pub stdb_host: String,
    pub stdb_module: String,
    pub stdb_token: String,
    /// How often the queue worker polls for pending jobs (seconds)
    pub worker_poll_secs: u64,
    /// Max jobs to process per poll cycle
    pub worker_batch_size: u32,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Config {
            port: std::env::var("PORT")
                .unwrap_or_else(|_| "8080".to_string())
                .parse()
                .context("PORT must be a valid number")?,
            qdrant_url: std::env::var("QDRANT_URL")
                .unwrap_or_else(|_| "http://localhost:6333".to_string()),
            qdrant_api_key: std::env::var("QDRANT_API_KEY").ok(),
            qdrant_collection: std::env::var("QDRANT_COLLECTION")
                .unwrap_or_else(|_| "lumiere_embeddings".to_string()),
            voyage_api_key: std::env::var("VOYAGE_API_KEY")
                .context("VOYAGE_API_KEY is required")?,
            anthropic_api_key: std::env::var("ANTHROPIC_API_KEY")
                .context("ANTHROPIC_API_KEY is required")?,
            embedding_model: std::env::var("EMBEDDING_MODEL")
                .unwrap_or_else(|_| "voyage-3".to_string()),
            embedding_dim: std::env::var("EMBEDDING_DIM")
                .unwrap_or_else(|_| "1024".to_string())
                .parse()
                .context("EMBEDDING_DIM must be a valid number")?,
            stdb_host: std::env::var("STDB_HOST")
                .unwrap_or_else(|_| "http://localhost:3000".to_string()),
            stdb_module: std::env::var("STDB_MODULE")
                .context("STDB_MODULE is required (e.g. lumiere-v1)")?,
            stdb_token: std::env::var("STDB_TOKEN")
                .context("STDB_TOKEN is required")?,
            worker_poll_secs: std::env::var("WORKER_POLL_SECS")
                .unwrap_or_else(|_| "10".to_string())
                .parse()
                .context("WORKER_POLL_SECS must be a valid number")?,
            worker_batch_size: std::env::var("WORKER_BATCH_SIZE")
                .unwrap_or_else(|_| "20".to_string())
                .parse()
                .context("WORKER_BATCH_SIZE must be a valid number")?,
        })
    }
}
