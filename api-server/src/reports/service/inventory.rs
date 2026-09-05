use chrono::{SecondsFormat, Utc};
use stdb_client::StdbClient;

use crate::error::ApiError;

use crate::reports::{
    common::{ReportCurrency, ReportEnvelope, ReportKey, SourceRowCount},
    low_stock::{aggregate_low_stock, ProductSourceRow, StockQuantSourceRow},
    stock_movement::{
        aggregate_stock_movement, StockLocationSourceRow, StockMovementProductSourceRow,
        StockMovementSourceRow,
    },
    timezone::day_window,
};

/// Inventory report preview source loading.
use super::{
    query_company, query_typed, scope_for, source_watermark, ReportPreview,
    ValidatedPreviewRequest, PREVIEW_WATERMARK, QUERY_LIMIT,
};

pub(super) async fn preview_stock_movement(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    request: ValidatedPreviewRequest,
) -> Result<ReportPreview, ApiError> {
    let company = query_company(client, organization_id, request.company_id).await?;
    let window = day_window(request.date, &request.timezone)?;
    let moves_sql = format!(
        "SELECT id, product_id, product_tmpl_id, location_id, location_dest_id, quantity_done, price_unit, date, reference, move_type FROM stock_move WHERE organization_id = {organization_id} AND company_id = {} AND state = 'done' AND date >= '{}' AND date < '{}' LIMIT {QUERY_LIMIT}",
        company.id, window.start_sql, window.end_sql
    );
    let products_sql = format!(
        "SELECT product_tmpl_id, name, display_name, default_code FROM product_variant WHERE organization_id = {organization_id} AND is_active = true LIMIT {QUERY_LIMIT}"
    );
    let locations_sql = format!(
        "SELECT id, name, complete_name FROM stock_location WHERE organization_id = {organization_id} AND (company_id IS NULL OR company_id = {}) AND active = true LIMIT {QUERY_LIMIT}",
        company.id
    );
    let (moves, products, locations) = tokio::try_join!(
        query_typed::<StockMovementSourceRow>(client, "stock_move", moves_sql),
        query_typed::<StockMovementProductSourceRow>(client, "product_variant", products_sql),
        query_typed::<StockLocationSourceRow>(client, "stock_location", locations_sql),
    )?;
    let generated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    Ok(ReportPreview::StockMovementV1(ReportEnvelope {
        report_key: ReportKey::StockMovementV1,
        schema_version: 1,
        scope: scope_for(&company, &window),
        generated_at: generated_at.clone(),
        generated_by: identity_hex.to_string(),
        currency: ReportCurrency { currency_id: company.currency_id, minor_unit_scale: 2 },
        source_watermark: source_watermark(&window, generated_at, vec![
            SourceRowCount { source: "stock_move", rows: moves.len() },
            SourceRowCount { source: "product_variant", rows: products.len() },
            SourceRowCount { source: "stock_location", rows: locations.len() },
        ]),
        caveats: vec![
            format!("Completed stock moves in the requested local-day window: {}.", window.cutoff_label),
            "Quantity is the completed movement quantity; draft, assigned, cancelled, and future-dated moves are excluded.".into(),
            "Valuation reference equals completed quantity times the operational move unit price. It is not a posted stock-valuation or accounting amount.".into(),
            "Detail output is capped at 100 newest movements while totals cover every scoped source row.".into(),
        ],
        watermark: PREVIEW_WATERMARK.into(),
        report: aggregate_stock_movement(moves, products, locations),
    }))
}

pub(super) async fn preview_low_stock(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    request: ValidatedPreviewRequest,
) -> Result<ReportPreview, ApiError> {
    let company = query_company(client, organization_id, request.company_id).await?;
    let window = day_window(request.date, &request.timezone)?;
    let quants_sql = format!(
        "SELECT product_id, quantity, reserved_quantity, available_quantity, is_outdated FROM stock_quant WHERE organization_id = {organization_id} AND company_id = {} LIMIT {QUERY_LIMIT}",
        company.id
    );
    let products_sql = format!(
        "SELECT product_tmpl_id, name, display_name, default_code, virtual_available, reordering_min_qty FROM product_variant WHERE organization_id = {organization_id} AND is_active = true LIMIT {QUERY_LIMIT}"
    );
    let (quants, products) = tokio::try_join!(
        query_typed::<StockQuantSourceRow>(client, "stock_quant", quants_sql),
        query_typed::<ProductSourceRow>(client, "product_variant", products_sql),
    )?;
    let generated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    Ok(ReportPreview::LowStockV1(ReportEnvelope {
        report_key: ReportKey::LowStockV1,
        schema_version: 1,
        scope: scope_for(&company, &window),
        generated_at: generated_at.clone(),
        generated_by: identity_hex.to_string(),
        currency: ReportCurrency { currency_id: company.currency_id, minor_unit_scale: 2 },
        source_watermark: source_watermark(&window, generated_at, vec![
            SourceRowCount { source: "stock_quant", rows: quants.len() },
            SourceRowCount { source: "product_variant", rows: products.len() },
        ]),
        caveats: vec![
            "Low-stock status is a current company quant snapshot at report generation time.".into(),
            "Forecast comes from the product variant projection; supplier contact data is not yet joined, so each alert requires supplier follow-up.".into(),
        ],
        watermark: PREVIEW_WATERMARK.into(),
        report: aggregate_low_stock(products, quants),
    }))
}
