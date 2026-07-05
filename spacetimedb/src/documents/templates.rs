//! Document and mail templates for PDF generation and outbound email.

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::messaging::{mail_message, MailMessage};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::MailMessageType;

// ── Tables ───────────────────────────────────────────────────────────────────

/// Reusable document layout for PDF generation (invoice, PO, quote, etc.).
#[derive(Clone)]
#[spacetimedb::table(
    accessor = document_template,
    public,
    index(accessor = document_template_by_org, btree(columns = [organization_id])),
    index(accessor = document_template_by_model, btree(columns = [model]))
)]
pub struct DocumentTemplate {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub name: String,
    pub model: String,
    pub report_type: String,
    pub body_html: String,
    pub header_html: Option<String>,
    pub footer_html: Option<String>,
    pub variable_bindings_json: Option<String>,
    pub is_default: bool,
    pub is_active: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Email template with subject/body and optional linked document template.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = mail_template,
    public,
    index(accessor = mail_template_by_org, btree(columns = [organization_id])),
    index(accessor = mail_template_by_model, btree(columns = [model]))
)]
pub struct MailTemplate {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub name: String,
    pub model: String,
    pub subject: String,
    pub body_html: String,
    pub document_template_id: Option<u64>,
    pub attach_document: bool,
    pub is_default: bool,
    pub is_active: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateDocumentTemplateParams {
    pub name: String,
    pub model: String,
    pub report_type: String,
    pub body_html: String,
    pub header_html: Option<String>,
    pub footer_html: Option<String>,
    pub variable_bindings_json: Option<String>,
    pub is_default: bool,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateDocumentTemplateParams {
    pub name: Option<String>,
    pub report_type: Option<String>,
    pub body_html: Option<String>,
    pub header_html: Option<Option<String>>,
    pub footer_html: Option<Option<String>>,
    pub variable_bindings_json: Option<Option<String>>,
    pub is_default: Option<bool>,
    pub is_active: Option<bool>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateMailTemplateParams {
    pub name: String,
    pub model: String,
    pub subject: String,
    pub body_html: String,
    pub document_template_id: Option<u64>,
    pub attach_document: bool,
    pub is_default: bool,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateMailTemplateParams {
    pub name: Option<String>,
    pub subject: Option<String>,
    pub body_html: Option<String>,
    pub document_template_id: Option<Option<u64>>,
    pub attach_document: Option<bool>,
    pub is_default: Option<bool>,
    pub is_active: Option<bool>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct QueueMailFromTemplateParams {
    pub template_id: u64,
    pub model: String,
    pub res_id: u64,
    pub recipient_email: String,
    pub context_json: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_document_template(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    params: CreateDocumentTemplateParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document_template", "create")?;

    if params.name.trim().is_empty() {
        return Err("name is required".to_string());
    }
    if params.model.trim().is_empty() {
        return Err("model is required".to_string());
    }
    if params.body_html.trim().is_empty() {
        return Err("body_html is required".to_string());
    }

    let row = ctx.db.document_template().insert(DocumentTemplate {
        id: 0,
        organization_id,
        company_id,
        name: params.name.trim().to_string(),
        model: params.model.trim().to_string(),
        report_type: params.report_type,
        body_html: params.body_html,
        header_html: params.header_html,
        footer_html: params.footer_html,
        variable_bindings_json: params.variable_bindings_json,
        is_default: params.is_default,
        is_active: params.is_active,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name: "document_template",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": row.name, "model": row.model }).to_string()),
            changed_fields: vec!["name".to_string(), "model".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn update_document_template(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    template_id: u64,
    params: UpdateDocumentTemplateParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "document_template", "write")?;

    let template = ctx
        .db
        .document_template()
        .id()
        .find(&template_id)
        .ok_or("document template not found")?;

    if template.organization_id != organization_id {
        return Err("document template does not belong to this organization".to_string());
    }
    if template.company_id != company_id {
        return Err("document template does not belong to this company scope".to_string());
    }

    let updated = DocumentTemplate {
        name: params.name.unwrap_or(template.name),
        report_type: params.report_type.unwrap_or(template.report_type),
        body_html: params.body_html.unwrap_or(template.body_html),
        header_html: params.header_html.unwrap_or(template.header_html),
        footer_html: params.footer_html.unwrap_or(template.footer_html),
        variable_bindings_json: params
            .variable_bindings_json
            .unwrap_or(template.variable_bindings_json),
        is_default: params.is_default.unwrap_or(template.is_default),
        is_active: params.is_active.unwrap_or(template.is_active),
        metadata: params.metadata.or(template.metadata),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..template
    };

    ctx.db.document_template().id().update(updated.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name: "document_template",
            record_id: template_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": updated.name }).to_string()),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn create_mail_template(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    params: CreateMailTemplateParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mail_template", "create")?;

    if params.name.trim().is_empty() {
        return Err("name is required".to_string());
    }
    if params.model.trim().is_empty() {
        return Err("model is required".to_string());
    }
    if params.subject.trim().is_empty() {
        return Err("subject is required".to_string());
    }
    if params.body_html.trim().is_empty() {
        return Err("body_html is required".to_string());
    }

    let row = ctx.db.mail_template().insert(MailTemplate {
        id: 0,
        organization_id,
        company_id,
        name: params.name.trim().to_string(),
        model: params.model.trim().to_string(),
        subject: params.subject,
        body_html: params.body_html,
        document_template_id: params.document_template_id,
        attach_document: params.attach_document,
        is_default: params.is_default,
        is_active: params.is_active,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name: "mail_template",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": row.name, "model": row.model }).to_string()),
            changed_fields: vec!["name".to_string(), "model".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn update_mail_template(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    template_id: u64,
    params: UpdateMailTemplateParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mail_template", "write")?;

    let template = ctx
        .db
        .mail_template()
        .id()
        .find(&template_id)
        .ok_or("mail template not found")?;

    if template.organization_id != organization_id {
        return Err("mail template does not belong to this organization".to_string());
    }
    if template.company_id != company_id {
        return Err("mail template does not belong to this company scope".to_string());
    }

    let updated = MailTemplate {
        name: params.name.unwrap_or(template.name),
        subject: params.subject.unwrap_or(template.subject),
        body_html: params.body_html.unwrap_or(template.body_html),
        document_template_id: params
            .document_template_id
            .unwrap_or(template.document_template_id),
        attach_document: params.attach_document.unwrap_or(template.attach_document),
        is_default: params.is_default.unwrap_or(template.is_default),
        is_active: params.is_active.unwrap_or(template.is_active),
        metadata: params.metadata.or(template.metadata),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..template
    };

    ctx.db.mail_template().id().update(updated.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id,
            table_name: "mail_template",
            record_id: template_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": updated.name }).to_string()),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Queue an outbound email from a mail template (api-server delivers via Resend).
#[reducer]
pub fn queue_mail_from_template(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: QueueMailFromTemplateParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mail_template", "write")?;

    let template = ctx
        .db
        .mail_template()
        .id()
        .find(&params.template_id)
        .ok_or("mail template not found")?;

    if template.organization_id != organization_id {
        return Err("mail template does not belong to this organization".to_string());
    }
    if !template.is_active {
        return Err("mail template is not active".to_string());
    }
    if params.recipient_email.trim().is_empty() {
        return Err("recipient_email is required".to_string());
    }

    let delivery_metadata = serde_json::json!({
        "delivery": "queued",
        "to": params.recipient_email.trim(),
        "subject": template.subject,
        "html": template.body_html,
        "mail_template_id": params.template_id,
        "attach_document": template.attach_document,
        "context_json": params.context_json,
    })
    .to_string();

    let msg = ctx.db.mail_message().insert(MailMessage {
        id: 0,
        organization_id,
        model: params.model.clone(),
        res_id: params.res_id,
        author_id: ctx.sender(),
        body: template.body_html.clone(),
        message_type: MailMessageType::Email,
        subtype: Some("mail.template.send".to_string()),
        date: ctx.timestamp,
        parent_id: None,
        attachment_ids: Vec::new(),
        metadata: Some(delivery_metadata),
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "mail_message",
            record_id: msg.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "template_id": params.template_id,
                    "recipient_email": params.recipient_email,
                    "model": params.model,
                    "res_id": params.res_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["body".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
