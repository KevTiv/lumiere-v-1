//! Wave E — dunning, entitlements, payment intents, index uplift, exception flags.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_journal, create_account_journal, CreateAccountJournalParams,
};
use crate::inventory::product::product;
use crate::sales::pricelists::{create_pricelist, product_pricelist, CreatePricelistParams};
use crate::sales::sales_core::{
    confirm_sales_order, create_sale_order, sale_order, CreateSaleOrderLineParams,
    CreateSaleOrderParams,
};
use crate::subscriptions::reducers::{
    activate_subscription, create_subscription_from_sale_order, create_subscription_plan,
    CreateSubscriptionFromSaleOrderParams, CreateSubscriptionPlanParams,
};
use crate::subscriptions::subscription_wave_e::{
    advance_subscription_dunning, apply_index_linked_renewal, apply_subscription_payment_intent,
    create_subscription_payment_intent, fail_subscription_payment_intent,
    record_subscription_payment_failure, refresh_subscription_exception_flags,
    subscription_collection, subscription_entitlement, subscription_payment_intent,
    subscription_price_index, upsert_subscription_price_index, AdvanceSubscriptionDunningParams,
    ApplyIndexLinkedRenewalParams, CreateSubscriptionPaymentIntentParams,
    FailSubscriptionPaymentIntentParams, RecordSubscriptionPaymentFailureParams,
    UpsertSubscriptionPriceIndexParams,
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
    let code = format!("SE{company_id}");
    create_account_journal(
        ctx,
        org_id,
        CreateAccountJournalParams {
            company_id: Some(company_id),
            name: format!("Sub E {company_id}"),
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
    auto_close_limit: u32,
) -> Result<u64, String> {
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let plan_code = format!("PLAN-E-{label}-{org_id}");
    create_subscription_plan(
        ctx,
        org_id,
        CreateSubscriptionPlanParams {
            company_id: Some(company_id),
            name: format!("Wave E {label}"),
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
            auto_close_limit,
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
    let pl_name = format!("PL-E-{label}-{org_id}");
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
                price_unit: Some(100.0),
                discount: 0.0,
                tax_ids: vec![],
                name: Some(format!("E {label}")),
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
    confirm_sales_order(ctx, org_id, so_id)?;

    create_subscription_from_sale_order(
        ctx,
        org_id,
        CreateSubscriptionFromSaleOrderParams {
            company_id: Some(company_id),
            sale_order_id: so_id,
            code: Some(format!("SUB-E-{label}-{so_id}")),
            plan_id,
            date_start: ctx.timestamp,
            recurring_invoice_day: 1,
            is_trial: false,
            description: Some("wave e".into()),
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
    Ok(sub_id)
}

/// Activate grants entitlement; dunning suspends then auto-closes at limit.
pub fn test_entitlement_and_dunning_autoclose(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let journal_id = seed_journal(ctx, &fixture)?;
    let sub_id = seed_active_subscription(ctx, &fixture, journal_id, "dun", 2)?;

    let ent = ctx
        .db
        .subscription_entitlement()
        .iter()
        .find(|e| e.subscription_id == sub_id && e.status == "active")
        .ok_or("entitlement on activate")?;
    if ent.feature_code != "subscription.access" {
        return Err(format!("unexpected feature {}", ent.feature_code));
    }

    record_subscription_payment_failure(
        ctx,
        org_id,
        company_id,
        sub_id,
        RecordSubscriptionPaymentFailureParams {
            invoice_move_id: None,
            reason: Some("card declined".into()),
            past_due_days: Some(7),
        },
    )?;
    advance_subscription_dunning(
        ctx,
        org_id,
        company_id,
        sub_id,
        AdvanceSubscriptionDunningParams {
            past_due_days: Some(7),
            suspend_after_days: Some(1),
        },
    )?;

    let sub = ctx.db.subscription().id().find(&sub_id).ok_or("sub")?;
    if sub.state != "paused" {
        return Err(format!("expected paused after suspend, got {}", sub.state));
    }
    let suspended = ctx
        .db
        .subscription_entitlement()
        .iter()
        .any(|e| e.subscription_id == sub_id && e.status == "suspended");
    if !suspended {
        return Err("entitlement should be suspended".into());
    }

    record_subscription_payment_failure(
        ctx,
        org_id,
        company_id,
        sub_id,
        RecordSubscriptionPaymentFailureParams {
            invoice_move_id: None,
            reason: Some("second fail".into()),
            past_due_days: Some(20),
        },
    )?;
    advance_subscription_dunning(
        ctx,
        org_id,
        company_id,
        sub_id,
        AdvanceSubscriptionDunningParams {
            past_due_days: Some(20),
            suspend_after_days: Some(1),
        },
    )?;

    let closed = ctx.db.subscription().id().find(&sub_id).ok_or("sub2")?;
    if closed.state != "closed" {
        return Err(format!("expected auto-close, got {}", closed.state));
    }
    let revoked = ctx
        .db
        .subscription_entitlement()
        .iter()
        .any(|e| e.subscription_id == sub_id && e.status == "revoked");
    if !revoked {
        return Err("entitlement should be revoked on auto-close".into());
    }
    Ok(())
}

/// Payment intent idempotency + fail→dunning + apply clears collection.
pub fn test_payment_intent_and_rails(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let journal_id = seed_journal(ctx, &fixture)?;
    let sub_id = seed_active_subscription(ctx, &fixture, journal_id, "rail", 0)?;

    let params = CreateSubscriptionPaymentIntentParams {
        intent_type: "pix".into(),
        idempotency_key: format!("pix-{sub_id}-1"),
        invoice_move_id: None,
        payment_token_id: None,
        amount: 50.0,
        currency_id: 1,
        fallback_draft_invoice: true,
        metadata: None,
    };
    create_subscription_payment_intent(ctx, org_id, company_id, sub_id, params.clone())?;
    create_subscription_payment_intent(ctx, org_id, company_id, sub_id, params)?;
    let count = ctx
        .db
        .subscription_payment_intent()
        .iter()
        .filter(|i| i.subscription_id == sub_id)
        .count();
    if count != 1 {
        return Err(format!("expected 1 intent, got {count}"));
    }
    let intent_id = ctx
        .db
        .subscription_payment_intent()
        .iter()
        .find(|i| i.subscription_id == sub_id)
        .map(|i| i.id)
        .ok_or("intent")?;

    fail_subscription_payment_intent(
        ctx,
        org_id,
        company_id,
        intent_id,
        FailSubscriptionPaymentIntentParams {
            last_error: "timeout".into(),
            record_dunning_failure: true,
        },
    )?;
    let coll = ctx
        .db
        .subscription_collection()
        .iter()
        .find(|c| c.subscription_id == sub_id)
        .ok_or("collection")?;
    if coll.failed_payment_count < 1 {
        return Err("dunning failure not recorded".into());
    }

    // New intent to succeed
    create_subscription_payment_intent(
        ctx,
        org_id,
        company_id,
        sub_id,
        CreateSubscriptionPaymentIntentParams {
            intent_type: "eft".into(),
            idempotency_key: format!("eft-{sub_id}-ok"),
            invoice_move_id: None,
            payment_token_id: None,
            amount: 50.0,
            currency_id: 1,
            fallback_draft_invoice: false,
            metadata: None,
        },
    )?;
    let ok_id = ctx
        .db
        .subscription_payment_intent()
        .iter()
        .find(|i| i.subscription_id == sub_id && i.intent_type == "eft")
        .map(|i| i.id)
        .ok_or("eft intent")?;
    apply_subscription_payment_intent(ctx, org_id, company_id, ok_id)?;
    let cleared = ctx
        .db
        .subscription_collection()
        .iter()
        .find(|c| c.subscription_id == sub_id)
        .ok_or("collection2")?;
    if cleared.failed_payment_count != 0 || cleared.past_due {
        return Err("collection should clear after apply".into());
    }

    Ok(())
}

/// Index-linked renewal uplifts line prices.
pub fn test_index_linked_renewal(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let journal_id = seed_journal(ctx, &fixture)?;
    let sub_id = seed_active_subscription(ctx, &fixture, journal_id, "idx", 0)?;

    let before = ctx
        .db
        .subscription_line()
        .iter()
        .find(|l| l.subscription_id == sub_id)
        .map(|l| l.price_unit)
        .ok_or("line")?;

    upsert_subscription_price_index(
        ctx,
        org_id,
        company_id,
        UpsertSubscriptionPriceIndexParams {
            index_code: "IPCA".into(),
            country_code: "br".into(),
            period_key: "2026-07".into(),
            factor: 1.1,
            active: true,
            metadata: None,
        },
    )?;
    let idx_count = ctx
        .db
        .subscription_price_index()
        .iter()
        .filter(|i| i.organization_id == org_id)
        .count();
    if idx_count != 1 {
        return Err(format!("expected 1 index row, got {idx_count}"));
    }

    apply_index_linked_renewal(
        ctx,
        org_id,
        company_id,
        sub_id,
        ApplyIndexLinkedRenewalParams {
            index_code: "IPCA".into(),
            period_key: "2026-07".into(),
            extend_term: true,
        },
    )?;

    let after = ctx
        .db
        .subscription_line()
        .iter()
        .find(|l| l.subscription_id == sub_id)
        .map(|l| l.price_unit)
        .ok_or("line2")?;
    if (after - before * 1.1).abs() > 0.01 {
        return Err(format!("expected price {before}*1.1, got {after}"));
    }

    refresh_subscription_exception_flags(ctx, org_id, company_id, sub_id)?;
    let coll = ctx
        .db
        .subscription_collection()
        .iter()
        .find(|c| c.subscription_id == sub_id)
        .ok_or("flags")?;
    let _ = coll.due_to_bill;
    Ok(())
}
