/// Organization & Multi-Tenancy
///
/// Tables:  Organization · OrganizationSettings · Company
/// Pattern: every table row carries `organization_id` for tenant isolation.
///          Companies are sub-units within an Organization.
use spacetimedb::{ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::permissions::{role, Role};
use crate::core::users::{user_organization, UserOrganization};
use crate::helpers::check_permission;

// ============================================================================
// PARAMS TYPES
// ============================================================================

/// Params for creating an organization.
/// Scope: no scope param (any authenticated user can create an org).
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateOrganizationParams {
    pub name: String,
    pub code: String,
    pub timezone: String,
    pub date_format: String,
    pub language: String,
    pub is_active: bool,
    pub description: Option<String>,
    pub logo_url: Option<String>,
    pub website: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub currency_id: Option<u64>,
    pub metadata: Option<String>,
}

/// Params for updating an organization.
/// Scope: `organization_id` is a flat reducer param.
/// Option fields: None = keep existing value.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateOrganizationParams {
    pub name: Option<String>,
    pub description: Option<String>,
    pub logo_url: Option<String>,
    pub website: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub currency_id: Option<u64>,
    pub timezone: Option<String>,
    pub date_format: Option<String>,
    pub language: Option<String>,
}

/// Params for upserting organization settings.
/// Scope: `organization_id` is a flat reducer param.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpsertOrganizationSettingsParams {
    pub module_config: Option<String>,
    pub feature_flags: Vec<String>,
    pub integration_keys: Option<String>,
    pub metadata: Option<String>,
}

/// Params for creating a company.
/// Scope: `organization_id` is a flat reducer param.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateCompanyParams {
    pub name: String,
    pub code: String,
    pub currency_id: u64,
    pub fiscal_year_end_month: u8,
    pub fiscal_year_end_day: u8,
    pub is_parent: bool,
    pub parent_id: Option<u64>,
    pub tax_id: Option<String>,
    pub company_registry: Option<String>,
    pub address_street: Option<String>,
    pub address_city: Option<String>,
    pub address_zip: Option<String>,
    pub address_country_code: Option<String>,
    pub metadata: Option<String>,
}

/// Params for updating core company fields.
/// Scope: `company_id` is a flat reducer param.
/// Option fields: None = keep existing value.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateCompanyParams {
    pub name: Option<String>,
    pub tax_id: Option<String>,
    pub address_street: Option<String>,
    pub address_city: Option<String>,
    pub address_zip: Option<String>,
    pub address_country_code: Option<String>,
}

/// Params for updating company address fields.
/// Scope: `company_id` is a flat reducer param.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateCompanyAddressParams {
    pub address_street: Option<String>,
    pub address_city: Option<String>,
    pub address_zip: Option<String>,
    pub address_country_code: Option<String>,
}

/// Params for updating company business identifiers.
/// Scope: `company_id` is a flat reducer param.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateCompanyBusinessParams {
    pub tax_id: Option<String>,
    pub company_registry: Option<String>,
}

/// Params for updating company hierarchy placement.
/// Scope: `company_id` is a flat reducer param.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateCompanyHierarchyParams {
    pub is_parent: bool,
    pub parent_id: Option<u64>,
}

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(accessor = organization, public)]
pub struct Organization {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub code: String,
    pub description: Option<String>,
    pub logo_url: Option<String>,
    pub website: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub currency_id: Option<u64>,
    pub timezone: String,
    pub date_format: String,
    pub language: String,
    pub is_active: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(accessor = organization_settings, public)]
pub struct OrganizationSettings {
    #[primary_key]
    #[auto_inc]
    pub organization_id: u64,
    pub module_config: Option<String>, // JSON
    pub feature_flags: Vec<String>,
    /// DEPRECATED: Use the integrations module instead for managing external service connections.
    /// This field will be removed in a future version.
    /// See: integrations::GoogleDriveConnection, integrations::WhatsAppBusinessAccount
    pub integration_keys: Option<String>, // JSON (store references, not raw secrets)
    pub updated_at: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = company,
    public,
    index(accessor = company_by_org, btree(columns = [organization_id]))
)]
pub struct Company {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub code: String,
    pub is_parent: bool,
    pub parent_id: Option<u64>,
    pub currency_id: u64,
    pub fiscal_year_end_month: u8,
    pub fiscal_year_end_day: u8,
    pub tax_id: Option<String>,
    pub company_registry: Option<String>,
    pub address_street: Option<String>,
    pub address_city: Option<String>,
    pub address_zip: Option<String>,
    pub address_country_code: Option<String>,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub deleted_at: Option<Timestamp>,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Create a new top-level Organization. No permission check — any authenticated
/// user can create an org (they become its first admin via the bootstrap below).
#[spacetimedb::reducer]
pub fn create_organization(
    ctx: &ReducerContext,
    params: CreateOrganizationParams,
) -> Result<(), String> {
    if params.name.is_empty() {
        return Err("Organization name cannot be empty".to_string());
    }
    if params.code.is_empty() {
        return Err("Organization code cannot be empty".to_string());
    }

    // Capture code before moving into params
    let code = params.code.clone();

    let org = ctx.db.organization().insert(Organization {
        id: 0,
        name: params.name,
        code: params.code,
        description: params.description,
        logo_url: params.logo_url,
        website: params.website,
        email: params.email,
        phone: params.phone,
        currency_id: params.currency_id,
        timezone: params.timezone,
        date_format: params.date_format,
        language: params.language,
        is_active: params.is_active,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: params.metadata,
    });

    // System-managed: bootstrap default owner role for this organization
    let owner_role = ctx.db.role().insert(Role {
        id: 0,
        organization_id: org.id,
        name: "owner".to_string(),
        description: Some("Organization owner with full permissions".to_string()),
        parent_id: None,
        permissions: vec!["*:*".to_string()],
        is_system: true,
        is_active: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: Some(format!("{{\"bootstrap\":true,\"org_code\":\"{}\"}}", code)),
    });

    // System-managed: bootstrap creator membership as owner
    ctx.db.user_organization().insert(UserOrganization {
        id: 0,
        user_identity: ctx.sender(),
        organization_id: org.id,
        company_id: None,
        role_id: owner_role.id,
        department_id: None,
        job_title: Some("Owner".to_string()),
        employee_id: None,
        date_joined: ctx.timestamp,
        is_active: true,
        is_default: true,
        metadata: Some("{\"bootstrap\":true}".to_string()),
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_organization(
    ctx: &ReducerContext,
    organization_id: u64,
    params: UpdateOrganizationParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "organization", "write")?;

    let org = ctx
        .db
        .organization()
        .id()
        .find(&organization_id)
        .ok_or("Organization not found")?;

    ctx.db.organization().id().update(Organization {
        name: params.name.unwrap_or(org.name),
        description: params.description.or(org.description),
        logo_url: params.logo_url.or(org.logo_url),
        website: params.website.or(org.website),
        email: params.email.or(org.email),
        phone: params.phone.or(org.phone),
        currency_id: params.currency_id.or(org.currency_id),
        timezone: params.timezone.unwrap_or(org.timezone),
        date_format: params.date_format.unwrap_or(org.date_format),
        language: params.language.unwrap_or(org.language),
        updated_at: ctx.timestamp,
        ..org
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn upsert_organization_settings(
    ctx: &ReducerContext,
    organization_id: u64,
    params: UpsertOrganizationSettingsParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "organization", "write")?;

    match ctx
        .db
        .organization_settings()
        .organization_id()
        .find(&organization_id)
    {
        Some(existing) => {
            ctx.db
                .organization_settings()
                .organization_id()
                .update(OrganizationSettings {
                    module_config: params.module_config.or(existing.module_config),
                    feature_flags: params.feature_flags,
                    integration_keys: params.integration_keys.or(existing.integration_keys),
                    updated_at: ctx.timestamp,
                    metadata: params.metadata.or(existing.metadata),
                    ..existing
                });
        }
        None => {
            ctx.db.organization_settings().insert(OrganizationSettings {
                organization_id,
                module_config: params.module_config,
                feature_flags: params.feature_flags,
                integration_keys: params.integration_keys,
                updated_at: ctx.timestamp,
                metadata: params.metadata,
            });
        }
    }

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_company(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateCompanyParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "company", "create")?;

    if params.name.is_empty() {
        return Err("Company name cannot be empty".to_string());
    }

    ctx.db.company().insert(Company {
        id: 0,
        organization_id,
        name: params.name,
        code: params.code,
        is_parent: params.is_parent,
        parent_id: params.parent_id,
        currency_id: params.currency_id,
        fiscal_year_end_month: params.fiscal_year_end_month,
        fiscal_year_end_day: params.fiscal_year_end_day,
        tax_id: params.tax_id,
        company_registry: params.company_registry,
        address_street: params.address_street,
        address_city: params.address_city,
        address_zip: params.address_zip,
        address_country_code: params.address_country_code,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        // System-managed: not yet deleted
        deleted_at: None,
        metadata: params.metadata,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_company(
    ctx: &ReducerContext,
    company_id: u64,
    params: UpdateCompanyParams,
) -> Result<(), String> {
    let company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;

    check_permission(ctx, company.organization_id, "company", "write")?;

    ctx.db.company().id().update(Company {
        name: params.name.unwrap_or(company.name),
        tax_id: params.tax_id.or(company.tax_id),
        address_street: params.address_street.or(company.address_street),
        address_city: params.address_city.or(company.address_city),
        address_zip: params.address_zip.or(company.address_zip),
        address_country_code: params.address_country_code.or(company.address_country_code),
        updated_at: ctx.timestamp,
        ..company
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_company_address(
    ctx: &ReducerContext,
    company_id: u64,
    params: UpdateCompanyAddressParams,
) -> Result<(), String> {
    let company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;

    check_permission(ctx, company.organization_id, "company", "write")?;

    ctx.db.company().id().update(Company {
        address_street: params.address_street,
        address_city: params.address_city,
        address_zip: params.address_zip,
        address_country_code: params.address_country_code,
        updated_at: ctx.timestamp,
        ..company
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_company_business(
    ctx: &ReducerContext,
    company_id: u64,
    params: UpdateCompanyBusinessParams,
) -> Result<(), String> {
    let company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;

    check_permission(ctx, company.organization_id, "company", "write")?;

    ctx.db.company().id().update(Company {
        tax_id: params.tax_id,
        company_registry: params.company_registry,
        updated_at: ctx.timestamp,
        ..company
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_company_hierarchy(
    ctx: &ReducerContext,
    company_id: u64,
    params: UpdateCompanyHierarchyParams,
) -> Result<(), String> {
    let company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;

    check_permission(ctx, company.organization_id, "company", "write")?;

    ctx.db.company().id().update(Company {
        is_parent: params.is_parent,
        parent_id: params.parent_id,
        updated_at: ctx.timestamp,
        ..company
    });

    Ok(())
}

/// Soft-delete: sets `deleted_at`, does not remove the row.
#[spacetimedb::reducer]
pub fn delete_company(ctx: &ReducerContext, company_id: u64) -> Result<(), String> {
    let company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;

    check_permission(ctx, company.organization_id, "company", "delete")?;

    ctx.db.company().id().update(Company {
        deleted_at: Some(ctx.timestamp),
        updated_at: ctx.timestamp,
        ..company
    });

    Ok(())
}
