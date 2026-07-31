/// Core CSV Imports — Country, Currency, CurrencyRate, UOMCategory, UOM, Company, Role
use spacetimedb::{ReducerContext, Table};

use crate::core::organization::{company, new_external_id, Company};
use crate::core::permissions::{role, Role};
use crate::core::reference::{
    country, currency, currency_rate, require_active_currency_by_id, require_currency_row, uom,
    uom_cat, Country, Currency, CurrencyRate, UOMCategory, UOM,
};
use crate::data_ops::helpers::*;
use crate::data_ops::import_tracker::{begin_import_job, finish_import_job, record_import_error};
use crate::helpers::check_permission;

// ── Country ───────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_country_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "country", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "country", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let code = col(&headers, row, "code").to_uppercase();
        let name = col(&headers, row, "name").to_string();

        if code.len() != 2 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("code"),
                Some(&code),
                "code must be 2 chars",
            );
            errors += 1;
            continue;
        }
        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        if ctx.db.country().code().find(&code).is_some() {
            // upsert: skip existing
            imported += 1;
            continue;
        }

        let currency_code = opt_str(col(&headers, row, "currency_code"));
        let currency_id = match currency_code.as_deref() {
            Some(code) => match require_currency_row(ctx, code)
                .and_then(|currency| require_active_currency_by_id(ctx, currency.id))
            {
                Ok(currency) => Some(currency.id),
                Err(error) => {
                    record_import_error(
                        ctx,
                        job.id,
                        row_num,
                        Some("currency_code"),
                        Some(code),
                        &error,
                    );
                    errors += 1;
                    continue;
                }
            },
            None => None,
        };

        ctx.db.country().insert(Country {
            code,
            name,
            official_name: opt_str(col(&headers, row, "official_name")),
            iso3: col(&headers, row, "iso3").to_string(),
            numcode: col(&headers, row, "numcode").parse().unwrap_or(0),
            phone_code: col(&headers, row, "phone_code").to_string(),
            currency_id,
            language_codes: vec_str(col(&headers, row, "language_codes")),
            is_active: true,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!("Import country: imported={}, errors={}", imported, errors);
    Ok(())
}

// ── Currency ──────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_currency_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "currency", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "currency", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let code = col(&headers, row, "code").to_uppercase();
        let name = col(&headers, row, "name").to_string();
        let symbol = col(&headers, row, "symbol").to_string();

        if code.is_empty() || name.is_empty() {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("code"),
                Some(&code),
                "code and name are required",
            );
            errors += 1;
            continue;
        }

        if ctx.db.currency().code().find(&code).is_some() {
            imported += 1;
            continue;
        }

        let position = {
            let p = col(&headers, row, "position");
            if p == "after" {
                "after".to_string()
            } else {
                "before".to_string()
            }
        };

        ctx.db.currency().insert(Currency {
            id: 0,
            code: code.clone(),
            name,
            symbol: if symbol.is_empty() {
                "?".to_string()
            } else {
                symbol
            },
            decimal_places: parse_u8(col(&headers, row, "decimal_places")).max(0),
            rounding_factor: parse_f64(col(&headers, row, "rounding_factor")),
            active: parse_bool(col(&headers, row, "active")),
            position,
            created_at: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!("Import currency: imported={}, errors={}", imported, errors);
    Ok(())
}

// ── CurrencyRate ──────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_currency_rate_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "currency_rate", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "currency_rate",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let from_currency = col(&headers, row, "from_currency").to_uppercase();
        let to_currency = col(&headers, row, "to_currency").to_uppercase();
        let rate = parse_f64(col(&headers, row, "rate"));

        if !rate.is_finite() || rate <= 0.0 {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("rate"),
                Some(&rate.to_string()),
                "rate must be positive",
            );
            errors += 1;
            continue;
        }

        let from_currency_id = match require_currency_row(ctx, &from_currency)
            .and_then(|currency| require_active_currency_by_id(ctx, currency.id))
        {
            Ok(currency) => currency.id,
            Err(error) => {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("from_currency"),
                    Some(&from_currency),
                    &error,
                );
                errors += 1;
                continue;
            }
        };
        let to_currency_id = match require_currency_row(ctx, &to_currency)
            .and_then(|currency| require_active_currency_by_id(ctx, currency.id))
        {
            Ok(currency) => currency.id,
            Err(error) => {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("to_currency"),
                    Some(&to_currency),
                    &error,
                );
                errors += 1;
                continue;
            }
        };
        if from_currency_id == to_currency_id {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("to_currency"),
                Some(&to_currency),
                "rate currencies must be different",
            );
            errors += 1;
            continue;
        }
        let company_id = opt_u64(col(&headers, row, "company_id"));
        if let Some(company_id) = company_id {
            let valid_scope = ctx
                .db
                .company()
                .id()
                .find(&company_id)
                .is_some_and(|company| company.organization_id == organization_id);
            if !valid_scope {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("company_id"),
                    Some(&company_id.to_string()),
                    "company does not belong to this organization",
                );
                errors += 1;
                continue;
            }
        }

        ctx.db.currency_rate().insert(CurrencyRate {
            id: 0,
            organization_id,
            from_currency_id,
            to_currency_id,
            rate,
            inverse_rate: 1.0 / rate,
            date: opt_timestamp(col(&headers, row, "date")).unwrap_or(ctx.timestamp),
            company_id,
            created_at: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import currency_rate: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── UOMCategory ───────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_uom_category_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "uom_category", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "uom_category",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        ctx.db.uom_cat().insert(UOMCategory {
            id: 0,
            organization_id,
            name,
            description: opt_str(col(&headers, row, "description")),
            sequence: parse_u32(col(&headers, row, "sequence")),
            created_at: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import uom_category: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── UOM ───────────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_uom_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "uom", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "uom", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();
        let category_id = parse_u64(col(&headers, row, "category_id"));

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        ctx.db.uom().insert(UOM {
            id: 0,
            organization_id,
            category_id,
            name,
            symbol: col(&headers, row, "symbol").to_string(),
            factor: parse_f64(col(&headers, row, "factor")),
            rounding: parse_f64(col(&headers, row, "rounding")),
            times_bigger: parse_f64(col(&headers, row, "times_bigger")),
            is_reference_unit: parse_bool(col(&headers, row, "is_reference_unit")),
            is_active: parse_bool(col(&headers, row, "active")),
            created_at: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!("Import uom: imported={}, errors={}", imported, errors);
    Ok(())
}

// ── Company ───────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_company_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "company", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "company", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();
        let code = col(&headers, row, "code").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        ctx.db.company().insert(Company {
            id: 0,
            external_id: new_external_id(ctx),
            organization_id,
            name,
            code: if code.is_empty() {
                "CO".to_string()
            } else {
                code
            },
            is_parent: parse_bool(col(&headers, row, "is_parent")),
            parent_id: opt_u64(col(&headers, row, "parent_id")),
            currency_id: parse_u64(col(&headers, row, "currency_id")),
            fiscal_year_end_month: parse_u8(col(&headers, row, "fiscal_year_end_month"))
                .max(1)
                .min(12),
            fiscal_year_end_day: parse_u8(col(&headers, row, "fiscal_year_end_day"))
                .max(1)
                .min(31),
            tax_id: opt_str(col(&headers, row, "tax_id")),
            company_registry: opt_str(col(&headers, row, "company_registry")),
            address_street: opt_str(col(&headers, row, "address_street")),
            address_city: opt_str(col(&headers, row, "address_city")),
            address_zip: opt_str(col(&headers, row, "address_zip")),
            address_country_code: opt_str(col(&headers, row, "address_country_code")),
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            deleted_at: None,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!("Import company: imported={}, errors={}", imported, errors);
    Ok(())
}

// ── Role ─────────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_role_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "role", "create")?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "role", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        ctx.db.role().insert(Role {
            id: 0,
            organization_id,
            name,
            description: opt_str(col(&headers, row, "description")),
            parent_id: opt_u64(col(&headers, row, "parent_id")),
            permissions: vec_str(col(&headers, row, "permissions")),
            is_system: parse_bool(col(&headers, row, "is_system")),
            is_active: true,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!("Import role: imported={}, errors={}", imported, errors);
    Ok(())
}
