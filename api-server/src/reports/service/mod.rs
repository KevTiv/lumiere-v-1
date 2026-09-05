//! Typed preview dispatch and report service façade.
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use stdb_client::StdbClient;

use crate::error::ApiError;

use super::{
    catalog::{catalog_entry, ReportAvailability},
    commercial::{
        MonthlyOwnerReportV1, PaymentFeeSummaryReportV1, PurchaseSpendReportV1,
        SalesByProductReportV1,
    },
    common::{ReportEnvelope, ReportKey, ReportPreviewRequest},
    daily_business_summary::DailyBusinessSummaryReportV1,
    financial_position::CashMobileMoneyReportV1,
    low_stock::LowStockReportV1,
    open_balances::{CustomerBalancesReportV1, SupplierPayablesReportV1},
    stock_movement::StockMovementReportV1,
};

const MAX_ROWS_PER_SOURCE: usize = 1_000;
const QUERY_LIMIT: usize = MAX_ROWS_PER_SOURCE + 1;
const PREVIEW_WATERMARK: &str = "PREVIEW — NOT AN ACCOUNTING STATEMENT";

mod commercial;
mod daily_summary;
mod financial;
mod history;
mod inventory;
mod source_queries;

use self::commercial::{
    preview_monthly_owner, preview_payment_fee_summary, preview_purchase_spend,
    preview_sales_by_product,
};
use self::daily_summary::preview_daily_business_summary;
use self::financial::{preview_cash_mobile_money, preview_open_balances};
use self::inventory::{preview_low_stock, preview_stock_movement};

pub use self::history::{report_artifact_key, report_history};
use self::source_queries::{
    query_company, query_typed, scope_for, source_watermark, sql_id_list, validate_request,
};

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
    CashMobileMoneyV1(ReportEnvelope<CashMobileMoneyReportV1>),
    CustomerBalancesV1(ReportEnvelope<CustomerBalancesReportV1>),
    SupplierPayablesV1(ReportEnvelope<SupplierPayablesReportV1>),
    LowStockV1(ReportEnvelope<LowStockReportV1>),
    StockMovementV1(ReportEnvelope<StockMovementReportV1>),
    SalesByProductV1(ReportEnvelope<SalesByProductReportV1>),
    PurchaseSpendV1(ReportEnvelope<PurchaseSpendReportV1>),
    PaymentFeeSummaryV1(ReportEnvelope<PaymentFeeSummaryReportV1>),
    MonthlyOwnerReportV1(ReportEnvelope<MonthlyOwnerReportV1>),
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
        ReportKey::CashMobileMoneyV1 => {
            preview_cash_mobile_money(client, organization_id, identity_hex, request).await
        }
        ReportKey::CustomerBalancesV1 => {
            preview_open_balances(
                client,
                organization_id,
                identity_hex,
                request,
                "OutInvoice",
                ReportKey::CustomerBalancesV1,
            )
            .await
        }
        ReportKey::SupplierPayablesV1 => {
            preview_open_balances(
                client,
                organization_id,
                identity_hex,
                request,
                "InInvoice",
                ReportKey::SupplierPayablesV1,
            )
            .await
        }
        ReportKey::LowStockV1 => {
            preview_low_stock(client, organization_id, identity_hex, request).await
        }
        ReportKey::StockMovementV1 => {
            preview_stock_movement(client, organization_id, identity_hex, request).await
        }
        ReportKey::SalesByProductV1 => {
            preview_sales_by_product(client, organization_id, identity_hex, request).await
        }
        ReportKey::PurchaseSpendV1 => {
            preview_purchase_spend(client, organization_id, identity_hex, request).await
        }
        ReportKey::PaymentFeeSummaryV1 => {
            preview_payment_fee_summary(client, organization_id, identity_hex, request).await
        }
        ReportKey::MonthlyOwnerReportV1 => {
            preview_monthly_owner(client, organization_id, identity_hex, request).await
        }
    }
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

    #[test]
    fn preview_request_rejects_invalid_iana_timezone() {
        let invalid = validate_request(ReportPreviewRequest {
            company_id: 1,
            date: "2026-07-10".into(),
            timezone: "Not/A_Real_Zone".into(),
        });
        assert!(invalid.is_err());
    }
}
