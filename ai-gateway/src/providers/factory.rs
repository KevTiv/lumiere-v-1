use std::sync::Arc;

use anyhow::Result;

use crate::config::Config;

use super::{
    embed::{EmbedProvider, MistralEmbed, OllamaEmbed},
    parser::{DocumentParser, PlainTextParser, UnstructuredParser},
    vision::{MistralVision, OllamaVision, VisionProvider},
};

/// All active providers for the context/activity layer.
#[derive(Clone)]
pub struct Providers {
    pub embedder: Arc<dyn EmbedProvider>,
    pub vision: Arc<dyn VisionProvider>,
    pub parser: Arc<dyn DocumentParser>,
}

/// Build provider instances from config.
/// To add a new provider: implement the relevant trait and add an arm here.
pub fn build(config: &Config) -> Result<Providers> {
    let embedder: Arc<dyn EmbedProvider> = match config.context_embedding_provider.as_str() {
        "mistral" => {
            let key = config.mistral_api_key.as_deref().ok_or_else(|| {
                anyhow::anyhow!("MISTRAL_API_KEY required when CONTEXT_EMBEDDING_PROVIDER=mistral")
            })?;
            Arc::new(MistralEmbed::new(key))
        }
        _ => Arc::new(OllamaEmbed::new(
            &config.ollama_url,
            &config.ollama_embed_model,
        )),
    };

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

    tracing::info!(
        embed = config.context_embedding_provider,
        embed_provider = embedder.name(),
        vision = config.vision_provider,
        vision_provider = vision.name(),
        parser = config.document_parser,
        parser_provider = parser.name(),
        supported_mime_types = ?parser.supported_mime_types(),
        "Context providers initialized"
    );

    Ok(Providers {
        embedder,
        vision,
        parser,
    })
}
