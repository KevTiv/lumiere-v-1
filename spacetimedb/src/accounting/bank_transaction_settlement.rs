//! Match a bank line to a previously posted operational transaction and apply
//! the reviewed amount to one obligation in the same reducer transaction.

use spacetimedb::{ReducerContext, SpacetimeType, Table};

use super::bank_reconciliation::{
    account_bank_statement, account_bank_statement_line, AccountBankStatementLine,
};
use super::idempotency::{accounting_operation_receipt, record_result, replayed_result};
use super::journal_entries::{account_move, account_move_line, is_receivable_or_payable_line_type};
use super::money::pilot_money_minor_units;
use super::payment_management::{
    allocate_payment_transaction_impl, payment_account, payment_fee, payment_reconciliation,
    payment_transaction, AllocatePaymentParams, PaymentAccount, PaymentTransaction,
};
use super::payments::{account_payment, resolve_payment_liquidity_account};
use super::relations::{
    require_active_account, require_active_currency_id, require_active_journal,
};
use crate::core::business_changes::write_business_audit;
use crate::core::organization::company;
use crate::helpers::{check_permission, AuditLogParams};
use crate::types::{
    AccountMoveState, BankStatementState, JournalType, MoveType, PartnerType, PaymentDirection,
    PaymentState, PaymentTransactionStatus, PaymentType,
};
use crate::workflow::authorization::require_workflow_company_access;

const ACTION: &str = "settle_bank_line_with_payment_transaction";
pub(super) const BANK_SOURCE: &str = "account_bank_statement_line";

#[derive(SpacetimeType, Debug)]
pub struct SettleBankLineWithPaymentTransactionParams {
    pub statement_id: u64,
    pub payment_transaction_id: u64,
    pub move_line_id: u64,
    pub currency_id: u64,
    pub bank_amount: f64,
    pub open_amount: f64,
    pub allocated_amount: f64,
    pub idempotency_key: String,
}

fn amounts(bank: i64, open: i64, allocated: i64) -> Result<(i64, i64), String> {
    if bank == 0
        || bank.signum() != open.signum()
        || bank == open
        || allocated != bank.abs().min(open.abs())
    {
        return Err(
            "reviewed allocation must be the smaller of the bank amount and selected open balance"
                .to_string(),
        );
    }
    Ok((open.abs() - allocated, bank.abs() - allocated))
}

/// A source-linked operational payment must still match the open bank line
/// when it actually posts, including when posting resumes after approval.
pub(super) fn validate_bank_transaction_posting(
    ctx: &ReducerContext,
    transaction: &PaymentTransaction,
    account: &PaymentAccount,
) -> Result<(), String> {
    if transaction.source_entity.as_deref() != Some(BANK_SOURCE) {
        return Ok(());
    }
    require_workflow_company_access(
        ctx,
        transaction.organization_id,
        transaction.company_id,
        ctx.sender(),
    )?;
    require_fee_free_transaction(ctx, transaction.id)?;
    let line_id = transaction
        .source_entity_id
        .ok_or("bank source line is required")?;
    let line = ctx
        .db
        .account_bank_statement_line()
        .id()
        .find(&line_id)
        .ok_or("bank source line is unavailable")?;
    let statement = ctx
        .db
        .account_bank_statement()
        .id()
        .find(&line.statement_id)
        .ok_or("bank source statement is unavailable")?;
    let organization_id = transaction.organization_id;
    let company_id = transaction.company_id;
    let company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("company is unavailable")?;
    let currency = require_active_currency_id(ctx, transaction.currency_id, "bank payment")?;
    let journal = require_active_journal(
        ctx,
        organization_id,
        company_id,
        statement.journal_id,
        "bank payment",
    )?;
    let minor = |amount| pilot_money_minor_units(amount, currency.decimal_places);
    let bank = minor(line.amount)?;
    let (direction, partner_type) = if bank > 0 {
        (PaymentDirection::Inbound, PartnerType::Customer)
    } else {
        (PaymentDirection::Outbound, PartnerType::Supplier)
    };
    if bank == 0
        || statement.organization_id != organization_id
        || statement.company_id != company_id
        || line.organization_id != organization_id
        || statement.state != BankStatementState::Open
        || line.is_reconciled
        || line.move_id.is_some()
        || !line.move_ids.is_empty()
        || !line.payment_ids.is_empty()
        || line.journal_id != journal.id
        || journal.type_ != JournalType::Bank
        || statement.currency_id != currency.id
        || company.currency_id != currency.id
        || currency.organization_id != organization_id
        || currency.rounding_factor != 10_f64.powi(-i32::from(currency.decimal_places))
        || journal.currency_id.is_some_and(|id| id != currency.id)
        || line.journal_currency_id != currency.id
        || line.currency_id.is_some_and(|id| id != currency.id)
        || line.foreign_currency_id.is_some()
        || account.organization_id != organization_id
        || account.company_id != company_id
        || account.account_journal_id != journal.id
        || account.currency_id != currency.id
        || !account.active
        || account.archived_at.is_some()
        || transaction
            .external_reference
            .as_deref()
            .is_none_or(|reference| reference.trim().is_empty())
        || transaction.direction != direction
        || transaction.partner_type != partner_type
        || line
            .partner_id
            .is_some_and(|id| id != transaction.partner_id)
        || minor(transaction.gross_external_amount)? != bank.abs()
        || minor(transaction.settlement_amount)? != bank.abs()
        || minor(transaction.net_account_amount)? != bank.abs()
    {
        return Err("the transaction must match the open bank line's amount, journal, currency and direction".to_string());
    }
    if has_posted_bank_transaction(
        ctx,
        organization_id,
        company_id,
        line_id,
        Some(transaction.id),
    ) {
        return Err("another posted payment already represents this bank line".to_string());
    }
    Ok(())
}

fn require_fee_free_transaction(ctx: &ReducerContext, transaction_id: u64) -> Result<(), String> {
    if ctx
        .db
        .payment_fee()
        .payment_fee_by_transaction()
        .filter(&transaction_id)
        .any(|fee| fee.amount != 0.0 || fee.tax_amount != 0.0)
    {
        return Err(
            "bank settlement requires a transaction with zero fees and fee tax".to_string(),
        );
    }
    Ok(())
}

pub(super) fn has_posted_bank_transaction(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    line_id: u64,
    excluded_transaction_id: Option<u64>,
) -> bool {
    ctx.db
        .payment_transaction()
        .payment_transaction_by_company()
        .filter(&company_id)
        .any(|other| {
            Some(other.id) != excluded_transaction_id
                && other.organization_id == organization_id
                && other.source_entity.as_deref() == Some(BANK_SOURCE)
                && other.source_entity_id == Some(line_id)
                && other.status == PaymentTransactionStatus::Posted
        })
}

fn settlement_key(
    statement_id: u64,
    line_id: u64,
    transaction_id: u64,
    move_line_id: u64,
) -> String {
    format!("bank-transaction:{statement_id}:{line_id}:{transaction_id}:{move_line_id}")
}

pub(super) fn is_operational_bank_match(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    line: &AccountBankStatementLine,
) -> bool {
    line.is_reconciled
        && ctx
            .db
            .payment_transaction()
            .payment_transaction_by_company()
            .filter(&company_id)
            .any(|transaction| {
                transaction.organization_id == organization_id
                    && transaction.status == PaymentTransactionStatus::Posted
                    && transaction.source_entity_id == Some(line.id)
                    && is_matched_bank_transaction(ctx, &transaction)
            })
}

/// A linked transaction can retain unapplied credit for a later allocation.
pub(super) fn is_matched_bank_transaction(
    ctx: &ReducerContext,
    transaction: &PaymentTransaction,
) -> bool {
    if transaction.source_entity.as_deref() != Some(BANK_SOURCE) {
        return false;
    }
    let (Some(line_id), Some(payment_id)) =
        (transaction.source_entity_id, transaction.account_payment_id)
    else {
        return false;
    };
    let Some(line) = ctx.db.account_bank_statement_line().id().find(&line_id) else {
        return false;
    };
    let [move_line_id] = line.move_ids.as_slice() else {
        return false;
    };
    let key = settlement_key(line.statement_id, line_id, transaction.id, *move_line_id);
    line.organization_id == transaction.organization_id
        && line.is_reconciled
        && line.payment_ids == [payment_id]
        && ctx
            .db
            .accounting_operation_receipt()
            .accounting_operation_receipt_by_scope()
            .filter((
                &transaction.organization_id,
                &transaction.company_id,
                &ACTION.to_string(),
            ))
            .any(|receipt| receipt.result_id == line_id && receipt.idempotency_key == key)
}

#[spacetimedb::reducer]
pub fn settle_bank_line_with_payment_transaction(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    line_id: u64,
    params: SettleBankLineWithPaymentTransactionParams,
) -> Result<(), String> {
    require_workflow_company_access(ctx, organization_id, company_id, ctx.sender())?;
    check_permission(ctx, organization_id, "account_bank_statement_line", "write")?;
    check_permission(ctx, organization_id, "payment_transaction", "read")?;
    check_permission(ctx, organization_id, "payment_reconciliation", "create")?;
    check_permission(ctx, organization_id, "account_move", "write")?;

    let statement = ctx
        .db
        .account_bank_statement()
        .id()
        .find(&params.statement_id)
        .ok_or("bank statement is unavailable")?;
    let line = ctx
        .db
        .account_bank_statement_line()
        .id()
        .find(&line_id)
        .ok_or("bank line is unavailable")?;
    let company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or("company is unavailable")?;
    let currency = require_active_currency_id(ctx, params.currency_id, "bank settlement")?;
    let journal = require_active_journal(
        ctx,
        organization_id,
        company_id,
        statement.journal_id,
        "bank settlement",
    )?;
    if statement.organization_id != organization_id
        || statement.company_id != company_id
        || line.organization_id != organization_id
        || line.statement_id != statement.id
        || line.journal_id != journal.id
        || journal.type_ != JournalType::Bank
        || statement.currency_id != currency.id
        || company.currency_id != currency.id
        || currency.organization_id != organization_id
        || currency.rounding_factor != 10_f64.powi(-i32::from(currency.decimal_places))
        || journal.currency_id.is_some_and(|id| id != currency.id)
        || line.journal_currency_id != currency.id
        || line.currency_id.is_some_and(|id| id != currency.id)
        || line.foreign_currency_id.is_some()
    {
        return Err(
            "bank line is outside the reviewed company, statement, journal or base currency"
                .to_string(),
        );
    }
    let minor = |amount| pilot_money_minor_units(amount, currency.decimal_places);
    let bank = minor(params.bank_amount)?;
    let open = minor(params.open_amount)?;
    let allocated = minor(params.allocated_amount)?;
    let (open_after, credit_after) = amounts(bank, open, allocated)?;
    if minor(line.amount)? != bank {
        return Err("the bank amount changed after review".to_string());
    }

    let transaction = ctx
        .db
        .payment_transaction()
        .id()
        .find(&params.payment_transaction_id)
        .ok_or("posted payment transaction is unavailable")?;
    require_fee_free_transaction(ctx, transaction.id)?;
    let payment_id = transaction
        .account_payment_id
        .ok_or("transaction has no posted ledger payment")?;
    let payment = ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("ledger payment is unavailable")?;
    let move_id = payment
        .move_id
        .ok_or("ledger payment has no journal entry")?;
    let payment_move = ctx
        .db
        .account_move()
        .id()
        .find(&move_id)
        .ok_or("payment journal entry is unavailable")?;
    let payment_account = ctx
        .db
        .payment_account()
        .id()
        .find(&transaction.payment_account_id)
        .ok_or("payment account is unavailable")?;
    let (direction, payment_type, partner_type, invoice_type) = if bank > 0 {
        (
            PaymentDirection::Inbound,
            PaymentType::InBound,
            PartnerType::Customer,
            MoveType::OutInvoice,
        )
    } else {
        (
            PaymentDirection::Outbound,
            PaymentType::OutBound,
            PartnerType::Supplier,
            MoveType::InInvoice,
        )
    };
    if transaction.organization_id != organization_id
        || transaction.company_id != company_id
        || transaction.source_entity.as_deref() != Some(BANK_SOURCE)
        || transaction.source_entity_id != Some(line.id)
        || transaction
            .external_reference
            .as_deref()
            .is_none_or(|reference| reference.trim().is_empty())
        || transaction.status != PaymentTransactionStatus::Posted
        || transaction.currency_id != currency.id
        || transaction.direction != direction
        || transaction.partner_type != partner_type
        || line
            .partner_id
            .is_some_and(|id| id != transaction.partner_id)
        || minor(transaction.net_account_amount)? != bank.abs()
        || minor(transaction.gross_external_amount)? != bank.abs()
        || minor(transaction.settlement_amount)? != bank.abs()
        || payment_account.organization_id != organization_id
        || payment_account.company_id != company_id
        || payment_account.account_journal_id != journal.id
        || payment_account.currency_id != currency.id
        || payment.organization_id != organization_id
        || payment.company_id != company_id
        || payment.journal_id != journal.id
        || payment.currency_id != currency.id
        || payment.partner_id != transaction.partner_id
        || payment.partner_type != partner_type
        || payment.payment_type != payment_type
        || minor(payment.amount)? != bank.abs()
        || payment.state != PaymentState::Paid
        || payment.reversal_move_id.is_some()
        || payment_move.organization_id != organization_id
        || payment_move.company_id != company_id
        || payment_move.journal_id != journal.id
        || payment_move.currency_id != currency.id
        || payment_move.company_currency_id != currency.id
        || payment_move.state != AccountMoveState::Posted
    {
        return Err("posted payment does not match the reviewed bank transaction".to_string());
    }

    if params.idempotency_key
        != settlement_key(statement.id, line.id, transaction.id, params.move_line_id)
    {
        return Err("the settlement key does not match the reviewed bank records".to_string());
    }
    let fingerprint = format!("{line_id}:{params:?}");
    if replayed_result(
        ctx,
        organization_id,
        company_id,
        ACTION,
        &params.idempotency_key,
        &fingerprint,
    )?
    .is_some()
    {
        return if line.is_reconciled
            && line.move_id == Some(move_id)
            && line.payment_ids == [payment_id]
            && line.move_ids == [params.move_line_id]
            && line.amount_residual == 0.0
        {
            Ok(())
        } else {
            Err("the recorded bank match is no longer current".to_string())
        };
    }
    if has_posted_bank_transaction(
        ctx,
        organization_id,
        company_id,
        line_id,
        Some(transaction.id),
    ) {
        return Err("more than one posted payment represents this bank line".to_string());
    }
    if statement.state != BankStatementState::Open
        || line.is_reconciled
        || line.move_id.is_some()
        || !line.move_ids.is_empty()
        || !line.payment_ids.is_empty()
        || !payment_account.active
        || payment_account.archived_at.is_some()
        || !payment.reconciled_invoice_ids.is_empty()
        || !payment.reconciled_bill_ids.is_empty()
        || ctx
            .db
            .payment_reconciliation()
            .reconciliation_by_transaction()
            .filter(&transaction.id)
            .next()
            .is_some()
        || ctx
            .db
            .account_bank_statement_line()
            .bank_statement_line_by_org()
            .filter(&organization_id)
            .any(|other| other.payment_ids.contains(&payment_id))
    {
        return Err("bank line or payment already has settlement activity".to_string());
    }
    let target = ctx
        .db
        .account_move_line()
        .id()
        .find(&params.move_line_id)
        .ok_or("reviewed invoice item is unavailable")?;
    let invoice = ctx
        .db
        .account_move()
        .id()
        .find(&target.move_id)
        .ok_or("invoice is unavailable")?;
    if invoice.move_type != invoice_type
        || invoice.company_currency_id != currency.id
        || target.company_currency_id != currency.id
        || target.parent_state != AccountMoveState::Posted
        || target.blocked
        || minor(target.amount_residual)? != open
        || minor(target.balance)?.signum() != bank.signum()
    {
        return Err("the reviewed invoice balance or direction changed".to_string());
    }
    let target_account = require_active_account(
        ctx,
        organization_id,
        company_id,
        target.account_id,
        "bank allocation",
    )?;
    if !target_account.reconcile {
        return Err("the selected invoice account does not allow reconciliation".to_string());
    }
    let liquidity_account = resolve_payment_liquidity_account(ctx, &payment)?;
    let move_lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_id)
        .collect();
    let liquidity = move_lines
        .iter()
        .find(|row| row.account_id == liquidity_account);
    let clearing = move_lines
        .iter()
        .find(|row| is_receivable_or_payable_line_type(row.account_internal_type.as_deref()));
    let (Some(liquidity), Some(clearing)) = (liquidity, clearing) else {
        return Err("payment entry does not have matching bank and clearing accounts".to_string());
    };
    if move_lines.len() != 2
        || liquidity.id == clearing.id
        || clearing.account_id != target.account_id
        || move_lines.iter().any(|row| {
            row.organization_id != organization_id
                || row.company_id != company_id
                || row.journal_id != journal.id
                || row.currency_id != currency.id
                || row.company_currency_id != currency.id
                || row.parent_state != AccountMoveState::Posted
                || row.partner_id != Some(transaction.partner_id)
        })
        || minor(liquidity.balance)? != bank
        || minor(clearing.balance)? != -bank
        || minor(clearing.amount_residual)? != bank.abs()
    {
        return Err(
            "payment entry does not have the reviewed bank and clearing amounts".to_string(),
        );
    }

    allocate_payment_transaction_impl(
        ctx,
        organization_id,
        AllocatePaymentParams {
            idempotency_key: format!("bank-transaction-settlement:{line_id}:{}", transaction.id),
            company_id,
            payment_transaction_id: transaction.id,
            allocated_move_line_id: target.id,
            allocated_amount: params.allocated_amount,
            currency_id: currency.id,
            write_off_amount: 0.0,
            write_off_account_id: None,
            metadata: None,
        },
        true,
    )?;
    let after = |id| {
        ctx.db
            .account_move_line()
            .id()
            .find(&id)
            .ok_or("allocated journal item is unavailable")
    };
    if minor(after(target.id)?.amount_residual)? != bank.signum() * open_after
        || minor(after(clearing.id)?.amount_residual)? != credit_after
    {
        return Err(
            "allocation did not leave the reviewed document balance and payment credit".to_string(),
        );
    }
    ctx.db
        .account_bank_statement_line()
        .id()
        .update(AccountBankStatementLine {
            is_reconciled: true,
            move_id: Some(move_id),
            move_ids: vec![target.id],
            payment_ids: vec![payment_id],
            amount_residual: 0.0,
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            ..line
        });
    write_business_audit(
        ctx,
        organization_id,
        ACTION,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: BANK_SOURCE,
            record_id: line_id,
            action: "RECONCILE",
            old_values: Some(serde_json::json!({"is_reconciled": false}).to_string()),
            new_values: Some(
                serde_json::json!({
                    "is_reconciled": true,
                    "payment_transaction_id": transaction.id,
                    "payment_id": payment_id,
                    "move_id": move_id,
                    "move_ids": [target.id],
                    "amount_residual": 0.0,
                    "allocated_minor": allocated,
                    "document_remaining_minor": open_after,
                    "payment_credit_minor": credit_after,
                    "currency_id": currency.id,
                })
                .to_string(),
            ),
            changed_fields: [
                "is_reconciled",
                "payment_ids",
                "move_id",
                "move_ids",
                "amount_residual",
            ]
            .map(str::to_string)
            .to_vec(),
            metadata: None,
        },
    )?;
    record_result(
        ctx,
        organization_id,
        company_id,
        ACTION,
        params.idempotency_key,
        fingerprint,
        BANK_SOURCE,
        line_id,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn separates_remaining_document_from_unapplied_credit() {
        assert_eq!(amounts(6000, 10000, 6000), Ok((4000, 0)));
        assert_eq!(amounts(-10000, -6000, 6000), Ok((0, 4000)));
        assert!(amounts(10000, -6000, 6000).is_err());
        assert!(amounts(10000, 6000, 5900).is_err());
        assert!(amounts(6000, 6000, 6000).is_err());
    }
}
