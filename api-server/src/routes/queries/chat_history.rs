//! Personal Assistant history. Private tables are read with the owner token
//! only after the authenticated actor and current company have been resolved.

use super::OrgQuery;
use crate::{
    error::ApiError,
    query_exec::{preserve_query_timestamp_precision, resolve_membership_company_id},
    session::load_field_access_context,
    trusted_context::TrustedOperationContext,
};
use serde_json::{json, Value};
use stdb_auth::{
    has_resource_field_read_permission, has_resource_read_permission, FieldAccessContext,
};
use stdb_client::{chat_row_id, valid_chat_key, StdbClient};

const DEFAULT_LIMIT: u32 = 30;
const MAX_SEARCH_BYTES: usize = 256;
const SEARCH_MESSAGE_LIMIT: usize = 30;
const SEARCH_SNIPPET_CHARS: usize = 160;
const SESSION_FIELDS: &[&str] = &[
    "id",
    "organization_id",
    "company_id",
    "session_key",
    "title",
    "route",
    "module",
    "active_tab",
    "archived",
    "create_date",
    "write_date",
];
const MESSAGE_FIELDS: &[&str] = &[
    "id",
    "organization_id",
    "company_id",
    "session_key",
    "role",
    "content",
    "sources_json",
    "model",
    "duration_ms",
    "status",
    "create_date",
    "metadata",
    "turn_id",
];

#[derive(Clone, Copy)]
enum Cursor {
    Before(u64),
    SearchMessage { session: u64, before: u64 },
}

impl Cursor {
    fn parse(value: &str) -> Result<Self, ApiError> {
        let invalid = || ApiError::BadRequest("Invalid AI chat history cursor".into());
        let positive = |value: &str| value.parse::<u64>().ok().filter(|id| *id > 0);
        if let Some((session, before)) = value.split_once(':') {
            Ok(Self::SearchMessage {
                session: positive(session).ok_or_else(invalid)?,
                before: positive(before).ok_or_else(invalid)?,
            })
        } else {
            Ok(Self::Before(positive(value).ok_or_else(invalid)?))
        }
    }

    fn before(self) -> Option<u64> {
        match self {
            Self::Before(id) => Some(id),
            Self::SearchMessage { .. } => None,
        }
    }

    fn encode(self) -> String {
        match self {
            Self::Before(id) => id.to_string(),
            Self::SearchMessage { session, before } => format!("{session}:{before}"),
        }
    }
}

fn require_read(
    access: &FieldAccessContext,
    resource: &str,
    fields: &[&str],
) -> Result<(), ApiError> {
    if !has_resource_read_permission(Some(access), resource)
        || fields
            .iter()
            .any(|field| !has_resource_field_read_permission(Some(access), resource, field))
    {
        return Err(ApiError::Forbidden(
            "AI chat history read permission required".into(),
        ));
    }
    Ok(())
}

pub(super) async fn read(
    owner: &StdbClient,
    context: &TrustedOperationContext,
    resource: &str,
    query: &OrgQuery,
) -> Result<Value, ApiError> {
    let bad_request = |message: &str| ApiError::BadRequest(message.into());
    let requested_company = query
        .company_id
        .filter(|company| *company > 0)
        .ok_or_else(|| bad_request("companyId is required for AI chat history"))?;
    let org = context.organization_id();
    let actor = context.actor_identity();
    let company = resolve_membership_company_id(
        context.client(),
        org,
        actor,
        Some(requested_company),
        "Cannot read AI chat history for another company",
    )
    .await?;

    let sessions = resource == "ai-chat-sessions";
    let key = query.chat_session_key.as_deref();
    let module = query.chat_module.as_deref();
    if key.is_some_and(|value| !valid_chat_key(value))
        || module.is_some_and(|value| !valid_chat_key(value))
    {
        return Err(bad_request("Invalid AI chat session or module"));
    }
    let search = query
        .chat_search
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if search.is_some_and(|value| value.len() > MAX_SEARCH_BYTES) {
        return Err(bad_request("AI chat search exceeds its size limit"));
    }
    let cursor = query.cursor.as_deref().map(Cursor::parse).transpose()?;
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, DEFAULT_LIMIT) as usize;
    let message = query.chat_message_id;
    if message == Some(0)
        || (sessions && message.is_some())
        || (!sessions
            && (key.is_none()
                || search.is_some()
                || module.is_some()
                || query.chat_archived.is_some()))
        || (key.is_some()
            && (search.is_some() || module.is_some() || (sessions && cursor.is_some())))
        || (message.is_some() && cursor.is_some())
        || (matches!(cursor, Some(Cursor::SearchMessage { .. })) && search.is_none())
    {
        return Err(bad_request("Invalid AI chat history filters"));
    }
    let requires_messages = !sessions || search.is_some();
    require_read(context.field_access(), "ai_chat_session", SESSION_FIELDS)?;
    if requires_messages {
        require_read(context.field_access(), "ai_chat_message", MESSAGE_FIELDS)?;
    }

    let (mut rows, next_cursor) = match (sessions, key, message) {
        (true, Some(key), _) => (
            owner
                .chat_session(org, company, actor, key)
                .await
                .map_err(ApiError::internal)?
                .into_iter()
                .collect(),
            None,
        ),
        (true, None, _) => {
            let archived = query.chat_archived.unwrap_or(false);
            if let Some(search) = search {
                search_sessions(owner, org, company, actor, archived, module, search, cursor)
                    .await?
            } else {
                let before = cursor.and_then(Cursor::before);
                let page = owner
                    .chat_sessions_page(org, company, actor, archived, module, before, limit)
                    .await
                    .map_err(ApiError::internal)?;
                (page.rows, page.next_cursor.map(Cursor::Before))
            }
        }
        (false, Some(key), message) => {
            if owner
                .chat_session(org, company, actor, key)
                .await
                .map_err(ApiError::internal)?
                .is_none()
            {
                (Vec::new(), None)
            } else if let Some(message) = message {
                (
                    owner
                        .chat_message(org, company, actor, key, message)
                        .await
                        .map_err(ApiError::internal)?
                        .into_iter()
                        .collect(),
                    None,
                )
            } else {
                let before = cursor.and_then(Cursor::before);
                let page = owner
                    .chat_message_page_with_cursor(org, company, actor, key, before, limit, false)
                    .await
                    .map_err(ApiError::internal)?;
                (page.rows, page.next_cursor.map(Cursor::Before))
            }
        }
        (false, None, _) => return Err(bad_request("sessionKey is required")),
    };

    // Private owner reads may race a revocation. Recheck before returning rows.
    let current = load_field_access_context(owner, actor, org)
        .await
        .map_err(ApiError::Internal)?
        .ok_or(ApiError::Unauthorized)?;
    require_read(&current, "ai_chat_session", SESSION_FIELDS)?;
    if requires_messages {
        require_read(&current, "ai_chat_message", MESSAGE_FIELDS)?;
    }
    resolve_membership_company_id(
        context.client(),
        org,
        actor,
        Some(company),
        "Cannot read AI chat history for another company",
    )
    .await?;

    preserve_query_timestamp_precision(&mut rows);
    Ok(json!({ "data": rows, "nextCursor": next_cursor.map(Cursor::encode) }))
}

#[allow(clippy::too_many_arguments)]
async fn search_sessions(
    owner: &StdbClient,
    org: u64,
    company: u64,
    actor: &str,
    archived: bool,
    module: Option<&str>,
    search: &str,
    cursor: Option<Cursor>,
) -> Result<(Vec<Value>, Option<Cursor>), ApiError> {
    // SQL has no substring operator. Keep a bounded continuation while
    // checking one session at a time so old messages remain searchable.
    let before_session = match cursor {
        Some(Cursor::Before(id)) => Some(id),
        Some(Cursor::SearchMessage { session, .. }) => session.checked_add(1),
        None => None,
    };
    let page = owner
        .chat_sessions_page(org, company, actor, archived, module, before_session, 1)
        .await
        .map_err(ApiError::internal)?;
    let next_session = page.next_cursor.map(Cursor::Before);
    let Some(mut session) = page.rows.into_iter().next() else {
        return Ok((Vec::new(), next_session));
    };
    let id = chat_row_id(&session).map_err(ApiError::internal)?;
    let query = search.to_lowercase();
    if let Some(snippet) = session
        .get("title")
        .and_then(Value::as_str)
        .and_then(|title| matching_excerpt(title, &query))
    {
        session["searchSnippet"] = json!(snippet);
        return Ok((vec![session], next_session));
    }
    let key = session
        .get("sessionKey")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::Internal("AI chat session key is missing".into()))?;
    let before_message = match cursor {
        Some(Cursor::SearchMessage { session, before }) if session == id => Some(before),
        _ => None,
    };
    let page = owner
        .chat_message_page_with_cursor(
            org,
            company,
            actor,
            key,
            before_message,
            SEARCH_MESSAGE_LIMIT,
            true,
        )
        .await
        .map_err(ApiError::internal)?;
    for row in page.rows.iter().rev() {
        if let Some(snippet) = row
            .get("content")
            .and_then(Value::as_str)
            .and_then(|content| matching_excerpt(content, &query))
        {
            session["searchSnippet"] = json!(snippet);
            session["searchMessageId"] =
                json!(chat_row_id(row).map_err(ApiError::internal)?.to_string());
            return Ok((vec![session], next_session));
        }
    }
    Ok((
        Vec::new(),
        page.next_cursor
            .map(|before| Cursor::SearchMessage {
                session: id,
                before,
            })
            .or(next_session),
    ))
}

fn matching_excerpt(content: &str, lowercase_query: &str) -> Option<String> {
    let lowered = content.to_lowercase();
    let start = lowered.find(lowercase_query)?;
    let mut lowered_offset = 0;
    let original_offset = content.char_indices().find_map(|(offset, char)| {
        lowered_offset += char.to_lowercase().map(char::len_utf8).sum::<usize>();
        (lowered_offset > start).then_some(offset)
    })?;
    Some(
        content[original_offset..]
            .chars()
            .take(SEARCH_SNIPPET_CHARS)
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_snippets_remain_unicode_and_find_actual_match() {
        let content = format!("{}İmport confirmed", "a".repeat(512));
        assert_eq!(
            matching_excerpt(&content, "i\u{307}mport").as_deref(),
            Some("İmport confirmed")
        );
        assert!(matching_excerpt(&content, "warehouse").is_none());
    }

    #[test]
    fn cursors_round_trip_and_reject_untrusted_strings() {
        for raw in ["14", "14:12"] {
            assert_eq!(Cursor::parse(raw).expect("valid cursor").encode(), raw);
        }
        for raw in ["", "0", "14:0", "14:2:3", "14' OR true", "-1"] {
            assert!(Cursor::parse(raw).is_err(), "{raw}");
        }
    }
}
