/// Delivery & Shipping Module — Picking Batches, Carriers, and Shipping Methods
///
/// Tables:
///   - StockPickingBatch   Grouping pickings for batch processing
///   - DeliveryCarrier     Shipping carrier configuration
///   - DeliveryPriceRule   Dynamic pricing rules
///   - ShippingMethod      Shipping method options
///
/// Key Features:
///   - Batch picking management
///   - Multi-carrier support
///   - Dynamic pricing rules
///   - Shipping cost calculation
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::check_permission;
use crate::inventory::product::product;
use crate::inventory::stock::{stock_picking, StockPicking};
use crate::types::BatchState;

// ── Input Params ──────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePickingBatchParams {
    pub name: String,
    pub picking_type_id: Option<u64>,
    pub scheduled_date: Option<Timestamp>,
    pub picking_ids: Vec<u64>,
    pub is_wave: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateDeliveryCarrierParams {
    pub name: String,
    pub product_id: u64,
    pub delivery_type: String,
    pub integration_level: String,
    pub invoice_policy: String,
    pub country_ids: Vec<u64>,
    pub state_ids: Vec<u64>,
    pub zip_prefix_ids: Vec<String>,
    pub margin: f64,
    pub free_over: bool,
    pub amount: f64,
    pub can_generate_return: bool,
    pub return_label_on_delivery: bool,
    pub get_return_label_from_portal: bool,
    pub fixed_charge: f64,
    pub fixed_weight: f64,
    pub price_rule_ids: Vec<u64>,
    pub shipping_insurance: f64,
    pub shipping_insurance_is_percentage: bool,
    pub use_detailed_delivery_description: bool,
    pub currency_id: u64,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateDeliveryPriceRuleParams {
    pub variable: String,
    pub operator: String,
    pub max_value: f64,
    pub list_base_price: f64,
    pub list_price: f64,
    pub standard_price: f64,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateShippingMethodParams {
    pub name: String,
    pub provider: String,
    pub product_id: u64,
    pub delivery_type: String,
    pub integration_level: String,
    pub invoice_policy: String,
    pub fixed_price: f64,
    pub margin: f64,
    pub free_over: bool,
    pub amount: f64,
    pub metadata: Option<String>,
}

/// Shipping cost calculation result
#[derive(SpacetimeType, Clone, Debug)]
pub struct ShippingCostResult {
    pub carrier_id: u64,
    pub carrier_name: String,
    pub cost: f64,
    pub currency_id: u64,
    pub estimated_days: Option<u32>,
    pub is_available: bool,
}

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = stock_picking_batch,
    public,
    index(accessor = batch_by_company, btree(columns = [company_id])),
    index(accessor = batch_by_state, btree(columns = [state]))
)]
pub struct StockPickingBatch {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub user_id: Identity,
    pub state: BatchState,
    pub company_id: u64,
    pub picking_ids: Vec<u64>,
    pub scheduled_date: Option<Timestamp>,
    pub move_line_ids: Vec<u64>,
    pub show_check_availability: bool,
    pub move_ids: Vec<u64>,
    pub picking_type_id: Option<u64>,
    pub is_wave: bool,
    pub activity_ids: Vec<u64>,
    pub activity_state: Option<String>,
    pub activity_date_deadline: Option<Timestamp>,
    pub activity_type_id: Option<u64>,
    pub activity_user_id: Option<Identity>,
    pub activity_summary: Option<String>,
    pub message_follower_ids: Vec<u64>,
    pub message_ids: Vec<u64>,
    pub message_needaction: bool,
    pub message_needaction_counter: u32,
    pub rating_ids: Vec<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = delivery_carrier,
    public,
    index(accessor = carrier_by_company, btree(columns = [company_id]))
)]
pub struct DeliveryCarrier {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub active: bool,
    pub company_id: u64,
    pub product_id: u64,
    pub sequence: u32,
    pub delivery_type: String,
    pub integration_level: String,
    pub invoice_policy: String,
    pub country_ids: Vec<u64>,
    pub state_ids: Vec<u64>,
    pub zip_prefix_ids: Vec<String>,
    pub margin: f64,
    pub free_over: bool,
    pub amount: f64,
    pub can_generate_return: bool,
    pub return_label_on_delivery: bool,
    pub get_return_label_from_portal: bool,
    pub fixed_charge: f64,
    pub fixed_weight: f64,
    pub base_on_rule_charge: f64,
    pub base_on_rule_weight: f64,
    pub price_rule_ids: Vec<u64>,
    pub shipping_insurance: f64,
    pub shipping_insurance_is_percentage: bool,
    pub use_detailed_delivery_description: bool,
    pub currency_id: u64,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = delivery_price_rule,
    public,
    index(accessor = price_rule_by_company, btree(columns = [company_id]))
)]
pub struct DeliveryPriceRule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub carrier_id: u64,
    pub variable: String,
    pub operator: String,
    pub max_value: f64,
    pub list_base_price: f64,
    pub list_price: f64,
    pub standard_price: f64,
    pub company_id: u64,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = shipping_method,
    public,
    index(accessor = shipping_method_by_company, btree(columns = [company_id]))
)]
pub struct ShippingMethod {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub provider: String,
    pub company_id: u64,
    pub product_id: u64,
    pub delivery_type: String,
    pub integration_level: String,
    pub invoice_policy: String,
    pub fixed_price: f64,
    pub margin: f64,
    pub free_over: bool,
    pub amount: f64,
    pub active: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn check_rule_condition(value: f64, operator: &str, max_value: f64) -> bool {
    match operator {
        "<=" => value <= max_value,
        "<" => value < max_value,
        ">=" => value >= max_value,
        ">" => value > max_value,
        "=" => (value - max_value).abs() < f64::EPSILON,
        _ => false,
    }
}

/// Calculate shipping cost — internal helper, not a reducer
pub fn calculate_shipping_cost_internal(
    ctx: &ReducerContext,
    carrier_id: u64,
    order_weight: f64,
    order_volume: f64,
    order_value: f64,
    destination_country_id: u64,
    destination_state_id: Option<u64>,
    destination_zip: &str,
) -> Result<(), String> {
    let carrier = ctx
        .db
        .delivery_carrier()
        .id()
        .find(&carrier_id)
        .ok_or("Delivery carrier not found")?;

    check_permission(ctx, carrier.company_id, "delivery_carrier", "read")?;

    if !carrier.country_ids.is_empty() && !carrier.country_ids.contains(&destination_country_id) {
        return Err("Carrier does not service this country".to_string());
    }

    if !carrier.state_ids.is_empty() {
        if let Some(state_id) = destination_state_id {
            if !carrier.state_ids.contains(&state_id) {
                return Err("Carrier does not service this state".to_string());
            }
        }
    }

    if !carrier.zip_prefix_ids.is_empty() {
        let mut zip_allowed = false;
        for prefix in &carrier.zip_prefix_ids {
            if destination_zip.starts_with(prefix) {
                zip_allowed = true;
                break;
            }
        }
        if !zip_allowed {
            return Err("Carrier does not service this ZIP code".to_string());
        }
    }

    let mut cost = match carrier.delivery_type.as_str() {
        "fixed" => carrier.fixed_charge,
        "base_on_rule" => {
            let mut rule_cost = 0.0;
            for rule_id in &carrier.price_rule_ids {
                if let Some(rule) = ctx.db.delivery_price_rule().id().find(rule_id) {
                    let matches = match rule.variable.as_str() {
                        "weight" => {
                            check_rule_condition(order_weight, &rule.operator, rule.max_value)
                        }
                        "volume" => {
                            check_rule_condition(order_volume, &rule.operator, rule.max_value)
                        }
                        "price" => {
                            check_rule_condition(order_value, &rule.operator, rule.max_value)
                        }
                        "quantity" => check_rule_condition(1.0, &rule.operator, rule.max_value),
                        _ => false,
                    };

                    if matches {
                        rule_cost = rule.list_price;
                    }
                }
            }
            rule_cost
        }
        _ => carrier.fixed_charge,
    };

    cost = cost * (1.0 + carrier.margin / 100.0);

    if carrier.free_over && order_value >= carrier.amount {
        cost = 0.0;
    }

    if carrier.shipping_insurance > 0.0 {
        let insurance = if carrier.shipping_insurance_is_percentage {
            order_value * (carrier.shipping_insurance / 100.0)
        } else {
            carrier.shipping_insurance
        };
        cost += insurance;
    }

    Ok(())
}

// ── Reducers ──────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_picking_batch(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreatePickingBatchParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "stock_picking_batch", "create")?;

    for picking_id in &params.picking_ids {
        let picking = ctx
            .db
            .stock_picking()
            .id()
            .find(picking_id)
            .ok_or_else(|| format!("Picking {} not found", picking_id))?;

        if picking.company_id != company_id {
            return Err(format!(
                "Picking {} belongs to different company",
                picking_id
            ));
        }

        if picking.batch_id.is_some() {
            return Err(format!("Picking {} is already in a batch", picking_id));
        }
    }

    let batch = ctx.db.stock_picking_batch().insert(StockPickingBatch {
        id: 0,
        name: params.name,
        user_id: ctx.sender(),
        state: BatchState::Draft,
        company_id,
        picking_ids: params.picking_ids.clone(),
        scheduled_date: params.scheduled_date,
        move_line_ids: Vec::new(),
        show_check_availability: true,
        move_ids: Vec::new(),
        picking_type_id: params.picking_type_id,
        is_wave: params.is_wave,
        activity_ids: Vec::new(),
        activity_state: None,
        activity_date_deadline: None,
        activity_type_id: None,
        activity_user_id: None,
        activity_summary: None,
        message_follower_ids: Vec::new(),
        message_ids: Vec::new(),
        message_needaction: false,
        message_needaction_counter: 0,
        rating_ids: Vec::new(),
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    for picking_id in &params.picking_ids {
        if let Some(picking) = ctx.db.stock_picking().id().find(picking_id) {
            ctx.db.stock_picking().id().update(StockPicking {
                batch_id: Some(batch.id),
                updated_at: ctx.timestamp,
                ..picking
            });
        }
    }

    Ok(())
}

#[reducer]
pub fn create_delivery_carrier(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateDeliveryCarrierParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "delivery_carrier", "create")?;

    for rule_id in &params.price_rule_ids {
        let _rule = ctx
            .db
            .delivery_price_rule()
            .id()
            .find(rule_id)
            .ok_or_else(|| format!("Price rule {} not found", rule_id))?;
    }

    ctx.db.delivery_carrier().insert(DeliveryCarrier {
        id: 0,
        name: params.name,
        active: true,
        company_id,
        product_id: params.product_id,
        sequence: 0,
        delivery_type: params.delivery_type,
        integration_level: params.integration_level,
        invoice_policy: params.invoice_policy,
        country_ids: params.country_ids,
        state_ids: params.state_ids,
        zip_prefix_ids: params.zip_prefix_ids,
        margin: params.margin,
        free_over: params.free_over,
        amount: params.amount,
        can_generate_return: params.can_generate_return,
        return_label_on_delivery: params.return_label_on_delivery,
        get_return_label_from_portal: params.get_return_label_from_portal,
        fixed_charge: params.fixed_charge,
        fixed_weight: params.fixed_weight,
        base_on_rule_charge: 0.0,
        base_on_rule_weight: 0.0,
        price_rule_ids: params.price_rule_ids,
        shipping_insurance: params.shipping_insurance,
        shipping_insurance_is_percentage: params.shipping_insurance_is_percentage,
        use_detailed_delivery_description: params.use_detailed_delivery_description,
        currency_id: params.currency_id,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    Ok(())
}

#[reducer]
pub fn create_delivery_price_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateDeliveryPriceRuleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "delivery_price_rule", "create")?;

    ctx.db.delivery_price_rule().insert(DeliveryPriceRule {
        id: 0,
        carrier_id: 0, // Should be set when linking to carrier
        variable: params.variable,
        operator: params.operator,
        max_value: params.max_value,
        list_base_price: params.list_base_price,
        list_price: params.list_price,
        standard_price: params.standard_price,
        company_id,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    Ok(())
}

#[reducer]
pub fn create_shipping_method(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateShippingMethodParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "shipping_method", "create")?;

    ctx.db.shipping_method().insert(ShippingMethod {
        id: 0,
        name: params.name,
        provider: params.provider,
        company_id,
        product_id: params.product_id,
        delivery_type: params.delivery_type,
        integration_level: params.integration_level,
        invoice_policy: params.invoice_policy,
        fixed_price: params.fixed_price,
        margin: params.margin,
        free_over: params.free_over,
        amount: params.amount,
        active: true,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    Ok(())
}

#[reducer]
pub fn start_picking_batch(
    ctx: &ReducerContext,
    organization_id: u64,
    batch_id: u64,
) -> Result<(), String> {
    let batch = ctx
        .db
        .stock_picking_batch()
        .id()
        .find(&batch_id)
        .ok_or("Batch not found")?;

    check_permission(ctx, organization_id, "stock_picking_batch", "write")?;

    if batch.state != BatchState::Draft {
        return Err("Batch must be in Draft state to start".to_string());
    }

    ctx.db.stock_picking_batch().id().update(StockPickingBatch {
        state: BatchState::InProgress,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..batch
    });

    Ok(())
}

#[reducer]
pub fn complete_picking_batch(
    ctx: &ReducerContext,
    organization_id: u64,
    batch_id: u64,
) -> Result<(), String> {
    let batch = ctx
        .db
        .stock_picking_batch()
        .id()
        .find(&batch_id)
        .ok_or("Batch not found")?;

    check_permission(ctx, organization_id, "stock_picking_batch", "write")?;

    if batch.state != BatchState::InProgress {
        return Err("Batch must be In Progress to complete".to_string());
    }

    ctx.db.stock_picking_batch().id().update(StockPickingBatch {
        state: BatchState::Done,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..batch
    });

    Ok(())
}

#[reducer]
pub fn cancel_picking_batch(
    ctx: &ReducerContext,
    organization_id: u64,
    batch_id: u64,
) -> Result<(), String> {
    let batch = ctx
        .db
        .stock_picking_batch()
        .id()
        .find(&batch_id)
        .ok_or("Batch not found")?;

    check_permission(ctx, organization_id, "stock_picking_batch", "cancel")?;

    if batch.state == BatchState::Done {
        return Err("Cannot cancel a completed batch".to_string());
    }

    ctx.db.stock_picking_batch().id().update(StockPickingBatch {
        state: BatchState::Cancelled,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..batch
    });

    Ok(())
}
