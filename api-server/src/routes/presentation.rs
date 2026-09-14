//! Actor-scoped discovery, preview and personal draft persistence; no activation.

use std::sync::Arc;

use axum::{
    extract::{DefaultBodyLimit, State},
    http::{header::AUTHORIZATION, HeaderMap},
    routing::{get, post},
    Json, Router,
};
use lumiere_presentation_core::{
    validate_module_draft, ApprovedComponentMetadata, ComponentKind, ModuleDraft, PageNode,
    PreviewCollection, PreviewOptions, PreviewRequest, PreviewResponse, SemanticSlot,
    ValidationCatalog, ValidationLimits,
};
use serde_json::{json, Value};
use tower_cookies::Cookies;

use crate::{
    error::ApiError,
    presentation_dictionary::{account_moves_capability, DictionaryError},
    session::{resolve_api_session, ApiSession},
    state::AppState,
    trusted_context::TrustedOperationContext,
    web_session::stdb_identity_hex_hint,
};

mod saved_drafts;

pub(super) fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/presentation/capabilities", get(capabilities))
        .route("/presentation/validate", post(validate))
        .route("/presentation/preview", get(preview_options).post(preview))
        .route(
            "/presentation/drafts",
            get(saved_drafts::list_drafts).post(saved_drafts::save_draft),
        )
        .route(
            "/presentation/drafts/:module_key",
            get(saved_drafts::get_draft),
        )
        .layer(DefaultBodyLimit::max(96 * 1024))
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
    let session = session(state, headers, cookies).await?;
    let context = TrustedOperationContext::for_resource_read(state, &session)?;
    context.require_current_placement(&state.organization_placements)?;
    Ok(context)
}

async fn session(
    state: &AppState,
    headers: &HeaderMap,
    cookies: &Cookies,
) -> Result<ApiSession, ApiError> {
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
    Ok(session)
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
    let catalog = catalog(&context)?;
    let diagnostics = validate_module_draft(&draft, &catalog, &limits())
        .err()
        .unwrap_or_default();
    Ok(Json(
        json!({"valid": diagnostics.is_empty(), "diagnostics": diagnostics, "usage": "draft-validation-only"}),
    ))
}

fn catalog(context: &TrustedOperationContext) -> Result<ValidationCatalog, ApiError> {
    let capability =
        account_moves_capability(Some(context.field_access())).map_err(dictionary_error)?;
    Ok(ValidationCatalog {
        application_contract: capability.contract_pin.to_owned(),
        component_catalog_version: 1,
        components: components(),
        capabilities: vec![lumiere_presentation_core::ApprovedCapabilityMetadata {
            resource: capability.resource.into(),
            fields: capability.fields,
        }],
    })
}

fn limits() -> ValidationLimits {
    ValidationLimits {
        max_pages: 8,
        max_nodes_per_page: 16,
        max_fields_per_node: 32,
        max_page_size: 100,
        max_read_bindings: 16,
        max_id_length: 64,
        max_title_length: 160,
    }
}

async fn preview_options(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
) -> Result<Json<PreviewOptions>, ApiError> {
    let context = context(&state, &headers, &cookies).await?;
    let capability =
        account_moves_capability(Some(context.field_access())).map_err(dictionary_error)?;
    Ok(Json(PreviewOptions {
        application_contract: capability.contract_pin.into(),
        fields: capability.fields,
    }))
}

async fn preview(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(request): Json<PreviewRequest>,
) -> Result<Json<PreviewResponse>, ApiError> {
    let context = context(&state, &headers, &cookies).await?;
    let catalog = catalog(&context)?;
    let mut preview_limits = limits();
    preview_limits.max_read_bindings = 4;
    if let Err(diagnostics) = validate_module_draft(&request.definition, &catalog, &preview_limits)
    {
        return Err(ApiError::Unprocessable(
            serde_json::to_string(&diagnostics).map_err(ApiError::internal)?,
        ));
    }
    let company_id = request
        .company_id
        .parse::<u64>()
        .ok()
        .filter(|id| *id != 0 && id.to_string() == request.company_id)
        .ok_or_else(|| {
            ApiError::BadRequest("companyId must be a canonical positive decimal id".into())
        })?;
    let mut collections = Vec::new();
    let mut acquisitions = std::collections::HashMap::new();
    let mut display_bytes = 0usize;
    for page in &request.definition.pages {
        for node in &page.nodes {
            let PageNode::Collection(collection) = node else {
                continue;
            };
            context.require_current_placement(&state.organization_placements)?;
            // The pilot has one resource and one company per request. Equal
            // limits share acquisition while each node keeps its own projection.
            if let std::collections::hash_map::Entry::Vacant(entry) =
                acquisitions.entry(collection.page_size)
            {
                entry.insert(
                    crate::presentation_reads::acquire_account_moves(
                        &context,
                        company_id,
                        collection.page_size.into(),
                    )
                    .await?,
                );
            }
            let acquired = &acquisitions[&collection.page_size];
            let mut fields = collection.fields.clone();
            for node in &page.nodes {
                if let PageNode::Detail(detail) = node {
                    if detail.source_node_id == collection.id {
                        for field in &detail.fields {
                            if !fields.contains(field) {
                                fields.push(field.clone());
                            }
                        }
                    }
                }
            }
            let mut rows = Vec::with_capacity(acquired.rows.len());
            for row in &acquired.rows {
                let row = crate::presentation_projection::project_account_move_row(row, &fields)?;
                display_bytes += row
                    .fields
                    .iter()
                    .filter_map(|field| field.value.as_ref())
                    .map(String::len)
                    .sum::<usize>();
                if display_bytes > 1024 * 1024 {
                    return Err(ApiError::Unprocessable(
                        "preview exceeds display budget; reduce fields or preview limit".into(),
                    ));
                }
                rows.push(row);
            }
            collections.push(PreviewCollection {
                page_id: page.id.clone(),
                node_id: collection.id.clone(),
                rows,
                truncated: acquired.truncated,
            });
        }
    }
    context.require_current_placement(&state.organization_placements)?;
    Ok(Json(PreviewResponse {
        definition: request.definition,
        collections,
    }))
}
