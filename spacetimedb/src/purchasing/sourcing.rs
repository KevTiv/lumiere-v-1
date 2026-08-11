/// RFQ / multi-vendor tender MVP — quote lines, vendor bids, award → PO.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::require_company_in_organization;
use crate::core::reference::{require_active_currency_by_id, uom};
use crate::crm::contacts::{contact, Contact};
use crate::helpers::{check_permission, next_doc_number, write_audit_log_v2, AuditLogParams};
use crate::inventory::product::product;
use crate::purchasing::purchase_orders::{
    add_purchase_order_line, create_purchase_order, purchase_order, purchase_requisition,
    AddPurchaseOrderLineParams, CreatePurchaseOrderParams,
};
use crate::types::RequisitionState;

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = purchase_rfq,
    public,
    index(accessor = purchase_rfq_by_company, btree(columns = [company_id])),
    index(accessor = purchase_rfq_by_org, btree(columns = [organization_id]))
)]
pub struct PurchaseRfq {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    pub requisition_id: Option<u64>,
    pub state: String,
    pub currency_id: u64,
    pub notes: Option<String>,
    pub awarded_bid_id: Option<u64>,
    pub purchase_order_id: Option<u64>,
    pub line_ids: Vec<u64>,
    pub bid_ids: Vec<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = purchase_rfq_line,
    public,
    index(accessor = purchase_rfq_line_by_rfq, btree(columns = [rfq_id]))
)]
pub struct PurchaseRfqLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub rfq_id: u64,
    pub product_id: u64,
    pub product_uom: u64,
    pub product_uom_qty: f64,
    pub name: Option<String>,
    pub sequence: u32,
}

#[spacetimedb::table(
    accessor = purchase_rfq_bid,
    public,
    index(accessor = purchase_rfq_bid_by_rfq, btree(columns = [rfq_id]))
)]
pub struct PurchaseRfqBid {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub rfq_id: u64,
    pub partner_id: u64,
    pub currency_id: u64,
    /// Unit price applied to each RFQ line when awarding.
    pub price_unit: f64,
    pub amount_total: f64,
    pub notes: Option<String>,
    pub state: String,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePurchaseRfqLineParams {
    pub product_id: u64,
    pub product_uom: u64,
    pub product_uom_qty: f64,
    pub name: Option<String>,
    pub sequence: Option<u32>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePurchaseRfqParams {
    pub requisition_id: Option<u64>,
    pub currency_id: u64,
    pub notes: Option<String>,
    pub lines: Vec<CreatePurchaseRfqLineParams>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct AddPurchaseRfqLineParams {
    pub product_id: u64,
    pub product_uom: u64,
    pub product_uom_qty: f64,
    pub name: Option<String>,
    pub sequence: Option<u32>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePurchaseRfqBidParams {
    pub partner_id: u64,
    pub currency_id: u64,
    pub price_unit: f64,
    pub notes: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn load_rfq(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    rfq_id: u64,
) -> Result<PurchaseRfq, String> {
    let record = ctx
        .db
        .purchase_rfq()
        .id()
        .find(&rfq_id)
        .ok_or("Purchase RFQ not found")?;
    if record.organization_id != organization_id {
        return Err("Purchase RFQ does not belong to this organization".to_string());
    }
    if record.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    Ok(record)
}

fn rfq_lines(ctx: &ReducerContext, rfq_id: u64) -> Vec<PurchaseRfqLine> {
    ctx.db
        .purchase_rfq_line()
        .purchase_rfq_line_by_rfq()
        .filter(&rfq_id)
        .collect()
}

fn require_rfq_lines_in_parent_scope(
    ctx: &ReducerContext,
    rfq: &PurchaseRfq,
) -> Result<Vec<PurchaseRfqLine>, String> {
    let lines = rfq_lines(ctx, rfq.id);
    if lines.iter().any(|line| {
        line.organization_id != rfq.organization_id || line.company_id != rfq.company_id
    }) {
        return Err("RFQ has a line outside its organization or company scope".to_string());
    }
    Ok(lines)
}

fn require_purchasable_product_and_uom(
    ctx: &ReducerContext,
    organization_id: u64,
    product_id: u64,
    product_uom: u64,
) -> Result<(), String> {
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
        return Err("Product is not active for purchasing".to_string());
    }

    let selected_uom = ctx
        .db
        .uom()
        .id()
        .find(&product_uom)
        .ok_or("UoM not found")?;
    if selected_uom.organization_id != organization_id || !selected_uom.is_active {
        return Err("UoM is not active in this organization".to_string());
    }
    let purchase_uom = ctx
        .db
        .uom()
        .id()
        .find(&product.uom_po_id)
        .ok_or("Product purchase UoM not found")?;
    if purchase_uom.organization_id != organization_id || !purchase_uom.is_active {
        return Err("Product purchase UoM is not active in this organization".to_string());
    }
    if selected_uom.category_id != purchase_uom.category_id {
        return Err("UoM is incompatible with the product purchase UoM".to_string());
    }
    Ok(())
}

fn require_active_vendor_in_scope(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    partner_id: u64,
) -> Result<Contact, String> {
    let vendor = ctx
        .db
        .contact()
        .id()
        .find(&partner_id)
        .ok_or("Vendor contact not found")?;
    if vendor.organization_id != organization_id {
        return Err("Vendor contact does not belong to this organization".to_string());
    }
    if vendor.company_id.is_some_and(|id| id != company_id) {
        return Err("Vendor contact does not belong to this company".to_string());
    }
    if vendor.deleted_at.is_some() || vendor.merge_target_id.is_some() {
        return Err("Vendor contact is inactive".to_string());
    }
    if !vendor.is_vendor {
        return Err("Partner is not a vendor".to_string());
    }
    Ok(vendor)
}

fn recompute_bid_amount(price_unit: f64, lines: &[PurchaseRfqLine]) -> f64 {
    lines.iter().map(|l| l.product_uom_qty * price_unit).sum()
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Create an RFQ standalone or from an approved requisition.
#[reducer]
pub fn create_purchase_rfq(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreatePurchaseRfqParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "create")?;

    if params.lines.is_empty() {
        return Err("RFQ must have at least one line".to_string());
    }

    require_company_in_organization(ctx, organization_id, company_id)?;
    require_active_currency_by_id(ctx, params.currency_id)?;

    if let Some(req_id) = params.requisition_id {
        let req = ctx
            .db
            .purchase_requisition()
            .id()
            .find(&req_id)
            .ok_or("Purchase requisition not found")?;
        if req.organization_id != organization_id {
            return Err("Purchase requisition does not belong to this organization".to_string());
        }
        if req.company_id != company_id {
            return Err("Record does not belong to this company".to_string());
        }
        // The reachable selected-requisition action represents an approved
        // procurement demand. Draft and in-progress requests must complete
        // their approval workflow before vendor solicitation begins.
        if req.state != RequisitionState::Approved {
            return Err("Requisition must be approved to create an RFQ".to_string());
        }
    }

    // Validate the entire write set before creating the RFQ header so no
    // partial document can survive an invalid product/UoM relation.
    for line in &params.lines {
        if line.product_uom_qty <= 0.0 {
            return Err("RFQ line quantity must be greater than zero".to_string());
        }
        require_purchasable_product_and_uom(
            ctx,
            organization_id,
            line.product_id,
            line.product_uom,
        )?;
    }

    let name = next_doc_number(ctx, "RFQ");
    let rfq = ctx.db.purchase_rfq().insert(PurchaseRfq {
        id: 0,
        organization_id,
        company_id,
        name,
        requisition_id: params.requisition_id,
        state: "draft".to_string(),
        currency_id: params.currency_id,
        notes: params.notes.clone(),
        awarded_bid_id: None,
        purchase_order_id: None,
        line_ids: vec![],
        bid_ids: vec![],
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata.clone(),
    });

    let mut line_ids = Vec::with_capacity(params.lines.len());
    for (idx, line) in params.lines.iter().enumerate() {
        let row = ctx.db.purchase_rfq_line().insert(PurchaseRfqLine {
            id: 0,
            organization_id,
            company_id,
            rfq_id: rfq.id,
            product_id: line.product_id,
            product_uom: line.product_uom,
            product_uom_qty: line.product_uom_qty,
            name: line.name.clone(),
            sequence: line.sequence.unwrap_or(((idx + 1) as u32) * 10),
        });
        line_ids.push(row.id);
    }

    let rfq_id = rfq.id;
    let rfq_name = rfq.name.clone();
    ctx.db
        .purchase_rfq()
        .id()
        .update(PurchaseRfq { line_ids, ..rfq });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "purchase_rfq",
            record_id: rfq_id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": rfq_name,
                    "requisition_id": params.requisition_id,
                    "line_count": params.lines.len(),
                })
                .to_string(),
            ),
            changed_fields: vec![
                "name".to_string(),
                "state".to_string(),
                "requisition_id".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn add_purchase_rfq_line(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    rfq_id: u64,
    params: AddPurchaseRfqLineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "write")?;

    let rfq = load_rfq(ctx, organization_id, company_id, rfq_id)?;
    if rfq.state != "draft" && rfq.state != "sent" {
        return Err("RFQ lines can only be added in draft or sent state".to_string());
    }
    if params.product_uom_qty <= 0.0 {
        return Err("RFQ line quantity must be greater than zero".to_string());
    }
    require_purchasable_product_and_uom(
        ctx,
        rfq.organization_id,
        params.product_id,
        params.product_uom,
    )?;

    let sequence = params.sequence.unwrap_or_else(|| {
        ((ctx
            .db
            .purchase_rfq_line()
            .purchase_rfq_line_by_rfq()
            .filter(&rfq_id)
            .count()
            + 1) as u32)
            * 10
    });
    let row = ctx.db.purchase_rfq_line().insert(PurchaseRfqLine {
        id: 0,
        organization_id: rfq.organization_id,
        company_id: rfq.company_id,
        rfq_id,
        product_id: params.product_id,
        product_uom: params.product_uom,
        product_uom_qty: params.product_uom_qty,
        name: params.name.clone(),
        sequence,
    });

    let mut line_ids = rfq.line_ids.clone();
    line_ids.push(row.id);
    ctx.db.purchase_rfq().id().update(PurchaseRfq {
        line_ids,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..rfq
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "purchase_rfq_line",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "rfq_id": rfq_id,
                    "product_id": params.product_id,
                    "product_uom_qty": params.product_uom_qty,
                })
                .to_string(),
            ),
            changed_fields: vec!["product_id".to_string(), "product_uom_qty".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Add a vendor bid (price quote) to an RFQ.
#[reducer]
pub fn add_purchase_rfq_bid(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    rfq_id: u64,
    params: CreatePurchaseRfqBidParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "write")?;

    let rfq = load_rfq(ctx, organization_id, company_id, rfq_id)?;
    if rfq.state == "awarded" || rfq.state == "cancelled" {
        return Err("Cannot add bids to an awarded or cancelled RFQ".to_string());
    }
    if params.price_unit < 0.0 {
        return Err("Bid price_unit must be non-negative".to_string());
    }

    require_active_vendor_in_scope(ctx, rfq.organization_id, rfq.company_id, params.partner_id)?;
    require_active_currency_by_id(ctx, params.currency_id)?;
    if params.currency_id != rfq.currency_id {
        return Err("RFQ bid currency must match the RFQ currency".to_string());
    }

    let lines = require_rfq_lines_in_parent_scope(ctx, &rfq)?;
    if lines.is_empty() {
        return Err("RFQ has no lines".to_string());
    }
    let amount_total = recompute_bid_amount(params.price_unit, &lines);

    let bid = ctx.db.purchase_rfq_bid().insert(PurchaseRfqBid {
        id: 0,
        organization_id: rfq.organization_id,
        company_id: rfq.company_id,
        rfq_id,
        partner_id: params.partner_id,
        currency_id: params.currency_id,
        price_unit: params.price_unit,
        amount_total,
        notes: params.notes.clone(),
        state: "submitted".to_string(),
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    let mut bid_ids = rfq.bid_ids.clone();
    bid_ids.push(bid.id);
    let new_state = if rfq.state == "draft" {
        "sent".to_string()
    } else {
        rfq.state.clone()
    };
    ctx.db.purchase_rfq().id().update(PurchaseRfq {
        bid_ids,
        state: new_state,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..rfq
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "purchase_rfq_bid",
            record_id: bid.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "rfq_id": rfq_id,
                    "partner_id": params.partner_id,
                    "price_unit": params.price_unit,
                    "amount_total": amount_total,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "partner_id".to_string(),
                "price_unit".to_string(),
                "amount_total".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

/// Award a bid: create a draft PO from RFQ lines at the bid unit price.
#[reducer]
pub fn award_purchase_rfq_bid(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    rfq_id: u64,
    bid_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "create")?;

    let rfq = load_rfq(ctx, organization_id, company_id, rfq_id)?;
    if rfq.state == "awarded" {
        return Err("RFQ is already awarded".to_string());
    }
    if rfq.state == "cancelled" {
        return Err("Cannot award a cancelled RFQ".to_string());
    }

    let bid = ctx
        .db
        .purchase_rfq_bid()
        .id()
        .find(&bid_id)
        .ok_or("RFQ bid not found")?;
    if bid.organization_id != organization_id {
        return Err("RFQ bid does not belong to this organization".to_string());
    }
    if bid.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }
    if bid.rfq_id != rfq_id {
        return Err("Bid does not belong to this RFQ".to_string());
    }

    if bid.state != "submitted" {
        return Err("Only submitted RFQ bids can be awarded".to_string());
    }
    require_active_vendor_in_scope(ctx, rfq.organization_id, rfq.company_id, bid.partner_id)?;
    require_active_currency_by_id(ctx, bid.currency_id)?;
    if bid.currency_id != rfq.currency_id {
        return Err("RFQ bid currency does not match the RFQ currency".to_string());
    }

    let lines = require_rfq_lines_in_parent_scope(ctx, &rfq)?;
    if lines.is_empty() {
        return Err("RFQ has no lines".to_string());
    }

    let origin = format!("rfq:{rfq_id}");
    create_purchase_order(
        ctx,
        organization_id,
        CreatePurchaseOrderParams {
            company_id: Some(company_id),
            partner_id: bid.partner_id,
            currency_id: bid.currency_id,
            origin: Some(origin.clone()),
            partner_ref: None,
            notes: rfq.notes.clone(),
            date_planned: None,
            payment_term_id: None,
            fiscal_position_id: None,
            incoterm_id: None,
            incoterm_location: None,
            user_id: None,
            invoice_ids: vec![],
            picking_ids: vec![],
            message_follower_ids: vec![],
            message_ids: vec![],
            activity_ids: vec![],
            is_quantity_copy: None,
            metadata: Some(format!(
                r#"{{"rfq_id":{rfq_id},"awarded_bid_id":{bid_id}}}"#
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
                && p.partner_id == bid.partner_id
                && p.origin.as_deref() == Some(origin.as_str())
        })
        .max_by_key(|p| p.id)
        .ok_or("Purchase order not found after RFQ award")?;

    for line in &lines {
        add_purchase_order_line(
            ctx,
            organization_id,
            po.id,
            AddPurchaseOrderLineParams {
                product_id: line.product_id,
                quantity: line.product_uom_qty,
                uom_id: line.product_uom,
                price_unit: bid.price_unit,
                discount: 0.0,
                tax_ids: vec![],
                name: line.name.clone(),
                sequence: Some(line.sequence),
                display_type: None,
                product_variant_id: None,
                account_analytic_id: None,
                date_planned: None,
                propagate_cancel: None,
                lot_id: None,
                metadata: Some(format!(r#"{{"rfq_line_id":{}}}"#, line.id)),
            },
        )?;
    }

    // Mark other bids rejected; awarded bid awarded.
    for other in ctx
        .db
        .purchase_rfq_bid()
        .purchase_rfq_bid_by_rfq()
        .filter(&rfq_id)
    {
        let new_state = if other.id == bid_id {
            "awarded".to_string()
        } else {
            "rejected".to_string()
        };
        ctx.db.purchase_rfq_bid().id().update(PurchaseRfqBid {
            state: new_state,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..other
        });
    }

    let po_id = po.id;
    let old_state = rfq.state.clone();
    ctx.db.purchase_rfq().id().update(PurchaseRfq {
        state: "awarded".to_string(),
        awarded_bid_id: Some(bid_id),
        purchase_order_id: Some(po_id),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..rfq
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "purchase_rfq",
            record_id: rfq_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": old_state }).to_string()),
            new_values: Some(
                serde_json::json!({
                    "state": "awarded",
                    "awarded_bid_id": bid_id,
                    "purchase_order_id": po_id,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "state".to_string(),
                "awarded_bid_id".to_string(),
                "purchase_order_id".to_string(),
            ],
            metadata: None,
        },
    );

    log::info!("RFQ {} awarded bid {} → PO {}", rfq_id, bid_id, po_id);
    Ok(())
}
