//! Subscription collections and dunning reducers.

use spacetimedb::ReducerContext;

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::subscriptions::relations::require_subscription;
use crate::subscriptions::tables::{subscription, subscription_plan, Subscription};

use super::{
    ensure_collection, revoke_all_entitlements, subscription_collection, suspend_all_entitlements,
    AdvanceSubscriptionDunningParams, RecordSubscriptionPaymentFailureParams,
    SubscriptionCollection,
};

#[spacetimedb::reducer]
pub fn record_subscription_payment_failure(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: RecordSubscriptionPaymentFailureParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let sub = require_subscription(ctx, organization_id, company_id, subscription_id)?;
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
    let sub = require_subscription(ctx, organization_id, company_id, subscription_id)?;
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
