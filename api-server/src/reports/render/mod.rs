//! Trusted owner-report PDF renderer client.
//!
//! The renderer is a separate Chromium worker. This service sends only HTML
//! assembled from typed server DTOs and never accepts browser/model markup.

mod chromium;
mod commercial;
mod daily_summary;
mod financial;
mod html;
mod inventory;
pub use self::chromium::render_pdf;
use self::commercial::render_commercial;
use self::daily_summary::render_daily_summary;
use self::financial::{render_cash_report, render_customer_balances, render_supplier_payables};
use self::html::format_money;
use self::inventory::{render_low_stock, render_stock_movement};
use super::service::ReportPreview;

fn preview_key(preview: &ReportPreview) -> &'static str {
    match preview {
        ReportPreview::DailyBusinessSummaryV1(_) => "daily-business-summary",
        ReportPreview::CashMobileMoneyV1(_) => "cash-mobile-money",
        ReportPreview::CustomerBalancesV1(_) => "customer-balances",
        ReportPreview::SupplierPayablesV1(_) => "supplier-payables",
        ReportPreview::LowStockV1(_) => "low-stock",
        ReportPreview::StockMovementV1(_) => "stock-movement",
        ReportPreview::SalesByProductV1(_) => "sales-by-product",
        ReportPreview::PurchaseSpendV1(_) => "purchase-spend",
        ReportPreview::PaymentFeeSummaryV1(_) => "payment-fee-summary",
        ReportPreview::MonthlyOwnerReportV1(_) => "monthly-owner-report",
    }
}

fn render_html(preview: &ReportPreview) -> String {
    match preview {
        ReportPreview::DailyBusinessSummaryV1(envelope) => render_daily_summary(
            "Daily Business Summary",
            &envelope.scope,
            &envelope.watermark,
            &envelope.report,
        ),
        ReportPreview::CashMobileMoneyV1(envelope) => render_cash_report(
            "Cash & Mobile Money",
            &envelope.scope,
            &envelope.watermark,
            &envelope.report,
        ),
        ReportPreview::CustomerBalancesV1(envelope) => {
            render_customer_balances(&envelope.scope, &envelope.watermark, &envelope.report)
        }
        ReportPreview::SupplierPayablesV1(envelope) => {
            render_supplier_payables(&envelope.scope, &envelope.watermark, &envelope.report)
        }
        ReportPreview::LowStockV1(envelope) => {
            render_low_stock(&envelope.scope, &envelope.watermark, &envelope.report)
        }
        ReportPreview::StockMovementV1(envelope) => {
            render_stock_movement(&envelope.scope, &envelope.watermark, &envelope.report)
        }
        ReportPreview::SalesByProductV1(envelope) => render_commercial(
            "Sales by Product",
            &envelope.scope,
            &envelope.watermark,
            &format!(
                "Gross sales {} · net sales {} · margin {}",
                format_money(&envelope.report.gross_sales),
                format_money(&envelope.report.net_sales),
                format_money(&envelope.report.margin)
            ),
        ),
        ReportPreview::PurchaseSpendV1(envelope) => render_commercial(
            "Purchase Spend",
            &envelope.scope,
            &envelope.watermark,
            &format!(
                "Purchased {:.2} units · total spend {}",
                envelope.report.quantity_purchased,
                format_money(&envelope.report.total_spend)
            ),
        ),
        ReportPreview::PaymentFeeSummaryV1(envelope) => render_commercial(
            "Payment Fee Summary",
            &envelope.scope,
            &envelope.watermark,
            &format!(
                "{} fee groups · total {}",
                envelope.report.fee_count,
                format_money(&envelope.report.total)
            ),
        ),
        ReportPreview::MonthlyOwnerReportV1(envelope) => render_commercial(
            "Monthly Owner Report",
            &envelope.scope,
            &envelope.watermark,
            &format!(
                "Sales {} · purchase spend {} · payment fees {} · stock movement value {}",
                format_money(&envelope.report.sales),
                format_money(&envelope.report.purchase_spend),
                format_money(&envelope.report.payment_fees),
                format_money(&envelope.report.stock_movement_value)
            ),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::html::escape;
    use super::*;
    use crate::reports::{
        common::ReportScope,
        daily_business_summary::{DailyBusinessSummaryReportV1, MoneyAmount},
    };
    use crate::reports::{
        common::{ReportCurrency, ReportEnvelope, ReportKey, SourceWatermark},
        daily_business_summary::{
            DailyTotals, ExceptionsSummary, ExpensesAndFeesSummary, PurchasesSummary,
            ReceiptsSummary, SalesSummary, StockAlertsSummary,
        },
        financial_position::{CashMobileMoneyReportV1, UnreconciledSummary},
        service::ReportPreview,
    };

    fn scope() -> ReportScope {
        ReportScope {
            organization_id: 1,
            company_id: 7,
            local_date: "2026-07-10".into(),
            date_from: "2026-07-10".into(),
            date_to_exclusive: "2026-07-11".into(),
            timezone: "Africa/Nairobi".into(),
            window_start_utc: "2026-07-09T21:00:00.000Z".into(),
            window_end_utc: "2026-07-10T21:00:00.000Z".into(),
            cutoff_label: "2026-07-10 end of day Africa/Nairobi".into(),
        }
    }

    fn envelope<T>(report_key: ReportKey, report: T) -> ReportEnvelope<T> {
        ReportEnvelope {
            report_key,
            schema_version: 1,
            scope: scope(),
            generated_at: "2026-07-10T12:00:00.000Z".into(),
            generated_by: "test".into(),
            currency: ReportCurrency {
                currency_id: 1,
                minor_unit_scale: 2,
            },
            source_watermark: SourceWatermark {
                accounting_cutoff: "2026-07-10T21:00:00.000Z".into(),
                window_start_utc: "2026-07-09T21:00:00.000Z".into(),
                window_end_utc: "2026-07-10T21:00:00.000Z".into(),
                cutoff_label: "2026-07-10 end of day Africa/Nairobi".into(),
                queried_at: "2026-07-10T12:00:00.000Z".into(),
                source_rows: vec![],
            },
            caveats: vec![],
            watermark: "PREVIEW".into(),
            report,
        }
    }

    #[test]
    fn escapes_dynamic_values_before_html_rendering() {
        assert_eq!(escape("<script>'\"&"), "&lt;script&gt;&#39;&quot;&amp;");
    }

    #[test]
    fn daily_summary_html_includes_mandatory_sections() {
        let html = render_html(&ReportPreview::DailyBusinessSummaryV1(envelope(
            ReportKey::DailyBusinessSummaryV1,
            DailyBusinessSummaryReportV1 {
                sales: SalesSummary {
                    order_count: 0,
                    net: MoneyAmount {
                        minor_units: 0,
                        scale: 2,
                    },
                    tax: MoneyAmount {
                        minor_units: 0,
                        scale: 2,
                    },
                    gross: MoneyAmount {
                        minor_units: 0,
                        scale: 2,
                    },
                    lines: vec![],
                },
                receipts: ReceiptsSummary {
                    receipt_count: 0,
                    receipt_total: MoneyAmount {
                        minor_units: 0,
                        scale: 2,
                    },
                    disbursement_count: 0,
                    disbursement_total: MoneyAmount {
                        minor_units: 0,
                        scale: 2,
                    },
                    lines: vec![],
                },
                purchases: PurchasesSummary {
                    order_count: 0,
                    net: MoneyAmount {
                        minor_units: 0,
                        scale: 2,
                    },
                    tax: MoneyAmount {
                        minor_units: 0,
                        scale: 2,
                    },
                    gross: MoneyAmount {
                        minor_units: 0,
                        scale: 2,
                    },
                    lines: vec![],
                },
                expenses_and_fees: ExpensesAndFeesSummary {
                    fee_count: 0,
                    fees: MoneyAmount {
                        minor_units: 0,
                        scale: 2,
                    },
                    tax: MoneyAmount {
                        minor_units: 0,
                        scale: 2,
                    },
                    total: MoneyAmount {
                        minor_units: 0,
                        scale: 2,
                    },
                    lines: vec![],
                },
                stock_alerts: StockAlertsSummary {
                    alert_count: 0,
                    lines: vec![],
                },
                exceptions: ExceptionsSummary {
                    count: 0,
                    lines: vec![],
                },
                totals: DailyTotals {
                    sales_gross: MoneyAmount {
                        minor_units: 0,
                        scale: 2,
                    },
                    purchases_gross: MoneyAmount {
                        minor_units: 0,
                        scale: 2,
                    },
                    receipts: MoneyAmount {
                        minor_units: 0,
                        scale: 2,
                    },
                    disbursements: MoneyAmount {
                        minor_units: 0,
                        scale: 2,
                    },
                    fees_and_tax: MoneyAmount {
                        minor_units: 0,
                        scale: 2,
                    },
                    net_cash_flow: MoneyAmount {
                        minor_units: 0,
                        scale: 2,
                    },
                },
            },
        )));
        for section in [
            "Sales",
            "Receipts",
            "Purchases",
            "Expenses &amp; fees",
            "Stock alerts",
            "Exceptions",
            "Totals",
        ] {
            assert!(html.contains(section), "missing section {section}");
        }
    }

    #[test]
    fn cash_report_html_includes_accounts_and_unreconciled_sections() {
        let html = render_html(&ReportPreview::CashMobileMoneyV1(envelope(
            ReportKey::CashMobileMoneyV1,
            CashMobileMoneyReportV1 {
                opening: MoneyAmount {
                    minor_units: 0,
                    scale: 2,
                },
                receipts: MoneyAmount {
                    minor_units: 0,
                    scale: 2,
                },
                disbursements: MoneyAmount {
                    minor_units: 0,
                    scale: 2,
                },
                fees: MoneyAmount {
                    minor_units: 0,
                    scale: 2,
                },
                closing: MoneyAmount {
                    minor_units: 0,
                    scale: 2,
                },
                accounts: vec![],
                providers: vec![],
                unreconciled: UnreconciledSummary {
                    count: 0,
                    lines: vec![],
                },
            },
        )));
        for section in [
            "Opening &amp; closing",
            "Accounts",
            "Providers",
            "Unreconciled",
        ] {
            assert!(html.contains(section), "missing section {section}");
        }
    }
}
