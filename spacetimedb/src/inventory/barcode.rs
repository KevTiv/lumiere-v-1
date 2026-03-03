/// Barcode System — Tables and Reducers
///
/// Tables:
///   - BarcodeRule
///   - BarcodeScan
///   - BarcodeNomenclature
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};
use crate::inventory::product::{product, product_packaging, product_variant};
use crate::inventory::tracking::stock_production_lot;
use crate::inventory::warehouse::stock_location;
use serde_json;

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.19: BARCODE RULE
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = barcode_rule,
    public,
    index(accessor = barcode_rule_by_org, btree(columns = [organization_id])),
    index(accessor = barcode_rule_by_type, btree(columns = [type_]))
)]
pub struct BarcodeRule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub description: Option<String>,
    pub sequence: i32,
    pub encoding: String,
    pub pattern: String,
    pub type_: String,
    pub alias: Option<String>,
    pub is_active: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.20: BARCODE SCAN
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = barcode_scan,
    public,
    index(accessor = barcode_scan_by_org, btree(columns = [organization_id])),
    index(accessor = barcode_scan_by_barcode, btree(columns = [barcode])),
    index(accessor = barcode_scan_by_user, btree(columns = [user_id]))
)]
pub struct BarcodeScan {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub barcode: String,
    pub barcode_type: String,
    pub product_id: Option<u64>,
    pub lot_id: Option<u64>,
    pub location_id: Option<u64>,
    pub package_id: Option<u64>,
    pub quantity: Option<f64>,
    pub uom_id: Option<u64>,
    pub user_id: Identity,
    pub session_id: Option<String>,
    pub device_id: Option<String>,
    pub scanned_at: Timestamp,
    pub processed: bool,
    pub processed_at: Option<Timestamp>,
    pub error_message: Option<String>,
    pub context_type: Option<String>,
    pub context_id: Option<u64>,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3.21: BARCODE NOMENCLATURE
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = barcode_nomenclature,
    public,
    index(accessor = nomenclature_by_org, btree(columns = [organization_id]))
)]
pub struct BarcodeNomenclature {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub description: Option<String>,
    pub is_default: bool,
    pub rule_ids: Vec<u64>,
    pub upc_ean_conv: String,
    pub is_active: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: BARCODE RULE
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_barcode_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    encoding: String,
    pattern: String,
    type_: String,
    description: Option<String>,
    sequence: i32,
    alias: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "barcode_rule", "create")?;

    if name.is_empty() {
        return Err("Rule name cannot be empty".to_string());
    }

    if pattern.is_empty() {
        return Err("Pattern cannot be empty".to_string());
    }

    let type_val = type_.clone();
    let rule = ctx.db.barcode_rule().insert(BarcodeRule {
        id: 0,
        organization_id,
        name: name.clone(),
        description,
        sequence,
        encoding,
        pattern,
        type_: type_val,
        alias,
        is_active: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: None,
    });

    write_audit_log(
        ctx,
        organization_id,
        None,
        "barcode_rule",
        rule.id,
        "create",
        None,
        Some(serde_json::json!({ "name": name, "type": rule.type_ }).to_string()),
        vec!["name".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_barcode_rule(
    ctx: &ReducerContext,
    rule_id: u64,
    name: Option<String>,
    description: Option<String>,
    sequence: Option<i32>,
    encoding: Option<String>,
    pattern: Option<String>,
    type_: Option<String>,
    alias: Option<String>,
    is_active: Option<bool>,
) -> Result<(), String> {
    let rule = ctx
        .db
        .barcode_rule()
        .id()
        .find(&rule_id)
        .ok_or("Barcode rule not found")?;

    check_permission(ctx, rule.organization_id, "barcode_rule", "write")?;

    ctx.db.barcode_rule().id().update(BarcodeRule {
        name: name.unwrap_or_else(|| rule.name.clone()),
        description: description.or(rule.description),
        sequence: sequence.unwrap_or(rule.sequence),
        encoding: encoding.unwrap_or_else(|| rule.encoding.clone()),
        pattern: pattern.unwrap_or_else(|| rule.pattern.clone()),
        type_: type_.unwrap_or_else(|| rule.type_.clone()),
        alias: alias.or(rule.alias),
        is_active: is_active.unwrap_or(rule.is_active),
        updated_at: ctx.timestamp,
        ..rule
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_barcode_rule(ctx: &ReducerContext, rule_id: u64) -> Result<(), String> {
    let rule = ctx
        .db
        .barcode_rule()
        .id()
        .find(&rule_id)
        .ok_or("Barcode rule not found")?;

    check_permission(ctx, rule.organization_id, "barcode_rule", "delete")?;

    let rule_name = rule.name.clone();
    ctx.db.barcode_rule().id().delete(&rule_id);

    write_audit_log(
        ctx,
        rule.organization_id,
        None,
        "barcode_rule",
        rule_id,
        "delete",
        Some(serde_json::json!({ "name": rule_name }).to_string()),
        None,
        vec!["deleted".to_string()],
    );

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: BARCODE SCAN
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn record_barcode_scan(
    ctx: &ReducerContext,
    organization_id: u64,
    barcode: String,
    barcode_type: String,
    context_type: Option<String>,
    context_id: Option<u64>,
    quantity: Option<f64>,
    uom_id: Option<u64>,
    session_id: Option<String>,
    device_id: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "barcode_scan", "create")?;

    if barcode.is_empty() {
        return Err("Barcode cannot be empty".to_string());
    }

    let (product_id, lot_id, location_id, package_id, error_message) =
        resolve_barcode(ctx, organization_id, &barcode);

    let scan = ctx.db.barcode_scan().insert(BarcodeScan {
        id: 0,
        organization_id,
        barcode: barcode.clone(),
        barcode_type,
        product_id,
        lot_id,
        location_id,
        package_id,
        quantity,
        uom_id,
        user_id: ctx.sender(),
        session_id,
        device_id,
        scanned_at: ctx.timestamp,
        processed: error_message.is_none(),
        processed_at: if error_message.is_none() {
            Some(ctx.timestamp)
        } else {
            None
        },
        error_message,
        context_type,
        context_id,
        metadata: None,
    });

    write_audit_log(
        ctx,
        organization_id,
        None,
        "barcode_scan",
        scan.id,
        "create",
        None,
        Some(serde_json::json!({ "barcode": barcode }).to_string()),
        vec!["barcode".to_string()],
    );

    Ok(())
}

fn resolve_barcode(
    ctx: &ReducerContext,
    organization_id: u64,
    barcode: &str,
) -> (
    Option<u64>,
    Option<u64>,
    Option<u64>,
    Option<u64>,
    Option<String>,
) {
    // Check products by barcode (iterate and filter manually since barcode is Option<String>)
    for product in ctx.db.product().product_by_org().filter(&organization_id) {
        if product.barcode.as_ref() == Some(&barcode.to_string()) {
            return (Some(product.id), None, None, None, None);
        }
    }

    // Check product variants by barcode
    for variant in ctx
        .db
        .product_variant()
        .variant_by_org()
        .filter(&organization_id)
    {
        if variant.barcode.as_ref() == Some(&barcode.to_string()) {
            return (Some(variant.product_tmpl_id), None, None, None, None);
        }
    }

    // Check lots by name (name is String, not Option<String>)
    for lot in ctx.db.stock_production_lot().lot_by_name().filter(barcode) {
        if lot.organization_id == organization_id {
            return (Some(lot.product_id), Some(lot.id), None, None, None);
        }
    }

    // Check locations by barcode
    for location in ctx
        .db
        .stock_location()
        .location_by_org()
        .filter(&organization_id)
    {
        if location.barcode.as_ref() == Some(&barcode.to_string()) {
            return (None, None, Some(location.id), None, None);
        }
    }

    // Check packaging by barcode
    for packaging in ctx
        .db
        .product_packaging()
        .packaging_by_org()
        .filter(&organization_id)
    {
        if packaging.barcode.as_ref() == Some(&barcode.to_string()) {
            return (
                Some(packaging.product_id),
                None,
                None,
                Some(packaging.id),
                None,
            );
        }
    }

    (
        None,
        None,
        None,
        None,
        Some(format!("Barcode '{}' not found or not accessible", barcode)),
    )
}

#[spacetimedb::reducer]
pub fn process_pending_scans(ctx: &ReducerContext, organization_id: u64) -> Result<(), String> {
    check_permission(ctx, organization_id, "barcode_scan", "write")?;

    let pending_scans: Vec<_> = ctx
        .db
        .barcode_scan()
        .barcode_scan_by_org()
        .filter(&organization_id)
        .filter(|s| !s.processed && s.error_message.is_none())
        .collect();

    for mut scan in pending_scans {
        scan.processed = true;
        scan.processed_at = Some(ctx.timestamp);
        ctx.db.barcode_scan().id().update(scan);
    }

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: BARCODE NOMENCLATURE
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_barcode_nomenclature(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    description: Option<String>,
    is_default: bool,
    upc_ean_conv: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "barcode_nomenclature", "create")?;

    if name.is_empty() {
        return Err("Nomenclature name cannot be empty".to_string());
    }

    if is_default {
        for mut nomenclature in ctx
            .db
            .barcode_nomenclature()
            .nomenclature_by_org()
            .filter(&organization_id)
            .filter(|n| n.is_default)
        {
            nomenclature.is_default = false;
            ctx.db.barcode_nomenclature().id().update(nomenclature);
        }
    }

    let nomenclature = ctx.db.barcode_nomenclature().insert(BarcodeNomenclature {
        id: 0,
        organization_id,
        name: name.clone(),
        description,
        is_default,
        rule_ids: vec![],
        upc_ean_conv,
        is_active: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: None,
    });

    write_audit_log(
        ctx,
        organization_id,
        None,
        "barcode_nomenclature",
        nomenclature.id,
        "create",
        None,
        Some(serde_json::json!({ "name": name }).to_string()),
        vec!["name".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_barcode_nomenclature(
    ctx: &ReducerContext,
    nomenclature_id: u64,
    name: Option<String>,
    description: Option<String>,
    is_default: Option<bool>,
    upc_ean_conv: Option<String>,
    is_active: Option<bool>,
) -> Result<(), String> {
    let nomenclature = ctx
        .db
        .barcode_nomenclature()
        .id()
        .find(&nomenclature_id)
        .ok_or("Nomenclature not found")?;

    check_permission(
        ctx,
        nomenclature.organization_id,
        "barcode_nomenclature",
        "write",
    )?;

    let new_is_default = is_default.unwrap_or(nomenclature.is_default);

    if new_is_default && !nomenclature.is_default {
        for mut other in ctx
            .db
            .barcode_nomenclature()
            .nomenclature_by_org()
            .filter(&nomenclature.organization_id)
            .filter(|n| n.is_default && n.id != nomenclature_id)
        {
            other.is_default = false;
            ctx.db.barcode_nomenclature().id().update(other);
        }
    }

    ctx.db
        .barcode_nomenclature()
        .id()
        .update(BarcodeNomenclature {
            name: name.unwrap_or_else(|| nomenclature.name.clone()),
            description: description.or(nomenclature.description),
            is_default: new_is_default,
            upc_ean_conv: upc_ean_conv.unwrap_or_else(|| nomenclature.upc_ean_conv.clone()),
            is_active: is_active.unwrap_or(nomenclature.is_active),
            updated_at: ctx.timestamp,
            ..nomenclature
        });

    Ok(())
}

#[spacetimedb::reducer]
pub fn add_rule_to_nomenclature(
    ctx: &ReducerContext,
    nomenclature_id: u64,
    rule_id: u64,
) -> Result<(), String> {
    let nomenclature = ctx
        .db
        .barcode_nomenclature()
        .id()
        .find(&nomenclature_id)
        .ok_or("Nomenclature not found")?;

    check_permission(
        ctx,
        nomenclature.organization_id,
        "barcode_nomenclature",
        "write",
    )?;

    let _rule = ctx
        .db
        .barcode_rule()
        .id()
        .find(&rule_id)
        .ok_or("Rule not found")?;

    if nomenclature.rule_ids.contains(&rule_id) {
        return Err("Rule already added to nomenclature".to_string());
    }

    let mut rule_ids = nomenclature.rule_ids;
    rule_ids.push(rule_id);

    ctx.db
        .barcode_nomenclature()
        .id()
        .update(BarcodeNomenclature {
            rule_ids,
            updated_at: ctx.timestamp,
            ..nomenclature
        });

    Ok(())
}

#[spacetimedb::reducer]
pub fn remove_rule_from_nomenclature(
    ctx: &ReducerContext,
    nomenclature_id: u64,
    rule_id: u64,
) -> Result<(), String> {
    let nomenclature = ctx
        .db
        .barcode_nomenclature()
        .id()
        .find(&nomenclature_id)
        .ok_or("Nomenclature not found")?;

    check_permission(
        ctx,
        nomenclature.organization_id,
        "barcode_nomenclature",
        "write",
    )?;

    let mut rule_ids = nomenclature.rule_ids;
    rule_ids.retain(|&id| id != rule_id);

    ctx.db
        .barcode_nomenclature()
        .id()
        .update(BarcodeNomenclature {
            rule_ids,
            updated_at: ctx.timestamp,
            ..nomenclature
        });

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_barcode_nomenclature(
    ctx: &ReducerContext,
    nomenclature_id: u64,
) -> Result<(), String> {
    let nomenclature = ctx
        .db
        .barcode_nomenclature()
        .id()
        .find(&nomenclature_id)
        .ok_or("Nomenclature not found")?;

    check_permission(
        ctx,
        nomenclature.organization_id,
        "barcode_nomenclature",
        "delete",
    )?;

    if nomenclature.is_default {
        return Err("Cannot delete default nomenclature".to_string());
    }

    let nom_name = nomenclature.name.clone();
    ctx.db.barcode_nomenclature().id().delete(&nomenclature_id);

    write_audit_log(
        ctx,
        nomenclature.organization_id,
        None,
        "barcode_nomenclature",
        nomenclature_id,
        "delete",
        Some(serde_json::json!({ "name": nom_name }).to_string()),
        None,
        vec!["deleted".to_string()],
    );

    Ok(())
}
