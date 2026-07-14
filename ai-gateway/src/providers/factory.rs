use std::sync::Arc;

use anyhow::Result;

use crate::config::Config;

use super::{
    embed::{EmbedProvider, GeminiEmbed, MistralEmbed, OllamaEmbed},
    llm::LlmClient,
    parser::{DocumentParser, PlainTextParser, UnstructuredParser},
    vision::{MistralVision, OllamaVision, VisionProvider},
    web_search::{build_web_search, WebSearchProvider},
};

/// All active providers for embeddings, vision, parsing, and LLM chat.
#[derive(Clone)]
pub struct Providers {
    pub embedder: Arc<dyn EmbedProvider>,
    pub vision: Arc<dyn VisionProvider>,
    pub parser: Arc<dyn DocumentParser>,
    pub llm: Arc<LlmClient>,
    pub web_search: Arc<dyn WebSearchProvider>,
}

fn build_embedder(config: &Config) -> Result<Arc<dyn EmbedProvider>> {
    match config.embedding_provider.as_str() {
        "mistral" => {
            let key = config.mistral_api_key.as_deref().ok_or_else(|| {
                anyhow::anyhow!("MISTRAL_API_KEY required when EMBEDDING_PROVIDER=mistral")
            })?;
            Ok(Arc::new(MistralEmbed::new(key)))
        }
        "gemini" => {
            let key = config.google_api_key.as_deref().ok_or_else(|| {
                anyhow::anyhow!("GOOGLE_API_KEY required when EMBEDDING_PROVIDER=gemini")
            })?;
            Ok(Arc::new(GeminiEmbed::new(key, &config.gemini_embed_model)))
        }
        _ => Ok(Arc::new(OllamaEmbed::new(
            &config.ollama_url,
            &config.ollama_embed_model,
        ))),
    }
}

/// Build provider instances from config.
pub fn build(config: &Config, http: reqwest::Client) -> Result<Providers> {
    let embedder = build_embedder(config)?;

    let vision: Arc<dyn VisionProvider> = match config.vision_provider.as_str() {
        "mistral" => {
            let key = config.mistral_api_key.as_deref().ok_or_else(|| {
                anyhow::anyhow!("MISTRAL_API_KEY required when VISION_PROVIDER=mistral")
            })?;
            Arc::new(MistralVision::new(key))
        }
        _ => Arc::new(OllamaVision::new(
            &config.ollama_url,
            &config.ollama_vision_model,
        )),
    };

    let parser: Arc<dyn DocumentParser> = match config.document_parser.as_str() {
        "unstructured" => Arc::new(UnstructuredParser::new(
            &config.unstructured_url,
            config.unstructured_api_key.as_deref(),
        )),
        _ => Arc::new(PlainTextParser),
    };

    let llm = Arc::new(LlmClient::from_config(config)?);
    let web_search: Arc<dyn WebSearchProvider> = Arc::from(build_web_search(
        http.clone(),
        &config.web_search_provider,
        config.web_search_api_key.as_deref(),
    ));

    tracing::info!(
        embed = config.embedding_provider,
        embed_provider = embedder.name(),
        embed_model = config.embedding_model_name(),
        embed_dim = embedder.dimensions(),
        vision = config.vision_provider,
        vision_provider = vision.name(),
        parser = config.document_parser,
        parser_provider = parser.name(),
        kong_llm = config.kong_llm_url.is_some(),
        web_search = config.web_search_provider,
        web_search_provider = web_search.name(),
        "AI providers initialized"
    );

    Ok(Providers {
        embedder,
        vision,
        parser,
        llm,
        web_search,
    })
}
