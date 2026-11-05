//! Internal, actor-scoped OCR for an exact server-owned DMS document version.
//!
//! The API owns blob resolution and source inspection. This hop is protected by
//! the gateway secret and current actor authority; it never accepts provider
//! URLs, credentials, prices, or an executable reducer from the browser.

use axum::{extract::State, http::HeaderMap, Json};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use lumiere_auth_context::ActorContext;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    ai_agent::{ensure_allowed_action, resolve_surface_agent},
    error::{AppError, AppResult},
    non_llm_spend::{execute_metered, MeteredResult, MeteredScope, MeteredUnit},
    state::AppState,
};

const OCR_CAPABILITY: &str = "ai.document.ocr";
const MAX_DOCUMENT_BYTES: usize = 10 * 1024 * 1024;
const MAX_TEXT_CHARS: usize = 32_768;

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OcrRequest {
    organization_id: u64,
    company_id: u64,
    document_id: u64,
    version_id: u64,
    source_sha256: String,
    content_type: String,
    content_base64: String,
    page_allowance: u32,
    language: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OcrResponse {
    organization_id: u64,
    company_id: u64,
    document_id: u64,
    version_id: u64,
    source_sha256: String,
    pub text: String,
    pub model: String,
    pub pages_processed: u32,
    pub confidence: Option<f32>,
    pub pages: serde_json::Value,
}

fn decode_document(req: &OcrRequest, max_pages: u32) -> AppResult<Vec<u8>> {
    if req.organization_id == 0
        || req.company_id == 0
        || req.document_id == 0
        || req.version_id == 0
    {
        return Err(AppError::BadRequest(
            "OCR requires exact document scope".into(),
        ));
    }
    if req.source_sha256.len() != 64
        || !req
            .source_sha256
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(AppError::BadRequest(
            "OCR requires an exact source checksum".into(),
        ));
    }
    if req.content_base64.len() > MAX_DOCUMENT_BYTES.div_ceil(3) * 4
        || req.page_allowance == 0
        || req.page_allowance > max_pages
    {
        return Err(AppError::BadRequest(
            "OCR document or page allowance exceeds its bound".into(),
        ));
    }
    if req.language.as_ref().is_some_and(|language| {
        language.is_empty()
            || language.len() > 32
            || !language
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    }) {
        return Err(AppError::BadRequest("invalid OCR language hint".into()));
    }
    let bytes = BASE64
        .decode(&req.content_base64)
        .map_err(|_| AppError::BadRequest("invalid OCR document encoding".into()))?;
    if bytes.is_empty()
        || bytes.len() > MAX_DOCUMENT_BYTES
        || format!("{:x}", Sha256::digest(&bytes)) != req.source_sha256
    {
        return Err(AppError::BadRequest(
            "OCR document checksum or byte bound differs".into(),
        ));
    }
    match req.content_type.as_str() {
        "application/pdf" if bytes.starts_with(b"%PDF-") => {}
        "image/png" | "image/jpeg" | "image/webp" if req.page_allowance == 1 => {}
        _ => return Err(AppError::BadRequest("unsupported OCR document type".into())),
    }
    Ok(bytes)
}

fn request_key(req: &OcrRequest, actor: &ActorContext, model: &str) -> String {
    let binding = serde_json::json!({
        "actor": actor.identity, "organization": req.organization_id, "company": req.company_id,
        "document": req.document_id, "version": req.version_id, "sha256": req.source_sha256,
        "contentType": req.content_type, "pages": req.page_allowance, "model": model,
        "language": req.language,
    });
    format!(
        "ocr:document:{:x}",
        Sha256::digest(binding.to_string().as_bytes())
    )
}

pub async fn post_ocr(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<OcrRequest>,
) -> AppResult<Json<OcrResponse>> {
    let actor = ActorContext::from_headers(&headers)?;
    actor.require_company(req.company_id)?;
    if actor.organization_id != req.organization_id {
        return Err(AppError::Forbidden(
            "OCR organization differs from actor scope".into(),
        ));
    }
    let bytes = decode_document(&req, state.config.mistral_ocr_max_pages)?;
    let grant = crate::routes::evidence::require_scoped_capability_grant(
        &state,
        &actor.identity,
        &actor.token,
        actor.organization_id,
        actor.company_id,
        OCR_CAPABILITY,
    )
    .await?;
    enforce_grant_bounds(&grant, bytes.len(), req.page_allowance)?;
    if state.config.vision_provider != "mistral" || state.providers.vision.name() != "mistral-ocr" {
        return Err(AppError::Unavailable("Mistral OCR is not enabled".into()));
    }
    let reader = state
        .spend_read_stdb
        .as_deref()
        .ok_or_else(|| AppError::Unavailable("OCR spend reader is not configured".into()))?;
    let agent = resolve_surface_agent(
        state.stdb.as_ref(),
        actor.organization_id,
        actor.company_id,
        "document_ocr",
        None,
        None,
        state.config.ollama_supports_tool_calling,
    )
    .await
    .map_err(|_| AppError::Unavailable("OCR company agent is not provisioned".into()))?;
    ensure_allowed_action(&agent, "ocr")
        .map_err(|_| AppError::Forbidden("agent does not permit OCR".into()))?;
    let model = state.providers.vision.model();
    if agent.provider != "mistral" || !agent.allowed_models.iter().any(|allowed| allowed == model) {
        return Err(AppError::Forbidden(
            "OCR model is not admitted for the company agent".into(),
        ));
    }
    let scope = MeteredScope {
        organization_id: actor.organization_id,
        company_id: actor.company_id,
        agent_id: agent.agent_id,
        run_id: 0,
        actor_identity: actor.identity.clone(),
        request_key: request_key(&req, &actor, model),
        model: model.to_owned(),
        unit: MeteredUnit::Pages,
        allowance: req.page_allowance,
    };
    let extracted = execute_metered(state.stdb.as_ref(), reader, scope, || async {
        let result = state
            .providers
            .vision
            .extract_metered(&bytes, &req.content_type, "document", req.page_allowance)
            .await?;
        Ok(MeteredResult {
            units: result.pages_processed,
            value: result,
        })
    })
    .await
    .map_err(|_| {
        AppError::Unavailable(
            "OCR admission or result is unavailable; reconcile the exact request before retry"
                .into(),
        )
    })?;
    // Usage settles even when a paid result is unsuitable for evidence admission.
    if !extracted.content_complete
        || extracted.document.raw_text.trim().is_empty()
        || extracted.document.raw_text.chars().count() > MAX_TEXT_CHARS
        || extracted.pages_processed != req.page_allowance
    {
        return Err(AppError::Unavailable(
            "OCR returned incomplete or unsupported document text".into(),
        ));
    }
    let release_grant = crate::routes::evidence::require_scoped_capability_grant(
        &state,
        &actor.identity,
        &actor.token,
        actor.organization_id,
        actor.company_id,
        OCR_CAPABILITY,
    )
    .await?;
    // Never convert extracted text into instructions or a financial posting.
    let response = OcrResponse {
        organization_id: req.organization_id,
        company_id: req.company_id,
        document_id: req.document_id,
        version_id: req.version_id,
        source_sha256: req.source_sha256,
        text: extracted.document.raw_text,
        model: extracted.model,
        pages_processed: extracted.pages_processed,
        confidence: None,
        pages: extracted
            .document
            .fields
            .get("pages")
            .cloned()
            .unwrap_or(serde_json::Value::Null),
    };
    enforce_grant_bounds(&release_grant, bytes.len(), response.pages_processed)?;
    let response_bytes = serde_json::to_vec(&response)
        .map_err(|_| AppError::Unavailable("OCR response encoding failed".into()))?;
    enforce_grant_bounds(
        &release_grant,
        response_bytes.len(),
        response.pages_processed,
    )?;
    Ok(Json(response))
}

fn enforce_grant_bounds(
    grant: &crate::routes::evidence::CapabilityGrantBounds,
    bytes: usize,
    pages: u32,
) -> AppResult<()> {
    if bytes as u64 > grant.max_bytes || u64::from(pages) > grant.max_rows {
        return Err(AppError::Forbidden(
            "OCR exceeds the actor's document bounds".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> OcrRequest {
        let bytes = b"%PDF-1.7";
        OcrRequest {
            organization_id: 1,
            company_id: 2,
            document_id: 3,
            version_id: 4,
            source_sha256: format!("{:x}", Sha256::digest(bytes)),
            content_type: "application/pdf".into(),
            content_base64: BASE64.encode(bytes),
            page_allowance: 2,
            language: Some("en".into()),
        }
    }

    #[test]
    fn capability_bounds_limit_input_pages_and_complete_output() {
        let grant = crate::routes::evidence::CapabilityGrantBounds {
            max_rows: 2,
            max_bytes: 128,
        };
        assert!(enforce_grant_bounds(&grant, 128, 2).is_ok());
        assert!(enforce_grant_bounds(&grant, 129, 2).is_err());
        assert!(enforce_grant_bounds(&grant, 128, 3).is_err());
    }

    #[test]
    fn checksum_and_page_bounds_precede_provider_admission() {
        let mut req = request();
        assert!(decode_document(&req, 20).is_ok());
        req.source_sha256 = "0".repeat(64);
        assert!(decode_document(&req, 20).is_err());
        req = request();
        assert!(decode_document(&req, 1).is_err());
        req.content_type = "image/png".into();
        assert!(decode_document(&req, 20).is_err());
    }

    #[test]
    fn exact_request_identity_binds_actor_version_model_and_scope() {
        let actor = ActorContext::new(&"a".repeat(64), "token", 1, 2).unwrap();
        let mut req = request();
        let key = request_key(&req, &actor, "mistral-ocr-2505");
        assert_eq!(key, request_key(&req, &actor, "mistral-ocr-2505"));
        req.version_id += 1;
        assert_ne!(key, request_key(&req, &actor, "mistral-ocr-2505"));
        assert_ne!(key, request_key(&request(), &actor, "mistral-ocr-2512"));
        let other = ActorContext::new(&"b".repeat(64), "token", 1, 2).unwrap();
        assert_ne!(key, request_key(&request(), &other, "mistral-ocr-2505"));
    }
}
