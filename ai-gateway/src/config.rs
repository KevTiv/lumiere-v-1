use anyhow::{Context, Result};
use stdb_config::{env_stdb_host_or_next_public, normalize_stdb_http_host};

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    /// Shared secret required on non-health HTTP routes (`X-Lumiere-Gateway-Secret`).
    pub internal_secret: Option<String>,
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
    // Kaggle integration (optional — routes return 503 if not set)
    pub kaggle_username: Option<String>,
    pub kaggle_api_key: Option<String>,
    /// Local directory for cached dataset files
    pub dataset_cache_dir: String,
    /// Kaggle search cache TTL in seconds
    pub kaggle_cache_ttl_secs: u64,

    // ── Context / Activity Layer (Rig-rs) ────────────────────────────────────
    /// Embedding provider for context layer: "ollama" (default) | "mistral"
    pub context_embedding_provider: String,
    /// Ollama base URL
    pub ollama_url: String,
    /// Ollama embedding model (default: nomic-embed-text)
    pub ollama_embed_model: String,
    /// Ollama chat/completion model (default: mistral)
    pub ollama_chat_model: String,
    /// Ollama vision model for image OCR (default: llava)
    pub ollama_vision_model: String,
    /// Mistral API key (required if context_embedding_provider = "mistral" or vision_provider = "mistral")
    pub mistral_api_key: Option<String>,
    /// Vision provider: "ollama" (default) | "mistral"
    pub vision_provider: String,
    /// Document text parser: "plaintext" (default) | "unstructured"
    pub document_parser: String,
    /// Unstructured.io endpoint (local Docker or hosted)
    pub unstructured_url: String,
    /// Unstructured.io hosted API key (optional)
    pub unstructured_api_key: Option<String>,
    /// Qdrant collection for ERP activities (separate from embeddings collection)
    pub activities_collection: String,
    /// How often the activity ingester polls SpacetimeDB tables (seconds)
    pub activity_ingest_interval_secs: u64,
    /// Max multipart upload size in bytes (default: 20 MB)
    pub max_upload_bytes: usize,

    // ── Scaleway S3 stub (Phase 2) ────────────────────────────────────────────
    pub scaleway_bucket: Option<String>,
    pub scaleway_region: Option<String>,
    /// S3-compatible endpoint URL (e.g. https://s3.nl-ams.scw.cloud)
    pub scaleway_endpoint: Option<String>,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Config {
            port: std::env::var("PORT")
                .unwrap_or_else(|_| "8080".to_string())
                .parse()
                .context("PORT must be a valid number")?,
            internal_secret: std::env::var("LUMIERE_AI_GATEWAY_INTERNAL_SECRET")
                .ok()
                .filter(|value| !value.trim().is_empty()),
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
            stdb_host: normalize_stdb_http_host(
                &env_stdb_host_or_next_public()
                    .unwrap_or_else(|| "http://127.0.0.1:3000".to_string()),
            ),
            stdb_module: std::env::var("STDB_MODULE")
                .context("STDB_MODULE is required (e.g. lumiere-v1)")?,
            stdb_token: std::env::var("STDB_TOKEN").context("STDB_TOKEN is required")?,
            worker_poll_secs: std::env::var("WORKER_POLL_SECS")
                .unwrap_or_else(|_| "10".to_string())
                .parse()
                .context("WORKER_POLL_SECS must be a valid number")?,
            worker_batch_size: std::env::var("WORKER_BATCH_SIZE")
                .unwrap_or_else(|_| "20".to_string())
                .parse()
                .context("WORKER_BATCH_SIZE must be a valid number")?,
            kaggle_username: std::env::var("KAGGLE_USERNAME").ok(),
            kaggle_api_key: std::env::var("KAGGLE_KEY").ok(),
            dataset_cache_dir: std::env::var("DATASET_CACHE_DIR")
                .unwrap_or_else(|_| "/tmp/lumiere_datasets".to_string()),
            kaggle_cache_ttl_secs: std::env::var("KAGGLE_CACHE_TTL_SECS")
                .unwrap_or_else(|_| "3600".to_string())
                .parse()
                .context("KAGGLE_CACHE_TTL_SECS must be a valid number")?,

            // Context / Activity Layer
            context_embedding_provider: std::env::var("CONTEXT_EMBEDDING_PROVIDER")
                .unwrap_or_else(|_| "ollama".to_string()),
            ollama_url: std::env::var("OLLAMA_URL")
                .unwrap_or_else(|_| "http://localhost:11434".to_string()),
            ollama_embed_model: std::env::var("OLLAMA_EMBED_MODEL")
                .unwrap_or_else(|_| "nomic-embed-text".to_string()),
            ollama_chat_model: std::env::var("OLLAMA_CHAT_MODEL")
                .unwrap_or_else(|_| "mistral".to_string()),
            ollama_vision_model: std::env::var("OLLAMA_VISION_MODEL")
                .unwrap_or_else(|_| "llava".to_string()),
            mistral_api_key: std::env::var("MISTRAL_API_KEY").ok(),
            vision_provider: std::env::var("VISION_PROVIDER")
                .unwrap_or_else(|_| "ollama".to_string()),
            document_parser: std::env::var("DOCUMENT_PARSER")
                .unwrap_or_else(|_| "plaintext".to_string()),
            unstructured_url: std::env::var("UNSTRUCTURED_URL")
                .unwrap_or_else(|_| "http://localhost:8000".to_string()),
            unstructured_api_key: std::env::var("UNSTRUCTURED_API_KEY").ok(),
            activities_collection: std::env::var("QDRANT_ACTIVITIES_COLLECTION")
                .unwrap_or_else(|_| "lumiere_erp_activities".to_string()),
            activity_ingest_interval_secs: std::env::var("ACTIVITY_INGEST_INTERVAL_SECS")
                .unwrap_or_else(|_| "30".to_string())
                .parse()
                .context("ACTIVITY_INGEST_INTERVAL_SECS must be a valid number")?,
            max_upload_bytes: std::env::var("MAX_UPLOAD_BYTES")
                .unwrap_or_else(|_| "20971520".to_string()) // 20 MB
                .parse()
                .context("MAX_UPLOAD_BYTES must be a valid number")?,

            // Scaleway S3 stub
            scaleway_bucket: std::env::var("SCALEWAY_BUCKET").ok(),
            scaleway_region: std::env::var("SCALEWAY_REGION").ok(),
            scaleway_endpoint: std::env::var("SCALEWAY_ENDPOINT").ok(),
        })
    }
}
