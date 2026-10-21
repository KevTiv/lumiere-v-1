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
use crate::query_exec::resolve_membership_company_id;
use crate::state::AppState;
use crate::trusted_context::TrustedOperationContext;
use crate::web_session::{require_org, resolve_session};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct AdapterRegistration {
    pack_key: &'static str,
    document_types: &'static [&'static str],
    status: &'static str,
    external_certification_required: bool,
}

const ADAPTERS: &[AdapterRegistration] = &[
    AdapterRegistration {
        pack_key: "au",
        document_types: &["bas"],
        status: "stub",
        external_certification_required: false,
    },
    AdapterRegistration {
        pack_key: "nz",
        document_types: &["gst_return"],
        status: "stub",
        external_certification_required: false,
    },
    AdapterRegistration {
        pack_key: "za",
        document_types: &["vat201"],
        status: "stub",
        external_certification_required: false,
    },
    AdapterRegistration {
        pack_key: "sg",
        document_types: &["iras"],
        status: "stub",
        external_certification_required: false,
    },
    AdapterRegistration {
        pack_key: "br",
        document_types: &["nfe"],
        status: "stub",
        external_certification_required: false,
    },
    AdapterRegistration {
        pack_key: "my",
        document_types: &["peppol"],
        status: "stub",
        external_certification_required: false,
    },
    AdapterRegistration {
        pack_key: "id",
        document_types: &["coretax"],
        status: "stub",
        external_certification_required: false,
    },
    AdapterRegistration {
        pack_key: "rw",
        document_types: &["ebm_invoice", "vat_return"],
        status: "review_required",
        external_certification_required: true,
    },
];

fn adapter_registration(pack_key: &str) -> Option<AdapterRegistration> {
    ADAPTERS
        .iter()
        .copied()
        .find(|adapter| adapter.pack_key == pack_key)
}

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

    let data: Vec<_> = ADAPTERS
        .iter()
        .map(|adapter| {
            json!({
                "pack_key": adapter.pack_key,
                "document_types": adapter.document_types,
                "status": adapter.status,
                "external_certification_required": adapter.external_certification_required,
            })
        })
        .collect();

    Ok(Json(json!({ "data": data })))
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

    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    let company_id = resolve_membership_company_id(
        context.client(),
        organization_id,
        context.actor_identity(),
        Some(body.company_id),
        "statutory-export company scope mismatch",
    )
    .await?;
    let _context = context.with_company_scope(vec![company_id])?;

    // Adapter registry stub — concrete NF-e / BAS / IRAS clients plug in here.
    // Rwanda is registered for discovery and integration planning, but fails closed
    // until RRA has certified the VSDC integration and the country pack is accepted.
    if pack == "rw" {
        return Err(ApiError::Conflict(
            "Rwanda statutory export requires accepted country-pack rules and RRA VSDC certification"
                .into(),
        ));
    }
    let adapter_status = match pack.as_str() {
        "ar" | "cl" | "th" | "ph" => "accepted_stub",
        _ if adapter_registration(&pack).is_some() => "accepted_stub",
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rwanda_adapter_is_discoverable_but_review_gated() {
        let adapter = adapter_registration("rw").expect("Rwanda adapter registration");
        assert_eq!(adapter.status, "review_required");
        assert_eq!(adapter.document_types, ["ebm_invoice", "vat_return"]);
        assert!(adapter.external_certification_required);
    }

    #[test]
    fn unknown_adapter_is_not_registered() {
        assert!(adapter_registration("unknown").is_none());
    }
}
