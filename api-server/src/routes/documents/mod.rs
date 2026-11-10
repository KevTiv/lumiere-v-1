//! `/v1/documents/*` — PDF/CSV/XLSX rendering for financial reports and ERP documents.

use std::sync::Arc;

use crate::state::AppState;
use axum::{
    extract::DefaultBodyLimit,
    routing::{get, post},
    Router,
};

pub(crate) mod accounting;
mod attachment;
mod financial;
mod pivot;
mod quotations;
mod retention;
mod sales;
mod selection_evidence;
mod spreadsheet;

use self::accounting::account_move_pdf;
use self::attachment::attachment_response;
use self::financial::{financial_report_csv, financial_report_pdf, financial_report_xlsx};
use self::pivot::pivot_table_xlsx;
use self::sales::sale_order_pdf;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/documents/spreadsheet/selection-evidence",
            post(selection_evidence::read).layer(DefaultBodyLimit::max(8192)),
        )
        .merge(crate::document_blobs::blob_router())
        .route(
            "/documents/spreadsheet/:document_id/:version_id",
            get(spreadsheet::metadata),
        )
        .route(
            "/documents/spreadsheet/:document_id/:version_id/range",
            get(spreadsheet::range),
        )
        .route(
            "/documents/spreadsheet/:document_id/:version_id/search",
            get(spreadsheet::search),
        )
        .route("/documents/retention/preview", get(retention::preview))
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
            "/documents/quotations/:order_id/preview",
            post(quotations::preview),
        )
        .route(
            "/documents/quotations/:order_id/generate",
            post(quotations::generate),
        )
        .route(
            "/documents/pdf/account-move/:move_id",
            get(account_move_pdf),
        )
}
