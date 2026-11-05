use anyhow::Result;
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Structured result of image/document analysis.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ExtractedDocument {
    /// Raw text extracted from the document.
    pub raw_text: String,
    /// Detected document category: "invoice", "receipt", "delivery_note", "unknown".
    pub doc_type: String,
    /// Structured fields parsed from the document (varies by doc_type).
    /// invoice: vendor, invoice_number, date, line_items, subtotal, tax, total
    /// receipt: merchant, date, items, total
    /// delivery_note: shipper, reference, items, quantities
    pub fields: serde_json::Value,
    /// Measured confidence, when the provider supplies it.
    pub confidence: Option<f32>,
}

/// Common interface for all vision / OCR providers.
/// Implement this trait to add a new image understanding backend.
#[async_trait]
pub trait VisionProvider: Send + Sync {
    /// Extract text and structured fields from `image_bytes`.
    /// `hint` is the expected document type ("invoice", "receipt", "delivery_note", "general").
    async fn extract(
        &self,
        image_bytes: &[u8],
        mime_type: &str,
        hint: &str,
    ) -> Result<ExtractedDocument>;

    /// OCR result with truthful provider page usage. Unsupported providers fail closed.
    async fn extract_metered(
        &self,
        _document_bytes: &[u8],
        _mime_type: &str,
        _hint: &str,
        _page_allowance: u32,
    ) -> Result<MeteredDocument> {
        anyhow::bail!("provider does not support metered OCR")
    }

    fn name(&self) -> &'static str;

    fn model(&self) -> &str {
        self.name()
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn build_extraction_prompt(hint: &str) -> String {
    match hint {
        "invoice" => {
            "You are an OCR assistant. Extract all text from this invoice image and return a JSON \
            object with these fields: raw_text (full text), vendor (company name), \
            invoice_number, date (ISO 8601), line_items (array of {description, qty, unit_price, total}), \
            subtotal, tax, total, currency. Return ONLY valid JSON, no markdown."
        }
        "receipt" => {
            "You are an OCR assistant. Extract all text from this receipt and return a JSON object \
            with: raw_text, merchant, date (ISO 8601), items (array of {name, qty, price}), \
            subtotal, tax, total, currency. Return ONLY valid JSON, no markdown."
        }
        "delivery_note" => {
            "You are an OCR assistant. Extract all text from this delivery note and return a JSON \
            object with: raw_text, shipper, recipient, reference, date (ISO 8601), \
            items (array of {description, quantity, unit}). Return ONLY valid JSON, no markdown."
        }
        _ => {
            "You are an OCR assistant. Extract all readable text from this document image. \
            Return a JSON object with: raw_text (full extracted text), doc_type (your best guess \
            of document type), fields (any structured data you can identify). \
            Return ONLY valid JSON, no markdown."
        }
    }
    .to_string()
}

fn parse_extracted(raw_response: &str, hint: &str) -> ExtractedDocument {
    // Attempt to parse JSON from the model response.
    // Some models wrap JSON in markdown fences — strip them.
    let cleaned = raw_response
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    match serde_json::from_str::<serde_json::Value>(cleaned) {
        Ok(v) => {
            let raw_text = v
                .get("raw_text")
                .and_then(|t| t.as_str())
                .unwrap_or(cleaned)
                .to_string();
            ExtractedDocument {
                raw_text,
                doc_type: hint.to_string(),
                fields: v,
                confidence: None,
            }
        }
        Err(_) => {
            // Fallback: treat the whole response as raw text
            ExtractedDocument {
                raw_text: raw_response.to_string(),
                doc_type: hint.to_string(),
                fields: serde_json::json!({ "raw_text": raw_response }),
                confidence: None,
            }
        }
    }
}

// ── Ollama (llava) ────────────────────────────────────────────────────────────

pub struct OllamaVision {
    client: reqwest::Client,
    base_url: String,
    model: String,
}

#[derive(Deserialize)]
struct OllamaGenerateResponse {
    response: String,
}

impl OllamaVision {
    pub fn new(base_url: &str, model: &str) -> Self {
        OllamaVision {
            client: reqwest::Client::new(),
            base_url: base_url.trim_end_matches('/').to_string(),
            model: model.to_string(),
        }
    }
}

#[async_trait]
impl VisionProvider for OllamaVision {
    async fn extract(
        &self,
        image_bytes: &[u8],
        _mime_type: &str,
        hint: &str,
    ) -> Result<ExtractedDocument> {
        let image_b64 = BASE64.encode(image_bytes);
        let prompt = build_extraction_prompt(hint);

        let body = serde_json::json!({
            "model": self.model,
            "prompt": prompt,
            "images": [image_b64],
            "stream": false,
        });

        let url = format!("{}/api/generate", self.base_url);
        let resp: OllamaGenerateResponse = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        Ok(parse_extracted(&resp.response, hint))
    }

    fn name(&self) -> &'static str {
        "ollama-llava"
    }
}

// ── Mistral Vision (OCR API) ──────────────────────────────────────────────────

/// OCR output and the provider's actual billed page quantity.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MeteredDocument {
    /// Content validity is independent of truthful billed usage.
    pub content_complete: bool,
    pub document: ExtractedDocument,
    pub pages_processed: u32,
    pub model: String,
}

pub struct MistralVision {
    client: reqwest::Client,
    api_key: String,
    model: String,
}

#[derive(Deserialize)]
struct MistralOcrResponse {
    model: String,
    pages: Vec<MistralOcrPage>,
    usage_info: MistralOcrUsage,
}

#[derive(Deserialize)]
struct MistralOcrPage {
    index: u32,
    markdown: String,
}

#[derive(Deserialize)]
struct MistralOcrUsage {
    pages_processed: u32,
}

const MAX_OCR_BYTES: usize = 10 * 1024 * 1024;
const MAX_OCR_RESPONSE_BYTES: usize = 256 * 1024;
const MAX_OCR_PAGES: u32 = 200;

impl MistralVision {
    /// Construct only from an explicitly reviewed, immutable provider model ID.
    pub fn with_model(api_key: &str, model: &str) -> Result<Self> {
        validate_ocr_model(model)?;
        if api_key.trim().is_empty() {
            anyhow::bail!("Mistral OCR credentials are unavailable");
        }
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60))
            .build()?;
        Ok(Self {
            client,
            api_key: api_key.to_owned(),
            model: model.to_owned(),
        })
    }
}

fn validate_ocr_model(model: &str) -> Result<()> {
    if !model.starts_with("mistral-ocr-")
        || model.ends_with("latest")
        || !model
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.')
        || model.len() > 128
    {
        anyhow::bail!("OCR requires an exact reviewed Mistral OCR model ID");
    }
    Ok(())
}

fn ocr_request(
    model: &str,
    bytes: &[u8],
    mime_type: &str,
    page_allowance: u32,
) -> Result<serde_json::Value> {
    validate_ocr_model(model)?;
    if bytes.is_empty()
        || bytes.len() > MAX_OCR_BYTES
        || !(1..=MAX_OCR_PAGES).contains(&page_allowance)
    {
        anyhow::bail!("OCR document or page allowance is out of bounds");
    }
    let data_url = format!("data:{mime_type};base64,{}", BASE64.encode(bytes));
    let document = match mime_type {
        "application/pdf" if bytes.starts_with(b"%PDF-") => serde_json::json!({
            "type": "document_url", "document_url": data_url,
        }),
        "image/png" | "image/jpeg" | "image/webp" if page_allowance == 1 => serde_json::json!({
            "type": "image_url", "image_url": data_url,
        }),
        _ => anyhow::bail!("unsupported OCR document type or page allowance"),
    };
    Ok(serde_json::json!({
        "model": model,
        "document": document,
        "pages": (0..page_allowance).collect::<Vec<_>>(),
        "include_image_base64": false,
    }))
}

fn decode_ocr_response(
    bytes: &[u8],
    model: &str,
    hint: &str,
    page_allowance: u32,
) -> Result<MeteredDocument> {
    if bytes.len() > MAX_OCR_RESPONSE_BYTES {
        anyhow::bail!("OCR response exceeds its byte bound");
    }
    let response: MistralOcrResponse = serde_json::from_slice(bytes)?;
    let pages = response.usage_info.pages_processed;
    if response.model != model || pages == 0 || pages > page_allowance {
        anyhow::bail!("OCR response model or page usage does not match admission");
    }
    // Settle known usage even if returned content has missing/duplicate pages.
    let content_complete = response.pages.len() == pages as usize
        && response
            .pages
            .iter()
            .enumerate()
            .all(|(index, page)| page.index == index as u32);
    let raw_text = response
        .pages
        .iter()
        .map(|page| page.markdown.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let page_metadata = response
        .pages
        .iter()
        .map(|page| {
            serde_json::json!({
                "index": page.index, "markdown": page.markdown,
            })
        })
        .collect::<Vec<_>>();
    Ok(MeteredDocument {
        content_complete,
        document: ExtractedDocument {
            raw_text,
            doc_type: hint.to_owned(),
            fields: serde_json::json!({
                "source": "mistral-ocr", "model": model,
                "pages": page_metadata, "pages_processed": pages,
            }),
            confidence: None,
        },
        pages_processed: pages,
        model: model.to_owned(),
    })
}

#[async_trait]
impl VisionProvider for MistralVision {
    async fn extract(
        &self,
        bytes: &[u8],
        mime_type: &str,
        hint: &str,
    ) -> Result<ExtractedDocument> {
        let _ = (bytes, mime_type, hint);
        anyhow::bail!("Mistral OCR requires durable page-based spend admission")
    }

    async fn extract_metered(
        &self,
        bytes: &[u8],
        mime_type: &str,
        hint: &str,
        page_allowance: u32,
    ) -> Result<MeteredDocument> {
        let body = ocr_request(&self.model, bytes, mime_type, page_allowance)?;
        let mut response = self
            .client
            .post("https://api.mistral.ai/v1/ocr")
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await?;
        if !response.status().is_success() {
            // Never surface a provider body or credential-bearing transport URL.
            anyhow::bail!("Mistral OCR request failed");
        }
        if response
            .content_length()
            .is_some_and(|n| n > MAX_OCR_RESPONSE_BYTES as u64)
        {
            anyhow::bail!("OCR response exceeds its byte bound");
        }
        let mut output = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if output.len().saturating_add(chunk.len()) > MAX_OCR_RESPONSE_BYTES {
                anyhow::bail!("OCR response exceeds its byte bound");
            }
            output.extend_from_slice(&chunk);
        }
        decode_ocr_response(&output, &self.model, hint, page_allowance)
    }

    fn name(&self) -> &'static str {
        "mistral-ocr"
    }
    fn model(&self) -> &str {
        &self.model
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn direct_mistral_extraction_cannot_bypass_page_spend_admission() {
        let provider = MistralVision::with_model("test-key", "mistral-ocr-2505").unwrap();
        let error = provider
            .extract(b"image", "image/png", "invoice")
            .await
            .unwrap_err();
        assert!(error.to_string().contains("spend admission"));
    }

    #[test]
    fn ocr_requests_distinguish_pdf_from_images_and_bound_pages() {
        let pdf = ocr_request("mistral-ocr-2505", b"%PDF-1.7", "application/pdf", 2).unwrap();
        assert_eq!(pdf["document"]["type"], "document_url");
        assert_eq!(pdf["pages"], serde_json::json!([0, 1]));
        let image = ocr_request("mistral-ocr-2505", b"image", "image/png", 1).unwrap();
        assert_eq!(image["document"]["type"], "image_url");
        assert!(ocr_request("mistral-ocr-latest", b"image", "image/png", 1).is_err());
        assert!(ocr_request("mistral-ocr-2505", b"image", "image/png", 2).is_err());
        assert!(ocr_request("mistral-ocr-2505", b"not a pdf", "application/pdf", 1).is_err());
    }

    #[test]
    fn ocr_requires_real_complete_usage_and_never_invents_confidence() {
        let body = serde_json::json!({
            "model": "mistral-ocr-2505", "pages": [{"index": 0, "markdown": "Receipt"}],
            "usage_info": {"pages_processed": 1},
        });
        let result = decode_ocr_response(
            &serde_json::to_vec(&body).unwrap(),
            "mistral-ocr-2505",
            "receipt",
            1,
        )
        .unwrap();
        assert_eq!(result.pages_processed, 1);
        assert!(result.content_complete);
        assert_eq!(result.document.confidence, None);
        let incomplete = serde_json::json!({"model":"mistral-ocr-2505","pages":[{"index":1,"markdown":"Receipt"}],"usage_info":{"pages_processed":1}});
        let billed = decode_ocr_response(
            &serde_json::to_vec(&incomplete).unwrap(),
            "mistral-ocr-2505",
            "receipt",
            1,
        )
        .unwrap();
        assert_eq!(billed.pages_processed, 1);
        assert!(!billed.content_complete);
        for invalid in [
            serde_json::json!({"model": "mistral-ocr-2505", "pages": []}),
            serde_json::json!({"model": "another-model", "pages": [{"index": 0, "markdown": "Receipt"}], "usage_info": {"pages_processed": 1}}),
            serde_json::json!({"model": "mistral-ocr-2505", "pages": [{"index": 0, "markdown": "Receipt"}], "usage_info": {"pages_processed": 2}}),
        ] {
            assert!(decode_ocr_response(
                &serde_json::to_vec(&invalid).unwrap(),
                "mistral-ocr-2505",
                "receipt",
                1
            )
            .is_err());
        }
    }
}
