//! Subscription deferred revenue reducers.

use super::{secs, RebaseDeferredSchedulesParams};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::subscriptions::relations::require_subscription;
use crate::subscriptions::tables::{
    deferred_revenue_line, deferred_revenue_schedule, subscription, DeferredRevenueLine,
    DeferredRevenueSchedule,
};
use spacetimedb::{ReducerContext, Table};

#[spacetimedb::reducer]
pub fn rebase_deferred_schedules_for_subscription(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: RebaseDeferredSchedulesParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "deferred_revenue_schedule", "write")?;
    let _sub = require_subscription(ctx, organization_id, company_id, subscription_id)?;
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
