use std::{fmt, str::FromStr};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub enum ReportKey {
    #[serde(rename = "daily_business_summary_v1")]
    DailyBusinessSummaryV1,
    #[serde(rename = "cash_mobile_money_v1")]
    CashMobileMoneyV1,
    #[serde(rename = "customer_balances_v1")]
    CustomerBalancesV1,
    #[serde(rename = "supplier_payables_v1")]
    SupplierPayablesV1,
    #[serde(rename = "low_stock_v1")]
    LowStockV1,
    #[serde(rename = "stock_movement_v1")]
    StockMovementV1,
    #[serde(rename = "sales_by_product_v1")]
    SalesByProductV1,
    #[serde(rename = "purchase_spend_v1")]
    PurchaseSpendV1,
    #[serde(rename = "payment_fee_summary_v1")]
    PaymentFeeSummaryV1,
    #[serde(rename = "monthly_owner_report_v1")]
    MonthlyOwnerReportV1,
}

impl ReportKey {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::DailyBusinessSummaryV1 => "daily_business_summary_v1",
            Self::CashMobileMoneyV1 => "cash_mobile_money_v1",
            Self::CustomerBalancesV1 => "customer_balances_v1",
            Self::SupplierPayablesV1 => "supplier_payables_v1",
            Self::LowStockV1 => "low_stock_v1",
            Self::StockMovementV1 => "stock_movement_v1",
            Self::SalesByProductV1 => "sales_by_product_v1",
            Self::PurchaseSpendV1 => "purchase_spend_v1",
            Self::PaymentFeeSummaryV1 => "payment_fee_summary_v1",
            Self::MonthlyOwnerReportV1 => "monthly_owner_report_v1",
        }
    }
}

impl fmt::Display for ReportKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for ReportKey {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "daily_business_summary_v1" => Ok(Self::DailyBusinessSummaryV1),
            "cash_mobile_money_v1" => Ok(Self::CashMobileMoneyV1),
            "customer_balances_v1" => Ok(Self::CustomerBalancesV1),
            "supplier_payables_v1" => Ok(Self::SupplierPayablesV1),
            "low_stock_v1" => Ok(Self::LowStockV1),
            "stock_movement_v1" => Ok(Self::StockMovementV1),
            "sales_by_product_v1" => Ok(Self::SalesByProductV1),
            "purchase_spend_v1" => Ok(Self::PurchaseSpendV1),
            "payment_fee_summary_v1" => Ok(Self::PaymentFeeSummaryV1),
            "monthly_owner_report_v1" => Ok(Self::MonthlyOwnerReportV1),
            _ => Err(()),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReportPreviewRequest {
    pub company_id: u64,
    pub date: String,
    pub timezone: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportScope {
    pub organization_id: u64,
    pub company_id: u64,
    /// Requested local calendar date (`YYYY-MM-DD`) in `timezone`.
    pub local_date: String,
    pub date_from: String,
    pub date_to_exclusive: String,
    pub timezone: String,
    pub window_start_utc: String,
    pub window_end_utc: String,
    pub cutoff_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportCurrency {
    pub currency_id: u64,
    pub minor_unit_scale: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRowCount {
    pub source: &'static str,
    pub rows: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceWatermark {
    /// Exclusive UTC instant for posted-ledger as-of semantics.
    pub accounting_cutoff: String,
    pub window_start_utc: String,
    pub window_end_utc: String,
    pub cutoff_label: String,
    pub queried_at: String,
    pub source_rows: Vec<SourceRowCount>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportEnvelope<T> {
    pub report_key: ReportKey,
    pub schema_version: u16,
    pub scope: ReportScope,
    pub generated_at: String,
    pub generated_by: String,
    pub currency: ReportCurrency,
    pub source_watermark: SourceWatermark,
    pub caveats: Vec<String>,
    pub watermark: String,
    pub report: T,
}

/// Immutable provenance row for a rendered owner-report artifact.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedOwnerReportHistoryRow {
    pub id: u64,
    pub company_id: u64,
    pub report_key: String,
    pub schema_version: u32,
    pub output_hash: String,
    pub renderer_version: String,
    pub document_id: u64,
    pub correlation_id: String,
    pub generated_at: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct GeneratedOwnerReportArtifactRow {
    pub company_id: u64,
    pub artifact_key: String,
}
