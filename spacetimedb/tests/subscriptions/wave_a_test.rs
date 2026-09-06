//! Wave A — subscription billing spine (SO→lines, AR invoice, isolation, idempotency).
use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_journal, create_account_journal, CreateAccountJournalParams,
};
use crate::accounting::journal_entries::account_move;
use crate::core::persistence::{organization_commit, organization_row_change};
use crate::crm::contacts::{contact, Contact};
use crate::inventory::product::product;
use crate::sales::pricelists::{create_pricelist, product_pricelist, CreatePricelistParams};
use crate::sales::sales_core::{
    confirm_sales_order, create_sale_order, sale_order, CreateSaleOrderLineParams,
    CreateSaleOrderParams,
};
use crate::subscriptions::reducers::{
    activate_subscription, close_subscription, create_subscription_from_sale_order,
    create_subscription_plan, generate_subscription_invoice, CloseSubscriptionParams,
    CreateSubscriptionFromSaleOrderParams, CreateSubscriptionPlanParams,
    GenerateSubscriptionInvoiceParams,
};
use crate::subscriptions::subscription_wave_e::subscription_entitlement;
use crate::subscriptions::tables::{
    subscription, subscription_billing_run, subscription_line, subscription_plan,
};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{DiscountPolicy, JournalType, MoveType, SaleState};

fn seed_journal(ctx: &ReducerContext, fixture: &OrgFixture) -> Result<u64, String> {
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let revenue_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("Harness missing revenue account")?;
    let journal_code = format!("SS{company_id}");
    create_account_journal(
        ctx,
        org_id,
        CreateAccountJournalParams {
            company_id: Some(company_id),
            name: format!("Sub Sale {company_id}"),
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
        .ok_or_else(|| "subscription sale journal not found".to_string())
}

fn seed_plan(ctx: &ReducerContext, fixture: &OrgFixture, journal_id: u64) -> Result<u64, String> {
    let org_id = fixture.organization_id;
    let code = format!("PLAN-{org_id}");
    create_subscription_plan(
        ctx,
        org_id,
        CreateSubscriptionPlanParams {
            company_id: Some(fixture.company_id),
            name: "Wave A Monthly".into(),
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
    ctx.db
        .subscription_plan()
        .iter()
        .find(|p| p.organization_id == org_id && p.code == code)
        .map(|p| p.id)
        .ok_or_else(|| "plan not found".to_string())
}

fn seed_confirmed_so(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    label: &str,
) -> Result<u64, String> {
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
            company_id: None,
            name: label.to_string(),
            currency_id: 1,
            discount_policy: DiscountPolicy::WithDiscount,
        },
    )?;
    let pricelist_id = ctx
        .db
        .product_pricelist()
        .iter()
        .find(|p| p.organization_id == org_id && p.name == label)
        .map(|p| p.id)
        .ok_or("Pricelist not found")?;

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
                tax_ids: vec![],
                name: Some("Sub line".into()),
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
            origin: Some(label.to_string()),
            client_order_ref: Some(label.to_string()),
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
        .ok_or("SO not found")?;
    confirm_sales_order(ctx, org_id, fixture.company_id, order_id)?;
    let confirmed = ctx
        .db
        .sale_order()
        .id()
        .find(&order_id)
        .ok_or("SO missing after confirm")?;
    if confirmed.state != SaleState::Sale {
        return Err("SO not in Sale state".into());
    }
    Ok(order_id)
}

fn create_draft_subscription(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    plan_id: u64,
    sale_order_id: u64,
) -> Result<u64, String> {
    let org_id = fixture.organization_id;
    create_subscription_from_sale_order(
        ctx,
        org_id,
        CreateSubscriptionFromSaleOrderParams {
            company_id: Some(fixture.company_id),
            sale_order_id,
            code: Some(format!("SUB-{sale_order_id}")),
            plan_id,
            date_start: ctx.timestamp,
            recurring_invoice_day: 1,
            is_trial: false,
            description: Some("wave a".into()),
            // Client cadence ignored — server uses plan.
            recurring_rule_type: "garbage".into(),
            recurring_interval: 99,
            payment_mode: "manual".into(),
            partner_id: 0,
            vendor_id: None,
            partner_invoice_id: 0,
            partner_shipping_id: 0,
            currency_id: 0,
            pricelist_id: 0,
            analytic_account_id: None,
            team_id: None,
            health: "spoofed".into(),
            stage_id: None,
            state: "active".into(),
            is_active: true,
            invoice_count: 9,
            recurring_total: 9999.0,
            recurring_monthly: 9999.0,
            recurring_mrr: 9999.0,
            recurring_mrr_local: 9999.0,
            percentage_mrr: 1.0,
            kpi_1month_mrr: 0.0,
            kpi_3months_mrr: 0.0,
            kpi_12months_mrr: 0.0,
            rating_last_value: 0,
            invoice_ids: vec![1, 2, 3],
            subscription_line_ids: vec![42],
            activity_ids: vec![],
            message_follower_ids: vec![],
            message_ids: vec![],
            metadata: None,
        },
    )?;
    ctx.db
        .subscription()
        .iter()
        .find(|s| s.organization_id == org_id && s.sale_order_ids.contains(&sale_order_id))
        .map(|s| s.id)
        .ok_or_else(|| "subscription not found".to_string())
}

pub fn test_subscription_create_lines_bill_idempotent(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let journal_id = seed_journal(ctx, &fixture)?;
    let plan_id = seed_plan(ctx, &fixture, journal_id)?;
    let so_id = seed_confirmed_so(ctx, &fixture, "SUB-WAVE-A-SO")?;
    let before_commits = ctx
        .db
        .organization_commit()
        .organization_commit_by_org()
        .filter(&org_id)
        .count();
    let sub_id = create_draft_subscription(ctx, &fixture, plan_id, so_id)?;

    let commits: Vec<_> = ctx
        .db
        .organization_commit()
        .organization_commit_by_org()
        .filter(&org_id)
        .collect();
    if commits.len() != before_commits + 1 {
        return Err("subscription creation must create exactly one commit".into());
    }
    let commit = commits
        .iter()
        .max_by_key(|commit| commit.sequence)
        .ok_or("subscription creation commit missing")?;
    let mut changes: Vec<_> = ctx
        .db
        .organization_row_change()
        .organization_row_change_by_commit()
        .filter(&org_id)
        .filter(|change| change.commit_sequence == commit.sequence)
        .collect();
    changes.sort_by_key(|change| change.ordinal);
    let line_id = ctx
        .db
        .subscription_line()
        .subscription_line_by_subscription()
        .filter(&sub_id)
        .next()
        .map(|line| line.id)
        .ok_or("subscription line missing after creation")?;
    if commit.operation_id != "erp.create_subscription_from_sale_order"
        || commit.row_change_count != 2
        || changes.len() != 2
        || changes[0].table_name != "subscription"
        || changes[1].table_name != "subscription_line"
        || changes[0].row_identity_json != format!(r#"{{"id":{sub_id}}}"#)
        || changes[1].row_identity_json != format!(r#"{{"id":{line_id}}}"#)
        || changes[0].ordinal != 0
        || changes[1].ordinal != 1
        || changes
            .iter()
            .any(|change| change.organization_id != org_id)
    {
        return Err("subscription commit did not preserve parent-before-child org rows".into());
    }

    let sub = ctx
        .db
        .subscription()
        .id()
        .find(&sub_id)
        .ok_or("sub missing")?;
    if sub.state != "draft" || sub.is_active {
        return Err("create must force draft/inactive".into());
    }
    if sub.recurring_rule_type != "monthly" {
        return Err(format!(
            "expected monthly cadence, got {}",
            sub.recurring_rule_type
        ));
    }
    if (sub.recurring_mrr - 100.0).abs() > 0.01 {
        return Err(format!(
            "expected MRR 100 from lines, got {}",
            sub.recurring_mrr
        ));
    }
    let line_count = ctx
        .db
        .subscription_line()
        .subscription_line_by_subscription()
        .filter(&sub_id)
        .count();
    if line_count != 1 {
        return Err(format!("expected 1 subscription line, got {line_count}"));
    }

    activate_subscription(ctx, org_id, company_id, sub_id)?;

    let income_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("missing REVENUE")?;
    let ar_id = *fixture
        .chart_account_ids
        .get(chart_keys::AR)
        .ok_or("missing AR")?;

    let invoice_params = GenerateSubscriptionInvoiceParams {
        invoice_date: ctx.timestamp,
        billing_run_key: Some(format!("test-run-{sub_id}")),
        journal_id: Some(journal_id),
        income_account_id: income_id,
        receivable_account_id: ar_id,
        tax_account_id: None,
    };
    generate_subscription_invoice(
        ctx,
        org_id,
        company_id,
        sub_id,
        GenerateSubscriptionInvoiceParams {
            invoice_date: ctx.timestamp,
            billing_run_key: Some(format!("test-run-{sub_id}")),
            journal_id: Some(journal_id),
            income_account_id: income_id,
            receivable_account_id: ar_id,
            tax_account_id: None,
        },
    )?;
    generate_subscription_invoice(ctx, org_id, company_id, sub_id, invoice_params)?;

    let billed = ctx
        .db
        .subscription()
        .id()
        .find(&sub_id)
        .ok_or("sub after bill")?;
    if billed.invoice_count != 1 {
        return Err(format!(
            "idempotent bill should keep invoice_count=1, got {}",
            billed.invoice_count
        ));
    }
    if billed.invoice_ids.len() != 1 {
        return Err("expected one invoice_ids entry".into());
    }
    let move_id = billed.invoice_ids[0];
    let mv = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("invoice move missing")?;
    if mv.move_type != MoveType::OutInvoice {
        return Err("expected OutInvoice".into());
    }
    if (mv.amount_total - 100.0).abs() > 0.01 {
        return Err(format!(
            "expected amount_total 100, got {}",
            mv.amount_total
        ));
    }
    let runs = ctx
        .db
        .subscription_billing_run()
        .iter()
        .filter(|r| r.subscription_id == sub_id)
        .count();
    if runs != 1 {
        return Err(format!("expected 1 billing run row, got {runs}"));
    }

    close_subscription(
        ctx,
        org_id,
        company_id,
        sub_id,
        CloseSubscriptionParams {
            close_reason_id: None,
            notes: Some("done".into()),
            no_charge: false,
        },
    )?;
    let closed = ctx
        .db
        .subscription()
        .id()
        .find(&sub_id)
        .ok_or("sub after close")?;
    if closed.state != "closed" || closed.is_active {
        return Err("close should set closed/inactive".into());
    }
    Ok(())
}

pub fn test_company_isolation_on_activate(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;
    let journal_id = seed_journal(ctx, &fixture_a)?;
    let plan_id = seed_plan(ctx, &fixture_a, journal_id)?;
    let so_id = seed_confirmed_so(ctx, &fixture_a, "SUB-ISO-SO")?;
    let sub_id = create_draft_subscription(ctx, &fixture_a, plan_id, so_id)?;

    let err = activate_subscription(ctx, fixture_a.organization_id, fixture_b.company_id, sub_id);
    if err.is_ok() {
        return Err("activate with wrong company_id should fail".into());
    }
    Ok(())
}

pub fn test_close_requires_no_charge_without_invoices(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let journal_id = seed_journal(ctx, &fixture)?;
    let plan_id = seed_plan(ctx, &fixture, journal_id)?;
    let so_id = seed_confirmed_so(ctx, &fixture, "SUB-CLOSE-SO")?;
    let sub_id = create_draft_subscription(ctx, &fixture, plan_id, so_id)?;
    activate_subscription(ctx, fixture.organization_id, fixture.company_id, sub_id)?;

    let blocked = close_subscription(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        sub_id,
        CloseSubscriptionParams {
            close_reason_id: None,
            notes: None,
            no_charge: false,
        },
    );
    if blocked.is_ok() {
        return Err("close without invoices should require no_charge".into());
    }

    close_subscription(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        sub_id,
        CloseSubscriptionParams {
            close_reason_id: None,
            notes: None,
            no_charge: true,
        },
    )?;

    let closed = ctx
        .db
        .subscription()
        .id()
        .find(&sub_id)
        .ok_or("subscription after close")?;
    if closed.state != "closed" || closed.is_active {
        return Err("close must persist a closed, inactive subscription".into());
    }
    let entitlements: Vec<_> = ctx
        .db
        .subscription_entitlement()
        .subscription_entitlement_by_sub()
        .filter(&sub_id)
        .collect();
    if entitlements.is_empty() || entitlements.iter().any(|row| row.status != "revoked") {
        return Err("close must atomically revoke every subscription entitlement".into());
    }
    if entitlements.iter().any(|row| row.revoked_at.is_none()) {
        return Err("revoked entitlements must persist revoked_at".into());
    }

    let retry = close_subscription(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        sub_id,
        CloseSubscriptionParams {
            close_reason_id: None,
            notes: Some("retry".into()),
            no_charge: true,
        },
    );
    if retry.is_ok() {
        return Err("retrying an already closed subscription must be rejected".into());
    }
    let persisted_entitlements: Vec<_> = ctx
        .db
        .subscription_entitlement()
        .subscription_entitlement_by_sub()
        .filter(&sub_id)
        .collect();
    if persisted_entitlements.len() != entitlements.len()
        || persisted_entitlements
            .iter()
            .any(|row| row.status != "revoked" || row.revoked_at.is_none())
    {
        return Err("rejected close retry must not change persisted entitlements".into());
    }
    Ok(())
}

fn from_so_params(
    ctx: &ReducerContext,
    plan_id: u64,
    sale_order_id: u64,
    code: &str,
) -> CreateSubscriptionFromSaleOrderParams {
    CreateSubscriptionFromSaleOrderParams {
        company_id: None,
        sale_order_id,
        code: Some(code.to_string()),
        plan_id,
        date_start: ctx.timestamp,
        recurring_invoice_day: 1,
        is_trial: false,
        description: Some("SUB-012 test".into()),
        recurring_rule_type: "monthly".into(),
        recurring_interval: 1,
        payment_mode: "manual".into(),
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
    }
}

/// SUB-012: create_subscription_from_sale_order rejects deriving a
/// subscription from a sale order whose partner contact has since been
/// soft-deleted (archived).
pub fn test_subscription_rejects_deleted_contact(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let journal_id = seed_journal(ctx, &fixture)?;
    let plan_id = seed_plan(ctx, &fixture, journal_id)?;
    let so_id = seed_confirmed_so(ctx, &fixture, "SUB-012-DELETED-CONTACT")?;

    let contact_row = ctx
        .db
        .contact()
        .id()
        .find(&fixture.partner_id)
        .ok_or("fixture contact not found")?;
    ctx.db.contact().id().update(Contact {
        deleted_at: Some(ctx.timestamp),
        ..contact_row
    });

    let params = from_so_params(ctx, plan_id, so_id, &format!("SUB-012-DEL-{so_id}"));
    let result = create_subscription_from_sale_order(ctx, org_id, params);

    match result {
        Ok(()) => Err("subscription creation with a deleted contact must be rejected".into()),
        Err(e) if e.contains("contact is inactive") => {
            if ctx
                .db
                .subscription()
                .iter()
                .any(|s| s.sale_order_ids.contains(&so_id))
            {
                return Err("no subscription should be created when the contact is deleted".into());
            }
            Ok(())
        }
        Err(e) => Err(format!("unexpected error: {e}")),
    }
}

/// SUB-012: create_subscription_from_sale_order rejects deriving a
/// subscription for a caller organization that does not own the sale
/// order's partner contact (cross-org).
pub fn test_subscription_rejects_cross_org_partner(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture_a = OrgFixture::seed_minimal(ctx)?;
    let fixture_b = OrgFixture::seed_minimal(ctx)?;

    let journal_a = seed_journal(ctx, &fixture_a)?;
    seed_plan(ctx, &fixture_a, journal_a)?;
    let so_id = seed_confirmed_so(ctx, &fixture_a, "SUB-012-CROSS-ORG")?;

    let journal_b = seed_journal(ctx, &fixture_b)?;
    let plan_b = seed_plan(ctx, &fixture_b, journal_b)?;

    let params = from_so_params(ctx, plan_b, so_id, &format!("SUB-012-XORG-{so_id}"));
    let result = create_subscription_from_sale_order(ctx, fixture_b.organization_id, params);

    match result {
        Ok(()) => Err("cross-org subscription creation must be rejected".into()),
        Err(e) if e.contains("does not belong to this organization") => {
            if ctx
                .db
                .subscription()
                .iter()
                .any(|s| s.sale_order_ids.contains(&so_id))
            {
                return Err("no subscription should be created for a cross-org partner".into());
            }
            Ok(())
        }
        Err(e) => Err(format!("unexpected error: {e}")),
    }
}
