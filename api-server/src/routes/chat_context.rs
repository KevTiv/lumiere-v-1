//! Bounded conversational checkpoints. The transcript remains the source of truth.
use std::{collections::HashMap, sync::Arc, time::Duration};

use axum::{
    extract::{DefaultBodyLimit, State},
    http::HeaderMap,
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use stdb_auth::{
    has_resource_field_read_permission, has_resource_read_permission, FieldAccessContext,
};
use tokio::sync::Semaphore;

use crate::{
    cold_tier::pg_pool, error::ApiError, query_exec::resolve_membership_company_id,
    session::load_field_access_context, state::AppState, trusted_context::TrustedOperationContext,
    web_session::OrgSession,
};

const MAX_SOURCE_ROWS: usize = 30;
const MAX_RECENT_TURNS: usize = 7;
const MAX_EXCERPT_BYTES: usize = 768;
const MAX_REFERENCES: usize = 8;
const MAX_REFERENCE_BYTES: usize = 512;
/// Envelope version. 2 adds `anchorRefs`; the stored checkpoint stays at 1.
const CONTEXT_SCHEMA_VERSION: u8 = 2;
const MAX_ANCHOR_REFS: usize = 8;
/// Live entity types the gateway can re-read. The gateway still re-authorizes
/// every anchor for the asking actor; this only bounds what is carried over.
const ANCHOR_ENTITY_TYPES: &[&str] = &[
    "sale_order",
    "purchase_order",
    "project_task",
    "account_move",
    "mrp_production",
    "product",
    "contact",
    "account_move_line",
    "account_account",
    "account_payment",
    "stock_move",
    "stock_move_line",
    "stock_picking",
    "stock_cycle_count",
    "stock_quant",
    "stock_location",
    "fleet_inspection",
    "fleet_service_record",
    "fleet_vehicle",
    "lead",
    "opportunity",
    "hr_expense",
    "hr_expense_sheet",
    "subscription_line",
    "subscription",
];
const MAX_HIGHLIGHTS: usize = 5;
const MAX_QUESTIONS: usize = 3;
const MIN_CONTEXT_BYTES: usize = 4 * 1024;
const MAX_CONTEXT_BYTES: usize = 16 * 1024;
const CONTEXT_TIMEOUT: Duration = Duration::from_secs(8);
static CONTEXT_SLOTS: Semaphore = Semaphore::const_new(4);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ContextRequest {
    company_id: u64,
    session_key: String,
    context_byte_budget: Option<usize>,
    #[serde(default)]
    scope_only: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Excerpt {
    message_id: String,
    role: String,
    text: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Summary {
    objective: Option<Excerpt>,
    questions: Vec<Excerpt>,
    highlights: Vec<Excerpt>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Checkpoint {
    schema_version: u8,
    summary: Summary,
    history_refs: Vec<Value>,
    #[serde(default)]
    pending_users: Vec<u64>,
}

impl Default for Checkpoint {
    fn default() -> Self {
        Self {
            schema_version: 1,
            summary: Summary::default(),
            history_refs: Vec::new(),
            pending_users: Vec::new(),
        }
    }
}

/// Identity of a record cited by the last grounded answer. Never its content.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AnchorRef {
    entity_type: String,
    entity_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContextResponse {
    schema_version: u8,
    organization_id: String,
    company_id: String,
    session_key: String,
    revision: i64,
    covered_through: String,
    earlier_context_unavailable: bool,
    summary: Summary,
    recent_turns: Vec<Excerpt>,
    history_refs: Vec<Value>,
    anchor_refs: Vec<AnchorRef>,
}

struct Message<'a> {
    id: u64,
    role: &'a str,
    text: &'a str,
    metadata: Value,
    turn_id: Option<&'a str>,
    safe_assistant_excerpt: bool,
    sources_json: &'a str,
}

impl<'a> Message<'a> {
    fn read(row: &'a Value) -> Option<Self> {
        let id = row["id"]
            .as_u64()
            .or_else(|| row["id"].as_str()?.parse().ok())?;
        let role = row["role"].as_str()?;
        let text = row["content"].as_str()?;
        if !matches!(role, "user" | "assistant") || row["status"].as_str() != Some("completed") {
            return None;
        }
        let metadata = row["metadata"]
            .as_str()
            .and_then(|value| serde_json::from_str(value).ok())
            .unwrap_or(Value::Null);
        // Assistant prose may contain data from records whose access changes.
        // Reintroduce only messages without any model, source, or workflow context.
        let safe_assistant_excerpt = row["model"].is_null()
            && row["sourcesJson"].as_str() == Some("[]")
            && metadata
                .as_object()
                .is_none_or(|map| map.keys().all(|key| key == "turnId"));
        Some(Self {
            id,
            role,
            text,
            metadata,
            turn_id: row["turnId"].as_str().filter(|id| !id.is_empty()),
            safe_assistant_excerpt,
            sources_json: row["sourcesJson"].as_str().unwrap_or("[]"),
        })
    }

    fn excerpt(&self) -> Excerpt {
        let mut end = self.text.len().min(MAX_EXCERPT_BYTES);
        while !self.text.is_char_boundary(end) {
            end -= 1;
        }
        Excerpt {
            message_id: self.id.to_string(),
            role: self.role.to_owned(),
            text: self.text[..end].to_owned(),
        }
    }

    fn turn_id(&self) -> Option<&str> {
        self.turn_id
            .or_else(|| self.metadata["turnId"].as_str().filter(|id| id.len() == 36))
    }
}

struct Turn<'a> {
    user: &'a Message<'a>,
    assistant: &'a Message<'a>,
}

fn complete_turns<'a>(messages: &'a [Message<'a>]) -> Vec<Turn<'a>> {
    let mut pending = HashMap::new();
    let mut legacy = None;
    let mut turns = Vec::new();
    for message in messages {
        match (message.role, message.turn_id()) {
            ("user", Some(id)) => {
                pending.insert(id, message);
                legacy = None;
            }
            ("assistant", Some(id)) => {
                if let Some(user) = pending.remove(id) {
                    turns.push(Turn {
                        user,
                        assistant: message,
                    });
                }
                legacy = None;
            }
            ("user", None) => legacy = Some(message),
            ("assistant", None) => {
                if let Some(user) = legacy.take() {
                    turns.push(Turn {
                        user,
                        assistant: message,
                    });
                }
            }
            _ => {}
        }
    }
    turns
}

/// `(entity_type, entity_id)` pairs of the newest grounded assistant answer.
///
/// Only identities are read from the saved sources: no prose, snippet, label or
/// field value is carried. Turns without sources (fixed replies, errors) are
/// skipped so they do not erase the last grounded subject. The gateway treats
/// every pair as a hint and re-authorizes it for the current actor.
fn anchor_refs(turns: &[Turn<'_>]) -> Vec<AnchorRef> {
    for turn in turns.iter().rev() {
        let Ok(Value::Array(sources)) = serde_json::from_str::<Value>(turn.assistant.sources_json)
        else {
            continue;
        };
        if sources.is_empty() {
            continue;
        }
        let mut anchors: Vec<AnchorRef> = Vec::new();
        for source in &sources {
            if source["kind"].as_str() != Some("live")
                || source["trust"].as_str() != Some("authoritative")
            {
                continue;
            }
            let (Some(entity_type), Some(entity_id)) =
                (source["entity_type"].as_str(), source["entity_id"].as_str())
            else {
                continue;
            };
            let entity_type = entity_type.trim().to_ascii_lowercase().replace('-', "_");
            let valid_id = !entity_id.is_empty()
                && entity_id.len() <= 20
                && entity_id.bytes().all(|byte| byte.is_ascii_digit())
                && entity_id.bytes().any(|byte| byte != b'0');
            if !valid_id || !ANCHOR_ENTITY_TYPES.contains(&entity_type.as_str()) {
                continue;
            }
            let anchor = AnchorRef {
                entity_type,
                entity_id: entity_id.trim_start_matches('0').to_owned(),
            };
            if !anchors.contains(&anchor) {
                anchors.push(anchor);
            }
            if anchors.len() == MAX_ANCHOR_REFS {
                break;
            }
        }
        return anchors;
    }
    Vec::new()
}

fn track_unfinished(checkpoint: &mut Checkpoint, messages: &[Message<'_>], through: u64) -> bool {
    let mut pending = HashMap::new();
    for message in messages.iter().filter(|message| message.id <= through) {
        if let Some(id) = message.turn_id() {
            if message.role == "user" {
                pending.insert(id, message.id);
            } else {
                pending.remove(id);
            }
        }
    }
    let mut pending = pending.into_values().collect::<Vec<_>>();
    pending.sort_unstable();
    checkpoint.pending_users = pending;
    let too_many = checkpoint.pending_users.len() > MAX_SOURCE_ROWS;
    checkpoint.pending_users.truncate(MAX_SOURCE_ROWS);
    too_many
}

fn add_references(output: &mut Vec<Value>, metadata: &Value) {
    let Some(refs) = metadata["historyRefs"].as_array() else {
        return;
    };
    for reference in refs.iter().take(MAX_REFERENCES) {
        let valid = matches!(
            reference["kind"].as_str(),
            Some(
                "message" | "decision" | "import_decision" | "import_mapping" | "approval_receipt"
            )
        ) && serde_json::to_vec(reference)
            .is_ok_and(|bytes| bytes.len() <= MAX_REFERENCE_BYTES);
        if valid && output.len() < MAX_REFERENCES && !output.contains(reference) {
            output.push(reference.clone());
        }
    }
}

fn compact(checkpoint: &mut Checkpoint, turns: &[Turn<'_>]) -> u64 {
    let mut through = 0;
    for turn in turns {
        let excerpt = turn.user.excerpt();
        if checkpoint.summary.objective.is_none() {
            checkpoint.summary.objective = Some(excerpt.clone());
        }
        if turn.user.text.trim_end().ends_with('?') {
            if checkpoint.summary.questions.len() == MAX_QUESTIONS {
                // Preserve the original question and reserve space for new ones.
                checkpoint.summary.questions.remove(1);
            }
            checkpoint.summary.questions.push(excerpt.clone());
        }
        if checkpoint.summary.highlights.len() == MAX_HIGHLIGHTS {
            checkpoint.summary.highlights.remove(0);
        }
        checkpoint.summary.highlights.push(excerpt);
        add_references(&mut checkpoint.history_refs, &turn.user.metadata);
        through = turn.assistant.id;
    }
    through
}

fn valid_key(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 150
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn require_gateway(headers: &HeaderMap) -> Result<(), ApiError> {
    let expected = std::env::var("LUMIERE_AI_GATEWAY_INTERNAL_SECRET")
        .ok()
        .filter(|secret| !secret.trim().is_empty())
        .ok_or_else(|| ApiError::Unavailable("Assistant context is unavailable".into()))?;
    let provided = headers
        .get("x-lumiere-gateway-secret")
        .ok_or(ApiError::Unauthorized)?;
    // Compare fixed-width digests without exiting on a differing byte.
    let different = Sha256::digest(expected.as_bytes())
        .iter()
        .zip(Sha256::digest(provided.as_bytes()))
        .fold(0, |acc, (a, b)| acc | (a ^ b));
    if different != 0 {
        return Err(ApiError::Unauthorized);
    }
    Ok(())
}

async fn context(
    State(state): State<Arc<AppState>>,
    session: OrgSession,
    headers: HeaderMap,
    Json(request): Json<ContextRequest>,
) -> Result<Json<ContextResponse>, ApiError> {
    require_gateway(&headers)?;
    if request.company_id == 0 || !valid_key(&request.session_key) {
        return Err(ApiError::BadRequest(
            "Invalid Assistant thread scope".into(),
        ));
    }
    let _permit = CONTEXT_SLOTS
        .try_acquire()
        .map_err(|_| ApiError::RateLimited("Assistant context is busy. Try again.".into()))?;
    tokio::time::timeout(CONTEXT_TIMEOUT, assemble(&state, session, request))
        .await
        .map_err(|_| ApiError::Unavailable("Assistant context timed out. Try again.".into()))?
        .map(Json)
}

fn require_context_read(access: &FieldAccessContext) -> Result<(), ApiError> {
    for (resource, fields) in [
        ("ai_chat_session", &["id", "session_key", "archived"][..]),
        (
            "ai_chat_message",
            &[
                "id",
                "session_key",
                "role",
                "content",
                "status",
                "model",
                "sources_json",
                "metadata",
                "turn_id",
            ][..],
        ),
    ] {
        let access = Some(access);
        if !has_resource_read_permission(access, resource)
            || fields
                .iter()
                .any(|field| !has_resource_field_read_permission(access, resource, field))
        {
            return Err(ApiError::Forbidden(
                "Assistant thread is unavailable".into(),
            ));
        }
    }
    Ok(())
}

async fn recheck_context_scope(
    state: &AppState,
    auth: &TrustedOperationContext,
    company: u64,
) -> Result<(), ApiError> {
    auth.require_current_placement(&state.organization_placements)?;
    let org = auth.organization_id();
    let actor = auth.actor_identity();
    let current = load_field_access_context(&state.stdb, actor, org)
        .await
        .map_err(ApiError::Internal)?
        .ok_or(ApiError::Unauthorized)?;
    require_context_read(&current)?;
    resolve_membership_company_id(
        auth.client(),
        org,
        actor,
        Some(company),
        "Assistant thread is unavailable",
    )
    .await?;
    auth.require_current_placement(&state.organization_placements)
}

async fn assemble(
    state: &AppState,
    session: OrgSession,
    request: ContextRequest,
) -> Result<ContextResponse, ApiError> {
    let auth = TrustedOperationContext::for_resource_read(state, &session.session)?;
    auth.require_current_placement(&state.organization_placements)?;
    require_context_read(auth.field_access())?;
    let org = auth.organization_id();
    let actor = auth.actor_identity();
    let company = resolve_membership_company_id(
        auth.client(),
        org,
        actor,
        Some(request.company_id),
        "Assistant thread is unavailable",
    )
    .await?;
    let key = request.session_key.as_str();
    let head = state
        .stdb
        .chat_session(org, company, actor, key)
        .await
        .map_err(ApiError::unavailable)?
        .ok_or_else(|| ApiError::NotFound("Assistant thread is unavailable".into()))?;
    if head["archived"].as_bool() != Some(false) {
        return Err(ApiError::Conflict(
            "Restore this thread before continuing".into(),
        ));
    }
    if request.scope_only {
        recheck_context_scope(state, &auth, company).await?;
        return Ok(ContextResponse {
            schema_version: CONTEXT_SCHEMA_VERSION,
            organization_id: org.to_string(),
            company_id: company.to_string(),
            session_key: request.session_key,
            revision: 0,
            covered_through: "0".into(),
            earlier_context_unavailable: false,
            summary: Summary::default(),
            recent_turns: Vec::new(),
            history_refs: Vec::new(),
            anchor_refs: Vec::new(),
        });
    }
    let latest = state
        .stdb
        .chat_message_page(org, company, actor, key, None, MAX_SOURCE_ROWS)
        .await
        .map_err(ApiError::unavailable)?;
    let messages = latest.iter().filter_map(Message::read).collect::<Vec<_>>();
    let turns = complete_turns(&messages);
    let recent_start = turns.len().saturating_sub(MAX_RECENT_TURNS);
    let compact_through = turns
        .get(recent_start)
        .and_then(|turn| turn.user.id.checked_sub(1))
        .unwrap_or_default();
    let org_text = org.to_string();
    let company_text = company.to_string();
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let mut client = pool.get().await.map_err(ApiError::unavailable)?;
    let tx = client.transaction().await.map_err(ApiError::unavailable)?;
    let lock_key = format!("assistant-context:{org}:{company}:{actor}:{key}");
    let acquired = tx
        .query_one(
            "select pg_try_advisory_xact_lock(hashtextextended($1, 0))",
            &[&lock_key],
        )
        .await
        .map_err(ApiError::unavailable)?
        .get::<_, bool>(0);
    let current = tx.query_opt("select revision, covered_through::text, checkpoint from lumiere_platform.ai_chat_context_checkpoint where organization_id=$1::text::numeric and company_id=$2::text::numeric and actor_identity=$3 and session_key=$4", &[&org_text, &company_text, &actor, &key]).await.map_err(ApiError::unavailable)?;
    let mut revision = current.as_ref().map_or(0, |row| row.get::<_, i64>(0));
    let mut covered = current
        .as_ref()
        .and_then(|row| row.get::<_, String>(1).parse::<u64>().ok())
        .unwrap_or_default();
    let mut checkpoint = current
        .as_ref()
        .and_then(|row| serde_json::from_value::<Checkpoint>(row.get::<_, Value>(2)).ok())
        .filter(|checkpoint| checkpoint.schema_version == 1);
    let rebuild = current.is_some() && checkpoint.is_none();
    if rebuild {
        covered = 0;
    }
    let mut checkpoint = checkpoint.take().unwrap_or_default();
    let mut earlier_unavailable = rebuild
        || latest.iter().any(|row| row["historyTruncated"] == true)
        || covered < compact_through && !acquired;
    if acquired && covered < compact_through {
        match state
            .stdb
            .chat_message_range(
                org,
                company,
                actor,
                key,
                covered,
                compact_through,
                MAX_SOURCE_ROWS,
            )
            .await
        {
            Ok(mut rows) => {
                let page_full = rows.len() == MAX_SOURCE_ROWS;
                for id in checkpoint.pending_users.iter().take(4) {
                    if let Ok(Some(row)) =
                        state.stdb.chat_message(org, company, actor, key, *id).await
                    {
                        rows.push(row);
                    }
                }
                let mut older_messages = rows.iter().filter_map(Message::read).collect::<Vec<_>>();
                older_messages.sort_unstable_by_key(|message| message.id);
                let older_turns = complete_turns(&older_messages)
                    .into_iter()
                    .filter(|turn| turn.assistant.id > covered)
                    .collect::<Vec<_>>();
                let next = compact(&mut checkpoint, &older_turns);
                if next > covered {
                    earlier_unavailable |= track_unfinished(&mut checkpoint, &older_messages, next);
                    let next_cursor = next.to_string();
                    let saved = tx.query_opt("insert into lumiere_platform.ai_chat_context_checkpoint (organization_id,company_id,actor_identity,session_key,revision,covered_through,checkpoint) values ($1::text::numeric,$2::text::numeric,$3,$4,1,$5::text::numeric,$6) on conflict (organization_id,company_id,actor_identity,session_key) do update set revision=ai_chat_context_checkpoint.revision+1, covered_through=excluded.covered_through, checkpoint=excluded.checkpoint, updated_at=now() where ai_chat_context_checkpoint.revision=$7 and ($8 or ai_chat_context_checkpoint.covered_through<excluded.covered_through) returning revision", &[&org_text, &company_text, &actor, &key, &next_cursor, &serde_json::to_value(&checkpoint).map_err(ApiError::internal)?, &revision, &rebuild]).await.map_err(ApiError::unavailable)?;
                    if let Some(row) = saved {
                        revision = row.get(0);
                        covered = next;
                    } else {
                        return Err(ApiError::Unavailable(
                            "Assistant context changed. Try again.".into(),
                        ));
                    }
                }
                earlier_unavailable |=
                    page_full || rows.iter().any(|row| row["historyTruncated"] == true);
            }
            Err(_) => earlier_unavailable = true,
        }
    }
    let mut recent = Vec::new();
    let mut refs = super::assistant_chat_references::checkpoint_notes(
        &tx,
        &org_text,
        &company_text,
        actor,
        key,
    )
    .await?;
    tx.commit().await.map_err(ApiError::unavailable)?;
    add_references(
        &mut refs,
        &serde_json::json!({"historyRefs": checkpoint.history_refs}),
    );
    for turn in turns.iter().skip(recent_start) {
        recent.push(turn.user.excerpt());
        if turn.assistant.safe_assistant_excerpt {
            recent.push(turn.assistant.excerpt());
        }
        add_references(&mut refs, &turn.user.metadata);
    }
    let mut output = ContextResponse {
        schema_version: CONTEXT_SCHEMA_VERSION,
        organization_id: org_text,
        company_id: company_text,
        session_key: request.session_key,
        revision,
        covered_through: covered.to_string(),
        earlier_context_unavailable: earlier_unavailable,
        summary: checkpoint.summary,
        recent_turns: recent,
        history_refs: refs,
        anchor_refs: anchor_refs(&turns),
    };
    let budget = request
        .context_byte_budget
        .unwrap_or(MAX_CONTEXT_BYTES)
        .clamp(MIN_CONTEXT_BYTES, MAX_CONTEXT_BYTES);
    while serde_json::to_vec(&output)
        .map_err(ApiError::internal)?
        .len()
        > budget
    {
        if !output.summary.highlights.is_empty() {
            output.summary.highlights.remove(0);
        } else if !output.recent_turns.is_empty() {
            output.recent_turns.remove(0);
        } else if output.summary.questions.pop().is_some() {
        } else if output.history_refs.pop().is_some() {
        } else if output.anchor_refs.pop().is_none() {
            break;
        }
        output.earlier_context_unavailable = true;
    }
    recheck_context_scope(state, &auth, company).await?;
    tracing::debug!(
        organization_id = org,
        company_id = company,
        checkpoint_revision = revision,
        source_rows = latest.len(),
        context_budget_bytes = budget,
        earlier_context_unavailable = output.earlier_context_unavailable,
        "Assistant context assembled"
    );
    Ok(output)
}

pub(super) fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/ai/chat/context", post(context))
        .layer(DefaultBodyLimit::max(4096))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn compaction_preserves_first_objective_and_typed_reference_with_bounded_recent_highlights() {
        let turn_id = "fbf63d6e-0160-4658-8ba5-846b57ced04c";
        let reference = json!({"kind":"decision","messageId":"1","revision":2});
        let mut checkpoint = Checkpoint::default();
        for index in 0..1000 {
            let user = Message {
                id: 2 * index + 1,
                role: "user",
                text: if index == 0 {
                    "Original opening balance mapping?"
                } else {
                    "another import question?"
                },
                metadata: json!({"turnId":turn_id,"historyRefs":[reference]}),
                turn_id: Some(turn_id),
                safe_assistant_excerpt: false,
                sources_json: "[]",
            };
            let assistant = Message {
                id: 2 * index + 2,
                role: "assistant",
                text: "private source excerpt",
                metadata: json!({"turnId":turn_id}),
                turn_id: Some(turn_id),
                safe_assistant_excerpt: false,
                sources_json: "[]",
            };
            assert_eq!(
                compact(&mut checkpoint, &complete_turns(&[user, assistant])),
                2 * index + 2
            );
        }
        assert_eq!(
            checkpoint.summary.objective.as_ref().unwrap().message_id,
            "1"
        );
        assert_eq!(checkpoint.summary.questions[0].message_id, "1");
        assert_eq!(checkpoint.summary.highlights.len(), MAX_HIGHLIGHTS);
        assert_eq!(checkpoint.history_refs, vec![reference]);
        assert!(!serde_json::to_string(&checkpoint)
            .unwrap()
            .contains("private source"));
    }

    #[test]
    fn incomplete_and_interleaved_turns_do_not_form_false_pairs() {
        let user = Message {
            id: 1,
            role: "user",
            text: "pending",
            metadata: json!({"turnId":"fbf63d6e-0160-4658-8ba5-846b57ced04c"}),
            turn_id: Some("fbf63d6e-0160-4658-8ba5-846b57ced04c"),
            safe_assistant_excerpt: false,
            sources_json: "[]",
        };
        let assistant = Message {
            id: 2,
            role: "assistant",
            text: "unrelated",
            metadata: json!({"turnId":"c795112d-1ab2-4a23-9cd0-ccca1ff2996e"}),
            turn_id: Some("c795112d-1ab2-4a23-9cd0-ccca1ff2996e"),
            safe_assistant_excerpt: false,
            sources_json: "[]",
        };
        assert!(complete_turns(&[user, assistant]).is_empty());
    }

    fn grounded_turn<'a>(
        base: u64,
        turn_id: &'a str,
        sources: &'a str,
        text: &'a str,
    ) -> [Message<'a>; 2] {
        [
            Message {
                id: base,
                role: "user",
                text: "question?",
                metadata: json!({"turnId":turn_id}),
                turn_id: Some(turn_id),
                safe_assistant_excerpt: false,
                sources_json: "[]",
            },
            Message {
                id: base + 1,
                role: "assistant",
                text,
                metadata: json!({"turnId":turn_id}),
                turn_id: Some(turn_id),
                safe_assistant_excerpt: false,
                sources_json: sources,
            },
        ]
    }

    fn anchors_of(messages: &[Message<'_>]) -> Vec<AnchorRef> {
        anchor_refs(&complete_turns(messages))
    }

    const TURN_A: &str = "fbf63d6e-0160-4658-8ba5-846b57ced04c";
    const TURN_B: &str = "c795112d-1ab2-4a23-9cd0-ccca1ff2996e";

    #[test]
    fn anchors_are_identities_from_the_newest_grounded_answer_never_prose() {
        let older = grounded_turn(
            1,
            TURN_A,
            r#"[{"kind":"live","trust":"authoritative","entity_type":"sale_order","entity_id":"5","text_snippet":"x"}]"#,
            "older",
        );
        let sources = r#"[
            {"kind":"live","trust":"authoritative","entity_type":"account-move","entity_id":"123","label":"Invoice INV-0123","text_snippet":"SECRET-AMOUNT"},
            {"kind":"live","trust":"authoritative","entity_type":"account_move","entity_id":"0123"},
            {"kind":"passage","trust":"retrieved","entity_type":"sale_order","entity_id":"9","text_snippet":"p"},
            {"kind":"live","trust":"authoritative","entity_type":"import_task","entity_id":"7"},
            {"kind":"live","trust":"authoritative","entity_type":"contact","entity_id":"abc"},
            {"kind":"live","trust":"authoritative","entity_type":"contact","entity_id":"0"},
            {"kind":"live","trust":"authoritative","entity_type":"contact","entity_id":"44"}
        ]"#;
        let newest = grounded_turn(3, TURN_B, sources, "The invoice total is 9,000 EUR");
        let [a_user, a_assistant] = older;
        let [b_user, b_assistant] = newest;
        let anchors = anchors_of(&[a_user, a_assistant, b_user, b_assistant]);
        assert_eq!(
            anchors,
            vec![
                AnchorRef {
                    entity_type: "account_move".into(),
                    entity_id: "123".into()
                },
                AnchorRef {
                    entity_type: "contact".into(),
                    entity_id: "44".into()
                },
            ]
        );
        let encoded = serde_json::to_string(&anchors).unwrap();
        assert!(
            !encoded.contains("SECRET") && !encoded.contains("9,000") && !encoded.contains("INV")
        );
    }

    #[test]
    fn anchors_are_capped_deduplicated_and_skip_unsourced_replies() {
        let many = (1..=20)
            .map(|id| format!(r#"{{"kind":"live","trust":"authoritative","entity_type":"product","entity_id":"{id}"}}"#))
            .collect::<Vec<_>>()
            .join(",");
        let sources = format!("[{many}]");
        let grounded = grounded_turn(1, TURN_A, &sources, "answer");
        // A later fixed reply without sources must not erase the last subject.
        let fixed = grounded_turn(3, TURN_B, "[]", "No authorized data");
        let [g_user, g_assistant] = grounded;
        let [f_user, f_assistant] = fixed;
        let anchors = anchors_of(&[g_user, g_assistant, f_user, f_assistant]);
        assert_eq!(anchors.len(), MAX_ANCHOR_REFS);
        assert_eq!(anchors[0].entity_id, "1");
        assert!(anchors_of(&grounded_turn(1, TURN_A, "not json", "x")).is_empty());
    }

    #[test]
    fn anchored_envelope_stays_within_the_context_budget() {
        let anchors = (1..=MAX_ANCHOR_REFS)
            .map(|id| AnchorRef {
                entity_type: "stock_move_line".into(),
                entity_id: id.to_string(),
            })
            .collect::<Vec<_>>();
        let output = ContextResponse {
            schema_version: CONTEXT_SCHEMA_VERSION,
            organization_id: "1".into(),
            company_id: "2".into(),
            session_key: "k".into(),
            revision: 0,
            covered_through: "0".into(),
            earlier_context_unavailable: false,
            summary: Summary::default(),
            recent_turns: Vec::new(),
            history_refs: Vec::new(),
            anchor_refs: anchors,
        };
        let bytes = serde_json::to_vec(&output).unwrap();
        assert!(bytes.len() < MIN_CONTEXT_BYTES);
        assert!(String::from_utf8(bytes)
            .unwrap()
            .contains(r#""schemaVersion":2"#));
    }
}
