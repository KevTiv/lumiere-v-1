//! CSV serialization for trial-balance exports.

use serde_json::Value;

use super::financial::{row_f64, row_str};

pub(crate) fn trial_balance_csv(report: &Value, trial_rows: &[Value]) -> String {
    let mut out = String::from(
        "account_code,account_name,period_debit,period_credit,closing_debit,closing_credit\n",
    );
    for row in trial_rows {
        out.push_str(&format!(
            "{},{},{:.2},{:.2},{:.2},{:.2}\n",
            row_str(row, &["accountCode", "account_code"]),
            row_str(row, &["accountName", "account_name"]),
            row_f64(row, &["periodDebit", "period_debit"]),
            row_f64(row, &["periodCredit", "period_credit"]),
            row_f64(row, &["closingDebit", "closing_debit"]),
            row_f64(row, &["closingCredit", "closing_credit"]),
        ));
    }
    if trial_rows.is_empty() {
        if let Some(data_raw) = report.get("report_data").and_then(|v| v.as_str()) {
            out.push_str(&format!(
                "report_data,\"{}\"\n",
                data_raw.replace('"', "\"\"")
            ));
        }
    }
    out
}
