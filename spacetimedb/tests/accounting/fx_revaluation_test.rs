//! FX revaluation smoke test (A10).
use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_account, account_account_type, account_journal, create_account_account,
    create_account_account_type, create_account_journal, CreateAccountAccountParams,
    CreateAccountAccountTypeParams, CreateAccountJournalParams,
};
use crate::accounting::fx_revaluation::{
    fx_revaluation_run, run_fx_revaluation, FxRevaluationLineParams, RunFxRevaluationParams,
};
use crate::accounting::journal_entries::{account_move, account_move_line};
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::{AccountInternalGroup, JournalType};

pub fn test_fx_revaluation_posts_balanced_move(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org_id = fixture.organization_id;
    let company_id = fixture.company_id;

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
        currency_id: 2,
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

    run_fx_revaluation(ctx, org_id, company_id, params)?;

    let run = ctx
        .db
        .fx_revaluation_run()
        .fx_reval_by_company()
        .filter(&company_id)
        .find(|r| r.reference.as_deref() == Some("A10-smoke"))
        .ok_or("FX revaluation run not recorded")?;

    if (run.net_adjustment - 125.0).abs() > 0.001 {
        return Err(format!(
            "Expected net adjustment 125, got {}",
            run.net_adjustment
        ));
    }
    if run.currency_id != 2
        || run.currency_code != "EUR"
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

    Ok(())
}
