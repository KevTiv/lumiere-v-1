/// Sales order core flow domain tests.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{account_journal, create_account_journal, CreateAccountJournalParams};
use crate::accounting::journal_entries::{
    account_move, account_move_line, create_invoice_from_sale_order, AddAccountMoveLineParams,
    CreateInvoiceFromSaleOrderParams,
};
use crate::core::organization::CompanyScopeParams;
use crate::inventory::product::product;
use crate::accounting::credit_control::{
    upsert_partner_credit_control, UpsertPartnerCreditControlParams,
};
use crate::inventory::stock::{
    assign_stock_picking, confirm_stock_picking, done_stock_move, stock_move, stock_picking,
    stock_quant, validate_stock_picking, validate_stock_picking_backorder, DoneStockMoveParams,
};
use crate::sales::pricelists::{
    create_pricelist, create_pricelist_item, product_pricelist, CreatePricelistItemParams,
    CreatePricelistParams,
};
use crate::sales::sales_core::{
    cancel_sale_order, confirm_sales_order, create_sale_order, sale_order, sale_order_line,
    send_sale_order_quotation, CreateSaleOrderLineParams, CreateSaleOrderParams,
};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{
    ComputePrice, DiscountPolicy, InvoiceStatus, JournalType, LineInvoiceStatus, MoveType,
    PricelistAppliedOn, SaleState,
};

pub fn test_order_confirm_to_invoice(ctx: &ReducerContext) -> Result<(), String> {
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
            name: "Harness Pricelist".to_string(),
            currency_id: 1,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;

    let pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == "Harness Pricelist")
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
            origin: Some("Harness SO".to_string()),
            client_order_ref: Some("HARNESS-SO-001".to_string()),
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
            metadata: Some(r#"{"test":"order_confirm_to_invoice"}"#.to_string()),
        },
    )?;

    let order = ctx
        .db
        .sale_order()
        .iter()
        .find(|o| {
            o.organization_id == org_id
                && o.client_order_ref == Some("HARNESS-SO-001".to_string())
        })
        .ok_or("Sale order not found after create")?;

    confirm_sales_order(ctx, org_id, order.id)?;

    let confirmed = ctx
        .db
        .sale_order()
        .id()
        .find(&order.id)
        .ok_or("Sale order not found after confirm")?;

    if confirmed.state != SaleState::Sale {
        return Err(format!(
            "Expected Sale state after confirm, got {:?}",
            confirmed.state
        ));
    }

    if confirmed.invoice_status != InvoiceStatus::ToInvoice {
        return Err(format!(
            "Expected ToInvoice status after confirm, got {:?}",
            confirmed.invoice_status
        ));
    }

    let lines: Vec<_> = ctx
        .db
        .sale_order_line()
        .order_line_by_order()
        .filter(&order.id)
        .collect();
    if lines.is_empty() {
        return Err("Expected at least one sale order line".to_string());
    }
    for line in &lines {
        if line.display_type.is_some() {
            continue;
        }
        let expected = (line.product_uom_qty - line.qty_invoiced).max(0.0);
        if expected <= 0.0 {
            continue;
        }
        if line.qty_to_invoice != expected {
            return Err(format!(
                "Expected qty_to_invoice {} after confirm, got {}",
                expected, line.qty_to_invoice
            ));
        }
        if line.invoice_status != LineInvoiceStatus::ToInvoice {
            return Err(format!(
                "Expected line ToInvoice after confirm, got {:?}",
                line.invoice_status
            ));
        }
    }

    let revenue_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("Harness missing revenue account")?;

    let ar_id = *fixture
        .chart_account_ids
        .get(chart_keys::AR)
        .ok_or("Harness missing receivable account")?;

    let journal_code = format!("SO{}", company_id);
    let journal_id = if let Some(j) = ctx
        .db
        .account_journal()
        .iter()
        .find(|j| j.organization_id == org_id && j.code == journal_code)
    {
        j.id
    } else {
        create_account_journal(
            ctx,
            org_id,
            CreateAccountJournalParams {
                company_id: Some(company_id),
                name: "Harness SO Sales Journal".to_string(),
                code: journal_code.clone(),
                type_: JournalType::Sale,
                currency_id: Some(1),
                default_account_id: Some(revenue_id),
                suspense_account_id: None,
                loss_account_id: None,
                profit_account_id: None,
                bank_account_id: None,
                payment_credit_account_id: None,
                payment_debit_account_id: None,
                invoice_reference_type: None,
                invoice_reference_model: None,
                sequence_id: None,
                refund_sequence_id: None,
                sequence_override_regex: None,
                secure_sequence_id: None,
                alias_name: None,
                alias_domain: None,
                sale_activity_type_id: None,
                sale_activity_user_id: None,
                sale_activity_note: None,
                sale_activity_date_deadline: None,
                restrict_mode_hash_table: false,
                active: true,
                at_least_one_inbound: true,
                at_least_one_outbound: true,
                dedicated_payment_method_ids: vec![],
                sale_activity_done: false,
                metadata: None,
            },
        )?;
        ctx.db
            .account_journal()
            .iter()
            .find(|j| j.code == journal_code)
            .map(|j| j.id)
            .ok_or("SO sales journal not found after create")?
    };

    create_invoice_from_sale_order(
        ctx,
        org_id,
        order.id,
        CreateInvoiceFromSaleOrderParams {
            journal_id,
            default_income_account_id: revenue_id,
            receivable_line: AddAccountMoveLineParams {
                account_id: ar_id,
                name: "Accounts Receivable".to_string(),
                debit: 0.0,
                credit: 0.0,
                sequence: 0,
                quantity: 0.0,
                price_unit: 0.0,
                discount: 0.0,
                tax_ids: vec![],
                partner_id: Some(fixture.partner_id),
                product_id: None,
                product_uom_id: None,
                product_category_id: None,
                analytic_account_id: None,
                analytic_tag_ids: vec![],
                display_type: None,
                is_downpayment: false,
                exclude_from_invoice_tab: true,
                blocked: false,
                group_tax_id: None,
                tax_line_id: None,
                tax_group_id: None,
                tax_repartition_line_id: None,
                tax_audit: None,
                reconcile_model_id: None,
                payment_id: None,
                statement_line_id: None,
                matching_number: None,
                matching_label: None,
                expected_pay_date: None,
                expected_pay_date_currency_id: None,
                expected_pay_date_amount: 0.0,
                expected_pay_date_residual: 0.0,
                metadata: None,
            },
            income_line: AddAccountMoveLineParams {
                account_id: revenue_id,
                name: String::new(),
                debit: 0.0,
                credit: 0.0,
                sequence: 0,
                quantity: 0.0,
                price_unit: 0.0,
                discount: 0.0,
                tax_ids: vec![],
                partner_id: None,
                product_id: None,
                product_uom_id: None,
                product_category_id: None,
                analytic_account_id: None,
                analytic_tag_ids: vec![],
                display_type: None,
                is_downpayment: false,
                exclude_from_invoice_tab: false,
                blocked: false,
                group_tax_id: None,
                tax_line_id: None,
                tax_group_id: None,
                tax_repartition_line_id: None,
                tax_audit: None,
                reconcile_model_id: None,
                payment_id: None,
                statement_line_id: None,
                matching_number: None,
                matching_label: None,
                expected_pay_date: None,
                expected_pay_date_currency_id: None,
                expected_pay_date_amount: 0.0,
                expected_pay_date_residual: 0.0,
                metadata: None,
            },
            metadata: None,
        },
    )?;

    let invoiced_order = ctx
        .db
        .sale_order()
        .id()
        .find(&order.id)
        .ok_or("Sale order not found after invoicing")?;

    if invoiced_order.invoice_count == 0 || invoiced_order.invoice_ids.is_empty() {
        return Err("Sale order has no linked invoice after create_invoice_from_sale_order".to_string());
    }

    let invoice_move_id = invoiced_order.invoice_ids[0];
    let invoice = ctx
        .db
        .account_move()
        .id()
        .find(&invoice_move_id)
        .ok_or("Invoice move not found")?;

    if invoice.move_type != MoveType::OutInvoice {
        return Err(format!(
            "Expected OutInvoice move type, got {:?}",
            invoice.move_type
        ));
    }

    if invoice.sale_order_id != Some(order.id) {
        return Err("Invoice not linked back to sale order".to_string());
    }

    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&invoice_move_id)
        .collect();

    if lines.is_empty() {
        return Err("Draft invoice has no move lines".to_string());
    }

    let total_debit: f64 = lines.iter().map(|l| l.debit).sum();
    let total_credit: f64 = lines.iter().map(|l| l.credit).sum();

    if (total_debit - total_credit).abs() >= 0.01 {
        return Err(format!(
            "Draft invoice move lines not balanced: debit={total_debit} credit={total_credit}"
        ));
    }

    Ok(())
}

/// Delivery path smoke test.
///
/// `confirm_sales_order` auto-creates outgoing pickings; we confirm → assign → validate
/// and assert done state plus qty_delivered propagation on the SO line.
pub fn test_order_to_delivery_state(ctx: &ReducerContext) -> Result<(), String> {
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
            name: "Harness Delivery Pricelist".to_string(),
            currency_id: 1,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;

    let pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == "Harness Delivery Pricelist")
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
            origin: Some("Harness delivery SO".to_string()),
            client_order_ref: Some("HARNESS-SO-DEL".to_string()),
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
            metadata: Some(r#"{"test":"order_to_delivery_state"}"#.to_string()),
        },
    )?;

    let order = ctx
        .db
        .sale_order()
        .iter()
        .find(|o| {
            o.organization_id == org_id
                && o.client_order_ref == Some("HARNESS-SO-DEL".to_string())
        })
        .ok_or("Sale order not found after create")?;

    confirm_sales_order(ctx, org_id, order.id)?;

    let confirmed = ctx
        .db
        .sale_order()
        .id()
        .find(&order.id)
        .ok_or("Sale order not found after confirm")?;

    if confirmed.state != SaleState::Sale {
        return Err(format!(
            "Expected Sale state after confirm, got {:?}",
            confirmed.state
        ));
    }

    // Soft ATP reservation must be held after confirm.
    let reserved_qty: f64 = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&fixture.product_id)
        .filter(|q| q.organization_id == org_id && q.company_id == company_id)
        .map(|q| q.reserved_quantity)
        .sum();
    if (reserved_qty - 2.0).abs() > 1e-6 {
        return Err(format!(
            "Expected reserved_quantity 2.0 after confirm, got {reserved_qty}"
        ));
    }

    let on_hand_before: f64 = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&fixture.product_id)
        .filter(|q| q.organization_id == org_id && q.company_id == company_id)
        .map(|q| q.quantity)
        .sum();

    let order_line = ctx
        .db
        .sale_order_line()
        .order_line_by_order()
        .filter(&order.id)
        .next()
        .ok_or("Sale order line not found")?;

    let scope = CompanyScopeParams {
        company_id: Some(company_id),
    };

    let picking = ctx
        .db
        .stock_picking()
        .iter()
        .find(|p| p.organization_id == org_id && p.sale_id == Some(order.id) && !p.is_return)
        .ok_or("Delivery picking not found after confirm (expected auto-create)")?;

    confirm_stock_picking(ctx, org_id, picking.id, scope.clone())?;
    assign_stock_picking(ctx, org_id, picking.id, scope.clone())?;
    validate_stock_picking(ctx, org_id, picking.id, scope)?;

    let done_picking = ctx
        .db
        .stock_picking()
        .id()
        .find(&picking.id)
        .ok_or("Picking not found after validate")?;

    if done_picking.state != "done" {
        return Err(format!(
            "Expected picking state done, got {}",
            done_picking.state
        ));
    }

    let on_hand_after: f64 = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&fixture.product_id)
        .filter(|q| {
            q.organization_id == org_id
                && q.company_id == company_id
                && q.location_id == picking.location_id
        })
        .map(|q| q.quantity)
        .sum();
    if (on_hand_after - (on_hand_before - 2.0)).abs() > 1e-6 {
        return Err(format!(
            "Expected source on-hand {} after validate, got {} (before {})",
            on_hand_before - 2.0,
            on_hand_after,
            on_hand_before
        ));
    }

    let reserved_after: f64 = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&fixture.product_id)
        .filter(|q| q.organization_id == org_id && q.company_id == company_id)
        .map(|q| q.reserved_quantity)
        .sum();
    if reserved_after > 1e-6 {
        return Err(format!(
            "Expected reserved_quantity 0 after validate, got {reserved_after}"
        ));
    }

    let delivered_line = ctx
        .db
        .sale_order_line()
        .id()
        .find(&order_line.id)
        .ok_or("Sale order line not found after delivery")?;

    if delivered_line.qty_delivered < order_line.product_uom_qty {
        return Err(format!(
            "Expected qty_delivered >= {}, got {}",
            order_line.product_uom_qty, delivered_line.qty_delivered
        ));
    }

    let expected_qty_to_invoice =
        (delivered_line.qty_delivered - delivered_line.qty_invoiced).max(0.0);
    if expected_qty_to_invoice <= 0.0 {
        return Err(format!(
            "Expected qty_to_invoice > 0 after delivery, got {}",
            delivered_line.qty_to_invoice
        ));
    }
    if delivered_line.qty_to_invoice <= 0.0 {
        return Err(format!(
            "Expected qty_to_invoice > 0 after delivery, got {}",
            delivered_line.qty_to_invoice
        ));
    }

    Ok(())
}

/// Confirm then cancel: open picking cancelled and reservation released.
pub fn test_order_confirm_cancel_releases_reservation(ctx: &ReducerContext) -> Result<(), String> {
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
            name: "Harness Cancel Pricelist".to_string(),
            currency_id: 1,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;

    let pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == "Harness Cancel Pricelist")
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
                quantity: 3.0,
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
            origin: Some("Harness cancel SO".to_string()),
            client_order_ref: Some("HARNESS-SO-CANCEL".to_string()),
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
            metadata: Some(r#"{"test":"order_confirm_cancel"}"#.to_string()),
        },
    )?;

    let order = ctx
        .db
        .sale_order()
        .iter()
        .find(|o| {
            o.organization_id == org_id
                && o.client_order_ref == Some("HARNESS-SO-CANCEL".to_string())
        })
        .ok_or("Sale order not found after create")?;

    confirm_sales_order(ctx, org_id, order.id)?;

    cancel_sale_order(
        ctx,
        org_id,
        order.id,
        Some("test cancel with reservation release".to_string()),
    )?;

    let cancelled = ctx
        .db
        .sale_order()
        .id()
        .find(&order.id)
        .ok_or("Sale order not found after cancel")?;
    if cancelled.state != SaleState::Cancelled {
        return Err(format!(
            "Expected Cancelled state, got {:?}",
            cancelled.state
        ));
    }

    let picking = ctx
        .db
        .stock_picking()
        .iter()
        .find(|p| p.organization_id == org_id && p.sale_id == Some(order.id) && !p.is_return)
        .ok_or("Picking not found after cancel")?;
    if picking.state != "cancel" {
        return Err(format!(
            "Expected picking cancel state, got {}",
            picking.state
        ));
    }

    let reserved_after: f64 = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&fixture.product_id)
        .filter(|q| q.organization_id == org_id && q.company_id == company_id)
        .map(|q| q.reserved_quantity)
        .sum();
    if reserved_after > 1e-6 {
        return Err(format!(
            "Expected reserved_quantity 0 after cancel, got {reserved_after}"
        ));
    }

    Ok(())
}

fn minimal_so_params(
    fixture: &OrgFixture,
    product_uom_id: u64,
    qty: f64,
    price_unit: Option<f64>,
    pricelist_id: u64,
    client_order_ref: &str,
    metadata: &str,
) -> CreateSaleOrderParams {
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
            quantity: qty,
            uom_id: product_uom_id,
            price_unit,
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
        origin: Some(metadata.to_string()),
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
        metadata: Some(format!(r#"{{"test":"{metadata}"}}"#)),
    }
}

/// Confirm fails closed when order qty exceeds on-hand ATP.
pub fn test_confirm_fails_on_atp_shortfall(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
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
            name: "ATP Fail Pricelist".to_string(),
            currency_id: 1,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;
    let pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == "ATP Fail Pricelist")
        .map(|p| p.id)
        .ok_or("Pricelist not found")?;

    create_sale_order(
        ctx,
        org_id,
        minimal_so_params(
            &fixture,
            product.uom_id,
            101.0,
            Some(product.list_price),
            pricelist_id,
            "HARNESS-SO-ATP",
            "atp_shortfall",
        ),
    )?;

    let order = ctx
        .db
        .sale_order()
        .iter()
        .find(|o| {
            o.organization_id == org_id && o.client_order_ref == Some("HARNESS-SO-ATP".to_string())
        })
        .ok_or("Sale order not found")?;

    match confirm_sales_order(ctx, org_id, order.id) {
        Ok(()) => Err("Expected confirm to fail on ATP shortfall".to_string()),
        Err(e) if e.contains("Insufficient available quantity") => Ok(()),
        Err(e) => Err(format!("Unexpected confirm error: {e}")),
    }
}

/// Partner payment hold blocks SO confirm.
pub fn test_confirm_blocked_by_partner_credit_hold(ctx: &ReducerContext) -> Result<(), String> {
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

    upsert_partner_credit_control(
        ctx,
        org_id,
        company_id,
        UpsertPartnerCreditControlParams {
            partner_id: fixture.partner_id,
            credit_limit: 0.0,
            payment_hold: true,
            notes: Some("harness hold".to_string()),
            metadata: None,
        },
    )?;

    create_pricelist(
        ctx,
        org_id,
        CreatePricelistParams {
            name: "Credit Hold Pricelist".to_string(),
            currency_id: 1,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;
    let pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == "Credit Hold Pricelist")
        .map(|p| p.id)
        .ok_or("Pricelist not found")?;

    create_sale_order(
        ctx,
        org_id,
        minimal_so_params(
            &fixture,
            product.uom_id,
            1.0,
            Some(product.list_price),
            pricelist_id,
            "HARNESS-SO-CREDIT",
            "credit_hold",
        ),
    )?;

    let order = ctx
        .db
        .sale_order()
        .iter()
        .find(|o| {
            o.organization_id == org_id
                && o.client_order_ref == Some("HARNESS-SO-CREDIT".to_string())
        })
        .ok_or("Sale order not found")?;

    match confirm_sales_order(ctx, org_id, order.id) {
        Ok(()) => Err("Expected confirm to fail on payment hold".to_string()),
        Err(e) if e.contains("payment hold") => Ok(()),
        Err(e) => Err(format!("Unexpected confirm error: {e}")),
    }
}

/// Line create with `price_unit: None` applies fixed pricelist item.
pub fn test_pricelist_applied_on_line_create(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
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
            name: "Fixed Price Pricelist".to_string(),
            currency_id: 1,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;
    let pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == "Fixed Price Pricelist")
        .map(|p| p.id)
        .ok_or("Pricelist not found")?;

    create_pricelist_item(
        ctx,
        org_id,
        CreatePricelistItemParams {
            pricelist_id,
            applied_on: PricelistAppliedOn::Product,
            compute_price: ComputePrice::Fixed,
            product_tmpl_id: None,
            product_id: Some(fixture.product_id),
            categ_id: None,
            min_quantity: 1.0,
            date_start: None,
            date_end: None,
            fixed_price: 42.5,
            percent_price: 0.0,
            price_discount: 0.0,
            price_surcharge: 0.0,
            price_min_margin: 0.0,
            price_max_margin: 0.0,
            sequence: 10,
        },
    )?;

    create_sale_order(
        ctx,
        org_id,
        minimal_so_params(
            &fixture,
            product.uom_id,
            2.0,
            None,
            pricelist_id,
            "HARNESS-SO-PL",
            "pricelist_apply",
        ),
    )?;

    let order = ctx
        .db
        .sale_order()
        .iter()
        .find(|o| {
            o.organization_id == org_id && o.client_order_ref == Some("HARNESS-SO-PL".to_string())
        })
        .ok_or("Sale order not found")?;
    let line = ctx
        .db
        .sale_order_line()
        .order_line_by_order()
        .filter(&order.id)
        .next()
        .ok_or("Sale order line not found")?;

    if (line.price_unit - 42.5).abs() > 1e-6 {
        return Err(format!(
            "Expected pricelist fixed price 42.5, got {}",
            line.price_unit
        ));
    }
    Ok(())
}

/// Draft → Sent via send quotation; confirm from Sent succeeds.
pub fn test_send_quotation_then_confirm(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
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
            name: "Send Quote Pricelist".to_string(),
            currency_id: 1,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;
    let pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == "Send Quote Pricelist")
        .map(|p| p.id)
        .ok_or("Pricelist not found")?;

    create_sale_order(
        ctx,
        org_id,
        minimal_so_params(
            &fixture,
            product.uom_id,
            1.0,
            Some(product.list_price),
            pricelist_id,
            "HARNESS-SO-SENT",
            "send_quote",
        ),
    )?;

    let order = ctx
        .db
        .sale_order()
        .iter()
        .find(|o| {
            o.organization_id == org_id && o.client_order_ref == Some("HARNESS-SO-SENT".to_string())
        })
        .ok_or("Sale order not found")?;

    send_sale_order_quotation(ctx, org_id, order.id)?;
    let sent = ctx
        .db
        .sale_order()
        .id()
        .find(&order.id)
        .ok_or("Sale order not found after send")?;
    if sent.state != SaleState::Sent {
        return Err(format!("Expected Sent after send quotation, got {:?}", sent.state));
    }

    confirm_sales_order(ctx, org_id, order.id)?;
    let confirmed = ctx
        .db
        .sale_order()
        .id()
        .find(&order.id)
        .ok_or("Sale order not found after confirm")?;
    if confirmed.state != SaleState::Sale {
        return Err(format!("Expected Sale after confirm, got {:?}", confirmed.state));
    }
    Ok(())
}

/// Partial validate with backorder creates residual picking and keeps reservation.
pub fn test_partial_validate_creates_backorder(ctx: &ReducerContext) -> Result<(), String> {
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
            name: "Backorder Pricelist".to_string(),
            currency_id: 1,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;
    let pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == "Backorder Pricelist")
        .map(|p| p.id)
        .ok_or("Pricelist not found")?;

    create_sale_order(
        ctx,
        org_id,
        minimal_so_params(
            &fixture,
            product.uom_id,
            10.0,
            Some(product.list_price),
            pricelist_id,
            "HARNESS-SO-BO",
            "backorder",
        ),
    )?;

    let order = ctx
        .db
        .sale_order()
        .iter()
        .find(|o| {
            o.organization_id == org_id && o.client_order_ref == Some("HARNESS-SO-BO".to_string())
        })
        .ok_or("Sale order not found")?;

    confirm_sales_order(ctx, org_id, order.id)?;

    let scope = CompanyScopeParams {
        company_id: Some(company_id),
    };
    let picking = ctx
        .db
        .stock_picking()
        .iter()
        .find(|p| p.organization_id == org_id && p.sale_id == Some(order.id) && !p.is_return)
        .ok_or("Delivery picking not found")?;

    confirm_stock_picking(ctx, org_id, picking.id, scope.clone())?;
    assign_stock_picking(ctx, org_id, picking.id, scope.clone())?;

    let mv = ctx
        .db
        .stock_move()
        .move_by_org()
        .filter(&org_id)
        .find(|m| m.picking_id == Some(picking.id))
        .ok_or("Stock move not found on picking")?;

    done_stock_move(
        ctx,
        org_id,
        mv.id,
        DoneStockMoveParams {
            company_id: Some(company_id),
            quantity_done: 4.0,
        },
    )?;

    validate_stock_picking_backorder(ctx, org_id, picking.id, scope)?;

    let done_picking = ctx
        .db
        .stock_picking()
        .id()
        .find(&picking.id)
        .ok_or("Picking not found after validate")?;
    if done_picking.state != "done" {
        return Err(format!(
            "Expected original picking done, got {}",
            done_picking.state
        ));
    }

    let backorder = ctx
        .db
        .stock_picking()
        .iter()
        .find(|p| p.organization_id == org_id && p.backorder_id == Some(picking.id))
        .ok_or("Backorder picking not created")?;

    let bo_qty: f64 = ctx
        .db
        .stock_move()
        .move_by_org()
        .filter(&org_id)
        .filter(|m| m.picking_id == Some(backorder.id))
        .map(|m| m.product_uom_qty)
        .sum();
    if (bo_qty - 6.0).abs() > 1e-6 {
        return Err(format!("Expected backorder qty 6.0, got {bo_qty}"));
    }

    let reserved: f64 = ctx
        .db
        .stock_quant()
        .quant_by_product()
        .filter(&fixture.product_id)
        .filter(|q| q.organization_id == org_id && q.company_id == company_id)
        .map(|q| q.reserved_quantity)
        .sum();
    if (reserved - 6.0).abs() > 1e-6 {
        return Err(format!(
            "Expected residual reserved_quantity 6.0 after partial ship, got {reserved}"
        ));
    }

    Ok(())
}
