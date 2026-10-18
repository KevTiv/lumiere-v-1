//! Read-only financial planning followed by the owned effects of a bank reversal.
//!
//! Bank-line state, approval tasks and lifecycle receipts belong to the caller.
//! This module never infers an allocation from an invoice's original balance:
//! only the immutable bank attempt's signed before-residuals may be restored.

use std::collections::{BTreeMap, BTreeSet};

use spacetimedb::{ReducerContext, Timestamp};

use super::bank_reconciliation::{account_bank_statement, account_bank_statement_line};
use super::bank_settlement_lifecycle::{
    BankSettlementLineSnapshot, BankStatementSettlementAttempt, BankStatementSettlementReversal,
};
use super::fiscal_periods::ensure_accounting_period_open_for_date;
use super::journal_entries::{
    account_move, account_move_line, is_receivable_or_payable_line_type, AccountMove,
    AccountMoveLine,
};
use super::money::pilot_money_minor_units;
use super::payments::{account_payment, reverse_posted_payment_move_at, AccountPayment};
use super::relations::{
    require_active_account, require_active_currency_id, require_active_journal,
    require_contact_in_scope,
};
use crate::core::organization::{company, require_company_in_organization};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::sales::sales_core::{sale_order, SaleOrder};
use crate::types::{
    AccountMoveState, AccountTypeInternal, BankStatementState, JournalType, MoveType, PartnerType,
    PaymentState, PaymentType,
};

/// A complete plan contains owned rows, so no relational lookup can fail after
/// the first restoration. The private identity prevents applying another request.
pub(super) struct PreparedBankSettlementReversal {
    attempt_id: u64,
    generation: u64,
    organization_id: u64,
    company_id: u64,
    line_id: u64,
    receipt_key: String,
    request_key: String,
    reason: String,
    date: Timestamp,
    payment: AccountPayment,
    payment_move: AccountMove,
    payment_lines: Vec<AccountMoveLine>,
    invoice_lines: Vec<AccountMoveLine>,
    invoices: Vec<AccountMove>,
    sale_orders: Vec<SaleOrder>,
}

fn same_money(left: f64, right: f64, decimals: u8) -> Result<bool, String> {
    Ok(pilot_money_minor_units(left, decimals)? == pilot_money_minor_units(right, decimals)?)
}

fn add_minor(total: i64, amount: i64) -> Result<i64, String> {
    total
        .checked_add(amount)
        .ok_or_else(|| "bank reversal monetary total overflow".to_string())
}

fn sorted_unique(ids: &[u64], role: &str) -> Result<Vec<u64>, String> {
    let mut sorted = ids.to_vec();
    sorted.sort_unstable();
    if sorted.contains(&0) || sorted.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(format!(
            "bank reversal {role} contains duplicate or invalid identities"
        ));
    }
    Ok(sorted)
}

fn snapshot_effect(
    snapshot: &BankSettlementLineSnapshot,
    bank_minor: i64,
    decimals: u8,
) -> Result<i64, String> {
    let balance = pilot_money_minor_units(snapshot.balance, decimals)?;
    let debit = pilot_money_minor_units(snapshot.debit, decimals)?;
    let credit = pilot_money_minor_units(snapshot.credit, decimals)?;
    let before = pilot_money_minor_units(snapshot.residual_before, decimals)?;
    if snapshot.line_id == 0
        || snapshot.move_id == 0
        || snapshot.account_id == 0
        || debit < 0
        || credit < 0
        || debit.checked_sub(credit) != Some(balance)
        || balance.signum() != bank_minor.signum()
        || before == 0
        || before.signum() != bank_minor.signum()
        || before.abs() > balance.abs()
        || !same_money(snapshot.amount_currency, snapshot.balance, decimals)?
        || !same_money(
            snapshot.residual_currency_before,
            snapshot.residual_before,
            decimals,
        )?
        || snapshot.is_matching_before
    {
        return Err("bank reversal snapshot has an invalid signed allocation effect".to_string());
    }
    Ok(before.abs())
}

/// Restore only this attempt's delta. No clamping can conceal an inconsistent
/// sale order or erase payments belonging to another invoice/payment.
fn restored_sale_order(
    total: i64,
    paid: i64,
    residual: i64,
    delta: i64,
) -> Result<(i64, i64), String> {
    if total < 0
        || paid < 0
        || residual < 0
        || delta <= 0
        || paid.checked_add(residual) != Some(total)
    {
        return Err("bank reversal sale order balances are inconsistent".to_string());
    }
    let restored_paid = paid
        .checked_sub(delta)
        .filter(|amount| *amount >= 0)
        .ok_or("bank reversal exceeds the sale order's owned paid amount")?;
    let restored_residual = residual
        .checked_add(delta)
        .filter(|amount| *amount <= total)
        .ok_or("bank reversal exceeds the sale order total")?;
    Ok((restored_paid, restored_residual))
}

/// Validate all financial dependencies without writing a row, sequence, task or
/// audit event. The request may still be an uninserted temporary row with id 0.
pub(super) fn prepare_bank_settlement_reversal(
    ctx: &ReducerContext,
    attempt: &BankStatementSettlementAttempt,
    request: &BankStatementSettlementReversal,
) -> Result<PreparedBankSettlementReversal, String> {
    if request.organization_id != attempt.organization_id
        || request.company_id != attempt.company_id
        || request.attempt_id != attempt.id
        || request.line_id != attempt.line_id
        || request.payment_id != attempt.payment_id
        || request.status != "reversal_awaiting_approval"
        || request.reversal_move_id.is_some()
        || request.idempotency_key.trim().is_empty()
        || request.idempotency_key.trim() != request.idempotency_key
        || request.idempotency_key.len() > 256
        || request.reason.trim().is_empty()
        || request.reason.len() > 8_192
        || !matches!(
            attempt.status.as_str(),
            "settled"
                | "payment_posted"
                | "reversal_awaiting_approval"
                | "reversal_rejected"
                | "reversal_invalidated"
                | "reversal_cancelled"
        )
    {
        return Err(
            "bank reversal request does not identify an active posted settlement attempt"
                .to_string(),
        );
    }
    check_permission(ctx, attempt.organization_id, "payment", "reverse")?;
    check_permission(ctx, attempt.organization_id, "account_move", "write")?;
    require_company_in_organization(ctx, attempt.organization_id, attempt.company_id)?;
    let company = ctx
        .db
        .company()
        .id()
        .find(&attempt.company_id)
        .ok_or("bank reversal company missing")?;
    let currency = require_active_currency_id(ctx, attempt.currency_id, "bank reversal")?;
    if company.currency_id != currency.id
        || currency.organization_id != attempt.organization_id
        || currency.rounding_factor != 10_f64.powi(-i32::from(currency.decimal_places))
    {
        return Err(
            "bank reversal requires the settlement's active company base currency".to_string(),
        );
    }
    let decimals = currency.decimal_places;
    let scale = 10_f64.powi(i32::from(decimals));
    let bank_minor = pilot_money_minor_units(attempt.amount, decimals)?;
    if bank_minor == 0 || request.date < attempt.date {
        return Err(
            "bank reversal requires a nonzero amount and a date on or after the payment"
                .to_string(),
        );
    }
    ensure_accounting_period_open_for_date(ctx, attempt.company_id, request.date)?;
    let journal = require_active_journal(
        ctx,
        attempt.organization_id,
        attempt.company_id,
        attempt.journal_id,
        "bank reversal",
    )?;
    if journal.type_ != JournalType::Bank || journal.currency_id.is_some_and(|id| id != currency.id)
    {
        return Err("bank reversal requires its active base-currency bank journal".to_string());
    }
    let partner = require_contact_in_scope(
        ctx,
        attempt.organization_id,
        attempt.company_id,
        attempt.partner_id,
        "bank reversal partner",
    )?;
    let inbound = bank_minor > 0;
    if (inbound && !partner.is_customer) || (!inbound && !partner.is_vendor) {
        return Err("bank reversal partner has an incompatible accounting role".to_string());
    }
    let expected_account_type = if inbound {
        AccountTypeInternal::Receivable
    } else {
        AccountTypeInternal::Payable
    };
    let expected_move_type = if inbound {
        MoveType::OutInvoice
    } else {
        MoveType::InInvoice
    };
    let expected_payment_type = if inbound {
        PaymentType::InBound
    } else {
        PaymentType::OutBound
    };
    let expected_partner_type = if inbound {
        PartnerType::Customer
    } else {
        PartnerType::Supplier
    };
    let line = ctx
        .db
        .account_bank_statement_line()
        .id()
        .find(&attempt.line_id)
        .ok_or("bank reversal statement line missing")?;
    let statement = ctx
        .db
        .account_bank_statement()
        .id()
        .find(&attempt.statement_id)
        .ok_or("bank reversal statement missing")?;
    if line.organization_id != attempt.organization_id
        || statement.organization_id != attempt.organization_id
        || statement.company_id != attempt.company_id
        || line.statement_id != statement.id
        || line.journal_id != attempt.journal_id
        || statement.journal_id != attempt.journal_id
        || statement.currency_id != currency.id
        || line.journal_currency_id != currency.id
        || line.currency_id.is_some_and(|id| id != currency.id)
        || line.foreign_currency_id.is_some()
        || line.partner_id.is_some_and(|id| id != attempt.partner_id)
        || line.payment_ids != vec![attempt.payment_id]
        || line.date != attempt.date
        || !same_money(line.amount, attempt.amount, decimals)?
        || !matches!(
            statement.state,
            BankStatementState::Open | BankStatementState::Posted
        )
    {
        return Err("bank reversal statement ownership or financial scope changed".to_string());
    }
    let settled = line.is_reconciled;
    let payment = ctx
        .db
        .account_payment()
        .id()
        .find(&attempt.payment_id)
        .ok_or("bank reversal payment missing")?;
    if payment.organization_id != attempt.organization_id
        || payment.company_id != attempt.company_id
        || payment.state != PaymentState::Paid
        || payment.reversal_move_id.is_some()
        || payment.journal_id != journal.id
        || payment.currency_id != currency.id
        || payment.partner_id != partner.id
        || payment.payment_type != expected_payment_type
        || payment.partner_type != expected_partner_type
        || payment.date != attempt.date
        || pilot_money_minor_units(payment.amount, decimals)? != bank_minor.abs()
    {
        return Err("bank reversal payment is not the original posted company payment".to_string());
    }
    let payment_move_id = payment
        .move_id
        .ok_or("bank reversal payment has no posted journal entry")?;
    let payment_move = ctx
        .db
        .account_move()
        .id()
        .find(&payment_move_id)
        .ok_or("bank reversal original journal entry missing")?;
    if payment_move.organization_id != attempt.organization_id
        || payment_move.company_id != attempt.company_id
        || payment_move.journal_id != journal.id
        || payment_move.currency_id != currency.id
        || payment_move.company_currency_id != currency.id
        || payment_move.partner_id != Some(partner.id)
        || payment_move.state != AccountMoveState::Posted
        || payment_move.move_type != MoveType::Entry
        || payment_move.date != attempt.date
        || pilot_money_minor_units(payment_move.amount_total, decimals)? != bank_minor.abs()
        || pilot_money_minor_units(payment_move.amount_untaxed, decimals)? != bank_minor.abs()
        || pilot_money_minor_units(payment_move.amount_tax, decimals)? != 0
        || pilot_money_minor_units(payment_move.amount_residual, decimals)? != 0
        || pilot_money_minor_units(payment_move.amount_residual_signed, decimals)? != 0
        || payment_move.payment_state != PaymentState::Paid
        || payment_move.invoice_has_outstanding
    {
        return Err(
            "bank reversal original journal entry does not match the settlement".to_string(),
        );
    }
    if ctx
        .db
        .account_payment()
        .payment_by_org()
        .filter(&attempt.organization_id)
        .any(|other| other.id != payment.id && other.move_id == Some(payment_move_id))
    {
        return Err("bank reversal journal entry has another payment owner".to_string());
    }
    // A missing payment.reversal_move_id must not permit a second compensation
    // for a previously posted but orphaned reversing entry.
    if ctx
        .db
        .account_move()
        .account_move_by_org()
        .filter(&attempt.organization_id)
        .any(|other| {
            other.id != payment_move_id
                && other
                    .metadata
                    .as_deref()
                    .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
                    .is_some_and(|metadata| {
                        metadata
                            .get("reverses_payment_move_id")
                            .and_then(serde_json::Value::as_u64)
                            == Some(payment_move_id)
                    })
        })
    {
        return Err(
            "bank reversal already has an orphaned compensating entry; review its receipt"
                .to_string(),
        );
    }
    let selected_ids = sorted_unique(
        &attempt
            .line_snapshots
            .iter()
            .map(|row| row.line_id)
            .collect::<Vec<_>>(),
        "snapshot items",
    )?;
    let invoice_ids = sorted_unique(
        &attempt
            .invoice_snapshots
            .iter()
            .map(|row| row.move_id)
            .collect::<Vec<_>>(),
        "snapshot invoices",
    )?;
    if selected_ids.is_empty() || invoice_ids.is_empty() {
        return Err("bank reversal is missing immutable reviewed invoice snapshots".to_string());
    }
    let mut effects_by_invoice = BTreeMap::new();
    let mut clearing_account_id = None;
    let mut total_effect = 0_i64;
    for snapshot in &attempt.line_snapshots {
        if snapshot.partner_id != partner.id
            || snapshot.currency_id != currency.id
            || snapshot.company_currency_id != currency.id
            || !invoice_ids.contains(&snapshot.move_id)
            || clearing_account_id.is_some_and(|id| id != snapshot.account_id)
        {
            return Err("bank reversal reviewed items disagree on company currency, partner or clearing account".to_string());
        }
        clearing_account_id = Some(snapshot.account_id);
        let effect = snapshot_effect(snapshot, bank_minor, decimals)?;
        total_effect = add_minor(total_effect, effect)?;
        let previous = effects_by_invoice
            .get(&snapshot.move_id)
            .copied()
            .unwrap_or(0);
        effects_by_invoice.insert(snapshot.move_id, add_minor(previous, effect)?);
    }
    if total_effect != bank_minor.abs() || effects_by_invoice.len() != invoice_ids.len() {
        return Err("bank reversal snapshots do not equal the original bank payment".to_string());
    }
    if ctx
        .db
        .account_bank_statement_line()
        .bank_statement_line_by_org()
        .filter(&attempt.organization_id)
        .any(|other| {
            other.id != line.id
                && (other.payment_ids.contains(&payment.id)
                    || other.move_id == Some(payment_move_id)
                    || other.move_ids.iter().any(|id| selected_ids.contains(id)))
        })
    {
        return Err("bank reversal financial records are owned by another bank line".to_string());
    }
    if settled {
        if line.move_id != Some(payment_move_id)
            || sorted_unique(&line.move_ids, "linked items")? != selected_ids
            || pilot_money_minor_units(line.amount_residual, decimals)? != 0
            || (inbound
                && (sorted_unique(&payment.reconciled_invoice_ids, "payment invoices")?
                    != invoice_ids
                    || !payment.reconciled_bill_ids.is_empty()))
            || (!inbound
                && (sorted_unique(&payment.reconciled_bill_ids, "payment bills")? != invoice_ids
                    || !payment.reconciled_invoice_ids.is_empty()))
        {
            return Err(
                "bank reversal allocation links do not match the settled attempt".to_string(),
            );
        }
    } else if line.move_id.is_some()
        || !line.move_ids.is_empty()
        || pilot_money_minor_units(line.amount_residual, decimals)? != bank_minor
        || !payment.reconciled_invoice_ids.is_empty()
        || !payment.reconciled_bill_ids.is_empty()
    {
        return Err(
            "bank reversal cannot prove that the posted payment is still unallocated".to_string(),
        );
    }

    // Native bank posting creates one liquidity row and one AR/AP clearing row.
    // Validate both fully before the shared reversing helper can insert anything.
    let payment_lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&payment_move_id)
        .collect();
    if payment_lines.len() != 2 {
        return Err(
            "bank reversal requires the exact original two-line bank payment entry".to_string(),
        );
    }
    let mut liquidity_count = 0;
    let mut clearing_count = 0;
    let mut debit_total = 0_i64;
    let mut credit_total = 0_i64;
    for row in &payment_lines {
        let account = require_active_account(
            ctx,
            attempt.organization_id,
            attempt.company_id,
            row.account_id,
            "bank reversal ledger",
        )?;
        let debit = pilot_money_minor_units(row.debit, decimals)?;
        let credit = pilot_money_minor_units(row.credit, decimals)?;
        let balance = pilot_money_minor_units(row.balance, decimals)?;
        if row.organization_id != attempt.organization_id
            || row.company_id != attempt.company_id
            || row.journal_id != journal.id
            || row.parent_state != AccountMoveState::Posted
            || row.currency_id != currency.id
            || row.company_currency_id != currency.id
            || row.partner_id != Some(partner.id)
            || row.payment_id != Some(payment.id)
            || row.date != payment_move.date
            || account.currency_id.is_some_and(|id| id != currency.id)
            || debit < 0
            || credit < 0
            || debit.checked_sub(credit) != Some(balance)
            || !same_money(row.amount_currency, row.balance, decimals)?
            || !same_money(row.debit_currency, row.debit, decimals)?
            || !same_money(row.credit_currency, row.credit, decimals)?
            || !row.tax_ids.is_empty()
        {
            return Err("bank reversal original payment ledger rows are inconsistent".to_string());
        }
        debit_total = add_minor(debit_total, debit)?;
        credit_total = add_minor(credit_total, credit)?;
        if is_receivable_or_payable_line_type(row.account_internal_type.as_deref()) {
            clearing_count += 1;
            if row.account_id
                != clearing_account_id.ok_or("bank reversal clearing account missing")?
                || account.internal_type.as_ref() != Some(&expected_account_type)
                || !account.reconcile
                || balance != -bank_minor
                || pilot_money_minor_units(row.amount_residual, decimals)?.abs()
                    != if settled { 0 } else { bank_minor.abs() }
                || !same_money(row.amount_residual_currency, row.amount_residual, decimals)?
            {
                return Err(
                    "bank reversal clearing residual or account ownership changed".to_string(),
                );
            }
            if settled {
                if !row.is_matching
                    || !invoice_ids.iter().any(|id| {
                        row.matching_number.as_deref()
                            == Some(format!("MATCH-{payment_move_id}-{id}").as_str())
                    })
                {
                    return Err("bank reversal clearing allocation owner changed".to_string());
                }
            } else if row.matching_number.is_some() || row.is_matching {
                return Err(
                    "bank reversal unallocated clearing row has an unexpected matching owner"
                        .to_string(),
                );
            }
        } else {
            liquidity_count += 1;
            if balance != bank_minor
                || (account.internal_type != Some(AccountTypeInternal::Liquidity)
                    && !account.is_bank_account)
                || row.matching_number.is_some()
                || !same_money(row.amount_residual_currency, row.amount_residual, decimals)?
                || pilot_money_minor_units(row.amount_residual, decimals)? != balance
            {
                return Err(
                    "bank reversal liquidity row has changed or been matched elsewhere".to_string(),
                );
            }
        }
    }
    if clearing_count != 1
        || liquidity_count != 1
        || debit_total != credit_total
        || debit_total != bank_minor.abs()
    {
        return Err("bank reversal original payment entry is not exactly balanced".to_string());
    }

    let mut invoice_lines = Vec::new();
    let mut invoices = Vec::new();
    let mut sale_orders = Vec::new();
    if settled {
        let mut expected_order_deltas = BTreeMap::new();
        for snapshot in &attempt.invoice_snapshots {
            let mut invoice = ctx
                .db
                .account_move()
                .id()
                .find(&snapshot.move_id)
                .ok_or("bank reversal settled invoice missing")?;
            let effect = effects_by_invoice
                .get(&snapshot.move_id)
                .copied()
                .ok_or("bank reversal invoice effect missing")?;
            let total = pilot_money_minor_units(snapshot.amount_total, decimals)?.abs();
            if invoice.organization_id != attempt.organization_id
                || invoice.company_id != attempt.company_id
                || invoice.state != AccountMoveState::Posted
                || invoice.move_type != expected_move_type
                || invoice.partner_id != Some(partner.id)
                || snapshot.partner_id != partner.id
                || invoice.journal_id != snapshot.journal_id
                || invoice.currency_id != currency.id
                || snapshot.currency_id != currency.id
                || invoice.company_currency_id != currency.id
                || snapshot.company_currency_id != currency.id
                || invoice.date != snapshot.date
                || invoice.sale_order_id != snapshot.sale_order_id
                || !same_money(invoice.amount_total, snapshot.amount_total, decimals)?
                || pilot_money_minor_units(invoice.amount_residual, decimals)? != 0
                || pilot_money_minor_units(invoice.amount_residual_signed, decimals)? != 0
                || invoice.payment_state != PaymentState::Paid
                || invoice.invoice_has_outstanding
                || pilot_money_minor_units(snapshot.residual_before, decimals)? != effect
                || pilot_money_minor_units(snapshot.residual_signed_before, decimals)?.abs()
                    != effect
                || effect > total
                || !matches!(
                    snapshot.payment_state_before,
                    PaymentState::NotPaid | PaymentState::Partial
                )
            {
                return Err(
                    "bank reversal settled invoice state no longer matches its owned effect"
                        .to_string(),
                );
            }
            require_active_journal(
                ctx,
                attempt.organization_id,
                attempt.company_id,
                invoice.journal_id,
                "bank reversal invoice",
            )?;
            let mut restored_total = 0_i64;
            for mut row in ctx
                .db
                .account_move_line()
                .move_line_by_move()
                .filter(&invoice.id)
                .filter(|row| {
                    is_receivable_or_payable_line_type(row.account_internal_type.as_deref())
                })
            {
                if row.organization_id != attempt.organization_id
                    || row.company_id != attempt.company_id
                    || row.journal_id != invoice.journal_id
                    || row.parent_state != AccountMoveState::Posted
                    || row.currency_id != currency.id
                    || row.company_currency_id != currency.id
                    || row.partner_id != Some(partner.id)
                    || pilot_money_minor_units(row.amount_residual, decimals)? != 0
                    || pilot_money_minor_units(row.amount_residual_currency, decimals)? != 0
                {
                    return Err(
                        "bank reversal invoice has changed receivable/payable rows".to_string()
                    );
                }
                let Some(before) = attempt
                    .line_snapshots
                    .iter()
                    .find(|before| before.line_id == row.id)
                else {
                    continue;
                };
                let account = require_active_account(
                    ctx,
                    attempt.organization_id,
                    attempt.company_id,
                    row.account_id,
                    "bank reversal invoice clearing",
                )?;
                if row.move_id != before.move_id
                    || row.account_id != before.account_id
                    || row.journal_id != before.journal_id
                    || row.partner_id != Some(before.partner_id)
                    || row.blocked
                    || !row.is_matching
                    || !account.reconcile
                    || account.internal_type.as_ref() != Some(&expected_account_type)
                    || account.currency_id.is_some_and(|id| id != currency.id)
                    || row.matching_number.as_deref()
                        != Some(format!("MATCH-{payment_move_id}-{}", invoice.id).as_str())
                    || row.matching_label != before.matching_label_before
                    || !same_money(row.balance, before.balance, decimals)?
                    || !same_money(row.debit, before.debit, decimals)?
                    || !same_money(row.credit, before.credit, decimals)?
                    || !same_money(row.amount_currency, before.amount_currency, decimals)?
                {
                    return Err("bank reversal invoice allocation ownership or original ledger values changed".to_string());
                }
                restored_total = add_minor(
                    restored_total,
                    snapshot_effect(before, bank_minor, decimals)?,
                )?;
                row.amount_residual = before.residual_before;
                row.amount_residual_currency = before.residual_currency_before;
                row.matching_number = before.matching_number_before.clone();
                row.matching_label = before.matching_label_before.clone();
                row.is_matching = before.is_matching_before;
                row.write_uid = Some(ctx.sender());
                row.write_date = Some(ctx.timestamp);
                invoice_lines.push(row);
            }
            if restored_total != effect {
                return Err("bank reversal is missing an owned invoice clearing row".to_string());
            }
            if let Some(order_id) = snapshot.sale_order_id {
                let previous = expected_order_deltas.get(&order_id).copied().unwrap_or(0);
                expected_order_deltas.insert(order_id, add_minor(previous, effect)?);
            }
            invoice.amount_residual = snapshot.residual_before;
            invoice.amount_residual_signed = snapshot.residual_signed_before;
            invoice.payment_state = snapshot.payment_state_before.clone();
            invoice.invoice_has_outstanding = snapshot.has_outstanding_before;
            invoice.write_uid = Some(ctx.sender());
            invoice.write_date = Some(ctx.timestamp);
            invoices.push(invoice);
        }
        let mut seen_orders = BTreeSet::new();
        for delta in &attempt.sale_order_deltas {
            if !seen_orders.insert(delta.sale_order_id)
                || expected_order_deltas.get(&delta.sale_order_id) != Some(&delta.applied_minor)
            {
                return Err(
                    "bank reversal sale order snapshot does not match its invoice effects"
                        .to_string(),
                );
            }
            let mut order = ctx
                .db
                .sale_order()
                .id()
                .find(&delta.sale_order_id)
                .ok_or("bank reversal sale order missing")?;
            if order.organization_id != attempt.organization_id
                || order.company_id != attempt.company_id
                || order.currency_id != currency.id
                || !same_money(order.amount_total, delta.amount_total, decimals)?
            {
                return Err("bank reversal sale order scope or total changed".to_string());
            }
            let (paid, residual) = restored_sale_order(
                pilot_money_minor_units(order.amount_total, decimals)?,
                pilot_money_minor_units(order.amount_paid, decimals)?,
                pilot_money_minor_units(order.amount_residual, decimals)?,
                delta.applied_minor,
            )?;
            order.amount_paid = paid as f64 / scale;
            order.amount_residual = residual as f64 / scale;
            order.write_uid = ctx.sender();
            order.write_date = ctx.timestamp;
            sale_orders.push(order);
        }
        if seen_orders.len() != expected_order_deltas.len() {
            return Err("bank reversal is missing a sale order effect snapshot".to_string());
        }
    }
    Ok(PreparedBankSettlementReversal {
        attempt_id: attempt.id,
        generation: attempt.generation,
        organization_id: attempt.organization_id,
        company_id: attempt.company_id,
        line_id: attempt.line_id,
        receipt_key: attempt.receipt_key.clone(),
        request_key: request.idempotency_key.clone(),
        reason: request.reason.clone(),
        date: request.date,
        payment,
        payment_move,
        payment_lines,
        invoice_lines,
        invoices,
        sale_orders,
    })
}

/// Apply the already-validated financial compensation. The caller changes the
/// bank line/lifecycle and records its durable commit only after this succeeds.
pub(super) fn apply_bank_settlement_reversal(
    ctx: &ReducerContext,
    attempt: &BankStatementSettlementAttempt,
    request: &BankStatementSettlementReversal,
    prepared: PreparedBankSettlementReversal,
) -> Result<u64, String> {
    if prepared.attempt_id != attempt.id
        || prepared.generation != attempt.generation
        || prepared.organization_id != attempt.organization_id
        || prepared.company_id != attempt.company_id
        || prepared.line_id != attempt.line_id
        || prepared.payment.id != attempt.payment_id
        || prepared.receipt_key != attempt.receipt_key
        || prepared.request_key != request.idempotency_key
        || prepared.reason != request.reason
        || prepared.date != request.date
        || request.organization_id != attempt.organization_id
        || request.company_id != attempt.company_id
        || request.attempt_id != attempt.id
        || request.line_id != attempt.line_id
        || request.payment_id != attempt.payment_id
    {
        return Err(
            "bank reversal prepared plan belongs to a different immutable request".to_string(),
        );
    }
    // The only fallible writer is called first. Its period/account/ledger checks
    // have all already passed in prepare; no invoice restoration precedes it.
    let reversal_id = reverse_posted_payment_move_at(
        ctx,
        &prepared.payment,
        prepared.payment_move.id,
        request.date,
    )?;
    let matching_number = format!("BANK-REVERSAL-{}-{reversal_id}", prepared.payment_move.id);
    for mut row in prepared.invoice_lines {
        row.write_uid = Some(ctx.sender());
        row.write_date = Some(ctx.timestamp);
        ctx.db.account_move_line().id().update(row);
    }
    for invoice in prepared.invoices {
        ctx.db.account_move().id().update(invoice);
    }
    for order in prepared.sale_orders {
        ctx.db.sale_order().id().update(order);
    }
    for mut row in prepared.payment_lines {
        row.amount_residual = 0.0;
        row.amount_residual_currency = 0.0;
        row.matching_number = Some(matching_number.clone());
        row.matching_label = Some("Bank settlement reversed".to_string());
        row.is_matching = true;
        row.write_uid = Some(ctx.sender());
        row.write_date = Some(ctx.timestamp);
        ctx.db.account_move_line().id().update(row);
    }
    // Match the compensating rows to their original entry as well; neither entry
    // may become apparently allocatable cash after reopening the bank line.
    for row in ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&reversal_id)
        .collect::<Vec<_>>()
    {
        ctx.db.account_move_line().id().update(AccountMoveLine {
            amount_residual: 0.0,
            amount_residual_currency: 0.0,
            matching_number: Some(matching_number.clone()),
            matching_label: Some("Bank settlement reversal".to_string()),
            is_matching: true,
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            ..row
        });
    }
    ctx.db.account_move().id().update(AccountMove {
        amount_residual: 0.0,
        amount_residual_signed: 0.0,
        invoice_has_outstanding: false,
        payment_state: PaymentState::Reversed,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..prepared.payment_move
    });
    let payment_id = prepared.payment.id;
    ctx.db.account_payment().id().update(AccountPayment {
        state: PaymentState::Reversed,
        reversal_move_id: Some(reversal_id),
        reconciled_invoice_ids: Vec::new(),
        reconciled_bill_ids: Vec::new(),
        ..prepared.payment
    });
    write_audit_log_v2(ctx, attempt.organization_id, AuditLogParams {
        company_id: Some(attempt.company_id), table_name: "account_payment", record_id: payment_id,
        action: "BANK_SETTLEMENT_REVERSE", old_values: Some(serde_json::json!({"attempt_id":attempt.id,"state":"Paid"}).to_string()),
        new_values: Some(serde_json::json!({"state":"Reversed","reversal_move_id":reversal_id,"date":request.date.to_micros_since_unix_epoch(),"reason":request.reason}).to_string()),
        changed_fields: vec!["state".to_string(),"reversal_move_id".to_string(),"reconciled_invoice_ids".to_string(),"reconciled_bill_ids".to_string()],
        metadata: None,
    });
    Ok(reversal_id)
}

#[cfg(test)]
mod tests {
    use super::{restored_sale_order, snapshot_effect};
    use crate::accounting::bank_settlement_lifecycle::BankSettlementLineSnapshot;

    #[test]
    fn restores_only_the_bank_owned_partial_payment_and_the_last_cent() {
        assert_eq!(
            restored_sale_order(10_000, 10_000, 0, 4_000),
            Ok((6_000, 4_000))
        );
        assert_eq!(restored_sale_order(10_000, 10_000, 0, 1), Ok((9_999, 1)));
        // Two invoices linked to one sale order contribute one aggregated delta.
        assert_eq!(
            restored_sale_order(20_000, 15_000, 5_000, 4_000 + 3_000),
            Ok((8_000, 12_000))
        );
    }

    #[test]
    fn rejects_inconsistent_sale_order_effects_instead_of_clamping() {
        for (total, paid, residual, delta) in [
            (100, 60, 30, 10),
            (100, 60, 40, 61),
            (100, 60, 40, 0),
            (100, -1, 101, 1),
        ] {
            assert!(restored_sale_order(total, paid, residual, delta).is_err());
        }
    }

    #[test]
    fn snapshot_effect_preserves_signed_partial_and_last_cent_provenance() {
        let mut line = BankSettlementLineSnapshot {
            line_id: 1,
            move_id: 2,
            account_id: 3,
            partner_id: 4,
            journal_id: 5,
            currency_id: 6,
            company_currency_id: 6,
            balance: 100.0,
            debit: 100.0,
            credit: 0.0,
            amount_currency: 100.0,
            residual_before: 100.0 - 99.99,
            residual_currency_before: 100.0 - 99.99,
            matching_number_before: Some("MATCH-earlier".to_string()),
            matching_label_before: None,
            is_matching_before: false,
        };
        assert_eq!(snapshot_effect(&line, 1, 2), Ok(1));
        line.balance = -100.0;
        line.debit = 0.0;
        line.credit = 100.0;
        line.amount_currency = -100.0;
        line.residual_before = -40.0;
        line.residual_currency_before = -40.0;
        assert_eq!(snapshot_effect(&line, -4_000, 2), Ok(4_000));
        assert!(snapshot_effect(&line, 4_000, 2).is_err());
        line.residual_before = -101.0;
        line.residual_currency_before = -101.0;
        assert!(snapshot_effect(&line, -10_100, 2).is_err());
    }
}
