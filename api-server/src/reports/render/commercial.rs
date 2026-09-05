use crate::reports::{
    common::ReportScope,
    daily_business_summary::{ExpensesAndFeesSummary, PurchasesSummary, SalesSummary},
};

use super::html::{escape, format_money, render_shell, row, section, summary_line, table};

/// Commercial report rendering.

pub(super) fn render_commercial(
    title: &str,
    scope: &ReportScope,
    watermark: &str,
    summary: &str,
) -> String {
    render_shell(
        title,
        scope,
        watermark,
        &format!("<h2>{}</h2><p>{}</p>", escape(title), escape(summary)),
    )
}

pub(super) fn render_sales_section(sales: &SalesSummary) -> String {
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

pub(super) fn render_purchases_section(purchases: &PurchasesSummary) -> String {
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

pub(super) fn render_fees_section(fees: &ExpensesAndFeesSummary) -> String {
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
