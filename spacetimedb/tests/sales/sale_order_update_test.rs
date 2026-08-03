/// Draft sale order update domain tests.
use spacetimedb::{ReducerContext, Table};

use crate::inventory::product::product;
use crate::sales::pricelists::{create_pricelist, product_pricelist, CreatePricelistParams};
use crate::sales::sales_core::{
    create_sale_order, sale_order, update_sale_order, CreateSaleOrderLineParams,
    CreateSaleOrderParams, UpdateSaleOrderParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{DiscountPolicy, SaleState};

pub fn test_draft_sale_order_update(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    let product = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("Harness product not found")?;

    create_pricelist(
        ctx,
        org_id,
        CreatePricelistParams {
            name: "Harness Update Pricelist".to_string(),
            currency_id: 1,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;

    let pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == "Harness Update Pricelist")
        .map(|p| p.id)
        .ok_or("Pricelist not found after create")?;

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
                quantity: 2.0,
                uom_id: product.uom_id,
                price_unit: Some(product.list_price),
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
            origin: Some("Harness SO update".to_string()),
            client_order_ref: Some("HARNESS-SO-UPD".to_string()),
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
            metadata: Some(r#"{"test":"draft_sale_order_update"}"#.to_string()),
        },
    )?;

    let order = ctx
        .db
        .sale_order()
        .iter()
        .find(|o| {
            o.organization_id == org_id && o.client_order_ref == Some("HARNESS-SO-UPD".to_string())
        })
        .ok_or("Sale order not found after create")?;

    if order.state != SaleState::Draft {
        return Err(format!(
            "Expected Draft state before update, got {:?}",
            order.state
        ));
    }

    update_sale_order(
        ctx,
        org_id,
        company_id,
        order.id,
        UpdateSaleOrderParams {
            client_order_ref: Some("HARNESS-UPDATED".to_string()),
            note: None,
            terms_and_conditions: None,
            partner_invoice_id: None,
            partner_shipping_id: None,
            pricelist_id: None,
            warehouse_id: None,
            commitment_date: None,
            expected_date: None,
            shipping_policy: None,
            picking_policy: None,
            validity_date: None,
            carrier_id: None,
            incoterm_id: None,
            incoterm: None,
            incoterm_location: None,
            customer_lead: None,
            analytic_account_id: None,
            user_id: None,
            is_dropship: None,
            metadata: None,
        },
    )?;

    let updated = ctx
        .db
        .sale_order()
        .id()
        .find(&order.id)
        .ok_or("Sale order not found after update")?;

    if updated.client_order_ref != Some("HARNESS-UPDATED".to_string()) {
        return Err(format!(
            "client_order_ref not updated: expected HARNESS-UPDATED, got {:?}",
            updated.client_order_ref
        ));
    }

    if updated.state != SaleState::Draft {
        return Err(format!(
            "Expected Draft state after update, got {:?}",
            updated.state
        ));
    }

    Ok(())
}
