//! Persisted relation and tenant-boundary proof for purchase requisitions and POs.

use spacetimedb::{ReducerContext, Table};

use crate::purchasing::purchase_orders::{
    add_purchase_order_line, add_purchase_requisition_line, create_purchase_order,
    create_purchase_requisition, purchase_order, purchase_order_line, purchase_requisition,
    purchase_requisition_line, AddPurchaseOrderLineParams, AddPurchaseRequisitionLineParams,
    CreatePurchaseOrderParams, CreatePurchaseRequisitionLineParams,
    CreatePurchaseRequisitionParams,
};
use crate::test_harness::PurchasingIntegrityFixture;

fn requisition_params(
    company_id: u64,
    product_id: u64,
    uom_id: u64,
    vendor_id: u64,
) -> CreatePurchaseRequisitionParams {
    CreatePurchaseRequisitionParams {
        company_id: Some(company_id),
        origin: Some("phase-1-po-relations".to_string()),
        description: Some("Phase 1 requisition proof".to_string()),
        ordering_date: None,
        date_end: None,
        schedule_date: None,
        department_id: None,
        exclusive: None,
        multiple_product: false,
        // The submitted values must not become authoritative reverse links.
        line_ids: vec![999_999],
        lines: vec![CreatePurchaseRequisitionLineParams {
            product_id,
            product_uom: uom_id,
            product_uom_qty: 17.0,
            name: Some("Phase 1 requisition line".to_string()),
            sequence: Some(17),
        }],
        purchase_ids: vec![999_998],
        vendor_id: Some(vendor_id),
        activity_ids: vec![999_997],
        message_follower_ids: vec![999_996],
        message_ids: vec![999_995],
        metadata: Some(r#"{"test":"phase-1-purchase-orders"}"#.to_string()),
    }
}

pub fn test_phase1_purchase_order_relations(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = PurchasingIntegrityFixture::seed(ctx)?;
    let primary = &fixture.primary;
    let foreign = &fixture.foreign;

    if create_purchase_requisition(
        ctx,
        primary.organization_id,
        requisition_params(
            primary.company_id,
            foreign.product_id,
            foreign.uom_id,
            primary.vendor_id,
        ),
    )
    .is_ok()
    {
        return Err("foreign product/UoM was accepted on a requisition".to_string());
    }

    create_purchase_requisition(
        ctx,
        primary.organization_id,
        requisition_params(
            primary.company_id,
            primary.product_id,
            primary.uom_id,
            primary.vendor_id,
        ),
    )?;
    let requisition = ctx
        .db
        .purchase_requisition()
        .iter()
        .filter(|row| row.origin.as_deref() == Some("phase-1-po-relations"))
        .max_by_key(|row| row.id)
        .ok_or("phase 1 requisition was not persisted")?;
    if requisition.organization_id != primary.organization_id
        || requisition.company_id != primary.company_id
        || requisition.line_ids.len() != 1
        || !requisition.purchase_ids.is_empty()
        || !requisition.activity_ids.is_empty()
        || !requisition.message_ids.is_empty()
    {
        return Err(
            "requisition persisted caller-owned reverse relations or wrong scope".to_string(),
        );
    }
    let req_line = ctx
        .db
        .purchase_requisition_line()
        .id()
        .find(&requisition.line_ids[0])
        .ok_or("phase 1 requisition line was not persisted")?;
    if req_line.requisition_id != requisition.id
        || req_line.organization_id != requisition.organization_id
        || req_line.company_id != requisition.company_id
    {
        return Err("requisition line did not inherit its parent scope".to_string());
    }
    if add_purchase_requisition_line(
        ctx,
        foreign.organization_id,
        foreign.company_id,
        requisition.id,
        AddPurchaseRequisitionLineParams {
            product_id: foreign.product_id,
            product_uom: foreign.uom_id,
            product_uom_qty: 1.0,
            name: None,
            sequence: None,
        },
    )
    .is_ok()
    {
        return Err("foreign organization added a requisition line".to_string());
    }

    if create_purchase_order(
        ctx,
        primary.organization_id,
        CreatePurchaseOrderParams {
            company_id: Some(primary.company_id),
            partner_id: foreign.vendor_id,
            currency_id: primary.currency_id,
            origin: Some("phase-1-foreign-vendor".to_string()),
            partner_ref: None,
            notes: None,
            date_planned: None,
            payment_term_id: None,
            fiscal_position_id: None,
            incoterm_id: None,
            incoterm_location: None,
            user_id: None,
            invoice_ids: vec![999_994],
            picking_ids: vec![999_993],
            message_follower_ids: vec![999_992],
            message_ids: vec![999_991],
            activity_ids: vec![999_990],
            is_quantity_copy: None,
            metadata: None,
        },
    )
    .is_ok()
    {
        return Err("foreign vendor was accepted on a purchase order".to_string());
    }

    create_purchase_order(
        ctx,
        primary.organization_id,
        CreatePurchaseOrderParams {
            company_id: Some(primary.company_id),
            partner_id: primary.vendor_id,
            currency_id: primary.currency_id,
            origin: Some("phase-1-valid-po".to_string()),
            partner_ref: None,
            notes: None,
            date_planned: None,
            payment_term_id: None,
            fiscal_position_id: None,
            incoterm_id: None,
            incoterm_location: None,
            user_id: None,
            invoice_ids: vec![999_989],
            picking_ids: vec![999_988],
            message_follower_ids: vec![999_987],
            message_ids: vec![999_986],
            activity_ids: vec![999_985],
            is_quantity_copy: None,
            metadata: None,
        },
    )?;
    let order = ctx
        .db
        .purchase_order()
        .iter()
        .filter(|row| row.origin.as_deref() == Some("phase-1-valid-po"))
        .max_by_key(|row| row.id)
        .ok_or("phase 1 PO was not persisted")?;
    if order.user_id != ctx.sender()
        || !order.invoice_ids.is_empty()
        || !order.picking_ids.is_empty()
        || !order.activity_ids.is_empty()
        || !order.message_ids.is_empty()
    {
        return Err("PO did not derive actor or clear lifecycle-owned reverse links".to_string());
    }
    if add_purchase_order_line(
        ctx,
        primary.organization_id,
        order.id,
        AddPurchaseOrderLineParams {
            product_id: foreign.product_id,
            quantity: 17.0,
            uom_id: foreign.uom_id,
            price_unit: 17.0,
            discount: 0.0,
            tax_ids: vec![],
            name: None,
            sequence: None,
            display_type: None,
            product_variant_id: None,
            account_analytic_id: None,
            date_planned: None,
            propagate_cancel: None,
            lot_id: None,
            metadata: None,
        },
    )
    .is_ok()
    {
        return Err("foreign product/UoM was accepted on a PO line".to_string());
    }
    add_purchase_order_line(
        ctx,
        primary.organization_id,
        order.id,
        AddPurchaseOrderLineParams {
            product_id: primary.product_id,
            quantity: 17.0,
            uom_id: primary.uom_id,
            price_unit: 17.0,
            discount: 0.0,
            tax_ids: vec![],
            name: None,
            sequence: None,
            display_type: None,
            product_variant_id: None,
            account_analytic_id: None,
            date_planned: None,
            propagate_cancel: None,
            lot_id: None,
            metadata: None,
        },
    )?;
    let line = ctx
        .db
        .purchase_order_line()
        .purchase_order_line_by_order()
        .filter(&order.id)
        .next()
        .ok_or("phase 1 PO line was not persisted")?;
    if line.organization_id != order.organization_id
        || line.company_id != order.company_id
        || line.partner_id != order.partner_id
        || line.currency_id != order.currency_id
    {
        return Err("PO line did not derive its parent business scope".to_string());
    }

    Ok(())
}
