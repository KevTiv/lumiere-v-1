/// Opportunities Module — Opportunity Management
///
/// Tables:
///   - Opportunity
///   - OpportunityStage
///   - OpportunityLine
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::crm::contacts::{contact, Contact};
use crate::core::organization::company_id_from_scope;
use crate::core::permissions::role;
use crate::core::users::{user_organization, user_profile};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::product::product;
use crate::sales::sales_core::{
    create_sale_order, CreateSaleOrderLineParams, CreateSaleOrderParams,
};

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

/// Params for the `convert_opportunity_to_sale_order` workflow action.
#[derive(SpacetimeType, Clone, Debug)]
pub struct ConvertOpportunityParams {
    pub pricelist_id: u64,
    pub warehouse_id: u64,
}

/// Params for adding a product line to an open opportunity.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateOpportunityLineParams {
    pub product_id: u64,
    pub name: Option<String>,
    pub quantity: f64,
    pub uom_id: u64,
    pub price_unit: f64,
    pub discount: f64,
    pub tax_ids: Vec<u64>,
    pub sequence: i32,
    pub metadata: Option<String>,
}

/// Params for updating an opportunity.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateOpportunityParams {
    pub name: Option<String>,
    pub expected_revenue: Option<f64>,
    pub probability: Option<f64>,
    pub stage_id: Option<u64>,
    pub priority: Option<String>,
    pub is_won: Option<bool>,
    pub is_lost: Option<bool>,
    pub partner_id: Option<u64>,
    pub contact_id: Option<u64>,
    pub date_deadline: Option<Timestamp>,
    pub date_closed: Option<Timestamp>,
    pub lost_reason_id: Option<u64>,
    pub description: Option<String>,
    pub tag_ids: Option<Vec<u64>>,
}

/// Params for creating an opportunity pipeline stage.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateOpportunityStageParams {
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

/// Params for updating an opportunity pipeline stage.
/// `None` = keep existing value for every field.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateOpportunityStageParams {
    pub name: Option<String>,
    pub sequence: Option<i32>,
    pub probability: Option<f64>,
    pub requirements: Option<String>,
    pub fold: Option<bool>,
    pub is_won: Option<bool>,
    pub team_id: Option<u64>,
    pub is_active: Option<bool>,
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

/// Lead-converted opportunities may have `company_id: None` until a company-scoped write.
fn resolve_opportunity_company_id(
    opp: &Opportunity,
    company_id: u64,
) -> Result<u64, String> {
    match opp.company_id {
        Some(cid) if cid != company_id => {
            Err("Record does not belong to this company".to_string())
        }
        Some(cid) => Ok(cid),
        None => Ok(company_id),
    }
}

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

    let operating_company_id = company_id_from_scope(ctx, organization_id, params.company_id)?;

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
        company_id: Some(operating_company_id),
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
            company_id: Some(operating_company_id),
            table_name: "opportunity",
            record_id: opp.id,
            action: "CREATE",
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

// ══════════════════════════════════════════════════════════════════════════════
// REDUCERS: OPPORTUNITY STAGE ADMIN
// ══════════════════════════════════════════════════════════════════════════════

#[spacetimedb::reducer]
pub fn create_opportunity_stage(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateOpportunityStageParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "opportunity_stage", "create")?;

    if params.name.is_empty() {
        return Err("Stage name cannot be empty".to_string());
    }

    let stage = ctx.db.opp_stage().insert(OpportunityStage {
        id: 0,
        organization_id,
        name: params.name.clone(),
        sequence: params.sequence,
        probability: params.probability,
        requirements: params.requirements,
        fold: params.fold,
        is_won: params.is_won,
        team_id: params.team_id,
        is_active: params.is_active,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "opp_stage",
            record_id: stage.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({ "name": params.name, "sequence": params.sequence })
                    .to_string(),
            ),
            changed_fields: vec!["name".to_string(), "sequence".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_opportunity_stage(
    ctx: &ReducerContext,
    organization_id: u64,
    stage_id: u64,
    params: UpdateOpportunityStageParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "opportunity_stage", "write")?;

    let stage = ctx
        .db
        .opp_stage()
        .id()
        .find(&stage_id)
        .ok_or("Stage not found")?;

    if stage.organization_id != organization_id {
        return Err("Stage does not belong to this organization".to_string());
    }

    let mut changed_fields = Vec::new();

    let name = match params.name {
        Some(v) => {
            if v.is_empty() {
                return Err("Stage name cannot be empty".to_string());
            }
            changed_fields.push("name".to_string());
            v
        }
        None => stage.name.clone(),
    };
    let sequence = params.sequence.unwrap_or(stage.sequence);
    if params.sequence.is_some() {
        changed_fields.push("sequence".to_string());
    }
    let probability = params.probability.unwrap_or(stage.probability);
    if params.probability.is_some() {
        changed_fields.push("probability".to_string());
    }
    if params.requirements.is_some() {
        changed_fields.push("requirements".to_string());
    }
    let requirements = params.requirements.or_else(|| stage.requirements.clone());
    let fold = params.fold.unwrap_or(stage.fold);
    if params.fold.is_some() {
        changed_fields.push("fold".to_string());
    }
    let is_won = params.is_won.unwrap_or(stage.is_won);
    if params.is_won.is_some() {
        changed_fields.push("is_won".to_string());
    }
    let team_id = params.team_id.or(stage.team_id);
    if params.team_id.is_some() {
        changed_fields.push("team_id".to_string());
    }
    let is_active = params.is_active.unwrap_or(stage.is_active);
    if params.is_active.is_some() {
        changed_fields.push("is_active".to_string());
    }
    if params.metadata.is_some() {
        changed_fields.push("metadata".to_string());
    }
    let metadata = params.metadata.or_else(|| stage.metadata.clone());

    ctx.db.opp_stage().id().update(OpportunityStage {
        name,
        sequence,
        probability,
        requirements,
        fold,
        is_won,
        team_id,
        is_active,
        metadata,
        ..stage
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "opp_stage",
            record_id: stage_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_opportunity(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    opportunity_id: u64,
    params: UpdateOpportunityParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "opportunity", "write")?;

    let opp = ctx
        .db
        .opportunity()
        .id()
        .find(&opportunity_id)
        .ok_or("Opportunity not found")?;

    if opp.organization_id != organization_id {
        return Err("Opportunity does not belong to this organization".to_string());
    }

    let opp_company_id = resolve_opportunity_company_id(&opp, company_id)?;
    let opp = if opp.company_id.is_none() {
        Opportunity {
            company_id: Some(opp_company_id),
            ..opp
        }
    } else {
        opp
    };

    let mut name = opp.name.clone();
    let mut expected_revenue = opp.expected_revenue;
    let mut probability = opp.probability;
    let mut stage_id = opp.stage_id;
    let mut priority = opp.priority.clone();
    let mut is_won = opp.is_won;
    let mut is_lost = opp.is_lost;
    let mut partner_id = opp.partner_id;
    let mut contact_id = opp.contact_id;
    let mut date_deadline = opp.date_deadline;
    let mut date_closed = opp.date_closed;
    let mut date_last_stage_update = opp.date_last_stage_update;
    let mut lost_reason_id = opp.lost_reason_id;
    let mut description = opp.description.clone();
    let mut tag_ids = opp.tag_ids.clone();
    let mut changed_fields = Vec::new();

    if let Some(v) = &params.name {
        if v.is_empty() {
            return Err("Opportunity name cannot be empty".to_string());
        }
        name = v.clone();
        changed_fields.push("name".to_string());
    }
    if let Some(v) = params.expected_revenue {
        expected_revenue = v;
        changed_fields.push("expected_revenue".to_string());
    }
    if let Some(v) = &params.priority {
        priority = v.clone();
        changed_fields.push("priority".to_string());
    }
    if let Some(v) = params.partner_id {
        partner_id = Some(v);
        changed_fields.push("partner_id".to_string());
    }
    if let Some(v) = params.contact_id {
        contact_id = Some(v);
        changed_fields.push("contact_id".to_string());
    }
    if let Some(v) = params.date_deadline {
        date_deadline = Some(v);
        changed_fields.push("date_deadline".to_string());
    }
    if let Some(v) = params.lost_reason_id {
        lost_reason_id = Some(v);
        changed_fields.push("lost_reason_id".to_string());
    }
    if let Some(v) = &params.description {
        description = Some(v.clone());
        changed_fields.push("description".to_string());
    }
    if let Some(v) = &params.tag_ids {
        tag_ids = v.clone();
        changed_fields.push("tag_ids".to_string());
    }

    if let Some(new_stage_id) = params.stage_id {
        if new_stage_id != opp.stage_id {
            let stage = ctx
                .db
                .opp_stage()
                .id()
                .find(&new_stage_id)
                .ok_or("Stage not found")?;

            if stage.organization_id != organization_id {
                return Err("Stage does not belong to this organization".to_string());
            }

            stage_id = new_stage_id;
            date_last_stage_update = Some(ctx.timestamp);
            changed_fields.push("stage_id".to_string());
            changed_fields.push("date_last_stage_update".to_string());

            if params.probability.is_none() {
                probability = stage.probability;
                changed_fields.push("probability".to_string());
            }

            if stage.is_won {
                is_won = true;
                is_lost = false;
                date_closed = Some(ctx.timestamp);
                changed_fields.push("is_won".to_string());
                changed_fields.push("is_lost".to_string());
                changed_fields.push("date_closed".to_string());
            } else if stage.name == "Lost" {
                is_lost = true;
                is_won = false;
                changed_fields.push("is_lost".to_string());
                changed_fields.push("is_won".to_string());
            }
        }
    }

    if let Some(v) = params.probability {
        probability = v;
        if !changed_fields.contains(&"probability".to_string()) {
            changed_fields.push("probability".to_string());
        }
    }
    if let Some(v) = params.is_won {
        is_won = v;
        if !changed_fields.contains(&"is_won".to_string()) {
            changed_fields.push("is_won".to_string());
        }
    }
    if let Some(v) = params.is_lost {
        is_lost = v;
        if !changed_fields.contains(&"is_lost".to_string()) {
            changed_fields.push("is_lost".to_string());
        }
    }
    if let Some(v) = params.date_closed {
        date_closed = Some(v);
        if !changed_fields.contains(&"date_closed".to_string()) {
            changed_fields.push("date_closed".to_string());
        }
    }

    let user = ctx
        .db
        .user_profile()
        .identity()
        .find(ctx.sender())
        .ok_or("User not found")?;
    let user_org = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|uo| uo.organization_id == organization_id && uo.is_active)
        .ok_or("User is not a member of this organization")?;
    let role_row = ctx
        .db
        .role()
        .id()
        .find(user_org.role_id)
        .ok_or("Role not found")?;
    crate::core::permissions::ensure_resource_fields_writable(
        ctx,
        organization_id,
        ctx.sender(),
        role_row.id,
        &role_row.name,
        user.is_superuser,
        "opportunity",
        &changed_fields,
    )?;

    ctx.db.opportunity().id().update(Opportunity {
        name,
        expected_revenue,
        probability,
        stage_id,
        priority,
        is_won,
        is_lost,
        partner_id,
        contact_id,
        date_deadline,
        date_closed,
        date_last_stage_update,
        lost_reason_id,
        description,
        tag_ids,
        updated_at: ctx.timestamp,
        ..opp
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "opportunity",
            record_id: opportunity_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields,
            metadata: None,
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_opportunity_line(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    opportunity_id: u64,
    params: CreateOpportunityLineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "opportunity", "write")?;

    if params.quantity <= 0.0 {
        return Err("Quantity must be greater than zero".to_string());
    }
    if params.price_unit < 0.0 {
        return Err("Unit price cannot be negative".to_string());
    }
    if params.discount < 0.0 || params.discount > 100.0 {
        return Err("Discount must be between 0 and 100".to_string());
    }

    let opp = ctx
        .db
        .opportunity()
        .id()
        .find(&opportunity_id)
        .ok_or("Opportunity not found")?;

    if opp.organization_id != organization_id {
        return Err("Opportunity does not belong to this organization".to_string());
    }

    let opp_company_id = resolve_opportunity_company_id(&opp, company_id)?;

    if opp.is_won || opp.is_lost {
        return Err("Cannot add lines to a closed opportunity".to_string());
    }

    if opp.company_id.is_none() {
        ctx.db.opportunity().id().update(Opportunity {
            company_id: Some(opp_company_id),
            updated_at: ctx.timestamp,
            ..opp
        });
    }

    let product = ctx
        .db
        .product()
        .id()
        .find(&params.product_id)
        .ok_or("Product not found")?;

    if product.organization_id != organization_id {
        return Err("Product does not belong to this organization".to_string());
    }

    let discount_amount = params.price_unit * params.quantity * (params.discount / 100.0);
    let price_subtotal = params.price_unit * params.quantity - discount_amount;

    let line_name = params.name.unwrap_or_else(|| {
        product
            .display_name
            .clone()
            .unwrap_or_else(|| product.name.clone())
    });

    let line = ctx.db.opportunity_line().insert(OpportunityLine {
        id: 0,
        organization_id,
        opportunity_id,
        product_id: Some(params.product_id),
        name: line_name,
        quantity: params.quantity,
        uom_id: Some(params.uom_id),
        price_unit: params.price_unit,
        price_subtotal,
        discount: params.discount,
        tax_ids: params.tax_ids.clone(),
        sequence: params.sequence,
        created_at: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(opp_company_id),
            table_name: "opportunity_line",
            record_id: line.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "opportunity_id": opportunity_id,
                    "product_id": params.product_id,
                    "quantity": params.quantity,
                    "price_unit": params.price_unit,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "opportunity_id".to_string(),
                "product_id".to_string(),
                "quantity".to_string(),
                "price_unit".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

/// Convert a CRM Opportunity into a Sale Order.
///
/// Fetches the opportunity and its lines, ensures the partner is flagged as
/// a customer, then creates a Sale Order with one line per OpportunityLine
/// (lines without a product_id are skipped).
#[spacetimedb::reducer]
pub fn convert_opportunity_to_sale_order(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    opportunity_id: u64,
    params: ConvertOpportunityParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "opportunity", "write")?;

    let opp = ctx
        .db
        .opportunity()
        .id()
        .find(&opportunity_id)
        .ok_or("Opportunity not found")?;

    if opp.organization_id != organization_id {
        return Err("Opportunity does not belong to this organization".to_string());
    }

    let partner_id = opp
        .partner_id
        .ok_or("Opportunity has no partner — set a partner before converting")?;

    let currency_id = opp.company_currency_id.unwrap_or(1);
    let opp_company_id = opp.company_id.unwrap_or(company_id);

    // Ensure the partner is flagged as a customer
    if let Some(partner) = ctx.db.contact().id().find(&partner_id) {
        if !partner.is_customer {
            ctx.db.contact().id().update(Contact {
                is_customer: true,
                ..partner
            });
        }
    }

    // Build SO lines from opportunity lines (skip those without a product)
    let opp_lines: Vec<_> = ctx
        .db
        .opportunity_line()
        .iter()
        .filter(|l| l.opportunity_id == opportunity_id)
        .collect();

    let order_lines: Vec<CreateSaleOrderLineParams> = opp_lines
        .iter()
        .filter_map(|l| {
            let product_id = l.product_id?;
            Some(CreateSaleOrderLineParams {
                product_id,
                quantity: l.quantity,
                uom_id: l.uom_id.unwrap_or(1),
                price_unit: Some(l.price_unit),
                discount: l.discount,
                tax_ids: l.tax_ids.clone(),
                name: Some(l.name.clone()),
                sequence: l.sequence as u32,
                is_downpayment: false,
                display_type: None,
                product_variant_id: None,
                packaging_id: None,
                route_id: None,
                analytic_tag_ids: vec![],
                customer_lead: None,
                metadata: None,
            })
        })
        .collect();

    let so_params = CreateSaleOrderParams {
        company_id: Some(opp_company_id),
        partner_id,
        partner_invoice_id: partner_id,
        partner_shipping_id: partner_id,
        pricelist_id: params.pricelist_id,
        currency_id,
        warehouse_id: params.warehouse_id,
        order_lines,
        origin: Some(format!("CRM/{}", opportunity_id)),
        client_order_ref: None,
        payment_term_id: None,
        fiscal_position_id: None,
        team_id: opp.team_id,
        opportunity_id: Some(opportunity_id),
        note: opp.description.clone(),
        terms_and_conditions: None,
        validity_days: None,
        shipping_policy: None,
        picking_policy: None,
        campaign_id: opp.campaign_id,
        medium_id: opp.medium_id,
        source_id: opp.source_id,
        commitment_date: None,
        expected_date: opp.date_deadline,
        incoterm_id: None,
        incoterm: None,
        incoterm_location: None,
        carrier_id: None,
        customer_lead: None,
        analytic_account_id: None,
        user_id: opp.user_id,
        is_printed: None,
        is_locked: None,
        is_dropship: None,
        message_follower_ids: None,
        message_partner_ids: None,
        message_channel_ids: None,
        activity_ids: None,
        metadata: None,
    };

    create_sale_order(ctx, organization_id, so_params)?;

    let won_stage = ctx
        .db
        .opp_stage()
        .iter()
        .find(|s| s.organization_id == organization_id && s.is_won)
        .ok_or("Won stage not found")?;

    ctx.db.opportunity().id().update(Opportunity {
        is_won: true,
        is_lost: false,
        stage_id: won_stage.id,
        date_closed: Some(ctx.timestamp),
        date_last_stage_update: Some(ctx.timestamp),
        probability: 100.0,
        updated_at: ctx.timestamp,
        ..opp
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(opp_company_id),
            table_name: "opportunity",
            record_id: opportunity_id,
            action: "CONVERT_TO_SO",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "partner_id": partner_id,
                    "currency_id": currency_id,
                    "stage_id": won_stage.id,
                    "is_won": true,
                })
                    .to_string(),
            ),
            changed_fields: vec![
                "stage_id".to_string(),
                "is_won".to_string(),
                "is_lost".to_string(),
                "date_closed".to_string(),
                "date_last_stage_update".to_string(),
                "probability".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}
