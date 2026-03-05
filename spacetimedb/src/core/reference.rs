/// Reference / Seed Data
///
/// Tables:  Country · Currency · CurrencyRate · UOMCategory · UOM · UOMConversion
/// Pattern: Country and Currency are global (no organization_id); everything else
///          is scoped to an organization. Only superusers may manage global tables.
use spacetimedb::{ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::users::user_profile;
use crate::helpers::check_permission;

// ============================================================================
// PARAMS TYPES
// ============================================================================

/// Params for creating a country (superuser only).
/// Scope: `code` is a flat reducer param (PK / duplicate check).
/// `is_active` hardcoded in original — moved to params for configurability.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateCountryParams {
    pub name: String,
    pub iso3: String,
    pub numcode: u16,
    pub phone_code: String,
    pub official_name: Option<String>,
    pub currency_code: Option<String>,
    pub language_codes: Vec<String>,
    pub is_active: bool,
    pub metadata: Option<String>,
}

/// Params for creating a currency (superuser only).
/// Scope: `code` is a flat reducer param (PK / duplicate check).
/// `active` hardcoded in original — moved to params for configurability.
/// `created_at` is system-derived.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateCurrencyParams {
    pub name: String,
    pub symbol: String,
    pub decimal_places: u8,
    pub rounding_factor: f64,
    /// Symbol position relative to amount: `"before"` or `"after"`.
    pub position: String,
    pub active: bool,
    pub metadata: Option<String>,
}

/// Params for creating a currency rate.
/// Scope: `organization_id` + `company_id` are flat reducer params.
/// `inverse_rate`, `date`, `created_at` are system-derived.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateCurrencyRateParams {
    pub from_currency: String,
    pub to_currency: String,
    pub rate: f64,
    pub metadata: Option<String>,
}

/// Params for creating a UOM category.
/// Scope: `organization_id` is a flat reducer param.
/// `created_at` is system-derived.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateUomCategoryParams {
    pub name: String,
    pub description: Option<String>,
    pub sequence: u32,
    pub metadata: Option<String>,
}

/// Params for creating a unit of measure.
/// Scope: `organization_id` is a flat reducer param.
/// `is_active` hardcoded in original — moved to params.
/// `created_at` is system-derived.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateUomParams {
    pub category_id: u64,
    pub name: String,
    pub symbol: String,
    /// Conversion factor relative to the reference unit in this category.
    pub factor: f64,
    pub rounding: f64,
    pub times_bigger: f64,
    pub is_reference_unit: bool,
    pub is_active: bool,
    pub metadata: Option<String>,
}

/// Params for creating a UOM conversion.
/// Scope: `organization_id` + `category_id` are flat reducer params.
/// `is_active` hardcoded in original — moved to params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateUomConversionParams {
    pub from_uom_id: u64,
    pub to_uom_id: u64,
    pub factor: f64,
    pub product_id: Option<u64>, // None = applies to all products in category
    pub is_active: bool,
    pub metadata: Option<String>,
}

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(accessor = country, public)]
pub struct Country {
    #[primary_key]
    pub code: String, // ISO 3166-1 alpha-2
    pub name: String,
    pub official_name: Option<String>,
    pub iso3: String,
    pub numcode: u16,
    pub phone_code: String,
    pub currency_code: Option<String>,
    pub language_codes: Vec<String>,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[spacetimedb::table(accessor = currency, public)]
pub struct Currency {
    #[primary_key]
    pub code: String, // ISO 4217
    pub name: String,
    pub symbol: String,
    pub decimal_places: u8,
    pub rounding_factor: f64,
    pub active: bool,
    /// Symbol position relative to amount: `"before"` or `"after"`.
    pub position: String,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = currency_rate,
    public,
    index(accessor = rate_by_org, btree(columns = [organization_id]))
)]
pub struct CurrencyRate {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub from_currency: String,
    pub to_currency: String,
    pub rate: f64,
    pub inverse_rate: f64,
    pub date: Timestamp,
    pub company_id: Option<u64>,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = uom_cat,
    public,
    index(accessor = uom_cat_by_org, btree(columns = [organization_id]))
)]
pub struct UOMCategory {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub description: Option<String>,
    pub sequence: u32,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = uom,
    public,
    index(accessor = uom_by_org,      btree(columns = [organization_id])),
    index(accessor = uom_by_category, btree(columns = [category_id]))
)]
pub struct UOM {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub category_id: u64,
    pub name: String,
    pub symbol: String,
    /// Conversion factor relative to the reference unit in this category.
    pub factor: f64,
    pub rounding: f64,
    pub times_bigger: f64,
    pub is_reference_unit: bool,
    pub is_active: bool,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = uom_conversion,
    public,
    index(accessor = uom_conv_by_org, btree(columns = [organization_id]))
)]
pub struct UOMConversion {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub category_id: u64,
    pub from_uom_id: u64,
    pub to_uom_id: u64,
    pub factor: f64,
    pub product_id: Option<u64>, // None = applies to all products in category
    pub is_active: bool,
    pub metadata: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn require_superuser(ctx: &ReducerContext) -> Result<(), String> {
    let is_su = ctx
        .db
        .user_profile()
        .identity()
        .find(ctx.sender())
        .map(|u| u.is_superuser)
        .unwrap_or(false);

    if is_su {
        Ok(())
    } else {
        Err("Only superusers can manage global reference data".to_string())
    }
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn create_country(
    ctx: &ReducerContext,
    code: String,
    params: CreateCountryParams,
) -> Result<(), String> {
    require_superuser(ctx)?;

    if ctx.db.country().code().find(&code).is_some() {
        return Err(format!("Country '{}' already exists", code));
    }

    ctx.db.country().insert(Country {
        code,
        name: params.name,
        official_name: params.official_name,
        iso3: params.iso3,
        numcode: params.numcode,
        phone_code: params.phone_code,
        currency_code: params.currency_code,
        language_codes: params.language_codes,
        is_active: params.is_active,
        metadata: params.metadata,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_currency(
    ctx: &ReducerContext,
    code: String,
    params: CreateCurrencyParams,
) -> Result<(), String> {
    require_superuser(ctx)?;

    if ctx.db.currency().code().find(&code).is_some() {
        return Err(format!("Currency '{}' already exists", code));
    }

    if params.position != "before" && params.position != "after" {
        return Err("Position must be 'before' or 'after'".to_string());
    }

    ctx.db.currency().insert(Currency {
        code,
        name: params.name,
        symbol: params.symbol,
        decimal_places: params.decimal_places,
        rounding_factor: params.rounding_factor,
        active: params.active,
        position: params.position,
        // System-derived: creation timestamp
        created_at: ctx.timestamp,
        metadata: params.metadata,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_currency_rate(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    params: CreateCurrencyRateParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "currency_rate", "create")?;

    if params.rate <= 0.0 {
        return Err("Rate must be positive".to_string());
    }

    ctx.db.currency_rate().insert(CurrencyRate {
        id: 0,
        organization_id,
        from_currency: params.from_currency,
        to_currency: params.to_currency,
        rate: params.rate,
        // System-derived: inverse is always 1/rate
        inverse_rate: 1.0 / params.rate,
        date: ctx.timestamp,
        company_id,
        created_at: ctx.timestamp,
        metadata: params.metadata,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_uom_category(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateUomCategoryParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "uom_category", "create")?;

    ctx.db.uom_cat().insert(UOMCategory {
        id: 0,
        organization_id,
        name: params.name,
        description: params.description,
        sequence: params.sequence,
        // System-derived: creation timestamp
        created_at: ctx.timestamp,
        metadata: params.metadata,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_uom(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateUomParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "uom", "create")?;

    let category = ctx
        .db
        .uom_cat()
        .id()
        .find(&params.category_id)
        .ok_or("UOM category not found")?;

    if category.organization_id != organization_id {
        return Err("UOM category does not belong to this organization".to_string());
    }

    ctx.db.uom().insert(UOM {
        id: 0,
        organization_id,
        category_id: params.category_id,
        name: params.name,
        symbol: params.symbol,
        factor: params.factor,
        rounding: params.rounding,
        times_bigger: params.times_bigger,
        is_reference_unit: params.is_reference_unit,
        is_active: params.is_active,
        // System-derived: creation timestamp
        created_at: ctx.timestamp,
        metadata: params.metadata,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_uom_conversion(
    ctx: &ReducerContext,
    organization_id: u64,
    category_id: u64,
    params: CreateUomConversionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "uom_conversion", "create")?;

    if params.factor <= 0.0 {
        return Err("Conversion factor must be positive".to_string());
    }

    ctx.db.uom_conversion().insert(UOMConversion {
        id: 0,
        organization_id,
        category_id,
        from_uom_id: params.from_uom_id,
        to_uom_id: params.to_uom_id,
        factor: params.factor,
        product_id: params.product_id,
        is_active: params.is_active,
        metadata: params.metadata,
    });

    Ok(())
}
