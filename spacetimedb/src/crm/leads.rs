/// Leads Module — Lead Management
///
/// Tables:
///   - Lead
///   - LeadSource
///   - LeadLostReason
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::crm::contacts::{contact, Contact};
use crate::crm::opportunities::{opportunity, Opportunity};
use crate::helpers::{check_permission, write_audit_log};

// ══════════════════════════════════════════════════════════════════════════════
// INPUT TYPES
// ══════════════════════════════════════════════════════════════════════════════

/// Input data for creating a lead
#[derive(SpacetimeType, Clone, Debug)]
pub struct LeadInput {
    pub organization_id: u64,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub mobile: Option<String>,
    pub company_name: Option<String>,
    pub priority: String,
    // Contact details
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
    // Deadline
    pub date_deadline: Option<Timestamp>,
    // Business value fields
    pub expected_revenue: Option<f64>,
    pub probability: Option<f64>,
    pub tag_ids: Option<Vec<u64>>,
    pub state: Option<String>,
    pub metadata: Option<String>,
}

/// Input data for converting a lead to customer
#[derive(SpacetimeType, Clone, Debug)]
pub struct ConvertLeadInput {
    pub organization_id: u64,
    pub lead_id: u64,
    pub create_contact: bool,
    pub create_opportunity: bool,
    // Contact creation options
    pub contact_type: Option<String>,
    pub is_vendor: Option<bool>,
    pub is_employee: Option<bool>,
    pub is_prospect: Option<bool>,
    pub is_partner: Option<bool>,
    pub customer_rank: Option<i32>,
    pub supplier_rank: Option<i32>,
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
pub fn create_lead(ctx: &ReducerContext, input: LeadInput) -> Result<(), String> {
    check_permission(ctx, input.organization_id, "lead", "create")?;

    if input.name.is_empty() {
        return Err("Lead name cannot be empty".to_string());
    }

    let lead = ctx.db.lead().insert(Lead {
        id: 0,
        organization_id: input.organization_id,
        name: input.name.clone(),
        email: input.email.clone(),
        phone: input.phone,
        mobile: input.mobile,
        company_name: input.company_name,
        contact_name: input.contact_name,
        title: input.title,
        street: input.street,
        city: input.city,
        zip: input.zip,
        country_code: input.country_code,
        website: input.website,
        industry: input.industry,
        source_id: input.source_id,
        campaign_id: input.campaign_id,
        medium_id: input.medium_id,
        referred_by: input.referred_by,
        description: input.description,
        priority: input.priority,
        state: input.state.unwrap_or_else(|| "new".to_string()),
        expected_revenue: input.expected_revenue.unwrap_or(0.0),
        probability: input.probability.unwrap_or(0.0),
        date_open: Some(ctx.timestamp),
        date_close: None,
        date_deadline: input.date_deadline,
        date_conversion: None,
        date_last_stage_update: Some(ctx.timestamp),
        user_id: input.user_id,
        team_id: input.team_id,
        partner_id: input.partner_id,
        day_open: None,
        day_close: None,
        lost_reason_id: None,
        tag_ids: input.tag_ids.unwrap_or_default(),
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        deleted_at: None,
        metadata: input.metadata,
    });

    write_audit_log(
        ctx,
        input.organization_id,
        None,
        "lead",
        lead.id,
        "create",
        None,
        Some(serde_json::json!({ "name": input.name, "email": input.email }).to_string()),
        vec!["name".to_string(), "email".to_string()],
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_lead_details(
    ctx: &ReducerContext,
    lead_id: u64,
    contact_name: Option<String>,
    title: Option<String>,
    website: Option<String>,
    industry: Option<String>,
    referred_by: Option<String>,
    description: Option<String>,
) -> Result<(), String> {
    let lead = ctx.db.lead().id().find(&lead_id).ok_or("Lead not found")?;
    check_permission(ctx, lead.organization_id, "lead", "write")?;

    ctx.db.lead().id().update(Lead {
        contact_name,
        title,
        website,
        industry,
        referred_by,
        description,
        updated_at: ctx.timestamp,
        ..lead
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_lead_address(
    ctx: &ReducerContext,
    lead_id: u64,
    street: Option<String>,
    city: Option<String>,
    zip: Option<String>,
    country_code: Option<String>,
) -> Result<(), String> {
    let lead = ctx.db.lead().id().find(&lead_id).ok_or("Lead not found")?;
    check_permission(ctx, lead.organization_id, "lead", "write")?;

    ctx.db.lead().id().update(Lead {
        street,
        city,
        zip,
        country_code,
        updated_at: ctx.timestamp,
        ..lead
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_lead_revenue(
    ctx: &ReducerContext,
    lead_id: u64,
    expected_revenue: f64,
    probability: f64,
) -> Result<(), String> {
    let lead = ctx.db.lead().id().find(&lead_id).ok_or("Lead not found")?;
    check_permission(ctx, lead.organization_id, "lead", "write")?;

    ctx.db.lead().id().update(Lead {
        expected_revenue,
        probability,
        updated_at: ctx.timestamp,
        ..lead
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn convert_lead_to_customer(
    ctx: &ReducerContext,
    input: ConvertLeadInput,
) -> Result<(), String> {
    check_permission(ctx, input.organization_id, "lead", "write")?;

    let lead = ctx
        .db
        .lead()
        .id()
        .find(&input.lead_id)
        .ok_or("Lead not found")?;

    if lead.organization_id != input.organization_id {
        return Err("Lead does not belong to this organization".to_string());
    }

    if lead.state != "qualified" {
        return Err("Lead must be qualified before conversion".to_string());
    }

    let mut contact_id: Option<u64> = None;

    if input.create_contact {
        let contact = ctx.db.contact().insert(Contact {
            id: 0,
            organization_id: input.organization_id,
            company_id: None,
            type_: input.contact_type.unwrap_or_else(|| "contact".to_string()),
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
            is_vendor: input.is_vendor.unwrap_or(false),
            is_employee: input.is_employee.unwrap_or(false),
            is_prospect: input.is_prospect.unwrap_or(false),
            is_partner: input.is_partner.unwrap_or(false),
            customer_rank: input.customer_rank.unwrap_or(0),
            supplier_rank: input.supplier_rank.unwrap_or(0),
            salesperson_id: lead.user_id,
            assigned_user_id: None,
            parent_id: None,
            user_id: None,
            color: None,
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            deleted_at: None,
            metadata: input.metadata,
        });
        contact_id = Some(contact.id);
    }

    if input.create_opportunity && contact_id.is_some() {
        ctx.db.opportunity().insert(Opportunity {
            id: 0,
            organization_id: input.organization_id,
            lead_id: Some(input.lead_id),
            name: format!("{} - Opportunity", lead.name),
            expected_revenue: lead.expected_revenue,
            probability: lead.probability,
            stage_id: 1,
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
            metadata: None,
        });
    }

    ctx.db.lead().id().update(Lead {
        state: "converted".to_string(),
        date_conversion: Some(ctx.timestamp),
        partner_id: contact_id,
        updated_at: ctx.timestamp,
        ..lead
    });

    write_audit_log(
        ctx,
        input.organization_id,
        None,
        "lead",
        input.lead_id,
        "convert",
        Some(serde_json::json!({ "state": format!("{:?}", lead.state) }).to_string()),
        Some(r#"{"state":"converted"}"#.to_string()),
        vec!["state".to_string()],
    );

    Ok(())
}
