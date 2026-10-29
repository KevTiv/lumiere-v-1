//! Closed read-only finance workflow contracts shared by API, gateway and fixtures.
//! No credentials, SQL, provider calls or financial mutations belong here.
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub mod reviews;

pub const MAX_ROWS: usize = 1_000;
pub const MAX_BYTES: usize = 262_144;
pub const VERSION: &str = "1.0.1";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Skill {
    pub key: &'static str,
    pub resource: &'static str,
    pub output: &'static str,
    pub program: &'static str,
}

pub const SKILLS: [Skill; 5] = [
    Skill {
        key: "finance_report_review",
        resource: "finance.report_review.v1",
        output: "finance.report_review.result.v1",
        program: "skill:finance_report_review@1",
    },
    Skill {
        key: "bank_reconciliation_review",
        resource: "finance.bank_reconciliation_review.v1",
        output: "finance.bank_reconciliation_review.result.v1",
        program: "skill:bank_reconciliation_review@1",
    },
    Skill {
        key: "period_close_review",
        resource: "finance.period_close_review.v1",
        output: "finance.period_close_review.result.v1",
        program: "skill:period_close_review@1",
    },
    Skill {
        key: "expense_evidence_review",
        resource: "finance.expense_evidence_review.v1",
        output: "finance.expense_evidence_review.result.v1",
        program: "skill:expense_evidence_review@1",
    },
    Skill {
        key: "finance_variance_review",
        resource: "finance.variance_review.v1",
        output: "finance.variance_review.result.v1",
        program: "skill:finance_variance_review@1",
    },
];

pub fn skill(key: &str) -> Result<Skill> {
    SKILLS
        .iter()
        .find(|s| s.key == key)
        .copied()
        .context("unsupported finance skill")
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum ReportKey {
    #[serde(rename = "cash_mobile_money_v1")]
    Cash,
    #[serde(rename = "customer_balances_v1")]
    Receivables,
    #[serde(rename = "supplier_payables_v1")]
    Payables,
}
impl ReportKey {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Cash => "cash_mobile_money_v1",
            Self::Receivables => "customer_balances_v1",
            Self::Payables => "supplier_payables_v1",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReportInput {
    pub report_key: ReportKey,
    pub date: String,
    pub timezone: String,
    pub query: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BankInput {
    pub statement_id: u64,
    pub query: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CloseInput {
    pub period_id: u64,
    pub query: Option<String>,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExpenseKind {
    Expense,
    Bill,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ExpenseInput {
    pub record_kind: ExpenseKind,
    pub record_id: u64,
    pub query: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VarianceInput {
    pub report_key: ReportKey,
    pub actual_date: String,
    pub baseline_date: String,
    pub timezone: String,
    pub query: Option<String>,
}

pub enum Input {
    Report(ReportInput),
    Bank(BankInput),
    Close(CloseInput),
    Expense(ExpenseInput),
    Variance(VarianceInput),
}

pub fn parse_input(key: &str, value: &Value) -> Result<Input> {
    ensure!(
        serde_json::to_vec(value)?.len() <= 8_192,
        "finance input exceeds its byte bound"
    );
    let result = match key {
        "finance_report_review" => Input::Report(serde_json::from_value(value.clone())?),
        "bank_reconciliation_review" => Input::Bank(serde_json::from_value(value.clone())?),
        "period_close_review" => Input::Close(serde_json::from_value(value.clone())?),
        "expense_evidence_review" => Input::Expense(serde_json::from_value(value.clone())?),
        "finance_variance_review" => Input::Variance(serde_json::from_value(value.clone())?),
        _ => anyhow::bail!("unsupported finance skill"),
    };
    let query = match &result {
        Input::Report(r) => {
            validate_date(&r.date)?;
            validate_timezone(&r.timezone)?;
            &r.query
        }
        Input::Bank(r) => {
            ensure!(r.statement_id > 0, "statementId is required");
            &r.query
        }
        Input::Close(r) => {
            ensure!(r.period_id > 0, "periodId is required");
            &r.query
        }
        Input::Expense(r) => {
            ensure!(r.record_id > 0, "recordId is required");
            &r.query
        }
        Input::Variance(r) => {
            validate_date(&r.actual_date)?;
            validate_date(&r.baseline_date)?;
            validate_timezone(&r.timezone)?;
            ensure!(
                r.actual_date != r.baseline_date,
                "comparison dates must differ"
            );
            &r.query
        }
    };
    ensure!(
        query
            .as_ref()
            .is_none_or(|q| !q.trim().is_empty() && q.len() <= 5_000),
        "query must be bounded and nonempty when supplied"
    );
    Ok(result)
}

fn validate_timezone(value: &str) -> Result<()> {
    ensure!(
        !value.is_empty() && value.len() <= 64 && !value.chars().any(char::is_control),
        "invalid timezone"
    );
    Ok(())
}
fn validate_date(value: &str) -> Result<()> {
    let d = chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")?;
    ensure!(d.to_string() == value, "invalid calendar date");
    Ok(())
}

/// Source IDs and versions refer to the immutable observation, never a live refetch.
pub fn passage(
    key: &str,
    organization_id: u64,
    company_id: u64,
    run_id: u64,
    observation: Value,
) -> Result<Value> {
    skill(key)?;
    ensure!(
        organization_id > 0 && company_id > 0 && run_id > 0,
        "admitted scope is required"
    );
    let text = serde_json::to_string(
        &json!({ "organizationId": organization_id, "companyId": company_id, "runId": run_id, "skillKey": key, "observation": observation }),
    )?;
    ensure!(
        text.len() <= MAX_BYTES,
        "finance observation exceeds its byte bound"
    );
    use sha2::{Digest, Sha256};
    Ok(
        json!({"kind":"finance_review_snapshot", "id":format!("run:{run_id}:finance_review:{key}"), "source_version":format!("{:x}", Sha256::digest(text.as_bytes())), "passage_key":"result", "text":text}),
    )
}

/// Execute the same deterministic projection against worker-pinned synthetic
/// owner inputs. Used only by certification; source observations are not expected
/// fixture output and cannot invoke a network or mutation.
pub fn fixture_observation(
    key: &str,
    organization: u64,
    company: u64,
    input: &Value,
    sources: &Value,
) -> Result<Value> {
    let rows = |name: &str| -> Result<&[Value]> {
        sources
            .get(name)
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .context(format!("fixture source {name} missing"))
    };
    match parse_input(key, input)? {
        Input::Report(_) => Ok(sources
            .get("preview")
            .context("fixture preview missing")?
            .clone()),
        Input::Bank(p) => reviews::reconciliation(
            organization,
            company,
            p.statement_id,
            rows("statements")?,
            rows("lines")?,
            rows("candidates")?,
            rows("invoices")?,
            rows("payments")?,
        ),
        Input::Close(p) => reviews::close_readiness(
            organization,
            company,
            p.period_id,
            rows("periods")?,
            rows("moves")?,
            rows("statements")?,
            rows("lines")?,
        ),
        Input::Expense(p) => {
            let record = sources.get("record").context("fixture record missing")?;
            reviews::scoped(record, organization, company)?;
            ensure!(
                reviews::number(record, "id")? == p.record_id,
                "fixture record mismatch"
            );
            reviews::expense_comparison(
                record,
                sources.get("source").context("fixture source missing")?,
            )
        }
        Input::Variance(_) => reviews::variance(
            sources.get("actual").context("fixture actual missing")?,
            sources
                .get("baseline")
                .context("fixture baseline missing")?,
        ),
    }
}
