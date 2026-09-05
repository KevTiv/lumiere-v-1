pub mod embed;
pub mod factory;
pub mod llm;
pub mod parser;
pub mod vision;
pub mod web_search;

pub use embed::EmbedProvider;
pub use factory::{build, Providers};

use anyhow::{anyhow, Context, Result};
use std::time::Duration;

use crate::config::Config;

/// Validate configured provider dependencies and run only safe metadata probes.
/// Provider APIs without a documented non-generative probe are configuration-
/// checked instead of receiving billable embedding, vision, search, or LLM calls.
pub async fn check_readiness(config: &Config, http: &reqwest::Client) -> Result<()> {
    validate_configuration(config)?;

    let embedding_uses_ollama = !matches!(config.embedding_provider.as_str(), "mistral" | "gemini");
    let vision_uses_ollama = config.vision_provider != "mistral";
    if embedding_uses_ollama || vision_uses_ollama {
        // Ollama model aliases and tag response shapes vary by release; the
        // readiness contract deliberately checks service reachability only.
        probe_metadata(http, &config.ollama_url, "/api/tags", "Ollama", None).await?;
    }
    if let Some(kong_url) = config.kong_llm_readiness_url.as_deref() {
        probe_metadata(
            http,
            kong_url,
            "",
            "Kong",
            config.kong_llm_service_token.as_deref(),
        )
        .await?;
    }
    Ok(())
}

fn validate_configuration(config: &Config) -> Result<()> {
    match config.embedding_provider.as_str() {
        "mistral" if missing(config.mistral_api_key.as_deref()) => {
            return Err(anyhow!("embedding provider credentials are unavailable"));
        }
        "gemini" if missing(config.google_api_key.as_deref()) => {
            return Err(anyhow!("embedding provider credentials are unavailable"));
        }
        _ => {}
    }

    if config.vision_provider == "mistral" && missing(config.mistral_api_key.as_deref()) {
        return Err(anyhow!("vision provider credentials are unavailable"));
    }
    if config.document_parser == "unstructured" && config.unstructured_url.trim().is_empty() {
        return Err(anyhow!("document parser endpoint is unavailable"));
    }
    let embedding_uses_ollama = !matches!(config.embedding_provider.as_str(), "mistral" | "gemini");
    let vision_uses_ollama = config.vision_provider != "mistral";
    if embedding_uses_ollama || vision_uses_ollama {
        validate_http_url(&config.ollama_url, "Ollama")?;
    }
    if config.document_parser == "unstructured" {
        validate_http_url(&config.unstructured_url, "document parser")?;
    }
    if let Some(url) = config.kong_llm_url.as_deref() {
        validate_http_url(url, "LLM gateway")?;
    }
    if let Some(url) = config.kong_llm_readiness_url.as_deref() {
        validate_http_url(url, "LLM gateway readiness")?;
    }
    Ok(())
}

fn missing(value: Option<&str>) -> bool {
    value.map_or(true, |value| value.trim().is_empty())
}

async fn probe_metadata(
    http: &reqwest::Client,
    base_url: &str,
    path: &str,
    provider: &str,
    bearer_token: Option<&str>,
) -> Result<()> {
    metadata_request(http, base_url, path, bearer_token)?
        .timeout(Duration::from_secs(2))
        .send()
        .await
        .with_context(|| format!("{provider} metadata probe failed"))?
        .error_for_status()
        .with_context(|| format!("{provider} metadata probe failed"))?;
    Ok(())
}

fn validate_http_url(value: &str, provider: &str) -> Result<()> {
    let parsed = reqwest::Url::parse(value.trim())
        .map_err(|_| anyhow!("{provider} endpoint is unavailable"))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host().is_none() {
        return Err(anyhow!("{provider} endpoint is unavailable"));
    }
    Ok(())
}

fn metadata_request(
    http: &reqwest::Client,
    base_url: &str,
    path: &str,
    bearer_token: Option<&str>,
) -> Result<reqwest::RequestBuilder> {
    validate_http_url(base_url, "provider")?;
    let url = if path.is_empty() {
        base_url.trim().to_string()
    } else {
        format!("{}{path}", base_url.trim_end_matches('/'))
    };
    let request = http.get(url);
    Ok(match bearer_token {
        Some(token) => request.bearer_auth(token),
        None => request,
    })
}

#[cfg(test)]
mod readiness_tests {
    use super::*;

    #[test]
    fn selected_cloud_providers_require_credentials() {
        let mut config = test_config();
        config.embedding_provider = "mistral".into();
        assert!(validate_configuration(&config).is_err());

        config.mistral_api_key = Some("configured".into());
        assert!(validate_configuration(&config).is_ok());
    }

    #[test]
    fn unstructured_requires_an_endpoint_but_plaintext_does_not() {
        let mut config = test_config();
        config.document_parser = "unstructured".into();
        config.unstructured_url.clear();
        assert!(validate_configuration(&config).is_err());

        config.document_parser = "plaintext".into();
        assert!(validate_configuration(&config).is_ok());
    }

    #[test]
    fn metadata_request_applies_kong_auth_without_exposing_it_in_url() {
        let client = reqwest::Client::new();
        let request = metadata_request(
            &client,
            "https://kong.example.test/readyz/?scope=llm",
            "",
            Some("secret-token"),
        )
        .expect("valid metadata request")
        .build()
        .expect("request builds");
        assert_eq!(
            request.url().as_str(),
            "https://kong.example.test/readyz/?scope=llm"
        );
        assert_eq!(
            request
                .headers()
                .get(reqwest::header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
            Some("Bearer secret-token")
        );
        assert!(!request.url().as_str().contains("secret-token"));
    }

    #[test]
    fn metadata_request_rejects_non_http_urls() {
        let client = reqwest::Client::new();
        assert!(metadata_request(&client, "ollama", "/api/tags", None).is_err());
        assert!(metadata_request(&client, "file:///tmp/provider", "/health", None).is_err());
    }

    fn test_config() -> Config {
        Config {
            port: 8080,
            internal_secret: None,
            qdrant_url: "http://qdrant".into(),
            qdrant_api_key: None,
            qdrant_collection: "collection".into(),
            stdb_host: "http://stdb".into(),
            stdb_module: "module".into(),
            stdb_token: "token".into(),
            ai_certification_stdb_token: None,
            ai_certification_runtime_hash: None,
            ai_certification_poll_secs: 5,
            ai_certification_batch_size: 10,
            ai_certification_timeout_secs: 30,
            worker_poll_secs: 10,
            worker_batch_size: 20,
            kaggle_username: None,
            kaggle_api_key: None,
            dataset_cache_dir: "/tmp".into(),
            kaggle_cache_ttl_secs: 3600,
            embedding_provider: "ollama".into(),
            ollama_url: "http://ollama".into(),
            ollama_embed_model: "embed".into(),
            ollama_vision_model: "vision".into(),
            ollama_llm_model: "llm".into(),
            mistral_api_key: None,
            google_api_key: None,
            gemini_embed_model: "gemini".into(),
            kong_llm_url: None,
            kong_llm_service_token: None,
            kong_llm_readiness_url: None,
            vision_provider: "ollama".into(),
            document_parser: "plaintext".into(),
            unstructured_url: "http://parser".into(),
            unstructured_api_key: None,
            activity_refs_collection: "activity".into(),
            activity_ingest_interval_secs: 30,
            max_upload_bytes: 1024,
            web_search_provider: "disabled".into(),
            web_search_api_key: None,
            web_fetch_max_bytes: 1024,
            api_server_url: None,
        }
    }
}
