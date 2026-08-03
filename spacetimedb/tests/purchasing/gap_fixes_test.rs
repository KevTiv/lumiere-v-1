//! Wave A / Wave C purchasing gap-fix domain tests.
use spacetimedb::{ReducerContext, Table};

use crate::crm::contacts::{contact, create_contact, CreateContactParams};
use crate::inventory::product::{create_product, product, CreateProductParams};
use crate::inventory::stock::{resolve_warehouse_stock_location, stock_picking, stock_quant};
use crate::inventory::tracking::{
    create_stock_production_lot, stock_production_lot, CreateStockProductionLotParams,
};
use crate::purchasing::purchase_orders::{
    add_purchase_order_line, confirm_purchase_order, create_purchase_order, purchase_order,
    purchase_order_line, receive_po_line, AddPurchaseOrderLineParams, CreatePurchaseOrderParams,
};
use crate::purchasing::purchase_returns::{
    confirm_purchase_return, create_purchase_return, purchase_return,
    CreatePurchaseReturnLineParams, CreatePurchaseReturnParams,
};
use crate::purchasing::sourcing::{
    add_purchase_rfq_bid, award_purchase_rfq_bid, create_purchase_rfq, purchase_rfq,
    purchase_rfq_bid, CreatePurchaseRfqBidParams, CreatePurchaseRfqLineParams,
    CreatePurchaseRfqParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::PoState;

pub fn seed_vendor_po(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    partner_ref: &str,
) -> Result<(u64, u64), String> {
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    create_contact(
        ctx,
        org_id,
        CreateContactParams {
            name: format!("Vendor {partner_ref}"),
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
            display_name: Some(format!("Vendor {partner_ref}")),
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
            metadata: Some(format!(r#"{{"test":"{partner_ref}"}}"#)),
        },
    )?;

    let vendor_id = ctx
        .db
        .contact()
        .iter()
        .find(|c| c.organization_id == org_id && c.display_name == format!("Vendor {partner_ref}"))
        .map(|c| c.id)
        .ok_or("Vendor not found")?;

    let product_row = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("Product not found")?;

    create_purchase_order(
        ctx,
        org_id,
        CreatePurchaseOrderParams {
            company_id: Some(company_id),
            partner_id: vendor_id,
            currency_id: 1,
            origin: Some(partner_ref.to_string()),
            partner_ref: Some(partner_ref.to_string()),
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
            metadata: Some(format!(r#"{{"test":"{partner_ref}"}}"#)),
        },
    )?;

    let order = ctx
        .db
        .purchase_order()
        .iter()
        .find(|o| o.organization_id == org_id && o.partner_ref == Some(partner_ref.to_string()))
        .ok_or("PO not found")?;

    add_purchase_order_line(
        ctx,
        org_id,
        order.id,
        AddPurchaseOrderLineParams {
            product_id: fixture.product_id,
            quantity: 3.0,
            uom_id: product_row.uom_id,
            price_unit: 10.0,
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

    Ok((org_id, order.id))
}

/// Confirm creates IN picking; company B cannot confirm company A's PO.
pub fn test_company_isolation_on_confirm(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;

    let (org_a, order_a) = seed_vendor_po(ctx, &fixture_a, "ISO-PO-A")?;
    let (_org_b, _order_b) = seed_vendor_po(ctx, &fixture_b, "ISO-PO-B")?;

    // Confirm A under org A — ok.
    confirm_purchase_order(ctx, org_a, order_a)?;
    let confirmed = ctx
        .db
        .purchase_order()
        .id()
        .find(&order_a)
        .ok_or("PO A missing")?;
    if confirmed.state != PoState::Purchase {
        return Err("PO A should be Purchase".into());
    }
    if confirmed.company_id != fixture_a.company_id {
        return Err("PO A company mismatch".into());
    }

    // Attempt confirm of A using org B scope should fail ownership checks.
    match confirm_purchase_order(ctx, fixture_b.organization_id, order_a) {
        Err(_) => Ok(()),
        Ok(()) => Err("company isolation failed: org B confirmed org A purchase order".to_string()),
    }
}

/// Confirm → receive updates qty and links inbound picking.
pub fn test_confirm_creates_incoming_picking(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let (org_id, order_id) = seed_vendor_po(ctx, &fixture, "IN-PICK-001")?;

    confirm_purchase_order(ctx, org_id, order_id)?;
    let order = ctx
        .db
        .purchase_order()
        .id()
        .find(&order_id)
        .ok_or("PO missing")?;
    if order.picking_ids.is_empty() {
        return Err("Expected picking_ids after confirm".into());
    }
    let picking = ctx
        .db
        .stock_picking()
        .id()
        .find(&order.picking_ids[0])
        .ok_or("picking missing")?;
    if picking.picking_code.as_deref() != Some("incoming") {
        return Err("Expected incoming picking_code".into());
    }

    let line_id = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&order_id)
        .next()
        .map(|l| l.id)
        .ok_or("line missing")?;

    receive_po_line(ctx, org_id, line_id, 1.5, None)?;
    let line = ctx
        .db
        .purchase_order_line()
        .id()
        .find(&line_id)
        .ok_or("line after receive")?;
    if (line.qty_received - 1.5).abs() > 0.001 {
        return Err(format!("expected 1.5 received, got {}", line.qty_received));
    }
    Ok(())
}

/// Wave C: RFQ create → bid → award creates draft PO; purchase return confirm links OUT picking.
pub fn test_rfq_award_and_purchase_return_smoke(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    create_contact(
        ctx,
        org_id,
        CreateContactParams {
            name: "RFQ Vendor".to_string(),
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
            display_name: Some("RFQ Vendor".to_string()),
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
            metadata: Some(r#"{"test":"rfq-vendor"}"#.to_string()),
        },
    )?;
    let vendor_id = ctx
        .db
        .contact()
        .iter()
        .find(|c| c.organization_id == org_id && c.display_name == "RFQ Vendor")
        .map(|c| c.id)
        .ok_or("RFQ vendor not found")?;

    let product_row = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("Product not found")?;

    create_purchase_rfq(
        ctx,
        org_id,
        company_id,
        CreatePurchaseRfqParams {
            requisition_id: None,
            currency_id: 1,
            notes: Some("Wave C RFQ smoke".to_string()),
            lines: vec![CreatePurchaseRfqLineParams {
                product_id: fixture.product_id,
                product_uom: product_row.uom_id,
                product_uom_qty: 2.0,
                name: Some("RFQ line".to_string()),
                sequence: Some(10),
            }],
            metadata: None,
        },
    )?;

    let rfq = ctx
        .db
        .purchase_rfq()
        .iter()
        .find(|r| r.organization_id == org_id && r.company_id == company_id)
        .ok_or("RFQ not found")?;

    add_purchase_rfq_bid(
        ctx,
        org_id,
        company_id,
        rfq.id,
        CreatePurchaseRfqBidParams {
            partner_id: vendor_id,
            currency_id: 1,
            price_unit: 12.5,
            notes: Some("bid".to_string()),
        },
    )?;

    let bid = ctx
        .db
        .purchase_rfq_bid()
        .purchase_rfq_bid_by_rfq()
        .filter(&rfq.id)
        .next()
        .ok_or("bid not found")?;

    award_purchase_rfq_bid(ctx, org_id, company_id, rfq.id, bid.id)?;
    let awarded = ctx
        .db
        .purchase_rfq()
        .id()
        .find(&rfq.id)
        .ok_or("RFQ after award")?;
    if awarded.state != "awarded" || awarded.purchase_order_id.is_none() {
        return Err("RFQ should be awarded with PO".into());
    }
    let po_id = awarded.purchase_order_id.unwrap();
    let po = ctx
        .db
        .purchase_order()
        .id()
        .find(&po_id)
        .ok_or("awarded PO missing")?;
    if po.partner_id != vendor_id {
        return Err("awarded PO vendor mismatch".into());
    }

    // Encumbrance metadata on confirm
    confirm_purchase_order(ctx, org_id, po_id)?;
    let confirmed = ctx
        .db
        .purchase_order()
        .id()
        .find(&po_id)
        .ok_or("PO after confirm")?;
    let meta = confirmed.metadata.as_deref().unwrap_or("");
    if !meta.contains("encumbrance") {
        return Err(format!("expected encumbrance in PO metadata, got {meta}"));
    }

    create_purchase_return(
        ctx,
        org_id,
        company_id,
        CreatePurchaseReturnParams {
            purchase_order_id: Some(po_id),
            partner_id: vendor_id,
            return_reason: Some("damaged".to_string()),
            lines: vec![CreatePurchaseReturnLineParams {
                purchase_order_line_id: None,
                product_id: fixture.product_id,
                product_uom: product_row.uom_id,
                product_uom_qty: 1.0,
                price_unit: 12.5,
                to_refund: true,
            }],
        },
    )?;

    let pret = ctx
        .db
        .purchase_return()
        .iter()
        .find(|r| r.organization_id == org_id && r.purchase_order_id == Some(po_id))
        .ok_or("purchase return not found")?;

    confirm_purchase_return(ctx, org_id, company_id, pret.id)?;
    let confirmed_ret = ctx
        .db
        .purchase_return()
        .id()
        .find(&pret.id)
        .ok_or("return after confirm")?;
    if confirmed_ret.state != "confirmed" || confirmed_ret.picking_id.is_none() {
        return Err("purchase return should be confirmed with picking".into());
    }
    let picking = ctx
        .db
        .stock_picking()
        .id()
        .find(&confirmed_ret.picking_id.unwrap())
        .ok_or("return picking missing")?;
    if picking.picking_code.as_deref() != Some("outgoing") {
        return Err("expected outgoing picking for purchase return".into());
    }

    Ok(())
}

fn create_lot_tracked_product(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    code: &str,
) -> Result<u64, String> {
    let base = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("Harness product not found")?;

    create_product(
        ctx,
        fixture.organization_id,
        CreateProductParams {
            name: format!("Lot Product {code}"),
            categ_id: base.categ_id,
            type_: "storable".to_string(),
            uom_id: base.uom_id,
            uom_po_id: base.uom_po_id,
            standard_price: 10.0,
            list_price: 20.0,
            currency_id: 1,
            default_code: Some(code.to_string()),
            barcode: None,
            description: None,
            sale_ok: Some(true),
            purchase_ok: Some(true),
            display_name: None,
            cost_method: None,
            valuation: None,
            volume: None,
            weight: None,
            can_be_expensed: None,
            available_in_pos: None,
            invoicing_policy: None,
            expense_policy: None,
            priority: None,
            is_published: None,
            description_purchase: None,
            description_sale: None,
            service_type: None,
            service_tracking: None,
            image_1920_url: None,
            image_128_url: None,
            color: None,
            responsible_id: None,
            pricelist_id: None,
            description_picking: None,
            description_pickingout: None,
            description_pickingin: None,
            location_id: None,
            warehouse_id: None,
            tracking: Some("lot".to_string()),
            has_configurable_attributes: None,
            taxes_id: None,
            supplier_taxes_id: None,
            route_ids: None,
            route_from_categ_ids: None,
            property_account_income_id: base.property_account_income_id,
            property_account_expense_id: None,
            variant_attribute_ids: None,
            attribute_line_ids: None,
            metadata: Some(r#"{"test":"lot_receive"}"#.to_string()),
        },
    )?;

    ctx.db
        .product()
        .product_by_org()
        .filter(&fixture.organization_id)
        .find(|p| p.default_code == Some(code.to_string()))
        .map(|p| p.id)
        .ok_or_else(|| format!("lot-tracked product {code} missing"))
}

/// Lot-tracked PO line: receive without lot fails; with lot stamps dest quant.
pub fn test_receive_po_line_lot_required(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let product_id = create_lot_tracked_product(ctx, &fixture, "LOT-RCV")?;

    create_contact(
        ctx,
        org_id,
        CreateContactParams {
            name: "Lot Receive Vendor".to_string(),
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
            display_name: Some("Lot Receive Vendor".to_string()),
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
            metadata: Some(r#"{"test":"lot_receive"}"#.to_string()),
        },
    )?;

    let vendor_id = ctx
        .db
        .contact()
        .iter()
        .find(|c| c.organization_id == org_id && c.display_name == "Lot Receive Vendor")
        .map(|c| c.id)
        .ok_or("Lot receive vendor missing")?;

    let product_row = ctx
        .db
        .product()
        .id()
        .find(&product_id)
        .ok_or("Lot product missing")?;

    create_purchase_order(
        ctx,
        org_id,
        CreatePurchaseOrderParams {
            company_id: Some(company_id),
            partner_id: vendor_id,
            currency_id: 1,
            origin: Some("Lot receive PO".to_string()),
            partner_ref: Some("LOT-RCV-PO".to_string()),
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
            metadata: Some(r#"{"test":"lot_receive"}"#.to_string()),
        },
    )?;

    let order = ctx
        .db
        .purchase_order()
        .iter()
        .find(|o| o.organization_id == org_id && o.partner_ref == Some("LOT-RCV-PO".to_string()))
        .ok_or("Lot receive PO missing")?;

    add_purchase_order_line(
        ctx,
        org_id,
        order.id,
        AddPurchaseOrderLineParams {
            product_id,
            quantity: 2.0,
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

    let line = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&order.id)
        .next()
        .ok_or("Lot receive PO line missing")?;

    match receive_po_line(ctx, org_id, line.id, 1.0, None) {
        Err(msg) if msg.to_lowercase().contains("lot") => {}
        Err(msg) => return Err(format!("Expected lot-required error, got: {msg}")),
        Ok(()) => return Err("lot receive fail-closed failed: accepted without lot_id".into()),
    }

    create_stock_production_lot(
        ctx,
        org_id,
        CreateStockProductionLotParams {
            company_id: Some(company_id),
            name: "LOT-RCV-A".to_string(),
            product_id,
            product_variant_id: None,
            ref_: None,
            note: None,
            expiration_date: None,
            use_date: None,
            removal_date: None,
            alert_date: None,
            product_qty: 2.0,
            location_id: Some(fixture.warehouse_id),
            package_id: None,
            owner_id: None,
            is_scrap: false,
            is_locked: false,
            metadata: None,
        },
    )?;
    let lot_id = ctx
        .db
        .stock_production_lot()
        .iter()
        .find(|l| {
            l.organization_id == org_id && l.name == "LOT-RCV-A" && l.product_id == product_id
        })
        .map(|l| l.id)
        .ok_or("lot missing after create")?;

    receive_po_line(ctx, org_id, line.id, 1.0, Some(lot_id))?;

    let stock_loc = resolve_warehouse_stock_location(ctx, fixture.warehouse_id);
    let dest_quant = ctx
        .db
        .stock_quant()
        .iter()
        .find(|q| {
            q.organization_id == org_id
                && q.company_id == company_id
                && q.product_id == product_id
                && q.location_id == stock_loc
                && q.lot_id == Some(lot_id)
        })
        .ok_or("dest quant missing lot_id stamp after receive")?;

    if dest_quant.quantity <= 0.0 {
        return Err(format!(
            "expected positive dest quant qty, got {}",
            dest_quant.quantity
        ));
    }

    let updated_line = ctx
        .db
        .purchase_order_line()
        .id()
        .find(&line.id)
        .ok_or("PO line missing after lot receive")?;
    if (updated_line.qty_received - 1.0).abs() > 0.001 {
        return Err(format!(
            "expected qty_received 1.0, got {}",
            updated_line.qty_received
        ));
    }

    Ok(())
}
