/// Purchase Orders Module — Purchase Quotations, Orders, and Requisitions
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **PurchaseOrder** | Purchase orders and quotations |
/// | **PurchaseOrderLine** | Purchase order lines with products, quantities, and pricing |
/// | **PurchaseRequisition** | Internal purchase requests/RFQs |
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::analytic_accounting::account_analytic_account;
use crate::accounting::payment_terms::account_payment_term;
use crate::accounting::tax_management::account_tax;
use crate::core::organization::{company_id_from_scope, require_company_in_organization};
use crate::core::reference::require_active_currency_by_id;
use crate::crm::contacts::{contact, Contact};
use crate::helpers::{
    calculate_tax, check_permission, next_doc_number, write_audit_log_v2, AuditLogParams,
};
use crate::hr::employees::hr_department;
use crate::inventory::product::{product, product_variant, Product};
use crate::inventory::tracking::stock_production_lot;
use crate::manufacturing::relations::{require_uom_compatible, require_uom_in_org};
use crate::sales::oms_extensions::{account_fiscal_position, account_incoterm};
use crate::types::TaxTypeUse;
use crate::types::{
    ExclusiveMode, IsQuantityCopy, LineState, PoInvoiceStatus, PoState, RequisitionState,
};
use crate::workflow::action_registry::{
    GuardedActionInput, GuardedActionKey, GUARDED_ACTION_SCHEMA_VERSION,
};
use crate::workflow::approval_gate::{
    request_guarded_action, GuardedActionGateOutcome, RequestGuardedActionParams,
};

// ── Tables ───────────────────────────────────────────────────────────────────

/// Purchase Order — Quotations and Confirmed Purchase Orders
#[spacetimedb::table(
    accessor = purchase_order,
    public,
    index(accessor = purchase_order_by_org, btree(columns = [organization_id])),
    index(accessor = purchase_order_by_partner, btree(columns = [partner_id]))
)]
pub struct PurchaseOrder {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    /// Tenant isolation — always required
    pub organization_id: u64,
    pub name: Option<String>,
    pub origin: Option<String>,
    pub partner_ref: Option<String>,
    pub state: PoState,
    pub date_order: Timestamp,
    pub date_approve: Option<Timestamp>,
    pub partner_id: u64,
    pub dest_address_id: Option<u64>,
    pub currency_id: u64,
    pub payment_term_id: Option<u64>,
    pub fiscal_position_id: Option<u64>,
    pub date_planned: Option<Timestamp>,
    pub date_calendar_start: Option<Timestamp>,
    pub date_calendar_done: Option<Timestamp>,
    pub company_id: u64,
    pub user_id: Identity,
    pub invoice_count: u32,
    pub invoice_ids: Vec<u64>,
    pub invoice_status: PoInvoiceStatus,
    pub picking_count: u32,
    pub picking_ids: Vec<u64>,
    pub effective_date: Option<Timestamp>,
    pub amount_untaxed: f64,
    pub amount_tax: f64,
    pub amount_total: f64,
    /// FX snapshot at confirm (`1.0` when PO currency matches company currency).
    pub currency_rate: f64,
    /// Optional qty three-way match epsilon; `None` → [`DEFAULT_QTY_MATCH_TOLERANCE`].
    pub match_qty_tolerance: Option<f64>,
    /// Optional absolute price variance tolerance; `None` → [`DEFAULT_PRICE_MATCH_TOLERANCE`].
    pub match_price_tolerance: Option<f64>,
    pub receipt_status: String,
    pub notes: Option<String>,
    pub message_main_attachment_id: Option<u64>,
    pub message_follower_ids: Vec<u64>,
    pub message_ids: Vec<u64>,
    pub has_message: bool,
    pub activity_ids: Vec<u64>,
    pub activity_state: Option<String>,
    pub activity_date_deadline: Option<Timestamp>,
    pub activity_type_id: Option<u64>,
    pub activity_user_id: Option<Identity>,
    pub activity_summary: Option<String>,
    pub access_url: Option<String>,
    pub access_token: Option<String>,
    pub access_warning: Option<String>,
    pub is_locked: bool,
    pub is_quantity_copy: String,
    pub incoterm_id: Option<u64>,
    pub incoterm_location: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Purchase Order Line — Products, quantities, and pricing for purchase orders
#[spacetimedb::table(
    accessor = purchase_order_line,
    public,
    index(accessor = purchase_order_line_by_org, btree(columns = [organization_id])),
    index(accessor = purchase_order_line_by_order, btree(columns = [order_id]))
)]
pub struct PurchaseOrderLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    /// Tenant isolation — always required
    pub organization_id: u64,
    pub sequence: u32,
    pub product_qty: f64,
    pub product_uom_qty: f64,
    pub date_planned: Option<Timestamp>,
    pub date_departure: Option<Timestamp>,
    pub date_arrival: Option<Timestamp>,
    pub product_uom: u64,
    pub product_id: u64,
    pub product_type: Option<String>,
    pub product_variant_id: Option<u64>,
    pub product_template_id: Option<u64>,
    pub price_unit: f64,
    pub price_subtotal: f64,
    pub price_total: f64,
    pub price_tax: f64,
    pub order_id: u64,
    pub account_analytic_id: Option<u64>,
    pub analytic_tag_ids: Vec<u64>,
    pub company_id: u64,
    pub state: LineState,
    pub invoice_lines: Vec<u64>,
    pub qty_invoiced: f64,
    pub qty_received_method: Vec<String>,
    pub qty_received: f64,
    pub qty_received_manual: f64,
    pub qty_to_invoice: f64,
    pub partner_id: u64,
    pub currency_id: u64,
    pub display_type: Option<String>,
    pub product_no_variant_attribute_value_ids: Vec<u64>,
    pub product_custom_attribute_value_ids: Vec<u64>,
    pub propagate_cancel: bool,
    pub sale_line_id: Option<u64>,
    pub sale_order_id: Option<u64>,
    pub move_dest_ids: Vec<u64>,
    pub move_ids: Vec<u64>,
    /// First-class three-way match label (`pending`, `matched`, `over_billed`, …).
    pub match_state: String,
    /// Optional production lot to stamp on inbound receipt moves.
    pub lot_id: Option<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Purchase Requisition — Internal requests for purchase (RFQ)
#[spacetimedb::table(
    accessor = purchase_requisition,
    public,
    index(accessor = purchase_requisition_by_org, btree(columns = [organization_id])),
    index(accessor = purchase_requisition_by_user, btree(columns = [user_id]))
)]
pub struct PurchaseRequisition {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    /// Tenant isolation — always required
    pub organization_id: u64,
    pub origin: Option<String>,
    pub ordering_date: Option<Timestamp>,
    pub date_end: Option<Timestamp>,
    pub schedule_date: Option<Timestamp>,
    pub user_id: Identity,
    pub company_id: u64,
    pub department_id: Option<u64>,
    pub description: Option<String>,
    pub state: RequisitionState,
    pub exclusive: String,
    pub account_analytic_id: Option<u64>,
    pub picking_type_id: Option<u64>,
    pub line_ids: Vec<u64>,
    pub purchase_ids: Vec<u64>,
    pub order_count: u32,
    pub vendor_id: Option<u64>,
    pub multiple_product: bool,
    pub activity_ids: Vec<u64>,
    pub message_follower_ids: Vec<u64>,
    pub message_ids: Vec<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Purchase requisition line — products/qty requested for conversion or RFQ.
#[spacetimedb::table(
    accessor = purchase_requisition_line,
    public,
    index(accessor = purchase_requisition_line_by_req, btree(columns = [requisition_id])),
    index(accessor = purchase_requisition_line_by_org, btree(columns = [organization_id]))
)]
pub struct PurchaseRequisitionLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub requisition_id: u64,
    pub product_id: u64,
    pub product_uom: u64,
    pub product_uom_qty: f64,
    pub name: Option<String>,
    pub sequence: u32,
}

// ── Input Params ──────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePurchaseOrderParams {
    pub company_id: Option<u64>,
    pub partner_id: u64,
    pub currency_id: u64,
    pub origin: Option<String>,
    pub partner_ref: Option<String>,
    pub notes: Option<String>,
    pub date_planned: Option<Timestamp>,
    pub payment_term_id: Option<u64>,
    pub fiscal_position_id: Option<u64>,
    pub incoterm_id: Option<u64>,
    pub incoterm_location: Option<String>,
    pub user_id: Option<Identity>,
    pub invoice_ids: Vec<u64>,
    pub picking_ids: Vec<u64>,
    pub message_follower_ids: Vec<u64>,
    pub message_ids: Vec<u64>,
    pub activity_ids: Vec<u64>,
    pub is_quantity_copy: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct AddPurchaseOrderLineParams {
    pub product_id: u64,
    pub quantity: f64,
    pub uom_id: u64,
    pub price_unit: f64,
    pub discount: f64,
    pub tax_ids: Vec<u64>,
    pub name: Option<String>,
    pub sequence: Option<u32>,
    pub display_type: Option<String>,
    pub product_variant_id: Option<u64>,
    pub account_analytic_id: Option<u64>,
    pub date_planned: Option<Timestamp>,
    pub propagate_cancel: Option<bool>,
    pub lot_id: Option<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdatePurchaseOrderParams {
    pub origin: Option<String>,
    pub partner_ref: Option<String>,
    pub notes: Option<String>,
    pub date_planned: Option<Timestamp>,
    pub payment_term_id: Option<u64>,
    pub fiscal_position_id: Option<u64>,
    pub incoterm_id: Option<u64>,
    pub incoterm_location: Option<String>,
    pub partner_id: Option<u64>,
    pub currency_id: Option<u64>,
    pub match_qty_tolerance: Option<f64>,
    pub match_price_tolerance: Option<f64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdatePurchaseOrderLineParams {
    pub product_id: Option<u64>,
    pub quantity: Option<f64>,
    pub uom_id: Option<u64>,
    pub price_unit: Option<f64>,
    pub tax_ids: Option<Vec<u64>>,
    pub date_planned: Option<Timestamp>,
    pub product_variant_id: Option<u64>,
    pub account_analytic_id: Option<u64>,
    pub display_type: Option<String>,
    pub propagate_cancel: Option<bool>,
    pub lot_id: Option<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePurchaseRequisitionLineParams {
    pub product_id: u64,
    pub product_uom: u64,
    pub product_uom_qty: f64,
    pub name: Option<String>,
    pub sequence: Option<u32>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct AddPurchaseRequisitionLineParams {
    pub product_id: u64,
    pub product_uom: u64,
    pub product_uom_qty: f64,
    pub name: Option<String>,
    pub sequence: Option<u32>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePurchaseRequisitionParams {
    pub company_id: Option<u64>,
    pub origin: Option<String>,
    pub description: Option<String>,
    pub ordering_date: Option<Timestamp>,
    pub date_end: Option<Timestamp>,
    pub schedule_date: Option<Timestamp>,
    pub department_id: Option<u64>,
    pub exclusive: Option<String>,
    pub multiple_product: bool,
    /// Legacy relation bookkeeping; prefer `lines` for product/qty.
    pub line_ids: Vec<u64>,
    pub lines: Vec<CreatePurchaseRequisitionLineParams>,
    pub purchase_ids: Vec<u64>,
    pub vendor_id: Option<u64>,
    pub activity_ids: Vec<u64>,
    pub message_follower_ids: Vec<u64>,
    pub message_ids: Vec<u64>,
    pub metadata: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn validate_order_in_organization(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
) -> Result<PurchaseOrder, String> {
    let order = ctx
        .db
        .purchase_order()
        .id()
        .find(&order_id)
        .ok_or("Purchase order not found")?;

    if order.organization_id != organization_id {
        return Err("Purchase order does not belong to this organization".to_string());
    }
    Ok(order)
}

/// Load a requisition through its tenant-owned parent scope.  Lifecycle reducers
/// deliberately take no caller company argument: the stored company is the
/// authoritative audit and mutation scope.
fn require_requisition_in_organization(
    ctx: &ReducerContext,
    organization_id: u64,
    requisition_id: u64,
) -> Result<PurchaseRequisition, String> {
    let requisition = ctx
        .db
        .purchase_requisition()
        .id()
        .find(&requisition_id)
        .ok_or("Purchase requisition not found")?;
    if requisition.organization_id != organization_id {
        return Err("Purchase requisition does not belong to this organization".to_string());
    }
    require_company_in_organization(ctx, organization_id, requisition.company_id)?;
    Ok(requisition)
}

fn require_vendor_in_organization(
    ctx: &ReducerContext,
    organization_id: u64,
    partner_id: u64,
) -> Result<Contact, String> {
    let vendor = ctx
        .db
        .contact()
        .id()
        .find(&partner_id)
        .ok_or("Vendor contact not found")?;
    if vendor.organization_id != organization_id {
        return Err("Vendor does not belong to this organization".to_string());
    }
    if !vendor.is_vendor {
        return Err("Partner is not a vendor".to_string());
    }
    Ok(vendor)
}

fn require_vendor_for_company(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    partner_id: u64,
) -> Result<Contact, String> {
    let vendor = require_vendor_in_organization(ctx, organization_id, partner_id)?;
    if vendor.deleted_at.is_some() || vendor.merge_target_id.is_some() {
        return Err("Vendor is deleted or merged".to_string());
    }
    if let Some(vendor_company_id) = vendor.company_id {
        if vendor_company_id != company_id {
            return Err("Vendor does not belong to this company".to_string());
        }
    }
    Ok(vendor)
}

fn require_product_and_uom_in_organization(
    ctx: &ReducerContext,
    organization_id: u64,
    product_id: u64,
    uom_id: u64,
) -> Result<Product, String> {
    let product = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or("Product not found")?;
    if product.organization_id != organization_id {
        return Err("Product does not belong to this organization".to_string());
    }
    if !product.active || !product.purchase_ok {
        return Err("Product is inactive or not purchasable".to_string());
    }
    let product_uom = require_uom_in_org(ctx, organization_id, product.uom_id, "Product")?;
    let requested_uom = require_uom_in_org(ctx, organization_id, uom_id, "Purchase")?;
    require_uom_compatible(&product_uom, &requested_uom, "Purchase product")?;
    Ok(product)
}

fn require_purchase_taxes(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    tax_ids: &[u64],
) -> Result<(), String> {
    let mut seen = std::collections::HashSet::with_capacity(tax_ids.len());
    for tax_id in tax_ids {
        if !seen.insert(*tax_id) {
            return Err("Duplicate purchase tax relation".to_string());
        }
        let tax = ctx
            .db
            .account_tax()
            .id()
            .find(tax_id)
            .ok_or("Purchase tax not found")?;
        if tax.organization_id != organization_id || tax.company_id != company_id {
            return Err(
                "Purchase tax does not belong to this organization and company".to_string(),
            );
        }
        if !tax.active || !matches!(tax.type_tax_use, TaxTypeUse::Purchase | TaxTypeUse::None) {
            return Err("Purchase tax is inactive or incompatible".to_string());
        }
    }
    Ok(())
}

fn require_analytic_account_for_company(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    analytic_account_id: Option<u64>,
) -> Result<(), String> {
    let Some(analytic_account_id) = analytic_account_id else {
        return Ok(());
    };
    let account = ctx
        .db
        .account_analytic_account()
        .id()
        .find(&analytic_account_id)
        .ok_or("Analytic account not found")?;
    if account.organization_id != organization_id || account.company_id != company_id {
        return Err(
            "Analytic account does not belong to this organization and company".to_string(),
        );
    }
    if !account.active {
        return Err("Analytic account is inactive".to_string());
    }
    Ok(())
}

fn require_product_variant_for_product(
    ctx: &ReducerContext,
    organization_id: u64,
    product_id: u64,
    product_variant_id: Option<u64>,
) -> Result<(), String> {
    let Some(product_variant_id) = product_variant_id else {
        return Ok(());
    };
    let variant = ctx
        .db
        .product_variant()
        .id()
        .find(&product_variant_id)
        .ok_or("Product variant not found")?;
    if variant.organization_id != organization_id || !variant.is_active {
        return Err("Product variant is inactive or outside this organization".to_string());
    }
    if variant.product_tmpl_id != product_id {
        return Err("Product variant does not belong to the supplied product".to_string());
    }
    Ok(())
}

fn require_lot_for_product_and_company(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
    lot_id: Option<u64>,
) -> Result<(), String> {
    let Some(lot_id) = lot_id else {
        return Ok(());
    };
    let lot = ctx
        .db
        .stock_production_lot()
        .id()
        .find(&lot_id)
        .ok_or("Production lot not found")?;
    if lot.organization_id != organization_id
        || lot.company_id != company_id
        || lot.product_id != product_id
    {
        return Err(
            "Production lot does not match this organization, company, and product".to_string(),
        );
    }
    if lot.is_locked || lot.is_scrap {
        return Err("Production lot is locked or scrapped".to_string());
    }
    Ok(())
}

fn require_purchase_order_header_relations(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    partner_id: u64,
    currency_id: u64,
    payment_term_id: Option<u64>,
    fiscal_position_id: Option<u64>,
    incoterm_id: Option<u64>,
) -> Result<(), String> {
    require_vendor_for_company(ctx, organization_id, company_id, partner_id)?;
    require_active_currency_by_id(ctx, currency_id)?;
    if let Some(payment_term_id) = payment_term_id {
        let term = ctx
            .db
            .account_payment_term()
            .id()
            .find(&payment_term_id)
            .ok_or("Payment term not found")?;
        if term.organization_id != organization_id || !term.is_active {
            return Err("Payment term is inactive or outside this organization".to_string());
        }
    }
    if let Some(fiscal_position_id) = fiscal_position_id {
        let position = ctx
            .db
            .account_fiscal_position()
            .id()
            .find(&fiscal_position_id)
            .ok_or("Fiscal position not found")?;
        if position.organization_id != organization_id
            || !position.is_active
            || position.company_id.is_some_and(|id| id != company_id)
        {
            return Err(
                "Fiscal position is inactive or incompatible with this company".to_string(),
            );
        }
    }
    if let Some(incoterm_id) = incoterm_id {
        let incoterm = ctx
            .db
            .account_incoterm()
            .id()
            .find(&incoterm_id)
            .ok_or("Incoterm not found")?;
        if incoterm.organization_id != organization_id || !incoterm.is_active {
            return Err("Incoterm is inactive or outside this organization".to_string());
        }
    }
    Ok(())
}

fn require_line_matches_order(
    line: &PurchaseOrderLine,
    order: &PurchaseOrder,
) -> Result<(), String> {
    if line.organization_id != order.organization_id || line.company_id != order.company_id {
        return Err("Purchase order line tenant scope does not match its parent order".to_string());
    }
    if line.partner_id != order.partner_id || line.currency_id != order.currency_id {
        return Err(
            "Purchase order line business scope does not match its parent order".to_string(),
        );
    }
    Ok(())
}

fn require_requisition_relations(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    department_id: Option<u64>,
    vendor_id: Option<u64>,
) -> Result<(), String> {
    if let Some(department_id) = department_id {
        let department = ctx
            .db
            .hr_department()
            .id()
            .find(&department_id)
            .ok_or("Department not found")?;
        if department.organization_id != organization_id
            || department.company_id != company_id
            || !department.is_active
        {
            return Err(
                "Department is inactive or does not belong to this organization and company"
                    .to_string(),
            );
        }
    }
    if let Some(vendor_id) = vendor_id {
        require_vendor_for_company(ctx, organization_id, company_id, vendor_id)?;
    }
    Ok(())
}

/// Effective qty match tolerance for a PO (`match_qty_tolerance` or default).
pub fn qty_match_tolerance_for_order(order: &PurchaseOrder) -> f64 {
    order
        .match_qty_tolerance
        .filter(|t| *t >= 0.0)
        .unwrap_or(DEFAULT_QTY_MATCH_TOLERANCE)
}

/// Effective price match tolerance for a PO (`match_price_tolerance` or default).
pub fn price_match_tolerance_for_order(order: &PurchaseOrder) -> f64 {
    order
        .match_price_tolerance
        .filter(|t| *t >= 0.0)
        .unwrap_or(DEFAULT_PRICE_MATCH_TOLERANCE)
}

fn merge_match_state_metadata(existing: &Option<String>, match_state: &str) -> Option<String> {
    let mut metadata = existing
        .as_ref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|parsed| parsed.as_object().cloned())
        .unwrap_or_default();
    metadata.insert(
        "match_state".to_string(),
        serde_json::Value::String(match_state.to_string()),
    );
    Some(serde_json::Value::Object(metadata).to_string())
}

fn requisition_lines(ctx: &ReducerContext, requisition_id: u64) -> Vec<PurchaseRequisitionLine> {
    ctx.db
        .purchase_requisition_line()
        .purchase_requisition_line_by_req()
        .filter(&requisition_id)
        .collect()
}

/// Resolve unit price for convert: preferred vendor supplier info, else product standard/list, else 0.
fn resolve_requisition_line_price(
    ctx: &ReducerContext,
    organization_id: u64,
    vendor_id: u64,
    product_id: u64,
) -> f64 {
    use crate::inventory::product::product_supplier_info;

    if let Some(info) = ctx.db.product_supplier_info().iter().find(|s| {
        s.organization_id == organization_id
            && s.partner_id == vendor_id
            && s.is_active
            && (s.product_id == Some(product_id) || s.product_tmpl_id == Some(product_id))
    }) {
        return info.price;
    }
    ctx.db
        .product()
        .id()
        .find(&product_id)
        .map(|p| {
            if p.standard_price > 0.0 {
                p.standard_price
            } else {
                p.list_price
            }
        })
        .unwrap_or(0.0)
}

/// Persist column + `metadata.match_state` from [`compute_line_match_state`] using the PO tolerance.
pub fn persist_line_match_state(
    ctx: &ReducerContext,
    order: &PurchaseOrder,
    mut line: PurchaseOrderLine,
) {
    let tolerance = qty_match_tolerance_for_order(order);
    let match_state = compute_line_match_state(&line, tolerance);
    line.match_state = match_state.clone();
    line.metadata = merge_match_state_metadata(&line.metadata, &match_state);
    line.write_uid = ctx.sender();
    line.write_date = ctx.timestamp;
    ctx.db.purchase_order_line().id().update(line);
}

/// Snapshots PO→company FX at confirm (fail closed if rate missing for multi-currency).
fn confirm_po_exchange_rate_snapshot(
    ctx: &ReducerContext,
    organization_id: u64,
    order: &PurchaseOrder,
) -> Result<(f64, String, String), String> {
    use crate::core::organization::company;
    use crate::core::reference::{require_currency_by_id, resolve_currency_rate_as_of};

    let company_row = ctx
        .db
        .company()
        .id()
        .find(&order.company_id)
        .ok_or("Company not found for purchase order")?;
    let from = require_currency_by_id(ctx, order.currency_id)?.code;
    let to = require_currency_by_id(ctx, company_row.currency_id)?.code;
    if order.currency_id == company_row.currency_id {
        return Ok((1.0, from, to));
    }
    let rate = resolve_currency_rate_as_of(
        ctx,
        organization_id,
        order.company_id,
        order.currency_id,
        company_row.currency_id,
        ctx.timestamp,
    )?;
    Ok((rate, from, to))
}

fn merge_po_exchange_rate_metadata(
    existing: &Option<String>,
    rate: f64,
    from: &str,
    to: &str,
    at: Timestamp,
) -> Option<String> {
    let mut metadata = existing
        .as_ref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|parsed| parsed.as_object().cloned())
        .unwrap_or_default();
    metadata.insert("exchange_rate".to_string(), serde_json::json!(rate));
    metadata.insert(
        "exchange_rate_from".to_string(),
        serde_json::Value::String(from.to_string()),
    );
    metadata.insert(
        "exchange_rate_to".to_string(),
        serde_json::Value::String(to.to_string()),
    );
    let at_micros = at
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_micros() as u64;
    metadata.insert(
        "exchange_rate_at_micros".to_string(),
        serde_json::json!(at_micros),
    );
    Some(serde_json::Value::Object(metadata).to_string())
}

/// Wave C encumbrance MVP: stamp commitment amount on PO metadata at confirm.
/// Does not mutate crossovered_budget / budget_post (actuals stay on journal post).
fn merge_po_encumbrance_metadata(existing: &Option<String>, amount_total: f64) -> Option<String> {
    let mut metadata = existing
        .as_ref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|parsed| parsed.as_object().cloned())
        .unwrap_or_default();
    metadata.insert("encumbrance".to_string(), serde_json::json!(amount_total));
    metadata.insert(
        "encumbrance_note".to_string(),
        serde_json::Value::String(
            "PO commitment recorded in metadata only; budget actuals sync on journal post"
                .to_string(),
        ),
    );
    Some(serde_json::Value::Object(metadata).to_string())
}

// ── Reducers ──────────────────────────────────────────────────────────────────

/// Create a new purchase order (quotation)
#[reducer]
pub fn create_purchase_order(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreatePurchaseOrderParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "create")?;

    if let Some(ref iqc) = params.is_quantity_copy {
        IsQuantityCopy::from_str(iqc)?;
    }

    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    require_purchase_order_header_relations(
        ctx,
        organization_id,
        company_id,
        params.partner_id,
        params.currency_id,
        params.payment_term_id,
        params.fiscal_position_id,
        params.incoterm_id,
    )?;

    // Invoice, picking, activity, and message collections are lifecycle-owned
    // reverse relations. They must be rebuilt from their authoritative child
    // tables rather than accepted from a create command.
    let invoice_count = 0;
    let picking_count = 0;
    let has_message = false;
    let is_quantity_copy = params
        .is_quantity_copy
        .unwrap_or_else(|| "none".to_string());

    let order = ctx.db.purchase_order().insert(PurchaseOrder {
        id: 0,
        organization_id,
        name: Some(next_doc_number(ctx, "PO")),
        origin: params.origin,
        partner_ref: params.partner_ref,
        state: PoState::Draft,
        date_order: ctx.timestamp,
        date_approve: None,
        partner_id: params.partner_id,
        dest_address_id: None,
        currency_id: params.currency_id,
        payment_term_id: params.payment_term_id,
        fiscal_position_id: params.fiscal_position_id,
        date_planned: params.date_planned,
        date_calendar_start: None,
        date_calendar_done: None,
        company_id,
        // The PO owner/audit actor is authenticated server context. A command
        // must not impersonate an arbitrary identity through `user_id`.
        user_id: ctx.sender(),
        invoice_count,
        invoice_ids: Vec::new(),
        invoice_status: PoInvoiceStatus::No,
        picking_count,
        picking_ids: Vec::new(),
        effective_date: None,
        amount_untaxed: 0.0,
        amount_tax: 0.0,
        amount_total: 0.0,
        currency_rate: 0.0,
        match_qty_tolerance: None,
        match_price_tolerance: None,
        receipt_status: "nothing".to_string(),
        notes: params.notes,
        message_main_attachment_id: None,
        message_follower_ids: Vec::new(),
        message_ids: Vec::new(),
        has_message,
        activity_ids: Vec::new(),
        activity_state: None,
        activity_date_deadline: None,
        activity_type_id: None,
        activity_user_id: None,
        activity_summary: None,
        access_url: None,
        access_token: None,
        access_warning: None,
        is_locked: false,
        is_quantity_copy,
        incoterm_id: params.incoterm_id,
        incoterm_location: params.incoterm_location,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "purchase_order",
            record_id: order.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "id": order.id }).to_string()),
            changed_fields: vec!["id".to_string()],
            metadata: None,
        },
    );

    log::info!("Purchase order {} created", order.id);
    Ok(())
}

/// Send purchase order to vendor (change state from Draft to Sent)
#[reducer]
pub fn send_purchase_order(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
) -> Result<(), String> {
    send_purchase_order_impl(ctx, organization_id, order_id, false)
}

pub fn send_purchase_order_impl(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
    skip_approval_check: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "write")?;

    let order = validate_order_in_organization(ctx, organization_id, order_id)?;

    if !matches!(order.state, PoState::Draft) {
        return Err("Purchase order must be in Draft state to send".to_string());
    }

    if !skip_approval_check {
        if matches!(
            request_guarded_action(
                ctx,
                organization_id,
                RequestGuardedActionParams {
                    company_id: order.company_id,
                    action: GuardedActionKey::SendPurchaseOrder,
                    action_version: GUARDED_ACTION_SCHEMA_VERSION,
                    input: GuardedActionInput::SendPurchaseOrder { order_id },
                    idempotency_key: format!("send-purchase-order:{order_id}"),
                    correlation_id: format!("purchase-order:{order_id}:send"),
                    causation_id: None,
                },
            )?,
            GuardedActionGateOutcome::HumanTaskCreated { .. }
        ) {
            return Ok(());
        }
    }

    ctx.db.purchase_order().id().update(PurchaseOrder {
        state: PoState::Sent,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(order.company_id),
            table_name: "purchase_order",
            record_id: order_id,
            action: "UPDATE",
            old_values: Some("Draft".to_string()),
            new_values: Some("Sent".to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    log::info!("Purchase order {} sent to vendor", order_id);
    Ok(())
}

/// Confirm purchase order (change state to Purchase)
#[reducer]
pub fn confirm_purchase_order(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
) -> Result<(), String> {
    confirm_purchase_order_impl(ctx, organization_id, order_id, false)
}

pub fn confirm_purchase_order_impl(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
    skip_approval_check: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "write")?;

    let order = validate_order_in_organization(ctx, organization_id, order_id)?;

    if !matches!(
        order.state,
        PoState::Sent | PoState::ToApprove | PoState::Draft
    ) {
        return Err(
            "Purchase order must be in Sent, ToApprove, or Draft state to confirm".to_string(),
        );
    }

    if !skip_approval_check {
        if matches!(
            request_guarded_action(
                ctx,
                organization_id,
                RequestGuardedActionParams {
                    company_id: order.company_id,
                    action: GuardedActionKey::ConfirmPurchaseOrder,
                    action_version: GUARDED_ACTION_SCHEMA_VERSION,
                    input: GuardedActionInput::ConfirmPurchaseOrder { order_id },
                    idempotency_key: format!("confirm-purchase-order:{order_id}"),
                    correlation_id: format!("purchase-order:{order_id}:confirm"),
                    causation_id: None,
                },
            )?,
            GuardedActionGateOutcome::HumanTaskCreated { .. }
        ) {
            return Ok(());
        }
    }

    let (exchange_rate, fx_from, fx_to) =
        confirm_po_exchange_rate_snapshot(ctx, organization_id, &order)?;
    let fx_metadata = merge_po_exchange_rate_metadata(
        &order.metadata,
        exchange_rate,
        &fx_from,
        &fx_to,
        ctx.timestamp,
    );
    // Encumbrance MVP: commitment note in metadata (no budget-line mutation).
    let confirm_metadata =
        merge_po_encumbrance_metadata(&fx_metadata.or(order.metadata.clone()), order.amount_total);

    let partner_id = order.partner_id;
    let company_id = order.company_id;
    let amount_total = order.amount_total;

    ctx.db.purchase_order().id().update(PurchaseOrder {
        state: PoState::Purchase,
        date_approve: Some(ctx.timestamp),
        currency_rate: exchange_rate,
        metadata: confirm_metadata,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });

    // Increment supplier_rank on the partner contact
    if let Some(vendor) = ctx.db.contact().id().find(&partner_id) {
        ctx.db.contact().id().update(Contact {
            supplier_rank: vendor.supplier_rank + 1,
            ..vendor
        });
    }

    create_incoming_pickings_for_confirmed_order(ctx, organization_id, order_id)?;

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "purchase_order",
            record_id: order_id,
            action: "UPDATE",
            old_values: Some("Sent".to_string()),
            new_values: Some("Purchase".to_string()),
            changed_fields: vec![
                "state".to_string(),
                "date_approve".to_string(),
                "currency_rate".to_string(),
                "metadata".to_string(),
            ],
            metadata: Some(serde_json::json!({ "encumbrance": amount_total }).to_string()),
        },
    );

    log::info!("Purchase order {} confirmed", order_id);
    Ok(())
}

/// Create one draft IN picking with moves for inventoriable PO lines (mirrors sales OUT confirm).
fn create_incoming_pickings_for_confirmed_order(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
) -> Result<(), String> {
    use crate::inventory::stock::{
        create_stock_move, create_stock_picking, product_requires_stock,
        resolve_supplier_stock_location, resolve_warehouse_stock_location, stock_picking,
        CreateStockMoveParams, CreateStockPickingParams,
    };
    use crate::inventory::warehouse::warehouse;

    let order = ctx
        .db
        .purchase_order()
        .id()
        .find(&order_id)
        .ok_or("Purchase order not found for picking creation")?;

    if ctx.db.stock_picking().iter().any(|p| {
        p.organization_id == organization_id
            && p.purchase_id == Some(order_id)
            && !p.is_return
            && p.picking_code.as_deref() == Some("incoming")
    }) {
        return Ok(());
    }

    let order_lines: Vec<_> = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&order_id)
        .filter(|l| l.display_type.is_none() && l.product_qty > 0.0)
        .collect();

    if order_lines.is_empty() {
        return Ok(());
    }

    // Service-only POs: no stock receipt picking.
    let has_stock_line = order_lines
        .iter()
        .any(|l| product_requires_stock(ctx, l.product_id));
    if !has_stock_line {
        return Ok(());
    }

    let company_id = order.company_id;
    let warehouse_id = ctx
        .db
        .warehouse()
        .iter()
        .find(|w| w.organization_id == organization_id && w.company_id == company_id && w.active)
        .map(|w| w.id)
        .ok_or_else(|| {
            format!(
                "No active warehouse for company {} — cannot create PO receipt picking",
                company_id
            )
        })?;

    let dest_location = resolve_warehouse_stock_location(ctx, warehouse_id);
    let src_location = resolve_supplier_stock_location(ctx, organization_id, company_id)?;
    let order_label = order
        .name
        .as_deref()
        .or(order.origin.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| order_id.to_string());

    let first_product = order_lines[0].product_id;
    let picking_name = format!("IN/{order_label}");

    create_stock_picking(
        ctx,
        organization_id,
        CreateStockPickingParams {
            company_id: Some(company_id),
            name: picking_name.clone(),
            picking_type_id: 0,
            location_id: src_location,
            location_dest_id: dest_location,
            move_type: "direct".to_string(),
            priority: "1".to_string(),
            partner_id: Some(order.partner_id),
            contact_id: None,
            scheduled_date: Some(ctx.timestamp),
            origin: Some(format!("PO/{order_label}")),
            note: order.notes.clone(),
            user_id: None,
            sale_id: None,
            purchase_id: Some(order_id),
            group_id: None,
            is_locked: false,
            immediate_transfer: false,
            is_printed: false,
            is_return: false,
            has_scrap_move: false,
            has_tracking: false,
            date: None,
            date_done: None,
            backorder_id: None,
            backorder_ids: vec![],
            show_operations: false,
            show_lots_text: false,
            show_reserved: false,
            show_check_availability: true,
            show_validate: false,
            show_mark_as_todo: true,
            show_set_qty_button: false,
            show_clear_qty_button: false,
            show_lots_m2o: false,
            product_id: Some(first_product),
            lot_id: None,
            package_id: None,
            result_package_id: None,
            owner_id: None,
            display_lot_id: None,
            location_id_name: None,
            location_dest_id_name: None,
            picking_code: Some("incoming".to_string()),
            product_tracking: None,
            product_barcode: None,
            move_line_exist: false,
            has_packages: false,
            has_move_lines: false,
            has_package: false,
            has_lot: false,
            has_owner: false,
            has_entire_package_src: false,
            has_entire_package_dest: false,
            package_level_ids: vec![],
            batch_id: None,
            metadata: Some(format!(r#"{{"purchase_order_id":{order_id}}}"#)),
        },
    )?;

    let picking = ctx
        .db
        .stock_picking()
        .iter()
        .find(|p| {
            p.organization_id == organization_id
                && p.purchase_id == Some(order_id)
                && !p.is_return
                && p.name == picking_name
        })
        .ok_or("Incoming picking not found after create")?;

    for (idx, line) in order_lines.iter().enumerate() {
        if !product_requires_stock(ctx, line.product_id) {
            continue;
        }
        let product = ctx
            .db
            .product()
            .id()
            .find(&line.product_id)
            .ok_or("Product not found for purchase order line")?;

        create_stock_move(
            ctx,
            organization_id,
            CreateStockMoveParams {
                company_id: Some(company_id),
                name: format!("{} x {}", line.product_qty, product.name),
                product_id: line.product_id,
                product_tmpl_id: line.product_id,
                product_uom: line.product_uom,
                product_uom_qty: line.product_qty,
                location_id: src_location,
                location_dest_id: dest_location,
                date_expected: ctx.timestamp,
                move_type: "incoming".to_string(),
                priority: "1".to_string(),
                reference: Some(format!("PO/{order_label}")),
                sequence: ((idx + 1) as i32) * 10,
                origin: Some(format!("PO/{order_label}")),
                note: order.notes.clone(),
                date: None,
                date_deadline: None,
                picking_id: Some(picking.id),
                picking_type_id: Some(0),
                partner_id: Some(order.partner_id),
                product_variant_id: None,
                group_id: None,
                rule_id: None,
                procure_method: "make_to_stock".to_string(),
                price_unit: line.price_unit,
                scrapped: false,
                to_refund: false,
                propagate_cancel: true,
                delay_alert: false,
                product_packaging_id: None,
                product_packaging_qty: 0.0,
                warehouse_id: Some(warehouse_id),
                production_id: None,
                raw_material_production_id: None,
                unbuild_id: None,
                consume_unbuild_id: None,
                cost_share: 0.0,
                is_subcontract: false,
                purchase_line_id: Some(line.id),
                need_release: false,
                release_ready: false,
                propagation_cancel: true,
                has_tracking: false,
                inventory_id: None,
                sale_line_id: None,
                lot_id: line.lot_id,
                serial_id: None,
                package_id: None,
                result_package_id: None,
                owner_id: None,
                package_level_id: None,
                product_type: line.product_type.clone(),
                metadata: None,
            },
        )?;
    }

    let mut picking_ids = order.picking_ids.clone();
    if !picking_ids.contains(&picking.id) {
        picking_ids.push(picking.id);
    }
    ctx.db.purchase_order().id().update(PurchaseOrder {
        picking_ids: picking_ids.clone(),
        picking_count: picking_ids.len() as u32,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });

    Ok(())
}

/// Cancel purchase order
#[reducer]
pub fn cancel_purchase_order(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "write")?;

    let order = validate_order_in_organization(ctx, organization_id, order_id)?;

    if matches!(order.state, PoState::Done | PoState::Cancelled) {
        return Err("Cannot cancel a completed or already cancelled purchase order".to_string());
    }

    ctx.db.purchase_order().id().update(PurchaseOrder {
        state: PoState::Cancelled,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(order.company_id),
            table_name: "purchase_order",
            record_id: order_id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({ "state": format!("{:?}", order.state) }).to_string(),
            ),
            new_values: Some("Cancelled".to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    log::info!("Purchase order {} cancelled", order_id);
    Ok(())
}

/// Update header fields on a draft purchase order (company-scoped).
#[reducer]
pub fn update_purchase_order(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    order_id: u64,
    params: UpdatePurchaseOrderParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "write")?;

    let order = validate_order_in_organization(ctx, organization_id, order_id)?;

    if order.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    if order.is_locked {
        return Err("Purchase order is locked".to_string());
    }

    if order.state != PoState::Draft {
        return Err("Only draft purchase orders can be updated".to_string());
    }

    require_purchase_order_header_relations(
        ctx,
        organization_id,
        company_id,
        params.partner_id.unwrap_or(order.partner_id),
        params.currency_id.unwrap_or(order.currency_id),
        params.payment_term_id.or(order.payment_term_id),
        params.fiscal_position_id.or(order.fiscal_position_id),
        params.incoterm_id.or(order.incoterm_id),
    )?;

    let mut updated = order;

    if let Some(ref o) = params.origin {
        updated.origin = Some(o.clone());
    }
    if let Some(ref pr) = params.partner_ref {
        updated.partner_ref = Some(pr.clone());
    }
    if let Some(ref n) = params.notes {
        updated.notes = Some(n.clone());
    }
    if let Some(d) = params.date_planned {
        updated.date_planned = Some(d);
    }
    if let Some(pt) = params.payment_term_id {
        updated.payment_term_id = Some(pt);
    }
    if let Some(fp) = params.fiscal_position_id {
        updated.fiscal_position_id = Some(fp);
    }
    if let Some(i) = params.incoterm_id {
        updated.incoterm_id = Some(i);
    }
    if let Some(ref il) = params.incoterm_location {
        updated.incoterm_location = Some(il.clone());
    }
    if let Some(pid) = params.partner_id {
        updated.partner_id = pid;
    }
    if let Some(cid) = params.currency_id {
        updated.currency_id = cid;
    }
    if let Some(tol) = params.match_qty_tolerance {
        if tol < 0.0 {
            return Err("match_qty_tolerance must be non-negative".to_string());
        }
        updated.match_qty_tolerance = Some(tol);
    }
    if let Some(tol) = params.match_price_tolerance {
        if tol < 0.0 {
            return Err("match_price_tolerance must be non-negative".to_string());
        }
        updated.match_price_tolerance = Some(tol);
    }
    if let Some(ref m) = params.metadata {
        updated.metadata = Some(m.clone());
    }

    updated.write_uid = ctx.sender();
    updated.write_date = ctx.timestamp;

    ctx.db.purchase_order().id().update(updated);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "purchase_order",
            record_id: order_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "id": order_id }).to_string()),
            new_values: Some("updated".to_string()),
            changed_fields: vec!["write_date".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Explicitly clear one nullable purchase-order header relation/value.
#[reducer]
pub fn clear_purchase_order_field(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    order_id: u64,
    field: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "write")?;
    let mut order = validate_order_in_organization(ctx, organization_id, order_id)?;
    if order.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if order.is_locked || order.state != PoState::Draft {
        return Err("Only unlocked draft purchase orders can be cleared".to_string());
    }
    match field.trim() {
        "origin" => order.origin = None,
        "partner_ref" => order.partner_ref = None,
        "notes" => order.notes = None,
        "date_planned" => order.date_planned = None,
        "payment_term" => order.payment_term_id = None,
        "fiscal_position" => order.fiscal_position_id = None,
        "incoterm" => order.incoterm_id = None,
        "incoterm_location" => order.incoterm_location = None,
        "match_qty_tolerance" => order.match_qty_tolerance = None,
        "match_price_tolerance" => order.match_price_tolerance = None,
        "metadata" => order.metadata = None,
        _ => return Err("Unsupported purchase-order clear field".to_string()),
    }
    order.write_uid = ctx.sender();
    order.write_date = ctx.timestamp;
    ctx.db.purchase_order().id().update(order);
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "purchase_order",
            record_id: order_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(format!(r#"{{"cleared":"{field:?}"}}"#)),
            changed_fields: vec![format!("{field:?}")],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn lock_purchase_order(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "write")?;

    let order = validate_order_in_organization(ctx, organization_id, order_id)?;

    if matches!(order.state, PoState::Done | PoState::Cancelled) {
        return Err("Cannot lock a completed or cancelled purchase order".to_string());
    }

    let company_id = order.company_id;
    ctx.db.purchase_order().id().update(PurchaseOrder {
        is_locked: true,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "purchase_order",
            record_id: order_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "is_locked": false }).to_string()),
            new_values: Some(serde_json::json!({ "is_locked": true }).to_string()),
            changed_fields: vec!["is_locked".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn unlock_purchase_order(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "write")?;

    let order = validate_order_in_organization(ctx, organization_id, order_id)?;

    let company_id = order.company_id;
    ctx.db.purchase_order().id().update(PurchaseOrder {
        is_locked: false,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "purchase_order",
            record_id: order_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "is_locked": true }).to_string()),
            new_values: Some(serde_json::json!({ "is_locked": false }).to_string()),
            changed_fields: vec!["is_locked".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Add a line to a purchase order
#[reducer]
pub fn add_purchase_order_line(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
    params: AddPurchaseOrderLineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order_line", "create")?;

    let order = validate_order_in_organization(ctx, organization_id, order_id)?;

    if order.state != PoState::Draft {
        return Err("Can only add lines to draft purchase orders".to_string());
    }

    if !params.quantity.is_finite() || params.quantity <= 0.0 || !params.price_unit.is_finite() {
        return Err(
            "Purchase order line quantity must be positive and price must be finite".to_string(),
        );
    }

    require_product_and_uom_in_organization(
        ctx,
        organization_id,
        params.product_id,
        params.uom_id,
    )?;
    require_purchase_taxes(ctx, organization_id, order.company_id, &params.tax_ids)?;
    require_product_variant_for_product(
        ctx,
        organization_id,
        params.product_id,
        params.product_variant_id,
    )?;
    require_analytic_account_for_company(
        ctx,
        organization_id,
        order.company_id,
        params.account_analytic_id,
    )?;
    require_lot_for_product_and_company(
        ctx,
        organization_id,
        order.company_id,
        params.product_id,
        params.lot_id,
    )?;

    let subtotal = params.quantity * params.price_unit;
    let tax = calculate_tax(ctx, &params.tax_ids, subtotal);
    let company_id = order.company_id;

    let line = ctx.db.purchase_order_line().insert(PurchaseOrderLine {
        id: 0,
        organization_id,
        sequence: params.sequence.unwrap_or(0),
        product_qty: params.quantity,
        product_uom_qty: params.quantity,
        date_planned: params.date_planned.or(order.date_planned),
        date_departure: None,
        date_arrival: None,
        product_uom: params.uom_id,
        product_id: params.product_id,
        product_type: None,
        product_variant_id: params.product_variant_id,
        product_template_id: None,
        price_unit: params.price_unit,
        price_subtotal: subtotal,
        price_total: subtotal + tax,
        price_tax: tax,
        order_id,
        account_analytic_id: params.account_analytic_id,
        analytic_tag_ids: Vec::new(),
        company_id,
        state: LineState::Draft,
        invoice_lines: Vec::new(),
        qty_invoiced: 0.0,
        qty_received_method: Vec::new(),
        qty_received: 0.0,
        qty_received_manual: 0.0,
        qty_to_invoice: 0.0,
        partner_id: order.partner_id,
        currency_id: order.currency_id,
        display_type: params.display_type,
        product_no_variant_attribute_value_ids: Vec::new(),
        product_custom_attribute_value_ids: Vec::new(),
        propagate_cancel: params.propagate_cancel.unwrap_or(true),
        sale_line_id: None,
        sale_order_id: None,
        move_dest_ids: Vec::new(),
        move_ids: Vec::new(),
        match_state: "pending".to_string(),
        lot_id: params.lot_id,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    ctx.db.purchase_order().id().update(PurchaseOrder {
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });

    compute_purchase_order_line_totals(ctx, organization_id, order_id)?;
    compute_purchase_order_totals(ctx, organization_id, order_id)?;
    update_po_receipt_status(ctx, organization_id, order_id)?;
    update_po_invoice_status(ctx, organization_id, order_id)?;

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "purchase_order_line",
            record_id: line.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "line_id": line.id,
                    "order_id": order_id,
                    "product_id": line.product_id,
                    "quantity": line.product_qty,
                })
                .to_string(),
            ),
            changed_fields: vec!["id".to_string()],
            metadata: None,
        },
    );

    log::info!("Line added to purchase order {}", order_id);
    Ok(())
}

/// Remove a line from a purchase order
#[reducer]
pub fn remove_purchase_order_line(
    ctx: &ReducerContext,
    organization_id: u64,
    line_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order_line", "delete")?;

    let line = ctx
        .db
        .purchase_order_line()
        .id()
        .find(&line_id)
        .ok_or("Purchase order line not found")?;

    let order = validate_order_in_organization(ctx, organization_id, line.order_id)?;
    require_line_matches_order(&line, &order)?;

    if order.state != PoState::Draft {
        return Err("Can only remove lines from draft purchase orders".to_string());
    }

    let order_id = line.order_id;
    ctx.db.purchase_order_line().id().delete(&line_id);

    compute_purchase_order_totals(ctx, organization_id, order_id)?;
    update_po_receipt_status(ctx, organization_id, order_id)?;
    update_po_invoice_status(ctx, organization_id, order_id)?;

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(order.company_id),
            table_name: "purchase_order_line",
            record_id: line_id,
            action: "DELETE",
            old_values: Some(
                serde_json::json!({ "line_id": line_id, "action": "deleted" }).to_string(),
            ),
            new_values: None,
            changed_fields: vec!["id".to_string()],
            metadata: None,
        },
    );

    log::info!("Line {} removed from purchase order {}", line_id, order.id);
    Ok(())
}

/// Update an existing draft purchase order line (quantity, price, product, UoM, etc.).
#[reducer]
pub fn update_purchase_order_line(
    ctx: &ReducerContext,
    organization_id: u64,
    line_id: u64,
    params: UpdatePurchaseOrderLineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order_line", "write")?;

    let line = ctx
        .db
        .purchase_order_line()
        .id()
        .find(&line_id)
        .ok_or("Purchase order line not found")?;

    if line.organization_id != organization_id {
        return Err("Line does not belong to this organization".to_string());
    }

    let order = validate_order_in_organization(ctx, organization_id, line.order_id)?;
    require_line_matches_order(&line, &order)?;

    if order.is_locked {
        return Err("Purchase order is locked".to_string());
    }

    if order.state != PoState::Draft {
        return Err("Can only update lines on draft purchase orders".to_string());
    }

    let product_id = params.product_id.unwrap_or(line.product_id);
    let quantity = params.quantity.unwrap_or(line.product_qty);
    let uom_id = params.uom_id.unwrap_or(line.product_uom);
    let price_unit = params.price_unit.unwrap_or(line.price_unit);

    if !quantity.is_finite() || quantity <= 0.0 || !price_unit.is_finite() {
        return Err(
            "Purchase order line quantity must be positive and price must be finite".to_string(),
        );
    }

    require_product_and_uom_in_organization(ctx, organization_id, product_id, uom_id)?;
    if let Some(tax_ids) = &params.tax_ids {
        require_purchase_taxes(ctx, organization_id, order.company_id, tax_ids)?;
    }
    let product_variant_id = params.product_variant_id.or(line.product_variant_id);
    let account_analytic_id = params.account_analytic_id.or(line.account_analytic_id);
    let lot_id = params.lot_id.or(line.lot_id);
    require_product_variant_for_product(ctx, organization_id, product_id, product_variant_id)?;
    require_analytic_account_for_company(
        ctx,
        organization_id,
        order.company_id,
        account_analytic_id,
    )?;
    require_lot_for_product_and_company(
        ctx,
        organization_id,
        order.company_id,
        product_id,
        lot_id,
    )?;

    let subtotal = quantity * price_unit;
    // Preserve existing tax when caller omits tax_ids (do not wipe to []).
    let tax = match &params.tax_ids {
        Some(ids) => calculate_tax(ctx, ids, subtotal),
        None => {
            if line.price_subtotal.abs() > f64::EPSILON {
                subtotal * (line.price_tax / line.price_subtotal)
            } else {
                line.price_tax
            }
        }
    };

    let date_planned = params.date_planned.or(line.date_planned);
    let display_type = params.display_type.or(line.display_type.clone());
    let propagate_cancel = params.propagate_cancel.unwrap_or(line.propagate_cancel);
    let metadata = params.metadata.or(line.metadata.clone());
    let order_id = line.order_id;
    let company_id = order.company_id;
    let old_qty = line.product_qty;
    let old_price = line.price_unit;

    ctx.db.purchase_order_line().id().update(PurchaseOrderLine {
        product_id,
        product_qty: quantity,
        product_uom_qty: quantity,
        product_uom: uom_id,
        price_unit,
        price_subtotal: subtotal,
        price_tax: tax,
        price_total: subtotal + tax,
        date_planned,
        product_variant_id,
        account_analytic_id,
        display_type,
        propagate_cancel,
        lot_id,
        metadata,
        qty_to_invoice: (quantity - line.qty_invoiced).max(0.0),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..line
    });

    compute_purchase_order_line_totals(ctx, organization_id, order_id)?;
    compute_purchase_order_totals(ctx, organization_id, order_id)?;
    update_po_receipt_status(ctx, organization_id, order_id)?;
    update_po_invoice_status(ctx, organization_id, order_id)?;

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "purchase_order_line",
            record_id: line_id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({
                    "product_qty": old_qty,
                    "price_unit": old_price,
                })
                .to_string(),
            ),
            new_values: Some(
                serde_json::json!({
                    "product_qty": quantity,
                    "price_unit": price_unit,
                    "product_id": product_id,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "product_qty".to_string(),
                "price_unit".to_string(),
                "product_id".to_string(),
            ],
            metadata: None,
        },
    );

    log::info!("Purchase order line {} updated", line_id);
    Ok(())
}

/// Explicitly clear one nullable purchase-order line relation/value.
#[reducer]
pub fn clear_purchase_order_line_field(
    ctx: &ReducerContext,
    organization_id: u64,
    line_id: u64,
    field: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order_line", "write")?;
    let mut line = ctx
        .db
        .purchase_order_line()
        .id()
        .find(&line_id)
        .ok_or("Purchase order line not found")?;
    if line.organization_id != organization_id {
        return Err("Line does not belong to this organization".to_string());
    }
    let order = validate_order_in_organization(ctx, organization_id, line.order_id)?;
    require_line_matches_order(&line, &order)?;
    if order.is_locked || order.state != PoState::Draft {
        return Err("Only lines on unlocked draft purchase orders can be cleared".to_string());
    }
    match field.trim() {
        "date_planned" => line.date_planned = None,
        "product_variant" => line.product_variant_id = None,
        "analytic_account" => line.account_analytic_id = None,
        "display_type" => line.display_type = None,
        "lot" => line.lot_id = None,
        "metadata" => line.metadata = None,
        _ => return Err("Unsupported purchase-order-line clear field".to_string()),
    }
    line.write_uid = ctx.sender();
    line.write_date = ctx.timestamp;
    ctx.db.purchase_order_line().id().update(line);
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(order.company_id),
            table_name: "purchase_order_line",
            record_id: line_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(format!(r#"{{"cleared":"{field:?}"}}"#)),
            changed_fields: vec![format!("{field:?}")],
            metadata: None,
        },
    );
    Ok(())
}

/// Recompute line-level totals for all lines in a purchase order.
#[reducer]
pub fn compute_purchase_order_line_totals(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order_line", "write")?;

    let order = validate_order_in_organization(ctx, organization_id, order_id)?;
    let lines: Vec<_> = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&order_id)
        .collect();

    for line in lines {
        let subtotal = line.product_qty * line.price_unit;
        // tax_ids are not stored on the line; preserve the existing price_tax
        let tax = line.price_tax;
        let total = subtotal + tax;

        ctx.db.purchase_order_line().id().update(PurchaseOrderLine {
            price_subtotal: subtotal,
            price_tax: tax,
            price_total: total,
            qty_to_invoice: (line.product_qty - line.qty_invoiced).max(0.0),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..line
        });
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(order.company_id),
            table_name: "purchase_order",
            record_id: order_id,
            action: "COMPUTE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "computed": "purchase_order_line_totals" }).to_string(),
            ),
            changed_fields: vec![
                "price_subtotal".to_string(),
                "price_tax".to_string(),
                "price_total".to_string(),
                "qty_to_invoice".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

/// Recompute purchase order totals from all order lines.
#[reducer]
pub fn compute_purchase_order_totals(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "write")?;

    let order = validate_order_in_organization(ctx, organization_id, order_id)?;

    let lines: Vec<_> = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&order_id)
        .collect();

    let amount_untaxed: f64 = lines.iter().map(|l| l.price_subtotal).sum();
    let amount_tax: f64 = lines.iter().map(|l| l.price_tax).sum();
    let amount_total = amount_untaxed + amount_tax;
    let company_id = order.company_id;

    ctx.db.purchase_order().id().update(PurchaseOrder {
        amount_untaxed,
        amount_tax,
        amount_total,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "purchase_order",
            record_id: order_id,
            action: "COMPUTE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "amount_untaxed": amount_untaxed,
                    "amount_tax": amount_tax,
                    "amount_total": amount_total
                })
                .to_string(),
            ),
            changed_fields: vec![
                "amount_untaxed".to_string(),
                "amount_tax".to_string(),
                "amount_total".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

/// Update purchase order receipt status based on received quantities.
#[reducer]
pub fn update_po_receipt_status(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "write")?;

    let order = validate_order_in_organization(ctx, organization_id, order_id)?;

    let lines: Vec<_> = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&order_id)
        .collect();

    let total_ordered: f64 = lines.iter().map(|l| l.product_qty).sum();
    let total_received: f64 = lines.iter().map(|l| l.qty_received).sum();

    let receipt_status = if lines.is_empty() || total_received <= 0.0 {
        "nothing".to_string()
    } else if total_received >= total_ordered && total_ordered > 0.0 {
        "full".to_string()
    } else {
        "partial".to_string()
    };

    let company_id = order.company_id;
    let old_receipt_status = order.receipt_status.clone();

    ctx.db.purchase_order().id().update(PurchaseOrder {
        receipt_status: receipt_status.clone(),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "purchase_order",
            record_id: order_id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({ "receipt_status": old_receipt_status }).to_string(),
            ),
            new_values: Some(serde_json::json!({ "receipt_status": receipt_status }).to_string()),
            changed_fields: vec!["receipt_status".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Update purchase order invoice status based on invoiced quantities.
#[reducer]
pub fn update_po_invoice_status(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "write")?;

    let order = validate_order_in_organization(ctx, organization_id, order_id)?;

    let lines: Vec<_> = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&order_id)
        .collect();

    let total_ordered: f64 = lines.iter().map(|l| l.product_qty).sum();
    let total_invoiced: f64 = lines.iter().map(|l| l.qty_invoiced).sum();

    let invoice_status = if lines.is_empty() || total_invoiced <= 0.0 {
        PoInvoiceStatus::No
    } else if total_invoiced >= total_ordered && total_ordered > 0.0 {
        PoInvoiceStatus::Invoiced
    } else {
        PoInvoiceStatus::Partial
    };

    let company_id = order.company_id;
    let old_invoice_status = format!("{:?}", order.invoice_status);
    let new_invoice_status = format!("{:?}", invoice_status);

    ctx.db.purchase_order().id().update(PurchaseOrder {
        invoice_status,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "purchase_order",
            record_id: order_id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({ "invoice_status": old_invoice_status }).to_string(),
            ),
            new_values: Some(
                serde_json::json!({ "invoice_status": new_invoice_status }).to_string(),
            ),
            changed_fields: vec!["invoice_status".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Default quantity tolerance for PO three-way match (ordered / received / billed).
pub const DEFAULT_QTY_MATCH_TOLERANCE: f64 = 0.001;

/// Default absolute price variance tolerance for competitive 3-way match (bill unit vs PO).
/// Enforced on `post_invoice` for `InInvoice` lines linked via `invoice_origin = PO{id}`.
pub const DEFAULT_PRICE_MATCH_TOLERANCE: f64 = 0.01;

/// Compute three-way match state for a purchase order line.
///
/// Returns one of: `matched`, `pending`, `under_received`, `over_received`, `under_billed`, `over_billed`.
pub fn compute_line_match_state(line: &PurchaseOrderLine, tolerance: f64) -> String {
    let ordered = line.product_qty;
    let received = line.qty_received;
    let billed = line.qty_invoiced;

    if received <= tolerance && billed <= tolerance {
        return "pending".to_string();
    }
    if received > ordered + tolerance {
        return "over_received".to_string();
    }
    if billed > received + tolerance || billed > ordered + tolerance {
        return "over_billed".to_string();
    }
    if (received - billed).abs() <= tolerance && received <= ordered + tolerance {
        return "matched".to_string();
    }
    if billed < received - tolerance {
        return "under_billed".to_string();
    }
    if received < ordered - tolerance {
        return "under_received".to_string();
    }
    "pending".to_string()
}

/// Block vendor bill posting when billed quantity exceeds received (+ tolerance) on linked PO lines.
pub fn validate_three_way_match_po_lines(
    lines: &[PurchaseOrderLine],
    tolerance: f64,
) -> Result<(), String> {
    for line in lines {
        if line.qty_invoiced > line.qty_received + tolerance {
            return Err(format!(
                "three-way match failed: line {} billed {:.4} exceeds received {:.4}",
                line.id, line.qty_invoiced, line.qty_received
            ));
        }
        if line.qty_invoiced > line.product_qty + tolerance {
            return Err(format!(
                "three-way match failed: line {} billed {:.4} exceeds ordered {:.4}",
                line.id, line.qty_invoiced, line.product_qty
            ));
        }
    }
    Ok(())
}

/// Receive quantity on a PO line. When an open IN picking/move exists, advances
/// confirm→assign→validate (stock + `qty_received` atomically). Falls back to
/// qty-only for service lines or legacy POs without pickings.
///
/// `lot_id` is required when the product's tracking mode is `lot`.
#[reducer]
pub fn receive_po_line(
    ctx: &ReducerContext,
    organization_id: u64,
    line_id: u64,
    qty: f64,
    lot_id: Option<u64>,
) -> Result<(), String> {
    use crate::core::organization::CompanyScopeParams;
    use crate::inventory::stock::{
        assign_stock_picking, confirm_stock_picking, product_requires_stock, stock_move,
        stock_picking, validate_stock_picking_backorder,
    };

    check_permission(ctx, organization_id, "purchase_order_line", "write")?;

    if qty <= 0.0 {
        return Err("Received quantity must be greater than zero".to_string());
    }

    let line = ctx
        .db
        .purchase_order_line()
        .id()
        .find(&line_id)
        .ok_or("Purchase order line not found")?;

    let order = validate_order_in_organization(ctx, organization_id, line.order_id)?;
    let qty_before = line.qty_received;
    let new_qty_received = qty_before + qty;
    if new_qty_received > line.product_qty + 1e-9 {
        return Err(format!(
            "Cannot receive {:.4}. Line {} would exceed ordered quantity {:.4} (current received: {:.4})",
            qty, line_id, line.product_qty, qty_before
        ));
    }

    let company_id = order.company_id;
    let order_id = order.id;
    let scope = CompanyScopeParams {
        company_id: Some(company_id),
    };

    // Lot-tracked products must receive into a concrete lot.
    if product_requires_stock(ctx, line.product_id) {
        let product = ctx
            .db
            .product()
            .id()
            .find(&line.product_id)
            .ok_or("Product not found for PO line")?;
        if product.tracking == "lot" {
            let Some(lot_id) = lot_id else {
                return Err(format!(
                    "Lot required to receive lot-tracked product {}",
                    line.product_id
                ));
            };
            crate::inventory::stock::ensure_lot_for_product(
                ctx,
                organization_id,
                company_id,
                line.product_id,
                lot_id,
            )?;
        }
    }

    // Prefer open inbound move linked to this PO line.
    let open_move = ctx.db.stock_move().iter().find(|m| {
        m.organization_id == organization_id
            && m.purchase_line_id == Some(line_id)
            && !m.is_done
            && m.state != "cancel"
            && m.state != "done"
    });

    if let Some(mv) = open_move {
        let picking_id = mv
            .picking_id
            .ok_or("Purchase receipt move has no picking")?;
        let picking = ctx
            .db
            .stock_picking()
            .id()
            .find(&picking_id)
            .ok_or("Purchase receipt picking not found")?;

        if picking.state == "draft" {
            confirm_stock_picking(ctx, organization_id, picking_id, scope.clone())?;
        }
        let picking = ctx
            .db
            .stock_picking()
            .id()
            .find(&picking_id)
            .ok_or("Purchase receipt picking not found after confirm")?;
        if picking.state == "confirmed" {
            assign_stock_picking(ctx, organization_id, picking_id, scope.clone())?;
        }

        let mv = ctx
            .db
            .stock_move()
            .id()
            .find(&mv.id)
            .ok_or("Purchase receipt move not found after assign")?;
        let residual = (mv.product_uom_qty - mv.quantity_done).max(0.0);
        if qty > residual + 1e-9 {
            return Err(format!(
                "Cannot receive {:.4}. Open move residual is {:.4}",
                qty, residual
            ));
        }
        let target_done = mv.quantity_done + qty;
        ctx.db
            .stock_move()
            .id()
            .update(crate::inventory::stock::StockMove {
                quantity_done: target_done,
                product_uom_qty_done: target_done,
                lot_id: lot_id.or(mv.lot_id),
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..mv
            });

        // Validate with backorder so sibling lines / residual stay open.
        validate_stock_picking_backorder(ctx, organization_id, picking_id, scope)?;

        let line_after = ctx
            .db
            .purchase_order_line()
            .id()
            .find(&line_id)
            .ok_or("Purchase order line not found after validate")?;
        let order_after = validate_order_in_organization(ctx, organization_id, order_id)?;
        let qty_received_after = line_after.qty_received;
        let match_state =
            compute_line_match_state(&line_after, qty_match_tolerance_for_order(&order_after));
        persist_line_match_state(ctx, &order_after, line_after);

        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(company_id),
                table_name: "purchase_order_line",
                record_id: line_id,
                action: "UPDATE",
                old_values: Some(
                    serde_json::json!({ "qty_received_before": qty_before }).to_string(),
                ),
                new_values: Some(
                    serde_json::json!({
                        "qty_received_after": qty_received_after,
                        "qty_delta": qty,
                        "via": "stock_picking_validate",
                        "match_state": match_state
                    })
                    .to_string(),
                ),
                changed_fields: vec!["qty_received".to_string(), "metadata".to_string()],
                metadata: None,
            },
        );
        return Ok(());
    }

    // Legacy / service path: qty-only when no stock move (or non-stock product).
    if product_requires_stock(ctx, line.product_id) {
        return Err(
            "No open receipt picking for this line. Confirm the purchase order to create an IN picking, then receive again."
                .to_string(),
        );
    }

    let updated = PurchaseOrderLine {
        qty_received: new_qty_received,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..line
    };
    let match_state = compute_line_match_state(&updated, qty_match_tolerance_for_order(&order));
    ctx.db.purchase_order_line().id().update(PurchaseOrderLine {
        match_state: match_state.clone(),
        metadata: merge_match_state_metadata(&updated.metadata, &match_state),
        ..updated
    });

    update_po_receipt_status(ctx, organization_id, order_id)?;
    compute_purchase_order_totals(ctx, organization_id, order_id)?;

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "purchase_order_line",
            record_id: line_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "qty_received_before": qty_before }).to_string()),
            new_values: Some(
                serde_json::json!({
                    "qty_received_after": new_qty_received,
                    "qty_delta": qty,
                    "via": "qty_only",
                    "match_state": match_state
                })
                .to_string(),
            ),
            changed_fields: vec![
                "qty_received".to_string(),
                "match_state".to_string(),
                "metadata".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

/// Increment invoiced quantity on a purchase order line and refresh statuses/totals.
#[reducer]
pub fn invoice_po_line(
    ctx: &ReducerContext,
    organization_id: u64,
    line_id: u64,
    qty: f64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order_line", "write")?;

    if qty <= 0.0 {
        return Err("Invoiced quantity must be greater than zero".to_string());
    }

    let line = ctx
        .db
        .purchase_order_line()
        .id()
        .find(&line_id)
        .ok_or("Purchase order line not found")?;

    let order = validate_order_in_organization(ctx, organization_id, line.order_id)?;
    let new_qty_invoiced = line.qty_invoiced + qty;
    if new_qty_invoiced > line.product_qty {
        return Err(format!(
            "Cannot invoice {:.4}. Line {} would exceed ordered quantity {:.4} (current invoiced: {:.4})",
            qty, line_id, line.product_qty, line.qty_invoiced
        ));
    }
    let qty_to_invoice = line.product_qty - new_qty_invoiced;
    let order_id = order.id;
    let company_id = line.company_id;
    let qty_invoiced_before = line.qty_invoiced;
    let qty_to_invoice_before = line.qty_to_invoice;

    let updated = PurchaseOrderLine {
        qty_invoiced: new_qty_invoiced,
        qty_to_invoice,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..line
    };
    let match_state = compute_line_match_state(&updated, qty_match_tolerance_for_order(&order));
    ctx.db.purchase_order_line().id().update(PurchaseOrderLine {
        match_state: match_state.clone(),
        metadata: merge_match_state_metadata(&updated.metadata, &match_state),
        ..updated
    });

    update_po_invoice_status(ctx, organization_id, order_id)?;
    compute_purchase_order_totals(ctx, organization_id, order_id)?;

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "purchase_order_line",
            record_id: line_id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({
                    "qty_invoiced_before": qty_invoiced_before,
                    "qty_to_invoice_before": qty_to_invoice_before
                })
                .to_string(),
            ),
            new_values: Some(
                serde_json::json!({
                    "qty_invoiced_after": new_qty_invoiced,
                    "qty_to_invoice_after": qty_to_invoice,
                    "qty_delta": qty,
                    "match_state": match_state
                })
                .to_string(),
            ),
            changed_fields: vec![
                "qty_invoiced".to_string(),
                "qty_to_invoice".to_string(),
                "match_state".to_string(),
                "metadata".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

/// Create a new purchase requisition (RFQ)
#[reducer]
pub fn create_purchase_requisition(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreatePurchaseRequisitionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_requisition", "create")?;

    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    require_requisition_relations(
        ctx,
        organization_id,
        company_id,
        params.department_id,
        params.vendor_id,
    )?;

    if let Some(ref excl) = params.exclusive {
        ExclusiveMode::from_str(excl)?;
    }

    for line in &params.lines {
        if line.product_uom_qty <= 0.0 {
            return Err("Requisition line quantity must be greater than zero".to_string());
        }
        require_product_and_uom_in_organization(
            ctx,
            organization_id,
            line.product_id,
            line.product_uom,
        )?;
    }

    // `line_ids`, `purchase_ids`, activities and messages are reverse
    // collections. Child/relation reducers own them; create intent cannot seed
    // arbitrary links.
    let order_count = 0;
    let exclusive = params.exclusive.unwrap_or_else(|| "multiple".to_string());
    let multiple_product = params.multiple_product || params.lines.len() > 1;

    let requisition = ctx.db.purchase_requisition().insert(PurchaseRequisition {
        id: 0,
        organization_id,
        origin: params.origin,
        ordering_date: params.ordering_date,
        date_end: params.date_end,
        schedule_date: params.schedule_date,
        user_id: ctx.sender(),
        company_id,
        department_id: params.department_id,
        description: params.description,
        state: RequisitionState::Draft,
        exclusive,
        account_analytic_id: None,
        picking_type_id: None,
        line_ids: vec![],
        purchase_ids: Vec::new(),
        order_count,
        vendor_id: params.vendor_id,
        multiple_product,
        activity_ids: Vec::new(),
        message_follower_ids: Vec::new(),
        message_ids: Vec::new(),
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    let mut line_ids = Vec::with_capacity(params.lines.len());
    for (idx, line) in params.lines.iter().enumerate() {
        let row = ctx
            .db
            .purchase_requisition_line()
            .insert(PurchaseRequisitionLine {
                id: 0,
                organization_id,
                company_id,
                requisition_id: requisition.id,
                product_id: line.product_id,
                product_uom: line.product_uom,
                product_uom_qty: line.product_uom_qty,
                name: line.name.clone(),
                sequence: line.sequence.unwrap_or(((idx + 1) as u32) * 10),
            });
        line_ids.push(row.id);
    }

    let requisition_id = requisition.id;
    ctx.db
        .purchase_requisition()
        .id()
        .update(PurchaseRequisition {
            line_ids: line_ids.clone(),
            ..requisition
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "purchase_requisition",
            record_id: requisition_id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "id": requisition_id,
                    "line_count": line_ids.len()
                })
                .to_string(),
            ),
            changed_fields: vec!["id".to_string(), "line_ids".to_string()],
            metadata: None,
        },
    );

    log::info!(
        "Purchase requisition {} created with {} lines",
        requisition_id,
        line_ids.len()
    );
    Ok(())
}

/// Add a product line to a draft purchase requisition.
#[reducer]
pub fn add_purchase_requisition_line(
    ctx: &ReducerContext,
    organization_id: u64,
    _company_id: u64,
    requisition_id: u64,
    params: AddPurchaseRequisitionLineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_requisition", "write")?;

    if params.product_uom_qty <= 0.0 {
        return Err("Requisition line quantity must be greater than zero".to_string());
    }

    let requisition = require_requisition_in_organization(ctx, organization_id, requisition_id)?;
    if !matches!(requisition.state, RequisitionState::Draft) {
        return Err("Can only add lines to draft purchase requisitions".to_string());
    }

    require_product_and_uom_in_organization(
        ctx,
        organization_id,
        params.product_id,
        params.product_uom,
    )?;

    let sequence = params.sequence.unwrap_or_else(|| {
        ((ctx
            .db
            .purchase_requisition_line()
            .purchase_requisition_line_by_req()
            .filter(&requisition_id)
            .count()
            + 1) as u32)
            * 10
    });

    let row = ctx
        .db
        .purchase_requisition_line()
        .insert(PurchaseRequisitionLine {
            id: 0,
            organization_id,
            company_id: requisition.company_id,
            requisition_id,
            product_id: params.product_id,
            product_uom: params.product_uom,
            product_uom_qty: params.product_uom_qty,
            name: params.name.clone(),
            sequence,
        });

    let mut line_ids = requisition.line_ids.clone();
    line_ids.push(row.id);
    let multiple_product = line_ids.len() > 1;
    ctx.db
        .purchase_requisition()
        .id()
        .update(PurchaseRequisition {
            line_ids,
            multiple_product,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..requisition
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(requisition.company_id),
            table_name: "purchase_requisition_line",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "requisition_id": requisition_id,
                    "product_id": params.product_id,
                    "product_uom_qty": params.product_uom_qty
                })
                .to_string(),
            ),
            changed_fields: vec![
                "product_id".to_string(),
                "product_uom".to_string(),
                "product_uom_qty".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

/// Submit purchase requisition for approval
#[reducer]
pub fn submit_purchase_requisition(
    ctx: &ReducerContext,
    organization_id: u64,
    requisition_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_requisition", "write")?;

    let requisition = require_requisition_in_organization(ctx, organization_id, requisition_id)?;

    if !matches!(requisition.state, RequisitionState::Draft) {
        return Err("Purchase requisition must be in Draft state to submit".to_string());
    }

    ctx.db
        .purchase_requisition()
        .id()
        .update(PurchaseRequisition {
            state: RequisitionState::InProgress,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..requisition
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(requisition.company_id),
            table_name: "purchase_requisition",
            record_id: requisition_id,
            action: "UPDATE",
            old_values: Some("Draft".to_string()),
            new_values: Some("InProgress".to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    log::info!("Purchase requisition {} submitted", requisition_id);
    Ok(())
}

/// Approve purchase requisition
#[reducer]
pub fn approve_purchase_requisition(
    ctx: &ReducerContext,
    organization_id: u64,
    requisition_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_requisition", "approve")?;

    let requisition = require_requisition_in_organization(ctx, organization_id, requisition_id)?;

    if !matches!(requisition.state, RequisitionState::InProgress) {
        return Err("Purchase requisition must be in InProgress state to approve".to_string());
    }

    ctx.db
        .purchase_requisition()
        .id()
        .update(PurchaseRequisition {
            state: RequisitionState::Approved,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..requisition
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(requisition.company_id),
            table_name: "purchase_requisition",
            record_id: requisition_id,
            action: "UPDATE",
            old_values: Some("InProgress".to_string()),
            new_values: Some("Open".to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    log::info!("Purchase requisition {} approved", requisition_id);
    Ok(())
}

/// Convert an approved purchase requisition into a draft PO (vendor from `vendor_id`).
#[reducer]
pub fn convert_purchase_requisition_to_po(
    ctx: &ReducerContext,
    organization_id: u64,
    _company_id: u64,
    requisition_id: u64,
) -> Result<(), String> {
    use crate::core::organization::company;

    check_permission(ctx, organization_id, "purchase_order", "create")?;
    check_permission(ctx, organization_id, "purchase_requisition", "write")?;

    let requisition = require_requisition_in_organization(ctx, organization_id, requisition_id)?;
    let company_id = requisition.company_id;
    if !matches!(requisition.state, RequisitionState::Approved) {
        return Err("Purchase requisition must be Approved to convert to a PO".to_string());
    }
    let vendor_id = requisition
        .vendor_id
        .ok_or("Purchase requisition has no vendor_id — set a vendor before converting")?;

    let req_lines = requisition_lines(ctx, requisition_id);
    if req_lines.is_empty() {
        return Err(
            "Purchase requisition has no lines — add product lines before converting to a PO"
                .to_string(),
        );
    }

    let company_row = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;

    let origin = format!("requisition:{requisition_id}");
    create_purchase_order(
        ctx,
        organization_id,
        CreatePurchaseOrderParams {
            company_id: Some(company_id),
            partner_id: vendor_id,
            currency_id: company_row.currency_id,
            origin: Some(origin.clone()),
            partner_ref: None,
            notes: requisition.description.clone(),
            date_planned: requisition.schedule_date,
            payment_term_id: None,
            fiscal_position_id: None,
            incoterm_id: None,
            incoterm_location: None,
            user_id: Some(requisition.user_id),
            invoice_ids: vec![],
            picking_ids: vec![],
            message_follower_ids: vec![],
            message_ids: vec![],
            activity_ids: vec![],
            is_quantity_copy: None,
            metadata: Some(format!(
                r#"{{"requisition_id":{requisition_id},"converted_from_requisition":true}}"#
            )),
        },
    )?;

    let po = ctx
        .db
        .purchase_order()
        .iter()
        .filter(|p| {
            p.organization_id == organization_id
                && p.company_id == company_id
                && p.partner_id == vendor_id
                && p.origin.as_deref() == Some(origin.as_str())
        })
        .max_by_key(|p| p.id)
        .ok_or("Purchase order not found after requisition conversion")?;

    for line in &req_lines {
        let price_unit =
            resolve_requisition_line_price(ctx, organization_id, vendor_id, line.product_id);
        add_purchase_order_line(
            ctx,
            organization_id,
            po.id,
            AddPurchaseOrderLineParams {
                product_id: line.product_id,
                quantity: line.product_uom_qty,
                uom_id: line.product_uom,
                price_unit,
                discount: 0.0,
                tax_ids: vec![],
                name: line.name.clone(),
                sequence: Some(line.sequence),
                display_type: None,
                product_variant_id: None,
                account_analytic_id: None,
                date_planned: requisition.schedule_date,
                propagate_cancel: None,
                lot_id: None,
                metadata: Some(format!(r#"{{"requisition_line_id":{}}}"#, line.id)),
            },
        )?;
    }

    let old_order_count = requisition.order_count;
    let mut purchase_ids = requisition.purchase_ids.clone();
    if !purchase_ids.contains(&po.id) {
        purchase_ids.push(po.id);
    }
    let order_count = purchase_ids.len() as u32;
    let po_id = po.id;

    ctx.db
        .purchase_requisition()
        .id()
        .update(PurchaseRequisition {
            purchase_ids,
            order_count,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..requisition
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "purchase_requisition",
            record_id: requisition_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "order_count": old_order_count }).to_string()),
            new_values: Some(
                serde_json::json!({
                    "purchase_order_id": po_id,
                    "order_count": order_count
                })
                .to_string(),
            ),
            changed_fields: vec!["purchase_ids".to_string(), "order_count".to_string()],
            metadata: None,
        },
    );

    log::info!(
        "Purchase requisition {} converted to PO {}",
        requisition_id,
        po_id
    );
    Ok(())
}

/// Close purchase requisition
#[reducer]
pub fn close_purchase_requisition(
    ctx: &ReducerContext,
    organization_id: u64,
    requisition_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_requisition", "write")?;

    let requisition = require_requisition_in_organization(ctx, organization_id, requisition_id)?;

    if matches!(
        requisition.state,
        RequisitionState::Cancelled | RequisitionState::Closed
    ) {
        return Err("Purchase requisition is already closed or cancelled".to_string());
    }

    ctx.db
        .purchase_requisition()
        .id()
        .update(PurchaseRequisition {
            state: RequisitionState::Closed,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..requisition
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(requisition.company_id),
            table_name: "purchase_requisition",
            record_id: requisition_id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({ "state": format!("{:?}", requisition.state) }).to_string(),
            ),
            new_values: Some("Closed".to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    log::info!("Purchase requisition {} closed", requisition_id);
    Ok(())
}

/// Cancel purchase requisition
#[reducer]
pub fn cancel_purchase_requisition(
    ctx: &ReducerContext,
    organization_id: u64,
    requisition_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_requisition", "write")?;

    let requisition = require_requisition_in_organization(ctx, organization_id, requisition_id)?;

    if matches!(
        requisition.state,
        RequisitionState::Closed | RequisitionState::Cancelled
    ) {
        return Err("Purchase requisition is already closed or cancelled".to_string());
    }

    ctx.db
        .purchase_requisition()
        .id()
        .update(PurchaseRequisition {
            state: RequisitionState::Cancelled,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..requisition
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(requisition.company_id),
            table_name: "purchase_requisition",
            record_id: requisition_id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({ "state": format!("{:?}", requisition.state) }).to_string(),
            ),
            new_values: Some("Cancelled".to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    log::info!("Purchase requisition {} cancelled", requisition_id);
    Ok(())
}
