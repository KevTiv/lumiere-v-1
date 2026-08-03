//! Wave E — dunning/collections, customer entitlements, payment/rail intents,
//! pack WHT/e-invoice settle hooks, index-linked pricing, exception flags, rev-rec rebase.

use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::journal_entries::account_move;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::subscriptions::billing_helpers::calculate_next_date;
use crate::subscriptions::tables::{
    deferred_revenue_line, deferred_revenue_schedule, subscription, subscription_line,
    subscription_plan, DeferredRevenueLine, DeferredRevenueSchedule, Subscription,
};
use crate::types::{AccountMoveState, MoveType};

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
pub struct UpsertSubscriptionPriceIndexParams {
    pub index_code: String,
    pub country_code: String,
    pub period_key: String,
    pub factor: f64,
    pub active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ApplyIndexLinkedRenewalParams {
    pub index_code: String,
    pub period_key: String,
    /// When true, also extend next invoice date by one interval.
    pub extend_term: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RebaseDeferredSchedulesParams {
    /// Scale factor for remaining deferred amount (e.g. 1.1 after price uplift).
    pub scale_factor: f64,
    pub notes: Option<String>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn load_sub(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
) -> Result<Subscription, String> {
    let sub = ctx
        .db
        .subscription()
        .id()
        .find(&subscription_id)
        .ok_or("Subscription not found")?;
    if sub.organization_id != organization_id {
        return Err("Subscription does not belong to this organization".to_string());
    }
    if sub.company_id != company_id {
        return Err("Subscription does not belong to this company".to_string());
    }
    Ok(sub)
}

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

#[spacetimedb::reducer]
pub fn record_subscription_payment_failure(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: RecordSubscriptionPaymentFailureParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let sub = load_sub(ctx, organization_id, company_id, subscription_id)?;
    if sub.state == "closed" {
        return Err("Subscription is closed".to_string());
    }

    let mut coll = ensure_collection(ctx, organization_id, company_id, subscription_id);
    let failed = coll.failed_payment_count.saturating_add(1);
    let past_due_days = params.past_due_days.unwrap_or(coll.past_due_days.max(1));
    let stage = if coll.stage == "current" {
        "reminder".to_string()
    } else {
        coll.stage.clone()
    };

    ctx.db
        .subscription_collection()
        .id()
        .update(SubscriptionCollection {
            failed_payment_count: failed,
            past_due_days,
            past_due: true,
            stage,
            last_failure_at: Some(ctx.timestamp),
            last_evaluated_at: ctx.timestamp,
            metadata: serde_json::json!({
                "reason": params.reason,
                "invoice_move_id": params.invoice_move_id,
            })
            .to_string(),
            ..coll.clone()
        });

    ctx.db.subscription().id().update(Subscription {
        health: "at_risk".to_string(),
        updated_at: ctx.timestamp,
        ..sub
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription_collection",
            record_id: coll.id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "failed_payment_count": failed,
                    "past_due_days": past_due_days,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "failed_payment_count".to_string(),
                "past_due".to_string(),
                "health".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn advance_subscription_dunning(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: AdvanceSubscriptionDunningParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let sub = load_sub(ctx, organization_id, company_id, subscription_id)?;
    if sub.state == "closed" {
        return Ok(());
    }

    let plan = ctx
        .db
        .subscription_plan()
        .id()
        .find(&sub.plan_id)
        .ok_or("Subscription plan not found")?;
    let mut coll = ensure_collection(ctx, organization_id, company_id, subscription_id);
    let past_due_days = params.past_due_days.unwrap_or(coll.past_due_days);
    let suspend_after = params.suspend_after_days.unwrap_or(14);

    let mut stage = coll.stage.clone();
    let mut suspended = 0u32;
    let mut closed = false;

    if past_due_days > 0 || coll.failed_payment_count > 0 {
        if stage == "current" {
            stage = "reminder".to_string();
        }
        if past_due_days >= suspend_after || coll.failed_payment_count >= 1 {
            if stage != "closing" && stage != "suspended" {
                stage = "suspended".to_string();
                suspended = suspend_all_entitlements(ctx, organization_id, subscription_id);
                ctx.db.subscription().id().update(Subscription {
                    state: "paused".to_string(),
                    is_active: false,
                    health: "at_risk".to_string(),
                    updated_at: ctx.timestamp,
                    ..sub.clone()
                });
            }
        }
        let limit = plan.auto_close_limit;
        if limit > 0 && coll.failed_payment_count >= limit {
            stage = "closing".to_string();
            let _ = revoke_all_entitlements(ctx, organization_id, subscription_id);
            let current = ctx
                .db
                .subscription()
                .id()
                .find(&subscription_id)
                .unwrap_or(sub.clone());
            ctx.db.subscription().id().update(Subscription {
                state: "closed".to_string(),
                is_active: false,
                health: "churned".to_string(),
                close_date: Some(ctx.timestamp),
                updated_at: ctx.timestamp,
                ..current
            });
            closed = true;
        }
    }

    ctx.db
        .subscription_collection()
        .id()
        .update(SubscriptionCollection {
            stage: stage.clone(),
            past_due_days,
            past_due: past_due_days > 0 || coll.failed_payment_count > 0,
            last_evaluated_at: ctx.timestamp,
            ..coll
        });

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
                    "dunning_stage": stage,
                    "suspended_entitlements": suspended,
                    "auto_closed": closed,
                    "auto_close_limit": plan.auto_close_limit,
                })
                .to_string(),
            ),
            changed_fields: vec!["dunning".to_string(), "health".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn grant_subscription_entitlement(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: GrantSubscriptionEntitlementParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let sub = load_sub(ctx, organization_id, company_id, subscription_id)?;
    let code = params.feature_code.trim().to_string();
    if code.is_empty() {
        return Err("feature_code is required".to_string());
    }
    if let Some(existing) = ctx
        .db
        .subscription_entitlement()
        .subscription_entitlement_by_sub()
        .filter(&subscription_id)
        .find(|e| {
            e.organization_id == organization_id && e.feature_code == code && e.status != "revoked"
        })
    {
        ctx.db
            .subscription_entitlement()
            .id()
            .update(SubscriptionEntitlement {
                status: "active".to_string(),
                product_id: params.product_id.or(existing.product_id),
                revoked_at: None,
                ..existing
            });
        return Ok(());
    }
    let row = ctx
        .db
        .subscription_entitlement()
        .insert(SubscriptionEntitlement {
            id: 0,
            organization_id,
            company_id,
            subscription_id,
            partner_id: sub.partner_id,
            product_id: params.product_id,
            feature_code: code,
            status: "active".to_string(),
            granted_at: ctx.timestamp,
            revoked_at: None,
            created_by: ctx.sender(),
            metadata: params.metadata.unwrap_or_default(),
        });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription_entitlement",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "feature_code": row.feature_code, "status": "active" })
                    .to_string(),
            ),
            changed_fields: vec!["feature_code".to_string(), "status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn revoke_subscription_entitlement(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    entitlement_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let row = ctx
        .db
        .subscription_entitlement()
        .id()
        .find(&entitlement_id)
        .ok_or("Entitlement not found")?;
    if row.organization_id != organization_id || row.company_id != company_id {
        return Err("Entitlement does not belong to this company".to_string());
    }
    ctx.db
        .subscription_entitlement()
        .id()
        .update(SubscriptionEntitlement {
            status: "revoked".to_string(),
            revoked_at: Some(ctx.timestamp),
            ..row.clone()
        });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription_entitlement",
            record_id: entitlement_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "status": row.status }).to_string()),
            new_values: Some(serde_json::json!({ "status": "revoked" }).to_string()),
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn create_subscription_payment_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: CreateSubscriptionPaymentIntentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let sub = load_sub(ctx, organization_id, company_id, subscription_id)?;
    let intent_type = params.intent_type.trim().to_ascii_lowercase();
    if !payment_intent_types().contains(&intent_type.as_str()) {
        return Err("intent_type must be card_charge|pix|boleto|paynow|fpx|qris|eft".to_string());
    }
    let key = params.idempotency_key.trim().to_string();
    if key.is_empty() {
        return Err("idempotency_key is required".to_string());
    }
    if params.amount <= 0.0 {
        return Err("amount must be > 0".to_string());
    }
    if ctx
        .db
        .subscription_payment_intent()
        .idempotency_key()
        .find(&key)
        .is_some()
    {
        return Ok(());
    }

    // Unreliable card markets: prefer draft_invoice fallback when requested or payment_mode says so.
    let fallback = params.fallback_draft_invoice
        || (intent_type == "card_charge" && sub.payment_mode == "draft_invoice");

    let row = ctx
        .db
        .subscription_payment_intent()
        .insert(SubscriptionPaymentIntent {
            id: 0,
            organization_id,
            company_id,
            subscription_id,
            intent_type,
            status: "pending".to_string(),
            idempotency_key: key,
            invoice_move_id: params.invoice_move_id,
            payment_token_id: params.payment_token_id.or(sub.payment_token_id),
            amount: params.amount,
            currency_id: params.currency_id,
            fallback_draft_invoice: fallback,
            last_error: None,
            attempt_count: 0,
            applied_at: None,
            created_at: ctx.timestamp,
            created_by: ctx.sender(),
            metadata: params.metadata.unwrap_or_default(),
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription_payment_intent",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "intent_type": row.intent_type,
                    "fallback_draft_invoice": fallback,
                })
                .to_string(),
            ),
            changed_fields: vec!["intent_type".to_string(), "status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn apply_subscription_payment_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    intent_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let intent = ctx
        .db
        .subscription_payment_intent()
        .id()
        .find(&intent_id)
        .ok_or("Payment intent not found")?;
    if intent.organization_id != organization_id || intent.company_id != company_id {
        return Err("Intent does not belong to this company".to_string());
    }
    if intent.status == "succeeded" {
        return Ok(());
    }

    // Worker already charged externally; reducer only records success + clears dunning.
    ctx.db
        .subscription_payment_intent()
        .id()
        .update(SubscriptionPaymentIntent {
            status: "succeeded".to_string(),
            applied_at: Some(ctx.timestamp),
            attempt_count: intent.attempt_count.saturating_add(1),
            last_error: None,
            ..intent.clone()
        });

    let sub = load_sub(ctx, organization_id, company_id, intent.subscription_id)?;
    let _ = grant_default_entitlement(ctx, organization_id, company_id, &sub)?;
    let mut coll = ensure_collection(ctx, organization_id, company_id, intent.subscription_id);
    ctx.db
        .subscription_collection()
        .id()
        .update(SubscriptionCollection {
            stage: "current".to_string(),
            failed_payment_count: 0,
            past_due_days: 0,
            past_due: false,
            last_evaluated_at: ctx.timestamp,
            ..coll
        });
    ctx.db.subscription().id().update(Subscription {
        health: "healthy".to_string(),
        updated_at: ctx.timestamp,
        ..sub
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription_payment_intent",
            record_id: intent_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "status": intent.status }).to_string()),
            new_values: Some(serde_json::json!({ "status": "succeeded" }).to_string()),
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn fail_subscription_payment_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    intent_id: u64,
    params: FailSubscriptionPaymentIntentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let intent = ctx
        .db
        .subscription_payment_intent()
        .id()
        .find(&intent_id)
        .ok_or("Payment intent not found")?;
    if intent.organization_id != organization_id || intent.company_id != company_id {
        return Err("Intent does not belong to this company".to_string());
    }
    ctx.db
        .subscription_payment_intent()
        .id()
        .update(SubscriptionPaymentIntent {
            status: "failed".to_string(),
            last_error: Some(params.last_error.clone()),
            attempt_count: intent.attempt_count.saturating_add(1),
            ..intent.clone()
        });

    if params.record_dunning_failure {
        record_subscription_payment_failure(
            ctx,
            organization_id,
            company_id,
            intent.subscription_id,
            RecordSubscriptionPaymentFailureParams {
                invoice_move_id: intent.invoice_move_id,
                reason: Some(params.last_error),
                past_due_days: None,
            },
        )?;
    }
    Ok(())
}

#[spacetimedb::reducer]
pub fn create_subscription_tax_settle_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: CreateSubscriptionTaxSettleIntentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let _sub = load_sub(ctx, organization_id, company_id, subscription_id)?;
    let intent_type = params.intent_type.trim().to_ascii_lowercase();
    if intent_type != "wht" && intent_type != "e_invoice" {
        return Err("intent_type must be wht|e_invoice".to_string());
    }
    let key = params.idempotency_key.trim().to_string();
    if key.is_empty() {
        return Err("idempotency_key is required".to_string());
    }
    if ctx
        .db
        .subscription_tax_settle_intent()
        .idempotency_key()
        .find(&key)
        .is_some()
    {
        return Ok(());
    }
    let _inv = ctx
        .db
        .account_move()
        .id()
        .find(&params.invoice_move_id)
        .ok_or("Invoice not found")?;

    let row = ctx
        .db
        .subscription_tax_settle_intent()
        .insert(SubscriptionTaxSettleIntent {
            id: 0,
            organization_id,
            company_id,
            subscription_id,
            intent_type,
            status: "pending".to_string(),
            idempotency_key: key,
            invoice_move_id: params.invoice_move_id,
            payment_id: params.payment_id,
            pack_code: params.pack_code.trim().to_ascii_lowercase(),
            payload: params.payload,
            last_error: None,
            applied_at: None,
            created_at: ctx.timestamp,
            created_by: ctx.sender(),
            metadata: params.metadata.unwrap_or_default(),
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription_tax_settle_intent",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "intent_type": row.intent_type,
                    "pack_code": row.pack_code,
                })
                .to_string(),
            ),
            changed_fields: vec!["intent_type".to_string(), "status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn apply_subscription_tax_settle_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    intent_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let intent = ctx
        .db
        .subscription_tax_settle_intent()
        .id()
        .find(&intent_id)
        .ok_or("Tax settle intent not found")?;
    if intent.organization_id != organization_id || intent.company_id != company_id {
        return Err("Intent does not belong to this company".to_string());
    }
    if intent.status == "applied" {
        return Ok(());
    }
    // Worker performed external WHT/e-invoice; stamp move metadata.
    if let Some(mut mv) = ctx.db.account_move().id().find(&intent.invoice_move_id) {
        let mut meta = serde_json::Map::new();
        if let Some(raw) = &mv.metadata {
            if let Ok(serde_json::Value::Object(obj)) = serde_json::from_str(raw) {
                meta = obj;
            }
        }
        meta.insert(
            intent.intent_type.clone(),
            serde_json::json!({
                "pack_code": intent.pack_code,
                "intent_id": intent.id,
                "payment_id": intent.payment_id,
                "applied_at": secs(ctx.timestamp),
            }),
        );
        mv.metadata = Some(serde_json::Value::Object(meta).to_string());
        ctx.db.account_move().id().update(mv);
    }
    ctx.db
        .subscription_tax_settle_intent()
        .id()
        .update(SubscriptionTaxSettleIntent {
            status: "applied".to_string(),
            applied_at: Some(ctx.timestamp),
            ..intent.clone()
        });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription_tax_settle_intent",
            record_id: intent_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "status": intent.status }).to_string()),
            new_values: Some(serde_json::json!({ "status": "applied" }).to_string()),
            changed_fields: vec!["status".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn upsert_subscription_price_index(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: UpsertSubscriptionPriceIndexParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let index_code = params.index_code.trim().to_ascii_uppercase();
    let country = params.country_code.trim().to_ascii_lowercase();
    let period = params.period_key.trim().to_string();
    if index_code.is_empty() || period.is_empty() {
        return Err("index_code and period_key are required".to_string());
    }
    if params.factor <= 0.0 {
        return Err("factor must be > 0".to_string());
    }

    if let Some(existing) = ctx
        .db
        .subscription_price_index()
        .subscription_price_index_by_code()
        .filter(&index_code)
        .find(|r| {
            r.organization_id == organization_id
                && r.company_id == company_id
                && r.country_code == country
                && r.period_key == period
        })
    {
        ctx.db
            .subscription_price_index()
            .id()
            .update(SubscriptionPriceIndex {
                factor: params.factor,
                active: params.active,
                updated_at: ctx.timestamp,
                metadata: params.metadata.unwrap_or(existing.metadata.clone()),
                ..existing.clone()
            });
        return Ok(());
    }

    let row = ctx
        .db
        .subscription_price_index()
        .insert(SubscriptionPriceIndex {
            id: 0,
            organization_id,
            company_id,
            index_code,
            country_code: country,
            period_key: period,
            factor: params.factor,
            active: params.active,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            metadata: params.metadata.unwrap_or_default(),
        });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription_price_index",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "index_code": row.index_code,
                    "period_key": row.period_key,
                    "factor": row.factor,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "index_code".to_string(),
                "period_key".to_string(),
                "factor".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

/// Apply CPI/IPCA factor to recurring line prices at renewal boundary.
#[spacetimedb::reducer]
pub fn apply_index_linked_renewal(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: ApplyIndexLinkedRenewalParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let sub = load_sub(ctx, organization_id, company_id, subscription_id)?;
    if sub.state != "active" && sub.state != "paused" {
        return Err("Subscription must be active or paused".to_string());
    }
    let index_code = params.index_code.trim().to_ascii_uppercase();
    let period = params.period_key.trim().to_string();
    let idx = ctx
        .db
        .subscription_price_index()
        .subscription_price_index_by_code()
        .filter(&index_code)
        .find(|r| {
            r.organization_id == organization_id
                && r.company_id == company_id
                && r.period_key == period
                && r.active
        })
        .ok_or("Active price index not found for period")?;

    let lines: Vec<_> = ctx
        .db
        .subscription_line()
        .subscription_line_by_subscription()
        .filter(&subscription_id)
        .filter(|l| l.organization_id == organization_id && l.line_is_recurring)
        .collect();
    for line in lines {
        let new_price = line.price_unit * idx.factor;
        let qty = if line.product_uom_qty > 0.0 {
            line.product_uom_qty
        } else {
            1.0
        };
        let subtotal = qty * new_price * (1.0 - line.discount / 100.0);
        ctx.db
            .subscription_line()
            .id()
            .update(crate::subscriptions::tables::SubscriptionLine {
                price_unit: new_price,
                price_subtotal: subtotal,
                price_total: subtotal,
                updated_at: ctx.timestamp,
                metadata: {
                    let mut meta = serde_json::Map::new();
                    if let Ok(serde_json::Value::Object(obj)) = serde_json::from_str(&line.metadata)
                    {
                        meta = obj;
                    }
                    meta.insert("index_code".into(), serde_json::json!(index_code));
                    meta.insert("index_period".into(), serde_json::json!(period));
                    meta.insert("index_factor".into(), serde_json::json!(idx.factor));
                    serde_json::Value::Object(meta).to_string()
                },
                ..line
            });
    }

    let mut next = sub.recurring_next_date;
    if params.extend_term {
        next = calculate_next_date(next, &sub.recurring_rule_type, sub.recurring_interval)?;
    }
    ctx.db.subscription().id().update(Subscription {
        recurring_next_date: next,
        updated_at: ctx.timestamp,
        ..sub
    });

    // Rebase open deferred schedules by same factor.
    let _ = rebase_deferred_schedules_for_subscription(
        ctx,
        organization_id,
        company_id,
        subscription_id,
        RebaseDeferredSchedulesParams {
            scale_factor: idx.factor,
            notes: Some(format!("index {index_code} {period}")),
        },
    );

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
                    "index_code": index_code,
                    "period_key": period,
                    "factor": idx.factor,
                })
                .to_string(),
            ),
            changed_fields: vec!["price_unit".to_string(), "recurring_next_date".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn rebase_deferred_schedules_for_subscription(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: RebaseDeferredSchedulesParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "deferred_revenue_schedule", "write")?;
    let _sub = load_sub(ctx, organization_id, company_id, subscription_id)?;
    if params.scale_factor <= 0.0 {
        return Err("scale_factor must be > 0".to_string());
    }

    // Schedules linked via origin invoice on this subscription.
    let invoice_ids: Vec<u64> = ctx
        .db
        .subscription()
        .id()
        .find(&subscription_id)
        .map(|s| s.invoice_ids)
        .unwrap_or_default();

    let schedules: Vec<DeferredRevenueSchedule> = ctx
        .db
        .deferred_revenue_schedule()
        .iter()
        .filter(|s| {
            s.organization_id == organization_id
                && s.company_id == company_id
                && s.state != "cancelled"
                && s.state != "finished"
                && s.origin_move_id
                    .map(|id| invoice_ids.contains(&id))
                    .unwrap_or(false)
        })
        .collect();

    for sched in schedules {
        let new_total = sched.total_amount * params.scale_factor;
        let new_deferred = sched.deferred_amount * params.scale_factor;
        let recognized = new_total - new_deferred;
        ctx.db
            .deferred_revenue_schedule()
            .id()
            .update(DeferredRevenueSchedule {
                total_amount: new_total,
                deferred_amount: new_deferred,
                recognized_amount: recognized.max(0.0),
                notes: params
                    .notes
                    .clone()
                    .unwrap_or_else(|| format!("rebased x{}", params.scale_factor)),
                metadata: {
                    let mut meta = serde_json::Map::new();
                    if let Ok(serde_json::Value::Object(obj)) =
                        serde_json::from_str(&sched.metadata)
                    {
                        meta = obj;
                    }
                    meta.insert(
                        "rebased_factor".into(),
                        serde_json::json!(params.scale_factor),
                    );
                    meta.insert("rebased_at".into(), serde_json::json!(secs(ctx.timestamp)));
                    serde_json::Value::Object(meta).to_string()
                },
                ..sched.clone()
            });

        let lines: Vec<DeferredRevenueLine> = ctx
            .db
            .deferred_revenue_line()
            .iter()
            .filter(|l| l.schedule_id == sched.id && !l.recognized)
            .collect();
        for line in lines {
            ctx.db
                .deferred_revenue_line()
                .id()
                .update(DeferredRevenueLine {
                    amount: line.amount * params.scale_factor,
                    ..line
                });
        }
    }

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
                serde_json::json!({ "scale_factor": params.scale_factor }).to_string(),
            ),
            changed_fields: vec!["deferred_revenue_rebase".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Refresh due / past-due / amend-pending flags for ops SQL queues.
#[spacetimedb::reducer]
pub fn refresh_subscription_exception_flags(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let sub = load_sub(ctx, organization_id, company_id, subscription_id)?;
    let now = secs(ctx.timestamp);
    let next = secs(sub.recurring_next_date);
    let due_to_bill = sub.state == "active" && next <= now;
    let amend_pending = has_amend_pending(ctx, organization_id, subscription_id);
    let mut coll = ensure_collection(ctx, organization_id, company_id, subscription_id);
    let past_due = coll.past_due || coll.failed_payment_count > 0 || sub.health == "at_risk";

    ctx.db
        .subscription_collection()
        .id()
        .update(SubscriptionCollection {
            due_to_bill,
            past_due,
            amend_pending,
            last_evaluated_at: ctx.timestamp,
            ..coll
        });
    Ok(())
}

/// Clear dunning after successful AR payment (called from pay_subscription_invoice).
pub fn on_subscription_payment_cleared(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription: &Subscription,
) -> Result<(), String> {
    let _ = grant_default_entitlement(ctx, organization_id, company_id, subscription)?;
    let mut coll = ensure_collection(ctx, organization_id, company_id, subscription.id);
    ctx.db
        .subscription_collection()
        .id()
        .update(SubscriptionCollection {
            stage: "current".to_string(),
            failed_payment_count: 0,
            past_due_days: 0,
            past_due: false,
            last_evaluated_at: ctx.timestamp,
            ..coll
        });
    if subscription.health != "healthy" {
        ctx.db.subscription().id().update(Subscription {
            health: "healthy".to_string(),
            updated_at: ctx.timestamp,
            ..subscription.clone()
        });
    }
    Ok(())
}
