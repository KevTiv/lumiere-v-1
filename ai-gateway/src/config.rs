use anyhow::{Context, Result};
use stdb_config::{env_stdb_host_or_next_public, normalize_stdb_http_host, runtime_is_production};

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    /// Shared secret required on non-health HTTP routes (`X-Lumiere-Gateway-Secret`).
    pub internal_secret: Option<String>,
    pub qdrant_url: String,
    pub qdrant_api_key: Option<String>,
    pub qdrant_collection: String,
    // SpacetimeDB connection
    pub stdb_host: String,
    pub stdb_module: String,
    pub stdb_token: String,
    /// Dedicated executor identity for server-owned AI certification runs.
    ///
    /// When absent, the certification worker is disabled. This token must not
    /// be shared with the HTTP gateway or browser-facing sessions.
    pub ai_certification_stdb_token: Option<String>,
    /// SHA-256 fingerprint of the certification executor build/profile.
    pub ai_certification_runtime_hash: Option<String>,
    /// How often the certification worker polls for queued requests (seconds).
    pub ai_certification_poll_secs: u64,
    /// Maximum certification requests claimed per poll cycle.
    pub ai_certification_batch_size: u32,
    /// Hard deadline for one candidate adapter execution (seconds).
    pub ai_certification_timeout_secs: u64,
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

    // ── Embeddings (unified Qdrant pipeline) ─────────────────────────────────
    /// Embedding provider: "ollama" (default) | "mistral" | "gemini"
    pub embedding_provider: String,
    pub ollama_url: String,
    pub ollama_embed_model: String,
    pub ollama_vision_model: String,
    pub ollama_llm_model: String,
    pub mistral_api_key: Option<String>,
    pub google_api_key: Option<String>,
    pub gemini_embed_model: String,

    // ── LLM (Kong internal route or direct provider HTTP) ────────────────────
    /// When set, chat completions go through Kong AI Gateway (OpenAI-compatible).
    pub kong_llm_url: Option<String>,
    pub kong_llm_service_token: Option<String>,

    // ── Context layer (vision / parser) ──────────────────────────────────────
    pub vision_provider: String,
    pub document_parser: String,
    pub unstructured_url: String,
    pub unstructured_api_key: Option<String>,
    pub activities_collection: String,
    pub activity_ingest_interval_secs: u64,
    pub max_upload_bytes: usize,

    /// Web search provider: `tavily` (default) | `disabled`
    pub web_search_provider: String,
    pub web_search_api_key: Option<String>,
    pub web_fetch_max_bytes: usize,

    /// Rust api-server base URL for typed owner-report previews and other
    /// protected domain services. Optional — report-composer returns 503 when unset.
    pub api_server_url: Option<String>,
}

impl Config {
    pub fn embedding_model_name(&self) -> String {
        match self.embedding_provider.as_str() {
            "mistral" => "mistral-embed".to_string(),
            "gemini" => self.gemini_embed_model.clone(),
            _ => self.ollama_embed_model.clone(),
        }
    }

    pub fn from_env() -> Result<Self> {
        let google_api_key = std::env::var("GOOGLE_API_KEY")
            .ok()
            .or_else(|| std::env::var("GEMINI_API_KEY").ok())
            .filter(|v| !v.trim().is_empty());
        let stdb_token = std::env::var("STDB_TOKEN").context("STDB_TOKEN is required")?;
        let (ai_certification_stdb_token, ai_certification_runtime_hash) =
            validate_certification_identity(
                std::env::var("AI_CERTIFICATION_STDB_TOKEN").ok(),
                std::env::var("AI_CERTIFICATION_RUNTIME_HASH").ok(),
            )?;
        ensure_dedicated_certification_token(&stdb_token, ai_certification_stdb_token.as_deref())?;
        if runtime_is_production() && ai_certification_stdb_token.is_none() {
            anyhow::bail!(
                "AI_CERTIFICATION_STDB_TOKEN and AI_CERTIFICATION_RUNTIME_HASH are required in production"
            );
        }

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
                .unwrap_or_else(|_| "lumiere_embeddings_org_v2".to_string()),
            stdb_host: normalize_stdb_http_host(
                &env_stdb_host_or_next_public()
                    .unwrap_or_else(|| "http://127.0.0.1:3000".to_string()),
            ),
            stdb_module: std::env::var("STDB_MODULE")
                .context("STDB_MODULE is required (e.g. lumiere-v1)")?,
            stdb_token,
            ai_certification_stdb_token,
            ai_certification_runtime_hash,
            ai_certification_poll_secs: std::env::var("AI_CERTIFICATION_POLL_SECS")
                .unwrap_or_else(|_| "5".to_string())
                .parse()
                .context("AI_CERTIFICATION_POLL_SECS must be a valid number")?,
            ai_certification_batch_size: std::env::var("AI_CERTIFICATION_BATCH_SIZE")
                .unwrap_or_else(|_| "10".to_string())
                .parse()
                .context("AI_CERTIFICATION_BATCH_SIZE must be a valid number")?,
            ai_certification_timeout_secs: parse_certification_timeout(
                std::env::var("AI_CERTIFICATION_TIMEOUT_SECS").ok(),
            )?,
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

            embedding_provider: std::env::var("EMBEDDING_PROVIDER")
                .ok()
                .or_else(|| std::env::var("CONTEXT_EMBEDDING_PROVIDER").ok())
                .unwrap_or_else(|| "ollama".to_string()),
            ollama_url: std::env::var("OLLAMA_URL")
                .unwrap_or_else(|_| "http://localhost:11434".to_string()),
            ollama_embed_model: std::env::var("OLLAMA_EMBED_MODEL")
                .unwrap_or_else(|_| "nomic-embed-text".to_string()),
            ollama_vision_model: std::env::var("OLLAMA_VISION_MODEL")
                .unwrap_or_else(|_| "llava".to_string()),
            ollama_llm_model: std::env::var("OLLAMA_LLM_MODEL")
                .unwrap_or_else(|_| "llama3.2".to_string()),
            mistral_api_key: std::env::var("MISTRAL_API_KEY").ok(),
            google_api_key,
            gemini_embed_model: std::env::var("GEMINI_EMBED_MODEL")
                .unwrap_or_else(|_| "text-embedding-004".to_string()),

            kong_llm_url: std::env::var("KONG_LLM_URL")
                .ok()
                .filter(|v| !v.trim().is_empty()),
            kong_llm_service_token: std::env::var("KONG_LLM_SERVICE_TOKEN").ok(),

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
                .unwrap_or_else(|_| "20971520".to_string())
                .parse()
                .context("MAX_UPLOAD_BYTES must be a valid number")?,

            web_search_provider: std::env::var("WEB_SEARCH_PROVIDER")
                .unwrap_or_else(|_| "tavily".to_string()),
            web_search_api_key: std::env::var("WEB_SEARCH_API_KEY")
                .ok()
                .filter(|v| !v.trim().is_empty()),
            web_fetch_max_bytes: std::env::var("WEB_FETCH_MAX_BYTES")
                .unwrap_or_else(|_| "262144".to_string())
                .parse()
                .context("WEB_FETCH_MAX_BYTES must be a valid number")?,

            api_server_url: std::env::var("LUMIERE_API_SERVER_URL")
                .ok()
                .filter(|v| !v.trim().is_empty()),
        })
    }
}

fn validate_certification_identity(
    token: Option<String>,
    runtime_hash: Option<String>,
) -> Result<(Option<String>, Option<String>)> {
    let token = token.filter(|value| !value.trim().is_empty());
    let runtime_hash = runtime_hash.filter(|value| !value.trim().is_empty());

    match (token, runtime_hash) {
        (None, None) => Ok((None, None)),
        (Some(_), None) => anyhow::bail!(
            "AI_CERTIFICATION_RUNTIME_HASH is required when AI_CERTIFICATION_STDB_TOKEN is set"
        ),
        (None, Some(_)) => anyhow::bail!(
            "AI_CERTIFICATION_STDB_TOKEN is required when AI_CERTIFICATION_RUNTIME_HASH is set"
        ),
        (Some(token), Some(runtime_hash)) if valid_sha256(&runtime_hash) => {
            Ok((Some(token), Some(runtime_hash)))
        }
        (Some(_), Some(_)) => anyhow::bail!(
            "AI_CERTIFICATION_RUNTIME_HASH must be sha256: followed by 64 lowercase hex characters"
        ),
    }
}

fn valid_sha256(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|digest| {
        digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn ensure_dedicated_certification_token(
    stdb_token: &str,
    certification_token: Option<&str>,
) -> Result<()> {
    if certification_token == Some(stdb_token) {
        anyhow::bail!(
            "AI_CERTIFICATION_STDB_TOKEN must use a dedicated identity distinct from STDB_TOKEN"
        );
    }
    Ok(())
}

fn parse_certification_timeout(value: Option<String>) -> Result<u64> {
    const DEFAULT_SECS: u64 = 30;
    const MIN_SECS: u64 = 1;
    const MAX_SECS: u64 = 300;

    let seconds = value
        .unwrap_or_else(|| DEFAULT_SECS.to_string())
        .parse::<u64>()
        .context("AI_CERTIFICATION_TIMEOUT_SECS must be a valid number")?;
    if !(MIN_SECS..=MAX_SECS).contains(&seconds) {
        anyhow::bail!("AI_CERTIFICATION_TIMEOUT_SECS must be between {MIN_SECS} and {MAX_SECS}");
    }
    Ok(seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn certification_identity_must_be_configured_as_a_pair() {
        assert!(validate_certification_identity(None, None).is_ok());
        assert!(validate_certification_identity(Some("token".to_string()), None).is_err());
        assert!(
            validate_certification_identity(None, Some(format!("sha256:{}", "a".repeat(64))))
                .is_err()
        );
    }

    #[test]
    fn certification_runtime_hash_is_strict_sha256() {
        let valid = format!("sha256:{}", "a".repeat(64));
        assert!(validate_certification_identity(Some("token".to_string()), Some(valid)).is_ok());
        assert!(validate_certification_identity(
            Some("token".to_string()),
            Some(format!("sha256:{}", "A".repeat(64)))
        )
        .is_err());
        assert!(
            validate_certification_identity(Some("token".to_string()), Some("a".repeat(64)))
                .is_err()
        );
    }

    #[test]
    fn certification_token_must_not_reuse_the_gateway_identity() {
        assert!(ensure_dedicated_certification_token("gateway", Some("certifier")).is_ok());
        assert!(ensure_dedicated_certification_token("gateway", None).is_ok());
        assert!(ensure_dedicated_certification_token("gateway", Some("gateway")).is_err());
    }

    #[test]
    fn certification_timeout_has_a_safe_bounded_range() {
        assert_eq!(
            parse_certification_timeout(None).expect("default timeout should be valid"),
            30
        );
        assert_eq!(
            parse_certification_timeout(Some("1".to_string()))
                .expect("minimum timeout should be valid"),
            1
        );
        assert_eq!(
            parse_certification_timeout(Some("300".to_string()))
                .expect("maximum timeout should be valid"),
            300
        );
        assert!(parse_certification_timeout(Some("0".to_string())).is_err());
        assert!(parse_certification_timeout(Some("301".to_string())).is_err());
        assert!(parse_certification_timeout(Some("forever".to_string())).is_err());
    }
}
