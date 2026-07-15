//! FX revaluation smoke test (A10).
use spacetimedb::{ReducerContext, Table};

use crate::accounting::chart_of_accounts::{
    account_journal, create_account_journal, CreateAccountJournalParams,
};
use crate::accounting::fx_revaluation::{
    fx_revaluation_run, run_fx_revaluation, FxRevaluationLineParams, RunFxRevaluationParams,
};
use crate::accounting::journal_entries::account_move_line;
use crate::test_harness::{chart_keys, ensure_test_superuser, OrgFixture};
use crate::types::JournalType;

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
    let loss_id = *fixture
        .chart_account_ids
        .get(chart_keys::AP)
        .ok_or("Harness missing AP account")?;

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

    run_fx_revaluation(
        ctx,
        org_id,
        company_id,
        RunFxRevaluationParams {
            currency_code: "EUR".to_string(),
            as_of_date: ctx.timestamp,
            journal_id,
            gain_account_id: gain_id,
            loss_account_id: loss_id,
            lines: vec![FxRevaluationLineParams {
                account_id: ar_id,
                adjustment: 125.0,
            }],
            reference: Some("A10-smoke".to_string()),
            metadata: None,
        },
    )?;

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

    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&run.move_id)
        .collect();

    if lines.len() != 2 {
        return Err(format!("Expected 2 move lines, got {}", lines.len()));
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
