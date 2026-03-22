/// UTM Tracking — Campaign, Medium, Source
///
/// Backs the `campaign_id`, `medium_id`, `source_id` foreign key fields on:
/// Lead, SaleOrder, Opportunity, AccountMove, Contact.
use spacetimedb::{reducer, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

// ── Tables ────────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = utm_campaign,
    public,
    index(accessor = utm_campaign_by_org, btree(columns = [organization_id]))
)]
pub struct UtmCampaign {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub is_active: bool,
    pub created_at: Timestamp,
}

#[spacetimedb::table(
    accessor = utm_medium,
    public,
    index(accessor = utm_medium_by_org, btree(columns = [organization_id]))
)]
pub struct UtmMedium {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub is_active: bool,
    pub created_at: Timestamp,
}

#[spacetimedb::table(
    accessor = utm_source,
    public,
    index(accessor = utm_source_by_org, btree(columns = [organization_id]))
)]
pub struct UtmSource {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub is_active: bool,
    pub created_at: Timestamp,
}

// ── Input Params ──────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateUtmCampaignParams {
    pub name: String,
    pub is_active: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateUtmCampaignParams {
    pub name: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateUtmMediumParams {
    pub name: String,
    pub is_active: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateUtmMediumParams {
    pub name: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateUtmSourceParams {
    pub name: String,
    pub is_active: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateUtmSourceParams {
    pub name: Option<String>,
    pub is_active: Option<bool>,
}

// ── Reducers: UTM Campaign ────────────────────────────────────────────────────

#[reducer]
pub fn create_utm_campaign(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateUtmCampaignParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "utm", "create")?;
    if params.name.is_empty() {
        return Err("Campaign name cannot be empty".to_string());
    }
    let campaign = ctx.db.utm_campaign().insert(UtmCampaign {
        id: 0,
        organization_id,
        name: params.name,
        is_active: params.is_active,
        created_at: ctx.timestamp,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "utm_campaign",
            record_id: campaign.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn update_utm_campaign(
    ctx: &ReducerContext,
    organization_id: u64,
    campaign_id: u64,
    params: UpdateUtmCampaignParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "utm", "update")?;
    let campaign = ctx
        .db
        .utm_campaign()
        .id()
        .find(&campaign_id)
        .ok_or("Campaign not found")?;
    if campaign.organization_id != organization_id {
        return Err("Campaign belongs to a different organization".to_string());
    }
    ctx.db.utm_campaign().id().update(UtmCampaign {
        name: params.name.unwrap_or(campaign.name),
        is_active: params.is_active.unwrap_or(campaign.is_active),
        ..campaign
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "utm_campaign",
            record_id: campaign_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

// ── Reducers: UTM Medium ──────────────────────────────────────────────────────

#[reducer]
pub fn create_utm_medium(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateUtmMediumParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "utm", "create")?;
    if params.name.is_empty() {
        return Err("Medium name cannot be empty".to_string());
    }
    let medium = ctx.db.utm_medium().insert(UtmMedium {
        id: 0,
        organization_id,
        name: params.name,
        is_active: params.is_active,
        created_at: ctx.timestamp,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "utm_medium",
            record_id: medium.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn update_utm_medium(
    ctx: &ReducerContext,
    organization_id: u64,
    medium_id: u64,
    params: UpdateUtmMediumParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "utm", "update")?;
    let medium = ctx
        .db
        .utm_medium()
        .id()
        .find(&medium_id)
        .ok_or("Medium not found")?;
    if medium.organization_id != organization_id {
        return Err("Medium belongs to a different organization".to_string());
    }
    ctx.db.utm_medium().id().update(UtmMedium {
        name: params.name.unwrap_or(medium.name),
        is_active: params.is_active.unwrap_or(medium.is_active),
        ..medium
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "utm_medium",
            record_id: medium_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

// ── Reducers: UTM Source ──────────────────────────────────────────────────────

#[reducer]
pub fn create_utm_source(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateUtmSourceParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "utm", "create")?;
    if params.name.is_empty() {
        return Err("Source name cannot be empty".to_string());
    }
    let source = ctx.db.utm_source().insert(UtmSource {
        id: 0,
        organization_id,
        name: params.name,
        is_active: params.is_active,
        created_at: ctx.timestamp,
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "utm_source",
            record_id: source.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn update_utm_source(
    ctx: &ReducerContext,
    organization_id: u64,
    source_id: u64,
    params: UpdateUtmSourceParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "utm", "update")?;
    let source = ctx
        .db
        .utm_source()
        .id()
        .find(&source_id)
        .ok_or("Source not found")?;
    if source.organization_id != organization_id {
        return Err("Source belongs to a different organization".to_string());
    }
    ctx.db.utm_source().id().update(UtmSource {
        name: params.name.unwrap_or(source.name),
        is_active: params.is_active.unwrap_or(source.is_active),
        ..source
    });
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "utm_source",
            record_id: source_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}
