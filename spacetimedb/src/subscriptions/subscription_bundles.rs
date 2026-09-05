//! Subscription subscription bundles reducers.

use super::{
    AddSubscriptionBundleItemParams, ApplySubscriptionBundleParams, CreateSubscriptionBundleParams,
};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::subscriptions::relations::require_subscription;
use crate::subscriptions::subscription_wave_d::{
    subscription_bundle, subscription_bundle_item, SubscriptionBundle, SubscriptionBundleItem,
};
use crate::subscriptions::tables::{
    subscription, subscription_line, subscription_plan, Subscription,
};
use spacetimedb::{ReducerContext, Table};

#[spacetimedb::reducer]
pub fn create_subscription_bundle(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateSubscriptionBundleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let plan = ctx
        .db
        .subscription_plan()
        .id()
        .find(&params.plan_id)
        .ok_or("Subscription plan not found")?;
    if plan.organization_id != organization_id || plan.company_id != company_id {
        return Err("Plan does not belong to this company".to_string());
    }
    let code = params.code.trim().to_string();
    let name = params.name.trim().to_string();
    if code.is_empty() || name.is_empty() {
        return Err("name and code are required".to_string());
    }

    let row = ctx.db.subscription_bundle().insert(SubscriptionBundle {
        id: 0,
        organization_id,
        company_id,
        plan_id: params.plan_id,
        name,
        code,
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
            table_name: "subscription_bundle",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "plan_id": params.plan_id, "code": row.code }).to_string(),
            ),
            changed_fields: vec!["plan_id".to_string(), "code".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn add_subscription_bundle_item(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    bundle_id: u64,
    params: AddSubscriptionBundleItemParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let bundle = ctx
        .db
        .subscription_bundle()
        .id()
        .find(&bundle_id)
        .ok_or("Bundle not found")?;
    if bundle.organization_id != organization_id || bundle.company_id != company_id {
        return Err("Bundle does not belong to this company".to_string());
    }
    if params.quantity <= 0.0 {
        return Err("quantity must be > 0".to_string());
    }

    let row = ctx
        .db
        .subscription_bundle_item()
        .insert(SubscriptionBundleItem {
            id: 0,
            organization_id,
            company_id,
            bundle_id,
            product_id: params.product_id,
            name: params.name.trim().to_string(),
            quantity: params.quantity,
            price_unit: params.price_unit,
            is_addon: params.is_addon,
            sequence: params.sequence,
            active: params.active,
            created_at: ctx.timestamp,
            metadata: params.metadata.unwrap_or_default(),
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "subscription_bundle_item",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "bundle_id": bundle_id,
                    "product_id": params.product_id,
                    "quantity": params.quantity,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "bundle_id".to_string(),
                "product_id".to_string(),
                "quantity".to_string(),
            ],
            metadata: None,
        },
    );
    Ok(())
}

/// Materialize bundle items as recurring subscription lines (structured add-ons).
#[spacetimedb::reducer]
pub fn apply_subscription_bundle(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: ApplySubscriptionBundleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let sub = require_subscription(ctx, organization_id, company_id, subscription_id)?;
    let bundle = ctx
        .db
        .subscription_bundle()
        .id()
        .find(&params.bundle_id)
        .ok_or("Bundle not found")?;
    if bundle.organization_id != organization_id || bundle.company_id != company_id {
        return Err("Bundle does not belong to this company".to_string());
    }
    if !bundle.active {
        return Err("Bundle is not active".to_string());
    }
    if bundle.plan_id != sub.plan_id {
        return Err("Bundle plan does not match subscription plan".to_string());
    }

    let items: Vec<_> = ctx
        .db
        .subscription_bundle_item()
        .subscription_bundle_item_by_bundle()
        .filter(&params.bundle_id)
        .filter(|i| i.active)
        .collect();
    if items.is_empty() {
        return Err("Bundle has no active items".to_string());
    }

    let mut line_ids = sub.subscription_line_ids.clone();
    let mut created = Vec::new();
    for item in items {
        let subtotal = item.quantity * item.price_unit;
        let line =
            ctx.db
                .subscription_line()
                .insert(crate::subscriptions::tables::SubscriptionLine {
                    id: 0,
                    organization_id,
                    name: item.name.clone(),
                    subscription_id,
                    product_id: item.product_id,
                    product_uom: 1,
                    product_uom_qty: item.quantity,
                    price_unit: item.price_unit,
                    price_subtotal: subtotal,
                    discount: 0.0,
                    price_tax: 0.0,
                    price_total: subtotal,
                    tax_ids: vec![],
                    company_id,
                    currency_id: sub.currency_id,
                    analytic_account_id: sub.analytic_account_id,
                    analytic_tag_ids: vec![],
                    recurring_rule_type: sub.recurring_rule_type.clone(),
                    recurring_interval: sub.recurring_interval,
                    recurring_next_date: sub.recurring_next_date,
                    recurring_last_date: None,
                    line_is_recurring: true,
                    line_is_prorated: false,
                    line_is_start_date: false,
                    line_is_end_date: false,
                    line_is_trial: false,
                    line_trial_duration: 0,
                    line_trial_unit: "day".to_string(),
                    line_parent_id: None,
                    line_child_ids: vec![],
                    line_is_downpayment: false,
                    line_is_discount: false,
                    line_is_gift: false,
                    line_is_upgrade: false,
                    line_is_downgrade: false,
                    sale_order_line_id: None, // bundle-added lines have no SO origin
                    created_at: ctx.timestamp,
                    updated_at: ctx.timestamp,
                    metadata: serde_json::json!({
                        "bundle_id": params.bundle_id,
                        "bundle_item_id": item.id,
                        "is_addon": item.is_addon,
                    })
                    .to_string(),
                });
        line_ids.push(line.id);
        created.push(line.id);
    }

    ctx.db.subscription().id().update(Subscription {
        subscription_line_ids: line_ids,
        updated_at: ctx.timestamp,
        ..sub
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
                    "bundle_id": params.bundle_id,
                    "line_ids": created,
                })
                .to_string(),
            ),
            changed_fields: vec!["subscription_line_ids".to_string()],
            metadata: Some(
                serde_json::json!({ "applied_bundle_id": params.bundle_id }).to_string(),
            ),
        },
    );
    Ok(())
}
