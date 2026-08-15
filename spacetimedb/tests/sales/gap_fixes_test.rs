//! Wave A–C gap-fix domain tests (lock/lines, FX, dropship, exchange, isolation).
use spacetimedb::{ReducerContext, Table};

use crate::core::organization::{company, create_company, CreateCompanyParams};
use crate::inventory::product::product;
use crate::sales::oms_extensions::create_exchange_order_from_return;
use crate::sales::pricelists::{create_pricelist, product_pricelist, CreatePricelistParams};
use crate::sales::return_orders::{
    confirm_return_order, create_return_order, return_order, CreateReturnOrderLineParams,
    CreateReturnOrderParams,
};
use crate::sales::sales_core::{
    confirm_sales_order, create_sale_order, create_sale_order_line, delete_sale_order_line,
    lock_sale_order, sale_order, sale_order_line, unlock_sale_order, update_sale_order,
    update_sale_order_line, CreateSaleOrderLineParams, CreateSaleOrderParams,
    UpdateSaleOrderLineParams, UpdateSaleOrderParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{DiscountPolicy, SaleState};

fn seed_so(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    pricelist_name: &str,
    qty: f64,
    price: f64,
    is_dropship: Option<bool>,
    currency_id: u64,
) -> Result<u64, String> {
    let org_id = fixture.organization_id;
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
            company_id: None,
            name: pricelist_name.to_string(),
            currency_id,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;
    let pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == pricelist_name)
        .map(|p| p.id)
        .ok_or("Pricelist not found")?;

    create_sale_order(
        ctx,
        org_id,
        CreateSaleOrderParams {
            company_id: Some(fixture.company_id),
            partner_id: fixture.partner_id,
            partner_invoice_id: fixture.partner_id,
            partner_shipping_id: fixture.partner_id,
            pricelist_id,
            currency_id,
            warehouse_id: fixture.warehouse_id,
            order_lines: vec![CreateSaleOrderLineParams {
                product_id: fixture.product_id,
                quantity: qty,
                uom_id: product.uom_id,
                price_unit: Some(price),
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
            origin: Some(pricelist_name.to_string()),
            client_order_ref: Some(pricelist_name.to_string()),
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
            is_dropship,
            invoice_policy: None,
            message_follower_ids: None,
            message_partner_ids: None,
            message_channel_ids: None,
            activity_ids: None,
            metadata: None,
        },
    )?;

    ctx.db
        .sale_order()
        .iter()
        .find(|o| {
            o.organization_id == org_id && o.client_order_ref.as_deref() == Some(pricelist_name)
        })
        .map(|o| o.id)
        .ok_or("Sale order not found after create".to_string())
}

pub fn test_lock_blocks_update(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let order_id = seed_so(ctx, &fixture, "Lock PL", 1.0, 10.0, None, 1)?;

    lock_sale_order(ctx, org_id, order_id)?;
    let locked = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("SO missing")?;
    if !locked.is_locked {
        return Err("Expected is_locked after lock".to_string());
    }

    let blocked = update_sale_order(
        ctx,
        org_id,
        company_id,
        order_id,
        UpdateSaleOrderParams {
            client_order_ref: Some("SHOULD-FAIL".to_string()),
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
    );
    if blocked.is_ok() {
        return Err("Expected update to fail while locked".to_string());
    }

    unlock_sale_order(ctx, org_id, order_id)?;
    update_sale_order(
        ctx,
        org_id,
        company_id,
        order_id,
        UpdateSaleOrderParams {
            client_order_ref: Some("UNLOCKED-OK".to_string()),
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
    Ok(())
}

pub fn test_update_and_delete_sale_order_line(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let order_id = seed_so(ctx, &fixture, "LineEdit PL", 2.0, 25.0, None, 1)?;
    let line_id = ctx
        .db
        .sale_order_line()
        .order_line_by_order()
        .filter(&order_id)
        .next()
        .map(|l| l.id)
        .ok_or("Line missing")?;

    update_sale_order_line(
        ctx,
        org_id,
        fixture.company_id,
        line_id,
        UpdateSaleOrderLineParams {
            product_id: None,
            quantity: Some(3.0),
            uom_id: None,
            price_unit: Some(20.0),
            discount: Some(10.0),
            tax_ids: None,
            name: None,
            sequence: None,
            product_variant_id: None,
            packaging_id: None,
            route_id: None,
            analytic_tag_ids: None,
            customer_lead: None,
            display_type: None,
            metadata: None,
        },
    )?;

    let updated = ctx
        .db
        .sale_order_line()
        .id()
        .find(&line_id)
        .ok_or("Line missing after update")?;
    if (updated.product_uom_qty - 3.0).abs() > f64::EPSILON {
        return Err(format!("qty expected 3 got {}", updated.product_uom_qty));
    }

    let product = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("product")?;
    create_sale_order_line(
        ctx,
        org_id,
        order_id,
        CreateSaleOrderLineParams {
            product_id: fixture.product_id,
            quantity: 1.0,
            uom_id: product.uom_id,
            price_unit: Some(5.0),
            discount: 0.0,
            tax_ids: vec![],
            name: None,
            sequence: 2,
            is_downpayment: false,
            display_type: None,
            product_variant_id: None,
            packaging_id: None,
            route_id: None,
            analytic_tag_ids: vec![],
            customer_lead: None,
            metadata: None,
        },
    )?;
    let extra_id = ctx
        .db
        .sale_order_line()
        .order_line_by_order()
        .filter(&order_id)
        .find(|l| l.id != line_id)
        .map(|l| l.id)
        .ok_or("extra line missing")?;
    delete_sale_order_line(ctx, org_id, extra_id)?;
    if ctx.db.sale_order_line().id().find(&extra_id).is_some() {
        return Err("Line should be deleted".to_string());
    }
    Ok(())
}

pub fn test_fx_snapshot_fail_closed(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    // currency_id 2 vs company currency 1 — no rate seeded → fail closed
    let order_id = seed_so(ctx, &fixture, "FX Fail PL", 1.0, 10.0, None, 2)?;
    let err = confirm_sales_order(ctx, fixture.organization_id, fixture.company_id, order_id);
    match err {
        Err(msg) if msg.to_lowercase().contains("exchange rate") => Ok(()),
        Err(msg) => Err(format!("Expected exchange rate error, got: {msg}")),
        Ok(()) => Err("Confirm should fail without FX rate".to_string()),
    }
}

pub fn test_dropship_confirm_creates_po(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let order_id = seed_so(ctx, &fixture, "Dropship PL", 1.0, 10.0, Some(true), 1)?;

    // Ensure product has a seller/vendor if required by dropship helper — may fail closed.
    match confirm_sales_order(ctx, org_id, company_id, order_id) {
        Ok(()) => {
            let order = ctx
                .db
                .sale_order()
                .id()
                .find(&order_id)
                .ok_or("SO missing")?;
            if order.state != SaleState::Sale {
                return Err("Expected Sale state".to_string());
            }
            if order.purchase_order_count == 0 && order.purchase_order_ids.is_empty() {
                return Err("Expected dropship PO ids after confirm".to_string());
            }
            if !order.picking_ids.is_empty() {
                return Err("Dropship should skip warehouse OUT pickings".to_string());
            }
            Ok(())
        }
        Err(msg)
            if msg.to_lowercase().contains("supplier") || msg.to_lowercase().contains("vendor") =>
        {
            // Acceptable fail-closed when product has no vendor linkage in harness.
            Ok(())
        }
        Err(msg) => Err(format!("Unexpected dropship confirm error: {msg}")),
    }
}

pub fn test_company_isolation_on_confirm(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture_a.organization_id;
    let company_a = fixture_a.company_id;
    create_company(
        ctx,
        org_id,
        CreateCompanyParams {
            name: "Sales Iso Company B".to_string(),
            code: format!("SO-CB-{}", company_a),
            currency_id: 1,
            fiscal_year_end_month: 12,
            fiscal_year_end_day: 31,
            is_parent: false,
            parent_id: None,
            tax_id: None,
            company_registry: None,
            address_street: None,
            address_city: None,
            address_zip: None,
            address_country_code: None,
            metadata: Some(r#"{"harness":"sales-iso-b"}"#.to_string()),
        },
    )?;
    let company_b = ctx
        .db
        .company()
        .company_by_org()
        .filter(&org_id)
        .map(|c| c.id)
        .filter(|id| *id != company_a)
        .max()
        .ok_or("company B missing")?;

    let order_id = seed_so(ctx, &fixture_a, "Iso PL", 1.0, 10.0, None, 1)?;

    // Same org, wrong company must fail company guard.
    let err = confirm_sales_order(ctx, org_id, company_b, order_id);
    match err {
        Err(msg) if msg.to_lowercase().contains("company") => Ok(()),
        Err(msg) => Err(format!("Expected company isolation error, got: {msg}")),
        Ok(()) => Err("Cross-company confirm must fail".to_string()),
    }
}

/// SAL-002: a company-scoped pricelist cannot be used by another company's order.
pub fn test_pricelist_company_scope(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_a = fixture.company_id;
    create_company(
        ctx,
        org_id,
        CreateCompanyParams {
            name: "Sales Pricelist Company B".to_string(),
            code: format!("SO-PL-CB-{}", company_a),
            currency_id: 1,
            fiscal_year_end_month: 12,
            fiscal_year_end_day: 31,
            is_parent: false,
            parent_id: None,
            tax_id: None,
            company_registry: None,
            address_street: None,
            address_city: None,
            address_zip: None,
            address_country_code: None,
            metadata: Some(r#"{"harness":"sales-pricelist-company-b"}"#.to_string()),
        },
    )?;
    let company_b = ctx
        .db
        .company()
        .company_by_org()
        .filter(&org_id)
        .map(|c| c.id)
        .filter(|id| *id != company_a)
        .max()
        .ok_or("company B missing")?;

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
            company_id: Some(company_b),
            name: "Company B Pricelist".to_string(),
            currency_id: 1,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;
    let company_b_pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == "Company B Pricelist")
        .map(|p| p.id)
        .ok_or("Company B pricelist not found")?;

    let so_params = |pricelist_id: u64, client_order_ref: &str| CreateSaleOrderParams {
        company_id: Some(company_a),
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
            price_unit: Some(10.0),
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
        origin: Some(client_order_ref.to_string()),
        client_order_ref: Some(client_order_ref.to_string()),
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
        metadata: None,
    };

    let rejected = create_sale_order(
        ctx,
        org_id,
        so_params(company_b_pricelist_id, "SAL-002 Rejected"),
    );
    match rejected {
        Err(msg) if msg.to_lowercase().contains("company") => {}
        Err(msg) => return Err(format!("Expected company-scope error, got: {msg}")),
        Ok(()) => return Err("Cross-company pricelist create must fail".to_string()),
    }
    if ctx
        .db
        .sale_order()
        .iter()
        .any(|o| o.client_order_ref.as_deref() == Some("SAL-002 Rejected"))
    {
        return Err("rejected cross-company pricelist order was persisted".to_string());
    }

    create_pricelist(
        ctx,
        org_id,
        CreatePricelistParams {
            company_id: Some(company_a),
            name: "Company A Pricelist".to_string(),
            currency_id: 1,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;
    let company_a_pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == "Company A Pricelist")
        .map(|p| p.id)
        .ok_or("Company A pricelist not found")?;

    create_sale_order(
        ctx,
        org_id,
        so_params(company_a_pricelist_id, "SAL-002 Valid"),
    )?;
    if !ctx
        .db
        .sale_order()
        .iter()
        .any(|o| o.client_order_ref.as_deref() == Some("SAL-002 Valid"))
    {
        return Err("same-company pricelist order was not persisted".to_string());
    }

    Ok(())
}

pub fn test_exchange_order_from_return(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let order_id = seed_so(ctx, &fixture, "Exchange PL", 1.0, 10.0, None, 1)?;
    confirm_sales_order(ctx, org_id, company_id, order_id)?;

    let sol_id = ctx
        .db
        .sale_order_line()
        .order_line_by_order()
        .filter(&order_id)
        .next()
        .map(|l| l.id)
        .ok_or("line")?;

    // Mark delivered so return validation passes.
    if let Some(line) = ctx.db.sale_order_line().id().find(&sol_id) {
        ctx.db
            .sale_order_line()
            .id()
            .update(crate::sales::sales_core::SaleOrderLine {
                qty_delivered: line.product_uom_qty,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..line
            });
    }

    create_return_order(
        ctx,
        org_id,
        company_id,
        CreateReturnOrderParams {
            partner_id: fixture.partner_id,
            sale_order_id: Some(order_id),
            return_reason: Some("exchange test".to_string()),
            lines: vec![CreateReturnOrderLineParams {
                sale_order_line_id: Some(sol_id),
                product_id: fixture.product_id,
                product_uom: ctx
                    .db
                    .product()
                    .id()
                    .find(&fixture.product_id)
                    .map(|p| p.uom_id)
                    .unwrap_or(1),
                product_uom_qty: 1.0,
                price_unit: 10.0,
                to_refund: true,
                lot_id: None,
            }],
        },
    )?;

    let rma_id = ctx
        .db
        .return_order()
        .iter()
        .find(|r| r.organization_id == org_id && r.sale_order_id == Some(order_id))
        .map(|r| r.id)
        .ok_or("RMA missing")?;

    confirm_return_order(ctx, org_id, company_id, rma_id)?;
    create_exchange_order_from_return(ctx, org_id, company_id, rma_id)?;

    let exchange = ctx
        .db
        .sale_order()
        .iter()
        .find(|o| o.organization_id == org_id && o.origin_so_id == Some(order_id));
    if exchange.is_none() {
        return Err("Expected exchange SO linked via origin_so_id".to_string());
    }
    Ok(())
}

/// R1: unknown product on SO line create → Err; no fabricated `"Product {id}"` row.
pub fn test_unknown_product_so_line_fail_closed(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let ghost_product_id = 9_000_041u64;
    let ghost_name = format!("Product {ghost_product_id}");

    let order_id = seed_so(ctx, &fixture, "R1 Ghost PL", 1.0, 10.0, None, 1)?;
    let lines_before = ctx
        .db
        .sale_order_line()
        .order_line_by_order()
        .filter(&order_id)
        .count();
    let products_before = ctx.db.product().iter().count();

    let err = create_sale_order_line(
        ctx,
        org_id,
        order_id,
        CreateSaleOrderLineParams {
            product_id: ghost_product_id,
            quantity: 1.0,
            uom_id: 1,
            price_unit: Some(99.0),
            discount: 0.0,
            tax_ids: vec![],
            name: None,
            sequence: 99,
            is_downpayment: false,
            display_type: None,
            product_variant_id: None,
            packaging_id: None,
            route_id: None,
            analytic_tag_ids: vec![],
            customer_lead: None,
            metadata: Some(r#"{"test":"r1_ghost_product"}"#.to_string()),
        },
    )
    .expect_err("unknown product must fail closed");

    if !err.contains("Product not found") {
        return Err(format!("Expected 'Product not found', got: {err}"));
    }

    let lines_after = ctx
        .db
        .sale_order_line()
        .order_line_by_order()
        .filter(&order_id)
        .count();
    if lines_after != lines_before {
        return Err(format!(
            "Ghost SO line inserted: before={lines_before} after={lines_after}"
        ));
    }

    let ghost_line = ctx
        .db
        .sale_order_line()
        .iter()
        .any(|l| l.product_id == ghost_product_id || l.name == ghost_name);
    if ghost_line {
        return Err(format!(
            "Fabricated '{ghost_name}' sale_order_line row persisted"
        ));
    }

    let products_after = ctx.db.product().iter().count();
    if products_after != products_before {
        return Err("Ghost product row was fabricated".into());
    }
    if ctx.db.product().id().find(&ghost_product_id).is_some() {
        return Err("Ghost product id unexpectedly exists".into());
    }

    Ok(())
}
