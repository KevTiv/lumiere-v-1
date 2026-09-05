//! Subscription usage ingestion and rating reducers.

use super::{
    rate_quantity_progressive, tiers_for_plan_product, usage_idempotency_key,
    IngestSubscriptionUsageEventParams, RateSubscriptionUsageEventsParams,
};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::subscriptions::relations::require_subscription;
use crate::subscriptions::subscription_wave_d::{
    subscription_usage_charge, subscription_usage_event, SubscriptionUsageCharge,
    SubscriptionUsageEvent,
};
use spacetimedb::{ReducerContext, Table};

#[spacetimedb::reducer]
pub fn ingest_subscription_usage_event(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: IngestSubscriptionUsageEventParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let _sub = require_subscription(ctx, organization_id, company_id, subscription_id)?;

    let source = params.source.trim().to_string();
    let event_id = params.event_id.trim().to_string();
    if source.is_empty() || event_id.is_empty() {
        return Err("source and event_id are required".to_string());
    }
    if params.quantity <= 0.0 {
        return Err("quantity must be > 0".to_string());
    }

    let key = usage_idempotency_key(organization_id, &source, &event_id);
    if ctx
        .db
        .subscription_usage_event()
        .idempotency_key()
        .find(&key)
        .is_some()
    {
        // Idempotent no-op
        return Ok(());
    }

    let row = ctx
        .db
        .subscription_usage_event()
        .insert(SubscriptionUsageEvent {
            id: 0,
            organization_id,
            company_id,
            subscription_id,
            source,
            event_id,
            idempotency_key: key,
            product_id: params.product_id,
            quantity: params.quantity,
            unit: if params.unit.trim().is_empty() {
                "unit".to_string()
            } else {
                params.unit.trim().to_string()
            },
            occurred_at: params.occurred_at.unwrap_or(ctx.timestamp),
            status: "pending".to_string(),
            rated_charge_id: None,
            created_at: ctx.timestamp,
            created_by: ctx.sender(),
            metadata: params.metadata.unwrap_or_default(),
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription_usage_event",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "subscription_id": subscription_id,
                    "quantity": params.quantity,
                    "status": "pending",
                })
                .to_string(),
            ),
            changed_fields: vec![
                "subscription_id".to_string(),
                "quantity".to_string(),
                "status".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn rate_subscription_usage_events(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: RateSubscriptionUsageEventsParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let sub = require_subscription(ctx, organization_id, company_id, subscription_id)?;
    let limit = params.limit.clamp(1, 500) as usize;
    let fallback = params.fallback_unit_price.unwrap_or(0.0);

    let pending: Vec<SubscriptionUsageEvent> = ctx
        .db
        .subscription_usage_event()
        .subscription_usage_event_by_sub()
        .filter(&subscription_id)
        .filter(|e| e.organization_id == organization_id && e.status == "pending")
        .take(limit)
        .collect();

    let mut rated = 0u32;
    for event in pending {
        let tiers = tiers_for_plan_product(ctx, organization_id, sub.plan_id, event.product_id);
        let (amount, unit_price, band) = if tiers.is_empty() {
            if fallback <= 0.0 {
                return Err(format!(
                    "no price tiers for plan {} and fallback_unit_price missing for event {}",
                    sub.plan_id, event.id
                ));
            }
            (
                event.quantity * fallback,
                fallback,
                format!("flat@{}", fallback),
            )
        } else {
            let (amt, avg, band) = rate_quantity_progressive(&tiers, event.quantity);
            if amt <= 0.0 && fallback > 0.0 {
                (
                    event.quantity * fallback,
                    fallback,
                    format!("flat@{}", fallback),
                )
            } else {
                (amt, avg, band)
            }
        };

        let charge = ctx
            .db
            .subscription_usage_charge()
            .insert(SubscriptionUsageCharge {
                id: 0,
                organization_id,
                company_id,
                subscription_id,
                usage_event_id: Some(event.id),
                product_id: event.product_id,
                quantity: event.quantity,
                unit_price,
                amount,
                tier_band: band,
                status: "unbilled".to_string(),
                invoice_move_id: None,
                billing_run_key: None,
                description: format!("Usage {} {}", event.source, event.event_id),
                created_at: ctx.timestamp,
                created_by: ctx.sender(),
                metadata: serde_json::json!({ "usage_event_id": event.id }).to_string(),
            });

        ctx.db
            .subscription_usage_event()
            .id()
            .update(SubscriptionUsageEvent {
                status: "rated".to_string(),
                rated_charge_id: Some(charge.id),
                ..event
            });
        rated += 1;
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
            new_values: Some(serde_json::json!({ "rated_events": rated }).to_string()),
            changed_fields: vec!["usage_rating".to_string()],
            metadata: Some(
                serde_json::json!({ "rated_events": rated, "limit": limit }).to_string(),
            ),
        },
    );
    Ok(())
}
