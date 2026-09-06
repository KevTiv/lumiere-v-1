//! Wave E — dunning/collections, customer entitlements, payment/rail intents,
//! pack WHT/e-invoice settle hooks, index-linked pricing, exception flags, rev-rec rebase.

use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::journal_entries::account_move;
use crate::subscriptions::tables::Subscription;
use crate::types::{AccountMoveState, MoveType};

// Preserve the historical module path for tests and reducer consumers.
pub use super::price_index::{
    apply_index_linked_renewal, upsert_subscription_price_index, ApplyIndexLinkedRenewalParams,
    UpsertSubscriptionPriceIndexParams,
};

#[path = "subscription_dunning.rs"]
mod subscription_dunning;
pub use subscription_dunning::*;
#[path = "subscription_entitlements.rs"]
mod subscription_entitlements;
pub use subscription_entitlements::*;
#[path = "subscription_payment.rs"]
mod subscription_payment;
pub use subscription_payment::*;
#[path = "subscription_deferred.rs"]
mod subscription_deferred;
pub use subscription_deferred::*;
#[path = "subscription_exceptions.rs"]
mod subscription_exceptions;
pub use subscription_exceptions::*;

// ── Tables ───────────────────────────────────────────────────────────────────

/// Per-subscription collections / dunning + exception flags (ops queues).
#[derive(Clone)]
#[spacetimedb::table(
    accessor = subscription_collection,
    public,
    index(accessor = subscription_collection_by_org, btree(columns = [organization_id])),
    index(accessor = subscription_collection_by_sub, btree(columns = [subscription_id]))
)]
pub struct SubscriptionCollection {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub subscription_id: u64,
    /// current | reminder | suspended | closing
    pub stage: String,
    pub failed_payment_count: u32,
    pub past_due_days: u32,
    pub due_to_bill: bool,
    pub past_due: bool,
    pub amend_pending: bool,
    pub last_failure_at: Option<Timestamp>,
    pub last_evaluated_at: Timestamp,
    pub metadata: String,
}

/// Customer entitlement (NOT platform billing_account feature flags).
#[derive(Clone)]
#[spacetimedb::table(
    accessor = subscription_entitlement,
    public,
    index(accessor = subscription_entitlement_by_org, btree(columns = [organization_id])),
    index(accessor = subscription_entitlement_by_sub, btree(columns = [subscription_id])),
    index(accessor = subscription_entitlement_by_partner, btree(columns = [partner_id]))
)]
pub struct SubscriptionEntitlement {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub subscription_id: u64,
    pub partner_id: u64,
    pub product_id: Option<u64>,
    /// e.g. subscription.access | feature code
    pub feature_code: String,
    /// active | suspended | revoked
    pub status: String,
    pub granted_at: Timestamp,
    pub revoked_at: Option<Timestamp>,
    pub created_by: Identity,
    pub metadata: String,
}

/// Durable payment / local-rail charge intents (worker applies; reducers record results).
#[derive(Clone)]
#[spacetimedb::table(
    accessor = subscription_payment_intent,
    public,
    index(accessor = subscription_payment_intent_by_org, btree(columns = [organization_id])),
    index(accessor = subscription_payment_intent_by_sub, btree(columns = [subscription_id])),
    index(accessor = subscription_payment_intent_by_status, btree(columns = [status])),
    index(accessor = subscription_payment_intent_by_key, btree(columns = [idempotency_key]))
)]
pub struct SubscriptionPaymentIntent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub subscription_id: u64,
    /// card_charge | pix | boleto | paynow | fpx | qris | eft
    pub intent_type: String,
    pub status: String,
    #[unique]
    pub idempotency_key: String,
    pub invoice_move_id: Option<u64>,
    pub payment_token_id: Option<u64>,
    pub amount: f64,
    pub currency_id: u64,
    /// When card markets are unreliable: draft_invoice fallback requested.
    pub fallback_draft_invoice: bool,
    pub last_error: Option<String>,
    pub attempt_count: u32,
    pub applied_at: Option<Timestamp>,
    pub created_at: Timestamp,
    pub created_by: Identity,
    pub metadata: String,
}

/// Pack-driven WHT / e-invoice settle intents on AR payment.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = subscription_tax_settle_intent,
    public,
    index(accessor = subscription_tax_settle_by_org, btree(columns = [organization_id])),
    index(accessor = subscription_tax_settle_by_status, btree(columns = [status])),
    index(accessor = subscription_tax_settle_by_key, btree(columns = [idempotency_key]))
)]
pub struct SubscriptionTaxSettleIntent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub subscription_id: u64,
    /// wht | e_invoice
    pub intent_type: String,
    pub status: String,
    #[unique]
    pub idempotency_key: String,
    pub invoice_move_id: u64,
    pub payment_id: Option<u64>,
    pub pack_code: String,
    pub payload: String,
    pub last_error: Option<String>,
    pub applied_at: Option<Timestamp>,
    pub created_at: Timestamp,
    pub created_by: Identity,
    pub metadata: String,
}

/// CPI / IPCA (etc.) index factors for renewal uplift.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = subscription_price_index,
    public,
    index(accessor = subscription_price_index_by_org, btree(columns = [organization_id])),
    index(accessor = subscription_price_index_by_code, btree(columns = [index_code]))
)]
pub struct SubscriptionPriceIndex {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    /// e.g. CPI | IPCA
    pub index_code: String,
    /// Country / pack hint (br, za, …).
    pub country_code: String,
    /// YYYY-MM period key.
    pub period_key: String,
    /// Multiplier vs prior period (e.g. 1.045).
    pub factor: f64,
    pub active: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: String,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordSubscriptionPaymentFailureParams {
    pub invoice_move_id: Option<u64>,
    pub reason: Option<String>,
    pub past_due_days: Option<u32>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct AdvanceSubscriptionDunningParams {
    /// Override past-due days for evaluation; defaults to collection.past_due_days.
    pub past_due_days: Option<u32>,
    /// Days before moving reminder → suspended (default 14).
    pub suspend_after_days: Option<u32>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct GrantSubscriptionEntitlementParams {
    pub feature_code: String,
    pub product_id: Option<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateSubscriptionPaymentIntentParams {
    pub intent_type: String,
    pub idempotency_key: String,
    pub invoice_move_id: Option<u64>,
    pub payment_token_id: Option<u64>,
    pub amount: f64,
    pub currency_id: u64,
    pub fallback_draft_invoice: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct FailSubscriptionPaymentIntentParams {
    pub last_error: String,
    pub record_dunning_failure: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateSubscriptionTaxSettleIntentParams {
    pub intent_type: String,
    pub idempotency_key: String,
    pub invoice_move_id: u64,
    pub payment_id: Option<u64>,
    pub pack_code: String,
    pub payload: String,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RebaseDeferredSchedulesParams {
    /// Scale factor for remaining deferred amount (e.g. 1.1 after price uplift).
    pub scale_factor: f64,
    pub notes: Option<String>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn secs(ts: Timestamp) -> u64 {
    ts.to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_secs()
}

fn ensure_collection(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
) -> SubscriptionCollection {
    if let Some(row) = ctx
        .db
        .subscription_collection()
        .subscription_collection_by_sub()
        .filter(&subscription_id)
        .find(|c| c.organization_id == organization_id)
    {
        return row;
    }
    ctx.db
        .subscription_collection()
        .insert(SubscriptionCollection {
            id: 0,
            organization_id,
            company_id,
            subscription_id,
            stage: "current".to_string(),
            failed_payment_count: 0,
            past_due_days: 0,
            due_to_bill: false,
            past_due: false,
            amend_pending: false,
            last_failure_at: None,
            last_evaluated_at: ctx.timestamp,
            metadata: String::new(),
        })
}

fn has_amend_pending(ctx: &ReducerContext, organization_id: u64, subscription_id: u64) -> bool {
    // Draft proration / credit moves linked from recent amendments (metadata scan on moves).
    ctx.db.account_move().iter().any(|m| {
        m.organization_id == organization_id
            && m.state == AccountMoveState::Draft
            && matches!(m.move_type, MoveType::OutInvoice | MoveType::OutRefund)
            && m.metadata
                .as_ref()
                .map(|meta| {
                    meta.contains(&format!("\"subscription_id\":{subscription_id}"))
                        && (meta.contains("proration") || meta.contains("amendment"))
                })
                .unwrap_or(false)
    })
}

/// Grant default access entitlement (idempotent if already active).
pub fn grant_default_entitlement(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription: &Subscription,
) -> Result<u64, String> {
    let feature = "subscription.access";
    if let Some(existing) = ctx
        .db
        .subscription_entitlement()
        .subscription_entitlement_by_sub()
        .filter(&subscription.id)
        .find(|e| {
            e.organization_id == organization_id
                && e.feature_code == feature
                && e.status != "revoked"
        })
    {
        if existing.status == "suspended" {
            ctx.db
                .subscription_entitlement()
                .id()
                .update(SubscriptionEntitlement {
                    status: "active".to_string(),
                    revoked_at: None,
                    ..existing.clone()
                });
        }
        return Ok(existing.id);
    }
    let row = ctx
        .db
        .subscription_entitlement()
        .insert(SubscriptionEntitlement {
            id: 0,
            organization_id,
            company_id,
            subscription_id: subscription.id,
            partner_id: subscription.partner_id,
            product_id: None,
            feature_code: feature.to_string(),
            status: "active".to_string(),
            granted_at: ctx.timestamp,
            revoked_at: None,
            created_by: ctx.sender(),
            metadata: String::new(),
        });
    Ok(row.id)
}

pub fn revoke_all_entitlements(
    ctx: &ReducerContext,
    organization_id: u64,
    subscription_id: u64,
) -> u32 {
    let mut n = 0u32;
    let rows: Vec<_> = ctx
        .db
        .subscription_entitlement()
        .subscription_entitlement_by_sub()
        .filter(&subscription_id)
        .filter(|e| e.organization_id == organization_id && e.status != "revoked")
        .collect();
    for e in rows {
        ctx.db
            .subscription_entitlement()
            .id()
            .update(SubscriptionEntitlement {
                status: "revoked".to_string(),
                revoked_at: Some(ctx.timestamp),
                ..e
            });
        n += 1;
    }
    n
}

fn suspend_all_entitlements(
    ctx: &ReducerContext,
    organization_id: u64,
    subscription_id: u64,
) -> u32 {
    let mut n = 0u32;
    let rows: Vec<_> = ctx
        .db
        .subscription_entitlement()
        .subscription_entitlement_by_sub()
        .filter(&subscription_id)
        .filter(|e| e.organization_id == organization_id && e.status == "active")
        .collect();
    for e in rows {
        ctx.db
            .subscription_entitlement()
            .id()
            .update(SubscriptionEntitlement {
                status: "suspended".to_string(),
                ..e
            });
        n += 1;
    }
    n
}

fn payment_intent_types() -> &'static [&'static str] {
    &[
        "card_charge",
        "pix",
        "boleto",
        "paynow",
        "fpx",
        "qris",
        "eft",
    ]
}

// ── Reducers ─────────────────────────────────────────────────────────────────
