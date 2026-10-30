//! Authenticated assistant guide storage and exact-revision reads.
//! Private rows are read with the owner client only after current session,
//! company, resource permission, and article membership checks.

use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use stdb_auth::{has_resource_read_permission, identity_sql_literal, FieldAccessContext};

use crate::{
    commands::dispatch_session_reducer, error::ApiError, query_exec::resolve_membership_company_id,
    state::AppState, trusted_context::TrustedOperationContext, web_session::OrgSession,
};

const HEAD_COLUMNS: &str =
    "id, organization_id, company_id, module, workflow, latest_revision, review_state";
const REVISION_COLUMNS: &str = "id, organization_id, company_id, guide_id, revision, title, markdown, html, language, workflow_version, draft_key, sources_json, origin_message_id, origin_run_id, content_hash, request_key, create_uid, create_date";
mod review;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/knowledge/guides", get(search).post(save))
        .route("/knowledge/guides/:id", get(read))
        .route("/knowledge/guides/:id/history", get(history))
        .route(
            "/knowledge/guides/:id/verification",
            axum::routing::post(review::nominate),
        )
        .route(
            "/knowledge/guides/:id/reviews",
            axum::routing::post(review::record_review),
        )
        .layer(axum::middleware::map_response(
            |mut response: axum::response::Response| async move {
                response.headers_mut().insert(
                    axum::http::header::CACHE_CONTROL,
                    axum::http::HeaderValue::from_static("private, no-store"),
                );
                response
            },
        ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadQuery {
    company_id: u64,
    revision: Option<u32>,
    module: Option<String>,
    query: Option<String>,
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveRequest {
    company_id: String,
    guide_id: Option<String>,
    expected_revision: Option<u32>,
    request_key: String,
    draft_key: String,
    title: String,
    module: String,
    workflow: Option<String>,
    markdown: String,
    html: Option<String>,
    #[serde(default = "default_language")]
    language: String,
    workflow_version: Option<String>,
    #[serde(default)]
    sources: Vec<Value>,
    origin_message_id: Option<String>,
    run_id: Option<String>,
}

fn default_language() -> String {
    "en".into()
}
fn field<'a>(row: &'a Value, key: &str) -> &'a Value {
    row.get(key)
        .or_else(|| row.get(stdb_client::sql_column_json_key(key)))
        .unwrap_or(&Value::Null)
}
fn u64_value(row: &Value, key: &str) -> Option<u64> {
    let value = field(row, key);
    value.as_u64().or_else(|| value.as_str()?.parse().ok())
}
fn string<'a>(row: &'a Value, key: &str) -> Option<&'a str> {
    field(row, key).as_str()
}
fn positive_id(value: &str) -> Result<u64, ApiError> {
    value
        .parse::<u64>()
        .ok()
        .filter(|id| *id > 0)
        .ok_or_else(|| ApiError::BadRequest("invalid guide identity".into()))
}
fn valid_slug(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 120
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.' | b':'))
}
fn identity_matches(value: &Value, actor: &str) -> bool {
    // Identity values nested in a SATS Vec are singleton products, whereas
    // top-level identity columns are already decoded by StdbClient.
    let value = value.as_str().or_else(|| {
        value
            .as_array()
            .filter(|items| items.len() == 1)?
            .first()?
            .as_str()
    });
    let Some(identity) = value.and_then(|identity| identity_sql_literal(identity).ok()) else {
        return false;
    };
    identity_sql_literal(actor).is_ok_and(|actor| actor == identity)
}
fn is_member(article: &Value, actor: &str) -> bool {
    article
        .get("member_ids")
        .or_else(|| article.get("memberIds"))
        .and_then(Value::as_array)
        .is_some_and(|members| members.iter().any(|v| identity_matches(v, actor)))
}
fn can_write(access: &FieldAccessContext) -> bool {
    stdb_auth::permission_allowed(access, "knowledge-articles", "write")
}

async fn context(
    state: &AppState,
    session: &crate::session::ApiSession,
    company: u64,
) -> Result<TrustedOperationContext, ApiError> {
    let ctx = TrustedOperationContext::for_resource_read(state, session)?;
    ctx.require_current_placement(&state.organization_placements)?;
    if !has_resource_read_permission(Some(ctx.field_access()), "knowledge-articles")
        || !guide_content_allowed(ctx.field_access())
    {
        return Err(ApiError::Forbidden("guide read permission denied".into()));
    }
    let company = resolve_membership_company_id(
        &state.stdb,
        ctx.organization_id(),
        ctx.actor_identity(),
        Some(company),
        "guide company scope mismatch",
    )
    .await?;
    ctx.with_company_scope(vec![company])
}

fn guide_content_allowed(access: &FieldAccessContext) -> bool {
    // Markdown, derivative HTML, and attached source references are one
    // knowledge-article content payload. An explicit body restriction must
    // cover all of them on this dedicated private-table route.
    ["name", "body"].iter().all(|field| {
        stdb_auth::has_resource_field_read_permission(Some(access), "knowledge-articles", field)
    })
}

async fn article(
    state: &AppState,
    ctx: &TrustedOperationContext,
    id: u64,
) -> Result<Value, ApiError> {
    let org = ctx.organization_id();
    let rows = state.stdb.query_sql(&format!("SELECT id, organization_id, member_ids, is_locked, lock_by FROM knowledge_article WHERE organization_id = {org} AND id = {id} LIMIT 1"))
        .await.map_err(ApiError::internal)?;
    let row = rows
        .into_iter()
        .next()
        .ok_or_else(|| ApiError::NotFound("guide not found".into()))?;
    if !is_member(&row, ctx.actor_identity()) {
        return Err(ApiError::NotFound("guide not found".into()));
    }
    Ok(row)
}

async fn head(
    state: &AppState,
    ctx: &TrustedOperationContext,
    company: u64,
    id: u64,
) -> Result<Value, ApiError> {
    let org = ctx.organization_id();
    let rows = state.stdb.query_sql(&format!("SELECT {HEAD_COLUMNS} FROM knowledge_guide WHERE organization_id = {org} AND company_id = {company} AND id = {id} LIMIT 1"))
        .await.map_err(ApiError::internal)?;
    let row = rows
        .into_iter()
        .next()
        .ok_or_else(|| ApiError::NotFound("guide not found".into()))?;
    article(state, ctx, id).await?;
    Ok(row)
}

fn project(head: &Value, revision: &Value, writable: bool) -> Result<Value, ApiError> {
    let id =
        u64_value(head, "id").ok_or_else(|| ApiError::Internal("invalid guide head".into()))?;
    let mut sources: Value = serde_json::from_str(string(revision, "sources_json").unwrap_or("[]"))
        .map_err(ApiError::internal)?;
    if !sources.is_array() {
        sources = json!([]);
    }
    let latest = u64_value(head, "latest_revision");
    let version = u64_value(revision, "revision");
    Ok(json!({
        "id": id.to_string(), "guideId": id.to_string(),
        "organizationId": u64_value(head,"organization_id").map(|id| id.to_string()),
        "companyId": u64_value(head,"company_id").map(|id| id.to_string()),
        "revision": version, "headRevision": latest,
        "title": field(revision,"title"), "markdown": field(revision,"markdown"), "html": field(revision,"html"),
        "module": field(head,"module"), "workflow": field(head,"workflow"),
        "language": field(revision,"language"), "workflowVersion": field(revision,"workflow_version"),
        // Workflow metadata supplied while saving is not a product compatibility authority.
        "productVersion": Value::Null, "compatibility": "unknown", "draftKey": field(revision,"draft_key"),
        "sources": sources, "originMessageId": field(revision,"origin_message_id"), "runId": field(revision,"origin_run_id"),
        "contentHash": field(revision,"content_hash"), "updatedAt": timestamp(field(revision,"create_date")),
        "reviewState": if version != latest { "superseded" } else { string(head, "review_state").unwrap_or("draft") },
        "canWrite": writable, "provenance": "user_saved"
    }))
}

fn timestamp(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        if chrono::DateTime::parse_from_rfc3339(text).is_ok() {
            return Some(text.to_string());
        }
    }
    let micros = value
        .get("microsSinceUnixEpoch")
        .and_then(Value::as_i64)
        .or_else(|| value.as_i64());
    micros
        .and_then(chrono::DateTime::<chrono::Utc>::from_timestamp_micros)
        .map(|time| time.to_rfc3339())
}

async fn revision(
    state: &AppState,
    ctx: &TrustedOperationContext,
    company: u64,
    head: &Value,
    requested: Option<u32>,
) -> Result<Value, ApiError> {
    let id =
        u64_value(head, "id").ok_or_else(|| ApiError::Internal("invalid guide identity".into()))?;
    article(state, ctx, id).await?;
    let version = requested
        .map(u64::from)
        .or_else(|| u64_value(head, "latest_revision"))
        .filter(|v| *v > 0)
        .ok_or_else(|| ApiError::BadRequest("invalid guide revision".into()))?;
    let org = ctx.organization_id();
    let rows = state.stdb.query_sql(&format!("SELECT {REVISION_COLUMNS} FROM knowledge_guide_revision WHERE organization_id = {org} AND company_id = {company} AND guide_id = {id} AND revision = {version} LIMIT 1"))
        .await.map_err(ApiError::internal)?;
    let rev = rows
        .into_iter()
        .next()
        .ok_or_else(|| ApiError::NotFound("guide revision not found".into()))?;
    // Recheck live membership after body fetch and before returning a projection.
    let current_head = self::head(state, ctx, company, id).await?;
    ctx.require_current_placement(&state.organization_placements)?;
    let mut guide = project(&current_head, &rev, can_write(ctx.field_access()))?;
    let evidence = review::evidence(state, ctx, company, &current_head, &rev).await?;
    let final_head = self::head(state, ctx, company, id).await?;
    resolve_membership_company_id(
        &state.stdb,
        ctx.organization_id(),
        ctx.actor_identity(),
        Some(company),
        "guide membership changed",
    )
    .await?;
    ctx.require_current_placement(&state.organization_placements)?;
    guide["headRevision"] = field(&final_head, "latest_revision").clone();
    guide["reviewEvidence"] = evidence;
    // An approved record without complete current independent reviews never becomes verified.
    guide["reviewState"] = if version != u64_value(&final_head, "latest_revision").unwrap_or(0) {
        json!("superseded")
    } else if guide["reviewEvidence"]["verified"] == true {
        json!("verified")
    } else if guide["reviewEvidence"]["state"] == "needs_review" {
        json!("needs_review")
    } else {
        json!("draft")
    };
    Ok(guide)
}

async fn read(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(q): Query<ReadQuery>,
    OrgSession { session, .. }: OrgSession,
) -> Result<Json<Value>, ApiError> {
    let ctx = context(&state, &session, q.company_id).await?;
    let head = head(&state, &ctx, q.company_id, positive_id(&id)?).await?;
    let guide = revision(&state, &ctx, q.company_id, &head, q.revision).await?;
    resolve_membership_company_id(
        &state.stdb,
        ctx.organization_id(),
        ctx.actor_identity(),
        Some(q.company_id),
        "guide membership changed",
    )
    .await?;
    Ok(Json(json!({"schemaVersion":1,"guide":guide})))
}

async fn search(
    State(state): State<Arc<AppState>>,
    Query(q): Query<ReadQuery>,
    OrgSession { session, .. }: OrgSession,
) -> Result<Json<Value>, ApiError> {
    let ctx = context(&state, &session, q.company_id).await?;
    if q.module
        .as_deref()
        .is_some_and(|module| !valid_slug(module))
        || q.query.as_ref().is_some_and(|query| query.len() > 240)
    {
        return Err(ApiError::BadRequest("invalid guide search".into()));
    }
    let org = ctx.organization_id();
    let company = q.company_id;
    let module_filter = q
        .module
        .as_deref()
        .map(|module| format!(" AND module = '{module}'"))
        .unwrap_or_default();
    let heads = state.stdb.query_sql(&format!("SELECT {HEAD_COLUMNS} FROM knowledge_guide WHERE organization_id = {org} AND company_id = {company}{module_filter} LIMIT 201"))
        .await.map_err(ApiError::internal)?;
    if heads.len() > 200 {
        return Err(ApiError::Unprocessable(
            "guide library exceeds search bound; narrow the module".into(),
        ));
    }
    let query = q.query.as_deref().unwrap_or("").to_lowercase();
    let terms: Vec<_> = query
        .split_whitespace()
        .filter(|term| term.len() >= 2)
        .take(12)
        .collect();
    let mut matches = Vec::new();
    for head in heads {
        match revision(&state, &ctx, company, &head, None).await {
            Ok(guide) => {
                let text = format!(
                    "{} {}",
                    string(&guide, "title").unwrap_or(""),
                    string(&guide, "markdown").unwrap_or("")
                )
                .to_lowercase();
                let score = terms.iter().filter(|term| text.contains(**term)).count();
                if terms.is_empty() || score > 0 {
                    matches.push((score, guide));
                }
            }
            Err(ApiError::NotFound(_)) => {}
            Err(error) => return Err(error),
        }
    }
    matches.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| b.1["guideId"].as_str().cmp(&a.1["guideId"].as_str()))
    });
    let guides: Vec<_> = matches
        .into_iter()
        .take(q.limit.unwrap_or(8).clamp(1, 20))
        .map(|(_, guide)| guide)
        .collect();
    resolve_membership_company_id(
        &state.stdb,
        org,
        ctx.actor_identity(),
        Some(company),
        "guide membership changed",
    )
    .await?;
    ctx.require_current_placement(&state.organization_placements)?;
    Ok(Json(json!({"schemaVersion":1,"guides":guides})))
}

async fn history(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(q): Query<ReadQuery>,
    OrgSession { session, .. }: OrgSession,
) -> Result<Json<Value>, ApiError> {
    let ctx = context(&state, &session, q.company_id).await?;
    let head = head(&state, &ctx, q.company_id, positive_id(&id)?).await?;
    let latest = u64_value(&head, "latest_revision").unwrap_or(0);
    let mut guides = Vec::new();
    for number in (1..=latest).rev().take(20) {
        guides.push(revision(&state, &ctx, q.company_id, &head, Some(number as u32)).await?);
    }
    resolve_membership_company_id(
        &state.stdb,
        ctx.organization_id(),
        ctx.actor_identity(),
        Some(q.company_id),
        "guide membership changed",
    )
    .await?;
    Ok(Json(json!({"schemaVersion":1,"guides":guides})))
}

fn source_projection(source: &Value) -> Result<Value, ApiError> {
    let input = source
        .as_object()
        .ok_or_else(|| ApiError::BadRequest("invalid guide source".into()))?;
    let mut out = serde_json::Map::new();
    // These are saved references, not new proof of source authority. Never
    // accept bodies, credentials, executable actions, or arbitrary metadata.
    for key in [
        "kind",
        "trust",
        "entity_type",
        "entity_id",
        "source_kind",
        "source_key",
        "source_version",
        "passage_id",
        "passage_key",
        "content_hash",
        "field",
        "label",
        "excerpt",
        "href",
        "snapshot_at",
        "url",
        "fetched_at",
    ] {
        if let Some(value) = input.get(key) {
            match value {
                Value::String(text) if text.len() <= 2_000 => {
                    if matches!(key, "href" | "url")
                        && (text.contains('\\')
                            || text.chars().any(char::is_control)
                            || !(text.starts_with('/') && !text.starts_with("//")
                                || text.starts_with("https://")))
                    {
                        return Err(ApiError::BadRequest("unsafe guide source link".into()));
                    }
                    out.insert(key.to_string(), value.clone());
                }
                Value::Number(n) if key == "passage_id" && n.as_u64().is_some() => {
                    out.insert(key.to_string(), value.clone());
                }
                Value::Null => {}
                _ => return Err(ApiError::BadRequest("invalid guide source field".into())),
            }
        }
    }
    Ok(Value::Object(out))
}

async fn save(
    State(state): State<Arc<AppState>>,
    OrgSession {
        session,
        organization_id,
    }: OrgSession,
    Json(body): Json<SaveRequest>,
) -> Result<Json<Value>, ApiError> {
    let company = positive_id(&body.company_id)?;
    let ctx = context(&state, &session, company).await?;
    let guide_id = body.guide_id.as_deref().map(positive_id).transpose()?;
    if let Some(id) = guide_id {
        head(&state, &ctx, company, id).await?;
    }
    let args = save_arguments(organization_id, company, &body)?;
    // The generated session operation retains actor identity and enforces scope;
    // this route never invokes a reducer with the owner token.
    dispatch_session_reducer(&state, &session, "save_knowledge_guide", args)
        .await
        .map_err(|error| match error {
            ApiError::Unprocessable(ref message)
                if message.contains("guide revision conflict")
                    || message.contains("request key already used") =>
            {
                ApiError::Conflict("guide revision or save request conflict".into())
            }
            other => other,
        })?;
    let org = ctx.organization_id();
    let actor = identity_sql_literal(ctx.actor_identity()).map_err(ApiError::Internal)?;
    // request_key validation is repeated here before SQL readback, independent
    // of reducer success, and excludes all SQL punctuation.
    if !valid_slug(&body.request_key) {
        return Err(ApiError::BadRequest("invalid guide request key".into()));
    }
    let key = body.request_key;
    let rows = state.stdb.query_sql(&format!("SELECT guide_id, revision FROM knowledge_guide_revision WHERE organization_id = {org} AND company_id = {company} AND create_uid = {actor} AND request_key = '{key}' LIMIT 1"))
        .await.map_err(ApiError::internal)?;
    let receipt = rows.first().ok_or_else(|| {
        ApiError::Unavailable("guide save acknowledged; durable readback unavailable".into())
    })?;
    let id = u64_value(receipt, "guide_id")
        .ok_or_else(|| ApiError::Internal("invalid guide save receipt".into()))?;
    let saved_head = head(&state, &ctx, company, id).await?;
    let number = u64_value(receipt, "revision").and_then(|n| u32::try_from(n).ok());
    let guide = revision(&state, &ctx, company, &saved_head, number).await?;
    resolve_membership_company_id(
        &state.stdb,
        org,
        ctx.actor_identity(),
        Some(company),
        "guide membership changed",
    )
    .await?;
    Ok(Json(json!({"schemaVersion":1,"guide":guide})))
}

fn save_arguments(org: u64, company: u64, body: &SaveRequest) -> Result<Value, ApiError> {
    if body.sources.len() > 30 {
        return Err(ApiError::BadRequest("too many guide sources".into()));
    }
    let sources: Vec<_> = body
        .sources
        .iter()
        .map(source_projection)
        .collect::<Result<_, _>>()?;
    let guide_id = body.guide_id.as_deref().map(positive_id).transpose()?;
    // Scalar wire parameters let the canonical generated reducer contract
    // encode top-level Option values without a second nested SATS codec or a
    // dependency on an unpublished generated SDK type.
    Ok(json!([
        org,
        company,
        guide_id,
        body.expected_revision,
        body.request_key,
        body.draft_key,
        body.title,
        body.module,
        body.workflow,
        body.markdown,
        body.html,
        body.language,
        body.workflow_version,
        serde_json::to_string(&sources).map_err(ApiError::internal)?,
        body.origin_message_id,
        body.run_id
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;
    const ACTOR: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[tokio::test]
    async fn flattened_save_uses_actual_generated_contract_and_sats_http_wire() {
        use std::sync::{Arc, Mutex};
        let captured = Arc::new(Mutex::new(Vec::<Value>::new()));
        async fn capture(
            State(captured): State<Arc<Mutex<Vec<Value>>>>,
            headers: axum::http::HeaderMap,
            Json(body): Json<Value>,
        ) -> Json<Value> {
            captured.lock().unwrap().push(json!({
                "authorization":headers.get(axum::http::header::AUTHORIZATION).unwrap().to_str().unwrap(),
                "body":body
            }));
            Json(json!({}))
        }
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new()
            .route(
                "/v1/database/guide-wire-test/call/save_knowledge_guide",
                axum::routing::post(capture),
            )
            .with_state(captured.clone());
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let body: SaveRequest = serde_json::from_value(json!({
            "companyId":"9007199254740995", "guideId":"9007199254740993", "expectedRevision":2,
            "requestKey":"save-attempt-1", "draftKey":"same-conversation-draft", "title":"Bill guide",
            "module":"accounting", "markdown":"# Record-grounded guide", "html":"<h1>Guide</h1>",
            "language":"en", "originMessageId":"message-7", "sources":[]
        })).unwrap();
        let call = stdb_client::ReducerCall::from_name(
            "save_knowledge_guide",
            save_arguments(11, 9_007_199_254_740_995, &body).unwrap(),
        )
        .unwrap();
        assert_eq!(call.contract().params.len(), 16);
        assert_eq!(call.contract().organization_position, Some(0));
        assert_eq!(call.contract().company_position, Some(1));
        let names: Vec<_> = call
            .contract()
            .params
            .iter()
            .map(|parameter| parameter.name)
            .collect();
        assert_eq!(
            names,
            vec![
                "organization_id",
                "company_id",
                "guide_id",
                "expected_revision",
                "request_key",
                "draft_key",
                "title",
                "module",
                "workflow",
                "markdown",
                "html",
                "language",
                "workflow_version",
                "sources_json",
                "origin_message_id",
                "origin_run_id"
            ]
        );
        stdb_client::StdbClient::new(
            format!("http://{address}"),
            "guide-wire-test".into(),
            "actor-session-token".into(),
        )
        .call_reducer(call)
        .await
        .unwrap();
        server.abort();
        let captured = captured.lock().unwrap();
        assert_eq!(captured.len(), 1);
        assert_eq!(captured[0]["authorization"], "Bearer actor-session-token");
        let fields: serde_json::Map<String, Value> = names
            .into_iter()
            .zip(captured[0]["body"].as_array().unwrap().iter())
            .map(|(name, value)| (name.to_string(), value.clone()))
            .collect();
        assert_eq!(fields["company_id"], json!(9_007_199_254_740_995u64));
        assert_eq!(fields["guide_id"], json!({"some":9_007_199_254_740_993u64}));
        assert_eq!(fields["expected_revision"], json!({"some":2}));
        assert_eq!(fields["workflow"], json!({"none":[]}));
        assert_eq!(fields["workflow_version"], json!({"none":[]}));
        assert_eq!(fields["html"], json!({"some":"<h1>Guide</h1>"}));
        assert_eq!(fields["origin_message_id"], json!({"some":"message-7"}));
        assert_eq!(fields["origin_run_id"], json!({"none":[]}));
        assert_eq!(fields["draft_key"], "same-conversation-draft");
        assert_eq!(fields["sources_json"], "[]");
    }
    #[test]
    fn guide_payload_cannot_bypass_explicit_article_body_restriction() {
        let mut access = FieldAccessContext {
            role_id: 7,
            role_permissions: vec!["knowledge_article:read".into()],
            ..Default::default()
        };
        assert!(guide_content_allowed(&access));
        access
            .field_permissions
            .push(stdb_auth::FieldPermissionLike {
                id: None,
                organization_id: None,
                role_id: Some(7),
                resource: "knowledge_article".into(),
                action: "read".into(),
                allowed_fields: vec!["name".into()],
                subject_user_hex: None,
                subject_role_id: None,
            });
        assert!(!guide_content_allowed(&access));
        access.field_permissions[0]
            .allowed_fields
            .push("body".into());
        assert!(guide_content_allowed(&access));
    }
    #[test]
    fn source_projection_rejects_executable_links_and_bounds_fields() {
        assert!(source_projection(&json!({"href":"javascript:alert(1)"})).is_err());
        assert!(source_projection(&json!({"url":"//other.example"})).is_err());
        assert!(source_projection(&json!({"href":"/\\other.example"})).is_err());
        assert!(source_projection(&json!({"excerpt":"a".repeat(2001)})).is_err());
        assert_eq!(
            source_projection(&json!({"href":"/accounting/42","secret":"ignored"})).unwrap(),
            json!({"href":"/accounting/42"})
        );
    }
    #[test]
    fn member_projection_fails_closed_for_missing_or_other_actor() {
        assert!(!is_member(&json!({"create_uid":ACTOR}), ACTOR));
        assert!(is_member(&json!({"member_ids":[ACTOR]}), ACTOR));
        assert!(is_member(&json!({"memberIds":[[ACTOR]]}), ACTOR));
        assert!(!is_member(
            &json!({"member_ids":[ACTOR]}),
            "0000000000000000000000000000000000000000000000000000000000000000"
        ));
    }
    #[test]
    fn projects_canonical_camel_case_sql_rows_and_timestamps() {
        let guide = project(&json!({"id":7,"organizationId":1,"companyId":2,"latestRevision":1,"reviewState":"draft","module":"accounting"}),
            &json!({"revision":1,"sourcesJson":"[]","contentHash":"hash","draftKey":"draft-1","originRunId":"9","createDate":{"microsSinceUnixEpoch":0}}),true).unwrap();
        assert_eq!(guide["companyId"], "2");
        assert_eq!(guide["headRevision"], 1);
        assert_eq!(guide["runId"], "9");
        assert_eq!(guide["contentHash"], "hash");
        assert!(guide["updatedAt"]
            .as_str()
            .unwrap()
            .starts_with("1970-01-01"));
    }
    #[test]
    fn historical_revision_is_never_labelled_current_verified() {
        let guide = project(
            &json!({"id":1,"latest_revision":2,"review_state":"verified"}),
            &json!({"revision":1,"sources_json":"[]"}),
            false,
        )
        .unwrap();
        assert_eq!(guide["reviewState"], "superseded");
        assert_eq!(guide["guideId"], "1");
        assert_eq!(guide["provenance"], "user_saved");
    }
}
