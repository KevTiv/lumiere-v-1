/// Leads Module — Lead Management
///
/// Tables:
///   - Lead
///   - LeadSource
///   - LeadLostReason
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::{company_id_from_scope, default_company_id_for_organization};
use crate::core::utm::{utm_campaign, utm_medium};
use crate::crm::contacts::{contact, contact_tag, Contact};
use crate::crm::lead_scoring::mark_lead_score_stale;
use crate::crm::opportunities::{opp_stage, opportunity, Opportunity};
use crate::crm::require_single_company_crm_scope;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

// ══════════════════════════════════════════════════════════════════════════════
// PARAMS TYPES
// ══════════════════════════════════════════════════════════════════════════════

/// Params for creating a lead.
/// Scope: `organization_id` is a flat reducer param (not in this struct).
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateLeadParams {
    pub name: String,
    pub priority: String,
    pub state: String, // "new", "qualified", "converted", "lost"
    pub expected_revenue: f64,
    pub probability: f64,
    pub tag_ids: Vec<u64>,
    // Contact details
    pub email: Option<String>,
    pub phone: Option<String>,
    pub mobile: Option<String>,
    pub company_name: Option<String>,
    pub contact_name: Option<String>,
    pub title: Option<String>,
    // Address fields
    pub street: Option<String>,
    pub city: Option<String>,
    pub zip: Option<String>,
    pub country_code: Option<String>,
    // Business details
    pub website: Option<String>,
    pub industry: Option<String>,
    // Lead source tracking
    pub source_id: Option<u64>,
    pub campaign_id: Option<u64>,
    pub medium_id: Option<u64>,
    pub referred_by: Option<String>,
    pub description: Option<String>,
    // Assignment fields
    pub user_id: Option<Identity>,
    pub stage_id: Option<u64>,
    pub team_id: Option<u64>,
    pub partner_id: Option<u64>,
    pub date_deadline: Option<Timestamp>,
    pub metadata: Option<String>,
}

/// Params for updating lead details.
/// Scope: `organization_id` + `lead_id` are flat reducer params.
/// None = clear the field (all fields are nullable in the table).
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateLeadDetailsParams {
    pub contact_name: Option<String>,
    pub title: Option<String>,
    pub website: Option<String>,
    pub industry: Option<String>,
    pub referred_by: Option<String>,
    pub description: Option<String>,
}

/// Params for updating lead address.
/// Scope: `organization_id` + `lead_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateLeadAddressParams {
    pub street: Option<String>,
    pub city: Option<String>,
    pub zip: Option<String>,
    pub country_code: Option<String>,
}

/// Params for updating lead revenue forecast.
/// Scope: `organization_id` + `lead_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateLeadRevenueParams {
    pub expected_revenue: f64,
    pub probability: f64,
}

/// Params for atomically patching a lead's details, address, and revenue
/// forecast in one reducer call (CRM-RI-004). Replaces the three independent
/// `update_lead_details` / `update_lead_address` / `update_lead_revenue`
/// calls for callers that adopt the atomic contract.
///
/// Explicit patch contract (CRM-RI-003): every nullable `Lead` field uses
/// `Option<Option<T>>` — outer `None` = field not sent (leave unchanged),
/// outer `Some(None)` = explicit clear, outer `Some(Some(v))` = replace with
/// `v`. `expected_revenue`/`probability` are never null on `Lead`, so they
/// use plain `Option<T>` (`None` = unchanged, `Some(v)` = replace).
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateLeadParams {
    pub contact_name: Option<Option<String>>,
    pub title: Option<Option<String>>,
    pub website: Option<Option<String>>,
    pub industry: Option<Option<String>>,
    pub referred_by: Option<Option<String>>,
    pub description: Option<Option<String>>,
    pub street: Option<Option<String>>,
    pub city: Option<Option<String>>,
    pub zip: Option<Option<String>>,
    pub country_code: Option<Option<String>>,
    pub expected_revenue: Option<f64>,
    pub probability: Option<f64>,
    pub stage_id: Option<Option<u64>>,
    pub team_id: Option<Option<u64>>,
}

/// Params for converting a lead to a contact/opportunity.
/// Scope: `organization_id` + `lead_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct ConvertLeadParams {
    pub create_contact: bool,
    pub create_opportunity: bool,
    /// Operating company for contact/opportunity; falls back to org default when None.
    pub company_id: Option<u64>,
    // Contact creation options (used when create_contact is true)
    pub contact_type: Option<String>,
    pub is_vendor: Option<bool>,
    pub is_employee: Option<bool>,
    pub is_prospect: Option<bool>,
    pub is_partner: Option<bool>,
    pub customer_rank: Option<i32>,
    pub supplier_rank: Option<i32>,
    // Opportunity creation (used when create_opportunity is true; required if create_opportunity)
    pub opportunity_stage_id: Option<u64>,
    pub metadata: Option<String>,
}

/// Params for creating a lead source.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateLeadSourceParams {
    pub name: String,
    pub description: Option<String>,
    pub sequence: i32,
    pub is_active: bool,
    pub metadata: Option<String>,
}

/// Params for updating a lead source. `None` = keep existing value.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateLeadSourceParams {
    pub name: Option<String>,
    pub description: Option<String>,
    pub sequence: Option<i32>,
    pub is_active: Option<bool>,
    pub metadata: Option<String>,
}

/// Params for creating a lead lost reason.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateLeadLostReasonParams {
    pub name: String,
    pub description: Option<String>,
    pub is_active: bool,
    pub metadata: Option<String>,
}

/// Params for updating a lead lost reason. `None` = keep existing value.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateLeadLostReasonParams {
    pub name: Option<String>,
    pub description: Option<String>,
    pub is_active: Option<bool>,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// TABLES: LEADS
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = lead,
    index(accessor = lead_by_org, btree(columns = [organization_id])),
    index(accessor = lead_by_email, btree(columns = [email])),
    index(accessor = lead_by_state, btree(columns = [state]))
)]
#[derive(Clone)]
pub struct Lead {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub mobile: Option<String>,
    pub company_name: Option<String>,
    pub contact_name: Option<String>,
    pub title: Option<String>,
    pub street: Option<String>,
    pub city: Option<String>,
    pub zip: Option<String>,
    pub country_code: Option<String>,
    pub website: Option<String>,
    pub industry: Option<String>,
    pub source_id: Option<u64>,
    pub campaign_id: Option<u64>,
    pub medium_id: Option<u64>,
    pub referred_by: Option<String>,
    pub description: Option<String>,
    pub priority: String,
    pub state: String, // "new", "qualified", "converted", "lost"
    pub expected_revenue: f64,
    pub probability: f64,
    pub date_open: Option<Timestamp>,
    pub date_close: Option<Timestamp>,
    pub date_deadline: Option<Timestamp>,
    pub date_conversion: Option<Timestamp>,
    pub date_last_stage_update: Option<Timestamp>,
    pub user_id: Option<Identity>,
    pub stage_id: Option<u64>,
    pub team_id: Option<u64>,
    pub partner_id: Option<u64>,
    pub day_open: Option<i32>,
    pub day_close: Option<i32>,
    pub lost_reason_id: Option<u64>,
    pub tag_ids: Vec<u64>,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub deleted_at: Option<Timestamp>,
    pub metadata: Option<String>,
}

/// Organization-scoped sales team used for lead assignment.
#[spacetimedb::table(
    accessor = crm_team,
    index(accessor = crm_team_by_org, btree(columns = [organization_id]))
)]
pub struct CrmTeam {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = lead_source,
    index(accessor = source_by_org, btree(columns = [organization_id]))
)]
pub struct LeadSource {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub description: Option<String>,
    pub sequence: i32,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = lead_lost_reason,
    index(accessor = lost_reason_by_org, btree(columns = [organization_id]))
)]
pub struct LeadLostReason {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub description: Option<String>,
    pub is_active: bool,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// RELATION VALIDATION HELPERS (CRM-RI-002)
// ══════════════════════════════════════════════════════════════════════════════
//
// Scoped loaders for every relation a lead can reference. Each loader rejects
// a missing row, a row from a different organization, and (where the target
// table tracks it) an inactive/deleted row. Keep error messages specific to
// the relation that failed.

/// Validates `source_id` against `LeadSource`: must exist, belong to the
/// organization, and be active.
fn validate_lead_source(
    ctx: &ReducerContext,
    organization_id: u64,
    source_id: u64,
) -> Result<(), String> {
    let source = ctx
        .db
        .lead_source()
        .id()
        .find(&source_id)
        .ok_or("lead source not found")?;
    if source.organization_id != organization_id {
        return Err("lead source does not belong to this organization".to_string());
    }
    if !source.is_active {
        return Err("lead source is not active".to_string());
    }
    Ok(())
}

/// Validates `campaign_id` against `UtmCampaign`: must exist, belong to the
/// organization, and be active.
fn validate_lead_campaign(
    ctx: &ReducerContext,
    organization_id: u64,
    campaign_id: u64,
) -> Result<(), String> {
    let campaign = ctx
        .db
        .utm_campaign()
        .id()
        .find(&campaign_id)
        .ok_or("campaign not found")?;
    if campaign.organization_id != organization_id {
        return Err("campaign does not belong to this organization".to_string());
    }
    if !campaign.is_active {
        return Err("campaign is not active".to_string());
    }
    Ok(())
}

/// Validates `medium_id` against `UtmMedium`: must exist, belong to the
/// organization, and be active.
fn validate_lead_medium(
    ctx: &ReducerContext,
    organization_id: u64,
    medium_id: u64,
) -> Result<(), String> {
    let medium = ctx
        .db
        .utm_medium()
        .id()
        .find(&medium_id)
        .ok_or("medium not found")?;
    if medium.organization_id != organization_id {
        return Err("medium does not belong to this organization".to_string());
    }
    if !medium.is_active {
        return Err("medium is not active".to_string());
    }
    Ok(())
}

/// Validates `partner_id` against `Contact`: must exist, belong to the
/// organization, and not be soft-deleted. `Contact` has no `is_active` flag,
/// only `deleted_at`.
fn validate_lead_partner(
    ctx: &ReducerContext,
    organization_id: u64,
    partner_id: u64,
) -> Result<(), String> {
    let partner = ctx
        .db
        .contact()
        .id()
        .find(&partner_id)
        .ok_or("partner not found")?;
    if partner.organization_id != organization_id {
        return Err("partner does not belong to this organization".to_string());
    }
    if partner.deleted_at.is_some() {
        return Err("partner is deleted".to_string());
    }
    Ok(())
}

/// Validates every id in `tag_ids` against `ContactTag`: each must exist and
/// belong to the organization. Rejects the whole batch on the first invalid
/// tag rather than silently dropping bad ids. `ContactTag` has no
/// active/deleted flag, so existence + org scope is the full check.
fn validate_lead_tags(
    ctx: &ReducerContext,
    organization_id: u64,
    tag_ids: &[u64],
) -> Result<(), String> {
    for tag_id in tag_ids {
        let tag = ctx
            .db
            .contact_tag()
            .id()
            .find(tag_id)
            .ok_or("tag not found")?;
        if tag.organization_id != organization_id {
            return Err("tag does not belong to this organization".to_string());
        }
    }
    Ok(())
}

/// Validates `opportunity_stage_id` against `OpportunityStage`, matching the
/// checks `create_opportunity` (opportunities.rs) applies to `stage_id`.
fn validate_lead_opportunity_stage(
    ctx: &ReducerContext,
    organization_id: u64,
    stage_id: u64,
) -> Result<(), String> {
    let stage = ctx
        .db
        .opp_stage()
        .id()
        .find(&stage_id)
        .ok_or("Stage not found")?;
    if stage.organization_id != organization_id {
        return Err("Stage does not belong to this organization".to_string());
    }
    if !stage.is_active {
        return Err("Stage is inactive".to_string());
    }
    Ok(())
}

fn validate_lead_team(
    ctx: &ReducerContext,
    organization_id: u64,
    team_id: u64,
) -> Result<(), String> {
    let team = ctx
        .db
        .crm_team()
        .id()
        .find(&team_id)
        .ok_or("CRM team not found")?;
    if team.organization_id != organization_id {
        return Err("CRM team does not belong to this organization".to_string());
    }
    if !team.is_active {
        return Err("CRM team is inactive".to_string());
    }
    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: LEAD MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_lead(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateLeadParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "lead", "create")?;

    if params.name.is_empty() {
        return Err("Lead name cannot be empty".to_string());
    }

    // Leads do not yet support explicit company selection (`company_id` is always
    // unscoped below); `None` always satisfies the Phase 0 CRM containment guard.
    require_single_company_crm_scope(ctx, organization_id, None)?;

    if let Some(source_id) = params.source_id {
        validate_lead_source(ctx, organization_id, source_id)?;
    }
    if let Some(campaign_id) = params.campaign_id {
        validate_lead_campaign(ctx, organization_id, campaign_id)?;
    }
    if let Some(medium_id) = params.medium_id {
        validate_lead_medium(ctx, organization_id, medium_id)?;
    }
    if let Some(partner_id) = params.partner_id {
        validate_lead_partner(ctx, organization_id, partner_id)?;
    }
    if let Some(stage_id) = params.stage_id {
        validate_lead_opportunity_stage(ctx, organization_id, stage_id)?;
    }
    if let Some(team_id) = params.team_id {
        validate_lead_team(ctx, organization_id, team_id)?;
    }
    validate_lead_tags(ctx, organization_id, &params.tag_ids)?;

    let lead = ctx.db.lead().insert(Lead {
        id: 0,
        organization_id,
        name: params.name.clone(),
        email: params.email.clone(),
        phone: params.phone,
        mobile: params.mobile,
        company_name: params.company_name,
        contact_name: params.contact_name,
        title: params.title,
        street: params.street,
        city: params.city,
        zip: params.zip,
        country_code: params.country_code,
        website: params.website,
        industry: params.industry,
        source_id: params.source_id,
        campaign_id: params.campaign_id,
        medium_id: params.medium_id,
        referred_by: params.referred_by,
        description: params.description,
        priority: params.priority,
        state: params.state,
        expected_revenue: params.expected_revenue,
        probability: params.probability,
        // System-managed: initialized on create, not user-supplied
        date_open: Some(ctx.timestamp),
        date_close: None,
        date_conversion: None,
        date_last_stage_update: Some(ctx.timestamp),
        day_open: None,
        day_close: None,
        lost_reason_id: None,
        date_deadline: params.date_deadline,
        user_id: params.user_id,
        stage_id: params.stage_id,
        team_id: params.team_id,
        partner_id: params.partner_id,
        tag_ids: params.tag_ids,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        deleted_at: None,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "lead",
            record_id: lead.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "name": params.name, "email": params.email }).to_string(),
            ),
            changed_fields: vec!["name".to_string(), "email".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Atomically patches a lead's details, address, and revenue forecast in one
/// transaction (CRM-RI-004). Only fields explicitly present in `params` are
/// touched; every other field on the row is preserved via the final `..lead`
/// spread. All validation happens before the single `.update()` call, so a
/// failure never leaves a partial write.
#[spacetimedb::reducer]
pub fn update_lead(
    ctx: &ReducerContext,
    organization_id: u64,
    lead_id: u64,
    params: UpdateLeadParams,
) -> Result<(), String> {
    let lead = ctx.db.lead().id().find(&lead_id).ok_or("Lead not found")?;
    if lead.organization_id != organization_id {
        return Err("Lead does not belong to this organization".to_string());
    }
    check_permission(ctx, organization_id, "lead", "write")?;

    if let Some(Some(stage_id)) = params.stage_id {
        validate_lead_opportunity_stage(ctx, organization_id, stage_id)?;
    }
    if let Some(Some(team_id)) = params.team_id {
        validate_lead_team(ctx, organization_id, team_id)?;
    }

    let mut changed_fields = Vec::new();
    if params.contact_name.is_some() {
        changed_fields.push("contact_name".to_string());
    }
    if params.title.is_some() {
        changed_fields.push("title".to_string());
    }
    if params.website.is_some() {
        changed_fields.push("website".to_string());
    }
    if params.industry.is_some() {
        changed_fields.push("industry".to_string());
    }
    if params.referred_by.is_some() {
        changed_fields.push("referred_by".to_string());
    }
    if params.description.is_some() {
        changed_fields.push("description".to_string());
    }
    if params.street.is_some() {
        changed_fields.push("street".to_string());
    }
    if params.city.is_some() {
        changed_fields.push("city".to_string());
    }
    if params.zip.is_some() {
        changed_fields.push("zip".to_string());
    }
    if params.country_code.is_some() {
        changed_fields.push("country_code".to_string());
    }
    if params.expected_revenue.is_some() {
        changed_fields.push("expected_revenue".to_string());
    }
    if params.probability.is_some() {
        changed_fields.push("probability".to_string());
    }
    if params.stage_id.is_some() {
        changed_fields.push("stage_id".to_string());
    }
    if params.team_id.is_some() {
        changed_fields.push("team_id".to_string());
    }

    ctx.db.lead().id().update(Lead {
        contact_name: params
            .contact_name
            .unwrap_or_else(|| lead.contact_name.clone()),
        title: params.title.unwrap_or_else(|| lead.title.clone()),
        website: params.website.unwrap_or_else(|| lead.website.clone()),
        industry: params.industry.unwrap_or_else(|| lead.industry.clone()),
        referred_by: params
            .referred_by
            .unwrap_or_else(|| lead.referred_by.clone()),
        description: params
            .description
            .unwrap_or_else(|| lead.description.clone()),
        street: params.street.unwrap_or_else(|| lead.street.clone()),
        city: params.city.unwrap_or_else(|| lead.city.clone()),
        zip: params.zip.unwrap_or_else(|| lead.zip.clone()),
        country_code: params
            .country_code
            .unwrap_or_else(|| lead.country_code.clone()),
        expected_revenue: params.expected_revenue.unwrap_or(lead.expected_revenue),
        probability: params.probability.unwrap_or(lead.probability),
        stage_id: params.stage_id.unwrap_or(lead.stage_id),
        team_id: params.team_id.unwrap_or(lead.team_id),
        updated_at: ctx.timestamp,
        ..lead
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "lead",
            record_id: lead_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields,
            metadata: None,
        },
    );

    // CRM-RI-016: this reducer mutates fields consumed by `compute_factors`,
    // so the stored score no longer reflects the lead.
    mark_lead_score_stale(ctx, organization_id, lead_id);

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_lead_details(
    ctx: &ReducerContext,
    organization_id: u64,
    lead_id: u64,
    params: UpdateLeadDetailsParams,
) -> Result<(), String> {
    let lead = ctx.db.lead().id().find(&lead_id).ok_or("Lead not found")?;
    if lead.organization_id != organization_id {
        return Err("Lead does not belong to this organization".to_string());
    }
    check_permission(ctx, organization_id, "lead", "write")?;

    ctx.db.lead().id().update(Lead {
        contact_name: params.contact_name,
        title: params.title,
        website: params.website,
        industry: params.industry,
        referred_by: params.referred_by,
        description: params.description,
        updated_at: ctx.timestamp,
        ..lead
    });

    // CRM-RI-016: email/phone/mobile/company_name/website/industry feed
    // `compute_factors`.
    mark_lead_score_stale(ctx, organization_id, lead_id);

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_lead_address(
    ctx: &ReducerContext,
    organization_id: u64,
    lead_id: u64,
    params: UpdateLeadAddressParams,
) -> Result<(), String> {
    let lead = ctx.db.lead().id().find(&lead_id).ok_or("Lead not found")?;
    if lead.organization_id != organization_id {
        return Err("Lead does not belong to this organization".to_string());
    }
    check_permission(ctx, organization_id, "lead", "write")?;

    ctx.db.lead().id().update(Lead {
        street: params.street,
        city: params.city,
        zip: params.zip,
        country_code: params.country_code,
        updated_at: ctx.timestamp,
        ..lead
    });

    // CRM-RI-016: address fields participate in scoring completeness.
    mark_lead_score_stale(ctx, organization_id, lead_id);

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_lead_revenue(
    ctx: &ReducerContext,
    organization_id: u64,
    lead_id: u64,
    params: UpdateLeadRevenueParams,
) -> Result<(), String> {
    let lead = ctx.db.lead().id().find(&lead_id).ok_or("Lead not found")?;
    if lead.organization_id != organization_id {
        return Err("Lead does not belong to this organization".to_string());
    }
    check_permission(ctx, organization_id, "lead", "write")?;

    let old_revenue = lead.expected_revenue;
    ctx.db.lead().id().update(Lead {
        expected_revenue: params.expected_revenue,
        probability: params.probability,
        updated_at: ctx.timestamp,
        ..lead
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "lead",
            record_id: lead_id,
            action: "UPDATE",
            old_values: Some(
                serde_json::json!({ "expected_revenue": old_revenue }).to_string(),
            ),
            new_values: Some(
                serde_json::json!({ "expected_revenue": params.expected_revenue, "probability": params.probability }).to_string(),
            ),
            changed_fields: vec!["expected_revenue".to_string(), "probability".to_string()],
            metadata: None,
        },
    );

    // CRM-RI-016: expected_revenue/probability are direct scoring factors.
    mark_lead_score_stale(ctx, organization_id, lead_id);

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_lead(ctx: &ReducerContext, organization_id: u64, lead_id: u64) -> Result<(), String> {
    let lead = ctx.db.lead().id().find(&lead_id).ok_or("Lead not found")?;
    if lead.organization_id != organization_id {
        return Err("Lead does not belong to this organization".to_string());
    }
    check_permission(ctx, organization_id, "lead", "delete")?;

    let old_deleted_at = lead.deleted_at;
    ctx.db.lead().id().update(Lead {
        deleted_at: Some(ctx.timestamp),
        updated_at: ctx.timestamp,
        ..lead
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "lead",
            record_id: lead_id,
            action: "DELETE",
            old_values: Some(
                serde_json::json!({ "deleted_at": old_deleted_at.map(|ts| format!("{:?}", ts)) })
                    .to_string(),
            ),
            new_values: Some(
                serde_json::json!({ "deleted_at": format!("{:?}", ctx.timestamp) }).to_string(),
            ),
            changed_fields: vec!["deleted_at".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn convert_lead_to_customer(
    ctx: &ReducerContext,
    organization_id: u64,
    lead_id: u64,
    params: ConvertLeadParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "lead", "write")?;

    let lead = ctx.db.lead().id().find(&lead_id).ok_or("Lead not found")?;

    if lead.organization_id != organization_id {
        return Err("Lead does not belong to this organization".to_string());
    }

    if lead.state != "qualified" {
        return Err("Lead must be qualified before conversion".to_string());
    }

    let operating_company_id = match params.company_id {
        Some(cid) => Some(company_id_from_scope(ctx, organization_id, Some(cid))?),
        // Fail closed: never create contact/opportunity with company_id: None.
        None => Some(default_company_id_for_organization(ctx, organization_id)?),
    };
    let contact_company_id = operating_company_id;
    let opportunity_company_id = operating_company_id;

    let mut contact_id: Option<u64> = None;

    if params.create_contact {
        let contact = ctx.db.contact().insert(Contact {
            id: 0,
            organization_id,
            company_id: contact_company_id,
            type_: params.contact_type.unwrap_or_else(|| "contact".to_string()),
            name: lead.name.clone(),
            display_name: lead.name.clone(),
            first_name: lead
                .contact_name
                .as_ref()
                .and_then(|n| n.split_whitespace().next().map(String::from)),
            last_name: lead
                .contact_name
                .as_ref()
                .and_then(|n| n.split_whitespace().last().map(String::from)),
            title: lead.title.clone(),
            email: lead.email.clone(),
            email_secondary: None,
            phone: lead.phone.clone(),
            mobile: lead.mobile.clone(),
            fax: None,
            website: lead.website.clone(),
            street: lead.street.clone(),
            street2: None,
            city: lead.city.clone(),
            state_code: None,
            zip: lead.zip.clone(),
            country_code: lead.country_code.clone(),
            tax_id: None,
            company_registry: None,
            industry: lead.industry.clone(),
            employees_count: None,
            annual_revenue: None,
            description: lead.description.clone(),
            is_customer: true,
            is_vendor: params.is_vendor.unwrap_or(false),
            is_employee: params.is_employee.unwrap_or(false),
            is_prospect: params.is_prospect.unwrap_or(false),
            is_partner: params.is_partner.unwrap_or(false),
            customer_rank: params.customer_rank.unwrap_or(0),
            supplier_rank: params.supplier_rank.unwrap_or(0),
            salesperson_id: lead.user_id,
            assigned_user_id: None,
            parent_id: None,
            user_id: None,
            color: None,
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            deleted_at: None,
            merge_target_id: None,
            metadata: params.metadata.clone(),
        });
        contact_id = Some(contact.id);
    }

    if params.create_opportunity && contact_id.is_some() {
        let stage_id = params
            .opportunity_stage_id
            .ok_or("opportunity_stage_id is required when create_opportunity is true")?;
        validate_lead_opportunity_stage(ctx, organization_id, stage_id)?;

        ctx.db.opportunity().insert(Opportunity {
            id: 0,
            organization_id,
            lead_id: Some(lead_id),
            name: format!("{} - Opportunity", lead.name),
            expected_revenue: lead.expected_revenue,
            probability: lead.probability,
            stage_id,
            priority: lead.priority.clone(),
            color: None,
            partner_id: contact_id,
            contact_id,
            campaign_id: lead.campaign_id,
            medium_id: lead.medium_id,
            source_id: lead.source_id,
            user_id: lead.user_id,
            team_id: lead.team_id,
            company_currency_id: None,
            company_id: opportunity_company_id,
            date_open: Some(ctx.timestamp),
            date_closed: None,
            date_deadline: lead.date_deadline,
            date_last_stage_update: Some(ctx.timestamp),
            day_open: None,
            day_close: None,
            is_won: false,
            is_lost: false,
            lost_reason_id: None,
            description: lead.description.clone(),
            tag_ids: lead.tag_ids.clone(),
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            deleted_at: None,
            metadata: params.metadata,
        });
    }

    let old_state = lead.state.clone();
    ctx.db.lead().id().update(Lead {
        state: "converted".to_string(),
        date_conversion: Some(ctx.timestamp),
        partner_id: contact_id,
        updated_at: ctx.timestamp,
        ..lead
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "lead",
            record_id: lead_id,
            action: "CONVERT",
            old_values: Some(serde_json::json!({ "state": old_state }).to_string()),
            new_values: Some(r#"{"state":"converted"}"#.to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: LEAD SOURCE ADMIN
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_lead_source(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateLeadSourceParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "lead_source", "create")?;

    if params.name.is_empty() {
        return Err("Source name cannot be empty".to_string());
    }

    let source = ctx.db.lead_source().insert(LeadSource {
        id: 0,
        organization_id,
        name: params.name.clone(),
        description: params.description,
        sequence: params.sequence,
        is_active: params.is_active,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "lead_source",
            record_id: source.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": params.name }).to_string()),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_lead_source(
    ctx: &ReducerContext,
    organization_id: u64,
    source_id: u64,
    params: UpdateLeadSourceParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "lead_source", "write")?;

    let source = ctx
        .db
        .lead_source()
        .id()
        .find(&source_id)
        .ok_or("Lead source not found")?;

    if source.organization_id != organization_id {
        return Err("Lead source does not belong to this organization".to_string());
    }

    let mut changed_fields = Vec::new();

    let name = match params.name {
        Some(v) => {
            if v.is_empty() {
                return Err("Source name cannot be empty".to_string());
            }
            changed_fields.push("name".to_string());
            v
        }
        None => source.name.clone(),
    };
    if params.description.is_some() {
        changed_fields.push("description".to_string());
    }
    let description = params.description.or_else(|| source.description.clone());
    let sequence = params.sequence.unwrap_or(source.sequence);
    if params.sequence.is_some() {
        changed_fields.push("sequence".to_string());
    }
    let is_active = params.is_active.unwrap_or(source.is_active);
    if params.is_active.is_some() {
        changed_fields.push("is_active".to_string());
    }
    if params.metadata.is_some() {
        changed_fields.push("metadata".to_string());
    }
    let metadata = params.metadata.or_else(|| source.metadata.clone());

    ctx.db.lead_source().id().update(LeadSource {
        name,
        description,
        sequence,
        is_active,
        metadata,
        ..source
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "lead_source",
            record_id: source_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: LEAD LOST REASON ADMIN
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_lead_lost_reason(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateLeadLostReasonParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "lead_lost_reason", "create")?;

    if params.name.is_empty() {
        return Err("Lost reason name cannot be empty".to_string());
    }

    let reason = ctx.db.lead_lost_reason().insert(LeadLostReason {
        id: 0,
        organization_id,
        name: params.name.clone(),
        description: params.description,
        is_active: params.is_active,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "lead_lost_reason",
            record_id: reason.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "name": params.name }).to_string()),
            changed_fields: vec!["name".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_lead_lost_reason(
    ctx: &ReducerContext,
    organization_id: u64,
    lost_reason_id: u64,
    params: UpdateLeadLostReasonParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "lead_lost_reason", "write")?;

    let reason = ctx
        .db
        .lead_lost_reason()
        .id()
        .find(&lost_reason_id)
        .ok_or("Lost reason not found")?;

    if reason.organization_id != organization_id {
        return Err("Lost reason does not belong to this organization".to_string());
    }

    let mut changed_fields = Vec::new();

    let name = match params.name {
        Some(v) => {
            if v.is_empty() {
                return Err("Lost reason name cannot be empty".to_string());
            }
            changed_fields.push("name".to_string());
            v
        }
        None => reason.name.clone(),
    };
    if params.description.is_some() {
        changed_fields.push("description".to_string());
    }
    let description = params.description.or_else(|| reason.description.clone());
    let is_active = params.is_active.unwrap_or(reason.is_active);
    if params.is_active.is_some() {
        changed_fields.push("is_active".to_string());
    }
    if params.metadata.is_some() {
        changed_fields.push("metadata".to_string());
    }
    let metadata = params.metadata.or_else(|| reason.metadata.clone());

    ctx.db.lead_lost_reason().id().update(LeadLostReason {
        name,
        description,
        is_active,
        metadata,
        ..reason
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "lead_lost_reason",
            record_id: lost_reason_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
}
