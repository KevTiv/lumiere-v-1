//! Shared validation and application of observed stock corrections.
use spacetimedb::{ReducerContext, Table};

use crate::core::organization::{company, require_company_in_organization};
use crate::core::reference::{require_active_currency_for_organization, uom};
use crate::inventory::inventory_close::assert_inventory_writable;
use crate::inventory::packing::stock_package;
use crate::inventory::product::product;
use crate::inventory::stock::{
    require_location_in_org, require_product_in_org, stock_quant, StockQuant,
};
pub(crate) use crate::inventory::stock_correction_balance::require_nonnegative_finite;
use crate::inventory::stock_correction_balance::validate_balance;
use crate::inventory::tracking::stock_production_lot;
use crate::inventory::warehouse::stock_location;

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct CorrectionIdentity {
    pub organization_id: u64,
    pub company_id: u64,
    pub product_id: u64,
    pub location_id: u64,
    pub lot_id: Option<u64>,
    pub package_id: Option<u64>,
}

/// Validate the relation graph and base unit; correction DTOs do not convert units.
pub(crate) fn validate_correction_target(
    ctx: &ReducerContext,
    target: CorrectionIdentity,
    uom_id: u64,
) -> Result<(f64, u64), String> {
    require_company_in_organization(ctx, target.organization_id, target.company_id)?;
    require_product_in_org(ctx, target.organization_id, target.product_id)?;
    require_location_in_org(ctx, target.organization_id, target.location_id)?;
    let location = ctx
        .db
        .stock_location()
        .id()
        .find(target.location_id)
        .ok_or("location not found")?;
    if location
        .company_id
        .is_some_and(|id| id != target.company_id)
        || location.usage != "internal"
    {
        return Err("stock correction requires an internal location in this company".to_string());
    }
    let product = ctx
        .db
        .product()
        .id()
        .find(target.product_id)
        .ok_or("product not found")?;
    if product.uom_id != uom_id {
        return Err("stock correction unit must be the product stock unit".to_string());
    }
    let unit = ctx
        .db
        .uom()
        .id()
        .find(uom_id)
        .ok_or("stock unit not found")?;
    if unit.organization_id != target.organization_id || !unit.is_active {
        return Err("stock unit is not active in this organization".to_string());
    }
    if product.type_ == "service" || product.tracking == "serial" {
        return Err(
            "stock correction does not support service or serial-tracked products".to_string(),
        );
    }
    if product.tracking == "lot" && target.lot_id.is_none() {
        return Err("lot-tracked stock correction requires a lot".to_string());
    }
    if let Some(id) = target.lot_id {
        let lot = ctx
            .db
            .stock_production_lot()
            .id()
            .find(id)
            .ok_or("lot not found")?;
        if lot.organization_id != target.organization_id
            || lot.company_id != target.company_id
            || lot.product_id != target.product_id
            || lot.is_scrap
            || lot.is_locked
            || lot.owner_id.is_some()
        {
            return Err("lot is not available for this stock correction".to_string());
        }
    }
    if let Some(id) = target.package_id {
        let package = ctx
            .db
            .stock_package()
            .id()
            .find(id)
            .ok_or("package not found")?;
        if package.organization_id != target.organization_id
            || package.company_id != target.company_id
            || package.state == "cancelled"
            || package
                .location_id
                .is_some_and(|id| id != target.location_id)
        {
            return Err("package does not belong to this stock correction".to_string());
        }
    }
    require_nonnegative_finite(product.standard_price, "product cost")?;
    require_active_currency_for_organization(ctx, target.organization_id, product.currency_id)?;
    let company = ctx
        .db
        .company()
        .id()
        .find(target.company_id)
        .ok_or("company not found")?;
    if company.currency_id != product.currency_id {
        return Err("stock correction requires product costs in the company currency".to_string());
    }
    Ok((product.standard_price, product.currency_id))
}

/// Resolve exactly one company-owned, variant-free stock balance, never an arbitrary layer.
pub(crate) fn correction_quant(
    ctx: &ReducerContext,
    target: CorrectionIdentity,
) -> Result<Option<StockQuant>, String> {
    let mut matches = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(target.product_id)
        .filter(|q| {
            q.organization_id == target.organization_id
                && q.company_id == target.company_id
                && q.location_id == target.location_id
                && q.lot_id == target.lot_id
                && q.package_id == target.package_id
        });
    let quant = matches.next();
    if matches.next().is_some() {
        return Err(
            "stock correction target is ambiguous; reconcile stock layers first".to_string(),
        );
    }
    if quant
        .as_ref()
        .is_some_and(|q| q.owner_id.is_some() || q.product_variant_id.is_some())
    {
        return Err("stock correction cannot change owned or variant stock".to_string());
    }
    Ok(quant)
}

pub(crate) struct PreparedCorrection {
    target: CorrectionIdentity,
    quant: Option<StockQuant>,
    quantity: f64,
    cost: f64,
    currency_id: u64,
}

/// Validate everything before a caller applies any line in a multi-line correction.
pub(crate) fn prepare_correction(
    ctx: &ReducerContext,
    target: CorrectionIdentity,
    uom_id: u64,
    expected_quantity: f64,
    quantity: f64,
    expected_cost: Option<f64>,
) -> Result<PreparedCorrection, String> {
    let (product_cost, currency_id) = validate_correction_target(ctx, target, uom_id)?;
    assert_inventory_writable(ctx, target.organization_id, target.company_id)?;
    require_nonnegative_finite(expected_quantity, "expected quantity")?;
    require_nonnegative_finite(quantity, "counted quantity")?;
    let quant = correction_quant(ctx, target)?;
    if quant
        .as_ref()
        .is_some_and(|q| q.currency_id.is_some_and(|id| id != currency_id))
    {
        return Err("stock currency does not match the company correction currency".to_string());
    }
    let current_quantity = quant.as_ref().map_or(0.0, |q| q.quantity);
    let reserved = quant.as_ref().map_or(0.0, |q| q.reserved_quantity);
    let cost = quant.as_ref().map_or(product_cost, |q| q.cost);
    validate_balance(
        current_quantity,
        reserved,
        cost,
        expected_quantity,
        quantity,
        expected_cost,
    )?;
    Ok(PreparedCorrection {
        target,
        quant,
        quantity,
        cost,
        currency_id,
    })
}

/// Apply a validated absolute balance, retaining its identity and reservation.
pub(crate) fn apply_correction(ctx: &ReducerContext, prepared: PreparedCorrection) -> u64 {
    let PreparedCorrection {
        target,
        quant,
        quantity,
        cost,
        currency_id,
    } = prepared;
    let value = quantity * cost;
    if let Some(quant) = quant {
        let id = quant.id;
        ctx.db.stock_quant().id().update(StockQuant {
            quantity,
            available_quantity: quantity - quant.reserved_quantity,
            value,
            inventory_quantity: quantity,
            inventory_diff_quantity: 0.0,
            inventory_quantity_set: true,
            inventory_date: Some(ctx.timestamp),
            user_id: Some(ctx.sender()),
            ..quant
        });
        id
    } else {
        ctx.db
            .stock_quant()
            .insert(StockQuant {
                id: 0,
                organization_id: target.organization_id,
                company_id: target.company_id,
                product_id: target.product_id,
                product_variant_id: None,
                location_id: target.location_id,
                lot_id: target.lot_id,
                package_id: target.package_id,
                owner_id: None,
                quantity,
                reserved_quantity: 0.0,
                available_quantity: quantity,
                in_date: Some(ctx.timestamp),
                inventory_quantity: quantity,
                inventory_diff_quantity: 0.0,
                inventory_quantity_set: true,
                is_outdated: false,
                user_id: Some(ctx.sender()),
                inventory_date: Some(ctx.timestamp),
                cost,
                value,
                cost_method: None,
                accounting_date: None,
                currency_id: Some(currency_id),
                accounting_entry_ids: vec![],
                metadata: Some("{\"source\":\"stock_correction\"}".to_string()),
            })
            .id
    }
}
