/// Organization Module Tests
///
/// Tests for Organization, OrganizationSettings, and Company tables.
use spacetimedb::{ReducerContext, Table};

use crate::core::organization::{
    organization, organization_settings, company,
    create_organization, update_organization, upsert_organization_settings,
    create_company, update_company, delete_company,
};

/// Test reducer for organization lifecycle operations
#[spacetimedb::reducer]
pub fn test_organization_lifecycle(ctx: &ReducerContext) -> Result<(), String> {
    // Test 1: Create organization with valid data
    let org_name = "Test Organization".to_string();
    let org_code = "TEST001".to_string();

    create_organization(
        ctx,
        org_name.clone(),
        org_code.clone(),
        "UTC".to_string(),
        "YYYY-MM-DD".to_string(),
        "en".to_string(),
    )?;

    // Verify organization was created
    let org = ctx.db.organization()
        .iter()
        .find(|o| o.code == org_code)
        .ok_or("Organization not found after creation")?;

    if org.name != org_name {
        return Err(format!("Organization name mismatch: expected {}, got {}", org_name, org.name));
    }

    if !org.is_active {
        return Err("Organization should be active after creation".to_string());
    }

    let org_id = org.id;

    // Test 2: Update organization
    update_organization(
        ctx,
        org_id,
        Some("Updated Test Organization".to_string()),
        Some("Test Description".to_string()),
        None,
        Some("https://test.com".to_string()),
        Some("test@test.com".to_string()),
        None,
        None,
        None,
        None,
        None,
    )?;

    let updated_org = ctx.db.organization()
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
        Some(r#"{"theme": "light"}"#.to_string()),
        vec!["feature_a".to_string(), "feature_b".to_string()],
        Some(r#"{"api_key": "secret123"}"#.to_string()),
    )?;

    let settings = ctx.db.organization_settings()
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
        "Test Company".to_string(),
        "COMP001".to_string(),
        1, // currency_id
        12, // fiscal_year_end_month
        31, // fiscal_year_end_day
    )?;

    let company = ctx.db.company()
        .iter()
        .find(|c| c.code == "COMP001")
        .ok_or("Company not found after creation")?;

    if company.organization_id != org_id {
        return Err("Company organization_id mismatch".to_string());
    }

    let company_id = company.id;

    // Test 5: Update company
    update_company(
        ctx,
        company_id,
        Some("Updated Test Company".to_string()),
        Some("TAX123456".to_string()),
        Some("123 Test St".to_string()),
        Some("Test City".to_string()),
        Some("12345".to_string()),
        Some("US".to_string()),
    )?;

    let updated_company = ctx.db.company()
        .id()
        .find(&company_id)
        .ok_or("Company not found after update")?;

    if updated_company.tax_id != Some("TAX123456".to_string()) {
        return Err("Company tax_id not updated".to_string());
    }

    // Test 6: Soft delete company
    delete_company(ctx, company_id)?;

    let deleted_company = ctx.db.company()
        .id()
        .find(&company_id)
        .ok_or("Company not found after delete")?;

    if deleted_company.deleted_at.is_none() {
        return Err("Company should have deleted_at timestamp".to_string());
    }

    // Test 7: Error cases
    // Empty organization name should fail
    match create_organization(
        ctx,
        "".to_string(),
        "CODE".to_string(),
        "UTC".to_string(),
        "YYYY-MM-DD".to_string(),
        "en".to_string(),
    ) {
        Ok(_) => return Err("Should reject empty organization name".to_string()),
        Err(_) => {} // Expected
    }

    // Empty organization code should fail
    match create_organization(
        ctx,
        "Name".to_string(),
        "".to_string(),
        "UTC".to_string(),
        "YYYY-MM-DD".to_string(),
        "en".to_string(),
    ) {
        Ok(_) => return Err("Should reject empty organization code".to_string()),
        Err(_) => {} // Expected
    }

    // Empty company name should fail
    match create_company(
        ctx,
        org_id,
        "".to_string(),
        "CODE".to_string(),
        1,
        12,
        31,
    ) {
        Ok(_) => return Err("Should reject empty company name".to_string()),
        Err(_) => {} // Expected
    }

    // Non-existent organization update should fail
    match update_organization(
        ctx,
        99999,
        Some("Name".to_string()),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
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
        "Org A".to_string(),
        "ORGA".to_string(),
        "UTC".to_string(),
        "YYYY-MM-DD".to_string(),
        "en".to_string(),
    )?;

    create_organization(
        ctx,
        "Org B".to_string(),
        "ORGB".to_string(),
        "UTC".to_string(),
        "YYYY-MM-DD".to_string(),
        "en".to_string(),
    )?;

    // Verify both exist
    let orgs: Vec<_> = ctx.db.organization().iter().collect();
    if orgs.len() < 2 {
        return Err("Should have at least 2 organizations".to_string());
    }

    // Create companies in each org
    let org_a = ctx.db.organization()
        .iter()
        .find(|o| o.code == "ORGA")
        .ok_or("Org A not found")?;

    let org_b = ctx.db.organization()
        .iter()
        .find(|o| o.code == "ORGB")
        .ok_or("Org B not found")?;

    create_company(
        ctx,
        org_a.id,
        "Company A".to_string(),
        "COMPA".to_string(),
        1,
        12,
        31,
    )?;

    create_company(
        ctx,
        org_b.id,
        "Company B".to_string(),
        "COMPB".to_string(),
        1,
        12,
        31,
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
        "Settings Test Org".to_string(),
        "SETTINGS".to_string(),
        "UTC".to_string(),
        "YYYY-MM-DD".to_string(),
        "en".to_string(),
    )?;

    let org = ctx.db.organization()
        .iter()
        .find(|o| o.code == "SETTINGS")
        .ok_or("Organization not found")?;

    // Test: Create settings, then update them
    upsert_organization_settings(
        ctx,
        org.id,
        Some(r#"{"initial": true}"#.to_string()),
        vec!["flag1".to_string()],
        None,
    )?;

    upsert_organization_settings(
        ctx,
        org.id,
        Some(r#"{"updated": true}"#.to_string()),
        vec!["flag1".to_string(), "flag2".to_string()],
        Some(r#"{"key": "value"}"#.to_string()),
    )?;

    let settings = ctx.db.organization_settings()
        .organization_id()
        .find(&org.id)
        .ok_or("Settings not found after upsert")?;

    // Verify the merge behavior - new fields should override
    let config_str = settings.module_config.as_ref().unwrap_or(&"{}".to_string()).clone();

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
