use chrono::{NaiveDate, SecondsFormat, Utc};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use stdb_client::StdbClient;

use crate::error::ApiError;

use super::{
    catalog::{catalog_entry, ReportAvailability},
    commercial::{
        monthly_owner, payment_fee_summary, purchase_spend, sales_by_product, AmountRow,
        ContactRow, FeeRow, IdRow, LandedCostRow, MonthlyOwnerReportV1, MovementRow,
        PaymentAccountRow, PaymentFeeSummaryReportV1, PaymentTransactionRow, ProductRow,
        PurchaseLineRow, PurchaseSpendReportV1, SalesByProductReportV1, SalesLineRow,
    },
    common::{
        GeneratedOwnerReportHistoryRow, ReportCurrency, ReportEnvelope, ReportKey,
        ReportPreviewRequest, ReportScope, SourceRowCount, SourceWatermark,
    },
    daily_business_summary::{
        aggregate_daily_business_summary, DailyBusinessSummaryReportV1, DailyBusinessSummarySource,
        FeeSourceRow, PaymentSourceRow, PurchaseSourceRow, SaleSourceRow, StockSourceRow,
    },
    financial_position::{
        aggregate_cash_mobile_money, ledger_opening_by_journal, CashMobileMoneyReportV1,
        JournalDefaultAccountRow, LiquidityMoveLineRow, PaymentAccountSourceRow,
        PaymentFeeSourceRow, PaymentReconciliationSourceRow, PostedPaymentSourceRow,
        UnreconciledPaymentSourceRow,
    },
    low_stock::{aggregate_low_stock, LowStockReportV1, ProductSourceRow, StockQuantSourceRow},
    open_balances::{
        aggregate_customer_balances, aggregate_supplier_payables, CustomerBalancesReportV1,
        MoveAllocationSourceRow, MoveLineMoveIdRow, OpenMoveSourceRow, SupplierPayablesReportV1,
    },
    stock_movement::{
        aggregate_stock_movement, StockLocationSourceRow, StockMovementProductSourceRow,
        StockMovementReportV1, StockMovementSourceRow,
    },
    timezone::{day_window, month_window, parse_timezone, ReportDayWindow},
};

const MAX_ROWS_PER_SOURCE: usize = 1_000;
const QUERY_LIMIT: usize = MAX_ROWS_PER_SOURCE + 1;
const PREVIEW_WATERMARK: &str = "PREVIEW — NOT AN ACCOUNTING STATEMENT";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompanyRow {
    id: u64,
    organization_id: u64,
    name: String,
    currency_id: u64,
    deleted_at: Option<serde_json::Value>,
}

pub async fn report_artifact_key(
    client: &StdbClient,
    organization_id: u64,
    report_id: u64,
) -> Result<(u64, String), ApiError> {
    let sql = format!(
        "SELECT id, company_id, artifact_key FROM generated_owner_report WHERE organization_id = {organization_id} AND id = {report_id} LIMIT 1"
    );
    let row: super::common::GeneratedOwnerReportArtifactRow =
        query_typed(client, "generated_owner_report", sql)
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| ApiError::NotFound("generated owner report not found".into()))?;
    Ok((row.company_id, row.artifact_key))
}

#[derive(Debug)]
struct ValidatedPreviewRequest {
    company_id: u64,
    date: NaiveDate,
    timezone: String,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum ReportPreview {
    DailyBusinessSummaryV1(ReportEnvelope<DailyBusinessSummaryReportV1>),
    CashMobileMoneyV1(ReportEnvelope<CashMobileMoneyReportV1>),
    CustomerBalancesV1(ReportEnvelope<CustomerBalancesReportV1>),
    SupplierPayablesV1(ReportEnvelope<SupplierPayablesReportV1>),
    LowStockV1(ReportEnvelope<LowStockReportV1>),
    StockMovementV1(ReportEnvelope<StockMovementReportV1>),
    SalesByProductV1(ReportEnvelope<SalesByProductReportV1>),
    PurchaseSpendV1(ReportEnvelope<PurchaseSpendReportV1>),
    PaymentFeeSummaryV1(ReportEnvelope<PaymentFeeSummaryReportV1>),
    MonthlyOwnerReportV1(ReportEnvelope<MonthlyOwnerReportV1>),
}

pub async fn preview_report(
    client: &StdbClient,
    report_key: ReportKey,
    organization_id: u64,
    identity_hex: &str,
    request: ReportPreviewRequest,
) -> Result<ReportPreview, ApiError> {
    let entry = catalog_entry(report_key);
    if entry.availability != ReportAvailability::Preview {
        return Err(ApiError::Unprocessable(format!(
            "Report '{report_key}' is catalogued but preview is not available yet"
        )));
    }

    let request = validate_request(request)?;
    match report_key {
        ReportKey::DailyBusinessSummaryV1 => {
            preview_daily_business_summary(client, organization_id, identity_hex, request).await
        }
        ReportKey::CashMobileMoneyV1 => {
            preview_cash_mobile_money(client, organization_id, identity_hex, request).await
        }
        ReportKey::CustomerBalancesV1 => {
            preview_open_balances(
                client,
                organization_id,
                identity_hex,
                request,
                "OutInvoice",
                ReportKey::CustomerBalancesV1,
            )
            .await
        }
        ReportKey::SupplierPayablesV1 => {
            preview_open_balances(
                client,
                organization_id,
                identity_hex,
                request,
                "InInvoice",
                ReportKey::SupplierPayablesV1,
            )
            .await
        }
        ReportKey::LowStockV1 => {
            preview_low_stock(client, organization_id, identity_hex, request).await
        }
        ReportKey::StockMovementV1 => {
            preview_stock_movement(client, organization_id, identity_hex, request).await
        }
        ReportKey::SalesByProductV1 => {
            preview_sales_by_product(client, organization_id, identity_hex, request).await
        }
        ReportKey::PurchaseSpendV1 => {
            preview_purchase_spend(client, organization_id, identity_hex, request).await
        }
        ReportKey::PaymentFeeSummaryV1 => {
            preview_payment_fee_summary(client, organization_id, identity_hex, request).await
        }
        ReportKey::MonthlyOwnerReportV1 => {
            preview_monthly_owner(client, organization_id, identity_hex, request).await
        }
        _ => unreachable!("availability and report implementation must stay aligned"),
    }
}

async fn commercial_products(
    client: &StdbClient,
    organization_id: u64,
) -> Result<Vec<ProductRow>, ApiError> {
    query_typed(client, "product_variant", format!("SELECT product_tmpl_id, name, display_name, default_code FROM product_variant WHERE organization_id = {organization_id} AND is_active = true LIMIT {QUERY_LIMIT}")).await
}

async fn preview_sales_by_product(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    request: ValidatedPreviewRequest,
) -> Result<ReportPreview, ApiError> {
    let company = query_company(client, organization_id, request.company_id).await?;
    let window = day_window(request.date, &request.timezone)?;
    let orders: Vec<IdRow> = query_typed(client, "sale_order", format!("SELECT id FROM sale_order WHERE organization_id = {organization_id} AND company_id = {} AND state IN ('Sale', 'Done') AND date_order >= '{}' AND date_order < '{}' LIMIT {QUERY_LIMIT}", company.id, window.start_sql, window.end_sql)).await?;
    let ids = sql_id_list(&orders.into_iter().map(|row| row.id).collect::<Vec<_>>());
    let lines = if ids.is_empty() {
        vec![]
    } else {
        query_typed(client, "sale_order_line", format!("SELECT product_id, product_template_id, product_uom_qty, price_subtotal, price_total, margin, currency_id, display_type FROM sale_order_line WHERE organization_id = {organization_id} AND company_id = {} AND order_id IN ({ids}) LIMIT {QUERY_LIMIT}", company.id)).await?
    };
    let products = commercial_products(client, organization_id).await?;
    let generated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    Ok(ReportPreview::SalesByProductV1(ReportEnvelope { report_key: ReportKey::SalesByProductV1, schema_version: 1, scope: scope_for(&company, &window), generated_at: generated_at.clone(), generated_by: identity_hex.into(), currency: ReportCurrency { currency_id: company.currency_id, minor_unit_scale: 2 }, source_watermark: source_watermark(&window, generated_at, vec![SourceRowCount { source: "sale_order_line", rows: lines.len() }, SourceRowCount { source: "product_variant", rows: products.len() }]), caveats: vec!["Only confirmed and completed sales-order lines in the selected local-day window are included.".into(), "Returns are represented only by negative order-line amounts; dedicated return orders are not yet joined.".into(), "Margin is the operational line margin, not a posted accounting margin.".into()], watermark: PREVIEW_WATERMARK.into(), report: sales_by_product(lines, products, company.currency_id) }))
}

async fn preview_purchase_spend(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    request: ValidatedPreviewRequest,
) -> Result<ReportPreview, ApiError> {
    let company = query_company(client, organization_id, request.company_id).await?;
    let window = day_window(request.date, &request.timezone)?;
    let orders: Vec<IdRow> = query_typed(client, "purchase_order", format!("SELECT id FROM purchase_order WHERE organization_id = {organization_id} AND company_id = {} AND state IN ('Purchase', 'Done') AND date_order >= '{}' AND date_order < '{}' LIMIT {QUERY_LIMIT}", company.id, window.start_sql, window.end_sql)).await?;
    let ids = sql_id_list(&orders.into_iter().map(|row| row.id).collect::<Vec<_>>());
    let lines = if ids.is_empty() {
        vec![]
    } else {
        query_typed(client, "purchase_order_line", format!("SELECT product_id, product_template_id, partner_id, product_qty, price_total, currency_id, display_type FROM purchase_order_line WHERE organization_id = {organization_id} AND company_id = {} AND order_id IN ({ids}) LIMIT {QUERY_LIMIT}", company.id)).await?
    };
    let products = commercial_products(client, organization_id);
    let contacts = query_typed(client, "contact", format!("SELECT id, display_name FROM contact WHERE organization_id = {organization_id} AND deleted_at IS NULL LIMIT {QUERY_LIMIT}"));
    let landed_costs = query_typed(client, "stock_landed_cost", format!("SELECT amount_total, currency_id FROM stock_landed_cost WHERE organization_id = {organization_id} AND company_id = {} AND state = 'Posted' AND date >= '{}' AND date < '{}' LIMIT {QUERY_LIMIT}", company.id, window.start_sql, window.end_sql));
    let (products, contacts, landed_costs) = tokio::try_join!(products, contacts, landed_costs)?;
    let generated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    Ok(ReportPreview::PurchaseSpendV1(ReportEnvelope { report_key: ReportKey::PurchaseSpendV1, schema_version: 1, scope: scope_for(&company, &window), generated_at: generated_at.clone(), generated_by: identity_hex.into(), currency: ReportCurrency { currency_id: company.currency_id, minor_unit_scale: 2 }, source_watermark: source_watermark(&window, generated_at, vec![SourceRowCount { source: "purchase_order_line", rows: lines.len() }, SourceRowCount { source: "product_variant", rows: products.len() }, SourceRowCount { source: "contact", rows: contacts.len() }, SourceRowCount { source: "stock_landed_cost", rows: landed_costs.len() }]), caveats: vec!["Only confirmed and completed purchase-order lines in the selected local-day window are included.".into(), "Posted landed costs in the same window are included as a company total; allocation to individual purchase lines is not yet available.".into()], watermark: PREVIEW_WATERMARK.into(), report: purchase_spend(lines, products, contacts, landed_costs, company.currency_id) }))
}

async fn preview_payment_fee_summary(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    request: ValidatedPreviewRequest,
) -> Result<ReportPreview, ApiError> {
    let company = query_company(client, organization_id, request.company_id).await?;
    let window = day_window(request.date, &request.timezone)?;
    let fees = query_typed(client, "payment_fee", format!("SELECT payment_transaction_id, bearer, amount, tax_amount, currency_id FROM payment_fee WHERE organization_id = {organization_id} AND company_id = {} AND created_at >= '{}' AND created_at < '{}' LIMIT {QUERY_LIMIT}", company.id, window.start_sql, window.end_sql));
    let transactions = query_typed(client, "payment_transaction", format!("SELECT id, payment_account_id, currency_id FROM payment_transaction WHERE organization_id = {organization_id} AND company_id = {} AND status = 'Posted' LIMIT {QUERY_LIMIT}", company.id));
    let accounts = query_typed(client, "payment_account", format!("SELECT id, name, provider_code FROM payment_account WHERE organization_id = {organization_id} AND company_id = {} LIMIT {QUERY_LIMIT}", company.id));
    let (fees, transactions, accounts) = tokio::try_join!(fees, transactions, accounts)?;
    let generated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    Ok(ReportPreview::PaymentFeeSummaryV1(ReportEnvelope { report_key: ReportKey::PaymentFeeSummaryV1, schema_version: 1, scope: scope_for(&company, &window), generated_at: generated_at.clone(), generated_by: identity_hex.into(), currency: ReportCurrency { currency_id: company.currency_id, minor_unit_scale: 2 }, source_watermark: source_watermark(&window, generated_at, vec![SourceRowCount { source: "payment_fee", rows: fees.len() }, SourceRowCount { source: "payment_transaction", rows: transactions.len() }, SourceRowCount { source: "payment_account", rows: accounts.len() }]), caveats: vec!["Fees are linked only to posted payment transactions.".into(), "Fee rates and accounting-posting status require provider and journal extensions not yet modelled.".into()], watermark: PREVIEW_WATERMARK.into(), report: payment_fee_summary(fees, transactions, accounts, company.currency_id) }))
}

async fn preview_monthly_owner(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    request: ValidatedPreviewRequest,
) -> Result<ReportPreview, ApiError> {
    let company = query_company(client, organization_id, request.company_id).await?;
    let window = month_window(request.date, &request.timezone)?;
    let sales = query_typed(client, "sale_order", format!("SELECT amount_total, currency_id FROM sale_order WHERE organization_id = {organization_id} AND company_id = {} AND state IN ('Sale', 'Done') AND date_order >= '{}' AND date_order < '{}' LIMIT {QUERY_LIMIT}", company.id, window.start_sql, window.end_sql));
    let purchases = query_typed(client, "purchase_order", format!("SELECT amount_total, currency_id FROM purchase_order WHERE organization_id = {organization_id} AND company_id = {} AND state IN ('Purchase', 'Done') AND date_order >= '{}' AND date_order < '{}' LIMIT {QUERY_LIMIT}", company.id, window.start_sql, window.end_sql));
    let fees = query_typed(client, "payment_fee", format!("SELECT payment_transaction_id, bearer, amount, tax_amount, currency_id FROM payment_fee WHERE organization_id = {organization_id} AND company_id = {} AND created_at >= '{}' AND created_at < '{}' LIMIT {QUERY_LIMIT}", company.id, window.start_sql, window.end_sql));
    let moves = query_typed(client, "stock_move", format!("SELECT quantity_done, price_unit FROM stock_move WHERE organization_id = {organization_id} AND company_id = {} AND state = 'done' AND date >= '{}' AND date < '{}' LIMIT {QUERY_LIMIT}", company.id, window.start_sql, window.end_sql));
    let (sales, purchases, fees, moves) = tokio::try_join!(sales, purchases, fees, moves)?;
    let generated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    Ok(ReportPreview::MonthlyOwnerReportV1(ReportEnvelope { report_key: ReportKey::MonthlyOwnerReportV1, schema_version: 1, scope: scope_for(&company, &window), generated_at: generated_at.clone(), generated_by: identity_hex.into(), currency: ReportCurrency { currency_id: company.currency_id, minor_unit_scale: 2 }, source_watermark: source_watermark(&window, generated_at, vec![SourceRowCount { source: "sale_order", rows: sales.len() }, SourceRowCount { source: "purchase_order", rows: purchases.len() }, SourceRowCount { source: "payment_fee", rows: fees.len() }, SourceRowCount { source: "stock_move", rows: moves.len() }]), caveats: vec!["This is a month-to-date operational roll-up for the requested calendar month.".into(), "It composes authoritative operational sources directly; report-section approval and stored monthly schedules are still pending.".into(), "Sales and purchases are order totals, not posted ledger totals.".into()], watermark: PREVIEW_WATERMARK.into(), report: monthly_owner(sales, purchases, fees, moves, company.currency_id) }))
}

async fn preview_stock_movement(
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

async fn preview_low_stock(
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

pub async fn report_history(
    client: &StdbClient,
    organization_id: u64,
    company_id: u64,
) -> Result<Vec<GeneratedOwnerReportHistoryRow>, ApiError> {
    query_company(client, organization_id, company_id).await?;
    let sql = format!(
        "SELECT id, company_id, report_key, schema_version, output_hash, renderer_version, document_id, correlation_id, generated_at FROM generated_owner_report WHERE organization_id = {organization_id} AND company_id = {company_id} LIMIT 100"
    );
    query_typed(client, "generated_owner_report", sql).await
}

async fn preview_cash_mobile_money(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    request: ValidatedPreviewRequest,
) -> Result<ReportPreview, ApiError> {
    let company = query_company(client, organization_id, request.company_id).await?;
    let window = day_window(request.date, &request.timezone)?;
    let accounts_sql = format!(
        "SELECT id, name, provider_code, reference_masked, currency_id, account_journal_id FROM payment_account WHERE organization_id = {organization_id} AND company_id = {} AND active = true LIMIT {QUERY_LIMIT}",
        company.id
    );
    let accounts =
        query_typed::<PaymentAccountSourceRow>(client, "payment_account", accounts_sql).await?;
    let journal_ids = accounts
        .iter()
        .map(|account| account.account_journal_id)
        .collect::<Vec<_>>();
    let journal_id_list = sql_id_list(&journal_ids);

    let payments_sql = format!(
        "SELECT id, payment_account_id, direction, settlement_amount, net_account_amount, currency_id FROM payment_transaction WHERE organization_id = {organization_id} AND company_id = {} AND status = 'Posted' AND occurred_at >= '{}' AND occurred_at < '{}' LIMIT {QUERY_LIMIT}",
        company.id, window.start_sql, window.end_sql
    );
    let prior_payments_sql = format!(
        "SELECT id, payment_account_id, direction, settlement_amount, net_account_amount, currency_id FROM payment_transaction WHERE organization_id = {organization_id} AND company_id = {} AND status = 'Posted' AND occurred_at < '{}' LIMIT {QUERY_LIMIT}",
        company.id, window.start_sql
    );
    let fees_sql = format!(
        "SELECT payment_transaction_id, amount, tax_amount, currency_id FROM payment_fee WHERE organization_id = {organization_id} AND company_id = {} AND created_at >= '{}' AND created_at < '{}' LIMIT {QUERY_LIMIT}",
        company.id, window.start_sql, window.end_sql
    );
    let prior_fees_sql = format!(
        "SELECT payment_transaction_id, amount, tax_amount, currency_id FROM payment_fee WHERE organization_id = {organization_id} AND company_id = {} AND created_at < '{}' LIMIT {QUERY_LIMIT}",
        company.id, window.start_sql
    );
    let reconciliations_sql = format!(
        "SELECT payment_transaction_id, is_reversal FROM payment_reconciliation WHERE organization_id = {organization_id} AND company_id = {company_id} LIMIT {QUERY_LIMIT}",
        company_id = company.id
    );
    let unreconciled_candidates_sql = format!(
        "SELECT id, payment_account_id, external_reference, occurred_at, net_account_amount, currency_id FROM payment_transaction WHERE organization_id = {organization_id} AND company_id = {} AND status = 'Posted' AND occurred_at < '{}' LIMIT {QUERY_LIMIT}",
        company.id, window.end_sql
    );

    let journals_sql = if journal_id_list.is_empty() {
        None
    } else {
        Some(format!(
            "SELECT id, default_account_id FROM account_journal WHERE organization_id = {organization_id} AND company_id = {} AND id IN ({journal_id_list}) LIMIT {QUERY_LIMIT}",
            company.id
        ))
    };
    let liquidity_lines_sql = if journal_id_list.is_empty() {
        None
    } else {
        Some(format!(
            "SELECT journal_id, account_id, balance FROM account_move_line WHERE organization_id = {organization_id} AND company_id = {} AND parent_state = 'Posted' AND date < '{}' AND currency_id = {} AND journal_id IN ({journal_id_list}) LIMIT {QUERY_LIMIT}",
            company.id, window.start_sql, company.currency_id
        ))
    };

    let (payments, prior_payments, fees, prior_fees) = tokio::try_join!(
        query_typed::<PostedPaymentSourceRow>(client, "payment_transaction", payments_sql),
        query_typed::<PostedPaymentSourceRow>(client, "payment_transaction", prior_payments_sql),
        query_typed::<PaymentFeeSourceRow>(client, "payment_fee", fees_sql),
        query_typed::<PaymentFeeSourceRow>(client, "payment_fee", prior_fees_sql),
    )?;

    let reconciliations = query_typed::<PaymentReconciliationSourceRow>(
        client,
        "payment_reconciliation",
        reconciliations_sql,
    )
    .await?;
    let reconciliation_count = reconciliations.len();
    let unreconciled_candidates = query_typed::<UnreconciledPaymentSourceRow>(
        client,
        "payment_transaction",
        unreconciled_candidates_sql,
    )
    .await?;

    let journals = if let Some(sql) = journals_sql {
        query_typed::<JournalDefaultAccountRow>(client, "account_journal", sql).await?
    } else {
        vec![]
    };
    let liquidity_lines = if let Some(sql) = liquidity_lines_sql {
        query_typed::<LiquidityMoveLineRow>(client, "account_move_line", sql).await?
    } else {
        vec![]
    };
    let opening_by_journal =
        ledger_opening_by_journal(&journals, &liquidity_lines, company.currency_id);
    let reconciled_ids = reconciliations
        .into_iter()
        .filter(|row| !row.is_reversal)
        .map(|row| row.payment_transaction_id)
        .collect::<std::collections::HashSet<_>>();
    let unreconciled = unreconciled_candidates
        .into_iter()
        .filter(|payment| !reconciled_ids.contains(&payment.id))
        .collect::<Vec<_>>();

    let generated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let source_rows = vec![
        SourceRowCount {
            source: "payment_account",
            rows: accounts.len(),
        },
        SourceRowCount {
            source: "account_move_line",
            rows: liquidity_lines.len(),
        },
        SourceRowCount {
            source: "payment_transaction",
            rows: payments.len(),
        },
        SourceRowCount {
            source: "payment_fee",
            rows: fees.len(),
        },
        SourceRowCount {
            source: "payment_reconciliation",
            rows: reconciliation_count,
        },
    ];
    Ok(ReportPreview::CashMobileMoneyV1(ReportEnvelope {
        report_key: ReportKey::CashMobileMoneyV1,
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
            format!("Operational window: {}.", window.cutoff_label),
            "Opening balances use posted liquidity journal lines before the window; when absent, opening is reconstructed from prior posted payment transactions.".into(),
            "Closing balances equal opening plus receipts minus disbursements and fees for the window.".into(),
            "Unreconciled items are posted payment transactions without a non-reversal allocation as of the report cutoff.".into(),
            "Payment references in unreconciled details are masked; account references remain masked in account rows.".into(),
        ],
        watermark: PREVIEW_WATERMARK.into(),
        report: aggregate_cash_mobile_money(
            accounts,
            opening_by_journal,
            prior_payments,
            prior_fees,
            payments,
            fees,
            unreconciled,
            company.currency_id,
        ),
    }))
}

async fn preview_open_balances(
    client: &StdbClient,
    organization_id: u64,
    identity_hex: &str,
    request: ValidatedPreviewRequest,
    move_type: &str,
    report_key: ReportKey,
) -> Result<ReportPreview, ApiError> {
    let company = query_company(client, organization_id, request.company_id).await?;
    let window = day_window(request.date, &request.timezone)?;
    let moves_sql = format!(
        "SELECT id, partner_id, invoice_partner_display_name, invoice_date_due, amount_total, amount_residual, currency_id FROM account_move WHERE organization_id = {organization_id} AND company_id = {} AND state = 'Posted' AND move_type = '{move_type}' AND date < '{}' LIMIT {QUERY_LIMIT}",
        company.id, window.end_sql
    );
    let moves = query_typed::<OpenMoveSourceRow>(client, "account_move", moves_sql).await?;
    let move_ids = moves.iter().map(|move_| move_.id).collect::<Vec<_>>();
    let move_id_list = sql_id_list(&move_ids);

    let lines = if move_id_list.is_empty() {
        vec![]
    } else {
        let lines_sql = format!(
            "SELECT id, move_id FROM account_move_line WHERE organization_id = {organization_id} AND company_id = {} AND move_id IN ({move_id_list}) LIMIT {QUERY_LIMIT}",
            company.id
        );
        query_typed::<MoveLineMoveIdRow>(client, "account_move_line", lines_sql).await?
    };
    let line_ids = lines.iter().map(|line| line.id).collect::<Vec<_>>();
    let line_id_list = sql_id_list(&line_ids);
    let allocations = if line_id_list.is_empty() {
        vec![]
    } else {
        let allocations_sql = format!(
            "SELECT allocated_move_line_id, allocated_amount, is_reversal, created_at, currency_id FROM payment_reconciliation WHERE organization_id = {organization_id} AND company_id = {} AND allocated_move_line_id IN ({line_id_list}) LIMIT {QUERY_LIMIT}",
            company.id
        );
        query_typed::<MoveAllocationSourceRow>(client, "payment_reconciliation", allocations_sql)
            .await?
    };

    let source_rows = vec![
        SourceRowCount {
            source: "account_move",
            rows: moves.len(),
        },
        SourceRowCount {
            source: "account_move_line",
            rows: lines.len(),
        },
        SourceRowCount {
            source: "payment_reconciliation",
            rows: allocations.len(),
        },
    ];
    let generated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let scope = scope_for(&company, &window);
    let currency = ReportCurrency {
        currency_id: company.currency_id,
        minor_unit_scale: 2,
    };
    let source_watermark = source_watermark(&window, generated_at.clone(), source_rows);
    let caveats = vec![
        format!("Posted-ledger as-of cutoff: {}.", window.cutoff_label),
        "Open balances use posted move residuals as the authority for amounts due.".into(),
        "Paid amounts are derived from payment_reconciliation allocations linked via move lines; reversals reduce paid totals.".into(),
        "Due-date aging uses the requested local report date in the selected timezone.".into(),
        "Partner display names are included only when present on the posted move; no unmasked contact data is joined.".into(),
        "Customer credit status is unknown until credit limits are modelled in the ledger.".into(),
    ];
    let watermark = PREVIEW_WATERMARK.to_string();

    Ok(match report_key {
        ReportKey::CustomerBalancesV1 => ReportPreview::CustomerBalancesV1(ReportEnvelope {
            report_key,
            schema_version: 1,
            scope,
            generated_at,
            generated_by: identity_hex.to_string(),
            currency,
            source_watermark,
            caveats,
            watermark,
            report: aggregate_customer_balances(
                moves,
                &lines,
                &allocations,
                company.currency_id,
                request.date,
            ),
        }),
        ReportKey::SupplierPayablesV1 => ReportPreview::SupplierPayablesV1(ReportEnvelope {
            report_key,
            schema_version: 1,
            scope,
            generated_at,
            generated_by: identity_hex.to_string(),
            currency,
            source_watermark,
            caveats: caveats
                .into_iter()
                .filter(|caveat| !caveat.starts_with("Customer credit"))
                .collect(),
            watermark,
            report: aggregate_supplier_payables(
                moves,
                &lines,
                &allocations,
                company.currency_id,
                request.date,
            ),
        }),
        _ => unreachable!("only customer and supplier balance reports use this projection"),
    })
}

async fn preview_daily_business_summary(
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

fn source_watermark(
    window: &ReportDayWindow,
    queried_at: String,
    source_rows: Vec<SourceRowCount>,
) -> SourceWatermark {
    SourceWatermark {
        accounting_cutoff: window.end_sql.clone(),
        window_start_utc: window.start_sql.clone(),
        window_end_utc: window.end_sql.clone(),
        cutoff_label: window.cutoff_label.clone(),
        queried_at,
        source_rows,
    }
}

fn scope_for(company: &CompanyRow, window: &ReportDayWindow) -> ReportScope {
    ReportScope {
        organization_id: company.organization_id,
        company_id: company.id,
        local_date: window.local_date.to_string(),
        date_from: window.local_date.to_string(),
        date_to_exclusive: window.local_end_date.to_string(),
        timezone: window.timezone.clone(),
        window_start_utc: window.start_sql.clone(),
        window_end_utc: window.end_sql.clone(),
        cutoff_label: window.cutoff_label.clone(),
    }
}

fn sql_id_list(ids: &[u64]) -> String {
    ids.iter()
        .map(|id| id.to_string())
        .collect::<Vec<_>>()
        .join(", ")
}

async fn query_company(
    client: &StdbClient,
    organization_id: u64,
    company_id: u64,
) -> Result<CompanyRow, ApiError> {
    let sql = format!(
        "SELECT id, organization_id, name, currency_id, deleted_at FROM company WHERE id = {company_id} AND organization_id = {organization_id} LIMIT 1"
    );
    query_typed::<CompanyRow>(client, "company", sql)
        .await?
        .into_iter()
        .find(|company| company.deleted_at.is_none())
        .ok_or_else(|| {
            ApiError::Forbidden("Company does not belong to the session organization".into())
        })
}

async fn query_typed<T>(
    client: &StdbClient,
    source: &'static str,
    sql: String,
) -> Result<Vec<T>, ApiError>
where
    T: DeserializeOwned,
{
    let rows = client
        .query_sql(&sql)
        .await
        .map_err(|error| ApiError::Internal(format!("{source} report query: {error}")))?;
    if rows.len() > MAX_ROWS_PER_SOURCE {
        return Err(ApiError::Unprocessable(format!(
            "Report source '{source}' exceeds the {MAX_ROWS_PER_SOURCE}-row preview limit"
        )));
    }
    rows.into_iter()
        .map(|row| {
            serde_json::from_value(row).map_err(|error| {
                ApiError::Internal(format!("invalid typed {source} report row: {error}"))
            })
        })
        .collect()
}

fn validate_request(request: ReportPreviewRequest) -> Result<ValidatedPreviewRequest, ApiError> {
    if request.company_id == 0 {
        return Err(ApiError::BadRequest(
            "companyId must be greater than zero".into(),
        ));
    }
    let date = NaiveDate::parse_from_str(request.date.trim(), "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("date must use YYYY-MM-DD".into()))?;
    let timezone = request.timezone.trim();
    if timezone.is_empty()
        || timezone.len() > 64
        || !timezone.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '/' | '_' | '-' | '+' | ':')
        })
    {
        return Err(ApiError::BadRequest(
            "timezone must be a valid non-empty timezone identifier".into(),
        ));
    }
    parse_timezone(timezone)?;

    Ok(ValidatedPreviewRequest {
        company_id: request.company_id,
        date,
        timezone: timezone.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_request_rejects_extra_scope_and_invalid_values() {
        let extra_scope = serde_json::from_value::<ReportPreviewRequest>(serde_json::json!({
            "organizationId": 9,
            "companyId": 1,
            "date": "2026-07-10",
            "timezone": "Africa/Nairobi"
        }));
        assert!(extra_scope.is_err());

        let invalid = validate_request(ReportPreviewRequest {
            company_id: 1,
            date: "07/10/2026".into(),
            timezone: "Africa/Nairobi' OR 1=1".into(),
        });
        assert!(invalid.is_err());
    }

    #[test]
    fn preview_request_accepts_named_timezone_as_recorded_scope() {
        let request = validate_request(ReportPreviewRequest {
            company_id: 7,
            date: "2026-07-10".into(),
            timezone: "Africa/Nairobi".into(),
        })
        .expect("valid request");

        assert_eq!(request.company_id, 7);
        assert_eq!(request.date.to_string(), "2026-07-10");
        assert_eq!(request.timezone, "Africa/Nairobi");
    }

    #[test]
    fn preview_request_rejects_invalid_iana_timezone() {
        let invalid = validate_request(ReportPreviewRequest {
            company_id: 1,
            date: "2026-07-10".into(),
            timezone: "Not/A_Real_Zone".into(),
        });
        assert!(invalid.is_err());
    }
}
