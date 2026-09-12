//! Actor-scoped discovery and draft diagnostics; no persistence or activation.

use std::sync::Arc;

use axum::{
    extract::{DefaultBodyLimit, State},
    http::{header::AUTHORIZATION, HeaderMap},
    routing::{get, post},
    Json, Router,
};
use lumiere_presentation_core::{
    validate_module_draft, ApprovedComponentMetadata, ComponentKind, ModuleDraft, SemanticSlot,
    ValidationCatalog, ValidationLimits,
};
use serde_json::{json, Value};
use tower_cookies::Cookies;

use crate::{
    error::ApiError,
    presentation_dictionary::{account_moves_capability, DictionaryError},
    session::resolve_api_session,
    state::AppState,
    trusted_context::TrustedOperationContext,
    web_session::stdb_identity_hex_hint,
};

pub(super) fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/presentation/capabilities", get(capabilities))
        .route("/presentation/validate", post(validate))
        .layer(DefaultBodyLimit::max(64 * 1024))
}

fn dictionary_error(error: DictionaryError) -> ApiError {
    match error {
        DictionaryError::PermissionDenied => ApiError::Forbidden(error.to_string()),
        DictionaryError::InvalidContract(_) => ApiError::internal(error),
    }
}

async fn context(
    state: &AppState,
    headers: &HeaderMap,
    cookies: &Cookies,
) -> Result<TrustedOperationContext, ApiError> {
    let auth = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    let hint = stdb_identity_hex_hint(headers, cookies);
    let token = cookies
        .get("stdb_token")
        .map(|cookie| cookie.value().to_owned());
    let session = resolve_api_session(state, auth, token.as_deref(), hint.as_deref())
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let context = TrustedOperationContext::for_resource_read(state, &session)?;
    context.require_current_placement(&state.organization_placements)?;
    Ok(context)
}

async fn capabilities(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
) -> Result<Json<Value>, ApiError> {
    let context = context(&state, &headers, &cookies).await?;
    let capability =
        account_moves_capability(Some(context.field_access())).map_err(dictionary_error)?;
    Ok(Json(
        json!({"capabilities": [capability], "schemaVersion": 1, "componentCatalogVersion": 1, "components": components(), "usage": "draft-validation-only"}),
    ))
}

fn components() -> Vec<ApprovedComponentMetadata> {
    vec![
        ApprovedComponentMetadata {
            id: "erp.collection".into(),
            version: 1,
            kind: ComponentKind::Collection,
            slots: vec![SemanticSlot::Primary],
        },
        ApprovedComponentMetadata {
            id: "erp.detail".into(),
            version: 1,
            kind: ComponentKind::Detail,
            slots: vec![SemanticSlot::Secondary],
        },
    ]
}

async fn validate(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(draft): Json<ModuleDraft>,
) -> Result<Json<Value>, ApiError> {
    let context = context(&state, &headers, &cookies).await?;
    let capability =
        account_moves_capability(Some(context.field_access())).map_err(dictionary_error)?;
    let catalog = ValidationCatalog {
        application_contract: capability.contract_pin.to_owned(),
        component_catalog_version: 1,
        components: components(),
        capabilities: vec![lumiere_presentation_core::ApprovedCapabilityMetadata {
            resource: capability.resource.into(),
            fields: capability.fields,
        }],
    };
    let limits = ValidationLimits {
        max_pages: 8,
        max_nodes_per_page: 16,
        max_fields_per_node: 32,
        max_page_size: 100,
        max_read_bindings: 16,
        max_id_length: 64,
        max_title_length: 160,
    };
    let diagnostics = validate_module_draft(&draft, &catalog, &limits)
        .err()
        .unwrap_or_default();
    Ok(Json(
        json!({"valid": diagnostics.is_empty(), "diagnostics": diagnostics, "usage": "draft-validation-only"}),
    ))
}
