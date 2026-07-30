/// Operational payment management — mobile money, bank, and cash accounts.
///
/// This module adds provider-aware payment accounts and operational transactions.
/// It extends but does not replace `accounting::payments::AccountPayment`, which
/// remains the ledger authority. A posted `PaymentTransaction` links to one
/// `AccountPayment` and its `AccountMove`.
use std::collections::HashSet;

use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::chart_of_accounts::account_account;
use crate::accounting::idempotency::{record_result, replayed_result};
use crate::accounting::journal_entries::{
    account_move, account_move_line, insert_draft_account_move_line,
    is_receivable_or_payable_line_type, AccountMove, AccountMoveLine,
};
use crate::accounting::payments::{
    account_payment, insert_balanced_payment_lines_and_post, payment_line_params, AccountPayment,
};
use crate::accounting::relations::{
    require_active_account, require_active_currency_id, require_active_journal,
};
use crate::core::organization::require_company_in_organization;
use crate::core::reference::{legacy_currency_code_for_id, require_currency_row};
use crate::crm::contacts::contact;
use crate::documents::documents::document;
use crate::helpers::{check_permission, next_doc_number, write_audit_log_v2, AuditLogParams};
use crate::types::{
    AccountInternalGroup, AccountMoveState, AccountTypeInternal, MoveType, PartnerType,
    PaymentDirection, PaymentFeeBearer, PaymentProviderCode, PaymentState,
    PaymentTransactionStatus, PaymentType,
};
use crate::workflow::action_registry::{
    GuardedActionInput, GuardedActionKey, GUARDED_ACTION_SCHEMA_VERSION,
};
use crate::workflow::approval_gate::{
    request_guarded_action, GuardedActionGateOutcome, RequestGuardedActionParams,
};

// ── Tables ────────────────────────────────────────────────────────────────────

/// Payment account — a company-owned cash drawer, bank account, or mobile wallet.
/// Maps to an existing `AccountJournal` so balances follow the ledger.
#[spacetimedb::table(
    accessor = payment_account,
    public,
    index(accessor = payment_account_by_org, btree(columns = [organization_id])),
    index(accessor = payment_account_by_company, btree(columns = [company_id])),
    index(accessor = payment_account_by_provider, btree(columns = [company_id, provider_code])),
    index(accessor = payment_account_by_journal, btree(columns = [account_journal_id]))
)]
pub struct PaymentAccount {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub provider_code: PaymentProviderCode,
    /// Human-readable name (e.g. "MTN Main Wallet").
    pub name: String,
    /// Optional provider-specific label when `provider_code` is `Other`.
    pub provider_label: Option<String>,
    /// Normalized account / phone reference used for matching.
    pub reference_normalized: Option<String>,
    /// Masked reference safe for display and masked outputs.
    pub reference_masked: Option<String>,
    pub currency_id: u64,
    /// Linked accounting journal; every balance change is ledger-backed.
    pub account_journal_id: u64,
    /// Optional dedicated fee expense account.
    pub fee_account_id: Option<u64>,
    /// Optional clearing/suspense account for unsettled funds.
    pub clearing_account_id: Option<u64>,
    pub active: bool,
    pub is_primary: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub created_by: Identity,
    pub updated_by: Identity,
    pub archived_at: Option<Timestamp>,
    pub metadata: Option<String>,
}

/// Operational payment transaction — a provider event that settles against
/// invoices/bills via `PaymentReconciliation`. Links to `AccountPayment` on post.
#[spacetimedb::table(
    accessor = payment_transaction,
    public,
    index(accessor = payment_transaction_by_org, btree(columns = [organization_id])),
    index(accessor = payment_transaction_by_company, btree(columns = [company_id])),
    index(accessor = payment_transaction_by_account, btree(columns = [payment_account_id])),
    index(accessor = payment_transaction_by_status, btree(columns = [status]))
)]
pub struct PaymentTransaction {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub payment_account_id: u64,
    pub direction: PaymentDirection,
    pub partner_type: PartnerType,
    pub partner_id: u64,
    /// External provider reference (e.g. transaction ID).
    pub external_reference: Option<String>,
    /// Normalized fingerprint for duplicate detection (empty when absent).
    pub reference_fingerprint: String,
    pub gross_external_amount: f64,
    pub settlement_amount: f64,
    pub net_account_amount: f64,
    pub currency_id: u64,
    pub occurred_at: Timestamp,
    pub status: PaymentTransactionStatus,
    /// Linked ledger payment after posting.
    pub account_payment_id: Option<u64>,
    /// Source entity that spawned this transaction (invoice, bill, statement line, import).
    pub source_entity: Option<String>,
    pub source_entity_id: Option<u64>,
    pub evidence_document_ids: Vec<u64>,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub created_by: Identity,
    pub updated_by: Identity,
    pub voided_at: Option<Timestamp>,
    pub metadata: Option<String>,
}

/// Fee component attached to a payment transaction.
#[spacetimedb::table(
    accessor = payment_fee,
    public,
    index(accessor = payment_fee_by_transaction, btree(columns = [payment_transaction_id])),
    index(accessor = payment_fee_by_org, btree(columns = [organization_id]))
)]
pub struct PaymentFee {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub payment_transaction_id: u64,
    pub bearer: PaymentFeeBearer,
    pub amount: f64,
    pub currency_id: u64,
    pub fee_account_id: Option<u64>,
    pub tax_account_id: Option<u64>,
    pub tax_amount: f64,
    pub provider_reference: Option<String>,
    pub created_at: Timestamp,
    pub created_by: Identity,
    pub metadata: Option<String>,
}

/// Allocation from a posted payment transaction to a receivable/payable move line.
#[spacetimedb::table(
    accessor = payment_reconciliation,
    public,
    index(accessor = reconciliation_by_transaction, btree(columns = [payment_transaction_id])),
    index(accessor = reconciliation_by_move_line, btree(columns = [allocated_move_line_id])),
    index(accessor = reconciliation_by_org, btree(columns = [organization_id]))
)]
#[derive(Clone)]
pub struct PaymentReconciliation {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub payment_transaction_id: u64,
    pub account_payment_id: u64,
    pub allocated_move_line_id: u64,
    pub allocated_amount: f64,
    pub currency_id: u64,
    pub residual_before: f64,
    pub residual_after: f64,
    pub write_off_amount: f64,
    pub write_off_account_id: Option<u64>,
    pub write_off_move_id: Option<u64>,
    pub is_reversal: bool,
    pub reversed_reconciliation_id: Option<u64>,
    pub created_at: Timestamp,
    pub created_by: Identity,
    pub metadata: Option<String>,
}

/// Correction relationship for a posted payment transaction.
#[spacetimedb::table(
    accessor = payment_reversal,
    public,
    index(accessor = reversal_by_original, btree(columns = [original_transaction_id])),
    index(accessor = reversal_by_org, btree(columns = [organization_id]))
)]
pub struct PaymentReversal {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub original_transaction_id: u64,
    pub original_account_payment_id: u64,
    pub correcting_transaction_id: u64,
    pub correcting_account_payment_id: u64,
    pub reason: Option<String>,
    pub created_at: Timestamp,
    pub created_by: Identity,
    pub metadata: Option<String>,
}

// ── Params ────────────────────────────────────────────────────────────────────

#[derive(SpacetimeType)]
pub struct CreatePaymentAccountParams {
    pub company_id: u64,
    pub provider_code: PaymentProviderCode,
    pub name: String,
    pub provider_label: Option<String>,
    pub reference_raw: Option<String>,
    pub currency_id: u64,
    pub account_journal_id: u64,
    pub fee_account_id: Option<u64>,
    pub clearing_account_id: Option<u64>,
    pub is_primary: bool,
    pub metadata: Option<String>,
}

/// `None` outer = no change; `Some(None)` clears a nullable field.
#[derive(SpacetimeType)]
pub struct UpdatePaymentAccountParams {
    pub name: Option<String>,
    pub provider_label: Option<Option<String>>,
    pub reference_raw: Option<Option<String>>,
    pub fee_account_id: Option<Option<u64>>,
    pub clearing_account_id: Option<Option<u64>>,
    pub active: Option<bool>,
    pub is_primary: Option<bool>,
    pub metadata: Option<Option<String>>,
}

#[derive(SpacetimeType, Clone)]
pub struct CreatePaymentTransactionParams {
    pub company_id: u64,
    pub payment_account_id: u64,
    pub direction: PaymentDirection,
    pub partner_type: PartnerType,
    pub partner_id: u64,
    pub external_reference: Option<String>,
    pub gross_external_amount: f64,
    pub settlement_amount: f64,
    pub net_account_amount: f64,
    pub currency_id: u64,
    pub occurred_at: Option<Timestamp>,
    pub source_entity: Option<String>,
    pub source_entity_id: Option<u64>,
    pub evidence_document_ids: Vec<u64>,
    pub metadata: Option<String>,
}

/// `None` outer = no change; `Some(None)` clears nullable fields.
#[derive(SpacetimeType)]
pub struct UpdatePaymentTransactionParams {
    pub external_reference: Option<Option<String>>,
    pub gross_external_amount: Option<f64>,
    pub settlement_amount: Option<f64>,
    pub net_account_amount: Option<f64>,
    pub occurred_at: Option<Timestamp>,
    pub evidence_document_ids: Option<Vec<u64>>,
    pub metadata: Option<Option<String>>,
}

#[derive(SpacetimeType)]
pub struct CreatePaymentFeeParams {
    pub company_id: u64,
    pub payment_transaction_id: u64,
    pub bearer: PaymentFeeBearer,
    pub amount: f64,
    pub fee_account_id: Option<u64>,
    pub tax_account_id: Option<u64>,
    pub tax_amount: f64,
    pub provider_reference: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct AllocatePaymentParams {
    pub idempotency_key: String,
    pub company_id: u64,
    pub payment_transaction_id: u64,
    pub allocated_move_line_id: u64,
    pub allocated_amount: f64,
    pub currency_id: u64,
    pub write_off_amount: f64,
    pub write_off_account_id: Option<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType)]
pub struct ReversePaymentTransactionParams {
    pub company_id: u64,
    pub reason: Option<String>,
    pub metadata: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn normalize_reference(raw: &Option<String>) -> (Option<String>, Option<String>) {
    match raw {
        Some(r) => {
            let normalized = r.trim().to_lowercase().replace([' ', '-', '_'], "");
            let masked = if normalized.len() > 4 {
                format!(
                    "{}****{}",
                    &normalized[..2],
                    &normalized[normalized.len() - 2..]
                )
            } else {
                "****".to_string()
            };
            (Some(normalized), Some(masked))
        }
        None => (None, None),
    }
}

fn fingerprint_reference(raw: &Option<String>) -> String {
    raw.as_ref()
        .map(|r| r.trim().to_lowercase().replace([' ', '-', '_'], ""))
        .unwrap_or_default()
}

fn validate_payment_evidence_documents(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    document_ids: &[u64],
) -> Result<(), String> {
    let mut seen = HashSet::with_capacity(document_ids.len());
    for document_id in document_ids {
        if !seen.insert(*document_id) {
            return Err("evidence_document_ids contains duplicates".to_string());
        }
        let document = ctx
            .db
            .document()
            .id()
            .find(document_id)
            .ok_or("Payment evidence document not found")?;
        if document.organization_id != organization_id
            || document.company_id.is_some_and(|id| id != company_id)
            || document.is_deleted
        {
            return Err(
                "Payment evidence document is not active in this organization and company"
                    .to_string(),
            );
        }
    }
    Ok(())
}

fn validate_payment_transaction_invariants(
    gross: f64,
    settlement: f64,
    net: f64,
    fees: &[PaymentFee],
) -> Result<(), String> {
    if gross <= 0.0 {
        return Err("gross_external_amount must be positive".to_string());
    }
    if settlement <= 0.0 {
        return Err("settlement_amount must be positive".to_string());
    }
    if net < 0.0 {
        return Err("net_account_amount must be non-negative".to_string());
    }
    let fee_total: f64 = fees.iter().map(|f| f.amount).sum();
    let expected_fee_total = gross - net;
    if (fee_total - expected_fee_total).abs() > 1e-6 {
        return Err(format!(
            "Fee total {:.2} does not match gross - net = {:.2}",
            fee_total, expected_fee_total
        ));
    }
    Ok(())
}

/// Build and insert the ledger `AccountPayment` and balanced `AccountMove` for a
/// posted operational transaction. Returns the created `AccountPayment` id.
fn post_ledger_payment(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    account: &PaymentAccount,
    transaction: &PaymentTransaction,
) -> Result<u64, String> {
    let payment_type = match transaction.direction {
        PaymentDirection::Inbound => PaymentType::InBound,
        PaymentDirection::Outbound => PaymentType::OutBound,
    };

    let payment = ctx.db.account_payment().insert(AccountPayment {
        id: 0,
        organization_id,
        company_id,
        name: None,
        move_id: None,
        payment_type,
        partner_type: transaction.partner_type.clone(),
        partner_id: transaction.partner_id,
        amount: transaction.settlement_amount,
        currency_id: transaction.currency_id,
        date: transaction.occurred_at,
        journal_id: account.account_journal_id,
        ref_: transaction.external_reference.clone(),
        memo: transaction.external_reference.clone(),
        reconciled_invoice_ids: vec![],
        reconciled_bill_ids: vec![],
        state: PaymentState::NotPaid,
        created_at: ctx.timestamp,
        create_uid: ctx.sender(),
    });

    let name = next_doc_number(ctx, "PAY");
    let amount = transaction.settlement_amount;

    // Draft first — never flip Posted with empty lines.
    let move_record = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: name.clone(),
        ref_: transaction.external_reference.clone(),
        move_type: MoveType::Entry,
        auto_post: false,
        state: AccountMoveState::Draft,
        date: transaction.occurred_at,
        invoice_date: None,
        invoice_date_due: None,
        invoice_payment_term_id: None,
        invoice_origin: None,
        invoice_partner_display_name: None,
        invoice_cash_rounding_id: None,
        payment_reference: transaction.external_reference.clone(),
        partner_shipping_id: None,
        sale_order_id: None,
        partner_id: Some(transaction.partner_id),
        commercial_partner_id: Some(transaction.partner_id),
        partner_bank_id: None,
        fiscal_position_id: None,
        invoice_user_id: None,
        invoice_incoterm_id: None,
        incoterm_location: None,
        campaign_id: None,
        source_id: None,
        medium_id: None,
        company_id,
        journal_id: account.account_journal_id,
        currency_id: transaction.currency_id,
        company_currency_id: transaction.currency_id,
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
        posted_before: false,
        is_storno: false,
        is_move_sent: false,
        secure_sequence_number: None,
        invoice_has_outstanding: false,
        payment_state: PaymentState::Paid,
        restrict_mode_hash_table: false,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: None,
    });

    let (move_record, _liquidity_account_id, _clearing_account_id) =
        insert_balanced_payment_lines_and_post(ctx, &payment, move_record)?;

    ctx.db.account_payment().id().update(AccountPayment {
        name: Some(name),
        move_id: Some(move_record.id),
        state: PaymentState::Paid,
        ..payment
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "account_payment",
            record_id: payment.id,
            action: "POST",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "move_id": move_record.id,
                    "source": "payment_transaction",
                    "transaction_id": transaction.id,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "state".to_string(),
                "name".to_string(),
                "move_id".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(payment.id)
}

// ── Payment account reducers ──────────────────────────────────────────────────

/// Create a payment account (wallet, bank, or cash drawer).
#[reducer]
pub fn create_payment_account(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreatePaymentAccountParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "payment_account", "create")?;
    require_company_in_organization(ctx, organization_id, params.company_id)?;

    let journal = require_active_journal(
        ctx,
        organization_id,
        params.company_id,
        params.account_journal_id,
        "payment account",
    )?;
    require_active_currency_id(ctx, params.currency_id, "payment account")?;
    if journal
        .currency_id
        .is_some_and(|id| id != params.currency_id)
    {
        return Err("payment account currency does not match its journal".to_string());
    }
    if let Some(account_id) = params.fee_account_id {
        let account = require_active_account(
            ctx,
            organization_id,
            params.company_id,
            account_id,
            "payment fee",
        )?;
        if account.internal_group != Some(AccountInternalGroup::Expense) {
            return Err("payment fee account must be an expense account".to_string());
        }
    }
    if let Some(account_id) = params.clearing_account_id {
        let account = require_active_account(
            ctx,
            organization_id,
            params.company_id,
            account_id,
            "payment clearing",
        )?;
        if account.internal_group != Some(AccountInternalGroup::Asset)
            && account.internal_group != Some(AccountInternalGroup::Liability)
        {
            return Err(
                "payment clearing account must be an asset or liability account".to_string(),
            );
        }
    }

    if matches!(params.provider_code, PaymentProviderCode::Other)
        && params
            .provider_label
            .as_deref()
            .is_none_or(|label| label.trim().is_empty())
    {
        return Err("provider_label is required when provider_code is Other".to_string());
    }

    let (reference_normalized, reference_masked) = normalize_reference(&params.reference_raw);

    let account = ctx.db.payment_account().insert(PaymentAccount {
        id: 0,
        organization_id,
        company_id: params.company_id,
        provider_code: params.provider_code,
        name: params.name,
        provider_label: params.provider_label,
        reference_normalized,
        reference_masked,
        currency_id: params.currency_id,
        account_journal_id: params.account_journal_id,
        fee_account_id: params.fee_account_id,
        clearing_account_id: params.clearing_account_id,
        active: true,
        is_primary: params.is_primary,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        created_by: ctx.sender(),
        updated_by: ctx.sender(),
        archived_at: None,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(params.company_id),
            table_name: "payment_account",
            record_id: account.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

/// Update a payment account.
#[reducer]
pub fn update_payment_account(
    ctx: &ReducerContext,
    organization_id: u64,
    account_id: u64,
    params: UpdatePaymentAccountParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "payment_account", "write")?;
    let account = ctx
        .db
        .payment_account()
        .id()
        .find(&account_id)
        .ok_or("Payment account not found")?;
    if account.organization_id != organization_id {
        return Err("Payment account belongs to a different organization".to_string());
    }
    if account.archived_at.is_some() {
        return Err("Cannot update archived payment account".to_string());
    }

    if let Some(Some(account_id)) = params.fee_account_id {
        let fee_account = require_active_account(
            ctx,
            organization_id,
            account.company_id,
            account_id,
            "payment fee",
        )?;
        if fee_account.internal_group != Some(AccountInternalGroup::Expense) {
            return Err("payment fee account must be an expense account".to_string());
        }
    }
    if let Some(Some(account_id)) = params.clearing_account_id {
        let clearing_account = require_active_account(
            ctx,
            organization_id,
            account.company_id,
            account_id,
            "payment clearing",
        )?;
        if clearing_account.internal_group != Some(AccountInternalGroup::Asset)
            && clearing_account.internal_group != Some(AccountInternalGroup::Liability)
        {
            return Err(
                "payment clearing account must be an asset or liability account".to_string(),
            );
        }
    }

    let (reference_normalized, reference_masked) = if let Some(ref reference_raw) = params.reference_raw {
        normalize_reference(reference_raw)
    } else {
        (
            account.reference_normalized.clone(),
            account.reference_masked.clone(),
        )
    };

    ctx.db.payment_account().id().update(PaymentAccount {
        name: params.name.unwrap_or(account.name),
        provider_label: params.provider_label.unwrap_or(account.provider_label),
        reference_normalized,
        reference_masked,
        fee_account_id: params.fee_account_id.unwrap_or(account.fee_account_id),
        clearing_account_id: params.clearing_account_id.unwrap_or(account.clearing_account_id),
        active: params.active.unwrap_or(account.active),
        is_primary: params.is_primary.unwrap_or(account.is_primary),
        updated_at: ctx.timestamp,
        updated_by: ctx.sender(),
        metadata: params.metadata.unwrap_or(account.metadata),
        ..account
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(account.company_id),
            table_name: "payment_account",
            record_id: account_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

/// Archive a payment account. Archived accounts cannot receive new transactions.
#[reducer]
pub fn archive_payment_account(
    ctx: &ReducerContext,
    organization_id: u64,
    account_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "payment_account", "archive")?;
    let account = ctx
        .db
        .payment_account()
        .id()
        .find(&account_id)
        .ok_or("Payment account not found")?;
    if account.organization_id != organization_id {
        return Err("Payment account belongs to a different organization".to_string());
    }
    if account.archived_at.is_some() {
        return Err("Payment account is already archived".to_string());
    }

    ctx.db.payment_account().id().update(PaymentAccount {
        active: false,
        archived_at: Some(ctx.timestamp),
        updated_at: ctx.timestamp,
        updated_by: ctx.sender(),
        ..account
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(account.company_id),
            table_name: "payment_account",
            record_id: account_id,
            action: "ARCHIVE",
            old_values: None,
            new_values: None,
            changed_fields: vec!["active".to_string(), "archived_at".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

// ── Payment transaction reducers ──────────────────────────────────────────────

/// Create a payment transaction in draft state.
#[reducer]
pub fn create_payment_transaction(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreatePaymentTransactionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "payment_transaction", "create")?;
    require_company_in_organization(ctx, organization_id, params.company_id)?;

    let account = ctx
        .db
        .payment_account()
        .id()
        .find(&params.payment_account_id)
        .ok_or("Payment account not found")?;
    if account.organization_id != organization_id || account.company_id != params.company_id {
        return Err("Payment account belongs to a different organization or company".to_string());
    }
    if account.archived_at.is_some() {
        return Err("Cannot create transactions on an archived payment account".to_string());
    }
    require_active_currency_id(ctx, params.currency_id, "payment transaction")?;
    if account.currency_id != params.currency_id {
        return Err("Payment transaction currency does not match its payment account".to_string());
    }
    let partner = ctx
        .db
        .contact()
        .id()
        .find(&params.partner_id)
        .ok_or("Payment transaction partner not found")?;
    if partner.organization_id != organization_id
        || partner.company_id.is_some_and(|id| id != params.company_id)
    {
        return Err(
            "Payment transaction partner belongs to a different organization or company"
                .to_string(),
        );
    }
    match params.partner_type {
        PartnerType::Customer if !partner.is_customer => {
            return Err("Payment transaction partner is not a customer".to_string());
        }
        PartnerType::Supplier if !partner.is_vendor => {
            return Err("Payment transaction partner is not a supplier".to_string());
        }
        _ => {}
    }
    if params.source_entity.is_some() != params.source_entity_id.is_some() {
        return Err("source_entity and source_entity_id must be supplied together".to_string());
    }
    validate_payment_evidence_documents(
        ctx,
        organization_id,
        params.company_id,
        &params.evidence_document_ids,
    )?;

    if params.gross_external_amount <= 0.0 {
        return Err("gross_external_amount must be positive".to_string());
    }
    if params.settlement_amount <= 0.0 {
        return Err("settlement_amount must be positive".to_string());
    }
    if params.net_account_amount < 0.0 {
        return Err("net_account_amount must be non-negative".to_string());
    }
    let occurred_at = params
        .occurred_at
        .ok_or_else(|| "occurred_at is required".to_string())?;

    let reference_fingerprint = fingerprint_reference(&params.external_reference);

    // Duplicate reference guard within company + account + fingerprint scope.
    if !reference_fingerprint.is_empty() {
        let duplicate = ctx.db.payment_transaction().iter().any(|t| {
            t.company_id == params.company_id
                && t.payment_account_id == params.payment_account_id
                && t.reference_fingerprint == reference_fingerprint
        });
        if duplicate {
            return Err(format!(
                "Duplicate external reference for this payment account: {}",
                reference_fingerprint
            ));
        }
    }

    let transaction = ctx.db.payment_transaction().insert(PaymentTransaction {
        id: 0,
        organization_id,
        company_id: params.company_id,
        payment_account_id: params.payment_account_id,
        direction: params.direction,
        partner_type: params.partner_type,
        partner_id: params.partner_id,
        external_reference: params.external_reference,
        reference_fingerprint,
        gross_external_amount: params.gross_external_amount,
        settlement_amount: params.settlement_amount,
        net_account_amount: params.net_account_amount,
        currency_id: params.currency_id,
        occurred_at,
        status: PaymentTransactionStatus::Draft,
        account_payment_id: None,
        source_entity: params.source_entity,
        source_entity_id: params.source_entity_id,
        evidence_document_ids: params.evidence_document_ids,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        created_by: ctx.sender(),
        updated_by: ctx.sender(),
        voided_at: None,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(params.company_id),
            table_name: "payment_transaction",
            record_id: transaction.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

/// Update a draft payment transaction.
#[reducer]
pub fn update_payment_transaction(
    ctx: &ReducerContext,
    organization_id: u64,
    transaction_id: u64,
    params: UpdatePaymentTransactionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "payment_transaction", "write")?;
    let transaction = ctx
        .db
        .payment_transaction()
        .id()
        .find(&transaction_id)
        .ok_or("Payment transaction not found")?;
    if transaction.organization_id != organization_id {
        return Err("Payment transaction belongs to a different organization".to_string());
    }
    if transaction.status != PaymentTransactionStatus::Draft {
        return Err("Only draft transactions can be updated".to_string());
    }
    if let Some(ref document_ids) = params.evidence_document_ids {
        validate_payment_evidence_documents(
            ctx,
            organization_id,
            transaction.company_id,
            document_ids,
        )?;
    }

    let external_reference = params
        .external_reference
        .unwrap_or_else(|| transaction.external_reference.clone());
    let reference_fingerprint = fingerprint_reference(&external_reference);

    // Re-check duplicate guard if reference changed.
    if reference_fingerprint != transaction.reference_fingerprint
        && !reference_fingerprint.is_empty()
    {
        let duplicate = ctx.db.payment_transaction().iter().any(|t| {
            t.company_id == transaction.company_id
                && t.payment_account_id == transaction.payment_account_id
                && t.reference_fingerprint == reference_fingerprint
        });
        if duplicate {
            return Err(format!(
                "Duplicate external reference for this payment account: {}",
                reference_fingerprint
            ));
        }
    }

    let gross = params
        .gross_external_amount
        .unwrap_or(transaction.gross_external_amount);
    let settlement = params
        .settlement_amount
        .unwrap_or(transaction.settlement_amount);
    let net = params
        .net_account_amount
        .unwrap_or(transaction.net_account_amount);

    if gross <= 0.0 {
        return Err("gross_external_amount must be positive".to_string());
    }
    if settlement <= 0.0 {
        return Err("settlement_amount must be positive".to_string());
    }
    if net < 0.0 {
        return Err("net_account_amount must be non-negative".to_string());
    }

    ctx.db
        .payment_transaction()
        .id()
        .update(PaymentTransaction {
            external_reference,
            reference_fingerprint,
            gross_external_amount: gross,
            settlement_amount: settlement,
            net_account_amount: net,
            occurred_at: params.occurred_at.unwrap_or(transaction.occurred_at),
            evidence_document_ids: params
                .evidence_document_ids
                .unwrap_or(transaction.evidence_document_ids),
            updated_at: ctx.timestamp,
            updated_by: ctx.sender(),
            metadata: params.metadata.unwrap_or(transaction.metadata),
            ..transaction
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(transaction.company_id),
            table_name: "payment_transaction",
            record_id: transaction_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

/// Post a draft payment transaction. Creates the ledger payment and move atomically.
#[reducer]
pub fn post_payment_transaction(
    ctx: &ReducerContext,
    organization_id: u64,
    transaction_id: u64,
) -> Result<(), String> {
    post_payment_transaction_impl(ctx, organization_id, transaction_id, false)
}

pub fn post_payment_transaction_impl(
    ctx: &ReducerContext,
    organization_id: u64,
    transaction_id: u64,
    skip_approval_check: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "payment_transaction", "post")?;
    let transaction = ctx
        .db
        .payment_transaction()
        .id()
        .find(&transaction_id)
        .ok_or("Payment transaction not found")?;
    if transaction.organization_id != organization_id {
        return Err("Payment transaction belongs to a different organization".to_string());
    }
    if transaction.status != PaymentTransactionStatus::Draft {
        return Err("Only draft transactions can be posted".to_string());
    }

    let account = ctx
        .db
        .payment_account()
        .id()
        .find(&transaction.payment_account_id)
        .ok_or("Payment account not found")?;

    let fees: Vec<PaymentFee> = ctx
        .db
        .payment_fee()
        .iter()
        .filter(|f| f.payment_transaction_id == transaction_id)
        .collect();
    validate_payment_transaction_invariants(
        transaction.gross_external_amount,
        transaction.settlement_amount,
        transaction.net_account_amount,
        &fees,
    )?;

    if !skip_approval_check {
        if matches!(
            request_guarded_action(
                ctx,
                organization_id,
                RequestGuardedActionParams {
                    company_id: transaction.company_id,
                    action: GuardedActionKey::PostPaymentTransaction,
                    action_version: GUARDED_ACTION_SCHEMA_VERSION,
                    input: GuardedActionInput::PostPaymentTransaction { transaction_id },
                    idempotency_key: format!("post-payment-transaction:{transaction_id}"),
                    correlation_id: format!("payment-transaction:{transaction_id}:post"),
                    causation_id: None,
                },
            )?,
            GuardedActionGateOutcome::HumanTaskCreated { .. }
        ) {
            return Ok(());
        }
    }

    let account_payment_id = post_ledger_payment(
        ctx,
        organization_id,
        transaction.company_id,
        &account,
        &transaction,
    )?;

    ctx.db
        .payment_transaction()
        .id()
        .update(PaymentTransaction {
            status: PaymentTransactionStatus::Posted,
            account_payment_id: Some(account_payment_id),
            updated_at: ctx.timestamp,
            updated_by: ctx.sender(),
            ..transaction
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(transaction.company_id),
            table_name: "payment_transaction",
            record_id: transaction_id,
            action: "POST",
            old_values: None,
            new_values: None,
            changed_fields: vec!["status".to_string(), "account_payment_id".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

/// Void a draft payment transaction.
#[reducer]
pub fn void_payment_transaction(
    ctx: &ReducerContext,
    organization_id: u64,
    transaction_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "payment_transaction", "void")?;
    let transaction = ctx
        .db
        .payment_transaction()
        .id()
        .find(&transaction_id)
        .ok_or("Payment transaction not found")?;
    if transaction.organization_id != organization_id {
        return Err("Payment transaction belongs to a different organization".to_string());
    }
    if transaction.status != PaymentTransactionStatus::Draft {
        return Err("Only draft transactions can be voided".to_string());
    }

    ctx.db
        .payment_transaction()
        .id()
        .update(PaymentTransaction {
            status: PaymentTransactionStatus::Voided,
            voided_at: Some(ctx.timestamp),
            updated_at: ctx.timestamp,
            updated_by: ctx.sender(),
            ..transaction
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(transaction.company_id),
            table_name: "payment_transaction",
            record_id: transaction_id,
            action: "VOID",
            old_values: None,
            new_values: None,
            changed_fields: vec!["status".to_string(), "voided_at".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

// ── Payment fee reducers ──────────────────────────────────────────────────────

/// Add a fee component to a draft payment transaction.
#[reducer]
pub fn create_payment_fee(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreatePaymentFeeParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "payment_transaction", "write")?;
    let transaction = ctx
        .db
        .payment_transaction()
        .id()
        .find(&params.payment_transaction_id)
        .ok_or("Payment transaction not found")?;
    if transaction.organization_id != organization_id || transaction.company_id != params.company_id
    {
        return Err(
            "Payment transaction belongs to a different organization or company".to_string(),
        );
    }
    if transaction.status != PaymentTransactionStatus::Draft {
        return Err("Fees can only be added to draft transactions".to_string());
    }
    if params.amount < 0.0 {
        return Err("Fee amount must be non-negative".to_string());
    }
    if params.tax_amount < 0.0 {
        return Err("Fee tax amount must be non-negative".to_string());
    }
    let payment_account = ctx
        .db
        .payment_account()
        .id()
        .find(&transaction.payment_account_id)
        .ok_or("Payment account not found")?;
    let fee_account_id = params.fee_account_id.or(payment_account.fee_account_id);
    if params.amount > 0.0 && fee_account_id.is_none() {
        return Err("fee_account_id is required when fee amount is nonzero".to_string());
    }
    if params.tax_amount > 0.0 && params.tax_account_id.is_none() {
        return Err("tax_account_id is required when fee tax amount is nonzero".to_string());
    }
    if let Some(account_id) = fee_account_id {
        let account = require_active_account(
            ctx,
            organization_id,
            params.company_id,
            account_id,
            "payment fee",
        )?;
        if account.internal_group != Some(AccountInternalGroup::Expense) {
            return Err("payment fee account must be an expense account".to_string());
        }
    }
    if let Some(account_id) = params.tax_account_id {
        require_active_account(
            ctx,
            organization_id,
            params.company_id,
            account_id,
            "payment fee tax",
        )?;
    }

    let fee = ctx.db.payment_fee().insert(PaymentFee {
        id: 0,
        organization_id,
        company_id: params.company_id,
        payment_transaction_id: params.payment_transaction_id,
        bearer: params.bearer,
        amount: params.amount,
        currency_id: transaction.currency_id,
        fee_account_id,
        tax_account_id: params.tax_account_id,
        tax_amount: params.tax_amount,
        provider_reference: params.provider_reference,
        created_at: ctx.timestamp,
        created_by: ctx.sender(),
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(params.company_id),
            table_name: "payment_fee",
            record_id: fee.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}

// ── Allocation / reconciliation reducers ──────────────────────────────────────

const RECONCILIATION_EPSILON: f64 = 0.000_001;

fn recompute_move_residual(
    ctx: &ReducerContext,
    organization_id: u64,
    move_record: AccountMove,
) -> Result<AccountMove, String> {
    let lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_record.id)
        .collect();
    if lines.iter().any(|line| {
        line.organization_id != organization_id
            || line.company_id != move_record.company_id
            || line.journal_id != move_record.journal_id
    }) {
        return Err("move lines do not match the parent move scope".to_string());
    }
    let residual: f64 = lines
        .iter()
        .filter(|line| is_receivable_or_payable_line_type(line.account_internal_type.as_deref()))
        .map(|line| line.amount_residual.abs())
        .sum();
    Ok(ctx.db.account_move().id().update(AccountMove {
        amount_residual: residual,
        amount_residual_signed: residual,
        payment_state: if residual <= RECONCILIATION_EPSILON {
            PaymentState::Paid
        } else {
            PaymentState::Partial
        },
        invoice_has_outstanding: residual > RECONCILIATION_EPSILON,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..move_record
    }))
}

fn set_line_residual(
    ctx: &ReducerContext,
    line: AccountMoveLine,
    residual_abs: f64,
    matching_number: &str,
) -> AccountMoveLine {
    let signed = if line.amount_residual < 0.0 {
        -residual_abs
    } else {
        residual_abs
    };
    ctx.db.account_move_line().id().update(AccountMoveLine {
        amount_residual: signed,
        amount_residual_currency: signed,
        matching_number: Some(matching_number.to_string()),
        is_matching: residual_abs <= RECONCILIATION_EPSILON,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..line
    })
}

fn adjust_payment_clearing_residual(
    ctx: &ReducerContext,
    payment: &AccountPayment,
    amount: f64,
    restore: bool,
    matching_number: &str,
) -> Result<AccountMove, String> {
    let payment_move_id = payment.move_id.ok_or("ledger payment has no linked move")?;
    let payment_move = ctx
        .db
        .account_move()
        .id()
        .find(&payment_move_id)
        .ok_or("linked payment move not found")?;
    if payment_move.organization_id != payment.organization_id
        || payment_move.company_id != payment.company_id
        || payment_move.state != AccountMoveState::Posted
    {
        return Err("linked payment move is not a posted move in payment scope".to_string());
    }

    let mut clearing_lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&payment_move.id)
        .filter(|line| {
            line.organization_id == payment.organization_id
                && line.company_id == payment.company_id
                && line.partner_id == Some(payment.partner_id)
                && is_receivable_or_payable_line_type(line.account_internal_type.as_deref())
        })
        .collect();
    if clearing_lines.is_empty() {
        return Err("linked payment move has no receivable/payable clearing line".to_string());
    }

    if restore {
        let line = clearing_lines.remove(0);
        let restored = line.amount_residual.abs() + amount;
        if restored > payment.amount + RECONCILIATION_EPSILON {
            return Err("payment clearing residual would exceed payment amount".to_string());
        }
        set_line_residual(ctx, line, restored, matching_number);
    } else {
        let available: f64 = clearing_lines
            .iter()
            .map(|line| line.amount_residual.abs())
            .sum();
        if amount > available + RECONCILIATION_EPSILON {
            return Err("allocation exceeds the linked payment residual".to_string());
        }
        let mut remaining = amount;
        for line in clearing_lines {
            if remaining <= RECONCILIATION_EPSILON {
                break;
            }
            let current = line.amount_residual.abs();
            let applied = remaining.min(current);
            set_line_residual(ctx, line, (current - applied).max(0.0), matching_number);
            remaining = (remaining - applied).max(0.0);
        }
    }

    recompute_move_residual(ctx, payment.organization_id, payment_move)
}

fn post_write_off_move(
    ctx: &ReducerContext,
    payment: &AccountPayment,
    payment_move: &AccountMove,
    target_line: &AccountMoveLine,
    write_off_account_id: u64,
    amount: f64,
    reconciliation_id: u64,
) -> Result<u64, String> {
    let name = next_doc_number(ctx, "PAYWO");
    let write_off_move = ctx.db.account_move().insert(AccountMove {
        id: 0,
        name: name.clone(),
        ref_: Some(format!("payment reconciliation {reconciliation_id}")),
        state: AccountMoveState::Draft,
        date: ctx.timestamp,
        invoice_origin: Some(format!("payment-reconciliation:{reconciliation_id}")),
        payment_reference: Some(format!("payment reconciliation {reconciliation_id}")),
        partner_id: Some(payment.partner_id),
        commercial_partner_id: Some(payment.partner_id),
        amount_untaxed: amount,
        amount_tax: 0.0,
        amount_total: amount,
        amount_residual: 0.0,
        amount_untaxed_signed: amount,
        amount_tax_signed: 0.0,
        amount_total_signed: amount,
        amount_total_in_currency_signed: amount,
        amount_residual_signed: 0.0,
        posted_before: false,
        payment_state: PaymentState::Paid,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: Some(
            serde_json::json!({ "payment_reconciliation_id": reconciliation_id }).to_string(),
        ),
        ..payment_move.clone()
    });

    let target_is_debit = target_line.balance >= 0.0;
    let (write_off_debit, write_off_credit, target_debit, target_credit) = if target_is_debit {
        (amount, 0.0, 0.0, amount)
    } else {
        (0.0, amount, amount, 0.0)
    };
    for (sequence, account_id, line_name, debit, credit) in [
        (
            1,
            write_off_account_id,
            "Payment write-off",
            write_off_debit,
            write_off_credit,
        ),
        (
            2,
            target_line.account_id,
            "Payment write-off clearing",
            target_debit,
            target_credit,
        ),
    ] {
        let line = insert_draft_account_move_line(
            ctx,
            &write_off_move,
            payment_line_params(
                account_id,
                line_name.to_string(),
                debit,
                credit,
                sequence,
                payment.partner_id,
                payment.id,
            ),
        )?;
        ctx.db.account_move_line().id().update(AccountMoveLine {
            parent_state: AccountMoveState::Posted,
            amount_residual: 0.0,
            amount_residual_currency: 0.0,
            is_matching: true,
            ..line
        });
    }
    let write_off_move_id = write_off_move.id;
    ctx.db.account_move().id().update(AccountMove {
        state: AccountMoveState::Posted,
        posted_before: true,
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        ..write_off_move
    });
    Ok(write_off_move_id)
}

fn reverse_write_off_move(
    ctx: &ReducerContext,
    payment: &AccountPayment,
    original_move_id: u64,
    reconciliation_id: u64,
) -> Result<u64, String> {
    let original = ctx
        .db
        .account_move()
        .id()
        .find(&original_move_id)
        .ok_or("write-off move not found")?;
    if original.organization_id != payment.organization_id
        || original.company_id != payment.company_id
        || original.state != AccountMoveState::Posted
    {
        return Err("write-off move is not posted in payment scope".to_string());
    }
    let original_lines: Vec<_> = ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&original.id)
        .collect();
    if original_lines.len() != 2 {
        return Err("write-off move must have exactly two lines".to_string());
    }

    let name = next_doc_number(ctx, "PAYWOR");
    let reversal = ctx.db.account_move().insert(AccountMove {
        id: 0,
        name,
        ref_: Some(format!("reversal of write-off move {original_move_id}")),
        state: AccountMoveState::Draft,
        date: ctx.timestamp,
        invoice_origin: Some(format!(
            "reversal-payment-reconciliation:{reconciliation_id}"
        )),
        posted_before: false,
        create_uid: Some(ctx.sender()),
        create_date: Some(ctx.timestamp),
        write_uid: Some(ctx.sender()),
        write_date: Some(ctx.timestamp),
        metadata: Some(
            serde_json::json!({ "reverses_write_off_move_id": original_move_id }).to_string(),
        ),
        ..original
    });
    for (sequence, line) in original_lines.into_iter().enumerate() {
        let inserted = insert_draft_account_move_line(
            ctx,
            &reversal,
            payment_line_params(
                line.account_id,
                format!("Reversal: {}", line.name),
                line.credit,
                line.debit,
                (sequence + 1) as u32,
                payment.partner_id,
                payment.id,
            ),
        )?;
        ctx.db.account_move_line().id().update(AccountMoveLine {
            parent_state: AccountMoveState::Posted,
            amount_residual: 0.0,
            amount_residual_currency: 0.0,
            is_matching: true,
            ..inserted
        });
    }
    let reversal_id = reversal.id;
    ctx.db.account_move().id().update(AccountMove {
        state: AccountMoveState::Posted,
        posted_before: true,
        ..reversal
    });
    Ok(reversal_id)
}

fn reverse_payment_allocations(
    ctx: &ReducerContext,
    transaction: &PaymentTransaction,
    account_payment_id: u64,
) -> Result<(), String> {
    let mut ledger_payment = ctx
        .db
        .account_payment()
        .id()
        .find(&account_payment_id)
        .ok_or("original ledger payment not found")?;
    if ledger_payment.organization_id != transaction.organization_id
        || ledger_payment.company_id != transaction.company_id
        || ledger_payment.partner_id != transaction.partner_id
    {
        return Err("original ledger payment does not match transaction scope".to_string());
    }

    let all_rows: Vec<_> = ctx
        .db
        .payment_reconciliation()
        .iter()
        .filter(|row| row.payment_transaction_id == transaction.id)
        .collect();
    if all_rows.iter().any(|row| {
        row.organization_id != transaction.organization_id
            || row.company_id != transaction.company_id
            || row.account_payment_id != account_payment_id
    }) {
        return Err("reconciliation rows do not match transaction scope".to_string());
    }
    let active_rows: Vec<_> = all_rows
        .iter()
        .filter(|row| {
            !row.is_reversal
                && !all_rows.iter().any(|candidate| {
                    candidate.is_reversal && candidate.reversed_reconciliation_id == Some(row.id)
                })
        })
        .cloned()
        .collect();

    for row in active_rows {
        let line = ctx
            .db
            .account_move_line()
            .id()
            .find(&row.allocated_move_line_id)
            .ok_or("allocated move line not found during reversal")?;
        let parent = ctx
            .db
            .account_move()
            .id()
            .find(&line.move_id)
            .ok_or("allocated parent move not found during reversal")?;
        if line.organization_id != transaction.organization_id
            || line.company_id != transaction.company_id
            || parent.organization_id != transaction.organization_id
            || parent.company_id != transaction.company_id
            || parent.journal_id != line.journal_id
            || parent.state != AccountMoveState::Posted
            || line.partner_id != Some(transaction.partner_id)
        {
            return Err("allocated ledger rows do not match reversal scope".to_string());
        }
        if (line.amount_residual.abs() - row.residual_after).abs() > RECONCILIATION_EPSILON {
            return Err("allocated move line residual changed after reconciliation".to_string());
        }

        let matching_number = format!("REV-PAYMENT-TXN-{}", transaction.id);
        let residual_before = line.amount_residual.abs();
        set_line_residual(ctx, line, row.residual_before, &matching_number);
        recompute_move_residual(ctx, transaction.organization_id, parent)?;
        adjust_payment_clearing_residual(
            ctx,
            &ledger_payment,
            row.allocated_amount,
            true,
            &matching_number,
        )?;

        let reversal_write_off_move_id = match row.write_off_move_id {
            Some(move_id) => Some(reverse_write_off_move(
                ctx,
                &ledger_payment,
                move_id,
                row.id,
            )?),
            None => None,
        };
        ctx.db
            .payment_reconciliation()
            .insert(PaymentReconciliation {
                id: 0,
                organization_id: transaction.organization_id,
                company_id: transaction.company_id,
                payment_transaction_id: transaction.id,
                account_payment_id,
                allocated_move_line_id: row.allocated_move_line_id,
                allocated_amount: -row.allocated_amount,
                currency_id: row.currency_id,
                residual_before,
                residual_after: row.residual_before,
                write_off_amount: -row.write_off_amount,
                write_off_account_id: row.write_off_account_id,
                write_off_move_id: reversal_write_off_move_id,
                is_reversal: true,
                reversed_reconciliation_id: Some(row.id),
                created_at: ctx.timestamp,
                created_by: ctx.sender(),
                metadata: Some(
                    serde_json::json!({ "reversal_of_reconciliation_id": row.id }).to_string(),
                ),
            });
    }

    ledger_payment.reconciled_invoice_ids.clear();
    ledger_payment.reconciled_bill_ids.clear();
    ctx.db.account_payment().id().update(ledger_payment);
    Ok(())
}

/// Allocate a posted payment transaction to a receivable/payable move line.
#[reducer]
pub fn allocate_payment_transaction(
    ctx: &ReducerContext,
    organization_id: u64,
    params: AllocatePaymentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "payment_reconciliation", "create")?;
    require_company_in_organization(ctx, organization_id, params.company_id)?;
    if params.allocated_amount <= 0.0 {
        return Err("allocated amount must be positive".to_string());
    }
    if params.write_off_amount < 0.0 {
        return Err("write-off amount cannot be negative".to_string());
    }

    let transaction = ctx
        .db
        .payment_transaction()
        .id()
        .find(&params.payment_transaction_id)
        .ok_or("payment transaction not found")?;
    if transaction.organization_id != organization_id || transaction.company_id != params.company_id
    {
        return Err("payment transaction does not match organization and company".to_string());
    }
    let payload_fingerprint = format!("{params:?}");
    if replayed_result(
        ctx,
        organization_id,
        params.company_id,
        "allocate_payment_transaction",
        &params.idempotency_key,
        &payload_fingerprint,
    )?
    .is_some()
    {
        return Ok(());
    }
    if transaction.status != PaymentTransactionStatus::Posted {
        return Err("only posted transactions can be allocated".to_string());
    }
    let account_payment_id = transaction
        .account_payment_id
        .ok_or("payment transaction has no linked ledger payment")?;
    let operational_account = ctx
        .db
        .payment_account()
        .id()
        .find(&transaction.payment_account_id)
        .ok_or("payment account not found")?;
    if operational_account.organization_id != organization_id
        || operational_account.company_id != params.company_id
        || operational_account.archived_at.is_some()
    {
        return Err("payment account is not active in transaction scope".to_string());
    }
    let mut ledger_payment = ctx
        .db
        .account_payment()
        .id()
        .find(&account_payment_id)
        .ok_or("linked ledger payment not found")?;
    if ledger_payment.organization_id != organization_id
        || ledger_payment.company_id != params.company_id
        || ledger_payment.partner_id != transaction.partner_id
        || ledger_payment.partner_type != transaction.partner_type
        || ledger_payment.state != PaymentState::Paid
    {
        return Err("linked ledger payment does not match the posted transaction".to_string());
    }
    let expected_payment_type = match transaction.direction {
        PaymentDirection::Inbound => PaymentType::InBound,
        PaymentDirection::Outbound => PaymentType::OutBound,
    };
    if ledger_payment.payment_type != expected_payment_type {
        return Err("ledger payment direction does not match the transaction".to_string());
    }

    let move_line = ctx
        .db
        .account_move_line()
        .id()
        .find(&params.allocated_move_line_id)
        .ok_or("account move line not found")?;
    if move_line.organization_id != organization_id || move_line.company_id != params.company_id {
        return Err("move line does not match organization and company".to_string());
    }
    let parent_move = ctx
        .db
        .account_move()
        .id()
        .find(&move_line.move_id)
        .ok_or("parent move not found")?;
    if parent_move.organization_id != organization_id
        || parent_move.company_id != params.company_id
        || parent_move.journal_id != move_line.journal_id
        || parent_move.state != AccountMoveState::Posted
    {
        return Err("move line parent is not a posted move in allocation scope".to_string());
    }
    if !matches!(
        parent_move.move_type,
        MoveType::OutInvoice | MoveType::OutRefund | MoveType::InInvoice | MoveType::InRefund
    ) {
        return Err("target move is not an invoice or bill".to_string());
    }
    if parent_move.partner_id != Some(transaction.partner_id)
        || move_line.partner_id != Some(transaction.partner_id)
        || ledger_payment.partner_id != transaction.partner_id
    {
        return Err("payment and target move line must have the same partner".to_string());
    }
    let partner = ctx
        .db
        .contact()
        .id()
        .find(&transaction.partner_id)
        .ok_or("payment partner not found")?;
    if partner.organization_id != organization_id
        || partner
            .company_id
            .is_some_and(|company_id| company_id != params.company_id)
        || partner.deleted_at.is_some()
        || partner.merge_target_id.is_some()
    {
        return Err("payment partner is not active in allocation scope".to_string());
    }
    match transaction.partner_type {
        PartnerType::Customer if !partner.is_customer => {
            return Err("payment partner is not a customer".to_string())
        }
        PartnerType::Supplier if !partner.is_vendor => {
            return Err("payment partner is not a supplier".to_string())
        }
        _ => {}
    }

    let target_account = ctx
        .db
        .account_account()
        .id()
        .find(&move_line.account_id)
        .ok_or("target account not found")?;
    if target_account.organization_id != organization_id
        || target_account.company_id != params.company_id
        || target_account.deprecated
    {
        return Err("target account is not active in allocation scope".to_string());
    }
    let expected_account_type = match transaction.partner_type {
        PartnerType::Customer => AccountTypeInternal::Receivable,
        PartnerType::Supplier => AccountTypeInternal::Payable,
    };
    if target_account.internal_type.as_ref() != Some(&expected_account_type) {
        return Err("target line is not on the required receivable/payable account".to_string());
    }

    if !(1..=9).contains(&transaction.currency_id) {
        return Err("payment currency is not supported".to_string());
    }
    let currency = require_currency_row(ctx, legacy_currency_code_for_id(transaction.currency_id))?;
    if !currency.active
        || params.currency_id != transaction.currency_id
        || ledger_payment.currency_id != transaction.currency_id
        || operational_account.currency_id != transaction.currency_id
        || parent_move.currency_id != transaction.currency_id
        || move_line.currency_id != transaction.currency_id
    {
        return Err(
            "allocation currency does not match payment and target ledger rows".to_string(),
        );
    }

    let write_off_account = match (
        params.write_off_amount > RECONCILIATION_EPSILON,
        params.write_off_account_id,
    ) {
        (true, Some(account_id)) => {
            let account = ctx
                .db
                .account_account()
                .id()
                .find(&account_id)
                .ok_or("write-off account not found")?;
            if account.organization_id != organization_id
                || account.company_id != params.company_id
                || account.deprecated
            {
                return Err("write-off account is not active in allocation scope".to_string());
            }
            let expected_group = match transaction.partner_type {
                PartnerType::Customer => AccountInternalGroup::Expense,
                PartnerType::Supplier => AccountInternalGroup::Income,
            };
            if account.internal_group.as_ref() != Some(&expected_group) {
                return Err("write-off account has an incompatible account role".to_string());
            }
            Some(account)
        }
        (true, None) => {
            return Err("write-off account is required for a nonzero write-off".to_string())
        }
        (false, Some(_)) => {
            return Err("write-off account requires a nonzero write-off".to_string())
        }
        (false, None) => None,
    };

    let existing: Vec<PaymentReconciliation> = ctx
        .db
        .payment_reconciliation()
        .iter()
        .filter(|r| r.payment_transaction_id == params.payment_transaction_id)
        .collect();
    if existing
        .iter()
        .any(|row| row.organization_id != organization_id || row.company_id != params.company_id)
    {
        return Err("existing reconciliation rows do not match transaction scope".to_string());
    }
    if let Some(previous) = existing.iter().find(|row| {
        !row.is_reversal
            && row.allocated_move_line_id == params.allocated_move_line_id
            && !existing.iter().any(|candidate| {
                candidate.is_reversal && candidate.reversed_reconciliation_id == Some(row.id)
            })
    }) {
        if (previous.allocated_amount - params.allocated_amount).abs() <= RECONCILIATION_EPSILON
            && (previous.write_off_amount - params.write_off_amount).abs() <= RECONCILIATION_EPSILON
            && previous.currency_id == params.currency_id
            && previous.write_off_account_id == params.write_off_account_id
        {
            record_result(
                ctx,
                organization_id,
                params.company_id,
                "allocate_payment_transaction",
                params.idempotency_key,
                payload_fingerprint,
                "payment_reconciliation",
                previous.id,
            );
            return Ok(());
        }
        return Err(
            "payment transaction already has an active allocation for this move line".to_string(),
        );
    }
    let already_allocated: f64 = existing.iter().map(|row| row.allocated_amount).sum();
    let available_payment = (transaction.settlement_amount - already_allocated).max(0.0);
    if params.allocated_amount > available_payment + RECONCILIATION_EPSILON {
        return Err("allocation exceeds the available payment amount".to_string());
    }

    let residual_before = move_line.amount_residual.abs();
    let target_reduction = params.allocated_amount + params.write_off_amount;
    if target_reduction > residual_before + RECONCILIATION_EPSILON {
        return Err("allocation and write-off exceed the target residual".to_string());
    }
    let residual_after = (residual_before - target_reduction).max(0.0);
    let matching_number = format!("PAYMENT-TXN-{}", transaction.id);

    let mut reconciliation = ctx
        .db
        .payment_reconciliation()
        .insert(PaymentReconciliation {
            id: 0,
            organization_id,
            company_id: transaction.company_id,
            payment_transaction_id: transaction.id,
            account_payment_id,
            allocated_move_line_id: move_line.id,
            allocated_amount: params.allocated_amount,
            currency_id: transaction.currency_id,
            residual_before,
            residual_after,
            write_off_amount: params.write_off_amount,
            write_off_account_id: params.write_off_account_id,
            write_off_move_id: None,
            is_reversal: false,
            reversed_reconciliation_id: None,
            created_at: ctx.timestamp,
            created_by: ctx.sender(),
            metadata: params.metadata,
        });

    let payment_move = adjust_payment_clearing_residual(
        ctx,
        &ledger_payment,
        params.allocated_amount,
        false,
        &matching_number,
    )?;
    set_line_residual(ctx, move_line, residual_after, &matching_number);
    recompute_move_residual(ctx, organization_id, parent_move.clone())?;

    if let Some(write_off_account) = write_off_account {
        let write_off_move_id = post_write_off_move(
            ctx,
            &ledger_payment,
            &payment_move,
            &ctx.db
                .account_move_line()
                .id()
                .find(&params.allocated_move_line_id)
                .ok_or("target move line missing after residual update")?,
            write_off_account.id,
            params.write_off_amount,
            reconciliation.id,
        )?;
        reconciliation = ctx
            .db
            .payment_reconciliation()
            .id()
            .update(PaymentReconciliation {
                write_off_move_id: Some(write_off_move_id),
                ..reconciliation
            });
    }

    match parent_move.move_type {
        MoveType::OutInvoice | MoveType::OutRefund => {
            if !ledger_payment
                .reconciled_invoice_ids
                .contains(&parent_move.id)
            {
                ledger_payment.reconciled_invoice_ids.push(parent_move.id);
            }
        }
        MoveType::InInvoice | MoveType::InRefund => {
            if !ledger_payment.reconciled_bill_ids.contains(&parent_move.id) {
                ledger_payment.reconciled_bill_ids.push(parent_move.id);
            }
        }
        _ => return Err("target move is not an invoice or bill".to_string()),
    }
    ctx.db.account_payment().id().update(ledger_payment);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(params.company_id),
            table_name: "payment_reconciliation",
            record_id: reconciliation.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "payment_transaction_id": transaction.id,
                    "move_line_id": params.allocated_move_line_id,
                    "residual_before": residual_before,
                    "residual_after": residual_after,
                    "write_off_move_id": reconciliation.write_off_move_id,
                })
                .to_string(),
            ),
            changed_fields: vec!["amount_residual".to_string(), "payment_state".to_string()],
            metadata: None,
        },
    );

    record_result(
        ctx,
        organization_id,
        params.company_id,
        "allocate_payment_transaction",
        params.idempotency_key,
        payload_fingerprint,
        "payment_reconciliation",
        reconciliation.id,
    );
    Ok(())
}

// ── Reversal reducers ─────────────────────────────────────────────────────────

/// Reverse a posted payment transaction. Creates a compensating transaction,
/// ledger payment, and reversal record without mutating the original.
#[reducer]
pub fn reverse_payment_transaction(
    ctx: &ReducerContext,
    organization_id: u64,
    transaction_id: u64,
    params: ReversePaymentTransactionParams,
) -> Result<(), String> {
    reverse_payment_transaction_impl(ctx, organization_id, transaction_id, params, false)
}

pub fn reverse_payment_transaction_impl(
    ctx: &ReducerContext,
    organization_id: u64,
    transaction_id: u64,
    params: ReversePaymentTransactionParams,
    skip_approval_check: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "payment_transaction", "reverse")?;
    let original = ctx
        .db
        .payment_transaction()
        .id()
        .find(&transaction_id)
        .ok_or("Payment transaction not found")?;
    if original.organization_id != organization_id || original.company_id != params.company_id {
        return Err(
            "Payment transaction belongs to a different organization or company".to_string(),
        );
    }
    if original.status != PaymentTransactionStatus::Posted {
        return Err("Only posted transactions can be reversed".to_string());
    }
    let original_account_payment_id = original
        .account_payment_id
        .ok_or("Original transaction has no linked ledger payment")?;

    let account = ctx
        .db
        .payment_account()
        .id()
        .find(&original.payment_account_id)
        .ok_or("Payment account not found")?;
    if account.organization_id != organization_id
        || account.company_id != original.company_id
        || account.archived_at.is_some()
    {
        return Err("Payment account is not active in transaction scope".to_string());
    }

    if !skip_approval_check {
        if matches!(
            request_guarded_action(
                ctx,
                organization_id,
                RequestGuardedActionParams {
                    company_id: params.company_id,
                    action: GuardedActionKey::ReversePaymentTransaction,
                    action_version: GUARDED_ACTION_SCHEMA_VERSION,
                    input: GuardedActionInput::ReversePaymentTransaction { transaction_id },
                    idempotency_key: format!("reverse-payment-transaction:{transaction_id}"),
                    correlation_id: format!("payment-transaction:{transaction_id}:reverse"),
                    causation_id: None,
                },
            )?,
            GuardedActionGateOutcome::HumanTaskCreated { .. }
        ) {
            return Ok(());
        }
    }

    // Compensating transaction with inverted direction.
    let correcting_direction = match original.direction {
        PaymentDirection::Inbound => PaymentDirection::Outbound,
        PaymentDirection::Outbound => PaymentDirection::Inbound,
    };

    let correcting = ctx.db.payment_transaction().insert(PaymentTransaction {
        id: 0,
        organization_id,
        company_id: params.company_id,
        payment_account_id: original.payment_account_id,
        direction: correcting_direction,
        partner_type: original.partner_type.clone(),
        partner_id: original.partner_id,
        external_reference: original
            .external_reference
            .clone()
            .map(|r| format!("REV:{}", r)),
        reference_fingerprint: String::new(),
        gross_external_amount: original.gross_external_amount,
        settlement_amount: original.settlement_amount,
        net_account_amount: original.net_account_amount,
        currency_id: original.currency_id,
        occurred_at: ctx.timestamp,
        status: PaymentTransactionStatus::Posted,
        account_payment_id: None,
        source_entity: Some("reversal".to_string()),
        source_entity_id: Some(transaction_id),
        evidence_document_ids: vec![],
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        created_by: ctx.sender(),
        updated_by: ctx.sender(),
        voided_at: None,
        metadata: params.metadata.clone(),
    });

    let correcting_account_payment_id = post_ledger_payment(
        ctx,
        organization_id,
        params.company_id,
        &account,
        &correcting,
    )?;

    ctx.db
        .payment_transaction()
        .id()
        .update(PaymentTransaction {
            account_payment_id: Some(correcting_account_payment_id),
            ..correcting
        });

    reverse_payment_allocations(ctx, &original, original_account_payment_id)?;

    // Mark original as reversed.
    ctx.db
        .payment_transaction()
        .id()
        .update(PaymentTransaction {
            status: PaymentTransactionStatus::Reversed,
            updated_at: ctx.timestamp,
            updated_by: ctx.sender(),
            ..original
        });

    let reversal = ctx.db.payment_reversal().insert(PaymentReversal {
        id: 0,
        organization_id,
        company_id: params.company_id,
        original_transaction_id: transaction_id,
        original_account_payment_id,
        correcting_transaction_id: correcting.id,
        correcting_account_payment_id,
        reason: params.reason,
        created_at: ctx.timestamp,
        created_by: ctx.sender(),
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(params.company_id),
            table_name: "payment_reversal",
            record_id: reversal.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );
    Ok(())
}
