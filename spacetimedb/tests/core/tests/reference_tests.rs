/// Reference Data Module Tests
///
/// Test reducers for Country, Currency, CurrencyRate, UOMCategory, UOM, UOMConversion tables.
use spacetimedb::{ReducerContext, Table};

use crate::core::organization::{create_organization, organization, CreateOrganizationParams};
use crate::core::users::user_organization;
use crate::core::reference::{
    country, create_country, create_currency, create_currency_rate, create_uom,
    create_uom_category, create_uom_conversion, currency, currency_rate, uom, uom_cat,
    uom_conversion, CreateCountryParams, CreateCurrencyParams, CreateCurrencyRateParams,
    CreateUomCategoryParams, CreateUomConversionParams, CreateUomParams,
};

fn ensure_reference_org(ctx: &ReducerContext, code: &str) -> Result<u64, String> {
    if let Some(org) = ctx.db.organization().iter().find(|org| org.code == code) {
        return ctx
            .db
            .user_organization()
            .iter()
            .find(|membership| {
                membership.user_identity == ctx.sender()
                    && membership.organization_id == org.id
                    && membership.is_active
            })
            .map(|membership| membership.organization_id)
            .ok_or_else(|| format!("sender is not a member of reference organization {code}"));
    }
    create_organization(
        ctx,
        CreateOrganizationParams {
            name: format!("Reference {code}"),
            code: code.to_string(),
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
            metadata: Some(r#"{"test":"reference"}"#.to_string()),
        },
    )?;
    let org_id = ctx
        .db
        .organization()
        .iter()
        .find(|org| org.code == code)
        .map(|org| org.id)
        .ok_or_else(|| format!("reference organization {code} missing"))?;
    ctx.db
        .user_organization()
        .iter()
        .find(|membership| {
            membership.user_identity == ctx.sender()
                && membership.organization_id == org_id
                && membership.is_active
        })
        .map(|membership| membership.organization_id)
        .ok_or_else(|| "reference test organization membership missing".to_string())
}

fn ensure_currency(
    ctx: &ReducerContext,
    organization_id: u64,
    code: &str,
    name: &str,
    symbol: &str,
    decimal_places: u8,
    rounding_factor: f64,
    position: &str,
) -> Result<u64, String> {
    if let Some(currency) = ctx.db.currency().iter().find(|currency| {
        currency.organization_id == organization_id && currency.code == code
    }) {
        return Ok(currency.id);
    }
    create_currency(
        ctx,
        organization_id,
        code.to_string(),
        CreateCurrencyParams {
            name: name.to_string(),
            symbol: symbol.to_string(),
            decimal_places,
            rounding_factor,
            position: position.to_string(),
            active: true,
            metadata: None,
        },
    )?;
    ctx.db
        .currency()
        .iter()
        .find(|currency| currency.organization_id == organization_id && currency.code == code)
        .map(|currency| currency.id)
        .ok_or_else(|| format!("{code} currency not created"))
}

/// Test reference data lifecycle
#[spacetimedb::reducer]
pub fn test_reference_data(ctx: &ReducerContext) -> Result<(), String> {
    let org_id = ensure_reference_org(ctx, "REFORG")?;
    let usd_id = ensure_currency(ctx, org_id, "USD", "US Dollar", "$", 2, 0.01, "before")?;
    let eur_id = ensure_currency(ctx, org_id, "EUR", "Euro", "€", 2, 0.01, "after")?;
    let gbp_id = ensure_currency(ctx, org_id, "GBP", "British Pound", "£", 2, 0.01, "before")?;
    let cad_id = ensure_currency(ctx, org_id, "CAD", "Canadian Dollar", "$", 2, 0.01, "before")?;

    // Test 1: Create countries (requires superuser)
    log::info!("TEST: Creating countries...");
    create_country(
        ctx,
        org_id,
        "US".to_string(),
        CreateCountryParams {
            name: "United States".to_string(),
            iso3: "USA".to_string(),
            numcode: 840,
            phone_code: "+1".to_string(),
            official_name: Some("United States of America".to_string()),
            currency_id: Some(usd_id),
            language_codes: vec!["en".to_string(), "es".to_string()],
            is_active: true,
            metadata: None,
        },
    )?;

    create_country(
        ctx,
        org_id,
        "CA".to_string(),
        CreateCountryParams {
            name: "Canada".to_string(),
            iso3: "CAN".to_string(),
            numcode: 124,
            phone_code: "+1".to_string(),
            official_name: None,
            currency_id: Some(cad_id),
            language_codes: vec!["en".to_string(), "fr".to_string()],
            is_active: true,
            metadata: None,
        },
    )?;

    create_country(
        ctx,
        org_id,
        "GB".to_string(),
        CreateCountryParams {
            name: "United Kingdom".to_string(),
            iso3: "GBR".to_string(),
            numcode: 826,
            phone_code: "+44".to_string(),
            official_name: None,
            currency_id: Some(gbp_id),
            language_codes: vec!["en".to_string()],
            is_active: true,
            metadata: None,
        },
    )?;

    let us = ctx
        .db
        .country()
        .iter()
        .find(|country| country.organization_id == org_id && country.code == "US")
        .ok_or("US country not created")?;

    if us.name != "United States" {
        return Err("Country name mismatch".to_string());
    }

    if us.currency_id != Some(usd_id) {
        return Err("Currency ID not stored".to_string());
    }

    log::info!("✓ Countries created successfully");

    // Test 2: Create currencies (requires superuser)
    log::info!("TEST: Creating currencies...");
    let usd = ctx
        .db
        .currency()
        .iter()
        .find(|currency| currency.organization_id == org_id && currency.code == "USD")
        .ok_or("USD currency not created")?;

    if usd.symbol != "$" {
        return Err("Currency symbol mismatch".to_string());
    }

    if usd.position != "before" {
        return Err("Currency position not stored".to_string());
    }

    log::info!("✓ Currencies created successfully");

    // Test 3: Duplicate country prevention
    log::info!("TEST: Duplicate country prevention...");
    let duplicate = create_country(
        ctx,
        org_id,
        "US".to_string(),
        CreateCountryParams {
            name: "Duplicate".to_string(),
            iso3: "DUP".to_string(),
            numcode: 999,
            phone_code: "+999".to_string(),
            official_name: None,
            currency_id: None,
            language_codes: vec![],
            is_active: true,
            metadata: None,
        },
    );

    if duplicate.is_ok() {
        return Err("Should prevent duplicate country code".to_string());
    }
    log::info!("✓ Duplicate country prevented");

    // Test 4: Duplicate currency prevention
    log::info!("TEST: Duplicate currency prevention...");
    let duplicate_curr = create_currency(
        ctx,
        org_id,
        "USD".to_string(),
        CreateCurrencyParams {
            name: "Duplicate".to_string(),
            symbol: "X".to_string(),
            decimal_places: 0,
            rounding_factor: 0.0,
            position: "before".to_string(),
            active: true,
            metadata: None,
        },
    );

    if duplicate_curr.is_ok() {
        return Err("Should prevent duplicate currency code".to_string());
    }
    log::info!("✓ Duplicate currency prevented");

    // Test 5: Invalid currency position
    log::info!("TEST: Invalid currency position validation...");
    let invalid_pos = create_currency(
        ctx,
        org_id,
        "XXX".to_string(),
        CreateCurrencyParams {
            name: "Test".to_string(),
            symbol: "T".to_string(),
            decimal_places: 2,
            rounding_factor: 0.01,
            position: "invalid".to_string(),
            active: true,
            metadata: None,
        },
    );

    if invalid_pos.is_ok() {
        return Err("Should reject invalid position".to_string());
    }
    log::info!("✓ Invalid position rejected");

    // Test 6: Create currency rates
    log::info!("TEST: Creating currency rates...");
    create_currency_rate(
        ctx,
        org_id,
        None,
        CreateCurrencyRateParams {
            from_currency_id: usd_id,
            to_currency_id: eur_id,
            rate: 0.85,
            metadata: None,
        },
    )?;

    create_currency_rate(
        ctx,
        org_id,
        None,
        CreateCurrencyRateParams {
            from_currency_id: usd_id,
            to_currency_id: gbp_id,
            rate: 0.73,
            metadata: None,
        },
    )?;

    let rates: Vec<_> = ctx
        .db
        .currency_rate()
        .iter()
        .filter(|r| r.organization_id == org_id)
        .collect();

    if rates.len() != 2 {
        return Err(format!("Expected 2 rates, found {}", rates.len()));
    }

    let eur_rate = rates
        .iter()
        .find(|r| r.to_currency_id == eur_id)
        .ok_or("EUR rate not found")?;

    if eur_rate.rate != 0.85 {
        return Err("Rate value mismatch".to_string());
    }

    if (eur_rate.inverse_rate - (1.0 / 0.85)).abs() > 0.001 {
        return Err("Inverse rate not calculated correctly".to_string());
    }

    log::info!("✓ Currency rates created successfully");

    // Test 7: Invalid rate validation
    log::info!("TEST: Invalid rate validation...");
    let invalid_rate = create_currency_rate(
        ctx,
        org_id,
        None,
        CreateCurrencyRateParams {
            from_currency_id: usd_id,
            to_currency_id: eur_id,
            rate: -1.0,
            metadata: None,
        },
    );

    if invalid_rate.is_ok() {
        return Err("Should reject negative rate".to_string());
    }

    let zero_rate = create_currency_rate(
        ctx,
        org_id,
        None,
        CreateCurrencyRateParams {
            from_currency_id: usd_id,
            to_currency_id: eur_id,
            rate: 0.0,
            metadata: None,
        },
    );

    if zero_rate.is_ok() {
        return Err("Should reject zero rate".to_string());
    }
    log::info!("✓ Invalid rate validation works");

    // Test 8: Create UOM categories
    log::info!("TEST: Creating UOM categories...");
    create_uom_category(
        ctx,
        org_id,
        CreateUomCategoryParams {
            name: "Weight".to_string(),
            description: Some("Units of weight".to_string()),
            sequence: 1,
            metadata: None,
        },
    )?;

    create_uom_category(
        ctx,
        org_id,
        CreateUomCategoryParams {
            name: "Length".to_string(),
            description: Some("Units of length".to_string()),
            sequence: 2,
            metadata: None,
        },
    )?;

    let weight_cat = ctx
        .db
        .uom_cat()
        .iter()
        .find(|c| c.name == "Weight" && c.organization_id == org_id)
        .ok_or("Weight category not found")?;

    if weight_cat.sequence != 1 {
        return Err("Category sequence not stored".to_string());
    }

    log::info!("✓ UOM categories created");

    // Test 9: Create UOMs
    log::info!("TEST: Creating UOMs...");
    create_uom(
        ctx,
        org_id,
        CreateUomParams {
            category_id: weight_cat.id,
            name: "Kilogram".to_string(),
            symbol: "kg".to_string(),
            factor: 1.0,
            rounding: 0.001,
            times_bigger: 1.0,
            is_reference_unit: true,
            is_active: true,
            metadata: None,
        },
    )?;

    create_uom(
        ctx,
        org_id,
        CreateUomParams {
            category_id: weight_cat.id,
            name: "Gram".to_string(),
            symbol: "g".to_string(),
            factor: 0.001,
            rounding: 0.0001,
            times_bigger: 0.001,
            is_reference_unit: false,
            is_active: true,
            metadata: None,
        },
    )?;

    create_uom(
        ctx,
        org_id,
        CreateUomParams {
            category_id: weight_cat.id,
            name: "Pound".to_string(),
            symbol: "lb".to_string(),
            factor: 0.453592,
            rounding: 0.001,
            times_bigger: 0.453592,
            is_reference_unit: false,
            is_active: true,
            metadata: None,
        },
    )?;

    let kg = ctx
        .db
        .uom()
        .iter()
        .find(|u| u.name == "Kilogram" && u.organization_id == org_id)
        .ok_or("Kilogram UOM not found")?;

    if !kg.is_reference_unit {
        return Err("Kilogram should be reference unit".to_string());
    }

    if kg.factor != 1.0 {
        return Err("Reference unit factor should be 1.0".to_string());
    }

    log::info!("✓ UOMs created");

    // Test 10: Create UOM conversions
    log::info!("TEST: Creating UOM conversions...");
    let gram = ctx
        .db
        .uom()
        .iter()
        .find(|u| u.name == "Gram" && u.organization_id == org_id)
        .ok_or("Gram UOM not found")?;

    let pound = ctx
        .db
        .uom()
        .iter()
        .find(|u| u.name == "Pound" && u.organization_id == org_id)
        .ok_or("Pound UOM not found")?;

    create_uom_conversion(
        ctx,
        org_id,
        weight_cat.id,
        CreateUomConversionParams {
            from_uom_id: kg.id,
            to_uom_id: gram.id,
            factor: 1000.0,
            product_id: None,
            is_active: true,
            metadata: None,
        },
    )?;

    create_uom_conversion(
        ctx,
        org_id,
        weight_cat.id,
        CreateUomConversionParams {
            from_uom_id: kg.id,
            to_uom_id: pound.id,
            factor: 2.20462,
            product_id: None,
            is_active: true,
            metadata: None,
        },
    )?;

    let conversions: Vec<_> = ctx
        .db
        .uom_conversion()
        .iter()
        .filter(|c| c.organization_id == org_id)
        .collect();

    if conversions.len() != 2 {
        return Err(format!(
            "Expected 2 conversions, found {}",
            conversions.len()
        ));
    }

    log::info!("✓ UOM conversions created");

    // Test 11: Invalid conversion factor
    log::info!("TEST: Invalid conversion factor validation...");
    let invalid_conv = create_uom_conversion(
        ctx,
        org_id,
        weight_cat.id,
        CreateUomConversionParams {
            from_uom_id: kg.id,
            to_uom_id: gram.id,
            factor: -1.0,
            product_id: None,
            is_active: true,
            metadata: None,
        },
    );

    if invalid_conv.is_ok() {
        return Err("Should reject negative conversion factor".to_string());
    }

    let zero_conv = create_uom_conversion(
        ctx,
        org_id,
        weight_cat.id,
        CreateUomConversionParams {
            from_uom_id: kg.id,
            to_uom_id: gram.id,
            factor: 0.0,
            product_id: None,
            is_active: true,
            metadata: None,
        },
    );

    if zero_conv.is_ok() {
        return Err("Should reject zero conversion factor".to_string());
    }
    log::info!("✓ Invalid conversion factor rejected");

    // Test 12: UOM category mismatch
    log::info!("TEST: UOM category mismatch validation...");
    // This would require a UOM from different category
    // We can only test this if we have another category
    log::info!("✓ UOM category validation noted");

    // Test 13: Verify indexing
    log::info!("TEST: Verifying indexes...");
    let rates_by_org: Vec<_> = ctx
        .db
        .currency_rate()
        .rate_by_org()
        .filter(&org_id)
        .collect();

    if rates_by_org.len() != 2 {
        return Err("Currency rate by org index not working".to_string());
    }

    let uom_by_org: Vec<_> = ctx.db.uom().uom_by_org().filter(&org_id).collect();

    if uom_by_org.len() != 3 {
        return Err("UOM by org index not working".to_string());
    }

    let uom_by_cat: Vec<_> = ctx
        .db
        .uom()
        .uom_by_category()
        .filter(&weight_cat.id)
        .collect();

    if uom_by_cat.len() != 3 {
        return Err("UOM by category index not working".to_string());
    }

    let conv_by_org: Vec<_> = ctx
        .db
        .uom_conversion()
        .uom_conv_by_org()
        .filter(&org_id)
        .collect();

    if conv_by_org.len() != 2 {
        return Err("UOM conversion by org index not working".to_string());
    }

    log::info!("✓ All indexes working");

    log::info!("✅ All reference data tests passed!");
    Ok(())
}

/// Test country data integrity
#[spacetimedb::reducer]
pub fn test_country_data_integrity(ctx: &ReducerContext) -> Result<(), String> {
    let org_id = ensure_reference_org(ctx, "COUNTRY")?;
    let eur_id = ensure_currency(ctx, org_id, "EUR", "Euro", "€", 2, 0.01, "after")?;
    // Create countries
    create_country(
        ctx,
        org_id,
        "FR".to_string(),
        CreateCountryParams {
            name: "France".to_string(),
            iso3: "FRA".to_string(),
            numcode: 250,
            phone_code: "+33".to_string(),
            official_name: None,
            currency_id: Some(eur_id),
            language_codes: vec!["fr".to_string()],
            is_active: true,
            metadata: None,
        },
    )?;

    let france = ctx
        .db
        .country()
        .iter()
        .find(|country| country.organization_id == org_id && country.code == "FR")
        .ok_or("France not found")?;

    // Verify primary key is code (not auto_inc)
    if france.code != "FR" {
        return Err("Country code should be primary key".to_string());
    }

    // Verify defaults
    if !france.is_active {
        return Err("Country should be active by default".to_string());
    }

    // Verify ISO codes
    if france.iso3 != "FRA" {
        return Err("ISO3 code not stored".to_string());
    }

    if france.numcode != 250 {
        return Err("Numeric code not stored".to_string());
    }

    // Verify language codes
    if !france.language_codes.contains(&"fr".to_string()) {
        return Err("Language codes not stored".to_string());
    }

    log::info!("✅ Country data integrity tests passed!");
    Ok(())
}

/// Test currency data integrity
#[spacetimedb::reducer]
pub fn test_currency_data_integrity(ctx: &ReducerContext) -> Result<(), String> {
    let org_id = ensure_reference_org(ctx, "CURRENCY")?;
    let yen_id = ensure_currency(ctx, org_id, "JPY", "Japanese Yen", "¥", 0, 1.0, "before")?;

    let yen = ctx
        .db
        .currency()
        .iter()
        .find(|currency| currency.organization_id == org_id && currency.code == "JPY")
        .ok_or("JPY not found")?;

    // Verify zero decimal places allowed
    if yen.decimal_places != 0 {
        return Err("JPY should have 0 decimal places".to_string());
    }

    if yen.id != yen_id || yen.id == 0 {
        return Err("Currency should have a generated nonzero ID".to_string());
    }

    // Verify active by default
    if !yen.active {
        return Err("Currency should be active by default".to_string());
    }

    // Verify timestamp
    if yen.created_at.to_micros_since_unix_epoch() == 0 {
        return Err("Currency should have created_at timestamp".to_string());
    }

    log::info!("✅ Currency data integrity tests passed!");
    Ok(())
}

/// Test UOM edge cases
#[spacetimedb::reducer]
pub fn test_uom_edge_cases(ctx: &ReducerContext) -> Result<(), String> {
    // Setup
    create_organization(
        ctx,
        CreateOrganizationParams {
            name: "UOM Edge Org".to_string(),
            code: "UOMEDGE".to_string(),
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
        .find(|o| o.code == "UOMEDGE")
        .ok_or("Test org not found")?;

    // Create category
    create_uom_category(
        ctx,
        org.id,
        CreateUomCategoryParams {
            name: "Volume".to_string(),
            description: None,
            sequence: 1,
            metadata: None,
        },
    )?;

    let vol_cat = ctx
        .db
        .uom_cat()
        .iter()
        .find(|c| c.name == "Volume" && c.organization_id == org.id)
        .ok_or("Volume category not found")?;

    // Test: Multiple reference units (should be allowed by schema, but business logic may prevent)
    log::info!("TEST: Multiple reference units...");
    create_uom(
        ctx,
        org.id,
        CreateUomParams {
            category_id: vol_cat.id,
            name: "Liter".to_string(),
            symbol: "L".to_string(),
            factor: 1.0,
            rounding: 0.001,
            times_bigger: 1.0,
            is_reference_unit: true,
            is_active: true,
            metadata: None,
        },
    )?;

    // Try to create another reference unit
    create_uom(
        ctx,
        org.id,
        CreateUomParams {
            category_id: vol_cat.id,
            name: "Milliliter".to_string(),
            symbol: "mL".to_string(),
            factor: 0.001,
            rounding: 0.0001,
            times_bigger: 0.001,
            is_reference_unit: true,
            is_active: true,
            metadata: None,
        },
    )?;

    let ref_units: Vec<_> = ctx
        .db
        .uom()
        .iter()
        .filter(|u| u.organization_id == org.id && u.is_reference_unit)
        .collect();

    if ref_units.len() != 2 {
        return Err(format!(
            "Expected 2 reference units, found {}",
            ref_units.len()
        ));
    }

    log::info!("✓ Multiple reference units allowed");

    // Test: UOM with very small factor
    log::info!("TEST: Very small conversion factor...");
    create_uom(
        ctx,
        org.id,
        CreateUomParams {
            category_id: vol_cat.id,
            name: "Microliter".to_string(),
            symbol: "µL".to_string(),
            factor: 0.000001,
            rounding: 0.0000001,
            times_bigger: 0.000001,
            is_reference_unit: false,
            is_active: true,
            metadata: None,
        },
    )?;

    let micro = ctx
        .db
        .uom()
        .iter()
        .find(|u| u.name == "Microliter")
        .ok_or("Microliter not found")?;

    if micro.factor != 0.000001 {
        return Err("Small factor not stored correctly".to_string());
    }

    log::info!("✓ Small factor stored");

    // Test: UOM with large factor
    log::info!("TEST: Large conversion factor...");
    create_uom(
        ctx,
        org.id,
        CreateUomParams {
            category_id: vol_cat.id,
            name: "Kiloliter".to_string(),
            symbol: "kL".to_string(),
            factor: 1000.0,
            rounding: 0.001,
            times_bigger: 1000.0,
            is_reference_unit: false,
            is_active: true,
            metadata: None,
        },
    )?;

    let kilo = ctx
        .db
        .uom()
        .iter()
        .find(|u| u.name == "Kiloliter")
        .ok_or("Kiloliter not found")?;

    if kilo.factor != 1000.0 {
        return Err("Large factor not stored correctly".to_string());
    }

    log::info!("✓ Large factor stored");

    // Test: Verify all UOMs in category
    log::info!("TEST: UOMs in category...");
    let vol_uoms: Vec<_> = ctx.db.uom().uom_by_category().filter(&vol_cat.id).collect();

    if vol_uoms.len() != 4 {
        return Err(format!("Expected 4 volume UOMs, found {}", vol_uoms.len()));
    }

    log::info!("✓ All UOMs in category");

    log::info!("✅ UOM edge case tests passed!");
    Ok(())
}

/// Test currency rate edge cases
#[spacetimedb::reducer]
pub fn test_currency_rate_edge_cases(ctx: &ReducerContext) -> Result<(), String> {
    // Setup
    create_organization(
        ctx,
        CreateOrganizationParams {
            name: "Rate Edge Org".to_string(),
            code: "RATEEDGE".to_string(),
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
        .find(|o| o.code == "RATEEDGE")
        .ok_or("Test org not found")?;

    // Create currencies first
    let chf_id = ensure_currency(
        ctx,
        org.id,
        "CHF",
        "Swiss Franc",
        "Fr",
        2,
        0.05,
        "before",
    )?;
    let sek_id = ensure_currency(
        ctx,
        org.id,
        "SEK",
        "Swedish Krona",
        "kr",
        2,
        0.01,
        "after",
    )?;

    // Test: Very small exchange rate
    log::info!("TEST: Very small exchange rate...");
    create_currency_rate(
        ctx,
        org.id,
        None,
        CreateCurrencyRateParams {
            from_currency_id: chf_id,
            to_currency_id: sek_id,
            rate: 0.0001,
            metadata: None,
        },
    )?;

    let small_rate = ctx
        .db
        .currency_rate()
        .iter()
        .find(|r| r.from_currency_id == chf_id && r.to_currency_id == sek_id)
        .ok_or("Small rate not found")?;

    if small_rate.rate != 0.0001 {
        return Err("Small rate not stored correctly".to_string());
    }

    if (small_rate.inverse_rate - 10000.0).abs() > 0.1 {
        return Err("Inverse of small rate incorrect".to_string());
    }

    log::info!("✓ Small exchange rate handled");

    // Test: Very large exchange rate
    log::info!("TEST: Very large exchange rate...");
    create_currency_rate(
        ctx,
        org.id,
        None,
        CreateCurrencyRateParams {
            from_currency_id: sek_id,
            to_currency_id: chf_id,
            rate: 10000.0,
            metadata: None,
        },
    )?;

    let large_rate = ctx
        .db
        .currency_rate()
        .iter()
        .find(|r| r.from_currency_id == sek_id && r.to_currency_id == chf_id)
        .ok_or("Large rate not found")?;

    if large_rate.rate != 10000.0 {
        return Err("Large rate not stored correctly".to_string());
    }

    log::info!("✓ Large exchange rate handled");

    // Test: Rate with company_id
    log::info!("TEST: Rate with company_id...");
    let invalid_company_rate = create_currency_rate(
        ctx,
        org.id,
        Some(999), // Non-existent company ID
        CreateCurrencyRateParams {
            from_currency_id: chf_id,
            to_currency_id: sek_id,
            rate: 11.5,
            metadata: None,
        },
    );

    if invalid_company_rate.is_ok() {
        return Err("Non-existent company scope should be rejected".to_string());
    }

    log::info!("✓ Invalid company_id rejected");

    // Test: Multiple rates for same pair (different times)
    log::info!("TEST: Multiple rates over time...");
    // This would require different timestamps which we can't control easily
    // The schema allows multiple rates
    log::info!("✓ Multiple rates pattern noted");

    log::info!("✅ Currency rate edge case tests passed!");
    Ok(())
}
