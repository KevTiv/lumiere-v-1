/// Reference / Seed Data
///
/// Tables:  Country · Currency · CurrencyRate · UOMCategory · UOM · UOMConversion
/// Pattern: Country and Currency are global (no organization_id); everything else
///          is scoped to an organization. Only superusers may manage global tables.
use spacetimedb::{ReducerContext, Table, Timestamp};

use crate::helpers::check_permission;

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
    index(name = "rate_by_org", btree(columns = [organization_id]))
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
    accessor = uom_category,
    public,
    index(name = "uom_cat_by_org", btree(columns = [organization_id]))
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
    index(name = "uom_by_org",      btree(columns = [organization_id])),
    index(name = "uom_by_category", btree(columns = [category_id]))
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
    index(name = "uom_conv_by_org", btree(columns = [organization_id]))
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
    name: String,
    iso3: String,
    numcode: u16,
    phone_code: String,
    official_name: Option<String>,
    currency_code: Option<String>,
    language_codes: Vec<String>,
) -> Result<(), String> {
    require_superuser(ctx)?;

    if ctx.db.country().code().find(&code).is_some() {
        return Err(format!("Country '{}' already exists", code));
    }

    ctx.db.country().insert(Country {
        code,
        name,
        official_name,
        iso3,
        numcode,
        phone_code,
        currency_code,
        language_codes,
        is_active: true,
        metadata: None,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_currency(
    ctx: &ReducerContext,
    code: String,
    name: String,
    symbol: String,
    decimal_places: u8,
    rounding_factor: f64,
    position: String,
) -> Result<(), String> {
    require_superuser(ctx)?;

    if ctx.db.currency().code().find(&code).is_some() {
        return Err(format!("Currency '{}' already exists", code));
    }

    if position != "before" && position != "after" {
        return Err("Position must be 'before' or 'after'".to_string());
    }

    ctx.db.currency().insert(Currency {
        code,
        name,
        symbol,
        decimal_places,
        rounding_factor,
        active: true,
        position,
        created_at: ctx.timestamp,
        metadata: None,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_currency_rate(
    ctx: &ReducerContext,
    organization_id: u64,
    from_currency: String,
    to_currency: String,
    rate: f64,
    company_id: Option<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "currency_rate", "create")?;

    if rate <= 0.0 {
        return Err("Rate must be positive".to_string());
    }

    ctx.db.currency_rate().insert(CurrencyRate {
        id: 0,
        organization_id,
        from_currency,
        to_currency,
        rate,
        inverse_rate: 1.0 / rate,
        date: ctx.timestamp,
        company_id,
        created_at: ctx.timestamp,
        metadata: None,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_uom_category(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    description: Option<String>,
    sequence: u32,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "uom_category", "create")?;

    ctx.db.uom_category().insert(UOMCategory {
        id: 0,
        organization_id,
        name,
        description,
        sequence,
        created_at: ctx.timestamp,
        metadata: None,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_uom(
    ctx: &ReducerContext,
    organization_id: u64,
    category_id: u64,
    name: String,
    symbol: String,
    factor: f64,
    rounding: f64,
    times_bigger: f64,
    is_reference_unit: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "uom", "create")?;

    let category = ctx
        .db
        .uom_category()
        .id()
        .find(&category_id)
        .ok_or("UOM category not found")?;

    if category.organization_id != organization_id {
        return Err("UOM category does not belong to this organization".to_string());
    }

    ctx.db.uom().insert(UOM {
        id: 0,
        organization_id,
        category_id,
        name,
        symbol,
        factor,
        rounding,
        times_bigger,
        is_reference_unit,
        is_active: true,
        created_at: ctx.timestamp,
        metadata: None,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_uom_conversion(
    ctx: &ReducerContext,
    organization_id: u64,
    category_id: u64,
    from_uom_id: u64,
    to_uom_id: u64,
    factor: f64,
    product_id: Option<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "uom_conversion", "create")?;

    if factor <= 0.0 {
        return Err("Conversion factor must be positive".to_string());
    }

    ctx.db.uom_conversion().insert(UOMConversion {
        id: 0,
        organization_id,
        category_id,
        from_uom_id,
        to_uom_id,
        factor,
        product_id,
        is_active: true,
        metadata: None,
    });

    Ok(())
}
