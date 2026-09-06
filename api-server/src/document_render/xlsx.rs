//! XLSX serialization for pivot-table and trial-balance exports.

use rust_xlsxwriter::{Format, Workbook};
use serde_json::Value;

use crate::error::ApiError;

use super::financial::{row_f64, row_str};

pub(crate) fn pivot_table_xlsx_bytes(
    title: &str,
    headers: &[String],
    rows: &[Vec<Value>],
) -> Result<Vec<u8>, ApiError> {
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    // Excel bounds names by characters; byte slicing can panic on UTF-8 input.
    let worksheet_name: String = title.chars().take(31).collect();
    worksheet
        .set_name(&worksheet_name)
        .map_err(ApiError::internal)?;
    let header = Format::new().set_bold();
    for (col, label) in headers.iter().enumerate() {
        worksheet
            .write_string_with_format(0, col as u16, label, &header)
            .map_err(ApiError::internal)?;
    }
    for (row_idx, row) in rows.iter().enumerate() {
        let r = (row_idx + 1) as u32;
        for (col_idx, cell) in row.iter().enumerate() {
            match cell {
                Value::Number(n) => {
                    if let Some(f) = n.as_f64() {
                        worksheet
                            .write_number(r, col_idx as u16, f)
                            .map_err(ApiError::internal)?;
                    } else if let Some(i) = n.as_i64() {
                        worksheet
                            .write_number(r, col_idx as u16, i as f64)
                            .map_err(ApiError::internal)?;
                    } else {
                        worksheet
                            .write_string(r, col_idx as u16, n.to_string())
                            .map_err(ApiError::internal)?;
                    }
                }
                Value::String(s) => {
                    worksheet
                        .write_string(r, col_idx as u16, s)
                        .map_err(ApiError::internal)?;
                }
                Value::Bool(b) => {
                    worksheet
                        .write_string(r, col_idx as u16, if *b { "true" } else { "false" })
                        .map_err(ApiError::internal)?;
                }
                _ => {
                    worksheet
                        .write_string(r, col_idx as u16, cell.to_string())
                        .map_err(ApiError::internal)?;
                }
            }
        }
    }
    workbook.save_to_buffer().map_err(ApiError::internal)
}

#[cfg(test)]
mod tests {
    use super::pivot_table_xlsx_bytes;

    #[test]
    fn long_unicode_title_does_not_split_a_code_point() {
        let title = "é".repeat(40);
        let bytes = pivot_table_xlsx_bytes(&title, &["Value".into()], &[])
            .expect("valid Unicode worksheet name");
        assert!(bytes.starts_with(b"PK"));
    }

    #[test]
    fn invalid_worksheet_name_still_returns_an_error() {
        assert!(pivot_table_xlsx_bytes("invalid/name", &[], &[]).is_err());
    }
}

pub(crate) fn trial_balance_xlsx(
    report: &Value,
    trial_rows: &[Value],
) -> Result<Vec<u8>, ApiError> {
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    worksheet
        .set_name("Trial Balance")
        .map_err(ApiError::internal)?;
    let header = Format::new().set_bold();
    let headers = [
        "Account Code",
        "Account Name",
        "Period Debit",
        "Period Credit",
        "Closing Debit",
        "Closing Credit",
    ];
    for (col, title) in headers.iter().enumerate() {
        worksheet
            .write_string_with_format(0, col as u16, *title, &header)
            .map_err(ApiError::internal)?;
    }
    for (idx, row) in trial_rows.iter().enumerate() {
        let r = (idx + 1) as u32;
        worksheet
            .write_string(r, 0, row_str(row, &["accountCode", "account_code"]))
            .map_err(ApiError::internal)?;
        worksheet
            .write_string(r, 1, row_str(row, &["accountName", "account_name"]))
            .map_err(ApiError::internal)?;
        worksheet
            .write_number(r, 2, row_f64(row, &["periodDebit", "period_debit"]))
            .map_err(ApiError::internal)?;
        worksheet
            .write_number(r, 3, row_f64(row, &["periodCredit", "period_credit"]))
            .map_err(ApiError::internal)?;
        worksheet
            .write_number(r, 4, row_f64(row, &["closingDebit", "closing_debit"]))
            .map_err(ApiError::internal)?;
        worksheet
            .write_number(r, 5, row_f64(row, &["closingCredit", "closing_credit"]))
            .map_err(ApiError::internal)?;
    }
    if trial_rows.is_empty() {
        worksheet
            .write_string(
                1,
                0,
                report
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Report"),
            )
            .map_err(ApiError::internal)?;
    }
    workbook.save_to_buffer().map_err(ApiError::internal)
}
