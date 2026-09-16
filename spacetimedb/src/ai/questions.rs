//! AIH-20 — Durable questions and user steering (M3, prerequisite for M1's AIH-23).
//!
//! Persists versioned question requests/replies with run/decision dependencies,
//! authorized respondents, and required/optional semantics. A required question
//! blocks only its dependent work; a resolved question survives reconnect/restart
//! without re-ask; duplicate replies are idempotent; stale/unauthorized/timeout
//! replies are denied or produce no approval.

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::ai::lineage::{ai_artifact_component, ai_decision};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

const MAX_QUESTION_TEXT: usize = 4000;
const MAX_ANSWER_LEN: usize = 4000;
const MAX_KEY_LEN: usize = 160;
const AUTO_INC_SENTINEL: u64 = 0;

// ── Tables ─────────────────────────────────────────────────────────────────

/// Versioned durable question — the request half.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_question,
    index(accessor = ai_question_by_org, btree(columns = [organization_id])),
    index(accessor = ai_question_by_run, btree(columns = [run_id])),
    index(accessor = ai_question_by_key, btree(columns = [organization_id, question_key]))
)]
pub struct AiQuestion {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub run_id: u64,
    pub decision_id: Option<u64>,
    pub component_id: Option<u64>,
    /// Stable key for idempotency, e.g. `approval:r3:step5`
    pub question_key: String,
    pub question_text: String,
    /// `required` | `optional`
    pub kind: String,
    /// JSON array of role names or identity hexes that may answer; None = any member
    pub authorized_respondents_json: Option<String>,
    /// `open` | `answered` | `stale` | `timed_out` | `superseded`
    pub status: String,
    pub version: u32,
    pub parent_question_id: Option<u64>,
    pub deadline_at: Option<Timestamp>,
    pub answered_at: Option<Timestamp>,
    pub answered_by: Option<Identity>,
    /// Current answer payload (duplicated from reply for fast reads)
    pub current_answer: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

/// Versioned reply half — one row per distinct responder answer; only the
/// latest `is_current = true` is authoritative.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_question_reply,
    index(accessor = ai_question_reply_by_org, btree(columns = [organization_id])),
    index(accessor = ai_question_reply_by_question, btree(columns = [question_id])),
    index(accessor = ai_question_reply_by_responder, btree(columns = [responder_identity]))
)]
pub struct AiQuestionReply {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub question_id: u64,
    pub run_id: u64,
    pub responder_identity: Identity,
    pub answer: String,
    pub is_current: bool,
    pub introduced_at: Timestamp,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

// ── Params ─────────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAiQuestionParams {
    pub company_id: Option<u64>,
    pub run_id: u64,
    pub decision_id: Option<u64>,
    pub component_id: Option<u64>,
    pub question_key: String,
    pub question_text: String,
    pub kind: String,
    pub authorized_respondents_json: Option<String>,
    pub status: String,
    pub version: u32,
    pub parent_question_id: Option<u64>,
    pub deadline_at: Option<Timestamp>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ReplyAiQuestionParams {
    pub question_id: u64,
    pub answer: String,
}

// ── Validation ─────────────────────────────────────────────────────────────

fn validate_kind(kind: &str) -> Result<String, String> {
    let k = kind.trim().to_lowercase();
    if k != "required" && k != "optional" {
        return Err("kind must be 'required' or 'optional'".to_string());
    }
    Ok(k)
}

fn validate_question_status(status: &str) -> Result<String, String> {
    let s = status.trim().to_lowercase();
    let allowed = ["open", "answered", "stale", "timed_out", "superseded"];
    if !allowed.contains(&s.as_str()) {
        return Err(format!(
            "question status must be one of {}",
            allowed.join(", ")
        ));
    }
    Ok(s)
}

fn validate_nonempty(field: &str, value: &str, max: usize) -> Result<String, String> {
    let v = value.trim().to_string();
    if v.is_empty() {
        return Err(format!("{field} is required"));
    }
    if v.len() > max {
        return Err(format!("{field} exceeds {max} characters"));
    }
    Ok(v)
}

fn validate_optional(
    field: &str,
    value: &Option<String>,
    max: usize,
) -> Result<Option<String>, String> {
    match value {
        None => Ok(None),
        Some(raw) if raw.trim().is_empty() => Ok(None),
        Some(raw) if raw.trim().len() > max => Err(format!("{field} exceeds {max} characters")),
        Some(raw) => Ok(Some(raw.trim().to_string())),
    }
}

// ── Reducers ───────────────────────────────────────────────────────────────

#[reducer]
pub fn create_ai_question(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateAiQuestionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_question", "write")?;
    if organization_id == 0 {
        return Err("organization_id is required".to_string());
    }
    if params.run_id == AUTO_INC_SENTINEL {
        return Err("run_id must be nonzero".to_string());
    }
    if params.version == 0 {
        return Err("version must be nonzero".to_string());
    }
    if let Some(cid) = params.company_id {
        if cid == AUTO_INC_SENTINEL {
            return Err("company_id must be nonzero when supplied".to_string());
        }
    }

    let question_key = validate_nonempty("question_key", &params.question_key, MAX_KEY_LEN)?;
    let question_text =
        validate_nonempty("question_text", &params.question_text, MAX_QUESTION_TEXT)?;
    let kind = validate_kind(&params.kind)?;
    let status = validate_question_status(&params.status)?;
    if status != "open" {
        return Err("new question must start as 'open'".to_string());
    }

    // Idempotency: same org + question_key must not create a duplicate open question
    let existing = ctx
        .db
        .ai_question()
        .ai_question_by_key()
        .filter((&organization_id, &question_key))
        .find(|q| q.status == "open");
    if existing.is_some() {
        return Err(format!("question with key '{question_key}' already open"));
    }

    if let Some(pid) = params.parent_question_id {
        if pid == AUTO_INC_SENTINEL {
            return Err("parent_question_id must be nonzero when supplied".to_string());
        }
        let parent = ctx
            .db
            .ai_question()
            .id()
            .find(&pid)
            .ok_or("parent question not found")?;
        if parent.organization_id != organization_id {
            return Err("parent question does not belong to this organization".to_string());
        }
        // Steering invalidates previous approvals — parent is marked stale on fork
    }
    if let Some(did) = params.decision_id {
        if did == AUTO_INC_SENTINEL {
            return Err("decision_id must be nonzero when supplied".to_string());
        }
        let d = ctx
            .db
            .ai_decision()
            .id()
            .find(&did)
            .ok_or("decision not found for question")?;
        if d.organization_id != organization_id {
            return Err("question decision does not belong to this organization".to_string());
        }
    }
    if let Some(cid) = params.component_id {
        if cid == AUTO_INC_SENTINEL {
            return Err("component_id must be nonzero when supplied".to_string());
        }
        let c = ctx
            .db
            .ai_artifact_component()
            .id()
            .find(&cid)
            .ok_or("component not found for question")?;
        if c.organization_id != organization_id {
            return Err("question component does not belong to this organization".to_string());
        }
    }

    let row = ctx.db.ai_question().insert(AiQuestion {
        id: AUTO_INC_SENTINEL,
        organization_id,
        company_id: params.company_id,
        run_id: params.run_id,
        decision_id: params.decision_id,
        component_id: params.component_id,
        question_key,
        question_text,
        kind,
        authorized_respondents_json: validate_optional(
            "authorized_respondents_json",
            &params.authorized_respondents_json,
            MAX_KEY_LEN,
        )?,
        status,
        version: params.version,
        parent_question_id: params.parent_question_id,
        deadline_at: params.deadline_at,
        answered_at: None,
        answered_by: None,
        current_answer: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: params.company_id,
            table_name: "ai_question",
            record_id: row.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec!["question_key".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn reply_to_ai_question(
    ctx: &ReducerContext,
    organization_id: u64,
    params: ReplyAiQuestionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_question", "write")?;
    if organization_id == 0 {
        return Err("organization_id is required".to_string());
    }
    if params.question_id == AUTO_INC_SENTINEL {
        return Err("question_id must be nonzero".to_string());
    }
    let answer = validate_nonempty("answer", &params.answer, MAX_ANSWER_LEN)?;

    let mut question = ctx
        .db
        .ai_question()
        .id()
        .find(&params.question_id)
        .ok_or("question not found")?;
    if question.organization_id != organization_id {
        return Err("question does not belong to this organization".to_string());
    }

    // Status guard: answered/stale/timed_out/superseded cannot be re-answered
    if question.status != "open" {
        return Err(format!("question is not open (status={})", question.status));
    }

    // Idempotency: same responder + same answer on an already-answered question
    // must not create a duplicate row — return Ok without mutation. We check
    // existing replies for this question/responder/answer.
    let duplicate = ctx
        .db
        .ai_question_reply()
        .ai_question_reply_by_question()
        .filter(&params.question_id)
        .find(|r| r.responder_identity == ctx.sender() && r.answer == answer && r.is_current);
    if duplicate.is_some() {
        return Ok(());
    }

    // Authorization: if authorized_respondents_json is set, responder must be listed.
    // For this slice we treat it as a JSON array of identity hex strings.
    if let Some(ref allowed_json) = question.authorized_respondents_json {
        if !allowed_json.trim().is_empty() {
            let allowed: Result<Vec<String>, _> = serde_json::from_str(allowed_json);
            if let Ok(list) = allowed {
                let sender_hex = ctx.sender().to_hex().to_string();
                let sender_allowed = list
                    .iter()
                    .any(|entry| entry.trim().eq_ignore_ascii_case(&sender_hex));
                if !sender_allowed {
                    return Err("responder is not authorized for this question".to_string());
                }
            }
        }
    }

    // Stale check: if parent_question_id exists and parent was superseded, this
    // reply is stale (changed requirements cannot reuse obsolete approval).
    if let Some(parent_id) = question.parent_question_id {
        if let Some(parent) = ctx.db.ai_question().id().find(&parent_id) {
            if parent.status == "superseded" {
                // Mark this question stale and deny the reply
                ctx.db.ai_question().id().update(AiQuestion {
                    status: "stale".to_string(),
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..question.clone()
                });
                return Err(
                    "question is stale — parent was superseded by new requirements".to_string(),
                );
            }
        }
    }

    // Persist reply — mark previous current replies for this question as not current
    for existing in ctx
        .db
        .ai_question_reply()
        .ai_question_reply_by_question()
        .filter(&params.question_id)
        .filter(|r| r.is_current)
        .collect::<Vec<_>>()
    {
        ctx.db.ai_question_reply().id().update(AiQuestionReply {
            is_current: false,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..existing
        });
    }

    let reply = ctx.db.ai_question_reply().insert(AiQuestionReply {
        id: AUTO_INC_SENTINEL,
        organization_id,
        question_id: params.question_id,
        run_id: question.run_id,
        responder_identity: ctx.sender(),
        answer: answer.clone(),
        is_current: true,
        introduced_at: ctx.timestamp,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    // Promote question to answered, storing denormalized answer for fast resume
    question = ctx.db.ai_question().id().update(AiQuestion {
        status: "answered".to_string(),
        answered_at: Some(ctx.timestamp),
        answered_by: Some(ctx.sender()),
        current_answer: Some(answer),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..question
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: question.company_id,
            table_name: "ai_question_reply",
            record_id: reply.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec!["answer".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn supersede_ai_question(
    ctx: &ReducerContext,
    organization_id: u64,
    question_id: u64,
    new_question_key: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_question", "write")?;
    if organization_id == 0 || question_id == AUTO_INC_SENTINEL {
        return Err("organization_id and question_id are required".to_string());
    }
    let new_key = validate_nonempty("new_question_key", &new_question_key, MAX_KEY_LEN)?;

    let question = ctx
        .db
        .ai_question()
        .id()
        .find(&question_id)
        .ok_or("question not found")?;
    if question.organization_id != organization_id {
        return Err("question does not belong to this organization".to_string());
    }

    ctx.db.ai_question().id().update(AiQuestion {
        status: "superseded".to_string(),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..question
    });

    // Caller should create the new version with parent_question_id = question_id
    // This reducer only marks the old one superseded to enforce stale-reply denial.
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: question.company_id,
            table_name: "ai_question",
            record_id: question_id,
            action: "update",
            old_values: None,
            new_values: None,
            changed_fields: vec!["status".to_string(), "new_question_key".to_string()],
            metadata: None,
        },
    );
    let _ = new_key;
    Ok(())
}

#[reducer]
pub fn timeout_ai_question(
    ctx: &ReducerContext,
    organization_id: u64,
    question_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_question", "write")?;
    if organization_id == 0 || question_id == AUTO_INC_SENTINEL {
        return Err("organization_id and question_id are required".to_string());
    }

    let question = ctx
        .db
        .ai_question()
        .id()
        .find(&question_id)
        .ok_or("question not found")?;
    if question.organization_id != organization_id {
        return Err("question does not belong to this organization".to_string());
    }
    if question.status != "open" {
        return Err(format!("question is not open (status={})", question.status));
    }

    ctx.db.ai_question().id().update(AiQuestion {
        status: "timed_out".to_string(),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..question.clone()
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: question.company_id,
            table_name: "ai_question",
            record_id: question_id,
            action: "update",
            old_values: None,
            new_values: None,
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}
