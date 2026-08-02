/// CRM opportunity lifecycle domain tests — in-module test helpers.
///
/// No `create_opp_stage` reducer exists yet; stages are inserted directly
/// (mirrors `seed.rs`) so `convert_opportunity_to_sale_order` can find a won stage.
use spacetimedb::{ReducerContext, Table};

use crate::crm::opportunities::{
    convert_opportunity_to_sale_order, create_opportunity, create_opportunity_line, opp_stage,
    opportunity, opportunity_line, update_opportunity, ConvertOpportunityParams,
    CreateOpportunityLineParams, CreateOpportunityParams, OpportunityLine, OpportunityStage,
    UpdateOpportunityParams,
};
use crate::inventory::product::product;
use crate::sales::pricelists::{create_pricelist, product_pricelist, CreatePricelistParams};
use crate::sales::sales_core::{sale_order, sale_order_line};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::DiscountPolicy;

const R2_DISTINCT_CURRENCY: u64 = 42;

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

    let has_so = ctx
        .db
        .sale_order()
        .iter()
        .any(|so| so.organization_id == org_id && so.opportunity_id == Some(opp.id));
    if !has_so {
        return Err("Expected sale order linked to opportunity after convert".to_string());
    }

    Ok(())
}

/// R2: Opp→SO with null company_currency_id → Err; no magic currency `1` SO.
pub fn test_convert_opp_missing_currency_fail_closed(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    let _stage_qualify = ctx.db.opp_stage().insert(OpportunityStage {
        id: 0,
        organization_id: org_id,
        name: "R2 Qual".to_string(),
        sequence: 1,
        probability: 10.0,
        requirements: None,
        fold: false,
        is_won: false,
        team_id: None,
        is_active: true,
        metadata: Some(r#"{"test":"r2_currency"}"#.to_string()),
    });
    let _stage_won = ctx.db.opp_stage().insert(OpportunityStage {
        id: 0,
        organization_id: org_id,
        name: "R2 Won".to_string(),
        sequence: 10,
        probability: 100.0,
        requirements: None,
        fold: true,
        is_won: true,
        team_id: None,
        is_active: true,
        metadata: Some(r#"{"test":"r2_currency"}"#.to_string()),
    });

    create_pricelist(
        ctx,
        org_id,
        CreatePricelistParams {
            name: "R2 Currency PL".to_string(),
            currency_id: R2_DISTINCT_CURRENCY,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;
    let pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == "R2 Currency PL")
        .map(|p| p.id)
        .ok_or("Pricelist not found")?;

    create_opportunity(
        ctx,
        org_id,
        CreateOpportunityParams {
            name: "R2 Missing Currency Opp".to_string(),
            expected_revenue: 1_000.0,
            probability: 30.0,
            stage_id: _stage_qualify.id,
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
            company_currency_id: None,
            lost_reason_id: None,
            date_open: Some(ctx.timestamp),
            date_closed: None,
            date_deadline: None,
            date_last_stage_update: Some(ctx.timestamp),
            day_open: None,
            day_close: None,
            color: None,
            description: Some("R2 currency fail-closed".to_string()),
            metadata: Some(r#"{"test":"r2_missing_currency"}"#.to_string()),
        },
    )?;

    let opp = ctx
        .db
        .opportunity()
        .iter()
        .find(|o| o.organization_id == org_id && o.name == "R2 Missing Currency Opp")
        .ok_or("Opportunity not found")?;

    let product = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("product")?;
    create_opportunity_line(
        ctx,
        org_id,
        company_id,
        opp.id,
        CreateOpportunityLineParams {
            product_id: fixture.product_id,
            name: Some("R2 line".to_string()),
            quantity: 1.0,
            uom_id: product.uom_id,
            price_unit: 100.0,
            discount: 0.0,
            tax_ids: vec![],
            sequence: 1,
            metadata: None,
        },
    )?;

    let so_before = ctx
        .db
        .sale_order()
        .iter()
        .filter(|so| so.organization_id == org_id && so.opportunity_id == Some(opp.id))
        .count();

    let err = convert_opportunity_to_sale_order(
        ctx,
        org_id,
        company_id,
        opp.id,
        ConvertOpportunityParams {
            pricelist_id,
            warehouse_id: fixture.warehouse_id,
        },
    )
    .expect_err("missing company_currency_id must fail closed");

    if !err.contains("company_currency_id") {
        return Err(format!("Expected company_currency_id error, got: {err}"));
    }

    let so_after = ctx
        .db
        .sale_order()
        .iter()
        .filter(|so| so.organization_id == org_id && so.opportunity_id == Some(opp.id))
        .count();
    if so_after != so_before {
        return Err("Ghost SO created despite missing currency".into());
    }

    let magic_currency_so = ctx.db.sale_order().iter().any(|so| {
        so.organization_id == org_id && so.opportunity_id == Some(opp.id) && so.currency_id == 1
    });
    if magic_currency_so {
        return Err("Magic currency_id=1 SO persisted".into());
    }

    let opp_after = ctx
        .db
        .opportunity()
        .id()
        .find(&opp.id)
        .ok_or("opp after fail")?;
    if opp_after.is_won {
        return Err("Opportunity must not be marked won on failed convert".into());
    }

    Ok(())
}

/// R2: Opp→SO with missing/zero UoM → Err; no magic uom `1` on SO lines.
pub fn test_convert_opp_missing_uom_fail_closed(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    let stage_qualify = ctx.db.opp_stage().insert(OpportunityStage {
        id: 0,
        organization_id: org_id,
        name: "R2 UoM Qual".to_string(),
        sequence: 1,
        probability: 10.0,
        requirements: None,
        fold: false,
        is_won: false,
        team_id: None,
        is_active: true,
        metadata: Some(r#"{"test":"r2_uom"}"#.to_string()),
    });
    let _stage_won = ctx.db.opp_stage().insert(OpportunityStage {
        id: 0,
        organization_id: org_id,
        name: "R2 UoM Won".to_string(),
        sequence: 10,
        probability: 100.0,
        requirements: None,
        fold: true,
        is_won: true,
        team_id: None,
        is_active: true,
        metadata: Some(r#"{"test":"r2_uom"}"#.to_string()),
    });

    create_pricelist(
        ctx,
        org_id,
        CreatePricelistParams {
            name: "R2 UoM PL".to_string(),
            currency_id: R2_DISTINCT_CURRENCY,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;
    let pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == "R2 UoM PL")
        .map(|p| p.id)
        .ok_or("Pricelist not found")?;

    create_opportunity(
        ctx,
        org_id,
        CreateOpportunityParams {
            name: "R2 Missing UoM Opp".to_string(),
            expected_revenue: 1_000.0,
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
            company_currency_id: Some(R2_DISTINCT_CURRENCY),
            lost_reason_id: None,
            date_open: Some(ctx.timestamp),
            date_closed: None,
            date_deadline: None,
            date_last_stage_update: Some(ctx.timestamp),
            day_open: None,
            day_close: None,
            color: None,
            description: Some("R2 uom fail-closed".to_string()),
            metadata: Some(r#"{"test":"r2_missing_uom"}"#.to_string()),
        },
    )?;

    let opp = ctx
        .db
        .opportunity()
        .iter()
        .find(|o| o.organization_id == org_id && o.name == "R2 Missing UoM Opp")
        .ok_or("Opportunity not found")?;

    // Zero both line UoM and product UoM so convert cannot fall back to a real unit.
    let product = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("product")?;
    ctx.db
        .product()
        .id()
        .update(crate::inventory::product::Product {
            uom_id: 0,
            ..product
        });

    ctx.db.opportunity_line().insert(OpportunityLine {
        id: 0,
        organization_id: org_id,
        company_id,
        opportunity_id: opp.id,
        product_id: Some(fixture.product_id),
        name: "R2 zero uom line".to_string(),
        quantity: 1.0,
        uom_id: None,
        price_unit: 50.0,
        price_subtotal: 50.0,
        discount: 0.0,
        tax_ids: vec![],
        sequence: 1,
        created_at: ctx.timestamp,
        metadata: Some(r#"{"test":"r2_missing_uom"}"#.to_string()),
    });

    let so_before = ctx
        .db
        .sale_order()
        .iter()
        .filter(|so| so.organization_id == org_id && so.opportunity_id == Some(opp.id))
        .count();

    let err = convert_opportunity_to_sale_order(
        ctx,
        org_id,
        company_id,
        opp.id,
        ConvertOpportunityParams {
            pricelist_id,
            warehouse_id: fixture.warehouse_id,
        },
    )
    .expect_err("missing UoM must fail closed");

    if !err.contains("UoM") && !err.to_lowercase().contains("uom") {
        return Err(format!("Expected UoM error, got: {err}"));
    }

    let so_after = ctx
        .db
        .sale_order()
        .iter()
        .filter(|so| so.organization_id == org_id && so.opportunity_id == Some(opp.id))
        .count();
    if so_after != so_before {
        return Err("Ghost SO created despite missing UoM".into());
    }

    let magic_uom_line = ctx.db.sale_order_line().iter().any(|l| {
        l.organization_id == org_id
            && l.product_id == fixture.product_id
            && l.name == "R2 zero uom line"
            && l.product_uom == 1
    });
    if magic_uom_line {
        return Err("Magic product_uom=1 SO line persisted".into());
    }

    Ok(())
}

/// R2 happy path: distinctive currency/UoM are persisted (not magic `1`).
pub fn test_convert_opp_distinctive_currency_uom(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    let product = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("product")?;
    let expected_uom = product.uom_id;
    if expected_uom == 0 {
        return Err("Harness product must have non-zero uom_id".into());
    }

    let stage_qualify = ctx.db.opp_stage().insert(OpportunityStage {
        id: 0,
        organization_id: org_id,
        name: "R2 Distinct Qual".to_string(),
        sequence: 1,
        probability: 10.0,
        requirements: None,
        fold: false,
        is_won: false,
        team_id: None,
        is_active: true,
        metadata: Some(r#"{"test":"r2_distinct"}"#.to_string()),
    });
    let _stage_won = ctx.db.opp_stage().insert(OpportunityStage {
        id: 0,
        organization_id: org_id,
        name: "R2 Distinct Won".to_string(),
        sequence: 10,
        probability: 100.0,
        requirements: None,
        fold: true,
        is_won: true,
        team_id: None,
        is_active: true,
        metadata: Some(r#"{"test":"r2_distinct"}"#.to_string()),
    });

    create_pricelist(
        ctx,
        org_id,
        CreatePricelistParams {
            name: "R2 Distinct PL".to_string(),
            currency_id: R2_DISTINCT_CURRENCY,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;
    let pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == "R2 Distinct PL")
        .map(|p| p.id)
        .ok_or("Pricelist not found")?;

    create_opportunity(
        ctx,
        org_id,
        CreateOpportunityParams {
            name: "R2 Distinct Opp".to_string(),
            expected_revenue: 2_500.0,
            probability: 40.0,
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
            company_currency_id: Some(R2_DISTINCT_CURRENCY),
            lost_reason_id: None,
            date_open: Some(ctx.timestamp),
            date_closed: None,
            date_deadline: None,
            date_last_stage_update: Some(ctx.timestamp),
            day_open: None,
            day_close: None,
            color: None,
            description: Some("R2 distinctive FKs".to_string()),
            metadata: Some(r#"{"test":"r2_distinct"}"#.to_string()),
        },
    )?;

    let opp = ctx
        .db
        .opportunity()
        .iter()
        .find(|o| o.organization_id == org_id && o.name == "R2 Distinct Opp")
        .ok_or("Opportunity not found")?;

    // Line omits UoM (None) so convert must derive product.uom_id — not magic 1.
    ctx.db.opportunity_line().insert(OpportunityLine {
        id: 0,
        organization_id: org_id,
        company_id,
        opportunity_id: opp.id,
        product_id: Some(fixture.product_id),
        name: "R2 derive uom".to_string(),
        quantity: 2.0,
        uom_id: None,
        price_unit: 25.0,
        price_subtotal: 50.0,
        discount: 0.0,
        tax_ids: vec![],
        sequence: 1,
        created_at: ctx.timestamp,
        metadata: Some(r#"{"test":"r2_distinct"}"#.to_string()),
    });

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

    let so = ctx
        .db
        .sale_order()
        .iter()
        .find(|so| so.organization_id == org_id && so.opportunity_id == Some(opp.id))
        .ok_or("SO missing after convert")?;

    if so.currency_id != R2_DISTINCT_CURRENCY {
        return Err(format!(
            "Expected currency_id={R2_DISTINCT_CURRENCY}, got {}",
            so.currency_id
        ));
    }

    let line = ctx
        .db
        .sale_order_line()
        .order_line_by_order()
        .filter(&so.id)
        .find(|l| l.name == "R2 derive uom")
        .ok_or("SO line missing")?;

    if line.product_uom != expected_uom {
        return Err(format!(
            "Expected product_uom={expected_uom} from product, got {}",
            line.product_uom
        ));
    }
    if expected_uom != 1 && line.product_uom == 1 {
        return Err("Magic uom 1 used instead of product.uom_id".into());
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

    let opp = ctx
        .db
        .opportunity()
        .insert(crate::crm::opportunities::Opportunity {
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

pub fn test_opportunity_stage_transition(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    let stage_open = ctx.db.opp_stage().insert(OpportunityStage {
        id: 0,
        organization_id: org_id,
        name: "Harness Open".to_string(),
        sequence: 1,
        probability: 20.0,
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
        name: "Harness Closed Won".to_string(),
        sequence: 10,
        probability: 100.0,
        requirements: None,
        fold: true,
        is_won: true,
        team_id: None,
        is_active: true,
        metadata: Some(r#"{"harness":true}"#.to_string()),
    });

    create_opportunity(
        ctx,
        org_id,
        CreateOpportunityParams {
            name: "Harness Stage Opp".to_string(),
            expected_revenue: 2_000.0,
            probability: 20.0,
            stage_id: stage_open.id,
            priority: "medium".to_string(),
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
            description: None,
            metadata: Some(r#"{"test":"stage_transition"}"#.to_string()),
        },
    )?;

    let opp = ctx
        .db
        .opportunity()
        .iter()
        .find(|o| o.organization_id == org_id && o.name == "Harness Stage Opp")
        .ok_or("Opportunity not found after create")?;

    update_opportunity(
        ctx,
        org_id,
        company_id,
        opp.id,
        UpdateOpportunityParams {
            stage_id: Some(stage_won.id),
            name: None,
            expected_revenue: None,
            probability: None,
            priority: None,
            is_won: None,
            is_lost: None,
            partner_id: None,
            contact_id: None,
            date_deadline: None,
            date_closed: None,
            lost_reason_id: None,
            description: None,
            tag_ids: None,
        },
    )?;

    let updated = ctx
        .db
        .opportunity()
        .id()
        .find(&opp.id)
        .ok_or("Opportunity not found after stage update")?;

    if updated.stage_id != stage_won.id {
        return Err("Opportunity stage_id did not update".to_string());
    }
    if !updated.is_won {
        return Err("Expected opportunity marked won after won stage".to_string());
    }

    Ok(())
}
