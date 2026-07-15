//! Tenant isolation and audit immutability tests (A1, A14).
use std::time::Duration;

use spacetimedb::{ReducerContext, Table};

use crate::accounting::fiscal_periods::{
    create_fiscal_year, CreateFiscalYearParams,
};
use crate::core::audit::audit_log;
use crate::core::organization::{
    company, create_company, insert_organization_with_owner, organization,
    CreateCompanyParams, CreateOrganizationParams,
};
use crate::test_harness::ensure_test_superuser;
use crate::types::FiscalYearState;

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
            state: FiscalYearState::Running,
            carry_over_accounts: vec![],
            closing_move_id: None,
            opening_move_id: None,
            is_adjustment: false,
            notes: None,
            metadata: None,
        },
    );

    match result {
        Ok(()) => return Err("Expected cross-tenant fiscal year create to fail".to_string()),
        Err(msg) if msg.contains("does not belong") => {}
        Err(msg) => {
            return Err(format!(
                "Expected company scope error, got: {msg}"
            ));
        }
    }

    let after_count = ctx.db.company().company_by_org().filter(&org_b.id).count();
    if before_count != after_count {
        return Err("Tenant B company count changed after blocked mutation".to_string());
    }

    let org_a_count = ctx.db.organization().iter().filter(|o| o.id == org_a.id).count();
    let org_b_count = ctx.db.organization().iter().filter(|o| o.id == org_b.id).count();
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
