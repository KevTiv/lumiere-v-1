//! `/v1/documents/*` — PDF/CSV/XLSX rendering for financial reports and ERP documents.

use std::io::BufWriter;
use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use printpdf::{BuiltinFont, Mm, PdfDocument};
use rust_xlsxwriter::{Format, Workbook};
use serde::Deserialize;
use serde_json::Value;
use tower_cookies::Cookies;

use crate::error::ApiError;
use crate::query_exec::execute_resource_query;
use crate::session::ApiSession;
use crate::state::AppState;
use crate::web_session::{require_org, resolve_session};

#[derive(Debug, Deserialize)]
struct PdfFormatQuery {
    format: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PivotTableBody {
    title: String,
    headers: Vec<String>,
    rows: Vec<Vec<serde_json::Value>>,
}

fn pivot_table_xlsx_bytes(
    title: &str,
    headers: &[String],
    rows: &[Vec<Value>],
) -> Result<Vec<u8>, ApiError> {
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    worksheet
        .set_name(if title.len() > 31 {
            &title[..31]
        } else {
            title
        })
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    let header = Format::new().set_bold();
    for (col, label) in headers.iter().enumerate() {
        worksheet
            .write_string_with_format(0, col as u16, label, &header)
            .map_err(|e| ApiError::Internal(e.to_string()))?;
    }
    for (row_idx, row) in rows.iter().enumerate() {
        let r = (row_idx + 1) as u32;
        for (col_idx, cell) in row.iter().enumerate() {
            match cell {
                Value::Number(n) => {
                    if let Some(f) = n.as_f64() {
                        worksheet
                            .write_number(r, col_idx as u16, f)
                            .map_err(|e| ApiError::Internal(e.to_string()))?;
                    } else if let Some(i) = n.as_i64() {
                        worksheet
                            .write_number(r, col_idx as u16, i as f64)
                            .map_err(|e| ApiError::Internal(e.to_string()))?;
                    } else {
                        worksheet
                            .write_string(r, col_idx as u16, n.to_string())
                            .map_err(|e| ApiError::Internal(e.to_string()))?;
                    }
                }
                Value::String(s) => {
                    worksheet
                        .write_string(r, col_idx as u16, s)
                        .map_err(|e| ApiError::Internal(e.to_string()))?;
                }
                Value::Bool(b) => {
                    worksheet
                        .write_string(r, col_idx as u16, if *b { "true" } else { "false" })
                        .map_err(|e| ApiError::Internal(e.to_string()))?;
                }
                _ => {
                    worksheet
                        .write_string(r, col_idx as u16, cell.to_string())
                        .map_err(|e| ApiError::Internal(e.to_string()))?;
                }
            }
        }
    }
    workbook
        .save_to_buffer()
        .map_err(|e| ApiError::Internal(e.to_string()))
}

async fn pivot_table_xlsx(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<PivotTableBody>,
) -> Result<Response, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let _org_id = require_org(&session)?;
    if body.headers.is_empty() {
        return Err(ApiError::Unprocessable("Pivot headers are required".into()));
    }
    let bytes = pivot_table_xlsx_bytes(&body.title, &body.headers, &body.rows)?;
    let slug = body
        .title
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect::<String>()
        .to_lowercase();
    attachment_response(
        format!("{slug}.xlsx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes,
    )
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .merge(crate::document_blobs::blob_router())
        .route(
            "/documents/pdf/financial-report/:report_id",
            get(financial_report_pdf),
        )
        .route(
            "/documents/csv/financial-report/:report_id",
            get(financial_report_csv),
        )
        .route(
            "/documents/xlsx/financial-report/:report_id",
            get(financial_report_xlsx),
        )
        .route("/documents/xlsx/pivot-table", post(pivot_table_xlsx))
        .route("/documents/pdf/sale-order/:order_id", get(sale_order_pdf))
        .route(
            "/documents/pdf/account-move/:move_id",
            get(account_move_pdf),
        )
}

fn row_id(row: &Value) -> Option<u64> {
    row.get("id")
        .and_then(|v| v.as_u64())
        .or_else(|| row.get("id").and_then(|v| v.as_str())?.parse().ok())
}

fn row_report_id(row: &Value) -> Option<u64> {
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

fn row_f64(row: &Value, keys: &[&str]) -> f64 {
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

fn row_str<'a>(row: &'a Value, keys: &[&str]) -> &'a str {
    for key in keys {
        if let Some(v) = row.get(*key).and_then(|v| v.as_str()) {
            if !v.is_empty() {
                return v;
            }
        }
    }
    "-"
}

async fn load_financial_report(
    state: &AppState,
    session: &ApiSession,
    report_id: u64,
) -> Result<(Value, Vec<Value>), ApiError> {
    let org_id = require_org(session)?;
    let client = state.client_with_token(&session.stdb_token);
    let reports = execute_resource_query(
        &client,
        "financial-reports",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;
    let report = reports
        .into_iter()
        .find(|row| row_id(row) == Some(report_id))
        .ok_or_else(|| ApiError::NotFound(format!("financial report {report_id} not found")))?;

    let trial_rows = execute_resource_query(
        &client,
        "trial-balances",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?
    .into_iter()
    .filter(|row| row_report_id(row) == Some(report_id))
    .collect();

    Ok((report, trial_rows))
}

fn vat_report_lines(report: &Value) -> Vec<String> {
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

fn financial_report_lines(report: &Value, trial_rows: &[Value]) -> Vec<String> {
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

fn trial_balance_csv(report: &Value, trial_rows: &[Value]) -> String {
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

fn trial_balance_xlsx(report: &Value, trial_rows: &[Value]) -> Result<Vec<u8>, ApiError> {
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    worksheet
        .set_name("Trial Balance")
        .map_err(|e| ApiError::Internal(e.to_string()))?;
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
            .map_err(|e| ApiError::Internal(e.to_string()))?;
    }
    for (idx, row) in trial_rows.iter().enumerate() {
        let r = (idx + 1) as u32;
        worksheet
            .write_string(r, 0, row_str(row, &["accountCode", "account_code"]))
            .map_err(|e| ApiError::Internal(e.to_string()))?;
        worksheet
            .write_string(r, 1, row_str(row, &["accountName", "account_name"]))
            .map_err(|e| ApiError::Internal(e.to_string()))?;
        worksheet
            .write_number(r, 2, row_f64(row, &["periodDebit", "period_debit"]))
            .map_err(|e| ApiError::Internal(e.to_string()))?;
        worksheet
            .write_number(r, 3, row_f64(row, &["periodCredit", "period_credit"]))
            .map_err(|e| ApiError::Internal(e.to_string()))?;
        worksheet
            .write_number(r, 4, row_f64(row, &["closingDebit", "closing_debit"]))
            .map_err(|e| ApiError::Internal(e.to_string()))?;
        worksheet
            .write_number(r, 5, row_f64(row, &["closingCredit", "closing_credit"]))
            .map_err(|e| ApiError::Internal(e.to_string()))?;
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
            .map_err(|e| ApiError::Internal(e.to_string()))?;
    }
    workbook
        .save_to_buffer()
        .map_err(|e| ApiError::Internal(e.to_string()))
}

fn render_lines_pdf(title: &str, lines: &[String]) -> Vec<u8> {
    let (doc, page1, layer1) = PdfDocument::new(title, Mm(210.0), Mm(297.0), "Layer 1");
    let font = doc
        .add_builtin_font(BuiltinFont::Helvetica)
        .expect("builtin font");
    let layer = doc.get_page(page1).get_layer(layer1);

    layer.use_text(title, 16.0, Mm(15.0), Mm(280.0), &font);

    let mut y = 265.0;
    for line in lines {
        if y < 15.0 {
            break;
        }
        layer.use_text(line, 10.0, Mm(15.0), Mm(y), &font);
        y -= 6.0;
    }

    let mut buf = Vec::new();
    {
        let mut writer = BufWriter::new(&mut buf);
        doc.save(&mut writer).expect("save pdf");
    }
    buf
}

async fn financial_report_pdf(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(report_id): Path<u64>,
    Query(_q): Query<PdfFormatQuery>,
) -> Result<Response, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let (report, trial_rows) = load_financial_report(&state, &session, report_id).await?;
    let title = report
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Financial Report");
    let lines = financial_report_lines(&report, &trial_rows);
    let pdf_bytes = render_lines_pdf(title, &lines);
    let filename = format!("financial-report-{report_id}.pdf");
    attachment_response(filename, "application/pdf", pdf_bytes)
}

async fn financial_report_csv(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(report_id): Path<u64>,
) -> Result<Response, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let (report, trial_rows) = load_financial_report(&state, &session, report_id).await?;
    let csv = trial_balance_csv(&report, &trial_rows);
    attachment_response(
        format!("financial-report-{report_id}.csv"),
        "text/csv; charset=utf-8",
        csv.into_bytes(),
    )
}

async fn financial_report_xlsx(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(report_id): Path<u64>,
) -> Result<Response, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let (report, trial_rows) = load_financial_report(&state, &session, report_id).await?;
    let bytes = trial_balance_xlsx(&report, &trial_rows)?;
    attachment_response(
        format!("financial-report-{report_id}.xlsx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes,
    )
}

fn attachment_response(
    filename: String,
    content_type: &'static str,
    body: Vec<u8>,
) -> Result<Response, ApiError> {
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, HeaderValue::from_static(content_type)),
            (
                header::CONTENT_DISPOSITION,
                HeaderValue::from_str(&format!("attachment; filename=\"{filename}\""))
                    .unwrap_or_else(|_| HeaderValue::from_static("attachment")),
            ),
        ],
        body,
    )
        .into_response())
}

async fn sale_order_pdf(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(order_id): Path<u64>,
) -> Result<Response, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;

    let client = state.client_with_token(&session.stdb_token);
    let orders = execute_resource_query(
        &client,
        "sale-orders",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;
    let order = orders
        .into_iter()
        .find(|row| row_id(row) == Some(order_id))
        .ok_or_else(|| ApiError::NotFound(format!("sale order {order_id} not found")))?;

    let name = order
        .get("origin")
        .or_else(|| order.get("clientOrderRef"))
        .or_else(|| order.get("client_order_ref"))
        .and_then(|v| v.as_str())
        .unwrap_or("Sale Order");
    let amount = order
        .get("amountTotal")
        .or_else(|| order.get("amount_total"))
        .map(|v| v.to_string())
        .unwrap_or_else(|| "0".to_string());
    let state_label = order
        .get("state")
        .map(|v| v.to_string())
        .unwrap_or_else(|| "Draft".to_string());

    let lines = vec![
        format!("Sale Order: {name}"),
        format!("State: {state_label}"),
        format!("Total: {amount}"),
        String::new(),
        "Line items are available in the ERP record.".to_string(),
    ];

    let pdf_bytes = render_lines_pdf(name, &lines);
    attachment_response(
        format!("sale-order-{order_id}.pdf"),
        "application/pdf",
        pdf_bytes,
    )
}

async fn account_move_pdf(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(move_id): Path<u64>,
) -> Result<Response, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;

    let client = state.client_with_token(&session.stdb_token);
    let moves = execute_resource_query(
        &client,
        "account-moves",
        org_id,
        &session.identity_hex,
        session.field_access.as_ref(),
    )
    .await?;
    let mv = moves
        .into_iter()
        .find(|row| row_id(row) == Some(move_id))
        .ok_or_else(|| ApiError::NotFound(format!("account move {move_id} not found")))?;

    let name = mv.get("name").and_then(|v| v.as_str()).unwrap_or("Invoice");
    let amount = mv
        .get("amountTotal")
        .or_else(|| mv.get("amount_total"))
        .map(|v| v.to_string())
        .unwrap_or_else(|| "0".to_string());
    let move_type = mv
        .get("moveType")
        .or_else(|| mv.get("move_type"))
        .map(|v| v.to_string())
        .unwrap_or_else(|| "Entry".to_string());

    let lines = vec![
        format!("Document: {name}"),
        format!("Type: {move_type}"),
        format!("Total: {amount}"),
        String::new(),
        "Generated from Lumiere ERP document pipeline.".to_string(),
    ];

    let pdf_bytes = render_lines_pdf(name, &lines);
    attachment_response(
        format!("account-move-{move_id}.pdf"),
        "application/pdf",
        pdf_bytes,
    )
}
