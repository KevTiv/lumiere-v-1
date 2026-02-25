/// Organization & Multi-Tenancy
///
/// Tables:  Organization · OrganizationSettings · Company
/// Pattern: every table row carries `organization_id` for tenant isolation.
///          Companies are sub-units within an Organization.
use spacetimedb::{ReducerContext, Table, Timestamp};

use crate::helpers::check_permission;

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
    pub organization_id: u64,
    pub module_config: Option<String>,  // JSON
    pub feature_flags: Vec<String>,
    pub integration_keys: Option<String>, // JSON (store references, not raw secrets)
    pub updated_at: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = company,
    public,
    index(name = "company_by_org", btree(columns = [organization_id]))
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
/// user can create an org (they become its first admin via `add_user_to_organization`).
#[spacetimedb::reducer]
pub fn create_organization(
    ctx: &ReducerContext,
    name: String,
    code: String,
    timezone: String,
    date_format: String,
    language: String,
) -> Result<(), String> {
    if name.is_empty() {
        return Err("Organization name cannot be empty".to_string());
    }
    if code.is_empty() {
        return Err("Organization code cannot be empty".to_string());
    }

    ctx.db.organization().insert(Organization {
        id: 0,
        name,
        code,
        description: None,
        logo_url: None,
        website: None,
        email: None,
        phone: None,
        currency_id: None,
        timezone,
        date_format,
        language,
        is_active: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: None,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_organization(
    ctx: &ReducerContext,
    organization_id: u64,
    name: Option<String>,
    description: Option<String>,
    logo_url: Option<String>,
    website: Option<String>,
    email: Option<String>,
    phone: Option<String>,
    currency_id: Option<u64>,
    timezone: Option<String>,
    date_format: Option<String>,
    language: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "organization", "write")?;

    let org = ctx
        .db
        .organization()
        .id()
        .find(&organization_id)
        .ok_or("Organization not found")?;

    ctx.db.organization().id().update(Organization {
        name: name.unwrap_or(org.name),
        description: description.or(org.description),
        logo_url: logo_url.or(org.logo_url),
        website: website.or(org.website),
        email: email.or(org.email),
        phone: phone.or(org.phone),
        currency_id: currency_id.or(org.currency_id),
        timezone: timezone.unwrap_or(org.timezone),
        date_format: date_format.unwrap_or(org.date_format),
        language: language.unwrap_or(org.language),
        updated_at: ctx.timestamp,
        ..org
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn upsert_organization_settings(
    ctx: &ReducerContext,
    organization_id: u64,
    module_config: Option<String>,
    feature_flags: Vec<String>,
    integration_keys: Option<String>,
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
                    module_config: module_config.or(existing.module_config),
                    feature_flags,
                    integration_keys: integration_keys.or(existing.integration_keys),
                    updated_at: ctx.timestamp,
                    ..existing
                });
        }
        None => {
            ctx.db.organization_settings().insert(OrganizationSettings {
                organization_id,
                module_config,
                feature_flags,
                integration_keys,
                updated_at: ctx.timestamp,
                metadata: None,
            });
        }
    }

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_company(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    code: String,
    currency_id: u64,
    fiscal_year_end_month: u8,
    fiscal_year_end_day: u8,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "company", "create")?;

    if name.is_empty() {
        return Err("Company name cannot be empty".to_string());
    }

    ctx.db.company().insert(Company {
        id: 0,
        organization_id,
        name,
        code,
        is_parent: false,
        parent_id: None,
        currency_id,
        fiscal_year_end_month,
        fiscal_year_end_day,
        tax_id: None,
        company_registry: None,
        address_street: None,
        address_city: None,
        address_zip: None,
        address_country_code: None,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        deleted_at: None,
        metadata: None,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_company(
    ctx: &ReducerContext,
    company_id: u64,
    name: Option<String>,
    tax_id: Option<String>,
    address_street: Option<String>,
    address_city: Option<String>,
    address_zip: Option<String>,
    address_country_code: Option<String>,
) -> Result<(), String> {
    let company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;

    check_permission(ctx, company.organization_id, "company", "write")?;

    ctx.db.company().id().update(Company {
        name: name.unwrap_or(company.name),
        tax_id: tax_id.or(company.tax_id),
        address_street: address_street.or(company.address_street),
        address_city: address_city.or(company.address_city),
        address_zip: address_zip.or(company.address_zip),
        address_country_code: address_country_code.or(company.address_country_code),
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
