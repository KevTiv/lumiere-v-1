/// CRM contact update/delete and lead delete domain tests — in-module test helpers.
use spacetimedb::{ReducerContext, Table};

use crate::core::audit::audit_log;
use crate::crm::contacts::{
    contact, create_contact, delete_contact, update_contact, CreateContactParams,
    UpdateContactCoreParams,
};
use crate::crm::leads::{create_lead, delete_lead, lead, CreateLeadParams};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

pub fn test_contact_update_and_delete(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    create_contact(
        ctx,
        org_id,
        CreateContactParams {
            name: "Harness Contact".to_string(),
            type_: "contact".to_string(),
            email: Some("harness-contact@test.local".to_string()),
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
            metadata: Some(r#"{"test":"contact_lifecycle"}"#.to_string()),
        },
    )?;

    let contact_row = ctx
        .db
        .contact()
        .iter()
        .find(|c| {
            c.organization_id == org_id && c.email == Some("harness-contact@test.local".to_string())
        })
        .ok_or("Contact not found after create")?;

    update_contact(
        ctx,
        org_id,
        contact_row.id,
        UpdateContactCoreParams {
            name: Some("Harness Contact Updated".to_string()),
            email: None,
            phone: None,
            mobile: None,
            company_id: None,
            is_customer: None,
            is_vendor: None,
            is_prospect: None,
            is_partner: None,
        },
    )?;

    let updated = ctx
        .db
        .contact()
        .id()
        .find(&contact_row.id)
        .ok_or("Contact missing after update")?;

    if updated.name != "Harness Contact Updated" {
        return Err(format!(
            "Name not updated: expected Harness Contact Updated, got {}",
            updated.name
        ));
    }
    if updated.display_name != "Harness Contact Updated" {
        return Err("display_name should mirror name after update".to_string());
    }

    let has_update_audit = ctx
        .db
        .audit_log()
        .audit_by_org()
        .filter(&org_id)
        .any(|entry| {
            entry.table_name == "contact"
                && entry.record_id == contact_row.id
                && entry.action == "UPDATE"
        });
    if !has_update_audit {
        return Err("Expected UPDATE audit row for contact".to_string());
    }

    delete_contact(ctx, org_id, contact_row.id)?;

    let deleted = ctx
        .db
        .contact()
        .id()
        .find(&contact_row.id)
        .ok_or("Contact row missing after delete")?;

    if deleted.deleted_at.is_none() {
        return Err("deleted_at should be set after soft delete".to_string());
    }

    let has_delete_audit = ctx
        .db
        .audit_log()
        .audit_by_org()
        .filter(&org_id)
        .any(|entry| {
            entry.table_name == "contact"
                && entry.record_id == contact_row.id
                && entry.action == "DELETE"
        });
    if !has_delete_audit {
        return Err("Expected DELETE audit row for contact".to_string());
    }

    Ok(())
}

pub fn test_lead_delete(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;

    create_lead(
        ctx,
        org_id,
        CreateLeadParams {
            name: "Harness New Lead".to_string(),
            priority: "medium".to_string(),
            state: "new".to_string(),
            expected_revenue: 500.0,
            probability: 5.0,
            tag_ids: vec![],
            email: Some("harness-lead@test.local".to_string()),
            phone: None,
            mobile: None,
            company_name: None,
            contact_name: None,
            title: None,
            street: None,
            city: None,
            zip: None,
            country_code: None,
            website: None,
            industry: None,
            source_id: None,
            campaign_id: None,
            medium_id: None,
            referred_by: None,
            description: None,
            user_id: None,
            team_id: None,
            partner_id: None,
            date_deadline: None,
            metadata: Some(r#"{"test":"lead_delete"}"#.to_string()),
        },
    )?;

    let lead_row = ctx
        .db
        .lead()
        .iter()
        .find(|l| {
            l.organization_id == org_id && l.email == Some("harness-lead@test.local".to_string())
        })
        .ok_or("Lead not found after create")?;

    if lead_row.state != "new" {
        return Err(format!("Expected lead state 'new', got {}", lead_row.state));
    }

    delete_lead(ctx, org_id, lead_row.id)?;

    let deleted = ctx
        .db
        .lead()
        .id()
        .find(&lead_row.id)
        .ok_or("Lead row missing after delete")?;

    if deleted.deleted_at.is_none() {
        return Err("deleted_at should be set after lead soft delete".to_string());
    }

    Ok(())
}
