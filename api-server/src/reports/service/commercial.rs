use chrono::{SecondsFormat, Utc};
use stdb_client::StdbClient;

use crate::error::ApiError;

use crate::reports::{
    commercial::{
        monthly_owner, payment_fee_summary, purchase_spend, sales_by_product, IdRow, ProductRow,
    },
    common::{ReportCurrency, ReportEnvelope, ReportKey, SourceRowCount},
    timezone::{day_window, month_window},
};

/// Commercial report preview source loading.
use super::{
    query_company, query_typed, scope_for, source_watermark, sql_id_list, ReportPreview,
    ValidatedPreviewRequest, PREVIEW_WATERMARK, QUERY_LIMIT,
};

pub(super) async fn commercial_products(
    client: &StdbClient,
    organization_id: u64,
) -> Result<Vec<ProductRow>, ApiError> {
    query_typed(client, "product_variant", format!("SELECT product_tmpl_id, name, display_name, default_code FROM product_variant WHERE organization_id = {organization_id} AND is_active = true LIMIT {QUERY_LIMIT}")).await
}

pub(super) async fn preview_sales_by_product(
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

pub(super) async fn preview_purchase_spend(
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
    let contacts = query_typed(client, "contact", format!("SELECT id, display_name FROM contact WHERE organization_id = {organization_id} AND (company_id = {} OR company_id IS NULL) AND deleted_at IS NULL LIMIT {QUERY_LIMIT}", company.id));
    let landed_costs = query_typed(client, "stock_landed_cost", format!("SELECT amount_total, currency_id FROM stock_landed_cost WHERE organization_id = {organization_id} AND company_id = {} AND state = 'Posted' AND date >= '{}' AND date < '{}' LIMIT {QUERY_LIMIT}", company.id, window.start_sql, window.end_sql));
    let (products, contacts, landed_costs) = tokio::try_join!(products, contacts, landed_costs)?;
    let generated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    Ok(ReportPreview::PurchaseSpendV1(ReportEnvelope { report_key: ReportKey::PurchaseSpendV1, schema_version: 1, scope: scope_for(&company, &window), generated_at: generated_at.clone(), generated_by: identity_hex.into(), currency: ReportCurrency { currency_id: company.currency_id, minor_unit_scale: 2 }, source_watermark: source_watermark(&window, generated_at, vec![SourceRowCount { source: "purchase_order_line", rows: lines.len() }, SourceRowCount { source: "product_variant", rows: products.len() }, SourceRowCount { source: "contact", rows: contacts.len() }, SourceRowCount { source: "stock_landed_cost", rows: landed_costs.len() }]), caveats: vec!["Only confirmed and completed purchase-order lines in the selected local-day window are included.".into(), "Posted landed costs in the same window are included as a company total; allocation to individual purchase lines is not yet available.".into()], watermark: PREVIEW_WATERMARK.into(), report: purchase_spend(lines, products, contacts, landed_costs, company.currency_id) }))
}

pub(super) async fn preview_payment_fee_summary(
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

pub(super) async fn preview_monthly_owner(
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
