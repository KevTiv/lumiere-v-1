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

use spacetimedb::{ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::subscriptions::tables::*;

// ============================================================================
// INPUT PARAMS
// ============================================================================

/// Params for creating a subscription plan.
/// Scope: `company_id` is a flat reducer param.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateSubscriptionPlanParams {
    pub name: String,
    pub code: String,
    pub description: Option<String>,
    pub currency_id: u64,
    pub journal_id: u64,
    pub product_id: u64,
    pub billing_period: String,
    pub billing_period_unit: u32,
    pub recurring_invoice_day: u8,
    pub trial_period: bool,
    pub trial_duration: u32,
    pub trial_unit: String,
    pub auto_close_limit: u32,
    pub payment_mode: String,
    pub template_id: Option<u64>,
    pub invoice_mail_template_id: Option<u64>,
    pub website_url: Option<String>,
    pub is_published: bool,
    pub is_default: bool,
    pub color: u32,
    pub image_1920_url: Option<String>,
    pub active: bool,
    pub recurring_rule_count: u32,
    pub recurring_rule_min_unit: String,
    pub recurring_rule_max_unit: String,
    pub recurring_rule_min_count: u32,
    pub recurring_rule_max_count: u32,
    pub metadata: Option<String>,
}

/// Params for creating a subscription from sale order.
/// Scope: `company_id` is a flat reducer param.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateSubscriptionFromSaleOrderParams {
    pub sale_order_id: u64,
    pub code: Option<String>,
    pub plan_id: u64,
    pub date_start: Timestamp,
    pub recurring_invoice_day: u8,
    pub is_trial: bool,
    pub description: Option<String>,
    pub recurring_rule_type: String,
    pub recurring_interval: u32,
    pub payment_mode: String,
    pub partner_id: u64,
    pub vendor_id: Option<u64>,
    pub partner_invoice_id: u64,
    pub partner_shipping_id: u64,
    pub currency_id: u64,
    pub pricelist_id: u64,
    pub analytic_account_id: Option<u64>,
    pub team_id: Option<u64>,
    pub health: String,
    pub stage_id: Option<u64>,
    pub state: String,
    pub is_active: bool,
    pub invoice_count: u32,
    pub recurring_total: f64,
    pub recurring_monthly: f64,
    pub recurring_mrr: f64,
    pub recurring_mrr_local: f64,
    pub percentage_mrr: f64,
    pub kpi_1month_mrr: f64,
    pub kpi_3months_mrr: f64,
    pub kpi_12months_mrr: f64,
    pub rating_last_value: u8,
    pub invoice_ids: Vec<u64>,
    pub subscription_line_ids: Vec<u64>,
    pub activity_ids: Vec<u64>,
    pub message_follower_ids: Vec<u64>,
    pub message_ids: Vec<u64>,
    pub metadata: Option<String>,
}

/// Params for closing a subscription.
/// Scope: `company_id` and `subscription_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CloseSubscriptionParams {
    pub close_reason_id: Option<u64>,
    pub notes: Option<String>,
}

/// Params for generating subscription invoice.
/// Scope: `company_id` and `subscription_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct GenerateSubscriptionInvoiceParams {
    pub invoice_date: Timestamp,
}

/// Params for creating deferred revenue schedule.
/// Scope: `company_id` is a flat reducer param.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateDeferredRevenueScheduleParams {
    pub description: String,
    pub journal_id: u64,
    pub account_id: u64,
    pub deferred_account_id: u64,
    pub currency_id: u64,
    pub total_amount: f64,
    pub recognized_amount: f64,
    pub deferred_amount: f64,
    pub start_date: Timestamp,
    pub end_date: Timestamp,
    pub recognition_method: String,
    pub recognition_period: String,
    pub state: String,
    pub origin_move_id: Option<u64>,
    pub origin_move_line_id: Option<u64>,
    pub line_ids: Vec<u64>,
    pub journal_entry_ids: Vec<u64>,
    pub notes: String,
    pub metadata: Option<String>,
}

/// Params for recognizing deferred revenue.
/// Scope: `company_id` and `line_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct RecognizeDeferredRevenueParams {
    pub move_id: u64,
    pub move_line_id: u64,
}

/// Params for creating revenue recognition rule.
/// Scope: `company_id` is a flat reducer param.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateRevenueRecognitionRuleParams {
    pub description: String,
    pub product_category_ids: Vec<u64>,
    pub product_ids: Vec<u64>,
    pub recognition_method: String,
    pub recognition_period: String,
    pub recognition_account_id: u64,
    pub deferred_account_id: u64,
    pub expense_account_id: Option<u64>,
    pub priority: u32,
    pub notes: String,
    pub is_active: bool,
    pub metadata: Option<String>,
}

// ── Update Params ─────────────────────────────────────────────────────────────

/// Params for updating a subscription plan.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateSubscriptionPlanParams {
    pub name: Option<String>,
    pub description: Option<String>,
    pub code: Option<String>,
    pub currency_id: Option<u64>,
    pub journal_id: Option<u64>,
    pub product_id: Option<u64>,
    pub billing_period: Option<String>,
    pub billing_period_unit: Option<u32>,
    pub recurring_invoice_day: Option<u8>,
    pub trial_period: Option<bool>,
    pub trial_duration: Option<u32>,
    pub trial_unit: Option<String>,
    pub auto_close_limit: Option<u32>,
    pub payment_mode: Option<String>,
    pub template_id: Option<Option<u64>>,
    pub invoice_mail_template_id: Option<Option<u64>>,
    pub website_url: Option<Option<String>>,
    pub is_published: Option<bool>,
    pub is_default: Option<bool>,
    pub color: Option<u32>,
    pub image_1920_url: Option<Option<String>>,
    pub metadata: Option<String>,
}

/// Params for updating a subscription.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateSubscriptionParams {
    pub description: Option<String>,
    pub plan_id: Option<u64>,
    pub partner_id: Option<u64>,
    pub partner_invoice_id: Option<u64>,
    pub partner_shipping_id: Option<u64>,
    pub currency_id: Option<u64>,
    pub pricelist_id: Option<u64>,
    pub analytic_account_id: Option<Option<u64>>,
    pub recurring_invoice_day: Option<u8>,
    pub recurring_rule_type: Option<String>,
    pub recurring_interval: Option<u32>,
    pub payment_token_id: Option<Option<u64>>,
    pub payment_mode: Option<String>,
    pub team_id: Option<Option<u64>>,
    pub health: Option<String>,
    pub stage_id: Option<Option<u64>>,
    pub state: Option<String>,
    pub is_active: Option<bool>,
    pub is_trial: Option<bool>,
    pub metadata: Option<String>,
}

/// Params for updating a deferred revenue schedule.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateDeferredRevenueScheduleParams {
    pub description: Option<String>,
    pub journal_id: Option<u64>,
    pub account_id: Option<u64>,
    pub deferred_account_id: Option<u64>,
    pub currency_id: Option<u64>,
    pub total_amount: Option<f64>,
    pub start_date: Option<Timestamp>,
    pub end_date: Option<Timestamp>,
    pub recognition_method: Option<String>,
    pub recognition_period: Option<String>,
    pub state: Option<String>,
    pub notes: Option<String>,
    pub metadata: Option<String>,
}

/// Params for updating a revenue recognition rule.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateRevenueRecognitionRuleParams {
    pub description: Option<String>,
    pub product_category_ids: Option<Vec<u64>>,
    pub product_ids: Option<Vec<u64>>,
    pub recognition_method: Option<String>,
    pub recognition_period: Option<String>,
    pub recognition_account_id: Option<u64>,
    pub deferred_account_id: Option<u64>,
    pub expense_account_id: Option<Option<u64>>,
    pub is_active: Option<bool>,
    pub priority: Option<u32>,
    pub notes: Option<String>,
    pub metadata: Option<String>,
}

// ============================================================================
// REDUCERS - Subscription Plan Management
// ============================================================================

/// Create a new subscription plan template.
#[spacetimedb::reducer]
pub fn create_subscription_plan(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateSubscriptionPlanParams,
) -> Result<(), String> {
    check_permission(ctx, company_id, "subscription_plan", "create")?;

    // Validate required fields
    if params.name.is_empty() {
        return Err("Plan name is required".to_string());
    }
    if params.code.is_empty() {
        return Err("Plan code is required".to_string());
    }
    if !matches!(
        params.billing_period.as_str(),
        "day" | "week" | "month" | "year"
    ) {
        return Err("Invalid billing period. Use: day, week, month, year".to_string());
    }
    if !matches!(
        params.payment_mode.as_str(),
        "draft_invoice" | "automated_payment"
    ) {
        return Err("Invalid payment mode. Use: draft_invoice, automated_payment".to_string());
    }

    let plan = SubscriptionPlan {
        id: 0,
        name: params.name.clone(),
        description: params.description.clone().unwrap_or_default(),
        code: params.code.clone(),
        active: params.active,
        company_id,
        currency_id: params.currency_id,
        journal_id: params.journal_id,
        product_id: params.product_id,
        billing_period: params.billing_period.clone(),
        billing_period_unit: params.billing_period_unit,
        recurring_invoice_day: params.recurring_invoice_day,
        trial_period: params.trial_period,
        trial_duration: params.trial_duration,
        trial_unit: params.trial_unit.clone(),
        auto_close_limit: params.auto_close_limit,
        template_id: params.template_id,
        invoice_mail_template_id: params.invoice_mail_template_id,
        user_id: Some(ctx.sender()),
        website_url: params.website_url.clone(),
        is_published: params.is_published,
        is_default: params.is_default,
        color: params.color,
        image_1920_url: params.image_1920_url.clone(),
        recurring_rule_count: params.recurring_rule_count,
        recurring_rule_min_unit: params.recurring_rule_min_unit.clone(),
        recurring_rule_max_unit: params.recurring_rule_max_unit.clone(),
        recurring_rule_min_count: params.recurring_rule_min_count,
        recurring_rule_max_count: params.recurring_rule_max_count,
        close_reason_id: None,
        payment_mode: params.payment_mode.clone(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: params.metadata.clone().unwrap_or_default(),
    };

    let inserted = ctx.db.subscription_plan().insert(plan);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription_plan",
            record_id: inserted.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "name": params.name,
                    "code": params.code,
                    "active": params.active
                })
                .to_string(),
            ),
            changed_fields: vec![
                "name".to_string(),
                "code".to_string(),
                "description".to_string(),
                "active".to_string(),
            ],
            metadata: None,
        },
    );

    log::info!(
        "Created subscription plan {} (ID: {})",
        inserted.name,
        inserted.id
    );
    Ok(())
}

// ============================================================================
// REDUCERS - Subscription Lifecycle
// ============================================================================

/// Convert a confirmed sale order into a subscription.
#[spacetimedb::reducer]
pub fn create_subscription_from_sale_order(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateSubscriptionFromSaleOrderParams,
) -> Result<(), String> {
    check_permission(ctx, company_id, "subscription", "create")?;

    // TODO: Fetch sale order data and create subscription
    // This is a placeholder - would need to integrate with sales module

    let code = params.code.clone().unwrap_or_else(|| {
        format!(
            "SUB/{}",
            ctx.timestamp
                .to_duration_since_unix_epoch()
                .unwrap_or_default()
                .as_secs()
        )
    });

    let subscription = Subscription {
        id: 0,
        code,
        description: params.description.clone().unwrap_or_default(),
        plan_id: params.plan_id,
        partner_id: params.partner_id,
        partner_invoice_id: params.partner_invoice_id,
        partner_shipping_id: params.partner_shipping_id,
        company_id,
        currency_id: params.currency_id,
        pricelist_id: params.pricelist_id,
        analytic_account_id: params.analytic_account_id,
        date_start: params.date_start,
        date: ctx.timestamp,
        recurring_next_date: params.date_start,
        recurring_invoice_day: params.recurring_invoice_day,
        recurring_rule_type: params.recurring_rule_type.clone(),
        recurring_interval: params.recurring_interval,
        close_reason_id: None,
        close_date: None,
        payment_token_id: None,
        payment_mode: params.payment_mode.clone(),
        user_id: Some(ctx.sender()),
        team_id: params.team_id,
        health: params.health.clone(),
        stage_id: params.stage_id,
        state: params.state.clone(),
        is_active: params.is_active,
        is_trial: params.is_trial,
        invoice_count: params.invoice_count,
        vendor_id: params.vendor_id,
        recurring_total: params.recurring_total,
        recurring_monthly: params.recurring_monthly,
        recurring_mrr: params.recurring_mrr,
        recurring_mrr_local: params.recurring_mrr_local,
        percentage_mrr: params.percentage_mrr,
        kpi_1month_mrr: params.kpi_1month_mrr,
        kpi_3months_mrr: params.kpi_3months_mrr,
        kpi_12months_mrr: params.kpi_12months_mrr,
        rating_last_value: params.rating_last_value,
        invoice_ids: params.invoice_ids.clone(),
        sale_order_ids: vec![params.sale_order_id],
        subscription_line_ids: params.subscription_line_ids.clone(),
        activity_ids: params.activity_ids.clone(),
        message_follower_ids: params.message_follower_ids.clone(),
        message_ids: params.message_ids.clone(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: params.metadata.clone().unwrap_or_default(),
    };

    let inserted = ctx.db.subscription().insert(subscription);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription",
            record_id: inserted.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "code": inserted.code,
                    "sale_order_id": params.sale_order_id,
                    "partner_id": params.partner_id,
                    "state": params.state
                })
                .to_string(),
            ),
            changed_fields: vec![
                "code".to_string(),
                "sale_order_id".to_string(),
                "partner_id".to_string(),
                "state".to_string(),
                "is_active".to_string(),
            ],
            metadata: None,
        },
    );

    log::info!(
        "Created subscription {} from sale order {}",
        inserted.id,
        params.sale_order_id
    );
    Ok(())
}

/// Activate a draft subscription.
#[spacetimedb::reducer]
pub fn activate_subscription(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "subscription", "write")?;

    let subscription = ctx
        .db
        .subscription()
        .id()
        .find(&subscription_id)
        .ok_or("Subscription not found")?;

    if subscription.company_id != company_id {
        return Err("Subscription does not belong to this company".to_string());
    }

    if subscription.state != "draft" {
        return Err("Subscription must be in draft state to activate".to_string());
    }

    ctx.db.subscription().id().update(Subscription {
        state: "active".to_string(),
        is_active: true,
        updated_at: ctx.timestamp,
        ..subscription
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription",
            record_id: subscription_id,
            action: "UPDATE",
            old_values: Some("{\"state\":\"draft\",\"is_active\":false}".to_string()),
            new_values: Some("{\"state\":\"active\",\"is_active\":true}".to_string()),
            changed_fields: vec!["state".to_string(), "is_active".to_string()],
            metadata: None,
        },
    );

    log::info!("Activated subscription {}", subscription_id);
    Ok(())
}

/// Close/cancel a subscription.
#[spacetimedb::reducer]
pub fn close_subscription(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: CloseSubscriptionParams,
) -> Result<(), String> {
    check_permission(ctx, company_id, "subscription", "delete")?;

    let subscription = ctx
        .db
        .subscription()
        .id()
        .find(&subscription_id)
        .ok_or("Subscription not found")?;

    if subscription.company_id != company_id {
        return Err("Subscription does not belong to this company".to_string());
    }

    if subscription.state == "closed" {
        return Err("Subscription is already closed".to_string());
    }

    let old_state = subscription.state.clone();

    ctx.db.subscription().id().update(Subscription {
        state: "closed".to_string(),
        is_active: false,
        close_reason_id: params.close_reason_id,
        close_date: Some(ctx.timestamp),
        updated_at: ctx.timestamp,
        ..subscription
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription",
            record_id: subscription_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "state": old_state }).to_string()),
            new_values: Some(
                serde_json::json!({ "state": "closed", "is_active": false }).to_string(),
            ),
            changed_fields: vec![
                "state".to_string(),
                "is_active".to_string(),
                "close_date".to_string(),
            ],
            metadata: params
                .notes
                .map(|n| serde_json::json!({ "notes": n }).to_string()),
        },
    );

    log::info!("Closed subscription {}", subscription_id);
    Ok(())
}

// ============================================================================
// REDUCERS - Subscription Invoicing
// ============================================================================

/// Generate the next invoice for a subscription.
#[spacetimedb::reducer]
pub fn generate_subscription_invoice(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: GenerateSubscriptionInvoiceParams,
) -> Result<(), String> {
    check_permission(ctx, company_id, "subscription", "write")?;

    let subscription = ctx
        .db
        .subscription()
        .id()
        .find(&subscription_id)
        .ok_or("Subscription not found")?;

    if subscription.company_id != company_id {
        return Err("Subscription does not belong to this company".to_string());
    }

    if subscription.state != "active" {
        return Err("Subscription must be active to generate invoice".to_string());
    }

    // TODO: Create actual invoice in accounting module
    // For now, just update the subscription with next billing date

    let new_invoice_count = subscription.invoice_count + 1;
    let new_next_date = calculate_next_date(
        params.invoice_date,
        &subscription.recurring_rule_type,
        subscription.recurring_interval,
    )?;

    ctx.db.subscription().id().update(Subscription {
        invoice_count: new_invoice_count,
        recurring_next_date: new_next_date,
        updated_at: ctx.timestamp,
        ..subscription
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription",
            record_id: subscription_id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({ "invoice_count": subscription.invoice_count }).to_string(),
            ),
            new_values: Some(serde_json::json!({ "invoice_count": new_invoice_count }).to_string()),
            changed_fields: vec![
                "invoice_count".to_string(),
                "recurring_next_date".to_string(),
            ],
            metadata: None,
        },
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

// ============================================================================
// REDUCERS - Deferred Revenue Management
// ============================================================================

/// Create a deferred revenue schedule for a subscription line.
#[spacetimedb::reducer]
pub fn create_deferred_revenue_schedule(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateDeferredRevenueScheduleParams,
) -> Result<(), String> {
    check_permission(ctx, company_id, "deferred_revenue_schedule", "create")?;

    if params.total_amount <= 0.0 {
        return Err("Total amount must be positive".to_string());
    }
    if !matches!(
        params.recognition_method.as_str(),
        "straight_line" | "one_time" | "monthly"
    ) {
        return Err("Invalid recognition method".to_string());
    }
    if !matches!(
        params.recognition_period.as_str(),
        "month" | "quarter" | "year"
    ) {
        return Err("Invalid recognition period".to_string());
    }

    let schedule = DeferredRevenueSchedule {
        id: 0,
        description: params.description.clone(),
        journal_id: params.journal_id,
        account_id: params.account_id,
        deferred_account_id: params.deferred_account_id,
        company_id,
        currency_id: params.currency_id,
        total_amount: params.total_amount,
        recognized_amount: params.recognized_amount,
        deferred_amount: params.deferred_amount,
        start_date: params.start_date,
        end_date: params.end_date,
        recognition_method: params.recognition_method.clone(),
        recognition_period: params.recognition_period.clone(),
        state: params.state.clone(),
        origin_move_id: params.origin_move_id,
        origin_move_line_id: params.origin_move_line_id,
        line_ids: params.line_ids.clone(),
        journal_entry_ids: params.journal_entry_ids.clone(),
        notes: params.notes.clone(),
        created_at: ctx.timestamp,
        created_by: ctx.sender(),
        metadata: params.metadata.clone().unwrap_or_default(),
    };

    let inserted = ctx.db.deferred_revenue_schedule().insert(schedule);

    // Generate recognition lines
    generate_recognition_lines(
        ctx,
        inserted.id,
        &params.notes,
        params.metadata.as_deref().unwrap_or(""),
    )?;

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "deferred_revenue_schedule",
            record_id: inserted.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "description": params.description,
                    "total_amount": params.total_amount,
                    "state": params.state
                })
                .to_string(),
            ),
            changed_fields: vec![
                "description".to_string(),
                "total_amount".to_string(),
                "state".to_string(),
            ],
            metadata: None,
        },
    );

    log::info!(
        "Created deferred revenue schedule {} for amount {}",
        inserted.id,
        params.total_amount
    );
    Ok(())
}

/// Generate recognition lines for a deferred revenue schedule.
fn generate_recognition_lines(
    ctx: &ReducerContext,
    schedule_id: u64,
    notes: &str,
    metadata: &str,
) -> Result<(), String> {
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
            id: 0,
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
            notes: notes.to_string(),
            created_at: ctx.timestamp,
            metadata: metadata.to_string(),
        };

        ctx.db.deferred_revenue_line().insert(line);
    }

    Ok(())
}

/// Post revenue recognition for a specific line.
#[spacetimedb::reducer]
pub fn recognize_deferred_revenue(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    line_id: u64,
    params: RecognizeDeferredRevenueParams,
) -> Result<(), String> {
    check_permission(ctx, company_id, "deferred_revenue_line", "write")?;

    let line = ctx
        .db
        .deferred_revenue_line()
        .id()
        .find(&line_id)
        .ok_or("Revenue line not found")?;

    let schedule = ctx
        .db
        .deferred_revenue_schedule()
        .id()
        .find(&line.schedule_id)
        .ok_or("Schedule not found")?;

    if schedule.company_id != company_id {
        return Err("Revenue line does not belong to this company".to_string());
    }

    if line.recognized {
        return Err("Revenue already recognized for this line".to_string());
    }

    ctx.db
        .deferred_revenue_line()
        .id()
        .update(DeferredRevenueLine {
            recognized: true,
            move_id: Some(params.move_id),
            move_line_id: Some(params.move_line_id),
            ..line.clone()
        });

    // Update schedule totals
    let new_recognized = schedule.recognized_amount + line.amount;
    let new_deferred = schedule.deferred_amount - line.amount;
    let new_state = if new_deferred <= 0.0 {
        "finished".to_string()
    } else {
        schedule.state.clone()
    };

    ctx.db
        .deferred_revenue_schedule()
        .id()
        .update(DeferredRevenueSchedule {
            recognized_amount: new_recognized,
            deferred_amount: new_deferred,
            state: new_state,
            ..schedule
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "deferred_revenue_line",
            record_id: line_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "recognized": false }).to_string()),
            new_values: Some(serde_json::json!({ "recognized": true }).to_string()),
            changed_fields: vec![
                "recognized".to_string(),
                "move_id".to_string(),
                "move_line_id".to_string(),
            ],
            metadata: Some(serde_json::json!({ "amount": line.amount }).to_string()),
        },
    );

    log::info!(
        "Recognized deferred revenue line {} for amount {}",
        line_id,
        line.amount
    );
    Ok(())
}

// ============================================================================
// REDUCERS - Revenue Recognition Rules
// ============================================================================

/// Create a rule for automatic revenue recognition.
#[spacetimedb::reducer]
pub fn create_revenue_recognition_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateRevenueRecognitionRuleParams,
) -> Result<(), String> {
    check_permission(ctx, company_id, "revenue_recognition_rule", "create")?;

    let rule = RevenueRecognitionRule {
        id: 0,
        description: params.description.clone(),
        product_category_ids: params.product_category_ids.clone(),
        product_ids: params.product_ids.clone(),
        recognition_method: params.recognition_method.clone(),
        recognition_period: params.recognition_period.clone(),
        recognition_account_id: params.recognition_account_id,
        deferred_account_id: params.deferred_account_id,
        expense_account_id: params.expense_account_id,
        company_id,
        is_active: params.is_active,
        priority: params.priority,
        notes: params.notes.clone(),
        created_at: ctx.timestamp,
        created_by: ctx.sender(),
        metadata: params.metadata.clone().unwrap_or_default(),
    };

    let inserted = ctx.db.revenue_recognition_rule().insert(rule);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "revenue_recognition_rule",
            record_id: inserted.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "description": params.description,
                    "priority": params.priority,
                    "is_active": params.is_active
                })
                .to_string(),
            ),
            changed_fields: vec![
                "description".to_string(),
                "priority".to_string(),
                "is_active".to_string(),
            ],
            metadata: None,
        },
    );

    log::info!("Created revenue recognition rule {}", inserted.id);
    Ok(())
}

/// Deactivate a revenue recognition rule.
#[spacetimedb::reducer]
pub fn deactivate_revenue_recognition_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    rule_id: u64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "revenue_recognition_rule", "write")?;

    let rule = ctx
        .db
        .revenue_recognition_rule()
        .id()
        .find(&rule_id)
        .ok_or("Rule not found")?;

    if rule.company_id != company_id {
        return Err("Rule does not belong to this company".to_string());
    }

    ctx.db
        .revenue_recognition_rule()
        .id()
        .update(RevenueRecognitionRule {
            is_active: false,
            ..rule
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "revenue_recognition_rule",
            record_id: rule_id,
            action: "UPDATE",
            old_values: Some("{\"is_active\":true}".to_string()),
            new_values: Some("{\"is_active\":false}".to_string()),
            changed_fields: vec!["is_active".to_string()],
            metadata: None,
        },
    );

    log::info!("Deactivated revenue recognition rule {}", rule_id);
    Ok(())
}

/// Activate a revenue recognition rule.
#[spacetimedb::reducer]
pub fn activate_revenue_recognition_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    rule_id: u64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "revenue_recognition_rule", "write")?;

    let rule = ctx
        .db
        .revenue_recognition_rule()
        .id()
        .find(&rule_id)
        .ok_or("Rule not found")?;

    if rule.company_id != company_id {
        return Err("Rule does not belong to this company".to_string());
    }

    ctx.db
        .revenue_recognition_rule()
        .id()
        .update(RevenueRecognitionRule {
            is_active: true,
            ..rule
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "revenue_recognition_rule",
            record_id: rule_id,
            action: "UPDATE",
            old_values: Some("{\"is_active\":false}".to_string()),
            new_values: Some("{\"is_active\":true}".to_string()),
            changed_fields: vec!["is_active".to_string()],
            metadata: None,
        },
    );

    log::info!("Activated revenue recognition rule {}", rule_id);
    Ok(())
}
