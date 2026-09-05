use chrono::{SecondsFormat, Utc};
use stdb_client::StdbClient;

use crate::error::ApiError;

use crate::reports::{
    common::{ReportCurrency, ReportEnvelope, ReportKey, SourceRowCount},
    daily_business_summary::{
        aggregate_daily_business_summary, DailyBusinessSummarySource, FeeSourceRow,
        PaymentSourceRow, PurchaseSourceRow, SaleSourceRow, StockSourceRow,
    },
    timezone::day_window,
};

/// Daily Summary report preview source loading.
use super::{
    query_company, query_typed, scope_for, source_watermark, ReportPreview,
    ValidatedPreviewRequest, PREVIEW_WATERMARK, QUERY_LIMIT,
};

pub(super) async fn preview_daily_business_summary(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    request: ValidatedPreviewRequest,
) -> Result<ReportPreview, ApiError> {
    let company = query_company(client, organization_id, request.company_id).await?;
    let window = day_window(request.date, &request.timezone)?;

    let sale_sql = format!(
        "SELECT id, currency_id, state, amount_untaxed, amount_tax, amount_total FROM sale_order WHERE organization_id = {organization_id} AND company_id = {} AND date_order >= '{}' AND date_order < '{}' LIMIT {QUERY_LIMIT}",
        company.id, window.start_sql, window.end_sql
    );
    let payment_sql = format!(
        "SELECT id, currency_id, direction, status, settlement_amount FROM payment_transaction WHERE organization_id = {organization_id} AND company_id = {} AND occurred_at >= '{}' AND occurred_at < '{}' LIMIT {QUERY_LIMIT}",
        company.id, window.start_sql, window.end_sql
    );
    let purchase_sql = format!(
        "SELECT id, currency_id, state, amount_untaxed, amount_tax, amount_total FROM purchase_order WHERE organization_id = {organization_id} AND company_id = {} AND date_order >= '{}' AND date_order < '{}' LIMIT {QUERY_LIMIT}",
        company.id, window.start_sql, window.end_sql
    );
    let fee_sql = format!(
        "SELECT id, payment_transaction_id, currency_id, amount, tax_amount FROM payment_fee WHERE organization_id = {organization_id} AND company_id = {} AND created_at >= '{}' AND created_at < '{}' LIMIT {QUERY_LIMIT}",
        company.id, window.start_sql, window.end_sql
    );
    let stock_sql = format!(
        "SELECT id, product_id, quantity, reserved_quantity, available_quantity, is_outdated FROM stock_quant WHERE organization_id = {organization_id} AND company_id = {} LIMIT {QUERY_LIMIT}",
        company.id
    );

    let (sales, payments, purchases, fees, stock) = tokio::try_join!(
        query_typed::<SaleSourceRow>(client, "sale_order", sale_sql),
        query_typed::<PaymentSourceRow>(client, "payment_transaction", payment_sql),
        query_typed::<PurchaseSourceRow>(client, "purchase_order", purchase_sql),
        query_typed::<FeeSourceRow>(client, "payment_fee", fee_sql),
        query_typed::<StockSourceRow>(client, "stock_quant", stock_sql),
    )?;

    let source_rows = vec![
        SourceRowCount {
            source: "sale_order",
            rows: sales.len(),
        },
        SourceRowCount {
            source: "payment_transaction",
            rows: payments.len(),
        },
        SourceRowCount {
            source: "purchase_order",
            rows: purchases.len(),
        },
        SourceRowCount {
            source: "payment_fee",
            rows: fees.len(),
        },
        SourceRowCount {
            source: "stock_quant",
            rows: stock.len(),
        },
    ];
    let report = aggregate_daily_business_summary(
        DailyBusinessSummarySource {
            sales,
            payments,
            purchases,
            fees,
            stock,
        },
        company.currency_id,
    );
    let generated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);

    Ok(ReportPreview::DailyBusinessSummaryV1(ReportEnvelope {
        report_key: ReportKey::DailyBusinessSummaryV1,
        schema_version: 1,
        scope: scope_for(&company, &window),
        generated_at: generated_at.clone(),
        generated_by: identity_hex.to_string(),
        currency: ReportCurrency {
            currency_id: company.currency_id,
            minor_unit_scale: 2,
        },
        source_watermark: source_watermark(&window, generated_at, source_rows),
        caveats: vec![
            format!(
                "Company scope validated for {} (company ID {}).",
                company.name, company.id
            ),
            format!(
                "Operational window: {}.",
                window.cutoff_label
            ),
            "Sales and purchases are operational order totals, not posted invoice or ledger totals.".into(),
            "Fees include only fee rows linked to posted payment transactions in the same window.".into(),
            "Stock alerts are a current quant snapshot; available quantity <= 0 or an outdated quant is flagged, and reorder points are not yet applied.".into(),
            "Amounts are normalized to two-decimal minor units; rows in currencies other than the company currency are excluded and listed as exceptions.".into(),
        ],
        watermark: PREVIEW_WATERMARK.into(),
        report,
    }))
}
