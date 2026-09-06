/// Operational messaging domain tests.
use spacetimedb::{ReducerContext, Table};

use crate::core::operational_messaging::{
    create_message_template, create_operational_message, message_template, operational_message,
    set_contact_communication_preference, CreateMessageTemplateParams,
    CreateOperationalMessageParams, MessageTemplateVariable,
};
use crate::core::organization::{company, create_company, CreateCompanyParams};
use crate::crm::contact_identities::{contact_phone_identity, ContactPhoneIdentity};
use crate::crm::contacts::{contact, create_contact, CreateContactParams};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{
    ContactIdentityKind, ContactVerificationState, MessageChannel, OperationalMessageStatus,
};

fn seed_contact_with_phone(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    name: &str,
) -> Result<u64, String> {
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    create_contact(
        ctx,
        org_id,
        CreateContactParams {
            name: name.to_string(),
            type_: "customer".to_string(),
            email: None,
            phone: Some("+15550101001".to_string()),
            mobile: None,
            company_id: Some(company_id),
            is_customer: true,
            is_vendor: false,
            is_employee: false,
            is_prospect: false,
            is_partner: false,
            customer_rank: 0,
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
            metadata: None,
        },
    )?;

    let contact = ctx
        .db
        .contact()
        .iter()
        .find(|c| c.organization_id == org_id && c.name == name)
        .ok_or("Contact not found after create")?;

    ctx.db
        .contact_phone_identity()
        .insert(ContactPhoneIdentity {
            id: 0,
            organization_id: org_id,
            company_id: Some(company_id),
            contact_id: contact.id,
            kind: ContactIdentityKind::Primary,
            normalized_e164: "+15550101001".to_string(),
            display_masked: "+1****01".to_string(),
            verification_state: ContactVerificationState::Verified,
            is_preferred: true,
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            verified_at: Some(ctx.timestamp),
            archived_at: None,
            metadata: None,
        });

    Ok(contact.id)
}

pub fn test_message_template_and_single_message(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let currency_id = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Harness company not found")?
        .currency_id;

    let contact_id = seed_contact_with_phone(ctx, &fixture, "Messaging Customer")?;

    if set_contact_communication_preference(
        ctx,
        org_id,
        None,
        contact_id,
        MessageChannel::WhatsApp,
        true,
    )
    .is_ok()
    {
        return Err("Company-less communication preference should be rejected".to_string());
    }

    create_company(
        ctx,
        org_id,
        CreateCompanyParams {
            name: "Messaging Company B".to_string(),
            code: format!("MSG-B-{company_id}"),
            currency_id,
            fiscal_year_end_month: 12,
            fiscal_year_end_day: 31,
            is_parent: false,
            parent_id: None,
            tax_id: None,
            company_registry: None,
            address_street: None,
            address_city: None,
            address_zip: None,
            address_country_code: None,
            metadata: None,
        },
    )?;
    let sibling_company_id = ctx
        .db
        .company()
        .company_by_org()
        .filter(&org_id)
        .map(|company| company.id)
        .filter(|id| *id != company_id)
        .max()
        .ok_or("Messaging sibling company missing")?;
    if set_contact_communication_preference(
        ctx,
        org_id,
        Some(sibling_company_id),
        contact_id,
        MessageChannel::WhatsApp,
        true,
    )
    .is_ok()
    {
        return Err("Cross-company communication preference should be rejected".to_string());
    }

    set_contact_communication_preference(
        ctx,
        org_id,
        Some(company_id),
        contact_id,
        MessageChannel::WhatsApp,
        true,
    )?;

    create_message_template(
        ctx,
        org_id,
        CreateMessageTemplateParams {
            company_id: Some(company_id),
            key: "invoice_reminder".to_string(),
            name: "Invoice Reminder".to_string(),
            locale: "en".to_string(),
            subject: Some("Reminder: invoice {{invoice_number}}".to_string()),
            body_template:
                "Hi {{customer_name}}, your invoice {{invoice_number}} for {{amount}} is due."
                    .to_string(),
            allowed_variables: vec![
                "customer_name".to_string(),
                "invoice_number".to_string(),
                "amount".to_string(),
            ],
            applicable_channels: vec![MessageChannel::WhatsApp, MessageChannel::Sms],
            retention_classification: "operational".to_string(),
            metadata: None,
        },
    )?;

    let template = ctx
        .db
        .message_template()
        .iter()
        .find(|t| t.organization_id == org_id && t.key == "invoice_reminder")
        .ok_or("Message template not found")?;

    create_operational_message(
        ctx,
        org_id,
        CreateOperationalMessageParams {
            company_id: Some(company_id),
            template_id: template.id,
            contact_id,
            phone_identity_id: 0,
            channel: MessageChannel::WhatsApp,
            subject_model: "account_move".to_string(),
            subject_id: 1,
            rendered_subject: None,
            rendered_body: String::new(),
            variables: vec![
                MessageTemplateVariable {
                    key: "customer_name".to_string(),
                    value: "Alice".to_string(),
                },
                MessageTemplateVariable {
                    key: "invoice_number".to_string(),
                    value: "INV-001".to_string(),
                },
                MessageTemplateVariable {
                    key: "amount".to_string(),
                    value: "$100.00".to_string(),
                },
            ],
            status: OperationalMessageStatus::Draft,
            metadata: None,
        },
    )?;

    let message = ctx
        .db
        .operational_message()
        .iter()
        .find(|m| m.organization_id == org_id && m.contact_id == contact_id)
        .ok_or("Operational message not found")?;

    if !message.rendered_body.contains("INV-001") {
        return Err(format!(
            "Rendered body missing invoice number: {}",
            message.rendered_body
        ));
    }

    Ok(())
}
