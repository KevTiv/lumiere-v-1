//! Wave C — amendments, proration, pause/resume, renew, cancel, plan update.
use spacetimedb::{ReducerContext, Table, Timestamp};

use crate::accounting::chart_of_accounts::{
    account_journal, create_account_journal, CreateAccountJournalParams,
};
use crate::accounting::journal_entries::{account_move, post_invoice};
use crate::core::audit::audit_log;
use crate::core::persistence::{organization_commit, organization_row_change};
use crate::inventory::product::product;
use crate::sales::pricelists::{create_pricelist, product_pricelist, CreatePricelistParams};
use crate::sales::sales_core::{
    confirm_sales_order, create_sale_order, sale_order, CreateSaleOrderLineParams,
    CreateSaleOrderParams,
};
use crate::subscriptions::reducers::{
    activate_subscription, create_subscription_from_sale_order, create_subscription_plan,
    generate_subscription_invoice, CreateSubscriptionFromSaleOrderParams,
    CreateSubscriptionPlanParams, GenerateSubscriptionInvoiceParams, UpdateSubscriptionPlanParams,
};
use crate::subscriptions::subscription_wave_c::{
    activate_subscription_plan, amend_subscription, cancel_subscription,
    deactivate_subscription_plan, pause_subscription, renew_subscription, resume_subscription,
    subscription_amendment, update_subscription_plan, AmendSubscriptionParams,
    CancelSubscriptionParams, PauseSubscriptionParams, RenewSubscriptionParams,
    ResumeSubscriptionParams,
};
use crate::subscriptions::tables::{
    subscription, subscription_line, subscription_plan, SubscriptionLine,
};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{DiscountPolicy, JournalType, MoveType};

fn require_exact_renewal_capture(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription_id: u64,
    expected_date: Timestamp,
) -> Result<(), String> {
    let amendments: Vec<_> = ctx
        .db
        .subscription_amendment()
        .subscription_amendment_by_sub()
        .filter(&subscription_id)
        .filter(|row| row.amendment_type == "renew")
        .collect();
    let [amendment] = amendments.as_slice() else {
        return Err("expected one immutable renewal amendment".into());
    };
    let commits: Vec<_> = ctx
        .db
        .organization_commit()
        .organization_commit_by_organization()
        .filter(&organization_id)
        .filter(|row| row.operation_id == "erp.renew_subscription")
        .collect();
    let [commit] = commits.as_slice() else {
        return Err("renewal must emit one source commit, including after replay".into());
    };
    if commit.actor_identity != ctx.sender()
        || commit.correlation_id != format!("renewal:{subscription_id}:{}", amendment.id)
        || commit.row_change_count != 3
    {
        return Err("renewal source commit lost its actor or exact amendment identity".into());
    }
    let changes: Vec<_> = ctx
        .db
        .organization_row_change()
        .organization_row_change_by_organization()
        .filter(&organization_id)
        .filter(|row| row.commit_sequence == commit.sequence)
        .collect();
    for table in ["subscription", "subscription_amendment", "audit_log"] {
        if changes.iter().filter(|row| row.table_name == table).count() != 1 {
            return Err(format!("renewal source omitted exact {table}"));
        }
    }
    for change in &changes {
        let row: serde_json::Value = serde_json::from_str(
            change
                .row_json
                .as_deref()
                .ok_or("renewal source row is incomplete")?,
        )
        .map_err(|e| e.to_string())?;
        if row["organization_id"].as_u64() != Some(organization_id) {
            return Err("renewal source captured another organization".into());
        }
        if change.table_name == "subscription" {
            let date = serde_json::to_value(spacetimedb_sats::serde::SerdeWrapper::from_ref(
                &expected_date,
            ))
            .map_err(|e| e.to_string())?;
            if row["id"].as_u64() != Some(subscription_id)
                || row["company_id"].as_u64() != Some(company_id)
                || row["state"] != "active"
                || row["recurring_next_date"] != date
            {
                return Err(
                    "renewal source did not capture its exact resulting billing state".into(),
                );
            }
        } else if change.table_name == "subscription_amendment" {
            let metadata: serde_json::Value = serde_json::from_str(
                row["metadata"]
                    .as_str()
                    .ok_or("renewal receipt metadata missing")?,
            )
            .map_err(|e| e.to_string())?;
            if row["id"].as_u64() != Some(amendment.id)
                || row["company_id"].as_u64() != Some(company_id)
                || row["subscription_id"].as_u64() != Some(subscription_id)
                || metadata["idempotency_key"] != format!("renew-once-{subscription_id}")
                || metadata["request_fingerprint"]
                    .as_str()
                    .is_none_or(|value| value.len() != 64)
            {
                return Err(
                    "renewal durable amendment lost its complete scoped request receipt".into(),
                );
            }
        } else {
            let audit = ctx
                .db
                .audit_log()
                .id()
                .find(&row["id"].as_u64().ok_or("renewal audit identity missing")?)
                .ok_or("renewal audit missing")?;
            let exact =
                serde_json::to_value(spacetimedb_sats::serde::SerdeWrapper::from_ref(&audit))
                    .map_err(|e| e.to_string())?;
            if audit.organization_id != organization_id
                || audit.company_id != Some(company_id)
                || audit.user_identity != ctx.sender()
                || audit.record_id != subscription_id
                || audit.table_name != "subscription"
                || row != exact
            {
                return Err(
                    "renewal source audit does not match the canonical actor/company action".into(),
                );
            }
        }
    }
    Ok(())
}

fn seed_journal(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let revenue_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("revenue")?;
    let code = format!("SC{company_id}");
    create_account_journal(
        ctx,
        org_id,
        CreateAccountJournalParams {
            company_id: Some(company_id),
            name: format!("Sub C {company_id}"),
            code: code.clone(),
            type_: JournalType::Sale,
            currency_id: Some(fixture.currency_id),
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
    let plan_code = format!("PLAN-C-{label}-{org_id}");
    create_subscription_plan(
        ctx,
        org_id,
        CreateSubscriptionPlanParams {
            company_id: Some(company_id),
            name: format!("Wave C {label}"),
            code: plan_code.clone(),
            description: None,
            currency_id: fixture.currency_id,
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
    create_pricelist(
        ctx,
        org_id,
        CreatePricelistParams {
            company_id: None,
            name: format!("PL-C-{label}-{org_id}"),
            currency_id: fixture.currency_id,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;
    let pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name.contains(&format!("PL-C-{label}")))
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
            currency_id: fixture.currency_id,
            warehouse_id: fixture.warehouse_id,
            order_lines: vec![CreateSaleOrderLineParams {
                product_id: fixture.product_id,
                quantity: 1.0,
                uom_id: product.uom_id,
                price_unit: Some(price),
                discount: 0.0,
                tax_ids: vec![],
                name: Some(format!("C line {label}")),
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
    let order_id = ctx
        .db
        .sale_order()
        .iter()
        .find(|o| o.organization_id == org_id && o.client_order_ref.as_deref() == Some(label))
        .map(|o| o.id)
        .ok_or("so")?;
    confirm_sales_order(ctx, org_id, fixture.company_id, order_id)?;

    create_subscription_from_sale_order(
        ctx,
        org_id,
        CreateSubscriptionFromSaleOrderParams {
            company_id: Some(company_id),
            sale_order_id: order_id,
            code: Some(format!("SUB-C-{label}-{order_id}")),
            plan_id,
            date_start: ctx.timestamp,
            recurring_invoice_day: 1,
            is_trial: false,
            description: Some("wave c".into()),
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
    let line_id = ctx
        .db
        .subscription_line()
        .subscription_line_by_subscription()
        .filter(&sub_id)
        .map(|l| l.id)
        .next()
        .ok_or("line")?;
    Ok((sub_id, line_id))
}

pub fn test_amend_price_with_proration(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let journal_id = seed_journal(ctx, &fixture)?;
    let income = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("rev")?;
    let ar = *fixture.chart_account_ids.get(chart_keys::AR).ok_or("ar")?;
    let (sub_id, line_id) = seed_active_subscription(ctx, &fixture, journal_id, "AMEND", 100.0)?;

    let subscription = ctx
        .db
        .subscription()
        .id()
        .find(&sub_id)
        .ok_or("subscription")?;
    let before_line = ctx
        .db
        .subscription_line()
        .id()
        .find(&line_id)
        .ok_or("line before rejected amendment")?;
    let amendment_count_before = ctx
        .db
        .subscription_amendment()
        .subscription_amendment_by_sub()
        .filter(&sub_id)
        .count();
    let invalid_effective_date = Timestamp::from_micros_since_unix_epoch(
        subscription
            .date_start
            .to_micros_since_unix_epoch()
            .saturating_sub(1),
    );
    let rejected = amend_subscription(
        ctx,
        org_id,
        company_id,
        sub_id,
        AmendSubscriptionParams {
            amendment_type: "price".into(),
            line_id,
            effective_date: Some(invalid_effective_date),
            new_product_id: None,
            new_quantity: None,
            new_price_unit: Some(125.0),
            new_discount: None,
            prorate: false,
            journal_id: None,
            income_account_id: None,
            receivable_account_id: None,
            notes: Some("invalid pre-start amendment".into()),
            parent_line_id: None,
        },
    );
    if rejected.is_ok() {
        return Err("amendment before subscription start must be rejected".into());
    }
    let after_rejected_line = ctx
        .db
        .subscription_line()
        .id()
        .find(&line_id)
        .ok_or("line after rejected amendment")?;
    if after_rejected_line.price_unit != before_line.price_unit
        || after_rejected_line.price_subtotal != before_line.price_subtotal
    {
        return Err("rejected pre-start amendment must not mutate the line".into());
    }
    let amendment_count_after = ctx
        .db
        .subscription_amendment()
        .subscription_amendment_by_sub()
        .filter(&sub_id)
        .count();
    if amendment_count_after != amendment_count_before {
        return Err("rejected pre-start amendment must not persist an amendment row".into());
    }

    amend_subscription(
        ctx,
        org_id,
        company_id,
        sub_id,
        AmendSubscriptionParams {
            amendment_type: "price".into(),
            line_id,
            effective_date: None,
            new_product_id: None,
            new_quantity: None,
            new_price_unit: Some(150.0),
            new_discount: None,
            prorate: true,
            journal_id: Some(journal_id),
            income_account_id: Some(income),
            receivable_account_id: Some(ar),
            notes: Some("price up".into()),
            parent_line_id: None,
        },
    )?;

    let line = ctx
        .db
        .subscription_line()
        .id()
        .find(&line_id)
        .ok_or("line")?;
    if (line.price_unit - 150.0).abs() > 0.01 {
        return Err(format!("expected price 150, got {}", line.price_unit));
    }

    let amend = ctx
        .db
        .subscription_amendment()
        .subscription_amendment_by_sub()
        .filter(&sub_id)
        .find(|a| a.amendment_type == "price")
        .ok_or("amendment row")?;
    if amend.version != 1 {
        return Err(format!("expected version 1, got {}", amend.version));
    }
    if amend.proration_move_id.is_none() && amend.proration_amount.abs() > 0.01 {
        return Err("expected proration move when amount != 0".into());
    }
    if !amend.before_json.contains("100") || !amend.after_json.contains("150") {
        return Err("amendment audit missing before/after price".into());
    }

    let sub = ctx.db.subscription().id().find(&sub_id).ok_or("sub")?;
    if (sub.recurring_mrr - 150.0).abs() > 0.01 && sub.recurring_mrr > 0.0 {
        // MRR refresh from lines
        if (sub.recurring_total - 150.0).abs() > 0.01 {
            return Err(format!(
                "expected recurring_total≈150 after amend, got {}",
                sub.recurring_total
            ));
        }
    }

    Ok(())
}

pub fn test_pause_blocks_invoice_and_resume(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let journal_id = seed_journal(ctx, &fixture)?;
    let income = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("rev")?;
    let ar = *fixture.chart_account_ids.get(chart_keys::AR).ok_or("ar")?;
    let (sub_id, _) = seed_active_subscription(ctx, &fixture, journal_id, "PAUSE", 80.0)?;

    pause_subscription(
        ctx,
        org_id,
        company_id,
        sub_id,
        PauseSubscriptionParams {
            notes: Some("vacation".into()),
        },
    )?;
    let paused = ctx.db.subscription().id().find(&sub_id).ok_or("sub")?;
    if paused.state != "paused" || paused.is_active {
        return Err("expected paused/inactive".into());
    }

    let err = generate_subscription_invoice(
        ctx,
        org_id,
        company_id,
        sub_id,
        GenerateSubscriptionInvoiceParams {
            invoice_date: ctx.timestamp,
            billing_run_key: Some(format!("pause-block-{sub_id}")),
            journal_id: Some(journal_id),
            income_account_id: income,
            receivable_account_id: ar,
            tax_account_id: None,
        },
    );
    if err.is_ok() {
        return Err("paused subscription must not invoice".into());
    }

    resume_subscription(
        ctx,
        org_id,
        company_id,
        sub_id,
        ResumeSubscriptionParams {
            notes: None,
            recurring_next_date: None,
        },
    )?;
    let active = ctx.db.subscription().id().find(&sub_id).ok_or("sub")?;
    if active.state != "active" || !active.is_active {
        return Err("expected active after resume".into());
    }

    let types: Vec<_> = ctx
        .db
        .subscription_amendment()
        .subscription_amendment_by_sub()
        .filter(&sub_id)
        .map(|a| a.amendment_type)
        .collect();
    if !types.iter().any(|t| t == "pause") || !types.iter().any(|t| t == "resume") {
        return Err(format!("expected pause+resume amendments, got {types:?}"));
    }

    Ok(())
}

pub fn test_renew_and_cancel_with_credit(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let journal_id = seed_journal(ctx, &fixture)?;
    let income = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("rev")?;
    let ar = *fixture.chart_account_ids.get(chart_keys::AR).ok_or("ar")?;
    let (sub_id, _) = seed_active_subscription(ctx, &fixture, journal_id, "RENEW", 60.0)?;

    let before = ctx
        .db
        .subscription()
        .id()
        .find(&sub_id)
        .ok_or("sub")?
        .recurring_next_date;

    renew_subscription(
        ctx,
        org_id,
        company_id,
        sub_id,
        RenewSubscriptionParams {
            intervals: 2,
            notes: Some("extend".into()),
            idempotency_key: Some(format!("renew-once-{sub_id}")),
        },
    )?;
    let after = ctx
        .db
        .subscription()
        .id()
        .find(&sub_id)
        .ok_or("sub")?
        .recurring_next_date;
    if after
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_secs()
        <= before
            .to_duration_since_unix_epoch()
            .unwrap_or_default()
            .as_secs()
    {
        return Err("renew should push recurring_next_date forward".into());
    }

    let renewal_count = ctx
        .db
        .subscription_amendment()
        .subscription_amendment_by_sub()
        .filter(&sub_id)
        .filter(|row| row.amendment_type == "renew")
        .count();
    renew_subscription(
        ctx,
        org_id,
        company_id,
        sub_id,
        RenewSubscriptionParams {
            intervals: 2,
            notes: Some("extend".into()),
            idempotency_key: Some(format!("renew-once-{sub_id}")),
        },
    )?;
    let replayed = ctx
        .db
        .subscription()
        .id()
        .find(&sub_id)
        .ok_or("sub after replay")?;
    let replay_count = ctx
        .db
        .subscription_amendment()
        .subscription_amendment_by_sub()
        .filter(&sub_id)
        .filter(|row| row.amendment_type == "renew")
        .count();
    if replayed.recurring_next_date != after || replay_count != renewal_count || renewal_count != 1
    {
        return Err("renewal replay advanced billing or created another amendment".into());
    }
    require_exact_renewal_capture(ctx, org_id, company_id, sub_id, after)?;
    if renew_subscription(
        ctx,
        org_id,
        company_id,
        sub_id,
        RenewSubscriptionParams {
            intervals: 3,
            notes: Some("extend".into()),
            idempotency_key: Some(format!("renew-once-{sub_id}")),
        },
    )
    .is_ok()
    {
        return Err("renewal key reuse with different intervals must reject".into());
    }
    if renew_subscription(
        ctx,
        org_id,
        company_id + 1,
        sub_id,
        RenewSubscriptionParams {
            intervals: 2,
            notes: Some("extend".into()),
            idempotency_key: Some(format!("renew-once-{sub_id}")),
        },
    )
    .is_ok()
    {
        return Err("renewal replay must enforce company ownership before resolving".into());
    }
    if ctx
        .db
        .subscription()
        .id()
        .find(&sub_id)
        .ok_or("sub after rejected replay")?
        .recurring_next_date
        != after
    {
        return Err("rejected renewal replay changed the billing date".into());
    }

    generate_subscription_invoice(
        ctx,
        org_id,
        company_id,
        sub_id,
        GenerateSubscriptionInvoiceParams {
            invoice_date: ctx.timestamp,
            billing_run_key: Some(format!("renew-inv-{sub_id}")),
            journal_id: Some(journal_id),
            income_account_id: income,
            receivable_account_id: ar,
            tax_account_id: None,
        },
    )?;
    let sub = ctx.db.subscription().id().find(&sub_id).ok_or("sub")?;
    let invoice_id = *sub.invoice_ids.first().ok_or("invoice")?;
    post_invoice(ctx, org_id, invoice_id, income, income)?;

    cancel_subscription(
        ctx,
        org_id,
        company_id,
        sub_id,
        CancelSubscriptionParams {
            close_reason_id: None,
            notes: Some("churn".into()),
            create_credit_note: true,
            invoice_move_id: Some(invoice_id),
            prorate_unused: false,
            journal_id: None,
            income_account_id: None,
            receivable_account_id: None,
        },
    )?;

    let closed = ctx.db.subscription().id().find(&sub_id).ok_or("sub")?;
    if closed.state != "closed" || closed.is_active {
        return Err("expected closed after cancel".into());
    }
    let closed_next_date = closed.recurring_next_date;
    renew_subscription(
        ctx,
        org_id,
        company_id,
        sub_id,
        RenewSubscriptionParams {
            intervals: 2,
            notes: Some("extend".into()),
            idempotency_key: Some(format!("renew-once-{sub_id}")),
        },
    )?;
    let closed_after_replay = ctx
        .db
        .subscription()
        .id()
        .find(&sub_id)
        .ok_or("closed replay")?;
    if closed_after_replay.state != "closed"
        || closed_after_replay.recurring_next_date != closed_next_date
    {
        return Err(
            "resolving a completed renewal must not reopen or advance a later-closed subscription"
                .into(),
        );
    }
    require_exact_renewal_capture(ctx, org_id, company_id, sub_id, after)?;
    if !closed.metadata.contains("entitlement_revoke_pending") {
        return Err("expected entitlement revoke hook in metadata".into());
    }
    let has_refund = ctx.db.account_move().iter().any(|m| {
        m.organization_id == org_id
            && m.move_type == MoveType::OutRefund
            && m.metadata
                .as_ref()
                .map(|meta| meta.contains(&format!("\"reversed_entry_id\":{invoice_id}")))
                .unwrap_or(false)
    });
    if !has_refund {
        return Err("expected OutRefund credit note from cancel".into());
    }

    Ok(())
}

/// Omitted and empty notes, like zero and one intervals, normalize to the same immutable request.
pub fn test_renew_default_notes_receipt(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let journal_id = seed_journal(ctx, &fixture)?;
    let (sub_id, _) = seed_active_subscription(ctx, &fixture, journal_id, "RENEW-DEFAULT", 60.0)?;
    let before = ctx
        .db
        .subscription()
        .id()
        .find(&sub_id)
        .ok_or("subscription before default renewal")?
        .recurring_next_date;
    let key = format!("renew-once-{sub_id}");
    renew_subscription(
        ctx,
        org_id,
        company_id,
        sub_id,
        RenewSubscriptionParams {
            intervals: 0,
            notes: None,
            idempotency_key: Some(key.clone()),
        },
    )?;
    let after = ctx
        .db
        .subscription()
        .id()
        .find(&sub_id)
        .ok_or("subscription after default renewal")?
        .recurring_next_date;
    if after <= before {
        return Err("default renewal did not advance its billing interval".into());
    }
    let amendment = ctx
        .db
        .subscription_amendment()
        .subscription_amendment_by_sub()
        .filter(&sub_id)
        .find(|row| row.amendment_type == "renew")
        .ok_or("default renewal receipt")?;
    if !amendment.notes.is_empty() {
        return Err("omitted renewal notes must be stored as the canonical empty value".into());
    }
    renew_subscription(
        ctx,
        org_id,
        company_id,
        sub_id,
        RenewSubscriptionParams {
            intervals: 1,
            notes: Some(String::new()),
            idempotency_key: Some(key.clone()),
        },
    )?;
    if renew_subscription(
        ctx,
        org_id,
        company_id,
        sub_id,
        RenewSubscriptionParams {
            intervals: 1,
            notes: Some("changed notes".into()),
            idempotency_key: Some(key),
        },
    )
    .is_ok()
    {
        return Err("a default-note request key must reject later changed notes".into());
    }
    if ctx
        .db
        .subscription()
        .id()
        .find(&sub_id)
        .ok_or("subscription after default replay")?
        .recurring_next_date
        != after
    {
        return Err("default-note renewal replay advanced the billing date".into());
    }
    require_exact_renewal_capture(ctx, org_id, company_id, sub_id, after)
}

pub fn test_plan_update_and_deactivate(ctx: &ReducerContext) -> Result<(), String> {
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
            name: "To Update".into(),
            code: format!("PLAN-UPD-{org_id}"),
            description: None,
            currency_id: fixture.currency_id,
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
        .find(|p| p.organization_id == org_id && p.code == format!("PLAN-UPD-{org_id}"))
        .map(|p| p.id)
        .ok_or("plan")?;

    update_subscription_plan(
        ctx,
        org_id,
        company_id,
        plan_id,
        UpdateSubscriptionPlanParams {
            name: Some("Updated Plan".into()),
            description: None,
            code: None,
            currency_id: None,
            journal_id: None,
            product_id: None,
            billing_period: Some("  ANNUALLY ".into()),
            billing_period_unit: None,
            recurring_invoice_day: None,
            trial_period: None,
            trial_duration: None,
            trial_unit: None,
            auto_close_limit: Some(5),
            payment_mode: Some("automated_payment".into()),
            template_id: None,
            invoice_mail_template_id: None,
            website_url: None,
            is_published: None,
            is_default: None,
            color: None,
            image_1920_url: None,
            metadata: None,
        },
    )?;
    let plan = ctx
        .db
        .subscription_plan()
        .id()
        .find(&plan_id)
        .ok_or("plan")?;
    if plan.name != "Updated Plan" || plan.billing_period != "year" || plan.auto_close_limit != 5 {
        return Err(format!(
            "plan update failed: name={} period={} limit={}",
            plan.name, plan.billing_period, plan.auto_close_limit
        ));
    }
    if plan.payment_mode != "automated_payment" {
        return Err(format!("payment_mode={}", plan.payment_mode));
    }

    for invalid_day in [0, 29] {
        let rejected = update_subscription_plan(
            ctx,
            org_id,
            company_id,
            plan_id,
            UpdateSubscriptionPlanParams {
                name: None,
                description: None,
                code: None,
                currency_id: None,
                journal_id: None,
                product_id: None,
                billing_period: None,
                billing_period_unit: None,
                recurring_invoice_day: Some(invalid_day),
                trial_period: None,
                trial_duration: None,
                trial_unit: None,
                auto_close_limit: None,
                payment_mode: None,
                template_id: None,
                invoice_mail_template_id: None,
                website_url: None,
                is_published: None,
                is_default: None,
                color: None,
                image_1920_url: None,
                metadata: None,
            },
        );
        if rejected.is_ok() {
            return Err(format!(
                "recurring_invoice_day={invalid_day} must be rejected"
            ));
        }
        let persisted = ctx
            .db
            .subscription_plan()
            .id()
            .find(&plan_id)
            .ok_or("plan after rejected invoice day")?;
        if persisted.recurring_invoice_day != 1 {
            return Err("rejected invoice day must not mutate the plan".into());
        }
    }

    update_subscription_plan(
        ctx,
        org_id,
        company_id,
        plan_id,
        UpdateSubscriptionPlanParams {
            name: None,
            description: None,
            code: None,
            currency_id: None,
            journal_id: None,
            product_id: None,
            billing_period: None,
            billing_period_unit: None,
            recurring_invoice_day: Some(28),
            trial_period: None,
            trial_duration: None,
            trial_unit: None,
            auto_close_limit: None,
            payment_mode: None,
            template_id: None,
            invoice_mail_template_id: None,
            website_url: None,
            is_published: None,
            is_default: None,
            color: None,
            image_1920_url: None,
            metadata: None,
        },
    )?;
    let boundary = ctx
        .db
        .subscription_plan()
        .id()
        .find(&plan_id)
        .ok_or("plan after valid invoice day")?;
    if boundary.recurring_invoice_day != 28 {
        return Err("recurring_invoice_day=28 must persist".into());
    }

    deactivate_subscription_plan(ctx, org_id, company_id, plan_id)?;
    let inactive = ctx
        .db
        .subscription_plan()
        .id()
        .find(&plan_id)
        .ok_or("plan")?;
    if inactive.active || inactive.is_published {
        return Err("expected inactive unpublished plan".into());
    }
    activate_subscription_plan(ctx, org_id, company_id, plan_id)?;
    let active = ctx
        .db
        .subscription_plan()
        .id()
        .find(&plan_id)
        .ok_or("plan")?;
    if !active.active {
        return Err("expected reactivated plan".into());
    }

    Ok(())
}

fn base_amend_params(
    line_id: u64,
    notes: &str,
    parent_line_id: Option<u64>,
) -> AmendSubscriptionParams {
    AmendSubscriptionParams {
        amendment_type: "price".into(),
        line_id,
        effective_date: None,
        new_product_id: None,
        new_quantity: None,
        new_price_unit: None,
        new_discount: None,
        prorate: false,
        journal_id: None,
        income_account_id: None,
        receivable_account_id: None,
        notes: Some(notes.into()),
        parent_line_id,
    }
}

/// SUB-013: amend_subscription rejects a nonexistent parent_line_id and a
/// parent assignment that would create a cycle in the amendment parent/child
/// chain (mirrors validate_contact_parent's cycle walk in crm/contacts.rs).
pub fn test_amend_parent_line_fk_and_cycle(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let journal_id = seed_journal(ctx, &fixture)?;
    let (sub_id, line_a) = seed_active_subscription(ctx, &fixture, journal_id, "PARENT", 100.0)?;

    // Seed a second real line on the same subscription — no reducer adds
    // lines after creation, so clone the real, already-validated line row.
    let line_a_row = ctx
        .db
        .subscription_line()
        .id()
        .find(&line_a)
        .ok_or("line_a missing")?;
    let line_b_row = ctx.db.subscription_line().insert(SubscriptionLine {
        id: 0,
        name: "PARENT line B".into(),
        ..line_a_row.clone()
    });
    let line_b = line_b_row.id;

    // A nonexistent parent_line_id must be rejected.
    let missing_parent_id = line_b + 1_000_000;
    if ctx
        .db
        .subscription_line()
        .id()
        .find(&missing_parent_id)
        .is_some()
    {
        return Err("expected missing_parent_id to not correspond to any real line".into());
    }
    let missing = amend_subscription(
        ctx,
        org_id,
        company_id,
        sub_id,
        base_amend_params(line_a, "missing parent", Some(missing_parent_id)),
    );
    if missing.is_ok() {
        return Err("nonexistent parent_line_id should be rejected".into());
    }

    // Link line_a's parent to line_b — both real lines on the same subscription.
    amend_subscription(
        ctx,
        org_id,
        company_id,
        sub_id,
        base_amend_params(line_a, "link parent", Some(line_b)),
    )?;
    let updated_a = ctx
        .db
        .subscription_line()
        .id()
        .find(&line_a)
        .ok_or("line_a after link")?;
    if updated_a.line_parent_id != Some(line_b) {
        return Err("line_a.line_parent_id should be set to line_b".into());
    }

    // Now line_a -> line_b. Setting line_b's parent to line_a would close the
    // loop (line_a -> line_b -> line_a) and must be rejected.
    let cycle = amend_subscription(
        ctx,
        org_id,
        company_id,
        sub_id,
        base_amend_params(line_b, "cycle attempt", Some(line_a)),
    );
    if cycle.is_ok() {
        return Err("cycle-creating parent_line_id should be rejected".into());
    }
    let unchanged_b = ctx
        .db
        .subscription_line()
        .id()
        .find(&line_b)
        .ok_or("line_b after rejected cycle")?;
    if unchanged_b.line_parent_id.is_some() {
        return Err("rejected cycle attempt must not mutate line_b".into());
    }

    Ok(())
}
