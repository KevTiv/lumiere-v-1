//! Native settlement of a source-bound operational payment.
use spacetimedb::{ReducerContext, Table};

use crate::accounting::bank_reconciliation::{
    account_bank_statement, account_bank_statement_line, create_account_bank_statement,
    create_account_bank_statement_line, delete_account_bank_statement_line,
    post_account_bank_statement, reconcile_account_bank_statement_line, AccountBankStatement,
    CreateAccountBankStatementLineParams, CreateAccountBankStatementParams,
    ReconcileAccountBankStatementLineParams,
};
use crate::accounting::bank_transaction_settlement::{
    settle_bank_line_with_payment_transaction, SettleBankLineWithPaymentTransactionParams,
};
use crate::accounting::fiscal_periods::{account_period, AccountPeriod};
use crate::accounting::journal_entries::{account_move_line, AccountMoveLine};
use crate::accounting::payment_management::{
    allocate_payment_transaction, create_payment_account, create_payment_transaction,
    payment_account, payment_reconciliation, payment_reversal, payment_transaction,
    post_payment_transaction, reverse_payment_transaction, AllocatePaymentParams,
    CreatePaymentAccountParams, CreatePaymentTransactionParams, ReversePaymentTransactionParams,
};
use crate::accounting::payments::account_payment;
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::{
    BankStatementState, PartnerType, PaymentDirection, PaymentProviderCode, PaymentState,
    PaymentTransactionStatus, PeriodState,
};

use super::helpers::{
    create_balanced_customer_invoice, create_balanced_customer_invoice_on_account,
    seed_bank_journal, seed_distinctive_ar_account, seed_sibling_company,
};

pub fn test_posted_operational_bank_matches(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let company = fixture.company_id;
    let currency = fixture.currency_id;
    let (journal_id, _) = seed_bank_journal(ctx, &fixture)?;
    let sibling = seed_sibling_company(ctx, &fixture)?;
    let create_statement = |name: &str| -> Result<u64, String> {
        create_account_bank_statement(
            ctx,
            org,
            company,
            journal_id,
            CreateAccountBankStatementParams {
                name: Some(name.to_string()),
                reference: None,
                date: Some(ctx.timestamp),
                balance_start: 0.0,
                currency_id: currency,
                metadata: None,
            },
        )?;
        ctx.db
            .account_bank_statement()
            .bank_statement_by_org()
            .filter(&org)
            .find(|row| row.name.as_deref() == Some(name))
            .map(|row| row.id)
            .ok_or_else(|| "bank statement missing".to_string())
    };
    let statement_id = create_statement("Operational settlement")?;
    let unrelated_statement_id = create_statement("Unrelated statement")?;
    create_payment_account(
        ctx,
        org,
        CreatePaymentAccountParams {
            company_id: company,
            provider_code: PaymentProviderCode::Bank,
            name: "Operational settlement account".to_string(),
            provider_label: None,
            reference_raw: None,
            currency_id: currency,
            account_journal_id: journal_id,
            fee_account_id: None,
            clearing_account_id: None,
            is_primary: false,
            metadata: None,
        },
    )?;
    let account = ctx
        .db
        .payment_account()
        .payment_account_by_journal()
        .filter(&journal_id)
        .find(|row| row.organization_id == org)
        .ok_or("operational payment account missing")?;
    let receivable = |move_id| -> Result<AccountMoveLine, String> {
        ctx.db
            .account_move_line()
            .move_line_by_move()
            .filter(&move_id)
            .find(|row| {
                row.account_internal_type
                    .as_deref()
                    .is_some_and(|value| value.eq_ignore_ascii_case("receivable"))
            })
            .ok_or_else(|| "receivable item missing".to_string())
    };
    let create_bank_line = |amount: f64, statement_id: u64| -> Result<u64, String> {
        create_account_bank_statement_line(
            ctx,
            org,
            company,
            statement_id,
            CreateAccountBankStatementLineParams {
                date: ctx.timestamp,
                amount,
                amount_currency: amount,
                currency_id: Some(currency),
                foreign_currency_id: None,
                partner_id: Some(fixture.partner_id),
                bank_account_id: None,
                account_number: None,
                move_id: None,
                is_reconciled: false,
                transaction_type: None,
                move_ids: vec![],
                payment_ids: vec![],
                amount_residual: amount,
                auto_reconcile_ids: vec![],
                metadata: None,
            },
        )?;
        ctx.db
            .account_bank_statement_line()
            .statement_line_by_statement()
            .filter(&statement_id)
            .map(|row| row.id)
            .max()
            .ok_or_else(|| "bank line missing".to_string())
    };
    let create_transaction = |line_id: u64, amount: f64, reference: &str| -> Result<u64, String> {
        create_payment_transaction(
            ctx,
            org,
            CreatePaymentTransactionParams {
                company_id: company,
                payment_account_id: account.id,
                direction: PaymentDirection::Inbound,
                partner_type: PartnerType::Customer,
                partner_id: fixture.partner_id,
                external_reference: Some(reference.to_string()),
                gross_external_amount: amount,
                settlement_amount: amount,
                net_account_amount: amount,
                currency_id: currency,
                occurred_at: Some(ctx.timestamp),
                source_entity: Some("account_bank_statement_line".to_string()),
                source_entity_id: Some(line_id),
                evidence_document_ids: vec![],
                metadata: None,
            },
        )?;
        ctx.db
            .payment_transaction()
            .payment_transaction_by_company()
            .filter(&company)
            .find(|row| row.external_reference.as_deref() == Some(reference))
            .map(|row| row.id)
            .ok_or_else(|| "operational payment transaction missing".to_string())
    };

    for (bank, open, applied) in [(60.0, 100.0, 60.0), (100.0, 60.0, 60.0)] {
        let line_id = create_bank_line(bank, statement_id)?;
        let invoice = create_balanced_customer_invoice(ctx, &fixture, open, true)?;
        let target = receivable(invoice)?;
        let transaction_id = create_transaction(line_id, bank, &format!("bank-match-{line_id}"))?;
        post_payment_transaction(ctx, org, transaction_id)?;
        let posted = ctx
            .db
            .payment_transaction()
            .id()
            .find(&transaction_id)
            .ok_or("posted operational transaction missing")?;
        if posted.status != PaymentTransactionStatus::Posted {
            return Err("operational transaction did not post".to_string());
        }
        if delete_account_bank_statement_line(ctx, org, company, line_id).is_ok()
            || post_account_bank_statement(ctx, org, company, statement_id).is_ok()
        {
            return Err("a posted source payment lost its pending bank line".to_string());
        }
        let payment_id = posted
            .account_payment_id
            .ok_or("posted ledger payment missing")?;
        let payment = ctx
            .db
            .account_payment()
            .id()
            .find(&payment_id)
            .ok_or("ledger payment missing")?;
        let ledger_move = payment.move_id.ok_or("payment ledger move missing")?;
        let alloc = |target_id, amount| AllocatePaymentParams {
            idempotency_key: format!("operational-bank-allocation:{transaction_id}:{target_id}"),
            company_id: company,
            payment_transaction_id: transaction_id,
            allocated_move_line_id: target_id,
            allocated_amount: amount,
            currency_id: currency,
            write_off_amount: 0.0,
            write_off_account_id: None,
            metadata: None,
        };
        let reviewed = || SettleBankLineWithPaymentTransactionParams {
            statement_id,
            payment_transaction_id: transaction_id,
            move_line_id: target.id,
            currency_id: currency,
            bank_amount: bank,
            open_amount: open,
            allocated_amount: applied,
            idempotency_key: format!(
                "bank-transaction:{statement_id}:{line_id}:{transaction_id}:{}",
                target.id
            ),
        };
        let duplicate =
            create_transaction(line_id, bank, &format!("duplicate-bank-match-{line_id}"))?;
        if post_payment_transaction(ctx, org, duplicate).is_ok()
            || allocate_payment_transaction(ctx, org, alloc(target.id, applied)).is_ok()
            || reconcile_account_bank_statement_line(
                ctx,
                org,
                company,
                line_id,
                ReconcileAccountBankStatementLineParams {
                    move_ids: vec![target.id],
                    amount_residual: 0.0,
                },
            )
            .is_ok()
        {
            return Err("a parallel payment or allocation bypassed the bank source".to_string());
        }
        if settle_bank_line_with_payment_transaction(ctx, org, sibling, line_id, reviewed()).is_ok()
            || settle_bank_line_with_payment_transaction(
                ctx,
                org,
                company,
                line_id,
                SettleBankLineWithPaymentTransactionParams {
                    statement_id: unrelated_statement_id,
                    ..reviewed()
                },
            )
            .is_ok()
            || settle_bank_line_with_payment_transaction(
                ctx,
                org,
                company,
                line_id,
                SettleBankLineWithPaymentTransactionParams {
                    bank_amount: bank + 1.0,
                    ..reviewed()
                },
            )
            .is_ok()
            || settle_bank_line_with_payment_transaction(
                ctx,
                org,
                company,
                line_id,
                SettleBankLineWithPaymentTransactionParams {
                    open_amount: open + 1.0,
                    ..reviewed()
                },
            )
            .is_ok()
            || receivable(invoice)?.amount_residual != open
            || ctx
                .db
                .payment_reconciliation()
                .reconciliation_by_transaction()
                .filter(&transaction_id)
                .next()
                .is_some()
        {
            return Err("invalid settlement changed the reviewed financial records".to_string());
        }

        // Older versions allowed generic source labels on posted transactions.
        let legacy_duplicate = ctx
            .db
            .payment_transaction()
            .id()
            .find(&duplicate)
            .ok_or("duplicate draft missing")?;
        ctx.db.payment_transaction().id().update(
            crate::accounting::payment_management::PaymentTransaction {
                status: PaymentTransactionStatus::Posted,
                ..legacy_duplicate
            },
        );
        if settle_bank_line_with_payment_transaction(ctx, org, company, line_id, reviewed()).is_ok()
        {
            return Err("ambiguous legacy source links matched a bank line".to_string());
        }
        let legacy_duplicate = ctx
            .db
            .payment_transaction()
            .id()
            .find(&duplicate)
            .ok_or("legacy duplicate missing")?;
        ctx.db.payment_transaction().id().update(
            crate::accounting::payment_management::PaymentTransaction {
                status: PaymentTransactionStatus::Draft,
                ..legacy_duplicate
            },
        );
        settle_bank_line_with_payment_transaction(ctx, org, company, line_id, reviewed())?;
        settle_bank_line_with_payment_transaction(ctx, org, company, line_id, reviewed())?;
        let committed = ctx
            .db
            .account_bank_statement_line()
            .id()
            .find(&line_id)
            .ok_or("matched bank line missing")?;
        let clearing = receivable(ledger_move)?;
        if !committed.is_reconciled
            || committed.amount_residual != 0.0
            || committed.move_id != Some(ledger_move)
            || committed.payment_ids != [payment_id]
            || committed.move_ids != [target.id]
            || receivable(invoice)?.amount_residual != open - applied
            || clearing.amount_residual != bank - applied
            || ctx
                .db
                .payment_reconciliation()
                .reconciliation_by_transaction()
                .filter(&transaction_id)
                .count()
                != 1
        {
            return Err("bank match, remaining balance, unapplied credit, or exact replay differed from review".to_string());
        }
        let different_line = create_bank_line(bank, unrelated_statement_id)?;
        if settle_bank_line_with_payment_transaction(
            ctx,
            org,
            company,
            different_line,
            SettleBankLineWithPaymentTransactionParams {
                statement_id: unrelated_statement_id,
                ..reviewed()
            },
        )
        .is_ok()
        {
            return Err("one transaction matched multiple bank lines".to_string());
        }
        let next_invoice = create_balanced_customer_invoice(ctx, &fixture, 80.0, true)?;
        let next_item = receivable(next_invoice)?;
        let credit = bank - applied;
        if credit > 0.0 {
            super::payments_test::assert_bank_company_denial(
                ctx,
                org,
                sibling,
                "bank credit company access",
                || allocate_payment_transaction(ctx, org, alloc(next_item.id, credit)),
            )?;
            let unrelated_ar = seed_distinctive_ar_account(ctx, &fixture)?;
            let unrelated_invoice = create_balanced_customer_invoice_on_account(
                ctx,
                &fixture,
                80.0,
                unrelated_ar,
                "unrelated-ar",
                true,
            )?;
            let unrelated_item = receivable(unrelated_invoice)?;
            if allocate_payment_transaction(ctx, org, alloc(unrelated_item.id, credit)).is_ok()
                || receivable(unrelated_invoice)?.amount_residual != 80.0
            {
                return Err("bank credit crossed receivable accounts".to_string());
            }
            allocate_payment_transaction(ctx, org, alloc(next_item.id, credit))?;
            if receivable(next_invoice)?.amount_residual != 80.0 - credit
                || receivable(ledger_move)?.amount_residual != 0.0
            {
                return Err("verified excess credit could not be applied later".to_string());
            }
        } else if allocate_payment_transaction(ctx, org, alloc(next_item.id, 1.0)).is_ok() {
            return Err("fully allocated payment supplied additional credit".to_string());
        }
        settle_bank_line_with_payment_transaction(ctx, org, company, line_id, reviewed())?;
        let reversal = || ReversePaymentTransactionParams {
            company_id: company,
            reason: Some("correct bank match".to_string()),
            metadata: None,
        };
        super::payments_test::assert_bank_company_denial(
            ctx,
            org,
            sibling,
            "bank reversal company access",
            || reverse_payment_transaction(ctx, org, transaction_id, reversal()),
        )?;
        let period = ctx
            .db
            .account_period()
            .period_by_fiscal_year()
            .filter(&fixture.fiscal_year_id)
            .find(|row| row.date_from <= ctx.timestamp && ctx.timestamp <= row.date_to)
            .ok_or("reversal period missing")?;
        let period_id = period.id;
        ctx.db.account_period().id().update(AccountPeriod {
            state: PeriodState::Closed,
            ..period
        });
        if reverse_payment_transaction(ctx, org, transaction_id, reversal()).is_ok() {
            return Err("bank reversal posted into a closed period".to_string());
        }
        let period = ctx
            .db
            .account_period()
            .id()
            .find(&period_id)
            .ok_or("closed period missing")?;
        ctx.db.account_period().id().update(AccountPeriod {
            state: PeriodState::Open,
            ..period
        });
        let statement = ctx
            .db
            .account_bank_statement()
            .id()
            .find(&statement_id)
            .ok_or("bank statement missing")?;
        ctx.db
            .account_bank_statement()
            .id()
            .update(AccountBankStatement {
                state: BankStatementState::Posted,
                ..statement
            });
        if reverse_payment_transaction(ctx, org, transaction_id, reversal()).is_ok() {
            return Err("bank reversal changed a posted statement".to_string());
        }
        let statement = ctx
            .db
            .account_bank_statement()
            .id()
            .find(&statement_id)
            .ok_or("posted statement missing")?;
        ctx.db
            .account_bank_statement()
            .id()
            .update(AccountBankStatement {
                state: BankStatementState::Open,
                ..statement
            });
        reverse_payment_transaction(ctx, org, transaction_id, reversal())?;
        reverse_payment_transaction(ctx, org, transaction_id, reversal())?;
        let reopened = ctx
            .db
            .account_bank_statement_line()
            .id()
            .find(&line_id)
            .ok_or("reopened bank line missing")?;
        let original = ctx
            .db
            .account_payment()
            .id()
            .find(&payment_id)
            .ok_or("reversed payment missing")?;
        let correction = ctx
            .db
            .payment_reversal()
            .reversal_by_original()
            .filter(&transaction_id)
            .next()
            .ok_or("compensating payment missing")?;
        let reversing_payment = ctx
            .db
            .account_payment()
            .id()
            .find(&correction.correcting_account_payment_id)
            .ok_or("compensating ledger payment missing")?;
        if reopened.is_reconciled
            || reopened.move_id.is_some()
            || !reopened.move_ids.is_empty()
            || !reopened.payment_ids.is_empty()
            || reopened.amount_residual != bank
            || original.state != PaymentState::Reversed
            || original.reversal_move_id != reversing_payment.move_id
            || receivable(invoice)?.amount_residual != open
            || receivable(next_invoice)?.amount_residual != 80.0
            || receivable(ledger_move)?.amount_residual != 0.0
            || ctx
                .db
                .payment_reversal()
                .reversal_by_original()
                .filter(&transaction_id)
                .count()
                != 1
        {
            return Err(
                "bank reversal or replay did not restore exact original balances".to_string(),
            );
        }
        let replacement = create_transaction(line_id, bank, &format!("bank-match-{line_id}"))?;
        if replacement == transaction_id {
            return Err("bank reversal did not release the original source reference".to_string());
        }
    }
    Ok(())
}
