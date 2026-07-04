/// CRM opportunity lifecycle domain tests — in-module test helpers.
///
/// No `create_opp_stage` reducer exists yet; stages are inserted directly
/// (mirrors `seed.rs`) so `convert_opportunity_to_sale_order` can find a won stage.
use spacetimedb::{ReducerContext, Table};

use crate::crm::opportunities::{
    convert_opportunity_to_sale_order, create_opportunity, create_opportunity_line, opportunity,
    opportunity_line, opp_stage, ConvertOpportunityParams, CreateOpportunityLineParams,
    CreateOpportunityParams, OpportunityStage,
};
use crate::sales::pricelists::{create_pricelist, product_pricelist, CreatePricelistParams};
use crate::sales::sales_core::sale_order;
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::DiscountPolicy;

pub fn test_convert_opportunity_to_sale_order(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    let stage_qualify = ctx.db.opp_stage().insert(OpportunityStage {
        id: 0,
        organization_id: org_id,
        name: "Harness Qualification".to_string(),
        sequence: 1,
        probability: 10.0,
        requirements: None,
        fold: false,
        is_won: false,
        team_id: None,
        is_active: true,
        metadata: Some(r#"{"harness":true}"#.to_string()),
    });

    let stage_won = ctx.db.opp_stage().insert(OpportunityStage {
        id: 0,
        organization_id: org_id,
        name: "Harness Won".to_string(),
        sequence: 10,
        probability: 100.0,
        requirements: None,
        fold: true,
        is_won: true,
        team_id: None,
        is_active: true,
        metadata: Some(r#"{"harness":true}"#.to_string()),
    });

    create_pricelist(
        ctx,
        org_id,
        CreatePricelistParams {
            name: "Harness CRM Pricelist".to_string(),
            currency_id: 1,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;

    let pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == "Harness CRM Pricelist")
        .map(|p| p.id)
        .ok_or("Pricelist not found after create")?;

    create_opportunity(
        ctx,
        org_id,
        CreateOpportunityParams {
            name: "Harness Enterprise Deal".to_string(),
            expected_revenue: 5_000.0,
            probability: 30.0,
            stage_id: stage_qualify.id,
            priority: "high".to_string(),
            is_won: false,
            is_lost: false,
            tag_ids: vec![],
            lead_id: None,
            partner_id: Some(fixture.partner_id),
            contact_id: Some(fixture.partner_id),
            campaign_id: None,
            medium_id: None,
            source_id: None,
            user_id: None,
            team_id: None,
            company_id: Some(company_id),
            company_currency_id: Some(1),
            lost_reason_id: None,
            date_open: Some(ctx.timestamp),
            date_closed: None,
            date_deadline: None,
            date_last_stage_update: Some(ctx.timestamp),
            day_open: None,
            day_close: None,
            color: None,
            description: Some("Harness opp for convert test".to_string()),
            metadata: Some(r#"{"test":"convert_opportunity"}"#.to_string()),
        },
    )?;

    let opp = ctx
        .db
        .opportunity()
        .iter()
        .find(|o| o.organization_id == org_id && o.name == "Harness Enterprise Deal")
        .ok_or("Opportunity not found after create")?;

    create_opportunity_line(
        ctx,
        org_id,
        company_id,
        opp.id,
        CreateOpportunityLineParams {
            product_id: fixture.product_id,
            name: Some("Harness line".to_string()),
            quantity: 1.0,
            uom_id: 1,
            price_unit: 100.0,
            discount: 0.0,
            tax_ids: vec![],
            sequence: 1,
            metadata: None,
        },
    )?;

    convert_opportunity_to_sale_order(
        ctx,
        org_id,
        company_id,
        opp.id,
        ConvertOpportunityParams {
            pricelist_id,
            warehouse_id: fixture.warehouse_id,
        },
    )?;

    let converted = ctx
        .db
        .opportunity()
        .id()
        .find(&opp.id)
        .ok_or("Opportunity not found after convert")?;

    if !converted.is_won {
        return Err("Expected is_won=true after convert".to_string());
    }
    if converted.is_lost {
        return Err("Expected is_lost=false after convert".to_string());
    }
    if converted.stage_id != stage_won.id {
        return Err(format!(
            "Expected won stage_id {}, got {}",
            stage_won.id, converted.stage_id
        ));
    }
    if converted.date_closed.is_none() {
        return Err("Expected date_closed set after convert".to_string());
    }

    let has_so = ctx.db.sale_order().iter().any(|so| {
        so.organization_id == org_id && so.opportunity_id == Some(opp.id)
    });
    if !has_so {
        return Err("Expected sale order linked to opportunity after convert".to_string());
    }

    Ok(())
}

/// Mirrors lead conversion: opportunity exists at org scope without company_id until first line.
pub fn test_create_opportunity_line_on_unscoped_opportunity(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    let stage = ctx.db.opp_stage().insert(OpportunityStage {
        id: 0,
        organization_id: org_id,
        name: "Harness Unscoped Stage".to_string(),
        sequence: 1,
        probability: 10.0,
        requirements: None,
        fold: false,
        is_won: false,
        team_id: None,
        is_active: true,
        metadata: Some(r#"{"harness":true}"#.to_string()),
    });

    let opp = ctx.db.opportunity().insert(crate::crm::opportunities::Opportunity {
        id: 0,
        organization_id: org_id,
        lead_id: None,
        name: "Harness Lead-Converted Opp".to_string(),
        expected_revenue: 1_000.0,
        probability: 10.0,
        stage_id: stage.id,
        priority: "medium".to_string(),
        color: None,
        partner_id: Some(fixture.partner_id),
        contact_id: Some(fixture.partner_id),
        campaign_id: None,
        medium_id: None,
        source_id: None,
        user_id: None,
        team_id: None,
        company_currency_id: Some(1),
        company_id: None,
        date_open: Some(ctx.timestamp),
        date_closed: None,
        date_deadline: None,
        date_last_stage_update: Some(ctx.timestamp),
        day_open: None,
        day_close: None,
        is_won: false,
        is_lost: false,
        lost_reason_id: None,
        description: None,
        tag_ids: vec![],
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        deleted_at: None,
        metadata: Some(r#"{"test":"unscoped_opp_line"}"#.to_string()),
    });

    create_opportunity_line(
        ctx,
        org_id,
        company_id,
        opp.id,
        CreateOpportunityLineParams {
            product_id: fixture.product_id,
            name: Some("Unscoped opp line".to_string()),
            quantity: 2.0,
            uom_id: 1,
            price_unit: 50.0,
            discount: 0.0,
            tax_ids: vec![],
            sequence: 1,
            metadata: None,
        },
    )?;

    let updated = ctx
        .db
        .opportunity()
        .id()
        .find(&opp.id)
        .ok_or("Opportunity not found after line create")?;

    if updated.company_id != Some(company_id) {
        return Err(format!(
            "Expected company_id Some({company_id}), got {:?}",
            updated.company_id
        ));
    }

    let line_count = ctx
        .db
        .opportunity_line()
        .iter()
        .filter(|l| l.opportunity_id == opp.id)
        .count();
    if line_count != 1 {
        return Err(format!("Expected 1 opportunity line, got {line_count}"));
    }

    Ok(())
}
