/// Country / locale packs — jurisdiction rules live in pack tables, not core schemas.
///
/// Tables:
///   - `CountryPackDefinition` — global catalog (pack_key, country_code, region)
///   - `CountryPackTaxRule` — tax rules owned by a pack (not `AccountTax`)
///   - `CompanyCountryPack` — per-company activation + config
///
/// Enabling a pack materializes active pack tax rules into company `AccountTax` rows
/// (upsert by pack code metadata) so invoice posting uses live configurable tax — not
/// hard-coded legislation inside reducers.
use spacetimedb::{ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::tax_management::{account_tax, AccountTax};
use crate::core::organization::{company, require_company_in_organization};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::{TaxAmountType, TaxTypeUse};

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(accessor = country_pack_definition, public)]
pub struct CountryPackDefinition {
    #[primary_key]
    pub pack_key: String,
    pub country_code: String,
    pub name: String,
    pub region: String,
    pub version: String,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = country_pack_tax_rule,
    public,
    index(accessor = pack_tax_by_pack, btree(columns = [pack_key]))
)]
pub struct CountryPackTaxRule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub pack_key: String,
    pub code: String,
    pub name: String,
    pub rate: f64,
    pub tax_use: String,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = company_country_pack,
    public,
    index(accessor = company_country_pack_by_org, btree(columns = [organization_id])),
    index(accessor = company_country_pack_by_company, btree(columns = [company_id]))
)]
pub struct CompanyCountryPack {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub pack_key: String,
    pub enabled: bool,
    pub configuration: Option<String>,
    pub activated_at: Timestamp,
    pub updated_at: Timestamp,
    pub updated_by: spacetimedb::Identity,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct SetCompanyCountryPackParams {
    pub pack_key: String,
    pub enabled: bool,
    pub configuration: Option<String>,
}

// ── Seed helpers ─────────────────────────────────────────────────────────────

pub(crate) fn seed_country_pack_catalog(ctx: &ReducerContext) {
    let packs = [
        (
            "au",
            "AU",
            "Australia GST",
            "oceania",
            "1.0.0",
            r#"{"fiscal_year_start_month":7,"bas_reporting":true}"#,
        ),
        (
            "nz",
            "NZ",
            "New Zealand GST",
            "oceania",
            "1.0.0",
            r#"{"fiscal_year_start_month":4,"gst_rate":0.15}"#,
        ),
        (
            "za",
            "ZA",
            "South Africa VAT",
            "southern_africa",
            "1.0.0",
            r#"{"vat_rate":0.15,"currency":"ZAR"}"#,
        ),
        (
            "sg",
            "SG",
            "Singapore GST",
            "maritime_se_asia",
            "1.0.0",
            r#"{"gst_rate":0.09,"iras":true}"#,
        ),
    ];

    for (pack_key, country_code, name, region, version, metadata) in packs {
        if ctx
            .db
            .country_pack_definition()
            .pack_key()
            .find(&pack_key.to_string())
            .is_some()
        {
            continue;
        }
        ctx.db.country_pack_definition().insert(CountryPackDefinition {
            pack_key: pack_key.to_string(),
            country_code: country_code.to_string(),
            name: name.to_string(),
            region: region.to_string(),
            version: version.to_string(),
            is_active: true,
            metadata: Some(metadata.to_string()),
        });
    }

    let tax_rules = [
        ("au", "GST-AU", "GST 10%", 0.10, "sale"),
        ("nz", "GST-NZ", "GST 15%", 0.15, "sale"),
        ("za", "VAT-ZA", "VAT 15%", 0.15, "sale"),
        ("za", "WHT-ZA", "Withholding 20%", 0.20, "withholding"),
        ("sg", "GST-SG", "GST 9%", 0.09, "sale"),
        ("br", "ICMS-BR", "ICMS 18%", 0.18, "sale"),
        ("br", "IRRF-BR", "IRRF withholding 1.5%", 0.015, "withholding"),
        ("my", "SST-MY", "SST 6%", 0.06, "sale"),
        ("id", "PPN-ID", "PPN 11%", 0.11, "sale"),
        ("th", "VAT-TH", "VAT 7%", 0.07, "sale"),
        ("ph", "VAT-PH", "VAT 12%", 0.12, "sale"),
        ("ar", "IVA-AR", "IVA 21%", 0.21, "sale"),
        ("cl", "IVA-CL", "IVA 19%", 0.19, "sale"),
    ];

    // Southern Cone + Maritime SEA pack definitions (beyond AU/NZ/ZA/SG).
    let extra_packs = [
        (
            "br",
            "BR",
            "Brazil taxes",
            "southern_cone",
            "1.0.0",
            r#"{"nfe_adapter":true,"currency":"BRL","inflation_mode":"optional"}"#,
        ),
        (
            "ar",
            "AR",
            "Argentina IVA",
            "southern_cone",
            "1.0.0",
            r#"{"currency":"ARS","inflation_mode":"optional"}"#,
        ),
        (
            "cl",
            "CL",
            "Chile IVA",
            "southern_cone",
            "1.0.0",
            r#"{"currency":"CLP"}"#,
        ),
        (
            "my",
            "MY",
            "Malaysia SST",
            "maritime_se_asia",
            "1.0.0",
            r#"{"currency":"MYR","e_invoice":"peppol"}"#,
        ),
        (
            "id",
            "ID",
            "Indonesia PPN",
            "maritime_se_asia",
            "1.0.0",
            r#"{"currency":"IDR","e_invoice":"coretax"}"#,
        ),
        (
            "th",
            "TH",
            "Thailand VAT",
            "maritime_se_asia",
            "1.0.0",
            r#"{"currency":"THB"}"#,
        ),
        (
            "ph",
            "PH",
            "Philippines VAT",
            "maritime_se_asia",
            "1.0.0",
            r#"{"currency":"PHP"}"#,
        ),
    ];

    for (pack_key, country_code, name, region, version, metadata) in extra_packs {
        if ctx
            .db
            .country_pack_definition()
            .pack_key()
            .find(&pack_key.to_string())
            .is_some()
        {
            continue;
        }
        ctx.db.country_pack_definition().insert(CountryPackDefinition {
            pack_key: pack_key.to_string(),
            country_code: country_code.to_string(),
            name: name.to_string(),
            region: region.to_string(),
            version: version.to_string(),
            is_active: true,
            metadata: Some(metadata.to_string()),
        });
    }

    for (pack_key, code, name, rate, tax_use) in tax_rules {
        let exists = ctx
            .db
            .country_pack_tax_rule()
            .iter()
            .any(|r| r.pack_key == pack_key && r.code == code);
        if exists {
            continue;
        }
        ctx.db.country_pack_tax_rule().insert(CountryPackTaxRule {
            id: 0,
            pack_key: pack_key.to_string(),
            code: code.to_string(),
            name: name.to_string(),
            rate,
            tax_use: tax_use.to_string(),
            is_active: true,
            metadata: Some(format!(r#"{{"pack":"{pack_key}"}}"#)),
        });
    }
}

fn parse_pack_tax_use(raw: &str) -> TaxTypeUse {
    match raw.trim().to_lowercase().as_str() {
        "purchase" => TaxTypeUse::Purchase,
        "withholding" | "wht" => TaxTypeUse::Withholding,
        "none" => TaxTypeUse::None,
        _ => TaxTypeUse::Sale,
    }
}

/// Upsert pack tax rules into company `AccountTax` rows (keyed by pack code in metadata).
fn materialize_pack_taxes_for_company(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    pack_key: &str,
    country_code: &str,
    enabled: bool,
) {
    let rules: Vec<_> = ctx
        .db
        .country_pack_tax_rule()
        .pack_tax_by_pack()
        .filter(&pack_key.to_string())
        .filter(|r| r.is_active)
        .collect();

    for rule in rules {
        let meta_marker = format!(r#""pack_tax_code":"{}""#, rule.code);
        let existing = ctx
            .db
            .account_tax()
            .tax_by_company()
            .filter(&company_id)
            .find(|t| {
                t.organization_id == organization_id
                    && t.metadata
                        .as_ref()
                        .is_some_and(|m| m.contains(&meta_marker))
            });

        let metadata = Some(format!(
            r#"{{"pack":"{pack_key}","pack_tax_code":"{}"}}"#,
            rule.code
        ));
        // Pack rates are fractional (0.10); AccountTax.amount is percent points (10.0).
        let amount_percent = rule.rate * 100.0;

        if let Some(tax) = existing {
            ctx.db.account_tax().id().update(AccountTax {
                name: rule.name.clone(),
                amount: amount_percent,
                active: enabled && rule.is_active,
                type_tax_use: parse_pack_tax_use(&rule.tax_use),
                country_code: Some(country_code.to_string()),
                write_uid: Some(ctx.sender()),
                write_date: Some(ctx.timestamp),
                metadata,
                ..tax
            });
        } else if enabled {
            ctx.db.account_tax().insert(AccountTax {
                id: 0,
                organization_id,
                name: rule.name.clone(),
                description: Some(format!("Country pack {pack_key}")),
                type_tax_use: parse_pack_tax_use(&rule.tax_use),
                amount_type: TaxAmountType::Percent,
                amount: amount_percent,
                active: true,
                price_include: false,
                include_base_amount: false,
                is_base_affected: false,
                sequence: 10,
                company_id,
                tax_group_id: None,
                country_id: None,
                country_code: Some(country_code.to_string()),
                tags: vec![],
                has_negative_factor: false,
                invoice_repartition_line_ids: vec![],
                refund_repartition_line_ids: vec![],
                create_uid: Some(ctx.sender()),
                create_date: Some(ctx.timestamp),
                write_uid: Some(ctx.sender()),
                write_date: Some(ctx.timestamp),
                metadata,
            });
        }
    }
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Enable or disable a locale pack for a company. Pack tax rules remain in pack tables.
#[spacetimedb::reducer]
pub fn set_company_country_pack(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: SetCompanyCountryPackParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "company", "write")?;
    require_company_in_organization(ctx, organization_id, company_id)?;

    let pack_key = params.pack_key.trim().to_lowercase();
    if pack_key.is_empty() {
        return Err("pack_key cannot be empty".to_string());
    }

    let definition = ctx
        .db
        .country_pack_definition()
        .pack_key()
        .find(&pack_key)
        .ok_or("Unknown country pack")?;

    if !definition.is_active {
        return Err("Country pack is not active".to_string());
    }

    let company_row = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;

    let existing = ctx
        .db
        .company_country_pack()
        .company_country_pack_by_company()
        .filter(&company_id)
        .find(|row| row.pack_key == pack_key);

    let record_id = if let Some(row) = existing {
        let id = row.id;
        ctx.db.company_country_pack().id().update(CompanyCountryPack {
            enabled: params.enabled,
            configuration: params.configuration.clone(),
            updated_at: ctx.timestamp,
            updated_by: ctx.sender(),
            ..row
        });
        id
    } else {
        let inserted = ctx.db.company_country_pack().insert(CompanyCountryPack {
            id: 0,
            organization_id,
            company_id,
            pack_key: pack_key.clone(),
            enabled: params.enabled,
            configuration: params.configuration.clone(),
            activated_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            updated_by: ctx.sender(),
        });
        inserted.id
    };

    materialize_pack_taxes_for_company(
        ctx,
        organization_id,
        company_id,
        &pack_key,
        &definition.country_code,
        params.enabled,
    );

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "company_country_pack",
            record_id,
            action: if params.enabled {
                "SET_ACTIVE"
            } else {
                "SET_INACTIVE"
            },
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "pack_key": pack_key,
                    "enabled": params.enabled,
                    "country_code": definition.country_code,
                    "company_country_code": company_row.address_country_code,
                    "taxes_materialized": true,
                })
                .to_string(),
            ),
            changed_fields: vec!["pack_key".to_string(), "enabled".to_string()],
            metadata: params.configuration.clone(),
        },
    );

    Ok(())
}
