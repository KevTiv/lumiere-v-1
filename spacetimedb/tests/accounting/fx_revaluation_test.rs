//! FX revaluation smoke test (A10).
use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_account, account_account_type, account_journal, create_account_account,
    create_account_account_type, create_account_journal, AccountJournal,
    CreateAccountAccountParams, CreateAccountAccountTypeParams, CreateAccountJournalParams,
};
use crate::accounting::fx_revaluation::{
    fx_revaluation_run, post_realized_fx_gain_loss, run_fx_revaluation, run_fx_revaluation_batch,
    FxRevaluationLineParams, PostRealizedFxParams, RunFxRevaluationBatchParams,
    RunFxRevaluationParams,
};
use crate::accounting::journal_entries::{account_move, account_move_line, AccountMove};
use crate::accounting::payments::{
    account_payment, create_payment, post_payment, CreatePaymentParams,
};
use crate::core::reference::{currency, Currency};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{AccountInternalGroup, JournalType, PartnerType, PaymentType};

use super::helpers::{create_balanced_customer_invoice, seed_bank_journal};

pub fn test_fx_revaluation_posts_balanced_move(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;
    let sek = if let Some(currency) = ctx
        .db
        .currency()
        .iter()
        .find(|currency| currency.organization_id == org_id && currency.code == "SEK")
    {
        currency
    } else {
        ctx.db.currency().insert(Currency {
            id: 0,
            organization_code_key: format!("{org_id}:SEK"),
            organization_id: org_id,
            code: "SEK".to_string(),
            name: "Swedish Krona".to_string(),
            symbol: "kr".to_string(),
            decimal_places: 2,
            rounding_factor: 0.01,
            active: true,
            position: "after".to_string(),
            created_at: ctx.timestamp,
            metadata: Some("{\"fixture\":\"ACC-RI-005\"}".to_string()),
        })
    };
    let sek_currency_id = sek.id;

    let ar_id = *fixture
        .chart_account_ids
        .get(chart_keys::AR)
        .ok_or("Harness missing AR account")?;
    let gain_id = *fixture
        .chart_account_ids
        .get(chart_keys::REVENUE)
        .ok_or("Harness missing revenue account")?;
    create_account_account_type(
        ctx,
        org_id,
        CreateAccountAccountTypeParams {
            name: format!("FX expense {company_id}"),
            type_: "expense".to_string(),
            internal_group: AccountInternalGroup::Expense,
            include_initial_balance: false,
            company_id: Some(company_id),
            metadata: None,
        },
    )?;
    let expense_type_id = ctx
        .db
        .account_account_type()
        .iter()
        .find(|account_type| {
            account_type.company_id == Some(company_id)
                && account_type.internal_group == AccountInternalGroup::Expense
        })
        .map(|account_type| account_type.id)
        .ok_or("FX expense account type not found")?;
    let expense_code = format!("FXL{company_id}");
    create_account_account(
        ctx,
        org_id,
        CreateAccountAccountParams {
            company_id: Some(company_id),
            code: expense_code.clone(),
            name: "Unrealized FX loss".to_string(),
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
    let loss_id = ctx
        .db
        .account_account()
        .iter()
        .find(|account| account.company_id == company_id && account.code == expense_code)
        .map(|account| account.id)
        .ok_or("FX expense account not found")?;

    let journal_code = format!("FX{}", company_id);
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
                name: "FX Revaluation".to_string(),
                code: journal_code,
                type_: JournalType::General,
                currency_id: Some(1),
                default_account_id: None,
                suspense_account_id: None,
                loss_account_id: Some(loss_id),
                profit_account_id: Some(gain_id),
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
                at_least_one_inbound: false,
                at_least_one_outbound: false,
                dedicated_payment_method_ids: vec![],
                sale_activity_done: false,
                metadata: None,
            },
        )?;
        ctx.db
            .account_journal()
            .iter()
            .find(|j| j.organization_id == org_id && j.company_id == company_id)
            .map(|j| j.id)
            .ok_or("FX journal not found after create")?
    };

    let params = RunFxRevaluationParams {
        idempotency_key: format!("fx-revaluation-{company_id}"),
        currency_id: sek_currency_id,
        as_of_date: ctx.timestamp,
        rate: 1.087_321,
        rate_source: "ECB-test-fixture".to_string(),
        rate_effective_date: ctx.timestamp,
        journal_id,
        gain_account_id: gain_id,
        loss_account_id: loss_id,
        lines: vec![FxRevaluationLineParams {
            account_id: ar_id,
            adjustment: 125.0,
        }],
        reference: Some("A10-smoke".to_string()),
        metadata: None,
    };

    let mut company_currency_params = params.clone();
    company_currency_params.currency_id = 1;
    if run_fx_revaluation(ctx, org_id, company_id, company_currency_params).is_ok() {
        return Err("FX revaluation accepted the company currency as foreign currency".to_string());
    }
    if ctx
        .db
        .fx_revaluation_run()
        .fx_reval_by_company()
        .filter(&company_id)
        .any(|run| run.reference.as_deref() == Some("A10-smoke"))
    {
        return Err("Rejected FX revaluation persisted a run".to_string());
    }
    let mut missing_currency_params = params.clone();
    missing_currency_params.currency_id = 999_999;
    if run_fx_revaluation(ctx, org_id, company_id, missing_currency_params).is_ok() {
        return Err("FX revaluation accepted a missing persisted currency reference".to_string());
    }

    run_fx_revaluation(ctx, org_id, company_id, params.clone())?;

    let run = ctx
        .db
        .fx_revaluation_run()
        .fx_reval_by_company()
        .filter(&company_id)
        .find(|r| r.reference.as_deref() == Some("A10-smoke"))
        .ok_or("FX revaluation run not recorded")?;
    let run_count = ctx
        .db
        .fx_revaluation_run()
        .fx_reval_by_company()
        .filter(&company_id)
        .filter(|row| row.reference.as_deref() == Some("A10-smoke"))
        .count();
    let move_count = ctx
        .db
        .account_move()
        .iter()
        .filter(|row| row.organization_id == org_id && row.ref_.as_deref() == Some("A10-smoke"))
        .count();

    run_fx_revaluation(ctx, org_id, company_id, params.clone())?;
    let replayed_run_count = ctx
        .db
        .fx_revaluation_run()
        .fx_reval_by_company()
        .filter(&company_id)
        .filter(|row| row.reference.as_deref() == Some("A10-smoke"))
        .count();
    let replayed_move_count = ctx
        .db
        .account_move()
        .iter()
        .filter(|row| row.organization_id == org_id && row.ref_.as_deref() == Some("A10-smoke"))
        .count();
    if run_count != 1
        || move_count != 1
        || replayed_run_count != run_count
        || replayed_move_count != move_count
    {
        return Err("FX revaluation retry duplicated a run or journal entry".to_string());
    }

    let mut changed_payload = params;
    changed_payload.rate = 1.099_999;
    if run_fx_revaluation(ctx, org_id, company_id, changed_payload).is_ok() {
        return Err("FX revaluation accepted a changed payload under a reused key".to_string());
    }

    if (run.net_adjustment - 125.0).abs() > 0.001 {
        return Err(format!(
            "Expected net adjustment 125, got {}",
            run.net_adjustment
        ));
    }
    if run.currency_id != sek_currency_id
        || run.currency_code_snapshot != "SEK"
        || run.company_currency_id == run.currency_id
        || (run.rate - 1.087_321).abs() > 0.000_001
        || run.rate_source != "ECB-test-fixture"
    {
        return Err("FX currency or rate provenance was not persisted".to_string());
    }
    let posted_move = ctx
        .db
        .account_move()
        .id()
        .find(&run.move_id)
        .ok_or("FX move not found")?;
    if posted_move.currency_id != run.currency_id
        || posted_move.company_currency_id != run.company_currency_id
    {
        return Err("FX move currencies do not match the validated run".to_string());
    }

    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&run.move_id)
        .collect();

    if lines.len() != 2 {
        return Err(format!("Expected 2 move lines, got {}", lines.len()));
    }
    if lines.iter().any(|line| {
        line.currency_id != run.currency_id || line.company_currency_id != run.company_currency_id
    }) {
        return Err("FX line currencies do not match the validated run".to_string());
    }

    let total_debit: f64 = lines.iter().map(|l| l.debit).sum();
    let total_credit: f64 = lines.iter().map(|l| l.credit).sum();
    if (total_debit - total_credit).abs() > 0.01 {
        return Err(format!(
            "FX move not balanced: debit={total_debit} credit={total_credit}"
        ));
    }

    let foreign_invoice_id = create_balanced_customer_invoice(ctx, &fixture, 200.0, true)?;
    let foreign_invoice = ctx
        .db
        .account_move()
        .id()
        .find(&foreign_invoice_id)
        .ok_or("foreign invoice fixture missing")?;
    ctx.db.account_move().id().update(AccountMove {
        currency_id: sek_currency_id,
        company_currency_id: 1,
        ..foreign_invoice
    });

    let batch_params = RunFxRevaluationBatchParams {
        idempotency_key: format!("fx-revaluation-batch-{company_id}"),
        currency_id: sek_currency_id,
        as_of_date: ctx.timestamp,
        journal_id,
        gain_account_id: gain_id,
        loss_account_id: loss_id,
        rate: 1.25,
        rate_source: "ECB-batch-test".to_string(),
        rate_effective_date: ctx.timestamp,
        reference: Some("A10-batch".to_string()),
        metadata: None,
    };
    run_fx_revaluation_batch(ctx, org_id, company_id, batch_params.clone())?;
    run_fx_revaluation_batch(ctx, org_id, company_id, batch_params.clone())?;
    if ctx
        .db
        .fx_revaluation_run()
        .fx_reval_by_company()
        .filter(&company_id)
        .filter(|row| row.reference.as_deref() == Some("A10-batch"))
        .count()
        != 1
    {
        return Err("FX batch retry duplicated its revaluation run".to_string());
    }
    let mut changed_batch = batch_params;
    changed_batch.rate = 1.3;
    if run_fx_revaluation_batch(ctx, org_id, company_id, changed_batch).is_ok() {
        return Err("FX batch accepted a changed payload under a reused key".to_string());
    }

    let (bank_journal_id, _) = seed_bank_journal(ctx, &fixture)?;
    let bank_journal = ctx
        .db
        .account_journal()
        .id()
        .find(&bank_journal_id)
        .ok_or("FX payment bank journal missing")?;
    ctx.db.account_journal().id().update(AccountJournal {
        currency_id: Some(sek_currency_id),
        ..bank_journal
    });
    create_payment(
        ctx,
        org_id,
        CreatePaymentParams {
            idempotency_key: format!("fx-realized-payment-{company_id}"),
            company_id,
            payment_type: PaymentType::InBound,
            partner_type: PartnerType::Customer,
            partner_id: fixture.partner_id,
            amount: 205.0,
            currency_id: sek_currency_id,
            date: Some(ctx.timestamp),
            journal_id: bank_journal_id,
            ref_: Some("A10-realized-payment".to_string()),
            memo: None,
        },
    )?;
    let payment_id = ctx
        .db
        .account_payment()
        .iter()
        .find(|payment| {
            payment.organization_id == org_id
                && payment.ref_.as_deref() == Some("A10-realized-payment")
        })
        .map(|payment| payment.id)
        .ok_or("realized FX payment fixture missing")?;
    post_payment(ctx, org_id, payment_id)?;

    let realized_params = PostRealizedFxParams {
        idempotency_key: format!("fx-realized-{company_id}"),
        payment_id,
        invoice_move_id: foreign_invoice_id,
        payment_amount_functional: 205.0,
        invoice_residual_functional: 200.0,
        journal_id,
        gain_account_id: gain_id,
        loss_account_id: loss_id,
        clearing_account_id: ar_id,
        date: ctx.timestamp,
        reference: Some("A10-realized".to_string()),
        metadata: None,
    };
    post_realized_fx_gain_loss(ctx, org_id, company_id, realized_params.clone())?;
    post_realized_fx_gain_loss(ctx, org_id, company_id, realized_params.clone())?;
    if ctx
        .db
        .account_move()
        .iter()
        .filter(|row| row.organization_id == org_id && row.ref_.as_deref() == Some("A10-realized"))
        .count()
        != 1
    {
        return Err("realized FX retry duplicated its journal entry".to_string());
    }
    let mut changed_realized = realized_params;
    changed_realized.payment_amount_functional = 206.0;
    if post_realized_fx_gain_loss(ctx, org_id, company_id, changed_realized).is_ok() {
        return Err("realized FX accepted a changed payload under a reused key".to_string());
    }

    Ok(())
}
