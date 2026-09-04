//! Tenant isolation and audit immutability tests (A1, A14).
use std::time::Duration;

use spacetimedb::rand::Rng;
use spacetimedb::{ReducerContext, Table};

use crate::accounting::fiscal_periods::{create_fiscal_year, CreateFiscalYearParams};
use crate::core::audit::audit_log;
use crate::core::auth::{
    bind_password_reset_token, bind_user_credential, bind_user_profile,
    mark_password_reset_token_projection_used, password_reset_token, user_credential,
};
use crate::core::country_pack::{country_pack_definition, country_pack_tax_rule};
use crate::core::organization::{
    company, create_company, insert_organization_with_owner, organization, CreateCompanyParams,
    CreateOrganizationParams,
};
use crate::core::reference::{
    country, create_country, create_currency, currency, seed_currency_for_organization,
    CreateCountryParams, CreateCurrencyParams,
};
use crate::core::users::{
    ensure_user_profile_for_organization, user_organization, user_profile, UserOrganization,
};
use crate::crm::contact_identities::{
    configure_contact_identity_verification_authority, contact_identity_verification_authority,
};
use crate::hr::country_pack_hr::hr_country_pack_leave_default;
use crate::test_harness::ensure_test_superuser;

pub fn test_cross_tenant_company_scope_blocked(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;

    let (org_a, _) = insert_organization_with_owner(
        ctx,
        CreateOrganizationParams {
            name: "Tenant A".to_string(),
            code: "TENANT_A".to_string(),
            timezone: "UTC".to_string(),
            date_format: "YYYY-MM-DD".to_string(),
            language: "en".to_string(),
            is_active: true,
            description: None,
            logo_url: None,
            website: None,
            email: None,
            phone: None,
            currency_id: None,
            metadata: Some("{\"test\":\"tenant_a\"}".to_string()),
        },
    )?;

    let (org_b, _) = insert_organization_with_owner(
        ctx,
        CreateOrganizationParams {
            name: "Tenant B".to_string(),
            code: "TENANT_B".to_string(),
            timezone: "UTC".to_string(),
            date_format: "YYYY-MM-DD".to_string(),
            language: "en".to_string(),
            is_active: true,
            description: None,
            logo_url: None,
            website: None,
            email: None,
            phone: None,
            currency_id: None,
            metadata: Some("{\"test\":\"tenant_b\"}".to_string()),
        },
    )?;

    create_company(
        ctx,
        org_b.id,
        CreateCompanyParams {
            name: "Tenant B Co".to_string(),
            code: "TBC".to_string(),
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

    let company_b = ctx
        .db
        .company()
        .company_by_org()
        .filter(&org_b.id)
        .find(|c| c.code == "TBC")
        .ok_or("Tenant B company not found")?;

    let before_count = ctx.db.company().company_by_org().filter(&org_b.id).count();

    let result = create_fiscal_year(
        ctx,
        org_a.id,
        company_b.id,
        CreateFiscalYearParams {
            name: "Cross-tenant FY".to_string(),
            date_from: ctx.timestamp,
            date_to: ctx.timestamp + Duration::from_secs(86_400),
            type_: "standard".to_string(),
            is_adjustment: false,
            notes: None,
            metadata: None,
        },
    );

    match result {
        Ok(()) => return Err("Expected cross-tenant fiscal year create to fail".to_string()),
        Err(msg) if msg.contains("does not belong") => {}
        Err(msg) => {
            return Err(format!("Expected company scope error, got: {msg}"));
        }
    }

    let after_count = ctx.db.company().company_by_org().filter(&org_b.id).count();
    if before_count != after_count {
        return Err("Tenant B company count changed after blocked mutation".to_string());
    }

    let org_a_count = ctx
        .db
        .organization()
        .iter()
        .filter(|o| o.id == org_a.id)
        .count();
    let org_b_count = ctx
        .db
        .organization()
        .iter()
        .filter(|o| o.id == org_b.id)
        .count();
    if org_a_count != 1 || org_b_count != 1 {
        return Err("Organization rows corrupted after blocked mutation".to_string());
    }

    Ok(())
}

pub fn test_audit_log_append_only(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;

    let before = ctx.db.audit_log().iter().count();

    let (org, _) = insert_organization_with_owner(
        ctx,
        CreateOrganizationParams {
            name: "Audit Immutability Org".to_string(),
            code: "AUDIT_IMM".to_string(),
            timezone: "UTC".to_string(),
            date_format: "YYYY-MM-DD".to_string(),
            language: "en".to_string(),
            is_active: true,
            description: None,
            logo_url: None,
            website: None,
            email: None,
            phone: None,
            currency_id: None,
            metadata: None,
        },
    )?;

    create_company(
        ctx,
        org.id,
        CreateCompanyParams {
            name: "Audit Co".to_string(),
            code: "AUDCO".to_string(),
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

    let after = ctx.db.audit_log().iter().count();
    if after <= before {
        return Err("Expected audit rows after audited company create".to_string());
    }

    Ok(())
}

/// C0: prove that the former global/reference and platform-control rows are
/// persisted as organization-owned projections. The same opaque platform
/// identity is deliberately a member of both organizations; every binding and
/// reference row must remain in its owning shard when the default membership is
/// switched between Org A and Org B.
pub fn test_platform_bindings_and_reference_isolation(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;

    let suffix = ctx.rng().gen::<u64>();
    let (org_a, owner_role_a) = insert_organization_with_owner(
        ctx,
        CreateOrganizationParams {
            name: format!("C0 Org A {suffix}"),
            code: format!("C0A{suffix}"),
            timezone: "UTC".to_string(),
            date_format: "YYYY-MM-DD".to_string(),
            language: "en".to_string(),
            is_active: true,
            description: None,
            logo_url: None,
            website: None,
            email: None,
            phone: None,
            currency_id: None,
            metadata: Some(r#"{"c0_fixture":"org_a"}"#.to_string()),
        },
    )?;
    let (org_b, owner_role_b) = insert_organization_with_owner(
        ctx,
        CreateOrganizationParams {
            name: format!("C0 Org B {suffix}"),
            code: format!("C0B{suffix}"),
            timezone: "UTC".to_string(),
            date_format: "YYYY-MM-DD".to_string(),
            language: "en".to_string(),
            is_active: true,
            description: None,
            logo_url: None,
            website: None,
            email: None,
            phone: None,
            currency_id: None,
            metadata: Some(r#"{"c0_fixture":"org_b"}"#.to_string()),
        },
    )?;

    // The owner identity has a profile in both orgs. Mark both copies as
    // superuser because the reference authority reducer checks the selected
    // organization-owned profile, not a global administrator flag.
    for profile in ctx
        .db
        .user_profile()
        .user_profile_by_identity()
        .filter(&ctx.sender())
        .collect::<Vec<_>>()
    {
        ctx.db
            .user_profile()
            .id()
            .update(crate::core::users::UserProfile {
                is_superuser: true,
                ..profile
            });
    }

    let target_identity = spacetimedb::Identity::from_byte_array(ctx.rng().gen::<[u8; 32]>());
    let membership_a = ctx.db.user_organization().insert(UserOrganization {
        id: 0,
        user_identity: target_identity,
        organization_id: org_a.id,
        company_id: None,
        role_id: owner_role_a.id,
        department_id: None,
        job_title: Some("C0 shared identity A".to_string()),
        employee_id: None,
        date_joined: ctx.timestamp,
        is_active: true,
        is_default: true,
        metadata: Some(r#"{"c0_fixture":"org_a"}"#.to_string()),
    });
    let membership_b = ctx.db.user_organization().insert(UserOrganization {
        id: 0,
        user_identity: target_identity,
        organization_id: org_b.id,
        company_id: None,
        role_id: owner_role_b.id,
        department_id: None,
        job_title: Some("C0 shared identity B".to_string()),
        employee_id: None,
        date_joined: ctx.timestamp,
        is_active: true,
        is_default: false,
        metadata: Some(r#"{"c0_fixture":"org_b"}"#.to_string()),
    });
    ensure_user_profile_for_organization(ctx, target_identity, org_a.id);
    ensure_user_profile_for_organization(ctx, target_identity, org_b.id);

    let profiles = ctx
        .db
        .user_profile()
        .user_profile_by_identity()
        .filter(&target_identity)
        .collect::<Vec<_>>();
    if profiles.len() != 2
        || profiles.iter().any(|profile| {
            profile.organization_id != org_a.id && profile.organization_id != org_b.id
        })
    {
        return Err("C0 profile fixture did not persist one binding per organization".to_string());
    }

    bind_user_profile(ctx, "platform-user-a".to_string(), target_identity)?;
    ctx.db.user_organization().id().update(UserOrganization {
        is_default: false,
        ..membership_a.clone()
    });
    ctx.db.user_organization().id().update(UserOrganization {
        is_default: true,
        ..membership_b.clone()
    });
    bind_user_profile(ctx, "platform-user-b".to_string(), target_identity)?;

    let profiles = ctx
        .db
        .user_profile()
        .user_profile_by_identity()
        .filter(&target_identity)
        .collect::<Vec<_>>();
    for (organization_id, platform_user_id) in
        [(org_a.id, "platform-user-a"), (org_b.id, "platform-user-b")]
    {
        let profile = profiles
            .iter()
            .find(|profile| profile.organization_id == organization_id)
            .ok_or("C0 profile binding disappeared")?;
        if profile.platform_user_id != platform_user_id {
            return Err(format!(
                "C0 profile binding leaked across organizations: org {organization_id} has {}",
                profile.platform_user_id
            ));
        }
    }

    bind_user_credential(
        ctx,
        "platform-user-b".to_string(),
        target_identity,
        "shared@example.test".to_string(),
    )?;
    ctx.db.user_organization().id().update(UserOrganization {
        is_default: true,
        ..membership_a.clone()
    });
    ctx.db.user_organization().id().update(UserOrganization {
        is_default: false,
        ..membership_b.clone()
    });
    bind_user_credential(
        ctx,
        "platform-user-a".to_string(),
        target_identity,
        "shared@example.test".to_string(),
    )?;
    let credentials = ctx
        .db
        .user_credential()
        .user_credential_by_identity()
        .filter(&target_identity)
        .collect::<Vec<_>>();
    if credentials.len() != 2
        || credentials.iter().any(|credential| {
            credential.organization_id == org_a.id
                && credential.platform_user_id != "platform-user-a"
        })
        || credentials.iter().any(|credential| {
            credential.organization_id == org_b.id
                && credential.platform_user_id != "platform-user-b"
        })
    {
        return Err("C0 credential projections were not isolated by organization".to_string());
    }

    bind_password_reset_token(
        ctx,
        "platform-user-a".to_string(),
        "reset-a".to_string(),
        target_identity,
        ctx.timestamp + Duration::from_secs(900),
    )?;
    ctx.db.user_organization().id().update(UserOrganization {
        is_default: true,
        ..membership_b.clone()
    });
    ctx.db.user_organization().id().update(UserOrganization {
        is_default: false,
        ..membership_a.clone()
    });
    bind_password_reset_token(
        ctx,
        "platform-user-b".to_string(),
        "reset-b".to_string(),
        target_identity,
        ctx.timestamp + Duration::from_secs(900),
    )?;
    mark_password_reset_token_projection_used(ctx, "reset-b".to_string())?;
    let reset_a = ctx
        .db
        .password_reset_token()
        .iter()
        .find(|token| token.platform_reset_token_id == "reset-a")
        .ok_or("C0 reset-a projection missing")?;
    let reset_b = ctx
        .db
        .password_reset_token()
        .iter()
        .find(|token| token.platform_reset_token_id == "reset-b")
        .ok_or("C0 reset-b projection missing")?;
    if reset_a.organization_id != org_a.id
        || reset_a.used_at.is_some()
        || reset_b.organization_id != org_b.id
        || reset_b.used_at.is_none()
    {
        return Err(
            "C0 reset-token projections leaked or were marked in the wrong org".to_string(),
        );
    }

    // Each organization receives its own reference copies and trust anchor.
    let currency_a = create_currency(
        ctx,
        org_a.id,
        "XAA".to_string(),
        CreateCurrencyParams {
            name: "C0 Org A currency".to_string(),
            symbol: "A".to_string(),
            decimal_places: 2,
            rounding_factor: 0.01,
            position: "before".to_string(),
            active: true,
            metadata: Some(r#"{"c0_fixture":"org_a"}"#.to_string()),
        },
    )?;
    let currency_b = create_currency(
        ctx,
        org_b.id,
        "XBB".to_string(),
        CreateCurrencyParams {
            name: "C0 Org B currency".to_string(),
            symbol: "B".to_string(),
            decimal_places: 2,
            rounding_factor: 0.01,
            position: "before".to_string(),
            active: true,
            metadata: Some(r#"{"c0_fixture":"org_b"}"#.to_string()),
        },
    )?;
    create_country(
        ctx,
        org_a.id,
        "XA".to_string(),
        CreateCountryParams {
            name: "C0 Org A country".to_string(),
            iso3: "XAA".to_string(),
            numcode: 901,
            phone_code: "+901".to_string(),
            official_name: None,
            currency_id: Some(currency_a.id),
            language_codes: vec!["en".to_string()],
            is_active: true,
            metadata: Some(r#"{"c0_fixture":"org_a"}"#.to_string()),
        },
    )?;
    create_country(
        ctx,
        org_b.id,
        "XB".to_string(),
        CreateCountryParams {
            name: "C0 Org B country".to_string(),
            iso3: "XBB".to_string(),
            numcode: 902,
            phone_code: "+902".to_string(),
            official_name: None,
            currency_id: Some(currency_b.id),
            language_codes: vec!["en".to_string()],
            is_active: true,
            metadata: Some(r#"{"c0_fixture":"org_b"}"#.to_string()),
        },
    )?;
    configure_contact_identity_verification_authority(ctx, org_a.id, ctx.sender())?;
    configure_contact_identity_verification_authority(ctx, org_b.id, ctx.sender())?;

    let currency_a_rows = ctx
        .db
        .currency()
        .currency_by_organization()
        .filter(&org_a.id)
        .collect::<Vec<_>>();
    let currency_b_rows = ctx
        .db
        .currency()
        .currency_by_organization()
        .filter(&org_b.id)
        .collect::<Vec<_>>();
    if !currency_a_rows.iter().any(|row| row.id == currency_a.id)
        || currency_a_rows
            .iter()
            .any(|row| row.organization_id != org_a.id)
        || !currency_b_rows.iter().any(|row| row.id == currency_b.id)
        || currency_b_rows
            .iter()
            .any(|row| row.organization_id != org_b.id)
    {
        return Err("C0 currency reference copies are not organization-isolated".to_string());
    }
    let country_a = ctx
        .db
        .country()
        .country_by_organization()
        .filter(&org_a.id)
        .collect::<Vec<_>>();
    let country_b = ctx
        .db
        .country()
        .country_by_organization()
        .filter(&org_b.id)
        .collect::<Vec<_>>();
    if !country_a.iter().any(|row| row.code == "XA")
        || country_a.iter().any(|row| row.organization_id != org_a.id)
        || !country_b.iter().any(|row| row.code == "XB")
        || country_b.iter().any(|row| row.organization_id != org_b.id)
    {
        return Err("C0 country reference copies are not organization-isolated".to_string());
    }

    let authority_count_a = ctx
        .db
        .contact_identity_verification_authority()
        .verification_authority_by_organization()
        .filter(&org_a.id)
        .count();
    let authority_count_b = ctx
        .db
        .contact_identity_verification_authority()
        .verification_authority_by_organization()
        .filter(&org_b.id)
        .count();
    if authority_count_a != 1 || authority_count_b != 1 {
        return Err("C0 verification authorities were not copied per organization".to_string());
    }

    // Organization insertion seeds the country-pack and HR overlays. Check
    // those formerly shared rows too, including their organization-leading
    // indexes, so this fixture covers all six C0 reference concepts.
    if ctx
        .db
        .country_pack_definition()
        .country_pack_by_organization()
        .filter(&org_a.id)
        .any(|row| row.organization_id != org_a.id)
        || ctx
            .db
            .country_pack_definition()
            .country_pack_by_organization()
            .filter(&org_b.id)
            .any(|row| row.organization_id != org_b.id)
        || ctx
            .db
            .country_pack_tax_rule()
            .pack_tax_by_organization()
            .filter(&org_a.id)
            .any(|row| row.organization_id != org_a.id)
        || ctx
            .db
            .country_pack_tax_rule()
            .pack_tax_by_organization()
            .filter(&org_b.id)
            .any(|row| row.organization_id != org_b.id)
        || ctx
            .db
            .hr_country_pack_leave_default()
            .hr_leave_default_by_organization()
            .filter(&org_a.id)
            .any(|row| row.organization_id != org_a.id)
        || ctx
            .db
            .hr_country_pack_leave_default()
            .hr_leave_default_by_organization()
            .filter(&org_b.id)
            .any(|row| row.organization_id != org_b.id)
    {
        return Err("C0 seeded country-pack references escaped their organization".to_string());
    }

    // Keep the imported seed helper in the fixture's evidence surface: each
    // org must own its standard onboarding copy rather than relying on a global
    // sentinel row.
    if seed_currency_for_organization(ctx, org_a.id, "USD")?.organization_id != org_a.id
        || seed_currency_for_organization(ctx, org_b.id, "USD")?.organization_id != org_b.id
    {
        return Err("C0 onboarding currencies were not organization-owned".to_string());
    }
    Ok(())
}
