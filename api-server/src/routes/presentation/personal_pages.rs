//! Authenticated personal page layouts backed by immutable native snapshots.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use lumiere_contracts::bindings::{DashboardWidget, PresentationModule, PresentationModuleVersion};
use lumiere_presentation_core::{
    personal_page_decimal, personal_page_key, personal_page_widget_source_resource,
    prepare_personal_page_layout, PersonalPageLayoutResponse, PersonalPageModule,
    SavePersonalPageLayoutRequest, StoredPersonalPageLayout, MAX_PERSONAL_PAGE_BYTES,
    PERSONAL_PAGE_CONTRACT,
};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use spacetimedb_sats::serde::SerdeWrapper;
use stdb_auth::{permission_allowed, FieldAccessContext};
use tower_cookies::Cookies;

use super::{
    saved_drafts::{owner_sql, read_versions},
    session,
};
use crate::{
    commands::{authorize_reducer_company_scope, dispatch_personal_page_layout_save},
    error::ApiError,
    session::{normalize_identity_hex_for_sql, ApiSession},
    state::AppState,
    trusted_context::TrustedOperationContext,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PageScopeQuery {
    company_id: String,
}

fn require_page_read(
    access: &FieldAccessContext,
    module: PersonalPageModule,
) -> Result<(), ApiError> {
    if permission_allowed(access, module.permission_resource(), "read") {
        Ok(())
    } else {
        Err(ApiError::Forbidden(
            "read permission denied for this module page".into(),
        ))
    }
}

async fn page_context(
    state: &AppState,
    session: &ApiSession,
    company_id: u64,
    module: PersonalPageModule,
) -> Result<TrustedOperationContext, ApiError> {
    let context = TrustedOperationContext::for_resource_read(state, session)?;
    require_page_read(context.field_access(), module)?;
    let companies = authorize_reducer_company_scope(&context, vec![company_id]).await?;
    let context = context.with_company_scope(companies)?;
    context.require_current_placement(&state.organization_placements)?;
    Ok(context)
}

fn path_scope(
    module_id: &str,
    page_id: &str,
    company_id: &str,
) -> Result<(PersonalPageModule, u64, String), ApiError> {
    let module = module_id
        .parse::<PersonalPageModule>()
        .map_err(ApiError::BadRequest)?;
    let company = personal_page_decimal(company_id).map_err(ApiError::BadRequest)?;
    let key = personal_page_key(company, module, page_id).map_err(ApiError::BadRequest)?;
    Ok((module, company, key))
}

fn verify_layout_head(
    context: &TrustedOperationContext,
    head: &PresentationModule,
    key: &str,
) -> Result<(), ApiError> {
    if head.id == 0
        || head.current_revision == 0
        || head.module_key != key
        || head.organization_id != context.organization_id()
        || normalize_identity_hex_for_sql(&head.owner_identity.to_hex().to_string())
            != normalize_identity_hex_for_sql(context.actor_identity())
        || head.scope_key
            != format!(
                "{}:{}:{key}",
                head.organization_id,
                head.owner_identity.to_hex()
            )
    {
        return Err(ApiError::Internal(
            "personal page head scope or revision mismatch".into(),
        ));
    }
    Ok(())
}

async fn read_head(
    state: &AppState,
    context: &TrustedOperationContext,
    key: &str,
) -> Result<Option<PresentationModule>, ApiError> {
    // key is constructed only from a closed module enum, positive decimal and slug.
    let sql = format!(
        "SELECT * FROM presentation_module WHERE {} AND module_key = '{key}' LIMIT 2",
        owner_sql(context)
    );
    let rows = state
        .stdb
        .query_sql_sats(&sql)
        .await
        .map_err(ApiError::internal)?;
    if rows.len() > 1 {
        return Err(ApiError::Internal("duplicate personal page heads".into()));
    }
    let head = rows
        .into_iter()
        .next()
        .map(|row| {
            serde_json::from_value::<SerdeWrapper<PresentationModule>>(row)
                .map(|row| row.0)
                .map_err(ApiError::internal)
        })
        .transpose()?;
    if let Some(head) = &head {
        verify_layout_head(context, head, key)?;
    }
    Ok(head)
}

fn decode_layout(
    context: &TrustedOperationContext,
    row: &PresentationModuleVersion,
    company_id: u64,
    module: PersonalPageModule,
    page_id: &str,
) -> Result<PersonalPageLayoutResponse, ApiError> {
    if row.definition_json.len() > MAX_PERSONAL_PAGE_BYTES
        || row.id == 0
        || row.module_id == 0
        || row.revision == 0
    {
        return Err(ApiError::Internal(
            "invalid personal page snapshot bounds".into(),
        ));
    }
    let stored: StoredPersonalPageLayout =
        serde_json::from_str(&row.definition_json).map_err(ApiError::internal)?;
    let prepared =
        prepare_personal_page_layout(company_id, module, page_id, stored.layout.as_ref()).map_err(
            |error| ApiError::Internal(format!("invalid personal page snapshot: {error}")),
        )?;
    let hash = hex::encode(Sha256::digest(row.definition_json.as_bytes()));
    if row.organization_id != context.organization_id()
        || normalize_identity_hex_for_sql(&row.owner_identity.to_hex().to_string())
            != normalize_identity_hex_for_sql(context.actor_identity())
        || row.created_by != row.owner_identity
        || row.module_key != prepared.module_key
        || row.definition_json != prepared.definition_json
        || row.definition_hash != hash
        || row.schema_version != 1
        || row.application_contract != PERSONAL_PAGE_CONTRACT
        || row.component_catalog_version != 1
    {
        return Err(ApiError::Internal(
            "personal page snapshot scope or metadata mismatch".into(),
        ));
    }
    Ok(PersonalPageLayoutResponse {
        company_id: company_id.to_string(),
        module_id: module,
        page_id: page_id.to_owned(),
        revision: Some(row.revision.to_string()),
        layout: stored.layout,
    })
}

async fn read_revision(
    state: &AppState,
    context: &TrustedOperationContext,
    head: &PresentationModule,
    revision: u64,
    company_id: u64,
    module: PersonalPageModule,
    page_id: &str,
) -> Result<PersonalPageLayoutResponse, ApiError> {
    let versions = read_versions(&state.stdb, context, &[(head.id, revision)]).await?;
    let row = versions
        .into_iter()
        .find(|row| row.module_id == head.id && row.revision == revision)
        .ok_or_else(|| ApiError::Internal("personal page revision is missing".into()))?;
    decode_layout(context, &row, company_id, module, page_id)
}

async fn authorize_saved_widgets(
    state: &AppState,
    context: &TrustedOperationContext,
    company_id: u64,
    widget_ids: &[u64],
) -> Result<(), ApiError> {
    if widget_ids.is_empty() {
        return Ok(());
    }
    if !permission_allowed(context.field_access(), "dashboard_widget", "read") {
        return Err(ApiError::Forbidden(
            "read permission denied for saved widgets".into(),
        ));
    }
    let selector = widget_ids
        .iter()
        .map(|id| format!("id = {id}"))
        .collect::<Vec<_>>()
        .join(" OR ");
    let sql = format!(
        "SELECT * FROM dashboard_widget WHERE organization_id = {} AND ({selector}) LIMIT {}",
        context.organization_id(),
        widget_ids.len() + 1
    );
    let rows = state
        .stdb
        .query_sql_sats(&sql)
        .await
        .map_err(ApiError::internal)?;
    if rows.len() != widget_ids.len() {
        return Err(ApiError::Unprocessable(
            "saved widget is unavailable for this page".into(),
        ));
    }
    let mut seen = std::collections::HashSet::new();
    for row in rows {
        let widget = serde_json::from_value::<SerdeWrapper<DashboardWidget>>(row)
            .map_err(ApiError::internal)?
            .0;
        if !widget_ids.contains(&widget.id)
            || !seen.insert(widget.id)
            || widget.organization_id != context.organization_id()
            || widget.company_id.is_some_and(|id| id != company_id)
            || !widget.is_active
        {
            return Err(ApiError::Unprocessable(
                "saved widget is unavailable for this page".into(),
            ));
        }
        if !permission_allowed(
            context.field_access(),
            &personal_page_widget_source_resource(&widget.model),
            "read",
        ) {
            return Err(ApiError::Forbidden(
                "read permission denied for the saved widget source".into(),
            ));
        }
    }
    Ok(())
}

pub(super) async fn get_layout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path((module_id, page_id)): Path<(String, String)>,
    Query(query): Query<PageScopeQuery>,
) -> Result<Json<PersonalPageLayoutResponse>, ApiError> {
    let session = session(&state, &headers, &cookies).await?;
    let (module, company, key) = path_scope(&module_id, &page_id, &query.company_id)?;
    let context = page_context(&state, &session, company, module).await?;
    let response = match read_head(&state, &context, &key).await? {
        Some(head) => {
            read_revision(
                &state,
                &context,
                &head,
                head.current_revision,
                company,
                module,
                &page_id,
            )
            .await?
        }
        None => PersonalPageLayoutResponse {
            company_id: company.to_string(),
            module_id: module,
            page_id,
            revision: None,
            layout: None,
        },
    };
    // References are inert personal metadata. Each live widget read reauthorizes
    // independently, allowing the owner to remove a now-unavailable reference.
    context.require_current_placement(&state.organization_placements)?;
    Ok(Json(response))
}

pub(super) async fn save_layout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path((module_id, page_id)): Path<(String, String)>,
    Query(query): Query<PageScopeQuery>,
    Json(request): Json<SavePersonalPageLayoutRequest>,
) -> Result<Json<PersonalPageLayoutResponse>, ApiError> {
    let session = session(&state, &headers, &cookies).await?;
    let (module, company, key) = path_scope(&module_id, &page_id, &query.company_id)?;
    let context = page_context(&state, &session, company, module).await?;
    let expected = request
        .expected_revision
        .as_deref()
        .map(personal_page_decimal)
        .transpose()
        .map_err(ApiError::BadRequest)?;
    let revision = expected
        .unwrap_or(0)
        .checked_add(1)
        .ok_or_else(|| ApiError::Conflict("personal page revision exhausted".into()))?;
    let prepared = prepare_personal_page_layout(company, module, &page_id, request.layout.as_ref())
        .map_err(ApiError::Unprocessable)?;
    authorize_saved_widgets(&state, &context, company, &prepared.saved_widget_ids).await?;
    let args = json!([
        context.organization_id(),
        company,
        module.as_str(),
        page_id,
        expected,
        serde_json::to_string(&request.layout).map_err(ApiError::internal)?,
    ]);
    let context = match dispatch_personal_page_layout_save(&state, &session, args).await {
        Ok(context) => context,
        Err(ApiError::Unprocessable(message))
            if [
                "stale presentation module revision",
                "expected revision is required when updating a presentation module",
                "presentation module does not exist",
            ]
            .iter()
            .any(|text| message.contains(text)) =>
        {
            return Err(ApiError::Conflict(
                "personal page layout revision conflict; reload before saving".into(),
            ));
        }
        Err(error) => return Err(error),
    };
    let head = read_head(&state, &context, &key)
        .await?
        .ok_or_else(|| ApiError::Internal("saved personal page head is missing".into()))?;
    // Read the exact attempted revision, even if a later edit has already advanced the head.
    let response =
        read_revision(&state, &context, &head, revision, company, module, &page_id).await?;
    let readback =
        prepare_personal_page_layout(company, module, &page_id, response.layout.as_ref())
            .map_err(ApiError::Internal)?;
    if readback.definition_json != prepared.definition_json {
        return Err(ApiError::Conflict(
            "personal page revision did not contain the submitted layout".into(),
        ));
    }
    context.require_current_placement(&state.organization_placements)?;
    Ok(Json(response))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    fn access() -> FieldAccessContext {
        FieldAccessContext {
            organization_id: 7,
            identity_hex: "ab".repeat(32),
            role_id: 1,
            role_permissions: vec!["module:sales:read".into()],
            ..Default::default()
        }
    }

    fn test_context() -> TrustedOperationContext {
        let session = ApiSession {
            stdb_token: "session-token".into(),
            identity_hex: "ab".repeat(32),
            organization_id: Some(7),
            field_access: Some(access()),
        };
        let client = stdb_client::StdbClient::new(
            "http://127.0.0.1:1".into(),
            "test".into(),
            session.stdb_token.clone(),
        );
        TrustedOperationContext::from_session(
            &session,
            client,
            crate::trusted_context::RESOURCE_QUERY_OPERATION_ID,
        )
        .unwrap()
    }

    fn snapshot() -> PresentationModuleVersion {
        let prepared =
            prepare_personal_page_layout(9, PersonalPageModule::Sales, "dashboard", None).unwrap();
        let owner = spacetimedb_sdk::Identity::from_byte_array([0xab; 32]);
        PresentationModuleVersion {
            id: 11,
            organization_id: 7,
            owner_identity: owner,
            module_id: 10,
            module_key: prepared.module_key,
            revision: 2,
            definition_hash: hex::encode(Sha256::digest(prepared.definition_json.as_bytes())),
            definition_json: prepared.definition_json,
            schema_version: 1,
            application_contract: PERSONAL_PAGE_CONTRACT.into(),
            component_catalog_version: 1,
            created_at: spacetimedb_sdk::Timestamp::UNIX_EPOCH,
            created_by: owner,
        }
    }

    #[test]
    fn personal_page_access_matches_surface_grants_and_current_denies() {
        let mut access = access();
        assert!(require_page_read(&access, PersonalPageModule::Sales).is_ok());
        assert!(require_page_read(&access, PersonalPageModule::Accounting).is_err());
        access.org_permissions.push(stdb_auth::ActionPermission {
            resource: "module:sales".into(),
            action: "read".into(),
            allow: false,
        });
        assert!(require_page_read(&access, PersonalPageModule::Sales).is_err());
        access.role_permissions.push("*:*".into());
        assert!(require_page_read(&access, PersonalPageModule::Sales).is_err());
    }

    #[test]
    fn personal_snapshot_preserves_reset_and_rejects_scope_or_hash_substitution() {
        let context = test_context();
        let row = snapshot();
        let decoded =
            decode_layout(&context, &row, 9, PersonalPageModule::Sales, "dashboard").unwrap();
        assert_eq!(decoded.revision.as_deref(), Some("2"));
        assert!(decoded.layout.is_none());
        assert!(decode_layout(&context, &row, 8, PersonalPageModule::Sales, "dashboard").is_err());
        assert!(decode_layout(&context, &row, 9, PersonalPageModule::Sales, "orders").is_err());
        let mut changed = snapshot();
        changed.definition_hash = "0".repeat(64);
        assert!(decode_layout(
            &context,
            &changed,
            9,
            PersonalPageModule::Sales,
            "dashboard"
        )
        .is_err());
        let mut changed = snapshot();
        changed.organization_id = 8;
        assert!(decode_layout(
            &context,
            &changed,
            9,
            PersonalPageModule::Sales,
            "dashboard"
        )
        .is_err());
        let mut changed = snapshot();
        changed.owner_identity = spacetimedb_sdk::Identity::from_byte_array([0xcd; 32]);
        assert!(decode_layout(
            &context,
            &changed,
            9,
            PersonalPageModule::Sales,
            "dashboard"
        )
        .is_err());
    }

    #[test]
    fn personal_page_wire_rejects_forged_scope_or_executable_content() {
        assert!(path_scope("settings", "dashboard", "9").is_err());
        assert!(path_scope("sales", "../../settings", "9").is_err());
        assert!(path_scope("sales", "dashboard", "09").is_err());
        assert!(serde_json::from_value::<SavePersonalPageLayoutRequest>(
            json!({"expectedRevision":null,"layout":null,"organizationId":"8"})
        )
        .is_err());
        assert!(crate::commands::session_reducer_contract("save_personal_page_layout").is_err());
        assert!(
            crate::commands::session_operation_contract("erp.save_personal_page_layout").is_err()
        );
    }

    #[tokio::test]
    async fn personal_page_routes_require_authenticated_session() {
        for method in ["GET", "PUT"] {
            let response = super::super::router()
                .layer(tower_cookies::CookieManagerLayer::new())
                .with_state(Arc::new(AppState::new(
                    crate::session::test_support::test_config(None),
                )))
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri("/presentation/pages/sales/dashboard?companyId=9")
                        .header("content-type", "application/json")
                        .body(Body::from(r#"{"expectedRevision":null,"layout":null}"#))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        }
    }
}
