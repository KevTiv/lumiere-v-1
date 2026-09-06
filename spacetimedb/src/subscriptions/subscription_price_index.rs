//! Subscription price-index maintenance and index-linked renewal.

use spacetimedb::{ReducerContext, SpacetimeType, Table};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::subscriptions::billing_helpers::calculate_next_date;
use crate::subscriptions::relations::require_subscription;
use crate::subscriptions::subscription_wave_e::subscription_price_index;
use crate::subscriptions::tables::{subscription, subscription_line, Subscription};

use super::{
    rebase_deferred_schedules_for_subscription, RebaseDeferredSchedulesParams,
    SubscriptionPriceIndex,
};

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
    let sub = require_subscription(ctx, organization_id, company_id, subscription_id)?;
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
