use anyhow::Result;
use async_trait::async_trait;
use serde::Deserialize;

/// A single chunk of text extracted from a document.
#[derive(Debug, Clone)]
pub struct DocumentChunk {
    pub text: String,
    pub page: Option<u32>,
    pub chunk_index: u32,
}

/// Common interface for all document text parsers (non-image documents).
/// Implement this trait to add a new parser backend (Tika, Docling, Marker, etc.).
#[async_trait]
pub trait DocumentParser: Send + Sync {
    /// Parse `content` bytes of the given MIME type into text chunks.
    async fn parse(&self, content: &[u8], mime_type: &str) -> Result<Vec<DocumentChunk>>;
    fn supported_mime_types(&self) -> &[&str];
    fn name(&self) -> &'static str;
}

// ── Plain Text ────────────────────────────────────────────────────────────────
// Splits by double-newline paragraphs. Works for text/plain and simple text blobs.

pub struct PlainTextParser;

#[async_trait]
impl DocumentParser for PlainTextParser {
    async fn parse(&self, content: &[u8], _mime_type: &str) -> Result<Vec<DocumentChunk>> {
        let text = String::from_utf8_lossy(content);
        let chunks: Vec<DocumentChunk> = text
            .split("\n\n")
            .filter(|s| !s.trim().is_empty())
            .enumerate()
            .map(|(i, s)| DocumentChunk {
                text: s.trim().to_string(),
                page: None,
                chunk_index: i as u32,
            })
            .collect();
        Ok(chunks)
    }

    fn supported_mime_types(&self) -> &[&str] {
        &["text/plain", "text/markdown", "text/csv"]
    }

    fn name(&self) -> &'static str {
        "plaintext"
    }
}

// ── Unstructured.io ───────────────────────────────────────────────────────────
// Supports PDF, DOCX, PPTX, HTML, and more via local Docker or hosted API.
// Run locally: docker run -p 8000:8000 downloads.unstructured.io/unstructured-io/unstructured-api:latest

pub struct UnstructuredParser {
    client: reqwest::Client,
    endpoint: String,
    api_key: Option<String>,
}

#[derive(Deserialize)]
struct UnstructuredElement {
    text: String,
    metadata: Option<UnstructuredMetadata>,
}

#[derive(Deserialize)]
struct UnstructuredMetadata {
    page_number: Option<u32>,
}

impl UnstructuredParser {
    pub fn new(endpoint: &str, api_key: Option<&str>) -> Self {
        UnstructuredParser {
            client: reqwest::Client::new(),
            endpoint: endpoint.trim_end_matches('/').to_string(),
            api_key: api_key.map(str::to_string),
        }
    }
}

#[async_trait]
impl DocumentParser for UnstructuredParser {
    async fn parse(&self, content: &[u8], mime_type: &str) -> Result<Vec<DocumentChunk>> {
        use reqwest::multipart;

        let file_part = multipart::Part::bytes(content.to_vec())
            .file_name("document")
            .mime_str(mime_type)?;

        let form = multipart::Form::new()
            .part("files", file_part)
            .text("strategy", "hi_res");

        let mut req = self
            .client
            .post(format!("{}/general/v0/general", self.endpoint))
            .multipart(form);

        if let Some(key) = &self.api_key {
            req = req.header("unstructured-api-key", key);
        }

        let elements: Vec<UnstructuredElement> =
            req.send().await?.error_for_status()?.json().await?;

        let chunks = elements
            .into_iter()
            .filter(|e| !e.text.trim().is_empty())
            .enumerate()
            .map(|(i, e)| DocumentChunk {
                text: e.text,
                page: e.metadata.and_then(|m| m.page_number),
                chunk_index: i as u32,
            })
            .collect();

        Ok(chunks)
    }

    fn supported_mime_types(&self) -> &[&str] {
        &[
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "text/html",
            "text/plain",
            "text/markdown",
        ]
    }

    fn name(&self) -> &'static str {
        "unstructured"
    }
}
