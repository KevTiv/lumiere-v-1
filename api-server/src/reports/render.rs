//! Trusted owner-report PDF renderer client.
//!
//! The renderer is a separate Chromium worker. This service sends only HTML
//! assembled from typed server DTOs and never accepts browser/model markup.

use serde::Serialize;

use crate::{error::ApiError, state::AppState};

use super::{
    common::ReportScope,
    daily_business_summary::{
        DailyBusinessSummaryReportV1, ExpensesAndFeesSummary, MoneyAmount, PurchasesSummary,
        ReceiptsSummary, SalesSummary, StockAlertsSummary,
    },
    financial_position::CashMobileMoneyReportV1,
    low_stock::LowStockReportV1,
    open_balances::{CustomerBalancesReportV1, SupplierPayablesReportV1},
    service::ReportPreview,
    stock_movement::StockMovementReportV1,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChromiumRenderRequest<'a> {
    html: String,
    filename: &'a str,
    media: &'static str,
}

pub async fn render_pdf(state: &AppState, preview: &ReportPreview) -> Result<Vec<u8>, ApiError> {
    let url =
        state.config.report_renderer_url.as_deref().ok_or_else(|| {
            ApiError::Unavailable("owner-report renderer is not configured".into())
        })?;
    let filename = format!("{}.pdf", preview_key(preview));
    let response = state
        .http
        .post(format!("{}/v1/render/pdf", url.trim_end_matches('/')))
        .json(&ChromiumRenderRequest {
            html: render_html(preview),
            filename: &filename,
            media: "print",
        })
        .send()
        .await
        .map_err(|error| {
            ApiError::Unavailable(format!("owner-report renderer request failed: {error}"))
        })?;
    if !response.status().is_success() {
        return Err(ApiError::Unavailable(format!(
            "owner-report renderer returned {}",
            response.status()
        )));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !content_type.starts_with("application/pdf") {
        return Err(ApiError::Internal(
            "owner-report renderer returned a non-PDF response".into(),
        ));
    }
    response
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(|error| ApiError::Unavailable(format!("failed to read rendered PDF: {error}")))
}

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

fn render_commercial(title: &str, scope: &ReportScope, watermark: &str, summary: &str) -> String {
    render_shell(
        title,
        scope,
        watermark,
        &format!("<h2>{}</h2><p>{}</p>", escape(title), escape(summary)),
    )
}

fn render_stock_movement(
    scope: &ReportScope,
    watermark: &str,
    report: &StockMovementReportV1,
) -> String {
    let rows = report
        .lines
        .iter()
        .map(|line| {
            format!(
                "<tr><td>{}</td><td>{}</td><td>{}</td><td>{:.2}</td><td>{}</td></tr>",
                escape(&line.product_name),
                escape(&line.source_location),
                escape(&line.destination_location),
                line.quantity,
                format_money(&line.valuation_reference),
            )
        })
        .collect::<String>();
    let summary = format!(
        "<p>{} completed movements · {:.2} units moved · valuation reference {}</p>",
        report.movement_count,
        report.quantity_moved,
        format_money(&report.valuation_reference),
    );
    let table = if report.lines.is_empty() {
        "<p class=\"empty\">No completed stock movements in this window.</p>".into()
    } else {
        format!("<table><thead><tr><th>Product</th><th>Source</th><th>Destination</th><th>Quantity</th><th>Valuation reference</th></tr></thead><tbody>{rows}</tbody></table>")
    };
    render_shell(
        "Stock Movement Report",
        scope,
        watermark,
        &format!("<h2>Stock movement</h2>{summary}{table}"),
    )
}

fn render_low_stock(scope: &ReportScope, watermark: &str, report: &LowStockReportV1) -> String {
    let rows = report.lines.iter().map(|line| format!(
        "<tr><td>{}</td><td>{}</td><td>{:.2}</td><td>{:.2}</td><td>{:.2}</td><td>{}</td></tr>",
        escape(&line.name), line.sku.as_deref().map(escape).unwrap_or_default(), line.available, line.reorder_point, line.forecast, escape(&line.supplier_hint)
    )).collect::<String>();
    let body = format!("<h2>Low-stock alerts ({})</h2><table><thead><tr><th>Product</th><th>SKU</th><th>Available</th><th>Reorder</th><th>Forecast</th><th>Supplier hint</th></tr></thead><tbody>{rows}</tbody></table>", report.alert_count);
    render_shell("Low Stock Report", scope, watermark, &body)
}

fn render_daily_summary(
    title: &str,
    scope: &ReportScope,
    watermark: &str,
    report: &DailyBusinessSummaryReportV1,
) -> String {
    let mut body = String::new();
    body.push_str(&render_sales_section(&report.sales));
    body.push_str(&render_receipts_section(&report.receipts));
    body.push_str(&render_purchases_section(&report.purchases));
    body.push_str(&render_fees_section(&report.expenses_and_fees));
    body.push_str(&render_stock_section(&report.stock_alerts));
    body.push_str(&render_exceptions_section(report.exceptions.count));
    body.push_str(&render_totals_section(&[
        ("Sales gross", &report.totals.sales_gross),
        ("Purchases gross", &report.totals.purchases_gross),
        ("Receipts", &report.totals.receipts),
        ("Disbursements", &report.totals.disbursements),
        ("Fees & tax", &report.totals.fees_and_tax),
        ("Net cash flow", &report.totals.net_cash_flow),
    ]));
    render_shell(title, scope, watermark, &body)
}

fn render_cash_report(
    title: &str,
    scope: &ReportScope,
    watermark: &str,
    report: &CashMobileMoneyReportV1,
) -> String {
    let mut body = String::new();
    body.push_str(&section(
        "Opening & closing",
        table(&[
            row("Opening", &format_money(&report.opening)),
            row("Receipts", &format_money(&report.receipts)),
            row("Disbursements", &format_money(&report.disbursements)),
            row("Fees", &format_money(&report.fees)),
            row("Closing", &format_money(&report.closing)),
        ]),
    ));
    body.push_str(&section(
        "Accounts",
        table(
            &report
                .accounts
                .iter()
                .map(|line| {
                    row(
                        &format!("{} · {}", line.name, line.provider),
                        &format_money(&line.closing),
                    )
                })
                .collect::<Vec<_>>(),
        ),
    ));
    body.push_str(&section(
        "Providers",
        table(
            &report
                .providers
                .iter()
                .map(|line| row(&line.provider, &format_money(&line.net)))
                .collect::<Vec<_>>(),
        ),
    ));
    body.push_str(&section(
        "Unreconciled",
        table(
            &report
                .unreconciled
                .lines
                .iter()
                .map(|line| {
                    row(
                        line.reference_masked
                            .as_deref()
                            .unwrap_or(&format!("Txn #{}", line.payment_transaction_id)),
                        &format_money(&line.amount),
                    )
                })
                .collect::<Vec<_>>(),
        ),
    ));
    render_shell(title, scope, watermark, &body)
}

fn render_customer_balances(
    scope: &ReportScope,
    watermark: &str,
    report: &CustomerBalancesReportV1,
) -> String {
    let mut body = String::new();
    body.push_str(&render_open_balance_summary(
        report.total_open,
        report.overdue,
        report.current,
    ));
    body.push_str(&render_due_buckets(&report.due_buckets));
    body.push_str(&section(
        "Credit status",
        table(&[
            row(
                "Within limit",
                &report.credit_status.within_limit.to_string(),
            ),
            row("Over limit", &report.credit_status.over_limit.to_string()),
            row("Unknown", &report.credit_status.unknown.to_string()),
        ]),
    ));
    body.push_str(&render_open_balance_lines(&report.lines));
    render_shell("Customer Balances", scope, watermark, &body)
}

fn render_supplier_payables(
    scope: &ReportScope,
    watermark: &str,
    report: &SupplierPayablesReportV1,
) -> String {
    let mut body = String::new();
    body.push_str(&render_open_balance_summary(
        report.total_open,
        report.overdue,
        report.current,
    ));
    body.push_str(&render_due_buckets(&report.due_buckets));
    body.push_str(&section(
        "Paid & planned",
        table(&[
            row("Paid amounts", &format_money(&report.paid_amounts)),
            row("Planned amounts", &format_money(&report.planned_amounts)),
        ]),
    ));
    body.push_str(&render_open_balance_lines(&report.lines));
    render_shell("Supplier Payables", scope, watermark, &body)
}

fn render_open_balance_summary(
    total_open: MoneyAmount,
    overdue: MoneyAmount,
    current: MoneyAmount,
) -> String {
    section(
        "Summary",
        table(&[
            row("Total open", &format_money(&total_open)),
            row("Overdue", &format_money(&overdue)),
            row("Current", &format_money(&current)),
        ]),
    )
}

fn render_due_buckets(buckets: &[super::open_balances::DueBucketSummary]) -> String {
    if buckets.is_empty() {
        return section("Due buckets", "<p class=\"empty\">No overdue buckets.</p>");
    }
    section(
        "Due buckets",
        table(
            &buckets
                .iter()
                .map(|bucket| row(&bucket.label, &format_money(&bucket.amount)))
                .collect::<Vec<_>>(),
        ),
    )
}

fn render_open_balance_lines(lines: &[super::open_balances::OpenBalanceLine]) -> String {
    if lines.is_empty() {
        return section("Open items", "<p class=\"empty\">No open balances.</p>");
    }
    let rows = lines
        .iter()
        .map(|line| {
            row(
                &line
                    .partner_display_name
                    .clone()
                    .unwrap_or_else(|| format!("Partner #{}", line.partner_id.unwrap_or_default())),
                &format!(
                    "{} due · paid {} · residual {}",
                    line.due_date.as_deref().unwrap_or("—"),
                    format_money(&line.paid_amount),
                    format_money(&line.residual)
                ),
            )
        })
        .collect::<Vec<_>>();
    section("Open items", &table(&rows))
}

fn render_sales_section(sales: &SalesSummary) -> String {
    let rows = sales
        .lines
        .iter()
        .map(|line| {
            row(
                &format!("Order #{}", line.order_id),
                &format!(
                    "net {} · tax {} · gross {}",
                    format_money(&line.net),
                    format_money(&line.tax),
                    format_money(&line.gross)
                ),
            )
        })
        .collect::<Vec<_>>();
    section(
        "Sales",
        &format!(
            "{summary}{table}",
            summary = summary_line(&[
                ("Orders", sales.order_count.to_string()),
                ("Net", format_money(&sales.net)),
                ("Tax", format_money(&sales.tax)),
                ("Gross", format_money(&sales.gross)),
            ]),
            table = table(&rows)
        ),
    )
}

fn render_receipts_section(receipts: &ReceiptsSummary) -> String {
    let rows = receipts
        .lines
        .iter()
        .map(|line| {
            row(
                &format!("Txn #{} · {:?}", line.transaction_id, line.direction),
                &format_money(&line.amount),
            )
        })
        .collect::<Vec<_>>();
    section(
        "Receipts",
        &format!(
            "{summary}{table}",
            summary = summary_line(&[
                ("Receipts", receipts.receipt_count.to_string()),
                ("Receipt total", format_money(&receipts.receipt_total)),
                ("Disbursements", receipts.disbursement_count.to_string()),
                (
                    "Disbursement total",
                    format_money(&receipts.disbursement_total),
                ),
            ]),
            table = table(&rows)
        ),
    )
}

fn render_purchases_section(purchases: &PurchasesSummary) -> String {
    let rows = purchases
        .lines
        .iter()
        .map(|line| {
            row(
                &format!("PO #{}", line.order_id),
                &format!(
                    "net {} · tax {} · gross {}",
                    format_money(&line.net),
                    format_money(&line.tax),
                    format_money(&line.gross)
                ),
            )
        })
        .collect::<Vec<_>>();
    section(
        "Purchases",
        &format!(
            "{summary}{table}",
            summary = summary_line(&[
                ("Orders", purchases.order_count.to_string()),
                ("Net", format_money(&purchases.net)),
                ("Tax", format_money(&purchases.tax)),
                ("Gross", format_money(&purchases.gross)),
            ]),
            table = table(&rows)
        ),
    )
}

fn render_fees_section(fees: &ExpensesAndFeesSummary) -> String {
    let rows = fees
        .lines
        .iter()
        .map(|line| {
            row(
                &format!("Fee #{} · txn {}", line.fee_id, line.payment_transaction_id),
                &format!(
                    "fee {} · tax {} · total {}",
                    format_money(&line.fee),
                    format_money(&line.tax),
                    format_money(&line.total)
                ),
            )
        })
        .collect::<Vec<_>>();
    section(
        "Expenses & fees",
        &format!(
            "{summary}{table}",
            summary = summary_line(&[
                ("Fee rows", fees.fee_count.to_string()),
                ("Fees", format_money(&fees.fees)),
                ("Tax", format_money(&fees.tax)),
                ("Total", format_money(&fees.total)),
            ]),
            table = table(&rows)
        ),
    )
}

fn render_stock_section(stock: &StockAlertsSummary) -> String {
    let rows = stock
        .lines
        .iter()
        .map(|line| {
            row(
                &format!("Product #{}", line.product_id),
                &format!(
                    "on hand {} · reserved {} · available {}{}",
                    line.on_hand,
                    line.reserved,
                    line.available,
                    if line.outdated { " · outdated" } else { "" }
                ),
            )
        })
        .collect::<Vec<_>>();
    section(
        "Stock alerts",
        &format!(
            "{summary}{table}",
            summary = summary_line(&[("Alerts", stock.alert_count.to_string())]),
            table = table(&rows)
        ),
    )
}

fn render_exceptions_section(count: usize) -> String {
    section(
        "Exceptions",
        &format!("<p class=\"summary\">Excluded or cross-currency rows: {count}</p>"),
    )
}

fn render_totals_section(rows: &[(&str, &MoneyAmount)]) -> String {
    section(
        "Totals",
        &table(
            &rows
                .iter()
                .map(|(label, amount)| row(label, &format_money(amount)))
                .collect::<Vec<_>>(),
        ),
    )
}

fn render_shell(title: &str, scope: &ReportScope, watermark: &str, body: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{title}</title><style>\
        body{{font:13px/1.45 system-ui,sans-serif;color:#111;margin:28px}}\
        h1{{font-size:24px;margin:0 0 8px}}\
        h2{{font-size:16px;margin:24px 0 8px;border-bottom:1px solid #d1d5db;padding-bottom:4px}}\
        table{{border-collapse:collapse;width:100%;margin-top:8px}}\
        th,td{{border:1px solid #d1d5db;padding:8px;text-align:left;vertical-align:top}}\
        th{{background:#f3f4f6;width:34%}}\
        .meta{{color:#4b5563;margin-bottom:16px}}\
        .watermark{{color:#991b1b;font-weight:600;margin-bottom:20px}}\
        .summary{{color:#374151;margin:0 0 8px}}\
        .empty{{color:#6b7280;font-style:italic}}\
        </style></head><body>\
        <h1>{title}</h1>\
        <p class=\"meta\">Company {company} · {from} to {to} · {timezone}<br>{cutoff}</p>\
        <p class=\"watermark\">{watermark}</p>\
        {body}\
        </body></html>",
        title = escape(title),
        company = escape(&scope.company_id.to_string()),
        from = escape(&scope.date_from),
        to = escape(&scope.date_to_exclusive),
        timezone = escape(&scope.timezone),
        cutoff = escape(&scope.cutoff_label),
        watermark = escape(watermark),
        body = body,
    )
}

fn section(title: &str, inner: impl AsRef<str>) -> String {
    format!(
        "<section><h2>{title}</h2>{inner}</section>",
        title = escape(title),
        inner = inner.as_ref()
    )
}

fn summary_line(items: &[(&str, String)]) -> String {
    let parts = items
        .iter()
        .map(|(label, value)| format!("{label}: {value}"))
        .collect::<Vec<_>>()
        .join(" · ");
    format!("<p class=\"summary\">{parts}</p>")
}

fn table(rows: &[String]) -> String {
    if rows.is_empty() {
        return "<p class=\"empty\">No rows.</p>".into();
    }
    format!("<table><tbody>{rows}</tbody></table>", rows = rows.join(""))
}

fn row(label: &str, value: &str) -> String {
    format!(
        "<tr><th>{label}</th><td>{value}</td></tr>",
        label = escape(label),
        value = escape(value)
    )
}

fn format_money(amount: &MoneyAmount) -> String {
    let scale = amount.scale as u32;
    let divisor = 10_i64.pow(scale);
    let negative = amount.minor_units < 0;
    let abs = amount.minor_units.unsigned_abs();
    let major = abs / divisor as u64;
    let minor = abs % divisor as u64;
    let sign = if negative { "-" } else { "" };
    format!("{sign}{major}.{minor:0width$}", width = scale as usize)
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use super::*;
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
