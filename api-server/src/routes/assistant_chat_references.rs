//! Exact personal chat references and append-only user decision notes.
use std::{collections::HashSet, sync::Arc};

use axum::{
    extract::{DefaultBodyLimit, Query, State},
    http::{header, HeaderValue},
    middleware,
    response::Response,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use stdb_auth::{
    has_resource_field_read_permission, has_resource_read_permission, FieldAccessContext,
};

use crate::{
    cold_tier::pg_pool,
    error::ApiError,
    query_exec::resolve_membership_company_id,
    session::load_field_access_context,
    state::AppState,
    trusted_context::TrustedOperationContext,
    web_session::OrgSession,
    workflow_reads::{read_work_board, WorkBoardRequest, WorkTaskReadbackRequest},
};

const MAX_NOTE_BYTES: usize = 2_000;
const MAX_EXCERPT_BYTES: usize = 3_200;
const MAX_REFERENCES: usize = 4;

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Reference {
    Message {
        session_key: String,
        message_id: String,
    },
    Decision {
        session_key: String,
        message_id: String,
        decision_id: String,
        revision: i32,
    },
    ImportDecision {
        session_key: String,
        task_id: String,
        decision_id: String,
        revision: i32,
    },
    ImportMapping {
        session_key: String,
        task_id: String,
        batch_id: String,
        item_id: String,
        revision: i32,
    },
    ApprovalReceipt {
        task_id: String,
        event_id: String,
        revision: String,
        idempotency_key: String,
        input_hash: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        acting_for: Option<String>,
        work_scope: String,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReferenceRequest {
    company_id: u64,
    references: Vec<Reference>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DecisionQuery {
    company_id: u64,
    session_key: String,
    message_ids: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveDecision {
    company_id: u64,
    session_key: String,
    message_id: String,
    decision_id: String,
    request_id: String,
    expected_revision: i32,
    note: String,
}

fn unavailable() -> ApiError {
    ApiError::NotFound("Saved chat reference is unavailable".into())
}

fn valid_session(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 150
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn decimal_id(value: &str) -> Option<u64> {
    let parsed = value.parse::<u64>().ok()?;
    (parsed > 0 && value == parsed.to_string()).then_some(parsed)
}

impl Reference {
    fn valid(&self) -> bool {
        match self {
            Self::Message {
                session_key,
                message_id,
            } => valid_session(session_key) && decimal_id(message_id).is_some(),
            Self::Decision {
                session_key,
                message_id,
                decision_id,
                revision,
            } => {
                valid_session(session_key)
                    && decimal_id(message_id).is_some()
                    && hex(decision_id, 32)
                    && *revision > 0
            }
            Self::ImportDecision {
                session_key,
                task_id,
                decision_id,
                revision,
            } => {
                valid_session(session_key)
                    && hex(task_id, 32)
                    && hex(decision_id, 32)
                    && *revision > 1
            }
            Self::ImportMapping {
                session_key,
                task_id,
                batch_id,
                item_id,
                revision,
            } => {
                valid_session(session_key)
                    && hex(task_id, 32)
                    && decimal_id(batch_id).is_some_and(|id| i64::try_from(id).is_ok())
                    && decimal_id(item_id).is_some_and(|id| i64::try_from(id).is_ok())
                    && *revision > 1
            }
            Self::ApprovalReceipt {
                task_id,
                event_id,
                revision,
                idempotency_key,
                input_hash,
                acting_for,
                work_scope,
            } => {
                decimal_id(task_id).is_some()
                    && decimal_id(event_id).is_some()
                    && decimal_id(revision).is_some()
                    && !idempotency_key.is_empty()
                    && idempotency_key.len() <= 128
                    && idempotency_key.bytes().all(|byte| {
                        byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'_' | b'-')
                    })
                    && input_hash
                        .strip_prefix("sha256:")
                        .is_some_and(|hash| hex(hash, 64))
                    && acting_for
                        .as_deref()
                        .is_none_or(|identity| hex(identity, 64))
                    && matches!(
                        work_scope.as_str(),
                        "purchasing" | "sales" | "accounting" | "expenses" | "finance"
                    )
            }
        }
    }
}

fn require_history_read(access: &FieldAccessContext) -> Result<(), ApiError> {
    for (resource, fields) in [
        ("ai_chat_session", &["id", "session_key", "archived"][..]),
        (
            "ai_chat_message",
            &["id", "session_key", "role", "content", "create_date"][..],
        ),
    ] {
        if !has_resource_read_permission(Some(access), resource)
            || fields
                .iter()
                .any(|field| !has_resource_field_read_permission(Some(access), resource, field))
        {
            return Err(ApiError::Forbidden(
                "Assistant history is unavailable".into(),
            ));
        }
    }
    Ok(())
}

async fn recheck_scope(
    state: &AppState,
    context: &TrustedOperationContext,
    company: u64,
    require_import: bool,
) -> Result<(), ApiError> {
    context.require_current_placement(&state.organization_placements)?;
    let org = context.organization_id();
    let actor = context.actor_identity();
    let access = load_field_access_context(&state.stdb, actor, org)
        .await
        .map_err(ApiError::Internal)?
        .ok_or_else(unavailable)?;
    require_history_read(&access)?;
    if require_import && !super::import_reviews::full_administrator(&access) {
        return Err(unavailable());
    }
    let resolved = resolve_membership_company_id(
        context.client(),
        org,
        actor,
        Some(company),
        "Assistant history company scope mismatch",
    )
    .await?;
    if resolved != company {
        return Err(unavailable());
    }
    Ok(())
}

async fn scope(
    state: &AppState,
    session: &crate::session::ApiSession,
    company: u64,
) -> Result<TrustedOperationContext, ApiError> {
    if company == 0 {
        return Err(ApiError::BadRequest("Choose an active company".into()));
    }
    let context = TrustedOperationContext::for_resource_read(state, session)?;
    context.require_current_placement(&state.organization_placements)?;
    require_history_read(context.field_access())?;
    let resolved = resolve_membership_company_id(
        context.client(),
        context.organization_id(),
        context.actor_identity(),
        Some(company),
        "Assistant history company scope mismatch",
    )
    .await?;
    if resolved != company {
        return Err(unavailable());
    }
    context.with_company_scope(vec![company])
}

async fn owned_session(
    state: &AppState,
    context: &TrustedOperationContext,
    company: u64,
    session: &str,
) -> Result<Value, ApiError> {
    state
        .stdb
        .chat_session(
            context.organization_id(),
            company,
            context.actor_identity(),
            session,
        )
        .await
        .map_err(ApiError::internal)?
        .ok_or_else(unavailable)
}

async fn owned_message(
    state: &AppState,
    context: &TrustedOperationContext,
    company: u64,
    session: &str,
    message: &str,
) -> Result<Value, ApiError> {
    let id = decimal_id(message).ok_or_else(unavailable)?;
    let row = state
        .stdb
        .chat_message(
            context.organization_id(),
            company,
            context.actor_identity(),
            session,
            id,
        )
        .await
        .map_err(ApiError::internal)?
        .ok_or_else(unavailable)?;
    if !matches!(row["role"].as_str(), Some("assistant" | "user")) {
        return Err(unavailable());
    }
    Ok(row)
}

fn bounded_text(value: &str, limit: usize) -> &str {
    &value[..value.floor_char_boundary(limit.min(value.len()))]
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DecisionNote {
    reference: Reference,
    note: String,
    actor: String,
    created_at: String,
    latest_revision: i32,
}

fn note_from_row(row: &tokio_postgres::Row) -> DecisionNote {
    DecisionNote {
        reference: Reference::Decision {
            session_key: row.get("session_key"),
            message_id: row.get("message_id"),
            decision_id: row.get("decision_id"),
            revision: row.get("revision"),
        },
        note: row.get("note"),
        actor: row.get("actor_identity"),
        created_at: row.get("created_at"),
        latest_revision: row.get("latest_revision"),
    }
}

const NOTE_COLUMNS: &str =
    "session_key,message_id::text,decision_id,revision,note,actor_identity,created_at::text";

/// Compact checkpoints carry selectors only. The gateway resolves these again
/// through the source owner at generation time.
pub(super) async fn checkpoint_notes(
    client: &tokio_postgres::Transaction<'_>,
    org: &str,
    company: &str,
    actor: &str,
    session_key: &str,
) -> Result<Vec<Value>, ApiError> {
    let rows = client.query(
        "SELECT d.message_id::text,d.decision_id,d.revision
         FROM lumiere_platform.assistant_chat_decision d
         WHERE d.organization_id=$1::text::numeric AND d.company_id=$2::text::numeric AND d.actor_identity=$3
           AND d.session_key=$4 AND NOT EXISTS (
               SELECT 1 FROM lumiere_platform.assistant_chat_decision newer
               WHERE newer.organization_id=d.organization_id AND newer.company_id=d.company_id
                 AND newer.actor_identity=d.actor_identity AND newer.decision_id=d.decision_id
                 AND newer.revision>d.revision)
         ORDER BY d.created_at DESC,d.decision_id DESC LIMIT 4",
        &[&org, &company, &actor, &session_key],
    ).await.map_err(ApiError::internal)?;
    Ok(rows
        .into_iter()
        .map(|row| {
            json!(Reference::Decision {
                session_key: session_key.to_owned(),
                message_id: row.get("message_id"),
                decision_id: row.get("decision_id"),
                revision: row.get("revision"),
            })
        })
        .collect())
}

async fn list_decisions(
    State(state): State<Arc<AppState>>,
    Query(query): Query<DecisionQuery>,
    OrgSession { session, .. }: OrgSession,
) -> Result<Json<Value>, ApiError> {
    let messages: Vec<&str> = query.message_ids.split(',').collect();
    if !valid_session(&query.session_key)
        || messages.len() > 90
        || messages.iter().any(|message| decimal_id(message).is_none())
    {
        return Err(ApiError::BadRequest("Invalid saved decision lookup".into()));
    }
    let context = scope(&state, &session, query.company_id).await?;
    owned_session(&state, &context, query.company_id, &query.session_key).await?;
    let org = context.organization_id().to_string();
    let company = query.company_id.to_string();
    let actor = context.actor_identity();
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let db = pool.get().await.map_err(ApiError::internal)?;
    let rows = db.query(&format!(
        "SELECT DISTINCT ON (decision_id) {NOTE_COLUMNS}, revision AS latest_revision
         FROM lumiere_platform.assistant_chat_decision
         WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3
         AND session_key=$4 AND message_id=ANY($5::text[]::numeric[])
         ORDER BY decision_id,revision DESC LIMIT 180"
    ), &[&org, &company, &actor, &query.session_key, &messages]).await.map_err(ApiError::internal)?;
    recheck_scope(&state, &context, query.company_id, false).await?;
    Ok(Json(
        json!({"data":rows.iter().map(note_from_row).collect::<Vec<_>>()}),
    ))
}

async fn save_decision(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Json(body): Json<SaveDecision>,
) -> Result<Json<Value>, ApiError> {
    let note = body.note.trim();
    if !valid_session(&body.session_key)
        || decimal_id(&body.message_id).is_none()
        || !hex(&body.decision_id, 32)
        || !hex(&body.request_id, 32)
        || note.is_empty()
        || note.len() > MAX_NOTE_BYTES
        || note
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\t' | '\r'))
        || !(0..i32::MAX).contains(&body.expected_revision)
    {
        return Err(ApiError::BadRequest(
            "Enter a decision note of up to 2,000 bytes".into(),
        ));
    }
    let context = scope(&state, &session, body.company_id).await?;
    let thread = owned_session(&state, &context, body.company_id, &body.session_key).await?;
    if thread["archived"].as_bool() != Some(false) {
        return Err(ApiError::Conflict(
            "Restore this conversation before editing its decisions".into(),
        ));
    }
    owned_message(
        &state,
        &context,
        body.company_id,
        &body.session_key,
        &body.message_id,
    )
    .await?;
    let org = context.organization_id().to_string();
    let company = body.company_id.to_string();
    let actor = context.actor_identity();
    let revision = body.expected_revision + 1;
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let mut db = pool.get().await.map_err(ApiError::internal)?;
    let transaction = db.transaction().await.map_err(ApiError::internal)?;
    let lock = format!(
        "{org}:{company}:{actor}:{}:{}",
        body.session_key, body.message_id
    );
    transaction
        .query_one(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&lock],
        )
        .await
        .map_err(ApiError::internal)?;
    let rows = transaction.query(&format!(
        "SELECT {NOTE_COLUMNS},revision AS latest_revision,request_id
         FROM lumiere_platform.assistant_chat_decision
         WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3
         AND (request_id=$4 OR decision_id=$5 OR (session_key=$6 AND message_id=$7::text::numeric))
         ORDER BY (request_id=$4) DESC,revision DESC LIMIT 2"
    ), &[&org,&company,&actor,&body.request_id,&body.decision_id,&body.session_key,&body.message_id])
        .await.map_err(ApiError::internal)?;
    if let Some(row) = rows
        .first()
        .filter(|row| row.get::<_, String>("request_id") == body.request_id)
    {
        let saved = note_from_row(row);
        let expected = Reference::Decision {
            session_key: body.session_key,
            message_id: body.message_id,
            decision_id: body.decision_id,
            revision,
        };
        if saved.reference != expected || saved.note != note {
            return Err(ApiError::Conflict(
                "Decision request was already used".into(),
            ));
        }
        recheck_scope(&state, &context, body.company_id, false).await?;
        transaction.commit().await.map_err(ApiError::internal)?;
        return Ok(Json(json!(saved)));
    }
    if rows.first().map_or(body.expected_revision != 0, |row| {
        row.get::<_, i32>("revision") != body.expected_revision
            || row.get::<_, String>("session_key") != body.session_key
            || row.get::<_, String>("message_id") != body.message_id
            || row.get::<_, String>("decision_id") != body.decision_id
    }) {
        return Err(ApiError::Conflict(
            "Decision changed. Reload it before saving".into(),
        ));
    }
    let row = transaction.query_opt(&format!(
        "INSERT INTO lumiere_platform.assistant_chat_decision
         (organization_id,company_id,actor_identity,session_key,message_id,decision_id,revision,request_id,note)
         VALUES ($1::text::numeric,$2::text::numeric,$3,$4,$5::text::numeric,$6,$7,$8,$9)
         ON CONFLICT DO NOTHING RETURNING {NOTE_COLUMNS},revision AS latest_revision"
    ), &[&org,&company,&actor,&body.session_key,&body.message_id,&body.decision_id,&revision,&body.request_id,&note])
        .await.map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::Conflict("Decision changed. Reload it before saving".into()))?;
    recheck_scope(&state, &context, body.company_id, false).await?;
    transaction.commit().await.map_err(ApiError::internal)?;
    Ok(Json(json!(note_from_row(&row))))
}

async fn resolve(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Json(body): Json<ReferenceRequest>,
) -> Result<Json<Value>, ApiError> {
    let mut seen = HashSet::new();
    if body.references.is_empty()
        || body.references.len() > MAX_REFERENCES
        || body
            .references
            .iter()
            .any(|reference| !reference.valid() || !seen.insert(reference))
    {
        return Err(ApiError::BadRequest(
            "Choose up to four distinct saved chat references".into(),
        ));
    }
    let context = scope(&state, &session, body.company_id).await?;
    let require_import = body.references.iter().any(|reference| {
        matches!(
            reference,
            Reference::ImportDecision { .. } | Reference::ImportMapping { .. }
        )
    });
    let mut references = Vec::with_capacity(body.references.len());
    for reference in body.references {
        let excerpt = read_reference(&state, &context, body.company_id, &reference).await?;
        references.push(json!({ "reference": reference, "excerpt": excerpt }));
    }
    recheck_scope(&state, &context, body.company_id, require_import).await?;
    Ok(Json(json!({
        "organizationId":context.organization_id().to_string(),
        "companyId":body.company_id.to_string(),
        "actor":context.actor_identity(),
        "references": references
    })))
}

/// Persisted assistant prose can contain private ERP data whose backing
/// record permissions changed. Only source-free, model-free local replies
/// can supply text; derived replies remain addressable as transcript links.
fn reusable_assistant_message(row: &Value) -> bool {
    let sources = row.get("sourcesJson").or_else(|| row.get("sources_json"));
    let metadata = row.get("metadata");
    row.get("model").is_none_or(Value::is_null)
        && sources.is_none_or(|value| value.is_null() || value.as_str() == Some("[]"))
        && metadata.is_none_or(|value| {
            value.is_null()
                || value
                    .as_str()
                    .and_then(|encoded| serde_json::from_str::<Value>(encoded).ok())
                    .is_some_and(|value| {
                        value
                            .as_object()
                            .is_some_and(|map| map.keys().all(|key| key == "turnId"))
                    })
        })
}

async fn read_reference(
    state: &AppState,
    context: &TrustedOperationContext,
    company: u64,
    reference: &Reference,
) -> Result<Value, ApiError> {
    match reference {
        Reference::Message {
            session_key,
            message_id,
        } => {
            owned_session(state, context, company, session_key).await?;
            let row = owned_message(state, context, company, session_key, message_id).await?;
            let content = row
                .get("content")
                .and_then(Value::as_str)
                .ok_or_else(unavailable)?;
            let role = row
                .get("role")
                .and_then(Value::as_str)
                .filter(|role| matches!(*role, "assistant" | "user"))
                .ok_or_else(unavailable)?;
            let assistant_context_unavailable =
                role == "assistant" && !reusable_assistant_message(&row);
            Ok(json!({
                "role":role,
                "content":(!assistant_context_unavailable).then(|| bounded_text(content, MAX_EXCERPT_BYTES)),
                "truncated":!assistant_context_unavailable && content.len()>MAX_EXCERPT_BYTES,
                "assistantContextUnavailable":assistant_context_unavailable,
                "createdAt":row.get("createDate").or_else(|| row.get("create_date"))
            }))
        }
        Reference::Decision {
            session_key,
            message_id,
            decision_id,
            revision,
        } => {
            owned_session(state, context, company, session_key).await?;
            owned_message(state, context, company, session_key, message_id).await?;
            let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
            let db = pool.get().await.map_err(ApiError::internal)?;
            let row = db.query_opt(&format!(
                "SELECT {NOTE_COLUMNS}, (SELECT max(head.revision)
                 FROM lumiere_platform.assistant_chat_decision head
                 WHERE head.organization_id=d.organization_id AND head.company_id=d.company_id
                 AND head.actor_identity=d.actor_identity AND head.decision_id=d.decision_id) AS latest_revision
                 FROM lumiere_platform.assistant_chat_decision d
                 WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3
                 AND session_key=$4 AND message_id=$5::text::numeric AND decision_id=$6 AND revision=$7"
            ), &[&context.organization_id().to_string(),&company.to_string(),&context.actor_identity(),session_key,message_id,decision_id,revision])
                .await.map_err(ApiError::internal)?.ok_or_else(unavailable)?;
            let note = note_from_row(&row);
            Ok(
                json!({"note":note.note,"confirmedBy":note.actor,"createdAt":note.created_at,"latestRevision":note.latest_revision}),
            )
        }
        Reference::ImportDecision {
            session_key,
            task_id,
            decision_id,
            revision,
        } => {
            if !super::import_reviews::full_administrator(context.field_access()) {
                return Err(unavailable());
            }
            let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
            let db = pool.get().await.map_err(ApiError::internal)?;
            let row = db.query_opt(
                "SELECT receipt.option_id,receipt.other_text,receipt.created_at::text,task.decision_revision
                 FROM lumiere_platform.import_task_decision receipt
                 JOIN lumiere_platform.import_task task USING (organization_id,company_id,actor_identity,request_id)
                 WHERE receipt.organization_id=$1::text::numeric AND receipt.company_id=$2::text::numeric
                 AND receipt.actor_identity=$3 AND task.conversation_key=$4 AND receipt.request_id=$5
                 AND receipt.decision_id=$6 AND receipt.revision=$7",
                &[&context.organization_id().to_string(),&company.to_string(),&context.actor_identity(),session_key,task_id,decision_id,revision]
            ).await.map_err(ApiError::internal)?.ok_or_else(unavailable)?;
            let other: Option<String> = row.get("other_text");
            Ok(json!({
                "choice":row.get::<_,String>("option_id"),"note":other.as_deref().map(|note| bounded_text(note, MAX_NOTE_BYTES)),
                "confirmedBy":context.actor_identity(),"createdAt":row.get::<_,String>("created_at"),"latestRevision":row.get::<_,i32>("decision_revision")
            }))
        }
        Reference::ImportMapping {
            session_key,
            task_id,
            batch_id,
            item_id,
            revision,
        } => {
            if !super::import_reviews::full_administrator(context.field_access()) {
                return Err(unavailable());
            }
            let batch = batch_id.parse::<i64>().map_err(ApiError::internal)?;
            let item = item_id.parse::<i64>().map_err(ApiError::internal)?;
            let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
            let db = pool.get().await.map_err(ApiError::internal)?;
            let row = db.query_opt(
                "SELECT d.proposed_json,d.confirmed_fields,d.state,d.actor_identity,d.created_at::text,i.revision
                 FROM lumiere_platform.import_review_decision d
                 JOIN lumiere_platform.import_review_item i ON i.organization_id=d.organization_id AND i.company_id=d.company_id AND i.id=d.item_id
                 JOIN lumiere_platform.import_task_review l ON l.organization_id=i.organization_id AND l.company_id=i.company_id AND l.batch_id=i.batch_id
                 JOIN lumiere_platform.import_review_batch b ON b.organization_id=l.organization_id AND b.company_id=l.company_id AND b.id=l.batch_id
                 JOIN lumiere_platform.import_task t ON t.organization_id=l.organization_id AND t.company_id=l.company_id
                   AND t.actor_identity=l.actor_identity AND t.request_id=l.request_id
                 WHERE d.organization_id=$1::text::numeric AND d.company_id=$2::text::numeric
                 AND t.actor_identity=$3 AND t.conversation_key=$4 AND t.request_id=$5
                 AND i.batch_id=$6 AND d.item_id=$7 AND d.revision=$8
                 AND d.state='confirmed' AND b.target_entity='product'",
                &[&context.organization_id().to_string(),&company.to_string(),&context.actor_identity(),session_key,task_id,&batch,&item,revision]
            ).await.map_err(ApiError::internal)?.ok_or_else(unavailable)?;
            let values: Value = row.get("proposed_json");
            let fields: Value = row.get("confirmed_fields");
            let fields = fields.as_array().ok_or_else(unavailable)?;
            let confirmed: serde_json::Map<String, Value> = fields
                .iter()
                .take(50)
                .filter_map(Value::as_str)
                .filter_map(|key| values.get(key).map(|value| (key.to_owned(), value.clone())))
                .collect();
            let confirmed = serde_json::to_string(&confirmed).map_err(ApiError::internal)?;
            Ok(json!({
                "confirmedValues":bounded_text(&confirmed, MAX_EXCERPT_BYTES),"truncated":confirmed.len()>MAX_EXCERPT_BYTES,
                "state":row.get::<_,String>("state"),"confirmedBy":row.get::<_,String>("actor_identity"),
                "createdAt":row.get::<_,String>("created_at"),"latestRevision":row.get::<_,i32>("revision")
            }))
        }
        Reference::ApprovalReceipt {
            task_id,
            event_id,
            revision,
            idempotency_key,
            input_hash,
            acting_for,
            work_scope,
        } => {
            let readback = WorkTaskReadbackRequest::parse(
                "workflow-human-tasks",
                Some(work_scope),
                decimal_id(task_id),
                Some("decision"),
                Some(idempotency_key),
                Some(input_hash),
                acting_for.as_deref(),
            )?;
            let request = WorkBoardRequest::parse(
                "workflow-human-tasks",
                Some(company),
                Some(work_scope),
                Some("eligible"),
                None,
                None,
                Some(1),
            )?
            .ok_or_else(unavailable)?
            .with_readback(readback)?;
            let page = read_work_board(&state.stdb, context, request).await?;
            let evidence = page.command_evidence.ok_or_else(unavailable)?;
            if evidence.get("eventId").and_then(Value::as_str) != Some(event_id)
                || evidence.get("resultRevision").and_then(Value::as_str) != Some(revision)
            {
                return Err(unavailable());
            }
            let task = page.rows.first().ok_or_else(unavailable)?;
            let subject_id = task
                .get("subjectId")
                .or_else(|| task.get("subject_id"))
                .and_then(|value| {
                    value
                        .as_str()
                        .map(str::to_owned)
                        .or_else(|| value.as_u64().map(|id| id.to_string()))
                });
            Ok(json!({
                "decision":evidence["decision"],"status":evidence["resultStatus"],
                "confirmedBy":evidence["actorIdentityHex"],"revision":evidence["resultRevision"],
                "latestRevision":task.get("revision"),
                "subjectModel":task.get("subjectModel").or_else(|| task.get("subject_model")),
                "subjectId":subject_id,
            }))
        }
    }
}

pub(super) fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/ai/chat/decisions",
            get(list_decisions).post(save_decision),
        )
        .route("/ai/chat/references/resolve", post(resolve))
        .layer(DefaultBodyLimit::max(16_384))
        .layer(middleware::map_response(
            |mut response: Response| async move {
                response.headers_mut().insert(
                    header::CACHE_CONTROL,
                    HeaderValue::from_static("private, no-store"),
                );
                response
            },
        ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reference_shape_keeps_exact_ids_and_rejects_authority_fields() {
        let reference = json!({
            "kind":"message","sessionKey":"thread_1","messageId":"18446744073709551615"
        });
        assert!(serde_json::from_value::<Reference>(reference.clone())
            .expect("reference")
            .valid());
        assert!(!serde_json::from_value::<Reference>(json!({
            "kind":"message","sessionKey":"thread_1","messageId":"18446744073709551616"
        }))
        .expect("wire shape")
        .valid());
        let mut forged = reference;
        forged["excerpt"] = json!("caller supplied");
        assert!(serde_json::from_value::<Reference>(forged).is_err());
    }

    #[test]
    fn derived_or_malformed_assistant_replies_do_not_supply_prompt_text() {
        assert!(reusable_assistant_message(
            &json!({"model":null,"sourcesJson":"[]","metadata":"{"turnId":"t"}"})
        ));
        assert!(!reusable_assistant_message(
            &json!({"model":"provider","sourcesJson":"[]"})
        ));
        assert!(!reusable_assistant_message(
            &json!({"sources_json":"[{"label":"record"}]"})
        ));
        assert!(!reusable_assistant_message(&json!({"metadata":"invalid"})));
    }

    #[test]
    fn excerpt_boundary_preserves_utf8() {
        assert_eq!(bounded_text("aéz", 2), "a");
        assert_eq!(bounded_text("aéz", 3), "aé");
    }
}
