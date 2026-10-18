use chrono::{SecondsFormat, Utc};
use stdb_client::StdbClient;

use crate::{
    error::ApiError,
    reports::{
        commercial::IdRow,
        common::{ReportCurrency, ReportEnvelope, ReportKey, SourceRowCount},
        margin_supply::{
            margin_supply_outlook, MarginProductRow, MarginReplenishmentRow, MarginSaleLineRow,
            MarginStockRow,
        },
        timezone::month_window,
    },
};

use super::{
    query_company, query_typed, scope_for, source_watermark, sql_id_list, ReportPreview,
    ValidatedPreviewRequest, QUERY_LIMIT,
};

pub(super) async fn preview_margin_supply_outlook(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    request: ValidatedPreviewRequest,
) -> Result<ReportPreview, ApiError> {
    let company = query_company(client, organization_id, request.company_id).await?;
    let window = month_window(request.date, &request.timezone)?;
    let orders: Vec<IdRow> = query_typed(
        client,
        "sale_order",
        format!(
            "SELECT id FROM sale_order WHERE organization_id = {organization_id} AND company_id = {} AND state IN ('Sale', 'Done') AND date_order >= '{}' AND date_order < '{}' LIMIT {QUERY_LIMIT}",
            company.id, window.start_sql, window.end_sql
        ),
    )
    .await?;
    let ids = sql_id_list(&orders.iter().map(|row| row.id).collect::<Vec<_>>());
    let sales = if ids.is_empty() {
        vec![]
    } else {
        query_typed::<MarginSaleLineRow>(
            client,
            "sale_order_line",
            format!(
                "SELECT product_id, product_template_id, product_uom_qty, price_subtotal, purchase_price, currency_id, display_type FROM sale_order_line WHERE organization_id = {organization_id} AND company_id = {} AND order_id IN ({ids}) LIMIT {QUERY_LIMIT}",
                company.id
            ),
        )
        .await?
    };
    let products = query_typed::<MarginProductRow>(
        client,
        "product_variant",
        format!(
            "SELECT product_tmpl_id, name, display_name, default_code FROM product_variant WHERE organization_id = {organization_id} AND is_active = true LIMIT {QUERY_LIMIT}"
        ),
    );
    let stock = query_typed::<MarginStockRow>(
        client,
        "stock_quant",
        format!(
            "SELECT product_id, available_quantity, is_outdated FROM stock_quant WHERE organization_id = {organization_id} AND company_id = {} LIMIT {QUERY_LIMIT}",
            company.id
        ),
    );
    let replenishment = query_typed::<MarginReplenishmentRow>(
        client,
        "replenishment_rule",
        format!(
            "SELECT product_id, product_min_qty, lead_days, active FROM replenishment_rule WHERE organization_id = {organization_id} AND company_id = {} LIMIT {QUERY_LIMIT}",
            company.id
        ),
    );
    let (products, stock, replenishment) = tokio::try_join!(products, stock, replenishment)?;
    let generated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let report = margin_supply_outlook(
        sales.clone(),
        products.clone(),
        stock.clone(),
        replenishment.clone(),
        company.currency_id,
        request.scenario,
    );

    Ok(ReportPreview::MarginSupplyOutlookV1(ReportEnvelope {
        report_key: ReportKey::MarginSupplyOutlookV1,
        schema_version: 1,
        scope: scope_for(&company, &window),
        generated_at: generated_at.clone(),
        generated_by: identity_hex.into(),
        currency: ReportCurrency {
            currency_id: company.currency_id,
            minor_unit_scale: 2,
        },
        source_watermark: source_watermark(
            &window,
            generated_at,
            vec![
                SourceRowCount {
                    source: "sale_order_line",
                    rows: sales.len(),
                },
                SourceRowCount {
                    source: "product_variant",
                    rows: products.len(),
                },
                SourceRowCount {
                    source: "stock_quant",
                    rows: stock.len(),
                },
                SourceRowCount {
                    source: "replenishment_rule",
                    rows: replenishment.len(),
                },
            ],
        ),
        caveats: vec![
            "This is a deterministic decision-support scenario. It does not change prices, pricelists, purchase orders, or replenishment rules.".into(),
            "Revenue and unit cost use confirmed/completed sales-order lines in the selected calendar month; cost is the sales-line purchase-price snapshot, not posted accounting COGS.".into(),
            "Gross-margin totals exclude products with any missing sales-line cost snapshot; those products remain visible with their complete demand and a missing-cost warning.".into(),
            "The cost shock is a manual blended assumption for upstream effects such as supplier, commodity, freight, or FX movement; it is not a live macroeconomic feed.".into(),
            "Demand is projected from the selected month's sold quantity over a 30-day planning horizon. Stock is the current company snapshot at generation time.".into(),
            "Products and lines in currencies other than the company currency, returns, service capacity, tax, overhead, financing, and net profit are excluded.".into(),
            "Advisory target prices show the unit price required to reach the selected gross-margin threshold under the scenario; they are not recommendations to automatically reprice.".into(),
        ],
        watermark: "SCENARIO — DECISION SUPPORT ONLY".into(),
        report,
    }))
}
