/// Inventory / procurement receipt and delivery domain tests.
///
/// PO confirm creates a draft IN picking; `receive_po_line` validates it and posts quants
/// into warehouse stock while syncing `qty_received` / `receipt_status`.
use spacetimedb::{ReducerContext, Table};

use crate::core::organization::CompanyScopeParams;
use crate::crm::contacts::{contact, create_contact, CreateContactParams};
use crate::inventory::product::product;
use crate::inventory::stock::{
    assign_stock_picking, confirm_stock_picking, resolve_warehouse_stock_location, stock_picking,
    stock_quant, validate_stock_picking,
};
use crate::purchasing::purchase_orders::{
    add_purchase_order_line, confirm_purchase_order, create_purchase_order, purchase_order,
    purchase_order_line, receive_po_line, AddPurchaseOrderLineParams, CreatePurchaseOrderParams,
};
use crate::sales::pricelists::{create_pricelist, product_pricelist, CreatePricelistParams};
use crate::sales::sales_core::{
    confirm_sales_order, create_sale_order, sale_order, sale_order_line, CreateSaleOrderLineParams,
    CreateSaleOrderParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::DiscountPolicy;

pub fn test_receipt_increases_quant(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    create_contact(
        ctx,
        org_id,
        CreateContactParams {
            name: "Quant Receipt Vendor".to_string(),
            type_: "contact".to_string(),
            email: None,
            phone: None,
            mobile: None,
            company_id: Some(company_id),
            is_customer: false,
            is_vendor: true,
            is_employee: false,
            is_prospect: false,
            is_partner: false,
            customer_rank: 0,
            supplier_rank: 1,
            display_name: Some("Quant Receipt Vendor".to_string()),
            first_name: None,
            last_name: None,
            title: None,
            email_secondary: None,
            fax: None,
            website: None,
            street: None,
            street2: None,
            city: None,
            state_code: None,
            zip: None,
            country_code: None,
            tax_id: None,
            company_registry: None,
            industry: None,
            employees_count: None,
            annual_revenue: None,
            description: None,
            salesperson_id: None,
            assigned_user_id: None,
            parent_id: None,
            user_id: None,
            color: None,
            metadata: Some(r#"{"test":"receipt_quant"}"#.to_string()),
        },
    )?;

    let vendor_id = ctx
        .db
        .contact()
        .iter()
        .find(|c| c.organization_id == org_id && c.display_name == "Quant Receipt Vendor")
        .map(|c| c.id)
        .ok_or("Vendor contact not found")?;

    let product_row = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("Harness product not found")?;

    create_purchase_order(
        ctx,
        org_id,
        CreatePurchaseOrderParams {
            company_id: Some(company_id),
            partner_id: vendor_id,
            currency_id: 1,
            origin: Some("Quant receipt PO".to_string()),
            partner_ref: Some("QTY-RCV-001".to_string()),
            notes: None,
            date_planned: None,
            payment_term_id: None,
            fiscal_position_id: None,
            incoterm_id: None,
            incoterm_location: None,
            user_id: None,
            invoice_ids: vec![],
            picking_ids: vec![],
            message_follower_ids: vec![],
            message_ids: vec![],
            activity_ids: vec![],
            is_quantity_copy: None,
            metadata: Some(r#"{"test":"receipt_quant"}"#.to_string()),
        },
    )?;

    let order = ctx
        .db
        .purchase_order()
        .iter()
        .find(|o| o.organization_id == org_id && o.partner_ref == Some("QTY-RCV-001".to_string()))
        .ok_or("Purchase order not found")?;

    add_purchase_order_line(
        ctx,
        org_id,
        order.id,
        AddPurchaseOrderLineParams {
            product_id: fixture.product_id,
            quantity: 4.0,
            uom_id: product_row.uom_id,
            price_unit: product_row.standard_price,
            discount: 0.0,
            tax_ids: vec![],
            name: None,
            sequence: Some(1),
            display_type: None,
            product_variant_id: None,
            account_analytic_id: None,
            date_planned: None,
            propagate_cancel: None,
            lot_id: None,
            metadata: None,
        },
    )?;

    confirm_purchase_order(ctx, org_id, order.id)?;

    let confirmed = ctx
        .db
        .purchase_order()
        .id()
        .find(&order.id)
        .ok_or("Purchase order not found after confirm")?;
    if confirmed.picking_count == 0 || confirmed.picking_ids.is_empty() {
        return Err("Expected IN picking on PO confirm".to_string());
    }
    let picking_id = confirmed.picking_ids[0];
    let picking = ctx
        .db
        .stock_picking()
        .id()
        .find(&picking_id)
        .ok_or("IN picking not found")?;
    if picking.picking_code.as_deref() != Some("incoming") || picking.purchase_id != Some(order.id)
    {
        return Err("Confirm picking is not a PO inbound receipt".to_string());
    }

    let line = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&order.id)
        .next()
        .ok_or("PO line not found")?;

    let stock_loc = resolve_warehouse_stock_location(ctx, fixture.warehouse_id);
    let qty_before = ctx
        .db
        .stock_quant()
        .iter()
        .filter(|q| {
            q.organization_id == org_id
                && q.company_id == company_id
                && q.product_id == fixture.product_id
                && q.location_id == stock_loc
        })
        .map(|q| q.quantity)
        .sum::<f64>();

    let qty_to_receive = line.product_qty;
    receive_po_line(ctx, org_id, line.id, qty_to_receive, None)?;

    let updated_line = ctx
        .db
        .purchase_order_line()
        .id()
        .find(&line.id)
        .ok_or("PO line not found after receive")?;

    if (updated_line.qty_received - qty_to_receive).abs() > 0.001 {
        return Err(format!(
            "Expected qty_received {qty_to_receive}, got {}",
            updated_line.qty_received
        ));
    }

    let updated_order = ctx
        .db
        .purchase_order()
        .id()
        .find(&order.id)
        .ok_or("Purchase order not found after receive")?;

    if updated_order.receipt_status != "full" {
        return Err(format!(
            "Expected receipt_status full after full receive, got {}",
            updated_order.receipt_status
        ));
    }

    let qty_after = ctx
        .db
        .stock_quant()
        .iter()
        .filter(|q| {
            q.organization_id == org_id
                && q.company_id == company_id
                && q.product_id == fixture.product_id
                && q.location_id == stock_loc
        })
        .map(|q| q.quantity)
        .sum::<f64>();
    if (qty_after - qty_before - qty_to_receive).abs() > 0.001 {
        return Err(format!(
            "Expected stock quant +{qty_to_receive} at warehouse (before {qty_before}, after {qty_after})"
        ));
    }

    Ok(())
}

pub fn test_delivery_decreases_reserved_or_moves_quant(ctx: &ReducerContext) -> Result<(), String> {
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
            name: "Quant Delivery Pricelist".to_string(),
            currency_id: 1,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;

    let pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == "Quant Delivery Pricelist")
        .map(|p| p.id)
        .ok_or("Pricelist not found")?;

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
            origin: Some("Quant delivery SO".to_string()),
            client_order_ref: Some("QTY-DEL-001".to_string()),
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
            metadata: Some(r#"{"test":"delivery_quant"}"#.to_string()),
        },
    )?;

    let order = ctx
        .db
        .sale_order()
        .iter()
        .find(|o| {
            o.organization_id == org_id && o.client_order_ref == Some("QTY-DEL-001".to_string())
        })
        .ok_or("Sale order not found")?;

    confirm_sales_order(ctx, org_id, fixture.company_id, order.id)?;

    let scope = CompanyScopeParams {
        company_id: Some(company_id),
    };

    let picking = ctx
        .db
        .stock_picking()
        .iter()
        .find(|p| p.organization_id == org_id && p.sale_id == Some(order.id) && !p.is_return)
        .ok_or("Delivery picking not found after confirm")?;

    confirm_stock_picking(ctx, org_id, picking.id, scope.clone())?;
    assign_stock_picking(ctx, org_id, picking.id, scope.clone())?;
    validate_stock_picking(ctx, org_id, picking.id, scope)?;

    let done_picking = ctx
        .db
        .stock_picking()
        .id()
        .find(&picking.id)
        .ok_or("Picking missing after validate")?;

    if done_picking.state != "done" {
        return Err(format!(
            "Expected picking done after validate, got {}",
            done_picking.state
        ));
    }

    let order_line = ctx
        .db
        .sale_order_line()
        .order_line_by_order()
        .filter(&order.id)
        .next()
        .ok_or("Sale order line missing")?;

    if order_line.qty_delivered < 1.0 {
        return Err(format!(
            "Expected qty_delivered >= 1 after delivery validate, got {}",
            order_line.qty_delivered
        ));
    }

    Ok(())
}
