/// CRM conversation inbox — WhatsApp-native thread foundation.
///
/// Tables:
///   - CrmConversation
///   - CrmConversationMessage
///
/// Stores inbox state and message intents. Delivery is performed by API
/// workers / WhatsApp Business adapters (never HTTP inside reducers).
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::crm::contact_identities::contact_phone_identity;
use crate::crm::contacts::contact;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::{ContactIdentityKind, MessageChannel};

const MAX_BODY_LEN: usize = 4000;

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = crm_conversation,
    public,
    index(accessor = crm_conversation_by_org, btree(columns = [organization_id])),
    index(accessor = crm_conversation_by_contact, btree(columns = [contact_id]))
)]
pub struct CrmConversation {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub contact_id: u64,
    pub channel: MessageChannel,
    pub phone_identity_id: Option<u64>,
    pub status: String, // open | snoozed | closed
    pub assigned_user_id: Option<Identity>,
    pub last_message_at: Option<Timestamp>,
    pub last_preview: Option<String>,
    pub external_thread_id: Option<String>,
    pub created_at: Timestamp,
    pub created_by: Identity,
    pub updated_at: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = crm_conversation_message,
    public,
    index(accessor = crm_conversation_message_by_org, btree(columns = [organization_id])),
    index(accessor = crm_conversation_message_by_conversation, btree(columns = [conversation_id]))
)]
pub struct CrmConversationMessage {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub conversation_id: u64,
    pub direction: String, // inbound | outbound
    pub body: String,
    pub status: String, // draft | queued | sent | delivered | failed | received
    pub provider_message_id: Option<String>,
    pub operational_message_id: Option<u64>,
    pub created_at: Timestamp,
    pub created_by: Identity,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct OpenCrmConversationParams {
    pub contact_id: u64,
    pub channel: MessageChannel,
    pub phone_identity_id: Option<u64>,
    pub external_thread_id: Option<String>,
    pub assigned_user_id: Option<Identity>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct AppendCrmConversationMessageParams {
    pub direction: String,
    pub body: String,
    pub status: String,
    pub provider_message_id: Option<String>,
    pub operational_message_id: Option<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateCrmConversationParams {
    pub status: Option<String>,
    pub assigned_user_id: Option<Identity>,
    pub external_thread_id: Option<String>,
    pub metadata: Option<String>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn validate_status(status: &str) -> Result<(), String> {
    match status {
        "open" | "snoozed" | "closed" => Ok(()),
        _ => Err("Invalid conversation status. Valid values: open, snoozed, closed".to_string()),
    }
}

fn validate_direction(direction: &str) -> Result<(), String> {
    match direction {
        "inbound" | "outbound" => Ok(()),
        _ => Err("Invalid message direction. Valid values: inbound, outbound".to_string()),
    }
}

fn validate_message_status(status: &str) -> Result<(), String> {
    match status {
        "draft" | "queued" | "sent" | "delivered" | "failed" | "received" => Ok(()),
        _ => Err(
            "Invalid message status. Valid values: draft, queued, sent, delivered, failed, received"
                .to_string(),
        ),
    }
}

fn preview(body: &str) -> String {
    let trimmed: String = body.chars().take(120).collect();
    if body.chars().count() > 120 {
        format!("{trimmed}…")
    } else {
        trimmed
    }
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn open_crm_conversation(
    ctx: &ReducerContext,
    organization_id: u64,
    params: OpenCrmConversationParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "operational_message", "create")?;

    if params.channel != MessageChannel::WhatsApp && params.channel != MessageChannel::Sms {
        return Err("CRM inbox currently supports whatsapp and sms channels".to_string());
    }

    let contact_row = ctx
        .db
        .contact()
        .id()
        .find(&params.contact_id)
        .ok_or("Contact not found")?;
    if contact_row.organization_id != organization_id {
        return Err("Contact does not belong to this organization".to_string());
    }

    if let Some(identity_id) = params.phone_identity_id {
        let identity = ctx
            .db
            .contact_phone_identity()
            .id()
            .find(&identity_id)
            .ok_or("Phone identity not found")?;
        if identity.organization_id != organization_id {
            return Err("Phone identity does not belong to this organization".to_string());
        }
        if identity.contact_id != params.contact_id {
            return Err("Phone identity does not belong to this contact".to_string());
        }
        if params.channel == MessageChannel::WhatsApp
            && identity.kind != ContactIdentityKind::WhatsApp
            && identity.kind != ContactIdentityKind::Primary
        {
            return Err("WhatsApp conversations require a WhatsApp or primary phone identity".to_string());
        }
    }

    // Reuse an open conversation for the same contact+channel when present.
    if let Some(existing) = ctx
        .db
        .crm_conversation()
        .crm_conversation_by_contact()
        .filter(&params.contact_id)
        .find(|c| {
            c.organization_id == organization_id
                && c.channel == params.channel
                && c.status == "open"
        })
    {
        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: None,
                table_name: "crm_conversation",
                record_id: existing.id,
                action: "UPDATE",
                old_values: None,
                new_values: Some(
                    serde_json::json!({ "reused": true, "contact_id": params.contact_id }).to_string(),
                ),
                changed_fields: vec![],
                metadata: Some(r#"{"note":"open_reused_existing"}"#.to_string()),
            },
        );
        return Ok(());
    }

    let channel_str = params.channel.as_str().to_string();
    let conversation = ctx.db.crm_conversation().insert(CrmConversation {
        id: 0,
        organization_id,
        contact_id: params.contact_id,
        channel: params.channel,
        phone_identity_id: params.phone_identity_id,
        status: "open".to_string(),
        assigned_user_id: params.assigned_user_id,
        last_message_at: None,
        last_preview: None,
        external_thread_id: params.external_thread_id,
        created_at: ctx.timestamp,
        created_by: ctx.sender(),
        updated_at: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "crm_conversation",
            record_id: conversation.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "contact_id": params.contact_id,
                    "channel": channel_str,
                    "status": "open",
                })
                .to_string(),
            ),
            changed_fields: vec!["contact_id".to_string(), "channel".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn append_crm_conversation_message(
    ctx: &ReducerContext,
    organization_id: u64,
    conversation_id: u64,
    params: AppendCrmConversationMessageParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "operational_message", "write")?;
    validate_direction(&params.direction)?;
    validate_message_status(&params.status)?;

    if params.body.is_empty() {
        return Err("Message body cannot be empty".to_string());
    }
    if params.body.len() > MAX_BODY_LEN {
        return Err(format!("Message body exceeds {MAX_BODY_LEN} characters"));
    }

    let conversation = ctx
        .db
        .crm_conversation()
        .id()
        .find(&conversation_id)
        .ok_or("Conversation not found")?;
    if conversation.organization_id != organization_id {
        return Err("Conversation does not belong to this organization".to_string());
    }
    if conversation.status == "closed" {
        return Err("Cannot append messages to a closed conversation".to_string());
    }

    let message = ctx
        .db
        .crm_conversation_message()
        .insert(CrmConversationMessage {
            id: 0,
            organization_id,
            conversation_id,
            direction: params.direction.clone(),
            body: params.body.clone(),
            status: params.status.clone(),
            provider_message_id: params.provider_message_id,
            operational_message_id: params.operational_message_id,
            created_at: ctx.timestamp,
            created_by: ctx.sender(),
            metadata: params.metadata,
        });

    ctx.db.crm_conversation().id().update(CrmConversation {
        last_message_at: Some(ctx.timestamp),
        last_preview: Some(preview(&params.body)),
        updated_at: ctx.timestamp,
        ..conversation
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "crm_conversation_message",
            record_id: message.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "conversation_id": conversation_id,
                    "direction": params.direction,
                    "status": params.status,
                })
                .to_string(),
            ),
            changed_fields: vec!["body".to_string(), "direction".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_crm_conversation(
    ctx: &ReducerContext,
    organization_id: u64,
    conversation_id: u64,
    params: UpdateCrmConversationParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "operational_message", "write")?;

    let conversation = ctx
        .db
        .crm_conversation()
        .id()
        .find(&conversation_id)
        .ok_or("Conversation not found")?;
    if conversation.organization_id != organization_id {
        return Err("Conversation does not belong to this organization".to_string());
    }

    let mut changed_fields = Vec::new();
    let status = match params.status {
        Some(ref s) => {
            validate_status(s)?;
            changed_fields.push("status".to_string());
            s.clone()
        }
        None => conversation.status.clone(),
    };
    if params.assigned_user_id.is_some() {
        changed_fields.push("assigned_user_id".to_string());
    }
    let assigned_user_id = params.assigned_user_id.or(conversation.assigned_user_id);
    if params.external_thread_id.is_some() {
        changed_fields.push("external_thread_id".to_string());
    }
    let external_thread_id = params
        .external_thread_id
        .or_else(|| conversation.external_thread_id.clone());
    if params.metadata.is_some() {
        changed_fields.push("metadata".to_string());
    }
    let metadata = params.metadata.or_else(|| conversation.metadata.clone());

    ctx.db.crm_conversation().id().update(CrmConversation {
        status,
        assigned_user_id,
        external_thread_id,
        metadata,
        updated_at: ctx.timestamp,
        ..conversation
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "crm_conversation",
            record_id: conversation_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
}
