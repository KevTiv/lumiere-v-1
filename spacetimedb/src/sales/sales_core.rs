/// Sales Core Module — Sales Quotations & Orders
///
/// Tables:
///   - SaleOrder         Sales quotations and orders
///   - SaleOrderLine     Order line items
///   - SaleOrderOption   Optional products/services
///
/// Key Features:
///   - Multi-state workflow (Draft → Sent → Sale → Done/Cancelled)
///   - Automatic total calculations
///   - Integration with inventory for stock availability
///   - Audit logging for all mutations
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::crm::contacts::contact;
use crate::helpers::{check_permission, write_audit_log};
use crate::inventory::product::product;
use crate::types::{InvoiceStatus, LineInvoiceStatus, LineState, SaleState};

// ══════════════════════════════════════════════════════════════════════════════
// INPUT TYPES
// ══════════════════════════════════════════════════════════════════════════════

/// Input data for creating a sale order
#[derive(SpacetimeType, Clone, Debug)]
pub struct SaleOrderInput {
    pub partner_id: u64,
    pub partner_invoice_id: u64,
    pub partner_shipping_id: u64,
    pub pricelist_id: u64,
    pub currency_id: u64,
    pub company_id: u64,
    pub warehouse_id: u64,
    pub order_lines: Vec<OrderLineInput>,
    pub origin: Option<String>,
    pub client_order_ref: Option<String>,
    pub payment_term_id: Option<u64>,
    pub fiscal_position_id: Option<u64>,
    pub team_id: Option<u64>,
    pub opportunity_id: Option<u64>,
    pub note: Option<String>,
    pub terms_and_conditions: Option<String>,
    pub validity_days: Option<u32>,
    pub shipping_policy: Option<String>,
    pub picking_policy: Option<String>,
    // Marketing attribution
    pub campaign_id: Option<u64>,
    pub medium_id: Option<u64>,
    pub source_id: Option<u64>,
    // Dates
    pub commitment_date: Option<Timestamp>,
    pub expected_date: Option<Timestamp>,
    // Shipping/Delivery
    pub incoterm: Option<String>,
    pub incoterm_location: Option<String>,
    pub carrier_id: Option<u64>,
    pub customer_lead: Option<f64>,
    // Account/Analytics
    pub analytic_account_id: Option<u64>,
    // Flags
    pub is_printed: Option<bool>,
    pub is_locked: Option<bool>,
    pub is_dropship: Option<bool>,
    // Messaging
    pub message_follower_ids: Option<Vec<u64>>,
    pub message_partner_ids: Option<Vec<u64>>,
    pub message_channel_ids: Option<Vec<u64>>,
    pub activity_ids: Option<Vec<u64>>,
    // Metadata
    pub metadata: Option<String>,
}

/// Input data for order lines
#[derive(SpacetimeType, Clone, Debug)]
pub struct OrderLineInput {
    pub product_id: u64,
    pub quantity: f64,
    pub uom_id: u64,
    pub price_unit: Option<f64>,
    pub discount: f64,
    pub tax_ids: Vec<u64>,
    pub name: Option<String>,
    pub sequence: u32,
    pub is_downpayment: bool,
    pub display_type: Option<String>,
    pub product_variant_id: Option<u64>,
    pub packaging_id: Option<u64>,
    pub route_id: Option<u64>,
    pub analytic_tag_ids: Vec<u64>,
    pub customer_lead: Option<f64>,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// TABLES: SALES ORDERS
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = sale_order,
    public,
    index(accessor = sale_order_by_org, btree(columns = [organization_id])),
    index(accessor = sale_order_by_company, btree(columns = [company_id])),
    index(accessor = sale_order_by_partner, btree(columns = [partner_id])),
    index(accessor = sale_order_by_state, btree(columns = [state]))
)]
pub struct SaleOrder {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub origin: Option<String>,
    pub client_order_ref: Option<String>,
    pub reference: Option<String>,
    pub state: SaleState,
    pub date_order: Timestamp,
    pub validity_date: Option<Timestamp>,
    pub is_expired: bool,
    pub confirmation_date: Option<Timestamp>,
    pub order_line: Vec<u64>,
    pub partner_id: u64,
    pub partner_invoice_id: u64,
    pub partner_shipping_id: u64,
    pub pricelist_id: u64,
    pub currency_id: u64,
    pub payment_term_id: Option<u64>,
    pub fiscal_position_id: Option<u64>,
    pub user_id: Identity,
    pub team_id: Option<u64>,
    pub origin_so_id: Option<u64>,
    pub opportunity_id: Option<u64>,
    pub campaign_id: Option<u64>,
    pub medium_id: Option<u64>,
    pub source_id: Option<u64>,
    pub signed_by: Option<String>,
    pub signed_on: Option<Timestamp>,
    pub signature: Option<String>,
    pub commitment_date: Option<Timestamp>,
    pub expected_date: Option<Timestamp>,
    pub amount_untaxed: f64,
    pub amount_by_group: Option<String>,
    pub amount_tax: f64,
    pub amount_total: f64,
    pub amount_paid: f64,
    pub amount_residual: f64,
    pub amount_to_invoice: f64,
    pub margin: f64,
    pub note: Option<String>,
    pub terms_and_conditions: Option<String>,
    pub invoice_count: u32,
    pub invoice_ids: Vec<u64>,
    pub invoice_status: InvoiceStatus,
    pub picking_ids: Vec<u64>,
    pub delivery_count: u32,
    pub procurement_group_id: Option<u64>,
    pub production_count: u32,
    pub mrp_production_ids: Vec<u64>,
    pub is_printed: bool,
    pub is_locked: bool,
    pub show_update_pricelist: bool,
    pub show_update_fpos: bool,
    pub last_website_so_id: Option<u64>,
    pub analytic_account_id: Option<u64>,
    pub invoice_num: u32,
    pub shipping_policy: String,
    pub picking_policy: String,
    pub warehouse_id: u64,
    pub incoterm: Option<String>,
    pub incoterm_location: Option<String>,
    pub carrier_id: Option<u64>,
    pub weight: f64,
    pub shipping_weight: f64,
    pub volume: f64,
    pub weight_uom_name: Option<String>,
    pub customer_lead: f64,
    pub prepaid_amount: f64,
    pub credit_amount: f64,
    pub is_dropship: bool,
    pub dropship_picking_count: u32,
    pub dropship_picking_ids: Vec<u64>,
    pub purchase_order_count: u32,
    pub purchase_order_ids: Vec<u64>,
    pub activities_count: u32,
    pub message_needaction: bool,
    pub message_needaction_counter: u32,
    pub message_is_follower: bool,
    pub message_follower_ids: Vec<u64>,
    pub message_partner_ids: Vec<u64>,
    pub message_channel_ids: Vec<u64>,
    pub message_ids: Vec<u64>,
    pub website_message_ids: Vec<u64>,
    pub has_message: bool,
    pub activity_ids: Vec<u64>,
    pub activity_state: Option<String>,
    pub activity_date_deadline: Option<Timestamp>,
    pub activity_summary: Option<String>,
    pub activity_type_id: Option<u64>,
    pub activity_user_id: Option<Identity>,
    pub rating_ids: Vec<u64>,
    pub rating_last_value: f64,
    pub rating_last_feedback: Option<String>,
    pub rating_last_image: Option<String>,
    pub access_warning: Option<String>,
    pub access_url: Option<String>,
    pub access_token: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = sale_order_line,
    public,
    index(accessor = order_line_by_order, btree(columns = [order_id]))
)]
pub struct SaleOrderLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub order_id: u64,
    pub name: String,
    pub sequence: u32,
    pub invoice_status: LineInvoiceStatus,
    pub price_unit: f64,
    pub price_subtotal: f64,
    pub price_tax: f64,
    pub price_total: f64,
    pub price_reduce: f64,
    pub price_reduce_taxinc: f64,
    pub price_reduce_taxexcl: f64,
    pub discount: f64,
    pub product_id: u64,
    pub product_variant_id: Option<u64>,
    pub product_template_id: Option<u64>,
    pub product_uom_qty: f64,
    pub product_uom: u64,
    pub product_packaging_id: Option<u64>,
    pub product_packaging_qty: f64,
    pub qty_delivered_manual: f64,
    pub qty_delivered_method: String,
    pub qty_delivered: f64,
    pub qty_invoiced: f64,
    pub qty_to_invoice: f64,
    pub qty_at_date: f64,
    pub virtual_available_at_date: f64,
    pub free_qty_today: f64,
    pub scheduled_date: Option<Timestamp>,
    pub is_downpayment: bool,
    pub is_expense: bool,
    pub currency_id: u64,
    pub company_id: u64,
    pub order_partner_id: u64,
    pub salesman_id: Identity,
    pub tax_id: Vec<u64>,
    pub analytic_tag_ids: Vec<u64>,
    pub analytic_line_ids: Vec<u64>,
    pub is_service: bool,
    pub is_delivered: bool,
    pub display_type: Option<String>,
    pub product_updatable: bool,
    pub product_type: Option<String>,
    pub product_no_variant_attribute_value_ids: Vec<u64>,
    pub product_custom_attribute_value_ids: Vec<u64>,
    pub margin: f64,
    pub margin_percent: f64,
    pub purchase_price: f64,
    pub cost_method: Option<String>,
    pub bom_id: Option<u64>,
    pub route_id: Option<u64>,
    pub move_ids: Vec<u64>,
    pub move_status: Option<String>,
    pub customer_lead: f64,
    pub state: LineState,
    pub product_remains: f64,
    pub product_packaging_qty_delivered: f64,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(accessor = sale_order_option, public)]
pub struct SaleOrderOption {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub order_id: u64,
    pub line_id: Option<u64>,
    pub product_id: u64,
    pub name: String,
    pub quantity: f64,
    pub uom_id: u64,
    pub price_unit: f64,
    pub discount: f64,
    pub is_present: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: SALES ORDER MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_sale_order(ctx: &ReducerContext, input: SaleOrderInput) -> Result<(), String> {
    check_permission(ctx, input.company_id, "sale_order", "create")?;

    // Validate partner exists and is a customer
    let partner = ctx
        .db
        .contact()
        .id()
        .find(&input.partner_id)
        .ok_or("Partner not found")?;

    if !partner.is_customer {
        return Err("Partner is not a customer".to_string());
    }

    // Calculate validity date
    let validity_date = input
        .validity_days
        .map(|days| ctx.timestamp + std::time::Duration::from_secs(days as u64 * 86400));

    // Insert order
    let order = ctx.db.sale_order().insert(SaleOrder {
        id: 0,
        organization_id: input.company_id, // Using company_id as organization_id for now
        company_id: input.company_id,
        origin: input.origin,
        client_order_ref: input.client_order_ref,
        reference: None,
        state: SaleState::Draft,
        date_order: ctx.timestamp,
        validity_date,
        is_expired: false,
        confirmation_date: None,
        order_line: Vec::new(),
        partner_id: input.partner_id,
        partner_invoice_id: input.partner_invoice_id,
        partner_shipping_id: input.partner_shipping_id,
        pricelist_id: input.pricelist_id,
        currency_id: input.currency_id,
        payment_term_id: input.payment_term_id,
        fiscal_position_id: input.fiscal_position_id,
        user_id: ctx.sender(),
        team_id: input.team_id,
        origin_so_id: None,
        opportunity_id: input.opportunity_id,
        campaign_id: input.campaign_id,
        medium_id: input.medium_id,
        source_id: input.source_id,
        signed_by: None,
        signed_on: None,
        signature: None,
        commitment_date: input.commitment_date,
        expected_date: input.expected_date,
        amount_untaxed: 0.0,
        amount_by_group: None,
        amount_tax: 0.0,
        amount_total: 0.0,
        amount_paid: 0.0,
        amount_residual: 0.0,
        amount_to_invoice: 0.0,
        margin: 0.0,
        note: input.note,
        terms_and_conditions: input.terms_and_conditions,
        invoice_count: 0,
        invoice_ids: Vec::new(),
        invoice_status: InvoiceStatus::NoInvoice,
        picking_ids: Vec::new(),
        delivery_count: 0,
        procurement_group_id: None,
        production_count: 0,
        mrp_production_ids: Vec::new(),
        is_printed: input.is_printed.unwrap_or(false),
        is_locked: input.is_locked.unwrap_or(false),
        show_update_pricelist: false,
        show_update_fpos: false,
        last_website_so_id: None,
        analytic_account_id: input.analytic_account_id,
        invoice_num: 0,
        shipping_policy: input
            .shipping_policy
            .unwrap_or_else(|| "direct".to_string()),
        picking_policy: input.picking_policy.unwrap_or_else(|| "direct".to_string()),
        warehouse_id: input.warehouse_id,
        incoterm: input.incoterm,
        incoterm_location: input.incoterm_location,
        carrier_id: input.carrier_id,
        weight: 0.0,
        shipping_weight: 0.0,
        volume: 0.0,
        weight_uom_name: None,
        customer_lead: input.customer_lead.unwrap_or(0.0),
        prepaid_amount: 0.0,
        credit_amount: 0.0,
        is_dropship: input.is_dropship.unwrap_or(false),
        dropship_picking_count: 0,
        dropship_picking_ids: Vec::new(),
        purchase_order_count: 0,
        purchase_order_ids: Vec::new(),
        activities_count: 0,
        message_needaction: false,
        message_needaction_counter: 0,
        message_is_follower: false,
        message_follower_ids: input.message_follower_ids.unwrap_or_default(),
        message_partner_ids: input.message_partner_ids.unwrap_or_default(),
        message_channel_ids: input.message_channel_ids.unwrap_or_default(),
        message_ids: Vec::new(),
        website_message_ids: Vec::new(),
        has_message: false,
        activity_ids: input.activity_ids.unwrap_or_default(),
        activity_state: None,
        activity_date_deadline: None,
        activity_summary: None,
        activity_type_id: None,
        activity_user_id: None,
        rating_ids: Vec::new(),
        rating_last_value: 0.0,
        rating_last_feedback: None,
        rating_last_image: None,
        access_warning: None,
        access_url: None,
        access_token: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: input.metadata.clone(),
    });

    // Create order lines and calculate totals
    let mut line_ids = Vec::new();
    let mut amount_untaxed: f64 = 0.0;
    let mut amount_tax: f64 = 0.0;

    for line_input in input.order_lines {
        let line = create_sale_order_line_internal(
            ctx,
            order.id,
            line_input,
            input.currency_id,
            input.company_id,
            input.partner_id,
        )?;
        line_ids.push(line.id);
        amount_untaxed += line.price_subtotal;
        amount_tax += line.price_tax;
    }

    // Update order with totals
    ctx.db.sale_order().id().update(SaleOrder {
        order_line: line_ids,
        amount_untaxed,
        amount_tax,
        amount_total: amount_untaxed + amount_tax,
        amount_residual: amount_untaxed + amount_tax,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });

    write_audit_log(
        ctx,
        input.company_id,
        Some(input.company_id),
        "sale_order",
        order.id,
        "create",
        None,
        Some(
            serde_json::json!({
                "partner_id": input.partner_id,
                "amount_total": amount_untaxed + amount_tax
            })
            .to_string(),
        ),
        vec!["partner_id".to_string(), "amount_total".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn confirm_sale_order(ctx: &ReducerContext, order_id: u64) -> Result<(), String> {
    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("Sale order not found")?;

    check_permission(ctx, order.company_id, "sale_order", "confirm")?;

    if order.state != SaleState::Draft && order.state != SaleState::Sent {
        return Err("Order must be in Draft or Sent state to confirm".to_string());
    }

    // Check if order is expired
    if let Some(validity) = order.validity_date {
        if ctx.timestamp > validity {
            return Err("Order has expired".to_string());
        }
    }

    ctx.db.sale_order().id().update(SaleOrder {
        state: SaleState::Sale,
        confirmation_date: Some(ctx.timestamp),
        invoice_status: InvoiceStatus::ToInvoice,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });

    write_audit_log(
        ctx,
        order.company_id,
        Some(order.company_id),
        "sale_order",
        order_id,
        "confirm",
        None,
        Some(r#"{"state":"Sale","confirmation_date":"now"}"#.to_string()),
        vec!["state".to_string(), "confirmation_date".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn cancel_sale_order(
    ctx: &ReducerContext,
    order_id: u64,
    reason: Option<String>,
) -> Result<(), String> {
    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("Sale order not found")?;

    check_permission(ctx, order.company_id, "sale_order", "cancel")?;

    if order.state == SaleState::Done {
        return Err("Cannot cancel a done order".to_string());
    }

    ctx.db.sale_order().id().update(SaleOrder {
        state: SaleState::Cancelled,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: merge_metadata(&order.metadata, "cancel_reason", &reason),
        ..order
    });

    write_audit_log(
        ctx,
        order.company_id,
        Some(order.company_id),
        "sale_order",
        order_id,
        "cancel",
        None,
        Some(serde_json::json!({ "state": "Cancelled", "reason": reason }).to_string()),
        vec!["state".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_sale_order_totals(ctx: &ReducerContext, order_id: u64) -> Result<(), String> {
    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("Sale order not found")?;

    check_permission(ctx, order.company_id, "sale_order", "write")?;

    // Recalculate totals from order lines
    let mut amount_untaxed: f64 = 0.0;
    let mut amount_tax: f64 = 0.0;

    for line_id in &order.order_line {
        if let Some(line) = ctx.db.sale_order_line().id().find(line_id) {
            amount_untaxed += line.price_subtotal;
            amount_tax += line.price_tax;
        }
    }

    ctx.db.sale_order().id().update(SaleOrder {
        amount_untaxed,
        amount_tax,
        amount_total: amount_untaxed + amount_tax,
        amount_residual: amount_untaxed + amount_tax - order.amount_paid,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });

    Ok(())
}

// Internal helper function for creating order lines
fn create_sale_order_line_internal(
    ctx: &ReducerContext,
    order_id: u64,
    input: OrderLineInput,
    currency_id: u64,
    company_id: u64,
    partner_id: u64,
) -> Result<SaleOrderLine, String> {
    // Get product info - note: product table may not exist yet
    // For now, we'll use default values if product not found
    let product_result = ctx.db.product().id().find(&input.product_id);
    let (product_name, product_type, product_cost): (Option<String>, String, f64) =
        match product_result {
            Some(product) => (
                product.display_name.clone(),
                product.type_.clone(),
                product.standard_price,
            ),
            None => (
                Some(format!("Product {}", input.product_id)),
                "product".to_string(),
                0.0,
            ),
        };

    let price_unit = input.price_unit.unwrap_or(0.0);
    let discount_amount = price_unit * input.quantity * (input.discount / 100.0);
    let price_subtotal = price_unit * input.quantity - discount_amount;

    // Calculate taxes - TODO: integrate with tax table when available
    // Currently uses hardcoded 10% rate as placeholder
    let price_tax: f64 = if input.tax_ids.is_empty() {
        0.0
    } else {
        price_subtotal * 0.10 // FIXME: lookup actual tax rate from tax configuration
    };

    let line = ctx.db.sale_order_line().insert(SaleOrderLine {
        id: 0,
        order_id,
        name: input.name.unwrap_or_else(|| {
            product_name.unwrap_or_else(|| format!("Product {}", input.product_id))
        }),
        sequence: input.sequence,
        invoice_status: LineInvoiceStatus::No,
        price_unit,
        price_subtotal,
        price_tax,
        price_total: price_subtotal + price_tax,
        price_reduce: price_unit,
        price_reduce_taxinc: if price_subtotal > 0.0 {
            price_unit * (1.0 + (price_tax / price_subtotal))
        } else {
            price_unit
        },
        price_reduce_taxexcl: price_unit,
        discount: input.discount,
        product_id: input.product_id,
        product_variant_id: input.product_variant_id,
        product_template_id: Some(input.product_id),
        product_uom_qty: input.quantity,
        product_uom: input.uom_id,
        product_packaging_id: input.packaging_id,
        product_packaging_qty: 0.0,
        qty_delivered_manual: 0.0,
        qty_delivered_method: "manual".to_string(),
        qty_delivered: 0.0,
        qty_invoiced: 0.0,
        qty_to_invoice: 0.0,
        qty_at_date: 0.0,
        virtual_available_at_date: 0.0,
        free_qty_today: 0.0,
        scheduled_date: None,
        is_downpayment: input.is_downpayment,
        is_expense: false,
        currency_id,
        company_id,
        order_partner_id: partner_id,
        salesman_id: ctx.sender(),
        tax_id: input.tax_ids,
        analytic_tag_ids: input.analytic_tag_ids,
        analytic_line_ids: Vec::new(),
        is_service: product_type == "service",
        is_delivered: false,
        display_type: input.display_type,
        product_updatable: true,
        product_type: Some(product_type.clone()),
        product_no_variant_attribute_value_ids: Vec::new(),
        product_custom_attribute_value_ids: Vec::new(),
        margin: 0.0,
        margin_percent: 0.0,
        purchase_price: product_cost,
        cost_method: Some("standard".to_string()),
        bom_id: None,
        route_id: input.route_id,
        move_ids: Vec::new(),
        move_status: None,
        customer_lead: input.customer_lead.unwrap_or(0.0),
        state: LineState::Draft,
        product_remains: 0.0,
        product_packaging_qty_delivered: 0.0,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: input.metadata.clone(),
    });

    Ok(line)
}

// Helper to merge metadata - simple implementation without serde_json
fn merge_metadata(existing: &Option<String>, _key: &str, value: &Option<String>) -> Option<String> {
    // Simple implementation: if there's a new value, use it
    // In production, you'd want proper JSON merging
    value.clone().or_else(|| existing.clone())
}
