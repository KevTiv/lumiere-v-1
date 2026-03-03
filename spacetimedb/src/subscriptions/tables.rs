//! Subscription & Advanced Billing tables – SpacetimeDB Phase 9
//!
use spacetimedb::{Identity, Timestamp};

/// Pricing plan template (weekly/monthly/yearly) --------------- */
#[derive(Clone)]
#[spacetimedb::table(accessor = subscription_plan, public)]
pub struct SubscriptionPlan {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    pub description: String,
    pub code: String,
    pub active: bool,

    pub company_id: u64,
    pub currency_id: u64,
    pub journal_id: u64, // accounting journal for invoices
    pub product_id: u64, // generic "subscription" product

    /// billing cadence
    pub billing_period: String, // e.g. "month"
    pub billing_period_unit: u32,  // e.g. 1
    pub recurring_invoice_day: u8, // day of month to invoice

    /// trial rules
    pub trial_period: bool,
    pub trial_duration: u32,
    pub trial_unit: String, // "day" | "week" | "month"

    /// dunning
    pub auto_close_limit: u32, // cancel after X failed invoices

    /// templates / links
    pub template_id: Option<u64>, // optional invoice template
    pub invoice_mail_template_id: Option<u64>,
    pub user_id: Option<Identity>, // sales rep
    pub website_url: Option<String>,

    /// marketing
    pub is_published: bool,
    pub is_default: bool,
    pub color: u32,
    pub image_1920_url: Option<String>,

    /// computed
    pub recurring_rule_count: u32,
    pub recurring_rule_min_unit: String,
    pub recurring_rule_max_unit: String,
    pub recurring_rule_min_count: u32,
    pub recurring_rule_max_count: u32,
    pub close_reason_id: Option<u64>,

    pub payment_mode: String, // "draft_invoice" | "automated_payment"

    // metadata helpers
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: String, // JSON: store pricelist rules, add-ons, etc.
}

/// Active subscription contract -------------------------------- */
#[derive(Clone)]
#[spacetimedb::table(accessor = subscription, public)]
pub struct Subscription {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub code: String, // generated sequence
    pub description: String,

    pub plan_id: u64,
    pub partner_id: u64,          // customer
    pub partner_invoice_id: u64,  // invoice address
    pub partner_shipping_id: u64, // delivery address (physical goods)

    pub company_id: u64,
    pub currency_id: u64,
    pub pricelist_id: u64,

    /// analytic dimensions
    pub analytic_account_id: Option<u64>,

    /// life-cycle
    pub date_start: Timestamp, // subscription begin
    pub date: Timestamp,                // last updated
    pub recurring_next_date: Timestamp, // NEXT invoice date
    pub recurring_invoice_day: u8,
    pub recurring_rule_type: String, // "monthly" etc.
    pub recurring_interval: u32,     // every N months

    /// closure
    pub close_reason_id: Option<u64>,
    pub close_date: Option<Timestamp>,

    /// payment token for auto-charge
    pub payment_token_id: Option<u64>,

    pub payment_mode: String, // "draft_invoice" | "automated_payment"

    /// ownership
    pub user_id: Option<Identity>, // sales rep
    pub team_id: Option<u64>, // sales team

    /// KPIs / health
    pub health: String, // "healthy" | "at_risk" | "churned"
    pub stage_id: Option<u64>,

    pub state: String, // "draft" | "active" | "paused" | "close"
    pub is_active: bool,
    pub is_trial: bool,

    /// counters
    pub invoice_count: u32,
    pub vendor_id: Option<u64>, // if we resell someone else's service

    /// MRR metrics
    pub recurring_total: f64,
    pub recurring_monthly: f64, // cached MRR
    pub recurring_mrr: f64,
    pub recurring_mrr_local: f64, // in company currency

    pub percentage_mrr: f64, // % growth vs last period

    /// KPI history
    pub kpi_1month_mrr: f64,
    pub kpi_3months_mrr: f64,
    pub kpi_12months_mrr: f64,

    pub rating_last_value: u8,

    /// references
    pub invoice_ids: Vec<u64>, // generated invoices
    pub sale_order_ids: Vec<u64>, // origin orders
    pub subscription_line_ids: Vec<u64>,

    pub activity_ids: Vec<u64>,
    pub message_follower_ids: Vec<u64>,
    pub message_ids: Vec<u64>,

    /// standard metadata
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: String,
}

/// Subscription line items (recurring contract lines) --------- */
#[derive(Clone)]
#[spacetimedb::table(accessor = subscription_line, public)]
pub struct SubscriptionLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String, // description

    pub subscription_id: u64,
    pub product_id: u64,
    pub product_uom: u64,
    pub product_uom_qty: f64,

    pub price_unit: f64,
    pub price_subtotal: f64,
    pub discount: f64,
    pub price_tax: f64,
    pub price_total: f64,

    pub tax_ids: Vec<u64>,

    pub company_id: u64,
    pub currency_id: u64,

    pub analytic_account_id: Option<u64>,
    pub analytic_tag_ids: Vec<u64>,

    /// recurrence mirrors parent for quick queries
    pub recurring_rule_type: String,
    pub recurring_interval: u32,
    pub recurring_next_date: Timestamp,
    pub recurring_last_date: Option<Timestamp>,

    /// flags for special handling
    pub line_is_recurring: bool,
    pub line_is_prorated: bool,
    pub line_is_start_date: bool,
    pub line_is_end_date: bool,
    pub line_is_trial: bool,
    pub line_trial_duration: u32,
    pub line_trial_unit: String,

    /// parent/child for upgrades/downgrades
    pub line_parent_id: Option<u64>,
    pub line_child_ids: Vec<u64>,

    /// one-off flags
    pub line_is_downpayment: bool,
    pub line_is_discount: bool,
    pub line_is_gift: bool,
    pub line_is_upgrade: bool,
    pub line_is_downgrade: bool,

    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: String,
}

/// Deferred revenue schedule header ---------------------------- */
#[derive(Clone)]
#[spacetimedb::table(accessor = deferred_revenue_schedule, public)]
pub struct DeferredRevenueSchedule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub description: String,

    pub journal_id: u64,          // journal for recognition entries
    pub account_id: u64,          // deferred revenue balance sheet account
    pub deferred_account_id: u64, // income account when recognized
    pub company_id: u64,
    pub currency_id: u64,

    pub total_amount: f64,      // original deferred amount
    pub recognized_amount: f64, // already posted
    pub deferred_amount: f64,   // remaining

    pub start_date: Timestamp, // revenue recognition start
    pub end_date: Timestamp,   // recognition finish

    pub recognition_method: String, // "straight_line" | "one_time" | "monthly"
    pub recognition_period: String, // "month" | "quarter" | "year"

    pub state: String, // "draft" | "running" | "finished" | "cancelled"

    /// origin document (sale invoice line, subscription line, etc.)
    pub origin_move_id: Option<u64>,
    pub origin_move_line_id: Option<u64>,

    pub line_ids: Vec<u64>,          // generated recognition lines
    pub journal_entry_ids: Vec<u64>, // posted move ids

    pub notes: String,

    pub created_at: Timestamp,
    pub created_by: Identity,
    pub metadata: String,
}

/// Single revenue recognition posting line --------------------- */
#[derive(Clone)]
#[spacetimedb::table(accessor = deferred_revenue_line, public)]
pub struct DeferredRevenueLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub schedule_id: u64,

    pub sequence: u32,
    pub recognition_date: Timestamp,
    pub amount: f64,
    pub recognized: bool, // move posted?

    /// posted move reference
    pub move_id: Option<u64>,
    pub move_line_id: Option<u64>,

    pub journal_id: u64,
    pub account_id: u64,
    pub deferred_account_id: u64,
    pub company_id: u64,
    pub currency_id: u64,

    pub notes: String,

    pub created_at: Timestamp,
    pub metadata: String,
}

/// Rules to decide WHEN to defer revenue ----------------------- */
#[derive(Clone)]
#[spacetimedb::table(accessor = revenue_recognition_rule, public)]
pub struct RevenueRecognitionRule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub description: String,

    /// criteria
    pub product_category_ids: Vec<u64>,
    pub product_ids: Vec<u64>, // specific products override categories

    /// accounting treatment
    pub recognition_method: String, // "straight_line" | "one_time"
    pub recognition_period: String, // "month" | "quarter" | "year"

    pub recognition_account_id: u64,     // income side
    pub deferred_account_id: u64,        // balance sheet side
    pub expense_account_id: Option<u64>, // if we also defer COGS

    pub company_id: u64,

    pub is_active: bool,
    pub priority: u32, // highest wins when multiple match

    pub notes: String,

    pub created_at: Timestamp,
    pub created_by: Identity,
    pub metadata: String,
}
