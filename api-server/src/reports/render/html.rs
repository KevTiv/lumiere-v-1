//! Shared HTML escaping, shell, tables, and money formatting.
use crate::reports::common::ReportScope;
use crate::reports::daily_business_summary::MoneyAmount;

pub(super) fn render_shell(
    title: &str,
    scope: &ReportScope,
    watermark: &str,
    body: &str,
) -> String {
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

pub(super) fn section(title: &str, inner: impl AsRef<str>) -> String {
    format!(
        "<section><h2>{title}</h2>{inner}</section>",
        title = escape(title),
        inner = inner.as_ref()
    )
}

pub(super) fn summary_line(items: &[(&str, String)]) -> String {
    let parts = items
        .iter()
        .map(|(label, value)| format!("{label}: {value}"))
        .collect::<Vec<_>>()
        .join(" · ");
    format!("<p class=\"summary\">{parts}</p>")
}

pub(super) fn table(rows: &[String]) -> String {
    if rows.is_empty() {
        return "<p class=\"empty\">No rows.</p>".into();
    }
    format!("<table><tbody>{rows}</tbody></table>", rows = rows.join(""))
}

pub(super) fn row(label: &str, value: &str) -> String {
    format!(
        "<tr><th>{label}</th><td>{value}</td></tr>",
        label = escape(label),
        value = escape(value)
    )
}

pub(super) fn format_money(amount: &MoneyAmount) -> String {
    let scale = amount.scale as u32;
    let divisor = 10_i64.pow(scale);
    let negative = amount.minor_units < 0;
    let abs = amount.minor_units.unsigned_abs();
    let major = abs / divisor as u64;
    let minor = abs % divisor as u64;
    let sign = if negative { "-" } else { "" };
    format!("{sign}{major}.{minor:0width$}", width = scale as usize)
}

pub(super) fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
