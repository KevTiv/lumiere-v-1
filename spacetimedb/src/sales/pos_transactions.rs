/// POS Transactions Module — POS Sessions, Orders, Payments, and Loyalty Cards
///
/// Tables:
///   - PosSession        POS session management (open, close, reconcile)
///   - PosOrder          Customer orders/transactions
///   - PosOrderLine      Order line items
///   - PosPayment        Payment records
///   - PosLoyaltyCard    Customer loyalty cards
///
/// Key Features:
///   - Session lifecycle management
///   - Real-time order processing
///   - Multiple payment support
///   - Loyalty point tracking
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::company;
use crate::helpers::{check_permission, write_audit_log};
use crate::sales::pos_config::{pos_config, pos_loyalty_program, PosConfig, PosLoyaltyProgram};
use crate::types::{CardState, PaymentStatus, PosOrderState, SessionState};

// ══════════════════════════════════════════════════════════════════════════════
// INPUT TYPES
// ══════════════════════════════════════════════════════════════════════════════

/// Input for creating POS order
#[derive(SpacetimeType, Clone, Debug)]
pub struct PosOrderInput {
    pub session_id: u64,
    pub partner_id: Option<u64>,
    pub lines: Vec<PosOrderLineInput>,
    pub payments: Vec<PosPaymentInput>,
    pub to_invoice: bool,
}

/// Input for POS order lines
#[derive(SpacetimeType, Clone, Debug)]
pub struct PosOrderLineInput {
    pub product_id: u64,
    pub qty: f64,
    pub uom_id: u64,
    pub price_unit: f64,
    pub discount: f64,
    pub tax_ids: Vec<u64>,
    pub tax_amount: f64,
    pub price_extra: f64,
    pub name: Option<String>,
    pub full_product_name: Option<String>,
    pub customer_note: Option<String>,
    pub attribute_value_ids: Vec<u64>,
    pub is_reward_line: bool,
    pub reward_id: Option<u64>,
    pub coupon_id: Option<u64>,
    pub refunded_orderline_id: Option<u64>,
    pub loyalty_points: Option<f64>,
}

/// Input for POS payments
#[derive(SpacetimeType, Clone, Debug)]
pub struct PosPaymentInput {
    pub payment_method_id: u64,
    pub amount: f64,
    pub transaction_id: Option<String>,
    pub card_type: Option<String>,
    pub cardholder_name: Option<String>,
    pub card_number: Option<String>,
    pub is_change: bool,
    pub is_tip: bool,
}

// ══════════════════════════════════════════════════════════════════════════════
// TABLES: POS TRANSACTIONS
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = pos_session,
    public,
    index(accessor = session_by_user, btree(columns = [user_id])),
    index(accessor = session_by_config, btree(columns = [config_id]))
)]
pub struct PosSession {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub user_id: Identity,
    pub config_id: u64,
    pub start_at: Timestamp,
    pub stop_at: Option<Timestamp>,
    pub state: SessionState,
    pub sequence_number: u32,
    pub login_number: u32,
    pub cash_journal_id: Option<u64>,
    pub cash_register_id: Option<u64>,
    pub cash_register_balance_start: f64,
    pub cash_register_balance_end_real: f64,
    pub cash_register_total_entry_encoding: f64,
    pub cash_journal_ids: Vec<u64>,
    pub order_ids: Vec<u64>,
    pub order_count: u32,
    pub statement_ids: Vec<u64>,
    pub rescue: bool,
    pub activity_ids: Vec<u64>,
    pub activity_state: Option<String>,
    pub activity_date_deadline: Option<Timestamp>,
    pub activity_type_id: Option<u64>,
    pub activity_summary: Option<String>,
    pub activity_user_id: Option<Identity>,
    pub message_ids: Vec<u64>,
    pub message_follower_ids: Vec<u64>,
    pub rating_ids: Vec<u64>,
    pub access_token: Option<String>,
    pub access_url: Option<String>,
    pub access_warning: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = pos_order,
    public,
    index(accessor = pos_order_by_session, btree(columns = [session_id])),
    index(accessor = pos_order_by_partner, btree(columns = [partner_id]))
)]
pub struct PosOrder {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub uid: String,
    pub ticket_number: Option<String>,
    pub session_id: u64,
    pub config_id: u64,
    pub state: PosOrderState,
    pub user_id: Identity,
    pub amount_paid: f64,
    pub amount_return: f64,
    pub amount_tax: f64,
    pub amount_total: f64,
    pub amount_discount: f64,
    pub amount_delivery: f64,
    pub amount_subtotal: f64,
    pub company_id: u64,
    pub pricelist_id: u64,
    pub partner_id: Option<u64>,
    pub sequence_number: u32,
    pub loyalty_points: f64,
    pub to_invoice: bool,
    pub is_tipped: bool,
    pub tip_amount: f64,
    pub access_token: Option<String>,
    pub lines: Vec<u64>,
    pub statement_ids: Vec<u64>,
    pub pos_reference: Option<String>,
    pub sale_journal: u64,
    pub account_move: Option<u64>,
    pub picking_id: Option<u64>,
    pub picking_type_id: Option<u64>,
    pub location_id: u64,
    pub note: Option<String>,
    pub nb_print: u32,
    pub pos_name: Option<String>,
    pub pos_version: Option<String>,
    pub pos_session_version: Option<String>,
    pub crm_team_id: Option<u64>,
    pub procurement_group_id: Option<u64>,
    pub margin: f64,
    pub margin_percent: f64,
    pub is_partially_paid: bool,
    pub shipping_date: Option<Timestamp>,
    pub last_order_preparation_change: Option<String>,
    pub date_order: Timestamp,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = pos_order_line,
    public,
    index(accessor = pos_line_by_order, btree(columns = [order_id]))
)]
pub struct PosOrderLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub order_id: u64,
    pub name: String,
    pub skip_change: bool,
    pub is_reward_line: bool,
    pub reward_id: Option<u64>,
    pub coupon_id: Option<u64>,
    pub price_type: String,
    pub notice: Option<String>,
    pub product_id: u64,
    pub attribute_value_ids: Vec<u64>,
    pub product_uom_id: u64,
    pub qty: f64,
    pub price_unit: f64,
    pub price_subtotal: f64,
    pub price_subtotal_incl: f64,
    pub discount: f64,
    pub tax_ids: Vec<u64>,
    pub tax_amount: f64,
    pub tax_amount_currency: f64,
    pub price_extra: f64,
    pub full_product_name: String,
    pub customer_note: Option<String>,
    pub refunded_orderline_id: Option<u64>,
    pub refunded_qty: f64,
    pub uuid: String,
    pub mp_skip: bool,
    pub mp_dirty: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = pos_payment,
    public,
    index(accessor = payment_by_session, btree(columns = [session_id]))
)]
pub struct PosPayment {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub order_id: u64,
    pub payment_method_id: u64,
    pub session_id: u64,
    pub company_id: u64,
    pub currency_id: u64,
    pub amount: f64,
    pub payment_status: PaymentStatus,
    pub payment_date: Timestamp,
    pub ticket: Option<String>,
    pub transaction_id: Option<String>,
    pub card_type: Option<String>,
    pub cardholder_name: Option<String>,
    pub card_number: Option<String>,
    pub is_change: bool,
    pub name: String,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = pos_loyalty_card,
    public,
    index(accessor = loyalty_card_by_code, btree(columns = [code]))
)]
pub struct PosLoyaltyCard {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub partner_id: Option<u64>,
    pub code: String,
    pub points: f64,
    pub points_display: String,
    pub currency_id: u64,
    pub balance: f64,
    pub expiration_date: Option<Timestamp>,
    pub state: CardState,
    pub is_active: bool,
    pub order_ids: Vec<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: POS TRANSACTIONS
// ══════════════════════════════════════════════════════════════════════════════

fn resolve_organization_id_from_company(
    ctx: &ReducerContext,
    company_id: u64,
) -> Result<u64, String> {
    let comp = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;

    if comp.deleted_at.is_some() {
        return Err("Company is archived".to_string());
    }

    Ok(comp.organization_id)
}

#[spacetimedb::reducer]
pub fn open_pos_session(
    ctx: &ReducerContext,
    config_id: u64,
    cash_register_balance_start: f64,
) -> Result<(), String> {
    let config = ctx
        .db
        .pos_config()
        .id()
        .find(&config_id)
        .ok_or("POS config not found")?;

    let organization_id = resolve_organization_id_from_company(ctx, config.company_id)?;
    check_permission(ctx, organization_id, "pos_session", "create")?;

    // Check if there's already an open session for this user/config
    let existing_session: Vec<_> = ctx
        .db
        .pos_session()
        .iter()
        .filter(|s| {
            s.config_id == config_id && s.user_id == ctx.sender() && s.state != SessionState::Closed
        })
        .collect();

    if !existing_session.is_empty() {
        return Err("You already have an open session for this POS".to_string());
    }

    // Generate session name
    let sequence_number = config.sequence_number + 1;
    let name = format!("POS/{}-{}", config.id, sequence_number);

    let session = ctx.db.pos_session().insert(PosSession {
        id: 0,
        name,
        user_id: ctx.sender(),
        config_id,
        start_at: ctx.timestamp,
        stop_at: None,
        state: SessionState::Opened,
        sequence_number,
        login_number: 1,
        cash_journal_id: config.cash_journal_id,
        cash_register_id: config.cash_register_id,
        cash_register_balance_start,
        cash_register_balance_end_real: 0.0,
        cash_register_total_entry_encoding: 0.0,
        cash_journal_ids: Vec::new(),
        order_ids: Vec::new(),
        order_count: 0,
        statement_ids: Vec::new(),
        rescue: false,
        activity_ids: Vec::new(),
        activity_state: None,
        activity_date_deadline: None,
        activity_type_id: None,
        activity_summary: None,
        activity_user_id: None,
        message_ids: Vec::new(),
        message_follower_ids: Vec::new(),
        rating_ids: Vec::new(),
        access_token: None,
        access_url: None,
        access_warning: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    // Update config sequence
    ctx.db
        .pos_config()
        .id()
        .update(crate::sales::pos_config::PosConfig {
            sequence_number,
            last_session_closing_cash: cash_register_balance_start,
            last_session_closing_date: Some(ctx.timestamp),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..config
        });

    Ok(())
}

#[spacetimedb::reducer]
pub fn compute_pos_session_totals(ctx: &ReducerContext, session_id: u64) -> Result<(), String> {
    let session = ctx
        .db
        .pos_session()
        .id()
        .find(&session_id)
        .ok_or("Session not found")?;

    let config = ctx
        .db
        .pos_config()
        .id()
        .find(&session.config_id)
        .ok_or("POS config not found")?;

    let organization_id = resolve_organization_id_from_company(ctx, config.company_id)?;
    check_permission(ctx, organization_id, "pos_session", "write")?;

    let mut total_entry_encoding: f64 = 0.0;
    for order_id in &session.order_ids {
        if let Some(order) = ctx.db.pos_order().id().find(order_id) {
            total_entry_encoding += order.amount_total;
        }
    }

    ctx.db.pos_session().id().update(PosSession {
        cash_register_total_entry_encoding: total_entry_encoding,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..session
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn close_pos_session(
    ctx: &ReducerContext,
    session_id: u64,
    cash_register_balance_end_real: f64,
) -> Result<(), String> {
    let session = ctx
        .db
        .pos_session()
        .id()
        .find(&session_id)
        .ok_or("Session not found")?;

    let config = ctx
        .db
        .pos_config()
        .id()
        .find(&session.config_id)
        .ok_or("POS config not found")?;

    let organization_id = resolve_organization_id_from_company(ctx, config.company_id)?;
    check_permission(ctx, organization_id, "pos_session", "close")?;

    if session.user_id != ctx.sender() {
        return Err("Only the session opener can close the session".to_string());
    }

    if session.state != SessionState::Opened && session.state != SessionState::ClosingControl {
        return Err("Session must be in Opened or Closing Control state".to_string());
    }

    // Recompute totals to keep session aggregates consistent
    compute_pos_session_totals(ctx, session_id)?;

    let refreshed_session = ctx
        .db
        .pos_session()
        .id()
        .find(&session_id)
        .ok_or("Session not found after totals recompute")?;

    // Update session
    ctx.db.pos_session().id().update(PosSession {
        state: SessionState::Closed,
        stop_at: Some(ctx.timestamp),
        cash_register_balance_end_real,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..refreshed_session
    });

    // Update config
    ctx.db
        .pos_config()
        .id()
        .update(crate::sales::pos_config::PosConfig {
            last_session_closing_cash: cash_register_balance_end_real,
            last_session_closing_date: Some(ctx.timestamp),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..config
        });

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_pos_order(ctx: &ReducerContext, input: PosOrderInput) -> Result<(), String> {
    let session = ctx
        .db
        .pos_session()
        .id()
        .find(&input.session_id)
        .ok_or("Session not found")?;

    if session.state != SessionState::Opened {
        return Err("Session must be open to create orders".to_string());
    }

    let config = ctx
        .db
        .pos_config()
        .id()
        .find(&session.config_id)
        .ok_or("POS config not found")?;

    let organization_id = resolve_organization_id_from_company(ctx, config.company_id)?;
    check_permission(ctx, organization_id, "pos_order", "create")?;

    // Generate unique order ID
    let uid = format!("{}-{}-{}", config.id, session.id, session.sequence_number);
    let sequence_number = session.sequence_number + 1;

    // Calculate totals
    let mut amount_subtotal: f64 = 0.0;
    let mut amount_discount: f64 = 0.0;
    let mut amount_tax: f64 = 0.0;
    let mut loyalty_points: f64 = 0.0;
    let mut line_ids = Vec::new();

    // Create order lines
    for (idx, line_input) in input.lines.iter().enumerate() {
        let price_subtotal = line_input.price_unit * line_input.qty;
        let discount_amount = price_subtotal * (line_input.discount / 100.0);
        let final_subtotal = price_subtotal - discount_amount;
        let price_subtotal_incl = final_subtotal + line_input.tax_amount;

        let line = ctx.db.pos_order_line().insert(PosOrderLine {
            id: 0,
            order_id: 0, // Will be updated
            name: line_input
                .name
                .clone()
                .unwrap_or_else(|| format!("Product {}", line_input.product_id)),
            skip_change: false,
            is_reward_line: line_input.is_reward_line,
            reward_id: line_input.reward_id,
            coupon_id: line_input.coupon_id,
            price_type: "standard".to_string(),
            notice: None,
            product_id: line_input.product_id,
            attribute_value_ids: line_input.attribute_value_ids.clone(),
            product_uom_id: line_input.uom_id,
            qty: line_input.qty,
            price_unit: line_input.price_unit,
            price_subtotal: final_subtotal,
            price_subtotal_incl,
            discount: line_input.discount,
            tax_ids: line_input.tax_ids.clone(),
            tax_amount: line_input.tax_amount,
            tax_amount_currency: line_input.tax_amount,
            price_extra: line_input.price_extra,
            full_product_name: line_input
                .full_product_name
                .clone()
                .unwrap_or_else(|| format!("Product {}", line_input.product_id)),
            customer_note: line_input.customer_note.clone(),
            refunded_orderline_id: line_input.refunded_orderline_id,
            refunded_qty: 0.0,
            uuid: format!("{}-{}", uid, idx),
            mp_skip: false,
            mp_dirty: false,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: None,
        });

        line_ids.push(line.id);
        amount_subtotal += final_subtotal;
        amount_discount += discount_amount;
        amount_tax += line_input.tax_amount;

        if line_input.is_reward_line {
            loyalty_points += line_input.loyalty_points.unwrap_or(0.0);
        }
    }

    let amount_total = amount_subtotal + amount_tax;

    // Process payments
    let mut amount_paid: f64 = 0.0;
    let mut is_tipped = false;
    let mut tip_amount: f64 = 0.0;
    let mut payment_ids = Vec::new();

    for payment_input in &input.payments {
        let payment = ctx.db.pos_payment().insert(PosPayment {
            id: 0,
            order_id: 0, // Will be updated
            payment_method_id: payment_input.payment_method_id,
            session_id: input.session_id,
            company_id: config.company_id,
            currency_id: config.currency_id,
            amount: payment_input.amount,
            payment_status: PaymentStatus::Done,
            payment_date: ctx.timestamp,
            ticket: None,
            transaction_id: payment_input.transaction_id.clone(),
            card_type: payment_input.card_type.clone(),
            cardholder_name: payment_input.cardholder_name.clone(),
            card_number: payment_input.card_number.clone(),
            is_change: payment_input.is_change,
            name: format!("Payment {}", payment_ids.len() + 1),
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: None,
        });

        payment_ids.push(payment.id);
        amount_paid += payment_input.amount;

        if payment_input.is_tip {
            is_tipped = true;
            tip_amount += payment_input.amount;
        }
    }

    let amount_return = if amount_paid > amount_total {
        amount_paid - amount_total
    } else {
        0.0
    };

    // Create the order
    let order = ctx.db.pos_order().insert(PosOrder {
        id: 0,
        uid: uid.clone(),
        ticket_number: Some(format!("TICKET-{}", uid)),
        session_id: input.session_id,
        config_id: session.config_id,
        state: PosOrderState::Paid,
        user_id: ctx.sender(),
        amount_paid,
        amount_return,
        amount_tax,
        amount_total,
        amount_discount,
        amount_delivery: 0.0,
        amount_subtotal,
        company_id: config.company_id,
        pricelist_id: config.pricelist_id,
        partner_id: input.partner_id,
        sequence_number,
        loyalty_points,
        to_invoice: input.to_invoice,
        is_tipped,
        tip_amount,
        access_token: None,
        lines: line_ids.clone(),
        statement_ids: payment_ids.clone(),
        pos_reference: Some(format!("Order {}", uid)),
        sale_journal: config.journal_id,
        account_move: None,
        picking_id: None,
        picking_type_id: Some(config.picking_type_id),
        location_id: config.stock_location_id,
        note: None,
        nb_print: 0,
        pos_name: Some(config.name.clone()),
        pos_version: Some("1.0.0".to_string()),
        pos_session_version: Some("1.0.0".to_string()),
        crm_team_id: config.crm_team_id,
        procurement_group_id: None,
        margin: 0.0,
        margin_percent: 0.0,
        is_partially_paid: amount_paid < amount_total,
        shipping_date: None,
        last_order_preparation_change: None,
        date_order: ctx.timestamp,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    // Update line order_ids
    for line_id in &line_ids {
        if let Some(line) = ctx.db.pos_order_line().id().find(line_id) {
            ctx.db.pos_order_line().id().update(PosOrderLine {
                order_id: order.id,
                ..line
            });
        }
    }

    // Update payment order_ids
    for payment_id in &payment_ids {
        if let Some(payment) = ctx.db.pos_payment().id().find(payment_id) {
            ctx.db.pos_payment().id().update(PosPayment {
                order_id: order.id,
                ..payment
            });
        }
    }

    // Update session
    let mut updated_order_ids = session.order_ids;
    updated_order_ids.push(order.id);
    ctx.db.pos_session().id().update(PosSession {
        order_ids: updated_order_ids,
        order_count: session.order_count + 1,
        sequence_number,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..session
    });

    // Update loyalty points if applicable
    if let Some(partner_id) = input.partner_id {
        if config.module_pos_loyalty {
            let _ = update_loyalty_points(ctx, partner_id, loyalty_points, config.currency_id);
        }
    }

    write_audit_log(
        ctx,
        organization_id,
        Some(config.company_id),
        "pos_order",
        order.id,
        "create",
        None,
        Some(serde_json::json!({ "amount_total": amount_total }).to_string()),
        vec!["amount_total".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_loyalty_card(
    ctx: &ReducerContext,
    partner_id: Option<u64>,
    program_id: u64,
    code: String,
    points: f64,
) -> Result<(), String> {
    let program = ctx
        .db
        .pos_loyalty_program()
        .id()
        .find(&program_id)
        .ok_or("Loyalty program not found")?;

    check_permission(ctx, 0, "pos_loyalty_card", "create")?; // Company ID needs to be retrieved from context

    // Check if code already exists
    let existing: Vec<_> = ctx
        .db
        .pos_loyalty_card()
        .iter()
        .filter(|c| c.code == code)
        .collect();

    if !existing.is_empty() {
        return Err("Loyalty card code already exists".to_string());
    }

    // Calculate expiration
    let expiration_date = program.validity_duration.map(|duration| {
        let seconds = match program.validity_duration_type.as_deref() {
            Some("days") => duration as u64 * 86400,
            Some("weeks") => duration as u64 * 604800,
            Some("months") => duration as u64 * 2592000,
            _ => duration as u64 * 86400,
        };
        ctx.timestamp + std::time::Duration::from_secs(seconds)
    });

    let card = ctx.db.pos_loyalty_card().insert(PosLoyaltyCard {
        id: 0,
        partner_id,
        code,
        points,
        points_display: format!("{:.0} points", points),
        currency_id: program.currency_id,
        balance: points * 0.01, // Conversion rate
        expiration_date,
        state: CardState::Active,
        is_active: true,
        order_ids: Vec::new(),
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    Ok(())
}

// Helper function to update loyalty points
fn update_loyalty_points(
    ctx: &ReducerContext,
    partner_id: u64,
    points: f64,
    currency_id: u64,
) -> Result<(), String> {
    // Find active loyalty card for partner
    let cards: Vec<_> = ctx
        .db
        .pos_loyalty_card()
        .iter()
        .filter(|c| {
            c.partner_id == Some(partner_id)
                && c.currency_id == currency_id
                && c.is_active
                && c.state == CardState::Active
        })
        .collect();

    if let Some(card) = cards.first() {
        let new_points = card.points + points;
        let new_balance = new_points * 0.01;

        ctx.db.pos_loyalty_card().id().update(PosLoyaltyCard {
            id: card.id,
            partner_id: card.partner_id,
            code: card.code.clone(),
            points: new_points,
            points_display: format!("{:.0} points", new_points),
            currency_id: card.currency_id,
            balance: new_balance,
            expiration_date: card.expiration_date,
            state: card.state.clone(),
            is_active: card.is_active,
            order_ids: card.order_ids.clone(),
            create_uid: card.create_uid,
            create_date: card.create_date,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: card.metadata.clone(),
        });
    }

    Ok(())
}
