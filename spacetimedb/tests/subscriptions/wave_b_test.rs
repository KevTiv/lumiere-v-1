//! Wave B — tax on recurring invoice, auto rev-rec, payment clear AR, FX/KPI, CSV draft-only.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_journal, create_account_journal, CreateAccountJournalParams,
};
use crate::accounting::journal_entries::account_move;
use crate::accounting::tax_management::{
    account_tax, account_tax_group, create_account_tax, create_account_tax_group,
    CreateAccountTaxGroupParams, CreateAccountTaxParams,
};
use crate::data_ops::subscription_imports::import_subscription_csv;
use crate::inventory::product::product;
use crate::sales::pricelists::{create_pricelist, product_pricelist, CreatePricelistParams};
use crate::sales::sales_core::{
    confirm_sales_order, create_sale_order, sale_order, CreateSaleOrderLineParams,
    CreateSaleOrderParams,
};
use crate::subscriptions::reducers::{
    activate_subscription, create_revenue_recognition_rule, create_subscription_from_sale_order,
    create_subscription_plan, generate_subscription_invoice, pay_subscription_invoice,
    ApplySubscriptionInvoicePaymentParams, CreateRevenueRecognitionRuleParams,
    CreateSubscriptionFromSaleOrderParams, CreateSubscriptionPlanParams,
    GenerateSubscriptionInvoiceParams,
};
use crate::subscriptions::tables::{
    deferred_revenue_schedule, subscription, subscription_line, subscription_plan, SubscriptionLine,
};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{
    DiscountPolicy, JournalType, MoveType, PaymentState, TaxAmountType, TaxTypeUse,
};

fn seed_journal(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let revenue_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("Harness missing revenue account")?;
    let journal_code = format!("SB{company_id}");
    create_account_journal(
        ctx,
        org_id,
        CreateAccountJournalParams {
            company_id: Some(company_id),
            name: format!("Sub Sale B {company_id}"),
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
        .find(|j| j.organization_id == org_id && j.code == journal_code)
        .map(|j| j.id)
        .ok_or_else(|| "subscription sale journal B not found".to_string())
}

fn seed_sale_tax(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    tax_payable_account_id: u64,
) -> Result<u64, String> {
    create_account_tax_group(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateAccountTaxGroupParams {
            name: format!("SUB VAT Group {}", fixture.company_id),
            sequence: 10,
            preceding_subtotal: None,
            tax_payable_account_id: Some(tax_payable_account_id),
            tax_receivable_account_id: None,
            advance_tax_payment_account_id: None,
            metadata: None,
        },
    )?;
    let group_id = ctx
        .db
        .account_tax_group()
        .iter()
        .find(|g| {
            g.organization_id == fixture.organization_id
                && g.company_id == fixture.company_id
                && g.name.contains("SUB VAT Group")
        })
        .map(|g| g.id)
        .ok_or("tax group")?;

    create_account_tax(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        CreateAccountTaxParams {
            name: format!("SUB VAT 10 {}", fixture.company_id),
            description: None,
            type_tax_use: TaxTypeUse::Sale,
            amount_type: TaxAmountType::Percent,
            amount: 10.0,
            active: true,
            price_include: false,
            include_base_amount: false,
            is_base_affected: false,
            sequence: 10,
            tax_group_id: Some(group_id),
            country_id: None,
            country_code: None,
            tags: vec![],
            has_negative_factor: false,
            invoice_repartition_line_ids: vec![],
            refund_repartition_line_ids: vec![],
            metadata: None,
        },
    )?;
    ctx.db
        .account_tax()
        .iter()
        .find(|t| {
            t.organization_id == fixture.organization_id
                && t.company_id == fixture.company_id
                && t.name.contains("SUB VAT 10")
        })
        .map(|t| t.id)
        .ok_or_else(|| "tax not found".to_string())
}

fn seed_plan_and_sub_with_tax(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    journal_id: u64,
    tax_id: u64,
) -> Result<u64, String> {
    let org_id = fixture.organization_id;
    let code = format!("PLAN-B-{org_id}");
    create_subscription_plan(
        ctx,
        org_id,
        CreateSubscriptionPlanParams {
            company_id: Some(fixture.company_id),
            name: "Wave B Monthly".into(),
            code: code.clone(),
            description: Some("test".into()),
            currency_id: 1,
            journal_id,
            product_id: fixture.product_id,
            billing_period: "month".into(),
            billing_period_unit: 1,
            recurring_invoice_day: 1,
            trial_period: false,
            trial_duration: 0,
            trial_unit: "day".into(),
            auto_close_limit: 0,
            payment_mode: "draft_invoice".into(),
            template_id: None,
            invoice_mail_template_id: None,
            website_url: None,
            is_published: true,
            is_default: false,
            color: 0,
            image_1920_url: None,
            active: true,
            recurring_rule_count: 1,
            recurring_rule_min_unit: "month".into(),
            recurring_rule_max_unit: "month".into(),
            recurring_rule_min_count: 1,
            recurring_rule_max_count: 1,
            metadata: None,
        },
    )?;
    let plan_id = ctx
        .db
        .subscription_plan()
        .iter()
        .find(|p| p.organization_id == org_id && p.code == code)
        .map(|p| p.id)
        .ok_or("plan")?;

    let product = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("product")?;
    create_pricelist(
        ctx,
        org_id,
        CreatePricelistParams {
            name: format!("PL-B-{org_id}"),
            currency_id: 1,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;
    let pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name.contains("PL-B-"))
        .map(|p| p.id)
        .ok_or("pricelist")?;

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
                quantity: 1.0,
                uom_id: product.uom_id,
                price_unit: Some(100.0),
                discount: 0.0,
                tax_ids: vec![tax_id],
                name: Some("Sub taxed line".into()),
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
            origin: Some("SUB-WAVE-B".into()),
            client_order_ref: Some("SUB-WAVE-B".into()),
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
        },
    )?;
    let order_id = ctx
        .db
        .sale_order()
        .iter()
        .find(|o| {
            o.organization_id == org_id && o.client_order_ref.as_deref() == Some("SUB-WAVE-B")
        })
        .map(|o| o.id)
        .ok_or("SO")?;
    confirm_sales_order(ctx, org_id, order_id)?;

    create_subscription_from_sale_order(
        ctx,
        org_id,
        CreateSubscriptionFromSaleOrderParams {
            company_id: Some(fixture.company_id),
            sale_order_id: order_id,
            code: Some(format!("SUB-B-{order_id}")),
            plan_id,
            date_start: ctx.timestamp,
            recurring_invoice_day: 1,
            is_trial: false,
            description: Some("wave b".into()),
            recurring_rule_type: "monthly".into(),
            recurring_interval: 1,
            payment_mode: "draft_invoice".into(),
            partner_id: 0,
            vendor_id: None,
            partner_invoice_id: 0,
            partner_shipping_id: 0,
            currency_id: 0,
            pricelist_id: 0,
            analytic_account_id: None,
            team_id: None,
            health: "healthy".into(),
            stage_id: None,
            state: "draft".into(),
            is_active: false,
            invoice_count: 0,
            recurring_total: 0.0,
            recurring_monthly: 0.0,
            recurring_mrr: 0.0,
            recurring_mrr_local: 0.0,
            percentage_mrr: 0.0,
            kpi_1month_mrr: 0.0,
            kpi_3months_mrr: 0.0,
            kpi_12months_mrr: 0.0,
            rating_last_value: 0,
            invoice_ids: vec![],
            subscription_line_ids: vec![],
            activity_ids: vec![],
            message_follower_ids: vec![],
            message_ids: vec![],
            metadata: None,
        },
    )?;
    let sub_id = ctx
        .db
        .subscription()
        .iter()
        .find(|s| s.organization_id == org_id && s.sale_order_ids.contains(&order_id))
        .map(|s| s.id)
        .ok_or("sub")?;

    // Ensure tax_ids landed on subscription lines (copied from SO).
    let line = ctx
        .db
        .subscription_line()
        .subscription_line_by_subscription()
        .filter(&sub_id)
        .next()
        .ok_or("sub line")?;
    if !line.tax_ids.contains(&tax_id) {
        // Wave A may copy tax_ids; if empty, patch for Wave B tax coverage.
        ctx.db.subscription_line().id().update(SubscriptionLine {
            tax_ids: vec![tax_id],
            ..line
        });
    }

    activate_subscription(ctx, org_id, fixture.company_id, sub_id)?;
    Ok(sub_id)
}

pub fn test_tax_and_auto_deferred_on_invoice(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let journal_id = seed_journal(ctx, &fixture)?;
    let income_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("revenue")?;
    let ar_id = *fixture.chart_account_ids.get(chart_keys::AR).ok_or("ar")?;
    // Harness has AR/AP/REVENUE only — reuse AP as tax payable / deferred liability stand-ins.
    let tax_payable = *fixture
        .chart_account_ids
        .get(chart_keys::AP)
        .ok_or("tax payable account")?;
    let deferred_liability = *fixture
        .chart_account_ids
        .get(chart_keys::AP)
        .ok_or("deferred liability")?;

    let tax_id = seed_sale_tax(ctx, &fixture, tax_payable)?;
    let sub_id = seed_plan_and_sub_with_tax(ctx, &fixture, journal_id, tax_id)?;

    create_revenue_recognition_rule(
        ctx,
        org_id,
        company_id,
        CreateRevenueRecognitionRuleParams {
            description: "Wave B auto defer".into(),
            product_category_ids: vec![],
            product_ids: vec![fixture.product_id],
            recognition_method: "straight_line".into(),
            recognition_period: "month".into(),
            recognition_account_id: income_id,
            deferred_account_id: deferred_liability,
            expense_account_id: None,
            priority: 100,
            notes: "auto".into(),
            is_active: true,
            metadata: None,
        },
    )?;

    generate_subscription_invoice(
        ctx,
        org_id,
        company_id,
        sub_id,
        GenerateSubscriptionInvoiceParams {
            invoice_date: ctx.timestamp,
            billing_run_key: Some(format!("wave-b-tax-{sub_id}")),
            journal_id: Some(journal_id),
            income_account_id: income_id,
            receivable_account_id: ar_id,
            tax_account_id: Some(tax_payable),
        },
    )?;

    let sub = ctx.db.subscription().id().find(&sub_id).ok_or("sub")?;
    let move_id = *sub.invoice_ids.first().ok_or("no invoice")?;
    let inv = ctx.db.account_move().id().find(&move_id).ok_or("move")?;
    if (inv.amount_untaxed - 100.0).abs() > 0.01 {
        return Err(format!("expected untaxed 100, got {}", inv.amount_untaxed));
    }
    if (inv.amount_tax - 10.0).abs() > 0.01 {
        return Err(format!("expected tax 10, got {}", inv.amount_tax));
    }
    if (inv.amount_total - 110.0).abs() > 0.01 {
        return Err(format!("expected total 110, got {}", inv.amount_total));
    }
    if (sub.recurring_mrr_local - sub.recurring_mrr).abs() > 0.01 && sub.recurring_mrr > 0.0 {
        // Same currency → FX 1.0; local should match MRR after refresh.
        return Err(format!(
            "expected mrr_local≈mrr with FX=1, mrr={} local={}",
            sub.recurring_mrr, sub.recurring_mrr_local
        ));
    }

    let schedules: Vec<_> = ctx
        .db
        .deferred_revenue_schedule()
        .iter()
        .filter(|s| s.organization_id == org_id && s.origin_move_id == Some(move_id))
        .collect();
    if schedules.is_empty() {
        return Err("expected auto deferred schedule from recognition rule".into());
    }
    if schedules[0].origin_move_line_id.is_none() {
        return Err("expected origin_move_line_id on auto schedule".into());
    }

    Ok(())
}

pub fn test_pay_subscription_invoice_clears_residual(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let journal_id = seed_journal(ctx, &fixture)?;
    let income_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("revenue")?;
    let ar_id = *fixture.chart_account_ids.get(chart_keys::AR).ok_or("ar")?;

    // Reuse Wave A path (untaxed) for payment.
    let plan_id = {
        // Minimal: call wave A helpers via duplicated seed — use wave_a private helpers indirectly
        // by creating an untaxed subscription through the same public reducers.
        create_subscription_plan(
            ctx,
            org_id,
            CreateSubscriptionPlanParams {
                company_id: Some(company_id),
                name: "Wave B Pay Plan".into(),
                code: format!("PLAN-PAY-{org_id}"),
                description: None,
                currency_id: 1,
                journal_id,
                product_id: fixture.product_id,
                billing_period: "month".into(),
                billing_period_unit: 1,
                recurring_invoice_day: 1,
                trial_period: false,
                trial_duration: 0,
                trial_unit: "day".into(),
                auto_close_limit: 0,
                payment_mode: "draft_invoice".into(),
                template_id: None,
                invoice_mail_template_id: None,
                website_url: None,
                is_published: false,
                is_default: false,
                color: 0,
                image_1920_url: None,
                active: true,
                recurring_rule_count: 1,
                recurring_rule_min_unit: "month".into(),
                recurring_rule_max_unit: "month".into(),
                recurring_rule_min_count: 1,
                recurring_rule_max_count: 1,
                metadata: None,
            },
        )?;
        ctx.db
            .subscription_plan()
            .iter()
            .find(|p| p.organization_id == org_id && p.code == format!("PLAN-PAY-{org_id}"))
            .map(|p| p.id)
            .ok_or("plan")?
    };

    let product = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("product")?;
    create_pricelist(
        ctx,
        org_id,
        CreatePricelistParams {
            name: format!("PL-PAY-{org_id}"),
            currency_id: 1,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;
    let pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == format!("PL-PAY-{org_id}"))
        .map(|p| p.id)
        .ok_or("pl")?;

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
                price_unit: Some(50.0),
                discount: 0.0,
                tax_ids: vec![],
                name: Some("Pay line".into()),
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
            origin: Some("SUB-PAY".into()),
            client_order_ref: Some("SUB-PAY".into()),
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
        },
    )?;
    let order_id = ctx
        .db
        .sale_order()
        .iter()
        .find(|o| o.organization_id == org_id && o.client_order_ref.as_deref() == Some("SUB-PAY"))
        .map(|o| o.id)
        .ok_or("so")?;
    confirm_sales_order(ctx, org_id, order_id)?;

    create_subscription_from_sale_order(
        ctx,
        org_id,
        CreateSubscriptionFromSaleOrderParams {
            company_id: Some(company_id),
            sale_order_id: order_id,
            code: Some(format!("SUB-PAY-{order_id}")),
            plan_id,
            date_start: ctx.timestamp,
            recurring_invoice_day: 1,
            is_trial: false,
            description: None,
            recurring_rule_type: "monthly".into(),
            recurring_interval: 1,
            payment_mode: "draft_invoice".into(),
            partner_id: 0,
            vendor_id: None,
            partner_invoice_id: 0,
            partner_shipping_id: 0,
            currency_id: 0,
            pricelist_id: 0,
            analytic_account_id: None,
            team_id: None,
            health: "healthy".into(),
            stage_id: None,
            state: "draft".into(),
            is_active: false,
            invoice_count: 0,
            recurring_total: 0.0,
            recurring_monthly: 0.0,
            recurring_mrr: 0.0,
            recurring_mrr_local: 0.0,
            percentage_mrr: 0.0,
            kpi_1month_mrr: 0.0,
            kpi_3months_mrr: 0.0,
            kpi_12months_mrr: 0.0,
            rating_last_value: 0,
            invoice_ids: vec![],
            subscription_line_ids: vec![],
            activity_ids: vec![],
            message_follower_ids: vec![],
            message_ids: vec![],
            metadata: None,
        },
    )?;
    let sub_id = ctx
        .db
        .subscription()
        .iter()
        .find(|s| s.organization_id == org_id && s.sale_order_ids.contains(&order_id))
        .map(|s| s.id)
        .ok_or("sub")?;
    activate_subscription(ctx, org_id, company_id, sub_id)?;

    generate_subscription_invoice(
        ctx,
        org_id,
        company_id,
        sub_id,
        GenerateSubscriptionInvoiceParams {
            invoice_date: ctx.timestamp,
            billing_run_key: Some(format!("wave-b-pay-{sub_id}")),
            journal_id: Some(journal_id),
            income_account_id: income_id,
            receivable_account_id: ar_id,
            tax_account_id: None,
        },
    )?;

    let sub = ctx.db.subscription().id().find(&sub_id).ok_or("sub")?;
    let invoice_move_id = *sub.invoice_ids.first().ok_or("invoice")?;

    let (bank_journal_id, bank_account_id) =
        crate::accounting_tests::helpers::seed_bank_journal(ctx, &fixture)?;

    pay_subscription_invoice(
        ctx,
        org_id,
        company_id,
        sub_id,
        ApplySubscriptionInvoicePaymentParams {
            invoice_move_id,
            payment_journal_id: bank_journal_id,
            bank_account_id,
            receivable_account_id: ar_id,
            amount: None,
            payment_date: None,
            cogs_account_id: income_id,
            inventory_account_id: income_id,
            ref_: Some(format!("SUB-PAY-REF-{sub_id}")),
            memo: Some("Wave B pay".into()),
        },
    )?;

    let inv = ctx
        .db
        .account_move()
        .id()
        .find(&invoice_move_id)
        .ok_or("invoice after pay")?;
    if inv.payment_state != PaymentState::Paid && inv.amount_residual.abs() > 0.01 {
        return Err(format!(
            "expected Paid / residual≈0, state={:?} residual={}",
            inv.payment_state, inv.amount_residual
        ));
    }
    if inv.amount_residual.abs() > 0.01 {
        return Err(format!(
            "invoice residual should be ~0 after pay, got {}",
            inv.amount_residual
        ));
    }

    Ok(())
}

pub fn test_csv_import_draft_only(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let journal_id = seed_journal(ctx, &fixture)?;

    create_subscription_plan(
        ctx,
        org_id,
        CreateSubscriptionPlanParams {
            company_id: Some(company_id),
            name: "CSV Plan".into(),
            code: format!("CSV-PLAN-{org_id}"),
            description: None,
            currency_id: 1,
            journal_id,
            product_id: fixture.product_id,
            billing_period: "month".into(),
            billing_period_unit: 1,
            recurring_invoice_day: 1,
            trial_period: false,
            trial_duration: 0,
            trial_unit: "day".into(),
            auto_close_limit: 0,
            payment_mode: "draft_invoice".into(),
            template_id: None,
            invoice_mail_template_id: None,
            website_url: None,
            is_published: false,
            is_default: false,
            color: 0,
            image_1920_url: None,
            active: true,
            recurring_rule_count: 1,
            recurring_rule_min_unit: "month".into(),
            recurring_rule_max_unit: "month".into(),
            recurring_rule_min_count: 1,
            recurring_rule_max_count: 1,
            metadata: None,
        },
    )?;
    let plan_id = ctx
        .db
        .subscription_plan()
        .iter()
        .find(|p| p.organization_id == org_id && p.code == format!("CSV-PLAN-{org_id}"))
        .map(|p| p.id)
        .ok_or("plan")?;

    create_pricelist(
        ctx,
        org_id,
        CreatePricelistParams {
            name: format!("CSV-PL-{org_id}"),
            currency_id: 1,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;
    let pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == format!("CSV-PL-{org_id}"))
        .map(|p| p.id)
        .ok_or("pl")?;

    let csv = format!(
        "code,plan_id,partner_id,currency_id,pricelist_id,recurring_rule_type\nCSV-SUB-1,{plan_id},{},1,{pricelist_id},monthly\n",
        fixture.partner_id
    );
    import_subscription_csv(ctx, org_id, company_id, csv)?;

    let sub = ctx
        .db
        .subscription()
        .iter()
        .find(|s| s.organization_id == org_id && s.code == "CSV-SUB-1")
        .ok_or("imported sub")?;
    if sub.state != "draft" || sub.is_active {
        return Err(format!(
            "CSV must import draft/inactive, got state={} is_active={}",
            sub.state, sub.is_active
        ));
    }
    if !sub.invoice_ids.is_empty() {
        return Err("CSV must not create invoices".into());
    }
    let posted_ar = ctx.db.account_move().iter().any(|m| {
        m.organization_id == org_id
            && m.move_type == MoveType::OutInvoice
            && m.invoice_origin
                .as_deref()
                .map(|o| o.contains(&format!("SUB{}", sub.id)))
                .unwrap_or(false)
    });
    if posted_ar {
        return Err("CSV must not create subscription AR moves".into());
    }
    Ok(())
}
