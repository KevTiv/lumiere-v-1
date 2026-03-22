/// Messaging (Chatter) — MailMessage & MailFollower
///
/// Backs the `message_ids` and `message_follower_ids` Vec<u64> fields on 30+ tables.
///
/// Design: polymorphic association via `model` + `res_id`.
/// Clients query messages by model+res_id rather than through the Vec<u64> fields.
/// The Vec<u64> fields on parent tables remain for backwards-compat but are not maintained.
use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::MailMessageType;

// ── Tables ────────────────────────────────────────────────────────────────────

/// Mail Message — A single message, note, or email attached to any record.
///
/// Query messages for a record via the `mail_message_by_model` index.
#[spacetimedb::table(
    accessor = mail_message,
    public,
    index(accessor = mail_message_by_org, btree(columns = [organization_id])),
    index(accessor = mail_message_by_model, btree(columns = [model])),
    index(accessor = mail_message_by_author, btree(columns = [author_id]))
)]
pub struct MailMessage {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64, // Tenant isolation
    pub model: String,        // "sale_order" | "purchase_order" | "account_move" | …
    pub res_id: u64,          // PK of the record in that model's table
    pub author_id: Identity,
    pub body: String,
    pub message_type: MailMessageType, // Comment | Note | Email | Notification
    pub subtype: Option<String>,       // e.g. "mail.mt_comment", "mail.mt_note"
    pub date: Timestamp,
    pub parent_id: Option<u64>, // For threaded replies → FK to MailMessage.id
    pub attachment_ids: Vec<u64>, // Document attachment IDs
}

/// Mail Follower — A user subscribed to notifications on a record.
///
/// Query followers for a record via `mail_follower_by_model` index.
#[spacetimedb::table(
    accessor = mail_follower,
    public,
    index(accessor = mail_follower_by_org, btree(columns = [organization_id])),
    index(accessor = mail_follower_by_model, btree(columns = [res_model])),
    index(accessor = mail_follower_by_partner, btree(columns = [partner_id]))
)]
pub struct MailFollower {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,  // Tenant isolation
    pub res_model: String,     // "sale_order" | "purchase_order" | …
    pub res_id: u64,           // PK of the followed record
    pub partner_id: Identity,  // The following user's identity
    pub subtypes: Vec<String>, // ["comment", "note"] — which events trigger notifications
}

// ── Reducers ──────────────────────────────────────────────────────────────────

/// Post a message (comment visible to all followers) on any record.
#[reducer]
pub fn post_message(
    ctx: &ReducerContext,
    organization_id: u64,
    model: String,
    res_id: u64,
    body: String,
    parent_id: Option<u64>,
    attachment_ids: Vec<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mail_message", "create")?;
    if model.is_empty() {
        return Err("model cannot be empty".to_string());
    }
    if body.is_empty() {
        return Err("Message body cannot be empty".to_string());
    }
    let msg = ctx.db.mail_message().insert(MailMessage {
        id: 0,
        organization_id,
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
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "mail_message",
            record_id: msg.id,
            action: "create",
            old_values: None,
            new_values: None,
            changed_fields: vec!["body".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Post an internal note (only visible to internal users, not customers) on any record.
#[reducer]
pub fn post_internal_note(
    ctx: &ReducerContext,
    organization_id: u64,
    model: String,
    res_id: u64,
    body: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mail_message", "create")?;
    if model.is_empty() {
        return Err("model cannot be empty".to_string());
    }
    if body.is_empty() {
        return Err("Note body cannot be empty".to_string());
    }
    ctx.db.mail_message().insert(MailMessage {
        id: 0,
        organization_id,
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
    organization_id: u64,
    res_model: String,
    res_id: u64,
    subtypes: Vec<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mail_follower", "create")?;
    if res_model.is_empty() {
        return Err("res_model cannot be empty".to_string());
    }
    // Check if already following
    let existing = ctx
        .db
        .mail_follower()
        .mail_follower_by_partner()
        .filter(&ctx.sender())
        .find(|f| {
            f.organization_id == organization_id && f.res_model == res_model && f.res_id == res_id
        });

    if let Some(follower) = existing {
        ctx.db.mail_follower().id().update(MailFollower {
            subtypes,
            ..follower
        });
    } else {
        ctx.db.mail_follower().insert(MailFollower {
            id: 0,
            organization_id,
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
    organization_id: u64,
    res_model: String,
    res_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mail_follower", "delete")?;
    let existing = ctx
        .db
        .mail_follower()
        .mail_follower_by_partner()
        .filter(&ctx.sender())
        .find(|f| {
            f.organization_id == organization_id && f.res_model == res_model && f.res_id == res_id
        });

    if let Some(follower) = existing {
        ctx.db.mail_follower().id().delete(&follower.id);
    }
    Ok(())
}
