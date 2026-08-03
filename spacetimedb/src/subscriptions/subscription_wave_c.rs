//! Wave C — amendments, proration, pause/resume, renew, cancel+credit, plan update.

use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::fiscal_periods::ensure_accounting_period_open_for_date;
use crate::accounting::journal_entries::{
    account_move, create_credit_note_from_invoice, insert_draft_account_move_line, AccountMove,
    CreateCreditNoteParams,
};
use crate::core::organization::company;
use crate::crm::contacts::contact;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::subscriptions::billing_helpers::{
    blank_line, calculate_next_date, normalize_payment_mode, normalize_plan_billing_period,
    normalize_rule_type, refresh_subscription_kpis, resolve_subscription_fx_rate,
};
use crate::subscriptions::tables::{
    subscription, subscription_line, subscription_plan, Subscription, SubscriptionLine,
    SubscriptionPlan,
};
use crate::types::{AccountMoveState, MoveType, PaymentState};

// ── Tables ───────────────────────────────────────────────────────────────────

/// Immutable amendment ledger (contract version history + proration audit).
#[derive(Clone)]
#[spacetimedb::table(
    accessor = subscription_amendment,
    public,
    index(accessor = subscription_amendment_by_org, btree(columns = [organization_id])),
    index(accessor = subscription_amendment_by_sub, btree(columns = [subscription_id]))
)]
pub struct SubscriptionAmendment {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub subscription_id: u64,
    /// Monotonic contract version after this amendment.
    pub version: u32,
    /// upgrade | downgrade | quantity | price | renew | pause | resume | cancel
    pub amendment_type: String,
    pub effective_date: Timestamp,
    pub line_id: Option<u64>,
    pub before_json: String,
    pub after_json: String,
    /// Signed: positive = charge customer, negative = credit.
    pub proration_amount: f64,
    pub proration_move_id: Option<u64>,
    pub credit_note_move_id: Option<u64>,
    pub notes: String,
    pub created_at: Timestamp,
    pub created_by: Identity,
    pub metadata: String,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct AmendSubscriptionParams {
    pub amendment_type: String,
    pub line_id: u64,
    pub effective_date: Option<Timestamp>,
    pub new_product_id: Option<u64>,
    pub new_quantity: Option<f64>,
    pub new_price_unit: Option<f64>,
    pub new_discount: Option<f64>,
    /// When true (default), create a draft AR/credit adjustment for the unused period fraction.
    pub prorate: bool,
    pub journal_id: Option<u64>,
    pub income_account_id: Option<u64>,
    pub receivable_account_id: Option<u64>,
    pub notes: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct PauseSubscriptionParams {
    pub notes: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ResumeSubscriptionParams {
    pub notes: Option<String>,
    /// Optional next invoice date override; defaults to current recurring_next_date.
    pub recurring_next_date: Option<Timestamp>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RenewSubscriptionParams {
    /// Number of billing intervals to extend the term / next date.
    pub intervals: u32,
    pub notes: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CancelSubscriptionParams {
    pub close_reason_id: Option<u64>,
    pub notes: Option<String>,
    /// When true and a posted invoice exists, create OutRefund credit note.
    pub create_credit_note: bool,
    /// Source invoice for credit; defaults to latest subscription invoice.
    pub invoice_move_id: Option<u64>,
    /// Mid-period unused credit as draft OutRefund adjustment (when no full credit note).
    pub prorate_unused: bool,
    pub journal_id: Option<u64>,
    pub income_account_id: Option<u64>,
    pub receivable_account_id: Option<u64>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn next_contract_version(ctx: &ReducerContext, subscription_id: u64) -> u32 {
    ctx.db
        .subscription_amendment()
        .subscription_amendment_by_sub()
        .filter(&subscription_id)
        .map(|a| a.version)
        .max()
        .unwrap_or(0)
        .saturating_add(1)
}

fn period_fraction_remaining(
    ctx: &ReducerContext,
    subscription: &Subscription,
    as_of: Timestamp,
) -> Result<f64, String> {
    let period_end = subscription.recurring_next_date;
    let period_start = {
        // Approximate prior boundary: next_date - one interval.
        let end_secs = period_end
            .to_duration_since_unix_epoch()
            .unwrap_or_default()
            .as_secs();
        let interval = subscription.recurring_interval.max(1) as u64;
        let canonical = normalize_rule_type(&subscription.recurring_rule_type)?;
        let period_secs = match canonical.as_str() {
            "daily" => interval * 24 * 60 * 60,
            "weekly" => interval * 7 * 24 * 60 * 60,
            "monthly" => interval * 30 * 24 * 60 * 60,
            "yearly" => interval * 365 * 24 * 60 * 60,
            _ => interval * 30 * 24 * 60 * 60,
        };
        Timestamp::from_duration_since_unix_epoch(std::time::Duration::from_secs(
            end_secs.saturating_sub(period_secs),
        ))
    };

    let start = period_start
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_secs() as f64;
    let end = period_end
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_secs() as f64;
    let now = as_of
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_secs() as f64;
    let total = (end - start).max(1.0);
    let remaining = (end - now).clamp(0.0, total);
    let _ = ctx; // reserved for calendar-aware periods later
    Ok(remaining / total)
}

fn line_period_total(line: &SubscriptionLine) -> f64 {
    let qty = if line.product_uom_qty > 0.0 {
        line.product_uom_qty
    } else {
        1.0
    };
    qty * line.price_unit * (1.0 - line.discount / 100.0)
}

fn create_proration_adjustment_move(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription: &Subscription,
    amount: f64,
    journal_id: u64,
    income_account_id: u64,
    receivable_account_id: u64,
    label: &str,
    created_by: Identity,
) -> Result<u64, String> {
    if amount.abs() < 0.000_1 {
        return Err("Proration amount is zero".to_string());
    }
    ensure_accounting_period_open_for_date(ctx, company_id, ctx.timestamp)?;

    let company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;
    let partner_display_name = ctx
        .db
        .contact()
        .id()
        .find(&subscription.partner_invoice_id)
        .map(|c| c.display_name.clone());

    let is_credit = amount < 0.0;
    let abs_amount = amount.abs();
    let move_type = if is_credit {
        MoveType::OutRefund
    } else {
        MoveType::OutInvoice
    };

    let move_record = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: String::new(),
        ref_: Some(format!("{}-PRORATE", subscription.code)),
        move_type,
        auto_post: false,
        state: AccountMoveState::Draft,
        date: ctx.timestamp,
        invoice_date: Some(ctx.timestamp),
        invoice_date_due: None,
        invoice_payment_term_id: None,
        invoice_origin: Some(format!("SUB{}-AMEND", subscription.id)),
        invoice_partner_display_name: partner_display_name.clone(),
        invoice_cash_rounding_id: None,
        payment_reference: None,
        partner_shipping_id: Some(subscription.partner_shipping_id),
        sale_order_id: subscription.sale_order_ids.first().copied(),
        partner_id: Some(subscription.partner_invoice_id),
        commercial_partner_id: Some(subscription.partner_invoice_id),
        partner_bank_id: None,
        fiscal_position_id: None,
        invoice_user_id: Some(created_by),
        invoice_incoterm_id: None,
        incoterm_location: None,
        campaign_id: None,
        source_id: None,
        medium_id: None,
        company_id,
        journal_id,
        currency_id: subscription.currency_id,
        company_currency_id: company.currency_id,
        amount_untaxed: abs_amount,
        amount_tax: 0.0,
        amount_total: abs_amount,
        amount_residual: abs_amount,
        amount_untaxed_signed: if is_credit { -abs_amount } else { abs_amount },
        amount_tax_signed: 0.0,
        amount_total_signed: if is_credit { -abs_amount } else { abs_amount },
        amount_total_in_currency_signed: if is_credit { -abs_amount } else { abs_amount },
        amount_residual_signed: if is_credit { -abs_amount } else { abs_amount },
        to_check: false,
        posted_before: false,
        is_storno: false,
        is_move_sent: false,
        secure_sequence_number: None,
        invoice_has_outstanding: false,
        payment_state: PaymentState::NotPaid,
        restrict_mode_hash_table: false,
        create_uid: Some(created_by),
        create_date: Some(ctx.timestamp),
        write_uid: Some(created_by),
        write_date: Some(ctx.timestamp),
        metadata: Some(
            serde_json::json!({
                "subscription_id": subscription.id,
                "proration": true,
                "label": label,
            })
            .to_string(),
        ),
    });

    // OutInvoice: Dr AR / Cr income. OutRefund: Dr income / Cr AR.
    if is_credit {
        let mut income = blank_line(income_account_id, label.to_string());
        income.debit = abs_amount;
        income.sequence = 0;
        income.partner_id = Some(subscription.partner_invoice_id);
        insert_draft_account_move_line(ctx, &move_record, income)?;

        let mut receivable = blank_line(
            receivable_account_id,
            partner_display_name.unwrap_or_else(|| "Accounts Receivable".into()),
        );
        receivable.credit = abs_amount;
        receivable.sequence = 1;
        receivable.partner_id = Some(subscription.partner_invoice_id);
        insert_draft_account_move_line(ctx, &move_record, receivable)?;
    } else {
        let mut income = blank_line(income_account_id, label.to_string());
        income.credit = abs_amount;
        income.sequence = 0;
        income.partner_id = Some(subscription.partner_invoice_id);
        insert_draft_account_move_line(ctx, &move_record, income)?;

        let mut receivable = blank_line(
            receivable_account_id,
            partner_display_name.unwrap_or_else(|| "Accounts Receivable".into()),
        );
        receivable.debit = abs_amount;
        receivable.sequence = 1;
        receivable.partner_id = Some(subscription.partner_invoice_id);
        insert_draft_account_move_line(ctx, &move_record, receivable)?;
    }

    Ok(move_record.id)
}

fn insert_amendment(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    amendment_type: &str,
    effective_date: Timestamp,
    line_id: Option<u64>,
    before_json: String,
    after_json: String,
    proration_amount: f64,
    proration_move_id: Option<u64>,
    credit_note_move_id: Option<u64>,
    notes: String,
    metadata: String,
) -> SubscriptionAmendment {
    let version = next_contract_version(ctx, subscription_id);
    ctx.db
        .subscription_amendment()
        .insert(SubscriptionAmendment {
            id: 0,
            organization_id,
            company_id,
            subscription_id,
            version,
            amendment_type: amendment_type.to_string(),
            effective_date,
            line_id,
            before_json,
            after_json,
            proration_amount,
            proration_move_id,
            credit_note_move_id,
            notes,
            created_at: ctx.timestamp,
            created_by: ctx.sender(),
            metadata,
        })
}

fn load_owned_subscription(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
) -> Result<Subscription, String> {
    let subscription = ctx
        .db
        .subscription()
        .id()
        .find(&subscription_id)
        .ok_or("Subscription not found")?;
    if subscription.organization_id != organization_id {
        return Err("Subscription does not belong to this organization".to_string());
    }
    if subscription.company_id != company_id {
        return Err("Subscription does not belong to this company".to_string());
    }
    Ok(subscription)
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Amend commercial terms on a subscription line (upgrade/downgrade/quantity/price).
#[spacetimedb::reducer]
pub fn amend_subscription(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: AmendSubscriptionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    check_permission(ctx, organization_id, "account_move", "create")?;

    let amendment_type = params.amendment_type.trim().to_ascii_lowercase();
    if !matches!(
        amendment_type.as_str(),
        "upgrade" | "downgrade" | "quantity" | "price"
    ) {
        return Err("amendment_type must be upgrade|downgrade|quantity|price".to_string());
    }

    let subscription = load_owned_subscription(ctx, organization_id, company_id, subscription_id)?;
    if subscription.state != "active" && subscription.state != "paused" {
        return Err("Only active or paused subscriptions can be amended".to_string());
    }

    let line = ctx
        .db
        .subscription_line()
        .id()
        .find(&params.line_id)
        .ok_or("Subscription line not found")?;
    if line.subscription_id != subscription_id || line.organization_id != organization_id {
        return Err("Line does not belong to this subscription".to_string());
    }
    if line.company_id != company_id {
        return Err("Line does not belong to this company".to_string());
    }
    if !line.line_is_recurring {
        return Err("Only recurring lines can be amended".to_string());
    }

    let before_total = line_period_total(&line);
    let before_json = serde_json::json!({
        "product_id": line.product_id,
        "product_uom_qty": line.product_uom_qty,
        "price_unit": line.price_unit,
        "discount": line.discount,
        "price_subtotal": line.price_subtotal,
        "line_is_upgrade": line.line_is_upgrade,
        "line_is_downgrade": line.line_is_downgrade,
    })
    .to_string();

    let new_product = params.new_product_id.unwrap_or(line.product_id);
    let new_qty = params.new_quantity.unwrap_or(line.product_uom_qty);
    let new_price = params.new_price_unit.unwrap_or(line.price_unit);
    let new_discount = params.new_discount.unwrap_or(line.discount);
    if new_qty <= 0.0 {
        return Err("new_quantity must be positive".to_string());
    }
    if new_price < 0.0 {
        return Err("new_price_unit cannot be negative".to_string());
    }

    let new_subtotal = new_qty * new_price * (1.0 - new_discount / 100.0);
    let effective = params.effective_date.unwrap_or(ctx.timestamp);

    let updated_line = SubscriptionLine {
        product_id: new_product,
        product_uom_qty: new_qty,
        price_unit: new_price,
        discount: new_discount,
        price_subtotal: new_subtotal,
        price_tax: 0.0,
        price_total: new_subtotal,
        line_is_upgrade: amendment_type == "upgrade" || line.line_is_upgrade,
        line_is_downgrade: amendment_type == "downgrade" || line.line_is_downgrade,
        line_is_prorated: params.prorate || line.line_is_prorated,
        updated_at: ctx.timestamp,
        ..line
    };
    ctx.db.subscription_line().id().update(updated_line.clone());

    let after_json = serde_json::json!({
        "product_id": new_product,
        "product_uom_qty": new_qty,
        "price_unit": new_price,
        "discount": new_discount,
        "price_subtotal": new_subtotal,
        "line_is_upgrade": updated_line.line_is_upgrade,
        "line_is_downgrade": updated_line.line_is_downgrade,
    })
    .to_string();

    let delta = new_subtotal - before_total;
    let fraction = if params.prorate && subscription.state == "active" {
        period_fraction_remaining(ctx, &subscription, effective)?
    } else {
        0.0
    };
    let proration_amount = delta * fraction;

    let mut proration_move_id = None;
    if params.prorate && proration_amount.abs() > 0.000_1 {
        let journal_id = params
            .journal_id
            .filter(|id| *id > 0)
            .ok_or("journal_id required when creating a proration adjustment")?;
        let income = params
            .income_account_id
            .filter(|id| *id > 0)
            .ok_or("income_account_id required when creating a proration adjustment")?;
        let ar = params
            .receivable_account_id
            .filter(|id| *id > 0)
            .ok_or("receivable_account_id required when creating a proration adjustment")?;
        let move_id = create_proration_adjustment_move(
            ctx,
            organization_id,
            company_id,
            &subscription,
            proration_amount,
            journal_id,
            income,
            ar,
            &format!("Proration {} line {}", amendment_type, params.line_id),
            ctx.sender(),
        )?;
        proration_move_id = Some(move_id);
        let mut invoice_ids = subscription.invoice_ids.clone();
        if !invoice_ids.contains(&move_id) {
            invoice_ids.push(move_id);
        }
        ctx.db.subscription().id().update(Subscription {
            invoice_ids,
            updated_at: ctx.timestamp,
            ..subscription.clone()
        });
    }

    let refreshed = ctx
        .db
        .subscription()
        .id()
        .find(&subscription_id)
        .ok_or("Subscription missing after amend")?;
    let company_row = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;
    let fx = resolve_subscription_fx_rate(
        ctx,
        organization_id,
        company_id,
        refreshed.currency_id,
        company_row.currency_id,
        ctx.timestamp,
    )
    .unwrap_or(1.0);
    refresh_subscription_kpis(ctx, refreshed, fx);

    let amendment = insert_amendment(
        ctx,
        organization_id,
        company_id,
        subscription_id,
        &amendment_type,
        effective,
        Some(params.line_id),
        before_json,
        after_json,
        proration_amount,
        proration_move_id,
        None,
        params.notes.clone().unwrap_or_default(),
        serde_json::json!({ "fraction_remaining": fraction, "delta_period": delta }).to_string(),
    );

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription_amendment",
            record_id: amendment.id,
            action: "CREATE",
            old_values: Some(amendment.before_json.clone()),
            new_values: Some(amendment.after_json.clone()),
            changed_fields: vec![
                "product_id".into(),
                "product_uom_qty".into(),
                "price_unit".into(),
                "discount".into(),
            ],
            metadata: Some(
                serde_json::json!({
                    "amendment_type": amendment_type,
                    "version": amendment.version,
                    "proration_amount": proration_amount,
                    "proration_move_id": proration_move_id,
                })
                .to_string(),
            ),
        },
    );

    log::info!(
        "Amended subscription {} type={} version={} proration={}",
        subscription_id,
        amendment_type,
        amendment.version,
        proration_amount
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn pause_subscription(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: PauseSubscriptionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let subscription = load_owned_subscription(ctx, organization_id, company_id, subscription_id)?;
    if subscription.state != "active" {
        return Err("Only active subscriptions can be paused".to_string());
    }
    let before =
        serde_json::json!({ "state": subscription.state, "is_active": subscription.is_active })
            .to_string();
    ctx.db.subscription().id().update(Subscription {
        state: "paused".to_string(),
        is_active: false,
        updated_at: ctx.timestamp,
        ..subscription
    });
    let after = serde_json::json!({ "state": "paused", "is_active": false }).to_string();
    let amendment = insert_amendment(
        ctx,
        organization_id,
        company_id,
        subscription_id,
        "pause",
        ctx.timestamp,
        None,
        before.clone(),
        after.clone(),
        0.0,
        None,
        None,
        params.notes.unwrap_or_default(),
        String::new(),
    );
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription",
            record_id: subscription_id,
            action: "UPDATE",
            old_values: Some(before),
            new_values: Some(after),
            changed_fields: vec!["state".into(), "is_active".into()],
            metadata: Some(
                serde_json::json!({ "amendment_id": amendment.id, "version": amendment.version })
                    .to_string(),
            ),
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn resume_subscription(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: ResumeSubscriptionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let subscription = load_owned_subscription(ctx, organization_id, company_id, subscription_id)?;
    if subscription.state != "paused" {
        return Err("Only paused subscriptions can be resumed".to_string());
    }
    let before =
        serde_json::json!({ "state": subscription.state, "is_active": subscription.is_active })
            .to_string();
    let next = params
        .recurring_next_date
        .unwrap_or(subscription.recurring_next_date);
    ctx.db.subscription().id().update(Subscription {
        state: "active".to_string(),
        is_active: true,
        recurring_next_date: next,
        updated_at: ctx.timestamp,
        ..subscription
    });
    let after = serde_json::json!({ "state": "active", "is_active": true }).to_string();
    let amendment = insert_amendment(
        ctx,
        organization_id,
        company_id,
        subscription_id,
        "resume",
        ctx.timestamp,
        None,
        before.clone(),
        after.clone(),
        0.0,
        None,
        None,
        params.notes.unwrap_or_default(),
        String::new(),
    );
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription",
            record_id: subscription_id,
            action: "UPDATE",
            old_values: Some(before),
            new_values: Some(after),
            changed_fields: vec![
                "state".into(),
                "is_active".into(),
                "recurring_next_date".into(),
            ],
            metadata: Some(
                serde_json::json!({ "amendment_id": amendment.id, "version": amendment.version })
                    .to_string(),
            ),
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn renew_subscription(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: RenewSubscriptionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let subscription = load_owned_subscription(ctx, organization_id, company_id, subscription_id)?;
    if subscription.state != "active" && subscription.state != "paused" {
        return Err("Only active or paused subscriptions can be renewed".to_string());
    }
    let intervals = params.intervals.max(1);
    let before = serde_json::json!({
        "recurring_next_date": subscription.recurring_next_date
            .to_duration_since_unix_epoch()
            .unwrap_or_default()
            .as_secs(),
    })
    .to_string();

    let mut next = subscription.recurring_next_date;
    for _ in 0..intervals {
        next = calculate_next_date(
            next,
            &subscription.recurring_rule_type,
            subscription.recurring_interval,
        )?;
    }

    ctx.db.subscription().id().update(Subscription {
        recurring_next_date: next,
        updated_at: ctx.timestamp,
        metadata: {
            let mut meta = serde_json::Map::new();
            if let Ok(existing) = serde_json::from_str::<serde_json::Value>(&subscription.metadata)
            {
                if let Some(obj) = existing.as_object() {
                    meta = obj.clone();
                }
            }
            meta.insert(
                "term_extended_intervals".into(),
                serde_json::json!(intervals),
            );
            meta.insert(
                "term_extended_at".into(),
                serde_json::json!(ctx
                    .timestamp
                    .to_duration_since_unix_epoch()
                    .unwrap_or_default()
                    .as_secs()),
            );
            serde_json::Value::Object(meta).to_string()
        },
        ..subscription
    });

    let after = serde_json::json!({
        "recurring_next_date": next
            .to_duration_since_unix_epoch()
            .unwrap_or_default()
            .as_secs(),
        "intervals": intervals,
    })
    .to_string();

    let amendment = insert_amendment(
        ctx,
        organization_id,
        company_id,
        subscription_id,
        "renew",
        ctx.timestamp,
        None,
        before.clone(),
        after.clone(),
        0.0,
        None,
        None,
        params.notes.unwrap_or_default(),
        String::new(),
    );
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription",
            record_id: subscription_id,
            action: "UPDATE",
            old_values: Some(before),
            new_values: Some(after),
            changed_fields: vec!["recurring_next_date".into()],
            metadata: Some(
                serde_json::json!({ "amendment_id": amendment.id, "version": amendment.version })
                    .to_string(),
            ),
        },
    );
    Ok(())
}

/// Cancel subscription: close + optional OutRefund credit note + entitlement revoke hook.
#[spacetimedb::reducer]
pub fn cancel_subscription(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: CancelSubscriptionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "delete")?;
    check_permission(ctx, organization_id, "account_move", "create")?;

    let subscription = load_owned_subscription(ctx, organization_id, company_id, subscription_id)?;
    if subscription.state == "closed" {
        return Err("Subscription is already closed".to_string());
    }

    let before = serde_json::json!({
        "state": subscription.state,
        "is_active": subscription.is_active,
        "invoice_ids": subscription.invoice_ids,
    })
    .to_string();

    let mut credit_note_move_id = None;
    if params.create_credit_note {
        let invoice_id = params
            .invoice_move_id
            .or_else(|| subscription.invoice_ids.last().copied())
            .ok_or("No invoice available for credit note; pass invoice_move_id or invoice first")?;
        let inv = ctx
            .db
            .account_move()
            .id()
            .find(&invoice_id)
            .ok_or("Invoice not found for credit note")?;
        if inv.state == AccountMoveState::Posted && inv.move_type == MoveType::OutInvoice {
            create_credit_note_from_invoice(
                ctx,
                organization_id,
                company_id,
                invoice_id,
                CreateCreditNoteParams {
                    line_ids: vec![],
                    reason: Some(
                        params
                            .notes
                            .clone()
                            .unwrap_or_else(|| "Subscription cancel".into()),
                    ),
                },
            )?;
            credit_note_move_id = ctx
                .db
                .account_move()
                .iter()
                .filter(|m| {
                    m.organization_id == organization_id
                        && m.move_type == MoveType::OutRefund
                        && m.metadata
                            .as_ref()
                            .map(|meta| {
                                meta.contains(&format!("\"reversed_entry_id\":{invoice_id}"))
                            })
                            .unwrap_or(false)
                })
                .map(|m| m.id)
                .max();
        } else if params.create_credit_note {
            return Err(
                "create_credit_note requires a posted OutInvoice on the subscription".to_string(),
            );
        }
    }

    let mut proration_move_id = None;
    let mut proration_amount = 0.0;
    if params.prorate_unused && subscription.state == "active" {
        let lines: Vec<_> = ctx
            .db
            .subscription_line()
            .subscription_line_by_subscription()
            .filter(&subscription_id)
            .filter(|l| l.line_is_recurring)
            .collect();
        let period_total: f64 = lines.iter().map(|l| line_period_total(l)).sum();
        let fraction = period_fraction_remaining(ctx, &subscription, ctx.timestamp)?;
        proration_amount = -(period_total * fraction);
        if proration_amount.abs() > 0.000_1 {
            let journal_id = params
                .journal_id
                .filter(|id| *id > 0)
                .ok_or("journal_id required for prorate_unused cancel")?;
            let income = params
                .income_account_id
                .filter(|id| *id > 0)
                .ok_or("income_account_id required for prorate_unused cancel")?;
            let ar = params
                .receivable_account_id
                .filter(|id| *id > 0)
                .ok_or("receivable_account_id required for prorate_unused cancel")?;
            let move_id = create_proration_adjustment_move(
                ctx,
                organization_id,
                company_id,
                &subscription,
                proration_amount,
                journal_id,
                income,
                ar,
                "Cancel unused period credit",
                ctx.sender(),
            )?;
            proration_move_id = Some(move_id);
        }
    }

    let mut meta = serde_json::Map::new();
    if let Ok(existing) = serde_json::from_str::<serde_json::Value>(&subscription.metadata) {
        if let Some(obj) = existing.as_object() {
            meta = obj.clone();
        }
    }
    // Entitlement revoke hook point for Wave E / external workers.
    let revoked = crate::subscriptions::subscription_wave_e::revoke_all_entitlements(
        ctx,
        organization_id,
        subscription_id,
    );
    meta.insert(
        "entitlement_revoke_pending".into(),
        serde_json::json!(false),
    );
    meta.insert("entitlements_revoked".into(), serde_json::json!(revoked));
    meta.insert(
        "entitlement_revoke_at".into(),
        serde_json::json!(ctx
            .timestamp
            .to_duration_since_unix_epoch()
            .unwrap_or_default()
            .as_secs()),
    );

    let mut invoice_ids = subscription.invoice_ids.clone();
    if let Some(mid) = proration_move_id {
        if !invoice_ids.contains(&mid) {
            invoice_ids.push(mid);
        }
    }
    if let Some(mid) = credit_note_move_id {
        if !invoice_ids.contains(&mid) {
            invoice_ids.push(mid);
        }
    }

    ctx.db.subscription().id().update(Subscription {
        state: "closed".to_string(),
        is_active: false,
        close_reason_id: params.close_reason_id,
        close_date: Some(ctx.timestamp),
        health: "churned".to_string(),
        invoice_ids,
        metadata: serde_json::Value::Object(meta).to_string(),
        updated_at: ctx.timestamp,
        ..subscription
    });

    let after = serde_json::json!({
        "state": "closed",
        "is_active": false,
        "credit_note_move_id": credit_note_move_id,
        "proration_move_id": proration_move_id,
        "entitlements_revoked": revoked,
    })
    .to_string();

    let amendment = insert_amendment(
        ctx,
        organization_id,
        company_id,
        subscription_id,
        "cancel",
        ctx.timestamp,
        None,
        before.clone(),
        after.clone(),
        proration_amount,
        proration_move_id,
        credit_note_move_id,
        params.notes.unwrap_or_default(),
        serde_json::json!({ "entitlements_revoked": revoked }).to_string(),
    );

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription",
            record_id: subscription_id,
            action: "UPDATE",
            old_values: Some(before),
            new_values: Some(after),
            changed_fields: vec![
                "state".into(),
                "is_active".into(),
                "close_date".into(),
                "health".into(),
            ],
            metadata: Some(
                serde_json::json!({
                    "amendment_id": amendment.id,
                    "version": amendment.version,
                    "credit_note_move_id": credit_note_move_id,
                })
                .to_string(),
            ),
        },
    );

    log::info!(
        "Cancelled subscription {} credit_note={:?} proration={}",
        subscription_id,
        credit_note_move_id,
        proration_amount
    );
    Ok(())
}

/// Update a subscription plan catalogue row.
#[spacetimedb::reducer]
pub fn update_subscription_plan(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    plan_id: u64,
    params: crate::subscriptions::reducers::UpdateSubscriptionPlanParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription_plan", "write")?;
    let plan = ctx
        .db
        .subscription_plan()
        .id()
        .find(&plan_id)
        .ok_or("Subscription plan not found")?;
    if plan.organization_id != organization_id {
        return Err("Plan does not belong to this organization".to_string());
    }
    if plan.company_id != company_id {
        return Err("Plan does not belong to this company".to_string());
    }

    let billing_period = if let Some(ref bp) = params.billing_period {
        Some(normalize_plan_billing_period(bp)?)
    } else {
        None
    };
    let payment_mode = if let Some(ref pm) = params.payment_mode {
        Some(normalize_payment_mode(pm)?)
    } else {
        None
    };

    let old_name = plan.name.clone();
    ctx.db.subscription_plan().id().update(SubscriptionPlan {
        name: params.name.unwrap_or(plan.name),
        description: params.description.unwrap_or(plan.description),
        code: params.code.unwrap_or(plan.code),
        currency_id: params.currency_id.unwrap_or(plan.currency_id),
        journal_id: params.journal_id.unwrap_or(plan.journal_id),
        product_id: params.product_id.unwrap_or(plan.product_id),
        billing_period: billing_period.unwrap_or(plan.billing_period),
        billing_period_unit: params
            .billing_period_unit
            .unwrap_or(plan.billing_period_unit),
        recurring_invoice_day: params
            .recurring_invoice_day
            .unwrap_or(plan.recurring_invoice_day),
        trial_period: params.trial_period.unwrap_or(plan.trial_period),
        trial_duration: params.trial_duration.unwrap_or(plan.trial_duration),
        trial_unit: params.trial_unit.unwrap_or(plan.trial_unit),
        auto_close_limit: params.auto_close_limit.unwrap_or(plan.auto_close_limit),
        payment_mode: payment_mode.unwrap_or(plan.payment_mode),
        template_id: params.template_id.unwrap_or(plan.template_id),
        invoice_mail_template_id: params
            .invoice_mail_template_id
            .unwrap_or(plan.invoice_mail_template_id),
        website_url: params.website_url.unwrap_or(plan.website_url),
        is_published: params.is_published.unwrap_or(plan.is_published),
        is_default: params.is_default.unwrap_or(plan.is_default),
        color: params.color.unwrap_or(plan.color),
        image_1920_url: params.image_1920_url.unwrap_or(plan.image_1920_url),
        metadata: params.metadata.unwrap_or(plan.metadata),
        updated_at: ctx.timestamp,
        ..plan
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription_plan",
            record_id: plan_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "name": old_name }).to_string()),
            new_values: None,
            changed_fields: vec!["updated_at".into()],
            metadata: None,
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn deactivate_subscription_plan(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    plan_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription_plan", "write")?;
    let plan = ctx
        .db
        .subscription_plan()
        .id()
        .find(&plan_id)
        .ok_or("Subscription plan not found")?;
    if plan.organization_id != organization_id {
        return Err("Plan does not belong to this organization".to_string());
    }
    if plan.company_id != company_id {
        return Err("Plan does not belong to this company".to_string());
    }
    if !plan.active {
        return Err("Plan is already inactive".to_string());
    }
    ctx.db.subscription_plan().id().update(SubscriptionPlan {
        active: false,
        is_published: false,
        updated_at: ctx.timestamp,
        ..plan
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription_plan",
            record_id: plan_id,
            action: "SET_ACTIVE",
            old_values: Some(serde_json::json!({ "active": true }).to_string()),
            new_values: Some(serde_json::json!({ "active": false }).to_string()),
            changed_fields: vec!["active".into(), "is_published".into()],
            metadata: None,
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn activate_subscription_plan(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    plan_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription_plan", "write")?;
    let plan = ctx
        .db
        .subscription_plan()
        .id()
        .find(&plan_id)
        .ok_or("Subscription plan not found")?;
    if plan.organization_id != organization_id {
        return Err("Plan does not belong to this organization".to_string());
    }
    if plan.company_id != company_id {
        return Err("Plan does not belong to this company".to_string());
    }
    ctx.db.subscription_plan().id().update(SubscriptionPlan {
        active: true,
        updated_at: ctx.timestamp,
        ..plan
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription_plan",
            record_id: plan_id,
            action: "SET_ACTIVE",
            old_values: Some(serde_json::json!({ "active": false }).to_string()),
            new_values: Some(serde_json::json!({ "active": true }).to_string()),
            changed_fields: vec!["active".into()],
            metadata: None,
        },
    );
    Ok(())
}
