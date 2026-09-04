/// Reference / Seed Data
///
/// Tables:  Country · Currency · CurrencyRate · UOMCategory · UOM · UOMConversion
/// Pattern: Country and Currency are organization-seeded reference rows.  The
/// organization scope is persisted directly on every row; callers must resolve
/// it from authenticated context rather than supplying a writable tenant field.
use spacetimedb::{ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::company;
use crate::core::users::user_profile;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

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
    pub currency_id: Option<u64>,
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
    pub from_currency_id: u64,
    pub to_currency_id: u64,
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

#[spacetimedb::table(
    accessor = country,
    public,
    index(accessor = country_by_organization, btree(columns = [organization_id]))
)]
pub struct Country {
    #[primary_key]
    /// Organization-qualified key. `code` remains the business value exposed
    /// to callers, while this key enforces uniqueness within an organization.
    pub organization_code_key: String,
    #[index(btree)]
    pub code: String, // ISO 3166-1 alpha-2
    pub organization_id: u64,
    pub name: String,
    pub official_name: Option<String>,
    pub iso3: String,
    pub numcode: u16,
    pub phone_code: String,
    pub currency_id: Option<u64>,
    pub language_codes: Vec<String>,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = currency,
    public,
    index(accessor = currency_by_organization, btree(columns = [organization_id]))
)]
pub struct Currency {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub code: String, // ISO 4217
    /// Organization-qualified business key; the unique constraint is tenant-local.
    #[unique]
    pub organization_code_key: String,
    pub organization_id: u64,
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
    pub from_currency_id: u64,
    pub to_currency_id: u64,
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

/// Document Sequence — organization-owned counters for human-readable document numbers.
///
/// Each `(organization_id, doc_type)` key (e.g. `SO`, `PO`, `INV`, `BILL`, `JRNL`)
/// tracks its own counter. Use `next_doc_number(ctx, organization_id, "SO")` from
/// `helpers` to atomically read and bump the counter.
#[spacetimedb::table(
    accessor = document_sequence,
    public,
    index(
        accessor = document_sequence_by_organization_and_type,
        btree(columns = [organization_id, doc_type])
    )
)]
pub struct DocumentSequence {
    #[primary_key]
    /// Tenant-aware business key (`{organization_id}:{doc_type}`).
    pub sequence_key: String,
    #[index(btree)]
    pub organization_id: u64,
    pub doc_type: String, // "SO" | "PO" | "INV" | "BILL" | "JRNL"
    pub next_number: u64,
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
        Err("Only superusers can manage organization reference data".to_string())
    }
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn create_country(
    ctx: &ReducerContext,
    organization_id: u64,
    code: String,
    params: CreateCountryParams,
) -> Result<(), String> {
    require_superuser(ctx)?;
    check_permission(ctx, organization_id, "country", "create")?;

    let organization_code_key = format!("{organization_id}:{code}");
    if ctx
        .db
        .country()
        .organization_code_key()
        .find(&organization_code_key)
        .is_some()
    {
        return Err(format!("Country '{}' already exists", code));
    }
    if let Some(currency_id) = params.currency_id {
        let currency = require_active_currency_by_id(ctx, currency_id)?;
        if currency.organization_id != organization_id {
            return Err("Currency does not belong to this organization".to_string());
        }
    }

    ctx.db.country().insert(Country {
        organization_code_key,
        code: code.clone(),
        organization_id,
        name: params.name.clone(),
        official_name: params.official_name,
        iso3: params.iso3,
        numcode: params.numcode,
        phone_code: params.phone_code,
        currency_id: params.currency_id,
        language_codes: params.language_codes,
        is_active: params.is_active,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "country",
            record_id: 0,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "code": code, "name": params.name }).to_string()),
            changed_fields: vec!["code".to_string(), "name".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_currency(
    ctx: &ReducerContext,
    organization_id: u64,
    code: String,
    params: CreateCurrencyParams,
) -> Result<(), String> {
    require_superuser(ctx)?;
    check_permission(ctx, organization_id, "currency", "create")?;

    let normalized_code = code.trim().to_uppercase();
    if normalized_code.is_empty() {
        return Err("Currency code cannot be empty".to_string());
    }
    let organization_code_key = format!("{organization_id}:{normalized_code}");
    if ctx
        .db
        .currency()
        .organization_code_key()
        .find(&organization_code_key)
        .is_some()
    {
        return Err(format!("Currency '{}' already exists", normalized_code));
    }
    if params.position != "before" && params.position != "after" {
        return Err("Position must be 'before' or 'after'".to_string());
    }

    ctx.db.currency().insert(Currency {
        id: 0,
        code: normalized_code.clone(),
        organization_code_key,
        organization_id,
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

    if !params.rate.is_finite() || params.rate <= 0.0 {
        return Err("Rate must be positive".to_string());
    }
    if params.from_currency_id == params.to_currency_id {
        return Err("Rate currencies must be different".to_string());
    }
    require_active_currency_for_organization(ctx, organization_id, params.from_currency_id)?;
    require_active_currency_for_organization(ctx, organization_id, params.to_currency_id)?;
    if let Some(company_id) = company_id {
        let company = ctx
            .db
            .company()
            .id()
            .find(&company_id)
            .ok_or("Company not found for currency rate")?;
        if company.organization_id != organization_id {
            return Err("Company does not belong to this organization".to_string());
        }
    }

    ctx.db.currency_rate().insert(CurrencyRate {
        id: 0,
        organization_id,
        from_currency_id: params.from_currency_id,
        to_currency_id: params.to_currency_id,
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

/// Convert `qty` from `from_uom_id` into `to_uom_id`.
///
/// Resolution order:
/// 1. Identity (same UoM)
/// 2. Active `uom_conversion` row (product-specific, then category-wide)
/// 3. Inverse of (2)
/// 4. Same-category `UOM.factor` ratio (relative to category reference)
pub(crate) fn convert_uom_quantity(
    ctx: &ReducerContext,
    organization_id: u64,
    from_uom_id: u64,
    to_uom_id: u64,
    qty: f64,
    product_id: Option<u64>,
) -> Result<f64, String> {
    if qty == 0.0 || from_uom_id == to_uom_id {
        return Ok(qty);
    }
    if qty < 0.0 {
        return Err("Quantity for UoM conversion cannot be negative".to_string());
    }

    let from = ctx
        .db
        .uom()
        .id()
        .find(&from_uom_id)
        .ok_or_else(|| format!("UoM {from_uom_id} not found"))?;
    let to = ctx
        .db
        .uom()
        .id()
        .find(&to_uom_id)
        .ok_or_else(|| format!("UoM {to_uom_id} not found"))?;
    if from.organization_id != organization_id || to.organization_id != organization_id {
        return Err("UoM does not belong to this organization".to_string());
    }
    if !from.is_active || !to.is_active {
        return Err("Cannot convert using inactive UoM".to_string());
    }

    let mut candidates: Vec<UOMConversion> = ctx
        .db
        .uom_conversion()
        .uom_conv_by_org()
        .filter(&organization_id)
        .filter(|c| c.is_active)
        .collect();
    // Prefer product-specific conversions over category-wide rows.
    candidates.sort_by_key(|c| if c.product_id == product_id { 0u8 } else { 1u8 });

    for c in &candidates {
        if c.product_id.is_some() && c.product_id != product_id {
            continue;
        }
        if c.from_uom_id == from_uom_id && c.to_uom_id == to_uom_id && c.factor > 0.0 {
            return Ok(apply_uom_rounding(qty * c.factor, to.rounding));
        }
        if c.from_uom_id == to_uom_id && c.to_uom_id == from_uom_id && c.factor > 0.0 {
            return Ok(apply_uom_rounding(qty / c.factor, to.rounding));
        }
    }

    if from.category_id == to.category_id && from.factor > 0.0 && to.factor > 0.0 {
        let ref_qty = qty * from.factor;
        return Ok(apply_uom_rounding(ref_qty / to.factor, to.rounding));
    }

    Err(format!(
        "No UoM conversion from {} to {} (product {:?})",
        from_uom_id, to_uom_id, product_id
    ))
}

fn apply_uom_rounding(qty: f64, rounding: f64) -> f64 {
    if rounding <= 0.0 {
        qty
    } else {
        (qty / rounding).round() * rounding
    }
}

// ── Currency relation helpers ────────────────────────────────────────────────

pub(crate) fn require_currency_by_id(
    ctx: &ReducerContext,
    currency_id: u64,
) -> Result<Currency, String> {
    ctx.db
        .currency()
        .id()
        .find(&currency_id)
        .ok_or_else(|| format!("Currency ID '{}' was not found", currency_id))
}

/// Resolves a currency for a new write and rejects inactive catalog rows.
pub(crate) fn require_active_currency_by_id(
    ctx: &ReducerContext,
    currency_id: u64,
) -> Result<Currency, String> {
    let currency = require_currency_by_id(ctx, currency_id)?;
    if !currency.active {
        return Err(format!("Currency '{}' is inactive", currency.code));
    }
    Ok(currency)
}

/// Resolve an active currency and prove that it belongs to the requested
/// organization before a tenant-owned row can reference it.
pub(crate) fn require_active_currency_for_organization(
    ctx: &ReducerContext,
    organization_id: u64,
    currency_id: u64,
) -> Result<Currency, String> {
    let currency = require_active_currency_by_id(ctx, currency_id)?;
    if currency.organization_id != organization_id {
        return Err("Currency does not belong to this organization".to_string());
    }
    Ok(currency)
}

/// Seed one of the supported onboarding currencies into a newly-created
/// organization.  Bootstrap runs before the caller has an organization
/// membership, so this internal path intentionally bypasses the superuser
/// reducer guard while keeping ownership server-derived from `organization_id`.
pub(crate) fn seed_currency_for_organization(
    ctx: &ReducerContext,
    organization_id: u64,
    code: &str,
) -> Result<Currency, String> {
    let normalized = code.trim().to_uppercase();
    let (name, symbol, decimal_places, rounding_factor) = match normalized.as_str() {
        "USD" => ("US Dollar", "$", 2, 0.01),
        "EUR" => ("Euro", "€", 2, 0.01),
        "GBP" => ("British Pound", "£", 2, 0.01),
        "CAD" => ("Canadian Dollar", "C$", 2, 0.01),
        "AUD" => ("Australian Dollar", "A$", 2, 0.01),
        "JPY" => ("Japanese Yen", "¥", 0, 1.0),
        _ => return Err(format!("Unsupported onboarding currency '{normalized}'")),
    };
    let organization_code_key = format!("{organization_id}:{normalized}");
    if let Some(existing) = ctx
        .db
        .currency()
        .organization_code_key()
        .find(&organization_code_key)
    {
        if !existing.active {
            return Err(format!("Currency '{}' is inactive", existing.code));
        }
        return Ok(existing);
    }

    Ok(ctx.db.currency().insert(Currency {
        id: 0,
        code: normalized,
        organization_code_key,
        organization_id,
        name: name.to_string(),
        symbol: symbol.to_string(),
        decimal_places,
        rounding_factor,
        active: true,
        position: "before".to_string(),
        created_at: ctx.timestamp,
        metadata: Some("{\"seed\":\"bootstrap\"}".to_string()),
    }))
}

/// Resolves a global `Currency` row by ISO 4217 code (case-insensitive).
pub(crate) fn require_currency_row(
    ctx: &ReducerContext,
    organization_id: u64,
    code: &str,
) -> Result<Currency, String> {
    let normalized = code.trim().to_uppercase();
    if normalized.is_empty() {
        return Err("Currency code cannot be empty".to_string());
    }
    ctx.db
        .currency()
        .iter()
        .find(|currency| {
            currency.organization_id == organization_id && currency.code == normalized
        })
        .ok_or_else(|| {
        format!(
            "Currency '{}' is not in this organization's currency table. Seed currencies before tenant bootstrap.",
            normalized
        )
    })
}

/// Resolves the applicable FX rate at a business timestamp.
///
/// Company-specific rates take precedence over organization-wide rates. Within
/// each scope, the newest rate whose date is not after `as_of` wins.
pub(crate) fn resolve_currency_rate_as_of(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    from_currency_id: u64,
    to_currency_id: u64,
    as_of: Timestamp,
) -> Result<f64, String> {
    if from_currency_id == to_currency_id {
        return Ok(1.0);
    }

    let from = require_currency_by_id(ctx, from_currency_id)?;
    let to = require_currency_by_id(ctx, to_currency_id)?;
    let mut company_rate: Option<(Timestamp, f64)> = None;
    let mut global_rate: Option<(Timestamp, f64)> = None;

    for rate in ctx
        .db
        .currency_rate()
        .rate_by_org()
        .filter(&organization_id)
    {
        if rate.from_currency_id != from_currency_id
            || rate.to_currency_id != to_currency_id
            || rate.date > as_of
        {
            continue;
        }

        let candidate = match rate.company_id {
            Some(id) if id == company_id => &mut company_rate,
            None => &mut global_rate,
            Some(_) => continue,
        };
        if candidate.as_ref().is_none_or(|(date, _)| rate.date > *date) {
            *candidate = Some((rate.date, rate.rate));
        }
    }

    let rate = company_rate
        .or(global_rate)
        .map(|(_, rate)| rate)
        .ok_or_else(|| {
            format!(
                "No exchange rate for {} → {} (company {}) at the requested time",
                from.code, to.code, company_id
            )
        })?;
    if !rate.is_finite() || rate <= 0.0 {
        return Err("Exchange rate must be positive".to_string());
    }
    Ok(rate)
}
