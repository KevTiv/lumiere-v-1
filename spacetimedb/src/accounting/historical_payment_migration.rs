//! Historical payment allocation for documents reconstructed at original value.
//!
//! Cutover imports can either book only the residual that is open on the cutover
//! date or recreate an original invoice/bill and then replay its payments. This
//! reducer supports only the second form. Applying a payment to a residual-only
//! document would reduce the receivable/payable twice, so those documents fail
//! closed based on their private migration metadata.

use std::collections::BTreeSet;

use serde::Deserialize;
use spacetimedb::{reducer, ReducerContext, SpacetimeType};

use crate::accounting::idempotency::{record_result, replayed_result};
use crate::accounting::journal_entries::{
    account_move, account_move_line, is_receivable_or_payable_line_type,
};
use crate::accounting::money::validate_pilot_money_amount;
use crate::accounting::payment_management::{
    allocate_payment_transaction, payment_reconciliation, payment_transaction,
    AllocatePaymentParams,
};
use crate::accounting::payments::{account_payment, AccountPayment};
use crate::core::organization::require_company_in_organization;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::types::{
    AccountMoveState, MoveType, PartnerType, PaymentDirection, PaymentState,
    PaymentTransactionStatus,
};

const MONEY_EPSILON: f64 = 0.000_001;
const HISTORICAL_DOCUMENT_MARKER: &str = "lumiere_historical_document";
const ORIGINAL_TOTAL_MODE: &str = "original_total";
const HISTORICAL_ACCOUNTING_IMPORT_SOURCE: &str = "historical_accounting_import";
const MICROS_PER_UTC_DAY: i64 = 86_400_000_000;

/// One exact application of a historical payment to an imported document.
#[derive(SpacetimeType, Clone, Debug)]
pub struct HistoricalPaymentAllocationInput {
    pub document_move_id: u64,
    pub allocated_amount: f64,
    /// Expected open balance immediately after this payment is applied.
    pub expected_residual_after: f64,
    /// Must be true on the last reconstructed payment for this document.
    pub completes_document_history: bool,
}

/// Atomically applies one posted historical payment across imported documents.
#[derive(SpacetimeType, Clone, Debug)]
pub struct ApplyHistoricalPaymentAllocationsParams {
    pub idempotency_key: String,
    pub company_id: u64,
    pub payment_transaction_id: u64,
    pub currency_id: u64,
    pub allocations: Vec<HistoricalPaymentAllocationInput>,
    pub metadata: Option<String>,
}

#[derive(Debug, Deserialize)]
struct HistoricalDocumentMarker {
    version: u64,
    mode: String,
    source_total: f64,
    source_paid_to_date: f64,
    expected_open_residual: f64,
}

#[derive(Debug)]
struct PlannedAllocation {
    input: HistoricalPaymentAllocationInput,
    move_line_id: u64,
    residual_before: f64,
    residual_after: f64,
}

fn approx_eq(left: f64, right: f64) -> bool {
    (left - right).abs() <= MONEY_EPSILON
}

fn canonicalize_inputs(
    allocations: &[HistoricalPaymentAllocationInput],
) -> Result<Vec<HistoricalPaymentAllocationInput>, String> {
    if allocations.is_empty() {
        return Err("at least one historical payment allocation is required".to_string());
    }

    let mut canonical = allocations.to_vec();
    canonical.sort_by_key(|allocation| allocation.document_move_id);
    let mut seen = BTreeSet::new();
    for allocation in &canonical {
        if !seen.insert(allocation.document_move_id) {
            return Err(format!(
                "document move {} appears more than once in the payment allocation",
                allocation.document_move_id
            ));
        }
        validate_pilot_money_amount("historical allocated amount", allocation.allocated_amount)?;
        validate_pilot_money_amount(
            "historical expected residual",
            allocation.expected_residual_after,
        )?;
        if allocation.allocated_amount <= 0.0 {
            return Err("historical allocated amount must be positive".to_string());
        }
        if allocation.expected_residual_after < 0.0 {
            return Err("historical expected residual cannot be negative".to_string());
        }
    }
    Ok(canonical)
}

fn payload_fingerprint(params: &ApplyHistoricalPaymentAllocationsParams) -> Result<String, String> {
    let canonical = canonicalize_inputs(&params.allocations)?;
    let allocations = canonical
        .iter()
        .map(|allocation| {
            format!(
                "{}:{}:{}:{}",
                allocation.document_move_id,
                allocation.allocated_amount.to_bits(),
                allocation.expected_residual_after.to_bits(),
                allocation.completes_document_history
            )
        })
        .collect::<Vec<_>>()
        .join("|");
    Ok(format!(
        "company={};transaction={};currency={};allocations={};metadata={:?}",
        params.company_id,
        params.payment_transaction_id,
        params.currency_id,
        allocations,
        params.metadata.as_deref()
    ))
}

fn derived_allocation_key(batch_key: &str, document_move_id: u64) -> String {
    use sha2::{Digest, Sha256};

    let digest = Sha256::digest(batch_key.as_bytes());
    format!(
        "historical-payment:{}:{document_move_id}",
        hex::encode(&digest[..16])
    )
}

/// Validate the explicit operator batch reference used to select payments for
/// historical reconstruction. `source_entity_id` is an opaque positive batch
/// reference; the current model has no durable migration-run table to resolve.
fn validate_payment_import_batch_reference(
    source_entity: Option<&str>,
    source_entity_id: Option<u64>,
) -> Result<(), String> {
    if source_entity != Some(HISTORICAL_ACCOUNTING_IMPORT_SOURCE) {
        return Err(format!(
            "historical payment transaction source_entity must be '{HISTORICAL_ACCOUNTING_IMPORT_SOURCE}'"
        ));
    }
    if !source_entity_id.is_some_and(|id| id > 0) {
        return Err(
            "historical payment transaction requires a positive source_entity_id operator batch reference"
                .to_string(),
        );
    }
    Ok(())
}

fn validate_payment_day_precedes_document(
    payment_occurred_at: spacetimedb::Timestamp,
    document_date: spacetimedb::Timestamp,
    document_move_id: u64,
) -> Result<(), String> {
    let payment_utc_day = payment_occurred_at
        .to_micros_since_unix_epoch()
        .div_euclid(MICROS_PER_UTC_DAY);
    let document_utc_day = document_date
        .to_micros_since_unix_epoch()
        .div_euclid(MICROS_PER_UTC_DAY);
    if payment_utc_day > document_utc_day {
        return Err(format!(
            "historical payment occurred_at UTC date cannot be later than document move {document_move_id} posting date"
        ));
    }
    Ok(())
}

fn parse_original_total_marker(metadata: Option<&str>) -> Result<HistoricalDocumentMarker, String> {
    let raw = metadata.ok_or_else(|| {
        "historical document metadata is required before replaying payments".to_string()
    })?;
    let value: serde_json::Value = serde_json::from_str(raw)
        .map_err(|_| "historical document metadata must be valid JSON".to_string())?;
    let marker = value
        .get("extra")
        .and_then(|extra| extra.get(HISTORICAL_DOCUMENT_MARKER))
        .ok_or_else(|| {
            "historical document metadata is missing the migration marker".to_string()
        })?;
    let marker: HistoricalDocumentMarker = serde_json::from_value(marker.clone())
        .map_err(|_| "historical document migration marker is invalid".to_string())?;

    if marker.version != 1 {
        return Err("unsupported historical document migration marker version".to_string());
    }
    if marker.mode != ORIGINAL_TOTAL_MODE {
        return Err(format!(
            "historical payments require mode '{ORIGINAL_TOTAL_MODE}'; mode '{}' already books the cutover residual",
            marker.mode
        ));
    }
    for (label, amount) in [
        ("source_total", marker.source_total),
        ("source_paid_to_date", marker.source_paid_to_date),
        ("expected_open_residual", marker.expected_open_residual),
    ] {
        validate_pilot_money_amount(label, amount)?;
        if amount < 0.0 {
            return Err(format!("{label} cannot be negative"));
        }
    }
    if marker.source_total <= 0.0 {
        return Err("source_total must be positive".to_string());
    }
    if !approx_eq(
        marker.source_total,
        marker.source_paid_to_date + marker.expected_open_residual,
    ) {
        return Err(
            "source_total must equal source_paid_to_date plus expected_open_residual".to_string(),
        );
    }
    Ok(marker)
}

fn expected_document_type(
    direction: &PaymentDirection,
    partner_type: &PartnerType,
) -> Option<MoveType> {
    match (direction, partner_type) {
        (PaymentDirection::Inbound, PartnerType::Customer) => Some(MoveType::OutInvoice),
        (PaymentDirection::Outbound, PartnerType::Supplier) => Some(MoveType::InInvoice),
        _ => None,
    }
}

fn validate_residual_transition(
    document_move_id: u64,
    residual_before: f64,
    marker: &HistoricalDocumentMarker,
    input: &HistoricalPaymentAllocationInput,
) -> Result<f64, String> {
    if input.allocated_amount > residual_before + MONEY_EPSILON {
        return Err(format!(
            "allocation exceeds document move {document_move_id} residual"
        ));
    }
    let residual_after = (residual_before - input.allocated_amount).max(0.0);
    if !approx_eq(residual_after, input.expected_residual_after) {
        return Err(format!(
            "document move {document_move_id} expected residual does not match the deterministic result"
        ));
    }
    if residual_after + MONEY_EPSILON < marker.expected_open_residual {
        return Err(format!(
            "document move {document_move_id} payment would reduce residual below its cutover balance"
        ));
    }
    if input.completes_document_history {
        if !approx_eq(residual_after, marker.expected_open_residual) {
            return Err(format!(
                "document move {document_move_id} final historical payment must reach its expected open residual"
            ));
        }
    } else if residual_after <= marker.expected_open_residual + MONEY_EPSILON {
        return Err(format!(
            "document move {document_move_id} reaches its final residual but is not marked complete"
        ));
    }
    Ok(residual_after)
}

/// Replay a posted historical payment against documents imported at original
/// gross value. The entire payment is allocated or the reducer changes nothing.
#[reducer]
pub fn apply_historical_payment_allocations(
    ctx: &ReducerContext,
    organization_id: u64,
    params: ApplyHistoricalPaymentAllocationsParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "payment_reconciliation", "create")?;
    require_company_in_organization(ctx, organization_id, params.company_id)?;

    let fingerprint = payload_fingerprint(&params)?;
    if replayed_result(
        ctx,
        organization_id,
        params.company_id,
        "apply_historical_payment_allocations",
        &params.idempotency_key,
        &fingerprint,
    )?
    .is_some()
    {
        return Ok(());
    }

    let transaction = ctx
        .db
        .payment_transaction()
        .id()
        .find(&params.payment_transaction_id)
        .ok_or("historical payment transaction not found")?;
    if transaction.organization_id != organization_id || transaction.company_id != params.company_id
    {
        return Err(
            "historical payment transaction does not match organization and company".to_string(),
        );
    }
    validate_payment_import_batch_reference(
        transaction.source_entity.as_deref(),
        transaction.source_entity_id,
    )?;
    if transaction.status != PaymentTransactionStatus::Posted {
        return Err("historical payment transaction must be posted before allocation".to_string());
    }
    if transaction.currency_id != params.currency_id {
        return Err("historical payment currency does not match the transaction".to_string());
    }
    let expected_move_type = expected_document_type(
        &transaction.direction,
        &transaction.partner_type,
    )
    .ok_or_else(|| {
        "historical reconstruction currently supports customer receipts and supplier payments"
            .to_string()
    })?;

    let account_payment_id = transaction
        .account_payment_id
        .ok_or("posted historical transaction is missing its ledger payment")?;
    let ledger_payment: AccountPayment = ctx
        .db
        .account_payment()
        .id()
        .find(&account_payment_id)
        .ok_or("historical transaction ledger payment not found")?;
    if ledger_payment.organization_id != organization_id
        || ledger_payment.company_id != params.company_id
        || ledger_payment.partner_id != transaction.partner_id
        || ledger_payment.currency_id != params.currency_id
        || !approx_eq(ledger_payment.amount, transaction.settlement_amount)
        || ledger_payment.state != PaymentState::Paid
    {
        return Err("historical transaction ledger payment is inconsistent".to_string());
    }
    let payment_move_id = ledger_payment
        .move_id
        .ok_or("historical transaction ledger payment is missing its move")?;
    let payment_move = ctx
        .db
        .account_move()
        .id()
        .find(&payment_move_id)
        .ok_or("historical transaction ledger move not found")?;
    if payment_move.organization_id != organization_id
        || payment_move.company_id != params.company_id
        || payment_move.state != AccountMoveState::Posted
        || !approx_eq(
            payment_move.amount_residual.abs(),
            transaction.settlement_amount,
        )
    {
        return Err("historical transaction ledger move residual is inconsistent".to_string());
    }

    let active_reconciliations = ctx
        .db
        .payment_reconciliation()
        .reconciliation_by_transaction()
        .filter(&transaction.id)
        .filter(|row| !row.is_reversal)
        .count();
    if active_reconciliations != 0 {
        return Err(
            "historical payment transaction already has allocations outside this batch".to_string(),
        );
    }

    let canonical = canonicalize_inputs(&params.allocations)?;
    let allocated_total: f64 = canonical.iter().map(|row| row.allocated_amount).sum();
    validate_pilot_money_amount("historical allocation total", allocated_total)?;
    if !approx_eq(allocated_total, transaction.settlement_amount) {
        return Err(format!(
            "historical allocations must total the payment settlement amount ({})",
            transaction.settlement_amount
        ));
    }

    let mut plan = Vec::with_capacity(canonical.len());
    for input in canonical {
        let document = ctx
            .db
            .account_move()
            .id()
            .find(&input.document_move_id)
            .ok_or_else(|| format!("document move {} not found", input.document_move_id))?;
        if document.organization_id != organization_id || document.company_id != params.company_id {
            return Err(format!(
                "document move {} does not match organization and company",
                document.id
            ));
        }
        if document.state != AccountMoveState::Posted || document.move_type != expected_move_type {
            return Err(format!(
                "document move {} is not a posted invoice/bill compatible with the payment",
                document.id
            ));
        }
        validate_payment_day_precedes_document(
            transaction.occurred_at,
            document.date,
            document.id,
        )?;
        if document.partner_id != Some(transaction.partner_id)
            || document.currency_id != params.currency_id
            || document.company_currency_id != params.currency_id
        {
            return Err(format!(
                "document move {} partner or currency does not match the payment",
                document.id
            ));
        }

        let marker = parse_original_total_marker(document.metadata.as_deref())?;
        if !approx_eq(document.amount_total.abs(), marker.source_total) {
            return Err(format!(
                "document move {} total does not match its historical source total",
                document.id
            ));
        }

        let counterpart_lines = ctx
            .db
            .account_move_line()
            .move_line_by_move()
            .filter(&document.id)
            .filter(|line| {
                is_receivable_or_payable_line_type(line.account_internal_type.as_deref())
            })
            .collect::<Vec<_>>();
        let [move_line] = counterpart_lines.as_slice() else {
            return Err(format!(
                "document move {} must have exactly one receivable/payable line",
                document.id
            ));
        };
        if move_line.organization_id != organization_id
            || move_line.company_id != params.company_id
            || move_line.partner_id != Some(transaction.partner_id)
            || move_line.currency_id != params.currency_id
        {
            return Err(format!(
                "document move {} receivable/payable line is outside payment scope",
                document.id
            ));
        }

        let residual_before = move_line.amount_residual.abs();
        if residual_before <= MONEY_EPSILON
            || !approx_eq(document.amount_residual.abs(), residual_before)
        {
            return Err(format!(
                "document move {} has an inconsistent open residual",
                document.id
            ));
        }
        let residual_after =
            validate_residual_transition(document.id, residual_before, &marker, &input)?;

        plan.push(PlannedAllocation {
            input,
            move_line_id: move_line.id,
            residual_before,
            residual_after,
        });
    }

    for allocation in &plan {
        allocate_payment_transaction(
            ctx,
            organization_id,
            AllocatePaymentParams {
                idempotency_key: derived_allocation_key(
                    &params.idempotency_key,
                    allocation.input.document_move_id,
                ),
                company_id: params.company_id,
                payment_transaction_id: params.payment_transaction_id,
                allocated_move_line_id: allocation.move_line_id,
                allocated_amount: allocation.input.allocated_amount,
                currency_id: params.currency_id,
                write_off_amount: 0.0,
                write_off_account_id: None,
                metadata: params.metadata.clone(),
            },
        )?;
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(params.company_id),
            table_name: "payment_transaction",
            record_id: params.payment_transaction_id,
            action: "HISTORICAL_PAYMENT_RECONSTRUCTION",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "allocations": plan.iter().map(|row| serde_json::json!({
                        "document_move_id": row.input.document_move_id,
                        "move_line_id": row.move_line_id,
                        "allocated_amount": row.input.allocated_amount,
                        "residual_before": row.residual_before,
                        "residual_after": row.residual_after,
                        "completes_document_history": row.input.completes_document_history,
                    })).collect::<Vec<_>>()
                })
                .to_string(),
            ),
            changed_fields: vec!["payment_reconciliation".to_string()],
            metadata: params.metadata.clone(),
        },
    );

    record_result(
        ctx,
        organization_id,
        params.company_id,
        "apply_historical_payment_allocations",
        params.idempotency_key,
        fingerprint,
        "payment_transaction",
        params.payment_transaction_id,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allocation(
        document_move_id: u64,
        allocated_amount: f64,
        expected_residual_after: f64,
        completes_document_history: bool,
    ) -> HistoricalPaymentAllocationInput {
        HistoricalPaymentAllocationInput {
            document_move_id,
            allocated_amount,
            expected_residual_after,
            completes_document_history,
        }
    }

    #[test]
    fn canonical_input_order_is_stable_and_duplicate_documents_fail() {
        let canonical = canonicalize_inputs(&[
            allocation(9, 20.0, 80.0, false),
            allocation(2, 10.0, 40.0, true),
        ])
        .expect("valid allocation list");
        assert_eq!(canonical[0].document_move_id, 2);
        assert_eq!(canonical[1].document_move_id, 9);

        let duplicate = canonicalize_inputs(&[
            allocation(2, 10.0, 40.0, false),
            allocation(2, 5.0, 35.0, true),
        ]);
        assert!(duplicate.is_err());
    }

    #[test]
    fn allocation_numbers_fail_closed() {
        for allocations in [
            vec![allocation(1, f64::NAN, 0.0, true)],
            vec![allocation(1, 0.0, 0.0, true)],
            vec![allocation(1, 10.0, -1.0, true)],
            vec![allocation(1, 10.0, f64::INFINITY, true)],
        ] {
            assert!(canonicalize_inputs(&allocations).is_err());
        }
    }

    #[test]
    fn historical_payment_requires_an_operator_import_batch_reference() {
        assert!(validate_payment_import_batch_reference(
            Some(HISTORICAL_ACCOUNTING_IMPORT_SOURCE),
            Some(9)
        )
        .is_ok());
        for (source, run_id) in [
            (None, Some(9)),
            (Some("bank_statement_import"), Some(9)),
            (Some(HISTORICAL_ACCOUNTING_IMPORT_SOURCE), None),
            (Some(HISTORICAL_ACCOUNTING_IMPORT_SOURCE), Some(0)),
        ] {
            assert!(validate_payment_import_batch_reference(source, run_id).is_err());
        }
    }

    #[test]
    fn historical_payment_utc_date_cannot_follow_its_target_document() {
        let document_date =
            spacetimedb::Timestamp::from_micros_since_unix_epoch(20 * MICROS_PER_UTC_DAY);
        assert!(validate_payment_day_precedes_document(
            spacetimedb::Timestamp::from_micros_since_unix_epoch(19 * MICROS_PER_UTC_DAY),
            document_date,
            42,
        )
        .is_ok());
        assert!(validate_payment_day_precedes_document(
            spacetimedb::Timestamp::from_micros_since_unix_epoch(
                20 * MICROS_PER_UTC_DAY + MICROS_PER_UTC_DAY - 1,
            ),
            document_date,
            42,
        )
        .is_ok());
        assert!(validate_payment_day_precedes_document(
            spacetimedb::Timestamp::from_micros_since_unix_epoch(21 * MICROS_PER_UTC_DAY),
            document_date,
            42,
        )
        .is_err());
    }

    #[test]
    fn marker_rejects_residual_only_mode_and_inconsistent_source_math() {
        let residual_only = serde_json::json!({
            "extra": { (HISTORICAL_DOCUMENT_MARKER): {
                "version": 1,
                "mode": "cutover_open_residual",
                "source_total": 100.0,
                "source_paid_to_date": 40.0,
                "expected_open_residual": 60.0
            }}
        })
        .to_string();
        assert!(parse_original_total_marker(Some(&residual_only)).is_err());

        let inconsistent = serde_json::json!({
            "extra": { (HISTORICAL_DOCUMENT_MARKER): {
                "version": 1,
                "mode": ORIGINAL_TOTAL_MODE,
                "source_total": 100.0,
                "source_paid_to_date": 30.0,
                "expected_open_residual": 60.0
            }}
        })
        .to_string();
        assert!(parse_original_total_marker(Some(&inconsistent)).is_err());
    }

    #[test]
    fn residual_transition_requires_declared_exact_and_final_state() {
        let marker = HistoricalDocumentMarker {
            version: 1,
            mode: ORIGINAL_TOTAL_MODE.to_string(),
            source_total: 100.0,
            source_paid_to_date: 40.0,
            expected_open_residual: 60.0,
        };

        assert_eq!(
            validate_residual_transition(7, 100.0, &marker, &allocation(7, 25.0, 75.0, false))
                .expect("intermediate allocation"),
            75.0
        );
        assert_eq!(
            validate_residual_transition(7, 75.0, &marker, &allocation(7, 15.0, 60.0, true))
                .expect("final allocation"),
            60.0
        );
        assert!(
            validate_residual_transition(7, 100.0, &marker, &allocation(7, 25.0, 74.0, false))
                .is_err()
        );
        assert!(
            validate_residual_transition(7, 75.0, &marker, &allocation(7, 20.0, 55.0, true))
                .is_err()
        );
        assert!(
            validate_residual_transition(7, 75.0, &marker, &allocation(7, 15.0, 60.0, false))
                .is_err()
        );
    }

    #[test]
    fn canonical_fingerprint_accepts_reordered_replay_but_detects_payload_change() {
        let base = ApplyHistoricalPaymentAllocationsParams {
            idempotency_key: "history-1".to_string(),
            company_id: 4,
            payment_transaction_id: 8,
            currency_id: 12,
            allocations: vec![
                allocation(2, 10.0, 40.0, true),
                allocation(9, 20.0, 80.0, false),
            ],
            metadata: Some("source=batch-a".to_string()),
        };
        let reordered = ApplyHistoricalPaymentAllocationsParams {
            allocations: base.allocations.iter().cloned().rev().collect(),
            ..base.clone()
        };
        assert_eq!(
            payload_fingerprint(&base).expect("base fingerprint"),
            payload_fingerprint(&reordered).expect("reordered fingerprint")
        );

        let changed = ApplyHistoricalPaymentAllocationsParams {
            allocations: vec![
                allocation(2, 9.0, 41.0, true),
                allocation(9, 20.0, 80.0, false),
            ],
            ..base
        };
        assert_ne!(
            payload_fingerprint(&changed).expect("changed fingerprint"),
            payload_fingerprint(&reordered).expect("reordered fingerprint")
        );
    }
}
