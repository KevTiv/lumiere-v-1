/// CRM contact identity and role assignment domain tests — in-module test helpers.
use spacetimedb::{ReducerContext, Table};

use crate::core::audit::audit_log;
use crate::core::organization::{company, create_company, CreateCompanyParams};
use crate::core::users::{find_user_profile_for_organization, user_profile};
use crate::crm::contact_identities::{
    archive_contact_identity, configure_contact_identity_verification_authority,
    contact_identity_evidence_hash, contact_identity_verification_proof, contact_phone_identity,
    create_contact_identity, find_identity_by_normalized, normalize_phone,
    record_contact_identity_verification_proof, update_contact_identity, verify_contact_identity,
    CreateContactIdentityParams, RecordContactIdentityVerificationProofParams,
    UpdateContactIdentityParams,
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
        normalize_phone("+1 415 555 0101", None)?,
        "+14155550101",
        "E.164 with spaces"
    );

    // National input with default region
    assert_eq!(
        normalize_phone("(415) 555-0102", Some("US"))?,
        "+14155550102",
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
            raw_value: "+1 415 555 0101".to_string(),
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

    if identity.normalized_e164 != "+14155550101" {
        return Err(format!(
            "Expected normalized +14155550101, got {}",
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
            raw_value: "+1 415 555 0168".to_string(),
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
            raw_value: "+1 415 555 0169".to_string(),
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

pub fn test_identity_scope_and_state_forgery_rejected(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    create_company(
        ctx,
        org_id,
        CreateCompanyParams {
            name: "Identity Isolation Company B".to_string(),
            code: format!("IDENTITY-B-{company_id}"),
            currency_id: 1,
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
            metadata: Some(r#"{"harness":"identity-isolation"}"#.to_string()),
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
        .ok_or("sibling company missing")?;

    create_contact(
        ctx,
        org_id,
        CreateContactParams {
            name: "Identity Trust Boundary Contact".to_string(),
            type_: "contact".to_string(),
            email: Some("identity-trust-boundary@test.local".to_string()),
            phone: None,
            mobile: None,
            company_id: Some(company_id),
            is_customer: true,
            is_vendor: false,
            is_employee: false,
            is_prospect: false,
            is_partner: false,
            customer_rank: 7,
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
            metadata: Some(r#"{"distinctive":"identity-trust"}"#.to_string()),
        },
    )?;
    let contact_row = ctx
        .db
        .contact()
        .iter()
        .find(|contact| {
            contact.organization_id == org_id
                && contact.email == Some("identity-trust-boundary@test.local".to_string())
        })
        .ok_or("identity trust contact missing")?;

    let mismatched_company_result = create_contact_identity(
        ctx,
        org_id,
        CreateContactIdentityParams {
            contact_id: contact_row.id,
            company_id: Some(sibling_company_id),
            kind: ContactIdentityKind::Primary,
            raw_value: "+1 415 555 0180".to_string(),
            is_preferred: true,
            verification_state: None,
            metadata: None,
        },
    );
    if mismatched_company_result.is_ok() {
        return Err("cross-company contact identity should be rejected".to_string());
    }

    let forged_state_result = create_contact_identity(
        ctx,
        org_id,
        CreateContactIdentityParams {
            contact_id: contact_row.id,
            company_id: Some(company_id),
            kind: ContactIdentityKind::Primary,
            raw_value: "+1 415 555 0181".to_string(),
            is_preferred: true,
            verification_state: Some(ContactVerificationState::Verified),
            metadata: None,
        },
    );
    if forged_state_result.is_ok() {
        return Err("caller-selected create verification state should be rejected".to_string());
    }

    let persisted_count = ctx
        .db
        .contact_phone_identity()
        .contact_phone_identity_by_contact()
        .filter(&contact_row.id)
        .count();
    if persisted_count != 0 {
        return Err("rejected identity mutations must persist no row".to_string());
    }

    create_contact_identity(
        ctx,
        org_id,
        CreateContactIdentityParams {
            contact_id: contact_row.id,
            company_id: None,
            kind: ContactIdentityKind::Primary,
            raw_value: "+1 415 555 0182".to_string(),
            is_preferred: true,
            verification_state: None,
            metadata: None,
        },
    )?;
    let derived_scope_identity = ctx
        .db
        .contact_phone_identity()
        .contact_phone_identity_by_contact()
        .filter(&contact_row.id)
        .find(|identity| identity.normalized_e164 == "+14155550182")
        .ok_or("derived-scope identity missing")?;
    if derived_scope_identity.company_id != Some(company_id) {
        return Err("omitted identity company should derive from contact".to_string());
    }
    if derived_scope_identity.verification_state != ContactVerificationState::Unverified
        || derived_scope_identity.verified_at.is_some()
    {
        return Err("new identity must persist server-owned unverified state".to_string());
    }

    Ok(())
}

pub fn test_verify_and_archive_contact_identity(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    configure_contact_identity_verification_authority(ctx, org_id, ctx.sender())?;

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
            raw_value: "+1 415 555 0170".to_string(),
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

    let caller_selected_pending =
        verify_contact_identity(ctx, org_id, identity.id, ContactVerificationState::Pending);
    if caller_selected_pending.is_ok() {
        return Err("verification reducer should reject caller-selected pending state".to_string());
    }
    let still_unverified = ctx
        .db
        .contact_phone_identity()
        .id()
        .find(&identity.id)
        .ok_or("identity missing after rejected verification command")?;
    if still_unverified.verification_state != ContactVerificationState::Unverified
        || still_unverified.verified_at.is_some()
    {
        return Err("rejected verification command must leave identity unchanged".to_string());
    }

    let permission_only =
        verify_contact_identity(ctx, org_id, identity.id, ContactVerificationState::Verified);
    if permission_only.is_ok() {
        return Err("permission-only identity verification should be disabled".to_string());
    }

    let now_micros = ctx.timestamp.to_micros_since_unix_epoch();
    let raw_provider_evidence = "provider-signed-otp-receipt-0170";
    let proof_hash = contact_identity_evidence_hash(
        org_id,
        identity.company_id,
        identity.contact_id,
        identity.id,
        &identity.normalized_e164,
        raw_provider_evidence,
    );
    let valid_proof = RecordContactIdentityVerificationProofParams {
        identity_id: identity.id,
        contact_id: identity.contact_id,
        company_id: identity.company_id,
        normalized_e164: identity.normalized_e164.clone(),
        method: "otp".to_string(),
        provider: "test-sms-provider".to_string(),
        provider_reference: format!("verify-{}-0170", identity.id),
        evidence_hash: proof_hash.clone(),
        issued_at_micros: now_micros - 1_000_000,
        expires_at_micros: now_micros + 5 * 60 * 1_000_000,
    };

    ctx.db.contact_phone_identity().id().update(
        crate::crm::contact_identities::ContactPhoneIdentity {
            verification_state: ContactVerificationState::OptedOut,
            ..identity.clone()
        },
    );
    let opted_out = record_contact_identity_verification_proof(ctx, org_id, valid_proof.clone());
    ctx.db
        .contact_phone_identity()
        .id()
        .update(identity.clone());
    if opted_out.is_ok() {
        return Err("opted-out identity should reject verification proof".to_string());
    }

    let expired = record_contact_identity_verification_proof(
        ctx,
        org_id,
        RecordContactIdentityVerificationProofParams {
            provider_reference: format!("expired-{}", identity.id),
            issued_at_micros: now_micros - 2_000_000,
            expires_at_micros: now_micros - 1,
            ..valid_proof.clone()
        },
    );
    if expired.is_ok() {
        return Err("expired verification proof should be rejected".to_string());
    }

    let wrong_scope = record_contact_identity_verification_proof(
        ctx,
        org_id,
        RecordContactIdentityVerificationProofParams {
            normalized_e164: "+14155559999".to_string(),
            provider_reference: format!("wrong-scope-{}", identity.id),
            ..valid_proof.clone()
        },
    );
    if wrong_scope.is_ok() {
        return Err("identity-mismatched verification proof should be rejected".to_string());
    }

    let caller = find_user_profile_for_organization(ctx, ctx.sender(), org_id)
        .ok_or("verification test caller profile missing")?;
    ctx.db
        .user_profile()
        .id()
        .update(crate::core::users::UserProfile {
            is_superuser: false,
            ..caller
        });
    let ordinary_writer_attempt =
        record_contact_identity_verification_proof(ctx, org_id, valid_proof.clone());
    let ordinary_profile = find_user_profile_for_organization(ctx, ctx.sender(), org_id)
        .ok_or("verification test caller profile disappeared")?;
    ctx.db
        .user_profile()
        .id()
        .update(crate::core::users::UserProfile {
            is_superuser: true,
            ..ordinary_profile
        });
    if ordinary_writer_attempt.is_ok() {
        return Err("ordinary CRM writer should not record verification proof".to_string());
    }
    if ctx
        .db
        .contact_identity_verification_proof()
        .contact_identity_proof_by_identity()
        .filter(&identity.id)
        .next()
        .is_some()
    {
        return Err("rejected verification attempts must persist no proof artifact".to_string());
    }

    record_contact_identity_verification_proof(ctx, org_id, valid_proof.clone())?;

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

    let proofs: Vec<_> = ctx
        .db
        .contact_identity_verification_proof()
        .contact_identity_proof_by_identity()
        .filter(&identity.id)
        .collect();
    if proofs.len() != 1 {
        return Err(format!(
            "expected one persisted verification proof, found {}",
            proofs.len()
        ));
    }
    let proof = &proofs[0];
    if proof.organization_id != org_id
        || proof.company_id != identity.company_id
        || proof.contact_id != identity.contact_id
        || proof.normalized_e164 != identity.normalized_e164
        || proof.evidence_hash != proof_hash
        || proof.evidence_hash.contains(raw_provider_evidence)
    {
        return Err("persisted verification proof lost scope or exposed raw evidence".to_string());
    }

    // Provider callbacks are at-least-once. An exact replay is idempotent and
    // must not create a second proof row.
    record_contact_identity_verification_proof(ctx, org_id, valid_proof.clone())?;
    if ctx
        .db
        .contact_identity_verification_proof()
        .contact_identity_proof_by_identity()
        .filter(&identity.id)
        .count()
        != 1
    {
        return Err("exact provider retry created duplicate verification proof".to_string());
    }
    let conflicting_retry = record_contact_identity_verification_proof(
        ctx,
        org_id,
        RecordContactIdentityVerificationProofParams {
            evidence_hash: format!("sha256:{}", "a".repeat(64)),
            ..valid_proof.clone()
        },
    );
    if conflicting_retry.is_ok() {
        return Err("conflicting provider-reference retry should be rejected".to_string());
    }

    update_contact_identity(
        ctx,
        org_id,
        identity.id,
        UpdateContactIdentityParams {
            company_id: None,
            raw_value: Some("+1 415 555 0179".to_string()),
            is_preferred: None,
            verification_state: None,
            metadata: None,
        },
    )?;
    let renumbered = ctx
        .db
        .contact_phone_identity()
        .id()
        .find(&identity.id)
        .ok_or("identity missing after phone update")?;
    if renumbered.verification_state != ContactVerificationState::Unverified {
        return Err("phone update should reset verification state".to_string());
    }
    if renumbered.verified_at.is_some() {
        return Err("phone update should clear verified_at".to_string());
    }

    let stale_retry = record_contact_identity_verification_proof(ctx, org_id, valid_proof);
    if stale_retry.is_ok() {
        return Err("proof for a previous normalized number should not be replayable".to_string());
    }

    let forged_update_result = update_contact_identity(
        ctx,
        org_id,
        identity.id,
        UpdateContactIdentityParams {
            company_id: None,
            raw_value: None,
            is_preferred: None,
            verification_state: Some(ContactVerificationState::Verified),
            metadata: None,
        },
    );
    if forged_update_result.is_ok() {
        return Err("caller-selected update verification state should be rejected".to_string());
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

    let archived_attempt = record_contact_identity_verification_proof(
        ctx,
        org_id,
        RecordContactIdentityVerificationProofParams {
            identity_id: archived.id,
            contact_id: archived.contact_id,
            company_id: archived.company_id,
            normalized_e164: archived.normalized_e164.clone(),
            method: "provider_attestation".to_string(),
            provider: "test-sms-provider".to_string(),
            provider_reference: format!("archived-{}", archived.id),
            evidence_hash: contact_identity_evidence_hash(
                org_id,
                archived.company_id,
                archived.contact_id,
                archived.id,
                &archived.normalized_e164,
                "archived-provider-receipt",
            ),
            issued_at_micros: now_micros - 1_000_000,
            expires_at_micros: now_micros + 5 * 60 * 1_000_000,
        },
    );
    if archived_attempt.is_ok() {
        return Err("archived identity should reject verification proof".to_string());
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

    if assign_contact_role(
        ctx,
        org_id,
        AssignContactRoleParams {
            contact_id: contact_row.id,
            company_id: None,
            role: "customer".to_string(),
            active_from: None,
            active_until: None,
            metadata: None,
        },
    )
    .is_ok()
    {
        return Err("Company-less contact role assignment should be rejected".to_string());
    }

    create_company(
        ctx,
        org_id,
        CreateCompanyParams {
            name: "Role Assignment Company B".to_string(),
            code: format!("ROLE-B-{company_id}"),
            currency_id: 1,
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
        .ok_or("Role assignment sibling company missing")?;
    if assign_contact_role(
        ctx,
        org_id,
        AssignContactRoleParams {
            contact_id: contact_row.id,
            company_id: Some(sibling_company_id),
            role: "customer".to_string(),
            active_from: None,
            active_until: None,
            metadata: None,
        },
    )
    .is_ok()
    {
        return Err("Cross-company contact role assignment should be rejected".to_string());
    }

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
        .find(|c| c.organization_id == org_id && c.email == Some("dup-a@test.local".to_string()))
        .ok_or("Contact A not found")?;

    let contact_b = ctx
        .db
        .contact()
        .iter()
        .find(|c| c.organization_id == org_id && c.email == Some("dup-b@test.local".to_string()))
        .ok_or("Contact B not found")?;

    create_contact_identity(
        ctx,
        org_id,
        CreateContactIdentityParams {
            contact_id: contact_a.id,
            company_id: Some(company_id),
            kind: ContactIdentityKind::Primary,
            raw_value: "+1 415 555 0171".to_string(),
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
            raw_value: "415-555-0171".to_string(),
            is_preferred: true,
            verification_state: None,
            metadata: None,
        },
    )?;

    let normalized = normalize_phone("+1 415 555 0171", None)?;
    let found = find_identity_by_normalized(ctx, org_id, &normalized)
        .ok_or("Expected to find identity by normalized value")?;

    if found.contact_id != contact_a.id && found.contact_id != contact_b.id {
        return Err("Found identity does not match either contact".to_string());
    }

    Ok(())
}

fn create_contact(
    ctx: &ReducerContext,
    org_id: u64,
    params: CreateContactParams,
) -> Result<(), String> {
    use crate::crm::contacts::create_contact;
    create_contact(ctx, org_id, params)
}
