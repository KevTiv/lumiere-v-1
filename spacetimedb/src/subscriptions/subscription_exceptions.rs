//! Subscription exception flags reducers.

use super::{ensure_collection, grant_default_entitlement, has_amend_pending, secs};
use super::{subscription_collection, SubscriptionCollection};
use crate::helpers::check_permission;
use crate::subscriptions::relations::require_subscription;
use crate::subscriptions::tables::{subscription, Subscription};
use spacetimedb::ReducerContext;

/// Refresh due / past-due / amend-pending flags for ops SQL queues.
#[spacetimedb::reducer]
pub fn refresh_subscription_exception_flags(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let sub = require_subscription(ctx, organization_id, company_id, subscription_id)?;
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
