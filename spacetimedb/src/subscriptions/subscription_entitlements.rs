//! Subscription entitlement reducers.

use super::GrantSubscriptionEntitlementParams;
use super::{subscription_entitlement, SubscriptionEntitlement};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::subscriptions::relations::require_subscription;
use spacetimedb::{ReducerContext, Table};

#[spacetimedb::reducer]
pub fn grant_subscription_entitlement(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    params: GrantSubscriptionEntitlementParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "subscription", "write")?;
    let sub = require_subscription(ctx, organization_id, company_id, subscription_id)?;
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
