/// Sales order core flow domain tests.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{account_journal, create_account_journal, CreateAccountJournalParams};
use crate::accounting::journal_entries::{
    account_move, account_move_line, create_invoice_from_sale_order, AddAccountMoveLineParams,
    CreateInvoiceFromSaleOrderParams,
};
use crate::core::organization::CompanyScopeParams;
use crate::inventory::product::product;
use crate::inventory::stock::{
    assign_stock_picking, confirm_stock_picking, stock_picking, validate_stock_picking,
};
use crate::sales::pricelists::{create_pricelist, product_pricelist, CreatePricelistParams};
use crate::sales::sales_core::{
    confirm_sales_order, create_sale_order, sale_order, sale_order_line, CreateSaleOrderLineParams,
    CreateSaleOrderParams,
};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{DiscountPolicy, InvoiceStatus, JournalType, LineInvoiceStatus, MoveType, SaleState};

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
            incoterm: None,
            incoterm_location: None,
            carrier_id: None,
            customer_lead: None,
            analytic_account_id: None,
            user_id: None,
            is_printed: None,
            is_locked: None,
            is_dropship: None,
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
            incoterm: None,
            incoterm_location: None,
            carrier_id: None,
            customer_lead: None,
            analytic_account_id: None,
            user_id: None,
            is_printed: None,
            is_locked: None,
            is_dropship: None,
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
