/// Operational messaging domain tests.
use spacetimedb::{ReducerContext, Table};

use crate::core::operational_messaging::{
    create_message_batch, create_message_template, create_operational_message, message_batch,
    message_template, operational_message, set_contact_communication_preference,
    CreateMessageBatchParams, CreateMessageTemplateParams, CreateOperationalMessageParams,
    MessageTemplateVariable,
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

    test_batch_creation_captures_canonical_exclusions(ctx, &fixture, contact_id)?;

    Ok(())
}

fn test_batch_creation_captures_canonical_exclusions(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    included_contact: u64,
) -> Result<(), String> {
    use crate::core::business_changes::business_change;
    use crate::core::persistence::{organization_commit, organization_row_change};
    let org = fixture.organization_id;
    let company = fixture.company_id;
    set_contact_communication_preference(
        ctx,
        org,
        Some(company),
        fixture.partner_id,
        MessageChannel::Sms,
        false,
    )?;
    create_message_template(
        ctx,
        org,
        CreateMessageTemplateParams {
            company_id: Some(company),
            key: "captured-exclusions".into(),
            name: "Captured exclusions".into(),
            locale: "en".into(),
            subject: Some("Hello {{customer_name}}".into()),
            body_template: "Hello {{customer_name}}".into(),
            allowed_variables: vec!["customer_name".into()],
            applicable_channels: vec![MessageChannel::Sms],
            retention_classification: "operational".into(),
            metadata: None,
        },
    )?;
    let template = ctx
        .db
        .message_template()
        .iter()
        .find(|row| row.organization_id == org && row.key == "captured-exclusions")
        .ok_or("captured exclusion template missing")?;
    create_message_batch(
        ctx,
        org,
        CreateMessageBatchParams {
            company_id: Some(company),
            template_id: template.id,
            channel: MessageChannel::Sms,
            subject_model: "contact".into(),
            subject_query: Some("captured-exclusions".into()),
            candidate_contact_ids: vec![included_contact, fixture.partner_id, included_contact],
            metadata: Some(
                r#"{"note":"preserved","batch_exclusions_v1":[{"reason":"forged"}]}"#.into(),
            ),
        },
    )?;
    let batch = ctx
        .db
        .message_batch()
        .iter()
        .find(|row| {
            row.organization_id == org
                && row.subject_query.as_deref() == Some("captured-exclusions")
        })
        .ok_or("captured batch missing")?;
    if batch.recipient_count != 1 || batch.excluded_count != 1 {
        return Err(
            "canonical batch did not deduplicate recipients and capture one exclusion".into(),
        );
    }
    let metadata: serde_json::Value =
        serde_json::from_str(batch.metadata.as_deref().ok_or("batch metadata missing")?)
            .map_err(|error| error.to_string())?;
    let expected = serde_json::json!([{"model":"contact","recordId":fixture.partner_id.to_string(),"contactId":fixture.partner_id.to_string(),"reason":"channel_opted_out"}]);
    if metadata["batch_exclusions_v1"] != expected || metadata["note"] != "preserved" {
        return Err("caller metadata overrode the canonical exclusion snapshot".into());
    }
    let intents: Vec<_> = ctx
        .db
        .operational_message()
        .operational_message_by_batch()
        .filter(&batch.id)
        .collect();
    if intents.len() != 1 || intents[0].contact_id != included_contact {
        return Err("batch recipient intents do not match canonical inclusion".into());
    }
    let captures: Vec<_> = ctx
        .db
        .business_change()
        .business_change_by_record()
        .filter((&org, &"message_batch".to_string(), &batch.id))
        .collect();
    let [capture] = captures.as_slice() else {
        return Err("batch creation requires one private captured evidence row".into());
    };
    if capture.company_id != company
        || capture.operation != "create_message_batch"
        || capture.subject_record_id != batch.id
    {
        return Err("private batch evidence has incorrect canonical ownership".into());
    }
    let changes: serde_json::Value =
        serde_json::from_str(&capture.changes_json).map_err(|error| error.to_string())?;
    let saved = changes
        .as_array()
        .and_then(|rows| (rows.len() == 1).then(|| &rows[0]))
        .ok_or("expected one captured exclusion delta")?;
    let captured: serde_json::Value = serde_json::from_str(
        saved["after"]
            .as_str()
            .ok_or("captured exclusions missing")?,
    )
    .map_err(|error| error.to_string())?;
    if saved["field"] != "exclusions"
        || saved["before"] != serde_json::Value::Null
        || captured != expected
    {
        return Err("private batch evidence differs from the actual eligibility decision".into());
    }
    let commits: Vec<_> = ctx
        .db
        .organization_commit()
        .organization_commit_by_organization()
        .filter(&org)
        .filter(|commit| {
            commit.operation_id == "erp.create_message_batch"
                && commit.correlation_id == format!("message-batch:{}:created", batch.id)
        })
        .collect();
    let [commit] = commits.as_slice() else {
        return Err("canonical batch creation commit missing or duplicated".into());
    };
    let rows: Vec<_> = ctx
        .db
        .organization_row_change()
        .iter()
        .filter(|row| row.organization_id == org && row.commit_sequence == commit.sequence)
        .collect();
    if commit.row_change_count != 4 || rows.len() != 4 {
        return Err("batch commit must contain parent, intent, private evidence and audit".into());
    }
    for table in [
        "message_batch",
        "operational_message",
        "business_change",
        "audit_log",
    ] {
        if rows
            .iter()
            .filter(|row| row.table_name == table && row.change_kind == "upsert")
            .count()
            != 1
        {
            return Err(format!(
                "batch commit does not contain its exact {table} outcome"
            ));
        }
    }
    let evidence_row = rows
        .iter()
        .find(|row| row.table_name == "business_change")
        .ok_or("committed private evidence missing")?;
    let committed: serde_json::Value = serde_json::from_str(
        evidence_row
            .row_json
            .as_deref()
            .ok_or("committed evidence row body missing")?,
    )
    .map_err(|error| error.to_string())?;
    if committed["changes_json"].as_str() != Some(capture.changes_json.as_str()) {
        return Err(
            "organization commit did not retain the exact canonical exclusion evidence".into(),
        );
    }
    Ok(())
}
