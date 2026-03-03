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
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::check_permission;
use crate::inventory::product::product;
use crate::inventory::stock::{stock_picking, StockPicking};
use crate::types::BatchState;

// ══════════════════════════════════════════════════════════════════════════════
// INPUT TYPES
// ══════════════════════════════════════════════════════════════════════════════

/// Input for creating picking batch
#[derive(SpacetimeType, Clone, Debug)]
pub struct PickingBatchInput {
    pub name: String,
    pub company_id: u64,
    pub picking_type_id: Option<u64>,
    pub scheduled_date: Option<Timestamp>,
    pub picking_ids: Vec<u64>,
    pub is_wave: bool,
}

/// Input for creating delivery carrier
#[derive(SpacetimeType, Clone, Debug)]
pub struct DeliveryCarrierInput {
    pub name: String,
    pub company_id: u64,
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

/// Input for creating delivery price rule
#[derive(SpacetimeType, Clone, Debug)]
pub struct DeliveryPriceRuleInput {
    pub variable: String,
    pub operator: String,
    pub max_value: f64,
    pub list_base_price: f64,
    pub list_price: f64,
    pub standard_price: f64,
    pub company_id: u64,
    pub metadata: Option<String>,
}

/// Input for creating shipping method
#[derive(SpacetimeType, Clone, Debug)]
pub struct ShippingMethodInput {
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

// ══════════════════════════════════════════════════════════════════════════════
// TABLES: DELIVERY & SHIPPING
// ══════════════════════════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: DELIVERY & SHIPPING
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_picking_batch(ctx: &ReducerContext, input: PickingBatchInput) -> Result<(), String> {
    check_permission(ctx, input.company_id, "stock_picking_batch", "create")?;

    // Validate pickings
    for picking_id in &input.picking_ids {
        let picking = ctx
            .db
            .stock_picking()
            .id()
            .find(picking_id)
            .ok_or_else(|| format!("Picking {} not found", picking_id))?;

        if picking.company_id != input.company_id {
            return Err(format!(
                "Picking {} belongs to different company",
                picking_id
            ));
        }

        // Verify picking is not already in a batch
        if picking.batch_id.is_some() {
            return Err(format!("Picking {} is already in a batch", picking_id));
        }
    }

    let batch = ctx.db.stock_picking_batch().insert(StockPickingBatch {
        id: 0,
        name: input.name,
        user_id: ctx.sender(),
        state: BatchState::Draft,
        company_id: input.company_id,
        picking_ids: input.picking_ids.clone(),
        scheduled_date: input.scheduled_date,
        move_line_ids: Vec::new(),
        show_check_availability: true,
        move_ids: Vec::new(),
        picking_type_id: input.picking_type_id,
        is_wave: input.is_wave,
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

    // Update pickings to reference this batch
    for picking_id in &input.picking_ids {
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

#[spacetimedb::reducer]
pub fn create_delivery_carrier(
    ctx: &ReducerContext,
    input: DeliveryCarrierInput,
) -> Result<(), String> {
    check_permission(ctx, input.company_id, "delivery_carrier", "create")?;

    // Validate price rules
    for rule_id in &input.price_rule_ids {
        let _rule = ctx
            .db
            .delivery_price_rule()
            .id()
            .find(rule_id)
            .ok_or_else(|| format!("Price rule {} not found", rule_id))?;
    }

    ctx.db.delivery_carrier().insert(DeliveryCarrier {
        id: 0,
        name: input.name,
        active: true,
        company_id: input.company_id,
        product_id: input.product_id,
        sequence: 0,
        delivery_type: input.delivery_type,
        integration_level: input.integration_level,
        invoice_policy: input.invoice_policy,
        country_ids: input.country_ids,
        state_ids: input.state_ids,
        zip_prefix_ids: input.zip_prefix_ids,
        margin: input.margin,
        free_over: input.free_over,
        amount: input.amount,
        can_generate_return: input.can_generate_return,
        return_label_on_delivery: input.return_label_on_delivery,
        get_return_label_from_portal: input.get_return_label_from_portal,
        fixed_charge: input.fixed_charge,
        fixed_weight: input.fixed_weight,
        base_on_rule_charge: 0.0,
        base_on_rule_weight: 0.0,
        price_rule_ids: input.price_rule_ids,
        shipping_insurance: input.shipping_insurance,
        shipping_insurance_is_percentage: input.shipping_insurance_is_percentage,
        use_detailed_delivery_description: input.use_detailed_delivery_description,
        currency_id: input.currency_id,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: input.metadata,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_delivery_price_rule(
    ctx: &ReducerContext,
    input: DeliveryPriceRuleInput,
) -> Result<(), String> {
    check_permission(ctx, input.company_id, "delivery_price_rule", "create")?;

    ctx.db.delivery_price_rule().insert(DeliveryPriceRule {
        id: 0,
        carrier_id: 0, // Should be set when linking to carrier
        variable: input.variable,
        operator: input.operator,
        max_value: input.max_value,
        list_base_price: input.list_base_price,
        list_price: input.list_price,
        standard_price: input.standard_price,
        company_id: input.company_id,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: input.metadata,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_shipping_method(
    ctx: &ReducerContext,
    input: ShippingMethodInput,
) -> Result<(), String> {
    check_permission(ctx, input.company_id, "shipping_method", "create")?;

    let method = ctx.db.shipping_method().insert(ShippingMethod {
        id: 0,
        name: input.name,
        provider: input.provider,
        company_id: input.company_id,
        product_id: input.product_id,
        delivery_type: input.delivery_type,
        integration_level: input.integration_level,
        invoice_policy: input.invoice_policy,
        fixed_price: input.fixed_price,
        margin: input.margin,
        free_over: input.free_over,
        amount: input.amount,
        active: true,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: input.metadata,
    });

    Ok(())
}

/// Calculate shipping cost - internal function, not a reducer
/// This can be called from other reducers but cannot be called directly from clients
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

    // Check if carrier services the destination
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

    // Check ZIP prefix restrictions
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

    // Calculate base cost
    let mut cost = match carrier.delivery_type.as_str() {
        "fixed" => carrier.fixed_charge,
        "base_on_rule" => {
            // Apply price rules
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

    // Add margin
    cost = cost * (1.0 + carrier.margin / 100.0);

    // Check free over threshold
    if carrier.free_over && order_value >= carrier.amount {
        cost = 0.0;
    }

    // Add insurance if applicable
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

#[spacetimedb::reducer]
pub fn start_picking_batch(ctx: &ReducerContext, batch_id: u64) -> Result<(), String> {
    let batch = ctx
        .db
        .stock_picking_batch()
        .id()
        .find(&batch_id)
        .ok_or("Batch not found")?;

    check_permission(ctx, batch.company_id, "stock_picking_batch", "write")?;

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

#[spacetimedb::reducer]
pub fn complete_picking_batch(ctx: &ReducerContext, batch_id: u64) -> Result<(), String> {
    let batch = ctx
        .db
        .stock_picking_batch()
        .id()
        .find(&batch_id)
        .ok_or("Batch not found")?;

    check_permission(ctx, batch.company_id, "stock_picking_batch", "write")?;

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

#[spacetimedb::reducer]
pub fn cancel_picking_batch(ctx: &ReducerContext, batch_id: u64) -> Result<(), String> {
    let batch = ctx
        .db
        .stock_picking_batch()
        .id()
        .find(&batch_id)
        .ok_or("Batch not found")?;

    check_permission(ctx, batch.company_id, "stock_picking_batch", "cancel")?;

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
