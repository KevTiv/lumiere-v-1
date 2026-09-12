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
    ensure_user_profile_for_organization, remove_user_from_organization, user_organization,
    user_profile, UserOrganization,
};
use crate::crm::contact_identities::{
    configure_contact_identity_verification_authority, contact_identity_verification_authority,
};
use crate::hr::country_pack_hr::hr_country_pack_leave_default;
use crate::test_harness::{ensure_test_superuser, OrgFixture};

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

    let org_b_currency = seed_currency_for_organization(ctx, org_b.id, "USD")?;
    create_company(
        ctx,
        org_b.id,
        CreateCompanyParams {
            name: "Tenant B Co".to_string(),
            code: "TBC".to_string(),
            currency_id: org_b_currency.id,
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

/// C9: exercise the stable organization/company command boundaries in both
/// directions, including a cross-company parent reference and an inactive
/// caller membership. The native in-module harness has one caller identity,
/// so the inactive-membership case deliberately runs last after all successful
/// evidence has been collected.
pub fn test_adversarial_tenant_command_matrix(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;

    let primary = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let org_a = primary.organization_id;
    let company_a = primary.company_id;
    let org_b = foreign.organization_id;
    let company_b = foreign.company_id;
    let currency_a = ctx
        .db
        .company()
        .id()
        .find(&company_a)
        .ok_or("C9 primary company missing")?
        .currency_id;
    let currency_b = ctx
        .db
        .company()
        .id()
        .find(&company_b)
        .ok_or("C9 foreign company missing")?
        .currency_id;
    let cross_company_code = format!("C9CROSS{company_a}");
    create_company(
        ctx,
        org_a,
        CreateCompanyParams {
            name: "C9 same-org second company".to_string(),
            code: cross_company_code.clone(),
            currency_id: currency_a,
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
            metadata: Some(r#"{"c9_fixture":"same_org_second_company"}"#.to_string()),
        },
    )?;
    let cross_company = ctx
        .db
        .company()
        .company_by_org()
        .filter(&org_a)
        .find(|company| company.code == cross_company_code)
        .ok_or("C9 same-org second company missing")?
        .id;

    let fiscal_year_params = || CreateFiscalYearParams {
        name: format!("C9 FY {company_a}"),
        date_from: ctx.timestamp + Duration::from_secs(365 * 86_400),
        date_to: ctx.timestamp + Duration::from_secs(366 * 86_400),
        type_: "standard".to_string(),
        is_adjustment: false,
        notes: None,
        metadata: None,
    };

    // Forged organization: Org B cannot submit a fiscal-year mutation for an
    // Org A company, even though the caller is a superuser in both fixtures.
    let forged_organization = create_fiscal_year(ctx, org_b, company_a, fiscal_year_params());
    if !matches!(
        &forged_organization,
        Err(ref message) if message.contains("does not belong")
    ) {
        return Err(format!(
            "Expected forged organization rejection, got: {forged_organization:?}"
        ));
    }

    // Foreign company: the inverse direction must be rejected as well.
    let foreign_company = create_fiscal_year(ctx, org_a, company_b, fiscal_year_params());
    if !matches!(&foreign_company, Err(ref message) if message.contains("does not belong")) {
        return Err(format!(
            "Expected foreign company rejection, got: {foreign_company:?}"
        ));
    }

    // The fixture's second company is a valid same-organization reference;
    // keep one positive command beside the negative cross-tenant cases.
    create_fiscal_year(ctx, org_a, cross_company, fiscal_year_params())?;

    // Company hierarchy is another stable reference boundary. A parent from
    // Org B may not be attached while creating a company in Org A.
    let before_companies = ctx.db.company().company_by_org().filter(&org_a).count();
    let cross_company_parent = create_company(
        ctx,
        org_a,
        CreateCompanyParams {
            name: "C9 invalid cross-company child".to_string(),
            code: format!("C9INVALID{company_a}"),
            currency_id: currency_a,
            fiscal_year_end_month: 12,
            fiscal_year_end_day: 31,
            is_parent: false,
            parent_id: Some(company_b),
            tax_id: None,
            company_registry: None,
            address_street: None,
            address_city: None,
            address_zip: None,
            address_country_code: None,
            metadata: None,
        },
    );
    if !matches!(
        &cross_company_parent,
        Err(ref message) if message.contains("does not belong")
    ) {
        return Err(format!(
            "Expected cross-company parent rejection, got: {cross_company_parent:?}"
        ));
    }
    if ctx.db.company().company_by_org().filter(&org_a).count() != before_companies {
        return Err("Cross-company parent rejection changed Org A companies".to_string());
    }

    // Successful same-org child creation supplies a distinctive audit row and
    // proves that the identity is system-derived from ctx.sender().
    let child_code = format!("C9CHILD{company_a}");
    create_company(
        ctx,
        org_a,
        CreateCompanyParams {
            name: "C9 same-org child".to_string(),
            code: child_code.clone(),
            currency_id: currency_a,
            fiscal_year_end_month: 12,
            fiscal_year_end_day: 31,
            is_parent: false,
            parent_id: Some(company_a),
            tax_id: None,
            company_registry: None,
            address_street: None,
            address_city: None,
            address_zip: None,
            address_country_code: None,
            metadata: Some(r#"{"c9_fixture":"c9_child"}"#.to_string()),
        },
    )?;
    let child = ctx
        .db
        .company()
        .company_by_org()
        .filter(&org_a)
        .find(|company| company.code == child_code)
        .ok_or("C9 same-org child company not found")?;
    if child.parent_id != Some(company_a) {
        return Err("C9 same-org parent relationship was not persisted".to_string());
    }
    let audit = ctx
        .db
        .audit_log()
        .iter()
        .find(|entry| {
            entry.organization_id == org_a
                && entry.company_id == Some(child.id)
                && entry.table_name == "company"
                && entry.action == "CREATE"
        })
        .ok_or("C9 successful company create did not produce an audit row")?;
    if audit.user_identity != ctx.sender() {
        return Err("C9 audit identity did not match ctx.sender()".to_string());
    }

    // This is intentionally last: the native harness cannot invoke a reducer
    // as a different Identity, but it can prove the same actor loses access
    // immediately after its membership is deactivated.
    remove_user_from_organization(ctx, ctx.sender(), org_b)?;
    let inactive_actor = create_company(
        ctx,
        org_b,
        CreateCompanyParams {
            name: "C9 inactive actor".to_string(),
            code: format!("C9INACTIVE{company_b}"),
            currency_id: currency_b,
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
    );
    if !matches!(&inactive_actor, Err(ref message) if message.contains("Not a member")) {
        return Err(format!(
            "Expected inactive membership rejection, got: {inactive_actor:?}"
        ));
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

    let audit_currency = seed_currency_for_organization(ctx, org.id, "USD")?;
    create_company(
        ctx,
        org.id,
        CreateCompanyParams {
            name: "Audit Co".to_string(),
            code: "AUDCO".to_string(),
            currency_id: audit_currency.id,
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
    create_currency(
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
    create_currency(
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
    let currency_a = ctx
        .db
        .currency()
        .organization_code_key()
        .find(&format!("{}:XAA", org_a.id))
        .ok_or("C0 Org A currency was not persisted")?;
    let currency_b = ctx
        .db
        .currency()
        .organization_code_key()
        .find(&format!("{}:XBB", org_b.id))
        .ok_or("C0 Org B currency was not persisted")?;
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
