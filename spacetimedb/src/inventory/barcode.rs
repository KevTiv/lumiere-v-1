/// Barcode System — Tables and Reducers
///
/// Tables:
///   - BarcodeRule
///   - BarcodeScan
///   - BarcodeNomenclature
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::product::{product, product_packaging, product_variant};
use crate::inventory::tracking::stock_production_lot;
use crate::inventory::warehouse::stock_location;
use serde_json;

// ── Tables ───────────────────────────────────────────────────────────────────

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

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateBarcodeRuleParams {
    pub name: String,
    pub encoding: String,
    pub pattern: String,
    pub type_: String,
    pub description: Option<String>,
    pub sequence: i32,
    pub alias: Option<String>,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateBarcodeRuleParams {
    pub name: Option<String>,
    pub description: Option<String>,
    pub sequence: Option<i32>,
    pub encoding: Option<String>,
    pub pattern: Option<String>,
    pub type_: Option<String>,
    pub alias: Option<String>,
    pub is_active: Option<bool>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordBarcodeScanParams {
    pub barcode: String,
    pub barcode_type: String,
    pub context_type: Option<String>,
    pub context_id: Option<u64>,
    pub quantity: Option<f64>,
    pub uom_id: Option<u64>,
    pub session_id: Option<String>,
    pub device_id: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateBarcodeNomenclatureParams {
    pub name: String,
    pub description: Option<String>,
    pub is_default: bool,
    pub upc_ean_conv: String,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateBarcodeNomenclatureParams {
    pub name: Option<String>,
    pub description: Option<String>,
    pub is_default: Option<bool>,
    pub upc_ean_conv: Option<String>,
    pub is_active: Option<bool>,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: BARCODE RULE
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_barcode_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateBarcodeRuleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "barcode_rule", "create")?;

    if params.name.is_empty() {
        return Err("Rule name cannot be empty".to_string());
    }

    if params.pattern.is_empty() {
        return Err("Pattern cannot be empty".to_string());
    }

    let rule = ctx.db.barcode_rule().insert(BarcodeRule {
        id: 0,
        organization_id,
        name: params.name.clone(),
        description: params.description,
        sequence: params.sequence,
        encoding: params.encoding,
        pattern: params.pattern,
        type_: params.type_.clone(),
        alias: params.alias,
        is_active: params.is_active,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "barcode_rule",
            record_id: rule.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "name": params.name, "type": rule.type_ }).to_string(),
            ),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_barcode_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    rule_id: u64,
    params: UpdateBarcodeRuleParams,
) -> Result<(), String> {
    let rule = ctx
        .db
        .barcode_rule()
        .id()
        .find(&rule_id)
        .ok_or("Barcode rule not found")?;

    check_permission(ctx, organization_id, "barcode_rule", "write")?;

    if rule.organization_id != organization_id {
        return Err("Barcode rule does not belong to this organization".to_string());
    }

    let old_values = serde_json::json!({ "name": rule.name, "type": rule.type_ }).to_string();

    ctx.db.barcode_rule().id().update(BarcodeRule {
        name: params.name.unwrap_or_else(|| rule.name.clone()),
        description: params.description.or(rule.description),
        sequence: params.sequence.unwrap_or(rule.sequence),
        encoding: params.encoding.unwrap_or_else(|| rule.encoding.clone()),
        pattern: params.pattern.unwrap_or_else(|| rule.pattern.clone()),
        type_: params.type_.unwrap_or_else(|| rule.type_.clone()),
        alias: params.alias.or(rule.alias),
        is_active: params.is_active.unwrap_or(rule.is_active),
        metadata: params.metadata.or(rule.metadata),
        updated_at: ctx.timestamp,
        ..rule
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "barcode_rule",
            record_id: rule_id,
            action: "UPDATE",
            old_values: Some(old_values),
            new_values: None,
            changed_fields: vec!["name".to_string(), "type".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_barcode_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    rule_id: u64,
) -> Result<(), String> {
    let rule = ctx
        .db
        .barcode_rule()
        .id()
        .find(&rule_id)
        .ok_or("Barcode rule not found")?;

    check_permission(ctx, organization_id, "barcode_rule", "delete")?;

    if rule.organization_id != organization_id {
        return Err("Barcode rule does not belong to this organization".to_string());
    }

    let rule_name = rule.name.clone();
    ctx.db.barcode_rule().id().delete(&rule_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "barcode_rule",
            record_id: rule_id,
            action: "DELETE",
            old_values: Some(serde_json::json!({ "name": rule_name }).to_string()),
            new_values: None,
            changed_fields: vec!["deleted".to_string()],
            metadata: None,
        },
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
    params: RecordBarcodeScanParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "barcode_scan", "create")?;

    if params.barcode.is_empty() {
        return Err("Barcode cannot be empty".to_string());
    }

    let (product_id, lot_id, location_id, package_id, error_message) =
        resolve_barcode(ctx, organization_id, &params.barcode);

    let scan = ctx.db.barcode_scan().insert(BarcodeScan {
        id: 0,
        organization_id,
        barcode: params.barcode.clone(),
        barcode_type: params.barcode_type,
        product_id,
        lot_id,
        location_id,
        package_id,
        quantity: params.quantity,
        uom_id: params.uom_id,
        user_id: ctx.sender(),
        session_id: params.session_id,
        device_id: params.device_id,
        scanned_at: ctx.timestamp,
        processed: error_message.is_none(),
        processed_at: if error_message.is_none() {
            Some(ctx.timestamp)
        } else {
            None
        },
        error_message,
        context_type: params.context_type,
        context_id: params.context_id,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "barcode_scan",
            record_id: scan.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "barcode": params.barcode }).to_string()),
            changed_fields: vec!["barcode".to_string()],
            metadata: None,
        },
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
    params: CreateBarcodeNomenclatureParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "barcode_nomenclature", "create")?;

    if params.name.is_empty() {
        return Err("Nomenclature name cannot be empty".to_string());
    }

    if params.is_default {
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

    // rule_ids is always empty on create — managed exclusively by add/remove_rule_to_nomenclature
    let nomenclature = ctx.db.barcode_nomenclature().insert(BarcodeNomenclature {
        id: 0,
        organization_id,
        name: params.name.clone(),
        description: params.description,
        is_default: params.is_default,
        rule_ids: vec![],
        upc_ean_conv: params.upc_ean_conv,
        is_active: params.is_active,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "barcode_nomenclature",
            record_id: nomenclature.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": params.name }).to_string()),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_barcode_nomenclature(
    ctx: &ReducerContext,
    organization_id: u64,
    nomenclature_id: u64,
    params: UpdateBarcodeNomenclatureParams,
) -> Result<(), String> {
    let nomenclature = ctx
        .db
        .barcode_nomenclature()
        .id()
        .find(&nomenclature_id)
        .ok_or("Nomenclature not found")?;

    check_permission(ctx, organization_id, "barcode_nomenclature", "write")?;

    if nomenclature.organization_id != organization_id {
        return Err("Nomenclature does not belong to this organization".to_string());
    }

    let new_is_default = params.is_default.unwrap_or(nomenclature.is_default);

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

    let old_values = serde_json::json!({ "name": nomenclature.name }).to_string();

    ctx.db
        .barcode_nomenclature()
        .id()
        .update(BarcodeNomenclature {
            name: params.name.unwrap_or_else(|| nomenclature.name.clone()),
            description: params.description.or(nomenclature.description),
            is_default: new_is_default,
            upc_ean_conv: params
                .upc_ean_conv
                .unwrap_or_else(|| nomenclature.upc_ean_conv.clone()),
            is_active: params.is_active.unwrap_or(nomenclature.is_active),
            metadata: params.metadata.or(nomenclature.metadata),
            updated_at: ctx.timestamp,
            ..nomenclature
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "barcode_nomenclature",
            record_id: nomenclature_id,
            action: "UPDATE",
            old_values: Some(old_values),
            new_values: None,
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn add_rule_to_nomenclature(
    ctx: &ReducerContext,
    organization_id: u64,
    nomenclature_id: u64,
    rule_id: u64,
) -> Result<(), String> {
    let nomenclature = ctx
        .db
        .barcode_nomenclature()
        .id()
        .find(&nomenclature_id)
        .ok_or("Nomenclature not found")?;

    check_permission(ctx, organization_id, "barcode_nomenclature", "write")?;

    if nomenclature.organization_id != organization_id {
        return Err("Nomenclature does not belong to this organization".to_string());
    }

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
    organization_id: u64,
    nomenclature_id: u64,
    rule_id: u64,
) -> Result<(), String> {
    let nomenclature = ctx
        .db
        .barcode_nomenclature()
        .id()
        .find(&nomenclature_id)
        .ok_or("Nomenclature not found")?;

    check_permission(ctx, organization_id, "barcode_nomenclature", "write")?;

    if nomenclature.organization_id != organization_id {
        return Err("Nomenclature does not belong to this organization".to_string());
    }

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
    organization_id: u64,
    nomenclature_id: u64,
) -> Result<(), String> {
    let nomenclature = ctx
        .db
        .barcode_nomenclature()
        .id()
        .find(&nomenclature_id)
        .ok_or("Nomenclature not found")?;

    check_permission(ctx, organization_id, "barcode_nomenclature", "delete")?;

    if nomenclature.organization_id != organization_id {
        return Err("Nomenclature does not belong to this organization".to_string());
    }

    if nomenclature.is_default {
        return Err("Cannot delete default nomenclature".to_string());
    }

    let nom_name = nomenclature.name.clone();
    ctx.db.barcode_nomenclature().id().delete(&nomenclature_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "barcode_nomenclature",
            record_id: nomenclature_id,
            action: "DELETE",
            old_values: Some(serde_json::json!({ "name": nom_name }).to_string()),
            new_values: None,
            changed_fields: vec!["deleted".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
