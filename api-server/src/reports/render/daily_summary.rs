use crate::reports::{
    common::ReportScope,
    daily_business_summary::{DailyBusinessSummaryReportV1, ReceiptsSummary},
};

use super::commercial::{render_fees_section, render_purchases_section, render_sales_section};
use super::financial::render_totals_section;
use super::html::{format_money, render_shell, row, section, summary_line, table};
use super::inventory::render_stock_section;

/// Daily Summary report rendering.

pub(super) fn render_daily_summary(
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

pub(super) fn render_receipts_section(receipts: &ReceiptsSummary) -> String {
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

pub(super) fn render_exceptions_section(count: usize) -> String {
    section(
        "Exceptions",
        &format!("<p class=\"summary\">Excluded or cross-currency rows: {count}</p>"),
    )
}
