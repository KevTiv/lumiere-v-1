/// Messaging (Chatter) — MailMessage & MailFollower
///
/// Backs the `message_ids` and `message_follower_ids` Vec<u64> fields on 30+ tables.
///
/// Design: polymorphic association via `model` + `res_id`.
/// Clients query messages by model+res_id rather than through the Vec<u64> fields.
/// The Vec<u64> fields on parent tables remain for backwards-compat but are not maintained.
use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};
use sha2::{Digest, Sha256};

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

fn frame_message_part(hasher: &mut Sha256, value: &[u8]) {
    hasher.update((value.len() as u64).to_be_bytes());
    hasher.update(value);
}

fn post_message_key(
    model: &str,
    res_id: u64,
    body: &str,
    parent_id: Option<u64>,
    attachment_ids: &[u64],
) -> String {
    let mut hasher = Sha256::new();
    frame_message_part(&mut hasher, model.as_bytes());
    hasher.update(res_id.to_be_bytes());
    match parent_id {
        Some(id) => {
            hasher.update([1]);
            hasher.update(id.to_be_bytes());
        }
        None => hasher.update([0]),
    }
    hasher.update((attachment_ids.len() as u64).to_be_bytes());
    for id in attachment_ids {
        hasher.update(id.to_be_bytes());
    }
    frame_message_part(&mut hasher, body.as_bytes());
    format!("sha256:{:x}", hasher.finalize())
}

fn metadata_message_key(metadata: Option<&str>) -> Option<&str> {
    let metadata = metadata?;
    let start = metadata.find("\"message_key\":\"")? + "\"message_key\":\"".len();
    let rest = &metadata[start..];
    Some(&rest[..rest.find('"')?])
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
    let message_key = post_message_key(&model, res_id, &body, parent_id, &attachment_ids);
    if ctx.db.mail_message().iter().any(|message| {
        message.organization_id == organization_id
            && metadata_message_key(message.metadata.as_deref()) == Some(message_key.as_str())
    }) {
        return Err("Message has already been posted".to_string());
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
        metadata: Some(serde_json::json!({ "message_key": message_key }).to_string()),
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

#[cfg(test)]
mod tests {
    use super::post_message_key;

    #[test]
    fn post_message_key_has_a_stable_cross_client_fixture() {
        assert_eq!(
            post_message_key("crm_lead", 42, "Follow up", None, &[8]),
            "sha256:7012fca419bf4a53e03937e9fa2f6bd46bb359f67487f3b1d1b8e4c1a17d932a"
        );
    }
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

    let message_key = metadata_message_key(message.metadata.as_deref()).map(str::to_owned);
    let metadata = delivery_metadata.or_else(|| {
        Some(
            serde_json::json!({
                "delivery": "sent",
                "sent_at": ctx.timestamp.to_duration_since_unix_epoch().unwrap_or_default().as_micros(),
            })
            .to_string(),
        )
    });
    let metadata = match (metadata, message_key) {
        (Some(raw), Some(key)) => {
            let mut value = serde_json::from_str::<serde_json::Value>(&raw)
                .unwrap_or_else(|_| serde_json::json!({ "delivery_metadata": raw }));
            if let Some(object) = value.as_object_mut() {
                object.insert("message_key".to_string(), serde_json::Value::String(key));
            }
            Some(value.to_string())
        }
        (metadata, None) => metadata,
        (None, Some(key)) => Some(serde_json::json!({ "message_key": key }).to_string()),
    };

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
