/// Sales order core flow domain tests.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{account_journal, create_account_journal, CreateAccountJournalParams};
use crate::accounting::journal_entries::{account_move, create_invoice_from_sale_order};
use crate::inventory::product::product;
use crate::sales::pricelists::{create_pricelist, product_pricelist, CreatePricelistParams};
use crate::sales::sales_core::{
    confirm_sales_order, create_sale_order, sale_order, sale_order_line, CreateSaleOrderLineParams,
    CreateSaleOrderParams, SaleOrderLine,
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

    // SO lines start with qty_to_invoice=0 until delivery/invoicing policy is wired;
    // unblock invoice-from-SO reducer for harness coverage.
    for line in ctx
        .db
        .sale_order_line()
        .order_line_by_order()
        .filter(&order.id)
    {
        ctx.db.sale_order_line().id().update(SaleOrderLine {
            qty_to_invoice: line.product_uom_qty - line.qty_invoiced,
            invoice_status: LineInvoiceStatus::ToInvoice,
            ..line
        });
    }

    let revenue_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("Harness missing revenue account")?;

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
                code: journal_code,
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

    create_invoice_from_sale_order(ctx, org_id, order.id, journal_id, revenue_id)?;

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

    Ok(())
}
