//! Financial report formatting helpers without HTTP or database concerns.

use serde_json::Value;

pub(crate) fn row_id(row: &Value) -> Option<u64> {
    row.get("id")
        .and_then(|v| v.as_u64())
        .or_else(|| row.get("id").and_then(|v| v.as_str())?.parse().ok())
}

pub(crate) fn row_report_id(row: &Value) -> Option<u64> {
    row.get("reportId")
        .or_else(|| row.get("report_id"))
        .and_then(|v| v.as_u64())
        .or_else(|| {
            row.get("reportId")
                .or_else(|| row.get("report_id"))
                .and_then(|v| v.as_str())?
                .parse()
                .ok()
        })
}

pub(crate) fn row_f64(row: &Value, keys: &[&str]) -> f64 {
    for key in keys {
        if let Some(v) = row.get(*key) {
            if let Some(n) = v.as_f64() {
                return n;
            }
            if let Some(s) = v.as_str() {
                if let Ok(n) = s.parse::<f64>() {
                    return n;
                }
            }
        }
    }
    0.0
}

pub(crate) fn row_str<'a>(row: &'a Value, keys: &[&str]) -> &'a str {
    for key in keys {
        if let Some(v) = row.get(*key).and_then(|v| v.as_str()) {
            if !v.is_empty() {
                return v;
            }
        }
    }
    "-"
}

pub(crate) fn vat_report_lines(report: &Value) -> Vec<String> {
    let mut lines = vec![
        format!(
            "Report: {}",
            report
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("VAT Return")
        ),
        String::new(),
    ];
    if let Some(data_raw) = report.get("report_data").and_then(|v| v.as_str()) {
        if let Ok(parsed) = serde_json::from_str::<Value>(data_raw) {
            if let Some(boxes) = parsed.get("boxes").and_then(|v| v.as_object()) {
                for (key, value) in boxes {
                    lines.push(format!("{key}: {value}"));
                }
            }
            if let Some(summary) = parsed.get("summary").and_then(|v| v.as_object()) {
                lines.push(String::new());
                lines.push("Summary".to_string());
                for (key, value) in summary {
                    lines.push(format!("{key}: {value}"));
                }
            }
        }
    }
    lines
}

pub(crate) fn financial_report_lines(report: &Value, trial_rows: &[Value]) -> Vec<String> {
    let report_type = report
        .get("reportType")
        .or_else(|| report.get("report_type"))
        .map(|v| v.to_string())
        .unwrap_or_else(|| "unknown".to_string());

    if report_type.contains("VatReturn") {
        return vat_report_lines(report);
    }

    let mut lines = vec![
        format!(
            "Report: {}",
            report
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Financial Report")
        ),
        format!("Type: {report_type}"),
        String::new(),
        "Account Code | Account Name | Period Debit | Period Credit | Closing Debit | Closing Credit"
            .to_string(),
    ];

    if trial_rows.is_empty() {
        lines.push("No trial balance lines found. Regenerate the report first.".to_string());
        return lines;
    }

    for row in trial_rows.iter().take(200) {
        lines.push(format!(
            "{} | {} | {:.2} | {:.2} | {:.2} | {:.2}",
            row_str(row, &["accountCode", "account_code"]),
            row_str(row, &["accountName", "account_name"]),
            row_f64(row, &["periodDebit", "period_debit"]),
            row_f64(row, &["periodCredit", "period_credit"]),
            row_f64(row, &["closingDebit", "closing_debit"]),
            row_f64(row, &["closingCredit", "closing_credit"]),
        ));
    }

    if let Some(data_raw) = report.get("report_data").and_then(|v| v.as_str()) {
        if let Ok(parsed) = serde_json::from_str::<Value>(data_raw) {
            if let Some(summary) = parsed.get("summary") {
                lines.push(String::new());
                lines.push(format!(
                    "Summary period debit: {:.2}",
                    summary
                        .get("period_debit")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0)
                ));
                lines.push(format!(
                    "Summary period credit: {:.2}",
                    summary
                        .get("period_credit")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0)
                ));
            }
        }
    }

    lines
}
