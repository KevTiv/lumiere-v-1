//! Wave D — usage ingest/rating, tiers, commitment true-up, bundles.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_journal, create_account_journal, CreateAccountJournalParams,
};
use crate::accounting::journal_entries::account_move;
use crate::inventory::product::product;
use crate::sales::pricelists::{create_pricelist, product_pricelist, CreatePricelistParams};
use crate::sales::sales_core::{
    confirm_sales_order, create_sale_order, sale_order, CreateSaleOrderLineParams,
    CreateSaleOrderParams,
};
use crate::subscriptions::reducers::{
    activate_subscription, create_subscription_from_sale_order, create_subscription_plan,
    generate_subscription_invoice, CreateSubscriptionFromSaleOrderParams,
    CreateSubscriptionPlanParams, GenerateSubscriptionInvoiceParams,
};
use crate::subscriptions::subscription_wave_d::{
    add_subscription_bundle_item, apply_subscription_bundle, create_subscription_bundle,
    create_subscription_price_tier, ingest_subscription_usage_event,
    rate_subscription_usage_events, set_subscription_commitment, subscription_bundle,
    subscription_usage_charge, subscription_usage_event, AddSubscriptionBundleItemParams,
    ApplySubscriptionBundleParams, CreateSubscriptionBundleParams,
    CreateSubscriptionPriceTierParams, IngestSubscriptionUsageEventParams,
    RateSubscriptionUsageEventsParams, SetSubscriptionCommitmentParams,
};
use crate::subscriptions::tables::{subscription, subscription_line, subscription_plan};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{DiscountPolicy, JournalType};

fn seed_journal(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let revenue_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("revenue")?;
    let code = format!("SD{company_id}");
    create_account_journal(
        ctx,
        org_id,
        CreateAccountJournalParams {
            company_id: Some(company_id),
            name: format!("Sub D {company_id}"),
            code: code.clone(),
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
        .find(|j| j.organization_id == org_id && j.code == code)
        .map(|j| j.id)
        .ok_or_else(|| "journal".to_string())
}

fn seed_active_subscription(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    journal_id: u64,
    label: &str,
    price: f64,
) -> Result<(u64, u64), String> {
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let plan_code = format!("PLAN-D-{label}-{org_id}");
    create_subscription_plan(
        ctx,
        org_id,
        CreateSubscriptionPlanParams {
            company_id: Some(company_id),
            name: format!("Wave D {label}"),
            code: plan_code.clone(),
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
        .find(|p| p.organization_id == org_id && p.code == plan_code)
        .map(|p| p.id)
        .ok_or("plan")?;

    let product = ctx
        .db
        .product()
        .id()
        .find(&fixture.product_id)
        .ok_or("product")?;
    let pl_name = format!("PL-D-{label}-{org_id}");
    create_pricelist(
        ctx,
        org_id,
        CreatePricelistParams {
            name: pl_name.clone(),
            currency_id: 1,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;
    let pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == pl_name)
        .map(|p| p.id)
        .ok_or("pricelist")?;

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
                price_unit: Some(price),
                discount: 0.0,
                tax_ids: vec![],
                name: Some(format!("D {label}")),
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
            origin: Some(label.into()),
            client_order_ref: Some(label.into()),
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
    let so_id = ctx
        .db
        .sale_order()
        .iter()
        .find(|o| o.organization_id == org_id && o.client_order_ref.as_deref() == Some(label))
        .map(|o| o.id)
        .ok_or("so")?;
    confirm_sales_order(ctx, org_id, fixture.company_id, so_id)?;

    create_subscription_from_sale_order(
        ctx,
        org_id,
        CreateSubscriptionFromSaleOrderParams {
            company_id: Some(company_id),
            sale_order_id: so_id,
            code: Some(format!("SUB-D-{label}-{so_id}")),
            plan_id,
            date_start: ctx.timestamp,
            recurring_invoice_day: 1,
            is_trial: false,
            description: Some("wave d".into()),
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
        .filter(|s| s.organization_id == org_id)
        .max_by_key(|s| s.id)
        .map(|s| s.id)
        .ok_or("sub")?;
    activate_subscription(ctx, org_id, company_id, sub_id)?;
    Ok((sub_id, plan_id))
}

/// Duplicate event id is ignored; rating uses progressive tiers; invoice consumes charges.
pub fn test_usage_ingest_rate_and_bill(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let journal_id = seed_journal(ctx, &fixture)?;
    let revenue_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("rev")?;
    let ar_id = *fixture.chart_account_ids.get(chart_keys::AR).ok_or("ar")?;

    let (sub_id, plan_id) = seed_active_subscription(ctx, &fixture, journal_id, "usage", 50.0)?;

    create_subscription_price_tier(
        ctx,
        org_id,
        company_id,
        CreateSubscriptionPriceTierParams {
            plan_id,
            product_id: None,
            sequence: 1,
            min_qty: 0.0,
            max_qty: Some(100.0),
            unit_price: 1.0,
            active: true,
            metadata: None,
        },
    )?;
    create_subscription_price_tier(
        ctx,
        org_id,
        company_id,
        CreateSubscriptionPriceTierParams {
            plan_id,
            product_id: None,
            sequence: 2,
            min_qty: 100.0,
            max_qty: None,
            unit_price: 0.5,
            active: true,
            metadata: None,
        },
    )?;

    let ingest = IngestSubscriptionUsageEventParams {
        source: "meter".into(),
        event_id: "evt-1".into(),
        quantity: 150.0,
        unit: "api_call".into(),
        product_id: None,
        occurred_at: None,
        metadata: None,
    };
    ingest_subscription_usage_event(ctx, org_id, company_id, sub_id, ingest.clone())?;
    // Idempotent duplicate
    ingest_subscription_usage_event(ctx, org_id, company_id, sub_id, ingest)?;

    let event_count = ctx
        .db
        .subscription_usage_event()
        .iter()
        .filter(|e| e.subscription_id == sub_id)
        .count();
    if event_count != 1 {
        return Err(format!("expected 1 usage event, got {event_count}"));
    }

    rate_subscription_usage_events(
        ctx,
        org_id,
        company_id,
        sub_id,
        RateSubscriptionUsageEventsParams {
            limit: 50,
            fallback_unit_price: None,
        },
    )?;

    let charge = ctx
        .db
        .subscription_usage_charge()
        .iter()
        .find(|c| c.subscription_id == sub_id && c.status == "unbilled")
        .ok_or("unbilled charge")?;
    // 100*1 + 50*0.5 = 125
    if (charge.amount - 125.0).abs() > 0.01 {
        return Err(format!("expected rated amount 125, got {}", charge.amount));
    }

    generate_subscription_invoice(
        ctx,
        org_id,
        company_id,
        sub_id,
        GenerateSubscriptionInvoiceParams {
            invoice_date: ctx.timestamp,
            journal_id: Some(journal_id),
            income_account_id: revenue_id,
            receivable_account_id: ar_id,
            tax_account_id: None,
            billing_run_key: Some(format!("d-usage-{sub_id}")),
        },
    )?;

    let billed = ctx
        .db
        .subscription_usage_charge()
        .iter()
        .find(|c| c.id == charge.id)
        .ok_or("charge after bill")?;
    if billed.status != "billed" {
        return Err(format!("charge should be billed, got {}", billed.status));
    }
    let move_id = billed.invoice_move_id.ok_or("invoice_move_id")?;
    let mv = ctx.db.account_move().id().find(&move_id).ok_or("move")?;
    // Recurring 50 + usage 125 = 175
    if (mv.amount_untaxed - 175.0).abs() > 0.01 {
        return Err(format!(
            "expected untaxed 175 (50+125), got {}",
            mv.amount_untaxed
        ));
    }
    Ok(())
}

/// Commitment floor creates true-up when usage below min.
pub fn test_commitment_true_up(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let journal_id = seed_journal(ctx, &fixture)?;
    let revenue_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("rev")?;
    let ar_id = *fixture.chart_account_ids.get(chart_keys::AR).ok_or("ar")?;

    let (sub_id, plan_id) = seed_active_subscription(ctx, &fixture, journal_id, "commit", 10.0)?;

    create_subscription_price_tier(
        ctx,
        org_id,
        company_id,
        CreateSubscriptionPriceTierParams {
            plan_id,
            product_id: None,
            sequence: 1,
            min_qty: 0.0,
            max_qty: None,
            unit_price: 1.0,
            active: true,
            metadata: None,
        },
    )?;
    set_subscription_commitment(
        ctx,
        org_id,
        company_id,
        sub_id,
        SetSubscriptionCommitmentParams {
            min_amount: 200.0,
            product_id: None,
            active: true,
            metadata: None,
        },
    )?;

    ingest_subscription_usage_event(
        ctx,
        org_id,
        company_id,
        sub_id,
        IngestSubscriptionUsageEventParams {
            source: "meter".into(),
            event_id: "low-1".into(),
            quantity: 20.0,
            unit: "unit".into(),
            product_id: None,
            occurred_at: None,
            metadata: None,
        },
    )?;
    rate_subscription_usage_events(
        ctx,
        org_id,
        company_id,
        sub_id,
        RateSubscriptionUsageEventsParams {
            limit: 10,
            fallback_unit_price: Some(1.0),
        },
    )?;

    generate_subscription_invoice(
        ctx,
        org_id,
        company_id,
        sub_id,
        GenerateSubscriptionInvoiceParams {
            invoice_date: ctx.timestamp,
            journal_id: Some(journal_id),
            income_account_id: revenue_id,
            receivable_account_id: ar_id,
            tax_account_id: None,
            billing_run_key: Some(format!("d-commit-{sub_id}")),
        },
    )?;

    let true_up = ctx
        .db
        .subscription_usage_charge()
        .iter()
        .find(|c| c.subscription_id == sub_id && c.tier_band == "commitment")
        .ok_or("true-up charge")?;
    // usage 20, commit 200 → true-up 180
    if (true_up.amount - 180.0).abs() > 0.01 {
        return Err(format!("expected true-up 180, got {}", true_up.amount));
    }
    Ok(())
}

/// Bundle items materialize as subscription lines.
pub fn test_bundle_apply(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let journal_id = seed_journal(ctx, &fixture)?;
    let (sub_id, plan_id) = seed_active_subscription(ctx, &fixture, journal_id, "bundle", 25.0)?;

    create_subscription_bundle(
        ctx,
        org_id,
        company_id,
        CreateSubscriptionBundleParams {
            plan_id,
            name: "Starter pack".into(),
            code: format!("BND-{org_id}"),
            active: true,
            metadata: None,
        },
    )?;
    let bundle_id = ctx
        .db
        .subscription_bundle()
        .iter()
        .find(|b| b.organization_id == org_id)
        .map(|b| b.id)
        .ok_or("bundle")?;

    add_subscription_bundle_item(
        ctx,
        org_id,
        company_id,
        bundle_id,
        AddSubscriptionBundleItemParams {
            product_id: fixture.product_id,
            name: "Addon seats".into(),
            quantity: 5.0,
            price_unit: 12.0,
            is_addon: true,
            sequence: 1,
            active: true,
            metadata: None,
        },
    )?;

    let before = ctx
        .db
        .subscription_line()
        .iter()
        .filter(|l| l.subscription_id == sub_id)
        .count();

    apply_subscription_bundle(
        ctx,
        org_id,
        company_id,
        sub_id,
        ApplySubscriptionBundleParams { bundle_id },
    )?;

    let after = ctx
        .db
        .subscription_line()
        .iter()
        .filter(|l| l.subscription_id == sub_id)
        .count();
    if after != before + 1 {
        return Err(format!("expected +1 line, before={before} after={after}"));
    }
    let addon = ctx
        .db
        .subscription_line()
        .iter()
        .find(|l| l.subscription_id == sub_id && l.name == "Addon seats")
        .ok_or("addon line")?;
    if (addon.price_unit - 12.0).abs() > 0.01 || (addon.product_uom_qty - 5.0).abs() > 0.01 {
        return Err("addon line qty/price mismatch".into());
    }
    Ok(())
}
