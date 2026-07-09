/// CRM contact identity and role assignment domain tests — in-module test helpers.
use spacetimedb::{ReducerContext, Table};

use crate::core::audit::audit_log;
use crate::crm::contact_identities::{
    archive_contact_identity, contact_phone_identity, create_contact_identity,
    find_identity_by_normalized, normalize_phone, update_contact_identity,
    verify_contact_identity, CreateContactIdentityParams, UpdateContactIdentityParams,
};
use crate::crm::contact_roles::{
    assign_contact_role, contact_role_assignment, end_contact_role, AssignContactRoleParams,
    EndContactRoleParams,
};
use crate::crm::contacts::{contact, CreateContactParams};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{ContactIdentityKind, ContactVerificationState};

pub fn test_phone_normalization(ctx: &ReducerContext) -> Result<(), String> {
    let _ = ctx;

    // E.164 input
    assert_eq!(
        normalize_phone("+1 415 123 4567", None)?,
        "+14151234567",
        "E.164 with spaces"
    );

    // National input with default region
    assert_eq!(
        normalize_phone("(415) 123-4568", Some("US"))?,
        "+14151234568",
        "US national format"
    );

    // Empty input rejected
    if normalize_phone("   ", None).is_ok() {
        return Err("Empty phone should fail normalization".to_string());
    }

    Ok(())
}

pub fn test_create_and_normalize_contact_identity(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    create_contact(
        ctx,
        org_id,
        CreateContactParams {
            name: "Identity Test Contact".to_string(),
            type_: "contact".to_string(),
            email: Some("identity-test@test.local".to_string()),
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
            country_code: Some("US".to_string()),
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

    let contact_row = ctx
        .db
        .contact()
        .iter()
        .find(|c| {
            c.organization_id == org_id && c.email == Some("identity-test@test.local".to_string())
        })
        .ok_or("Contact not found after create")?;

    create_contact_identity(
        ctx,
        org_id,
        CreateContactIdentityParams {
            contact_id: contact_row.id,
            company_id: Some(company_id),
            kind: ContactIdentityKind::Primary,
            raw_value: "+1 415 123 4567".to_string(),
            is_preferred: true,
            verification_state: None,
            metadata: None,
        },
    )?;

    let identity = ctx
        .db
        .contact_phone_identity()
        .contact_phone_identity_by_contact()
        .filter(&contact_row.id)
        .find(|i| i.kind == ContactIdentityKind::Primary)
        .ok_or("Primary identity not found after create")?;

    if identity.normalized_e164 != "+14151234567" {
        return Err(format!(
            "Expected normalized +1555010100, got {}",
            identity.normalized_e164
        ));
    }

    if identity.display_masked.is_empty() {
        return Err("display_masked should not be empty".to_string());
    }

    if !identity.is_preferred {
        return Err("Identity should be preferred".to_string());
    }

    if identity.verification_state != ContactVerificationState::Unverified {
        return Err("Default verification state should be Unverified".to_string());
    }

    let has_audit = ctx
        .db
        .audit_log()
        .audit_by_org()
        .filter(&org_id)
        .any(|entry| {
            entry.table_name == "contact_phone_identity"
                && entry.record_id == identity.id
                && entry.action == "CREATE"
        });
    if !has_audit {
        return Err("Expected CREATE audit row for contact_phone_identity".to_string());
    }

    Ok(())
}

pub fn test_preferred_identity_uniqueness(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    create_contact(
        ctx,
        org_id,
        CreateContactParams {
            name: "Preferred Uniqueness Contact".to_string(),
            type_: "contact".to_string(),
            email: Some("preferred-uni@test.local".to_string()),
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
            country_code: Some("US".to_string()),
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

    let contact_row = ctx
        .db
        .contact()
        .iter()
        .find(|c| {
            c.organization_id == org_id && c.email == Some("preferred-uni@test.local".to_string())
        })
        .ok_or("Contact not found after create")?;

    create_contact_identity(
        ctx,
        org_id,
        CreateContactIdentityParams {
            contact_id: contact_row.id,
            company_id: Some(company_id),
            kind: ContactIdentityKind::Primary,
            raw_value: "+1 415 123 4568".to_string(),
            is_preferred: true,
            verification_state: None,
            metadata: None,
        },
    )?;

    create_contact_identity(
        ctx,
        org_id,
        CreateContactIdentityParams {
            contact_id: contact_row.id,
            company_id: Some(company_id),
            kind: ContactIdentityKind::Primary,
            raw_value: "+1 415 123 4569".to_string(),
            is_preferred: true,
            verification_state: None,
            metadata: None,
        },
    )?;

    let preferred_count = ctx
        .db
        .contact_phone_identity()
        .contact_phone_identity_by_contact()
        .filter(&contact_row.id)
        .filter(|i| {
            i.kind == ContactIdentityKind::Primary
                && i.company_id == Some(company_id)
                && i.is_preferred
                && i.archived_at.is_none()
        })
        .count();

    if preferred_count != 1 {
        return Err(format!(
            "Expected exactly one preferred primary identity, got {}",
            preferred_count
        ));
    }

    Ok(())
}

pub fn test_verify_and_archive_contact_identity(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    create_contact(
        ctx,
        org_id,
        CreateContactParams {
            name: "Verify Archive Contact".to_string(),
            type_: "contact".to_string(),
            email: Some("verify-archive@test.local".to_string()),
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
            country_code: Some("US".to_string()),
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

    let contact_row = ctx
        .db
        .contact()
        .iter()
        .find(|c| {
            c.organization_id == org_id && c.email == Some("verify-archive@test.local".to_string())
        })
        .ok_or("Contact not found after create")?;

    create_contact_identity(
        ctx,
        org_id,
        CreateContactIdentityParams {
            contact_id: contact_row.id,
            company_id: Some(company_id),
            kind: ContactIdentityKind::WhatsApp,
            raw_value: "+1 415 123 4570".to_string(),
            is_preferred: false,
            verification_state: None,
            metadata: None,
        },
    )?;

    let identity = ctx
        .db
        .contact_phone_identity()
        .contact_phone_identity_by_contact()
        .filter(&contact_row.id)
        .find(|i| i.kind == ContactIdentityKind::WhatsApp)
        .ok_or("WhatsApp identity not found")?;

    verify_contact_identity(ctx, org_id, identity.id, ContactVerificationState::Verified)?;

    let verified = ctx
        .db
        .contact_phone_identity()
        .id()
        .find(&identity.id)
        .ok_or("Identity missing after verify")?;

    if verified.verification_state != ContactVerificationState::Verified {
        return Err("Identity should be Verified".to_string());
    }
    if verified.verified_at.is_none() {
        return Err("verified_at should be set after verification".to_string());
    }

    update_contact_identity(
        ctx,
        org_id,
        identity.id,
        UpdateContactIdentityParams {
            company_id: None,
            raw_value: None,
            is_preferred: Some(true),
            verification_state: None,
            metadata: None,
        },
    )?;

    archive_contact_identity(ctx, org_id, identity.id)?;

    let archived = ctx
        .db
        .contact_phone_identity()
        .id()
        .find(&identity.id)
        .ok_or("Identity missing after archive")?;

    if archived.archived_at.is_none() {
        return Err("archived_at should be set".to_string());
    }
    if archived.is_preferred {
        return Err("Archived identity should not remain preferred".to_string());
    }

    Ok(())
}

pub fn test_contact_role_assignment_lifecycle(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    create_contact(
        ctx,
        org_id,
        CreateContactParams {
            name: "Role Assignment Contact".to_string(),
            type_: "contact".to_string(),
            email: Some("role-assign@test.local".to_string()),
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
            metadata: None,
        },
    )?;

    let contact_row = ctx
        .db
        .contact()
        .iter()
        .find(|c| {
            c.organization_id == org_id && c.email == Some("role-assign@test.local".to_string())
        })
        .ok_or("Contact not found after create")?;

    assign_contact_role(
        ctx,
        org_id,
        AssignContactRoleParams {
            contact_id: contact_row.id,
            company_id: Some(company_id),
            role: "customer".to_string(),
            active_from: None,
            active_until: None,
            metadata: None,
        },
    )?;

    let assignment = ctx
        .db
        .contact_role_assignment()
        .contact_role_by_contact()
        .filter(&contact_row.id)
        .find(|a| a.role == "customer")
        .ok_or("Role assignment not found")?;

    if !assignment.is_active {
        return Err("Role assignment should be active".to_string());
    }

    end_contact_role(
        ctx,
        org_id,
        assignment.id,
        EndContactRoleParams {
            reason: Some("Test end".to_string()),
        },
    )?;

    let ended = ctx
        .db
        .contact_role_assignment()
        .id()
        .find(&assignment.id)
        .ok_or("Role assignment missing after end")?;

    if ended.is_active {
        return Err("Role assignment should be ended".to_string());
    }
    if ended.ended_at.is_none() {
        return Err("ended_at should be set".to_string());
    }

    Ok(())
}

pub fn test_duplicate_identity_detection(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    create_contact(
        ctx,
        org_id,
        CreateContactParams {
            name: "Duplicate A".to_string(),
            type_: "contact".to_string(),
            email: Some("dup-a@test.local".to_string()),
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
            country_code: Some("US".to_string()),
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

    create_contact(
        ctx,
        org_id,
        CreateContactParams {
            name: "Duplicate B".to_string(),
            type_: "contact".to_string(),
            email: Some("dup-b@test.local".to_string()),
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
            country_code: Some("US".to_string()),
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

    let contact_a = ctx
        .db
        .contact()
        .iter()
        .find(|c| {
            c.organization_id == org_id && c.email == Some("dup-a@test.local".to_string())
        })
        .ok_or("Contact A not found")?;

    let contact_b = ctx
        .db
        .contact()
        .iter()
        .find(|c| {
            c.organization_id == org_id && c.email == Some("dup-b@test.local".to_string())
        })
        .ok_or("Contact B not found")?;

    create_contact_identity(
        ctx,
        org_id,
        CreateContactIdentityParams {
            contact_id: contact_a.id,
            company_id: Some(company_id),
            kind: ContactIdentityKind::Primary,
            raw_value: "+1 415 123 4571".to_string(),
            is_preferred: true,
            verification_state: None,
            metadata: None,
        },
    )?;

    create_contact_identity(
        ctx,
        org_id,
        CreateContactIdentityParams {
            contact_id: contact_b.id,
            company_id: Some(company_id),
            kind: ContactIdentityKind::Primary,
            raw_value: "415-123-4571".to_string(),
            is_preferred: true,
            verification_state: None,
            metadata: None,
        },
    )?;

    let normalized = normalize_phone("+1 415 123 4571", None)?;
    let found = find_identity_by_normalized(ctx, org_id, &normalized)
        .ok_or("Expected to find identity by normalized value")?;

    if found.contact_id != contact_a.id && found.contact_id != contact_b.id {
        return Err("Found identity does not match either contact".to_string());
    }

    Ok(())
}

fn create_contact(ctx: &ReducerContext, org_id: u64, params: CreateContactParams) -> Result<(), String> {
    use crate::crm::contacts::create_contact;
    create_contact(ctx, org_id, params)
}
