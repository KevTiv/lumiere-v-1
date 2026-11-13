//! Actor-scoped conversational continuity obtained from the history owner.
use std::time::Duration;

use futures::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{error::AppError, harness::ActorCredentials, state::AppState};

use super::history_references::HistoryReference;

const MAX_CONTEXT_RESPONSE_BYTES: usize = 16 * 1024;
const CONTEXT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Default)]
pub(super) struct Conversation {
    pub prompt: Option<Value>,
    pub references: Vec<HistoryReference>,
    pub earlier_context_unavailable: bool,
}

pub(super) fn trim(prompt: &mut Option<Value>) -> bool {
    let Some(history) = prompt.as_mut() else {
        return false;
    };
    for path in [
        "/older_conversation/highlights",
        "/recent_messages",
        "/older_conversation/questions",
    ] {
        if let Some(items) = history.pointer_mut(path).and_then(Value::as_array_mut) {
            if !items.is_empty() {
                items.remove(0);
                return true;
            }
        }
    }
    *prompt = None;
    true
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContextEnvelope {
    schema_version: u8,
    organization_id: String,
    company_id: String,
    session_key: String,
    revision: i64,
    covered_through: String,
    earlier_context_unavailable: bool,
    summary: Value,
    recent_turns: Vec<Value>,
    history_refs: Vec<Value>,
}

pub(super) async fn recheck_scope(
    state: &AppState,
    actor: &ActorCredentials,
    company_id: u64,
    session_key: &str,
) -> bool {
    request(state, actor, company_id, session_key, true)
        .await
        .is_some_and(|response| response.status().is_success())
}

async fn request(
    state: &AppState,
    actor: &ActorCredentials,
    company_id: u64,
    key: &str,
    scope_only: bool,
) -> Option<reqwest::Response> {
    let base = state.config.api_server_url.as_deref()?;
    let secret = state.config.internal_secret.as_deref()?;
    state.http.post(format!("{}/v1/ai/chat/context", base.trim_end_matches('/')))
        .bearer_auth(&actor.stdb_token)
        .header("x-stdb-identity", &actor.identity_hex)
        .header("x-lumiere-gateway-secret", secret)
        .timeout(CONTEXT_TIMEOUT)
        .json(&json!({ "companyId": company_id, "sessionKey": key, "contextByteBudget": MAX_CONTEXT_RESPONSE_BYTES, "scopeOnly": scope_only }))
        .send()
        .await.ok()
}

fn unavailable() -> Conversation {
    Conversation {
        earlier_context_unavailable: true,
        ..Conversation::default()
    }
}

pub(super) async fn retrieve(
    state: &AppState,
    actor: &ActorCredentials,
    org_id: u64,
    company_id: u64,
    session_key: Option<&str>,
) -> Result<Conversation, AppError> {
    let Some(key) = session_key else {
        return Ok(Conversation::default());
    };
    if key.is_empty()
        || key.len() > 150
        || !key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
    {
        return Err(AppError::BadRequest("Invalid Assistant thread key".into()));
    }
    let Some(response) = request(state, actor, company_id, key, false).await else {
        return Ok(unavailable());
    };
    match response.status().as_u16() {
        401 | 403 | 404 => {
            return Err(AppError::Forbidden(
                "Assistant thread is unavailable".into(),
            ))
        }
        409 => {
            return Err(AppError::BadRequest(
                "Restore this thread before continuing".into(),
            ))
        }
        429 => {
            return Err(AppError::RateLimitExceeded(
                "Assistant context is busy. Try again.".into(),
            ))
        }
        200 => {}
        _ => return Ok(unavailable()),
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_CONTEXT_RESPONSE_BYTES as u64)
    {
        return Ok(unavailable());
    }
    let mut bytes = Vec::new();
    let mut chunks = response.bytes_stream();
    while let Some(chunk) = chunks.next().await {
        let Ok(chunk) = chunk else {
            return Ok(unavailable());
        };
        if chunk.len() > MAX_CONTEXT_RESPONSE_BYTES.saturating_sub(bytes.len()) {
            return Ok(unavailable());
        }
        bytes.extend_from_slice(&chunk);
    }
    let Ok(context) = serde_json::from_slice::<ContextEnvelope>(&bytes) else {
        return Ok(unavailable());
    };
    Ok(assemble(context, org_id, company_id, key))
}

fn assemble(context: ContextEnvelope, org_id: u64, company_id: u64, key: &str) -> Conversation {
    if context.schema_version != 1
        || context.organization_id != org_id.to_string()
        || context.company_id != company_id.to_string()
        || context.session_key != key
    {
        return unavailable();
    }
    let references = context
        .history_refs
        .into_iter()
        .filter_map(|value| serde_json::from_value(value).ok())
        .collect();
    let prompt = (!context.recent_turns.is_empty() || context.revision > 0).then(|| {
        json!({
            "instruction_trust": "untrusted",
            "checkpoint_revision": context.revision,
            "covered_through_message": context.covered_through,
            "older_conversation": context.summary,
            "recent_messages": context.recent_turns,
        })
    });
    Conversation {
        prompt,
        references,
        earlier_context_unavailable: context.earlier_context_unavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn envelope(revision: u8) -> ContextEnvelope {
        serde_json::from_value(json!({
            "schemaVersion": 1, "organizationId": "7", "companyId": "9", "sessionKey": "thread",
            "revision": revision, "coveredThrough": "23", "earlierContextUnavailable": false,
            "summary": {
                "objective": { "messageId": "1", "role": "user", "text": "Preserve opening balances" },
                "questions": [{ "messageId": "3", "role": "user", "text": "Which rows still lack units?" }],
                "highlights": [],
            },
            "recentTurns": [],
            "historyRefs": [{ "kind": "decision", "sessionKey": "thread", "messageId": "1", "decisionId": "a".repeat(32), "revision": 2 }],
        })).expect("valid context envelope")
    }

    #[test]
    fn chat_prompt_preserves_checkpoint_question_and_exact_reference() {
        let context = assemble(envelope(2), 7, 9, "thread");
        let prompt = context.prompt.expect("checkpoint context");
        assert_eq!(prompt["instruction_trust"], "untrusted");
        assert_eq!(
            prompt["older_conversation"]["questions"][0]["messageId"],
            "3"
        );
        assert!(
            matches!(&context.references[..], [HistoryReference::Decision { revision: 2, message_id, .. }] if message_id == "1")
        );
    }

    #[tokio::test]
    async fn compacted_chat_prompt_survives_provider_and_model_switch() {
        use crate::orchestrator::model_configuration::tests::route_chat_prompt_through_provider_switch;

        let mut checkpoint = envelope(2);
        checkpoint.recent_turns = vec![
            json!({"messageId": "24", "role": "user", "text": "Check the remaining rows."}),
            json!({"messageId": "25", "role": "assistant", "text": "Three rows need review."}),
        ];
        let conversation = assemble(checkpoint, 7, 9, "thread");
        let mut prompt = super::super::build_user_prompt_value("[]", None, None, "Resume", &[]);
        prompt["untrusted_context"]["earlier_conversation"] = conversation.prompt.unwrap();

        let sent = route_chat_prompt_through_provider_switch(prompt.to_string()).await;
        assert_eq!(sent, prompt);
        let history = &sent["untrusted_context"]["earlier_conversation"];
        assert_eq!(history["instruction_trust"], "untrusted");
        assert_eq!(history["checkpoint_revision"], 2);
        assert_eq!(
            history["older_conversation"]["objective"]["text"],
            "Preserve opening balances"
        );
        assert_eq!(
            history["older_conversation"]["questions"][0]["text"],
            "Which rows still lack units?"
        );
        assert_eq!(history["recent_messages"][1]["messageId"], "25");
    }

    #[test]
    fn empty_thread_has_no_prompt_and_mismatched_scope_has_no_data() {
        let mut fresh = envelope(0);
        fresh.history_refs.clear();
        let context = assemble(fresh, 7, 9, "thread");
        assert!(context.prompt.is_none());
        assert!(context.references.is_empty());
        let unauthorized = assemble(envelope(2), 7, 10, "thread");
        assert!(unauthorized.prompt.is_none());
        assert!(unauthorized.references.is_empty());
        assert!(unauthorized.earlier_context_unavailable);
    }
}
