//! COMMUNICATION / STALE STATE / TENANCY certification for provider callbacks,
//! batch approval boundaries, content immutability and contact merge continuity.
//!
//! Canonical rules encoded here are documented in the plan's communications section.
//! Provider principal rows are inserted directly as fault-injection setup (the
//! executor identity is the test sender), matching `crm::deferred_test`.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use spacetimedb::{ReducerContext, Table};

use super::{run_cases, setup, CertCase};
use crate::accounting_tests::helpers::create_balanced_customer_invoice;
use crate::core::operational_messaging::{
    cancel_message_batch, contact_communication_preference, create_invoice_reminder_batch,
    create_message_batch, create_message_template, message_batch, message_template,
    operational_message, review_message_batch, set_contact_communication_preference,
    update_message_template, CreateInvoiceReminderBatchParams, CreateMessageBatchParams,
    CreateMessageTemplateParams, MessageBatch, OperationalMessage, ReviewMessageBatchParams,
    UpdateMessageTemplateParams,
};
use crate::crm::contact_identities::{
    archive_contact_identity, contact_phone_identity, create_contact_identity,
    update_contact_identity, CreateContactIdentityParams, UpdateContactIdentityParams,
};
use crate::crm::contacts::{contact, create_contact, CreateContactParams};
use crate::crm::duplicate::{merge_contacts, MergeContactsParams};
use crate::crm::inbox::{
    append_crm_conversation_message, crm_conversation, crm_conversation_message,
    crm_provider_event_receipt, crm_provider_principal, open_crm_conversation,
    receive_crm_provider_message, record_crm_provider_delivery,
    AppendCrmConversationMessageParams, CrmProviderPrincipal, OpenCrmConversationParams,
    ReceiveCrmProviderMessageParams, RecordCrmProviderDeliveryParams,
};
use crate::integrations::whatsapp_business::{
    whatsapp_business_account, VerificationLevel, VerificationStatus, WhatsAppBusinessAccount,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{
    ContactIdentityKind, IntegrationStatus, MessageBatchStatus, MessageChannel,
    OperationalMessageStatus, SyncStatus,
};

pub const CASES: &[CertCase] = &[
    ("COMM-01", comm_01_event_id_reuse_fails_closed),
    ("COMM-02", comm_02_duplicate_delivered_callback_single_effect),
    ("COMM-03", comm_03_provider_message_id_ownership_is_unique),
    ("COMM-04", comm_04_out_of_order_callbacks_never_regress),
    ("COMM-05", comm_05_stale_callback_is_absorbed),
    ("COMM-06", comm_06_consent_revalidated_at_approval),
    ("COMM-07", comm_07_recipient_identity_revalidated_at_approval),
    ("COMM-08", comm_08_rendered_content_immutable_after_template_edit),
    ("COMM-09", comm_09_contact_batch_approves_rendered_content),
    ("COMM-10", comm_10_merge_keeps_one_traceable_timeline),
    ("COMM-11", comm_11_creator_cannot_approve_own_batch),
    ("COMM-12", comm_12_batch_and_consent_mutations_are_org_scoped),
    ("COMM-13", comm_13_batch_recipients_are_org_scoped),
    ("COMM-14", comm_14_recipient_number_change_invalidates_approval),
];

pub fn run_communications_certification(ctx: &ReducerContext) -> Result<(), String> {
    run_cases(ctx, "communications", CASES)
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

pub(super) fn fingerprint(event_id: &str) -> String {
    let mut hasher = DefaultHasher::new();
    event_id.hash(&mut hasher);
    let h = hasher.finish();
    format!(
        "{:016x}{:016x}{:016x}{:016x}",
        h,
        h.rotate_left(13),
        h.rotate_left(29),
        h.rotate_left(47)
    )
}

fn contact_params(name: &str, company_id: u64) -> CreateContactParams {
    CreateContactParams {
        name: name.to_string(),
        type_: "contact".to_string(),
        email: None,
        phone: None,
        mobile: None,
        company_id: Some(company_id),
        is_customer: true,
        is_vendor: false,
        is_employee: false,
        is_prospect: false,
        is_partner: false,
        customer_rank: 1,
        supplier_rank: 0,
        display_name: None,
        first_name: None,
        last_name: None,
        title: None,
        email_secondary: None,
        fax: None,
        website: None,
        street: None,
        street2: None,
        city: None,
        state_code: None,
        zip: None,
        country_code: None,
        tax_id: None,
        company_registry: None,
        industry: None,
        employees_count: None,
        annual_revenue: None,
        description: None,
        salesperson_id: None,
        assigned_user_id: None,
        parent_id: None,
        user_id: None,
        color: None,
        metadata: Some(r#"{"test":"pretenant"}"#.to_string()),
    }
}

fn seed_contact(ctx: &ReducerContext, org: u64, company: u64, name: &str) -> Result<u64, String> {
    create_contact(ctx, org, contact_params(name, company))?;
    ctx.db
        .contact()
        .iter()
        .filter(|c| c.organization_id == org && c.name == name)
        .map(|c| c.id)
        .max()
        .ok_or_else(|| format!("contact {name} missing"))
}

fn add_primary_phone(
    ctx: &ReducerContext,
    org: u64,
    contact_id: u64,
    e164: &str,
) -> Result<u64, String> {
    create_contact_identity(
        ctx,
        org,
        CreateContactIdentityParams {
            contact_id,
            company_id: None,
            kind: ContactIdentityKind::Primary,
            raw_value: e164.to_string(),
            is_preferred: true,
            verification_state: None,
            metadata: Some(r#"{"test":"pretenant"}"#.to_string()),
        },
    )?;
    ctx.db
        .contact_phone_identity()
        .iter()
        .filter(|i| {
            i.organization_id == org
                && i.contact_id == contact_id
                && i.normalized_e164 == e164
                && i.archived_at.is_none()
        })
        .map(|i| i.id)
        .max()
        .ok_or_else(|| format!("phone identity {e164} missing"))
}

fn seed_template(ctx: &ReducerContext, org: u64, key: &str) -> Result<u64, String> {
    create_message_template(
        ctx,
        org,
        CreateMessageTemplateParams {
            company_id: None,
            key: key.to_string(),
            name: format!("{key} reminder"),
            locale: "en".to_string(),
            subject: Some("Invoice {{invoice_number}}".to_string()),
            body_template: "Hello {{customer_name}}, invoice {{invoice_number}} is due."
                .to_string(),
            allowed_variables: vec!["customer_name".to_string(), "invoice_number".to_string()],
            applicable_channels: vec![MessageChannel::Sms, MessageChannel::WhatsApp],
            retention_classification: "operational".to_string(),
            metadata: None,
        },
    )?;
    ctx.db
        .message_template()
        .message_template_by_key()
        .filter((&org, &key.to_string()))
        .map(|t| t.id)
        .max()
        .ok_or_else(|| format!("template {key} missing"))
}

fn seed_contact_batch(
    ctx: &ReducerContext,
    org: u64,
    company: u64,
    template_id: u64,
    candidates: Vec<u64>,
    marker: &str,
) -> Result<MessageBatch, String> {
    create_message_batch(
        ctx,
        org,
        CreateMessageBatchParams {
            company_id: Some(company),
            template_id,
            channel: MessageChannel::Sms,
            subject_model: "contact".to_string(),
            subject_query: Some(marker.to_string()),
            candidate_contact_ids: candidates,
            metadata: Some(marker.to_string()),
        },
    )?;
    ctx.db
        .message_batch()
        .message_batch_by_org()
        .filter(&org)
        .filter(|b| b.subject_query.as_deref() == Some(marker))
        .max_by_key(|b| b.id)
        .ok_or_else(|| format!("batch {marker} missing"))
}

fn batch(ctx: &ReducerContext, id: u64) -> Result<MessageBatch, String> {
    ctx.db
        .message_batch()
        .id()
        .find(&id)
        .ok_or_else(|| format!("batch {id} missing"))
}

fn children(ctx: &ReducerContext, batch_id: u64) -> Vec<OperationalMessage> {
    ctx.db
        .operational_message()
        .operational_message_by_batch()
        .filter(&batch_id)
        .collect()
}

fn is_active_intent(status: &OperationalMessageStatus) -> bool {
    matches!(
        status,
        OperationalMessageStatus::Draft
            | OperationalMessageStatus::Queued
            | OperationalMessageStatus::Copied
    )
}

fn approve(ctx: &ReducerContext, org: u64, batch_id: u64) -> Result<(), String> {
    review_message_batch(
        ctx,
        org,
        batch_id,
        ReviewMessageBatchParams {
            approved: true,
            reason: Some("pretenant certification".to_string()),
        },
    )
}

/// In-module cases run as one identity. If an approval is rejected for a reason other
/// than the invariant under test (e.g. a future independent-approval rule), the case can
/// no longer prove its invariant here and must move to the two-session Playwright layer.
fn approval_rejection_must_mention(
    result: &Result<(), String>,
    keywords: &[&str],
) -> Result<(), String> {
    if let Err(error) = result {
        let lower = error.to_lowercase();
        if !keywords.iter().any(|k| lower.contains(k)) {
            return Err(format!(
                "SETUP approval rejected for an unrelated reason ({error}); move this case to the two-session layer"
            ));
        }
    }
    Ok(())
}

pub(super) struct ProviderScenario {
    pub(super) org: u64,
    pub(super) company: u64,
    pub(super) contact_id: u64,
    pub(super) identity_id: u64,
    pub(super) account_id: u64,
    pub(super) conversation_id: u64,
    pub(super) thread: String,
    pub(super) tag: &'static str,
}

pub(super) fn provider_scenario(ctx: &ReducerContext, tag: &'static str) -> Result<ProviderScenario, String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let company = fixture.company_id;
    let contact_id = seed_contact(ctx, org, company, &format!("{tag} provider contact"))?;
    let identity_id = add_primary_phone(ctx, org, contact_id, "+12025550140")?;
    let account = ctx
        .db
        .whatsapp_business_account()
        .insert(WhatsAppBusinessAccount {
            id: 0,
            organization_id: org,
            company_id: Some(company),
            name: format!("{tag} provider"),
            phone_number: "+12025550100".to_string(),
            phone_number_id: format!("{tag}-phone-number-id"),
            business_account_id: format!("{tag}-business-account"),
            display_name: format!("{tag} provider"),
            credentials_reference: "vault://test/pretenant-credentials".to_string(),
            webhook_secret_reference: "vault://test/pretenant-webhook".to_string(),
            messaging_enabled: true,
            notifications_enabled: true,
            template_messaging_enabled: true,
            interactive_messaging_enabled: true,
            template_namespace: None,
            default_language: "en".to_string(),
            media_provider: Some("meta".to_string()),
            webhook_enabled: true,
            webhook_url: Some("https://example.test/pretenant-webhook".to_string()),
            subscribed_webhook_events: vec!["messages".to_string(), "message_status".to_string()],
            daily_message_limit: 1_000,
            messages_sent_today: 0,
            last_message_reset: None,
            verification_status: VerificationStatus::Approved,
            business_verification_level: VerificationLevel::BusinessVerified,
            quality_score: Some("GREEN".to_string()),
            quality_score_updated_at: Some(ctx.timestamp),
            status: IntegrationStatus::Active,
            sync_status: SyncStatus::Connected,
            last_health_check: Some(ctx.timestamp),
            last_error: None,
            error_count: 0,
            is_active: true,
            is_primary: true,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            deleted_at: None,
            created_by: Some(ctx.sender().to_hex().to_string()),
            metadata: Some(r#"{"test":"pretenant"}"#.to_string()),
        });
    ctx.db
        .crm_provider_principal()
        .insert(CrmProviderPrincipal {
            id: 0,
            organization_id: org,
            provider_account_id: account.id,
            executor_identity: ctx.sender(),
            is_active: true,
            registered_by: ctx.sender(),
            registered_at: ctx.timestamp,
            retired_at: None,
        });
    open_crm_conversation(
        ctx,
        org,
        OpenCrmConversationParams {
            contact_id,
            channel: MessageChannel::WhatsApp,
            phone_identity_id: Some(identity_id),
            external_thread_id: None,
            assigned_user_id: None,
            metadata: None,
        },
    )?;
    let thread = format!("{tag}-thread");
    let inbound_event = format!("{tag}-inbound-0");
    receive_crm_provider_message(
        ctx,
        org,
        ReceiveCrmProviderMessageParams {
            provider_account_id: account.id,
            event_fingerprint: fingerprint(&inbound_event),
            provider_event_id: inbound_event,
            contact_id,
            phone_identity_id: identity_id,
            external_thread_id: thread.clone(),
            provider_message_id: format!("{tag}-wamid-in-0"),
            body: format!("{tag} inbound"),
        },
    )?;
    let conversation_id = ctx
        .db
        .crm_conversation()
        .crm_conversation_by_contact()
        .filter(&contact_id)
        .find(|c| c.external_thread_id.as_deref() == Some(thread.as_str()))
        .map(|c| c.id)
        .ok_or("provider-bound conversation missing")?;
    Ok(ProviderScenario {
        org,
        company,
        contact_id,
        identity_id,
        account_id: account.id,
        conversation_id,
        thread,
        tag,
    })
}

/// Queue one outbound conversation message plus its operational intent.
pub(super) fn outbound(ctx: &ReducerContext, s: &ProviderScenario, label: &str) -> Result<(u64, u64), String> {
    let body = format!("{} outbound {label}", s.tag);
    append_crm_conversation_message(
        ctx,
        s.org,
        s.conversation_id,
        AppendCrmConversationMessageParams {
            direction: "outbound".to_string(),
            body: body.clone(),
            status: "queued".to_string(),
            provider_message_id: None,
            operational_message_id: None,
            metadata: None,
        },
    )?;
    let message_id = ctx
        .db
        .crm_conversation_message()
        .crm_conversation_message_by_conversation()
        .filter(&s.conversation_id)
        .filter(|m| m.direction == "outbound" && m.body == body)
        .map(|m| m.id)
        .max()
        .ok_or("outbound message missing")?;
    let operational = ctx.db.operational_message().insert(OperationalMessage {
        id: 0,
        organization_id: s.org,
        company_id: Some(s.company),
        message_batch_id: 0,
        template_id: 0,
        contact_id: s.contact_id,
        phone_identity_id: s.identity_id,
        channel: MessageChannel::WhatsApp,
        status: OperationalMessageStatus::Queued,
        subject_model: "contact".to_string(),
        subject_id: s.contact_id,
        rendered_subject: None,
        rendered_body: body,
        variable_hash: "pretenant".to_string(),
        copied_at: None,
        queued_at: Some(ctx.timestamp),
        sent_at: None,
        failed_at: None,
        failure_reason: None,
        created_at: ctx.timestamp,
        created_by: ctx.sender(),
        metadata: Some(r#"{"test":"pretenant"}"#.to_string()),
    });
    Ok((message_id, operational.id))
}

pub(super) fn deliver(
    ctx: &ReducerContext,
    s: &ProviderScenario,
    (message_id, operational_id): (u64, u64),
    event: &str,
    provider_message_id: &str,
    status: &str,
) -> Result<(), String> {
    record_crm_provider_delivery(
        ctx,
        s.org,
        RecordCrmProviderDeliveryParams {
            provider_account_id: s.account_id,
            event_fingerprint: fingerprint(event),
            conversation_id: s.conversation_id,
            conversation_message_id: message_id,
            provider_event_id: event.to_string(),
            provider_message_id: provider_message_id.to_string(),
            operational_message_id: operational_id,
            status: status.to_string(),
            failure_reason: (status == "failed").then(|| "provider rejected".to_string()),
        },
    )
}

pub(super) fn state(ctx: &ReducerContext, (message_id, operational_id): (u64, u64)) -> Result<(String, OperationalMessageStatus), String> {
    let message = ctx
        .db
        .crm_conversation_message()
        .id()
        .find(&message_id)
        .ok_or("conversation message missing")?;
    let operational = ctx
        .db
        .operational_message()
        .id()
        .find(&operational_id)
        .ok_or("operational message missing")?;
    Ok((message.status, operational.status))
}

fn require_state(
    ctx: &ReducerContext,
    ids: (u64, u64),
    expected: &str,
    expected_operational: OperationalMessageStatus,
    context: &str,
) -> Result<(), String> {
    let (status, operational) = state(ctx, ids)?;
    if status != expected || operational != expected_operational {
        return Err(format!(
            "{context}: expected {expected}/{expected_operational:?}, got {status}/{operational:?}"
        ));
    }
    Ok(())
}

pub(super) fn receipts(ctx: &ReducerContext, s: &ProviderScenario, event: &str) -> usize {
    ctx.db
        .crm_provider_event_receipt()
        .crm_provider_event_receipt_by_account()
        .filter(&s.account_id)
        .filter(|r| r.provider_event_id == event)
        .count()
}

// ── Cases ─────────────────────────────────────────────────────────────────────

/// Same event id with a different kind, or with a different payload, fails closed.
fn comm_01_event_id_reuse_fails_closed(ctx: &ReducerContext) -> Result<(), String> {
    let s = setup("provider scenario", provider_scenario(ctx, "comm01"))?;
    let ids = setup("outbound", outbound(ctx, &s, "a"))?;
    let inbound_event = "comm01-inbound-0";
    if deliver(ctx, &s, ids, inbound_event, "comm01-wamid-out", "delivered").is_ok() {
        return Err("delivery callback reused an inbound provider event id".to_string());
    }
    if receipts(ctx, &s, inbound_event) != 1 {
        return Err("event id reuse changed the receipt ledger".to_string());
    }
    require_state(ctx, ids, "queued", OperationalMessageStatus::Queued, "after kind conflict")?;

    deliver(ctx, &s, ids, "comm01-delivered", "comm01-wamid-out", "delivered")?;
    let conflicting = record_crm_provider_delivery(
        ctx,
        s.org,
        RecordCrmProviderDeliveryParams {
            provider_account_id: s.account_id,
            event_fingerprint: fingerprint("comm01-delivered-tampered"),
            conversation_id: s.conversation_id,
            conversation_message_id: ids.0,
            provider_event_id: "comm01-delivered".to_string(),
            provider_message_id: "comm01-wamid-out".to_string(),
            operational_message_id: ids.1,
            status: "failed".to_string(),
            failure_reason: Some("tampered replay".to_string()),
        },
    );
    if conflicting.is_ok() {
        return Err("conflicting delivery replay was accepted".to_string());
    }
    if receipts(ctx, &s, "comm01-delivered") != 1 {
        return Err("conflicting replay changed the receipt ledger".to_string());
    }
    require_state(ctx, ids, "delivered", OperationalMessageStatus::Delivered, "after conflicting replay")
}

/// A second `delivered` callback with a new event id records its receipt but creates
/// no additional timeline or intent state.
fn comm_02_duplicate_delivered_callback_single_effect(ctx: &ReducerContext) -> Result<(), String> {
    let s = setup("provider scenario", provider_scenario(ctx, "comm02"))?;
    let ids = setup("outbound", outbound(ctx, &s, "a"))?;
    deliver(ctx, &s, ids, "comm02-d1", "comm02-wamid", "delivered")?;
    deliver(ctx, &s, ids, "comm02-d1", "comm02-wamid", "delivered")?;
    deliver(ctx, &s, ids, "comm02-d2", "comm02-wamid", "delivered")?;
    if receipts(ctx, &s, "comm02-d1") != 1 || receipts(ctx, &s, "comm02-d2") != 1 {
        return Err("expected exactly one receipt per provider event".to_string());
    }
    let timeline = ctx
        .db
        .crm_conversation_message()
        .crm_conversation_message_by_conversation()
        .filter(&s.conversation_id)
        .count();
    if timeline != 2 {
        return Err(format!("duplicate callbacks changed timeline size to {timeline}"));
    }
    let operational_rows = ctx
        .db
        .operational_message()
        .operational_message_by_subject()
        .filter((&s.org, &"contact".to_string(), &s.contact_id))
        .count();
    if operational_rows != 1 {
        return Err(format!("duplicate callbacks produced {operational_rows} intents"));
    }
    require_state(ctx, ids, "delivered", OperationalMessageStatus::Delivered, "after duplicates")
}

/// A provider message id belongs to exactly one conversation message.
fn comm_03_provider_message_id_ownership_is_unique(ctx: &ReducerContext) -> Result<(), String> {
    let s = setup("provider scenario", provider_scenario(ctx, "comm03"))?;
    let first = setup("outbound a", outbound(ctx, &s, "a"))?;
    let second = setup("outbound b", outbound(ctx, &s, "b"))?;
    deliver(ctx, &s, first, "comm03-first", "comm03-shared-wamid", "sent")?;
    if deliver(ctx, &s, second, "comm03-second", "comm03-shared-wamid", "sent").is_ok() {
        return Err("provider message id was linked to a second outbound message".to_string());
    }
    if receipts(ctx, &s, "comm03-second") != 0 {
        return Err("rejected ownership conflict persisted a receipt".to_string());
    }
    require_state(ctx, second, "queued", OperationalMessageStatus::Queued, "second message")?;
    let inbound_collision = receive_crm_provider_message(
        ctx,
        s.org,
        ReceiveCrmProviderMessageParams {
            provider_account_id: s.account_id,
            provider_event_id: "comm03-inbound-collision".to_string(),
            event_fingerprint: fingerprint("comm03-inbound-collision"),
            contact_id: s.contact_id,
            phone_identity_id: s.identity_id,
            external_thread_id: s.thread.clone(),
            provider_message_id: "comm03-shared-wamid".to_string(),
            body: "collision".to_string(),
        },
    );
    if inbound_collision.is_ok() {
        return Err("inbound callback reused an outbound provider message id".to_string());
    }
    Ok(())
}

/// Canonical monotonic rule: queued < sent < delivered; failed is terminal and only
/// reachable from queued/sent. Later callbacks may never lower that rank.
fn comm_04_out_of_order_callbacks_never_regress(ctx: &ReducerContext) -> Result<(), String> {
    let s = setup("provider scenario", provider_scenario(ctx, "comm04"))?;

    let delivered_first = setup("outbound a", outbound(ctx, &s, "a"))?;
    deliver(ctx, &s, delivered_first, "comm04-a-delivered", "comm04-wamid-a", "delivered")?;
    let _ = deliver(ctx, &s, delivered_first, "comm04-a-sent", "comm04-wamid-a", "sent");
    let _ = deliver(ctx, &s, delivered_first, "comm04-a-failed", "comm04-wamid-a", "failed");
    require_state(ctx, delivered_first, "delivered", OperationalMessageStatus::Delivered, "sent/failed after delivered")?;

    let failed_first = setup("outbound b", outbound(ctx, &s, "b"))?;
    deliver(ctx, &s, failed_first, "comm04-b-failed", "comm04-wamid-b", "failed")?;
    let _ = deliver(ctx, &s, failed_first, "comm04-b-delivered", "comm04-wamid-b", "delivered");
    let _ = deliver(ctx, &s, failed_first, "comm04-b-sent", "comm04-wamid-b", "sent");
    require_state(ctx, failed_first, "failed", OperationalMessageStatus::Failed, "delivered/sent after failed")?;

    let duplicate_sent = setup("outbound c", outbound(ctx, &s, "c"))?;
    deliver(ctx, &s, duplicate_sent, "comm04-c-sent-1", "comm04-wamid-c", "sent")?;
    deliver(ctx, &s, duplicate_sent, "comm04-c-sent-2", "comm04-wamid-c", "sent")?;
    require_state(ctx, duplicate_sent, "sent", OperationalMessageStatus::Sent, "duplicate sent")?;

    let skipped_sent = setup("outbound d", outbound(ctx, &s, "d"))?;
    deliver(ctx, &s, skipped_sent, "comm04-d-delivered", "comm04-wamid-d", "delivered")?;
    require_state(ctx, skipped_sent, "delivered", OperationalMessageStatus::Delivered, "delivered before sent")?;
    let sent_at = ctx
        .db
        .operational_message()
        .id()
        .find(&skipped_sent.1)
        .and_then(|m| m.sent_at);
    if sent_at.is_none() {
        return Err("delivered-before-sent did not record sent_at".to_string());
    }
    Ok(())
}

/// A stale but authentic callback is acknowledged (receipt recorded, no state change),
/// so the provider stops retrying.
fn comm_05_stale_callback_is_absorbed(ctx: &ReducerContext) -> Result<(), String> {
    let s = setup("provider scenario", provider_scenario(ctx, "comm05"))?;
    let ids = setup("outbound", outbound(ctx, &s, "a"))?;
    setup(
        "delivered callback",
        deliver(ctx, &s, ids, "comm05-delivered", "comm05-wamid", "delivered"),
    )?;
    deliver(ctx, &s, ids, "comm05-stale-sent", "comm05-wamid", "sent")
        .map_err(|error| format!("stale sent callback was rejected: {error}"))?;
    if receipts(ctx, &s, "comm05-stale-sent") != 1 {
        return Err("absorbed stale callback did not record its receipt".to_string());
    }
    require_state(ctx, ids, "delivered", OperationalMessageStatus::Delivered, "after stale callback")
}

struct BatchScenario {
    org: u64,
    company: u64,
    contact_id: u64,
    identity_id: u64,
    batch_id: u64,
}

fn batch_scenario(ctx: &ReducerContext, tag: &str, phone: &str) -> Result<BatchScenario, String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let company = fixture.company_id;
    let contact_id = seed_contact(ctx, org, company, &format!("{tag} recipient"))?;
    let identity_id = add_primary_phone(ctx, org, contact_id, phone)?;
    let template_id = seed_template(ctx, org, &format!("{tag}-template"))?;
    let created = seed_contact_batch(ctx, org, company, template_id, vec![contact_id], tag)?;
    if created.recipient_count != 1 || children(ctx, created.id).len() != 1 {
        return Err("expected one previewed recipient".to_string());
    }
    Ok(BatchScenario {
        org,
        company,
        contact_id,
        identity_id,
        batch_id: created.id,
    })
}

/// Preview authorization is not a lease: opting out after preview must remove the
/// recipient (or block approval) at the approval/dispatch boundary.
fn comm_06_consent_revalidated_at_approval(ctx: &ReducerContext) -> Result<(), String> {
    let s = setup("batch scenario", batch_scenario(ctx, "comm06", "+12025550161"))?;
    setup(
        "opt out",
        set_contact_communication_preference(
            ctx,
            s.org,
            Some(s.company),
            s.contact_id,
            MessageChannel::Sms,
            false,
        ),
    )?;
    let approval = approve(ctx, s.org, s.batch_id);
    approval_rejection_must_mention(&approval, &["consent", "opt", "recipient"])?;
    let approved = batch(ctx, s.batch_id)?.status == MessageBatchStatus::Approved;
    let still_targeted = children(ctx, s.batch_id)
        .iter()
        .any(|m| m.contact_id == s.contact_id && is_active_intent(&m.status));
    if approved && still_targeted {
        return Err("approved batch still targets a contact who opted out after preview".to_string());
    }
    Ok(())
}

/// Policy: the recipient identity is an immutable snapshot. If it is archived or replaced
/// before approval, approval fails closed and a new batch (re-resolution) must be approved.
fn comm_07_recipient_identity_revalidated_at_approval(ctx: &ReducerContext) -> Result<(), String> {
    let s = setup("batch scenario", batch_scenario(ctx, "comm07", "+12025550171"))?;
    setup("archive phone A", archive_contact_identity(ctx, s.org, s.identity_id))?;
    setup(
        "add phone B",
        add_primary_phone(ctx, s.org, s.contact_id, "+12025550172"),
    )?;
    let approval = approve(ctx, s.org, s.batch_id);
    approval_rejection_must_mention(&approval, &["identity", "recipient", "phone", "archived"])?;
    let approved = batch(ctx, s.batch_id)?.status == MessageBatchStatus::Approved;
    let stale_recipient = children(ctx, s.batch_id)
        .iter()
        .any(|m| m.phone_identity_id == s.identity_id && is_active_intent(&m.status));
    if approved && stale_recipient {
        return Err("approved batch still targets an archived phone identity".to_string());
    }
    Ok(())
}

/// Editing a template never changes already rendered (previewed/approved) messages.
fn comm_08_rendered_content_immutable_after_template_edit(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = setup("fixture", OrgFixture::seed_minimal(ctx))?;
    let org = fixture.organization_id;
    setup(
        "partner phone",
        add_primary_phone(ctx, org, fixture.partner_id, "+12025550181"),
    )?;
    let invoice_id = setup(
        "posted invoice",
        create_balanced_customer_invoice(ctx, &fixture, 125.5, true),
    )?;
    let template_id = setup("template", seed_template(ctx, org, "comm08-template"))?;
    setup(
        "reminder batch",
        create_invoice_reminder_batch(
            ctx,
            org,
            CreateInvoiceReminderBatchParams {
                company_id: Some(fixture.company_id),
                template_id,
                channel: MessageChannel::Sms,
                invoice_ids: vec![invoice_id],
                metadata: Some("comm08".to_string()),
            },
        ),
    )?;
    let reminder = ctx
        .db
        .message_batch()
        .message_batch_by_org()
        .filter(&org)
        .find(|b| b.template_id == template_id)
        .ok_or("SETUP reminder batch missing")?;
    if reminder.recipient_count != 1 {
        return Err(format!(
            "SETUP expected one reminder recipient, got {} (excluded {})",
            reminder.recipient_count, reminder.excluded_count
        ));
    }
    let snapshot = |rows: Vec<OperationalMessage>| {
        rows.into_iter()
            .map(|m| (m.id, m.template_id, m.rendered_subject, m.rendered_body, m.variable_hash))
            .collect::<Vec<_>>()
    };
    let before = snapshot(children(ctx, reminder.id));
    let _ = approve(ctx, org, reminder.id);
    setup(
        "template edit",
        update_message_template(
            ctx,
            org,
            template_id,
            UpdateMessageTemplateParams {
                name: None,
                subject: Some("CHANGED subject".to_string()),
                body_template: Some("CHANGED {{customer_name}}".to_string()),
                allowed_variables: None,
                applicable_channels: None,
                active: None,
                review_state: None,
                metadata: None,
            },
        ),
    )?;
    let after = snapshot(children(ctx, reminder.id));
    if before != after {
        return Err("template edit changed previously rendered message content".to_string());
    }
    if after.iter().any(|(_, _, subject, body, _)| {
        body.contains("CHANGED") || subject.as_deref().is_some_and(|s| s.contains("CHANGED"))
    }) {
        return Err("rendered message picked up edited template content".to_string());
    }
    Ok(())
}

/// Approval must bind to concrete rendered content, not to a mutable template reference.
fn comm_09_contact_batch_approves_rendered_content(ctx: &ReducerContext) -> Result<(), String> {
    let s = setup("batch scenario", batch_scenario(ctx, "comm09", "+12025550191"))?;
    let unrendered = children(ctx, s.batch_id)
        .iter()
        .filter(|m| m.rendered_body.trim().is_empty())
        .count();
    if unrendered > 0 {
        return Err(format!(
            "{unrendered} batch recipient(s) have no rendered content to approve"
        ));
    }
    Ok(())
}

/// After A is merged into B, a provider event keeps using the same conversation; an event
/// still addressed to A fails closed rather than opening a split timeline.
fn comm_10_merge_keeps_one_traceable_timeline(ctx: &ReducerContext) -> Result<(), String> {
    let s = setup("provider scenario", provider_scenario(ctx, "comm10"))?;
    let target = setup(
        "merge target",
        seed_contact(ctx, s.org, s.company, "comm10 merge target"),
    )?;
    setup(
        "merge",
        merge_contacts(
            ctx,
            s.org,
            s.company,
            s.contact_id,
            MergeContactsParams {
                target_contact_id: target,
            },
        ),
    )?;
    let event = |id: &str, contact_id: u64| ReceiveCrmProviderMessageParams {
        provider_account_id: s.account_id,
        provider_event_id: id.to_string(),
        event_fingerprint: fingerprint(id),
        contact_id,
        phone_identity_id: s.identity_id,
        external_thread_id: s.thread.clone(),
        provider_message_id: format!("{id}-wamid"),
        body: format!("{id} body"),
    };
    if receive_crm_provider_message(ctx, s.org, event("comm10-stale-source", s.contact_id)).is_ok() {
        return Err("provider event addressed to the merged source contact was accepted".to_string());
    }
    if receipts(ctx, &s, "comm10-stale-source") != 0 {
        return Err("rejected stale-contact event persisted a receipt".to_string());
    }
    receive_crm_provider_message(ctx, s.org, event("comm10-after-merge", target))
        .map_err(|error| format!("event for merge target on existing thread was rejected: {error}"))?;
    let threads: Vec<_> = ctx
        .db
        .crm_conversation()
        .crm_conversation_by_org()
        .filter(&s.org)
        .filter(|c| c.external_thread_id.as_deref() == Some(s.thread.as_str()))
        .collect();
    if threads.len() != 1 || threads[0].id != s.conversation_id || threads[0].contact_id != target {
        return Err(format!(
            "merge split or lost the provider timeline: {} conversation(s)",
            threads.len()
        ));
    }
    let inbound = ctx
        .db
        .crm_conversation_message()
        .crm_conversation_message_by_conversation()
        .filter(&s.conversation_id)
        .filter(|m| m.direction == "inbound")
        .count();
    if inbound != 2 {
        return Err(format!("expected 2 inbound messages on merged timeline, got {inbound}"));
    }
    let receipt_conversation = ctx
        .db
        .crm_provider_event_receipt()
        .crm_provider_event_receipt_by_account()
        .filter(&s.account_id)
        .find(|r| r.provider_event_id == "comm10-after-merge")
        .map(|r| r.conversation_id);
    if receipt_conversation != Some(s.conversation_id) {
        return Err("post-merge receipt is not linked to the original conversation".to_string());
    }
    Ok(())
}

/// Two-person rule for bulk outbound communication. The positive approver path and
/// approval retry are proven with two sessions in Playwright (COMM-11-E2E).
fn comm_11_creator_cannot_approve_own_batch(ctx: &ReducerContext) -> Result<(), String> {
    let s = setup("batch scenario", batch_scenario(ctx, "comm11", "+12025550111"))?;
    if approve(ctx, s.org, s.batch_id).is_ok() {
        return Err("batch creator approved their own batch".to_string());
    }
    if batch(ctx, s.batch_id)?.status != MessageBatchStatus::PendingApproval {
        return Err("rejected self-approval mutated batch status".to_string());
    }
    Ok(())
}

fn comm_12_batch_and_consent_mutations_are_org_scoped(ctx: &ReducerContext) -> Result<(), String> {
    let s = setup("batch scenario", batch_scenario(ctx, "comm12", "+12025550121"))?;
    let foreign = setup("foreign fixture", OrgFixture::seed_minimal(ctx))?;
    let foreign_org = foreign.organization_id;
    if approve(ctx, foreign_org, s.batch_id).is_ok() {
        return Err("foreign organization approved the batch".to_string());
    }
    if cancel_message_batch(ctx, foreign_org, s.batch_id).is_ok() {
        return Err("foreign organization cancelled the batch".to_string());
    }
    if batch(ctx, s.batch_id)?.status != MessageBatchStatus::PendingApproval {
        return Err("foreign mutation changed batch status".to_string());
    }
    if set_contact_communication_preference(
        ctx,
        foreign_org,
        Some(foreign.company_id),
        s.contact_id,
        MessageChannel::Sms,
        false,
    )
    .is_ok()
    {
        return Err("foreign organization changed a contact's consent".to_string());
    }
    if ctx
        .db
        .contact_communication_preference()
        .preference_by_contact()
        .filter(&s.contact_id)
        .count()
        != 0
    {
        return Err("foreign consent mutation persisted a preference".to_string());
    }
    Ok(())
}

/// A batch or message in organization B must never target organization A's contacts or
/// phone identities.
fn comm_13_batch_recipients_are_org_scoped(ctx: &ReducerContext) -> Result<(), String> {
    let s = setup("batch scenario", batch_scenario(ctx, "comm13", "+12025550131"))?;
    let foreign = setup("foreign fixture", OrgFixture::seed_minimal(ctx))?;
    let foreign_org = foreign.organization_id;
    let template_id = setup("foreign template", seed_template(ctx, foreign_org, "comm13-foreign"))?;
    let result = create_message_batch(
        ctx,
        foreign_org,
        CreateMessageBatchParams {
            company_id: Some(foreign.company_id),
            template_id,
            channel: MessageChannel::Sms,
            subject_model: "contact".to_string(),
            subject_query: Some("comm13-foreign".to_string()),
            candidate_contact_ids: vec![s.contact_id],
            metadata: None,
        },
    );
    let leaked = ctx
        .db
        .operational_message()
        .operational_message_by_org()
        .filter(&foreign_org)
        .filter(|m| m.contact_id == s.contact_id || m.phone_identity_id == s.identity_id)
        .count();
    if leaked > 0 {
        return Err(format!(
            "organization B created {leaked} message intent(s) for organization A's contact (batch result: {result:?})"
        ));
    }
    Ok(())
}

/// The recipient snapshot is by identity id; changing the number under that id must not
/// silently redirect a previewed message.
fn comm_14_recipient_number_change_invalidates_approval(ctx: &ReducerContext) -> Result<(), String> {
    let previewed = "+12025550141";
    let s = setup("batch scenario", batch_scenario(ctx, "comm14", previewed))?;
    setup(
        "change number",
        update_contact_identity(
            ctx,
            s.org,
            s.identity_id,
            UpdateContactIdentityParams {
                company_id: None,
                raw_value: Some("+12025550142".to_string()),
                is_preferred: None,
                verification_state: None,
                metadata: None,
            },
        ),
    )?;
    let approval = approve(ctx, s.org, s.batch_id);
    approval_rejection_must_mention(&approval, &["identity", "recipient", "phone", "number", "changed"])?;
    let approved = batch(ctx, s.batch_id)?.status == MessageBatchStatus::Approved;
    let current = ctx
        .db
        .contact_phone_identity()
        .id()
        .find(&s.identity_id)
        .map(|identity| identity.normalized_e164);
    let targeted = children(ctx, s.batch_id)
        .iter()
        .any(|m| m.phone_identity_id == s.identity_id && is_active_intent(&m.status));
    if approved && targeted && current.as_deref() != Some(previewed) {
        return Err(format!(
            "approved batch now resolves to {current:?} instead of the previewed {previewed}"
        ));
    }
    Ok(())
}
