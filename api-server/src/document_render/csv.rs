//! CSV serialization for trial-balance exports.

use serde_json::Value;

use super::financial::{row_f64, row_str};

/// Quote every text field and disarm formula-like text for the Excel download
/// profile. Numeric-looking *strings* are also text (account codes can have
/// leading zeroes); real amount columns are serialized separately as numbers.
///
/// The protective tab is part of the CSV value. CSV has no portable cell type,
/// and behavior can differ across spreadsheet applications and save/reopen
/// cycles. The typed XLSX exporter is preferable for exact spreadsheet strings.
fn csv_text_cell(value: &str) -> String {
    let meaningful = value.trim_start_matches(|ch: char| {
        ch.is_whitespace()
            || ch.is_control()
            || matches!(ch, '\u{200b}'..='\u{200f}' | '\u{2060}' | '\u{feff}')
    });
    let formula_prefix = meaningful.starts_with(['=', '+', '-', '@', '|', '＝', '＋', '－', '＠']);
    let numeric_text = meaningful.parse::<f64>().is_ok_and(f64::is_finite);
    let control_prefix = value.chars().next().is_some_and(char::is_control);
    let prefix = if formula_prefix || numeric_text || control_prefix {
        "\t"
    } else {
        ""
    };
    format!("\"{prefix}{}\"", value.replace('"', "\"\""))
}

pub(crate) fn trial_balance_csv(report: &Value, trial_rows: &[Value]) -> String {
    let mut out = String::from(
        "\"account_code\",\"account_name\",\"period_debit\",\"period_credit\",\"closing_debit\",\"closing_credit\"\n",
    );
    for row in trial_rows {
        out.push_str(&format!(
            "{},{},{:.2},{:.2},{:.2},{:.2}\n",
            csv_text_cell(row_str(row, &["accountCode", "account_code"])),
            csv_text_cell(row_str(row, &["accountName", "account_name"])),
            row_f64(row, &["periodDebit", "period_debit"]),
            row_f64(row, &["periodCredit", "period_credit"]),
            row_f64(row, &["closingDebit", "closing_debit"]),
            row_f64(row, &["closingCredit", "closing_credit"]),
        ));
    }
    if trial_rows.is_empty() {
        if let Some(data_raw) = report.get("report_data").and_then(|v| v.as_str()) {
            out.push_str(&format!(
                "{},{}\n",
                csv_text_cell("report_data"),
                csv_text_cell(data_raw),
            ));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn account_text_cannot_create_extra_cells_or_rows() {
        let csv = trial_balance_csv(
            &Value::Null,
            &[json!({
                "accountCode":"Code,\"quoted\"",
                "accountName":"first\nsecond,\"quoted\"",
                "periodDebit":-12.5,
                "closingCredit":30
            })],
        );
        let (headers, rows) = lumiere_file_inspection::parse_csv(&csv).unwrap();
        assert_eq!(headers.len(), 6);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].len(), 6);
        assert_eq!(rows[0][0], "Code,\"quoted\"");
        assert_eq!(rows[0][1], "first\nsecond,\"quoted\"");
        assert_eq!(rows[0][2], "-12.50");
        assert_eq!(rows[0][5], "30.00");
    }

    #[test]
    fn formula_unicode_and_control_prefixes_are_text_inside_quotes() {
        for value in [
            "=HYPERLINK(\"https://example.invalid\",\"click\")",
            "+SUM(A1)",
            "-1+2",
            "@SUM(A1)",
            "\t=1+2",
            "\r\n=1+2",
            "  \u{200b}＝1+2",
            "\u{feff}＋SUM(A1)",
            "|cmd",
        ] {
            let encoded = csv_text_cell(value);
            assert!(encoded.starts_with("\"\t"), "unprotected text: {encoded:?}");
            assert!(encoded.ends_with('"'));
        }
        assert_eq!(csv_text_cell("Ordinary account"), "\"Ordinary account\"");
    }

    #[test]
    fn numeric_account_text_is_protected_without_corrupting_negative_balances() {
        let csv = trial_balance_csv(
            &Value::Null,
            &[json!({
                "accountCode":"001234",
                "accountName":"-42.50",
                "periodDebit":-42.5,
                "periodCredit":12,
                "closingDebit":-9,
                "closingCredit":0
            })],
        );
        assert!(csv.ends_with("\"\t001234\",\"\t-42.50\",-42.50,12.00,-9.00,0.00\n"));
    }

    #[test]
    fn fallback_report_data_uses_the_same_quoted_text_profile() {
        let data = "=1+2,\"quoted\"\nnext";
        let csv = trial_balance_csv(&json!({"report_data":data}), &[]);
        assert!(csv.ends_with(&format!("\"report_data\",{}\n", csv_text_cell(data))));
        let (_, rows) = lumiere_file_inspection::parse_csv(&csv).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0], ["report_data", data]);
    }
}
