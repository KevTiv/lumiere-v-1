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
use spacetimedb::{reducer, table, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::sales::pos_config::{pos_config, pos_loyalty_program, PosConfig};
use crate::types::{CardState, PaymentStatus, PosOrderState, SessionState};
use crate::iot::registry::iot_device;
use crate::iot::actions::queue_action_internal;

// ── Input Params ──────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePosOrderParams {
    pub session_id: u64,
    pub partner_id: Option<u64>,
    pub lines: Vec<CreatePosOrderLineParams>,
    pub payments: Vec<CreatePosPaymentParams>,
    pub to_invoice: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePosOrderLineParams {
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

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreatePosPaymentParams {
    pub payment_method_id: u64,
    pub amount: f64,
    pub transaction_id: Option<String>,
    pub card_type: Option<String>,
    pub cardholder_name: Option<String>,
    pub card_number: Option<String>,
    pub is_change: bool,
    pub is_tip: bool,
}

// ── Tables ────────────────────────────────────────────────────────────────────

#[table(
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

#[table(
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

#[table(
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

#[table(
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

#[table(
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

// ── Helpers ───────────────────────────────────────────────────────────────────

fn update_loyalty_points(
    ctx: &ReducerContext,
    partner_id: u64,
    points: f64,
    currency_id: u64,
) -> Result<(), String> {
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

    if let Some(card) = cards.into_iter().next() {
        let new_points = card.points + points;
        let new_balance = new_points * 0.01;
        ctx.db.pos_loyalty_card().id().update(PosLoyaltyCard {
            points: new_points,
            points_display: format!("{:.0} points", new_points),
            balance: new_balance,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..card
        });
    }

    Ok(())
}

// ── Reducers ──────────────────────────────────────────────────────────────────

#[reducer]
pub fn open_pos_session(
    ctx: &ReducerContext,
    organization_id: u64,
    config_id: u64,
    cash_register_balance_start: f64,
) -> Result<(), String> {
    let config = ctx
        .db
        .pos_config()
        .id()
        .find(&config_id)
        .ok_or("POS config not found")?;

    check_permission(ctx, organization_id, "pos_session", "create")?;

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

    let sequence_number = config.sequence_number + 1;
    let name = format!("POS/{}-{}", config.id, sequence_number);

    ctx.db.pos_session().insert(PosSession {
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

    ctx.db.pos_config().id().update(PosConfig {
        sequence_number,
        last_session_closing_cash: cash_register_balance_start,
        last_session_closing_date: Some(ctx.timestamp),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..config
    });

    Ok(())
}

#[reducer]
pub fn compute_pos_session_totals(
    ctx: &ReducerContext,
    organization_id: u64,
    session_id: u64,
) -> Result<(), String> {
    let session = ctx
        .db
        .pos_session()
        .id()
        .find(&session_id)
        .ok_or("Session not found")?;

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

#[reducer]
pub fn close_pos_session(
    ctx: &ReducerContext,
    organization_id: u64,
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

    check_permission(ctx, organization_id, "pos_session", "close")?;

    if session.user_id != ctx.sender() {
        return Err("Only the session opener can close the session".to_string());
    }

    if session.state != SessionState::Opened && session.state != SessionState::ClosingControl {
        return Err("Session must be in Opened or Closing Control state".to_string());
    }

    compute_pos_session_totals(ctx, organization_id, session_id)?;

    let refreshed_session = ctx
        .db
        .pos_session()
        .id()
        .find(&session_id)
        .ok_or("Session not found after totals recompute")?;

    ctx.db.pos_session().id().update(PosSession {
        state: SessionState::Closed,
        stop_at: Some(ctx.timestamp),
        cash_register_balance_end_real,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..refreshed_session
    });

    ctx.db.pos_config().id().update(PosConfig {
        last_session_closing_cash: cash_register_balance_end_real,
        last_session_closing_date: Some(ctx.timestamp),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..config
    });

    Ok(())
}

#[reducer]
pub fn create_pos_order(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreatePosOrderParams,
) -> Result<(), String> {
    let session = ctx
        .db
        .pos_session()
        .id()
        .find(&params.session_id)
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

    check_permission(ctx, organization_id, "pos_order", "create")?;

    let uid = format!("{}-{}-{}", config.id, session.id, session.sequence_number);
    let sequence_number = session.sequence_number + 1;

    let mut amount_subtotal: f64 = 0.0;
    let mut amount_discount: f64 = 0.0;
    let mut amount_tax: f64 = 0.0;
    let mut loyalty_points: f64 = 0.0;
    let mut line_ids = Vec::new();

    for (idx, line) in params.lines.iter().enumerate() {
        let price_subtotal = line.price_unit * line.qty;
        let discount_amount = price_subtotal * (line.discount / 100.0);
        let final_subtotal = price_subtotal - discount_amount;
        let price_subtotal_incl = final_subtotal + line.tax_amount;

        let inserted_line = ctx.db.pos_order_line().insert(PosOrderLine {
            id: 0,
            order_id: 0,
            name: line
                .name
                .clone()
                .unwrap_or_else(|| format!("Product {}", line.product_id)),
            skip_change: false,
            is_reward_line: line.is_reward_line,
            reward_id: line.reward_id,
            coupon_id: line.coupon_id,
            price_type: "standard".to_string(),
            notice: None,
            product_id: line.product_id,
            attribute_value_ids: line.attribute_value_ids.clone(),
            product_uom_id: line.uom_id,
            qty: line.qty,
            price_unit: line.price_unit,
            price_subtotal: final_subtotal,
            price_subtotal_incl,
            discount: line.discount,
            tax_ids: line.tax_ids.clone(),
            tax_amount: line.tax_amount,
            tax_amount_currency: line.tax_amount,
            price_extra: line.price_extra,
            full_product_name: line
                .full_product_name
                .clone()
                .unwrap_or_else(|| format!("Product {}", line.product_id)),
            customer_note: line.customer_note.clone(),
            refunded_orderline_id: line.refunded_orderline_id,
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

        line_ids.push(inserted_line.id);
        amount_subtotal += final_subtotal;
        amount_discount += discount_amount;
        amount_tax += line.tax_amount;

        if line.is_reward_line {
            loyalty_points += line.loyalty_points.unwrap_or(0.0);
        }
    }

    let amount_total = amount_subtotal + amount_tax;

    let mut amount_paid: f64 = 0.0;
    let mut is_tipped = false;
    let mut tip_amount: f64 = 0.0;
    let mut payment_ids = Vec::new();

    for payment in &params.payments {
        let inserted_payment = ctx.db.pos_payment().insert(PosPayment {
            id: 0,
            order_id: 0,
            payment_method_id: payment.payment_method_id,
            session_id: params.session_id,
            company_id: config.company_id,
            currency_id: config.currency_id,
            amount: payment.amount,
            payment_status: PaymentStatus::Done,
            payment_date: ctx.timestamp,
            ticket: None,
            transaction_id: payment.transaction_id.clone(),
            card_type: payment.card_type.clone(),
            cardholder_name: payment.cardholder_name.clone(),
            card_number: payment.card_number.clone(),
            is_change: payment.is_change,
            name: format!("Payment {}", payment_ids.len() + 1),
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: None,
        });

        payment_ids.push(inserted_payment.id);
        amount_paid += payment.amount;

        if payment.is_tip {
            is_tipped = true;
            tip_amount += payment.amount;
        }
    }

    let amount_return = if amount_paid > amount_total {
        amount_paid - amount_total
    } else {
        0.0
    };

    let order = ctx.db.pos_order().insert(PosOrder {
        id: 0,
        uid: uid.clone(),
        ticket_number: Some(format!("TICKET-{}", uid)),
        session_id: params.session_id,
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
        partner_id: params.partner_id,
        sequence_number,
        loyalty_points,
        to_invoice: params.to_invoice,
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

    for line_id in &line_ids {
        if let Some(line) = ctx.db.pos_order_line().id().find(line_id) {
            ctx.db.pos_order_line().id().update(PosOrderLine {
                order_id: order.id,
                ..line
            });
        }
    }

    for payment_id in &payment_ids {
        if let Some(payment) = ctx.db.pos_payment().id().find(payment_id) {
            ctx.db.pos_payment().id().update(PosPayment {
                order_id: order.id,
                ..payment
            });
        }
    }

    let mut updated_order_ids = session.order_ids.clone();
    updated_order_ids.push(order.id);
    ctx.db.pos_session().id().update(PosSession {
        order_ids: updated_order_ids,
        order_count: session.order_count + 1,
        sequence_number,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..session
    });

    if let Some(partner_id) = params.partner_id {
        if config.module_pos_loyalty {
            let _ = update_loyalty_points(ctx, partner_id, loyalty_points, config.currency_id);
        }
    }

    // ── IoT hooks ─────────────────────────────────────────────────────────────
    // Push order total to any CustomerDisplay linked to this POS config
    // Initiate payment on any PaymentTerminal linked to this POS config
    for device in ctx.db.iot_device().iter().filter(|d| {
        d.pos_config_id == Some(config.id) && d.status == "Online"
    }) {
        match device.device_type.as_str() {
            "CustomerDisplay" => {
                let display_payload = serde_json::json!({
                    "order_id": order.id,
                    "amount_total": amount_total,
                    "currency_id": config.currency_id,
                    "lines": params.lines.len(),
                })
                .to_string();
                queue_action_internal(
                    ctx,
                    organization_id,
                    device.id,
                    "DisplayMessage",
                    &display_payload,
                    "create_pos_order",
                );
            }
            "PaymentTerminal" => {
                // Only trigger payment terminal if payment method is card
                let has_card_payment = params.payments.iter().any(|p| {
                    p.payment_method_id > 0 // simplified: non-zero method = card
                });
                if has_card_payment {
                    let payment_payload = serde_json::json!({
                        "order_id": order.id,
                        "amount": amount_total,
                        "currency_id": config.currency_id,
                    })
                    .to_string();
                    queue_action_internal(
                        ctx,
                        organization_id,
                        device.id,
                        "InitiatePayment",
                        &payment_payload,
                        "create_pos_order",
                    );
                }
            }
            "ReceiptPrinter" => {
                let receipt_payload =
                    serde_json::json!({ "order_id": order.id, "auto": true }).to_string();
                queue_action_internal(
                    ctx,
                    organization_id,
                    device.id,
                    "PrintReceipt",
                    &receipt_payload,
                    "create_pos_order",
                );
            }
            _ => {}
        }
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(config.company_id),
            table_name: "pos_order",
            record_id: order.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "amount_total": amount_total }).to_string()),
            changed_fields: vec!["amount_total".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn create_loyalty_card(
    ctx: &ReducerContext,
    organization_id: u64,
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

    check_permission(ctx, organization_id, "pos_loyalty_card", "create")?;

    let existing: Vec<_> = ctx
        .db
        .pos_loyalty_card()
        .iter()
        .filter(|c| c.code == code)
        .collect();

    if !existing.is_empty() {
        return Err("Loyalty card code already exists".to_string());
    }

    let expiration_date = program.validity_duration.map(|duration| {
        let seconds = match program.validity_duration_type.as_deref() {
            Some("days") => duration as u64 * 86400,
            Some("weeks") => duration as u64 * 604800,
            Some("months") => duration as u64 * 2592000,
            _ => duration as u64 * 86400,
        };
        ctx.timestamp + std::time::Duration::from_secs(seconds)
    });

    ctx.db.pos_loyalty_card().insert(PosLoyaltyCard {
        id: 0,
        partner_id,
        code,
        points,
        points_display: format!("{:.0} points", points),
        currency_id: program.currency_id,
        balance: points * 0.01,
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
