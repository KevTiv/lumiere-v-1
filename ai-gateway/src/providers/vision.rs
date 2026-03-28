use anyhow::Result;
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Deserialize;

/// Structured result of image/document analysis.
#[derive(Debug, Clone)]
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
    /// Estimated confidence 0.0–1.0.
    pub confidence: f32,
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

    fn name(&self) -> &'static str;
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
                confidence: 0.85,
            }
        }
        Err(_) => {
            // Fallback: treat the whole response as raw text
            ExtractedDocument {
                raw_text: raw_response.to_string(),
                doc_type: hint.to_string(),
                fields: serde_json::json!({ "raw_text": raw_response }),
                confidence: 0.5,
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

pub struct MistralVision {
    client: reqwest::Client,
    api_key: String,
}

#[derive(Deserialize)]
struct MistralOcrResponse {
    pages: Vec<MistralOcrPage>,
}

#[derive(Deserialize)]
struct MistralOcrPage {
    markdown: String,
}

impl MistralVision {
    pub fn new(api_key: &str) -> Self {
        MistralVision {
            client: reqwest::Client::new(),
            api_key: api_key.to_string(),
        }
    }
}

#[async_trait]
impl VisionProvider for MistralVision {
    async fn extract(
        &self,
        image_bytes: &[u8],
        mime_type: &str,
        hint: &str,
    ) -> Result<ExtractedDocument> {
        let image_b64 = BASE64.encode(image_bytes);
        let data_url = format!("data:{};base64,{}", mime_type, image_b64);

        let body = serde_json::json!({
            "model": "mistral-ocr-latest",
            "document": {
                "type": "image_url",
                "image_url": data_url,
            },
            "include_image_base64": false,
        });

        let resp: MistralOcrResponse = self
            .client
            .post("https://api.mistral.ai/v1/ocr")
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        let raw_text = resp.pages.iter().map(|p| p.markdown.as_str()).collect::<Vec<_>>().join("\n\n");

        Ok(ExtractedDocument {
            raw_text: raw_text.clone(),
            doc_type: hint.to_string(),
            fields: serde_json::json!({ "raw_text": raw_text, "source": "mistral-ocr" }),
            confidence: 0.92,
        })
    }

    fn name(&self) -> &'static str {
        "mistral-ocr"
    }
}
