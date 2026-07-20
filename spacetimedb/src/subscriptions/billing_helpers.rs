//! Shared helpers for subscription billing (cadence, MRR, AR invoice, tax, FX, rev-rec, payment).

use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::accounting::fiscal_periods::ensure_accounting_period_open_for_date;
use crate::accounting::journal_entries::{
    account_move, account_move_line, add_account_move_line, create_account_move,
    insert_draft_account_move_line, post_invoice, reconcile_payment_with_invoice, AccountMove,
    AccountMoveLine, AddAccountMoveLineParams, CreateAccountMoveParams,
};
use crate::accounting::payments::{
    account_payment, create_payment, register_payment_on_invoice, CreatePaymentParams,
};
use crate::accounting::tax_management::{account_tax, account_tax_group};
use crate::core::organization::company;
use crate::core::reference::{currency_rate, legacy_currency_code_for_id};
use crate::crm::contacts::contact;
use crate::helpers::calculate_tax;
use crate::inventory::product::product;
use crate::subscriptions::tables::{
    deferred_revenue_line, deferred_revenue_schedule, revenue_recognition_rule, subscription,
    subscription_billing_run, subscription_line, subscription_plan, DeferredRevenueLine,
    DeferredRevenueSchedule, RevenueRecognitionRule, Subscription, SubscriptionBillingRun,
    SubscriptionLine,
};
use crate::types::{AccountMoveState, MoveType, PartnerType, PaymentState, PaymentType};
use crate::workflow::action_registry::{
    execute_guarded_action, snapshot_guarded_action, ExecuteGuardedActionParams,
    GuardedActionInput, GuardedActionKey, GUARDED_ACTION_SCHEMA_VERSION,
};

/// Canonical calculator cadence: `daily` | `weekly` | `monthly` | `yearly`.
pub fn normalize_rule_type(raw: &str) -> Result<String, String> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "day" | "daily" | "d" => Ok("daily".to_string()),
        "week" | "weekly" | "w" => Ok("weekly".to_string()),
        "month" | "monthly" | "m" => Ok("monthly".to_string()),
        "year" | "yearly" | "annual" | "annually" | "y" => Ok("yearly".to_string()),
        other => Err(format!(
            "Invalid billing period '{}'. Use: day|week|month|year (or daily|weekly|monthly|yearly)",
            other
        )),
    }
}

/// Plan catalogue short form: `day` | `week` | `month` | `year`.
pub fn normalize_plan_billing_period(raw: &str) -> Result<String, String> {
    Ok(match normalize_rule_type(raw)?.as_str() {
        "daily" => "day".to_string(),
        "weekly" => "week".to_string(),
        "monthly" => "month".to_string(),
        "yearly" => "year".to_string(),
        other => other.to_string(),
    })
}

pub fn normalize_payment_mode(raw: &str) -> Result<String, String> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "draft_invoice" | "manual" => Ok("draft_invoice".to_string()),
        "automated_payment" | "automatic" => Ok("automated_payment".to_string()),
        other => Err(format!(
            "Invalid payment mode '{}'. Use: draft_invoice|automated_payment (or manual|automatic)",
            other
        )),
    }
}

pub fn calculate_next_date(
    from_date: Timestamp,
    rule_type: &str,
    interval: u32,
) -> Result<Timestamp, String> {
    let interval = interval.max(1) as u64;
    let canonical = normalize_rule_type(rule_type)?;
    let duration_secs = match canonical.as_str() {
        "daily" => interval * 24 * 60 * 60,
        "weekly" => interval * 7 * 24 * 60 * 60,
        // 30-day months remain an approximation until calendar period rows land.
        "monthly" => interval * 30 * 24 * 60 * 60,
        "yearly" => interval * 365 * 24 * 60 * 60,
        other => return Err(format!("Unknown rule type: {}", other)),
    };

    let current_secs = from_date
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_secs();

    Ok(Timestamp::from_duration_since_unix_epoch(
        std::time::Duration::from_secs(current_secs.saturating_add(duration_secs)),
    ))
}

/// Convert a period total into approximate MRR for KPI fields.
pub fn mrr_from_period_total(period_total: f64, rule_type: &str) -> f64 {
    match normalize_rule_type(rule_type)
        .unwrap_or_else(|_| "monthly".to_string())
        .as_str()
    {
        "daily" => period_total * 30.0,
        "weekly" => period_total * (52.0 / 12.0),
        "yearly" => period_total / 12.0,
        _ => period_total,
    }
}

pub fn default_billing_run_key(subscription_id: u64, invoice_date: Timestamp) -> String {
    let secs = invoice_date
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_secs();
    format!("sub:{}:period:{}", subscription_id, secs)
}

pub(crate) fn blank_line(account_id: u64, name: String) -> AddAccountMoveLineParams {
    AddAccountMoveLineParams {
        account_id,
        name,
        debit: 0.0,
        credit: 0.0,
        sequence: 0,
        quantity: 1.0,
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
    }
}

/// Resolve FX rate subscription currency → company currency at invoice date (1.0 if same).
pub fn resolve_subscription_fx_rate(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    currency_id: u64,
    company_currency_id: u64,
    as_of: Timestamp,
) -> Result<f64, String> {
    if currency_id == company_currency_id {
        return Ok(1.0);
    }
    let from = legacy_currency_code_for_id(currency_id).to_string();
    let to = legacy_currency_code_for_id(company_currency_id).to_string();
    if from.eq_ignore_ascii_case(&to) {
        return Ok(1.0);
    }

    let mut best_rate: Option<(Timestamp, f64)> = None;
    for rate in ctx
        .db
        .currency_rate()
        .rate_by_org()
        .filter(&organization_id)
    {
        if !rate.from_currency.eq_ignore_ascii_case(&from)
            || !rate.to_currency.eq_ignore_ascii_case(&to)
        {
            continue;
        }
        if let Some(cid) = rate.company_id {
            if cid != company_id {
                continue;
            }
        }
        if rate.date > as_of {
            continue;
        }
        match best_rate {
            Some((prev_date, _)) if rate.date <= prev_date => {}
            _ => best_rate = Some((rate.date, rate.rate)),
        }
    }

    let rate = best_rate.map(|(_, r)| r).ok_or_else(|| {
        format!(
            "No exchange rate for {} → {} (company {}); seed currency_rate before multi-currency billing",
            from, to, company_id
        )
    })?;
    if rate <= 0.0 {
        return Err("Exchange rate must be positive".to_string());
    }
    Ok(rate)
}

fn resolve_tax_payable_account(
    ctx: &ReducerContext,
    tax_ids: &[u64],
    override_account_id: Option<u64>,
) -> Option<u64> {
    if let Some(id) = override_account_id.filter(|id| *id > 0) {
        return Some(id);
    }
    for &tax_id in tax_ids {
        let Some(tax) = ctx.db.account_tax().id().find(&tax_id) else {
            continue;
        };
        let Some(group_id) = tax.tax_group_id else {
            continue;
        };
        if let Some(group) = ctx.db.account_tax_group().id().find(&group_id) {
            if let Some(payable) = group.tax_payable_account_id.filter(|id| *id > 0) {
                return Some(payable);
            }
        }
    }
    None
}

fn find_recognition_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    product_id: u64,
) -> Option<RevenueRecognitionRule> {
    let categ_id = ctx.db.product().id().find(&product_id).map(|p| p.categ_id);

    let mut rules: Vec<RevenueRecognitionRule> = ctx
        .db
        .revenue_recognition_rule()
        .iter()
        .filter(|r| {
            r.organization_id == organization_id && r.company_id == company_id && r.is_active
        })
        .collect();
    rules.sort_by(|a, b| b.priority.cmp(&a.priority));

    for rule in rules {
        if !rule.product_ids.is_empty() {
            if rule.product_ids.contains(&product_id) {
                return Some(rule);
            }
            continue;
        }
        if let Some(cid) = categ_id {
            if rule.product_category_ids.contains(&cid) {
                return Some(rule);
            }
        }
    }
    None
}

fn insert_deferred_schedule_lines(
    ctx: &ReducerContext,
    organization_id: u64,
    schedule: &DeferredRevenueSchedule,
) -> Result<(), String> {
    let (period_count, period_secs) = match schedule.recognition_period.as_str() {
        "month" => (12u32, 30 * 24 * 60 * 60u64),
        "quarter" => (4, 90 * 24 * 60 * 60),
        "year" => (1, 365 * 24 * 60 * 60),
        other => {
            return Err(format!(
                "Invalid recognition period '{}' on auto schedule",
                other
            ))
        }
    };
    let amount_per_period = schedule.total_amount / period_count as f64;
    let start_secs = schedule
        .start_date
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_secs();

    for i in 0..period_count {
        ctx.db.deferred_revenue_line().insert(DeferredRevenueLine {
            id: 0,
            organization_id,
            schedule_id: schedule.id,
            sequence: i + 1,
            recognition_date: Timestamp::from_duration_since_unix_epoch(
                std::time::Duration::from_secs(start_secs + i as u64 * period_secs),
            ),
            amount: amount_per_period,
            recognized: false,
            move_id: None,
            move_line_id: None,
            journal_id: schedule.journal_id,
            account_id: schedule.account_id,
            deferred_account_id: schedule.deferred_account_id,
            company_id: schedule.company_id,
            currency_id: schedule.currency_id,
            notes: schedule.notes.clone(),
            created_at: ctx.timestamp,
            metadata: schedule.metadata.clone(),
        });
    }
    Ok(())
}

/// Auto-create deferred schedules for invoice lines that match recognition rules.
pub fn auto_create_deferred_schedules_for_invoice(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription: &Subscription,
    invoice_move_id: u64,
    journal_id: u64,
    period_start: Timestamp,
    period_end: Timestamp,
    created_by: Identity,
) -> Result<Vec<u64>, String> {
    let mut created_ids = Vec::new();
    let income_lines: Vec<AccountMoveLine> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&invoice_move_id)
        .filter(|l| l.credit > 0.0 && l.product_id.is_some())
        .collect();

    for line in income_lines {
        let Some(product_id) = line.product_id else {
            continue;
        };
        let Some(rule) = find_recognition_rule(ctx, organization_id, company_id, product_id) else {
            continue;
        };
        if rule.recognition_method == "one_time" {
            continue;
        }

        let amount = line.credit;
        if amount <= 0.0 {
            continue;
        }

        let schedule = ctx
            .db
            .deferred_revenue_schedule()
            .insert(DeferredRevenueSchedule {
                id: 0,
                organization_id,
                description: format!(
                    "SUB{} / move {} / {}",
                    subscription.id, invoice_move_id, line.name
                ),
                journal_id,
                // Schedule convention (see recognize_deferred_revenue): account_id = liability BS,
                // deferred_account_id = income when recognized.
                account_id: rule.deferred_account_id,
                deferred_account_id: rule.recognition_account_id,
                company_id,
                currency_id: subscription.currency_id,
                total_amount: amount,
                recognized_amount: 0.0,
                deferred_amount: amount,
                start_date: period_start,
                end_date: period_end,
                recognition_method: rule.recognition_method.clone(),
                recognition_period: rule.recognition_period.clone(),
                state: "draft".to_string(),
                origin_move_id: Some(invoice_move_id),
                origin_move_line_id: Some(line.id),
                line_ids: vec![],
                journal_entry_ids: vec![],
                notes: format!("Auto from recognition rule {}", rule.id),
                created_at: ctx.timestamp,
                created_by,
                metadata: serde_json::json!({
                    "subscription_id": subscription.id,
                    "rule_id": rule.id,
                    "billing_auto": true,
                })
                .to_string(),
            });

        insert_deferred_schedule_lines(ctx, organization_id, &schedule)?;
        created_ids.push(schedule.id);
    }

    Ok(created_ids)
}

/// Recompute MRR KPIs from lines + invoice untaxed totals + deferred remaining.
pub fn refresh_subscription_kpis(ctx: &ReducerContext, subscription: Subscription, fx_rate: f64) {
    let lines: Vec<SubscriptionLine> = ctx
        .db
        .subscription_line()
        .subscription_line_by_subscription()
        .filter(&subscription.id)
        .filter(|l| l.organization_id == subscription.organization_id)
        .collect();

    let period_total: f64 = lines
        .iter()
        .map(|l| {
            let qty = if l.product_uom_qty > 0.0 {
                l.product_uom_qty
            } else {
                1.0
            };
            qty * l.price_unit * (1.0 - l.discount / 100.0)
        })
        .sum();
    let mrr = mrr_from_period_total(period_total, &subscription.recurring_rule_type);
    let mrr_local = mrr * fx_rate;

    let invoiced_untaxed: f64 = subscription
        .invoice_ids
        .iter()
        .filter_map(|id| ctx.db.account_move().id().find(id))
        .filter(|m| {
            m.organization_id == subscription.organization_id
                && matches!(m.move_type, MoveType::OutInvoice)
        })
        .map(|m| m.amount_untaxed)
        .sum();

    let deferred_remaining: f64 = ctx
        .db
        .deferred_revenue_schedule()
        .iter()
        .filter(|s| {
            s.organization_id == subscription.organization_id
                && s.company_id == subscription.company_id
                && s.origin_move_id
                    .map(|mid| subscription.invoice_ids.contains(&mid))
                    .unwrap_or(false)
        })
        .map(|s| s.deferred_amount)
        .sum();

    ctx.db.subscription().id().update(Subscription {
        recurring_total: period_total,
        recurring_monthly: mrr,
        recurring_mrr: mrr,
        recurring_mrr_local: mrr_local,
        kpi_1month_mrr: mrr_local,
        kpi_3months_mrr: mrr_local * 3.0,
        kpi_12months_mrr: mrr_local * 12.0,
        metadata: {
            let mut meta = serde_json::Map::new();
            if let Ok(existing) = serde_json::from_str::<serde_json::Value>(&subscription.metadata)
            {
                if let Some(obj) = existing.as_object() {
                    meta = obj.clone();
                }
            }
            meta.insert(
                "invoiced_untaxed_total".into(),
                serde_json::json!(invoiced_untaxed),
            );
            meta.insert(
                "deferred_remaining".into(),
                serde_json::json!(deferred_remaining),
            );
            meta.insert("fx_rate_last".into(), serde_json::json!(fx_rate));
            serde_json::Value::Object(meta).to_string()
        },
        updated_at: ctx.timestamp,
        ..subscription
    });
}

pub struct SubscriptionInvoiceResult {
    pub move_id: u64,
    pub amount_total: f64,
    pub amount_tax: f64,
    pub fx_rate: f64,
    pub already_existed: bool,
    pub period_end: Timestamp,
    pub deferred_schedule_ids: Vec<u64>,
}

/// Create a draft AR `OutInvoice` for an active subscription (idempotent by `billing_run_key`).
pub fn create_subscription_ar_invoice(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription: &Subscription,
    invoice_date: Timestamp,
    billing_run_key: &str,
    journal_id: u64,
    income_account_id: u64,
    receivable_account_id: u64,
    tax_account_id: Option<u64>,
    created_by: Identity,
) -> Result<SubscriptionInvoiceResult, String> {
    if subscription.company_id != company_id {
        return Err("Subscription does not belong to this company".to_string());
    }
    if subscription.organization_id != organization_id {
        return Err("Subscription does not belong to this organization".to_string());
    }
    if subscription.state == "paused" {
        return Err("Paused subscriptions cannot be invoiced; resume first".to_string());
    }
    if subscription.state != "active" {
        return Err("Subscription must be active to generate invoice".to_string());
    }

    let existing = ctx
        .db
        .subscription_billing_run()
        .iter()
        .find(|r| r.organization_id == organization_id && r.billing_run_key == billing_run_key);
    if let Some(run) = existing {
        let period_end = calculate_next_date(
            invoice_date,
            &subscription.recurring_rule_type,
            subscription.recurring_interval,
        )?;
        let fx_rate = serde_json::from_str::<serde_json::Value>(&run.metadata)
            .ok()
            .and_then(|v| v.get("fx_rate").and_then(|r| r.as_f64()))
            .unwrap_or(1.0);
        return Ok(SubscriptionInvoiceResult {
            move_id: run.invoice_move_id,
            amount_total: 0.0,
            amount_tax: 0.0,
            fx_rate,
            already_existed: true,
            period_end,
            deferred_schedule_ids: vec![],
        });
    }

    let lines: Vec<SubscriptionLine> = ctx
        .db
        .subscription_line()
        .subscription_line_by_subscription()
        .filter(&subscription.id)
        .filter(|l| l.organization_id == organization_id && l.line_is_recurring)
        .collect();
    // Wave D: allow empty recurring lines when caller will append usage charges.
    // Callers that need a hard fail should check lines/unbilled before invoking.

    ensure_accounting_period_open_for_date(ctx, company_id, invoice_date)?;

    let _plan = ctx
        .db
        .subscription_plan()
        .id()
        .find(&subscription.plan_id)
        .ok_or("Subscription plan not found")?;

    let company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("Company not found")?;

    let fx_rate = resolve_subscription_fx_rate(
        ctx,
        organization_id,
        company_id,
        subscription.currency_id,
        company.currency_id,
        invoice_date,
    )?;

    let partner_display_name = ctx
        .db
        .contact()
        .id()
        .find(&subscription.partner_invoice_id)
        .map(|c| c.display_name.clone());

    let period_end = calculate_next_date(
        invoice_date,
        &subscription.recurring_rule_type,
        subscription.recurring_interval,
    )?;

    let move_record = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: String::new(),
        ref_: Some(subscription.code.clone()),
        move_type: MoveType::OutInvoice,
        auto_post: false,
        state: AccountMoveState::Draft,
        date: invoice_date,
        invoice_date: Some(invoice_date),
        invoice_date_due: None,
        invoice_payment_term_id: None,
        invoice_origin: Some(format!("SUB{}", subscription.id)),
        invoice_partner_display_name: partner_display_name.clone(),
        invoice_cash_rounding_id: None,
        payment_reference: None,
        partner_shipping_id: Some(subscription.partner_shipping_id),
        sale_order_id: subscription.sale_order_ids.first().copied(),
        partner_id: Some(subscription.partner_invoice_id),
        commercial_partner_id: Some(subscription.partner_invoice_id),
        partner_bank_id: None,
        fiscal_position_id: None,
        invoice_user_id: Some(created_by),
        invoice_incoterm_id: None,
        incoterm_location: None,
        campaign_id: None,
        source_id: None,
        medium_id: None,
        company_id,
        journal_id,
        currency_id: subscription.currency_id,
        company_currency_id: company.currency_id,
        amount_untaxed: 0.0,
        amount_tax: 0.0,
        amount_total: 0.0,
        amount_residual: 0.0,
        amount_untaxed_signed: 0.0,
        amount_tax_signed: 0.0,
        amount_total_signed: 0.0,
        amount_total_in_currency_signed: 0.0,
        amount_residual_signed: 0.0,
        to_check: false,
        posted_before: false,
        is_storno: false,
        is_move_sent: false,
        secure_sequence_number: None,
        invoice_has_outstanding: false,
        payment_state: PaymentState::NotPaid,
        restrict_mode_hash_table: false,
        create_uid: Some(created_by),
        create_date: Some(ctx.timestamp),
        write_uid: Some(created_by),
        write_date: Some(ctx.timestamp),
        metadata: Some(
            serde_json::json!({
                "subscription_id": subscription.id,
                "billing_run_key": billing_run_key,
                "fx_rate": fx_rate,
            })
            .to_string(),
        ),
    });

    let mut amount_untaxed = 0.0f64;
    let mut amount_tax = 0.0f64;
    let mut all_tax_ids: Vec<u64> = Vec::new();

    for (seq, line) in lines.iter().enumerate() {
        let qty = if line.product_uom_qty > 0.0 {
            line.product_uom_qty
        } else {
            1.0
        };
        let subtotal = qty * line.price_unit * (1.0 - line.discount / 100.0);
        let line_tax = calculate_tax(ctx, &line.tax_ids, subtotal);
        for tid in &line.tax_ids {
            if !all_tax_ids.contains(tid) {
                all_tax_ids.push(*tid);
            }
        }

        let mut income = blank_line(income_account_id, line.name.clone());
        income.credit = subtotal;
        income.debit = 0.0;
        income.sequence = seq as u32;
        income.quantity = qty;
        income.price_unit = line.price_unit;
        income.discount = line.discount;
        income.tax_ids = line.tax_ids.clone();
        income.partner_id = Some(subscription.partner_invoice_id);
        income.product_id = Some(line.product_id);
        income.product_uom_id = Some(line.product_uom);
        income.analytic_account_id = line
            .analytic_account_id
            .or(subscription.analytic_account_id);
        income.analytic_tag_ids = line.analytic_tag_ids.clone();
        insert_draft_account_move_line(ctx, &move_record, income)?;
        amount_untaxed += subtotal;
        amount_tax += line_tax;
    }

    let mut seq = lines.len() as u32;
    if amount_tax > 0.0 {
        let tax_acct = resolve_tax_payable_account(ctx, &all_tax_ids, tax_account_id).ok_or(
            "Tax computed on subscription lines but no tax payable account; pass tax_account_id or configure tax group tax_payable_account_id",
        )?;
        let mut tax_line = blank_line(tax_acct, "Tax".to_string());
        tax_line.credit = amount_tax;
        tax_line.debit = 0.0;
        tax_line.sequence = seq;
        tax_line.quantity = 1.0;
        tax_line.price_unit = amount_tax;
        tax_line.tax_ids = all_tax_ids.clone();
        tax_line.partner_id = Some(subscription.partner_invoice_id);
        insert_draft_account_move_line(ctx, &move_record, tax_line)?;
        seq += 1;
    }

    let amount_total = amount_untaxed + amount_tax;

    let mut receivable = blank_line(
        receivable_account_id,
        partner_display_name
            .clone()
            .unwrap_or_else(|| "Accounts Receivable".to_string()),
    );
    receivable.debit = amount_total;
    receivable.credit = 0.0;
    receivable.sequence = seq;
    receivable.quantity = 1.0;
    receivable.price_unit = amount_total;
    receivable.partner_id = Some(subscription.partner_invoice_id);
    insert_draft_account_move_line(ctx, &move_record, receivable)?;

    // Normalize AR line type so reconcile_payment_with_invoice can match.
    if let Some(ar_line) = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_record.id)
        .find(|l| l.account_id == receivable_account_id)
    {
        ctx.db.account_move_line().id().update(AccountMoveLine {
            account_internal_type: Some("receivable".to_string()),
            ..ar_line
        });
    }

    ctx.db.account_move().id().update(AccountMove {
        amount_untaxed,
        amount_tax,
        amount_total,
        amount_residual: amount_total,
        amount_untaxed_signed: amount_untaxed,
        amount_tax_signed: amount_tax,
        amount_total_signed: amount_total,
        amount_total_in_currency_signed: amount_total,
        amount_residual_signed: amount_total,
        write_uid: Some(created_by),
        write_date: Some(ctx.timestamp),
        ..move_record.clone()
    });

    ctx.db
        .subscription_billing_run()
        .insert(SubscriptionBillingRun {
            id: 0,
            organization_id,
            company_id,
            subscription_id: subscription.id,
            billing_run_key: billing_run_key.to_string(),
            invoice_move_id: move_record.id,
            invoice_date,
            period_start: invoice_date,
            period_end,
            created_at: ctx.timestamp,
            created_by,
            metadata: serde_json::json!({
                "fx_rate": fx_rate,
                "amount_untaxed": amount_untaxed,
                "amount_tax": amount_tax,
                "amount_total": amount_total,
                "amount_total_company": amount_total * fx_rate,
            })
            .to_string(),
        });

    let deferred_schedule_ids = auto_create_deferred_schedules_for_invoice(
        ctx,
        organization_id,
        company_id,
        subscription,
        move_record.id,
        journal_id,
        invoice_date,
        period_end,
        created_by,
    )?;

    Ok(SubscriptionInvoiceResult {
        move_id: move_record.id,
        amount_total,
        amount_tax,
        fx_rate,
        already_existed: false,
        period_end,
        deferred_schedule_ids,
    })
}

/// Apply invoice counters / next date / invoice_ids onto the subscription header + KPIs.
pub fn apply_billing_run_to_subscription(
    ctx: &ReducerContext,
    subscription: Subscription,
    move_id: u64,
    period_end: Timestamp,
    already_existed: bool,
    fx_rate: f64,
) {
    if already_existed {
        refresh_subscription_kpis(ctx, subscription, fx_rate);
        return;
    }
    let mut invoice_ids = subscription.invoice_ids.clone();
    if !invoice_ids.contains(&move_id) {
        invoice_ids.push(move_id);
    }
    let new_count = subscription.invoice_count.saturating_add(1);
    let updated = Subscription {
        invoice_count: new_count,
        invoice_ids,
        recurring_next_date: period_end,
        updated_at: ctx.timestamp,
        ..subscription
    };
    ctx.db.subscription().id().update(updated.clone());
    refresh_subscription_kpis(ctx, updated, fx_rate);
}

pub struct SubscriptionPaymentResult {
    pub payment_id: u64,
    pub payment_move_id: u64,
    pub invoice_move_id: u64,
    pub amount: f64,
}

/// Post a subscription invoice (if draft) and apply a customer payment that clears AR residual.
pub fn apply_subscription_invoice_payment(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    subscription: &Subscription,
    invoice_move_id: u64,
    payment_journal_id: u64,
    bank_account_id: u64,
    receivable_account_id: u64,
    amount: Option<f64>,
    payment_date: Option<Timestamp>,
    cogs_account_id: u64,
    inventory_account_id: u64,
    ref_: Option<String>,
    memo: Option<String>,
) -> Result<SubscriptionPaymentResult, String> {
    if subscription.company_id != company_id {
        return Err("Subscription does not belong to this company".to_string());
    }
    if subscription.organization_id != organization_id {
        return Err("Subscription does not belong to this organization".to_string());
    }
    if !subscription.invoice_ids.contains(&invoice_move_id) {
        return Err("Invoice is not linked to this subscription".to_string());
    }

    let invoice = ctx
        .db
        .account_move()
        .id()
        .find(&invoice_move_id)
        .ok_or("Invoice not found")?;
    if invoice.company_id != company_id || invoice.organization_id != organization_id {
        return Err("Invoice does not belong to this company/organization".to_string());
    }
    if !matches!(invoice.move_type, MoveType::OutInvoice) {
        return Err("Only OutInvoice moves can be paid via subscription payment".to_string());
    }

    if invoice.state == AccountMoveState::Draft {
        ensure_accounting_period_open_for_date(ctx, company_id, invoice.date)?;
        post_invoice(
            ctx,
            organization_id,
            invoice_move_id,
            cogs_account_id,
            inventory_account_id,
        )?;
    }

    let invoice = ctx
        .db
        .account_move()
        .id()
        .find(&invoice_move_id)
        .ok_or("Invoice not found after post")?;
    if invoice.state != AccountMoveState::Posted {
        return Err("Invoice must be posted before payment".to_string());
    }

    // Ensure receivable line type is lowercase for reconcile matcher.
    if let Some(ar_line) = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&invoice_move_id)
        .find(|l| l.account_id == receivable_account_id || l.debit > 0.0)
    {
        let residual = (ar_line.debit - ar_line.credit)
            .abs()
            .max(ar_line.amount_residual.abs());
        ctx.db.account_move_line().id().update(AccountMoveLine {
            account_internal_type: Some("receivable".to_string()),
            amount_residual: residual,
            amount_residual_currency: residual,
            ..ar_line
        });
    }

    let pay_amount = amount.unwrap_or(invoice.amount_residual).max(0.0);
    if pay_amount <= 0.0 {
        return Err(
            "Payment amount must be positive (invoice residual may already be zero)".to_string(),
        );
    }
    let date = payment_date.unwrap_or(ctx.timestamp);
    ensure_accounting_period_open_for_date(ctx, company_id, date)?;

    let payment_ref =
        ref_.unwrap_or_else(|| format!("SUB{}-PAY-{}", subscription.id, invoice_move_id));

    create_account_move(
        ctx,
        organization_id,
        CreateAccountMoveParams {
            company_id: Some(company_id),
            journal_id: payment_journal_id,
            move_type: MoveType::Entry,
            date,
            name: String::new(),
            ref_: Some(payment_ref.clone()),
            auto_post: false,
            to_check: false,
            is_storno: false,
            partner_id: Some(subscription.partner_invoice_id),
            partner_bank_id: None,
            fiscal_position_id: None,
            invoice_date: None,
            invoice_date_due: None,
            invoice_payment_term_id: None,
            payment_reference: memo.clone(),
            invoice_origin: Some(format!("SUB{}", subscription.id)),
            invoice_partner_display_name: None,
            invoice_cash_rounding_id: None,
            partner_shipping_id: None,
            sale_order_id: None,
            invoice_incoterm_id: None,
            incoterm_location: None,
            campaign_id: None,
            source_id: None,
            medium_id: None,
            secure_sequence_number: None,
            metadata: Some(
                serde_json::json!({
                    "subscription_id": subscription.id,
                    "invoice_move_id": invoice_move_id,
                })
                .to_string(),
            ),
        },
    )?;

    let payment_move_id = ctx
        .db
        .account_move()
        .iter()
        .find(|m| {
            m.organization_id == organization_id
                && m.company_id == company_id
                && m.ref_.as_deref() == Some(payment_ref.as_str())
                && m.state == AccountMoveState::Draft
        })
        .map(|m| m.id)
        .ok_or("Payment move not found after create")?;

    add_account_move_line(ctx, organization_id, payment_move_id, {
        let mut line = blank_line(bank_account_id, "Bank".to_string());
        line.debit = pay_amount;
        line.sequence = 1;
        line.price_unit = pay_amount;
        line.partner_id = Some(subscription.partner_invoice_id);
        line
    })?;
    add_account_move_line(ctx, organization_id, payment_move_id, {
        let mut line = blank_line(receivable_account_id, "Accounts Receivable".to_string());
        line.credit = pay_amount;
        line.sequence = 2;
        line.price_unit = pay_amount;
        line.partner_id = Some(subscription.partner_invoice_id);
        line
    })?;

    if let Some(ar_line) = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&payment_move_id)
        .find(|l| l.account_id == receivable_account_id)
    {
        ctx.db.account_move_line().id().update(AccountMoveLine {
            account_internal_type: Some("receivable".to_string()),
            amount_residual: pay_amount,
            amount_residual_currency: pay_amount,
            ..ar_line
        });
    }

    let move_input = GuardedActionInput::PostAccountMove {
        move_id: payment_move_id,
    };
    let move_snapshot = snapshot_guarded_action(
        ctx,
        organization_id,
        company_id,
        GuardedActionKey::PostAccountMove,
        GUARDED_ACTION_SCHEMA_VERSION,
        move_input.clone(),
    )?;
    execute_guarded_action(
        ctx,
        ExecuteGuardedActionParams {
            organization_id,
            company_id,
            action: GuardedActionKey::PostAccountMove,
            action_version: GUARDED_ACTION_SCHEMA_VERSION,
            input: move_input,
            expected_subject_revision_hash: move_snapshot.subject_revision_hash,
            idempotency_key: format!("subscription-payment-move:{payment_move_id}"),
        },
    )?;

    create_payment(
        ctx,
        organization_id,
        CreatePaymentParams {
            company_id,
            payment_type: PaymentType::InBound,
            partner_type: PartnerType::Customer,
            partner_id: subscription.partner_invoice_id,
            amount: pay_amount,
            currency_id: subscription.currency_id,
            date: Some(date),
            journal_id: payment_journal_id,
            ref_: Some(payment_ref.clone()),
            memo,
        },
    )?;

    let payment_id = ctx
        .db
        .account_payment()
        .iter()
        .find(|p| {
            p.organization_id == organization_id
                && p.company_id == company_id
                && p.ref_.as_deref() == Some(payment_ref.as_str())
        })
        .map(|p| p.id)
        .ok_or("Payment not found after create")?;

    let payment_input = GuardedActionInput::PostPayment { payment_id };
    let payment_snapshot = snapshot_guarded_action(
        ctx,
        organization_id,
        company_id,
        GuardedActionKey::PostPayment,
        GUARDED_ACTION_SCHEMA_VERSION,
        payment_input.clone(),
    )?;
    execute_guarded_action(
        ctx,
        ExecuteGuardedActionParams {
            organization_id,
            company_id,
            action: GuardedActionKey::PostPayment,
            action_version: GUARDED_ACTION_SCHEMA_VERSION,
            input: payment_input,
            expected_subject_revision_hash: payment_snapshot.subject_revision_hash,
            idempotency_key: format!("subscription-payment:{payment_id}"),
        },
    )?;
    register_payment_on_invoice(
        ctx,
        organization_id,
        payment_id,
        vec![invoice_move_id],
        false,
    )?;
    reconcile_payment_with_invoice(ctx, organization_id, payment_move_id, invoice_move_id)?;

    Ok(SubscriptionPaymentResult {
        payment_id,
        payment_move_id,
        invoice_move_id,
        amount: pay_amount,
    })
}
