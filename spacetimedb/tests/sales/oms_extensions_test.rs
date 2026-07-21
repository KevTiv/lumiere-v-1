//! OMS extension domain tests — fiscal remap, Incoterm, promotion, options, commission.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::tax_management::{
    account_tax, create_account_tax, CreateAccountTaxParams,
};
use crate::inventory::product::product;
use crate::sales::oms_extensions::{
    account_fiscal_position, account_fiscal_position_tax, account_incoterm, accrue_sale_commission,
    apply_sale_order_options, apply_sale_promotion_to_order, create_fiscal_position,
    create_fiscal_position_tax, create_incoterm, create_sale_order_option, create_sale_promotion,
    sale_commission, AccrueSaleCommissionParams, ApplySalePromotionParams,
    CreateFiscalPositionParams, CreateFiscalPositionTaxParams, CreateIncotermParams,
    CreateSaleOrderOptionParams, CreateSalePromotionParams,
};
use crate::sales::pricelists::{create_pricelist, product_pricelist, CreatePricelistParams};
use crate::sales::sales_core::{
    confirm_sales_order, create_sale_order, sale_order, sale_order_line, sale_order_option,
    CreateSaleOrderLineParams, CreateSaleOrderParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{DiscountPolicy, TaxAmountType, TaxTypeUse};

fn seed_pricelist(ctx: &ReducerContext, org_id: u64, name: &str) -> Result<u64, String> {
    create_pricelist(
        ctx,
        org_id,
        CreatePricelistParams {
            name: name.to_string(),
            currency_id: 1,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;
    ctx.db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == name)
        .map(|p| p.id)
        .ok_or_else(|| format!("Pricelist {name} not found"))
}

fn create_two_taxes(
    ctx: &ReducerContext,
    org_id: u64,
    company_id: u64,
) -> Result<(u64, u64), String> {
    create_account_tax(
        ctx,
        org_id,
        company_id,
        CreateAccountTaxParams {
            name: "VAT Standard".to_string(),
            description: None,
            type_tax_use: TaxTypeUse::Sale,
            amount_type: TaxAmountType::Percent,
            amount: 20.0,
            active: true,
            price_include: false,
            include_base_amount: false,
            is_base_affected: false,
            sequence: 10,
            tax_group_id: None,
            country_id: None,
            country_code: None,
            tags: vec![],
            has_negative_factor: false,
            invoice_repartition_line_ids: vec![],
            refund_repartition_line_ids: vec![],
            metadata: None,
        },
    )?;
    create_account_tax(
        ctx,
        org_id,
        company_id,
        CreateAccountTaxParams {
            name: "VAT Reduced".to_string(),
            description: None,
            type_tax_use: TaxTypeUse::Sale,
            amount_type: TaxAmountType::Percent,
            amount: 5.0,
            active: true,
            price_include: false,
            include_base_amount: false,
            is_base_affected: false,
            sequence: 20,
            tax_group_id: None,
            country_id: None,
            country_code: None,
            tags: vec![],
            has_negative_factor: false,
            invoice_repartition_line_ids: vec![],
            refund_repartition_line_ids: vec![],
            metadata: None,
        },
    )?;
    let std_id = ctx
        .db
        .account_tax()
        .iter()
        .find(|t| t.organization_id == org_id && t.name == "VAT Standard")
        .map(|t| t.id)
        .ok_or("VAT Standard not found")?;
    let red_id = ctx
        .db
        .account_tax()
        .iter()
        .find(|t| t.organization_id == org_id && t.name == "VAT Reduced")
        .map(|t| t.id)
        .ok_or("VAT Reduced not found")?;
    Ok((std_id, red_id))
}

pub fn test_fiscal_position_tax_remap(ctx: &ReducerContext) -> Result<(), String> {
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
    let (tax_std, tax_red) = create_two_taxes(ctx, org_id, company_id)?;
    create_fiscal_position(
        ctx,
        org_id,
        CreateFiscalPositionParams {
            company_id: Some(company_id),
            name: "Export FP".to_string(),
            is_active: true,
            metadata: None,
        },
    )?;
    let fp_id = ctx
        .db
        .account_fiscal_position()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == "Export FP")
        .map(|p| p.id)
        .ok_or("FP not found")?;
    create_fiscal_position_tax(
        ctx,
        org_id,
        CreateFiscalPositionTaxParams {
            fiscal_position_id: fp_id,
            tax_src_id: tax_std,
            tax_dest_id: Some(tax_red),
            sequence: 1,
            metadata: None,
        },
    )?;
    let _ = ctx
        .db
        .account_fiscal_position_tax()
        .fiscal_tax_by_position()
        .filter(&fp_id)
        .next()
        .ok_or("tax map not found")?;

    let pricelist_id = seed_pricelist(ctx, org_id, "FP Pricelist")?;
    create_sale_order(
        ctx,
        org_id,
        CreateSaleOrderParams {
            company_id: Some(company_id),
            partner_id: fixture.partner_id,
            partner_invoice_id: fixture.partner_id,
            partner_shipping_id: fixture.partner_id,
            pricelist_id,
            currency_id: 1,
            warehouse_id: fixture.warehouse_id,
            order_lines: vec![CreateSaleOrderLineParams {
                product_id: fixture.product_id,
                quantity: 1.0,
                uom_id: product.uom_id,
                price_unit: Some(100.0),
                discount: 0.0,
                tax_ids: vec![tax_std],
                name: None,
                sequence: 1,
                is_downpayment: false,
                display_type: None,
                product_variant_id: None,
                packaging_id: None,
                route_id: None,
                analytic_tag_ids: vec![],
                customer_lead: None,
                metadata: None,
            }],
            origin: Some("fp-remap".into()),
            client_order_ref: Some("HARNESS-FP".into()),
            payment_term_id: None,
            fiscal_position_id: Some(fp_id),
            team_id: None,
            opportunity_id: None,
            proposal_id: None,
            note: None,
            terms_and_conditions: None,
            validity_days: None,
            shipping_policy: None,
            picking_policy: None,
            campaign_id: None,
            medium_id: None,
            source_id: None,
            commitment_date: None,
            expected_date: None,
            incoterm_id: None,
            incoterm: None,
            incoterm_location: None,
            carrier_id: None,
            customer_lead: None,
            analytic_account_id: None,
            user_id: None,
            is_printed: None,
            is_locked: None,
            is_dropship: None,
            invoice_policy: None,
            message_follower_ids: None,
            message_partner_ids: None,
            message_channel_ids: None,
            activity_ids: None,
            metadata: None,
        },
    )?;

    let order = ctx
        .db
        .sale_order()
        .iter()
        .find(|o| o.client_order_ref == Some("HARNESS-FP".into()))
        .ok_or("SO not found")?;
    let line = ctx
        .db
        .sale_order_line()
        .order_line_by_order()
        .filter(&order.id)
        .next()
        .ok_or("line not found")?;
    if line.tax_id != vec![tax_red] {
        return Err(format!(
            "Expected remapped tax {:?}, got {:?}",
            tax_red, line.tax_id
        ));
    }
    // 5% of 100 = 5
    if (line.price_tax - 5.0).abs() > 1e-6 {
        return Err(format!("Expected tax 5.0 after remap, got {}", line.price_tax));
    }
    Ok(())
}

pub fn test_incoterm_id_and_promotion_and_options(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let product = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("product")?;

    create_incoterm(
        ctx,
        org_id,
        CreateIncotermParams {
            code: "FOB".into(),
            name: "Free On Board".into(),
            is_active: true,
            metadata: None,
        },
    )?;
    let incoterm_id = ctx
        .db
        .account_incoterm()
        .iter()
        .find(|i| i.organization_id == org_id && i.code == "FOB")
        .map(|i| i.id)
        .ok_or("incoterm")?;

    let pricelist_id = seed_pricelist(ctx, org_id, "Promo Pricelist")?;
    create_sale_order(
        ctx,
        org_id,
        CreateSaleOrderParams {
            company_id: Some(fixture.company_id),
            partner_id: fixture.partner_id,
            partner_invoice_id: fixture.partner_id,
            partner_shipping_id: fixture.partner_id,
            pricelist_id,
            currency_id: 1,
            warehouse_id: fixture.warehouse_id,
            order_lines: vec![CreateSaleOrderLineParams {
                product_id: fixture.product_id,
                quantity: 2.0,
                uom_id: product.uom_id,
                price_unit: Some(50.0),
                discount: 0.0,
                tax_ids: vec![],
                name: None,
                sequence: 1,
                is_downpayment: false,
                display_type: None,
                product_variant_id: None,
                packaging_id: None,
                route_id: None,
                analytic_tag_ids: vec![],
                customer_lead: None,
                metadata: None,
            }],
            origin: Some("promo-test".into()),
            client_order_ref: Some("HARNESS-PROMO".into()),
            payment_term_id: None,
            fiscal_position_id: None,
            team_id: None,
            opportunity_id: None,
            proposal_id: None,
            note: None,
            terms_and_conditions: None,
            validity_days: None,
            shipping_policy: None,
            picking_policy: None,
            campaign_id: None,
            medium_id: None,
            source_id: Some(1),
            commitment_date: None,
            expected_date: None,
            incoterm_id: Some(incoterm_id),
            incoterm: None,
            incoterm_location: Some("Shanghai".into()),
            carrier_id: None,
            customer_lead: None,
            analytic_account_id: None,
            user_id: None,
            is_printed: None,
            is_locked: None,
            is_dropship: None,
            invoice_policy: None,
            message_follower_ids: None,
            message_partner_ids: None,
            message_channel_ids: None,
            activity_ids: None,
            metadata: Some(r#"{"commission_rate_percent":10.0}"#.into()),
        },
    )?;

    let order = ctx
        .db
        .sale_order()
        .iter()
        .find(|o| o.client_order_ref == Some("HARNESS-PROMO".into()))
        .ok_or("SO not found")?;
    if order.incoterm_id != Some(incoterm_id) {
        return Err("incoterm_id not stored".into());
    }
    if order.incoterm.as_deref() != Some("FOB") {
        return Err(format!("expected incoterm code FOB, got {:?}", order.incoterm));
    }

    create_sale_promotion(
        ctx,
        org_id,
        CreateSalePromotionParams {
            company_id: Some(fixture.company_id),
            code: "SAVE10".into(),
            name: "10% off".into(),
            discount_percent: 10.0,
            discount_fixed: 0.0,
            min_amount: 0.0,
            is_active: true,
            date_start: None,
            date_end: None,
            metadata: None,
        },
    )?;
    apply_sale_promotion_to_order(
        ctx,
        org_id,
        order.id,
        ApplySalePromotionParams {
            promotion_code: "SAVE10".into(),
        },
    )?;
    let line = ctx
        .db
        .sale_order_line()
        .order_line_by_order()
        .filter(&order.id)
        .next()
        .ok_or("line")?;
    if (line.discount - 10.0).abs() > 1e-6 {
        return Err(format!("expected discount 10, got {}", line.discount));
    }

    create_sale_order_option(
        ctx,
        org_id,
        order.id,
        CreateSaleOrderOptionParams {
            product_id: fixture.product_id,
            name: "Add-on option".into(),
            quantity: 1.0,
            uom_id: product.uom_id,
            price_unit: 15.0,
            discount: 0.0,
            is_present: true,
            metadata: None,
        },
    )?;
    apply_sale_order_options(ctx, org_id, order.id)?;
    let opt = ctx
        .db
        .sale_order_option()
        .iter()
        .find(|o| o.order_id == order.id)
        .ok_or("option")?;
    if opt.line_id.is_none() {
        return Err("option not materialised to line".into());
    }

    confirm_sales_order(ctx, org_id, order.id)?;
    // Commission accrues on invoice post (or manual accrue), not on confirm.
    let on_confirm = ctx
        .db
        .sale_commission()
        .commission_by_order()
        .filter(&order.id)
        .count();
    if on_confirm != 0 {
        return Err(format!(
            "expected no commission on confirm, got {on_confirm}"
        ));
    }
    accrue_sale_commission(
        ctx,
        org_id,
        order.id,
        AccrueSaleCommissionParams {
            rate_percent: 10.0,
        },
    )?;
    let commission = ctx
        .db
        .sale_commission()
        .commission_by_order()
        .filter(&order.id)
        .next()
        .ok_or("commission not accrued after manual accrue")?;
    if commission.state != "accrued" {
        return Err(format!("expected accrued, got {}", commission.state));
    }
    // Manual accrue idempotent
    accrue_sale_commission(
        ctx,
        org_id,
        order.id,
        AccrueSaleCommissionParams {
            rate_percent: 10.0,
        },
    )?;
    let count = ctx
        .db
        .sale_commission()
        .commission_by_order()
        .filter(&order.id)
        .filter(|c| c.state != "cancelled")
        .count();
    if count != 1 {
        return Err(format!("expected 1 commission row, got {count}"));
    }
    Ok(())
}
