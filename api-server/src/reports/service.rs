use chrono::{Days, NaiveDate, SecondsFormat, Utc};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use stdb_client::StdbClient;

use crate::error::ApiError;

use super::{
    catalog::{catalog_entry, ReportAvailability},
    common::{
        ReportCurrency, ReportEnvelope, ReportKey, ReportPreviewRequest, ReportScope,
        SourceRowCount, SourceWatermark,
    },
    daily_business_summary::{
        aggregate_daily_business_summary, DailyBusinessSummaryReportV1, DailyBusinessSummarySource,
        FeeSourceRow, PaymentSourceRow, PurchaseSourceRow, SaleSourceRow, StockSourceRow,
    },
};

const MAX_ROWS_PER_SOURCE: usize = 1_000;
const QUERY_LIMIT: usize = MAX_ROWS_PER_SOURCE + 1;
const PREVIEW_WATERMARK: &str = "PREVIEW — NOT AN ACCOUNTING STATEMENT";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompanyRow {
    id: u64,
    organization_id: u64,
    name: String,
    currency_id: u64,
    deleted_at: Option<serde_json::Value>,
}

#[derive(Debug)]
struct ValidatedPreviewRequest {
    company_id: u64,
    date: NaiveDate,
    timezone: String,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum ReportPreview {
    DailyBusinessSummaryV1(ReportEnvelope<DailyBusinessSummaryReportV1>),
}

pub async fn preview_report(
    client: &StdbClient,
    report_key: ReportKey,
    organization_id: u64,
    identity_hex: &str,
    request: ReportPreviewRequest,
) -> Result<ReportPreview, ApiError> {
    let entry = catalog_entry(report_key);
    if entry.availability != ReportAvailability::Preview {
        return Err(ApiError::Unprocessable(format!(
            "Report '{report_key}' is catalogued but preview is not available yet"
        )));
    }

    let request = validate_request(request)?;
    match report_key {
        ReportKey::DailyBusinessSummaryV1 => {
            preview_daily_business_summary(client, organization_id, identity_hex, request).await
        }
        _ => unreachable!("availability and report implementation must stay aligned"),
    }
}

async fn preview_daily_business_summary(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    request: ValidatedPreviewRequest,
) -> Result<ReportPreview, ApiError> {
    let company = query_company(client, organization_id, request.company_id).await?;
    let start = request
        .date
        .and_hms_opt(0, 0, 0)
        .expect("midnight is always valid");
    let end_date = request
        .date
        .checked_add_days(Days::new(1))
        .ok_or_else(|| ApiError::BadRequest("Date is outside the supported range".into()))?;
    let end = end_date
        .and_hms_opt(0, 0, 0)
        .expect("midnight is always valid");
    let start_sql = start.format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let end_sql = end.format("%Y-%m-%dT%H:%M:%SZ").to_string();

    let sale_sql = format!(
        "SELECT id, currency_id, state, amount_untaxed, amount_tax, amount_total FROM sale_order WHERE organization_id = {organization_id} AND company_id = {} AND date_order >= '{start_sql}' AND date_order < '{end_sql}' LIMIT {QUERY_LIMIT}",
        company.id
    );
    let payment_sql = format!(
        "SELECT id, currency_id, direction, status, settlement_amount FROM payment_transaction WHERE organization_id = {organization_id} AND company_id = {} AND occurred_at >= '{start_sql}' AND occurred_at < '{end_sql}' LIMIT {QUERY_LIMIT}",
        company.id
    );
    let purchase_sql = format!(
        "SELECT id, currency_id, state, amount_untaxed, amount_tax, amount_total FROM purchase_order WHERE organization_id = {organization_id} AND company_id = {} AND date_order >= '{start_sql}' AND date_order < '{end_sql}' LIMIT {QUERY_LIMIT}",
        company.id
    );
    let fee_sql = format!(
        "SELECT id, payment_transaction_id, currency_id, amount, tax_amount FROM payment_fee WHERE organization_id = {organization_id} AND company_id = {} AND created_at >= '{start_sql}' AND created_at < '{end_sql}' LIMIT {QUERY_LIMIT}",
        company.id
    );
    let stock_sql = format!(
        "SELECT id, product_id, quantity, reserved_quantity, available_quantity, is_outdated FROM stock_quant WHERE organization_id = {organization_id} AND company_id = {} LIMIT {QUERY_LIMIT}",
        company.id
    );

    let (sales, payments, purchases, fees, stock) = tokio::try_join!(
        query_typed::<SaleSourceRow>(client, "sale_order", sale_sql),
        query_typed::<PaymentSourceRow>(client, "payment_transaction", payment_sql),
        query_typed::<PurchaseSourceRow>(client, "purchase_order", purchase_sql),
        query_typed::<FeeSourceRow>(client, "payment_fee", fee_sql),
        query_typed::<StockSourceRow>(client, "stock_quant", stock_sql),
    )?;

    let source_rows = vec![
        SourceRowCount {
            source: "sale_order",
            rows: sales.len(),
        },
        SourceRowCount {
            source: "payment_transaction",
            rows: payments.len(),
        },
        SourceRowCount {
            source: "purchase_order",
            rows: purchases.len(),
        },
        SourceRowCount {
            source: "payment_fee",
            rows: fees.len(),
        },
        SourceRowCount {
            source: "stock_quant",
            rows: stock.len(),
        },
    ];
    let report = aggregate_daily_business_summary(
        DailyBusinessSummarySource {
            sales,
            payments,
            purchases,
            fees,
            stock,
        },
        company.currency_id,
    );
    let generated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);

    Ok(ReportPreview::DailyBusinessSummaryV1(ReportEnvelope {
        report_key: ReportKey::DailyBusinessSummaryV1,
        schema_version: 1,
        scope: ReportScope {
            organization_id: company.organization_id,
            company_id: company.id,
            date_from: request.date.to_string(),
            date_to_exclusive: end_date.to_string(),
            timezone: request.timezone,
        },
        generated_at: generated_at.clone(),
        generated_by: identity_hex.to_string(),
        currency: ReportCurrency {
            currency_id: company.currency_id,
            minor_unit_scale: 2,
        },
        source_watermark: SourceWatermark {
            accounting_cutoff: end_sql,
            queried_at: generated_at,
            source_rows,
        },
        caveats: vec![
            format!(
                "Company scope validated for {} (company ID {}).",
                company.name, company.id
            ),
            "V1 date filtering uses a UTC [start, end) window; the requested timezone is recorded but does not shift the cutoff until the owner-report timezone policy is approved.".into(),
            "Sales and purchases are operational order totals, not posted invoice or ledger totals.".into(),
            "Fees include only fee rows linked to posted payment transactions in the same window.".into(),
            "Stock alerts are a current quant snapshot; available quantity <= 0 or an outdated quant is flagged, and reorder points are not yet applied.".into(),
            "Amounts are normalized to two-decimal minor units; rows in currencies other than the company currency are excluded and listed as exceptions.".into(),
        ],
        watermark: PREVIEW_WATERMARK.into(),
        report,
    }))
}

async fn query_company(
    client: &StdbClient,
    organization_id: u64,
    company_id: u64,
) -> Result<CompanyRow, ApiError> {
    let sql = format!(
        "SELECT id, organization_id, name, currency_id, deleted_at FROM company WHERE id = {company_id} AND organization_id = {organization_id} LIMIT 1"
    );
    query_typed::<CompanyRow>(client, "company", sql)
        .await?
        .into_iter()
        .find(|company| company.deleted_at.is_none())
        .ok_or_else(|| {
            ApiError::Forbidden("Company does not belong to the session organization".into())
        })
}

async fn query_typed<T>(
    client: &StdbClient,
    source: &'static str,
    sql: String,
) -> Result<Vec<T>, ApiError>
where
    T: DeserializeOwned,
{
    let rows = client
        .query_sql(&sql)
        .await
        .map_err(|error| ApiError::Internal(format!("{source} report query: {error}")))?;
    if rows.len() > MAX_ROWS_PER_SOURCE {
        return Err(ApiError::Unprocessable(format!(
            "Report source '{source}' exceeds the {MAX_ROWS_PER_SOURCE}-row preview limit"
        )));
    }
    rows.into_iter()
        .map(|row| {
            serde_json::from_value(row).map_err(|error| {
                ApiError::Internal(format!("invalid typed {source} report row: {error}"))
            })
        })
        .collect()
}

fn validate_request(request: ReportPreviewRequest) -> Result<ValidatedPreviewRequest, ApiError> {
    if request.company_id == 0 {
        return Err(ApiError::BadRequest(
            "companyId must be greater than zero".into(),
        ));
    }
    let date = NaiveDate::parse_from_str(request.date.trim(), "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("date must use YYYY-MM-DD".into()))?;
    let timezone = request.timezone.trim();
    if timezone.is_empty()
        || timezone.len() > 64
        || !timezone.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '/' | '_' | '-' | '+' | ':')
        })
    {
        return Err(ApiError::BadRequest(
            "timezone must be a valid non-empty timezone identifier".into(),
        ));
    }

    Ok(ValidatedPreviewRequest {
        company_id: request.company_id,
        date,
        timezone: timezone.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_request_rejects_extra_scope_and_invalid_values() {
        let extra_scope = serde_json::from_value::<ReportPreviewRequest>(serde_json::json!({
            "organizationId": 9,
            "companyId": 1,
            "date": "2026-07-10",
            "timezone": "Africa/Nairobi"
        }));
        assert!(extra_scope.is_err());

        let invalid = validate_request(ReportPreviewRequest {
            company_id: 1,
            date: "07/10/2026".into(),
            timezone: "Africa/Nairobi' OR 1=1".into(),
        });
        assert!(invalid.is_err());
    }

    #[test]
    fn preview_request_accepts_named_timezone_as_recorded_scope() {
        let request = validate_request(ReportPreviewRequest {
            company_id: 7,
            date: "2026-07-10".into(),
            timezone: "Africa/Nairobi".into(),
        })
        .expect("valid request");

        assert_eq!(request.company_id, 7);
        assert_eq!(request.date.to_string(), "2026-07-10");
        assert_eq!(request.timezone, "Africa/Nairobi");
    }
}
