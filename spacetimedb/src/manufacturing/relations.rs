/// Manufacturing Domain — Scoped Relation Loaders (Phase 1)
///
/// All loaders follow the pattern:
///   1. Find row by ID → reject missing
///   2. Compare organization_id → reject cross-org
///   3. Compare company_id or document the org-shared exception
///   4. Check active/deleted/archived state
///   5. Return the loaded row for field derivation and persistence
///
/// Scalar validators (validate_positive_*) enforce finite, positive numeric
/// constraints that must hold before any insert or update.
use spacetimedb::ReducerContext;

use crate::core::reference::{uom, UOM};
use crate::inventory::product::{product, Product};
use crate::inventory::warehouse::{stock_location, warehouse, StockLocation, Warehouse};
use crate::manufacturing::bill_of_materials::{
    mrp_bom, mrp_routing_workcenter, MrpBom, MrpRoutingWorkcenter,
};
use crate::manufacturing::manufacturing_orders::{mrp_workorder, MrpWorkorder};
use crate::manufacturing::work_centers::{mrp_workcenter, MrpWorkcenter};

// ── Product ──────────────────────────────────────────────────────────────────

/// Load a product and verify it belongs to the organization and is active.
///
/// Products are organization-scoped (not company-private). This is an
/// intentional domain exception: products may be shared across companies
/// within the same organization.
pub(crate) fn require_product_for_manufacturing(
    ctx: &ReducerContext,
    organization_id: u64,
    product_id: u64,
    role: &str,
) -> Result<Product, String> {
    let product = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or_else(|| format!("{role} product {product_id} not found"))?;
    if product.organization_id != organization_id {
        return Err(format!(
            "{role} product does not belong to this organization"
        ));
    }
    if !product.active {
        return Err(format!("{role} product {product_id} is archived"));
    }
    Ok(product)
}

// ── UOM ──────────────────────────────────────────────────────────────────────

/// Load a UOM and verify it belongs to the organization and is active.
pub(crate) fn require_uom_in_org(
    ctx: &ReducerContext,
    organization_id: u64,
    uom_id: u64,
    role: &str,
) -> Result<UOM, String> {
    let uom = ctx
        .db
        .uom()
        .id()
        .find(&uom_id)
        .ok_or_else(|| format!("{role} UOM {uom_id} not found"))?;
    if uom.organization_id != organization_id {
        return Err(format!("{role} UOM does not belong to this organization"));
    }
    if !uom.is_active {
        return Err(format!("{role} UOM {uom_id} is inactive"));
    }
    Ok(uom)
}

/// Verify that two UOMs share the same category, making them compatible for
/// quantity conversion.
pub(crate) fn require_uom_compatible(
    product_uom: &UOM,
    bom_uom: &UOM,
    role: &str,
) -> Result<(), String> {
    if product_uom.category_id != bom_uom.category_id {
        return Err(format!(
            "{role} UOM category mismatch: product UOM category {} vs supplied UOM category {}",
            product_uom.category_id, bom_uom.category_id
        ));
    }
    Ok(())
}

// ── Warehouse & Location ──────────────────────────────────────────────────────

/// Load a warehouse and verify it belongs to the organization, company, and is active.
pub(crate) fn require_warehouse_for_manufacturing(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    warehouse_id: u64,
    role: &str,
) -> Result<Warehouse, String> {
    let wh = ctx
        .db
        .warehouse()
        .id()
        .find(&warehouse_id)
        .ok_or_else(|| format!("{role} warehouse {warehouse_id} not found"))?;
    if wh.organization_id != organization_id {
        return Err(format!(
            "{role} warehouse does not belong to this organization"
        ));
    }
    if wh.company_id != company_id {
        return Err(format!("{role} warehouse does not belong to this company"));
    }
    if !wh.is_active {
        return Err(format!("{role} warehouse {warehouse_id} is not active"));
    }
    Ok(wh)
}

/// Load a stock location and verify it belongs to the organization and is active.
///
/// StockLocation.company_id is Option<u64> (locations may be org-shared), so
/// only organization scope is enforced here.
pub(crate) fn require_location_for_manufacturing(
    ctx: &ReducerContext,
    organization_id: u64,
    location_id: u64,
    role: &str,
) -> Result<StockLocation, String> {
    let loc = ctx
        .db
        .stock_location()
        .id()
        .find(&location_id)
        .ok_or_else(|| format!("{role} location {location_id} not found"))?;
    if loc.organization_id != organization_id {
        return Err(format!(
            "{role} location does not belong to this organization"
        ));
    }
    if !loc.active {
        return Err(format!("{role} location {location_id} is not active"));
    }
    Ok(loc)
}

// ── BOM ──────────────────────────────────────────────────────────────────────

/// Load a BOM header and verify it belongs to the organization and company.
pub(crate) fn require_bom_in_company(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    bom_id: u64,
    role: &str,
) -> Result<MrpBom, String> {
    let bom = ctx
        .db
        .mrp_bom()
        .id()
        .find(&bom_id)
        .ok_or_else(|| format!("{role} BOM {bom_id} not found"))?;
    if bom.organization_id != organization_id {
        return Err(format!("{role} BOM does not belong to this organization"));
    }
    if bom.company_id != company_id {
        return Err(format!("{role} BOM does not belong to this company"));
    }
    Ok(bom)
}

// ── Routing Workcenter ────────────────────────────────────────────────────────

/// Load a routing workcenter operation and verify it belongs to the organization
/// and company.
pub(crate) fn require_routing_workcenter_in_company(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    routing_id: u64,
    role: &str,
) -> Result<MrpRoutingWorkcenter, String> {
    let routing = ctx
        .db
        .mrp_routing_workcenter()
        .id()
        .find(&routing_id)
        .ok_or_else(|| format!("{role} routing operation {routing_id} not found"))?;
    if routing.organization_id != organization_id {
        return Err(format!(
            "{role} routing operation does not belong to this organization"
        ));
    }
    if routing.company_id != company_id {
        return Err(format!(
            "{role} routing operation does not belong to this company"
        ));
    }
    Ok(routing)
}

// ── Workcenter ────────────────────────────────────────────────────────────────

/// Load a workcenter and verify it belongs to the organization, company, and is active.
pub(crate) fn require_active_workcenter_in_company(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    workcenter_id: u64,
    role: &str,
) -> Result<MrpWorkcenter, String> {
    let wc = ctx
        .db
        .mrp_workcenter()
        .id()
        .find(&workcenter_id)
        .ok_or_else(|| format!("{role} workcenter {workcenter_id} not found"))?;
    if wc.organization_id != organization_id {
        return Err(format!(
            "{role} workcenter does not belong to this organization"
        ));
    }
    if wc.company_id != company_id {
        return Err(format!("{role} workcenter does not belong to this company"));
    }
    if !wc.active {
        return Err(format!("{role} workcenter {workcenter_id} is not active"));
    }
    Ok(wc)
}

// ── Workorder ─────────────────────────────────────────────────────────────────

/// Load a workorder and verify it belongs to the organization and company.
pub(crate) fn require_workorder_in_company(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    workorder_id: u64,
    role: &str,
) -> Result<MrpWorkorder, String> {
    let wo = ctx
        .db
        .mrp_workorder()
        .id()
        .find(&workorder_id)
        .ok_or_else(|| format!("{role} workorder {workorder_id} not found"))?;
    if wo.organization_id != organization_id {
        return Err(format!(
            "{role} workorder does not belong to this organization"
        ));
    }
    if wo.company_id != company_id {
        return Err(format!("{role} workorder does not belong to this company"));
    }
    Ok(wo)
}

// ── Scalar validators ─────────────────────────────────────────────────────────

/// Reject zero, negative, infinite, or NaN quantities.
pub(crate) fn validate_positive_qty(qty: f64, field: &str) -> Result<(), String> {
    if !qty.is_finite() || qty <= 0.0 {
        return Err(format!(
            "{field} must be a finite positive number, got {qty}"
        ));
    }
    Ok(())
}

/// Reject zero, negative, infinite, or NaN durations.
pub(crate) fn validate_positive_duration(dur: f64, field: &str) -> Result<(), String> {
    if !dur.is_finite() || dur <= 0.0 {
        return Err(format!(
            "{field} must be a finite positive duration, got {dur}"
        ));
    }
    Ok(())
}

/// Reject zero, negative, infinite, or NaN capacity values.
pub(crate) fn validate_positive_capacity(cap: f64, field: &str) -> Result<(), String> {
    if !cap.is_finite() || cap <= 0.0 {
        return Err(format!(
            "{field} must be a finite positive capacity, got {cap}"
        ));
    }
    Ok(())
}
