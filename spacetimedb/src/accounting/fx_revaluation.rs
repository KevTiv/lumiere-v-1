/// FX revaluation — post unrealized currency adjustments (A10).
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::chart_of_accounts::{
    account_account, account_journal, AccountAccount, AccountJournal,
};
use crate::accounting::fiscal_periods::ensure_accounting_period_open_for_date;
use crate::accounting::idempotency::{record_result, replayed_result};
use crate::accounting::journal_entries::{
    account_move, account_move_line, AccountMove, AccountMoveLine,
};
use crate::accounting::payments::account_payment;
use crate::core::organization::{company, require_company_in_organization};
use crate::core::reference::require_currency_by_id;
use crate::helpers::{check_permission, next_doc_number, write_audit_log_v2, AuditLogParams};
use crate::types::{AccountInternalGroup, AccountMoveState, JournalType, PaymentState};

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = fx_revaluation_run,
    public,
    index(accessor = fx_reval_by_org, btree(columns = [organization_id])),
    index(accessor = fx_reval_by_company, btree(columns = [company_id]))
)]
pub struct FxRevaluationRun {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub currency_id: u64,
    /// Immutable ISO-code snapshot captured when the run is posted.
    pub currency_code_snapshot: String,
    pub company_currency_id: u64,
    pub rate: f64,
    pub rate_source: String,
    pub rate_effective_date: Timestamp,
    pub as_of_date: Timestamp,
    pub move_id: u64,
    pub journal_id: u64,
    pub total_gain: f64,
    pub total_loss: f64,
    pub net_adjustment: f64,
    pub reference: Option<String>,
    pub create_uid: Option<Identity>,
    pub create_date: Option<Timestamp>,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct FxRevaluationLineParams {
    pub account_id: u64,
    /// Signed functional-currency adjustment (positive = gain, negative = loss).
    pub adjustment: f64,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RunFxRevaluationParams {
    pub idempotency_key: String,
    pub currency_id: u64,
    pub as_of_date: Timestamp,
    /// Functional currency units per 1.0 foreign currency unit.
    pub rate: f64,
    pub rate_source: String,
    pub rate_effective_date: Timestamp,
    pub journal_id: u64,
    pub gain_account_id: u64,
    pub loss_account_id: u64,
    pub lines: Vec<FxRevaluationLineParams>,
    pub reference: Option<String>,
    pub metadata: Option<String>,
}

/// Auto-scan open AR/AP foreign-currency residuals and revalue at `rate`.
#[derive(SpacetimeType, Clone, Debug)]
pub struct RunFxRevaluationBatchParams {
    pub idempotency_key: String,
    pub currency_id: u64,
    pub as_of_date: Timestamp,
    pub journal_id: u64,
    pub gain_account_id: u64,
    pub loss_account_id: u64,
    /// Functional currency units per 1.0 foreign currency unit.
    pub rate: f64,
    pub rate_source: String,
    pub rate_effective_date: Timestamp,
    pub reference: Option<String>,
    pub metadata: Option<String>,
}

/// Post realized FX gain/loss on settlement (payment vs invoice functional residual).
#[derive(SpacetimeType, Clone, Debug)]
pub struct PostRealizedFxParams {
    pub idempotency_key: String,
    pub payment_id: u64,
    pub invoice_move_id: u64,
    pub payment_amount_functional: f64,
    pub invoice_residual_functional: f64,
    pub journal_id: u64,
    pub gain_account_id: u64,
    pub loss_account_id: u64,
    /// AR/AP or clearing account for the settlement leg.
    pub clearing_account_id: u64,
    pub date: Timestamp,
    pub reference: Option<String>,
    pub metadata: Option<String>,
}

struct FxScope {
    currency_id: u64,
    currency_code_snapshot: String,
    company_currency_id: u64,
    journal: AccountJournal,
    gain_account: AccountAccount,
    loss_account: AccountAccount,
}

fn load_fx_account(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    account_id: u64,
    role: &str,
) -> Result<AccountAccount, String> {
    let account = ctx
        .db
        .account_account()
        .id()
        .find(&account_id)
        .ok_or_else(|| format!("{role} account not found"))?;
    if account.organization_id != organization_id || account.company_id != company_id {
        return Err(format!(
            "{role} account does not belong to this organization and company"
        ));
    }
    if account.deprecated {
        return Err(format!("{role} account is deprecated"));
    }
    Ok(account)
}

fn load_fx_scope(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    currency_id: u64,
    journal_id: u64,
    gain_account_id: u64,
    loss_account_id: u64,
) -> Result<FxScope, String> {
    require_company_in_organization(ctx, organization_id, company_id)?;
    let company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("company not found")?;

    if currency_id == company.currency_id {
        return Err("revaluation currency must differ from company currency".to_string());
    }
    let currency = require_currency_by_id(ctx, currency_id)?;
    if !currency.active {
        return Err("revaluation currency is inactive".to_string());
    }
    let company_currency = require_currency_by_id(ctx, company.currency_id)?;
    if !company_currency.active {
        return Err("company currency is inactive".to_string());
    }

    let journal = ctx
        .db
        .account_journal()
        .id()
        .find(&journal_id)
        .ok_or("journal not found")?;
    if journal.organization_id != organization_id || journal.company_id != company_id {
        return Err("journal does not belong to this organization and company".to_string());
    }
    if !journal.active {
        return Err("journal is inactive".to_string());
    }
    if journal.type_ != JournalType::General {
        return Err("FX revaluation requires a general journal".to_string());
    }
    if journal
        .currency_id
        .is_some_and(|id| id != currency_id && id != company.currency_id)
    {
        return Err("journal currency is incompatible with this revaluation".to_string());
    }

    let gain_account = load_fx_account(ctx, organization_id, company_id, gain_account_id, "gain")?;
    if gain_account.internal_group != Some(AccountInternalGroup::Income) {
        return Err("gain account must be an income account".to_string());
    }
    let loss_account = load_fx_account(ctx, organization_id, company_id, loss_account_id, "loss")?;
    if loss_account.internal_group != Some(AccountInternalGroup::Expense) {
        return Err("loss account must be an expense account".to_string());
    }

    Ok(FxScope {
        currency_id,
        currency_code_snapshot: currency.code,
        company_currency_id: company.currency_id,
        journal,
        gain_account,
        loss_account,
    })
}

fn validate_rate(rate: f64, source: &str) -> Result<String, String> {
    if !rate.is_finite() || rate <= 0.0 {
        return Err("rate must be a positive finite number".to_string());
    }
    let source = source.trim();
    if source.is_empty() {
        return Err("rate_source cannot be empty".to_string());
    }
    Ok(source.to_string())
}

fn insert_move_line(
    ctx: &ReducerContext,
    organization_id: u64,
    move_id: u64,
    move_name: &str,
    journal_id: u64,
    company_id: u64,
    currency_id: u64,
    company_currency_id: u64,
    account_id: u64,
    line_name: &str,
    debit: f64,
    credit: f64,
    sequence: u32,
    metadata: Option<String>,
) {
    ctx.db.account_move_line().insert(AccountMoveLine {
        id: 0,
        organization_id,
        move_id,
        move_name: Some(move_name.to_string()),
        date: ctx.timestamp,
        ref_: None,
        parent_state: AccountMoveState::Posted,
        journal_id,
        company_id,
        company_currency_id,
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
        metadata,
    });
}

fn run_fx_revaluation_impl(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: RunFxRevaluationParams,
) -> Result<u64, String> {
    let scope = load_fx_scope(
        ctx,
        organization_id,
        company_id,
        params.currency_id,
        params.journal_id,
        params.gain_account_id,
        params.loss_account_id,
    )?;
    ensure_accounting_period_open_for_date(ctx, company_id, params.as_of_date)?;
    let rate_source = validate_rate(params.rate, &params.rate_source)?;
    if params.rate_effective_date.to_micros_since_unix_epoch()
        > params.as_of_date.to_micros_since_unix_epoch()
    {
        return Err("rate_effective_date cannot be after as_of_date".to_string());
    }

    if params.lines.is_empty() {
        return Err("At least one revaluation line is required".to_string());
    }

    let mut total_gain = 0.0;
    let mut total_loss = 0.0;
    for line in &params.lines {
        let account = load_fx_account(
            ctx,
            organization_id,
            company_id,
            line.account_id,
            "revaluation line",
        )?;
        if !matches!(
            account.internal_group,
            Some(AccountInternalGroup::Asset | AccountInternalGroup::Liability)
        ) {
            return Err(
                "revaluation line account must be an asset or liability account".to_string(),
            );
        }
        if account
            .currency_id
            .is_some_and(|id| id != scope.currency_id)
        {
            return Err(
                "revaluation line account currency is incompatible with this revaluation"
                    .to_string(),
            );
        }
        if line.adjustment.abs() < 0.000_000_1 {
            continue;
        }
        if line.adjustment > 0.0 {
            total_gain += line.adjustment;
        } else {
            total_loss += -line.adjustment;
        }
    }

    if total_gain <= 0.0 && total_loss <= 0.0 {
        return Err("Revaluation lines must contain non-zero adjustments".to_string());
    }

    let net = total_gain - total_loss;
    let name = next_doc_number(ctx, "FXREVAL");

    let move_record = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: name.clone(),
        ref_: params.reference.clone(),
        move_type: crate::types::MoveType::Entry,
        auto_post: false,
        state: AccountMoveState::Posted,
        date: params.as_of_date,
        invoice_date: None,
        invoice_date_due: None,
        invoice_payment_term_id: None,
        invoice_origin: None,
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
        journal_id: scope.journal.id,
        currency_id: scope.currency_id,
        company_currency_id: scope.company_currency_id,
        amount_untaxed: net.abs(),
        amount_tax: 0.0,
        amount_total: net.abs(),
        amount_residual: 0.0,
        amount_untaxed_signed: net,
        amount_tax_signed: 0.0,
        amount_total_signed: net,
        amount_total_in_currency_signed: net,
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

    let mut sequence = 1_u32;
    let mut total_debit = 0.0;
    let mut total_credit = 0.0;

    for line in &params.lines {
        if line.adjustment.abs() < 0.000_000_1 {
            continue;
        }
        if line.adjustment > 0.0 {
            insert_move_line(
                ctx,
                organization_id,
                move_record.id,
                &name,
                params.journal_id,
                company_id,
                scope.currency_id,
                scope.company_currency_id,
                line.account_id,
                "FX revaluation gain",
                line.adjustment,
                0.0,
                sequence,
                params.metadata.clone(),
            );
            total_debit += line.adjustment;
        } else {
            let amount = -line.adjustment;
            insert_move_line(
                ctx,
                organization_id,
                move_record.id,
                &name,
                params.journal_id,
                company_id,
                scope.currency_id,
                scope.company_currency_id,
                line.account_id,
                "FX revaluation loss",
                0.0,
                amount,
                sequence,
                params.metadata.clone(),
            );
            total_credit += amount;
        }
        sequence += 1;
    }

    if net > 0.0 {
        insert_move_line(
            ctx,
            organization_id,
            move_record.id,
            &name,
            params.journal_id,
            company_id,
            scope.currency_id,
            scope.company_currency_id,
            scope.gain_account.id,
            "FX unrealized gain",
            0.0,
            net,
            sequence,
            params.metadata.clone(),
        );
        total_credit += net;
    } else if net < 0.0 {
        let amount = -net;
        insert_move_line(
            ctx,
            organization_id,
            move_record.id,
            &name,
            params.journal_id,
            company_id,
            scope.currency_id,
            scope.company_currency_id,
            scope.loss_account.id,
            "FX unrealized loss",
            amount,
            0.0,
            sequence,
            params.metadata.clone(),
        );
        total_debit += amount;
    }

    if (total_debit - total_credit).abs() > 0.01 {
        return Err(format!(
            "FX revaluation move is not balanced: debit={total_debit} credit={total_credit}"
        ));
    }

    let run = ctx.db.fx_revaluation_run().insert(FxRevaluationRun {
        id: 0,
        organization_id,
        company_id,
        currency_id: scope.currency_id,
        currency_code_snapshot: scope.currency_code_snapshot.clone(),
        company_currency_id: scope.company_currency_id,
        rate: params.rate,
        rate_source: rate_source.clone(),
        rate_effective_date: params.rate_effective_date,
        as_of_date: params.as_of_date,
        move_id: move_record.id,
        journal_id: params.journal_id,
        total_gain,
        total_loss,
        net_adjustment: net,
        reference: params.reference.clone(),
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        metadata: params.metadata.clone(),
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "fx_revaluation_run",
            record_id: run.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "currency_id": scope.currency_id,
                    "currency_code_snapshot": scope.currency_code_snapshot,
                    "company_currency_id": scope.company_currency_id,
                    "rate": params.rate,
                    "rate_source": rate_source,
                    "rate_effective_date_micros": params
                        .rate_effective_date
                        .to_micros_since_unix_epoch(),
                    "move_id": move_record.id,
                    "net_adjustment": net,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "currency_id".to_string(),
                "currency_code_snapshot".to_string(),
                "company_currency_id".to_string(),
                "rate".to_string(),
                "rate_source".to_string(),
                "rate_effective_date".to_string(),
                "move_id".to_string(),
                "net_adjustment".to_string(),
            ],
            metadata: params.metadata.clone(),
        },
    );

    Ok(run.id)
}

#[spacetimedb::reducer]
pub fn run_fx_revaluation(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: RunFxRevaluationParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move", "create")?;
    let payload_fingerprint = format!("{params:?}");
    if replayed_result(
        ctx,
        organization_id,
        company_id,
        "run_fx_revaluation",
        &params.idempotency_key,
        &payload_fingerprint,
    )?
    .is_some()
    {
        return Ok(());
    }
    let idempotency_key = params.idempotency_key.clone();
    let run_id = run_fx_revaluation_impl(ctx, organization_id, company_id, params)?;
    record_result(
        ctx,
        organization_id,
        company_id,
        "run_fx_revaluation",
        idempotency_key,
        payload_fingerprint,
        "fx_revaluation_run",
        run_id,
    );
    Ok(())
}

/// Build unrealized FX lines from open foreign-currency AR/AP residuals and post via `run_fx_revaluation`.
#[spacetimedb::reducer]
pub fn run_fx_revaluation_batch(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: RunFxRevaluationBatchParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move", "create")?;
    let payload_fingerprint = format!("{params:?}");
    if replayed_result(
        ctx,
        organization_id,
        company_id,
        "run_fx_revaluation_batch",
        &params.idempotency_key,
        &payload_fingerprint,
    )?
    .is_some()
    {
        return Ok(());
    }
    let idempotency_key = params.idempotency_key.clone();
    let scope = load_fx_scope(
        ctx,
        organization_id,
        company_id,
        params.currency_id,
        params.journal_id,
        params.gain_account_id,
        params.loss_account_id,
    )?;
    validate_rate(params.rate, &params.rate_source)?;
    let mut lines: Vec<FxRevaluationLineParams> = Vec::new();

    for mv in ctx.db.account_move().iter() {
        if mv.organization_id != organization_id
            || mv.company_id != company_id
            || mv.state != AccountMoveState::Posted
            || mv.currency_id != scope.currency_id
            || mv.company_currency_id != scope.company_currency_id
        {
            continue;
        }
        if !matches!(
            mv.move_type,
            crate::types::MoveType::OutInvoice
                | crate::types::MoveType::InInvoice
                | crate::types::MoveType::OutRefund
                | crate::types::MoveType::InRefund
        ) {
            continue;
        }
        if mv.amount_residual.abs() < 0.000_001 {
            continue;
        }

        // Prefer residual currency amount when present; else treat residual as foreign notional.
        let foreign_residual = ctx
            .db
            .account_move_line()
            .move_line_by_move()
            .filter(&mv.id)
            .map(|l| l.amount_residual_currency.abs())
            .fold(0.0_f64, f64::max)
            .max(mv.amount_residual.abs());

        let revalued = foreign_residual * params.rate;
        let adjustment = revalued - mv.amount_residual.abs();
        if adjustment.abs() < 0.000_000_1 {
            continue;
        }

        // Pick a receivable/payable line account for the balance-sheet side.
        let Some(bs_line) = ctx
            .db
            .account_move_line()
            .move_line_by_move()
            .filter(&mv.id)
            .find(|l| l.partner_id.is_some() && (l.debit > 0.0 || l.credit > 0.0))
        else {
            continue;
        };

        lines.push(FxRevaluationLineParams {
            account_id: bs_line.account_id,
            adjustment,
        });
    }

    if lines.is_empty() {
        return Err(format!(
            "No open AR/AP residuals found for currency {}",
            scope.currency_code_snapshot
        ));
    }

    let run_id = run_fx_revaluation_impl(
        ctx,
        organization_id,
        company_id,
        RunFxRevaluationParams {
            idempotency_key: params.idempotency_key,
            currency_id: scope.currency_id,
            as_of_date: params.as_of_date,
            rate: params.rate,
            rate_source: params.rate_source,
            rate_effective_date: params.rate_effective_date,
            journal_id: params.journal_id,
            gain_account_id: params.gain_account_id,
            loss_account_id: params.loss_account_id,
            lines,
            reference: params.reference,
            metadata: params.metadata,
        },
    )?;
    record_result(
        ctx,
        organization_id,
        company_id,
        "run_fx_revaluation_batch",
        idempotency_key,
        payload_fingerprint,
        "fx_revaluation_run",
        run_id,
    );
    Ok(())
}

/// Post realized FX gain/loss when settling a foreign invoice at a different rate.
#[spacetimedb::reducer]
pub fn post_realized_fx_gain_loss(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: PostRealizedFxParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move", "create")?;
    let payload_fingerprint = format!("{params:?}");
    if replayed_result(
        ctx,
        organization_id,
        company_id,
        "post_realized_fx_gain_loss",
        &params.idempotency_key,
        &payload_fingerprint,
    )?
    .is_some()
    {
        return Ok(());
    }
    let idempotency_key = params.idempotency_key.clone();
    require_company_in_organization(ctx, organization_id, company_id)?;
    ensure_accounting_period_open_for_date(ctx, company_id, params.date)?;

    let difference = params.payment_amount_functional - params.invoice_residual_functional;
    if difference.abs() < 0.000_000_1 {
        return Err("No realized FX difference to post".to_string());
    }

    let payment = ctx
        .db
        .account_payment()
        .id()
        .find(&params.payment_id)
        .ok_or("Payment not found")?;
    if payment.organization_id != organization_id || payment.company_id != company_id {
        return Err("Payment does not belong to this company".to_string());
    }
    if payment.state != PaymentState::Paid {
        return Err("Payment must be posted".to_string());
    }

    let invoice = ctx
        .db
        .account_move()
        .id()
        .find(&params.invoice_move_id)
        .ok_or("Invoice move not found")?;
    if invoice.organization_id != organization_id || invoice.company_id != company_id {
        return Err("Invoice does not belong to this company".to_string());
    }
    if invoice.state != AccountMoveState::Posted {
        return Err("Invoice must be posted".to_string());
    }
    if invoice.currency_id != payment.currency_id {
        return Err("Payment and invoice currencies do not match".to_string());
    }

    let scope = load_fx_scope(
        ctx,
        organization_id,
        company_id,
        payment.currency_id,
        params.journal_id,
        params.gain_account_id,
        params.loss_account_id,
    )?;
    let clearing_account = load_fx_account(
        ctx,
        organization_id,
        company_id,
        params.clearing_account_id,
        "clearing",
    )?;
    if !matches!(
        clearing_account.internal_group,
        Some(AccountInternalGroup::Asset | AccountInternalGroup::Liability)
    ) {
        return Err("clearing account must be an asset or liability account".to_string());
    }

    let name = next_doc_number(ctx, "FXREAL");
    let abs = difference.abs();

    let move_record = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: name.clone(),
        ref_: params.reference.clone(),
        move_type: crate::types::MoveType::Entry,
        auto_post: false,
        state: AccountMoveState::Posted,
        date: params.date,
        invoice_date: None,
        invoice_date_due: None,
        invoice_payment_term_id: None,
        invoice_origin: Some(format!(
            "realized-fx:pay{}:inv{}",
            params.payment_id, params.invoice_move_id
        )),
        invoice_partner_display_name: None,
        invoice_cash_rounding_id: None,
        payment_reference: params.reference.clone(),
        partner_shipping_id: None,
        sale_order_id: None,
        partner_id: Some(payment.partner_id),
        commercial_partner_id: Some(payment.partner_id),
        partner_bank_id: None,
        fiscal_position_id: None,
        invoice_user_id: None,
        invoice_incoterm_id: None,
        incoterm_location: None,
        campaign_id: None,
        source_id: None,
        medium_id: None,
        company_id,
        journal_id: scope.journal.id,
        currency_id: scope.currency_id,
        company_currency_id: scope.company_currency_id,
        amount_untaxed: abs,
        amount_tax: 0.0,
        amount_total: abs,
        amount_residual: 0.0,
        amount_untaxed_signed: difference,
        amount_tax_signed: 0.0,
        amount_total_signed: difference,
        amount_total_in_currency_signed: difference,
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

    if difference > 0.0 {
        // Gain: Dr settlement (AR/AP) / Cr gain
        insert_move_line(
            ctx,
            organization_id,
            move_record.id,
            &name,
            params.journal_id,
            company_id,
            scope.currency_id,
            scope.company_currency_id,
            clearing_account.id,
            "FX realized settlement",
            abs,
            0.0,
            1,
            params.metadata.clone(),
        );
        insert_move_line(
            ctx,
            organization_id,
            move_record.id,
            &name,
            params.journal_id,
            company_id,
            scope.currency_id,
            scope.company_currency_id,
            scope.gain_account.id,
            "FX realized gain",
            0.0,
            abs,
            2,
            params.metadata.clone(),
        );
    } else {
        // Loss: Dr loss / Cr settlement
        insert_move_line(
            ctx,
            organization_id,
            move_record.id,
            &name,
            params.journal_id,
            company_id,
            scope.currency_id,
            scope.company_currency_id,
            scope.loss_account.id,
            "FX realized loss",
            abs,
            0.0,
            1,
            params.metadata.clone(),
        );
        insert_move_line(
            ctx,
            organization_id,
            move_record.id,
            &name,
            params.journal_id,
            company_id,
            scope.currency_id,
            scope.company_currency_id,
            clearing_account.id,
            "FX realized settlement",
            0.0,
            abs,
            2,
            params.metadata.clone(),
        );
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_move",
            record_id: move_record.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "payment_id": params.payment_id,
                    "invoice_move_id": params.invoice_move_id,
                    "difference": difference,
                })
                .to_string(),
            ),
            changed_fields: vec!["difference".to_string()],
            metadata: params.metadata.clone(),
        },
    );

    record_result(
        ctx,
        organization_id,
        company_id,
        "post_realized_fx_gain_loss",
        idempotency_key,
        payload_fingerprint,
        "account_move",
        move_record.id,
    );
    Ok(())
}
