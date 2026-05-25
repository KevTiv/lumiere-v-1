//! AI chat sessions and persisted assistant messages.

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

// ── Tables ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_chat_session,
    public,
    index(accessor = ai_chat_session_by_org, btree(columns = [organization_id])),
    index(accessor = ai_chat_session_by_company, btree(columns = [company_id])),
    index(accessor = ai_chat_session_by_key, btree(columns = [session_key]))
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
    public,
    index(accessor = ai_chat_message_by_org, btree(columns = [organization_id])),
    index(accessor = ai_chat_message_by_company, btree(columns = [company_id])),
    index(accessor = ai_chat_message_by_session_key, btree(columns = [session_key])),
    index(accessor = ai_chat_message_by_created_by, btree(columns = [created_by]))
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

    let session_key = params.session_key.trim().to_string();
    if session_key.is_empty() {
        return Err("session_key is required".to_string());
    }

    if ctx
        .db
        .ai_chat_session()
        .ai_chat_session_by_key()
        .filter(&session_key)
        .any(|s| s.organization_id == organization_id && s.company_id == company_id)
    {
        return Ok(());
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

    let session_key = params.session_key.trim().to_string();
    if session_key.is_empty() {
        return Err("session_key is required".to_string());
    }
    if params.content.trim().is_empty() {
        return Err("content is required".to_string());
    }

    let session = ctx
        .db
        .ai_chat_session()
        .ai_chat_session_by_key()
        .filter(&session_key)
        .find(|s| s.organization_id == organization_id)
        .ok_or("AI chat session not found")?;
    if session.company_id != company_id {
        return Err("AI chat session does not belong to this company".to_string());
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

    let session = ctx
        .db
        .ai_chat_session()
        .ai_chat_session_by_key()
        .filter(&session_key)
        .find(|s| s.organization_id == organization_id)
        .ok_or("AI chat session not found")?;
    if session.company_id != company_id {
        return Err("AI chat session does not belong to this company".to_string());
    }

    let old_title = session.title.clone();
    let updated = AiChatSession {
        title: params.title,
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
            old_values: Some(format!("{{\"title\":{:?}}}", old_title)),
            new_values: Some(format!("{{\"title\":{:?}}}", updated.title)),
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

    let session = ctx
        .db
        .ai_chat_session()
        .ai_chat_session_by_key()
        .filter(&session_key)
        .find(|s| s.organization_id == organization_id)
        .ok_or("AI chat session not found")?;
    if session.company_id != company_id {
        return Err("AI chat session does not belong to this company".to_string());
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
