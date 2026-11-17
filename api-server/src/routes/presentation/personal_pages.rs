//! Authenticated personal page layouts backed by immutable native snapshots.

use std::{collections::HashSet, sync::Arc};

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use lumiere_contracts::bindings::{DashboardWidget, PresentationModule, PresentationModuleVersion};
use lumiere_presentation_core::{
    personal_page_decimal, personal_page_key, personal_page_widget_source_resource,
    prepare_personal_page_layout, PersonalPageLayoutResponse, PersonalPageModule,
    PersonalPageWidgetSource, SavePersonalPageLayoutRequest, StoredPersonalPageLayout,
    MAX_PERSONAL_PAGE_BYTES, PERSONAL_PAGE_CONTRACT,
};
use serde::{Deserialize, Serialize};
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
    cold_tier::pg_pool,
    commands::{authorize_reducer_company_scope, dispatch_personal_page_layout_save},
    error::ApiError,
    session::{load_field_access_context, normalize_identity_hex_for_sql, ApiSession},
    state::AppState,
    trusted_context::TrustedOperationContext,
    web_session::OrgSession,
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

async fn readable_receipt_widgets(
    state: &AppState,
    organization_id: u64,
    company_id: u64,
    access: &FieldAccessContext,
    widget_ids: &HashSet<u64>,
) -> Result<HashSet<u64>, ApiError> {
    if widget_ids.is_empty() || !permission_allowed(access, "dashboard_widget", "read") {
        return Ok(HashSet::new());
    }
    let selector = widget_ids
        .iter()
        .map(|id| format!("id = {id}"))
        .collect::<Vec<_>>()
        .join(" OR ");
    // Exclude widget definitions and queries before the owner-token read.
    let sql = format!(
        "SELECT id,organization_id,company_id,model,is_active FROM dashboard_widget
        WHERE organization_id = {organization_id} AND ({selector}) LIMIT {}",
        widget_ids.len()
    );
    let rows = state
        .stdb
        .with_query_limits(widget_ids.len(), 128 * 1024)
        .map_err(ApiError::internal)?
        .query_sql(&sql)
        .await
        .map_err(ApiError::internal)?;
    let mut readable = HashSet::new();
    for row in rows {
        let field = |camel: &str, snake: &str| row.get(camel).or_else(|| row.get(snake));
        let number =
            |value: &serde_json::Value| value.as_u64().or_else(|| value.as_str()?.parse().ok());
        let Some(id) = field("id", "id").and_then(number) else {
            continue;
        };
        let Some(model) = field("model", "model").and_then(serde_json::Value::as_str) else {
            continue;
        };
        if field("organizationId", "organization_id").and_then(number) == Some(organization_id)
            && field("companyId", "company_id")
                .is_some_and(|value| value.is_null() || number(value) == Some(company_id))
            && field("isActive", "is_active").and_then(serde_json::Value::as_bool) == Some(true)
            && widget_ids.contains(&id)
            && permission_allowed(access, &personal_page_widget_source_resource(model), "read")
        {
            readable.insert(id);
        }
    }
    Ok(readable)
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AssistantWidgetReceiptInput {
    company_id: String,
    session_key: String,
    message_id: String,
    request_id: String,
    module_id: String,
    page_id: String,
    widget_id: String,
    layout_revision: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AssistantWidgetReceiptQuery {
    company_id: String,
    session_key: String,
    message_ids: String,
}

#[derive(Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AssistantWidgetReceipt {
    session_key: String,
    message_id: String,
    request_id: String,
    module_id: String,
    page_id: String,
    widget_id: String,
    layout_revision: String,
}

const RECEIPT_COLUMNS: &str = "session_key,message_id::text,request_id,module_id,page_id,widget_id::text,layout_revision::text";

fn receipt(row: &tokio_postgres::Row) -> AssistantWidgetReceipt {
    AssistantWidgetReceipt {
        session_key: row.get("session_key"),
        message_id: row.get("message_id"),
        request_id: row.get("request_id"),
        module_id: row.get("module_id"),
        page_id: row.get("page_id"),
        widget_id: row.get("widget_id"),
        layout_revision: row.get("layout_revision"),
    }
}

fn validate_request_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
            }
        })
}

fn proposed_assistant_widget(message: &serde_json::Value, module: &str, page: &str) -> bool {
    let metadata = message["metadata"]
        .as_str()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok());
    message["role"] == "assistant"
        && metadata
            .as_ref()
            .and_then(|value| value["nativeActions"].as_array())
            .is_some_and(|actions| {
                actions.iter().any(|action| {
                    action["version"] == 1
                        && action["kind"] == "add_widget"
                        && action["capabilityKey"] == format!("{module}.widget.add")
                        && action.get("widgetKey").is_none()
                        && action["pageId"].as_str().unwrap_or("dashboard") == page
                })
            })
}

pub(super) async fn save_assistant_widget_receipt(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Json(input): Json<AssistantWidgetReceiptInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let (module, company, key) = path_scope(&input.module_id, &input.page_id, &input.company_id)?;
    let widget = personal_page_decimal(&input.widget_id).map_err(ApiError::BadRequest)?;
    let revision = personal_page_decimal(&input.layout_revision).map_err(ApiError::BadRequest)?;
    personal_page_decimal(&input.message_id).map_err(ApiError::BadRequest)?;
    if !validate_request_id(&input.request_id) || !stdb_client::valid_chat_key(&input.session_key) {
        return Err(ApiError::BadRequest(
            "Invalid Assistant widget origin".into(),
        ));
    }
    let context = page_context(&state, &session, company, module).await?;
    let history =
        crate::routes::assistant_chat_references::scope(&state, &session, company).await?;
    crate::routes::assistant_chat_references::owned_session(
        &state,
        &history,
        company,
        &input.session_key,
    )
    .await?;
    let message = crate::routes::assistant_chat_references::owned_message(
        &state,
        &history,
        company,
        &input.session_key,
        &input.message_id,
    )
    .await?;
    if !proposed_assistant_widget(&message, &input.module_id, &input.page_id) {
        return Err(ApiError::NotFound(
            "Assistant widget origin is unavailable".into(),
        ));
    }
    let head = read_head(&state, &context, &key)
        .await?
        .filter(|head| revision <= head.current_revision)
        .ok_or_else(|| ApiError::NotFound("Saved page revision is unavailable".into()))?;
    let saved = read_revision(
        &state,
        &context,
        &head,
        revision,
        company,
        module,
        &input.page_id,
    )
    .await?;
    let placement_id = format!("assistant-{}", input.request_id);
    if !saved.layout.is_some_and(|layout| {
        layout.widgets.iter().any(|placement| {
            placement.id == placement_id
                && placement.source == PersonalPageWidgetSource::Saved
                && placement.widget_id == input.widget_id
        })
    }) {
        return Err(ApiError::NotFound(
            "Assistant widget placement is unavailable".into(),
        ));
    }
    // A retry verifies the same immutable revision and the actor's current widget access.
    authorize_saved_widgets(&state, &context, company, &[widget]).await?;
    context.require_current_placement(&state.organization_placements)?;
    let org = context.organization_id().to_string();
    let actor = context.actor_identity();
    let expected = AssistantWidgetReceipt {
        session_key: input.session_key,
        message_id: input.message_id,
        request_id: input.request_id,
        module_id: input.module_id,
        page_id: input.page_id,
        widget_id: input.widget_id,
        layout_revision: input.layout_revision,
    };
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let client = pool.get().await.map_err(ApiError::internal)?;
    client.execute(
        "INSERT INTO lumiere_platform.assistant_widget_receipt
         (organization_id,company_id,actor_identity,session_key,message_id,request_id,module_id,page_id,widget_id,layout_revision)
         VALUES ($1::text::numeric,$2::text::numeric,$3,$4,$5::text::numeric,$6,$7,$8,$9::text::numeric,$10::text::numeric)
         ON CONFLICT DO NOTHING",
        &[&org,&input.company_id,&actor,&expected.session_key,&expected.message_id,&expected.request_id,
          &expected.module_id,&expected.page_id,&expected.widget_id,&expected.layout_revision],
    ).await.map_err(ApiError::internal)?;
    let row = client.query_one(&format!(
        "SELECT {RECEIPT_COLUMNS} FROM lumiere_platform.assistant_widget_receipt
         WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4"
    ), &[&org,&input.company_id,&actor,&expected.request_id]).await.map_err(ApiError::internal)?;
    let stored = receipt(&row);
    if stored != expected {
        return Err(ApiError::Conflict(
            "Assistant widget receipt was already used".into(),
        ));
    }
    Ok(Json(json!(stored)))
}

pub(super) async fn list_assistant_widget_receipts(
    State(state): State<Arc<AppState>>,
    Query(query): Query<AssistantWidgetReceiptQuery>,
    OrgSession { session, .. }: OrgSession,
) -> Result<Json<serde_json::Value>, ApiError> {
    let company = personal_page_decimal(&query.company_id).map_err(ApiError::BadRequest)?;
    let messages: Vec<&str> = query.message_ids.split(',').collect();
    if !stdb_client::valid_chat_key(&query.session_key)
        || messages.len() > 90
        || messages.iter().any(|id| personal_page_decimal(id).is_err())
    {
        return Err(ApiError::BadRequest(
            "Invalid Assistant widget receipt lookup".into(),
        ));
    }
    let context =
        crate::routes::assistant_chat_references::scope(&state, &session, company).await?;
    crate::routes::assistant_chat_references::owned_session(
        &state,
        &context,
        company,
        &query.session_key,
    )
    .await?;
    let org = context.organization_id().to_string();
    let actor = context.actor_identity();
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let client = pool.get().await.map_err(ApiError::internal)?;
    let rows = client.query(&format!(
        "SELECT {RECEIPT_COLUMNS} FROM lumiere_platform.assistant_widget_receipt
         WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3
           AND session_key=$4 AND message_id=ANY($5::text[]::numeric[])
         ORDER BY created_at DESC LIMIT 90"
    ), &[&org,&query.company_id,&actor,&query.session_key,&messages]).await.map_err(ApiError::internal)?;
    crate::routes::assistant_chat_references::recheck_scope(&state, &context, company, false)
        .await?;
    let current = load_field_access_context(&state.stdb, actor, context.organization_id())
        .await
        .map_err(ApiError::Internal)?
        .ok_or(ApiError::Unauthorized)?;
    let mut data = rows
        .iter()
        .map(receipt)
        .filter(|row| {
            row.module_id
                .parse::<PersonalPageModule>()
                .is_ok_and(|module| require_page_read(&current, module).is_ok())
        })
        .collect::<Vec<_>>();
    let ids = data
        .iter()
        .filter_map(|row| personal_page_decimal(&row.widget_id).ok())
        .collect();
    let readable =
        readable_receipt_widgets(&state, context.organization_id(), company, &current, &ids)
            .await?;
    data.retain(|row| personal_page_decimal(&row.widget_id).is_ok_and(|id| readable.contains(&id)));
    context.require_current_placement(&state.organization_placements)?;
    Ok(Json(json!({"data": data})))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    #[test]
    fn assistant_widget_receipts_require_the_exact_unresolved_proposal() {
        let candidate = json!({
            "version":1,"kind":"add_widget","capabilityKey":"sales.widget.add","pageId":"dashboard"
        });
        let message = |role: &str, action: serde_json::Value| {
            json!({
                "role":role,"metadata":json!({"nativeActions":[action]}).to_string()
            })
        };
        assert!(proposed_assistant_widget(
            &message("assistant", candidate.clone()),
            "sales",
            "dashboard"
        ));
        assert!(!proposed_assistant_widget(
            &message("user", candidate.clone()),
            "sales",
            "dashboard"
        ));
        assert!(!proposed_assistant_widget(
            &message("assistant", candidate.clone()),
            "warehouse",
            "dashboard"
        ));
        assert!(!proposed_assistant_widget(
            &message("assistant", candidate.clone()),
            "sales",
            "orders"
        ));
        let mut existing = candidate;
        existing["widgetKey"] = json!("saved:42");
        assert!(!proposed_assistant_widget(
            &message("assistant", existing),
            "sales",
            "dashboard"
        ));
    }

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
