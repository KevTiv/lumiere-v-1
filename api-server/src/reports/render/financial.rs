use crate::reports::{
    common::ReportScope,
    daily_business_summary::MoneyAmount,
    financial_position::CashMobileMoneyReportV1,
    open_balances::{CustomerBalancesReportV1, SupplierPayablesReportV1},
};

use super::html::{format_money, render_shell, row, section, table};

/// Financial report rendering.

pub(super) fn render_cash_report(
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

pub(super) fn render_customer_balances(
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

pub(super) fn render_supplier_payables(
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

pub(super) fn render_open_balance_summary(
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

pub(super) fn render_due_buckets(
    buckets: &[crate::reports::open_balances::DueBucketSummary],
) -> String {
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

pub(super) fn render_open_balance_lines(
    lines: &[crate::reports::open_balances::OpenBalanceLine],
) -> String {
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

pub(super) fn render_totals_section(rows: &[(&str, &MoneyAmount)]) -> String {
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
