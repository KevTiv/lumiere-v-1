/// Purchase Orders Module — Purchase Quotations, Orders, and Requisitions
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **PurchaseOrder** | Purchase orders and quotations |
/// | **PurchaseOrderLine** | Purchase order lines with products, quantities, and pricing |
/// | **PurchaseRequisition** | Internal purchase requests/RFQs |
use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

use crate::core::organization::company;
use crate::helpers::{check_permission, write_audit_log};
use crate::types::{ExclusiveMode, IsQuantityCopy, LineState, PoInvoiceStatus, PoState, RequisitionState};

// ============================================================================
// PURCHASE ORDER TABLES
// ============================================================================

/// Purchase Order — Quotations and Confirmed Purchase Orders
#[spacetimedb::table(
    accessor = purchase_order,
    public,
    index(name = "by_partner", accessor = purchase_order_by_partner, btree(columns = [partner_id]))
)]
pub struct PurchaseOrder {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

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
    index(name = "by_order", accessor = purchase_order_line_by_order, btree(columns = [order_id]))
)]
pub struct PurchaseOrderLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

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
    index(name = "by_user", accessor = purchase_requisition_by_user, btree(columns = [user_id]))
)]
pub struct PurchaseRequisition {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

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

// ============================================================================
// INPUT STRUCTS FOR REDUCERS
// ============================================================================

/// Input for creating a purchase order line
#[derive(spacetimedb::SpacetimeType, Clone, Debug)]
pub struct OrderLineInput {
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
}

// ============================================================================
// PURCHASE ORDER REDUCERS
// ============================================================================

fn validate_company_in_organization(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
) -> Result<(), String> {
    let comp = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;

    if comp.organization_id != organization_id {
        return Err("Company does not belong to this organization".to_string());
    }

    if comp.deleted_at.is_some() {
        return Err("Company is archived".to_string());
    }

    Ok(())
}

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

    validate_company_in_organization(ctx, organization_id, order.company_id)?;
    Ok(order)
}

/// Create a new purchase order (quotation)
#[reducer]
pub fn create_purchase_order(
    ctx: &ReducerContext,
    organization_id: u64,
    partner_id: u64,
    currency_id: u64,
    company_id: u64,
    origin: Option<String>,
    partner_ref: Option<String>,
    notes: Option<String>,
    date_planned: Option<Timestamp>,
    payment_term_id: Option<u64>,
    fiscal_position_id: Option<u64>,
    incoterm_id: Option<u64>,
    incoterm_location: Option<String>,
    invoice_ids: Vec<u64>,
    picking_ids: Vec<u64>,
    message_follower_ids: Vec<u64>,
    message_ids: Vec<u64>,
    activity_ids: Vec<u64>,
    is_quantity_copy: Option<String>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order", "create")?;

    // Validate is_quantity_copy if provided
    if let Some(ref iqc) = is_quantity_copy {
        IsQuantityCopy::from_str(iqc)?;
    }

    validate_company_in_organization(ctx, organization_id, company_id)?;

    // Calculate all derived values before moving the vectors
    let invoice_count = invoice_ids.len() as u32;
    let picking_count = picking_ids.len() as u32;
    let has_message = !message_ids.is_empty();

    let order = ctx.db.purchase_order().insert(PurchaseOrder {
        id: 0,
        origin,
        partner_ref,
        state: PoState::Draft,
        date_order: ctx.timestamp,
        date_approve: None,
        partner_id,
        dest_address_id: None,
        currency_id,
        payment_term_id,
        fiscal_position_id,
        date_planned,
        date_calendar_start: None,
        date_calendar_done: None,
        company_id,
        user_id: ctx.sender(),
        invoice_count,
        invoice_ids,
        invoice_status: PoInvoiceStatus::No,
        picking_count,
        picking_ids,
        effective_date: None,
        amount_untaxed: 0.0,
        amount_tax: 0.0,
        amount_total: 0.0,
        receipt_status: "nothing".to_string(),
        notes,
        message_main_attachment_id: None,
        message_follower_ids,
        message_ids,
        has_message,
        activity_ids,
        activity_state: None,
        activity_date_deadline: None,
        activity_type_id: None,
        activity_user_id: None,
        activity_summary: None,
        access_url: None,
        access_token: None,
        access_warning: None,
        is_locked: false,
        is_quantity_copy: is_quantity_copy.unwrap_or_else(|| "none".to_string()),
        incoterm_id,
        incoterm_location,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "purchase_order",
        order.id,
        "create",
        None,
        None,
        vec!["id".to_string()],
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
    check_permission(ctx, organization_id, "purchase_order", "write")?;

    let order = validate_order_in_organization(ctx, organization_id, order_id)?;

    if !matches!(order.state, PoState::Draft) {
        return Err("Purchase order must be in Draft state to send".to_string());
    }

    ctx.db.purchase_order().id().update(PurchaseOrder {
        state: PoState::Sent,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(order.company_id),
        "purchase_order",
        order_id,
        "send",
        Some("Draft".to_string()),
        Some("Sent".to_string()),
        vec!["state".to_string()],
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

    ctx.db.purchase_order().id().update(PurchaseOrder {
        state: PoState::Purchase,
        date_approve: Some(ctx.timestamp),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(order.company_id),
        "purchase_order",
        order_id,
        "confirm",
        Some("Sent".to_string()),
        Some("Purchase".to_string()),
        vec!["state".to_string(), "date_approve".to_string()],
    );

    log::info!("Purchase order {} confirmed", order_id);
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

    write_audit_log(
        ctx,
        organization_id,
        Some(order.company_id),
        "purchase_order",
        order_id,
        "cancel",
        Some(serde_json::json!({ "state": format!("{:?}", order.state) }).to_string()),
        Some("Cancelled".to_string()),
        vec!["state".to_string()],
    );

    log::info!("Purchase order {} cancelled", order_id);
    Ok(())
}

/// Add a line to a purchase order
#[reducer]
pub fn add_purchase_order_line(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
    line: OrderLineInput,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_order_line", "create")?;

    let order = validate_order_in_organization(ctx, organization_id, order_id)?;

    if order.state != PoState::Draft {
        return Err("Can only add lines to draft purchase orders".to_string());
    }

    let subtotal = line.quantity * line.price_unit;

    ctx.db.purchase_order_line().insert(PurchaseOrderLine {
        id: 0,
        sequence: line.sequence.unwrap_or(0),
        product_qty: line.quantity,
        product_uom_qty: line.quantity,
        date_planned: line.date_planned.or(order.date_planned),
        date_departure: None,
        date_arrival: None,
        product_uom: line.uom_id,
        product_id: line.product_id,
        product_type: None,
        product_variant_id: line.product_variant_id,
        product_template_id: None,
        price_unit: line.price_unit,
        price_subtotal: subtotal,
        price_total: subtotal,
        price_tax: 0.0,
        order_id,
        account_analytic_id: line.account_analytic_id,
        analytic_tag_ids: Vec::new(),
        company_id: order.company_id,
        state: LineState::Draft,
        invoice_lines: Vec::new(),
        qty_invoiced: 0.0,
        qty_received_method: Vec::new(),
        qty_received: 0.0,
        qty_received_manual: 0.0,
        qty_to_invoice: 0.0,
        partner_id: order.partner_id,
        currency_id: order.currency_id,
        display_type: line.display_type,
        product_no_variant_attribute_value_ids: Vec::new(),
        product_custom_attribute_value_ids: Vec::new(),
        propagate_cancel: true,
        sale_line_id: None,
        sale_order_id: None,
        move_dest_ids: Vec::new(),
        move_ids: Vec::new(),
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
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

    if order.state != PoState::Draft {
        return Err("Can only remove lines from draft purchase orders".to_string());
    }

    let order_id = line.order_id;
    ctx.db.purchase_order_line().id().delete(&line_id);

    compute_purchase_order_totals(ctx, organization_id, order_id)?;
    update_po_receipt_status(ctx, organization_id, order_id)?;
    update_po_invoice_status(ctx, organization_id, order_id)?;

    write_audit_log(
        ctx,
        organization_id,
        Some(order.company_id),
        "purchase_order_line",
        line_id,
        "delete",
        Some(serde_json::json!({ "line_id": line_id, "action": "deleted" }).to_string()),
        None,
        vec!["id".to_string()],
    );

    log::info!("Line {} removed from purchase order {}", line_id, order.id);
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

    let lines: Vec<_> = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&order_id)
        .collect();

    for line in lines {
        let subtotal = line.product_qty * line.price_unit;
        let tax = 0.0;
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

    ctx.db.purchase_order().id().update(PurchaseOrder {
        amount_untaxed,
        amount_tax,
        amount_total,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });

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

    ctx.db.purchase_order().id().update(PurchaseOrder {
        receipt_status,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });

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

    ctx.db.purchase_order().id().update(PurchaseOrder {
        invoice_status,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });

    Ok(())
}

/// Increment received quantity on a purchase order line and refresh statuses/totals.
#[reducer]
pub fn receive_po_line(
    ctx: &ReducerContext,
    organization_id: u64,
    line_id: u64,
    qty: f64,
) -> Result<(), String> {
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
    let new_qty_received = line.qty_received + qty;
    if new_qty_received > line.product_qty {
        return Err(format!(
            "Cannot receive {:.4}. Line {} would exceed ordered quantity {:.4} (current received: {:.4})",
            qty, line_id, line.product_qty, line.qty_received
        ));
    }
    let order_id = order.id;

    ctx.db.purchase_order_line().id().update(PurchaseOrderLine {
        qty_received: new_qty_received,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..line
    });

    update_po_receipt_status(ctx, organization_id, order_id)?;
    compute_purchase_order_totals(ctx, organization_id, order_id)?;

    write_audit_log(
        ctx,
        organization_id,
        Some(line.company_id),
        "purchase_order_line",
        line_id,
        "receive",
        Some(
            serde_json::json!({
                "qty_received_before": line.qty_received
            })
            .to_string(),
        ),
        Some(
            serde_json::json!({
                "qty_received_after": new_qty_received,
                "qty_delta": qty
            })
            .to_string(),
        ),
        vec!["qty_received".to_string()],
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

    ctx.db.purchase_order_line().id().update(PurchaseOrderLine {
        qty_invoiced: new_qty_invoiced,
        qty_to_invoice,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..line
    });

    update_po_invoice_status(ctx, organization_id, order_id)?;
    compute_purchase_order_totals(ctx, organization_id, order_id)?;

    write_audit_log(
        ctx,
        organization_id,
        Some(line.company_id),
        "purchase_order_line",
        line_id,
        "invoice",
        Some(
            serde_json::json!({
                "qty_invoiced_before": line.qty_invoiced,
                "qty_to_invoice_before": line.qty_to_invoice
            })
            .to_string(),
        ),
        Some(
            serde_json::json!({
                "qty_invoiced_after": new_qty_invoiced,
                "qty_to_invoice_after": qty_to_invoice,
                "qty_delta": qty
            })
            .to_string(),
        ),
        vec!["qty_invoiced".to_string(), "qty_to_invoice".to_string()],
    );

    Ok(())
}

// ============================================================================
// PURCHASE REQUISITION REDUCERS
// ============================================================================

/// Create a new purchase requisition (RFQ)
#[reducer]
pub fn create_purchase_requisition(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    description: Option<String>,
    ordering_date: Option<Timestamp>,
    date_end: Option<Timestamp>,
    schedule_date: Option<Timestamp>,
    department_id: Option<u64>,
    exclusive: Option<String>,
    multiple_product: bool,
    line_ids: Vec<u64>,
    purchase_ids: Vec<u64>,
    vendor_id: Option<u64>,
    activity_ids: Vec<u64>,
    message_follower_ids: Vec<u64>,
    message_ids: Vec<u64>,
    metadata: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "purchase_requisition", "create")?;

    validate_company_in_organization(ctx, organization_id, company_id)?;

    // Validate exclusive mode if provided
    if let Some(ref excl) = exclusive {
        ExclusiveMode::from_str(excl)?;
    }

    let order_count = purchase_ids.len() as u32;

    let requisition = ctx.db.purchase_requisition().insert(PurchaseRequisition {
        id: 0,
        origin: None,
        ordering_date,
        date_end,
        schedule_date,
        user_id: ctx.sender(),
        company_id,
        department_id,
        description,
        state: RequisitionState::Draft,
        exclusive: exclusive.unwrap_or_else(|| "multiple".to_string()),
        account_analytic_id: None,
        picking_type_id: None,
        line_ids,
        purchase_ids,
        order_count,
        vendor_id,
        multiple_product,
        activity_ids,
        message_follower_ids,
        message_ids,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata,
    });

    write_audit_log(
        ctx,
        organization_id,
        Some(company_id),
        "purchase_requisition",
        requisition.id,
        "create",
        None,
        None,
        vec!["id".to_string()],
    );

    log::info!("Purchase requisition {} created", requisition.id);
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

    let requisition = ctx
        .db
        .purchase_requisition()
        .id()
        .find(&requisition_id)
        .ok_or("Purchase requisition not found")?;

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

    write_audit_log(
        ctx,
        organization_id,
        Some(requisition.company_id),
        "purchase_requisition",
        requisition_id,
        "submit",
        Some("Draft".to_string()),
        Some("InProgress".to_string()),
        vec!["state".to_string()],
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

    let requisition = ctx
        .db
        .purchase_requisition()
        .id()
        .find(&requisition_id)
        .ok_or("Purchase requisition not found")?;

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

    write_audit_log(
        ctx,
        organization_id,
        Some(requisition.company_id),
        "purchase_requisition",
        requisition_id,
        "approve",
        Some("InProgress".to_string()),
        Some("Open".to_string()),
        vec!["state".to_string()],
    );

    log::info!("Purchase requisition {} approved", requisition_id);
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

    let requisition = ctx
        .db
        .purchase_requisition()
        .id()
        .find(&requisition_id)
        .ok_or("Purchase requisition not found")?;

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

    write_audit_log(
        ctx,
        organization_id,
        Some(requisition.company_id),
        "purchase_requisition",
        requisition_id,
        "close",
        Some(serde_json::json!({ "state": format!("{:?}", requisition.state) }).to_string()),
        Some("Closed".to_string()),
        vec!["state".to_string()],
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

    let requisition = ctx
        .db
        .purchase_requisition()
        .id()
        .find(&requisition_id)
        .ok_or("Purchase requisition not found")?;

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

    write_audit_log(
        ctx,
        organization_id,
        Some(requisition.company_id),
        "purchase_requisition",
        requisition_id,
        "cancel",
        Some(serde_json::json!({ "state": format!("{:?}", requisition.state) }).to_string()),
        Some("Cancelled".to_string()),
        vec!["state".to_string()],
    );

    log::info!("Purchase requisition {} cancelled", requisition_id);
    Ok(())
}
