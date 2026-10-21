//! Document and mail templates for PDF generation and outbound email.

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::journal_entries::account_move;
use crate::core::messaging::{mail_message, MailMessage};
use crate::core::organization::require_company_in_organization;
use crate::core::persistence::{record_organization_commit, OrganizationCommitInput, RowChange};
use crate::core::users::user_organization;
use crate::documents::invoice_profile::{
    ensure_invoice_profile_update_allowed, validate_invoice_profile_metadata,
    INVOICE_PROFILE_REPORT_TYPE,
};
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

// Only the opt-in invoiceReview envelope strengthens the legacy queue contract.
// These pure views keep the final comparison independent of serialization details.
struct InvoiceMailReview {
    review_id: String,
    send_subject: String,
    send_body: String,
    attach_pdf: bool,
    is_reminder: bool,
    organization_id: u64,
    company_id: u64,
    move_id: u64,
    template_id: u64,
    subject: String,
    body_html: String,
    attach_document: bool,
    revision: Vec<serde_json::Value>,
}

struct ReviewedMailTemplate<'a> {
    organization_id: u64,
    company_id: Option<u64>,
    model: &'a str,
    active: bool,
    subject: &'a str,
    body_html: &'a str,
    attach_document: bool,
}

struct ReviewedMailRecord<'a> {
    organization_id: u64,
    company_id: u64,
    state: &'a str,
    move_type: &'a str,
    amount_total: f64,
    currency_id: u64,
    name: &'a str,
    partner_display_name: &'a str,
    metadata: Option<&'a str>,
}

fn parse_invoice_mail_review(context: Option<&str>) -> Result<Option<InvoiceMailReview>, String> {
    let Some(raw) = context else { return Ok(None) };
    let tagged = raw
        .match_indices("\"invoiceReview\"")
        .any(|(offset, key)| raw[offset + key.len()..].trim_start().starts_with(':'));
    let value: serde_json::Value = match serde_json::from_str(raw) {
        Ok(value) => value,
        Err(_) if tagged => return Err("invoice email review context is malformed".into()),
        Err(_) => return Ok(None),
    };
    let Some(review) = value.get("invoiceReview") else {
        return Ok(None);
    };
    if raw.len() > 131_072 {
        return Err("invoice email review context exceeds 131072 bytes".into());
    }
    let review = review
        .as_object()
        .ok_or("invoice email review must be an object")?;
    let schema_version = review
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    if !matches!(schema_version, 1 | 2) {
        return Err("invoice email review schema is unsupported".into());
    }
    let text = |key: &str, limit: usize| -> Result<String, String> {
        let value = review
            .get(key)
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| format!("invoice email review {key} is unavailable"))?;
        if value.len() > limit {
            return Err(format!("invoice email review {key} exceeds {limit} bytes"));
        }
        Ok(value.to_string())
    };
    let id = |key: &str| -> Result<u64, String> {
        let value = text(key, 20)?;
        let parsed = value
            .parse::<u64>()
            .ok()
            .filter(|id| *id > 0)
            .ok_or_else(|| format!("invoice email review {key} is invalid"))?;
        if parsed.to_string() != value {
            return Err(format!("invoice email review {key} is not canonical"));
        }
        Ok(parsed)
    };
    let review_id = text("reviewId", 128)?;
    if review_id.trim().is_empty() || review_id.chars().any(char::is_control) {
        return Err("invoice email review ID is required".into());
    }
    let attach_pdf = review
        .get("pdfAttached")
        .and_then(serde_json::Value::as_bool)
        .ok_or("invoice email review attachment choice is unavailable")?;
    if schema_version == 1 && attach_pdf {
        return Err("invoice email PDF attachments require a version 2 review".into());
    }
    let attach_document = review
        .get("expectedAttachDocument")
        .and_then(serde_json::Value::as_bool)
        .ok_or("invoice email review attachment state is unavailable")?;
    if schema_version == 1 && attach_document {
        return Err("invoice email PDF attachments require a version 2 review".into());
    }
    let subject = text("expectedSubject", 4096)?;
    let body_html = text("expectedBodyHtml", 65_536)?;
    let send_subject = if schema_version == 2 {
        text("subject", 4096)?
    } else {
        subject.clone()
    };
    let send_body = if schema_version == 2 {
        text("bodyText", 65_536)?
    } else {
        body_html.clone()
    };
    if send_subject.trim().is_empty()
        || send_body.trim().is_empty()
        || send_subject.chars().any(char::is_control)
    {
        return Err("invoice email requires a non-empty single-line subject and message".into());
    }
    let is_reminder = match review.get("purpose").and_then(serde_json::Value::as_str) {
        None | Some("invoice") => false,
        Some("reminder") => true,
        _ => return Err("invoice email review purpose is invalid".into()),
    };
    let move_id = id("moveId")?;
    let pdf_filename = text("pdfFilename", 128)?;
    if pdf_filename != format!("account-move-{move_id}.pdf") {
        return Err("invoice email PDF filename does not match the reviewed invoice".into());
    }
    let revision: Vec<serde_json::Value> =
        serde_json::from_str(&text("recordRevision", 65_536)?)
            .map_err(|_| "invoice email record revision is malformed")?;
    if revision.len() != 7
        || revision[0].as_str().is_none()
        || revision[1].as_str().is_none()
        || !revision[2].as_f64().is_some_and(f64::is_finite)
        || revision[3].as_str().is_none()
        || revision[4].as_str().is_none()
        || revision[5].as_str().is_none()
        || !(revision[6].is_null() || revision[6].is_string())
    {
        return Err("invoice email record revision is incomplete".into());
    }
    Ok(Some(InvoiceMailReview {
        review_id,
        send_subject,
        send_body,
        attach_pdf,
        is_reminder,
        organization_id: id("organizationId")?,
        company_id: id("companyId")?,
        move_id: id("moveId")?,
        template_id: id("templateId")?,
        subject,
        body_html,
        attach_document,
        revision,
    }))
}

fn validate_invoice_mail_review(
    review: &InvoiceMailReview,
    organization_id: u64,
    company_id: u64,
    model: &str,
    res_id: u64,
    template_id: u64,
    template: &ReviewedMailTemplate<'_>,
    record: &ReviewedMailRecord<'_>,
) -> Result<(), String> {
    if model != "account_move"
        || review.organization_id != organization_id
        || review.company_id != company_id
        || review.move_id != res_id
        || review.template_id != template_id
        || record.organization_id != organization_id
        || record.company_id != company_id
    {
        return Err(
            "invoice email review target is outside the reviewed organization/company".into(),
        );
    }
    if template.organization_id != organization_id
        || template.company_id.is_some_and(|id| id != company_id)
        || template.model != "account_move"
        || !template.active
    {
        return Err("invoice email template is unavailable in the reviewed company".into());
    }
    if template.subject != review.subject
        || template.body_html != review.body_html
        || template.attach_document != review.attach_document
    {
        return Err(
            "invoice email template changed after review; review the current message".into(),
        );
    }
    if record.state != "Posted" || !matches!(record.move_type, "OutInvoice" | "OutRefund") {
        return Err("invoice email requires a posted outgoing invoice or credit note".into());
    }
    let revision = &review.revision;
    if revision[0].as_str() != Some(record.state)
        || revision[1].as_str() != Some(record.move_type)
        || revision[2].as_f64() != Some(record.amount_total)
        || revision[3].as_str() != Some(record.currency_id.to_string().as_str())
        || revision[4].as_str() != Some(record.name)
        || revision[5].as_str() != Some(record.partner_display_name)
        || revision[6].as_str() != record.metadata
    {
        return Err("invoice changed after email review; review the current document".into());
    }
    Ok(())
}

fn validate_reminder_target(
    review: &InvoiceMailReview,
    record: &crate::accounting::journal_entries::AccountMove,
    now: Timestamp,
) -> Result<(), String> {
    if !review.is_reminder {
        return Ok(());
    }
    let day = |timestamp: Timestamp| {
        timestamp
            .to_micros_since_unix_epoch()
            .div_euclid(86_400_000_000)
    };
    if format!("{:?}", record.move_type) != "OutInvoice"
        || !record.amount_residual.is_finite()
        || record.amount_residual <= 0.0
        || !record
            .invoice_date_due
            .is_some_and(|due| day(due) < day(now))
    {
        return Err("payment reminder requires a currently overdue customer invoice with an outstanding balance".into());
    }
    Ok(())
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

    if params.report_type == INVOICE_PROFILE_REPORT_TYPE {
        match company_id {
            Some(company_id) => {
                require_company_in_organization(ctx, organization_id, company_id)?;
                check_permission(ctx, organization_id, "company", "write")?;
            }
            None => check_permission(ctx, organization_id, "organization", "write")?,
        }
        if params.model.trim() != "account_move" || !params.is_default || !params.is_active {
            return Err(
                "invoice profiles must be active default account_move templates".to_string(),
            );
        }
        validate_invoice_profile_metadata(organization_id, params.metadata.as_deref())?;
    }

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
            new_values: Some(
                serde_json::json!({ "name": row.name, "model": row.model }).to_string(),
            ),
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
    ensure_invoice_profile_update_allowed(&template.report_type, params.report_type.as_deref())?;

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
            new_values: Some(
                serde_json::json!({ "name": row.name, "model": row.model }).to_string(),
            ),
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

    let review = parse_invoice_mail_review(params.context_json.as_deref())?;
    if let Some(review) = &review {
        check_permission(ctx, organization_id, "account_move", "read")?;
        require_company_in_organization(ctx, organization_id, company_id)?;
        if !ctx
            .db
            .user_organization()
            .user_org_by_user()
            .filter(ctx.sender())
            .any(|membership| {
                membership.organization_id == organization_id
                    && membership.is_active
                    && membership.company_id.is_none_or(|id| id == company_id)
            })
        {
            return Err(
                "invoice email review requires active membership in the reviewed company".into(),
            );
        }
        let record = ctx
            .db
            .account_move()
            .id()
            .find(params.res_id)
            .ok_or("reviewed invoice not found")?;
        validate_invoice_mail_review(
            &review,
            organization_id,
            company_id,
            &params.model,
            params.res_id,
            params.template_id,
            &ReviewedMailTemplate {
                organization_id: template.organization_id,
                company_id: template.company_id,
                model: &template.model,
                active: template.is_active,
                subject: &template.subject,
                body_html: &template.body_html,
                attach_document: template.attach_document,
            },
            &ReviewedMailRecord {
                organization_id: record.organization_id,
                company_id: record.company_id,
                state: &format!("{:?}", record.state),
                move_type: &format!("{:?}", record.move_type),
                amount_total: record.amount_total,
                currency_id: record.currency_id,
                name: &record.name,
                partner_display_name: record
                    .invoice_partner_display_name
                    .as_deref()
                    .unwrap_or_default(),
                metadata: record.metadata.as_deref(),
            },
        )?;
        validate_reminder_target(review, &record, ctx.timestamp)?;
    }

    if review.is_some()
        && (params.recipient_email.trim().len() > 254
            || params.recipient_email.trim().split('@').count() != 2
            || params.recipient_email.trim().chars().any(|value| {
                value.is_whitespace() || value.is_control() || matches!(value, '<' | '>')
            }))
    {
        return Err("invoice email requires one valid recipient address".into());
    }
    let send_subject = review
        .as_ref()
        .map(|review| review.send_subject.as_str())
        .unwrap_or(&template.subject);
    let send_body = review
        .as_ref()
        .map(|review| review.send_body.as_str())
        .unwrap_or(&template.body_html);
    let attach_pdf = review
        .as_ref()
        .map(|review| review.attach_pdf)
        .unwrap_or(template.attach_document);
    if let Some(review) = &review {
        // The exact token is consumed atomically with insertion, including simultaneous callers.
        for existing in ctx
            .db
            .mail_message()
            .mail_message_by_org()
            .filter(organization_id)
        {
            let Some(metadata) = existing
                .metadata
                .as_deref()
                .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
            else {
                continue;
            };
            let Some(context) = metadata
                .get("context_json")
                .and_then(serde_json::Value::as_str)
            else {
                continue;
            };
            // Unrelated legacy/malformed chatter must not poison this organization's outbox.
            let Some(previous) = serde_json::from_str::<serde_json::Value>(context).ok() else {
                continue;
            };
            if previous
                .get("invoiceReview")
                .and_then(|value| value.get("reviewId"))
                .and_then(serde_json::Value::as_str)
                == Some(review.review_id.as_str())
            {
                if existing.model == params.model
                    && existing.res_id == params.res_id
                    && metadata
                        .get("context_json")
                        .and_then(serde_json::Value::as_str)
                        == params.context_json.as_deref()
                    && metadata.get("to").and_then(serde_json::Value::as_str)
                        == Some(params.recipient_email.trim())
                {
                    return Ok(());
                }
                return Err(
                    "invoice email review token was already used for a different request".into(),
                );
            }
        }
    }
    let delivery_metadata = serde_json::json!({
        "delivery": "queued",
        "to": params.recipient_email.trim(),
        "subject": send_subject,
        "html": send_body,
        "mail_template_id": params.template_id,
        "attach_document": attach_pdf,
        "context_json": params.context_json,
    })
    .to_string();

    let msg = ctx.db.mail_message().insert(MailMessage {
        id: 0,
        organization_id,
        model: params.model.clone(),
        res_id: params.res_id,
        author_id: ctx.sender(),
        body: send_body.to_string(),
        message_type: MailMessageType::Email,
        subtype: Some("mail.template.send".to_string()),
        date: ctx.timestamp,
        parent_id: None,
        attachment_ids: Vec::new(),
        metadata: Some(delivery_metadata),
    });

    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.queue_mail_from_template".into(),
            correlation_id: format!("mail:{}:queue", msg.id),
            changes: vec![RowChange::upsert_stdb_row(
                "mail_message",
                serde_json::json!({"id":msg.id}),
                &msg,
            )?],
        },
    )?;
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

/// Claim one reviewed email before provider dispatch. A claimed or uncertain request cannot be replayed.
/// Kept denied to generic operations; the dedicated API route supplies the request digest after rendering.
#[reducer]
pub fn claim_reviewed_mail_delivery(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    message_id: u64,
    review_id: String,
    request_digest: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "mail_message", "write")?;
    check_permission(ctx, organization_id, "mail_template", "read")?;
    check_permission(ctx, organization_id, "mail_template", "write")?;
    check_permission(ctx, organization_id, "account_move", "read")?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    if !ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(ctx.sender())
        .any(|membership| {
            membership.organization_id == organization_id
                && membership.is_active
                && membership.company_id.is_none_or(|id| id == company_id)
        })
    {
        return Err("reviewed dispatch requires active membership in the reviewed company".into());
    }
    let message = ctx
        .db
        .mail_message()
        .id()
        .find(message_id)
        .ok_or("reviewed mail message not found")?;
    if message.organization_id != organization_id || message.model != "account_move" {
        return Err("reviewed mail message is outside the requested organization".into());
    }
    let mut metadata: serde_json::Value = serde_json::from_str(
        message
            .metadata
            .as_deref()
            .ok_or("mail metadata unavailable")?,
    )
    .map_err(|_| "mail metadata malformed")?;
    let review = reviewed_delivery_claim(&metadata, &message.body, &review_id, &request_digest)?;
    let template = ctx
        .db
        .mail_template()
        .id()
        .find(review.template_id)
        .ok_or("reviewed mail template not found")?;
    let record = ctx
        .db
        .account_move()
        .id()
        .find(message.res_id)
        .ok_or("reviewed invoice not found")?;
    validate_invoice_mail_review(
        &review,
        organization_id,
        company_id,
        &message.model,
        message.res_id,
        template.id,
        &ReviewedMailTemplate {
            organization_id: template.organization_id,
            company_id: template.company_id,
            model: &template.model,
            active: template.is_active,
            subject: &template.subject,
            body_html: &template.body_html,
            attach_document: template.attach_document,
        },
        &ReviewedMailRecord {
            organization_id: record.organization_id,
            company_id: record.company_id,
            state: &format!("{:?}", record.state),
            move_type: &format!("{:?}", record.move_type),
            amount_total: record.amount_total,
            currency_id: record.currency_id,
            name: &record.name,
            partner_display_name: record
                .invoice_partner_display_name
                .as_deref()
                .unwrap_or_default(),
            metadata: record.metadata.as_deref(),
        },
    )?;
    validate_reminder_target(&review, &record, ctx.timestamp)?;
    metadata["delivery"] = serde_json::json!("dispatching");
    metadata["dispatch_review_id"] = serde_json::json!(review_id);
    metadata["dispatch_request_digest"] = serde_json::json!(request_digest);
    metadata["dispatch_claimed_at"] = serde_json::json!(ctx
        .timestamp
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_micros());
    let updated = ctx.db.mail_message().id().update(MailMessage {
        metadata: Some(metadata.to_string()),
        ..message
    });
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.claim_reviewed_mail_delivery".into(),
            correlation_id: format!("mail:{message_id}:claim:{}", review.review_id),
            changes: vec![RowChange::upsert_stdb_row(
                "mail_message",
                serde_json::json!({"id": message_id}),
                &updated,
            )?],
        },
    )?;
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "mail_message",
            record_id: message_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(r#"{"delivery":"dispatching"}"#.into()),
            changed_fields: vec!["metadata".into()],
            metadata: None,
        },
    );
    Ok(())
}

fn reviewed_delivery_claim(
    metadata: &serde_json::Value,
    body: &str,
    review_id: &str,
    request_digest: &str,
) -> Result<InvoiceMailReview, String> {
    if metadata.get("delivery").and_then(serde_json::Value::as_str) != Some("queued") {
        return Err("reviewed email is already claimed or sent; inspect the original request without retrying".into());
    }
    if request_digest.len() != 64
        || !request_digest
            .bytes()
            .all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value))
    {
        return Err("reviewed mail request digest is invalid".into());
    }
    let review = parse_invoice_mail_review(
        metadata
            .get("context_json")
            .and_then(serde_json::Value::as_str),
    )?
    .ok_or("mail message has no invoice review")?;
    if review.review_id != review_id
        || metadata
            .get("mail_template_id")
            .and_then(serde_json::Value::as_u64)
            != Some(review.template_id)
        || metadata.get("subject").and_then(serde_json::Value::as_str)
            != Some(review.send_subject.as_str())
        || metadata.get("html").and_then(serde_json::Value::as_str)
            != Some(review.send_body.as_str())
        || metadata
            .get("attach_document")
            .and_then(serde_json::Value::as_bool)
            != Some(review.attach_pdf)
        || body != review.send_body
    {
        return Err("mail payload does not match the exact invoice review".into());
    }
    Ok(review)
}

#[cfg(test)]
mod invoice_mail_review_tests {
    use super::*;
    use serde_json::json;

    fn context() -> serde_json::Value {
        json!({ "invoiceReview": { "schemaVersion": 1, "reviewId": "review-unique", "organizationId": "1", "companyId": "2", "moveId": "3", "templateId": "4", "reference": "INV/3", "pdfFilename": "account-move-3.pdf", "pdfAttached": false, "expectedSubject": "Reviewed subject", "expectedBodyHtml": "Reviewed body", "expectedAttachDocument": false, "recordRevision": "[\"Posted\",\"OutInvoice\",1,\"5\",\"INV/3\",\"Buyer\",null]" } })
    }
    fn review() -> InvoiceMailReview {
        parse_invoice_mail_review(Some(&context().to_string()))
            .expect("context")
            .expect("tagged")
    }
    fn template() -> ReviewedMailTemplate<'static> {
        ReviewedMailTemplate {
            organization_id: 1,
            company_id: None,
            model: "account_move",
            active: true,
            subject: "Reviewed subject",
            body_html: "Reviewed body",
            attach_document: false,
        }
    }
    fn record() -> ReviewedMailRecord<'static> {
        ReviewedMailRecord {
            organization_id: 1,
            company_id: 2,
            state: "Posted",
            move_type: "OutInvoice",
            amount_total: 1.0,
            currency_id: 5,
            name: "INV/3",
            partner_display_name: "Buyer",
            metadata: None,
        }
    }
    fn validate(
        template: &ReviewedMailTemplate<'_>,
        record: &ReviewedMailRecord<'_>,
    ) -> Result<(), String> {
        validate_invoice_mail_review(&review(), 1, 2, "account_move", 3, 4, template, record)
    }

    #[test]
    fn shared_or_exact_company_template_accepts_semantically_equal_numeric_revision() {
        assert!(validate(&template(), &record()).is_ok());
        let mut scoped = template();
        scoped.company_id = Some(2);
        assert!(validate(&scoped, &record()).is_ok());
        let mut refund = record();
        refund.move_type = "OutRefund";
        let mut review = review();
        review.revision[1] = json!("OutRefund");
        review.revision[2] = json!(1.0);
        assert!(validate_invoice_mail_review(
            &review,
            1,
            2,
            "account_move",
            3,
            4,
            &scoped,
            &refund
        )
        .is_ok());
    }

    #[test]
    fn stale_template_content_attachment_and_classification_are_rejected_atomically() {
        let mut changed = template();
        changed.subject = "Changed subject";
        assert!(validate(&changed, &record()).is_err());
        let mut changed = template();
        changed.body_html = "Changed body";
        assert!(validate(&changed, &record()).is_err());
        let mut changed = template();
        changed.attach_document = true;
        assert!(validate(&changed, &record()).is_err());
        let mut changed = template();
        changed.active = false;
        assert!(validate(&changed, &record()).is_err());
        let mut changed = template();
        changed.model = "sale_order";
        assert!(validate(&changed, &record()).is_err());
        let mut changed = template();
        changed.company_id = Some(99);
        assert!(validate(&changed, &record()).is_err());
        let mut changed = template();
        changed.organization_id = 99;
        assert!(validate(&changed, &record()).is_err());
    }

    #[test]
    fn reviewed_target_scope_and_exact_identifiers_cannot_be_substituted() {
        for (org, company, model, res_id, template_id) in [
            (9, 2, "account_move", 3, 4),
            (1, 9, "account_move", 3, 4),
            (1, 2, "sale_order", 3, 4),
            (1, 2, "account_move", 9, 4),
            (1, 2, "account_move", 3, 9),
        ] {
            assert!(validate_invoice_mail_review(
                &review(),
                org,
                company,
                model,
                res_id,
                template_id,
                &template(),
                &record()
            )
            .is_err());
        }
        let mut changed = record();
        changed.organization_id = 9;
        assert!(validate(&template(), &changed).is_err());
        let mut changed = record();
        changed.company_id = 9;
        assert!(validate(&template(), &changed).is_err());
    }

    #[test]
    fn stale_record_revision_or_unsupported_posting_role_is_rejected() {
        let mut changed = record();
        changed.amount_total = 2.0;
        assert!(validate(&template(), &changed).is_err());
        let mut changed = record();
        changed.currency_id = 6;
        assert!(validate(&template(), &changed).is_err());
        let mut changed = record();
        changed.name = "INV/changed";
        assert!(validate(&template(), &changed).is_err());
        let mut changed = record();
        changed.partner_display_name = "Changed buyer";
        assert!(validate(&template(), &changed).is_err());
        let mut changed = record();
        changed.metadata = Some("changed snapshot");
        assert!(validate(&template(), &changed).is_err());
        let mut changed = record();
        changed.state = "Draft";
        assert!(validate(&template(), &changed).is_err());
        let mut changed = record();
        changed.move_type = "InInvoice";
        assert!(validate(&template(), &changed).is_err());
    }

    #[test]
    fn malformed_tagged_reviews_and_oversize_contexts_fail_explicitly() {
        for value in [
            json!({"invoiceReview":null}),
            json!({"invoiceReview":{"schemaVersion":2}}),
        ] {
            assert!(parse_invoice_mail_review(Some(&value.to_string())).is_err());
        }
        for (key, value) in [
            ("expectedSubject", json!(null)),
            ("expectedBodyHtml", json!("x".repeat(65_537))),
            ("recordRevision", json!("[]")),
            ("expectedAttachDocument", json!(true)),
            ("pdfAttached", json!(true)),
            ("companyId", json!("02")),
            ("reviewId", json!("")),
        ] {
            let mut changed = context();
            changed["invoiceReview"][key] = value;
            assert!(
                parse_invoice_mail_review(Some(&changed.to_string())).is_err(),
                "{key}"
            );
        }
        let mut changed = context();
        changed["extra"] = json!("x".repeat(131_073));
        assert!(parse_invoice_mail_review(Some(&changed.to_string())).is_err());
        assert!(parse_invoice_mail_review(Some("{\"invoiceReview\":bad")).is_err());
    }

    #[test]
    fn legacy_untagged_contexts_retain_existing_queue_behavior() {
        for raw in [
            None,
            Some("legacy arbitrary context"),
            Some("{malformed legacy"),
            Some("[]"),
            Some("null"),
            Some("{\"otherContext\":true}"),
            Some("{\"unrelated\":\"invoiceReview\""),
        ] {
            assert!(parse_invoice_mail_review(raw)
                .expect("legacy unchanged")
                .is_none());
        }
        let unrelated =
            json!({"unrelated":"invoiceReview", "payload":"x".repeat(131_073)}).to_string();
        assert!(parse_invoice_mail_review(Some(&unrelated))
            .expect("untagged context has no new limit")
            .is_none());
    }

    #[test]
    fn version_two_freezes_plain_text_and_attachment_intent_without_changing_template_evidence() {
        let mut context = context();
        context["invoiceReview"]["schemaVersion"] = json!(2);
        context["invoiceReview"]["subject"] = json!("One-off reminder");
        context["invoiceReview"]["bodyText"] = json!("Plain <script>text</script>");
        context["invoiceReview"]["pdfAttached"] = json!(true);
        let review = parse_invoice_mail_review(Some(&context.to_string()))
            .expect("parse")
            .expect("review");
        assert_eq!(review.subject, "Reviewed subject");
        assert_eq!(review.send_subject, "One-off reminder");
        assert_eq!(review.send_body, "Plain <script>text</script>");
        assert!(review.attach_pdf);
        assert!(validate_invoice_mail_review(
            &review,
            1,
            2,
            "account_move",
            3,
            4,
            &template(),
            &record()
        )
        .is_ok());
        let mut metadata = json!({"delivery":"queued", "subject":review.send_subject, "html":review.send_body,
            "mail_template_id":4, "attach_document":true, "context_json":context.to_string()});
        assert!(reviewed_delivery_claim(
            &metadata,
            "Plain <script>text</script>",
            "review-unique",
            &"a".repeat(64)
        )
        .is_ok());
        metadata["delivery"] = json!("dispatching");
        assert!(reviewed_delivery_claim(
            &metadata,
            "Plain <script>text</script>",
            "review-unique",
            &"a".repeat(64)
        )
        .is_err());
        context["invoiceReview"]["subject"] = json!("Header\r\ninjection");
        assert!(parse_invoice_mail_review(Some(&context.to_string())).is_err());
    }
}
