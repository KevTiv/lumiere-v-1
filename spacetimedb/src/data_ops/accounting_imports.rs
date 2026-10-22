/// Accounting CSV Imports — AccountAccount, AccountTax, AccountMove, AccountMoveLine,
/// CrossoveredBudget, CrossoveredBudgetLines, AccountAnalyticAccount
use std::collections::{BTreeMap, BTreeSet};

use spacetimedb::{ReducerContext, Table};

use crate::accounting::analytic_accounting::{account_analytic_account, AccountAnalyticAccount};
use crate::accounting::budgeting::{
    crossovered_budget, crossovered_budget_lines, CrossoveredBudget, CrossoveredBudgetLines,
};
use crate::accounting::chart_of_accounts::{
    account_account, account_account_type, account_group, AccountAccount,
};
use crate::accounting::journal_entries::{
    account_move, account_move_line, AccountMove, AccountMoveLine,
};
use crate::accounting::payment_terms::account_payment_term;
use crate::accounting::relations::{
    require_active_account, require_active_journal, require_active_tax_ids,
    require_analytic_account, require_contact_in_scope,
};
use crate::accounting::tax_management::{account_tax, account_tax_group, AccountTax};
use crate::core::organization::{company, require_company_in_organization};
use crate::core::reference::require_active_currency_for_organization;
use crate::data_ops::helpers::*;
use crate::data_ops::import_tracker::{
    account_move_bundle_job_metadata, begin_import_job, finish_import_job, import_job,
    import_job_record, record_import_created_id, record_import_error,
    stamp_account_move_bundle_job, ImportJob,
};
use crate::helpers::check_permission;
use crate::inventory::product::product;
use crate::inventory::stock::require_product_in_org;
use crate::manufacturing::relations::{require_uom_compatible, require_uom_in_org};
use crate::projects::projects::project_project;
use crate::types::{
    AccountInternalGroup, AccountMoveState, AccountTypeInternal, BudgetState, JournalType,
    MoveType, PaymentState, TaxAmountType, TaxTypeUse,
};

#[derive(Debug)]
struct ImportFieldError {
    field: &'static str,
    raw_value: String,
    message: String,
}

impl ImportFieldError {
    fn new(field: &'static str, raw_value: &str, message: impl Into<String>) -> Self {
        Self {
            field,
            raw_value: raw_value.to_string(),
            message: message.into(),
        }
    }
}

fn required_id(
    headers: &[String],
    row: &[String],
    field: &'static str,
) -> Result<u64, ImportFieldError> {
    let raw = col(headers, row, field);
    parse_import_id(raw)
        .map_err(|message| ImportFieldError::new(field, raw, message))?
        .ok_or_else(|| ImportFieldError::new(field, raw, format!("{field} is required")))
}

fn optional_id(
    headers: &[String],
    row: &[String],
    field: &'static str,
) -> Result<Option<u64>, ImportFieldError> {
    let raw = col(headers, row, field);
    parse_import_id(raw).map_err(|message| ImportFieldError::new(field, raw, message))
}

fn id_list(
    headers: &[String],
    row: &[String],
    field: &'static str,
) -> Result<Vec<u64>, ImportFieldError> {
    let raw = col(headers, row, field);
    parse_import_ids(raw).map_err(|message| ImportFieldError::new(field, raw, message))
}

fn number_or_zero(
    headers: &[String],
    row: &[String],
    field: &'static str,
) -> Result<f64, ImportFieldError> {
    let raw = col(headers, row, field);
    parse_import_number(raw)
        .map_err(|message| ImportFieldError::new(field, raw, message))
        .map(|value| value.unwrap_or(0.0))
}

fn optional_number(
    headers: &[String],
    row: &[String],
    field: &'static str,
) -> Result<Option<f64>, ImportFieldError> {
    let raw = col(headers, row, field);
    parse_import_number(raw).map_err(|message| ImportFieldError::new(field, raw, message))
}

fn normalized_opening_balance(
    debit: f64,
    credit: f64,
    raw_debit: &str,
    raw_credit: &str,
    raw_balance: &str,
) -> Result<f64, ImportFieldError> {
    let imported_balance = parse_import_number(raw_balance)
        .map_err(|message| ImportFieldError::new("opening_balance", raw_balance, message))?;
    if raw_debit.trim().is_empty() && raw_credit.trim().is_empty() {
        return Ok(imported_balance.unwrap_or(0.0));
    }

    if debit < 0.0 {
        return Err(ImportFieldError::new(
            "opening_debit",
            &debit.to_string(),
            "opening_debit cannot be negative",
        ));
    }
    if credit < 0.0 {
        return Err(ImportFieldError::new(
            "opening_credit",
            &credit.to_string(),
            "opening_credit cannot be negative",
        ));
    }
    if debit > 0.0 && credit > 0.0 {
        return Err(ImportFieldError::new(
            "opening_credit",
            &credit.to_string(),
            "an account opening balance cannot have both debit and credit amounts",
        ));
    }

    let derived = debit - credit;
    let Some(imported) = imported_balance else {
        return Ok(derived);
    };
    if (imported - derived).abs() > 0.000_001 {
        return Err(ImportFieldError::new(
            "opening_balance",
            raw_balance,
            format!("opening_balance must equal opening_debit - opening_credit ({derived})"),
        ));
    }
    Ok(derived)
}

fn imported_move_type(raw: &str) -> Result<MoveType, ImportFieldError> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "" | "entry" => Ok(MoveType::Entry),
        "out_invoice" => Ok(MoveType::OutInvoice),
        "out_refund" => Ok(MoveType::OutRefund),
        "in_invoice" => Ok(MoveType::InInvoice),
        "in_refund" => Ok(MoveType::InRefund),
        "out_receipt" => Ok(MoveType::OutInvoice),
        "in_receipt" => Ok(MoveType::InInvoice),
        _ => Err(ImportFieldError::new(
            "move_type",
            raw,
            "unsupported move_type; expected entry, out_invoice, out_refund, in_invoice, in_refund, out_receipt, or in_receipt",
        )),
    }
}

fn validate_imported_debit_credit(debit: f64, credit: f64) -> Result<(), ImportFieldError> {
    if debit < 0.0 {
        return Err(ImportFieldError::new(
            "debit",
            &debit.to_string(),
            "debit cannot be negative",
        ));
    }
    if credit < 0.0 {
        return Err(ImportFieldError::new(
            "credit",
            &credit.to_string(),
            "credit cannot be negative",
        ));
    }
    if debit > 0.0 && credit > 0.0 {
        return Err(ImportFieldError::new(
            "credit",
            &credit.to_string(),
            "a journal line cannot have both debit and credit amounts",
        ));
    }
    if debit == 0.0 && credit == 0.0 {
        return Err(ImportFieldError::new(
            "debit",
            "0",
            "a journal line requires a debit or credit amount",
        ));
    }
    Ok(())
}

// Keep import admission aligned with the journal posting check. A move may be
// built on top of existing draft lines, but the state after this import must be
// balanced before any new line is persisted.
const MOVE_BALANCE_TOLERANCE: f64 = 0.01;
// Must stay aligned with historical_payment_migration::MONEY_EPSILON so an
// accepted original-total document is always eligible for payment replay.
const HISTORICAL_REPLAY_EPSILON: f64 = 0.000_001;
const ACCOUNT_MOVE_BUNDLE_METADATA_KEY: &str = "lumiere_account_move_bundle";
const HISTORICAL_DOCUMENT_METADATA_KEY: &str = "lumiere_historical_document";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HistoricalDocumentMode {
    CutoverOpenResidual,
    OriginalTotal,
}

#[derive(Clone, Debug, PartialEq)]
struct HistoricalDocumentMarker {
    mode: HistoricalDocumentMode,
    source_total: f64,
    source_paid_to_date: f64,
    expected_open_residual: f64,
}

fn historical_document_marker(
    metadata: Option<&str>,
) -> Result<Option<HistoricalDocumentMarker>, String> {
    let Some(raw) = metadata else {
        return Ok(None);
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        return Ok(None);
    };
    let Some(marker) = value
        .get("extra")
        .and_then(|extra| extra.get(HISTORICAL_DOCUMENT_METADATA_KEY))
    else {
        return Ok(None);
    };
    if marker.get("version").and_then(serde_json::Value::as_u64) != Some(1) {
        return Err("historical document marker version must be 1".to_string());
    }
    let mode =
        match marker.get("mode").and_then(serde_json::Value::as_str) {
            Some("cutover_open_residual") => HistoricalDocumentMode::CutoverOpenResidual,
            Some("original_total") => HistoricalDocumentMode::OriginalTotal,
            _ => return Err(
                "historical document marker mode must be cutover_open_residual or original_total"
                    .to_string(),
            ),
        };
    let finite_number = |field: &str| {
        marker
            .get(field)
            .and_then(serde_json::Value::as_f64)
            .filter(|amount| amount.is_finite())
            .ok_or_else(|| format!("historical document {field} must be a finite number"))
    };
    Ok(Some(HistoricalDocumentMarker {
        mode,
        source_total: finite_number("source_total")?,
        source_paid_to_date: finite_number("source_paid_to_date")?,
        expected_open_residual: finite_number("expected_open_residual")?,
    }))
}

fn validate_historical_document_parent(
    move_type: &MoveType,
    partner_id: Option<u64>,
    currency_id: u64,
    company_currency_id: u64,
    posting_date: spacetimedb::Timestamp,
    invoice_date: Option<spacetimedb::Timestamp>,
    invoice_date_due: Option<spacetimedb::Timestamp>,
    amount_untaxed: f64,
    amount_tax: f64,
    amount_total: f64,
    opening_residual: Option<f64>,
    marker: Option<&HistoricalDocumentMarker>,
) -> Result<(), ImportFieldError> {
    if opening_residual.is_none() && marker.is_none() {
        return Ok(());
    }
    let residual = opening_residual.ok_or_else(|| {
        ImportFieldError::new(
            "opening_residual",
            "",
            "historical document metadata requires opening_residual",
        )
    })?;
    let marker = marker.ok_or_else(|| {
        ImportFieldError::new(
            "metadata",
            "",
            "opening_residual requires historical-document audit metadata",
        )
    })?;
    if currency_id != company_currency_id {
        return Err(ImportFieldError::new(
            "currency_id",
            &currency_id.to_string(),
            "historical outstanding documents must use the company currency",
        ));
    }
    if !matches!(move_type, MoveType::OutInvoice | MoveType::InInvoice) {
        return Err(ImportFieldError::new(
            "move_type",
            &format!("{move_type:?}"),
            "outstanding document import supports only customer invoices and vendor bills",
        ));
    }
    if partner_id.is_none() {
        return Err(ImportFieldError::new(
            "partner_id",
            "",
            "outstanding document import requires partner_id",
        ));
    }
    let invoice_date = invoice_date.ok_or_else(|| {
        ImportFieldError::new(
            "invoice_date",
            "",
            "outstanding document import requires invoice_date",
        )
    })?;
    let due_date = invoice_date_due.ok_or_else(|| {
        ImportFieldError::new(
            "invoice_date_due",
            "",
            "outstanding document import requires invoice_date_due",
        )
    })?;
    if posting_date.to_micros_since_unix_epoch() < invoice_date.to_micros_since_unix_epoch() {
        return Err(ImportFieldError::new(
            "date",
            &posting_date.to_micros_since_unix_epoch().to_string(),
            "historical document posting date cannot be before invoice_date",
        ));
    }
    if due_date.to_micros_since_unix_epoch() < invoice_date.to_micros_since_unix_epoch() {
        return Err(ImportFieldError::new(
            "invoice_date_due",
            &due_date.to_micros_since_unix_epoch().to_string(),
            "invoice_date_due cannot be before invoice_date",
        ));
    }
    if residual <= 0.0 {
        return Err(ImportFieldError::new(
            "opening_residual",
            &residual.to_string(),
            "opening_residual must be greater than zero",
        ));
    }
    let expected_booked_residual = match marker.mode {
        HistoricalDocumentMode::CutoverOpenResidual => marker.expected_open_residual,
        HistoricalDocumentMode::OriginalTotal => marker.source_total,
    };
    let historical_tolerance = match marker.mode {
        HistoricalDocumentMode::CutoverOpenResidual => MOVE_BALANCE_TOLERANCE,
        HistoricalDocumentMode::OriginalTotal => HISTORICAL_REPLAY_EPSILON,
    };
    if (residual - expected_booked_residual).abs() > historical_tolerance {
        let expectation = match marker.mode {
            HistoricalDocumentMode::CutoverOpenResidual => "expected_open_residual",
            HistoricalDocumentMode::OriginalTotal => "source_total",
        };
        return Err(ImportFieldError::new(
            "opening_residual",
            &residual.to_string(),
            format!("historical document opening_residual must equal marker {expectation}"),
        ));
    }
    if (amount_total - residual).abs() > historical_tolerance
        || (amount_total - expected_booked_residual).abs() > historical_tolerance
    {
        return Err(ImportFieldError::new(
            "amount_total",
            &amount_total.to_string(),
            "historical document amount_total must equal its booked opening_residual",
        ));
    }
    if (amount_untaxed + amount_tax - amount_total).abs() > MOVE_BALANCE_TOLERANCE {
        return Err(ImportFieldError::new(
            "amount_total",
            &amount_total.to_string(),
            "amount_untaxed plus amount_tax must equal amount_total",
        ));
    }
    if marker.source_total <= 0.0
        || marker.expected_open_residual <= 0.0
        || marker.expected_open_residual > marker.source_total
        || residual > marker.source_total
        || marker.source_paid_to_date < 0.0
        || (marker.source_total - marker.source_paid_to_date - marker.expected_open_residual).abs()
            > historical_tolerance
    {
        return Err(ImportFieldError::new(
            "metadata",
            "",
            "historical document audit totals do not reconcile to expected_open_residual",
        ));
    }
    Ok(())
}

fn validate_historical_counterpart_line(
    parent_move: &AccountMove,
    account: &AccountAccount,
    partner_id: Option<u64>,
    debit: f64,
    credit: f64,
    opening_residual: f64,
    marker: &HistoricalDocumentMarker,
) -> Result<(), ImportFieldError> {
    let (expected_type, expected_debit, expected_credit) = match &parent_move.move_type {
        MoveType::OutInvoice => (AccountTypeInternal::Receivable, opening_residual, 0.0),
        MoveType::InInvoice => (AccountTypeInternal::Payable, 0.0, opening_residual),
        _ => {
            return Err(ImportFieldError::new(
                "move_id",
                &parent_move.id.to_string(),
                "opening_residual lines require a customer invoice or vendor bill",
            ));
        }
    };
    if account.internal_type.as_ref() != Some(&expected_type)
        || account.is_off_balance
        || !account.reconcile
    {
        return Err(ImportFieldError::new(
            "account_id",
            &account.id.to_string(),
            format!(
                "outstanding {:?} requires an on-balance reconciliable {:?} account",
                parent_move.move_type, expected_type
            ),
        ));
    }
    if account
        .currency_id
        .is_some_and(|currency_id| currency_id != parent_move.currency_id)
    {
        return Err(ImportFieldError::new(
            "account_id",
            &account.id.to_string(),
            "counterpart account currency does not match the outstanding document currency",
        ));
    }
    if !account.allowed_journal_ids.is_empty()
        && !account
            .allowed_journal_ids
            .contains(&parent_move.journal_id)
    {
        return Err(ImportFieldError::new(
            "account_id",
            &account.id.to_string(),
            "counterpart account is not allowed for the outstanding document journal",
        ));
    }
    if partner_id != parent_move.partner_id {
        return Err(ImportFieldError::new(
            "partner_id",
            &partner_id.map_or_else(String::new, |id| id.to_string()),
            "outstanding counterpart line partner_id must match the document partner_id",
        ));
    }
    let historical_tolerance = match marker.mode {
        HistoricalDocumentMode::CutoverOpenResidual => MOVE_BALANCE_TOLERANCE,
        HistoricalDocumentMode::OriginalTotal => HISTORICAL_REPLAY_EPSILON,
    };
    if (opening_residual - parent_move.amount_total).abs() > historical_tolerance {
        return Err(ImportFieldError::new(
            "opening_residual",
            &opening_residual.to_string(),
            "counterpart opening_residual must equal the document amount_total",
        ));
    }
    if (debit - expected_debit).abs() > historical_tolerance
        || (credit - expected_credit).abs() > historical_tolerance
    {
        return Err(ImportFieldError::new(
            "opening_residual",
            &opening_residual.to_string(),
            "counterpart debit and credit direction must match the document type and opening_residual",
        ));
    }
    Ok(())
}

fn validate_historical_line_scope(
    parent_move: &AccountMove,
    account: &AccountAccount,
    partner_id: Option<u64>,
    currency_id: u64,
    company_currency_id: u64,
    date: spacetimedb::Timestamp,
) -> Result<(), ImportFieldError> {
    validate_historical_line_dimensions(
        parent_move.currency_id,
        parent_move.company_currency_id,
        parent_move.date,
        parent_move.partner_id,
        currency_id,
        company_currency_id,
        date,
        partner_id,
    )?;
    validate_historical_account_dimensions(
        account.id,
        account.is_off_balance,
        account.currency_id,
        &account.allowed_journal_ids,
        parent_move.currency_id,
        parent_move.journal_id,
    )
}

#[allow(clippy::too_many_arguments)]
fn validate_historical_line_dimensions(
    parent_currency_id: u64,
    parent_company_currency_id: u64,
    parent_date: spacetimedb::Timestamp,
    parent_partner_id: Option<u64>,
    currency_id: u64,
    company_currency_id: u64,
    date: spacetimedb::Timestamp,
    partner_id: Option<u64>,
) -> Result<(), ImportFieldError> {
    if parent_currency_id != parent_company_currency_id
        || currency_id != parent_currency_id
        || company_currency_id != parent_company_currency_id
    {
        return Err(ImportFieldError::new(
            "currency_id",
            &currency_id.to_string(),
            "historical document lines and parent must use the company currency",
        ));
    }
    if date != parent_date {
        return Err(ImportFieldError::new(
            "date",
            &date.to_micros_since_unix_epoch().to_string(),
            "historical document line date must match its parent",
        ));
    }
    if partner_id != parent_partner_id {
        return Err(ImportFieldError::new(
            "partner_id",
            &partner_id.map_or_else(String::new, |id| id.to_string()),
            "historical document line partner_id must match its parent",
        ));
    }
    Ok(())
}

fn validate_historical_account_dimensions(
    account_id: u64,
    is_off_balance: bool,
    account_currency_id: Option<u64>,
    allowed_journal_ids: &[u64],
    parent_currency_id: u64,
    parent_journal_id: u64,
) -> Result<(), ImportFieldError> {
    if is_off_balance {
        return Err(ImportFieldError::new(
            "account_id",
            &account_id.to_string(),
            "historical document lines require on-balance accounts",
        ));
    }
    if account_currency_id.is_some_and(|currency_id| currency_id != parent_currency_id) {
        return Err(ImportFieldError::new(
            "account_id",
            &account_id.to_string(),
            "historical document account currency must match the company currency",
        ));
    }
    if !allowed_journal_ids.is_empty() && !allowed_journal_ids.contains(&parent_journal_id) {
        return Err(ImportFieldError::new(
            "account_id",
            &account_id.to_string(),
            "historical document account is not allowed for the parent journal",
        ));
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct AccountMoveBundleMarker {
    token: String,
    fingerprint: Option<String>,
    original_extra_present: bool,
    original_extra: serde_json::Value,
}

fn account_move_bundle_marker_present(metadata: Option<&str>) -> bool {
    serde_json::from_str::<serde_json::Value>(metadata.unwrap_or(""))
        .ok()
        .and_then(|value| {
            value
                .get("extra")?
                .get(ACCOUNT_MOVE_BUNDLE_METADATA_KEY)
                .cloned()
        })
        .is_some()
}

fn parse_account_move_bundle_marker(
    metadata: Option<&str>,
) -> Result<AccountMoveBundleMarker, String> {
    let raw = metadata.ok_or("account move bundle metadata is missing")?;
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|_| "account move bundle metadata must be valid JSON")?;
    let current_extra = value
        .get("extra")
        .and_then(serde_json::Value::as_object)
        .ok_or("account move bundle metadata.extra must be an object")?;
    let marker = current_extra
        .get(ACCOUNT_MOVE_BUNDLE_METADATA_KEY)
        .ok_or("account move bundle marker is missing")?;
    if marker.get("version").and_then(serde_json::Value::as_u64) != Some(1) {
        return Err("account move bundle marker version must be 1".to_string());
    }
    let token = marker
        .get("token")
        .and_then(serde_json::Value::as_str)
        .ok_or("account move bundle marker token is missing")?
        .trim();
    if token.is_empty() {
        return Err("account move bundle marker token cannot be empty".to_string());
    }
    let fingerprint = marker
        .get("fingerprint")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let original_extra_present = marker
        .get("original_extra_present")
        .and_then(serde_json::Value::as_bool)
        .ok_or("account move bundle marker original_extra_present is missing")?;
    let original_extra = marker
        .get("original_extra")
        .cloned()
        .ok_or("account move bundle marker original_extra is missing")?;
    if !original_extra_present && !original_extra.is_null() {
        return Err(
            "account move bundle marker has original_extra while original_extra_present is false"
                .to_string(),
        );
    }
    if original_extra_present
        && original_extra
            .as_object()
            .is_some_and(|extra| extra.contains_key(ACCOUNT_MOVE_BUNDLE_METADATA_KEY))
    {
        return Err("original metadata.extra contains the reserved bundle marker key".to_string());
    }
    let mut current_remainder = current_extra.clone();
    current_remainder.remove(ACCOUNT_MOVE_BUNDLE_METADATA_KEY);
    if !original_extra_present {
        if !current_remainder.is_empty() {
            return Err(
                "account move bundle metadata.extra has unexpected sibling fields".to_string(),
            );
        }
    } else if let Some(original_object) = original_extra.as_object() {
        if &current_remainder != original_object {
            return Err(
                "account move bundle metadata.extra no longer matches its restore snapshot"
                    .to_string(),
            );
        }
    } else if !current_remainder.is_empty() {
        return Err(
            "account move bundle metadata.extra has siblings for a non-object restore snapshot"
                .to_string(),
        );
    }
    Ok(AccountMoveBundleMarker {
        token: token.to_string(),
        fingerprint,
        original_extra_present,
        original_extra,
    })
}

fn account_move_bundle_marker(metadata: Option<&str>) -> Option<AccountMoveBundleMarker> {
    parse_account_move_bundle_marker(metadata).ok()
}

fn account_move_parent_bundle_marker(metadata: Option<&str>) -> Option<AccountMoveBundleMarker> {
    let marker = account_move_bundle_marker(metadata)?;
    marker.fingerprint.as_ref()?;
    Some(marker)
}

pub(crate) fn account_move_bundle_token(metadata: Option<&str>) -> Option<String> {
    account_move_bundle_marker(metadata).map(|marker| marker.token)
}

pub(crate) fn account_move_bundle_fingerprint(metadata: Option<&str>) -> Option<String> {
    account_move_parent_bundle_marker(metadata).and_then(|marker| marker.fingerprint)
}

fn rollback_parent_job_for_bundle(
    ctx: &ReducerContext,
    organization_id: u64,
    importer: spacetimedb::Identity,
    token: &str,
    parent_ids: &BTreeSet<u64>,
) -> Option<ImportJob> {
    let mut matches = ctx
        .db
        .import_job()
        .import_job_by_org()
        .filter(&organization_id)
        .filter(|job| {
            job.table_name == "account_move"
                && job.status == "success"
                && job.create_uid == importer
                && account_move_bundle_job_metadata(job.metadata.as_deref())
                    .is_some_and(|marker| marker.role == "parent" && marker.token == token)
        })
        .filter(|job| {
            let recorded: BTreeSet<u64> = ctx
                .db
                .import_job_record()
                .import_record_by_job()
                .filter(&job.id)
                .filter(|record| {
                    record.organization_id == organization_id && record.table_name == "account_move"
                })
                .map(|record| record.record_id)
                .collect();
            recorded == *parent_ids
        });
    let job = matches.next()?;
    if matches.next().is_some() {
        return None;
    }
    Some(job)
}

fn account_move_parent_marker_matches(
    metadata: Option<&str>,
    token: &str,
    fingerprint: &str,
) -> bool {
    account_move_parent_bundle_marker(metadata).is_some_and(|marker| {
        marker.token == token && marker.fingerprint.as_deref() == Some(fingerprint)
    })
}

fn consume_account_move_bundle_marker(metadata: Option<&str>) -> Result<Option<String>, String> {
    let marker = parse_account_move_bundle_marker(metadata)?;
    let mut value: serde_json::Value =
        serde_json::from_str(metadata.ok_or("account move bundle metadata is missing")?)
            .map_err(|_| "account move bundle metadata must be valid JSON")?;
    let root = value
        .as_object_mut()
        .ok_or("account move bundle metadata must be a JSON object")?;
    if marker.original_extra_present {
        root.insert("extra".to_string(), marker.original_extra);
    } else {
        root.remove("extra");
    }
    if root.is_empty() {
        Ok(None)
    } else {
        Ok(Some(value.to_string()))
    }
}

fn marker_owned_empty_draft(
    ctx: &ReducerContext,
    move_row: &AccountMove,
    organization_id: u64,
    company_id: u64,
    token: &str,
    fingerprint: &str,
) -> bool {
    marker_owned_bundle_draft(
        ctx,
        move_row,
        organization_id,
        company_id,
        token,
        fingerprint,
    ) && ctx
        .db
        .account_move_line()
        .move_line_by_move()
        .filter(&move_row.id)
        .next()
        .is_none()
}

fn marker_owned_bundle_draft(
    ctx: &ReducerContext,
    move_row: &AccountMove,
    organization_id: u64,
    company_id: u64,
    token: &str,
    fingerprint: &str,
) -> bool {
    move_row.organization_id == organization_id
        && move_row.company_id == company_id
        && move_row.state == AccountMoveState::Draft
        && move_row.create_uid == Some(ctx.sender())
        && account_move_parent_marker_matches(move_row.metadata.as_deref(), token, fingerprint)
}

struct StagedMoveLine<T> {
    row_number: u32,
    debit: f64,
    credit: f64,
    value: T,
}

struct MoveLineImportPlan<T> {
    groups: BTreeMap<u64, Vec<StagedMoveLine<T>>>,
    invalid_move_ids: BTreeSet<u64>,
}

impl<T> Default for MoveLineImportPlan<T> {
    fn default() -> Self {
        Self {
            groups: BTreeMap::new(),
            invalid_move_ids: BTreeSet::new(),
        }
    }
}

impl<T> MoveLineImportPlan<T> {
    fn stage(&mut self, move_id: u64, row_number: u32, debit: f64, credit: f64, value: T) {
        self.groups
            .entry(move_id)
            .or_default()
            .push(StagedMoveLine {
                row_number,
                debit,
                credit,
                value,
            });
    }

    fn invalidate_move(&mut self, move_id: u64) {
        self.invalid_move_ids.insert(move_id);
    }
}

fn resulting_move_totals<T>(
    existing_debit: f64,
    existing_credit: f64,
    imported_lines: &[StagedMoveLine<T>],
) -> (f64, f64) {
    imported_lines.iter().fold(
        (existing_debit, existing_credit),
        |(total_debit, total_credit), line| (total_debit + line.debit, total_credit + line.credit),
    )
}

fn move_totals_are_balanced(total_debit: f64, total_credit: f64) -> bool {
    (total_debit - total_credit).abs() <= MOVE_BALANCE_TOLERANCE
}

fn is_historical_residual_line(amount_residual: f64) -> bool {
    amount_residual.is_finite() && amount_residual != 0.0
}

fn validate_historical_document_group(
    parent_move: &AccountMove,
    existing_lines: &[AccountMoveLine],
    staged_lines: &[StagedMoveLine<AccountMoveLine>],
) -> Result<(), String> {
    if !existing_lines.is_empty() {
        return Err("historical document retry requires an empty draft move".to_string());
    }
    let counterpart_lines: Vec<_> = staged_lines
        .iter()
        .filter(|line| {
            matches!(
                line.value.account_internal_type.as_deref(),
                Some("Receivable" | "receivable" | "Payable" | "payable")
            )
        })
        .collect();
    if counterpart_lines.len() != 1 {
        return Err(
            "historical document requires exactly one receivable or payable counterpart line"
                .to_string(),
        );
    }
    let residual_lines: Vec<_> = staged_lines
        .iter()
        .filter(|line| is_historical_residual_line(line.value.amount_residual))
        .collect();
    if residual_lines.len() != 1 || residual_lines[0].row_number != counterpart_lines[0].row_number
    {
        return Err(
            "historical document requires opening_residual on exactly its AR/AP counterpart line"
                .to_string(),
        );
    }
    let debit: f64 = staged_lines.iter().map(|line| line.debit).sum();
    let credit: f64 = staged_lines.iter().map(|line| line.credit).sum();
    let historical_tolerance = match historical_document_marker(parent_move.metadata.as_deref()) {
        Ok(Some(HistoricalDocumentMarker {
            mode: HistoricalDocumentMode::OriginalTotal,
            ..
        })) => HISTORICAL_REPLAY_EPSILON,
        _ => MOVE_BALANCE_TOLERANCE,
    };
    if (debit - parent_move.amount_total).abs() > historical_tolerance
        || (credit - parent_move.amount_total).abs() > historical_tolerance
    {
        return Err(
            "historical document amount_total must equal both balanced line totals".to_string(),
        );
    }
    Ok(())
}

fn integer_or_zero(
    headers: &[String],
    row: &[String],
    field: &'static str,
) -> Result<u32, ImportFieldError> {
    let raw = col(headers, row, field);
    if raw.is_empty() {
        return Ok(0);
    }
    raw.parse::<u32>()
        .map_err(|_| ImportFieldError::new(field, raw, "must be a non-negative integer"))
}

fn required_date(
    headers: &[String],
    row: &[String],
    field: &'static str,
) -> Result<spacetimedb::Timestamp, ImportFieldError> {
    let raw = col(headers, row, field);
    parse_import_timestamp(raw)
        .map_err(|message| ImportFieldError::new(field, raw, message))?
        .ok_or_else(|| ImportFieldError::new(field, raw, format!("{field} is required")))
}

fn optional_date(
    headers: &[String],
    row: &[String],
    field: &'static str,
) -> Result<Option<spacetimedb::Timestamp>, ImportFieldError> {
    let raw = col(headers, row, field);
    parse_import_timestamp(raw).map_err(|message| ImportFieldError::new(field, raw, message))
}

fn relation_result(
    field: &'static str,
    raw_value: &str,
    result: Result<(), String>,
) -> Result<(), ImportFieldError> {
    result.map_err(|message| ImportFieldError::new(field, raw_value, message))
}

fn validate_currency(
    ctx: &ReducerContext,
    organization_id: u64,
    currency_id: Option<u64>,
) -> Result<(), String> {
    let Some(currency_id) = currency_id else {
        return Ok(());
    };
    require_active_currency_for_organization(ctx, organization_id, currency_id).map(|_| ())
}

fn internal_type_from_account_type(
    type_name: &str,
    internal_group: &AccountInternalGroup,
) -> AccountTypeInternal {
    match type_name.trim().to_ascii_lowercase().as_str() {
        "receivable" => AccountTypeInternal::Receivable,
        "payable" => AccountTypeInternal::Payable,
        "liquidity" => AccountTypeInternal::Liquidity,
        "asset" => AccountTypeInternal::Asset,
        "liability" => AccountTypeInternal::Liability,
        "equity" => AccountTypeInternal::Equity,
        "income" => AccountTypeInternal::Income,
        "expense" => AccountTypeInternal::Expense,
        _ => match internal_group {
            AccountInternalGroup::Asset => AccountTypeInternal::Asset,
            AccountInternalGroup::Liability => AccountTypeInternal::Liability,
            AccountInternalGroup::Equity => AccountTypeInternal::Equity,
            AccountInternalGroup::Income => AccountTypeInternal::Income,
            AccountInternalGroup::Expense => AccountTypeInternal::Expense,
            AccountInternalGroup::Other => AccountTypeInternal::Other,
        },
    }
}

fn account_classification(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    account_type_id: u64,
    raw_value: &str,
) -> Result<(AccountTypeInternal, AccountInternalGroup), ImportFieldError> {
    let account_type = ctx
        .db
        .account_account_type()
        .id()
        .find(&account_type_id)
        .ok_or_else(|| {
            ImportFieldError::new("user_type_id", raw_value, "Account type not found")
        })?;
    if account_type.organization_id != organization_id
        || account_type.company_id.is_some_and(|id| id != company_id)
    {
        return Err(ImportFieldError::new(
            "user_type_id",
            raw_value,
            "Account type does not belong to this organization and company",
        ));
    }
    if account_type.is_deprecated {
        return Err(ImportFieldError::new(
            "user_type_id",
            raw_value,
            "Account type is deprecated",
        ));
    }

    let internal_type =
        internal_type_from_account_type(&account_type.type_, &account_type.internal_group);
    Ok((internal_type, account_type.internal_group))
}

fn validate_account_group(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    group_id: Option<u64>,
) -> Result<(), String> {
    let Some(group_id) = group_id else {
        return Ok(());
    };
    let group = ctx
        .db
        .account_group()
        .id()
        .find(&group_id)
        .ok_or_else(|| "Account group not found".to_string())?;
    if group.organization_id != organization_id || group.company_id != company_id {
        return Err("Account group does not belong to this organization and company".to_string());
    }
    Ok(())
}

fn validate_payment_term(
    ctx: &ReducerContext,
    organization_id: u64,
    payment_term_id: Option<u64>,
) -> Result<(), String> {
    let Some(payment_term_id) = payment_term_id else {
        return Ok(());
    };
    let payment_term = ctx
        .db
        .account_payment_term()
        .id()
        .find(&payment_term_id)
        .ok_or_else(|| "Payment term not found".to_string())?;
    if payment_term.organization_id != organization_id {
        return Err("Payment term does not belong to this organization".to_string());
    }
    if !payment_term.is_active {
        return Err("Payment term is inactive".to_string());
    }
    Ok(())
}

fn validate_tax_group(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    tax_group_id: Option<u64>,
) -> Result<(), String> {
    let Some(tax_group_id) = tax_group_id else {
        return Ok(());
    };
    let group = ctx
        .db
        .account_tax_group()
        .id()
        .find(&tax_group_id)
        .ok_or_else(|| "Tax group not found".to_string())?;
    if group.organization_id != organization_id || group.company_id != company_id {
        return Err("Tax group does not belong to this organization and company".to_string());
    }
    Ok(())
}

fn validate_project(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    project_id: Option<u64>,
) -> Result<(), String> {
    let Some(project_id) = project_id else {
        return Ok(());
    };
    let project = ctx
        .db
        .project_project()
        .id()
        .find(&project_id)
        .ok_or_else(|| "Project not found".to_string())?;
    if project.organization_id != organization_id || project.company_id != company_id {
        return Err("Project does not belong to this organization and company".to_string());
    }
    if !project.active {
        return Err("Project is inactive".to_string());
    }
    Ok(())
}

fn validate_product_uom_compatibility(
    ctx: &ReducerContext,
    organization_id: u64,
    product_id: Option<u64>,
    product_uom_id: Option<u64>,
) -> Result<(), String> {
    if let (Some(product_id), Some(product_uom_id)) = (product_id, product_uom_id) {
        let product = ctx
            .db
            .product()
            .id()
            .find(&product_id)
            .ok_or_else(|| format!("product {product_id} not found"))?;
        let product_uom = require_uom_in_org(ctx, organization_id, product.uom_id, "product")?;
        let selected_uom = require_uom_in_org(ctx, organization_id, product_uom_id, "import")?;
        require_uom_compatible(&product_uom, &selected_uom, "import")?;
    }
    Ok(())
}

fn validate_analytic_parent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    parent_id: Option<u64>,
) -> Result<(), String> {
    let Some(parent_id) = parent_id else {
        return Ok(());
    };
    let parent = ctx
        .db
        .account_analytic_account()
        .id()
        .find(&parent_id)
        .ok_or_else(|| "Parent analytic account not found".to_string())?;
    if parent.organization_id != organization_id || parent.company_id != company_id {
        return Err(
            "Parent analytic account does not belong to this organization and company".to_string(),
        );
    }
    if !parent.active {
        return Err("Parent analytic account is inactive".to_string());
    }
    Ok(())
}

fn company_currency_id(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
) -> Result<u64, String> {
    let company = ctx
        .db
        .company()
        .id()
        .find(&company_id)
        .ok_or_else(|| format!("company_id {company_id} was not found"))?;
    if company.organization_id != organization_id {
        return Err(format!(
            "company_id {company_id} is outside organization {organization_id}"
        ));
    }
    if company.currency_id == 0 {
        return Err(format!(
            "company_id {company_id} does not have a valid default currency"
        ));
    }
    require_active_currency_for_organization(ctx, organization_id, company.currency_id)?;
    Ok(company.currency_id)
}

fn move_currency_ids(imported_currency_id: Option<u64>, company_currency_id: u64) -> (u64, u64) {
    (
        imported_currency_id.unwrap_or(company_currency_id),
        company_currency_id,
    )
}

fn line_currency_ids(
    imported_currency_id: Option<u64>,
    parent_transaction_currency_id: u64,
    parent_company_currency_id: u64,
) -> (u64, u64) {
    (
        imported_currency_id.unwrap_or(parent_transaction_currency_id),
        parent_company_currency_id,
    )
}

macro_rules! row_value {
    ($ctx:expr, $job:expr, $row_num:expr, $errors:ident, $result:expr) => {
        match $result {
            Ok(value) => value,
            Err(error) => {
                record_import_error(
                    $ctx,
                    $job.id,
                    $row_num,
                    Some(error.field),
                    Some(&error.raw_value),
                    &error.message,
                );
                $errors += 1;
                continue;
            }
        }
    };
}

// ── AccountAccount ────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_account_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_account", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "account_account",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let code = col(&headers, row, "code").to_string();
        let name = col(&headers, row, "name").to_string();

        if code.is_empty() || name.is_empty() {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("code"),
                Some(&code),
                "code and name are required",
            );
            errors += 1;
            continue;
        }

        let user_type_id = row_value!(
            ctx,
            job,
            row_num,
            errors,
            required_id(&headers, row, "user_type_id")
        );
        let (internal_type, internal_group) = row_value!(
            ctx,
            job,
            row_num,
            errors,
            account_classification(
                ctx,
                organization_id,
                company_id,
                user_type_id,
                col(&headers, row, "user_type_id"),
            )
        );
        let currency_id = row_value!(
            ctx,
            job,
            row_num,
            errors,
            optional_id(&headers, row, "currency_id")
        );
        row_value!(
            ctx,
            job,
            row_num,
            errors,
            relation_result(
                "currency_id",
                col(&headers, row, "currency_id"),
                validate_currency(ctx, organization_id, currency_id),
            )
        );
        let group_id = row_value!(
            ctx,
            job,
            row_num,
            errors,
            optional_id(&headers, row, "group_id")
        );
        row_value!(
            ctx,
            job,
            row_num,
            errors,
            relation_result(
                "group_id",
                col(&headers, row, "group_id"),
                validate_account_group(ctx, organization_id, company_id, group_id),
            )
        );
        let tax_ids = row_value!(ctx, job, row_num, errors, id_list(&headers, row, "tax_ids"));
        row_value!(
            ctx,
            job,
            row_num,
            errors,
            relation_result(
                "tax_ids",
                col(&headers, row, "tax_ids"),
                require_active_tax_ids(ctx, organization_id, company_id, &tax_ids),
            )
        );
        let opening_debit = row_value!(
            ctx,
            job,
            row_num,
            errors,
            number_or_zero(&headers, row, "opening_debit")
        );
        let opening_credit = row_value!(
            ctx,
            job,
            row_num,
            errors,
            number_or_zero(&headers, row, "opening_credit")
        );
        let opening_balance = row_value!(
            ctx,
            job,
            row_num,
            errors,
            normalized_opening_balance(
                opening_debit,
                opening_credit,
                col(&headers, row, "opening_debit"),
                col(&headers, row, "opening_credit"),
                col(&headers, row, "opening_balance"),
            )
        );

        ctx.db.account_account().insert(AccountAccount {
            id: 0,
            organization_id,
            code,
            name,
            deprecated: false,
            used: false,
            user_type_id,
            company_id,
            currency_id,
            internal_type: Some(internal_type.clone()),
            internal_group: Some(internal_group),
            is_off_balance: parse_bool(col(&headers, row, "is_off_balance")),
            last_time_entries_checked: None,
            group_id,
            root_id: None,
            allowed_journal_ids: vec![],
            non_trade: false,
            is_bank_account: parse_bool(col(&headers, row, "is_bank_account"))
                || internal_type == AccountTypeInternal::Liquidity,
            reconcile: parse_bool(col(&headers, row, "reconcile")),
            tax_ids,
            note: opt_str(col(&headers, row, "note")),
            opening_debit,
            opening_credit,
            opening_balance,
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import account_account: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── AccountTax ────────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_tax_rate_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_tax", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(ctx, organization_id, "account_tax", None, rows.len() as u32);
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        let type_tax_use = match col(&headers, row, "type_tax_use") {
            "purchase" => TaxTypeUse::Purchase,
            "withholding" | "wht" => TaxTypeUse::Withholding,
            "none" => TaxTypeUse::None,
            _ => TaxTypeUse::Sale,
        };

        let amount_type = match col(&headers, row, "amount_type") {
            "fixed" => TaxAmountType::Fixed,
            "division" => TaxAmountType::Division,
            "code" => TaxAmountType::PythonCode,
            _ => TaxAmountType::Percent,
        };
        let amount = row_value!(
            ctx,
            job,
            row_num,
            errors,
            number_or_zero(&headers, row, "amount")
        );
        let sequence = row_value!(
            ctx,
            job,
            row_num,
            errors,
            integer_or_zero(&headers, row, "sequence")
        );
        let tax_group_id = row_value!(
            ctx,
            job,
            row_num,
            errors,
            optional_id(&headers, row, "tax_group_id")
        );
        row_value!(
            ctx,
            job,
            row_num,
            errors,
            relation_result(
                "tax_group_id",
                col(&headers, row, "tax_group_id"),
                validate_tax_group(ctx, organization_id, company_id, tax_group_id),
            )
        );
        let country_id = row_value!(
            ctx,
            job,
            row_num,
            errors,
            optional_id(&headers, row, "country_id")
        );

        ctx.db.account_tax().insert(AccountTax {
            id: 0,
            organization_id,
            name,
            description: opt_str(col(&headers, row, "description")),
            type_tax_use,
            amount_type,
            amount,
            active: true,
            price_include: parse_bool(col(&headers, row, "price_include")),
            include_base_amount: parse_bool(col(&headers, row, "include_base_amount")),
            is_base_affected: true,
            sequence,
            company_id,
            tax_group_id,
            country_id,
            country_code: opt_str(col(&headers, row, "country_code")),
            tags: vec![],
            has_negative_factor: false,
            invoice_repartition_line_ids: vec![],
            refund_repartition_line_ids: vec![],
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import account_tax: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── AccountMove ───────────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_account_move_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move", "create")?;
    let default_currency_id = company_currency_id(ctx, organization_id, company_id)?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let mut job = begin_import_job(
        ctx,
        organization_id,
        "account_move",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;
    let mut staged_moves: Vec<(u32, AccountMove, Option<AccountMoveBundleMarker>)> = Vec::new();
    let mut saw_bundle_marker = false;
    let mut unmarked_rows = Vec::new();
    let mut bundle_token: Option<String> = None;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let metadata = opt_str(col(&headers, row, "metadata"));
        let marker_present = account_move_bundle_marker_present(metadata.as_deref());
        let bundle_marker = account_move_parent_bundle_marker(metadata.as_deref());
        if marker_present {
            saw_bundle_marker = true;
            let Some(marker) = &bundle_marker else {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("metadata"),
                    None,
                    "account move bundle marker requires version 1, token, and fingerprint",
                );
                errors += 1;
                continue;
            };
            if bundle_token
                .as_ref()
                .is_some_and(|expected| expected != &marker.token)
            {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("metadata"),
                    None,
                    "all account move bundle parent rows must carry the same token",
                );
                errors += 1;
                continue;
            }
            bundle_token.get_or_insert_with(|| marker.token.clone());
        } else {
            unmarked_rows.push(row_num);
        }
        let journal_id = row_value!(
            ctx,
            job,
            row_num,
            errors,
            required_id(&headers, row, "journal_id")
        );
        if let Err(message) =
            require_active_journal(ctx, organization_id, company_id, journal_id, "import")
        {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("journal_id"),
                Some(col(&headers, row, "journal_id")),
                &message,
            );
            errors += 1;
            continue;
        }
        let imported_currency_id = row_value!(
            ctx,
            job,
            row_num,
            errors,
            optional_id(&headers, row, "currency_id")
        );
        let (currency_id, company_currency_id) =
            move_currency_ids(imported_currency_id, default_currency_id);
        row_value!(
            ctx,
            job,
            row_num,
            errors,
            relation_result(
                "currency_id",
                col(&headers, row, "currency_id"),
                validate_currency(ctx, organization_id, Some(currency_id)),
            )
        );

        let move_type = row_value!(
            ctx,
            job,
            row_num,
            errors,
            imported_move_type(col(&headers, row, "move_type"))
        );

        let date = row_value!(
            ctx,
            job,
            row_num,
            errors,
            required_date(&headers, row, "date")
        );
        let invoice_date = row_value!(
            ctx,
            job,
            row_num,
            errors,
            optional_date(&headers, row, "invoice_date")
        );
        let invoice_date_due = row_value!(
            ctx,
            job,
            row_num,
            errors,
            optional_date(&headers, row, "invoice_date_due")
        );
        let invoice_payment_term_id = row_value!(
            ctx,
            job,
            row_num,
            errors,
            optional_id(&headers, row, "invoice_payment_term_id")
        );
        row_value!(
            ctx,
            job,
            row_num,
            errors,
            relation_result(
                "invoice_payment_term_id",
                col(&headers, row, "invoice_payment_term_id"),
                validate_payment_term(ctx, organization_id, invoice_payment_term_id),
            )
        );
        let partner_id = row_value!(
            ctx,
            job,
            row_num,
            errors,
            optional_id(&headers, row, "partner_id")
        );
        row_value!(
            ctx,
            job,
            row_num,
            errors,
            relation_result(
                "partner_id",
                col(&headers, row, "partner_id"),
                partner_id.map_or(Ok(()), |partner_id| {
                    require_contact_in_scope(ctx, organization_id, company_id, partner_id, "import")
                        .map(|_| ())
                }),
            )
        );
        let amount_untaxed = row_value!(
            ctx,
            job,
            row_num,
            errors,
            number_or_zero(&headers, row, "amount_untaxed")
        );
        let amount_tax = row_value!(
            ctx,
            job,
            row_num,
            errors,
            number_or_zero(&headers, row, "amount_tax")
        );
        let amount_total = row_value!(
            ctx,
            job,
            row_num,
            errors,
            number_or_zero(&headers, row, "amount_total")
        );
        let opening_residual = row_value!(
            ctx,
            job,
            row_num,
            errors,
            optional_number(&headers, row, "opening_residual")
        );
        let historical_marker = row_value!(
            ctx,
            job,
            row_num,
            errors,
            historical_document_marker(metadata.as_deref()).map_err(|message| {
                ImportFieldError::new("metadata", col(&headers, row, "metadata"), message)
            })
        );
        if opening_residual.is_some() && bundle_marker.is_none() {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("metadata"),
                None,
                "historical outstanding documents must use the atomic account move bundle",
            );
            errors += 1;
            continue;
        }
        if opening_residual.is_some() {
            let journal = row_value!(
                ctx,
                job,
                row_num,
                errors,
                require_active_journal(ctx, organization_id, company_id, journal_id, "import")
                    .map_err(|message| ImportFieldError::new(
                        "journal_id",
                        col(&headers, row, "journal_id"),
                        message,
                    ))
            );
            let expected_journal_type = match &move_type {
                MoveType::OutInvoice => JournalType::Sale,
                MoveType::InInvoice => JournalType::Purchase,
                _ => journal.type_.clone(),
            };
            if journal.type_ != expected_journal_type {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("journal_id"),
                    Some(col(&headers, row, "journal_id")),
                    "journal type does not match the outstanding document type",
                );
                errors += 1;
                continue;
            }
            if let Some(partner_id) = partner_id {
                let partner = row_value!(
                    ctx,
                    job,
                    row_num,
                    errors,
                    require_contact_in_scope(
                        ctx,
                        organization_id,
                        company_id,
                        partner_id,
                        "import",
                    )
                    .map_err(|message| ImportFieldError::new(
                        "partner_id",
                        col(&headers, row, "partner_id"),
                        message,
                    ))
                );
                let has_role = match &move_type {
                    MoveType::OutInvoice => partner.is_customer,
                    MoveType::InInvoice => partner.is_vendor,
                    _ => true,
                };
                if !has_role {
                    record_import_error(
                        ctx,
                        job.id,
                        row_num,
                        Some("partner_id"),
                        Some(col(&headers, row, "partner_id")),
                        "partner role does not match the outstanding document type",
                    );
                    errors += 1;
                    continue;
                }
            }
        }
        row_value!(
            ctx,
            job,
            row_num,
            errors,
            validate_historical_document_parent(
                &move_type,
                partner_id,
                currency_id,
                company_currency_id,
                date,
                invoice_date,
                invoice_date_due,
                amount_untaxed,
                amount_tax,
                amount_total,
                opening_residual,
                historical_marker.as_ref(),
            )
        );

        staged_moves.push((
            row_num,
            AccountMove {
                id: 0,
                organization_id,
                name: col(&headers, row, "name").to_string(),
                ref_: opt_str(col(&headers, row, "ref_")),
                move_type,
                auto_post: false,
                state: AccountMoveState::Draft,
                date,
                invoice_date,
                invoice_date_due,
                invoice_payment_term_id,
                invoice_origin: opt_str(col(&headers, row, "invoice_origin")),
                invoice_partner_display_name: None,
                invoice_cash_rounding_id: None,
                payment_reference: opt_str(col(&headers, row, "payment_reference")),
                partner_shipping_id: None,
                sale_order_id: None,
                partner_id,
                commercial_partner_id: None,
                partner_bank_id: None,
                fiscal_position_id: None,
                invoice_user_id: Some(ctx.sender()),
                invoice_incoterm_id: None,
                incoterm_location: None,
                campaign_id: None,
                source_id: None,
                medium_id: None,
                company_id,
                journal_id,
                currency_id,
                company_currency_id,
                amount_untaxed,
                amount_tax,
                amount_total,
                amount_residual: opening_residual.unwrap_or(amount_total),
                amount_untaxed_signed: if opening_residual.is_some() {
                    amount_untaxed
                } else {
                    0.0
                },
                amount_tax_signed: if opening_residual.is_some() {
                    amount_tax
                } else {
                    0.0
                },
                amount_total_signed: if opening_residual.is_some() {
                    amount_total
                } else {
                    0.0
                },
                amount_total_in_currency_signed: if opening_residual.is_some() {
                    amount_total
                } else {
                    0.0
                },
                amount_residual_signed: opening_residual.unwrap_or(0.0),
                to_check: false,
                posted_before: false,
                is_storno: false,
                is_move_sent: false,
                secure_sequence_number: None,
                invoice_has_outstanding: false,
                payment_state: PaymentState::NotPaid,
                restrict_mode_hash_table: false,
                create_uid: Some(ctx.sender()),
                create_date: Some(ctx.timestamp),
                write_uid: Some(ctx.sender()),
                write_date: Some(ctx.timestamp),
                metadata,
            },
            bundle_marker,
        ));
    }

    let staged_row_numbers: BTreeSet<u32> = staged_moves
        .iter()
        .map(|(row_number, _, _)| *row_number)
        .collect();
    let mut error_row_numbers: BTreeSet<u32> = (2..(rows.len() as u32 + 2))
        .filter(|row_number| !staged_row_numbers.contains(row_number))
        .collect();

    if saw_bundle_marker {
        for row_num in unmarked_rows {
            if error_row_numbers.insert(row_num) {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("metadata"),
                    None,
                    "every row in an account move bundle must carry the private bundle marker",
                );
                errors += 1;
            }
        }

        let mut reusable_ids = BTreeSet::new();
        let mut staged_refs = BTreeSet::new();
        if errors == 0 {
            for (row_num, move_row, marker) in &staged_moves {
                let raw_ref = move_row.ref_.as_deref().unwrap_or("").trim();
                if raw_ref.is_empty() {
                    if error_row_numbers.insert(*row_num) {
                        record_import_error(
                            ctx,
                            job.id,
                            *row_num,
                            Some("ref_"),
                            None,
                            "ref_ is required for an account move bundle",
                        );
                        errors += 1;
                    }
                    continue;
                }
                if !staged_refs.insert(raw_ref.to_string()) {
                    if error_row_numbers.insert(*row_num) {
                        record_import_error(
                            ctx,
                            job.id,
                            *row_num,
                            Some("ref_"),
                            Some(raw_ref),
                            "ref_ occurs more than once in the account move bundle",
                        );
                        errors += 1;
                    }
                    continue;
                }

                let matching: Vec<_> = ctx
                    .db
                    .account_move()
                    .account_move_by_org()
                    .filter(&organization_id)
                    .filter(|existing| {
                        existing.company_id == company_id
                            && existing.ref_.as_deref().map(str::trim) == Some(raw_ref)
                    })
                    .collect();
                let reusable: Vec<_> = matching
                    .iter()
                    .filter(|existing| {
                        marker.as_ref().is_some_and(|marker| {
                            marker_owned_empty_draft(
                                ctx,
                                existing,
                                organization_id,
                                company_id,
                                &marker.token,
                                marker.fingerprint.as_deref().unwrap_or_default(),
                            )
                        })
                    })
                    .collect();
                if matching.is_empty() {
                    continue;
                }
                if matching.len() == 1 && reusable.len() == 1 {
                    reusable_ids.insert(reusable[0].id);
                    continue;
                }
                if error_row_numbers.insert(*row_num) {
                    record_import_error(
                        ctx,
                        job.id,
                        *row_num,
                        Some("ref_"),
                        Some(raw_ref),
                        "ref_ already belongs to an accounting move; only an exact interrupted bundle draft can be reused",
                    );
                    errors += 1;
                }
            }
        }

        if errors == 0 {
            imported = staged_moves.len() as u32;
            for (row_number, move_row, marker) in staged_moves {
                let is_reused = ctx
                    .db
                    .account_move()
                    .account_move_by_org()
                    .filter(&organization_id)
                    .any(|existing| {
                        reusable_ids.contains(&existing.id)
                            && existing.ref_.as_deref().map(str::trim)
                                == move_row.ref_.as_deref().map(str::trim)
                            && marker.as_ref().is_some_and(|marker| {
                                marker_owned_empty_draft(
                                    ctx,
                                    &existing,
                                    organization_id,
                                    company_id,
                                    &marker.token,
                                    marker.fingerprint.as_deref().unwrap_or_default(),
                                )
                            })
                    });
                if !is_reused {
                    let created = ctx.db.account_move().insert(move_row);
                    record_import_created_id(ctx, job.id, "account_move", created.id, row_number);
                }
            }
        } else {
            for row_number in 2..(rows.len() as u32 + 2) {
                if error_row_numbers.insert(row_number) {
                    record_import_error(
                        ctx,
                        job.id,
                        row_number,
                        None,
                        None,
                        "row was withheld because another row in the account move bundle is invalid",
                    );
                    errors += 1;
                }
            }
        }
    } else {
        imported = staged_moves.len() as u32;
        for (_, move_row, _) in staged_moves {
            ctx.db.account_move().insert(move_row);
        }
    }

    if saw_bundle_marker && errors == 0 {
        let token = bundle_token
            .as_deref()
            .ok_or("validated account move bundle token is missing")?;
        job = stamp_account_move_bundle_job(job, "parent", token, None)?;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import account_move: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── AccountMoveLine ───────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_account_move_line_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_move_line", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let mut job = begin_import_job(
        ctx,
        organization_id,
        "account_move_line",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;
    let mut plan = MoveLineImportPlan::default();
    let mut bundle_parent_ids = BTreeSet::new();
    let mut non_bundle_parent_rows = Vec::new();
    let mut bundle_token: Option<String> = None;
    let mut bundle_request_seen = false;
    let mut error_row_numbers = BTreeSet::new();

    macro_rules! staged_row_value {
        ($row_num:expr, $move_id:expr, $result:expr) => {
            match $result {
                Ok(value) => value,
                Err(error) => {
                    record_import_error(
                        ctx,
                        job.id,
                        $row_num,
                        Some(error.field),
                        Some(&error.raw_value),
                        &error.message,
                    );
                    error_row_numbers.insert($row_num);
                    errors += 1;
                    plan.invalidate_move($move_id);
                    continue;
                }
            }
        };
    }

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let row_metadata = opt_str(col(&headers, row, "metadata"));
        let marker_present = account_move_bundle_marker_present(row_metadata.as_deref());
        let row_bundle_token = account_move_bundle_token(row_metadata.as_deref());
        if marker_present && row_bundle_token.is_none() {
            bundle_request_seen = true;
            let message = parse_account_move_bundle_marker(row_metadata.as_deref())
                .err()
                .unwrap_or_else(|| "account move bundle marker is invalid".to_string());
            record_import_error(ctx, job.id, row_num, Some("metadata"), None, &message);
            error_row_numbers.insert(row_num);
            errors += 1;
            continue;
        }
        if let Some(token) = &row_bundle_token {
            bundle_request_seen = true;
            if bundle_token
                .as_ref()
                .is_some_and(|expected| expected != token)
            {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("metadata"),
                    None,
                    "all rows in an account move bundle must carry the same request token",
                );
                error_row_numbers.insert(row_num);
                errors += 1;
                continue;
            }
            bundle_token.get_or_insert_with(|| token.clone());
        }
        let move_id = match required_id(&headers, row, "move_id") {
            Ok(move_id) => move_id,
            Err(error) => {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some(error.field),
                    Some(&error.raw_value),
                    &error.message,
                );
                error_row_numbers.insert(row_num);
                errors += 1;
                continue;
            }
        };
        if row_bundle_token.is_none() {
            non_bundle_parent_rows.push((row_num, move_id));
        }
        if row_bundle_token.is_some() {
            if let Some(parent_move) = ctx.db.account_move().id().find(&move_id) {
                let parent_token = account_move_bundle_token(parent_move.metadata.as_deref());
                let fingerprint = account_move_bundle_fingerprint(parent_move.metadata.as_deref());
                if parent_token == row_bundle_token
                    && fingerprint.as_deref().is_some_and(|fingerprint| {
                        marker_owned_bundle_draft(
                            ctx,
                            &parent_move,
                            organization_id,
                            company_id,
                            row_bundle_token.as_deref().unwrap_or_default(),
                            fingerprint,
                        )
                    })
                {
                    bundle_parent_ids.insert(move_id);
                } else {
                    record_import_error(
                        ctx,
                        job.id,
                        row_num,
                        Some("move_id"),
                        Some(&move_id.to_string()),
                        "move_id is not owned by this account move bundle request",
                    );
                    error_row_numbers.insert(row_num);
                    errors += 1;
                    plan.invalidate_move(move_id);
                    continue;
                }
            }
        }
        let account_id =
            staged_row_value!(row_num, move_id, required_id(&headers, row, "account_id"));
        let account =
            match require_active_account(ctx, organization_id, company_id, account_id, "import") {
                Ok(account) => account,
                Err(message) => {
                    record_import_error(
                        ctx,
                        job.id,
                        row_num,
                        Some("account_id"),
                        Some(col(&headers, row, "account_id")),
                        &message,
                    );
                    error_row_numbers.insert(row_num);
                    errors += 1;
                    plan.invalidate_move(move_id);
                    continue;
                }
            };

        let Some(parent_move) = ctx.db.account_move().id().find(&move_id) else {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("move_id"),
                Some(col(&headers, row, "move_id")),
                "move_id does not reference an existing accounting move",
            );
            error_row_numbers.insert(row_num);
            errors += 1;
            plan.invalidate_move(move_id);
            continue;
        };
        if parent_move.organization_id != organization_id || parent_move.company_id != company_id {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("move_id"),
                Some(col(&headers, row, "move_id")),
                "move_id is outside the import organization or company",
            );
            error_row_numbers.insert(row_num);
            errors += 1;
            plan.invalidate_move(move_id);
            continue;
        }
        if parent_move.state != AccountMoveState::Draft {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("move_id"),
                Some(col(&headers, row, "move_id")),
                "move_id must reference a draft accounting move",
            );
            error_row_numbers.insert(row_num);
            errors += 1;
            plan.invalidate_move(move_id);
            continue;
        }

        let journal_id = parent_move.journal_id;
        let imported_currency_id =
            staged_row_value!(row_num, move_id, optional_id(&headers, row, "currency_id"));
        let (currency_id, company_currency_id) = line_currency_ids(
            imported_currency_id,
            parent_move.currency_id,
            parent_move.company_currency_id,
        );
        staged_row_value!(
            row_num,
            move_id,
            relation_result(
                "currency_id",
                col(&headers, row, "currency_id"),
                validate_currency(ctx, organization_id, Some(currency_id)).and_then(|_| {
                    validate_currency(ctx, organization_id, Some(company_currency_id))
                }),
            )
        );
        let debit = staged_row_value!(row_num, move_id, number_or_zero(&headers, row, "debit"));
        let credit = staged_row_value!(row_num, move_id, number_or_zero(&headers, row, "credit"));
        staged_row_value!(
            row_num,
            move_id,
            validate_imported_debit_credit(debit, credit)
        );
        let date = staged_row_value!(row_num, move_id, required_date(&headers, row, "date"));
        let sequence =
            staged_row_value!(row_num, move_id, integer_or_zero(&headers, row, "sequence"));
        let quantity =
            staged_row_value!(row_num, move_id, number_or_zero(&headers, row, "quantity"));
        let price_unit = staged_row_value!(
            row_num,
            move_id,
            number_or_zero(&headers, row, "price_unit")
        );
        let tax_ids = staged_row_value!(row_num, move_id, id_list(&headers, row, "tax_ids"));
        staged_row_value!(
            row_num,
            move_id,
            relation_result(
                "tax_ids",
                col(&headers, row, "tax_ids"),
                require_active_tax_ids(ctx, organization_id, company_id, &tax_ids),
            )
        );
        let partner_id =
            staged_row_value!(row_num, move_id, optional_id(&headers, row, "partner_id"));
        staged_row_value!(
            row_num,
            move_id,
            relation_result(
                "partner_id",
                col(&headers, row, "partner_id"),
                partner_id.map_or(Ok(()), |partner_id| {
                    require_contact_in_scope(ctx, organization_id, company_id, partner_id, "import")
                        .map(|_| ())
                }),
            )
        );
        let opening_residual = staged_row_value!(
            row_num,
            move_id,
            optional_number(&headers, row, "opening_residual")
        );
        let row_historical_marker = staged_row_value!(
            row_num,
            move_id,
            historical_document_marker(row_metadata.as_deref()).map_err(|message| {
                ImportFieldError::new("metadata", col(&headers, row, "metadata"), message)
            })
        );
        let parent_historical_marker = staged_row_value!(
            row_num,
            move_id,
            historical_document_marker(parent_move.metadata.as_deref()).map_err(|message| {
                ImportFieldError::new("metadata", col(&headers, row, "metadata"), message)
            })
        );
        if row_historical_marker != parent_historical_marker {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("metadata"),
                None,
                "historical document line metadata does not match its parent",
            );
            error_row_numbers.insert(row_num);
            errors += 1;
            plan.invalidate_move(move_id);
            continue;
        }
        if parent_historical_marker.is_some() && row_bundle_token.is_none() {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("metadata"),
                None,
                "historical outstanding documents must use the atomic account move bundle",
            );
            error_row_numbers.insert(row_num);
            errors += 1;
            plan.invalidate_move(move_id);
            continue;
        }
        if parent_historical_marker.is_some() {
            staged_row_value!(
                row_num,
                move_id,
                validate_historical_line_scope(
                    &parent_move,
                    &account,
                    partner_id,
                    currency_id,
                    company_currency_id,
                    date,
                )
            );
        }
        if let Some(opening_residual) = opening_residual {
            let Some(historical_marker) = parent_historical_marker.as_ref() else {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("metadata"),
                    None,
                    "opening_residual requires historical-document audit metadata",
                );
                error_row_numbers.insert(row_num);
                errors += 1;
                plan.invalidate_move(move_id);
                continue;
            };
            staged_row_value!(
                row_num,
                move_id,
                validate_historical_counterpart_line(
                    &parent_move,
                    &account,
                    partner_id,
                    debit,
                    credit,
                    opening_residual,
                    historical_marker,
                )
            );
        }
        let analytic_account_id = staged_row_value!(
            row_num,
            move_id,
            optional_id(&headers, row, "analytic_account_id")
        );
        staged_row_value!(
            row_num,
            move_id,
            relation_result(
                "analytic_account_id",
                col(&headers, row, "analytic_account_id"),
                require_analytic_account(ctx, organization_id, company_id, analytic_account_id,),
            )
        );
        let product_id =
            staged_row_value!(row_num, move_id, optional_id(&headers, row, "product_id"));
        staged_row_value!(
            row_num,
            move_id,
            relation_result(
                "product_id",
                col(&headers, row, "product_id"),
                product_id.map_or(Ok(()), |product_id| {
                    require_product_in_org(ctx, organization_id, product_id)
                }),
            )
        );
        let product_uom_id = staged_row_value!(
            row_num,
            move_id,
            optional_id(&headers, row, "product_uom_id")
        );
        staged_row_value!(
            row_num,
            move_id,
            relation_result(
                "product_uom_id",
                col(&headers, row, "product_uom_id"),
                product_uom_id.map_or(Ok(()), |product_uom_id| {
                    require_uom_in_org(ctx, organization_id, product_uom_id, "import").map(|_| ())
                }),
            )
        );
        staged_row_value!(
            row_num,
            move_id,
            relation_result(
                "product_uom_id",
                col(&headers, row, "product_uom_id"),
                validate_product_uom_compatibility(
                    ctx,
                    organization_id,
                    product_id,
                    product_uom_id,
                ),
            )
        );
        let cogs_amount = staged_row_value!(
            row_num,
            move_id,
            number_or_zero(&headers, row, "cogs_amount")
        );
        let line_metadata = if row_bundle_token.is_some() {
            match consume_account_move_bundle_marker(
                opt_str(col(&headers, row, "metadata")).as_deref(),
            ) {
                Ok(metadata) => metadata,
                Err(message) => {
                    record_import_error(ctx, job.id, row_num, Some("metadata"), None, &message);
                    error_row_numbers.insert(row_num);
                    errors += 1;
                    plan.invalidate_move(move_id);
                    continue;
                }
            }
        } else {
            opt_str(col(&headers, row, "metadata"))
        };

        let staged_line = AccountMoveLine {
            id: 0,
            organization_id,
            move_id,
            move_name: None,
            date,
            ref_: opt_str(col(&headers, row, "ref_")),
            parent_state: AccountMoveState::Draft,
            journal_id,
            company_id,
            company_currency_id,
            sequence,
            name: col(&headers, row, "name").to_string(),
            quantity,
            price_unit,
            price: price_unit,
            price_subtotal: 0.0,
            price_total: 0.0,
            discount: 0.0,
            balance: debit - credit,
            currency_id,
            amount_currency: 0.0,
            amount_residual: opening_residual.map_or(0.0, |_| debit - credit),
            amount_residual_currency: opening_residual.map_or(0.0, |_| debit - credit),
            debit,
            credit,
            debit_currency: 0.0,
            credit_currency: 0.0,
            tax_base_amount: 0.0,
            account_id,
            account_internal_type: account.internal_type.map(|value| format!("{value:?}")),
            account_internal_group: account.internal_group.map(|value| format!("{value:?}")),
            account_root_id: account.root_id,
            group_tax_id: None,
            tax_line_id: None,
            tax_group_id: None,
            tax_ids,
            tax_repartition_line_id: None,
            tax_audit: None,
            partner_id,
            commercial_partner_id: None,
            reconcile_model_id: None,
            payment_id: None,
            statement_line_id: None,
            currency_id_field: None,
            blocked: false,
            matching_number: None,
            matching_label: None,
            is_matching: false,
            expected_pay_date: opening_residual.and(parent_move.invoice_date_due),
            expected_pay_date_currency_id: opening_residual.map(|_| currency_id),
            expected_pay_date_amount: opening_residual.unwrap_or(0.0),
            expected_pay_date_residual: opening_residual.unwrap_or(0.0),
            display_type: None,
            is_downpayment: false,
            exclude_from_invoice_tab: opening_residual.is_some(),
            analytic_account_id,
            analytic_tag_ids: vec![],
            product_id,
            product_uom_id,
            product_category_id: None,
            cogs_amount,
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: line_metadata,
        };
        plan.stage(move_id, row_num, debit, credit, staged_line);
    }

    let MoveLineImportPlan {
        groups,
        invalid_move_ids,
    } = plan;
    let bundle_mode = bundle_request_seen;
    if bundle_mode {
        for (row_num, move_id) in non_bundle_parent_rows {
            if error_row_numbers.insert(row_num) {
                record_import_error(
                    ctx,
                    job.id,
                    row_num,
                    Some("move_id"),
                    Some(&move_id.to_string()),
                    "an account move bundle cannot mix marked and unmarked rows",
                );
                errors += 1;
            }
        }
    }
    let mut validated_lines = Vec::new();

    for (move_id, staged_lines) in groups {
        let raw_move_id = move_id.to_string();
        if invalid_move_ids.contains(&move_id) {
            for staged in staged_lines {
                if error_row_numbers.insert(staged.row_number) {
                    record_import_error(
                        ctx,
                        job.id,
                        staged.row_number,
                        Some("move_id"),
                        Some(&raw_move_id),
                        "move group was not imported because another row for this move is invalid",
                    );
                    errors += 1;
                }
            }
            continue;
        }

        let existing_lines: Vec<_> = ctx
            .db
            .account_move_line()
            .move_line_by_move()
            .filter(&move_id)
            .collect();
        let Some(first_staged_line) = staged_lines.first() else {
            continue;
        };
        let expected_journal_id = first_staged_line.value.journal_id;
        if existing_lines.iter().any(|line| {
            line.organization_id != organization_id
                || line.company_id != company_id
                || line.journal_id != expected_journal_id
                || line.parent_state != AccountMoveState::Draft
        }) {
            for staged in staged_lines {
                if error_row_numbers.insert(staged.row_number) {
                    record_import_error(
                        ctx,
                        job.id,
                        staged.row_number,
                        Some("move_id"),
                        Some(&raw_move_id),
                        "existing move lines must belong to the same organization, company, and draft journal move",
                    );
                    errors += 1;
                }
            }
            continue;
        }

        let parent_move = ctx
            .db
            .account_move()
            .id()
            .find(&move_id)
            .expect("staged move lines retain their validated parent");
        match historical_document_marker(parent_move.metadata.as_deref()) {
            Err(message) => {
                for staged in staged_lines {
                    if error_row_numbers.insert(staged.row_number) {
                        record_import_error(
                            ctx,
                            job.id,
                            staged.row_number,
                            Some("metadata"),
                            None,
                            &message,
                        );
                        errors += 1;
                    }
                }
                continue;
            }
            Ok(Some(_)) => {
                if let Err(message) =
                    validate_historical_document_group(&parent_move, &existing_lines, &staged_lines)
                {
                    for staged in staged_lines {
                        if error_row_numbers.insert(staged.row_number) {
                            record_import_error(
                                ctx,
                                job.id,
                                staged.row_number,
                                Some("move_id"),
                                Some(&raw_move_id),
                                &message,
                            );
                            errors += 1;
                        }
                    }
                    continue;
                }
            }
            Ok(None) => {}
        }

        let existing_debit: f64 = existing_lines.iter().map(|line| line.debit).sum();
        let existing_credit: f64 = existing_lines.iter().map(|line| line.credit).sum();
        let (total_debit, total_credit) =
            resulting_move_totals(existing_debit, existing_credit, &staged_lines);
        if !move_totals_are_balanced(total_debit, total_credit) {
            let message = format!(
                "move is unbalanced after import: debit={total_debit}, credit={total_credit}"
            );
            for staged in staged_lines {
                if error_row_numbers.insert(staged.row_number) {
                    record_import_error(
                        ctx,
                        job.id,
                        staged.row_number,
                        Some("move_id"),
                        Some(&raw_move_id),
                        &message,
                    );
                    errors += 1;
                }
            }
            continue;
        }

        validated_lines.extend(staged_lines);
    }

    if bundle_mode && errors > 0 {
        for row_number in 2..(rows.len() as u32 + 2) {
            if error_row_numbers.insert(row_number) {
                record_import_error(
                    ctx,
                    job.id,
                    row_number,
                    None,
                    None,
                    "row was withheld because another row in the account move bundle is invalid",
                );
                errors += 1;
            }
        }
        let may_delete_parents =
            check_permission(ctx, organization_id, "account_move", "delete").is_ok();
        for move_id in &bundle_parent_ids {
            if !may_delete_parents {
                break;
            }
            let Some(parent_move) = ctx.db.account_move().id().find(move_id) else {
                continue;
            };
            let Some(fingerprint) =
                account_move_bundle_fingerprint(parent_move.metadata.as_deref())
            else {
                continue;
            };
            let Some(token) = account_move_bundle_token(parent_move.metadata.as_deref()) else {
                continue;
            };
            if marker_owned_empty_draft(
                ctx,
                &parent_move,
                organization_id,
                company_id,
                &token,
                &fingerprint,
            ) {
                ctx.db.account_move().id().delete(move_id);
            }
        }
    } else {
        imported = validated_lines.len() as u32;
        let rollback_parent = bundle_token.as_deref().and_then(|token| {
            rollback_parent_job_for_bundle(
                ctx,
                organization_id,
                ctx.sender(),
                token,
                &bundle_parent_ids,
            )
        });
        for staged in validated_lines {
            let created = ctx.db.account_move_line().insert(staged.value);
            if bundle_mode {
                record_import_created_id(
                    ctx,
                    job.id,
                    "account_move_line",
                    created.id,
                    staged.row_number,
                );
            }
        }
        if bundle_mode {
            for move_id in &bundle_parent_ids {
                if let Some(mut parent_move) = ctx.db.account_move().id().find(move_id) {
                    parent_move.metadata =
                        consume_account_move_bundle_marker(parent_move.metadata.as_deref())?;
                    parent_move.write_uid = Some(ctx.sender());
                    parent_move.write_date = Some(ctx.timestamp);
                    ctx.db.account_move().id().update(parent_move);
                }
            }
            if let (Some(parent_job), Some(token)) = (rollback_parent, bundle_token.as_deref()) {
                job = stamp_account_move_bundle_job(job, "complete", token, Some(parent_job.id))?;
            }
        }
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import account_move_line: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── CrossoveredBudget ─────────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_budget_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "crossovered_budget", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "crossovered_budget",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        let date_from = row_value!(
            ctx,
            job,
            row_num,
            errors,
            required_date(&headers, row, "date_from")
        );
        let date_to = row_value!(
            ctx,
            job,
            row_num,
            errors,
            required_date(&headers, row, "date_to")
        );
        if date_to.to_micros_since_unix_epoch() < date_from.to_micros_since_unix_epoch() {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("date_to"),
                Some(col(&headers, row, "date_to")),
                "date_to must be on or after date_from",
            );
            errors += 1;
            continue;
        }

        ctx.db.crossovered_budget().insert(CrossoveredBudget {
            id: 0,
            organization_id,
            name,
            description: opt_str(col(&headers, row, "description")),
            date_from,
            date_to,
            state: BudgetState::Draft,
            company_id,
            crossovered_budget_line: vec![],
            total_planned: 0.0,
            total_practical: 0.0,
            total_theoretical: 0.0,
            variance_percentage: 0.0,
            create_uid: Some(ctx.sender()),
            create_date: Some(ctx.timestamp),
            write_uid: Some(ctx.sender()),
            write_date: Some(ctx.timestamp),
            metadata: opt_str(col(&headers, row, "metadata")),
        });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import crossovered_budget: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── CrossoveredBudgetLines ────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_budget_line_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "crossovered_budget_lines", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "crossovered_budget_lines",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let general_budget_id = row_value!(
            ctx,
            job,
            row_num,
            errors,
            required_id(&headers, row, "general_budget_id")
        );
        let budget_in_scope = ctx
            .db
            .crossovered_budget()
            .id()
            .find(&general_budget_id)
            .is_some_and(|budget| {
                budget.organization_id == organization_id && budget.company_id == company_id
            });
        if !budget_in_scope {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("general_budget_id"),
                Some(col(&headers, row, "general_budget_id")),
                "general_budget_id does not reference a budget in this organization and company",
            );
            errors += 1;
            continue;
        }
        let date_from = row_value!(
            ctx,
            job,
            row_num,
            errors,
            required_date(&headers, row, "date_from")
        );
        let date_to = row_value!(
            ctx,
            job,
            row_num,
            errors,
            required_date(&headers, row, "date_to")
        );
        if date_to.to_micros_since_unix_epoch() < date_from.to_micros_since_unix_epoch() {
            record_import_error(
                ctx,
                job.id,
                row_num,
                Some("date_to"),
                Some(col(&headers, row, "date_to")),
                "date_to must be on or after date_from",
            );
            errors += 1;
            continue;
        }
        let planned_amount = row_value!(
            ctx,
            job,
            row_num,
            errors,
            number_or_zero(&headers, row, "planned_amount")
        );
        let analytic_account_id = row_value!(
            ctx,
            job,
            row_num,
            errors,
            optional_id(&headers, row, "analytic_account_id")
        );
        row_value!(
            ctx,
            job,
            row_num,
            errors,
            relation_result(
                "analytic_account_id",
                col(&headers, row, "analytic_account_id"),
                require_analytic_account(ctx, organization_id, company_id, analytic_account_id,),
            )
        );
        let project_id = row_value!(
            ctx,
            job,
            row_num,
            errors,
            optional_id(&headers, row, "project_id")
        );
        row_value!(
            ctx,
            job,
            row_num,
            errors,
            relation_result(
                "project_id",
                col(&headers, row, "project_id"),
                validate_project(ctx, organization_id, company_id, project_id),
            )
        );

        ctx.db
            .crossovered_budget_lines()
            .insert(CrossoveredBudgetLines {
                id: 0,
                organization_id,
                general_budget_id,
                analytic_account_id,
                project_id,
                date_from,
                date_to,
                paid_date: None,
                planned_amount,
                practical_amount: 0.0,
                theoretical_amount: 0.0,
                achieve_percentage: 0.0,
                company_id,
                is_above_budget: false,
                variance: 0.0,
                variance_percentage: 0.0,
                create_uid: Some(ctx.sender()),
                create_date: Some(ctx.timestamp),
                write_uid: Some(ctx.sender()),
                write_date: Some(ctx.timestamp),
                metadata: opt_str(col(&headers, row, "metadata")),
            });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import crossovered_budget_lines: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

// ── AccountAnalyticAccount ────────────────────────────────────────────────────

#[spacetimedb::reducer]
pub fn import_analytic_account_csv(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    csv_data: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "account_analytic_account", "create")?;
    let default_currency_id = company_currency_id(ctx, organization_id, company_id)?;
    let (headers, rows) = parse_csv(&csv_data)?;
    let job = begin_import_job(
        ctx,
        organization_id,
        "account_analytic_account",
        None,
        rows.len() as u32,
    );
    let mut imported = 0u32;
    let mut errors = 0u32;

    for (i, row) in rows.iter().enumerate() {
        let row_num = (i + 2) as u32;
        let name = col(&headers, row, "name").to_string();

        if name.is_empty() {
            record_import_error(ctx, job.id, row_num, Some("name"), None, "name is required");
            errors += 1;
            continue;
        }

        let currency_id = row_value!(
            ctx,
            job,
            row_num,
            errors,
            optional_id(&headers, row, "currency_id")
        )
        .unwrap_or(default_currency_id);
        row_value!(
            ctx,
            job,
            row_num,
            errors,
            relation_result(
                "currency_id",
                col(&headers, row, "currency_id"),
                validate_currency(ctx, organization_id, Some(currency_id)),
            )
        );
        let partner_id = row_value!(
            ctx,
            job,
            row_num,
            errors,
            optional_id(&headers, row, "partner_id")
        );
        row_value!(
            ctx,
            job,
            row_num,
            errors,
            relation_result(
                "partner_id",
                col(&headers, row, "partner_id"),
                partner_id.map_or(Ok(()), |partner_id| {
                    require_contact_in_scope(ctx, organization_id, company_id, partner_id, "import")
                        .map(|_| ())
                }),
            )
        );
        let group_id = row_value!(
            ctx,
            job,
            row_num,
            errors,
            optional_id(&headers, row, "group_id")
        );
        let root_plan_id = row_value!(
            ctx,
            job,
            row_num,
            errors,
            optional_id(&headers, row, "root_plan_id")
        );
        let plan_id = row_value!(
            ctx,
            job,
            row_num,
            errors,
            optional_id(&headers, row, "plan_id")
        );
        let parent_id = row_value!(
            ctx,
            job,
            row_num,
            errors,
            optional_id(&headers, row, "parent_id")
        );
        row_value!(
            ctx,
            job,
            row_num,
            errors,
            relation_result(
                "parent_id",
                col(&headers, row, "parent_id"),
                validate_analytic_parent(ctx, organization_id, company_id, parent_id),
            )
        );

        ctx.db
            .account_analytic_account()
            .insert(AccountAnalyticAccount {
                id: 0,
                organization_id,
                name,
                code: opt_str(col(&headers, row, "code")),
                active: true,
                company_id,
                partner_id,
                group_id,
                line_ids: vec![],
                balance: 0.0,
                debit: 0.0,
                credit: 0.0,
                currency_id,
                root_plan_id,
                plan_id,
                root_id: None,
                is_required_in_move_lines: false,
                is_required_in_distribution: false,
                color: None,
                parent_id,
                child_ids: vec![],
                message_follower_ids: vec![],
                activity_ids: vec![],
                message_ids: vec![],
                is_company_root: false,
                is_root_plan: false,
                create_uid: Some(ctx.sender()),
                create_date: Some(ctx.timestamp),
                write_uid: Some(ctx.sender()),
                write_date: Some(ctx.timestamp),
                metadata: opt_str(col(&headers, row, "metadata")),
            });
        imported += 1;
    }

    finish_import_job(ctx, job, imported, errors);
    log::info!(
        "Import account_analytic_account: imported={}, errors={}",
        imported,
        errors
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn foreign_transaction_currency_does_not_replace_company_currency() {
        assert_eq!(move_currency_ids(Some(978), 646), (978, 646));
        assert_eq!(line_currency_ids(Some(840), 978, 646), (840, 646));
    }

    #[test]
    fn missing_transaction_currency_inherits_safe_parent_defaults() {
        assert_eq!(move_currency_ids(None, 646), (646, 646));
        assert_eq!(line_currency_ids(None, 978, 646), (978, 646));
    }

    #[test]
    fn account_type_specializations_override_the_broad_internal_group() {
        assert_eq!(
            internal_type_from_account_type("receivable", &AccountInternalGroup::Asset),
            AccountTypeInternal::Receivable
        );
        assert_eq!(
            internal_type_from_account_type("payable", &AccountInternalGroup::Liability),
            AccountTypeInternal::Payable
        );
        assert_eq!(
            internal_type_from_account_type("liquidity", &AccountInternalGroup::Asset),
            AccountTypeInternal::Liquidity
        );
    }

    #[test]
    fn broad_or_custom_account_types_inherit_the_authoritative_group() {
        assert_eq!(
            internal_type_from_account_type("other", &AccountInternalGroup::Income),
            AccountTypeInternal::Income
        );
        assert_eq!(
            internal_type_from_account_type("localized_custom", &AccountInternalGroup::Expense),
            AccountTypeInternal::Expense
        );
    }

    #[test]
    fn opening_balance_accepts_balance_only_input() {
        assert_eq!(
            normalized_opening_balance(0.0, 0.0, "", "", "125").unwrap(),
            125.0
        );
        assert_eq!(
            normalized_opening_balance(0.0, 0.0, "  ", "", "-25").unwrap(),
            -25.0
        );
    }

    #[test]
    fn opening_balance_derives_from_debit_or_credit_only_input() {
        assert_eq!(
            normalized_opening_balance(125.0, 0.0, "125", "", "").unwrap(),
            125.0
        );
        assert_eq!(
            normalized_opening_balance(0.0, 25.0, "", "25", "").unwrap(),
            -25.0
        );
    }

    #[test]
    fn opening_balance_accepts_consistent_mixed_input() {
        assert_eq!(
            normalized_opening_balance(125.0, 0.0, "125", "", "125").unwrap(),
            125.0
        );
        assert_eq!(
            normalized_opening_balance(0.0, 25.0, "", "25", "-25").unwrap(),
            -25.0
        );
    }

    #[test]
    fn opening_balance_rejects_inconsistent_or_invalid_mixed_input() {
        assert!(normalized_opening_balance(125.0, 0.0, "125", "", "100").is_err());
        assert!(normalized_opening_balance(125.0, 25.0, "125", "25", "100").is_err());
        assert!(normalized_opening_balance(-1.0, 0.0, "-1", "", "-1").is_err());
    }

    #[test]
    fn move_type_import_rejects_unknown_values_instead_of_silently_using_entry() {
        assert_eq!(imported_move_type("").unwrap(), MoveType::Entry);
        assert_eq!(
            imported_move_type("out_invoice").unwrap(),
            MoveType::OutInvoice
        );
        assert!(imported_move_type("customer bill").is_err());
    }

    #[test]
    fn imported_journal_lines_require_exactly_one_positive_side() {
        assert!(validate_imported_debit_credit(100.0, 0.0).is_ok());
        assert!(validate_imported_debit_credit(0.0, 100.0).is_ok());
        assert!(validate_imported_debit_credit(100.0, 100.0).is_err());
        assert!(validate_imported_debit_credit(0.0, 0.0).is_err());
        assert!(validate_imported_debit_credit(-1.0, 0.0).is_err());
    }

    #[test]
    fn historical_residual_detection_keeps_small_receivables_and_payables() {
        assert!(is_historical_residual_line(0.01));
        assert!(is_historical_residual_line(-0.01));
        assert!(is_historical_residual_line(f64::MIN_POSITIVE));
        assert!(is_historical_residual_line(-f64::MIN_POSITIVE));
        assert!(!is_historical_residual_line(0.0));
        assert!(!is_historical_residual_line(-0.0));
        assert!(!is_historical_residual_line(f64::NAN));
    }

    #[test]
    fn historical_document_modes_book_the_expected_ledger_total() {
        let marker = HistoricalDocumentMarker {
            mode: HistoricalDocumentMode::CutoverOpenResidual,
            source_total: 150.0,
            source_paid_to_date: 60.0,
            expected_open_residual: 90.0,
        };
        let invoice_date = spacetimedb::Timestamp::from_micros_since_unix_epoch(100);
        let due_date = spacetimedb::Timestamp::from_micros_since_unix_epoch(200);
        assert!(validate_historical_document_parent(
            &MoveType::OutInvoice,
            Some(7),
            1,
            1,
            due_date,
            Some(invoice_date),
            Some(due_date),
            90.0,
            0.0,
            90.0,
            Some(90.0),
            Some(&marker),
        )
        .is_ok());
        assert!(validate_historical_document_parent(
            &MoveType::OutInvoice,
            Some(7),
            2,
            1,
            due_date,
            Some(invoice_date),
            Some(due_date),
            90.0,
            0.0,
            90.0,
            Some(90.0),
            Some(&marker),
        )
        .is_err());
        assert!(validate_historical_document_parent(
            &MoveType::OutInvoice,
            Some(7),
            1,
            1,
            due_date,
            Some(invoice_date),
            Some(due_date),
            90.0,
            0.0,
            150.0,
            Some(90.0),
            Some(&marker),
        )
        .is_err());

        let rounded_cutover_marker = HistoricalDocumentMarker {
            mode: HistoricalDocumentMode::CutoverOpenResidual,
            source_total: 100.0,
            source_paid_to_date: 33.334,
            expected_open_residual: 66.667,
        };
        assert!(validate_historical_document_parent(
            &MoveType::OutInvoice,
            Some(7),
            1,
            1,
            due_date,
            Some(invoice_date),
            Some(due_date),
            66.667,
            0.0,
            66.667,
            Some(66.667),
            Some(&rounded_cutover_marker),
        )
        .is_ok());
        let rounded_original_marker = HistoricalDocumentMarker {
            mode: HistoricalDocumentMode::OriginalTotal,
            ..rounded_cutover_marker
        };
        assert!(validate_historical_document_parent(
            &MoveType::OutInvoice,
            Some(7),
            1,
            1,
            due_date,
            Some(invoice_date),
            Some(due_date),
            100.0,
            0.0,
            100.0,
            Some(100.0),
            Some(&rounded_original_marker),
        )
        .is_err());

        let exact_total_marker = HistoricalDocumentMarker {
            mode: HistoricalDocumentMode::CutoverOpenResidual,
            source_total: 100.0,
            source_paid_to_date: 0.0,
            expected_open_residual: 100.0,
        };
        assert!(validate_historical_document_parent(
            &MoveType::OutInvoice,
            Some(7),
            1,
            1,
            due_date,
            Some(invoice_date),
            Some(due_date),
            100.004,
            0.0,
            100.004,
            Some(100.004),
            Some(&exact_total_marker),
        )
        .is_err());

        let original_total_marker = HistoricalDocumentMarker {
            mode: HistoricalDocumentMode::OriginalTotal,
            source_total: 150.0,
            source_paid_to_date: 60.0,
            expected_open_residual: 90.0,
        };
        assert!(validate_historical_document_parent(
            &MoveType::OutInvoice,
            Some(7),
            1,
            1,
            due_date,
            Some(invoice_date),
            Some(due_date),
            150.0,
            0.0,
            150.0,
            Some(150.0),
            Some(&original_total_marker),
        )
        .is_ok());
        assert!(validate_historical_document_parent(
            &MoveType::OutInvoice,
            Some(7),
            1,
            1,
            due_date,
            Some(invoice_date),
            Some(due_date),
            90.0,
            0.0,
            90.0,
            Some(90.0),
            Some(&original_total_marker),
        )
        .is_err());

        let mismatched_audit_totals = HistoricalDocumentMarker {
            mode: HistoricalDocumentMode::OriginalTotal,
            source_total: 150.0,
            source_paid_to_date: 50.0,
            expected_open_residual: 90.0,
        };
        assert!(validate_historical_document_parent(
            &MoveType::OutInvoice,
            Some(7),
            1,
            1,
            due_date,
            Some(invoice_date),
            Some(due_date),
            150.0,
            0.0,
            150.0,
            Some(150.0),
            Some(&mismatched_audit_totals),
        )
        .is_err());
    }

    #[test]
    fn historical_document_marker_accepts_only_explicit_supported_modes() {
        let metadata = r#"{"extra":{"lumiere_historical_document":{"version":1,"mode":"cutover_open_residual","source_total":150,"source_paid_to_date":60,"expected_open_residual":90}}}"#;
        assert_eq!(
            historical_document_marker(Some(metadata)).unwrap(),
            Some(HistoricalDocumentMarker {
                mode: HistoricalDocumentMode::CutoverOpenResidual,
                source_total: 150.0,
                source_paid_to_date: 60.0,
                expected_open_residual: 90.0,
            })
        );
        let original_total = metadata.replace("cutover_open_residual", "original_total");
        assert_eq!(
            historical_document_marker(Some(&original_total)).unwrap(),
            Some(HistoricalDocumentMarker {
                mode: HistoricalDocumentMode::OriginalTotal,
                source_total: 150.0,
                source_paid_to_date: 60.0,
                expected_open_residual: 90.0,
            })
        );
        let unknown_mode = metadata.replace("cutover_open_residual", "unknown");
        assert!(historical_document_marker(Some(&unknown_mode)).is_err());
    }

    #[test]
    fn every_historical_line_must_match_parent_scope() {
        let date = spacetimedb::Timestamp::from_micros_since_unix_epoch(100);
        assert!(
            validate_historical_line_dimensions(1, 1, date, Some(7), 1, 1, date, Some(7),).is_ok()
        );
        assert!(
            validate_historical_line_dimensions(1, 1, date, Some(7), 2, 1, date, Some(7),).is_err()
        );
        assert!(validate_historical_line_dimensions(
            1,
            1,
            date,
            Some(7),
            1,
            1,
            spacetimedb::Timestamp::from_micros_since_unix_epoch(101),
            Some(7),
        )
        .is_err());
        assert!(
            validate_historical_line_dimensions(1, 1, date, Some(7), 1, 1, date, Some(8),).is_err()
        );
    }

    #[test]
    fn every_historical_line_account_must_be_ledger_compatible() {
        assert!(validate_historical_account_dimensions(11, false, None, &[], 1, 7).is_ok());
        assert!(validate_historical_account_dimensions(11, true, None, &[], 1, 7).is_err());
        assert!(validate_historical_account_dimensions(11, false, Some(2), &[], 1, 7).is_err());
        assert!(validate_historical_account_dimensions(11, false, None, &[8], 1, 7).is_err());
    }

    #[test]
    fn bundle_fingerprint_is_read_only_from_the_private_extra_marker() {
        assert_eq!(
            account_move_bundle_fingerprint(Some(
                r#"{"source":"legacy","extra":{"lumiere_account_move_bundle":{"version":1,"token":"v1-request","fingerprint":"v1-abc","original_extra_present":false,"original_extra":null}}}"#,
            )),
            Some("v1-abc".to_string())
        );
        assert_eq!(
            account_move_bundle_fingerprint(Some(
                r#"{"lumiere_account_move_bundle":{"fingerprint":"wrong-level"}}"#,
            )),
            None
        );
        assert_eq!(account_move_bundle_fingerprint(Some("legacy note")), None);
    }

    #[test]
    fn bundle_token_is_consumed_without_losing_user_metadata() {
        let metadata = r#"{"source":"legacy","extra":{"region":"rw","lumiere_account_move_bundle":{"version":1,"token":"v1-request","fingerprint":"v1-row","original_extra_present":true,"original_extra":{"region":"rw"}}}}"#;
        assert_eq!(
            account_move_bundle_token(Some(metadata)),
            Some("v1-request".to_string())
        );
        let consumed = consume_account_move_bundle_marker(Some(metadata))
            .unwrap()
            .unwrap();
        let value: serde_json::Value = serde_json::from_str(&consumed).unwrap();
        assert_eq!(value["source"], "legacy");
        assert_eq!(value["extra"]["region"], "rw");
        assert!(value["extra"]
            .get(ACCOUNT_MOVE_BUNDLE_METADATA_KEY)
            .is_none());
    }

    #[test]
    fn consuming_bundle_marker_restores_exact_extra_schema() {
        for original in [
            serde_json::json!("legacy"),
            serde_json::json!(["a", {"b": 2}]),
            serde_json::Value::Null,
        ] {
            let metadata = serde_json::json!({
                "source": "legacy",
                "extra": {
                    (ACCOUNT_MOVE_BUNDLE_METADATA_KEY): {
                        "version": 1,
                        "token": "request",
                        "fingerprint": "row",
                        "original_extra_present": true,
                        "original_extra": original.clone(),
                    }
                }
            })
            .to_string();
            let consumed = consume_account_move_bundle_marker(Some(&metadata))
                .unwrap()
                .unwrap();
            let value: serde_json::Value = serde_json::from_str(&consumed).unwrap();
            assert_eq!(value["extra"], original);
        }
    }

    #[test]
    fn changed_bundle_token_cannot_reuse_an_interrupted_parent() {
        let interrupted = r#"{"extra":{"lumiere_account_move_bundle":{"version":1,"token":"bundle-a-plus-b","fingerprint":"row-a","original_extra_present":false,"original_extra":null}}}"#;
        assert!(account_move_parent_marker_matches(
            Some(interrupted),
            "bundle-a-plus-b",
            "row-a"
        ));
        assert!(!account_move_parent_marker_matches(
            Some(interrupted),
            "bundle-a-only",
            "row-a"
        ));
    }

    #[test]
    fn parent_bundle_marker_rejects_missing_or_mixed_tokens() {
        let missing =
            r#"{"extra":{"lumiere_account_move_bundle":{"version":1,"fingerprint":"row-a"}}}"#;
        assert!(account_move_parent_bundle_marker(Some(missing)).is_none());

        let first = r#"{"extra":{"lumiere_account_move_bundle":{"version":1,"token":"bundle-a","fingerprint":"row-a","original_extra_present":false,"original_extra":null}}}"#;
        let second = r#"{"extra":{"lumiere_account_move_bundle":{"version":1,"token":"bundle-b","fingerprint":"row-b","original_extra_present":false,"original_extra":null}}}"#;
        let first = account_move_parent_bundle_marker(Some(first)).unwrap();
        let second = account_move_parent_bundle_marker(Some(second)).unwrap();
        assert_ne!(first.token, second.token);
    }

    #[test]
    fn bundle_marker_rejects_missing_restore_envelope() {
        let missing = r#"{"extra":{"lumiere_account_move_bundle":{"version":1,"token":"request","fingerprint":"row"}}}"#;
        assert!(parse_account_move_bundle_marker(Some(missing)).is_err());
        assert!(consume_account_move_bundle_marker(Some(missing)).is_err());
    }

    #[test]
    fn bundle_marker_rejects_reserved_key_in_restored_extra() {
        let nested = r#"{"extra":{"lumiere_account_move_bundle":{"version":1,"token":"request","fingerprint":"row","original_extra_present":true,"original_extra":{"lumiere_account_move_bundle":{"user":"value"}}}}}"#;
        assert!(parse_account_move_bundle_marker(Some(nested)).is_err());
        assert!(consume_account_move_bundle_marker(Some(nested)).is_err());
    }

    #[test]
    fn bundle_marker_rejects_tampered_extra_siblings() {
        let absent_with_sibling = r#"{"extra":{"region":"rw","lumiere_account_move_bundle":{"version":1,"token":"request","fingerprint":"row","original_extra_present":false,"original_extra":null}}}"#;
        assert!(parse_account_move_bundle_marker(Some(absent_with_sibling)).is_err());

        let scalar_with_sibling = r#"{"extra":{"region":"rw","lumiere_account_move_bundle":{"version":1,"token":"request","fingerprint":"row","original_extra_present":true,"original_extra":"legacy"}}}"#;
        assert!(parse_account_move_bundle_marker(Some(scalar_with_sibling)).is_err());
    }

    #[test]
    fn bundle_marker_rejects_tampered_object_snapshot() {
        let changed = r#"{"extra":{"region":"ke","lumiere_account_move_bundle":{"version":1,"token":"request","fingerprint":"row","original_extra_present":true,"original_extra":{"region":"rw"}}}}"#;
        assert!(parse_account_move_bundle_marker(Some(changed)).is_err());
        assert!(consume_account_move_bundle_marker(Some(changed)).is_err());
    }

    #[test]
    fn move_line_import_plan_groups_rows_and_tracks_invalid_moves() {
        let mut plan = MoveLineImportPlan::default();
        plan.stage(10, 2, 100.0, 0.0, ());
        plan.stage(20, 3, 50.0, 0.0, ());
        plan.stage(10, 4, 0.0, 100.0, ());
        plan.invalidate_move(20);

        assert_eq!(plan.groups.get(&10).map(Vec::len), Some(2));
        assert_eq!(plan.groups.get(&20).map(Vec::len), Some(1));
        assert!(!plan.invalid_move_ids.contains(&10));
        assert!(plan.invalid_move_ids.contains(&20));
    }

    #[test]
    fn move_balance_prevalidation_includes_existing_draft_amounts() {
        let imported = vec![StagedMoveLine {
            row_number: 2,
            debit: 0.0,
            credit: 75.0,
            value: (),
        }];

        let (debit, credit) = resulting_move_totals(75.0, 0.0, &imported);
        assert!(move_totals_are_balanced(debit, credit));
    }

    #[test]
    fn move_balance_prevalidation_rejects_unbalanced_groups() {
        let imported = vec![
            StagedMoveLine {
                row_number: 2,
                debit: 100.0,
                credit: 0.0,
                value: (),
            },
            StagedMoveLine {
                row_number: 3,
                debit: 0.0,
                credit: 90.0,
                value: (),
            },
        ];

        let (debit, credit) = resulting_move_totals(0.0, 0.0, &imported);
        assert!(!move_totals_are_balanced(debit, credit));
    }

    #[test]
    fn move_balance_prevalidation_uses_posting_tolerance() {
        assert!(move_totals_are_balanced(100.0, 99.995));
        assert!(!move_totals_are_balanced(100.0, 99.98));
    }
}
