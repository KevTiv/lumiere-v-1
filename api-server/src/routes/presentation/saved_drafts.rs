//! Personal immutable snapshots and explicit save/read HTTP admission.
use super::{catalog, context, limits, session};
use crate::{
    commands::dispatch_presentation_save, error::ApiError, session::normalize_identity_hex_for_sql,
    state::AppState, trusted_context::TrustedOperationContext,
};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use lumiere_presentation_core::{
    validate_module_draft, ModuleDraft, SaveDraftRequest, SavedDraft, SavedDraftList,
    SavedDraftSummary,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use stdb_client::StdbClient;
use tower_cookies::Cookies;

// SQL rows decode through the immutable generated table types, retaining SATS
// identities and integer precision instead of maintaining handwritten DTOs.
use lumiere_contracts::bindings::{
    PresentationModule as DraftHeadRow, PresentationModuleVersion as DraftVersionRow,
};
use spacetimedb_sats::serde::SerdeWrapper;

fn revision_input(value: Option<&str>) -> Result<Option<u64>, ApiError> {
    let Some(value) = value else { return Ok(None) };
    if value.is_empty() || value == "0" || value.starts_with('0') {
        return Err(ApiError::BadRequest(
            "expectedRevision must be a canonical positive decimal string".into(),
        ));
    }
    let revision = value.parse::<u64>().map_err(|_| {
        ApiError::BadRequest("expectedRevision must be a canonical positive decimal string".into())
    })?;
    if revision == 0 || revision.to_string() != value {
        return Err(ApiError::BadRequest(
            "expectedRevision must be a canonical positive decimal string".into(),
        ));
    }
    Ok(Some(revision))
}

fn module_key_path(value: &str) -> Result<&str, ApiError> {
    if value.is_empty()
        || value.len() > 64
        || value.starts_with('-')
        || value.ends_with('-')
        || value.contains("--")
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err(ApiError::BadRequest(
            "invalid presentation module key".into(),
        ));
    }
    Ok(value)
}

fn owner_sql(context: &TrustedOperationContext) -> String {
    format!(
        "organization_id = {} AND owner_identity = 0x{}",
        context.organization_id(),
        normalize_identity_hex_for_sql(context.actor_identity())
    )
}

fn verify_head(context: &TrustedOperationContext, head: &DraftHeadRow) -> Result<(), ApiError> {
    module_key_path(&head.module_key)?;
    if head.scope_key
        != format!(
            "{}:{}:{}",
            head.organization_id,
            head.owner_identity.to_hex(),
            head.module_key
        )
        || head.organization_id != context.organization_id()
        || normalize_identity_hex_for_sql(&head.owner_identity.to_hex().to_string())
            != normalize_identity_hex_for_sql(context.actor_identity())
        || head.id == 0
        || head.current_revision == 0
    {
        return Err(ApiError::Internal(
            "saved presentation head scope or revision mismatch".into(),
        ));
    }
    Ok(())
}

async fn read_versions(
    client: &StdbClient,
    context: &TrustedOperationContext,
    selectors: &[(u64, u64)],
) -> Result<Vec<DraftVersionRow>, ApiError> {
    if selectors.is_empty() {
        return Ok(Vec::new());
    }
    if selectors.len() > 100 {
        return Err(ApiError::Internal(
            "invalid presentation version selector count".into(),
        ));
    }
    let selector_sql = selectors
        .iter()
        .map(|(module_id, revision)| format!("(module_id = {module_id} AND revision = {revision})"))
        .collect::<Vec<_>>()
        .join(" OR ");
    let sql = format!(
        "SELECT * FROM presentation_module_version WHERE {} AND ({selector_sql}) LIMIT 101",
        owner_sql(context)
    );
    let rows = client
        .query_sql_sats(&sql)
        .await
        .map_err(ApiError::internal)?;
    if rows.len() > selectors.len() {
        return Err(ApiError::Internal(
            "duplicate presentation snapshots".into(),
        ));
    }
    let rows: Vec<DraftVersionRow> = rows
        .into_iter()
        .map(|row| {
            serde_json::from_value::<SerdeWrapper<DraftVersionRow>>(row)
                .map(|row| row.0)
                .map_err(ApiError::internal)
        })
        .collect::<Result<_, _>>()?;
    let mut seen = std::collections::HashSet::new();
    for row in &rows {
        if !selectors.contains(&(row.module_id, row.revision))
            || !seen.insert((row.module_id, row.revision))
        {
            return Err(ApiError::Internal(
                "unexpected presentation snapshot selector".into(),
            ));
        }
    }
    Ok(rows)
}

fn decode_saved_draft(
    context: &TrustedOperationContext,
    row: &DraftVersionRow,
) -> Result<SavedDraft, ApiError> {
    if row.definition_json.len() > 64 * 1024 || row.id == 0 || row.module_id == 0 {
        return Err(ApiError::Internal(
            "invalid presentation snapshot bounds".into(),
        ));
    }
    let mut definition: ModuleDraft =
        serde_json::from_str(&row.definition_json).map_err(|error| ApiError::internal(error))?;
    let computed_hash = hex::encode(Sha256::digest(row.definition_json.as_bytes()));
    let canonical = lumiere_presentation_core::prepare_saved_draft(&row.definition_json, None)
        .map_err(|error| {
            ApiError::Internal(format!("stored presentation draft is invalid: {error}"))
        })?;
    if row.created_by != row.owner_identity
        || row.organization_id != context.organization_id()
        || normalize_identity_hex_for_sql(&row.owner_identity.to_hex().to_string())
            != normalize_identity_hex_for_sql(context.actor_identity())
        || row.definition_json.len() > 64 * 1024
        || definition.base_revision.is_some()
        || canonical.definition_json != row.definition_json
        || computed_hash != row.definition_hash
        || row.module_key != definition.module_id
        || row.revision == 0
        || row.definition_hash.len() != 64
        || !row
            .definition_hash
            .chars()
            .all(|character| character.is_ascii_hexdigit())
        || row.schema_version != definition.schema_version
        || row.application_contract != definition.application_contract
        || row.component_catalog_version != definition.component_catalog_version
    {
        return Err(ApiError::Internal(
            "saved presentation draft row scope or metadata mismatch".into(),
        ));
    }
    definition.base_revision = Some(row.revision.to_string());
    let catalog = catalog(context)?;
    validate_module_draft(&definition, &catalog, &limits()).map_err(|diagnostics| {
        ApiError::Unprocessable(
            serde_json::to_string(&diagnostics).unwrap_or_else(|_| "invalid saved draft".into()),
        )
    })?;
    Ok(SavedDraft {
        module_key: row.module_key.clone(),
        revision: row.revision.to_string(),
        definition_hash: row.definition_hash.clone(),
        definition,
    })
}

pub(super) async fn list_drafts(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
) -> Result<Json<SavedDraftList>, ApiError> {
    let context = context(&state, &headers, &cookies).await?;
    let heads_sql = format!(
        "SELECT * FROM presentation_module WHERE {} LIMIT 101",
        owner_sql(&context)
    );
    let heads = state
        .stdb
        .query_sql_sats(&heads_sql)
        .await
        .map_err(ApiError::internal)?;
    if heads.len() > 100 {
        return Err(ApiError::Internal(
            "presentation head limit exceeded".into(),
        ));
    }
    let heads: Vec<DraftHeadRow> = heads
        .into_iter()
        .map(|row| {
            serde_json::from_value::<SerdeWrapper<DraftHeadRow>>(row)
                .map(|row| row.0)
                .map_err(ApiError::internal)
        })
        .collect::<Result<_, _>>()?;
    let mut keys = std::collections::HashSet::new();
    for head in &heads {
        verify_head(&context, head)?;
        if !keys.insert(&head.module_key) {
            return Err(ApiError::Internal("duplicate personal module head".into()));
        }
    }
    let selectors: Vec<_> = heads
        .iter()
        .map(|head| (head.id, head.current_revision))
        .collect();
    let versions = read_versions(&state.stdb, &context, &selectors).await?;
    let mut drafts = Vec::with_capacity(heads.len());
    for head in heads {
        if let Some(version) = versions.iter().find(|row| {
            row.module_id == head.id
                && row.revision == head.current_revision
                && row.module_key == head.module_key
        }) {
            let saved = decode_saved_draft(&context, version)?;
            drafts.push(SavedDraftSummary {
                module_key: saved.module_key,
                title: saved.definition.title,
                revision: head.current_revision.to_string(),
            });
        } else {
            return Err(ApiError::Internal(
                "presentation head snapshot is missing".into(),
            ));
        }
    }
    drafts.sort_by(|a, b| a.module_key.cmp(&b.module_key));
    context.require_current_placement(&state.organization_placements)?;
    Ok(Json(SavedDraftList { drafts }))
}

pub(super) async fn get_draft(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(module_key): Path<String>,
) -> Result<Json<SavedDraft>, ApiError> {
    let module_key = module_key_path(&module_key)?;
    let context = context(&state, &headers, &cookies).await?;
    let head_sql = format!(
        "SELECT * FROM presentation_module WHERE {} AND module_key = '{module_key}' LIMIT 1",
        owner_sql(&context)
    );
    let head = state
        .stdb
        .query_sql_sats(&head_sql)
        .await
        .map_err(ApiError::internal)?
        .into_iter()
        .next()
        .map(|row| {
            serde_json::from_value::<SerdeWrapper<DraftHeadRow>>(row)
                .map(|row| row.0)
                .map_err(ApiError::internal)
        })
        .transpose()?
        .ok_or_else(|| ApiError::NotFound("presentation draft not found".into()))?;
    verify_head(&context, &head)?;
    if head.module_key != module_key {
        return Err(ApiError::Internal("presentation head key mismatch".into()));
    }
    let rows = read_versions(&state.stdb, &context, &[(head.id, head.current_revision)]).await?;
    let row = rows
        .into_iter()
        .find(|row| {
            row.module_id == head.id
                && row.revision == head.current_revision
                && row.module_key == head.module_key
        })
        .ok_or_else(|| ApiError::NotFound("presentation draft not found".into()))?;
    context.require_current_placement(&state.organization_placements)?;
    Ok(Json(decode_saved_draft(&context, &row)?))
}

pub(super) async fn save_draft(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(request): Json<SaveDraftRequest>,
) -> Result<Json<SavedDraft>, ApiError> {
    let session = session(&state, &headers, &cookies).await?;
    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    context.require_current_placement(&state.organization_placements)?;
    let expected = revision_input(request.expected_revision.as_deref())?;
    if request.definition.base_revision.as_deref() != request.expected_revision.as_deref() {
        return Err(ApiError::BadRequest(
            "definition.baseRevision must equal expectedRevision".into(),
        ));
    }
    let catalog = catalog(&context)?;
    validate_module_draft(&request.definition, &catalog, &limits()).map_err(|diagnostics| {
        ApiError::Unprocessable(
            serde_json::to_string(&diagnostics)
                .unwrap_or_else(|_| "invalid module definition".into()),
        )
    })?;
    let module_key = module_key_path(&request.definition.module_id)?.to_string();
    let definition_json = serde_json::to_string(&request.definition).map_err(ApiError::internal)?;
    let args = json!([context.organization_id(), expected, definition_json]);
    if let Err(error) = dispatch_presentation_save(&state, &session, args).await {
        if matches!(&error, ApiError::Unprocessable(message) if ["stale presentation module revision", "expected revision is required when updating a presentation module", "presentation module does not exist"].iter().any(|text| message.contains(text)))
        {
            return Err(ApiError::Conflict(
                "presentation draft revision conflict".into(),
            ));
        }
        return Err(error);
    }
    let next_revision = expected
        .unwrap_or(0)
        .checked_add(1)
        .ok_or_else(|| ApiError::Conflict("presentation revision exhausted".into()))?;
    let head_sql = format!(
        "SELECT * FROM presentation_module WHERE {} AND module_key = '{module_key}' LIMIT 1",
        owner_sql(&context)
    );
    let head: DraftHeadRow = state
        .stdb
        .query_sql_sats(&head_sql)
        .await
        .map_err(ApiError::internal)?
        .into_iter()
        .next()
        .ok_or_else(|| ApiError::Internal("saved presentation module head was not readable".into()))
        .and_then(|row| {
            serde_json::from_value::<SerdeWrapper<DraftHeadRow>>(row)
                .map(|row| row.0)
                .map_err(ApiError::internal)
        })?;
    verify_head(&context, &head)?;
    if head.module_key != module_key {
        return Err(ApiError::Internal("presentation head key mismatch".into()));
    }
    let rows = read_versions(&state.stdb, &context, &[(head.id, next_revision)]).await?;
    let row = rows
        .into_iter()
        .find(|row| {
            row.module_id == head.id
                && row.revision == next_revision
                && row.module_key == module_key
        })
        .ok_or_else(|| ApiError::Internal("saved presentation draft was not readable".into()))?;
    context.require_current_placement(&state.organization_placements)?;
    Ok(Json(decode_saved_draft(&context, &row)?))
}

#[cfg(test)]
mod draft_tests {
    use super::*;
    use crate::session::ApiSession;
    use crate::{session::test_support::test_config, state::AppState};
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use std::sync::Arc;
    use tower::ServiceExt;

    fn test_context() -> TrustedOperationContext {
        let session = ApiSession {
            stdb_token: "session-token".into(),
            identity_hex: "ab".repeat(32),
            organization_id: Some(7),
            field_access: Some(stdb_auth::FieldAccessContext {
                organization_id: 7,
                role_id: 1,
                role_name: "reader".into(),
                is_superuser: false,
                role_permissions: vec!["account-moves:read".into()],
                identity_hex: "ab".repeat(32),
                field_permissions: vec![],
            }),
        };
        TrustedOperationContext::from_session(
            &session,
            StdbClient::new(
                "http://127.0.0.1:1".into(),
                "test".into(),
                session.stdb_token.clone(),
            ),
            crate::trusted_context::RESOURCE_QUERY_OPERATION_ID,
        )
        .unwrap()
    }

    fn snapshot() -> DraftVersionRow {
        let definition = json!({"schemaVersion":1,"componentCatalogVersion":1,"applicationContract":"v0.3.43",
            "moduleId":"sample","title":"Sample","baseRevision":null,
            "pages":[{"id":"entries","title":"Entries","nodes":[{"kind":"collection","id":"entries",
                "slot":"primary","component":{"id":"erp.collection","version":1},"resource":"account-moves","fields":["name"],"pageSize":25}]}]});
        let prepared =
            lumiere_presentation_core::prepare_saved_draft(&definition.to_string(), None).unwrap();
        let owner = spacetimedb_sdk::Identity::from_byte_array([0xab; 32]);
        DraftVersionRow {
            id: 9,
            organization_id: 7,
            owner_identity: owner,
            module_id: 3,
            module_key: "sample".into(),
            revision: 1,
            definition_hash: hex::encode(Sha256::digest(prepared.definition_json.as_bytes())),
            definition_json: prepared.definition_json,
            schema_version: 1,
            application_contract: "v0.3.43".into(),
            component_catalog_version: 1,
            created_at: spacetimedb_sdk::Timestamp::from_micros_since_unix_epoch(1),
            created_by: owner,
        }
    }

    #[test]
    fn saved_snapshot_decodes_generated_sats_and_restores_edit_revision() {
        let row = snapshot();
        let value = serde_json::to_value(SerdeWrapper::from_ref(&row)).unwrap();
        let decoded: SerdeWrapper<DraftVersionRow> = serde_json::from_value(value).unwrap();
        let saved = decode_saved_draft(&test_context(), &decoded.0).unwrap();
        assert_eq!(saved.definition.base_revision.as_deref(), Some("1"));
        assert_eq!(saved.definition.pages.len(), 1);
        assert_eq!(saved.definition_hash, row.definition_hash);
        assert!(row.definition_json.contains("\"baseRevision\":null"));
    }

    #[test]
    fn saved_snapshot_rejects_corruption_scope_and_provenance_mismatch() {
        let context = test_context();
        let original = snapshot();
        let mut changed = original.clone();
        changed.definition_json = changed.definition_json.replace("Sample", "Corrupt");
        assert!(decode_saved_draft(&context, &changed).is_err());
        let mut changed = original.clone();
        changed.definition_hash = "0".repeat(64);
        assert!(decode_saved_draft(&context, &changed).is_err());
        let mut changed = original.clone();
        changed.organization_id = 8;
        assert!(decode_saved_draft(&context, &changed).is_err());
        let mut changed = original.clone();
        changed.owner_identity = spacetimedb_sdk::Identity::from_byte_array([0xcd; 32]);
        assert!(decode_saved_draft(&context, &changed).is_err());
        let mut changed = original.clone();
        changed.application_contract = "v0.3.40".into();
        assert!(decode_saved_draft(&context, &changed).is_err());
        let mut changed = original.clone();
        changed.created_by = spacetimedb_sdk::Identity::from_byte_array([0xcd; 32]);
        assert!(decode_saved_draft(&context, &changed).is_err());
        let mut changed = original;
        changed.module_key = "other".into();
        assert!(decode_saved_draft(&context, &changed).is_err());
    }

    #[tokio::test]
    async fn empty_personal_list_does_not_query_snapshots() {
        let context = test_context();
        assert!(read_versions(context.client(), &context, &[])
            .await
            .unwrap()
            .is_empty());
    }

    #[test]
    fn presentation_save_remains_denied_to_generic_operations() {
        assert!(crate::commands::session_reducer_contract("save_presentation_module").is_err());
        assert!(
            crate::commands::session_operation_contract("erp.save_presentation_module").is_err()
        );
    }

    #[test]
    fn revision_boundary_requires_canonical_positive_decimal() {
        assert_eq!(revision_input(None).unwrap(), None);
        assert_eq!(revision_input(Some("1")).unwrap(), Some(1));
        for value in ["", "0", "01", "+1", "1.0", "18446744073709551616"] {
            assert!(revision_input(Some(value)).is_err(), "accepted {value:?}");
        }
    }

    #[test]
    fn module_key_boundary_matches_definition_slug() {
        for value in ["collections", "account-moves-v1", "a1"] {
            assert_eq!(module_key_path(value).unwrap(), value);
        }
        for value in [
            "",
            "-collections",
            "collections-",
            "collections--v1",
            "Collections",
            "collections_v1",
        ] {
            assert!(module_key_path(value).is_err(), "accepted {value:?}");
        }
    }

    #[tokio::test]
    async fn drafts_http_route_requires_authenticated_session() {
        let state = Arc::new(AppState::new(test_config(None)));
        let response = super::super::router()
            .layer(tower_cookies::CookieManagerLayer::new())
            .with_state(state)
            .oneshot(
                Request::builder()
                    .uri("/presentation/drafts")
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("route response");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
}
