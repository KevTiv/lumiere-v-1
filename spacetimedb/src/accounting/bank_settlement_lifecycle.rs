//! Authoritative bank settlement attempts, recovery and coordinated reversals.
//! Snapshots are durable financial records; bank-line metadata is a public hint only.

use std::collections::BTreeMap;

use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use super::bank_reconciliation::{
    account_bank_statement, account_bank_statement_line, AccountBankStatement,
    AccountBankStatementLine, ReconcileAccountBankStatementLineParams,
};
use super::fiscal_periods::ensure_accounting_period_open_for_date;
use super::idempotency::{record_result, replayed_result};
use super::journal_entries::{account_move, account_move_line, is_receivable_or_payable_line_type};
use super::money::pilot_money_minor_units;
use super::payments::{account_payment, AccountPayment};
use super::relations::{
    require_active_currency_id, require_active_journal, require_contact_in_scope,
};
use crate::core::organization::require_company_in_organization;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::sales::sales_core::sale_order;
use crate::types::{BankStatementState, PaymentState};
use crate::workflow::action_registry::{
    GuardedActionInput, GuardedActionKey, GUARDED_ACTION_SCHEMA_VERSION,
};
use crate::workflow::approval_gate::{
    request_guarded_action, GuardedActionGateOutcome, RequestGuardedActionParams,
};
use crate::workflow::approvals::{workflow_human_task, WorkflowHumanTask, WorkflowHumanTaskStatus};
use crate::workflow::runtime::{workflow_instance, WorkflowInstanceState};

#[derive(SpacetimeType, Clone, Debug)]
pub struct BankSettlementLineSnapshot {
    pub line_id: u64,
    pub move_id: u64,
    pub account_id: u64,
    pub partner_id: u64,
    pub journal_id: u64,
    pub currency_id: u64,
    pub company_currency_id: u64,
    pub balance: f64,
    pub debit: f64,
    pub credit: f64,
    pub amount_currency: f64,
    pub residual_before: f64,
    pub residual_currency_before: f64,
    pub matching_number_before: Option<String>,
    pub matching_label_before: Option<String>,
    pub is_matching_before: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct BankSettlementInvoiceSnapshot {
    pub move_id: u64,
    pub journal_id: u64,
    pub currency_id: u64,
    pub company_currency_id: u64,
    pub partner_id: u64,
    pub date: Timestamp,
    pub amount_total: f64,
    pub residual_before: f64,
    pub residual_signed_before: f64,
    pub payment_state_before: PaymentState,
    pub has_outstanding_before: bool,
    pub sale_order_id: Option<u64>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct BankSettlementSaleOrderDelta {
    pub sale_order_id: u64,
    pub applied_minor: i64,
    pub amount_total: f64,
}

#[spacetimedb::table(
    accessor = bank_statement_settlement_attempt,
    index(accessor = bank_settlement_attempt_by_org, btree(columns = [organization_id])),
    index(accessor = bank_settlement_attempt_by_company, btree(columns = [company_id])),
    index(accessor = bank_settlement_attempt_by_line, btree(columns = [line_id]))
)]
#[derive(Clone, Debug)]
pub struct BankStatementSettlementAttempt {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub statement_id: u64,
    pub line_id: u64,
    pub generation: u64,
    #[unique]
    pub payment_id: u64,
    pub receipt_key: String,
    pub status: String,
    pub amount: f64,
    pub currency_id: u64,
    pub journal_id: u64,
    pub date: Timestamp,
    pub partner_id: u64,
    pub line_snapshots: Vec<BankSettlementLineSnapshot>,
    pub invoice_snapshots: Vec<BankSettlementInvoiceSnapshot>,
    pub sale_order_deltas: Vec<BankSettlementSaleOrderDelta>,
    pub previous_payment_id: Option<u64>,
    pub recovery_key: Option<String>,
    pub recovery_reason: Option<String>,
    pub reversal_request_id: Option<u64>,
    pub created_at: Timestamp,
    pub created_by: Identity,
    pub closed_at: Option<Timestamp>,
}

#[spacetimedb::table(
    accessor = bank_statement_settlement_reversal,
    index(accessor = bank_settlement_reversal_by_org, btree(columns = [organization_id])),
    index(accessor = bank_settlement_reversal_by_company, btree(columns = [company_id])),
    index(accessor = bank_settlement_reversal_by_attempt, btree(columns = [attempt_id]))
)]
#[derive(Clone, Debug)]
pub struct BankStatementSettlementReversal {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub attempt_id: u64,
    pub line_id: u64,
    pub payment_id: u64,
    pub idempotency_key: String,
    pub date: Timestamp,
    pub reason: String,
    pub status: String,
    pub reversal_move_id: Option<u64>,
    pub created_at: Timestamp,
    pub created_by: Identity,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct AbandonBankStatementSettlementParams {
    pub payment_id: u64,
    pub idempotency_key: String,
    pub reason: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ResubmitBankStatementSettlementParams {
    pub payment_id: u64,
    pub move_ids: Vec<u64>,
    pub idempotency_key: String,
    pub reason: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ReverseBankStatementSettlementParams {
    pub payment_id: u64,
    pub date: Timestamp,
    pub idempotency_key: String,
    pub reason: String,
}

pub(super) struct PreparedBankSettlement {
    pub generation: u64,
    pub receipt_key: String,
    pub lines: Vec<BankSettlementLineSnapshot>,
    pub invoices: Vec<BankSettlementInvoiceSnapshot>,
    pub sale_orders: Vec<BankSettlementSaleOrderDelta>,
}

const META_KEY: &str = "bankSettlement";

pub(super) fn attempt_for_payment(
    ctx: &ReducerContext,
    payment_id: u64,
) -> Option<BankStatementSettlementAttempt> {
    ctx.db
        .bank_statement_settlement_attempt()
        .payment_id()
        .find(&payment_id)
}

pub(super) fn is_owned_payment(
    ctx: &ReducerContext,
    organization_id: u64,
    payment_id: u64,
) -> bool {
    attempt_for_payment(ctx, payment_id).is_some_and(|row| row.organization_id == organization_id)
}

pub(super) fn receipt_key(
    ctx: &ReducerContext,
    line: &AccountBankStatementLine,
) -> Result<String, String> {
    if let Some(payment_id) = line.payment_ids.first() {
        return Ok(attempt_for_payment(ctx, *payment_id)
            .map(|attempt| attempt.receipt_key)
            .unwrap_or_else(|| format!("bank-statement-line:{}", line.id)));
    }
    let generation = next_generation(ctx, line.id)?;
    Ok(format!(
        "bank-statement-line:{}:attempt:{generation}",
        line.id
    ))
}

fn next_generation(ctx: &ReducerContext, line_id: u64) -> Result<u64, String> {
    ctx.db
        .bank_statement_settlement_attempt()
        .bank_settlement_attempt_by_line()
        .filter(&line_id)
        .map(|row| row.generation)
        .max()
        .unwrap_or(0)
        .checked_add(1)
        .ok_or_else(|| "bank settlement generation exhausted".to_string())
}

pub(super) fn has_attempt_history(ctx: &ReducerContext, line_id: u64) -> bool {
    ctx.db
        .bank_statement_settlement_attempt()
        .bank_settlement_attempt_by_line()
        .filter(&line_id)
        .next()
        .is_some()
}

fn metadata_object(
    value: Option<&str>,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    match value {
        None => Ok(serde_json::Map::new()),
        Some(raw) => match serde_json::from_str::<serde_json::Value>(raw) {
            Ok(serde_json::Value::Object(object)) => Ok(object),
            _ => {
                let mut object = serde_json::Map::new();
                object.insert(
                    "legacyMetadata".to_string(),
                    serde_json::Value::String(raw.to_string()),
                );
                Ok(object)
            }
        },
    }
}

/// Generic data entry cannot manufacture or remove authoritative lifecycle hints.
pub(super) fn validate_metadata_change(old: Option<&str>, new: Option<&str>) -> Result<(), String> {
    let before = metadata_object(old)?.remove(META_KEY);
    let after = metadata_object(new)?.remove(META_KEY);
    if before != after {
        return Err("bank settlement lifecycle metadata is server-managed".to_string());
    }
    Ok(())
}

fn write_hint(
    ctx: &ReducerContext,
    attempt: &BankStatementSettlementAttempt,
) -> Result<(), String> {
    let line = ctx
        .db
        .account_bank_statement_line()
        .id()
        .find(&attempt.line_id)
        .ok_or("bank settlement line missing")?;
    if line.organization_id != attempt.organization_id {
        return Err("bank settlement metadata scope changed".to_string());
    }
    let payment = ctx
        .db
        .account_payment()
        .id()
        .find(&attempt.payment_id)
        .ok_or("bank settlement payment missing")?;
    let request = attempt
        .reversal_request_id
        .and_then(|id| ctx.db.bank_statement_settlement_reversal().id().find(&id));
    let mut hint = serde_json::json!({
        "attemptId": attempt.id.to_string(), "generation": attempt.generation.to_string(),
        "paymentId": attempt.payment_id.to_string(), "status": if attempt.status == "reversed_unallocated" { "reversed" } else { &attempt.status },
        "allocationApplied": line.is_reconciled || attempt.status == "reversed",
        "selectedMoveLineIds": attempt.line_snapshots.iter().map(|row| row.line_id.to_string()).collect::<Vec<_>>(),
        "selectedResiduals": attempt.line_snapshots.iter().map(|row| serde_json::json!({"lineId":row.line_id.to_string(),
            "moveId":row.move_id.to_string(),"residual":row.residual_before,"residualCurrency":row.residual_currency_before})).collect::<Vec<_>>()
    });
    if let Some(id) = payment.move_id {
        hint["paymentMoveId"] = id.to_string().into();
    }
    if let Some(id) = attempt.previous_payment_id {
        hint["previousPaymentId"] = id.to_string().into();
    }
    if let Some(key) = &attempt.recovery_key {
        hint["recoveryKey"] = key.clone().into();
        hint["recoveryAction"] = if attempt.status == "abandoned" {
            "abandon"
        } else {
            "resubmit"
        }
        .into();
        hint["recoveryReason"] = attempt.recovery_reason.clone().unwrap_or_default().into();
    }
    if let Some(request) = request {
        hint["reversalRequestId"] = request.id.to_string().into();
        hint["reversalDateMicros"] = request.date.to_micros_since_unix_epoch().to_string().into();
        hint["reversalReason"] = request.reason.clone().into();
        hint["recoveryAction"] = "reverse".into();
        hint["recoveryKey"] = request.idempotency_key.into();
        if let Some(id) = request.reversal_move_id {
            hint["reversalMoveId"] = id.to_string().into();
        }
    }
    let mut metadata = metadata_object(line.metadata.as_deref())?;
    metadata.insert(META_KEY.to_string(), hint);
    ctx.db
        .account_bank_statement_line()
        .id()
        .update(AccountBankStatementLine {
            metadata: Some(serde_json::Value::Object(metadata).to_string()),
            ..line
        });
    Ok(())
}

pub(super) fn prepare_attempt(
    ctx: &ReducerContext,
    statement: &AccountBankStatement,
    line: &AccountBankStatementLine,
    line_ids: &[u64],
    partner_id: u64,
) -> Result<PreparedBankSettlement, String> {
    ensure_accounting_period_open_for_date(ctx, statement.company_id, line.date)?;
    let currency = require_active_currency_id(ctx, statement.currency_id, "bank settlement")?;
    let journal = require_active_journal(
        ctx,
        statement.organization_id,
        statement.company_id,
        statement.journal_id,
        "bank settlement",
    )?;
    let liquidity_id = journal
        .default_account_id
        .or(journal.bank_account_id)
        .ok_or("bank journal liquidity account missing")?;
    let liquidity = super::relations::require_active_account(
        ctx,
        statement.organization_id,
        statement.company_id,
        liquidity_id,
        "bank liquidity",
    )?;
    if liquidity.internal_type != Some(crate::types::AccountTypeInternal::Liquidity)
        && !liquidity.is_bank_account
    {
        return Err("bank journal liquidity account has the wrong role".to_string());
    }
    let partner = require_contact_in_scope(
        ctx,
        statement.organization_id,
        statement.company_id,
        partner_id,
        "bank settlement partner",
    )?;
    if (line.amount > 0.0 && !partner.is_customer) || (line.amount < 0.0 && !partner.is_vendor) {
        return Err("bank settlement partner has an incompatible role".to_string());
    }
    let mut snapshots = Vec::with_capacity(line_ids.len());
    let mut invoice_rows = BTreeMap::new();
    for id in line_ids {
        let row = ctx
            .db
            .account_move_line()
            .id()
            .find(id)
            .ok_or("bank snapshot line missing")?;
        if pilot_money_minor_units(row.amount_residual, currency.decimal_places)?
            != pilot_money_minor_units(row.amount_residual_currency, currency.decimal_places)?
        {
            return Err(
                "bank settlement line has inconsistent base-currency residuals".to_string(),
            );
        }
        let invoice = ctx
            .db
            .account_move()
            .id()
            .find(&row.move_id)
            .ok_or("bank snapshot invoice missing")?;
        invoice_rows.insert(invoice.id, invoice);
        snapshots.push(BankSettlementLineSnapshot {
            line_id: row.id,
            move_id: row.move_id,
            account_id: row.account_id,
            partner_id,
            journal_id: row.journal_id,
            currency_id: row.currency_id,
            company_currency_id: row.company_currency_id,
            balance: row.balance,
            debit: row.debit,
            credit: row.credit,
            amount_currency: row.amount_currency,
            residual_before: row.amount_residual,
            residual_currency_before: row.amount_residual_currency,
            matching_number_before: row.matching_number,
            matching_label_before: row.matching_label,
            is_matching_before: row.is_matching,
        });
    }
    let mut invoices = Vec::with_capacity(invoice_rows.len());
    let mut sale_orders: BTreeMap<u64, BankSettlementSaleOrderDelta> = BTreeMap::new();
    for invoice in invoice_rows.into_values() {
        let rows: Vec<_> = ctx
            .db
            .account_move_line()
            .move_line_by_move()
            .filter(&invoice.id)
            .filter(|row| is_receivable_or_payable_line_type(row.account_internal_type.as_deref()))
            .collect();
        let residual_minor = rows.iter().try_fold(0_i64, |sum, row| {
            sum.checked_add(
                pilot_money_minor_units(row.amount_residual, currency.decimal_places)?.abs(),
            )
            .ok_or_else(|| "bank invoice residual overflow".to_string())
        })?;
        if residual_minor <= 0
            || pilot_money_minor_units(invoice.amount_residual, currency.decimal_places)?
                != residual_minor
        {
            return Err(
                "bank invoice header does not agree with its outstanding items".to_string(),
            );
        }
        let total_minor = pilot_money_minor_units(invoice.amount_total, currency.decimal_places)?;
        if residual_minor > total_minor
            || total_minor <= 0
            || (residual_minor == total_minor && invoice.payment_state != PaymentState::NotPaid)
            || (residual_minor < total_minor
                && (invoice.payment_state != PaymentState::Partial
                    || !invoice.invoice_has_outstanding))
            || pilot_money_minor_units(invoice.amount_residual_signed, currency.decimal_places)?
                .abs()
                != residual_minor
        {
            return Err(
                "bank invoice payment state does not agree with its remaining balance".to_string(),
            );
        }
        if let Some(order_id) = invoice.sale_order_id {
            let order = ctx
                .db
                .sale_order()
                .id()
                .find(&order_id)
                .ok_or("bank invoice sale order missing")?;
            if order.organization_id != statement.organization_id
                || order.company_id != statement.company_id
                || order.currency_id != statement.currency_id
            {
                return Err("bank invoice sale order does not match settlement scope".to_string());
            }
            let total = pilot_money_minor_units(order.amount_total, currency.decimal_places)?;
            let paid = pilot_money_minor_units(order.amount_paid, currency.decimal_places)?;
            let residual = pilot_money_minor_units(order.amount_residual, currency.decimal_places)?;
            if paid < 0 || residual < 0 || paid.checked_add(residual) != Some(total) {
                return Err("bank invoice sale order balances are inconsistent".to_string());
            }
            let entry = sale_orders
                .entry(order_id)
                .or_insert(BankSettlementSaleOrderDelta {
                    sale_order_id: order_id,
                    applied_minor: 0,
                    amount_total: order.amount_total,
                });
            entry.applied_minor = entry
                .applied_minor
                .checked_add(residual_minor)
                .ok_or("bank sale allocation overflow")?;
            if entry.applied_minor > residual {
                return Err("bank settlement exceeds the sale order residual".to_string());
            }
        }
        invoices.push(BankSettlementInvoiceSnapshot {
            move_id: invoice.id,
            journal_id: invoice.journal_id,
            currency_id: invoice.currency_id,
            company_currency_id: invoice.company_currency_id,
            partner_id,
            date: invoice.date,
            amount_total: invoice.amount_total,
            residual_before: invoice.amount_residual,
            residual_signed_before: invoice.amount_residual_signed,
            payment_state_before: invoice.payment_state,
            has_outstanding_before: invoice.invoice_has_outstanding,
            sale_order_id: invoice.sale_order_id,
        });
    }
    let generation = next_generation(ctx, line.id)?;
    Ok(PreparedBankSettlement {
        generation,
        receipt_key: format!("bank-statement-line:{}:attempt:{generation}", line.id),
        lines: snapshots,
        invoices,
        sale_orders: sale_orders.into_values().collect(),
    })
}

pub(super) fn insert_attempt(
    ctx: &ReducerContext,
    statement: &AccountBankStatement,
    line: &AccountBankStatementLine,
    payment_id: u64,
    partner_id: u64,
    prepared: PreparedBankSettlement,
) -> Result<(), String> {
    ctx.db
        .bank_statement_settlement_attempt()
        .insert(BankStatementSettlementAttempt {
            id: 0,
            organization_id: statement.organization_id,
            company_id: statement.company_id,
            statement_id: statement.id,
            line_id: line.id,
            generation: prepared.generation,
            payment_id,
            receipt_key: prepared.receipt_key,
            status: "awaiting_approval".to_string(),
            amount: line.amount,
            currency_id: statement.currency_id,
            journal_id: statement.journal_id,
            date: line.date,
            partner_id,
            line_snapshots: prepared.lines,
            invoice_snapshots: prepared.invoices,
            sale_order_deltas: prepared.sale_orders,
            previous_payment_id: None,
            recovery_key: None,
            recovery_reason: None,
            reversal_request_id: None,
            created_at: ctx.timestamp,
            created_by: ctx.sender(),
            closed_at: None,
        });
    Ok(())
}

pub(super) fn validate_pending_snapshot(
    ctx: &ReducerContext,
    payment: &AccountPayment,
) -> Result<(), String> {
    let Some(attempt) = attempt_for_payment(ctx, payment.id) else {
        return Ok(());
    };
    if !matches!(
        attempt.status.as_str(),
        "awaiting_approval" | "payment_posted"
    ) {
        return Err(
            "bank payment approval is closed; explicitly abandon or resubmit the settlement"
                .to_string(),
        );
    }
    let line = ctx
        .db
        .account_bank_statement_line()
        .id()
        .find(&attempt.line_id)
        .ok_or("bank attempt line missing")?;
    if line.payment_ids != vec![payment.id]
        || line.is_reconciled
        || line.organization_id != attempt.organization_id
    {
        return Err("bank payment is no longer the active settlement attempt".to_string());
    }
    let currency = require_active_currency_id(ctx, attempt.currency_id, "bank settlement")?;
    for snapshot in &attempt.line_snapshots {
        let row = ctx
            .db
            .account_move_line()
            .id()
            .find(&snapshot.line_id)
            .ok_or("reviewed bank invoice item missing")?;
        if row.organization_id != attempt.organization_id
            || row.company_id != attempt.company_id
            || row.move_id != snapshot.move_id
            || row.account_id != snapshot.account_id
            || row.currency_id != snapshot.currency_id
            || row.partner_id != Some(snapshot.partner_id)
            || row.matching_number != snapshot.matching_number_before
            || row.matching_label != snapshot.matching_label_before
            || pilot_money_minor_units(row.amount_residual, currency.decimal_places)?
                != pilot_money_minor_units(snapshot.residual_before, currency.decimal_places)?
            || pilot_money_minor_units(row.amount_residual_currency, currency.decimal_places)?
                != pilot_money_minor_units(
                    snapshot.residual_currency_before,
                    currency.decimal_places,
                )?
        {
            return Err("bank settlement invoice items changed after review".to_string());
        }
    }
    Ok(())
}

pub(super) fn payment_posted(ctx: &ReducerContext, payment_id: u64) -> Result<(), String> {
    let Some(mut attempt) = attempt_for_payment(ctx, payment_id) else {
        return Ok(());
    };
    if attempt.status != "awaiting_approval" {
        return Err("bank payment attempt is no longer awaiting posting".to_string());
    }
    attempt.status = "payment_posted".to_string();
    let attempt = ctx
        .db
        .bank_statement_settlement_attempt()
        .id()
        .update(attempt);
    write_hint(ctx, &attempt)?;
    BankSettlementCommitSnapshot {
        attempt: attempt.clone(),
    }
    .record(ctx, "erp.post_payment")
}

pub(super) fn settlement_finished(ctx: &ReducerContext, payment_id: u64) -> Result<(), String> {
    let Some(mut attempt) = attempt_for_payment(ctx, payment_id) else {
        return Ok(());
    };
    attempt.status = "settled".to_string();
    let attempt = ctx
        .db
        .bank_statement_settlement_attempt()
        .id()
        .update(attempt);
    write_hint(ctx, &attempt)?;
    BankSettlementCommitSnapshot {
        attempt: attempt.clone(),
    }
    .record(ctx, "erp.reconcile_account_bank_statement_line")
}

pub(super) fn pending_finished(ctx: &ReducerContext, payment_id: u64) -> Result<(), String> {
    let Some(attempt) = attempt_for_payment(ctx, payment_id) else {
        return Ok(());
    };
    write_hint(ctx, &attempt)?;
    BankSettlementCommitSnapshot {
        attempt: attempt.clone(),
    }
    .record(ctx, "erp.reconcile_account_bank_statement_line")
}

pub(super) struct BankSettlementCommitSnapshot {
    attempt: BankStatementSettlementAttempt,
}

impl BankSettlementCommitSnapshot {
    fn record(&self, ctx: &ReducerContext, operation: &str) -> Result<(), String> {
        let attempt = &self.attempt;
        use crate::core::persistence::{
            record_organization_commit, OrganizationCommitInput, RowChange,
        };
        let mut changes = Vec::new();
        // Parent/economic rows precede their immutable attempt/request references.
        if let Some(statement) = ctx
            .db
            .account_bank_statement()
            .id()
            .find(&attempt.statement_id)
        {
            changes.push(RowChange::upsert_stdb_row(
                "account_bank_statement",
                serde_json::json!({"id":statement.id}),
                &statement,
            )?);
        }
        for delta in &attempt.sale_order_deltas {
            if let Some(order) = ctx.db.sale_order().id().find(&delta.sale_order_id) {
                changes.push(RowChange::upsert_stdb_row(
                    "sale_order",
                    serde_json::json!({"id":order.id}),
                    &order,
                )?);
            }
        }
        let payment = ctx
            .db
            .account_payment()
            .id()
            .find(&attempt.payment_id)
            .ok_or("bank commit payment missing")?;
        let mut move_ids: Vec<_> = attempt
            .invoice_snapshots
            .iter()
            .map(|row| row.move_id)
            .collect();
        move_ids.extend(payment.move_id);
        move_ids.extend(payment.reversal_move_id);
        move_ids.sort_unstable();
        move_ids.dedup();
        for id in move_ids {
            let Some(record) = ctx.db.account_move().id().find(&id) else {
                if payment.move_id == Some(id) || payment.reversal_move_id == Some(id) {
                    return Err("bank commit payment entry missing".to_string());
                }
                // Unposted approval recovery retains its immutable snapshot even
                // when the reviewed document was subsequently cancelled/deleted.
                continue;
            };
            changes.push(RowChange::upsert_stdb_row(
                "account_move",
                serde_json::json!({"id":id}),
                &record,
            )?);
            for row in ctx.db.account_move_line().move_line_by_move().filter(&id) {
                changes.push(RowChange::upsert_stdb_row(
                    "account_move_line",
                    serde_json::json!({"id":row.id}),
                    &row,
                )?);
            }
        }
        changes.push(RowChange::upsert_stdb_row(
            "account_payment",
            serde_json::json!({"id":payment.id}),
            &payment,
        )?);
        let line = ctx
            .db
            .account_bank_statement_line()
            .id()
            .find(&attempt.line_id)
            .ok_or("bank commit line missing")?;
        changes.push(RowChange::upsert_stdb_row(
            "account_bank_statement_line",
            serde_json::json!({"id":line.id}),
            &line,
        )?);
        changes.push(RowChange::upsert_stdb_row(
            "bank_statement_settlement_attempt",
            serde_json::json!({"id":attempt.id}),
            attempt,
        )?);
        if let Some(previous) = attempt
            .previous_payment_id
            .and_then(|id| attempt_for_payment(ctx, id))
        {
            let payment = ctx
                .db
                .account_payment()
                .id()
                .find(&previous.payment_id)
                .ok_or("previous bank payment missing")?;
            changes.push(RowChange::upsert_stdb_row(
                "account_payment",
                serde_json::json!({"id":payment.id}),
                &payment,
            )?);
            changes.push(RowChange::upsert_stdb_row(
                "bank_statement_settlement_attempt",
                serde_json::json!({"id":previous.id}),
                &previous,
            )?);
        }
        use super::idempotency::accounting_operation_receipt;
        for receipt in ctx.db.accounting_operation_receipt().iter().filter(|row| {
            row.organization_id == attempt.organization_id
                && row.company_id == attempt.company_id
                && ((row.result_table == "bank_statement_settlement_attempt"
                    && row.result_id == attempt.id)
                    || (row.result_table == "bank_statement_settlement_reversal"
                        && Some(row.result_id) == attempt.reversal_request_id)
                    || (row.result_table == "account_payment"
                        && row.result_id == attempt.payment_id))
        }) {
            changes.push(RowChange::upsert_stdb_row(
                "accounting_operation_receipt",
                serde_json::json!({"id":receipt.id}),
                &receipt,
            )?);
        }

        if let Some(request) = attempt
            .reversal_request_id
            .and_then(|id| ctx.db.bank_statement_settlement_reversal().id().find(&id))
        {
            changes.push(RowChange::upsert_stdb_row(
                "bank_statement_settlement_reversal",
                serde_json::json!({"id":request.id}),
                &request,
            )?);
        }
        use crate::core::reference::document_sequence;
        for sequence in ctx.db.document_sequence().iter().filter(|row| {
            row.organization_id == attempt.organization_id
                && matches!(row.doc_type.as_str(), "PAY" | "PAYREV")
        }) {
            changes.push(RowChange::upsert_stdb_row(
                "document_sequence",
                serde_json::json!({"sequence_key":sequence.sequence_key}),
                &sequence,
            )?);
        }
        // Bank approvals must survive cold reconstruction with their pinned runtime
        // and exact replay/effect receipts, including the final task decision.
        use crate::workflow::action_registry::guarded_action_receipt;
        use crate::workflow::approvals::{
            workflow_human_task_candidate, workflow_human_task_event, workflow_human_task_receipt,
        };
        use crate::workflow::definitions::{
            workflow, workflow_edge, workflow_node, workflow_version,
        };
        use crate::workflow::runtime::{
            workflow_command_receipt, workflow_decision_event, workflow_token,
        };
        for task in ctx
            .db
            .workflow_human_task()
            .human_task_by_org()
            .filter(&attempt.organization_id)
            .filter(|row| {
                row.company_id == attempt.company_id
                    && row.subject_model == "account_payment"
                    && row.subject_id == attempt.payment_id
            })
        {
            let definition = ctx
                .db
                .workflow()
                .id()
                .find(&task.workflow_id)
                .ok_or("bank approval workflow missing")?;
            let version = ctx
                .db
                .workflow_version()
                .id()
                .find(&task.workflow_version_id)
                .ok_or("bank approval version missing")?;
            changes.push(RowChange::upsert_stdb_row(
                "workflow",
                serde_json::json!({"id":definition.id}),
                &definition,
            )?);
            changes.push(RowChange::upsert_stdb_row(
                "workflow_version",
                serde_json::json!({"id":version.id}),
                &version,
            )?);
            for row in ctx
                .db
                .workflow_node()
                .workflow_node_by_version()
                .filter(&version.id)
            {
                changes.push(RowChange::upsert_stdb_row(
                    "workflow_node",
                    serde_json::json!({"id":row.id}),
                    &row,
                )?);
            }
            for row in ctx
                .db
                .workflow_edge()
                .workflow_edge_by_version()
                .filter(&version.id)
            {
                changes.push(RowChange::upsert_stdb_row(
                    "workflow_edge",
                    serde_json::json!({"id":row.id}),
                    &row,
                )?);
            }
            let instance = ctx
                .db
                .workflow_instance()
                .id()
                .find(&task.workflow_instance_id)
                .ok_or("bank approval instance missing")?;
            changes.push(RowChange::upsert_stdb_row(
                "workflow_instance",
                serde_json::json!({"id":instance.id}),
                &instance,
            )?);
            for row in ctx
                .db
                .workflow_token()
                .workflow_token_by_instance()
                .filter(&instance.id)
            {
                changes.push(RowChange::upsert_stdb_row(
                    "workflow_token",
                    serde_json::json!({"id":row.id}),
                    &row,
                )?);
            }
            for row in ctx
                .db
                .workflow_decision_event()
                .workflow_event_by_instance()
                .filter(&instance.id)
            {
                changes.push(RowChange::upsert_stdb_row(
                    "workflow_decision_event",
                    serde_json::json!({"id":row.id}),
                    &row,
                )?);
            }
            for row in ctx
                .db
                .workflow_command_receipt()
                .workflow_receipt_by_instance()
                .filter(&instance.id)
            {
                changes.push(RowChange::upsert_stdb_row(
                    "workflow_command_receipt",
                    serde_json::json!({"scope_key":row.scope_key}),
                    &row,
                )?);
            }
            changes.push(RowChange::upsert_stdb_row(
                "workflow_human_task",
                serde_json::json!({"id":task.id}),
                &task,
            )?);
            for row in ctx
                .db
                .workflow_human_task_candidate()
                .iter()
                .filter(|row| row.task_id == task.id)
            {
                changes.push(RowChange::upsert_stdb_row(
                    "workflow_human_task_candidate",
                    serde_json::json!({"id":row.id}),
                    &row,
                )?);
            }
            for row in ctx
                .db
                .workflow_human_task_event()
                .human_task_event_by_task()
                .filter(&task.id)
            {
                changes.push(RowChange::upsert_stdb_row(
                    "workflow_human_task_event",
                    serde_json::json!({"id":row.id}),
                    &row,
                )?);
            }
            for row in ctx
                .db
                .workflow_human_task_receipt()
                .human_task_receipt_by_task()
                .filter(&task.id)
            {
                changes.push(RowChange::upsert_stdb_row(
                    "workflow_human_task_receipt",
                    serde_json::json!({"scope_key":row.scope_key}),
                    &row,
                )?);
            }
        }
        for row in ctx
            .db
            .guarded_action_receipt()
            .guarded_action_receipt_by_subject()
            .filter(&attempt.payment_id)
            .filter(|row| {
                row.organization_id == attempt.organization_id
                    && row.company_id == attempt.company_id
            })
        {
            changes.push(RowChange::upsert_stdb_row(
                "guarded_action_receipt",
                serde_json::json!({"id":row.id}),
                &row,
            )?);
        }
        use crate::core::audit::audit_log;
        for row in ctx.db.audit_log().iter().filter(|row| {
            row.organization_id == attempt.organization_id
                && row.company_id == Some(attempt.company_id)
                && ((row.table_name == "account_bank_statement_line"
                    && row.record_id == attempt.line_id)
                    || (row.table_name == "account_bank_statement"
                        && row.record_id == attempt.statement_id)
                    || (row.table_name == "account_payment"
                        && (row.record_id == attempt.payment_id
                            || Some(row.record_id) == attempt.previous_payment_id))
                    || (row.table_name == "account_move"
                        && attempt
                            .invoice_snapshots
                            .iter()
                            .any(|invoice| invoice.move_id == row.record_id)))
        }) {
            changes.push(RowChange::upsert_stdb_row(
                "audit_log",
                serde_json::json!({"id":row.id}),
                &row,
            )?);
        }
        record_organization_commit(
            ctx,
            OrganizationCommitInput {
                organization_id: attempt.organization_id,
                operation_id: operation.to_string(),
                correlation_id: format!("bank-settlement-attempt:{}", attempt.id),
                changes,
            },
        )?;
        Ok(())
    }
}

struct ScopedSettlement {
    attempt: BankStatementSettlementAttempt,
    statement: AccountBankStatement,
    line: AccountBankStatementLine,
    payment: AccountPayment,
}

fn scoped_settlement(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    line_id: u64,
    payment_id: u64,
) -> Result<ScopedSettlement, String> {
    require_company_in_organization(ctx, organization_id, company_id)?;
    let attempt = attempt_for_payment(ctx, payment_id)
        .ok_or("bank settlement has no reversible authoritative snapshot")?;
    let line = ctx
        .db
        .account_bank_statement_line()
        .id()
        .find(&line_id)
        .ok_or("bank settlement line missing")?;
    let statement = ctx
        .db
        .account_bank_statement()
        .id()
        .find(&line.statement_id)
        .ok_or("bank statement missing")?;
    let payment = ctx
        .db
        .account_payment()
        .id()
        .find(&payment_id)
        .ok_or("bank settlement payment missing")?;
    if attempt.organization_id != organization_id
        || attempt.company_id != company_id
        || attempt.line_id != line_id
        || attempt.statement_id != statement.id
        || line.organization_id != organization_id
        || statement.organization_id != organization_id
        || statement.company_id != company_id
        || payment.organization_id != organization_id
        || payment.company_id != company_id
        || payment.journal_id != attempt.journal_id
        || payment.currency_id != attempt.currency_id
        || payment.partner_id != attempt.partner_id
        || payment.amount != attempt.amount.abs()
        || payment.date != attempt.date
        || line.amount != attempt.amount
        || line.date != attempt.date
        || line.journal_id != attempt.journal_id
        || statement.journal_id != attempt.journal_id
        || statement.currency_id != attempt.currency_id
    {
        return Err("bank settlement scope or immutable financial identity changed".to_string());
    }
    Ok(ScopedSettlement {
        attempt,
        statement,
        line,
        payment,
    })
}

fn normalized_reason(reason: &str) -> Result<String, String> {
    if reason.trim().is_empty() || reason.len() > 2000 {
        return Err("bank settlement recovery requires a reason of at most 2000 bytes".to_string());
    }
    Ok(reason.trim().to_string())
}

fn task_is_cancelled(ctx: &ReducerContext, task: &WorkflowHumanTask) -> bool {
    task.status == WorkflowHumanTaskStatus::Cancelled
        || ctx
            .db
            .workflow_instance()
            .id()
            .find(&task.workflow_instance_id)
            .is_some_and(|instance| instance.state == WorkflowInstanceState::Cancelled)
}

fn require_closed_post_approval(
    ctx: &ReducerContext,
    scope: &ScopedSettlement,
) -> Result<(), String> {
    if scope.statement.state != BankStatementState::Open
        || scope.line.payment_ids != vec![scope.payment.id]
        || scope.line.is_reconciled
        || !scope.line.move_ids.is_empty()
        || scope.line.move_id.is_some()
        || scope.line.amount_residual != scope.line.amount
        || scope.payment.state != PaymentState::NotPaid
        || scope.payment.move_id.is_some()
        || scope.payment.reversal_move_id.is_some()
        || !scope.payment.reconciled_invoice_ids.is_empty()
        || !scope.payment.reconciled_bill_ids.is_empty()
        || scope.attempt.closed_at.is_some()
    {
        return Err(
            "only an active unposted bank settlement with a closed approval can be recovered"
                .to_string(),
        );
    }
    let tasks: Vec<_> = ctx
        .db
        .workflow_human_task()
        .human_task_by_org()
        .filter(&scope.attempt.organization_id)
        .filter(|task| {
            task.company_id == scope.attempt.company_id
                && task.subject_id == scope.payment.id
                && task.subject_model == "account_payment"
                && task
                    .guarded_action
                    .as_ref()
                    .is_some_and(|action| action.key == GuardedActionKey::PostPayment)
        })
        .collect();
    use crate::workflow::action_registry::guarded_action_receipt;
    if ctx.db.account_move_line().iter().any(|row| {
        row.organization_id == scope.attempt.organization_id
            && row.payment_id == Some(scope.payment.id)
    }) || ctx
        .db
        .guarded_action_receipt()
        .guarded_action_receipt_by_subject()
        .filter(&scope.payment.id)
        .any(|row| {
            row.organization_id == scope.attempt.organization_id
                && row.company_id == scope.attempt.company_id
                && row.action == GuardedActionKey::PostPayment
        })
    {
        return Err(
            "unposted bank payment has conflicting financial execution evidence".to_string(),
        );
    }
    if tasks.is_empty()
        || tasks.iter().any(|task| {
            matches!(
                task.status,
                WorkflowHumanTaskStatus::Approved | WorkflowHumanTaskStatus::Completed
            )
        })
        || tasks.iter().any(|task| {
            !task_is_cancelled(ctx, task)
                && !matches!(
                    task.status,
                    WorkflowHumanTaskStatus::Rejected | WorkflowHumanTaskStatus::Invalidated
                )
        })
    {
        return Err(
            "payment approval must be rejected, invalidated or cancelled before explicit recovery"
                .to_string(),
        );
    }
    Ok(())
}

fn retire_unposted(
    ctx: &ReducerContext,
    scope: &ScopedSettlement,
    key: &str,
    reason: &str,
) -> Result<BankStatementSettlementAttempt, String> {
    ctx.db.account_payment().id().update(AccountPayment {
        state: PaymentState::Reversed,
        ..scope.payment.clone()
    });
    ctx.db
        .account_bank_statement_line()
        .id()
        .update(AccountBankStatementLine {
            payment_ids: Vec::new(),
            move_ids: Vec::new(),
            move_id: None,
            is_reconciled: false,
            amount_residual: scope.line.amount,
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            ..scope.line.clone()
        });
    let attempt =
        ctx.db
            .bank_statement_settlement_attempt()
            .id()
            .update(BankStatementSettlementAttempt {
                status: "abandoned".to_string(),
                closed_at: Some(ctx.timestamp),
                recovery_key: Some(key.to_string()),
                recovery_reason: Some(reason.to_string()),
                ..scope.attempt.clone()
            });
    write_hint(ctx, &attempt)?;
    Ok(attempt)
}

fn recovery_audit(
    ctx: &ReducerContext,
    attempt: &BankStatementSettlementAttempt,
    action: &'static str,
    reason: &str,
) {
    write_audit_log_v2(ctx,attempt.organization_id,AuditLogParams {company_id:Some(attempt.company_id),table_name:"account_bank_statement_line",
        record_id:attempt.line_id,action,old_values:None,new_values:Some(serde_json::json!({"attemptId":attempt.id,"paymentId":attempt.payment_id,"status":attempt.status}).to_string()),
        changed_fields:vec!["bankSettlement".to_string(),"payment_ids".to_string(),"is_reconciled".to_string()],metadata:Some(serde_json::json!({"reason":reason}).to_string())});
}

#[spacetimedb::reducer]
pub fn abandon_bank_statement_settlement(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    line_id: u64,
    params: AbandonBankStatementSettlementParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_bank_statement_line", "write")?;
    check_permission(ctx, organization_id, "payment", "cancel")?;
    let reason = normalized_reason(&params.reason)?;
    let scope = scoped_settlement(ctx, organization_id, company_id, line_id, params.payment_id)?;
    let fingerprint = format!("{line_id}:{}:{reason}", params.payment_id);
    if let Some(id) = replayed_result(
        ctx,
        organization_id,
        company_id,
        "abandon_bank_statement_settlement",
        &params.idempotency_key,
        &fingerprint,
    )? {
        if id != scope.attempt.id {
            return Err("bank abandon receipt does not match the reviewed attempt".to_string());
        }
        return Ok(());
    }
    require_closed_post_approval(ctx, &scope)?;
    let attempt = retire_unposted(ctx, &scope, &params.idempotency_key, &reason)?;
    record_result(
        ctx,
        organization_id,
        company_id,
        "abandon_bank_statement_settlement",
        params.idempotency_key,
        fingerprint,
        "bank_statement_settlement_attempt",
        attempt.id,
    );
    recovery_audit(ctx, &attempt, "ABANDON_BANK_SETTLEMENT", &reason);
    BankSettlementCommitSnapshot { attempt }.record(ctx, "erp.abandon_bank_statement_settlement")
}

#[spacetimedb::reducer]
pub fn resubmit_bank_statement_settlement(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    line_id: u64,
    params: ResubmitBankStatementSettlementParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_bank_statement_line", "write")?;
    check_permission(ctx, organization_id, "payment", "cancel")?;
    check_permission(ctx, organization_id, "payment", "create")?;
    check_permission(ctx, organization_id, "payment", "post")?;
    check_permission(ctx, organization_id, "payment", "reconcile")?;
    check_permission(ctx, organization_id, "account_move", "write")?;
    let reason = normalized_reason(&params.reason)?;
    let scope = scoped_settlement(ctx, organization_id, company_id, line_id, params.payment_id)?;
    let mut ids = params.move_ids.clone();
    ids.sort_unstable();
    let fingerprint = format!("{line_id}:{}:{ids:?}:{reason}", params.payment_id);
    if let Some(id) = replayed_result(
        ctx,
        organization_id,
        company_id,
        "resubmit_bank_statement_settlement",
        &params.idempotency_key,
        &fingerprint,
    )? {
        let attempt = ctx
            .db
            .bank_statement_settlement_attempt()
            .id()
            .find(&id)
            .ok_or("resubmitted bank attempt missing")?;
        if attempt.organization_id != organization_id
            || attempt.company_id != company_id
            || attempt.previous_payment_id != Some(params.payment_id)
            || attempt.line_id != line_id
        {
            return Err("bank resubmission receipt scope changed".to_string());
        }
        return Ok(());
    }
    require_closed_post_approval(ctx, &scope)?;
    let fresh_line = AccountBankStatementLine {
        payment_ids: Vec::new(),
        move_ids: Vec::new(),
        move_id: None,
        ..scope.line.clone()
    };
    let selection_params = ReconcileAccountBankStatementLineParams {
        move_ids: params.move_ids,
        amount_residual: 0.0,
    };
    let selection = super::bank_reconciliation::bank_settlement_selection(
        ctx,
        &scope.statement,
        &fresh_line,
        &selection_params,
        None,
    )?;
    prepare_attempt(
        ctx,
        &scope.statement,
        &fresh_line,
        &selection.line_ids,
        selection.partner_id,
    )?;
    let gate_snapshot = crate::workflow::action_registry::snapshot_guarded_action(
        ctx,
        organization_id,
        company_id,
        GuardedActionKey::PostPayment,
        GUARDED_ACTION_SCHEMA_VERSION,
        GuardedActionInput::PostPayment {
            payment_id: params.payment_id,
        },
    )?;
    crate::workflow::approval_gate::preflight_guarded_action_gate(
        ctx,
        organization_id,
        company_id,
        &gate_snapshot,
    )?;
    retire_unposted(ctx, &scope, &params.idempotency_key, &reason)?;
    super::bank_reconciliation::reconcile_account_bank_statement_line(
        ctx,
        organization_id,
        company_id,
        line_id,
        selection_params,
    )?;
    let new_line = ctx
        .db
        .account_bank_statement_line()
        .id()
        .find(&line_id)
        .ok_or("resubmitted bank line missing")?;
    let new_payment_id = *new_line
        .payment_ids
        .first()
        .ok_or("resubmitted bank payment missing")?;
    let mut attempt =
        attempt_for_payment(ctx, new_payment_id).ok_or("resubmitted bank snapshot missing")?;
    attempt.previous_payment_id = Some(params.payment_id);
    attempt.recovery_key = Some(params.idempotency_key.clone());
    attempt.recovery_reason = Some(reason.clone());
    let attempt = ctx
        .db
        .bank_statement_settlement_attempt()
        .id()
        .update(attempt);
    write_hint(ctx, &attempt)?;
    record_result(
        ctx,
        organization_id,
        company_id,
        "resubmit_bank_statement_settlement",
        params.idempotency_key,
        fingerprint,
        "bank_statement_settlement_attempt",
        attempt.id,
    );
    recovery_audit(ctx, &attempt, "RESUBMIT_BANK_SETTLEMENT", &reason);
    BankSettlementCommitSnapshot { attempt }.record(ctx, "erp.resubmit_bank_statement_settlement")
}

fn current_reversal(
    ctx: &ReducerContext,
    attempt: &BankStatementSettlementAttempt,
) -> Result<BankStatementSettlementReversal, String> {
    let request = attempt
        .reversal_request_id
        .and_then(|id| ctx.db.bank_statement_settlement_reversal().id().find(&id))
        .ok_or("bank settlement reversal request missing")?;
    if request.organization_id != attempt.organization_id
        || request.company_id != attempt.company_id
        || request.attempt_id != attempt.id
        || request.line_id != attempt.line_id
        || request.payment_id != attempt.payment_id
    {
        return Err("bank settlement reversal request scope changed".to_string());
    }
    Ok(request)
}

fn reversal_permissions(ctx: &ReducerContext, organization_id: u64) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_bank_statement_line", "write")?;
    check_permission(ctx, organization_id, "account_bank_statement", "write")?;
    check_permission(ctx, organization_id, "payment", "reverse")?;
    check_permission(ctx, organization_id, "account_move", "write")
}

#[spacetimedb::reducer]
pub fn reverse_bank_statement_settlement(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    line_id: u64,
    params: ReverseBankStatementSettlementParams,
) -> Result<(), String> {
    reversal_permissions(ctx, organization_id)?;
    let reason = normalized_reason(&params.reason)?;
    let scope = scoped_settlement(ctx, organization_id, company_id, line_id, params.payment_id)?;
    let fingerprint = format!(
        "{line_id}:{}:{}:{reason}",
        params.payment_id,
        params.date.to_micros_since_unix_epoch()
    );
    let replay = replayed_result(
        ctx,
        organization_id,
        company_id,
        "reverse_bank_statement_settlement",
        &params.idempotency_key,
        &fingerprint,
    )?;
    let mut attempt = scope.attempt.clone();
    let request = if let Some(id) = replay {
        let request = ctx
            .db
            .bank_statement_settlement_reversal()
            .id()
            .find(&id)
            .ok_or("bank reversal receipt points to a missing request")?;
        if request.attempt_id != attempt.id
            || request.organization_id != organization_id
            || request.company_id != company_id
        {
            return Err("bank reversal receipt scope changed".to_string());
        }
        if request.status != "reversal_awaiting_approval" {
            return Ok(());
        }
        if attempt.reversal_request_id != Some(request.id) {
            return Err("bank reversal request was superseded".to_string());
        }
        request
    } else {
        if let Some(_) = attempt.reversal_request_id {
            let previous = current_reversal(ctx, &attempt)?;
            if !matches!(
                previous.status.as_str(),
                "reversal_rejected" | "reversal_invalidated" | "reversal_cancelled"
            ) {
                return Err(
                    "complete the pending bank reversal using its original reviewed request"
                        .to_string(),
                );
            }
        }
        let next_id = ctx
            .db
            .bank_statement_settlement_reversal()
            .iter()
            .map(|row| row.id)
            .max()
            .unwrap_or(0)
            .checked_add(1)
            .ok_or("bank reversal request id exhausted")?;
        let proposed = BankStatementSettlementReversal {
            id: next_id,
            organization_id,
            company_id,
            attempt_id: attempt.id,
            line_id,
            payment_id: params.payment_id,
            idempotency_key: params.idempotency_key.clone(),
            date: params.date,
            reason: reason.clone(),
            status: "reversal_awaiting_approval".to_string(),
            reversal_move_id: None,
            created_at: ctx.timestamp,
            created_by: ctx.sender(),
        };
        super::bank_settlement_reversal::prepare_bank_settlement_reversal(
            ctx, &attempt, &proposed,
        )?;
        crate::workflow::action_registry::preflight_bank_settlement_reversal_gate(
            ctx,
            organization_id,
            company_id,
            params.payment_id,
            proposed.id,
        )?;
        let request = ctx.db.bank_statement_settlement_reversal().insert(proposed);
        attempt.reversal_request_id = Some(request.id);
        attempt.status = "reversal_awaiting_approval".to_string();
        attempt = ctx
            .db
            .bank_statement_settlement_attempt()
            .id()
            .update(attempt);
        write_hint(ctx, &attempt)?;
        record_result(
            ctx,
            organization_id,
            company_id,
            "reverse_bank_statement_settlement",
            params.idempotency_key,
            fingerprint,
            "bank_statement_settlement_reversal",
            request.id,
        );
        request
    };
    // Recheck all financial ownership and the explicit reversal period even on a retry.
    super::bank_settlement_reversal::prepare_bank_settlement_reversal(ctx, &attempt, &request)?;
    if matches!(
        request_guarded_action(
            ctx,
            organization_id,
            RequestGuardedActionParams {
                company_id,
                action: GuardedActionKey::ReverseBankStatementSettlement,
                action_version: GUARDED_ACTION_SCHEMA_VERSION,
                input: GuardedActionInput::ReverseBankStatementSettlement {
                    payment_id: params.payment_id
                },
                idempotency_key: format!("bank-settlement-reversal:{}", request.id),
                correlation_id: format!("bank-settlement-reversal:{}", request.id),
                causation_id: None
            }
        )?,
        GuardedActionGateOutcome::HumanTaskCreated { .. }
    ) {
        return BankSettlementCommitSnapshot { attempt }
            .record(ctx, "erp.reverse_bank_statement_settlement");
    }
    execute_bank_statement_settlement_reversal(ctx, organization_id, company_id, params.payment_id)
}

/// Closed guarded adapter: the action registry is the only approval bypass caller.
pub(crate) fn execute_bank_statement_settlement_reversal(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    payment_id: u64,
) -> Result<(), String> {
    reversal_permissions(ctx, organization_id)?;
    let attempt = attempt_for_payment(ctx, payment_id).ok_or("bank reversal attempt missing")?;
    let scope = scoped_settlement(
        ctx,
        organization_id,
        company_id,
        attempt.line_id,
        payment_id,
    )?;
    let mut request = current_reversal(ctx, &scope.attempt)?;
    if request.status != "reversal_awaiting_approval"
        || scope.attempt.status != "reversal_awaiting_approval"
    {
        return Err("bank reversal request is no longer awaiting execution".to_string());
    }
    let prepared = super::bank_settlement_reversal::prepare_bank_settlement_reversal(
        ctx,
        &scope.attempt,
        &request,
    )?;
    let allocation_applied = scope.line.is_reconciled;
    let reversal_move_id = super::bank_settlement_reversal::apply_bank_settlement_reversal(
        ctx,
        &scope.attempt,
        &request,
        prepared,
    )?;
    ctx.db
        .account_bank_statement_line()
        .id()
        .update(AccountBankStatementLine {
            payment_ids: Vec::new(),
            move_ids: Vec::new(),
            move_id: None,
            is_reconciled: false,
            amount_residual: scope.line.amount,
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            ..scope.line
        });
    if scope.statement.state == BankStatementState::Posted {
        ctx.db
            .account_bank_statement()
            .id()
            .update(AccountBankStatement {
                state: BankStatementState::Open,
                date_done: None,
                write_uid: Some(ctx.sender()),
                write_date: Some(ctx.timestamp),
                ..scope.statement
            });
    }
    request.status = "reversed".to_string();
    request.reversal_move_id = Some(reversal_move_id);
    ctx.db
        .bank_statement_settlement_reversal()
        .id()
        .update(request.clone());
    let attempt =
        ctx.db
            .bank_statement_settlement_attempt()
            .id()
            .update(BankStatementSettlementAttempt {
                status: if allocation_applied {
                    "reversed"
                } else {
                    "reversed_unallocated"
                }
                .to_string(),
                closed_at: Some(ctx.timestamp),
                ..scope.attempt
            });
    write_hint(ctx, &attempt)?;
    recovery_audit(ctx, &attempt, "REVERSE_BANK_SETTLEMENT", &request.reason);
    BankSettlementCommitSnapshot { attempt }.record(ctx, "erp.reverse_bank_statement_settlement")
}

/// Complete authoritative material, including request identity, is pinned by approval.
pub(crate) fn reversal_material(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    payment_id: u64,
) -> Result<(String, f64, u64, String, u64), String> {
    let attempt = attempt_for_payment(ctx, payment_id).ok_or("bank reversal attempt missing")?;
    let scope = scoped_settlement(
        ctx,
        organization_id,
        company_id,
        attempt.line_id,
        payment_id,
    )?;
    let request = current_reversal(ctx, &attempt)?;
    let mut rows = Vec::new();
    macro_rules! capture {
        ($row:expr) => {
            rows.push(
                serde_json::to_value(spacetimedb_sats::serde::SerdeWrapper::from_ref(&$row))
                    .map_err(|error| format!("cannot snapshot bank reversal: {error}"))?,
            );
        };
    }
    capture!(attempt);
    capture!(request);
    capture!(scope.payment);
    capture!(scope.statement);
    capture!(scope.line);
    let allocation_applied = scope.line.is_reconciled || attempt.status == "reversed";
    let mut move_ids: Vec<_> = if allocation_applied {
        attempt
            .invoice_snapshots
            .iter()
            .map(|row| row.move_id)
            .collect()
    } else {
        Vec::new()
    };
    move_ids.extend(scope.payment.move_id);
    move_ids.extend(scope.payment.reversal_move_id);
    move_ids.sort_unstable();
    move_ids.dedup();
    for id in move_ids {
        let invoice = ctx
            .db
            .account_move()
            .id()
            .find(&id)
            .ok_or("bank reversal material move missing")?;
        capture!(invoice);
        let mut lines: Vec<_> = ctx
            .db
            .account_move_line()
            .move_line_by_move()
            .filter(&id)
            .collect();
        lines.sort_by_key(|row| row.id);
        for row in lines {
            capture!(row);
        }
    }
    for delta in attempt
        .sale_order_deltas
        .iter()
        .filter(|_| allocation_applied)
    {
        let order = ctx
            .db
            .sale_order()
            .id()
            .find(&delta.sale_order_id)
            .ok_or("bank reversal material order missing")?;
        capture!(order);
    }
    Ok((
        serde_json::Value::Array(rows).to_string(),
        scope.payment.amount,
        scope.payment.currency_id,
        format!("{:?}", scope.payment.state),
        request.id,
    ))
}

/// Project closed approval outcomes for reloadable bank workflow controls.
pub(crate) fn synchronize_bank_task(
    ctx: &ReducerContext,
    task: &WorkflowHumanTask,
) -> Result<(), String> {
    let Some(action) = task.guarded_action.as_ref() else {
        return Ok(());
    };
    if task.subject_model != "account_payment" {
        return Ok(());
    }
    let Some(mut attempt) = attempt_for_payment(ctx, task.subject_id) else {
        return Ok(());
    };
    if attempt.organization_id != task.organization_id || attempt.company_id != task.company_id {
        return Ok(());
    }
    if matches!(
        task.status,
        WorkflowHumanTaskStatus::Approved | WorkflowHumanTaskStatus::Completed
    ) && matches!(
        action.key,
        GuardedActionKey::PostPayment | GuardedActionKey::ReverseBankStatementSettlement
    ) {
        return record_decided_bank_approval(ctx, attempt);
    }
    if attempt.closed_at.is_some() {
        return Ok(());
    }
    let suffix = if task_is_cancelled(ctx, task) {
        "cancelled"
    } else {
        match task.status {
            WorkflowHumanTaskStatus::Rejected => "rejected",
            WorkflowHumanTaskStatus::Invalidated => "invalidated",
            WorkflowHumanTaskStatus::Open | WorkflowHumanTaskStatus::Claimed => {
                return record_decided_bank_approval(ctx, attempt)
            }
            _ => return Ok(()),
        }
    };
    match action.key {
        GuardedActionKey::PostPayment => {
            let payment = ctx
                .db
                .account_payment()
                .id()
                .find(&attempt.payment_id)
                .ok_or("bank approval payment missing")?;
            if payment.state != PaymentState::NotPaid || payment.move_id.is_some() {
                return Ok(());
            }
            attempt.status = format!("approval_{suffix}");
        }
        GuardedActionKey::ReverseBankStatementSettlement => {
            let mut request = current_reversal(ctx, &attempt)?;
            if request.status != "reversal_awaiting_approval" {
                return Ok(());
            }
            let snapshot = crate::workflow::action_registry::snapshot_guarded_action(
                ctx,
                task.organization_id,
                task.company_id,
                action.key.clone(),
                action.schema_version,
                GuardedActionInput::ReverseBankStatementSettlement {
                    payment_id: task.subject_id,
                },
            )?;
            if snapshot.condition_snapshot.subject_revision_hash != task.condition_revision_hash {
                return Ok(());
            }
            request.status = format!("reversal_{suffix}");
            attempt.status = request.status.clone();
            ctx.db
                .bank_statement_settlement_reversal()
                .id()
                .update(request);
        }
        _ => return Ok(()),
    }
    let attempt = ctx
        .db
        .bank_statement_settlement_attempt()
        .id()
        .update(attempt);
    write_hint(ctx, &attempt)?;
    if task_is_cancelled(ctx, task) {
        record_cancelled_bank_approval(ctx, attempt)
    } else if task.status == WorkflowHumanTaskStatus::Invalidated {
        record_invalidated_bank_approval(ctx, attempt)
    } else {
        record_decided_bank_approval(ctx, attempt)
    }
}

pub(crate) fn synchronize_cancelled_bank_workflow(
    ctx: &ReducerContext,
    instance_id: u64,
) -> Result<(), String> {
    for task in ctx
        .db
        .workflow_human_task()
        .human_task_by_instance()
        .filter(&instance_id)
    {
        synchronize_bank_task(ctx, &task)?;
    }
    Ok(())
}

fn record_cancelled_bank_approval(
    ctx: &ReducerContext,
    attempt: BankStatementSettlementAttempt,
) -> Result<(), String> {
    BankSettlementCommitSnapshot { attempt }.record(ctx, "erp.cancel_workflow")
}
fn record_invalidated_bank_approval(
    ctx: &ReducerContext,
    attempt: BankStatementSettlementAttempt,
) -> Result<(), String> {
    BankSettlementCommitSnapshot { attempt }.record(ctx, "erp.invalidate_workflow_human_task")
}
fn record_decided_bank_approval(
    ctx: &ReducerContext,
    attempt: BankStatementSettlementAttempt,
) -> Result<(), String> {
    BankSettlementCommitSnapshot { attempt }.record(ctx, "erp.decide_workflow_human_task")
}

/// Preserve bank approval claim evidence independently of financial status.
pub(crate) fn record_bank_task_claim(
    ctx: &ReducerContext,
    task: &WorkflowHumanTask,
) -> Result<(), String> {
    let Some(attempt) = attempt_for_payment(ctx, task.subject_id) else {
        return Ok(());
    };
    if task.subject_model != "account_payment"
        || task.organization_id != attempt.organization_id
        || task.company_id != attempt.company_id
    {
        return Ok(());
    }
    BankSettlementCommitSnapshot { attempt }.record(ctx, "erp.claim_workflow_human_task")
}

/// Preserve comments/revisions on bank approval tasks for exact replay after restore.
pub(crate) fn record_bank_task_comment(
    ctx: &ReducerContext,
    task: &WorkflowHumanTask,
) -> Result<(), String> {
    let Some(attempt) = attempt_for_payment(ctx, task.subject_id) else {
        return Ok(());
    };
    if task.subject_model != "account_payment"
        || task.organization_id != attempt.organization_id
        || task.company_id != attempt.company_id
    {
        return Ok(());
    }
    BankSettlementCommitSnapshot { attempt }.record(ctx, "erp.add_workflow_human_task_comment")
}
