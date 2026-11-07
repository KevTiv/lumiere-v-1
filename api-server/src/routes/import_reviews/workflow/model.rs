use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::super::{
    history_period::{calendar_date, DatePrecision},
    model::{decimal, ReviewItem},
};
use crate::error::ApiError;

pub(super) const KIND: &str = "historical_expense_journals";
pub(super) const MAX_ROWS: usize = 200;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct RowSelection {
    pub item_id: String,
    pub expected_revision: i32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct Configuration {
    pub journal_id: String,
    pub debit_account_id: String,
    pub credit_account_id: String,
    pub currency_id: String,
    pub date_field: String,
    pub amount_field: String,
    pub description_field: Option<String>,
    pub posting_date: Option<String>,
    pub reason: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub distinct_expenses: Vec<DistinctExpenseDecision>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct DistinctExpenseDecision {
    pub item_id: String,
    pub source_revision: i32,
    pub candidate_digest: String,
    pub reason: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct PrepareBody {
    pub company_id: u64,
    pub request_key: String,
    pub rows: Vec<RowSelection>,
    #[serde(flatten)]
    pub configuration: Configuration,
}

impl PrepareBody {
    pub fn validate(&self) -> Result<(), ApiError> {
        if self.company_id == 0
            || !request_key(&self.request_key)
            || self.rows.is_empty()
            || self.rows.len() > MAX_ROWS
        {
            return Err(ApiError::BadRequest(format!(
                "select between 1 and {MAX_ROWS} reviewed rows and a valid request identity"
            )));
        }
        let mut ids = BTreeSet::new();
        for row in &self.rows {
            positive_id(&row.item_id)?;
            if row.expected_revision < 1 || !ids.insert(&row.item_id) {
                return Err(ApiError::BadRequest(
                    "source rows and revisions must be unique and positive".into(),
                ));
            }
        }
        self.configuration.validate()
    }
}

impl Configuration {
    pub fn validate(&self) -> Result<(), ApiError> {
        for value in [
            &self.journal_id,
            &self.debit_account_id,
            &self.credit_account_id,
            &self.currency_id,
        ] {
            positive_id(value)?;
        }
        if self.debit_account_id == self.credit_account_id {
            return Err(ApiError::BadRequest(
                "choose different debit and credit accounts".into(),
            ));
        }
        if self.reason.trim().len() < 3
            || self.reason.len() > 2000
            || self.reason.chars().any(char::is_control)
        {
            return Err(ApiError::BadRequest(
                "explain the accounting mapping and chosen posting date".into(),
            ));
        }
        for field in [
            Some(&self.date_field),
            Some(&self.amount_field),
            self.description_field.as_ref(),
        ]
        .into_iter()
        .flatten()
        {
            if field.is_empty()
                || field.len() > 100
                || !field
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
            {
                return Err(ApiError::BadRequest(
                    "choose an existing source field".into(),
                ));
            }
        }
        if let Some(date) = &self.posting_date {
            calendar_date(date).map_err(ApiError::BadRequest)?;
        }
        if self.distinct_expenses.len() > MAX_ROWS {
            return Err(ApiError::BadRequest(
                "too many distinct-expense decisions".into(),
            ));
        }
        let mut decisions = BTreeSet::new();
        for decision in &self.distinct_expenses {
            positive_id(&decision.item_id)?;
            if !decisions.insert(&decision.item_id)
                || decision.source_revision < 1
                || !super::super::model::sha256(&decision.candidate_digest)
                || decision.reason.trim().len() < 3
                || decision.reason.len() > 2000
                || decision.reason.chars().any(char::is_control)
            {
                return Err(ApiError::BadRequest("a distinct-expense decision needs one current source revision, candidate fingerprint and explicit reason".into()));
            }
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct ActionBody {
    pub company_id: u64,
    pub expected_revision: i32,
    pub expected_digest: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SourceVersion {
    pub item_id: String,
    pub batch_id: String,
    pub revision: i32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Entry {
    pub item_id: String,
    pub batch_id: String,
    pub source_revision: i32,
    pub source_file: String,
    pub source_row: u32,
    pub source_sha256: String,
    pub reference: String,
    pub date: String,
    pub description: String,
    pub amount: String,
    pub business_identity: BusinessIdentity,
}

/// Candidate matching can hold a row; it never confirms a fact, merges records
/// or decides that two exports represent different business events.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BusinessIdentity {
    pub date_from: String,
    pub date_to_exclusive: String,
    pub external_reference: Option<String>,
    pub category: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub(super) struct OverlapCandidate {
    pub origin: String,
    pub proposal_id: Option<String>,
    pub proposal_digest: Option<String>,
    pub item_id: String,
    pub source_revision: i32,
    pub reason: String,
    pub date_from: String,
    pub date_to_exclusive: String,
    pub posting_date: String,
    pub amount: String,
    pub currency_id: String,
    pub external_reference: Option<String>,
    pub category: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DistinctExpenseResolution {
    pub kind: String,
    pub candidate_digest: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Issue {
    pub item_id: Option<String>,
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub candidates: Vec<OverlapCandidate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolution: Option<DistinctExpenseResolution>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Summary {
    pub record_count: usize,
    pub line_count: usize,
    pub blocked_count: usize,
    pub total_debit: String,
    pub total_credit: String,
    pub currency_id: String,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Definition {
    pub kind: String,
    pub configuration: Configuration,
    pub summary: Summary,
    pub sources: Vec<SourceVersion>,
    pub entries: Vec<Entry>,
    pub issues: Vec<Issue>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Phase {
    #[default]
    NotStarted,
    Headers,
    Lines,
    Verification,
    Complete,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Execution {
    pub phase: Phase,
    pub parent_request_id: Option<String>,
    pub line_request_id: Option<String>,
    pub parent_job_id: Option<String>,
    pub line_job_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct VerifiedResult {
    pub verified_at: String,
    pub company_id: String,
    pub currency_id: String,
    pub record_count: usize,
    pub line_count: usize,
    pub total_debit: String,
    pub total_credit: String,
    pub record_ids: Vec<String>,
    pub line_ids: Vec<String>,
    pub posted_count: usize,
}

pub(super) struct ReviewedRow {
    pub id: i64,
    pub batch: i64,
    pub revision: i32,
    pub state: String,
    pub target: String,
    pub source: ReviewItem,
    pub values: BTreeMap<String, Option<String>>,
    pub confirmed: BTreeSet<String>,
}

fn confirmed_value<'a>(row: &'a ReviewedRow, field: &str) -> Option<&'a str> {
    row.confirmed
        .contains(field)
        .then(|| row.values.get(field)?.as_deref())
        .flatten()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

pub(super) fn build_definition(
    rows: &[ReviewedRow],
    configuration: &Configuration,
    currency_decimals: u8,
) -> Result<Definition, ApiError> {
    configuration.validate()?;
    let mut entries = Vec::new();
    let mut issues = Vec::new();
    let mut source_keys = BTreeSet::new();
    for row in rows {
        let entry = build_entry(row, configuration, currency_decimals);
        match entry {
            Ok(entry) => {
                if !source_keys.insert(claim_key(&entry)) {
                    issues.push(Issue { item_id: Some(row.id.to_string()), code: "repeated_source".into(), message: "This source row already appears in the selected group; review the overlap.".into(), candidates:Vec::new(), resolution:None });
                    continue;
                }
                entries.push(entry);
            }
            Err((code, message)) => issues.push(Issue {
                item_id: Some(row.id.to_string()),
                code: code.into(),
                message: message.into(),
                candidates: Vec::new(),
                resolution: None,
            }),
        }
    }
    let mut definition = Definition {
        kind: KIND.into(),
        configuration: configuration.clone(),
        summary: Summary {
            record_count: 0,
            line_count: 0,
            blocked_count: rows.len(),
            total_debit: "0".into(),
            total_credit: "0".into(),
            currency_id: configuration.currency_id.clone(),
            date_from: None,
            date_to: None,
        },
        sources: rows
            .iter()
            .map(|row| SourceVersion {
                item_id: row.id.to_string(),
                batch_id: row.batch.to_string(),
                revision: row.revision,
            })
            .collect(),
        entries,
        issues,
    };
    refresh_summary(&mut definition)?;
    Ok(definition)
}

pub(super) fn refresh_summary(definition: &mut Definition) -> Result<(), ApiError> {
    let total = definition.entries.iter().try_fold(0_i128, |total, entry| {
        let amount = decimal(&entry.amount)
            .ok_or_else(|| ApiError::Internal("prepared amount is invalid".into()))?;
        total
            .checked_add(amount)
            .ok_or_else(|| ApiError::BadRequest("group total exceeds supported precision".into()))
    })?;
    definition.summary = Summary {
        record_count: definition.entries.len(),
        line_count: definition.entries.len() * 2,
        blocked_count: definition.sources.len() - definition.entries.len(),
        total_debit: decimal_text(total),
        total_credit: decimal_text(total),
        currency_id: definition.configuration.currency_id.clone(),
        date_from: definition
            .entries
            .iter()
            .map(|entry| &entry.date)
            .min()
            .cloned(),
        date_to: definition
            .entries
            .iter()
            .map(|entry| &entry.date)
            .max()
            .cloned(),
    };
    Ok(())
}

fn build_entry(
    row: &ReviewedRow,
    config: &Configuration,
    currency_decimals: u8,
) -> Result<Entry, (&'static str, &'static str)> {
    if row.state == "excluded" {
        return Err((
            "excluded",
            "This source was excluded and will not create ERP records.",
        ));
    }
    if !matches!(row.target.as_str(), "source_observation" | "hr_expense")
        || confirmed_value(row, "observation_kind") != Some("expense")
    {
        return Err((
            "expense_meaning_unconfirmed",
            "Confirm that this row describes an expense before preparing a journal.",
        ));
    }
    let amount = confirmed_value(row, &config.amount_field)
        .and_then(decimal)
        .filter(|amount| *amount > 0)
        .ok_or((
            "amount_unconfirmed",
            "Confirm a positive expense amount in the selected source field.",
        ))?;
    if currency_decimals > 6 || amount % 10_i128.pow(u32::from(6 - currency_decimals)) != 0 {
        return Err((
            "currency_precision",
            "The confirmed amount does not match this currency's decimal precision.",
        ));
    }
    let amount = decimal_text(amount);
    if !native_amount_matches(&amount, amount.parse::<f64>().ok()) {
        return Err((
            "native_precision",
            "This amount cannot be represented exactly at the native import's supported precision.",
        ));
    }
    let date = if let Some(date) = &config.posting_date {
        date.clone()
    } else {
        let value = confirmed_value(row, &config.date_field).ok_or((
            "date_unconfirmed",
            "Confirm a precise day or explicitly choose the journal posting date.",
        ))?;
        if calendar_date(value).is_err()
            || matches!(config.date_field.as_str(), "period_start" | "period_end")
            || row.source.business_date.as_ref().is_some_and(|date| {
                !matches!(date.precision, DatePrecision::Day)
                    && !matches!(
                        config.date_field.as_str(),
                        "posting_date" | "transaction_date"
                    )
            })
        {
            return Err(("date_precision", "A report period is not a transaction date. Explicitly choose the journal posting date."));
        }
        value.to_owned()
    };
    let description = if let Some(field) = &config.description_field {
        confirmed_value(row, field)
            .ok_or((
                "description_unconfirmed",
                "Confirm the selected description field.",
            ))?
            .to_owned()
    } else {
        row.source.label.clone()
    };
    if description.is_empty() || description.len() > 2000 {
        return Err((
            "description_invalid",
            "Provide a bounded description for this expense.",
        ));
    }
    let business_identity = business_identity(row, config, &date)?;
    let mut entry = Entry {
        item_id: row.id.to_string(),
        batch_id: row.batch.to_string(),
        source_revision: row.revision,
        source_file: row.source.source.file.clone(),
        source_row: row.source.source.row,
        source_sha256: row.source.source.sha256.clone(),
        reference: String::new(),
        date,
        description,
        amount,
        business_identity,
    };
    // Business references survive re-preparation and a renamed identical upload.
    entry.reference = format!("SOURCE-{}", &claim_key(&entry)[..24]);
    Ok(entry)
}

fn business_identity(
    row: &ReviewedRow,
    config: &Configuration,
    posting_date: &str,
) -> Result<BusinessIdentity, (&'static str, &'static str)> {
    let source_period = row.source.business_date.as_ref().and_then(|date| {
        if date.validate().is_err() {
            return None;
        }
        Some((date.from.clone()?, date.to_exclusive.clone()?))
    });
    let (date_from, date_to_exclusive) = if let Some(period) = source_period {
        period
    } else {
        let date = confirmed_value(row, &config.date_field)
            .filter(|date| calendar_date(date).is_ok())
            .unwrap_or(posting_date);
        let next = calendar_date(date)
            .ok()
            .and_then(|date| date.succ_opt())
            .filter(|next| next.format("%Y-%m-%d").to_string().len() == 10)
            .ok_or((
                "date_precision",
                "The source date is outside the supported reconciliation period.",
            ))?;
        (date.to_owned(), next.format("%Y-%m-%d").to_string())
    };
    let normalized = |field| {
        confirmed_value(row, field).map(|value| {
            value
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .to_lowercase()
        })
    };
    Ok(BusinessIdentity {
        date_from,
        date_to_exclusive,
        external_reference: ["external_reference", "external_ref", "document_reference"]
            .into_iter()
            .find_map(normalized),
        category: normalized("category"),
    })
}

pub(super) fn claim_key(entry: &Entry) -> String {
    hash(format!("{KIND}\0{}\0{}", entry.source_sha256, entry.source_row).as_bytes())
}

pub(super) fn native_amount_matches(expected: &str, actual: Option<f64>) -> bool {
    let Some(actual) = actual.filter(|value| value.is_finite()) else {
        return false;
    };
    decimal(expected).is_some_and(|amount| decimal(&format!("{actual:.6}")) == Some(amount))
}

pub(super) fn decimal_text(amount: i128) -> String {
    let sign = if amount < 0 { "-" } else { "" };
    let amount = amount.abs();
    let fraction = amount % 1_000_000;
    if fraction == 0 {
        return format!("{sign}{}", amount / 1_000_000);
    }
    format!("{sign}{}.{fraction:06}", amount / 1_000_000)
        .trim_end_matches('0')
        .into()
}

pub(super) fn positive_id(value: &str) -> Result<u64, ApiError> {
    if value.is_empty()
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || value.starts_with('0')
    {
        return Err(ApiError::BadRequest(
            "IDs must be positive canonical decimal strings".into(),
        ));
    }
    value
        .parse::<u64>()
        .ok()
        .filter(|value| *value > 0)
        .ok_or_else(|| ApiError::BadRequest("ID is outside the supported range".into()))
}

pub(super) fn request_key(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(super) fn hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
