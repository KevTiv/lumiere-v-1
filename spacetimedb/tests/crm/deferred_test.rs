/// Deferred CRM foundations — lead scoring, dynamic segments, relationship intel, inbox.
use spacetimedb::{ReducerContext, Table};

use crate::crm::contacts::{
    create_contact, create_contact_relationship, contact, CreateContactParams,
    CreateContactRelationshipParams,
};
use crate::crm::inbox::{
    append_crm_conversation_message, crm_conversation, crm_conversation_message,
    open_crm_conversation, AppendCrmConversationMessageParams, OpenCrmConversationParams,
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
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::MessageChannel;

fn base_contact_params(name: &str, company_id: u64, country: &str, is_customer: bool) -> CreateContactParams {
    CreateContactParams {
        name: name.to_string(),
        type_: "contact".to_string(),
        email: Some(format!("{}@example.test", name.to_lowercase().replace(' ', "-"))),
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
        return Err(format!("expected positive score, got {}", score.total_score));
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

    open_crm_conversation(
        ctx,
        org_id,
        OpenCrmConversationParams {
            contact_id,
            channel: MessageChannel::WhatsApp,
            phone_identity_id: None,
            external_thread_id: Some("wa-thread-1".to_string()),
            assigned_user_id: None,
            metadata: None,
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

    Ok(())
}
