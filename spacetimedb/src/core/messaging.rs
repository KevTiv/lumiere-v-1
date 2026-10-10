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
#[derive(PartialEq)]
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
    #[default(None::<String>)]
    pub metadata: Option<String>,
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

// ── Helpers ───────────────────────────────────────────────────────────────────

fn follower_wants_subtype(follower: &MailFollower, subtype: &str) -> bool {
    follower.subtypes.is_empty()
        || follower
            .subtypes
            .iter()
            .any(|s| s.eq_ignore_ascii_case(subtype))
}

fn truncate_for_notification(body: &str, max_chars: usize) -> String {
    if body.chars().count() <= max_chars {
        return body.to_string();
    }
    let truncated: String = body.chars().take(max_chars).collect();
    format!("{truncated}…")
}

/// Insert `MailMessageType::Notification` rows for followers subscribed to the event subtype.
fn notify_record_followers(
    ctx: &ReducerContext,
    organization_id: u64,
    model: &str,
    res_id: u64,
    author: Identity,
    subtype: &str,
    source_body: &str,
    parent_message_id: u64,
) {
    let preview = truncate_for_notification(source_body, 200);
    let notification_body = format!("New {subtype}: {preview}");
    let model_key = model.to_string();

    for follower in ctx
        .db
        .mail_follower()
        .mail_follower_by_model()
        .filter(&model_key)
    {
        if follower.organization_id != organization_id || follower.res_id != res_id {
            continue;
        }
        if follower.partner_id == author {
            continue;
        }
        if !follower_wants_subtype(&follower, subtype) {
            continue;
        }

        let recipient = follower.partner_id.to_hex().to_string();
        ctx.db.mail_message().insert(MailMessage {
            id: 0,
            organization_id,
            model: model_key.clone(),
            res_id,
            author_id: author,
            body: notification_body.clone(),
            message_type: MailMessageType::Notification,
            subtype: Some(format!("mail.mt_{subtype}")),
            date: ctx.timestamp,
            parent_id: Some(parent_message_id),
            attachment_ids: vec![],
            metadata: Some(
                serde_json::json!({ "recipient": recipient, "event": subtype }).to_string(),
            ),
        });
    }
}

// ── Reducers ──────────────────────────────────────────────────────────────────

const MAX_MESSAGE_IDEMPOTENCY_KEY_LEN: usize = 128;

/// The client-supplied idempotency key a `post_message` row was created with.
fn message_idempotency_key(metadata: Option<&str>) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(metadata?).ok()?;
    value.get("idempotency_key")?.as_str().map(str::to_owned)
}

/// Post a message (comment visible to all followers) on any record.
///
/// `idempotency_key` names this submission. A key is scoped to the caller within
/// the organization: re-sending the same key with the same message converges on the
/// existing row (no duplicate, no repeat notification), and re-using it for a
/// different message is rejected. The key is stored in `metadata` so the exact
/// created row can be read back from `mail-messages`. Without a key the call
/// always creates a new message.
#[reducer]
pub fn post_message(
    ctx: &ReducerContext,
    organization_id: u64,
    model: String,
    res_id: u64,
    body: String,
    parent_id: Option<u64>,
    attachment_ids: Vec<u64>,
    idempotency_key: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mail_message", "create")?;
    if model.is_empty() {
        return Err("model cannot be empty".to_string());
    }
    if body.is_empty() {
        return Err("Message body cannot be empty".to_string());
    }
    let idempotency_key = idempotency_key.map(|key| key.trim().to_string());
    if let Some(key) = &idempotency_key {
        if key.is_empty() || key.len() > MAX_MESSAGE_IDEMPOTENCY_KEY_LEN {
            return Err(format!(
                "idempotency_key must be 1-{MAX_MESSAGE_IDEMPOTENCY_KEY_LEN} characters"
            ));
        }
        let sender = ctx.sender();
        let existing = ctx
            .db
            .mail_message()
            .mail_message_by_author()
            .filter(&sender)
            .find(|message| {
                message.organization_id == organization_id
                    && message_idempotency_key(message.metadata.as_deref()).as_deref()
                        == Some(key.as_str())
            });
        if let Some(existing) = existing {
            if existing.model == model
                && existing.res_id == res_id
                && existing.body == body
                && existing.parent_id == parent_id
                && existing.attachment_ids == attachment_ids
            {
                return Ok(());
            }
            return Err("idempotency_key was already used for a different message".to_string());
        }
    }
    let metadata = idempotency_key
        .as_ref()
        .map(|key| serde_json::json!({ "idempotency_key": key }).to_string());
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
        metadata,
    });
    notify_record_followers(
        ctx,
        organization_id,
        &msg.model,
        msg.res_id,
        ctx.sender(),
        "comment",
        &msg.body,
        msg.id,
    );

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
    let note = ctx.db.mail_message().insert(MailMessage {
        id: 0,
        organization_id,
        model: model.clone(),
        res_id,
        author_id: ctx.sender(),
        body: body.clone(),
        message_type: MailMessageType::Note,
        subtype: Some("mail.mt_note".to_string()),
        date: ctx.timestamp,
        parent_id: None,
        attachment_ids: vec![],
        metadata: None,
    });

    notify_record_followers(
        ctx,
        organization_id,
        &model,
        res_id,
        ctx.sender(),
        "note",
        &body,
        note.id,
    );

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

/// Mark a queued outbound email as delivered (called by api-server after Resend send).
#[reducer]
pub fn mark_mail_message_delivered(
    ctx: &ReducerContext,
    organization_id: u64,
    message_id: u64,
    delivery_metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mail_message", "write")?;

    let message = ctx
        .db
        .mail_message()
        .id()
        .find(&message_id)
        .ok_or("mail message not found")?;

    if message.organization_id != organization_id {
        return Err("mail message does not belong to this organization".to_string());
    }

    let metadata = delivery_metadata.or_else(|| {
        Some(
            serde_json::json!({
                "delivery": "sent",
                "sent_at": ctx.timestamp.to_duration_since_unix_epoch().unwrap_or_default().as_micros(),
            })
            .to_string(),
        )
    });

    ctx.db.mail_message().id().update(MailMessage {
        metadata,
        ..message
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "mail_message",
            record_id: message_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(r#"{"delivery":"sent"}"#.to_string()),
            changed_fields: vec!["metadata".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

// ── Notification read state ───────────────────────────────────────────────────
//
// Notifications are `MailMessageType::Notification` rows written by
// `notify_record_followers`, one per follower, with the recipient stored in the
// `metadata` JSON object as `recipient` (the follower identity as hex). Read
// state lives in the same object as `read_at` (timestamp micros since the Unix
// epoch); every other key is preserved. No schema change is involved.
//
// Read receipts are per-user, high-volume and carry no business data, so (like
// `subscribe_to_record` / `unsubscribe_from_record`) they do not write audit rows.

/// Upper bound on rows updated by one `mark_all_notifications_read` call (newest
/// first). A caller with more unread notifications simply calls again.
const MAX_NOTIFICATIONS_MARKED_PER_CALL: usize = 500;

/// The `metadata` of a message as a JSON object, if it is one.
fn metadata_object(metadata: Option<&str>) -> Option<serde_json::Map<String, serde_json::Value>> {
    match serde_json::from_str::<serde_json::Value>(metadata?).ok()? {
        serde_json::Value::Object(object) => Some(object),
        _ => None,
    }
}

/// The recipient identity (hex) a notification was addressed to.
fn notification_recipient(metadata: Option<&str>) -> Option<String> {
    metadata_object(metadata)?
        .get("recipient")?
        .as_str()
        .map(str::to_owned)
}

/// Whether a notification already carries a `read_at` marker.
fn notification_is_read(metadata: Option<&str>) -> bool {
    metadata_object(metadata)
        .and_then(|object| object.get("read_at").map(|value| !value.is_null()))
        .unwrap_or(false)
}

/// `metadata` with `read_at` merged in, preserving every other key. A missing or
/// non-object `metadata` starts a new object.
fn metadata_with_read_at(metadata: Option<&str>, read_at_micros: i64) -> String {
    let mut object = metadata_object(metadata).unwrap_or_default();
    object.insert("read_at".to_string(), serde_json::json!(read_at_micros));
    serde_json::Value::Object(object).to_string()
}

/// Mark one of the calling identity's own notifications as read.
/// Idempotent: an already-read notification is left untouched.
#[reducer]
pub fn mark_notification_read(
    ctx: &ReducerContext,
    organization_id: u64,
    message_id: u64,
) -> Result<(), String> {
    // Reading a notification is a caller-owned acknowledgement, not a mutation
    // of another user's message content. The recipient check below is the
    // write boundary; requiring `mail_message:write` would deny read-only users
    // access to their own notification state.
    check_permission(ctx, organization_id, "mail_message", "read")?;

    let message = ctx
        .db
        .mail_message()
        .id()
        .find(&message_id)
        .ok_or("mail message not found")?;

    if message.organization_id != organization_id {
        return Err("mail message does not belong to this organization".to_string());
    }
    if message.message_type != MailMessageType::Notification {
        return Err("mail message is not a notification".to_string());
    }
    let sender_hex = ctx.sender().to_hex().to_string();
    if notification_recipient(message.metadata.as_deref()).as_deref() != Some(sender_hex.as_str()) {
        return Err("notification is not addressed to the caller".to_string());
    }
    if notification_is_read(message.metadata.as_deref()) {
        return Ok(());
    }

    let metadata = metadata_with_read_at(
        message.metadata.as_deref(),
        ctx.timestamp.to_micros_since_unix_epoch(),
    );
    ctx.db.mail_message().id().update(MailMessage {
        metadata: Some(metadata),
        ..message
    });
    Ok(())
}

/// Mark the calling identity's unread notifications in the organization as read.
/// Idempotent. At most `MAX_NOTIFICATIONS_MARKED_PER_CALL` rows (newest first) are
/// updated per call; call again to clear a larger backlog.
#[reducer]
pub fn mark_all_notifications_read(
    ctx: &ReducerContext,
    organization_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mail_message", "read")?;

    let sender_hex = ctx.sender().to_hex().to_string();
    let mut unread: Vec<MailMessage> = ctx
        .db
        .mail_message()
        .mail_message_by_org()
        .filter(&organization_id)
        .filter(|message| {
            message.message_type == MailMessageType::Notification
                && notification_recipient(message.metadata.as_deref()).as_deref()
                    == Some(sender_hex.as_str())
                && !notification_is_read(message.metadata.as_deref())
        })
        .collect();
    unread.sort_by(|a, b| b.date.cmp(&a.date).then(b.id.cmp(&a.id)));
    unread.truncate(MAX_NOTIFICATIONS_MARKED_PER_CALL);

    let read_at = ctx.timestamp.to_micros_since_unix_epoch();
    for message in unread {
        let metadata = metadata_with_read_at(message.metadata.as_deref(), read_at);
        ctx.db.mail_message().id().update(MailMessage {
            metadata: Some(metadata),
            ..message
        });
    }
    Ok(())
}
