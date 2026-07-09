/// Operational payment management — mobile money, bank, and cash accounts.
///
/// This module adds provider-aware payment accounts and operational transactions.
/// It extends but does not replace `accounting::payments::AccountPayment`, which
/// remains the ledger authority. A posted `PaymentTransaction` links to one
/// `AccountPayment` and its `AccountMove`.
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::accounting::chart_of_accounts::account_journal;
use crate::accounting::journal_entries::{account_move, account_move_line, AccountMove};
use crate::accounting::payments::{account_payment, AccountPayment};
use crate::helpers::{check_permission, next_doc_number, write_audit_log_v2, AuditLogParams};
use crate::types::{
    AccountMoveState, MoveType, PartnerType, PaymentDirection, PaymentFeeBearer,
    PaymentProviderCode, PaymentState, PaymentTransactionStatus, PaymentType,
};
use crate::workflow::approval_gate::gate_action_with_approval;

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

#[derive(SpacetimeType)]
pub struct UpdatePaymentAccountParams {
    pub name: Option<String>,
    pub provider_label: Option<String>,
    pub reference_raw: Option<String>,
    pub fee_account_id: Option<u64>,
    pub clearing_account_id: Option<u64>,
    pub active: Option<bool>,
    pub is_primary: Option<bool>,
    pub metadata: Option<String>,
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

#[derive(SpacetimeType)]
pub struct UpdatePaymentTransactionParams {
    pub external_reference: Option<String>,
    pub gross_external_amount: Option<f64>,
    pub settlement_amount: Option<f64>,
    pub net_account_amount: Option<f64>,
    pub occurred_at: Option<Timestamp>,
    pub evidence_document_ids: Option<Vec<u64>>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType)]
pub struct CreatePaymentFeeParams {
    pub company_id: u64,
    pub payment_transaction_id: u64,
    pub bearer: PaymentFeeBearer,
    pub amount: f64,
    pub currency_id: u64,
    pub fee_account_id: Option<u64>,
    pub tax_account_id: Option<u64>,
    pub tax_amount: f64,
    pub provider_reference: Option<String>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType)]
pub struct AllocatePaymentParams {
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
                format!("{}****{}", &normalized[..2], &normalized[normalized.len() - 2..])
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

/// Build and insert the ledger `AccountPayment` and `AccountMove` for a posted
/// operational transaction. Returns the created `AccountPayment` id.
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

    let move_record = ctx.db.account_move().insert(AccountMove {
        id: 0,
        organization_id,
        name: name.clone(),
        ref_: transaction.external_reference.clone(),
        move_type: MoveType::Entry,
        auto_post: false,
        state: AccountMoveState::Posted,
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
        journal_id: account.account_journal_id,
        currency_id: transaction.currency_id,
        company_currency_id: transaction.currency_id,
        amount_untaxed: transaction.settlement_amount,
        amount_tax: 0.0,
        amount_total: transaction.settlement_amount,
        amount_residual: transaction.settlement_amount,
        amount_untaxed_signed: transaction.settlement_amount,
        amount_tax_signed: 0.0,
        amount_total_signed: transaction.settlement_amount,
        amount_total_in_currency_signed: transaction.settlement_amount,
        amount_residual_signed: transaction.settlement_amount,
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
            new_values: None,
            changed_fields: vec!["state".to_string(), "name".to_string(), "move_id".to_string()],
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

    let journal = ctx
        .db
        .account_journal()
        .id()
        .find(&params.account_journal_id)
        .ok_or("Account journal not found")?;
    if journal.organization_id != organization_id || journal.company_id != params.company_id {
        return Err("Journal belongs to a different organization or company".to_string());
    }

    if matches!(params.provider_code, PaymentProviderCode::Other) && params.provider_label.is_none() {
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

    let (reference_normalized, reference_masked) = if params.reference_raw.is_some() {
        normalize_reference(&params.reference_raw)
    } else {
        (account.reference_normalized.clone(), account.reference_masked.clone())
    };

    ctx.db.payment_account().id().update(PaymentAccount {
        name: params.name.unwrap_or(account.name),
        provider_label: params.provider_label.or(account.provider_label),
        reference_normalized,
        reference_masked,
        fee_account_id: params.fee_account_id.or(account.fee_account_id),
        clearing_account_id: params.clearing_account_id.or(account.clearing_account_id),
        active: params.active.unwrap_or(account.active),
        is_primary: params.is_primary.unwrap_or(account.is_primary),
        updated_at: ctx.timestamp,
        updated_by: ctx.sender(),
        metadata: params.metadata.or(account.metadata),
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

    if params.gross_external_amount <= 0.0 {
        return Err("gross_external_amount must be positive".to_string());
    }
    if params.settlement_amount <= 0.0 {
        return Err("settlement_amount must be positive".to_string());
    }
    if params.net_account_amount < 0.0 {
        return Err("net_account_amount must be non-negative".to_string());
    }

    let reference_fingerprint = fingerprint_reference(&params.external_reference);

    // Duplicate reference guard within company + account + fingerprint scope.
    if !reference_fingerprint.is_empty() {
        let duplicate = ctx
            .db
            .payment_transaction()
            .iter()
            .any(|t| {
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
        occurred_at: params.occurred_at.unwrap_or(ctx.timestamp),
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

    let external_reference = params.external_reference.or(transaction.external_reference.clone());
    let reference_fingerprint = fingerprint_reference(&external_reference);

    // Re-check duplicate guard if reference changed.
    if reference_fingerprint != transaction.reference_fingerprint && !reference_fingerprint.is_empty() {
        let duplicate = ctx
            .db
            .payment_transaction()
            .iter()
            .any(|t| {
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

    let gross = params.gross_external_amount.unwrap_or(transaction.gross_external_amount);
    let settlement = params.settlement_amount.unwrap_or(transaction.settlement_amount);
    let net = params.net_account_amount.unwrap_or(transaction.net_account_amount);

    if gross <= 0.0 {
        return Err("gross_external_amount must be positive".to_string());
    }
    if settlement <= 0.0 {
        return Err("settlement_amount must be positive".to_string());
    }
    if net < 0.0 {
        return Err("net_account_amount must be non-negative".to_string());
    }

    ctx.db.payment_transaction().id().update(PaymentTransaction {
        external_reference,
        reference_fingerprint,
        gross_external_amount: gross,
        settlement_amount: settlement,
        net_account_amount: net,
        occurred_at: params.occurred_at.unwrap_or(transaction.occurred_at),
        evidence_document_ids: params.evidence_document_ids.unwrap_or(transaction.evidence_document_ids),
        updated_at: ctx.timestamp,
        updated_by: ctx.sender(),
        metadata: params.metadata.or(transaction.metadata),
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

    // Approval gate.
    let amount = transaction.settlement_amount;
    let params_json = serde_json::json!({
        "organization_id": organization_id,
        "transaction_id": transaction_id,
    })
    .to_string();
    let context_json = serde_json::json!({
        "amount": amount,
        "direction": format!("{:?}", transaction.direction),
        "provider": format!("{:?}", account.provider_code),
    })
    .to_string();
    let summary = format!("Post payment transaction (amount {:.2})", amount);
    if let Some(_request_id) = gate_action_with_approval(
        ctx,
        organization_id,
        transaction.company_id,
        "payment_transaction",
        transaction_id,
        "post_payment_transaction",
        amount,
        &summary,
        &params_json,
        Some(context_json),
    )? {
        return Err(format!(
            "Payment transaction requires approval before posting (amount {:.2})",
            amount
        ));
    }

    let account_payment_id = post_ledger_payment(
        ctx,
        organization_id,
        transaction.company_id,
        &account,
        &transaction,
    )?;

    ctx.db.payment_transaction().id().update(PaymentTransaction {
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

    ctx.db.payment_transaction().id().update(PaymentTransaction {
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
    if transaction.organization_id != organization_id || transaction.company_id != params.company_id {
        return Err("Payment transaction belongs to a different organization or company".to_string());
    }
    if transaction.status != PaymentTransactionStatus::Draft {
        return Err("Fees can only be added to draft transactions".to_string());
    }
    if params.amount < 0.0 {
        return Err("Fee amount must be non-negative".to_string());
    }

    let fee = ctx.db.payment_fee().insert(PaymentFee {
        id: 0,
        organization_id,
        company_id: params.company_id,
        payment_transaction_id: params.payment_transaction_id,
        bearer: params.bearer,
        amount: params.amount,
        currency_id: params.currency_id,
        fee_account_id: params.fee_account_id,
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

/// Allocate a posted payment transaction to a receivable/payable move line.
#[reducer]
pub fn allocate_payment_transaction(
    ctx: &ReducerContext,
    organization_id: u64,
    params: AllocatePaymentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "payment_reconciliation", "create")?;
    let transaction = ctx
        .db
        .payment_transaction()
        .id()
        .find(&params.payment_transaction_id)
        .ok_or("Payment transaction not found")?;
    if transaction.organization_id != organization_id || transaction.company_id != params.company_id {
        return Err("Payment transaction belongs to a different organization or company".to_string());
    }
    if transaction.status != PaymentTransactionStatus::Posted {
        return Err("Only posted transactions can be allocated".to_string());
    }
    let account_payment_id = transaction
        .account_payment_id
        .ok_or("Payment transaction has no linked ledger payment")?;

    let move_line = ctx
        .db
        .account_move_line()
        .id()
        .find(&params.allocated_move_line_id)
        .ok_or("Account move line not found")?;
    if move_line.company_id != params.company_id {
        return Err("Move line belongs to a different company".to_string());
    }

    if params.allocated_amount <= 0.0 {
        return Err("Allocated amount must be positive".to_string());
    }

    // Sum existing allocations for this transaction.
    let existing: Vec<PaymentReconciliation> = ctx
        .db
        .payment_reconciliation()
        .iter()
        .filter(|r| r.payment_transaction_id == params.payment_transaction_id)
        .collect();
    let allocated_total: f64 = existing.iter().map(|r| r.allocated_amount).sum::<f64>() + params.allocated_amount;
    if allocated_total > transaction.settlement_amount + 1e-6 {
        return Err(format!(
            "Total allocations {:.2} exceed settlement amount {:.2}",
            allocated_total, transaction.settlement_amount
        ));
    }

    let residual_before = move_line.amount_residual;
    let residual_after = residual_before - params.allocated_amount;

    let reconciliation = ctx.db.payment_reconciliation().insert(PaymentReconciliation {
        id: 0,
        organization_id,
        company_id: params.company_id,
        payment_transaction_id: params.payment_transaction_id,
        account_payment_id,
        allocated_move_line_id: params.allocated_move_line_id,
        allocated_amount: params.allocated_amount,
        currency_id: params.currency_id,
        residual_before,
        residual_after,
        write_off_amount: params.write_off_amount,
        write_off_account_id: params.write_off_account_id,
        is_reversal: false,
        reversed_reconciliation_id: None,
        created_at: ctx.timestamp,
        created_by: ctx.sender(),
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(params.company_id),
            table_name: "payment_reconciliation",
            record_id: reconciliation.id,
            action: "CREATE",
            old_values: None,
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
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
    check_permission(ctx, organization_id, "payment_transaction", "reverse")?;
    let original = ctx
        .db
        .payment_transaction()
        .id()
        .find(&transaction_id)
        .ok_or("Payment transaction not found")?;
    if original.organization_id != organization_id || original.company_id != params.company_id {
        return Err("Payment transaction belongs to a different organization or company".to_string());
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

    // Approval gate.
    let amount = original.settlement_amount;
    let params_json = serde_json::json!({
        "organization_id": organization_id,
        "transaction_id": transaction_id,
    })
    .to_string();
    let context_json = serde_json::json!({
        "amount": amount,
        "direction": format!("{:?}", original.direction),
        "original_transaction_id": transaction_id,
    })
    .to_string();
    let summary = format!("Reverse payment transaction (amount {:.2})", amount);
    if let Some(_request_id) = gate_action_with_approval(
        ctx,
        organization_id,
        params.company_id,
        "payment_transaction",
        transaction_id,
        "reverse_payment_transaction",
        amount,
        &summary,
        &params_json,
        Some(context_json),
    )? {
        return Err(format!(
            "Payment reversal requires approval before posting (amount {:.2})",
            amount
        ));
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
        external_reference: original.external_reference.clone().map(|r| format!("REV:{}", r)),
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

    ctx.db.payment_transaction().id().update(PaymentTransaction {
        account_payment_id: Some(correcting_account_payment_id),
        ..correcting
    });

    // Mark original as reversed.
    ctx.db.payment_transaction().id().update(PaymentTransaction {
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
