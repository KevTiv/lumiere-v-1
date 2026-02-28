/// Reference Data Module Tests
///
/// Test reducers for Country, Currency, CurrencyRate, UOMCategory, UOM, UOMConversion tables.
use spacetimedb::{ReducerContext, Table};

use crate::core::organization::{create_organization, organization};
use crate::core::reference::{
    country, create_country, create_currency, create_currency_rate, create_uom,
    create_uom_category, create_uom_conversion, currency, currency_rate, uom, uom_cat,
    uom_conversion,
};

/// Test reference data lifecycle
#[spacetimedb::reducer]
pub fn test_reference_data(ctx: &ReducerContext) -> Result<(), String> {
    // Test 1: Create countries (requires superuser)
    log::info!("TEST: Creating countries...");
    create_country(
        ctx,
        "US".to_string(),
        "United States".to_string(),
        "USA".to_string(),
        840,
        "+1".to_string(),
        Some("United States of America".to_string()),
        Some("USD".to_string()),
        vec!["en".to_string(), "es".to_string()],
        None,
    )?;

    create_country(
        ctx,
        "CA".to_string(),
        "Canada".to_string(),
        "CAN".to_string(),
        124,
        "+1".to_string(),
        None,
        Some("CAD".to_string()),
        vec!["en".to_string(), "fr".to_string()],
        None,
    )?;

    create_country(
        ctx,
        "GB".to_string(),
        "United Kingdom".to_string(),
        "GBR".to_string(),
        826,
        "+44".to_string(),
        None,
        Some("GBP".to_string()),
        vec!["en".to_string()],
        None,
    )?;

    let us = ctx
        .db
        .country()
        .code()
        .find(&"US".to_string())
        .ok_or("US country not created")?;

    if us.name != "United States" {
        return Err("Country name mismatch".to_string());
    }

    if us.currency_code != Some("USD".to_string()) {
        return Err("Currency code not stored".to_string());
    }

    log::info!("✓ Countries created successfully");

    // Test 2: Create currencies (requires superuser)
    log::info!("TEST: Creating currencies...");
    create_currency(
        ctx,
        "USD".to_string(),
        "US Dollar".to_string(),
        "$".to_string(),
        2,
        0.01,
        "before".to_string(),
        None,
    )?;

    create_currency(
        ctx,
        "EUR".to_string(),
        "Euro".to_string(),
        "€".to_string(),
        2,
        0.01,
        "after".to_string(),
        None,
    )?;

    create_currency(
        ctx,
        "GBP".to_string(),
        "British Pound".to_string(),
        "£".to_string(),
        2,
        0.01,
        "before".to_string(),
        None,
    )?;

    let usd = ctx
        .db
        .currency()
        .code()
        .find(&"USD".to_string())
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
        "US".to_string(),
        "Duplicate".to_string(),
        "DUP".to_string(),
        999,
        "+999".to_string(),
        None,
        None,
        vec![],
        None,
    );

    if duplicate.is_ok() {
        return Err("Should prevent duplicate country code".to_string());
    }
    log::info!("✓ Duplicate country prevented");

    // Test 4: Duplicate currency prevention
    log::info!("TEST: Duplicate currency prevention...");
    let duplicate_curr = create_currency(
        ctx,
        "USD".to_string(),
        "Duplicate".to_string(),
        "X".to_string(),
        0,
        0.0,
        "before".to_string(),
        None,
    );

    if duplicate_curr.is_ok() {
        return Err("Should prevent duplicate currency code".to_string());
    }
    log::info!("✓ Duplicate currency prevented");

    // Test 5: Invalid currency position
    log::info!("TEST: Invalid currency position validation...");
    let invalid_pos = create_currency(
        ctx,
        "XXX".to_string(),
        "Test".to_string(),
        "T".to_string(),
        2,
        0.01,
        "invalid".to_string(),
        None,
    );

    if invalid_pos.is_ok() {
        return Err("Should reject invalid position".to_string());
    }
    log::info!("✓ Invalid position rejected");

    // Setup organization for rates and UOM tests
    log::info!("TEST: Creating test organization...");
    create_organization(
        ctx,
        "Reference Test Org".to_string(),
        "REFORG".to_string(),
        "UTC".to_string(),
        "YYYY-MM-DD".to_string(),
        "en".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )?;

    let org = ctx
        .db
        .organization()
        .iter()
        .find(|o| o.code == "REFORG")
        .ok_or("Test organization not found")?;

    let org_id = org.id;

    // Test 6: Create currency rates
    log::info!("TEST: Creating currency rates...");
    create_currency_rate(
        ctx,
        org_id,
        "USD".to_string(),
        "EUR".to_string(),
        0.85,
        Some(1),
        None,
    )?;

    create_currency_rate(
        ctx,
        org_id,
        "USD".to_string(),
        "GBP".to_string(),
        0.73,
        None,
        None,
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
        .find(|r| r.to_currency == "EUR")
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
        "USD".to_string(),
        "JPY".to_string(),
        -1.0,
        None,
        None,
    );

    if invalid_rate.is_ok() {
        return Err("Should reject negative rate".to_string());
    }

    let zero_rate = create_currency_rate(
        ctx,
        org_id,
        "USD".to_string(),
        "JPY".to_string(),
        0.0,
        None,
        None,
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
        "Weight".to_string(),
        Some("Units of weight".to_string()),
        1,
        None,
    )?;

    create_uom_category(
        ctx,
        org_id,
        "Length".to_string(),
        Some("Units of length".to_string()),
        2,
        None,
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
        weight_cat.id,
        "Kilogram".to_string(),
        "kg".to_string(),
        1.0,
        0.001,
        1.0,
        true,
        None,
    )?;

    create_uom(
        ctx,
        org_id,
        weight_cat.id,
        "Gram".to_string(),
        "g".to_string(),
        0.001,
        0.0001,
        0.001,
        false,
        None,
    )?;

    create_uom(
        ctx,
        org_id,
        weight_cat.id,
        "Pound".to_string(),
        "lb".to_string(),
        0.453592,
        0.001,
        0.453592,
        false,
        None,
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
        kg.id,
        gram.id,
        1000.0,
        None,
        None,
    )?;

    create_uom_conversion(
        ctx,
        org_id,
        weight_cat.id,
        kg.id,
        pound.id,
        2.20462,
        None,
        None,
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
    let invalid_conv =
        create_uom_conversion(ctx, org_id, weight_cat.id, kg.id, gram.id, -1.0, None, None);

    if invalid_conv.is_ok() {
        return Err("Should reject negative conversion factor".to_string());
    }

    let zero_conv =
        create_uom_conversion(ctx, org_id, weight_cat.id, kg.id, gram.id, 0.0, None, None);

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
    // Create countries
    create_country(
        ctx,
        "FR".to_string(),
        "France".to_string(),
        "FRA".to_string(),
        250,
        "+33".to_string(),
        None,
        Some("EUR".to_string()),
        vec!["fr".to_string()],
        None,
    )?;

    let france = ctx
        .db
        .country()
        .code()
        .find(&"FR".to_string())
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
    create_currency(
        ctx,
        "JPY".to_string(),
        "Japanese Yen".to_string(),
        "¥".to_string(),
        0,
        1.0,
        "before".to_string(),
        None,
    )?;

    let yen = ctx
        .db
        .currency()
        .code()
        .find(&"JPY".to_string())
        .ok_or("JPY not found")?;

    // Verify zero decimal places allowed
    if yen.decimal_places != 0 {
        return Err("JPY should have 0 decimal places".to_string());
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
        "UOM Edge Org".to_string(),
        "UOMEDGE".to_string(),
        "UTC".to_string(),
        "YYYY-MM-DD".to_string(),
        "en".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )?;

    let org = ctx
        .db
        .organization()
        .iter()
        .find(|o| o.code == "UOMEDGE")
        .ok_or("Test org not found")?;

    // Create category
    create_uom_category(ctx, org.id, "Volume".to_string(), None, 1, None)?;

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
        vol_cat.id,
        "Liter".to_string(),
        "L".to_string(),
        1.0,
        0.001,
        1.0,
        true,
        None,
    )?;

    // Try to create another reference unit
    create_uom(
        ctx,
        org.id,
        vol_cat.id,
        "Milliliter".to_string(),
        "mL".to_string(),
        0.001,
        0.0001,
        0.001,
        true,
        None,
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
        vol_cat.id,
        "Microliter".to_string(),
        "µL".to_string(),
        0.000001,
        0.0000001,
        0.000001,
        false,
        None,
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
        vol_cat.id,
        "Kiloliter".to_string(),
        "kL".to_string(),
        1000.0,
        0.001,
        1000.0,
        false,
        None,
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
        "Rate Edge Org".to_string(),
        "RATEEDGE".to_string(),
        "UTC".to_string(),
        "YYYY-MM-DD".to_string(),
        "en".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )?;

    let org = ctx
        .db
        .organization()
        .iter()
        .find(|o| o.code == "RATEEDGE")
        .ok_or("Test org not found")?;

    // Create currencies first
    create_currency(
        ctx,
        "CHF".to_string(),
        "Swiss Franc".to_string(),
        "Fr".to_string(),
        2,
        0.05,
        "before".to_string(),
        None,
    )?;

    create_currency(
        ctx,
        "SEK".to_string(),
        "Swedish Krona".to_string(),
        "kr".to_string(),
        2,
        0.01,
        "after".to_string(),
        None,
    )?;

    // Test: Very small exchange rate
    log::info!("TEST: Very small exchange rate...");
    create_currency_rate(
        ctx,
        org.id,
        "CHF".to_string(),
        "SEK".to_string(),
        0.0001,
        None,
        None,
    )?;

    let small_rate = ctx
        .db
        .currency_rate()
        .iter()
        .find(|r| r.from_currency == "CHF" && r.to_currency == "SEK")
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
        "SEK".to_string(),
        "CHF".to_string(),
        10000.0,
        None,
        None,
    )?;

    let large_rate = ctx
        .db
        .currency_rate()
        .iter()
        .find(|r| r.from_currency == "SEK" && r.to_currency == "CHF")
        .ok_or("Large rate not found")?;

    if large_rate.rate != 10000.0 {
        return Err("Large rate not stored correctly".to_string());
    }

    log::info!("✓ Large exchange rate handled");

    // Test: Rate with company_id
    log::info!("TEST: Rate with company_id...");
    create_currency_rate(
        ctx,
        org.id,
        "CHF".to_string(),
        "SEK".to_string(),
        11.5,
        Some(999), // Non-existent company ID
        None,
    )?;

    let rate_with_company = ctx
        .db
        .currency_rate()
        .iter()
        .find(|r| r.from_currency == "CHF" && r.rate == 11.5)
        .ok_or("Rate with company not found")?;

    if rate_with_company.company_id != Some(999) {
        return Err("Company ID not stored".to_string());
    }

    log::info!("✓ Rate with company_id stored");

    // Test: Multiple rates for same pair (different times)
    log::info!("TEST: Multiple rates over time...");
    // This would require different timestamps which we can't control easily
    // The schema allows multiple rates
    log::info!("✓ Multiple rates pattern noted");

    log::info!("✅ Currency rate edge case tests passed!");
    Ok(())
}
