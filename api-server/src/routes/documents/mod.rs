//! `/v1/documents/*` — PDF/CSV/XLSX rendering for financial reports and ERP documents.

use std::sync::Arc;

use crate::state::AppState;
use axum::{
    routing::{get, post},
    Router,
};

mod accounting;
mod attachment;
mod financial;
mod pivot;
mod sales;

use self::accounting::account_move_pdf;
use self::attachment::attachment_response;
use self::financial::{financial_report_csv, financial_report_pdf, financial_report_xlsx};
use self::pivot::pivot_table_xlsx;
use self::sales::sale_order_pdf;

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
