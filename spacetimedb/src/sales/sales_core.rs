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
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::company_id_from_scope;
use crate::crm::contacts::contact;
use crate::helpers::{
    calculate_tax, check_permission, next_doc_number, write_audit_log_v2, AuditLogParams,
};
use crate::inventory::product::product;
use crate::inventory::warehouse::warehouse;
use crate::sales::pricelists::product_pricelist;
use crate::types::{
    InvoiceStatus, LineInvoiceStatus, LineState, PickingPolicy, SaleState, ShippingPolicy,
};

// ── Input Params ──────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateSaleOrderLineParams {
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

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateSaleOrderParams {
    pub company_id: Option<u64>,
    pub partner_id: u64,
    pub partner_invoice_id: u64,
    pub partner_shipping_id: u64,
    pub pricelist_id: u64,
    pub currency_id: u64,
    pub warehouse_id: u64,
    pub order_lines: Vec<CreateSaleOrderLineParams>,
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
    pub campaign_id: Option<u64>,
    pub medium_id: Option<u64>,
    pub source_id: Option<u64>,
    pub commitment_date: Option<Timestamp>,
    pub expected_date: Option<Timestamp>,
    pub incoterm: Option<String>,
    pub incoterm_location: Option<String>,
    pub carrier_id: Option<u64>,
    pub customer_lead: Option<f64>,
    pub analytic_account_id: Option<u64>,
    pub user_id: Option<Identity>,
    pub is_printed: Option<bool>,
    pub is_locked: Option<bool>,
    pub is_dropship: Option<bool>,
    pub message_follower_ids: Option<Vec<u64>>,
    pub message_partner_ids: Option<Vec<u64>>,
    pub message_channel_ids: Option<Vec<u64>>,
    pub activity_ids: Option<Vec<u64>>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateSaleOrderParams {
    pub client_order_ref: Option<String>,
    pub note: Option<String>,
    pub terms_and_conditions: Option<String>,
    pub partner_invoice_id: Option<u64>,
    pub partner_shipping_id: Option<u64>,
    pub pricelist_id: Option<u64>,
    pub warehouse_id: Option<u64>,
    pub commitment_date: Option<Timestamp>,
    pub expected_date: Option<Timestamp>,
    pub shipping_policy: Option<String>,
    pub picking_policy: Option<String>,
    pub validity_date: Option<Timestamp>,
    pub carrier_id: Option<u64>,
    pub incoterm: Option<String>,
    pub incoterm_location: Option<String>,
    pub customer_lead: Option<f64>,
    pub analytic_account_id: Option<u64>,
    pub user_id: Option<Identity>,
    pub metadata: Option<String>,
}

// ── Tables ───────────────────────────────────────────────────────────────────

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
    index(accessor = order_line_by_org, btree(columns = [organization_id])),
    index(accessor = order_line_by_order, btree(columns = [order_id]))
)]
pub struct SaleOrderLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
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

// ── Helpers ───────────────────────────────────────────────────────────────────

fn validate_order_org_scope(order: &SaleOrder, organization_id: u64) -> Result<(), String> {
    if order.organization_id != organization_id {
        return Err("Sale order does not belong to this organization".to_string());
    }
    Ok(())
}

fn merge_metadata(existing: &Option<String>, key: &str, value: &Option<String>) -> Option<String> {
    let value = value.as_ref()?;
    let mut metadata = existing
        .as_ref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|parsed| parsed.as_object().cloned())
        .unwrap_or_default();

    metadata.insert(key.to_string(), serde_json::Value::String(value.clone()));
    Some(serde_json::Value::Object(metadata).to_string())
}

fn create_sale_order_line_internal(
    ctx: &ReducerContext,
    order_id: u64,
    params: CreateSaleOrderLineParams,
    currency_id: u64,
    organization_id: u64,
    company_id: u64,
    partner_id: u64,
) -> Result<SaleOrderLine, String> {
    let product_result = ctx.db.product().id().find(&params.product_id);
    let (product_name, product_type, product_cost): (Option<String>, String, f64) =
        match product_result {
            Some(product) => (
                product.display_name.clone(),
                product.type_.clone(),
                product.standard_price,
            ),
            None => (
                Some(format!("Product {}", params.product_id)),
                "product".to_string(),
                0.0,
            ),
        };

    let price_unit = params.price_unit.unwrap_or(0.0);
    let discount_amount = price_unit * params.quantity * (params.discount / 100.0);
    let price_subtotal = price_unit * params.quantity - discount_amount;

    let price_tax = calculate_tax(ctx, &params.tax_ids, price_subtotal);

    let line = ctx.db.sale_order_line().insert(SaleOrderLine {
        id: 0,
        organization_id,
        order_id,
        name: params.name.unwrap_or_else(|| {
            product_name.unwrap_or_else(|| format!("Product {}", params.product_id))
        }),
        sequence: params.sequence,
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
        discount: params.discount,
        product_id: params.product_id,
        product_variant_id: params.product_variant_id,
        product_template_id: Some(params.product_id),
        product_uom_qty: params.quantity,
        product_uom: params.uom_id,
        product_packaging_id: params.packaging_id,
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
        is_downpayment: params.is_downpayment,
        is_expense: false,
        currency_id,
        company_id,
        order_partner_id: partner_id,
        salesman_id: ctx.sender(),
        tax_id: params.tax_ids,
        analytic_tag_ids: params.analytic_tag_ids,
        analytic_line_ids: Vec::new(),
        is_service: product_type == "service",
        is_delivered: false,
        display_type: params.display_type,
        product_updatable: true,
        product_type: Some(product_type.clone()),
        product_no_variant_attribute_value_ids: Vec::new(),
        product_custom_attribute_value_ids: Vec::new(),
        margin: 0.0,
        margin_percent: 0.0,
        purchase_price: product_cost,
        cost_method: Some("standard".to_string()),
        bom_id: None,
        route_id: params.route_id,
        move_ids: Vec::new(),
        move_status: None,
        customer_lead: params.customer_lead.unwrap_or(0.0),
        state: LineState::Draft,
        product_remains: 0.0,
        product_packaging_qty_delivered: 0.0,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    Ok(line)
}

// ── Reducers ──────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_sale_order(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateSaleOrderParams,
) -> Result<(), String> {
    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;
    check_permission(ctx, organization_id, "sale_order", "create")?;

    let partner = ctx
        .db
        .contact()
        .id()
        .find(&params.partner_id)
        .ok_or("Partner not found")?;

    if !partner.is_customer {
        return Err("Partner is not a customer".to_string());
    }

    if let Some(ref sp) = params.shipping_policy {
        ShippingPolicy::from_str(sp)?;
    }
    if let Some(ref pp) = params.picking_policy {
        PickingPolicy::from_str(pp)?;
    }

    let validity_date = params
        .validity_days
        .map(|days| ctx.timestamp + std::time::Duration::from_secs(days as u64 * 86400));

    let shipping_policy = params
        .shipping_policy
        .unwrap_or_else(|| "direct".to_string());
    let picking_policy = params
        .picking_policy
        .unwrap_or_else(|| "direct".to_string());
    let customer_lead = params.customer_lead.unwrap_or(0.0);
    let is_printed = params.is_printed.unwrap_or(false);
    let is_locked = params.is_locked.unwrap_or(false);
    let is_dropship = params.is_dropship.unwrap_or(false);

    let order = ctx.db.sale_order().insert(SaleOrder {
        id: 0,
        organization_id,
        company_id,
        origin: params.origin,
        client_order_ref: params.client_order_ref,
        reference: Some(next_doc_number(ctx, "SO")),
        state: SaleState::Draft,
        date_order: ctx.timestamp,
        validity_date,
        is_expired: false,
        confirmation_date: None,
        order_line: Vec::new(),
        partner_id: params.partner_id,
        partner_invoice_id: params.partner_invoice_id,
        partner_shipping_id: params.partner_shipping_id,
        pricelist_id: params.pricelist_id,
        currency_id: params.currency_id,
        payment_term_id: params.payment_term_id,
        fiscal_position_id: params.fiscal_position_id,
        user_id: params.user_id.unwrap_or_else(|| ctx.sender()),
        team_id: params.team_id,
        origin_so_id: None,
        opportunity_id: params.opportunity_id,
        campaign_id: params.campaign_id,
        medium_id: params.medium_id,
        source_id: params.source_id,
        signed_by: None,
        signed_on: None,
        signature: None,
        commitment_date: params.commitment_date,
        expected_date: params.expected_date,
        amount_untaxed: 0.0,
        amount_by_group: None,
        amount_tax: 0.0,
        amount_total: 0.0,
        amount_paid: 0.0,
        amount_residual: 0.0,
        amount_to_invoice: 0.0,
        margin: 0.0,
        note: params.note,
        terms_and_conditions: params.terms_and_conditions,
        invoice_count: 0,
        invoice_ids: Vec::new(),
        invoice_status: InvoiceStatus::NoInvoice,
        picking_ids: Vec::new(),
        delivery_count: 0,
        procurement_group_id: None,
        production_count: 0,
        mrp_production_ids: Vec::new(),
        is_printed,
        is_locked,
        show_update_pricelist: false,
        show_update_fpos: false,
        last_website_so_id: None,
        analytic_account_id: params.analytic_account_id,
        invoice_num: 0,
        shipping_policy,
        picking_policy,
        warehouse_id: params.warehouse_id,
        incoterm: params.incoterm,
        incoterm_location: params.incoterm_location,
        carrier_id: params.carrier_id,
        weight: 0.0,
        shipping_weight: 0.0,
        volume: 0.0,
        weight_uom_name: None,
        customer_lead,
        prepaid_amount: 0.0,
        credit_amount: 0.0,
        is_dropship,
        dropship_picking_count: 0,
        dropship_picking_ids: Vec::new(),
        purchase_order_count: 0,
        purchase_order_ids: Vec::new(),
        activities_count: 0,
        message_needaction: false,
        message_needaction_counter: 0,
        message_is_follower: false,
        message_follower_ids: params.message_follower_ids.unwrap_or_default(),
        message_partner_ids: params.message_partner_ids.unwrap_or_default(),
        message_channel_ids: params.message_channel_ids.unwrap_or_default(),
        message_ids: Vec::new(),
        website_message_ids: Vec::new(),
        has_message: false,
        activity_ids: params.activity_ids.unwrap_or_default(),
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
        metadata: params.metadata,
    });

    let mut line_ids = Vec::new();
    let mut amount_untaxed: f64 = 0.0;
    let mut amount_tax: f64 = 0.0;

    for line_params in params.order_lines {
        let line = create_sale_order_line_internal(
            ctx,
            order.id,
            line_params,
            params.currency_id,
            organization_id,
            company_id,
            params.partner_id,
        )?;
        line_ids.push(line.id);
        amount_untaxed += line.price_subtotal;
        amount_tax += line.price_tax;
    }

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

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "sale_order",
            record_id: order.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "partner_id": params.partner_id,
                    "amount_total": amount_untaxed + amount_tax
                })
                .to_string(),
            ),
            changed_fields: vec!["partner_id".to_string(), "amount_total".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Create draft outgoing pickings and stock moves for deliverable SO lines (MVP fulfillment path).
fn create_outgoing_pickings_for_confirmed_order(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
) -> Result<(), String> {
    use crate::inventory::stock::{
        create_stock_move, create_stock_picking, stock_picking, CreateStockMoveParams,
        CreateStockPickingParams,
    };

    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("Sale order not found for picking creation")?;

    if ctx.db.stock_picking().iter().any(|p| {
        p.organization_id == organization_id
            && p.sale_id == Some(order_id)
            && !p.is_return
    }) {
        return Ok(());
    }

    let order_lines: Vec<_> = ctx
        .db
        .sale_order_line()
        .order_line_by_order()
        .filter(&order_id)
        .filter(|l| l.display_type.is_none() && l.product_uom_qty > 0.0)
        .collect();

    if order_lines.is_empty() {
        return Ok(());
    }

    let company_id = order.company_id;
    let warehouse_id = order.warehouse_id;
    let src_location = warehouse_id;
    let dest_location = warehouse_id.saturating_add(1);
    let order_label = order
        .reference
        .as_deref()
        .or(order.client_order_ref.as_deref())
        .or(order.origin.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| order_id.to_string());

    create_stock_picking(
        ctx,
        organization_id,
        CreateStockPickingParams {
            company_id: Some(company_id),
            name: format!("OUT/{order_label}"),
            picking_type_id: 1,
            location_id: src_location,
            location_dest_id: dest_location,
            move_type: "direct".to_string(),
            priority: "1".to_string(),
            partner_id: Some(order.partner_id),
            contact_id: None,
            scheduled_date: Some(ctx.timestamp),
            origin: Some(format!("SO/{order_label}")),
            note: order.note.clone(),
            user_id: None,
            sale_id: Some(order_id),
            purchase_id: None,
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
            product_id: Some(order_lines[0].product_id),
            lot_id: None,
            package_id: None,
            result_package_id: None,
            owner_id: None,
            display_lot_id: None,
            location_id_name: None,
            location_dest_id_name: None,
            picking_code: Some("outgoing".to_string()),
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
            metadata: Some(format!(r#"{{"sale_order_id":{order_id}}}"#)),
        },
    )?;

    let picking = ctx
        .db
        .stock_picking()
        .iter()
        .find(|p| {
            p.organization_id == organization_id && p.sale_id == Some(order_id) && !p.is_return
        })
        .ok_or("Outgoing picking not found after create")?;

    for (idx, line) in order_lines.iter().enumerate() {
        let product = ctx
            .db
            .product()
            .id()
            .find(&line.product_id)
            .ok_or("Product not found for sale order line")?;

        create_stock_move(
            ctx,
            organization_id,
            CreateStockMoveParams {
                company_id: Some(company_id),
                name: format!("{} x {}", line.product_uom_qty, product.name),
                product_id: line.product_id,
                product_tmpl_id: line.product_id,
                product_uom: line.product_uom,
                product_uom_qty: line.product_uom_qty,
                location_id: src_location,
                location_dest_id: dest_location,
                date_expected: ctx.timestamp,
                move_type: "outgoing".to_string(),
                priority: "1".to_string(),
                reference: Some(format!("SO/{order_label}")),
                sequence: ((idx + 1) as i32) * 10,
                origin: Some(format!("SO/{order_label}")),
                note: order.note.clone(),
                date: None,
                date_deadline: None,
                picking_id: Some(picking.id),
                picking_type_id: Some(1),
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
                purchase_line_id: None,
                need_release: false,
                release_ready: false,
                propagation_cancel: true,
                has_tracking: false,
                inventory_id: None,
                sale_line_id: Some(line.id),
                lot_id: None,
                package_id: None,
                result_package_id: None,
                owner_id: None,
                package_level_id: None,
                product_type: Some("product".to_string()),
                metadata: None,
            },
        )?;
    }

    let mut picking_ids = order.picking_ids.clone();
    if !picking_ids.contains(&picking.id) {
        picking_ids.push(picking.id);
    }
    ctx.db.sale_order().id().update(SaleOrder {
        picking_ids,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });

    Ok(())
}

#[reducer]
pub fn confirm_sales_order(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
) -> Result<(), String> {
    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("Sale order not found")?;

    validate_order_org_scope(&order, organization_id)?;
    check_permission(ctx, organization_id, "sale_order", "confirm")?;

    if order.state != SaleState::Draft && order.state != SaleState::Sent {
        return Err("Order must be in Draft or Sent state to confirm".to_string());
    }

    if let Some(validity) = order.validity_date {
        if ctx.timestamp > validity {
            return Err("Order has expired".to_string());
        }
    }

    let partner_id = order.partner_id;
    let company_id = order.company_id;

    ctx.db.sale_order().id().update(SaleOrder {
        state: SaleState::Sale,
        confirmation_date: Some(ctx.timestamp),
        invoice_status: InvoiceStatus::ToInvoice,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });

    // Invoice-on-order: confirmed lines become billable (delivery-based qty is set on picking validate).
    for line in ctx
        .db
        .sale_order_line()
        .order_line_by_order()
        .filter(&order_id)
    {
        if line.display_type.is_some() {
            continue;
        }
        let qty_to_invoice = (line.product_uom_qty - line.qty_invoiced).max(0.0);
        if qty_to_invoice <= 0.0 {
            continue;
        }
        ctx.db.sale_order_line().id().update(SaleOrderLine {
            qty_to_invoice,
            invoice_status: LineInvoiceStatus::ToInvoice,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..line
        });
    }

    create_outgoing_pickings_for_confirmed_order(ctx, organization_id, order_id)?;

    // Increment customer_rank on the partner contact
    if let Some(partner) = ctx.db.contact().id().find(&partner_id) {
        ctx.db.contact().id().update(crate::crm::contacts::Contact {
            customer_rank: partner.customer_rank + 1,
            ..partner
        });
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "sale_order",
            record_id: order_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "state": "Sale", "confirmation_date": "now" }).to_string(),
            ),
            changed_fields: vec!["state".to_string(), "confirmation_date".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn cancel_sale_order(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
    reason: Option<String>,
) -> Result<(), String> {
    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("Sale order not found")?;

    validate_order_org_scope(&order, organization_id)?;
    check_permission(ctx, organization_id, "sale_order", "cancel")?;

    if order.state == SaleState::Done {
        return Err("Cannot cancel a done order".to_string());
    }

    let company_id = order.company_id;
    ctx.db.sale_order().id().update(SaleOrder {
        state: SaleState::Cancelled,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: merge_metadata(&order.metadata, "cancel_reason", &reason),
        ..order
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "sale_order",
            record_id: order_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "state": "Cancelled", "reason": reason }).to_string(),
            ),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn compute_so_totals(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
) -> Result<(), String> {
    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("Sale order not found")?;

    validate_order_org_scope(&order, organization_id)?;
    check_permission(ctx, organization_id, "sale_order", "write")?;

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

#[reducer]
pub fn update_sale_order(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    order_id: u64,
    params: UpdateSaleOrderParams,
) -> Result<(), String> {
    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("Sale order not found")?;

    validate_order_org_scope(&order, organization_id)?;
    check_permission(ctx, organization_id, "sale_order", "write")?;

    if order.company_id != company_id {
        return Err("Record does not belong to this company".to_string());
    }

    match order.state {
        SaleState::Draft | SaleState::Sent => {}
        _ => return Err("Only draft or sent orders can be updated".to_string()),
    }

    if params.shipping_policy.is_some() {
        if let Some(ref sp) = params.shipping_policy {
            ShippingPolicy::from_str(sp)?;
        }
    }
    if params.picking_policy.is_some() {
        if let Some(ref pp) = params.picking_policy {
            PickingPolicy::from_str(pp)?;
        }
    }

    let mut client_order_ref = order.client_order_ref.clone();
    let mut note = order.note.clone();
    let mut terms_and_conditions = order.terms_and_conditions.clone();
    let mut partner_invoice_id = order.partner_invoice_id;
    let mut partner_shipping_id = order.partner_shipping_id;
    let mut pricelist_id = order.pricelist_id;
    let mut currency_id = order.currency_id;
    let mut warehouse_id = order.warehouse_id;
    let mut commitment_date = order.commitment_date;
    let mut expected_date = order.expected_date;
    let mut shipping_policy = order.shipping_policy.clone();
    let mut picking_policy = order.picking_policy.clone();
    let mut validity_date = order.validity_date;
    let mut carrier_id = order.carrier_id;
    let mut incoterm = order.incoterm.clone();
    let mut incoterm_location = order.incoterm_location.clone();
    let mut customer_lead = order.customer_lead;
    let mut analytic_account_id = order.analytic_account_id;
    let mut user_id = order.user_id;
    let mut metadata = order.metadata.clone();

    if let Some(v) = &params.client_order_ref {
        client_order_ref = Some(v.clone());
    }
    if let Some(v) = &params.note {
        note = Some(v.clone());
    }
    if let Some(v) = &params.terms_and_conditions {
        terms_and_conditions = Some(v.clone());
    }
    if let Some(v) = params.partner_invoice_id {
        partner_invoice_id = v;
    }
    if let Some(v) = params.partner_shipping_id {
        partner_shipping_id = v;
    }
    if let Some(pid) = params.pricelist_id {
        let pl = ctx
            .db
            .product_pricelist()
            .id()
            .find(&pid)
            .ok_or("Pricelist not found")?;
        if pl.organization_id != organization_id {
            return Err("Pricelist belongs to a different organization".to_string());
        }
        pricelist_id = pid;
        currency_id = pl.currency_id;
    }
    if let Some(wid) = params.warehouse_id {
        let wh = ctx
            .db
            .warehouse()
            .id()
            .find(&wid)
            .ok_or("Warehouse not found")?;
        if wh.company_id != company_id {
            return Err("Warehouse does not belong to this company".to_string());
        }
        warehouse_id = wid;
    }
    if let Some(v) = params.commitment_date {
        commitment_date = Some(v);
    }
    if let Some(v) = params.expected_date {
        expected_date = Some(v);
    }
    if let Some(ref v) = params.shipping_policy {
        shipping_policy = v.clone();
    }
    if let Some(ref v) = params.picking_policy {
        picking_policy = v.clone();
    }
    if let Some(v) = params.validity_date {
        validity_date = Some(v);
    }
    if let Some(v) = params.carrier_id {
        carrier_id = Some(v);
    }
    if let Some(ref v) = params.incoterm {
        incoterm = Some(v.clone());
    }
    if let Some(ref v) = params.incoterm_location {
        incoterm_location = Some(v.clone());
    }
    if let Some(v) = params.customer_lead {
        customer_lead = v;
    }
    if let Some(v) = params.analytic_account_id {
        analytic_account_id = Some(v);
    }
    if let Some(v) = params.user_id {
        user_id = v;
    }
    if let Some(ref v) = params.metadata {
        metadata = Some(v.clone());
    }

    let mut changed_fields: Vec<String> = Vec::new();
    if params.client_order_ref.is_some() {
        changed_fields.push("client_order_ref".into());
    }
    if params.note.is_some() {
        changed_fields.push("note".into());
    }
    if params.terms_and_conditions.is_some() {
        changed_fields.push("terms_and_conditions".into());
    }
    if params.partner_invoice_id.is_some() {
        changed_fields.push("partner_invoice_id".into());
    }
    if params.partner_shipping_id.is_some() {
        changed_fields.push("partner_shipping_id".into());
    }
    if params.pricelist_id.is_some() {
        changed_fields.push("pricelist_id".into());
        changed_fields.push("currency_id".into());
    }
    if params.warehouse_id.is_some() {
        changed_fields.push("warehouse_id".into());
    }
    if params.commitment_date.is_some() {
        changed_fields.push("commitment_date".into());
    }
    if params.expected_date.is_some() {
        changed_fields.push("expected_date".into());
    }
    if params.shipping_policy.is_some() {
        changed_fields.push("shipping_policy".into());
    }
    if params.picking_policy.is_some() {
        changed_fields.push("picking_policy".into());
    }
    if params.validity_date.is_some() {
        changed_fields.push("validity_date".into());
    }
    if params.carrier_id.is_some() {
        changed_fields.push("carrier_id".into());
    }
    if params.incoterm.is_some() {
        changed_fields.push("incoterm".into());
    }
    if params.incoterm_location.is_some() {
        changed_fields.push("incoterm_location".into());
    }
    if params.customer_lead.is_some() {
        changed_fields.push("customer_lead".into());
    }
    if params.analytic_account_id.is_some() {
        changed_fields.push("analytic_account_id".into());
    }
    if params.user_id.is_some() {
        changed_fields.push("user_id".into());
    }
    if params.metadata.is_some() {
        changed_fields.push("metadata".into());
    }

    if changed_fields.is_empty() {
        return Err("No fields to update".to_string());
    }

    let old_snapshot = serde_json::json!({
        "client_order_ref": order.client_order_ref,
        "pricelist_id": order.pricelist_id,
        "warehouse_id": order.warehouse_id,
    })
    .to_string();

    ctx.db.sale_order().id().update(SaleOrder {
        client_order_ref,
        note,
        terms_and_conditions,
        partner_invoice_id,
        partner_shipping_id,
        pricelist_id,
        currency_id,
        warehouse_id,
        commitment_date,
        expected_date,
        shipping_policy,
        picking_policy,
        validity_date,
        carrier_id,
        incoterm,
        incoterm_location,
        customer_lead,
        analytic_account_id,
        user_id,
        metadata,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });

    let updated = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .expect("just updated");

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "sale_order",
            record_id: order_id,
            action: "UPDATE",
            old_values: Some(old_snapshot),
            new_values: Some(
                serde_json::json!({
                    "client_order_ref": updated.client_order_ref,
                    "pricelist_id": updated.pricelist_id,
                    "warehouse_id": updated.warehouse_id,
                })
                .to_string(),
            ),
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn create_sale_order_line(
    ctx: &ReducerContext,
    organization_id: u64,
    order_id: u64,
    params: CreateSaleOrderLineParams,
) -> Result<(), String> {
    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("Sale order not found")?;

    validate_order_org_scope(&order, organization_id)?;
    check_permission(ctx, organization_id, "sale_order", "write")?;

    match order.state {
        SaleState::Draft | SaleState::Sent => {}
        _ => return Err("Only draft or sent orders can receive new lines".to_string()),
    }

    let line = create_sale_order_line_internal(
        ctx,
        order_id,
        params,
        order.currency_id,
        organization_id,
        order.company_id,
        order.partner_id,
    )?;

    let mut order_line = order.order_line.clone();
    order_line.push(line.id);

    let amount_untaxed = order.amount_untaxed + line.price_subtotal;
    let amount_tax = order.amount_tax + line.price_tax;
    let amount_total = amount_untaxed + amount_tax;

    ctx.db.sale_order().id().update(SaleOrder {
        order_line,
        amount_untaxed,
        amount_tax,
        amount_total,
        amount_residual: amount_total - order.amount_paid,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..order
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(order.company_id),
            table_name: "sale_order_line",
            record_id: line.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "order_id": order_id,
                    "product_id": line.product_id,
                    "quantity": line.product_uom_qty,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "order_id".to_string(),
                "product_id".to_string(),
                "quantity".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}
