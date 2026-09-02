/// Accrual and prepaid expense amortization schedules (mirror deferred revenue pattern).
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::fiscal_periods::ensure_accounting_period_open_for_date;
use crate::accounting::idempotency::{record_result, replayed_result};
use crate::accounting::journal_entries::{
    account_move, account_move_line, AccountMove, AccountMoveLine,
};
use crate::accounting::relations::{
    require_active_account, require_active_currency_id, require_active_journal,
};
use crate::core::organization::require_company_in_organization;
use crate::helpers::{check_permission, next_doc_number, write_audit_log_v2, AuditLogParams};
use crate::types::{AccountInternalGroup, AccountMoveState, JournalType, PaymentState};

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = amortization_schedule,
    public,
    index(accessor = amort_schedule_by_org, btree(columns = [organization_id])),
    index(accessor = amort_schedule_by_company, btree(columns = [company_id]))
)]
#[derive(Clone)]
pub struct AmortizationSchedule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    /// "accrual" | "prepaid"
    pub schedule_kind: String,
    pub description: String,
    pub journal_id: u64,
    /// Balance sheet account (accrual liability or prepaid asset)
    pub balance_sheet_account_id: u64,
    /// P&L account (expense or income offset)
    pub pl_account_id: u64,
    pub currency_id: u64,
    pub total_amount: f64,
    pub recognized_amount: f64,
    pub remaining_amount: f64,
    pub start_date: Timestamp,
    pub end_date: Timestamp,
    /// "month" | "quarter" | "year"
    pub recognition_period: String,
    pub state: String,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = amortization_line,
    public,
    index(accessor = amort_line_by_org, btree(columns = [organization_id])),
    index(accessor = amort_line_by_schedule, btree(columns = [schedule_id]))
)]
#[derive(Clone)]
pub struct AmortizationLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub schedule_id: u64,
    pub sequence: u32,
    pub recognition_date: Timestamp,
    pub amount: f64,
    pub recognized: bool,
    pub move_id: Option<u64>,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAmortizationScheduleParams {
    pub schedule_kind: String,
    pub description: String,
    pub journal_id: u64,
    pub balance_sheet_account_id: u64,
    pub pl_account_id: u64,
    pub currency_id: u64,
    pub total_amount: f64,
    pub start_date: Timestamp,
    pub end_date: Timestamp,
    pub recognition_period: String,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecognizeAmortizationLineParams {
    pub reference: Option<String>,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn create_amortization_schedule(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateAmortizationScheduleParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "amortization_schedule", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;

    if !matches!(params.schedule_kind.as_str(), "accrual" | "prepaid") {
        return Err("schedule_kind must be accrual or prepaid".to_string());
    }
    if params.total_amount <= 0.0 {
        return Err("total_amount must be positive".to_string());
    }
    if params.start_date.to_micros_since_unix_epoch() > params.end_date.to_micros_since_unix_epoch()
    {
        return Err("start_date cannot be after end_date".to_string());
    }
    if !matches!(
        params.recognition_period.as_str(),
        "month" | "quarter" | "year"
    ) {
        return Err("Invalid recognition_period".to_string());
    }
    let journal = require_active_journal(
        ctx,
        organization_id,
        company_id,
        params.journal_id,
        "amortization",
    )?;
    if journal.type_ != JournalType::General {
        return Err("amortization requires a general journal".to_string());
    }
    require_active_currency_id(ctx, params.currency_id, "amortization")?;
    if journal
        .currency_id
        .is_some_and(|currency_id| currency_id != params.currency_id)
    {
        return Err("amortization currency is incompatible with the journal".to_string());
    }
    let balance_account = require_active_account(
        ctx,
        organization_id,
        company_id,
        params.balance_sheet_account_id,
        "amortization balance sheet",
    )?;
    let expected_balance_group = if params.schedule_kind == "prepaid" {
        AccountInternalGroup::Asset
    } else {
        AccountInternalGroup::Liability
    };
    if balance_account.internal_group != Some(expected_balance_group) {
        return Err("amortization balance sheet account has the wrong role".to_string());
    }
    let pl_account = require_active_account(
        ctx,
        organization_id,
        company_id,
        params.pl_account_id,
        "amortization P&L",
    )?;
    if !matches!(
        pl_account.internal_group,
        Some(AccountInternalGroup::Income | AccountInternalGroup::Expense)
    ) {
        return Err("amortization P&L account must be income or expense".to_string());
    }

    let inserted = ctx.db.amortization_schedule().insert(AmortizationSchedule {
        id: 0,
        organization_id,
        company_id,
        schedule_kind: params.schedule_kind.clone(),
        description: params.description.clone(),
        journal_id: params.journal_id,
        balance_sheet_account_id: params.balance_sheet_account_id,
        pl_account_id: params.pl_account_id,
        currency_id: params.currency_id,
        total_amount: params.total_amount,
        recognized_amount: 0.0,
        remaining_amount: params.total_amount,
        start_date: params.start_date,
        end_date: params.end_date,
        recognition_period: params.recognition_period.clone(),
        state: "running".to_string(),
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        metadata: params.metadata.clone(),
    });

    let (period_count, period_secs) = match params.recognition_period.as_str() {
        "month" => (12_u32, 30 * 24 * 60 * 60_u64),
        "quarter" => (4, 90 * 24 * 60 * 60),
        _ => (1, 365 * 24 * 60 * 60),
    };
    let amount_per = params.total_amount / period_count as f64;
    let start_secs = params
        .start_date
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_secs();

    for i in 0..period_count {
        let recognition_date = Timestamp::from_duration_since_unix_epoch(
            std::time::Duration::from_secs(start_secs + i as u64 * period_secs),
        );
        ctx.db.amortization_line().insert(AmortizationLine {
            id: 0,
            organization_id,
            company_id,
            schedule_id: inserted.id,
            sequence: i + 1,
            recognition_date,
            amount: amount_per,
            recognized: false,
            move_id: None,
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            metadata: params.metadata.clone(),
        });
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "amortization_schedule",
            record_id: inserted.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "schedule_kind": params.schedule_kind,
                    "total_amount": params.total_amount,
                })
                .to_string(),
            ),
            changed_fields: vec!["schedule_kind".to_string(), "total_amount".to_string()],
            metadata: params.metadata.clone(),
        },
    );

    Ok(())
}

#[spacetimedb::reducer]
pub fn recognize_amortization_line(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    line_id: u64,
    params: RecognizeAmortizationLineParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "amortization_line", "write")?;
    check_permission(ctx, organization_id, "account_move", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;

    let line = ctx
        .db
        .amortization_line()
        .id()
        .find(&line_id)
        .ok_or("Amortization line not found")?;
    if line.organization_id != organization_id || line.company_id != company_id {
        return Err("Amortization line does not belong to this company".to_string());
    }

    let schedule = ctx
        .db
        .amortization_schedule()
        .id()
        .find(&line.schedule_id)
        .ok_or("Amortization schedule not found")?;
    if schedule.organization_id != organization_id || schedule.company_id != company_id {
        return Err("Amortization schedule does not belong to this company".to_string());
    }

    let idempotency_key = format!("amortization-line:{line_id}:recognize");
    let payload_fingerprint = format!("{params:?}");
    if replayed_result(
        ctx,
        organization_id,
        company_id,
        "recognize_amortization_line",
        &idempotency_key,
        &payload_fingerprint,
    )?
    .is_some()
    {
        return Ok(());
    }

    if line.recognized {
        return Err("Amortization line already recognized".to_string());
    }
    if schedule.state != "running" {
        return Err("Amortization schedule is not running".to_string());
    }

    let journal = require_active_journal(
        ctx,
        organization_id,
        company_id,
        schedule.journal_id,
        "amortization recognition",
    )?;
    if journal.type_ != JournalType::General {
        return Err("amortization recognition requires a general journal".to_string());
    }
    require_active_currency_id(ctx, schedule.currency_id, "amortization recognition")?;
    if journal
        .currency_id
        .is_some_and(|currency_id| currency_id != schedule.currency_id)
    {
        return Err(
            "amortization recognition currency is incompatible with the journal".to_string(),
        );
    }
    let balance_account = require_active_account(
        ctx,
        organization_id,
        company_id,
        schedule.balance_sheet_account_id,
        "amortization recognition balance sheet",
    )?;
    let expected_balance_group = if schedule.schedule_kind == "prepaid" {
        AccountInternalGroup::Asset
    } else {
        AccountInternalGroup::Liability
    };
    if balance_account.internal_group != Some(expected_balance_group) {
        return Err(
            "amortization recognition balance sheet account has the wrong role".to_string(),
        );
    }
    let pl_account = require_active_account(
        ctx,
        organization_id,
        company_id,
        schedule.pl_account_id,
        "amortization recognition P&L",
    )?;
    if !matches!(
        pl_account.internal_group,
        Some(AccountInternalGroup::Income | AccountInternalGroup::Expense)
    ) {
        return Err("amortization recognition P&L account has the wrong role".to_string());
    }

    ensure_accounting_period_open_for_date(ctx, company_id, line.recognition_date)?;

    let amount = line.amount;
    let name = next_doc_number(ctx, organization_id, "AMORT");
    let currency_id = schedule.currency_id;

    // Accrual: Dr expense / Cr accrual liability
    // Prepaid: Dr expense / Cr prepaid asset
    let (debit_account, credit_account) =
        (schedule.pl_account_id, schedule.balance_sheet_account_id);

    let move_record = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: name.clone(),
        ref_: params.reference.clone(),
        move_type: crate::types::MoveType::Entry,
        auto_post: false,
        state: AccountMoveState::Posted,
        date: line.recognition_date,
        invoice_date: None,
        invoice_date_due: None,
        invoice_payment_term_id: None,
        invoice_origin: Some(format!("amort:{}", schedule.id)),
        invoice_partner_display_name: None,
        invoice_cash_rounding_id: None,
        payment_reference: params.reference.clone(),
        partner_shipping_id: None,
        sale_order_id: None,
        partner_id: None,
        commercial_partner_id: None,
        partner_bank_id: None,
        fiscal_position_id: None,
        invoice_user_id: None,
        invoice_incoterm_id: None,
        incoterm_location: None,
        campaign_id: None,
        source_id: None,
        medium_id: None,
        company_id,
        journal_id: schedule.journal_id,
        currency_id,
        company_currency_id: currency_id,
        amount_untaxed: amount,
        amount_tax: 0.0,
        amount_total: amount,
        amount_residual: 0.0,
        amount_untaxed_signed: amount,
        amount_tax_signed: 0.0,
        amount_total_signed: amount,
        amount_total_in_currency_signed: amount,
        amount_residual_signed: 0.0,
        to_check: false,
        posted_before: true,
        is_storno: false,
        is_move_sent: false,
        secure_sequence_number: None,
        invoice_has_outstanding: false,
        payment_state: PaymentState::NotPaid,
        restrict_mode_hash_table: false,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: params.metadata.clone(),
    });

    let insert_line = |account_id: u64, line_name: &str, debit: f64, credit: f64, sequence: u32| {
        ctx.db.account_move_line().insert(AccountMoveLine {
            id: 0,
            organization_id,
            move_id: move_record.id,
            move_name: Some(name.clone()),
            date: line.recognition_date,
            ref_: params.reference.clone(),
            parent_state: AccountMoveState::Posted,
            journal_id: schedule.journal_id,
            company_id,
            company_currency_id: currency_id,
            sequence,
            name: line_name.to_string(),
            quantity: 0.0,
            price_unit: 0.0,
            price: 0.0,
            price_subtotal: 0.0,
            price_total: 0.0,
            discount: 0.0,
            balance: debit - credit,
            currency_id,
            amount_currency: 0.0,
            amount_residual: 0.0,
            amount_residual_currency: 0.0,
            debit,
            credit,
            debit_currency: 0.0,
            credit_currency: 0.0,
            tax_base_amount: 0.0,
            account_id,
            account_internal_type: None,
            account_internal_group: None,
            account_root_id: None,
            group_tax_id: None,
            tax_line_id: None,
            tax_group_id: None,
            tax_ids: vec![],
            tax_repartition_line_id: None,
            tax_audit: None,
            partner_id: None,
            commercial_partner_id: None,
            reconcile_model_id: None,
            payment_id: None,
            statement_line_id: None,
            currency_id_field: None,
            blocked: false,
            matching_number: None,
            matching_label: None,
            is_matching: false,
            expected_pay_date: None,
            expected_pay_date_currency_id: None,
            expected_pay_date_amount: 0.0,
            expected_pay_date_residual: 0.0,
            display_type: None,
            is_downpayment: false,
            exclude_from_invoice_tab: false,
            analytic_account_id: None,
            analytic_tag_ids: vec![],
            product_id: None,
            product_uom_id: None,
            product_category_id: None,
            cogs_amount: 0.0,
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: params.metadata.clone(),
        });
    };

    insert_line(debit_account, "Amortization recognition", amount, 0.0, 1);
    insert_line(credit_account, "Amortization contra", 0.0, amount, 2);

    ctx.db.amortization_line().id().update(AmortizationLine {
        recognized: true,
        move_id: Some(move_record.id),
        ..line.clone()
    });

    let new_recognized = schedule.recognized_amount + amount;
    let new_remaining = schedule.remaining_amount - amount;
    let new_state = if new_remaining <= 0.0 {
        "finished".to_string()
    } else {
        schedule.state.clone()
    };

    ctx.db
        .amortization_schedule()
        .id()
        .update(AmortizationSchedule {
            recognized_amount: new_recognized,
            remaining_amount: new_remaining,
            state: new_state,
            ..schedule
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "amortization_line",
            record_id: line_id,
            action: "UPDATE",
            old_values: Some(serde_json::json!({ "recognized": false }).to_string()),
            new_values: Some(
                serde_json::json!({
                    "recognized": true,
                    "move_id": move_record.id,
                    "amount": amount,
                })
                .to_string(),
            ),
            changed_fields: vec!["recognized".to_string(), "move_id".to_string()],
            metadata: params.metadata.clone(),
        },
    );

    record_result(
        ctx,
        organization_id,
        company_id,
        "recognize_amortization_line",
        idempotency_key,
        payload_fingerprint,
        "account_move",
        move_record.id,
    );

    Ok(())
}
