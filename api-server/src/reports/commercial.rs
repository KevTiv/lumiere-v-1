//! Product sales, purchase spend, payment fees, and monthly owner roll-ups.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::daily_business_summary::MoneyAmount;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductRow {
    pub product_tmpl_id: u64,
    pub name: String,
    pub display_name: Option<String>,
    pub default_code: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SalesLineRow {
    pub product_id: u64,
    pub product_template_id: Option<u64>,
    pub product_uom_qty: f64,
    pub price_subtotal: f64,
    pub price_total: f64,
    pub margin: f64,
    pub currency_id: u64,
    pub display_type: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseLineRow {
    pub product_id: u64,
    pub product_template_id: Option<u64>,
    pub partner_id: u64,
    pub product_qty: f64,
    pub price_total: f64,
    pub currency_id: u64,
    pub display_type: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactRow {
    pub id: u64,
    pub display_name: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeeRow {
    pub payment_transaction_id: u64,
    pub bearer: String,
    pub amount: f64,
    pub tax_amount: f64,
    pub currency_id: u64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentAccountRow {
    pub id: u64,
    pub name: String,
    pub provider_code: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentTransactionRow {
    pub id: u64,
    pub payment_account_id: u64,
    pub currency_id: u64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AmountRow {
    pub amount_total: f64,
    pub currency_id: u64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LandedCostRow {
    pub amount_total: f64,
    pub currency_id: u64,
}
#[derive(Debug, Deserialize)]
pub struct IdRow {
    pub id: u64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovementRow {
    pub quantity_done: f64,
    pub price_unit: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SalesByProductLine {
    pub product_id: u64,
    pub sku: Option<String>,
    pub product_name: String,
    pub quantity: f64,
    pub gross_sales: MoneyAmount,
    pub net_sales: MoneyAmount,
    pub returns: MoneyAmount,
    pub margin: MoneyAmount,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SalesByProductReportV1 {
    pub quantity_sold: f64,
    pub gross_sales: MoneyAmount,
    pub net_sales: MoneyAmount,
    pub returns: MoneyAmount,
    pub margin: MoneyAmount,
    pub lines: Vec<SalesByProductLine>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseSpendLine {
    pub supplier_id: u64,
    pub supplier_name: String,
    pub product_id: u64,
    pub product_name: String,
    pub quantity: f64,
    pub spend: MoneyAmount,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseSpendReportV1 {
    pub quantity_purchased: f64,
    pub total_spend: MoneyAmount,
    pub landed_costs: MoneyAmount,
    pub total_including_landed_costs: MoneyAmount,
    pub lines: Vec<PurchaseSpendLine>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentFeeLine {
    pub provider_account: String,
    pub bearer: String,
    pub amount: MoneyAmount,
    pub tax: MoneyAmount,
    pub total: MoneyAmount,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentFeeSummaryReportV1 {
    pub fee_count: usize,
    pub fees: MoneyAmount,
    pub tax: MoneyAmount,
    pub total: MoneyAmount,
    pub lines: Vec<PaymentFeeLine>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyOwnerReportV1 {
    pub sales: MoneyAmount,
    pub purchase_spend: MoneyAmount,
    pub payment_fees: MoneyAmount,
    pub stock_movement_value: MoneyAmount,
    pub stock_movement_count: usize,
}

pub fn sales_by_product(
    lines: Vec<SalesLineRow>,
    products: Vec<ProductRow>,
    currency_id: u64,
) -> SalesByProductReportV1 {
    let products = products
        .into_iter()
        .map(|row| (row.product_tmpl_id, row))
        .collect::<BTreeMap<_, _>>();
    let mut rows = BTreeMap::<u64, (f64, i64, i64, i64, i64)>::new();
    for line in lines
        .into_iter()
        .filter(|line| line.currency_id == currency_id && line.display_type.is_none())
    {
        let id = line.product_template_id.unwrap_or(line.product_id);
        let row = rows.entry(id).or_default();
        row.0 += line.product_uom_qty;
        row.1 += money_minor(line.price_total.max(0.0));
        row.2 += money_minor(line.price_subtotal);
        row.3 += money_minor((-line.price_total).max(0.0));
        row.4 += money_minor(line.margin);
    }
    let lines = rows
        .into_iter()
        .map(|(id, (quantity, gross, net, returns, margin))| {
            let product = products.get(&id);
            SalesByProductLine {
                product_id: id,
                sku: product.and_then(|p| p.default_code.clone()),
                product_name: product
                    .map(|p| p.display_name.clone().unwrap_or_else(|| p.name.clone()))
                    .unwrap_or_else(|| format!("Product #{id}")),
                quantity,
                gross_sales: money(gross),
                net_sales: money(net),
                returns: money(returns),
                margin: money(margin),
            }
        })
        .collect::<Vec<_>>();
    let quantity_sold = lines.iter().map(|line| line.quantity).sum();
    SalesByProductReportV1 {
        quantity_sold,
        gross_sales: sum_money(&lines, |line| line.gross_sales),
        net_sales: sum_money(&lines, |line| line.net_sales),
        returns: sum_money(&lines, |line| line.returns),
        margin: sum_money(&lines, |line| line.margin),
        lines,
    }
}

pub fn purchase_spend(
    lines: Vec<PurchaseLineRow>,
    products: Vec<ProductRow>,
    contacts: Vec<ContactRow>,
    landed_costs: Vec<LandedCostRow>,
    currency_id: u64,
) -> PurchaseSpendReportV1 {
    let products = products
        .into_iter()
        .map(|row| (row.product_tmpl_id, row))
        .collect::<BTreeMap<_, _>>();
    let contacts = contacts
        .into_iter()
        .map(|row| (row.id, row.display_name))
        .collect::<BTreeMap<_, _>>();
    let mut rows = BTreeMap::<(u64, u64), (f64, i64)>::new();
    for line in lines
        .into_iter()
        .filter(|line| line.currency_id == currency_id && line.display_type.is_none())
    {
        let product_id = line.product_template_id.unwrap_or(line.product_id);
        let row = rows.entry((line.partner_id, product_id)).or_default();
        row.0 += line.product_qty;
        row.1 += money_minor(line.price_total);
    }
    let lines = rows
        .into_iter()
        .map(
            |((supplier_id, product_id), (quantity, spend))| PurchaseSpendLine {
                supplier_id,
                supplier_name: contacts
                    .get(&supplier_id)
                    .cloned()
                    .unwrap_or_else(|| format!("Supplier #{supplier_id}")),
                product_id,
                product_name: products
                    .get(&product_id)
                    .map(|p| p.display_name.clone().unwrap_or_else(|| p.name.clone()))
                    .unwrap_or_else(|| format!("Product #{product_id}")),
                quantity,
                spend: money(spend),
            },
        )
        .collect::<Vec<_>>();
    let total_spend = sum_money(&lines, |line| line.spend);
    let landed_costs = money(landed_cost_minor(&landed_costs, currency_id));
    PurchaseSpendReportV1 {
        quantity_purchased: lines.iter().map(|line| line.quantity).sum(),
        total_spend,
        landed_costs,
        total_including_landed_costs: money(total_spend.minor_units + landed_costs.minor_units),
        lines,
    }
}

pub fn payment_fee_summary(
    fees: Vec<FeeRow>,
    transactions: Vec<PaymentTransactionRow>,
    accounts: Vec<PaymentAccountRow>,
    currency_id: u64,
) -> PaymentFeeSummaryReportV1 {
    let transactions = transactions
        .into_iter()
        .map(|row| (row.id, row))
        .collect::<BTreeMap<_, _>>();
    let accounts = accounts
        .into_iter()
        .map(|row| (row.id, row))
        .collect::<BTreeMap<_, _>>();
    let mut rows = BTreeMap::<(String, String), (i64, i64)>::new();
    for fee in fees
        .into_iter()
        .filter(|fee| fee.currency_id == currency_id)
    {
        let Some(transaction) = transactions
            .get(&fee.payment_transaction_id)
            .filter(|row| row.currency_id == currency_id)
        else {
            continue;
        };
        let account = accounts.get(&transaction.payment_account_id);
        let label = account
            .map(|row| format!("{} · {}", row.name, row.provider_code))
            .unwrap_or_else(|| format!("Account #{}", transaction.payment_account_id));
        let row = rows.entry((label, fee.bearer)).or_default();
        row.0 += money_minor(fee.amount);
        row.1 += money_minor(fee.tax_amount);
    }
    let lines = rows
        .into_iter()
        .map(|((provider_account, bearer), (fee, tax))| PaymentFeeLine {
            provider_account,
            bearer,
            amount: money(fee),
            tax: money(tax),
            total: money(fee + tax),
        })
        .collect::<Vec<_>>();
    PaymentFeeSummaryReportV1 {
        fee_count: lines.len(),
        fees: sum_money(&lines, |line| line.amount),
        tax: sum_money(&lines, |line| line.tax),
        total: sum_money(&lines, |line| line.total),
        lines,
    }
}

pub fn monthly_owner(
    sales: Vec<AmountRow>,
    purchases: Vec<AmountRow>,
    fees: Vec<FeeRow>,
    moves: Vec<MovementRow>,
    currency_id: u64,
) -> MonthlyOwnerReportV1 {
    let sum = |rows: Vec<AmountRow>| {
        money(
            rows.into_iter()
                .filter(|row| row.currency_id == currency_id)
                .map(|row| money_minor(row.amount_total))
                .sum(),
        )
    };
    let payment_fees = money(
        fees.into_iter()
            .filter(|row| row.currency_id == currency_id)
            .map(|row| money_minor(row.amount + row.tax_amount))
            .sum(),
    );
    let stock_movement_value = money(
        moves
            .iter()
            .map(|row| money_minor(row.quantity_done * row.price_unit))
            .sum(),
    );
    MonthlyOwnerReportV1 {
        sales: sum(sales),
        purchase_spend: sum(purchases),
        payment_fees,
        stock_movement_value,
        stock_movement_count: moves.len(),
    }
}

fn money_minor(value: f64) -> i64 {
    (value * 100.0).round() as i64
}
fn landed_cost_minor(rows: &[LandedCostRow], currency_id: u64) -> i64 {
    rows.iter()
        .filter(|row| row.currency_id == currency_id)
        .map(|row| money_minor(row.amount_total))
        .sum()
}
fn money(minor_units: i64) -> MoneyAmount {
    MoneyAmount {
        minor_units,
        scale: 2,
    }
}
fn sum_money<T>(rows: &[T], get: impl Fn(&T) -> MoneyAmount) -> MoneyAmount {
    money(rows.iter().map(|row| get(row).minor_units).sum())
}
