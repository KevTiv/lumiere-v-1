/// Messaging (Chatter) — MailMessage & MailFollower
///
/// Backs the `message_ids` and `message_follower_ids` Vec<u64> fields on 30+ tables.
///
/// Design: polymorphic association via `model` + `res_id`.
/// Clients query messages by model+res_id rather than through the Vec<u64> fields.
/// The Vec<u64> fields on parent tables remain for backwards-compat but are not maintained.
use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

use crate::types::MailMessageType;

// ── Tables ────────────────────────────────────────────────────────────────────

/// Mail Message — A single message, note, or email attached to any record.
///
/// Query messages for a record via the `mail_message_by_record` index:
///   `ctx.db.mail_message().mail_message_by_record().filter(&(model.clone(), res_id))`
///
/// Note: SpacetimeDB indexes on individual columns, not tuples — filter by model then res_id.
#[spacetimedb::table(
    accessor = mail_message,
    public,
    index(accessor = mail_message_by_model, btree(columns = [model])),
    index(accessor = mail_message_by_author, btree(columns = [author_id]))
)]
pub struct MailMessage {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub model: String,                  // "sale_order" | "purchase_order" | "account_move" | …
    pub res_id: u64,                    // PK of the record in that model's table
    pub author_id: Identity,
    pub body: String,
    pub message_type: MailMessageType,  // Comment | Note | Email | Notification
    pub subtype: Option<String>,        // e.g. "mail.mt_comment", "mail.mt_note"
    pub date: Timestamp,
    pub parent_id: Option<u64>,         // For threaded replies → FK to MailMessage.id
    pub attachment_ids: Vec<u64>,       // Document attachment IDs
}

/// Mail Follower — A user subscribed to notifications on a record.
///
/// Query followers for a record via `mail_follower_by_model` index.
#[spacetimedb::table(
    accessor = mail_follower,
    public,
    index(accessor = mail_follower_by_model, btree(columns = [res_model])),
    index(accessor = mail_follower_by_partner, btree(columns = [partner_id]))
)]
pub struct MailFollower {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub res_model: String,              // "sale_order" | "purchase_order" | …
    pub res_id: u64,                    // PK of the followed record
    pub partner_id: Identity,           // The following user's identity
    pub subtypes: Vec<String>,          // ["comment", "note"] — which events trigger notifications
}

// ── Reducers ──────────────────────────────────────────────────────────────────

/// Post a message (comment visible to all followers) on any record.
#[reducer]
pub fn post_message(
    ctx: &ReducerContext,
    model: String,
    res_id: u64,
    body: String,
    parent_id: Option<u64>,
    attachment_ids: Vec<u64>,
) -> Result<(), String> {
    if model.is_empty() {
        return Err("model cannot be empty".to_string());
    }
    if body.is_empty() {
        return Err("Message body cannot be empty".to_string());
    }
    ctx.db.mail_message().insert(MailMessage {
        id: 0,
        model,
        res_id,
        author_id: ctx.sender(),
        body,
        message_type: MailMessageType::Comment,
        subtype: Some("mail.mt_comment".to_string()),
        date: ctx.timestamp,
        parent_id,
        attachment_ids,
    });
    Ok(())
}

/// Post an internal note (only visible to internal users, not customers) on any record.
#[reducer]
pub fn post_internal_note(
    ctx: &ReducerContext,
    model: String,
    res_id: u64,
    body: String,
) -> Result<(), String> {
    if model.is_empty() {
        return Err("model cannot be empty".to_string());
    }
    if body.is_empty() {
        return Err("Note body cannot be empty".to_string());
    }
    ctx.db.mail_message().insert(MailMessage {
        id: 0,
        model,
        res_id,
        author_id: ctx.sender(),
        body,
        message_type: MailMessageType::Note,
        subtype: Some("mail.mt_note".to_string()),
        date: ctx.timestamp,
        parent_id: None,
        attachment_ids: vec![],
    });
    Ok(())
}

/// Subscribe the calling identity to a record.
/// If already subscribed, updates the subtypes list.
#[reducer]
pub fn subscribe_to_record(
    ctx: &ReducerContext,
    res_model: String,
    res_id: u64,
    subtypes: Vec<String>,
) -> Result<(), String> {
    if res_model.is_empty() {
        return Err("res_model cannot be empty".to_string());
    }
    // Check if already following
    let existing = ctx.db.mail_follower()
        .mail_follower_by_partner()
        .filter(&ctx.sender())
        .find(|f| f.res_model == res_model && f.res_id == res_id);

    if let Some(follower) = existing {
        ctx.db.mail_follower().id().update(MailFollower {
            subtypes,
            ..follower
        });
    } else {
        ctx.db.mail_follower().insert(MailFollower {
            id: 0,
            res_model,
            res_id,
            partner_id: ctx.sender(),
            subtypes,
        });
    }
    Ok(())
}

/// Unsubscribe the calling identity from a record.
#[reducer]
pub fn unsubscribe_from_record(
    ctx: &ReducerContext,
    res_model: String,
    res_id: u64,
) -> Result<(), String> {
    let existing = ctx.db.mail_follower()
        .mail_follower_by_partner()
        .filter(&ctx.sender())
        .find(|f| f.res_model == res_model && f.res_id == res_id);

    if let Some(follower) = existing {
        ctx.db.mail_follower().id().delete(&follower.id);
    }
    Ok(())
}
