//! Subscription pricing tiers and commitments reducers.

use super::{CreateSubscriptionPriceTierParams, SetSubscriptionCommitmentParams};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::subscriptions::relations::require_subscription;
use crate::subscriptions::subscription_wave_d::{
    subscription_commitment, subscription_price_tier, SubscriptionCommitment, SubscriptionPriceTier,
};
use crate::subscriptions::tables::subscription_plan;
use spacetimedb::{ReducerContext, Table};

#[spacetimedb::reducer]
pub fn create_subscription_price_tier(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateSubscriptionPriceTierParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let plan = ctx
        .db
        .subscription_plan()
        .id()
        .find(&params.plan_id)
        .ok_or("Subscription plan not found")?;
    if plan.organization_id != organization_id {
        return Err("Plan does not belong to this organization".to_string());
    }
    if plan.company_id != company_id {
        return Err("Plan does not belong to this company".to_string());
    }
    if params.min_qty < 0.0 || params.unit_price < 0.0 {
        return Err("min_qty and unit_price must be >= 0".to_string());
    }
    if let Some(max) = params.max_qty {
        if max <= params.min_qty {
            return Err("max_qty must be > min_qty".to_string());
        }
    }

    let row = ctx
        .db
        .subscription_price_tier()
        .insert(SubscriptionPriceTier {
            id: 0,
            organization_id,
            company_id,
            plan_id: params.plan_id,
            product_id: params.product_id,
            sequence: params.sequence,
            min_qty: params.min_qty,
            max_qty: params.max_qty,
            unit_price: params.unit_price,
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
            table_name: "subscription_price_tier",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "plan_id": params.plan_id,
                    "min_qty": params.min_qty,
                    "unit_price": params.unit_price,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "plan_id".to_string(),
                "min_qty".to_string(),
                "unit_price".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn set_subscription_commitment(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: SetSubscriptionCommitmentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let _sub = require_subscription(ctx, organization_id, company_id, subscription_id)?;
    if params.min_amount < 0.0 {
        return Err("min_amount must be >= 0".to_string());
    }

    // Upsert: deactivate prior active rows for same product filter, insert new.
    let existing: Vec<_> = ctx
        .db
        .subscription_commitment()
        .subscription_commitment_by_sub()
        .filter(&subscription_id)
        .filter(|c| {
            c.organization_id == organization_id && c.active && c.product_id == params.product_id
        })
        .collect();
    for row in existing {
        ctx.db
            .subscription_commitment()
            .id()
            .update(SubscriptionCommitment {
                active: false,
                updated_at: ctx.timestamp,
                ..row
            });
    }

    let row = ctx
        .db
        .subscription_commitment()
        .insert(SubscriptionCommitment {
            id: 0,
            organization_id,
            company_id,
            subscription_id,
            min_amount: params.min_amount,
            product_id: params.product_id,
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
            table_name: "subscription_commitment",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "subscription_id": subscription_id,
                    "min_amount": params.min_amount,
                    "active": params.active,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "min_amount".to_string(),
                "active".to_string(),
                "subscription_id".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}
