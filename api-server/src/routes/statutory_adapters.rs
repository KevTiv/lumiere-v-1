//! Statutory / e-invoice adapter seam — jurisdiction adapters live outside WASM.
//!
//! Lumiere reducers never call external portals. API-server adapters accept
//! normalized export requests keyed by country pack (`pack_key`) and return
//! adapter-specific payloads or enqueue outbound delivery.
//!
//! Legislation stays in pack metadata + adapter modules; core GL posts remaining
//! untouched.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tower_cookies::Cookies;

use crate::error::ApiError;
use crate::state::AppState;
use crate::web_session::{require_org, resolve_session};

#[derive(Debug, Deserialize)]
pub struct StatutoryExportRequest {
    pub pack_key: String,
    pub company_id: u64,
    /// Adapter-specific document type (e.g. `nfe`, `bas`, `iras`, `peppol`).
    pub document_type: String,
    /// Opaque JSON payload prepared by the client / BFF from posted moves.
    pub payload: Value,
    pub metadata: Option<Value>,
}

async fn list_adapters(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let _organization_id = require_org(&session)?;

    Ok(Json(json!({
        "data": [
            { "pack_key": "au", "document_types": ["bas"], "status": "stub" },
            { "pack_key": "nz", "document_types": ["gst_return"], "status": "stub" },
            { "pack_key": "za", "document_types": ["vat201"], "status": "stub" },
            { "pack_key": "sg", "document_types": ["iras"], "status": "stub" },
            { "pack_key": "br", "document_types": ["nfe"], "status": "stub" },
            { "pack_key": "my", "document_types": ["peppol"], "status": "stub" },
            { "pack_key": "id", "document_types": ["coretax"], "status": "stub" },
        ]
    })))
}

async fn export_statutory(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(pack_key): Path<String>,
    Json(body): Json<StatutoryExportRequest>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let organization_id = require_org(&session)?;

    let pack = pack_key.trim().to_lowercase();
    if pack.is_empty() || body.pack_key.trim().to_lowercase() != pack {
        return Err(ApiError::BadRequest(
            "pack_key path and body must match".into(),
        ));
    }

    // Verify company belongs to session org (read-only probe).
    let client = state.client_with_token(&session.stdb_token);
    let company_rows = client
        .query_sql(&format!(
            "SELECT id FROM company WHERE organization_id = {organization_id} AND id = {} AND deleted_at IS NULL LIMIT 1",
            body.company_id
        ))
        .await
        .map_err(ApiError::internal)?;
    if company_rows.is_empty() {
        return Err(ApiError::NotFound("company not found".into()));
    }

    // Adapter registry stub — concrete NF-e / BAS / IRAS clients plug in here.
    let adapter_status = match pack.as_str() {
        "au" | "nz" | "za" | "sg" | "br" | "ar" | "cl" | "my" | "id" | "th" | "ph" => {
            "accepted_stub"
        }
        _ => {
            return Err(ApiError::BadRequest(format!(
                "no statutory adapter registered for pack_key '{pack}'"
            )));
        }
    };

    Ok(Json(json!({
        "data": {
            "organization_id": organization_id,
            "company_id": body.company_id,
            "pack_key": pack,
            "document_type": body.document_type,
            "status": adapter_status,
            "payload": body.payload,
            "metadata": body.metadata,
            "message": "Statutory export queued via adapter seam (implementation pending per jurisdiction).",
        }
    })))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/statutory-adapters", get(list_adapters))
        .route(
            "/statutory-adapters/:pack_key/export",
            post(export_statutory),
        )
}
