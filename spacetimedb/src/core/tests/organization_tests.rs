/// Organization Module Tests
///
/// Tests for Organization, OrganizationSettings, and Company tables.
use spacetimedb::{ReducerContext, Table};

use crate::core::organization::{
    company, create_company, create_organization, delete_company, organization,
    organization_settings, update_company_address, update_company_business, update_organization,
    upsert_organization_settings, CreateCompanyParams, CreateOrganizationParams,
    UpdateCompanyAddressParams, UpdateCompanyBusinessParams, UpdateOrganizationParams,
    UpsertOrganizationSettingsParams,
};

/// Test reducer for organization lifecycle operations
#[spacetimedb::reducer]
pub fn test_organization_lifecycle(ctx: &ReducerContext) -> Result<(), String> {
    // Test 1: Create organization with valid data
    let org_name = "Test Organization".to_string();
    let org_code = "TEST001".to_string();

    create_organization(
        ctx,
        CreateOrganizationParams {
            name: org_name.clone(),
            code: org_code.clone(),
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

    // Verify organization was created
    let org = ctx
        .db
        .organization()
        .iter()
        .find(|o| o.code == org_code)
        .ok_or("Organization not found after creation")?;

    if org.name != org_name {
        return Err(format!(
            "Organization name mismatch: expected {}, got {}",
            org_name, org.name
        ));
    }

    if !org.is_active {
        return Err("Organization should be active after creation".to_string());
    }

    let org_id = org.id;

    // Test 2: Update organization
    update_organization(
        ctx,
        org_id,
        UpdateOrganizationParams {
            name: Some("Updated Test Organization".to_string()),
            description: Some("Test Description".to_string()),
            timezone: None,
            website: Some("https://test.com".to_string()),
            email: Some("test@test.com".to_string()),
            phone: None,
            logo_url: None,
            date_format: None,
            language: None,
            currency_id: None,
        },
    )?;

    let updated_org = ctx
        .db
        .organization()
        .id()
        .find(&org_id)
        .ok_or("Organization not found after update")?;

    if updated_org.name != "Updated Test Organization" {
        return Err("Organization name not updated".to_string());
    }

    // Test 3: Create organization settings
    upsert_organization_settings(
        ctx,
        org_id,
        UpsertOrganizationSettingsParams {
            module_config: Some(r#"{"theme": "light"}"#.to_string()),
            feature_flags: vec!["feature_a".to_string(), "feature_b".to_string()],
            integration_keys: Some(r#"{"api_key": "secret123"}"#.to_string()),
            metadata: None,
        },
    )?;

    let settings = ctx
        .db
        .organization_settings()
        .organization_id()
        .find(&org_id)
        .ok_or("Organization settings not created")?;

    if !settings.feature_flags.contains(&"feature_a".to_string()) {
        return Err("Feature flags not saved correctly".to_string());
    }

    // Test 4: Create company under organization
    create_company(
        ctx,
        org_id,
        CreateCompanyParams {
            name: "Test Company".to_string(),
            code: "COMP001".to_string(),
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

    let company = ctx
        .db
        .company()
        .iter()
        .find(|c| c.code == "COMP001")
        .ok_or("Company not found after creation")?;

    if company.organization_id != org_id {
        return Err("Company organization_id mismatch".to_string());
    }

    let company_id = company.id;

    // Test 5: Update company address
    update_company_address(
        ctx,
        company_id,
        UpdateCompanyAddressParams {
            address_street: Some("123 Test St".to_string()),
            address_city: Some("Test City".to_string()),
            address_zip: Some("12345".to_string()),
            address_country_code: Some("US".to_string()),
        },
    )?;

    // Test 6: Update company business info
    update_company_business(
        ctx,
        company_id,
        UpdateCompanyBusinessParams {
            tax_id: Some("TAX123456".to_string()),
            company_registry: Some("REG789".to_string()),
        },
    )?;

    let updated_company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found after update")?;

    if updated_company.tax_id != Some("TAX123456".to_string()) {
        return Err("Company tax_id not updated".to_string());
    }

    // Test 7: Soft delete company
    delete_company(ctx, company_id)?;

    let deleted_company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found after delete")?;

    if deleted_company.deleted_at.is_none() {
        return Err("Company should have deleted_at timestamp".to_string());
    }

    // Test 8: Error cases
    // Empty organization name should fail
    match create_organization(
        ctx,
        CreateOrganizationParams {
            name: "".to_string(),
            code: "CODE".to_string(),
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
    ) {
        Ok(_) => return Err("Should reject empty organization name".to_string()),
        Err(_) => {} // Expected
    }

    // Empty organization code should fail
    match create_organization(
        ctx,
        CreateOrganizationParams {
            name: "Name".to_string(),
            code: "".to_string(),
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
    ) {
        Ok(_) => return Err("Should reject empty organization code".to_string()),
        Err(_) => {} // Expected
    }

    // Empty company name should fail
    match create_company(
        ctx,
        org_id,
        CreateCompanyParams {
            name: "".to_string(),
            code: "COMP001".to_string(),
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
    ) {
        Ok(_) => return Err("Should reject empty company name".to_string()),
        Err(_) => {} // Expected
    }

    // Non-existent organization update should fail
    match update_organization(
        ctx,
        99999,
        UpdateOrganizationParams {
            name: Some("Name".to_string()),
            description: None,
            timezone: None,
            website: None,
            email: None,
            phone: None,
            logo_url: None,
            date_format: None,
            language: None,
            currency_id: None,
        },
    ) {
        Ok(_) => return Err("Should reject update of non-existent organization".to_string()),
        Err(_) => {} // Expected
    }

    Ok(())
}

/// Test reducer for organization multi-tenancy
#[spacetimedb::reducer]
pub fn test_organization_isolation(ctx: &ReducerContext) -> Result<(), String> {
    // Create two organizations
    create_organization(
        ctx,
        CreateOrganizationParams {
            name: "Org A".to_string(),
            code: "ORGA".to_string(),
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

    create_organization(
        ctx,
        CreateOrganizationParams {
            name: "Org B".to_string(),
            code: "ORGB".to_string(),
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

    // Verify both exist
    let orgs: Vec<_> = ctx.db.organization().iter().collect();
    if orgs.len() < 2 {
        return Err("Should have at least 2 organizations".to_string());
    }

    // Create companies in each org
    let org_a = ctx
        .db
        .organization()
        .iter()
        .find(|o| o.code == "ORGA")
        .ok_or("Org A not found")?;

    let org_b = ctx
        .db
        .organization()
        .iter()
        .find(|o| o.code == "ORGB")
        .ok_or("Org B not found")?;

    create_company(
        ctx,
        org_a.id,
        CreateCompanyParams {
            name: "Company A".to_string(),
            code: "COMPA".to_string(),
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

    create_company(
        ctx,
        org_b.id,
        CreateCompanyParams {
            name: "Company B".to_string(),
            code: "COMPB".to_string(),
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

    // Verify isolation - companies should belong to correct orgs
    let companies: Vec<_> = ctx.db.company().iter().collect();

    for company in &companies {
        if company.code == "COMPA" && company.organization_id != org_a.id {
            return Err("Company A belongs to wrong organization".to_string());
        }
        if company.code == "COMPB" && company.organization_id != org_b.id {
            return Err("Company B belongs to wrong organization".to_string());
        }
    }

    Ok(())
}

/// Test reducer for organization settings edge cases
#[spacetimedb::reducer]
pub fn test_organization_settings_edge_cases(ctx: &ReducerContext) -> Result<(), String> {
    // Create organization
    create_organization(
        ctx,
        CreateOrganizationParams {
            name: "Settings Test Org".to_string(),
            code: "SETTINGS".to_string(),
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

    let org = ctx
        .db
        .organization()
        .iter()
        .find(|o| o.code == "SETTINGS")
        .ok_or("Organization not found")?;

    // Test: Create settings, then update them
    upsert_organization_settings(
        ctx,
        org.id,
        UpsertOrganizationSettingsParams {
            module_config: Some(r#"{"initial": true}"#.to_string()),
            feature_flags: vec!["flag1".to_string()],
            integration_keys: None,
            metadata: None,
        },
    )?;

    upsert_organization_settings(
        ctx,
        org.id,
        UpsertOrganizationSettingsParams {
            module_config: Some(r#"{"updated": true}"#.to_string()),
            feature_flags: vec!["flag1".to_string(), "flag2".to_string()],
            integration_keys: Some(r#"{"key": "value"}"#.to_string()),
            metadata: None,
        },
    )?;

    let settings = ctx
        .db
        .organization_settings()
        .organization_id()
        .find(&org.id)
        .ok_or("Settings not found after upsert")?;

    // Verify the merge behavior - new fields should override
    let config_str = settings
        .module_config
        .as_ref()
        .unwrap_or(&"{}".to_string())
        .clone();

    if !config_str.contains("\"updated\"") {
        return Err("Settings config should have 'updated' field".to_string());
    }

    if settings.feature_flags.len() != 2 {
        return Err(format!(
            "Should have 2 feature flags, got {}",
            settings.feature_flags.len()
        ));
    }

    Ok(())
}
