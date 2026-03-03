//! Subscription & Advanced Billing reducers – SpacetimeDB Phase 9
//!
//! Core workflows:
//! - `create_subscription_plan` – create reusable pricing templates
//! - `create_subscription_from_sale_order` – convert confirmed SO to subscription
//! - `generate_subscription_invoice` – create next recurring invoice
//! - `close_subscription` – cancel/close a subscription
//! - `create_deferred_revenue_schedule` – set up revenue recognition
//! - `recognize_deferred_revenue` – post revenue recognition entry
//! - `create_revenue_recognition_rule` – configure auto-deferral rules

use spacetimedb::{ReducerContext, Table, Timestamp};

use crate::helpers::write_audit_log;
use crate::subscriptions::tables::*;

// ─────────────────────────────────────────────────────────────────────────────
// Subscription Plan Management
// ─────────────────────────────────────────────────────────────────────────────

/// Create a new subscription plan template.
#[spacetimedb::reducer]
pub fn create_subscription_plan(
    ctx: &ReducerContext,
    name: String,
    code: String,
    company_id: u64,
    currency_id: u64,
    journal_id: u64,
    product_id: u64,
    billing_period: String,
    billing_period_unit: u32,
    recurring_invoice_day: u8,
    trial_period: bool,
    trial_duration: u32,
    trial_unit: String,
    auto_close_limit: u32,
    payment_mode: String,
    metadata: Option<String>,
) -> Result<(), String> {
    // Validate required fields
    if name.is_empty() {
        return Err("Plan name is required".to_string());
    }
    if code.is_empty() {
        return Err("Plan code is required".to_string());
    }
    if !matches!(billing_period.as_str(), "day" | "week" | "month" | "year") {
        return Err("Invalid billing period. Use: day, week, month, year".to_string());
    }
    if !matches!(payment_mode.as_str(), "draft_invoice" | "automated_payment") {
        return Err("Invalid payment mode. Use: draft_invoice, automated_payment".to_string());
    }

    let plan = SubscriptionPlan {
        id: 0, // auto-inc
        name,
        description: String::new(),
        code,
        active: true,
        company_id,
        currency_id,
        journal_id,
        product_id,
        billing_period,
        billing_period_unit,
        recurring_invoice_day,
        trial_period,
        trial_duration,
        trial_unit,
        auto_close_limit,
        template_id: None,
        invoice_mail_template_id: None,
        user_id: Some(ctx.sender()),
        website_url: None,
        is_published: false,
        is_default: false,
        color: 0,
        image_1920_url: None,
        recurring_rule_count: 0,
        recurring_rule_min_unit: String::new(),
        recurring_rule_max_unit: String::new(),
        recurring_rule_min_count: 0,
        recurring_rule_max_count: 0,
        close_reason_id: None,
        payment_mode,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: metadata.unwrap_or_default(),
    };

    let inserted = ctx.db.subscription_plan().insert(plan);

    write_audit_log(
        ctx,
        0, // organization_id - would need to look up from company
        Some(company_id),
        "subscription_plan",
        inserted.id,
        "create",
        None,
        Some(format!("Created subscription plan: {}", inserted.name)),
        Vec::new(),
    );

    log::info!(
        "Created subscription plan {} (ID: {})",
        inserted.name,
        inserted.id
    );
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Subscription Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/// Convert a confirmed sale order into a subscription.
#[spacetimedb::reducer]
pub fn create_subscription_from_sale_order(
    ctx: &ReducerContext,
    sale_order_id: u64,
    plan_id: u64,
    date_start: Timestamp,
    recurring_invoice_day: u8,
    is_trial: bool,
) -> Result<(), String> {
    // TODO: Fetch sale order data and create subscription
    // This is a placeholder - would need to integrate with sales module

    let subscription = Subscription {
        id: 0, // auto-inc
        code: format!(
            "SUB/{}",
            ctx.timestamp
                .to_duration_since_unix_epoch()
                .unwrap_or_default()
                .as_secs()
        ),
        description: String::new(),
        plan_id,
        partner_id: 0, // Would come from sale order
        partner_invoice_id: 0,
        partner_shipping_id: 0,
        company_id: 0,
        currency_id: 0,
        pricelist_id: 0,
        analytic_account_id: None,
        date_start,
        date: ctx.timestamp,
        recurring_next_date: date_start,
        recurring_invoice_day,
        recurring_rule_type: "monthly".to_string(),
        recurring_interval: 1,
        close_reason_id: None,
        close_date: None,
        payment_token_id: None,
        payment_mode: "draft_invoice".to_string(),
        user_id: Some(ctx.sender()),
        team_id: None,
        health: "healthy".to_string(),
        stage_id: None,
        state: "draft".to_string(),
        is_active: true,
        is_trial,
        invoice_count: 0,
        vendor_id: None,
        recurring_total: 0.0,
        recurring_monthly: 0.0,
        recurring_mrr: 0.0,
        recurring_mrr_local: 0.0,
        percentage_mrr: 0.0,
        kpi_1month_mrr: 0.0,
        kpi_3months_mrr: 0.0,
        kpi_12months_mrr: 0.0,
        rating_last_value: 0,
        invoice_ids: Vec::new(),
        sale_order_ids: vec![sale_order_id],
        subscription_line_ids: Vec::new(),
        activity_ids: Vec::new(),
        message_follower_ids: Vec::new(),
        message_ids: Vec::new(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: String::new(),
    };

    let inserted = ctx.db.subscription().insert(subscription);

    write_audit_log(
        ctx,
        0,
        None,
        "subscription",
        inserted.id,
        "create",
        None,
        Some(format!(
            "Created subscription from sale order {}",
            sale_order_id
        )),
        Vec::new(),
    );

    log::info!(
        "Created subscription {} from sale order {}",
        inserted.id,
        sale_order_id
    );
    Ok(())
}

/// Activate a draft subscription.
#[spacetimedb::reducer]
pub fn activate_subscription(ctx: &ReducerContext, subscription_id: u64) -> Result<(), String> {
    let mut subscription = ctx
        .db
        .subscription()
        .id()
        .find(&subscription_id)
        .ok_or("Subscription not found")?;

    if subscription.state != "draft" {
        return Err("Subscription must be in draft state to activate".to_string());
    }

    subscription.state = "active".to_string();
    subscription.is_active = true;
    subscription.updated_at = ctx.timestamp;

    ctx.db.subscription().id().update(subscription.clone());

    write_audit_log(
        ctx,
        0,
        Some(subscription.company_id),
        "subscription",
        subscription_id,
        "activate",
        None,
        Some("Activated subscription".to_string()),
        vec!["state".to_string(), "is_active".to_string()],
    );

    log::info!("Activated subscription {}", subscription_id);
    Ok(())
}

/// Close/cancel a subscription.
#[spacetimedb::reducer]
pub fn close_subscription(
    ctx: &ReducerContext,
    subscription_id: u64,
    close_reason_id: Option<u64>,
    notes: Option<String>,
) -> Result<(), String> {
    let mut subscription = ctx
        .db
        .subscription()
        .id()
        .find(&subscription_id)
        .ok_or("Subscription not found")?;

    if subscription.state == "closed" {
        return Err("Subscription is already closed".to_string());
    }

    let old_state = subscription.state.clone();
    subscription.state = "closed".to_string();
    subscription.is_active = false;
    subscription.close_reason_id = close_reason_id;
    subscription.close_date = Some(ctx.timestamp);
    subscription.updated_at = ctx.timestamp;

    ctx.db.subscription().id().update(subscription.clone());

    write_audit_log(
        ctx,
        0,
        Some(subscription.company_id),
        "subscription",
        subscription_id,
        "close",
        Some(old_state),
        Some("closed".to_string()),
        vec!["state".to_string(), "is_active".to_string()],
    );

    log::info!("Closed subscription {}: {:?}", subscription_id, notes);
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Subscription Invoicing
// ─────────────────────────────────────────────────────────────────────────────

/// Generate the next invoice for a subscription.
#[spacetimedb::reducer]
pub fn generate_subscription_invoice(
    ctx: &ReducerContext,
    subscription_id: u64,
    invoice_date: Timestamp,
) -> Result<(), String> {
    let subscription = ctx
        .db
        .subscription()
        .id()
        .find(&subscription_id)
        .ok_or("Subscription not found")?;

    if subscription.state != "active" {
        return Err("Subscription must be active to generate invoice".to_string());
    }

    // TODO: Create actual invoice in accounting module
    // For now, just update the subscription with next billing date

    let mut updated = subscription.clone();
    updated.invoice_count += 1;
    updated.recurring_next_date = calculate_next_date(
        invoice_date,
        &subscription.recurring_rule_type,
        subscription.recurring_interval,
    )?;
    updated.updated_at = ctx.timestamp;

    ctx.db.subscription().id().update(updated);

    write_audit_log(
        ctx,
        0,
        Some(subscription.company_id),
        "subscription",
        subscription_id,
        "generate_invoice",
        None,
        Some(format!(
            "Generated invoice #{}",
            subscription.invoice_count + 1
        )),
        Vec::new(),
    );

    log::info!("Generated invoice for subscription {}", subscription_id);
    Ok(())
}

fn calculate_next_date(
    from_date: Timestamp,
    rule_type: &str,
    interval: u32,
) -> Result<Timestamp, String> {
    let duration_secs = match rule_type {
        "daily" => interval as u64 * 24 * 60 * 60,
        "weekly" => interval as u64 * 7 * 24 * 60 * 60,
        "monthly" => interval as u64 * 30 * 24 * 60 * 60, // Approximate
        "yearly" => interval as u64 * 365 * 24 * 60 * 60,
        _ => return Err(format!("Unknown rule type: {}", rule_type)),
    };

    let current_secs = from_date
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_secs();

    Ok(Timestamp::from_duration_since_unix_epoch(
        std::time::Duration::from_secs(current_secs + duration_secs),
    ))
}

// ─────────────────────────────────────────────────────────────────────────────
// Deferred Revenue Management
// ─────────────────────────────────────────────────────────────────────────────

/// Create a deferred revenue schedule for a subscription line.
#[spacetimedb::reducer]
pub fn create_deferred_revenue_schedule(
    ctx: &ReducerContext,
    description: String,
    journal_id: u64,
    account_id: u64,
    deferred_account_id: u64,
    company_id: u64,
    currency_id: u64,
    total_amount: f64,
    start_date: Timestamp,
    end_date: Timestamp,
    recognition_method: String,
    recognition_period: String,
    origin_move_id: Option<u64>,
    origin_move_line_id: Option<u64>,
    notes: String,
) -> Result<(), String> {
    if total_amount <= 0.0 {
        return Err("Total amount must be positive".to_string());
    }
    if !matches!(
        recognition_method.as_str(),
        "straight_line" | "one_time" | "monthly"
    ) {
        return Err("Invalid recognition method".to_string());
    }
    if !matches!(recognition_period.as_str(), "month" | "quarter" | "year") {
        return Err("Invalid recognition period".to_string());
    }

    let schedule = DeferredRevenueSchedule {
        id: 0, // auto-inc
        description,
        journal_id,
        account_id,
        deferred_account_id,
        company_id,
        currency_id,
        total_amount,
        recognized_amount: 0.0,
        deferred_amount: total_amount,
        start_date,
        end_date,
        recognition_method,
        recognition_period,
        state: "draft".to_string(),
        origin_move_id,
        origin_move_line_id,
        line_ids: Vec::new(),
        journal_entry_ids: Vec::new(),
        notes,
        created_at: ctx.timestamp,
        created_by: ctx.sender(),
        metadata: String::new(),
    };

    let inserted = ctx.db.deferred_revenue_schedule().insert(schedule);

    // Generate recognition lines
    generate_recognition_lines(ctx, inserted.id)?;

    write_audit_log(
        ctx,
        0,
        Some(company_id),
        "deferred_revenue_schedule",
        inserted.id,
        "create",
        None,
        Some(format!(
            "Created deferred revenue schedule for {}",
            total_amount
        )),
        Vec::new(),
    );

    log::info!(
        "Created deferred revenue schedule {} for amount {}",
        inserted.id,
        total_amount
    );
    Ok(())
}

/// Generate recognition lines for a deferred revenue schedule.
fn generate_recognition_lines(ctx: &ReducerContext, schedule_id: u64) -> Result<(), String> {
    let schedule = ctx
        .db
        .deferred_revenue_schedule()
        .id()
        .find(&schedule_id)
        .ok_or("Schedule not found")?;

    let (period_count, period_secs) = match schedule.recognition_period.as_str() {
        "month" => (12, 30 * 24 * 60 * 60),
        "quarter" => (4, 90 * 24 * 60 * 60),
        "year" => (1, 365 * 24 * 60 * 60),
        _ => return Err("Invalid recognition period".to_string()),
    };

    let amount_per_period = schedule.total_amount / period_count as f64;

    for i in 0..period_count {
        let recognition_date = schedule
            .start_date
            .to_duration_since_unix_epoch()
            .unwrap_or_default()
            .as_secs()
            + (i as u64 * period_secs);

        let line = DeferredRevenueLine {
            id: 0, // auto-inc
            schedule_id,
            sequence: i as u32 + 1,
            recognition_date: Timestamp::from_duration_since_unix_epoch(
                std::time::Duration::from_secs(recognition_date),
            ),
            amount: amount_per_period,
            recognized: false,
            move_id: None,
            move_line_id: None,
            journal_id: schedule.journal_id,
            account_id: schedule.account_id,
            deferred_account_id: schedule.deferred_account_id,
            company_id: schedule.company_id,
            currency_id: schedule.currency_id,
            notes: String::new(),
            created_at: ctx.timestamp,
            metadata: String::new(),
        };

        ctx.db.deferred_revenue_line().insert(line);
    }

    Ok(())
}

/// Post revenue recognition for a specific line.
#[spacetimedb::reducer]
pub fn recognize_deferred_revenue(
    ctx: &ReducerContext,
    line_id: u64,
    move_id: u64,
    move_line_id: u64,
) -> Result<(), String> {
    let mut line = ctx
        .db
        .deferred_revenue_line()
        .id()
        .find(&line_id)
        .ok_or("Revenue line not found")?;

    if line.recognized {
        return Err("Revenue already recognized for this line".to_string());
    }

    line.recognized = true;
    line.move_id = Some(move_id);
    line.move_line_id = Some(move_line_id);

    ctx.db.deferred_revenue_line().id().update(line.clone());

    // Update schedule totals
    let mut schedule = ctx
        .db
        .deferred_revenue_schedule()
        .id()
        .find(&line.schedule_id)
        .ok_or("Schedule not found")?;

    schedule.recognized_amount += line.amount;
    schedule.deferred_amount -= line.amount;

    if schedule.deferred_amount <= 0.0 {
        schedule.state = "finished".to_string();
    }

    ctx.db
        .deferred_revenue_schedule()
        .id()
        .update(schedule.clone());

    write_audit_log(
        ctx,
        0,
        Some(schedule.company_id),
        "deferred_revenue_line",
        line_id,
        "recognize",
        Some("false".to_string()),
        Some("true".to_string()),
        vec!["recognized".to_string()],
    );

    log::info!(
        "Recognized deferred revenue line {} for amount {}",
        line_id,
        line.amount
    );
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Revenue Recognition Rules
// ─────────────────────────────────────────────────────────────────────────────

/// Create a rule for automatic revenue recognition.
#[spacetimedb::reducer]
pub fn create_revenue_recognition_rule(
    ctx: &ReducerContext,
    description: String,
    product_category_ids: Vec<u64>,
    product_ids: Vec<u64>,
    recognition_method: String,
    recognition_period: String,
    recognition_account_id: u64,
    deferred_account_id: u64,
    expense_account_id: Option<u64>,
    company_id: u64,
    priority: u32,
    notes: String,
) -> Result<(), String> {
    let rule = RevenueRecognitionRule {
        id: 0, // auto-inc
        description,
        product_category_ids,
        product_ids,
        recognition_method,
        recognition_period,
        recognition_account_id,
        deferred_account_id,
        expense_account_id,
        company_id,
        is_active: true,
        priority,
        notes,
        created_at: ctx.timestamp,
        created_by: ctx.sender(),
        metadata: String::new(),
    };

    let inserted = ctx.db.revenue_recognition_rule().insert(rule);

    write_audit_log(
        ctx,
        0,
        Some(company_id),
        "revenue_recognition_rule",
        inserted.id,
        "create",
        None,
        Some(format!(
            "Created revenue recognition rule with priority {}",
            priority
        )),
        Vec::new(),
    );

    log::info!("Created revenue recognition rule {}", inserted.id);
    Ok(())
}

/// Deactivate a revenue recognition rule.
#[spacetimedb::reducer]
pub fn deactivate_revenue_recognition_rule(
    ctx: &ReducerContext,
    rule_id: u64,
) -> Result<(), String> {
    let mut rule = ctx
        .db
        .revenue_recognition_rule()
        .id()
        .find(&rule_id)
        .ok_or("Rule not found")?;

    rule.is_active = false;

    ctx.db.revenue_recognition_rule().id().update(rule.clone());

    write_audit_log(
        ctx,
        0,
        Some(rule.company_id),
        "revenue_recognition_rule",
        rule_id,
        "deactivate",
        Some("true".to_string()),
        Some("false".to_string()),
        vec!["is_active".to_string()],
    );

    log::info!("Deactivated revenue recognition rule {}", rule_id);
    Ok(())
}
