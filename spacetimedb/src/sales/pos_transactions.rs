/// POS Transactions Module — POS Sessions, Orders, Payments, and Loyalty Cards
///
/// Tables:
///   - PosSession        POS session management (open, close, reconcile)
///   - PosOrder          Customer orders/transactions
///   - PosOrderLine      Order line items
///   - PosPayment        Payment records
///   - PosLoyaltyCard    Customer loyalty cards (`organization_id` scoped)
///
/// Key Features:
///   - Session lifecycle management
///   - Real-time order processing
///   - Multiple payment support
///   - Loyalty point tracking
use std::collections::BTreeSet;

use spacetimedb::{reducer, table, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::cold_tier::{
    finalize_cooling, prove_durable_row, AggregateChildRef, AggregateFinalizationPlan,
    AggregateRootRef, CoolingEligibilityFacts,
};
use crate::core::persistence::{record_organization_commit, OrganizationCommitInput, RowChange};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::iot::actions::{iot_action, queue_action_internal};
use crate::iot::registry::iot_device;
use crate::sales::pos_config::{pos_config, pos_loyalty_program, PosConfig};
use crate::types::{CardState, PaymentStatus, PosOrderState, SessionState};

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

/// Server-only complete aggregate payload for rehydrating a cooled POS order.
/// The API server obtains the rows from the placement-resolved durable
/// projection and calls this reducer with the registered hydrator identity.
#[derive(SpacetimeType, Clone, Debug)]
pub struct HydratePosOrderAggregateParams {
    pub organization_id: u64,
    pub company_id: u64,
    pub placement_generation: u64,
    pub schema_version: u32,
    pub archive_version: u64,
    pub payload_checksum: String,
    pub order_json: String,
    pub lines_json: Vec<String>,
    pub payments_json: Vec<String>,
}

// ── Tables ────────────────────────────────────────────────────────────────────

#[table(
    accessor = pos_session,
    public,
    index(accessor = session_by_organization, btree(columns = [organization_id])),
    index(accessor = session_by_user, btree(columns = [user_id])),
    index(accessor = session_by_config, btree(columns = [config_id]))
)]
pub struct PosSession {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
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

#[derive(Clone)]
#[table(
    accessor = pos_order,
    public,
    index(accessor = pos_order_by_session, btree(columns = [session_id])),
    index(accessor = pos_order_by_partner, btree(columns = [partner_id])),
    index(accessor = pos_order_by_org, btree(columns = [organization_id]))
)]
pub struct PosOrder {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// Direct org scope (cold-tier read plans and every other archive-candidate
    /// table assume this is a plain column, not derivable only via
    /// `session_id` → `PosSession.organization_id`).
    pub organization_id: u64,
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
    /// Cold-tier: when this row became archive-eligible (docs/plans/sliding-
    /// window-cold-tier.md §5). `PosOrder` is created directly in a terminal
    /// state (`Paid`) with no reducer ever mutating it afterward, so this is
    /// stamped at creation time — unlike resources with a separate
    /// "finalize the transaction" transition, there's no later event to wait
    /// for. `None` is reserved for a possible future non-terminal creation
    /// path (e.g. an unpaid/held order); no such path exists today.
    pub cold_eligible_at: Option<Timestamp>,
    /// Cold-tier: generation counter for the archived representation.
    /// Starts at 1 (matches `conventions::ARCHIVE_VERSION_INITIAL` in
    /// `api-server/src/cold_tier/conventions.rs` — this crate can't import
    /// that one, it's a native/wasm split, so the constant is duplicated
    /// here as a literal). No reducer increments it today because nothing
    /// mutates a `PosOrder` after creation; a future mutator would need to
    /// bump it, matching the version-checked finalize/rehydration protocol.
    pub archive_version: u64,
}

#[derive(Clone)]
#[table(
    accessor = pos_order_line,
    public,
    index(accessor = pos_line_by_organization, btree(columns = [organization_id])),
    index(accessor = pos_line_by_order, btree(columns = [order_id]))
)]
pub struct PosOrderLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
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

#[derive(Clone)]
#[table(
    accessor = pos_payment,
    public,
    index(accessor = payment_by_organization, btree(columns = [organization_id])),
    index(accessor = payment_by_session, btree(columns = [session_id]))
)]
pub struct PosPayment {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
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
    index(
        accessor = loyalty_card_by_org_code,
        btree(columns = [organization_id, code])
    )
)]
pub struct PosLoyaltyCard {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub organization_id: u64,
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
    organization_id: u64,
    partner_id: u64,
    points: f64,
    currency_id: u64,
) -> Result<Option<PosLoyaltyCard>, String> {
    let cards: Vec<_> = ctx
        .db
        .pos_loyalty_card()
        .iter()
        .filter(|c| {
            c.organization_id == organization_id
                && c.partner_id == Some(partner_id)
                && c.currency_id == currency_id
                && c.is_active
                && c.state == CardState::Active
        })
        .collect();

    if let Some(card) = cards.into_iter().next() {
        let new_points = card.points + points;
        let new_balance = new_points * 0.01;
        let card_id = card.id;
        ctx.db.pos_loyalty_card().id().update(PosLoyaltyCard {
            points: new_points,
            points_display: format!("{:.0} points", new_points),
            balance: new_balance,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..card
        });
        return Ok(ctx.db.pos_loyalty_card().id().find(&card_id));
    }

    Ok(None)
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
    if config.organization_id != organization_id {
        return Err("POS config does not belong to this organization".to_string());
    }

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
    let company_id = config.company_id;

    let session = ctx.db.pos_session().insert(PosSession {
        id: 0,
        organization_id: config.organization_id,
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

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "pos_session",
            record_id: session.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": session.name,
                    "config_id": config_id,
                    "cash_register_balance_start": cash_register_balance_start,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "state".to_string(),
                "cash_register_balance_start".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

/// Derived-field recompute only — no `write_audit_log_v2` (intentional gap).
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
    if session.organization_id != organization_id {
        return Err("Session does not belong to this organization".to_string());
    }

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
    if session.organization_id != organization_id {
        return Err("Session does not belong to this organization".to_string());
    }

    let config = ctx
        .db
        .pos_config()
        .id()
        .find(&session.config_id)
        .ok_or("POS config not found")?;
    if config.organization_id != session.organization_id
        || config.organization_id != organization_id
    {
        return Err("POS session and config do not belong to this organization".to_string());
    }

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

    let company_id = config.company_id;
    let old_state = format!("{:?}", refreshed_session.state);
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

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "pos_session",
            record_id: session_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": old_state }).to_string()),
            new_values: Some(
                serde_json::json!({
                    "state": "Closed",
                    "cash_register_balance_end_real": cash_register_balance_end_real,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "state".to_string(),
                "cash_register_balance_end_real".to_string(),
            ],
            metadata: None,
        },
    );

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
    if session.organization_id != organization_id {
        return Err("Session does not belong to this organization".to_string());
    }

    if session.state != SessionState::Opened {
        return Err("Session must be open to create orders".to_string());
    }

    let config = ctx
        .db
        .pos_config()
        .id()
        .find(&session.config_id)
        .ok_or("POS config not found")?;
    if config.organization_id != organization_id
        || config.organization_id != session.organization_id
    {
        return Err("POS session and config do not belong to this organization".to_string());
    }

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
            organization_id,
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
            organization_id,
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
        organization_id,
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
        cold_eligible_at: Some(ctx.timestamp),
        archive_version: 1,
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

    let updated_loyalty_card = if let Some(partner_id) = params.partner_id {
        if config.module_pos_loyalty {
            update_loyalty_points(
                ctx,
                organization_id,
                partner_id,
                loyalty_points,
                config.currency_id,
            )?
        } else {
            None
        }
    } else {
        None
    };

    // ── IoT hooks ─────────────────────────────────────────────────────────────
    // Push order total to any CustomerDisplay linked to this POS config
    // Initiate payment on any PaymentTerminal linked to this POS config
    let mut online_devices: Vec<_> = ctx
        .db
        .iot_device()
        .iter()
        .filter(|d| d.pos_config_id == Some(config.id) && d.status == "Online")
        .collect();
    online_devices.sort_by_key(|device| device.id);
    let mut queued_iot_action_ids = Vec::new();
    for device in online_devices {
        match device.device_type.as_str() {
            "CustomerDisplay" => {
                let display_payload = serde_json::json!({
                    "order_id": order.id,
                    "amount_total": amount_total,
                    "currency_id": config.currency_id,
                    "lines": params.lines.len(),
                })
                .to_string();
                let action_id = queue_action_internal(
                    ctx,
                    organization_id,
                    device.company_id,
                    device.id,
                    "DisplayMessage",
                    &display_payload,
                    "create_pos_order",
                );
                queued_iot_action_ids.push(action_id);
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
                    let action_id = queue_action_internal(
                        ctx,
                        organization_id,
                        device.company_id,
                        device.id,
                        "InitiatePayment",
                        &payment_payload,
                        "create_pos_order",
                    );
                    queued_iot_action_ids.push(action_id);
                }
            }
            "ReceiptPrinter" => {
                let receipt_payload =
                    serde_json::json!({ "order_id": order.id, "auto": true }).to_string();
                let action_id = queue_action_internal(
                    ctx,
                    organization_id,
                    device.company_id,
                    device.id,
                    "PrintReceipt",
                    &receipt_payload,
                    "create_pos_order",
                );
                queued_iot_action_ids.push(action_id);
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

    let committed_session = ctx
        .db
        .pos_session()
        .id()
        .find(&params.session_id)
        .ok_or("POS session disappeared before commit recording")?;
    let committed_order = ctx
        .db
        .pos_order()
        .id()
        .find(&order.id)
        .ok_or("POS order disappeared before commit recording")?;
    let mut committed_lines: Vec<_> = ctx
        .db
        .pos_order_line()
        .iter()
        .filter(|line| line.organization_id == organization_id && line.order_id == order.id)
        .collect();
    committed_lines.sort_by_key(|line| line.id);
    let mut committed_payments: Vec<_> = ctx
        .db
        .pos_payment()
        .iter()
        .filter(|payment| {
            payment.organization_id == organization_id && payment.order_id == order.id
        })
        .collect();
    committed_payments.sort_by_key(|payment| payment.id);
    let mut changes = vec![RowChange::upsert_stdb_row(
        "pos_session",
        serde_json::json!({"id": committed_session.id}),
        &committed_session,
    )?];
    changes.push(RowChange::upsert_stdb_row(
        "pos_order",
        serde_json::json!({"id": committed_order.id}),
        &committed_order,
    )?);
    for line in &committed_lines {
        changes.push(RowChange::upsert_stdb_row(
            "pos_order_line",
            serde_json::json!({"id": line.id}),
            line,
        )?);
    }
    for payment in &committed_payments {
        changes.push(RowChange::upsert_stdb_row(
            "pos_payment",
            serde_json::json!({"id": payment.id}),
            payment,
        )?);
    }
    if let Some(loyalty_card) = updated_loyalty_card {
        changes.push(RowChange::upsert_stdb_row(
            "pos_loyalty_card",
            serde_json::json!({"id": loyalty_card.id}),
            &loyalty_card,
        )?);
    }
    queued_iot_action_ids.sort_unstable();
    for action_id in queued_iot_action_ids {
        let action = ctx
            .db
            .iot_action()
            .id()
            .find(&action_id)
            .ok_or("IoT action disappeared before commit recording")?;
        changes.push(RowChange::upsert_stdb_row(
            "iot_action",
            serde_json::json!({"id": action.id}),
            &action,
        )?);
    }
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id,
            operation_id: "erp.create_pos_order".to_string(),
            correlation_id: format!("pos-session:{}:order:{}", params.session_id, order.id),
            changes,
        },
    )?;

    Ok(())
}

// ============================================================================
// COLD-TIER ARCHIVE FINALIZE
// ============================================================================
//
// Version-checked finalize, per the general (mutable-resource) protocol in
// docs/plans/sliding-window-cold-tier.md §6.1 — unlike audit_log's checksum-
// based finalize (audit_log is append-only with no archive_version/
// cold_eligible_at concept), this is the "real" protocol every future
// mutable archive candidate follows:
//
//   1. the C5 finalization service reads (id, archive_version,
//      cold_eligible_at, full payload);
//   2. it verifies the durable PG copy;
//   3. it calls this reducer with the values it read in step 1;
//   4. this reducer re-reads the row and deletes only if archive_version and
//      cold_eligible_at are BOTH still exactly what the worker saw — proving
//      no business mutation (or rehydration) happened in between.
//
// `PosOrder` has no reducer that mutates a row after `create_pos_order`
// today (confirmed by audit — see the Phase 2 planning notes), so in
// practice `archive_version` never changes and this rarely rejects. The
// check exists anyway because a future mutator could change that, and the
// finalize reducer must not silently stop protecting the row.

/// Internal: delete a `pos_order` row once the C5 finalization path has
/// durably verified the exact same version.
///
/// Called only by the registered C5 finalization identity (see
/// `core::cold_tier_identity`), never by frontend clients.
#[spacetimedb::reducer]
pub fn finalize_pos_order_archive(
    ctx: &ReducerContext,
    id: u64,
    expected_archive_version: u64,
    expected_cold_eligible_at_micros: i64,
    row_commit_sequence: u64,
    durable_watermark: u64,
    durable_change_schema_version: u32,
    durable_contract_version: String,
) -> Result<(), String> {
    let organization_id = ctx
        .db
        .pos_order()
        .id()
        .find(&id)
        .map(|order| order.organization_id)
        .ok_or("pos order was not found; refusing unscoped finalization")?;
    if !crate::core::cold_tier_identity::is_active_cold_tier_service_identity(
        ctx,
        organization_id,
        crate::core::cold_tier_identity::POS_ORDER_COLD_DRAINER_SERVICE,
    ) {
        return Err(
            "finalize_pos_order_archive: caller is not the registered C5 pos-order finalization identity"
                .to_string(),
        );
    }

    finalize_pos_order_archive_checked(
        ctx,
        id,
        expected_archive_version,
        expected_cold_eligible_at_micros,
        row_commit_sequence,
        durable_watermark,
        durable_change_schema_version,
        &durable_contract_version,
    )
}

/// The version-check/deletion logic, split out so tests can exercise it
/// directly — same reasoning as `audit::finalize_audit_log_archive_checked`:
/// a single reducer invocation can't fake `ctx.sender()` as the registered
/// finalization identity, so the identity gate is tested separately.
pub(crate) fn finalize_pos_order_archive_checked(
    ctx: &ReducerContext,
    id: u64,
    expected_archive_version: u64,
    expected_cold_eligible_at_micros: i64,
    row_commit_sequence: u64,
    durable_watermark: u64,
    durable_change_schema_version: u32,
    durable_contract_version: &str,
) -> Result<(), String> {
    let Some(row) = ctx.db.pos_order().id().find(id) else {
        // Already finalized by a prior/racing call.
        return Ok(());
    };

    if row.archive_version != expected_archive_version {
        return Err(format!(
            "pos_order {id}: archive_version changed (expected {expected_archive_version}, now {}); refusing to delete",
            row.archive_version
        ));
    }

    // Comparing the full Option (not just unwrapping) also covers "row
    // remains eligible": if a future rehydration path clears
    // cold_eligible_at back to None, this becomes `None != Some(expected)`
    // and fails closed, same as any other value drift.
    let actual = row.cold_eligible_at.map(|t| t.to_micros_since_unix_epoch());
    if actual != Some(expected_cold_eligible_at_micros) {
        return Err(format!(
            "pos_order {id}: cold_eligible_at changed or row is no longer eligible \
             (expected {expected_cold_eligible_at_micros}, now {actual:?}); refusing to delete"
        ));
    }

    let root_commit = prove_durable_row(
        ctx,
        row.organization_id,
        "pos_order",
        &serde_json::json!({"id": row.id}).to_string(),
        durable_watermark,
    )?;
    if root_commit.row_commit_sequence != row_commit_sequence
        || root_commit.change_schema_version != durable_change_schema_version
        || root_commit.contract_version != durable_contract_version
    {
        return Err(format!(
            "pos_order {id}: worker durability proof disagrees with the authoritative STDB commit"
        ));
    }

    let mut lines: Vec<_> = ctx
        .db
        .pos_order_line()
        .pos_line_by_order()
        .filter(id)
        .collect();
    lines.sort_by_key(|line| line.id);
    let mut payments: Vec<_> = ctx
        .db
        .pos_payment()
        .iter()
        .filter(|payment| payment.order_id == id)
        .collect();
    payments.sort_by_key(|payment| payment.id);

    let actual_line_ids = lines.iter().map(|line| line.id).collect::<Vec<_>>();
    let actual_payment_ids = payments
        .iter()
        .map(|payment| payment.id)
        .collect::<Vec<_>>();
    let aggregate_membership_matches = actual_line_ids == row.lines
        && actual_payment_ids == row.statement_ids
        && lines
            .iter()
            .all(|line| line.organization_id == row.organization_id)
        && payments.iter().all(|payment| {
            payment.organization_id == row.organization_id && payment.company_id == row.company_id
        });

    for line in &lines {
        prove_durable_row(
            ctx,
            row.organization_id,
            "pos_order_line",
            &serde_json::json!({"id": line.id}).to_string(),
            durable_watermark,
        )?;
    }
    for payment in &payments {
        prove_durable_row(
            ctx,
            row.organization_id,
            "pos_payment",
            &serde_json::json!({"id": payment.id}).to_string(),
            durable_watermark,
        )?;
    }

    let payments_terminal = payments.iter().all(|payment| {
        matches!(
            payment.payment_status,
            PaymentStatus::Done | PaymentStatus::Reversed | PaymentStatus::Cancelled
        )
    });
    let terminal_state = matches!(
        &row.state,
        PosOrderState::Paid
            | PosOrderState::Done
            | PosOrderState::Invoiced
            | PosOrderState::Cancelled
    );
    let is_cancelled = matches!(&row.state, PosOrderState::Cancelled);
    let open_obligation = !is_cancelled
        && (row.is_partially_paid
            || row.amount_paid + 0.000_001 < row.amount_total
            || !payments_terminal);
    let active_workflow = row.to_invoice && row.account_move.is_none();
    let facts = CoolingEligibilityFacts {
        resource_policy_allows_cooling: true,
        cold_eligible_at_micros: actual,
        now_micros: ctx.timestamp.to_micros_since_unix_epoch(),
        // `cold_eligible_at` is the reviewed eligibility instant, rather than
        // the transaction creation timestamp. The worker may retain an
        // eligible row longer, but it must never cool it before this instant.
        minimum_age_micros: 0,
        terminal_state,
        open_obligation,
        active_workflow,
        hot_dependency: !aggregate_membership_matches,
        projection_rebuildable: true,
    };
    let durable = root_commit.with_archive_version(row.archive_version, expected_archive_version);
    let mut children = Vec::with_capacity(lines.len() + payments.len());
    children.extend(lines.iter().map(|line| AggregateChildRef {
        table_name: "pos_order_line".to_string(),
        row_id: line.id,
        parent_id: id,
        organization_id: line.organization_id,
    }));
    children.extend(payments.iter().map(|payment| AggregateChildRef {
        table_name: "pos_payment".to_string(),
        row_id: payment.id,
        parent_id: id,
        organization_id: payment.organization_id,
    }));
    let plan = AggregateFinalizationPlan {
        root: AggregateRootRef {
            table_name: "pos_order".to_string(),
            row_id: id,
            organization_id: row.organization_id,
        },
        children,
    };
    finalize_cooling(&facts, &durable, &plan, |target| {
        match target.table_name.as_str() {
            "pos_order_line" => {
                ctx.db.pos_order_line().id().delete(&target.row_id);
                Ok(())
            }
            "pos_payment" => {
                ctx.db.pos_payment().id().delete(&target.row_id);
                Ok(())
            }
            "pos_order" => {
                ctx.db.pos_order().id().delete(&target.row_id);
                Ok(())
            }
            _ => Err("pos_order finalization plan contains an unsupported table".to_string()),
        }
    })
}

// ============================================================================
// COLD-TIER HYDRATION
// ============================================================================

/// Internal reducer used by the API-server after it has fetched a complete,
/// checksum-verified aggregate from the placement-resolved PG projection.
///
/// The service-identity check is essential: reducer arguments contain a
/// durable snapshot, but a snapshot is not an authorization grant.  The
/// reducer repeats every tenant, version, and membership check inside the
/// transaction and inserts the aggregate atomically before normal business
/// reducer logic is allowed to continue.
#[spacetimedb::reducer]
pub fn hydrate_pos_order_aggregate(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    placement_generation: u64,
    schema_version: u32,
    archive_version: u64,
    payload_checksum: String,
    order_json: String,
    lines_json: Vec<String>,
    payments_json: Vec<String>,
) -> Result<(), String> {
    if !crate::core::cold_tier_identity::is_active_cold_tier_service_identity(
        ctx,
        organization_id,
        crate::core::cold_tier_identity::POS_ORDER_HYDRATOR_SERVICE,
    ) {
        return Err(
            "hydrate_pos_order_aggregate: caller is not the registered pos-order hydrator identity"
                .to_string(),
        );
    }

    hydrate_pos_order_aggregate_checked(
        ctx,
        HydratePosOrderAggregateParams {
            organization_id,
            company_id,
            placement_generation,
            schema_version,
            archive_version,
            payload_checksum,
            order_json,
            lines_json,
            payments_json,
        },
    )
}

/// Transactional hydration logic split out for in-module reducer tests.
pub(crate) fn hydrate_pos_order_aggregate_checked(
    ctx: &ReducerContext,
    params: HydratePosOrderAggregateParams,
) -> Result<(), String> {
    if params.organization_id == 0 || params.company_id == 0 {
        return Err("hydration requires organization and company scope".to_string());
    }
    if params.placement_generation == 0 {
        return Err("hydration placement generation must be non-zero".to_string());
    }
    if params.schema_version != 1 {
        return Err(format!(
            "hydration schema version {} is unsupported",
            params.schema_version
        ));
    }
    if params.archive_version == 0 {
        return Err("hydration archive_version must be non-zero".to_string());
    }
    if params.payload_checksum.len() != 64
        || !params
            .payload_checksum
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("hydration payload_checksum must be a sha-256 hex digest".to_string());
    }

    let spacetimedb_sats::serde::SerdeWrapper(order) =
        serde_json::from_str::<spacetimedb_sats::serde::SerdeWrapper<PosOrder>>(&params.order_json)
            .map_err(|error| format!("invalid hydration order payload: {error}"))?;
    let lines: Vec<PosOrderLine> = params
        .lines_json
        .iter()
        .map(|json| -> Result<PosOrderLine, String> {
            let spacetimedb_sats::serde::SerdeWrapper(line) =
                serde_json::from_str::<spacetimedb_sats::serde::SerdeWrapper<PosOrderLine>>(json)
                    .map_err(|error| format!("invalid hydration order-line payload: {error}"))?;
            Ok(line)
        })
        .collect::<Result<_, _>>()?;
    let payments: Vec<PosPayment> = params
        .payments_json
        .iter()
        .map(|json| -> Result<PosPayment, String> {
            let spacetimedb_sats::serde::SerdeWrapper(payment) =
                serde_json::from_str::<spacetimedb_sats::serde::SerdeWrapper<PosPayment>>(json)
                    .map_err(|error| format!("invalid hydration payment payload: {error}"))?;
            Ok(payment)
        })
        .collect::<Result<_, _>>()?;

    if order.organization_id != params.organization_id || order.company_id != params.company_id {
        return Err("hydration order organization/company scope mismatch".to_string());
    }
    if order.archive_version != params.archive_version {
        return Err("hydration archive_version does not match order payload".to_string());
    }
    if order.cold_eligible_at.is_none() {
        return Err("hydration order is not an eligible cooled row".to_string());
    }

    let line_ids = order.lines.iter().copied().collect::<BTreeSet<_>>();
    if line_ids.len() != order.lines.len() || line_ids.len() != lines.len() {
        return Err("hydration order-line membership is incomplete or duplicated".to_string());
    }
    let payment_ids = order.statement_ids.iter().copied().collect::<BTreeSet<_>>();
    if payment_ids.len() != order.statement_ids.len() || payment_ids.len() != payments.len() {
        return Err("hydration payment membership is incomplete or duplicated".to_string());
    }
    for line in &lines {
        if !line_ids.contains(&line.id)
            || line.organization_id != params.organization_id
            || line.order_id != order.id
        {
            return Err(format!(
                "hydration line {} has the wrong organization, parent, or membership",
                line.id
            ));
        }
    }
    for payment in &payments {
        if !payment_ids.contains(&payment.id)
            || payment.organization_id != params.organization_id
            || payment.company_id != params.company_id
            || payment.order_id != order.id
        {
            return Err(format!(
                "hydration payment {} has the wrong organization, company, parent, or membership",
                payment.id
            ));
        }
    }

    // A retry after a successful transaction is a no-op only for the exact
    // same aggregate. A same-ID, different-tenant or different-version row
    // is a conflict and must never be overwritten by durable input.
    if let Some(existing) = ctx.db.pos_order().id().find(&order.id) {
        let mut existing_lines: Vec<_> = ctx
            .db
            .pos_order_line()
            .pos_line_by_order()
            .filter(&order.id)
            .collect();
        existing_lines.sort_by_key(|line| line.id);
        let mut existing_payments: Vec<_> = ctx
            .db
            .pos_payment()
            .iter()
            .filter(|payment| payment.order_id == order.id)
            .collect();
        existing_payments.sort_by_key(|payment| payment.id);
        let mut expected_lines = lines.clone();
        expected_lines.sort_by_key(|line| line.id);
        let mut expected_payments = payments.clone();
        expected_payments.sort_by_key(|payment| payment.id);
        let existing_line_json = existing_lines
            .iter()
            .map(sats_row_json)
            .collect::<Result<Vec<_>, _>>()?;
        let expected_line_json = expected_lines
            .iter()
            .map(sats_row_json)
            .collect::<Result<Vec<_>, _>>()?;
        let existing_payment_json = existing_payments
            .iter()
            .map(sats_row_json)
            .collect::<Result<Vec<_>, _>>()?;
        let expected_payment_json = expected_payments
            .iter()
            .map(sats_row_json)
            .collect::<Result<Vec<_>, _>>()?;
        if existing.organization_id != order.organization_id
            || existing.company_id != order.company_id
            || existing.archive_version != order.archive_version
            || existing.lines != order.lines
            || existing.statement_ids != order.statement_ids
            || sats_row_json(&existing)? != sats_row_json(&order)?
            || existing_lines.len() != expected_lines.len()
            || existing_payments.len() != expected_payments.len()
            || existing_line_json != expected_line_json
            || existing_payment_json != expected_payment_json
        {
            return Err(format!(
                "hydration target pos_order {} conflicts with an existing row",
                order.id
            ));
        }
        return Ok(());
    }

    for line in &lines {
        if ctx.db.pos_order_line().id().find(&line.id).is_some() {
            return Err(format!(
                "hydration target line {} already exists without its order",
                line.id
            ));
        }
    }
    for payment in &payments {
        if ctx.db.pos_payment().id().find(&payment.id).is_some() {
            return Err(format!(
                "hydration target payment {} already exists without its order",
                payment.id
            ));
        }
    }

    for line in &lines {
        ctx.db.pos_order_line().insert(line.clone());
    }
    for payment in &payments {
        ctx.db.pos_payment().insert(payment.clone());
    }
    ctx.db.pos_order().insert(order.clone());

    let mut changes = Vec::with_capacity(1 + lines.len() + payments.len());
    changes.push(RowChange::upsert_stdb_row(
        "pos_order",
        serde_json::json!({"id": order.id}),
        &order,
    )?);
    changes.extend(
        lines
            .iter()
            .map(|line| {
                RowChange::upsert_stdb_row(
                    "pos_order_line",
                    serde_json::json!({"id": line.id}),
                    line,
                )
            })
            .collect::<Result<Vec<_>, _>>()?,
    );
    changes.extend(
        payments
            .iter()
            .map(|payment| {
                RowChange::upsert_stdb_row(
                    "pos_payment",
                    serde_json::json!({"id": payment.id}),
                    payment,
                )
            })
            .collect::<Result<Vec<_>, _>>()?,
    );
    record_organization_commit(
        ctx,
        OrganizationCommitInput {
            organization_id: params.organization_id,
            operation_id: "erp.hydrate_pos_order_aggregate".to_string(),
            correlation_id: format!(
                "pos-order-hydration:{}:{}",
                order.id, params.archive_version
            ),
            changes,
        },
    )?;
    Ok(())
}

fn sats_row_json<T>(row: &T) -> Result<serde_json::Value, String>
where
    T: spacetimedb_sats::Serialize + ?Sized,
{
    serde_json::to_value(spacetimedb_sats::serde::SerdeWrapper::from_ref(row))
        .map_err(|error| format!("serialize hydration row: {error}"))
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
    check_permission(ctx, organization_id, "pos_loyalty_card", "create")?;

    let program = ctx
        .db
        .pos_loyalty_program()
        .id()
        .find(&program_id)
        .ok_or("Loyalty program not found")?;

    if program.organization_id != organization_id {
        return Err("Loyalty program does not belong to this organization".to_string());
    }

    let existing: Vec<_> = ctx
        .db
        .pos_loyalty_card()
        .iter()
        .filter(|c| c.organization_id == organization_id && c.code == code)
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

    let card = ctx.db.pos_loyalty_card().insert(PosLoyaltyCard {
        id: 0,
        organization_id,
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

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "pos_loyalty_card",
            record_id: card.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "code": card.code,
                    "program_id": program_id,
                    "points": points,
                })
                .to_string(),
            ),
            changed_fields: vec!["code".to_string(), "points".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
