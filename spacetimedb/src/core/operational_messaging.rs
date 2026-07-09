/// Operational messaging — phone-first customer/supplier communication.
///
/// v1 records template-controlled copy actions and queued intents. It does not
/// claim direct WhatsApp/SMS delivery; delivery attempts are appended later by
/// provider adapters.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::crm::contact_identities::contact_phone_identity;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::{
    ContactVerificationState, MessageChannel, MessageBatchStatus, OperationalMessageStatus,
};

// ── Tables ────────────────────────────────────────────────────────────────────

/// Approved message template with variable schema and channel applicability.
#[spacetimedb::table(
    accessor = message_template,
    public,
    index(accessor = message_template_by_org, btree(columns = [organization_id])),
    index(accessor = message_template_by_key, btree(columns = [organization_id, key]))
)]
pub struct MessageTemplate {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub key: String,
    pub name: String,
    pub locale: String,
    pub subject: Option<String>,
    pub body_template: String,
    pub allowed_variables: Vec<String>,
    pub applicable_channels: Vec<MessageChannel>,
    pub active: bool,
    pub review_state: String,
    pub retention_classification: String,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub created_by: Identity,
    pub updated_by: Identity,
    pub metadata: Option<String>,
}

/// Operational message — a single outbound communication intent.
#[spacetimedb::table(
    accessor = operational_message,
    public,
    index(accessor = operational_message_by_org, btree(columns = [organization_id])),
    index(accessor = operational_message_by_subject, btree(columns = [organization_id, subject_model, subject_id])),
    index(accessor = operational_message_by_batch, btree(columns = [message_batch_id]))
)]
pub struct OperationalMessage {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    /// 0 means not part of a batch.
    pub message_batch_id: u64,
    pub template_id: u64,
    pub contact_id: u64,
    pub phone_identity_id: u64,
    pub channel: MessageChannel,
    pub status: OperationalMessageStatus,
    /// Polymorphic subject: model name + record id (invoice, sale_order, etc.)
    pub subject_model: String,
    pub subject_id: u64,
    pub rendered_subject: Option<String>,
    pub rendered_body: String,
    pub variable_hash: String,
    pub copied_at: Option<Timestamp>,
    pub queued_at: Option<Timestamp>,
    pub sent_at: Option<Timestamp>,
    pub failed_at: Option<Timestamp>,
    pub failure_reason: Option<String>,
    pub created_at: Timestamp,
    pub created_by: Identity,
    pub metadata: Option<String>,
}

/// Bulk message batch envelope with preview/approval lifecycle.
#[spacetimedb::table(
    accessor = message_batch,
    public,
    index(accessor = message_batch_by_org, btree(columns = [organization_id])),
    index(accessor = message_batch_by_status, btree(columns = [status]))
)]
pub struct MessageBatch {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub template_id: u64,
    pub channel: MessageChannel,
    pub status: MessageBatchStatus,
    pub subject_model: String,
    pub subject_query: Option<String>,
    pub recipient_count: u64,
    pub excluded_count: u64,
    pub preview_sample_ids: Vec<u64>,
    pub approved_by: Option<Identity>,
    pub approved_at: Option<Timestamp>,
    pub rejected_by: Option<Identity>,
    pub rejected_at: Option<Timestamp>,
    pub rejection_reason: Option<String>,
    pub created_at: Timestamp,
    pub created_by: Identity,
    pub metadata: Option<String>,
}

/// Contact communication preference snapshot for a channel.
#[spacetimedb::table(
    accessor = contact_communication_preference,
    public,
    index(accessor = preference_by_contact, btree(columns = [contact_id])),
    index(accessor = preference_by_org, btree(columns = [organization_id]))
)]
pub struct ContactCommunicationPreference {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub contact_id: u64,
    pub channel: MessageChannel,
    pub opted_in: bool,
    pub quiet_hours_start: Option<String>,
    pub quiet_hours_end: Option<String>,
    pub updated_at: Timestamp,
    pub updated_by: Identity,
    pub metadata: Option<String>,
}

// ── Params ────────────────────────────────────────────────────────────────────

#[derive(SpacetimeType)]
pub struct CreateMessageTemplateParams {
    pub company_id: Option<u64>,
    pub key: String,
    pub name: String,
    pub locale: String,
    pub subject: Option<String>,
    pub body_template: String,
    pub allowed_variables: Vec<String>,
    pub applicable_channels: Vec<MessageChannel>,
    pub retention_classification: String,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType)]
pub struct UpdateMessageTemplateParams {
    pub name: Option<String>,
    pub subject: Option<String>,
    pub body_template: Option<String>,
    pub allowed_variables: Option<Vec<String>>,
    pub applicable_channels: Option<Vec<MessageChannel>>,
    pub active: Option<bool>,
    pub review_state: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Hash)]
pub struct MessageTemplateVariable {
    pub key: String,
    pub value: String,
}

#[derive(SpacetimeType)]
pub struct CreateOperationalMessageParams {
    pub company_id: Option<u64>,
    pub template_id: u64,
    pub contact_id: u64,
    pub phone_identity_id: u64,
    pub channel: MessageChannel,
    pub subject_model: String,
    pub subject_id: u64,
    pub rendered_subject: Option<String>,
    pub rendered_body: String,
    pub variables: Vec<MessageTemplateVariable>,
    pub status: OperationalMessageStatus,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType)]
pub struct CreateMessageBatchParams {
    pub company_id: Option<u64>,
    pub template_id: u64,
    pub channel: MessageChannel,
    pub subject_model: String,
    pub subject_query: Option<String>,
    pub candidate_contact_ids: Vec<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType)]
pub struct ReviewMessageBatchParams {
    pub approved: bool,
    pub reason: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn hash_variables(vars: &[MessageTemplateVariable]) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    vars.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

fn render_template(
    template: &MessageTemplate,
    variables: &[MessageTemplateVariable],
) -> Result<String, String> {
    let mut rendered = template.body_template.clone();
    for var in variables {
        if !template.allowed_variables.contains(&var.key) {
            return Err(format!("Variable '{}' is not allowed by template", var.key));
        }
        rendered = rendered.replace(&format!("{{{{{}}}}}", var.key), &var.value);
    }
    // Ensure no unbound variables remain.
    if rendered.contains("{{") {
        return Err("Rendered output contains unbound template variables".to_string());
    }
    Ok(rendered)
}

fn render_subject(
    template: &MessageTemplate,
    variables: &[MessageTemplateVariable],
) -> Result<Option<String>, String> {
    let Some(subject_tpl) = template.subject.as_ref() else {
        return Ok(None);
    };
    let mut rendered = subject_tpl.clone();
    for var in variables {
        if !template.allowed_variables.contains(&var.key) {
            return Err(format!("Variable '{}' is not allowed by template", var.key));
        }
        rendered = rendered.replace(&format!("{{{{{}}}}}", var.key), &var.value);
    }
    if rendered.contains("{{") {
        return Err("Rendered subject contains unbound template variables".to_string());
    }
    Ok(Some(rendered))
}

fn require_active_template(template: &MessageTemplate) -> Result<(), String> {
    if !template.active {
        return Err("Message template is not active".to_string());
    }
    if template.review_state != "approved" {
        return Err("Message template is not approved".to_string());
    }
    Ok(())
}

fn channel_allowed(template: &MessageTemplate, channel: &MessageChannel) -> bool {
    template.applicable_channels.contains(channel)
}

fn contact_can_receive(
    ctx: &ReducerContext,
    contact_id: u64,
    channel: &MessageChannel,
) -> (bool, Option<u64>) {
    let prefs: Vec<ContactCommunicationPreference> = ctx
        .db
        .contact_communication_preference()
        .preference_by_contact()
        .filter(&contact_id)
        .collect();
    let opted_out = prefs.iter().any(|p| p.channel == *channel && !p.opted_in);
    if opted_out {
        return (false, None);
    }

    let identity_id = ctx
        .db
        .contact_phone_identity()
        .iter()
        .find(|i| {
            i.contact_id == contact_id
                && i.kind == crate::types::ContactIdentityKind::Primary
                && i.archived_at.is_none()
                && i.verification_state != ContactVerificationState::OptedOut
        })
        .map(|i| i.id);

    match identity_id {
        Some(id) => (true, Some(id)),
        None => (false, None),
    }
}

// ── Template reducers ─────────────────────────────────────────────────────────

/// Create an operational message template.
#[reducer]
pub fn create_message_template(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateMessageTemplateParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "message_template", "create")?;

    let existing = ctx
        .db
        .message_template()
        .message_template_by_key()
        .filter((&organization_id, &params.key))
        .count();
    if existing > 0 {
        return Err(format!("Template key '{}' already exists", params.key));
    }

    let template = ctx.db.message_template().insert(MessageTemplate {
        id: 0,
        organization_id,
        company_id: params.company_id,
        key: params.key,
        name: params.name,
        locale: params.locale,
        subject: params.subject,
        body_template: params.body_template,
        allowed_variables: params.allowed_variables,
        applicable_channels: params.applicable_channels,
        active: true,
        review_state: "approved".to_string(),
        retention_classification: params.retention_classification,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        created_by: ctx.sender(),
        updated_by: ctx.sender(),
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: params.company_id,
            table_name: "message_template",
            record_id: template.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

/// Update a message template.
#[reducer]
pub fn update_message_template(
    ctx: &ReducerContext,
    organization_id: u64,
    template_id: u64,
    params: UpdateMessageTemplateParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "message_template", "write")?;
    let template = ctx
        .db
        .message_template()
        .id()
        .find(&template_id)
        .ok_or("Message template not found")?;
    if template.organization_id != organization_id {
        return Err("Template belongs to a different organization".to_string());
    }

    ctx.db.message_template().id().update(MessageTemplate {
        name: params.name.unwrap_or(template.name),
        subject: params.subject.or(template.subject),
        body_template: params.body_template.unwrap_or(template.body_template),
        allowed_variables: params.allowed_variables.unwrap_or(template.allowed_variables),
        applicable_channels: params.applicable_channels.unwrap_or(template.applicable_channels),
        active: params.active.unwrap_or(template.active),
        review_state: params.review_state.unwrap_or(template.review_state),
        updated_at: ctx.timestamp,
        updated_by: ctx.sender(),
        metadata: params.metadata.or(template.metadata),
        ..template
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: template.company_id,
            table_name: "message_template",
            record_id: template_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

// ── Single-message reducers ───────────────────────────────────────────────────

/// Create a single operational message. For v1 this records a copy action or
/// queued intent; it does not deliver through a provider.
#[reducer]
pub fn create_operational_message(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateOperationalMessageParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "operational_message", "create")?;

    let template = ctx
        .db
        .message_template()
        .id()
        .find(&params.template_id)
        .ok_or("Message template not found")?;
    if template.organization_id != organization_id {
        return Err("Template belongs to a different organization".to_string());
    }
    require_active_template(&template)?;
    if !channel_allowed(&template, &params.channel) {
        return Err("Channel is not applicable for this template".to_string());
    }

    let channel = params.channel.clone();
    let status = params.status.clone();
    let subject_model = params.subject_model.clone();

    let (can_receive, phone_identity_id) = contact_can_receive(ctx, params.contact_id, &channel);
    if !can_receive {
        return Err("Contact cannot receive messages on this channel".to_string());
    }
    let phone_identity_id = phone_identity_id.unwrap_or(params.phone_identity_id);

    let rendered_body = if params.rendered_body.is_empty() {
        render_template(&template, &params.variables)?
    } else {
        params.rendered_body
    };
    let rendered_subject = if params.rendered_subject.is_none() {
        render_subject(&template, &params.variables)?
    } else {
        params.rendered_subject
    };
    let variable_hash = hash_variables(&params.variables);

    let message = ctx.db.operational_message().insert(OperationalMessage {
        id: 0,
        organization_id,
        company_id: params.company_id,
        message_batch_id: 0,
        template_id: params.template_id,
        contact_id: params.contact_id,
        phone_identity_id,
        channel,
        status,
        subject_model,
        subject_id: params.subject_id,
        rendered_subject,
        rendered_body,
        variable_hash,
        copied_at: if params.status == OperationalMessageStatus::Copied {
            Some(ctx.timestamp)
        } else {
            None
        },
        queued_at: if params.status == OperationalMessageStatus::Queued {
            Some(ctx.timestamp)
        } else {
            None
        },
        sent_at: None,
        failed_at: None,
        failure_reason: None,
        created_at: ctx.timestamp,
        created_by: ctx.sender(),
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: params.company_id,
            table_name: "operational_message",
            record_id: message.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

/// Record that a message was copied by staff. Truthful v1 status; no delivery claim.
#[reducer]
pub fn record_message_copied(
    ctx: &ReducerContext,
    organization_id: u64,
    message_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "operational_message", "write")?;
    let message = ctx
        .db
        .operational_message()
        .id()
        .find(&message_id)
        .ok_or("Operational message not found")?;
    if message.organization_id != organization_id {
        return Err("Message belongs to a different organization".to_string());
    }
    if message.status != OperationalMessageStatus::Draft && message.status != OperationalMessageStatus::Queued {
        return Err("Only draft or queued messages can be marked copied".to_string());
    }

    ctx.db.operational_message().id().update(OperationalMessage {
        status: OperationalMessageStatus::Copied,
        copied_at: Some(ctx.timestamp),
        ..message
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: message.company_id,
            table_name: "operational_message",
            record_id: message_id,
            action: "COPIED",
            old_values: None,
            new_values: None,
            changed_fields: vec!["status".to_string(), "copied_at".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

// ── Batch reducers ────────────────────────────────────────────────────────────

/// Preview/create a message batch. Filters opted-out/no-phone contacts.
#[reducer]
pub fn create_message_batch(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateMessageBatchParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "message_batch", "create")?;

    let template = ctx
        .db
        .message_template()
        .id()
        .find(&params.template_id)
        .ok_or("Message template not found")?;
    if template.organization_id != organization_id {
        return Err("Template belongs to a different organization".to_string());
    }
    require_active_template(&template)?;
    if !channel_allowed(&template, &params.channel) {
        return Err("Channel is not applicable for this template".to_string());
    }

    let channel = params.channel.clone();
    let subject_model = params.subject_model.clone();

    let mut included: Vec<u64> = vec![];
    let mut excluded: u64 = 0;
    let mut sample: Vec<u64> = vec![];

    for contact_id in &params.candidate_contact_ids {
        let (can_receive, phone_id) = contact_can_receive(ctx, *contact_id, &channel);
        if can_receive {
            included.push(*contact_id);
            if sample.len() < 3 {
                if let Some(pid) = phone_id {
                    sample.push(pid);
                }
            }
        } else {
            excluded += 1;
        }
    }

    let batch = ctx.db.message_batch().insert(MessageBatch {
        id: 0,
        organization_id,
        company_id: params.company_id,
        template_id: params.template_id,
        channel,
        status: MessageBatchStatus::PendingApproval,
        subject_model,
        subject_query: params.subject_query,
        recipient_count: included.len() as u64,
        excluded_count: excluded,
        preview_sample_ids: sample,
        approved_by: None,
        approved_at: None,
        rejected_by: None,
        rejected_at: None,
        rejection_reason: None,
        created_at: ctx.timestamp,
        created_by: ctx.sender(),
        metadata: params.metadata,
    });

    // Create child operational messages in draft state.
    for contact_id in included {
        let (_, phone_identity_id) = contact_can_receive(ctx, contact_id, &batch.channel);
        if let Some(phone_id) = phone_identity_id {
            let _ = ctx.db.operational_message().insert(OperationalMessage {
                id: 0,
                organization_id,
                company_id: batch.company_id,
                message_batch_id: batch.id,
                template_id: batch.template_id,
                contact_id,
                phone_identity_id: phone_id,
                channel: batch.channel.clone(),
                status: OperationalMessageStatus::Draft,
                subject_model: batch.subject_model.clone(),
                subject_id: 0,
                rendered_subject: None,
                rendered_body: String::new(),
                variable_hash: String::new(),
                copied_at: None,
                queued_at: None,
                sent_at: None,
                failed_at: None,
                failure_reason: None,
                created_at: ctx.timestamp,
                created_by: ctx.sender(),
                metadata: None,
            });
        }
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: params.company_id,
            table_name: "message_batch",
            record_id: batch.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

/// Approve or reject a message batch. Bulk copy/send remains blocked until approved.
#[reducer]
pub fn review_message_batch(
    ctx: &ReducerContext,
    organization_id: u64,
    batch_id: u64,
    params: ReviewMessageBatchParams,
) -> Result<(), String> {
    let permission = if params.approved {
        "message_batch"
    } else {
        "operational_message"
    };
    check_permission(ctx, organization_id, permission, "approve")?;

    let batch = ctx
        .db
        .message_batch()
        .id()
        .find(&batch_id)
        .ok_or("Message batch not found")?;
    if batch.organization_id != organization_id {
        return Err("Batch belongs to a different organization".to_string());
    }
    if batch.status != MessageBatchStatus::PendingApproval {
        return Err("Batch is not pending approval".to_string());
    }

    let (new_status, approved_by, approved_at, rejected_by, rejected_at) = if params.approved {
        (
            MessageBatchStatus::Approved,
            Some(ctx.sender()),
            Some(ctx.timestamp),
            None,
            None,
        )
    } else {
        (
            MessageBatchStatus::Rejected,
            None,
            None,
            Some(ctx.sender()),
            Some(ctx.timestamp),
        )
    };

    ctx.db.message_batch().id().update(MessageBatch {
        status: new_status,
        approved_by,
        approved_at,
        rejected_by,
        rejected_at,
        rejection_reason: params.reason,
        ..batch
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: batch.company_id,
            table_name: "message_batch",
            record_id: batch_id,
            action: if params.approved { "APPROVE" } else { "REJECT" },
            old_values: None,
            new_values: None,
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Cancel an approved or pending batch and its draft child messages.
#[reducer]
pub fn cancel_message_batch(
    ctx: &ReducerContext,
    organization_id: u64,
    batch_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "message_batch", "cancel")?;
    let batch = ctx
        .db
        .message_batch()
        .id()
        .find(&batch_id)
        .ok_or("Message batch not found")?;
    if batch.organization_id != organization_id {
        return Err("Batch belongs to a different organization".to_string());
    }
    if batch.status == MessageBatchStatus::Completed || batch.status == MessageBatchStatus::Cancelled {
        return Err("Batch is already finalized".to_string());
    }

    ctx.db.message_batch().id().update(MessageBatch {
        status: MessageBatchStatus::Cancelled,
        ..batch
    });

    let child_ids: Vec<u64> = ctx
        .db
        .operational_message()
        .operational_message_by_batch()
        .filter(&batch_id)
        .map(|m| m.id)
        .collect();
    for message_id in child_ids {
        if let Some(message) = ctx.db.operational_message().id().find(&message_id) {
            if message.status == OperationalMessageStatus::Draft {
                ctx.db.operational_message().id().update(OperationalMessage {
                    status: OperationalMessageStatus::Cancelled,
                    ..message
                });
            }
        }
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: batch.company_id,
            table_name: "message_batch",
            record_id: batch_id,
            action: "CANCEL",
            old_values: None,
            new_values: None,
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

// ── Preference reducers ───────────────────────────────────────────────────────

/// Set contact communication preference for a channel.
#[reducer]
pub fn set_contact_communication_preference(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    contact_id: u64,
    channel: MessageChannel,
    opted_in: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "operational_message", "write")?;

    let existing: Vec<ContactCommunicationPreference> = ctx
        .db
        .contact_communication_preference()
        .preference_by_contact()
        .filter(&contact_id)
        .collect();

    if let Some(pref) = existing.into_iter().find(|p| p.channel == channel) {
        ctx.db.contact_communication_preference().id().update(ContactCommunicationPreference {
            opted_in,
            updated_at: ctx.timestamp,
            updated_by: ctx.sender(),
            ..pref
        });
    } else {
        ctx.db.contact_communication_preference().insert(ContactCommunicationPreference {
            id: 0,
            organization_id,
            company_id,
            contact_id,
            channel,
            opted_in,
            quiet_hours_start: None,
            quiet_hours_end: None,
            updated_at: ctx.timestamp,
            updated_by: ctx.sender(),
            metadata: None,
        });
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name: "contact_communication_preference",
            record_id: contact_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["opted_in".to_string()],
            metadata: None,
        },
    );
    Ok(())
}
