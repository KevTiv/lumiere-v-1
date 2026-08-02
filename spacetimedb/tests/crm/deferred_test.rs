/// Deferred CRM foundations — lead scoring, dynamic segments, relationship intel, inbox.
use spacetimedb::{ReducerContext, Table};

use crate::core::operational_messaging::{operational_message, OperationalMessage};
use crate::crm::contact_identities::{contact_phone_identity, ContactPhoneIdentity};
use crate::crm::contacts::{
    contact, create_contact, create_contact_relationship, CreateContactParams,
    CreateContactRelationshipParams,
};
use crate::crm::inbox::{
    append_crm_conversation_message, crm_conversation, crm_conversation_message,
    crm_provider_event_receipt, crm_provider_principal, open_crm_conversation,
    receive_crm_provider_message, record_crm_provider_delivery, update_crm_conversation,
    AppendCrmConversationMessageParams, CrmProviderPrincipal, OpenCrmConversationParams,
    ReceiveCrmProviderMessageParams, RecordCrmProviderDeliveryParams, UpdateCrmConversationParams,
};
use crate::crm::lead_scoring::{lead_score, lead_score_factor, recompute_lead_score};
use crate::crm::leads::{create_lead, lead, CreateLeadParams};
use crate::crm::relationship_intel::{
    contact_relationship_insight, recompute_relationship_insights,
};
use crate::crm::segments::{
    contact_segment, contact_segment_rule, create_contact_segment, evaluate_dynamic_segment,
    segment_member, set_contact_segment_rules, CreateContactSegmentParams, SegmentRuleClause,
    SegmentRuleField, SegmentRuleOp, SetContactSegmentRulesParams,
};
use crate::integrations::whatsapp_business::{
    whatsapp_business_account, VerificationLevel, VerificationStatus, WhatsAppBusinessAccount,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{
    ContactIdentityKind, ContactVerificationState, IntegrationStatus, MessageChannel,
    OperationalMessageStatus, SyncStatus,
};

fn base_contact_params(
    name: &str,
    company_id: u64,
    country: &str,
    is_customer: bool,
) -> CreateContactParams {
    CreateContactParams {
        name: name.to_string(),
        type_: "contact".to_string(),
        email: Some(format!(
            "{}@example.test",
            name.to_lowercase().replace(' ', "-")
        )),
        phone: None,
        mobile: None,
        company_id: Some(company_id),
        is_customer,
        is_vendor: false,
        is_employee: false,
        is_prospect: !is_customer,
        is_partner: false,
        customer_rank: if is_customer { 1 } else { 0 },
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
        city: Some("Sydney".to_string()),
        state_code: None,
        zip: None,
        country_code: Some(country.to_string()),
        tax_id: None,
        company_registry: None,
        industry: Some("Software".to_string()),
        employees_count: None,
        annual_revenue: None,
        description: None,
        salesperson_id: None,
        assigned_user_id: None,
        parent_id: None,
        user_id: None,
        color: None,
        metadata: Some(r#"{"test":"deferred"}"#.to_string()),
    }
}

pub fn test_lead_score_explainable_factors(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;

    create_lead(
        ctx,
        org_id,
        CreateLeadParams {
            name: "Score Lead".to_string(),
            priority: "high".to_string(),
            state: "qualified".to_string(),
            expected_revenue: 25_000.0,
            probability: 40.0,
            tag_ids: vec![],
            email: Some("score@example.test".to_string()),
            phone: Some("+61400000000".to_string()),
            mobile: None,
            company_name: Some("Acme Score Co".to_string()),
            contact_name: Some("Ada".to_string()),
            title: None,
            street: None,
            city: None,
            zip: None,
            country_code: Some("AU".to_string()),
            website: Some("https://example.test".to_string()),
            industry: Some("Software".to_string()),
            source_id: None,
            campaign_id: None,
            medium_id: None,
            referred_by: None,
            description: None,
            user_id: None,
            team_id: None,
            partner_id: None,
            date_deadline: None,
            metadata: Some(r#"{"test":"score"}"#.to_string()),
        },
    )?;

    let lead_id = ctx
        .db
        .lead()
        .iter()
        .find(|l| l.organization_id == org_id && l.name == "Score Lead")
        .map(|l| l.id)
        .ok_or("lead missing after create")?;

    recompute_lead_score(ctx, org_id, lead_id)?;

    let score = ctx
        .db
        .lead_score()
        .lead_score_by_lead()
        .filter(&lead_id)
        .next()
        .ok_or("lead score missing")?;
    if score.total_score <= 0 {
        return Err(format!(
            "expected positive score, got {}",
            score.total_score
        ));
    }

    let factors: Vec<_> = ctx
        .db
        .lead_score_factor()
        .lead_score_factor_by_lead()
        .filter(&lead_id)
        .collect();
    if factors.is_empty() {
        return Err("expected explainable factors".to_string());
    }
    let factor_sum: i32 = factors.iter().map(|f| f.points).sum();
    if factor_sum != score.total_score {
        return Err(format!(
            "factor sum {factor_sum} != total_score {}",
            score.total_score
        ));
    }
    if !factors.iter().any(|f| f.factor_key == "has_email") {
        return Err("missing has_email factor".to_string());
    }
    if !factors.iter().any(|f| f.factor_key == "state_qualified") {
        return Err("missing state_qualified factor".to_string());
    }

    Ok(())
}

pub fn test_dynamic_segment_rule_ast(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    create_contact(
        ctx,
        org_id,
        base_contact_params("AU Customer", company_id, "AU", true),
    )?;
    create_contact(
        ctx,
        org_id,
        base_contact_params("NZ Prospect", company_id, "NZ", false),
    )?;

    create_contact_segment(
        ctx,
        org_id,
        CreateContactSegmentParams {
            name: "AU Customers Dyn".to_string(),
            is_dynamic: true,
            is_active: true,
            description: None,
            domain: None,
            color: None,
            parent_id: None,
            metadata: None,
        },
    )?;

    let segment_id = ctx
        .db
        .contact_segment()
        .iter()
        .find(|s| s.organization_id == org_id && s.name == "AU Customers Dyn")
        .map(|s| s.id)
        .ok_or("segment missing")?;

    set_contact_segment_rules(
        ctx,
        org_id,
        segment_id,
        SetContactSegmentRulesParams {
            replace_all: true,
            rules: vec![
                SegmentRuleClause {
                    field: SegmentRuleField::CountryCode,
                    op: SegmentRuleOp::Eq,
                    value_text: Some("AU".to_string()),
                    value_id: None,
                },
                SegmentRuleClause {
                    field: SegmentRuleField::IsCustomer,
                    op: SegmentRuleOp::IsTrue,
                    value_text: None,
                    value_id: None,
                },
            ],
            metadata: None,
        },
    )?;

    let rule_count = ctx
        .db
        .contact_segment_rule()
        .segment_rule_by_segment()
        .filter(&segment_id)
        .count();
    if rule_count != 2 {
        return Err(format!("expected 2 rules, got {rule_count}"));
    }

    evaluate_dynamic_segment(ctx, org_id, segment_id)?;

    let members: Vec<_> = ctx
        .db
        .segment_member()
        .iter()
        .filter(|m| m.segment_id == segment_id && m.is_active)
        .collect();
    if members.len() != 1 {
        return Err(format!("expected 1 active member, got {}", members.len()));
    }

    let member_contact = ctx
        .db
        .contact()
        .id()
        .find(&members[0].contact_id)
        .ok_or("member contact missing")?;
    if member_contact.country_code.as_deref() != Some("AU") || !member_contact.is_customer {
        return Err("wrong contact matched dynamic segment".to_string());
    }

    Ok(())
}

pub fn test_relationship_insights(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    create_contact(
        ctx,
        org_id,
        base_contact_params("Rel Left", company_id, "AU", true),
    )?;
    create_contact(
        ctx,
        org_id,
        base_contact_params("Rel Right", company_id, "AU", true),
    )?;

    let left_id = ctx
        .db
        .contact()
        .iter()
        .find(|c| c.organization_id == org_id && c.name == "Rel Left")
        .map(|c| c.id)
        .ok_or("left missing")?;
    let right_id = ctx
        .db
        .contact()
        .iter()
        .find(|c| c.organization_id == org_id && c.name == "Rel Right")
        .map(|c| c.id)
        .ok_or("right missing")?;

    create_contact_relationship(
        ctx,
        org_id,
        CreateContactRelationshipParams {
            left_contact_id: left_id,
            right_contact_id: right_id,
            relationship_type: "partner".to_string(),
            start_date: None,
            notes: None,
            metadata: None,
        },
    )?;

    recompute_relationship_insights(ctx, org_id, left_id)?;

    let insight = ctx
        .db
        .contact_relationship_insight()
        .rel_insight_by_contact()
        .filter(&left_id)
        .next()
        .ok_or("insight missing")?;
    if insight.active_relationship_count < 1 {
        return Err("expected at least one relationship in insight".to_string());
    }
    if insight.strength_score <= 0 {
        return Err("expected positive strength score".to_string());
    }
    if !insight.related_contact_ids.contains(&right_id) {
        return Err("related contact id missing from insight".to_string());
    }

    Ok(())
}

pub fn test_crm_whatsapp_inbox(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    create_contact(
        ctx,
        org_id,
        base_contact_params("Inbox Contact", company_id, "AU", true),
    )?;
    let contact_id = ctx
        .db
        .contact()
        .iter()
        .find(|c| c.organization_id == org_id && c.name == "Inbox Contact")
        .map(|c| c.id)
        .ok_or("inbox contact missing")?;

    let identity = ctx
        .db
        .contact_phone_identity()
        .insert(ContactPhoneIdentity {
            id: 0,
            organization_id: org_id,
            company_id: Some(company_id),
            contact_id,
            kind: ContactIdentityKind::WhatsApp,
            normalized_e164: "+61412345678".to_string(),
            display_masked: "+614****678".to_string(),
            verification_state: ContactVerificationState::Verified,
            is_preferred: true,
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            verified_at: Some(ctx.timestamp),
            archived_at: None,
            metadata: Some(r#"{"test":"inbox-identity"}"#.to_string()),
        });

    let wrong_company_identity = ctx
        .db
        .contact_phone_identity()
        .insert(ContactPhoneIdentity {
            id: 0,
            company_id: None,
            normalized_e164: "+61412345679".to_string(),
            display_masked: "+614****679".to_string(),
            is_preferred: false,
            metadata: Some(r#"{"test":"wrong-company"}"#.to_string()),
            ..identity.clone()
        });

    let mismatched_identity_result = open_crm_conversation(
        ctx,
        org_id,
        OpenCrmConversationParams {
            contact_id,
            channel: MessageChannel::WhatsApp,
            phone_identity_id: Some(wrong_company_identity.id),
            external_thread_id: Some("wa-thread-wrong-company".to_string()),
            assigned_user_id: None,
            metadata: None,
        },
    );
    if mismatched_identity_result.is_ok() {
        return Err("company-mismatched phone identity was accepted".to_string());
    }

    if open_crm_conversation(
        ctx,
        org_id,
        OpenCrmConversationParams {
            contact_id,
            channel: MessageChannel::WhatsApp,
            phone_identity_id: None,
            external_thread_id: None,
            assigned_user_id: None,
            metadata: None,
        },
    )
    .is_ok()
    {
        return Err("conversation without a phone identity was accepted".to_string());
    }

    if open_crm_conversation(
        ctx,
        org_id,
        OpenCrmConversationParams {
            contact_id,
            channel: MessageChannel::WhatsApp,
            phone_identity_id: Some(identity.id),
            external_thread_id: Some("forged-provider-thread".to_string()),
            assigned_user_id: None,
            metadata: None,
        },
    )
    .is_ok()
    {
        return Err("caller-controlled external thread id was accepted".to_string());
    }

    open_crm_conversation(
        ctx,
        org_id,
        OpenCrmConversationParams {
            contact_id,
            channel: MessageChannel::WhatsApp,
            phone_identity_id: Some(identity.id),
            external_thread_id: None,
            assigned_user_id: None,
            metadata: None,
        },
    )?;

    // Exact ordinary-user retries reuse the existing row.
    open_crm_conversation(
        ctx,
        org_id,
        OpenCrmConversationParams {
            contact_id,
            channel: MessageChannel::WhatsApp,
            phone_identity_id: Some(identity.id),
            external_thread_id: None,
            assigned_user_id: None,
            metadata: Some(r#"{"retry":true}"#.to_string()),
        },
    )?;

    let conversation_id = ctx
        .db
        .crm_conversation()
        .crm_conversation_by_contact()
        .filter(&contact_id)
        .find(|c| c.status == "open")
        .map(|c| c.id)
        .ok_or("conversation missing")?;

    let conversation_count = ctx
        .db
        .crm_conversation()
        .crm_conversation_by_contact()
        .filter(&contact_id)
        .filter(|conversation| conversation.status == "open")
        .count();
    if conversation_count != 1 {
        return Err(format!(
            "expected exact retry to reuse one conversation, got {conversation_count}"
        ));
    }

    if update_crm_conversation(
        ctx,
        org_id,
        conversation_id,
        UpdateCrmConversationParams {
            status: None,
            assigned_user_id: None,
            external_thread_id: Some("forged-provider-thread-update".to_string()),
            metadata: None,
        },
    )
    .is_ok()
    {
        return Err("caller-controlled external thread update was accepted".to_string());
    }

    for (direction, status, provider_message_id) in [
        ("inbound", "received", None),
        ("outbound", "delivered", None),
        ("outbound", "queued", Some("provider-forgery")),
    ] {
        let result = append_crm_conversation_message(
            ctx,
            org_id,
            conversation_id,
            AppendCrmConversationMessageParams {
                direction: direction.to_string(),
                body: "forged provider state".to_string(),
                status: status.to_string(),
                provider_message_id: provider_message_id.map(str::to_string),
                operational_message_id: None,
                metadata: None,
            },
        );
        if result.is_ok() {
            return Err(format!(
                "provider-owned state was accepted: {direction}/{status}"
            ));
        }
    }

    let mismatched_operational = ctx.db.operational_message().insert(OperationalMessage {
        id: 0,
        organization_id: org_id,
        company_id: Some(company_id),
        message_batch_id: 0,
        template_id: 0,
        contact_id: fixture.partner_id,
        phone_identity_id: identity.id,
        channel: MessageChannel::WhatsApp,
        status: OperationalMessageStatus::Queued,
        subject_model: "contact".to_string(),
        subject_id: fixture.partner_id,
        rendered_subject: None,
        rendered_body: "wrong recipient".to_string(),
        variable_hash: "inbox-test".to_string(),
        copied_at: None,
        queued_at: Some(ctx.timestamp),
        sent_at: None,
        failed_at: None,
        failure_reason: None,
        created_at: ctx.timestamp,
        created_by: ctx.sender(),
        metadata: Some(r#"{"test":"mismatched-operational"}"#.to_string()),
    });
    let linked_result = append_crm_conversation_message(
        ctx,
        org_id,
        conversation_id,
        AppendCrmConversationMessageParams {
            direction: "outbound".to_string(),
            body: "forged operational linkage".to_string(),
            status: "queued".to_string(),
            provider_message_id: None,
            operational_message_id: Some(mismatched_operational.id),
            metadata: None,
        },
    );
    if linked_result.is_ok() {
        return Err("mismatched operational message linkage was accepted".to_string());
    }

    if ctx
        .db
        .crm_conversation_message()
        .crm_conversation_message_by_conversation()
        .filter(&conversation_id)
        .count()
        != 0
    {
        return Err("failed append persisted a conversation message".to_string());
    }

    append_crm_conversation_message(
        ctx,
        org_id,
        conversation_id,
        AppendCrmConversationMessageParams {
            direction: "outbound".to_string(),
            body: "Hello from CRM inbox".to_string(),
            status: "queued".to_string(),
            provider_message_id: None,
            operational_message_id: None,
            metadata: None,
        },
    )?;

    let messages: Vec<_> = ctx
        .db
        .crm_conversation_message()
        .crm_conversation_message_by_conversation()
        .filter(&conversation_id)
        .collect();
    if messages.len() != 1 {
        return Err(format!("expected 1 message, got {}", messages.len()));
    }

    let conversation = ctx
        .db
        .crm_conversation()
        .id()
        .find(&conversation_id)
        .ok_or("conversation gone")?;
    if conversation.last_preview.as_deref() != Some("Hello from CRM inbox") {
        return Err("conversation preview not updated".to_string());
    }

    let provider_account = ctx
        .db
        .whatsapp_business_account()
        .insert(WhatsAppBusinessAccount {
            id: 0,
            organization_id: org_id,
            name: "Inbox Provider".to_string(),
            phone_number: "+61290000000".to_string(),
            phone_number_id: "wa-phone-inbox-provider".to_string(),
            business_account_id: "wa-business-inbox-provider".to_string(),
            display_name: "Inbox Provider".to_string(),
            credentials_reference: "vault://test/provider-credentials".to_string(),
            webhook_secret_reference: "vault://test/provider-webhook".to_string(),
            messaging_enabled: true,
            notifications_enabled: true,
            template_messaging_enabled: true,
            interactive_messaging_enabled: true,
            template_namespace: None,
            default_language: "en".to_string(),
            media_provider: Some("meta".to_string()),
            webhook_enabled: true,
            webhook_url: Some("https://example.test/provider-webhook".to_string()),
            subscribed_webhook_events: vec!["messages".to_string(), "message_status".to_string()],
            daily_message_limit: 100,
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
            metadata: Some(r#"{"test":"provider-account"}"#.to_string()),
        });
    let inbound = ReceiveCrmProviderMessageParams {
        provider_account_id: provider_account.id,
        provider_event_id: "wa-event-inbound-1".to_string(),
        event_fingerprint: "a".repeat(64),
        contact_id,
        phone_identity_id: identity.id,
        external_thread_id: "wa-thread-provider-1".to_string(),
        provider_message_id: "wa-message-inbound-1".to_string(),
        body: "Persisted inbound provider message".to_string(),
    };
    if receive_crm_provider_message(ctx, org_id, inbound.clone()).is_ok() {
        return Err(
            "ordinary reducer caller was accepted without a provider principal".to_string(),
        );
    }
    let principal = ctx
        .db
        .crm_provider_principal()
        .insert(CrmProviderPrincipal {
            id: 0,
            organization_id: org_id,
            provider_account_id: provider_account.id,
            executor_identity: ctx.sender(),
            is_active: true,
            registered_by: ctx.sender(),
            registered_at: ctx.timestamp,
            retired_at: None,
        });

    receive_crm_provider_message(ctx, org_id, inbound.clone())?;
    receive_crm_provider_message(ctx, org_id, inbound.clone())?;
    if ctx
        .db
        .crm_provider_event_receipt()
        .iter()
        .filter(|receipt| receipt.provider_event_id == inbound.provider_event_id)
        .count()
        != 1
    {
        return Err("provider replay created duplicate receipt".to_string());
    }
    let inbound_count = ctx
        .db
        .crm_conversation_message()
        .crm_conversation_message_by_conversation()
        .filter(&conversation_id)
        .filter(|message| message.direction == "inbound")
        .count();
    if inbound_count != 1 {
        return Err(format!(
            "expected one idempotent inbound message, got {inbound_count}"
        ));
    }
    if ctx
        .db
        .crm_conversation_message()
        .crm_conversation_message_by_conversation()
        .filter(&conversation_id)
        .any(|message| message.direction == "inbound" && message.metadata.is_some())
    {
        return Err("provider callback metadata should not persist".to_string());
    }
    let second_provider_account =
        ctx.db
            .whatsapp_business_account()
            .insert(WhatsAppBusinessAccount {
                id: 0,
                phone_number: "+61290000001".to_string(),
                phone_number_id: "wa-phone-inbox-provider-2".to_string(),
                business_account_id: "wa-business-inbox-provider-2".to_string(),
                is_primary: false,
                ..provider_account.clone()
            });
    ctx.db
        .crm_provider_principal()
        .insert(CrmProviderPrincipal {
            id: 0,
            organization_id: org_id,
            provider_account_id: second_provider_account.id,
            executor_identity: ctx.sender(),
            is_active: true,
            registered_by: ctx.sender(),
            registered_at: ctx.timestamp,
            retired_at: None,
        });
    let mut cross_account_inbound = inbound.clone();
    cross_account_inbound.provider_account_id = second_provider_account.id;
    cross_account_inbound.provider_event_id = "wa-event-cross-account".to_string();
    cross_account_inbound.event_fingerprint = "9".repeat(64);
    if receive_crm_provider_message(ctx, org_id, cross_account_inbound).is_ok() {
        return Err("cross-account provider callback was accepted".to_string());
    }
    let mut conflicting_replay = inbound.clone();
    conflicting_replay.event_fingerprint = "b".repeat(64);
    if receive_crm_provider_message(ctx, org_id, conflicting_replay).is_ok() {
        return Err("conflicting provider replay was accepted".to_string());
    }

    let mut wrong_company_inbound = inbound.clone();
    wrong_company_inbound.provider_event_id = "wa-event-wrong-company".to_string();
    wrong_company_inbound.event_fingerprint = "c".repeat(64);
    wrong_company_inbound.phone_identity_id = wrong_company_identity.id;
    if receive_crm_provider_message(ctx, org_id, wrong_company_inbound).is_ok() {
        return Err("cross-company provider identity was accepted".to_string());
    }
    let mut cross_org_inbound = inbound.clone();
    cross_org_inbound.provider_event_id = "wa-event-cross-org".to_string();
    cross_org_inbound.event_fingerprint = "d".repeat(64);
    if receive_crm_provider_message(ctx, org_id + 1, cross_org_inbound).is_ok() {
        return Err("cross-organization provider callback was accepted".to_string());
    }

    ctx.db
        .crm_provider_principal()
        .id()
        .update(CrmProviderPrincipal {
            is_active: false,
            ..principal.clone()
        });
    let mut inactive_principal_inbound = inbound.clone();
    inactive_principal_inbound.provider_event_id = "wa-event-inactive-principal".to_string();
    inactive_principal_inbound.event_fingerprint = "e".repeat(64);
    if receive_crm_provider_message(ctx, org_id, inactive_principal_inbound).is_ok() {
        return Err("inactive provider principal was accepted".to_string());
    }
    let principal = ctx
        .db
        .crm_provider_principal()
        .id()
        .find(&principal.id)
        .ok_or("provider principal missing")?;
    ctx.db
        .crm_provider_principal()
        .id()
        .update(CrmProviderPrincipal {
            is_active: true,
            ..principal
        });

    ctx.db
        .whatsapp_business_account()
        .id()
        .update(WhatsAppBusinessAccount {
            is_active: false,
            ..provider_account.clone()
        });
    let mut inactive_account_inbound = inbound.clone();
    inactive_account_inbound.provider_event_id = "wa-event-inactive-account".to_string();
    inactive_account_inbound.event_fingerprint = "f".repeat(64);
    if receive_crm_provider_message(ctx, org_id, inactive_account_inbound).is_ok() {
        return Err("inactive provider account was accepted".to_string());
    }
    let provider_account = ctx
        .db
        .whatsapp_business_account()
        .id()
        .find(&provider_account.id)
        .ok_or("provider account missing")?;
    ctx.db
        .whatsapp_business_account()
        .id()
        .update(WhatsAppBusinessAccount {
            is_active: true,
            ..provider_account.clone()
        });

    let outbound_message = ctx
        .db
        .crm_conversation_message()
        .crm_conversation_message_by_conversation()
        .filter(&conversation_id)
        .find(|message| message.direction == "outbound")
        .ok_or("outbound message missing")?;
    let operational = ctx.db.operational_message().insert(OperationalMessage {
        id: 0,
        organization_id: org_id,
        company_id: Some(company_id),
        message_batch_id: 0,
        template_id: 0,
        contact_id,
        phone_identity_id: identity.id,
        channel: MessageChannel::WhatsApp,
        status: OperationalMessageStatus::Queued,
        subject_model: "contact".to_string(),
        subject_id: contact_id,
        rendered_subject: None,
        rendered_body: outbound_message.body.clone(),
        variable_hash: "provider-delivery-test".to_string(),
        copied_at: None,
        queued_at: Some(ctx.timestamp),
        sent_at: None,
        failed_at: None,
        failure_reason: None,
        created_at: ctx.timestamp,
        created_by: ctx.sender(),
        metadata: Some(r#"{"test":"provider-delivery"}"#.to_string()),
    });
    let invalid_delivery = RecordCrmProviderDeliveryParams {
        provider_account_id: provider_account.id,
        event_fingerprint: "1".repeat(64),
        conversation_id,
        conversation_message_id: outbound_message.id,
        provider_event_id: "wa-event-invalid-linkage".to_string(),
        provider_message_id: "wa-message-outbound-1".to_string(),
        operational_message_id: mismatched_operational.id,
        status: "delivered".to_string(),
        failure_reason: None,
    };
    if record_crm_provider_delivery(ctx, org_id, invalid_delivery).is_ok() {
        return Err("invalid operational linkage was accepted".to_string());
    }
    let delivery = RecordCrmProviderDeliveryParams {
        provider_account_id: provider_account.id,
        event_fingerprint: "2".repeat(64),
        conversation_id,
        conversation_message_id: outbound_message.id,
        provider_event_id: "wa-event-delivery-1".to_string(),
        provider_message_id: "wa-message-outbound-1".to_string(),
        operational_message_id: operational.id,
        status: "delivered".to_string(),
        failure_reason: None,
    };
    record_crm_provider_delivery(ctx, org_id, delivery.clone())?;
    record_crm_provider_delivery(ctx, org_id, delivery)?;
    let delivered = ctx
        .db
        .crm_conversation_message()
        .id()
        .find(&outbound_message.id)
        .ok_or("delivered conversation message missing")?;
    if delivered.status != "delivered"
        || delivered.provider_message_id.as_deref() != Some("wa-message-outbound-1")
        || delivered.operational_message_id != Some(operational.id)
        || delivered.metadata.is_some()
    {
        return Err("provider delivery facts were not persisted".to_string());
    }
    let delivered_operational = ctx
        .db
        .operational_message()
        .id()
        .find(&operational.id)
        .ok_or("delivered operational message missing")?;
    if delivered_operational.status != OperationalMessageStatus::Delivered {
        return Err("operational delivery state was not persisted".to_string());
    }

    Ok(())
}
