//! AI chat sessions and persisted assistant messages.

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::documents::knowledge_guides::require_company_membership;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

// ── Tables ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_chat_session,
    index(accessor = ai_chat_session_by_org, btree(columns = [organization_id])),
    index(accessor = ai_chat_session_by_company, btree(columns = [company_id])),
    index(accessor = ai_chat_session_by_key, btree(columns = [session_key])),
    index(accessor = ai_chat_session_by_owner_id, btree(columns = [organization_id, company_id, create_uid, id]))
)]
pub struct AiChatSession {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub session_key: String,
    pub title: Option<String>,
    pub route: Option<String>,
    pub module: Option<String>,
    pub active_tab: Option<String>,
    pub archived: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_chat_message,
    index(accessor = ai_chat_message_by_org, btree(columns = [organization_id])),
    index(accessor = ai_chat_message_by_company, btree(columns = [company_id])),
    index(accessor = ai_chat_message_by_session_key, btree(columns = [session_key])),
    index(accessor = ai_chat_message_by_created_by, btree(columns = [created_by])),
    index(accessor = ai_chat_message_by_thread_id, btree(columns = [organization_id, company_id, created_by, session_key, id])),
    index(accessor = ai_chat_message_by_turn, btree(columns = [organization_id, company_id, created_by, session_key, turn_id, role]))
)]
pub struct AiChatMessage {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub session_key: String,
    pub role: String,
    pub content: String,
    pub sources_json: Option<String>,
    pub ui_context_json: Option<String>,
    pub model: Option<String>,
    pub duration_ms: Option<u64>,
    pub status: String,
    pub created_by: Identity,
    pub create_date: Timestamp,
    pub metadata: Option<String>,
    #[default("")]
    pub turn_id: String,
}

const MAX_TITLE_BYTES: usize = 512;
const MAX_BODY_BYTES: usize = 64 * 1024;
const MAX_CONTEXT_BYTES: usize = 32 * 1024;

fn valid_session_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 150
        && key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn checked_session_key(key: &str) -> Result<&str, String> {
    let key = key.trim();
    valid_session_key(key)
        .then_some(key)
        .ok_or_else(|| "Invalid AI chat session key".into())
}

fn authorize_chat_company(ctx: &ReducerContext, org: u64, company: u64) -> Result<(), String> {
    require_company_membership(ctx, org, company)
        .map_err(|_| "Permission denied: AI chat company access required".into())
}

fn owned_session(
    ctx: &ReducerContext,
    org: u64,
    company: u64,
    key: &str,
) -> Result<AiChatSession, String> {
    ctx.db
        .ai_chat_session()
        .ai_chat_session_by_key()
        .filter(&key.to_owned())
        .find(|session| {
            session.organization_id == org
                && session.company_id == company
                && session.create_uid == ctx.sender()
        })
        .ok_or_else(|| "AI chat session not found".into())
}

fn valid_turn_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

fn requested_turn_id(params: &AppendAiChatMessageParams) -> Result<Option<String>, String> {
    let metadata = params
        .metadata
        .as_ref()
        .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok());
    let Some(turn_id) = metadata.as_ref().and_then(|value| value.get("turnId")) else {
        return Ok(None);
    };
    let turn_id = turn_id
        .as_str()
        .filter(|id| valid_turn_id(id))
        .ok_or("Invalid AI chat turn ID")?;
    if !matches!(params.role.as_str(), "user" | "assistant") {
        return Err("AI chat turn messages require a user or assistant role".into());
    }
    Ok(Some(turn_id.to_ascii_lowercase()))
}

fn same_message(previous: &AiChatMessage, params: &AppendAiChatMessageParams) -> bool {
    previous.content == params.content
        && previous.sources_json == params.sources_json
        && previous.ui_context_json == params.ui_context_json
        && previous.model == params.model
        && previous.duration_ms == params.duration_ms
        && previous.status == params.status
        && previous.metadata == params.metadata
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAiChatSessionParams {
    pub session_key: String,
    pub title: Option<String>,
    pub route: Option<String>,
    pub module: Option<String>,
    pub active_tab: Option<String>,
    pub archived: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct AppendAiChatMessageParams {
    pub session_key: String,
    pub role: String,
    pub content: String,
    pub sources_json: Option<String>,
    pub ui_context_json: Option<String>,
    pub model: Option<String>,
    pub duration_ms: Option<u64>,
    pub status: String,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateAiChatSessionTitleParams {
    pub title: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_ai_chat_session(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateAiChatSessionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_chat_session", "create")?;
    authorize_chat_company(ctx, organization_id, company_id)?;

    let session_key = checked_session_key(&params.session_key)?.to_owned();
    if params
        .title
        .as_ref()
        .is_some_and(|value| value.len() > MAX_TITLE_BYTES)
        || params
            .route
            .as_ref()
            .is_some_and(|value| value.len() > 2048)
        || params
            .module
            .as_ref()
            .is_some_and(|value| value.len() > 150)
        || params
            .active_tab
            .as_ref()
            .is_some_and(|value| value.len() > 150)
        || params
            .metadata
            .as_ref()
            .is_some_and(|value| value.len() > MAX_CONTEXT_BYTES)
    {
        return Err("AI chat session details exceed their size limits".into());
    }
    if let Some(existing) = ctx
        .db
        .ai_chat_session()
        .ai_chat_session_by_key()
        .filter(&session_key)
        .find(|row| row.organization_id == organization_id && row.company_id == company_id)
    {
        return (existing.create_uid == ctx.sender())
            .then_some(())
            .ok_or_else(|| "AI chat session key is unavailable".into());
    }

    let session = ctx.db.ai_chat_session().insert(AiChatSession {
        id: 0,
        organization_id,
        company_id,
        session_key,
        title: params.title,
        route: params.route,
        module: params.module,
        active_tab: params.active_tab,
        archived: params.archived,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_chat_session",
            record_id: session.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(format!("{{\"session_key\":\"{}\"}}", session.session_key)),
            changed_fields: vec!["session_key".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn append_ai_chat_message(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: AppendAiChatMessageParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_chat_message", "create")?;
    authorize_chat_company(ctx, organization_id, company_id)?;

    let session_key = checked_session_key(&params.session_key)?.to_owned();
    if params.content.trim().is_empty() {
        return Err("content is required".to_string());
    }
    if !matches!(params.role.as_str(), "user" | "assistant" | "system") {
        return Err("Invalid AI chat message role".into());
    }
    if params.content.len() > MAX_BODY_BYTES
        || params
            .sources_json
            .as_ref()
            .is_some_and(|value| value.len() > MAX_BODY_BYTES)
        || params
            .ui_context_json
            .as_ref()
            .is_some_and(|value| value.len() > MAX_CONTEXT_BYTES)
        || params
            .metadata
            .as_ref()
            .is_some_and(|value| value.len() > MAX_BODY_BYTES)
        || params.model.as_ref().is_some_and(|value| value.len() > 256)
        || params.status.len() > 64
    {
        return Err("AI chat message exceeds its size limits".into());
    }

    let session = owned_session(ctx, organization_id, company_id, &session_key)?;
    let turn_id = requested_turn_id(&params)?;
    if let Some(turn_id) = turn_id.as_deref() {
        let messages = ctx.db.ai_chat_message();
        let previous = |role: &str| {
            messages
                .ai_chat_message_by_turn()
                .filter((
                    organization_id,
                    company_id,
                    ctx.sender(),
                    &session_key,
                    turn_id,
                    role,
                ))
                .next()
        };
        if let Some(previous) = previous(&params.role) {
            return same_message(&previous, &params)
                .then_some(())
                .ok_or_else(|| {
                    "AI chat turn already contains a different message for this role".into()
                });
        }
        if params.role == "assistant" && previous("user").is_none() {
            return Err("AI chat turn requires its user message first".into());
        }
    }
    if session.archived {
        return Err("Restore this AI chat session before sending a message".into());
    }

    let message = ctx.db.ai_chat_message().insert(AiChatMessage {
        id: 0,
        organization_id,
        company_id,
        session_key,
        role: params.role,
        content: params.content,
        sources_json: params.sources_json,
        ui_context_json: params.ui_context_json,
        model: params.model,
        duration_ms: params.duration_ms,
        status: params.status,
        created_by: ctx.sender(),
        create_date: ctx.timestamp,
        metadata: params.metadata,
        turn_id: turn_id.unwrap_or_default(),
    });
    ctx.db.ai_chat_session().id().update(AiChatSession {
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..session
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_chat_message",
            record_id: message.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(format!(
                "{{\"session_key\":\"{}\",\"role\":\"{}\"}}",
                message.session_key, message.role
            )),
            changed_fields: vec!["content".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn update_ai_chat_session_title(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    session_key: String,
    params: UpdateAiChatSessionTitleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_chat_session", "write")?;

    authorize_chat_company(ctx, organization_id, company_id)?;
    let key = checked_session_key(&session_key)?;
    let session = owned_session(ctx, organization_id, company_id, key)?;

    let title = params
        .title
        .map(|title| title.trim().to_owned())
        .filter(|title| !title.is_empty());
    if title
        .as_ref()
        .is_some_and(|value| value.len() > MAX_TITLE_BYTES)
    {
        return Err("AI chat title exceeds its size limit".into());
    }
    if session.title == title {
        return Ok(());
    }
    let old_title = session.title.clone();
    let updated = AiChatSession {
        title,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..session
    };
    ctx.db.ai_chat_session().id().update(updated.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_chat_session",
            record_id: updated.id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "title": old_title }).to_string()),
            new_values: Some(serde_json::json!({ "title": updated.title }).to_string()),
            changed_fields: vec!["title".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn archive_ai_chat_session(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    session_key: String,
    archived: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_chat_session", "write")?;

    authorize_chat_company(ctx, organization_id, company_id)?;
    let key = checked_session_key(&session_key)?;
    let session = owned_session(ctx, organization_id, company_id, key)?;

    if session.archived == archived {
        return Ok(());
    }
    let old_archived = session.archived;
    let updated = AiChatSession {
        archived,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..session
    };
    ctx.db.ai_chat_session().id().update(updated.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "ai_chat_session",
            record_id: updated.id,
            action: "UPDATE",
            old_values: Some(format!("{{\"archived\":{}}}", old_archived)),
            new_values: Some(format!("{{\"archived\":{}}}", updated.archived)),
            changed_fields: vec!["archived".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
