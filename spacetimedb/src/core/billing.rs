/// Platform billing and entitlements (Lumiere SaaS plans — not customer subscription billing).
use spacetimedb::{ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::{organization_settings, OrganizationSettings};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

// ── Tables ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
#[spacetimedb::table(
    accessor = billing_account,
    public,
    index(accessor = billing_account_by_org, btree(columns = [organization_id]))
)]
pub struct BillingAccount {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    /// free | pilot | pro
    pub plan_tier: String,
    pub seat_count: u32,
    /// active | trial | suspended
    pub status: String,
    pub trial_ends_at: Option<Timestamp>,
    pub metadata: Option<String>,
    pub create_uid: spacetimedb::Identity,
    pub create_date: Timestamp,
    pub write_uid: spacetimedb::Identity,
    pub write_date: Timestamp,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateBillingAccountParams {
    pub plan_tier: String,
    pub seat_count: u32,
    pub status: String,
    pub trial_ends_at: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateBillingAccountParams {
    pub plan_tier: Option<String>,
    pub seat_count: Option<u32>,
    pub status: Option<String>,
    pub trial_ends_at: Option<Timestamp>,
    pub metadata: Option<String>,
}

fn feature_flags_for_plan(plan_tier: &str) -> Vec<String> {
    match plan_tier.trim().to_ascii_lowercase().as_str() {
        "pro" => vec![
            "ai".into(),
            "crm".into(),
            "sales".into(),
            "accounting".into(),
            "inventory".into(),
            "purchasing".into(),
            "manufacturing".into(),
            "reports".into(),
        ],
        "pilot" => vec![
            "ai".into(),
            "crm".into(),
            "sales".into(),
            "accounting".into(),
            "inventory".into(),
            "purchasing".into(),
        ],
        _ => vec!["crm".into(), "sales".into()],
    }
}

fn sync_org_feature_flags(ctx: &ReducerContext, organization_id: u64, plan_tier: &str) -> Result<(), String> {
    let flags = feature_flags_for_plan(plan_tier);
    if let Some(settings) = ctx.db.organization_settings().organization_id().find(&organization_id) {
        ctx.db.organization_settings().organization_id().update(OrganizationSettings {
            feature_flags: flags,
            updated_at: ctx.timestamp,
            ..settings
        });
    } else {
        ctx.db.organization_settings().insert(OrganizationSettings {
            organization_id,
            module_config: None,
            feature_flags: flags,
            integration_keys: None,
            updated_at: ctx.timestamp,
            metadata: None,
        });
    }
    Ok(())
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn create_billing_account(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateBillingAccountParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "organization", "write")?;

    if ctx
        .db
        .billing_account()
        .billing_account_by_org()
        .filter(&organization_id)
        .next()
        .is_some()
    {
        return Err("Billing account already exists for this organization".to_string());
    }

    let row = ctx.db.billing_account().insert(BillingAccount {
        id: 0,
        organization_id,
        plan_tier: params.plan_tier.clone(),
        seat_count: params.seat_count,
        status: params.status.clone(),
        trial_ends_at: params.trial_ends_at,
        metadata: params.metadata,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    sync_org_feature_flags(ctx, organization_id, &params.plan_tier)?;

    write_audit_log_v2(ctx, organization_id, AuditLogParams {
        company_id: None,
        table_name: "billing_account",
        record_id: row.id,
        action: "CREATE",
        old_values: None,
        new_values: Some(
            serde_json::json!({
                "plan_tier": params.plan_tier,
                "seat_count": params.seat_count,
                "status": params.status,
            })
            .to_string(),
        ),
        changed_fields: vec![
            "plan_tier".to_string(),
            "seat_count".to_string(),
            "status".to_string(),
        ],
        metadata: None,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_billing_account(
    ctx: &ReducerContext,
    organization_id: u64,
    billing_account_id: u64,
    params: UpdateBillingAccountParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "organization", "write")?;

    let existing = ctx
        .db
        .billing_account()
        .id()
        .find(&billing_account_id)
        .ok_or("Billing account not found")?;

    if existing.organization_id != organization_id {
        return Err("Billing account does not belong to this organization".to_string());
    }

    let plan_tier = params.plan_tier.clone().unwrap_or(existing.plan_tier.clone());
    let updated = ctx.db.billing_account().id().update(BillingAccount {
        plan_tier: plan_tier.clone(),
        seat_count: params.seat_count.unwrap_or(existing.seat_count),
        status: params.status.clone().unwrap_or(existing.status.clone()),
        trial_ends_at: params.trial_ends_at.or(existing.trial_ends_at),
        metadata: params.metadata.or(existing.metadata),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..existing
    });

    if params.plan_tier.is_some() {
        sync_org_feature_flags(ctx, organization_id, &plan_tier)?;
    }

    let mut changed_fields = Vec::new();
    if params.plan_tier.is_some() {
        changed_fields.push("plan_tier".to_string());
    }
    if params.seat_count.is_some() {
        changed_fields.push("seat_count".to_string());
    }
    if params.status.is_some() {
        changed_fields.push("status".to_string());
    }

    write_audit_log_v2(ctx, organization_id, AuditLogParams {
        company_id: None,
        table_name: "billing_account",
        record_id: updated.id,
        action: "UPDATE",
        old_values: None,
        new_values: Some(
            serde_json::json!({
                "plan_tier": updated.plan_tier,
                "seat_count": updated.seat_count,
                "status": updated.status,
            })
            .to_string(),
        ),
        changed_fields,
        metadata: None,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn set_billing_status(
    ctx: &ReducerContext,
    organization_id: u64,
    billing_account_id: u64,
    status: String,
) -> Result<(), String> {
    update_billing_account(
        ctx,
        organization_id,
        billing_account_id,
        UpdateBillingAccountParams {
            plan_tier: None,
            seat_count: None,
            status: Some(status),
            trial_ends_at: None,
            metadata: None,
        },
    )
}
