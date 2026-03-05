/// Opportunities Module — Opportunity Management
///
/// Tables:
///   - Opportunity
///   - OpportunityStage
///   - OpportunityLine
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

// ══════════════════════════════════════════════════════════════════════════════
// PARAMS TYPES
// ══════════════════════════════════════════════════════════════════════════════

/// Params for creating an opportunity.
/// Scope: `organization_id` is a flat reducer param (not in this struct).
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateOpportunityParams {
    pub name: String,
    pub expected_revenue: f64,
    pub probability: f64,
    pub stage_id: u64,
    pub priority: String,
    pub is_won: bool,
    pub is_lost: bool,
    pub tag_ids: Vec<u64>,
    // Relations
    pub lead_id: Option<u64>,
    pub partner_id: Option<u64>,
    pub contact_id: Option<u64>,
    pub campaign_id: Option<u64>,
    pub medium_id: Option<u64>,
    pub source_id: Option<u64>,
    pub user_id: Option<Identity>,
    pub team_id: Option<u64>,
    pub company_id: Option<u64>,
    pub company_currency_id: Option<u64>,
    pub lost_reason_id: Option<u64>,
    // Dates
    pub date_open: Option<Timestamp>,
    pub date_closed: Option<Timestamp>,
    pub date_deadline: Option<Timestamp>,
    pub date_last_stage_update: Option<Timestamp>,
    // Metrics
    pub day_open: Option<i32>,
    pub day_close: Option<i32>,
    // Display
    pub color: Option<String>,
    pub description: Option<String>,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// TABLES: OPPORTUNITIES
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = opportunity,
    public,
    index(name = "opp_by_org_idx", accessor = opp_by_org, btree(columns = [organization_id])),
    index(name = "opp_by_stage_idx", accessor = opp_by_stage, btree(columns = [stage_id]))
)]
#[derive(Clone)]
pub struct Opportunity {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub lead_id: Option<u64>,
    pub name: String,
    pub expected_revenue: f64,
    pub probability: f64,
    pub stage_id: u64,
    pub priority: String,
    pub color: Option<String>,
    pub partner_id: Option<u64>,
    pub contact_id: Option<u64>,
    pub campaign_id: Option<u64>,
    pub medium_id: Option<u64>,
    pub source_id: Option<u64>,
    pub user_id: Option<Identity>,
    pub team_id: Option<u64>,
    pub company_currency_id: Option<u64>,
    pub company_id: Option<u64>,
    pub date_open: Option<Timestamp>,
    pub date_closed: Option<Timestamp>,
    pub date_deadline: Option<Timestamp>,
    pub date_last_stage_update: Option<Timestamp>,
    pub day_open: Option<i32>,
    pub day_close: Option<i32>,
    pub is_won: bool,
    pub is_lost: bool,
    pub lost_reason_id: Option<u64>,
    pub description: Option<String>,
    pub tag_ids: Vec<u64>,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub deleted_at: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = opp_stage,
    public,
    index(accessor = stage_by_org, btree(columns = [organization_id]))
)]
pub struct OpportunityStage {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub name: String,
    pub sequence: i32,
    pub probability: f64,
    pub requirements: Option<String>,
    pub fold: bool,
    pub is_won: bool,
    pub team_id: Option<u64>,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[spacetimedb::table(accessor = opportunity_line, public)]
pub struct OpportunityLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub opportunity_id: u64,
    pub product_id: Option<u64>,
    pub name: String,
    pub quantity: f64,
    pub uom_id: Option<u64>,
    pub price_unit: f64,
    pub price_subtotal: f64,
    pub discount: f64,
    pub tax_ids: Vec<u64>,
    pub sequence: i32,
    pub created_at: Timestamp,
    pub metadata: Option<String>,
}

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: OPPORTUNITY MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_opportunity(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateOpportunityParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "opportunity", "create")?;

    if params.name.is_empty() {
        return Err("Opportunity name cannot be empty".to_string());
    }

    ctx.db
        .opp_stage()
        .id()
        .find(&params.stage_id)
        .ok_or("Stage not found")?;

    let opp = ctx.db.opportunity().insert(Opportunity {
        id: 0,
        organization_id,
        lead_id: params.lead_id,
        name: params.name.clone(),
        expected_revenue: params.expected_revenue,
        probability: params.probability,
        stage_id: params.stage_id,
        priority: params.priority,
        color: params.color,
        partner_id: params.partner_id,
        contact_id: params.contact_id,
        campaign_id: params.campaign_id,
        medium_id: params.medium_id,
        source_id: params.source_id,
        user_id: params.user_id,
        team_id: params.team_id,
        company_currency_id: params.company_currency_id,
        company_id: params.company_id,
        date_open: params.date_open,
        date_closed: params.date_closed,
        date_deadline: params.date_deadline,
        date_last_stage_update: params.date_last_stage_update,
        day_open: params.day_open,
        day_close: params.day_close,
        is_won: params.is_won,
        is_lost: params.is_lost,
        lost_reason_id: params.lost_reason_id,
        description: params.description,
        tag_ids: params.tag_ids,
        // System-managed
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
            company_id: params.company_id,
            table_name: "opportunity",
            record_id: opp.id,
            action: "create",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "name": params.name, "expected_revenue": params.expected_revenue })
                    .to_string(),
            ),
            changed_fields: vec!["name".to_string(), "expected_revenue".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
