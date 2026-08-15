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

use crate::accounting::fiscal_periods::ensure_accounting_period_open_for_date;
use crate::accounting::journal_entries::{
    account_move, account_move_line, AccountMove, AccountMoveLine,
};
use crate::accounting::relations::{
    require_active_account, require_active_currency_id, require_active_journal,
};
use crate::core::organization::{company_id_from_scope, require_company_in_organization};
use crate::helpers::{check_permission, next_doc_number, write_audit_log_v2, AuditLogParams};
use crate::inventory::stock::require_product_in_org;
use crate::sales::sales_core::{sale_order, sale_order_line};
use crate::subscriptions::billing_helpers::{
    apply_billing_run_to_subscription, apply_subscription_invoice_payment,
    create_subscription_ar_invoice, default_billing_run_key, mrr_from_period_total,
    normalize_payment_mode, normalize_plan_billing_period, normalize_rule_type,
};
use crate::subscriptions::tables::*;
use crate::types::{AccountMoveState, PaymentState};

// ============================================================================
// METADATA VALIDATION
// ============================================================================

/// Reserved metadata keys written exclusively by the billing engine.
/// User-provided metadata must not contain these keys to avoid overwriting
/// system-computed values.
const SUBSCRIPTION_RESERVED_METADATA_KEYS: &[&str] = &[
    "billing_run_key",
    "subscription_id",
    "fx_rate",
    "invoiced_untaxed_total",
    "deferred_remaining",
    "invoice_count",
    "next_invoice_date",
    "billing_period_start",
    "billing_period_end",
];

/// Validate that user-provided metadata is valid JSON and does not contain
/// system-reserved keys.
pub(crate) fn validate_subscription_metadata(metadata: &str) -> Result<(), String> {
    if metadata.is_empty() {
        return Ok(());
    }
    let parsed: serde_json::Value = serde_json::from_str(metadata)
        .map_err(|_| "metadata must be valid JSON".to_string())?;
    let obj = parsed
        .as_object()
        .ok_or("metadata must be a JSON object".to_string())?;
    for key in obj.keys() {
        if SUBSCRIPTION_RESERVED_METADATA_KEYS.contains(&key.as_str()) {
            return Err(format!(
                "metadata key '{}' is reserved for system use",
                key
            ));
        }
    }
    Ok(())
}

// ============================================================================
// INPUT PARAMS
// ============================================================================

/// Params for creating a subscription plan.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateSubscriptionPlanParams {
    pub company_id: Option<u64>,
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
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateSubscriptionFromSaleOrderParams {
    pub company_id: Option<u64>,
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
    /// When true, allow closing an active subscription with zero invoices (explicit no-charge).
    pub no_charge: bool,
}

/// Params for generating subscription invoice.
/// Scope: `company_id` and `subscription_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct GenerateSubscriptionInvoiceParams {
    pub invoice_date: Timestamp,
    /// Idempotency key; defaults to `sub:{id}:period:{invoice_date_secs}` when empty.
    pub billing_run_key: Option<String>,
    /// Defaults to plan.journal_id when omitted.
    pub journal_id: Option<u64>,
    pub income_account_id: u64,
    pub receivable_account_id: u64,
    /// Optional tax payable account; required when line taxes compute > 0 and tax group has none.
    pub tax_account_id: Option<u64>,
}

/// Params for applying a customer payment to a subscription invoice (post + clear AR).
/// Scope: `company_id` and `subscription_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct ApplySubscriptionInvoicePaymentParams {
    pub invoice_move_id: u64,
    pub payment_journal_id: u64,
    pub bank_account_id: u64,
    pub receivable_account_id: u64,
    /// Defaults to invoice residual when omitted.
    pub amount: Option<f64>,
    pub payment_date: Option<Timestamp>,
    /// Used when the invoice is still Draft (passed through to `post_invoice`).
    pub cogs_account_id: u64,
    pub inventory_account_id: u64,
    pub ref_: Option<String>,
    pub memo: Option<String>,
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
/// The reducer posts a balanced GL move (Dr deferred liability / Cr income).
#[derive(SpacetimeType, Clone, Debug)]
pub struct RecognizeDeferredRevenueParams {
    pub reference: Option<String>,
    pub metadata: Option<String>,
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
    params: CreateSubscriptionPlanParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription_plan", "create")?;

    let company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

    // Validate required fields
    if params.name.is_empty() {
        return Err("Plan name is required".to_string());
    }
    if params.code.is_empty() {
        return Err("Plan code is required".to_string());
    }
    let billing_period = normalize_plan_billing_period(&params.billing_period)?;
    let payment_mode = normalize_payment_mode(&params.payment_mode)?;

    // SUB-008: Validate recurring_invoice_day ∈ [1, 28].
    if params.recurring_invoice_day == 0 || params.recurring_invoice_day > 28 {
        return Err(format!(
            "recurring_invoice_day must be between 1 and 28 (got {})",
            params.recurring_invoice_day
        ));
    }

    // SUB-001: Validate currency FK
    require_active_currency_id(ctx, params.currency_id, "plan currency")?;
    // SUB-002: Validate journal FK
    require_active_journal(ctx, organization_id, company_id, params.journal_id, "plan journal")?;
    // SUB-003: Validate product FK
    require_product_in_org(ctx, organization_id, params.product_id)?;
    // SUB-005: Validate metadata schema
    validate_subscription_metadata(
        params.metadata.as_deref().unwrap_or_default(),
    )?;

    let plan = SubscriptionPlan {
        id: 0,
        organization_id,
        name: params.name.clone(),
        description: params.description.clone().unwrap_or_default(),
        code: params.code.clone(),
        active: params.active,
        company_id,
        currency_id: params.currency_id,
        journal_id: params.journal_id,
        product_id: params.product_id,
        billing_period,
        billing_period_unit: params.billing_period_unit.max(1),
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
        payment_mode,
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
    params: CreateSubscriptionFromSaleOrderParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "create")?;

    // Fetch sale order to derive authoritative partner, company, currency, pricelist
    let order = ctx
        .db
        .sale_order()
        .id()
        .find(&params.sale_order_id)
        .ok_or("Sale order not found")?;

    if let Some(cid) = params.company_id {
        let resolved = company_id_from_scope(ctx, organization_id, Some(cid))?;
        if resolved != order.company_id {
            return Err("Selected company does not match the sale order".to_string());
        }
    }

    use crate::types::SaleState;
    if order.state != SaleState::Sale && order.state != SaleState::Done {
        return Err("Sale order must be confirmed before creating a subscription".to_string());
    }

    // Fetch plan to derive authoritative billing cadence
    let plan = ctx
        .db
        .subscription_plan()
        .id()
        .find(&params.plan_id)
        .ok_or("Subscription plan not found")?;
    if plan.organization_id != organization_id {
        return Err("Subscription plan does not belong to this organization".to_string());
    }
    if plan.company_id != order.company_id {
        return Err("Subscription plan company does not match the sale order".to_string());
    }

    // Server-authoritative fields derived from SO and plan
    let partner_id = order.partner_id;
    let partner_invoice_id = order.partner_invoice_id;
    let partner_shipping_id = order.partner_shipping_id;
    let currency_id = order.currency_id;
    let pricelist_id = order.pricelist_id;
    let resolved_company_id = order.company_id;
    let recurring_rule_type = normalize_rule_type(&plan.billing_period)?;
    let recurring_interval = plan.billing_period_unit.max(1);
    let recurring_invoice_day = plan.recurring_invoice_day;
    let payment_mode = normalize_payment_mode(&params.payment_mode)?;

    let so_lines: Vec<_> = ctx
        .db
        .sale_order_line()
        .order_line_by_order()
        .filter(&params.sale_order_id)
        .filter(|l| l.display_type.is_none())
        .collect();
    if so_lines.is_empty() {
        return Err("Sale order has no invoiceable lines for subscription".to_string());
    }

    let period_total: f64 = so_lines.iter().map(|l| l.price_subtotal).sum();
    let mrr = mrr_from_period_total(period_total, &recurring_rule_type);

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
        organization_id,
        code,
        description: params.description.clone().unwrap_or_default(),
        plan_id: params.plan_id,
        partner_id,
        partner_invoice_id,
        partner_shipping_id,
        company_id: resolved_company_id,
        currency_id,
        pricelist_id,
        analytic_account_id: params.analytic_account_id.or(order.analytic_account_id),
        date_start: params.date_start,
        date: ctx.timestamp,
        recurring_next_date: params.date_start,
        recurring_invoice_day,
        recurring_rule_type: recurring_rule_type.clone(),
        recurring_interval,
        close_reason_id: None,
        close_date: None,
        payment_token_id: None,
        payment_mode,
        user_id: Some(ctx.sender()),
        team_id: params.team_id,
        health: "healthy".to_string(),
        stage_id: params.stage_id,
        // Force draft; activate_subscription is the only path to active.
        state: "draft".to_string(),
        is_active: false,
        is_trial: params.is_trial,
        invoice_count: 0,
        vendor_id: params.vendor_id,
        recurring_total: period_total,
        recurring_monthly: mrr,
        recurring_mrr: mrr,
        recurring_mrr_local: mrr,
        percentage_mrr: 0.0,
        kpi_1month_mrr: mrr,
        kpi_3months_mrr: mrr,
        kpi_12months_mrr: mrr,
        rating_last_value: 0,
        invoice_ids: vec![],
        sale_order_ids: vec![params.sale_order_id],
        subscription_line_ids: vec![],
        activity_ids: vec![],
        message_follower_ids: vec![],
        message_ids: vec![],
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        metadata: params.metadata.clone().unwrap_or_default(),
    };

    let inserted = ctx.db.subscription().insert(subscription);

    let mut line_ids: Vec<u64> = Vec::with_capacity(so_lines.len());
    for so_line in so_lines {
        let sub_line = ctx.db.subscription_line().insert(SubscriptionLine {
            id: 0,
            organization_id,
            name: so_line.name.clone(),
            subscription_id: inserted.id,
            product_id: so_line.product_id,
            product_uom: so_line.product_uom,
            product_uom_qty: so_line.product_uom_qty,
            price_unit: so_line.price_unit,
            price_subtotal: so_line.price_subtotal,
            discount: so_line.discount,
            price_tax: so_line.price_tax,
            price_total: so_line.price_total,
            tax_ids: so_line.tax_id.clone(),
            company_id: resolved_company_id,
            currency_id,
            analytic_account_id: order.analytic_account_id,
            analytic_tag_ids: so_line.analytic_tag_ids.clone(),
            recurring_rule_type: recurring_rule_type.clone(),
            recurring_interval,
            recurring_next_date: params.date_start,
            recurring_last_date: None,
            line_is_recurring: true,
            line_is_prorated: false,
            line_is_start_date: false,
            line_is_end_date: false,
            line_is_trial: params.is_trial,
            line_trial_duration: 0,
            line_trial_unit: String::new(),
            line_parent_id: None,
            line_child_ids: vec![],
            line_is_downpayment: so_line.is_downpayment,
            line_is_discount: so_line.discount > 0.0,
            line_is_gift: false,
            line_is_upgrade: false,
            line_is_downgrade: false,
            sale_order_line_id: Some(so_line.id), // SUB-006: track origin for price re-validation
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            metadata: String::new(),
        });
        line_ids.push(sub_line.id);
    }

    let line_count = line_ids.len();
    ctx.db.subscription().id().update(Subscription {
        subscription_line_ids: line_ids,
        updated_at: ctx.timestamp,
        ..inserted.clone()
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(resolved_company_id),
            table_name: "subscription",
            record_id: inserted.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "code": inserted.code,
                    "sale_order_id": params.sale_order_id,
                    "partner_id": partner_id,
                    "state": "draft",
                    "recurring_mrr": mrr,
                    "line_count": line_count
                })
                .to_string(),
            ),
            changed_fields: vec![
                "code".to_string(),
                "sale_order_id".to_string(),
                "partner_id".to_string(),
                "state".to_string(),
                "subscription_line_ids".to_string(),
                "recurring_mrr".to_string(),
            ],
            metadata: None,
        },
    );

    log::info!(
        "Created subscription {} from sale order {} with {} lines",
        inserted.id,
        params.sale_order_id,
        line_count
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
    check_permission(ctx, organization_id, "subscription", "write")?;

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

    if subscription.state != "draft" {
        return Err("Subscription must be in draft state to activate".to_string());
    }
    if subscription.subscription_line_ids.is_empty() {
        return Err("Subscription must have at least one line to activate".to_string());
    }

    let activated = Subscription {
        state: "active".to_string(),
        is_active: true,
        health: "healthy".to_string(),
        updated_at: ctx.timestamp,
        ..subscription
    };
    ctx.db.subscription().id().update(activated.clone());
    let _ = crate::subscriptions::subscription_wave_e::grant_default_entitlement(
        ctx,
        organization_id,
        company_id,
        &activated,
    )?;

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription",
            record_id: subscription_id,
            action: "UPDATE",
            old_values: Some("{\"state\":\"draft\",\"is_active\":false}".to_string()),
            new_values: Some(
                "{\"state\":\"active\",\"is_active\":true,\"entitlement\":\"granted\"}".to_string(),
            ),
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
    check_permission(ctx, organization_id, "subscription", "delete")?;

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

    if subscription.state == "closed" {
        return Err("Subscription is already closed".to_string());
    }

    // Active contracts with no invoices require an explicit no-charge acknowledgment.
    if subscription.state == "active" && subscription.invoice_count == 0 && !params.no_charge {
        return Err(
            "Active subscription has no invoices; set no_charge=true or generate a final invoice first"
                .to_string(),
        );
    }

    let old_state = subscription.state.clone();

    // Revoke access in the same reducer transaction as the contract close. SpacetimeDB
    // rolls back every write if this reducer returns an error, so callers can never
    // observe a closed subscription with active customer entitlements.
    let revoked_entitlements = crate::subscriptions::subscription_wave_e::revoke_all_entitlements(
        ctx,
        organization_id,
        subscription_id,
    );

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
            metadata: Some(
                serde_json::json!({
                    "notes": params.notes,
                    "no_charge": params.no_charge,
                    "entitlements_revoked": revoked_entitlements,
                })
                .to_string(),
            ),
        },
    );

    log::info!("Closed subscription {}", subscription_id);
    Ok(())
}

// ============================================================================
// REDUCERS - Subscription Invoicing
// ============================================================================

/// Generate the next invoice for a subscription (creates draft AR `OutInvoice`).
#[spacetimedb::reducer]
pub fn generate_subscription_invoice(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: GenerateSubscriptionInvoiceParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    check_permission(ctx, organization_id, "account_move", "create")?;

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

    let plan = ctx
        .db
        .subscription_plan()
        .id()
        .find(&subscription.plan_id)
        .ok_or("Subscription plan not found")?;
    let journal_id = params.journal_id.unwrap_or(plan.journal_id);
    if journal_id == 0 {
        return Err("journal_id is required (plan has none)".to_string());
    }
    if params.income_account_id == 0 || params.receivable_account_id == 0 {
        return Err("income_account_id and receivable_account_id are required".to_string());
    }

    let billing_run_key = params
        .billing_run_key
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default_billing_run_key(subscription_id, params.invoice_date));

    let recurring_line_count = ctx
        .db
        .subscription_line()
        .subscription_line_by_subscription()
        .filter(&subscription_id)
        .filter(|l| l.organization_id == organization_id && l.line_is_recurring)
        .count();
    let unbilled_usage = crate::subscriptions::subscription_wave_d::count_unbilled_usage_charges(
        ctx,
        organization_id,
        subscription_id,
    );
    if recurring_line_count == 0 && unbilled_usage == 0 {
        return Err(
            "Subscription has no recurring lines or unbilled usage charges to invoice".to_string(),
        );
    }

    let old_invoice_count = subscription.invoice_count;
    let result = create_subscription_ar_invoice(
        ctx,
        organization_id,
        company_id,
        &subscription,
        params.invoice_date,
        &billing_run_key,
        journal_id,
        params.income_account_id,
        params.receivable_account_id,
        params.tax_account_id,
        ctx.sender(),
    )?;

    let mut usage_added = 0.0f64;
    if !result.already_existed {
        usage_added = crate::subscriptions::subscription_wave_d::append_unbilled_usage_to_invoice(
            ctx,
            organization_id,
            company_id,
            &subscription,
            result.move_id,
            params.income_account_id,
            &billing_run_key,
            ctx.sender(),
        )?;
        if recurring_line_count == 0 && usage_added <= 0.0 {
            return Err("No recurring lines and no usage/true-up amount to invoice".to_string());
        }
    }

    apply_billing_run_to_subscription(
        ctx,
        subscription,
        result.move_id,
        result.period_end,
        result.already_existed,
        result.fx_rate,
    );

    let refreshed = ctx
        .db
        .subscription()
        .id()
        .find(&subscription_id)
        .ok_or("Subscription not found after billing run")?;

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription",
            record_id: subscription_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "invoice_count": old_invoice_count }).to_string()),
            new_values: Some(
                serde_json::json!({
                    "invoice_count": refreshed.invoice_count,
                    "invoice_move_id": result.move_id,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "invoice_count".to_string(),
                "recurring_next_date".to_string(),
                "invoice_ids".to_string(),
            ],
            metadata: Some(
                serde_json::json!({
                    "billing_run_recorded": true,
                    "accounting_invoice_created": true,
                    "billing_run_key": billing_run_key,
                    "already_existed": result.already_existed,
                    "amount_total": result.amount_total + usage_added,
                    "amount_tax": result.amount_tax,
                    "usage_amount_added": usage_added,
                    "fx_rate": result.fx_rate,
                    "deferred_schedule_ids": result.deferred_schedule_ids,
                })
                .to_string(),
            ),
        },
    );

    log::info!(
        "Subscription {} billing run key={} invoice_move={} idempotent={} usage_added={}",
        subscription_id,
        billing_run_key,
        result.move_id,
        result.already_existed,
        usage_added
    );
    Ok(())
}

/// Post (if needed) and apply a customer payment that clears a subscription AR invoice.
#[spacetimedb::reducer]
pub fn pay_subscription_invoice(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: ApplySubscriptionInvoicePaymentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    check_permission(ctx, organization_id, "payment", "create")?;
    check_permission(ctx, organization_id, "account_move", "write")?;

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
    if params.payment_journal_id == 0 || params.bank_account_id == 0 {
        return Err("payment_journal_id and bank_account_id are required".to_string());
    }
    if params.receivable_account_id == 0 {
        return Err("receivable_account_id is required".to_string());
    }

    let result = apply_subscription_invoice_payment(
        ctx,
        organization_id,
        company_id,
        &subscription,
        params.invoice_move_id,
        params.payment_journal_id,
        params.bank_account_id,
        params.receivable_account_id,
        params.amount,
        params.payment_date,
        params.cogs_account_id,
        params.inventory_account_id,
        params.ref_.clone(),
        params.memo.clone(),
    )?;

    if result.pending_approval {
        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(company_id),
                table_name: "subscription",
                record_id: subscription_id,
                action: "UPDATE",
                old_values: None,
                new_values: Some(
                    serde_json::json!({
                        "invoice_move_id": result.invoice_move_id,
                        "payment_id": result.payment_id,
                        "payment_move_id": result.payment_move_id,
                        "amount": result.amount,
                        "pending_approval": true,
                    })
                    .to_string(),
                ),
                changed_fields: vec!["payment_pending_approval".to_string()],
                metadata: Some(
                    serde_json::json!({
                        "payment_applied": false,
                        "pending_approval": true,
                        "invoice_move_id": result.invoice_move_id,
                        "payment_id": result.payment_id,
                    })
                    .to_string(),
                ),
            },
        );
        log::info!(
            "Subscription {} payment {} pending PostPayment approval for invoice {}",
            subscription_id,
            result.payment_id,
            result.invoice_move_id
        );
        return Ok(());
    }

    let refreshed = ctx
        .db
        .subscription()
        .id()
        .find(&subscription_id)
        .ok_or("Subscription not found after payment")?;
    crate::subscriptions::subscription_wave_e::on_subscription_payment_cleared(
        ctx,
        organization_id,
        company_id,
        &refreshed,
    )?;

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription",
            record_id: subscription_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "invoice_move_id": result.invoice_move_id,
                    "payment_id": result.payment_id,
                    "payment_move_id": result.payment_move_id,
                    "amount": result.amount,
                })
                .to_string(),
            ),
            changed_fields: vec!["payment_applied".to_string()],
            metadata: Some(
                serde_json::json!({
                    "payment_applied": true,
                    "invoice_move_id": result.invoice_move_id,
                    "payment_id": result.payment_id,
                    "entitlement_restored": true,
                })
                .to_string(),
            ),
        },
    );

    log::info!(
        "Subscription {} payment {} applied to invoice {} amount={}",
        subscription_id,
        result.payment_id,
        result.invoice_move_id,
        result.amount
    );
    Ok(())
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
    check_permission(ctx, organization_id, "deferred_revenue_schedule", "create")?;

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
        organization_id,
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
        organization_id,
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
    organization_id: u64,
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
            organization_id,
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
    check_permission(ctx, organization_id, "deferred_revenue_line", "write")?;
    check_permission(ctx, organization_id, "account_move", "create")?;

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

    if schedule.organization_id != organization_id {
        return Err("Revenue line does not belong to this organization".to_string());
    }
    if line.company_id != company_id || schedule.company_id != company_id {
        return Err("Revenue line does not belong to this company".to_string());
    }

    if line.recognized {
        return Err("Revenue already recognized for this line".to_string());
    }
    if line.amount <= 0.0 {
        return Err("Recognition amount must be positive".to_string());
    }

    ensure_accounting_period_open_for_date(ctx, company_id, line.recognition_date)?;

    // account_id = deferred liability (BS); deferred_account_id = income when recognized
    let liability_account_id = line.account_id;
    let income_account_id = line.deferred_account_id;
    let amount = line.amount;
    let name = next_doc_number(ctx, "REVREC");
    let currency_id = line.currency_id;

    let move_record = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: name.clone(),
        ref_: params.reference.clone(),
        move_type: crate::types::MoveType::Entry,
        auto_post: false,
        state: AccountMoveState::Posted,
        date: line.recognition_date,
        invoice_date: None,
        invoice_date_due: None,
        invoice_payment_term_id: None,
        invoice_origin: None,
        invoice_partner_display_name: None,
        invoice_cash_rounding_id: None,
        payment_reference: params.reference.clone(),
        partner_shipping_id: None,
        sale_order_id: None,
        partner_id: None,
        commercial_partner_id: None,
        partner_bank_id: None,
        fiscal_position_id: None,
        invoice_user_id: None,
        invoice_incoterm_id: None,
        incoterm_location: None,
        campaign_id: None,
        source_id: None,
        medium_id: None,
        company_id,
        journal_id: line.journal_id,
        currency_id,
        company_currency_id: currency_id,
        amount_untaxed: amount,
        amount_tax: 0.0,
        amount_total: amount,
        amount_residual: 0.0,
        amount_untaxed_signed: amount,
        amount_tax_signed: 0.0,
        amount_total_signed: amount,
        amount_total_in_currency_signed: amount,
        amount_residual_signed: 0.0,
        to_check: false,
        posted_before: true,
        is_storno: false,
        is_move_sent: false,
        secure_sequence_number: None,
        invoice_has_outstanding: false,
        payment_state: PaymentState::NotPaid,
        restrict_mode_hash_table: false,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata.clone(),
    });

    let insert_line = |account_id: u64, line_name: &str, debit: f64, credit: f64, sequence: u32| {
        ctx.db.account_move_line().insert(AccountMoveLine {
            id: 0,
            organization_id,
            move_id: move_record.id,
            move_name: Some(name.clone()),
            date: line.recognition_date,
            ref_: params.reference.clone(),
            parent_state: AccountMoveState::Posted,
            journal_id: line.journal_id,
            company_id,
            company_currency_id: currency_id,
            sequence,
            name: line_name.to_string(),
            quantity: 0.0,
            price_unit: 0.0,
            price: 0.0,
            price_subtotal: 0.0,
            price_total: 0.0,
            discount: 0.0,
            balance: debit - credit,
            currency_id,
            amount_currency: 0.0,
            amount_residual: 0.0,
            amount_residual_currency: 0.0,
            debit,
            credit,
            debit_currency: 0.0,
            credit_currency: 0.0,
            tax_base_amount: 0.0,
            account_id,
            account_internal_type: None,
            account_internal_group: None,
            account_root_id: None,
            group_tax_id: None,
            tax_line_id: None,
            tax_group_id: None,
            tax_ids: vec![],
            tax_repartition_line_id: None,
            tax_audit: None,
            partner_id: None,
            commercial_partner_id: None,
            reconcile_model_id: None,
            payment_id: None,
            statement_line_id: None,
            currency_id_field: None,
            blocked: false,
            matching_number: None,
            matching_label: None,
            is_matching: false,
            expected_pay_date: None,
            expected_pay_date_currency_id: None,
            expected_pay_date_amount: 0.0,
            expected_pay_date_residual: 0.0,
            display_type: None,
            is_downpayment: false,
            exclude_from_invoice_tab: false,
            analytic_account_id: None,
            analytic_tag_ids: vec![],
            product_id: None,
            product_uom_id: None,
            product_category_id: None,
            cogs_amount: 0.0,
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: params.metadata.clone(),
        })
    };

    let liability_line = insert_line(
        liability_account_id,
        "Deferred revenue recognition",
        amount,
        0.0,
        1,
    );
    insert_line(income_account_id, "Recognized revenue", 0.0, amount, 2);

    ctx.db
        .deferred_revenue_line()
        .id()
        .update(DeferredRevenueLine {
            recognized: true,
            move_id: Some(move_record.id),
            move_line_id: Some(liability_line.id),
            ..line.clone()
        });

    let new_recognized = schedule.recognized_amount + amount;
    let new_deferred = schedule.deferred_amount - amount;
    let new_state = if new_deferred <= 0.0 {
        "finished".to_string()
    } else {
        schedule.state.clone()
    };
    let mut journal_entry_ids = schedule.journal_entry_ids.clone();
    journal_entry_ids.push(move_record.id);

    ctx.db
        .deferred_revenue_schedule()
        .id()
        .update(DeferredRevenueSchedule {
            recognized_amount: new_recognized,
            deferred_amount: new_deferred,
            state: new_state,
            journal_entry_ids,
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
            new_values: Some(
                serde_json::json!({
                    "recognized": true,
                    "move_id": move_record.id,
                    "amount": amount,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "recognized".to_string(),
                "move_id".to_string(),
                "move_line_id".to_string(),
            ],
            metadata: params.metadata.clone(),
        },
    );

    log::info!(
        "Recognized deferred revenue line {} for amount {} via move {}",
        line_id,
        amount,
        move_record.id
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
    check_permission(ctx, organization_id, "revenue_recognition_rule", "create")?;

    // Validate company belongs to org
    require_company_in_organization(ctx, organization_id, company_id)?;

    // SUB-004: Validate account FKs
    require_active_account(
        ctx,
        organization_id,
        company_id,
        params.recognition_account_id,
        "recognition account",
    )?;
    require_active_account(
        ctx,
        organization_id,
        company_id,
        params.deferred_account_id,
        "deferred account",
    )?;
    if let Some(expense_account_id) = params.expense_account_id {
        require_active_account(
            ctx,
            organization_id,
            company_id,
            expense_account_id,
            "expense account",
        )?;
    }

    let rule = RevenueRecognitionRule {
        id: 0,
        organization_id,
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
    check_permission(ctx, organization_id, "revenue_recognition_rule", "write")?;

    let rule = ctx
        .db
        .revenue_recognition_rule()
        .id()
        .find(&rule_id)
        .ok_or("Rule not found")?;

    if rule.organization_id != organization_id {
        return Err("Rule does not belong to this organization".to_string());
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
    check_permission(ctx, organization_id, "revenue_recognition_rule", "write")?;

    let rule = ctx
        .db
        .revenue_recognition_rule()
        .id()
        .find(&rule_id)
        .ok_or("Rule not found")?;

    if rule.organization_id != organization_id {
        return Err("Rule does not belong to this organization".to_string());
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
