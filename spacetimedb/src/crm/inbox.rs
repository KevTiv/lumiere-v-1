/// CRM conversation inbox — WhatsApp-native thread foundation.
///
/// Tables:
///   - CrmConversation
///   - CrmConversationMessage
///
/// Stores inbox state and message intents. Delivery is performed by API
/// workers / WhatsApp Business adapters (never HTTP inside reducers).
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::operational_messaging::{operational_message, OperationalMessage};
use crate::core::users::{user_organization, user_profile};
use crate::crm::contact_identities::contact_phone_identity;
use crate::crm::contacts::{contact, Contact};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::integrations::whatsapp_business::{whatsapp_business_account, WhatsAppBusinessAccount};
use crate::types::{
    ContactIdentityKind, ContactVerificationState, MessageChannel, OperationalMessageStatus,
};

const MAX_BODY_LEN: usize = 4000;

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = crm_conversation,
    index(accessor = crm_conversation_by_org, btree(columns = [organization_id])),
    index(accessor = crm_conversation_by_contact, btree(columns = [contact_id]))
)]
pub struct CrmConversation {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub contact_id: u64,
    pub channel: MessageChannel,
    pub provider_account_id: Option<u64>,
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
    index(accessor = crm_conversation_message_by_org, btree(columns = [organization_id])),
    index(accessor = crm_conversation_message_by_conversation, btree(columns = [conversation_id]))
)]
pub struct CrmConversationMessage {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
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

/// Dedicated server/adapter identity permitted to persist provider-owned facts.
/// Secrets remain in the API server's secret store and are never stored here.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = crm_provider_principal,
    index(accessor = crm_provider_principal_by_org, btree(columns = [organization_id])),
    index(accessor = crm_provider_principal_by_account, btree(columns = [provider_account_id])),
    index(accessor = crm_provider_principal_by_executor, btree(columns = [executor_identity]))
)]
pub struct CrmProviderPrincipal {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub provider_account_id: u64,
    pub executor_identity: Identity,
    pub is_active: bool,
    pub registered_by: Identity,
    pub registered_at: Timestamp,
    pub retired_at: Option<Timestamp>,
}

/// Immutable replay ledger for signed provider callbacks.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = crm_provider_event_receipt,
    index(accessor = crm_provider_event_receipt_by_org, btree(columns = [organization_id])),
    index(accessor = crm_provider_event_receipt_by_account, btree(columns = [provider_account_id]))
)]
pub struct CrmProviderEventReceipt {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub provider_account_id: u64,
    pub provider_event_id: String,
    pub event_fingerprint: String,
    pub event_kind: String,
    pub conversation_id: u64,
    pub conversation_message_id: u64,
    pub received_at: Timestamp,
    pub received_by: Identity,
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

#[derive(SpacetimeType, Clone, Debug)]
pub struct RegisterCrmProviderPrincipalParams {
    pub provider_account_id: u64,
    pub executor_identity: Identity,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ReceiveCrmProviderMessageParams {
    pub provider_account_id: u64,
    pub provider_event_id: String,
    pub event_fingerprint: String,
    pub contact_id: u64,
    pub phone_identity_id: u64,
    pub external_thread_id: String,
    pub provider_message_id: String,
    pub body: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordCrmProviderDeliveryParams {
    pub provider_account_id: u64,
    pub event_fingerprint: String,
    pub conversation_id: u64,
    pub conversation_message_id: u64,
    pub provider_event_id: String,
    pub provider_message_id: String,
    pub operational_message_id: u64,
    pub status: String,
    pub failure_reason: Option<String>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn validate_status(status: &str) -> Result<(), String> {
    match status {
        "open" | "snoozed" | "closed" => Ok(()),
        _ => Err("invalid conversation status; valid values are open, snoozed, closed".to_string()),
    }
}

fn validate_direction(direction: &str) -> Result<(), String> {
    match direction {
        "inbound" | "outbound" => Ok(()),
        _ => Err("invalid message direction; valid values are inbound, outbound".to_string()),
    }
}

fn validate_message_status(status: &str) -> Result<(), String> {
    match status {
        "draft" | "queued" | "sent" | "delivered" | "failed" | "received" => Ok(()),
        _ => Err(
            "invalid message status; valid values are draft, queued, sent, delivered, failed, received"
                .to_string(),
        ),
    }
}

fn validate_provider_identifier(field: &str, value: &str) -> Result<(), String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{field} cannot be empty"));
    }
    if value.len() > 255 {
        return Err(format!("{field} exceeds 255 characters"));
    }
    Ok(())
}

fn validate_event_fingerprint(value: &str) -> Result<(), String> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("event fingerprint must be a sha256 hex digest".to_string());
    }
    Ok(())
}

fn load_active_provider_account(
    ctx: &ReducerContext,
    organization_id: u64,
    account_id: u64,
) -> Result<WhatsAppBusinessAccount, String> {
    let account = ctx
        .db
        .whatsapp_business_account()
        .id()
        .find(&account_id)
        .ok_or("whatsapp provider account not found")?;
    if account.organization_id != organization_id {
        return Err("whatsapp provider account does not belong to this organization".to_string());
    }
    if !account.is_active || account.deleted_at.is_some() {
        return Err("whatsapp provider account is inactive".to_string());
    }
    if !account.messaging_enabled {
        return Err("whatsapp provider messaging is disabled".to_string());
    }
    if !account.webhook_enabled
        || !account
            .subscribed_webhook_events
            .iter()
            .any(|event| event == "messages" || event == "message_status")
    {
        return Err("whatsapp provider callbacks are not enabled".to_string());
    }
    Ok(account)
}

fn require_provider_principal(
    ctx: &ReducerContext,
    organization_id: u64,
    account_id: u64,
    required_event: &str,
) -> Result<WhatsAppBusinessAccount, String> {
    let account = load_active_provider_account(ctx, organization_id, account_id)?;
    if !account
        .subscribed_webhook_events
        .iter()
        .any(|event| event == required_event)
    {
        return Err(format!(
            "whatsapp provider account is not subscribed to {required_event}"
        ));
    }
    let principals: Vec<_> = ctx
        .db
        .crm_provider_principal()
        .crm_provider_principal_by_account()
        .filter(&account_id)
        .filter(|principal| principal.organization_id == organization_id && principal.is_active)
        .collect();
    if principals.len() > 1 {
        return Err("multiple active provider principals exist".to_string());
    }
    let principal = principals
        .first()
        .ok_or("provider account has no active provider principal")?;
    if principal.executor_identity != ctx.sender() {
        return Err("caller is not the active provider principal".to_string());
    }
    Ok(account)
}

fn find_provider_event_receipt(
    ctx: &ReducerContext,
    organization_id: u64,
    account_id: u64,
    event_id: &str,
) -> Option<CrmProviderEventReceipt> {
    ctx.db
        .crm_provider_event_receipt()
        .crm_provider_event_receipt_by_account()
        .filter(&account_id)
        .find(|receipt| {
            receipt.organization_id == organization_id && receipt.provider_event_id == event_id
        })
}

fn provider_event_is_replay(
    ctx: &ReducerContext,
    organization_id: u64,
    account_id: u64,
    event_id: &str,
    event_fingerprint: &str,
    event_kind: &str,
) -> Result<bool, String> {
    let Some(receipt) = find_provider_event_receipt(ctx, organization_id, account_id, event_id)
    else {
        return Ok(false);
    };
    if receipt.event_fingerprint != event_fingerprint || receipt.event_kind != event_kind {
        return Err("provider event id was replayed with conflicting content".to_string());
    }
    Ok(true)
}

fn ensure_provider_message_id_available(
    ctx: &ReducerContext,
    organization_id: u64,
    provider_message_id: &str,
    expected_message_id: Option<u64>,
) -> Result<(), String> {
    if ctx.db.crm_conversation_message().iter().any(|message| {
        message.organization_id == organization_id
            && message.provider_message_id.as_deref() == Some(provider_message_id)
            && Some(message.id) != expected_message_id
    }) {
        return Err("provider message id is already linked to another message".to_string());
    }
    Ok(())
}

fn load_active_contact(
    ctx: &ReducerContext,
    organization_id: u64,
    contact_id: u64,
) -> Result<Contact, String> {
    let contact = ctx
        .db
        .contact()
        .id()
        .find(&contact_id)
        .ok_or("contact not found")?;
    if contact.organization_id != organization_id {
        return Err("contact does not belong to this organization".to_string());
    }
    if contact.deleted_at.is_some() || contact.merge_target_id.is_some() {
        return Err("contact is not active".to_string());
    }
    Ok(contact)
}

fn validate_phone_identity(
    ctx: &ReducerContext,
    organization_id: u64,
    contact: &Contact,
    channel: &MessageChannel,
    identity_id: u64,
) -> Result<(), String> {
    let identity = ctx
        .db
        .contact_phone_identity()
        .id()
        .find(&identity_id)
        .ok_or("phone identity not found")?;
    if identity.organization_id != organization_id {
        return Err("phone identity does not belong to this organization".to_string());
    }
    if identity.contact_id != contact.id {
        return Err("phone identity does not belong to this contact".to_string());
    }
    if identity.company_id != contact.company_id {
        return Err("phone identity company does not match the contact company".to_string());
    }
    if identity.archived_at.is_some() {
        return Err("phone identity is archived".to_string());
    }
    if identity.verification_state == ContactVerificationState::OptedOut {
        return Err("phone identity is opted out".to_string());
    }
    let kind_allowed = match channel {
        MessageChannel::WhatsApp => {
            identity.kind == ContactIdentityKind::WhatsApp
                || identity.kind == ContactIdentityKind::Primary
        }
        MessageChannel::Sms => identity.kind == ContactIdentityKind::Primary,
        MessageChannel::Email | MessageChannel::InApp => false,
    };
    if !kind_allowed {
        return Err("phone identity is incompatible with the conversation channel".to_string());
    }
    Ok(())
}

fn validate_assignee(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    assignee: Identity,
) -> Result<(), String> {
    let profile = ctx
        .db
        .user_profile()
        .identity()
        .find(assignee)
        .ok_or("assigned user not found")?;
    if !profile.is_active {
        return Err("assigned user is inactive".to_string());
    }
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&assignee)
        .find(|membership| membership.organization_id == organization_id && membership.is_active)
        .ok_or("assigned user is not an active member of this organization")?;
    if membership.company_id != company_id {
        return Err("assigned user company does not match the contact company".to_string());
    }
    Ok(())
}

fn validate_operational_message_scope(
    operational: &OperationalMessage,
    conversation: &CrmConversation,
    contact: &Contact,
) -> Result<(), String> {
    if operational.organization_id != conversation.organization_id {
        return Err("operational message does not belong to this organization".to_string());
    }
    if operational.company_id != contact.company_id {
        return Err(
            "operational message company does not match the conversation contact".to_string(),
        );
    }
    if operational.contact_id != conversation.contact_id {
        return Err("operational message contact does not match the conversation".to_string());
    }
    if Some(operational.phone_identity_id) != conversation.phone_identity_id {
        return Err("operational message identity does not match the conversation".to_string());
    }
    if operational.channel != conversation.channel {
        return Err("operational message channel does not match the conversation".to_string());
    }
    Ok(())
}

fn validate_operational_message_for_queueing(
    operational: &OperationalMessage,
    conversation: &CrmConversation,
    contact: &Contact,
) -> Result<(), String> {
    validate_operational_message_scope(operational, conversation, contact)?;
    if operational.status != OperationalMessageStatus::Draft
        && operational.status != OperationalMessageStatus::Queued
    {
        return Err("operational message is not eligible for inbox queueing".to_string());
    }
    Ok(())
}

fn validate_user_message_intent(
    ctx: &ReducerContext,
    params: &AppendCrmConversationMessageParams,
    conversation: &CrmConversation,
    contact: &Contact,
) -> Result<(), String> {
    validate_direction(&params.direction)?;
    validate_message_status(&params.status)?;
    if params.direction != "outbound" {
        return Err("inbound messages require trusted provider authority".to_string());
    }
    if params.status != "draft" && params.status != "queued" {
        return Err("user message status must be draft or queued".to_string());
    }
    if params.provider_message_id.is_some() {
        return Err("provider message ids require trusted provider authority".to_string());
    }
    if let Some(operational_message_id) = params.operational_message_id {
        let operational = ctx
            .db
            .operational_message()
            .id()
            .find(&operational_message_id)
            .ok_or("operational message not found")?;
        validate_operational_message_for_queueing(&operational, conversation, contact)?;
        return Err("operational message linkage requires trusted provider authority".to_string());
    }
    Ok(())
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
pub fn register_crm_provider_principal(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RegisterCrmProviderPrincipalParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "integrations", "write")?;
    load_active_provider_account(ctx, organization_id, params.provider_account_id)?;
    if params.executor_identity == ctx.sender() {
        return Err(
            "provider principal must be distinct from the registering administrator".to_string(),
        );
    }

    let active: Vec<_> = ctx
        .db
        .crm_provider_principal()
        .crm_provider_principal_by_account()
        .filter(&params.provider_account_id)
        .filter(|principal| principal.organization_id == organization_id && principal.is_active)
        .collect();
    for principal in active {
        ctx.db
            .crm_provider_principal()
            .id()
            .update(CrmProviderPrincipal {
                is_active: false,
                retired_at: Some(ctx.timestamp),
                ..principal
            });
    }

    let principal = ctx
        .db
        .crm_provider_principal()
        .insert(CrmProviderPrincipal {
            id: 0,
            organization_id,
            provider_account_id: params.provider_account_id,
            executor_identity: params.executor_identity,
            is_active: true,
            registered_by: ctx.sender(),
            registered_at: ctx.timestamp,
            retired_at: None,
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "crm_provider_principal",
            record_id: principal.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "provider_account_id": params.provider_account_id,
                    "executor_identity": params.executor_identity.to_hex().to_string(),
                })
                .to_string(),
            ),
            changed_fields: vec!["executor_identity".to_string(), "is_active".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn receive_crm_provider_message(
    ctx: &ReducerContext,
    organization_id: u64,
    params: ReceiveCrmProviderMessageParams,
) -> Result<(), String> {
    require_provider_principal(ctx, organization_id, params.provider_account_id, "messages")?;
    validate_provider_identifier("provider event id", &params.provider_event_id)?;
    validate_provider_identifier("provider message id", &params.provider_message_id)?;
    validate_provider_identifier("external thread id", &params.external_thread_id)?;
    validate_event_fingerprint(&params.event_fingerprint)?;
    if params.body.is_empty() {
        return Err("message body cannot be empty".to_string());
    }
    if params.body.len() > MAX_BODY_LEN {
        return Err(format!("message body exceeds {MAX_BODY_LEN} characters"));
    }
    if provider_event_is_replay(
        ctx,
        organization_id,
        params.provider_account_id,
        &params.provider_event_id,
        &params.event_fingerprint,
        "inbound_message",
    )? {
        return Ok(());
    }

    let contact = load_active_contact(ctx, organization_id, params.contact_id)?;
    validate_phone_identity(
        ctx,
        organization_id,
        &contact,
        &MessageChannel::WhatsApp,
        params.phone_identity_id,
    )?;
    ensure_provider_message_id_available(ctx, organization_id, &params.provider_message_id, None)?;

    let external_matches: Vec<_> = ctx
        .db
        .crm_conversation()
        .crm_conversation_by_org()
        .filter(&organization_id)
        .filter(|conversation| {
            conversation.external_thread_id.as_deref() == Some(params.external_thread_id.as_str())
        })
        .collect();
    if external_matches.len() > 1 {
        return Err("external thread is linked to multiple conversations".to_string());
    }
    let existing = if let Some(conversation) = external_matches.into_iter().next() {
        if conversation.contact_id != params.contact_id
            || conversation.channel != MessageChannel::WhatsApp
            || conversation.phone_identity_id != Some(params.phone_identity_id)
        {
            return Err("external thread is linked to an incompatible conversation".to_string());
        }
        if conversation.provider_account_id != Some(params.provider_account_id) {
            return Err("external thread belongs to a different provider account".to_string());
        }
        if conversation.status == "closed" {
            return Err("external thread conversation is closed".to_string());
        }
        Some((conversation, false))
    } else {
        let mut compatible: Vec<_> = ctx
            .db
            .crm_conversation()
            .crm_conversation_by_contact()
            .filter(&params.contact_id)
            .filter(|conversation| {
                conversation.organization_id == organization_id
                    && conversation.channel == MessageChannel::WhatsApp
                    && conversation.provider_account_id.is_none()
                    && conversation.phone_identity_id == Some(params.phone_identity_id)
                    && conversation.status == "open"
                    && conversation.external_thread_id.is_none()
            })
            .collect();
        match compatible.len() {
            0 => None,
            1 => Some((
                compatible
                    .pop()
                    .ok_or("compatible conversation disappeared")?,
                true,
            )),
            _ => {
                return Err("multiple conversations are compatible with external thread".to_string())
            }
        }
    };

    let conversation = match existing {
        Some((conversation, bind_external_thread)) => {
            if bind_external_thread {
                ctx.db.crm_conversation().id().update(CrmConversation {
                    provider_account_id: Some(params.provider_account_id),
                    external_thread_id: Some(params.external_thread_id.clone()),
                    updated_at: ctx.timestamp,
                    ..conversation
                })
            } else {
                conversation
            }
        }
        None => ctx.db.crm_conversation().insert(CrmConversation {
            id: 0,
            organization_id,
            company_id: contact.company_id.ok_or("contact has no company scope")?,
            contact_id: params.contact_id,
            channel: MessageChannel::WhatsApp,
            provider_account_id: Some(params.provider_account_id),
            phone_identity_id: Some(params.phone_identity_id),
            status: "open".to_string(),
            assigned_user_id: None,
            last_message_at: None,
            last_preview: None,
            external_thread_id: Some(params.external_thread_id.clone()),
            created_at: ctx.timestamp,
            created_by: ctx.sender(),
            updated_at: ctx.timestamp,
            metadata: None,
        }),
    };

    let message = ctx
        .db
        .crm_conversation_message()
        .insert(CrmConversationMessage {
            id: 0,
            organization_id,
            company_id: conversation.company_id,
            conversation_id: conversation.id,
            direction: "inbound".to_string(),
            body: params.body.clone(),
            status: "received".to_string(),
            provider_message_id: Some(params.provider_message_id),
            operational_message_id: None,
            created_at: ctx.timestamp,
            created_by: ctx.sender(),
            metadata: None,
        });
    ctx.db.crm_conversation().id().update(CrmConversation {
        last_message_at: Some(ctx.timestamp),
        last_preview: Some(preview(&params.body)),
        updated_at: ctx.timestamp,
        ..conversation
    });
    ctx.db
        .crm_provider_event_receipt()
        .insert(CrmProviderEventReceipt {
            id: 0,
            organization_id,
            provider_account_id: params.provider_account_id,
            provider_event_id: params.provider_event_id,
            event_fingerprint: params.event_fingerprint,
            event_kind: "inbound_message".to_string(),
            conversation_id: message.conversation_id,
            conversation_message_id: message.id,
            received_at: ctx.timestamp,
            received_by: ctx.sender(),
        });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: contact.company_id,
            table_name: "crm_conversation_message",
            record_id: message.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(r#"{"direction":"inbound","status":"received"}"#.to_string()),
            changed_fields: vec![
                "direction".to_string(),
                "status".to_string(),
                "provider_message_id".to_string(),
            ],
            metadata: Some(r#"{"authority":"provider_principal"}"#.to_string()),
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn record_crm_provider_delivery(
    ctx: &ReducerContext,
    organization_id: u64,
    params: RecordCrmProviderDeliveryParams,
) -> Result<(), String> {
    require_provider_principal(
        ctx,
        organization_id,
        params.provider_account_id,
        "message_status",
    )?;
    validate_provider_identifier("provider event id", &params.provider_event_id)?;
    validate_provider_identifier("provider message id", &params.provider_message_id)?;
    validate_event_fingerprint(&params.event_fingerprint)?;
    if provider_event_is_replay(
        ctx,
        organization_id,
        params.provider_account_id,
        &params.provider_event_id,
        &params.event_fingerprint,
        "delivery",
    )? {
        return Ok(());
    }
    if !matches!(params.status.as_str(), "sent" | "delivered" | "failed") {
        return Err("provider delivery status must be sent, delivered, or failed".to_string());
    }
    if params.status == "failed" {
        if params
            .failure_reason
            .as_deref()
            .is_none_or(|reason| reason.trim().is_empty())
        {
            return Err("failed delivery requires a failure reason".to_string());
        }
    } else if params.failure_reason.is_some() {
        return Err("failure reason is only valid for failed delivery".to_string());
    }

    let conversation = ctx
        .db
        .crm_conversation()
        .id()
        .find(&params.conversation_id)
        .ok_or("conversation not found")?;
    if conversation.organization_id != organization_id {
        return Err("conversation does not belong to this organization".to_string());
    }
    if conversation.channel != MessageChannel::WhatsApp
        || conversation.provider_account_id != Some(params.provider_account_id)
    {
        return Err("conversation does not belong to this whatsapp provider account".to_string());
    }
    let contact = load_active_contact(ctx, organization_id, conversation.contact_id)?;
    let identity_id = conversation
        .phone_identity_id
        .ok_or("conversation has no phone identity")?;
    validate_phone_identity(
        ctx,
        organization_id,
        &contact,
        &conversation.channel,
        identity_id,
    )?;
    let message = ctx
        .db
        .crm_conversation_message()
        .id()
        .find(&params.conversation_message_id)
        .ok_or("conversation message not found")?;
    if message.organization_id != organization_id
        || message.conversation_id != conversation.id
        || message.direction != "outbound"
    {
        return Err(
            "conversation message is not an outbound message for this conversation".to_string(),
        );
    }
    let transition_allowed = match params.status.as_str() {
        "sent" => message.status == "queued" || message.status == "sent",
        "delivered" => {
            message.status == "queued" || message.status == "sent" || message.status == "delivered"
        }
        "failed" => {
            message.status == "queued" || message.status == "sent" || message.status == "failed"
        }
        _ => false,
    };
    if !transition_allowed {
        return Err("provider delivery transition is not allowed".to_string());
    }
    ensure_provider_message_id_available(
        ctx,
        organization_id,
        &params.provider_message_id,
        Some(message.id),
    )?;
    if message
        .provider_message_id
        .as_deref()
        .is_some_and(|id| id != params.provider_message_id)
    {
        return Err("conversation message has a different provider message id".to_string());
    }
    if message
        .operational_message_id
        .is_some_and(|id| id != params.operational_message_id)
    {
        return Err("conversation message has different operational linkage".to_string());
    }
    let operational = ctx
        .db
        .operational_message()
        .id()
        .find(&params.operational_message_id)
        .ok_or("operational message not found")?;
    validate_operational_message_scope(&operational, &conversation, &contact)?;
    let operational_transition_allowed = match params.status.as_str() {
        "sent" => matches!(
            &operational.status,
            OperationalMessageStatus::Queued | OperationalMessageStatus::Sent
        ),
        "delivered" => matches!(
            &operational.status,
            OperationalMessageStatus::Queued
                | OperationalMessageStatus::Sent
                | OperationalMessageStatus::Delivered
        ),
        "failed" => matches!(
            &operational.status,
            OperationalMessageStatus::Queued
                | OperationalMessageStatus::Sent
                | OperationalMessageStatus::Failed
        ),
        _ => false,
    };
    if !operational_transition_allowed {
        return Err("operational message delivery transition is not allowed".to_string());
    }

    let next_operational_status = match params.status.as_str() {
        "sent" => OperationalMessageStatus::Sent,
        "delivered" => OperationalMessageStatus::Delivered,
        "failed" => OperationalMessageStatus::Failed,
        _ => unreachable!(),
    };
    ctx.db
        .crm_conversation_message()
        .id()
        .update(CrmConversationMessage {
            status: params.status.clone(),
            provider_message_id: Some(params.provider_message_id),
            operational_message_id: Some(params.operational_message_id),
            metadata: None,
            ..message
        });
    ctx.db
        .operational_message()
        .id()
        .update(OperationalMessage {
            status: next_operational_status,
            sent_at: if params.status == "sent" || params.status == "delivered" {
                Some(ctx.timestamp)
            } else {
                operational.sent_at
            },
            failed_at: (params.status == "failed").then_some(ctx.timestamp),
            failure_reason: params.failure_reason,
            ..operational
        });
    ctx.db
        .crm_provider_event_receipt()
        .insert(CrmProviderEventReceipt {
            id: 0,
            organization_id,
            provider_account_id: params.provider_account_id,
            provider_event_id: params.provider_event_id,
            event_fingerprint: params.event_fingerprint,
            event_kind: "delivery".to_string(),
            conversation_id: conversation.id,
            conversation_message_id: params.conversation_message_id,
            received_at: ctx.timestamp,
            received_by: ctx.sender(),
        });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: contact.company_id,
            table_name: "crm_conversation_message",
            record_id: params.conversation_message_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "status": params.status }).to_string()),
            changed_fields: vec![
                "status".to_string(),
                "provider_message_id".to_string(),
                "operational_message_id".to_string(),
            ],
            metadata: Some(r#"{"authority":"provider_principal"}"#.to_string()),
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn open_crm_conversation(
    ctx: &ReducerContext,
    organization_id: u64,
    params: OpenCrmConversationParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "operational_message", "create")?;

    if params.channel != MessageChannel::WhatsApp && params.channel != MessageChannel::Sms {
        return Err("crm inbox currently supports whatsapp and sms channels".to_string());
    }

    let contact_row = load_active_contact(ctx, organization_id, params.contact_id)?;

    let identity_id = params
        .phone_identity_id
        .ok_or("whatsapp and sms conversations require a phone identity")?;
    validate_phone_identity(
        ctx,
        organization_id,
        &contact_row,
        &params.channel,
        identity_id,
    )?;
    if let Some(assignee) = params.assigned_user_id {
        validate_assignee(ctx, organization_id, contact_row.company_id, assignee)?;
    }
    if params.external_thread_id.is_some() {
        return Err("external thread ids require trusted provider authority".to_string());
    }

    // Reuse only when the complete relational intent matches.
    if let Some(existing) = ctx
        .db
        .crm_conversation()
        .crm_conversation_by_contact()
        .filter(&params.contact_id)
        .find(|c| {
            c.organization_id == organization_id
                && c.channel == params.channel
                && c.status == "open"
                && c.phone_identity_id == params.phone_identity_id
                && c.external_thread_id == params.external_thread_id
                && c.assigned_user_id == params.assigned_user_id
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
                    serde_json::json!({ "reused": true, "contact_id": params.contact_id })
                        .to_string(),
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
        company_id: contact_row
            .company_id
            .ok_or("contact has no company scope")?,
        contact_id: params.contact_id,
        channel: params.channel,
        provider_account_id: None,
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
    if params.body.is_empty() {
        return Err("message body cannot be empty".to_string());
    }
    if params.body.len() > MAX_BODY_LEN {
        return Err(format!("message body exceeds {MAX_BODY_LEN} characters"));
    }

    let conversation = ctx
        .db
        .crm_conversation()
        .id()
        .find(&conversation_id)
        .ok_or("conversation not found")?;
    if conversation.organization_id != organization_id {
        return Err("conversation does not belong to this organization".to_string());
    }
    if conversation.status == "closed" {
        return Err("cannot append messages to a closed conversation".to_string());
    }
    let contact_row = load_active_contact(ctx, organization_id, conversation.contact_id)?;
    let identity_id = conversation
        .phone_identity_id
        .ok_or("conversation has no phone identity")?;
    validate_phone_identity(
        ctx,
        organization_id,
        &contact_row,
        &conversation.channel,
        identity_id,
    )?;
    validate_user_message_intent(ctx, &params, &conversation, &contact_row)?;

    let message = ctx
        .db
        .crm_conversation_message()
        .insert(CrmConversationMessage {
            id: 0,
            organization_id,
            company_id: conversation.company_id,
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
        .ok_or("conversation not found")?;
    if conversation.organization_id != organization_id {
        return Err("conversation does not belong to this organization".to_string());
    }

    let contact_row = load_active_contact(ctx, organization_id, conversation.contact_id)?;
    let identity_id = conversation
        .phone_identity_id
        .ok_or("conversation has no phone identity")?;
    validate_phone_identity(
        ctx,
        organization_id,
        &contact_row,
        &conversation.channel,
        identity_id,
    )?;
    if let Some(assignee) = params.assigned_user_id {
        validate_assignee(ctx, organization_id, contact_row.company_id, assignee)?;
    }
    if params.external_thread_id.is_some() {
        return Err("external thread ids require trusted provider authority".to_string());
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
