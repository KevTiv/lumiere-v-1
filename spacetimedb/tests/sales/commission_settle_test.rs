//! Commission accrue → settle → clawback domain tests.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_account, account_account_type, account_journal, create_account_account,
    create_account_account_type, create_account_journal, CreateAccountAccountParams,
    CreateAccountAccountTypeParams, CreateAccountJournalParams,
};
use crate::inventory::product::product;
use crate::sales::oms_extensions::{
    accrue_sale_commission, cancel_sale_commission, maybe_accrue_commission_on_invoice_post,
    sale_commission, settle_sale_commissions, AccrueSaleCommissionParams,
    SettleSaleCommissionsParams,
};
use crate::sales::pricelists::{create_pricelist, product_pricelist, CreatePricelistParams};
use crate::sales::sales_core::{
    cancel_sale_order, confirm_sales_order, create_sale_order, sale_order,
    CreateSaleOrderLineParams, CreateSaleOrderParams,
};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{AccountInternalGroup, DiscountPolicy, JournalType};

fn seed_pricelist(ctx: &ReducerContext, org_id: u64, name: &str) -> Result<u64, String> {
    create_pricelist(
        ctx,
        org_id,
        CreatePricelistParams {
            company_id: None,
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

fn create_draft_so_with_commission_meta(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    client_ref: &str,
) -> Result<u64, String> {
    let org_id = fixture.organization_id;
    let product = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("product")?;
    let pricelist_id = seed_pricelist(ctx, org_id, &format!("Comm PL {client_ref}"))?;
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
            origin: None,
            client_order_ref: Some(client_ref.into()),
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
            metadata: Some(r#"{"commission_rate_percent":10.0}"#.into()),
        },
    )?;
    ctx.db
        .sale_order()
        .iter()
        .find(|o| o.client_order_ref.as_deref() == Some(client_ref))
        .map(|o| o.id)
        .ok_or_else(|| format!("SO {client_ref} not found"))
}

fn seed_misc_journal_and_expense(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
) -> Result<(u64, u64, u64), String> {
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let ap_id = *fixture
        .chart_account_ids
        .get(chart_keys::AP)
        .ok_or("Harness missing AP")?;

    let expense_type_name = format!("Comm Expense Type {company_id}");
    create_account_account_type(
        ctx,
        org_id,
        CreateAccountAccountTypeParams {
            company_id: Some(company_id),
            name: expense_type_name.clone(),
            type_: "expense".into(),
            include_initial_balance: false,
            internal_group: AccountInternalGroup::Expense,
            metadata: None,
        },
    )?;
    let expense_type_id = ctx
        .db
        .account_account_type()
        .iter()
        .find(|t| t.organization_id == org_id && t.name == expense_type_name)
        .map(|t| t.id)
        .ok_or("expense type")?;

    let expense_code = format!("6COM{company_id}");
    create_account_account(
        ctx,
        org_id,
        CreateAccountAccountParams {
            company_id: Some(company_id),
            code: expense_code.clone(),
            name: "Commission Expense".into(),
            user_type_id: expense_type_id,
            currency_id: None,
            internal_type: None,
            internal_group: Some(AccountInternalGroup::Expense),
            group_id: None,
            reconcile: false,
            tax_ids: vec![],
            note: None,
            opening_debit: 0.0,
            opening_credit: 0.0,
            allowed_journal_ids: vec![],
            non_trade: false,
            is_off_balance: false,
            metadata: None,
        },
    )?;
    let expense_id = ctx
        .db
        .account_account()
        .iter()
        .find(|a| a.organization_id == org_id && a.code == expense_code)
        .map(|a| a.id)
        .ok_or("commission expense account")?;

    let journal_code = format!("CM{company_id}");
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
                name: "Commission Misc".into(),
                code: journal_code.clone(),
                type_: JournalType::General,
                currency_id: Some(1),
                default_account_id: Some(expense_id),
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
            .ok_or("commission journal")?
    };

    Ok((journal_id, expense_id, ap_id))
}

/// Confirm must not auto-accrue; invoice-post helper accrues from SO metadata.
pub fn test_commission_accrue_on_invoice_hook(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let order_id = create_draft_so_with_commission_meta(ctx, &fixture, "COMM-ACCRUE")?;
    confirm_sales_order(ctx, org_id, fixture.company_id, order_id)?;

    let on_confirm = ctx
        .db
        .sale_commission()
        .commission_by_order()
        .filter(&order_id)
        .count();
    if on_confirm != 0 {
        return Err(format!(
            "expected no commission on confirm, got {on_confirm}"
        ));
    }

    maybe_accrue_commission_on_invoice_post(ctx, org_id, order_id)?;
    let row = ctx
        .db
        .sale_commission()
        .commission_by_order()
        .filter(&order_id)
        .next()
        .ok_or("commission not accrued after invoice-post hook")?;
    if row.state != "accrued" {
        return Err(format!("expected accrued, got {}", row.state));
    }
    if (row.amount - 10.0).abs() > 1e-6 {
        // 2 * 50 * 10% = 10
        return Err(format!("expected amount 10, got {}", row.amount));
    }
    Ok(())
}

/// Accrue → settle GL → refuse double-settle.
pub fn test_commission_settle_and_refuse_double(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let order_id = create_draft_so_with_commission_meta(ctx, &fixture, "COMM-SETTLE")?;
    confirm_sales_order(ctx, org_id, company_id, order_id)?;
    accrue_sale_commission(
        ctx,
        org_id,
        order_id,
        AccrueSaleCommissionParams { rate_percent: 10.0 },
    )?;

    let commission = ctx
        .db
        .sale_commission()
        .commission_by_order()
        .filter(&order_id)
        .next()
        .ok_or("commission missing")?;
    let (journal_id, expense_id, payable_id) = seed_misc_journal_and_expense(ctx, &fixture)?;

    settle_sale_commissions(
        ctx,
        org_id,
        company_id,
        SettleSaleCommissionsParams {
            commission_ids: vec![commission.id],
            journal_id,
            expense_account_id: expense_id,
            payable_account_id: payable_id,
            date: ctx.timestamp,
            reference: Some("COMM-BATCH".into()),
            metadata: None,
        },
    )?;

    let settled = ctx
        .db
        .sale_commission()
        .id()
        .find(&commission.id)
        .ok_or("commission after settle")?;
    if settled.state != "settled" {
        return Err(format!("expected settled, got {}", settled.state));
    }
    if settled.settle_move_id.is_none() {
        return Err("settle_move_id missing".into());
    }

    let double = settle_sale_commissions(
        ctx,
        org_id,
        company_id,
        SettleSaleCommissionsParams {
            commission_ids: vec![commission.id],
            journal_id,
            expense_account_id: expense_id,
            payable_account_id: payable_id,
            date: ctx.timestamp,
            reference: None,
            metadata: None,
        },
    );
    if double.is_ok() {
        return Err("double settle should fail".into());
    }
    Ok(())
}

/// Cancel SO claws back accrued commissions; cancel_sale_commission works while accrued.
pub fn test_commission_cancel_clawback(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

    let order_a = create_draft_so_with_commission_meta(ctx, &fixture, "COMM-CANCEL-A")?;
    confirm_sales_order(ctx, org_id, company_id, order_a)?;
    accrue_sale_commission(
        ctx,
        org_id,
        order_a,
        AccrueSaleCommissionParams { rate_percent: 5.0 },
    )?;
    let c_a = ctx
        .db
        .sale_commission()
        .commission_by_order()
        .filter(&order_a)
        .next()
        .ok_or("commission A")?;
    cancel_sale_commission(ctx, org_id, company_id, c_a.id)?;
    let cancelled = ctx
        .db
        .sale_commission()
        .id()
        .find(&c_a.id)
        .ok_or("commission A after cancel")?;
    if cancelled.state != "cancelled" {
        return Err(format!("expected cancelled, got {}", cancelled.state));
    }

    let order_b = create_draft_so_with_commission_meta(ctx, &fixture, "COMM-CANCEL-B")?;
    confirm_sales_order(ctx, org_id, company_id, order_b)?;
    accrue_sale_commission(
        ctx,
        org_id,
        order_b,
        AccrueSaleCommissionParams { rate_percent: 5.0 },
    )?;
    cancel_sale_order(ctx, org_id, order_b, Some("clawback-test".into()))?;
    let after = ctx
        .db
        .sale_commission()
        .commission_by_order()
        .filter(&order_b)
        .next()
        .ok_or("commission B")?;
    if after.state != "cancelled" {
        return Err(format!(
            "expected SO cancel to claw back accrued commission, got {}",
            after.state
        ));
    }
    Ok(())
}
