//! Candidate finance-report evidence projection, separate from pilot admission.
//!
//! Consume only the field-filtered response of the existing authorized owner-report
//! service. This module does not authenticate a caller, fetch data, invoke a model,
//! or publish an answer. The future admitted capability must perform those steps.
//! Financial calculations remain owned by `api-server::reports`.

use std::collections::BTreeSet;

use chrono::{DateTime, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub const FINANCE_REVIEW_SKILL_KEY: &str = "finance_report_review";
pub const MAX_PREVIEW_BYTES: usize = 256 * 1024;
pub const MAX_REVIEW_ITEMS: usize = 20;
const MAX_SOURCE_ITEMS: usize = 1_000;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub enum FinanceReportKey {
    #[serde(rename = "cash_mobile_money_v1")]
    Cash,
    #[serde(rename = "customer_balances_v1")]
    Receivables,
    #[serde(rename = "supplier_payables_v1")]
    Payables,
}

impl FinanceReportKey {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Cash => "cash_mobile_money_v1",
            Self::Receivables => "customer_balances_v1",
            Self::Payables => "supplier_payables_v1",
        }
    }
}

/// Model-visible parameters. Tenant, company, actor and run are never parameters.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FinanceReviewRequest {
    pub report_key: FinanceReportKey,
    pub date: String,
    pub timezone: String,
}

/// Construct only from the admitted run's authenticated, company-bound context.
/// It is deliberately not deserializable from model or browser JSON.
#[derive(Clone, Copy, Debug)]
pub struct FinanceReviewScope {
    organization_id: u64,
    company_id: u64,
    run_id: u64,
}

impl FinanceReviewScope {
    pub fn new(organization_id: u64, company_id: u64, run_id: u64) -> Result<Self, ReviewError> {
        if organization_id == 0 || company_id == 0 || run_id == 0 {
            return Err(ReviewError::InvalidScope);
        }
        Ok(Self {
            organization_id,
            company_id,
            run_id,
        })
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ReviewError {
    #[error("finance review requires an admitted organization, company and run")]
    InvalidScope,
    #[error("finance review requires a calendar date and owner-service timezone")]
    InvalidRequest,
    #[error("finance preview exceeds its byte or row bound")]
    LimitExceeded,
    #[error("finance preview has an unsupported or malformed schema")]
    InvalidPreview,
    #[error("finance preview does not match the admitted scope and requested report")]
    ScopeMismatch,
    #[error("finance preview has missing or inconsistent provenance")]
    InvalidProvenance,
    #[error("finance preview has inconsistent money scales or totals")]
    InconsistentMoney,
    #[error("finance preview has duplicate or inconsistent record coverage")]
    InconsistentCoverage,
}

/// Money stays in exact integer minor units through evidence and citations.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReviewMoney {
    pub minor_units: i64,
    pub scale: u8,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportScope {
    pub organization_id: u64,
    pub company_id: u64,
    pub local_date: String,
    pub date_from: String,
    pub date_to_exclusive: String,
    pub timezone: String,
    pub window_start_utc: String,
    pub window_end_utc: String,
    pub cutoff_label: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportCurrency {
    pub currency_id: u64,
    pub minor_unit_scale: u8,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SourceRowCount {
    pub source: String,
    pub rows: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceWatermark {
    pub accounting_cutoff: String,
    pub window_start_utc: String,
    pub window_end_utc: String,
    pub cutoff_label: String,
    pub queried_at: String,
    pub source_rows: Vec<SourceRowCount>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Preview {
    report_key: FinanceReportKey,
    schema_version: u16,
    scope: ReportScope,
    currency: ReportCurrency,
    generated_at: String,
    source_watermark: SourceWatermark,
    watermark: String,
    caveats: Vec<String>,
    report: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoneyFact {
    /// JSON pointer into the authorized owner-report response.
    pub source_pointer: String,
    /// JSON pointer into the persisted observation, used by answer claims.
    pub evidence_pointer: String,
    pub amount: ReviewMoney,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DueBucket {
    pub bucket: String,
    pub amount: ReviewMoney,
    #[serde(skip_deserializing)]
    pub source_pointer: String,
    #[serde(skip_deserializing)]
    pub evidence_pointer: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewRecordKind {
    AccountMove,
    PaymentTransaction,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewItem {
    pub record_kind: ReviewRecordKind,
    pub record_id: u64,
    pub source_pointer: String,
    pub evidence_pointer: String,
    pub amount: ReviewMoney,
    pub due_date: Option<String>,
    pub is_partial: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemCoverage {
    pub total_items: usize,
    pub owner_provided_items: usize,
    pub included_items: usize,
    pub omitted_items: usize,
    pub selection: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceObservation {
    pub schema_version: u16,
    pub report_key: FinanceReportKey,
    pub run_id: u64,
    pub scope: ReportScope,
    pub currency: ReportCurrency,
    pub generated_at: String,
    pub source_watermark: SourceWatermark,
    /// Preserve preview status and owner caveats in every model-visible snapshot.
    pub watermark: String,
    pub caveats: Vec<String>,
    pub totals: Vec<MoneyFact>,
    pub due_buckets: Vec<DueBucket>,
    pub items: Vec<ReviewItem>,
    pub coverage: ItemCoverage,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceReviewEvidence {
    pub source_key: String,
    pub source_version: String,
    pub observation: FinanceObservation,
}

/// Project an authorized report response into bounded, run-bound evidence.
///
/// # Errors
/// Rejects scope/provenance mismatches, unsupported reports, malformed or oversized
/// responses, inconsistent money and ambiguous item identity. A failed or denied
/// upstream request must propagate its typed error, never become an empty preview.
pub fn build_evidence(
    scope: FinanceReviewScope,
    request: &FinanceReviewRequest,
    authorized_preview: &[u8],
) -> Result<FinanceReviewEvidence, ReviewError> {
    let date = NaiveDate::parse_from_str(&request.date, "%Y-%m-%d")
        .map_err(|_| ReviewError::InvalidRequest)?;
    if date.to_string() != request.date
        || request.timezone.is_empty()
        || request.timezone.len() > 64
        || request.timezone.chars().any(char::is_control)
    {
        return Err(ReviewError::InvalidRequest);
    }
    if authorized_preview.len() > MAX_PREVIEW_BYTES {
        return Err(ReviewError::LimitExceeded);
    }
    let preview: Preview =
        serde_json::from_slice(authorized_preview).map_err(|_| ReviewError::InvalidPreview)?;
    validate_preview(&preview, scope, request, date)?;
    let mut totals = Vec::new();
    let mut due_buckets = Vec::new();
    let (mut items, total_items, selection) = match request.report_key {
        FinanceReportKey::Cash => {
            for field in ["opening", "receipts", "disbursements", "fees", "closing"] {
                totals.push(money_fact(&preview, field)?);
            }
            let money = |index: usize| i128::from(totals[index].amount.minor_units);
            if money(0) + money(1) - money(2) - money(3) != money(4) {
                return Err(ReviewError::InconsistentMoney);
            }
            let unreconciled = preview
                .report
                .get("unreconciled")
                .ok_or(ReviewError::InvalidPreview)?;
            let count = unreconciled
                .get("count")
                .and_then(Value::as_u64)
                .and_then(|count| usize::try_from(count).ok())
                .ok_or(ReviewError::InvalidPreview)?;
            let lines = array(unreconciled, "lines")?;
            if count < lines.len() || count > MAX_SOURCE_ITEMS {
                return Err(ReviewError::InconsistentCoverage);
            }
            let items = lines
                .iter()
                .enumerate()
                .map(|(index, line)| {
                    Ok(ReviewItem {
                        record_kind: ReviewRecordKind::PaymentTransaction,
                        record_id: record_id(line, "paymentTransactionId")?,
                        source_pointer: format!("/report/unreconciled/lines/{index}/amount"),
                        evidence_pointer: String::new(),
                        amount: money_field(line, "amount", preview.currency.minor_unit_scale)?,
                        due_date: None,
                        is_partial: None,
                    })
                })
                .collect::<Result<Vec<_>, ReviewError>>()?;
            (
                items,
                count,
                "largest_absolute_amount_within_owner_provided_lines",
            )
        }
        FinanceReportKey::Receivables | FinanceReportKey::Payables => {
            for field in ["totalOpen", "overdue", "current"] {
                totals.push(money_fact(&preview, field)?);
            }
            if i128::from(totals[0].amount.minor_units)
                != i128::from(totals[1].amount.minor_units)
                    + i128::from(totals[2].amount.minor_units)
            {
                return Err(ReviewError::InconsistentMoney);
            }
            if request.report_key == FinanceReportKey::Payables {
                for field in ["paidAmounts", "plannedAmounts"] {
                    totals.push(money_fact(&preview, field)?);
                }
            }
            let buckets = array(&preview.report, "dueBuckets")?;
            let mut seen_buckets = BTreeSet::new();
            for (index, bucket) in buckets.iter().enumerate() {
                let mut bucket: DueBucket = serde_json::from_value(bucket.clone())
                    .map_err(|_| ReviewError::InvalidPreview)?;
                if !["current", "1_30", "31_60", "61_90", "over_90"]
                    .contains(&bucket.bucket.as_str())
                    || !seen_buckets.insert(bucket.bucket.clone())
                {
                    return Err(ReviewError::InconsistentCoverage);
                }
                validate_money(bucket.amount, preview.currency.minor_unit_scale)?;
                bucket.source_pointer = format!("/report/dueBuckets/{index}/amount");
                bucket.evidence_pointer = format!("/dueBuckets/{index}/amount");
                due_buckets.push(bucket);
            }
            let lines = array(&preview.report, "lines")?;
            let mut items = Vec::with_capacity(lines.len());
            for (index, line) in lines.iter().enumerate() {
                let due_date = nullable_date(line, "dueDate")?;
                let is_partial = line
                    .get("isPartial")
                    .and_then(Value::as_bool)
                    .ok_or(ReviewError::InvalidPreview)?;
                items.push(ReviewItem {
                    record_kind: ReviewRecordKind::AccountMove,
                    record_id: record_id(line, "moveId")?,
                    source_pointer: format!("/report/lines/{index}/residual"),
                    evidence_pointer: String::new(),
                    amount: money_field(line, "residual", preview.currency.minor_unit_scale)?,
                    due_date,
                    is_partial: Some(is_partial),
                });
            }
            let total = i128::from(totals[0].amount.minor_units);
            let current = due_buckets
                .iter()
                .filter(|bucket| bucket.bucket == "current")
                .map(|bucket| i128::from(bucket.amount.minor_units))
                .sum::<i128>();
            if due_buckets
                .iter()
                .map(|b| i128::from(b.amount.minor_units))
                .sum::<i128>()
                != total
                || items
                    .iter()
                    .map(|i| i128::from(i.amount.minor_units))
                    .sum::<i128>()
                    != total
                || current != i128::from(totals[2].amount.minor_units)
            {
                return Err(ReviewError::InconsistentMoney);
            }
            let count = items.len();
            (items, count, "largest_absolute_residual")
        }
    };
    let mut ids = BTreeSet::new();
    if items.iter().any(|item| !ids.insert(item.record_id)) {
        return Err(ReviewError::InconsistentCoverage);
    }
    let owner_provided_items = items.len();
    items.sort_by(|a, b| {
        b.amount
            .minor_units
            .unsigned_abs()
            .cmp(&a.amount.minor_units.unsigned_abs())
            .then(a.record_id.cmp(&b.record_id))
    });
    items.truncate(MAX_REVIEW_ITEMS);
    for (index, item) in items.iter_mut().enumerate() {
        item.evidence_pointer = format!("/items/{index}/amount");
    }
    for (index, fact) in totals.iter_mut().enumerate() {
        fact.evidence_pointer = format!("/totals/{index}/amount");
    }
    let coverage = ItemCoverage {
        total_items,
        owner_provided_items,
        included_items: items.len(),
        omitted_items: total_items - items.len(),
        selection,
    };
    let observation = FinanceObservation {
        schema_version: 1,
        report_key: preview.report_key,
        run_id: scope.run_id,
        scope: preview.scope,
        currency: preview.currency,
        generated_at: preview.generated_at,
        source_watermark: preview.source_watermark,
        watermark: preview.watermark,
        caveats: preview.caveats,
        totals,
        due_buckets,
        items,
        coverage,
    };
    let encoded = serde_json::to_vec(&observation).map_err(|_| ReviewError::InvalidPreview)?;
    let mut hash = Sha256::new();
    hash.update(b"lumiere.finance.report.observation.v1\0");
    hash.update(&encoded);
    Ok(FinanceReviewEvidence {
        source_key: format!(
            "run:{}:finance_report:{}",
            scope.run_id,
            request.report_key.as_str()
        ),
        source_version: format!("sha256:{:x}", hash.finalize()),
        observation,
    })
}

fn validate_preview(
    preview: &Preview,
    scope: FinanceReviewScope,
    request: &FinanceReviewRequest,
    date: NaiveDate,
) -> Result<(), ReviewError> {
    if preview.schema_version != 1 {
        return Err(ReviewError::InvalidPreview);
    }
    let actual = &preview.scope;
    if actual.organization_id != scope.organization_id
        || actual.company_id != scope.company_id
        || preview.report_key != request.report_key
        || actual.local_date != request.date
        || actual.timezone != request.timezone
        || actual.date_from != request.date
        || Some(actual.date_to_exclusive.as_str())
            != date.succ_opt().map(|d| d.to_string()).as_deref()
    {
        return Err(ReviewError::ScopeMismatch);
    }
    let watermark = &preview.source_watermark;
    let start = DateTime::parse_from_rfc3339(&actual.window_start_utc)
        .map_err(|_| ReviewError::InvalidProvenance)?;
    let end = DateTime::parse_from_rfc3339(&actual.window_end_utc)
        .map_err(|_| ReviewError::InvalidProvenance)?;
    if start >= end
        || watermark.window_start_utc != actual.window_start_utc
        || watermark.window_end_utc != actual.window_end_utc
        || watermark.accounting_cutoff != actual.window_end_utc
        || watermark.cutoff_label != actual.cutoff_label
        || actual.cutoff_label.trim().is_empty()
        || preview.watermark.trim().is_empty()
        || DateTime::parse_from_rfc3339(&watermark.queried_at).is_err()
        || DateTime::parse_from_rfc3339(&preview.generated_at).is_err()
        || watermark.source_rows.is_empty()
    {
        return Err(ReviewError::InvalidProvenance);
    }
    let mut sources = BTreeSet::new();
    for source in &watermark.source_rows {
        if source.rows > MAX_SOURCE_ITEMS {
            return Err(ReviewError::LimitExceeded);
        }
        if source.source.trim().is_empty() || !sources.insert(&source.source) {
            return Err(ReviewError::InvalidProvenance);
        }
    }
    if preview.currency.currency_id == 0 || preview.currency.minor_unit_scale > 9 {
        return Err(ReviewError::InconsistentMoney);
    }
    Ok(())
}

fn array<'a>(value: &'a Value, field: &str) -> Result<&'a [Value], ReviewError> {
    let rows = value
        .get(field)
        .and_then(Value::as_array)
        .ok_or(ReviewError::InvalidPreview)?;
    if rows.len() > MAX_SOURCE_ITEMS {
        return Err(ReviewError::LimitExceeded);
    }
    Ok(rows)
}

fn record_id(value: &Value, field: &str) -> Result<u64, ReviewError> {
    value
        .get(field)
        .and_then(Value::as_u64)
        .filter(|id| *id > 0)
        .ok_or(ReviewError::InvalidPreview)
}

fn money_fact(preview: &Preview, field: &str) -> Result<MoneyFact, ReviewError> {
    Ok(MoneyFact {
        source_pointer: format!("/report/{field}"),
        evidence_pointer: String::new(),
        amount: money_field(&preview.report, field, preview.currency.minor_unit_scale)?,
    })
}

fn money_field(value: &Value, field: &str, scale: u8) -> Result<ReviewMoney, ReviewError> {
    let money = serde_json::from_value(
        value
            .get(field)
            .cloned()
            .ok_or(ReviewError::InvalidPreview)?,
    )
    .map_err(|_| ReviewError::InvalidPreview)?;
    validate_money(money, scale)?;
    Ok(money)
}

fn validate_money(money: ReviewMoney, scale: u8) -> Result<(), ReviewError> {
    if money.scale != scale {
        return Err(ReviewError::InconsistentMoney);
    }
    Ok(())
}

fn nullable_date(value: &Value, field: &str) -> Result<Option<String>, ReviewError> {
    match value.get(field) {
        Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => {
            let date = NaiveDate::parse_from_str(value, "%Y-%m-%d")
                .map_err(|_| ReviewError::InvalidPreview)?;
            if date.to_string() != *value {
                return Err(ReviewError::InvalidPreview);
            }
            Ok(Some(value.clone()))
        }
        _ => Err(ReviewError::InvalidPreview),
    }
}

#[cfg(test)]
mod tests;
