/// Leads Module — Lead Management
///
/// Tables:
///   - Lead
///   - LeadSource
///   - LeadLostReason
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::crm::contacts::{contact, Contact};
use crate::crm::opportunities::{opportunity, Opportunity};
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

/// Params for converting a lead to a contact/opportunity.
/// Scope: `organization_id` + `lead_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct ConvertLeadParams {
    pub create_contact: bool,
    pub create_opportunity: bool,
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

// ══════════════════════════════════════════════════════════════════════════════
// TABLES: LEADS
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = lead,
    public,
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

#[spacetimedb::table(
    accessor = lead_source,
    public,
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
    public,
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
            action: "create",
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
            action: "update",
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

    let mut contact_id: Option<u64> = None;

    if params.create_contact {
        let contact = ctx.db.contact().insert(Contact {
            id: 0,
            organization_id,
            company_id: None,
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
            metadata: params.metadata.clone(),
        });
        contact_id = Some(contact.id);
    }

    if params.create_opportunity && contact_id.is_some() {
        let stage_id = params
            .opportunity_stage_id
            .ok_or("opportunity_stage_id is required when create_opportunity is true")?;

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
            partner_id: None,
            contact_id,
            campaign_id: lead.campaign_id,
            medium_id: lead.medium_id,
            source_id: lead.source_id,
            user_id: lead.user_id,
            team_id: lead.team_id,
            company_currency_id: None,
            company_id: None,
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
            action: "convert",
            old_values: Some(serde_json::json!({ "state": old_state }).to_string()),
            new_values: Some(r#"{"state":"converted"}"#.to_string()),
            changed_fields: vec!["state".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
