use crate::reports::{
    common::ReportScope, daily_business_summary::StockAlertsSummary, low_stock::LowStockReportV1,
    stock_movement::StockMovementReportV1,
};

use super::html::{escape, format_money, render_shell, row, section, summary_line, table};

/// Inventory report rendering.

pub(super) fn render_stock_movement(
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

pub(super) fn render_low_stock(
    scope: &ReportScope,
    watermark: &str,
    report: &LowStockReportV1,
) -> String {
    let rows = report.lines.iter().map(|line| format!(
        "<tr><td>{}</td><td>{}</td><td>{:.2}</td><td>{:.2}</td><td>{:.2}</td><td>{}</td></tr>",
        escape(&line.name), line.sku.as_deref().map(escape).unwrap_or_default(), line.available, line.reorder_point, line.forecast, escape(&line.supplier_hint)
    )).collect::<String>();
    let body = format!("<h2>Low-stock alerts ({})</h2><table><thead><tr><th>Product</th><th>SKU</th><th>Available</th><th>Reorder</th><th>Forecast</th><th>Supplier hint</th></tr></thead><tbody>{rows}</tbody></table>", report.alert_count);
    render_shell("Low Stock Report", scope, watermark, &body)
}

pub(super) fn render_stock_section(stock: &StockAlertsSummary) -> String {
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
