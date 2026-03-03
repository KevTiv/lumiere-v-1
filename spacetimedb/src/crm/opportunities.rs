/// Opportunities Module — Opportunity Management
///
/// Tables:
///   - Opportunity
///   - OpportunityStage
///   - OpportunityLine
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};

// ══════════════════════════════════════════════════════════════════════════════
// TABLES: OPPORTUNITIES
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::table(
    accessor = opportunity,
    public,
    index(name = "opp_by_org_idx", accessor = opp_by_org, btree(columns = [organization_id])),
    index(name = "opp_by_stage_idx", accessor = opp_by_stage, btree(columns = [stage_id]))
)]
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
    name: String,
    expected_revenue: f64,
    probability: f64,
    stage_id: u64,
    partner_id: Option<u64>,
    contact_id: Option<u64>,
    // Additional fields
    priority: String,
    color: Option<String>,
    campaign_id: Option<u64>,
    medium_id: Option<u64>,
    source_id: Option<u64>,
    user_id: Option<Identity>,
    team_id: Option<u64>,
    company_id: Option<u64>,
    company_currency_id: Option<u64>,
    date_deadline: Option<Timestamp>,
    description: Option<String>,
    tag_ids: Vec<u64>,
    // Link and status fields
    lead_id: Option<u64>,
    date_open: Option<Timestamp>,
    date_closed: Option<Timestamp>,
    date_last_stage_update: Option<Timestamp>,
    is_won: bool,
    is_lost: bool,
    lost_reason_id: Option<u64>,
    // Metrics fields
    day_open: Option<i32>,
    day_close: Option<i32>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "opportunity", "create")?;

    if name.is_empty() {
        return Err("Opportunity name cannot be empty".to_string());
    }

    ctx.db
        .opp_stage()
        .id()
        .find(&stage_id)
        .ok_or("Stage not found")?;

    let opp = ctx.db.opportunity().insert(Opportunity {
        id: 0,
        organization_id,
        lead_id,
        name: name.clone(),
        expected_revenue,
        probability,
        stage_id,
        priority,
        color,
        partner_id,
        contact_id,
        campaign_id,
        medium_id,
        source_id,
        user_id,
        team_id,
        company_currency_id,
        company_id,
        date_open,
        date_closed,
        date_deadline,
        date_last_stage_update,
        day_open,
        day_close,
        is_won,
        is_lost,
        lost_reason_id,
        description,
        tag_ids,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        deleted_at: None,
        metadata: None,
    });

    write_audit_log(
        ctx,
        organization_id,
        None,
        "opportunity",
        opp.id,
        "create",
        None,
        Some(
            serde_json::json!({ "name": opp.name, "expected_revenue": expected_revenue })
                .to_string(),
        ),
        vec!["name".to_string(), "expected_revenue".to_string()],
    );

    Ok(())
}
